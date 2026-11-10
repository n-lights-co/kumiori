/**
 * CSS の font-family の並びを、字 (クラスタ) ごとに前から順に引く (CSS Fonts 4 §2.1・§5.2・§5.3)。
 * 書体は、既定の書体 (和文・欧文・等幅・記号) と Lobster の欧文の部分を、別の名前の「読み込んだ書体」(fonts・--font で足した書体) として使う
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FontManager } from '../src/fontManager';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, MONO_SPECS, SYMBOL_SPEC, createFontMapping, setupDefaultFonts } from '../src/fontMapping';
import { SANS, SERIF } from '../src/sampleData';
import { createTypesetter, walkAreaTree, type GlyphArea } from '../src/index';
import { ensureFonts, extraTestFont, fontDir, fontFileName, loadCachedFont } from './helpers';

const read = (file: string): ArrayBuffer => {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const cached = (name: string) => read(path.join(fontDir, name));

beforeAll(async () => {
  await ensureFonts([...FONT_SPECS, ...LATIN_SPECS, ...MONO_SPECS, SYMBOL_SPEC]);
  await extraTestFont('Lobster-latin.woff2');
}, 300_000);

/**
 * 既定の書体 (API・CLI と同じ登録の順と設定) と、読み込んだ書体 3 つを持つ組:
 *  Lob (Lobster の欧文の部分。欧文だけ)・Sym (Noto Sans Symbols 2。記号と ASCII)・Mono (Cousine。欧文・ギリシャ文字・矢印)
 */
async function setup() {
  const fonts = new FontManager();
  for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) await fonts.registerBuffer(spec.family, spec.weight ?? 400, cached(fontFileName(spec)), false);
  setupDefaultFonts(fonts);
  const table = new FontNameTable();
  const add = async (family: string, buf: ArrayBuffer) => {
    await fonts.registerBuffer(family, 400, buf, false);
    table.add('installed', [family], family);
  };
  await add('Lob', cached('Lobster-latin.woff2'));
  await add('Sym', cached(fontFileName(SYMBOL_SPEC)));
  await add('Mono', cached('Cousine-Regular.ttf'));
  const m = createFontMapping(fonts, table, { canvas: false });
  /** names の並びで、字 (列) ごとに選ばれる書体 */
  const pick = (names: string[], chars: string, opts: { bold?: boolean; lang?: string } = {}) => {
    const fam = m.mapHtmlFont(names, !!opts.bold, opts.lang);
    return [...chars].map((ch) => fonts.getForChar(fam, opts.bold ? 700 : 400, ch).family);
  };
  return { fonts, table, m, pick };
}

