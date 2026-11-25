/** scripts/pdf-checks-lib.mjs の型 (test/pdfChecks.test.ts から読むため) */
export interface PdfMode {
  options: Record<string, unknown>;
  pdf(ctx: { profile: Uint8Array }): Record<string, unknown>;
  verapdf: string[];
  tagged: boolean;
}
export const MODES: Record<'pdfua' | 'pdfa-2b' | 'pdfa-3b-ua' | 'pdfx-4' | 'pdfx-1a', PdfMode>;
export const GROUP_MODES: Record<string, Array<keyof typeof MODES>>;
export function pdfFileName(id: string, mode: string): string;
export function baselineKey(id: string, mode: string, flavour: string): string;
export interface Tools {
  qpdf: boolean;
  pdfinfo: boolean;
  pdffonts: boolean;
  pdftotext: boolean;
}
export function toolsAvailable(): Tools;
export function checkStructure(file: string, expect?: { tagged?: boolean }, tools?: Tools): { problems: string[]; pages?: number; skipped: string[] };
export interface Baseline {
  description?: string;
  veraPDF?: string;
  rules: Record<string, string[]>;
}
export function readBaseline(file: string): Baseline;
export function compareRules(baseline: Baseline, key: string, rules: ReadonlyArray<{ clause: string; test: string }>): { failed: string[]; added: string[]; removed: string[] };
export function ruleOrder(a: string, b: string): number;
