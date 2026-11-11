/**
 * XSL-FO の互換モード (compat: 'antenna') の行の調整 (追込み):
 *  - 欧文の語間と、和文と欧文の間の四分アキを詰めない。ブロックの揃えによらない (両端揃えの行も)
 *    (アンテナハウスの組版結果では、語間・和欧間のアキは、どれも本来の幅以上。詰めれば入る字・語は次の行へ送る)
 *  - 約物のアキ (行中の読点・括弧) の追込みは行う (同じ組版結果に、詰めた行がある)
 *  - 仕様モード (compat: 'spec') の結果は変えない
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

/** 行ごとの字 */
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
  return out.map((l) => ({ text: l.text.trim(), len: l.len })).filter((l) => l.text);
}
const layout = (body: string, widthPt: number, compat: 'antenna' | 'spec') => linesOf(engine.layout(importXslFo(fo(body, widthPt), parse, { compat }).document).sheets[0]);
const run = (body: string, widthPt: number, compat: 'antenna' | 'spec') => layout(body, widthPt, compat).map((l) => l.text);
const block = (text: string, align?: string) => `<fo:block${align ? ` text-align="${align}"` : ''}>${text}</fo:block>`;

describe('XSL-FO 互換モード: 語間・和欧間のアキを詰めない (両端揃えの行も)', () => {
  // 「あいうPDFえおかきくけ」: 和字 9 字 (90pt) + PDF + 四分アキ 2 つ (5pt)。四分アキを八分まで詰めれば 2.5pt 縮む
  const mixed = 'あいうPDFえおかきくけ';
  /** mixed を 1 行に組んだ長さ (四分アキ 2 つを含む) */
  let mixedLen = 0;
  // 欧文だけ: 語間 (空白の 1/3 まで) を詰めれば最後の語が入る幅
  const latin = 'aaaa bbbb cccc dddd eeee ffff';
  let latinLen = 0;
  beforeAll(() => {
    // 十分に広い行に組んだときの、行の中身の長さ
    mixedLen = layout(block(mixed), 400, 'antenna')[0].len;
    latinLen = layout(block(latin), 400, 'antenna')[0].len;
  });

  it('前提: 測った長さちょうどの幅なら 1 行に入る', () => {
    expect(run(block(mixed), mixedLen + 0.1, 'antenna')).toEqual([mixed]);
    expect(run(block(latin), latinLen + 0.1, 'antenna')).toEqual([latin]);
  });

  for (const align of [undefined, 'start', 'left', 'end', 'right', 'center']) {
    it(`text-align=${align ?? '(指定なし = start)'}: 和欧間の四分アキを詰めれば入る 1 字を、詰めずに次の行へ送る`, () => {
      // 2pt 足りない: 四分アキ 2 つを八分まで詰めれば (2.5pt) 入るが、詰めない
      expect(run(block(mixed, align), mixedLen - 2, 'antenna')).toEqual(['あいうPDFえおかきく', 'け']);
    });
    it(`text-align=${align ?? '(指定なし = start)'}: 語間を詰めれば入る語を、詰めずに次の行へ送る`, () => {
      // 2pt 足りない: 語間 5 つを 1/3 ずつ詰めれば (約 4pt) 入るが、詰めない
      expect(run(block(latin, align), latinLen - 2, 'antenna')).toEqual(['aaaa bbbb cccc dddd eeee', 'ffff']);
    });
  }

  it('両端揃え (text-align=justify) の行でも、和欧間のアキ・語間を詰めて収めない (詰めれば入る字・語は次の行へ送る)', () => {
    expect(run(block(mixed + mixed, 'justify'), mixedLen - 2, 'antenna')[0]).not.toBe(mixed);
    expect(mixed.startsWith(run(block(mixed + mixed, 'justify'), mixedLen - 2, 'antenna')[0])).toBe(true);
    expect(run(block(`${latin} ${latin}`, 'justify'), latinLen - 2, 'antenna')[0]).toBe('aaaa bbbb cccc dddd eeee');
    // 仕様モードの両端揃えは、これまでどおり詰めて収める
    expect(run(block(`${latin} ${latin}`, 'justify'), latinLen - 2, 'spec')[0]).toBe(latin);
  });

  it('両端揃えでない行でも、行中の読点の後ろのアキは詰めて収める (二分まで)', () => {
    // 「あ、いうえおかきくけ」は 10 字 = 100pt。読点の後ろの二分アキを 3pt 詰めれば 97pt に入る
    expect(run(block('あ、いうえおかきくけ'), 97, 'antenna')).toEqual(['あ、いうえおかきくけ']);
  });

  it('仕様モード (compat: spec) は変えない: 両端揃えでない行でも語間を詰めて収める', () => {
    expect(run(block(latin), latinLen - 2, 'spec')).toEqual([latin]);
  });
});
