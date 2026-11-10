import { beforeAll, describe, expect, it } from 'vitest';
import { defaultFontBuffer, doc, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { markLatinWords } from '../src/inlineFlatten';
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
const glyphsOf = (children: unknown[], extra: object = {}, wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb', eng: LayoutEngine = engine) => {
  const out: Array<{ g: GlyphArea; x: number; y: number }> = [];
  const visit = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ g: a, x, y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
  };
  for (const c of eng.layout(doc([{ type: 'block', textAlign: 'start', children, ...extra }] as never, wm)).sheets[0].page.regionBody.children) visit(c, 0, 0);
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

describe('日本語の文書の中のギリシャ文字・キリル文字: 2 字以上続く語は欧文の書体、単独の 1 字は和文の書体', () => {
  const fontsOf = (s: string, extra: object = {}, eng?: LayoutEngine) => glyphsOf([s], { fontFamily: FAMILY, ...extra }, 'horizontal-tb', eng).map((e) => `${e.g.text}:${e.g.fontFamily === FAMILY ? '和' : e.g.fontFamily === 'Arimo' ? '欧' : e.g.fontFamily}`).join(' ');
  it('語の決め方 (markLatinWords): 字が 2 つ以上。ハイフン・アポストロフィは語をつなぎ、ラテン文字・数字・和字・空白は語を切る', () => {
    const marked = (s: string) => {
      const u = [...s];
      const m = markLatinWords(u);
      return u.map((c, k) => (m?.[k] ? `[${c}]` : c)).join('');
    };
    expect(marked('α線とβ版')).toBe('α線とβ版');
    expect(marked('αβγ')).toBe('[α][β][γ]');
    expect(marked('Россияへ')).toBe('[Р][о][с][с][и][я]へ');
    // ハイフン・アポストロフі でつないだ語は 1 つの語 (つなぐ字そのものには印を付けない)
    expect(marked('Санкт-Петербург')).toBe('[С][а][н][к][т]-[П][е][т][е][р][б][у][р][г]');
    expect(marked('β-γ')).toBe('[β]-[γ]');
    expect(marked("п'ять")).toBe("[п]'[я][т][ь]");
    // ハイフンの後ろが和字・ラテン文字なら、つながない (1 字のまま)
    expect(marked('β-カロテン')).toBe('β-カロテン');
    expect(marked('μm')).toBe('μm');
    expect(marked('α1β')).toBe('α1β');
    expect(marked('α β')).toBe('α β');
    expect(marked('Я。Да')).toBe('Я。[Д][а]');
  });
  it('単独の 1 字は和文の書体のまま、語は欧文の書体になる (ラテン文字・和字は変わらない)', () => {
    expect(fontsOf('α線')).toBe('α:和 線:和');
    expect(fontsOf('10μm')).toBe('1:欧 0:欧 μ:和 m:欧');
    expect(fontsOf('αβ線')).toBe('α:欧 β:欧 線:和');
    expect(fontsOf('Да')).toBe('Д:欧 а:欧');
    // 和文の書体が持たない字 (ά・ї) を含む語も、語の全体が 1 つの書体になる
    expect(fontsOf('Ελλάδα')).toBe('Ε:欧 λ:欧 λ:欧 ά:欧 δ:欧 α:欧');
    expect(fontsOf('Київ')).toBe('К:欧 и:欧 ї:欧 в:欧');
    // 結合文字の付いた字 (合成済みの字の無い а + U+0301) も、語の字
    expect(fontsOf('за\u0301мок').split(' ').every((x) => x.endsWith(':欧'))).toBe(true);
  });
  it('和欧間のアキ: 語と和字の間にはラテン文字の語と同じに入り、単独の 1 字と和字の間には入らない', () => {
    const x1 = (s: string, extra: object = {}) => glyphsOf([s], { fontFamily: FAMILY, ...extra })[1].x;
    const gap = (s: string) => x1(s, { textAutospace: true }) - x1(s);
    expect(gap('漢Да')).toBeCloseTo(gap('漢a'), 6);
    expect(gap('漢Да')).toBeGreaterThan(0);
    expect(gap('漢α')).toBe(0);
    const last = (s: string, extra: object = {}) => glyphsOf([s], { fontFamily: FAMILY, ...extra }).at(-1)!.x;
    expect(last('Да漢', { textAutospace: true }) - last('Да漢')).toBeCloseTo(gap('漢a'), 6);
    expect(last('α漢', { textAutospace: true }) - last('α漢')).toBe(0);
  });
  it('字の組の詰め (kern) は、語を組む欧文の書体の組で引く', () => {
    const m = new Measurer(fonts, 'fontkit');
    const pair = ['ГА', 'Та', 'Уд', 'Го'].find((p) => m.kern(p[0], p[1], { fontFamily: 'Arimo', fontWeight: 400 }) < 0)!;
    const x1 = (extra: object = {}) => glyphsOf([pair], { fontFamily: FAMILY, ...extra })[1].x;
    expect(x1({ kerning: true })).toBeLessThan(x1() - 1e-6);
  });
  it('欧文の書体が持たない字は、これまでどおりの後備 (和文の書体が持てば和文の書体)', () => {
    const arimo = fonts.get('Arimo', 400);
    const has = arimo.fk.hasGlyphForCodePoint.bind(arimo.fk);
    (arimo.fk as unknown as { hasGlyphForCodePoint(cp: number): boolean }).hasGlyphForCodePoint = (cp) => cp !== 0x430 && has(cp);
    try {
      expect(fonts.hasGlyph(arimo, 'а')).toBe(false);
      // 覚えた結果を使わないよう、別の字の並びで見る (Д は欧文の書体、а は和文の書体)
      fonts.setLatinFallback(FAMILY, 'Arimo');
      expect(fontsOf('Даа')).toBe('Д:欧 а:和 а:和');
    } finally {
      (arimo.fk as unknown as { hasGlyphForCodePoint(cp: number): boolean }).hasGlyphForCodePoint = has;
      fonts.setLatinFallback(FAMILY, 'Arimo');
    }
  });
  it('欧文の代わりの書体を持たない書体 (作者が指定した書体・読み込んだ書体) では、変わらない', async () => {
    const f = new FontManager();
    await f.registerBuffer(FAMILY, 400, await fontBuffer(), false);
    await f.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
    const e = new LayoutEngine(f, new Measurer(f, 'fontkit'), { defaultFontFamily: FAMILY });
    expect(fontsOf('Да', {}, e)).toBe('Д:和 а:和');
    expect(fontsOf('Да', { fontFamily: 'Arimo' }, e)).toBe('Д:欧 а:欧');
  });
  it('アンテナハウス互換 (kernAh) では、語も和文の書体のまま', () => {
    const e = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY, kernAh: true });
    expect(fontsOf('Да', {}, e)).toBe('Д:和 а:和');
  });
  it('縦書き: 単独の 1 字も語も横倒し (書体が変わっても向きは変わらない)', () => {
    const gs = glyphsOf(['縦αとДа'], { fontFamily: FAMILY }, 'vertical-rl');
    expect(gs.map((e) => `${e.g.text}:${e.g.rotation}`).join(' ')).toBe('縦:0 α:90 と:0 Д:90 а:90');
    expect(gs.map((e) => e.g.fontFamily)).toEqual([FAMILY, FAMILY, FAMILY, 'Arimo', 'Arimo']);
  });
});
