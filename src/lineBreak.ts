/**
 * 改行の機会 (Unicode Line Breaking Algorithm、UAX #14 rev 57・Unicode 18.0.0。
 * https://www.unicode.org/reports/tr14/ 、2026-11-04 取得)。
 *
 * 規則 LB1〜LB31 を書かれた順に当て、字と字の間ごとに「必ず改行 (!)・改行しない (×)・改行してよい (÷)」を決める。
 * 調整 (tailoring) は CSS Text 3 §5.2 の line-break による (strict・normal・loose・anywhere。normal・loose の、日本語・中国語だけの決まりを含む)。
 * アンテナハウス互換の axf:line-break="normal" (looseLineStart) は、小書き仮名・長音記号 (CJ) の前で改行してよいとする
 * (axf:line-break="normal" では、JLREQ §3.1.7 の行頭禁則の字のうち、UAX #14 で NS でない字 (小書きの仮名 cl-11・長音記号 cl-10) の禁則処理をしない。
 * JLREQ §3.1.7 の注は繰返し記号「々」も行頭に置いてよい方法を挙げるが、繰返し記号は NS なので行頭禁則のままにする)。
 * JLREQ §3.1.10 の分割禁止のうち、数字と後置省略記号 (cl-13) の全角の単位記号の間は、どの調整でも改行しない。
 */
import { EA_DATA, EA_VALUES, EP_DATA, GC_DATA, GC_VALUES, LB_DATA, LB_VALUES, VO_DATA, VO_VALUES } from './unicodeData';

/** 範囲の表 (unicodeData.ts の形) を読み、字の値を引けるようにする */
export function rangeTable(data: string, values: string[], dflt: string): (cp: number) => string {
  let starts: Int32Array | undefined;
  let ends: Int32Array | undefined;
  let vals: Uint8Array | undefined;
  const load = () => {
    const parts = data ? data.split(';') : [];
    starts = new Int32Array(parts.length);
    ends = new Int32Array(parts.length);
    vals = new Uint8Array(parts.length);
    let prev = 0;
    parts.forEach((p, i) => {
      const [d, l, v] = p.split(',').map((x) => parseInt(x, 36));
      starts![i] = prev + d;
      ends![i] = prev + d + l;
      vals![i] = v;
      prev = ends![i] + 1;
    });
  };
  return (cp: number) => {
    if (!starts) load();
    let lo = 0;
    let hi = starts!.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < starts![mid]) hi = mid - 1;
      else if (cp > ends![mid]) lo = mid + 1;
      else return values[vals![mid]];
    }
    return dflt;
  };
}

/** Line_Break の値 (UAX #14 の表の値。LB1 の解決の前) */
export const lineBreakClass = rangeTable(LB_DATA, LB_VALUES, 'XX');
/** East_Asian_Width の値 */
export const eastAsianWidth = rangeTable(EA_DATA, EA_VALUES, 'N');
/** Vertical_Orientation の値 (UAX #50): R・U・Tu・Tr */
export const verticalOrientation = rangeTable(VO_DATA, VO_VALUES, 'R') as (cp: number) => 'R' | 'U' | 'Tu' | 'Tr';
const gcOf = rangeTable(GC_DATA, GC_VALUES, '');
const extPict = rangeTable(EP_DATA, ['', 'Y'], '');

/** 改行の厳しさ (CSS Text 3 §5.2 の line-break)。auto は normal として扱う */
export type LineBreakStrictness = 'strict' | 'normal' | 'loose' | 'anywhere';

export interface LineBreakOptions {
  strictness?: LineBreakStrictness;
  /** 日本語・中国語の文書 (CSS Text 3 §5.2 の normal・loose の決まりの一部は、日本語・中国語だけ) */
  cjk?: boolean;
  /** アンテナハウス互換: 小書き仮名・長音記号の前で改行してよい (axf:line-break="normal") */
  looseLineStart?: boolean;
  /**
   * SY (斜線) の後ろの改行の機会を、次の改行の機会までの字の数がこれより少なければ使わない
   * (UAX #14 §5.1 SY の推奨。最小の距離は実装で決める。指定が無ければ UAX #14 の規則どおり使う)
   */
  symbolBreakMinDistance?: number;
}

