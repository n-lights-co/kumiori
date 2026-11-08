/**
 * コードレビュー (描画と出力・画像・図形の読み込み) で見つけた欠陥の回帰テスト:
 *  - PostScript の解釈器から JS の例外 (RangeError・TypeError) が漏れない (H-4)、gsave でパスを写さない (L-10)
 *  - 背景画像の繰り返しを PDF のタイリングパターン 1 つにする・画像の資源名を使い回す (H-5・L-3)、0 幅のタイル (M-6)
 *  - SVG の pattern の中の特色 (M-3)、Canvas の SVG の preserveAspectRatio (M-4)、ToUnicode の 2 字形目以降 (M-5)
 *  - 壊れた BMP の BITFIELDS (M-7)、メタファイルの領域の演算の計算量 (M-8)
 *  - グラデーションの Bounds の順 (L-1)、CFF の壊れた INDEX (L-4)・seac の部品 (L-5)、MathML の長い字列と深い入れ子 (L-8)、
 *    CGM の分割された引数と METAFILE DEFAULTS REPLACEMENT (L-9)、疑似太字の継ぎ目 (L-11)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { Interp, latin1 } from '../src/psInterp';
import { Graphics } from '../src/psGraphics';
import { runType1Charstring } from '../src/psFonts';
import { AssetStore } from '../src/assets';
import { LayoutEngine } from '../src/layoutEngine';
import { renderPdf } from '../src/pdfRenderer';
import { renderSheetToCanvas } from '../src/canvasRenderer';
import { paintArea, type Painter } from '../src/paint';
import { decodeBmp, encodePng } from '../src/pixels';
import { emfToSvg } from '../src/metafile';
import { cffCharStrings, subsetCff } from '../src/cff';
import { CFF_STANDARD_STRINGS } from '../src/psEncodings';
import { layoutMathML, type MNode } from '../src/mathLayout';
import { readMathFont, type FkFont, type MathFont } from '../src/mathFont';
import { imageInfo } from '../src/imageInfo';
import { FAMILY, doc, makeEngine, mathFontBuffer, walk } from './helpers';
import type { Area, GlyphArea, ImageArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});
const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string, attrs = 'width="100" height="50" viewBox="0 0 100 50"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** 読み込んだ PDF の、復号したストリームの中身 (辞書と文字列) をすべて返す */
function streamsOf(pdf: PDFDocument): Array<{ dict: PDFDict; text: string }> {
  const out: Array<{ dict: PDFDict; text: string }> = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      out.push({ dict: obj.dict, text: new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()) });
    } catch {
      /* 画像など復号しないもの */
    }
  }
  return out;
}
/** ページの内容ストリーム (命令を含むもの) */
const contentOf = (pdf: PDFDocument) =>
  streamsOf(pdf)
    .filter((s) => !s.dict.has(PDFName.of('Type')) && !s.dict.has(PDFName.of('PatternType')) && /\b(re|Tj|TJ|cm)\b/.test(s.text))
    .map((s) => s.text)
    .join('\n');

/** 4×4 の市松 (赤・青) の PNG */
async function tilePng() {
  const w = 4;
  const h = 4;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const c = ((x >> 1) + (y >> 1)) & 1;
      rgba.set([c ? 255 : 0, 0, c ? 0 : 255, 255], o);
    }
  return encodePng({ width: w, height: h, rgba });
}

