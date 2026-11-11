/**
 * inlineFlatten — inline の木 (文字列・inline・ルビ・画像・脚注の参照・leader・縦中横など) を、行分割の単位 (Atom) の並びに平らにする。
 * 字の計測 (Measurer) はここで 1 度だけ行い、字間・word-spacing・合字・つながる字・双方向の制御文字・罫線つき inline の枠を atom に持たせる。
 * 改行の機会 (markLineBreaks)・約物の詰め (adjustJapaneseSpacing)・分綴・双方向の深さは、この後で inlineLayout.ts が付ける。
 * inline の種類ごとの処理は flattenText・flattenInlineElement・… に分かれ、flattenInline がそれらを順に呼ぶ
 */
import type { LFootnote, LImage, LInline, LInlineContainer, LLeader, LPageNumberCitation, LRuby, LTateChuYoko, WritingMode } from './types';
import { isVariationSequence, UNIT_CLUSTER, UNIT_CONT, type GlyphMetrics, type Measurer } from './measurer';
import { mayCluster } from './grapheme';
import { NOT_WORD_INITIAL } from './fontkitShaping';
import { unitFeatures } from './orthographicSyllable';
import { inlineAreaMetrics, isGreekCyrillicLetter, normalLineBounds, type LoadedFont } from './fontManager';
import { LIGATURE_FEATURES, ligatureTable } from './ligature';
import { isWrapSpace } from './jis';
import { rangeTable } from './lineBreak';
import { JT_DATA, JT_VALUES } from './unicodeData';
import { lineHeightOf, newNode, resolveStyle, type ResolvedStyle } from './lnode';
import { withOpticalSize } from './fontVariation';
import { borderToLogicalWidths, normBorder, normEdges, toLogical } from './geometry';
import { sourceRef } from './sourceRef';
import type { Atom, FlattenState, InlineChild, InlineContentArea, InlineFrame } from './inlineLayout';

/**
 * 分綴した行の終わりに出す字の atom の並び。字は hyphenate-character (CSS Text 4 §6.3.2)・hyphenation-character (XSL 1.1 §7.10.5) の
 * 文字列 (hyphenLimits.character)、無ければ U+002D。空の文字列なら空の並び (何も出さずに分ける)。
 * 書式は、その字を含む並びの書式 (XSL §7.10.5: “The styling properties of this character are those inherited from its containing flow object”)。
 * 書体に無い字は、ほかの字と同じく、字を持つ書体で代える (Measurer.glyph)。和欧の混植の組では、U+2010 を、語の字と同じ欧文の書体から
 * 取る (glyphOf に latinWord の印を付けて呼ぶ。印が無いと、U+2010 は和文の書体の全角の字になる)
 */
export function hyphenAtoms(st: ResolvedStyle, glyphOf: (ch: string) => GlyphMetrics, runId: number, bg: Atom['bg']): Atom[] {
  return [...(st.hyphenLimits?.character ?? '-')].map((ch) => {
    const g = glyphOf(ch);
    return { kind: 'glyph', first: ch, last: ch, advance: g.advance, isSpace: false, runId, st, bg, g };
  });
}

/** 欧文の合字の字 (Unicode の互換用の合字) */
const LATIN_LIGATURES: Array<[string, string]> = [
  ['ffi', '\uFB03'],
  ['ffl', '\uFB04'],
  ['ff', '\uFB00'],
  ['fi', '\uFB01'],
  ['fl', '\uFB02'],
];

/** fi・fl などを合字の字に置き換える (has がその字を描けると答えたものだけ) */
function applyLatinLigatures(text: string, has: (ch: string, seq: string) => boolean): string {
  let out = text;
  for (const [seq, lig] of LATIN_LIGATURES) if (out.includes(seq) && has(lig, seq)) out = out.split(seq).join(lig);
  return out;
}

/** 書体が liga の機能を持たず (合字の表が無い)、等幅でもないか。このときは、書体が持つ合字の字形 (U+FB01 など) をそのまま使う。書体ごとに覚える */
const noLigaCache = new WeakMap<GlyphMetrics['font'], boolean>();
function fontLacksLigaButHasGlyphs(font: GlyphMetrics['font']): boolean {
  let v = noLigaCache.get(font);
  if (v === undefined) {
    try {
      const fk = font.fk as unknown as { availableFeatures?: string[]; post?: { isFixedPitch?: boolean } };
      v = !(fk.availableFeatures ?? []).includes('liga') && !fk.post?.isFixedPitch;
    } catch {
      v = false;
    }
    noLigaCache.set(font, v);
  }
  return v;
}

/**
 * 書体の合字の表 (OpenType の liga。features を渡せば、その合字の機能: dlig・hlig など) で、字の並び seq が 1 つの字形になるか。
 * 書体の整形 (fontkit の layout) の結果で確かめる。書体ごとに覚える
 */
const ligaCache = new WeakMap<GlyphMetrics['font'], Map<string, boolean>>();
const STANDARD_LIGA: readonly string[] = ['liga'];
function fontLigates(font: GlyphMetrics['font'], seq: string, features: readonly string[] = STANDARD_LIGA): boolean {
  let byFont = ligaCache.get(font);
  if (!byFont) ligaCache.set(font, (byFont = new Map()));
  const key = features === STANDARD_LIGA ? seq : `${features.join(',')}\u0000${seq}`;
  let v = byFont.get(key);
  if (v === undefined) {
    try {
      // 標準の合字 (liga) を使わないとき (任意の合字 dlig だけなど) は、liga・clig を切って、その機能だけで確かめる
      const feats = features.includes('liga') ? { kern: false, liga: true } : { kern: false, liga: false, clig: false };
      v = font.fk.layout(seq, { ...feats, ...Object.fromEntries(features.map((f) => [f, true])) } as never).glyphs.length === 1;
    } catch {
      v = false;
    }
    if (byFont.size > 20000) byFont.clear();
    byFont.set(key, v);
  }
  return v;
}

/** 書体の合字の表を引く機能の組: 有効な合字の機能に、clig (liga が有効なとき) と必須の合字 rlig を足す */
function tableFeaturesOf(features: readonly string[]): string[] {
  const out = [...features];
  if (out.includes('liga') && !out.includes('clig')) out.push('clig');
  if (!out.includes('rlig')) out.push('rlig');
  return out;
}

/** 合字の並びに入れない字 (空白・改行・制御の字)。空白をまたぐ合字は作らない (行の折り返し・語間の処理は空白を 1 つの単位として扱う) */
const NOT_IN_LIGATURE = /^[\s\u0000-\u001f\u00ad\u200b-\u200f\u2028-\u202e\u2066-\u2069]$/;

/**
 * 書体の合字の表 (ligature.ts) で、chars の i 字目から始まる合字の並びの字の数 (無ければ 1)。
 * 表の合字を、書体が並べた順 (優先する順。長い並びが先) に見て、最初に合ったものを使う (書体の整形と同じ区切りになる)。
 * 並びの字がみな同じ書体 font で描かれ、空白を含まず、書体の整形でも 1 つの字形になるときだけ
 */
function tableLigatureLength(chars: string[], i: number, font: GlyphMetrics['font'], fontAt: (k: number) => GlyphMetrics['font'] | null, features: readonly string[], tableFeatures: readonly string[]): number {
  const table = ligatureTable(font, tableFeatures);
  if (!table?.extended) return 1;
  const fk = font.fk as unknown as { glyphForCodePoint(cp: number): { id: number } };
  const gid = (k: number) => fk.glyphForCodePoint(chars[k].codePointAt(0)!).id;
  const ligs = table.byFirst.get(gid(i));
  if (!ligs) return 1;
  // 並びに使える字の続く長さ (表のいちばん長い並びまで)
  let run = 1;
  while (run < table.maxLen && i + run < chars.length && !NOT_IN_LIGATURE.test(chars[i + run]) && fontAt(i + run) === font) run++;
  if (run < 2) return 1;
  const ids = [0];
  for (let k = 1; k < run; k++) ids.push(gid(i + k));
  for (const comps of ligs) {
    const len = comps.length + 1;
    if (len < 2 || len > run) continue;
    let ok = true;
    for (let k = 1; k < len && ok; k++) ok = ids[k] === comps[k - 1];
    if (!ok) continue;
    const seq = chars.slice(i, i + len).join('');
    // 結合文字・ZWJ などを含む並び (書記素クラスタの道でまとめる) と、つながる字 (アラビア文字など。joiningUnits が並びごと書体に渡す) は、ここではまとめない
    if (mayCluster(seq) || JOINING_HINT.test(seq)) continue;
    if (fontLigates(font, seq, features)) return len;
  }
  return 1;
}

