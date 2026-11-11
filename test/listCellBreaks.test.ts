/**
 * リストの項目・表のセルの中の強制の区切り (HTM-25。CSS Fragmentation 3 §2.1・§3.1・§3.1.1・§4.3):
 *  - li の中のブロックの break-before・break-after: page、入れ子のリストの li の break-before: page
 *  - リストの途中の項目・表の途中の行の break-before: column (段組の中だけで効く)
 *  - 途中の項目・途中の行の left・right・recto・verso (白ページを挟む)
 *  - 表のセルの中のブロックの break-before: page (行を、その所で分ける)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { doc, makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area, LBlock, LTable } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** importHtml (A5・余白 10mm) */
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
const sheets = (body: string, css = '') => E.engine.layout(imp(body, css).document).sheets;
/** 組んだ結果の字 (ページごと) */
const pageTexts = (body: string, css = '') =>
  sheets(body, css).map((s) => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s.page);
    return out.join('');
  });
/** 字 ch の左端の x (ページごと。用紙の左上から。無ければ undefined) */
const glyphX = (body: string, css: string, ch: string) =>
  sheets(body, css).map((s) => {
    let x: number | undefined;
    const rec = (a: Area, ox: number) => {
      const ax = ox + ((a as { x?: number }).x ?? 0);
      if (a.type === 'glyph' && a.text === ch && x === undefined) x = ax;
      for (const c of childrenOf(a)) rec(c, ax);
    };
    rec(s.page, 0);
    return x;
  });

describe('HTM-25 li の中のブロックの強制の区切り (Fragmentation 3 §3.1・§4.3)', () => {
  it('li の中のブロックの break-before: page は、その前でページを改める', () => {
    expect(pageTexts('<p>x</p><ul><li>a<p style="break-before: page">b</p></li><li>c</li></ul>')).toEqual(['x•a', 'b•c']);
    expect(pageTexts('<ul><li>a<div><p>b</p><p style="page-break-before: always">c</p></div>d</li></ul>')).toEqual(['•ab', 'cd']);
  });

  it('li の中のブロックの break-after: page は、その後ろでページを改める', () => {
    expect(pageTexts('<ul><li><p style="break-after: page">a</p><p>b</p></li><li>c</li></ul>')).toEqual(['•a', 'b•c']);
  });

  it('li の最初の子の break-before・最後の子の break-after は、項目の前後の区切りになる (§3.1.1 の伝播)', () => {
    expect(pageTexts('<ul><li>a</li><li><p style="break-before: page">b</p></li><li>c</li></ul>')).toEqual(['•a', '•b•c']);
    expect(pageTexts('<ul><li>a<p style="break-after: page">b</p></li><li>c</li></ul>')).toEqual(['•ab', '•c']);
    // 最後の項目の最後の子: リストの後ろ
    expect(pageTexts('<ul><li>a<p style="break-after: page">b</p></li></ul><p>x</p>')).toEqual(['•ab', 'x']);
  });

  it('入れ子のリストの li の break-before: page', () => {
    expect(pageTexts('<ul><li>a<ul><li>b</li><li style="break-before: page">c</li></ul></li><li>d</li></ul>')).toEqual(['•a◦b', '◦c•d']);
  });

  it('項目の中の区切りの後ろの続きは、記号の列を空けたまま本文の列に置く', () => {
    const xs = glyphX('<ul><li>a<p style="break-before: page">b</p></li></ul>', '', 'b');
    const xa = glyphX('<ul><li>a<p style="break-before: page">b</p></li></ul>', '', 'a');
    expect(xs[1]).toBeCloseTo(xa[0]!, 3);
  });

  it('項目の中の left・right は、白ページを挟む', () => {
    // 1 ページ目 (右ページ) の項目の中の right: 2 ページ目を白にして 3 ページ目から
    expect(pageTexts('<ul><li>a<p style="break-before: right">b</p></li><li>c</li></ul>')).toEqual(['•a', '', 'b•c']);
    expect(pageTexts('<ul><li>a<p style="break-before: left">b</p></li><li>c</li></ul>')).toEqual(['•a', 'b•c']);
  });

  it('強制の区切りの無い項目は、これまでどおり', () => {
    expect(pageTexts('<ul><li>a<p>b</p></li><li>c</li></ul>')).toEqual(['•ab•c']);
  });
});

