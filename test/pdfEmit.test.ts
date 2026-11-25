/**
 * 組みながら確定したページを描画し、組版の途中の木を手放す作り (typesetToPdf・typesetToPdfStream。design/pdf-writer.md の 12) の確認:
 *  - 渡したページの領域の木が、手放さずに組み終えてから作った領域の木と同じ (emitProbe.keep。違えば、確定の決まりに漏れがある)
 *  - 組みながら描画した PDF が、typeset の後の toPdf (組み終えてから描画する) と、流して書いた PDF と、同じバイト列
 *  - 渡せない文書 (前向きの参照・画像・段組・最後のページのマスター) は渡さず、途中で渡せなくなった文書は、そこから後ろを組み終えてから描画する
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, typesetToPdf, typesetToPdfStream, type TypesetOptions } from '../src/index';
import { emitProbe } from '../src/layoutEngine';
import { defaultFontBuffer, ensureFonts, loadCachedFont } from './helpers';
import { cbdt, colr0, cpal, withTables } from './colorFontBuilder';
import { REUSE_SHAPES, RESUME_SHAPES } from '../scripts/gen-stress-docs.mjs';
import { encodePngStored } from '../src/pixels';
import fs from 'node:fs';
import path from 'node:path';

beforeAll(() => ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]), 300_000);
afterEach(() => {
  emitProbe.keep = false;
  emitProbe.emitted = 0;
  emitProbe.mismatches = [];
});

const para = 'これは、組みながらページを描く確かめのための文です。同じ文を繰り返して、段落の行を作ります。'.repeat(2);
const FO = (body: string, extra = '') =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="A" page-width="100mm" page-height="80mm" margin="10mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="A"${extra}><fo:static-content flow-name="xsl-region-before"><fo:block>p. <fo:page-number/> <fo:retrieve-marker retrieve-class-name="h"/></fo:block></fo:static-content><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 試しの画像 (w × h の RGBA。opaque なら不透明。RGB の PNG は、展開せずにそのまま入れる形にする) */
const png = (w: number, h: number, seed: number, opaque: boolean) => {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (i * seed) & 255;
    rgba[i + 1] = (i >> 3) & 255;
    rgba[i + 2] = seed * 40;
    rgba[i + 3] = opaque ? 255 : (i >> 2) & 255;
  }
  return encodePngStored({ width: w, height: h, rgba } as never);
};
const conformanceImage = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'docs', 'conformance', 'html', 'images', name)));
const dataPng = `data:image/png;base64,${Buffer.from(png(4, 4, 3, false)).toString('base64')}`;
const IMAGE_FILES = [
  { name: 'a.png', data: png(40, 30, 1, true) },
  { name: 'b.png', data: png(20, 20, 2, false) },
  { name: 'woven.jpg', data: conformanceImage('woven.jpg') },
  { name: 'woven.png', data: conformanceImage('woven.png') },
  { name: 'c.svg', data: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20"><rect width="40" height="20" fill="teal"/><image width="10" height="10" xlink:href="${dataPng}"/><image x="20" width="10" height="10" xlink:href="b.png"/><text x="2" y="18" font-size="8">SVG の字</text></svg>` },
];
/** 画像のある HTML: ページごとに、初めて使う画像と、前のページで使った画像・グラデーションの背景を置く */
const imageHtml = (extra = '') =>
  `<!doctype html><html lang="ja"><body>${Array.from({ length: 24 }, (_, i) => `<p${i % 7 === 3 ? ' style="background: linear-gradient(red, blue)"' : ''}>${para}</p>${i % 4 === 1 ? `<img src="${['a.png', 'b.png', 'woven.jpg', 'c.svg', 'woven.png', 'a.png'][(i >> 2) % 6]}" alt="図" style="width: 2cm">` : ''}`).join('')}${extra}</body></html>`;

/** 確認する文書と、渡すページの数の見込み (all: 全部のページ・none: 渡さない・some: 途中まで) */
const DOCS: Array<{ name: string; text: string; options: TypesetOptions; pdf?: Record<string, unknown>; expect: 'all' | 'none' | 'some' }> = [
  { name: '文だけの HTML', text: `<!doctype html><html lang="ja"><body>${Array.from({ length: 60 }, (_, i) => `<h2>節 ${i + 1}</h2><p>${para}</p>`).join('')}</body></html>`, options: { kind: 'html' }, expect: 'all' },
  {
    name: '柱・マーカー・後ろから前への参照・行番号のある XSL-FO',
    text: FO(Array.from({ length: 40 }, (_, i) => `<fo:block id="b${i}" axf:line-number="show"><fo:marker marker-class-name="h">H${i}</fo:marker>見出し ${i} ${i >= 3 ? `(<fo:page-number-citation ref-id="b${i - 3}"/>)` : ''}</fo:block><fo:block axf:line-number="show">${para}</fo:block>`).join('')),
    options: { kind: 'fo' },
    expect: 'all',
  },
  {
    name: '途中に前向きの参照のある HTML (参照のあるページから後ろは、組み終えてから描く)',
    text: `<!doctype html><html lang="ja"><body>${Array.from({ length: 50 }, (_, i) => `<h2 id="s${i}">節 ${i + 1}</h2><p>${para}${i === 25 ? '<a href="#s49">最後の節</a>' : ''}</p>`).join('')}<style>a::after { content: " (" target-counter(attr(href), page) ")" }</style></body></html>`,
    options: { kind: 'html' },
    expect: 'some',
  },
  { name: '章ごとの page-sequence と脚注 (XSL-FO)', text: REUSE_SHAPES.fofootnotes.make(4), options: { kind: 'fo' }, expect: 'all' },
  { name: '初めに目次のある HTML (渡さない)', text: REUSE_SHAPES.toc.make(8), options: { kind: 'html' }, expect: 'none' },
  { name: '最後のページのマスターのある XSL-FO (渡さない)', text: RESUME_SHAPES.focollapsetable.make(3), options: { kind: 'fo' }, expect: 'none' },
  {
    name: 'SVG の画像のある HTML',
    text: `<!doctype html><html><body>${Array.from({ length: 20 }, (_, i) => `<p>${para}</p>${i === 10 ? '<img src="a.svg" style="width: 2cm">' : ''}`).join('')}</body></html>`,
    options: { kind: 'html', files: [{ name: 'a.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>' }] },
    expect: 'all',
  },
  { name: 'グラデーションの背景のある HTML', text: `<!doctype html><html><body>${Array.from({ length: 20 }, (_, i) => `<p${i === 12 ? ' style="background: linear-gradient(red, blue)"' : ''}>${para}</p>`).join('')}</body></html>`, options: { kind: 'html' }, expect: 'all' },
  { name: 'PNG (α 付き・α 無し)・JPEG・中に画像と文字のある SVG・グラデーションのある HTML', text: imageHtml(), options: { kind: 'html', files: IMAGE_FILES }, expect: 'all' },
  { name: '同じ画像を、ファイル名と別の書き方で指す HTML', text: imageHtml('<img src="./sub/../a.png" style="width: 1cm"><div style="background: url(b.png); height: 1cm"></div>'), options: { kind: 'html', files: IMAGE_FILES }, expect: 'all' },
  { name: '置く大きさで縮める JPEG のある HTML (imageMaxDpi。渡さない)', text: imageHtml(), options: { kind: 'html', files: IMAGE_FILES }, pdf: { imageMaxDpi: 30 }, expect: 'none' },
  // ページをまたぐ、中の絶対配置の箱の基準の箱・position: relative でずらす箱: 箱を閉じるときに断片を書き換えるので、閉じるまでページを渡さない
  // (閉じた後に渡す。前は、閉じる前に渡したページから、絶対配置の箱が抜け、ずらしが当たらなかった)
  ...(() => {
    const ps = (n: number) => Array.from({ length: n }, () => `<p>${para}</p>`).join('');
    const html = (body: string) => `<!doctype html><html lang="ja"><body>${ps(2)}${body}${ps(6)}</body></html>`;
    return [
      { name: 'ページをまたぐ position: relative の箱の中の、top の絶対配置の箱', text: html(`<div style="position: relative; border: 1px solid">${ps(60)}<div style="position: absolute; top: 0; right: 0; background: yellow">TOP-ABS</div></div>`) },
      { name: 'ページをまたぐ position: relative の箱の中の、static position の絶対配置の箱', text: html(`<div style="position: relative">${ps(8)}<span style="position: absolute">STATIC-ABS</span>${ps(40)}</div>`) },
      { name: 'ページをまたぐ、ずらしのある position: relative の箱', text: html(`<div style="position: relative; left: 10mm; top: 15mm">${ps(60)}</div>`) },
      { name: '飾りの絶対配置の箱を持つ、本文の全体を包む main', text: `<!doctype html><html lang="ja"><body><main style="position: relative">${ps(80)}<div style="position: absolute; bottom: 0; left: 0">BOTTOM-ABS</div></main></body></html>` },
    ].map((d) => ({ ...d, options: { kind: 'html' as const }, expect: 'all' as const }));
  })(),
  { name: 'systemLanguage のある SVG の画像のある HTML (渡さない)', text: imageHtml('<img src="l.svg" style="width: 1cm">'), options: { kind: 'html', files: [...IMAGE_FILES, { name: 'l.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><switch><rect systemLanguage="ja" width="10" height="10" fill="red"/><rect width="10" height="10" fill="blue"/></switch></svg>' }] }, expect: 'none' },
];

/** 色つきの書体 (Tinos の表を差し替えたもの): A を COLR の色の重ね、B を CBDT のビットマップ (PNG) にする */
async function colorFonts() {
  const tinos = await defaultFontBuffer('Tinos-Regular.ttf');
  const fk = (await import('@pdf-lib/fontkit')).default.create(new Uint8Array(tinos)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
  const gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
  const colr = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0], [gid('C'), 1]] }]), CPAL: cpal([[[255, 0, 0, 255], [0, 128, 0, 255]]]) });
  const bitmap = withTables(tinos, cbdt(gid('B'), png(8, 8, 5, false), { ppem: 16, width: 8, height: 8, bearingX: 0, bearingY: 8, advance: 9 }));
  return { colr, bitmap };
}

