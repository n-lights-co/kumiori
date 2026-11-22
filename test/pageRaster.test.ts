/**
 * ページを PNG にする (TypesetResult.renderPageToPng・src/pageRaster.ts) のテスト。
 *  - PNG の形 (8 ビットの RGB)・大きさ (紙の大きさ × dpi / 72)・dpi の誤り・無いページ
 *  - 色の付いた箱・不透明度の付いた箱・角丸の切り抜き・画像・SVG の画像 (グラデーション)・色つきの字形の色が、その位置の画素に出る
 *  - 同じページの PDF を pdftocairo (Poppler) で画像にしたものと、画素で見てほとんど同じ (違うのは字・線の縁の塗り方だけ)。
 *    pdftoppm (Splash) は、繰り返しの背景画像の位相を、ほかの描き手とずらして描くので使わない
 * KUMIORI_PNG_OUT にディレクトリを指すと、PNG と PDF をそこに置く (目で見るため)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import fontkit from '@pdf-lib/fontkit';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { colr1, cpal, paint, withTables } from './colorFontBuilder';
import { defaultFontBuffer, ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const hasPdftocairo = (() => {
  try {
    execFileSync('pdftocairo', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

/** 16 × 16 の、左半分が赤・右半分が青の PNG */
const rgba = new Uint8Array(16 * 16 * 4);
for (let i = 0; i < 256; i++) rgba.set(i % 16 < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
const png = encodePngStored({ width: 16, height: 16, rgba });

const svgImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
  '<rect width="100" height="50" fill="url(#g)"/><text x="10" y="35" font-size="20" fill="#ffffff">SVG</text></svg>';

/** 72pt 四方ごとに位置を決めた見本 (1pt = 1 画素で数えやすいように、dpi 72 で描く) */
const html = `<!DOCTYPE html><html lang="ja"><head><style>
@page { size: 300pt 300pt; margin: 0 }
body { margin: 0; font-size: 12pt }
div { position: absolute }
</style></head><body>
<div style="left: 10pt; top: 10pt; width: 60pt; height: 40pt; background: #00ff00"></div>
<div style="left: 80pt; top: 10pt; width: 60pt; height: 40pt; background: #000000; opacity: 0.5"></div>
<div style="left: 150pt; top: 10pt; width: 60pt; height: 40pt; background: #ff0000; border-radius: 20pt"></div>
<img src="lr.png" style="position: absolute; left: 10pt; top: 60pt; width: 64pt; height: 32pt">
<img src="pic.svg" style="position: absolute; left: 100pt; top: 60pt; width: 100pt; height: 50pt">
<div style="left: 10pt; top: 130pt; width: 280pt; font-size: 14pt">組版の見本 Kumiori <b>bold</b> <i>italic</i></div>
<div style="left: 10pt; top: 160pt; width: 280pt; height: 40pt; background: linear-gradient(to right, #ffffff, #000000)"></div>
</body></html>`;

const decode = (b: Uint8Array) => PNG.sync.read(Buffer.from(b));
const px = (p: PNG, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('renderPageToPng', () => {
  it('PNG の形・大きさ・色 (箱・不透明度・角丸・画像・SVG の画像・グラデーション)', async () => {
    const r = await typeset(html, { kind: 'html', loadFont, files: [{ name: 'lr.png', data: png }, { name: 'pic.svg', data: svgImage }] });
    const bytes = await r.renderPageToPng(0, { dpi: 72 });
    if (process.env.KUMIORI_PNG_OUT) {
      fs.mkdirSync(process.env.KUMIORI_PNG_OUT, { recursive: true });
      fs.writeFileSync(path.join(process.env.KUMIORI_PNG_OUT, 'page.png'), bytes);
    }
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 色の型 2 (RGB。PNG §11.2.2 の IHDR) の 8 ビット
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(2);
    const p = decode(bytes);
    expect([p.width, p.height]).toEqual([300, 300]);
    expect(px(p, 40, 30)).toEqual([0, 255, 0]);
    // 黒の不透明度 0.5 (白の上): 127 か 128
    expect(near(px(p, 110, 30), [128, 128, 128], 2)).toBe(true);
    // 角丸: 中は赤、角の外は白
    expect(px(p, 180, 30)).toEqual([255, 0, 0]);
    expect(px(p, 151, 11)).toEqual([255, 255, 255]);
    // 画像: 左半分は赤、右半分は青
    expect(near(px(p, 20, 76), [255, 0, 0])).toBe(true);
    expect(near(px(p, 64, 76), [0, 0, 255])).toBe(true);
    // SVG の画像のグラデーション: 左端は赤に近く、右端は青に近い
    const l = px(p, 102, 62);
    const rr = px(p, 198, 62);
    expect(l[0]).toBeGreaterThan(200);
    expect(rr[2]).toBeGreaterThan(200);
    // CSS のグラデーション: 左は白、右は黒に近く、中ほどは灰色
    expect(px(p, 12, 180)[0]).toBeGreaterThan(240);
    expect(px(p, 288, 180)[0]).toBeLessThan(15);
    expect(near(px(p, 150, 180), [128, 128, 128], 12)).toBe(true);
    // 字: 字の行に黒い画素がある
    let ink = 0;
    for (let y = 130; y < 150; y++) for (let x = 10; x < 290; x++) if (px(p, x, y)[0] < 100) ink++;
    expect(ink).toBeGreaterThan(200);
    // 解像度を 2 倍にすると、縦横が 2 倍
    const p2 = decode(await r.renderPageToPng(0, { dpi: 144 }));
    expect([p2.width, p2.height]).toEqual([600, 600]);
    expect(px(p2, 80, 60)).toEqual([0, 255, 0]);
  });

  it('既定の解像度は 96dpi。dpi の誤り・無いページ・大きすぎる画像は RangeError', async () => {
    const r = await typeset('<style>@page { size: 72pt 36pt; margin: 0 }</style><p>a</p>', { kind: 'html', loadFont });
    const p = decode(await r.renderPageToPng(0));
    expect([p.width, p.height]).toEqual([96, 48]);
    await expect(r.renderPageToPng(0, { dpi: 0 })).rejects.toThrow(RangeError);
    await expect(r.renderPageToPng(0, { dpi: Number.NaN })).rejects.toThrow(RangeError);
    await expect(r.renderPageToPng(3)).rejects.toThrow(RangeError);
    await expect(r.renderPageToPng(0, { dpi: 100_000 })).rejects.toThrow(RangeError);
  });

  it('色つきの字形 (COLR のグラデーション・層) を、色で描く', async () => {
    const tinos = await defaultFontBuffer('Tinos-Regular.ttf');
    const fk = fontkit.create(new Uint8Array(tinos)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
    const gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
    // A: H の輪郭を、緑一色で塗る (COLR version 1 の PaintSolid)
    const font = withTables(tinos, {
      COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.glyph(gid('H'), paint.solid(0, 1)) }] }),
      CPAL: cpal([[[0, 160, 0, 255]]]),
    });
    const r = await typeset('<style>@page { size: 100pt 60pt; margin: 0 } @font-face { font-family: ColorTest; src: url(c.ttf) }</style><p style="margin: 0; font-family: ColorTest; font-size: 48pt; color: #000">A</p>', {
      kind: 'html',
      loadFont,
      files: [{ name: 'c.ttf', data: new Uint8Array(font) }],
    });
    const p = decode(await r.renderPageToPng(0, { dpi: 72 }));
    let green = 0;
    let black = 0;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const [cr, cg, cb] = px(p, x, y);
        if (cg > 120 && cr < 60 && cb < 60) green++;
        if (cr < 60 && cg < 60 && cb < 60) black++;
      }
    expect(green).toBeGreaterThan(100);
    expect(black).toBe(0);
  });

  it.skipIf(!hasPdftocairo)('同じページの PDF を pdftocairo で画像にしたものと、ほとんど同じ (縁の塗り方の違いだけ)', async () => {
    const doc = `<!DOCTYPE html><html lang="ja"><head><style>
      @page { size: A6; margin: 10mm }
      body { font-size: 10pt; line-height: 1.6 }
      h1 { font-size: 14pt; border-bottom: 1.5pt solid #234; color: #234 }
      .box { border: 2pt solid #369; border-radius: 6pt; background: #fec; padding: 4pt; box-shadow: 2pt 2pt 3pt rgba(0,0,0,.4) }
      .tiled { height: 15mm; background: url(lr.png) repeat; background-size: 6mm 6mm }
      .grad { height: 10mm; background: radial-gradient(circle, #ff0, #f00 60%, #00f) }
      .rot { transform: rotate(6deg); background: #cef; width: 40mm }
      table { border-collapse: collapse } td { border: 0.5pt solid #333; padding: 1pt 3pt }
    </style></head><body>
      <h1>見出し Heading</h1>
      <p>本文の<ruby>段落<rt>だんらく</rt></ruby>。English <b>bold</b> <i>italic</i> <u>underline</u>。</p>
      <div class="box">角丸の箱と影</div>
      <table><tr><td>表</td><td>12</td></tr></table>
      <div class="tiled"></div><div class="grad"></div>
      <div class="rot">回転した箱</div>
      <p><img src="pic.svg" style="width: 30mm"> <math><mfrac><mi>a</mi><msqrt><mi>b</mi></msqrt></mfrac></math></p>
    </body></html>`;
    const r = await typeset(doc, { kind: 'html', loadFont, files: [{ name: 'lr.png', data: png }, { name: 'pic.svg', data: svgImage }] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-png-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.pdf'), await r.toPdf());
      execFileSync('pdftocairo', ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', path.join(dir, 'a.pdf'), path.join(dir, 'ref')]);
      const ref = PNG.sync.read(fs.readFileSync(path.join(dir, 'ref.png')));
      const t0 = performance.now();
      const bytes = await r.renderPageToPng(0, { dpi: 150 });
      const ms = performance.now() - t0;
      const ours = decode(bytes);
      if (process.env.KUMIORI_PNG_OUT) {
        fs.writeFileSync(path.join(process.env.KUMIORI_PNG_OUT, 'cmp.png'), bytes);
        fs.copyFileSync(path.join(dir, 'ref.png'), path.join(process.env.KUMIORI_PNG_OUT, 'cmp-ref.png'));
      }
      expect([ours.width, ours.height]).toEqual([ref.width, ref.height]);
      let big = 0;
      for (let i = 0; i < ref.data.length; i += 4) {
        const d = Math.max(Math.abs(ref.data[i] - ours.data[i]), Math.abs(ref.data[i + 1] - ours.data[i + 1]), Math.abs(ref.data[i + 2] - ours.data[i + 2]));
        if (d > 64) big++;
      }
      // 成分の差が 64 を超える画素 (字・線の縁の塗り方の違い) は 0.5% 未満
      expect(big / (ref.width * ref.height)).toBeLessThan(0.005);
      // 速さの目安 (A6・150dpi で 1 秒を大きく下回る。遅い機械でも落ちないように、余裕を持たせる)
      expect(ms).toBeLessThan(5000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ページを画素にする手間に上限があり、超えたら残りを描かずに警告を出し、描き切れない SVG の画像は仮の枠で描く', async () => {
    // ページ全体の矩形 1,000 個 (use の入れ子で 1KB 足らず)。前は、図形ごとにページ全体の画素を数えて 96dpi で 30 秒かかっていた
    const a = (h: string) => `<use xlink:href="${h}"/>`.repeat(10);
    const heavy =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300">' +
      `<defs><rect id="r" width="400" height="300" fill="#08f" fill-opacity="0.01"/><g id="a">${a('#r')}</g><g id="b">${a('#a')}</g></defs>${a('#b')}</svg>`;
    const r = await typeset(
      '<html><head><style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } img { display: block; width: 300pt; height: 225pt }</style></head><body><img src="h.svg"><p>after</p></body></html>',
      { kind: 'html', loadFont, files: [{ name: 'h.svg', data: heavy }] },
    );
    const t = performance.now();
    const out = decode(await r.renderPageToPng(0, { dpi: 72 }));
    expect(performance.now() - t).toBeLessThan(15000);
    expect(r.diagnostics.filter((d) => d.code === 'png/raster-budget')).toHaveLength(1);
    // 仮の枠 (灰色 #f0f0f0 の矩形と、縁・対角の線) で描いた
    expect(px(out, 150, 60)).toSatisfy((c: number[]) => near(c, [0xf0, 0xf0, 0xf0], 2));
  });

  it('手間には、走査線ごとの辺の並べ替え (n log2 n) も数える (細かい破線の太い線: 走査線ごとに 4 万の辺)', async () => {
    // 太さ 100・stroke-dasharray 0.005 の長さ 200 の線 (かけら 2 万個) をページいっぱいに引き伸ばす。並べ替えを数えなかったときは、
    // 勘定 (外接矩形の画素 + 走査線 × 辺) が上限に届かずに描き、600dpi の A4 で 1 本 2 分ほどかかっていた
    const dash =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="none" width="200" height="100">' +
      '<line x1="0" y1="50" x2="200" y2="50" stroke="#000" stroke-width="100" stroke-dasharray="0.005"/></svg>';
    const r = await typeset(
      '<html><head><style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } img { display: block; width: 300pt; height: 225pt }</style></head><body><img src="d.svg"></body></html>',
      { kind: 'html', loadFont, files: [{ name: 'd.svg', data: dash }] },
    );
    await r.renderPageToPng(0, { dpi: 72 });
    expect(r.diagnostics.filter((d) => d.code === 'png/raster-budget')).toHaveLength(1);
    // 同じ線を、粗い破線 (かけら 200 個) にすれば、上限に当たらずに描く
    const r2 = await typeset(
      '<html><head><style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } img { display: block; width: 300pt; height: 225pt }</style></head><body><img src="d.svg"></body></html>',
      { kind: 'html', loadFont, files: [{ name: 'd.svg', data: dash.replace('0.005', '0.5') }] },
    );
    const out = decode(await r2.renderPageToPng(0, { dpi: 72 }));
    expect(r2.diagnostics.filter((d) => d.code === 'png/raster-budget')).toEqual([]);
    // 黒の線と隙間が交互に並ぶ (1 つの線と隙間は 0.75pt)
    const row = Array.from({ length: 300 }, (_, x) => px(out, x, 100)[0]);
    expect(row.some((v) => v < 128) && row.some((v) => v > 128)).toBe(true);
  });

  /**
   * fn の間に作った Float32Array (画素の板・覆いの配列) の長さを集める。時間でなく、作った板の大きさ・数で手間を確かめる
   * (時間の上限では、直す前のコードでも通っていた)。pageRaster は Float32Array を大域の名前で作るので、その間だけ数える代わりに差し替える
   */
  async function floatArrays<T>(fn: () => Promise<T>): Promise<{ value: T; sizes: number[] }> {
    const F = globalThis.Float32Array;
    const sizes: number[] = [];
    globalThis.Float32Array = new Proxy(F, {
      construct(t, args, nt) {
        if (typeof args[0] === 'number') sizes.push(args[0]);
        return Reflect.construct(t, args, nt);
      },
    });
    try {
      return { value: await fn(), sizes };
    } finally {
      globalThis.Float32Array = F;
    }
  }

  it('不透明度のグループは、中身の外接矩形の大きさの板に描く (小さな字のグループを何百並べても、ページ全体の板を作らない)。絵は同じ', async () => {
    const doc = (n: number) =>
      `<html><head><style>@page { size: A5; margin: 10mm } i { opacity: .5 } .o { opacity: .3; background: #f00; height: 20pt }</style></head><body><div class="o"><b>x</b></div><p>${'<i>x</i>'.repeat(n)}</p></body></html>`;
    const r = await typeset(doc(300), { kind: 'html', loadFont });
    const { value: png, sizes } = await floatArrays(() => r.renderPageToPng(0, { dpi: 300 }));
    const out = decode(png);
    // 前は 300 個の字ごとに 300dpi のページ全体 (約 870 万画素) の板を作り、重ねていた。作った配列の合計は、ページの板の数枚分まで
    const page = out.width * out.height * 4;
    expect(sizes.filter((n) => n >= page).length).toBeLessThanOrEqual(2);
    expect(sizes.reduce((t, n) => t + n, 0)).toBeLessThan(4 * page);
    expect(r.diagnostics.filter((d) => d.code === 'png/raster-budget')).toEqual([]);
    // 不透明度 0.3 の赤の箱 (紙の白に重ねた色)
    const y = Math.round((10 / 25.4) * 300) + 5;
    expect(px(out, 600, y)).toSatisfy((c: number[]) => near(c, [255, 179, 179], 3));
  });

  it('模様のタイルの覚えには上限があり、違う模様の多い SVG でもメモリを使い切らない', async () => {
    // 違う模様 (大きなタイル) 60 個で、小さな矩形を 1 つずつ塗る
    const pats = Array.from({ length: 60 }, (_, i) => `<pattern id="p${i}" width="${380 + i}" height="${380 + i}" patternUnits="userSpaceOnUse"><rect width="2" height="${380 + i}" fill="#00f"/></pattern>`).join('');
    const rects = Array.from({ length: 60 }, (_, i) => `<rect x="${i * 6}" y="10" width="0.5" height="0.5" fill="url(#p${i})"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs>${pats}</defs>${rects}</svg>`;
    const r = await typeset('<html><head><style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } img { display: block; width: 300pt }</style></head><body><img src="t.svg"></body></html>', {
      kind: 'html',
      loadFont,
      files: [{ name: 't.svg', data: svg }],
    });
    global.gc?.();
    const before = process.memoryUsage().arrayBuffers;
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().arrayBuffers)), 5);
    await r.renderPageToPng(0, { dpi: 600 });
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    // タイルは 1 枚 3,166 × 3,166 画素ほど (40MB)。60 枚を覚えると 2.4GB。上限 (1,600 万画素 = 64MB) と、描く途中のページの板・タイル 1 枚の分まで
    expect(peak - before).toBeLessThan(600 * 1024 * 1024);
  });

  it('同じ中身の模様のタイルは、模様で塗る図形ごとに描き直さない (模様の入れ子)', async () => {
    const rects = (n: number, w: number, fill: string) => `<rect width="${w}" height="${w}" fill="${fill}"/>`.repeat(n);
    const nested =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs>' +
      '<pattern id="p0" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#f00"/></pattern>' +
      [1, 2, 3].map((i) => `<pattern id="p${i}" width="${10 * 4 ** i}" height="${10 * 4 ** i}" patternUnits="userSpaceOnUse">${rects(8, 10 * 4 ** i, `url(#p${i - 1})`)}</pattern>`).join('') +
      `</defs>${rects(3, 400, 'url(#p3)')}</svg>`;
    const r = await typeset('<html><head><style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } img { display: block; width: 300pt }</style></head><body><img src="n.svg"></body></html>', {
      kind: 'html',
      loadFont,
      files: [{ name: 'n.svg', data: nested }],
    });
    const { value: png, sizes } = await floatArrays(() => r.renderPageToPng(0, { dpi: 144 }));
    const out = decode(png);
    // 前は、模様で塗る図形ごとにタイルを描き直し、3 × 8 × 8 × 8 枚のタイルを描いていた。いちばん内側の模様 p0 のタイル
    // (10 単位 × 144dpi の 1.5 画素 = 15 × 15 画素の板。RGBA で 900) を描くのは 1 度だけ (前は 1,536 度)
    expect(sizes.filter((n) => n === 15 * 15 * 4).length).toBe(1);
    expect(r.diagnostics.filter((d) => d.code === 'png/raster-budget')).toEqual([]);
    // 5 × 5 の赤の正方形の模様 (10 × 10 の間隔。144dpi で 1 単位 = 1.5 画素)
    expect(px(out, 3, 3)).toSatisfy((c: number[]) => near(c, [255, 0, 0], 3));
    expect(px(out, 12, 12)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 3));
  });
});
