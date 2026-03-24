// Copyright 2026 electroglyph
'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const el_terminal_left  = document.getElementById('terminal-left');
const el_terminal_right = document.getElementById('terminal-right');
const el_divider        = document.getElementById('divider-bar');
const el_scrubber       = document.getElementById('scrubber');
const el_time_display   = document.getElementById('time-display');
const el_duration       = document.getElementById('duration-display');

// ── State ─────────────────────────────────────────────────────────────────────
let termLeft  = null;
let termRight = null;
let fitAddonLeft  = null;
let fitAddonRight = null;

let cast_header   = '';
let cast_version  = 1;   // 1 = original asciicast, 2 = customised single, 3 = dual-terminal
let cast_events   = [];  // [{t, type, data}]
let cast_duration = 0;

let index      = 0;
let play_start = 0;
let playing    = false;
let interval_id = 0;
let pause_time  = null;

let scrubber_interval_id = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt_time(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + String(s).padStart(2, '0');
}

async function getTextWidth(count, font) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    // xterm internally calculates grid width by measuring a single character, rounding up,
    // and multiplying by cols. Using a long string underestimates this by up to 10%.
    const singleCharWidth = Math.ceil(ctx.measureText('W').width);
    // Add 20px buffer per terminal for xterm viewport padding/scrollbars
    return (singleCharWidth * count) + 20;
}

async function getMaxTextSize(cols) {
    for (let x = 15; x > 5; x--) {
        const w = await getTextWidth(cols, x + 'px Fira Code');
        if (w < window.innerWidth) return [x, w];
    }
    return [5, await getTextWidth(cols, '5px Fira Code')];
}

function saveBlob(filename, data) {
    const blob = new Blob([data], {type: 'application/octet-stream'});
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveBlob(blob, filename);
    } else {
        const elem = window.document.createElement('a');
        elem.href = window.URL.createObjectURL(blob);
        elem.download = filename;
        document.body.appendChild(elem);
        elem.click();
        document.body.removeChild(elem);
    }
}

// ── Format detection & parsing ────────────────────────────────────────────────
function detect_version(header) {
    if (header.version === 3) return 3;
    if (header.version === 2) return 2;
    return 1;
}

async function parse_cast(data) {
    const lines = data.split('\n').filter(l => l.trim() !== '');
    try {
        cast_header  = JSON.parse(lines[0]);
        cast_version = detect_version(cast_header);
        cast_events  = [];

        for (let i = 1; i < lines.length; i++) {
            const ev = JSON.parse(lines[i]);
            if (!Array.isArray(ev) || ev.length < 3) continue;
            const [t, type, payload] = ev;
            cast_events.push({ t, type, data: payload });
        }

        cast_duration = cast_events.length > 0 ? cast_events[cast_events.length - 1].t : 0;
        el_duration.textContent = fmt_time(cast_duration);
        return true;
    } catch (e) {
        alert('Malformed cast file!');
        return false;
    }
}

