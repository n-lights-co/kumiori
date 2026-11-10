import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import type { Area, GlyphArea } from '../src/types';

/**
 * 韓国語 (ハングル) を組む。
 *  - つなぐ字母の並び (U+1100〜) は 1 つの字の単位 (UAX #29 GB6〜GB8) で、書体が音節の字形に合成する
 *  - 改行: word-break: normal は音節の間でも折り返す、keep-all は空白でだけ (CSS Text 3 §5.1)
 *  - ハングルの語の間の空白は、書体が文脈で決める幅 (OpenType の calt) にする
 *  - 和欧間のアキ (text-autospace) は、ハングルと欧字・数字の間には入れない (CSS Text 4 §8.4.1: ハングルは ideographs に含まれない)
 * 書体: Noto Sans KR (テストが取得する。helpers.ts の EXTRA_TEST_FONTS)
 */
let fonts: FontManager;
let measurer: Measurer;
let engine: LayoutEngine;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  const b = fs.readFileSync(await extraTestFont('NotoSansKR-Regular-v40.ttf'));
  await fonts.registerBuffer('KR', 400, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, false);
  measurer = new Measurer(fonts, 'fontkit');
  engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY });
});

/** 行ごとの字 (GlyphArea) と、行の左端からの x */
const linesOf = (text: string, extra: object = {}, wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') => {
  const tree = engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: 'KR', children: [text], ...extra }] as never, wm));
  const block = tree.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
  return block.children.map((line) => {
    const out: Array<{ g: GlyphArea; x: number; y: number }> = [];
    const visit = (a: Area, ox: number, oy: number) => {
      if (a.type === 'glyph') out.push({ g: a, x: ox + a.x, y: oy + a.y });
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, ox + a.x, oy + a.y);
    };
    visit(line, 0, 0);
    return out;
  });
};
const texts = (text: string, extra: object = {}) => linesOf(text, extra).map((l) => l.map((e) => e.g.text).join(''));
const nominal = (ch: string) => fonts.get('KR', 400).fk.glyphForCodePoint(ch.codePointAt(0)!).id;
const HAN = '한'; // ᄒ + ᅡ + ᆫ → 한
const OLD = 'ᄒᆞᆫ'; // 古ハングル (アレア)

describe('つなぐ字母の並びは 1 つの字 (UAX #29 GB6〜GB8)', () => {
  it('初声 + 中声 + 終声 (한) は 1 つの字の単位で、書体が音節の字 (U+D55C) の字形に合成する。送りも同じ', () => {
    const [[a, b]] = linesOf(`${HAN}한`);
    expect(a.g.text).toBe(HAN);
    expect(a.g.fontFamily).toBe('KR');
    expect(a.g.glyphIds).toEqual([nominal('한')]);
    expect(a.g.advance).toBeCloseTo(b.g.advance, 6);
    expect(b.x).toBeCloseTo(a.g.advance, 6);
  });
  it('古ハングル (音節の字が無い並び) も 1 つの字の単位で、1 字分の送り', () => {
    const [[a, b]] = linesOf(`${OLD}한`);
    expect(a.g.text).toBe(OLD);
    expect(a.g.glyphIds?.includes(0)).toBe(false);
    expect(a.g.advance).toBeCloseTo(b.g.advance, 6);
  });
  it('並びの途中では折り返さない (狭い幅 + break-all でも)', () => {
    const ls = texts(HAN.repeat(6), { width: 25, wordBreak: 'break-all' });
    expect(ls.length).toBeGreaterThan(1);
    for (const l of ls) expect(l.length % 3).toBe(0);
  });
});

