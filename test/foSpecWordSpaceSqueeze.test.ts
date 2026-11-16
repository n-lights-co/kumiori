/**
 * XSL-FO の仕様モード (compat: 'spec'。既定) の行の調整: 両端揃えで組まない行では、欧文の語間 (空白) を詰めない。
 *  - XSL 1.1 §7.17.8: word-spacing="normal" の語間は optimum = maximum = minimum (縮める幅が無い)
 *  - XSL 1.1 §7.16.9: 字の並びを伸ばしてよいのは text-align="justify" のとき (“In the case of 'justify', the UA may stretch the inline boxes”)
 *  - XSL 1.1 §7.16.10: 最後の行・改行 (U+000A) で終わる行の揃えは text-align-last (relative は、text-align が justify なら start)
 *  - CSS Text 3 §6.1・§6.4.1: 字の間を伸び縮みさせるのは、両端揃えのとき
 * 両端揃えで組む行でも、語間は word-spacing.minimum の指定が無ければ詰めない (FO-26: §7.17.8 の normal・<length> は .minimum = .optimum)。
 * .minimum があれば、両端揃えで組む行だけ、その幅まで詰める。.maximum があれば、両端揃えで広げる語間をその幅までにする。
 * 行中の約物 (読点・括弧) のアキの追込みは、今までどおり。互換モードは、揃えによらず語間を詰めない (foCompatLineSqueeze.test.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { importXslFo } from '../src/xslfoImport';
import { defaultFontBuffer } from './helpers';

const JA = 'Noto Serif JP';
let engine: LayoutEngine;
beforeAll(async () => {
  const fonts = new FontManager();
  await fonts.registerBuffer(JA, 400, await defaultFontBuffer('NotoSerifJP-Regular.ttf'), false);
  await fonts.registerBuffer('Tinos', 400, await defaultFontBuffer('Tinos-Regular.ttf'), false);
  fonts.setLatinFallback(JA, 'Tinos');
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: JA });
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
/** 版面の幅 widthPt の 1 ページに body を組む FO (10pt) */
const fo = (body: string, widthPt: number) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja" font-family="serif" font-size="10pt" line-height="1.6"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="${widthPt + 40}pt" page-height="400pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 行ごとの字と、行の中身の長さ */
function linesOf(sheet: unknown): Array<{ text: string; len: number }> {
  const out: Array<{ text: string; len: number }> = [];
  const visit = (n: unknown, line: { text: string; len: number } | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, line));
    const a = n as { type?: string; text?: string; contentLength?: number };
    let cur = line;
    if (a.type === 'line') {
      cur = { text: '', len: a.contentLength ?? 0 };
      out.push(cur);
    }
    if (a.type === 'glyph' && cur) cur.text += a.text ?? '';
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, cur);
  };
  visit(sheet, undefined);
  return out.map((l) => ({ text: l.text.trim(), len: l.len }));
}
const layout = (body: string, widthPt: number, compat?: 'antenna' | 'spec') => linesOf(engine.layout(importXslFo(fo(body, widthPt), parse, compat ? { compat } : {}).document).sheets[0]);
const run = (body: string, widthPt: number, compat?: 'antenna' | 'spec') => layout(body, widthPt, compat).map((l) => l.text);
const block = (text: string, attrs = '') => `<fo:block${attrs ? ` ${attrs}` : ''}>${text}</fo:block>`;