/** 字と字の間: 必ず改行・改行しない・改行してよい */
export type BreakAction = '!' | '×' | '÷';

const ITERATION_MARKS = new Set([0x3005, 0x303b, 0x309d, 0x309e, 0x30fd, 0x30fe]);
const CJK_HYPHENS = new Set([0x301c, 0x30a0]);
const CENTERED = new Set([0x30fb, 0xff1a, 0xff1b, 0xff65, 0x203c, 0x2047, 0x2048, 0x2049, 0xff01, 0xff1f]);
const DOTTED_CIRCLE = 0x25cc;
/**
 * JLREQ の後置省略記号 (付録 A.13、cl-13) のうち、UAX #14 で数の後ろの改行を止めない字 (全角の単位記号。Line_Break が ID)。
 * 字は JLREQ の付録 A の cl-13 (後置省略記号) の表による (https://www.w3.org/TR/jlreq/ 、2026-11-03 取得)
 */
const JIS_POSTFIX_SQUARES = new Set([0x33cb, 0x3303, 0x330d, 0x3314, 0x3318, 0x3322, 0x3323, 0x3326, 0x3327, 0x332b, 0x3336, 0x333b, 0x3349, 0x334a, 0x334d, 0x3351, 0x3357, 0x338e, 0x338f, 0x339c, 0x339d, 0x339e, 0x33a1, 0x33c4]);

interface Elem {
  /** 解決した後の Line_Break の値 */
  c: string;
  cp: number;
  /** $EastAsian (East_Asian_Width が F・W・H) */
  eastAsian: boolean;
  gc: string;
  ep: boolean;
  /** 元の並びでの位置 (この要素の最初の字) */
  pos: number;
}

/** LB1 と、CSS の line-break による調整: 値を解決する */
function resolveClass(cp: number, o: LineBreakOptions): string {
  const raw = lineBreakClass(cp);
  const s = o.strictness ?? 'normal';
  let c = raw;
  if (raw === 'AI' || raw === 'SG' || raw === 'XX') c = 'AL';
  else if (raw === 'SA') c = /^M[nc]$/.test(gcOf(cp)) ? 'CM' : 'AL';
  else if (raw === 'CJ') c = s === 'loose' || o.looseLineStart ? 'ID' : 'NS';
  // CSS Text 3 §5.2: 繰返し記号の前は loose だけ改行してよい
  if (ITERATION_MARKS.has(cp) && s === 'loose') c = 'ID';
  if (o.cjk) {
    // 〜・゠ の前は normal・loose で改行してよい
    if (CJK_HYPHENS.has(cp) && s !== 'strict') c = 'ID';
    if (s === 'loose') {
      // 中点類・感嘆符類の前は loose で改行してよい。後置記号の前・前置記号の後ろは、字の種類は変えずに
      // 改行の機会だけを足す (lineBreakActions の最後。反対側 (後置記号の後ろ・前置記号の前) は改行しない)
      if (CENTERED.has(cp)) c = 'ID';
    }
  }
  return c;
}

/**
 * 字の並び (コードポイント) の、字と字の間ごとの改行の動き。戻り値の [i] は、字 i-1 と字 i の間 ([0] は使わない)。
 * opts は字ごとの調整 (関数なら字の位置から引く)
 */
/**
 * soft を渡すと、symbolBreakMinDistance で控えた (×にした) 斜線の後ろの位置に true を入れる
 * (ほかに改行できる位置が無いときに使う、控えめの改行の機会)
 */