// ── Terminal init ─────────────────────────────────────────────────────────────
async function init_terms() {
    if (termLeft)  { termLeft.dispose();  termLeft  = null; }
    if (termRight) { termRight.dispose(); termRight = null; }

    // Determine dimensions
    let leftCols  = 80, leftRows  = 24;
    let rightCols = 80, rightRows = 24;

    if (cast_version === 3) {
        if (cast_header.left)  { leftCols  = cast_header.left.cols;  leftRows  = cast_header.left.rows; }
        if (cast_header.right) { rightCols = cast_header.right.cols; rightRows = cast_header.right.rows; }
    } else {
        if (cast_header.width)  leftCols  = cast_header.width;
        if (cast_header.height) leftRows  = cast_header.height;
    }

    // Find font size
    let fontSize = 16;
    let leftWidth, rightWidth;

    if (cast_version === 3) {
        // For dual-terminal: pick the largest font that makes BOTH terminals
        // fit side-by-side within the window. We ignore custom divider_pct here 
        // to avoid artificially constricting one side when the other has plenty of space.
        const dividerPx  = 5;
        const availWidth = window.innerWidth - 40; // reserve 40px for body padding/scrollbars

        leftWidth  = await getTextWidth(leftCols,  '16px Fira Code');
        rightWidth = await getTextWidth(rightCols, '16px Fira Code');

        if ((leftWidth + rightWidth + dividerPx) > availWidth) {
            fontSize = 5; // fallback if nothing fits
            for (let fs = 15; fs >= 5; fs--) {
                leftWidth  = await getTextWidth(leftCols,  fs + 'px Fira Code');
                rightWidth = await getTextWidth(rightCols, fs + 'px Fira Code');
                if ((leftWidth + rightWidth + dividerPx) <= availWidth) {
                    fontSize = fs;
                    break;
                }
            }
        }
    } else {
        leftWidth = await getTextWidth(leftCols, '16px Fira Code');
        if (leftWidth > window.innerWidth) {
            const res = await getMaxTextSize(leftCols);
            fontSize  = res[0];
            leftWidth = res[1];
        }
    }

    const termOpts = (cols, rows) => ({
        convertEol: true,
        allowProposedApi: true,
        cols, rows,
        fontFamily: 'Fira Code',
        fontSize,
        cursorBlink: true,
        customGlyphs: true,
        cursorStyle: 'block',
    });

    if (cast_version === 3) {
        // Show both panes before open() so WebGL gets real layout dimensions.
        el_divider.style.display        = 'block';
        el_terminal_right.style.display = 'block';

        // Instead of overriding xterm's native layout with manual pixels, let it 
        // expand to fit its natural character grid perfectly.
        el_terminal_left.style.width  = 'fit-content';
        el_terminal_left.style.flex   = 'none';
        el_terminal_right.style.width = 'fit-content';
        el_terminal_right.style.flex  = 'none';

        // Size the container to tightly fit everything and center it
        const el_tc = document.getElementById('terminal-container');
        el_tc.style.width          = 'fit-content';
        el_tc.style.margin         = '0 auto';
        el_tc.style.justifyContent = 'center';

        // Left terminal
        fitAddonLeft = new FitAddon.FitAddon();
        termLeft = new Terminal(termOpts(leftCols, leftRows));
        const wgl = new WebglAddon.WebglAddon();
        wgl.onContextLoss(() => wgl.dispose());
        termLeft.loadAddon(wgl);
        termLeft.loadAddon(new WebLinksAddon.WebLinksAddon());
        termLeft.loadAddon(fitAddonLeft);
        termLeft.open(el_terminal_left);

        // Right terminal
        fitAddonRight = new FitAddon.FitAddon();
        termRight = new Terminal(termOpts(rightCols, rightRows));
        const wgl2 = new WebglAddon.WebglAddon();
        wgl2.onContextLoss(() => wgl2.dispose());
        termRight.loadAddon(wgl2);
        termRight.loadAddon(new WebLinksAddon.WebLinksAddon());
        termRight.loadAddon(fitAddonRight);
        termRight.open(el_terminal_right);

        if (!cast_header.right_visible) {
            el_divider.style.display        = 'none';
            el_terminal_right.style.display = 'none';
        }
    } else {
        // v1/v2: single left terminal
        fitAddonLeft = new FitAddon.FitAddon();
        termLeft = new Terminal(termOpts(leftCols, leftRows));
        const wgl = new WebglAddon.WebglAddon();
        wgl.onContextLoss(() => wgl.dispose());
        termLeft.loadAddon(wgl);
        termLeft.loadAddon(new WebLinksAddon.WebLinksAddon());
        termLeft.loadAddon(fitAddonLeft);
        el_terminal_left.style.width = 'fit-content';
        termLeft.open(el_terminal_left);
    }

    const resEl = document.getElementById('result');
    if (resEl) {
        resEl.className = '';
        resEl.style.width = '100%';
        resEl.style.maxWidth = '100vw'; 
    }

    let wrapper = document.getElementById('playback-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'playback-wrapper';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'stretch';
        wrapper.style.width = 'max-content';
        wrapper.style.margin = '0 auto';
        
        const tc = document.getElementById('terminal-container');
        const sr = document.getElementById('scrubber-row');
        const cr = document.getElementById('controls-row');
        
        if (tc && tc.parentNode) tc.parentNode.insertBefore(wrapper, tc);
        if (tc) {
            tc.style.width = 'max-content';
            tc.style.margin = '0';
            wrapper.appendChild(tc);
        }
        if (sr) {
            sr.style.width = 'auto'; // allow it to stretch via parent align-items
            wrapper.appendChild(sr);
        }
        if (cr) {
            cr.style.width = 'auto';
            cr.style.justifyContent = 'center';
            wrapper.appendChild(cr);
        }
    }
}

