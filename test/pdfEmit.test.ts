/**
 * 組みながら確定したページを描画し、組版の途中の木を手放す作り (typesetToPdf・typesetToPdfStream。design/pdf-writer.md の 12) の確認:
 *  - 渡したページの領域の木が、手放さずに組み終えてから作った領域の木と同じ (emitProbe.keep。違えば、確定の決まりに漏れがある)
 *  - 組みながら描画した PDF が、typeset の後の toPdf (組み終えてから描画する) と、流して書いた PDF と、同じバイト列
 *  - 渡せない文書 (前向きの参照・画像・段組・最後のページのマスター) は渡さず、途中で渡せなくなった文書は、そこから後ろを組み終えてから描画する
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, typesetToPdf, typesetToPdfStream, type TypesetOptions } from '../src/index';
import { emitProbe } from '../src/layoutEngine';
import { ensureFonts, loadCachedFont } from './helpers';
import { REUSE_SHAPES, RESUME_SHAPES } from '../scripts/gen-stress-docs.mjs';

beforeAll(() => ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]), 300_000);
afterEach(() => {
  emitProbe.keep = false;
  emitProbe.emitted = 0;
  emitProbe.mismatches = [];
});

const para = 'これは、組みながらページを描く確かめのための文です。同じ文を繰り返して、段落の行を作ります。'.repeat(2);
const FO = (body: string, extra = '') =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="A" page-width="100mm" page-height="80mm" margin="10mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="A"${extra}><fo:static-content flow-name="xsl-region-before"><fo:block>p. <fo:page-number/> <fo:retrieve-marker retrieve-class-name="h"/></fo:block></fo:static-content><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 確認する文書と、渡すページの数の見込み (all: 全部のページ・none: 渡さない・some: 途中まで) */
const DOCS: Array<{ name: string; text: string; options: TypesetOptions; expect: 'all' | 'none' | 'some' }> = [
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
    name: '画像のある HTML (渡さない)',
    text: `<!doctype html><html><body>${Array.from({ length: 20 }, (_, i) => `<p>${para}</p>${i === 10 ? '<img src="a.svg" style="width: 2cm">' : ''}`).join('')}</body></html>`,
    options: { kind: 'html', files: [{ name: 'a.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>' }] },
    expect: 'none',
  },
  { name: 'グラデーションの背景のある HTML (渡さない)', text: `<!doctype html><html><body>${Array.from({ length: 20 }, (_, i) => `<p${i === 12 ? ' style="background: linear-gradient(red, blue)"' : ''}>${para}</p>`).join('')}</body></html>`, options: { kind: 'html' }, expect: 'none' },
];

describe('組みながら確定したページを描く (typesetToPdf・typesetToPdfStream)', () => {
  for (const d of DOCS)
    it(d.name, async () => {
      const options = { ...d.options, loadFont: loadCachedFont };
      const date = new Date(Date.UTC(2024, 0, 1));
      for (const tagged of [false, true]) {
        const pdfOptions = { date, ...(tagged ? { tagged: true } : {}) };
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
      }
    }, 120_000);
});
