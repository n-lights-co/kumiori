/**
 * XSL-FO の、読んで組版へ渡すだけの性質:
 *  - clear (§7.19.1)
 *  - font-variant (§7.9.8)・word-spacing (§7.17.8)
 *  - glyph-orientation-vertical・glyph-orientation-horizontal (§7.29.3・§7.29.2)
 *  - relative-position (§7.13.5・§5.5.5)・visibility (§7.30.17)・z-index (§7.30.18・§5.4.5)
 *  - fo:folio-prefix・fo:folio-suffix (§6.6.13・§6.6.14): fo:page-number・fo:page-number-citation・fo:page-number-citation-last の番号の前後に付く (§6.6.10〜§6.6.12)
 *  - 一括指定 (font・background・page-break-before/after/inside・size。XSL 1.1 §7.31・§5.2) と、上限・下限 (min-height・max-height・min-width・max-width。§7.15.8〜§7.15.11・§5.3.3)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, GlyphArea, LBlock, LBlockContainer, LInline, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string, master = 'page-width="100mm" page-height="100mm" margin="10mm"', seq = '') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="m" ${master}><fo:region-body/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m" ${seq}><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const imp = (body: string, compat: 'spec' | 'antenna' = 'spec', master?: string, seq?: string) => importXslFo(fo(body, master, seq), parse, { compat });
const kids = (body: string, compat: 'spec' | 'antenna' = 'spec', seq?: string) => imp(body, compat, undefined, seq).document.sequences[0].flow.children;
const first = (body: string, compat: 'spec' | 'antenna' = 'spec', seq?: string) => kids(body, compat, seq)[0] as LBlock;
const MM = 72 / 25.4;

describe('XSL-FO の一括指定 (§7.31・§5.2)', () => {
  it('font: 字の形・太さ・大きさ・行送り・書体に分ける (§7.31.13)', () => {
    const b = first(`<fo:block font="italic bold 12pt/18pt serif">a</fo:block>`);
    expect(b.fontStyle).toBe('italic');
    expect(b.fontWeight).toBe(700);
    expect(b.fontSize).toBe(12);
    expect(b.lineHeightPt).toBe(18);
  });
  it('font: 書いていない部分は初期値に戻す (親の太字・斜体を打ち消す)', () => {
    const outer = first(`<fo:block font-weight="bold" font-style="italic"><fo:block font="10pt serif">a</fo:block></fo:block>`);
    const b = outer.children[0] as LBlock;
    expect(b.fontWeight).toBe(400);
    expect(b.fontStyle).toBe('normal');
    expect(b.fontSize).toBe(10);
  });
  it('font: 個別の性質を一緒に書いたら、個別の性質が勝つ (§5.2)', () => {
    const b = first(`<fo:block font="italic 12pt serif" font-size="20pt" font-style="normal">a</fo:block>`);
    expect(b.fontSize).toBe(20);
    expect(b.fontStyle).toBe('normal');
  });
  it('font: 行送りの数値・書体の並び (引用符・カンマ) を読む', () => {
    const fams: string[][] = [];
    const r = importXslFo(fo(`<fo:block font="9pt / 1.5 'My Font', serif">a</fo:block>`), parse, {
      compat: 'spec',
      mapFont: (list) => {
        fams.push(list);
        return undefined;
      },
    });
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontSize).toBe(9);
    expect(b.lineHeight).toBe(1.5);
    expect(fams).toContainEqual(['My Font', 'serif']);
  });
  it('font: システムの書体の語 (caption など)・読めない値は、何もせずに報告する', () => {
    const r = imp(`<fo:block font="caption">a</fo:block><fo:block font="bold">b</fo:block>`);
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontSize).toBeUndefined();
    expect(r.report.unsupported['font:caption']).toBe(1);
    expect(r.report.unsupported['font:bold']).toBe(1);
  });
  it('background: 色・画像・繰り返し・位置に分ける (§7.31.1)', () => {
    const b = first(`<fo:block background="#ff0000 url(a.png) no-repeat right top">a</fo:block>`);
    expect(b.backgroundColor).toBe('#ff0000');
    expect(b.backgroundImage).toMatchObject({ src: 'a.png', repeat: 'no-repeat', x: 'right', y: 'top' });
    // 色だけ・括弧の中に空白のある色
    expect(first(`<fo:block background="rgb(0, 128, 0)">a</fo:block>`).backgroundColor).toBe('rgb(0, 128, 0)');
    // 個別の性質が勝つ
    expect(first(`<fo:block background="red" background-color="#0000ff">a</fo:block>`).backgroundColor).toBe('#0000ff');
  });
  it('page-break-before・page-break-after: §7.31.16・§7.31.17 の対応の表のとおりに写す', () => {
    const of = (attrs: string) => first(`<fo:block ${attrs}>a</fo:block>`);
    expect(of('page-break-before="always"').breakBefore).toBe('page');
    expect(of('page-break-before="left"').breakBefore).toBe('even-page');
    expect(of('page-break-before="right"').breakBefore).toBe('odd-page');
    expect(of('page-break-before="avoid"')).toMatchObject({ keepWithPrevious: true });
    expect(of('page-break-before="avoid"').breakBefore).toBeUndefined();
    expect(of('page-break-before="auto"').breakBefore).toBeUndefined();
    expect(of('page-break-after="always"').breakAfter).toBe('page');
    expect(of('page-break-after="left"').breakAfter).toBe('even-page');
    expect(of('page-break-after="right"').breakAfter).toBe('odd-page');
    expect(of('page-break-after="avoid"')).toMatchObject({ keepWithNext: true });
    // 個別の性質が勝つ
    expect(of('page-break-before="always" break-before="column"').breakBefore).toBe('column');
  });
  it('page-break-inside: avoid は keep-together="always" (§7.31.18)', () => {
    expect(first(`<fo:block page-break-inside="avoid">a</fo:block>`).keepTogether).toBe(true);
    expect(first(`<fo:block page-break-inside="auto">a</fo:block>`).keepTogether).toBeUndefined();
  });
  it('page-break-before="always" のブロックは、次のページから始まる (表の行も)', () => {
    const doc = imp(`<fo:block>a</fo:block><fo:block page-break-before="always">b</fo:block>`).document;
    expect(E.engine.layout(doc).sheets.length).toBe(2);
    const row = (t: string) => `<fo:table-row ${t}><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row>`;
    const doc2 = imp(`<fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body>${row('')}${row('page-break-before="always"')}</fo:table-body></fo:table>`).document;
    expect(E.engine.layout(doc2).sheets.length).toBe(2);
  });
  it('page-break-* の読めない値は報告する', () => {
    const r = imp(`<fo:block page-break-before="sometimes">a</fo:block>`);
    expect(r.report.unsupported['page-break-before:sometimes']).toBe(1);
  });
  it('size: page-width・page-height に写す (§7.31.21。長さ 1 つは正方形、2 つは幅・高さ)', () => {
    const m = (size: string) => imp('<fo:block>a</fo:block>', 'spec', `size="${size}" margin="10mm"`).document.sequences[0].master;
    expect(m('120mm 80mm').width).toBeCloseTo(120, 6);
    expect(m('120mm 80mm').height).toBeCloseTo(80, 6);
    expect(m('90mm').width).toBeCloseTo(90, 6);
    expect(m('90mm').height).toBeCloseTo(90, 6);
    // auto・portrait は用紙の大きさ (A4 縦)、landscape は長い辺を横に
    expect(m('auto').width).toBeCloseTo(210, 1);
    expect(m('portrait').height).toBeCloseTo(297, 1);
    expect(m('landscape').width).toBeCloseTo(297, 1);
    expect(m('landscape').height).toBeCloseTo(210, 1);
    // 個別の性質が勝つ
    const both = imp('<fo:block>a</fo:block>', 'spec', `size="120mm 80mm" page-width="50mm"`).document.sequences[0].master;
    expect(both.width).toBeCloseTo(50, 6);
    expect(both.height).toBeCloseTo(80, 6);
  });
});

describe('XSL-FO の寸法の上限・下限 (§7.15.8〜§7.15.11・§5.3.3)', () => {
  it('横書き: min-height は block 方向の下限、max-width・min-width は inline 方向の上限・下限', () => {
    expect(first(`<fo:block min-height="30mm">a</fo:block>`).minBlockSize).toBeCloseTo(30 * MM, 6);
    // 本文の幅は 80mm: 上限がそれより狭ければ上限の幅、下限がそれより広ければ下限の幅
    expect(first(`<fo:block max-width="40mm">a</fo:block>`).width).toBeCloseTo(40 * MM, 6);
    expect(first(`<fo:block max-width="200mm">a</fo:block>`).width).toBeUndefined();
    expect(first(`<fo:block max-width="none">a</fo:block>`).width).toBeUndefined();
    expect(first(`<fo:block min-width="120mm">a</fo:block>`).width).toBeCloseTo(120 * MM, 6);
    expect(first(`<fo:block min-width="20mm">a</fo:block>`).width).toBeUndefined();
  });
  it('min-height のブロックは、中身が少なくてもその高さを取る', () => {
    const doc = imp(`<fo:block min-height="30mm" id="a">a</fo:block><fo:block id="b">b</fo:block>`).document;
    const page = E.engine.layout(doc).sheets[0];
    const ys: number[] = [];
    const visit = (n: unknown, oy: number) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => visit(c, oy));
      const a = n as { type?: string; y?: number; text?: string };
      const y = oy + (a.y ?? 0);
      if (a.type === 'glyph' && (a.text === 'a' || a.text === 'b')) ys.push(y);
      for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, y);
    };
    visit(page, 0);
    expect(ys.length).toBe(2);
    expect(ys[1] - ys[0]).toBeCloseTo(30 * MM, 3);
  });
  it('縦書きの箱の上限・下限は、読まずに報告する (組版に受け皿が無い)', () => {
    const r = imp(`<fo:block-container writing-mode="tb-rl" max-height="40mm" min-width="10mm"><fo:block>a</fo:block></fo:block-container>`);
    expect(r.report.unsupported['max-height']).toBe(1);
    expect(r.report.unsupported['min-width']).toBe(1);
    const bc = r.document.sequences[0].flow.children[0] as LBlockContainer;
    expect(bc.height).toBeUndefined();
    expect(bc.minBlockSize).toBeUndefined();
  });
  it('縦書きの表の行: block 方向の下限・上限は min-width・max-width (§5.3.3)', () => {
    const t = first(
      `<fo:block-container writing-mode="tb-rl"><fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row min-width="12mm" max-width="20mm"><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:block-container>`,
    ) as unknown as LBlockContainer;
    const row = (t.children[0] as LTable).body.rows[0];
    expect(row.minHeight).toBeCloseTo(12 * MM, 6);
    expect(row.maxHeight).toBeCloseTo(20 * MM, 6);
  });
  it('表の行: min-height は高さの下限、max-height は上限 (仕様モード)', () => {
    const t = first(
      `<fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row min-height="12mm" max-height="20mm"><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`,
    ) as unknown as LTable;
    const row = t.body.rows[0];
    expect(row.minHeight).toBeCloseTo(12 * MM, 6);
    expect(row.maxHeight).toBeCloseTo(20 * MM, 6);
  });
  it('受け皿の無い向き (ブロックの block 方向の上限) は報告する', () => {
    const r = imp(`<fo:block max-height="20mm">a</fo:block>`);
    expect(r.report.unsupported['max-height']).toBe(1);
    expect((r.document.sequences[0].flow.children[0] as LBlock).height).toBeUndefined();
  });
});

/** 字 (1 字) の絶対位置 */
function glyphPos(tree: unknown, ch: string): { x: number; y: number } | undefined {
  let found: { x: number; y: number } | undefined;
  const visit = (n: unknown, ox: number, oy: number) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, ox, oy));
    const a = n as { type?: string; x?: number; y?: number; text?: string };
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    if (a.type === 'glyph' && a.text === ch) {
      found = { x, y };
      return;
    }
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, x, y);
  };
  visit(tree, 0, 0);
  return found;
}

