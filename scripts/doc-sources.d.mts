/** scripts/doc-sources.mjs の型 (test/pdfChecks.test.ts から読むため) */
export interface DocSource {
  id: string;
  load(): Promise<{ text: string; setup?: Record<string, unknown>; options: Record<string, unknown> | (() => Record<string, unknown>) }>;
}
export function listDocs(o: { groups: readonly string[]; filter?: string; samples: string; weasyprint: string; fontDir: string }): {
  docs: DocSource[];
  skipped: Array<{ group: string; reason: string }>;
};
