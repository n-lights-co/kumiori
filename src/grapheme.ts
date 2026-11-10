/**
 * 書記素クラスタ (Unicode Text Segmentation、UAX #29 rev 49・Unicode 18.0.0。
 * https://www.unicode.org/reports/tr29/ 、2026-11-10 取得) の境目。
 *
 * 拡張書記素クラスタ (extended grapheme cluster。§3.1.1 の規則 GB1〜GB13・GB999 と Table 2 の字の性質) を、字の並びから決める。
 * 基底の字と結合文字 (e + U+0301、か + U+3099)、絵文字の並び (肌の色の修飾・ZWJ の並び・国旗・キーキャップ・タグの並び)、
 * ハングルの字母の並び、インド系の文字の子音の連なり (GB9c) が、それぞれ 1 つの単位になる。
 *
 * 組版では、この単位を「字の単位」(CSS Text 3 §1.3 の typographic character unit) として扱う: 改行・字間 (letter-spacing)・
 * 両端揃えの空きは、単位の間にだけ入る。
 *
 * Intl.Segmenter は使わない (実行環境の Unicode の版で結果が変わり、ブラウザと Node で組版がずれうるため)。字の性質の表は unicodeData.ts
 */
import { rangeTable } from './lineBreak';
import { EP_DATA, GCB_DATA, GCB_VALUES, INCB_DATA, INCB_VALUES } from './unicodeData';

/** Grapheme_Cluster_Break の値 (UAX #29 Table 2。どれでもない字は XX = Other) */
export const graphemeClusterBreak = rangeTable(GCB_DATA, GCB_VALUES, 'XX');
const indicConjunctBreak = rangeTable(INCB_DATA, INCB_VALUES, 'None');
const extPict = rangeTable(EP_DATA, ['', 'Y'], '');

/** 規則を順に当てるときの、前の字までの状態 */
interface State {
  /** 前の字の Grapheme_Cluster_Break ('' は並びの始め) */
  prev: string;
  /** 前の字まで続いている Regional_Indicator の数 (GB12・GB13) */
  ri: number;
  /** GB11: 1 = Extended_Pictographic Extend* まで来た、2 = その後ろに ZWJ が来た */
  pict: 0 | 1 | 2;
  /** GB9c: InCB=Linker の後ろに InCB=Extend だけが続いている */
  linker: boolean;
  /** 組版の字の単位 (clusterUnits) のときだけ: インド系の文字の結合子音を、UAX #29 の既定より広くまとめる (aksaraBreak) */
  aksara?: boolean;
  /** aksara のとき: 前の字 */
  prevCp?: number;
  /** aksara のとき: タミル文字で、つなぎ (ヴィラーマ) の前にあった子音 */
  tamilBase?: number;
}

const newState = (): State => ({ prev: '', ri: 0, pict: 0, linker: false });

/**
 * 組版の字の単位での、結合子音のつなぎ (GB9c の Indic_Conjunct_Break) の読み替え。
 *
 * UAX #29 の GB9c が結合子音を 1 つにまとめるのは、Indic_Conjunct_Break を持つ文字だけ (Unicode 18.0 のインド系では、デーヴァナーガリー・
 * ベンガル・グジャラート・オリヤー・テルグ・マラヤーラム)。それ以外の文字の結合子音は、既定では「子音 + ヴィラーマ」と次の子音に分かれる。
 * 組版では、字の単位ごとに書体へ渡して字形を決めるので、分かれると、書体の結合の字形 (下に付く子音・合字) にならず、ヴィラーマが
 * 見えたままの別々の字になる。UAX #29 §3 は、インド系の文字の正書法の音節 (aksara) を、既定の規則をあつらえる (tailoring) 例に挙げ、
 * あつらえは文字ごと・言語ごとでありうるとしている。CSS Text 3 §1.4 (Characters and Letters) も、字の単位 (typographic character unit) を
 * UAX #29 の拡張書記素クラスタを土台に、組版の習慣に合わせてあつらえるべきとし、音節全体が単位になる文字を例に挙げている。
 * そこで、次の文字の結合子音を 1 つの単位にする (文字ごとの結合の形は、Unicode 標準 12・13 章の各文字の節):
 *  - グルムキー: 子音 + ヴィラーマ (U+0A4D) + 子音 (下に付く ਰ・ਹ・ਵ・ਯ など)。
 *  - カンナダ: 子音 + ヴィラーマ (U+0CCD) + 子音 (下に付く子音)。
 *  - タミル: 合字になる 2 つだけ。க்ஷ (U+0B95 U+0BCD U+0BB7) と、ஸ்ரீ・ஶ்ரீ の「ஸ・ஶ + ヴィラーマ + ர」。ほかの「子音 + プッリ + 子音」は、
 *    プッリ (ヴィラーマ) の見える別々の字なので、まとめない。
 *  - シンハラ: 子音 + ヴィラーマ (U+0DCA) + ZWJ + 子音 (結合子音・ラカーランサヤ・ヤンサヤ・レパヤ) と、子音 + ZWJ + ヴィラーマ + 子音
 *    (接する字)。ZWJ の無い「子音 + ヴィラーマ + 子音」は、ヴィラーマの見える別々の字なので、まとめない。
 * どれも、ヴィラーマの後ろの ZWNJ (結合しない指定) では、既定どおり分かれる (ZWNJ は Indic_Conjunct_Break=Extend でない)。
 * 戻り値は、字 cp の Indic_Conjunct_Break の読み替え (incb は表の値)。前の字までの状態 s を見る (s は変えない)
 */
