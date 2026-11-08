/**
 * tableBorders — 表の罫線の「重ね合わせ」(border-collapse: collapse、XSL 1.1 §7.28.3 / CSS2 §17.6.2)。
 *
 * セルごとに罫線を描くと、隣り合うセルの罫線が二重になる。collapse モデルでは、隣り合う 2 辺のうち
 * 「勝った」罫線を 1 本だけ描く。ここではレイアウト前に論理ツリーを書き換え、
 *  - 左右に隣り合うセル: 勝った罫線を右 (inline 方向の後ろ) のセルの start 辺へ、左のセルの end 辺は消す
 *  - 上下に隣り合うセル: 勝った罫線を下 (block 方向の後ろ) のセルの before 辺へ、上のセルの after 辺は消す
 *    (改ページで新しいページの先頭に来た行にも、上の罫線が残る)
 *  - 表の外枠がある辺: 表の罫線と端のセルの罫線を比べ、勝った方を表の外枠に残し、セルの辺は消す (外枠の無い辺はセルに残す)
 * とする。勝ち負けは、太い方 → 線種 (double > solid > dashed > dotted > ridge > outset > groove > inset) の順。
 */
import { normBorder } from './geometry';
import type { BorderInput, BorderSide, BorderStyle, LTable, LTableCell, LTableRow, WritingMode } from './types';

type Side = 'top' | 'right' | 'bottom' | 'left';

const STYLE_RANK: Record<string, number> = { double: 8, solid: 7, dashed: 6, dotted: 5, ridge: 4, outset: 3, groove: 2, inset: 1 };

/** a と b のうち描く方 (どちらも無ければ undefined)。hidden はどちらにも勝ち、線を消す。同じなら先 (左・上) の a */
export function winningBorder(a: BorderSide | undefined, b: BorderSide | undefined): BorderSide | undefined {
  return resolve([
    { b: a, rank: 1 },
    { b: b, rank: 0 },
  ]);
}

/** 罫線の候補 (どの要素の罫線か: 5 セル > 4 行 > 3 行グループ > 2 列 > 1 表。XSL §6.7.10) */
interface Cand {
  b: BorderSide | undefined;
  rank: number;
}

/**
 * 線分ごとの罫線の解決 (XSL 1.1 §6.7.10 / CSS2 §17.6.2.1):
 * hidden があれば線は無い。太い方 → 線種 (double > solid > dashed > dotted > ridge > outset > groove > inset) →
 * 要素の種類 (セル > 行 > 行グループ > 列 > 表) → 先 (左・上) の順で勝つ。
 */
function resolve(cands: Cand[]): BorderSide | undefined {
  if (cands.some((c) => c.b?.style === 'hidden')) return undefined;
  let best: Cand | undefined;
  for (const c of cands) {
    if (!c.b || c.b.width <= 0) continue;
    if (!best) {
      best = c;
      continue;
    }
    const bw = best.b!.width;
    if (Math.abs(c.b.width - bw) > 1e-6) {
      if (c.b.width > bw) best = c;
      continue;
    }
    const rc = STYLE_RANK[c.b.style ?? 'solid'] ?? 0;
    const rb = STYLE_RANK[best.b!.style ?? 'solid'] ?? 0;
    if (rc !== rb) {
      if (rc > rb) best = c;
      continue;
    }
    if (c.rank > best.rank) best = c;
  }
  return best?.b;
}

/** 書字方向ごとの論理辺 → 物理辺 */
function sides(wm: WritingMode): { is: Side; ie: Side; bs: Side; be: Side } {
  if (wm === 'horizontal-tb') return { is: 'left', ie: 'right', bs: 'top', be: 'bottom' };
  if (wm === 'vertical-lr') return { is: 'top', ie: 'bottom', bs: 'left', be: 'right' };
  return { is: 'top', ie: 'bottom', bs: 'right', be: 'left' };
}

/** 罫線を辺ごとに正規化する (hidden は残す) */
function norm(v: BorderInput | undefined): BorderStyle {
  if (!v) return {};
  if ('width' in v && 'color' in v && typeof (v as BorderSide).width === 'number') {
    const s = v as BorderSide;
    return s.width > 0 || s.style === 'hidden' ? { top: s, right: s, bottom: s, left: s } : {};
  }
  const o = v as Partial<Record<Side, BorderSide>>;
  const out: BorderStyle = {};
  for (const k of ['top', 'right', 'bottom', 'left'] as const) if (o[k] && (o[k]!.width > 0 || o[k]!.style === 'hidden')) out[k] = o[k];
  return out;
}

