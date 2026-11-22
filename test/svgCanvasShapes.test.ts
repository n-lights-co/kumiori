/**
 * SVG の図形を画素にする処理 (svgFilterRaster.ts の paintShapesToPixels) と、ブラウザの画像を持たない SVG の画像
 * (Web Worker の中で読んだもの) を Canvas に描く処理 (canvasRenderer.ts の drawSvgShapes) の確かめ。
 * Canvas は、OffscreenCanvas・ImageData の代わりの小さな作り物で受ける (描いた画素と、drawImage の大きさを見る)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, type SvgDoc } from '../src/svg';
import { paintShapesToPixels, paintShapesToPixelsWithin, shapesCostPerPixel } from '../src/svgFilterRaster';
import { AssetStore } from '../src/assets';
import { LayoutEngine } from '../src/layoutEngine';
import { exifSwapsAxes, prepareSvgImagesForCanvas, renderSheetToCanvas } from '../src/canvasRenderer';
import { encodePngStored } from '../src/pixels';
import { base64 } from '../src/base64';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { FAMILY, defaultFontBuffer, doc, fontBuffer, makeEngine } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (body: string, w = 100, h = 100) => `<svg ${NS} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** SVG を w × h の画素にし、(x, y) の画素の色 (乗算していない 0〜255) と不透明度 (0〜1) を返すもの */
function paint(src: string, w = 100, h = 100) {
  const d = parseSvg(src, parse) as SvgDoc;
  const px = paintShapesToPixels(d.shapes, [1, 0, 0, 1, 0, 0], w, h);
  return (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const a = px[i + 3];
    return { rgb: a > 0 ? [px[i] / a, px[i + 1] / a, px[i + 2] / a].map((v) => Math.round(v * 255)) : [0, 0, 0], a };
  };
}
/** 黄 (#ffff00) → 緑 (#008000) の、t での色 */
const yg = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return [255 * (1 - k), 255 + (128 - 255) * k, 0].map(Math.round);
};
const near = (a: number[], b: number[], tol = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('SVG の放射グラデーションを画素にする (SVG 2 §14.2.3.2)', () => {
  const stops = '<stop offset="0" stop-color="#ff0"/><stop offset="1" stop-color="#008000"/>';
  it('焦点が中心 (fx・fy の無い形): 中心は最初の止まりの色、端に向かって最後の止まりの色へ変わる', () => {
    const at = paint(svg(`<defs><radialGradient id="r">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`));
    // 画素の中心 (x + 0.5, y + 0.5) と、円の中心 (50, 50)・半径 50 の距離が t
    for (const [x, y] of [
      [50, 50],
      [60, 50],
      [75, 50],
      [50, 10],
      [90, 50],
      [2, 2],
    ]) {
      const t = Math.hypot(x + 0.5 - 50, y + 0.5 - 50) / 50;
      expect(at(x, y).rgb, `${x},${y}`).toSatisfy((c: number[]) => near(c, yg(t)));
    }
  });
  it('焦点が中心から外れた形 (fx): 焦点から外の円への線の上の割合が t', () => {
    // 外の円: 中心 (50, 50)・半径 50。焦点 (30, 50)
    const at = paint(svg(`<defs><radialGradient id="r" fx="0.3">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`));
    for (const [x, y] of [
      [30, 50],
      [10, 50],
      [70, 50],
      [30, 20],
      [60, 80],
    ]) {
      // 焦点 f から点 p への向きの線と外の円の交わり q: t = |p − f| / |q − f|
      const px = x + 0.5 - 30;
      const py = y + 0.5 - 50;
      const l = Math.hypot(px, py);
      const ux = px / l;
      // |f + s u − c|² = 50²、f − c = (−20, 0)
      const bb = -20 * ux;
      const s = -bb + Math.sqrt(bb * bb - (400 - 2500));
      expect(at(x, y).rgb, `${x},${y}`).toSatisfy((c: number[]) => near(c, yg(l / s)));
    }
  });
  it('fr のある形: 焦点の円の中は最初の止まりの色 (pad)', () => {
    const at = paint(svg(`<defs><radialGradient id="r" fr="0.2">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`));
    expect(at(50, 50).rgb).toSatisfy((c: number[]) => near(c, yg(0)));
    expect(at(55, 50).rgb).toSatisfy((c: number[]) => near(c, yg(0)));
    // 中心から 35: 半径 20〜50 の 0.5
    expect(at(85, 50).rgb).toSatisfy((c: number[]) => near(c, yg((35.5 - 20) / 30)));
  });
  it('spreadMethod の reflect・repeat: 外の円の外で、色を折り返す・繰り返す', () => {
    const body = (m: string) => `<defs><radialGradient id="r" r="0.25" spreadMethod="${m}">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`;
    const reflect = paint(svg(body('reflect')));
    const repeat = paint(svg(body('repeat')));
    // 中心から 37.5 (t = 1.5): reflect は 0.5、repeat も 0.5。中心から 45 (t = 1.8): reflect は 0.2、repeat は 0.8
    expect(reflect(87, 50).rgb).toSatisfy((c: number[]) => near(c, yg(2 - 37.5 / 25), 6));
    expect(reflect(95, 50).rgb).toSatisfy((c: number[]) => near(c, yg(2 - 45.5 / 25), 6));
    expect(repeat(95, 50).rgb).toSatisfy((c: number[]) => near(c, yg(45.5 / 25 - 1), 6));
  });
  it('焦点の円が外の円の外: 2 つの円に接する円錐の外は塗らない (透明)', () => {
    // 外の円: 中心 (50, 50)・半径 20。焦点 (90, 50)・半径 0 (userSpaceOnUse)
    const at = paint(svg(`<defs><radialGradient id="r" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="20" fx="90" fy="50">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`));
    // 焦点の後ろ (円錐の外)
    expect(at(98, 50).a).toBe(0);
    // 外の円の中心 (t = 1 の円の中心の上。t は 1 より大きいので、最後の止まりの色)
    expect(at(50, 50).a).toBeGreaterThan(0.99);
    expect(at(50, 50).rgb).toSatisfy((c: number[]) => near(c, yg(1)));
  });
  it('gradientTransform と objectBoundingBox: 図形の箱に合わせて伸ばす', () => {
    // 幅 100・高さ 50 の箱に、bbox の単位の円 (楕円になる)
    const at = paint(svg(`<defs><radialGradient id="r">${stops}</radialGradient></defs><rect width="100" height="50" fill="url(#r)"/>`, 100, 50), 100, 50);
    expect(at(50, 25).rgb).toSatisfy((c: number[]) => near(c, yg(Math.hypot(0.5, 0.5) / 50)));
    // 縦の端 (中心から 24.5 / 25 ≒ 0.98)
    expect(at(50, 0).rgb).toSatisfy((c: number[]) => near(c, yg(24.5 / 25)));
    const rot = paint(svg(`<defs><radialGradient id="r" gradientTransform="translate(0.5 0.5) scale(0.5 1) translate(-0.5 -0.5)">${stops}</radialGradient></defs><rect width="100" height="100" fill="url(#r)"/>`));
    // 横に半分に縮めた円: 中心から横に 24.5 は t ≒ 0.98
    expect(rot(74, 50).rgb).toSatisfy((c: number[]) => near(c, yg(24.5 / 25)));
  });
});

/** w × h の単色の PNG。interlaced なら、IHDR の interlace method を 1 にする (組版の画素の読み取り (decodePng) が読まない) */
function png(w: number, h: number, rgba: [number, number, number, number], interlaced = false): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  const b = encodePngStored({ width: w, height: h, rgba: px } as never);
  if (interlaced) b[28] = 1;
  return b;
}
const dataUri = (b: Uint8Array) => `data:image/png;base64,${base64(b)}`;