describe('組みながら確定したページを描く (typesetToPdf・typesetToPdfStream)', () => {
  it('色つきの書体 (COLR の色の重ねは全部のページ、CBDT のビットマップの字のあるページから後ろは組み終えてから描く)', async () => {
    const { colr, bitmap } = await colorFonts();
    const date = new Date(Date.UTC(2024, 0, 1));
    const body = (font: string) => `<!doctype html><html><body>${Array.from({ length: 80 }, (_, i) => `<p>${para}</p>${i === 45 || i === 70 ? `<p style="font-family: ${font}">AB ${i}</p>` : ''}`).join('')}</body></html>`;
    for (const [font, data, expectAll] of [['ColrTest', colr, true], ['BitmapTest', bitmap, false]] as const) {
      const options = { kind: 'html' as const, loadFont: loadCachedFont, fonts: [{ name: `${font}.ttf`, data, family: font }], files: IMAGE_FILES };
      const text = body(font).replace('</body>', '<img src="a.png" style="width: 1cm"></body>');
      const whole = await (await typeset(text, options)).toPdf({ date });
      emitProbe.keep = true;
      emitProbe.emitted = 0;
      const r = await typesetToPdf(text, options, { date });
      emitProbe.keep = false;
      if (expectAll) expect(emitProbe.emitted).toBe(r.pageCount);
      else {
        expect(emitProbe.emitted).toBeGreaterThan(0);
        expect(emitProbe.emitted).toBeLessThan(r.pageCount);
      }
      expect(Buffer.from(r.pdf).equals(Buffer.from(whole)), font).toBe(true);
      const chunks: Uint8Array[] = [];
      await typesetToPdfStream(text, options, (c) => void chunks.push(c.slice()), { date });
      expect(Buffer.concat(chunks).equals(Buffer.from(r.pdf)), `stream ${font}`).toBe(true);
      const low = await typesetToPdf(text, options, { date, lowMemory: true });
      expect(Buffer.from(low.pdf).equals(Buffer.from(r.pdf)), `lowMemory ${font}`).toBe(true);
    }
  }, 120_000);

  for (const d of DOCS)
    it(d.name, async () => {
      const options = { ...d.options, loadFont: loadCachedFont };
      const date = new Date(Date.UTC(2024, 0, 1));
      for (const tagged of [false, true]) {
        const pdfOptions = { date, ...d.pdf, ...(tagged ? { tagged: true } : {}) };
        const whole = await (await typeset(d.text, options)).toPdf(pdfOptions);
        emitProbe.keep = true;
        emitProbe.emitted = 0;
        emitProbe.mismatches = [];
        const r = await typesetToPdf(d.text, options, pdfOptions);
        expect(emitProbe.mismatches).toEqual([]);
        const emitted = emitProbe.emitted;
        if (d.expect === 'all') expect(emitted).toBe(r.pageCount);
        else if (d.expect === 'none') expect(emitted).toBe(0);
        else {
          expect(emitted).toBeGreaterThan(0);
          expect(emitted).toBeLessThan(r.pageCount);
        }
        emitProbe.keep = false;
        // 組み終えてから描画した PDF と同じバイト列 (フォントを、初めて使うページの前で埋め込む並びが、どちらの道でも同じ)
        expect(Buffer.from(r.pdf).equals(Buffer.from(whole)), `tagged=${tagged}`).toBe(true);
        const chunks: Uint8Array[] = [];
        const s = await typesetToPdfStream(d.text, options, (c) => void chunks.push(c.slice()), pdfOptions);
        expect(s.pageCount).toBe(r.pageCount);
        expect(Buffer.concat(chunks).equals(Buffer.from(r.pdf)), `stream tagged=${tagged}`).toBe(true);
        // メモリ節約 (組み直しの回を、もう 1 度組んで描画する) も同じバイト列
        const low = await typesetToPdf(d.text, options, { ...pdfOptions, lowMemory: true });
        expect(Buffer.from(low.pdf).equals(Buffer.from(r.pdf)), `lowMemory tagged=${tagged}`).toBe(true);
      }
    }, 120_000);
});
