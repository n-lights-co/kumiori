/**
 * XSL-FO の取り込みの「結果の誤り」の手直し (全体レビューの FO-03〜FO-16)。
 * 仕様は XSL 1.1 (https://www.w3.org/TR/xsl11/ 2026-11-10 取得) で確かめた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import { childrenOf } from '../src/areaTree';
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

describe('FO-05: 表のセルの中の start-indent・end-indent (セルは参照領域。§6.7.10・§7.11.7・§7.11.8)', () => {
  const table = (cell: string, outer = 'start-indent="20pt" end-indent="12pt"') =>
    fo(`<fo:block ${outer}><fo:table table-layout="fixed" width="150pt" start-indent="20pt" end-indent="0pt"><fo:table-column column-width="150pt"/><fo:table-body><fo:table-row><fo:table-cell>${cell}</fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:block>`);
  const cellBlock = (xml: string, compat: Compat) => ((first<LBlock>(xml, compat).children[0] as LTable).body.rows[0].cells[0].children[0] as LBlock);
  it('セルの中で明示した start-indent・end-indent は、セルの内容の端から測る (外の字下げを引かない)', () => {
    for (const compat of BOTH) {
      const b = cellBlock(table('<fo:block start-indent="5pt" end-indent="3pt">あ</fo:block>'), compat);
      expect(b.margin).toEqual({ left: 5, right: 3 });
    }
  });
  it('組んだ結果: セルの中の字は、セルの端から start-indent だけ内側 (外へはみ出さない)', () => {
    const x = (cell: string) => {
      const tree = E.engine.layout(imp(table(cell)).document);
      let gx: number | undefined;
      type A = { x: number; type: string; children?: A[] };
      const visit = (a: A, ox: number) => {
        if (a.type === 'glyph' && gx === undefined) gx = ox + a.x;
        for (const c of a.children ?? []) visit(c, ox + a.x);
      };
      for (const c of tree.sheets[0].page.regionBody.children as unknown as A[]) visit(c, 0);
      return gx!;
    };
    expect(x('<fo:block start-indent="5pt">あ</fo:block>') - x('<fo:block start-indent="0pt">あ</fo:block>')).toBeCloseTo(5, 3);
  });
  it('セルの中の入れ子のブロックは、明示した値からの差で下がる', () => {
    const b = cellBlock(table('<fo:block start-indent="5pt"><fo:block start-indent="8pt">あ</fo:block></fo:block>'), 'spec');
    expect((b.children[0] as LBlock).margin).toEqual({ left: 3 });
  });
});

describe('FO-06: 縦書き・回転した本文の百分率の基準 (行の進む方向の寸法)', () => {
  const ti = (p: FoParts) => first<LBlock>(fo('<fo:block text-indent="10%">あ</fo:block>', p)).textIndent;
  const W = (80 * 72) / 25.4;
  const H = (170 * 72) / 25.4; // 本文の高さ: 200mm − 余白 20mm − region-body の margin-top 10mm
  it('横書きは本文の幅、縦書き (tb-rl) は本文の高さに対する割合', () => {
    expect(ti({})).toBeCloseTo(W / 10, 3);
    expect(ti({ seq: 'writing-mode="tb-rl"' })).toBeCloseTo(H / 10, 3);
    expect(ti({ body: 'writing-mode="tb-rl"' })).toBeCloseTo(H / 10, 3);
  });
  it('90 度・270 度回した本文 (reference-orientation) は、横書きなら本文の高さ、縦書きなら本文の幅', () => {
    expect(ti({ body: 'reference-orientation="90"' })).toBeCloseTo(H / 10, 3);
    expect(ti({ seq: 'reference-orientation="270"' })).toBeCloseTo(H / 10, 3);
    expect(ti({ body: 'reference-orientation="180"' })).toBeCloseTo(W / 10, 3);
    expect(ti({ body: 'reference-orientation="90" writing-mode="tb-rl"' })).toBeCloseTo(W / 10, 3);
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

describe('FO-09: 数式の後備の「全体が 1 つの mtable なら下端を字の下端に揃える」は互換モードだけ', () => {
  const math = '<fo:block>x<fo:instream-foreign-object><math xmlns="http://www.w3.org/1998/Math/MathML"><mtable><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable></math></fo:instream-foreign-object></fo:block>';
  const align = (compat: Compat) => {
    const json = JSON.stringify(first<LBlock>(fo(math), compat));
    return /"type":"inline-container","alignmentBaseline":"([a-z-]+)"/.exec(json)?.[1] as LInlineContainer['alignmentBaseline'];
  };
  it('仕様モードは表の中央を軸に (式の中の表と同じ)、互換モードは下端', () => {
    expect(align('spec')).toBe('central');
    expect(align('antenna')).toBe('after-edge');
  });
});

describe('FO-20: inline-container の中の「小さな字のブロック + 本文のブロック」をルビとして読むのは互換モードだけ (§6.6.8)', () => {
  const ruby = '<fo:block font-size="12pt">XMLとは<fo:inline-container><fo:block font-size="0.5em">じょうほう</fo:block><fo:block>情報</fo:block></fo:inline-container>です</fo:block>';
  it('互換モードは LRuby、仕様モードは inline-container のまま (ブロックを 2 つ積んだ行内の箱)', () => {
    const a = imp(fo(ruby), { compat: 'antenna' });
    expect(a.report.counts.rubies).toBe(1);
    expect(JSON.stringify(a.document)).toContain('"type":"ruby","baseText":"情報","rubyText":"じょうほう"');
    const s = imp(fo(ruby));
    expect(s.report.counts.rubies).toBe(0);
    expect(JSON.stringify(s.document)).not.toContain('"type":"ruby"');
    const ic = (s.document.sequences[0].flow.children[0] as LBlock).children[1] as LInlineContainer;
    expect(ic.type).toBe('inline-container');
    expect(ic.children.map((b) => [(b as LBlock).type, (b as LBlock).children.join('')])).toEqual([['block', 'じょうほう'], ['block', '情報']]);
  });
  it('仕様モードで組んだ結果: 箱の基線は、中の最初の行 (小さな字の行) の基線 (§6.6.8: the dominant-baseline of the first descendant line-area)。本文のブロックはその下に積む', () => {
    const tree = E.engine.layout(imp(fo(ruby)).document);
    // 字の基線 (本文の領域の上からの位置。子の座標は親の箱からの位置)
    const glyphs: Array<{ text: string; y: number; size: number }> = [];
    const visit = (a: Area, oy: number) => {
      if (a.type === 'glyph') glyphs.push({ text: a.text, y: oy + a.y + a.baselineY, size: a.fontSize });
      for (const c of childrenOf(a)) visit(c, oy + a.y);
    };
    for (const a of tree.sheets[0].page.regionBody.children) visit(a, 0);
    const at = (t: string) => glyphs.find((g) => g.text === t)!;
    const [outer, small, base] = [at('と'), at('じ'), at('情')];
    expect(small.size).toBeCloseTo(6, 3);
    // 小さな字の行の基線 = まわりの字の基線。本文のブロックの字の基線は、それより下 (1 行ぶん下)
    expect(small.y).toBeCloseTo(outer.y, 2);
    expect(base.y - outer.y).toBeGreaterThan(10);
  });
});

describe('FO-11: background-position の一括指定 (§7.31.2)', () => {
  const pos = (v: string) => {
    const bi = first<LBlock>(fo(`<fo:block background-image="url(a.png)" background-position="${v}">a</fo:block>`)).backgroundImage!;
    return [bi.x, bi.y];
  };
  it('キーワード 1 つ: もう一方は center', () => {
    expect(pos('bottom')).toEqual(['center', 'bottom']);
    expect(pos('top')).toEqual(['center', 'top']);
    expect(pos('left')).toEqual(['left', 'center']);
    expect(pos('right')).toEqual(['right', 'center']);
    expect(pos('center')).toEqual(['center', 'center']);
  });
  it('キーワード 2 つ: 順はどちらでもよい', () => {
    expect(pos('top left')).toEqual(['left', 'top']);
    expect(pos('left top')).toEqual(['left', 'top']);
    expect(pos('bottom right')).toEqual(['right', 'bottom']);
    expect(pos('center bottom')).toEqual(['center', 'bottom']);
    expect(pos('bottom center')).toEqual(['center', 'bottom']);
    expect(pos('center left')).toEqual(['left', 'center']);
    expect(pos('left center')).toEqual(['left', 'center']);
  });
  it('長さ・百分率: 1 つなら横の位置で、縦は 50% (center)。2 つなら横・縦の順', () => {
    expect(pos('10pt')).toEqual([10, 'center']);
    expect(pos('25%')).toEqual(['25%', 'center']);
    expect(pos('10pt 20%')).toEqual([10, '20%']);
  });
  it('個別の指定 (background-position-horizontal・-vertical) が一括指定より先', () => {
    const bi = first<LBlock>(fo('<fo:block background-image="url(a.png)" background-position="bottom" background-position-horizontal="right">a</fo:block>')).backgroundImage!;
    expect([bi.x, bi.y]).toEqual(['right', 'bottom']);
  });
});

describe('FO-12: keep-together・keep-with-next・keep-with-previous の成分 (§7.20.3〜§7.20.5)', () => {
  it('先に見る成分が auto でも、ほかの成分の指定を見る', () => {
    for (const compat of BOTH) {
      expect(first<LBlock>(fo('<fo:block keep-together.within-page="auto" keep-together.within-column="always">a</fo:block>'), compat).keepTogether).toBe(true);
      expect(first<LBlock>(fo('<fo:block keep-with-next.within-page="auto" keep-with-next.within-column="always">a</fo:block>'), compat).keepWithNext).toBe(true);
      expect(first<LBlock>(fo('<fo:block keep-with-previous.within-page="auto" keep-with-previous.within-column="always">a</fo:block>'), compat).keepWithPrevious).toBe(true);
    }
  });
  it('表の行・リストの項目も同じ', () => {
    const t = first<LTable>(fo('<fo:table><fo:table-body><fo:table-row keep-together.within-page="auto" keep-together.within-column="always" keep-with-next.within-page="auto" keep-with-next.within-column="always"><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>'));
    expect(t.body.rows[0]).toMatchObject({ keepTogether: true, keepWithNext: true });
    const l = first<LTable>(fo('<fo:list-block><fo:list-item keep-together.within-page="auto" keep-together.within-column="always"><fo:list-item-label><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body><fo:block>a</fo:block></fo:list-item-body></fo:list-item></fo:list-block>'));
    expect(l.body.rows[0].keepTogether).toBe(true);
  });
  it('どの成分も auto なら保たない。一つの成分の指定は従来どおり', () => {
    expect(first<LBlock>(fo('<fo:block keep-together.within-page="auto" keep-together.within-column="auto">a</fo:block>')).keepTogether).toBeUndefined();
    expect(first<LBlock>(fo('<fo:block keep-together="auto">a</fo:block>')).keepTogether).toBeUndefined();
    expect(first<LBlock>(fo('<fo:block keep-together.within-page="always">a</fo:block>')).keepTogether).toBe(true);
    expect(first<LBlock>(fo('<fo:block keep-together="always">a</fo:block>')).keepTogether).toBe(true);
  });
});

describe('FO-13: rule-style は leader-pattern="rule" のときだけ効く (§7.22.5)', () => {
  const leader = (a: string) => first<LBlock>(fo(`<fo:block><fo:leader ${a}/></fo:block>`)).children[0] as LLeader;
  it('leader-pattern="dots" の rule-style="none" は点のまま', () => {
    expect(leader('leader-pattern="dots" rule-style="none"').pattern).toBe('dots');
  });
  it('leader-pattern="rule" の rule-style="none" は線を引かない (従来どおり空白)', () => {
    expect(leader('leader-pattern="rule" rule-style="none"').pattern).toBe('space');
  });
});

describe('FO-14: number-columns-spanned・number-rows-spanned が空・数でないときは 1 (初期値)', () => {
  it('後ろのセルも、自分の列の幅で組む', () => {
    for (const bad of ['', 'x']) {
      const t = first<LTable>(
        fo(
          `<fo:table table-layout="fixed" width="70pt"><fo:table-column column-width="30pt"/><fo:table-column column-width="40pt"/><fo:table-body><fo:table-row>` +
            `<fo:table-cell number-columns-spanned="${bad}" number-rows-spanned="${bad}"><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block text-indent="50%">b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`,
        ),
      );
      const cells = t.body.rows[0].cells;
      expect(cells[0].colSpan).toBeUndefined();
      expect(cells[0].rowSpan).toBeUndefined();
      // 2 列目 (40pt) の半分
      expect((cells[1].children[0] as LBlock).textIndent).toBe(20);
    }
  });
});

describe('FO-16: fo:bookmark の external-destination (§6.11.2・§7.23.6)', () => {
  const tree = (b: string) => imp(fo('<fo:block id="a">x</fo:block>', { pre: `<fo:bookmark-tree>${b}</fo:bookmark-tree>` }));
  it('文書の外への飛び先は、しおりの href に入れる (PDF のしおりの動作になるので、読み込みの報告には数えない)', () => {
    const r = tree('<fo:bookmark external-destination="url(\'http://example.com/a\')"><fo:bookmark-title>T</fo:bookmark-title></fo:bookmark>');
    const bm = r.document.bookmarks![0] as LBookmark;
    expect(bm).toMatchObject({ title: 'T', ref: '', href: 'http://example.com/a' });
    expect(Object.keys(r.report.unsupported).join()).not.toContain('bookmark');
  });
  it('internal-destination もあれば、そちらを使う (§6.11.2)。報告には数えない', () => {
    const r = tree('<fo:bookmark internal-destination="a" external-destination="url(http://example.com/)"><fo:bookmark-title>T</fo:bookmark-title></fo:bookmark>');
    expect(r.document.bookmarks![0]).toEqual({ title: 'T', ref: 'a' });
    expect(Object.keys(r.report.unsupported).join()).not.toContain('bookmark');
  });
});

describe('FO-28: 前方 float の内容の space-after (XSL 1.1 §4.3.1)', () => {
  // 背景の色ごとに、ページの上端からの位置 (pt) と高さを集める
  const boxes = (compat: Compat, after = '8pt') => {
    const xml = fo(
      '<fo:block>本文' +
        `<fo:float float="before"><fo:block space-after="${after}" background-color="#ff0000">A</fo:block></fo:float>` +
        `<fo:float float="before"><fo:block space-after="${after}" background-color="#00ff00">B</fo:block></fo:float>` +
        '</fo:block><fo:block background-color="#0000ff">本文の 2 つ目</fo:block>',
    );
    const tree = E.engine.layout(imp(xml, { compat }).document);
    const found: Record<string, { y: number; h: number }> = {};
    const visit = (a: Area, oy: number) => {
      const y = oy + ((a as { y?: number }).y ?? 0);
      const bg = (a as { backgroundColor?: string }).backgroundColor;
      if (bg && !found[bg]) found[bg] = { y, h: (a as { height: number }).height };
      for (const c of childrenOf(a)) visit(c as Area, y);
    };
    for (const c of tree.sheets[0].page.regionBody.children) visit(c as Area, 0);
    return found;
  };
  /** 2 つ目の float の下端から、本文の 2 つ目のブロックまで */
  const below = (f: Record<string, { y: number; h: number }>) => f['#0000ff'].y - (f['#00ff00'].y + f['#00ff00'].h);
  it('続く前方 float との間には、前の float の内容の space-after を空ける (float の領域は参照領域ではない)', () => {
    for (const compat of BOTH) {
      const f = boxes(compat);
      expect(f['#00ff00'].y - (f['#ff0000'].y + f['#ff0000'].h)).toBeCloseTo(8, 1);
    }
  });
  it('前方 float の領域の終わりの余白は、仕様どおりなら捨て、互換モードでは残す (アンテナハウスの見本 region-2)', () => {
    expect(below(boxes('spec')) - below(boxes('spec', '0pt'))).toBeCloseTo(0, 1);
    expect(below(boxes('antenna')) - below(boxes('antenna', '0pt'))).toBeCloseTo(8, 1);
  });
});

