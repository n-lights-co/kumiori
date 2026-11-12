/**
 * 脆弱性検査の残り (組版): 小さな入力で時間・メモリを使い切らせる入力への備え。
 *  - 折り返さない長い 1 行 (breakOne の、折り返せる位置の探し直し)
 *  - 生成内容の字の数の予算・@counter-style の長すぎる記号・FO の長すぎる format
 *  - 表の rowspan の上限・繰り返す見出しとフッターがページを埋める表
 *  - static-content の使い回しと、ページより下の行
 *  - 圏点の文字列は最初の書記素クラスタ
 *  - 点線の罫線の点の数・ZWJ でつながる長いクラスタ・float の索引・change-bar・深い入れ子のしおりの題
 *  - 大きな配列を引数に広げない (pushAll・maxOf)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { limitTreeDepth } from '../src/htmlPrepare';
import { importXslFo } from '../src/xslfoImport';
import { CounterStyles, MAX_COUNTER_LENGTH, parseCounterStyleRule } from '../src/counterStyle';
import { limitTableSpans, MAX_SPANNED_SLOTS } from '../src/tableLimits';
import { maxOf, minOf, pushAll } from '../src/arrayLoop';
import { renderPdf } from '../src/pdfRenderer';
import { childrenOf } from '../src/areaTree';
import type { Area, LDocument, LTable, LTableCell, LTableRow } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const lk = (h: string) => parseHTML(h).document as unknown as Document;
const imp = (body: string, css = '') => {
  const d = lk(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`);
  limitTreeDepth(d);
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ字 (ページごと) */
const pageTexts = (doc: LDocument) =>
  E.engine.layout(doc).sheets.map((s) => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s.page);
    return out.join('');
  });
/** 論理ツリーの文字列の長さの合計 */
const textLength = (doc: unknown) => {
  let n = 0;
  JSON.stringify(doc, (_k, v) => {
    if (typeof v === 'string') n += v.length;
    return v;
  });
  return n;
};
const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string, o: { seq?: string; statics?: string; h?: string } = {}) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="${o.h ?? '100mm'}" margin="10mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="10mm"/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m" ${o.seq ?? ''}>${o.statics ?? ''}` +
  `<fo:flow flow-name="xsl-region-body" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;

describe('折り返さない長い 1 行', () => {
  it('white-space: nowrap の長い行 (2 万語) を、すぐに組める。行は 1 本 (折り返さない)', () => {
    const t0 = Date.now();
    const { document } = imp(`<p style="white-space: nowrap">${'x y '.repeat(20000)}</p>`);
    const pages = pageTexts(document);
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(pages.join('').replace(/\s/g, '')).toBe('xy'.repeat(20000));
  });
  it('nowrap の中の字があふれたら、前の、折り返してよい位置 (nowrap の外の空白) で改行する (これまでどおり)', () => {
    const { document } = imp(`<p style="width: 60pt; font-size: 10pt">aa <span style="white-space: nowrap">${'b'.repeat(30)}</span></p>`);
    const sheets = E.engine.layout(document).sheets;
    const lines: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'line') {
        const g: string[] = [];
        const r2 = (b: Area) => {
          if (b.type === 'glyph') g.push(b.text);
          for (const c of childrenOf(b)) r2(c);
        };
        r2(a);
        lines.push(g.join(''));
        return;
      }
      for (const c of childrenOf(a)) rec(c);
    };
    rec(sheets[0].page);
    expect(lines.map((l) => l.trim())).toEqual(['aa', 'b'.repeat(30)]);
  });
});

