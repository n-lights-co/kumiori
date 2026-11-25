/**
 * メモリの見積もり (TypesetResult.memoryUsage・Typesetter.memoryUsage) の係数を選ぶ処理系の見分け。
 * JS の物の大きさは処理系で違う (V8 のポインタの圧縮: Node は使わず、Chromium は使う) ので、係数は処理系ごとに測った値を持つ
 * (src/areaTree.ts の AREA_TREE_BYTES・src/fontManager.ts の FONT_BYTES_PER_GLYPH・src/layoutEngine.ts の REUSE_BYTES)。
 *  - node: process.versions.node がある処理系 (Node。process.versions.node を持つ Deno・Bun も、この側になる)。Node 22 で測った係数
 *  - browser: それ以外 (ブラウザ・Web Worker)。Chromium 158 の Web Worker で測った係数。Firefox・Safari は測っていないが、この係数を使う
 */
export type MemoryRuntime = 'node' | 'browser';

let forced: MemoryRuntime | undefined;

/** いまの処理系 (係数の選び) */
export function memoryRuntime(): MemoryRuntime {
  if (forced) return forced;
  const p = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
  return typeof p?.versions?.node === 'string' ? 'node' : 'browser';
}

/** 試験だけで使う: 処理系の見分けを差し替える (undefined で元に戻す) */
export function __setMemoryRuntimeForTest(r: MemoryRuntime | undefined): void {
  forced = r;
}
