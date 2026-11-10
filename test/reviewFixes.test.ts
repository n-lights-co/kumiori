/**
 * コードレビュー (2026-11-06) で見つけた欠陥の回帰テスト:
 *  - 改行しない空白 (U+00A0) で改行しない・消さない
 *  - XSL-FO の font-weight / text-align の inherit・bolder・lighter
 *  - 脚注の区切り線 dots の太さ 0 で止まらなくならない
 *  - WebP (VP8L・VP8) の画素数の上限
 *  - PostScript の arc の巨大な角度・空の codespacerange の CMap
 *  - FontManager.get の記憶が、書体の登録で消える
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { FAMILY, fontBuffer, makeEngine } from './helpers';
import { breakLines, flattenInline, markLineBreaks } from '../src/inlineLayout';
import { resolveStyle, newNode, type ResolvedStyle } from '../src/lnode';
import { importXslFo } from '../src/xslfoImport';
import { FootnoteCtx } from '../src/footnotes';
import { decodeWebp } from '../src/webp';
import { Interp, latin1 } from '../src/psInterp';
import { Graphics } from '../src/psGraphics';
import { runEps } from '../src/eps';
import { FontManager } from '../src/fontManager';
import type { LBlock, LInline } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const base = (over: Partial<ResolvedStyle> = {}): ResolvedStyle => ({
  fontFamily: FAMILY,
  fontWeight: 400,
  italic: false,
  fontSize: 10,
  lineHeight: 1.7,
  color: '#000',
  textAlign: 'justify',
  textIndent: 0,
  letterSpacing: 0,
  rubyScale: 0.5,
  hanging: true,
  orphans: 2,
  widows: 2,
  wm: 'horizontal-tb',
  ...over,
});

describe('改行しない空白 (U+00A0)', () => {
  it('溢れる位置に来ても、その前後で改行せず、行末でも捨てない (UAX #14 の GL)', () => {
    const st = resolveStyle(base(), {});
    // breakLines は atom の配列を書き換えるので、呼ぶたびに作る
    const make = () => {
      const atoms = flattenInline(['abcdef abc\u00A0def ghi'], st, E.measurer);
      markLineBreaks(atoms);
      return atoms;
    };
    const atoms = make();
    const w = (a: number, b: number) => atoms.slice(a, b).reduce((s, x) => s + x.advance, 0);
    const texts = (L: number) => breakLines(make(), L, 0, true).map((l) => l.items.map((a) => a.first).join(''));
    // 「abcdef abc」は入るが、改行しない空白は入らない幅: 改行しない空白の前で分けずに、前の空白まで戻る (これまでは ['abcdef abc', 'def', …] になり、U+00A0 が消えた)
    const t1 = texts(w(0, 10) + w(10, 11) / 2);
    expect(t1[0]).toBe('abcdef');
    expect(t1[1]).toMatch(/^abc\u00A0def/);
    // ふつうの空白は、これまでどおり改行の位置になり、行末では捨てる
    expect(texts(w(0, 14) + w(14, 15) / 2)).toEqual(['abcdef abc\u00A0def', 'ghi']);
  });
});

describe('XSL-FO の inherit・相対の太さ', () => {
  const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
  const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>`;
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  const flow = (body: string) => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
    return importXslFo(xml, parse, { compat: 'spec' }).document.sequences[0].flow.children;
  };
  const inlineOf = (b: LBlock) => b.children.find((c) => typeof c !== 'string' && c.type === 'inline') as LInline;

  it('font-weight="inherit" は親の太さのまま (400 にしない)', () => {
    const b = flow('<fo:block font-weight="bold"><fo:inline font-weight="inherit">x</fo:inline></fo:block>')[0] as LBlock;
    expect(b.fontWeight).toBe(700);
    expect(inlineOf(b).fontWeight).toBeUndefined();
  });
  it('bolder・lighter は継承した太さから決める (CSS Fonts 4 §2.2.1)', () => {
    const [b1, b2, b3] = flow(
      '<fo:block font-weight="normal"><fo:inline font-weight="bolder">x</fo:inline></fo:block>' +
        '<fo:block font-weight="bold"><fo:inline font-weight="bolder">x</fo:inline></fo:block>' +
        '<fo:block font-weight="bold"><fo:inline font-weight="lighter">x</fo:inline></fo:block>',
    ) as LBlock[];
    expect(inlineOf(b1).fontWeight).toBe(700);
    expect(inlineOf(b2).fontWeight).toBe(900);
    expect(inlineOf(b3).fontWeight).toBe(400);
  });
  it('text-align="inherit" は親の揃えのまま (start にしない)', () => {
    const b = flow('<fo:block text-align="center"><fo:block text-align="inherit">x</fo:block></fo:block>')[0] as LBlock;
    expect(b.textAlign).toBe('center');
    expect((b.children[0] as LBlock).textAlign).toBeUndefined();
  });
});

describe('脚注の区切り線', () => {
  it('pattern=dots で太さ 0 なら、点を置かずに終わる (ピッチ 0 で止まらなくならない)', () => {
    const ctx = new FootnoteCtx({ separator: { pattern: 'dots', thickness: 0 } }, () => ({ node: newNode('block', 'horizontal-tb'), height: 0 }));
    const n = ctx.makeSeparator('horizontal-tb', 200);
    expect(n?.children.length ?? 0).toBe(0);
  });
});

describe('WebP の画素数の上限', () => {
  /** ビットを下位から詰める */
  class BitWriter {
    bytes: number[] = [];
    pos = 0;
    put(v: number, n: number) {
      for (let i = 0; i < n; i++, this.pos++) {
        const k = this.pos >> 3;
        if (this.bytes.length <= k) this.bytes.push(0);
        this.bytes[k] |= ((v >>> i) & 1) << (this.pos & 7);
      }
    }
  }
  const riff = (fourcc: string, payload: Uint8Array) => {
    const chunk = new Uint8Array(8 + payload.length);
    chunk.set(Array.from(fourcc, (c) => c.charCodeAt(0)), 0);
    new DataView(chunk.buffer).setUint32(4, payload.length, true);
    chunk.set(payload, 8);
    const file = new Uint8Array(12 + chunk.length);
    file.set([0x52, 0x49, 0x46, 0x46], 0);
    new DataView(file.buffer).setUint32(4, 4 + chunk.length, true);
    file.set([0x57, 0x45, 0x42, 0x50], 8);
    file.set(chunk, 12);
    return file;
  };
  it('VP8L: 16384×16384 を宣言した 28 バイトのファイルは読まない (数 GB の配列を作らない)', () => {
    const bw = new BitWriter();
    bw.put(0x2f, 8);
    bw.put(16383, 14);
    bw.put(16383, 14);
    bw.put(0, 1); // alpha
    bw.put(0, 3); // version
    bw.put(0, 1); // transform なし
    bw.put(0, 1); // color cache なし
    bw.put(0, 1); // meta なし
    for (let k = 0; k < 5; k++) {
      bw.put(1, 1); // simple code
      bw.put(0, 1); // 1 symbol
      bw.put(0, 1); // 1-bit symbol
      bw.put(0, 1); // symbol 0
    }
    expect(decodeWebp(riff('VP8L', Uint8Array.from(bw.bytes)))).toBeUndefined();
  });
  it('VP8: 16383×16383 を宣言した頭だけのファイルは読まない', () => {
    // キーフレームの頭 (tag 3 バイト・開始コード 9d 01 2a・幅・高さ) と、空のパーティション
    const head = Uint8Array.from([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0xff, 0x3f, 0xff, 0x3f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeWebp(riff('VP8 ', head))).toBeUndefined();
  });
});