describe('生成内容の字の数の予算', () => {
  it('attr() を並べた content は、予算 (20 万字 + 文書の字の 2 倍 + 要素あたり 32 字) を超えた分を出さず、報告する', () => {
    const title = 'x'.repeat(2000);
    const { document, report } = imp(`<p title="${title}">p</p>`, `p::before { content: ${'attr(title) '.repeat(2000)} }`);
    const n = textLength(document);
    expect(n).toBeGreaterThan(190_000);
    expect(n).toBeLessThan(260_000);
    expect(Object.keys(report.unsupported).some((k) => /生成内容/.test(k))).toBe(true);
  });
  it('ふつうの生成内容は、そのまま', () => {
    const { document, report } = imp('<h2>a</h2><h2>b</h2>', 'body { counter-reset: c } h2 { counter-increment: c } h2::before { content: "第" counter(c) "章 " }');
    expect(pageTexts(document).join('')).toBe('第1章 a第2章 b');
    expect(Object.keys(report.unsupported).some((k) => /生成内容/.test(k))).toBe(false);
  });
  it('長い区切りの字の counters() も、予算で止まる', () => {
    const sep = 's'.repeat(100000);
    const li = (n: number): string => (n ? `<ol><li>x${li(n - 1)}</li></ol>` : '');
    const { document } = imp(li(20), `ol { counter-reset: n } li { counter-increment: n } li::before { content: counters(n, "${sep}") }`);
    expect(textLength(document)).toBeLessThan(500_000);
  });
  it('string-set の値も予算から引く', () => {
    const decl = Array.from({ length: 300 }, (_, i) => `s${i} "${'x'.repeat(1000)}"`).join(', ');
    const { document } = imp('<h1>t</h1>'.repeat(10), `h1 { string-set: ${decl} }`);
    expect(textLength(document)).toBeLessThan(500_000);
  });
});

describe('@counter-style の長すぎる記号', () => {
  const styles = (body: string) => {
    const decls = body.split(';').map((d) => d.split(':').map((x) => x.trim()) as [string, string]);
    return new CounterStyles(new Map([['ext', parseCounterStyleRule(decls)]]), () => undefined, () => undefined);
  };
  it(`prefix・suffix が ${MAX_COUNTER_LENGTH} 字を超えるなら、その記述子を読まない (初期値)`, () => {
    expect(styles(`system: cyclic; symbols: a; prefix: "${'p'.repeat(MAX_COUNTER_LENGTH + 1)}"`).marker('ext', 3)).toBe('a. ');
    expect(styles(`system: cyclic; symbols: a; suffix: "${'s'.repeat(MAX_COUNTER_LENGTH + 1)}"`).marker('ext', 3)).toBe('a. ');
  });
  it('上限までの prefix は今までどおり', () => {
    expect(styles('system: cyclic; symbols: a; prefix: "("; suffix: ") "').marker('ext', 3)).toBe('(a) ');
    expect(styles(`system: cyclic; symbols: a; prefix: "${'p'.repeat(MAX_COUNTER_LENGTH)}"`).marker('ext', 3)).toBe(`${'p'.repeat(MAX_COUNTER_LENGTH)}a. `);
  });
  it('長すぎる記号の symbols も読まない', () => {
    expect(styles(`system: cyclic; symbols: "${'a'.repeat(MAX_COUNTER_LENGTH + 1)}"`).text('ext', 1)).not.toBe('a'.repeat(MAX_COUNTER_LENGTH + 1));
  });
});

describe('FO の長すぎる format', () => {
  it(`page-sequence の format が ${MAX_COUNTER_LENGTH} 字を超えるなら読まない (報告する)`, () => {
    const im = importXslFo(fo('<fo:block>x</fo:block>', { seq: `format="${'0'.repeat(100000)}1"` }), parse);
    expect(im.document.sequences[0].pageNumberFormat).toBeUndefined();
    expect(Object.keys(im.report.unsupported).some((k) => /format/.test(k))).toBe(true);
  });
  it('ふつうの format は今までどおり', () => {
    const im = importXslFo(fo('<fo:block>x</fo:block>', { seq: 'format="001"' }), parse);
    expect(im.document.sequences[0].pageNumberFormat).toBe('001');
  });
});

describe('表の rowspan の上限', () => {
  const cell = (rowSpan?: number, colSpan?: number): LTableCell => ({ type: 'table-cell', children: [], ...(rowSpan ? { rowSpan } : {}), ...(colSpan ? { colSpan } : {}) }) as LTableCell;
  const row = (cells: LTableCell[]): LTableRow => ({ type: 'table-row', cells }) as LTableRow;
  it('行グループの残りの行数で切る (HTML §4.9.12 の行グループの終わり)', () => {
    const t = { type: 'table', columns: [], body: { rows: [row([cell(65534), cell()]), row([cell()])] } } as unknown as LTable;
    expect(limitTableSpans(t)).toBe(false);
    expect(t.body.rows[0].cells[0].rowSpan).toBe(2);
  });
  it('またいだ先のマスの合計が上限を超える分は、またがせない (警告の印を返す)', () => {
    const n = 2000;
    const rows = Array.from({ length: n }, () => row([cell(65534), cell()]));
    const t = { type: 'table', columns: [], body: { rows } } as unknown as LTable;
    expect(limitTableSpans(t)).toBe(true);
    const slots = rows.reduce((a, r) => a + ((r.cells[0].rowSpan ?? 1) - 1), 0);
    expect(slots).toBeLessThanOrEqual(MAX_SPANNED_SLOTS + 2 * n * 4);
    // 先のセルは、行グループの終わりまで
    expect(rows[0].cells[0].rowSpan).toBe(n);
  });
  it('rowspan="65534" のセルが並ぶ表 (500 行) を、すぐに組める', () => {
    const t0 = Date.now();
    const { document } = imp(`<table>${'<tr><td rowspan="65534">x</td><td>y</td></tr>'.repeat(500)}</table>`);
    E.engine.layout(document);
    expect(Date.now() - t0).toBeLessThan(30000);
  });
});

