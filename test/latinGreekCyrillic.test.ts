import { beforeAll, describe, expect, it } from 'vitest';
import { defaultFontBuffer, doc, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import type { Area, GlyphArea } from '../src/types';

/**
 * ベトナム語 (ラテン文字 + 2 段の記号)・ギリシャ文字・キリル文字を、既定の欧文の書体 (Arimo) で組む。
 * 分解形 (NFD) を合成済みの字で組むことは test/graphemeCluster.test.ts で確かめる
 */
let fonts: FontManager;
let engine: LayoutEngine;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
  fonts.setLatinFallback(FAMILY, 'Arimo');
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
});
const glyphsOf = (children: unknown[], extra: object = {}) => {
  const out: Array<{ g: GlyphArea; x: number; y: number }> = [];
  const visit = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ g: a, x, y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
  };
  for (const c of engine.layout(doc([{ type: 'block', textAlign: 'start', children, ...extra }] as never)).sheets[0].page.regionBody.children) visit(c, 0, 0);
  return out;
};

describe('ベトナム語・ギリシャ文字・キリル文字 (欧文の書体で組む)', () => {
  const texts = (s: string) => glyphsOf([s], { fontFamily: FAMILY }).map((e) => `${e.g.text}:${e.g.fontFamily}`);
  it('Latin Extended Additional の字 (ế・ệ) は、語のほかの字と同じ欧文の書体で組む (和文の書体が持っていても)', () => {
    expect(fonts.hasGlyph(fonts.get(FAMILY, 400), 'ế')).toBe(true);
    expect(texts('Tiếng')).toEqual(['T:Arimo', 'i:Arimo', 'ế:Arimo', 'n:Arimo', 'g:Arimo']);
    // 分解形 (e + U+0302 + U+0301) も同じ字・同じ書体
    expect(texts('Tiếng')).toEqual(texts('Tiếng'));
  });
  it('和文と Latin Extended Additional の字の間にも、和欧間のアキが入る (ほかの欧文の字と同じ)', () => {
    const x1 = (s: string, extra: object = {}) => glyphsOf([s], { fontFamily: FAMILY, ...extra })[1].x;
    const gap = (s: string) => x1(s, { textAutospace: true }) - x1(s);
    expect(gap('ế漢')).toBeCloseTo(gap('e漢'), 6);
    expect(gap('漢ế')).toBeCloseTo(gap('漢e'), 6);
    expect(gap('ế漢')).toBeGreaterThan(0);
  });
  it('キリル文字・ギリシャ文字の字の組も、書体の kern で詰める', () => {
    const m = new Measurer(fonts, 'fontkit');
    const x1 = (s: string, extra: object = {}) => glyphsOf([s], { fontFamily: 'Arimo', ...extra })[1].x;
    for (const pairs of [['ГА', 'Та', 'Уд', 'Го'], ['ΑΥ', 'Ατ', 'Τα', 'Υα']]) {
      const pair = pairs.find((p) => m.kern(p[0], p[1], { fontFamily: 'Arimo', fontWeight: 400 }) < 0);
      expect(pair).toBeDefined();
      expect(x1(pair!, { kerning: true })).toBeLessThan(x1(pair!) - 1e-6);
    }
  });
});
