/**
 * タグ付き PDF の構造の木を作る手間が、表の大きさの 2 乗にならないこと:
 *  - HTML: 1 行に見出しのセル (th) を多く並べた表。th ごとに行の子を全部たどって、向き (Scope) を決めていた
 *    (2 万個で、直す前 41 秒・直した後 1.6 秒)
 *  - XSL-FO: fo:table-row を書かずに ends-row で行を分けた表。行を作るたびに、親の子の並びを作り直していた
 *    (2 万行で、直す前 5.6 秒・直した後 1.5 秒)
 * 時間の上限ではなく、表を 8 倍の大きさにしたときの時間の比で見る (大きさに比例すれば 8 ほど、2 乗なら 64 ほど。CI のランナーの速さに
 * 左右されない)。小さい表を先に 1 度組んで温めてから測る。比の上限は 16
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';

/** f にかかる時間 (ms) */
function time(f: () => void): number {
  const t = performance.now();
  f();
  return performance.now() - t;
}

/** 大きさ small と、その 8 倍の大きさで組む時間の比 (小さい方を先に 1 度組んで温める) */
function ratio(run: (n: number) => void, small: number): { ratio: number; small: number; big: number } {
  run(small);
  const s = time(() => run(small));
  const b = time(() => run(small * 8));
  return { ratio: b / s, small: s, big: b };
}

describe('構造の木の手間', () => {
  it('HTML: 1 行に th を並べた表 (1,250 個と 1 万個)', () => {
    const run = (n: number) => {
      const d = parseHTML(`<!doctype html><html><body><table><tr>${'<th>a</th>'.repeat(n)}</tr></table></body></html>`).document as unknown as Document;
      const r = importHtml(d, cascadeStyles(d, '', { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { tagged: true });
      expect(r.document.structure?.length).toBeGreaterThan(0);
    };
    const r = ratio(run, 1_250);
    expect(r.ratio, JSON.stringify(r)).toBeLessThan(16);
  }, 60_000);

  it('XSL-FO: ends-row で分けた表 (5,000 行と 4 万行)', () => {
    const run = (n: number) => {
      const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:table><fo:table-body>${'<fo:table-cell ends-row="true"><fo:block>a</fo:block></fo:table-cell>'.repeat(n)}</fo:table-body></fo:table></fo:flow></fo:page-sequence></fo:root>`;
      const r = importXslFo(fo, (x) => new DOMParser().parseFromString(x, 'text/xml') as never, { tagged: true });
      expect(r.document.structure?.length).toBeGreaterThan(0);
    };
    const r = ratio(run, 5_000);
    expect(r.ratio, JSON.stringify(r)).toBeLessThan(16);
  }, 120_000);
});
