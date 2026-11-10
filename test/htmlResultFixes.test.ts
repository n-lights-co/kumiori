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
import { counterText } from '../src/htmlPaged';
import { prepareHtml } from '../src/htmlPrepare';
import { serializeInlineSvg } from '../src/htmlSvg';
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

describe('HTM-08 和文の間の改行', () => {
  it('1 字だけの和文の行が続いても、行の間に空白を入れない (CSS Text 3 §4.1.3)', () => {
    const flow = (body: string) => imp(body).document.sequences[0].flow.children.map((b) => (b as { children: unknown[] }).children.join(''));
    expect(flow('<p>あ\nい\nう</p>')).toEqual(['あいう']);
    expect(flow('<p>あ\n\nい\nう\nえお\nか</p>')).toEqual(['あいうえおか']);
    // 和文と欧文の間・欧文どうしは空白
    expect(flow('<p>あ\na\nb\nい</p>')).toEqual(['あ a b い']);
    expect(flow('<p>a\nb\nc</p>')).toEqual(['a b c']);
    // pre-line は改行のまま
    expect(flow('<p style="white-space:pre-line">あ\nい\nう</p>')).toEqual(['あ\nい\nう']);
  });
});

describe('HTM-09 番号の書式の範囲の外の数', () => {
  it('範囲の外の数は decimal で表す (Counter Styles 3 §2・§3.5・§3.7・§6)', () => {
    // lower-roman・upper-roman は 1〜3999
    expect([0, 1, 3999, 4000, -2].map((n) => counterText('lower-roman', n))).toEqual(['0', 'i', 'mmmcmxcix', '4000', '-2']);
    expect([0, 4, 4000].map((n) => counterText('upper-roman', n))).toEqual(['0', 'IV', '4000']);
    // alphabetic は 1 以上
    expect([-3, 0, 1, 27].map((n) => counterText('lower-alpha', n))).toEqual(['-3', '0', 'a', 'aa']);
    expect([0, 26].map((n) => counterText('upper-latin', n))).toEqual(['0', 'Z']);
    // cjk-decimal は 0 以上。numeric (範囲の限りが無い) の負の数は、負の符号を前に付ける
    expect([-5, 0, 12].map((n) => counterText('cjk-decimal', n))).toEqual(['-5', '〇', '一二']);
    expect([-5, 12].map((n) => counterText('full-width-decimal', n))).toEqual(['-５', '１２']);
    expect([-5, 5, 12].map((n) => counterText('decimal-leading-zero', n))).toEqual(['-5', '05', '12']);
    // 範囲の外の大きな数でも、表記は長くならない
    expect(counterText('lower-roman', 3e9)).toBe('3000000000');
  });

  it('ol の start・type で範囲の外になる項目', () => {
    expect(texts('<ol start="0" type="i"><li>a</li><li>b</li></ol>')).toBe('0.ai.b');
    expect(texts('<ol start="-1" type="a"><li>a</li><li>b</li><li>c</li></ol>')).toBe('-1.a0.ba.c');
    expect(texts('<ol start="3999" type="i"><li>a</li><li>b</li></ol>')).toBe('mmmcmxcix.a4000.b');
  });
});

describe('HTM-14 % で符号化した fragment', () => {
  const links = (body: string, css = '') => find(imp(body, css).document, (n) => !!n.link).map((n) => n.link);
  it('href の fragment は、そのままの id が無ければ、% の符号化を解いた id を指す (HTML の fragment の探し方)', () => {
    expect(links('<p><a href="#%E7%AB%A0">x</a></p><h1 id="章">章</h1>')).toEqual([{ internal: '章' }]);
    // そのままの id があれば、そちら
    expect(links('<p><a href="#%E7%AB%A0">x</a></p><h1 id="%E7%AB%A0">a</h1><h1 id="章">章</h1>')).toEqual([{ internal: '%E7%AB%A0' }]);
    // どちらも無い・% の後ろが 16 進でない・UTF-8 として読めない: そのまま
    expect(links('<p><a href="#%E7%AB%A0">x</a> <a href="#100%">y</a> <a href="#%FF">z</a></p>')).toEqual([{ internal: '%E7%AB%A0' }, { internal: '100%' }, { internal: '%FF' }]);
    expect(links('<p><a href="#a%20b">x</a></p><h1 id="a b">t</h1>')).toEqual([{ internal: 'a b' }]);
  });

  it('target-counter(attr(href), …) も同じ id を引く', () => {
    const css = 'h1 { counter-increment: ch 3 } a::after { content: " ch." target-counter(attr(href), ch) }';
    expect(texts('<p><a href="#%E7%AB%A0">x</a></p><h1 id="章">章</h1>', css)).toBe('x ch.3章');
  });
});

