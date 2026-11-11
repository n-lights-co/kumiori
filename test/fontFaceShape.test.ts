/**
 * 傾き・幅の違う書体の登録と選び方 (NC-25・NC-27)。
 *  - CSS Fonts 4 §5.2 (Matching font styles): ファミリーの中の書体を、幅 (font-width / font-stretch) → 傾き (font-style) → 太さの順に絞る。
 *    幅は、求める幅が 100% 以下なら狭い方 → 広い方。italic は 斜体 → 斜め → 立体。ファミリー名は、入っている書体の別名を含めてよい
 *  - §2.3 の表: 幅の語と百分率 (OpenType の OS/2 の usWidthClass 1〜9 と同じ並び)
 *  - §5.2・XSL 1.1 §7.9.2: font-family の並びの書体を、字ごとに、順に試す
 * 書体は、既定の書体 (.cache/fonts) の写しの、name の表と OS/2 の値を書き換えて作る (斜体の書体・幅の狭い書体のファイルは、リポジトリに入れない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FontManager, fontFileStyle, matchWidth } from '../src/fontManager';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, createFontMapping, setupDefaultFonts } from '../src/fontMapping';
import { splitFontFile } from '../src/fontLoader';
import { createTypesetter, walkAreaTree, type GlyphArea } from '../src/index';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { withTables } from './colorFontBuilder';
import { ensureFonts, extraTestFont, fontDir, fontFileName, loadCachedFont } from './helpers';

const read = (file: string): ArrayBuffer => {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const cached = (name: string) => read(path.join(fontDir, name));

/** name の表 (format 0。Windows・Unicode BMP・英語 (米国) の記録だけ)。ids: nameID → 文字列 */
function nameTable(ids: Record<number, string>): Uint8Array {
  const recs = Object.entries(ids).map(([id, s]) => ({ id: Number(id), bytes: Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255])) }));
  const head = 6 + 12 * recs.length;
  const out = new Uint8Array(head + recs.reduce((n, r) => n + r.bytes.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, recs.length);
  v.setUint16(4, head);
  let at = 0;
  recs.forEach((r, k) => {
    const o = 6 + 12 * k;
    v.setUint16(o, 3);
    v.setUint16(o + 2, 1);
    v.setUint16(o + 4, 0x409);
    v.setUint16(o + 6, r.id);
    v.setUint16(o + 8, r.bytes.length);
    v.setUint16(o + 10, at);
    out.set(r.bytes, head + at);
    at += r.bytes.length;
  });
  return out;
}

/**
 * 書体の写しを作る: name の表を names に替え、OS/2 の太さ (usWeightClass)・幅 (usWidthClass)・傾き (fsSelection の ITALIC = ビット 0、
 * OBLIQUE = ビット 9。REGULAR = ビット 6 は消す) を書き換える
 */
function fake(src: ArrayBuffer, names: Record<number, string>, os2: { weight?: number; widthClass?: number; italic?: boolean; oblique?: boolean } = {}): ArrayBuffer {
  const buf = withTables(src, { name: nameTable(names) });
  const v = new DataView(buf);
  for (let i = 0; i < v.getUint16(4); i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3)) !== 'OS/2') continue;
    const at = v.getUint32(rec + 8);
    if (os2.weight !== undefined) v.setUint16(at + 4, os2.weight);
    if (os2.widthClass !== undefined) v.setUint16(at + 6, os2.widthClass);
    if (os2.italic || os2.oblique) v.setUint16(at + 62, (v.getUint16(at + 62) & ~0x40) | (os2.italic ? 1 : 0) | (os2.oblique ? 0x200 : 0));
    return buf;
  }
  throw new Error('OS/2 の表が無い');
}

/**
 * ファミリー Testa (Arial と Arial Narrow の形をまねる):
 *  - R・B: 立体の 400・700 (Arimo の Regular・Bold)
 *  - I: 斜体の 400 (中身は Tinos の Regular。字の送りが R と違う)
 *  - N・NI: 幅が condensed (usWidthClass 3) の立体・斜体の 400。nameID 16 (ファミリー名) は Testa、nameID 1 は Testa Narrow
 *    (中身は Cousine の Regular・Bold)
 */
