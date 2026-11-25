#!/usr/bin/env node
/**
 * measure-png-embed — α 付き PNG の多い文書を PDF にする時間を、Node と、Chromium の Web Worker の中で測る。
 * α 付き PNG を PDF に入れる処理を、(a) 展開・(b) フィルタを戻す/RGB と α を分ける・(c) 画素の圧縮・(d) そのほか (PDF の書き手・書体など) の
 * 4 つに分けて出す (docs/development.md の「画像の埋め込みの時間の測り」)。
 *
 * 使い方 (リポジトリの直下で):
 *   NODE_USE_ENV_PROXY=1 node scripts/measure-png-embed.mjs [--env node|worker]... [--pages 197] [--images 333] [--runs 2]
 *                                                        [--src <Kumiori のチェックアウト>] [--no-build] [--json <file>]
 *
 *  - --env: 測る所 (何度でも)。node (Node のプロセス) と worker (Playwright の Chromium の Web Worker)。既定は両方
 *  - --pages・--images: 試しの文書のページの数と画像の数 (既定は 197 ページ・333 枚。画像は 1600×1000 の 8 ビット RGBA の PNG で、1 枚 165KB ほど、
 *    333 枚で 55MB ほど。画面の写しに似せた絵 (字のような点の並び・色の面・グラデーション・角の透明)。作った画像は .cache/measure-png-embed/images に置く)
 *  - --runs: 組んで PDF にする回数 (既定 2。各回の最も速いものを出す)
 *  - --src: 測る Kumiori のチェックアウト (既定はこのリポジトリ)。直す前のコミットと比べるときは、git worktree で取り出した所を渡す
 *    (node_modules は、このリポジトリのものへのリンクでよい)
 *  - --no-build: 前に作ったビルド (.cache/measure-png-embed/<src の名前>) を使う
 *  - NODE_USE_ENV_PROXY=1: 既定の書体を取りに行くとき、プロキシを通す環境で付ける (Node の書体の置き場 .cache/fonts と、
 *    Worker の書体の置き場 .cache/measure-png-embed/fonts-web に覚えるので、2 回目からは取りに行かない)
 *
 * Chromium は、環境変数 KUMIORI_CHROMIUM が指すもの (scripts/chromium.mjs)。
 * 4 つの分け方: (a)〜(c) は、同じ画像の全部を、埋め込みと同じ関数で 1 枚ずつ処理して足した時間 (scripts/measure-png-embed-lib.mjs の measureStages)。
 * (d) は、toPdf の時間から (a)〜(c) を引いたもの (PDF の書き手・ページの中身・書体の埋め込み・画像の辞書など)。
 * 全体の時間は、利用者と同じ流れ (createTypesetter → typeset → toPdf({ title, date, onProgress }))。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bookHtml, measureStages, measureTypeset } from './measure-png-embed-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'measure-png-embed');
const requireCjs = createRequire(path.join(root, 'package.json'));

/** Worker のスクリプト: 画像を取り、4 つに分けて測ってから、利用者と同じ流れで組んで PDF にする */
const WORKER = `
self.onmessage = async (e) => {
  try {
    const { pages, images, runs } = e.data;
    const k = await import('/b/bundle.js');
    const files = await Promise.all(Array.from({ length: images }, async (_, i) => ({ name: 'img' + i + '.png', data: new Uint8Array(await (await fetch('/img/img' + i + '.png')).arrayBuffer()) })));
    const stages = await k.measureStages({ pixels: k.pixels, inflateFast: k.inflateFast, imageDeflate: k.imageDeflate }, files.map((f) => f.data));
    let best;
    for (let i = 0; i < runs; i++) {
      const r = await k.measureTypeset(k, {}, k.bookHtml(pages, images), files);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', r.pdf));
      r.pdfSha1 = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
      delete r.pdf;
      if (!best || r.totalMs < best.totalMs) best = r;
    }
    self.postMessage({ stages, ...best });
  } catch (err) {
    self.postMessage({ error: String((err && err.stack) || err) });
  }
};
`;

// ── 子のプロセス (Node で測る)
if (process.argv[2] === '--child') {
  const [, , , buildDir, imgDir, pages, images, runs] = process.argv;
  const imp = (f) => import(pathToFileURL(path.join(buildDir, f)).href);
  const [api, node, pixels, inflateFast, imageDeflate] = await Promise.all(['index.js', 'node.js', 'pixels.js', 'inflateFast.js', 'imageDeflate.js'].map(imp));
  const files = readImages(imgDir, Number(images));
  const stages = await measureStages({ pixels, inflateFast, imageDeflate }, files.map((f) => f.data));
  const setup = { loadFont: node.createFontLoader({ cacheDir: path.join(root, '.cache', 'fonts'), log: () => {} }) };
  const best = await bestOf(Number(runs), () => measureTypeset(api, setup, bookHtml(Number(pages), Number(images)), files));
  console.log(JSON.stringify({ stages, ...best }));
  process.exit(0);
}

