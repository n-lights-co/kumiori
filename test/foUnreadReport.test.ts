/**
 * 読まずに捨てた XSL-FO の属性・要素と、字形の無い字を、黙って捨てずに知らせる (台帳の FO-22 の C・D・E)。
 * 読み込みが値を 1 度も尋ねなかった属性は効かないので、読み込みの報告 (ImportReport.unsupported → typeset の warnings) に数える。
 * text-align の文字列の値は XSL 1.1 §7.16.9 の <string> (https://www.w3.org/TR/xsl11/ 2026-11-11 取得)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { DEFAULT_FONTS, typesetFo, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/><fo:region-before extent="5mm"/></fo:simple-page-master></fo:layout-master-set>';
const fo = (flow: string, o: { seq?: string; flowName?: string; statics?: string; root?: string } = {}) =>
  `<?xml version="1.0"?><fo:root ${NS} ${o.root ?? ''}>${PM}<fo:page-sequence master-reference="m" ${o.seq ?? ''}>${o.statics ?? ''}<fo:flow flow-name="${o.flowName ?? 'xsl-region-body'}">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const BOTH = ['spec', 'antenna'] as const;
const miss = (xml: string, compat: 'spec' | 'antenna' = 'antenna') => importXslFo(xml, parse, { compat }).report.unsupported;

describe('FO-22 C・D: 読まずに捨てた属性を、読み込みの報告に数える', () => {
  it('効かない axf: の指定 (行番号の表示・間隔の色など、文字列でのそろえ、寸法での keep、行のグリッドへの揃え) を知らせる', () => {
    const names = [
      'axf:line-number-show',
      'axf:line-number-background-color',
      'axf:line-number-display-align',
      'axf:text-align-string',
      'axf:keep-together-within-dimension',
      'axf:baseline-block-snap',
    ];
    for (const c of BOTH) {
      const r = miss(fo(`<fo:block ${names.map((n) => `${n}="x"`).join(' ')}>a</fo:block><fo:block axf:line-number-show="x">b</fo:block>`), c);
      for (const n of names) expect(r[n], n).toBe(n === 'axf:line-number-show' ? 2 : 1);
    }
  });

  it('行番号の間隔 (axf:line-number-interval) は、ブロックでは読むので数えない。読まない要素 (fo:table-column) に書けば、要素の名前つきで知らせる', () => {
    const tbl = (col: string) => `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="20mm" ${col}/><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    expect(miss(fo('<fo:block axf:line-number="show" axf:line-number-interval="5">a</fo:block>'))).toEqual({});
    expect(miss(fo('<fo:block axf:line-number-interval="5">a</fo:block>' + tbl('axf:line-number-interval="5"')))).toEqual({ 'axf:line-number-interval (fo:table-column)': 1 });
  });

  it('axf:line-number の読めない値を知らせる', () => {
    expect(miss(fo('<fo:block axf:line-number="odd">a</fo:block>'))).toEqual({ 'axf:line-number:odd': 1 });
  });

  it('text-align の文字列の値 (§7.16.9 の <string>) は未対応: start として組み、指定した要素ごとに 1 度知らせる', () => {
    for (const c of BOTH) {
      const r = importXslFo(fo(`<fo:block text-align="'.'">1.5<fo:block>2.25</fo:block></fo:block><fo:block text-align="end">b</fo:block>`), parse, { compat: c });
      expect(r.report.unsupported).toEqual({ 'text-align:<string>': 1 });
      expect((r.document.sequences[0].flow.children[0] as { textAlign?: string }).textAlign).toBe('start');
    }
  });

  it('綴りの誤り・FO に無い性質も、属性の名前で知らせる', () => {
    expect(miss(fo('<fo:block font-wieght="bold" axf:no-such-property="1">a</fo:block>'))).toEqual({ 'font-wieght': 1, 'axf:no-such-property': 1 });
  });

  it('読む属性は数えない (書式・余白・罫線・改ページ・id・一括指定・fo:character・リストの本体の body-start()・番号の区切り)', () => {
    const body =
      '<fo:block id="a" font="italic bold 12pt/1.5 serif" color="red" background="yellow" border="1pt solid black" padding="2pt" margin="1pt" space-before="1em" space-before.conditionality="retain" ' +
      'start-indent="2mm" text-align="justify" text-align-last="start" keep-with-next="always" break-before="page" span="all" page-break-inside="avoid" role="x" source-document="y" xml:lang="ja">' +
      'a<fo:inline font-weight="bold" baseline-shift="super" axf:border-radius="2pt" border="1pt solid red">b</fo:inline><fo:character character="c" color="blue"/><fo:page-number/></fo:block>' +
      '<fo:list-block provisional-distance-between-starts="10mm" provisional-label-separation="2mm">' +
      ['1', '2'].map((n) => `<fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>${n}</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()"><fo:block>x</fo:block></fo:list-item-body></fo:list-item>`).join('') +
      '</fo:list-block>';
    const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block text-align="end"><fo:page-number/></fo:block></fo:static-content>';
    for (const c of BOTH) expect(miss(fo(body, { seq: 'initial-page-number="3" format="1" grouping-separator="," grouping-size="3" force-page-count="no-force"', statics, root: 'font-family="serif" font-size="10pt"' }), c)).toEqual({});
  });

  it('本文の領域の名前でない fo:flow の flow-name は、読まずに捨てた属性として知らせる', () => {
    expect(miss(fo('<fo:block>a</fo:block>', { flowName: 'spread' }))).toEqual({ 'flow-name (fo:flow)': 1 });
  });

  it('中の要素ごと読まなかった要素は、要素の名前で 1 度だけ知らせる (中の属性を重ねて数えない)', () => {
    const r = miss(fo('<fo:block>a<fo:change-bar-begin change-bar-class="c" change-bar-style="solid"><fo:float float="start"><fo:block font-size="8pt" color="red">改</fo:block></fo:float></fo:change-bar-begin>b<fo:change-bar-end change-bar-class="c"/></fo:block>'));
    expect(r).toEqual({ 'fo:float (fo:change-bar-begin の中)': 1 });
  });

  it('要素ごと捨てたもの (知らない要素・知らない名前の static-content) は、今までどおり要素で 1 度だけ知らせる', () => {
    const statics = '<fo:static-content flow-name="no-such-region"><fo:block font-size="8pt">f</fo:block></fo:static-content>';
    expect(miss(fo('<fo:block>a<axf:unknown-thing some="1"><fo:inline color="red">b</fo:inline></axf:unknown-thing></fo:block>', { statics }))).toEqual({ 'static-content:no-such-region': 1, 'axf:unknown-thing': 1 });
  });

  it('ページマスターに領域が無くて組まれない fo:static-content は、数えない (§6.4.1.4: 流れは同じ名前の領域に割り当てる)', () => {
    const statics = '<fo:static-content flow-name="xsl-region-after"><fo:block font-size="8pt">f</fo:block></fo:static-content>';
    expect(miss(fo('<fo:block>a</fo:block>', { statics }))).toEqual({});
  });

  it('字だけを読む fo:bookmark-title の属性は、要素の名前つきで知らせる', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:bookmark-tree><fo:bookmark internal-destination="a"><fo:bookmark-title font-weight="bold">題</fo:bookmark-title></fo:bookmark></fo:bookmark-tree><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block id="a">a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    expect(miss(xml)).toEqual({ 'font-weight (fo:bookmark-title)': 1 });
  });
});

describe('FO-22 E: 読み込んだどの書体にも字形の無い字を知らせる', () => {
  const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  const loadFont = async (spec: FontSpec) => {
    const f = fileOf(spec);
    if (!fs.existsSync(f)) return undefined;
    const b = fs.readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  beforeAll(async () => {
    await ensureFonts([...DEFAULT_FONTS.base]);
  }, 300_000);
  const TOFU = /^読み込んだどの書体にも字形の無い字があります/;
  // U+E000・U+F8FF は私用領域 (既定の書体に字形が無い)。U+200B (ゼロ幅の空白)・U+FE0F (異体字セレクタ) は、字形が無くても見えないので数えない
  const text = 'あい​️ う';

  it('XSL-FO: 字と数を、多い順に 1 行で知らせる。無ければ出さない', async () => {
    const r = await typesetFo(fo(`<fo:block>${text}</fo:block>`), { name: 't.fo', loadFont });
    expect(r.warnings.filter((w) => TOFU.test(w))).toEqual(['読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます):  (U+E000 ×2)、 (U+F8FF)']);
    const ok = await typesetFo(fo('<fo:block>あいう abc 123 ①</fo:block>'), { name: 't.fo', loadFont });
    expect(ok.warnings.filter((w) => TOFU.test(w))).toEqual([]);
  });

  it('HTML: 同じ経路で知らせる', async () => {
    const r = await typesetHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body><p>${text}</p></body></html>`, { name: 't.html', loadFont });
    expect(r.warnings.filter((w) => TOFU.test(w))).toEqual(['読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます):  (U+E000 ×2)、 (U+F8FF)']);
  });

  it('多すぎるときは、先頭の 20 種と残りの数', async () => {
    const many = Array.from({ length: 25 }, (_, k) => String.fromCodePoint(0xe100 + k)).join('');
    const r = await typesetFo(fo(`<fo:block>${many}</fo:block>`), { name: 't.fo', loadFont });
    expect(r.warnings.find((w) => TOFU.test(w))).toMatch(/ …ほか 5 種$/);
  });
});
