/**
 * XSL-FO の取り込みの「結果の誤り」の手直し (全体レビューの FO-03〜FO-16)。
 * 仕様は XSL 1.1 (https://www.w3.org/TR/xsl11/ 2026-11-10 取得) で確かめた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, LBlock, LBookmark, LFootnote, LInline, LInlineContainer, LLeader, LPageSequence, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
/** 100mm × 200mm・余白 10mm のページ (本文 80mm × 180mm)。region-body の指定 b、ヘッダ (region-before) つき */
const PM = (b = '') =>
  `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="200mm" margin="10mm"><fo:region-body margin-top="10mm" ${b}/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set>`;
interface FoParts {
  /** fo:page-sequence の属性 */
  seq?: string;
  /** fo:flow の属性 */
  flow?: string;
  /** fo:static-content の並び */
  statics?: string;
  /** fo:region-body の属性 */
  body?: string;
  /** fo:page-sequence の前に置くもの (fo:bookmark-tree など) */
  pre?: string;
}
const seqXml = (flow: string, p: FoParts = {}) => `<fo:page-sequence master-reference="m" ${p.seq ?? ''}>${p.statics ?? ''}<fo:flow flow-name="xsl-region-body" ${p.flow ?? ''}>${flow}</fo:flow></fo:page-sequence>`;
const fo = (flow: string, p: FoParts = {}) => `<?xml version="1.0"?><fo:root ${NS}>${PM(p.body)}${p.pre ?? ''}${seqXml(flow, p)}</fo:root>`;
type Compat = 'spec' | 'antenna';
const imp = (xml: string, o: ImportOptions = {}) => importXslFo(xml, parse, { compat: 'spec', ...o });
const seq = (xml: string, compat: Compat = 'spec'): LPageSequence => imp(xml, { compat }).document.sequences[0];
const first = <T>(xml: string, compat: Compat = 'spec') => seq(xml, compat).flow.children[0] as T;
const BOTH = ['spec', 'antenna'] as const;

/** 領域の木の中の字を、順につないだ文字列 */
const textOf = (areas: readonly unknown[]): string => {
  const g: string[] = [];
  for (const a of areas) walk(a as Area, (n) => n.type === 'glyph' && g.push(n.text));
  return g.join('');
};
const filler = (n: number) => Array.from({ length: n }, (_, i) => `<fo:block>行${i}</fo:block>`).join('');

describe('FO-03: fo:page-sequence・fo:flow の id を引くページ番号の参照 (§6.6.11・§6.6.12・§7.30.8)', () => {
  it('「全 N ページ」: page-sequence の id を引く page-number-citation-last が、本文でも static-content でも最後のページの番号になる', () => {
    const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block><fo:page-number/>/<fo:page-number-citation-last ref-id="ps"/></fo:block></fo:static-content>';
    const xml = fo(`<fo:block>全<fo:page-number-citation-last ref-id="ps"/>ページ。初<fo:page-number-citation ref-id="ps"/></fo:block>${filler(80)}`, { seq: 'id="ps"', statics });
    for (const compat of BOTH) {
      const tree = E.engine.layout(imp(xml, { compat }).document);
      const total = tree.sheets.length;
      expect(total).toBeGreaterThan(2);
      expect(tree.warnings).toEqual([]);
      expect(textOf(tree.sheets[0].page.regionBody.children.slice(0, 1))).toBe(`全${total}ページ。初1`);
      tree.sheets.forEach((s, i) => expect(textOf(s.page.absoluteAreas)).toBe(`${i + 1}/${total}`));
    }
  });
  it('page-sequence の id は、その page-sequence の最初と最後のページを指す (initial-page-number・後ろの page-sequence からの参照)', () => {
    const a = seqXml(filler(50), { seq: 'id="a" initial-page-number="11"' });
    const b = seqXml('<fo:block>前は<fo:page-number-citation ref-id="a"/>から<fo:page-number-citation-last ref-id="a"/>まで</fo:block>', { seq: 'id="b"' });
    const tree = E.engine.layout(imp(`<fo:root ${NS}>${PM()}${a}${b}</fo:root>`).document);
    const nA = tree.sheets.length - 1;
    expect(nA).toBeGreaterThan(1);
    expect(textOf(tree.sheets[nA].page.regionBody.children)).toBe(`前は11から${10 + nA}まで`);
    expect(tree.warnings).toEqual([]);
  });
  it('fo:flow の id は、本文の置かれた最初と最後のページ。page-sequence の id の最後のページは、force-page-count で足した白ページも含む', () => {
    const one = (force: string) => {
      const xml = fo(`<fo:block>本文<fo:page-number-citation ref-id="fl"/>-<fo:page-number-citation-last ref-id="fl"/>、全体<fo:page-number-citation-last ref-id="ps"/></fo:block>`, { seq: `id="ps" ${force}`, flow: 'id="fl"' });
      const tree = E.engine.layout(imp(xml).document);
      expect(tree.warnings).toEqual([]);
      return { pages: tree.sheets.length, text: textOf(tree.sheets[0].page.regionBody.children) };
    };
    expect(one('')).toEqual({ pages: 1, text: '本文1-1、全体1' });
    expect(one('force-page-count="even"')).toEqual({ pages: 2, text: '本文1-1、全体2' });
  });
});

