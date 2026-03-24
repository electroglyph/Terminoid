// Copyright 2024 electroglyph
const el_file = document.getElementById('fileElem');
const el_upload = document.getElementById('upload');
const el_terminal = document.getElementById('terminal');
let term = null;
// the most secure authentication system ever devised:
const n = Math.floor(Math.random() * 0x7FFFFFFF) * 0x7E43;

let cast_time = [];
let cast_code = [];
let cast_data = [];
let cast_header = '';
let index = 0;
let cast_len = 0;
let play_start = 0;
let playing = false;
let interval_id = 0;

async function parse_cast(data) {
    const lines = data.split('\n');
    cast_time = new Array(lines.length - 1);
    cast_code = new Array(lines.length - 1);
    cast_data = new Array(lines.length - 1);
    cast_len = lines.length - 1;
    try {
        cast_header = JSON.parse(lines[0]);
        console.log(cast_header);
        let line = '';
        for (let x = 1; x < lines.length; x++) {
            line = JSON.parse(lines[x]);
            if (line.length == 3) {
                cast_time[x - 1] = line[0];
                cast_code[x - 1] = line[1];
                cast_data[x - 1] = line[2];
            }
        }
        cast_parsed = true;
    } catch (e) {
        alert('Malformed asciicast file!');
        return false;
    }
    return true;
}

const uploadData = (url, cast, pic, title, desc, size, onProgress) =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => onProgress(e.loaded / e.total));
        xhr.addEventListener('load', () => resolve({status: xhr.status, body: xhr.responseText}));
        xhr.addEventListener('error', () => reject(new Error('File upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('File upload aborted')));
        xhr.open('POST', url, true);
        xhr.setRequestHeader('n', n.toString());
        const fd = new FormData();
        fd.append('cast', cast);
        fd.append('pic', pic);
        fd.append('title', title);
        fd.append('desc', desc);
        fd.append('size', size);
        xhr.send(fd);
    });

async function encode(array) {
    return new Promise((resolve) => {
        const blob = new Blob([array]);
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const [_, base64] = dataUrl.split(',');
            resolve(base64);
        };
        reader.readAsDataURL(blob);
    });
}

function getTextWidth(count, font) {
    const text = 'W'.repeat(count);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(text);
    return metrics.width;
}

async function onResize(e) {
    fitAddon.fit();
}

// https://ourcodeworld.com/articles/read/683/how-to-remove-the-transparent-pixels-that-surrounds-a-canvas-in-javascript
async function trimCanvas(c) {
    let ctx = c.getContext('2d'),
        copy = document.createElement('canvas').getContext('2d'),
        pixels = ctx.getImageData(0, 0, c.width, c.height),
        l = pixels.data.length,
        i,
        bound = {
            top: null,
            left: null,
            right: null,
            bottom: null
        },
        x, y;

    for (i = 0; i < l; i += 4) {
        if (pixels.data[i + 3] !== 0) {
            x = (i / 4) % c.width;
            y = ~~((i / 4) / c.width);

            if (bound.top === null) {
                bound.top = y;
            }

            if (bound.left === null) {
                bound.left = x;
            } else if (x < bound.left) {
                bound.left = x;
            }

            if (bound.right === null) {
                bound.right = x;
            } else if (bound.right < x) {
                bound.right = x;
            }

            if (bound.bottom === null) {
                bound.bottom = y;
            } else if (bound.bottom < y) {
                bound.bottom = y;
            }
        }
    }
    let trimHeight = bound.bottom - bound.top,
        trimWidth = bound.right - bound.left,
        trimmed = ctx.getImageData(bound.left, bound.top, trimWidth, trimHeight);
    copy.canvas.width = trimWidth;
    copy.canvas.height = trimHeight;
    copy.putImageData(trimmed, 0, 0);
    return copy.canvas;
}

