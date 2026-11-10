import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import { defaultFontBuffer, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager, type LoadedFont } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { walkAreaTree } from '../src/areaTree';
import { attachResources } from '../src/areaResources';
import { renderPdf } from '../src/pdfRenderer';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
import { ligatureUnits } from '../src/inlineLayout';
import { ligatureTable } from '../src/ligature';
import type { AreaTree, GlyphArea } from '../src/types';

/**
 * 合字 (OpenType の liga・rlig・dlig) で語をアイコンに置き換える書体。
 * 書体: Material Icons (Apache-2.0)。3.0.1 は名前の合字を liga に、4.0.0 は rlig に入れている。任意の合字 (dlig) は Source Sans 3。
 * ・合字の並びは、書体の合字の表 (GSUB の LookupType 4) から引く。長さ・字の種類を限らない (5 字以上の語、数字・_ を含む名前)
 * ・字間 (letter-spacing) があるときは任意の合字を当てない。font-feature-settings の明示は優先する (CSS Text 3 §7.2・Fonts 4 §7.2)
 * ・必須の合字 (rlig) は、font-variant-ligatures: none でも字間があっても当てる (Fonts 4 §6.4・§7.1)
 */
const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const ICON = 'Material Icons';
const ICON_R = 'Material Icons R';
const SANS = 'Source Sans 3';

let fonts: FontManager;
let measurer: Measurer;
let engine: LayoutEngine;
let icon: LoadedFont;
let iconR: LoadedFont;
/** アイコンの書体を読み込んでいない組 (合字の表を持たない書体の文書が変わらないことを比べる) */
let plainFonts: FontManager;
let plainMeasurer: Measurer;
let plainEngine: LayoutEngine;
beforeAll(async () => {
  const base = await fontBuffer();
  const arimo = await defaultFontBuffer('Arimo-Regular.ttf');
  const make = async () => {
    const f = new FontManager();
    await f.registerBuffer(FAMILY, 400, base, false);
    await f.registerBuffer('Arimo', 400, arimo, false);
    f.setLatinFallback(FAMILY, 'Arimo');
    return f;
  };
  fonts = await make();
  await fonts.registerBuffer(ICON, 400, toAB(fs.readFileSync(await extraTestFont('MaterialIcons-Regular-3.0.1.ttf'))), false);
  await fonts.registerBuffer(ICON_R, 400, toAB(fs.readFileSync(await extraTestFont('MaterialIcons-Regular-4.0.0.ttf'))), false);
  await fonts.registerBuffer(SANS, 400, toAB(fs.readFileSync(await extraTestFont('SourceSans3-Regular-3.052R.otf'))), false);
  measurer = new Measurer(fonts, 'fontkit');
  engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY });
  icon = fonts.get(ICON, 400);
  iconR = fonts.get(ICON_R, 400);
  plainFonts = await make();
  plainMeasurer = new Measurer(plainFonts, 'fontkit');
  plainEngine = new LayoutEngine(plainFonts, plainMeasurer, { defaultFontFamily: FAMILY });
});

const CSS = `body { font-family: '${FAMILY}'; font-size: 10pt } .mi { font-family: '${ICON}' } .mr { font-family: '${ICON_R}' } .ss { font-family: '${SANS}' }`;
const htmlTree = (body: string, css = '', e: LayoutEngine = engine): AreaTree => {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const all = CSS + css;
  return e.layout(importHtml(d, cascadeStyles(d, all, { viewport: { width: 600, height: 800 } }), { css: all, mapFont: (names) => names.find((n) => fonts.has(n)) }).document);
};
const glyphsOfTree = (tree: AreaTree): GlyphArea[] => {
  const out: GlyphArea[] = [];
  walkAreaTree(tree, (a) => {
    if (a.type === 'glyph') out.push(a);
  });
  return out;
};
const glyphs = (body: string, css = '', e: LayoutEngine = engine) => glyphsOfTree(htmlTree(body, css, e));
const texts = (body: string, css = '') => glyphs(body, css).map((g) => g.text);
/** 書体が、並び全体を整形して返す字形の番号 (liga を有効にして) */
const shaped = (f: LoadedFont, s: string, feats: object = { liga: true }) => f.fk.layout(s, { kern: false, ...feats } as never).glyphs.map((g) => g.id);

