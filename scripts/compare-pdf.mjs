#!/usr/bin/env node
/**
 * compare-pdf — 見本の PDF (参照用に手元に用意した PDF) と、Kumiori の組版結果 (PDF) を自動で比べる (V-01)。
 *
 * 使い方:
 *   node scripts/compare-pdf.mjs --fo <FO のディレクトリ> --ref <見本の PDF のディレクトリ> [--img <画像のディレクトリ>] [--out <出力先>] [--dpi 40]
 *                               [--fonts <書体のディレクトリ>] [--web-fonts <既定の Web フォントのディレクトリ>]
 *   node scripts/compare-pdf.mjs --html <HTML ファイル> --ref <見本の PDF ファイル> [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--out …] [--dpi …] [--fonts …] [--web-fonts …]
 *
 *  - --html: HTML+CSS を比べる。HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像を、画面の「読み込む」で一緒に選んで組む。
 *    --css は使う CSS ファイル (カンマ区切り。HTML から参照されていない CSS は利用者のスタイルシートとして足す)。
 *    --style は既定のスタイル (kumiori / browser / browser-margin / ah / vivliostyle / weasyprint。既定 ah: CSS 2.1 の既定のスタイルシートで組む。
 *    browser-margin はブラウザの既定で body の余白 8px を残す: WeasyPrint と比べるとき)
 *    --css-engine は CSS の解釈 (kumiori: 自前のカスケード (src/cssCascade.ts。既定) / browser: ブラウザの計算値と配置)
 *
 *  - --pdf <PDF ファイル>: 画面で組まず、出来ている PDF を --ref の PDF と比べる (Node のコマンド dist-cli/cli.js の出力など)
 *  - --no-text 1: 字を描かずに比べる (罫線・塗り・画像だけ)。書体の置き換えが差の主な原因の見本で、書体以外の違いを見つけるため。
 *    両方の PDF を pdftocairo で SVG にし、字形の描画 (<use xlink:href="#glyph-…">) を除いてから、Chromium で画像にする
 *  - --compat spec|antenna: XSL-FO の互換モード (画面の「仕様どおりの既定値で組む」。既定 spec)。アンテナハウスの見本と比べるときは antenna。
 *  - --fonts: MS 明朝などの書体 (TTF / OTF / TTC) を、画面の「書体を読み込む」で読み込んでから組む (見本と同じ書体で比べる)。
 *    見本の PDF が書体を埋め込んでいないときは、同じ書体を OS (fontconfig) にも入れておくと pdftoppm が描ける。
 *  - --web-fonts: 既定の Web フォント (Noto Serif JP など) を、ネットワークではなくこのディレクトリから読む (e2e テストと同じファイル名)。
 *
 *  - FO と同じ名前 (拡張子だけ .pdf) の見本の PDF がある FO だけを比べる。
 *  - --ref の古い名前 --ah も受け付ける
 *  - Kumiori は画面 (vite) をヘッドレスの Chromium で開き、トンボ・塗り足し無しで PDF を出力する。
 *  - 両方を pdftoppm (poppler) で同じ解像度の画像にし、ページごとに「色の差が大きい画素の割合」を出す。
 *  - 結果は <出力先>/report.json と report.md (差の大きい順)。見本の FO・PDF はリポジトリに入れない (著作物)。
 *
 * 必要なもの: Chromium (npx playwright install chromium)、pdftoppm (poppler-utils)。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
// 見本の PDF (--ref。古い名前 --ah も受け付ける)
args.ref ??= args.ah;
if ((!args.fo && !args.html && !args.pdf) || !args.ref) {
  console.error('usage: node scripts/compare-pdf.mjs --fo <dir> --ref <dir> [--img <dir>] [--out <dir>] [--dpi 40] [--fonts <dir>] [--web-fonts <dir>]');
  process.exit(1);
}
const outDir = path.resolve(args.out ?? 'compare-pdf-out');
const dpi = Number(args.dpi ?? 40);
fs.mkdirSync(outDir, { recursive: true });
const results = [];
/** --no-text の画像化に使う Chromium (必要になったときに起こす) */
let noTextBrowser;

