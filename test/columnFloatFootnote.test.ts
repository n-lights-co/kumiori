/**
 * 段組のページの前方 float の中の脚注と id。
 * 段組の文書 (XSL-FO の region-body の column-count・HTML の column-count) で、脚注をページ全体 (全段を貫く下端) に置くとき、
 * 前方 float (fo:float float="before"・float: top) は、ページ全体の上端の領域に置く。その道では、float の中の行が持つ脚注を
 * ページに積んでいなかったので、脚注が警告なしに消え、float の中の id へのページ番号の参照も「?」になっていた
 * (1 段のページと、脚注を段ごとに置くとき (axf:footnote-position="column") は置いていた)。
 * XSL 1.1 §6.12.3: 脚注の本体は、参照を含む領域と同じページに置く。fo:float の中も同じ (§6.12.2)。
 * CSS GCPM 3 §2.2: 脚注の呼び出しのあるページの脚注の領域に置く
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetFo, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの字の並び (行の間は空白) と警告 */
async function run(src: string, fo: boolean): Promise<{ pages: string[]; warnings: string[] }> {
  const r = fo ? await typesetFo(src, { loadFont: loadCachedFont }) : await typesetHtml(src, { loadFont: loadCachedFont, style: 'ah' });
  const pages = r.areaTree.sheets.map((s) => {
    let t = '';
    const rec = (a: AreaNode) => {
      if (a.type === 'line') t += ' ';
      if (a.type === 'glyph') t += (a as GlyphArea).text;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s);
    return t;
  });
  return { pages, warnings: r.warnings };
}

const count = (pages: string[], w: string) => pages.reduce((a, p) => a + p.split(w).length - 1, 0);
const pageOf = (pages: string[], w: string) => pages.findIndex((p) => p.includes(w));

const fnFo = (k: number) => `<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>NOTE${k}</fo:block></fo:footnote-body></fo:footnote>`;
/** cols 段の XSL-FO。前方 float の中に脚注 n 個、後ろの本文に脚注 1 個。filler 行の本文を float の前に置く */
const fo = (cols: number, n: number, opts: { pos?: string; filler?: number } = {}) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-size="10pt">` +
  `<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="15mm">` +
  `<fo:region-body column-count="${cols}"${opts.pos ? ` axf:footnote-position="${opts.pos}"` : ''}/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">` +
  `<fo:block>See page <fo:page-number-citation ref-id="fl"/>.</fo:block>` +
  Array.from({ length: opts.filler ?? 0 }, (_, i) => `<fo:block>Line ${i}.</fo:block>`).join('') +
  `<fo:float float="before"><fo:block id="fl">FLOAT${Array.from({ length: n }, (_, i) => fnFo(i + 1)).join(' ')} end</fo:block></fo:float>` +
  `<fo:block>After body<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>BODYNOTE</fo:block></fo:footnote-body></fo:footnote>.</fo:block>` +
  `</fo:flow></fo:page-sequence></fo:root>`;

/** cols 段の HTML (--style ah の float: top)。前方 float の中に脚注 n 個、後ろの本文に脚注 1 個 */
const html = (cols: number, n: number, filler = 0) =>
  `<!doctype html><html lang="en"><head><style>@page { size: 148mm 210mm; margin: 15mm } body { margin: 0; font-size: 10pt; column-count: ${cols} } p { margin: 0 } .t { float: top } .f { float: footnote }</style></head><body>` +
  `<p>Before text.</p>` +
  Array.from({ length: filler }, (_, i) => `<p>Line ${i}.</p>`).join('') +
  `<div class="t">FLOAT${Array.from({ length: n }, (_, i) => `<span class="f">NOTE${i + 1}</span>`).join(' ')} end</div>` +
  `<p>After body<span class="f">BODYNOTE</span>.</p></body></html>`;

describe('段組のページの前方 float の中の脚注', () => {
  for (const cols of [2, 3])
    for (const n of [1, 2]) {
      it(`XSL-FO: ${cols} 段・float の中の脚注 ${n} 個は、float と同じページの脚注の領域に置く`, async () => {
        const { pages, warnings } = await run(fo(cols, n), true);
        for (let k = 1; k <= n; k++) {
          expect(count(pages, `NOTE${k}`), `NOTE${k}`).toBe(1);
          expect(pageOf(pages, `NOTE${k}`)).toBe(pageOf(pages, 'FLOAT'));
        }
        expect(count(pages, 'BODYNOTE')).toBe(1);
        // 脚注は、文書の順 (float の中の脚注の後に、後ろの本文の脚注)
        expect(pages[0].indexOf(`NOTE${n}`)).toBeLessThan(pages[0].indexOf('BODYNOTE'));
        expect(warnings).toEqual([]);
      });

      it(`HTML: ${cols} 段・float: top の中の脚注 ${n} 個は、float と同じページの脚注の領域に置く`, async () => {
        const { pages, warnings } = await run(html(cols, n), false);
        for (let k = 1; k <= n; k++) {
          expect(count(pages, `NOTE${k}`), `NOTE${k}`).toBe(1);
          expect(pageOf(pages, `NOTE${k}`)).toBe(pageOf(pages, 'FLOAT'));
          // 番号も文書の順 (float の中の脚注が先)
          expect(pages[0]).toContain(`${k}NOTE${k}`);
        }
        expect(pages[0]).toContain(`${n + 1}BODYNOTE`);
        expect(warnings.filter((w) => /脚注|footnote/i.test(w))).toEqual([]);
      });
    }

  it('XSL-FO: 2 ページ目に置く float の中の脚注は、2 ページ目に置く。float の中の id へのページ番号の参照も解ける', async () => {
    const { pages, warnings } = await run(fo(2, 1, { filler: 120 }), true);
    expect(pages.length).toBe(2);
    expect(pageOf(pages, 'FLOAT')).toBe(1);
    expect(count(pages, 'NOTE1')).toBe(1);
    expect(pageOf(pages, 'NOTE1')).toBe(1);
    expect(pages[0]).toContain('See page 2.');
    expect(warnings).toEqual([]);
  });

  it('HTML: 2 ページ目に置く float: top の中の脚注は、2 ページ目に置く', async () => {
    const { pages } = await run(html(2, 1, 120), false);
    expect(pages.length).toBe(2);
    expect(pageOf(pages, 'FLOAT')).toBe(1);
    expect(count(pages, 'NOTE1')).toBe(1);
    expect(pageOf(pages, 'NOTE1')).toBe(1);
  });

  it('XSL-FO: 脚注を段ごとに置く (axf:footnote-position="column") ときも、float の中の脚注を 1 度だけ置く', async () => {
    for (const cols of [2, 3]) {
      const { pages, warnings } = await run(fo(cols, 2, { pos: 'column' }), true);
      expect(count(pages, 'NOTE1')).toBe(1);
      expect(count(pages, 'NOTE2')).toBe(1);
      expect(count(pages, 'BODYNOTE')).toBe(1);
      expect(warnings).toEqual([]);
    }
  });

  it('1 段のページでも、float の中の脚注を 1 度だけ置く (前からの動き)', async () => {
    expect(count((await run(fo(1, 2), true)).pages, 'NOTE2')).toBe(1);
    expect(count((await run(html(1, 2), false)).pages, 'NOTE2')).toBe(1);
  });
});