describe('書体の合字の表 (GSUB の LookupType 4) を読む', () => {
  it('アイコンの書体は、欧文の 2〜4 字に収まらない合字を持つ (extended)。いちばん長い並びの長さが分かる', () => {
    const t = ligatureTable(icon, ['liga', 'clig'])!;
    expect(t.extended).toBe(true);
    expect(t.maxLen).toBeGreaterThan(16);
    // 4.0.0 は liga を持たず、rlig に入れている
    expect(ligatureTable(iconR, ['liga', 'clig'])).toBeNull();
    expect(ligatureTable(iconR, ['rlig'])!.extended).toBe(true);
  });
  it('fi・ffi だけの書体 (Noto Serif JP)・合字の表の無い書体 (Arimo) は extended でない。そういう書体だけの文書は、従来の道のまま', () => {
    expect(ligatureTable(plainFonts.get(FAMILY, 400), ['liga', 'clig', 'rlig'])?.extended ?? false).toBe(false);
    expect(ligatureTable(plainFonts.get('Arimo', 400), ['liga', 'clig', 'rlig'])).toBeNull();
    expect(plainMeasurer.hasExtendedLigatures(['liga', 'clig', 'rlig'])).toBe(false);
    expect(plainMeasurer.hasExtendedLigatures(['rlig'])).toBe(false);
    expect(measurer.hasExtendedLigatures(['liga', 'clig', 'rlig'])).toBe(true);
  });
});

describe('ligatureUnits: 書体の合字の表にある並びを 1 単位にする', () => {
  const units = (s: string, f: LoadedFont = icon, features = ['liga']) => ligatureUnits(s, () => f, { features, extended: true });
  it('5 字以上の語、数字・_ を含む名前が 1 単位になる', () => {
    expect(units('favorite')).toEqual(['favorite']);
    expect(units('arrow_back')).toEqual(['arrow_back']);
    expect(units('3d_rotation')).toEqual(['3d_rotation']);
    expect(units('airline_seat_legroom_reduced')).toEqual(['airline_seat_legroom_reduced']);
  });
  it('続けて書いた名前は、書体の整形と同じ所で区切る (書体の表の順 = 長い並びが先)', () => {
    for (const s of ['homefavorite', 'arrow_backarrow_forward', 'favorite_borderhome', 'homex3d_rotation', 'star_borderstar_halfstar', 'starstar_border']) {
      const u = units(s);
      expect(u.join('')).toBe(s);
      expect(u.flatMap((x) => shaped(icon, x))).toEqual(shaped(icon, s));
    }
    expect(units('homefavorite')).toEqual(['home', 'favorite']);
    // star・star_border・star_half: 長い名前を先に取る
    expect(units('star_borderstar_halfstar')).toEqual(['star_border', 'star_half', 'star']);
    // 「stars」という名前もあるので、star の後ろに s が続けば stars (書体の整形も同じ)
    expect(units('starstar_border').slice(0, 2)).toEqual(['stars', 't']);
  });
  it('空白をまたがない。表に無い並びは 1 字ずつ', () => {
    expect(units('home favorite')).toEqual(['home', ' ', 'favorite']);
    expect(units('hom e')).toEqual(['h', 'o', 'm', ' ', 'e']);
    expect(units('qqq_qqq')).toEqual([...'qqq_qqq']);
  });
  it('書体が違う字をまたがない', () => {
    const other = fonts.get('Arimo', 400);
    expect(ligatureUnits('home', (ch) => (ch === 'm' ? other : icon), { features: ['liga'], extended: true })).toEqual(['h', 'o', 'm', 'e']);
  });
  it('extended を渡さなければ、従来どおり欧文の字の 4 字まで', () => {
    expect(ligatureUnits('home', () => icon)).toEqual(['home']);
    expect(ligatureUnits('favorite', () => icon)).toEqual([...'favorite']);
  });
  it('必須の合字 (rlig) だけのとき: 表にある並びだけをまとめる', () => {
    expect(units('arrow_back', iconR, ['rlig'])).toEqual(['arrow_back']);
    expect(units('favoritehome', iconR, ['rlig'])).toEqual(['favorite', 'home']);
  });
});