describe('PostScript の停止性', () => {
  it('arc・arcn の巨大な角度は 1 周に畳む (while が止まらなくならない・分割の数が爆発しない)', () => {
    // 時間でなく、できたパスの点の数で確かめる: 1 周に畳めば、円弧 1 つは始めの点 1 つと、90 度以下のベジェ 4 つまで。
    // 畳まなければ、分割の数が角度 ÷ 90 (1e300 なら 1e298) になる。止まらない場合は、vitest の時限で落ちる
    const points = (src: string) => {
      const I = new Interp();
      const G = new Graphics(I, { bbox: [0, 0, 100, 100] });
      expect(I.run(latin1(src)), src).toBeUndefined();
      return G.g.path.length;
    };
    for (const src of ['newpath 0 0 10 0 1e300 arc', 'newpath 0 0 10 1e300 0 arc', 'newpath 0 0 10 0 -1e300 arcn']) {
      expect(points(src), src).toBeGreaterThanOrEqual(2);
      expect(points(src), src).toBeLessThanOrEqual(5);
    }
    // 0→720 度は 1 周 (始めの点 + ベジェ 4 つ)。続く arcn の 90→0 度は、つなぐ線 1 つ + ベジェ 1 つ
    expect(points('newpath 0 0 10 0 720 arc 50 50 10 90 0 arcn')).toBe(7);
  }, 60_000);
  it('空の codespacerange の CMap で show しても進む (1 バイトずつ読む)', () => {
    const body = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Bad def
/WMode 0 def
1 begincodespacerange <> <> endcodespacerange
endcmap
CMapName currentdict /CMap defineresource pop
end end
/CF 12 dict def
CF begin
/CIDFontName /CF def
/CIDFontType 0 def
/FontMatrix [0.001 0 0 0.001 0 0] def
/FDBytes 1 def
/GDBytes 1 def
/CIDCount 0 def
/CIDMapOffset 0 def
/FDArray [] def
/GlyphData <> def
end
/CF CF /CIDFont defineresource pop
/F /Bad [ /CF ] composefont pop
/F findfont 10 scalefont setfont
10 10 moveto (abc) show`;
    // 進まなければ、時間 (maxMillis) か手数の上限で打ち切られて、error が limit:time・limit:steps になる。
    // かかった時間そのものは比べない (混んだ機械で落ちる)。上限に当たらずに終わったことを、結果で確かめる
    const r = runEps(latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n`), { maxMillis: 60_000 })!;
    expect(r).toBeDefined();
    expect(r.error ?? '').not.toMatch(/^limit:/);
  }, 100_000);
});

describe('FontManager.get の記憶', () => {
  it('同じ書体名・太さは同じ結果を返し、書体を登録すると消える', async () => {
    const fonts = new FontManager();
    const buf = await fontBuffer();
    await fonts.registerBuffer(FAMILY, 400, buf, false);
    expect(fonts.get(FAMILY, 700).weight).toBe(400); // 太字が無ければ近い太さ
    expect(fonts.get('無い書体', 400).family).toBe(FAMILY); // 後備
    expect(fonts.get(FAMILY, 700)).toBe(fonts.get(FAMILY, 700));
    await fonts.registerBuffer(FAMILY, 700, buf, false);
    expect(fonts.get(FAMILY, 700).weight).toBe(700);
    await fonts.registerBuffer('無い書体', 400, buf, false);
    expect(fonts.get('無い書体', 400).family).toBe('無い書体');
  });
});