const testa = () => ({
  R: fake(cached('Arimo-Regular.ttf'), { 1: 'Testa', 2: 'Regular', 4: 'Testa', 6: 'Testa-Regular' }),
  B: fake(cached('Arimo-Bold.ttf'), { 1: 'Testa', 2: 'Bold', 4: 'Testa Bold', 6: 'Testa-Bold' }),
  I: fake(cached('Tinos-Regular.ttf'), { 1: 'Testa', 2: 'Italic', 4: 'Testa Italic', 6: 'Testa-Italic' }, { italic: true }),
  N: fake(cached('Cousine-Regular.ttf'), { 1: 'Testa Narrow', 2: 'Regular', 4: 'Testa Narrow', 6: 'TestaNarrow', 16: 'Testa', 17: 'Narrow' }, { widthClass: 3 }),
  NI: fake(cached('Cousine-Bold.ttf'), { 1: 'Testa Narrow', 2: 'Italic', 4: 'Testa Narrow Italic', 6: 'TestaNarrow-Italic', 16: 'Testa', 17: 'Narrow Italic' }, { widthClass: 3, italic: true, weight: 400 }),
});

beforeAll(async () => {
  await ensureFonts([...FONT_SPECS, ...LATIN_SPECS]);
  await extraTestFont('Lobster-latin.woff2');
  await extraTestFont('Anybody-wdth-wght-5bb2873.ttf');
}, 300_000);

const loadFont = async (spec: Parameters<typeof loadCachedFont>[0]) => (await loadCachedFont(spec))!;

/** 組んだ結果の、字ごとの「書体名@太さ」(+ 傾けて描く・太らせて描く・字の送り) */
async function glyphsOf(text: string, kind: 'html' | 'fo', setup: Parameters<typeof createTypesetter>[0], options: Record<string, unknown> = {}) {
  const t = await createTypesetter({ loadFont, ...setup });
  const r = await t.typeset(text, { kind, ...options });
  const out: Array<{ ch: string; font: string; slant: boolean; bold: boolean; advance: number }> = [];
  walkAreaTree(r.areaTree, (a) => {
    if (a.type !== 'glyph') return;
    const g = a as GlyphArea;
    if (/\s/.test(g.text)) return;
    out.push({ ch: g.text, font: `${g.fontFamily}@${g.fontWeight}`, slant: !!g.italic, bold: !!g.fakeBold, advance: g.advance });
  });
  return { glyphs: out, of: (ch: string) => out.find((g) => g.ch === ch)!, warnings: r.warnings };
}

describe('書体のファイルの傾き・幅を読む (fontFileStyle・splitFontFile)', () => {
  it('fsSelection の ITALIC・OBLIQUE と、usWidthClass を読む', () => {
    const f = testa();
    expect(fontFileStyle(f.R)).toMatchObject({ italic: false });
    expect(fontFileStyle(f.R).style).toBeUndefined();
    expect(fontFileStyle(f.R).width).toBeUndefined();
    expect(fontFileStyle(f.I)).toMatchObject({ italic: true, style: 'italic' });
    expect(fontFileStyle(f.N)).toMatchObject({ width: 75 });
    expect(fontFileStyle(f.NI)).toMatchObject({ style: 'italic', width: 75, weight: 400 });
    // OBLIQUE の印 (ビット 9) があれば、斜めの書体 (ITALIC も立っていてよい)
    expect(fontFileStyle(fake(cached('Arimo-Regular.ttf'), { 1: 'O' }, { italic: true, oblique: true })).style).toBe('oblique');
    // usWidthClass 1〜9 → 50・62.5・75・87.5・100・112.5・125・150・200 (CSS Fonts 4 §2.3 の表)
    expect([1, 2, 4, 6, 7, 8, 9].map((c) => fontFileStyle(fake(cached('Arimo-Regular.ttf'), { 1: 'W' }, { widthClass: c })).width)).toEqual([50, 62.5, 87.5, 112.5, 125, 150, 200]);
  });

  it('splitFontFile は、斜体の書体も取り出す (傾きを付けて)', () => {
    const f = testa();
    expect(splitFontFile(f.I).map((u) => [u.family, u.weight, u.style])).toEqual([['Testa', 400, 'italic']]);
    expect(splitFontFile(f.R).map((u) => [u.family, u.weight, u.style])).toEqual([['Testa', 400, undefined]]);
  });
});

describe('幅の照合 (CSS Fonts 4 §5.2 の font-width)', () => {
  it('求める幅を含む範囲があれば、その幅。無ければ、100% 以下は狭い方 → 広い方、100% を超えれば広い方 → 狭い方', () => {
    const r = (...ws: number[]) => ws.map((w) => [w, w] as const);
    expect(matchWidth(r(75, 100), 100)).toBe(100);
    expect(matchWidth(r(75, 100), 75)).toBe(75);
    expect(matchWidth(r(75, 100), 87.5)).toBe(75);
    expect(matchWidth(r(75, 100), 50)).toBe(75);
    expect(matchWidth(r(75, 100, 125), 112.5)).toBe(125);
    expect(matchWidth(r(75, 100), 150)).toBe(100);
    expect(matchWidth(r(75), 100)).toBe(75);
    expect(matchWidth(r(125), 100)).toBe(125);
    // 範囲を持つ書体 (可変フォント): 範囲の中なら求める幅、外なら近い端
    expect(matchWidth([[50, 150]], 80)).toBe(80);
    expect(matchWidth([[50, 90], [100, 100]], 95)).toBe(90);
  });
});