function aksaraBreak(s: State, cp: number, incb: string): string {
  if (cp === 0x200d) return s.prevCp === 0x0dca ? 'Linker' : incb;
  if (cp < 0x0a00 || cp > 0x0dff) return incb;
  if (cp <= 0x0a7f) return cp === 0x0a4d ? 'Linker' : (cp >= 0x0a15 && cp <= 0x0a39) || (cp >= 0x0a59 && cp <= 0x0a5e) ? 'Consonant' : incb;
  if (cp >= 0x0b80 && cp <= 0x0bff) {
    const p = s.prevCp;
    if (cp === 0x0bcd) return p === 0x0b95 || p === 0x0bb8 || p === 0x0bb6 ? 'Linker' : incb;
    if (s.linker && ((s.tamilBase === 0x0b95 && cp === 0x0bb7) || ((s.tamilBase === 0x0bb8 || s.tamilBase === 0x0bb6) && cp === 0x0bb0))) return 'Consonant';
    return incb;
  }
  if (cp >= 0x0c80 && cp <= 0x0cff) return cp === 0x0ccd ? 'Linker' : (cp >= 0x0c95 && cp <= 0x0cb9) || cp === 0x0cdd || cp === 0x0cde ? 'Consonant' : incb;
  if (cp >= 0x0d80) return cp === 0x0dca ? (s.prevCp === 0x200d ? 'Linker' : incb) : cp >= 0x0d9a && cp <= 0x0dc6 ? 'Consonant' : incb;
  return incb;
}

/** 前の字 (状態 s) と字 cp の間が、クラスタの境目か (GB3〜GB999)。並びの始め (GB1) は境目。呼んだ後、s は cp まで進む */
function boundaryBefore(s: State, cp: number): boolean {
  const a = s.prev;
  const b = graphemeClusterBreak(cp);
  let incb = b === 'Extend' || b === 'ZWJ' || b === 'XX' ? indicConjunctBreak(cp) : 'None';
  if (s.aksara) {
    incb = aksaraBreak(s, cp, incb);
    if (cp === 0x0bcd && incb === 'Linker') s.tamilBase = s.prevCp;
    s.prevCp = cp;
  }
  const ep = b === 'XX' && extPict(cp) === 'Y';
  let brk: boolean;
  if (a === '') brk = true; // GB1
  else if (a === 'CR' && b === 'LF') brk = false; // GB3
  else if (a === 'Control' || a === 'CR' || a === 'LF') brk = true; // GB4
  else if (b === 'Control' || b === 'CR' || b === 'LF') brk = true; // GB5
  else if (a === 'L' && (b === 'L' || b === 'V' || b === 'LV' || b === 'LVT')) brk = false; // GB6
  else if ((a === 'LV' || a === 'V') && (b === 'V' || b === 'T')) brk = false; // GB7
  else if ((a === 'LVT' || a === 'T') && b === 'T') brk = false; // GB8
  else if (b === 'Extend' || b === 'ZWJ') brk = false; // GB9
  else if (b === 'SpacingMark') brk = false; // GB9a
  else if (a === 'Prepend') brk = false; // GB9b
  else if (s.linker && incb === 'Consonant') brk = false; // GB9c
  else if (s.pict === 2 && ep) brk = false; // GB11
  else if (a === 'Regional_Indicator' && b === 'Regional_Indicator' && s.ri % 2 === 1) brk = false; // GB12・GB13
  else brk = true; // GB999
  s.prev = b;
  s.ri = b === 'Regional_Indicator' ? s.ri + 1 : 0;
  s.pict = ep ? 1 : s.pict === 1 && b === 'Extend' ? 1 : s.pict === 1 && b === 'ZWJ' ? 2 : 0;
  s.linker = incb === 'Linker' || (s.linker && incb === 'Extend');
  return brk;
}

