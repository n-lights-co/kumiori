/**
 * 行の調整 (追込み) で、行中の約物のアキを詰める量の上限 (lineSqueezeMax)。
 * アンテナハウス互換では 1 行に二分 (約物 1 つ分) まで: 読点 2 つを詰めれば入る 1 字は追い込まず次の行へ送る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FAMILY, makeEngine } from './helpers';
import { adjustJapaneseSpacing, breakLines, flattenInline, markLineBreaks, positionLine } from '../src/inlineLayout';
import { resolveStyle, type ResolvedStyle } from '../src/lnode';

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
  textAlign: 'start',
  textIndent: 0,
  letterSpacing: 0,
  rubyScale: 0.5,
  hanging: false,
  orphans: 2,
  widows: 2,
  wm: 'horizontal-tb',
  ...over,
});

/** 行に分けて、行ごとの字の並びを返す */
const lines = (text: string, st: ResolvedStyle, L: number) => {
  const atoms = flattenInline([text], st, E.measurer);
  markLineBreaks(atoms);
  return breakLines(atoms, L, 0, false).map((l) => l.items.map((a) => a.first).join(''));
};

describe('追込みの行中の約物の詰めの上限 (lineSqueezeMax)', () => {
  // 「あ、い、うえおかきく」は 10 字 = 100pt。読点 2 つの後ろの二分アキ (5pt ずつ) を詰めれば 90pt まで縮む
  const text = 'あ、い、うえおかきく';
  it('上限が無ければ (JLREQ)、読点 2 つを詰めて 1 行に収める', () => {
    expect(lines(text, resolveStyle(base(), {}), 92)).toEqual([text]);
  });
  it('上限 0.5 (アンテナハウス互換) では、二分を超える追込みはせず、最後の字を次の行へ送る', () => {
    const st = resolveStyle(base({ lineSqueezeMax: 0.5 }), {});
    expect(lines(text, st, 92)).toEqual(['あ、い、うえおかき', 'く']);
    // 二分以内で足りる分 (3pt) は追い込む
    expect(lines(text, st, 97)).toEqual([text]);
  });
  it('行の配置でも、行中の約物を詰める量は上限まで (行は溢れたまま)', () => {
    const st = resolveStyle(base({ lineSqueezeMax: 0.5 }), {});
    const atoms = flattenInline([text], st, E.measurer);
    markLineBreaks(atoms);
    // 幅 92 の行に 10 字をそのまま入れて配置する (上限が無ければ 2 つの読点を 4pt ずつ詰めて 92 に収まる)
    const raw = breakLines(atoms, 200, 0, false)[0];
    const placed = positionLine(raw, 92, st);
    const widths = placed.widths;
    const commas = widths.filter((_w, k) => raw.items[k].first === '、');
    // 詰めた量の合計は 5pt (二分) まで: 読点 2 つで合わせて 5pt 詰める
    expect(10 * 2 - (commas[0] + commas[1])).toBeCloseTo(5, 3);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(95, 3);
  });
});

describe('和欧間アキと全角形', () => {
  const trails = (text: string) => {
    const st = resolveStyle(base({ textAutospace: true }), {});
    const atoms = flattenInline([text], st, E.measurer);
    adjustJapaneseSpacing(atoms);
    return atoms.map((a) => a.trail ?? 0);
  };
  it('約物でない全角形 (＋・全角の英数字) は和字として、欧字との間に四分アキを入れる (「FrameMaker ＋ SGML」)', () => {
    expect(trails('A＋B')).toEqual([2.5, 2.5, 0]);
    expect(trails('xＡＢy')).toEqual([2.5, 0, 2.5, 0]);
  });
  it('後置省略記号 (％)・前置省略記号 (＄)・ハイフン類 (～)・全角の約物は和字にしない (「3.4％」「1～10」はベタ)', () => {
    expect(trails('3.4％上昇')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(trails('1～10')).toEqual([0, 0, 0, 0]);
    expect(trails('＄5')).toEqual([0, 0]);
    expect(trails('a（b')).toEqual([0, 0, 0]);
  });
});