describe('SVG の中の読めない画像', () => {
  const src = svg(`<rect width="100" height="100" fill="#00f"/><image x="0" y="0" width="50" height="50" preserveAspectRatio="none" xlink:href="${dataUri(png(4, 4, [255, 0, 0, 255], true))}"/>`);
  it('missingImage を渡せば、例外にせず、その画像だけを描かない (ほかの図形は描く)', () => {
    const d = parseSvg(src, parse) as SvgDoc;
    const px = paintShapesToPixels(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100, { missingImage: () => undefined });
    // 画像の所も、下の青のまま
    expect([px[(10 * 100 + 10) * 4], px[(10 * 100 + 10) * 4 + 2]]).toEqual([0, 1]);
  });
  it('missingImage の返した画素で描く。渡さなければ、これまでどおり例外 (透明を平らにする処理は、受けて別の道で描く)', () => {
    const d = parseSvg(src, parse) as SvgDoc;
    const px = paintShapesToPixels(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100, { missingImage: () => ({ w: 1, h: 1, rgba: new Uint8Array([0, 255, 0, 255]) }) });
    expect([px[(10 * 100 + 10) * 4], px[(10 * 100 + 10) * 4 + 1]]).toEqual([0, 1]);
    expect(() => paintShapesToPixels(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100)).toThrow('image');
  });
  it('マスクの中の読めない画像も、missingImage で飛ばす', () => {
    const m = svg(
      `<defs><mask id="m"><rect width="100" height="100" fill="#fff"/><image width="50" height="50" preserveAspectRatio="none" xlink:href="${dataUri(png(2, 2, [0, 0, 0, 255], true))}"/></mask></defs><rect width="100" height="100" fill="#00f" mask="url(#m)"/>`,
    );
    const d = parseSvg(m, parse) as SvgDoc;
    const px = paintShapesToPixels(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100, { missingImage: () => undefined });
    expect(px[(10 * 100 + 10) * 4 + 3]).toBeCloseTo(1, 5);
  });
});

