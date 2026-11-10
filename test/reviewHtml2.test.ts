/**
 * HTML+CSS 読み込みのコードレビュー (2026-11-07) の低い重大度の欠陥の回帰テスト:
 *  - L-1 font-size の lh・rlh の基準 (親と根元の行の高さ)
 *  - L-3 @page の論理的な余白 (margin-block・margin-inline とその -start / -end。ページの書字方向で写す)
 *  - L-4 sideways-lr の inline-start は下
 *  - L-5 calc() の中の指数表記 (1e2px)
 *  - L-6 末尾の結合子のセレクタ (div >) は不正
 *  - L-7 規則の間の迷子の ; で次の規則を落とさない
 *  - L-8 有効範囲に無いカウンターの counter-increment はその要素に作る (文書全体に残らない)
 *  - L-9 縦書きのリストの記号の列の幅は inline-start 側 (上) の字下げ
 *  - L-10 2 値の display (block flow・inline flow-root・block math など) の計算値と、下流 (ブロックか行内か)
 *  - L-11 XHTML → HTML の書き直しで、xml:lang だけの要素に lang も書く (:lang() が合う)
 *  - L-12 EPUB の section の class・html の lang の逃がし
 *  - P-1 構造の疑似クラスの兄弟の一覧の覚え方 (childNodes.length を見ない。書き換えの検出は残す)
 *  - P-3 collectPaged の規則ごとの全要素走査 (要素の索引 selectorIndex で、右端のクラス・タグの候補だけ照合する)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS, lengthPx } from '../src/cssCascade';
import { parseCss, resolvePageRules } from '../src/htmlPaged';
import { importHtml, parsePageRule } from '../src/htmlImport';
import { matches, parseSelectorList, querySelectorAll, selectorIndex, setDocumentMode } from '../src/cssSelector';
import { xhtmlToHtml } from '../src/xhtml';
import { readEpub } from '../src/epub';
import { makeZip } from './makeZip';
import type { Area, LTable } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const byId = (doc: Document, id: string) => querySelectorAll(doc, `#${id}`)[0];
/** 自前のカスケードの計算値 */
const style = (html: string, css: string, id: string) => {
  const doc = parse(html);
  const s = cascadeStyles(doc, css, { uaCss: HTML_UA_CSS });
  return (p: string) => s.style(byId(doc, id)).getPropertyValue(p);
};
const RED = 'rgb(255, 0, 0)';
const DEF = { width: 210, height: 297, margin: 20 };
/** 余白 (mm) を小数 6 桁で丸める (cm → pt → mm の往復の誤差を消す) */
const rounded = (m: { top: number; right: number; bottom: number; left: number }) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));