describe('HTML: 語をアイコンにする書体 (標準の合字 liga。font-variant-ligatures の既定で有効。CSS Fonts 4 §6.4・§7.1)', () => {
  it('5 字以上の語・数字や _ を含む名前が、1 つの字形になる', () => {
    const gs = glyphs('<p><span class="mi">favorite</span>と<span class="mi">arrow_back</span>と<span class="mi">3d_rotation</span>と<span class="mi">home</span></p>');
    expect(gs.map((g) => g.text)).toEqual(['favorite', 'と', 'arrow_back', 'と', '3d_rotation', 'と', 'home']);
    attachResources(htmlTree('<p><span class="mi">favorite</span></p>'), fonts);
    for (const name of ['favorite', 'arrow_back', '3d_rotation', 'home']) {
      const tree = htmlTree(`<p><span class="mi">${name}</span></p>`);
      attachResources(tree, fonts);
      const [g] = glyphsOfTree(tree);
      expect(g.fontFamily).toBe(ICON);
      expect(g.glyphIds).toEqual(shaped(icon, name));
      expect(g.glyphIds).toHaveLength(1);
      // 送りは、アイコンの字形の送り (1em)
      expect(g.advance).toBeCloseTo((icon.fk.layout(name).glyphs[0].advanceWidth / icon.unitsPerEm) * g.fontSize, 6);
    }
  });
  it('font-variant-ligatures: none・no-common-ligatures では字のまま。font-feature-settings: "liga" 1 を足すと合字になる (機能の優先の順。Fonts 4 §7.2)', () => {
    expect(texts('<p class="mi" style="font-variant-ligatures: none">favorite</p>')).toEqual([...'favorite']);
    expect(texts('<p class="mi" style="font-variant-ligatures: no-common-ligatures">favorite</p>')).toEqual([...'favorite']);
    expect(texts('<p class="mi" style="font-feature-settings: \'liga\' 0">favorite</p>')).toEqual([...'favorite']);
    expect(texts('<p class="mi" style="font-variant-ligatures: none; font-feature-settings: \'liga\' 1">favorite</p>')).toEqual(['favorite']);
  });
  it('字間 (letter-spacing) があると合字にしない (Text 3 §7.2)。font-variant-ligatures の明示でも同じ (Fonts 4 §7.2 の順: font-variant → letter-spacing)', () => {
    expect(texts('<p class="mi" style="letter-spacing: 3pt">favorite</p>')).toEqual([...'favorite']);
    expect(texts('<p class="mi" style="letter-spacing: 3pt; font-variant-ligatures: common-ligatures">favorite</p>')).toEqual([...'favorite']);
    // letter-spacing: 0 は字間なし
    expect(texts('<p class="mi" style="letter-spacing: 0">favorite</p>')).toEqual(['favorite']);
  });
  it('字間があっても、font-feature-settings: "liga" 1 と明示すれば合字にする (Text 3 §7.2・Fonts 4 §7.2)。字間は合字 (1 つの字の単位) の後ろに空ける', () => {
    const gs = glyphs('<p class="mi" style="letter-spacing: 3pt; font-feature-settings: \'liga\' 1">homefavoritestar</p>');
    expect(gs.map((g) => g.text)).toEqual(['home', 'favorite', 'star']);
    // アイコンの送り 10pt + 字間 3pt ずつ進む
    expect(gs[1].x - gs[0].x).toBeCloseTo(13, 3);
    expect(gs[2].x - gs[1].x).toBeCloseTo(13, 3);
    expect(gs[0].advance).toBeCloseTo(13, 3);
    // 明示が親にあるときも、子に伝わる。子で "liga" 0 にすれば止まる
    expect(texts('<div style="letter-spacing: 3pt; font-feature-settings: \'liga\'"><p class="mi">favorite</p></div>')).toEqual(['favorite']);
    expect(texts('<div style="letter-spacing: 3pt; font-feature-settings: \'liga\'"><p class="mi" style="font-feature-settings: \'liga\' 0">favorite</p></div>')).toEqual([...'favorite']);
  });
  it('狭い箱 (overflow-wrap: anywhere): アイコンの間では折り返し、アイコンの途中では切れない', () => {
    // 幅 3.5em: 10pt のアイコンが 3 つずつ入る
    const tree = htmlTree('<div class="mi" style="width: 35pt; overflow-wrap: anywhere">homefavoritearrow_backstarhome</div>');
    // 行ごとの字
    const rows: string[][] = [];
    walkAreaTree(tree, (a) => {
      if (a.type === 'line') rows.push([]);
      else if (a.type === 'glyph') rows[rows.length - 1].push(a.text);
    });
    expect(rows).toEqual([
      ['home', 'favorite', 'arrow_back'],
      ['star', 'home'],
    ]);
  });
  it('縦書きでは合字にしない (今の制限)', () => {
    expect(texts('<div style="writing-mode: vertical-rl"><span class="mi">favorite</span></div>')).toEqual([...'favorite']);
  });
  it('ほかの書体の字と並んでも、アイコンの書体の字の並びだけがまとまる', () => {
    expect(texts('<p>家は<span class="mi">home</span>、fine</p>')).toEqual(['家', 'は', 'home', '、', 'ﬁ', 'n', 'e']);
  });
});

