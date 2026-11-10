/**
 * 色つきの字形 (カラーの絵文字など。src/colorGlyph.ts・colorGlyphPdf.ts・colorGlyphSvg.ts・colorGlyphCanvas.ts):
 *  - 書体の表 (COLR version 0・1、CPAL、CBDT/CBLC、sbix、SVG) を読んで、描画の命令の並びにする
 *  - PDF には Type 3 書体として書く (字は文字のまま。同じ字形の定義は 1 度)
 *  - font-palette・@font-palette-values、異体字セレクタ (U+FE0E・U+FE0F) による書体の選び方
 *  - 色つきの表を持たない書体では、何もしない
 * 表の形を 1 つずつ確かめる書体は、手元の欧文の書体 (Tinos) の表を差し替えて、テストの中で組み立てる (test/colorFontBuilder.ts)。
 * 実物の書体 (COLR version 0 の Bungee Color・Twemoji、version 1 の Nabla) は、テストが取得する (helpers.ts の EXTRA_TEST_FONTS)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';
import { DOMParser } from '@xmldom/xmldom';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { defaultFontBuffer, doc, ensureFonts, extraTestFont, fontBuffer, FAMILY, fontDir } from './helpers';
import { Bytes, cbdt, colr0, colr1, cpal, paint, sbix, svgTable, withTables } from './colorFontBuilder';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { renderPdf } from '../src/pdfRenderer';
import { parseCss } from '../src/htmlPaged';
import { encodePngStored } from '../src/pixels';
import { COMPOSITE, areaGlyphs, colorFontOf, orderByPresentation, paletteForFont, plainStops, prepareColorFont, presentationOf, sweepSampler, unrollStops, type ColorFill, type ColorFont, type ColorOp, type ColorStop } from '../src/colorGlyph';
import { svgGlyphReader } from '../src/colorGlyphSvg';
import { decodePng } from '../src/colorGlyphCanvas';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
import type { XmlNode } from '../src/svg';
import type { Area } from '../src/types';
import path from 'node:path';

let tinos: ArrayBuffer;
/** Tinos の字の字形の番号 */
let gid: (ch: string) => number;
let upm: number;

const RED: [number, number, number, number] = [255, 0, 0, 255];
const GREEN: [number, number, number, number] = [0, 128, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 128];
const PALETTE = cpal([[RED, GREEN, BLUE]]);

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  tinos = await defaultFontBuffer('Tinos-Regular.ttf');
  const fk = fontkit.create(new Uint8Array(tinos)) as unknown as { unitsPerEm: number; glyphForCodePoint(cp: number): { id: number } };
  upm = fk.unitsPerEm;
  gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
}, 300_000);

/** 表を差し替えた書体の、色つきの字形の読み手 */
function colorFont(tables: Record<string, Uint8Array | null>): ColorFont {
  const buffer = withTables(tinos, tables);
  const fk = fontkit.create(new Uint8Array(buffer));
  prepareColorFont(fk);
  const cf = colorFontOf({ fk, buffer });
  if (!cf) throw new Error('not a color font');
  return cf;
}
/** 字形 A の根の Paint だけを持つ COLR version 1 の書体の、字形 A の命令の並び */
const opsOf = (root: Uint8Array, extra: Partial<Parameters<typeof colr1>[0]> = {}) => colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: root }], ...extra }), CPAL: PALETTE }).glyph(gid('A'))?.ops;
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 4));
const fillOf = (op: ColorOp | undefined): ColorFill => {
  if (!op || (op.op !== 'fill' && op.op !== 'paint')) throw new Error(`not a fill: ${op?.op}`);
  return op.fill;
};
const stops = (list: Array<[number, number]>): Array<[number, number, number]> => list.map(([o, p]) => [o, p, 1]);

describe('色つきの表を持たない書体では、何もしない', () => {
  it('表の一覧を見るだけで、色つきの書体でないと分かる。fontkit の書体の物には手を入れない', () => {
    const fk = fontkit.create(new Uint8Array(tinos));
    prepareColorFont(fk);
    expect(Object.hasOwn(fk, 'getGlyph')).toBe(false);
    expect(colorFontOf({ fk, buffer: tinos })).toBeUndefined();
    // 輪郭の表のある色つきの書体 (COLR) も、fontkit の getGlyph は差し替えない (輪郭の表の無い書体だけ)
    const buffer = withTables(tinos, { COLR: colr0([]), CPAL: PALETTE });
    const colored = fontkit.create(new Uint8Array(buffer));
    prepareColorFont(colored);
    expect(Object.hasOwn(colored, 'getGlyph')).toBe(false);
    expect(colorFontOf({ fk: colored, buffer })).toBeDefined();
  });
  it('PDF に Type 3 書体は出ない (色つきの字形の処理を通らない)', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
    const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
    const bytes = await renderPdf(engine.layout(doc([{ type: 'block', children: ['色の無い字'] }] as never)), fonts, { subset: false });
    expect(type3Fonts(await PDFDocument.load(bytes))).toEqual([]);
  });
});

describe('CPAL: パレット', () => {
  it('色の記録は 青・緑・赤・不透明度の順。パレットの番号で選ぶ (無い番号は 0 番)', () => {
    const cf = colorFont({ COLR: colr0([]), CPAL: cpal([[RED, GREEN], [BLUE, RED]]) });
    expect(cf.paletteCount).toBe(2);
    expect(cf.palette()).toEqual([[1, 0, 0, 1], [0, 128 / 255, 0, 1]]);
    expect(cf.palette({ base: 1 })[0]).toEqual([0, 0, 1, 128 / 255]);
    expect(cf.palette({ base: 7 })).toEqual(cf.palette());
  });
  it("light・dark は、その印 (version 1 のパレットの種類) の付いた最初のパレット。印が無ければ 0 番", () => {
    // 0 番: 印なし、1 番: 暗い背景向け (0x0002)、2 番: 明るい背景向け (0x0001)
    const cf = colorFont({ COLR: colr0([]), CPAL: cpal([[RED], [GREEN], [BLUE]], [0, 2, 1]) });
    expect(cf.paletteIndex('dark')).toBe(1);
    expect(cf.paletteIndex('light')).toBe(2);
    expect(cf.palette({ base: 'dark' })[0]).toEqual([0, 128 / 255, 0, 1]);
    const noTypes = colorFont({ COLR: colr0([]), CPAL: cpal([[RED], [GREEN]]) });
    expect(noTypes.paletteIndex('dark')).toBe(0);
  });
  it('色の差し替え (override-colors): 範囲の外の番号は無視する', () => {
    const cf = colorFont({ COLR: colr0([]), CPAL: cpal([[RED, GREEN]]) });
    expect(cf.palette({ colors: [[1, '#0000ff80'], [5, '#ffffff']] })).toEqual([[1, 0, 0, 1], [0, 0, 1, 128 / 255]]);
  });
});

