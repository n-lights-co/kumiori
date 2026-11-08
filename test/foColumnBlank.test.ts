/**
 * 段組の page-sequence でも、偶奇合わせで挟む白ページには、白ページの条件 (blank-or-not-blank="blank") のマスターを選ぶ (XSL 1.1 §6.4.12)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const doc = (cols: number, flow: string) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="blank" page-width="100mm" page-height="100mm" margin="30mm"><fo:region-body/></fo:simple-page-master>` +
  `<fo:simple-page-master master-name="main" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body column-count="${cols}"/></fo:simple-page-master>` +
  `<fo:page-sequence-master master-name="seq"><fo:repeatable-page-master-alternatives>` +
  `<fo:conditional-page-master-reference master-reference="blank" blank-or-not-blank="blank"/>` +
  `<fo:conditional-page-master-reference master-reference="main"/>` +
  `</fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="seq"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;

describe('段組の page-sequence の白ページ (S-12)', () => {
  const margins = (cols: number) => {
    const t = E.engine.layout(importXslFo(doc(cols, '<fo:block>一</fo:block><fo:block break-before="odd-page">三</fo:block>'), parse, { compat: 'spec' }).document);
    // 本文領域の左端 (pt) を mm にする: 白ページのマスターは 30mm、本文のマスターは 10mm
    return t.sheets.map((s) => Math.round(((s as unknown as { page: { regionBody: { x: number } } }).page.regionBody.x * 25.4) / 72));
  };
  it('1 段でも 2 段でも、偶奇合わせで挟んだ 2 ページ目は白ページのマスター (余白 30mm)', () => {
    expect(margins(1)).toEqual([10, 30, 10]);
    expect(margins(2)).toEqual([10, 30, 10]);
  });
});
