/**
 * NF-20 詰め込み (overflow="condense" と axf:overflow-condense。アンテナハウスの拡張)。互換モードの fo:block-container で、中身が収める高さ
 * (height・max-height、無ければ本文の領域) を超えるなら、字の大きさ (font-size。既定) か行の高さ (line-height) を詰めて収める。
 * 絶対の値を書いた字の大きさは変えない。仕様モードと、未対応の方法・要素は知らせる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { childrenOf, type AreaNode, type GlyphArea } from '../src/index';
import { FAMILY, makeEngine } from './helpers';
import { LayoutEngine } from '../src/layoutEngine';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
}, 300_000);

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
const fo = (flow: string) => `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-family="Noto Serif JP" font-size="10pt">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const LINES = (n: number, extra = '') => Array.from({ length: n }, (_, k) => `<fo:block${extra}>Line ${k + 1}</fo:block>`).join('');

/** 組んだ結果: ページ数と、1 ページ目の字ごとの大きさ・位置 */
function run(flow: string, compat: ImportOptions['compat'] = 'antenna') {
  return runDoc(fo(flow), compat);
}
/** run と同じ (文書をまるごと渡す)。warnings は組版の警告 */
function runDoc(doc: string, compat: ImportOptions['compat'] = 'antenna') {
  const r = importXslFo(doc, parse, { compat });
  const t = E.engine.layout(r.document);
  const glyphs: Array<{ text: string; size: number; y: number }> = [];
  const rec = (a: AreaNode, oy: number) => {
    const y = oy + a.y;
    if (a.type === 'glyph') glyphs.push({ text: (a as GlyphArea).text, size: (a as GlyphArea).fontSize, y });
    for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0));
  };
  rec(t.sheets[0], 0);
  return { pages: t.sheets.length, glyphs, unsupported: r.report.unsupported, warnings: t.warnings };
}

