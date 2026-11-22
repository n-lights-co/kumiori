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
import { copySourceRef } from './sourceRef';
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
 * 表の外周: 表に罫線があれば、勝った線を表の外枠にする (半分は表の外へ出る)。表に罫線の無い辺は、端のセルに残す
 * (セルの箱は辺のいちばん太い線の外の縁まで広がるので、細い線は内へずらして、線の中心をグリッド線に置く。CSS 2.1 §17.6.2)。
 */
export function collapseTableBorders(table: LTable, wm: WritingMode): LTable {
  if (table.borderCollapse !== 'collapse') return table;
  const S = sides(wm);
  // セルを複製し、罫線を辺ごとの BorderStyle に正規化しておく
  // 写しには、元の行・セルの入力の番号 (sourceRef) を引き継ぐ (Area の sourceRef。タグ付き PDF の構造と、描く効果を引く)
  const copyRows = (rows: LTableRow[]) => rows.map((r) => withRef(r, { ...r, cells: r.cells.map((c) => withRef(c, { ...c, border: { ...norm(c.border) } as BorderStyle })) }));
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
  // 列の罫線 (列の指定の無い列は、罫線が無い)
  const colArr = table.columns.slice(0, nCols).map((col) => norm(col?.border));
  const noB: BorderStyle = {};
  const colB = (k: number) => colArr[k] ?? noB;
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

  // block 方向の境目 (行と行の間、表の先頭と末尾)。
  // 上下のセルの変わらない区間ごとにまとめて解決する (区間の中の列は、候補が同じなので結果も同じ。列の罫線の候補がある、
  // 表の先頭と末尾の境目だけは、列の指定のある列を 1 本ずつ解決する)。解決して辺へ集める順は、列ごとに見るのと同じ列の順
  const blockStep = (b: number, x: number, above: Placed | undefined, below: Placed | undefined) => {
    const c: Cand[] = [];
    if (above) c.push({ b: cellB(above, S.be), rank: 5 });
    if (below) c.push({ b: cellB(below, S.bs), rank: 5 });
    if (b > 0) c.push({ b: rowB[b - 1][S.be], rank: 4 });
    if (b < nRows) c.push({ b: rowB[b][S.bs], rank: 4 });
    if (b > 0 && all[b - 1].group?.last) c.push({ b: grpB[b - 1][S.be], rank: 3 });
    if (b < nRows && all[b].group?.first) c.push({ b: grpB[b][S.bs], rank: 3 });
    if (b === 0) c.push({ b: colB(x)[S.bs], rank: 2 }, { b: tb[S.bs], rank: 1 });
    if (b === nRows) c.push({ b: colB(x)[S.be], rank: 2 }, { b: tb[S.be], rank: 1 });
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
  };
  for (let b = 0; b <= nRows; b++) {
    for (const [x0, x1, above, below] of pairSegments(b > 0 ? grid[b - 1] : undefined, b < nRows ? grid[b] : undefined)) {
      if (above && above === below) continue;
      if (b === 0 || b === nRows) {
        const L = Math.min(x1, colArr.length);
        for (let x = x0; x < L; x++) blockStep(b, x, above, below);
        if (x1 > L) blockStep(b, Math.max(x0, L), above, below);
      } else blockStep(b, x0, above, below);
    }
  }
  // inline 方向の境目 (列と列の間、表の始端と終端)。境目はセルの範囲の端だけ (範囲の中は同じセル、範囲の外はセルが無い)
  const inlineStep = (y: number, x: number, left: Placed | undefined, right: Placed | undefined) => {
    if (left && left === right) return;
    if (!left && !right) return;
    const c: Cand[] = [];
    if (left) c.push({ b: cellB(left, S.ie), rank: 5 });
    if (right) c.push({ b: cellB(right, S.is), rank: 5 });
    if (x === 0) c.push({ b: rowB[y][S.is], rank: 4 }, { b: grpB[y][S.is], rank: 3 });
    if (x === nCols) c.push({ b: rowB[y][S.ie], rank: 4 }, { b: grpB[y][S.ie], rank: 3 });
    if (x > 0) c.push({ b: colB(x - 1)[S.ie], rank: 2 });
    if (x < nCols) c.push({ b: colB(x)[S.is], rank: 2 });
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
  };
  for (let y = 0; y < nRows; y++) {
    const row = grid[y];
    for (let i = 0; i < row.length; i++) {
      inlineStep(y, row.s[i], i > 0 && row.e[i - 1] === row.s[i] ? row.v[i - 1] : undefined, row.v[i]);
      if (!(i + 1 < row.length && row.s[i + 1] === row.e[i])) inlineStep(y, row.e[i], row.v[i], undefined);
    }
  }

  // 改ページの境目で決め直すための線 (書き戻す前の、セルが元から持つ指定から選ぶ)。
  // 続きのページで繰り返す表ヘッダーの下に来るのは、そのページの最初の行で、元の格子で上にあった行ではない。
  // その境目の線分は、表ヘッダーの最後の行の後ろ側と、その行の前側の指定から選び直す (XSL 1.1 §6.7.3・§6.7.10)。
  // 改ページの手前で繰り返す表フッターと、そのページの最後の行の境目も同じ
  const own = (cands: Cand[]) => (cands.some((c) => c.b?.style === 'hidden') ? cands.find((c) => c.b?.style === 'hidden')!.b : resolve(cands));
  const hLast = hRows.length - 1;
  const fFirst = hRows.length + bRows.length;
  // 列ごとの線 (セルの範囲ごとに 1 度だけ選ぶ。範囲の中の列は同じ線)
  const perColumn = (row: ColumnRuns<Placed> | undefined, pick: (p: Placed) => BorderSide | undefined) => {
    const out: Array<BorderSide | undefined> = new Array(nCols).fill(undefined);
    if (row) for (let i = 0; i < row.length; i++) out.fill(pick(row.v[i]), row.s[i], row.e[i]);
    return out;
  };
  const headerAfter = perColumn(hLast >= 0 ? grid[hLast] : undefined, (p) =>
    own([{ b: cellB(p, S.be), rank: 5 }, { b: rowB[hLast][S.be], rank: 4 }, ...(all[hLast].group?.last ? [{ b: grpB[hLast][S.be], rank: 3 }] : [])]),
  );
  const footerBefore = perColumn(fRows.length ? grid[fFirst] : undefined, (p) =>
    own([{ b: cellB(p, S.bs), rank: 5 }, { b: rowB[fFirst][S.bs], rank: 4 }, ...(all[fFirst].group?.first ? [{ b: grpB[fFirst][S.bs], rank: 3 }] : [])]),
  );
  const edges = new Map<Placed, { before?: BorderSide; after?: BorderSide }>();
  for (const p of placed) {
    if (p.r < hRows.length || p.r >= fFirst) continue;
    const last = p.r + p.rs - 1;
    const before = own([{ b: cellB(p, S.bs), rank: 5 }, { b: rowB[p.r][S.bs], rank: 4 }, ...(all[p.r].group?.first ? [{ b: grpB[p.r][S.bs], rank: 3 }] : [])]);
    const after = own([{ b: cellB(p, S.be), rank: 5 }, { b: rowB[last][S.be], rank: 4 }, ...(all[last].group?.last ? [{ b: grpB[last][S.be], rank: 3 }] : [])]);
    edges.set(p, { ...(before ? { before } : {}), ...(after ? { after } : {}) });
  }

  // セルの辺へ書き戻す
  const isEdge = (p: Placed, side: Side) =>
    (side === S.bs && p.r === 0) || (side === S.be && p.r + p.rs >= nRows) || (side === S.is && p.c === 0) || (side === S.ie && p.c + p.cs >= nCols);
  const tableOwns = (side: Side) => !!tb[side] && tb[side]!.style !== 'hidden';
  // 線ごとの、いちばん太い線の太さ。線の中心をそろえる (グリッド線に置く) ために、細い線を内へずらす量を決める。
  //  - 表の外周で、表に罫線の無い辺 (セルが持つ): 辺ごと。外周のセルの箱は、いちばん太い線の外の縁まで広がる (collapsedOuterHalves)
  //  - 互換の組み方 (collapseToAfterCell) の内側の線: 後ろのセルの箱は、行・列の境目で始まる。線ごと (行の境目は行の番号、列の境目は列の番号)
  // CSS 2.1 §17.6.2: 罫線はセルの間のグリッド線を中心に置く (XSL 1.1 §6.7.10 も、内容の矩形をグリッド線から罫線の太さの半分の内側とする)。
  // アンテナハウスの見本 (table-border-conflict-resolution-1) も、太さの違う線の中心をそろえる
  const edgeMax: Partial<Record<Side, number>> = {};
  const lineMax = new Map<string, number>();
  const lineKey = (p: Placed, side: Side) => (side === S.bs ? `b${p.r}` : `i${p.c}`);
  for (const p of placed) {
    const m = acc.get(p);
    if (!m) continue;
    for (const side of touched.get(p) ?? []) {
      const w = m[side];
      if (!w || open.get(p)?.has(side)) continue;
      if (isEdge(p, side)) {
        if (!tableOwns(side)) edgeMax[side] = Math.max(edgeMax[side] ?? 0, w.width);
      } else if (table.collapseToAfterCell && (side === S.bs || side === S.is)) {
        const k = lineKey(p, side);
        lineMax.set(k, Math.max(lineMax.get(k) ?? 0, w.width));
      }
    }
  }
  // 太さ w の線を、場所 max の中で中心に置く辺 (場所は max の半分と w の半分。線は w の太さで、箱の縁から (max − w) / 2 だけ内に描く)
  const centered = (w: BorderSide, max: number | undefined, edge: boolean): BorderSide => {
    const s = { width: w.width, color: w.color, ...(w.style ? { style: w.style } : {}) };
    if (max === undefined || max - w.width <= 1e-6) return edge ? { ...s, collapse: { tableEdge: true } } : s;
    return { ...s, width: (max + w.width) / 2, collapse: { paintWidth: w.width, ...(edge ? { tableEdge: true } : {}) } };
  };
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
        // 表の外周: 表に罫線があれば表が描く。無ければセルが持つ (線の中心を、辺のいちばん太い線の中心にそろえる)
        if (!tableOwns(side)) out[side] = centered(w, edgeMax[side], true);
        continue;
      }
      if (table.collapseToAfterCell) {
        // アンテナハウス互換: 後ろ (右・下) のセルが持つ (線の中心を、その線のいちばん太い線の中心にそろえる)。前のセルの辺は無し
        if (side === S.bs || side === S.is) out[side] = centered(w, lineMax.get(lineKey(p, side)), false);
        continue;
      }
      const base = { width: w.width / 2, color: w.color, ...(w.style ? { style: w.style } : {}) };
      // 内側の線: 前 (左・上) のセルは場所だけ取り、後ろ (右・下) のセルがグリッド線を中心に描く
      out[side] = side === S.bs || side === S.is ? { ...base, collapse: { paintWidth: w.width } } : { ...base, collapse: { noPaint: true } };
    }
    p.cell.border = out;
    const e = edges.get(p);
    if (e) p.cell.breakEdges = e;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (!edgeAny[side]) continue;
    if (tableOwns(side)) {
      const w = edgeWin[side];
      if (w) tb[side] = w;
      else delete tb[side];
    } else delete tb[side];
  }

  return withRef(table, {
    ...table,
    border: tb,
    ...(table.collapseToAfterCell ? { collapseColumnLines: Array.from({ length: nCols }, (_, k) => (k > 0 ? (lineMax.get(`i${k}`) ?? 0) : 0)) } : {}),
    ...(hRows.length || fRows.length ? { breakBorders: { headerAfter, footerBefore } } : {}),
    ...(table.header ? { header: { ...table.header, rows: hRows } } : {}),
    body: { ...table.body, rows: bRows },
    ...(table.footer ? { footer: { ...table.footer, rows: fRows } } : {}),
  });
}

