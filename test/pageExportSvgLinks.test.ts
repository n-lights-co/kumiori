/**
 * ページの SVG の書き出し (renderPageToSvg) のリンク。
 *  - 本文のリンク (HTML の a・XSL-FO の fo:basic-link) と、SVG の画像の中のリンク (SVG 2 の a 要素) を、PDF と同じリンクの決まり
 *    (TypesetOptions.links。linkPolicy.ts の judgeExternalLink) に通してから書く。通さないものは書かずに警告する
 *  - URI は XML の属性としてエスケープする (XML 1.0 §2.4・§3.1)。XML に書けない字は %xx にする
 *  - 文書の中の飛び先は、同じページなら #id、別のページなら pageHref で名前を付けた SVG の #id (pageHref が無ければ書かない)。
 *    飛び先の id は、ページの SVG の中の要素の id にする
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { DEFAULT_FONTS, typesetFo, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const XLINK = 'http://www.w3.org/1999/xlink';
/** 整った XML として読み、a 要素の飛び先を並べる */
function parse(svg: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level: string, m: string) => void (level !== 'warning' && errors.push(m)) }).parseFromString(svg, 'image/svg+xml');
  expect(errors).toEqual([]);
  const links = Array.from(doc.getElementsByTagName('a')).map((a) => a.getAttributeNS(XLINK, 'href') ?? a.getAttribute('href'));
  const ids = Array.from(doc.getElementsByTagName('*'))
    .map((e) => e.getAttribute('id'))
    .filter((v): v is string => !!v);
  return { doc, links, ids };
}

