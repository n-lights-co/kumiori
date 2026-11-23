/**
 * pdfPageLabels — PDF のページラベル (カタログの /PageLabels。ISO 32000-1 §12.4.2) を、組版のページ番号の数と書式から作る。
 *
 * PDF のビューアは、ページラベルがあれば、ページの番号の代わりにそれを出す (前付けを i・ii、本文を 1 から、など)。
 * ラベルは「そのページで fo:page-number・counter(page) が出す番号の字」にする (書式の前後の字 (「- 1 -」の「-」) は入れない)。
 *  - 範囲 (ページラベルの辞書の 1 つ) は、ページの順の番号 (0 から) から始まり、次の範囲の前まで続く。辞書は §12.4.2 の表の S (書式)・P (接頭辞)・St (初めの番号)
 *  - PDF の書式 (S) は D (10 進)・R・r (大文字・小文字のローマ数字)・A・a (大文字・小文字の英字。26 より先は AA・BB … と同じ字を重ねる)
 *  - 書式が PDF の書式で書けて、番号が前のページの次なら、同じ範囲に続ける。書式・番号の続かない所 (前付けと本文の境、番号の振り直し) で、新しい範囲にする
 *  - PDF の書式で書けないページ (0 埋め・全角・漢数字・ローマ数字の字・丸数字、PDF の書き方と字の違う英字 (28 の ab など。27 の aa は同じ)、4000 以上のローマ数字、0 以下の番号、桁区切りの付いた番号) は、
 *    ページごとの範囲にし、S を書かずに、紙面と同じ字を P に書く (ビューアは紙面と同じ字を出す)
 *  - 全体が「初めのページから 1 の 10 進の通し」(ビューアの既定と同じ) なら、書かない
 */
import { formatPageNumber } from './pageNumber';

/** PDF のページラベルの書式 (ISO 32000-1 §12.4.2 の表の S) */
export type PageLabelStyle = 'D' | 'R' | 'r' | 'A' | 'a';

/** ページラベルの範囲 (ページラベルの辞書 1 つ) */
export interface PageLabelRange {
  /** 範囲の初めのページの順の番号 (0 から。数の木の鍵) */
  start: number;
  /** 書式 (S)。無ければ番号を出さない (prefix だけ) */
  style?: PageLabelStyle;
  /** 接頭辞 (P) */
  prefix?: string;
  /** 初めのページの番号 (St。1 以上。無ければ 1) */
  first?: number;
}

/** ページの番号と書式 (PageArea.pageNumber・pageNumberFormat) */
export interface PageNumbering {
  number: number;
  format?: string;
}

const ROMAN: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** PDF のビューアが書式 style で番号 n に出す字 (§12.4.2 の表。書けない番号は undefined) */
function pdfLabel(style: PageLabelStyle, n: number): string | undefined {
  if (!Number.isSafeInteger(n) || n < 1) return undefined;
  if (style === 'D') return String(n);
  if (style === 'r' || style === 'R') {
    // ローマ数字は 3999 まで (4000 から先の書き方は決まっていない)
    if (n > 3999) return undefined;
    let s = '';
    let r = n;
    for (const [v, t] of ROMAN)
      while (r >= v) {
        s += t;
        r -= v;
      }
    return style === 'R' ? s.toUpperCase() : s;
  }
  // 英字: 1〜26 が a〜z、27〜52 が aa〜zz (同じ字を重ねる)
  const s = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
  return style === 'A' ? s.toUpperCase() : s;
}

/** 書式の初めのトークンから、PDF の書式の候補 (pageNumber.ts の formatToken と同じトークンの読み方) */
function styleCandidate(token: string): PageLabelStyle | undefined {
  if (token === 'i') return 'r';
  if (token === 'I') return 'R';
  if (token === 'a') return 'a';
  if (token === 'A') return 'A';
  // 10 進 ("1"。"01" のような 0 埋めは、字が合わなければ下で外れる) と、知らないトークン (formatPageNumber は "1" とみなす)
  if (/^[0-9]+$/.test(token) || !/^(?:[０-９]+|[一〇Ⅰⅰ①])$/.test(token)) return 'D';
  return undefined;
}

/**
 * 書式 fmt の番号の部分だけの書式 (初めのトークンと桁区切り。前後の字は除く)。formatPageNumber と同じく、
 * 英数字の並びをトークンとし、桁区切り (withGrouping) は \u0000 の後ろにある
 */
function numberPart(fmt: string | undefined): { format: string; token: string } {
  if (!fmt) return { format: '1', token: '1' };
  const gi = fmt.indexOf('\u0000');
  const body = gi >= 0 ? fmt.slice(0, gi) : fmt;
  const token = /[\p{L}\p{N}]+/u.exec(body)?.[0] ?? '1';
  return { format: token + (gi >= 0 ? fmt.slice(gi) : ''), token };
}

/** ページの並びから、ページラベルの範囲を作る。ビューアの既定 (初めから 1 の 10 進の通し) と同じなら undefined */
export function pageLabelRanges(pages: readonly PageNumbering[]): PageLabelRange[] | undefined {
  const ranges: PageLabelRange[] = [];
  let prev: { style?: PageLabelStyle; number: number } | undefined;
  pages.forEach((p, i) => {
    const { format, token } = numberPart(p.format);
    const label = formatPageNumber(p.number, format);
    const cand = styleCandidate(token);
    const style = cand && pdfLabel(cand, p.number) === label ? cand : undefined;
    if (style && prev?.style === style && p.number === prev.number + 1) {
      prev = { style, number: p.number };
      return;
    }
    ranges.push(style ? { start: i, style, ...(p.number !== 1 ? { first: p.number } : {}) } : { start: i, prefix: label });
    prev = { ...(style ? { style } : {}), number: p.number };
  });
  if (!ranges.length || (ranges.length === 1 && ranges[0].style === 'D' && ranges[0].first === undefined)) return undefined;
  return ranges;
}