// --pdf <file>: 画面を使わず、出来ている PDF (Node のコマンド dist-cli/cli.js の出力など) を比べる
if (args.pdf) {
  const name = path.basename(args.pdf).replace(/(\.kumiori)?\.pdf$/i, '');
  await compare(name, args.ref, path.resolve(args.pdf));
  if (noTextBrowser) await noTextBrowser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  process.exit(0);
}

const port = 5175;
// 前の実行のサーバーが残っていると、strictPort の起動は失敗し、そのサーバー (別の作業ツリー・古いコードのこともある) で組んでしまう。
// 気付かずに違うコードで比べないよう、ポートが使われていれば止める
try {
  await fetch(`http://127.0.0.1:${port}/`);
  console.error(`ポート ${port} で別のサーバーが動いています。止めてから、やり直してください`);
  process.exit(1);
} catch {
  /* 空いている */
}
// npx の子の vite も一緒に止めるため、プロセスのグループを作って、グループごと止める
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* もう止まっている */
  }
};
process.on('exit', stop);

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) return;
    } catch {
      /* まだ */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite が起動しませんでした');
}

/** PDF → ページごとの画像 (グレー)。字を描かない (--no-text): SVG にして字形の描画を除き、Chromium で画像にする */
async function rasterNoText(pdf, prefix) {
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))?.[1] ?? 0);
  noTextBrowser ??= await chromium.launch();
  const tab = await noTextBrowser.newPage();
  const out = [];
  for (let k = 1; k <= pages; k++) {
    const svgFile = `${prefix}-nt-${k}.svg`;
    execFileSync('pdftocairo', ['-svg', '-f', String(k), '-l', String(k), pdf, svgFile], { stdio: ['ignore', 'ignore', 'ignore'] });
    let svg = fs.readFileSync(svgFile, 'utf8').replace(/<use xlink:href="#glyph-[^"]*"[^>]*\/>/g, '');
    // 大きさ (pt) を、指定の解像度の画素にする
    const m = /<svg[^>]*\swidth="([\d.]+)pt"[^>]*\sheight="([\d.]+)pt"/.exec(svg);
    const w = Math.round(((m ? +m[1] : 595) * dpi) / 72);
    const h = Math.round(((m ? +m[2] : 842) * dpi) / 72);
    svg = svg.replace(/(<svg[^>]*\s)width="[\d.]+pt"/, `$1width="${w}px"`).replace(/(<svg[^>]*\s)height="[\d.]+pt"/, `$1height="${h}px"`);
    await tab.setViewportSize({ width: w, height: h });
    await tab.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    const png = PNG.sync.read(await tab.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
    // 比べるのは 1 つ目の成分 (グレー) なので、輝度にそろえる
    for (let i = 0; i < png.data.length; i += 4) {
      const g = Math.round(0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
      png.data[i] = png.data[i + 1] = png.data[i + 2] = g;
    }
    out.push(png);
    fs.unlinkSync(svgFile);
  }
  await tab.close();
  return out;
}

/** PDF → ページごとの PNG (グレー) */
function raster(pdf, prefix) {
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  const mine = (f) => f.startsWith(base + '-') && /^\d+\.png$/.test(f.slice(base.length + 1));
  // 前の実行の画像が残っていると、ページ数を多く数えてしまうので消す
  for (const f of fs.readdirSync(dir).filter(mine)) fs.unlinkSync(path.join(dir, f));
  // 書体の警告などが大量に出ることがあるので、標準エラーは捨てる
  execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-png', pdf, prefix], { stdio: ['ignore', 'ignore', 'ignore'] });
  return fs
    .readdirSync(dir)
    .filter(mine)
    .sort((a, b) => parseInt(a.slice(base.length + 1), 10) - parseInt(b.slice(base.length + 1), 10))
    .map((f) => PNG.sync.read(fs.readFileSync(path.join(dir, f))));
}

/** 2 枚の画像の差: 輝度の差が 64 を超える画素の割合 (大きさが違えば、重なる範囲で比べ、はみ出しは差に数える) */
function diff(a, b) {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = x < a.width && y < a.height ? a.data[(y * a.width + x) * 4] : 255;
      const pb = x < b.width && y < b.height ? b.data[(y * b.width + x) * 4] : 255;
      if (Math.abs(pa - pb) > 64) bad++;
    }
  }
  return bad / (w * h);
}