describe('XSL-FO 仕様モード: 両端揃えで組まない行は、語間を詰めない', () => {
  // 欧文だけ: 語間 5 つを空白の 1/3 ずつ詰めれば (約 4pt)、最後の語が入る幅
  const latin = 'aaaa bbbb cccc dddd eeee ffff';
  const latinCut = ['aaaa bbbb cccc dddd eeee', 'ffff'];
  let latinLen = 0;
  // 和文の行に混じった空白 1 つ: 空白 (2.5pt) を 1/3 詰めれば (約 0.8pt)、最後の 1 字が入る幅
  const mixed = 'ああ ああああああああ';
  let mixedLen = 0;
  beforeAll(() => {
    latinLen = layout(block(latin), 400)[0].len;
    mixedLen = layout(block(mixed), 400)[0].len;
  });

  it('前提: 測った長さちょうどの幅なら 1 行に入る', () => {
    expect(run(block(latin), latinLen + 0.1)).toEqual([latin]);
    expect(run(block(mixed), mixedLen + 0.1)).toEqual([mixed]);
  });

  for (const align of [undefined, 'start', 'left', 'end', 'right', 'center', 'inside', 'outside']) {
    const attrs = align ? `text-align="${align}"` : '';
    it(`text-align=${align ?? '(指定なし = start)'}: 語間を詰めれば入る語を、詰めずに次の行へ送る`, () => {
      expect(run(block(latin, attrs), latinLen - 2)).toEqual(latinCut);
      // 既定 (compat の指定なし) は仕様モード
      expect(run(block(latin, attrs), latinLen - 2, 'spec')).toEqual(latinCut);
    });
    it(`text-align=${align ?? '(指定なし = start)'}: 和文の行の空白 1 つを詰めれば入る 1 字を、詰めずに次の行へ送る`, () => {
      expect(run(block(mixed, attrs), mixedLen - 0.5)).toEqual(['ああ あああああああ', 'あ']);
    });
  }

  // 語間 5 つで 2pt 詰めれば入る: 1 つあたり 0.4pt。.minimum="-0.5pt" (1 つ 0.5pt まで) なら入り、"-0.3pt" (1.5pt) なら入らない
  const MIN = 'word-spacing.minimum="-0.5pt"';

  it('両端揃え (text-align="justify") の、両端揃えで組む行も、word-spacing.minimum が無ければ語間を詰めない (§7.17.8: normal は .minimum = .optimum)', () => {
    const lines = layout(block(`${latin} ${latin}`, 'text-align="justify"'), latinLen - 2);
    expect(lines[0].text).toBe('aaaa bbbb cccc dddd eeee');
    // 送った分は、語間を広げて埋める (§7.16.9 の justify。行の長さは版面の幅)
    expect(lines[0].len).toBeCloseTo(latinLen - 2, 1);
    // word-spacing="normal"・<length> も同じ (.minimum = .optimum)
    expect(run(block(`${latin} ${latin}`, 'text-align="justify" word-spacing="normal"'), latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
    expect(run(block(`${latin} ${latin}`, 'text-align="justify" word-spacing="0pt"'), latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
    // 和文の行の空白も同じ
    expect(run(block(mixed + mixed, 'text-align="justify"'), mixedLen - 0.5)[0]).toBe('ああ あああああああ');
  });

  it('word-spacing.minimum があれば、両端揃えで組む行の語間を、その幅まで詰めて収める (§7.17.8: “The minimum and maximum values specify the limits of the adjustment.”)', () => {
    const lines = layout(block(`${latin} ${latin}`, `text-align="justify" ${MIN}`), latinLen - 2);
    expect(lines[0].text).toBe(latin);
    expect(lines[0].len).toBeCloseTo(latinLen - 2, 1);
    // 限りが足りなければ (1 つ 0.3pt = 1.5pt < 2pt)、詰めずに送る
    expect(run(block(`${latin} ${latin}`, 'text-align="justify" word-spacing.minimum="-0.3pt"'), latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
    // .minimum が .optimum より大きければ、.optimum とする (§5.11): 詰めない
    expect(run(block(`${latin} ${latin}`, 'text-align="justify" word-spacing.minimum="1pt"'), latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
    // 継承される: 親のブロックに書いた限りを、子のブロックも使う。子に word-spacing を書けば決め直す (一括の値は .minimum = .optimum)
    expect(run(`<fo:block ${MIN}>${block(`${latin} ${latin}`, 'text-align="justify"')}</fo:block>`, latinLen - 2)[0]).toBe(latin);
    expect(run(`<fo:block ${MIN}>${block(`${latin} ${latin}`, 'text-align="justify" word-spacing="normal"')}</fo:block>`, latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
  });

  it('word-spacing.maximum があれば、両端揃えで広げる語間を、その幅までにする (残りは行の終わりに残る)', () => {
    // 1 行目は「aaaa … eeee」(語間 4 つ) で、送った「ffff」の分 (約 22pt) を広げて埋めるところ。1 つ 1pt までなら、行の長さは約 4pt 伸びるだけ
    const free = layout(block(`${latin} ${latin}`, 'text-align="justify"'), latinLen - 2)[0].len;
    const capped = layout(block(`${latin} ${latin}`, 'text-align="justify" word-spacing.maximum="1pt"'), latinLen - 2)[0];
    expect(capped.text).toBe('aaaa bbbb cccc dddd eeee');
    const natural = layout(block('aaaa bbbb cccc dddd eeee'), 400)[0].len;
    expect(capped.len).toBeCloseTo(natural + 4, 1);
    expect(capped.len).toBeLessThan(free - 1);
    // 限りが足りていれば、版面の幅まで広げる
    expect(layout(block(`${latin} ${latin}`, 'text-align="justify" word-spacing.maximum="20pt"'), latinLen - 2)[0].len).toBeCloseTo(latinLen - 2, 1);
  });

  it('両端揃えのブロックの最後の行 (text-align-last は relative = start) は、両端揃えで組まないので、詰めない', () => {
    // 段落の全体が 1 行: その行が最後の行
    expect(run(block(latin, 'text-align="justify"'), latinLen - 2)).toEqual(latinCut);
    // 2 行目が最後の行: 1 行目は詰めて収め、2 行目は詰めない (.minimum があっても)
    expect(run(block(`${latin} ${latin}`, `text-align="justify" ${MIN}`), latinLen - 2)).toEqual([latin, ...latinCut]);
    expect(run(block(latin, `text-align="justify" ${MIN}`), latinLen - 2)).toEqual(latinCut);
    expect(run(block(latin, 'text-align="justify" text-align-last="start"'), latinLen - 2)).toEqual(latinCut);
    expect(run(block(latin, 'text-align="justify" text-align-last="center"'), latinLen - 2)).toEqual(latinCut);
  });

  it('改行 (U+000A) で終わる行も、text-align-last で組む (§7.16.10) ので、両端揃えのブロックでも詰めない (空の行もできない)', () => {
    expect(run(block(`${latin}\nzzz`, 'text-align="justify" linefeed-treatment="preserve"'), latinLen - 2)).toEqual([...latinCut, 'zzz']);
  });

  it('text-align-last="justify": 最後の行は両端揃えで組むので、詰めて収める。text-align が start なら、途中の行は詰めない', () => {
    expect(run(block(latin, `text-align-last="justify" ${MIN}`), latinLen - 2)).toEqual([latin]);
    expect(run(block(latin, `text-align="justify" text-align-last="justify" ${MIN}`), latinLen - 2)).toEqual([latin]);
    // 途中の行 (start) は詰めず、最後の行 (justify) は詰める
    expect(run(block(`${latin} ${latin}`, `text-align-last="justify" ${MIN}`), latinLen - 2)).toEqual(['aaaa bbbb cccc dddd eeee', 'ffff aaaa bbbb cccc dddd', 'eeee ffff']);
    expect(run(block(`${latin} ${latin}`, `text-align="justify" text-align-last="justify" ${MIN}`), latinLen - 2)).toEqual([latin, latin]);
    // 改行で終わる行も、text-align-last="justify" なら詰めて収める (改行の後ろに、空の行を作らない)
    expect(run(block(`${latin}\nzzz`, `text-align-last="justify" linefeed-treatment="preserve" ${MIN}`), latinLen - 2)).toEqual([latin, 'zzz']);
    // .minimum が無ければ、text-align-last="justify" の行も詰めない
    expect(run(block(latin, 'text-align-last="justify"'), latinLen - 2)).toEqual(latinCut);
  });

  it('行内の要素に書いた text-align (継承のための値) は、その行の揃えではない: ブロックの揃えで決める', () => {
    expect(run(block(`<fo:inline text-align="justify">${latin} ${latin}</fo:inline>`), latinLen - 2)[0]).toBe('aaaa bbbb cccc dddd eeee');
    expect(run(block(`<fo:inline text-align="start">${latin} ${latin}</fo:inline>`, `text-align="justify" ${MIN}`), latinLen - 2)[0]).toBe(latin);
  });

  it('axf:text-justify-trim="inter-word" (アンテナハウスの拡張。どのモードでも読む) があれば、両端揃えで組む行の語間を詰める (1/3 まで)', () => {
    const AXF = 'xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:text-justify-trim="inter-word"';
    expect(run(block(`${latin} ${latin}`, `text-align="justify" ${AXF}`), latinLen - 2)[0]).toBe(latin);
    // 両端揃えで組まない行は、今までどおり詰めない
    expect(run(block(latin, AXF), latinLen - 2)).toEqual(latinCut);
  });

  it('互換モード (antenna) は、word-spacing.minimum・.maximum を読まない (今までどおり: 語間を詰めず、未対応の指定として報告する)', () => {
    const attrs = `text-align="justify" ${MIN} word-spacing.maximum="1pt"`;
    expect(run(block(`${latin} ${latin}`, attrs), latinLen - 2, 'antenna')[0]).toBe('aaaa bbbb cccc dddd eeee');
    const r = importXslFo(fo(block(latin, attrs), 200), parse, { compat: 'antenna' });
    expect(JSON.stringify(r.document)).not.toMatch(/wordSpace(Shrink|Stretch)Limit/);
  });

  it('両端揃えでない行でも、行中の読点の後ろのアキは、今までどおり詰めて収める', () => {
    // 「あ、いうえおかきくけ」は 10 字 = 100pt。読点の後ろの二分アキを 3pt 詰めれば 97pt に入る
    expect(run(block('あ、いうえおかきくけ'), 97)).toEqual(['あ、いうえおかきくけ']);
    expect(run(block('あ、いうえおかきくけ', 'text-align="center"'), 97)).toEqual(['あ、いうえおかきくけ']);
  });
});