describe('必須の合字 (rlig) でアイコンにする書体 (Material Icons 4.0.0)', () => {
  it('既定で合字になる。font-variant-ligatures: none でも、字間があっても合字のまま (Fonts 4 §6.4: 必須の合字は none でも止めない。Text 3 §7.2: 止めるのは任意の合字)', () => {
    expect(texts('<p class="mr">arrow_backfavorite</p>')).toEqual(['arrow_back', 'favorite']);
    expect(texts('<p class="mr" style="font-variant-ligatures: none">arrow_back</p>')).toEqual(['arrow_back']);
    const gs = glyphs('<p class="mr" style="letter-spacing: 2pt">arrow_backfavoritex</p>');
    expect(gs.map((g) => g.text)).toEqual(['arrow_back', 'favorite', 'x']);
    expect(gs[1].x - gs[0].x).toBeCloseTo(12, 3);
  });
  it('XSL-FO (axf:ligature-mode の指定なし) でも合字になる。任意の合字 (liga) の書体は、指定が無ければ字のまま', () => {
    const fo = (family: string, attrs = '') =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="50mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="${family}" font-size="10pt" ${attrs}>arrow_back</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const foTexts = (xml: string) => glyphsOfTree(engine.layout(importXslFo(xml, (x) => new DOMParser().parseFromString(x, 'text/xml') as never, { mapFont: (names) => names.find((n) => fonts.has(n)) }).document)).map((g) => g.text);
    expect(foTexts(fo(ICON_R))).toEqual(['arrow_back']);
    expect(foTexts(fo(ICON))).toEqual([...'arrow_back']);
    expect(foTexts(fo(ICON, 'axf:ligature-mode="latin"'))).toEqual(['arrow_back']);
  });
});

describe('任意の合字 (dlig): font-variant-ligatures: discretionary-ligatures・font-feature-settings: "dlig"', () => {
  // Source Sans 3 の dlig: 「!-)」「?-(」 などを 1 つの字形にする
  it('既定では字のまま。discretionary-ligatures・"dlig" 1 で 1 つの字形になる', () => {
    const sans = fonts.get(SANS, 400);
    expect(shaped(sans, '!-)', { liga: true, dlig: true })).toHaveLength(1);
    expect(texts('<p class="ss">a!-)b</p>')).toEqual(['a', '!', '-', ')', 'b']);
    expect(texts('<p class="ss" style="font-variant-ligatures: discretionary-ligatures">a!-)b</p>')).toEqual(['a', '!-)', 'b']);
    expect(texts('<p class="ss" style="font-feature-settings: \'dlig\' 1">a!-)b</p>')).toEqual(['a', '!-)', 'b']);
    // 標準の合字を止めて、任意の合字だけにしても当たる
    expect(texts('<p class="ss" style="font-variant-ligatures: no-common-ligatures discretionary-ligatures">a!-)b</p>')).toEqual(['a', '!-)', 'b']);
    const tree = htmlTree('<p class="ss" style="font-variant-ligatures: discretionary-ligatures">!-)</p>');
    attachResources(tree, fonts);
    expect(glyphsOfTree(tree)[0].glyphIds).toEqual(shaped(sans, '!-)', { liga: true, dlig: true }));
  });
  it('字間があると、font-variant-ligatures の dlig は当てない。font-feature-settings の dlig は当てる', () => {
    expect(texts('<p class="ss" style="letter-spacing: 1pt; font-variant-ligatures: discretionary-ligatures">!-)</p>')).toEqual(['!', '-', ')']);
    expect(texts('<p class="ss" style="letter-spacing: 1pt; font-feature-settings: \'dlig\' 1">!-)</p>')).toEqual(['!-)']);
  });
});

describe('合字の表を持たない書体・その並びを合字にしない文書は変わらない', () => {
  const key = (gs: GlyphArea[]) => gs.map((g) => [g.text, g.fontFamily, Math.round(g.x * 1e6), Math.round(g.y * 1e6), Math.round(g.advance * 1e6), g.features ?? null]);
  it('アイコンの書体を読み込んでいても、ほかの書体の文の字・位置・送りは、読み込んでいないときと同じ', () => {
    const body =
      '<p>吾輩は猫である。The office staff finally shuffled 3d_rotation arrow_back home.</p>' +
      '<p style="letter-spacing: 1pt">difficult affiliation fi fl ffi — 字間あり</p>' +
      '<p style="font-variant-ligatures: none">office fine home</p>' +
      '<div style="writing-mode: vertical-rl; height: 200pt">縦書きの office と home</div>';
    expect(key(glyphs(body))).toEqual(key(glyphs(body, '', plainEngine)));
  });
});