// ── Playback engine ───────────────────────────────────────────────────────────
function dispatch_event(ev) {
    switch (ev.type) {
        case 'o':
            if (termLeft) termLeft.write(typeof ev.data === 'string' ? ev.data : '');
            break;
        case 'r':
            if (termRight) termRight.write(typeof ev.data === 'string' ? ev.data : '');
            break;
        case 'resize':
            if (termLeft && ev.data.left)  termLeft.resize(ev.data.left.cols,   ev.data.left.rows);
            if (termRight && ev.data.right) termRight.resize(ev.data.right.cols, ev.data.right.rows);
            break;
        case 'show_right':
            el_divider.style.display        = 'block';
            el_terminal_right.style.display = 'block';
            break;
        case 'hide_right':
            el_divider.style.display        = 'none';
            el_terminal_right.style.display = 'none';
            break;
        case 'm':
            // marker — skip
            break;
        default:
            // legacy single-terminal: type is "o" equivalent
            if (termLeft) termLeft.write(typeof ev.data === 'string' ? ev.data : '');
    }
}

function render_lines() {
    if (!playing) return;
    const elapsed = (Date.now() - play_start) / 1000;
    let buffer_left  = '';
    let buffer_right = '';

    while (playing) {
        if (index >= cast_events.length) {
            // flush
            if (buffer_left  !== '' && termLeft)  termLeft.write(buffer_left);
            if (buffer_right !== '' && termRight) termRight.write(buffer_right);
            clearInterval(interval_id);
            document.getElementById('play_button').innerHTML = 'Replay';
            index      = 0;
            pause_time = null;
            playing    = false;
            stop_scrubber_ticker();
            el_scrubber.value = 1000;
            el_time_display.textContent = fmt_time(cast_duration);
            return;
        }

        const ev = cast_events[index];
        if (elapsed >= ev.t) {
            // Flush accumulated buffers of different type before switching
            if (ev.type === 'o' || (!['o','r','resize','show_right','hide_right','m'].includes(ev.type))) {
                if (buffer_right !== '' && termRight) { termRight.write(buffer_right); buffer_right = ''; }
                buffer_left += (typeof ev.data === 'string') ? ev.data : '';
            } else if (ev.type === 'r') {
                if (buffer_left !== '' && termLeft) { termLeft.write(buffer_left); buffer_left = ''; }
                buffer_right += (typeof ev.data === 'string') ? ev.data : '';
            } else {
                // structural event — flush both buffers first
                if (buffer_left  !== '' && termLeft)  { termLeft.write(buffer_left);   buffer_left  = ''; }
                if (buffer_right !== '' && termRight) { termRight.write(buffer_right); buffer_right = ''; }
                dispatch_event(ev);
            }
            index++;
        } else {
            // Not yet time — flush and return
            if (buffer_left  !== '' && termLeft)  termLeft.write(buffer_left);
            if (buffer_right !== '' && termRight) termRight.write(buffer_right);
            return;
        }
    }
}

