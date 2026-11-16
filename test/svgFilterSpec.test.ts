import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg } from '../src/svg';
import { rasterFilter, turbulence, turbulenceInit } from '../src/svgFilterRaster';

// SVG の filter の画素の計算と、context-fill・context-stroke の塗りを、仕様の式どおりかで確かめる。
// 期待の値は、同じ SVG を Chromium (deviceScaleFactor 1) で描いた画素と比べて確かめたもの。なぜその値かを、仕様の式からコメントに書く。
// (feTurbulence の stitch のつなぎ目だけは、Chromium (Skia) が仕様と違う (nWrapX にタイルの x を足さない) ので、仕様の式で確かめる)

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string, attrs = 'width="80" height="80"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** filter の結果を、1 単位 = 1 画素で計算し、根の座標 (x, y) の画素 (sRGB・乗算していない RGBA) を返す */
function run(body: string, attrs?: string) {
  const d = parseSvg(svg(body, attrs), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!;
  const img = d.shapes.find((x) => x.image?.pixels)!.image!;
  const px = img.pixels!;
  // 画像は単位正方形を [w, 0, 0, -h, x, y + h] で filter の領域に置く (filter の領域の左上が画像の左上)
  const [w, , , mh, ex, ey] = img.matrix;
  const rx = ex;
  const ry = ey + mh;
  const at = (x: number, y: number) => {
    const ix = Math.floor(((x + 0.5 - rx) / w) * px.width);
    const iy = Math.floor(((y + 0.5 - ry) / -mh) * px.height);
    if (ix < 0 || iy < 0 || ix >= px.width || iy >= px.height) return [0, 0, 0, 0];
    return Array.from(px.rgba.subarray((iy * px.width + ix) * 4, (iy * px.width + ix) * 4 + 4));
  };
  return { at };
}

const grad = '<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>';

describe('feTile の部分領域 (Filter Effects 1 §9.4・§9.20)', () => {
  // 赤→青のグラデーションの矩形 (0〜60)。feOffset の部分領域 (0, 0, 15, 15) を feTile で並べる
  const body = (tile: string) =>
    `<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="60" height="60"><feOffset in="SourceGraphic" x="0" y="0" width="15" height="15"/>${tile}</filter>` +
    `<rect width="60" height="60" fill="url(#g)" filter="url(#f)"/>${grad}`;
  it('部分領域を書かない feTile は、filter の領域の全体に並べる (既定の部分領域は filter の領域で、入力の部分領域ではない)', () => {
    const r = run(body('<feTile/>'));
    // 入力のタイルの (5, 5) が、15 ごとに繰り返す。Chromium も同じ (前は入力の部分領域で切られ、15 より右・下は透明だった)
    const c = r.at(5, 5);
    expect(c[3]).toBe(255);
    for (const [x, y] of [[20, 5], [35, 20], [50, 50]]) expect(r.at(x, y)).toEqual(c);
  });
  it('部分領域を書いた feTile は、その部分領域だけに並べる', () => {
    const r = run(body('<feTile x="10" y="5" width="40" height="30"/>'));
    // タイルの原点は入力の部分領域の (0, 0)。(20, 20) はタイルの (5, 5) と同じ。部分領域 (10〜50, 5〜35) の外は透明
    const src = run(body('<feTile/>')).at(5, 5);
    expect(src[3]).toBe(255);
    expect(r.at(20, 20)).toEqual(src);
    expect(r.at(5, 20)[3]).toBe(0);
    expect(r.at(20, 40)[3]).toBe(0);
  });
});

describe('filter の要素の x・y・width・height の百分率 (Filter Effects 1 §9.4・§8、SVG 2 §8.9)', () => {
  const green = [0, 255, 0, 255];
  it('primitiveUnits が userSpaceOnUse なら、百分率は viewport に対する長さ (filter の領域に対してではない)', () => {
    // 既定の filter の領域 (外接矩形 30〜50 の −10%〜120%: 28〜52)。x="0" width="100%" は 0〜80 (viewport の幅) なので、領域の全体が緑。
    // 前は領域の画素数の百分率を領域の左上からのずれにしていて、x="0" が利用者の座標の 0 (領域の外) になり、何も描かなかった
    const r = run('<filter id="f"><feFlood flood-color="#0f0" x="0" y="0" width="100%" height="100%"/></filter><rect x="30" y="30" width="20" height="20" filter="url(#f)"/>');
    expect(r.at(29, 29)).toEqual(green);
    expect(r.at(40, 40)).toEqual(green);
    expect(r.at(51, 51)).toEqual(green);
  });
  it('viewBox があれば、百分率は viewBox の幅・高さに対するもの', () => {
    // viewBox 0 0 120 120: x=25% → 30、y=10% → 12、width=50% → 60、height=20% → 24 (利用者の座標)。Chromium (60px に描く) と同じ
    const r = run(
      '<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><feFlood flood-color="#0f0" x="25%" y="10%" width="50%" height="20%"/></filter><rect x="30" y="30" width="20" height="20" filter="url(#f)"/>',
      'width="60" height="60" viewBox="0 0 120 120"',
    );
    expect(r.at(30, 12)).toEqual(green);
    expect(r.at(89, 35)).toEqual(green);
    expect(r.at(29, 20)[3]).toBe(0);
    expect(r.at(90, 20)[3]).toBe(0);
    expect(r.at(50, 36)[3]).toBe(0);
  });
  it('primitiveUnits が objectBoundingBox なら、百分率は外接矩形の割合 (20% は 0.2 と同じ)', () => {
    // 外接矩形 (10, 20, 30, 20): x=20% → 10 + 6 = 16、width=50% → 15 (16〜31)、y=40% → 28、height=30% → 6 (28〜34)
    const body = (x: string, y: string, w: string, h: string) =>
      `<filter id="f" primitiveUnits="objectBoundingBox"><feFlood flood-color="#0f0" x="${x}" y="${y}" width="${w}" height="${h}"/></filter><rect x="10" y="20" width="30" height="20" filter="url(#f)"/>`;
    const a = run(body('20%', '40%', '50%', '30%'));
    const b = run(body('0.2', '0.4', '0.5', '0.3'));
    for (const [x, y] of [[16, 28], [30, 33], [15, 30], [31, 30], [20, 27], [20, 34]]) expect(a.at(x, y)).toEqual(b.at(x, y));
    expect(a.at(16, 28)).toEqual(green);
    expect(a.at(30, 33)).toEqual(green);
    expect(a.at(15, 30)[3]).toBe(0);
    expect(a.at(31, 30)[3]).toBe(0);
  });
});

describe('feTurbulence の stitchTiles="stitch" (Filter Effects 1 §9.21 の参照の実装)', () => {
  // 参照の実装は、つなぎ目の比較 (bx0 >= nWrapX) の後に格子の番号を BM で切る。stitch のタイルの右の端のノイズは、左の端のノイズに
  // 続く: 周波数をタイルの幅で割り切れる値に直す (fx·w が整数 nWidth) ので、右の端 (x = tileX + w) の格子の点は、nWrapX を超えて
  // nWidth を引かれ、左の端の格子の点と同じ勾配を使う。よって turbulence(tileX + w − ε) → turbulence(tileX)
  const tile = { x: 10, y: 10, w: 30, h: 30 };
  const T = turbulenceInit(3);
  for (const fractal of [false, true])
    it(`${fractal ? 'fractalNoise' : 'turbulence'}: タイルの右の端と左の端、下の端と上の端のノイズが続く`, () => {
      for (let ch = 0; ch < 4; ch++)
        for (const t of [10.3, 17, 25.5, 33.2, 39]) {
          const right = turbulence(T, ch, tile.x + tile.w - 1e-9, t, 0.07, 0.11, 3, fractal, { ...tile });
          const left = turbulence(T, ch, tile.x, t, 0.07, 0.11, 3, fractal, { ...tile });
          expect(Math.abs(right - left)).toBeLessThan(1e-6);
          const bottom = turbulence(T, ch, t, tile.y + tile.h - 1e-9, 0.07, 0.11, 3, fractal, { ...tile });
          const top = turbulence(T, ch, t, tile.y, 0.07, 0.11, 3, fractal, { ...tile });
          expect(Math.abs(bottom - top)).toBeLessThan(1e-6);
        }
    });
  it('stitch が無ければ、右の端と左の端のノイズは続かない (上の確かめが、ノイズの値によらず成り立つものでないこと)', () => {
    const diffs = [10.3, 17, 25.5, 33.2, 39].map((t) => Math.abs(turbulence(T, 0, tile.x + tile.w - 1e-9, t, 0.07, 0.07, 3, true) - turbulence(T, 0, tile.x, t, 0.07, 0.07, 3, true)));
    expect(Math.max(...diffs)).toBeGreaterThan(0.01);
  });
});

describe('feDisplacementMap の color-interpolation-filters は in2 に掛かる (Filter Effects 1 §9.11)', () => {
  // in: 幅 4 の黒と白の縦の縞 (周期 8。黒は 0〜3・8〜11…)。in2: 要素の図形 (#808080 の矩形。SourceGraphic は sRGB)。
  // P'(x, y) = P(x + scale·(C(x, y) − 0.5), …)。C は in2 の成分を、要素の color-interpolation-filters の色空間で読んだ値
  const stripes =
    '<feFlood flood-color="#fff" result="w"/><feFlood flood-color="#000" x="0" y="0" width="4" height="80" result="b"/>' +
    '<feComposite in="b" in2="w" x="0" y="0" width="8" height="80" result="bw"/><feTile in="bw" result="s"/>';
  const body = (cif: string) =>
    `<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">${stripes}<feDisplacementMap in="s" in2="SourceGraphic" scale="20" xChannelSelector="R" yChannelSelector="G" ${cif}/></filter>` +
    '<rect width="80" height="80" fill="#808080" filter="url(#f)"/>';
  it('既定 (linearRGB): #808080 は線形で 0.2158 なので、20 × (0.2158 − 0.5) ≈ −5.7 → 6 画素ずれる', () => {
    // (10, 40) は縞の (4, 34) (白)。Chromium も白 (前は sRGB の値 0.502 で読み、ずれが 0 で、縞の (10) の黒のままだった)
    const r = run(body(''));
    expect(r.at(10, 40)).toEqual([255, 255, 255, 255]);
    expect(r.at(14, 40)).toEqual([0, 0, 0, 255]);
  });
  it('color-interpolation-filters="sRGB" なら、0.502 で読むので、ずれは 0', () => {
    const r = run(body('color-interpolation-filters="sRGB"'));
    expect(r.at(10, 40)).toEqual([0, 0, 0, 255]);
    expect(r.at(14, 40)).toEqual([255, 255, 255, 255]);
  });
});

describe('context-fill・context-stroke の模様・グラデーションは、context element の座標系と外接矩形で当てる (SVG 2 §13.2)', () => {
  const shapes = (body: string) => parseSvg(svg(body, 'width="200" height="100"'), parse)!.shapes;
  const marker = (paint: string) => `<marker id="mk" markerWidth="16" markerHeight="16" refX="8" refY="8" markerUnits="userSpaceOnUse" orient="auto"><circle cx="8" cy="8" r="7" fill="${paint}"/></marker>`;
  const path = (attrs: string) => `<path d="M20 50 L100 20 L180 50" stroke-width="4" marker-start="url(#mk)" marker-mid="url(#mk)" marker-end="url(#mk)" ${attrs}/>`;
  it('marker の中身の context-stroke のグラデーションは、path の外接矩形 (20〜180) で塗る。始点の marker は赤、終点は青', () => {
    // Chromium も同じ (前は marker の円ごとの外接矩形に当てて、どの円も赤→青だった)
    const sh = shapes(grad + marker('context-stroke') + path('fill="none" stroke="url(#g)"'));
    const line = sh.find((s) => s.strokePaint)!;
    const dots = sh.filter((s) => s.fillPaint);
    expect(dots).toHaveLength(3);
    // グラデーションの空間の 0〜1 は、path の外接矩形の左 (20) から右 (180)
    expect(line.strokePaint!.matrix[0]).toBeCloseTo(160);
    expect(line.strokePaint!.matrix[4]).toBeCloseTo(20);
    for (const d of dots) expect(d.fillPaint!.matrix.map((v) => +v.toFixed(6))).toEqual(line.strokePaint!.matrix.map((v) => +v.toFixed(6)));
  });
  it('context-fill の模様も、path の座標系と外接矩形で当てる', () => {
    const sh = shapes('<pattern id="pt" width="0.1" height="0.2"><rect width="8" height="8" fill="#0a0"/></pattern>' + marker('context-fill') + path('fill="url(#pt)" stroke="#000"'));
    const body = sh.find((s) => s.fillPattern && s.stroke)!;
    const dots = sh.filter((s) => s.fillPattern && s !== body);
    expect(dots).toHaveLength(3);
    for (const d of dots) expect(d.fillPattern!.matrix.map((v) => +v.toFixed(6))).toEqual(body.fillPattern!.matrix.map((v) => +v.toFixed(6)));
  });
  it('use の中身の context-fill のグラデーションは、use の外接矩形 (中身の全体) と、x・y でずらした use の座標系で塗る', () => {
    // 中身は 2 つの矩形 (0〜40 と 120〜160)。use の x=20 で、外接矩形は use の座標系の 0〜160 (根の 20〜180)。Chromium も同じ
    const sh = shapes(grad + '<defs><g id="u"><rect width="40" height="20" fill="context-fill"/><rect x="120" width="40" height="20" fill="context-fill"/></g></defs><use href="#u" x="20" y="40" fill="url(#g)"/>');
    const rects = sh.filter((s) => s.fillPaint);
    expect(rects).toHaveLength(2);
    for (const r of rects) {
      expect(r.fillPaint!.matrix[0]).toBeCloseTo(160);
      expect(r.fillPaint!.matrix[4]).toBeCloseTo(20);
    }
  });
  it('単色の context-fill・context-stroke は、これまでどおり', () => {
    const sh = shapes(marker('context-stroke') + path('fill="none" stroke="#00aa00"'));
    expect(sh.filter((s) => s.fill === '#00aa00')).toHaveLength(3);
  });
});

describe('図形で描く filter の、要素の部分領域 (Filter Effects 1 §9.4)', () => {
  // 部分領域を書いた要素の結果は、部分領域の外が透明 (§9.4)。図形で描くときは、層を部分領域の矩形で切り抜く。
  // 期待の値は、同じ SVG を Chromium (deviceScaleFactor 1) で描いた画素と比べて確かめたもの
  type Seg = { op: string; x?: number; y?: number };
  const vec = (filter: string, rect = '<rect x="20" y="20" width="20" height="20" fill="#0000ff" filter="url(#f)"/>') =>
    parseSvg(svg(`<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">${filter}</filter>${rect}`), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!.shapes;
  /** 点 (x, y) が、多角形 (ここでは矩形だけ) の外接矩形の中か */
  const inside = (segs: Seg[], x: number, y: number) => {
    const ps = segs.filter((g) => g.op !== 'Z') as Array<{ x: number; y: number }>;
    return x >= Math.min(...ps.map((p) => p.x)) && x <= Math.max(...ps.map((p) => p.x)) && y >= Math.min(...ps.map((p) => p.y)) && y <= Math.max(...ps.map((p) => p.y));
  };
  /** 点 (x, y) を塗る図形の色 (切り抜きの中にあるものだけ。無ければ undefined) */
  const colorAt = (shs: ReturnType<typeof vec>, x: number, y: number) =>
    shs.filter((sh) => !sh.image && inside(sh.segs as Seg[], x, y) && (sh.clips ?? []).every((c) => inside(c.segs as Seg[], x, y))).map((sh) => sh.fill).pop();
  const images = (shs: ReturnType<typeof vec>) => shs.filter((sh) => sh.image).length;

  it('feOffset の width の百分率 (viewport の幅 80 の 50% = 40) で、ずらした結果を x = 40 で切る', () => {
    // 矩形 20〜40 を 5 ずらすと 25〜45。部分領域は x 0〜40 (x・y・height は既定の filter の領域)。前は切らず、40〜45 も塗っていた
    const sh = vec('<feOffset dx="5" width="50%"/>');
    expect(images(sh)).toBe(0);
    expect(colorAt(sh, 38, 30)).toBe('#0000ff');
    expect(colorAt(sh, 42, 30)).toBeUndefined();
  });
  it('feOffset の絶対の長さの部分領域 (25, 25, 30, 20)', () => {
    // 矩形を (10, 0) ずらすと x 30〜50・y 20〜40。部分領域で切ると x 30〜50・y 25〜40
    const sh = vec('<feOffset dx="10" x="25" y="25" width="30" height="20"/>');
    expect(images(sh)).toBe(0);
    expect(colorAt(sh, 45, 35)).toBe('#0000ff');
    expect(colorAt(sh, 45, 22)).toBeUndefined();
  });
  it('部分領域を書いた feFlood を feComposite の in で形に塗ると、部分領域と形の重なりだけが色になる', () => {
    // feFlood は (10〜30, 10〜30) だけを赤で塗る。SourceAlpha (矩形 20〜40) の中の部分は (20〜30, 20〜30)。前は矩形の全体が赤だった
    const sh = vec('<feFlood flood-color="#ff0000" x="10" y="10" width="20" height="20"/><feComposite in2="SourceAlpha" operator="in"/>');
    expect(images(sh)).toBe(0);
    expect(colorAt(sh, 25, 25)).toBe('#ff0000');
    expect(colorAt(sh, 35, 25)).toBeUndefined();
    expect(colorAt(sh, 25, 35)).toBeUndefined();
  });
  it('部分領域を書いた要素の結果を使う要素は、既定の部分領域がその部分領域になる (ずらした後も、元の部分領域で切る)', () => {
    // a は矩形を x 20〜30 で切ったもの (部分領域 20〜30)。2 つ目の feOffset の既定の部分領域は、参照する a の部分領域 (20〜30)。
    // a を 10 ずらすと 30〜40 になり、部分領域 20〜30 の外なので、何も残らない (Chromium も何も描かない)
    const sh = vec('<feOffset x="20" width="10" result="a"/><feOffset in="a" dx="10"/>');
    expect(colorAt(sh, 25, 30)).toBeUndefined();
    expect(colorAt(sh, 35, 30)).toBeUndefined();
    // feMerge で元の図形と重ねると、既定の部分領域は filter の領域 (標準の入力を参照する)。a は自分の部分領域ごと (切った所ごと) ずれる
    const m = vec('<feOffset dx="10" x="20" width="15" result="a"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="a"/></feMerge>');
    expect(images(m)).toBe(0);
    expect(colorAt(m, 25, 30)).toBe('#0000ff');
    expect(colorAt(m, 33, 30)).toBe('#0000ff');
    expect(colorAt(m, 45, 30)).toBeUndefined();
  });
  it('filter の領域を覆う部分領域 (はみ出すもの・0% 0% 100% 100%) は、切っても変わらないので切り抜きを足さない', () => {
    const none = vec('<feOffset dx="5" dy="3"/>');
    const clipsOf = (shs: ReturnType<typeof vec>) => shs.map((s) => s.clips?.length ?? 0);
    expect(clipsOf(vec('<feOffset dx="5" dy="3" x="-50" y="-50" width="500" height="500"/>'))).toEqual(clipsOf(none));
    expect(clipsOf(vec('<feOffset dx="5" dy="3" x="0%" y="0%" width="100%" height="100%"/>'))).toEqual(clipsOf(none));
  });
  it('ぼかした層を部分領域で切るものは、図形で描かずに画素で計算する', () => {
    // ぼかしは写しの重ねの近似なので、切った縁は図形では正しく描けない。画素の計算 (rasterFilter) に回り、画像になる
    expect(images(vec('<feGaussianBlur stdDeviation="3" x="30" width="40"/>'))).toBe(1);
    expect(images(vec('<feDropShadow dx="4" dy="4" stdDeviation="2" x="10" y="10" width="50" height="40"/>'))).toBe(1);
    // 部分領域で切った結果をぼかすものも同じ
    expect(images(vec('<feOffset dx="5" width="30" result="a"/><feGaussianBlur in="a" stdDeviation="2"/>'))).toBe(1);
  });
  it('部分領域を書かない影・ずらしは、これまでどおり図形で描く (画像にしない)', () => {
    const shadow = vec('<feDropShadow dx="3" dy="3" stdDeviation="2"/>');
    expect(images(shadow)).toBe(0);
    expect(shadow.length).toBeGreaterThan(1);
    const merged = vec('<feOffset dx="6" dy="6" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge>');
    expect(images(merged)).toBe(0);
    expect(colorAt(merged, 43, 43)).toBe('#0000ff');
  });
});