/**
 * 文字列を字の単位に分ける。合字にするときは、書体の liga で 1 つの字形になる欧文の字の並び (4〜2 字) を 1 単位にまとめる
 * (Unicode に合字の字の無い並び: fft・ffk など)。並びの字がみな同じ書体で描かれるときだけ。
 * fontOf は字を描く書体 (字ごとに 1 度だけ引く)。
 * opts.features は有効な合字の機能 (既定は liga)。opts.extended を真にすると、書体の合字の表 (GSUB の LookupType 4) にある並びを、
 * 字の種類・長さを限らずにまとめる (語をアイコンにする書体の twitter・arrow_back・3d_rotation など。空白はまたがない。BMP の字で始まる並びだけ)。
 * 表に無い並びは、従来どおり欧文の字の 4〜2 字を書体の整形で確かめる (文脈依存の置き換えで合字を作る書体のため)
 */
export function ligatureUnits(text: string, fontOf: (ch: string) => GlyphMetrics['font'] | null, opts?: { features?: readonly string[]; extended?: boolean }): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  const LATIN = /^[A-Za-zﬀ-ﬄ]$/;
  const latin = chars.map((ch) => LATIN.test(ch));
  const fonts: Array<GlyphMetrics['font'] | null | undefined> = new Array(chars.length);
  const fontAt = (k: number) => (fonts[k] === undefined ? (fonts[k] = fontOf(chars[k])) : fonts[k]);
  const features = opts?.features ?? STANDARD_LIGA;
  // 表を引く機能: 標準の合字は liga と clig (Fonts 4 §6.4 の common-ligatures)。必須の合字 (rlig) はいつも
  const tableFeatures = opts?.extended ? tableFeaturesOf(features) : null;
  // 欧文の字の並びを書体の整形で確かめるのは、任意の合字 (liga・dlig など) が有効なとき (必須の合字だけのときは、表にある並びだけ)
  const latinRule = features.some((f) => f !== 'rlig');
  for (let i = 0; i < chars.length; ) {
    let n = 1;
    if (tableFeatures && i + 1 < chars.length && chars[i].length === 1 && !NOT_IN_LIGATURE.test(chars[i])) {
      const f0 = fontAt(i);
      if (f0) n = tableLigatureLength(chars, i, f0, fontAt, features, tableFeatures);
    }
    if (n === 1 && latinRule && latin[i] && i + 1 < chars.length && latin[i + 1]) {
      // 欧文の字が続く長さ (4 字まで) の中で、同じ書体で描く字の並び
      let run = 1;
      while (run < 4 && i + run < chars.length && latin[i + run]) run++;
      const f0 = fontAt(i);
      let same = 1;
      while (same < run && f0 && fontAt(i + same) === f0) same++;
      for (let len = same; len >= 2; len--) {
        if (fontLigates(f0!, chars.slice(i, i + len).join(''), features)) {
          n = len;
          break;
        }
      }
    }
    out.push(n === 1 ? chars[i] : chars.slice(i, i + n).join(''));
    i += n;
  }
  return out;
}

/** 有効な合字の機能の組 (ligatureFeaturesOf の結果) */
interface LigatureFeatures {
  /** 有効な合字の機能 (書体の整形で並びを確かめるときに使う) */
  active: readonly string[];
  /** 書体の合字の表を引く機能 (active に clig・rlig を足したもの) と、その鍵 */
  table: readonly string[];
  tableKey: string;
  /** 合字の字形を測り・描くときの機能の組 (無ければ、書式の fontFeatures のまま) */
  style?: string[];
  /** active の鍵 */
  key: string;
  /** liga だけ (従来の合字) か */
  standard: boolean;
}

/**
 * 書式 st で有効な、任意の合字の機能。無ければ null。
 * ・標準の合字 (liga。font-variant-ligatures の既定・axf:ligature-mode) と、font-variant-ligatures・font-feature-settings で有効にした
 *   任意の合字 (dlig)・歴史的な合字 (hlig)・clig (CSS Fonts 4 §6.4・§6.12)
 * ・字間 (letter-spacing) が 0 でないときは、font-feature-settings で明示したもの (forcedLigatures) だけ
 *   (CSS Text 3 §7.2: 字の間の空きが 0 でないときは任意の合字を当てない。ただし font-feature-settings の指定はこの決まりより優先する。
 *   Fonts 4 §7.2 の順でも、letter-spacing による合字の無効化の後に font-feature-settings が当たる)
 */
function optionalLigaturesOf(st: ResolvedStyle): LigatureFeatures | null {
  const own = st.fontFeatures;
  if (st.letterSpacing) {
    if (!st.forcedLigatures?.length) return null;
    return ligFeatureSet(st.forcedLigatures, [...(own ?? []), ...st.forcedLigatures.filter((f) => !own?.includes(f))]);
  }
  const extra = own?.length ? own.filter((f) => f !== 'liga' && LIGATURE_FEATURES.includes(f)) : undefined;
  if (!st.latinLigatures) return extra?.length ? ligFeatureSet(extra, own!) : null;
  if (!extra?.length) return ligFeatureMemo.get(own ?? NO_FEATURES) ?? ligFeatureSet(STANDARD_LIGA, [...(own ?? []), 'liga'], own ?? NO_FEATURES);
  return ligFeatureSet(['liga', ...extra], [...own!, 'liga']);
}
const NO_FEATURES: string[] = [];

/** 字・結合文字・書式の制御の字で終わる (その後ろは語の途中) */
const WORD_INNER = /[\p{L}\p{M}\p{Cf}]$/u;
/** ベンガル文字 (U+0980〜U+09FF) で始まる字の単位 */
function isBengaliUnit(unit: string): boolean {
  const c = unit.charCodeAt(0);
  return c >= 0x0980 && c <= 0x09ff;
}
/** 語の途中の単位に足す印 (機能の名前でない。unitStyle で足し、隣の字との詰めを比べるときは fontFeaturesBetweenUnits が除く) */
const NOT_INITIAL = [NOT_WORD_INITIAL];
/** 標準の合字だけのときの結果 (書式の fontFeatures の配列ごと。文字列ごとに作り直さない) */
const ligFeatureMemo = new WeakMap<string[], LigatureFeatures>();
function ligFeatureSet(active0: readonly string[], style: string[], memoKey?: string[]): LigatureFeatures {
  const active = [...new Set(active0)];
  const table = tableFeaturesOf(active);
  const r: LigatureFeatures = { active, table, tableKey: table.join(','), style, key: active.join(','), standard: active.length === 1 && active[0] === 'liga' };
  if (memoKey) ligFeatureMemo.set(memoKey, r);
  return r;
}
/**
 * 必須の合字 (rlig) だけ。任意の合字が無効でも (font-variant-ligatures: none・字間のあるとき・axf:ligature-mode の無い XSL-FO)、必須の合字は当てる
 * (Fonts 4 §6.4「Required ligatures … are not affected by the settings above, including none」・§7.1、Text 3 §7.2 の注: 必須の合字は rlig)。
 * 語をアイコンにする書体には、名前の合字を rlig に入れたものがある (Material Icons 4.0.0)
 */
const REQUIRED_LIGATURES: LigatureFeatures = { active: ['rlig'], table: ['rlig'], tableKey: 'rlig', key: 'rlig', standard: false };

/** ligatureUnits の結果 (測る仕組みごと。文字列と書体の指定で引く) */
const ligatureUnitsCache = new WeakMap<object, Map<string, string[]>>();

const joiningType = rangeTable(JT_DATA, JT_VALUES, 'U');
/** つながる字を含みうる並び (これが無ければ joiningUnits を使わない。アラビア文字・シリア文字・ンコ文字・マンダ文字・モンゴル文字など) */
const JOINING_HINT = /[\u0600-\u08FF\u1800-\u18AF\uA840-\uA87F\u{10AC0}-\u{10AFF}\u{10B80}-\u{10BAF}\u{10D00}-\u{10D3F}\u{10F30}-\u{10F6F}\u{10FB0}-\u{10FDF}\u{1E900}-\u{1E95F}]/u;

/**
 * つながる字 (Joining_Type が D・R・L・C の字と、その後ろの T の字) の並びを 1 単位にまとめる。
 * アラビア文字などの字形 (語頭・語中・語尾・独立形と必須の合字) は、書体の字形の置き換えで並びごとに決まるので、並びをまとめて測り、描く。
 * sameFont はまとめる並びのすべての字を同じ書体で描けるか
 */
