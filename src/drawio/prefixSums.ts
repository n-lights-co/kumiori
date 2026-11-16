/**
 * 途中の和の表: p[0] = 0、p[i + 1] = p[i] + term(i)。p[i] は term(0) から term(i - 1) までを、その順に足したもの。
 *
 * draw.io の形 (drawioJs/) は、i 番目の区切り・ボタンの位置を、0 から i − 1 番目の幅を毎回足し直して求める
 * (for (let j = 0; j < i; j++) x += …)。項目の数 (style の mainText・tabs・parts などを , で区切ったもの) に対して手間が 2 乗になり、
 * 6.6KB の図 (項目 40 万個) で 60 秒を超えた。表を 1 度だけ作って引けば、項目の数に比例する手間になる。
 * 足す順は毎回足し直すのと同じ (0 に、term(0)、term(1)、… の順に足す) なので、浮動小数の結果も同じ
 */
export function prefixSums(n: number, term: (j: number) => number): number[] {
  const p: number[] = new Array(n + 1);
  p[0] = 0;
  for (let j = 0; j < n; j++) p[j + 1] = p[j] + term(j);
  return p;
}
