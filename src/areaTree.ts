/**
 * areaTree — Area Tree (組版の結果) を扱う共通の関数。
 *
 * Area Tree の決まり (版 AREA_TREE_SCHEMA_VERSION):
 *   - 単位はすべて pt (1/72 inch)。
 *   - 座標は物理座標で、y は下向き。SheetArea の原点は用紙 (トンボ領域を含む) の左上。
 *   - x, y は「親 Area の content-box の左上」から、この Area の border-box の左上までの位置。width, height は border-box の大きさ。
 *     PageArea の子 (regionBody・absoluteAreas・behindAreas) も、PageArea の content-box (padding・border は 0) から測る。
 *   - orientation (箱の回転) があれば、width・height は回転前の大きさ、x・y は回転後の外接矩形の左上。子の座標は回転前の局所座標。
 *   - 子の並びは描く順 (先のものが下)。childrenOf が、どの欄が子かを決める唯一の場所。
 *   - sourceRef は、その Area を作った入力の節の位置 (documentNodes(doc) の添字)。
 */
import type { Area, AreaTree, SheetArea } from "./types";

/** 入力 (LDocument) の節の並び。Area の sourceRef はこの並びの位置 (sourceRef.ts) */
export { documentNodes } from "./sourceRef";

/**
 * Area Tree の形の版。欄の意味や子の持ち方を変えたら上げる。
 *  - 1: 最初の版
 *  - 2: 表の罫線の重ね合わせの描き方 (paintWidth・noPaint・tableEdge) を、BorderSide の欄から BorderSide.collapse の下に移した
 */
export const AREA_TREE_SCHEMA_VERSION = 2;

/** 版 1 の罫線の辺を、版 2 の形 (重ね合わせの描き方を collapse の下へ) に直す */
function upgradeSide(side: unknown) {
  if (!side || typeof side !== 'object') return;
  const sd = side as Record<string, unknown>;
  const c: Record<string, unknown> = {};
  for (const k of ['paintWidth', 'noPaint', 'tableEdge']) {
    if (k in sd) {
      c[k] = sd[k];
      delete sd[k];
    }
  }
  if (Object.keys(c).length) sd.collapse = c;
}

/** Area Tree の節 (SheetArea を含む) */
export type AreaNode = Area | SheetArea;

/**
 * 節の子を、描く順 (先のものが下) に返す。
 *  - sheet: page
 *  - page: behindAreas (本文の背面) → regionBody → absoluteAreas
 *  - ruby: base (親文字) → ruby (ルビ)
 *  - tate-chu-yoko: glyphs
 *  - glyph・image: 子は無い
 *  - ほか (region-body・block・line・inline・table・table-row・table-cell): children
 */
export function childrenOf(a: AreaNode): Area[] {
  switch (a.type) {
    case "sheet":
      return [a.page];
    case "page":
      return [...a.behindAreas, a.regionBody, ...a.absoluteAreas];
    case "ruby":
      return [...a.base, ...a.ruby];
    case "tate-chu-yoko":
      return a.glyphs;
    case "glyph":
    case "image":
      return [];
    default:
      return a.children;
  }
}

/**
 * 節を深さ優先・前順 (親が先、子は描く順) にたどる。visit が false を返すと、その節の子はたどらない。
 * parent は親の節 (根では undefined)、depth は根からの深さ (根は 0)
 */
export function walkAreas(
  root: AreaNode,
  visit: (
    a: AreaNode,
    parent: AreaNode | undefined,
    depth: number,
  ) => boolean | void,
): void {
  const go = (a: AreaNode, parent: AreaNode | undefined, depth: number) => {
    if (visit(a, parent, depth) === false) return;
    for (const c of childrenOf(a)) go(c, a, depth + 1);
  };
  go(root, undefined, 0);
}

/** 文書のすべてのシートをたどる (walkAreas をシートごとに) */
export function walkAreaTree(
  tree: AreaTree,
  visit: (
    a: AreaNode,
    parent: AreaNode | undefined,
    depth: number,
  ) => boolean | void,
): void {
  for (const s of tree.sheets) walkAreas(s, visit);
}

