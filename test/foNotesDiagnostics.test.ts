/**
 * XSL-FO の読み込みの知らせ (近似や既定値で代用したこと) を、画面の変換レポートだけでなく、組版の結果の診断にも出す。
 *  - fo/note (警告): 知らせの文ごとに 1 件
 *  - fo/master-reference-not-found (誤り): master-reference に当たるページのマスターが無いので、その page-sequence を組まなかった
 *    (XSL 1.1 §6.4.5。前は 0 ページで、何も知らせなかった)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, type FontSpec } from '../src/index';
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

const fo = (seq: string, decl = '') => `<?xml version="1.0"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions">
${decl}<fo:layout-master-set><fo:simple-page-master master-name="A"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
${seq}
</fo:root>`;

describe('XSL-FO の読み込みの知らせの診断', () => {
  it('master-reference の無い名前は誤り (名前と場所を出す)', async () => {
    const r = await typesetFo(fo('<fo:page-sequence master-reference="B"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence>'), { name: 'm.fo', loadFont });
    const d = r.diagnostics.filter((x) => x.code === 'fo/master-reference-not-found');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', args: { name: 'B' }, source: { file: 'm.fo', line: 4, element: 'fo:page-sequence' } });
    expect(r.warnings.some((w) => /master-reference "B"/.test(w))).toBe(true);
    // 当たる page-sequence が 1 つも無いので、page-sequence が無いという知らせも出す
    expect(r.diagnostics.filter((x) => x.code === 'fo/note').map((x) => x.message)).toEqual([expect.stringMatching(/page-sequence/)]);
  });
  it('ほかの知らせは fo/note (警告)。同じ文は 1 件', async () => {
    const seq = '<fo:page-sequence master-reference="A"><fo:flow flow-name="nowhere"><fo:block>x</fo:block></fo:flow></fo:page-sequence>';
    const r = await typesetFo(fo(seq + seq, '<axf:document-info name="title" value="T"/>'), { name: 'n.fo', loadFont });
    const notes = r.diagnostics.filter((x) => x.code === 'fo/note');
    expect(notes.map((x) => x.severity)).toEqual(['warning', 'warning']);
    expect(notes.map((x) => x.message)).toEqual([expect.stringMatching(/document-title/), expect.stringMatching(/nowhere/)]);
    expect(r.diagnostics.some((x) => x.code === 'fo/master-reference-not-found')).toBe(false);
  });
  it('知らせの無い文書には出さない。ignore で出さない', async () => {
    const ok = await typesetFo(fo('<fo:page-sequence master-reference="A"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence>'), { loadFont });
    expect(ok.diagnostics.filter((x) => x.code.startsWith('fo/'))).toEqual([]);
    const ig = await typesetFo(fo('<fo:page-sequence master-reference="B"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence>'), { loadFont, diagnostics: { ignore: ['fo/master-reference-not-found', 'fo/note'] } });
    expect(ig.diagnostics.filter((x) => x.code === 'fo/note' || x.code === 'fo/master-reference-not-found')).toEqual([]);
  });
});
