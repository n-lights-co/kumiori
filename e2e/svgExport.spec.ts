/**
 * ページを SVG・PNG に書き出す (TypesetResult.renderPageToSvg・renderPageToPng) の結合テスト: 書き出した SVG をブラウザで画像として描いたものが、
 * 同じページを画面の Canvas に描いたもの (renderPage) と、画素で見て同じになる。PNG (自前で画素にしたもの) も、その SVG の絵と同じになる。
 * 字 (和文・欧文・太字・斜体)・罫線・角丸の切り抜き・背景・CSS のグラデーション・不透明度・画像 (PNG)・SVG の画像 (グラデーションと字) を並べる。
 * 書体は画面と同じく Google Fonts から取る (KUMIORI_E2E_FONT_DIR・KUMIORI_E2E_FONT_CACHE は app.spec.ts と同じ)
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { routeFontCache } from './fontCache';

/** KUMIORI_E2E_FONT_DIR があれば、Google Fonts の代わりにそのディレクトリの書体を返す (app.spec.ts と同じファイルの名前) */
async function routeFonts(page: Page) {
  await routeFontCache(page);
  const dir = process.env.KUMIORI_E2E_FONT_DIR;
  if (!dir) return;
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/') ? (u.includes('buE1') ? 'tinos700.ttf' : 'tinos400.ttf') : u.includes('/arimo/') ? (u.includes('CstsBw') ? 'arimo700.ttf' : 'arimo400.ttf') : u.includes('notoserifjp') ? (u.includes('zWPebA') && fs.existsSync(path.join(dir, 'notoserif700.ttf')) ? 'notoserif700.ttf' : 'notoserif.ttf') : u.includes('VFPYk75s') ? 'notosans700.ttf' : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
}

test('SVG に書き出したページを、画面の Canvas と同じ絵に描く', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFonts(page);
  await page.goto('/');
  const r = await page.evaluate(async () => {
    // 開発サーバーが返すソースを、そのまま読む (画面と同じ部品)
    const src = (p: string) => import(/* @vite-ignore */ p);
    const { typesetHtml } = (await src('/src/index.ts')) as typeof import('../src/index');
    const { encodePngStored } = (await src('/src/pixels.ts')) as typeof import('../src/pixels');
    // 4×4 の画素の PNG (左上が赤、ほかは青)。大きく引き伸ばしたときの補間の違いが出ないように、4 色の格子にはしない
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) rgba.set(i === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const png = encodePngStored({ width: 4, height: 4, rgba });
    const svgImage =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
      '<rect width="100" height="50" fill="url(#g)"/><circle cx="80" cy="25" r="15" fill="#ffff00" opacity="0.5"/><text x="8" y="34" font-size="20" fill="#ffffff">SVG</text></svg>';
    const html = `<!DOCTYPE html><html lang="ja"><head><style>
      @page { size: 240pt 220pt; margin: 10pt }
      body { margin: 0; font-size: 12pt; line-height: 1.5 }
      .box { border: 3pt solid #336699; border-radius: 10pt; overflow: hidden; background: #ffeecc; padding: 4pt }
      .grad { height: 20pt; background: linear-gradient(to right, #ff8800, #0088ff) }
      .op { opacity: 0.4; background: #00aa00; height: 12pt; margin-top: -6pt }
      .dash { border-bottom: 2pt dashed #aa0000; margin: 4pt 0 }
    </style></head><body>
      <div class="box">組版の見本 <b>Kumiori</b> <i>italic</i></div>
      <div class="grad"></div>
      <div class="op"></div>
      <p class="dash">縦横の罫線と、<span style="color: #c00">赤い字</span>。</p>
      <p><img src="dot.png" style="width: 40pt; height: 40pt"> <img src="pic.svg" style="width: 100pt; height: 50pt"></p>
    </body></html>`;
    const res = await typesetHtml(html, { name: 'svg.html', files: [{ name: 'dot.png', data: png }, { name: 'pic.svg', data: svgImage }] });
    const scale = 2;
    // 画面の Canvas に描く
    const canvas = document.createElement('canvas');
    res.renderPage(canvas, 0, { scale, devicePixelRatio: 1 });
    const w = canvas.width;
    const h = canvas.height;
    const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    // 書き出した SVG を、画像として同じ大きさに描く
    const svg = await res.renderPageToSvg(0);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = h;
    const ctx2 = c2.getContext('2d')!;
    ctx2.drawImage(img, 0, 0, w, h);
    const b = ctx2.getImageData(0, 0, w, h).data;
    // 色の差が大きい画素 (どれかの成分が 32 を超えて違う) の割合と、色の付いた画素 (白でないもの) の数
    let diff = 0;
    let ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > 32) diff++;
      if (b[i] < 200 || b[i + 1] < 200 || b[i + 2] < 200) ink++;
    }
    return { w, h, diff: diff / (w * h), ink: ink / (w * h), pages: res.pageCount, hasText: /<text\b/.test(svg), warnings: res.warnings };
  });
  expect(r.pages).toBe(1);
  expect(r.hasText).toBe(false);
  // 絵が描かれている (白いだけの画像どうしを比べていない)
  expect(r.ink).toBeGreaterThan(0.1);
  // 違うのは、字・線の縁の塗り方 (アンチエイリアス) の違いだけ
  expect(r.diff).toBeLessThan(0.005);
  expect(errors).toEqual([]);
});