export function joiningUnits(units: string[], sameFont: (seq: string) => boolean): string[] {
  const out: string[] = [];
  const joins = (u: string) => /^[DRLC]$/.test(joiningType(u.codePointAt(0)!));
  const attaches = (u: string) => /^[DRLCT]$/.test(joiningType(u.codePointAt(0)!));
  const single = (u: string | undefined) => u !== undefined && [...u].length === 1;
  for (let i = 0; i < units.length; ) {
    let j = i + 1;
    if (units[i].length === 1 || /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(units[i])) {
      // つながる字の間のゼロ幅非接合子 (U+200C。ペルシャ語の می‌خواهم など) は、並びを分けずに書体に渡す: 書体が、その前後の字を
      // つながらない形 (語尾形・語頭形) にし、字の間の調整 (GPOS) も 1 つの語として行う。語の途中に字間・両端揃えの空きも入らない
      // (CSS Text 3 §6.4.4・§7.2.1: つながる文字の語の字の間には、つながるかどうかによらず、空きを入れない)。
      // モンゴル文字の並びは、母音分離子 (MVS U+180E) と、接尾辞の前の幅の狭い空白 (NNBSP U+202F) も含める (書体が、その前後の字の形を決める)
      const mongolian = isMongolianLetter(units[i]);
      if (joins(units[i]))
        while (
          j < units.length &&
          single(units[j]) &&
          (attaches(units[j]) ||
            (units[j] === ZWNJ && single(units[j + 1]) && joins(units[j + 1])) ||
            (mongolian && (units[j] === '\u180E' || units[j] === '\u202F') && j + 1 < units.length && isMongolianLetter(units[j + 1])))
        )
          j++;
    }
    // つながる字が 2 つ以上あり、同じ書体で描けるときだけまとめる
    const seq = units.slice(i, j).join('');
    const nJoin = units.slice(i, j).filter(joins).length;
    if (j - i > 1 && nJoin >= 2 && sameFont(seq)) out.push(seq);
    else for (let k = i; k < j; k++) out.push(units[k]);
    i = j;
  }
  return out;
}

/** モンゴル文字の字 (U+1820〜U+18AA。伝統的なモンゴル文字・トド・シベ・満洲) */
function isMongolianLetter(u: string): boolean {
  const c = u.charCodeAt(0);
  return u.length === 1 && c >= 0x1820 && c <= 0x18aa;
}