describe('改行 (CSS Text 3 §5.1 の word-break)', () => {
  const TEXT = '대한민국은 민주공화국이다. 모든 권력은 국민으로부터 나온다.';
  const W = 80;
  it('normal: 音節の間でも折り返す (語の途中で行が替わる)。句点の前では折り返さない', () => {
    const ls = texts(TEXT, { width: W, language: 'ko' });
    expect(ls.length).toBeGreaterThan(2);
    expect(ls.join('').replace(/ /g, '')).toBe(TEXT.replace(/ /g, ''));
    // 空白でない所で終わる行がある
    const words = new Set(TEXT.split(' '));
    expect(ls.slice(0, -1).some((l) => !words.has(l.trim().split(' ').pop()!))).toBe(true);
    for (const l of ls) expect(/^[.,]/.test(l)).toBe(false);
  });
  it('keep-all: 空白でだけ折り返す (どの行も、語の並び)', () => {
    const ls = texts(TEXT, { width: W, language: 'ko', wordBreak: 'keep-all' });
    expect(ls.length).toBeGreaterThan(2);
    expect(ls.map((l) => l.trim()).join(' ')).toBe(TEXT);
  });
  it('行は箱の幅に収まる', () => {
    for (const wb of ['normal', 'keep-all']) for (const l of linesOf(TEXT, { width: W, language: 'ko', wordBreak: wb })) {
      const last = l.filter((e) => e.g.text.trim()).pop()!;
      expect(last.x + last.g.advance).toBeLessThanOrEqual(W + 1e-6);
    }
  });
});

describe('語の間の空白と、和欧間のアキ', () => {
  const fk = () => fonts.get('KR', 400).fk;
  const em = (n: number) => (n / fonts.get('KR', 400).unitsPerEm) * 10;
  it('ハングルとハングルの間の空白は、書体が文脈 (calt) で替えた空白の字形の送りになる', () => {
    const run = fk().layout('한 국', { kern: false, liga: false, clig: false } as never);
    const wide = run.positions[1].xAdvance;
    const plain = fk().glyphForCodePoint(0x20).advanceWidth;
    // この書体は、ハングルの間の空白を広げる (書体が変わって広げなくなったら、このテストの前提を見直す)
    expect(wide).toBeGreaterThan(plain);
    const [[a, sp, b]] = linesOf('한 국');
    expect(sp.g.text).toBe(' ');
    expect(b.x - (a.x + a.g.advance)).toBeCloseTo(em(wide), 6);
  });
  it('欧字どうし・ハングルと欧字の間の空白は、書体の空白の送りのまま', () => {
    const plain = em(fk().glyphForCodePoint(0x20).advanceWidth);
    for (const t of ['A B', '한 A', 'A 한', '1 한']) {
      const [[a, , b]] = linesOf(t);
      expect(b.x - (a.x + a.g.advance)).toBeCloseTo(plain, 6);
    }
  });
  it('ハングルの字の無い段落では、空白の文脈を調べない', () => {
    const spy = vi.spyOn(measurer, 'contextSpaceDelta');
    try {
      linesOf('吾輩は 猫である。Hello, world! ภาษา ไทย');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('和欧間のアキ: ハングルと欧字・数字の間には入れない。漢字と欧字の間には入れる (CSS Text 4 §8.4.1)', () => {
    const gap = (t: string) => {
      const [[a, b]] = linesOf(t, { textAutospace: true });
      return b.x - (a.x + a.g.advance);
    };
    expect(gap('한A')).toBeCloseTo(0, 6);
    expect(gap('A한')).toBeCloseTo(0, 6);
    expect(gap('한1')).toBeCloseTo(0, 6);
    expect(gap('한漢')).toBeCloseTo(0, 6);
    expect(gap('漢A')).toBeGreaterThan(0);
  });
});

describe('縦書き', () => {
  it('ハングルは正立で 1 字分ずつ送る。つなぐ字母の並びも 1 字', () => {
    const [l] = linesOf(`한${HAN}국`, {}, 'vertical-rl');
    expect(l.map((e) => e.g.text)).toEqual(['한', HAN, '국']);
    expect(l.map((e) => e.g.rotation)).toEqual([0, 0, 0]);
    expect(l[1].y - l[0].y).toBeCloseTo(10, 6);
    expect(l[2].y - l[1].y).toBeCloseTo(10, 6);
  });
});
