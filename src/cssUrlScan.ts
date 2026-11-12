/**
 * cssUrlScan — CSS の値の中の最初の url(…) を、正規表現 /url\(\s*["']?([^"')]+)["']?\s*\)/ と同じ結果で、入力の長さに比例した手間で探す。
 *
 * 正規表現をそのまま当てると、閉じない url( を並べた値 (url(url(url(… を 20 万回。800KB) で、開始の位置ごとに値の終わりまで読み、
 * 長さの 2 乗の手間になる (1 分を超えた)。ある開始の位置 i で失敗したとき、中身の並び ([^"')]+) は、i に依らず同じ位置 j
 * (i + 4 から先の最初の " ' ) の位置) で終わり、成り立つかは j から後ろの字 (["']?\s*\)) だけで決まる。よって、中身が j まで同じに続く
 * (url( の後ろから j の手前までに、空白でない字のある) 開始の位置は、どれも失敗する。そこを飛ばして、次に試す位置だけを試す
 */

const RE = /url\(\s*["']?([^"')]+)["']?\s*\)/y;
const isTerm = (c: number) => c === 0x22 || c === 0x27 || c === 0x29;
const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x0b || c === 0xa0 || c === 0xfeff || (c >= 0x2000 && c <= 0x200a) || c === 0x1680 || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;

/** v の中の最初の url(…) (RE を、位置を固定せずに当てたものと同じ結果)。無ければ null */
export function firstCssUrl(v: string): RegExpExecArray | null {
  for (let i = v.indexOf('url('); i >= 0; ) {
    RE.lastIndex = i;
    const m = RE.exec(v);
    if (m) return m;
    // 失敗: 中身の並びの終わり j と、その手前の最後の空白でない字 L。url( の後ろ (k + 4) が L 以下の開始の位置 k は、同じ j で失敗する
    let j = i + 4;
    while (j < v.length && !isTerm(v.charCodeAt(j))) j++;
    let L = j - 1;
    while (L >= i + 4 && isSpace(v.charCodeAt(L))) L--;
    i = v.indexOf('url(', Math.max(i + 1, L - 3));
  }
  return null;
}

/** v の全体が url(…) 1 つか (/^url\(\s*["']?([^"')]+)["']?\s*\)$/ と同じ)。そうなら一致を返す */
export function wholeCssUrl(v: string): RegExpExecArray | null {
  if (!v.startsWith('url(')) return null;
  RE.lastIndex = 0;
  const m = RE.exec(v);
  // 中身の並びは貪欲なので、全体に当たる一致があれば、位置 0 からの一致がそれ (縮めれば、後ろの ) の前で終わる)。違えば、全体には当たらない
  return m && m[0].length === v.length ? m : null;
}