describe('FontManager: 傾き・幅の違う書体を別に登録し、幅 → 傾き → 太さの順に選ぶ', () => {
  async function manager(order: Array<'R' | 'B' | 'I' | 'N' | 'NI'>) {
    const f = testa();
    const fonts = new FontManager();
    const reg = {
      R: () => fonts.registerBuffer('Testa', 400, f.R, false),
      B: () => fonts.registerBuffer('Testa', 700, f.B, false),
      I: () => fonts.registerBuffer('Testa', 400, f.I, false, undefined, { style: 'italic' }),
      N: () => fonts.registerBuffer('Testa', 400, f.N, false, undefined, { width: 75 }),
      NI: () => fonts.registerBuffer('Testa', 400, f.NI, false, undefined, { width: 75, style: 'italic' }),
    };
    for (const k of order) await reg[k]();
    return fonts;
  }
  const ps = (fonts: FontManager, family: string, weight = 400) => fonts.get(family, weight).postscriptName;

  it('渡す順によらず、指定の無いとき (標準の幅・立体) は、標準の幅の立体', async () => {
    for (const order of [['R', 'B', 'I', 'N', 'NI'], ['NI', 'N', 'I', 'B', 'R'], ['N', 'R', 'NI', 'I', 'B']] as const) {
      const fonts = await manager([...order]);
      expect(ps(fonts, 'Testa')).toBe('Testa-Regular');
      expect(ps(fonts, 'Testa', 700)).toBe('Testa-Bold');
      expect(ps(fonts, 'Testa{ital=1}')).toBe('Testa-Italic');
      expect(ps(fonts, 'Testa{wdth=75}')).toBe('TestaNarrow');
      expect(ps(fonts, 'Testa{wdth=75,ital=1}')).toBe('TestaNarrow-Italic');
    }
  });

  it('幅を先に照合する: 幅 75 の太字の指定は、幅 75 の書体の中の最も近い太さ (標準の幅の太字にしない)', async () => {
    const fonts = await manager(['R', 'B', 'I', 'N', 'NI']);
    expect(ps(fonts, 'Testa{wdth=75}', 700)).toBe('TestaNarrow');
    // 62.5 (extra-condensed) は、狭い方に無いので広い方の最も近い幅 = 75。112.5 は、広い方に無いので狭い方の最も近い幅 = 100
    expect(ps(fonts, 'Testa{wdth=62.5}')).toBe('TestaNarrow');
    expect(ps(fonts, 'Testa{wdth=112.5}')).toBe('Testa-Regular');
    // 87.5 (semi-condensed) は、狭い方 (75) が先
    expect(ps(fonts, 'Testa{wdth=87.5}')).toBe('TestaNarrow');
  });

  it('傾きを太さより先に照合する: 斜体の太字の指定は、斜体の書体 (太さ 400) で、立体の太字にしない', async () => {
    const fonts = await manager(['R', 'B', 'I']);
    expect(ps(fonts, 'Testa{ital=1}', 700)).toBe('Testa-Italic');
    // 斜めの指定 (oblique 14deg) は、斜めの書体が無ければ斜体の書体。11deg より小さい角度は、立体が先
    expect(ps(fonts, 'Testa{slnt=14}')).toBe('Testa-Italic');
    expect(ps(fonts, 'Testa{slnt=5}')).toBe('Testa-Regular');
  });

  it('斜体の書体が無いファミリーは、立体 (傾けて描くのは組版の側)。斜体だけのファミリーは、立体の指定でも斜体', async () => {
    expect(ps(await manager(['R', 'B']), 'Testa{ital=1}')).toBe('Testa-Regular');
    expect(ps(await manager(['I']), 'Testa')).toBe('Testa-Italic');
    expect(ps(await manager(['N']), 'Testa')).toBe('TestaNarrow');
  });

  it('書体の名前 (family) と太さで引き直すと、同じ書体になる (組んだ結果の書体名から、描くときに引く)', async () => {
    const fonts = await manager(['N', 'NI', 'I', 'R', 'B']);
    for (const f of fonts.all()) expect(fonts.get(f.family, f.weight)).toBe(f);
    expect(fonts.all().map((f) => f.family).sort()).toEqual(['Testa', 'Testa', 'Testa{ital=1}', 'Testa{wdth=75,ital=1}', 'Testa{wdth=75}']);
    // 傾き・幅を持つ書体があるときは、その指定を書体の名前の印で渡してもらう
    expect([...fonts.variationAxes()!].sort()).toEqual(['ital', 'wdth']);
    expect((await manager(['R', 'B'])).variationAxes()).toBeUndefined();
  });

  it('斜体の face の可変フォントの実体も、名前と太さで引き直すと同じ実体になる', async () => {
    // 立体は静的な書体 (Arimo)、斜体の face は可変フォント (Anybody: 幅 50〜150・太さ 100〜900。傾きの軸は無い)
    const fonts = new FontManager();
    await fonts.registerBuffer('V', 400, cached('Arimo-Regular.ttf'), false);
    await fonts.registerBuffer('V', 400, read(await extraTestFont('Anybody-wdth-wght-5bb2873.ttf')), false, { weight: [100, 900], width: [50, 150] }, { style: 'italic' });
    expect(fonts.get('V', 700).postscriptName).toBe('Arimo-Regular');
    const bold = fonts.get('V{ital=1}', 700);
    expect(bold.instanceOf?.coords).toEqual({ wght: 700, wdth: 100 });
    expect(bold.instanceOf?.master.style).toBe('italic');
    expect(fonts.get(bold.family, bold.weight)).toBe(bold);
    // 幅 75 は、その幅を持つ書体 (可変フォント) だけが残る (幅を先に照合する): 立体の指定でも、斜体の face の実体
    for (const name of ['V{wdth=75,ital=1}', 'V{wdth=75}']) {
      const narrow = fonts.get(name, 300);
      expect(narrow.instanceOf?.coords).toEqual({ wght: 300, wdth: 75 });
      expect(fonts.get(narrow.family, narrow.weight)).toBe(narrow);
    }
  });

  it('別名 (その幅の書体だけを指す名前) で引くと、その書体の中だけで照合する', async () => {
    const fonts = await manager(['R', 'N', 'NI', 'I']);
    for (const f of fonts.all()) if (f.width === 75) fonts.addFamilyAlias('Testa Narrow', f);
    expect(fonts.has('Testa Narrow')).toBe(true);
    expect(ps(fonts, 'Testa Narrow')).toBe('TestaNarrow');
    expect(ps(fonts, 'Testa Narrow{ital=1}')).toBe('TestaNarrow-Italic');
    // 別名の書体は、標準の幅の指定でも、その幅の書体
    expect(ps(fonts, 'Testa Narrow{wdth=125}')).toBe('TestaNarrow');
  });

  it('どの書体も持たない字を探すとき、立体の指定に、先に登録した斜体・幅の狭い書体を使わない', async () => {
    const f = testa();
    const fonts = new FontManager();
    await fonts.registerBuffer('Noto Serif JP', 400, cached('NotoSerifJP-Regular.ttf'), false);
    await fonts.registerBuffer('Testa', 400, f.NI, false, undefined, { width: 75, style: 'italic' });
    await fonts.registerBuffer('Testa', 400, f.I, false, undefined, { style: 'italic' });
    await fonts.registerBuffer('Testa', 400, f.R, false);
    // Noto Serif JP が持たない字 (ヘブライ文字の א は、Arimo・Tinos・Cousine が持つ)
    expect(fonts.getForChar('Noto Serif JP', 400, 'א').postscriptName).toBe('Testa-Regular');
    expect(fonts.getForChar('Noto Serif JP{ital=1}', 400, 'א').postscriptName).toBe('Testa-Italic');
  });
});

