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

  /** 2 章の EPUB (container.xml と 1 章目の XHTML を渡す) */
  const twoChapters = (chapter: string, container = '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>', second = '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>二</p></body></html>') =>
    readEpub(
      makeZip([
        { name: 'mimetype', text: 'application/epub+zip' },
        { name: 'META-INF/container.xml', text: container },
        { name: 'content.opf', text: '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>' },
        { name: 'ch1.xhtml', text: chapter },
        { name: 'ch2.xhtml', text: second },
      ]),
      (t, type) => new DOMParser().parseFromString(t, type) as unknown as Document,
    );
  const PLAIN = '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>一</p></body></html>';

  it('題つきの rel="alternate stylesheet" の CSS は当てない (HTML の文書と同じ決まり。CSSOM 1 §6.2)', async () => {
    const book = (head: string) =>
      readEpub(
        makeZip([
          { name: 'mimetype', text: 'application/epub+zip' },
          { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>' },
          { name: 'content.opf', text: '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
          { name: 'ch1.xhtml', text: `<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body><p>一</p></body></html>` },
          { name: 'a.css', text: '.x0 { color: red }' },
          { name: 'b.css', text: '.x1 { color: red }' },
          { name: 'c.css', text: '.x2 { color: red }' },
        ]),
        (t, type) => new DOMParser().parseFromString(t, type) as unknown as Document,
      ).then((b) => ['.x0', '.x1', '.x2'].filter((s) => b.html.includes(s)));
    // 縦書き・横書きを切り替える代わりのスタイルシート (EPUB で多い書き方): 題つきの alternate は当てない
    expect(await book('<link rel="stylesheet" href="a.css"/><link rel="alternate stylesheet" title="横書き" href="b.css"/><link rel="Stylesheet Alternate" title="t" href="c.css"/>')).toEqual(['.x0']);
    // 題が、選ばれた組の名前 (alternate でない題つきのスタイルシートの題) と同じなら当てる。題が無ければ当てる
    expect(await book('<link rel="stylesheet" title="t" href="a.css"/><link rel="alternate stylesheet" title="t" href="b.css"/><link rel="alternate stylesheet" href="c.css"/>')).toEqual(['.x0', '.x1', '.x2']);
    // 選ばれた組の名前は、題のある style でも決まる
    expect(await book('<style title="s">p { margin: 0 }</style><link rel="alternate stylesheet" title="s" href="b.css"/><link rel="alternate stylesheet" title="t" href="c.css"/>')).toEqual(['.x1']);
  });

  it('章の html・body の属性 (class・lang・dir・style・id) を、章を包む要素に写す (HTM-11)', async () => {
    const book = await twoChapters(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" class="vrtl" xml:lang="ja" dir="rtl"><head/><body id="b1" class="main" style="margin: 0;" epub:type="bodymatter"><p>一</p></body></html>',
    );
    // html の属性は外の div、body の属性は section。xml:lang は lang に。名前空間の宣言は写さない
    expect(book.html).toContain('<div class="vrtl" dir="rtl" lang="ja"><section id="b1" class="main" epub:type="bodymatter" style="margin: 0"><p>一</p></section></div>');
    // 属性の無い html は包まない。章の改ページは section の style
    expect(book.html).toContain('<section style="break-before: page"><p>二</p></section>');
    expect(book.html).not.toContain('xmlns');
  });

  it('body の style と章の改ページを 1 つの style にまとめる (HTM-11)', async () => {
    const book = await twoChapters(PLAIN, undefined, '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body style="color: red"><p>二</p></body></html>');
    expect(book.html).toContain('<section style="color: red; break-before: page"><p>二</p></section>');
  });

  it("container.xml の属性の値は ' で囲んでもよい。接頭辞つきの rootfile も読む (HTM-12)", async () => {
    for (const container of [
      "<?xml version='1.0'?><container version='1.0' xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>",
      '<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container"><c:rootfiles><c:rootfile media-type="application/oebps-package+xml" full-path = "content.opf"/></c:rootfiles></c:container>',
    ]) {
      const book = await twoChapters(PLAIN, container);
      expect(book.html).toContain('<p>一</p>');
    }
    await expect(twoChapters(PLAIN, '<container><rootfiles/></container>')).rejects.toThrow('OPF');
  });

  it('pre の中身の先頭の改行を落とさない (HTML の構文で読み直しても残るように、改行を重ねて書く。HTM-12)', async () => {
    const book = await twoChapters('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><pre>\na\n</pre><pre>b</pre><textarea>\nc</textarea></body></html>');
    expect(book.html).toContain('<pre>\n\na\n</pre><pre>b</pre><textarea>\n\nc</textarea>');
  });

  describe('展開の上限 (HTM-13。小さな zip から巨大な展開をさせない)', () => {
    const parse = (t: string, type: 'application/xml' | 'text/html') => new DOMParser().parseFromString(t, type) as unknown as Document;
    const CONTAINER = { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>' };
    const opf = (manifest: string, spine: string) => ({ name: 'content.opf', text: `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${manifest}</manifest><spine>${spine}</spine></package>` });
    const chapter = (body: string, head = '') => `<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`;
    const CH = '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>';

    it('1 つの項目: 展開しながら数え、上限を超えたら止める (中央ディレクトリに書いた大きさは見ない)', async () => {
      const zip = makeZip([
        { name: 'big.txt', text: 'a'.repeat(200_000), deflate: true },
        { name: 'small.txt', text: 'b'.repeat(1000), deflate: true },
        { name: 'stored.txt', text: 'c'.repeat(5000) },
      ]);
      // 圧縮した大きさは小さい (よく縮むデータ)
      expect(zip.length).toBeLessThan(8000);
      // 中央ディレクトリ・ローカルヘッダーの「展開後の大きさ」を 1 に偽っても、展開した量で判定する
      const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      for (let i = 0; i + 4 <= zip.length; i++) {
        if (v.getUint32(i, true) === 0x02014b50) v.setUint32(i + 24, 1, true);
        else if (v.getUint32(i, true) === 0x04034b50) v.setUint32(i + 22, 1, true);
      }
      const [big, small, stored] = readZip(zip, { maxEntryBytes: 4096 });
      await expect(big.data()).rejects.toMatchObject({ name: 'ZipLimitError', scope: 'entry' });
      await expect(big.data()).rejects.toThrow(/big\.txt/);
      expect((await small.data()).length).toBe(1000);
      // 無圧縮の項目も同じ上限
      await expect(stored.data()).rejects.toMatchObject({ scope: 'entry' });
      // 既定の上限では読める
      expect((await readZip(zip)[0].data()).length).toBe(200_000);
    });

    it('合計: 展開した量の合計が上限を超えたら止める (同じ項目を何度も展開すれば、その回数だけ数える)', async () => {
      const zip = makeZip([{ name: 'a.txt', text: 'a'.repeat(3000), deflate: true }]);
      const [a] = readZip(zip, { maxTotalBytes: 7000 });
      expect((await a.data()).length).toBe(3000);
      expect((await a.data()).length).toBe(3000);
      await expect(a.data()).rejects.toMatchObject({ name: 'ZipLimitError', scope: 'total' });
    });

    it('項目の数: 上限より多い zip は読まない', () => {
      const zip = makeZip([1, 2, 3, 4].map((k) => ({ name: `${k}.txt`, text: 'x' })));
      expect(() => readZip(zip, { maxEntries: 3 })).toThrow(/多すぎ/);
      expect(readZip(zip, { maxEntries: 4 })).toHaveLength(4);
    });

    it('EPUB: 上限を超えた章・CSS・画像は飛ばして警告し、ほかは組む', async () => {
      const zip = makeZip([
        { name: 'mimetype', text: 'application/epub+zip' },
        CONTAINER,
        opf(`${CH}<item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/><item id="i1" href="big.png" media-type="image/png"/><item id="i2" href="ok.png" media-type="image/png"/><item id="i3" href="ok.png" media-type="image/png"/>`, '<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>'),
        { name: 'ch1.xhtml', text: chapter('<p>一</p>', '<link rel="stylesheet" href="big.css"/><link rel="stylesheet" href="ok.css"/>') },
        { name: 'ch2.xhtml', text: chapter(`<p>巨大${'あ'.repeat(20_000)}</p>`), deflate: true },
        { name: 'ch3.xhtml', text: chapter('<p>三</p>') },
        { name: 'big.css', text: `.big { color: red } ${'/* x */'.repeat(5000)}`, deflate: true },
        { name: 'ok.css', text: '.ok { color: blue }' },
        { name: 'big.png', text: 'P'.repeat(50_000), deflate: true },
        { name: 'ok.png', text: 'PNG' },
      ]);
      const book = await readEpub(zip, parse, { maxEntryBytes: 10_000 });
      expect(book.html).toContain('<p>一</p>');
      expect(book.html).toContain('<p>三</p>');
      expect(book.html).not.toContain('巨大');
      expect(book.html).toContain('.ok { color: blue }');
      expect(book.html).not.toContain('.big');
      // 同じファイルを指す item は 1 度だけ
      expect(book.images.map((i) => i.name)).toEqual(['ok.png']);
      expect(book.warnings).toHaveLength(3);
      expect(book.warnings!.join('\n')).toMatch(/big\.css[\s\S]*ch2\.xhtml[\s\S]*big\.png/);
      // 既定の上限なら、すべて読めて、警告は無い
      const all = await readEpub(zip, parse);
      expect(all.html).toContain('巨大');
      expect(all.images.map((i) => i.name)).toEqual(['big.png', 'ok.png']);
      expect(all.warnings).toBeUndefined();
    });

    it('EPUB: 合計の上限を超えたら、誤りで止める (spine に同じ章を何度も書いた EPUB も)', async () => {
      const zip = makeZip([
        CONTAINER,
        opf('<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>', '<itemref idref="c1"/>'.repeat(50)),
        { name: 'ch1.xhtml', text: chapter(`<p>${'a'.repeat(2000)}</p>`), deflate: true },
      ]);
      await expect(readEpub(zip, parse, { maxTotalBytes: 30_000 })).rejects.toThrow(/合計が上限/);
      // 章の並びの長さの上限
      await expect(readEpub(zip, parse, { maxEntries: 20 })).rejects.toThrow(/spine/);
      expect((await readEpub(zip, parse)).html.match(/<section/g)).toHaveLength(50);
    });

    it('EPUB: OPF が上限を超えるときは、誤りで止める', async () => {
      const zip = makeZip([CONTAINER, { ...opf(CH + '<!-- x -->'.repeat(5000), ''), deflate: true }]);
      await expect(readEpub(zip, parse, { maxEntryBytes: 10_000 })).rejects.toThrow(/content\.opf/);
    });

    it('項目の名前の ../ は、ほかの項目の突き合わせに影響しない (名前は表の鍵にするだけ)', async () => {
      const zip = makeZip([
        CONTAINER,
        opf('<item id="c1" href="t/ch1.xhtml" media-type="application/xhtml+xml"/><item id="i1" href="../../img/a.png" media-type="image/png"/><item id="i2" href="t/../../b.png" media-type="image/png"/>', '<itemref idref="c1"/>'),
        { name: 't/ch1.xhtml', text: chapter('<img src="../../../img/a.png"/>') },
        { name: '../../img/a.png', text: 'OUTSIDE' },
        { name: 'img/a.png', text: 'INSIDE' },
        { name: '../b.png', text: 'OUTSIDE' },
      ]);
      const book = await readEpub(zip, parse);
      // 参照は .. を解いた zip の中のパスになり (根より上へは出ない)、../ で始まる名前の項目には当たらない
      expect(book.html).toContain('src="img/a.png"');
      expect(book.images.map((i) => [i.name, new TextDecoder().decode(i.data)])).toEqual([['img/a.png', 'INSIDE']]);
    });
  });
});