/** ギリシャ文字・キリル文字が 2 字続く所を含みうる文字列 (間に結合文字・語の中のハイフン・アポストロフィがあってもよい) */
const GREEK_CYRILLIC_PAIR = /[\u0370-\u052F\u1F00-\u1FFF][\p{M}\-\u2010'\u2019]*[\u0370-\u052F\u1F00-\u1FFF]/u;
const WORD_JOINER = /^[-\u2010'\u2019]$/;

/**
 * 欧文の書体で組む語の字に印を付ける: ギリシャ文字・キリル文字が 2 字以上続く語 (Россия・Ελλάδα・αβγ) の字。
 * 日本語の文書の既定の書体の組 (和文の書体 + 欧文の書体) では、和文の書体が基本のギリシャ文字・キリル文字を持つので、これらの字は和文の書体で
 * 組まれる。単独の 1 字 (α 線・Ω・β 版) はそれでよい (和文の字と並ぶ記号) が、語は、和文の書体が持たない字 (アクセントの付いたギリシャ文字、
 * ウクライナ語に固有の字など) だけが欧文の書体になり、1 つの語の中で書体が混ざる。語は、ラテン文字の語と同じく、欧文の書体で組む
 * (CSS Fonts 4 §2.1.5: 総称の書体は、字の範囲によって別の書体を組み合わせたものでよい。どう組み合わせるかは実装が決める)。
 * 語の決め方 (字の単位の並び units の上で):
 *  - 語の字は、ギリシャ文字・キリル文字の字 (isGreekCyrillicLetter。結合文字の付いた字の単位は、基底の字で見る)
 *  - 字と字の間のハイフン (U+002D・U+2010)・アポストロフィ (U+0027・U+2019) 1 つは、語をつなぐ (Санкт-Петербург は 1 つの語)。
 *    UAX #29 の語の境目 (WB6・WB7: 字の間の MidLetter では切らない) に倣い、ハイフンも加えた (ハイフンでつないだ語の前後で書体を変えない)
 *  - ラテン文字・数字・和字・空白・ほかの記号は、語を切る (μm の μ、β-カロテンの β、α線の α は 1 字なので、これまでどおり和文の書体)
 *  - 字が 2 つ以上ある語の、字の単位に印を付ける (ハイフン・アポストロフィには付けない。これらは元から欧文の字)
 * 同じ文字列 (1 つの inline の中の文字列) の中だけで見る (inline の境目をまたぐ語は、境目で切れる)
 */
export function markLatinWords(units: string[]): boolean[] | null {
  const letter = units.map((u) => isGreekCyrillicLetter(u));
  let marks: boolean[] | null = null;
  for (let i = 0; i < units.length; ) {
    if (!letter[i]) {
      i++;
      continue;
    }
    let j = i + 1;
    let n = 1;
    for (;;) {
      if (letter[j]) j++;
      else if (j + 1 < units.length && WORD_JOINER.test(units[j]) && letter[j + 1]) j += 2;
      else break;
      n++;
    }
    if (n >= 2) {
      marks ??= new Array<boolean>(units.length).fill(false);
      for (let k = i; k < j; k++) marks[k] = letter[k];
    }
    i = j;
  }
  return marks;
}

const ZWNJ = '\u200C';
/**
 * 単独の「描かない字」: 書式の制御の字 (Cf) で Default_Ignorable_Code_Point のもの (ZWNJ・ZWJ・LRM・RLM・ALM・WJ・双方向の制御文字など)。
 * 前の字とまとまらなかったもの (LRM・RLM・WJ は書記素クラスタを作らない。ZWNJ・ZWJ は、前がつながる字の並びのとき) は、幅 0 で、何も描かない:
 * Unicode 標準 §5.21 (Default Ignorable Code Points は、見える字形を出さず、送りも持たない)、CSS Text 3 §4 (書体が持たない
 * Default_Ignorable の字は、描画で無視する)・§7.2 (字間は、見えない幅 0 の書式の字 (Cf) を、無いものとして空ける)。
 * 書体は、これらの字を空白の字形に割り当てていることが多く (Tinos・Noto の各書体)、そのまま測ると空白 1 つ分の幅になる
 */
const LONE_IGNORABLE = /^(?=\p{Cf})\p{Default_Ignorable_Code_Point}$/u;

/** Unicode の Alphabetic (letter-spacing を空ける字。XSL §7.17.2) */
const ALPHABETIC = /\p{Alphabetic}/u;


/** flattenInline の 1 回の呼び出しの文脈 (inline の種類ごとの関数に渡す) */
interface FlattenCtx {
  st: ResolvedStyle;
  m: Measurer;
  state: FlattenState;
  bg?: string;
  wm: WritingMode;
  /** できた atom の並び (種類ごとの関数がここへ足す。前の子の最後の atom を書き換えるものもある: ソフトハイフン・結合文字の字間) */
  out: Atom[];
}

/** 枠 (罫線・余白つきの inline) の通し番号 */
let frameSeq = 0;

/** 入力の節 c から作った atom (start から後ろ) に、c の通し番号を付ける (中の inline の番号を先に付けたものは、そのまま) */
function markRef(out: Atom[], c: unknown, start: number): void {
  const r = sourceRef(c);
  if (r !== undefined) for (let q = start; q < out.length; q++) out[q].ref ??= r;
}

export function flattenInline(
  children: InlineChild[],
  st: ResolvedStyle,
  m: Measurer,
  state: FlattenState = { run: 0 },
  bg?: string,
): Atom[] {
  const cx: FlattenCtx = { st, m, state, bg, wm: st.wm, out: [] };
  const wm = cx.wm;
  for (const c0 of children) {
    const start0 = cx.out.length;
    // 欧文の合字 (axf:ligature-mode="latin")。書体が合字の字 (U+FB00〜U+FB04) を持つときはその字に置き換える (無い並びは、下で書体の liga を使う)
    // 字間 (letter-spacing) のあるときは、合字にしない (Text 3 §7.2)。font-feature-settings で liga を明示したときは、字間があっても合字にする (同じ節)
    // 合字の字に置き換えるのは、書体の liga がその並びを合字にするとき (Fonts 4 §6.4: 標準の合字は書体の liga が定める) と、
    // 書体が liga を持たないが合字の字形 (U+FB01 など) を持つとき (Tinos・Arimo など。等幅の書体は除く: 字幅を保つため)。
    // liga を持つのにその並びを合字にしない書体 (Source Code Pro など) は、合字の字形があっても合字にしない
    const c =
      typeof c0 === 'string' && st.latinLigatures && (!st.letterSpacing || !!st.forcedLigatures?.includes('liga')) && /f[fil]/.test(c0)
        ? applyLatinLigatures(c0, (ch, seq) => {
            const f = m.glyph('f', runStyleOf(st), wm).font;
            return m.glyph(ch, runStyleOf(st), wm).font === f && (fontLigates(f, seq) || fontLacksLigaButHasGlyphs(f));
          })
        : c0;
    if (typeof c === 'string') flattenText(c, cx);
    else if (c.type === 'inline') flattenInlineElement(c, cx);
    else if (c.type === 'ruby') flattenRuby(c, cx);
    else if (c.type === 'image' || c.type === 'inline-container') flattenInlineBox(c, cx);
    else if (c.type === 'page-number-citation') flattenCitation(c, cx);
    else if (c.type === 'footnote') flattenFootnoteRef(c, cx);
    else if (c.type === 'leader') flattenLeader(c, cx);
    else if (c.type === 'tate-chu-yoko') flattenTateChuYoko(c, cx);
    if (typeof c0 === 'object') markRef(cx.out, c0, start0);
  }
  return cx.out;
}

/** 文字列: 字ごとの atom (合字・つながる字の並びは 1 単位。ソフトハイフン・ゼロ幅空白・改行は印)。字間 (letter-spacing)・word-spacing はここで送りに足す */
function flattenText(c: string, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  // 合字: 書体の合字の機能 (liga。指定があれば dlig・hlig・clig も) で 1 つの字形になる並びを 1 単位に (横書きだけ)。
  // 候補は欧文の字の並び。語をアイコンにする書体のように、それに収まらない合字を持つ書体が読み込まれているときは、書体の合字の表から引く
  // 任意の合字が無効でも、必須の合字 (rlig) で語をアイコンにする書体が読み込まれていれば、その並びはまとめる
  const ligFeats = wm === 'horizontal-tb' && c.length > 1 ? (optionalLigaturesOf(st) ?? (m.hasExtendedLigatures(REQUIRED_LIGATURES.table, 'rlig') ? REQUIRED_LIGATURES : null)) : null;
  const ligExt = !!ligFeats && m.hasExtendedLigatures(ligFeats.table, ligFeats.tableKey);
  const ligSt = ligFeats && (ligExt || /[A-Za-zﬀ-ﬄ]{2}/.test(c)) ? { ...st, fontFeatures: ligFeats.style ?? st.fontFeatures } : null;
  let units0: string | string[] = c;
  if (ligSt && ligFeats) {
    // 同じ文字列・同じ書体の指定なら、前に分けた結果を使う (試し組みで同じ段落を何度も組む)
    const rs = runStyle(st);
    const key = `${rs.fontFamily}\u0000${rs.fontWeight}\u0000${rs.stretch ?? ''}\u0000${(rs.features ?? []).join(',')}\u0000${rs.orientation ?? ''}\u0000${ligFeats.key}${ligExt ? '+' : ''}\u0000${c}`;
    let hit = ligatureUnitsCache.get(m)?.get(key);
    if (!hit) {
      hit = ligatureUnits(c, (x) => m.glyph(x, rs, wm).font, ligFeats.standard && !ligExt ? undefined : { features: ligFeats.active, extended: ligExt });
      let byM = ligatureUnitsCache.get(m);
      if (!byM) ligatureUnitsCache.set(m, (byM = new Map()));
      if (byM.size > 20000) byM.clear();
      byM.set(key, hit);
    }
    units0 = hit;
  }
  // つながる字 (アラビア文字など) の並びは 1 単位にする。縦書きでは、横倒しで組むとき (text-orientation: mixed・sideways) だけ:
  // 横倒しの字は、横書きの組み方のまま 1 つの並びとして 90° 回す (CSS Writing Modes 3 §5.1.1 sideways typesetting)。
  // 正立で組むとき (upright) は、つながる文字も 1 字ずつ独立形で組む (同 upright typesetting)。
  // モンゴル文字 (縦書きの用字。字は横倒し = UAX #50 の Vertical_Orientation が R) も、この決まりで、横書きの字形を 90 度回して上から下へつなぐ
  const joinable = JOINING_HINT.test(c) && (wm === 'horizontal-tb' || st.textOrientation !== 'upright');
  const units1 = joinable
    ? joiningUnits(Array.from(units0), (seq) => {
        // 並びの中のゼロ幅非接合子 (U+200C) は、並びの書体がその字 (字形の無い字として隠す字) を持てばよい
        const fonts = Array.from(seq, (x) => (x === ZWNJ ? null : m.glyph(x, runStyle(st), wm).font));
        const f0 = fonts.find((f) => f);
        return !!f0 && fonts.every((f) => (f ? f === f0 : f0.fk.hasGlyphForCodePoint(0x200c)));
      })
    : units0;
  // 字の単位 (書記素クラスタ。UAX #29 の拡張書記素クラスタ): 基底の字と、その後ろの結合文字・異体字セレクタ (U+FE00〜FE0F・U+E0100〜E01EF)、
  // 絵文字の並び (肌の色・ZWJ・国旗・キーキャップ・タグ) などは、1 単位 (1 つの atom) にする。改行・字間 (letter-spacing)・両端揃えの空きは
  // 字の単位の間にだけ入る (CSS Text 3 §1.3 の typographic character unit、§5.1・§8.2)。
  // 結合文字・ZWJ などを含みうる文字列だけ、クラスタにまとめる (含まなければ、字ごとにそのまま)
  const clusters = mayCluster(c) ? m.resolveClusters(units1, runStyle(st), wm, !!st.letterSpacing) : null;
  const units = clusters ? clusters.units : units1;
  // ギリシャ文字・キリル文字の語を欧文の書体で組む (markLatinWords)
  const latinWords = !state.noLatinWords && GREEK_CYRILLIC_PAIR.test(c) ? markLatinWords(Array.from(units)) : null;
  let wi = 0;
  let ui = 0;
  // クラスタに当てる任意の合字の機能と、その書式 (要るときに 1 度だけ作る)
  let clusterLig: LigatureFeatures | null | undefined;
  let clusterLigSt: ResolvedStyle | undefined;
  // 前の字の単位 (同じ文字列の中)。語の途中かどうかを見る
  let unitBefore = '';
  for (const ch0 of units) {
    const before = unitBefore;
    unitBefore = ch0;
    const unitKind = clusters ? clusters.kinds[ui++] : 0;
    const inLatinWord = !!latinWords?.[wi++];
    // まとめて組むクラスタと、基底の字と異体字セレクタの並び: 字の種類で決まる処理 (禁則・約物の詰め・和欧間のアキ・字間) は基底の字
    // (並びの最初の字) で行い、描く文字列だけを並びにする
    const whole = unitKind === UNIT_CLUSTER;
    const variation = !whole && ch0.length > 1 && isVariationSequence(ch0);
    const ch = variation || whole ? String.fromCodePoint(ch0.codePointAt(0)!) : ch0;
    if (joinable && [...ch].length > 1 && JOINING_HINT.test(ch)) {
      // つながる字の並び: まとめて測り、描く (書体の字形の置き換えで、語頭・語中・語尾の形と必須の合字が決まる)
      // 縦書き: 並びを 1 つの書体でまとめて組み、横倒しにする (clusterGlyph。基底の字の向きで決まる: アラビア文字・モンゴル文字は横倒し)
      const g = wm === 'horizontal-tb' ? { ...m.glyph(ch, runStyle(st), wm), draw: ch } : m.clusterGlyph(ch, runStyle(st), wm);
      const chars = [...ch];
      out.push({ kind: 'glyph', first: chars[0], last: chars[chars.length - 1], advance: g.advance, isSpace: false, runId: state.run, st, bg, g });
      continue;
    }
    if (!variation && ligSt && ch.length > 1 && !/[\uD800-\uDBFF]/.test(ch[0])) {
      // 合字の字形: 字の並びをまとめて、liga を当てて測り、描く
      const g = { ...m.glyph(ch, runStyle(ligSt), wm), draw: ch };
      // 字間 (字間があっても合字になるのは、font-feature-settings で合字を明示したときと、必須の合字): 合字は 1 つの字の単位なので、
      // その後ろに空ける (Text 3 §7.2)。XSL の字間は、Alphabetic の字で始まる合字の前後に半分ずつ (下の 1 字のときと同じ。XSL §7.17.2)
      if (st.xslLetterSpacing && st.letterSpacing && ALPHABETIC.test(ch[0])) {
        const h = st.letterSpacing / 2;
        out.push({ kind: 'glyph', first: ch[0], last: ch[ch.length - 1], advance: g.advance + st.letterSpacing, isSpace: false, runId: state.run, st: ligSt, bg, g, dx: h, lsLead: h, lsTrail: h });
        continue;
      }
      const ls = st.letterSpacing && !st.xslLetterSpacing ? st.letterSpacing : 0;
      if (ls) {
        g.advance += ls;
        g.spacing = (g.spacing ?? 0) + ls;
      }
      out.push({ kind: 'glyph', first: ch[0], last: ch[ch.length - 1], advance: g.advance, isSpace: false, runId: state.run, st: ligSt, bg, g, ...(ls > 0 ? { lsTrail: ls } : {}) });
      continue;
    }
    if (ch === '\n') {
      out.push({ kind: 'break', first: '\n', last: '\n', advance: 0, isSpace: false, runId: state.run, st });
      continue;
    }
    if (ch === '\u00AD') {
      // ソフトハイフン (CSS Text 3 §5.3): 字形を描かず、そこで改行したときだけ行末にハイフンを出す分綴の位置にする
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'glyph' && prev.g) {
        // 行末に出す字は hyphenate-character (CSS Text 4 §6.3.2 の注: ソフトハイフンで分けたときも同じ字を出す)
        prev.hyphen = hyphenAtoms(st, (c) => m.glyph(c, { ...runStyle(st), latinWord: true }, wm), prev.runId, bg);
        prev.softHyphen = true;
      }
      continue;
    }
    if (ch === '\u200B') {
      // ゼロ幅空白: 字形を描かず、改行できる位置だけを作る (linefeed-treatment="treat-as-zero-width-space")
      out.push({ kind: 'box', first: ' ', last: ' ', advance: 0, isSpace: true, runId: state.run, st, bg, box: { node: newNode('block', wm, {}), adv: 0, cross: 0, above: 0, below: 0 } });
      continue;
    }
    if (!whole && !variation && unitKind !== UNIT_CONT && LONE_IGNORABLE.test(ch)) {
      // 単独の描かない字: 幅 0 で、字形を描かない (双方向の並べ替え・改行の決まりには、その字として加わる)
      // 行の高さには、その書式の空白の字と同じだけ加わる (字形を持つ代わりの書体の上下を、行の高さに持ち込まない)
      const g = { ...m.glyph(' ', runStyle(st), wm), ch, advance: 0, naturalWidth: 0 };
      out.push({ kind: 'glyph', first: ch, last: ch, advance: 0, isSpace: false, runId: state.run, st, bg, g, hidden: true });
      continue;
    }
    // まとめて組むクラスタ (絵文字の並びなど): 任意の合字の機能 (既定で有効な liga など) が有効で、書体のその機能が並びの字形を変えるときは、
    // その機能を当てて測り、描く (絵文字の並びの字形を liga で作る書体。Fonts 4 §7.1: 標準の合字は既定で有効)。変えないときは、従来のまま
    let ust = st;
    if (whole && wm === 'horizontal-tb') {
      if (clusterLig === undefined) clusterLig = optionalLigaturesOf(st);
      if (clusterLig?.style && m.clusterLigates(ch0, runStyle(st), clusterLig.active)) ust = clusterLigSt ??= { ...st, fontFeatures: clusterLig.style };
    }
    // 正書法の音節 (ミャンマー文字・ラオ文字) の中の字の組の詰め: その単位を書体に渡すときだけ、機能を足す (orthographicSyllable.ts)
    if (whole && wm === 'horizontal-tb') {
      const extra = unitFeatures(ch0, { kerning: st.kerning });
      if (extra && !extra.every((f) => ust.fontFeatures?.includes(f))) ust = unitStyle(ust, extra);
    }
    // ベンガル文字の語の途中の単位: 前に置く母音記号を語頭の形にしない (fontkitShaping.ts の「語頭の形」の補い)。語の途中 = 前の単位が
    // 字・結合文字で終わる (HarfBuzz のインド系の整形と同じ見分け: 前の字が字 (L)・結合文字 (M)・書式の制御 (Cf) なら語頭でない)
    if (whole && wm === 'horizontal-tb' && before && isBengaliUnit(ch0) && WORD_INNER.test(before)) ust = unitStyle(ust, NOT_INITIAL);
    const rsOf = (x: ResolvedStyle) => (inLatinWord ? { ...runStyle(x), latinWord: true } : runStyle(x));
    const g = whole ? m.clusterGlyph(ch0, rsOf(ust), wm) : variation ? m.variationGlyph(ch0, rsOf(st), wm) : m.glyph(ch, rsOf(st), wm);
    // 分けたクラスタの 2 つ目以降の字 (どの書体も並び全体を持たないとき。字ごとに組む): 前の字と同じ字の単位なので、前の字との間で改行せず、字間も空けない
    const cont = unitKind === UNIT_CONT;
    // 結合文字 (Mn・Me) の前には字間を空けない (letter-spacing は字の単位 (書記素クラスタ) の間に空ける。CSS Text 3 §8.2)
    const mark = cont || (!whole && /^[\p{Mn}\p{Me}]$/u.test(ch));
    const clusterProps = whole ? { cluster: ch0 } : cont ? { clusterCont: true, glue: true } : undefined;
    // 前の字の後ろの字間を、結合文字の後ろへ移す (字の単位の後ろに空ける)
    let movedLs = false;
    if (mark) {
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'glyph' && prev.lsTrail && prev.g) {
        prev.advance -= prev.lsTrail;
        prev.g.advance -= prev.lsTrail;
        prev.g.spacing = (prev.g.spacing ?? 0) - prev.lsTrail;
        g.advance += prev.lsTrail;
        g.spacing = (g.spacing ?? 0) + prev.lsTrail;
        delete prev.lsTrail;
        movedLs = true;
      }
    }
    if (st.xslLetterSpacing && st.letterSpacing) {
      // XSL: Alphabetic の字の前後に letter-spacing の半分ずつ (字面は前の半分だけ後ろへ)。それ以外の字には空けない
      if (!cont && ALPHABETIC.test(ch)) {
        const h = st.letterSpacing / 2;
        // 字の箱 (g.advance) は字の幅のまま。送り (advance) にだけ前後の空きを足す
        out.push({ kind: 'glyph', first: ch, last: ch, advance: g.advance + st.letterSpacing, isSpace: isWrapSpace(ch), runId: state.run, st: ust, bg, g, dx: h, lsLead: h, lsTrail: h, ...clusterProps, ...(inLatinWord ? { latinWord: true } : {}) });
        continue;
      }
    } else if (!mark && st.letterSpacing) {
      // 字間は字の送り (g.advance) に足す。足した分は g.spacing に残す (字形の送りと区別する: 鏡像の字への置き換え・横倒しの字の位置)
      g.advance += st.letterSpacing;
      g.spacing = (g.spacing ?? 0) + st.letterSpacing;
    }
    // word-spacing: 語を分ける字 (空白・ノーブレークスペースなど。Text 3 §7.1) の幅に足す
    if (st.wordSpacing && (ch === ' ' || ch === '\u00a0' || ch === '\u1361' || ch === '\u{10100}' || ch === '\u{10101}' || ch === '\u{1039F}' || ch === '\u{1091F}')) {
      g.advance += st.wordSpacing;
      g.spacing = (g.spacing ?? 0) + st.wordSpacing;
    }
    // 字の後ろの letter-spacing は、行末では捨てる (行に入るかの判定と行の幅に数えない)
    // 代わりの書体の字: 行の高さは、最初に使える書体 (空白の字の書体) の上下で決める (CSS Inline 3 §5.3)
    const primary = st.primaryFontMetrics ? m.glyph(primaryChar(st), runStyle(st), wm).font : undefined;
    out.push({
      kind: 'glyph',
      first: ch,
      last: ch,
      advance: g.advance,
      isSpace: isWrapSpace(ch),
      runId: state.run,
      st: ust,
      bg,
      g,
      ...clusterProps,
      ...(inLatinWord ? { latinWord: true } : {}),
      ...(st.letterSpacing > 0 && !st.xslLetterSpacing && (!mark || movedLs) ? { lsTrail: st.letterSpacing } : {}),
      ...(primary && primary !== g.font ? { primaryRatio: primary.baselineRatio, primaryFont: { ascent: primary.ascent, descent: primary.descent, baselineRatio: primary.baselineRatio } } : {}),
      ...(primary && primary !== g.font && st.lineHeightNormal ? fallbackNormalOf([g.font], primary, st.fontSize, wm) : {}),
    });
  }
}