describe('公開の API の fonts: 斜体の書体と、幅の違う書体 (HTML)', () => {
  const fontsOf = (keys: Array<keyof ReturnType<typeof testa>>) => {
    const f = testa();
    return keys.map((k) => ({ name: `${k}.ttf`, data: new Uint8Array(f[k]) }));
  };
  const html = `<!DOCTYPE html><html lang="en"><body style="font-family: Testa">
    <p>1</p><p style="font-stretch: condensed">2</p><p style='font-family: "Testa Narrow"'>3</p>
    <p style="font-style: italic">4</p><p style="font-style: italic; font-weight: bold">5</p>
    <p style='font-family: "Testa Narrow"; font-style: italic'>6</p><p style="font-weight: bold">7</p>
    <p style="font-family: sans-serif">8</p><p style="font-stretch: expanded">9</p></body></html>`;

  it('渡す順によらず: 指定なしは標準の幅、font-stretch: condensed と名指し (nameID 1 の名前) は幅の狭い書体', async () => {
    for (const keys of [['R', 'B', 'I', 'N', 'NI'], ['NI', 'N', 'I', 'B', 'R']] as const) {
      const { of } = await glyphsOf(html, 'html', { fonts: fontsOf([...keys]) });
      expect(of('1').font).toBe('Testa@400');
      expect(of('2').font).toBe('Testa{wdth=75}@400');
      expect(of('3').font).toBe('Testa{wdth=75}@400');
      expect(of('7').font).toBe('Testa@700');
      // 総称の書体は、足した書体に替わらない
      expect(of('8').font).toBe('Arimo@400');
      // 幅の狭い書体で組んだ字は、字形を拡縮しない (書体そのものの幅)。2 と 3 は同じ送り (N の中身は Cousine: 1229/2048)
      expect(of('2').advance).toBeCloseTo(of('3').advance, 6);
      expect(of('2').advance / of('1').advance).toBeCloseTo(1229 / 1139, 3);
    }
  });

  it('斜体の指定は、斜体の書体で組み、傾けて描かない。字の送りは斜体の書体のもの', async () => {
    const { of } = await glyphsOf(html, 'html', { fonts: fontsOf(['R', 'B', 'I', 'N', 'NI']) });
    expect(of('4')).toMatchObject({ font: 'Testa{ital=1}@400', slant: false, bold: false });
    // I の中身は Tinos (数字の送り 1024/2048)、R は Arimo (数字の送り 1139/2048)
    expect(of('4').advance / of('1').advance).toBeCloseTo(1024 / 1139, 3);
    // 斜体の太字は、斜体の書体 (太さ 400) を太らせて描く (傾きを太さより先に照合する。§5.2)
    expect(of('5')).toMatchObject({ font: 'Testa{ital=1}@400', slant: false, bold: true });
    expect(of('6')).toMatchObject({ font: 'Testa{wdth=75,ital=1}@400', slant: false });
  });

  it('斜体の書体が無ければ、立体を傾けて描く (今までと同じ)。広い幅の書体が無ければ、字形を拡縮する (今までと同じ)', async () => {
    const { of } = await glyphsOf(html, 'html', { fonts: fontsOf(['R', 'B']) });
    expect(of('4')).toMatchObject({ font: 'Testa@400', slant: true });
    expect(of('5')).toMatchObject({ font: 'Testa@700', slant: true, bold: false });
    expect(of('2').font).toBe('Testa@400');
    expect(of('2').advance / of('1').advance).toBeCloseTo(0.75, 6);
    expect(of('9').advance / of('1').advance).toBeCloseTo(1.25, 6);
  });

  it('幅の狭い書体だけを渡したとき: ファミリー名 (nameID 16) でも、元の名前 (nameID 1) でも、その書体', async () => {
    const { of } = await glyphsOf(html, 'html', { fonts: fontsOf(['N']) });
    expect(of('1').font).toBe('Testa{wdth=75}@400');
    expect(of('3').font).toBe('Testa{wdth=75}@400');
    expect(of('8').font).toBe('Arimo@400');
  });

  it('PDF にも、斜体の書体・幅の狭い書体が埋め込まれる', async () => {
    const t = await createTypesetter({ loadFont, fonts: fontsOf(['R', 'I', 'N']) });
    const r = await t.typeset(html, { kind: 'html' });
    const pdf = await PDFDocument.load(await r.toPdf());
    const names = new Set<string>();
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      const base = obj instanceof PDFDict ? obj.get(PDFName.of('BaseFont')) : undefined;
      if (base instanceof PDFName) names.add(base.decodeText().replace(/^[A-Z]{6}\+/, ''));
    }
    for (const name of ['Testa-Regular', 'Testa-Italic', 'TestaNarrow']) expect(names).toContain(name);
  });
});

