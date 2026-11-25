/** scripts/verapdf-lib.mjs の型 (test/pdfChecks.test.ts から読むため) */
export const VERSION: string;
export const JARS: ReadonlyArray<readonly [string, string, string, string]>;
export function fetchJars(dir: string, log?: (m: string) => void): Promise<void>;
export function jarDir(dir: string): string;
export function verapdfReady(dir: string): boolean;
export interface VerapdfRule {
  clause: string;
  test: string;
  failed: number;
  description: string;
}
export function runVerapdf(dir: string, flavour: string, files: readonly string[]): Array<{ name: string; compliant?: boolean; rules: VerapdfRule[]; error?: string }>;
