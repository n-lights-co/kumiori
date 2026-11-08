#!/usr/bin/env node
/**
 * compare-view — 見本の PDF と Kumiori の PDF を、人の目で見比べるためのページ (HTML) を作る。
 *
 * 使い方:
 *   node scripts/compare-view.mjs --ref <見本の PDF のディレクトリ> --pdf <Kumiori の PDF のディレクトリ> [--out <出力先>] [--dpi 72] [--names a,b] [--inline]
 *   node scripts/compare-view.mjs --ref <見本の PDF> --pdf <Kumiori の PDF> [--out …]   (1 組だけ)
 *
 *  - ディレクトリを渡したときは、同じ名前の PDF (Kumiori の側は「名前.pdf」または「名前.kumiori.pdf」) を組にする。
 *  - <出力先>/index.html をブラウザで開く。見本の一覧は差の大きい順。ページごとに、次の 4 つの見え方を切り替えられる:
 *      並べる (左に見本、右に Kumiori)・重ねる (Kumiori の不透明度を変える)・点滅 (見本と Kumiori を交互に)・差 (違う画素に色を付ける。
 *      青は見本にだけ字や線がある所、赤は Kumiori にだけある所)
 *    キー: ← → でページ、↑ ↓ で見本、1〜4 で見え方
 *  - 差の数字は compare-pdf.mjs と同じ (輝度の差が 64 を超える画素の割合)。
 *  - --inline: 画像を HTML に埋め込み、index.html 1 つで開けるようにする (見本が多いと大きくなる)。
 *  - --jpeg: ページの画像を JPEG (品質 85) にして小さくする (既定は PNG)。差の画像は、色の数の少ない PNG。
 *  - --artifact: claude.ai の Artifact として公開する形で書き出す (index.html は <html>・<head>・<body> を書かない。
 *    差の画像は書き出さず、ブラウザで見本と Kumiori の画像から描く (ファイルの数を減らす))。
 *  - --mode side|overlay|blink|diff: 最初の見え方 (既定は side)。見ていた見本・ページ・見え方はブラウザに覚えておき、開き直しても
 *    (ページを更新しても) 同じところから見られる。
 *  - 見本の PDF とその画像はリポジトリに入れない (著作物)。出力先は既定で compare-view-out (.gitignore 済み)。
 *
 * 必要なもの: pdftoppm (poppler-utils)。
 */
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []),
);
if (!args.ref || !args.pdf) {
  console.error('usage: node scripts/compare-view.mjs --ref <見本の PDF (のディレクトリ)> --pdf <Kumiori の PDF (のディレクトリ)> [--out <dir>] [--dpi 72] [--names a,b] [--inline]');
  process.exit(1);
}
const outDir = path.resolve(args.out ?? 'compare-view-out');
const dpi = Number(args.dpi ?? 72);
const inline = args.inline === true || args.inline === 'true';
const jpeg = args.jpeg === true || args.jpeg === 'true';
const artifact = args.artifact === true || args.artifact === 'true';
const initialMode = ['side', 'overlay', 'blink', 'diff'].includes(String(args.mode)) ? String(args.mode) : 'side';
const only = typeof args.names === 'string' ? new Set(args.names.split(',').map((s) => s.trim())) : undefined;

/** 比べる組 [名前, 見本の PDF, Kumiori の PDF] */
function pairs() {
  const isDir = (p) => fs.statSync(p).isDirectory();
  if (!isDir(args.ref) && !isDir(args.pdf)) return [[path.basename(args.pdf).replace(/(\.kumiori)?\.pdf$/i, ''), args.ref, args.pdf]];
  if (!isDir(args.ref) || !isDir(args.pdf)) throw new Error('--ref と --pdf は、両方ともディレクトリか、両方とも PDF にする');
  const out = [];
  for (const f of fs.readdirSync(args.ref).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const name = f.replace(/\.pdf$/i, '');
    if (only && !only.has(name)) continue;
    const k = [`${name}.kumiori.pdf`, `${name}.pdf`].map((g) => path.join(args.pdf, g)).find((g) => fs.existsSync(g));
    if (k) out.push([name, path.join(args.ref, f), k]);
  }
  return out;
}