describe('公開の API の fonts と files: XSL-FO の font-style・font-stretch', () => {
  const fo = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
    <fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt">
    <fo:layout-master-set><fo:simple-page-master master-name="p" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
    <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
  const body = `<fo:block font-family="Testa">a</fo:block><fo:block font-family="Testa" font-stretch="condensed">b</fo:block>
    <fo:block font-family="Testa Narrow">c</fo:block><fo:block font-family="Testa" font-style="italic">d</fo:block>
    <fo:block font-family="Testa" font-style="oblique">e</fo:block>`;

  it('fonts で足した書体: font-stretch・font-style・名指しで選ぶ (XSL 1.1 §7.9.5・§7.9.7)', async () => {
    const f = testa();
    for (const compat of ['spec', 'antenna'] as const) {
      const { of } = await glyphsOf(fo(body), 'fo', { fonts: (['NI', 'N', 'I', 'R'] as const).map((k) => ({ name: `${k}.ttf`, data: new Uint8Array(f[k]) })) }, { compat });
      expect(of('a').font).toBe('Testa@400');
      expect(of('b').font).toBe('Testa{wdth=75}@400');
      expect(of('c').font).toBe('Testa{wdth=75}@400');
      expect(of('b').advance).toBeCloseTo(of('c').advance, 6);
      expect(of('d')).toMatchObject({ font: 'Testa{ital=1}@400', slant: false });
      // oblique は、斜めの書体が無ければ斜体の書体 (§7.9.7 は italic に oblique を許す。CSS Fonts 4 §5.2 は oblique に italic も許す)
      expect(of('e')).toMatchObject({ font: 'Testa{ital=1}@400', slant: false });
    }
  });

  it('斜体の書体・幅の狭い書体を足しても、そのファミリーを使わない字の組み方は変わらない (互換モードの行の高さも)', async () => {
    // 和文と欧文の混じるブロックの中の斜体・長体の字 (総称の書体。足した書体のファミリーは使わない)
    const mixed = fo(`<fo:block font-family="serif" font-size="12pt">日本語の字 <fo:inline font-style="italic">Antenna House</fo:inline> と <fo:inline font-stretch="condensed">narrow</fo:inline> の字</fo:block>
      <fo:block font-family="serif">次の行 next line</fo:block>`);
    const f = testa();
    const tree = async (keys: Array<keyof ReturnType<typeof testa>>, compat: 'spec' | 'antenna') => {
      const t = await createTypesetter({ loadFont, fonts: keys.map((k) => ({ name: `${k}.ttf`, data: new Uint8Array(f[k]) })) });
      return JSON.stringify((await t.typeset(mixed, { kind: 'fo', compat })).areaTree);
    };
    for (const compat of ['spec', 'antenna'] as const) expect(await tree(['R', 'I', 'N', 'NI'], compat)).toBe(await tree(['R'], compat));
  });

  it('文書と一緒に渡した書体 (files): 斜体の書体を font-style: italic に使う', async () => {
    const f = testa();
    const files = [
      { name: 'r.ttf', data: new Uint8Array(f.R) },
      { name: 'i.ttf', data: new Uint8Array(f.I) },
    ];
    const { of } = await glyphsOf(fo(body), 'fo', {}, { files });
    expect(of('a')).toMatchObject({ font: 'Testa@400', slant: false });
    expect(of('d')).toMatchObject({ font: 'Testa{ital=1}@400', slant: false });
    // 斜体の書体を渡さなければ、立体を傾けて描く
    const plain = await glyphsOf(fo(body), 'fo', {}, { files: files.slice(0, 1) });
    expect(plain.of('d')).toMatchObject({ font: 'Testa@400', slant: true });
  });
});