const args = { envs: [], pages: 197, images: 333, runs: 2, src: root, build: true, json: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--env') args.envs.push(process.argv[++i]);
  else if (a === '--pages') args.pages = Number(process.argv[++i]);
  else if (a === '--images') args.images = Number(process.argv[++i]);
  else if (a === '--runs') args.runs = Number(process.argv[++i]);
  else if (a === '--src') args.src = path.resolve(process.argv[++i]);
  else if (a === '--no-build') args.build = false;
  else if (a === '--json') args.json = process.argv[++i];
  else usage(`知らない引数: ${a}`);
}
if (!args.envs.length) args.envs = ['node', 'worker'];
for (const e of args.envs) if (e !== 'node' && e !== 'worker') usage(`知らない所: ${e} (node・worker)`);
if (!(args.pages > 0 && args.images > 0 && args.runs > 0)) usage('--pages・--images・--runs は 1 以上の数');

function usage(m) {
  console.error(`${m}\n使い方: node scripts/measure-png-embed.mjs [--env node|worker]... [--pages 197] [--images 333] [--runs 2] [--src <dir>] [--no-build] [--json <file>]`);
  process.exit(2);
}

const imgDir = path.join(cache, 'images');
makeImages(imgDir, args.images);
const tag = path.basename(args.src) + '-' + crypto.createHash('sha1').update(args.src).digest('hex').slice(0, 6);
const nodeBuild = path.join(cache, tag, 'node');
const workerBuild = path.join(cache, tag, 'worker');

const out = {};
if (args.envs.includes('node')) {
  if (args.build || !fs.existsSync(path.join(nodeBuild, 'index.js'))) await buildNode(args.src, nodeBuild);
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', fileURLToPath(import.meta.url), '--child', nodeBuild, imgDir, String(args.pages), String(args.images), String(args.runs)], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
  const line = r.stdout.trim().split('\n').pop();
  if (r.status !== 0 || !line?.startsWith('{')) throw new Error(`Node で測れませんでした (終了の値 ${r.status})`);
  out.node = JSON.parse(line);
}
if (args.envs.includes('worker')) {
  if (args.build || !fs.existsSync(path.join(workerBuild, 'bundle.js'))) await buildWorker(args.src, workerBuild);
  out.worker = await runWorker(workerBuild);
}

// 表
const head = ['所', '(a) 展開', '(b) フィルタを戻す・α を分ける', '(c) 画素の圧縮', '(d) そのほか (書き手など)', 'toPdf', '組版', '最初の onProgress まで', '全体', 'ページ', 'PDF (MB)'];
console.log(`\n${args.pages} ページ・${args.images} 枚 (${path.relative(root, args.src) || '.'})\n`);
console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
const s = (ms) => (ms / 1000).toFixed(2);
for (const [env, r] of Object.entries(out)) {
  const st = r.stages;
  const other = r.toPdfMs - st.inflateMs - st.unfilterMs - st.deflateMs;
  console.log(`| ${env} | ${s(st.inflateMs)} | ${s(st.unfilterMs)} | ${s(st.deflateMs)} | ${s(other)} | ${s(r.toPdfMs)} | ${s(r.layoutMs)} | ${s(r.firstProgressMs)} | ${s(r.totalMs)} | ${r.pages} | ${r.pdfMB} |`);
  if (r.imgWarnings?.length) console.log(`  画像の警告: ${r.imgWarnings.slice(0, 3).join(' / ')}`);
}
console.log('\n(秒。(a)〜(c) は画像ごとの処理を足した時間、(d) は toPdf から (a)〜(c) を引いたもの)');
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ pages: args.pages, images: args.images, src: args.src, ...out }, null, 2));

// ── 部品
async function bestOf(n, f) {
  let best;
  for (let i = 0; i < n; i++) {
    const r = await f();
    const { pdf, ...rest } = r;
    rest.pdfSha1 = crypto.createHash('sha1').update(pdf).digest('hex');
    if (!best || rest.totalMs < best.totalMs) best = rest;
  }
  return best;
}

function readImages(dir, n) {
  return Array.from({ length: n }, (_, i) => ({ name: `img${i}.png`, data: new Uint8Array(fs.readFileSync(path.join(dir, `img${i}.png`))) }));
}