export function lineBreakActions(cps: number[], opts: LineBreakOptions | ((i: number) => LineBreakOptions) = {}, soft?: boolean[]): BreakAction[] {
  const n = cps.length;
  const act: Array<BreakAction | undefined> = new Array(n).fill(undefined);
  if (n === 0) return [];
  const optAt = typeof opts === 'function' ? opts : () => opts;
  const cls = cps.map((cp, i) => resolveClass(cp, optAt(i)));
  const rawCls = cps.map((cp) => lineBreakClass(cp));

  // LB4〜LB8a (元の並びで)
  for (let i = 1; i < n; i++) {
    const a = cls[i - 1];
    const b = cls[i];
    if (a === 'BK') act[i] = '!';
    else if (a === 'CR' && b === 'LF') act[i] = '×';
    else if (a === 'CR' || a === 'LF' || a === 'NL') act[i] = '!';
    else if (b === 'BK' || b === 'CR' || b === 'LF' || b === 'NL') act[i] = '×';
    else if (b === 'SP' || b === 'ZW') act[i] = '×';
    else {
      let j = i - 1;
      while (j >= 0 && cls[j] === 'SP') j--;
      if (j >= 0 && cls[j] === 'ZW') act[i] = '÷';
      else if (rawCls[i - 1] === 'ZWJ') act[i] = '×';
    }
  }
  // LB9: 結合文字の並び (X (CM | ZWJ)*) は X として扱う。LB10: 残った CM・ZWJ は A (AL) として扱う
  const elems: Elem[] = [];
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if ((c === 'CM' || c === 'ZWJ') && elems.length && !/^(BK|CR|LF|NL|SP|ZW)$/.test(elems[elems.length - 1].c) && i > 0 && cls[i - 1] !== 'SP' && !/^(BK|CR|LF|NL|ZW)$/.test(cls[i - 1])) {
      if (act[i] === undefined) act[i] = '×';
      continue;
    }
    if (c === 'CM' || c === 'ZWJ')
      elems.push({
        c: 'AL',
        cp: 0x41,
        eastAsian: false,
        gc: '',
        ep: false,
        pos: i,
      });
    else {
      const ea = eastAsianWidth(cps[i]);
      elems.push({
        c,
        cp: cps[i],
        eastAsian: ea === 'F' || ea === 'W' || ea === 'H',
        gc: gcOf(cps[i]),
        ep: extPict(cps[i]) === 'Y',
        pos: i,
      });
    }
  }
  const C = (k: number) => (k >= 0 && k < elems.length ? elems[k].c : k < 0 ? 'sot' : 'eot');
  const back = (k: number, skip: RegExp) => {
    let j = k;
    while (j >= 0 && skip.test(elems[j].c)) j--;
    return j;
  };
  const isDC = (k: number) => k >= 0 && k < elems.length && elems[k].cp === DOTTED_CIRCLE;
  const akLike = (k: number) => k >= 0 && k < elems.length && (elems[k].c === 'AK' || elems[k].c === 'AS' || isDC(k));
  const akOrDC = (k: number) => k >= 0 && k < elems.length && (elems[k].c === 'AK' || isDC(k));
  const ALHL = /^(AL|HL)$/;

  for (let k = 1; k < elems.length; k++) {
    const pos = elems[k].pos;
    if (act[pos] !== undefined) continue;
    const a = C(k - 1);
    const b = C(k);
    const ea = elems[k - 1];
    const eb = elems[k];
    const r = ((): BreakAction => {
      // LB11
      if (b === 'WJ' || a === 'WJ') return '×';
      // LB12・LB12a
      if (a === 'GL') return '×';
      if (b === 'GL' && !/^(SP|HY|HH)$/.test(a)) return '×';
      // LB13
      if (/^(CL|CP|EX|SY)$/.test(b)) return '×';
      // LB14
      if (C(back(k - 1, /^SP$/)) === 'OP') return '×';
      // LB15a
      {
        const j = back(k - 1, /^SP$/);
        if (j >= 0 && elems[j].c === 'QU' && elems[j].gc === 'Pi' && /^(sot|BK|CR|LF|NL|OP|QU|GL|SP|ZW)$/.test(C(j - 1))) return '×';
      }
      // LB15b
      if (b === 'QU' && eb.gc === 'Pf' && /^(SP|GL|WJ|CL|QU|CP|EX|IS|SY|BK|CR|LF|NL|ZW|eot)$/.test(C(k + 1))) return '×';
      // LB15c・LB15d
      if (a === 'SP' && b === 'IS' && C(k + 1) === 'NU') return '÷';
      if (b === 'IS') return '×';
      // LB16
      if (b === 'NS' && /^(CL|CP)$/.test(C(back(k - 1, /^SP$/)))) return '×';
      // LB17
      if (b === 'B2' && C(back(k - 1, /^SP$/)) === 'B2') return '×';
      // LB18
      if (a === 'SP') return '÷';
      // LB19
      if (b === 'QU' && eb.gc !== 'Pi') return '×';
      if (a === 'QU' && ea.gc !== 'Pf') return '×';
      // LB19a
      if (b === 'QU' && !ea.eastAsian) return '×';
      if (b === 'QU' && (k + 1 >= elems.length || !elems[k + 1].eastAsian)) return '×';
      if (a === 'QU' && !eb.eastAsian) return '×';
      if (a === 'QU' && (k - 2 < 0 || !elems[k - 2].eastAsian)) return '×';
      // LB20
      if (b === 'CB' || a === 'CB') return '÷';
      // LB20a
      if (/^(HY|HH)$/.test(a) && ALHL.test(b) && /^(sot|BK|CR|LF|NL|SP|ZW|CB|GL)$/.test(C(k - 2))) return '×';
      // LB21 (loose: ID の後ろの ‐・– の前は改行してよい。CSS Text 3 §5.2)
      // (U+2010 は Unicode 18 で HH、U+2013 は BA)
      if ((b === 'BA' || b === 'HH') && optAt(eb.pos).strictness === 'loose' && a === 'ID' && (eb.cp === 0x2010 || eb.cp === 0x2013)) return '÷';
      if (/^(BA|HH|HY|NS)$/.test(b) || a === 'BB') return '×';
      // LB21a・LB21b
      if (/^(HY|HH)$/.test(a) && C(k - 2) === 'HL' && b !== 'HL') return '×';
      if (a === 'SY' && b === 'HL') return '×';
      // LB22 (loose: 分離禁止の字どうしの間は改行してよい)
      if (b === 'IN' && !(optAt(eb.pos).strictness === 'loose' && a === 'IN')) return '×';
      // LB23・LB23a・LB24
      if ((ALHL.test(a) && b === 'NU') || (a === 'NU' && ALHL.test(b))) return '×';
      if ((a === 'PR' && /^(ID|EB|EM)$/.test(b)) || (/^(ID|EB|EM)$/.test(a) && b === 'PO')) return '×';
      if ((/^(PR|PO)$/.test(a) && ALHL.test(b)) || (ALHL.test(a) && /^(PR|PO)$/.test(b))) return '×';
      // LB25
      if (/^(PO|PR)$/.test(b)) {
        let j = k - 1;
        if (/^(CL|CP)$/.test(C(j))) j--;
        j = back(j, /^(SY|IS)$/);
        if (C(j) === 'NU') return '×';
      }
      if (/^(PO|PR)$/.test(a)) {
        if (b === 'NU') return '×';
        if (b === 'OP' && (C(k + 1) === 'NU' || (C(k + 1) === 'IS' && C(k + 2) === 'NU'))) return '×';
      }
      if ((a === 'HY' || a === 'IS') && b === 'NU') return '×';
      if (b === 'NU' && C(back(k - 1, /^(SY|IS)$/)) === 'NU') return '×';
      // JLREQ §3.1.10: 数字と後置省略記号 (全角の単位記号) の間は分割しない
      if (JIS_POSTFIX_SQUARES.has(eb.cp) && C(back(k - 1, /^(SY|IS)$/)) === 'NU') return '×';
      // LB26・LB27
      if (a === 'JL' && /^(JL|JV|H2|H3)$/.test(b)) return '×';
      if (/^(JV|H2)$/.test(a) && /^(JV|JT)$/.test(b)) return '×';
      if (/^(JT|H3)$/.test(a) && b === 'JT') return '×';
      if (/^(JL|JV|JT|H2|H3)$/.test(a) && b === 'PO') return '×';
      if (a === 'PR' && /^(JL|JV|JT|H2|H3)$/.test(b)) return '×';
      // LB28
      if (ALHL.test(a) && ALHL.test(b)) return '×';
      // LB28a
      if (a === 'AP' && akLike(k)) return '×';
      if (akLike(k - 1) && /^(VF|VI)$/.test(b)) return '×';
      if (a === 'VI' && akLike(k - 2) && akOrDC(k)) return '×';
      if (akLike(k - 1) && akLike(k) && C(k + 1) === 'VF') return '×';
      // LB29
      if (a === 'IS' && ALHL.test(b)) return '×';
      // LB30
      if (/^(AL|HL|NU)$/.test(a) && b === 'OP' && !eb.eastAsian) return '×';
      if (a === 'CP' && !ea.eastAsian && /^(AL|HL|NU)$/.test(b)) return '×';
      // LB30a
      if (a === 'RI' && b === 'RI') {
        let cnt = 0;
        for (let j = k - 1; j >= 0 && elems[j].c === 'RI'; j--) cnt++;
        if (cnt % 2 === 1) return '×';
      }
      // LB30b
      if (b === 'EM' && (a === 'EB' || (ea.ep && ea.gc === 'Cn'))) return '×';
      // LB31
      return '÷';
    })();
    act[pos] = r;
  }
  // SY (斜線) の後ろの改行の機会は、次の改行の機会までが短ければ使わない (UAX #14 §5.1 SY の推奨: 「and/or」「w/o」のような
  // 略記を分けない。最小の距離は symbolBreakMinDistance)
  for (let i = 1; i < n; i++) {
    const md = optAt(i - 1).symbolBreakMinDistance;
    if (!md || act[i] !== '÷' || cls[i - 1] !== 'SY' || cls[i] === 'SP') continue;
    let j = i + 1;
    while (j < n && act[j] === '×') j++;
    if (j - i < md) {
      act[i] = '×';
      if (soft) soft[i] = true;
    }
  }
  // loose (CJK): 全角などの後置記号 (PO) の前と、前置記号 (PR) の後ろは改行してよい (CSS Text 3 §5.2)
  const wideEA = (cp: number) => {
    const ea = eastAsianWidth(cp);
    return ea === 'A' || ea === 'F' || ea === 'W';
  };
  for (let i = 1; i < n; i++) {
    if (act[i] === '!' || !optAt(i).cjk || optAt(i).strictness !== 'loose') continue;
    if ((lineBreakClass(cps[i]) === 'PO' && wideEA(cps[i])) || (lineBreakClass(cps[i - 1]) === 'PR' && wideEA(cps[i - 1]))) act[i] = '÷';
  }
  // anywhere: 字ごとに改行してよい (強制改行は残す。CSS Text 3 §5.2)。
  // 字の単位 (書記素クラスタ。UAX #29) の中では分けない: 結合文字・ZWJ の前、ZWJ の後ろ、国旗の字 (RI) の組の間
  let riRun = 0;
  for (let i = 1; i < n; i++) {
    const ci = lineBreakClass(cps[i]);
    const cPrev = lineBreakClass(cps[i - 1]);
    riRun = cPrev === 'RI' ? riRun + 1 : 0;
    if (act[i] === '!' || /^(CM|ZWJ)$/.test(ci) || cPrev === 'ZWJ' || (ci === 'RI' && riRun % 2 === 1)) continue;
    if (optAt(i).strictness === 'anywhere' || optAt(i - 1).strictness === 'anywhere') act[i] = '÷';
  }
  return act.map((x) => x ?? '÷');
}

