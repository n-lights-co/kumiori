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
import type { Area, AreaTree, BookmarkArea, SheetArea } from "./types";
import { msg } from './messages';
import { memoryRuntime } from './memoryEstimate';
import { KumioriInputError } from './errors';

/** 入力 (LDocument) の節の並び。Area の sourceRef はこの並びの位置 (sourceRef.ts) */
export { documentNodes } from "./sourceRef";

/**
 * Area Tree の形の版。欄の意味や子の持ち方を変えたら上げる。
 *  - 1: 最初の版
 *  - 2: 表の罫線の重ね合わせの描き方 (paintWidth・noPaint・tableEdge) を、BorderSide の欄から BorderSide.collapse の下に移した
 *  - 3: collapse.paintWidth が width より小さい辺 (線を箱の縁から内へずらして描く) を足した (表の太さの違う罫線の中心をそろえる)。
 *       版 2 の木は、そのまま版 3 の木として読める
 */
export const AREA_TREE_SCHEMA_VERSION = 3;

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
  // 再帰でなく、明示のスタックでたどる (深い木でスタックを使い切らない)。積むのは「まだ訪ねていない節」で、
  // 子は後ろから積む (先の子が先に出る) ので、訪ねる順は再帰でたどるのと同じ
  const nodes: AreaNode[] = [root];
  const parents: Array<AreaNode | undefined> = [undefined];
  const depths: number[] = [0];
  while (nodes.length) {
    const a = nodes.pop()!;
    const parent = parents.pop();
    const depth = depths.pop()!;
    if (visit(a, parent, depth) === false) continue;
    const kids = childrenOf(a);
    for (let k = kids.length - 1; k >= 0; k--) {
      nodes.push(kids[k]);
      parents.push(a);
      depths.push(depth + 1);
    }
  }
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

/**
 * 領域の木のメモリの見積もり (estimateAreaTreeBytes) の係数 (バイト)。組んだ結果を手放したときのヒープの差を、数にならした目安
 * (scripts/measure-result-memory.mjs で測る。測った文書・処理系・条件は、docs/development.md の「組んだ結果のメモリの見積もりの測り」)。
 *  - area: 領域 1 つ (物の欄・座標・様式の値・字の領域の字形の番号と位置など)。Node 22 (V8) で、Typesetter の再利用なしで組んだ結果を
 *    dispose して減ったヒープから、画像と書体の分を除いて領域の数で割った値: プレビューをまねた HTML (200 ページ・領域 18.8 万) で約 340、
 *    文だけの HTML (215 ページ) で約 330、対応仕様説明書の XSL-FO (100 ページ) で約 360 バイト (node の値)。Chromium 158 の Web Worker の中
 *    (量は Worker の CDP の Runtime.getHeapUsage の usedSize) では、同じ文書で約 200・約 190・約 220 バイト (browser の値。V8 のポインタの圧縮で、物が小さい)。
 *    どちらを使うかは memoryEstimate.ts の memoryRuntime (Firefox・Safari は測っていないが、browser の値を使う)
 *  - structNode・tag: タグ付き PDF の構造の木の節 1 つと、入力の節ごとの構造の節の番号の表の 1 項目。
 *    bookmark・destination: しおり 1 つと飛び先 1 つ (題・名前の字の分は別に、1 字 2 バイトで足す)。
 *    この 4 つは、物の欄の数から決めた目安で、別には測っていない (どの文書でも、領域の数より 1 桁以上少なく、合計への寄与は 1〜2%。処理系で分けない)
 */
const AREA_TREE_BYTES = { area: { node: 340, browser: 200 }, structNode: 200, tag: 8, bookmark: 120, destination: 60 };

/**
 * 領域の木 (組んだ結果) が持つメモリの見積もり (バイト。TypesetResult.memoryUsage の layout)。
 * 領域の数・構造の木の節の数・しおりと飛び先の数に、1 つあたりの大きさ (AREA_TREE_BYTES) を掛けたもの。処理系 (JavaScript のエンジン) によって違う、目安の値
 */
export function estimateAreaTreeBytes(tree: AreaTree): number {
  let areas = 0;
  walkAreaTree(tree, () => {
    areas++;
  });
  let n = areas * AREA_TREE_BYTES.area[memoryRuntime()];
  if (tree.structure) n += tree.structure.nodes.length * AREA_TREE_BYTES.structNode + tree.structure.tags.length * AREA_TREE_BYTES.tag;
  const marks = (list: readonly BookmarkArea[]) => {
    for (const b of list) {
      n += AREA_TREE_BYTES.bookmark + b.title.length * 2 + (b.external?.length ?? 0) * 2;
      marks(b.children);
    }
  };
  marks(tree.bookmarks ?? []);
  for (const k in tree.destinations ?? {}) n += AREA_TREE_BYTES.destination + k.length * 2;
  return n;
}

/**
 * 領域の木の中身を空にする (TypesetResult.dispose)。呼ぶ側が areaTree を持ち続けていても、ページ・構造の木・しおり・飛び先・資源の一覧の
 * メモリを返せるように、木の物は残して中身を外す (ページの数などの数の欄は、結果の側に残る)
 */
export function clearAreaTree(tree: AreaTree): void {
  tree.sheets.length = 0;
  delete tree.structure;
  delete tree.bookmarks;
  delete tree.destinations;
  delete tree.resources;
}

/** Area の種類 (types.ts の AreaType) */
const AREA_TYPES = new Set(['sheet', 'page', 'region-body', 'block', 'line', 'inline', 'glyph', 'table', 'table-row', 'table-cell', 'ruby', 'tate-chu-yoko', 'image']);

