#!/usr/bin/env node
/**
 * measure-memory — PDF を作るときのメモリの山を測る (typesetToPdf と、流して書く typesetToPdfStream を、メモリ節約 (lowMemory) の有り無しで)。
 * PDF を流して書く口 (design/pdf-writer.md の 3.8) が、どの文書でどれだけ山を下げるかを確かめるための道具。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/measure-memory.mjs [--doc <名前>]... [--mode <形>]... [--no-build] [--json <file>]
 *
 *  - --doc: 測る文書 (何度でも)。既定は html-spec・fo-spec・text・images (と、.cache/samples に戻してあれば css-print)
 *      html-spec・fo-spec … 対応仕様説明書の HTML と XSL-FO (scripts/profile-relayout.mjs と同じ読み方)
 *      css-print          … 『CSSページ組版入門』第 4 版 (.cache/samples/css-print/src。--style ah)
 *      text[:<節の数>]    … 文だけの文書 (作る。既定 6,000 節で 860 ページほど。11,200 節で 1,600 ページほど)
 *      images[:<枚数>]    … 画像の多い文書 (作る。圧縮の効かない 600×600 の PNG。既定 200 枚)
 *  - --mode: 測る形 (何度でも)。pdf (typesetToPdf)・stream (typesetToPdfStream。書き出し先は fs.writeSync)・pdf-low・stream-low (メモリ節約)。既定は 4 つとも
 *  - --no-build: 前に作ったビルド (.cache/measure-memory-build) を使う
 *
 * 測り方: 文書と形ごとに、新しい Node のプロセス (--expose-gc) で組む。組む前に片付け (gc) てから、20ms ごとと進み具合の呼び返しのたびに
 * process.memoryUsage() を見て、JS のヒープ (heapUsed)・外のバイト列 (arrayBuffers)・RSS の山と、PDF を書く間 (進み具合の phase が 'pdf' になってから) の
 * ヒープの山と、PDF を書く間の生きている量 (PDF を書き始めた所 (組版を終えた所) と、書く間に 20 回ほど、片付けてから見た量。
 * ヒープの山は片付けの時機で揺れるので、流すか流さないかの比べには、こちらを使う) を出す。進み具合の呼び返しを渡すので、組版はページと page-sequence の間で間をあける (どの形も同じ)。
 * 組版の途中の同期の所 (1 つの page-sequence を組む間) は、20ms ごとの見張りが動かないので、山は少し低めに出ることがある。
 * 時間は、組み始めから PDF を書き終えるまでの壁の時計の時間。
 *
 * docs/development.md の「メモリの山の測り」に使い方と、測った値の読み方を書いてある。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.cache', 'measure-memory-build');
const MODES = ['pdf', 'stream', 'pdf-low', 'stream-low'];

// ── 子のプロセス: 1 つの文書を 1 つの形で組んで、測った値を JSON で書く
if (process.argv[2] === '--child') {
  const [, , , name, mode] = process.argv;
  const lib = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
  const { createFontLoader } = await import(pathToFileURL(path.join(outDir, 'node.js')).href);
  const d = await loadDoc(name);
  const loadFont = createFontLoader({ cacheDir: fontDir(), log: () => {} });
  const ts = await lib.createTypesetter({ loadFont, ...d.setup, reuse: false });
  globalThis.gc();
  const base = process.memoryUsage();
  const peak = { heap: base.heapUsed, buffers: base.arrayBuffers, rss: base.rss, pdfHeap: 0, pdfBuffers: 0, live: 0, liveBuffers: 0 };
  let inPdf = false;
  /** 進み具合の段ごとの、外のバイト列の山 (どこで山になるかを見る) */
  let phase = 'start';
  const byPhase = {};
  const sample = () => {
    const m = process.memoryUsage();
    byPhase[phase] = Math.max(byPhase[phase] ?? 0, m.arrayBuffers);
    peak.heap = Math.max(peak.heap, m.heapUsed);
    peak.buffers = Math.max(peak.buffers, m.arrayBuffers);
    peak.rss = Math.max(peak.rss, m.rss);
    if (inPdf) {
      peak.pdfHeap = Math.max(peak.pdfHeap, m.heapUsed);
      peak.pdfBuffers = Math.max(peak.pdfBuffers, m.arrayBuffers);
    }
  };
  const timer = setInterval(sample, 20);
  /** 片付けてから見た量 (生きている量)。PDF を書き始めた所 (組版を終えた所) と、PDF を書く間に 20 回ほど */
  const live = () => {
    globalThis.gc();
    const m = process.memoryUsage();
    peak.live = Math.max(peak.live, m.heapUsed);
    peak.liveBuffers = Math.max(peak.liveBuffers, m.arrayBuffers);
  };
  const onProgress = (p) => {
    phase = p.phase;
    if (p.phase === 'pdf') {
      const step = Math.max(1, Math.ceil((p.total ?? 100) / 20));
      if (!inPdf || (p.pages ?? 0) % step === 0) {
        sample();
        live();
      }
      inPdf = true;
    }
    sample();
  };
  const options = { ...d.options, onProgress };
  const pdfOpts = { date: new Date(Date.UTC(2024, 0, 1)), ...(mode.endsWith('-low') ? { lowMemory: true } : {}) };
  const t0 = performance.now();
  let bytes;
  let pages;
  if (mode.startsWith('stream')) {
    const file = path.join(os.tmpdir(), `kumiori-measure-${process.pid}.pdf`);
    const fd = fs.openSync(file, 'w');
    try {
      const r = await ts.typesetToPdfStream(d.text, options, (c) => {
        for (let at = 0; at < c.length; ) at += fs.writeSync(fd, c, at);
      }, pdfOpts);
      bytes = r.bytes;
      pages = r.pageCount;
    } finally {
      fs.closeSync(fd);
      fs.rmSync(file, { force: true });
    }
  } else {
    const r = await ts.typesetToPdf(d.text, options, pdfOpts);
    bytes = r.pdf.length;
    pages = r.pageCount;
  }
  const ms = performance.now() - t0;
  phase = 'end';
  sample();
  clearInterval(timer);
  const MB = (n) => Math.round((n / 1048576) * 10) / 10;
  process.stdout.write(JSON.stringify({ doc: name, mode, pages, pdfMB: MB(bytes), heapMB: MB(peak.heap), buffersMB: MB(peak.buffers), rssMB: MB(peak.rss), pdfHeapMB: MB(peak.pdfHeap), pdfBuffersMB: MB(peak.pdfBuffers), liveMB: MB(peak.live), liveBuffersMB: MB(peak.liveBuffers), baseHeapMB: MB(base.heapUsed), baseBuffersMB: MB(base.arrayBuffers), seconds: Math.round(ms / 100) / 10, buffersByPhaseMB: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, MB(v)])) }) + '\n');
  process.exit(0);
}

