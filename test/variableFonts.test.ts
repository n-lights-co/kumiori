/**
 * 可変フォント (OpenType Font Variations) の対応 (NC-15):
 *  - 実体化 (src/fontInstancer.ts): 可変フォントから、軸の値を決めた静的な書体を作る。同じ書体の静的な書体 (配信元が可変フォントから取り出したもの) と、
 *    輪郭・送り・字の組の詰め (GPOS)・書体全体の寸法 (MVAR) が同じになること
 *  - 書体の選び方 (src/fontManager.ts): 太さの範囲 (CSS Fonts 4 §5.2)、@font-face の記述子の範囲 (§4.4)、軸の値の優先の順 (§7.2)
 *  - 組版: font-weight・font-stretch・font-style・font-optical-sizing・font-variation-settings が、実体の字の送りになること
 *  - PDF: 実体ごとに、静的な書体として埋めること
 * 書体のファイルはリポジトリに入れない (test/helpers.ts の EXTRA_TEST_FONTS から .cache/fonts に取得する)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { instantiateFont, normalizeCoords, readVariationInfo, type VariationInfo } from '../src/fontInstancer';
import { FontManager, matchWeightRange } from '../src/fontManager';
import { parseVariationSettings, splitVariation, variationSuffix, withVariation } from '../src/fontVariation';
import { parseCss } from '../src/htmlPaged';
import { Measurer } from '../src/measurer';
import { defaultFontBuffer, ensureFonts, extraTestFont, loadCachedFont } from './helpers';
import { DEFAULT_FONTS, typeset, walkAreaTree, type GlyphArea, type TypesetResult } from '../src/index';

type Fk = {
  numGlyphs: number;
  unitsPerEm: number;
  xHeight: number;
  capHeight: number;
  characterSet: number[];
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): { id: number; advanceWidth: number; path: { commands: Array<{ command: string; args: number[] }> } };
  layout(text: string, features?: Record<string, boolean>): { glyphs: Array<{ id: number; advanceWidth: number }>; positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }> };
  'OS/2': { usWeightClass: number; usWidthClass: number; xHeight: number };
  directory: { tables: Record<string, unknown> };
};

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fk = (buf: ArrayBuffer) => fontkit.create(new Uint8Array(buf)) as unknown as Fk;
const pathOf = (f: Fk, cp: number) => JSON.stringify(f.glyphForCodePoint(cp).path.commands);

let varBuf: ArrayBuffer;
let info: VariationInfo;
/** 静的な書体 (幅・太さ → ファイル) */
const statics = new Map<string, ArrayBuffer>();

/** 軸の値 (札 → 値) の実体 */
function instance(coords: Record<string, number>, buf = varBuf, vi = info): ArrayBuffer {
  return instantiateFont(buf, vi, vi.axes.map((a) => coords[a.tag] ?? a.default)).buffer;
}

/**
 * 可変フォントの写しの、軸の札と範囲を書き換える (fvar の VariationAxisRecord)。傾き (slnt)・光学サイズ (opsz) の軸を持つ小さな書体が無いので、
 * 幅の軸 (wdth 50〜100〜150) を、その軸に見立てて、軸の値の決め方を試す (輪郭の変わり方は幅のまま)
 */
function retagAxis(buf: ArrayBuffer, from: string, to: string, min: number, def: number, max: number): ArrayBuffer {
  const out = buf.slice(0);
  const dv = new DataView(out);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
    if (tag !== 'fvar') continue;
    const base = dv.getUint32(rec + 8);
    const axes = base + dv.getUint16(base + 4);
    const count = dv.getUint16(base + 8);
    const size = dv.getUint16(base + 10);
    for (let a = 0; a < count; a++) {
      const o = axes + a * size;
      const t = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      if (t !== from) continue;
      for (let k = 0; k < 4; k++) dv.setUint8(o + k, to.charCodeAt(k));
      dv.setInt32(o + 4, min * 65536);
      dv.setInt32(o + 8, def * 65536);
      dv.setInt32(o + 12, max * 65536);
    }
  }
  return out;
}

/** 表の札を書き換えた写し (gvar を持たない可変フォント = 輪郭が CFF2 の書体と同じ扱いになるもの) を作る */
function renameTable(buf: ArrayBuffer, from: string, to: string): ArrayBuffer {
  const out = buf.slice(0);
  const dv = new DataView(out);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
    if (tag === from) for (let k = 0; k < 4; k++) dv.setUint8(rec + k, to.charCodeAt(k));
  }
  return out;
}

const SAMPLE = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()&@#$%-+=/"\'', 'é', 'ü', 'ß', 'Ø', 'ç', 'ñ', 'Å', '€', '£'].map((c) => c.codePointAt(0)!);

