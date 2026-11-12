/**
 * 表の、行をまたぐセル (rowSpan) の広がりの上限。
 *
 * 行をまたぐセルは、またいだ行ごとに列を 1 つ占める。「<tr><td rowspan="65534">x</td><td>y</td></tr>」を n 行並べた表 (n 行で約 45n バイト) は、
 * どの行のセルも表の終わりまで伸びるので、列が n 本、セルの占めるマスが n² / 2 個になり、2000 行 (90KB) でメモリを使い切った
 * (マスごとに、罫線の重ね合わせ・改ページのときの続きのセルを作る)。
 *
 * そこで、
 *  - rowSpan を、行グループ (header・body・footer) の残りの行数で切る。HTML Living Standard §4.9.12 (Forming a table) の
 *    「algorithm for processing rows」・「algorithm for ending a row group」は、行グループの終わりで、下へ伸びるセルを止める。
 *    XSL 1.1 §7.28.14 number-rows-spanned は、行グループ (table-body・table-header・table-footer) をまたぐかを定めていないが、
 *    見出し・フッターはページごとに繰り返す別のまとまり (§6.7.6・§6.7.7) なので、この実装は元から行グループの中で切っている
 *    (tableBorders.ts の placeCells)。ここで先に切っても、結果は変わらない。
 *  - 1 つの表で、またいだ先のマス ((rowSpan − 1) × colSpan の合計) を、MAX_SPANNED_SLOTS + セルの数 × SPANNED_SLOTS_PER_CELL までにする。
 *    超える分のセルは、残りの分だけまたぐ (0 なら、またがない)。
 */
import type { LTable, LTableCell } from './types';

/**
 * またいだ先のマスの数の、表ごとの上限 (定数の分)。実在の表では、またいだ先のマスは、行の数の数倍 (見出しの列のセルが下の行をまたぐ・
 * 区分のセルが数十行をまたぐ) に収まる。2 万マスは、1 万行の表で、どの行も 2 列ぶんが上からまたがれている大きさ (これにセルの数に比例する分を足す)
 */
export const MAX_SPANNED_SLOTS = 20_000;
/** セル 1 つあたりに足す分 (大きな表ほど、またいだ先のマスも多くてよい。入力の大きさに比例する分は増幅にならない) */
export const SPANNED_SLOTS_PER_CELL = 4;

const done = new WeakSet<object>();

/**
 * 表の rowSpan を、行グループの残りの行数と、またいだ先のマスの上限で切る (セルの rowSpan を書き換える)。
 * 上限で切ったセルがあれば true (呼ぶ側が警告を出す)。同じ表は 1 度だけ調べる
 */
export function limitTableSpans(table: LTable): boolean {
  if (done.has(table)) return false;
  done.add(table);
  const groups = [table.header?.rows, table.body?.rows, table.footer?.rows];
  let cells = 0;
  let spanning = false;
  for (const rows of groups)
    for (const r of rows ?? []) {
      cells += r.cells.length;
      if (!spanning) for (const c of r.cells) if ((c.rowSpan ?? 1) > 1) spanning = true;
    }
  if (!spanning) return false;
  let budget = MAX_SPANNED_SLOTS + cells * SPANNED_SLOTS_PER_CELL;
  let cut = false;
  for (const rows of groups) {
    if (!rows) continue;
    for (let r = 0; r < rows.length; r++)
      for (const cell of rows[r].cells as LTableCell[]) {
        const rs = cell.rowSpan ?? 1;
        if (!(rs > 1)) continue;
        const cs = Math.max(1, cell.colSpan ?? 1);
        let n = Math.min(rs, rows.length - r);
        if ((n - 1) * cs > budget) {
          n = 1 + Math.floor(budget / cs);
          cut = true;
        }
        budget -= (n - 1) * cs;
        if (n !== rs) cell.rowSpan = n > 1 ? n : undefined;
      }
  }
  return cut;
}
