/**
 * 幅の指定の無い flex の項目の幅を、組むときに中身を組んで測る (Flexbox 1 §9.2 の 3 の E。LTableColumn.fitContent) (利用者の報告: 目次)。
 * これまでは、読み込みのときに字の幅を足して中身の幅 (max-content) を見積もり (htmlImport.ts の maxContentWidth)、その幅の列にしていた。
 * 見積もりは、行を組むときの要素の間の空白・行内の箱の余白と枠・::before の中身・語間などを数えず、組んだ行より狭いと、
 * 目次の項目名の最後の語・字が次の行に送られていた (項目名・リーダー・ページ番号を flex で並べる組み方)。
 * 行が入りきらないときは、組むときに測った幅から flex-shrink の比で縮める (§9.7。LTableColumn.flexItem)
 *
 * テストの書体は Noto Sans JP。@font-face で読み、欧文もその書体で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

type Node = { type: string; text?: string; x?: number; y?: number; width?: number; children?: Node[] };
const typesetHtml = async (css: string, body: string) =>
  typeset(`<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} @page{size:400pt 400pt;margin:0} body{margin:0;font:10pt K} ${css}</style><body>${body}`, {
    loadFont,
    fetchImages: false,
    fetchStyles: false,
    files: [{ name: 'k.ttf', data }],
  });

/** 行の箱ごとの字の並び (本文の領域の中を、上から順に) */
async function lines(css: string, body: string): Promise<string[]> {
  const out: string[] = [];
  const visit = (a: Node) => {
    if (a.type === 'line') {
      let t = '';
      const v = (b: Node) => {
        if (b.type === 'glyph') t += b.text;
        for (const c of b.children ?? []) v(c);
      };
      v(a);
      out.push(t);
      return;
    }
    for (const c of a.children ?? []) visit(c);
  };
  visit((await typesetHtml(css, body)).areaTree.sheets[0].page.regionBody as unknown as Node);
  return out;
}

/** 字の箱 (ページの上の位置) */
async function glyphs(css: string, body: string): Promise<Array<{ text: string; x: number; w: number }>> {
  const out: Array<{ text: string; x: number; w: number }> = [];
  const visit = (a: Node, ox: number) => {
    const x = ox + (a.x ?? 0);
    if (a.type === 'glyph') out.push({ text: a.text ?? '', x, w: a.width ?? 0 });
    for (const c of a.children ?? []) visit(c, x);
  };
  visit((await typesetHtml(css, body)).areaTree.sheets[0].page.regionBody as unknown as Node, 0);
  return out;
}

const TOC = '.f{display:flex} .l{flex:1}';
/** 目次の 1 行: 項目名・リーダー (flex: 1)・ページ番号 */
const row = (title: string) => `<div class="f"><span class="t">${title}</span><span class="l"></span><span>16</span></div>`;

describe('目次の行の項目名が、見積もりの幅に入りきらずに折り返されない (直す前は、どれも最後の語が次の行に送られた)', () => {
  const cases: Array<[string, string, string, string]> = [
    ['要素の間の空白', '', '<b>1.2</b> <b>Overview of things</b>', '1.2 Overview of things'],
    ['リンクの中の要素の間の空白', '', '<a href="#x"><span>1.2</span> <span>Overview of things</span></a>', '1.2 Overview of things'],
    ['和字と欧文の要素の間の空白', '', '<b>第1章</b> Overview', '第1章 Overview'],
    ['行内の要素の余白', '.n{margin-right:2em}', '<span class="n">1.2</span>Overview of things', '1.2Overview of things'],
    ['行内の要素の左の余白', '.n{margin-left:1em}', 'Overview<span class="n">of things</span>', 'Overviewof things'],
    ['行内の要素の内側の余白', '.n{padding:0 1em}', '<span class="n">1.2</span>Overview of things', '1.2Overview of things'],
    ['行内の要素の枠', '.n{border:3pt solid}', '<span class="n">1.2</span>Overview of things', '1.2Overview of things'],
    ['子孫の ::before', '.n::before{content:"Chapter "}', '<span class="n">1</span> Overview of things', 'Chapter 1 Overview of things'],
    ['子孫の ::before のカウンター', 'body{counter-reset:c} .n::before{counter-increment:c;content:"Chapter " counter(c) "."}', '<span class="n"></span> Overview of things', 'Chapter 1. Overview of things'],
    ['項目の ::before', '.t::before{content:"Chapter 1 "}', 'Overview of things', 'Chapter 1 Overview of things'],
    ['項目の ::after', '.t::after{content:" (new)"}', 'Overview of things', 'Overview of things (new)'],
    ['word-spacing', '.t{word-spacing:5pt}', 'Overview of the many things', 'Overview of the many things'],
    ['inline-block の幅', '.n{display:inline-block;width:4em}', '<span class="n">1.2</span>Overview of things', '1.2Overview of things'],
    ['inline-block の内側の余白', '.n{display:inline-block;padding:0 1em}', '<span class="n">1.2</span>Overview of things', '1.2Overview of things'],
    ['上付きの字の後ろの空白', '.n{vertical-align:super;font-size:smaller}', 'Overview<span class="n">1</span> of things', 'Overview1 of things'],
    ['子の要素の letter-spacing', '.n{letter-spacing:3pt}', '<span class="n">Overview</span> of things', 'Overview of things'],
  ];
  for (const [name, css, title, text] of cases) {
    it(name, async () => {
      expect(await lines(TOC + css, row(title))).toEqual([text, '16']);
    });
  }
  it('justify-content: space-between の行', async () => {
    expect(await lines('.f{display:flex;justify-content:space-between}', '<div class="f"><span><b>1.2</b> <b>Overview of things</b></span><span>16</span></div>')).toEqual(['1.2 Overview of things', '16']);
  });
  it('flex-wrap: wrap の行', async () => {
    expect(await lines('.f{display:flex;flex-wrap:wrap} .l{flex:1}', row('<b>1.2</b> <b>Overview of things</b>'))).toEqual(['1.2 Overview of things', '16']);
  });
  it('伸びる項目 (flex: auto。基準の大きさが中身の幅)', async () => {
    expect(await lines('.f{display:flex} .t{flex:auto}', '<div class="f"><span class="t"><b>1.2</b> <b>Overview of things</b></span><span>16</span></div>')).toEqual(['1.2 Overview of things', '16']);
  });
});

