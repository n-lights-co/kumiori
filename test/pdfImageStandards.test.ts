/**
 * PDF の画像の、埋め込む前の検査 (design/pdf-as-image.md の 2.4 節): PDF/X・PDF/A では、そのページだけを描いた PDF を同じ検査にかけ、
 * 合わなければ埋め込まずに仮の枠と警告 (pdfx/embedded-pdf・pdfa/embedded-pdf)。文書は出せる。PDF/UA-1 では、埋め込んでいない書体のあるページを断る
 * (pdfua/embedded-pdf)。試験の PDF は pdf-lib で作る (pdfImageFixtures.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { DEFAULT_FONTS, typeset, typesetToPdf } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { makePdf } from './pdfImageFixtures';
import { testIccProfile } from './iccTestProfile';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
const loadFont = loadCachedFont;
const html = '<!doctype html><html lang="ja"><head><title>t</title></head><body><p><img src="a.pdf" alt="図"></p></body></html>';

/** 試験の CMYK の出力機器のプロファイル (iccTestProfile.ts。頭・タグの表・desc まで ICC.1:2010 の形どおり) の色空間を space にしたもの */
function iccHeader(space: string): Uint8Array {
  return testIccProfile({ colorSpace: space });
}

/** 出力の 1 ページ目に、PDF の画像の Form (KmP…) があるか */
async function embedded(bytes: Uint8Array): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes);
  const xo = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
  return xo instanceof PDFDict && xo.keys().some((k) => k.asString().startsWith('/KmP'));
}
const codes = (ds: ReadonlyArray<{ code: string }>) => ds.map((d) => d.code).filter((c) => /embedded-pdf/.test(c));

describe('PDF/X-4', () => {
  it('DeviceRGB のページは埋め込まずに pdfx/embedded-pdf (文書は出せる)。CMYK のページは埋め込む', async () => {
    for (const [cmyk, ok] of [
      [false, false],
      [true, true],
    ] as const) {
      const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: await makePdf([{ cmyk }]) }], loadFont });
      const warnings: string[] = [];
      const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('CMYK'), warnings } });
      expect(await embedded(bytes), `cmyk=${cmyk}`).toBe(ok);
      expect(codes(r.diagnostics)).toEqual(ok ? [] : ['pdfx/embedded-pdf']);
      if (!ok) {
        const d = r.diagnostics.find((x) => x.code === 'pdfx/embedded-pdf')!;
        expect(d.args).toMatchObject({ src: 'a.pdf' });
        expect(String(d.args?.detail)).toMatch(/rg|DeviceRGB/);
      }
    }
  });
});

describe('ページの範囲 (互換の指定) と埋め込む前の検査', () => {
  it('範囲の途中のページが断られたら、範囲の全体を仮の枠にし、先のページの Form も PDF に残さない', async () => {
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="400pt" page-height="300pt" margin="10pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:external-graphic src="a.pdf#page=1-2" content-height="50pt"/></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typeset(fo, { kind: 'fo', compat: 'antenna', files: [{ name: 'a.pdf', data: await makePdf([{ cmyk: true }, { cmyk: false }]) }], loadFont });
    const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('CMYK'), warnings: [] } });
    expect(codes(r.diagnostics)).toEqual(['pdfx/embedded-pdf']);
    const pdf = await PDFDocument.load(bytes);
    const forms = pdf.context
      .enumerateIndirectObjects()
      .filter(([, o]) => 'dict' in o && (o as { dict: PDFDict }).dict.get(PDFName.of('Subtype')) === PDFName.of('Form'));
    expect(forms).toHaveLength(0);
  });
  it('範囲で分け合った予算で落ちたページも、後で 1 ページだけ貼るときは、そのページの予算で埋め込む (落ちた誤りを覚えない)', async () => {
    // 1 ページの中身の流れは pdfImageStreamBytes (8,000) に収まり、2 ページを合わせると収まらない
    const pdf = await makePdf([{ text: 'x'.repeat(3000) }, { text: 'y'.repeat(3000) }]);
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="400pt" page-height="300pt" margin="10pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:external-graphic src="a.pdf#page=1-2" content-height="50pt"/><fo:external-graphic src="a.pdf#page=2" content-height="50pt"/></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typeset(fo, { kind: 'fo', compat: 'antenna', files: [{ name: 'a.pdf', data: pdf }], loadFont, limits: { pdfImageStreamBytes: 8000 } });
    const out = await PDFDocument.load(await r.toPdf());
    // 範囲だけが仮の枠 (前は、範囲で落ちた 2 ページ目の誤りを覚えて、後ろの 1 ページも仮の枠にした)
    expect(r.diagnostics.filter((d) => d.code === 'image/pdf-invalid').map((d) => d.args?.src)).toEqual(['a.pdf#page=1-2']);
    expect(await embedded(await r.toPdf())).toBe(true);
    const forms = out.context.enumerateIndirectObjects().filter(([, o]) => 'dict' in o && (o as { dict: PDFDict }).dict.get(PDFName.of('Subtype')) === PDFName.of('Form'));
    expect(forms).toHaveLength(1);
  });
});

describe('PDF/X-3 (透明を平らにする出力)', () => {
  it('PDF の画像は貼らずに pdfx/embedded-pdf (PDF/X-4 を勧める)', async () => {
    const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: await makePdf([{ cmyk: true }]) }], loadFont });
    const bytes = await r.toPdf({ pdfx: { version: 'X-3', condition: 'FOGRA39', warnings: [] } });
    expect(await embedded(bytes)).toBe(false);
    expect(codes(r.diagnostics)).toEqual(['pdfx/embedded-pdf']);
    expect(String(r.diagnostics.find((d) => d.code === 'pdfx/embedded-pdf')!.args?.detail)).toMatch(/PDF\/X-4/);
  });
});

describe('PDF/A-2b', () => {
  it('出力意図が sRGB なら、RGB のページは埋め込み、CMYK のページと埋め込んでいない書体のページは pdfa/embedded-pdf', async () => {
    for (const [page, ok] of [
      [{}, true],
      [{ cmyk: true }, false],
      [{ text: 'Hello' }, false],
    ] as const) {
      const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: await makePdf([page]) }], loadFont });
      const bytes = await r.toPdf({ pdfa: { version: 'A-2b', warnings: [] } });
      expect(await embedded(bytes), JSON.stringify(page)).toBe(ok);
      expect(codes(r.diagnostics)).toEqual(ok ? [] : ['pdfa/embedded-pdf']);
    }
  });
});

describe('PDF/UA-1', () => {
  it('埋め込んでいない書体のあるページは pdfua/embedded-pdf (書体の名前を detail に)。無ければ埋め込む', async () => {
    const bad = await typesetToPdf(html, { name: 'd.html', files: [{ name: 'a.pdf', data: await makePdf([{ text: 'Hello' }]) }], loadFont, pdfua: true });
    expect(await embedded(bad.pdf)).toBe(false);
    const d = bad.diagnostics.filter((x) => x.code === 'pdfua/embedded-pdf');
    expect(d).toHaveLength(1);
    expect(String(d[0].args?.detail)).toMatch(/Helvetica/);
    const good = await typesetToPdf(html, { name: 'd.html', files: [{ name: 'a.pdf', data: await makePdf([{}]) }], loadFont, pdfua: true });
    expect(await embedded(good.pdf)).toBe(true);
    expect(codes(good.diagnostics)).toEqual([]);
  });
});
