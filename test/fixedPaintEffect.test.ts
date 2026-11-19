/**
 * ページごとに出す内容 (position: fixed の箱・余白の箱) の、描くときだけの効果 (transform・opacity・outline・clip)。
 * CSS 2.1 §9.6.1: 固定配置の箱は、ページの媒体ではどのページにも繰り返して出す。効果も、出すページごとに同じに付ける
 * (CSS Transforms 1 §3・CSS Color 4 §3.3・CSS UI 4 §3・CSS 2.1 §11.1.2)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, SheetArea } from '../src/types';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 100mm 100mm; margin: 10mm } body { margin: 0; font-size: 10pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont });
const areasOf = (s: SheetArea, pred: (a: Area) => boolean): Area[] => {
  const out: Area[] = [];
  walkAreaTree({ schemaVersion: 1, sheets: [s], warnings: [] }, (a) => {
    if (a.type !== 'sheet' && pred(a as Area)) out.push(a as Area);
  });
  return out;
};

describe('position: fixed の箱の効果', () => {
  it('transform・opacity・outline を、どのページの箱にも付ける', async () => {
    const r = await set(page('<p>a</p><p style="break-before: page">b</p><div style="position: fixed; left: 5mm; top: 5mm; width: 20mm; height: 10mm; background: #99ccff; opacity: .5; transform: rotate(10deg); outline: 2pt solid red">f</div>'));
    expect((r.warnings ?? []).join('\n')).not.toMatch(/outline|transform|opacity/);
    expect(r.areaTree.sheets.length).toBe(2);
    for (const s of r.areaTree.sheets) {
      const [box] = areasOf(s, (a) => (a as { backgroundColor?: string }).backgroundColor === '#99ccff');
      expect(box).toBeDefined();
      expect(box.outline?.color).toBe('red');
      expect(box.outline?.width).toBeCloseTo(2, 3);
      expect(areasOf(s, (a) => a.opacity === 0.5).length).toBe(1);
      expect(areasOf(s, (a) => !!a.transform).length).toBe(1);
    }
  });
});