/** PDF → ページごとの画像 (色付きの PNG か JPEG、gray なら差を測るための灰色の PNG)。ファイルの名前の並び */
function raster(pdf, dir, prefix, kind = jpeg ? 'jpeg' : 'png') {
  fs.mkdirSync(dir, { recursive: true });
  const ext = kind === 'jpeg' ? 'jpg' : 'png';
  const mine = (f) => f.startsWith(prefix + '-') && new RegExp(`^\\d+\\.${ext}$`).test(f.slice(prefix.length + 1));
  for (const f of fs.readdirSync(dir).filter(mine)) fs.unlinkSync(path.join(dir, f));
  const opt = kind === 'jpeg' ? ['-jpeg', '-jpegopt', 'quality=85'] : kind === 'gray' ? ['-gray', '-png'] : ['-png'];
  execFileSync('pdftoppm', ['-r', String(dpi), ...opt, pdf, path.join(dir, prefix)], { stdio: ['ignore', 'ignore', 'ignore'] });
  return fs
    .readdirSync(dir)
    .filter(mine)
    .sort((a, b) => parseInt(a.slice(prefix.length + 1), 10) - parseInt(b.slice(prefix.length + 1), 10));
}

const lum = (img, x, y) => {
  if (x >= img.width || y >= img.height) return 255;
  const i = (y * img.width + x) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
};

/** 差の画像の色: 0〜7 は同じ所の灰色 (白から薄い灰色)、8 は青 (見本にだけ)、9 は赤 (Kumiori にだけ) */
const PALETTE = [...Array.from({ length: 8 }, (_, k) => Math.round(255 - k * 10)).map((v) => [v, v, v]), [30, 90, 230], [230, 40, 40]];

/** 色の番号の並びを、パレットの PNG にする (色の数が少ないので小さい) */
function palettePng(w, h, idx) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 色の深さ
  ihdr[9] = 3; // パレット
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    idx.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(PALETTE.flat())),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 差の画像 (青: 見本にだけ、赤: Kumiori にだけ、灰: 両方) と、差の割合 */
function diffImage(a, b) {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const idx = Buffer.alloc(w * h);
  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = lum(a, x, y);
      const pb = lum(b, x, y);
      if (Math.abs(pa - pb) > 64) {
        bad++;
        idx[y * w + x] = pa < pb ? 8 : 9;
      } else {
        // 同じ所は薄い灰色 (どちらも白なら白)
        idx[y * w + x] = Math.min(7, Math.round(((255 - Math.min(pa, pb)) / 255) * 7));
      }
    }
  }
  return { png: palettePng(w, h, idx), ratio: bad / (w * h) };
}

fs.mkdirSync(outDir, { recursive: true });
const imgDir = path.join(outDir, 'img');
const samples = [];
for (const [name, refPdf, kPdf] of pairs()) {
  const dir = path.join(imgDir, name);
  const ref = raster(refPdf, dir, 'ref');
  const km = raster(kPdf, dir, 'kumiori');
  // 差は灰色の PNG で測る (JPEG のときも同じ)
  const refG = raster(refPdf, dir, 'gref', 'gray');
  const kmG = raster(kPdf, dir, 'gkumiori', 'gray');
  const n = Math.max(ref.length, km.length);
  const pages = [];
  for (let k = 0; k < n; k++) {
    const page = { ref: ref[k] ? `img/${name}/${ref[k]}` : null, kumiori: km[k] ? `img/${name}/${km[k]}` : null, diff: null, ratio: 1 };
    if (refG[k] && kmG[k]) {
      const a = PNG.sync.read(fs.readFileSync(path.join(dir, refG[k])));
      const b = PNG.sync.read(fs.readFileSync(path.join(dir, kmG[k])));
      const d = diffImage(a, b);
      // --artifact では差の画像を書き出さない (ブラウザで描く)
      if (!artifact) {
        const f = `diff-${k + 1}.png`;
        fs.writeFileSync(path.join(dir, f), d.png);
        page.diff = `img/${name}/${f}`;
      }
      page.ratio = d.ratio;
    }
    pages.push(page);
  }
  for (const f of [...refG, ...kmG]) fs.unlinkSync(path.join(dir, f));
  const score = pages.reduce((a, p) => a + p.ratio, 0) / Math.max(n, 1);
  samples.push({ name, refPages: ref.length, kumioriPages: km.length, score, pages });
  console.log(`${name}: 見本 ${ref.length} / Kumiori ${km.length} ページ, 差 ${(score * 100).toFixed(1)}%`);
}
samples.sort((a, b) => b.score - a.score);

