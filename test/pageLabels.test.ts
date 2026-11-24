/**
 * PDF のページラベル (/PageLabels。ISO 32000-1 §12.4.2): 組版のページ番号の数と書式から、範囲を作って書くこと。
 * 範囲を作る関数 (pageLabelRanges) の単体の試験と、XSL-FO・HTML を組んだ PDF を pdf-lib で読み直す試験
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { DEFAULT_FONTS, typesetFo, typesetHtml } from '../src/index';
import { pageLabelRanges } from '../src/pdfPageLabels';
import { withGrouping } from '../src/pageNumber';
import { ensureFonts, loadCachedFont } from './helpers';

const pages = (list: Array<[number, string?]>) => list.map(([number, format]) => ({ number, ...(format ? { format } : {}) }));

describe('pageLabelRanges (ページの番号と書式 → ページラベルの範囲)', () => {
  it('1 からの 10 進の通しは書かない (ビューアの既定と同じ)。ページが無いときも', () => {
    expect(pageLabelRanges(pages([[1], [2], [3]]))).toBeUndefined();
    expect(pageLabelRanges(pages([[1, '1'], [2, '- 1 -']]))).toBeUndefined();
    expect(pageLabelRanges([])).toBeUndefined();
  });
  it('前付けの i〜iii と本文の 1〜: 2 つの範囲', () => {
    expect(pageLabelRanges(pages([[1, 'i'], [2, 'i'], [3, 'i'], [1], [2]]))).toEqual([
      { start: 0, style: 'r' },
      { start: 3, style: 'D' },
    ]);
  });
  it('番号の振り直しと、1 で始まらない番号は St に書く。書式が同じで番号が続けば、page-sequence が変わっても 1 つの範囲', () => {
    expect(pageLabelRanges(pages([[5], [6], [1], [2], [3]]))).toEqual([
      { start: 0, style: 'D', first: 5 },
      { start: 2, style: 'D' },
    ]);
    expect(pageLabelRanges(pages([[1, 'I'], [2, 'I'], [3, 'I']]))).toEqual([{ start: 0, style: 'R' }]);
  });
  it('英字は、PDF (27 から AA・BB …) と書式 (aa・ab …) の字が同じ所まで A・a。違う所 (28 の ab など) は、ページごとに紙面の字を P に書く', () => {
    const r = pageLabelRanges(pages(Array.from({ length: 29 }, (_, i) => [i + 1, 'a'] as [number, string])))!;
    expect(r).toEqual([
      { start: 0, style: 'a' },
      { start: 27, prefix: 'ab' },
      { start: 28, prefix: 'ac' },
    ]);
  });
  it('PDF の書式に無い書式 (漢数字・丸数字・全角・0 埋め・ローマ数字の字) と、0 以下・4000 以上のローマ数字は、ページごとに紙面の字を P に書く', () => {
    expect(pageLabelRanges(pages([[1, '一'], [2, '一'], [12, '①'], [3, '１'], [4, '01'], [5, 'Ⅰ']]))).toEqual([
      { start: 0, prefix: '一' },
      { start: 1, prefix: '二' },
      { start: 2, prefix: '⑫' },
      { start: 3, prefix: '３' },
      { start: 4, prefix: '04' },
      { start: 5, prefix: 'Ⅴ' },
    ]);
    expect(pageLabelRanges(pages([[0], [1], [4000, 'i']]))).toEqual([
      { start: 0, prefix: '0' },
      { start: 1, style: 'D' },
      { start: 2, prefix: '4000' },
    ]);
  });
  it('書式の前後の字は入れない。桁区切りは、区切りの付く番号だけページごとの P', () => {
    expect(pageLabelRanges(pages([[1, '- i -'], [2, '(i)']]))).toEqual([{ start: 0, style: 'r' }]);
    const g = withGrouping('1', ',', 3);
    expect(pageLabelRanges(pages([[999, g], [1000, g], [1001, g]]))).toEqual([
      { start: 0, style: 'D', first: 999 },
      { start: 1, prefix: '1,000' },
      { start: 2, prefix: '1,001' },
    ]);
  });
});

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
const loadFont = loadCachedFont;

/** PDF のページラベル (Nums を [ページの順の番号, { S, P, St }] の並びにしたもの。無ければ undefined) */
async function labelsOf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pl = pdf.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict);
  if (!pl) return undefined;
  const nums = pl.lookup(PDFName.of('Nums'), PDFArray).asArray();
  const out: Array<[number, Record<string, string | number>]> = [];
  for (let i = 0; i < nums.length; i += 2) {
    const d = pdf.context.lookup(nums[i + 1]) as PDFDict;
    const o: Record<string, string | number> = {};
    for (const [k, v] of d.entries())
      o[k.decodeText()] = v instanceof PDFNumber ? v.asNumber() : v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : String(v).replace(/^\//, '');
    out.push([(nums[i] as PDFNumber).asNumber(), o]);
  }
  return out;
}

