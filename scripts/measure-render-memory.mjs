#!/usr/bin/env node
/**
 * measure-render-memory — 描画 (renderPage) のメモリと時間を、Chromium の Web Worker の中で、使う側と同じ形で測る
 * (Typesetter を 1 つ作り、組んだ結果を数件持ち、全部のページを renderPage(OffscreenCanvas) で描画する。design/pdf-writer.md の 13)。
 * 描画のためにデコードした画像のキャッシュ (Typesetter 全体で 1 つ。TypesetterOptions.imageCache) の前と後を比べるための道具。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/measure-render-memory.mjs [--src <Kumiori のチェックアウト>] [--pages 197] [--images 333] [--results 2] [--max-bytes <バイト>] [--no-build] [--json <file>]
 *
 *  - 文書は scripts/measure-png-embed.mjs と同じ試しの文書 (1600×1000 の 8 ビット RGBA の PNG。画像は measure-png-embed が .cache/measure-png-embed/images に
 *    作ったもの。先に node scripts/measure-png-embed.mjs --env node を 1 度走らせる)
 *  - --results: 持つ結果の数 (同じ文書を、その数だけ組む。既定 2)。--max-bytes: 画像のキャッシュの上限 (後のコミットだけに効く)
 *  - --src: 測る Kumiori のチェックアウト (既定はこのリポジトリ)。直す前のコミットは git worktree で取り出した所を渡す (node_modules はリンクでよい)
 *
 * 測るもの: Chromium の全部のプロセスの RSS (ps で 100ms ごとに足したもの) の山と、組み終えた所・描画し終えた所の値、Worker の JS のヒープ
 * (performance.memory)、Kumiori の見積もり (結果の memoryUsage().images の和と、Typesetter.memoryUsage() の caches・cacheDetail.images)、
 * 組む時間 (結果ごと) と、全部のページを描画する時間 (1 回目と、同じ結果を描画し直す 2 回目)。Chromium は、環境変数 KUMIORI_CHROMIUM が指すもの (scripts/chromium.mjs)
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'measure-png-embed');
const requireCjs = createRequire(path.join(root, 'package.json'));

const WORKER = `
self.onmessage = async (e) => {
  if (e.data && e.data.ackId !== undefined) return;
  try {
    const { pages, images, results, maxBytes } = e.data;
    const k = await import('/b/bundle.js');
    const files = await Promise.all(Array.from({ length: images }, async (_, i) => ({ name: 'img' + i + '.png', data: new Uint8Array(await (await fetch('/img/img' + i + '.png')).arrayBuffer()) })));
    const mark = (label) => new Promise((done) => {
      const id = Math.random();
      const on = (ev) => { if (ev.data && ev.data.ackId === id) { self.removeEventListener('message', on); done(); } };
      self.addEventListener('message', on);
      self.postMessage({ mark: label, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, id });
    });
    const t = await k.createTypesetter(maxBytes ? { imageCache: { maxBytes } } : {});
    const html = k.bookHtml(pages, images);
    const rs = [];
    const typesetMs = [];
    for (let i = 0; i < results; i++) {
      const t0 = performance.now();
      rs.push(await t.typeset(html, { name: 'book.html', files }));
      typesetMs.push(performance.now() - t0);
    }
    await mark('typeset');
    const canvas = new OffscreenCanvas(1, 1);
    const renderMs = [];
    for (let pass = 0; pass < 2; pass++) {
      const t0 = performance.now();
      for (const r of rs) for (let p = 0; p < r.pageCount; p++) await r.renderPage(canvas, p, { scale: 1, devicePixelRatio: 1 });
      renderMs.push(performance.now() - t0);
      await mark('render' + pass);
    }
    const tu = t.memoryUsage();
    const out = { pages: rs[0].pageCount, typesetMs, renderMs, resultImages: rs.reduce((a, r) => a + r.memoryUsage().images, 0), resultTotal: rs.reduce((a, r) => a + r.memoryUsage().total, 0), caches: tu.caches, cacheImages: tu.cacheDetail ? tu.cacheDetail.images : null };
    self.postMessage({ done: out });
  } catch (err) {
    self.postMessage({ error: String((err && err.stack) || err) });
  }
};
`;

const args = { src: root, pages: 197, images: 333, results: 2, maxBytes: 0, build: true, json: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i];
  if (a === '--src') args.src = path.resolve(v());
  else if (a === '--pages') args.pages = Number(v());
  else if (a === '--images') args.images = Number(v());
  else if (a === '--results') args.results = Number(v());
  else if (a === '--max-bytes') args.maxBytes = Number(v());
  else if (a === '--no-build') args.build = false;
  else if (a === '--json') args.json = v();
  else {
    console.error(`知らない引数: ${a}\n使い方: node scripts/measure-render-memory.mjs [--src <dir>] [--pages 197] [--images 333] [--results 2] [--max-bytes <バイト>] [--no-build] [--json <file>]`);
    process.exit(2);
  }
}
const imgDir = path.join(cache, 'images');
for (let i = 0; i < args.images; i++) if (!fs.existsSync(path.join(imgDir, `img${i}.png`))) throw new Error(`${path.relative(root, imgDir)}/img${i}.png がありません (先に node scripts/measure-png-embed.mjs --env node を走らせる)`);
const tag = path.basename(args.src) + '-' + crypto.createHash('sha1').update(args.src).digest('hex').slice(0, 6);
const buildDir = path.join(cache, tag, 'render-worker');
if (args.build || !fs.existsSync(path.join(buildDir, 'bundle.js'))) await buildWorker(args.src, buildDir);

/** Chromium の全部のプロセスの RSS の和 (MB) */
function chromiumRss() {
  const out = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' });
  let kb = 0;
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && /chrom|headless_shell/i.test(m[2]) && !/measure-render-memory/.test(m[2])) kb += Number(m[1]);
  }
  return kb / 1024;
}