describe('PostScript: JS の例外を PostScript のエラーに写す (EPS 全体を読めない画像にしない)', () => {
  const run = (src: string, maxMillis = 5000) => {
    const I = new Interp({ maxMillis });
    new Graphics(I, { bbox: [0, 0, 100, 100] });
    return { error: I.run(latin1(src)), I };
  };
  it('自分を指す実行できる名前の連鎖は execstackoverflow (JS の呼び出しの深さを使い切らない)', () => {
    expect(run('/a /a cvx def a').error).toMatch(/^execstackoverflow/);
    // 2 万段の名前の連鎖
    let src = '';
    for (let i = 0; i < 20000; i++) src += `/n${i} /n${i + 1} cvx def `;
    src += '/n20000 1 def n0';
    expect(run(src).error).toMatch(/^execstackoverflow/);
  });
  it('逆行列を持たない CTM での rmoveto は undefinedresult (TypeError にならない)', () => {
    expect(run('0 0 scale 0 0 moveto 1 1 rmoveto').error).toMatch(/^undefinedresult/);
  });
  it('30 万点のパスの pathbbox は結果を返す (Math.min の spread の引数の上限を超えない)', () => {
    const r = run('0 0 moveto 0 1 299999 { dup lineto } for pathbbox');
    expect(r.error).toBeUndefined();
    expect(r.I.ostack.map((o) => (o.t === 'real' || o.t === 'int' ? o.v : NaN))).toEqual([0, 0, 299999, 299999]);
  });
  it('プログラムで作った深い入れ子の手続きを bind しても RangeError にならない', () => {
    expect(run('{} 100000 { [ exch ] cvx } repeat bind pop').error).toBeUndefined();
  });
  it('10 万個のスタックを roll しても RangeError にならない', () => {
    const r = run('1 1 99990 { } for 99990 1 roll count');
    expect(r.error).toBeUndefined();
    const top = r.I.ostack[r.I.ostack.length - 1];
    expect(top.t === 'int' ? top.v : NaN).toBe(99990);
    // 先頭に 99990 (最後に積んだ値) が回ってくる
    const first = r.I.ostack[0];
    expect(first.t === 'int' ? first.v : NaN).toBe(99990);
  });
  it('エラーのあとも次のプログラムは動く (途中まで描いたものは捨てない)', () => {
    const I = new Interp();
    const G = new Graphics(I, { bbox: [0, 0, 100, 100] });
    expect(I.run(latin1('0 0 moveto 10 10 lineto stroke /a /a cvx def a'))).toMatch(/^execstackoverflow/);
    expect(G.items.length).toBe(1);
    expect(I.run(latin1('20 20 moveto 30 30 lineto stroke'))).toBeUndefined();
    expect(G.items.length).toBe(2);
  });
  it('Type 1 の seac が自分を参照する字形でも止まる', () => {
    // 0 500 hsbw  0 0 0 65 65 seac (部品の字が自分と同じ命令)
    const cs = Uint8Array.from([139, 248, 136, 13, 139, 139, 139, 204, 204, 12, 6]);
    const g = runType1Charstring(cs, { subr: () => undefined, standardGlyph: () => cs });
    expect(g?.wx).toBe(500);
  });
  it('gsave は現在のパスを写さずに共有し、書き換えは共有している側に及ばない (L-10)', () => {
    const r = run('0 0 moveto gsave 10 10 lineto gsave 20 20 lineto grestore pathbbox grestore pathbbox');
    expect(r.error).toBeUndefined();
    expect(r.I.ostack.map((o) => (o.t === 'real' || o.t === 'int' ? o.v : NaN))).toEqual([0, 0, 10, 10, 0, 0, 0, 0]);
    // 長いパスを作りながら gsave を繰り返しても、パスの長さ × gsave の回数の写しにならない
    const t0 = Date.now();
    expect(run('0 0 moveto 1 1 30000 { dup lineto gsave grestore } for pathbbox').error).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('PDF の画像: 背景の繰り返しはタイリングパターン、資源名は画像ごとに 1 つ (H-5・L-3・M-6)', () => {
  const render = async (children: unknown[], png: Uint8Array) => {
    const assets = new AssetStore();
    assets.register('tile.png', { mime: 'image/png', bytes: png, width: 4, height: 4 });
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc(children as never));
    return PDFDocument.load(await renderPdf(tree, E.fonts, { assets }));
  };
  it('A4 の箱に 3pt のタイルを敷いても、命令はパターン 1 つ分 (タイルの数だけ Do と資源名を出さない)', async () => {
    const pdf = await render([{ type: 'block', width: 500, height: 700, boxSizing: 'border-box', backgroundImage: { src: 'tile.png' }, children: ['あ'] }], await tilePng());
    const page = pdf.getPage(0);
    const res = page.node.Resources()!;
    const patterns = res.lookup(PDFName.of('Pattern'), PDFDict);
    expect(patterns.keys().length).toBe(1);
    // パターンの辞書: タイル 1 枚の大きさ (4px = 3pt) の XStep・YStep、資源に画像
    const pat = patterns.lookup(patterns.keys()[0], PDFStream).dict;
    expect(pat.lookup(PDFName.of('PatternType'), PDFNumber).asNumber()).toBe(1);
    expect(pat.lookup(PDFName.of('XStep'), PDFNumber).asNumber()).toBe(3);
    expect(pat.lookup(PDFName.of('YStep'), PDFNumber).asNumber()).toBe(3);
    expect(pat.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).keys().length).toBe(1);
    // ページの内容には Do が無く (画像はパターンの中)、パターンで塗る矩形が 1 つ
    const content = contentOf(pdf);
    expect(content.match(/\bDo\b/g) ?? []).toHaveLength(0);
    expect(content).toMatch(/\/Pattern cs\n\/KmP0 scn\n[\d. ]+ re\nf/);
    expect(content.length).toBeLessThan(3000);
  });
  it('repeat-x・repeat-y は 1 行・1 列の範囲をパターンで塗り、no-repeat は 1 枚だけ描く', async () => {
    const pdf = await render(
      [
        { type: 'block', width: 120, height: 40, boxSizing: 'border-box', backgroundImage: { src: 'tile.png', repeat: 'repeat-x', y: 10 }, children: ['い'] },
        { type: 'block', width: 120, height: 40, boxSizing: 'border-box', backgroundImage: { src: 'tile.png', repeat: 'repeat-y', x: 'center' }, children: ['う'] },
        { type: 'block', width: 120, height: 40, boxSizing: 'border-box', backgroundImage: { src: 'tile.png', repeat: 'no-repeat', x: 7, y: 5 }, children: ['え'] },
      ],
      await tilePng(),
    );
    const content = contentOf(pdf);
    const fills = [...content.matchAll(/\/KmP\d+ scn\n([\d. ]+) re\nf/g)].map((m) => m[1].split(' ').map(Number));
    expect(fills).toHaveLength(2);
    expect([fills[0][2], fills[0][3]]).toEqual([120, 3]); // repeat-x: 幅いっぱい × タイル 1 枚の高さ
    expect([fills[1][2], fills[1][3]]).toEqual([3, 40]); // repeat-y
    expect(content.match(/\bDo\b/g) ?? []).toHaveLength(1); // no-repeat の 1 枚
  });
  it('同じ画像を何度置いても、ページの XObject の資源名は 1 つ', async () => {
    const pdf = await render(
      [
        {
          type: 'block',
          children: [
            { type: 'image', src: 'tile.png', width: 30, height: 30 },
            { type: 'image', src: 'tile.png', width: 20, height: 20 },
            { type: 'image', src: 'tile.png', width: 10, height: 10 },
          ],
        },
      ],
      await tilePng(),
    );
    const xo = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(xo.keys().length).toBe(1);
    const content = contentOf(pdf);
    expect(content.match(/\bDo\b/g)).toHaveLength(3);
    // q w 0 0 h x y cm /名前 Do Q
    expect(content).toMatch(/q\n30 0 0 30 [\d.]+ [\d.]+ cm\n\/KmI\S* Do\nQ/);
  });
  it('大きさの無い (0・Infinity) タイルは描かない (0 除算のループにしない)', () => {
    const calls: string[] = [];
    const p: Painter = {
      fillRect() {},
      drawGlyph() {},
      drawImage: () => void calls.push('image'),
      drawImageTiled: () => (calls.push('tiled'), true),
      transform: (_m, d) => d(),
      strokeLine() {},
      clipRect() {},
      restore() {},
      fillPath() {},
      clipPath() {},
      strokePath() {},
    };
    const box = (bg: Record<string, unknown>) =>
      ({ type: 'block', x: 0, y: 0, width: 100, height: 50, margin: { top: 0, right: 0, bottom: 0, left: 0 }, padding: { top: 0, right: 0, bottom: 0, left: 0 }, border: {}, children: [], backgroundImage: { src: 't.png', ...bg } }) as unknown as Area;
    paintArea(box({ width: 0, height: 10 }), 0, 0, p);
    paintArea(box({ width: 10, height: Infinity }), 0, 0, p);
    paintArea(box({ width: NaN, height: NaN }), 0, 0, p);
    expect(calls).toEqual([]);
    // ふつうの繰り返しは drawImageTiled 1 回、no-repeat は drawImage 1 回
    paintArea(box({ width: 10, height: 10 }), 0, 0, p);
    paintArea(box({ width: 10, height: 10, repeat: 'no-repeat' }), 0, 0, p);
    expect(calls).toEqual(['tiled', 'image']);
    // drawImageTiled が扱えなければ (false)、1 枚ずつ描く
    p.drawImageTiled = () => false;
    paintArea(box({ width: 50, height: 25 }), 0, 0, p);
    expect(calls.filter((c) => c === 'image')).toHaveLength(1 + 4);
  });
});

describe('PDF の SVG: pattern の中の特色・ToUnicode・グラデーションの Bounds (M-3・M-5・L-1)', () => {
  const renderSvg = async (src: string, w = 100, h = 50) => {
    const assets = new AssetStore();
    assets.register('a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: w, height: h });
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'a.svg', width: w, height: h }] }]));
    return PDFDocument.load(await renderPdf(tree, E.fonts, { assets, parseXml: parse }));
  };
  it('pattern の中の spot(...) の色空間は、パターンの資源 (ColorSpace) でも解ける', async () => {
    const pdf = await renderSvg(svg('<defs><pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5" fill="spot(1,0,1,1,0,Foo)"/></pattern></defs><rect width="100" height="50" fill="url(#p)"/>'));
    const pat = streamsOf(pdf).find((s) => s.dict.has(PDFName.of('PatternType')))!;
    expect(pat).toBeDefined();
    expect(pat.text).toMatch(/\/KmSp0 cs\n1 scn/);
    const cs = pat.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ColorSpace'), PDFDict);
    expect(cs.has(PDFName.of('KmSp0'))).toBe(true);
    // ページの資源にも同じ名前がある
    expect(pdf.getPage(0).node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict).has(PDFName.of('KmSp0'))).toBe(true);
  });
  it('同じ offset の止まり点 (色の段差) があっても、Bounds は増加の順', async () => {
    const pdf = await renderSvg(
      svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="0.5" stop-color="#0f0"/><stop offset="0.5" stop-color="#00f"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="100" height="50" fill="url(#g)"/>'),
    );
    let bounds: number[] | undefined;
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || !obj.has(PDFName.of('Shading'))) continue;
      const fn = obj.lookup(PDFName.of('Shading'), PDFDict).lookup(PDFName.of('Function'), PDFDict);
      bounds = fn.lookup(PDFName.of('Bounds'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
    }
    expect(bounds).toBeDefined();
    expect(bounds!.length).toBe(2);
    expect(bounds![0]).toBe(0.5);
    expect(bounds![1]).toBeGreaterThan(0.5);
    expect(bounds![1]).toBeLessThan(0.501);
  });
  it('1 つの領域に 2 つ以上の字形があるとき、2 字形目以降も ToUnicode に字が付く', async () => {
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY });
    const tree = engine.layout(doc([{ type: 'block', children: ['x'] }]));
    // 「x」の領域を、字形 2 つ (x・y) の領域に作り替える (GPOS で 1 つの領域に複数の字形が入る形)
    const f = E.fonts.get(FAMILY, 400);
    const run = f.fk.layout('xy');
    const ids = run.glyphs.map((g) => g.id);
    const advs = run.positions.map((p) => p.xAdvance);
    let found = false;
    const visit = (a: Area) => {
      if (a.type === 'glyph' && a.text === 'x' && !found) {
        found = true;
        const g = a as GlyphArea;
        g.text = 'xy';
        g.glyphIds = ids;
        g.glyphPositions = [
          [advs[0], 0, 0],
          [advs[1], 0, 0],
        ];
      }
    };
    walk(tree.sheets[0] as unknown as Area, visit);
    expect(found).toBe(true);
    const pdf = await PDFDocument.load(await renderPdf(tree, E.fonts));
    const cmap = streamsOf(pdf).find((s) => /beginbfchar/.test(s.text))!.text;
    // 部分書体で字形の番号は付け直されるので、対応の値 (字) で見る: x と y の両方があり、空の対応 (<gid> <>) は無い
    const values = [...cmap.matchAll(/<([0-9a-f]+)> <([0-9a-f]*)>/gi)].map((m) => m[2].toLowerCase());
    expect(values).toContain('0078'); // x
    expect(values).toContain('0079'); // y
    expect(values.filter((v) => v === '')).toHaveLength(0);
  });
  it('疑似太字の輪郭の継ぎ目は丸 (Canvas の strokeText と同じ)', async () => {
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY });
    const tree = engine.layout(doc([{ type: 'block', fontWeight: 700, children: ['太'] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, E.fonts));
    expect(contentOf(pdf)).toMatch(/2 Tr\n[\d.]+ w\n1 j\n/);
  });
});