describe('@font-face の斜体・幅の face (CSS Fonts 4 §4.4・§5.2)', () => {
  async function setup() {
    const fonts = new FontManager();
    for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) await fonts.registerBuffer(spec.family, spec.weight ?? 400, cached(fontFileName(spec)), false);
    setupDefaultFonts(fonts);
    const m = createFontMapping(fonts, new FontNameTable(), { canvas: false });
    /** names の並びと傾き・幅の印で、字ごとに選ばれる書体の PostScript 名 */
    const pick = (names: string[], chars: string, mark = '', weight = 400) => {
      const fam = m.mapHtmlFont(names, weight >= 600)! + mark;
      return [...chars].map((ch) => fonts.getForChar(fam, weight, ch).postscriptName);
    };
    return { fonts, m, pick };
  }
  const file = (name: string, buf: () => ArrayBuffer) => ({ name, arrayBuffer: async () => buf() });
  const files = () => [file('r.ttf', () => cached('Arimo-Regular.ttf')), file('i.ttf', () => cached('Tinos-Regular.ttf')), file('b.ttf', () => cached('Arimo-Bold.ttf')), file('n.ttf', () => cached('Cousine-Regular.ttf')), file('l.woff2', () => cached('Lobster-latin.woff2'))];

  it('font-style: italic の face は、斜体の指定の字に使う (立体の指定の字には使わない)', async () => {
    const s = await setup();
    await s.m.loadFontFaces(
      `@font-face { font-family: F; src: url(r.ttf) }
       @font-face { font-family: F; src: url(i.ttf); font-style: italic }
       @font-face { font-family: F; src: url(b.ttf); font-weight: bold }`,
      files(),
    );
    expect(s.pick(['F', 'serif'], 'a')).toEqual(['Arimo-Regular']);
    expect(s.pick(['F', 'serif'], 'a', '{ital=1}')).toEqual(['Tinos-Regular']);
    // 斜体の太字: 傾きを先に照合するので、斜体の face (太さ 400)
    expect(s.pick(['F', 'serif'], 'a', '{ital=1}', 700)).toEqual(['Tinos-Regular']);
    expect(s.pick(['F', 'serif'], 'a', '', 700)).toEqual(['Arimo-Bold']);
  });

  it('斜体の face だけのファミリーは、立体の指定の字にも、その face を使う (§5.2: normal は 立体 → 斜め → 斜体)', async () => {
    const s = await setup();
    await s.m.loadFontFaces('@font-face { font-family: F; src: url(i.ttf); font-style: italic }', files());
    expect(s.pick(['F', 'serif'], 'a')).toEqual(['Tinos-Regular']);
    expect(s.fonts.getForChar(s.m.mapHtmlFont(['F', 'serif'], false), 400, 'a').style).toBe('italic');
  });

  it('font-style: oblique の face は斜めの書体: oblique の指定で先に選び、italic の指定では斜体の face の次', async () => {
    const s = await setup();
    await s.m.loadFontFaces(
      `@font-face { font-family: F; src: url(r.ttf) }
       @font-face { font-family: F; src: url(i.ttf); font-style: italic }
       @font-face { font-family: F; src: url(n.ttf); font-style: oblique }`,
      files(),
    );
    expect(s.pick(['F', 'serif'], 'a', '{ital=1}')).toEqual(['Tinos-Regular']);
    expect(s.pick(['F', 'serif'], 'a', '{slnt=14}')).toEqual(['Cousine-Regular']);
    expect(s.pick(['F', 'serif'], 'a')).toEqual(['Arimo-Regular']);
  });

  it('font-stretch (font-width) の記述子のある face は、幅の違う書体: font-stretch の指定で選ぶ', async () => {
    const s = await setup();
    await s.m.loadFontFaces(
      `@font-face { font-family: F; src: url(r.ttf) }
       @font-face { font-family: F; src: url(n.ttf); font-stretch: condensed }`,
      files(),
    );
    expect(s.pick(['F', 'serif'], 'a')).toEqual(['Arimo-Regular']);
    expect(s.pick(['F', 'serif'], 'a', '{wdth=75}')).toEqual(['Cousine-Regular']);
    expect(s.pick(['F', 'serif'], 'a', '{wdth=125}')).toEqual(['Arimo-Regular']);
  });

  it('記述子の組が同じ斜体の face を並べたとき: 斜体の指定の字だけ、後の定義から調べる', async () => {
    const s = await setup();
    await s.m.loadFontFaces(
      `@font-face { font-family: F; src: url(r.ttf) }
       @font-face { font-family: F; src: url(i.ttf); font-style: italic }
       @font-face { font-family: F; src: url(l.woff2); font-style: italic }`,
      files(),
    );
    // 斜体: 後の定義 (Lobster) が持つ字は Lobster、持たない字 (α) は先の定義 (Tinos)。立体の字には、どちらも使わない
    expect(s.pick(['F', 'serif'], 'aα', '{ital=1}')).toEqual(['Lobster-Regular', 'Tinos-Regular']);
    expect(s.pick(['F', 'serif'], 'aα')).toEqual(['Arimo-Regular', 'Arimo-Regular']);
  });

  it('標準: font-style の記述子の無い face は、斜体のファイルでも立体の face (§4.4 の auto)。--style ah: 書体のファイルの傾きで登録する', async () => {
    const italicFile = () => fake(cached('Tinos-Regular.ttf'), { 1: 'X', 2: 'Italic', 6: 'X-Italic' }, { italic: true });
    const css = '@font-face { font-family: F; src: url(r.ttf) } @font-face { font-family: F; src: url(x.ttf) }';
    const std = await setup();
    await std.m.loadFontFaces(css, [...files(), file('x.ttf', italicFile)]);
    // 標準: 記述子の組が同じ 2 つの face (どちらも立体・400)。後の定義から
    expect(std.pick(['F', 'serif'], 'a')).toEqual(['X-Italic']);
    expect(std.pick(['F', 'serif'], 'a', '{ital=1}')).toEqual(['X-Italic']);
    expect(std.fonts.getForChar(std.m.mapHtmlFont(['F', 'serif'], false), 400, 'a').style).toBeUndefined();
    const ah = await setup();
    await ah.m.loadFontFaces(css, [...files(), file('x.ttf', italicFile)], { ahFaceWeight: true });
    expect(ah.pick(['F', 'serif'], 'a')).toEqual(['Arimo-Regular']);
    expect(ah.pick(['F', 'serif'], 'a', '{ital=1}')).toEqual(['X-Italic']);
    expect(ah.fonts.getForChar(ah.m.mapHtmlFont(['F', 'serif'], false) + '{ital=1}', 400, 'a').style).toBe('italic');
  });

  it('公開の API: 斜体の @font-face のある文書は、斜体の字を斜体の書体で組み、傾けて描かない', async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><style>
      @font-face { font-family: F; src: url(r.ttf) }
      @font-face { font-family: F; src: url(i.ttf); font-style: italic }
      p { font-family: F, serif; margin: 0 }</style></head><body><p>a</p><p><em>b</em></p><p style="font-family: serif"><em>c</em></p></body></html>`;
    const data = [
      { name: 'r.ttf', data: new Uint8Array(cached('Arimo-Regular.ttf')) },
      { name: 'i.ttf', data: new Uint8Array(cached('Tinos-Regular.ttf')) },
    ];
    const { of } = await glyphsOf(html, 'html', {}, { files: data });
    expect(of('a')).toMatchObject({ font: 'css:F@400', slant: false });
    expect(of('b')).toMatchObject({ font: 'css:F{ital=1}@400', slant: false });
    // 斜体の書体の無いファミリー (既定の書体) は、立体を傾けて描く
    expect(of('c')).toMatchObject({ font: 'Tinos@400', slant: true });
    // 斜体の face を書かなければ、今までと同じ (立体を傾ける)
    const plain = await glyphsOf(html.replace(/@font-face \{ font-family: F; src: url\(i\.ttf\)[^}]*\}/, ''), 'html', {}, { files: data });
    expect(plain.of('b')).toMatchObject({ font: 'css:F@400', slant: true });
  });
});

describe('font-family の並びの 2 番目以降の書体を、字ごとに見る (XSL 1.1 §7.9.2・CSS Fonts 4 §5.2)', () => {
  // 欧文の書体 Testa (和文の字を持たない) と、和文の字を持つ書体 Kana (中身は Noto Sans JP の太字。既定の和文の書体と見分けられる名前にする)
  const fontsOf = () => {
    const f = testa();
    return [
      { name: 'r.ttf', data: new Uint8Array(f.R) },
      { name: 'k.ttf', data: new Uint8Array(fake(cached('NotoSansJP-Bold.ttf'), { 1: 'Kana', 2: 'Regular', 4: 'Kana', 6: 'Kana-Regular' }, { weight: 400 })) },
    ];
  };
  const fo = (family: string) => `<?xml version="1.0" encoding="UTF-8"?>
    <fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt">
    <fo:layout-master-set><fo:simple-page-master master-name="p" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
    <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="${family}">a字</fo:block></fo:flow></fo:page-sequence></fo:root>`;

  it('XSL-FO: 先頭の書体が持たない字 (和文) は、並びの次の読み込んだ書体 (既定の和文の書体にしない)', async () => {
    for (const compat of ['spec', 'antenna'] as const) {
      const { of } = await glyphsOf(fo('Testa, Kana'), 'fo', { fonts: fontsOf() }, { compat });
      expect(of('a').font).toBe('Testa@400');
      expect(of('字').font).toBe('Kana@400');
    }
  });

  it('XSL-FO: 並びの途中の総称は、その位置で使う (総称の後ろの書体へは進まない字)', async () => {
    // serif (既定の明朝 + 欧文の組) が 字 を持つので、その後ろの Kana は使わない
    const mid = await glyphsOf(fo('Testa, serif, Kana'), 'fo', { fonts: fontsOf() });
    expect(mid.of('a').font).toBe('Testa@400');
    expect(mid.of('字').font).toBe('Noto Serif JP@400');
    // 読み込んでいない名前は飛ばす
    const skip = await glyphsOf(fo('Nonexistent, Testa, Kana'), 'fo', { fonts: fontsOf() });
    expect(skip.of('a').font).toBe('Testa@400');
    expect(skip.of('字').font).toBe('Kana@400');
  });

  it('XSL-FO: 読み込んだ書体が 1 つだけの並びは、今までと同じ (和文は既定の書体)', async () => {
    const { of } = await glyphsOf(fo('Testa'), 'fo', { fonts: fontsOf() });
    expect(of('a').font).toBe('Testa@400');
    expect(of('字').font).toBe('Noto Serif JP@400');
  });

  it('HTML: 同じ並びで、和文は 2 番目の書体', async () => {
    const html = `<!DOCTYPE html><html lang="ja"><body><p style="font-family: Testa, Kana">a字</p></body></html>`;
    const { of } = await glyphsOf(html, 'html', { fonts: fontsOf() });
    expect(of('a').font).toBe('Testa@400');
    expect(of('字').font).toBe('Kana@400');
  });
});