function start_scrubber_ticker() {
    stop_scrubber_ticker();
    scrubber_interval_id = setInterval(() => {
        if (!playing || cast_duration <= 0) return;
        const elapsed = (Date.now() - play_start) / 1000;
        const clamped = Math.min(elapsed, cast_duration);
        el_scrubber.value       = (clamped / cast_duration) * 1000;
        el_time_display.textContent = fmt_time(clamped);
    }, 200);
}

function stop_scrubber_ticker() {
    if (scrubber_interval_id) {
        clearInterval(scrubber_interval_id);
        scrubber_interval_id = 0;
    }
}

// ── Seek ──────────────────────────────────────────────────────────────────────
async function seek(target_t) {
    const was_playing = playing;
    playing = false;
    clearInterval(interval_id);
    stop_scrubber_ticker();

    // Reset terminals to initial state
    if (termLeft)  termLeft.clear();
    if (termRight) termRight.clear();

    // Reset divider/pane visibility to initial state
    if (cast_version === 3) {
        const divPct = cast_header.divider_pct || 50;
        el_terminal_left.style.width = divPct + '%';
        if (cast_header.right_visible) {
            el_divider.style.display        = 'block';
            el_terminal_right.style.display = 'block';
        } else {
            el_divider.style.display        = 'none';
            el_terminal_right.style.display = 'none';
        }
        if (cast_header.left  && termLeft)  termLeft.resize(cast_header.left.cols,   cast_header.left.rows);
        if (cast_header.right && termRight) termRight.resize(cast_header.right.cols, cast_header.right.rows);
    }

    // Replay synchronously up to target_t
    let bl = '', br = '';
    for (let i = 0; i < cast_events.length; i++) {
        const ev = cast_events[i];
        if (ev.t > target_t) {
            index = i;
            break;
        }
        if (ev.type === 'o' || !['o','r','resize','show_right','hide_right','m'].includes(ev.type)) {
            if (br !== '' && termRight) { termRight.write(br); br = ''; }
            bl += (typeof ev.data === 'string') ? ev.data : '';
        } else if (ev.type === 'r') {
            if (bl !== '' && termLeft)  { termLeft.write(bl);  bl = ''; }
            br += (typeof ev.data === 'string') ? ev.data : '';
        } else {
            if (bl !== '' && termLeft)  { termLeft.write(bl);  bl = ''; }
            if (br !== '' && termRight) { termRight.write(br); br = ''; }
            dispatch_event(ev);
        }
        if (i === cast_events.length - 1) index = cast_events.length;
    }
    if (bl !== '' && termLeft)  termLeft.write(bl);
    if (br !== '' && termRight) termRight.write(br);

    // Adjust play_start so real-time continues from target_t
    play_start = Date.now() - target_t * 1000;
    el_scrubber.value       = cast_duration > 0 ? (target_t / cast_duration) * 1000 : 0;
    el_time_display.textContent = fmt_time(target_t);

    if (was_playing && index < cast_events.length) {
        playing     = true;
        interval_id = setInterval(render_lines, 3);
        start_scrubber_ticker();
    }
}

// ── Play / Pause control ──────────────────────────────────────────────────────
async function play_cast() {
    if (termLeft)  termLeft.clear();
    if (termRight) termRight.clear();
    index      = 0;
    play_start = Date.now();
    playing    = true;
    interval_id = setInterval(render_lines, 3);
    start_scrubber_ticker();
}

async function onPlay(e) {
    if (!playing) {
        if (pause_time !== null) {
            // Resume
            playing = true;
            const elapsed = Date.now() - pause_time;
            play_start += elapsed;
            pause_time  = null;
            interval_id = setInterval(render_lines, 3);
            start_scrubber_ticker();
            document.getElementById('play_button').innerHTML = 'Pause';
            return;
        }
        // Fresh play
        const pic = document.getElementById('pic');
        if (pic) pic.remove();
        if (termLeft === null) await init_terms();
        document.getElementById('play_button').innerHTML = 'Pause';
        await play_cast();
    } else {
        // Pause
        playing    = false;
        pause_time = Date.now();
        clearInterval(interval_id);
        stop_scrubber_ticker();
        document.getElementById('play_button').innerHTML = 'Resume';
    }
}