beforeAll(async () => {
  varBuf = toArrayBuffer(fs.readFileSync(await extraTestFont('Anybody-wdth-wght-5bb2873.ttf')));
  info = readVariationInfo(varBuf)!;
  statics.set('150,900', toArrayBuffer(fs.readFileSync(await extraTestFont('Anybody-ExpandedBlack-v13.ttf'))));
  statics.set('75,400', toArrayBuffer(fs.readFileSync(await extraTestFont('Anybody-CondensedRegular-v13.ttf'))));
  statics.set('100,700', toArrayBuffer(fs.readFileSync(await extraTestFont('Anybody-Bold-v13.ttf'))));
  await ensureFonts(DEFAULT_FONTS.base);
});

describe('可変フォントの軸と正規化 (fvar・avar)', () => {
  it('軸の札・範囲・既定の値と、名前つきの実体を読む', () => {
    expect(info.cff2).toBe(false);
    expect(info.axes).toEqual([
      { tag: 'wdth', min: 50, default: 100, max: 150 },
      { tag: 'wght', min: 100, default: 100, max: 900 },
    ]);
    expect(info.instances.map((i) => i.name)).toEqual(['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']);
    expect(info.instances[6].coords).toEqual([100, 700]);
  });
  it('可変フォントでない書体は undefined', async () => {
    expect(readVariationInfo(await defaultFontBuffer('Arimo-Regular.ttf'))).toBeUndefined();
    expect(readVariationInfo(statics.get('100,700')!)).toBeUndefined();
  });
  it('軸の値を正規化した値 (F2Dot14) は、HarfBuzz の値と同じ (avar の写像・範囲の外の値の切り詰め)', () => {
    // 期待値は HarfBuzz (hb_font_set_variations → hb_font_get_var_coords_normalized) で求めたもの
    const n = (wdth: number, wght: number) => normalizeCoords(varBuf, info.axes, [wdth, wght]);
    expect(n(100, 100)).toEqual([0, 0]);
    expect(n(75, 400)).toEqual([-8192, 6867]);
    expect(n(150, 900)).toEqual([16384, 16384]);
    expect(n(62.5, 250)).toEqual([-12288, 3102]);
    expect(n(101, 555.5)).toEqual([328, 9209]);
    expect(n(10, 2000)).toEqual([-16384, 16384]);
  });
});

describe('実体化: 静的な書体 (配信元が同じ可変フォントから取り出したもの) と同じになる', () => {
  const cases: Array<[string, Record<string, number>]> = [
    ['150,900', { wdth: 150, wght: 900 }],
    ['75,400', { wdth: 75, wght: 400 }],
    ['100,700', { wdth: 100, wght: 700 }],
  ];
  for (const [key, coords] of cases) {
    it(`幅 ${coords.wdth}・太さ ${coords.wght}: 字の輪郭・送りが同じ`, () => {
      const mine = fk(instance(coords));
      const ref = fk(statics.get(key)!);
      const chars = SAMPLE.filter((cp) => ref.hasGlyphForCodePoint(cp));
      expect(chars.length).toBeGreaterThan(80);
      const diffAdvance = chars.filter((cp) => mine.glyphForCodePoint(cp).advanceWidth !== ref.glyphForCodePoint(cp).advanceWidth);
      const diffPath = chars.filter((cp) => pathOf(mine, cp) !== pathOf(ref, cp));
      expect(diffAdvance.map((cp) => String.fromCodePoint(cp))).toEqual([]);
      expect(diffPath.map((cp) => String.fromCodePoint(cp))).toEqual([]);
      // 既定の形 (幅 100・太さ 100) とは違う
      const def = fk(varBuf);
      expect(pathOf(mine, 0x48)).not.toBe(pathOf(def, 0x48));
    });
    it(`幅 ${coords.wdth}・太さ ${coords.wght}: 字の組の詰め・記号の位置 (GPOS の値の変化) が同じ`, () => {
      const mine = fk(instance(coords));
      const ref = fk(statics.get(key)!);
      const pos = (f: Fk, t: string) => f.layout(t, { kern: true }).positions.map((p) => [p.xAdvance, p.xOffset, p.yOffset]);
      const texts = ['AV', 'To', 'Wa', 'LT', 'P.', 'Ya', 'r,', 'é', 'Å', 'ö', 'ç', 'ñ'];
      for (const t of texts) expect([t, pos(mine, t)]).toEqual([t, pos(ref, t)]);
      // 詰めが実際に効いている組がある (0 どうしを比べただけではない)
      expect(mine.layout('AV', { kern: true }).positions[0].xAdvance).not.toBe(mine.glyphForCodePoint(0x41).advanceWidth);
    });
    it(`幅 ${coords.wdth}・太さ ${coords.wght}: 書体全体の寸法 (MVAR の x の高さ) と、太さ・幅の区分が同じ`, () => {
      const mine = fk(instance(coords));
      const ref = fk(statics.get(key)!);
      expect(mine['OS/2'].xHeight).toBe(ref['OS/2'].xHeight);
      expect(mine['OS/2'].usWeightClass).toBe(coords.wght);
      expect(mine['OS/2'].usWidthClass).toBe(ref['OS/2'].usWidthClass);
    });
  }
  it('x の高さは、幅で変わる (MVAR を当てている)', () => {
    expect(fk(instance({ wdth: 150 }))['OS/2'].xHeight).not.toBe(fk(varBuf)['OS/2'].xHeight);
  });
  it('実体は静的な書体: 可変フォントの表 (fvar・avar・gvar・HVAR・MVAR・STAT) を持たない', () => {
    const tables = Object.keys(fk(instance({ wdth: 75, wght: 400 })).directory.tables);
    for (const t of ['fvar', 'avar', 'gvar', 'HVAR', 'MVAR', 'STAT']) expect(tables).not.toContain(t);
    for (const t of ['glyf', 'loca', 'hmtx', 'head', 'hhea', 'maxp', 'cmap', 'GPOS', 'GSUB', 'GDEF', 'OS/2', 'name', 'post']) expect(tables).toContain(t);
    expect(readVariationInfo(instance({ wdth: 75, wght: 400 }))).toBeUndefined();
  });
  it('既定の値の実体は、既定の形 (元の書体をそのまま読んだもの) と字の輪郭・送りが同じ', () => {
    const mine = fk(instance({}));
    const def = fk(varBuf);
    for (const cp of SAMPLE.filter((c) => def.hasGlyphForCodePoint(c))) {
      expect(mine.glyphForCodePoint(cp).advanceWidth).toBe(def.glyphForCodePoint(cp).advanceWidth);
      expect(pathOf(mine, cp)).toBe(pathOf(def, cp));
    }
  });
  it('範囲の外の軸の値は、端の値と同じ実体になる', () => {
    expect(pathOf(fk(instance({ wdth: 500, wght: 5000 })), 0x61)).toBe(pathOf(fk(instance({ wdth: 150, wght: 900 })), 0x61));
  });
});

