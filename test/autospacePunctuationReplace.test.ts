/**
 * text-autospace の punctuation と replace (CSS Text 4 §8.4):
 *  - punctuation: 内容の言語がフランス語の所だけ、; ! ? » の前・« の後ろに細い空き、: の前に語間の空きを入れる。そこでは行を分けない。
 *    間に空白の字があれば入れない (insert)。ほかの言語には効かない
 *  - replace: 空きを入れる所の U+0020 を取り除いて、その空きにする (和欧間のアキ・フランス語の約物の前後)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 段落ごとの、字 → x (pt。0.1 に丸める。同じ字は最初のもの) */
const xs = async (body: string) => {
  const r = await typesetHtml(`<!DOCTYPE html><html lang="fr"><head><style>@page{size:400pt 300pt;margin:0} body{margin:0;font-size:10pt;line-height:12pt} p{margin:0;text-indent:0}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont });
  const out: Array<Array<[string, number]>> = [];
  const rec = (a: Area, ox: number) => {
    const x = ox + (a.x ?? 0);
    if (a.type === 'line') {
      const row: Array<[string, number]> = [];
      const g = (b: Area, bx: number) => {
        const xx = bx + (b.x ?? 0);
        const t = (b as unknown as { text?: string }).text;
        if (b.type === 'glyph' && t) row.push([t, Math.round(xx * 10) / 10]);
        for (const c of childrenOf(b)) g(c as Area, xx);
      };
      for (const c of childrenOf(a)) g(c as Area, x);
      out.push(row);
      return;
    }
    for (const c of childrenOf(a)) rec(c as Area, x);
  };
  rec(r.areaTree.sheets[0].page as unknown as Area, 0);
  return out;
};
const at = (row: Array<[string, number]>, ch: string) => row.find(([t]) => t === ch)![1];

describe('text-autospace の punctuation・replace', () => {
  it('フランス語の約物の前後に空きを入れる (細い空き 0.2em、: の前は 0.25em)', async () => {
    const [plain, punct] = await xs('<p>Oui!Non:Si«Bon»</p><p style="text-autospace:punctuation">Oui!Non:Si«Bon»</p>');
    expect(at(punct, '!') - at(plain, '!')).toBeCloseTo(2, 1);
    expect(at(punct, ':') - at(plain, ':')).toBeCloseTo(4.5, 1);
    expect(at(punct, 'B') - at(plain, 'B')).toBeCloseTo(6.5, 1);
    expect(at(punct, '»') - at(plain, '»')).toBeCloseTo(8.5, 1);
  });
  it('間に空白の字 (U+00A0・U+202F) があれば入れない (insert)。続く約物 (!!・?!) の間には入れない', async () => {
    const [plain, punct] = await xs('<p>Oui\u00a0? Non\u202f! «\u00a0Bon</p><p style="text-autospace:punctuation">Oui\u00a0? Non\u202f! «\u00a0Bon</p>');
    for (const ch of ['?', '!', 'B']) expect(at(punct, ch)).toBe(at(plain, ch));
    const [p2, q2] = await xs('<p>Oui!!x Quoi?!y</p><p style="text-autospace:punctuation">Oui!!x Quoi?!y</p>');
    // 並びの前に 1 つだけ (細い空き 2pt)
    expect(at(q2, 'x') - at(p2, 'x')).toBeCloseTo(2, 1);
    expect(at(q2, 'y') - at(p2, 'y')).toBeCloseTo(4, 1);
  });
  it('フランス語でなければ効かない', async () => {
    const [plain, punct] = await xs('<p lang="en">Oui!Non</p><p lang="en" style="text-autospace:punctuation">Oui!Non</p>');
    expect(at(punct, '!')).toBe(at(plain, '!'));
  });
  it('replace は、U+0020 をその空きに置き換える (insert は空けない)', async () => {
    const [punct, rep] = await xs('<p style="text-autospace:punctuation">Oui!Non?</p><p style="text-autospace:punctuation replace">Oui !Non ?</p>');
    expect(at(rep, '!')).toBeCloseTo(at(punct, '!'), 1);
    expect(at(rep, '?')).toBeCloseTo(at(punct, '?'), 1);
    const [ins, rj] = await xs('<p lang="ja" style="text-autospace:normal">漢字 abc</p><p lang="ja" style="text-autospace:ideograph-alpha ideograph-numeric replace">漢字 abc</p>');
    // 和欧間のアキ (1/8 em) に置き換わり、空白の幅より狭い
    expect(at(rj, 'a') - at(rj, '字')).toBeCloseTo(11.25, 0);
    expect(at(ins, 'a')).toBeGreaterThan(at(rj, 'a'));
  });
});
