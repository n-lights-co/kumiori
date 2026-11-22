/** scripts/sampleTar.mjs の型 (test/sampleTar.test.ts から読むため) */
export interface TarEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
}
export function badEntryName(name: string): string | null;
export function readTarEntries(buf: Uint8Array): { name: string; type: string; size: number }[];
export function checkTar(buf: Uint8Array): TarEntry[];
export function unpackTar(buf: Uint8Array, dir: string): TarEntry[];
export function packTar(dir: string, names: string[]): Buffer;
