/** scripts/intended-changes.mjs の型 (test/intendedChanges.test.ts から読むため) */
export const INTENDED_PATH: string;
export interface IntendedChanges {
  changes: Array<{ commit: string; docs: Array<{ doc: string; pages?: Array<number | string> }> }>;
}
export function parseIntended(text: string, where?: string): IntendedChanges;
export function checkIntended(
  intended: IntendedChanges,
  results: Array<{ id: string; group?: string; status: string; pages?: { base: number; head: number }; changedPages?: Array<{ page: number }>; error?: { base?: string; head?: string } }>,
): { unlisted: Array<{ id: string; group?: string; status: string; why: string }>; unused: Array<{ commit: string; doc: string }> };
export function findBase(root: string, rev?: string, o?: { worktree?: boolean; file?: string }): string | undefined;
export function readIntended(root: string, rev: string, file?: string): IntendedChanges;
