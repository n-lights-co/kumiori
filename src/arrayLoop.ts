/**
 * 大きくなりうる配列を、引数に広げずに扱う補助。
 *
 * `push(...配列)`・`Math.max(...配列)` は、要素を 1 つずつ関数の引数に積むので、要素が約 12 万を超えるとスタックを使い切る
 * (RangeError: Maximum call stack size exceeded)。行の字・ブロックの子・表の行・ページの数・回り込みの数のように、
 * 入力の大きさで要素の数が決まる配列は、これらを使う
 */

/** to の末尾に from の要素を足す (to.push(...from) と同じ) */
export function pushAll<T>(to: T[], from: readonly T[]): void {
  for (let k = 0; k < from.length; k++) to.push(from[k]);
}

/** 最大 (Math.max(init, ...list) と同じ。NaN があれば NaN) */
export function maxOf(list: readonly number[], init = -Infinity): number {
  let v = init;
  for (let k = 0; k < list.length; k++) v = Math.max(v, list[k]);
  return v;
}

/** 最小 (Math.min(init, ...list) と同じ。NaN があれば NaN) */
export function minOf(list: readonly number[], init = Infinity): number {
  let v = init;
  for (let k = 0; k < list.length; k++) v = Math.min(v, list[k]);
  return v;
}
