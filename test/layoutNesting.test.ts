/**
 * 入れ子の深い文書で、組版の手間が深さに対して指数的に増えないこと (LAY-12・LAY-13)。
 * 幅を中身で決める箱 (表の auto の列・float・inline-block・絶対配置の箱・回した箱) と段組は、中身を「計測で 1〜2 回・本番で 1 回」組むので、
 * 計測の結果を覚えないと、入れ子の 1 段ごとに組む回数が 2〜5 倍になる。計測の結果は、同じ組版の中で覚えて使い回す (Flow.memoMeasure)。
 * 時間ではなく、組んだ回数 (LayoutEngine.stats) で確かめる。覚えを切った組版 (LayoutOptions.measureMemo: false) と結果が同じことも確かめる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { FAMILY, makeEngine } from './helpers';
import { LayoutEngine } from '../src/layoutEngine';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
import { serializeAreaTree } from '../src/areaTree';
import type { LDocument } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
/** 計測の覚えを切ったエンジン (結果を比べる) */
let plain: LayoutEngine;
beforeAll(async () => {
  E = await makeEngine();
  plain = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo: false });
});

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as never;
const nest = (open: string, close: string, n: number, leaf: string) => open.repeat(n) + leaf + close.repeat(n);
const html = (body: string): LDocument => {
  const d = parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;
  const css = '@page { size: A5; margin: 10mm } body { margin: 0 }';
  return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css }).document;
};
const fo = (body: string, compat: 'antenna' | 'spec' = 'antenna', pageHeight = '297mm'): LDocument =>
  importXslFo(
    `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="210mm" page-height="${pageHeight}" margin="20mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`,
    parse,
    { compat },
  ).document;

const TEXT = 'あいう abc';
const BLOCK = `<fo:block>${TEXT}</fo:block>`;
const FO_TABLE: [string, string] = ['<fo:table><fo:table-body><fo:table-row><fo:table-cell>', '</fo:table-cell></fo:table-row></fo:table-body></fo:table>'];

/**
 * 入れ子の種類: 深さ n の文書と、確かめる深さ (deep)・その深さで組む流れ (Flow) の数の上限 (max)。
 * 上限は、直した後の数の数倍。直す前は、どれも上限の 8 倍を超える (1 段ごとの倍率と、deep での数を右に書く)
 */
const kinds: Array<{ name: string; doc: (n: number) => LDocument; deep: number; max: number; same?: number[] }> = [
  // 直す前: 1 段ごとに 3 倍 (10 段で 88573)。collapse の表は、組むたびにセルを写すので、セルごとの覚え (host.cellMeasure) が当たらなかった
  { name: 'XSL-FO の表 (collapse)', doc: (n) => fo(nest(...FO_TABLE, n, BLOCK)), deep: 10, max: 500 },
  // 直す前: 3 倍 (10 段で 88573)
  { name: 'XSL-FO の表 (ページ番号の参照を含む)', doc: (n) => fo(nest(...FO_TABLE, n, '<fo:block id="x">p.<fo:page-number-citation ref-id="x"/></fo:block>')), deep: 10, max: 500 },
  // 直す前: 3 倍 (8 段で 29523)
  {
    name: 'XSL-FO の表 (keep-with-next の見出しの後・keep-together)',
    doc: (n) => fo('<fo:block>a</fo:block>' + nest(`<fo:block keep-with-next="always">h</fo:block><fo:table keep-together="always"><fo:table-body><fo:table-row><fo:table-cell>`, FO_TABLE[1], n, BLOCK)),
    deep: 8,
    max: 1000,
  },
  // 直す前: 3 倍を超える (ページの高さ 70mm。8 段で 8 秒、10 段で 100 秒を超える)。表の行をページで分ける試し組み (splitRow) の中で、
  // 内側の keep-with-next の試し組みを繰り返していた
  {
    name: 'XSL-FO の表 (keep-with-next の見出しの後・ページをまたぐ)',
    doc: (n) => fo('<fo:block>a</fo:block>' + nest(`<fo:block keep-with-next="always">h</fo:block><fo:table keep-together="always"><fo:table-body><fo:table-row><fo:table-cell>`, FO_TABLE[1], n, BLOCK), 'antenna', '70mm'),
    deep: 8,
    max: 4000,
    // 6 段からページをまたぐ
    same: [3, 6, 7],
  },
  // 直す前: 2 段ごとに 3 倍 (16 段で 12019)
  { name: 'XSL-FO の inline-container', doc: (n) => fo(nest('<fo:block><fo:inline-container>', '</fo:inline-container></fo:block>', n, BLOCK)), deep: 16, max: 2500 },
  // 直す前: 2 倍 (14 段で 32767)
  { name: 'XSL-FO の float', doc: (n) => fo(nest('<fo:block><fo:float float="start">', '</fo:float></fo:block>', n, BLOCK)), deep: 14, max: 2000 },
  // 直す前: 2 倍 (12 段で 16369)
  { name: 'XSL-FO の 90° 回したコンテナ', doc: (n) => fo(nest('<fo:block-container reference-orientation="90">', '</fo:block-container>', n, BLOCK)), deep: 12, max: 2000 },
  // 直す前: 5〜7 倍 (6 段で 56927)
  { name: 'XSL-FO の段組のコンテナ', doc: (n) => fo(nest('<fo:block-container column-count="2">', '</fo:block-container>', n, BLOCK)), deep: 6, max: 2000 },
  // 直す前: 2 段ごとに 3 倍 (16 段で 12306)
  { name: 'HTML の inline-block', doc: (n) => html(nest('<span style="display:inline-block">', '</span>', n, TEXT)), deep: 16, max: 2500 },
  // 直す前: 2 倍 (14 段で 32767)
  { name: 'HTML の float', doc: (n) => html(nest('<div style="float:left">', '</div>', n, TEXT)), deep: 14, max: 2000 },
  // 直す前: 2 倍 (14 段で 36863)
  { name: 'HTML の絶対配置の箱', doc: (n) => html(nest('<div style="position:absolute">', '</div>', n, TEXT)), deep: 14, max: 1500 },
  // 直す前: 2 倍 (包含ブロックになる position: relative の箱と、その中の絶対配置の箱の組)
  { name: 'HTML の position: relative の中の絶対配置の箱', doc: (n) => html(nest('<div style="position:relative"><div style="position:absolute">', '</div></div>', n, TEXT)), deep: 14, max: 3000 },
  // 直す前: 2 倍 (14 段で 32795)
  { name: 'HTML の表の見出し (caption) の中の表', doc: (n) => html(nest('<table><caption>', '</caption><tr><td>c</td></tr></table>', n, TEXT)), deep: 14, max: 1500 },
  // 直す前: 5 倍 (6 段で 28435)
  { name: 'HTML の段組 (column-count)', doc: (n) => html(nest('<div style="column-count:2">', '</div>', n, TEXT)), deep: 6, max: 2000 },
];

