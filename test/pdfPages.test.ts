/**
 * PDF だけを作る API (typesetToPdf・Typesetter.typesetToPdf。ページを 1 枚ずつ領域の木にして書き、書いたページを手放す) が、
 * typeset の後に toPdf を呼ぶのと同じ PDF・警告・ページ数を出すこと。Node のコマンドも typesetToPdf で PDF を作る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, fill, popGraphicsState, pushGraphicsState, rectangle, setFillingRgbColor } from 'pdf-lib';
import { sealPageContents } from '../src/pdfLibPatches';
import { writePdf } from '../src/pdfWriter';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, createTypesetter, typeset, typesetToPdf, walkAreaTree, type FontSpec, type PdfOptions, type TypesetOptions } from '../src/index';
import { colr0, cpal, withTables } from './colorFontBuilder';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf, renderPdfPages } from '../src/pdfRenderer';
import { parseArgs, USAGE_EN, USAGE_JA } from '../src/cli';
import { AssetStore } from '../src/assets';
import { defaultFontBuffer, ensureFonts, fontFileName, fontDir, makeEngine } from './helpers';
import path from 'node:path';

const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, fontFileName(spec));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(() => ensureFonts([...DEFAULT_FONTS.base, DEFAULT_FONTS.symbol]), 300_000);

/**
 * PDF の中身を比べられる形にする: ストリームを展開して並べる。作った日時 (Info の CreationDate・ModDate) と、相互参照の表のストリーム
 * (乱数で作る文書の ID と、日時の文字列の長さで変わる位置を持つ) は除く
 */
function contents(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g)) {
    if (/\/Type\s*\/XRef/.test(m[2])) continue;
    const len = Number(/\/Length (\d+)/.exec(m[2])![1]);
    const start = m.index! + m[0].length;
    let data = Buffer.from(pdf.subarray(start, start + len));
    if (/\/FlateDecode/.test(m[2])) data = inflateSync(data);
    // 日時は、ストリームの中 (オブジェクトストリームの中の Info) にも、ストリームの外 (PDF/X-3 はオブジェクトストリームを使わない) にもある
    out.push(`${m[1]} ${m[2].replace(/\/Length \d+/, '')}\n${data.toString('latin1')}`.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, ''));
  }
  return out;
}

const png = (w: number, h: number) => `data:image/png;base64,${Buffer.from(encodePngStored({ width: w, height: h, rgba: new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)) })).toString('base64')}`;

async function same(text: string, options: TypesetOptions, pdfOptions: PdfOptions = {}) {
  const r = await typeset(text, { loadFont, ...options });
  const whole = await r.toPdf(pdfOptions);
  const pages = await typesetToPdf(text, { loadFont, ...options }, pdfOptions);
  expect(pages.pageCount).toBe(r.pageCount);
  expect(pages.warnings).toEqual(r.warnings);
  const a = contents(whole);
  const b = contents(pages.pdf);
  expect(b.length).toBe(a.length);
  expect(b).toEqual(a);
  // メモリ節約 (lowMemory): 組み直しで前の回のページを使い回さないが、同じ PDF・警告・ページ数
  const low = await typesetToPdf(text, { loadFont, ...options }, { ...pdfOptions, lowMemory: true });
  expect(low.pageCount).toBe(r.pageCount);
  expect(low.warnings).toEqual(r.warnings);
  expect(contents(low.pdf)).toEqual(a);
  return { r, pages };
}

const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';

/** typeset + toPdf・typesetToPdf・typesetToPdf の lowMemory の 3 つの道で作った PDF */
async function threeWays(text: string, options: TypesetOptions): Promise<Uint8Array[]> {
  const r = await typeset(text, { loadFont, ...options });
  return [await r.toPdf(), (await typesetToPdf(text, { loadFont, ...options })).pdf, (await typesetToPdf(text, { loadFont, ...options }, { lowMemory: true })).pdf];
}

/**
 * ページごとの、実際に描いた画像の数: 内容の流れの Do が指す XObject のうち、画像 (Subtype が Image) のもの。
 * Form XObject (SVG の図・不透明度のグループなど) は、その中の Do もたどる
 */