if (inline) {
  const dataUri = (rel) => (rel ? `data:image/${/\.jpg$/.test(rel) ? 'jpeg' : 'png'};base64,` + fs.readFileSync(path.join(outDir, rel)).toString('base64') : null);
  for (const s of samples) for (const p of s.pages) for (const k of ['ref', 'kumiori', 'diff']) p[k] = dataUri(p[k]);
}

const head = `<title>Kumiori 見本比較</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
  /* 左に見本の一覧、右に選んだ見本のページ。狭い画面では一覧を上に重ねる */
  :root {
    --bg: #f3f4f6; --panel: #ffffff; --ink: #1f2430; --sub: #5d6473; --line: #d9dce3;
    --accent: #2a5bd7; --accent-ink: #ffffff; --hover: #eef2fb; --sel: #e1e8fb; --bad: #c62828; --paper: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14161b; --panel: #1c1f26; --ink: #e6e8ee; --sub: #9aa1b0; --line: #2f3440;
      --accent: #7aa2ff; --accent-ink: #10131a; --hover: #232835; --sel: #2a3350; --bad: #ff7b72; --paper: #ffffff;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14161b; --panel: #1c1f26; --ink: #e6e8ee; --sub: #9aa1b0; --line: #2f3440;
    --accent: #7aa2ff; --accent-ink: #10131a; --hover: #232835; --sel: #2a3350; --bad: #ff7b72; --paper: #ffffff;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; color: var(--ink); background: var(--bg); display: grid; grid-template-columns: 280px minmax(0, 1fr); }
  aside { border-right: 1px solid var(--line); background: var(--panel); overflow: auto; min-height: 0; padding-left: env(safe-area-inset-left, 0px); }
  aside h1 { font-size: 15px; margin: 12px; text-wrap: balance; }
  aside .legend { font-size: 12px; color: var(--sub); margin: 0 12px 8px; line-height: 1.6; }
  aside input { width: calc(100% - 24px); margin: 0 12px 8px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; background: var(--bg); color: var(--ink); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 7px 12px; border-top: 1px solid var(--line); cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  li:hover { background: var(--hover); }
  li.on { background: var(--sel); }
  li span:first-child { min-width: 0; overflow-wrap: anywhere; }
  li .s { font-variant-numeric: tabular-nums; color: var(--sub); white-space: nowrap; }
  li .s.mis { color: var(--bad); font-weight: 600; }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding-right: env(safe-area-inset-right, 0px); }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header .title { font-weight: 600; overflow-wrap: anywhere; }
  header .info { color: var(--sub); font-size: 13px; font-variant-numeric: tabular-nums; }
  .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: var(--panel); color: var(--ink); padding: 5px 10px; font: inherit; font-size: 13px; cursor: pointer; font-variant-numeric: tabular-nums; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--accent); color: var(--accent-ink); }
  /* ページの切り替え: 前・次のボタンとページの一覧 (ページが多くても 1 行に収める) */
  .pager { display: inline-flex; align-items: stretch; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .pager button, .pager select { border: 0; background: var(--panel); color: var(--ink); font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; }
  .pager button { padding: 5px 10px; cursor: pointer; }
  .pager button:disabled { color: var(--sub); cursor: default; opacity: 0.5; }
  .pager select { padding: 5px 6px; border-left: 1px solid var(--line); border-right: 1px solid var(--line); max-width: 13em; }
  .pager #worst { border-left: 1px solid var(--line); }
  select:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button:focus-visible, input:focus-visible, li:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  label { font-size: 13px; color: var(--sub); display: inline-flex; align-items: center; gap: 6px; }
  .view { flex: 1; overflow: auto; padding: 16px; min-height: 0; }
  .pair { display: flex; gap: 16px; align-items: flex-start; }
  figure { margin: 0; flex: 1; min-width: 0; }
  figcaption { font-size: 12px; color: var(--sub); margin-bottom: 4px; }
  figure img, figure canvas, .stack img, .single canvas { width: 100%; height: auto; display: block; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
  .zoom-actual figure img, .zoom-actual .stack img, .zoom-actual .single canvas { width: auto; max-width: none; }
  .stack { position: relative; display: inline-block; max-width: 100%; }
  .stack img + img { position: absolute; left: 0; top: 0; }
  .single { max-width: 1100px; margin: 0 auto; }
  .zoom-actual .single { max-width: none; }
  .missing { padding: 40px; text-align: center; color: var(--bad); background: var(--panel); box-shadow: 0 0 0 1px var(--line); }
  .key { font-size: 12px; color: var(--sub); }
  @media (max-width: 720px) {
    body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    aside { max-height: 34vh; border-right: 0; border-bottom: 1px solid var(--line); padding-right: env(safe-area-inset-right, 0px); }
    main { padding-left: env(safe-area-inset-left, 0px); }
    .pair { flex-direction: column; }
    .key { display: none; }
  }
</style>`;

