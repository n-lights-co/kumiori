import { beforeAll, describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray } from 'pdf-lib';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

/**
 * 同じ SVG の画像を何度置いても、図形の命令は 1 度だけ (Form XObject に) 書き、2 度目からは Form を Do で置く
 * (PdfPainter.drawVector)。手間は、PDF に書かれた図形の命令の数で確かめる (時間は測らない)
 */
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

// 見分けの付く座標の path (1 つずつの命令 "12.25 0 m" を数える)、グラデーション、透明、字、リンク
const N = 50;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
${Array.from({ length: N }, (_, i) => `<path d="M${i + 0.25} 0l1 0l0 1z" fill="${i % 2 ? '#3a6' : 'url(#g)'}"${i % 5 ? '' : ' opacity="0.5"'}/>`).join('')}
<text x="5" y="90" font-size="10">SVGtext</text>
<a xlink:href="https://example.com/svg"><rect x="80" y="80" width="10" height="10" fill="orange"/></a>
</svg>`;
const files = [{ name: 's.svg', data: new TextEncoder().encode(SVG) }];
const html = (imgs: string) => `<!doctype html><html lang="ja"><head><style>@page { size: 100mm 80mm; margin: 5mm } img { display: block }</style></head><body>${imgs}</body></html>`;

/** PDF の内容の流れ (ページ・Form) を全部ほどいた文字列 */
async function contents(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const streams: Array<{ form: boolean; text: string; dict: PDFDict }> = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Length1')) || obj.dict.get(PDFName.of('N'))) continue;
    const sub = obj.dict.get(PDFName.of('Subtype'));
    if (sub && sub !== PDFName.of('Form')) continue;
    let text: string;
    try {
      text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    streams.push({ form: sub === PDFName.of('Form'), text, dict: obj.dict });
  }
  const links = pdf.getPages().map((pg) => {
    const annots = pg.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    return annots ? annots.size() : 0;
  });
  return { pdf, streams, links, all: streams.map((s) => s.text).join('\n') };
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** path の命令の始まり (どの path も "<i>.25 0 m") */
const PATH_START = /\b\d+\.25 0 m\b/g;
const HAS_PATH = /\b\d+\.25 0 m\b/;

describe('同じ SVG を何度置いても、図形の命令は 1 度だけ書く', () => {
  it('同じ大きさで 2 ページに 6 回置く: 図形の命令は 1 度、Form を 6 回 Do で置き、リンクは置いた数だけ', { timeout: 60_000 }, async () => {
    const r = await typesetHtml(html(Array.from({ length: 6 }, () => '<img src="s.svg" style="width: 30mm; height: 30mm">').join('')), { loadFont: loadCachedFont, files });
    const c = await contents(await r.toPdf());
    expect(c.pdf.getPageCount()).toBeGreaterThan(1);
    expect(count(c.all, PATH_START)).toBe(N);
    // 図形の命令を書いた Form は 1 つ (使い回す Form の名前は KmV…)
    const forms = c.streams.filter((s) => s.form && HAS_PATH.test(s.text));
    expect(forms).toHaveLength(1);
    expect(count(c.all, /\/KmV[^\s]*\s+Do/g)).toBe(6);
    // Form は透明のグループにしない (Do を置いた所にじかに描いたのと同じに重なる)
    expect(forms[0].dict.get(PDFName.of('Group'))).toBeUndefined();
    // Form の資源で書体が引ける (SVG の字は PDF の字として描く)
    const res = forms[0].dict.lookup(PDFName.of('Resources'), PDFDict);
    expect(res.lookupMaybe(PDFName.of('Font'), PDFDict)?.keys().length).toBeGreaterThan(0);
    expect(forms[0].text).toMatch(/Tj|TJ/);
    // SVG の a のリンクは、置いた所ごと
    expect(c.links.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('置く大きさが違えば、大きさごとに 1 つの Form', { timeout: 60_000 }, async () => {
    const imgs = ['30mm', '20mm', '30mm', '20mm'].map((w) => `<img src="s.svg" style="width: ${w}; height: ${w}">`).join('');
    const c = await contents(await (await typesetHtml(html(imgs), { loadFont: loadCachedFont, files })).toPdf());
    expect(count(c.all, PATH_START)).toBe(2 * N);
    expect(c.streams.filter((s) => s.form && HAS_PATH.test(s.text))).toHaveLength(2);
    expect(count(c.all, /\/KmV[^\s]*\s+Do/g)).toBe(4);
  });

  it('グラデーションの模様の行列は Form の座標から (ISO 32000-2 §8.7.3.1): 平行移動を含まず、置く所によらない', { timeout: 60_000 }, async () => {
    const r = await typesetHtml(html('<img src="s.svg" style="width: 30mm; height: 30mm"><img src="s.svg" style="width: 30mm; height: 30mm; margin-left: 40mm">'), { loadFont: loadCachedFont, files });
    const c = await contents(await r.toPdf());
    const pats = [...c.pdf.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('PatternType')) !== undefined);
    // 模様は 1 度だけ (Form の中の 1 回分) 作る
    expect(pats).toHaveLength(N / 2);
    for (const p of pats) {
      const m = p.lookup(PDFName.of('Matrix'), PDFArray).asArray().map(Number);
      // SVG の座標 (viewBox 0 0 100 100) を 30mm に写す拡大 (85.04/100) と、図形の位置だけ。ページの上の位置 (余白の 5mm = 14.17pt など) は入らない
      expect(Math.abs(m[4])).toBeLessThan(N);
    }
  });

  it('PDF/X-1a (透明を平らにする) でも組める。透明の無い SVG は Form を使い回す', { timeout: 60_000 }, async () => {
    // 透明の無い SVG (path の座標を …\.75 にして見分ける)
    const opaque = SVG.replaceAll(' opacity="0.5"', '').replaceAll('url(#g)', '#c33').replace(/(M\d+)\.25 0/g, '$1.75 0');
    const r = await typesetHtml(html(Array.from({ length: 3 }, () => '<img src="o.svg" style="width: 30mm; height: 30mm">').join('') + '<img src="s.svg" style="width: 30mm; height: 30mm">'), {
      loadFont: loadCachedFont,
      files: [...files, { name: 'o.svg', data: new TextEncoder().encode(opaque) }],
    });
    const warnings: string[] = [];
    const c = await contents(await r.toPdf({ pdfx: { version: 'X-1a', warnings } }));
    // 透明の無い SVG: 3 回置いて、図形の命令は 1 度
    expect(count(c.all, /\b\d+\.75 0 m\b/g)).toBe(N);
    expect(count(c.all, /\/KmV[^\s]*\s+Do/g)).toBeGreaterThanOrEqual(3);
  });
});