test('PNG に書き出したページ (自前で画素にしたもの) を、SVG に書き出したページをブラウザで描いた絵と同じに描く', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFonts(page);
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const src = (p: string) => import(/* @vite-ignore */ p);
    const { typesetHtml } = (await src('/src/index.ts')) as typeof import('../src/index');
    const svgImage =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
      '<defs><radialGradient id="g"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#0066cc"/></radialGradient></defs>' +
      '<rect width="100" height="50" fill="url(#g)"/><path d="M5 45 L95 5" stroke="#000" stroke-width="2" stroke-dasharray="4 2"/><text x="8" y="34" font-size="18">図 SVG</text></svg>';
    const html = `<!DOCTYPE html><html lang="ja"><head><style>
      @page { size: 240pt 200pt; margin: 10pt }
      body { margin: 0; font-size: 12pt; line-height: 1.5 }
      .box { border: 3pt solid #336699; border-radius: 10pt; overflow: hidden; background: #ffeecc; padding: 4pt }
      .grad { height: 20pt; background: linear-gradient(to right, #ff8800, #0088ff) }
      .op { opacity: 0.4; background: #00aa00; height: 12pt; margin-top: -6pt }
    </style></head><body>
      <div class="box">組版の見本 <b>Kumiori</b> <i>italic</i></div>
      <div class="grad"></div><div class="op"></div>
      <p style="border-bottom: 2pt dashed #aa0000">縦横の罫線と、<span style="color: #c00">赤い字</span>。</p>
      <p><img src="pic.svg" style="width: 100pt; height: 50pt"></p>
    </body></html>`;
    const res = await typesetHtml(html, { name: 'png.html', files: [{ name: 'pic.svg', data: svgImage }] });
    const dpi = 144;
    const png = await res.renderPageToPng(0, { dpi });
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    const w = bmp.width;
    const h = bmp.height;
    const c1 = new OffscreenCanvas(w, h);
    const x1 = c1.getContext('2d')!;
    x1.drawImage(bmp, 0, 0);
    const a = x1.getImageData(0, 0, w, h).data;
    const svg = await res.renderPageToSvg(0);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c2 = new OffscreenCanvas(w, h);
    const x2 = c2.getContext('2d')!;
    x2.fillStyle = '#fff';
    x2.fillRect(0, 0, w, h);
    x2.drawImage(img, 0, 0, w, h);
    const b = x2.getImageData(0, 0, w, h).data;
    let diff = 0;
    let ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > 64) diff++;
      if (a[i] < 200 || a[i + 1] < 200 || a[i + 2] < 200) ink++;
    }
    return { w, h, diff: diff / (w * h), ink: ink / (w * h), warnings: res.warnings };
  });
  // 240pt × 200pt を 144dpi で
  expect([r.w, r.h]).toEqual([480, 400]);
  expect(r.ink).toBeGreaterThan(0.1);
  // 違うのは、字・線の縁の塗り方の違いだけ
  expect(r.diff).toBeLessThan(0.005);
  expect(errors).toEqual([]);
});