describe('COLR version 0: 色ごとの層', () => {
  it('層は下から上の順の塗り。色の番号 0xFFFF は前景色 (文字の色)', () => {
    const cf = colorFont({ COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0], [gid('C'), 0xffff], [gid('D'), 2]] }]), CPAL: PALETTE });
    const g = cf.glyph(gid('A'))!;
    expect(g.source).toBe('colr0');
    expect(g.ops.map((o) => o.op)).toEqual(['fill', 'fill', 'fill']);
    expect(g.ops.map((o) => fillOf(o)).map((f) => (f.kind === 'solid' ? f.color : null))).toEqual([{ rgb: [1, 0, 0], a: 1 }, { rgb: null, a: 1 }, { rgb: [0, 0, 1], a: 128 / 255 }]);
    // 層の形は、層の字形 (B・C・D) の輪郭。基底の字形 (A) の輪郭ではない
    expect((g.ops[0] as Extract<ColorOp, { op: 'fill' }>).path).toEqual(cf.outline(gid('B')));
    expect(g.usesForeground).toBe(true);
    expect(g.foregroundInGradient).toBe(false);
    expect(g.clip).toBe(false);
    // 層を持たない字形は、色つきでない
    expect(cf.glyph(gid('B'))).toBeUndefined();
  });
  it('基底の字形と同じ字形を層に使っても、層の輪郭が読める (fontkit の字形の控えを通さない)', () => {
    const buffer = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('A'), 0]] }]), CPAL: PALETTE });
    const fk = fontkit.create(new Uint8Array(buffer)) as unknown as { getGlyph(id: number): unknown };
    // 先に getGlyph で基底の字形を作らせておく (fontkit は、輪郭を持たない型の字形を控えに入れる)
    fk.getGlyph(gid('A'));
    const g = colorFontOf({ fk, buffer })!.glyph(gid('A'))!;
    expect((g.ops[0] as Extract<ColorOp, { op: 'fill' }>).path.length).toBeGreaterThan(5);
  });
});