// ───────────── Canvas (Web Worker の中の道) ─────────────

type Put = { w: number; h: number; data: Uint8ClampedArray };
const puts: Put[] = [];
/** 作り物の 2D の文脈: 変換・drawImage の引数・putImageData の画素を覚える。ほかの呼び出しは何もしない */
function fakeContext(canvas: { width: number; height: number }, draws: unknown[][]) {
  let t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const own: Record<string, unknown> = {
    canvas,
    getTransform: () => ({ ...t }),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void (t = { a, b, c, d, e, f }),
    drawImage: (...args: unknown[]) => void draws.push(args),
    putImageData: (img: { width: number; height: number; data: Uint8ClampedArray }) => void puts.push({ w: img.width, h: img.height, data: img.data }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
  };
  return new Proxy(own, { get: (o, k) => (k in o ? o[k as string] : () => {}), set: () => true });
}
class FakeOffscreen {
  draws: unknown[][] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return fakeContext(this, this.draws);
  }
}
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
  vi.stubGlobal('ImageData', FakeImageData);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** SVG の画像 (ブラウザの画像を持たないもの) を、幅 w・高さ h で置いたページを組む */
function layout(assets: AssetStore, fonts: FontManager, imgs: Array<{ src: string; width: number; height: number }>) {
  const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY, assets });
  return engine.layout(doc([{ type: 'block', children: imgs.map((i) => ({ type: 'image', src: i.src, width: i.width, height: i.height, fit: 'fill' })) }] as never));
}
function render(tree: ReturnType<typeof layout>, assets: AssetStore, fonts: FontManager, scale: number, extra: { warn?: (d: { code: string }) => void; svgRasterBudget?: number } = {}) {
  const main = new FakeOffscreen(0, 0);
  renderSheetToCanvas(tree.sheets[0], main as never, fonts, { assets, parseXml: parse, scale, devicePixelRatio: 1, ...(extra as object) });
  return main.draws;
}
const register = (assets: AssetStore, src: string, body: string, w = 100, h = 100) =>
  assets.register(src, { mime: 'image/svg+xml', bytes: new TextEncoder().encode(body), width: w, height: h });

