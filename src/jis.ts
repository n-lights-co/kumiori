/**
 * JLREQ (日本語組版処理の要件。W3C。JIS X 4051 に基づく。https://www.w3.org/TR/jlreq/ ) の文字クラス (付録 A) に基づく禁則と、縦書き時の字形処理テーブル。
 * 基礎的な範囲 (行頭禁則・行末禁則・ぶら下げ) をカバーする。改行の機会そのもの (分離禁止・欧文の語の中など) は lineBreak.ts (UAX #14) が決める。
 */

import { verticalOrientation } from './lineBreak';

const set = (s: string) => new Set([...s]);

/** 行頭禁則: 閉じ括弧・句読点・約物・小書き仮名・長音・繰返し記号など */
const LINE_HEAD_PROHIBITED = set(
  [
    '）〕］｝〉》」』】〙〗〟’”｠»',
    '‐゠–〜～',
    '！？‼⁇⁈⁉',
    '・：；',
    '。．、，',
    'ヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ゝゞ',
    '!?)]},.:;%',
  ].join(''),
);

/** 行末禁則: 開き括弧類 */
const LINE_END_PROHIBITED = set('（〔［｛〈《「『【〘〖〝‘“｟«([{');

/** ぶら下げ可能 (句点・読点) */
const HANGABLE = set('。、．，.,');

/** 行頭禁則を緩めるとき (looseLineStart。axf:line-break="normal") に行頭に置いてよい字: 小書き仮名・長音記号 (繰返し記号は行頭禁則のまま。lineBreak.ts) */
const LOOSE_LINE_HEAD = set('ーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ');

export const isLineHeadProhibited = (ch: string, loose = false) => LINE_HEAD_PROHIBITED.has(ch) && !(loose && LOOSE_LINE_HEAD.has(ch));
export const isLineEndProhibited = (ch: string) => LINE_END_PROHIBITED.has(ch);
export const isHangable = (ch: string) => HANGABLE.has(ch);

/** 折り返しで改行でき、行末では捨てる空白 (U+0020・タブ)。改行しない空白 (U+00A0 など) は含まない (UAX #14 の GL。CSS Text 3 §4.1.2) */
export const isWrapSpace = (ch: string) => ch === ' ' || ch === '\t';

// ───────────────────────── 縦書き ─────────────────────────

/**
 * 縦書きで正立 (upright) させる字か。それ以外は 90° 時計回りに横倒し (rotate)。
 * UAX #50 の Vertical_Orientation (https://www.unicode.org/reports/tr50/ 、2026-11-04 取得) による (text-orientation: mixed。Writing Modes 3 §5.1):
 * U・Tu は正立、R は横倒し。Tr は縦書き用の字形があれば正立 (その字形に差し替える)、無ければ横倒し。
 * Kumiori は書体の vert の機能を使わず、縦書き用の字形は Unicode の縦書き用字形 (VERTICAL_FORMS) だけなので、Tr はその字があるものだけ正立
 */
export function isUprightInVertical(ch: string): boolean {
  const vo = verticalOrientation(ch.codePointAt(0)!);
  return vo === 'U' || vo === 'Tu' || (vo === 'Tr' && ch in VERTICAL_FORMS);
}

/** 縦書き用の字形 (Unicode 縦書き用字形 / Vertical Forms) */
const VERTICAL_FORMS: Record<string, string> = {
  '、': '︑',
  '。': '︒',
  '，': '︐',
  '「': '﹁',
  '」': '﹂',
  '『': '﹃',
  '』': '﹄',
  '（': '︵',
  '）': '︶',
  '｛': '︷',
  '｝': '︸',
  '〔': '︹',
  '〕': '︺',
  '【': '︻',
  '】': '︼',
  '《': '︽',
  '》': '︾',
  '〈': '︿',
  '〉': '﹀',
  '［': '﹇',
  '］': '﹈',
};

const PUNCT_SHIFT = set('、。，．');
const SMALL_KANA = set('ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ');
/** 縦書き用字形が無いフォント向けの回転フォールバック (括弧類) */
const BRACKET_ROTATE = set('「」『』（）｛｝〔〕【】《》〈〉［］');

export interface VerticalTreatment {
  /** 描画する文字 (縦書き用字形に差し替え後) */
  glyph: string;
  mode: 'upright' | 'rotate';
  /** em に対する比。物理座標 (右 +, 下 +) のオフセット */
  dx: number;
  dy: number;
  /** 字形を差し替える OpenType の機能 (書体の縦書き用の字形 vert を使うとき ['vert']) */
  features?: string[];
}