// ── 親のプロセス: ビルドして、文書と形ごとに子のプロセスを走らせ、表にする
const args = { docs: [], modes: [], build: true, json: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i] ?? usage(`${a} に値がありません`);
  if (a === '--doc') args.docs.push(v());
  else if (a === '--mode') args.modes.push(v());
  else if (a === '--no-build') args.build = false;
  else if (a === '--json') args.json = v();
  else usage(`知らない引数: ${a}`);
}
function usage(message) {
  if (message) console.error(message);
  console.error('使い方: node scripts/measure-memory.mjs [--doc <名前>]... [--mode pdf|stream|pdf-low|stream-low]... [--no-build] [--json <file>]');
  process.exit(2);
}
if (!args.docs.length) args.docs = ['html-spec', 'fo-spec', 'text', 'images', ...(fs.existsSync(path.join(root, '.cache', 'samples', 'css-print', 'src')) ? ['css-print'] : [])];
if (!args.modes.length) args.modes = MODES;
for (const m of args.modes) if (!MODES.includes(m)) usage(`知らない形: ${m} (${MODES.join('・')})`);

if (args.build || !fs.existsSync(path.join(outDir, 'index.js'))) {
  // 名前を残し、ソースのファイルごとに分けたビルド (scripts/profile-relayout.mjs と同じ作り)
  const { build } = await import('vite');
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      ssr: true,
      rolldownOptions: { input: { index: 'src/index.ts', node: 'src/node.ts' }, output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' } },
    },
  });
}

const rows = [];
for (const doc of args.docs)
  for (const mode of args.modes) {
    const r = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', fileURLToPath(import.meta.url), '--child', doc, mode], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    const line = r.stdout.trim().split('\n').pop();
    if (r.status !== 0 || !line?.startsWith('{')) {
      console.error(`${doc} ${mode}: 失敗しました\n${r.stderr.slice(-2000)}`);
      rows.push({ doc, mode, failed: true });
      continue;
    }
    const row = JSON.parse(line);
    rows.push(row);
    console.error(`${doc} ${mode}: ${row.pages} ページ・PDF ${row.pdfMB}MB・ヒープの山 ${row.heapMB}MB・外のバイト列の山 ${row.buffersMB}MB・RSS の山 ${row.rssMB}MB・${row.seconds} 秒`);
  }