describe('HTM-25 途中の項目・途中の行の left・right・recto・verso (Fragmentation 3 §3.1)', () => {
  it('途中の項目の break-before: right・recto は、次の右ページ (奇数ページ) から。白ページを挟む', () => {
    expect(pageTexts('<ul><li>a</li><li style="break-before: right">b</li><li>c</li></ul>')).toEqual(['•a', '', '•b•c']);
    expect(pageTexts('<ul><li>a</li><li style="break-before: recto">b</li></ul>')).toEqual(['•a', '', '•b']);
    expect(pageTexts('<ol><li>a</li><li style="break-before: left">b</li><li style="break-before: left">c</li></ol>')).toEqual(['1.a', '2.b', '', '3.c']);
    expect(pageTexts('<ul><li>a</li><li style="break-before: verso">b</li></ul>')).toEqual(['•a', '•b']);
  });

  it('途中の項目の break-after: right', () => {
    expect(pageTexts('<ul><li style="break-after: right">a</li><li>b</li></ul>')).toEqual(['•a', '', '•b']);
  });

  it('前の項目の break-after と次の項目の break-before が重なるとき、左右は後ろの要素の値 (§4.3)', () => {
    expect(pageTexts('<ul><li style="break-after: right">a</li><li style="break-before: left">b</li></ul>')).toEqual(['•a', '•b']);
    expect(pageTexts('<ul><li style="break-after: right">a</li><li style="break-before: page">b</li></ul>')).toEqual(['•a', '', '•b']);
  });

  it('表の途中の行の break-before: right・break-after: right も、白ページを挟む', () => {
    expect(pageTexts('<table><tr><td>a</td></tr><tr style="break-before: right"><td>b</td></tr><tr><td>c</td></tr></table>')).toEqual(['a', '', 'bc']);
    expect(pageTexts('<table><tr style="break-after: right"><td>a</td></tr><tr><td>b</td></tr></table>')).toEqual(['a', '', 'b']);
    expect(pageTexts('<table><tr><td>a</td></tr><tr style="break-before: left"><td>b</td></tr></table>')).toEqual(['a', 'b']);
  });

  it('白ページには、表の枠・繰り返す見出しを置かない', () => {
    const ss = sheets('<table style="border: 1pt solid"><thead><tr><th>h</th></tr></thead><tr><td>a</td></tr><tr style="break-before: right"><td>b</td></tr></table>');
    expect(ss.length).toBe(3);
    const count = (a: Area): number => childrenOf(a).reduce((n, c) => n + 1 + count(c), 0);
    // 白ページの本文の領域には、何も無い
    const texts = pageTexts('<table style="border: 1pt solid"><thead><tr><th>h</th></tr></thead><tr><td>a</td></tr><tr style="break-before: right"><td>b</td></tr></table>');
    expect(texts).toEqual(['ha', '', 'hb']);
    expect(count(ss[1].page)).toBeLessThan(count(ss[0].page));
    const hasTable = (a: Area): boolean => (a.type === 'block' && (a as { kind?: string }).kind === 'table') || childrenOf(a).some(hasTable);
    expect(hasTable(ss[1].page)).toBe(false);
  });
});

