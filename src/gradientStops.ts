/**
 * グラデーションの止まり点の並び (位置の昇順) から、位置 t を含む区間を二分で探す。
 * 画素ごとに先頭から探すと、1 画素の手間が止まり点の数に比例し、止まり点の多いグラデーション (細かい repeating-linear-gradient は
 * 4,000 個ほどの止まり点になる) で、PNG の画素化に数分かかっていた。
 */

/**
 * 止まり点の区間 [i, i + 1] の i: 0 から last までで、i = last か、次の止まり点の位置が t より後 (inclusive なら、t の位置も含めて後) にない最初の i
 * (先頭から `while (i < last && off(i + 1) < t) i++` で探すのと同じ値。位置が昇順なので、条件は前の方だけで成り立つ)
 */
export function stopSpan(last: number, off: (i: number) => number, t: number, inclusive = false): number {
  let lo = 0;
  let hi = Math.max(0, last);
  // off(i + 1) が t の手前にある i は、lo より前だけ
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const o = off(mid + 1);
    if (inclusive ? o <= t : o < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * PNG の画素化の手間の勘定 (pageRaster.ts) で、色を引く塗りの 1 画素 (4 単位) に足す、止まり点を探す手間。
 * 止まり点 16 個までは 0 (前の勘定のまま)、それより多ければ log2 (止まり点の数)
 */
export function stopSearchWork(n: number): number {
  return n > 16 ? Math.ceil(Math.log2(n)) : 0;
}