const body = `<aside>
  <h1>Kumiori 見本比較</h1>
  <p class="legend">差の大きい順。数字は、輝度の差が大きい画素の割合。<br>赤い数字はページ数が違うもの (見本/Kumiori)。</p>
  <input id="filter" placeholder="名前で絞り込む" aria-label="名前で絞り込む">
  <ul id="list"></ul>
</aside>
<main>
  <header>
    <span class="title" id="title"></span>
    <span class="info" id="info"></span>
    <span class="pager"><button id="prev" title="前のページ (←)" aria-label="前のページ">‹</button><select id="pageSel" aria-label="ページ"></select><button id="next" title="次のページ (→)" aria-label="次のページ">›</button><button id="worst" title="この見本で差がいちばん大きいページへ">差の最大</button></span>
    <span class="seg" id="modes">
      <button data-m="side">並べる</button><button data-m="overlay">重ねる</button><button data-m="blink">点滅</button><button data-m="diff">差</button>
    </span>
    <label id="opacityBox">Kumiori の不透明度 <input type="range" id="opacity" min="0" max="100" value="50"></label>
    <label><input type="checkbox" id="actual"> 実寸 (${dpi} dpi)</label>
    <span class="key">← → ページ ・ ↑ ↓ 見本 ・ 1〜4 見え方</span>
  </header>
  <div class="view" id="view"></div>
</main>
<script id="data" type="application/json">${JSON.stringify(samples).replace(/</g, '\\u003c')}</script>
<script>
const samples = JSON.parse(document.getElementById('data').textContent);
const state = { s: 0, p: 0, mode: ${JSON.stringify(initialMode)}, opacity: 50 };
// 見ていた見本・ページ・見え方を覚えておく (ブラウザの保存領域。使えなければ覚えない)
const SAVE_KEY = 'compare-view:' + location.pathname;
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved) {
    const i = samples.findIndex((x) => x.name === saved.name);
    if (i >= 0) { state.s = i; state.p = Math.min(Math.max(saved.p | 0, 0), samples[i].pages.length - 1); }
    if (['side', 'overlay', 'blink', 'diff'].includes(saved.mode)) state.mode = saved.mode;
    if (typeof saved.opacity === 'number') state.opacity = saved.opacity;
  }
} catch {}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ name: samples[state.s]?.name, p: state.p, mode: state.mode, opacity: state.opacity })); } catch {}
}
let blinkTimer;
let drawSeq = 0;
const $ = (id) => document.getElementById(id);
const pct = (x) => (x * 100).toFixed(1) + '%';
function visible() {
  const q = $('filter').value.trim().toLowerCase();
  return samples.map((s, i) => i).filter((i) => !q || samples[i].name.toLowerCase().includes(q));
}
function renderList() {
  $('list').innerHTML = '';
  for (const i of visible()) {
    const s = samples[i];
    const li = document.createElement('li');
    li.className = i === state.s ? 'on' : '';
    li.tabIndex = 0;
    const mis = s.refPages !== s.kumioriPages;
    li.innerHTML = '<span></span><span class="s' + (mis ? ' mis' : '') + '"></span>';
    li.children[0].textContent = s.name;
    li.children[1].textContent = pct(s.score) + (mis ? ' (' + s.refPages + '/' + s.kumioriPages + ')' : '');
    li.onclick = () => { state.s = i; state.p = 0; render(); };
    li.onkeydown = (e) => { if (e.key === 'Enter') li.onclick(); };
    $('list').append(li);
  }
}
function img(src, alt) {
  if (!src) { const d = document.createElement('div'); d.className = 'missing'; d.textContent = alt + ' のページがありません'; return d; }
  const e = document.createElement('img'); e.src = src; e.alt = alt; return e;
}
/** 差の画像をブラウザで描く (compare-view の差と同じ: 輝度の差が 64 を超える画素を、青 (見本にだけ)・赤 (Kumiori にだけ) にする) */
function load(src) {
  return new Promise((ok, ng) => { const e = new Image(); e.onload = () => ok(e); e.onerror = ng; e.src = src; });
}
async function diffCanvas(refSrc, kSrc) {
  const [a, b] = await Promise.all([load(refSrc), load(kSrc)]);
  const w = Math.max(a.naturalWidth, b.naturalWidth);
  const h = Math.max(a.naturalHeight, b.naturalHeight);
  const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0); return g.getImageData(0, 0, w, h).data; };
  const da = px(a);
  const db = px(b);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  const id = g.createImageData(w, h);
  const o = id.data;
  for (let i = 0; i < da.length; i += 4) {
    const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2];
    const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2];
    let r, gg, bb;
    if (Math.abs(la - lb) > 64) { if (la < lb) { r = 30; gg = 90; bb = 230; } else { r = 230; gg = 40; bb = 40; } }
    else { const v = 255 - Math.min(7, Math.round(((255 - Math.min(la, lb)) / 255) * 7)) * 10; r = gg = bb = v; }
    o[i] = r; o[i + 1] = gg; o[i + 2] = bb; o[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return out;
}
function render() {
  clearInterval(blinkTimer);
  save();
  const seq = ++drawSeq;
  const s = samples[state.s];
  if (!s) { $('view').textContent = '比べる PDF がありません'; return; }
  const p = s.pages[state.p];
  $('title').textContent = s.name;
  $('info').textContent = '見本 ' + s.refPages + ' / Kumiori ' + s.kumioriPages + ' ページ ・ 全体の差 ' + pct(s.score) + ' ・ このページの差 ' + pct(p.ratio);
  const sel = $('pageSel');
  sel.innerHTML = '';
  s.pages.forEach((q, k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = (k + 1) + ' / ' + s.pages.length + ' ・ 差 ' + pct(q.ratio);
    sel.append(o);
  });
  sel.value = state.p;
  $('prev').disabled = state.p <= 0;
  $('next').disabled = state.p >= s.pages.length - 1;
  for (const b of $('modes').children) b.className = b.dataset.m === state.mode ? 'on' : '';
  $('opacityBox').hidden = state.mode !== 'overlay';
  const v = $('view');
  v.innerHTML = '';
  v.className = 'view' + ($('actual').checked ? ' zoom-actual' : '');
  if (state.mode === 'side') {
    const pair = document.createElement('div'); pair.className = 'pair';
    for (const [src, cap] of [[p.ref, '見本'], [p.kumiori, 'Kumiori']]) {
      const f = document.createElement('figure');
      const c = document.createElement('figcaption'); c.textContent = cap;
      f.append(c, img(src, cap));
      pair.append(f);
    }
    v.append(pair);
  } else {
    const wrap = document.createElement('div'); wrap.className = 'single';
    const cap = document.createElement('figcaption');
    wrap.append(cap);
    if (state.mode === 'diff') {
      cap.textContent = '差: 青は見本にだけ、赤は Kumiori にだけ字や線がある所';
      if (p.diff) wrap.append(img(p.diff, '差の画像'));
      else if (!p.ref || !p.kumiori) wrap.append(img(null, p.ref ? 'Kumiori' : '見本'));
      else {
        const note = document.createElement('p'); note.className = 'key'; note.textContent = '差の画像を描いています…';
        wrap.append(note);
        diffCanvas(p.ref, p.kumiori).then((c) => { if (seq === drawSeq) note.replaceWith(c); }).catch(() => { note.textContent = '差の画像を描けませんでした'; });
      }
    } else if (!p.ref || !p.kumiori) {
      cap.textContent = '';
      wrap.append(img(p.ref, '見本'), img(p.kumiori, 'Kumiori'));
    } else {
      const st = document.createElement('div'); st.className = 'stack';
      const a = img(p.ref, '見本'); const b = img(p.kumiori, 'Kumiori');
      st.append(a, b);
      wrap.append(st);
      if (state.mode === 'overlay') {
        cap.textContent = '重ねる: 下が見本、上が Kumiori (不透明度 ' + state.opacity + '%)';
        b.style.opacity = state.opacity / 100;
      } else {
        let showK = false;
        const tick = () => { showK = !showK; b.style.opacity = showK ? 1 : 0; cap.textContent = '点滅: いま ' + (showK ? 'Kumiori' : '見本'); };
        tick();
        blinkTimer = setInterval(tick, 700);
      }
    }
    v.append(wrap);
  }
  renderList();
}
$('pageSel').onchange = (e) => { state.p = +e.target.value; render(); };
$('prev').onclick = () => { if (state.p > 0) { state.p--; render(); } };
$('next').onclick = () => { const s = samples[state.s]; if (s && state.p < s.pages.length - 1) { state.p++; render(); } };
$('worst').onclick = () => { const s = samples[state.s]; if (!s) return; let k = 0; s.pages.forEach((q, i) => { if (q.ratio > s.pages[k].ratio) k = i; }); state.p = k; render(); };
$('modes').onclick = (e) => { const m = e.target.dataset?.m; if (m) { state.mode = m; render(); } };
$('opacity').oninput = (e) => { state.opacity = +e.target.value; render(); };
$('actual').onchange = render;
$('filter').oninput = renderList;
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range')) return;
  const s = samples[state.s];
  const vis = visible();
  const at = vis.indexOf(state.s);
  if (e.key === 'ArrowRight' && s && state.p < s.pages.length - 1) state.p++;
  else if (e.key === 'ArrowLeft' && state.p > 0) state.p--;
  else if (e.key === 'ArrowDown' && at < vis.length - 1) { state.s = vis[at + 1]; state.p = 0; }
  else if (e.key === 'ArrowUp' && at > 0) { state.s = vis[at - 1]; state.p = 0; }
  else if (['1', '2', '3', '4'].includes(e.key)) state.mode = ['side', 'overlay', 'blink', 'diff'][+e.key - 1];
  else return;
  e.preventDefault();
  render();
});
$('opacity').value = state.opacity;
render();
</script>`;

// --artifact: 公開のときに <html>・<head>・<body> が付くので、中身だけを書く
const html = artifact
  ? `${head}\n${body}\n`
  : `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
if (inline) fs.rmSync(imgDir, { recursive: true, force: true });
console.log(`\n${samples.length} 点を比べました: ${path.join(outDir, 'index.html')}`);
