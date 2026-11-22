import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { parseSvg, type SvgShape } from '../src/svg';
import { paintShapesToPixels, rasterFilter } from '../src/svgFilterRaster';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

// filter は、clip-path・mask・opacity より先に当てる (Filter Effects 1 §5・CSS Masking 1 §2・SVG 2 §3.6: filter → 切り抜き → マスク → 不透明度)。
// filter の元の図形 (SourceGraphic) には、その要素と祖先の切り抜き・マスク・不透明度が掛からない。
// 期待の値は、同じ SVG をこの環境の Chromium (deviceScaleFactor 1) で描いて確かめたもの

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`;
const shapesOf = (body: string) => parseSvg(svg(body), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!.shapes;

/** 図形の並びの中の、filter を画素で計算した画像と、根の座標 (x, y) のその画素 (sRGB・乗算していない RGBA) */
function rasterOf(shapes: SvgShape[]) {
  const all: SvgShape[] = [];
  const add = (xs: SvgShape[]) => xs.forEach((x) => (all.push(x), x.group && add(x.group.shapes)));
  add(shapes);
  const sh = all.find((x) => x.image?.pixels)!;
  const img = sh.image!;
  const px = img.pixels!;
  const [w, , , mh, ex, ey] = img.matrix;
  const at = (x: number, y: number) => {
    const ix = Math.floor(((x + 0.5 - ex) / w) * px.width);
    const iy = Math.floor(((y + 0.5 - (ey + mh)) / -mh) * px.height);
    if (ix < 0 || iy < 0 || ix >= px.width || iy >= px.height) return [0, 0, 0, 0];
    return Array.from(px.rgba.subarray((iy * px.width + ix) * 4, (iy * px.width + ix) * 4 + 4));
  };
  return { sh, at };
}

const circleClip = '<clipPath id="c"><circle cx="50" cy="50" r="10"/></clipPath>';
const dilate = '<filter id="f"><feMorphology operator="dilate" radius="5"/></filter>';
const discrete = '<filter id="fa"><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter>';
const shadow = '<filter id="ds" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="10" dy="10" stdDeviation="0" flood-color="#00f"/></filter>';
const halfMask = '<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="50" height="100" fill="#fff"/></mask>';

describe('filter → clip-path → mask → opacity の順 (Filter Effects 1 §5、CSS Masking 1 §2)', () => {
  it('clip-path と filter の両方: 太らせてから切り抜く (半径 10 の円のまま。前は切り抜いてから太らせ、半径 15 の円になった)', () => {
    const { sh, at } = rasterOf(shapesOf(`${circleClip}${dilate}<rect x="20" y="20" width="60" height="60" fill="#f00" clip-path="url(#c)" filter="url(#f)"/>`));
    // filter の元の図形は切り抜かない矩形 (20〜80) で、太らせた結果は 15〜85
    expect(at(22, 50)).toEqual([255, 0, 0, 255]);
    expect(at(17, 50)[3]).toBe(255);
    // 切り抜きは filter の結果 (画像) に掛ける
    expect(sh.clips?.length).toBe(1);
  });

  it('opacity と filter の両方: 不透明の図形に filter を当て、結果を薄める (feFuncA の discrete で不透明になり、0.4 で描く。前は何も描かなかった)', () => {
    // 図形で近似する道 (色の変換): 元の図形は不透明なので、discrete で不透明のまま
    const shapes = shapesOf(`${discrete}<rect x="20" y="20" width="60" height="60" fill="#f00" opacity="0.4" filter="url(#fa)"/>`);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].fill).toBe('#ff0000');
    expect(shapes[0].fillOpacity).toBeCloseTo(0.4);
    // 画素で計算する道 (feMorphology と重ねたもの): 結果の画像は不透明で、0.4 で置く
    const { sh, at } = rasterOf(shapesOf(`<filter id="fb"><feMorphology operator="dilate" radius="1"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter><rect x="20" y="20" width="60" height="60" fill="#f00" opacity="0.4" filter="url(#fb)"/>`));
    expect(at(50, 50)).toEqual([255, 0, 0, 255]);
    expect(sh.fillOpacity).toBeCloseTo(0.4);
  });

  it('opacity と feDropShadow (図形で近似する道): 影と図形をまとめて薄める (影が図形の下から透けない)', () => {
    const shapes = shapesOf(`${shadow}<rect x="20" y="20" width="40" height="40" fill="#f00" opacity=".5" filter="url(#ds)"/>`);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].group).toBeDefined();
    expect(shapes[0].fillOpacity).toBeCloseTo(0.5);
    // 中の影と図形は不透明
    for (const x of shapes[0].group!.shapes) expect(x.fillOpacity).toBe(1);
  });

  it('祖先の clip-path は、filter の元の図形に掛けず、結果に掛ける', () => {
    const { sh, at } = rasterOf(shapesOf(`${circleClip}${dilate}<g clip-path="url(#c)"><rect x="20" y="20" width="60" height="60" fill="#f00" filter="url(#f)"/></g>`));
    expect(at(22, 50)).toEqual([255, 0, 0, 255]);
    expect(sh.clips?.length).toBe(1);
  });

  it('mask と filter の両方、祖先の mask: filter の結果にマスクを掛ける (元の図形はマスクで隠さない)', () => {
    for (const body of [
      `${halfMask}${dilate}<rect x="20" y="20" width="60" height="60" fill="#f00" mask="url(#m)" filter="url(#f)"/>`,
      `${halfMask}${dilate}<g mask="url(#m)"><rect x="20" y="20" width="60" height="60" fill="#f00" filter="url(#f)"/></g>`,
    ]) {
      const { sh, at } = rasterOf(shapesOf(body));
      // マスクで隠れる右半分も、filter の結果の画像には描かれている (前はマスクで隠してから太らせた)
      expect(at(75, 50)).toEqual([255, 0, 0, 255]);
      expect(sh.masks?.length).toBe(1);
    }
  });

  it('filter を付けた g の中の子の clip-path は、filter の元の図形の一部 (先に切り抜いてから太らせる)', () => {
    const { sh, at } = rasterOf(shapesOf(`${circleClip}${dilate}<g filter="url(#f)"><rect x="20" y="20" width="60" height="60" fill="#f00" clip-path="url(#c)"/></g>`));
    expect(at(37, 50)[3]).toBe(255);
    expect(at(30, 50)[3]).toBe(0);
    expect(sh.clips).toBeUndefined();
  });

  it('mask と影 (図形で近似する道): 影と図形をまとめて透明のグループにし、グループにマスクを掛ける', () => {
    const shapes = shapesOf(`${halfMask}${shadow}<rect x="20" y="20" width="40" height="40" fill="#f00" mask="url(#m)" filter="url(#ds)"/>`);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].masks?.length).toBe(1);
    expect(shapes[0].group!.shapes.length).toBeGreaterThan(1);
    for (const x of shapes[0].group!.shapes) expect(x.masks).toBeUndefined();
  });
});

describe('マスクの付いた画像を PDF に描く', () => {
  beforeAll(async () => {
    await ensureFonts([...DEFAULT_FONTS.base]);
  }, 300_000);

  it('透明のある画像 (filter を画素で計算した結果) は、透明のグループに入れてからマスクを掛ける (画像の SMask がソフトマスクに置き換わるため。ISO 32000-2 §11.6.5.3)', { timeout: 60_000 }, async () => {
    const files = [{ name: 's.svg', data: new TextEncoder().encode(svg(`${halfMask}${dilate}<rect x="20" y="20" width="60" height="60" fill="#f00" mask="url(#m)" filter="url(#f)"/>`)) }];
    const r = await typesetHtml('<!doctype html><html><head><style>@page { size: 60mm 60mm; margin: 5mm }</style></head><body><img src="s.svg" style="width: 30mm"></body></html>', { loadFont: loadCachedFont, files });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const texts: string[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const sub = obj.dict.get(PDFName.of('Subtype'));
      if ((sub && sub !== PDFName.of('Form')) || obj.dict.get(PDFName.of('Length1'))) continue;
      try {
        texts.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
      } catch {
        // 読めない流れ (書体など) は飛ばす
      }
    }
    const all = texts.join('\n');
    // 画像を描く流れにはマスクを置かず、グループ (KmG) を置く所でマスク (KmM) を掛ける
    const imageStream = texts.find((t) => /\/KmI[^\s]*\s+Do/.test(t))!;
    expect(imageStream).toBeDefined();
    expect(imageStream).not.toMatch(/\/KmM/);
    expect(all).toMatch(/\/KmM[^\s]*\s+gs[\s\S]*?\/KmG[^\s]*\s+Do/);
  });
});

describe('feOffset でずらした、模様・グラデーションで塗った図形 (Filter Effects 1 §9.19)', () => {
  const pattern = '<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#008000"/></pattern>';
  const offset = '<filter id="o" x="-20%" y="-20%" width="140%" height="140%"><feOffset dx="15"/></filter>';

  it('模様で塗った図形は、模様ごとずれる (前は模様の代わりの灰色の一面になった)', () => {
    const shapes = shapesOf(`<defs>${pattern}${offset}</defs><rect x="20" y="20" width="40" height="40" fill="url(#p)" filter="url(#o)"/>`);
    const sh = shapes.find((x) => x.fillPattern);
    expect(sh).toBeDefined();
    // 模様の位置もずれる (タイルの原点 0 → 15)
    expect(sh!.fillPattern!.matrix[4]).toBeCloseTo(15);
    // 画素に描く (画素の計算の道・PDF/X の平らにする所と同じ描き方): 緑の升はもとの 20〜25 → 35〜40、間は透明
    const px = paintShapesToPixels(shapes, [1, 0, 0, 1, 0, 0], 100, 100);
    const at = (x: number, y: number) => Array.from(px.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));
    const green = at(37, 22);
    expect(green[3]).toBeCloseTo(1, 2);
    expect(green[1]).toBeGreaterThan(green[0] + 0.1);
    expect(at(32, 22)[3]).toBeCloseTo(0, 2);
    expect(at(42, 22)[3]).toBeCloseTo(0, 2);
  });

  it('グラデーションで塗った図形・線は、グラデーションごとずれる (前は終わりの色の一面になった)', () => {
    const grad = '<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="20" x2="60"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>';
    const fill = shapesOf(`<defs>${grad}${offset}</defs><rect x="20" y="20" width="40" height="40" fill="url(#g)" filter="url(#o)"/>`).find((x) => x.fillPaint);
    expect(fill?.fillPaint?.matrix[4]).toBeCloseTo(15);
    const stroke = shapesOf(`<defs>${grad}${offset}</defs><rect x="20" y="20" width="40" height="40" fill="none" stroke="url(#g)" stroke-width="4" filter="url(#o)"/>`).find((x) => x.strokePaint);
    expect(stroke?.strokePaint?.matrix[4]).toBeCloseTo(15);
  });

  it('ずらしてぼかした模様の図形は、太らせる線を灰色で描かない (模様の線は描けないので、塗りだけを重ねる)', () => {
    const blur = '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feOffset dx="5"/><feGaussianBlur stdDeviation="2"/></filter>';
    const shapes = shapesOf(`<defs>${pattern}${blur}</defs><rect x="20" y="20" width="40" height="40" fill="url(#p)" filter="url(#b)"/>`);
    expect(shapes.length).toBeGreaterThan(1);
    for (const x of shapes) {
      expect(x.fillPattern).toBeDefined();
      expect(x.stroke).toBeUndefined();
    }
  });
});