/**
 * line-height: normal の字が代わりの書体 (fonts のうち、最初に使える書体 primary でないもの) で組まれたとき、それらの書体が
 * 行の高さに求める基線の上・下 (pt) を、Atom.fallbackNormal として返す (数える書体が無ければ、項目なし)。
 * CSS Inline 3 §5.3: normal の行内の箱は、中の字すべての書体の上下を囲む (fontManager.ts の normalLineBounds)
 */
function fallbackNormalOf(fonts: LoadedFont[], primary: LoadedFont, fontSize: number, wm: WritingMode): { fallbackNormal?: { above: number; below: number } } {
  let out: { above: number; below: number } | undefined;
  for (const f of fonts) {
    if (f === primary) continue;
    const b = normalLineBounds(f, primary, wm !== 'horizontal-tb');
    if (b) out = { above: Math.max(out?.above ?? 0, b.above * fontSize), below: Math.max(out?.below ?? 0, b.below * fontSize) };
  }
  return out ? { fallbackNormal: out } : {};
}

/** 字の単位に機能を足した書式 (元の書式と足す機能ごとに 1 つ) と、その元の書式の機能 */
const unitStyles = new WeakMap<ResolvedStyle, Map<string[], ResolvedStyle>>();
const unitBaseFeatures = new WeakMap<ResolvedStyle, { features: string[] | undefined }>();
function unitStyle(st: ResolvedStyle, extra: string[]): ResolvedStyle {
  let by = unitStyles.get(st);
  if (!by) unitStyles.set(st, (by = new Map()));
  let hit = by.get(extra);
  if (!hit) {
    hit = { ...st, fontFeatures: [...(st.fontFeatures ?? []), ...extra.filter((f) => !st.fontFeatures?.includes(f))] };
    by.set(extra, hit);
    unitBaseFeatures.set(hit, unitBaseFeatures.get(st) ?? { features: st.fontFeatures });
  }
  return hit;
}
/**
 * 書式の OpenType の機能のうち、字の単位の中だけのために足したもの (unitStyle) を除いたもの。隣の字との字の組の詰めは、これで比べ、これで引く
 * (単位の中の合字・詰めの機能の有無で、隣の字と書式が違うことにしない)
 */
