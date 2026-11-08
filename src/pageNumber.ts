/**
 * pageNumber — ページ番号の書式 (fo:page-sequence の format、XSL 1.1 §7.26.1。XSLT の xsl:number と同じ書式トークン)。
 *
 *  "1" → 1, 2, 3 / "01" → 01, 02 (桁数まで 0 埋め) / "i" "I" → ローマ数字 / "a" "A" → a..z, aa.. /
 *  "１" → 全角数字 / "一" → 漢数字 (十・百・千を使う) / "Ⅰ" "ⅰ" → ローマ数字の字 (12 まで) / "①" → 丸数字 (50 まで)。トークンの前後の文字はそのまま残す (例: "- 1 -" → "- 3 -")
 */

const ROMAN: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let s = '';
  for (const [v, r] of ROMAN) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}

function alpha(n: number): string {
  if (n <= 0) return String(n);
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const KANJI_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 漢数字 (1〜9999。十・百・千を使う)。範囲の外は 10 進数 */
export function kanjiNumber(n: number): string {
  if (n <= 0 || n >= 10000) return String(n);
  const parts: string[] = [];
  const units: Array<[number, string]> = [[1000, '千'], [100, '百'], [10, '十']];
  let r = n;
  for (const [v, u] of units) {
    const d = Math.floor(r / v);
    if (d) parts.push((d > 1 ? KANJI_DIGIT[d] : '') + u);
    r %= v;
  }
  if (r) parts.push(KANJI_DIGIT[r]);
  return parts.join('');
}

/** 丸数字 (①〜⑳・㉑〜㊿)。1〜50 の外は undefined (呼ぶ側が代わりの表記を決める) */
export function circledNumber(n: number): string | undefined {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x245f + n);
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return undefined;
}

/**
 * n を書式 fmt で文字列にする。書式が無ければ 10 進数。
 * XSLT 1.0 §7.7.1 の規則: 書式は英数字の並び (書式トークン) と、それ以外の区切りに分かれる。ページ番号は数が 1 つなので、
 * 最初のトークンだけを使い、その前 (接頭辞) と、最後のトークンの後ろ (接尾辞) の区切りを残す。知らないトークンは "1" とみなす。
 * 2 つ目以降のトークンと、トークンの間の区切りは捨てる (XSLT 1.0 §7.7.1「余ったトークンは無視する」): "A-1" → "A"・"B"… ("-1" は出ない)。
 * 字と数字の続き ("第1章") は 1 つのトークンで、知らないトークンなので 10 進数になる。複数の数を並べる書式 (章-ページ) はここでは扱わない
 */
export function formatPageNumber(n: number, fmt?: string): string {
  if (!fmt) return String(n);
  const toks = [...fmt.matchAll(/[\p{L}\p{N}]+/gu)];
  if (!toks.length) return fmt + String(n);
  const first = toks[0];
  const last = toks[toks.length - 1];
  const prefix = fmt.slice(0, first.index);
  const suffix = fmt.slice(last.index! + last[0].length);
  return prefix + formatToken(n, first[0]) + suffix;
}

function formatToken(n: number, tok: string): string {
  if (/^[0-9]+$/.test(tok)) return String(n).padStart(tok.length, '0');
  if (/^[０-９]+$/.test(tok)) return String(n).padStart(tok.length, '0').replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)));
  if (tok === 'i') return roman(n);
  if (tok === 'I') return roman(n).toUpperCase();
  if (tok === 'a') return alpha(n);
  if (tok === 'A') return alpha(n).toUpperCase();
  if (tok === '一' || tok === '〇') return kanjiNumber(n);
  // ローマ数字の 1 字の字 (Ⅰ〜Ⅻ・ⅰ〜ⅻ)。13 以上は欧文のローマ数字
  if (tok === 'Ⅰ') return n >= 1 && n <= 12 ? String.fromCharCode(0x215f + n) : roman(n).toUpperCase();
  if (tok === 'ⅰ') return n >= 1 && n <= 12 ? String.fromCharCode(0x216f + n) : roman(n);
  // 丸数字 (①〜⑳・㉑〜㊿)
  if (tok === '①') return circledNumber(n) ?? String(n);
  // 知らないトークンは "1" (10 進数) とみなす (XSLT 1.0 §7.7.1)
  return String(n);
}
