import { describe, expect, it } from 'vitest';
import { bidiClass, lineLevels, mirrorChar, resolveLevels, visualOrder } from '../src/bidi';

const cps = (s: string) => [...s].map((c) => c.codePointAt(0)!);
const levelsOf = (s: string, dir: 'ltr' | 'rtl' | 'auto' = 'auto') => {
  const p = resolveLevels(cps(s), dir);
  return Array.from(lineLevels(p, 0, cps(s).length)).join('');
};
/** 左から右へ描く順に並べた字 */
const visual = (s: string, dir: 'ltr' | 'rtl' | 'auto' = 'auto') => {
  const chars = [...s];
  const p = resolveLevels(cps(s), dir);
  return visualOrder(lineLevels(p, 0, chars.length))
    .map((k) => chars[k])
    .join('');
};

describe('双方向のテキスト (UAX #9)', () => {
  it('字の性質と鏡像の字 (UCD)', () => {
    expect([bidiClass(0x41), bidiClass(0x5d0), bidiClass(0x627), bidiClass(0x31), bidiClass(0x661), bidiClass(0x20), bidiClass(0x2067)]).toEqual(['L', 'R', 'AL', 'EN', 'AN', 'WS', 'RLI']);
    // 書いていない字の既定 (@missing): ヘブライ文字の区画の未割り当ての字は R
    expect(bidiClass(0x5ff)).toBe('R');
    expect([mirrorChar(0x28), mirrorChar(0x29), mirrorChar(0x41)]).toEqual([0x29, 0x28, undefined]);
  });
  it('段落の向き (P2・P3) と深さ: 左から右の段落の中の右から左の語', () => {
    expect(resolveLevels(cps('אב c'), 'auto').level).toBe(1);
    expect(resolveLevels(cps('1 c אב'), 'auto').level).toBe(0);
    expect(levelsOf('ab אבג cd')).toBe('000111000');
    expect(visual('ab אבג cd')).toBe('ab גבא cd');
  });
  it('右から左の段落の数字は左から右 (W・I の規則)、行末の空白は段落の深さ (L1)', () => {
    expect(levelsOf('אב 12 ', 'rtl')).toBe('111221');
    expect(visual('אב 12', 'rtl')).toBe('12 בא');
  });
  it('括弧の対は、中身と前の文脈の向きにそろえる (N0)', () => {
    // 右から左の段落の中の「a(b)」: 括弧は中の字と前の字が L なので L
    expect(levelsOf('א a(b) ב', 'rtl')).toBe('11222211');
    // 右から左の段落の中の「(b)」で前の文脈が R: 括弧は埋め込みの向き (R)
    expect(levelsOf('א (b) ב', 'rtl')).toBe('1112111');
  });
  it('隔離 (RLI…PDI) の中は、外の並べ替えに影響しない', () => {
    // 隔離が無ければ、右から左の語の後ろの数字はその語の並びに入る
    expect(visual('אב 12', 'ltr')).toBe('12 בא');
    // 隔離の中の右から左の語は、後ろの数字に影響しない
    expect(visual('\u2067אב\u2069 12', 'ltr')).toBe('\u2067בא\u2069 12');
  });
});

describe('つながる字の並び (アラビア文字などの字形の変化)', () => {
  it('Joining_Type が D・R・L・C の字と後ろの T の字をまとめる。空白・欧文で切る。書体が違えばまとめない', async () => {
    const { joiningUnits } = await import('../src/inlineLayout');
    const units = (s: string, same = true) => joiningUnits([...s], () => same);
    // سلام (語) ・空白・لا (2 字の語)・欧文
    expect(units('سلام لا ab')).toEqual(['سلام', ' ', 'لا', ' ', 'a', 'b']);
    // 結合記号 (T: ファトハ U+064E) は前の字と一緒
    expect(units('بَيت')).toEqual(['بَيت']);
    // つながる字が 1 つだけなら、まとめない
    expect(units('ب a')).toEqual(['ب', ' ', 'a']);
    expect(units('بيت', false)).toEqual(['ب', 'ي', 'ت']);
  });
});