describe('COLR version 1: Paint の表', () => {
  it('PaintGlyph + PaintSolid は、輪郭の塗り。不透明度は、パレットの色の不透明度に掛ける', () => {
    const ops = opsOf(paint.glyph(gid('B'), paint.solid(2, 0.5)))!;
    expect(ops).toHaveLength(1);
    const f = fillOf(ops[0]);
    expect(f.kind === 'solid' && f.color.rgb).toEqual([0, 0, 1]);
    expect(f.kind === 'solid' && f.color.a).toBeCloseTo((128 / 255) * 0.5, 4);
  });
  it('PaintLinearGradient: p₂ で向きを回す (p₀p₁ を、p₀p₂ に直交する向きへ射影した p₃ へ)。止まり点の位置は 0〜1 に直し、形をそれに合わせる', () => {
    // p₀ = (0, 0)、p₁ = (100, 100)、p₂ = (0, 100): 色は y 軸の向きに延びるので、色の線は x 軸の上の (0, 0)〜(100, 0)
    const rotated = fillOf(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0, 0], [1, 1]]), [0, 0, 100, 100, 0, 100])))![0]);
    if (rotated.kind !== 'linear') throw new Error(rotated.kind);
    near([rotated.x0, rotated.y0, rotated.x1, rotated.y1], [0, 0, 100, 0]);
    // 止まり点が 0.25 と 0.75: 0〜1 に直し、点を p₀ + 0.25·v と p₀ + 0.75·v にする
    const narrowed = fillOf(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0.25, 0], [0.75, 1]]), [0, 0, 100, 0, 0, 100])))![0]);
    if (narrowed.kind !== 'linear') throw new Error(narrowed.kind);
    near([narrowed.x0, narrowed.y0, narrowed.x1, narrowed.y1], [25, 0, 75, 0]);
    expect(narrowed.stops.map((s) => s.offset)).toEqual([0, 1]);
    // 位置の順に並べる (書体の中の順が逆でも)
    const sorted = fillOf(opsOf(paint.glyph(gid('B'), paint.linear(stops([[1, 1], [0, 0]]), [0, 0, 100, 0, 0, 100])))![0]);
    expect(sorted.kind === 'linear' && sorted.stops.map((s) => s.color.rgb)).toEqual([[1, 0, 0], [0, 128 / 255, 0]]);
  });
  it('崩れたグラデーションは描かない (p₁ か p₂ が p₀ と同じ、p₀p₂ が p₀p₁ と平行、2 つの円が同じ)。止まり点 1 つは、その色のべた塗り', () => {
    expect(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0, 0], [1, 1]]), [0, 0, 100, 0, 0, 0])))).toEqual([]);
    expect(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0, 0], [1, 1]]), [0, 0, 100, 0, 50, 0])))).toEqual([]);
    expect(opsOf(paint.glyph(gid('B'), paint.radial(stops([[0, 0], [1, 1]]), [10, 10, 5, 10, 10, 5])))).toEqual([]);
    expect(fillOf(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0.3, 1]]), [0, 0, 100, 0, 0, 100])))![0]).kind).toBe('solid');
    // 止まり点がすべて同じ位置: pad なら、その位置を境にした 2 色。repeat・reflect は描かない
    const edge = fillOf(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0.5, 0], [0.5, 1]]), [0, 0, 100, 0, 0, 100])))![0]);
    expect(edge.kind === 'linear' && edge.stops.map((s) => s.offset)).toEqual([0, 0.5, 0.5, 1]);
    expect(opsOf(paint.glyph(gid('B'), paint.linear(stops([[0.5, 0], [0.5, 1]]), [0, 0, 100, 0, 0, 100], 1)))).toEqual([]);
  });
  it('PaintRadialGradient (2 つの円)・PaintSweepGradient (角度は、表の値に 1 を足して 180° を掛けたもの)・延ばし方', () => {
    const radial = fillOf(opsOf(paint.glyph(gid('B'), paint.radial(stops([[0, 0], [1, 1]]), [10, 20, 5, 30, 40, 50], 2)))![0]);
    expect(radial).toMatchObject({ kind: 'radial', extend: 2, x0: 10, y0: 20, r0: 5, x1: 30, y1: 40, r1: 50 });
    const sweep = fillOf(opsOf(paint.glyph(gid('B'), paint.sweep(stops([[0, 0], [1, 1]]), 100, 200, 90, 270, 1)))![0]);
    if (sweep.kind !== 'sweep') throw new Error(sweep.kind);
    expect(sweep).toMatchObject({ kind: 'sweep', extend: 1, cx: 100, cy: 200 });
    near([sweep.start, sweep.end], [90, 270]);
  });
  it('変換の Paint (12〜31) は、仕様の行列になる。中心のある変換は、中心へ移す・変換・戻す', () => {
    const leaf = paint.glyph(gid('B'), paint.solid(0));
    const matrix = (root: Uint8Array) => {
      const op = opsOf(root)![0];
      if (op.op !== 'transform') throw new Error(op.op);
      return op.m;
    };
    near(matrix(paint.transform([1, 0.5, -0.25, 2, 10, -20], leaf)), [1, 0.5, -0.25, 2, 10, -20]);
    near(matrix(paint.translate(30, -40, leaf)), [1, 0, 0, 1, 30, -40]);
    near(matrix(paint.scale(1.5, 0.5, leaf)), [1.5, 0, 0, 0.5, 0, 0]);
    // 中心 (100, 200) のまわりに 2 倍: 中心は動かない
    near(matrix(paint.scaleAround(1.5, 0.5, 100, 200, leaf)), [1.5, 0, 0, 0.5, -50, 100]);
    near(matrix(paint.scaleUniform(0.5, leaf)), [0.5, 0, 0, 0.5, 0, 0]);
    near(matrix(paint.scaleUniformAround(0.5, 100, 200, leaf)), [0.5, 0, 0, 0.5, 50, 100]);
    // 回転は反時計回り: xx = cos θ、yx = sin θ、xy = −sin θ、yy = cos θ
    near(matrix(paint.rotate(90, leaf)), [0, 1, -1, 0, 0, 0]);
    near(matrix(paint.rotateAround(90, 100, 0, leaf)), [0, 1, -1, 0, 100, -100]);
    // 傾け: yx = tan ψ (y の向きの角度)、xy = −tan φ (x の向きの角度)
    near(matrix(paint.skew(45, 0, leaf)), [1, 0, -1, 1, 0, 0]);
    near(matrix(paint.skew(0, 45, leaf)), [1, 1, 0, 1, 0, 0]);
    near(matrix(paint.skewAround(45, 0, 0, 100, leaf)), [1, 0, -1, 1, 100, 0]);
  });
  it('PaintComposite: SRC_OVER・DEST_OVER は重ねる順だけ。知らない種類と CLEAR は描かない。ほかは合成の命令になる', () => {
    const a = paint.glyph(gid('B'), paint.solid(0));
    const b = paint.glyph(gid('C'), paint.solid(1));
    const colors = (ops: ColorOp[] | undefined) => ops?.map((o) => (o.op === 'fill' && o.fill.kind === 'solid' ? o.fill.color.rgb![0] : -1));
    // source = a (赤)、backdrop = b (緑)。SRC_OVER は backdrop を先に、DEST_OVER は source を先に描く
    expect(colors(opsOf(paint.composite(a, COMPOSITE.SRC_OVER, b)))).toEqual([0, 1]);
    expect(colors(opsOf(paint.composite(a, COMPOSITE.DEST_OVER, b)))).toEqual([1, 0]);
    expect(colors(opsOf(paint.composite(a, COMPOSITE.SRC, b)))).toEqual([1]);
    expect(colors(opsOf(paint.composite(a, COMPOSITE.DEST, b)))).toEqual([0]);
    expect(opsOf(paint.composite(a, COMPOSITE.CLEAR, b))).toEqual([]);
    expect(opsOf(paint.composite(a, 40, b))).toEqual([]);
    for (const mode of [COMPOSITE.SRC_IN, COMPOSITE.DEST_OUT, COMPOSITE.XOR, COMPOSITE.PLUS, COMPOSITE.SOFT_LIGHT, COMPOSITE.HSL_LUMINOSITY]) {
      const [op] = opsOf(paint.composite(a, mode, b))!;
      expect(op).toMatchObject({ op: 'composite', mode });
      if (op.op === 'composite') expect([op.source.length, op.backdrop.length]).toEqual([1, 1]);
    }
  });
  it('PaintColrLayers は LayerList の一部分を下から重ねる。PaintGlyph の子が塗りでなければ、輪郭で切り抜く', () => {
    const layers = [paint.glyph(gid('B'), paint.solid(0)), paint.glyph(gid('C'), paint.solid(1)), paint.glyph(gid('D'), paint.solid(2))];
    const ops = opsOf(paint.colrLayers(2, 1), { layers })!;
    expect(ops.map((o) => fillOf(o)).map((f) => f.kind === 'solid' && f.color.rgb)).toEqual([[0, 128 / 255, 0], [0, 0, 1]]);
    const clipped = opsOf(paint.glyph(gid('B'), paint.colrLayers(2, 0)), { layers })!;
    expect(clipped).toHaveLength(1);
    expect(clipped[0]).toMatchObject({ op: 'clip' });
    expect(clipped[0].op === 'clip' && clipped[0].ops.length).toBe(2);
  });
  it('PaintColrGlyph は、別の字形の木を部品として描く (その字形の ClipBox で切り抜く)。循環は、その部分木だけを描かない', () => {
    const part = paint.glyph(gid('C'), paint.solid(1));
    const cf = colorFont({
      COLR: colr1({
        glyphs: [
          { gid: gid('A'), paint: paint.colrLayers(2, 0) },
          { gid: gid('B'), paint: part },
          // 字形 E は、自分自身を部品にする (循環)
          { gid: gid('E'), paint: paint.colrLayers(2, 2) },
        ],
        layers: [paint.glyph(gid('D'), paint.solid(0)), paint.colrGlyph(gid('B')), paint.glyph(gid('D'), paint.solid(0)), paint.colrGlyph(gid('E'))],
        clips: [{ start: gid('B'), end: gid('B'), box: [0, 0, 500, 600] }],
      }),
      CPAL: PALETTE,
    });
    const a = cf.glyph(gid('A'))!;
    expect(a.ops.map((o) => o.op)).toEqual(['fill', 'clip']);
    // 部品の字形の ClipBox の矩形で切り抜く
    expect(a.ops[1].op === 'clip' && a.ops[1].path.filter((s) => s.op !== 'Z').map((s) => [(s as { x: number }).x, (s as { y: number }).y])).toEqual([[0, 0], [500, 0], [500, 600], [0, 600]]);
    // 循環: 循環の所だけが落ち、ほかの層は描く
    expect(cf.glyph(gid('E'))!.ops.map((o) => o.op)).toEqual(['fill']);
  });
  it('ClipBox があれば、それが描く範囲 (その外は描かない)。無ければ中身の外接枠。範囲の決まらない字形 (切り抜きの無い塗り) は描かない', () => {
    const root = paint.glyph(gid('B'), paint.solid(0));
    const clipped = colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: root }], clips: [{ start: gid('A') - 1, end: gid('A') + 1, box: [-10, -20, 700, 800] }] }), CPAL: PALETTE }).glyph(gid('A'))!;
    expect([clipped.bbox, clipped.clip]).toEqual([[-10, -20, 700, 800], true]);
    const free = colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: root }] }), CPAL: PALETTE });
    const g = free.glyph(gid('A'))!;
    expect(g.clip).toBe(false);
    const xs = free.outline(gid('B')).flatMap((s) => (s.op === 'Z' ? [] : [s.x]));
    expect(g.bbox[0]).toBeCloseTo(Math.min(...xs), 6);
    expect(g.bbox[2]).toBeCloseTo(Math.max(...xs), 6);
    // PaintSolid だけ (どこまでも塗る): ClipBox が無ければ描かない。あれば、ClipBox の中を塗る
    expect(colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.solid(0) }] }), CPAL: PALETTE }).glyph(gid('A'))).toBeUndefined();
    const boxed = colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.solid(0) }], clips: [{ start: gid('A'), end: gid('A'), box: [0, 0, 100, 100] }] }), CPAL: PALETTE }).glyph(gid('A'))!;
    expect(boxed.ops.map((o) => o.op)).toEqual(['paint']);
  });
  it('version 0 と 1 の両方に定義のある字形は、version 1 を使う。version 0 にしか無い字形は、version 0 で描く', () => {
    const cf = colorFont({
      COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.glyph(gid('B'), paint.solid(1)) }], v0: [{ gid: gid('A'), layers: [[gid('C'), 0]] }, { gid: gid('D'), layers: [[gid('C'), 0], [gid('B'), 2]] }] }),
      CPAL: PALETTE,
    });
    expect(cf.glyph(gid('A'))!.source).toBe('colr1');
    expect(cf.glyph(gid('D'))).toMatchObject({ source: 'colr0' });
    expect(cf.glyph(gid('D'))!.ops).toHaveLength(2);
  });
  it('前景色をグラデーションの止まり点に使う字形は、文字の色ごとに描き分けが要ると分かる', () => {
    const g = colorFont({ COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.glyph(gid('B'), paint.linear([[0, 0xffff, 1], [1, 0, 1]], [0, 0, 100, 0, 0, 100])) }] }), CPAL: PALETTE }).glyph(gid('A'))!;
    expect([g.usesForeground, g.foregroundInGradient]).toEqual([true, true]);
  });
  it('表の範囲の外を指す Paint は、その部分木だけを描かない (例外にしない)', () => {
    const broken = new Bytes().u8(10).u24(0xfffff0).u16(gid('B')).done();
    expect(opsOf(paint.colrLayers(2, 0), { layers: [broken, paint.glyph(gid('C'), paint.solid(0))] })!.map((o) => o.op)).toEqual(['fill']);
  });
});