/** Area の種類 (types.ts の AreaType) */
const AREA_TYPES = new Set(['sheet', 'page', 'region-body', 'block', 'line', 'inline', 'glyph', 'table', 'table-row', 'table-cell', 'ruby', 'tate-chu-yoko', 'image']);

/**
 * Area Tree を JSON の文字列にする。共有している物 (凍結した余白の物など) は、JSON では別々の物になる。
 * undefined の欄は書かない (JSON の決まり)
 */
export function serializeAreaTree(tree: AreaTree): string {
  return JSON.stringify(tree);
}

/** 読み直した Area Tree の形の誤り */
export class AreaTreeFormatError extends Error {}

/**
 * JSON の文字列から Area Tree を読む。版 (schemaVersion) と、節の形 (種類・位置と大きさの数・子の欄) を確かめる。
 * 形が合わなければ AreaTreeFormatError。読んだ木は、描く処理 (paintSheet・renderPdf) にそのまま渡せる
 * (書体と画像は、書いたときと同じ FontManager・AssetStore が要る)
 */
export function parseAreaTree(json: string): AreaTree {
  let tree: AreaTree;
  try {
    tree = JSON.parse(json) as AreaTree;
  } catch (e) {
    throw new AreaTreeFormatError(`JSON として読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!tree || typeof tree !== 'object') throw new AreaTreeFormatError('Area Tree ではありません');
  const version = (tree as { schemaVersion?: unknown }).schemaVersion;
  if (version !== AREA_TREE_SCHEMA_VERSION && version !== 1) throw new AreaTreeFormatError(`版 ${String(version)} は読めません (読めるのは 1 と ${AREA_TREE_SCHEMA_VERSION})`);
  if (!Array.isArray(tree.sheets)) throw new AreaTreeFormatError('sheets がありません');
  if (!Array.isArray(tree.warnings)) tree.warnings = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const check = (a: AreaNode, path: string) => {
    if (!a || typeof a !== 'object' || !AREA_TYPES.has((a as { type?: string }).type ?? '')) throw new AreaTreeFormatError(`${path}: Area の種類が読めません`);
    for (const k of ['x', 'y', 'width', 'height'] as const) if (!num(a[k])) throw new AreaTreeFormatError(`${path} (${a.type}): ${k} が数ではありません`);
    const kids =
      a.type === 'sheet' ? [a.page] : a.type === 'page' ? [a.regionBody, ...(a.behindAreas ?? []), ...(a.absoluteAreas ?? [])] : a.type === 'ruby' ? [...(a.base ?? []), ...(a.ruby ?? [])] : a.type === 'tate-chu-yoko' ? (a.glyphs ?? []) : a.type === 'glyph' || a.type === 'image' ? [] : (a as { children?: unknown }).children;
    if (!Array.isArray(kids)) throw new AreaTreeFormatError(`${path} (${a.type}): 子の欄がありません`);
    if (a.type === 'page' && (!Array.isArray(a.behindAreas) || !Array.isArray(a.absoluteAreas))) throw new AreaTreeFormatError(`${path} (page): behindAreas・absoluteAreas がありません`);
    if (a.type === 'glyph' && typeof a.text !== 'string') throw new AreaTreeFormatError(`${path} (glyph): text がありません`);
    if (a.type === 'image' && typeof a.src !== 'string') throw new AreaTreeFormatError(`${path} (image): src がありません`);
    kids.forEach((c, k) => check(c as AreaNode, `${path}/${k}`));
  };
  tree.sheets.forEach((s, k) => {
    if (s?.type !== 'sheet') throw new AreaTreeFormatError(`sheets/${k}: sheet ではありません`);
    check(s, `sheets/${k}`);
  });
  // 版 1 の木は、版 2 の形に直して返す
  if (version === 1) {
    walkAreaTree(tree, (a) => {
      for (const side of Object.values(a.border ?? {})) upgradeSide(side);
      for (const d of (a as { diagonals?: Array<{ side: unknown }> }).diagonals ?? []) upgradeSide(d.side);
    });
    tree.schemaVersion = AREA_TREE_SCHEMA_VERSION;
  }
  return tree;
}
