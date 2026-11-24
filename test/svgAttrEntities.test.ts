/**
 * SVG の属性の値の文字参照 (&amp; など) を、どの所でも戻して読む (XML 1.0 §3.3.3・§4.1)。
 * Node の linkedom の XML の読み取りは属性の文字参照を戻さず、描く所は字面のまま引き、見つからない参照の知らせ (svgMissingImages) も字面のまま、
 * SVG の中の http(s) の画像を取る所 (svgImageRefs) だけが戻していたので、href="a&amp;b.png" の画像は描かれず、「見つからない」と知らせた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { DEFAULT_FONTS, typeset } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { decodeXmlAttr, decodeXmlAttributes, hrefOfTag } from '../src/xmlAttr';
import { importLinkedom } from '../src/linkedomModules';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const png = encodePngStored({ width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) });
/** 出力の PDF の、画像の XObject の数 (Form の中のものも) */
async function imageXObjects(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.context.enumerateIndirectObjects().filter(([, o]) => 'dict' in o && (o as { dict: PDFDict }).dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length;
}

describe('SVG の属性の文字参照', () => {
  it('decodeXmlAttr・hrefOfTag: 文字参照と決まった実体参照を戻す (名前の大文字は戻さない)', () => {
    expect(decodeXmlAttr('a&amp;b&#38;c&#x26;d&lt;&gt;&quot;&apos;')).toBe('a&b&c&d<>"\'');
    expect(decodeXmlAttr('a&AMP;b&nbsp;')).toBe('a&AMP;b&nbsp;');
    expect(hrefOfTag('<image xlink:href=" x?a=1&amp;b=2 "/>')).toBe('x?a=1&b=2');
  });

  it('Node の SVG の読み取り: どの属性も戻した値を返し、後で作る・写す要素も同じ (ほかの文書の getAttribute は変えない)', async () => {
    const lk = (await importLinkedom()) as unknown as { DOMParser: new () => { parseFromString(t: string, m: string): Document }; parseHTML(t: string): { document: Document } };
    const doc = new lk.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text style="font-family: &quot;A&amp;B&quot;" font-family="&quot;Q&quot;">x</text></svg>', 'image/svg+xml');
    decodeXmlAttributes(doc);
    const t = doc.documentElement.firstElementChild!;
    expect(t.getAttribute('style')).toBe('font-family: "A&B"');
    expect(t.getAttribute('font-family')).toBe('"Q"');
    // 後で作る要素・写す要素も (前は、読んだときにある要素だけを置き換えたので、linkedom のもとの getAttribute (& を &amp; に逃がす) に戻った)
    const made = doc.createElementNS('http://www.w3.org/2000/svg', 'a');
    made.setAttribute('href', '?a=1&b=2');
    expect(made.getAttribute('href')).toBe('?a=1&b=2');
    expect((t.cloneNode(true) as Element).getAttribute('style')).toBe('font-family: "A&B"');
    // ほかの文書 (linkedom の HTML) は、もとのまま
    const html = lk.parseHTML('<p title="a&amp;b"></p>').document;
    expect(html.querySelector('p')!.getAttribute('title')).toBe('a&b');
  });

  for (const [name, doc, kind] of [
    ['HTML のインラインの svg', '<p>x</p><svg width="10" height="10"><a href="https://example.com/?a=1&amp;b=2"><rect width="10" height="10"/></a></svg>', 'html'],
    [
      'XSL-FO の fo:instream-foreign-object の SVG',
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200pt" page-height="200pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:instream-foreign-object><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><a xlink:href="https://example.com/?a=1&amp;b=2"><rect width="10" height="10"/></a></svg></fo:instream-foreign-object></fo:block></fo:flow></fo:page-sequence></fo:root>',
      'fo',
    ],
  ] as const) {
    it(`${name}: a の href の文字参照を戻した URI をリンクにする`, async () => {
      const r = await typeset(doc, { kind, loadFont: loadCachedFont, fetchImages: false });
      const pdf = await PDFDocument.load(await r.toPdf());
      const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
      const uris = annots.asArray().map((a) => (pdf.context.lookup(a, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI')) as PDFString).decodeText());
      expect(uris).toEqual(['https://example.com/?a=1&b=2']);
    });
  }

  for (const [name, html, files] of [
    ['インラインの svg', '<p>x</p><svg width="10" height="10"><image href="a&amp;b.png" width="10" height="10"/></svg>', []],
    ['img の SVG のファイル', '<p><img src="f.svg"></p>', [{ name: 'f.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="a&amp;b.png" width="10" height="10"/></svg>' }]],
  ] as const) {
    it(`${name}: href="a&amp;b.png" は、ファイル a&b.png を描き、見つからないと知らせない`, async () => {
      const r = await typeset(html, { loadFont: loadCachedFont, fetchImages: false, files: [{ name: 'a&b.png', data: png }, ...files] });
      expect(r.diagnostics.filter((d) => d.code === 'image/reference-not-found')).toEqual([]);
      expect(await imageXObjects(await r.toPdf())).toBe(1);
    });
  }
});
