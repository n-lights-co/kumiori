/**
 * 正書法の音節 — ミャンマー文字とラオ文字で、書記素クラスタ (UAX #29) より広い並びを、組版の 1 つの字の単位にする。
 *
 * CSS Text 3 の「Characters and Letters」の節 (§1.4。https://www.w3.org/TR/css-text-3/ 、2026-11-10 取得) は、組版の字の単位
 * (typographic character unit) を UAX #29 の拡張書記素クラスタを基に決め、用字の組版の習わしに合わせて UA が広げる (tailor) ものとし、
 * 例に「ミャンマー文字・デーヴァナーガリーでは、両端揃えと改行の単位は音節の全体で、2 つ以上の書記素クラスタを含みうる」を挙げる。
 *
 * Kumiori は、字の単位ごとに書体へ渡して字形を決める (measurer.ts の clusterGlyph・areaResources.ts)。書体の規則は、
 * クラスタをまたぐ並びで字形を決めるものがあり、クラスタごとに渡すと当たらない:
 *  - ミャンマー文字: 後ろに付く母音記号 AA (U+102B・U+102C)・VISARGA (U+1038) などは UAX #29 で前のクラスタにつながらない
 *    (Grapheme_Cluster_Break が SpacingMark でない)。書体は、メディアルの YA・キンジと AA の合字、積み重ね (VIRAMA U+1039) の前の空きの
 *    有無を、前後の字で決める (積み重ねの上の子音・ASAT U+103A の付いた子音は、前の音節の末子音)。
 *  - ラオ文字: 前に置く母音 (U+0EC0〜U+0EC4) の後ろの子音の上の記号、NIGGAHITA (U+0ECD) の後ろの AA (U+0EB2。SARA AM を 2 字で
 *    書いたもの) は、前後の字で字形・位置が変わる。
 * そこで、これらの並びだけ、前のクラスタとまとめて 1 つの単位にする。単位の中では改行せず、字間 (letter-spacing)・両端揃えの空きも入れない。
 * ほかの用字の字の単位は変えない
 */

/** ミャンマー文字の、基底の字に付く字 (母音記号・メディアル・声調記号・ASAT・VIRAMA など。Microsoft「Creating and Supporting OpenType Fonts for Myanmar Script」の字の種類の表の A・As・DB・H・MH・MR・MW・MY・PT・V・VAbv・VBlw・VPre・VPst) と、異体字セレクタ U+FE00 */
export function isMyanmarDependent(c: number): boolean {
  return (
    (c >= 0x102b && c <= 0x103e) ||
    (c >= 0x1056 && c <= 0x1059) ||
    (c >= 0x105e && c <= 0x1060) ||
    (c >= 0x1062 && c <= 0x1064) ||
    (c >= 0x1067 && c <= 0x106d) ||
    (c >= 0x1071 && c <= 0x1074) ||
    (c >= 0x1082 && c <= 0x108d) ||
    c === 0x108f ||
    (c >= 0x109a && c <= 0x109d) ||
    c === 0xa9e5 ||
    (c >= 0xaa7b && c <= 0xaa7d) ||
    c === 0xfe00
  );
}

/** ミャンマー文字 (U+1000〜U+109F と拡張 B U+A9E0〜U+A9FF・拡張 A U+AA60〜U+AA7F) の、音節の基底になりうる字 (上の「付く字」でないもの。子音・独立の母音・数字・記号) */
export function isMyanmarBase(c: number): boolean {
  return ((c >= 0x1000 && c <= 0x109f) || (c >= 0xa9e0 && c <= 0xa9fe) || (c >= 0xaa60 && c <= 0xaa7f)) && !isMyanmarDependent(c);
}

/** ミャンマー文字の子音・独立の母音 (音節を作る字。数字 U+1040〜1049・U+1090〜1099・U+A9F0〜A9F9 と、句読点・記号 U+104A〜104F・U+109E〜109F・U+AA70・U+AA77〜AA79 を除く) */
function isMyanmarLetter(c: number): boolean {
  if (!isMyanmarBase(c)) return false;
  if ((c >= 0x1040 && c <= 0x104d) || c === 0x104f || (c >= 0x1090 && c <= 0x1099) || c === 0x109e || c === 0x109f) return false;
  if ((c >= 0xa9f0 && c <= 0xa9f9) || c === 0xaa70 || (c >= 0xaa77 && c <= 0xaa79)) return false;
  return true;
}

/** ラオ文字の子音 (U+0E81〜U+0EAE と U+0EDC〜U+0EDF) */
function isLaoConsonant(c: number): boolean {
  return (c >= 0x0e81 && c <= 0x0eae) || (c >= 0x0edc && c <= 0x0edf);
}