/**
 * 縦書き時の 1 文字の扱いを決める。
 * 書体が縦書き用の字形 (OpenType の vert。正立で組むための字形) を持つ字は、その字形で正立にする
 * (vert は縦書きで既定で使う機能。OpenType の機能の一覧の 'vert'、https://learn.microsoft.com/en-us/typography/opentype/spec/features_uz 、2026-11-04 取得)。
 * 正立にする字 (UAX #50 の U・Tu、text-orientation: upright の字) と、Tr の字で vert の字形があるものに使う (Tr は Writing Modes 3 §5.1 の mixed)。
 * vert の字形が無ければ、Unicode の縦書き用字形か、位置の補正で代える
 * 書体に vert があるのに、句読点 (、。，．) を替えないときは、既定の字形をそのまま正立で置く: 縦書きの字形の差し替えは書体の vert で行い
 * (Writing Modes 3 §5.1.1)、vert が替えない字は、既定の字形が縦書きにも使える形 (繁体字の書体の、字の枠の中央の句読点。clreq §5.1) なので、
 * Unicode の縦書き用字形 (右上に寄った字形) への差し替えも、位置の補正もしない
 * @param hasGlyph フォントが指定字形を持つか (縦書き用字形の存在確認)
 * @param hasVert 書体の vert がこの字を別の字形に替えるか
 * @param fontHasVert 書体が vert の機能を持つか (どの字かによらない)
 */
export function verticalTreatment(
  ch: string,
  hasGlyph: (c: string) => boolean,
  orientation: 'mixed' | 'upright' | 'sideways' = 'mixed',
  hasVert: (c: string) => boolean = () => false,
  fontHasVert = false,
): VerticalTreatment {
  // text-orientation: sideways はすべて横倒し、upright はすべて正立 (Writing Modes 3 §5.1)
  if (orientation === 'sideways') return { glyph: ch, mode: 'rotate', dx: 0, dy: 0 };
  const vo = verticalOrientation(ch.codePointAt(0)!);
  const upright = orientation === 'upright' || vo === 'U' || vo === 'Tu' || vo === 'Tr';
  if (upright && hasVert(ch)) return { glyph: ch, mode: 'upright', dx: 0, dy: 0, features: ['vert'] };
  if (orientation !== 'upright' && !isUprightInVertical(ch)) return { glyph: ch, mode: 'rotate', dx: 0, dy: 0 };
  if (fontHasVert && PUNCT_SHIFT.has(ch)) return { glyph: ch, mode: 'upright', dx: 0, dy: 0 };
  const vf = VERTICAL_FORMS[ch];
  if (vf && hasGlyph(vf)) return { glyph: vf, mode: 'upright', dx: 0, dy: 0 };
  if (BRACKET_ROTATE.has(ch)) return { glyph: ch, mode: 'rotate', dx: 0, dy: 0 };
  if (PUNCT_SHIFT.has(ch)) return { glyph: ch, mode: 'upright', dx: 0.55, dy: -0.6 };
  if (SMALL_KANA.has(ch)) return { glyph: ch, mode: 'upright', dx: 0.125, dy: -0.125 };
  return { glyph: ch, mode: 'upright', dx: 0, dy: 0 };
}

/** 全角幅で組む字か (縦書き正立時に advance = 1em とする) */
export function isFullWidth(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0xff61 && cp <= 0xff9f) return false; // 半角カナ
  if (cp >= 0xffe8 && cp <= 0xffee) return false;
  return isUprightInVertical(ch);
}

// ───────── 約物の詰め・和欧間アキ (JLREQ §3.1・§3.2 の基礎部分) ─────────

/** 終わり括弧類・句読点 (字面が前半にあり、後ろに二分のアキを持つ全角約物) */
const CLOSING_PUNCT = set('、。，．）〕］｝〉》」』】〙〗〟’”');
/** 始め括弧類 (字面が後半にあり、前に二分のアキを持つ) */
const OPENING_PUNCT = set('（〔［｛〈《「『【〘〖〝‘“');
/** 中点類 (前後に四分のアキ) */
const MIDDLE_PUNCT = set('・：；');
export const isClosingPunct = (ch: string) => CLOSING_PUNCT.has(ch);
export const isOpeningPunct = (ch: string) => OPENING_PUNCT.has(ch);
export const isMiddlePunct = (ch: string) => MIDDLE_PUNCT.has(ch);

/**
 * 和文 (仮名・漢字)。約物は含まない。
 * 範囲は CSS Text 4 §8.4.1 (text-autospace) の ideographs の定義による: U+3041〜30FF (約物 ゠・ を除く)・CJK の筆画 (U+31C0〜31EF)・
 * 片仮名の拡張 (U+31F0〜31FF)・漢字の用字の字。漢字の用字は Script=Han (拡張 B 以降の漢字・互換漢字・部首・々・〇・蘇州数字を含む) と、
 * 〆 (U+3006。Script は Common で、Script_Extensions が Han) で見る。Script_Extensions が Han の約物 (、。「」など) は入れない
 * (この定義は見直し中と仕様にあり、約物には別のアキの決まりがある)
 */
const HAN_SCRIPT = /^\p{Script=Han}$/u;
export function isIdeographicOrKana(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x2e80) return false;
  if ((cp >= 0x3041 && cp <= 0x30ff && ch !== '・' && ch !== '゠') || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) return true;
  if (cp === 0x3006 || (cp >= 0x31c0 && cp <= 0x31ff)) return true;
  return HAN_SCRIPT.test(String.fromCodePoint(cp));
}
/** 欧文の文字・数字 (和欧間アキの対象) */
export const isLatinAlnum = (ch: string) => /^[A-Za-z0-9À-ÖØ-öø-ɏ]$/.test(ch);