describe('グラデーションの色の線', () => {
  const two: ColorStop[] = [{ offset: 0, color: { rgb: [1, 0, 0], a: 1 } }, { offset: 1, color: { rgb: [0, 0, 1], a: 1 } }];
  it('繰り返し (repeat)・折り返し (reflect) は、覆う範囲の分だけ色の線を並べる。pad は、そのまま', () => {
    expect(unrollStops(two, 0, -3, 5)).toEqual({ stops: two, lo: 0, hi: 1 });
    const repeat = unrollStops(two, 1, -0.5, 1.5);
    expect([repeat.lo, repeat.hi]).toEqual([-1, 2]);
    expect(repeat.stops.map((s) => [Number(s.offset.toFixed(4)), s.color.rgb![0]])).toEqual([[0, 1], [0.3333, 0], [0.3333, 1], [0.6667, 0], [0.6667, 1], [1, 0]]);
    // 折り返し: 奇数番目の周期は、色の順が逆 (「…ABC CBA ABC…」)
    const reflect = unrollStops(two, 2, -0.5, 1.5);
    expect(reflect.stops.map((s) => s.color.rgb![0])).toEqual([0, 1, 1, 0, 0, 1]);
  });
  it('不透明度の違う止まり点の間は、不透明度を掛けた値での補間になるように、途中の色を足す (透明な黒へ向かう色が黒ずまない)', () => {
    const fade: ColorStop[] = [{ offset: 0, color: { rgb: [1, 0, 0], a: 1 } }, { offset: 1, color: { rgb: [0, 0, 0], a: 0 } }];
    const plain = plainStops(fade, [0, 0, 0]);
    expect(plain.length).toBe(9);
    // 途中の色は赤のまま (不透明度だけが下がる)。RGB をそのまま補間すると、中ほどが暗い赤 (0.5, 0, 0) になる
    expect(plain[4].rgb[0]).toBeCloseTo(1, 6);
    expect(plain[4].a).toBeCloseTo(0.5, 6);
    // 不透明度が同じなら、足さない。前景色は、文字の色に置き換える
    expect(plainStops([{ offset: 0, color: { rgb: null, a: 1 } }, { offset: 1, color: { rgb: [0, 0, 1], a: 1 } }], [0, 1, 0])).toEqual([{ offset: 0, rgb: [0, 1, 0], a: 1 }, { offset: 1, rgb: [0, 0, 1], a: 1 }]);
  });
  it('掃引 (sweep): 描くのは 0°〜360°。始まりの角度より前・終わりの角度より後は、端の色 (pad)', () => {
    const s = sweepSampler({ kind: 'sweep', stops: two, extend: 0, cx: 0, cy: 0, start: 90, end: 270 }, [0, 0, 0])!;
    expect(s.angles).toEqual([0, 90, 270, 360]);
    expect(s.sample(0, 1).rgb).toEqual([1, 0, 0]);
    expect(s.sample(180, 1).rgb).toEqual([0.5, 0, 0.5]);
    expect(s.sample(359, 1).rgb).toEqual([0, 0, 1]);
    expect(sweepSampler({ kind: 'sweep', stops: two, extend: 0, cx: 0, cy: 0, start: 90, end: 90 }, [0, 0, 0])).toBeUndefined();
  });
});

/** 2 × 3 画素の PNG (RGBA) */
const tinyPng = () => encodePngStored({ width: 2, height: 3, rgba: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4, 9, 8, 7, 6, 250, 251, 252, 253]) });

