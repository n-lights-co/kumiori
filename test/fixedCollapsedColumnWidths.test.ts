/**
 * 列の幅の指定の無い、固定の列幅 (table-layout="fixed") の、罫線をつぶした表 (border-collapse="collapse") の列の幅 (台帳の FO-40)。
 * 仕様: CSS 2.1 §17.5.2.1 (XSL 1.1 §7.28.16 の table-layout="fixed" が引く) の「残りの列は、残りの表の幅を (罫線・セルの間隔を除いて)
 * 等しく分ける」。固定の列幅は 1 行目のセルだけを見るので、1 行目のセルの罫線を除いた幅 (中身と padding の幅) を等しく配る。
 * アンテナハウスの見本 (サンプル FO 集の table-border-conflict-resolution-1。1 行目の罫線 5・10・5・5・15pt の 5 列の表) も、
 * 5 列とも中身の幅が約 86.4pt で等しい (グリッド線の間は 93.8・96.5・93.75・96.5・101.25pt)。仕様モード・互換モードとも同じ。
 * 罫線を分ける表 (separate) も、同じ文により、1 行目のセルの罫線を除いた幅を等しく配る。
 * HTML の表 (table-layout: fixed) は、アンテナハウス互換 (--style ah) だけがこの配り方で、ほかのスタイルは列の箱を等分する
 * (ブラウザ (Chromium) と同じ。0.2.0 と同じ。台帳の FO-43)。
 * 列の幅の指定 (column-width) は、罫線をつぶした表では、表の端の列も含めてグリッド線の間の幅 (表の幅は外周のグリッド線の間。
 * CSS 2.1 §17.6.2 の row-width)。アンテナハウスの見本 (サンプル FO 集の axf-form-field-event-1: 30・30・30・40mm の 4 列) も、
 * 端の列も最後の列もグリッド線の間が指定の幅
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { childrenOf } from '../src/areaTree';
import type { Area, AreaTree } from '../src/types';
import { LayoutEngine } from '../src/layoutEngine';
import { AH_HTML_IMPORT_OPTIONS, ahCascadeOptions, compatLayoutOptions } from '../src/compat';
import { FAMILY, makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
/** HTML の --style ah の組版 (api.ts・main.ts と同じ互換の設定) */
let EA: LayoutEngine;
beforeAll(async () => {
  E = await makeEngine();
  EA = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, ...compatLayoutOptions(true) });
});

const COLORS = ['#110000', '#220000', '#330000', '#440000', '#550000'];
/** 1 行目のセルの中のブロックの背景 (色ごと) の、ページの中の左端と幅 */
const contents = (tree: AreaTree) => {
  const out: Record<string, { x: number; w: number }> = {};
  const visit = (n: Area, ox: number) => {
    const x = ox + n.x;
    if (n.backgroundColor && !out[n.backgroundColor]) out[n.backgroundColor] = { x, w: (n as { width: number }).width };
    for (const c of childrenOf(n)) visit(c as Area, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0));
  };
  visit(tree.sheets[0].page.regionBody as Area, 0);
  return COLORS.map((c) => out[c]);
};
/** 値の並びが、それぞれ 0.01 の内で等しい */
const near = (got: number[], want: number[]) => {
  expect(got.length).toBe(want.length);
  got.forEach((g, k) => expect(g).toBeCloseTo(want[k], 1));
};

