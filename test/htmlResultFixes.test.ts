/**
 * HTML の取り込みの「結果の誤り」の回帰テスト (全体レビューの HTM-01・02・03・08・09・14・15・17・19):
 *  - HTM-01 リストの並びが、コメント・display: none の li・ほかの子で切れても、番号を振り直さない
 *  - HTM-02 表の行・行グループのカウンター、セルで reset したカウンターの有効範囲、tr の id
 *  - HTM-03 リストの 2 つ目以降の li と表のセル・行・caption の、しおり・string-set・回り込み・絶対配置
 *  - HTM-08 1 字だけの和文の行が続いても、行の間に空白を入れない
 *  - HTM-09 lower-roman・lower-alpha などの範囲の外の数は decimal で表す
 *  - HTM-14 % で符号化した #fragment のリンク・target-counter()
 *  - HTM-15 文書の中の svg の接頭辞つきの属性
 *  - HTM-17 counter-reset の page を名前の全体で見る
 *  - HTM-19 rel="alternate stylesheet" (title つき) の CSS は当てない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** importHtml (A5・余白 10mm)。linked: linkedom で読む (コメントの節を残す)。既定は xmldom */
const imp = (body: string, css = '', linked = false) => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = linked ? (parseHTML(`<!doctype html>${src}`).document as unknown as Document) : (new DOMParser().parseFromString(src, 'text/html') as unknown as Document);
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ結果の字 (ページごと) */
const pageTexts = (body: string, css = '', linked = false) =>
  E.engine.layout(imp(body, css, linked).document).sheets.map((s) => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s.page);
    return out.join('');
  });
const texts = (body: string, css = '', linked = false) => pageTexts(body, css, linked).join('');
/** 論理ツリーの中の、条件に合う節 */
const find = (root: unknown, pred: (n: Record<string, unknown>) => boolean) => {
  const out: Array<Record<string, unknown>> = [];
  JSON.stringify(root, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && pred(v as Record<string, unknown>)) out.push(v as Record<string, unknown>);
    return v;
  });
  return out;
};

describe('HTM-01 リストの並びと番号', () => {
  for (const linked of [false, true]) {
    it(`コメント・display: none の li で並びが切れても、番号は続く (${linked ? 'linkedom' : 'xmldom'})`, () => {
      expect(texts('<ol><li>a</li><!-- c --><li>b</li><li>c</li></ol>', '', linked)).toBe('1.a2.b3.c');
      // display: none の要素は箱を作らず、カウンターも進めない (Lists 3 §4.5)
      expect(texts('<ol><li>a</li><li style="display:none">x</li><li>b</li></ol>', '', linked)).toBe('1.a2.b');
      expect(texts('<ol><li>a</li><li>b</li><li>c</li></ol>', '', linked)).toBe('1.a2.b3.c');
    });
  }

  it('項目の間にほかの子 (入れ子のリスト・段落) があっても、list-item の reset は容器ごとに 1 度', () => {
    expect(texts('<ol><li>a</li><p>x</p><li>b</li></ol>')).toBe('1.ax2.b');
    expect(texts('<ol><li>a</li><ol><li>p</li><li>q</li></ol><li>b</li></ol>')).toBe('1.a1.p2.q2.b');
    // start・reversed (項目の数は、容器の list-item の子の全部)
    expect(texts('<ol start="5"><li>a</li><p>x</p><li>b</li></ol>')).toBe('5.ax6.b');
    expect(texts('<ol reversed><li>a</li><!-- c --><li>b</li><p>x</p><li>c</li></ol>', '', true)).toBe('3.a2.bx1.c');
  });

  it('匿名の表の部分の並びも、コメントで切れない (1 つの表になる)', () => {
    const r = imp('<div><span style="display:table-cell">a</span><!-- c --><span style="display:table-cell">b</span></div>', '', true);
    const tables = find(r.document, (n) => n.type === 'table');
    expect(tables.length).toBe(1);
    expect(find(tables[0], (n) => n.type === 'table-cell').length).toBe(2);
  });
});