describe('FO-29・FO-31: 表の行・リストの項目の keep-together で、新しいページにも入らない行', () => {
  // 1 行で本文 (180mm) に入らない高さのセル
  const tall = Array.from({ length: 60 }, (_, i) => `<fo:block>行${i + 1}</fo:block>`).join('');
  const table = (keep: string) =>
    fo(
      `<fo:block>前の段落</fo:block><fo:table><fo:table-body><fo:table-row keep-together.within-column="${keep}"><fo:table-cell><fo:block>短い行</fo:block></fo:table-cell></fo:table-row>` +
        `<fo:table-row keep-together.within-column="${keep}"><fo:table-cell>${tall}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`,
    );
  it('入らなければ緩める印: 互換モードは数値の強さだけ (always には付けない)、仕様どおりのときは強さによらず付ける', () => {
    const rowOf = (keep: string, compat: Compat) => (seq(table(keep), compat).flow.children[1] as LTable).body.rows[1];
    expect(rowOf('1', 'antenna')).toMatchObject({ keepTogether: true, keepTogetherYields: true });
    expect(rowOf('always', 'antenna').keepTogetherYields).toBeUndefined();
    expect(rowOf('1', 'spec')).toMatchObject({ keepTogether: true, keepTogetherYields: true });
    expect(rowOf('always', 'spec')).toMatchObject({ keepTogether: true, keepTogetherYields: true });
    const l = first<LTable>(fo('<fo:list-block><fo:list-item keep-together.within-page="5"><fo:list-item-label><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body><fo:block>a</fo:block></fo:list-item-body></fo:list-item></fo:list-block>'), 'antenna');
    expect(l.body.rows[0]).toMatchObject({ keepTogether: true, keepTogetherYields: true });
  });
  it('新しいページにも入らない行は、送らずにいまのページから分ける。互換モードの always の行は次のページへ送り、分けない', () => {
    /** ページごとの字 */
    const pages = (keep: string, compat: Compat = 'antenna') =>
      E.engine.layout(imp(table(keep), { compat }).document).sheets.map((s) => {
        const t: string[] = [];
        walk(s.page.regionBody as unknown as Area, (a) => {
          if (a.type === 'glyph') t.push((a as { text: string }).text);
        });
        return t.join('');
      });
    const yields = pages('1');
    expect(yields[0]).toContain('行1');
    expect(yields.length).toBeGreaterThan(1);
    expect(yields.slice(1).join('')).toContain('行60');
    const always = pages('always');
    expect(always[0]).not.toContain('行1');
    expect(always[1]).toContain('行60');
    // 仕様どおりのときは、always の行も分ける (ブロックの keep-together と同じ。はみ出させない)
    const spec = pages('always', 'spec');
    expect(spec[0]).toContain('行1');
    expect(spec.slice(1).join('')).toContain('行60');
  });
});