describe('Canvas の SVG の preserveAspectRatio (M-4)', () => {
  const draw = (svgSrc: string, w: number, h: number) => {
    const assets = new AssetStore();
    const el = { tag: 'img' };
    assets.register('a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svgSrc), width: 100, height: 50, element: el as never });
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    // object-fit: fill で枠を w×h にする (既定は組版の側で縦横比を保つので、枠と SVG の比は同じ。scaling: non-uniform は SVG も引き伸ばす)
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'a.svg', width: w, height: h, fit: 'fill' }] }] as never));
    const calls: number[][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === 'drawImage' ? (...args: unknown[]) => void calls.push(args.slice(1) as number[]) : typeof k === 'string' ? () => {} : undefined),
      set: () => true,
    });
    const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
    renderSheetToCanvas(tree.sheets[0], canvas, E.fonts, { assets });
    let area: ImageArea | undefined;
    walk(tree.sheets[0] as unknown as Area, (a) => {
      if (a.type === 'image') area = a as ImageArea;
    });
    return { calls, area };
  };
  it('既定 (xMidYMid meet) は縦横比を保って中央に置き、none は引き伸ばす、slice は覆う', () => {
    const r = draw(svg('<rect width="100" height="50"/>'), 100, 100);
    expect(r.area?.width).toBe(100);
    expect(r.area?.height).toBe(100);
    expect(r.calls).toHaveLength(1);
    const [x, y, w, h] = r.calls[0];
    expect([w, h]).toEqual([100, 50]);
    const none = draw(svg('<rect width="100" height="50"/>', 'width="100" height="50" viewBox="0 0 100 50" preserveAspectRatio="none"'), 100, 100);
    expect(none.calls[0].slice(2)).toEqual([100, 100]);
    // meet は枠 (none で描く位置) の中央: 上下に 25 ずつ余白
    expect(x).toBeCloseTo(none.calls[0][0], 5);
    expect(y - none.calls[0][1]).toBeCloseTo(25, 5);
    const slice = draw(svg('<rect width="100" height="50"/>', 'width="100" height="50" viewBox="0 0 100 50" preserveAspectRatio="xMinYMin slice"'), 100, 100);
    expect(slice.calls[0].slice(2)).toEqual([200, 100]);
  });
});