export function fontFeaturesBetweenUnits(st: ResolvedStyle): string[] | undefined {
  const base = unitBaseFeatures.get(st);
  return base ? base.features : st.fontFeatures;
}

/** inline: 中身を自分の書式で平らにし、small-caps・unicode-bidi・空の支柱・罫線と余白の枠・外側の空き・id の目印・改行の禁止・baseline-shift・固定の長さを当てる */
function flattenInlineElement(c: LInline, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  let s2 = resolveStyle(st, { ...c, writingMode: undefined });
  state.run++;
  // 行を分ける改行 (行頭では無視する): 改行の atom にする
  if (c.softBreak) {
    out.push({ kind: 'break', soft: true, first: '\n', last: '\n', advance: 0, isSpace: false, runId: state.run, st: s2 });
    return;
  }
  let children = c.children as InlineChild[];
  if (c.smallCaps) {
    // small caps: 書体が smcp (all-small-caps は c2sc も) を持てば、その字形を使う。持たなければ、小文字 (all は大文字も) を
    // 字の大きさの 0.7 倍の大文字で代わりに組む (Fonts 4 §6.6: 書体に字形が無いときは合成する)
    const all = c.smallCaps === 'all';
    const feats = (m.glyph('a', runStyle(s2), wm).font as { fk?: { availableFeatures?: string[] } }).fk?.availableFeatures ?? [];
    if (feats.includes('smcp') && (!all || feats.includes('c2sc')) && wm === 'horizontal-tb')
      s2 = { ...s2, fontFeatures: [...(s2.fontFeatures ?? []), 'smcp', ...(all ? ['c2sc'] : [])] };
    else
      children = children.flatMap((k): InlineChild[] => {
        if (typeof k !== 'string') return [k];
        const out: InlineChild[] = [];
        for (const mm of k.matchAll(all ? /\p{L}+|[^\p{L}]+/gu : /\p{Ll}+|[^\p{Ll}]+/gu)) {
          const part = mm[0];
          const small = all ? /\p{L}/u.test(part) : /\p{Ll}/u.test(part);
          // 大文字と小文字の区別の無い字 (漢字・仮名) は、そのまま
          if (small && part.toUpperCase() !== part) out.push({ type: 'inline', fontSize: s2.fontSize * 0.7, children: [part.toUpperCase()] } as InlineChild);
          else out.push(part);
        }
        return out;
      });
  }
  const kids = flattenInline(children, s2, m, state, c.backgroundColor ?? bg);
  // 内容の領域 (CSS の inline): 背景・枠・リンクの範囲の、block 方向の広がり。この inline の最初に使える書体と字の大きさで決まる
  const area = c.backgroundColor || c.border || c.padding || c.link || c.annotation ? inlineContentArea(s2, m, wm) : undefined;
  // この inline の背景を引き継いだ字 (中の inline の字も。自分の背景を持つ inline の字は、その inline の領域が付いている) に、領域を付ける
  if (area && c.backgroundColor) {
    for (const a of kids) {
      if (a.bg && !a.bgArea) a.bgArea = area;
      for (const h of a.hyphen ?? []) if (h.bg && !h.bgArea) h.bgArea = area;
    }
  }
  // unicode-bidi: 中身の前後に双方向の制御文字を入れる (外側の inline の制御文字が外になる)
  const ctl = bidiControls(c.unicodeBidi, s2.direction === 'rtl');
  if (ctl && kids.length) {
    kids[0].bidiOpen = [...ctl[0], ...(kids[0].bidiOpen ?? [])];
    const last = kids[kids.length - 1];
    last.bidiClose = [...(last.bidiClose ?? []), ...ctl[1]];
  }
  // 中身の無い CSS の行内要素: 幅 0 の箱に、自分の字の大きさと line-height の高さ (支柱) を持たせる (CSS 2.1 §10.8)
  if (c.emptyStrut && !kids.length && wm === 'horizontal-tb') {
    const br = m.glyph(' ', runStyle(s2), wm).font.baselineRatio;
    const half = (lineHeightOf(s2) - s2.fontSize) / 2;
    const above = br * s2.fontSize + half;
    const below = (1 - br) * s2.fontSize + half;
    kids.push({ kind: 'box', idMark: true, first: '\uFFFC', last: '\uFFFC', advance: 0, isSpace: false, runId: ++state.run, st: s2, glue: true, ...(c.id ? { src: c.id } : {}), box: { node: newNode('block', wm, { isize: 0, bsize: 0 }), adv: 0, cross: 0, above, below } });
  }
  // 罫線・余白つきの inline: 始端・終端に「余白 + 罫線」ぶんの空き (atom) を置き、行を作るときに枠を描く。
  // リンク・注釈つきの inline も同じ枠の仕組みで、行ごとの範囲を求める (空きは置かない)
  const hasBox = !!(c.border || c.padding);
  if ((hasBox || c.link || c.annotation) && kids.length) {
    const frame: InlineFrame = { id: ++frameSeq, border: normBorder(c.border), padding: normEdges(c.padding), bg: c.backgroundColor, box: hasBox, ...(c.borderRadius ? { radius: c.borderRadius } : {}), ...(hasBox && c.boxDecorationBreak === 'clone' ? { clone: true } : {}), ...(hasBox && c.paintEffect ? { fx: c.paintEffect } : {}) };
    if (c.link) frame.link = c.link;
    if (c.annotation) frame.annot = c.annotation;
    if (area) frame.area = area;
    // clone の枠の margin (CSS の margin = bound) は、行で分かれた断片のそれぞれに付け直す (CSS Fragmentation 3 §5.4)
    if (frame.clone && c.inlineMargin?.bound && (c.inlineMargin.start || c.inlineMargin.end)) frame.cloneMargin = { start: c.inlineMargin.start ?? 0, end: c.inlineMargin.end ?? 0 };
    if (hasBox) {
      const pl = toLogical(frame.padding, wm);
      const bl = borderToLogicalWidths(frame.border, wm);
      const spacer = (adv: number, extra: Partial<Atom>): Atom => ({
        kind: 'box',
        first: '\uFFFC',
        last: '\uFFFC',
        advance: adv,
        isSpace: false,
        runId: ++state.run,
        st: s2,
        box: { node: newNode('block', wm, { isize: adv, bsize: 0 }), adv, cross: 0, above: 0, below: 0 },
        ...extra,
      });
      kids.unshift(spacer(pl.is + bl.is, { frameOpen: frame }));
      kids[1].glue = true; // 枠の始まりと最初の文字の間では改行しない
      kids.push(spacer(pl.ie + bl.ie, { frameClose: frame, glue: true }));
      state.run++;
    }
    frame.first = kids[0];
    for (const a of kids) a.frames = [frame, ...(a.frames ?? [])];
  }
  // 外側の空き (margin): 枠の外に、空白の箱を置く
  const im = c.inlineMargin;
  if (im && kids.length) {
    // CSS の margin (bound) は、箱の最初・最後の字と分けない: 行を分ける位置は、箱の margin の端の外 (CSS Text 3 §5.5: 箱の最初の字の前・
    // 最後の字の後ろの改行の機会では、箱のすぐ前・すぐ後ろ (margin の端) で分ける。CSS 2.1 §9.4.2: 行内の箱を分けた所では、margin・
    // border・padding は見えない = 分けていない端には付く)。改行の機会は markLineBreaks が edgeGap を見て付け直す。
    // 中身の無い箱 (支柱・目印だけ) は、これまでどおり (字が無いので、どちらの行に置くかは決まらない)。箱の端が空白のとき
    // (<span>五 </span> の終わりの側など) も、これまでどおり: 行を分けるのは箱の中の空白の所で、箱が分かれる
    const content = kids.filter((k) => !k.idMark && !k.frameOpen && !k.frameClose);
    const bound = (edge: Atom | undefined) => !!im.bound && !!edge && !edge.isSpace;
    const gap = (adv: number, edge: 'start' | 'end', on: boolean): Atom => ({ kind: 'box', first: '\uFFFC', last: '\uFFFC', advance: adv, isSpace: false, runId: ++state.run, st: s2, ...(on ? { edgeGap: edge } : {}), box: { node: newNode('block', wm, { isize: adv, bsize: 0 }), adv, cross: 0, above: 0, below: 0 } });
    if (im.start) {
      const on = bound(content[0]);
      kids.unshift({ ...gap(im.start, 'start', on), ...(on && im.dropStartAtWrap ? { dropAtWrap: true } : {}) });
    }
    if (im.end) kids.push(gap(im.end, 'end', bound(content[content.length - 1])));
    state.run++;
  }
  // inline の id は、最初の atom に付けて、その行が置かれたページで記録する (page-number-citation の参照先)
  if (c.id && kids.length && !kids[0].src) kids[0].src = c.id;
  // 中身の無い inline (HTML の <a id="…"></a> のような目印) は、幅 0 の箱で位置を記録する (前の字との間で改行しない)
  if (c.id && !kids.length)
    kids.push({ kind: 'box', idMark: true, first: '\uFFFC', last: '\uFFFC', advance: 0, isSpace: false, runId: ++state.run, st: s2, glue: true, src: c.id, box: { node: newNode('block', wm, { isize: 0, bsize: 0 }), adv: 0, cross: 0, above: 0, below: 0 } });
  // keep-together.within-line: inline の中では改行しない (2 つ目以降の atom の前で改行させない)
  if (c.noBreak) for (let q = 1; q < kids.length; q++) kids[q].glue = true;
  if (c.baselineShift) {
    const d = c.baselineShift === 'super' ? st.fontSize * 0.35 : c.baselineShift === 'sub' ? -st.fontSize * 0.2 : c.baselineShift;
    // 字と、行内の箱 (画像・数式など。枠の始まり・終わりの空きは除く) をずらす
    for (const a of kids) if (a.kind === 'glyph' || (a.kind === 'box' && !a.frameOpen && !a.frameClose)) a.shift = (a.shift ?? 0) + d;
    // この inline と、中の inline の内容の領域も、同じだけずらす (外側の inline の領域は、まだ付いていないので動かない)
    const areas = new Set<InlineContentArea>();
    for (const a of kids) {
      if (a.bgArea) areas.add(a.bgArea);
      for (const f of a.frames ?? []) if (f.area) areas.add(f.area);
    }
    for (const ar of areas) ar.shift += d;
  }
  out.push(...kids);
  if (c.width !== undefined) {
    // 固定の長さ (inline-progression-dimension) に満たない分は、余白 (inline の背景色が付く) で埋める
    const used = kids.reduce((a, k) => a + k.advance, 0);
    if (c.width > used + 0.01) {
      const fs = s2.fontSize;
      const br = m.glyph(' ', runStyle(s2), wm).font.baselineRatio;
      const w = c.width - used;
      out.push({
        kind: 'box',
        first: '\uFFFC',
        last: '\uFFFC',
        advance: w,
        isSpace: false,
        runId: kids.length ? kids[kids.length - 1].runId : state.run,
        st: s2,
        bg: c.backgroundColor ?? bg,
        box: { node: newNode('block', wm, { isize: w, bsize: fs }), adv: w, cross: fs, above: br * fs, below: (1 - br) * fs },
      });
    }
  }
  state.run++;
}

