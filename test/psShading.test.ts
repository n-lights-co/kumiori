/**
 * PostScript の網かけ (shfill・PatternType 2) と並べる模様 (PatternType 1)。網かけは画素の画像、並べる模様は PaintProc の絵の写しになる
 */
import { describe, expect, it } from 'vitest';
import { latin1 } from '../src/psInterp';
import { runEps } from '../src/eps';
import { strokeOutline } from '../src/psShading';
import type { DisplayItem } from '../src/psGraphics';

const eps = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n%%EOF\n`);
type Img = Extract<DisplayItem, { k: 'image' }>;
const images = (items: DisplayItem[]) => items.filter((i): i is Img => i.k === 'image');
/** 画像の、機器の座標 (x, y) の画素の色 (0〜255)。画像の行列で画素の位置に戻す */
const pixelAt = (im: Img, x: number, y: number) => {
  const m = im.mat;
  const det = m[0] * m[3] - m[1] * m[2];
  const u = ((x - m[4]) * m[3] - (y - m[5]) * m[2]) / det;
  const v = ((y - m[5]) * m[0] - (x - m[4]) * m[1]) / det;
  const i = Math.min(im.width - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(im.height - 1, Math.max(0, Math.floor(v)));
  return Array.from(im.rgba!.subarray((j * im.width + i) * 4, (j * im.width + i) * 4 + 4));
};
const near = (a: number[], b: number[], d = 12) => a.every((v, k) => Math.abs(v - b[k]) <= d);
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

describe('PostScript の網かけ (shfill)', () => {
  it('軸 (ShadingType 2): 指数の関数で赤から青へ。Extend の外も端の色', () => {
    const r = runEps(eps('<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [20 0 80 0] /Extend [true true] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> shfill'))!;
    expect(r.warnings).toEqual([]);
    const [im] = images(r.items);
    expect(near(pixelAt(im, 5, 50), RED)).toBe(true);
    expect(near(pixelAt(im, 95, 50), BLUE)).toBe(true);
    expect(near(pixelAt(im, 50, 50), [128, 0, 128, 255])).toBe(true);
  });
  it('Extend が false なら、軸の外は描かない (透明)', () => {
    const [im] = images(runEps(eps('<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [20 0 80 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >> shfill'))!.items);
    expect(pixelAt(im, 5, 50)[3]).toBe(0);
    expect(pixelAt(im, 50, 50)[3]).toBe(255);
  });
  it('放射 (ShadingType 3): 中心は C0、外の円の上は C1。クリップの中だけ', () => {
    const r = runEps(eps('10 10 80 80 rectclip << /ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 50 0 50 50 40] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> shfill'))!;
    const [im] = images(r.items);
    expect(near(pixelAt(im, 50, 50), RED)).toBe(true);
    expect(near(pixelAt(im, 89, 50), BLUE, 20)).toBe(true);
    // 画像はクリップの外接矩形 (10〜90)
    expect(im.mat[4]).toBeCloseTo(10, 5);
    expect(im.clip).toBeDefined();
  });
  it('関数: つなぎ (FunctionType 3) と標本 (FunctionType 0)', () => {
    // 前半は赤 → 緑、後半は標本 (緑 → 青) をつなぐ
    const f0 = '<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 1 0] /N 1 >>';
    const f1 = '<< /FunctionType 0 /Domain [0 1] /Range [0 1 0 1 0 1] /Size [2] /BitsPerSample 8 /DataSource <00FF00 0000FF> >>';
    const r = runEps(eps(`<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 3 /Domain [0 1] /Functions [${f0} ${f1}] /Bounds [0.5] /Encode [0 1 0 1] >> >> shfill`))!;
    const [im] = images(r.items);
    expect(near(pixelAt(im, 1, 50), RED, 16)).toBe(true);
    expect(near(pixelAt(im, 50, 50), [0, 255, 0, 255], 16)).toBe(true);
    expect(near(pixelAt(im, 99, 50), BLUE, 16)).toBe(true);
    expect(near(pixelAt(im, 75, 50), [0, 128, 128, 255], 16)).toBe(true);
  });
  it('三角形の網 (ShadingType 4。数の配列のデータ): 頂点の色を補間し、三角形の外は描かない', () => {
    const r = runEps(eps('<< /ShadingType 4 /ColorSpace /DeviceRGB /DataSource [0 0 0 1 0 0  0 100 0 0 1 0  0 0 100 0 0 1] >> shfill'))!;
    const [im] = images(r.items);
    expect(near(pixelAt(im, 1, 1), RED, 16)).toBe(true);
    expect(near(pixelAt(im, 98, 1), [0, 255, 0, 255], 16)).toBe(true);
    expect(near(pixelAt(im, 1, 98), BLUE, 16)).toBe(true);
    expect(pixelAt(im, 90, 90)[3]).toBe(0);
  });
  it('三角形の網 (ShadingType 4。ビットに詰めたデータと Decode)', () => {
    // 頂点ごとに 印 8 ビット・x・y 8 ビット・色 8 ビット × 3 (Decode で x・y を 0〜100 に)
    const data = '<000000FF0000 00FF0000FF00 0000FF0000FF>';
    const r = runEps(eps(`<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 100 0 100 0 1 0 1 0 1] /DataSource ${data} >> shfill`))!;
    const [im] = images(r.items);
    expect(near(pixelAt(im, 1, 1), RED, 16)).toBe(true);
    expect(near(pixelAt(im, 98, 1), [0, 255, 0, 255], 16)).toBe(true);
    expect(near(pixelAt(im, 1, 98), BLUE, 16)).toBe(true);
  });
  it('Coons の面 (ShadingType 6): 4 つの角の色', () => {
    // 境界の 12 点 (正方形の辺の上) と、角の色 c00 c03 c33 c30
    const pts = '0 0 0 33 0 67 0 100 33 100 67 100 100 100 100 67 100 33 100 0 67 0 33 0';
    const r = runEps(eps(`<< /ShadingType 6 /ColorSpace /DeviceRGB /DataSource [0 ${pts} 1 0 0 0 1 0 0 0 1 1 1 0] >> shfill`))!;
    const [im] = images(r.items);
    expect(near(pixelAt(im, 1, 1), RED, 20)).toBe(true); // c00 = (0, 0)
    expect(near(pixelAt(im, 1, 98), [0, 255, 0, 255], 20)).toBe(true); // c03 = (0, 100)
    expect(near(pixelAt(im, 98, 98), BLUE, 20)).toBe(true); // c33
    expect(near(pixelAt(im, 98, 1), [255, 255, 0, 255], 20)).toBe(true); // c30
  });
});

describe('ISO 32000-2 との照らし合わせで直したところ', () => {
  it('つなぎの関数: Domain0 = Bounds0 なら、Domain0 の点は最初の関数 (§7.10.4)', () => {
    // 区間 [0, 0] は赤、(0, 1] は青。x = 0 (軸の始めの外は Extend で t = 0) は赤
    const f = '<< /FunctionType 3 /Domain [0 1] /Bounds [0] /Encode [0 1 0 1] /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [1 0 0] /N 1 >> << /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 0 1] /N 1 >>] >>';
    const [im] = images(runEps(eps(`<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [50 0 100 0] /Extend [true false] /Function ${f} >> shfill`))!.items);
    expect(near(pixelAt(im, 10, 50), RED)).toBe(true);
    expect(near(pixelAt(im, 70, 50), BLUE)).toBe(true);
  });
  it('放射: 半径が 2 つとも 0 なら何も描かない (§8.7.4.5.4)', () => {
    const r = runEps(eps('<< /ShadingType 3 /ColorSpace /DeviceGray /Coords [10 10 0 90 90 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >> shfill'))!;
    expect(images(r.items)).toHaveLength(0);
  });
  it('三角形の網: 辺の印は下位 2 ビットだけを使う (§8.7.4.5.5。5 は 1 = 前の三角形の辺 bc につなぐ)', () => {
    // 三角形 a (0,0)・b (100,0)・c (0,100) と、印 5 の頂点 d (100,100) → 三角形 (b, c, d) で右上を塗る
    const r = runEps(eps('<< /ShadingType 4 /ColorSpace /DeviceGray /DataSource [0 0 0 0  0 100 0 0.5  0 0 100 1  5 100 100 1] >> shfill'))!;
    const [im] = images(r.items);
    expect(pixelAt(im, 95, 60)[3]).toBe(255);
  });
});

describe('PostScript の模様 (PatternType 1・2)', () => {
  it('網かけの模様 (PatternType 2): 塗るパスで切り抜いた網かけ', () => {
    const r = runEps(eps('<< /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> >> matrix makepattern setpattern 20 20 60 60 rectfill'))!;
    expect(r.warnings).toEqual([]);
    const [im] = images(r.items);
    expect(im.clip?.segs.length).toBeGreaterThan(0);
    expect(im.mat[4]).toBeCloseTo(20, 5);
    // x = 21 は軸の 0.21 の位置
    expect(near(pixelAt(im, 21, 50), [201, 0, 54, 255], 12)).toBe(true);
  });
  it('並べる模様 (PatternType 1): PaintProc の絵を XStep・YStep ずつずらして並べる', () => {
    const pat = '<< /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /PaintProc { pop 1 0 0 setrgbcolor 2 2 4 4 rectfill } >> matrix makepattern setpattern';
    const r = runEps(eps(`${pat} 0 0 30 20 rectfill`))!;
    expect(r.warnings).toEqual([]);
    const fills = r.items.filter((i) => i.k === 'fill');
    // 30 × 20 を覆う 3 × 2 の写し (外接矩形の端の分を含めて、それ以上)
    expect(fills.length).toBeGreaterThanOrEqual(6);
    const starts = fills.map((f) => (f.k === 'fill' && f.segs[0].op === 'M' ? `${f.segs[0].x},${f.segs[0].y}` : ''));
    for (const s of ['2,2', '12,2', '22,2', '2,12', '12,12', '22,12']) expect(starts).toContain(s);
    expect(fills.every((f) => f.k === 'fill' && f.color[0] === 1)).toBe(true);
  });
  it('色の無い模様 (PaintType 2): 塗るときの色で描く。模様の行列 (makepattern の CTM) も効く', () => {
    const pat = '<< /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /PaintProc { pop 0 0 5 5 rectfill } >> 2 2 matrix scale makepattern';
    const r = runEps(eps(`[/Pattern /DeviceRGB] setcolorspace 0 0 1 ${pat} setcolor 0 0 40 40 rectfill`))!;
    const fills = r.items.filter((i): i is Extract<DisplayItem, { k: 'fill' }> => i.k === 'fill');
    expect(fills.every((f) => f.color[2] === 1 && f.color[0] === 0)).toBe(true);
    // 模様の空間の 10 は、機器の座標の 20 (2 倍)
    const xs = [...new Set(fills.map((f) => (f.segs[0].op === 'M' ? f.segs[0].x : NaN)))].sort((a, b) => a - b);
    expect(xs).toContain(0);
    expect(xs).toContain(20);
    expect(xs).not.toContain(10);
  });
});

describe('模様の線と、標本の関数の 3 次スプライン', () => {
  it('線の輪郭: 太さ 4 の水平な線は、上下 2 ずつの長方形。突き出しの端は太さの半分だけ延びる', () => {
    const segs = strokeOutline([{ op: 'M', x: 10, y: 50 }, { op: 'L', x: 90, y: 50 }], [1, 0, 0, 1, 0, 0], 4, 2, 0, { array: [], offset: 0 });
    const xs = segs.flatMap((s) => (s.op === 'Z' ? [] : [s.x]));
    const ys = segs.flatMap((s) => (s.op === 'Z' ? [] : [s.y]));
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([8, 92, 48, 52]);
  });
  it('線の輪郭: 破線は線の部分だけ (10 の線と 10 の隙間で 80 の線 → 4 本)', () => {
    const segs = strokeOutline([{ op: 'M', x: 10, y: 50 }, { op: 'L', x: 90, y: 50 }], [1, 0, 0, 1, 0, 0], 2, 0, 0, { array: [10, 10], offset: 0 });
    expect(segs.filter((s) => s.op === 'Z')).toHaveLength(4);
  });
  it('模様の線: 線の輪郭で切り抜いた模様を描く (警告を出さない)', () => {
    const pat = '<< /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /PaintProc { pop 1 0 0 setrgbcolor 0 0 5 10 rectfill } >> matrix makepattern setpattern';
    const r = runEps(eps(`${pat} 6 setlinewidth 10 50 moveto 90 50 lineto stroke`))!;
    expect(r.warnings).toEqual([]);
    const fills = r.items.filter((i) => i.k === 'fill');
    expect(fills.length).toBeGreaterThan(0);
    // 切り抜きは線の輪郭 (y 47〜53)
    const clipYs = fills[0].clip!.segs.flatMap((s) => (s.op === 'Z' ? [] : [s.y]));
    expect([Math.min(...clipYs), Math.max(...clipYs)]).toEqual([47, 53]);
  });
  it('標本の関数の Order 3: 自然な 3 次スプライン (標本 0 1 0 1 の 0 と 1 の間の中央は 0.75。1 次なら 0.5)', () => {
    const f = (order: number) => `<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [4] /BitsPerSample 8 /Order ${order} /DataSource <00FF00FF> >>`;
    const at = (order: number) => {
      // 軸 0〜60 の 1/6 の位置 (x = 10) は、標本の番号 0.5
      const [im] = images(runEps(eps(`<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 60 0] /Function ${f(order)} >> shfill`))!.items);
      return pixelAt(im, 10, 50)[0];
    };
    expect(Math.abs(at(1) - 128)).toBeLessThan(6);
    expect(Math.abs(at(3) - 191)).toBeLessThan(6);
  });
});
