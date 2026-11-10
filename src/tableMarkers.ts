/**
 * fo:retrieve-table-marker (XSL 1.1 §6.13.7) の、取り出すマーカーの決め方。
 *
 * 表は、ページ・段ごとの断片 (retrieve scope area) に分かれる。本体のセル・セルの中のブロック・本体 (fo:table-body) に付いたマーカーは、
 * その親の領域 (断片ごと) に付き、最初の断片の領域は is-first、最後の断片の領域は is-last (§4.2.2)。
 * 取り出す fo:retrieve-table-marker のある断片 (primary retrieve scope area) と、retrieve-boundary-within-table (§7.25.2) で決まる範囲の
 * 断片の中から、retrieve-position-within-table (§7.25.6) に従って 1 つ選ぶ。「最初」「最後」は領域の木の前順。
 */
import type { LBlockLevel, LInlineLevel, LMarker, LRetrieveTableMarker } from './types';
import { copySourceRef } from './sourceRef';

/** マーカーの付いた領域 1 つ (断片の中の、前順の並びで持つ) */
export interface MarkerArea {
  marker: LMarker;
  /** その親の最初の領域か (is-first) */
  first: boolean;
  /** その親の最後の領域か (is-last) */
  last: boolean;
  /** 本体 (fo:table-body) に付いたマーカーなら、その本体の目印 (LTableRow.bodyMarkers.markers)。断片の中で 1 度だけ数える */
  body?: object;
}

/** 行の塊 1 つ (まとめて置く行) が、断片に加える領域 */
export interface GroupMarkers {
  /** セル・セルの中のブロックのマーカーの領域 (前順) */
  areas: MarkerArea[];
  /** 行の属する本体のマーカー。first: 本体の最初の領域になる (本体の最初の行の、最初の断片)・last: 本体の最後の領域になる */
  bodies: Array<{ markers: LMarker[]; first: boolean; last: boolean }>;
}

/** class ごとの、閉じた断片のまとめ (範囲の中の「最後」を引くためのもの) */
interface Summary {
  last?: LMarker;
  lastFirst?: LMarker;
  lastLast?: LMarker;
}

/** 断片に行の塊を加えた後の領域の並び (元の並びは変えない) */
export function extendAreas(areas: readonly MarkerArea[], g: GroupMarkers | undefined): MarkerArea[] {
  if (!g || (!g.areas.length && !g.bodies.length)) return areas as MarkerArea[];
  let out = areas.slice();
  const own: MarkerArea[] = [];
  for (const b of g.bodies) {
    if (out.some((a) => a.body === b.markers)) {
      // 本体の領域は、この断片にもうある: 本体の最後の行が来たら、is-last にする
      if (b.last) out = out.map((a) => (a.body === b.markers && !a.last ? { ...a, last: true } : a));
    } else if (!own.some((a) => a.body === b.markers)) {
      // 本体の領域は、その中のセルの領域より前 (前順)
      for (const marker of b.markers) own.push({ marker, first: b.first, last: b.last, body: b.markers });
    } else if (b.last) {
      for (const a of own) if (a.body === b.markers) a.last = true;
    }
  }
  return [...out, ...own, ...g.areas];
}

/** 表 1 つの、断片ごとのマーカーの記録 */
export class TableMarkerScope {
  /** いまの断片 (primary retrieve scope area) の領域 */
  areas: MarkerArea[] = [];
  /** 前の断片すべてのまとめ (retrieve-boundary-within-table="table") */
  private table = new Map<string, Summary>();
  /** 同じページの前の断片のまとめ (retrieve-boundary-within-table="page") */
  private page = new Map<string, Summary>();

  /** いまの断片を閉じて、次の断片を始める。samePage: 次の断片が同じページ (次の段) にある */
  nextFragment(samePage: boolean) {
    if (!samePage) this.page.clear();
    for (const a of this.areas) {
      for (const map of samePage ? [this.table, this.page] : [this.table]) {
        let s = map.get(a.marker.className);
        if (!s) map.set(a.marker.className, (s = {}));
        s.last = a.marker;
        if (a.first) s.lastFirst = a.marker;
        if (a.last) s.lastLast = a.marker;
      }
    }
    this.areas = [];
  }

