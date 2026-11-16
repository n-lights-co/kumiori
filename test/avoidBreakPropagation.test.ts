/**
 * 最初の子の break-before・最後の子の break-after の avoid 系の値を、親の箱の前後の区切りに伝える (HTM-79。CSS Fragmentation 3 §3.1.1・§4.3・§4.4):
 *  - 入れ子の最初の子の break-before: avoid・avoid-page は、親とその前の箱の間で分けるのを止める
 *  - 最後の子の break-after: avoid は、親とその次の箱の間で分けるのを止める
 *  - 強制の区切りと重なったときは、強制の区切りが勝つ (§4.3)
 *  - avoid-column は、段組の容器の手前で止まる (§3.1.1: 最も近い合う種類の分割の文脈の手前まで)
 *  - リストを表にして組む所 (項目の最初の子の値を、項目の行・リストの表の前後の値と合わせる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area, LBlockLevel, LInlineLevel, LTable } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** importHtml (A5・余白 10mm。本文の高さは 190mm ≒ 538.6pt。段落の上下の余白は 0、行の高さは 20pt) */
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `@page { size: A5; margin: 10mm } body { margin: 0; line-height: 20pt; font-size: 10pt } p, ul { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ結果の字 (ページごと) */
const pageTexts = (body: string, css = '') =>
  E.engine.layout(imp(body, css).document).sheets.map((s) => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s.page);
    return out.join('');
  });
/** 流れの直下の箱 */
const top = (body: string, css = '') => imp(body, css).document.sequences[0].flow.children as Array<LBlockLevel | LInlineLevel>;
/** 本文の高さの残りが 1 行 (20pt) と少しになるまで埋める箱 (500pt。残りは 38.6pt)。字 f を持つ (中身の無いページの先頭では、keep で送らない) */
const FILL = '<div style="height: 500pt">f</div>';

describe('HTM-79 最初の子の break-before の avoid 系は、親の前の区切りに伝わる (§3.1.1・§4.4 の Rule 1)', () => {
  it('入れ子の最初の子の break-before: avoid は、親とその前の段落の間で分けない', () => {
    // x は 1 ページ目の最後の行に入るが、a は入らない。a の前を分けないので、x も次のページへ送る
    expect(pageTexts(`${FILL}<p>x</p><section><p style="break-before: avoid">a</p><p>b</p></section>`)).toEqual(['f', 'xab']);
    // 2 段の入れ子
    expect(pageTexts(`${FILL}<p>x</p><div><section><p style="break-before: avoid">a</p></section><p>b</p></div>`)).toEqual(['f', 'xab']);
  });

  it('break-before: avoid-page も、親の前に伝わる', () => {
    expect(pageTexts(`${FILL}<p>x</p><section><p style="break-before: avoid-page">a</p></section>`)).toEqual(['f', 'xa']);
  });

  it('伝わった値は、組む前の箱の keepWithPrevious になる', () => {
    const [, , sec] = top(`${FILL}<p>x</p><section><div><p style="break-before: avoid">a</p></div></section>`) as Array<{ keepWithPrevious?: boolean }>;
    expect(sec.keepWithPrevious).toBe(true);
  });

  it('最初の子の前に字があれば伝わらない (子の前に区切りがある)', () => {
    expect(pageTexts(`${FILL}<p>x</p><section>y<p style="break-before: avoid">a</p></section>`)).toEqual(['fx', 'ya']);
  });
});

describe('HTM-79 最後の子の break-after の avoid 系は、親の後ろの区切りに伝わる', () => {
  it('入れ子の最後の子の break-after: avoid は、親とその次の段落の間で分けない', () => {
    // a は 1 ページ目の最後の行に入るが、y は入らない。a の後ろを分けないので、a も次のページへ送る
    expect(pageTexts(`${FILL}<section><div><p style="break-after: avoid">a</p></div></section><p>y</p>`)).toEqual(['f', 'ay']);
  });

  it('break-after: avoid-page も伝わる', () => {
    expect(pageTexts(`${FILL}<section><p style="break-after: avoid-page">a</p></section><p>y</p>`)).toEqual(['f', 'ay']);
  });
});

describe('HTM-79 強制の区切りと重なったとき (§4.3: 強制の区切りが勝つ)', () => {
  it('最初の子の break-before: avoid と、親の break-before: page', () => {
    expect(pageTexts(`<p>x</p><section style="break-before: page"><p style="break-before: avoid">a</p></section>`)).toEqual(['x', 'a']);
    const [, sec] = top(`<p>x</p><section style="break-before: page"><p style="break-before: avoid">a</p></section>`) as Array<{ keepWithPrevious?: boolean }>;
    expect(sec.keepWithPrevious).toBeUndefined();
  });

  it('親の break-before: avoid と、最初の子の break-before: page: 前の段落を送らず、子の前で改める', () => {
    expect(pageTexts(`${FILL}<p>x</p><section style="break-before: avoid"><p style="break-before: page">a</p></section>`)).toEqual(['fx', 'a']);
    const [, , sec] = top(`${FILL}<p>x</p><section style="break-before: avoid"><p style="break-before: page">a</p></section>`) as Array<{ keepWithPrevious?: boolean }>;
    expect(sec.keepWithPrevious).toBeUndefined();
  });

  it('最後の子の break-after: avoid と、親の break-after: page', () => {
    expect(pageTexts(`<section style="break-after: page"><p style="break-after: avoid">a</p></section><p>y</p>`)).toEqual(['a', 'y']);
  });
});

describe('HTM-79 avoid-column は段組の容器の手前で止まる (§3.1.1)', () => {
  it('段組の容器の最初の子の break-before: avoid-column は、容器の前に伝わらない', () => {
    const [, mc] = top(`<p>x</p><div style="column-count: 2"><p style="break-before: avoid-column">a</p></div>`) as Array<{ keepWithPrevious?: boolean }>;
    expect(mc.keepWithPrevious).toBeUndefined();
  });

  it('段組の中の入れ子では、avoid-column も親に伝わる', () => {
    const [mc] = top(`<div style="column-count: 2"><p>x</p><section><p style="break-before: avoid-column">a</p></section></div>`) as Array<{ children: Array<{ keepWithPrevious?: boolean }> }>;
    const sec = mc.children.find((c) => typeof c !== 'string' && (c as { type?: string }).type === 'block' && c !== mc.children[0]);
    expect(sec?.keepWithPrevious).toBe(true);
  });

  it('段組の容器の最初の子の break-before: avoid は、容器の前にも伝わる (ページの区切りも避ける)', () => {
    const [, mc] = top(`<p>x</p><div style="column-count: 2"><p style="break-before: avoid">a</p></div>`) as Array<{ keepWithPrevious?: boolean }>;
    expect(mc.keepWithPrevious).toBe(true);
  });
});

describe('HTM-79 リストを表にして組む所', () => {
  /** リストの表 (流れの直下の k 番目の箱。リストの字下げ (padding) を持つ箱の中の表) */
  const listTable = (body: string, k: number, css = '') => {
    const b = top(body, css)[k] as LTable | { type: 'block'; children: LTable[] };
    return b.type === 'table' ? b : b.children[0];
  };
  /** リストの箱 (流れの直下の k 番目。前後の区切りの値を持つ箱) */
  const listBox = (body: string, k: number, css = '') => top(body, css)[k] as { keepWithPrevious?: boolean; keepWithNext?: boolean };

  it('項目の最初の子の break-before: avoid は、その項目の行の keepWithPrevious になる', () => {
    const t = listTable('<ul><li>a</li><li><div><p style="break-before: avoid">b</p></div></li></ul>', 0);
    expect(t.body.rows[1].keepWithPrevious).toBe(true);
  });

  it('項目の最後の子の break-after: avoid は、その項目の行の keepWithNext になる', () => {
    const t = listTable('<ul><li><div><p style="break-after: avoid">a</p></div></li><li>b</li></ul>', 0);
    expect(t.body.rows[0].keepWithNext).toBe(true);
  });

  it('最初の項目の最初の子の break-before: avoid-page は、リストの表の前に伝わる (行の値にはしない)', () => {
    const t = listTable('<p>x</p><ul><li><p style="break-before: avoid-page">a</p></li></ul>', 1);
    expect(listBox('<p>x</p><ul><li><p style="break-before: avoid-page">a</p></li></ul>', 1).keepWithPrevious).toBe(true);
    expect(t.body.rows[0].keepWithPrevious).toBeUndefined();
    expect(pageTexts(`${FILL}<p>x</p><ul><li><p style="break-before: avoid-page">a</p></li></ul>`)).toEqual(['f', 'x•a']);
  });

  it('最初の項目の break-before: avoid も、リストの表の前に伝わる', () => {
    const t = listTable('<p>x</p><ul><li style="break-before: avoid">a</li></ul>', 1);
    expect(listBox('<p>x</p><ul><li style="break-before: avoid">a</li></ul>', 1).keepWithPrevious).toBe(true);
    expect(t.body.rows[0].keepWithPrevious).toBeUndefined();
  });

  it('最後の項目の最後の子の break-after: avoid は、リストの表の後ろに伝わる', () => {
    expect(listBox('<ul><li><p style="break-after: avoid">a</p></li></ul><p>y</p>', 0).keepWithNext).toBe(true);
    expect(pageTexts(`${FILL}<ul><li><p style="break-after: avoid">a</p></li></ul><p>y</p>`)).toEqual(['f', '•ay']);
  });

  it('目次の形: 項目の字の後ろの入れ子のリストの最初の項目の break-before: avoid-page は、字と入れ子のリストの間で分けない', () => {
    // 『CSSページ組版入門』の目次の .TOC li.TocLevel2:first-child { break-before: avoid-page } (ul の break-before が auto のとき)
    expect(pageTexts(`${FILL}<ul><li>x<ul><li style="break-before: avoid-page">a</li><li>b</li></ul></li></ul>`)).toEqual(['f', '•x◦a◦b']);
  });

  it('項目の強制の区切りと、最初の子の avoid: 強制の区切りが勝つ', () => {
    const t = listTable('<ul><li>a</li><li style="break-before: page"><p style="break-before: avoid">b</p></li></ul>', 0);
    expect(t.body.rows[1].breakBefore).toBe('page');
    expect(t.body.rows[1].keepWithPrevious).toBeUndefined();
  });

  it('段組のリストの最初の項目の break-before: avoid-column は、リストの前に伝わらない', () => {
    expect(listBox('<p>x</p><ul style="column-count: 2"><li style="break-before: avoid-column">a</li></ul>', 1).keepWithPrevious).toBeUndefined();
    expect(listTable('<p>x</p><ul style="column-count: 2"><li style="break-before: avoid-column">a</li></ul>', 1).keepWithPrevious).toBeUndefined();
  });
});

describe('HTM-79 記号の無いリスト (ふつうのブロックの並びにする所)', () => {
  it('list-style: none の入れ子のリストの最初の項目の break-before: avoid-page は、字と入れ子のリストの間で分けない', () => {
    const css = 'ul { list-style: none; padding: 0 }';
    expect(pageTexts(`${FILL}<ul><li>x<ul><li style="break-before: avoid-page">a</li><li>b</li></ul></li></ul>`, css)).toEqual(['f', 'xab']);
    expect(pageTexts(`${FILL}<p>x</p><ul><li><p style="break-before: avoid">a</p></li></ul>`, css)).toEqual(['f', 'xa']);
  });

  it('最後の項目の最後の子の break-after: avoid は、リストの後ろに伝わる', () => {
    expect(pageTexts(`${FILL}<ul><li><p style="break-after: avoid">a</p></li></ul><p>y</p>`, 'ul { list-style: none; padding: 0 }')).toEqual(['f', 'ay']);
  });
});