// ── Scrubber interaction ──────────────────────────────────────────────────────
el_scrubber.addEventListener('mousedown', () => {
    if (playing) {
        playing = false;
        clearInterval(interval_id);
        stop_scrubber_ticker();
    }
});

el_scrubber.addEventListener('input', async () => {
    if (cast_duration <= 0) return;
    const target_t = (el_scrubber.value / 1000) * cast_duration;
    el_time_display.textContent = fmt_time(target_t);
});

el_scrubber.addEventListener('change', async () => {
    if (cast_duration <= 0) return;
    const target_t = (el_scrubber.value / 1000) * cast_duration;
    // Initialise terminals if not yet done (user scrubbed before pressing play)
    if (termLeft === null) await init_terms();
    await seek(target_t);
    // After seek, resume if we were previously playing
    if (!playing && pause_time === null) {
        // scrubbed while not playing: stay paused at new position
        pause_time = Date.now();
        document.getElementById('play_button').innerHTML = 'Resume';
    }
});

// ── Network + load ────────────────────────────────────────────────────────────
async function download(id) {
    const response = await fetch('/download?id=' + id);
    document.getElementById('title').innerHTML = '<br>Downloading ... ';
    if (response.status !== 200) {
        document.getElementById('title').innerHTML = '<br>Download failed';
        return false;
    }
    return await response.json();
}

async function onLoad(e) {
    let params = new URLSearchParams(document.location.search);
    let id  = params.get('id');
    let key = params.get('key');
    if (!id) {
        document.getElementById('title').innerHTML = 'Invalid link';
        return;
    }
    const dl = await download(id);
    if (!dl) {
        document.getElementById('title').innerHTML = 'Invalid link';
        return;
    }
    document.getElementById('views').innerHTML = '<br>views: ' + dl.views;
    const img = document.createElement('img');
    img.src = dl.pic;
    img.id  = 'img';
    img.onload = () => {
        const t = document.getElementById('title');
        t.style.width = img.naturalWidth + 'px';
        t.innerHTML   = dl.title;
        const d = document.getElementById('desc');
        d.style.width = img.naturalWidth + 'px';
        d.innerHTML   = '<br>' + dl.desc;
        document.getElementById('size').innerHTML = 'size: ' + dl.size;
        img.style.width = img.naturalWidth + 'px';
        const p = document.getElementById('pic');
        p.style.width = img.naturalWidth + 20 + 'px';
        if (img.naturalWidth > window.innerWidth) {
            t.style.width = '100%';
            d.style.width = '100%';
            p.style.width = '100%';
            img.style.width = '100%';
            document.getElementById('result').style.width = '100%';
        }
        p.appendChild(img);
        let play = document.createElement('button');
        play.id      = 'play_button';
        play.onclick = onPlay;
        play.innerHTML = 'Play';
        document.getElementById('play').appendChild(play);
    };

    // base64 encoded and compressed cast -> bytes -> decompress -> text
    const cast_b64 = await fetch('data:application/octet-stream;base64,' + dl.cast);
    const cast = await cast_b64.arrayBuffer();
    const uz   = await pako.inflate(cast);
    const dec  = new TextDecoder('utf-8');
    const downloaded_cast = dec.decode(uz).trim();

    const el_download = document.createElement('button');
    el_download.addEventListener('click', () => saveBlob(dl.title + '.cast', downloaded_cast));
    el_download.innerHTML = 'Download';
    document.getElementById('download').appendChild(el_download);

    await parse_cast(downloaded_cast);

    if (key) {
        let delete_button = document.createElement('button');
        delete_button.className = 'delete';
        delete_button.innerHTML = 'Delete';
        delete_button.onclick = onDelete;
        async function onDelete() {
            if (!confirm('Really delete?')) return;
            delete_button.disabled  = true;
            delete_button.className = 'disabled';
            const r = await fetch('/delete?id=' + id + '&key=' + key);
            if (r.status !== 200) alert('Delete failed!');
        }
        document.getElementById('delete_div').appendChild(delete_button);
        document.getElementById('warning').innerHTML =
            'BOOKMARK THIS URL IF YOU MAY WANT TO DELETE THIS LATER<br>' +
            'DO NOT SHARE THIS URL, ANYONE WITH THE KEY CAN DELETE THIS RECORDING';
        let share = document.createElement('input');
        share.type     = 'text';
        share.id       = 'share';
        share.value    = window.location.origin + '/play?id=' + id;
        share.readOnly = true;
        const sw = await getTextWidth(share.value.length, '18px Fira Code');
        share.style.width = sw + 'px';
        let copy_button = document.createElement('button');
        copy_button.innerHTML = 'Copy';
        copy_button.onclick = async () => {
            share.select();
            share.setSelectionRange(0, 777);
            await navigator.clipboard.writeText(share.value);
        };
        const s = document.getElementById('share_div');
        let p = document.createElement('p');
        p.innerHTML = 'Share this recording:';
        document.getElementById('share_text').appendChild(p);
        s.appendChild(share);
        s.appendChild(copy_button);
    }
}

