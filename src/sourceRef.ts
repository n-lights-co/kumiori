/**
 * sourceRef — 組版の入力 (LDocument) の節の通し番号。Area の sourceRef は、この番号で元の節を指す。
 *
 * 番号は documentNodes が返す並び (深さ優先・前順。欄の並びは入力の物のまま) の位置。
 * type の欄 (文字列) を持つ物を節とみなし、配列と type の無い物 (ページの指定など) の中もたどる。
 */
import type { DiagnosticSource } from './diagnostics';
import type { GridItemFloor, LDocument, LTable, LTableCell } from './types';

/**
 * 入力の節 (type の欄を持つ物) を、深さ優先・前順に並べる。ends を渡すと、節ごとに、その部分木の最後の節の番号を入れる
 * (節を初めて見つけた所の部分木。同じ物を 2 度目に見つけた所はたどらない)
 */
export function documentNodes(doc: LDocument, ends?: WeakMap<object, number>): object[] {
  const out: object[] = [];
  const seen = new Set<object>();
  const go = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) go(x);
      return;
    }
    const typed = typeof (v as { type?: unknown }).type === 'string';
    if (typed) out.push(v);
    for (const x of Object.values(v)) go(x);
    if (typed && ends) ends.set(v, out.length - 1);
  };
  go(doc);
  return out;
}

const REFS = new WeakMap<object, number>();
const ENDS = new WeakMap<object, number>();

/** 入力の節に通し番号を付ける (組版の始めに 1 回)。番号の順の節の並びを返す */
export function indexDocument(doc: LDocument): object[] {
  const nodes = documentNodes(doc, ENDS);
  nodes.forEach((n, k) => REFS.set(n, k));
  return nodes;
}

/**
 * 入力の節の部分木の、最後の節の通し番号 (indexDocument が付けたもの。付いていなければ undefined)。
 * ページが後ろのどこまでの中身で決まったか (読んだ先。design/resumable-flow.md の 5.1) に使う
 */
export function sourceRefEnd(node: unknown): number | undefined {
  return node && typeof node === 'object' ? ENDS.get(node) : undefined;
}

/** 入力の節の通し番号 (付いていなければ undefined) */
export function sourceRef(node: unknown): number | undefined {
  return node && typeof node === 'object' ? REFS.get(node) : undefined;
}

/** 写した節 (静的な内容の複製など) に、元の節の番号と入力の場所 (診断の source) を引き継ぐ */
export function copySourceRef(from: unknown, to: object) {
  const r = sourceRef(from);
  if (r !== undefined) REFS.set(to, r);
  const s = nodeSource(from);
  if (s) NODE_SOURCES.set(to, s);
}

/** 組版の節 → 入力の場所 (読み込みが、要素から作った節に結び付ける。sourceLocation.ts) */
const NODE_SOURCES = new WeakMap<object, DiagnosticSource>();
/** 組版の節に、入力の場所を結び付ける (もう結び付いていれば変えない: 内の要素の節は、その要素の場所のまま) */
export function tagNodeSource(node: unknown, src: DiagnosticSource): void {
  if (node && typeof node === 'object' && !NODE_SOURCES.has(node)) NODE_SOURCES.set(node, src);
}
/** 組版の節の入力の場所 */
export function nodeSource(node: unknown): DiagnosticSource | undefined {
  return node && typeof node === 'object' ? NODE_SOURCES.get(node) : undefined;
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

/**
 * 文書のどこかに背景の画像 (url の画像・グラデーション。CSS の background-image・XSL-FO の background-image、ページの領域の背景も) があるか
 * (組みながらページを描画するかを決める。api.ts の typesetToPdf。背景の画像は、組んだ後で画像の格納先に登録するので、組む前の格納先には無い)
 */
export function hasBackgroundImage(doc: LDocument): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [doc];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object') stack.push(x);
      continue;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'backgroundImage' && x) return true;
      if (x && typeof x === 'object') stack.push(x);
    }
  }
  return false;
}
