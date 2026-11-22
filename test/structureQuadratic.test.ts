/**
 * タグ付き PDF の構造の木を作る手間が、表の大きさの 2 乗にならないこと (時間の上限つき。上限は、直す前の手間の数分の 1):
 *  - HTML: 1 行に見出しのセル (th) を多く並べた表。th ごとに行の子を全部たどって、向き (Scope) を決めていた
 *    (2 万個で、直す前 41 秒・直した後 1.6 秒)
 *  - XSL-FO: fo:table-row を書かずに ends-row で行を分けた表。行を作るたびに、親の子の並びを作り直していた
 *    (2 万行で、直す前 5.6 秒・直した後 1.5 秒)
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';

describe('構造の木の手間', () => {
  it('HTML: 1 行に th 1 万個の表', () => {
    const d = parseHTML(`<!doctype html><html><body><table><tr>${'<th>a</th>'.repeat(10_000)}</tr></table></body></html>`).document as unknown as Document;
    const t = performance.now();
    const r = importHtml(d, cascadeStyles(d, '', { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { tagged: true });
    // 直す前は 10 秒ほど
    expect(performance.now() - t).toBeLessThan(5000);
    expect(r.document.structure?.length).toBeGreaterThan(0);
  }, 60_000);

  it('XSL-FO: ends-row で分けた 4 万行の表', () => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:table><fo:table-body>${'<fo:table-cell ends-row="true"><fo:block>a</fo:block></fo:table-cell>'.repeat(40_000)}</fo:table-body></fo:table></fo:flow></fo:page-sequence></fo:root>`;
    const t = performance.now();
    const r = importXslFo(fo, (x) => new DOMParser().parseFromString(x, 'text/xml') as never, { tagged: true });
    // 直す前は 20 秒ほど (行の数の 2 乗)
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(r.document.structure?.length).toBeGreaterThan(0);
  }, 120_000);
});