/** 文字列を、拡張書記素クラスタに分ける (UAX #29 の規則どおり。CR LF も 1 つ) */
export function graphemeClusters(text: string): string[] {
  const out: string[] = [];
  const s = newState();
  for (const ch of text) {
    if (boundaryBefore(s, ch.codePointAt(0)!)) out.push(ch);
    else out[out.length - 1] += ch;
  }
  return out;
}

/**
 * 2 字以上のクラスタを作りうる字 (BMP) の印。Grapheme_Cluster_Break が Extend・ZWJ・SpacingMark・Prepend・Regional_Indicator・L・V・T の字
 * (LV・LVT は、前の L か後ろの V・T があるときだけつながるので、印は要らない。Extended_Pictographic・InCB=Consonant も、ZWJ・Linker が要る)
 */
let bmpJoiner: Uint8Array | undefined;
const JOINER = new Set(['Extend', 'ZWJ', 'SpacingMark', 'Prepend', 'Regional_Indicator', 'L', 'V', 'T']);
function loadBmpJoiner(): Uint8Array {
  const t = new Uint8Array(0x10000);
  for (let cp = 0x300; cp < 0x10000; cp++) if (JOINER.has(graphemeClusterBreak(cp))) t[cp] = 1;
  return t;
}

/**
 * 文字列が、2 字以上のクラスタを含みうるか (安い見分け。false なら、どの字も 1 字で 1 つの単位)。
 * U+0300 より前には、ほかの字とつながる字が無い (制御の字と CR LF だけ。CR LF は組版ではまとめない)
 */
export function mayCluster(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x300) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const cp = text.codePointAt(i)!;
      if (JOINER.has(graphemeClusterBreak(cp))) return true;
      if (cp > 0xffff) i++;
    } else if ((bmpJoiner ??= loadBmpJoiner())[c]) return true;
  }
  return false;
}

/** 行を分ける空白になる字 (General_Category が Zs)。組版では、空白を基底の字にしない */
function isSpaceSeparator(cp: number): boolean {
  return cp === 0x20 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/**
 * 字の単位の並び (文字列なら字ごと) を、組版の字の単位 (クラスタ) にまとめる。まとめるものが無ければ null。
 * UAX #29 の拡張書記素クラスタと、次の 4 点だけが違う:
 *  - インド系の文字の結合子音を、Indic_Conjunct_Break の無い文字 (グルムキー・カンナダ・タミル・シンハラ) でも 1 つの単位にする (aksaraBreak)。
 *  - CR と LF はまとめない (改行は字ごとに扱う)。
 *  - 空白 (Zs) を基底の字にしない。空白の後ろの結合文字は、その結合文字から新しい単位にする (UAX #14 の LB9 は、SP の後ろの結合文字を
 *    SP にまとめず、LB10 で独立の字 (AL) として扱う。空白は行末で捨てる・語間として伸縮するので、結合文字を載せない)。
 *  - 前の段階でまとめた 2 字以上の単位 (合字・つながる字の並び) は、そのまま 1 つの単位で、前後の字とはまとめない。
 * mergedAt を渡すと、戻り値の単位ごとに、ここでまとめた単位 (2 字以上のクラスタ) かを入れる
 */
export function clusterUnits(units: string | string[], mergedAt?: boolean[]): string[] | null {
  const out: string[] = [];
  const s = newState();
  s.aksara = true;
  let merged = false;
  /** いまの単位が、空白 1 字だけ */
  let spaceOnly = false;
  for (const u of units) {
    const cp = u.codePointAt(0)!;
    if (u.length > (cp > 0xffff ? 2 : 1)) {
      // 前の段階でまとめた単位: 前後とはまとめない
      out.push(u);
      Object.assign(s, newState(), { prevCp: undefined, tamilBase: undefined });
      spaceOnly = false;
      continue;
    }
    const wasCr = s.prev === 'CR';
    if (boundaryBefore(s, cp) || wasCr || spaceOnly) {
      out.push(u);
      spaceOnly = isSpaceSeparator(cp);
    } else {
      out[out.length - 1] += u;
      merged = true;
      if (mergedAt) mergedAt[out.length - 1] = true;
    }
  }
  return merged ? out : null;
}