async function onUpload(e) {
    index = 0;
    let f = await el_file.files[0].arrayBuffer();
    let text = await el_file.files[0].text();
    if (!await parse_cast(text.trim())) {
        return;
    }
    // Support v3 dual-terminal header (left.cols/rows) as well as v1/v2 (width/height)
    const termCols = parseInt(cast_header.width) || (cast_header.left && cast_header.left.cols) || 80;
    const termRows = parseInt(cast_header.height) || (cast_header.left && cast_header.left.rows) || 24;
    term = new Terminal({
        convertEol: true,
        allowProposedApi: true,
        cols: termCols,
        rows: termRows,
        fontFamily: 'Fira Code',
        fontSize: 10,
        cursorBlink: true,
        customGlyphs: true,
        cursorStyle: 'block',
    });
    const fitAddon = new FitAddon.FitAddon();
    const canvasAddon = new CanvasAddon.CanvasAddon();
    const width = getTextWidth(termCols, '10px Fira Code');
    term.open(el_terminal);
    term.loadAddon(fitAddon);
    term.loadAddon(canvasAddon); // fix for corrupted screenshots
    el_terminal.style.width = width.toString() + "px";
    fitAddon.fit();
    // For v3: only replay 'o' (left terminal) events for the thumbnail
    const isV3 = cast_header.version === 3;
    let buffer = '';
    const half = Math.floor(cast_len / 2);
    for (let x = 0; x < half; x++) {
        // For v3 skip right-terminal ('r'), resize, show_right, hide_right events
        if (isV3) {
            if (cast_code[x] === 'o') buffer += cast_data[x];
        } else {
            if (cast_code[x] !== 'm') buffer += cast_data[x];
        }
    }
    term.write(buffer);
    const z = await pako.deflate(f);
    const cast = await encode(z);
    let b = document.createElement('button');
    b.onclick = onClick;
    b.innerHTML = 'Submit';
    let t_input = document.createElement('input');
    t_input.addEventListener('input', onTitleInput, false);
    async function onTitleInput() {
        if (this.value.length > 64) {
            this.value = this.value.substring(0, 64);
            alert('Max title length is 64 characters')
        }
    }
    let d_input = document.createElement('textarea');
    d_input.style.height = d_input.scrollHeight + 'px;overflow-y:hidden;';
    d_input.addEventListener('input', onDescInput, false);

    async function onDescInput() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
        if (this.value.length > 1024) {
            this.value = this.value.substring(0, 1024);
            alert('Max description length is 1024 characters')
        }
    }

    t_input.type = 'text';
    if (cast_header.title) {
        t_input.value = cast_header.title.substring(0, 64);
    } else {
        t_input.value = el_file.files[0].name.substring(0, 64);
    }
    let t_label = document.createElement('label');
    let d_label = document.createElement('label');
    t_label.for = 't_input';
    t_label.innerHTML = 'Title'
    d_label.for = 'd_input';
    d_label.innerHTML = 'Description';
    let p = document.createElement('span');
    const u = document.getElementById('upload_div');
    u.appendChild(t_label);
    u.appendChild(t_input);
    u.appendChild(d_label);
    u.appendChild(d_input);
    u.appendChild(b);
    u.appendChild(p);
    el_upload.remove();

    async function onClick() {
        b.disabled = true;
        b.className = 'disabled';
        const canvas = await html2canvas(el_terminal, {backgroundColor: null});
        const fixed = await trimCanvas(canvas);
        const pic = fixed.toDataURL('image/png');
        const size = (cast.length/(1024*1024)).toFixed(2) + 'MiB (' + (el_file.files[0].size/(1024*1024)).toFixed(2) + 'MiB)';
        const onProgress = progress => p.innerHTML = '<br>Upload progress: ' + (progress * 100).toFixed(2).toString() + '%';
        const response = await uploadData('/upload', cast, pic, t_input.value, d_input.value, size, onProgress);
        if (response.status !== 200) {
            alert('Upload failed!');
        } else {
            const r = JSON.parse(response.body);
            window.location.assign('/play?id=' + r.id + '&key=' + r.key);
        }
    }
}

async function onLoad(e) {
    const r = await fetch('/visits');
    if (r.status === 200) {
        document.getElementById('visits').innerHTML = '<br><br>visits: ' + await r.text();
    }
}

if (el_file && el_upload) {
    el_upload.addEventListener('click', e => {
        el_file.click();
    });
    el_file.addEventListener('change', e => onUpload(e));
}
document.addEventListener("DOMContentLoaded", e => onLoad(e));