/** 写した節 to に、元の節 from の入力の番号 (sourceRef) を引き継いで返す */
function withRef<T extends object>(from: unknown, to: T): T {
  copySourceRef(from, to);
  return to;
}

/**
 * 改ページの境目の線分の罫線を選び直す (XSL 1.1 §6.7.10 の規則)。edge は繰り返す表ヘッダー (または表フッター) の列ごとの線、
 * [c, c + cs) はセルの占める列、cell はそのセルの境目の側の線。edge が先 (上) なので、同じ線なら edge が勝つ。
 * 列ごとの線分の結果のうち、太い方を返す (セルの 1 つの辺には 1 本の線しか持てないため。線分の無い列だけなら undefined)
 */
export function breakEdgeBorder(edge: Array<BorderSide | undefined>, c: number, cs: number, cell: BorderSide | undefined): BorderSide | undefined {
  let out: BorderSide | undefined;
  for (let x = c; x < Math.min(c + cs, edge.length); x++) out = wider(out, winningBorder(edge[x], cell));
  return out;
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
 * 列の並びを、値の同じ範囲 ([s, e) の列) の並びとして持つ (グリッドの 1 行など)。範囲は重ならず、列の順に並ぶ。範囲の無い列は値が無い。
 * 列をまたぐセルを、列ごとのマスでなく範囲のまま持つ (colspan="1000" のセルが並ぶ表は、列が 10 万本を超える)
 */
export class ColumnRuns<T> {
  /** 範囲の始め・終わり (終わりは含まない)・値 */
  readonly s: number[] = [];
  readonly e: number[] = [];
  readonly v: T[] = [];

  get length(): number {
    return this.s.length;
  }

  /** 範囲の終わり (最後の範囲の終わり。範囲が無ければ 0) */
  get end(): number {
    return this.e.length ? this.e[this.e.length - 1] : 0;
  }

  /** 終わりが x より後の、最初の範囲の番号 */
  private firstEndAfter(x: number): number {
    let lo = 0;
    let hi = this.e.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.e[m] > x) hi = m;
      else lo = m + 1;
    }
    return lo;
  }

  /** 列 x の範囲の番号 (x を含む範囲が無ければ -1) */
  indexAt(x: number): number {
    const i = this.firstEndAfter(x);
    return i < this.s.length && this.s[i] <= x ? i : -1;
  }

  /** 列 x の値 */
  at(x: number): T | undefined {
    const i = this.indexAt(x);
    return i < 0 ? undefined : this.v[i];
  }

  /** [a, b) の列を値 v にする (前に書いた値は、重なる列だけ上書きする。列ごとに書くのと同じ結果) */
  paint(a: number, b: number, v: T): void {
    if (b <= a) return;
    const n = this.s.length;
    if (!n || this.e[n - 1] <= a) {
      this.s.push(a);
      this.e.push(b);
      this.v.push(v);
      return;
    }
    const i = this.firstEndAfter(a);
    let j = i;
    while (j < n && this.s[j] < b) j++;
    const S: number[] = [];
    const E: number[] = [];
    const V: T[] = [];
    if (i < j && this.s[i] < a) S.push(this.s[i]), E.push(a), V.push(this.v[i]);
    S.push(a), E.push(b), V.push(v);
    if (i < j && this.e[j - 1] > b) S.push(b), E.push(this.e[j - 1]), V.push(this.v[j - 1]);
    this.s.splice(i, j - i, ...S);
    this.e.splice(i, j - i, ...E);
    this.v.splice(i, j - i, ...V);
  }
}