const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const seq = (attrs: string, n: number) =>
  `<fo:page-sequence master-reference="m" ${attrs}><fo:flow flow-name="xsl-region-body">${Array.from({ length: n }, (_, i) => `<fo:block${i ? ' break-before="page"' : ''}>p<fo:page-number/></fo:block>`).join('')}</fo:flow></fo:page-sequence>`;
const fo = (...seqs: string[]) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="80mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>${seqs.join('')}</fo:root>`;

describe('組んだ PDF のページラベル', () => {
  it('XSL-FO: 前付け (format="i") と本文 (initial-page-number="1")、漢数字の付録', async () => {
    const r = await typesetFo(fo(seq('format="i" force-page-count="no-force"', 2), seq('initial-page-number="1" force-page-count="no-force"', 2), seq('format="一" initial-page-number="1"', 1)), { loadFont });
    // 領域の木: 10 進でないページだけに書式がある
    expect(r.areaTree.sheets.map((s) => [s.page.pageNumber, s.page.pageNumberFormat])).toEqual([
      [1, 'i'],
      [2, 'i'],
      [1, undefined],
      [2, undefined],
      [1, '一'],
    ]);
    expect(await labelsOf(await r.toPdf())).toEqual([
      [0, { S: 'r' }],
      [2, { S: 'D' }],
      [4, { P: '一' }],
    ]);
  });
  it('XSL-FO: 1 からの 10 進の通しの文書には、PageLabels を書かない', async () => {
    const r = await typesetFo(fo(seq('force-page-count="no-force"', 2), seq('', 1)), { loadFont });
    expect(await labelsOf(await r.toPdf())).toBeUndefined();
  });
  it('HTML: counter(page, lower-roman) の前付けと、counter-reset: page 1 の本文', async () => {
    const html = `<html><head><style>
      @page { size: 100mm 80mm; margin: 10mm; @bottom-center { content: counter(page) } }
      @page front { @bottom-center { content: counter(page, lower-roman) } }
      .front { page: front }
      .body { counter-reset: page 1; break-before: page }
      p + p { break-before: page }
    </style></head><body><section class="front"><p>a</p><p>b</p></section><section class="body"><p>c</p><p>d</p></section></body></html>`;
    const r = await typesetHtml(html, { loadFont });
    expect(r.areaTree.sheets.map((s) => [s.page.pageNumber, s.page.pageNumberFormat])).toEqual([
      [1, 'i'],
      [2, 'i'],
      [1, undefined],
      [2, undefined],
    ]);
    expect(await labelsOf(await r.toPdf())).toEqual([
      [0, { S: 'r' }],
      [2, { S: 'D' }],
    ]);
  });
  it('HTML: 同じページの中で @page の規則ごとに counter(page) の型が違えば、ページごとのラベルもその型 (:first だけローマ数字)', async () => {
    const html = `<html><head><style>
      @page { size: 100mm 80mm; margin: 10mm; @bottom-center { content: counter(page) } }
      @page :first { @bottom-center { content: counter(page, lower-roman) } }
      p + p { break-before: page }
    </style></head><body><p>a</p><p>b</p><p>c</p></body></html>`;
    const r = await typesetHtml(html, { loadFont });
    // 前は、page-sequence の書式 (最初に見つかった :first の型) を全部のページに使い、2・3 ページ目のラベルも ii・iii になった
    expect(r.areaTree.sheets.map((s) => [s.page.pageNumber, s.page.pageNumberFormat])).toEqual([
      [1, 'i'],
      [2, undefined],
      [3, undefined],
    ]);
    expect(await labelsOf(await r.toPdf())).toEqual([
      [0, { S: 'r' }],
      [1, { S: 'D', St: 2 }],
    ]);
  });

  it('タグ付き PDF・PDF/A-2b でも書く (カタログの項だけで、構造の木と関わらない)', async () => {
    const r = await typesetFo(fo(seq('format="I" force-page-count="no-force"', 1), seq('initial-page-number="1"', 1)), { loadFont, tagged: true });
    expect(await labelsOf(await r.toPdf({ pdfa: { version: 'A-2b' } }))).toEqual([
      [0, { S: 'R' }],
      [1, { S: 'D' }],
    ]);
  });
});