const { chromium } = requireCjs('playwright');
const { chromiumLaunchOptions } = await import('./chromium.mjs');
const base = chromiumRss();
const browser = await chromium.launch({ ...chromiumLaunchOptions(), args: ['--enable-precise-memory-info'] });
const marks = {};
let peak = 0;
const timer = setInterval(() => (peak = Math.max(peak, chromiumRss() - base)), 100);
let result;
try {
  const page = await browser.newPage();
  const origin = 'https://measure.kumiori.invalid';
  const fontDir = path.join(cache, 'fonts-web');
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'fonts.gstatic.com') {
      const file = path.join(fontDir, url.pathname.replace(/^\/+/, '').replace(/[^\w.-]/g, '_'));
      if (!fs.existsSync(file)) {
        const res = await fetch(url);
        if (!res.ok) return route.fulfill({ status: res.status, body: '' });
        fs.mkdirSync(fontDir, { recursive: true });
        fs.writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
      }
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.origin !== origin) return route.fulfill({ status: 404, body: '' });
    if (url.pathname === '/') return route.fulfill({ body: '<!doctype html><title>measure</title>', contentType: 'text/html' });
    if (url.pathname === '/worker.js') return route.fulfill({ body: WORKER, contentType: 'text/javascript' });
    if (url.pathname.startsWith('/img/')) return route.fulfill({ body: fs.readFileSync(path.join(imgDir, path.basename(url.pathname))), contentType: 'image/png' });
    if (url.pathname.startsWith('/b/')) {
      const f = path.join(buildDir, url.pathname.slice(3));
      return fs.existsSync(f) ? route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' }) : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${origin}/`);
  await page.exposeFunction('kumioriMark', (label, heap) => {
    marks[label] = { rssMB: Math.round(chromiumRss() - base), heapMB: Math.round(heap / 1048576) };
  });
  result = await page.evaluate(
    async (data) => {
      const worker = new Worker('/worker.js', { type: 'module' });
      return await new Promise((resolve) => {
        worker.onerror = (e) => resolve({ error: `worker error: ${e.message}` });
        worker.onmessage = async (e) => {
          if (e.data.mark) {
            await window.kumioriMark(e.data.mark, e.data.heap);
            worker.postMessage({ ackId: e.data.id });
          } else resolve(e.data);
        };
        worker.postMessage(data);
      });
    },
    { pages: args.pages, images: args.images, results: args.results, maxBytes: args.maxBytes },
  );
} finally {
  clearInterval(timer);
  await browser.close();
}
if (result.error) throw new Error(result.error);
const r = result.done;
const MB = (n) => (n === null ? '' : Math.round((n / 1048576) * 10) / 10);
const out = {
  src: args.src,
  pages: r.pages,
  results: args.results,
  peakRssMB: Math.round(peak),
  marks,
  typesetSec: r.typesetMs.map((x) => Math.round(x / 100) / 10),
  renderSec: r.renderMs.map((x) => Math.round(x / 100) / 10),
  resultImagesMB: MB(r.resultImages),
  resultTotalMB: MB(r.resultTotal),
  cachesMB: MB(r.caches),
  cacheImagesMB: MB(r.cacheImages),
};
console.log(JSON.stringify(out, null, 2));
if (args.json) fs.writeFileSync(args.json, JSON.stringify(out, null, 2));

/** Worker 向けのビルド: ブラウザ向けの束 (vite.browser.config.ts) と同じ設定で、Kumiori と試しの文書を 1 つの入口にまとめる */
async function buildWorker(src, outDir) {
  const { build } = await import(pathToFileURL(requireCjs.resolve('vite')).href);
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const entry = path.join(path.dirname(outDir), 'render-worker-entry.mjs');
  fs.writeFileSync(entry, [`export * from ${JSON.stringify(path.join(src, 'src/index.ts'))};`, `export { bookHtml } from ${JSON.stringify(path.join(root, 'scripts', 'measure-png-embed-lib.mjs'))};`].join('\n'));
  await build({ configFile: path.join(src, 'vite.browser.config.ts'), root: src, logLevel: 'warn', build: { outDir, emptyOutDir: true, lib: { entry, formats: ['es'], fileName: () => 'bundle.js' } } });
}