describe('ブラウザの画像の無い SVG の画像を Canvas に描く (drawSvgShapes)', () => {
  it('画素の幅は、浮動小数の誤差で 1 画素大きくしない', () => {
    const assets = new AssetStore();
    register(assets, 'a.svg', svg('<rect width="100" height="100" fill="#f00"/>'));
    // HTML の 200pt の画像は、組版の丸めで幅 200.000025pt になる (× 2 で 400.00005)。1000 × 0.30000000000000004 = 300.00000000000006
    puts.length = 0;
    render(layout(assets, E.fonts, [{ src: 'a.svg', width: 200.000025, height: 100 }]), assets, E.fonts, 2);
    render(layout(assets, E.fonts, [{ src: 'a.svg', width: 1000, height: 1000 }]), assets, E.fonts, 0.1 * 3);
    expect(puts.map((p) => [p.w, p.h])).toEqual([
      [400, 200],
      [300, 300],
    ]);
  });
  it('読めない画像 (インターレースの PNG) のある SVG: 例外にせず、ほかの図形を描く', () => {
    const assets = new AssetStore();
    register(assets, 'b.svg', svg(`<rect width="100" height="100" fill="#00f"/><image width="50" height="50" preserveAspectRatio="none" xlink:href="${dataUri(png(4, 4, [255, 0, 0, 255], true))}"/>`));
    const tree = layout(assets, E.fonts, [{ src: 'b.svg', width: 100, height: 100 }]);
    puts.length = 0;
    expect(() => render(tree, assets, E.fonts, 1)).not.toThrow();
    expect(puts).toHaveLength(1);
    const d = puts[0].data;
    // 画像の所も、青
    expect([...d.subarray((10 * 100 + 10) * 4, (10 * 100 + 10) * 4 + 4)]).toEqual([0, 0, 255, 255]);
  });
  it('読めない画像は、前もって createImageBitmap で読んだ画素で描く (Web Worker の中: prepareSvgImagesForCanvas)', async () => {
    const assets = new AssetStore();
    register(assets, 'c.svg', svg(`<image width="100" height="100" preserveAspectRatio="none" xlink:href="${dataUri(png(4, 4, [255, 0, 0, 255], true))}"/>`));
    const tree = layout(assets, E.fonts, [{ src: 'c.svg', width: 100, height: 100 }]);
    // 作り物の ImageBitmap (getImageData は、どの画素も 200)
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close: () => {} }));
    try {
      await prepareSvgImagesForCanvas(assets, E.fonts);
    } finally {
      vi.stubGlobal('createImageBitmap', undefined);
    }
    puts.length = 0;
    render(tree, assets, E.fonts, 1);
    expect([...puts[0].data.subarray((50 * 100 + 50) * 4, (50 * 100 + 50) * 4 + 4)]).toSatisfy((c: number[]) => near(c, [200, 200, 200, 200], 1));
  });
  it('同じ SVG を 2 つの大きさで置いても、描き直すたびに画素にし直さない', () => {
    const assets = new AssetStore();
    register(assets, 'd.svg', svg('<circle cx="50" cy="50" r="40" fill="#0a0"/>'));
    const tree = layout(assets, E.fonts, [
      { src: 'd.svg', width: 200, height: 200 },
      { src: 'd.svg', width: 20, height: 20 },
    ]);
    puts.length = 0;
    render(tree, assets, E.fonts, 1);
    expect(puts.map((p) => p.w).sort((a, b) => a - b)).toEqual([20, 200]);
    puts.length = 0;
    render(tree, assets, E.fonts, 1);
    render(tree, assets, E.fonts, 1);
    expect(puts).toHaveLength(0);
  });
  it('図形の多い SVG を大きく置いても、画素にする手間の上限を超えない解像度で描く (図形の数 × 画素の数)', () => {
    const assets = new AssetStore();
    // ページ全体の矩形 1,000 個 (use の入れ子で 1KB 足らず)
    const a = '<use xlink:href="#r"/>'.repeat(10);
    register(assets, 'm.svg', svg(`<defs><rect id="r" width="100" height="100" fill="#08f" fill-opacity="0.01"/><g id="a">${a}</g><g id="b">${a.replace(/#r/g, '#a')}</g></defs>${a.replace(/#r/g, '#b')}`));
    const tree = layout(assets, E.fonts, [{ src: 'm.svg', width: 1000, height: 1000 }]);
    puts.length = 0;
    const warns: string[] = [];
    const t = performance.now();
    // 上限を小さくして確かめる (既定の上限の 1/400)
    render(tree, assets, E.fonts, 4, { svgRasterBudget: 20_000_000, warn: (d) => warns.push(d.code) });
    expect(performance.now() - t).toBeLessThan(5000);
    expect(puts).toHaveLength(1);
    // 4000 × 4000 画素の代わりに、図形の数 × 7 × 画素の数が上限に収まる大きさ (縦横の比はそのまま)
    const { w, h } = puts[0];
    expect(w).toBe(h);
    expect(w * h * 7000).toBeLessThanOrEqual(20_000_000);
    expect(w * h * 7000 * 1.1).toBeGreaterThan(20_000_000 / 1.2);
    expect(warns).toEqual([]);
    // 描いた色: 0.01 の不透明度を 1,000 回重ねた青 (1 − 0.99^1000 ≈ 1)
    expect(puts[0].data[3]).toBeGreaterThan(250);
  });
  it('1 回の描画の手間の合計 (1 つの上限の 4 倍) を使い切った後の SVG は、仮の枠で描いて警告に出す', () => {
    const assets = new AssetStore();
    const rects = '<rect width="100" height="100" fill="#0f0" fill-opacity="0.5"/>'.repeat(100);
    const imgs = Array.from({ length: 8 }, (_, i) => (register(assets, `n${i}.svg`, svg(rects + `<rect width="1" height="1" fill="#${i}${i}${i}"/>`)), { src: `n${i}.svg`, width: 40, height: 40 }));
    const tree = layout(assets, E.fonts, imgs);
    puts.length = 0;
    const warns: string[] = [];
    render(tree, assets, E.fonts, 1, { svgRasterBudget: 1_000_000, warn: (d) => warns.push(d.code) });
    // 1 つは上限に収まる解像度で描き (上限のほぼ全部を使う)、合計の上限を超える後の画像は、仮の枠
    expect(puts.length).toBeGreaterThanOrEqual(3);
    expect(puts.length).toBeLessThanOrEqual(5);
    expect(warns.length).toBe(8 - puts.length);
    expect(new Set(warns)).toEqual(new Set(['canvas/svg-not-drawn']));
    // 上限を戻せば、どれも描く (仮の枠で描いた画像は、覚えていない)
    warns.length = 0;
    puts.length = 0;
    render(tree, assets, E.fonts, 1, { warn: (d) => warns.push(d.code) });
    expect(warns).toEqual([]);
    expect(puts.length).toBe(8);
  });
  it('paintShapesToPixelsWithin: 手間が上限を超えたら undefined (例外にしない)', () => {
    const d = parseSvg(svg('<rect width="100" height="100" fill="#f00"/>'.repeat(10)), parse) as SvgDoc;
    expect(paintShapesToPixelsWithin(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100, 100_000)).toBeUndefined();
    const ok = paintShapesToPixelsWithin(d.shapes, [1, 0, 0, 1, 0, 0], 100, 100, 1e9)!;
    expect(ok.pixels[3]).toBeCloseTo(1, 5);
    expect(ok.used).toBeLessThanOrEqual(shapesCostPerPixel(d.shapes) * 100 * 100);
  });
  it('SVG の @font-face の書体: 組んだ後の用意 (prepareSvgImagesForCanvas) で読み込み、先に描いた図形の覚えは作り直す', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
    const arimo = new Uint8Array(await defaultFontBuffer('Arimo-Regular.ttf'));
    const assets = new AssetStore();
    register(assets, 'f.svg', svg(`<style>@font-face{font-family:'EmbX';src:url(data:font/ttf;base64,${base64(arimo)})}</style><text x="5" y="70" font-family="EmbX" font-size="60">iW</text>`));
    const tree = layout(assets, fonts, [{ src: 'f.svg', width: 100, height: 100 }]);
    puts.length = 0;
    render(tree, assets, fonts, 1);
    const before = puts[0].data;
    await prepareSvgImagesForCanvas(assets, fonts);
    expect(fonts.has('EmbX')).toBe(true);
    puts.length = 0;
    render(tree, assets, fonts, 1);
    expect(puts).toHaveLength(1);
    expect(Buffer.from(puts[0].data).equals(Buffer.from(before))).toBe(false);
  });
});

