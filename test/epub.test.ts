import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readEpub, readZip } from '../src/epub';
import { makeZip } from './makeZip';

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../style/book.css"/></head><body class="main">${body}</body></html>`;

describe('EPUB', () => {
  it('zip の無圧縮・deflate の項目を読める', async () => {
    const zip = makeZip([
      { name: 'a.txt', text: 'あいう' },
      { name: 'b.txt', text: 'かきく'.repeat(50), deflate: true },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(new TextDecoder().decode(await entries[0].data())).toBe('あいう');
    expect(new TextDecoder().decode(await entries[1].data())).toBe('かきく'.repeat(50));
  });

  it('spine の順に章をつなぎ、CSS と画像を集める', async () => {
    const zip = makeZip([
      { name: 'mimetype', text: 'application/epub+zip' },
      { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>' },
      {
        name: 'OEBPS/content.opf',
        deflate: true,
        text: `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>見本の本</dc:title><dc:language>ja</dc:language></metadata>
<manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style/book.css" media-type="text/css"/><item id="i1" href="img/fig.png" media-type="image/png"/></manifest>
<spine page-progression-direction="rtl"><itemref idref="nav" linear="no"/><itemref idref="c2"/><itemref idref="c1"/></spine></package>`,
      },
      { name: 'OEBPS/style/book.css', text: 'html { writing-mode: vertical-rl; }' },
      { name: 'OEBPS/text/ch1.xhtml', text: xhtml('<h1>第一章</h1><p>本文<a id="x"/>です。</p><img src="../img/fig.png" alt=""/>') },
      { name: 'OEBPS/text/ch2.xhtml', text: xhtml('<h1>序</h1>') },
      { name: 'OEBPS/nav.xhtml', text: xhtml('<nav>目次</nav>') },
      { name: 'OEBPS/img/fig.png', text: 'PNG' },
    ]);
    const book = await readEpub(zip, (t, type) => new DOMParser().parseFromString(t, type) as unknown as Document);
    expect(book.title).toBe('見本の本');
    // 目次 (linear="no") は除き、spine の順 (序 → 第一章)。2 章目から改ページ
    expect(book.html).not.toContain('目次');
    expect(book.html.indexOf('序')).toBeLessThan(book.html.indexOf('第一章'));
    expect(book.html).toMatch(/<section class="main" style="break-before: page">.*第一章/);
    expect(book.html).toContain('lang="ja"');
    // CSS は 1 度だけ。画像のパスは zip の中のパスに直る
    expect(book.html.match(/writing-mode/g)?.length).toBe(1);
    expect(book.html).toContain('src="OEBPS/img/fig.png"');
    expect(book.images.map((i) => i.name)).toEqual(['OEBPS/img/fig.png']);
    // 空要素の <a/> の後ろの文字も段落の中に残る
    expect(book.html).toContain('<p>本文<a id="x"></a>です。</p>');
  });
});