/** 解決した罫線の太い方 */
const wider = (a: BorderSide | undefined, b: BorderSide | undefined) => (!a ? b : !b ? a : b.width > a.width ? b : a);

/**
 * collapse モデルで罫線を解決した表を返す (元の表は変更しない)。
 * borderCollapse が 'separate' の表は、そのまま返す。
 * セル・行・行グループ (table-header / body / footer)・列・表の罫線から、グリッドの線分ごとに 1 本を選ぶ。
 * 内側の線は、隣り合う 2 つのセルが半分ずつ持つ (内容の矩形は、グリッドから罫線の太さの半分だけ内側。§6.7.10)。
 * 線は後ろ (右・下) のセルが、グリッド線を中心に全体の太さで描く。
 * 表の外周: 表に罫線があれば、勝った線を表の外枠にする (半分は表の外へ出る)。表に罫線の無い辺は、端のセルに残す。
 */
export function collapseTableBorders(table: LTable, wm: WritingMode): LTable {
  if (table.borderCollapse !== 'collapse') return table;
  const S = sides(wm);
  // セルを複製し、罫線を辺ごとの BorderStyle に正規化しておく
  const copyRows = (rows: LTableRow[]) => rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, border: { ...norm(c.border) } as BorderStyle })) }));
  const hRows = copyRows(table.header?.rows ?? []);
  const bRows = copyRows(table.body.rows);
  const fRows = copyRows(table.footer?.rows ?? []);
  const all = [...hRows, ...bRows, ...fRows];

  type Placed = PlacedCell<LTableCell & { border: BorderStyle }>;
  const { placed, grid, nCols } = placeCells<LTableCell & { border: BorderStyle }>([hRows, bRows, fRows]);
  const nRows = all.length;
  const tb: BorderStyle = { ...norm(table.border) };
  const rowB = all.map((r) => norm(r.border));
  const grpB = all.map((r) => (r.group ? norm(r.group.border) : {}));
  const colB = Array.from({ length: nCols }, (_, k) => norm(table.columns[k]?.border));
  const cellB = (p: Placed | undefined, side: Side) => p?.cell.border[side];

  // 線分ごとの解決結果を、セルの辺へ集める (辺に複数の線分があれば太い方)
  type Acc = Map<Placed, Partial<Record<Side, BorderSide>>>;
  const acc: Acc = new Map();
  const touched = new Map<Placed, Set<Side>>();
  const put = (p: Placed | undefined, side: Side, b: BorderSide | undefined) => {
    if (!p) return;
    let t = touched.get(p);
    if (!t) touched.set(p, (t = new Set()));
    t.add(side);
    if (!b) return;
    let m = acc.get(p);
    if (!m) acc.set(p, (m = {}));
    m[side] = wider(m[side], b);
  };
  const edgeWin: Partial<Record<Side, BorderSide>> = {};
  const edgeAny: Partial<Record<Side, boolean>> = {};
  // 向こうにセルの無い辺 (行ごとにセルの数が違う表の、欠けたセルとの境目)。表の外周でなくても、セルが全体の太さで描く
  const open = new Map<Placed, Set<Side>>();
  const markOpen = (p: Placed, side: Side) => {
    let s = open.get(p);
    if (!s) open.set(p, (s = new Set()));
    s.add(side);
  };

  // block 方向の境目 (行と行の間、表の先頭と末尾)
  for (let b = 0; b <= nRows; b++) {
    for (let x = 0; x < nCols; x++) {
      const above = b > 0 ? grid[b - 1]?.[x] : undefined;
      const below = b < nRows ? grid[b]?.[x] : undefined;
      if (above && above === below) continue;
      if (!above && !below) continue;
      const c: Cand[] = [];
      if (above) c.push({ b: cellB(above, S.be), rank: 5 });
      if (below) c.push({ b: cellB(below, S.bs), rank: 5 });
      if (b > 0) c.push({ b: rowB[b - 1][S.be], rank: 4 });
      if (b < nRows) c.push({ b: rowB[b][S.bs], rank: 4 });
      if (b > 0 && all[b - 1].group?.last) c.push({ b: grpB[b - 1][S.be], rank: 3 });
      if (b < nRows && all[b].group?.first) c.push({ b: grpB[b][S.bs], rank: 3 });
      if (b === 0) c.push({ b: colB[x][S.bs], rank: 2 }, { b: tb[S.bs], rank: 1 });
      if (b === nRows) c.push({ b: colB[x][S.be], rank: 2 }, { b: tb[S.be], rank: 1 });
      const w = resolve(c);
      if (above && below) {
        put(above, S.be, w);
        put(below, S.bs, w);
      } else {
        const side = below ? S.bs : S.be;
        // 表の先頭・末尾の辺だけが表の外周。途中の行の欠けたセルとの境目は、外周ではない
        if (b === 0 || b === nRows) {
          edgeAny[side] = true;
          edgeWin[side] = wider(edgeWin[side], w);
        } else markOpen((below ?? above)!, side);
        put(below ?? above, side, w);
      }
    }
  }
  // inline 方向の境目 (列と列の間、表の始端と終端)
  for (let y = 0; y < nRows; y++) {
    for (let x = 0; x <= nCols; x++) {
      const left = x > 0 ? grid[y]?.[x - 1] : undefined;
      const right = x < nCols ? grid[y]?.[x] : undefined;
      if (left && left === right) continue;
      if (!left && !right) continue;
      const c: Cand[] = [];
      if (left) c.push({ b: cellB(left, S.ie), rank: 5 });
      if (right) c.push({ b: cellB(right, S.is), rank: 5 });
      if (x === 0) c.push({ b: rowB[y][S.is], rank: 4 }, { b: grpB[y][S.is], rank: 3 });
      if (x === nCols) c.push({ b: rowB[y][S.ie], rank: 4 }, { b: grpB[y][S.ie], rank: 3 });
      if (x > 0) c.push({ b: colB[x - 1][S.ie], rank: 2 });
      if (x < nCols) c.push({ b: colB[x][S.is], rank: 2 });
      if (x === 0) c.push({ b: tb[S.is], rank: 1 });
      if (x === nCols) c.push({ b: tb[S.ie], rank: 1 });
      const w = resolve(c);
      if (left && right) {
        put(left, S.ie, w);
        put(right, S.is, w);
      } else {
        const side = right ? S.is : S.ie;
        if (x === 0 || x === nCols) {
          edgeAny[side] = true;
          edgeWin[side] = wider(edgeWin[side], w);
        } else markOpen((right ?? left)!, side);
        put(right ?? left, side, w);
      }
    }
  }

  // セルの辺へ書き戻す
  const isEdge = (p: Placed, side: Side) =>
    (side === S.bs && p.r === 0) || (side === S.be && p.r + p.rs >= nRows) || (side === S.is && p.c === 0) || (side === S.ie && p.c + p.cs >= nCols);
  const tableOwns = (side: Side) => !!tb[side] && tb[side]!.style !== 'hidden';
  for (const p of placed) {
    const m = acc.get(p) ?? {};
    const t = touched.get(p) ?? new Set<Side>();
    const out: BorderStyle = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (!t.has(side)) continue;
      const w = m[side];
      if (!w) continue;
      if (open.get(p)?.has(side)) {
        out[side] = { width: w.width, color: w.color, ...(w.style ? { style: w.style } : {}) };
        continue;
      }
      if (isEdge(p, side)) {
        // 表の外周: 表に罫線があれば表が描く。無ければセルが全体の太さで持つ (従来どおり)
        if (!tableOwns(side)) out[side] = { width: w.width, color: w.color, ...(w.style ? { style: w.style } : {}), collapse: { tableEdge: true } };
        continue;
      }
      if (table.collapseToAfterCell) {
        // アンテナハウス互換: 後ろ (右・下) のセルが全体の太さで持つ。前のセルの辺は無し
        if (side === S.bs || side === S.is) out[side] = { width: w.width, color: w.color, ...(w.style ? { style: w.style } : {}) };
        continue;
      }
      const base = { width: w.width / 2, color: w.color, ...(w.style ? { style: w.style } : {}) };
      // 内側の線: 前 (左・上) のセルは場所だけ取り、後ろ (右・下) のセルがグリッド線を中心に描く
      out[side] = side === S.bs || side === S.is ? { ...base, collapse: { paintWidth: w.width } } : { ...base, collapse: { noPaint: true } };
    }
    p.cell.border = out;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (!edgeAny[side]) continue;
    if (tableOwns(side)) {
      const w = edgeWin[side];
      if (w) tb[side] = w;
      else delete tb[side];
    } else delete tb[side];
  }

  return {
    ...table,
    border: tb,
    ...(table.header ? { header: { ...table.header, rows: hRows } } : {}),
    body: { ...table.body, rows: bRows },
    ...(table.footer ? { footer: { ...table.footer, rows: fRows } } : {}),
  };
}

