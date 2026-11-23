/**
 * PDF の画像を、組んだ PDF に Form XObject として埋め込む (design/pdf-as-image.md の 2 節):
 * 箱を BBox にした Form、回転の行列、持ち込まないもの (注釈と、注釈から届く元の文書のページ)、MCID を外すこと、
 * 同じページは 1 つの Form、埋め込んでいない書体の知らせ、画面・SVG・PNG の仮の枠。試験の PDF は pdf-lib で作る (pdfImageFixtures.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { DEFAULT_FONTS, typeset, typesetToPdf } from '../src/index';
import { pdfImageMatrix, withoutMcids } from '../src/pdfImageEmbed';
import { ensureFonts, loadCachedFont, pageOps } from './helpers';
import { makePdf } from './pdfImageFixtures';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
const loadFont = loadCachedFont;
const html = (body: string) => `<!doctype html><html lang="ja"><head><title>t</title></head><body><p>${body}</p></body></html>`;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** 出力の PDF の、ページの資源の Form XObject (名前 KmP…) */
function forms(pdf: PDFDocument, page = 0): PDFRawStream[] {
  const res = pdf.getPage(page).node.Resources();
  const xo = res?.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) return [];
  return xo
    .entries()
    .filter(([k]) => k.asString().startsWith('/KmP'))
    .map(([, v]) => pdf.context.lookup(v as PDFRef) as PDFRawStream);
}

describe('pdfImageMatrix', () => {
  const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  it('箱の左下を原点に寄せ、時計回りに回し、枠に伸ばす (ISO 32000-1 Table 30 の Rotate)', () => {
    const box: [number, number, number, number] = [10, 20, 110, 70]; // 100 × 50
    // 回さない: 箱の左下 → 枠の左下、右上 → 枠の右上 (枠は 200 × 100 を (5, 5) に)
    expect(apply(pdfImageMatrix(box, 0, 5, 5, 200, 100), 10, 20)).toEqual([5, 5]);
    expect(apply(pdfImageMatrix(box, 0, 5, 5, 200, 100), 110, 70)).toEqual([205, 105]);
    // 90 度: 回した後は 50 × 100。元の左下は、回した後の左上 (0, 100) に、元の左上は右上に
    const m90 = pdfImageMatrix(box, 90, 0, 0, 50, 100);
    expect(apply(m90, 10, 20)).toEqual([0, 100]);
    expect(apply(m90, 10, 70)).toEqual([50, 100]);
    const m270 = pdfImageMatrix(box, 270, 0, 0, 50, 100);
    expect(apply(m270, 10, 20)).toEqual([50, 0]);
    const m180 = pdfImageMatrix(box, 180, 0, 0, 100, 50);
    expect(apply(m180, 10, 20)).toEqual([100, 50]);
  });
});

describe('withoutMcids', () => {
  it('MCID を持つ BDC を BMC にし、ほかは変えない (文字列・内容の流れの中の画像の中は読まない)', () => {
    const src = '/P <</MCID 0>> BDC (a BDC) Tj EMC /Span <</ActualText (x)>> BDC EMC BI /W 1 /H 1 /BPC 8 /CS /G ID \x00/P <</MCID 9>> BDC EI /P /mc1 BDC EMC';
    expect(dec(withoutMcids(enc(src), undefined))).toBe('/P BMC (a BDC) Tj EMC /Span <</ActualText (x)>> BDC EMC BI /W 1 /H 1 /BPC 8 /CS /G ID \x00/P <</MCID 9>> BDC EI /P /mc1 BDC EMC');
    const none = enc('0 0 m 1 1 l S');
    expect(withoutMcids(none, undefined)).toBe(none);
  });
});