async function drawnImages(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const streamText = (s: unknown): string => {
    const raw = s as PDFRawStream & { contents: Uint8Array };
    const data = raw.dict.get(PDFName.of('Filter')) ? inflateSync(raw.contents) : Buffer.from(raw.contents);
    return Buffer.from(data).toString('latin1');
  };
  const count = (text: string, resources: PDFDict | undefined): number => {
    const xo = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    let n = 0;
    for (const m of text.matchAll(/\/([^\s/<>[\]()]+)\s+Do\b/g)) {
      const x = xo?.lookup(PDFName.of(m[1]));
      if (!(x instanceof PDFRawStream)) continue;
      const sub = x.dict.get(PDFName.of('Subtype'));
      if (sub === PDFName.of('Image')) n++;
      else if (sub === PDFName.of('Form')) n += count(streamText(x), x.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources);
    }
    return n;
  };
  return doc.getPages().map((p) => {
    const c = p.node.Contents();
    const list = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    const text = list.map((r) => streamText(ctx.lookup(r))).join('\n');
    return count(text, p.node.Resources());
  });
}

describe('typesetToPdf (ページごとに書く PDF) は、typeset + toPdf と同じ', () => {
  it('XSL-FO: 目次のページ番号の参照 (組み直し)・しおり・文書内リンク・柱とマーカー・脚注・画像・リーダー、見つからない参照先の警告', async () => {
    const chapters = [1, 2, 3].map(
      (n) =>
        `<fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before"><fo:block>Chapter <fo:retrieve-marker retrieve-class-name="c"/> / <fo:page-number/></fo:block></fo:static-content>` +
        `<fo:flow flow-name="xsl-region-body"><fo:block id="ch${n}" font-size="14pt"><fo:marker marker-class-name="c">${n}</fo:marker>Chapter ${n}</fo:block>` +
        `<fo:block><fo:external-graphic src="url(${png(4, 3)})" content-width="${n * 20}pt"/>See <fo:basic-link internal-destination="ch${(n % 3) + 1}">chapter ${(n % 3) + 1}</fo:basic-link> on page <fo:page-number-citation ref-id="ch${(n % 3) + 1}"/>.` +
        `<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>Note ${n}</fo:block></fo:footnote-body></fo:footnote></fo:block>` +
        Array.from({ length: 30 }, (_, k) => `<fo:block>Line ${k + 1} of chapter ${n}. 日本語の行も組む。</fo:block>`).join('') +
        `</fo:flow></fo:page-sequence>`,
    );
    const toc = `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${[1, 2, 3].map((n) => `<fo:block text-align-last="justify">Chapter ${n}<fo:leader leader-pattern="dots" leader-alignment="reference-area"/><fo:page-number-citation ref-id="ch${n}"/></fo:block>`).join('')}<fo:block>Missing <fo:page-number-citation ref-id="nowhere"/></fo:block></fo:flow></fo:page-sequence>`;
    const fo =
      `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="120mm" page-height="80mm" margin="8mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:bookmark-tree>${[1, 2, 3].map((n) => `<fo:bookmark internal-destination="ch${n}"><fo:bookmark-title>Chapter ${n}</fo:bookmark-title></fo:bookmark>`).join('')}<fo:bookmark internal-destination="gone"><fo:bookmark-title>Gone</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>` +
      toc + chapters.join('') + '</fo:root>';
    const { r } = await same(fo, { kind: 'fo' });
    expect(r.pageCount).toBeGreaterThan(5);
    expect(r.warnings.some((w) => w.includes('nowhere'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('gone'))).toBe(true);
  });

  it('XSL-FO・HTML: 1 回目の仮の値が、ページごとに違う桁数で混じる参照 (2〜12 ページから 13 ページを指す): 前の回のページを使い回しても、使い回さないときと同じ PDF', async () => {
    // 1 回目は、まだ置いていない参照先の仮の値を、引いたページの番号にする (2〜9 は 1 桁、10〜12 は 2 桁)。2 回目の値「13」と桁数の違う
    // 仮の値の参照は、字だけを差し替えずに組み直す (同じ桁数の仮の値の参照は、字だけを差し替えてよい)
    const pages = (n: number, f: (k: number) => string) => Array.from({ length: n }, (_, k) => `<fo:block${k ? ' break-before="page"' : ''}>${f(k)}</fo:block>`).join('');
    const seqs = ['Front', pages(11, (k) => `Page ${k + 2} see <fo:basic-link internal-destination="c2">p.<fo:page-number-citation ref-id="c2"/></fo:basic-link>`), '<fo:block id="c2">Chapter 2</fo:block>'];
    const fo =
      `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      seqs.map((b) => `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt">${b}</fo:flow></fo:page-sequence>`).join('') +
      '</fo:root>';
    const { r } = await same(fo, { kind: 'fo' });
    expect(r.pageCount).toBe(13);
    const html =
      `<style>@page { size: 100mm 60mm; margin: 10mm } section { break-before: page } a.c::after { content: target-counter(attr(href), page) }</style>` +
      `<section>Front</section>` +
      Array.from({ length: 11 }, (_, k) => `<section>Page ${k + 2} see <a class="c" href="#end">p.</a></section>`).join('') +
      `<section id="end">End</section>`;
    const h = await same(html, { kind: 'html' });
    expect(h.r.pageCount).toBe(13);
  });

  it('HTML: 字の組の詰め (font-kerning) のある参照の字を差し替えるときも、使い回さないときと同じ PDF (前後の字との詰めは、字で変わる)', async () => {
    // 10〜12 ページから 14 ページを指す。1 回目の仮の値 (10〜12) と 2 回目の値 (14) は桁数が同じでも、「.」「A」との詰めが違う
    const html =
      `<style>@page { size: 100mm 60mm; margin: 10mm } body { font-kerning: normal; font-family: serif } section { break-before: page } a.c::after { content: target-counter(attr(href), page) }</style>` +
      Array.from({ length: 9 }, (_, k) => `<section>F${k}</section>`).join('') +
      Array.from({ length: 3 }, (_, k) => `<section>Page ${k + 10} see <a class="c" href="#end">p.</a>V, A<a class="c" href="#end">7</a>Y</section>`).join('') +
      `<section>Pad</section><section id="end">End</section>`;
    const { r } = await same(html, { kind: 'html' });
    expect(r.pageCount).toBe(14);
  });

  it('HTML: 複数のページのグラデーションの背景 (登録する画像の名前)・transform・opacity・柱のページ番号・リンク・大きさの違う同じ画像', async () => {
    const img = png(6, 4);
    const html =
      `<style>@page { size: 120mm 90mm; margin: 12mm; @top-center { content: "p. " counter(page) } } section { break-before: page } .g1 { background: linear-gradient(red, blue); height: 30px } .g2 { background: linear-gradient(90deg, green, yellow); height: 20px } .t { transform: rotate(10deg); opacity: 0.5 }</style>` +
      [1, 2, 3, 4]
        .map((n) => `<section id="s${n}"><h1>Section ${n}</h1><div class="${n % 2 ? 'g1' : 'g2'}"></div><p class="t">Turned ${n}</p><p><a href="#s${(n % 4) + 1}">next</a> <img src="${img}" style="width: ${n * 15}px"></p><p>${'Text. '.repeat(40)}</p></section>`)
        .join('');
    const { r } = await same(html, { kind: 'html' });
    expect(r.pageCount).toBeGreaterThanOrEqual(4);
  });

  it('ファイルで渡した画像 (中身を関数で渡す)・その画像を中から参照する SVG・foreignObject の中から参照する SVG・無い画像を参照する SVG: PDF に埋め込んだ画像の中身を捨てても、組み直しで「読めない画像」にならない', async () => {
    const pngBytes = Buffer.from(png(5, 5).split(',')[1], 'base64');
    let reads = 0;
    const svg = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#ccc"/><image xlink:href="${href}" x="5" y="5" width="30" height="30"/></svg>`;
    const files = [
      { name: 'a.png', data: async () => (reads++, new Uint8Array(pngBytes)) },
      { name: 'b.svg', data: async () => svg('a.png') },
      { name: 'c.svg', data: async () => svg('gone.png') },
      // foreignObject の中身 (HTML) から参照する画像 (前もって分からないので、元はすべて最後まで残す)
      { name: 'd.svg', data: async () => `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40"><foreignObject x="0" y="0" width="60" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><img src="e.png" width="30"/></div></foreignObject></svg>` },
      { name: 'e.png', data: async () => new Uint8Array(Buffer.from(png(7, 3).split(',')[1], 'base64')) },
    ];
    const seqs = [1, 2, 3]
      .map((n) => `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>Part ${n} <fo:page-number-citation ref-id="p${(n % 3) + 1}"/></fo:block><fo:block id="p${n}"><fo:external-graphic src="url(a.png)" content-width="${20 * n}pt"/><fo:external-graphic src="url(b.svg)"/><fo:external-graphic src="url(c.svg)"/><fo:external-graphic src="url(e.png)" content-width="${10 * n}pt"/><fo:external-graphic src="url(d.svg)"/></fo:block></fo:flow></fo:page-sequence>`)
      .join('');
    const fo = `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="80mm" margin="8mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>${seqs}</fo:root>`;
    const { r } = await same(fo, { kind: 'fo', name: 'doc.fo', files });
    // 無い画像の警告は出る (捨てた a.png は、読めない画像にならない)
    expect(r.warnings.some((w) => w.includes('gone.png'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('a.png'))).toBe(false);
    expect(reads).toBeGreaterThan(0);
  });

  it('同じ画像を別の書き方で指す参照 (大文字と小文字・./・#fragment・サブディレクトリ・SVG の中と外): 3 つの道のどれでも、どのページにも画像を描く', async () => {
    const pngBytes = Buffer.from(png(5, 5).split(',')[1], 'base64');
    const svg = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40" viewBox="0 0 40 40"><image xlink:href="${href}" x="5" y="5" width="30" height="30"/></svg>`;
    const doc = (refs: string[]) =>
      `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="60mm" margin="8mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      refs.map((s) => `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:external-graphic src="${s.replace(/"/g, '&quot;')}" content-width="20pt"/></fo:block></fo:flow></fo:page-sequence>`).join('') +
      '</fo:root>';
    for (const refs of [
      // ファイル名で同じ画像に当たる参照 (SVG の無い文書)
      ['url(a.png)', 'url(sub/a.png)', 'url(A.PNG)', 'url(./a.png#x)', 'url("a.png")'],
      // SVG の中から参照する画像を、外からも別の書き方で参照する (SVG が先・後)
      ['url(b.svg)', 'url(A.PNG)', 'url(sub/a.png)'],
      ['url(sub/a.png)', 'url(b.svg)', 'url(a.png)'],
    ])
      for (const data of [(b: Uint8Array) => b, (b: Uint8Array) => async () => b]) {
        const files = [
          { name: 'a.png', data: data(new Uint8Array(pngBytes)) },
          // SVG の中から、外と違う書き方 (大文字) で同じ画像を指す
          { name: 'b.svg', data: svg('A.PNG') },
        ];
        expect(await Promise.all((await threeWays(doc(refs), { kind: 'fo', name: 'doc.fo', files })).map(drawnImages))).toEqual([0, 1, 2].map(() => refs.map(() => 1)));
      }
  });

  it('HTML: img (./・#fragment の付いた参照) と、CSS のファイルの url() (../ の付いた参照) が同じ画像を指す: 3 つの道のどれでも、3 か所とも描く', async () => {
    const pngBytes = Buffer.from(png(6, 6).split(',')[1], 'base64');
    const files = [
      { name: 'images/a.png', data: async () => new Uint8Array(pngBytes) },
      { name: 'css/s.css', data: '.bg { background: url(../images/a.png) no-repeat; background-size: 30px 30px; width: 30px; height: 30px }' },
    ];
    const html = `<link rel="stylesheet" href="css/s.css"><style>@page { size: 100mm 60mm; margin: 8mm } p { break-after: page }</style><p><img src="images/a.png" width="30"></p><p><img src="./images/a.png#x" width="30"></p><div class="bg"></div>`;
    expect(await Promise.all((await threeWays(html, { kind: 'html', name: 'r/r.html', files })).map(drawnImages))).toEqual([0, 1, 2].map(() => [1, 1, 1]));
  });

  it('画像の置き場の releaseImageBytes: 同じ中身の登録 (別の名前) もまとめて捨て、印を付ける。SVG は捨てない', async () => {
    const store = new AssetStore();
    const bytes = Buffer.from(png(3, 3).split(',')[1], 'base64');
    const a = await store.addBlob('img/a.png', new Blob([bytes]));
    store.register('https://example.com/a.png?x=1', { ...a! });
    const svgAsset = await store.addBlob('s.svg', new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`], { type: 'image/svg+xml' }));
    store.releaseImageBytes(['img/a.png', 's.svg']);
    for (const src of ['img/a.png', 'a.png', 'https://example.com/a.png?x=1']) {
      expect(store.get(src)?.bytes).toBeUndefined();
      expect(store.get(src)?.released).toBe(true);
      expect(store.get(src)?.width).toBe(a!.width);
    }
    expect(store.get('s.svg')?.bytes?.length).toBe(svgAsset!.bytes!.length);
    expect(store.get('s.svg')?.released).toBeUndefined();
  });

  it('色つきの字 (COLR の書体) の文書、PDF/X-3 の出力', async () => {
    const tinos = await defaultFontBuffer('Tinos-Regular.ttf');
    const fk = (await import('@pdf-lib/fontkit')).default.create(new Uint8Array(tinos)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
    const gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
    const color = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0], [gid('C'), 0xffff]] }]), CPAL: cpal([[[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 255, 255]]]) });
    const html = `<p style="font-family: Tinos">AAA ZZZ</p><p style="break-before: page">A again, 和文も</p>`;
    await same(html, { kind: 'html', fonts: [{ name: 'color.ttf', data: color }] });
    // PDF/X-3 (灰色の字を K だけで書く・透明の警告・ページの中のリンクを書かない)。PDF/X の警告も同じ
    const w1: string[] = [];
    const w2: string[] = [];
    const html2 = '<p style="color: #444">PDF/X <a href="https://example.com/">link</a> <span style="opacity: 0.5">faded</span></p><p style="break-before: page">2</p>';
    const r = await typeset(html2, { loadFont, kind: 'html' });
    const whole = await r.toPdf({ pdfx: { version: 'X-3', warnings: w1 } });
    const pages = await typesetToPdf(html2, { loadFont, kind: 'html' }, { pdfx: { version: 'X-3', warnings: w2 } });
    expect(contents(pages.pdf)).toEqual(contents(whole));
    expect(pages.warnings).toEqual(r.warnings);
    expect(w2).toEqual(w1);
    expect(w1.length).toBeGreaterThan(0);
  });

  it('器 (createTypesetter) の typesetToPdf も、器の typeset + toPdf と同じ。器を作るときの設定を文書ごとに渡すと、typeset と同じく警告する', async () => {
    const t = await createTypesetter({ loadFont });
    const html = '<h1>Title</h1><p>Text <a href="#x">link</a></p><p id="x" style="break-before: page">Target</p>';
    const r = await t.typeset(html, { kind: 'html' });
    const p = await t.typesetToPdf(html, { kind: 'html' }, { title: 'T' });
    expect(contents(p.pdf)).toEqual(contents(await r.toPdf({ title: 'T' })));
    expect(p.warnings).toEqual(r.warnings);
    expect(p.pageCount).toBe(2);
    // loadFont は器を作るときの設定 (文書ごとの設定の型には無い)
    const w = await t.typesetToPdf(html, { kind: 'html', loadFont } as never);
    expect(w.warnings[0]).toContain('Typesetter.typesetToPdf');
    expect((await t.typeset(html, { kind: 'html', loadFont } as never)).warnings[0]).toContain('Typesetter.typeset ');
  });

  it('ページの出どころが集め直しの合図 (restart) を出したら、それまでに集めた書体・画像を捨てる (メモリ節約で、組み直しの回が決まらなかったとき)', async () => {
    const E = await makeEngine();
    await E.fonts.registerBuffer('Tinos', 400, await defaultFontBuffer('Tinos-Regular.ttf'), false);
    const tree = (fo: string) => E.engine.layout(importXslFo(fo, (x) => new DOMParser().parseFromString(x, 'text/xml') as never, { compat: 'spec' }).document);
    const page = (body: string) => `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
    const real = tree(page('<fo:block>Real page.</fo:block>'));
    // 捨てる回のページ: 本当のページで使わない書体の字を置く (集め直さないと、使わない書体まで埋め込む)。
    // 本当のページを写して、字の書体を変えたもの (渡すだけで、描かない)
    const discarded = structuredClone(real);
    walkAreaTree(discarded, (a) => {
      if (a.type === 'glyph') a.fontFamily = 'Tinos';
    });
    // 捨てる回のページの字は、本当のページと違う書体で組んでいる
    const families = (t: typeof real) => {
      const out = new Set<string>();
      walkAreaTree(t, (a) => void (a.type === 'glyph' && out.add(a.fontFamily)));
      return out;
    };
    expect([...families(discarded)].some((f) => !families(real).has(f))).toBe(true);
    const expected = contents(await renderPdf(real, E.fonts));
    const each = (t: typeof real) => (visit: (s: (typeof real)['sheets'][number]) => void) => t.sheets.forEach((s) => visit(s));
    const got = await renderPdfPages(
      {
        title: real.title,
        scan: (visit, restart) => {
          each(discarded)(visit);
          restart();
          each(real)(visit);
        },
        paint: each(real),
        finish: () => real,
      },
      E.fonts,
    );
    expect(contents(got)).toEqual(expected);
  });

  it('コマンドの --low-memory は、typesetToPdf の lowMemory にする (既定は使わない)。使い方の文に載っている', () => {
    expect(parseArgs(['a.fo']).lowMemory).toBe(false);
    expect(parseArgs(['a.fo', '--low-memory']).lowMemory).toBe(true);
    for (const u of [USAGE_JA, USAGE_EN]) expect(u.split('\n').filter((l) => l.includes('--low-memory')).length).toBeGreaterThanOrEqual(3);
  });

  it('描き終えたページの命令を圧縮したバイト列にしても (sealPageContents)、書き出す PDF は同じ。その後でページに描こうとすると誤り', async () => {
    const make = async (seal: boolean, deflate?: (b: Uint8Array) => Uint8Array) => {
      const pdf = await PDFDocument.create({ updateMetadata: false });
      for (let k = 0; k < 3; k++) {
        const page = pdf.addPage([200, 200]);
        page.pushOperators(pushGraphicsState(), setFillingRgbColor(k / 3, 0, 0), rectangle(10 * k, 10, 50, 50), fill(), popGraphicsState());
        if (seal) sealPageContents(pdf, page, deflate);
      }
      return writePdf(pdf, deflate ? { deflate } : {});
    };
    expect(Buffer.from(await make(true)).equals(Buffer.from(await make(false)))).toBe(true);
    expect(Buffer.from(await make(true, (b) => deflateSync(b))).equals(Buffer.from(await make(false, (b) => deflateSync(b))))).toBe(true);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    page.pushOperators(pushGraphicsState(), popGraphicsState());
    sealPageContents(pdf, page);
    expect(() => page.pushOperators(pushGraphicsState())).toThrow(/sealPageContents/);
  });

  it('sealPageContents の後、ページの内容の流れは圧縮したバイト列 (PDFRawStream) に置き換わり、命令を持たない。pdf-lib の形が変わったら誤りにする', async () => {
    for (const deflate of [undefined, (b: Uint8Array) => deflateSync(b)]) {
      const pdf = await PDFDocument.create({ updateMetadata: false });
      const page = pdf.addPage([200, 200]);
      page.pushOperators(pushGraphicsState(), setFillingRgbColor(1, 0, 0), rectangle(10, 10, 50, 50), fill(), popGraphicsState());
      const contentsRef = () => {
        const c = page.node.Contents();
        return c instanceof PDFArray ? c.get(0) : c;
      };
      const ref = contentsRef()!;
      const before = pdf.context.lookup(ref);
      expect(before).not.toBeInstanceOf(PDFRawStream);
      sealPageContents(pdf, page, deflate);
      // 同じ番号のまま、圧縮したバイト列の流れになる (命令の並びを手放す)
      expect(contentsRef()).toBe(ref);
      const after = pdf.context.lookup(ref);
      expect(after).toBeInstanceOf(PDFRawStream);
      expect((after as PDFRawStream).dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
      expect(Buffer.from(inflateSync((after as PDFRawStream).contents)).toString('latin1')).toMatch(/q\s+1 0 0 rg\s+10 10 50 50 re\s+f\s+Q/);
      // ページは命令の並びを持たない (印に替わる。中を見ると誤りになるので、同じものかだけを見る)
      expect((page as unknown as { contentStream: unknown }).contentStream === before).toBe(false);
    }
    // 何も描いていないページは、置き換えるものが無い (誤りにしない)
    const empty = (await PDFDocument.create()).addPage([10, 10]);
    expect(() => sealPageContents(empty.doc, empty)).not.toThrow();
    // pdf-lib の欄が見つからない (版が変わった) ときは、黙って何もしないのでなく、誤りにする
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 100]);
    page.pushOperators(pushGraphicsState(), popGraphicsState());
    delete (page as unknown as { contentStreamRef?: unknown }).contentStreamRef;
    expect(() => sealPageContents(pdf, page)).toThrow(/pdf-lib .*contentStream/);
  });
});