describe('軸の値の指定の印 (書体の名前に付ける)', () => {
  it('印を作って、読み戻す', () => {
    expect(variationSuffix({})).toBe('');
    expect(variationSuffix({ wdth: 100 })).toBe('');
    expect(variationSuffix({ wdth: 75, slnt: 14, opsz: 10.5, settings: { wght: 650, GRAD: 88 } })).toBe('{wdth=75,slnt=14,opsz=10.5;GRAD=88,wght=650}');
    expect(variationSuffix({ ital: true, slnt: 10 })).toBe('{ital=1}');
    expect(splitVariation('Arch{wdth=75,slnt=14,opsz=10.5;GRAD=88,wght=650}')).toEqual(['Arch', { wdth: 75, slnt: 14, opsz: 10.5, settings: { GRAD: 88, wght: 650 } }, '{wdth=75,slnt=14,opsz=10.5;GRAD=88,wght=650}']);
    expect(splitVariation('Arch{;slnt=-10}')[1]).toEqual({ settings: { slnt: -10 } });
    expect(splitVariation('Arch')).toEqual(['Arch', undefined, '']);
    // 印の形でない { } は、名前の一部
    expect(splitVariation('My {Font}')[1]).toBeUndefined();
    expect(withVariation('Arch{wdth=75}', { wdth: 125 })).toBe('Arch{wdth=125}');
    expect(withVariation('Arch{wdth=75}', {})).toBe('Arch');
  });
  it('font-variation-settings の値を読む (CSS Fonts 4 §8.2)', () => {
    expect(parseVariationSettings('normal')).toEqual({});
    expect(parseVariationSettings('"wght" 650, \'GRAD\' -88.5')).toEqual({ wght: 650, GRAD: -88.5 });
    // 同じ札は後のもの。札は 4 字で、大文字小文字を区別する
    expect(parseVariationSettings('"wght" 300, "wght" 700')).toEqual({ wght: 700 });
    expect(parseVariationSettings('"wgh" 300')).toBeUndefined();
    expect(parseVariationSettings('wght 300')).toBeUndefined();
    expect(parseVariationSettings('"wght"')).toBeUndefined();
  });
  it('@font-face の記述子の範囲を読む (§4.4・§4.7・§4.9)', () => {
    const css = `@font-face { font-family: A; src: url(a.ttf); font-weight: 100 900; font-stretch: 75% 125%; font-variation-settings: "GRAD" 50; font-named-instance: "Bold"; }
      @font-face { font-family: B; src: url(b.ttf); font-weight: 900 300; font-width: condensed expanded; }
      @font-face { font-family: C; src: url(c.ttf); font-weight: bold; }
      @font-face { font-family: D; src: url(d.ttf); }`;
    const [a, b, c, d] = parseCss(css).fontFaces;
    expect(a).toMatchObject({ weight: 400, weightRange: [100, 900], widthRange: [75, 125], variationSettings: { GRAD: 50 }, namedInstance: 'Bold' });
    // 逆順の範囲は、端を入れ替える。font-width の語は百分率
    expect(b).toMatchObject({ weightRange: [300, 900], widthRange: [75, 125] });
    expect(c).toMatchObject({ weight: 700, weightRange: [700, 700] });
    expect(c.widthRange).toBeUndefined();
    // 記述子が無い (auto) ときは、範囲なし
    expect(d.weight).toBe(400);
    expect(d.weightRange).toBeUndefined();
  });
});