describe('XSL-FO の clear (§7.19.1)', () => {
  const float = (side: string) => `<fo:float float="${side}"><fo:block-container width="20mm" height="30mm"><fo:block>F</fo:block></fo:block-container></fo:float>`;
  it('start・end・both と left (= start)・right (= end) を読む', () => {
    const of = (v: string) => (kids(`${float('start')}<fo:block clear="${v}">a</fo:block>`).find((k) => (k as LBlock).type === 'block') as LBlock).clear;
    expect(of('start')).toBe('start');
    expect(of('left')).toBe('start');
    expect(of('end')).toBe('end');
    expect(of('right')).toBe('end');
    expect(of('both')).toBe('both');
    expect(of('none')).toBeUndefined();
  });
  it('clear のブロックは、その側の先の float の下から始まる', () => {
    const y = (attrs: string) => glyphPos(E.engine.layout(imp(`${float('start')}<fo:block ${attrs}>a</fo:block>`).document).sheets[0], 'a')!.y;
    const beside = y('');
    // float (高さ 30mm) の下まで下がる
    expect(y('clear="both"') - beside).toBeGreaterThan(25 * MM);
    expect(y('clear="start"') - beside).toBeGreaterThan(25 * MM);
    // 反対側の float しか無ければ下がらない
    expect(y('clear="end"')).toBeCloseTo(beside, 6);
  });
  it('縦書きでも、clear のブロックは float の先 (左) から始まる', () => {
    const vfloat = `<fo:float float="start"><fo:block-container width="30mm" height="20mm"><fo:block>F</fo:block></fo:block-container></fo:float>`;
    const x = (attrs: string) => glyphPos(E.engine.layout(imp(`${vfloat}<fo:block ${attrs}>a</fo:block>`, 'spec', undefined, 'writing-mode="tb-rl"').document).sheets[0], 'a')!.x;
    expect(x('') - x('clear="both"')).toBeGreaterThan(25 * MM);
  });
  it('inside・outside と、fo:block 以外の要素の clear は、読まずに報告する', () => {
    const r = imp(`${float('start')}<fo:block clear="inside">a</fo:block><fo:block-container clear="both"><fo:block>b</fo:block></fo:block-container>`);
    expect(r.report.unsupported['clear:inside']).toBe(1);
    expect(r.report.unsupported['clear (fo:block-container)']).toBe(1);
  });
});

