/** scripts/relayout-check-lib.mjs の型 (test/relayoutCheck.test.ts から読むため) */
export interface TextEdit {
  op: 'insert' | 'delete' | 'replace' | 'attr' | 'master' | 'block-insert' | 'block-delete';
  /** 直した所 (文書の文字列の位置) と行の番号 (1 から) */
  at: number;
  line: number;
  removed: string;
  inserted: string;
}
export interface DocVersion {
  text: string;
  edit?: TextEdit;
  label: string;
}
export interface RelayoutDiff {
  tree?: string;
  diagnostics?: string;
  warnings?: string;
  pdf?: string;
}
export interface RelayoutRow {
  index: number;
  label: string;
  edit?: TextEdit;
  pages: number;
  ms: number;
  subjects: Array<{ name: string; ms: number; diff?: RelayoutDiff; stats?: unknown }>;
}
export interface RelayoutLib {
  createTypesetter(setup: object): Promise<{ typeset(text: string, options?: object): Promise<unknown> }>;
  serializeAreaTree(tree: never): string;
}
export function seededRandom(seed: number): () => number;
export function seedOf(...parts: Array<string | number>): number;
export function textRanges(text: string): Array<[number, number]>;
export function editOnce(text: string, rng: () => number): { text: string; edit?: TextEdit };
export function editSequence(text: string, o?: { seed?: number; edits?: number; revert?: boolean; attrRate?: number; masterRate?: number; blockRate?: number }): DocVersion[];
export function editAttr(text: string, rng: () => number): { text: string; edit?: TextEdit };
export function editMaster(text: string, rng: () => number): { text: string; edit?: TextEdit };
export function editBlock(text: string, rng: () => number): { text: string; edit?: TextEdit };
export function describeEdit(e: TextEdit): string;
export function freezeClockAndRandom(at?: string): () => void;
export function checkRelayout(o: {
  lib: RelayoutLib;
  setup?: object;
  options?: object | (() => object);
  versions: DocVersion[];
  subjects?: Array<{ name: string; setup?: object; stats?: (result: never) => unknown; wrap?: (typeset: () => Promise<unknown>) => Promise<unknown> }>;
  reference?: { name: string; setup?: object };
  pdf?: boolean;
  onVersion?: (row: RelayoutRow) => void | Promise<void>;
}): Promise<{ ok: boolean; versions: RelayoutRow[] }>;
export type ProbeSubject = { name: string; stats?: (result: never) => unknown; wrap?: (typeset: () => Promise<unknown>) => Promise<unknown> };
/** resumeProbe は組版の内部の印 (src/layoutEngine.ts の resumeProbe か、ビルドしたものの同じもの) */
export function probeSubjects(resumeProbe: object, o?: { late?: number }): Record<'resume' | 'resume-late' | 'splice-verify', ProbeSubject>;
export function probeFailures(rows: RelayoutRow[]): string[];