describe('overflow="condense" の詰め込み', () => {
  it('互換モード: 収める高さ (max-height) を超える中身は、字を小さくして収める', () => {
    const plain = run(`<fo:block-container>${LINES(10)}</fo:block-container>`);
    const r = run(`<fo:block-container max-height="60pt" overflow="condense" axf:overflow-condense="font-size">${LINES(10)}</fo:block-container>`);
    expect(plain.glyphs[0].size).toBe(10);
    const size = r.glyphs[0].size;
    expect(size).toBeLessThan(10);
    expect(size).toBeGreaterThan(3);
    // 最後の行の字は、容器の上端から 60pt の中
    const ys = r.glyphs.map((g) => g.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(60);
    expect(Object.keys(r.unsupported)).toEqual([]);
  });
  it('既定 (auto) は font-size。収まる中身はそのまま', () => {
    expect(run(`<fo:block-container max-height="60pt" overflow="condense">${LINES(10)}</fo:block-container>`).glyphs[0].size).toBeLessThan(10);
    expect(run(`<fo:block-container max-height="60pt" overflow="condense">${LINES(2)}</fo:block-container>`).glyphs[0].size).toBe(10);
  });
  it('絶対の値を書いた字の大きさは変えない (% の字は詰める)', () => {
    const r = run(`<fo:block-container max-height="80pt" overflow="condense">${LINES(8)}<fo:block font-size="12pt">Fixed</fo:block><fo:block font-size="80%">Rel</fo:block></fo:block-container>`);
    const size = (t: string) => r.glyphs.find((g) => g.text === t)!.size;
    expect(size('F')).toBe(12);
    expect(size('L')).toBeLessThan(10);
    expect(size('R')).toBeCloseTo(size('L') * 0.8, 2);
  });
  it('下限 (axf:overflow-condense-limit-font-size) より小さくしない', () => {
    const r = run(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt">${LINES(20)}</fo:block-container>`);
    expect(r.glyphs[0].size).toBeCloseTo(6, 2);
  });
  it('line-height: 行の高さを詰める (字の大きさは変えない)', () => {
    const r = run(`<fo:block-container max-height="100pt" line-height="2" overflow="condense" axf:overflow-condense="line-height">${LINES(10)}</fo:block-container>`);
    expect(r.glyphs[0].size).toBe(10);
    const ls = [...new Set(r.glyphs.filter((g) => g.text === 'L').map((g) => g.y))];
    expect(ls[1] - ls[0]).toBeLessThan(20);
  });
  it('max-height も高さも無ければ、本文の領域 (1 ページ) に収める。keep-together なら次のページへ送ってから詰める', () => {
    const r = run(`<fo:block>Intro</fo:block><fo:block-container keep-together.within-page="always" overflow="condense">${LINES(40)}</fo:block-container>`);
    expect(r.pages).toBe(2);
  });
  it('仕様モード: overflow="condense" は読まずに知らせる。未対応の方法 (letter-spacing) も知らせる', () => {
    const s = run(`<fo:block-container max-height="60pt" overflow="condense">${LINES(10)}</fo:block-container>`, 'spec');
    expect(s.glyphs[0].size).toBe(10);
    expect(s.unsupported['overflow="condense" (--compat antenna のときだけ解釈する値)']).toBe(1);
    const a = run(`<fo:block-container max-height="60pt" overflow="condense" axf:overflow-condense="letter-spacing font-size">${LINES(10)}</fo:block-container>`);
    expect(a.unsupported['axf:overflow-condense="letter-spacing"']).toBe(1);
    expect(a.glyphs[0].size).toBeLessThan(10);
  });
});

/** 字の大きさ (text の字の最初のもの) と、字の上端の広がり (いちばん下の字の y − いちばん上の字の y) */
const sizeOf = (r: ReturnType<typeof run>, t: string) => r.glyphs.find((g) => g.text === t)!.size;
const spread = (r: ReturnType<typeof run>, pick: (g: { text: string }) => boolean = () => true) => {
  const ys = r.glyphs.filter(pick).map((g) => g.y);
  return Math.max(...ys) - Math.min(...ys);
};
const BOX = (attrs = '') => `<fo:block-container height="30pt" overflow="condense"${attrs}>${LINES(10)}</fo:block-container>`;

describe('overflow="condense" の置き場所 (ページに流す本文の外)', () => {
  it('表のセルの中: 高さを決めた容器は詰める', () => {
    const r = run(`<fo:table width="60mm"><fo:table-body><fo:table-row><fo:table-cell><fo:block-container height="30pt" overflow="condense">${LINES(10)}</fo:block-container></fo:table-cell></fo:table-row></fo:table-body></fo:table>`);
    expect(sizeOf(r, 'L')).toBeLessThan(4);
    expect(spread(r)).toBeLessThan(30);
  });
  it('リストの本体の中: 高さを決めた容器は詰める', () => {
    const r = run(`<fo:list-block><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block/></fo:list-item-label><fo:list-item-body start-indent="body-start()">${BOX()}</fo:list-item-body></fo:list-item></fo:list-block>`);
    expect(sizeOf(r, 'L')).toBeLessThan(4);
    expect(spread(r)).toBeLessThan(30);
  });
  it('fo:static-content (柱) の中: 高さを決めた容器は詰める', () => {
    const doc = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body margin-top="20mm"/><fo:region-before extent="15mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before" font-family="Noto Serif JP" font-size="10pt">${BOX()}</fo:static-content><fo:flow flow-name="xsl-region-body" font-family="Noto Serif JP" font-size="10pt"><fo:block>X</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = runDoc(doc);
    expect(sizeOf(r, 'L')).toBeLessThan(4);
    expect(spread(r, (g) => g.text !== 'X')).toBeLessThan(30);
  });
  it('絶対配置の容器: 高さを決めた容器は詰める', () => {
    const r = run(`<fo:block>X</fo:block><fo:block-container absolute-position="absolute" top="20mm" left="0mm" width="50mm" height="30pt" overflow="condense">${LINES(10)}</fo:block-container>`);
    expect(sizeOf(r, 'L')).toBeLessThan(4);
    expect(spread(r, (g) => g.text !== 'X')).toBeLessThan(30);
  });
  it('高さの決まらない容器 (表のセルの中) は詰めず、警告に出す', () => {
    const r = run(`<fo:table width="60mm"><fo:table-body><fo:table-row><fo:table-cell><fo:block-container overflow="condense">${LINES(3)}</fo:block-container></fo:table-cell></fo:table-row></fo:table-body></fo:table>`);
    expect(sizeOf(r, 'L')).toBe(10);
    expect(r.warnings.some((w) => w.includes('overflow="condense"') && w.includes('高さ'))).toBe(true);
  });
});

describe('overflow="condense" で収まらないとき', () => {
  it('絶対の大きさの行ばかりで収まらない: 相対の行も元の大きさに戻し、収まらないと警告に出す', () => {
    const r = run(`<fo:block-container height="30pt" overflow="condense">${LINES(10, ' font-size="10pt"')}<fo:block>Rel</fo:block></fo:block-container>`);
    expect(sizeOf(r, 'R')).toBe(10);
    expect(r.warnings.some((w) => w.includes('overflow="condense"') && w.includes('収まりません'))).toBe(true);
  });
  it('中の高さを決めた容器が外より高い: 字を縮めず、警告に出す', () => {
    const r = run(`<fo:block-container height="30pt" overflow="condense"><fo:block-container height="60pt"><fo:block>In</fo:block></fo:block-container><fo:block>Out</fo:block></fo:block-container>`);
    expect(sizeOf(r, 'I')).toBe(10);
    expect(sizeOf(r, 'O')).toBe(10);
    expect(r.warnings.some((w) => w.includes('収まりません'))).toBe(true);
  });
  it('下限を書いたとき: 下限まで縮めて、はみ出したまま。収まらないと警告に出す', () => {
    const r = run(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt">${LINES(20)}</fo:block-container>`);
    expect(sizeOf(r, 'L')).toBeCloseTo(6, 2);
    expect(r.warnings.some((w) => w.includes('収まりません'))).toBe(true);
  });
  it('容器に書いた絶対の字の大きさも詰める (中で書いた絶対の大きさだけを変えない)', () => {
    const r = run(`<fo:block-container height="30pt" font-size="12pt" overflow="condense">${LINES(10)}</fo:block-container>`);
    expect(sizeOf(r, 'L')).toBeLessThan(5);
    expect(spread(r)).toBeLessThan(30);
  });
  it('入れ子の詰め込み: 内側の容器の字は、外の詰め込みで変わらない (内側だけで詰めた大きさ)', () => {
    // 外は max-height (ページに流す本文の中の、高さの決まらない箱) なので、内側の容器も、ページに流す本文の中で組む
    const inner = (n: number) => `<fo:block-container height="30pt" overflow="condense">${LINES(n, ' color="red"')}</fo:block-container>`;
    // 内側は自分では収まる (2 行): 外が詰めても 10pt のまま
    const r = run(`<fo:block-container max-height="60pt" overflow="condense">${inner(2)}${LINES(6)}</fo:block-container>`);
    expect(r.glyphs.filter((g) => g.text === 'L')[0].size).toBe(10);
    // 内側が自分で詰める (6 行): 内側だけのときと同じ大きさ
    const alone = run(inner(6));
    const r2 = run(`<fo:block-container max-height="60pt" overflow="condense">${inner(6)}${LINES(6)}</fo:block-container>`);
    expect(r2.glyphs.filter((g) => g.text === 'L')[0].size).toBeCloseTo(sizeOf(alone, 'L'), 2);
  });
});

describe('overflow="condense" の高さの決まらない容器 (ページの本文)', () => {
  it('高さも max-height も無く keep-together でもない容器は、詰めずにページをまたいで続け、警告に出す', () => {
    const r = run(`<fo:block>Intro</fo:block><fo:block-container overflow="condense">${LINES(40)}</fo:block-container>`);
    const plain = run(`<fo:block>Intro</fo:block><fo:block-container>${LINES(40)}</fo:block-container>`);
    expect(sizeOf(r, 'L')).toBe(10);
    expect(r.pages).toBe(plain.pages);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.warnings.some((w) => w.includes('overflow="condense"') && w.includes('高さ'))).toBe(true);
  });
});

describe('axf:overflow-condense・-limit-* の継承', () => {
  it('祖先に書いた方法と下限を受け継ぐ (未対応と報告しない)', () => {
    const r = run(`<fo:block-container axf:overflow-condense="line-height" axf:overflow-condense-limit-font-size="6pt"><fo:block-container max-height="40pt" line-height="2" overflow="condense">${LINES(5)}</fo:block-container></fo:block-container>`);
    expect(sizeOf(r, 'L')).toBe(10);
    const ls = [...new Set(r.glyphs.filter((g) => g.text === 'L').map((g) => g.y))];
    expect(ls[1] - ls[0]).toBeLessThan(10);
    expect(Object.keys(r.unsupported)).toEqual([]);
  });
  it('祖先に書いた下限の字の大きさを受け継ぐ', () => {
    const r = run(`<fo:block axf:overflow-condense-limit-font-size="6pt"><fo:block-container max-height="30pt" overflow="condense">${LINES(20)}</fo:block-container></fo:block>`);
    expect(sizeOf(r, 'L')).toBeCloseTo(6, 2);
  });
  it('方法は受け継ぐが、none は受け継がない (none の中の容器は、初期値の auto (font-size) で詰める)', () => {
    const box = `<fo:block-container max-height="40pt" line-height="2" overflow="condense">${LINES(5)}</fo:block-container>`;
    const lines = (r: ReturnType<typeof run>) => [...new Set(r.glyphs.filter((g) => g.text === 'L').map((g) => g.y))];
    // 親に書いた line-height を受け継ぐ: 字の大きさは変えずに、行の間を詰める
    const inh = run(`<fo:block-container axf:overflow-condense="line-height">${box}</fo:block-container>`);
    expect(sizeOf(inh, 'L')).toBe(10);
    expect(lines(inh)[1] - lines(inh)[0]).toBeLessThan(10);
    // 親に none: 子は none を受け継がずに詰める (受け継げば詰めない)。祖先の line-height も、none の所で途切れる (子は初期値の font-size)
    for (const r of [run(`<fo:block-container axf:overflow-condense="none">${box}</fo:block-container>`), run(`<fo:block-container axf:overflow-condense="line-height"><fo:block-container axf:overflow-condense="none">${box}</fo:block-container></fo:block-container>`)]) {
      expect(sizeOf(r, 'L')).toBeLessThan(10);
      expect(spread(r, (g) => g.text === 'L')).toBeLessThan(40);
    }
  });
});

describe('axf:overflow-condense="none" を書いた要素 (詰め込みから除く)', () => {
  it('fo:inline・fo:block に書いた none: その中の字は、外の容器の詰め込みで縮めない (未対応と報告しない)', () => {
    const r = run(`<fo:block-container height="30pt" overflow="condense">${LINES(10)}<fo:block>K <fo:inline axf:overflow-condense="none">N<fo:inline font-weight="bold">Q</fo:inline></fo:inline></fo:block><fo:block axf:overflow-condense="none">B</fo:block></fo:block-container>`);
    expect(sizeOf(r, 'L')).toBeLessThan(5);
    expect(sizeOf(r, 'K')).toBeCloseTo(sizeOf(r, 'L'), 5);
    // none の要素の字と、その中の要素 (none を受け継がないが、除いた要素の中身) の字は元の大きさ
    expect(sizeOf(r, 'N')).toBe(10);
    expect(sizeOf(r, 'Q')).toBe(10);
    expect(sizeOf(r, 'B')).toBe(10);
    expect(Object.keys(r.unsupported)).toEqual([]);
  });
  it('行の高さの詰め込みでも、none の要素の行の高さは変えない', () => {
    const r = run(`<fo:block-container max-height="60pt" line-height="2" overflow="condense" axf:overflow-condense="line-height" axf:overflow-condense-limit-line-height="0.5">${LINES(5)}<fo:block axf:overflow-condense="none"><fo:block>P</fo:block><fo:block>R</fo:block></fo:block></fo:block-container>`);
    const y = (t: string) => r.glyphs.find((g) => g.text === t)!.y;
    const ls = [...new Set(r.glyphs.filter((g) => g.text === 'L').map((g) => g.y))];
    expect(ls[1] - ls[0]).toBeLessThan(20);
    expect(y('R') - y('P')).toBeCloseTo(20, 1);
  });
});

describe('入れ子の詰め込みの手間', () => {
  /** height="200pt" の詰め込みの容器を d 段入れ子にして、中身は 1 行 (どの段も収まる) */
  const fit = (d: number): string => (d === 0 ? '<fo:block>x</fo:block>' : `<fo:block-container height="200pt" overflow="condense">${fit(d - 1)}</fo:block-container>`);
  /** 段ごとに収まらない中身を入れた、詰め込みの容器の d 段の入れ子 (外ほど高い: 20 + 段×10 pt) */
  const unfit = (d: number, k = d): string =>
    k === 0 ? '' : `<fo:block-container height="${20 + k * 10}pt" overflow="condense"><fo:block>a a a a a a a a</fo:block><fo:block>b b b b</fo:block><fo:block>c c c</fo:block>${unfit(d, k - 1)}</fo:block-container>`;
  /** 組んだ回数 (流れの数) と時間 */
  const cost = (flow: string, engine = E.engine) => {
    const doc = importXslFo(fo(flow), parse, { compat: 'antenna' }).document;
    const t0 = performance.now();
    const t = engine.layout(doc);
    return { ms: performance.now() - t0, flows: engine.stats.flows, warnings: t.warnings };
  };
  // 混んだ機械では 1 回の計測が揺れるので、数回測った最小の値で比べる
  const best = (flow: string) => Math.min(...Array.from({ length: 3 }, () => cost(flow).ms));
  it('収まる中身: 段を増やしても、組む回数が段の数の指数で増えない。22 段でも短い時間で終わる', () => {
    // 覚えが無いと、段ごとに 2 倍 (外の測りと本番の組みで、内側を毎回 2 度組む)
    const f6 = cost(fit(6)).flows;
    const f12 = cost(fit(12)).flows;
    expect(f12).toBeLessThan(f6 * 6);
    expect(f12 - cost(fit(11)).flows).toBeLessThan(60);
    const base = best(fit(2));
    expect(best(fit(22))).toBeLessThan(Math.max(base, 5) * 60);
  });
  it('収まらない中身: 段を増やしても、組む回数が段の数の指数で増えない。6 段でも短い時間で終わる', () => {
    // 覚えが無いと、段ごとに 15 倍ほど (外の詰め込みの二分探索のたびに、内側を詰め直す)
    const u2 = cost(unfit(2)).flows;
    const u3 = cost(unfit(3)).flows;
    expect(u3).toBeLessThan(u2 * 3);
    expect(cost(unfit(4)).flows - u3).toBeLessThan(u3);
    const base = best(unfit(1));
    expect(best(unfit(6))).toBeLessThan(Math.max(base, 5) * 60);
  });
  it('覚えを切っても結果は同じ。測る回数の上限に当たったら、以後の容器は詰めずに警告に出す', () => {
    const plain = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo: false });
    const glyphs = (engine: LayoutEngine) => {
      const t = engine.layout(importXslFo(fo(unfit(3)), parse, { compat: 'antenna' }).document);
      const out: string[] = [];
      const rec = (a: AreaNode, oy: number) => {
        const y = oy + a.y;
        if (a.type === 'glyph') out.push(`${(a as GlyphArea).text}|${(a as GlyphArea).fontSize.toFixed(3)}|${y.toFixed(2)}`);
        for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0));
      };
      rec(t.sheets[0], 0);
      return out;
    };
    const g = glyphs(E.engine);
    expect(g.some((x) => !x.includes('|10.000|'))).toBe(true);
    expect(glyphs(plain)).toEqual(g);
    // 覚えを切り、上限を小さくする: 上限で止まる (警告は 1 度だけ)
    const capped = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo: false, maxCondenseMeasures: 200 });
    const r = cost(unfit(5), capped);
    expect(r.warnings.filter((w) => w.includes('測る回数')).length).toBe(1);
    expect(r.flows).toBeLessThan(5000);
  });
  it('毎ページの柱の詰め込みの容器 (入れ子でない) は、ページと容器が多くても、測る回数の上限に当たらず、どのページの柱も詰める', () => {
    // 柱 (region-before) の固定の表の 6 個のセルに、高さ 10pt の詰め込みの容器 (中身は 2 行になる)。本文は 1 ページに 1 ブロック
    const cell = '<fo:table-cell><fo:block-container height="10pt" overflow="condense"><fo:block>Hd <fo:page-number/> words</fo:block></fo:block-container></fo:table-cell>';
    const head = `<fo:table table-layout="fixed" width="100%">${'<fo:table-column column-width="proportional-column-width(1)"/>'.repeat(6)}<fo:table-body><fo:table-row>${cell.repeat(6)}</fo:table-row></fo:table-body></fo:table>`;
    const pages = 60;
    const body = Array.from({ length: pages }, (_, k) => `<fo:block break-before="page">${k + 1}</fo:block>`).join('');
    const doc = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body margin-top="20mm"/><fo:region-before extent="15mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before" font-family="Noto Serif JP" font-size="10pt">${head}</fo:static-content><fo:flow flow-name="xsl-region-body" font-family="Noto Serif JP" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
    // 上限を小さくしても (入れ子でない容器の測りは数えない)、覚えの有無によらず
    for (const measureMemo of [true, false]) {
      const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo, maxCondenseMeasures: 300 });
      const t = engine.layout(importXslFo(doc, parse, { compat: 'antenna' }).document);
      expect(t.sheets.length).toBe(pages);
      expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
      t.sheets.forEach((sh) => {
        // 柱の字 (H) の大きさ: どのページも 6 個とも詰めてある
        const sizes: number[] = [];
        const rec = (a: AreaNode) => {
          if (a.type === 'glyph' && (a as GlyphArea).text === 'H') sizes.push((a as GlyphArea).fontSize);
          for (const c of childrenOf(a)) rec(c);
        };
        rec(sh);
        expect(sizes.length).toBe(6);
        for (const s of sizes) expect(s).toBeLessThan(9);
      });
    }
  });
  /** 字 ch の大きさ (全ページ。ページごと) */
  const sizesOf = (t: { sheets: AreaNode[] }, ch: string): number[][] =>
    t.sheets.map((sh) => {
      const out: number[] = [];
      const rec = (a: AreaNode) => {
        if (a.type === 'glyph' && (a as GlyphArea).text === ch) out.push((a as GlyphArea).fontSize);
        for (const c of childrenOf(a)) rec(c);
      };
      rec(sh);
      return out;
    });
  it('毎ページの柱の入れ子の詰め込みは、いちばん外の容器ごとに数えるので、ページが多くても上限に当たらず、どのページの内側も詰める', () => {
    // 柱の固定の表の 6 個のセルに、2 段の入れ子の詰め込みの容器 (内側の字は Q)。上限は、いちばん外の容器 1 つの測り (覚えありで 26 回・
    // 覚えなしで 169 回ほど) には足り、全ページの合計 (ページ数 × 6 × 26 回ほど) には足りない数
    const cell = '<fo:table-cell><fo:block-container height="14pt" overflow="condense"><fo:block>Hd <fo:page-number/></fo:block><fo:block-container height="6pt" overflow="condense"><fo:block>Q <fo:page-number/> words words</fo:block></fo:block-container></fo:block-container></fo:table-cell>';
    const head = `<fo:table table-layout="fixed" width="100%">${'<fo:table-column column-width="proportional-column-width(1)"/>'.repeat(6)}<fo:table-body><fo:table-row>${cell.repeat(6)}</fo:table-row></fo:table-body></fo:table>`;
    const pages = 20;
    const body = Array.from({ length: pages }, (_, k) => `<fo:block break-before="page">${k + 1}</fo:block>`).join('');
    const doc = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body margin-top="20mm"/><fo:region-before extent="15mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before" font-family="Noto Serif JP" font-size="10pt">${head}</fo:static-content><fo:flow flow-name="xsl-region-body" font-family="Noto Serif JP" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
    const results = [true, false].map((measureMemo) => {
      const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo, maxCondenseMeasures: 300 });
      const t = engine.layout(importXslFo(doc, parse, { compat: 'antenna' }).document);
      expect(t.sheets.length).toBe(pages);
      expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
      const q = sizesOf(t, 'Q');
      for (const s of q) {
        expect(s.length).toBe(6);
        for (const v of s) expect(v).toBeLessThan(5);
      }
      return q;
    });
    // 覚えの有無によらない
    expect(results[1]).toEqual(results[0]);
  });
  it('上限に当たった、いちばん外の容器の分だけ、中の容器を詰めずに測る。ほかの、いちばん外の容器には持ち越さず、警告は 1 度', () => {
    // 覚えを切った 4 段の入れ子 (上限 200 に当たる) を 2 つ、その後ろに、2 段の入れ子 (当たらない。内側の字は Q)
    const deep = (k: number): string => (k === 0 ? '' : `<fo:block-container height="${20 + k * 10}pt" overflow="condense"><fo:block>a a a a a a a a</fo:block><fo:block>b b b b</fo:block><fo:block>c c c</fo:block>${deep(k - 1)}</fo:block-container>`);
    const two = '<fo:block-container height="30pt" overflow="condense"><fo:block>o o o o o o o o</fo:block><fo:block-container height="10pt" overflow="condense"><fo:block>Q q q q q q q q q q q q q q q q q q</fo:block><fo:block>Q q q q</fo:block></fo:block-container></fo:block-container>';
    const doc = importXslFo(fo(deep(4) + deep(4) + two), parse, { compat: 'antenna' }).document;
    const plain = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo: false });
    const alone = sizesOf(plain.layout(importXslFo(fo(two), parse, { compat: 'antenna' }).document), 'Q').flat();
    expect(alone.length).toBe(2);
    expect(alone[0]).toBeLessThan(8);
    for (const measureMemo of [false, true]) {
      const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo, maxCondenseMeasures: 200 });
      const t = engine.layout(doc);
      // 当たったのは覚えを切ったときだけ (覚えがあれば、4 段の入れ子も上限に当たらない)
      expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(measureMemo ? 0 : 1);
      // 後ろの 2 段の入れ子は、それだけを組んだときと同じに詰める
      expect(sizesOf(t, 'Q').flat()).toEqual(alone);
    }
  });
  it('上限に当たったら、そのいちばん外の容器の中の、以後の容器だけを詰めない。同じ中身の、ほかのいちばん外の容器の中の容器は詰める', () => {
    // 上限 5: 1 つ目の外の容器の測りの中で、1 つ目の中の容器 (字 P。13 回ほど測る) の後の、2 つ目の中の容器 (字 Q) は詰めない
    // (外の容器を組むときも)。後ろの外の容器の中の、Q と同じ中身の容器 (字 R。上限に当たらない) は詰める
    const inner = (ch: string) => `<fo:block-container height="10pt" overflow="condense"><fo:block>${ch} q q q q q q q q q q q q q q q q q</fo:block><fo:block>${ch} q q q</fo:block></fo:block-container>`;
    const outer = (x: string) => `<fo:block-container height="40pt" overflow="condense"><fo:block>o o o o o o o o</fo:block>${x}</fo:block-container>`;
    const doc = importXslFo(fo(outer(inner('P') + inner('Q')) + outer(inner('R'))), parse, { compat: 'antenna' }).document;
    // 覚えあり (覚えを切ると、外の容器を組むときに中の容器を詰め直す回数も数えるので、上限 5 では P も R も詰めない)
    const capped = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: 5 });
    const t = capped.layout(doc);
    expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(1);
    expect(sizesOf(t, 'Q').flat()).toEqual([10, 10]);
    // P は上限に当たる前に詰めた結果。R は数え直して詰める
    for (const ch of ['P', 'R']) {
      const v = sizesOf(t, ch).flat();
      expect(v.length).toBe(2);
      for (const x of v) expect(x).toBeLessThan(8);
    }
    // 上限を渡さなければ、Q も詰める
    expect(sizesOf(E.engine.layout(doc), 'Q').flat()[0]).toBeLessThan(8);
  });
  it('上限に当たって詰めなかった結果は覚えないので、同じ容器を組み直すとき (表の見出しの繰り返し) は、数え直して詰める', () => {
    // 表の見出しのセルに、上と同じ外の容器 (中の容器 P・Q)。見出しは、ページごとに (1 ページ目でも、高さを測る組みと本番の組みで) 同じ節を
    // 組み直す。初めの組みでは Q を詰めない (上限に当たる)。次からの組みでは、P は覚えた結果を使うので測らず、Q は数え直した上限の内で
    // 詰める (詰めなかった結果を覚えていれば、どのページの Q も詰めない)
    const inner = (ch: string) => `<fo:block-container height="10pt" overflow="condense"><fo:block>${ch} q q q q q q q q q q q q q q q q q</fo:block><fo:block>${ch} q q q</fo:block></fo:block-container>`;
    const outer = `<fo:block-container height="40pt" overflow="condense"><fo:block>o o o o o o o o</fo:block>${inner('P')}${inner('Q')}</fo:block-container>`;
    const rows = Array.from({ length: 40 }, (_, k) => `<fo:table-row><fo:table-cell><fo:block>row ${k}</fo:block></fo:table-cell></fo:table-row>`).join('');
    const doc = importXslFo(fo(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="100%"/><fo:table-header><fo:table-row><fo:table-cell>${outer}</fo:table-cell></fo:table-row></fo:table-header><fo:table-body>${rows}</fo:table-body></fo:table>`), parse, { compat: 'antenna' }).document;
    const capped = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: 5 });
    const t = capped.layout(doc);
    expect(t.sheets.length).toBeGreaterThan(1);
    for (const q of sizesOf(t, 'Q')) {
      expect(q.length).toBe(2);
      for (const v of q) expect(v).toBeLessThan(8);
    }
    // ページに置いた見出しは、どれも詰めてあるので、上限の警告は出さない (高さを測る組みで当たっただけ)
    expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
  });
  it('上限に当たっても、ページに置いた結果で中の容器を詰め切っていれば (自動の表の列の幅を測った後の本番の組み)、警告は出さない', () => {
    // 自動の表のセルの中に詰め込みの容器を置き、それを 3 段に入れ子にして、さらに自動の表 1 段で包む。表の幅を決める組み・高さを測る組みで
    // 上限に当たっても、組み直すたびに、当たる前に詰めた中の容器の結果を使うので、本番の組みでは中の容器を詰め切る
    const TA = (x: string) => `<fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell><fo:table-cell>${x}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    let x = LINES(4, '');
    for (let d = 0; d < 3; d++) x = `<fo:block-container height="${20 + d * 12}pt" overflow="condense"><fo:block>L${d} 1 text here</fo:block><fo:block>L${d} 2 text here</fo:block>${TA(x)}</fo:block-container>`;
    const doc = importXslFo(fo(TA(x)), parse, { compat: 'antenna' }).document;
    const sheets = (t: { sheets: AreaNode[] }) => JSON.stringify(t.sheets, (k, v) => (k === 'sourceRef' ? undefined : typeof v === 'number' ? Math.round(v * 100) / 100 : v));
    const full = sheets(E.engine.layout(doc));
    for (const max of [40, 80]) {
      const t = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: max }).layout(doc);
      expect(sheets(t)).toBe(full);
      expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
    }
    // 上限がもっと小さく、本番の組みにも詰めなかった容器が残るときは、警告を 1 度出す
    const t = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: 20 }).layout(doc);
    expect(sheets(t)).not.toBe(full);
    expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(1);
  });
  it('既定の上限は、中の容器の多い 2 段の入れ子 (表の 60 個のセルごとの詰め込み) では、覚えを切っても当たらず、覚えの有無で結果が変わらない', () => {
    // 外の詰め込みの容器の中に、固定の表 30 行 × 2 セル、セルごとに高さ 12pt の詰め込みの容器 (中身は 2 行)
    const cell = (i: number) => `<fo:table-cell><fo:block-container height="12pt" overflow="condense"><fo:block>cell ${i} with some words that wrap to two lines here</fo:block></fo:block-container></fo:table-cell>`;
    const R = 30;
    const rows = Array.from({ length: R }, (_, r) => `<fo:table-row>${cell(r * 2)}${cell(r * 2 + 1)}</fo:table-row>`).join('');
    const table = `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="proportional-column-width(1)"/><fo:table-column column-width="proportional-column-width(1)"/><fo:table-body>${rows}</fo:table-body></fo:table>`;
    const PM2 = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="400mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
    const doc = importXslFo(fo(`<fo:block-container height="${R * 12 + 20}pt" overflow="condense"><fo:block>Out 1 text here</fo:block><fo:block>Out 2 text here</fo:block><fo:block>Out 3 text here</fo:block>${table}</fo:block-container><fo:block>after</fo:block>`).replace(PM, PM2), parse, { compat: 'antenna' }).document;
    const res = [true, false].map((measureMemo) => {
      const t = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, measureMemo }).layout(doc);
      expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
      // 外の容器の字 (O) も、セルの中の字 (c) も詰めてある
      for (const ch of ['O', 'c']) for (const v of sizesOf(t, ch).flat()) expect(v).toBeLessThan(9);
      expect(sizesOf(t, 'c').flat().length).toBe(2 * R);
      return [sizesOf(t, 'O'), sizesOf(t, 'c')];
    });
    expect(res[1]).toEqual(res[0]);
  });
  /** 組んだ結果 (箱の木) を比べる文字列 */
  const sheetsOf = (t: { sheets: AreaNode[] }) => JSON.stringify(t.sheets, (k, v) => (k === 'sourceRef' ? undefined : typeof v === 'number' ? Math.round(v * 100) / 100 : v));
  /** 「w 1 text here」のような行を n 行 */
  const TL = (n: number, w: string) => Array.from({ length: n }, (_, k) => `<fo:block>${w} ${k + 1} text here</fo:block>`).join('');
  /** 字 Z の 4 行を、height="20pt"・"32pt"・… の詰め込みの容器で d 段包んだ入れ子 (どの段も詰める) */
  const chain = (d: number) => {
    let x = TL(4, 'Z');
    for (let k = 0; k < d; k++) x = `<fo:block-container height="${20 + k * 12}pt" overflow="condense">${TL(2, 'L' + k)}${x}</fo:block-container>`;
    return x;
  };
  it('既定の上限は、覚えがあれば、いちばん外の容器の中の小さな詰め込みの容器の数で増えない (深い入れ子を止めるまでの手間が延びない)', () => {
    // 自動の表のセルで包んだ 6 段の入れ子 (覚えがあっても、既定の上限 10000 に当たる) と同じ、いちばん外の容器の中に、収まる小さな詰め込みの
    // 容器を 6 個並べる。既定の上限は、渡した 10000 と同じに働く (組む回数も警告も同じ)。小さな容器 1 つごとに上限を増やすと、深い入れ子が
    // 増えた分を使い切り、止めるまでの手間が何倍にも延びる
    const TA = (x: string) => `<fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell><fo:table-cell>${x}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const dums = Array.from({ length: 6 }, (_, i) => `<fo:block-container height="10pt" overflow="condense"><fo:block>d${i}</fo:block></fo:block-container>`).join('');
    let x = '<fo:block>z z z</fo:block><fo:block>z z</fo:block>';
    for (let d = 0; d < 6; d++) x = `<fo:block-container height="${12 + d * 8}pt" overflow="condense"><fo:block>a a a</fo:block>${TA(x)}${d === 5 ? dums : ''}</fo:block-container>`;
    const doc = importXslFo(fo(x), parse, { compat: 'antenna' }).document;
    const r = [undefined, 10000].map((max) => {
      const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, ...(max ? { maxCondenseMeasures: max } : {}) });
      const t = engine.layout(doc);
      return { flows: engine.stats.flows, warnings: t.warnings.filter((w) => w.includes('測る回数')).length, sheets: sheetsOf(t) };
    });
    expect(r[0].flows).toBe(r[1].flows);
    expect(r[0].sheets).toBe(r[1].sheets);
  });
  it('ページをまたいで分ける表の行のセルの中の入れ子: 置いた結果で中の容器を詰め切っていれば、行の高さを測る組みで上限に当たっても、警告は出さない', () => {
    // 固定の表の 1 行。1 つ目のセルに 30 行 (行はページをまたぐ)、2 つ目のセルに 3 段の詰め込みの入れ子。行の高さを測る組みで上限に当たっても、
    // 行を分ける組み (実際に置く組み) は、当たる前に詰めた中の容器の結果を使って詰め切る
    const cellsplit = (rows: number) =>
      importXslFo(fo(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="40mm"/><fo:table-column column-width="40mm"/><fo:table-body><fo:table-row><fo:table-cell><fo:block>${TL(rows, 'R')}</fo:block></fo:table-cell><fo:table-cell>${chain(3)}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`), parse, { compat: 'antenna' }).document;
    const lay = (doc: ReturnType<typeof cellsplit>, max: number) => new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: max }).layout(doc);
    const split = cellsplit(30);
    const full = lay(split, Infinity);
    expect(full.sheets.length).toBe(2);
    let same = 0;
    for (const max of [15, 20, 25, 30]) {
      const t = lay(split, max);
      const eq = sheetsOf(t) === sheetsOf(full);
      if (eq) same++;
      // 結果が上限なしと同じ ⇔ 警告なし
      expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(eq ? 0 : 1);
    }
    expect(same).toBeGreaterThan(0);
    // 行を分けない (測った組みをそのまま置く) 表で、上限で詰めなかった容器が残るときは、警告を 1 度出す
    const whole = cellsplit(3);
    const t = lay(whole, 3);
    expect(sheetsOf(t)).not.toBe(sheetsOf(lay(whole, Infinity)));
    expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(1);
  });
  it('上限で詰めなかった中の容器が、もともと収まる中身なら (結果が上限なしと同じなら)、警告は出さない', () => {
    // 外の容器の中に、詰める要る容器 A と、もともと収まる容器 B。上限が小さく、B を詰めずに組んでも、B は詰める要が無い
    const A = `<fo:block-container height="20pt" overflow="condense">${TL(6, 'A')}</fo:block-container>`;
    const doc = (b: string) => importXslFo(fo(`<fo:block-container height="150pt" overflow="condense">${TL(3, 'O')}${A}${b}</fo:block-container>`), parse, { compat: 'antenna' }).document;
    const lay = (d: ReturnType<typeof doc>, max: number) => new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, maxCondenseMeasures: max }).layout(d);
    const fit = doc(`<fo:block-container height="60pt" overflow="condense">${TL(2, 'B')}</fo:block-container>`);
    const full = sheetsOf(lay(fit, Infinity));
    for (const max of [1, 5, 10]) {
      const t = lay(fit, max);
      expect(sheetsOf(t)).toBe(full);
      expect(t.warnings.filter((w) => w.includes('測る回数'))).toEqual([]);
    }
    // 収まらない B (詰める要る): 上限で詰めなければ、結果が変わり、警告を 1 度出す
    const unfitB = doc(`<fo:block-container height="12pt" overflow="condense">${TL(2, 'B')}</fo:block-container>`);
    const fullU = sheetsOf(lay(unfitB, Infinity));
    for (const max of [1, 5, 10]) {
      const t = lay(unfitB, max);
      expect(sheetsOf(t)).not.toBe(fullU);
      expect(t.warnings.filter((w) => w.includes('測る回数')).length).toBe(1);
    }
  });
});