  /**
   * いまの断片の領域が areas のとき、r が取り出すマーカー (§6.13.7)。
   * first-starting: 断片の中で is-first の最初 → 断片の中の最初 → 範囲の中の最後
   * first-including-carryover: 断片の中の最初 → 範囲の中の最後
   * last-starting: 範囲の中で is-first の最後 → 範囲の中の最後
   * last-ending: 範囲の中で is-last の最後 → 範囲の中の最後
   */
  find(r: LRetrieveTableMarker, areas: readonly MarkerArea[]): LMarker | undefined {
    const position = r.position ?? 'first-starting';
    const boundary = r.boundary ?? 'table';
    const own = areas.filter((a) => a.marker.className === r.className);
    const before: Summary = (boundary === 'table' ? this.table : boundary === 'page' ? this.page : undefined)?.get(r.className) ?? {};
    const lastOf = (xs: MarkerArea[]) => xs[xs.length - 1]?.marker;
    const lastInScope = () => lastOf(own) ?? before.last;
    if (position === 'first-starting') return (own.find((a) => a.first) ?? own[0])?.marker ?? before.last;
    if (position === 'first-including-carryover') return own[0]?.marker ?? before.last;
    if (position === 'last-starting') return lastOf(own.filter((a) => a.first)) ?? before.lastFirst ?? lastInScope();
    return lastOf(own.filter((a) => a.last)) ?? before.lastLast ?? lastInScope();
  }
}

type Kids = Array<LBlockLevel | LInlineLevel>;

/**
 * node の中の、type が retrieveType の節 (fo:retrieve-marker・fo:retrieve-table-marker) を、find の返すマーカーの中身 (無ければ空) に
 * 置き換えた複製を返す。中身が行の中のものだけなら inline で包み、マーカー自身の書式を保つ。
 * skipTables: 入れ子の表の中は置き換えない (入れ子の表の fo:retrieve-table-marker は、その表が取り出す)
 */
export function replaceRetrieves<T, R extends { type: string; variants?: Record<number, Kids> }>(node: T, retrieveType: R['type'], find: (r: R) => LMarker | undefined, skipTables = false): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.flatMap((e) => {
        if (e && typeof e === 'object' && (e as { type?: string }).type === retrieveType) {
          const r = e as R;
          const m = find(r);
          if (!m) return [];
          const kids = ((m.key !== undefined && r.variants?.[m.key]) || m.children).map(walk) as Kids;
          const allInline = kids.every((k) => typeof k === 'string' || ['inline', 'ruby', 'tate-chu-yoko', 'leader'].includes((k as { type: string }).type));
          if (!allInline) return kids;
          const { type: _t, className: _c, children: _k, ...style } = m;
          void _t; void _c; void _k;
          return [{ ...style, type: 'inline', children: kids }];
        }
        return [walk(e)];
      });
    }
    if (v && typeof v === 'object') {
      if (skipTables && (v as { type?: string }).type === 'table') return v;
      const copy = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, walk(val)]));
      copySourceRef(v, copy);
      return copy;
    }
    return v;
  };
  return walk(node) as T;
}

/** node の中の fo:retrieve-table-marker (入れ子の表の中は除く) を、文書の順に集める */
export function collectTableRetrieves(node: unknown, out: LRetrieveTableMarker[] = []): LRetrieveTableMarker[] {
  if (Array.isArray(node)) for (const e of node) collectTableRetrieves(e, out);
  else if (node && typeof node === 'object') {
    const t = (node as { type?: string }).type;
    if (t === 'retrieve-table-marker') out.push(node as LRetrieveTableMarker);
    else if (t !== 'table') for (const v of Object.values(node)) if (v && typeof v === 'object') collectTableRetrieves(v, out);
  }
  return out;
}