describe('ビットマップの字形 (CBDT/CBLC・sbix)', () => {
  it('CBDT: 寸法は大きさ (ppem) の画素。書体の単位へは unitsPerEm / ppem を掛け、基線から bearingY だけ上が画像の上端', () => {
    const png = tinyPng();
    const cf = colorFont(cbdt(gid('A'), png, { ppem: 100, width: 120, height: 110, bearingX: 5, bearingY: 90, advance: 125 }));
    expect(cf.tables).toEqual({ cbdt: true });
    const g = cf.glyph(gid('A'))!;
    expect(g.source).toBe('cbdt');
    const [img] = g.ops;
    if (img.op !== 'image') throw new Error(img.op);
    const s = upm / 100;
    near([img.x, img.y, img.w, img.h], [5 * s, (90 - 110) * s, 120 * s, 110 * s]);
    expect(img.kind).toBe('png');
    expect([...img.data]).toEqual([...png]);
    expect(cf.glyph(gid('B'))).toBeUndefined();
  });
  it('sbix: 画像の左下を、原点から originOffset (大きさの画素) の所に置く。輪郭のある字形では、輪郭の外接枠の左下が基準。dupe は別の字形の画像', () => {
    const png = tinyPng();
    const numGlyphs = (fontkit.create(new Uint8Array(tinos)) as unknown as { numGlyphs: number }).numGlyphs;
    const table = sbix(numGlyphs, 20, new Map([[gid('A'), { type: 'png ', x: 3, y: -4, data: png }], [gid('B'), { type: 'dupe', x: 0, y: 0, data: new Bytes().u16(gid('A')).done() }]]));
    // 輪郭の表を外した書体: 原点が基準
    const bare = colorFont({ sbix: table, glyf: null, loca: null }).glyph(gid('A'))!;
    const s = upm / 20;
    const [img] = bare.ops;
    if (img.op !== 'image') throw new Error(img.op);
    near([img.x, img.y, img.w, img.h], [3 * s, -4 * s, 2 * s, 3 * s]);
    // 輪郭のある書体: 輪郭の外接枠の左下 (xMin, yMin) が基準
    const cf = colorFont({ sbix: table });
    const outline = cf.outline(gid('A'));
    const xMin = Math.min(...outline.flatMap((p) => (p.op === 'Z' ? [] : [p.x])));
    const yMin = Math.min(...outline.flatMap((p) => (p.op === 'Z' ? [] : [p.y])));
    const [placed] = cf.glyph(gid('A'))!.ops;
    if (placed.op !== 'image') throw new Error(placed.op);
    near([placed.x, placed.y], [xMin + 3 * s, yMin - 4 * s]);
    // dupe: 字形 A の画像を、字形 B の位置の決まりで置く
    const [dup] = cf.glyph(gid('B'))!.ops;
    expect(dup.op === 'image' && [...dup.data]).toEqual([...png]);
    expect(cf.glyph(gid('C'))).toBeUndefined();
  });
  it('PNG を同期で画素に戻せる (Canvas に描くとき。フィルタ・パレット・透明色)', () => {
    const px = decodePng(tinyPng())!;
    expect([px.width, px.height]).toEqual([2, 3]);
    expect([...px.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4, 9, 8, 7, 6, 250, 251, 252, 253]);
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

const xml = (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml') as unknown as XmlNode;

describe('SVG の表 (OpenType-SVG)', () => {
  const reader = svgGlyphReader(xml);
  const svgFont = (docs: Parameters<typeof svgTable>[0], extra: Record<string, Uint8Array> = {}) => {
    const cf = colorFont({ 'SVG ': svgTable(docs), ...extra });
    cf.svgReader = reader;
    return cf;
  };
  /** 命令の並びの、いちばん外の変換と、その中の命令 */
  const unwrap = (ops: ColorOp[]) => {
    if (ops.length !== 1 || ops[0].op !== 'transform') throw new Error('no outer transform');
    return ops[0];
  };
  it('利用者座標の 1 単位は書体の 1 単位で、y は下向き (字形の座標へは、y を返す)。圧縮した文書 (gzip) も読む', () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${0}"><rect x="100" y="-430" width="200" height="430" fill="#ff0000"/></svg>`.replace('glyph0', `glyph${gid('A')}`);
    for (const docBytes of [text, new Uint8Array(gzipSync(text))]) {
      const g = svgFont([{ start: gid('A'), end: gid('A'), doc: docBytes }]).glyph(gid('A'))!;
      expect(g.source).toBe('svg');
      const outer = unwrap(g.ops);
      near(outer.m, [1, 0, 0, -1, 0, 0]);
      expect(fillOf(outer.ops[0])).toEqual({ kind: 'solid', color: { rgb: [1, 0, 0], a: 1 } });
      // 描く範囲 (字形の座標): 基線の上の 0〜430
      near(g.bbox, [100, 0, 300, 430]);
    }
  });
  it('根の viewBox は、全角の枠 (unitsPerEm 角) に合わせる変換になる (SVG の表の章の例 3: viewBox で上へずらす)', () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${gid('A')}" viewBox="0 ${upm} ${upm} ${upm}"><rect x="100" y="${upm - 430}" width="200" height="430" fill="blue"/></svg>`;
    const g = svgFont([{ start: gid('A'), end: gid('A'), doc: text }]).glyph(gid('A'))!;
    near(g.bbox, [100, 0, 300, 430]);
    // viewBox の大きさが全角と違えば、拡大・縮小になる (半分の大きさの viewBox は 2 倍)
    const half = `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${gid('A')}" viewBox="0 0 ${upm / 2} ${upm / 2}"><rect x="0" y="-100" width="50" height="100" fill="blue"/></svg>`;
    near(svgFont([{ start: gid('A'), end: gid('A'), doc: half }]).glyph(gid('A'))!.bbox, [0, 0, 100, 200]);
  });
  it('currentColor は前景色、var(--colorN) は CPAL のパレットの色 (無ければ代わりの色)。1 つの文書の、ほかの字形の要素は描かない', () => {
    const a = gid('A');
    const b = gid('B');
    const text = `<svg xmlns="http://www.w3.org/2000/svg"><g id="glyph${a}"><rect x="0" y="-10" width="10" height="10" fill="currentColor"/><rect x="20" y="-10" width="10" height="10" fill="var(--color1, yellow)"/><rect x="40" y="-10" width="10" height="10" fill="var(--color9, #00ffff)"/></g><g id="glyph${b}"><rect x="500" y="-700" width="10" height="10" fill="red"/></g></svg>`;
    const cf = svgFont([{ start: Math.min(a, b), end: Math.max(a, b), doc: text }], { CPAL: PALETTE });
    const ga = cf.glyph(a)!;
    const fills = unwrap(ga.ops).ops.map((o) => fillOf(o)).map((f) => (f.kind === 'solid' ? f.color.rgb : undefined));
    expect(fills).toEqual([null, [0, 128 / 255, 0], [0, 1, 1]]);
    expect(ga.usesForeground).toBe(true);
    near(ga.bbox, [0, 0, 50, 10]);
    near(cf.glyph(b)!.bbox, [500, 690, 510, 700]);
  });
  it('グラデーションは、輪郭で切り抜いた中の塗りになる。読み手 (XML を読む関数) が無ければ、SVG だけの字形は色つきにしない', () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${gid('A')}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient></defs><rect x="0" y="-100" width="100" height="100" fill="url(#g)"/></svg>`;
    const cf = colorFont({ 'SVG ': svgTable([{ start: gid('A'), end: gid('A'), doc: text }]) });
    expect(cf.glyph(gid('A'))).toBeUndefined();
    const withReader = svgFont([{ start: gid('A'), end: gid('A'), doc: text }]).glyph(gid('A'))!;
    const [clip] = unwrap(withReader.ops).ops;
    if (clip.op !== 'clip' || clip.ops[0].op !== 'transform') throw new Error('not a clipped gradient');
    const fill = fillOf(clip.ops[0].ops[0]);
    expect(fill).toMatchObject({ kind: 'linear', x0: 0, y0: 0, x1: 100, y1: 0 });
    expect(fill.kind === 'linear' && fill.stops.map((s) => s.color.a)).toEqual([1, 0.5]);
  });
});

// ---- 組版と PDF ----

/** PDF の Type 3 書体の辞書 (ページの資源から。同じ辞書は 1 度だけ) */
function type3Fonts(pdf: PDFDocument): PDFDict[] {
  const seen = new Set<PDFDict>();
  for (const page of pdf.getPages()) {
    const fontsDict = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fontsDict?.entries() ?? []) {
      const f = pdf.context.lookup(ref, PDFDict);
      if (f.get(PDFName.of('Subtype')) === PDFName.of('Type3')) seen.add(f);
    }
  }
  return [...seen];
}
const streamText = (pdf: PDFDocument, ref: unknown) => new TextDecoder('latin1').decode(decodePDFRawStream(pdf.context.lookup(ref as PDFRef) as PDFRawStream).decode());
/** ページの内容 (すべてのページ) */
const pageContent = (pdf: PDFDocument) =>
  pdf
    .getPages()
    .map((p) => {
      const c = pdf.context.lookup(p.node.get(PDFName.of('Contents')));
      const refs = c instanceof PDFArray ? c.asArray() : [p.node.get(PDFName.of('Contents'))];
      return refs.map((r) => streamText(pdf, r)).join('\n');
    })
    .join('\n');
/** Type 3 書体の字形の手続き (名前 → 中身) */
const charProcs = (pdf: PDFDocument, font: PDFDict) => new Map([...font.lookup(PDFName.of('CharProcs'), PDFDict).entries()].map(([k, v]) => [k.decodeText(), streamText(pdf, v)]));

/** 書体 (既定の和文の書体 + 渡した書体) で、ブロックを組む */
async function setup(extra: Record<string, ArrayBuffer>) {
  const fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  for (const [family, buffer] of Object.entries(extra)) await fonts.registerBuffer(family, 400, buffer, false);
  const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
  const layout = (blocks: object[]) => engine.layout(doc(blocks.map((b) => ({ type: 'block', textAlign: 'start', ...b })) as never));
  const glyphs = (tree: ReturnType<typeof layout>) => {
    const out: GlyphArea[] = [];
    const visit = (a: Area) => {
      if (a.type === 'glyph') out.push(a);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    for (const c of tree.sheets[0].page.regionBody.children) visit(c);
    return out;
  };
  return { fonts, layout, glyphs };
}

describe('PDF: 色つきの書体の字は、Type 3 書体の字として書く', () => {
  it('COLR の書体で PDF を作れる (直す前は、部分書体を作る所で「glyph._decode is not a function」で落ちた)。字形の定義は 1 度、字は文字のまま', async () => {
    const color = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0], [gid('C'), 0xffff]] }]), CPAL: PALETTE });
    const { fonts, layout, glyphs } = await setup({ Color: color });
    const tree = layout([{ fontFamily: 'Color', color: '#112233', children: ['A'.repeat(100) + 'Z'] }]);
    // 送りは、ふつうの字と同じ (hmtx)
    const plain = await setup({ Plain: tinos });
    expect(glyphs(tree).map((g) => g.advance)).toEqual(plain.glyphs(plain.layout([{ fontFamily: 'Plain', children: ['A'.repeat(100) + 'Z'] }])).map((g) => g.advance));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const [t3, ...rest] = type3Fonts(pdf);
    expect(rest).toEqual([]);
    // 字形の手続き: 色つきの A と、色つきでない Z (輪郭)。それに、字の大きさの見積もり用の空の字形 m
    const procs = charProcs(pdf, t3);
    expect([...procs.keys()].sort()).toEqual(['g0', 'g1', 'm']);
    const a = procs.get('g0')!;
    const adv = (fontkit.create(new Uint8Array(tinos)) as unknown as { getGlyph(id: number): { advanceWidth: number } }).getGlyph(gid('A')).advanceWidth;
    // 「送り 0 d0」で始まる (形と色の両方を決める字形)。1 つ目の層は赤、2 つ目 (前景色) は色を決めない (置くときの文字の色を引き継ぐ)
    expect(a.startsWith(`${adv} 0 d0\n`)).toBe(true);
    expect(a.match(/\b1 0 0 rg\b/g)).toHaveLength(1);
    expect(a.match(/\brg\b/g)).toHaveLength(1);
    expect(a.match(/^f$/gm)).toHaveLength(2);
    // 色つきでない字形 Z: 色を決めずに輪郭を塗る
    expect(procs.get('g1')).not.toMatch(/\b(rg|g|k)\n/);
    expect((t3.lookup(PDFName.of('Widths'), PDFArray).asArray() as PDFNumber[]).map((n) => n.asNumber())).toEqual([upm * 0.6, adv, (fontkit.create(new Uint8Array(tinos)) as unknown as { getGlyph(id: number): { advanceWidth: number } }).getGlyph(gid('Z')).advanceWidth]);
    near((t3.lookup(PDFName.of('FontMatrix'), PDFArray).asArray() as PDFNumber[]).map((n) => n.asNumber()), [1 / upm, 0, 0, 1 / upm, 0, 0]);
    // 元の字 (ToUnicode): 符号 0x21 → A、0x22 → Z
    const cmap = streamText(pdf, t3.get(PDFName.of('ToUnicode')));
    expect(cmap).toContain('<21> <0041>');
    expect(cmap).toContain('<22> <005A>');
    // ページには、文字の色を塗りの色にして、字を 101 個置く (A は同じ符号を 100 回)
    const content = pageContent(pdf);
    expect(content.match(/<21> Tj/g)).toHaveLength(100);
    expect(content.match(/<22> Tj/g)).toHaveLength(1);
    expect(content).toMatch(/0\.0666\d* 0\.1333\d* 0\.2 rg\s+BT/);
    // 色つきの書体そのものは埋め込まない (和文の書体だけ)
    expect(content).not.toContain('ActualText');
  });
  it('輪郭の表を持たない書体 (CBDT だけ) を組める (直す前は、組版で「Cannot read properties of null」で止まった)。画像は文書に 1 つ', async () => {
    const png = tinyPng();
    const bitmap = withTables(tinos, { ...cbdt(gid('A'), png, { ppem: 100, width: 120, height: 110, bearingX: 5, bearingY: 90, advance: 125 }), glyf: null, loca: null });
    const { fonts, layout, glyphs } = await setup({ Bitmap: bitmap });
    const tree = layout([{ fontFamily: 'Bitmap', fontSize: 20, children: ['AAA B'] }]);
    const plain = await setup({ Plain: tinos });
    // 送りは hmtx (ビットマップの寸法ではない)
    expect(glyphs(tree).map((g) => g.advance)).toEqual(plain.glyphs(plain.layout([{ fontFamily: 'Plain', fontSize: 20, children: ['AAA B'] }])).map((g) => g.advance));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const [t3] = type3Fonts(pdf);
    const procs = charProcs(pdf, t3);
    // 字形 A: 画像を、(幅, 高さ) に伸ばして左下に置く。書体の単位 (unitsPerEm / ppem 倍)
    const s = upm / 100;
    expect(procs.get('g0')).toMatch(new RegExp(`^\\d+ 0 d0\\nq\\n${120 * s} 0 0 ${110 * s} ${5 * s} ${(90 - 110) * s} cm\\n/I\\d+ Do\\nQ\\n$`));
    // 画像の XObject は 1 つ (3 回使っても)。透明度つきの PNG は、SMask を持つ
    const xobjects = t3.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects.entries()).toHaveLength(1);
    const image = pdf.context.lookup(xobjects.entries()[0][1]) as PDFRawStream;
    expect([image.dict.get(PDFName.of('Width')), image.dict.get(PDFName.of('Height'))].map((n) => (n as PDFNumber).asNumber())).toEqual([2, 3]);
    expect(image.dict.has(PDFName.of('SMask'))).toBe(true);
    expect(pageContent(pdf).match(/<21> Tj/g)).toHaveLength(3);
  });
  it('sbix・SVG の表の書体も、落ちずに色つきで書ける。SVG を読めないとき (XML を読む関数が無い) は、輪郭を文字の色で描く', async () => {
    const numGlyphs = (fontkit.create(new Uint8Array(tinos)) as unknown as { numGlyphs: number }).numGlyphs;
    const sb = withTables(tinos, { sbix: sbix(numGlyphs, 20, new Map([[gid('A'), { type: 'png ', x: 0, y: 0, data: tinyPng() }]])) });
    const svg = withTables(tinos, { 'SVG ': svgTable([{ start: gid('A'), end: gid('A'), doc: `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${gid('A')}"><rect x="0" y="-500" width="400" height="500" fill="#00ff00"/></svg>` }]) });
    const { fonts, layout } = await setup({ Sbix: sb, Svg: svg });
    const tree = layout([{ fontFamily: 'Sbix', children: ['AB'] }, { fontFamily: 'Svg', children: ['AB'] }]);
    const withXml = await PDFDocument.load(await renderPdf(tree, fonts, { parseXml: xml }));
    const all = type3Fonts(withXml).flatMap((f) => [...charProcs(withXml, f).values()]);
    expect(all.some((p) => /\/I\d+ Do/.test(p))).toBe(true);
    expect(all.some((p) => /\b0 1 0 rg\b/.test(p))).toBe(true);
    // XML を読む関数を渡さない (Node には DOMParser が無い): SVG の字形は、色を決めない輪郭になる。落ちない
    const { fonts: fonts2, layout: layout2 } = await setup({ Svg: withTables(svg, {}) });
    const noXml = await PDFDocument.load(await renderPdf(layout2([{ fontFamily: 'Svg', children: ['AB'] }]), fonts2));
    const procs = type3Fonts(noXml).flatMap((f) => [...charProcs(noXml, f).values()]);
    expect(procs.some((p) => /\brg\b/.test(p))).toBe(false);
    expect(procs.filter((p) => /^f$/m.test(p))).toHaveLength(2);
  });
  it('COLR version 1: グラデーションは網かけ (sh)、止まり点の不透明度はソフトマスク、合成は透明のグループと描画モードになる', async () => {
    const b = gid('B');
    const layers = [
      paint.glyph(b, paint.linear(stops([[0, 0], [1, 1]]), [0, 0, 500, 0, 0, 500])),
      paint.glyph(b, paint.radial([[0, 0, 1], [1, 2, 0.25]], [300, 300, 0, 300, 300, 400])),
      paint.glyph(b, paint.sweep(stops([[0, 0], [1, 1]]), 300, 300, 0, 360)),
      paint.composite(paint.glyph(b, paint.solid(0)), COMPOSITE.SRC_IN, paint.glyph(gid('C'), paint.solid(1))),
      paint.composite(paint.glyph(b, paint.solid(0)), COMPOSITE.MULTIPLY, paint.glyph(gid('C'), paint.solid(1))),
      paint.scale(0.5, 0.5, paint.glyph(b, paint.solid(1, 0.5))),
    ];
    const color = withTables(tinos, { COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.colrLayers(layers.length, 0) }], layers, clips: [{ start: gid('A'), end: gid('A'), box: [0, -100, 1500, 1500] }] }), CPAL: PALETTE });
    const { fonts, layout } = await setup({ Color: color });
    const pdf = await PDFDocument.load(await renderPdf(layout([{ fontFamily: 'Color', children: ['A'] }]), fonts));
    const [t3] = type3Fonts(pdf);
    const proc = charProcs(pdf, t3).get('g0')!;
    // ClipBox で切り抜く
    expect(proc).toContain('0 -100 1500 1600 re W n');
    expect(proc.match(/\/S\d+ sh/g)).toHaveLength(3);
    expect(proc).toMatch(/0\.5 0 0 0\.5 0 0 cm/);
    const res = t3.lookup(PDFName.of('Resources'), PDFDict);
    const shadings = res.lookup(PDFName.of('Shading'), PDFDict).entries().map(([, v]) => pdf.context.lookup(v) as PDFDict | PDFRawStream);
    const types = shadings.map((s) => ((s instanceof PDFDict ? s : s.dict).get(PDFName.of('ShadingType')) as PDFNumber).asNumber()).sort();
    // 線形 (2)、放射の色と不透明度 (3 が 2 つ)、掃引 (三角形の網 4)
    expect(types).toEqual([2, 3, 3, 4]);
    const states = res.lookup(PDFName.of('ExtGState'), PDFDict).entries().map(([, v]) => pdf.context.lookup(v, PDFDict));
    // 不透明度のソフトマスク (放射の止まり点)・SRC_IN のマスク (S = Alpha)・描画モード (Multiply)・一様な不透明度 (ca)
    const masks = states.filter((s) => s.has(PDFName.of('SMask'))).map((s) => s.lookup(PDFName.of('SMask'), PDFDict).get(PDFName.of('S')));
    expect(masks.map(String).sort()).toEqual(['/Alpha', '/Luminosity']);
    expect(states.some((s) => s.get(PDFName.of('BM')) === PDFName.of('Multiply'))).toBe(true);
    expect(states.some((s) => (s.get(PDFName.of('ca')) as PDFNumber | undefined)?.asNumber() === 0.5)).toBe(true);
  });
  it('前景色をグラデーションに使う字形は、文字の色ごとに手続きを分ける。べた塗りの前景色は、1 つの手続きで色を引き継ぐ', async () => {
    const gradient = withTables(tinos, { COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.glyph(gid('B'), paint.linear([[0, 0xffff, 1], [1, 0, 1]], [0, 0, 500, 0, 0, 500])) }] }), CPAL: PALETTE });
    const solid = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0xffff]] }]), CPAL: PALETTE });
    const { fonts, layout } = await setup({ Gradient: gradient, Solid: solid });
    const count = async (family: string) => {
      const pdf = await PDFDocument.load(await renderPdf(layout([{ fontFamily: family, color: '#ff0000', children: ['A'] }, { fontFamily: family, color: '#0000ff', children: ['A'] }]), fonts));
      return type3Fonts(pdf).reduce((n, f) => n + charProcs(pdf, f).size - 1, 0);
    };
    expect(await count('Gradient')).toBe(2);
    expect(await count('Solid')).toBe(1);
  });
  it('入稿用 (PDF/X): 字形の色も CMYK で書く', async () => {
    const color = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0]] }]), CPAL: PALETTE });
    const { fonts, layout } = await setup({ Color: color });
    const pdf = await PDFDocument.load(await renderPdf(layout([{ fontFamily: 'Color', children: ['A'] }]), fonts, { pdfx: {} }));
    const proc = charProcs(pdf, type3Fonts(pdf)[0]).get('g0')!;
    expect(proc).toMatch(/\b0 1 1 0 k\b/);
    expect(proc).not.toMatch(/\brg\b/);
  });
  it('字形と字の並びが対応しない字の単位には、元の字の並び (ActualText) を付ける', async () => {
    const color = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0]] }]), CPAL: PALETTE });
    const { fonts, layout, glyphs } = await setup({ Color: color });
    const tree = layout([{ fontFamily: 'Color', children: ['AB'] }]);
    // 字の領域の字と字形を、対応しない形に書き換える (2 字 → 3 つの字形)
    const [first] = glyphs(tree);
    first.text = 'AB';
    first.glyphIds = [gid('A'), gid('B'), gid('C')];
    delete first.glyphPositions;
    const content = pageContent(await PDFDocument.load(await renderPdf(tree, fonts)));
    expect(content).toContain('/Span <</ActualText <FEFF00410042>>> BDC');
    // 次の字 B は、字形 B に字が登録されていない (上の並びの 2 つ目の字形として、字なしで登録された) ので、これにも付く
    expect(content).toContain('/Span <</ActualText <FEFF0042>>> BDC');
    expect(content.match(/EMC/g)).toHaveLength(2);
  });
});

