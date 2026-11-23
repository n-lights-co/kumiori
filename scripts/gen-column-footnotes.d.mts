/** scripts/gen-column-footnotes.mjs の型 (test/columnFootnoteReserve.test.ts から読むため) */
export type Notes = Record<number, number>;
export function random(seed: number): () => number;
export function randomNotes(lines: number, p: number, rnd: number | (() => number)): Notes;
export const footnoteItem: (n: number, j: number) => string;
export function columnHtml(lines: number, notes: Notes, cols?: number): string;
export function columnFo(lines: number, notes: Notes, cols?: number): string;
export function overfullHtml(): { text: string; lines: number; notes: Notes };
export function standardSet(): Array<{ name: string; text: string; lines: number; notes: Notes }>;