describe('FO-27: keep-with-next の並びと keep-together="always" のブロックが 1 ページに入らないとき (XSL 1.1 §4.8)', () => {
  // 本文は 170mm (約 482pt)。見出し (30pt) + 23 行 (460pt) は入らないが、ブロックだけなら入る
  const body = Array.from({ length: 23 }, (_, i) => `<fo:block>本文${i + 1}</fo:block>`).join('');
  const xml = fo(
    `<fo:block>前のページ</fo:block><fo:block break-before="page" line-height="30pt" keep-with-next.within-page="always">見出し</fo:block>` +
      `<fo:block line-height="20pt" keep-together.within-page="always">${body}</fo:block><fo:block>後ろ</fo:block>`,
  );
  const pages = (compat: Compat) => {
    const tree = E.engine.layout(imp(xml, { compat }).document);
    return {
      texts: tree.sheets.map((s) => {
        const t: string[] = [];
        walk(s.page.regionBody as unknown as Area, (a) => {
          if (a.type === 'glyph') t.push((a as { text: string }).text);
        });
        return t.join('');
      }),
    };
  };
  it('互換モードは、見出しの後ろに分けずに置き、ページの下へはみ出させる (アンテナハウスと同じ)', () => {
    const { texts } = pages('antenna');
    expect(texts[1]).toContain('見出し');
    expect(texts[1]).toContain('本文1');
    expect(texts[1]).toContain('本文23');
    expect(texts[2]).toContain('後ろ');
  });
  it('仕様モードは、ブロックを次のページへ送る (見出しの keep-with-next を破る。これまでどおり)', () => {
    const { texts } = pages('spec');
    expect(texts[1]).toContain('見出し');
    expect(texts[1]).not.toContain('本文1');
    expect(texts[2]).toContain('本文23');
  });
});