describe('太さの照合 (CSS Fonts 4 §5.2 の font-weight。範囲を持つ face)', () => {
  it('求める太さを範囲に含む face を選ぶ', () => {
    expect(matchWeightRange([[400, 400], [100, 900]], 650)).toBe(1);
    expect(matchWeightRange([[400, 400], [100, 900]], 400)).toBe(0);
    expect(matchWeightRange([[100, 300], [600, 900]], 600)).toBe(1);
  });
  it('含む face が無ければ、400〜500 は 500 まで上 → 下 → 500 より上、400 未満は下 → 上、500 より上は上 → 下', () => {
    const r: Array<[number, number]> = [[100, 300], [600, 900]];
    expect(matchWeightRange(r, 400)).toBe(0);
    expect(matchWeightRange(r, 500)).toBe(0);
    expect(matchWeightRange(r, 550)).toBe(1);
    expect(matchWeightRange(r, 350)).toBe(0);
    expect(matchWeightRange([[450, 480], [300, 300]], 420)).toBe(0);
    expect(matchWeightRange([[200, 250], [600, 700]], 950)).toBe(1);
    expect(matchWeightRange([[600, 700]], 100)).toBe(0);
  });
});

describe('書体の選び方: 可変フォントは、太さ・軸の値ごとの実体を返す', () => {
  const setup = async (face?: Parameters<FontManager['registerBuffer']>[4], buf = varBuf, weight = 100) => {
    const fonts = new FontManager();
    await fonts.registerBuffer('Any', weight, buf, false, face);
    return fonts;
  };
  const advance = (f: { fk: unknown }, ch = 'H') => (f.fk as Fk).glyphForCodePoint(ch.codePointAt(0)!).advanceWidth;
  const ref = (key: string, ch = 'H') => fk(statics.get(key)!).glyphForCodePoint(ch.codePointAt(0)!).advanceWidth;

  it('入っている書体 (記述子なし): 太さごとの実体。同じ指定は同じ実体 (1 度だけ作る)', async () => {
    const fonts = await setup();
    const bold = fonts.get('Any', 700);
    expect(bold.weight).toBe(700);
    expect(bold.instanceOf?.coords).toEqual({ wdth: 100, wght: 700 });
    expect(advance(bold)).toBe(ref('100,700'));
    expect(fonts.get('Any', 700)).toBe(bold);
    expect(fonts.getForChar('Any', 700, 'H')).toBe(bold);
    // 既定の形 (太さ 100) は、読み込んだ書体そのもの
    const thin = fonts.get('Any', 100);
    expect(thin.instanceOf).toBeUndefined();
    expect(thin.buffer).toBe(varBuf);
    // 範囲の外の太さは、端の値 (§7.2: 書体の持つ範囲に収める)
    expect(fonts.get('Any', 950).weight).toBe(900);
    expect(fonts.get('Any', 950)).toBe(fonts.get('Any', 900));
  });
  it('実体の名前と太さで引き直すと、同じ実体 (組版の結果の fontFamily・fontWeight から描く書体を引く)', async () => {
    const fonts = await setup();
    for (const [family, weight] of [['Any', 650], ['Any{wdth=75}', 400], ['Any{wdth=120;wght=333}', 700], ['Any{wdth=75}', 100]] as const) {
      const f = fonts.get(family, weight);
      expect(fonts.get(f.family, f.weight)).toBe(f);
      expect(fonts.getForChar(f.family, f.weight, 'a')).toBe(f);
    }
    expect(fonts.get('Any{wdth=75}', 400).family).toBe('Any{;wdth=75}');
    expect(fonts.get('Any{wdth=75}', 400).instanceOf?.coords).toEqual({ wdth: 75, wght: 400 });
    expect(advance(fonts.get('Any{wdth=75}', 400))).toBe(ref('75,400'));
  });
  it('all() は、読み込んだ書体の後に、作った実体を返す (PDF に埋める書体)', async () => {
    const fonts = await setup();
    expect(fonts.all().map((f) => f.key)).toEqual(['Any@100']);
    fonts.get('Any', 700);
    fonts.get('Any{wdth=75}', 400);
    fonts.get('Any', 100);
    expect(fonts.all().map((f) => f.key)).toEqual(['Any@100', 'Any@100{wdth=100,wght=700}', 'Any@100{wdth=75,wght=400}']);
    expect(fonts.variationAxes()).toEqual(new Set(['wdth', 'wght']));
  });
  it('優先の順 (§7.2): font-variation-settings は、font-weight・font-stretch から決まる値より後', async () => {
    const fonts = await setup();
    const f = fonts.get('Any{wdth=75;wght=900,wdth=150}', 400);
    expect(f.instanceOf?.coords).toEqual({ wdth: 150, wght: 900 });
    // 書体を選ぶ太さ (font-weight) は 400 のまま (§8.2: font-variation-settings は書体の選び方に関わらない)
    expect(f.weight).toBe(400);
    expect(advance(f)).toBe(ref('150,900'));
    // 書体に無い軸の指定は無視する。ほかの軸の指定は効く
    expect(fonts.get('Any{;XXXX=5,wdth=75}', 400)).toBe(fonts.get('Any{wdth=75}', 400));
  });
  it('@font-face の font-weight の範囲: 範囲の中はその値、外は近い端 (§4.4・§7.2)', async () => {
    const fonts = await setup({ weight: [300, 500], width: 'auto' }, varBuf, 400);
    expect(fonts.get('Any', 400).instanceOf?.coords.wght).toBe(400);
    expect(fonts.get('Any', 700).weight).toBe(500);
    expect(fonts.get('Any', 700).instanceOf?.coords.wght).toBe(500);
    expect(fonts.get('Any', 100).instanceOf?.coords.wght).toBe(300);
  });
  it('@font-face の font-weight が 1 つの値: その太さの実体だけ (太字は、擬似太字のまま)', async () => {
    const fonts = await setup({ weight: [400, 400], width: 'auto' }, varBuf, 400);
    expect(fonts.get('Any', 700)).toBe(fonts.get('Any', 400));
    expect(fonts.get('Any', 700).weight).toBe(400);
    expect(fonts.get('Any', 400).instanceOf?.coords.wght).toBe(400);
  });
  it('@font-face に font-weight が無い (auto): 選ぶときは 400、軸の値は制限しない (§4.4)', async () => {
    const fonts = await setup({ weight: 'auto', width: 'auto' }, varBuf, 400);
    expect(fonts.get('Any', 700).weight).toBe(700);
    expect(advance(fonts.get('Any', 700))).toBe(ref('100,700'));
  });
  it('@font-face の font-stretch の範囲に収める。記述子の font-variation-settings・font-named-instance も当てる', async () => {
    const narrow = await setup({ weight: 'auto', width: [90, 110] }, varBuf, 400);
    expect(narrow.get('Any{wdth=75}', 400).instanceOf?.coords.wdth).toBe(90);
    const fixed = await setup({ weight: 'auto', width: 'auto', settings: { wdth: 150 } }, varBuf, 400);
    expect(fixed.get('Any', 900).instanceOf?.coords).toEqual({ wdth: 150, wght: 900 });
    // 名前つきの実体 (Bold = 幅 100・太さ 700) の値は、font-weight から決まる値より後 (§7.2)
    const named = await setup({ weight: 'auto', width: 'auto', namedInstance: 'bold' }, varBuf, 400);
    expect(named.get('Any', 400).instanceOf?.coords).toEqual({ wdth: 100, wght: 700 });
    // 性質の font-variation-settings は、さらに後
    expect(named.get('Any{;wght=300}', 400).instanceOf?.coords.wght).toBe(300);
  });
  it('可変フォントと静的な書体が同じファミリーにあるとき、太さの範囲で選ぶ', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer('Mix', 400, varBuf, false, { weight: [100, 500], width: 'auto' });
    await fonts.registerBuffer('Mix', 700, statics.get('100,700')!, false);
    expect(fonts.get('Mix', 300).instanceOf?.coords.wght).toBe(300);
    expect(fonts.get('Mix', 700).instanceOf).toBeUndefined();
    expect(fonts.get('Mix', 700).buffer).toBe(statics.get('100,700'));
    // 600 は、500 より上なので、重い方 (静的な 700) を先に探す
    expect(fonts.get('Mix', 600).weight).toBe(700);
  });
  it('可変フォントでない書体は、印の付いた名前でも、そのままの書体', async () => {
    const fonts = new FontManager();
    const arimo = await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
    expect(fonts.variationAxes()).toBeUndefined();
    expect(fonts.get('Arimo{wdth=75;wght=900}', 700)).toBe(arimo);
    expect(fonts.getForChar('Arimo{wdth=75}', 400, 'A')).toBe(arimo);
    expect(fonts.has('Arimo{wdth=75}')).toBe(true);
  });
  it('字を持たない書体からの後備でも、可変フォントは求める太さの実体', async () => {
    const fonts = new FontManager();
    // 既定の和文の書体は欧文の字を持つので、字の少ない書体として、静的な Anybody の代わりに和文の字で試す
    await fonts.registerBuffer('Any', 100, varBuf, false);
    await fonts.registerBuffer('JP', 400, await loadCachedFont(DEFAULT_FONTS.base[0]).then((b) => b!), false);
    const f = fonts.getForChar('JP', 700, 'あ');
    expect(f.family).toBe('JP');
    // Any が基本の書体で、和文の字は JP へ。JP が基本の書体で、JP に無い字は無い (欧文の字は JP が持つ) ので、逆向きを試す
    const g = fonts.getForChar('Any', 700, 'あ');
    expect(g.family).toBe('JP');
    expect(fonts.getForChar('Any', 700, 'A').instanceOf?.coords.wght).toBe(700);
  });
  it('傾きの軸 (slnt): italic は 11deg 以上の最も小さい角度、oblique はその角度 (§5.2)。軸は反時計回りが正 (§2.5)', async () => {
    // 幅の軸を slnt (-12〜0〜0) に見立てた書体
    const fonts = await setup(undefined, retagAxis(varBuf, 'wdth', 'slnt', -12, 0, 0));
    const italic = fonts.get('Any{ital=1}', 400);
    expect(italic.instanceOf?.coords.slnt).toBe(-11);
    expect(italic.instanceOf?.slanted).toBe(true);
    expect(fonts.get('Any{slnt=5}', 400).instanceOf?.coords.slnt).toBe(-5);
    // 書体の範囲 (0〜12deg) の外の角度は、端の値
    expect(fonts.get('Any{slnt=14}', 400).instanceOf?.coords.slnt).toBe(-12);
    expect(fonts.get('Any{slnt=-20}', 400).instanceOf?.coords.slnt).toBe(0);
    expect(fonts.get('Any{slnt=-20}', 400).instanceOf?.slanted).toBeUndefined();
    // 引き直しても同じ実体
    expect(fonts.get(italic.family, italic.weight)).toBe(italic);
    // 11deg に届かない書体 (0〜8deg) は、最も大きい角度
    const small = await setup(undefined, retagAxis(varBuf, 'wdth', 'slnt', -8, 0, 0));
    expect(small.get('Any{ital=1}', 400).instanceOf?.coords.slnt).toBe(-8);
  });
  it('傾きの軸 (ital): italic で 1 にする。oblique では使わない (§5.2)', async () => {
    const fonts = await setup(undefined, retagAxis(varBuf, 'wdth', 'ital', 0, 0, 1));
    expect(fonts.get('Any{ital=1}', 400).instanceOf?.coords.ital).toBe(1);
    expect(fonts.get('Any{ital=1}', 400).instanceOf?.slanted).toBe(true);
    expect(fonts.get('Any{slnt=14}', 400).instanceOf?.coords.ital).toBe(0);
  });
  it('光学サイズの軸 (opsz): 指定の値を範囲に収める', async () => {
    const fonts = await setup(undefined, retagAxis(varBuf, 'wdth', 'opsz', 8, 14, 144));
    expect(fonts.get('Any{opsz=10.5}', 400).instanceOf?.coords.opsz).toBe(10.5);
    expect(fonts.get('Any{opsz=6}', 400).instanceOf?.coords.opsz).toBe(8);
    expect(fonts.get('Any', 400).instanceOf?.coords.opsz).toBe(14);
    // font-variation-settings の opsz は、font-optical-sizing から決まる値より後 (§7.2)
    expect(fonts.get('Any{opsz=10.5;opsz=72}', 400).instanceOf?.coords.opsz).toBe(72);
  });
  it('輪郭が gvar でない可変フォント (CFF2 と同じ扱い): 知らせを出して、既定の形の 1 つの書体として使う', async () => {
    const fonts = new FontManager();
    const notices: string[] = [];
    fonts.onNotice = (m) => notices.push(m);
    const f = await fonts.registerBuffer('NoGvar', 400, renameTable(varBuf, 'gvar', 'xvar'), false);
    expect(f.variable).toBeUndefined();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('CFF2');
    expect(fonts.get('NoGvar', 700)).toBe(f);
    expect(fonts.variationAxes()).toBeUndefined();
  });
  it('測る字の送りは、実体の送り。幅の軸のある書体は、font-stretch で字形を拡縮しない', async () => {
    const fonts = await setup();
    const m = new Measurer(fonts, 'fontkit');
    const upm = fk(varBuf).unitsPerEm;
    const g = m.glyph('H', { fontFamily: 'Any{wdth=75}', fontWeight: 400, fontSize: 10, stretch: 0.75 }, 'horizontal-tb');
    expect(g.scaleX).toBeUndefined();
    expect(g.advance).toBeCloseTo((ref('75,400') / upm) * 10, 9);
    // 字の組の詰めも実体の値
    const refFk = fk(statics.get('75,400')!);
    const kern = (refFk.layout('AV', { kern: true }).positions[0].xAdvance - refFk.glyphForCodePoint(0x41).advanceWidth) / upm;
    expect(kern).toBeLessThan(0);
    expect(m.kern('A', 'V', { fontFamily: 'Any{wdth=75}', fontWeight: 400 })).toBeCloseTo(kern, 9);
  });
});

