/**
 * 入れ子の段組 (padding のある段組の中の段組) の、組む回数。
 * 置いてみてはみ出した段組を組み直すために、1 度目の組みが外へ残すもの (絶対配置の箱など) を覚えておく所が、絶対配置の箱の置き場を
 * 先に引いていた。段の試し組みの流れでは、置き場を引くと「試し組みが箱を置いた」印が立ち (箱を置かなくても)、外の段組の釣り合わせの
 * 覚え (Flow.memoMeasure) が効かなくなって、入れ子の 1 段ごとに組む回数が何倍にもなっていた (深さ 4・枝 3 で、組む回数の上限に当たり、
 * 段組を 1 段に組んで中身が欠けた)。
 * 時間ではなく、組んだ回数 (LayoutEngine.stats) で確かめる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
import type { LDocument } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const L = (n: number, p: string) => Array.from({ length: n }, (_, i) => `<fo:block>${p}${i}</fo:block>`).join('');
const HL = (n: number, p: string) => Array.from({ length: n }, (_, i) => `<p>${p}${i}</p>`).join('');
/** 深さ d・枝 b の入れ子の段組 (どの段組も padding 4pt。いちばん内側は、分けない指定のブロックの 6 行) */
const foNest = (d: number, b: number, k = 0): string =>
  k === d
    ? `<fo:block keep-together.within-column="always">${L(6, 'K')}</fo:block>`
    : `<fo:block-container column-count="2" column-gap="6pt" padding="4pt">${L(2, 'A' + k)}${Array.from({ length: b }, () => foNest(d, b, k + 1)).join('')}</fo:block-container>`;
const htmlNest = (d: number, b: number, k = 0): string =>
  k === d ? `<div style="break-inside:avoid">${HL(6, 'K')}</div>` : `<div class="c">${HL(2, 'A' + k)}${Array.from({ length: b }, () => htmlNest(d, b, k + 1)).join('')}</div>`;
const fo = (body: string): LDocument =>
  importXslFo(
    `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="600pt" page-height="300pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="12pt">${body}</fo:flow></fo:page-sequence></fo:root>`,
    (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never,
    { compat: 'spec' },
  ).document;
const html = (body: string): LDocument => {
  const d = parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;
  const css = '@page { size: 600pt 300pt; margin: 20pt } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } .c { columns: 2; column-gap: 6pt; padding: 4pt 0 }';
  return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 800, height: 400 } }), { css }).document;
};

describe('padding のある段組の入れ子の、組む回数', () => {
  // 上限は、直した後の数の 2〜3 倍 (直す前は、上限の 10 倍ほど)
  for (const [name, doc, max] of [
    ['XSL-FO 深さ 4・枝 2', () => fo(foNest(4, 2)), 3000],
    ['XSL-FO 深さ 3・枝 3', () => fo(foNest(3, 3)), 6000],
    ['HTML 深さ 4・枝 2', () => html(htmlNest(4, 2)), 3000],
  ] as const) {
    it(`${name}: 組む流れの数が ${max} を超えない`, () => {
      const tree = E.engine.layout(doc());
      expect(tree.sheets.length).toBeGreaterThan(0);
      expect(E.engine.stats.flows).toBeLessThanOrEqual(max);
    }, 60_000);
  }

  it('XSL-FO 深さ 4・枝 3: 組む回数の上限に当たらない (段組を 1 段に組まない)', () => {
    E.engine.layout(fo(foNest(4, 3)));
    expect(E.engine.stats.flows).toBeLessThanOrEqual(25000);
    expect((E.engine as unknown as { warnings: string[] }).warnings.join('\n')).not.toMatch(/入れ子が深すぎ/);
  }, 120_000);
});
