/**
 * 字の組の詰め (カーニング) を当てる所。
 * 既定: 書式が同じなら inline の境目をまたいでも詰める (CSS Text 3 §7.3 https://www.w3.org/TR/css-text-3/ 2026-11-05 取得:
 * "Text shaping must not be broken across inline box boundaries when there is no effective change in formatting")。
 * アンテナハウス互換 (kernAh): 要素の境目では詰めない。組の表 (PairPos 形式 2) で最初の字がクラス 0 の組も詰めない
 * (OpenType の仕様では、どのクラスにも割り当てていない字はクラス 0 で、クラス 0 から始まる組の値も当てる。
 * https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2 ・ …/spec/gpos 2026-11-05 取得)
 */
import { describe, expect, it } from 'vitest';
import { adjustJapaneseSpacing, type Atom } from '../src/inlineLayout';
import { pairClassZero } from '../src/measurer';

const style = () => ({ kerning: true, fontSize: 10, punctuationSqueeze: false }) as unknown as Atom['st'];
const glyph = (ch: string, st: Atom['st'], shift?: number): Atom => ({ kind: 'glyph', first: ch, last: ch, advance: 5, isSpace: false, runId: 0, st, ...(shift ? { shift } : {}) }) as Atom;
const kern = () => -1;

describe('字の組の詰めを当てる所', () => {
  it('既定は、書式が同じなら inline の境目 (別の書式の物) をまたいでも詰める。上げ下げの違う境目では詰めない', () => {
    const a = [glyph('A', style()), glyph('V', style())];
    adjustJapaneseSpacing(a, kern);
    expect(a[0].advance).toBe(4);
    const b = [glyph('A', style()), glyph('V', style(), 3)];
    adjustJapaneseSpacing(b, kern);
    expect(b[0].advance).toBe(5);
  });
  it('アンテナハウス互換は、同じ inline の中の字どうしだけ詰める', () => {
    const s = style();
    const same = [glyph('A', s), glyph('V', s)];
    adjustJapaneseSpacing(same, kern, true);
    expect(same[0].advance).toBe(4);
    const across = [glyph('A', s), glyph('V', style())];
    adjustJapaneseSpacing(across, kern, true);
    expect(across[0].advance).toBe(5);
  });
  it('引用符 (一般句読点) の組も詰める', () => {
    const s = style();
    const a = [glyph('’', s), glyph('s', s), glyph('r', s), glyph('”', s)];
    adjustJapaneseSpacing(a, kern);
    expect(a.map((x) => x.advance)).toEqual([4, 4, 4, 5]);
  });
});

describe('組の表のクラス 0 (pairClassZero)', () => {
  // 字 10 は Coverage にあるがクラスの割り当てが無い (クラス 0)、字 11 はクラス 1
  const sub2 = { version: 2, coverage: { version: 1, glyphs: [10, 11] }, classDef1: { version: 2, classRangeRecord: [{ start: 11, end: 11, class: 1 }] } };
  const gpos = (subs: unknown[]) => ({ GPOS: { featureList: [{ tag: 'kern', feature: { lookupListIndexes: [0] } }], lookupList: { get: () => ({ lookupType: 2, subTables: subs }) } } });
  it('最初の字がクラス 0 なら true、クラス 1 なら false', () => {
    expect(pairClassZero(gpos([sub2]), 10, 20)).toBe(true);
    expect(pairClassZero(gpos([sub2]), 11, 20)).toBe(false);
  });
  it('形式 1 の副表に組があれば、それが当たる (クラス 0 ではない)。組が無ければ次の副表へ', () => {
    const pairs = new Map([[0, [{ secondGlyph: 20 }]]]);
    const sub1 = { version: 1, coverage: { version: 1, glyphs: [10] }, pairSets: { get: (i: number) => pairs.get(i) } };
    expect(pairClassZero(gpos([sub1, sub2]), 10, 20)).toBe(false);
    expect(pairClassZero(gpos([sub1, sub2]), 10, 21)).toBe(true);
  });
  it('GPOS の無い書体は false', () => {
    expect(pairClassZero({}, 10, 20)).toBe(false);
  });
});