/**
 * セルのグリッドへの割り付け (rowSpan / colSpan)。上の行から伸びてきたセルが占める列は飛ばし、colSpan・rowSpan は 1 以上に丸める。
 * 行をまたぐセルは、行グループ (header・body・footer) の中だけで伸ばす。grid[行] はその行の列ごとの、その位置を占めるセル (欠けていれば値が無い)。
 * placed は行の順・セルの順 (元の cells の並び)。罫線の重ね合わせ・列幅の計測・行グループの配置・rowSpan の分割が、みな同じ割り付けを使う。
 * 列をまたぐセルは、範囲のまま扱う (手間は、セルの数とまたぐ行の数に比例し、またぐ列の数にはよらない)
 */
export function placeCells<C extends LTableCell>(groups: Array<Array<{ cells: C[] }>>): { placed: PlacedCell<C>[]; grid: Array<ColumnRuns<PlacedCell<C>>>; nCols: number } {
  const all = groups.flat();
  const placed: PlacedCell<C>[] = [];
  const grid = all.map(() => new ColumnRuns<PlacedCell<C>>());
  let g0 = 0;
  for (const g of groups) {
    const g1 = g0 + g.length;
    // 列ごとの、上の行から伸びてきたセルの最後の行 (rowSpan が 2 以上のセルが書く。後に書いたセルが勝つ)
    const occupiedUntil = new ColumnRuns<number>();
    for (let r = g0; r < g1; r++) {
      let c = 0;
      for (const cell of all[r].cells) {
        // 上の行から伸びてきたセルが占める列を飛ばす (列を 1 つずつ見るのと同じ)
        let i = occupiedUntil.indexAt(c);
        while (i >= 0 && i < occupiedUntil.length && occupiedUntil.s[i] <= c && occupiedUntil.v[i] >= r) c = occupiedUntil.e[i++];
        const cs = Math.max(1, cell.colSpan ?? 1);
        const rs = Math.max(1, Math.min(cell.rowSpan ?? 1, g1 - r));
        const p: PlacedCell<C> = { cell, r, c, rs, cs };
        placed.push(p);
        for (let y = r; y < r + rs; y++) grid[y].paint(c, c + cs, p);
        if (rs > 1) occupiedUntil.paint(c, c + cs, r + rs - 1);
        c += cs;
      }
    }
    g0 = g1;
  }
  let nCols = 0;
  for (const row of grid) nCols = Math.max(nCols, row.end);
  return { placed, grid, nCols };
}

