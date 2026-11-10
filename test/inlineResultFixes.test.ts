import { beforeAll, describe, expect, it } from 'vitest';
import { doc, makeEngine } from './helpers';
import { isIdeographicOrKana } from '../src/jis';
import type { Area } from '../src/types';

/** 全体のレビューで見つけた、行の組み方の結果の誤り (CSS-09・CSS-10) */

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 1 つのブロックを組んだときの、字 (glyph) ごとの [文字列, x] */
const glyphs = (text: string, extra: object = {}) => {
  const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [text], ...extra }] as never));
  const out: Array<[string, number]> = [];
  const visit = (a: Area, ox: number) => {
    const x = ox + a.x;
    if (a.type === 'glyph') out.push([a.text, x]);
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
  };
  for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
  return out;
};
const xs = (text: string, extra: object = {}) => glyphs(text, extra).map(([, x]) => x);

describe('和字の判定 (CSS-10。CSS Text 4 §8.4.1 の ideographs)', () => {
  it('拡張 B 以降の漢字・〇・〆・々・部首・片仮名の拡張は和字。約物・欧字は和字ではない', () => {
    expect(['𠮷', '〇', '〆', '々', '⼀', 'ㇰ', '漢', 'あ', 'ア', 'ー', '\u{2a700}', '\u{30000}'].map(isIdeographicOrKana)).toEqual(new Array(12).fill(true));
    expect(['、', '。', '「', '・', '゠', 'A', '1', '　', 'Ａ', '한', 'ｱ'].map(isIdeographicOrKana)).toEqual(new Array(11).fill(false));
  });
  it('拡張 B の漢字・〇 と欧字・数字の間にも、和欧間のアキが入る', () => {
    const gap = (text: string, k: number) => xs(text, { textAutospace: true })[k] - xs(text)[k];
    expect(gap('𠮷A', 1)).toBeCloseTo(2.5, 1);
    expect(gap('A𠮷', 1)).toBeCloseTo(2.5, 1);
    expect(gap('二〇二六年A', 5)).toBeCloseTo(2.5, 1);
    expect(gap('〇A', 1)).toBeCloseTo(2.5, 1);
    expect(gap('1〆', 1)).toBeCloseTo(2.5, 1);
    // 約物と欧字の間には入れない (今までどおり)
    expect(gap('。A', 1)).toBeCloseTo(0, 1);
  });
});