describe('HTM-02 表の行・行グループのカウンターと tr の id', () => {
  it('tr・tbody・td の counter-increment が効く', () => {
    expect(texts('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>', 'table{counter-reset:row} tr{counter-increment:row} td::before{content:counter(row) ":"}')).toBe('1:a2:b');
    expect(texts('<table><tbody><tr><td>a</td></tr></tbody><tbody><tr><td>b</td></tr></tbody></table>', 'table{counter-reset:g} tbody{counter-increment:g} td::before{content:counter(g) ":"}')).toBe('1:a2:b');
    expect(texts('<table><tr><td>a</td><td>b</td></tr></table>', 'table{counter-reset:c} td{counter-increment:c} td::before{content:counter(c) ":"}')).toBe('1:a2:b');
    // 行ごとに reset し、セルで進める (行と列の番号)
    expect(texts('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>', 'table{counter-reset:r} tr{counter-increment:r;counter-reset:c} td{counter-increment:c} td::before{content:counter(r) "-" counter(c) ":"}')).toBe('1-1:a1-2:b2-1:c2-2:d');
  });

  it('セル・行で reset したカウンターは、表の外へ漏れない (有効範囲は親の中。Lists 3 §4.4)', () => {
    const css = 'td{counter-reset:x 7} tr{counter-reset:y 5} p::before{content:counter(x) "/" counter(y) ":"}';
    expect(texts('<table><tr><td>a</td></tr></table><p>z</p>', css)).toBe('a0/0:z');
  });

  it('匿名の表の最初のセルのカウンターを 2 度進めない', () => {
    expect(texts('<div class="t"><span>a</span><span>b</span></div>', '.t{counter-reset:c} .t span{display:table-cell;counter-increment:c} .t span::before{content:counter(c) ":"}')).toBe('1:a2:b');
  });

  it('tr・tbody の id はリンクの飛び先になる (行に付く)', () => {
    const r = imp('<p><a href="#r2">x</a> <a href="#g">y</a></p><table><tbody id="g"><tr><td>a</td></tr><tr id="r2"><td>b</td></tr></tbody></table>');
    const rows = find(r.document, (n) => n.type === 'table-row');
    expect(rows.map((x) => x.id)).toEqual(['g', 'r2']);
    // 組んだ結果: 行の領域に、元の id が付く
    const ids: string[] = [];
    const rec = (a: Area) => {
      const id = (a as { sourceId?: string }).sourceId;
      if (id) ids.push(id);
      for (const c of childrenOf(a)) rec(c);
    };
    for (const s of E.engine.layout(r.document).sheets) rec(s.page);
    expect(ids).toEqual(expect.arrayContaining(['g', 'r2']));
  });
});

describe('HTM-03 リストの 2 つ目以降の項目・表の部分の前処理', () => {
  it('しおり: li・td・tr・caption のどれも拾う', () => {
    expect(imp('<ul><li>a</li><li>b</li><li>c</li></ul>', 'li{bookmark-level:1}').document.bookmarks!.map((b) => b.title)).toEqual(['a', 'b', 'c']);
    expect(imp('<ul style="list-style:none"><li>a</li><li>b</li></ul>', 'li{bookmark-level:1}').document.bookmarks!.map((b) => b.title)).toEqual(['a', 'b']);
    const r = imp('<table><caption>cap</caption><tr class="b"><td>r1</td></tr><tr><td class="b">c1</td><td class="b">c2</td></tr></table>', 'caption,.b{bookmark-level:1}');
    expect(r.document.bookmarks!.map((b) => b.title)).toEqual(['cap', 'r1', 'c1', 'c2']);
    // 飛び先の id が、行・セル・caption に付いている
    const ids = new Set(find(r.document, (n) => typeof n.id === 'string').map((n) => n.id));
    for (const b of r.document.bookmarks!) expect(ids.has(b.ref)).toBe(true);
  });

  it('string-set: 2 つ目以降の li・表のセルの値が、ページの柱に出る', () => {
    const css = '@page { @top-center { content: "[" string(s) "]" } } .s{string-set: s content()}';
    expect(pageTexts('<ul><li>a</li><li class="s">b</li><li>c</li></ul>', css)).toEqual(['•a•b•c[b]']);
    expect(pageTexts('<ul style="list-style:none"><li>a</li><li class="s">b</li></ul>', css)).toEqual(['ab[b]']);
    expect(pageTexts('<table><tr><td>a</td></tr><tr><td class="s">b</td></tr></table>', css)).toEqual(['ab[b]']);
    // 行・caption の string-set
    expect(find(imp('<table><caption class="s">cap</caption><tr class="s"><td>r</td></tr></table>', css).document, (n) => n.type === 'marker').map((m) => String(m.children)).sort()).toEqual(['cap', 'r']);
  });

  it('string-set・しおりは、項目のカウンターを当てた後の値を読む (最初の項目も)', () => {
    const r = imp('<ol><li>a</li><li>b</li></ol>', 'li{string-set: s counter(list-item)}');
    expect(find(r.document, (n) => n.type === 'marker').map((m) => m.children)).toEqual([['1'], ['2']]);
  });

  it('回り込み・絶対配置の li は、2 つ目以降でも流れの外に出る。番号は数える (float は list-item の箱にも効く。CSS 2.1 §9.7)', () => {
    const r = imp('<ol><li>a</li><li style="float:right">f</li><li>b</li><li style="position:absolute;top:0;left:0">p</li><li>c</li></ol>');
    expect(find(r.document, (n) => n.type === 'float').length).toBe(1);
    expect(find(r.document, (n) => n.type === 'block-container' && n.absolutePosition === true).length).toBe(1);
    // 流れの中の項目の番号: 1・3・5
    const cells = find(r.document, (n) => n.type === 'table-cell' && n.textAlign === 'end').map((c) => c.children);
    expect(cells).toEqual([['1.'], ['3.'], ['5.']]);
  });

  it('脚注 (float: footnote) の li は、2 つ目以降でも脚注になる', () => {
    const r = imp('<ul><li>a</li><li class="fn">note</li><li>b</li></ul>', '.fn{float:footnote}');
    expect(find(r.document, (n) => n.type === 'footnote').length).toBe(1);
  });
});