/**
 * 語の間に空白を書かない用字 (UAX #14 の Line_Break が SA = Complex_Context の字: タイ・ラオ・クメール・ミャンマーなど) の、語の境目。
 *
 * UAX #14 §5.1 の SA: これらの字の並びの改行の機会は、形態の解析 (ふつうは辞書を引く) で決める。解析が無ければ AL として扱う
 * (LB1 の既定。lineBreakActions はこの既定のままで、SA の字の並びの中に改行の機会を作らない)。
 * CSS Text 3 §5 も、タイ・ラオ・クメールなどの折り返しの機会は、語の境目を辞書などで決めるとする。
 *
 * ここでは、実行環境の Intl.Segmenter (granularity: 'word'。ICU の辞書で、タイ・ラオ・クメール・ミャンマーの語を分ける) で語の境目を求める。
 * 戻り値は、cps の中の位置 i (字 i-1 と字 i の間が語の境目) の並び。SA の字が無ければ null (Intl.Segmenter を呼ばない)。
 *  - 辞書を持つ用字 (タイ・ラオ・クメール・ミャンマー) の字の並びだけを分ける。ほかの SA の用字 (タイ・ルー、タイ・タムなど) は分けない (AL のまま)
 *  - Intl.Segmenter が無い環境・並びを 1 つも分けない環境 (その言語の辞書が無い) では、境目は無い (AL のまま。これまでと同じ)
 *  - 結合文字 (SA の Mn・Mc。LB1 で CM) の前は、境目にしない (LB9)
 *  - 語の境目は、ICU の版 (辞書) で変わりうる。同じ文書でも、実行環境 (Node・ブラウザの版) で改行の位置が変わりうる
 * langAt は、字の位置の言語 (要素の lang)。無ければ、字の用字から決める
 */