await waitServer();
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
if (args['web-fonts']) {
  // 既定の Web フォントを手元のファイルから (e2e テストの routeFonts と同じ対応)
  const dir = args['web-fonts'];
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/')
      ? u.includes('buE1') ? 'tinos700.ttf' : 'tinos400.ttf'
      : u.includes('/arimo/')
        ? u.includes('CstsBw') ? 'arimo700.ttf' : 'arimo400.ttf'
        : u.includes('notoserifjp') ? (u.includes('zWPebA') && fs.existsSync(path.join(dir, 'notoserif700.ttf')) ? 'notoserif700.ttf' : 'notoserif.ttf') : u.includes('notosanssymbols2') && fs.existsSync(path.join(dir, 'notosanssymbols2.ttf')) ? 'notosanssymbols2.ttf' : u.includes('VFPYk75s') ? 'notosans700.ttf' : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
}
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('html[data-ready="1"]', { timeout: 180_000 });
if (args.fonts) {
  // 書体を画面の「書体を読み込む」で読み込む (読み込み終わると「書体を消す」ボタンが出る)
  const files = fs.readdirSync(args.fonts).filter((f) => /\.(ttf|otf|ttc)$/i.test(f)).map((f) => path.join(args.fonts, f));
  await page.setInputFiles('#fontfile', files);
  await page.waitForFunction(() => document.getElementById('clearfonts')?.hidden === false, null, { timeout: 120_000 });
  console.log(`書体を読み込みました: ${files.map((f) => path.basename(f)).join(', ')}`);
}
// 設定の部品 (トンボ・既定のスタイル・CSS の解釈) は、画面の「設定」の引き出しの中にある。
// 閉じたままだと、見えない部品を選べずに時限で落ちるので、先に開く
if (await page.locator('#settings').isHidden()) await page.click('#settingsbtn');
// トンボ・塗り足し無し (見本の PDF と同じ大きさにする)
await page.uncheck('#foprint');
// XSL-FO の互換モード (--compat antenna: 画面の「仕様どおりの既定値で組む」を外す)
if (args.compat !== undefined && args.compat !== 'spec' && args.compat !== 'antenna') throw new Error(`--compat は spec か antenna: ${args.compat}`);
if (args.compat === 'antenna') await page.uncheck('#fospec');
if (args.img) {
  for (const f of fs.readdirSync(args.img)) {
    const b64 = fs.readFileSync(path.join(args.img, f)).toString('base64');
    await page.evaluate(
      async ([name, data]) => {
        const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        await window.__kumiori.assets.addBlob(name, new Blob([bin]));
      },
      [f, b64],
    );
  }
}

/** Kumiori の PDF と見本の PDF (--ref) を画像にして比べ、結果に足す */
async function compare(name, ahPdf, kPdf) {
  const work = path.join(outDir, 'png');
  fs.mkdirSync(work, { recursive: true });
  const toImages = args['no-text'] ? rasterNoText : raster;
  const ah = await toImages(ahPdf, path.join(work, `${name}.ah`));
  const km = await toImages(kPdf, path.join(work, `${name}.kumiori`));
  const n = Math.max(ah.length, km.length);
  const pages = [];
  for (let k = 0; k < n; k++) pages.push(ah[k] && km[k] ? diff(ah[k], km[k]) : 1);
  const score = pages.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  results.push({ name, ahPages: ah.length, kumioriPages: km.length, score, pages });
  console.log(`${name}: 見本 ${ah.length} / Kumiori ${km.length} ページ, 差 ${(score * 100).toFixed(1)}%`);
}