/** PDF の中の流れ (圧縮を解いたもの) の文字列 */
async function streams(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, o] of pdf.context.enumerateIndirectObjects()) {
    const raw = (o as unknown as { contents?: Uint8Array }).contents;
    if (!raw) continue;
    try {
      out.push(inflateSync(Buffer.from(raw)).toString('latin1'));
    } catch {
      out.push(Buffer.from(raw).toString('latin1'));
    }
  }
  return out;
}
const utf16Hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

describe('PDF: アイコンは 1 つの字形で書き、取り出す文字は元の語 (ToUnicode。ISO 32000-1 §9.10.3)', () => {
  it('favorite・arrow_back の字形の符号が、ToUnicode で元の語に対応する。ページの中身はその符号を 1 つずつ書く', async () => {
    const tree = htmlTree('<p><span class="mi">favorite</span>と<span class="mi">arrow_back</span></p>');
    attachResources(tree, fonts);
    const all = await streams(await renderPdf(tree, fonts));
    const maps = all.filter((s) => s.includes('beginbfchar') || s.includes('beginbfrange')).join('\n').toUpperCase();
    const content = all.find((s) => /\bTj\b|\bTJ\b/.test(s))!.toUpperCase();
    for (const name of ['favorite', 'arrow_back']) {
      const m = new RegExp(`<([0-9A-F]{4})>\\s*<${utf16Hex(name)}>`).exec(maps);
      expect(m, name).not.toBeNull();
      expect(content).toContain(m![1]);
      // 字ごとの字形 (f・a・v …) は書かない: 名前の最初の字だけの対応は無い
      expect(new RegExp(`<[0-9A-F]{4}>\\s*<${utf16Hex(name[0])}>`).test(maps)).toBe(false);
    }
  });
});


describe('書記素クラスタ (絵文字の並びなど) の字形を liga で作る書体: 標準の合字が有効なら、クラスタにも liga を当てる (Fonts 4 §7.1)', () => {
  // 手元に、絵文字の並びを liga で作る書体が無いので、書体の整形を差し替えて確かめる:
  // Arimo の整形が、liga が有効なときだけ「q + U+0301」を 1 つの字形 (代わりに é の字形) にする、とする
  // (合成済みの字のある並び (e + U+0301) は、クラスタにせず合成済みの字で組むので、合成済みの字の無い並びで確かめる)
  const SEQ = 'q\u0301';
  let f2: FontManager;
  let e2: LayoutEngine;
  let composed: number;
  beforeAll(async () => {
    f2 = new FontManager();
    await f2.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
    const fk = f2.get('Arimo', 400).fk as unknown as { layout(t: string, f?: Record<string, boolean>): unknown; availableFeatures: string[] };
    const layout = fk.layout.bind(fk);
    const feats = [...fk.availableFeatures, 'liga'];
    Object.defineProperty(fk, 'availableFeatures', { value: feats });
    fk.layout = (t, f) => layout(t === SEQ && f?.liga === true ? 'é' : t, f);
    composed = f2.get('Arimo', 400).fk.glyphForCodePoint(0xe9).id;
    e2 = new LayoutEngine(f2, new Measurer(f2, 'fontkit'), { defaultFontFamily: 'Arimo' });
  });
  const run = (style: string) => {
    const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body><p style="${style}">a${SEQ}b</p></body></html>`, 'text/html') as unknown as Document;
    const tree = e2.layout(importHtml(d, cascadeStyles(d, '', { viewport: { width: 600, height: 800 } }), { css: '', mapFont: () => 'Arimo' }).document);
    attachResources(tree, f2);
    return glyphsOfTree(tree);
  };
  it('既定 (標準の合字が有効): クラスタを liga を当てて組む。字形・機能・送りが liga のものになる', () => {
    const gs = run('');
    expect(gs.map((g) => g.text)).toEqual(['a', SEQ, 'b']);
    expect(gs[1].glyphIds).toEqual([composed]);
    expect(gs[1].features).toContain('liga');
    // liga が字形を変えない字 (a・b) には、機能を足さない
    expect(gs[0].features).toBeUndefined();
  });
  it('font-variant-ligatures: none・字間のあるとき: liga を当てない (基底の字 + 結合文字の 2 つの字形)', () => {
    for (const style of ['font-variant-ligatures: none', 'letter-spacing: 1pt']) {
      const gs = run(style);
      expect(gs[1].text).toBe(SEQ);
      expect(gs[1].glyphIds).toHaveLength(2);
      expect(gs[1].features).toBeUndefined();
    }
  });
});