describe('下限の後ろの語 (hidden など)', () => {
  /** 切り抜く箱 (clip) の数 */
  const clips = (flow: string) => {
    const r = importXslFo(fo(flow), parse, { compat: 'antenna' });
    const t = E.engine.layout(r.document);
    let n = 0;
    const rec = (a: AreaNode) => {
      if ((a as { clip?: boolean }).clip) n++;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(t.sheets[0]);
    return { n, unsupported: r.report.unsupported };
  };
  /** 切り抜く箱の高さと、後ろのブロック ("After") の字の位置 (ページの番号と、ページの上からの位置) */
  const clipped = (flow: string) => {
    const t = E.engine.layout(importXslFo(fo(`${flow}<fo:block>After</fo:block>`), parse, { compat: 'antenna' }).document);
    const boxes: Array<{ h: number; y: number }> = [];
    let after: { page: number; y: number } | undefined;
    t.sheets.forEach((sh, page) => {
      const rec = (a: AreaNode, oy: number) => {
        const y = oy + a.y;
        if ((a as { clip?: boolean }).clip) boxes.push({ h: a.height, y });
        if (a.type === 'glyph' && (a as GlyphArea).text === 'A' && !after) after = { page, y };
        for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0));
      };
      rec(sh, 0);
    });
    return { boxes, after: after! };
  };
  it('下限でも収まらないとき、hidden なら中身を切り抜く。収まれば切り抜かない', () => {
    expect(clips(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt hidden">${LINES(20)}</fo:block-container>`).n).toBe(1);
    expect(clips(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt">${LINES(20)}</fo:block-container>`).n).toBe(0);
    expect(clips(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt hidden">${LINES(2)}</fo:block-container>`).n).toBe(0);
  });
  it('切り抜く箱の高さは収める高さ (height・max-height・keep-together なら本文の領域) で、後ろのブロックはその後から続く', () => {
    const top = 28.35; // 本文の領域の上端 (余白 10mm)
    for (const h of ['height', 'max-height']) {
      const r = clipped(`<fo:block-container ${h}="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt hidden">${LINES(20)}</fo:block-container>`);
      expect(r.boxes.length).toBe(1);
      expect(r.boxes[0].h).toBeCloseTo(30, 1);
      // 後ろのブロックの字は、箱の下端 (上端 + 30pt) のすぐ後 (1 行 = 10pt の字の中)
      expect(r.after.page).toBe(0);
      expect(r.after.y).toBeGreaterThan(top + 30 - 1);
      expect(r.after.y).toBeLessThan(top + 30 + 15);
    }
    // keep-together の容器 (高さの指定なし): 本文の領域 (226.77pt) に抑えて切る。後ろのブロックは次のページの先頭
    const k = clipped(`<fo:block-container keep-together.within-page="always" overflow="condense" axf:overflow-condense-limit-font-size="9pt hidden">${LINES(40)}</fo:block-container>`);
    expect(k.boxes.length).toBe(1);
    expect(k.boxes[0].h).toBeCloseTo(226.77, 0);
    expect(k.after.page).toBe(1);
  });
  it('max-height より大きい min-height の容器を切り抜くときは、箱を min-height より小さくしない (CSS 2.1 §10.7)', () => {
    const top = 28.35;
    const r = clipped(`<fo:block-container max-height="30pt" min-height="50pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt hidden">${LINES(20)}</fo:block-container>`);
    expect(r.boxes.length).toBe(1);
    expect(r.boxes[0].h).toBeCloseTo(50, 1);
    expect(r.after.page).toBe(0);
    expect(r.after.y).toBeGreaterThan(top + 50 - 1);
    expect(r.after.y).toBeLessThan(top + 50 + 15);
    // min-height より小さい max-height でないとき (min-height < max-height) は、これまでどおり max-height で切る
    const s = clipped(`<fo:block-container max-height="30pt" min-height="20pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt hidden">${LINES(20)}</fo:block-container>`);
    expect(s.boxes[0].h).toBeCloseTo(30, 1);
  });
  it('max-height より大きい min-height の容器は、min-height に収まる中身を詰めず、超える中身は min-height に収まるまで詰める (CSS 2.1 §10.7)', () => {
    // 中身 3 行 (36pt ほど): 50pt の箱に入るので、字は 10pt のまま
    const three = run(`<fo:block-container max-height="30pt" min-height="50pt" overflow="condense">${LINES(3)}</fo:block-container>`);
    expect(three.glyphs.length).toBeGreaterThan(0);
    for (const g of three.glyphs) expect(g.size).toBe(10);
    expect(three.warnings.filter((w) => w.includes('詰めても'))).toEqual([]);
    // 中身 8 行: 50pt に収まるまで詰める (max-height="50pt" と同じ大きさ。30pt に収めるほどは縮めない)
    const eight = run(`<fo:block-container max-height="30pt" min-height="50pt" overflow="condense">${LINES(8)}</fo:block-container>`);
    const at50 = run(`<fo:block-container max-height="50pt" overflow="condense">${LINES(8)}</fo:block-container>`);
    const at30 = run(`<fo:block-container max-height="30pt" overflow="condense">${LINES(8)}</fo:block-container>`);
    expect(at50.glyphs[0].size).toBeLessThan(10);
    expect(at50.glyphs[0].size).toBeGreaterThan(at30.glyphs[0].size + 1);
    expect(eight.glyphs.map((g) => [g.size, g.y])).toEqual(at50.glyphs.map((g) => [g.size, g.y]));
    // 下限 4pt: 8 行は、50pt には下限の上で収まるので、収まらないとは言わない (30pt に収めるには 4pt より小さくする)
    expect(at30.glyphs[0].size).toBeLessThan(4);
    expect(at50.glyphs[0].size).toBeGreaterThan(4);
    const lim = run(`<fo:block-container max-height="30pt" min-height="50pt" overflow="condense" axf:overflow-condense-limit-font-size="4pt">${LINES(8)}</fo:block-container>`);
    expect(lim.warnings.filter((w) => w.includes('詰めても'))).toEqual([]);
    expect(lim.glyphs[0].size).toBeCloseTo(at50.glyphs[0].size, 1);
  });
  it('次の方法があれば、前の方法の下限の後ろの語は使わない。repeat は未対応として知らせる', () => {
    expect(clips(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense="font-size line-height" axf:overflow-condense-limit-font-size="6pt hidden" axf:overflow-condense-limit-line-height="1.2">${LINES(20)}</fo:block-container>`).n).toBe(0);
    expect(clips(`<fo:block-container max-height="30pt" overflow="condense" axf:overflow-condense-limit-font-size="6pt repeat">${LINES(20)}</fo:block-container>`).unsupported['axf:overflow-condense-limit-font-size="6pt repeat"']).toBe(1);
  });
  it('axf:overflow-condense-limit-line-height の数は、字の大きさに対する比', () => {
    const r = run(`<fo:block-container max-height="30pt" line-height="2" overflow="condense" axf:overflow-condense="line-height" axf:overflow-condense-limit-line-height="1.5">${LINES(10)}</fo:block-container>`);
    const ls = [...new Set(r.glyphs.filter((g) => g.text === 'L').map((g) => g.y))];
    expect(ls[1] - ls[0]).toBeCloseTo(15, 1);
  });
});

describe('詰めた容器の、元の入力の節の番号', () => {
  /** 元の入力の節の番号 (sourceRef) の付いた箱の数 */
  const refs = (flow: string) => {
    const t = E.engine.layout(importXslFo(fo(flow), parse, { compat: 'antenna' }).document);
    let n = 0;
    const rec = (a: AreaNode) => {
      if ((a as { sourceRef?: number }).sourceRef !== undefined) n++;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(t.sheets[0]);
    return n;
  };
  it('詰めても、詰めなくても、収まっていても同じ', () => {
    const n = refs(`<fo:block-container height="30pt">${LINES(10)}</fo:block-container>`);
    expect(n).toBeGreaterThan(0);
    expect(refs(`<fo:block-container height="30pt" overflow="condense">${LINES(10)}</fo:block-container>`)).toBe(n);
    expect(refs(`<fo:block-container height="30pt" overflow="condense">${LINES(2)}</fo:block-container>`)).toBe(refs(`<fo:block-container height="30pt">${LINES(2)}</fo:block-container>`));
  });
});