describe('Web Worker の中の前もっての用意 (prepareSvgImagesForCanvas) の量', () => {
  /** createImageBitmap の作り物 (呼ばれた数と型を覚える。読んだ画像は w × h) と、読み取りの Canvas の大きさ */
  async function prepare(body: string, w = 4, h = 4) {
    const assets = new AssetStore();
    register(assets, 'p.svg', svg(body));
    const calls: string[] = [];
    const sizes: number[][] = [];
    const options: Array<ImageBitmapOptions | undefined> = [];
    vi.stubGlobal('createImageBitmap', async (b: Blob, o?: ImageBitmapOptions) => (calls.push(b.type), options.push(o), { width: w, height: h, close: () => {} }));
    const Real = FakeOffscreen;
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends Real {
        constructor(cw: number, ch: number) {
          super(cw, ch);
          sizes.push([cw, ch]);
        }
      },
    );
    try {
      await prepareSvgImagesForCanvas(assets, E.fonts);
    } finally {
      vi.stubGlobal('createImageBitmap', undefined);
      vi.stubGlobal('OffscreenCanvas', Real);
    }
    return { calls, sizes, options };
  }
  const img = (href: string) => `<image width="10" height="10" xlink:href="${href}"/>`;
  /** 頭に n バイトの APP2 (ICC の入れ物) を置いた JPEG の頭。nf は成分の数 (4 なら CMYK: 組版の画素の読み取りが読まない) */
  function jpegHead(nf: number, app = 10000, w = 10, h = 10): Uint8Array {
    const b = [0xff, 0xd8, 0xff, 0xe2, ((app + 2) >> 8) & 0xff, (app + 2) & 0xff, ...new Array(app).fill(0)];
    b.push(0xff, 0xc0, 0, 8 + 3 * nf, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, nf, ...new Array(3 * nf).fill(1), 0xff, 0xd9);
    return new Uint8Array(b);
  }
  const jpegUri = (b: Uint8Array) => `data:image/jpeg;base64,${base64(b)}`;

  it('読める画像 (ふつうの PNG) は、頭だけを見て、読まない', async () => {
    const { calls } = await prepare(img(dataUri(png(4, 4, [0, 0, 255, 255]))));
    expect(calls).toEqual([]);
  });
  it('同じ中身の読めない画像が何度出ても、1 度だけ読む', async () => {
    const u = dataUri(png(4, 4, [255, 0, 0, 255], true));
    const { calls } = await prepare(img(u) + img(u) + img(u));
    expect(calls).toEqual(['image/png']);
  });
  it('JPEG の SOF が、大きな APP の区切りの後にあっても (base64 の頭の数 KB の外)、成分の数で見分ける。改行を挟んだ base64 も', async () => {
    const cmyk = jpegUri(jpegHead(4));
    const wrapped = cmyk.replace(/(.{76})/g, '$1\n');
    const { calls } = await prepare(img(jpegUri(jpegHead(3))) + img(wrapped));
    expect(calls).toEqual(['image/jpeg']);
  });
  it('1 枚が大きい画像は、400 万画素まで縮めて読む', async () => {
    const { sizes } = await prepare(img(dataUri(png(4, 4, [255, 0, 0, 255], true))), 4000, 3000);
    expect(sizes).toHaveLength(1);
    const [w, h] = sizes[0];
    expect(w * h).toBeLessThanOrEqual(4_000_000);
    expect(w / h).toBeCloseTo(4 / 3, 2);
  });
  it('頭の縦横が 1 枚の上限を超える画像は、元の大きさで戻さず、読むときに幅と高さを渡して縮める (縦横の比は保つ)', async () => {
    const { options } = await prepare(img(jpegUri(jpegHead(4, 10, 40000, 10000))) + img(jpegUri(jpegHead(4, 10, 100, 100))), 2000, 500);
    expect(options).toHaveLength(2);
    // 幅 40000 × √(400 万 / 4 億) = 4000 (縮めた後は 4000 × 1000 = 400 万画素)
    expect(options[0]).toEqual({ resizeWidth: 4000, resizeHeight: 1000, resizeQuality: 'high' });
    expect(options[1]).toBeUndefined();
  });
  it('EXIF の向きが縦横を入れ替える (5〜8) 画像は、読んだ後の幅 (頭の高さ) で縮める', async () => {
    // APP1 の Exif (TIFF の II・Orientation = o) を頭に置いた CMYK の JPEG
    const exif = (o: number) => {
      const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
      const head = jpegHead(4, 10, 40000, 10000);
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body, ...head.subarray(2)]);
    };
    const { options } = await prepare(img(jpegUri(exif(6))) + img(jpegUri(exif(1))), 2000, 500);
    expect(options).toEqual([
      { resizeWidth: 1000, resizeHeight: 4000, resizeQuality: 'high' },
      { resizeWidth: 4000, resizeHeight: 1000, resizeQuality: 'high' },
    ]);
  });
  it('EXIF の向きの読みがブラウザと食い違っても、読むときに渡す大きさは 1 枚の上限 (の 1 行ぶん) を超えない', async () => {
    // 20000 × 2000 の CMYK の JPEG に Orientation = o の APP1。fill なら標識の前に埋め草 0xFF を 1 つ置く (ITU-T T.81 B.1.1.2)。
    // 向きを読まない形 (APP1 を APP0 の名前にする) は、ブラウザが向きを適用しても、こちらは読めない場合の代わり
    const exif = (o: number, fill: boolean, marker = 0xe1) => {
      const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
      const head = jpegHead(4, 10, 20000, 2000);
      return new Uint8Array([0xff, 0xd8, ...(fill ? [0xff] : []), 0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body, ...head.subarray(2)]);
    };
    const { options } = await prepare(img(jpegUri(exif(6, true))) + img(jpegUri(exif(6, false, 0xe0))) + img(jpegUri(exif(1, true))), 2000, 500);
    // 埋め草を読み飛ばして向きを読む: 読んだ後の幅は頭の高さ 2000 × √(400 万 / 4,000 万) = 632
    expect(options[0]).toEqual({ resizeWidth: 632, resizeHeight: 6320, resizeQuality: 'high' });
    expect(options[1]).toEqual({ resizeWidth: 6324, resizeHeight: 633, resizeQuality: 'high' });
    expect(options[2]).toEqual({ resizeWidth: 6324, resizeHeight: 633, resizeQuality: 'high' });
    // どちらに読んでも (ブラウザがどちらに向けても)、渡した幅 × 高さが、そのまま読んだ画像の画素の数になる
    for (const o of options) expect(o!.resizeWidth! * o!.resizeHeight!).toBeLessThanOrEqual(4_000_000 + o!.resizeWidth!);
  });
  it('exifSwapsAxes: JPEG の APP1・PNG の eXIf の Orientation を読む', () => {
    const tiff = (o: number, be = false) =>
      be ? [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0] : [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
    const jpg = (t: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, t.length + 8, 0x45, 0x78, 0x69, 0x66, 0, 0, ...t, 0xff, 0xd9]);
    const pngWith = (t: number[]) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, t.length, 0x65, 0x58, 0x49, 0x66, ...t, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);
    expect([5, 6, 7, 8].every((o) => exifSwapsAxes(jpg(tiff(o)), 'jpeg'))).toBe(true);
    expect([1, 2, 3, 4].some((o) => exifSwapsAxes(jpg(tiff(o)), 'jpeg'))).toBe(false);
    expect(exifSwapsAxes(jpg(tiff(6, true)), 'jpeg')).toBe(true);
    // 標識の前の埋め草 0xFF (ITU-T T.81 B.1.1.2) は読み飛ばす
    const filled = (t: number[], n: number) => new Uint8Array([0xff, 0xd8, ...new Array(n).fill(0xff), ...jpg(t).subarray(2)]);
    expect(exifSwapsAxes(filled(tiff(6), 1), 'jpeg')).toBe(true);
    expect(exifSwapsAxes(filled(tiff(8), 3), 'jpeg')).toBe(true);
    expect(exifSwapsAxes(filled(tiff(1), 1), 'jpeg')).toBe(false);
    expect(exifSwapsAxes(pngWith(tiff(8)), 'png')).toBe(true);
    expect(exifSwapsAxes(pngWith(tiff(1)), 'png')).toBe(false);
    // 壊れた・短い入力は false
    expect(exifSwapsAxes(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20, 0x45]), 'jpeg')).toBe(false);
  });
  it('読んだ画素の合計が 3,200 万画素を超える分は、読まない (例外にしない)', async () => {
    const body = Array.from({ length: 9 }, (_, i) => img(dataUri(png(4, 4, [i, 0, 0, 255], true)))).join('');
    const { calls } = await prepare(body, 2000, 2000);
    expect(calls).toHaveLength(8);
  });
});