describe('PDF の出力に埋め込む', () => {
  it('ページを Form XObject にする (BBox は箱、Do で置く)。注釈と、注釈が指す別のページは持ち込まない', async () => {
    const src = await makePdf([{ media: [0, 0, 200, 100], crop: [0, 0, 150, 100], linkToPage: 1 }, { media: [0, 0, 300, 300], text: 'page two' }]);
    const r = await typesetToPdf(html('<img src="a.pdf">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    expect(r.diagnostics.map((d) => d.code).filter((c) => c.startsWith('image/'))).toEqual(['image/pdf-dropped']);
    const out = await PDFDocument.load(r.pdf);
    expect(out.getPageCount()).toBe(1);
    const fs = forms(out);
    expect(fs).toHaveLength(1);
    expect(fs[0].dict.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Form'));
    expect((fs[0].dict.lookup(PDFName.of('BBox')) as PDFArray).asArray().map(String)).toEqual(['0', '0', '150', '100']);
    expect(pageOps(out)).toMatch(/\/KmP[-\d]* Do/);
    // 元の 2 ページ目 (注釈の行き先) の字の書体 Helvetica は、写っていない
    expect(dec(r.pdf)).not.toMatch(/Helvetica/);
    expect(out.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
  it('同じページを 2 度貼ると 1 つの Form。違うページは別の Form。透明のグループを写し、MCID を外す', async () => {
    const src = await makePdf([{ group: true, mcid: true }, { color: [0, 0, 1] }]);
    const r = await typesetToPdf(html('<img src="a.pdf"><img src="a.pdf"><img src="a.pdf#page=2">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    const out = await PDFDocument.load(r.pdf);
    const fs = forms(out);
    expect(fs).toHaveLength(2);
    expect(pageOps(out).match(/\/KmP[-\d]* Do/g)).toHaveLength(3);
    const first = fs.find((f) => f.dict.get(PDFName.of('Group')));
    expect(first).toBeDefined();
    expect(dec(decodePDFRawStream(first!).decode())).not.toMatch(/MCID/);
  });
  it('埋め込んでいない書体は image/pdf-font (書体の名前)', async () => {
    const src = await makePdf([{ text: 'Hello' }]);
    const r = await typesetToPdf(html('<img src="a.pdf">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    const d = r.diagnostics.filter((x) => x.code === 'image/pdf-font');
    expect(d.map((x) => x.args)).toEqual([{ src: 'a.pdf', font: 'Helvetica' }]);
  });
  it('回したページは、回した大きさで組み、回す行列で置く', async () => {
    const src = await makePdf([{ media: [0, 0, 200, 100], rotate: 90 }]);
    const r = await typesetToPdf(html('<img src="a.pdf">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    const ops = pageOps(await PDFDocument.load(r.pdf));
    // 90 度の回転の行列 (a = 0, b < 0, c > 0, d = 0)
    expect(ops).toMatch(/\n0 -[\d.]+ [\d.]+ 0 [-\d.]+ [-\d.]+ cm\n\/KmP[-\d]* Do/);
  });
  it('同じ入力から同じバイトの PDF', async () => {
    const src = await makePdf([{ text: 'x' }, {}]);
    const o = { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont };
    // 日付を固定する (渡さなければ書き出す時刻になり、秒の境をまたぐと作成日が違う。PdfOptions.date)
    const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    const a = await typesetToPdf(html('<img src="a.pdf"><img src="a.pdf#page=2">'), o, { date });
    const b = await typesetToPdf(html('<img src="a.pdf"><img src="a.pdf#page=2">'), o, { date });
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);
  });
});

describe('画面・SVG・PNG は仮の枠', () => {
  it('SVG と PNG の書き出しで、PDF の画像を仮の枠で描く', async () => {
    const src = await makePdf([{ color: [0, 0, 1] }]);
    const r = await typeset(html('<img src="a.pdf">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    const svg = await r.renderPageToSvg(0);
    // 仮の枠の地の色 (paint.ts の paintPlaceholder)
    expect(svg.toLowerCase()).toMatch(/#f0f0f0|rgb\(240,\s*240,\s*240\)/);
    const png = await r.renderPageToPng(0);
    expect(png.length).toBeGreaterThan(100);
    // 描いた出力ごとに 1 度、image/pdf-placeholder (PDF だけを作るときは出さない)
    expect(r.diagnostics.filter((d) => d.code === 'image/pdf-placeholder').map((d) => d.args)).toEqual([
      { src: 'a.pdf', output: 'SVG' },
      { src: 'a.pdf', output: 'PNG' },
    ]);
    const only = await typesetToPdf(html('<img src="a.pdf">'), { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    expect(only.diagnostics.map((d) => d.code)).not.toContain('image/pdf-placeholder');
  });
});