describe('実物の書体', () => {
  const buf = async (name: Parameters<typeof extraTestFont>[0]) => {
    const b = fs.readFileSync(await extraTestFont(name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  it('絵文字の並び (肌の色・ZWJ・国旗・キーキャップ) を、COLR version 0 の絵文字の書体 (Twemoji) で色つきに書け、元の符号が取り出せる', async () => {
    const { fonts, layout, glyphs } = await setup({ Emoji: await buf('TwemojiMozilla-colr-0.7.0.ttf') });
    const text = '😀👍🏽👨‍👩‍👧🇯🇵1\uFE0F⃣';
    const tree = layout([{ fontFamily: 'Emoji', children: [text] }]);
    const areas = glyphs(tree);
    expect(areas.map((g) => g.text)).toEqual(['😀', '👍🏽', '👨‍👩‍👧', '🇯🇵', '1\uFE0F⃣']);
    expect(areas.every((g) => g.fontFamily === 'Emoji')).toBe(true);
    const emoji = fonts.get('Emoji', 400);
    const cf = colorFontOf(emoji)!;
    // 並びは 1 つの字形 (書体の合字) になり、その字形が色つき
    for (const g of areas.slice(0, 4)) {
      const ids = areaGlyphs(g, emoji).filter((x) => cf.glyph(x.id));
      expect(ids.length).toBe(1);
    }
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const [t3] = type3Fonts(pdf);
    const cmap = streamText(pdf, t3.get(PDFName.of('ToUnicode')));
    const utf16 = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('');
    for (const g of areas.slice(0, 4)) expect(cmap).toContain(`<${utf16(g.text)}>`);
    // 色の層 (rg・g) を持つ手続きが、少なくとも並びの数だけある
    expect([...charProcs(pdf, t3).values()].filter((p) => /\b(rg|g)\n/.test(p)).length).toBeGreaterThanOrEqual(4);
  });
  it('COLR version 0 の欧文の書体 (Bungee Color): 層の輪郭が、基底の字形と同じ字形でも読める', async () => {
    const font = { fk: fontkit.create(new Uint8Array(await buf('BungeeColor-Regular_colr-1.0.0.ttf'))), buffer: await buf('BungeeColor-Regular_colr-1.0.0.ttf') };
    const cf = colorFontOf(font)!;
    const a = (font.fk as unknown as { glyphForCodePoint(cp: number): { id: number } }).glyphForCodePoint(0x41).id;
    const g = cf.glyph(a)!;
    expect(g.ops).toHaveLength(2);
    for (const o of g.ops) expect(o.op === 'fill' && o.path.length).toBeGreaterThan(4);
  });
  it('COLR version 1 の書体 (Nabla): すべての色つきの字形が読め、font-palette でパレットを選べる', async () => {
    const nabla = await buf('Nabla-v17.ttf');
    const fk = fontkit.create(new Uint8Array(nabla)) as unknown as { numGlyphs: number; glyphForCodePoint(cp: number): { id: number } };
    const cf = colorFontOf({ fk, buffer: nabla })!;
    expect(cf.tables.colr).toBe(1);
    expect(cf.paletteCount).toBe(7);
    let colored = 0;
    for (let id = 0; id < fk.numGlyphs; id++) if (cf.glyph(id)?.ops.length) colored++;
    expect(colored).toBeGreaterThan(300);
    const a = fk.glyphForCodePoint(0x41).id;
    const first = (pal?: Parameters<ColorFont['glyph']>[1]) => JSON.stringify(cf.glyph(a, pal)!.ops);
    expect(first({ base: 1 })).not.toBe(first());
    expect(first({ base: 0 })).toBe(first());
    // HTML: @font-palette-values の名前で選ぶ。規則の無い名前・ほかの書体の規則は、既定のパレット
    const html = `<style>@font-face { font-family: "N"; src: url("n.ttf") }
      @font-palette-values --one { font-family: "N"; base-palette: 1 }
      @font-palette-values --mine { font-family: N; base-palette: 2; override-colors: 0 #0044cc, 1 rgb(0 200 100) }
      @font-palette-values --other { font-family: "Other"; base-palette: 3 }
      p { font-family: "N" }</style>
      <p>A<span style="font-palette: --one">B<i style="font-palette: normal">C</i></span><span style="font-palette: --mine">D</span><span style="font-palette: --other">E</span><span style="font-palette: --none">F</span><span style="font-palette: dark">G</span></p>`;
    const loadFont = async (spec: FontSpec) => {
      const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
      if (!fs.existsSync(f)) return undefined;
      const b = fs.readFileSync(f);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const r = await typesetHtml(html, { loadFont, files: [{ name: 'n.ttf', data: nabla }] });
    expect(r.warnings.filter((w) => /font-palette|base-palette|override-colors/.test(w))).toEqual([]);
    const palettes = new Map<string, GlyphArea['fontPalette']>();
    walkAreaTree(r.areaTree, (area) => {
      if (area.type === 'glyph' && /^[A-G]$/.test(area.text)) palettes.set(area.text, area.fontPalette);
    });
    expect(Object.fromEntries(palettes)).toEqual({ A: undefined, B: { base: 1 }, C: undefined, D: { base: 2, colors: [[0, '#0044cc'], [1, '#00c864']] }, E: undefined, F: undefined, G: undefined });
    // PDF: パレットごとに、別の Type 3 書体 (既定・1 番・差し替え)
    const pdf = await PDFDocument.load(await r.toPdf());
    expect(type3Fonts(pdf)).toHaveLength(3);
  });
});

describe('@font-palette-values (CSS Fonts 4 §9.2)', () => {
  it('名前・font-family・base-palette・override-colors を読む。font-family の無い規則・総称を含む規則は無効', () => {
    const css = `@font-palette-values --a { font-family: "X Y", Z; base-palette: 3; override-colors: 0 red, 2 rgba(0, 0, 255, 0.5) }
      @font-palette-values --b { base-palette: 1 }
      @font-palette-values --c { font-family: serif; base-palette: 1 }
      @font-palette-values --d { font-family: X; base-palette: dark }
      @font-palette-values e { font-family: X }
      @font-palette-values --f { font-family: X; override-colors: 0 notacolor }`;
    expect(parseCss(css).fontPaletteValues).toEqual([
      { name: '--a', families: ['X Y', 'Z'], base: 3, colors: [[0, '#ff0000'], [2, '#0000ff80']] },
      { name: '--d', families: ['X'], base: 'dark' },
      { name: '--f', families: ['X'] },
    ]);
    expect(parseCss('p { color: red }').fontPaletteValues).toBeUndefined();
  });
  it('書体のファミリーごとに、書いた順の最後の規則が勝つ。パレットを持たない書体・既定と同じ選び方は、何も付けない', () => {
    const buffer = withTables(tinos, { COLR: colr0([]), CPAL: cpal([[RED, GREEN], [BLUE, RED], [GREEN, BLUE]], [0, 1, 2]) });
    const font = { family: 'css:My Font', fk: fontkit.create(new Uint8Array(buffer)), buffer };
    const rules = [
      { name: '--p', families: ['My Font'], base: 1 },
      { name: '--p', families: ['Other'], base: 2 },
      { name: '--p', families: ['my font'], base: 2, colors: [[1, '#000000'], [9, '#ffffff']] as Array<[number, string]> },
    ];
    expect(paletteForFont(rules, font)).toEqual({ base: 2, colors: [[1, '#000000']] });
    expect(paletteForFont(rules.slice(0, 2), font)).toEqual({ base: 1 });
    expect(paletteForFont(rules.slice(1, 2), font)).toBeUndefined();
    expect(paletteForFont('light', font)).toEqual({ base: 1 });
    expect(paletteForFont('dark', font)).toEqual({ base: 2 });
    expect(paletteForFont('normal', font)).toBeUndefined();
    expect(paletteForFont([{ name: '--z', families: ['My Font'], base: 0 }], font)).toBeUndefined();
    expect(paletteForFont([{ name: '--z', families: ['My Font'], base: 99 }], font)).toBeUndefined();
    // 色つきの表の無い書体
    expect(paletteForFont(rules, { family: 'css:My Font', fk: fontkit.create(new Uint8Array(tinos)), buffer: tinos })).toBeUndefined();
  });
});

describe('絵文字の表示の切り替え (UTS #51・CSS Fonts 4 §5.3・§9.3)', () => {
  it('U+FE0F は絵文字の表示、U+FE0E は文字の表示の指定。指定が無ければ、既定で絵文字の表示になる字 (Emoji_Presentation) だけ絵文字の表示', () => {
    expect(presentationOf('\u2764\uFE0F')).toEqual({ want: 'emoji', explicit: true });
    expect(presentationOf('\u2764\uFE0E')).toEqual({ want: 'text', explicit: true });
    expect(presentationOf('😀')).toEqual({ want: 'emoji', explicit: false });
    expect(presentationOf('🇯🇵')).toEqual({ want: 'emoji', explicit: false });
    // U+2764 (\u2764)・数字は、既定では文字の表示
    expect(presentationOf('\u2764')).toBeUndefined();
    expect(presentationOf('1')).toBeUndefined();
    expect(presentationOf('あ')).toBeUndefined();
  });
  it('並び (字 + U+FE0F) は色つきの書体、(字 + U+FE0E) は色つきでない書体で組む。指定の無い字は、font-family の書体のまま', async () => {
    const color = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0]] }]), CPAL: PALETTE });
    const { fonts, layout, glyphs } = await setup({ Plain: tinos, Color: color });
    const families = (family: string, text: string) => glyphs(layout([{ fontFamily: family, children: [text] }])).map((g) => `${g.text.replace('\uFE0F', '+VS16').replace('\uFE0E', '+VS15')}:${g.fontFamily}`);
    expect(families('Plain', 'A\uFE0FA\uFE0EA')).toEqual(['A+VS16:Color', 'A+VS15:Plain', 'A:Plain']);
    // 文字の表示の並びは、色つきでない書体のうち、その字を持つ最初のもの (ここでは、先に読み込んだ和文の書体)
    expect(families('Color', 'A\uFE0FA\uFE0EA')).toEqual(['A+VS16:Color', `A+VS15:${FAMILY}`, 'A:Color']);
    // 色つきの書体を読み込んでいなければ、これまでどおり (基底の字の書体)
    const none = await setup({ Plain: tinos });
    expect(none.glyphs(none.layout([{ fontFamily: 'Plain', children: ['A\uFE0FA\uFE0EA'] }])).map((g) => g.fontFamily)).toEqual(['Plain', 'Plain', 'Plain']);
    // 後備の書体の並べ直し: 色つきの書体が候補に無ければ、元の配列のまま
    const plainOnly = [fonts.get('Plain', 400)];
    expect(orderByPresentation(plainOnly, '😀')).toBe(plainOnly);
    const both = [fonts.get('Plain', 400), fonts.get('Color', 400)];
    expect(orderByPresentation(both, '😀').map((f) => f.family)).toEqual(['Color', 'Plain']);
    expect(orderByPresentation(both, 'A\uFE0E').map((f) => f.family)).toEqual(['Plain', 'Color']);
    expect(orderByPresentation(both, 'A')).toBe(both);
  });
});