if (args.html) {
  // HTML と、同じディレクトリ以下の CSS・画像を一緒に選ぶ
  const dir = path.dirname(args.html);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  // --css a.css,b.css: 使う CSS をこれだけにする (利用者のスタイルシートを選ぶ。weasyprint -s と同じ)
  const onlyCss = args.css ? new Set(args.css.split(',').map((c) => path.basename(c).toLowerCase())) : undefined;
  // 選んだ CSS が @import する CSS も選ぶ
  for (const name of onlyCss ?? []) {
    const file = walk(dir).find((f) => path.basename(f).toLowerCase() === name);
    if (!file) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) onlyCss.add(path.basename(m[1]).toLowerCase());
  }
  const files = [
    args.html,
    ...walk(dir).filter((f) => f !== args.html && /\.(css|png|jpe?g|gif|svg|webp|bmp|tiff?|otf|ttf)$/i.test(f) && (!onlyCss || !/\.css$/i.test(f) || onlyCss.has(path.basename(f).toLowerCase()))),
  ];
  await page.selectOption('#htmlstyle', args.style ?? 'ah');
  // --css-engine browser: 自前のカスケードの代わりに、ブラウザの計算値と配置で組む
  if (args['css-engine']) await page.selectOption('#cssengine', args['css-engine']);
  const name = path.basename(args.html).replace(/\.x?html?$/i, '');
  await page.setInputFiles('#fofile', files);
  await page.waitForFunction((n) => /ページ/.test(document.getElementById('status')?.textContent ?? '') && (document.getElementById('status')?.textContent ?? '').includes(n), path.basename(args.html), { timeout: 600_000 });
  console.log(await page.textContent('#status'));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click('#download')]);
  const kPdf = path.join(outDir, `${name}.kumiori.pdf`);
  await dl.saveAs(kPdf);
  await compare(name, args.ref, kPdf);
}

for (const f of args.fo ? fs.readdirSync(args.fo).filter((x) => x.endsWith('.fo')).sort() : []) {
  const ahPdf = path.join(args.ref, f.replace(/\.fo$/, '.pdf'));
  if (!fs.existsSync(ahPdf)) continue;
  const name = f.replace(/\.fo$/, '');
  try {
    const text = fs.readFileSync(path.join(args.fo, f), 'utf8');
    await page.evaluate(async ([t, n]) => window.__kumioriLoadFo(t, n), [text, f]);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), page.click('#download')]);
    const kPdf = path.join(outDir, `${name}.kumiori.pdf`);
    await dl.saveAs(kPdf);
    await compare(name, ahPdf, kPdf);
  } catch (e) {
    results.push({ name, error: String(e) });
    console.log(`${name}: エラー ${e}`);
  }
}
await browser.close();
stop();

results.sort((a, b) => (b.score ?? 2) - (a.score ?? 2));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
const md = [
  '| 見本 | ページ数 (見本 / Kumiori) | 差 (平均) | ページごとの差 |',
  '|---|---|---|---|',
  ...results.map((r) =>
    r.error
      ? `| ${r.name} | — | エラー | ${r.error.slice(0, 80)} |`
      : `| ${r.name} | ${r.ahPages} / ${r.kumioriPages}${r.ahPages !== r.kumioriPages ? ' ⚠' : ''} | ${(r.score * 100).toFixed(1)}% | ${r.pages.map((p) => (p * 100).toFixed(0) + '%').join(' ')} |`,
  ),
].join('\n');
fs.writeFileSync(path.join(outDir, 'report.md'), md + '\n');
console.log(`\n${path.join(outDir, 'report.md')} に書き出しました`);