describe('FO-04: fo:page-sequence に書いた継承される特性 (§5.1.4)', () => {
  it('text-transform が中の文字に効く', () => {
    for (const compat of BOTH) expect(first<LBlock>(fo('<fo:block>abc</fo:block>', { seq: 'text-transform="uppercase"' }), compat).children).toEqual(['ABC']);
  });
  it('font-weight・color は、中の bolder / lighter・罫線の色などの「継承した値」になる', () => {
    const b = first<LBlock>(fo('<fo:block><fo:inline font-weight="lighter">a</fo:inline></fo:block>', { seq: 'font-weight="bold"' }));
    // 継承した太さ 700 の lighter は 400 (fo:root の 400 から決めると 100)
    expect((b.children[0] as LInline).fontWeight).toBe(400);
  });
  it('fo:root の指定は、page-sequence が上書きしなければそのまま伝わる', () => {
    const xml = `<fo:root ${NS} text-transform="uppercase">${PM()}${seqXml('<fo:block>abc</fo:block>')}</fo:root>`;
    expect(first<LBlock>(xml).children).toEqual(['ABC']);
  });
});

describe('FO-07: fo:footnote・fo:footnote-body に書いた字の書式 (継承される特性。§5.1.4)', () => {
  const fn = (attrs: string, bodyAttrs: string, compat: Compat = 'spec') =>
    (first<LBlock>(fo(`<fo:block font-weight="bold" color="#ff0000">x<fo:footnote ${attrs}><fo:inline>1</fo:inline><fo:footnote-body ${bodyAttrs}><fo:block>note</fo:block></fo:footnote-body></fo:footnote></fo:block>`), compat).children[1] as LFootnote);
  it('指定が無ければ、周りから受け継いだ書式のまま', () => {
    const f = fn('', '');
    expect(f.fontWeight).toBe(700);
    expect(f.color).toBe('#ff0000');
  });
  it('footnote-body の font-weight・color・text-align・line-height が本体に効く', () => {
    for (const compat of BOTH) {
      const f = fn('', 'font-weight="normal" color="#808080" text-align="end" line-height="1.1" font-size="8pt"', compat);
      expect(f.fontWeight).toBe(400);
      expect(f.color).toBe('#808080');
      expect(f.textAlign).toBe('end');
      expect(f.lineHeight).toBe(1.1);
      expect(f.fontSize).toBe(8);
    }
  });
  it('fo:footnote の指定も本体に伝わり、footnote-body の指定が勝つ', () => {
    expect(fn('color="#0000ff" font-style="italic"', '').color).toBe('#0000ff');
    expect(fn('color="#0000ff" font-style="italic"', '').fontStyle).toBe('italic');
    expect(fn('color="#0000ff"', 'color="#808080"').color).toBe('#808080');
    // 長さの line-height を受け継いだ上に、数の line-height を書いたら、長さの方は残さない
    const f = fn('line-height="20pt"', 'line-height="1.5"');
    expect(f.lineHeight).toBe(1.5);
    expect(f.lineHeightPt).toBeUndefined();
  });
});

describe('FO-08: fo:page-number 自身の字の書式 (§6.6.10 の共通フォント特性・color)', () => {
  const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block>H<fo:page-number font-weight="bold" color="#ff0000"/></fo:block></fo:static-content>';
  const xml = fo('<fo:block>p<fo:page-number font-weight="bold" color="#ff0000"/></fo:block>', { statics });
  it('本文・static-content のどちらでも、書式を持つ行内の箱で包む', () => {
    for (const compat of BOTH) {
      const s = seq(xml, compat);
      const inFlow = (s.flow.children[0] as LBlock).children[1] as LInline;
      expect(inFlow).toMatchObject({ type: 'inline', fontWeight: 700, color: '#ff0000' });
      const inStatic = (s.staticContent![0].children[0] as LBlock).children[1] as LInline;
      expect(inStatic).toMatchObject({ type: 'inline', fontWeight: 700, color: '#ff0000', children: ['{pageNumber}'] });
    }
  });
  it('書式の無い fo:page-number は従来どおり (static-content では文字列の印)', () => {
    const s = seq(fo('<fo:block>a</fo:block>', { statics: '<fo:static-content flow-name="xsl-region-before"><fo:block>H<fo:page-number/></fo:block></fo:static-content>' }));
    expect((s.staticContent![0].children[0] as LBlock).children).toEqual(['H{pageNumber}']);
  });
  it('組んだ結果: ページ番号に置き換わる', () => {
    const tree = E.engine.layout(imp(xml).document);
    expect(textOf(tree.sheets[0].page.absoluteAreas)).toBe('H1');
    expect(textOf(tree.sheets[0].page.regionBody.children)).toBe('p1');
  });
});
