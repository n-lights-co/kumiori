/**
 * 最後のページのマスターの組み直しを、ページの境目から続けて組んでも (design/resumable-flow.md の 4.3 の 1)、初めから組み直したときと、
 * 組む手間の上限 (LayoutOptions.maxMeasureFlows) の当たり方が同じ。上限から遠い所の組み直しは、どちらの組み方でも、組み直しの流れを
 * 上限の数えに入れない (FlowHost.nest.charged)。境目までの流れの数を足して初めから組んだときを真似ると、初めから組み直す流れは
 * 計測の覚えに当たって少ないので (表のある文書で数千)、後ろの page-sequence で上限に当たる所がずれ、結果が変わった。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine, FAMILY } from './helpers';
import { importXslFo } from '../src/xslfoImport';
import { LayoutEngine, resumeProbe } from '../src/layoutEngine';
import { serializeAreaTree } from '../src/index';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const block = '<fo:block>x<fo:inline-container><fo:block>y</fo:block></fo:inline-container>z と文<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>脚注の本体 (境目をまたいで組んだ本体を使い回す)</fo:block></fo:footnote-body></fo:footnote></fo:block>';
const seq = (m: string, n: number) => `<fo:page-sequence master-reference="${m}"><fo:flow flow-name="xsl-region-body">${block.repeat(n)}</fo:flow></fo:page-sequence>`;
const text = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set>
<fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master>
<fo:simple-page-master master-name="last" page-width="105mm" page-height="148mm" margin="40mm"><fo:region-body/></fo:simple-page-master>
<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives>
<fo:conditional-page-master-reference master-reference="last" page-position="last"/><fo:conditional-page-master-reference master-reference="p"/>
</fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>
${seq('m', 300)}${seq('m', 200)}${seq('p', 3000)}</fo:root>`;

/** 表の行の中に脚注のある形 (表の行の高さを測る組みが、初めから組み直すときは覚えに当たる。境目の前に組んだ脚注の本体を、境目の後で使う) */
const row = (k: number) =>
  `<fo:table-row><fo:table-cell><fo:block>行 ${k}<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>注 ${k % 7}</fo:block></fo:footnote-body></fo:footnote> と文</fo:block></fo:table-cell></fo:table-row>`;
const tableSeq = (m: string, n: number) =>
  `<fo:page-sequence master-reference="${m}"><fo:flow flow-name="xsl-region-body"><fo:table><fo:table-body>${Array.from({ length: n }, (_, k) => row(k)).join('')}</fo:table-body></fo:table></fo:flow></fo:page-sequence>`;
const footText = text.slice(0, text.indexOf('<fo:page-sequence master-reference')) + `${tableSeq('m', 150)}${tableSeq('m', 100)}${seq('p', 1500)}</fo:root>`;