describe('入れ子の深さと、組む回数 (LAY-12・LAY-13)', () => {
  for (const k of kinds) {
    it(`${k.name}: ${k.deep} 段で組む流れの数が上限 (${k.max}) を超えない`, () => {
      const tree = E.engine.layout(k.doc(k.deep));
      expect(tree.sheets.length).toBeGreaterThan(0);
      expect(E.engine.stats.flows).toBeGreaterThan(0);
      expect(E.engine.stats.flows).toBeLessThanOrEqual(k.max);
    }, 60_000);

    it(`${k.name}: 深さを 2 倍 (12 段 → 24 段) にしても、組む流れの数は 16 倍 (深さの 4 乗) を超えない`, () => {
      E.engine.layout(k.doc(12));
      const a = E.engine.stats.flows;
      E.engine.layout(k.doc(24));
      const b = E.engine.stats.flows;
      // 指数的なら、1 段ごとに 1.7 倍でも 12 段で 500 倍を超える
      expect(b).toBeLessThanOrEqual(a * 16);
    }, 60_000);

    it(`${k.name}: 計測の覚えを切った組版と、結果 (Area Tree) が同じ`, () => {
      for (const n of k.same ?? [1, 2, 3, 4]) {
        const d = k.doc(n);
        expect(serializeAreaTree(E.engine.layout(d)), `${n} 段`).toBe(serializeAreaTree(plain.layout(d)));
      }
    }, 60_000);
  }

  it('表・inline-block・float・段組・絶対配置を混ぜた入れ子 (HTML): 60 段で組む流れの数が上限を超えない', () => {
    // 直す前: 5 段ごとに 30 倍を超える (20 段で 45 秒)
    const w: Array<[string, string]> = [
      ['<table><tr><td>', '</td></tr></table>'],
      ['<span style="display:inline-block">', '</span>'],
      ['<div style="float:left">', '</div>'],
      ['<div style="column-count:2">', '</div>'],
      ['<div style="position:absolute">', '</div>'],
    ];
    const mixed = (n: number) => {
      let x = TEXT;
      for (let i = 0; i < n; i++) x = w[i % w.length][0] + x + w[i % w.length][1];
      return html(x);
    };
    E.engine.layout(mixed(60));
    expect(E.engine.stats.flows).toBeLessThanOrEqual(30000);
    for (const n of [3, 5, 7]) expect(serializeAreaTree(E.engine.layout(mixed(n))), `${n} 段`).toBe(serializeAreaTree(plain.layout(mixed(n))));
  }, 120_000);

  it('入れ子の表の中のページ番号の参照・脚注・読めない画像の警告は、覚えを切った組版と同じ', () => {
    const fn = (k: number) => `<fo:footnote><fo:inline><fo:footnote-citation/></fo:inline><fo:footnote-body><fo:block><fo:footnote-citation/> 脚注 ${k} p.<fo:page-number-citation ref-id="s2"/></fo:block></fo:footnote-body></fo:footnote>`;
    const cell = (inner: string) => `<fo:table><fo:table-body><fo:table-row><fo:table-cell border="1pt solid black">${inner}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const sec = (k: number) =>
      `<fo:block id="s${k}">節 ${k} p.<fo:page-number-citation ref-id="s${k + 1}"/> <fo:page-number-citation ref-id="none"/></fo:block>` +
      cell(`<fo:block>外${fn(k)} ${'文章。'.repeat(40)}</fo:block>` + cell(`<fo:block>内${fn(k + 10)}<fo:inline-container><fo:block>箱 <fo:page-number-citation ref-id="s${6 - k}"/><fo:external-graphic src="url(none${k}.png)"/></fo:block></fo:inline-container></fo:block>`)) +
      `<fo:block-container column-count="2"><fo:block>${'段組。'.repeat(60)}</fo:block>${cell(`<fo:block>段の中 <fo:page-number-citation ref-id="s1"/></fo:block>`)}</fo:block-container>`;
    const body = Array.from({ length: 5 }, (_, k) => sec(k + 1)).join('') + '<fo:block id="s6">終</fo:block>';
    for (const compat of ['antenna', 'spec'] as const) {
      const d = fo(body, compat);
      const a = E.engine.layout(d);
      const b = plain.layout(d);
      expect(a.sheets.length).toBeGreaterThan(1);
      expect(a.warnings).toEqual(b.warnings);
      expect(serializeAreaTree(a)).toBe(serializeAreaTree(b));
    }
  }, 120_000);
});

/**
 * LAY-18 組む回数の総量の上限と、段組の入れ子の深さの上限。超えたら、以後の箱は中身の幅を測らずに組み、段組は 1 段に組む (警告を出す)。
 * 種類を混ぜた XSL-FO の入れ子 (幅が段ごとに変わる) は、覚え (memoMeasure) が当たらず、深さの 4 乗ほどで組む回数が増える
 * (上限なしで 50 段 25 万回)。中身がページからあふれる段組の入れ子は、外側の段の高さの二分探索の値ごとに内側の探索をやり直す
 */
describe('幅を中身で決める箱・段組の入れ子の上限 (LAY-18)', () => {
  // inline-container (padding)・start-indent の段・inline-container・float・字に挟まれた inline-container を順に繰り返す
  const P: Array<[string, string]> = [
    ['<fo:block><fo:inline-container padding="1pt">', '</fo:inline-container></fo:block>'],
    ['<fo:block start-indent="inherited-property-value(start-indent) + 2pt">', '</fo:block>'],
    ['<fo:block><fo:inline-container>', '</fo:inline-container></fo:block>'],
    ['<fo:block><fo:float float="start">', '</fo:float></fo:block>'],
    ['<fo:block>x<fo:inline-container>', '</fo:inline-container>y</fo:block>'],
  ];
  const mixed = (n: number) => {
    let x = '<fo:block>あいうえおかきくけこ abc def </fo:block>';
    for (let i = 0; i < n; i++) x = P[i % P.length][0] + x + P[i % P.length][1];
    return fo(x);
  };
  const overflowColumns = (n: number) => fo('<fo:block-container column-count="2">'.repeat(n) + `<fo:block>${'あいうえお'.repeat(60)}</fo:block>` + '</fo:block-container>'.repeat(n));
  const warned = (w: string[]) => w.some((m) => m.includes('入れ子が深すぎます'));

  it('種類を混ぜた XSL-FO の入れ子: 120 段で組む流れの数が上限を超えず、警告が出る', () => {
    // 上限なし: 20 段で 5255、40 段で 108403、50 段で 257222、120 段で 3863943 (深さの 4 乗ほど)。上限 (100000) を超えたら測らない
    const t = E.engine.layout(mixed(120));
    expect(E.engine.stats.flows).toBeLessThanOrEqual(150000);
    expect(warned(t.warnings)).toBe(true);
  }, 120_000);

  it('中身がページからあふれる段組の入れ子: 10 段で組む流れの数が上限を超えず、警告が出る', () => {
    const t = E.engine.layout(overflowColumns(10));
    expect(E.engine.stats.flows).toBeLessThanOrEqual(1500);
    expect(warned(t.warnings)).toBe(true);
  }, 120_000);

  it('上限より浅い入れ子は、上限を切った組版と同じで、警告も出ない', () => {
    const free = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxMeasureFlows: Infinity, maxColumnNest: Infinity });
    for (const d of [mixed(20), overflowColumns(3)]) {
      const a = E.engine.layout(d);
      expect(warned(a.warnings)).toBe(false);
      expect(serializeAreaTree(a)).toBe(serializeAreaTree(free.layout(d)));
    }
  }, 120_000);
});