describe('画素にした SVG の覚え', () => {
  it('WeakRef の無い環境でも落ちず、図形ごとに最後の 2 枚だけを覚える (いちばん前に使った 1 枚を捨てる)', () => {
    const assets = new AssetStore();
    register(assets, 'w.svg', svg('<circle cx="50" cy="50" r="40" fill="#a0a"/>'));
    const tree = layout(
      assets,
      E.fonts,
      [30, 40, 50].map((s) => ({ src: 'w.svg', width: s, height: s })),
    );
    // 同じ図形を、同じ 3 つの大きさで、覚えている 2 枚 (40・50) を先に描く
    const tree2 = layout(
      assets,
      E.fonts,
      [40, 50, 30].map((s) => ({ src: 'w.svg', width: s, height: s })),
    );
    vi.stubGlobal('WeakRef', undefined);
    try {
      puts.length = 0;
      render(tree, assets, E.fonts, 1);
      expect(puts.map((p) => p.w)).toEqual([30, 40, 50]);
      // 覚えているのは後の 2 枚 (40・50) だけ: 3 つとも描き直すと、いちばん前に使った 30 だけを画素にし直す
      // (全部を覚えていれば、どれも画素にし直さない。1 枚しか覚えていなければ、40 も画素にし直す)
      puts.length = 0;
      render(tree2, assets, E.fonts, 1);
      expect(puts.map((p) => p.w)).toEqual([30]);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
      vi.stubGlobal('ImageData', FakeImageData);
    }
  });
});