/**
 * inline の内容の領域 (inlineBoxFontMetrics の文書だけ。CSS 2.1 §10.6.1・CSS Inline 3 §6.4 の inline-sizing: normal):
 * 最初に使える書体 (空白の字の書体。§5.3) の上の高さ・下の深さ (書体のどの値を使うかは fontManager.ts の inlineAreaMetrics)。
 * 縦書きは、字が中央の基線にそろう (CSS Writing Modes 4 §4.2) ので、中央の基線を挟んで半分ずつ
 */
function inlineContentArea(st: ResolvedStyle, m: Measurer, wm: WritingMode): InlineContentArea | undefined {
  if (!st.inlineBoxFontMetrics) return undefined;
  const fm = inlineAreaMetrics(m.glyph(primaryChar(st), runStyleOf(st), wm).font);
  const above = fm.ascent * st.fontSize;
  const below = fm.descent * st.fontSize;
  if (wm !== 'horizontal-tb') return { above: (above + below) / 2, below: (above + below) / 2, shift: 0 };
  return { above, below, shift: 0 };
}

/** ルビ: 親文字とルビ文字をまとめて 1 つの atom にする */
function flattenRuby(c: LRuby, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  const s2 = resolveStyle(st, { ...c, writingMode: undefined });
  state.run++;
  // ruby-position: under (CSS Ruby 1 §4.1): rubyText を下側 (縦書きは左)、2 段目 (rubyTextUnder) を上側に置く
  const under = c.rubyPosition === 'under';
  const r = under ? m.ruby(c.baseText, c.rubyTextUnder ?? '', runStyle(s2), wm, s2.rubyScale, c.rubyText) : m.ruby(c.baseText, c.rubyText, runStyle(s2), wm, s2.rubyScale, c.rubyTextUnder);
  // CSS の行の高さ (primaryFontMetrics) では、下側に置いた注釈も行の高さに数えない (§3.6: 注釈の箱は行の中身の高さに数えず、
  // 上側と下側の厚さの合計が行間に収まらない分だけ空ける)。ruby-position: under のルビのほか、指定の無い 2 段目のルビ (下側) と、
  // 下側 (横書き)・左側 (vertical-rl) の圏点 (字ごとの 2 段目のルビとして置く。CSS Text Decoration 4 §3.4: 圏点の行の高さへの
  // 効き方はルビと同じ) も同じ
  if ((under || r.underExtent) && s2.primaryFontMetrics) r.roomExtent = r.rubyExtent + (r.underExtent ?? 0);
  const colors = under ? [c.rubyColorUnder, c.rubyColor] : [c.rubyColor, c.rubyColorUnder];
  // ruby-align (§4.3): 注釈・親文字ごとの値。無ければ、まわりから継承した値 (HTML の入力は space-around。XSL-FO の入力は無し = これまでの配り方)
  const [a1, a2, ab] = [c.rubyAlign ?? st.rubyAlign, c.rubyAlignUnder ?? st.rubyAlign, c.rubyAlignBase ?? st.rubyAlign];
  const aligns = under ? [a2, a1, ab] : [a1, a2, ab];
  const chars = [...c.baseText];
  // 親文字が代わりの書体の字なら、行の高さは最初に使える書体の上下で決める (字と同じ。CSS Inline 3 §5.3)
  const primary = s2.primaryFontMetrics ? m.glyph(primaryChar(s2), runStyle(s2), wm).font : undefined;
  const baseFont = r.baseGlyphs[0]?.font;
  out.push({
    kind: 'ruby',
    first: chars[0] ?? '',
    last: chars[chars.length - 1] ?? '',
    advance: r.advance,
    isSpace: false,
    runId: state.run,
    st: s2,
    bg,
    r,
    src: c.id,
    ...(c.rubyColor || c.rubyColorUnder ? { rubyColors: colors as [string | undefined, string | undefined] } : {}),
    ...(aligns.some((x) => x) ? { rubyAligns: aligns as NonNullable<Atom['rubyAligns']> } : {}),
    ...(primary && baseFont && primary !== baseFont ? { primaryRatio: primary.baselineRatio, primaryFont: { ascent: primary.ascent, descent: primary.descent, baselineRatio: primary.baselineRatio } } : {}),
    // line-height: normal の親文字が代わりの書体の字のとき、その書体の上下も行の高さに数える (字と同じ。CSS Inline 3 §5.3)
    ...(primary && s2.lineHeightNormal ? fallbackNormalOf(r.baseGlyphs.map((g) => g.font), primary, s2.fontSize, wm) : {}),
  });
  state.run++;
}

/** 画像・inline-container: Flow が組んだ行内の箱 (state.image / state.inlineBox) を atom にし、alignment-baseline で基線に対する位置を決める */
function flattenInlineBox(c: LImage | LInlineContainer, cx: FlattenCtx): void {
  const { st, m, state, wm, out } = cx;
  const runStyle = runStyleOf;
  const s2 = resolveStyle(st, { ...c, writingMode: undefined });
  let spec = c.type === 'image' ? state.image?.(c, s2) : state.inlineBox?.(c, s2);
  // 画像の下端・上端を字面の下端・上端に揃える (字面は最初に使える書体の上下)
  const lineAlign = c.type === 'image' && wm === 'horizontal-tb' ? (c.alignmentBaseline === 'line-bottom' ? 'bottom' : c.alignmentBaseline === 'line-top' ? 'top' : undefined) : undefined;
  if (spec && c.type === 'image' && c.alignmentBaseline && !lineAlign && wm === 'horizontal-tb') {
    const br = m.glyph(' ', runStyle(s2), wm).font.baselineRatio;
    const h = spec.above + spec.below;
    // central: 画像の中央を、字の em の箱の中央 (中央の基線。CSS Inline 3 §4.2.1・XSL §7.9.1) に揃える
    const below = c.alignmentBaseline === 'after-edge' ? (1 - br) * s2.fontSize : c.alignmentBaseline === 'central' ? h / 2 - (br - 0.5) * s2.fontSize : h - br * s2.fontSize;
    spec = { ...spec, above: h - below, below };
  }
  if (spec) {
    state.run++;
    // 行の中の、分けられない箱 (画像・inline-block) そのものには、飾りの線を引かない (CSS Text Decoration 3 §2。HTML の読み込みが decorateBox: false を付ける)
    const boxSt = c.decorateBox === false && s2.textDecoration ? { ...s2, textDecoration: undefined } : s2;
    out.push({ kind: 'box', first: '\uFFFC', last: '\uFFFC', advance: spec.adv, isSpace: false, runId: state.run, st: boxSt, bg: undefined, box: spec, ...(c.type === 'image' && c.noWrapInCellMin ? { noWrapInCellMin: true } : {}), ...(lineAlign ? { lineAlign } : {}) });
    state.run++;
  }
}