/** 領域の木の中の字を、順につないだ文字列 */
const textOf = (areas: readonly unknown[]): string => {
  const g: string[] = [];
  for (const a of areas) walk(a as Area, (n) => n.type === 'glyph' && g.push(n.text));
  return g.join('');
};

describe('fo:folio-prefix・fo:folio-suffix (§6.6.13・§6.6.14)', () => {
  const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set>`;
  const seqXml = (attrs: string, folio: string, statics: string, flow: string) =>
    `<fo:page-sequence master-reference="m" ${attrs}>${folio}${statics}<fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence>`;
  const doc = (...seqs: string[]) => importXslFo(`<?xml version="1.0"?><fo:root ${NS}>${PM}${seqs.join('')}</fo:root>`, parse, { compat: 'spec' });
  const head = `<fo:static-content flow-name="xsl-region-before"><fo:block><fo:page-number/></fo:block></fo:static-content>`;
  const G = `<fo:folio-prefix>G-</fo:folio-prefix><fo:folio-suffix>頁</fo:folio-suffix>`;

  it('static-content の fo:page-number の前後に付く (§6.6.10)', () => {
    const r = doc(seqXml('initial-page-number="1"', G, head, `<fo:block>本文</fo:block><fo:block break-before="page">次</fo:block>`));
    expect(r.report.unsupported['fo:folio-prefix']).toBeUndefined();
    expect(r.report.unsupported['fo:folio-suffix']).toBeUndefined();
    const tree = E.engine.layout(r.document);
    expect(tree.sheets.map((s) => textOf(s.page.absoluteAreas))).toEqual(['G-1頁', 'G-2頁']);
  });
  it('本文の fo:page-number の前後に付く', () => {
    const tree = E.engine.layout(doc(seqXml('', G, '', `<fo:block>ここは<fo:page-number/>です</fo:block>`)).document);
    expect(textOf(tree.sheets[0].page.regionBody.children)).toBe('ここはG-1頁です');
  });
  it('fo:page-number-citation・-last には、引いたページを作った page-sequence のものが付く (§6.6.11・§6.6.12)', () => {
    const r = doc(
      seqXml('', '', '', `<fo:block>用語は<fo:page-number-citation ref-id="g"/>から<fo:page-number-citation-last ref-id="gs"/>まで。ここは<fo:page-number-citation ref-id="here"/></fo:block><fo:block id="here">x</fo:block>`),
      seqXml('id="gs" initial-page-number="1"', G, '', `<fo:block id="g">用語</fo:block><fo:block break-before="page">続き</fo:block>`),
    );
    const tree = E.engine.layout(r.document);
    // 引いた先 (用語の page-sequence) の前後の字が付く。接頭辞の無い page-sequence の中の id を引いたものには付かない
    expect(textOf(tree.sheets[0].page.regionBody.children)).toBe('用語はG-1頁からG-2頁まで。ここは1x');
  });
  it('中身の行内の書式 (fo:inline) も読む。番号の書式は fo:page-number のもの', () => {
    const r = doc(seqXml('', `<fo:folio-prefix><fo:inline font-weight="bold">A</fo:inline>-</fo:folio-prefix>`, '', `<fo:block><fo:page-number color="#ff0000"/></fo:block>`));
    const inl = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LInline;
    expect(inl.color).toBe('#ff0000');
    expect((inl.children[0] as LInline).fontWeight).toBe(700);
    expect((inl.children[0] as LInline).children).toEqual(['A']);
    expect(inl.children[1]).toBe('-');
    expect((inl.children[2] as { type: string }).type).toBe('page-number-citation');
  });
  it('fo:folio-prefix の中の fo:page-number・ブロックは、読まずに報告する (§6.6.13 の Contents)', () => {
    const r = doc(seqXml('', `<fo:folio-prefix>P<fo:page-number/><fo:block>B</fo:block></fo:folio-prefix>`, head, `<fo:block>本文</fo:block>`));
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:page-number (fo:folio-prefix'))).toBe(true);
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:block (fo:folio-prefix'))).toBe(true);
    const tree = E.engine.layout(r.document);
    expect(textOf(tree.sheets[0].page.absoluteAreas)).toBe('P1');
  });
  it('fo:folio-prefix・fo:folio-suffix の無い文書は、これまでと同じ形 (番号だけ)', () => {
    const r = doc(seqXml('', '', head, `<fo:block><fo:page-number/></fo:block>`));
    const st = r.document.sequences[0].staticContent!.find((c) => c.children.length)!;
    expect((st.children[0] as LBlock).children).toEqual(['{pageNumber}']);
  });
});

describe('font-variant (§7.9.8) と word-spacing (§7.17.8)', () => {
  it('font-variant="small-caps": 字の並びに small caps の印を付ける (継承され、normal で戻る)', () => {
    const b = first(`<fo:block font-variant="small-caps">Abc<fo:inline font-variant="normal">Def</fo:inline><fo:inline>Ghi</fo:inline></fo:block>`);
    expect(b.children[0]).toMatchObject({ type: 'inline', smallCaps: 'small', children: ['Abc'] });
    expect((b.children[1] as LInline).children).toEqual(['Def']);
    expect((b.children[2] as LInline).children[0]).toMatchObject({ type: 'inline', smallCaps: 'small', children: ['Ghi'] });
    // 指定の無い文書は、字の並びをそのまま渡す
    expect(first(`<fo:block>Abc</fo:block>`).children).toEqual(['Abc']);
  });
  it('small-caps の小文字は、小さい大文字で組まれる (字形の無い書体では、縮めた大文字で代える)', () => {
    const glyphs = (attrs: string) => {
      const out: Array<{ text: string; size: number }> = [];
      const tree = E.engine.layout(imp(`<fo:block font-size="20pt" ${attrs}>Ab</fo:block>`).document);
      walk(tree.sheets[0].page as unknown as Area, (g) => g.type === 'glyph' && out.push({ text: g.text, size: g.fontSize }));
      return out;
    };
    expect(glyphs('').map((g) => g.text).join('')).toBe('Ab');
    const sc = glyphs('font-variant="small-caps"');
    // 書体に small caps の字形 (smcp) があれば字はそのまま (字形だけ替わる)。無ければ、小文字を 0.7 倍の大文字にする
    if (sc[1].text === 'B') expect(sc[1].size).toBeCloseTo(14, 6);
    else expect(sc.map((g) => g.text).join('')).toBe('Ab');
    expect(sc[0]).toMatchObject({ text: 'A', size: 20 });
  });
  it('font-variant の読めない値は報告する', () => {
    const r = imp(`<fo:block font-variant="petite-caps">a</fo:block>`);
    expect(r.report.unsupported['font-variant:petite-caps']).toBe(1);
    expect(imp(`<fo:block font-variant="small-caps" word-spacing="2pt">a</fo:block>`).report.unsupported).toEqual({});
  });
  it('word-spacing: 語の間の空白を、その長さだけ広げる (継承され、normal で戻る)', () => {
    const gap = (body: string) => {
      const tree = E.engine.layout(imp(body).document).sheets[0];
      return glyphPos(tree, 'b')!.x - glyphPos(tree, 'a')!.x;
    };
    const base = gap(`<fo:block>a b</fo:block>`);
    expect(gap(`<fo:block word-spacing="5pt">a b</fo:block>`) - base).toBeCloseTo(5, 6);
    expect(gap(`<fo:block font-size="10pt" word-spacing="0.5em">a b</fo:block>`) - gap(`<fo:block font-size="10pt">a b</fo:block>`)).toBeCloseTo(5, 6);
    // <space> は optimum を使う
    expect(gap(`<fo:block word-spacing.optimum="3pt" word-spacing.maximum="9pt">a b</fo:block>`) - base).toBeCloseTo(3, 6);
    expect(gap(`<fo:block word-spacing="5pt"><fo:inline word-spacing="normal">a b</fo:inline></fo:block>`)).toBeCloseTo(base, 6);
    // 字の間 (空白でない所) は広げない
    const tree = E.engine.layout(imp(`<fo:block word-spacing="5pt">ab</fo:block>`).document).sheets[0];
    const tree0 = E.engine.layout(imp(`<fo:block>ab</fo:block>`).document).sheets[0];
    expect(glyphPos(tree, 'b')!.x).toBeCloseTo(glyphPos(tree0, 'b')!.x, 6);
  });
  it('word-spacing の読めない値は報告する。指定の無い文書には wordSpacing を付けない', () => {
    expect(imp(`<fo:block word-spacing="wide">a</fo:block>`).report.unsupported['word-spacing:wide']).toBe(1);
    expect(first(`<fo:block word-spacing="normal">a b</fo:block>`).wordSpacing).toBeUndefined();
  });
});

describe('glyph-orientation-vertical・glyph-orientation-horizontal (§7.29.3・§7.29.2)', () => {
  const v = (attrs: string, text = 'A漢') => `<fo:block-container writing-mode="tb-rl" height="40mm" ${attrs}><fo:block>${text}</fo:block></fo:block-container>`;
  const rot = (attrs: string) => {
    const out: Record<string, number> = {};
    const tree = E.engine.layout(imp(v(attrs)).document);
    walk(tree.sheets[0].page as unknown as Area, (g) => g.type === 'glyph' && (out[g.text] = g.rotation));
    return out;
  };
  it('auto は欧字を横に倒し、0deg はすべての字を立て、90deg はすべての字を横に倒す', () => {
    expect(rot('')).toEqual({ A: 90, 漢: 0 });
    expect(rot('glyph-orientation-vertical="auto"')).toEqual({ A: 90, 漢: 0 });
    expect(rot('glyph-orientation-vertical="0deg"')).toEqual({ A: 0, 漢: 0 });
    expect(rot('glyph-orientation-vertical="90deg"')).toEqual({ A: 90, 漢: 90 });
  });
  it('角度は 0・90・180・270 度の近い方に丸める。grad・rad の単位も読む。継承され、auto で戻る', () => {
    const bc = (attrs: string) => first(v(attrs)) as unknown as LBlockContainer;
    expect(bc('glyph-orientation-vertical="10deg"').textOrientation).toBe('upright');
    expect(bc('glyph-orientation-vertical="80deg"').textOrientation).toBe('sideways');
    expect(bc('glyph-orientation-vertical="100grad"').textOrientation).toBe('sideways');
    expect(bc('glyph-orientation-vertical="1.5708rad"').textOrientation).toBe('sideways');
    expect(bc('glyph-orientation-vertical="-350deg"').textOrientation).toBe('upright');
    expect(bc('glyph-orientation-vertical="auto"').textOrientation).toBeUndefined();
    const inner = first(`<fo:block-container writing-mode="tb-rl" height="40mm" glyph-orientation-vertical="0deg"><fo:block>A<fo:inline glyph-orientation-vertical="auto">B</fo:inline></fo:block></fo:block-container>`) as unknown as LBlockContainer;
    expect(((inner.children[0] as LBlock).children[1] as LInline).textOrientation).toBe('mixed');
  });
  it('受け皿の無い向き (180・270 度、横書きの 0 度以外)・単位の無い値は、読まずに報告する', () => {
    const un = (attrs: string) => imp(v(attrs)).report.unsupported;
    expect(un('glyph-orientation-vertical="180deg"')['glyph-orientation-vertical:180deg']).toBe(1);
    expect(un('glyph-orientation-vertical="270deg"')['glyph-orientation-vertical:270deg']).toBe(1);
    expect(un('glyph-orientation-vertical="90"')['glyph-orientation-vertical:90']).toBe(1);
    expect(un('glyph-orientation-horizontal="90deg"')['glyph-orientation-horizontal:90deg']).toBe(1);
    expect(un('glyph-orientation-horizontal="0deg" glyph-orientation-vertical="90deg"')).toEqual({});
    expect((first(v('glyph-orientation-vertical="180deg"')) as unknown as LBlockContainer).textOrientation).toBeUndefined();
  });
});

describe('relative-position (§7.13.5・§5.5.5)', () => {
  it('relative: left・top (無ければ right・bottom の逆) だけ、組んだ箱をずらす。前後の配置は変えない', () => {
    const b = (attrs: string) => first(`<fo:block ${attrs}>a</fo:block>`).relativeOffset;
    expect(b('relative-position="relative" left="3pt" top="4pt"')).toEqual({ x: 3, y: 4 });
    expect(b('relative-position="relative" right="3pt" bottom="4pt"')).toEqual({ x: -3, y: -4 });
    expect(b('relative-position="relative" left="1pt" right="9pt" top="2pt" bottom="9pt"')).toEqual({ x: 1, y: 2 });
    // 一括指定の position="relative" (§7.31.20)
    expect(b('position="relative" left="3pt"')).toEqual({ x: 3, y: 0 });
    // static (初期値) では left・top を使わない
    expect(b('left="3pt" top="4pt"')).toBeUndefined();
    expect(b('relative-position="static" left="3pt"')).toBeUndefined();
    const pos = (attrs: string) => {
      const t = E.engine.layout(imp(`<fo:block ${attrs}>a</fo:block><fo:block>b</fo:block>`).document).sheets[0];
      return { a: glyphPos(t, 'a')!, b: glyphPos(t, 'b')! };
    };
    const p0 = pos('');
    const p1 = pos('relative-position="relative" left="10pt" top="5pt"');
    expect(p1.a.x - p0.a.x).toBeCloseTo(10, 6);
    expect(p1.a.y - p0.a.y).toBeCloseTo(5, 6);
    expect(p1.b).toEqual(p0.b);
  });
  it('fo:block のほかの要素・縦書きのブロックの relative は、読まずに報告する', () => {
    const r = imp(`<fo:block><fo:inline relative-position="relative" top="2pt">a</fo:inline></fo:block><fo:block-container writing-mode="tb-rl" height="30mm"><fo:block relative-position="relative" top="2pt">b</fo:block></fo:block-container>`);
    expect(r.report.unsupported['relative-position (fo:inline)']).toBe(1);
    expect(r.report.unsupported['relative-position (縦書き)']).toBe(1);
  });
});

describe('visibility (§7.30.17)', () => {
  const glyphColors = (body: string) => {
    const out: Record<string, string | undefined> = {};
    const tree = E.engine.layout(imp(body).document);
    walk(tree.sheets[0].page as unknown as Area, (g) => g.type === 'glyph' && (out[g.text] = (g as GlyphArea).color));
    return out;
  };
  it('hidden・collapse: 場所を残して描かない (字は transparent、背景は無し、罫線は transparent)。継承され、visible で戻る', () => {
    const b = first(`<fo:block visibility="hidden" color="#ff0000" background-color="#00ff00" border="1pt solid #0000ff">a<fo:inline visibility="visible">b</fo:inline><fo:inline background-color="#eeeeee">c</fo:inline></fo:block>`);
    expect(b.color).toBe('transparent');
    expect(b.backgroundColor).toBeUndefined();
    expect(b.border).toMatchObject({ top: { width: 1, color: 'transparent' } });
    // visible の子は、受け継いだ字の色に戻る
    expect((b.children[1] as LInline).color).toBe('#ff0000');
    expect((b.children[2] as LInline).backgroundColor).toBeUndefined();
    expect(first(`<fo:block visibility="collapse">a</fo:block>`).color).toBe('transparent');
    expect(first(`<fo:block visibility="visible" color="#ff0000">a</fo:block>`).color).toBe('#ff0000');
  });
  it('見えないブロックは、高さを取ったまま字を描かない', () => {
    const c = glyphColors(`<fo:block visibility="hidden">a</fo:block><fo:block>b</fo:block>`);
    expect(c.a).toBe('transparent');
    expect(c.b).not.toBe('transparent');
    const y = (attrs: string) => glyphPos(E.engine.layout(imp(`<fo:block ${attrs}>a</fo:block><fo:block>b</fo:block>`).document).sheets[0], 'b')!.y;
    expect(y('visibility="hidden"')).toBeCloseTo(y(''), 6);
  });
  it('見えない画像は、場所を残して描かない', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const hiddenImages = (attrs: string) => {
      const tree = E.engine.layout(imp(`<fo:block><fo:external-graphic src="url(${png})" content-width="10mm" content-height="10mm" ${attrs}/></fo:block>`).document);
      const flat = JSON.stringify(tree.sheets[0].page.regionBody);
      // 画像の場所 (10mm 四方) は残る
      expect(flat).toContain('"type":"image"');
      return flat.split('"hidden":true').length - 1;
    };
    expect(hiddenImages('')).toBe(0);
    expect(hiddenImages('visibility="hidden"')).toBe(1);
  });
  it('表の行・列の collapse (行・列を取り除く動き) は hidden として扱い、報告する。読めない値も報告する', () => {
    const r = imp(`<fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row visibility="collapse" background-color="#ff0000"><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table><fo:block visibility="maybe">a</fo:block>`);
    expect(r.report.unsupported['visibility:collapse (fo:table-row)']).toBe(1);
    expect(r.report.unsupported['visibility:maybe']).toBe(1);
    const t = r.document.sequences[0].flow.children[0] as LTable;
    expect(t.body.rows[0].color).toBe('transparent');
    expect(t.body.rows[0].cells[0].backgroundColor).toBeUndefined();
  });
});

describe('z-index (§7.30.18・§5.4.5)', () => {
  const abs = (attrs: string, wrap = '') => {
    const body = `<fo:block-container ${wrap}><fo:block-container absolute-position="fixed" top="0mm" left="0mm" width="10mm" height="10mm" ${attrs}><fo:block>a</fo:block></fo:block-container></fo:block-container>`;
    const r = imp(body);
    return { c: (r.document.sequences[0].flow.children[0] as LBlockContainer).children[0] as LBlockContainer, un: r.report.unsupported };
  };
  it('絶対配置の箱の z-index が負なら、本文の背面に置く', () => {
    expect(abs('z-index="-1"').c.layer).toBe('behind');
    expect(abs('z-index="0"').c.layer).toBeUndefined();
    expect(abs('z-index="2"').c.layer).toBeUndefined();
    expect(abs('z-index="auto"').c.layer).toBeUndefined();
    expect(abs('').c.layer).toBeUndefined();
  });
  it('値は親の z-index に足した値で比べる (§5.4.5)', () => {
    expect(abs('z-index="1"', 'z-index="-3"').c.layer).toBe('behind');
    expect(abs('z-index="-1"', 'z-index="3"').c.layer).toBeUndefined();
    expect(abs('', 'z-index="-3"').c.layer).toBe('behind');
  });
  it('背面の箱は、本文より先に描かれる', () => {
    const tree = E.engine.layout(imp(`<fo:block>b</fo:block><fo:block-container absolute-position="absolute" z-index="-1" top="0mm" left="0mm" width="10mm" height="10mm"><fo:block>a</fo:block></fo:block-container>`).document);
    const page = tree.sheets[0].page;
    expect(textOf(page.behindAreas)).toBe('a');
    expect(textOf(page.absoluteAreas)).toBe('');
    // 指定の無い箱は、本文の前面
    const front = E.engine.layout(imp(`<fo:block>b</fo:block><fo:block-container absolute-position="absolute" top="0mm" left="0mm" width="10mm" height="10mm"><fo:block>a</fo:block></fo:block-container>`).document).sheets[0].page;
    expect(textOf(front.behindAreas)).toBe('');
    expect(textOf(front.absoluteAreas)).toBe('a');
  });
  it('整数でない値は報告する', () => {
    expect(abs('z-index="top"').un['z-index:top']).toBe(1);
  });
});
