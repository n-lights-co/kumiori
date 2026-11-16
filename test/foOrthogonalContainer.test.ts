/**
 * XSL-FO の、行の向きの大きさの指定の無い直交する fo:block-container (LAY-19 (2))。
 * XSL 1.1 §6.5.3 は、行の進む向きが親と違うコンテナの inline-progression-dimension を auto にしてはならないとし、組み方を
 * 決めていない (§7.15.7 の auto は「ほかの制約を考えに入れて組版ソフトが決める」)。本文の幅を行の長さにすると、箱がページの
 * 高さを超えて下へはみ出し、字が切れたので、行の長さをページの残りの高さ (次のページからはページの高さ) にし、入りきらない
 * 行は次のページへ続ける (直交するブロックの E-16 と同じ)。90° 回した枠つきの箱も同じ (局所の block の向きに本文の幅まで積む)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const MM = 72 / 25.4;
/** 120mm × 100mm・余白 10mm の横長のページ (本文 100mm × 80mm。本文の幅がページの高さより長いので、本文の幅を行の長さにすると収まらない) */
const BODY_W = 100 * MM;
const BODY_H = 80 * MM;
const T = '縦書きの箱の中の文。あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん。';
const xml = (attrs: string, n: number) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="120mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>前</fo:block><fo:block-container ${attrs}><fo:block>${T.repeat(n)}</fo:block></fo:block-container><fo:block>後</fo:block></fo:flow></fo:page-sequence></fo:root>`;

type Placed = { type: string; x: number; y: number; width: number; height: number; writingMode?: string };
function lay(attrs: string, n: number, compat: 'spec' | 'antenna') {
  const tree = E.engine.layout(importXslFo(xml(attrs, n), (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat }).document);
  const text = tree.sheets
    .map((s) => {
      const g: string[] = [];
      walk(s.page.regionBody as unknown as Area, (a) => a.type === 'glyph' && g.push(a.text));
      return g.join('');
    })
    .join('');
  // 本文の領域の直下の箱 (前・後の段落と、コンテナの断片)
  const pages = tree.sheets.map((s) => s.page.regionBody.children as unknown as Placed[]);
  return { text, pages };
}

describe('LAY-19 (2): 行の向きの大きさの指定の無い、直交する fo:block-container', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    for (const [name, n] of [
      ['短い文', 2],
      ['長い文 (ページをまたぐ)', 12],
    ] as const) {
      it(`${compat}: writing-mode="tb-rl" の${name}は、ページの残りの高さで行を折り返し、下へはみ出さない`, () => {
        const r = lay('writing-mode="tb-rl" border="1pt solid red"', n, compat);
        // 字はすべて組まれる (前・箱の中・後の順)
        expect(r.text).toBe(`前${T.repeat(n)}後`);
        const frags = r.pages.flatMap((p, k) => p.filter((b) => b.writingMode === 'vertical-rl').map((b) => ({ ...b, page: k })));
        expect(frags.length).toBeGreaterThan(0);
        for (const f of frags) {
          expect(f.y + f.height, `${f.page + 1} ページ目の断片の下端`).toBeLessThanOrEqual(BODY_H + 0.01);
          expect(f.x + f.width, `${f.page + 1} ページ目の断片の右端`).toBeLessThanOrEqual(BODY_W + 0.01);
        }
        // 最初の断片は、前の段落と同じページ (ページの残りで組む。前は次のページへ送られ、下へはみ出した)
        expect(frags[0].page).toBe(0);
        if (n > 2) expect(new Set(frags.map((f) => f.page)).size).toBeGreaterThan(1);
        // 1 ページに収まる箱は、これまでどおり本文の幅いっぱい (fillOrthogonal)
        else expect(frags[0].width).toBeCloseTo(BODY_W, 1);
      });
    }
  }
  for (const compat of ['spec', 'antenna'] as const) {
    it(`${compat}: reference-orientation="90" の枠つきの箱は、局所の block の向きに本文の幅まで積み、続きは次のページへ送る`, () => {
      const r = lay('reference-orientation="90" border="1pt solid red" padding="2pt"', 12, compat);
      expect(r.text).toBe(`前${T.repeat(12)}後`);
      // 回した箱の断片 (前・後の段落の他の箱)。大きさは回す前の局所の向き: width が行の長さ (ページの縦)、height が積んだ行の幅 (ページの横)
      const frags = r.pages.flatMap((p, k) => p.slice(k === 0 ? 1 : 0).filter((b) => !(b.height < 20 && b.width > BODY_W - 1)).map((b) => ({ ...b, page: k })));
      expect(new Set(frags.map((f) => f.page)).size).toBeGreaterThan(1);
      // 互換モードは、行がページ (ここでは局所の block の向きの長さ) に入るかを、行の箱ではなく字で判定するので、最後の行の箱は
      // 字の外の分だけ越えうる (描く字・罫線は本文の領域の中。100mm × 120mm のページで、72dpi で描いて確かめた)
      const tol = compat === 'antenna' ? 5 : 0.01;
      for (const f of frags) {
        expect(f.height, `${f.page + 1} ページ目の断片の横の大きさ`).toBeLessThanOrEqual(BODY_W + tol);
        expect(f.y + f.width, `${f.page + 1} ページ目の断片の下端`).toBeLessThanOrEqual(BODY_H + 2.01);
      }
    });
  }
  it('回した枠つきの箱にも、space-before・start-indent を当てる', () => {
    const r = lay('reference-orientation="90" border="1pt solid red" space-before="10mm" start-indent="5mm"', 2, 'spec');
    const box = r.pages[0][1];
    expect(box.y).toBeGreaterThan(10 * MM);
    expect(box.x).toBeGreaterThan(5 * MM - 2);
  });
});