describe('繰り返す見出しとフッターがページを埋める表', () => {
  it('見出しとフッターだけでページの高さを超えるなら、続きのページでは繰り返さない', () => {
    const { document } = imp(
      `<table><thead>${'<tr><td>h</td></tr>'.repeat(20)}</thead><tfoot>${'<tr><td>f</td></tr>'.repeat(20)}</tfoot><tbody>${'<tr><td>b</td></tr>'.repeat(50)}</tbody></table>`,
      '@page { size: 100mm 30mm; margin: 2mm }',
    );
    const t0 = Date.now();
    const r = E.engine.layout(document);
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(r.warnings.some((w) => /繰り返しません/.test(w))).toBe(true);
    const all = pageTexts(document).join('');
    expect(all.split('b').length - 1).toBe(50);
  });
});

describe('static-content', () => {
  it('ページで変わらない static-content は使い回し、ページより下の行は描かない (ページに見える字は同じ)', () => {
    const lorem = 'The quick brown fox jumps over the lazy dog. '.repeat(40);
    const statics = `<fo:static-content flow-name="xsl-region-before"><fo:block>${'<fo:block>' + lorem + '</fo:block>'}${`<fo:block>${lorem}</fo:block>`.repeat(30)}</fo:block></fo:static-content>`;
    const im = importXslFo(fo('<fo:block break-after="page">a</fo:block>'.repeat(20), { statics }), parse);
    const t0 = Date.now();
    const pages = pageTexts(im.document);
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(pages.length).toBe(20);
    // 1 ページめと 20 ページめの柱は同じ。描く字は、全部の字よりずっと少ない
    expect(pages[19].replace(/a/g, '')).toBe(pages[0].replace(/a/g, ''));
    expect(pages[0].length).toBeLessThan(lorem.length * 31 * 0.5);
    // ページの中の柱の最初の字は描く
    expect(pages[0].startsWith('Thequick') || pages[0].includes('The')).toBe(true);
  });
  it('ページ番号を含む static-content は、ページごとに組む', () => {
    const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block>p<fo:page-number/></fo:block></fo:static-content>';
    const im = importXslFo(fo('<fo:block break-after="page">a</fo:block>'.repeat(3), { statics }), parse);
    expect(pageTexts(im.document).map((s) => s.replace(/a/g, ''))).toEqual(['p1', 'p2', 'p3']);
  });
  it('position: running() の要素は、ページで変わらなければ使い回す (各ページに同じ字)', () => {
    const { document } = imp(`<h1>${'<b>x</b> '.repeat(50)}</h1>${'<p style="break-after: page">p</p>'.repeat(5)}`, 'h1 { position: running(h) } @page { @top-center { content: element(h) } }');
    const pages = pageTexts(document);
    expect(pages.length).toBe(5);
    for (const p of pages) expect(p.replace(/[p\s]/g, '')).toBe('x'.repeat(50));
  });
});

describe('圏点の文字列', () => {
  it('最初の書記素クラスタだけを使う (CSS Text Decoration 4 §3.1)', () => {
    const { document } = imp('<p>あい</p>', `p { text-emphasis: "${'★'.repeat(500)}" }`);
    const rubies: string[] = [];
    JSON.stringify(document, (_k, v) => {
      if (v && v.type === 'ruby') rubies.push(v.rubyText);
      return v;
    });
    expect(rubies).toEqual(['★', '★']);
  });
});