describe('FO-30: 全角で組むあいまいな字 (≧ など) の前後の改行は、互換モードだけ', () => {
  it('互換モードは ambiguousWideBreak を立て、仕様モードは立てない', () => {
    const xml = fo('<fo:block>fo:table-body≧fo:table-row</fo:block>');
    expect(seq(xml, 'antenna').ambiguousWideBreak).toBe(true);
    expect(seq(xml, 'spec').ambiguousWideBreak).toBeUndefined();
  });
});

describe('FO-21 (1): fo:static-content の中の axf:outline-level', () => {
  it('しおりを作らず、未対応として 1 度だけ報告する (マスターごとの読み直しで重ならない)', () => {
    const NSX = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const masters =
      '<fo:layout-master-set>' +
      '<fo:simple-page-master master-name="F" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="10mm"/></fo:simple-page-master>' +
      '<fo:simple-page-master master-name="R" page-width="100mm" page-height="100mm" margin="12mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="10mm"/></fo:simple-page-master>' +
      '<fo:page-sequence-master master-name="S"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="F" page-position="first"/>' +
      '<fo:conditional-page-master-reference master-reference="R" page-position="rest"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>';
    const xml =
      `<?xml version="1.0"?><fo:root ${NSX}>${masters}<fo:page-sequence master-reference="S">` +
      '<fo:static-content flow-name="xsl-region-before"><fo:block axf:outline-level="1">Header</fo:block></fo:static-content>' +
      '<fo:flow flow-name="xsl-region-body"><fo:block axf:outline-level="1">Body</fo:block><fo:block break-before="page">p2</fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = imp(xml);
    expect((r.document.bookmarks ?? []).map((b) => (b as LBookmark).title)).toEqual(['Body']);
    expect(r.report.unsupported['axf:outline-level (fo:static-content の中)']).toBe(1);
  });
});