/** グリッドに割り付けたセル (r, c: 左上の行・列、rs, cs: またぐ行数・列数) */
export interface PlacedCell<C extends LTableCell = LTableCell> {
  cell: C;
  r: number;
  c: number;
  rs: number;
  cs: number;
}

/**
 * セルのグリッドへの割り付け (rowSpan / colSpan)。上の行から伸びてきたセルが占める列は飛ばし、colSpan・rowSpan は 1 以上に丸める。
 * 行をまたぐセルは、行グループ (header・body・footer) の中だけで伸ばす。grid[行][列] はその位置を占めるセル (欠けていれば undefined)。
 * placed は行の順・セルの順 (元の cells の並び)。罫線の重ね合わせ・列幅の計測・行グループの配置・rowSpan の分割が、みな同じ割り付けを使う
 */
export function placeCells<C extends LTableCell>(groups: Array<Array<{ cells: C[] }>>): { placed: PlacedCell<C>[]; grid: Array<Array<PlacedCell<C> | undefined>>; nCols: number } {
  const all = groups.flat();
  const placed: PlacedCell<C>[] = [];
  const grid: Array<Array<PlacedCell<C> | undefined>> = all.map(() => []);
  let g0 = 0;
  for (const g of groups) {
    const g1 = g0 + g.length;
    const occupiedUntil: number[] = [];
    for (let r = g0; r < g1; r++) {
      let c = 0;
      for (const cell of all[r].cells) {
        while ((occupiedUntil[c] ?? -1) >= r) c++;
        const cs = Math.max(1, cell.colSpan ?? 1);
        const rs = Math.max(1, Math.min(cell.rowSpan ?? 1, g1 - r));
        const p: PlacedCell<C> = { cell, r, c, rs, cs };
        placed.push(p);
        for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) grid[y][x] = p;
        if (rs > 1) for (let x = c; x < c + cs; x++) occupiedUntil[x] = r + rs - 1;
        c += cs;
      }
    }
    g0 = g1;
  }
  return { placed, grid, nCols: Math.max(0, ...grid.map((g) => g.length)) };
}