/**
 * ほかの単位とまとめうる字で、UAX #29 ではクラスタをつながない字 (grapheme.ts の mayCluster の印に足す):
 * ラオ文字の前に置く母音・AA、ミャンマー文字の付く字 (Extend・SpacingMark の字は、UAX #29 の印が既にある)
 */
export function isOrthographicJoiner(c: number): boolean {
  return (c >= 0x0ec0 && c <= 0x0ec4) || c === 0x0eb2 || isMyanmarDependent(c);
}

/** 正書法の音節にまとめる用字 (ラオ文字・ミャンマー文字) の字を含みうるか (安い見分け) */
const ORTHOGRAPHIC_TEXT = /[຀-໿က-႟ꧠ-꧿ꩠ-ꩿ]/;

/**
 * 字の単位 next (書記素クラスタ) を、前の単位 prev (まとめ終わったもの) につないで 1 つの単位にするか。
 * ミャンマー文字 (prev が子音・独立の母音で始まるとき):
 *  - next が「付く字」で始まる (UAX #29 が前につながない母音記号 AA・VISARGA など)
 *  - next が、子音 + ASAT (U+103A。下の点 U+1037 が先でもよい) で始まる: 前の音節の末子音 (キンジも同じ並びで始まる)
 *  - next が、子音 + VIRAMA (U+1039) で始まる: 積み重ねの上の子音は、前の音節の末子音
 * ラオ文字:
 *  - prev が前に置く母音 (U+0EC0〜U+0EC4) 1 字で、next が子音で始まる。字間 (letter-spacing) が 0 でないとき (spaced) は、まとめない:
 *    字間は書記素クラスタの間に空ける (CSS Text 3 §7.2・§1.4 の例: タイ文字・ラオ文字の字間の単位は、書記素クラスタより広くない)
 *  - next が AA (U+0EB2) 1 字で、prev が NIGGAHITA (U+0ECD) を含む (SARA AM U+0EB3 を 2 字で書いた並び)
 */
function joins(prev: string, next: string, spaced: boolean): boolean {
  const n0 = next.charCodeAt(0);
  const p0 = prev.charCodeAt(0);
  if (isMyanmarLetter(p0)) {
    if (isMyanmarDependent(n0)) return n0 !== 0xfe00;
    if (!isMyanmarLetter(n0)) return false;
    const n1 = next.charCodeAt(1);
    return n1 === 0x103a || n1 === 0x1039 || (n1 === 0x1037 && next.charCodeAt(2) === 0x103a);
  }
  if (prev.length === 1 && p0 >= 0x0ec0 && p0 <= 0x0ec4) return !spaced && isLaoConsonant(n0);
  if (next === 'າ') return prev.includes('ໍ');
  return false;
}

/**
 * 字の単位の並び units (書記素クラスタにまとめ終わったもの) の、正書法の音節になる並びを、その場でまとめる (units を書き換える)。
 * mergedAt は、単位ごとの「2 字以上にまとめた単位か」(units と同じ添字。一緒に詰める)。spaced は、字間 (letter-spacing) が 0 でないか。
 * 1 つでもまとめたら true
 */
export function mergeOrthographicSyllables(units: string[], mergedAt?: boolean[], spaced = false): boolean {
  let hit = false;
  for (const u of units) {
    if (ORTHOGRAPHIC_TEXT.test(u)) {
      hit = true;
      break;
    }
  }
  if (!hit) return false;
  let any = false;
  let w = 0;
  for (let r = 1; r < units.length; r++) {
    if (joins(units[w], units[r], spaced)) {
      units[w] += units[r];
      if (mergedAt) mergedAt[w] = true;
      any = true;
    } else {
      w++;
      if (w !== r) {
        units[w] = units[r];
        if (mergedAt) mergedAt[w] = !!mergedAt[r];
      }
    }
  }
  if (units.length) {
    units.length = w + 1;
    if (mergedAt && mergedAt.length > w + 1) mergedAt.length = w + 1;
  }
  return any;
}

/**
 * 字の単位 unit の、最後の基底の字 (後ろの単位との字の組の詰めを引く字)。正書法の音節にまとめた単位は、基底の字を 2 つ以上含む
 * (ミャンマー文字の「子音 + 記号 + 末子音 + ASAT」、ラオ文字の「前に置く母音 + 子音」)。ほかの単位は、最初の字
 */
export function lastBaseOfUnit(unit: string): string {
  const first = String.fromCodePoint(unit.codePointAt(0)!);
  if (!ORTHOGRAPHIC_TEXT.test(first)) return first;
  let last = first;
  for (const ch of unit) {
    const c = ch.codePointAt(0)!;
    if (isMyanmarLetter(c) || isLaoConsonant(c)) last = ch;
  }
  return last;
}