describe('組版 (HTML + CSS): 可変フォントの軸', () => {
  const file = (name: string, data: ArrayBuffer) => ({ name, data: new Uint8Array(data) });
  const run = async (css: string, body: string, buf = varBuf): Promise<TypesetResult> =>
    typeset(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>@page { size: 200mm 100mm; margin: 10mm } body { font-size: 20pt; margin: 0 } ${css}</style></head><body>${body}</body></html>`, {
      files: [file('any.ttf', buf)],
      loadFont: loadCachedFont,
    });
  const glyphs = (r: TypesetResult): GlyphArea[] => {
    const out: GlyphArea[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'glyph') out.push(a as GlyphArea);
    });
    return out;
  };
  /** 静的な書体での字の送り (em) */
  const refAdvance = (key: string, ch: string) => fk(statics.get(key)!).glyphForCodePoint(ch.codePointAt(0)!).advanceWidth / fk(statics.get(key)!).unitsPerEm;
  /** 組んだ字の送り (em) */
  const em = (g: GlyphArea) => g.advance / g.fontSize;
  const RANGE = '@font-face { font-family: Any; src: url(any.ttf); font-weight: 100 900; font-stretch: 50% 150% } p { font-family: Any; margin: 0 }';

  it('font-weight: 範囲つきの @font-face の太字は、本物の太字 (擬似太字にしない)', async () => {
    const r = await run(RANGE, '<p>H<b>H</b><span style="font-weight: 900; font-stretch: 150%">H</span></p>');
    const [regular, bold, black] = glyphs(r);
    expect(regular.fontWeight).toBe(400);
    expect(bold.fontWeight).toBe(700);
    expect(bold.fakeBold).toBeUndefined();
    expect(em(bold)).toBeCloseTo(refAdvance('100,700', 'H'), 9);
    expect(em(black)).toBeCloseTo(refAdvance('150,900', 'H'), 9);
    expect(black.scaleX).toBe(1);
    expect(black.fontFamily).toBe('css:Any{;wdth=150}');
    // 使う書体の一覧に、実体の軸の値と、元の書体のファイルが入る
    const res = r.areaTree.resources!.fonts.filter((f) => f.variation);
    expect(res.map((f) => f.variation)).toEqual([
      { wdth: 100, wght: 400 },
      { wdth: 100, wght: 700 },
      { wdth: 150, wght: 900 },
    ]);
    expect(new Set(res.map((f) => f.sourceSha256)).size).toBe(1);
    expect(new Set(res.map((f) => f.sha256)).size).toBe(3);
    expect(res.map((f) => f.postscriptName)).toEqual(['Anybody_400wght', 'Anybody_700wght', 'Anybody_150wdth_900wght']);
    expect(r.warnings).toEqual([]);
  });
  it('font-stretch (font-width): 幅の軸の値になり、字形を拡縮しない', async () => {
    const r = await run(RANGE, '<p><span style="font-stretch: condensed">H</span><span style="font-width: 75%">H</span><span style="font-stretch: condensed"><span style="font-stretch: normal">H</span></span></p>');
    const [a, b, c] = glyphs(r);
    expect(em(a)).toBeCloseTo(refAdvance('75,400', 'H'), 9);
    expect(a.scaleX).toBe(1);
    expect(b.advance).toBe(a.advance);
    // 入れ子で normal に戻す
    expect(c.fontFamily).toBe('css:Any');
    expect(r.warnings).toEqual([]);
  });
  it('font-variation-settings: 軸の値を直に決める。font-weight・font-stretch より後 (§7.2)。子へ引き継ぐ', async () => {
    const r = await run(RANGE, `<p style='font-variation-settings: "wght" 900, "wdth" 150; font-stretch: 75%'>H<span>H</span><span style="font-variation-settings: normal">H</span></p>`);
    const [a, b, c] = glyphs(r);
    expect(em(a)).toBeCloseTo(refAdvance('150,900', 'H'), 9);
    expect(b.advance).toBe(a.advance);
    expect(em(c)).toBeCloseTo(refAdvance('75,400', 'H'), 9);
    expect(r.warnings).toEqual([]);
  });
  it('@font-face の font-weight が 1 つの値なら、太字は擬似太字のまま。記述子が無ければ本物の太字', async () => {
    const fixed = glyphs(await run('@font-face { font-family: Any; src: url(any.ttf); font-weight: 400 } p { font-family: Any }', '<p>H<b>H</b></p>'));
    expect(fixed[1].fakeBold).toBe(true);
    expect(fixed[1].advance).toBe(fixed[0].advance);
    const auto = glyphs(await run('@font-face { font-family: Any; src: url(any.ttf) } p { font-family: Any }', '<p>H<b>H</b></p>'));
    expect(auto[1].fakeBold).toBeUndefined();
    expect(em(auto[1])).toBeCloseTo(refAdvance('100,700', 'H'), 9);
  });
  it('font-style: 傾きの軸のある書体は、軸で傾ける (描くときに傾けない)。軸の無い書体は、これまでどおり擬似斜体', async () => {
    const slnt = retagAxis(varBuf, 'wdth', 'slnt', -12, 0, 0);
    const css = '@font-face { font-family: Any; src: url(any.ttf); font-weight: 100 900 } p { font-family: Any }';
    const g = glyphs(await run(css, '<p>H<i>H</i><span style="font-style: oblique 5deg">H</span><span style="font-style: oblique">H</span></p>', slnt));
    expect(g[0].fontFamily).toBe('css:Any');
    expect(g[1].italic).toBeUndefined();
    expect(g[1].fontFamily).toBe('css:Any{;slnt=-11}');
    expect(g[2].fontFamily).toBe('css:Any{;slnt=-5}');
    // oblique は 14deg (§2.5)。書体の範囲 (12deg まで) に収める
    expect(g[3].fontFamily).toBe('css:Any{;slnt=-12}');
    const plain = glyphs(await run(css, '<p>H<i>H</i></p>'));
    expect(plain[1].italic).toBe(true);
    expect(plain[1].fontFamily).toBe('css:Any');
  });
  it('font-optical-sizing: auto は字の大きさ (pt) を opsz に渡す。none は既定の値', async () => {
    const opsz = retagAxis(varBuf, 'wdth', 'opsz', 8, 14, 144);
    const css = '@font-face { font-family: Any; src: url(any.ttf); font-weight: 100 900 } p { font-family: Any }';
    const g = glyphs(await run(css, '<p>H<span style="font-size: 10pt">H</span><span style="font-optical-sizing: none">H<span style="font-size: 10pt">H</span></span><span style="font-size: 14pt">H</span></p>', opsz));
    expect(g[0].fontFamily).toBe('css:Any{;opsz=20}');
    expect(g[1].fontFamily).toBe('css:Any{;opsz=10}');
    expect(g[2].fontFamily).toBe('css:Any');
    expect(g[3].fontFamily).toBe('css:Any');
    // 既定の値と同じ大きさ (14pt) は、既定の形
    expect(g[4].fontFamily).toBe('css:Any');
  });
  it('fonts の選択肢で足した可変フォント: font-weight・font-stretch が軸の値になる', async () => {
    const r = await typeset(`<!DOCTYPE html><html lang="en"><head><style>@page { size: 200mm 100mm; margin: 10mm } p { font-family: Anybody; font-size: 20pt }</style></head><body><p>H<b>H</b><span style="font-stretch: 150%; font-weight: 900">H</span></p></body></html>`, {
      fonts: [file('Anybody.ttf', varBuf)],
      loadFont: loadCachedFont,
    });
    const [regular, bold, black] = glyphs(r);
    expect([regular.fontWeight, bold.fontWeight, black.fontWeight]).toEqual([400, 700, 900]);
    expect(bold.fakeBold).toBeUndefined();
    expect(em(bold)).toBeCloseTo(refAdvance('100,700', 'H'), 9);
    expect(em(black)).toBeCloseTo(refAdvance('150,900', 'H'), 9);
    expect(r.warnings).toEqual([]);
  });
  it('PDF: 実体ごとに、静的な書体 (部分書体) として埋める。字は取り出せる (ToUnicode)', async () => {
    const r = await run(RANGE, '<p>Regular <b>Bold</b> <span style="font-stretch: 75%">Narrow</span></p>');
    const pdf = await PDFDocument.load(await r.toPdf());
    const names: string[] = [];
    let toUnicode = 0;
    let fontFiles = 0;
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (obj.get(PDFName.of('Type')) === PDFName.of('Font') && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0')) {
        names.push(String(obj.get(PDFName.of('BaseFont'))));
        if (obj.get(PDFName.of('ToUnicode'))) toUnicode++;
      }
      if (obj.get(PDFName.of('FontFile2'))) fontFiles++;
    }
    // ほかに、ページ番号の書体 (Tinos) が 1 つ
    const mine = names.map((n) => n.replace(/^\/[A-Z]{6}\+/, '')).sort();
    expect(mine).toEqual(['Anybody_400wght', 'Anybody_700wght', 'Anybody_75wdth_400wght', 'Tinos-Regular']);
    expect(toUnicode).toBe(4);
    expect(fontFiles).toBe(4);
  });
  it('可変フォントを読み込んでいない文書の書体の名前には、印を付けない', async () => {
    const r = await typeset('<!DOCTYPE html><html><head><style>p { font-stretch: 75%; font-style: italic; font-variation-settings: "wght" 700 }</style></head><body><p>あA</p></body></html>', { loadFont: loadCachedFont });
    for (const g of glyphs(r)) expect(g.fontFamily).not.toMatch(/[{}]/);
    expect(glyphs(r)[0].scaleX).toBe(0.75);
    expect(r.warnings).toEqual([]);
  });
});

describe('組版 (XSL-FO): font-weight・font-stretch が可変フォントの軸の値になる', () => {
  it('files で渡した可変フォント', async () => {
    const fo = `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Anybody" font-size="20pt">H<fo:inline font-weight="bold">H</fo:inline><fo:inline font-weight="900" font-stretch="150%">H</fo:inline><fo:inline font-stretch="condensed">H</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(fo, { kind: 'fo', files: [{ name: 'Anybody.ttf', data: new Uint8Array(varBuf) }], loadFont: loadCachedFont });
    const g: GlyphArea[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'glyph') g.push(a as GlyphArea);
    });
    const refAdvance = (key: string) => fk(statics.get(key)!).glyphForCodePoint(0x48).advanceWidth / fk(statics.get(key)!).unitsPerEm;
    const em = (x: GlyphArea) => x.advance / x.fontSize;
    expect(g.map((x) => x.fontWeight)).toEqual([400, 700, 900, 400]);
    expect(g[1].fakeBold).toBeUndefined();
    expect(em(g[1])).toBeCloseTo(refAdvance('100,700'), 9);
    expect(em(g[2])).toBeCloseTo(refAdvance('150,900'), 9);
    expect(em(g[3])).toBeCloseTo(refAdvance('75,400'), 9);
    expect(g[3].scaleX).toBe(1);
  });
});