describe('本文のリンク', () => {
  it('外へのリンクを a にする (飛び先の URL は XML の属性としてエスケープする)', async () => {
    const r = await typesetHtml('<p><a href="https://example.com/?a=1&amp;b=%222%22">x</a> <a href="mailto:a@example.com">m</a></p>', { loadFont });
    const svg = await r.renderPageToSvg(0);
    expect(svg).toContain('xlink:href="https://example.com/?a=1&amp;b=%222%22"');
    const { links } = parse(svg);
    expect(links).toEqual(['https://example.com/?a=1&b=%222%22', 'mailto:a@example.com']);
  }, 120_000);

  it('リンクは押せる透明の矩形で、ページの字の上に重ねる', async () => {
    const r = await typesetHtml('<p><a href="https://example.com/">x</a></p>', { loadFont });
    const svg = await r.renderPageToSvg(0);
    const { doc } = parse(svg);
    const a = doc.getElementsByTagName('a')[0];
    const rect = a.getElementsByTagName('rect')[0];
    expect(rect.getAttribute('fill-opacity')).toBe('0');
    // 本体の最後 (字の後) に書く
    expect(svg.lastIndexOf('<path')).toBeLessThan(svg.indexOf('<a '));
  }, 120_000);

  it('links の決まりで通さないスキームは書かず、警告する (XSL-FO の external-destination も)', async () => {
    const fo = (dest: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="a" page-width="100mm" page-height="50mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="a"><fo:flow flow-name="xsl-region-body"><fo:block><fo:basic-link external-destination="url(${dest})">x</fo:basic-link></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const bad = await typesetFo(fo('javascript:alert(1)'), { loadFont });
    const svg = await bad.renderPageToSvg(0);
    expect(svg).not.toContain('javascript');
    expect(parse(svg).links).toEqual([]);
    const ftp = await typesetFo(fo('ftp://example.com/x'), { loadFont, links: { schemes: ['ftp'] } });
    expect(parse(await ftp.renderPageToSvg(0)).links).toEqual(['ftp://example.com/x']);
  }, 120_000);

  it('取り込みを通らずに木に入った飛び先も、書く前に決まりに通す (javascript: は書かずに警告する)', async () => {
    const r = await typesetHtml('<p><a href="https://example.com/">x</a></p>', { loadFont });
    let n = 0;
    const seen = new Set<object>();
    const visit = (o: unknown): void => {
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      seen.add(o);
      const link = (o as { link?: { external?: string } }).link;
      if (link?.external) {
        link.external = ' java\tscript:alert(1)';
        n++;
      }
      for (const v of Object.values(o)) visit(v);
    };
    visit(r.areaTree.sheets[0]);
    expect(n).toBeGreaterThan(0);
    const svg = await r.renderPageToSvg(0);
    expect(svg).not.toMatch(/java/);
    expect(r.warnings.join('\n')).toMatch(/リンクを SVG に書きませんでした.*javascript:/);
  }, 120_000);

  it('文書の中の飛び先: 同じページは #id (id の要素を書く)、別のページは pageHref の名前 (無ければ書かない)', async () => {
    const html =
      '<html><head><style>@page{size:100mm 50mm}</style></head><body><p id="top"><a href="#top">a</a> <a href="#far">b</a></p><p id="far" style="break-before:page">c <a href="#top">d</a></p></body></html>';
    const r = await typesetHtml(html, { loadFont });
    const p0 = parse(await r.renderPageToSvg(0));
    expect(p0.links).toEqual(['#top']);
    expect(p0.ids).toContain('top');
    expect(p0.ids).not.toContain('far');
    const named = parse(await r.renderPageToSvg(0, { pageHref: (k) => `a-${k + 1}.svg` }));
    expect(named.links).toEqual(['#top', 'a-2.svg#far']);
    const p1 = parse(await r.renderPageToSvg(1, { pageHref: (k) => `a b-${k + 1}.svg` }));
    expect(p1.ids).toContain('far');
    // 返した名前も、XML の属性としてエスケープする (空白はそのまま)
    expect(p1.links).toEqual(['a b-1.svg#top']);
  }, 120_000);

  it('文書の id が、書き出しの中の id (k0 など) とぶつからない', async () => {
    const r = await typesetHtml('<p id="k0" style="border-radius:4pt;overflow:hidden;background:#eee"><a href="#k0">a</a></p><div id="k1" style="opacity:.5;border-radius:3pt;overflow:hidden">b</div>', { loadFont });
    const { ids } = parse(await r.renderPageToSvg(0));
    expect(ids).toContain('k0');
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);

  it('id の字が、URL の飛び先 (#…) では %xx になる', async () => {
    const r = await typesetHtml('<p id="a b%"><a href="#a%20b%25">x</a></p>', { loadFont });
    const { links, ids } = parse(await r.renderPageToSvg(0));
    expect(ids).toContain('a b%');
    expect(links).toEqual(['#a%20b%25']);
  }, 120_000);

  it('pageHref は関数 (ほかの値は TypeError)', async () => {
    const r = await typesetHtml('<p>x</p>', { loadFont });
    await expect(r.renderPageToSvg(0, { pageHref: 'a.svg' as never })).rejects.toThrow(TypeError);
  }, 120_000);
});

describe('SVG の画像の中のリンク', () => {
  const svgA =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="30" height="10">' +
    '<a xlink:href="ftp://example.com/x"><rect width="10" height="10" fill="red"/></a><a href="https://example.com/?q=&quot;1&quot;"><rect x="20" width="10" height="10"/></a></svg>';
  it('決まりに通るものだけを a にして、中の図形を包む。通らないものは書かずに警告する', async () => {
    const r = await typesetHtml('<p><img src="a.svg"></p>', { loadFont, files: [{ name: 'a.svg', data: svgA }] });
    const svg = await r.renderPageToSvg(0);
    expect(svg).not.toContain('ftp:');
    const { doc, links } = parse(svg);
    expect(links).toEqual(['https://example.com/?q="1"']);
    expect(svg).toContain('xlink:href="https://example.com/?q=&quot;1&quot;"');
    // a の中に、図形 (path) がある
    expect(doc.getElementsByTagName('a')[0].getElementsByTagName('path').length).toBeGreaterThan(0);
    expect(r.warnings.join('\n')).toMatch(/ftp:/);
    // 図形は描く
    expect(svg).toContain('fill="#ff0000"');
  }, 120_000);

  it('links の決まりで許せば書く', async () => {
    const r = await typesetHtml('<p><img src="a.svg"></p>', { loadFont, files: [{ name: 'a.svg', data: svgA }], links: { schemes: ['ftp', 'https'] } });
    expect(parse(await r.renderPageToSvg(0)).links).toEqual(['ftp://example.com/x', 'https://example.com/?q="1"']);
  }, 120_000);
});