/** page-number-citation: 参照先のページ番号 (state.cite) の字を組み、2 回目の組版で差し替えられるよう印を付ける */
function flattenCitation(c: LPageNumberCitation, cx: FlattenCtx): void {
  const { st, m, state, bg, out } = cx;
  const s2 = resolveStyle(st, { ...c, writingMode: undefined });
  state.run++;
  const cited = flattenInline([state.cite?.(c.refId, c.last, c.format, c.physical, s2) ?? '?'], s2, m, state, bg);
  // 参照の字に印を付ける (2 回目の組版で、番号の幅が同じなら組み直さずに字だけ差し替える)
  const key = JSON.stringify([c.refId, c.last, c.format, c.physical]);
  for (const a of cited) a.cite = key;
  out.push(...cited);
  state.run++;
}

/** 脚注の参照記号: ラベルの字を小さく持ち上げて組む (先頭の字が本体への参照 fnRef を持つ) */
function flattenFootnoteRef(c: LFootnote, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  const label = state.footnote?.label(c) ?? '*';
  const base = c.referenceStyle ? resolveStyle(st, c.referenceStyle) : st;
  const refSize = st.fontSize * (c.referenceScale ?? state.footnote?.scale ?? 0.7);
  // 可変フォントの光学サイズ (書体の名前の印の opsz) は、小さくした字の大きさに合わせる
  const s2 = { ...base, fontSize: refSize, ...(base.varAxes ? { fontFamily: withOpticalSize(base.fontFamily, refSize, base.fontOpticalSizeUnit) } : {}), ...(c.referenceWeight ? { fontWeight: c.referenceWeight } : {}), ...(c.referenceLineHeight ? { lineHeightPt: c.referenceLineHeight } : {}) };
  const rs = c.referenceShift;
  const shift = rs === 'none' ? 0 : rs === 'sub' ? -st.fontSize * 0.2 : typeof rs === 'number' ? rs : st.fontSize * 0.35;
  state.run++;
  [...label].forEach((ch, k) => {
    const g = m.glyph(ch, runStyle(s2), wm);
    out.push({
      kind: 'glyph',
      first: ch,
      last: ch,
      advance: g.advance,
      isSpace: false,
      runId: state.run,
      st: s2,
      bg,
      g,
      glue: true,
      shift,
      fnRef: k === 0 ? c : undefined,
    });
  });
  state.run++;
}

/** leader: 点・線・文字列の繰り返しの atom (最小・最適・最大の長さは positionLine で伸縮する) */
function flattenLeader(c: LLeader, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  const s2 = resolveStyle(st, { ...c, writingMode: undefined });
  state.run++;
  const pattern = c.pattern ?? 'dots';
  let g: GlyphMetrics | undefined;
  let pitch = 0;
  let gs: GlyphMetrics[] | undefined;
  if (pattern === 'dots') {
    const chars = [...(c.patternText ?? (wm !== 'horizontal-tb' ? '・' : '.'))];
    g = m.glyph(chars[0] ?? '.', runStyle(s2), wm);
    // 点の間隔の既定は字の送り幅 (leader-pattern-width="use-font-metrics")
    // 字の幅より狭い leader-pattern-width は、字の幅にする (§7.22.3)
    pitch = Math.max(c.patternWidth ?? 0, g.advance);
    if (chars.length > 1) {
      // 文字列の繰り返し (leader-pattern="use-content")。単位の幅は字の送りの合計
      gs = chars.map((ch) => m.glyph(ch, runStyle(s2), wm));
      pitch = Math.max(c.patternWidth ?? 0, gs.reduce((a, x) => a + x.advance, 0));
    }
  }
  // 百分率の成分は、置く領域の寸法から決める。中身の長さを測るときは決められない (最小と最適は minimum、最大は無限)
  const pc = c.lengthPct;
  const res = (k: 'minimum' | 'optimum' | 'maximum') => (pc?.[k] === undefined ? c.length?.[k] : state.intrinsic || state.containerI === undefined ? undefined : pc[k]! * state.containerI);
  // CSS の leader(): 繰り返す字は少なくとも 1 回は見せる (Content 3 §2.5.2)
  const min = Math.max(res('minimum') ?? 0, c.cssLeader && pattern === 'dots' ? pitch : 0);
  const opt = Math.max(state.intrinsic && pc?.optimum !== undefined ? min : (res('optimum') ?? 0), min);
  // 中身の長さを測るときは伸ばさない (伸びた長さが列の幅を決めてしまわないように)
  const max = state.intrinsic ? opt : Math.max(res('maximum') ?? Infinity, opt);
  out.push({
    kind: 'leader',
    first: '',
    last: '',
    advance: opt,
    isSpace: false,
    runId: state.run,
    st: s2,
    bg,
    leader: { pattern, g, ...(gs ? { gs } : {}), pitch, thickness: c.ruleThickness ?? 0.5, ...(c.ruleStyle && c.ruleStyle !== 'solid' ? { ruleStyle: c.ruleStyle } : {}), min, opt, max, ...(c.cssLeader ? { css: true } : {}), ...(c.cssLeaderFromStart ? { fromStart: true } : {}), ...(c.alignment && pattern === 'dots' ? { align: c.alignment } : {}) },
    src: c.id,
  });
  state.run++;
}

/** 縦中横: 縦書きなら 1 つの atom に (潰れすぎるときは横倒しの字に戻す)。横書きなら中の文字列をそのまま組む */
function flattenTateChuYoko(c: LTateChuYoko, cx: FlattenCtx): void {
  const { st, m, state, bg, wm, out } = cx;
  const runStyle = runStyleOf;
  const s2 = resolveStyle(st, { ...c, writingMode: undefined });
  if (wm !== 'horizontal-tb') {
    state.run++;
    const t = m.tateChuYoko(c.text, runStyle(s2));
    if (!t.fits && !c.fit) {
      // 潰れすぎる場合は縦中横にせず、欧文と同じ横倒し組みにフォールバック (CSS の縦中横 (fit) は縮めて 1em に収める)
      out.push(...flattenInline([c.text], s2, m, state, bg));
      state.run++;
      return;
    }
    const chars = [...c.text];
    out.push({
      kind: 'tcy',
      first: chars[0] ?? '',
      last: chars[chars.length - 1] ?? '',
      advance: t.advance,
      isSpace: false,
      runId: state.run,
      st: s2,
      bg,
      t,
      src: c.id,
    });
    state.run++;
  } else {
    state.run++;
    out.push(...flattenInline([c.text], s2, m, state, bg));
    state.run++;
  }
}

/**
 * unicode-bidi の inline の、中身の前と後ろに入れる双方向の制御文字 (Writing Modes 3 §2.4.2 の表)。normal は undefined
 */
export function bidiControls(ub: Atom['st']['unicodeBidi'], rtl: boolean): [number[], number[]] | undefined {
  switch (ub) {
    case 'embed':
      return [[rtl ? 0x202b : 0x202a], [0x202c]];
    case 'isolate':
      return [[rtl ? 0x2067 : 0x2066], [0x2069]];
    case 'bidi-override':
      return [[rtl ? 0x202e : 0x202d], [0x202c]];
    case 'isolate-override':
      return [[0x2068, rtl ? 0x202e : 0x202d], [0x202c, 0x2069]];
    case 'plaintext':
      return [[0x2068], [0x2069]];
    default:
      return undefined;
  }
}

/** 計測 (Measurer.glyph) に渡すスタイル (書体・大きさ・字幅の伸縮・OpenType の機能・縦書きの字の向き) */
export function runStyleOf(s: ResolvedStyle) {
  return { fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontSize: s.fontSize, stretch: s.fontStretch, features: s.fontFeatures, orientation: s.textOrientation, ...(s.fontOpticalSizeUnit ? { opticalSizeUnit: s.fontOpticalSizeUnit } : {}) };
}

/**
 * 最初に使える書体を探す字 (CSS Inline 3 §5.3 の first available font: 空白の字の書体)。
 * アンテナハウス互換 (primaryFontByLang) では、lang が日本語・中国語・韓国語なら和文の字 (国) の書体
 */
export function primaryChar(st: { primaryFontByLang?: boolean; language?: string }): string {
  return st.primaryFontByLang && st.language && /^(ja|zh|ko)\b/i.test(st.language) ? '\u56FD' : ' ';
}