/**
 * 隣り合う 2 行 (a・b、無ければ undefined) の列を、どちらの値も変わらない区間 [x0, x1) に分けて、列の順に返す。
 * どちらの行にもセルの無い区間は返さない
 */
function pairSegments<T>(a: ColumnRuns<T> | undefined, b: ColumnRuns<T> | undefined): Array<[number, number, T | undefined, T | undefined]> {
  const pts: number[] = [];
  const ra = a ?? new ColumnRuns<T>();
  const rb = b ?? new ColumnRuns<T>();
  for (const r of [ra, rb]) for (let i = 0; i < r.length; i++) pts.push(r.s[i], r.e[i]);
  pts.sort((x, y) => x - y);
  const out: Array<[number, number, T | undefined, T | undefined]> = [];
  let ia = 0;
  let ib = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const x0 = pts[k];
    const x1 = pts[k + 1];
    if (x1 <= x0) continue;
    while (ia < ra.length && ra.e[ia] <= x0) ia++;
    while (ib < rb.length && rb.e[ib] <= x0) ib++;
    const va = ia < ra.length && ra.s[ia] <= x0 ? ra.v[ia] : undefined;
    const vb = ib < rb.length && rb.s[ib] <= x0 ? rb.v[ib] : undefined;
    if (va === undefined && vb === undefined) continue;
    out.push([x0, x1, va, vb]);
  }
  return out;
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
  const column = (x: number) => grid.map((g) => g.at(x)?.cell);
  return {
    bs: half(S.bs, rows[0]?.cells ?? []),
    // 最後の行も、グリッドで取る (上の行から rowSpan で伸びてきたセルも、表の末尾の辺に接する)
    be: half(S.be, grid.length ? grid[grid.length - 1].v.map((p) => p.cell) : []),
    is: half(S.is, column(0)),
    ie: half(S.ie, column(nCols - 1)),
  };
}

/**
 * 表の 1 行目のセルが、列ごとに箱の中で取る罫線の幅 (始めの辺 + 終わりの辺)。列の幅の指定の無い列に、罫線を除いた幅を等しく配るのに
 * 使う (columnSizes。CSS 2.1 §17.5.2.1)。collapse の表は collapseTableBorders を通した後のセルの辺の幅 (= 場所)、罫線を分ける表は
 * セルの罫線の幅。列をまたぐセルは、始めの辺をはじめの列、終わりの辺を終わりの列に数える。セルの無い列は 0
 */
export function firstRowBorderWidths(table: LTable, wm: WritingMode): number[] {
  const S = sides(wm);
  const { grid, nCols } = placeCells([table.header?.rows ?? [], table.body.rows, table.footer?.rows ?? []]);
  const out = new Array<number>(nCols).fill(0);
  const row = grid[0];
  if (!row) return out;
  const w = (b: BorderSide | undefined) => (b && b.width > 0 && b.style !== 'hidden' ? b.width : 0);
  for (let i = 0; i < row.length; i++) {
    const b = normBorder(row.v[i].cell.border);
    out[row.s[i]] += w(b[S.is]);
    out[row.e[i] - 1] += w(b[S.ie]);
  }
  return out;
}
