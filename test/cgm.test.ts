import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cgmToSvg, isCgm } from '../src/cgm';
import { imageInfo } from '../src/imageInfo';
import { encodeJpeg } from '../src/jpeg';

/** 命令を作る (ISO/IEC 8632-3 5.4: 類 4 ビット・番号 7 ビット・長さ 5 ビット。長さ 31 以上は長い形) */
function cmd(cls: number, id: number, data: number[] = []): number[] {
  const out: number[] = [];
  if (data.length < 31) {
    const h = (cls << 12) | (id << 5) | data.length;
    out.push(h >> 8, h & 0xff, ...data);
  } else {
    const h = (cls << 12) | (id << 5) | 31;
    out.push(h >> 8, h & 0xff, data.length >> 8, data.length & 0xff, ...data);
  }
  if (data.length % 2) out.push(0);
  return out;
}
/** 16 ビットの符号付き整数 (既定の VDC・整数・番号の精度) */
const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
/** 文字列 (長さ 1 octet + 文字) */
const str = (t: string) => [t.length, ...Array.from(t, (c) => c.charCodeAt(0))];

function metafile(body: number[]): Uint8Array {
  return new Uint8Array([
    ...cmd(0, 1, str('t')), // BEGIN METAFILE
    ...cmd(0, 3, str('p')), // BEGIN PICTURE
    ...cmd(2, 6, i16(0, 0, 100, 50)), // VDC EXTENT (0,0)-(100,50)
    ...cmd(0, 4), // BEGIN PICTURE BODY
    ...body,
    ...cmd(0, 5), // END PICTURE
    ...cmd(0, 2), // END METAFILE
  ]);
}