/**
 * collapse モデルの表の外枠の罫線の半分の太さ (論理辺)。外枠の罫線は、表の端の線を中心に引くので、
 * 半分は表の外 (余白の側) へ出る (CSS2 §17.6.2・アンテナハウスと同じ)。collapseTableBorders を通した表に使う
 */
export function collapsedOuterHalves(table: LTable, wm: WritingMode): { bs: number; be: number; is: number; ie: number } {
  if (table.borderCollapse !== 'collapse') return { bs: 0, be: 0, is: 0, ie: 0 };
  const S = sides(wm);
  const tb = normBorder(table.border);
  const rows = [...(table.header?.rows ?? []), ...table.body.rows, ...(table.footer?.rows ?? [])];
  const w = (b: BorderSide | undefined) => (b && b.width > 0 ? b.width : 0);
  const cellW = (c: LTableCell | undefined, side: Side) => w(c ? normBorder(c.border)[side] : undefined);
  const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
  const half = (side: Side, cells: Array<LTableCell | undefined>) => (tb[side] ? w(tb[side]) : max(cells.map((c) => cellW(c, side)))) / 2;
  // 表の端の列のセルは、グリッドに割り付けて取る (上の行から rowSpan で伸びたセルが端の列を占める行では、行の最初・最後のセルは端のセルではない)
  const { grid, nCols } = placeCells([table.header?.rows ?? [], table.body.rows, table.footer?.rows ?? []]);
  const column = (x: number) => grid.map((g) => g[x]?.cell);
  return {
    bs: half(S.bs, rows[0]?.cells ?? []),
    be: half(S.be, rows[rows.length - 1]?.cells ?? []),
    is: half(S.is, column(0)),
    ie: half(S.ie, column(nCols - 1)),
  };
}