/** 試しの画像を作る (無いものだけ) */
function makeImages(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  let made = 0;
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, `img${i}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, screenShot(i));
    made++;
  }
  if (made) console.error(`試しの画像を ${made} 枚作りました (${path.relative(root, dir)})`);
}

/**
 * 画面の写しに似せた 1600×1000 の 8 ビット RGBA の PNG (色の型 6。pngjs で書く。フィルタは pngjs が行ごとに選ぶ)。
 * 見出しの帯・横の欄・字のような点の並び (60 字の 9×12 の字形を並べる)・グラデーションの面、四隅を丸めた透明と半透明の縁 (α が 255 だけでない)
 */
function screenShot(i, W = 1600, H = 1000) {
  const { PNG } = requireCjs('pngjs');
  let seed = ((i + 1) * 2654435761) >>> 0;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const d = png.data;
  const fill = (x0, y0, w, h, c) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++)
      for (let x = x0; x < Math.min(W, x0 + w); x++) {
        const o = (y * W + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
  };
  fill(0, 0, W, H, [240 + (i % 10), 242, 245]);
  fill(0, 0, W, 60, [40 + ((i * 7) % 60), 60, 90]);
  fill(0, 60, 260, H - 60, [225, 228, 232]);
  const glyphs = Array.from({ length: 60 }, () => Array.from({ length: 108 }, () => (rand() < 0.22 ? 50 : 0)));
  for (let y = 90; y < H - 40; y += 38) {
    let x = 290 + Math.floor(rand() * 20);
    const end = 290 + Math.floor((0.3 + rand() * 0.4) * (W - 340));
    while (x + 10 < end) {
      const g = glyphs[Math.floor(rand() * glyphs.length)];
      for (let yy = 0; yy < 12; yy++)
        for (let xx = 0; xx < 9; xx++)
          if (g[yy * 9 + xx]) {
            const o = ((y + yy) * W + x + xx) * 4;
            d[o] = d[o + 1] = d[o + 2] = g[yy * 9 + xx];
          }
      x += rand() < 0.15 ? 16 : 10;
    }
  }
  const px0 = 900 + (i % 5) * 20;
  for (let y = 300; y < 500; y++)
    for (let x = px0; x < px0 + 300; x++) {
      const o = (y * W + x) * 4;
      d[o] = (x * 3 + i) & 255;
      d[o + 1] = (y * 2) & 255;
      d[o + 2] = (((x + y) >> 1) & 255) ^ ((x * 7 + y * 13) % 29 === 0 ? 3 : 0);
    }
  const R = 16;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cx = x < R ? R - x : x >= W - R ? x - (W - R - 1) : 0;
      const cy = y < R ? R - y : y >= H - R ? y - (H - R - 1) : 0;
      if (cx && cy) {
        const r = Math.hypot(cx, cy);
        d[(y * W + x) * 4 + 3] = r > R ? 0 : r > R - 1 ? 128 : 255;
      }
    }
  return PNG.sync.write(png, { colorType: 6 });
}


/** Node 向けのビルド (名前を残し、ソースのファイルごとに分ける。scripts/measure-memory.mjs と同じ作り) */
async function buildNode(src, outDir) {
  const { build } = await import(pathToFileURL(requireCjs.resolve('vite')).href);
  await build({
    configFile: false,
    root: src,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      ssr: true,
      rolldownOptions: {
        input: { index: 'src/index.ts', node: 'src/node.ts', pixels: 'src/pixels.ts', inflateFast: 'src/inflateFast.ts', imageDeflate: 'src/imageDeflate.ts' },
        output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
      },
    },
  });
}

/** Worker 向けのビルド: ブラウザ向けの束 (vite.browser.config.ts) と同じ設定で、Kumiori と測る部品を 1 つの入口にまとめる */
async function buildWorker(src, outDir) {
  const { build } = await import(pathToFileURL(requireCjs.resolve('vite')).href);
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const entry = path.join(path.dirname(outDir), 'worker-entry.mjs');
  const abs = (p) => JSON.stringify(path.join(src, p));
  fs.writeFileSync(
    entry,
    [
      `export * from ${abs('src/index.ts')};`,
      `export * as pixels from ${abs('src/pixels.ts')};`,
      `export * as inflateFast from ${abs('src/inflateFast.ts')};`,
      `export * as imageDeflate from ${abs('src/imageDeflate.ts')};`,
      `export { bookHtml, measureStages, measureTypeset } from ${JSON.stringify(path.join(root, 'scripts', 'measure-png-embed-lib.mjs'))};`,
    ].join('\n'),
  );
  await build({
    configFile: path.join(src, 'vite.browser.config.ts'),
    root: src,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, lib: { entry, formats: ['es'], fileName: () => 'bundle.js' } },
  });
}

/** Chromium の Web Worker の中で測る */
async function runWorker(buildDir) {
  const { chromium } = requireCjs('playwright');
  const { chromiumLaunchOptions } = await import('./chromium.mjs');
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    // crypto.subtle (PDF の SHA-1) は安全な文脈でだけ使えるので https にする (中身は page.route で返す)
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
    const r = await page.evaluate(
      async ({ pages, images, runs }) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        return await new Promise((resolve) => {
          worker.onerror = (e) => resolve({ error: `worker error: ${e.message}` });
          worker.onmessage = (e) => resolve(e.data);
          worker.postMessage({ pages, images, runs });
        });
      },
      { pages: args.pages, images: args.images, runs: args.runs },
    );
    if (r.error) throw new Error(`Worker で測れませんでした: ${r.error}`);
    return r;
  } finally {
    await browser.close();
  }
}
