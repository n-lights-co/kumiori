import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { isXhtmlFile, xhtmlToHtml } from '../src/xhtml';
import { inlineSvgDataUri, isInlineSvg, serializeInlineSvg } from '../src/htmlSvg';

describe('XHTML: XML の構文で読み、HTML に書き直す', () => {
  it('接頭辞の付いた SVG・MathML の要素は、名前空間に従って接頭辞の無い名前になる', () => {
    const x = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:s="http://www.w3.org/2000/svg" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:xl="http://www.w3.org/1999/xlink"><head><title>t</title></head><body><p>a<s:svg width="10" viewBox="0 0 10 10"><s:linearGradient id="g"/><s:use xl:href="#g"/></s:svg><m:math><m:mi>x</m:mi></m:math></p></body></html>`;
    const h = xhtmlToHtml(x);
    expect(h).toContain('<svg width="10" viewBox="0 0 10 10"><linearGradient id="g"/><use xlink:href="#g"/></svg>');
    expect(h).toContain('<math><mi>x</mi></math>');
    expect(h).not.toContain('xmlns');
  });
  it('HTML の文字参照・空要素・script の中身・xml-stylesheet', () => {
    const x = `<?xml-stylesheet href="a.css" type="text/css"?><html xmlns="http://www.w3.org/1999/xhtml"><head><script>if (1 &lt; 2) {}</script></head><body><p>&nbsp;&amp;<br/><img src="x.png"/></p></body></html>`;
    const h = xhtmlToHtml(x);
    expect(h).toContain('<head><link rel="stylesheet" href="a.css">');
    expect(h).toContain('<script>if (1 < 2) {}</script>');
    expect(h).toContain('<p> &amp;<br><img src="x.png"></p>');
  });
  it('pre・textarea の中身の先頭の改行を落とさない (改行を重ねて書く。HTML の構文では、開始タグの直後の改行は読み捨てられる)', () => {
    const h = xhtmlToHtml('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><pre>\na\n</pre><pre>b</pre><pre><![CDATA[\nc]]></pre><textarea>\nd</textarea><p>\ne</p></body></html>');
    expect(h).toContain('<pre>\n\na\n</pre><pre>b</pre><pre>\n\nc</pre><textarea>\n\nd</textarea><p>\ne</p>');
  });
  it('整形式でない文書は誤り', () => {
    expect(() => xhtmlToHtml('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>a</body></html>')).toThrow();
  });
  it('拡張子', () => {
    expect([isXhtmlFile('a.xhtml'), isXhtmlFile('a.XHT'), isXhtmlFile('a.html'), isXhtmlFile('a.xml')]).toEqual([true, true, false, false]);
  });
});

describe('HTML の中の <svg>', () => {
  it('SVG の名前空間の要素だけを SVG とし、要素名の大文字小文字を戻して単独の SVG 文書にする', () => {
    const { document } = parseHTML(
      '<html><body><svg viewBox="0 0 10 10"><clippath id="c"><rect width="5" height="5"/></clippath><text>a&lt;b</text></svg><s:svg xmlns:s="http://www.w3.org/2000/svg"></s:svg></body></html>',
    );
    const [svg] = Array.from(document.querySelectorAll('svg')) as Element[];
    expect(isInlineSvg(svg)).toBe(true);
    const prefixed = Array.from(document.body.children).find((e) => e.localName !== 'svg') as Element;
    expect(isInlineSvg(prefixed)).toBe(false);
    const s = serializeInlineSvg(svg);
    expect(s).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink" viewBox="0 0 10 10">/);
    expect(s).toContain('<clipPath id="c"><rect width="5" height="5"/></clipPath><text>a&lt;b</text>');
    const uri = inlineSvgDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(new TextDecoder().decode(Uint8Array.from(atob(uri.slice(26)), (c) => c.charCodeAt(0)))).toBe(s);
  });
});