describe('HTM-25 break-before: column (Fragmentation 3 §3.1 Column Break Values・§4.3)', () => {
  const col = (inner: string) => `<div style="columns: 2; column-gap: 10mm">${inner}</div>`;
  it('段組の中のリストの途中の項目の break-before: column は、次の段から', () => {
    const body = col('<ul><li>a</li><li style="break-before: column">b</li><li>c</li></ul>');
    expect(pageTexts(body)).toEqual(['•a•b•c']);
    const xa = glyphX(body, '', 'a')[0]!;
    const xb = glyphX(body, '', 'b')[0]!;
    const xc = glyphX(body, '', 'c')[0]!;
    // b は 2 段目 (a より右)、c は b と同じ段
    expect(xb - xa).toBeGreaterThan(100);
    expect(xc).toBeCloseTo(xb, 3);
  });

  it('ページを段に組む文書の、途中の項目・途中の行の break-before: page は、段ではなくページを改める', () => {
    const css = 'body { columns: 2 }';
    expect(pageTexts('<ul><li>a</li><li style="break-before: page">b</li></ul>', css)).toEqual(['•a', '•b']);
    expect(pageTexts('<table><tr><td>a</td></tr><tr style="break-before: page"><td>b</td></tr></table>', css)).toEqual(['a', 'b']);
    // column は次の段 (同じページ)
    expect(pageTexts('<table><tr><td>a</td></tr><tr style="break-before: column"><td>b</td></tr></table>', css)).toEqual(['ab']);
    const xs = (ch: string) => glyphX('<table><tr><td>a</td></tr><tr style="break-before: column"><td>b</td></tr></table>', css, ch)[0]!;
    expect(xs('b') - xs('a')).toBeGreaterThan(100);
  });

  it('段組の外では、break-before: column は効かない (リストの項目・表の行・ブロック)', () => {
    expect(pageTexts('<ul><li>a</li><li style="break-before: column">b</li></ul>')).toEqual(['•a•b']);
    expect(pageTexts('<ul><li>a<p style="break-before: column">b</p></li></ul>')).toEqual(['•ab']);
    expect(pageTexts('<table><tr><td>a</td></tr><tr style="break-before: column"><td>b</td></tr></table>')).toEqual(['ab']);
    expect(pageTexts('<p>a</p><p style="break-before: column">b</p><p style="break-after: column">c</p><p>d</p>')).toEqual(['abcd']);
  });
});

describe('HTM-25 表のセルの中のブロックの強制の区切り (Fragmentation 3 §2.1: セルの中身は並んだ流れ)', () => {
  it('セルの中の break-before: page は、行をその所で分ける。ほかのセルの中身は動かさない', () => {
    expect(pageTexts('<table><tr><td>a<p style="break-before: page">b</p></td><td>x</td></tr><tr><td>c</td><td>y</td></tr></table>')).toEqual(['ax', 'bcy']);
  });

  it('セルの中の入れ子の表の行の break-before: page', () => {
    expect(pageTexts('<table><tr><td>a<table><tr><td>b</td></tr><tr style="break-before: page"><td>c</td></tr></table></td><td>x</td></tr></table>')).toEqual(['abx', 'c']);
  });

  it('強制の区切りの無い表は、これまでどおり', () => {
    expect(pageTexts('<table><tr><td>a<p>b</p></td><td>x</td></tr><tr><td>c</td><td>y</td></tr></table>').length).toBe(1);
  });
});

describe('HTM-25 XSL-FO の表のセルの中のブロックの break-before (XSL 1.1 §4.8: 区切りの条件は必ず満たす)', () => {
  const text = (t: string, extra: Partial<LBlock> = {}): LBlock => ({ type: 'block', children: [t], ...extra });
  const table = (rows: LBlock[][][]): LTable => ({
    type: 'table',
    columns: [{ type: 'table-column', width: '1*' }, { type: 'table-column', width: '1*' }],
    body: { type: 'table-body', rows: rows.map((cells) => ({ type: 'table-row', cells: cells.map((children) => ({ type: 'table-cell', children })) })) },
  });
  const texts = (d: ReturnType<typeof doc>) =>
    E.engine.layout(d).sheets.map((s) => {
      const out: string[] = [];
      const rec = (a: Area) => {
        if (a.type === 'glyph') out.push(a.text);
        for (const c of childrenOf(a)) rec(c);
      };
      rec(s.page.regionBody);
      return out.join('');
    });

  it('セルの中のブロックの breakBefore: page は、行をその所で分ける', () => {
    expect(texts(doc([table([[[text('a'), text('b', { breakBefore: 'page' })], [text('x')]], [[text('c')], [text('y')]]])]))).toEqual(['ax', 'bcy']);
  });

  it('行の breakBefore: true (fo:table-row の break-before) は、これまでどおり次のページへ送る', () => {
    const t = table([[[text('a')], [text('x')]], [[text('c')], [text('y')]]]);
    t.body.rows[1].breakBefore = true;
    expect(texts(doc([t]))).toEqual(['ax', 'cy']);
  });
});