const pathD = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe('CGM (ISO/IEC 8632 の 2 進符号化)', () => {
  it('BEGIN METAFILE で始まるものを CGM とみなす', () => {
    expect(isCgm(metafile([]))).toBe(true);
    expect(isCgm(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it('VDC EXTENT の左下を絵の左下に写す (y は下向きに直す)。abstract の絵は幅 400px', () => {
    const r = cgmToSvg(metafile(cmd(4, 1, i16(0, 0, 100, 50))))!; // POLYLINE (0,0)-(100,50)
    expect(r.width).toBe(400);
    expect(r.height).toBe(200);
    expect(pathD(r.svg)[0]).toBe('M0 200L400 0');
  });

  it('DISJOINT POLYLINE は 2 点ずつの線分', () => {
    const r = cgmToSvg(metafile(cmd(4, 2, i16(0, 0, 10, 0, 0, 50, 10, 50))))!;
    expect(pathD(r.svg)[0]).toBe('M0 200L40 200M0 0L40 0');
  });

  it('既定の内側の塗り方は hollow (塗らずに境界を描く)、solid は塗りの色で塗る', () => {
    const hollow = cgmToSvg(metafile(cmd(4, 7, i16(0, 0, 10, 0, 10, 10))))!;
    expect(hollow.svg).toMatch(/<path d="[^"]+Z" fill="none" stroke="#000000"/);
    const solid = cgmToSvg(metafile([...cmd(5, 22, i16(1)), ...cmd(4, 7, i16(0, 0, 10, 0, 10, 10))]))!;
    expect(solid.svg).toMatch(/fill="#000000" fill-rule="evenodd" stroke="none"/);
  });

  it('POLYGON SET: 閉じる印で多角形を分け、見えない辺は辺として描かない', () => {
    const data = i16(0, 0, 1, 10, 0, 0, 10, 10, 3, 50, 0, 1, 60, 0, 1, 60, 10, 2);
    const r = cgmToSvg(metafile([...cmd(5, 30, i16(1)), ...cmd(4, 8, data)]))!;
    const [fill, edges] = pathD(r.svg);
    expect(fill.match(/Z/g)!.length).toBe(2);
    // 辺: 1 つ目は (0,0)→(10,0) と閉じる辺の 2 本 ((10,0)→(10,10) は見えない)、2 つ目は閉じる辺 (見えない) を除く 2 本
    expect(edges.match(/M/g)!.length).toBe(4);
  });

  it('ELLIPTICAL ARC は第 1 の共役半径から第 2 へ向かう向きに描く', () => {
    // 中心 (50,25)、共役半径 (60,25)・(50,35)。始め (1,0)、終わり (0,1) → 右から上への 4 分の 1
    const r = cgmToSvg(metafile(cmd(4, 18, i16(50, 25, 60, 25, 50, 35, 1, 0, 0, 1))))!;
    const pts = pathD(r.svg)[0].split(/[ML]/).filter(Boolean).map((p) => p.split(' ').map(Number));
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(first[0]).toBeCloseTo(240);
    expect(first[1]).toBeCloseTo(100);
    expect(last[0]).toBeCloseTo(200);
    expect(last[1]).toBeCloseTo(60);
    // 途中の点は右上 (SVG では x が中心より右、y が中心より上)
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid[0]).toBeGreaterThan(200);
    expect(mid[1]).toBeLessThan(100);
  });

  it('CIRCULAR ARC CENTRE の始めと終わりの向きが同じなら、円全体を描く (附属書 D の推奨)', () => {
    const r = cgmToSvg(metafile(cmd(4, 15, i16(50, 25, 1, 0, 1, 0, 10))))!;
    const pts = pathD(r.svg)[0].split(/[ML]/).filter(Boolean);
    expect(pts.length).toBeGreaterThan(100);
    expect(pts[0]).toBe(pts[pts.length - 1]);
  });

  it('色表 (COLOUR TABLE) の色で描き、線の太さは scaled の倍率', () => {
    const body = [
      ...cmd(5, 34, [2, 255, 0, 0]), // 色番号 2 = 赤
      ...cmd(5, 4, [2]), // LINE COLOUR 2
      ...cmd(5, 3, i16(10, 0)), // LINE WIDTH 10.0 (固定小数点 32 ビット)
      ...cmd(4, 1, i16(0, 0, 10, 10)),
    ];
    const r = cgmToSvg(metafile(body))!;
    expect(r.svg).toContain('stroke="#ff0000"');
    expect(r.svg).toMatch(/stroke-width="2\.56"/);
  });

  it('長い形の命令の分割された引数をつなぐ', () => {
    const pts = i16(0, 0, 10, 10, 20, 0, 30, 10, 40, 0, 50, 10, 60, 0, 70, 10);
    // 1 つ目の分割 (続きあり) と 2 つ目
    const a = pts.slice(0, 16);
    const b = pts.slice(16);
    const h = (4 << 12) | (1 << 5) | 31;
    const bytes = [h >> 8, h & 0xff, 0x80, a.length, ...a, 0x00, b.length, ...b];
    const r = cgmToSvg(metafile(bytes))!;
    expect(pathD(r.svg)[0].match(/L/g)!.length).toBe(7);
  });

  it('閉じた図形 (BEGIN FIGURE 〜 END FIGURE): 線の要素をつないで 1 つの領域にし、END FIGURE で塗る', () => {
    const body = [
      ...cmd(5, 22, i16(1)), // INTERIOR STYLE solid
      ...cmd(0, 8), // BEGIN FIGURE
      ...cmd(4, 1, i16(0, 0, 10, 0)), // POLYLINE
      ...cmd(4, 1, i16(10, 10, 0, 10)), // POLYLINE (前の終わりと離れている → 暗黙の境界でつなぐ)
      ...cmd(0, 9), // END FIGURE
    ];
    const r = cgmToSvg(metafile(body))!;
    const d = pathD(r.svg);
    // 塗りの経路が 1 つだけ (線としては描かない)
    expect(d).toHaveLength(1);
    expect(d[0]).toBe('M0 200L40 200L40 160L0 160Z');
    expect(r.svg).toMatch(/fill="#000000" fill-rule="evenodd"/);
  });

  it('閉じた図形の中の NEW REGION は、領域を分ける', () => {
    const body = [
      ...cmd(5, 22, i16(1)),
      ...cmd(0, 8),
      ...cmd(4, 1, i16(0, 0, 10, 0, 10, 10)),
      ...cmd(3, 10), // NEW REGION
      ...cmd(4, 1, i16(50, 0, 60, 0, 60, 10)),
      ...cmd(0, 9),
    ];
    const d = pathD(cgmToSvg(metafile(body))!.svg);
    expect(d).toHaveLength(1);
    expect(d[0].match(/Z/g)!.length).toBe(2);
  });

  it('scaled の線・印は vector-effect で拡大縮小を受けない。transform を持つ要素の切り抜きは外側の g に付ける', () => {
    const body = [
      ...cmd(3, 6, [0, 1]), // CLIP INDICATOR on
      ...cmd(4, 1, i16(0, 0, 10, 10)), // POLYLINE (scaled の線)
      ...cmd(5, 6, i16(5)), // MARKER TYPE ×
      ...cmd(4, 3, i16(50, 25)), // POLYMARKER
    ];
    const r = cgmToSvg(metafile(body))!;
    expect(r.svg).toMatch(/<path d="M0 200L40 160"[^>]*vector-effect="non-scaling-stroke"/);
    expect(r.svg).toMatch(/<g clip-path="url\(#cgmc\d+\)"><path [^>]*transform="translate\(200 100\)" vector-effect="non-scaling-size non-scaling-stroke"\/><\/g>/);
  });

  it('RESTRICTED TEXT の文字の高さは、箱の高さを超えない', () => {
    const body = [
      ...cmd(5, 15, i16(40)), // CHARACTER HEIGHT 40
      ...cmd(4, 5, [...i16(80, 10, 0, 0), ...i16(1), ...str('ABC')]),
    ];
    const r = cgmToSvg(metafile(body))!;
    const fs = parseFloat(/font-size="([\d.]+)"/.exec(r.svg)![1]);
    expect(fs * 0.72).toBeCloseTo(10, 1);
    expect(r.svg).toMatch(/data-max-length="80"/);
  });

  /** 絵の記述子 (desc) を足した CGM */
  const withDesc = (desc: number[], body: number[]) =>
    new Uint8Array([
      ...cmd(0, 1, str('t')),
      ...cmd(0, 3, str('p')),
      ...cmd(2, 6, i16(0, 0, 100, 50)),
      ...desc,
      ...cmd(0, 4),
      ...body,
      ...cmd(0, 5),
      ...cmd(0, 2),
    ]);
  const bgOf = (svg: string) => /<rect x="0" y="0" [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];

  it('背景色: BACKGROUND COLOUR と、絵の記述子の色表の 0 番の、後に来た方 (第 1 部 7.4.7・7.7.34)', () => {
    const line = cmd(4, 1, i16(0, 0, 10, 10));
    // BACKGROUND COLOUR (赤) の後に色表の 0 番 (青) → 青
    expect(bgOf(cgmToSvg(withDesc([...cmd(2, 7, [255, 0, 0]), ...cmd(5, 34, [0, 0, 0, 255])], line))!.svg)).toBe('#0000ff');
    // 色表の 0 番 (青) の後に BACKGROUND COLOUR (赤) → 赤。indexed では色番号 0 も赤になる
    const r = cgmToSvg(withDesc([...cmd(5, 34, [0, 0, 0, 255]), ...cmd(2, 7, [255, 0, 0])], [...cmd(5, 4, [0]), ...line]))!;
    expect(bgOf(r.svg)).toBe('#ff0000');
    expect(r.svg).toMatch(/<path d="M0 200L40 160" fill="none" stroke="#ff0000"/);
    // 絵の本体で色番号 0 を決めても、背景色は変わらない (その後の色番号 0 の図形だけが変わる)
    const r2 = cgmToSvg(withDesc([...cmd(2, 7, [255, 0, 0])], [...cmd(5, 34, [0, 0, 255, 0]), ...cmd(5, 4, [0]), ...line]))!;
    expect(bgOf(r2.svg)).toBe('#ff0000');
    expect(r2.svg).toContain('stroke="#00ff00"');
  });

  it('直接色の流儀 (direct) では、線などの色の既定値は前景色 (色表の 1 番ではない。第 1 部 8 章)', () => {
    const desc = [...cmd(2, 2, i16(1)), ...cmd(5, 34, [1, 255, 0, 0])]; // COLOUR SELECTION MODE direct、色表の 1 番 = 赤
    const r = cgmToSvg(withDesc(desc, cmd(4, 1, i16(0, 0, 10, 10))))!;
    expect(r.svg).toContain('stroke="#000000"');
    // 色を決めれば、その直接色で描く
    const r2 = cgmToSvg(withDesc(desc, [...cmd(5, 4, [0, 0, 255]), ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
    expect(r2.svg).toContain('stroke="#0000ff"');
  });

  // ── 規格の残りの要素 (第 1 部 7.2.16・7.4.17〜19・7.6.9・7.6.21〜29・7.7.17・7.7.32〜33・7.10) ──

  /** 固定小数点 32 ビットの実数 (既定の REAL PRECISION) */
  const fx = (...v: number[]) => v.flatMap((x) => {
    const w = Math.floor(x);
    const f = Math.round((x - w) * 65536);
    return [...i16(w), (f >> 8) & 0xff, f & 0xff];
  });
  /** <image> の PNG を RGBA にする (無圧縮の zlib・フィルタ 0) と、その行列 */
  const images = (svg: string) =>
    [...svg.matchAll(/<image [^>]*transform="matrix\(([^)]+)\)"[^>]*href="data:image\/png;base64,([^"]+)"/g)].map((m) => {
      const b = Buffer.from(m[2], 'base64');
      const w = b.readUInt32BE(16);
      const h = b.readUInt32BE(20);
      const idat: Buffer[] = [];
      for (let o = 8; o < b.length; ) {
        const len = b.readUInt32BE(o);
        if (b.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
        o += 12 + len;
      }
      const raw = inflateSync(Buffer.concat(idat));
      const px = (x: number, y: number) => Array.from(raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4));
      return { w, h, px, m: m[1].split(' ').map(Number) };
    });
  const RED = [255, 0, 0, 255];
  const BLUE = [0, 0, 255, 255];
  const table = cmd(5, 34, [2, 255, 0, 0, 0, 0, 255]); // 色番号 2 = 赤、3 = 青

  it('CELL ARRAY (詰めた並び): 行は P から R へ、行の進む向きは R から Q へ。各行は語の境目から始まる', () => {
    // P = (0, 50)、Q = (30, 30)、R = (30, 50): 3 × 2 のセル。1 行目 赤・青・赤 (+ 埋め 1 octet)、2 行目 青・赤・青
    const body = [...table, ...cmd(4, 9, [...i16(0, 50, 30, 30, 30, 50), ...i16(3, 2, 8, 1), 2, 3, 2, 0, 3, 2, 3])];
    const [img] = images(cgmToSvg(metafile(body))!.svg);
    expect([img.w, img.h]).toEqual([3, 2]);
    expect(img.m).toEqual([120, 0, 0, 80, 0, 0]);
    expect([img.px(0, 0), img.px(1, 0), img.px(2, 0), img.px(0, 1)]).toEqual([RED, BLUE, RED, BLUE]);
  });

  it('CELL ARRAY (連なり): 行ごとに (数・色) の並び。TRANSPARENT CELL COLOUR の色は描かない', () => {
    const desc = cmd(3, 20, [...i16(1), 3]); // 色番号 3 のセルは透明
    const row = [...i16(2), 2, ...i16(1), 3]; // 赤 2 つ、青 1 つ (6 octet)
    const r = cgmToSvg(withDesc(desc, [...table, ...cmd(4, 9, [...i16(0, 50, 30, 30, 30, 50), ...i16(3, 2, 8, 0), ...row, ...row])]))!;
    const [img] = images(r.svg);
    expect([img.px(0, 1), img.px(1, 1), img.px(2, 1)]).toEqual([RED, RED, [0, 0, 0, 0]]);
  });

  it('BEGIN TILE ARRAY 〜 BITONAL TILE・TILE 〜 END TILE ARRAY: タイルを並べて 1 枚の画素にし、中身のある範囲を描く', () => {
    // 2 × 1 のタイル (1 枚 2 × 2 のセル)。セルの大きさ 0.125 (VDC の 1 単位に 0.125 セル = 1 セル 8 VDC)。行の進む向きは 270 度 (下へ)
    const begin = cmd(0, 19, [...i16(0, 50), ...i16(0, 1), ...i16(2, 1, 2, 2), ...fx(0.125, 0.125), ...i16(0, 0, 4, 2)]);
    // BITONAL TILE: 圧縮なし、背景 赤・前景 青、ビット 10 / 01
    const bitonal = cmd(4, 28, [...i16(5, 0), 2, 3, 0, 0b10010000, 0]);
    // TILE: 連なり (数 8 ビット + 色番号 8 ビット)。SDR = (型 I, 数 I, 精度 I)。青 3 つ、赤 1 つ
    const tileRl = cmd(4, 29, [...i16(6, 0, 8), 6, ...i16(1, 1, 8), 3, 3, 1, 2]);
    const r = cgmToSvg(metafile([...table, ...begin, ...bitonal, ...tileRl, ...cmd(0, 20)]))!;
    const [img] = images(r.svg);
    expect([img.w, img.h]).toEqual([4, 2]);
    expect([img.px(0, 0), img.px(1, 0), img.px(0, 1), img.px(1, 1)]).toEqual([BLUE, RED, RED, BLUE]);
    expect([img.px(2, 0), img.px(3, 0), img.px(2, 1), img.px(3, 1)]).toEqual([BLUE, BLUE, BLUE, RED]);
    // 4 セル × 8 VDC = 32 VDC = 128px、下へ 2 セル = 16 VDC = 64px
    expect(img.m).toEqual([128, 0, 0, 64, 0, 0]);
  });

  it('PARABOLIC ARC は中心を制御点とする 2 次のベジエ曲線、HYPERBOLIC ARC の点は双曲線の上', () => {
    const para = cgmToSvg(metafile(cmd(4, 23, i16(0, 0, 0, 50, 100, 0))))!;
    expect(pathD(para.svg)[0]).toBe('M0 0Q0 200 400 200');
    // 中心 (50, 25)、横の半径の端 (60, 25)、共役の半径の端 (50, 35): ((x−50)/10)² − ((y−25)/10)² = 1
    const hyp = cgmToSvg(metafile(cmd(4, 22, i16(50, 25, 60, 25, 50, 35, 2, -1, 2, 1))))!;
    const pts = pathD(hyp.svg)[0].split(/[ML]/).filter(Boolean).map((q) => q.split(' ').map(Number));
    expect(pts.length).toBeGreaterThan(10);
    for (const [x, y] of pts) expect(((x / 4 - 50) / 10) ** 2 - ((50 - y / 4 - 25) / 10) ** 2).toBeCloseTo(1, 1);
  });

  it('NON-UNIFORM B-SPLINE は制御点を通る (端を揃えた 1 次)、NON-UNIFORM RATIONAL B-SPLINE は重みで円弧を描く', () => {
    // 次数 2 (1 次)、制御点 3、節点 0 0 1 2 2、範囲 0〜2
    const nub = cgmToSvg(metafile(cmd(4, 24, [...i16(2, 3), ...i16(0, 0, 50, 50, 100, 0), ...fx(0, 0, 1, 2, 2, 0, 2)])))!;
    const d = pathD(nub.svg)[0];
    expect(d.startsWith('M0 200')).toBe(true);
    expect(d.endsWith('L400 200')).toBe(true);
    expect(d).toContain('L200 0');
    // 次数 3 (2 次)、制御点 (40,0) (40,40) (0,40)、重み 1 √2/2 1: 中心 (0, 0)、半径 40 の 4 分の 1 の円
    const nurb = cgmToSvg(metafile(cmd(4, 25, [...i16(3, 3), ...i16(40, 0, 40, 40, 0, 40), ...fx(0, 0, 0, 1, 1, 1, 0, 1), ...fx(1, Math.SQRT1_2, 1)])))!;
    const pts = pathD(nurb.svg)[0].split(/[ML]/).filter(Boolean).map((q) => q.split(' ').map(Number));
    for (const [x, y] of pts) expect(Math.hypot(x / 4, 50 - y / 4)).toBeCloseTo(40, 1);
  });

  it('PATTERN TABLE・PATTERN SIZE: 内側の塗り方 pattern は、色の並びを模様の箱に敷く', () => {
    const body = [
      ...table,
      ...cmd(5, 32, [...i16(1, 2, 2, 8), 2, 3, 3, 2]), // 模様 1: 赤 青 / 青 赤
      ...cmd(5, 33, i16(0, 10, 10, 0)), // 高さ (0, 10)・幅 (10, 0)
      ...cmd(5, 22, i16(2)), // pattern
      ...cmd(4, 11, i16(0, 0, 100, 50)),
    ];
    const r = cgmToSvg(metafile(body))!;
    // 中身 (セルの矩形) の pattern と、それを href で引いて置き方を書いた pattern (IMG-19 (3))
    expect(r.svg).toMatch(/<pattern id="cgmp0" patternUnits="userSpaceOnUse"><rect /);
    expect(r.svg).toContain('<pattern id="cgmp1" href="#cgmp0" patternUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" patternTransform="matrix(40 0 0 40 0 160)"/>');
    expect([...r.svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="(#[0-9a-f]+)"/g)].map((m) => m[1])).toEqual(['#ff0000', '#0000ff', '#0000ff', '#ff0000']);
    expect(r.svg).toContain('fill="url(#cgmp1)"');
  });

  it('IMG-19 (3) 同じ模様を何度使っても、中身の定義は 1 つ。置き方が同じなら pattern も 1 つ。新しい中身だけを画素の合計に数える', () => {
    // 64 × 64 = 4096 セルの模様 (矩形で書く大きさの上限) を、2000 個の矩形で使う
    const colours = Array.from({ length: 4096 }, (_, k) => 2 + (k % 2));
    const fills = Array.from({ length: 2000 }, () => cmd(4, 11, i16(0, 0, 100, 50))).flat();
    const body = [...table, ...cmd(5, 32, [...i16(1, 64, 64, 8), ...colours]), ...cmd(5, 33, i16(0, 10, 10, 0)), ...cmd(5, 22, i16(2)), ...fills];
    const r = cgmToSvg(metafile(body))!;
    expect(r.svg.match(/<pattern /g)!.length).toBe(2);
    const cellRects = (svg: string) => svg.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill=/g)!.length;
    expect(cellRects(r.svg)).toBe(4096);
    expect(r.svg.length).toBeLessThan(600_000);
    expect(r.warnings ?? []).toEqual([]);
    // 塗りの基準点を変えて使えば置き方の pattern は増えるが、中身は 1 つのまま
    const moved = [...table, ...cmd(5, 32, [...i16(1, 64, 64, 8), ...colours]), ...cmd(5, 33, i16(0, 10, 10, 0)), ...cmd(5, 22, i16(2)), ...Array.from({ length: 300 }, (_, k) => [...cmd(5, 31, i16(k, 0)), ...cmd(4, 11, i16(0, 0, 100, 50))]).flat()];
    const m = cgmToSvg(metafile(moved))!;
    expect(m.svg.match(/<pattern /g)!.length).toBe(301);
    expect(cellRects(m.svg)).toBe(4096);
  });

  it('HATCH STYLE DEFINITION (交差) は 2 つの向きの線の模様を重ね、LINE AND EDGE TYPE DEFINITION は破線の並びになる', () => {
    // 番号 -1、交差、向き (1, 0) と (0, 1)、1 周期 10、線 2 本 (間隔 1・3)、線種 1・1
    const desc = cmd(2, 18, i16(-1, 1, 1, 0, 0, 1, 10, 2, 1, 3, 1, 1));
    const r = cgmToSvg(withDesc(desc, [...cmd(5, 22, i16(3)), ...cmd(5, 24, i16(-1)), ...cmd(4, 11, i16(0, 0, 100, 50))]))!;
    expect(r.svg.match(/fill="url\(#cgmh[^)]+\)"/g)!.length).toBe(2);
    expect(r.svg).toMatch(/rotate\(-90\)/);
    // 線種 -1: 1 周期 20 (absolute)、線 3・隙間 1 → 15 VDC と 5 VDC
    const lt = cgmToSvg(withDesc([...cmd(2, 3, i16(0)), ...cmd(2, 17, i16(-1, 20, 3, 1))], [...cmd(5, 2, i16(-1)), ...cmd(4, 1, i16(0, 0, 100, 0))]))!;
    expect(lt.svg).toContain('stroke-dasharray="60 20"');
  });

  it('INTERPOLATED INTERIOR の三角形: 3 つの角の色を 1 次で補間した画素を、図形で切り抜く', () => {
    const body = [
      ...table,
      ...cmd(5, 34, [4, 0, 255, 0]), // 4 = 緑
      ...cmd(5, 31, i16(0, 0)), // 塗りの基準点
      ...cmd(5, 43, [...i16(3, 100, 0, 0, 50, 0), 2, 3, 4, 0]), // 三角形: (0,0) 赤、(100,0) 青、(0,50) 緑
      ...cmd(5, 22, i16(6)),
      ...cmd(4, 11, i16(0, 0, 100, 50)),
    ];
    const r = cgmToSvg(metafile(body))!;
    expect(r.svg).toMatch(/<clipPath id="cgmc\d+"><path d="[^"]+" clip-rule="evenodd"\/><\/clipPath>/);
    const [img] = images(r.svg);
    // 左下の角は赤、右下は青、左上は緑に近い
    const near = (a: number[], b: number[]) => a.slice(0, 3).every((v, k) => Math.abs(v - b[k]) < 12);
    expect(near(img.px(0, img.h - 1), RED)).toBe(true);
    expect(near(img.px(img.w - 1, img.h - 1), BLUE)).toBe(true);
    expect(near(img.px(0, 0), [0, 255, 0])).toBe(true);
  });

  it('TEXT PATH: left は字を逆の順に右端から、up は字を上へ積む', () => {
    const left = cgmToSvg(metafile([...cmd(5, 17, i16(1)), ...cmd(4, 4, [...i16(50, 25), ...i16(1), ...str('ABC')])]))!;
    expect(left.svg).toMatch(/text-anchor="end"[^>]*>CBA<\/text>/);
    const up = cgmToSvg(metafile([...cmd(5, 17, i16(2)), ...cmd(4, 4, [...i16(50, 25), ...i16(1), ...str('ABC')])]))!;
    const ys = [...up.svg.matchAll(/<text [^>]*y="(-?[\d.]+)"[^>]*text-anchor="middle"[^>]*>([A-C])<\/text>/g)].map((m) => [m[2], Number(m[1])] as const);
    expect(ys.map((v) => v[0])).toEqual(['A', 'B', 'C']);
    expect(ys[0][1]).toBe(0);
    expect(ys[1][1]).toBeLessThan(ys[0][1]);
    expect(ys[2][1]).toBeLessThan(ys[1][1]);
  });

  it('セグメント: 絵の本体のセグメントはその場で描き、COPY SEGMENT は写す行列を掛けて描く。メタファイル記述子のセグメントは写した時だけ描く', () => {
    const seg = [...cmd(0, 6, i16(7)), ...cmd(4, 1, i16(0, 0, 10, 0)), ...cmd(0, 7)];
    const copy = cmd(8, 1, [...i16(7), ...fx(1, 0, 0, 1), ...i16(20, 10), ...i16(0)]);
    const r = cgmToSvg(metafile([...seg, ...copy]))!;
    expect(pathD(r.svg)).toEqual(['M0 200L40 200', 'M0 200L40 200']);
    expect(r.svg).toMatch(/<g transform="matrix\(1 0 0 1 80 -40\)"><path d="M0 200L40 200"/);
    // 大域のセグメント (メタファイル記述子の中) は、定義しただけでは描かない
    const global = new Uint8Array([...cmd(0, 1, str('t')), ...seg, ...cmd(0, 3, str('p')), ...cmd(2, 6, i16(0, 0, 100, 50)), ...cmd(0, 4), ...copy, ...cmd(0, 5), ...cmd(0, 2)]);
    const g = cgmToSvg(global)!;
    expect(pathD(g.svg)).toEqual(['M0 200L40 200']);
    expect(g.svg).toContain('matrix(1 0 0 1 80 -40)');
  });

  it('geometric pattern: GEOMETRIC PATTERN DEFINITION のセグメントを模様にして敷く', () => {
    const desc = [...cmd(0, 6, i16(3)), ...cmd(4, 1, i16(0, 0, 10, 10)), ...cmd(0, 7), ...cmd(2, 19, i16(1, 3, 0, 0, 10, 10))];
    const r = cgmToSvg(withDesc(desc, [...cmd(5, 33, i16(0, 10, 10, 0)), ...cmd(5, 22, i16(5)), ...cmd(4, 11, i16(0, 0, 100, 50))]))!;
    expect(r.svg).toMatch(/<pattern id="(cgmp\d+)" patternUnits="userSpaceOnUse"><path d="M0 200L40 160"/);
    expect(r.svg).toMatch(/<pattern id="cgmp\d+" href="#cgmp\d+" patternUnits="userSpaceOnUse" x="0" y="160" width="40" height="40"[^>]*\/>/);
    expect(r.svg).toMatch(/fill="url\(#cgmp\d+\)"/);
    // 絵の記述子のセグメントは、その場では描かない
    expect(pathD(r.svg).filter((d) => d === 'M0 200L40 160').length).toBe(1);
  });

  it('CONNECTING EDGE: 閉じた図形の中で、前の線の終わりから次の線の始めへの辺を足す', () => {
    const body = [
      ...cmd(5, 30, i16(1)), // EDGE VISIBILITY on
      ...cmd(0, 8),
      ...cmd(4, 1, i16(0, 0, 10, 0)),
      ...cmd(4, 21),
      ...cmd(4, 1, i16(10, 10, 0, 10)),
      ...cmd(0, 9),
    ];
    const r = cgmToSvg(metafile(body))!;
    expect(pathD(r.svg)).toContain('M40 200L40 160');
  });

  it('細工したファイル: 自分を写すセグメントや、次数の大きな B スプラインでも止まる', () => {
    // セグメント 1 は自分自身を 2 回写す
    const self = [...cmd(0, 6, i16(1)), ...cmd(4, 1, i16(0, 0, 10, 0)), ...cmd(8, 1, [...i16(1), ...fx(1, 0, 0, 1), ...i16(1, 1), ...i16(0)]), ...cmd(8, 1, [...i16(1), ...fx(1, 0, 0, 1), ...i16(2, 2), ...i16(0)]), ...cmd(0, 7)];
    const r = cgmToSvg(metafile([...self, ...cmd(8, 1, [...i16(1), ...fx(1, 0, 0, 1), ...i16(0, 0), ...i16(0)])]))!;
    expect(r.warnings.some((w) => w.includes('COPY SEGMENT'))).toBe(true);
    // 次数 1000 の B スプラインは描かない
    const big = cgmToSvg(metafile([...cmd(4, 24, [...i16(1000, 1000)]), ...cmd(4, 1, i16(0, 0, 10, 0))]))!;
    expect(big.warnings.some((w) => w.includes('B-SPLINE'))).toBe(true);
  });
  describe('まれな機能 (第 3 版・第 4 版の要素)', () => {
    /** メタファイル記述子 (md) と絵の記述子 (desc) を足した CGM */
    const full = (md: number[], desc: number[], body: number[]) =>
      new Uint8Array([...cmd(0, 1, str('t')), ...md, ...cmd(0, 3, str('p')), ...cmd(2, 6, i16(0, 0, 100, 50)), ...desc, ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);
    const textEl = (svg: string) => /<text [^>]*>[^<]*<\/text>/.exec(svg)![0];

    it('MITRE LIMIT は stroke-miterlimit、LINE TYPE INITIAL OFFSET は線種の周期に対する割合の stroke-dashoffset', () => {
      const r = cgmToSvg(metafile([...cmd(3, 19, fx(10)), ...cmd(5, 38, i16(2)), ...cmd(5, 2, i16(2)), ...cmd(5, 40, fx(0.5)), ...cmd(4, 1, i16(0, 0, 50, 0, 50, 25))]))!;
      expect(r.svg).toContain('stroke-miterlimit="10"');
      const dash = /stroke-dasharray="([^"]+)"/.exec(r.svg)![1].split(' ').map(Number);
      const off = Number(/stroke-dashoffset="([^"]+)"/.exec(r.svg)![1]);
      expect(off).toBeCloseTo(dash.reduce((a, v) => a + v, 0) / 2, 2);
    });

    it('LINE TYPE CONTINUATION: restart は頂点ごとに部分経路を分け、adaptive continue は区間ごとに線種を伸び縮みさせる', () => {
      const pl = cmd(4, 1, i16(0, 0, 50, 0, 50, 25));
      const restart = cgmToSvg(metafile([...cmd(5, 2, i16(2)), ...cmd(5, 39, i16(3)), ...pl]))!;
      expect(pathD(restart.svg)[0]).toBe('M0 200L200 200M200 200L200 100');
      // 円弧を折れ線にした点では始め直さない
      const arc = cgmToSvg(metafile([...cmd(5, 2, i16(2)), ...cmd(5, 39, i16(3)), ...cmd(4, 15, i16(50, 25, 1, 0, 0, 1, 10))]))!;
      expect(pathD(arc.svg)[0].match(/M/g)!.length).toBe(1);
      const adaptive = cgmToSvg(metafile([...cmd(5, 2, i16(2)), ...cmd(5, 39, i16(4)), ...pl]))!;
      const dashes = [...adaptive.svg.matchAll(/<path d="([^"]+)"[^>]*stroke-dasharray="([^"]+)"/g)];
      expect(dashes.map((m) => m[1])).toEqual(['M0 200L200 200', 'M200 200L200 100']);
      // 区間の長さ = 周期の整数倍 + 最初の線の長さ (区間の終わりの点が線の上に来る)
      for (const [, d, da] of dashes) {
        const len = d === 'M0 200L200 200' ? 200 : 100;
        const v = da.split(' ').map(Number);
        const cycle = v[0] + v[1];
        const n = (len - v[0]) / cycle;
        expect(Math.abs(n - Math.round(n))).toBeLessThan(0.01);
      }
    });

    it('TEXT SCORE TYPE: right score は下線、left score は上線、through score は取り消し線、kendot は圏点', () => {
      const t = (scores: number[]) => cgmToSvg(metafile([...cmd(5, 41, i16(...scores)), ...cmd(4, 4, [...i16(10, 25), ...i16(1), ...str('AB')])]))!.svg;
      expect(textEl(t([1, 1, 3, 1, 4, 1]))).toMatch(/text-decoration="underline line-through" data-kendot="true"/);
      expect(textEl(t([2, 1]))).toMatch(/text-decoration="overline"/);
      expect(textEl(t([1, 0]))).not.toMatch(/text-decoration/);
      // left の path では、字の進む向きの右側は字の上
      const left = cgmToSvg(metafile([...cmd(5, 17, i16(1)), ...cmd(5, 41, i16(1, 1)), ...cmd(4, 4, [...i16(50, 25), ...i16(1), ...str('AB')])]))!.svg;
      expect(textEl(left)).toMatch(/text-decoration="overline"/);
    });

    it('RESTRICTED TEXT TYPE: boxed は箱の高さと幅にちょうど合わせ、isotropic は縦横同じ比で、justified は字の間で合わせる', () => {
      const rt = (type: number) => textEl(cgmToSvg(metafile([...cmd(5, 15, i16(4)), ...cmd(5, 42, i16(type)), ...cmd(4, 5, [...i16(80, 12, 0, 0), ...i16(1), ...str('ABC')])]))!.svg);
      const fsOf = (el: string) => parseFloat(/font-size="([\d.]+)"/.exec(el)![1]);
      expect(fsOf(rt(2)) * 0.72).toBeCloseTo(12, 1);
      expect(rt(2)).toMatch(/textLength="80" lengthAdjust="spacingAndGlyphs"/);
      expect(fsOf(rt(3)) * 0.72).toBeCloseTo(8, 1);
      expect(rt(4)).toMatch(/data-max-length="80" data-fit="uniform"/);
      expect(fsOf(rt(4)) * 0.72).toBeCloseTo(12, 1);
      expect(rt(6)).toMatch(/textLength="80" lengthAdjust="spacing"/);
      expect(fsOf(rt(6)) * 0.72).toBeCloseTo(4, 1);
      expect(rt(1)).toMatch(/data-max-length="80"/);
    });

    it('TEXT ALIGNMENT の縦の揃え: top は字が文字の位置から下に下がり、bottom は上に上がる', () => {
      const ty = (va: number) => {
        const r = cgmToSvg(metafile([...cmd(5, 15, i16(10)), ...cmd(5, 18, [...i16(0, va), ...fx(0, 0)]), ...cmd(4, 4, [...i16(50, 25), ...i16(1), ...str('A')])]))!;
        return Number(/matrix\(([^)]+)\)/.exec(r.svg)![1].split(' ')[5]);
      };
      // 文字の位置は y = 100 (px)。高さ 10 は 40px
      expect(ty(4)).toBe(100);
      expect(ty(1)).toBeCloseTo(100 + 48);
      expect(ty(2)).toBeCloseTo(100 + 40);
      expect(ty(5)).toBeCloseTo(100 - 12);
    });

    it('COMPOUND LINE: 中の線の要素を 1 本の経路にして、続いていない間は直線でつなぐ', () => {
      const r = cgmToSvg(metafile([...cmd(0, 15), ...cmd(4, 1, i16(0, 0, 10, 0)), ...cmd(4, 1, i16(20, 0, 20, 10)), ...cmd(0, 16)]))!;
      expect(pathD(r.svg)).toEqual(['M0 200L40 200L80 200L80 160']);
    });

    it('COMPOUND TEXT PATH と GENERALIZED TEXT PATH MODE: 経路は描かず、字をその経路に沿って置く', () => {
      const path = [...cmd(0, 17), ...cmd(4, 1, i16(0, 0, 50, 25)), ...cmd(0, 18)];
      const text = cmd(4, 4, [...i16(0, 0), ...i16(1), ...str('ABC')]);
      const axis = cgmToSvg(metafile([...path, ...cmd(3, 18, i16(2)), ...text]))!;
      expect(axis.svg).toMatch(/<defs>.*<path id="(cgmtp\d+)" d="M0 200L200 100"\/>.*<\/defs>/);
      expect(axis.svg).toMatch(/<textPath href="#cgmtp\d+" startOffset="0" data-extend="true">ABC<\/textPath>/);
      // 経路は線として描かない
      expect(pathD(axis.svg.replace(/<defs>.*<\/defs>/, ''))).toEqual([]);
      const non = cgmToSvg(metafile([...path, ...cmd(3, 18, i16(1)), ...text]))!;
      expect(non.svg).toMatch(/data-rotate="none"/);
      // 複合の文字の経路が無ければ、既定の VDC EXTENT の下の辺
      const def = cgmToSvg(metafile([...cmd(3, 18, i16(2)), ...text]))!;
      expect(def.svg).toMatch(/<path id="cgmtp\d+" d="M0 \d+(?:\.\d+)?L\d+(?:\.\d+)? \d+(?:\.\d+)?"\/>/);
    });

    it('束ね表: ASPECT SOURCE FLAGS が bundled の見た目は、LINE REPRESENTATION の値で描く', () => {
      const desc = [...cmd(2, 11, [...i16(2, 2), ...fx(3), 5, 0])]; // 番号 2: 破線・太さ 3 (scaled)・色 5
      const ct = cmd(5, 34, [5, 255, 0, 0]); // 色表の 5 番 = 赤
      const asf = cmd(5, 35, i16(0, 1, 1, 1, 2, 1));
      const r = cgmToSvg(full([], desc, [...ct, ...asf, ...cmd(5, 1, i16(2)), ...cmd(4, 1, i16(0, 0, 10, 0))]))!;
      expect(r.svg).toMatch(/stroke="#ff0000" stroke-width="0\.768"/);
      expect(r.svg).toContain('stroke-dasharray');
      // 個別 (individual) に戻すと、LINE TYPE などの値
      const ind = cgmToSvg(full([], desc, [...ct, ...cmd(5, 35, i16(0, 0, 1, 0, 2, 0)), ...cmd(5, 1, i16(2)), ...cmd(4, 1, i16(0, 0, 10, 0))]))!;
      expect(ind.svg).toMatch(/stroke="#000000" stroke-width="0\.256"/);
      // 表に無い番号は個別の値で描いて、警告する
      const none = cgmToSvg(full([], [], [...asf, ...cmd(5, 1, i16(9)), ...cmd(4, 1, i16(0, 0, 10, 0))]))!;
      expect(none.warnings.some((w) => w.includes('9 番'))).toBe(true);
    });

    it('INHERITANCE FILTER: state list の属性は、COPY SEGMENT の時の値で描く', () => {
      const ct = cmd(5, 34, [2, 0, 0, 255]); // 色表の 2 番 = 青
      const seg = [...cmd(0, 6, i16(4)), ...cmd(5, 4, [1]), ...cmd(4, 1, i16(0, 0, 10, 0)), ...cmd(0, 7)];
      const copy = cmd(8, 1, [...i16(4), ...fx(1, 0, 0, 1), ...i16(0, 0), ...i16(0)]);
      const base = [...ct, ...seg, ...cmd(5, 4, [2])];
      const kept = cgmToSvg(metafile([...base, ...copy]))!;
      expect([...kept.svg.matchAll(/stroke="(#[0-9a-f]+)"/g)].map((m) => m[1])).toEqual(['#000000', '#000000']);
      // 3 番 (line colour) を state list に: セグメントの中の LINE COLOUR も効かない
      const inh = cgmToSvg(metafile([...base, ...cmd(8, 2, i16(3, 0)), ...copy]))!;
      expect([...inh.svg.matchAll(/stroke="(#[0-9a-f]+)"/g)].map((m) => m[1])).toEqual(['#000000', '#0000ff']);
      // 35 番 (line attributes) を segment に戻す
      const back = cgmToSvg(metafile([...base, ...cmd(8, 2, i16(3, 0)), ...cmd(8, 2, i16(35, 1)), ...copy]))!;
      expect([...back.svg.matchAll(/stroke="(#[0-9a-f]+)"/g)].map((m) => m[1])).toEqual(['#000000', '#000000']);
    });

    it('COLOUR MODEL の CIELAB・CIELUV・RGB 関連: COLOUR VALUE EXTENT の倍率とずれで成分を出し、RGB に直す', () => {
      const lineIn = (model: number, ext: number[], cd: number[]) => {
        const md = [...cmd(1, 19, i16(model)), ...cmd(1, 10, fx(...ext))];
        const r = cgmToSvg(full(md, cmd(2, 2, i16(1)), [...cmd(5, 4, cd), ...cmd(4, 1, i16(0, 0, 10, 0))]))!;
        return /stroke="(#[0-9a-f]+)"/.exec(r.svg)![1];
      };
      const lab = [100 / 255, 0, 1, -128, 1, -128];
      expect(lineIn(2, lab, [255, 128, 128, 0])).toBe('#ffffff');
      expect(lineIn(2, lab, [0, 128, 128, 0])).toBe('#000000');
      // L* 53.24・a* 80.09・b* 67.2 は sRGB の赤
      const red = lineIn(2, [1, 0, 1, -128, 1, -128], [53, 208, 195, 0]);
      expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(240);
      expect(parseInt(red.slice(3, 5), 16)).toBeLessThan(40);
      expect(lineIn(3, lab, [255, 128, 128, 0])).toBe('#ffffff');
      expect(lineIn(5, [1 / 255, 0, 0, 0, 1 / 255, 0], [255, 0, 255, 0])).toBe('#ff00ff');
    });

    describe('登録簿の要素 (ISO International Register of Graphical Items)', () => {
      /** 文字列の形に包んだ SDR (第 3 部 表 1 の注 17) */
      const sdr = (...bytes: number[]) => [bytes.length, ...bytes];
      const blueCells = [...table, ...cmd(4, 9, [...i16(0, 50, 30, 30, 30, 50), ...i16(3, 1, 8, 1), 2, 3, 2])];

      it('ESCAPE 22 (Transparent Cell Colour): SDR の on・off と色番号で、その色のセルを描かない', () => {
        const esc = cmd(6, 1, [...i16(22), ...sdr(...i16(6, 1, 1), ...i16(2, 1), 3)]);
        const [img] = images(cgmToSvg(metafile([...esc, ...blueCells]))!.svg);
        expect([img.px(0, 0), img.px(1, 0), img.px(2, 0)]).toEqual([RED, [0, 0, 0, 0], RED]);
        // off なら描く
        const off = cmd(6, 1, [...i16(22), ...sdr(...i16(6, 1, 0), ...i16(2, 1), 3)]);
        const [img2] = images(cgmToSvg(metafile([...esc, ...off, ...blueCells]))!.svg);
        expect(img2.px(1, 0)).toEqual(BLUE);
      });

      it('ESCAPE 45 (Alpha Transparency): 後の塗り・線の不透明度。知らない ESCAPE は警告', () => {
        const esc = cmd(6, 1, [...i16(45), ...sdr(...i16(12, 1), ...fx(0.5))]);
        const r = cgmToSvg(metafile([...esc, ...cmd(5, 22, i16(1)), ...cmd(4, 7, i16(0, 0, 10, 0, 10, 10)), ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
        expect(r.svg).toMatch(/fill="#000000" fill-opacity="0.5"/);
        expect(r.svg).toMatch(/stroke="#000000" stroke-opacity="0.5"/);
        const u = cgmToSvg(metafile([...cmd(6, 1, [...i16(-7), ...sdr()]), ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
        expect(u.warnings.some((w) => w.includes('ESCAPE -7'))).toBe(true);
      });

      it('COLOUR MODEL 6 (RGB-alpha)・8 (sRGB-alpha) は 4 つ目の成分が不透明度、7 (sRGB) は RGB と同じ', () => {
        const line = (model: number, cd: number[]) => cgmToSvg(full(cmd(1, 19, i16(model)), cmd(2, 2, i16(1)), [...cmd(5, 4, cd), ...cmd(4, 1, i16(0, 0, 10, 0))]))!.svg;
        expect(line(6, [255, 0, 0, 51])).toMatch(/stroke="#ff0000" stroke-opacity="0.2"/);
        expect(line(8, [0, 0, 255, 255])).toMatch(/stroke="#0000ff" stroke-width/);
        expect(line(7, [0, 128, 0, 0])).toMatch(/stroke="#008000" stroke-width/);
        // 色表の色 (色番号の流儀) の不透明度も使う
        const t = cgmToSvg(full(cmd(1, 19, i16(6)), [], [...cmd(5, 34, [4, 0, 255, 0, 102]), ...cmd(5, 4, [4]), ...cmd(4, 1, i16(0, 0, 10, 0))]))!.svg;
        expect(t).toMatch(/stroke="#00ff00" stroke-opacity="0.4"/);
      });

      /** 1 枚の 2 × 2 のタイルの並び (色番号 8 ビット) */
      const tileArray = (tile: number[]) => [...table, ...cmd(0, 19, [...i16(0, 50), ...i16(0, 1), ...i16(1, 1, 2, 2), ...fx(0.125, 0.125), ...i16(0, 0, 2, 2)]), ...tile, ...cmd(0, 20)];
      const tilePx = (svg: string) => {
        const [img] = images(svg);
        return [img.px(0, 0), img.px(1, 0), img.px(0, 1), img.px(1, 1)];
      };

      it('TILE の圧縮の形 9 (PNG の deflate): 行ごとの PNG のフィルタを戻す', () => {
        // 1 行目 赤・青 (フィルタ 0)、2 行目 青・赤 (フィルタ 2 Up: 上との差 1・255)
        const bs = [...deflateSync(Uint8Array.from([0, 2, 3, 2, 1, 255]))];
        const r = cgmToSvg(metafile(tileArray(cmd(4, 29, [...i16(9, 0, 8), 0, ...bs]))))!;
        expect(tilePx(r.svg)).toEqual([RED, BLUE, BLUE, RED]);
      });

      it('TILE の圧縮の形 8 (LZW): 9 ビットの符号 (256 で表の初期化、257 で終わり)', () => {
        const codes = [256, 2, 3, 3, 2, 257];
        let bits = '';
        for (const c of codes) bits += c.toString(2).padStart(9, '0');
        while (bits.length % 8) bits += '0';
        const bs = Array.from({ length: bits.length / 8 }, (_, k) => parseInt(bits.slice(k * 8, k * 8 + 8), 2));
        const r = cgmToSvg(metafile(tileArray(cmd(4, 29, [...i16(8, 0, 8), 0, ...bs]))))!;
        expect(tilePx(r.svg)).toEqual([RED, BLUE, BLUE, RED]);
      });

      it('TILE の圧縮の形 7 (baseline JPEG): 画素を直接色として置く', () => {
        const jpg = encodeJpeg({ width: 2, height: 2, components: 3, data: Uint8Array.from([0, 200, 0, 0, 200, 0, 0, 200, 0, 0, 200, 0]) });
        const r = cgmToSvg(full([], cmd(2, 2, i16(1)), tileArray(cmd(4, 29, [...i16(7, 0, 8), 0, ...jpg]))))!;
        const px = tilePx(r.svg)[3];
        expect(px[1]).toBeGreaterThan(180);
        expect(px[0]).toBeLessThan(30);
      });

      it('GDP・POLYSYMBOL は描かずに警告し、記号の属性 (SYMBOL SIZE など) は警告しない', () => {
        const r = cgmToSvg(metafile([...cmd(5, 50, [...i16(0), ...i16(10, 10)]), ...cmd(4, 27, i16(1, 10, 10)), ...cmd(4, 10, [...i16(-3), ...i16(1, 0), ...i16(0, 0), 0]), ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
        expect(r.warnings.some((w) => w.includes('POLYSYMBOL'))).toBe(true);
        expect(r.warnings.some((w) => w.includes('GDP -3'))).toBe(true);
        expect(r.warnings.some((w) => w.includes('5,50'))).toBe(false);
      });
    });

    it('文字集合: CHARACTER SET LIST の 94 字の 2 バイトの集合 (JIS X 0208)・完全な符号 (UTF-8)・文字列の中の ISO 2022 の指示', () => {
      const jis = cgmToSvg(full(cmd(1, 14, [...i16(2), ...str('B')]), [], cmd(4, 4, [...i16(10, 25), ...i16(1), ...str('0!0"')])))!;
      expect(textEl(jis.svg)).toContain('>亜唖<');
      const utf8 = [...new TextEncoder().encode('組織')];
      const u = cgmToSvg(full(cmd(1, 14, [...i16(4), ...str('G')]), [], cmd(4, 4, [...i16(10, 25), ...i16(1), utf8.length, ...utf8])))!;
      expect(textEl(u.svg)).toContain('>組織<');
      // 拡張の 8 ビット: ESC $ B で JIS X 0208 を G0 に、ESC ( B で ASCII に戻す。2 番目の集合 (ALTERNATE) は 96 字の Latin-1
      const esc2022 = [0x41, 0x1b, 0x24, 0x42, 0x30, 0x21, 0x1b, 0x28, 0x42, 0x42];
      const md = [...cmd(1, 14, [...i16(0), ...str('B'), ...i16(1), ...str('A')]), ...cmd(1, 15, i16(3))];
      const x = cgmToSvg(full(md, [], [...cmd(5, 20, i16(2)), ...cmd(4, 4, [...i16(10, 25), ...i16(1), esc2022.length + 1, ...esc2022, 0xe9])]))!;
      expect(textEl(x.svg)).toContain('>A亜Bé<');
    });
  });
});

describe('CGM の大きさ: imageInfo (組むときの大きさ) と cgmToSvg (描くときの大きさ) が同じ読み方をする', () => {
  const i32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
  const f64 = (...v: number[]) =>
    v.flatMap((x) => {
      const d = new DataView(new ArrayBuffer(8));
      d.setFloat64(0, x);
      return Array.from(new Uint8Array(d.buffer));
    });
  const file = (descriptor: number[], picture: number[], body: number[]) =>
    new Uint8Array([...cmd(0, 1, str('t')), ...descriptor, ...cmd(0, 3, str('p')), ...picture, ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);
  const same = (b: Uint8Array) => {
    const info = imageInfo(b)!;
    const r = cgmToSvg(b)!;
    expect(info.mime).toBe('image/cgm');
    expect(info.width).toBeCloseTo(r.width, 9);
    expect(info.height).toBeCloseTo(r.height, 9);
    return info;
  };

  it('REAL PRECISION が 64 ビットの浮動小数点なら、SCALING MODE の倍率も 64 ビットで読む', () => {
    // REAL PRECISION (浮動, 12, 52)。SCALING MODE metric、VDC 1 単位が 0.5mm。VDC EXTENT (0,0)-(100,50) → 50mm × 25mm
    const b = file(cmd(1, 5, i16(0, 12, 52)), [...cmd(2, 1, [...i16(1), ...f64(0.5)]), ...cmd(2, 6, i16(0, 0, 100, 50))], cmd(4, 1, i16(0, 0, 100, 50)));
    const info = same(b);
    expect(info.width).toBeCloseTo((50 * 96) / 25.4, 9);
    expect(info.height).toBeCloseTo((25 * 96) / 25.4, 9);
  });

  it('INTEGER PRECISION が 32 なら、精度の指定の引数 (整数) も 32 ビットで読む', () => {
    // INTEGER PRECISION 32 → VDC TYPE real → VDC REAL PRECISION (浮動, 12, 52。引数の整数は 32 ビット) → VDC EXTENT は 64 ビットの実数
    const b = file([...cmd(1, 4, i16(32)), ...cmd(1, 3, i16(1))], [...cmd(3, 2, [...i16(0), ...i32(12, 52)]), ...cmd(2, 6, f64(0, 0, 2, 0.5))], cmd(4, 1, f64(0, 0, 2, 0.5)));
    const info = same(b);
    expect([info.width, info.height]).toEqual([400, 100]);
  });

  it('VDC INTEGER PRECISION 32・実数の VDC (既定の固定小数点)・VDC EXTENT の無い絵 (既定の範囲)', () => {
    expect(same(file([], [...cmd(3, 1, i16(32)), ...cmd(2, 6, i32(0, 0, 100000, 50000))], cmd(4, 1, i32(0, 0, 100000, 50000))))).toMatchObject({ width: 400, height: 200 });
    // 固定小数点 (16, 16): 整数部と小数部
    expect(same(file(cmd(1, 3, i16(1)), cmd(2, 6, i16(0, 0, 0, 0, 3, 0, 1, 0x8000)), cmd(4, 1, i16(0, 0, 0, 0, 3, 0, 1, 0x8000))))).toMatchObject({ width: 400, height: 200 });
    // VDC EXTENT が無ければ、既定の範囲 (整数の VDC は (0,0)-(32767,32767))
    expect(same(file([], [], cmd(4, 1, i16(0, 0, 100, 50))))).toMatchObject({ width: 400, height: 400 });
  });

  it('幅か高さが 0 の VDC EXTENT からは、大きさを決めない', () => {
    expect(imageInfo(file([], cmd(2, 6, i16(0, 0, 0, 50)), []))).toBeUndefined();
  });
});