async function onWindowResize(e) {
    const img = document.getElementById('img');
    if (img && img.naturalWidth > window.innerWidth) {
        document.getElementById('title').style.width  = '100%';
        document.getElementById('desc').style.width   = '100%';
        document.getElementById('pic').style.width    = '100%';
        img.style.width = '100%';
        document.getElementById('result').style.width = '100%';
    }
    if (termLeft) {
        if (cast_version === 3) {
            // For v3, recalculate font size based on combined widths but let CSS handle the widths organically
            let leftCols  = cast_header.left ? cast_header.left.cols : 80;
            let rightCols = cast_header.right ? cast_header.right.cols : 80;
            let fs = 16;
            const dividerPx  = 5;
            const availWidth = window.innerWidth - 40;

            let lw = await getTextWidth(leftCols,  '16px Fira Code');
            let rw = await getTextWidth(rightCols, '16px Fira Code');

            if ((lw + rw + dividerPx) > availWidth) {
                fs = 5;
                for (let x = 15; x >= 5; x--) {
                    lw = await getTextWidth(leftCols,  x + 'px Fira Code');
                    rw = await getTextWidth(rightCols, x + 'px Fira Code');
                    if ((lw + rw + dividerPx) <= availWidth) {
                        fs = x;
                        break;
                    }
                }
            }
            termLeft.options.fontSize = fs;
            if (termRight) termRight.options.fontSize = fs;

            // Make sure the wrappers are unconstrained so the layout works
            document.getElementById('result').style.width = 'fit-content';
            document.getElementById('result').style.maxWidth = 'none';
            document.getElementById('result').className = '';
        } else {
            // v1/v2 logic stripped of unsafe fit() calls
            let fontSize = 16;
            const leftCols = cast_header.width || 80;
            let width = await getTextWidth(leftCols, '16px Fira Code');
            if (width > window.innerWidth) {
                const res = await getMaxTextSize(leftCols);
                fontSize  = res[0];
                termLeft.options.fontSize = fontSize;
                document.getElementById('result').style.width = 'fit-content';
                document.getElementById('result').className   = '';
            } else {
                termLeft.options.fontSize = 16;
                document.getElementById('result').style.width = 'fit-content';
                document.getElementById('result').className   = '';
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', e => onLoad(e));
window.addEventListener('resize', e => onWindowResize(e));