describe('壊れた画像・メタファイル (M-7・M-8)', () => {
  it('decodeBmp: BITFIELDS のマスクが入らない短い BMP は undefined (RangeError を投げない)', () => {
    const b = new Uint8Array(60);
    const v = new DataView(b.buffer);
    b[0] = 0x42;
    b[1] = 0x4d;
    v.setUint32(10, 70, true); // 画素の位置
    v.setUint32(14, 40, true); // BITMAPINFOHEADER
    v.setInt32(18, 1, true);
    v.setInt32(22, 1, true);
    v.setUint16(26, 1, true);
    v.setUint16(28, 32, true);
    v.setUint32(30, 3, true); // BI_BITFIELDS
    expect(decodeBmp(b)).toBeUndefined();
    // 頭が 40 バイトに足りないもの
    const s = new Uint8Array(30);
    s[0] = 0x42;
    s[1] = 0x4d;
    new DataView(s.buffer).setUint32(14, 40, true);
    expect(decodeBmp(s)).toBeUndefined();
  });

  /** EMF の見出し (88 バイト) と記録を並べる (metafileGradient.test.ts と同じ) */
  function emf(records: Uint8Array[]): Uint8Array {
    const body = records.reduce((a, r) => a + r.length, 0);
    const eof = rec(14, [0, 16, 20]);
    const h = new DataView(new ArrayBuffer(88));
    h.setUint32(0, 1, true);
    h.setUint32(4, 88, true);
    [0, 0, 99, 99].forEach((n, k) => h.setInt32(8 + k * 4, n, true));
    [0, 0, 2499, 2499].forEach((n, k) => h.setInt32(24 + k * 4, n, true));
    h.setUint32(40, 0x464d4520, true);
    h.setUint32(44, 0x10000, true);
    h.setUint32(48, 88 + body + eof.length, true);
    h.setUint32(52, records.length + 2, true);
    h.setUint16(56, 1, true);
    [1000, 1000, 250, 250].forEach((n, k) => h.setInt32(72 + k * 4, n, true));
    const out = new Uint8Array(88 + body + eof.length);
    out.set(new Uint8Array(h.buffer), 0);
    let at = 88;
    for (const r of [...records, eof]) {
      out.set(r, at);
      at += r.length;
    }
    return out;
  }
  function rec(type: number, words: number[]): Uint8Array {
    const v = new DataView(new ArrayBuffer(8 + words.length * 4));
    v.setUint32(0, type, true);
    v.setUint32(4, 8 + words.length * 4, true);
    words.forEach((n, k) => v.setUint32(8 + k * 4, n >>> 0, true));
    return new Uint8Array(v.buffer);
  }
  /** EXTSELECTCLIPRGN: RegionMode と RGNDATA (矩形の並び) */
  const region = (mode: number, rects: number[][]) => rec(75, [32 + rects.length * 16, mode, 32, 1, rects.length, rects.length * 16, 0, 0, 100, 100, ...rects.flat()]);

  it('領域の演算: 矩形の領域と INTERSECTCLIPRECT の交わり', () => {
    const svg = emfToSvg(
      emf([
        region(5, [
          [0, 0, 50, 50],
          [50, 50, 100, 100],
        ]),
        rec(30, [25, 25, 75, 75]),
        rec(43, [0, 0, 100, 100]),
      ]),
    )!;
    expect(svg).toContain('<clipPath id="kmMfRgn1"><path d="M25 25H50V50H25ZM50 50H75V75H50Z"/></clipPath>');
  });
  it('対角に並ぶ 900 矩形の領域に INTERSECTCLIPRECT を重ねても、格子 × 矩形数のループにならない', () => {
    const rects: number[][] = [];
    for (let i = 0; i < 900; i++) rects.push([2 * i, 2 * i, 2 * i + 1, 2 * i + 1]);
    const recs = [region(5, rects)];
    for (let k = 0; k < 3; k++) recs.push(rec(30, [k, k, 2000 - k, 2000 - k]));
    recs.push(rec(43, [0, 0, 100, 100]));
    const t0 = Date.now();
    const svg = emfToSvg(emf(recs))!;
    expect(Date.now() - t0).toBeLessThan(2000);
    // 最初の 2 つ (0,0)-(1,1)・(2,2)-(3,3) は (2,2)-(1998,1998) との交わりで、(2,2)-(3,3) から
    expect(svg).toContain('<path d="M2 2H3V3H2ZM4 4H5V5H4Z');
  });
});