describe('測った幅で行が入りきらなければ、組むときに縮める (Flexbox 1 §9.7)', () => {
  it('長い項目名は、容器の幅の中で折り返し、ページ番号は右端に置く', async () => {
    const g = await glyphs(TOC, row('Overview of things '.repeat(8).trim()));
    // ページ番号の字の右端が、容器 (ページの幅 400pt) の右端にある
    const six = g.filter((x) => x.text === '6').pop()!;
    expect(six.x + six.w).toBeGreaterThan(398);
    expect(six.x + six.w).toBeLessThan(400.5);
    // どの字も、容器の幅からはみ出さない
    expect(Math.max(...g.map((x) => x.x + x.w))).toBeLessThan(400.5);
    // 項目名の字は、ページ番号より左
    expect(Math.max(...g.filter((x) => x !== six && x.text !== '1').map((x) => x.x + x.w))).toBeLessThan(six.x);
  });
  it('max-width で止めた項目は、その幅の中で折り返す', async () => {
    const g = await glyphs(TOC + ' .t{max-width:60pt}', row('Overview of things'));
    const title = g.filter((x) => /[a-z]/i.test(x.text));
    expect(Math.max(...title.map((x) => x.x + x.w))).toBeLessThan(60.5);
  });
  it('min-width の指定より狭く縮めない', async () => {
    const g = await glyphs('.f{display:flex;width:100pt} .t{min-width:80pt}', '<div class="f"><span class="t">Overview of things</span><span>Overview of things</span></div>');
    // 2 つめの項目の最初の字 (O) は、1 つめの項目の下限 80pt より右
    const os = g.filter((x) => x.text === 'O');
    expect(os[1].x).toBeGreaterThan(79.9);
  });
  it('項目の中の横並びの flex は、項目の幅の合計で測る (置く場所いっぱいの表の幅を数えない。Flexbox 1 §9.9.1)', async () => {
    // 直す前は、中の flex の 1 行の表が測る行の長さ (1e7) いっぱいに広がり、2 つめの項目が容器を占めて、1 つめ (flex: 1) が最も狭い幅に縮んだ
    // (WeasyPrint の見本の ticket)
    const g = await glyphs('.f{display:flex;width:400pt} .in{display:flex}', '<div class="f"><div style="flex:1">Left</div><section><div class="in"><span>CDG</span><span style="flex:1">5PM</span></div></section></div>');
    const c = g.find((x) => x.text === 'C')!;
    const m = g.filter((x) => x.text === 'M').pop()!;
    expect(c.x).toBeGreaterThan(300);
    expect(m.x + m.w).toBeLessThan(400.5);
  });
  it('min-width: auto の項目は、中身の最も狭い幅 (長い語) より狭く縮めない', async () => {
    const g = await glyphs('.f{display:flex;width:60pt}', '<div class="f"><span>Internationalization</span><span>b</span></div>');
    const n = g.filter((x) => x.text === 'n').pop()!;
    const b = g.find((x) => x.text === 'b')!;
    expect(b.x).toBeGreaterThanOrEqual(n.x + n.w - 0.01);
  });
});