/**
 * 2 字以上の字の単位 unit を書体に渡すときに足す OpenType の機能 (無ければ null)。字ごと・単位ごとに組む仕組みでは、単位の間の
 * 字の組の詰め (kern) は組版が別に扱うので、単位の中で要るものをここで足す:
 *  - 基底の字を 2 つ以上含む単位 (正書法の音節) と、ラオ文字の SARA AM (U+0EB3。書体に渡すときに NIGGAHITA と AA に分かれ、子音と AA の
 *    間に詰めがある) を含む単位: 中の字の組の詰め kern (font-kerning が有効なとき)
 */
export function unitFeatures(unit: string, opts: { kerning?: boolean }): string[] | null {
  if (opts.kerning && ORTHOGRAPHIC_TEXT.test(unit[0]) && (lastBaseOfUnit(unit) !== unit[0] || unit.includes('\u0EB3'))) return UNIT_KERN;
  return null;
}
const UNIT_KERN = ['kern'];

/**
 * 字の組の詰め (kern) を足す用字のブロック:  ラオ文字 (1)・チベット文字 (2)・ミャンマー文字 (3)・クメール文字 (4)・インド系の文字 (5。U+0900 デーヴァナーガリー〜U+0DFF シンハラ。
 * タミル文字の ன் と னை の間など、音節の間を詰める・空ける組を持つ)。ほかは 0。
 * これらの書体は、前に置く母音と子音の間 (ラオ)、ツェクと次の字の間 (チベット) などを詰める組を持つ (OpenType の kern。
 * 字の組の詰めは既定で有効: CSS Fonts 4 §6.3 の font-kerning: auto)
 */
export function kernScript(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x0900 && cp <= 0x0dff) return 5;
  if (cp < 0x0e81) return 0;
  if (cp <= 0x0edf) return 1;
  if (cp >= 0x0f00 && cp <= 0x0fff) return 2;
  if ((cp >= 0x1000 && cp <= 0x109f) || (cp >= 0xa9e0 && cp <= 0xa9ff) || (cp >= 0xaa60 && cp <= 0xaa7f)) return 3;
  if (cp >= 0x1780 && cp <= 0x17ff) return 4;
  return 0;
}
/** 2 つの字が、字の組の詰めを足す同じ用字 (kernScript) の字か */
/**
 * タイ文字の字 (U+0E01〜U+0E5B)。タイ文字の書体は、前に置く母音 (เ แ โ ใ ไ) と子音の間などを詰める組 (kern) を持つ。
 * 字の単位 (子音 + 上下の記号) の間の詰めは、基底の字の組で引く (書体の組の表は、記号を飛ばして引く指定)
 */
function isThaiLetter(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x0e01 && cp <= 0x0e5b;
}

/** 横書きでカーニングを掛ける字 (ASCII の英数字・記号と、ラテン文字の拡張、ギリシャ文字・キリル文字) */
function isLatinAlnumOrPunct(ch: string): boolean {
  // 一般句読点 (U+2010〜U+2027・U+2030〜U+205E。引用符 ‘’“”・ダッシュ・…) も含める (欧文の書体の kern の組に入っている。
  // element’s・‘a・r’ などの組を書体の kern の値で詰める)。
  // ギリシャ文字 (U+0370〜03FF・U+1F00〜1FFF)・キリル文字 (U+0400〜052F)・Latin Extended Additional (U+1E00〜1EFF。ベトナム語など) も、
  // 書体の kern の組で詰める (CSS Fonts 4 §6.3: font-kerning の初期値 auto。ГА・Те・Αυ などの組)
  return /^[\u0021-\u007E\u00C0-\u024F\u0370-\u052F\u1E00-\u1FFF\u2010-\u2027\u2030-\u205E]$/u.test(ch);
}

/**
 * 横書きで、字 a の後ろに b が続く組に、書体のカーニングを掛けるか (欧文の英数字・記号どうし、タイ文字どうし、同じ用字系の
 * 字の単位どうし)。行を組むとき (inlineLayout.ts の adjustJapaneseSpacing) と、中身の幅を見積もるとき (Measurer.textAdvance) で同じ判定を使う
 */
export function kernablePair(a: string, b: string): boolean {
  return (isLatinAlnumOrPunct(a) && isLatinAlnumOrPunct(b)) || (isThaiLetter(a) && isThaiLetter(b)) || kernsAsSameScript(a, b);
}

export function kernsAsSameScript(a: string, b: string): boolean {
  const k = kernScript(a);
  return k !== 0 && k === kernScript(b);
}