describe('FO-25 別件: 接頭辞の無い background-content-width・-height は互換モードだけ読む', () => {
  const NSA = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
  const xml = (attrs: string) =>
    `<?xml version="1.0"?><fo:root ${NSA}>${PM()}${seqXml(`<fo:block background-image="url(a.png)" ${attrs}>a</fo:block>`)}</fo:root>`;
  it('仕様モードは読まずに報告し、互換モードは読む。axf: の付いた名前はどちらでも読む', () => {
    const spec = imp(xml('background-content-width="20pt"'), { compat: 'spec' });
    expect((spec.document.sequences[0].flow.children[0] as LBlock).backgroundImage?.width).toBeUndefined();
    expect(Object.keys(spec.report.unsupported).some((k) => k.startsWith('background-content-width'))).toBe(true);
    const ah = imp(xml('background-content-width="20pt"'), { compat: 'antenna' });
    expect((ah.document.sequences[0].flow.children[0] as LBlock).backgroundImage?.width).toBe(20);
    for (const compat of BOTH) {
      const r = imp(xml('axf:background-content-width="20pt"'), { compat });
      expect((r.document.sequences[0].flow.children[0] as LBlock).backgroundImage?.width).toBe(20);
    }
  });
});

describe('PKG-21 (2)(3): 読めない値の報告と、使わないマスターの並び', () => {
  it('値の表に無い値と、知らない単位の長さを、無視したことを報告する', () => {
    const r = imp(
      fo(
        '<fo:block-container height="30mm" display-align="justify"><fo:block>a</fo:block></fo:block-container>' +
          '<fo:block hyphenate="none">b</fo:block><fo:block white-space="pre-wrap">c</fo:block><fo:block font-size="2rem">d</fo:block><fo:block font-size="5q">e</fo:block>',
      ),
    );
    const keys = Object.keys(r.report.unsupported);
    for (const k of ['display-align="justify"', 'hyphenate="none"', 'white-space="pre-wrap"']) expect(keys).toContain(k);
    expect(keys.some((k) => k.startsWith('単位 rem'))).toBe(true);
    expect(keys.some((k) => k.startsWith('単位 q'))).toBe(true);
    // 値の表にある値・inherit・知っている単位は報告しない
    const ok = imp(fo('<fo:block hyphenate="true" white-space="inherit" font-size="2em">a</fo:block>'));
    expect(Object.keys(ok.report.unsupported).filter((k) => /hyphenate|white-space|単位/.test(k))).toEqual([]);
  });
  it('どの fo:page-sequence からも参照されない fo:page-sequence-master は、未対応として報告しない', () => {
    const NSX = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
    const xml =
      `<?xml version="1.0"?><fo:root ${NSX}><fo:layout-master-set><fo:simple-page-master master-name="A" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>` +
      '<fo:page-sequence-master master-name="unused"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="A" odd-or-even="odd"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master>' +
      '</fo:layout-master-set><fo:page-sequence master-reference="A"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>';
    expect(Object.keys(imp(xml).report.unsupported)).toEqual([]);
  });
});