describe('CFF の部分書体 (L-4・L-5)', () => {
  const index = (items: number[][]) => {
    if (!items.length) return [0, 0];
    const offs = [1];
    for (const it of items) offs.push(offs[offs.length - 1] + it.length);
    return [items.length >> 8, items.length & 0xff, 1, ...offs, ...items.flat()];
  };
  const int32 = (x: number) => [29, (x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff];
  const small = (x: number) => [x + 139];
  const sid = (name: string) => CFF_STANDARD_STRINGS.indexOf(name);
  /** 非 CID の小さな CFF: .notdef・A・grave・Agrave (seac で A と grave を合成)・B */
  function makeSeacCff() {
    const header = [1, 0, 4, 1];
    const name = index([[...'T'].map((c) => c.charCodeAt(0))]);
    const strings = index([]);
    const gsubrs = index([]);
    const simple = [...small(0), ...small(0), 21, 14]; // rmoveto endchar
    // Agrave: adx ady bchar achar endchar (StandardEncoding の A = 65、grave = 193)
    const agrave = [...small(0), ...small(0), ...small(65), 247, 193 - 108, 14];
    const charStrings = index([simple, simple, simple, agrave, simple]);
    const charset = [0, ...[sid('A'), sid('grave'), sid('Agrave'), sid('B')].flatMap((s) => [s >> 8, s & 0xff])];
    const priv = [248, 136, 20]; // defaultWidthX 500
    const top = (o: Record<string, number>) => [...int32(o.charset), 15, ...int32(o.charStrings), 17, ...int32(priv.length), ...int32(o.priv), 18];
    const topLen = index([top({ charset: 0, charStrings: 0, priv: 0 })]).length;
    let at = header.length + name.length + topLen + strings.length + gsubrs.length;
    const o: Record<string, number> = {};
    o.charset = at;
    at += charset.length;
    o.charStrings = at;
    at += charStrings.length;
    o.priv = at;
    return new Uint8Array([...header, ...name, ...index([top(o)]), ...strings, ...gsubrs, ...charset, ...charStrings, ...priv]);
  }
  it('seac (endchar の 4 引数) の部品の字 (A・grave) を、使う字 (Agrave) と一緒に残す', () => {
    const src = makeSeacCff();
    const before = cffCharStrings(src);
    expect(before).toHaveLength(5);
    const out = cffCharStrings(subsetCff(src, new Set([3])));
    expect(Array.from(out[3])).toEqual(Array.from(before[3]));
    expect(Array.from(out[1])).toEqual(Array.from(before[1])); // A
    expect(Array.from(out[2])).toEqual(Array.from(before[2])); // grave
    expect(Array.from(out[4])).toEqual([14]); // B は空
  });
  it('位置の表が入りきらない壊れた INDEX は、通さずにエラーにする', () => {
    // 見出し + 名前の INDEX + 途中で切れた Top DICT の INDEX (count 1、offSize 4、位置が無い)
    const b = new Uint8Array([1, 0, 4, 1, ...index([[84]]), 0, 1, 4]);
    expect(() => cffCharStrings(b)).toThrow(/INDEX/);
  });
});

describe('MathML の長い字列と深い入れ子 (L-8)', () => {
  let mf: MathFont;
  beforeAll(async () => {
    mf = readMathFont(fontkit.create(new Uint8Array(await mathFontBuffer())) as unknown as FkFont)!;
  });
  const math = (body: string) => new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`, 'text/xml').documentElement as unknown as MNode;
  it('10 万字の mtext でも RangeError にならない', () => {
    const r = layoutMathML(math(`<mtext>${'a'.repeat(100000)}</mtext>`), { font: mf, size: 10, color: '#000000' });
    expect(r.width).toBeGreaterThan(0);
  });
  it('1 万段の mrow の入れ子でも止まる (深すぎる所は空)', () => {
    const r = layoutMathML(math('<mrow>'.repeat(10000) + '<mi>x</mi>' + '</mrow>'.repeat(10000)), { font: mf, size: 10, color: '#000000' });
    expect(r).toBeDefined();
  });
});

describe('CGM の大きさ (L-9)', () => {
  const cmd = (cls: number, id: number, data: number[] = []) => {
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
  };
  const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
  const str = (t: string) => [t.length, ...Array.from(t, (c) => c.charCodeAt(0))];
  it('METAFILE DEFAULTS REPLACEMENT の中の VDC EXTENT を見る', () => {
    const inner = [...cmd(2, 6, i16(0, 0, 200, 100)), ...cmd(5, 22, i16(1))];
    const b = new Uint8Array([...cmd(0, 1, str('t')), ...cmd(1, 12, inner), ...cmd(0, 3, str('p')), ...cmd(0, 4), ...cmd(0, 5), ...cmd(0, 2)]);
    expect(imageInfo(b)).toMatchObject({ mime: 'image/cgm', width: 400, height: 200 });
  });
  it('長い形の分割された引数 (続きありのビット) をつないで読む', () => {
    // MDR を 2 つに分けて書く: 1 つ目 (続きあり) に VDC EXTENT の前半、2 つ目に後半
    const inner = [...cmd(5, 22, i16(1)), ...cmd(2, 6, i16(0, 0, 300, 100))];
    const cut = 6;
    const h = (1 << 12) | (12 << 5) | 31;
    const part1 = inner.slice(0, cut);
    const part2 = inner.slice(cut);
    const long = [h >> 8, h & 0xff, 0x80 | (part1.length >> 8), part1.length & 0xff, ...part1, part2.length >> 8, part2.length & 0xff, ...part2];
    if (part2.length % 2) long.push(0);
    const b = new Uint8Array([...cmd(0, 1, str('t')), ...long, ...cmd(0, 3, str('p')), ...cmd(0, 4), ...cmd(0, 5), ...cmd(0, 2)]);
    expect(imageInfo(b)).toMatchObject({ mime: 'image/cgm', width: 400, height: (400 * 100) / 300 });
  });
});