describe('HTM-15 文書の中の svg の接頭辞つきの名前', () => {
  const svgOf = (html: string) => {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
    return document.querySelector('svg') as unknown as Element;
  };
  const wellFormed = (xml: string) => {
    const errors: string[] = [];
    new DOMParser({ onError: (level: string, m: string) => void (level !== 'warning' && errors.push(m)) }).parseFromString(xml, 'image/svg+xml');
    return errors;
  };
  it('宣言のある接頭辞は宣言ごと書き出し、宣言の無い接頭辞の属性・要素は落とす (整形式の XML になる)', () => {
    const a = serializeInlineSvg(svgOf('<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><g inkscape:label="L" foo:bar="1"><rect width="5" height="5" xlink:href="#a" xml:space="preserve"/></g><sodipodi:namedview id="n"><rect/></sodipodi:namedview></svg>'));
    expect(a).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><g inkscape:label="L"><rect width="5" height="5" xlink:href="#a" xml:space="preserve"/></g></svg>',
    );
    expect(wellFormed(a)).toEqual([]);
    // 宣言が子の要素にあるときは、その要素の中だけで使える
    const b = serializeInlineSvg(svgOf('<svg><g xmlns:a="urn:a" a:x="1"><rect a:y="2"/></g><rect a:z="3" width="1"/></svg>'));
    expect(b).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g xmlns:a="urn:a" a:x="1"><rect a:y="2"/></g><rect width="1"/></svg>');
    expect(wellFormed(b)).toEqual([]);
  });
});

describe('HTM-17 counter-reset の page', () => {
  it('pagenote・page-x は page ではない (ページ番号を戻さない)', () => {
    const init = (css: string) => imp('<p>a</p><div class="b">b</div>', `@page x { size: A5 } .b { page: x; ${css} }`).document.sequences.map((q) => q.initialPageNumber);
    expect(init('counter-reset: pagenote 7')).toEqual([undefined, undefined]);
    expect(init('counter-reset: page-x 7')).toEqual([undefined, undefined]);
    expect(init('counter-reset: note 2 page 7')).toEqual([undefined, 7]);
    expect(init('counter-reset: page')).toEqual([undefined, 1]);
  });
});

describe('HTM-19 代わりのスタイルシート', () => {
  const prep = async (head: string) => {
    const files = ['a.css', 'b.css', 'c.css'].map((name, k) => ({ name, css: true, text: async () => `.x${k} { color: red }` }));
    const p = await prepareHtml(`<!doctype html><html><head>${head}</head><body><p>a</p></body></html>`, files as never, 'browser', { width: 210, height: 297, margin: 20 }, (t) => parseHTML(t).document as unknown as Document);
    return ['.x0', '.x1', '.x2'].filter((s) => p.css.includes(s));
  };
  it('rel="alternate stylesheet" で題のあるものは当てない (参照されていない CSS としても足さない)', async () => {
    expect(await prep('<link rel="stylesheet" href="a.css"><link rel="alternate stylesheet" title="大きな字" href="b.css"><link rel="stylesheet alternate" title="t" href="c.css">')).toEqual(['.x0']);
    // 題が、選ばれた組の名前 (alternate でない題つきのスタイルシートの題) と同じなら当てる。題が無ければ当てる (CSSOM 1 §6.2)
    expect(await prep('<link rel="stylesheet" title="t" href="a.css"><link rel="alternate stylesheet" title="t" href="b.css"><link rel="alternate stylesheet" href="c.css">')).toEqual(['.x0', '.x1', '.x2']);
  });
});