describe('font-family の並びを、字ごとに前から順に引く (CSS Fonts 4 §5.2)', () => {
  it('テストの書体が持つ字 (前提)', async () => {
    const { fonts } = await setup();
    const has = (family: string, chars: string) => [...chars].map((ch) => fonts.hasGlyph(fonts.get(family, 400), ch));
    expect(has('Lob', 'a ✈α字')).toEqual([true, true, false, false, false]);
    expect(has('Sym', 'a 1✈●α→字')).toEqual([true, true, true, true, true, false, false, false]);
    expect(has('Mono', 'a●α→✈字')).toEqual([true, true, true, true, false, false]);
    expect(has(SERIF, 'a 1●字✈')).toEqual([true, true, true, true, true, false]);
  });

  it('前にある既定の書体 (Noto Serif JP) が持つ字は、後ろの読み込んだ書体で組まれない (空白・数字・記号も)', async () => {
    const { pick } = await setup();
    // 既定の書体の名前は、総称と同じ和欧の組 (和文 Noto Serif JP・欧文 Tinos)。Sym は、その組が持たない字 (✈) だけ
    expect(pick(['Noto Serif JP', 'Sym', 'serif'], '字a1 #●✈')).toEqual([SERIF, 'Tinos', 'Tinos', 'Tinos', 'Tinos', SERIF, 'Sym']);
    // 総称が前にあるときも同じ
    expect(pick(['sans-serif', 'Sym'], '字a ●✈')).toEqual([SANS, 'Arimo', 'Arimo', SANS, 'Sym']);
    // 等幅の総称: 欧文 Cousine・和文 Noto Sans JP の組が先 (Cousine は、ここでは読み込んでいないので Noto Sans JP の字)
    expect(pick(['monospace', 'Sym'], '字✈')).toEqual([SANS, 'Sym']);
  });

  it('読み込んだ書体が 3 つ並ぶと、字ごとに順に引く。どれにも無い和文の字は、後ろの総称の書体', async () => {
    const { pick } = await setup();
    // a: Lob / ✈●: Lob に無く Sym / α→: Lob・Sym に無く Mono / 字: sans-serif の和文 (Noto Sans JP)
    expect(pick(['Lob', 'Sym', 'Mono', 'sans-serif'], 'a✈●α→字')).toEqual(['Lob', 'Sym', 'Sym', 'Mono', 'Mono', SANS]);
    // 順を入れ替えると、● は先にある Mono
    expect(pick(['Lob', 'Mono', 'Sym', 'serif'], 'a✈●α字')).toEqual(['Lob', 'Sym', 'Mono', 'Mono', SERIF]);
    // 2 つ: 2 つ目は「和文の書体」扱いにならない (2 つ目に無い和文の字は総称の書体)
    expect(pick(['Sym', 'Mono', 'sans-serif'], '✈α字あ')).toEqual(['Sym', 'Mono', SANS, SANS]);
  });

  it('総称が途中にあれば、その位置で引く (総称の組が持つ字は、後ろの読み込んだ書体で組まれない)', async () => {
    const { pick } = await setup();
    // α・●: Lob に無く、総称の組の和文の書体 (Noto Serif JP) が持つ → 後ろの Sym・Mono では組まない
    expect(pick(['Lob', 'serif', 'Sym', 'Mono'], 'a字α●✈')).toEqual(['Lob', SERIF, SERIF, SERIF, 'Sym']);
  });

  it('欧文の書体の名前 (Arial・Times New Roman・Courier New と、Arimo・Tinos・Cousine) は、その位置に欧文の代わりの書体を置く', async () => {
    const { pick, m, fonts } = await setup();
    // Arial (Arimo) が持つ欧文・記号は Arimo。和文は、後ろの読み込んだ書体に無いので総称の書体
    expect(pick(['Arial', 'Mono', 'sans-serif'], 'aα字✈')).toEqual(['Arimo', 'Arimo', SANS, 'Sym']);
    expect(pick(['Times New Roman', 'Sym', 'serif'], 'a✈字')).toEqual(['Tinos', 'Sym', SERIF]);
    expect(pick(['Tinos', 'Lob'], 'a字')).toEqual(['Tinos', SERIF]);
    // Courier New は等幅の書体 (Cousine) を読み込ませる。読み込むまでは飛ばし、読み込んだら使う
    expect(m.usesMono()).toBe(false);
    expect(pick(['Courier New', 'Lob', 'serif'], 'a')).toEqual(['Lob']);
    expect(m.usesMono()).toBe(true);
    await fonts.registerBuffer('Cousine', 400, cached('Cousine-Regular.ttf'), false);
    expect(pick(['Courier New', 'Lob', 'serif'], 'a字')).toEqual(['Cousine', SERIF]);
  });

  it('読み込んでいない書体の名前は飛ばす (名前に sans・gothic を含むだけの書体は、その位置の書体にしない)', async () => {
    const { pick } = await setup();
    expect(pick(['Fira Sans', 'Lob', 'Mono', 'serif'], 'aα')).toEqual(['Lob', 'Mono']);
    // 飛ばした名前は、並びに総称が無いときの最後の書体 (和文) の種類を決める (ゴシック系の名前 → Noto Sans JP)
    expect(pick(['Lob', 'Mono', 'Hiragino Kaku Gothic ProN'], '字')).toEqual([SANS]);
    expect(pick(['Lob', 'Mono', 'Hiragino Mincho ProN'], '字')).toEqual([SERIF]);
  });

  it('並びのどの書体も持たない字は、既定の書体、並びに無い読み込み済みの書体の順', async () => {
    const { pick } = await setup();
    // 字: 並び (Lob・Mono) に無い → 既定の書体 (総称が無いので明朝)。✈: 既定の書体にも無い → 並びに無い Sym
    expect(pick(['Lob', 'Mono'], 'a字✈')).toEqual(['Lob', SERIF, 'Sym']);
    // ●: 並びに無い Sym も持つが、並びの Mono が先
    expect(pick(['Lob', 'Mono'], '●')).toEqual(['Mono']);
  });

  it('欧文の文書 (lang が ja・zh・ko でない) の記号は、総称の位置で欧文の書体から', async () => {
    const { pick } = await setup();
    // ●: Lob に無い。総称 (serif) の組は、欧文の文書では記号を欧文の書体 (Tinos) で組む
    expect(pick(['Lob', 'Sym', 'serif'], 'a●字', { lang: 'en' })).toEqual(['Lob', 'Sym', SERIF]);
    expect(pick(['serif', 'Sym'], 'a●字✈', { lang: 'en' })).toEqual(['Tinos', 'Tinos', SERIF, 'Sym']);
    expect(pick(['serif', 'Sym'], '●', { lang: 'ja' })).toEqual([SERIF]);
  });

  it('太字: 総称の位置には、太字の総称の組 (欧文は欧文の書体の太字、和文は Noto Sans JP の太字)', async () => {
    const { pick, fonts, m } = await setup();
    expect(pick(['serif', 'Sym'], 'a字✈', { bold: true })).toEqual(['Tinos', SANS, 'Sym']);
    expect(fonts.getForChar(m.mapHtmlFont(['serif', 'Sym'], true), 700, 'a').weight).toBe(700);
  });

  it('クラスタ (基底の字 + 結合文字) は、並びの順で、並びの字をすべて持つ最初の書体 (§5.3)', async () => {
    const { fonts, m } = await setup();
    // a + U+0305 (結合上線): Lob・Sym は a だけ、Mono (Cousine) は両方を持つ。a + U+0302 (結合サーカムフレックス): Sym・Mono が両方を持つ
    const has = (family: string, ch: string) => fonts.hasGlyph(fonts.get(family, 400), ch);
    expect(['Lob', 'Sym', 'Mono'].map((f) => has(f, '\u0305'))).toEqual([false, false, true]);
    expect(['Lob', 'Sym', 'Mono'].map((f) => has(f, '\u0302'))).toEqual([false, true, true]);
    const fam = m.mapHtmlFont(['Lob', 'Sym', 'Mono', 'serif'], false);
    expect(fonts.getForChar(fam, 400, 'a').family).toBe('Lob');
    expect(fonts.getForCluster(fam, 400, 'a\u0305')?.family).toBe('Mono');
    // 並びをすべて持つ書体が 2 つあれば、並びの前にある方
    expect(fonts.getForCluster(fam, 400, 'a\u0302')?.family).toBe('Sym');
    expect(fonts.getForCluster(m.mapHtmlFont(['Lob', 'Mono', 'Sym', 'serif'], false), 400, 'a\u0302')?.family).toBe('Mono');
  });

  it('組の基本の書体 (行の基準に使う書体) は、並びの中の最初の総称・既定の書体の組の和文の書体 (読み込んだ書体 1 つ + 総称のときと同じ)', async () => {
    const { fonts, m } = await setup();
    expect(fonts.get(m.mapHtmlFont(['Lob', 'Sym', 'sans-serif'], false), 400).family).toBe(SANS);
    expect(fonts.get(m.mapHtmlFont(['Lob', 'sans-serif'], false), 400).family).toBe(SANS);
    expect(fonts.get(m.mapHtmlFont(['Noto Serif JP', 'Sym'], false), 400).family).toBe(SERIF);
  });

  it('@font-face の unicode-range の組 (範囲つきの書体の組) も、並びの位置で引く', async () => {
    const { fonts, m, pick } = await setup();
    const file = (name: string, cacheName: string) => ({ name, arrayBuffer: async () => cached(cacheName) });
    // R: a〜m は Cousine、記号は Noto Sans Symbols 2 (ほかの字は受け持たない)
    const css = `@font-face { font-family: R; src: url(c.ttf); unicode-range: U+61-6D }
      @font-face { font-family: R; src: url(s.ttf); unicode-range: U+2700-27BF }`;
    await m.loadFontFaces(css, [file('c.ttf', 'Cousine-Regular.ttf'), file('s.ttf', fontFileName(SYMBOL_SPEC))]);
    const got = pick(['serif', 'R'], 'a字✈');
    expect(got.slice(0, 2)).toEqual(['Tinos', SERIF]);
    expect(got[2]).toMatch(/^css:R#/);
    // 範囲の外の字 (z) は、R を飛ばして次の書体
    const got2 = pick(['R', 'Lob', 'serif'], 'az字');
    expect(got2[0]).toMatch(/^css:R#/);
    expect(got2.slice(1)).toEqual(['Lob', SERIF]);
    expect(fonts.has(m.mapHtmlFont(['R', 'Lob', 'serif'], false)!)).toBe(true);
  });
});

describe('font-family の並び: 今までと同じに組む指定', () => {
  it('読み込んだ書体が先頭に 1 つ + 総称: 今までの組 (先頭の書体が持つ字はその書体、ほかは総称の和文の書体)', async () => {
    const { m, pick, fonts } = await setup();
    expect(m.mapHtmlFont(['Lob', 'serif'], false)).toBe(`Lob+${SERIF}`);
    expect(m.mapHtmlFont(['Lob', 'sans-serif'], false)).toBe(`Lob+${SANS}`);
    expect(m.mapHtmlFont(['Lob'], false)).toBe(`Lob+${SERIF}`);
    expect(m.mapHtmlFont(['Lob', 'serif'], false, 'en')).toBe(`Lob+${SERIF}+Tinos`);
    // 後ろに既定の書体の名前・読み込んでいない名前があっても同じ
    expect(m.mapHtmlFont(['Lob', 'Noto Sans JP', 'sans-serif'], false)).toBe(`Lob+${SANS}`);
    expect(m.mapHtmlFont(['Unknown Font', 'Lob', 'Yu Mincho', 'serif'], false)).toBe(`Lob+${SERIF}`);
    expect(pick(['Lob', 'serif'], 'a字α')).toEqual(['Lob', SERIF, SERIF]);
    // 基本の書体は総称の和文の書体
    expect(fonts.get(`Lob+${SERIF}`, 400).family).toBe(SERIF);
  });

  it('総称・既定の書体の名前だけ: 今までの写し先 (和文 Noto・欧文 Tinos / Arimo)', async () => {
    const { m, pick } = await setup();
    expect(m.mapHtmlFont(['serif'], false)).toBe(SERIF);
    expect(m.mapHtmlFont(['sans-serif'], false)).toBe(SANS);
    expect(m.mapHtmlFont(['Noto Serif JP', 'serif'], false)).toBe(SERIF);
    expect(m.mapHtmlFont(['Arial', 'Noto Sans JP', 'sans-serif'], false)).toBe(SANS);
    expect(m.mapHtmlFont(['serif'], false, 'en')).toBe(`${SERIF}+Tinos`);
    expect(m.mapHtmlFont([], false)).toBeUndefined();
    expect(pick(['serif'], 'a字 ')).toEqual(['Tinos', SERIF, 'Tinos']);
  });
});

describe('font-family の並び: 覚えた結果', () => {
  it('同じ並びをもう 1 度割り当てても、書体の組を定義し直さない (字ごとの書体・行分けの覚えを消さない)', async () => {
    const { fonts, m } = await setup();
    for (const names of [['Noto Serif JP', 'Sym', 'serif'], ['Lob', 'Sym', 'Mono', 'sans-serif'], ['Lob', 'serif']]) {
      const fam = m.mapHtmlFont(names, false, 'en');
      const g = fonts.generation;
      const picked = fonts.getForChar(fam, 400, 'a');
      expect(m.mapHtmlFont(names, false, 'en')).toBe(fam);
      expect(fonts.generation).toBe(g);
      expect(fonts.getForChar(fam, 400, 'a')).toBe(picked);
    }
    // 定義が変われば、選び直す
    fonts.defineStack('X', SERIF, 'Lob');
    const g = fonts.generation;
    fonts.defineStack('X', SERIF, 'Mono');
    expect(fonts.generation).toBe(g + 1);
    expect(fonts.getForChar('X', 400, 'a').family).toBe('Mono');
  });
});

describe('font-family の並び: API から', () => {
  it('fonts で足した書体より前に既定の書体の名前があれば、既定の書体が持つ字はその書体で組む', async () => {
    const t = await createTypesetter({ loadFont: loadCachedFont, fonts: [{ name: 'Cousine-Regular.ttf', data: new Uint8Array(cached('Cousine-Regular.ttf')) }] });
    const families = async (html: string) => {
      const r = await t.typeset(html, { kind: 'html' });
      const got: string[] = [];
      walkAreaTree(r.areaTree, (a) => {
        if (a.type === 'glyph' && /[字a]/.test((a as GlyphArea).text)) got.push(`${(a as GlyphArea).text}:${(a as GlyphArea).fontFamily}`);
      });
      return got;
    };
    expect(await families('<p style="font-family: \'Noto Serif JP\', Cousine, serif">字a</p>')).toEqual([`字:${SERIF}`, 'a:Tinos']);
    // 読み込んだ書体が先頭なら、今までどおり、その書体が持つ字はその書体
    expect(await families('<p style="font-family: Cousine, \'Noto Serif JP\', serif">字a</p>')).toEqual([`字:${SERIF}`, 'a:Cousine']);
  });
});
