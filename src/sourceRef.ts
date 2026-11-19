/**
 * sourceRef — 組版の入力 (LDocument) の節の通し番号。Area の sourceRef は、この番号で元の節を指す。
 *
 * 番号は documentNodes が返す並び (深さ優先・前順。欄の並びは入力の物のまま) の位置。
 * type の欄 (文字列) を持つ物を節とみなし、配列と type の無い物 (ページの指定など) の中もたどる。
 */
import type { GridItemFloor, LDocument, LTable, LTableCell } from './types';

/** 入力の節 (type の欄を持つ物) を、深さ優先・前順に並べる */
export function documentNodes(doc: LDocument): object[] {
  const out: object[] = [];
  const seen = new Set<object>();
  const go = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) go(x);
      return;
    }
    if (typeof (v as { type?: unknown }).type === 'string') out.push(v);
    for (const x of Object.values(v)) go(x);
  };
  go(doc);
  return out;
}

const REFS = new WeakMap<object, number>();

/** 入力の節に通し番号を付ける (組版の始めに 1 回)。番号の順の節の並びを返す */
export function indexDocument(doc: LDocument): object[] {
  const nodes = documentNodes(doc);
  nodes.forEach((n, k) => REFS.set(n, k));
  return nodes;
}

/** 入力の節の通し番号 (付いていなければ undefined) */
export function sourceRef(node: unknown): number | undefined {
  return node && typeof node === 'object' ? REFS.get(node) : undefined;
}

/** 写した節 (静的な内容の複製など) に、元の節の番号を引き継ぐ */
export function copySourceRef(from: unknown, to: object) {
  const r = sourceRef(from);
  if (r !== undefined) REFS.set(to, r);
}

type GridTemplate = NonNullable<LTable['gridTemplate']>;
/** 列挙しない性質の items を持つ grid の容器が、1 つでも作られたか (無ければ、写すときの記録 gridCopies を作らない) */
let gridItemsMade = false;

/**
 * grid の容器 (LTable.gridTemplate) に、列の下限を測る項目の並び (GridItemFloor。全部の行の項目のセルを指す) を、列挙しない性質として持たせる。
 * 同じ grid の行の表は、どれも同じ gridTemplate を持つので、列挙する性質にすると、文書の木を性質を選ばずにたどる所 (字形の無い字の数え・
 * id の集め・節の番号・写し) が、行の表ごとに、grid の全部の項目をたどり直す (項目の数の 2 乗。入れ子の grid では深さの指数)。
 * Object.entries・Object.values・{ ...g }・JSON・structuredClone は、この性質を見ない (写すときは gridCopies で付け直す)
 */
export function setGridItems(g: GridTemplate, items: GridItemFloor[]): void {
  Object.defineProperty(g, 'items', { value: items, enumerable: false, writable: true, configurable: true });
  gridItemsMade = true;
}

/**
 * 文書の木の写し (静的な内容のページ番号の差し替え・マーカーの取り出し・詰め込みの字の大きさ) で、grid の項目の並び (setGridItems) を、
 * 写した木のセルを指すように付け直すための記録。写した節ごとに note(元, 写し) を呼び、写し終えたら done() を呼ぶ。
 * done は、元の grid の容器ごとに 1 つの写しを作り (行の表の間で同じ物のまま。下限・列の幅の覚えが grid ごとに 1 度で済む)、
 * その項目のセルを、写したセルに置き換える (写していないセルは元のまま)。items を持つ grid の容器が無ければ undefined (記録しない)
 */
export function gridCopies(): { note(from: object, to: object): void; done(): void } | undefined {
  if (!gridItemsMade) return undefined;
  const cells = new Map<object, object>();
  const tables: Array<[{ gridTemplate?: GridTemplate }, GridTemplate]> = [];
  return {
    note(from, to) {
      const g = (from as { gridTemplate?: GridTemplate }).gridTemplate;
      if (g?.items) tables.push([to as { gridTemplate?: GridTemplate }, g]);
      else if ((from as { type?: unknown }).type === 'table-cell') cells.set(from, to);
    },
    done() {
      const made = new Map<GridTemplate, GridTemplate>();
      for (const [to, g] of tables) {
        let c = made.get(g);
        if (!c) {
          const cur = to.gridTemplate;
          c = cur && cur !== g ? cur : { ...g };
          setGridItems(c, g.items!.map((it) => ({ ...it, cell: (cells.get(it.cell) ?? it.cell) as LTableCell })));
          made.set(g, c);
        }
        to.gridTemplate = c;
      }
    },
  };
}