export function complexContextBreaks(cps: number[], langAt: (i: number) => string | undefined): number[] | null {
  let out: number[] | null = null;
  const n = cps.length;
  for (let i = 0; i < n; i++) {
    const lang = dictionaryLanguage(cps[i]);
    if (!lang) continue;
    // 同じ用字の SA の字の並び [i, e)
    let e = i + 1;
    while (e < n && dictionaryLanguage(cps[e]) === lang) e++;
    if (e - i > 1) {
      // 要素の lang の札で作れなければ (札が正しくない)、用字から決めた言語で
      const seg = wordSegmenter(langAt(i) || lang) ?? wordSegmenter(lang);
      if (seg) {
        const text = String.fromCodePoint(...cps.slice(i, e));
        let k = i;
        let off = 0;
        for (const { index } of seg.segment(text)) {
          // index は UTF-16 の位置。字の位置 k に直す
          while (off < index) off += cps[k++] > 0xffff ? 2 : 1;
          if (k > i && off === index && !/^M[nc]$/.test(gcOf(cps[k]))) (out ??= []).push(k);
        }
      }
    }
    i = e - 1;
  }
  return out;
}

/** Intl.Segmenter の辞書で語を分けられる SA の字の言語 (用字から決める既定の言語)。SA でない字・辞書の無い用字は undefined */
function dictionaryLanguage(cp: number): string | undefined {
  // SA の字はすべて U+0E01 以上。よくある字 (欧文・和文) は表を引かずに済ませる
  if (cp < 0xe01 || (cp >= 0x2000 && cp < 0xa9e0) || cp > 0xaa7f) return undefined;
  const lang = cp <= 0xe7f ? 'th' : cp <= 0xeff ? 'lo' : (cp >= 0x1000 && cp <= 0x109f) || cp >= 0xa9e0 ? 'my' : (cp >= 0x1780 && cp <= 0x17ff) || (cp >= 0x19e0 && cp <= 0x19ff) ? 'km' : undefined;
  return lang && lineBreakClass(cp) === 'SA' ? lang : undefined;
}

type WordSegmenter = { segment(text: string): Iterable<{ index: number }> };
const segmenters = new Map<string, WordSegmenter | null>();
/** 言語ごとの Intl.Segmenter (語の単位)。無い環境・作れない言語の札では null */
function wordSegmenter(lang: string): WordSegmenter | null {
  let s = segmenters.get(lang);
  if (s === undefined) {
    try {
      const I = (globalThis as { Intl?: { Segmenter?: new (locale: string, opts: { granularity: 'word' }) => WordSegmenter } }).Intl;
      s = I?.Segmenter ? new I.Segmenter(lang, { granularity: 'word' }) : null;
    } catch {
      s = null;
    }
    segmenters.set(lang, s);
  }
  return s;
}