describe('XSL-FO: 列の指定の無い table-layout="fixed" の、罫線をつぶした表', () => {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  // 版面の幅 170mm (481.89pt。見本と同じ)。表に罫線は無く、外周の罫線はセルが持つ
  const fo = (flow: string) =>
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="210mm" page-height="100mm" margin-left="20mm" margin-right="20mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  const row = (ws: number[], bg: boolean) =>
    `<fo:table-row>${ws.map((w, k) => `<fo:table-cell border="${w}pt solid"><fo:block${bg ? ` background-color="${COLORS[k]}"` : ''}>x</fo:block></fo:table-cell>`).join('')}</fo:table-row>`;
  // 見本の 3 つ目の表と同じ罫線
  const TABLE = `<fo:table border-collapse="collapse" table-layout="fixed"><fo:table-body>${row([5, 10, 5, 5, 15], true)}${row([5, 5, 1, 5, 1], false)}</fo:table-body></fo:table>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`${compat}: 1 行目の罫線を除いた中身の幅を等しく配る (5 列とも 86.38pt)`, () => {
      const cs = contents(E.engine.layout(importXslFo(fo(TABLE), parse, { compat }).document));
      // (481.89 − 1 行目の罫線 (外周の半分 2.5・7.5 と、内側の 10・10・5・15)) / 5
      near(cs.map((c) => c.w), Array(5).fill((481.89 - 50) / 5));
      // グリッド線 (中身の左端 − 罫線の半分) の間: 93.88・96.38・93.88・96.38・101.37 (見本の 93.8・96.5・93.75・96.5・101.25)
      const left = [2.5, 5, 5, 2.5, 7.5];
      const grid = [...cs.map((c, k) => c.x - left[k]), cs[4].x + cs[4].w + 7.5];
      near(grid.slice(1).map((g, k) => g - grid[k]), [93.88, 96.38, 93.88, 96.38, 101.38]);
      // 表のグリッドの幅は、版面の幅
      expect(grid[5] - grid[0]).toBeCloseTo(481.89, 1);
    });
  }
  it('列の幅の指定のある列はそのまま、無い列だけ、罫線を除いた幅を等しく配る', () => {
    const t = `<fo:table border-collapse="collapse" table-layout="fixed"><fo:table-column column-number="3" column-width="100pt"/><fo:table-body>${row([5, 10, 5, 5, 15], true)}</fo:table-body></fo:table>`;
    for (const compat of ['spec', 'antenna'] as const) {
      const cs = contents(E.engine.layout(importXslFo(fo(t), parse, { compat }).document));
      // 3 列目は、グリッド線の間が 100pt。中身は、左の 10pt の線の半分と右の 5pt の線の半分を除いた 92.5pt (互換の組み方も同じ。
      // 内側の線を後ろのセルがまるごと持つので、箱は線の半分ずつずれるが、グリッド線の間は指定の幅)
      expect(cs[2].w).toBeCloseTo(92.5, 1);
      // 残りの 4 列は、(グリッドの幅 481.89 − 100 − 4 列の 1 行目の罫線 (外周の半分と内側の半分ずつ)) / 4
      const taken = 2.5 + 5 + 5 + 5 + 2.5 + 7.5 + 7.5 + 7.5;
      near([0, 1, 3, 4].map((k) => cs[k].w), Array(4).fill((481.89 - 100 - taken) / 4));
    }
  });
});

describe('XSL-FO: 罫線をつぶした表の、表の端の列の幅の指定 (グリッド線の間の幅)', () => {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  // 版面は 20pt から 180pt (幅 160pt)
  const fo = (flow: string) =>
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200pt" page-height="200pt" margin-left="20pt" margin-right="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  const table = (attrs: string) =>
    `<fo:table border-collapse="collapse" table-layout="fixed"${attrs}><fo:table-column column-width="40pt"/><fo:table-column column-width="40pt"/><fo:table-body><fo:table-row>` +
    COLORS.slice(0, 2).map((c) => `<fo:table-cell border="4pt solid"><fo:block background-color="${c}">x</fo:block></fo:table-cell>`).join('') +
    '</fo:table-row></fo:table-body></fo:table>';
  for (const compat of ['spec', 'antenna'] as const) {
    it(`${compat}: 外周の罫線をセルが持つ表で、端の列もグリッド線の間が 40pt`, () => {
      const cs = contents(E.engine.layout(importXslFo(fo(table(' width="80pt"')), parse, { compat }).document));
      // グリッド線は 20・60・100pt。中身は、グリッド線から 4pt の線の半分の内側 (前は、端の列が外へ出る半分 2pt だけ狭く、
      // 互換の組み方の最後の列は線の太さ 4pt だけ狭かった)
      near([cs[0].x, cs[0].w, cs[1].x, cs[1].w], [22, 36, 62, 36]);
    });
    it(`${compat}: 表が外周の罫線 (10pt) を持つ表でも、グリッド線の間が 40pt`, () => {
      const cs = contents(E.engine.layout(importXslFo(fo(table(' width="80pt" border="10pt solid"')), parse, { compat }).document));
      // 中身は、グリッド線の間 40pt から、表の罫線の半分 5pt と、内側の 4pt の線の半分を除いた 33pt。
      // 中身の始まりの差は、40 − 5 (1 列目は表の罫線の半分の内側) + 2 (2 列目は内側の線の半分の内側)
      near([cs[0].w, cs[1].w, cs[1].x - cs[0].x], [33, 33, 37]);
    });
  }
});

describe('罫線を分ける表 (separate) の、列の指定の無い固定の列幅', () => {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  const fo = (flow: string) =>
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200pt" page-height="200pt" margin-left="20pt" margin-right="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`XSL-FO ${compat}: 1 行目のセルの罫線を除いた幅を等しく配る`, () => {
      const t =
        '<fo:table border-collapse="separate" table-layout="fixed"><fo:table-body><fo:table-row>' +
        [2, 8, 2].map((w, k) => `<fo:table-cell border="${w}pt solid"><fo:block background-color="${COLORS[k]}">x</fo:block></fo:table-cell>`).join('') +
        '</fo:table-row></fo:table-body></fo:table>';
      const cs = contents(E.engine.layout(importXslFo(fo(t), parse, { compat }).document));
      // (160 − セルの罫線 (2+2、8+8、2+2)) / 3 (前は、セルの箱を等分したので、8pt のセルの中身が 12pt 狭かった)
      near(cs.slice(0, 3).map((c) => c.w), Array(3).fill((160 - 24) / 3));
    });
  }
});

describe('HTML: table-layout: fixed の、列の指定の無い表 (台帳の FO-43)', () => {
  const BASE = '@page { size: 210mm 100mm; margin: 0 20mm } body { margin: 0; font-size: 10pt } td, th { padding: 0 } td div, th div { height: 10pt }';
  /** ah: --style ah の読み込み (カスケードと読み込みの互換の設定) */
  const imp = (body: string, ah = false) => {
    const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
    const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
    const styles = cascadeStyles(d, BASE, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 }, ...(ah ? ahCascadeOptions(BASE) : {}) });
    return importHtml(d, styles, { css: BASE, ...(ah ? AH_HTML_IMPORT_OPTIONS : {}) });
  };
  const layout = (body: string, ah = false) => (ah ? EA : E.engine).layout(imp(body, ah).document);
  /** 表の行ごとの、セルの箱の幅 */
  const cellBoxes = (tree: AreaTree) => {
    const rows: number[][] = [];
    const visit = (n: Area) => {
      if (n.type === 'table-row') rows.push((childrenOf(n) as Area[]).filter((c) => c.type === 'table-cell').map((c) => (c as { width: number }).width));
      else for (const c of childrenOf(n)) visit(c as Area);
    };
    visit(tree.sheets[0].page.regionBody as Area);
    return rows;
  };
  // 罫線は px で (罫線の太さは px の整数に丸める): 6・12・6・6・20px = 4.5・9・4.5・4.5・15pt
  const tds5 = [6, 12, 6, 6, 20].map((w, k) => `<td style="border: ${w}px solid"><div style="background-color: ${COLORS[k]}"></div></td>`).join('');
  const collapse5 = `<table style="table-layout: fixed; border-collapse: collapse; width: 400pt"><tr>${tds5}</tr></table>`;
  // 罫線 4・16・4px = 3・12・3pt。セルの間隔は 0
  const tds3 = [4, 16, 4].map((w, k) => `<td style="border: ${w}px solid"><div style="background-color: ${COLORS[k]}"></div></td>`).join('');
  const separate3 = `<table style="table-layout: fixed; border-collapse: separate; border-spacing: 0; width: 300pt"><tr>${tds3}</tr></table>`;

  it('--style ah: 罫線をつぶした表は、1 行目の罫線を除いた幅を等しく配る (XSL-FO と同じ)', () => {
    // 表の幅 (グリッドの幅) 400pt。1 行目の罫線は、外周の半分 2.25・7.5 と、内側の 9・9・4.5・15
    const cs = contents(layout(collapse5, true));
    near(cs.map((c) => c.w), Array(5).fill((400 - (2.25 + 9 + 9 + 4.5 + 15 + 7.5)) / 5));
  });
  it('--style ah: 罫線を分ける表も、1 行目のセルの罫線を除いた幅を等しく配る', () => {
    const cs = contents(layout(separate3, true));
    near(cs.slice(0, 3).map((c) => c.w), Array(3).fill((300 - 36) / 3));
  });
  it('既定のスタイル: 罫線をつぶした表は、列の箱を等分する', () => {
    // セルの箱は、表の箱 (グリッドの幅 400pt と、外へ出る半分 2.25・7.5) の 1/5 ずつ (中身の幅は、罫線の分だけ列ごとに違う)
    near(cellBoxes(layout(collapse5))[0], Array(5).fill((400 + 2.25 + 7.5) / 5));
  });
  it('既定のスタイル: 罫線を分ける表は、列の箱を等分する', () => {
    near(cellBoxes(layout(separate3))[0], [100, 100, 100]);
  });

  // Chromium で実測した 4 つの表 (表の幅 300pt・padding 0。台帳の FO-43)。Chromium は列の箱を等分する
  const T = (coll: string) => `<table style="table-layout: fixed; width: 300pt; border-collapse: ${coll}; border-spacing: 0">`;
  const row4 = '<tr><td style="border: 4px solid">a</td><td style="border: 4px solid">b</td><td style="border: 4px solid">c</td></tr>';
  const spanned = (coll: string) => `${T(coll)}<tr><td colspan="3" style="border: 16px solid">x</td></tr>${row4}</table>`;
  const firstThick = `${T('separate')}<tr><td style="border: 20px solid">a</td><td style="border: 1px solid">b</td><td style="border: 1px solid">c</td></tr></table>`;
  const thLeft =
    `${T('collapse')}<tr><th style="border: 1px solid; border-left: 6px solid">a</th><th style="border: 1px solid">b</th><th style="border: 1px solid">c</th></tr>` +
    '<tr><td style="border: 1px solid">a</td><td style="border: 1px solid">b</td><td style="border: 1px solid">c</td></tr></table>';
  it('既定のスタイル: Chromium と同じく、列の箱を等分する (罫線を分ける表は、Chromium の値と同じ)', () => {
    // (a) 1 行目が 16px の罫線の、3 列をまたぐセル。Chromium 100・100・100pt (前は 104・92・104pt)
    near(cellBoxes(layout(spanned('separate')))[1], [100, 100, 100]);
    // (c) 1 行目の 1 つ目のセルだけ 20px の罫線。Chromium 100・100・100pt (前は 119・90.5・90.5pt)
    near(cellBoxes(layout(firstThick))[0], [100, 100, 100]);
  });
  it('既定のスタイル: 罫線をつぶした表も、列の箱を等分する', () => {
    // (b) Chromium 96・96・96pt (前は 108・96・108pt)。Kumiori は表の幅をグリッド線の間の幅とする (外周の 12pt の線の半分 6pt ずつが
    // 外へ出る) ので、箱は (300 + 6 + 6) / 3 = 104pt ずつ。Chromium は表の幅に外周の線の半分を含めるので、(300 − 12) / 3 = 96pt
    near(cellBoxes(layout(spanned('collapse')))[1], [104, 104, 104]);
    // (d) Chromium 99.12pt ずつ (前は 103.5・99.38・99.75pt)。Kumiori は (300 + 2.25 + 0.375) / 3 = 100.875pt ずつ
    for (const r of cellBoxes(layout(thLeft))) near(r, Array(3).fill((300 + 2.25 + 0.375) / 3));
  });
  it('--style ah: 同じ 4 つの表は、1 行目のセルの罫線を除いた幅を等しく配る (直す前と同じ値)', () => {
    near(cellBoxes(layout(spanned('separate'), true))[1], [104, 92, 104]);
    near(cellBoxes(layout(spanned('collapse'), true))[1], [108, 96, 108]);
    near(cellBoxes(layout(firstThick, true))[0], [119, 90.5, 90.5]);
    for (const r of cellBoxes(layout(thLeft, true))) near(r, [103.5, 99.375, 99.75]);
  });
  it('既定のスタイル: 罫線をつぶした表で、1 行目の罫線の和が表の幅を超えても、行が表からはみ出さない', () => {
    // 表の幅 30pt に 16px (12pt) の罫線のセル 3 つ。表の箱は 30 + 6 + 6 = 42pt で、セルの箱は 14pt ずつ (--style ah・XSL-FO は 18・12・18pt で、行が 48pt)
    const t = `<table style="table-layout: fixed; width: 30pt; border-collapse: collapse"><tr>${'<td style="border: 16px solid">a</td>'.repeat(3)}</tr></table>`;
    near(cellBoxes(layout(t))[0], [14, 14, 14]);
  });
});

describe('XSL-FO: table-and-caption で寄せた、幅の指定の無い、罫線をつぶした表 (台帳の FO-42)', () => {
  // 本文の幅 260pt (x = 20〜280)、表の罫線 6pt、セルの罫線 2pt、40pt の列 2 つ。列の幅は、罫線をつぶした表ではグリッド線の間の幅
  // (CSS 2.1 §17.6.2 の row-width)。表の幅 (外周のグリッド線の間) は列の幅の和 80pt で、表の罫線の内側の幅 (表の内容の幅) は
  // 80 − 表の罫線の内側の半分 3pt × 2 = 74pt。width="80pt" と書いた表と同じ
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  const fo = (flow: string) =>
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  const cell = (t: string) => `<fo:table-cell border="2pt solid"><fo:block>${t}</fo:block></fo:table-cell>`;
  const table = (attrs: string, collapse = 'collapse') =>
    `<fo:table border-collapse="${collapse}" table-layout="fixed" ${attrs}><fo:table-column column-width="40pt"/><fo:table-column column-width="40pt"/><fo:table-body><fo:table-row>${cell('a')}${cell('b')}</fo:table-row><fo:table-row>${cell('c')}${cell('d')}</fo:table-row></fo:table-body></fo:table>`;
  /** 表の罫線の箱 (左端・右端)・表の内容の幅・行の左端と右端・最後のセルの右端 (どれもページの中の x) */
  const measure = (flow: string, compat: 'spec' | 'antenna') => {
    const tree = E.engine.layout(importXslFo(fo(flow), parse, { compat }).document);
    let found: { x0: number; x1: number; content: number; rows: Array<{ x0: number; x1: number; lastCell: number }> } | undefined;
    const visit = (n: Area, ox: number) => {
      const x = ox + n.x;
      const w = (n as { width: number }).width;
      const inner = x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0);
      if (n.type === 'table' && !found) {
        const content = w - (n.border?.left?.width ?? 0) - (n.border?.right?.width ?? 0) - (n.padding?.left ?? 0) - (n.padding?.right ?? 0);
        const rows = (childrenOf(n) as Area[])
          .filter((r) => r.type === 'table-row')
          .map((r) => {
            const rx = inner + r.x;
            const cells = childrenOf(r) as Area[];
            const last = cells[cells.length - 1];
            return { x0: rx, x1: rx + (r as { width: number }).width, lastCell: rx + last.x + (last as { width: number }).width };
          });
        found = { x0: x, x1: x + w, content, rows };
        return;
      }
      for (const c of childrenOf(n)) visit(c as Area, inner);
    };
    visit(tree.sheets[0].page.regionBody as Area, 0);
    return found!;
  };
  for (const compat of ['spec', 'antenna'] as const) {
    for (const align of ['center', 'end'] as const) {
      it(`${compat}・${align}: 行の幅と表の内容の幅が合い、最後のセルが表の罫線に届き、width="80pt" の表と同じ所に寄る`, () => {
        const t = measure(`<fo:table-and-caption text-align="${align}">${table('border="6pt solid"')}</fo:table-and-caption>`, compat);
        expect(t.content).toBeCloseTo(74, 2);
        expect(t.rows.length).toBe(2);
        for (const r of t.rows) {
          // 行の幅は表の内容の幅 (前は、表の内容が 80pt で、行が 74pt。最後のセルと表の右の罫線の間が 6pt 空いた)
          expect(r.x0).toBeCloseTo(t.x0 + 6, 2);
          expect(r.x1).toBeCloseTo(t.x1 - 6, 2);
          expect(r.lastCell).toBeCloseTo(t.x1 - 6, 2);
        }
        // 寄せの位置は、幅を書いた表 (width="80pt") と同じ
        const w = measure(`<fo:table-and-caption text-align="${align}">${table('border="6pt solid" width="80pt"')}</fo:table-and-caption>`, compat);
        expect([t.x0, t.x1]).toEqual([expect.closeTo(w.x0, 2), expect.closeTo(w.x1, 2)]);
        // 表の罫線の箱は 86pt (グリッドの幅 80 と、外へ出る半分 3pt × 2)
        expect(t.x1 - t.x0).toBeCloseTo(86, 2);
      });
    }
  }
  it('幅を書いた表・外周の罫線をセルが持つ表・罫線を分ける表の寄せは、変わらない', () => {
    for (const compat of ['spec', 'antenna'] as const) {
      // 直す前と同じ値 (表の罫線の箱の左端・右端)
      const w = measure(`<fo:table-and-caption text-align="center">${table('border="6pt solid" width="80pt"')}</fo:table-and-caption>`, compat);
      expect([w.x0, w.x1]).toEqual([expect.closeTo(104, 2), expect.closeTo(190, 2)]);
      const cells = measure(`<fo:table-and-caption text-align="center">${table('')}</fo:table-and-caption>`, compat);
      expect([cells.x0, cells.x1]).toEqual([expect.closeTo(109, 2), expect.closeTo(191, 2)]);
      expect(cells.rows[0].lastCell).toBeCloseTo(191, 2);
      const sep = measure(`<fo:table-and-caption text-align="center">${table('border="6pt solid"', 'separate')}</fo:table-and-caption>`, compat);
      expect([sep.x0, sep.x1]).toEqual([expect.closeTo(104, 2), expect.closeTo(196, 2)]);
      expect(sep.rows[0].lastCell).toBeCloseTo(190, 2);
    }
  });
});
