// Copyright 2024 electroglyph
async function onLoad(e) {
    const r = await fetch('/hot');
    const o = await r.json();
    document.getElementById('loading').remove();
    o.forEach(add);
    function add(value) {
        let a = document.createElement('a');
        a.className = 'result_link';
        a.style.borderRadius = '12px';
        a.href = '/play' + '?id=' + value.id;
        a.target = '_blank';
        let div = document.createElement('div');
        div.className = 'result';
        div.style.border = '1px solid #3f3f44';
        div.style.borderRadius = '12px';
        div.style.padding = '10px';
        let t = document.createElement('p');
        t.innerHTML = value.title;
        const img = document.createElement('img');
        img.src = value.pic;
        let d = document.createElement('p');
        d.innerHTML = value.desc;
        let v = document.createElement('p');
        v.innerHTML = 'views: ' + value.views;
        let s = document.createElement('p');
        s.innerHTML = 'size: ' + value.size;
        img.onload = () => {
            if (img.naturalWidth > window.innerWidth) {
                img.style.width = '100%';
                div.style.width = '100%';
            }
            else {
                img.style.width = img.naturalWidth + "px";
                d.style.width = img.naturalWidth + "px";
                div.style.width = img.naturalWidth + 20 + "px";
            }
            div.appendChild(t);
            div.appendChild(img);
            div.appendChild(d);
            div.appendChild(v);
            div.appendChild(s);
        }
        a.appendChild(div);
        let r = document.getElementById('results');
        r.appendChild(a);
    }
}
document.addEventListener("DOMContentLoaded", e => onLoad(e));