/**
 * Area Tree を JSON の文字列にする。共有している物 (凍結した余白の物など) は、JSON では別々の物になる。
 * undefined の欄は書かない (JSON の決まり)
 */
export function serializeAreaTree(tree: AreaTree): string {
  try {
    return JSON.stringify(tree);
  } catch (e) {
    // JSON.stringify は処理系の中で再帰するので、入れ子の深すぎる木ではスタックを使い切る (Node の既定のスタックで、領域の入れ子が
    // 2000 段までは通り、4000 段では切れると測った。組版が作る木は、組版の再帰の限界から、そこまで深くならない)。分かる文の誤りにする
    if (e instanceof RangeError) throw new AreaTreeFormatError(msg('Area Tree の入れ子が深すぎて、JSON にできません', 'the Area Tree is nested too deeply to convert to JSON'));
    throw e;
  }
}

/** 読み直した Area Tree の形の誤り (code は area-tree/format) */
export class AreaTreeFormatError extends KumioriInputError {
  // name は文字で決め打つ (errors.ts の KumioriError を見る)
  override name = 'AreaTreeFormatError';
  constructor(message: string) {
    super('area-tree/format', message);
  }
}

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
    // JSON.parse も処理系の中で再帰する。入れ子の深すぎる JSON でスタックを使い切ったときは、そのことが分かる文にする
    if (e instanceof RangeError) throw new AreaTreeFormatError(msg('Area Tree の入れ子が深すぎて、読めません', 'the Area Tree is nested too deeply to read'));
    throw new AreaTreeFormatError(msg(`JSON として読めません: ${e instanceof Error ? e.message : String(e)}`, `cannot read as JSON: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (!tree || typeof tree !== 'object') throw new AreaTreeFormatError(msg('Area Tree ではありません', 'not an Area Tree'));
  const version = (tree as { schemaVersion?: unknown }).schemaVersion;
  if (version !== AREA_TREE_SCHEMA_VERSION && version !== 1 && version !== 2) throw new AreaTreeFormatError(msg(`版 ${String(version)} は読めません (読めるのは 1〜${AREA_TREE_SCHEMA_VERSION})`, `version ${String(version)} cannot be read (versions 1 to ${AREA_TREE_SCHEMA_VERSION} can)`));
  if (!Array.isArray(tree.sheets)) throw new AreaTreeFormatError(msg('sheets がありません', 'no sheets'));
  if (!Array.isArray(tree.warnings)) tree.warnings = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  // 節の形を確かめる。再帰でなく、明示のスタックでたどる。確かめる順 (深さ優先・前順) は再帰と同じなので、
  // 形の誤りが複数あるときに報告する誤りも同じ
  const check = (root: AreaNode, rootPath: string) => {
    const nodes: AreaNode[] = [root];
    const paths: string[] = [rootPath];
    while (nodes.length) {
      const a = nodes.pop()!;
      const path = paths.pop()!;
      if (!a || typeof a !== 'object' || !AREA_TYPES.has((a as { type?: string }).type ?? '')) throw new AreaTreeFormatError(msg(`${path}: Area の種類が読めません`, `${path}: unknown Area type`));
      for (const k of ['x', 'y', 'width', 'height'] as const) if (!num(a[k])) throw new AreaTreeFormatError(msg(`${path} (${a.type}): ${k} が数ではありません`, `${path} (${a.type}): ${k} is not a number`));
      const kids =
        a.type === 'sheet' ? [a.page] : a.type === 'page' ? [a.regionBody, ...(a.behindAreas ?? []), ...(a.absoluteAreas ?? [])] : a.type === 'ruby' ? [...(a.base ?? []), ...(a.ruby ?? [])] : a.type === 'tate-chu-yoko' ? (a.glyphs ?? []) : a.type === 'glyph' || a.type === 'image' ? [] : (a as { children?: unknown }).children;
      if (!Array.isArray(kids)) throw new AreaTreeFormatError(msg(`${path} (${a.type}): 子の欄がありません`, `${path} (${a.type}): no children field`));
      if (a.type === 'page' && (!Array.isArray(a.behindAreas) || !Array.isArray(a.absoluteAreas))) throw new AreaTreeFormatError(msg(`${path} (page): behindAreas・absoluteAreas がありません`, `${path} (page): no behindAreas or absoluteAreas`));
      if (a.type === 'glyph' && typeof a.text !== 'string') throw new AreaTreeFormatError(msg(`${path} (glyph): text がありません`, `${path} (glyph): no text`));
      if (a.type === 'image' && typeof a.src !== 'string') throw new AreaTreeFormatError(msg(`${path} (image): src がありません`, `${path} (image): no src`));
      for (let k = kids.length - 1; k >= 0; k--) {
        nodes.push(kids[k] as AreaNode);
        paths.push(`${path}/${k}`);
      }
    }
  };
  tree.sheets.forEach((s, k) => {
    if (s?.type !== 'sheet') throw new AreaTreeFormatError(msg(`sheets/${k}: sheet ではありません`, `sheets/${k}: not a sheet`));
    check(s, `sheets/${k}`);
  });
  // 版 1 の木は、版 2 の形に直して返す。版 2 の木は、そのまま今の版の木 (版 3 は欄の値を足しただけ)
  if (version === 1) {
    walkAreaTree(tree, (a) => {
      for (const side of Object.values(a.border ?? {})) upgradeSide(side);
      for (const d of (a as { diagonals?: Array<{ side: unknown }> }).diagonals ?? []) upgradeSide(d.side);
    });
  }
  tree.schemaVersion = AREA_TREE_SCHEMA_VERSION;
  return tree;
}