describe('境目から続けて組むときの、組む手間の上限の数え', () => {
  it('表の行の中に脚注のある文書でも、初めから組み直したときと、上限の当たり方 (警告・領域の木) が同じ', () => {
    const layout = (fromStart: boolean, max: number) => {
      resumeProbe.fromStart = fromStart;
      let st: { lastFromBoundary: number; uncounted?: number } | undefined;
      resumeProbe.onStats = (s) => (st = { ...s });
      try {
        const doc = importXslFo(footText, (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat: 'spec' }).document;
        const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxMeasureFlows: max });
        const tree = engine.layout(doc);
        return { tree: serializeAreaTree(tree), warnings: tree.warnings.join('\n'), limit: tree.warnings.some((w) => /入れ子が深すぎます|nested too deeply/.test(w)), flows: engine.stats.flows, fromBoundary: st?.lastFromBoundary ?? 0, uncounted: st?.uncounted ?? 0 };
      } finally {
        resumeProbe.fromStart = false;
        resumeProbe.onStats = undefined;
      }
    };
    const free = layout(true, Infinity);
    const b0 = layout(false, Infinity);
    expect(b0.fromBoundary, '境目から組み直した').toBeGreaterThan(0);
    expect(b0.uncounted, '上限の数えから除いた流れ').toBeGreaterThan(0);
    expect(b0.tree === free.tree, '領域の木').toBe(true);
    // 上限を、初めから組んだときの流れの数 (組み直しの分を除く) の何割かに置き、後ろの page-sequence の途中で当たるようにする
    const total = free.flows - free.uncounted;
    let exercised = 0;
    for (const ratio of [0.6, 0.75, 0.85, 0.92, 0.97]) {
      const max = Math.floor(total * ratio);
      const a = layout(true, max);
      const b = layout(false, max);
      expect(b.limit, `割合 ${ratio}`).toBe(a.limit);
      expect(b.warnings, `割合 ${ratio}`).toBe(a.warnings);
      expect(b.tree === a.tree, `割合 ${ratio} の領域の木`).toBe(true);
      if (b.fromBoundary > 0 && b.limit) exercised++;
    }
    expect(exercised, '境目から組み直して上限に当たる割合').toBeGreaterThan(0);
  }, 300_000);

  it('初めから組み直したときと、上限の当たり方 (警告・領域の木) が同じ (上限をいくつかの所に置き、境目から組み直して上限に当たる所も試す)', () => {
    const doc = () => importXslFo(text, (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat: 'spec' }).document;
    const layout = (fromStart: boolean, max: number) => {
      resumeProbe.fromStart = fromStart;
      let fromBoundary = 0;
      let uncounted = 0;
      resumeProbe.onStats = (st) => {
        fromBoundary = st.lastFromBoundary;
        uncounted = st.uncounted ?? 0;
      };
      try {
        const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxMeasureFlows: max });
        const tree = engine.layout(doc());
        return { tree: serializeAreaTree(tree), warnings: tree.warnings.join('\n'), limit: tree.warnings.some((w) => /入れ子が深すぎます|nested too deeply/.test(w)), flows: engine.stats.flows, fromBoundary, uncounted };
      } finally {
        resumeProbe.fromStart = false;
        resumeProbe.onStats = undefined;
      }
    };
    const free = layout(true, Infinity);
    let exercised = 0;
    // 上限を、初めから組んだときの流れの数 (上限の数えから除く組み直しの分を除く) の何割かに置く
    const total = free.flows - free.uncounted;
    for (const ratio of [0.6, 0.76, 0.85, 0.9, 0.95, 0.99]) {
      const max = Math.floor(total * ratio);
      const a = layout(true, max);
      const b = layout(false, max);
      expect(b.limit, `割合 ${ratio}`).toBe(a.limit);
      expect(b.warnings, `割合 ${ratio}`).toBe(a.warnings);
      expect(b.tree === a.tree, `割合 ${ratio} の領域の木`).toBe(true);
      // 境目から組み直し (上限の数えに、組まずに済ませた分を足す道を通り)、上限に当たった
      if (b.fromBoundary > 0 && b.limit) exercised++;
    }
    expect(exercised, '境目から組み直して上限に当たる割合').toBeGreaterThan(0);
  }, 300_000);

  it('最後のページのマスターで組み直しても、組む手間の上限の警告を出す (捨てた組版で当たった印だけが残らない)', () => {
    const one = text.slice(0, text.indexOf('<fo:page-sequence master-reference')) + `${seq('m', 300)}</fo:root>`;
    for (const fromStart of [true, false]) {
      resumeProbe.fromStart = fromStart;
      try {
        const doc = importXslFo(one, (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat: 'spec' }).document;
        const tree = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxMeasureFlows: 200 }).layout(doc);
        expect(tree.warnings.some((w) => /入れ子が深すぎます|nested too deeply/.test(w)), `fromStart ${fromStart}`).toBe(true);
      } finally {
        resumeProbe.fromStart = false;
      }
    }
  }, 120_000);
});