// 表 (文書ごと)
const head = ['文書', '形', 'ページ', 'PDF (MB)', 'ヒープの山', 'PDF を書く間の生きているヒープの山', '外のバイト列の山', 'PDF を書く間の生きている外のバイト列の山', 'RSS の山', '時間 (秒)'];
console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
for (const r of rows)
  console.log(r.failed ? `| ${r.doc} | ${r.mode} | 失敗 | | | | | | | |` : `| ${r.doc} | ${r.mode} | ${r.pages} | ${r.pdfMB} | ${r.heapMB} | ${r.liveMB} | ${r.buffersMB} | ${r.liveBuffersMB} | ${r.rssMB} | ${r.seconds} |`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 2));

// ── 文書
function fontDir() {
  return process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');
}
function readFiles(dir, rel = '') {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? readFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [{ name: `${rel}${e.name}`, data: new Uint8Array(fs.readFileSync(path.join(dir, e.name))) }]))
    : [];
}

async function loadDoc(name) {
  const [kind, size] = name.split(':');
  if (kind === 'html-spec' || kind === 'fo-spec') {
    const { expand } = await import('./conformance-lib.mjs');
    const { CONFORMANCE_FONTS, ensureConformanceFonts, fontUrlsIn, urlBasename } = await import('./conformance-fonts.mjs');
    const conf = path.join(root, 'docs', 'conformance');
    const fontFiles = await ensureConformanceFonts(fontDir());
    if (kind === 'html-spec') {
      const src = fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.html'), 'utf8');
      const files = [
        { name: 'kumiori-html-css.css', data: fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.css'), 'utf8') },
        ...readFiles(path.join(conf, 'html', 'images'), 'images/'),
        ...fontUrlsIn(src).map((u) => ({ name: `fonts/${urlBasename(u)}`, data: new Uint8Array(fs.readFileSync(fontFiles.get(u))) })),
      ];
      return { text: expand(src, 'html'), setup: {}, options: { files } };
    }
    const src = fs.readFileSync(path.join(conf, 'fo', 'kumiori-xsl-fo.fo'), 'utf8');
    const fonts = CONFORMANCE_FONTS.filter((f) => f.fo).map((f) => ({ name: path.basename(fontFiles.get(f.url)), data: new Uint8Array(fs.readFileSync(fontFiles.get(f.url))) }));
    return { text: expand(src, 'fo'), setup: { fonts }, options: { compat: 'spec', files: readFiles(path.join(conf, 'fo', 'images'), 'images/') } };
  }
  if (kind === 'css-print') {
    const dir = path.join(root, '.cache', 'samples', 'css-print', 'src');
    if (!fs.existsSync(dir)) throw new Error('css-print: .cache/samples/css-print/src がありません (CLAUDE.md の「見本と書体の置き場」の手順で戻す)');
    const text = fs.readFileSync(path.join(dir, 'CSS-Print-ja.html'), 'utf8');
    return { text, setup: {}, options: { style: 'ah', files: readFiles(dir).filter((f) => f.name !== 'CSS-Print-ja.html' && !/LICENSE/i.test(f.name)) } };
  }
  if (kind === 'text') {
    // 文だけの文書: 見出しと段落の節を並べる (6,000 節で 860 ページほど。11,200 節で 1,600 ページほど)
    const n = size ? Number(size) : 6000;
    const para = 'これは、流し書きのメモリを測るための文だけの文書です。同じ文を繰り返して、段落の行を作ります。'.repeat(3);
    const body = Array.from({ length: n }, (_, i) => `<h2>節 ${i + 1}</h2><p>${para}</p>`).join('\n');
    return { text: `<!doctype html><html lang="ja"><head><title>文だけの文書</title></head><body>${body}</body></html>`, setup: {}, options: {} };
  }
  if (kind === 'images') {
    // 画像の多い文書: 圧縮の効かない (乱数の画素の) 600×600 の PNG を、1 ページに 1 枚ずつ
    const { PNG } = await import('pngjs');
    const n = size ? Number(size) : 200;
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    const files = [];
    for (let i = 0; i < n; i++) {
      const png = new PNG({ width: 600, height: 600, colorType: 2 });
      for (let k = 0; k < png.data.length; k++) png.data[k] = k % 4 === 3 ? 255 : rand();
      files.push({ name: `img${i}.png`, data: new Uint8Array(PNG.sync.write(png, { colorType: 2 })) });
    }
    const body = files.map((f, i) => `<section style="break-after: page"><h2>図 ${i + 1}</h2><img src="${f.name}" alt="図 ${i + 1}" style="width: 12cm"></section>`).join('\n');
    return { text: `<!doctype html><html lang="ja"><head><title>画像の多い文書</title></head><body>${body}</body></html>`, setup: {}, options: { files } };
  }
  throw new Error(`知らない文書: ${name}`);
}