describe('点線の罫線・ZWJ・float・change-bar・入れ子', () => {
  it('点の数が上限を超える点線の辺 (幅 1e7px) を、すぐに PDF にできる', async () => {
    const t0 = Date.now();
    const { document } = imp('<p style="border: 1px dotted; width: 1e7px; height: 10px">x</p>');
    const pdf = await renderPdf(E.engine.layout(document), E.fonts);
    expect(pdf.length).toBeGreaterThan(100);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
  it('ZWJ でつながる長いクラスタ (2000 組) を、すぐに組める', () => {
    const t0 = Date.now();
    const { document } = imp(`<p>${'\u{1F468}‍'.repeat(2000)}</p>`);
    E.engine.layout(document);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
  it('float の置き場所は、これまでどおり (左から並べ、入らなければ下の行へ)', () => {
    const { document } = imp(`<div style="width: 70px">${'<span>x</span>'.repeat(25)}</div>`, 'span { float: left; width: 7px; height: 9px }');
    const sheets = E.engine.layout(document).sheets;
    const pos: Array<[number, number]> = [];
    const rec = (a: Area, x: number, y: number) => {
      if (a.type === 'block' && (a as { float?: boolean }).float) pos.push([Math.round((x + a.x) * 100) / 100, Math.round((y + a.y) * 100) / 100]);
      for (const c of childrenOf(a)) rec(c, x + a.x, y + a.y);
    };
    rec(sheets[0].page, 0, 0);
    expect(pos.length).toBe(25);
    const xs = [...new Set(pos.map((p) => p[0]))];
    const ys = [...new Set(pos.map((p) => p[1]))];
    // 70px の箱に 7px の float は 10 個ずつ並ぶ (3 行)
    expect(xs.length).toBe(10);
    expect(ys.length).toBe(3);
    expect(pos.filter((p) => p[1] === ys[0]).length).toBe(10);
    expect(pos.filter((p) => p[1] === ys[2]).length).toBe(5);
  });
  it('同じ所に同じ見た目で引く change-bar は 1 本にまとめる。色の違うものは残す', () => {
    const begin = (c: string, color = 'black') => `<fo:change-bar-begin change-bar-class="${c}" change-bar-style="solid" change-bar-color="${color}"/>`;
    const count = (body: string) => {
      const im = importXslFo(fo(body), parse, { compat: 'spec' });
      const sh = E.engine.layout(im.document).sheets[0];
      let n = 0;
      const rec = (a: Area) => {
        const kids = childrenOf(a as never);
        const sides = Object.values((a.border ?? {}) as Record<string, { width: number } | undefined>).filter((v) => v && v.width > 0);
        if (a.type === 'block' && !kids.length && sides.length === 1 && Math.min(a.width, a.height) <= 5) n++;
        for (const c of kids) rec(c);
      };
      rec(sh as unknown as Area);
      return n;
    };
    expect(count(`${Array.from({ length: 50 }, (_, i) => begin(`c${i}`)).join('')}<fo:block>1</fo:block><fo:block>2</fo:block>`)).toBe(1);
    expect(count(`${begin('a')}${begin('b', 'red')}<fo:block>1</fo:block>`)).toBe(2);
  });
  it('入れ子の要素のしおりの題は、子孫の字 (生成内容を含む) のまま', () => {
    const { document } = imp('<div class="s">a <div class="s">b<span>c</span></div></div><div class="s">d</div>', 'span::before { content: "[" } .s { bookmark-level: 1 }');
    const titles: string[] = [];
    const rec = (bs: Array<{ title: string; children?: unknown[] }>) => {
      for (const b of bs) {
        titles.push(b.title);
        rec((b.children ?? []) as never);
      }
    };
    rec((document.bookmarks ?? []) as never);
    expect(titles).toEqual(['a b[c', 'b[c', 'd']);
  });
});

describe('大きな配列を引数に広げない', () => {
  it('pushAll・maxOf・minOf は、20 万要素でも使える', () => {
    const big = Array.from({ length: 200_000 }, (_, i) => i);
    const to: number[] = [1];
    pushAll(to, big);
    expect(to.length).toBe(200_001);
    expect(maxOf(big)).toBe(199_999);
    expect(minOf(big, 5)).toBe(0);
    expect(maxOf([])).toBe(-Infinity);
    expect(maxOf([], 0)).toBe(0);
  });
  it('1 つの inline に 20 万字を超える字のある段落を組める', () => {
    const { document } = imp(`<p><b>${'x '.repeat(130_000)}</b></p>`);
    expect(() => E.engine.layout(document)).not.toThrow();
  });
});