/** importHtml (A5・余白 10mm)。本文 (body の中身) と CSS から */
const imp = (body: string, css = '', html = '<html>') => {
  const d = new DOMParser().parseFromString(`${html}<head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ結果の字をつなげた文字列 */
const texts = (body: string, css = '') => {
  const out: string[] = [];
  const rec = (a: Area) => {
    if (a.type === 'glyph') out.push(a.text);
    for (const c of childrenOf(a)) rec(c);
  };
  for (const s of E.engine.layout(imp(body, css).document).sheets) rec(s.page);
  return out.join('');
};
/** 変換した木の中の、type が合う最初の節 */
const findNode = (root: unknown, type: string): Record<string, unknown> | undefined => {
  let found: Record<string, unknown> | undefined;
  JSON.stringify(root, (_k, v) => {
    if (!found && v && typeof v === 'object' && (v as { type?: string }).type === type) found = v as Record<string, unknown>;
    return v;
  });
  return found;
};

describe('L-1: font-size の lh・rlh の単位', () => {
  it('font-size の中の 1lh は親の行の高さ、1rlh は根元の行の高さ (Values 4 §6.1.1)', () => {
    const get = style('<div id="p" style="line-height: 40px; font-size: 10px"><span id="c" style="font-size: 1lh">x</span><span id="r" style="font-size: 2rlh">y</span></div>', 'html { font-size: 10px; line-height: 15px }', 'c');
    expect(get('font-size')).toBe('40px');
    const getR = style('<div id="p" style="line-height: 40px; font-size: 10px"><span id="r" style="font-size: 2rlh">y</span></div>', 'html { font-size: 10px; line-height: 15px }', 'r');
    expect(getR('font-size')).toBe('30px');
  });
  it('親の line-height が normal なら、親の字の大きさの 1.2 倍', () => {
    const get = style('<div style="font-size: 10px"><span id="c" style="font-size: 1lh">x</span></div>', '', 'c');
    expect(get('font-size')).toBe('12px');
  });
});

describe('L-3: @page の論理的な余白', () => {
  it('margin-block・margin-inline (1 値・2 値) と -start / -end を、横書きでは上下・左右に写す', () => {
    expect(rounded(parsePageRule('@page { margin: 1cm; margin-block: 3cm }', DEF).margins)).toEqual({ top: 30, right: 10, bottom: 30, left: 10 });
    expect(rounded(parsePageRule('@page { margin: 1cm; margin-inline: 3cm 2cm; margin-block-end: 4cm }', DEF).margins)).toEqual({ top: 10, right: 20, bottom: 40, left: 30 });
    // 後の規則の物理の辺が、前の規則の論理の辺を上書きする (逆も)
    expect(parsePageRule('@page { margin-block-start: 3cm } @page { margin-top: 1cm }', DEF).margins.top).toBeCloseTo(10, 6);
    expect(rounded(parsePageRule('@page { margin-top: 1cm } @page { margin-inline-start: 3cm }', DEF).margins)).toEqual({ top: 10, right: 20, bottom: 20, left: 30 });
  });
  it('ページの書字方向で写す: vertical-rl の block-start は右、inline-start は上。rtl の inline-start は右', () => {
    const pages = parseCss('@page { margin-block-start: 3cm; margin-inline: 1cm 2cm }').pages;
    expect(resolvePageRules(pages, {}, 'vertical-rl').decls).toEqual({ 'margin-right': '3cm', 'margin-top': '1cm', 'margin-bottom': '2cm' });
    expect(resolvePageRules(pages, {}, 'vertical-lr').decls).toEqual({ 'margin-left': '3cm', 'margin-top': '1cm', 'margin-bottom': '2cm' });
    expect(resolvePageRules(pages, {}, 'horizontal-tb', 'rtl').decls).toEqual({ 'margin-top': '3cm', 'margin-right': '1cm', 'margin-left': '2cm' });
  });
  it('importHtml は根元の要素の writing-mode でページの余白を写す (縦書きの本の margin-block-start は右の余白)', () => {
    const r = imp('<p>x</p>', 'html { writing-mode: vertical-rl } @page { margin-block-start: 30mm }');
    expect(rounded(r.document.sequences[0].master.margins)).toEqual({ top: 10, right: 30, bottom: 10, left: 10 });
  });
});

describe('L-4: sideways-lr の inline-start', () => {
  it('sideways-lr では行が下から上へ進むので、margin-inline-start は margin-bottom (Writing Modes 4 §3.2)', () => {
    const get = style('<div id="d" style="writing-mode: sideways-lr; margin-inline-start: 7px; padding-inline-end: 3px">x</div>', '', 'd');
    expect(get('margin-bottom')).toBe('7px');
    expect(get('margin-top')).toBe('0px');
    expect(get('padding-top')).toBe('3px');
    // sideways-rl・vertical-rl は上のまま
    const get2 = style('<div id="d" style="writing-mode: sideways-rl; margin-inline-start: 7px">x</div>', '', 'd');
    expect(get2('margin-top')).toBe('7px');
  });
});

describe('L-5: calc() の指数表記', () => {
  const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 1000, pct: 400 };
  it('calc(1e2px) は 100px。1em の e は単位。単位の無い指数の数も項になる', () => {
    expect(lengthPx('calc(1e2px)', ctx)).toBe(100);
    expect(lengthPx('calc(1e2px + 1em)', ctx)).toBe(116);
    expect(lengthPx('calc(2e-1 * 100px)', ctx)).toBeCloseTo(20, 9);
    expect(lengthPx('calc(1E1px * 2)', ctx)).toBe(20);
    expect(lengthPx('calc(1em + 2px)', ctx)).toBe(18);
  });
  it('計算値でも 100px になる', () => {
    expect(style('<div id="d" style="width: calc(1e2px)">x</div>', '', 'd')('width')).toBe('100px');
  });
});

describe('L-6: 末尾の結合子', () => {
  it('div > や div + は不正なセレクタで、規則ごと捨てる (後ろの空白だけなら有効)', () => {
    expect(parseSelectorList('div >')).toEqual([]);
    expect(parseSelectorList('div + ')).toEqual([]);
    expect(parseSelectorList('div  ').length).toBe(1);
    expect(parseSelectorList('div > p').length).toBe(1);
    // 並びの 1 つが不正なら、並び全体が不正 (Selectors 4 §16)
    expect(parseSelectorList('p, div >')).toEqual([]);
    const get = style('<div><p id="p">x</p></div>', 'p { color: blue } div > { color: red } div ~ { color: red }', 'p');
    expect(get('color')).toBe('rgb(0, 0, 255)');
  });
});

describe('L-7: 規則の間の迷子の ;', () => {
  it('b{} ; p{color:red} の p の規則を読む (ブラウザと同じ)', () => {
    expect(style('<p id="p">x</p>', 'b{} ; p{color:red}', 'p')('color')).toBe(RED);
    expect(style('<p id="p">x</p>', '; p { color: red }', 'p')('color')).toBe(RED);
    expect(style('<p id="p">x</p>', '@layer a; ;; p { color: red }', 'p')('color')).toBe(RED);
    const rules = parseCss('a { color: green } ; ; b { color: red } ; c { color: blue }').rules;
    expect(rules.map((r) => r.selector)).toEqual(['a', 'b', 'c']);
  });
});

describe('L-8: 有効範囲に無いカウンターの counter-increment', () => {
  it('reset の無いカウンターの increment は、その要素 (と後続の兄弟) に 0 から作り、別の部分木には残らない (Lists 3 §4.2)', () => {
    const css = '.a { counter-increment: c } p::before { content: counter(c) "|" }';
    // 1 つ目の div の中: 1、2。2 つ目の div は別の有効範囲なので 0 から (increment で 1)。兄弟の p は前の兄弟の値を継ぐ
    expect(texts('<div><p class="a">x</p><p class="a">y</p></div><div><p>z</p><p class="a">w</p><p>v</p></div>', css)).toBe('1|x2|y0|z1|w1|v');
  });
  it('body で reset したカウンターは文書全体で数える (有効範囲の中では今までどおり)', () => {
    const css = 'body { counter-reset: c } .a { counter-increment: c } p::before { content: counter(c) "|" }';
    expect(texts('<div><p class="a">x</p></div><div><p class="a">y</p></div>', css)).toBe('1|x2|y');
  });
});

describe('L-9: 縦書きのリストの記号の列', () => {
  it('横書き: 記号の列の幅は padding-left (UA の 40px)、表は左へ引き戻す', () => {
    const t = findNode(imp('<ul><li>a</li></ul>').document.sequences[0].flow, 'table') as unknown as LTable;
    expect((t.columns![0] as { width: number }).width).toBe(30);
    expect(t.margin).toEqual({ left: -30 });
  });
  it('縦書き (vertical-rl): 記号の列の幅は padding-top (inline-start)、表は上へ引き戻す。block 方向の余白 (左右) は使わない', () => {
    const t = findNode(imp('<ul><li>a</li></ul>', 'body { writing-mode: vertical-rl } ul { margin: 0 12pt; padding-left: 5pt }').document.sequences[0].flow, 'table') as unknown as LTable;
    expect((t.columns![0] as { width: number }).width).toBe(30);
    expect(t.margin).toEqual({ top: -30 });
  });
});

describe('L-10: 2 値の display', () => {
  it('計算値は短い書き方 (Display 3 §2.2): block flow → block、inline flow-root → inline-block、block math はそのまま', () => {
    const get = (v: string) => style(`<div id="d" style="display: ${v}">x</div>`, '', 'd')('display');
    expect(get('block flow')).toBe('block');
    expect(get('flow block')).toBe('block');
    expect(get('inline flow')).toBe('inline');
    expect(get('inline flow-root')).toBe('inline-block');
    expect(get('block flow-root')).toBe('flow-root');
    expect(get('inline flex')).toBe('inline-flex');
    expect(get('block table')).toBe('table');
    expect(get('inline math')).toBe('math');
    expect(get('block math')).toBe('block math');
    expect(get('block ruby')).toBe('block ruby');
    expect(get('block flow list-item')).toBe('list-item');
    expect(get('inline flow list-item')).toBe('inline list-item');
    expect(get('inline-block')).toBe('inline-block');
  });
  it('下流: display: block flow の span はブロック、inline flow-root の span は inline-block、block math の要素はブロック', () => {
    const flowOf = (body: string) => JSON.stringify(imp(body).document.sequences[0].flow);
    // 2 値の display は、同じ意味の 1 値と同じ木になる
    const same = (two: string, one: string, body: (d: string) => string) => expect(flowOf(body(two))).toBe(flowOf(body(one)));
    same('block flow', 'block', (d) => `<p>a<span style="display: ${d}">b</span>c</p>`);
    same('inline flow-root', 'inline-block', (d) => `<p>a<span style="display: ${d}; width: 20pt">b</span>c</p>`);
    expect(findNode(imp('<p>a<span style="display: inline flow-root; width: 20pt">b</span>c</p>').document.sequences[0].flow, 'inline-container')).toBeDefined();
    // block math (短い書き方が無い) の要素もブロック (行内の箱にならない)
    same('block math', 'block', (d) => `<p>a</p><div style="display: ${d}">b</div><p>c</p>`);
    expect(texts('<p>a</p><div style="display: block math">b</div><p>c</p>')).toBe('abc');
  });
});

describe('L-11: XHTML の xml:lang', () => {
  it('xml:lang だけの要素には lang も書く。lang があれば増やさない', () => {
    const html = xhtmlToHtml('<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><body><p xml:lang="en" lang="en-GB">x</p><span xml:lang="fr">y</span></body></html>');
    expect(html).toMatch(/<html lang="ja" xml:lang="ja">/);
    expect(html).toMatch(/<p xml:lang="en" lang="en-GB">/);
    expect(html).toMatch(/<span lang="fr" xml:lang="fr">/);
    // HTML として読んだ文書で :lang() が合う
    const doc = parseHTML(html).document as unknown as Document;
    const sel = parseSelectorList(':lang(ja)')[0];
    expect(matches(doc.getElementsByTagName('p')[0], sel)).toBe(false);
    expect(matches(doc.getElementsByTagName('span')[0], parseSelectorList(':lang(fr)')[0])).toBe(true);
    expect(matches(doc.getElementsByTagName('body')[0], sel)).toBe(true);
  });
});

describe('L-12: EPUB の属性の逃がし', () => {
  it('body の class と dc:language の " と < を逃がす', async () => {
    const xhtml = (body: string, cls: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body class="${cls}">${body}</body></html>`;
    const zip = makeZip([
      { name: 'mimetype', text: 'application/epub+zip' },
      { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>' },
      {
        name: 'OEBPS/content.opf',
        text: `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>t</dc:title><dc:language>ja&quot;&lt;x</dc:language></metadata>
<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
      },
      { name: 'OEBPS/ch1.xhtml', text: xhtml('<p>本文</p>', 'a&quot;b&lt;c') },
    ]);
    const book = await readEpub(zip, (t, type) => new DOMParser().parseFromString(t, type) as unknown as Document);
    expect(book.html).toContain('<section class="a&quot;b&lt;c">');
    expect(book.html).toContain('lang="ja&quot;&lt;x"');
    expect(book.html).not.toContain('class="a"b');
  });
});

describe('P-3: 要素の索引 (selectorIndex)', () => {
  const html = '<html><head></head><body><div id="d" class="A b"><p class="x">1</p><p class="y x">2</p><span class="x">3</span></div><p>4</p><ul><li>5</li></ul></body></html>';
  it('querySelectorAll と同じ要素を同じ順で返す (クラス・タグ・*・並び・結合子・属性だけのもの)', () => {
    const doc = parseHTML(html).document as unknown as Document;
    const sel = selectorIndex(doc);
    for (const t of ['.x', 'p.x', 'div .x', 'span, p', 'p, .x', 'li, body > p', '*', '[class]', '#d > p', 'div > span.x', 'p:first-child', '.nothing', 'p::before'])
      expect(sel(t).map((e) => e.textContent), t).toEqual(querySelectorAll(doc, t).map((e) => e.textContent));
  });
  it('quirks の文書では、クラスの大文字小文字を区別しない', () => {
    const doc = parseHTML(html).document as unknown as Document;
    setDocumentMode(doc, 'quirks');
    expect(selectorIndex(doc)('.a').length).toBe(1);
    expect(selectorIndex(doc)('.X').length).toBe(3);
    setDocumentMode(doc, 'no-quirks');
    expect(selectorIndex(doc)('.a').length).toBe(0);
  });
  it('カスケードの select も索引で選ぶ (collectPaged が使う)', () => {
    const doc = parseHTML(html).document as unknown as Document;
    const s = cascadeStyles(doc, '', { uaCss: HTML_UA_CSS });
    expect(s.select!('div .x').map((e) => e.textContent)).toEqual(['1', '2', '3']);
    expect(s.select!('ul li, p.y').map((e) => e.textContent)).toEqual(['2', '5']);
  });
});

describe('P-1: 構造の疑似クラスの兄弟の一覧 (linkedom)', () => {
  it('兄弟の一覧を覚え、書き換え (先頭・末尾・調べる要素の隣への挿入) を検出して作り直す', () => {
    const doc = parseHTML('<html><body><div id="d"><p id="a">a</p><p id="b">b</p><p id="c">c</p></div></body></html>').document as unknown as Document;
    const nth2 = parseSelectorList('p:nth-child(2)')[0];
    const first = parseSelectorList('p:first-child')[0];
    const b = doc.getElementById('b')!;
    const a = doc.getElementById('a')!;
    expect(matches(b, nth2)).toBe(true);
    expect(matches(a, first)).toBe(true);
    // 先頭に入れる → a は 2 番目、b は 3 番目
    const d = doc.getElementById('d')!;
    d.insertBefore(doc.createElement('p'), a);
    expect(matches(a, nth2)).toBe(true);
    expect(matches(a, first)).toBe(false);
    expect(matches(b, nth2)).toBe(false);
    // b の前 (中ほど) に入れる → b は 4 番目
    d.insertBefore(doc.createElement('p'), b);
    expect(matches(b, parseSelectorList('p:nth-child(4)')[0])).toBe(true);
    // 末尾の c を外す → b が最後
    d.removeChild(doc.getElementById('c')!);
    expect(matches(b, parseSelectorList('p:last-child')[0])).toBe(true);
  });
  it('兄弟 4000 個の :first-child の照合が、兄弟の数の 2 乗の時間にならない (childNodes.length を見ない)', () => {
    const mk = (n: number) => parseHTML(`<html><body><div>${'<p>x</p>'.repeat(n)}</div></body></html>`).document as unknown as Document;
    const sel = parseSelectorList('p:first-child')[0];
    const time = (n: number) => {
      const doc = mk(n);
      const ps = Array.from(doc.getElementsByTagName('p'));
      const t0 = performance.now();
      for (const p of ps) matches(p, sel);
      return performance.now() - t0;
    };
    time(500); // 暖機
    // 混んだ機械では 1 回の計測が揺れるので、数回測った最小の値で比べる (最小の値は、ほかの処理に割り込まれなかった回の時間に近い)
    const best = (n: number) => Math.min(...Array.from({ length: 5 }, () => time(n)));
    const t1 = best(1000);
    const t2 = best(4000);
    // 線形なら 4 倍ほど。2 乗なら 16 倍 (余裕を見て 10 倍まで)
    expect(t2).toBeLessThan(Math.max(t1, 2) * 10);
  });
});
