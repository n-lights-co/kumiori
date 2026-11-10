import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { complexContextBreaks } from '../src/lineBreak';
import type { Area } from '../src/types';

/**
 * Intl.Segmenter の無い実行環境では、語の間に空白を書かない用字 (タイ語など) の並びの中に改行の機会を作らない
 * (UAX #14 の LB1 の既定: SA を AL として扱う。これまでと同じ動き)。
 * 言語ごとの Intl.Segmenter は 1 度作ると覚えるので、ほかのテストと別のファイル (別のワーカー) で、最初から無い状態にして確かめる
 */
const RealSegmenter = Intl.Segmenter;
beforeAll(() => vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined }));
afterAll(() => vi.unstubAllGlobals());

describe('Intl.Segmenter が無い環境', () => {
  const TEXT = 'สวัสดีครับยินดีต้อนรับสู่ประเทศไทยการเรียงพิมพ์ภาษาไทย';
  it('語の境目は無い', () => {
    expect(complexContextBreaks([...TEXT].map((c) => c.codePointAt(0)!), () => 'th')).toBeNull();
  });
  it('空白の無いタイ語の文は、語の境目では折り返さない (溢れる所で分けるだけで、語の途中に行の境目が来る。これまでと同じ)', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
    const b = fs.readFileSync(await extraTestFont('NotoSansThai-Regular-v29.ttf'));
    await fonts.registerBuffer('Thai', 400, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, false);
    const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
    const tree = engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: 'Thai', width: 75, children: [TEXT] }] as never));
    const lines = (tree.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] }).children.map((line) => {
      let t = '';
      const visit = (a: Area) => {
        if (a.type === 'glyph') t += a.text;
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
      };
      visit(line);
      return t;
    });
    expect(lines.join('')).toBe(TEXT);
    // 本物の辞書 (差し替える前に取っておいたもの) の語の境目
    const words = new Set([...new RealSegmenter('th', { granularity: 'word' }).segment(TEXT)].map((x) => x.index));
    let pos = 0;
    const ends = lines.slice(0, -1).map((l) => (pos += l.length));
    expect(ends.length).toBeGreaterThan(0);
    expect(ends.some((e) => !words.has(e))).toBe(true);
  });
});
