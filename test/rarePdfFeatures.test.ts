/**
 * まれな PDF の機能 (I-04): axf:box-shadow のぼかし・広がり、添付ファイルの注釈 (FileAttachment と埋め込みファイル)、
 * プッシュボタンの指を乗せた時 (R)・押した時 (D) の見た目
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf } from '../src/pdfRenderer';
import { AssetStore } from '../src/assets';
import { makeEngine } from './helpers';
import type { LBlock } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const doc = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const pdfOf = async (body: string, assets?: AssetStore) => {
  const r = importXslFo(doc(body), parse, {});
  const tree = E.engine.layout(r.document);
  return { r, pdf: await PDFDocument.load(await renderPdf(tree, E.fonts, assets ? { assets } : {})) };
};
const annots = (pdf: PDFDocument) => {
  const a = pdf.getPages()[0].node.lookup(PDFName.of('Annots'));
  return a instanceof PDFArray ? a.asArray().map((x) => pdf.context.lookup(x as PDFRef) as PDFDict) : [];
};

describe('まれな PDF の機能 (I-04)', () => {
  it('axf:box-shadow の 3 つ目の長さはぼかし、4 つ目は広がり (CSS の box-shadow と同じ並び)', () => {
    const r = importXslFo(doc('<fo:block axf:box-shadow="2pt 3pt 4pt 1pt #ff0000">a</fo:block>'), parse, {});
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.boxShadow).toEqual({ dx: 2, dy: 3, blur: 4, spread: 1, color: '#ff0000' });
  });

  it('添付ファイルの注釈: FS の埋め込みファイルにファイルの中身を入れる (ISO 32000-2 §12.5.6.15・§7.11.4)', async () => {
    const assets = new AssetStore();
    assets.registerFile('data/note.txt', new TextEncoder().encode('添付の中身'));
    const { r, pdf } = await pdfOf('<fo:block axf:annotation-type="FileAttachment" axf:annotation-file-attachment="url(data/note.txt)" axf:annotation-file-name="メモ.txt" axf:annotation-icon-name="Paperclip">a</fo:block>', assets);
    expect(r.report.files).toEqual(['data/note.txt']);
    const [an] = annots(pdf);
    expect(String(an.get(PDFName.of('Subtype')))).toBe('/FileAttachment');
    expect(String(an.get(PDFName.of('Name')))).toBe('/Paperclip');
    const fs = an.lookup(PDFName.of('FS')) as PDFDict;
    expect((fs.lookup(PDFName.of('UF')) as PDFHexString).decodeText()).toBe('メモ.txt');
    const ef = (fs.lookup(PDFName.of('EF')) as PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
    expect(String(ef.dict.get(PDFName.of('Type')))).toBe('/EmbeddedFile');
    expect(new TextDecoder().decode(decodePDFRawStream(ef).decode())).toBe('添付の中身');
  });

  it('data: の URI の添付ファイルも埋め込む。ファイルが無ければテキスト注釈にする', async () => {
    const data = `data:text/plain;base64,${Buffer.from('abc').toString('base64')}`;
    const { pdf } = await pdfOf(`<fo:block axf:annotation-type="FileAttachment" axf:annotation-file-attachment="${data}" axf:annotation-file-name="a.txt">a</fo:block>`);
    const fs = annots(pdf)[0].lookup(PDFName.of('FS')) as PDFDict;
    const ef = (fs.lookup(PDFName.of('EF')) as PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
    expect(new TextDecoder().decode(decodePDFRawStream(ef).decode())).toBe('abc');
    const missing = await pdfOf('<fo:block axf:annotation-type="FileAttachment" axf:annotation-file-attachment="none.txt">a</fo:block>', new AssetStore());
    expect(String(annots(missing.pdf)[0].get(PDFName.of('Subtype')))).toBe('/Text');
  });

  it('プッシュボタン: 外観の辞書に N・R・D を持ち、押した時の効果は P (ISO 32000-2 §12.5.5)', async () => {
    const { pdf } = await pdfOf('<fo:block><axf:form-field axf:field-name="ok" axf:field-type="button" axf:field-button-face="OK"/></fo:block>');
    const w = annots(pdf).find((a) => String(a.get(PDFName.of('Subtype'))) === '/Widget')!;
    const ap = w.lookup(PDFName.of('AP')) as PDFDict;
    expect(['N', 'R', 'D'].every((k) => ap.get(PDFName.of(k)) instanceof PDFRef)).toBe(true);
    expect(String(w.get(PDFName.of('H')))).toBe('/P');
    const d = pdf.context.lookup(ap.get(PDFName.of('D')) as PDFRef) as PDFRawStream;
    expect(new TextDecoder().decode(decodePDFRawStream(d).decode())).toMatch(/0\.78 g[\s\S]*\/N0 Do/);
  });
});
