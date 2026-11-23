/**
 * 測る組み (行内の箱・脚注の本体の中) に置いた overflow="condense" の fo:block-container の警告 (layout/condense-overflow・
 * layout/condense-height-unknown) も、ほかの所と同じく 1 件ずつ出す (前は、測る組みでは出さなかった)。
 * 結果を捨てる試しの組み (keep-together の高さを測る組み・fo:inline-container の中身の幅で組み直す組み) では出さないので、
 * どこに置いても 1 件 (test/measureWarnings.test.ts の画像の警告と同じ)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, type FontSpec, type TypesetResult } from '../src/index';
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

const fo = (body: string) =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
const lines = (n: number) => Array.from({ length: n }, (_, k) => `<fo:block>Line ${k + 1}</fo:block>`).join('');
/** 詰めても収まらない容器 (高さ 4pt に 60 行) と、高さの決まらない容器 */
const boxes = `<fo:block-container height="4pt" overflow="condense">${lines(60)}</fo:block-container><fo:block-container overflow="condense"><fo:block>u</fo:block></fo:block-container>`;
const condense = (r: TypesetResult) => r.diagnostics.filter((d) => /^layout\/condense-/.test(d.code)).map((d) => [d.code, d.count ?? 1]);
const once = [
  ['layout/condense-overflow', 1],
  ['layout/condense-height-unknown', 1],
];

describe('測る組みの中の condense の容器の警告は、1 件ずつ', () => {
  const cases: Array<[string, string]> = [
    ['本文の中 (前から出していた所)', `<fo:block>${boxes}</fo:block>`],
    ['fo:inline-container の中 (中身の幅で組み直す)', `<fo:block>a<fo:inline-container><fo:block>${boxes}</fo:block></fo:inline-container></fo:block>`],
    ['幅を書いた fo:inline-container の中', `<fo:block>a<fo:inline-container inline-progression-dimension="40mm"><fo:block>${boxes}</fo:block></fo:inline-container></fo:block>`],
    ['fo:footnote-body の中', `<fo:block>a<fo:footnote><fo:inline>1</fo:inline><fo:footnote-body><fo:block>${boxes}</fo:block></fo:footnote-body></fo:footnote></fo:block>`],
    ['keep-together の中 (試しの組みでは出さない)', `<fo:block keep-together.within-page="always">${boxes}</fo:block>`],
  ];
  for (const [name, body] of cases)
    it(name, async () => {
      expect(condense(await typesetFo(fo(body), { loadFont, compat: 'antenna' }))).toEqual(once);
    });
});
