import { beforeAll, describe, expect, it } from 'vitest';
import { doc, makeEngine } from './helpers';
import { isIdeographicOrKana } from '../src/jis';
import { isVariationSequence, variationUnits } from '../src/measurer';
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
/** 1 つのブロックを組んだときの、行ごとの字 */
const lineTexts = (children: unknown[], extra: object = {}) => {
  const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children, ...extra }] as never));
  const block = t.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
  return block.children.map((line) => {
    let s = '';
    const visit = (a: Area) => {
      if (a.type === 'glyph') s += a.text;
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    visit(line);
    return s;
  });
};

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

describe('異体字セレクタは基底の字と 1 単位 (CSS-09 の一部。UAX #29 GB9)', () => {
  const IVS = '\u{E0100}';
  const VS1 = '\uFE00';
  it('字の単位の分け方: 基底の字の直後の異体字セレクタだけをまとめる', () => {
    expect(variationUnits('あ葛' + IVS + 'い')).toEqual(['あ', '葛' + IVS, 'い']);
    expect(variationUnits(['a', VS1, VS1, 'b'])).toEqual(['a' + VS1 + VS1, 'b']);
    // 空白・結合文字・行頭の後ろの異体字セレクタはまとめない。異体字セレクタが無ければ、受け取ったものをそのまま返す
    expect(variationUnits(' ' + VS1 + 'e\u0301' + VS1)).toEqual([' ', VS1, 'e', '\u0301', VS1]);
    expect(variationUnits(VS1 + 'a')).toEqual([VS1, 'a']);
    expect(variationUnits('あいう')).toBe('あいう');
    expect([isVariationSequence('葛' + IVS), isVariationSequence('葛'), isVariationSequence('葛い'), isVariationSequence(IVS)]).toEqual([true, false, false, false]);
  });
  it('異体字セレクタは別の字にならず、基底の字と同じ字形の節 (文字列) で描く', () => {
    const g = glyphs('あ葛' + IVS + 'い辻' + VS1 + 'う');
    expect(g.map(([t]) => t)).toEqual(['あ', '葛' + IVS, 'い', '辻' + VS1, 'う']);
    expect(g.map(([, x]) => x)).toEqual([0, 10, 20, 30, 40]);
    // 縦書きでも同じ (正立の全角の字)
    const v = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ葛' + IVS + 'い'] }] as never, 'vertical-rl'));
    const texts: string[] = [];
    const visit = (a: Area) => {
      if (a.type === 'glyph') texts.push(a.text);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    for (const c of v.sheets[0].page.regionBody.children) visit(c);
    expect(texts).toEqual(['あ', '葛' + IVS, 'い']);
  });
  it('字の種類で決まる処理は基底の字で行う: 和欧間のアキ・字間', () => {
    // 異体字セレクタの付いた漢字と欧字の間にも、和欧間のアキが入る
    expect(xs('葛' + IVS + 'A', { textAutospace: true })[1] - xs('葛' + IVS + 'A')[1]).toBeCloseTo(2.5, 1);
    expect(xs('A葛' + IVS, { textAutospace: true })[1] - xs('A葛' + IVS)[1]).toBeCloseTo(2.5, 1);
    // 字間は、字の単位の後ろに 1 度だけ
    expect(xs('葛' + IVS + 'いう', { letterSpacing: 2 })).toEqual([0, 12, 24]);
  });
  it('ルビの親文字の異体字セレクタも、基底の字と 1 つ (字の数に数えない)', () => {
    const m = E.measurer.ruby('葛' + IVS + '飾', 'かつしか', { fontFamily: 'Noto Serif JP', fontSize: 10 }, 'horizontal-tb');
    expect(m.baseGlyphs.length).toBe(2);
    expect(m.baseAdvance).toBeCloseTo(20, 5);
  });
});

describe('break-all でも、基底の字と結合文字の間では改行しない (CSS-09 の一部。Text 3 §5.1・UAX #29 GB9・GB9a)', () => {
  it('送りのある結合文字 (母音記号など) の前でも、行を分けない', () => {
    // デーヴァナーガリーの子音 + 母音記号 (U+093E。General_Category は Mc で、送りがある)。3 字 (1 単位半) 入る幅でも、母音記号を行頭に送らず、字の単位の前で分ける
    const lines = lineTexts(['\u0915\u093E\u0915\u093E\u0915\u093E'], { width: 35, wordBreak: 'break-all' });
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l).toBe('\u0915\u093E');
    // 送りの無い結合文字 (濁点 U+3099) の並びも、字の単位で分かれる
    expect(lineTexts(['か\u3099き\u3099く\u3099'], { width: 15, wordBreak: 'break-all' })).toEqual(['か\u3099', 'き\u3099', 'く\u3099']);
    // 結合文字でない字の間は、今までどおり break-all で分ける
    expect(lineTexts(['abcd'], { width: 12, wordBreak: 'break-all' }).length).toBeGreaterThan(1);
  });
});
