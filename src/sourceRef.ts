/**
 * sourceRef — 組版の入力 (LDocument) の節の通し番号。Area の sourceRef は、この番号で元の節を指す。
 *
 * 番号は documentNodes が返す並び (深さ優先・前順。欄の並びは入力の物のまま) の位置。
 * type の欄 (文字列) を持つ物を節とみなし、配列と type の無い物 (ページの指定など) の中もたどる。
 */
import type { LDocument } from './types';

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
