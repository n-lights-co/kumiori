import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { AH_BORDER_KEYWORDS, cascadeStyles, expand, HTML_UA_CSS, lengthPx, parseColor } from '../src/cssCascade';
import { CSS21_DEFAULT_CSS, documentMode } from '../src/htmlPrepare';
import { parseHTML } from 'linkedom';
import { importHtml } from '../src/htmlImport';
import type { LBlock, LTable } from '../src/types';
import { matches, parseNth, parseSelectorList, querySelectorAll } from '../src/cssSelector';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const byId = (doc: Document, id: string) => querySelectorAll(doc, `#${id}`)[0];

describe('セレクタ', () => {
  it('詳細度: id・class (属性・疑似クラス)・型の順。:where は 0、:is・:not は中で一番高いもの', () => {
    const sp = (s: string) => parseSelectorList(s)[0].specificity;
    expect(sp('p')).toBe(1);
    expect(sp('p.a')).toBe(1001);
    expect(sp('#x p.a[title]:first-child')).toBe(1_002_001 + 1000);
    expect(sp(':where(#x) p')).toBe(1);
    expect(sp(':is(#x, p) a')).toBe(1_000_001);
    expect(sp('p::before')).toBe(2);
    expect(parseSelectorList('p::before')[0].pseudoElement).toBe('before');
    expect(parseSelectorList('h1:after')[0].pseudoElement).toBe('after');
  });

  it('結合子 (子孫・子・隣接・後続)、属性、構造の疑似クラス、:not・:is・:has・:lang', () => {
    const doc = parse('<div id="d" lang="fr"><p id="a" class="x y" title="ab-cd">1</p><p id="b">2</p><section><p id="c">3</p></section><span id="e"></span></div>');
    const ok = (sel: string, id: string) => matches(byId(doc, id), parseSelectorList(sel)[0]);
    expect(ok('div p', 'c')).toBe(true);
    expect(ok('div > p', 'c')).toBe(false);
    expect(ok('#a + p', 'b')).toBe(true);
    expect(ok('#a ~ span', 'e')).toBe(true);
    expect(ok('p.x.y[title|="ab"]', 'a')).toBe(true);
    expect(ok('p[title^="ab"][title$="cd"][title*="-"]', 'a')).toBe(true);
    expect(ok('p:first-child', 'a')).toBe(true);
    expect(ok('p:nth-of-type(2)', 'b')).toBe(true);
    expect(ok('p:nth-child(odd)', 'b')).toBe(false);
    expect(ok('p:not(.x)', 'b')).toBe(true);
    expect(ok(':is(section, article) p', 'c')).toBe(true);
    expect(ok('div:has(> section)', 'd')).toBe(true);
    expect(ok('div:has(> p#c)', 'd')).toBe(false);
    expect(ok('p:lang(fr)', 'a')).toBe(true);
    expect(ok('span:empty', 'e')).toBe(true);
    expect(ok('p:hover', 'a')).toBe(false);
    expect(querySelectorAll(doc, 'p').length).toBe(3);
    expect(parseNth('-n+3')).toEqual([-1, 3]);
  });
});

describe('値', () => {
  it('色: 名前・#rgb・rgb()・hsl()・transparent・currentcolor', () => {
    expect(parseColor('rebeccapurple')).toEqual([102, 51, 153, 1]);
    expect(parseColor('#0f08')).toEqual([0, 255, 0, 0x88 / 255]);
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5]);
    expect(parseColor('hsl(120, 100%, 25%)')).toEqual([0, 128, 0, 1]);
    expect(parseColor('currentColor')).toBe('current');
    expect(parseColor('rgb-icc(0, 61, 25, #Separation)')).toBeUndefined();
  });

  it('長さ: 単位・em・rem・%・vw・calc()', () => {
    const ctx = { fs: 20, rootFs: 16, vw: 800, vh: 1000, pct: 400 };
    expect(lengthPx('12pt', ctx)).toBe(16);
    expect(lengthPx('1.5em', ctx)).toBe(30);
    expect(lengthPx('2rem', ctx)).toBe(32);
    expect(lengthPx('25%', ctx)).toBe(100);
    expect(lengthPx('10vw', ctx)).toBe(80);
    expect(lengthPx('calc(100% - 2 * 1em)', ctx)).toBe(360);
    expect(lengthPx('max(10px, 1em)', ctx)).toBe(20);
  });

  it('長さ: ic・lh・rlh・論理的な画面の単位・数の書き方 (+・指数)・calc() の型', () => {
    const ctx = { fs: 20, rootFs: 16, vw: 800, vh: 1000, pct: 400, lh: 30, rootLh: 24 };
    expect(lengthPx('2ic', ctx)).toBe(40);
    expect(lengthPx('1lh', ctx)).toBe(30);
    expect(lengthPx('2rlh', ctx)).toBe(48);
    expect(lengthPx('1lh', { fs: 20, rootFs: 16, vw: 800, vh: 1000 })).toBe(24);
    expect(lengthPx('10vi', ctx)).toBe(80);
    expect(lengthPx('10svb', ctx)).toBe(100);
    expect(lengthPx('10dvmin', ctx)).toBe(80);
    expect(lengthPx('+10px', ctx)).toBe(10);
    expect(lengthPx('1e+2px', ctx)).toBe(100);
    expect(lengthPx('1e1px', ctx)).toBe(10);
    expect(lengthPx('calc(1 + 10px)', ctx)).toBeUndefined();
    expect(lengthPx('calc(10px * 2px)', ctx)).toBeUndefined();
    expect(lengthPx('calc(10px / 0)', ctx)).toBeUndefined();
    expect(lengthPx('calc(10px / 2)', ctx)).toBe(5);
    expect(lengthPx('calc(2 * 10px)', ctx)).toBe(20);
  });

  it('一括指定: margin・border・background・font・list-style', () => {
    expect(expand('margin', '1px 2px')).toEqual([['margin-top', '1px'], ['margin-right', '2px'], ['margin-bottom', '1px'], ['margin-left', '2px']]);
    expect(expand('border-top', 'thick dashed red')).toEqual([['border-top-width', 'thick'], ['border-top-style', 'dashed'], ['border-top-color', 'red']]);
    expect(Object.fromEntries(expand('background', 'no-repeat top left / 125% url("img/a.png") #fff'))).toMatchObject({
      'background-image': 'url("img/a.png")',
      'background-repeat': 'no-repeat',
      'background-position-x': '0%',
      'background-position-y': '0%',
      'background-size': '125%',
      'background-color': '#fff',
    });
    expect(Object.fromEntries(expand('font', 'italic bold 12px/1.5 "A B", serif'))).toMatchObject({ 'font-style': 'italic', 'font-weight': 'bold', 'font-size': '12px', 'line-height': '1.5', 'font-family': '"A B", serif' });
    expect(Object.fromEntries(expand('list-style', 'none'))).toMatchObject({ 'list-style-type': 'none' });
  });
});

describe('カスケード', () => {
  const styleOf = (html: string, css: string, id: string, pseudo?: '::before', extra: { monospaceSize13?: boolean } = {}) => {
    const doc = parse(html);
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 }, ...extra });
    const el = byId(doc, id);
    return { c: (p: string) => s.style(el, pseudo).getPropertyValue(p), isAuto: (p: 'width') => s.isAuto!(el, p) };
  };

  it('アンテナハウス互換の既定のスタイル: ol・ul の字下げは padding-left: 2.5em (作成者の padding-left で置き換わる)', () => {
    const one = (css: string) => {
      const doc = parse('<ul id="u"><li>a</li></ul>');
      const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 }, uaExtraCss: CSS21_DEFAULT_CSS });
      const st = s.style(byId(doc, 'u'));
      return [st.getPropertyValue('margin-left'), st.getPropertyValue('padding-left')];
    };
    expect(one('body { font-size: 10px }')).toEqual(['0px', '25px']);
    expect(one('body { font-size: 10px } ul { padding-left: 1.5em }')).toEqual(['0px', '15px']);
  });

  it('アンテナハウス互換の既定のスタイル: sub・sup は親の line-height を受け継ぐ (CSS 2.1 付録 D に line-height の指定は無い)', () => {
    const lh = (extra?: string) => {
      const doc = parse('<p><sup id="s">a</sup><sub id="b">b</sub></p>');
      const s = cascadeStyles(doc, 'p { font-size: 10px; line-height: 13px }', { viewport: { width: 600, height: 800 }, ...(extra ? { uaExtraCss: extra } : {}) });
      return [s.style(byId(doc, 's')).getPropertyValue('line-height'), s.style(byId(doc, 'b')).getPropertyValue('line-height')];
    };
    expect(lh(CSS21_DEFAULT_CSS)).toEqual(['13px', '13px']);
    // ブラウザの既定 (WHATWG 15.3.4) は normal
    expect(lh()).toEqual(['normal', 'normal']);
  });

  it('詳細度・書いた順・!important・style 属性、読めない値は捨てる', () => {
    const { c } = styleOf(
      '<p id="a" class="x" style="margin-left: 3px">t</p>',
      'p.x { color: red } p { color: blue } #a { margin-left: 1px !important } p { padding-left: 1px; padding-left: 2px } .x { color: rgb-icc(1, 2, 3) }',
      'a',
    );
    expect(c('color')).toBe('rgb(255, 0, 0)');
    expect(c('margin-left')).toBe('1px');
    expect(c('padding-left')).toBe('2px');
  });

  it('アンテナハウスの -ah-padding-start などは論理的な余白・内側の余白。罫線の太さの丸めとキーワードの値', () => {
    expect(expand('-ah-padding-start', '0.5em')).toEqual([['padding-inline-start', '0.5em']]);
    expect(expand('-ah-border-radius', '18pt')).toEqual(expand('border-radius', '18pt'));
    expect(expand('-ah-border-top-left-radius', '2mm')).toEqual([['border-top-left-radius', '2mm']]);
    expect(expand('-ah-text-align', 'end')).toEqual([['text-align', 'end']]);
    expect(expand('-ah-text-align-last', 'center')).toEqual([['text-align-last', 'center']]);
    expect(expand('-ah-margin-before', '-0.7em')).toEqual([['margin-block-start', '-0.7em']]);
    const { c } = styleOf('<div id="a" style="-ah-padding-start: 6px; border: 0.3pt solid"></div>', '', 'a');
    expect(c('padding-left')).toBe('6px');
    expect(c('border-top-width')).toBe('1px'); // ブラウザと同じく 1px 未満は 1px
    const doc = parse('<div id="a" style="border: 0.3pt solid"></div><div id="b" style="border: medium solid"></div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 }, noBorderSnap: true, borderKeywords: AH_BORDER_KEYWORDS });
    expect(s.style(byId(doc, 'a')).getPropertyValue('border-top-width')).toBe('0.4px');
    expect(s.style(byId(doc, 'b')).getPropertyValue('border-top-width')).toBe('4px'); // 3pt
  });

  it('継承・初期値・inherit・既定のスタイル (h1 の大きさと余白、ul の余白)', () => {
    const { c } = styleOf('<div style="color: #00f; font-size: 10px; border: 1px solid"><h1 id="h">見出し</h1></div>', '', 'h');
    expect(c('color')).toBe('rgb(0, 0, 255)');
    expect(c('font-size')).toBe('20px');
    expect(c('margin-top')).toBe('13.4px');
    expect(c('font-weight')).toBe('700');
    expect(c('border-top-width')).toBe('0px'); // border は継承しない
    expect(c('display')).toBe('block');
  });

  it('見出しの段階 (:heading・headingoffset・headingreset) と既定の大きさ (HTML Living Standard §15.3.6)', () => {
    const doc = parse(
      '<div style="font-size: 10px"><section><h1 id="a">x</h1></section><div headingoffset="1"><h1 id="b">x</h1><div headingoffset="2"><h2 id="c">x</h2></div>' +
        '<div headingreset><h3 id="d">x</h3></div><h6 id="e" headingoffset="8">x</h6></div></div>',
    );
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const c = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
    // section の中の h1 も段階 1 (2em)。headingoffset は祖先の分を足す。headingreset で止める。9 を超えれば 9
    expect([c('a', 'font-size'), c('a', 'margin-top'), c('a', 'font-weight')]).toEqual(['20px', '13.4px', '700']);
    expect([c('b', 'font-size'), c('b', 'margin-top')]).toEqual(['15px', '12.45px']);
    expect(c('c', 'font-size')).toBe('8.3px');
    expect(c('d', 'font-size')).toBe('11.7px');
    expect(c('e', 'font-size')).toBe('6.7px');
    expect(querySelectorAll(doc, ':heading(2)').map((e) => e.getAttribute('id'))).toEqual(['b']);
    expect(querySelectorAll(doc, ':heading(5, 9)').map((e) => e.getAttribute('id'))).toEqual(['c', 'e']);
  });

  it('既定のスタイル: th の中央ぞろえ・li の match-parent・details・リストの記号・隠した行 (HTML Living Standard §15.3〜§15.5)', () => {
    const doc = parse(
      '<table><tr><th id="th1">x</th></tr><tr style="text-align: right"><th id="th2">x</th></tr></table>' +
        '<ul dir="rtl" style="text-align: end"><li id="li">x</li></ul><menu><dir><ul id="u"></ul></dir></menu>' +
        '<details><summary id="sm">s</summary><p>p</p></details><details open><summary id="so">s</summary></details>' +
        '<p hidden id="hp">x</p><table><tr hidden id="htr"><td>x</td></tr></table><div hidden="until-found" id="uf">x</div><caption id="cap"></caption>',
    );
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const c = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
    expect([c('th1', 'text-align'), c('th2', 'text-align')]).toEqual(['center', 'right']);
    expect(c('li', 'text-align')).toBe('left');
    expect(c('u', 'list-style-type')).toBe('square');
    expect([c('sm', 'display'), c('sm', 'list-style-type'), c('sm', 'list-style-position'), c('so', 'list-style-type')]).toEqual(['list-item', 'disclosure-closed', 'inside', 'disclosure-open']);
    // tr[hidden] は、15.3.1 の [hidden]:not([hidden=until-found i]):not(embed) (詳細度が高い) で display: none
    expect([c('hp', 'display'), c('htr', 'display'), c('htr', 'visibility'), c('uf', 'display'), c('uf', 'content-visibility')]).toEqual(['none', 'none', 'collapse', 'block', 'hidden']);
  });

  it('body の余白の属性 (marginheight・topmargin が上下、marginwidth・leftmargin が左右)', () => {
    const doc = new DOMParser().parseFromString('<html><head></head><body topmargin="5" bottommargin="9" leftmargin="4" rightmargin="9"></body></html>', 'text/html') as unknown as Document;
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const b = s.style(doc.getElementsByTagName('body')[0] as unknown as Element);
    expect(['top', 'bottom', 'left', 'right'].map((k) => b.getPropertyValue(`margin-${k}`))).toEqual(['5px', '5px', '4px', '4px']);
  });

  it('互換モード (quirks mode) の判定 (HTML Living Standard §13.2.6.4.1)', () => {
    const mode = (dt: string, xml = false) => documentMode(parseHTML(`${dt}<html><body></body></html>`).document as unknown as Document, xml);
    expect(mode('<!DOCTYPE html>')).toBe('no-quirks');
    expect(mode('')).toBe('quirks');
    expect(mode('', true)).toBe('no-quirks');
    expect(mode('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">')).toBe('quirks');
    expect(mode('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">')).toBe('limited-quirks');
  });

  it('互換モードの規則: 既定のスタイル・余白の打ち消し・先頭の # を省いた色・単位の無い長さ・ID とクラスの大文字小文字', () => {
    const doc = parse('<p id="p1">x</p><p id="p2">y</p><table><tr><td id="c"><p id="cp">z</p></td></tr></table><ul><li id="li2">a</li></ul><li id="li">b</li><div class="Box" id="d">d</div>');
    const css = '.box { color: ff0000; width: 100; margin-left: 10 } #P2 { background-color: 0f0 }';
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 }, quirksMode: 'quirks' });
    const c = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
    // body の最初の子の上の余白は 0。td の子の p は上下とも 0。リストの外の li は inside (リストの中は outside のまま)
    expect([c('p1', 'margin-top'), c('p2', 'margin-top'), c('cp', 'margin-top'), c('cp', 'margin-bottom')]).toEqual(['0px', '16px', '0px', '0px']);
    expect([c('li', 'list-style-position'), c('li2', 'list-style-position')]).toEqual(['inside', 'outside']);
    // 0f0 は数 0 と単位 f0 の字句なので、6 字に満たない分を前に 0 で埋めて #0000f0 (CSS Color 4 の付録 B)
    expect([c('d', 'color'), c('d', 'width'), c('d', 'margin-left'), c('p2', 'background-color')]).toEqual(['rgb(255, 0, 0)', '100px', '10px', 'rgb(0, 0, 240)']);
    // 互換モードでなければ、どれも使わない
    const d2 = parse('<div class="box" id="d">d</div>');
    const s2 = cascadeStyles(d2, css, { viewport: { width: 600, height: 800 } });
    expect([s2.style(byId(d2, 'd')).getPropertyValue('width'), s2.style(byId(d2, 'd')).getPropertyValue('color')]).toEqual(['auto', 'rgb(0, 0, 0)']);
  });

  it('高さの百分率 (CSS 2.1 §10.5) と互換モードの高さ・色 (Quirks Mode §3.5・§3.12・§3.13)', () => {
    const html = '<div style="height: 200px"><div id="a" style="height: 50%">a</div></div><div><div id="b" style="height: 50%">b</div></div>' + '<table style="color: initial"><tr><td id="c" style="height: 30px; padding: 5px">c</td></tr></table>';
    const vp = { width: 600, height: 800 };
    const std = parse(html);
    const s1 = cascadeStyles(std, 'body { color: #00f }', { viewport: vp });
    const g1 = (id: string, p: string) => s1.style(byId(std, id)).getPropertyValue(p);
    // 標準モード: 親の高さが決まっていれば百分率、決まっていなければ auto
    expect([g1('a', 'height'), g1('b', 'height'), g1('c', 'height')]).toEqual(['100px', 'auto', '30px']);
    const q = parse(html);
    const s2 = cascadeStyles(q, 'body { color: #00f }', { viewport: vp, quirksMode: 'quirks' });
    const g2 = (id: string, p: string) => s2.style(byId(q, id)).getPropertyValue(p);
    // 互換モード: 高さの決まった祖先まで (無ければページの領域の高さ 800px) さかのぼる。セルの高さは border-box
    expect([g2('a', 'height'), g2('b', 'height'), g2('c', 'height')]).toEqual(['100px', '400px', '20px']);
    // color: initial の表は、body の色
    expect(s2.style(q.getElementsByTagName('table')[0] as unknown as Element).getPropertyValue('color')).toBe('rgb(0, 0, 255)');
  });

  it('line-height の数値は数値で継承し、要素の字の大きさで px にする。var()・calc()・%', () => {
    const { c } = styleOf(
      '<div style="line-height: 1.5; font-size: 10px; width: 400px"><p id="p" style="font-size: 20px">x</p></div>',
      ':root { --gap: 3px } p { margin-left: calc(var(--gap) * 2); padding-left: 10%; }',
      'p',
    );
    expect(c('line-height')).toBe('30px');
    expect(c('margin-left')).toBe('6px');
    expect(c('padding-left')).toBe('40px');
  });

  it('lh・rlh は要素・根元の行の高さ (line-height の中では親の値)、ic は字の大きさ', () => {
    const { c } = styleOf(
      '<div style="line-height: 1.5; font-size: 10px"><p id="p" style="font-size: 20px">x</p></div>',
      'html { font-size: 16px; line-height: 2 } p { margin-top: 1lh; margin-bottom: 1rlh; text-indent: 1ic; line-height: calc(1lh + 0px) }',
      'p',
    );
    // line-height の中の lh は親の行の高さ (15px)。margin の lh は自分の行の高さ
    expect(c('line-height')).toBe('15px');
    expect(c('margin-top')).toBe('15px');
    expect(c('margin-bottom')).toBe('32px');
    expect(c('text-indent')).toBe('20px');
  });

  it('row-gap・column-gap の % は計算値に残す (基準は自分の内容の箱。CSS Box Alignment 3 §8.1)', () => {
    const { c } = styleOf('<div style="width: 200px"><p id="p">x</p></div>', 'p { display: flex; gap: 10% 5px }', 'p');
    expect(c('row-gap')).toBe('10%');
    expect(c('column-gap')).toBe('5px');
  });

  it('::before の content と、要素から受け継ぐ値。float はブロック化。幅の指定が auto かどうか', () => {
    const { c } = styleOf('<p id="p" style="color: green">x</p>', 'p::before { content: "§ "; float: left }', 'p', '::before');
    expect(c('content')).toBe('"§ "');
    expect(c('color')).toBe('rgb(0, 128, 0)');
    expect(c('display')).toBe('block');
    expect(styleOf('<p id="p">x</p>', '', 'p').isAuto('width')).toBe(true);
    expect(styleOf('<p id="p" style="width: 10px">x</p>', '', 'p').isAuto('width')).toBe(false);
  });

  it('一括指定は、どれか 1 つでも読めなければ宣言ごと捨てる。カウンターの数の省略は既定の数', () => {
    const { c } = styleOf('<h3 id="h" style="counter-reset: a b 2; counter-increment: a">x</h3>', 'h3 { margin: 1.5 0 3em }', 'h');
    expect(c('margin-bottom')).toBe('18.72px'); // 既定の 1em (1.17em の字)
    expect(c('counter-reset')).toBe('a 0 b 2');
    expect(c('counter-increment')).toBe('a 1');
  });

  it('ブラウザが読めない値 (float: footnote・leader() の content・dot-dash) の宣言は捨てる。dir 属性は direction', () => {
    const doc = parse('<p id="p" dir="rtl" class="f">x</p>');
    const s = cascadeStyles(doc, 'p { float: left; float: footnote; border-top: 2px dot-dash; } p::after { content: "a"; } .f::after { content: leader(dotted) }', {});
    const el = byId(doc, 'p');
    const c = (p: string) => s.style(el).getPropertyValue(p);
    expect([c('float'), c('border-top-width'), c('direction')]).toEqual(['left', '0px', 'rtl']);
    expect(s.style(el, '::after').getPropertyValue('content')).toBe('"a"');
  });

  it('表の部品 (col・tbody など) の align 属性は -webkit-*。counter() の引数の形が違う content は捨てる', () => {
    const doc = parse('<table><colgroup><col id="c" align="center"></colgroup><tbody id="b" align="right" valign="top"><tr><td>x</td></tr></tbody></table><p id="p" class="n">x</p>');
    const s = cascadeStyles(doc, '.n::before { content: "A"; } .n::before { content: "Page " counter(page physical); } p::after { content: counters(a, ".", decimal) " " counter(b, lower-roman); }', {});
    const c = (id: string, prop: string, pseudo?: '::before' | '::after') => s.style(byId(doc, id), pseudo).getPropertyValue(prop);
    expect([c('c', 'text-align'), c('b', 'text-align'), c('b', 'vertical-align')]).toEqual(['-webkit-center', '-webkit-right', 'top']);
    expect(c('p', 'content', '::before')).toBe('"A"');
    expect(c('p', 'content', '::after')).toBe('counters(a, ".", decimal) " " counter(b, lower-roman)');
  });

  it('var() を含む一括指定は、置き換えてから分ける', () => {
    const { c } = styleOf('<p id="p">x</p>', ':root { --grey: #e0e4ea; --w: white } p { background: var(--grey); border-left: 1pt solid var(--w) }', 'p');
    expect([c('background-color'), c('background-position-x'), c('border-left-width'), c('border-left-color')]).toEqual(['rgb(224, 228, 234)', '0%', '1px', 'rgb(255, 255, 255)']);
  });

  it('monospaceSize13 では、等幅の書体の既定の大きさから来た字の大きさを 13/16 にする (Chrome の既定)。既定では変えない', () => {
    expect(styleOf('<pre id="p">x</pre>', '', 'p', undefined, { monospaceSize13: true }).c('font-size')).toBe('13px');
    expect(styleOf('<pre id="p" style="font-size: 20px">x</pre>', '', 'p', undefined, { monospaceSize13: true }).c('font-size')).toBe('20px');
    expect(styleOf('<pre id="p">x</pre>', '', 'p').c('font-size')).toBe('16px');
    expect(styleOf('<p id="q">a<code id="p">x</code></p>', '', 'p').c('font-size')).toBe('16px');
  });
});

describe('カスケード (2): revert・all・font・カスタム プロパティ・セレクタ・既定のスタイル', () => {
  const css = `
p.r { margin-top: 5px; margin-top: revert; }
div.a { all: initial; }
div.u { color: red; } div.u span.b { all: unset; }
p.f { font-variant-numeric: oldstyle-nums; font: small-caps bold 12px/2 serif; }
:root { --a: 10px; --b: var(--a); } div.v { --a: 20px; } div.v p { margin-left: var(--b); }
div.c { --x: var(--y); --y: var(--x); margin-left: var(--x, 7px); --i: initial; padding-left: var(--i, 3px); }
:-foo, li.s1 { color: red; }
li:nth-child(2 of .k) { color: blue; }
li:is(:-foo, .s3) { color: green; }
li:not(:-foo, .s4) { text-decoration: underline; }
[dir=RTL] { color: green; } [dir=RTL s] { font-style: italic; }
q:lang(de, "*-CH") { color: green; }
q:dir(rtl) { font-weight: bold; }`;
  const doc = parse(
    '<p id="p1" class="r">x</p><div id="d1" class="a" style="color: blue">x</div><div class="u"><span id="s1" class="b">x</span></div>' +
      '<p id="pf" class="f">x</p><div class="v"><p id="pv">x</p></div><div id="dc" class="c">x</div>' +
      '<ul><li id="l1" class="s1">a</li><li class="k">c</li><li>d</li><li id="l5" class="k">e</li><li id="l6" class="s3 s4">f</li></ul>' +
      '<p id="pr" dir="rtl">x</p><q id="q1" lang="de-Latn-DE">a</q><q id="q2" lang="fr-CH">b</q><q id="q3" lang="">c</q><q id="q4" lang="en">d</q>' +
      '<div dir="auto">שלום <q id="q5">x</q></div><p><sub id="sb">1</sub></p><section><h1 id="sh">x</h1></section><noscript id="ns">n</noscript>',
  );
  const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
  const c = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
  it('revert は既定のスタイルまで戻る。all は direction のほかをまとめて指定する', () => {
    expect(c('p1', 'margin-top')).toBe('16px');
    expect([c('d1', 'display'), c('d1', 'color')]).toEqual(['inline', 'rgb(0, 0, 255)']);
    expect(c('s1', 'color')).toBe('rgb(255, 0, 0)');
  });
  it('font の一括指定は small-caps を font-variant-caps にし、font-variant-numeric などを初期値に戻す', () => {
    expect([c('pf', 'font-variant-caps'), c('pf', 'font-variant-numeric'), c('pf', 'font-weight'), c('pf', 'line-height')]).toEqual(['small-caps', 'normal', '700', '24px']);
  });
  it('カスタム プロパティは定義した要素で置き換える。循環・initial は無効で fallback を使う', () => {
    expect(c('pv', 'margin-left')).toBe('10px');
    expect([c('dc', 'margin-left'), c('dc', 'padding-left')]).toEqual(['7px', '3px']);
  });
  it('セレクタ: 読めないものを含む並びは規則ごと捨てる。:is() は読めるものだけ。of S・大文字小文字を区別しない属性・:lang()・:dir()', () => {
    expect(c('l1', 'color')).toBe('rgb(0, 0, 0)');
    expect(c('l5', 'color')).toBe('rgb(0, 0, 255)');
    expect([c('l6', 'color'), c('l6', 'text-decoration-line')]).toEqual(['rgb(0, 128, 0)', 'none']);
    expect([c('pr', 'color'), c('pr', 'font-style')]).toEqual(['rgb(0, 128, 0)', 'normal']);
    expect(['q1', 'q2', 'q3', 'q4'].map((id) => c(id, 'color'))).toEqual(['rgb(0, 128, 0)', 'rgb(0, 128, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)']);
    expect(c('q5', 'font-weight')).toBe('700');
  });
  it('既定のスタイル: sub の line-height、noscript を表示する (スクリプトを動かさない)', () => {
    expect(c('sb', 'line-height')).toBe('normal');
    expect(c('ns', 'display')).toBe('inline');
  });
});

describe('HTML の属性による指定 (HTML Living Standard §15.3・§15.4)', () => {
  const doc = parse(
    '<table id="t1" border="3" cellspacing="5" cellpadding="7" align="right"><tr><td id="c1" nowrap height="0">a</td><td id="c2" align="absmiddle">b</td></tr></table>' +
      '<table id="t2" rules="cols" frame="hsides"><tbody><tr><td id="c3">x</td></tr></tbody></table>' +
      '<table id="t3" border="0"><tr><td id="c4">x</td></tr></table>' +
      '<p><font id="f1" size="+2" color="00ff00">f</font><font id="f2" size="-5">g</font><a id="a1" href="#x">l</a><img id="i1" align="left" hspace="4" border="2"></p>' +
      '<hr id="h1" noshade size="6"><hr id="h2" size="5"><ol id="o1" type="A"><li id="l1" type="i">x</li></ol><ol id="o2" type="Square"></ol><ul id="u1" type="SQUARE"></ul>',
  );
  doc.getElementsByTagName('body')[0].setAttribute('link', 'red');
  doc.getElementsByTagName('body')[0].setAttribute('marginwidth', '3');
  const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
  const c = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
  it('表: border・cellspacing・cellpadding・align・rules・frame・nowrap', () => {
    expect([c('t1', 'border-top-width'), c('t1', 'border-top-style'), c('t1', 'border-top-color'), c('t1', 'border-spacing'), c('t1', 'float')]).toEqual(['3px', 'outset', 'rgb(0, 0, 0)', '5px', 'right']); // 罫線の色は字の色 (現行の仕様に table の border-color: gray は無い)
    expect([c('c1', 'border-top-width'), c('c1', 'border-top-style'), c('c1', 'padding-left'), c('c1', 'white-space'), c('c1', 'height')]).toEqual(['1px', 'inset', '7px', 'nowrap', 'auto']);
    expect(c('c2', 'text-align')).toBe('center');
    expect([c('t2', 'border-top-style'), c('t2', 'border-left-style'), c('t2', 'border-collapse'), c('t2', 'border-top-color')]).toEqual(['outset', 'hidden', 'collapse', 'rgb(0, 0, 0)']);
    expect([c('c3', 'border-top-style'), c('c3', 'border-left-style'), c('c3', 'border-left-width')]).toEqual(['none', 'solid', '1px']);
    expect([c('t3', 'border-top-style'), c('c4', 'border-top-style')]).toEqual(['none', 'none']);
  });
  it('font の size・color、body の marginwidth・link、img、hr、リストの type', () => {
    expect([c('f1', 'font-size'), c('f1', 'color'), c('f2', 'font-size')]).toEqual(['24px', 'rgb(0, 255, 0)', '10px']);
    expect(s.style(doc.getElementsByTagName('body')[0]).getPropertyValue('margin-left')).toBe('3px');
    expect(s.style(doc.getElementsByTagName('body')[0]).getPropertyValue('margin-top')).toBe('8px');
    expect(c('a1', 'color')).toBe('rgb(255, 0, 0)');
    expect([c('i1', 'float'), c('i1', 'margin-right'), c('i1', 'border-top-width'), c('i1', 'border-top-style')]).toEqual(['left', '4px', '2px', 'solid']);
    expect([c('h1', 'border-top-style'), c('h1', 'border-top-width')]).toEqual(['solid', '3px']);
    expect(c('h2', 'height')).toBe('3px');
    expect([c('o1', 'list-style-type'), c('l1', 'list-style-type'), c('o2', 'list-style-type'), c('u1', 'list-style-type')]).toEqual(['upper-alpha', 'lower-roman', 'decimal', 'square']);
  });
});

describe('::before・::after の計算値', () => {
  it('当たる規則が無ければ content は none。ほかの性質は読まれたときに計算する (親から受け継ぐ)', () => {
    const doc = parse('<p id="a" style="color: rgb(1, 2, 3)">x</p><p id="b">y</p>');
    const s = cascadeStyles(doc, '#b::before { content: "!" }', { viewport: { width: 600, height: 800 } });
    const a = s.style(byId(doc, 'a'), '::before');
    expect(a.getPropertyValue('content')).toBe('none');
    expect(a.getPropertyValue('color')).toBe('rgb(1, 2, 3)');
    expect(s.style(byId(doc, 'b'), '::before').getPropertyValue('content')).toBe('"!"');
  });
});

describe('既定のスタイル: vivliostyle', () => {
  it('見出しは次のブロックと同じページに置く (keepWithNext)。browser の既定では付けない', async () => {
    const { PRINT_UA_CSS, VIVLIOSTYLE_UA_CSS } = await import('../src/htmlPrepare');
    const kwn = (css: string) => {
      const doc = parse('<h2>見出し</h2><p>本文</p>');
      const flow = importHtml(doc, cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } })).document.sequences[0].flow;
      const blocks: LBlock[] = [];
      const walk = (n: { type?: string; children?: unknown[] }) => {
        if (n.type === 'block') blocks.push(n as LBlock);
        for (const k of n.children ?? []) if (typeof k === 'object' && k) walk(k as never);
      };
      walk(flow as never);
      return blocks.filter((b) => b.keepWithNext).length;
    };
    expect(kwn(PRINT_UA_CSS + VIVLIOSTYLE_UA_CSS)).toBe(1);
    expect(kwn(PRINT_UA_CSS)).toBe(0);
  });
  it('和欧間のアキを入れ (pre・code は入れない)、th の align 属性は使わない', async () => {
    const { prepareHtml } = await import('../src/htmlPrepare');
    const { DOMParser: LD } = await import('linkedom');
    const html = '<html><body><p id="p">a</p><pre id="c">b</pre><table><tr><th id="h" align="left">科目</th><td id="d" align="right">1</td></tr></table></body></html>';
    const prep = (s: 'vivliostyle' | 'browser') => prepareHtml(html, [], s, { width: 210, height: 297, margin: 20 }, (t) => new LD().parseFromString(t, 'text/html') as unknown as Document);
    const v = await prep('vivliostyle');
    const s = cascadeStyles(v.doc, v.css, { viewport: { width: 600, height: 800 } });
    const at = (id: string, p: string) => s.style(querySelectorAll(v.doc, `#${id}`)[0]).getPropertyValue(p);
    expect(at('p', 'text-autospace')).toBe('normal');
    // text-spacing は自前で読む (読み込みで pre の和欧間のアキを消す)
    const flow = importHtml(v.doc, s, { css: v.css }).document.sequences[0];
    expect(flow.textAutospace).toBe(true);
    expect((flow.flow.children as LBlock[]).find((b) => b.textAutospace === false)).toBeTruthy();
    expect(querySelectorAll(v.doc, '#h')[0].getAttribute('align')).toBeNull();
    expect(querySelectorAll(v.doc, '#d')[0].getAttribute('align')).toBe('right');
    const b = await prep('browser');
    expect(querySelectorAll(b.doc, '#h')[0].getAttribute('align')).toBe('left');
  });
});

describe('既定のスタイル: weasyprint', () => {
  it('フォームの部品は書体を受け継ぎ、字は 0.85 倍、罫線は黒。fieldset の罫線は文字の色', async () => {
    const { WEASYPRINT_UA_CSS } = await import('../src/htmlPrepare');
    const doc = parse('<div style="font-family: serif; font-size: 20px; color: rgb(255, 0, 0)"><fieldset id="f"><textarea id="t"></textarea></fieldset></div>');
    const s = cascadeStyles(doc, WEASYPRINT_UA_CSS, { viewport: { width: 600, height: 800 } });
    const at = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
    expect(at('t', 'font-family')).toBe('serif');
    expect(at('t', 'font-size')).toBe('17px');
    expect(at('t', 'border-top-color')).toBe('rgb(0, 0, 0)');
    expect([at('f', 'border-top-style'), at('f', 'border-top-color')]).toEqual(['groove', 'rgb(255, 0, 0)']);
    // ブラウザの既定 (Chrome) では等幅の書体
    const b = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    expect(b.style(byId(doc, 't')).getPropertyValue('font-family')).toBe('monospace');
  });
});

describe('自前のカスケードからの読み込み', () => {
  it('表の列の幅の % は % のまま (基準は表の幅)。読み込みでは比例の列幅にする', () => {
    const doc = parse('<table id="t"><colgroup><col id="a" style="width: 62%"><col style="width: 37%"><col style="width: 30px"></colgroup><tr><td>x</td><td>y</td><td>z</td></tr></table>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    expect(s.style(byId(doc, 'a')).getPropertyValue('width')).toBe('62%');
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.columns.map((c) => c.width)).toEqual(['62*', '37*', 22.5]);
  });

  it('::first-letter は最初の字 (前の約物を含む) を包み、float なら回り込みの字にする。::first-line は最初の行内の並びを包む', () => {
    const doc = parse('<p>“Hello <b>world</b></p><div>あいう</div>');
    const s = cascadeStyles(doc, 'p::first-letter { color: red } p::first-line { font-weight: bold } div::first-letter { float: left; font-size: 3em }', { viewport: { width: 600, height: 800 } });
    const flow = JSON.stringify(importHtml(doc, s).document.sequences[0].flow);
    expect(flow).toContain('{"type":"inline","firstLine":true,"fontWeight":700,"children":[{"type":"inline","color":"#ff0000"');
    expect(flow).toContain('"children":["“H"]},"ello "');
    expect(flow).toContain('{"type":"float","float":"start","cssPlacement":true,"children":[{"type":"block","fontSize":36');
  });

  it('rtc は 2 段目のルビ (下側)、半透明の背景は #rrggbbaa で持つ', () => {
    const doc = parse('<p><ruby>東<rt>とう</rt>京<rt>きょう</rt><rtc>Tokyo</rtc></ruby></p><div style="background: rgba(255, 0, 0, 0.5)">x</div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const flow = JSON.stringify(importHtml(doc, s).document.sequences[0].flow);
    expect(flow).toContain('{"type":"ruby","baseText":"東京","rubyText":"とうきょう","rubyTextUnder":"Tokyo"}');
    expect(flow).toContain('"backgroundColor":"#ff000080"');
  });

  it('inside の記号の後ろの文字: 数は空白、cjk-decimal は「、」だけ、文字列の記号は文字列だけ (Counter Styles 3)', () => {
    const markerOf = (type: string) => {
      const doc = parse(`<ol style="list-style: inside ${type}"><li>x</li></ol>`);
      const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
      return JSON.stringify(importHtml(doc, s).document.sequences[0].flow).match(/"children":\["([^"]*)","x"\]/)?.[1];
    };
    expect(markerOf('decimal')).toBe('1. ');
    expect(markerOf('cjk-decimal')).toBe('一、');
    expect(markerOf("'※'")).toBe('※');
  });

  it('固定レイアウト: 幅の指定の無い列だけ、1 行目のセルの幅で決める (CSS 2.1 §17.5.2.1)', () => {
    const doc = parse('<table style="table-layout: fixed; width: 400px; border-spacing: 0"><col style="width: 100px"><col><tr><td style="width: 200px; padding: 0">a</td><td style="width: 150px; padding: 0">b</td><td style="padding: 0">c</td></tr></table>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.columns.slice(0, 2).map((c) => c.width)).toEqual([75, 112.5]);
    expect(table.columns[2]?.width).toBeUndefined();
  });

  it('表の caption は見出しになり、caption-side で上下を決める。幅 auto の表は自動レイアウトで、列の幅がすべて決まっていれば中央に寄せる', () => {
    const doc = parse(
      '<table style="table-layout: fixed; margin: 0 auto; border-collapse: collapse"><caption>A</caption><caption style="caption-side: bottom">B</caption><col style="width: 40px"><col style="width: 80px"><tr><td>x</td><td>y</td></tr></table>',
    );
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.captions?.map((c) => [c.side, c.block.children])).toEqual([
      ['top', ['A']],
      ['bottom', ['B']],
    ]);
    // 幅 auto の表は自動レイアウト。列の幅の指定は列の最小の幅として組むときに使う
    expect([table.width, table.fitContent, table.columnWidthsAsMinimum]).toEqual([undefined, true, true]);
    // collapse の表は、組むときに外枠の罫線と合わせて中央に置く (読み込みでは余白を決めない。列の幅を縮めないため)
    expect(table.autoMargins).toBe('center');
  });

  it('行・行グループの背景は、自分の背景の無いセルに塗る。display:none のセルは表に入れない', () => {
    const doc = parse('<table><thead style="background:#00ff00"><tr><th>H</th></tr></thead><tbody><tr style="background:#0000ff"><td>a</td><td style="background:#ff0000">b</td><td style="display:none">x</td></tr></tbody></table>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.header!.rows[0].cells[0].backgroundColor).toBe('#00ff00');
    expect(table.body.rows[0].cells.map((c) => c.backgroundColor)).toEqual(['#0000ff', '#ff0000']);
  });

  it('max-width で幅が抑えられたブロックは、その幅になり、左右の margin: auto で中央に置く。min-height は高さの最小値', () => {
    const doc = parse('<div id="d" style="max-width: 200px; margin: 0 auto; min-height: 40px">x</div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const blocks: LBlock[] = [];
    const walk = (b: LBlock) => {
      blocks.push(b);
      for (const k of b.children ?? []) if ((k as LBlock).type === 'block') walk(k as LBlock);
    };
    importHtml(doc, s).document.sequences[0].flow.children.forEach((b) => walk(b as LBlock));
    const d = blocks.find((b) => b.id === 'd')!;
    expect(d.width).toBe(150);
    expect(d.margin).toMatchObject({ left: 144, right: 144 }); // (584 - 200) / 2 px
    expect(d.minBlockSize).toBe(30);
  });

  it('overflow: hidden・display: flow-root は新しいブロック整形文脈。overflow: clip は切り抜くだけ', () => {
    const doc = parse('<div id="a" style="overflow:hidden">a</div><div id="b" style="display:flow-root">b</div><div id="c" style="overflow:clip">c</div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const blocks: LBlock[] = [];
    const walk = (b: LBlock) => {
      blocks.push(b);
      for (const k of b.children ?? []) if ((k as LBlock).type === 'block') walk(k as LBlock);
    };
    importHtml(doc, s).document.sequences[0].flow.children.forEach((b) => walk(b as LBlock));
    const by = (id: string) => blocks.find((b) => b.id === id)!;
    expect([by('a').bfc, by('a').overflow, by('b').bfc, by('b').overflow, by('c').bfc, by('c').overflow]).toEqual([true, 'hidden', true, undefined, undefined, 'hidden']);
  });

  it('ルビは rt ごとに直前の親文字と対にする。rb を並べた書き方は順番どうし', () => {
    const doc = parse('<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>と<ruby><rb>東</rb><rb>京</rb><rp>(</rp><rt>とう</rt><rt>きょう</rt><rp>)</rp></ruby></p>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const rubies: Array<[string, string]> = [];
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as { type?: string; baseText?: string; rubyText?: string; children?: unknown[] };
      if (o.type === 'ruby') rubies.push([o.baseText!, o.rubyText!]);
      for (const k of o.children ?? []) visit(k);
    };
    visit(importHtml(doc, s).document.sequences[0].flow);
    expect(rubies).toEqual([
      ['漢', 'かん'],
      ['字', 'じ'],
      ['東', 'とう'],
      ['京', 'きょう'],
    ]);
  });

  it('list-style-position: inside は、記号を本文の先頭の行内の字にする', () => {
    const doc = parse('<ol style="list-style-position: inside"><li>a</li></ol>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.body.rows[0].cells[1].children[0]).toBe('1. ');
  });

  it('white-space・hyphens・letter-spacing・word-spacing は、子の指定で打ち消せる', () => {
    const doc = parse('<p style="white-space:nowrap;hyphens:auto;letter-spacing:2px;word-spacing:4px">a <span id="s" style="white-space:normal;hyphens:manual;letter-spacing:normal;word-spacing:normal">b</span></p>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    let span: Record<string, unknown> | undefined;
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as { type?: string; id?: string; children?: unknown[] };
      if (o.type === 'inline' && (o as { children?: unknown[] }).children?.includes('b')) span = o as Record<string, unknown>;
      for (const k of o.children ?? []) visit(k);
    };
    visit(importHtml(doc, s).document.sequences[0].flow);
    expect([span!.noWrap, span!.hyphenate, span!.letterSpacing, span!.wordSpacing]).toEqual([false, false, 0, 0]);
  });

  it('カウンター: reset → increment → set の順、兄弟の reset は置き換え、list-item カウンターの入れ子', () => {
    const doc = parse(
      '<ol class="n"><li>a<ol class="n"><li>a1</li></ol></li><li>b</li></ol><h2>H</h2><p class="s">s1</p><h2>H</h2><p class="s">t1</p><div style="counter-reset:c"><p class="x">X</p></div>',
    );
    const css = 'ol.n{list-style:none} ol.n li::before{content:counters(list-item,".") ":"} h2{counter-reset:sub} p.s::before{counter-increment:sub;content:counters(sub,".") " "} .x::before{content:counter(c) " "} .x{counter-set:c 5;counter-increment:c}';
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    const texts: string[] = [];
    const visit = (n: unknown) => {
      if (typeof n === 'string') texts.push(n);
      else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) visit(k);
    };
    visit(importHtml(doc, s, { css }).document.sequences[0].flow);
    const all = texts.join('|');
    for (const want of ['1:', '1.1:', '2:', '1 ', '5 ']) expect(all).toContain(want);
    expect(all).not.toContain('1.1 '); // 2 つ目の h2 の reset は、前の h2 のカウンターを置き換える (入れ子にしない)
  });

  it('reversed のリストは list-item カウンターを数え下げ、外のリストの番号を変えない', () => {
    const doc = parse('<ol><li>a<ol reversed><li>x</li><li>y</li></ol></li><li>b</li></ol><ol reversed start="10"><li>p</li><li>q</li></ol>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const marks: string[] = [];
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as { type?: string; children?: unknown[]; body?: { rows: Array<{ cells: Array<{ children: unknown[] }> }> } };
      if (o.type === 'table' && o.body) for (const r of o.body.rows) marks.push(String(r.cells[0].children[0] ?? ''));
      for (const k of o.children ?? []) visit(k);
      if (o.body) for (const r of o.body.rows) for (const c of r.cells) visit(c);
    };
    visit(importHtml(doc, s).document.sequences[0].flow);
    expect(marks).toEqual(['1.', '2.', '2.', '1.', '10.', '9.']);
  });

  it('読めない値の宣言は捨て、var() の結果が読めなければ unset。既定のスタイル (UA) は作成者スタイルシート に負ける。line-height: 0 も読む', () => {
    const doc = parse('<div style="color: blue"><p id="p" class="x">a</p></div><p id="q">b</p><ul><li><p id="r">c</p></li></ul>');
    const css = 'p { font-weight: 700; color: red; line-height: 0 } p { font-weight: heavy; color: var(--nope) } ul li p { text-indent: 2em }';
    const s = cascadeStyles(doc, css, { uaCss: HTML_UA_CSS + ' li > p:first-child { text-indent: 0 }', viewport: { width: 600, height: 800 } });
    const st = (id: string) => s.style(byId(doc, id));
    expect(st('p').getPropertyValue('font-weight')).toBe('700');
    expect(st('p').getPropertyValue('color')).toBe('rgb(0, 0, 255)'); // unset → 親 (青) を継ぐ
    expect(st('r').getPropertyValue('text-indent')).not.toBe('0px');
    expect(st('q').getPropertyValue('line-height')).toBe('0px');
  });

  it('論理的な性質は要素の書字方向で写す。縦書きの百分率の余白の基準は inline size、text-indent の百分率の基準は自分の幅', () => {
    const doc = parse('<div style="writing-mode: vertical-rl"><p id="v" style="margin-block-start: 40px; margin-inline-start: 10px; margin-right: 10%">a</p></div><p id="h" dir="rtl" style="padding-inline-start: 5px">b</p><div style="width: 200px"><p id="t" style="width: 100px; text-indent: 50%">c</p></div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const st = (id: string) => s.style(byId(doc, id));
    // 縦書き (vertical-rl): block-start は右、inline-start は上。ただし右の物理的な指定 (10% = 高さ 800 の 10%) が後で強い
    expect([st('v').getPropertyValue('margin-top'), st('v').getPropertyValue('margin-right')]).toEqual(['10px', '80px']);
    expect(st('h').getPropertyValue('padding-right')).toBe('5px');
    expect(st('t').getPropertyValue('text-indent')).toBe('50px');
  });

  it('表の行 (tr) の break-before・break-after・break-inside を読む', () => {
    const doc = parse('<table><tr><td>1</td></tr><tr style="break-before: page; break-inside: avoid"><td>2</td></tr><tr style="break-after: page"><td>3</td></tr></table>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const rows = find(importHtml(doc, s).document.sequences[0].flow)!.body.rows;
    expect(rows.map((r) => [!!r.breakBefore, !!r.keepTogether, !!r.breakAfter])).toEqual([
      [false, false, false],
      [true, true, false],
      [false, false, true],
    ]);
  });

  it('表の外のセル・行の無いセルは、匿名の表・行で包む', () => {
    const doc = parse('<div style="display:table"><div style="display:table-cell">A</div><div style="display:table-cell">B</div></div><div><span style="display:table-cell">X</span></div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const tables: LTable[] = [];
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as { type?: string; children?: unknown[] };
      if (o.type === 'table') tables.push(o as LTable);
      for (const k of o.children ?? []) visit(k);
    };
    visit(importHtml(doc, s).document.sequences[0].flow);
    expect(tables.map((t) => t.body.rows.map((r) => r.cells.length))).toEqual([[2], [1]]);
  });

  it('ブロックの ::after に箱の書式が付き、display: table のクリアフィックスも箱になる', () => {
    const doc = parse('<div id="d" class="cf">x</div>');
    const css = '.cf::after{content:"";display:table;clear:both} #d::before{content:"D";display:block;border-bottom:2px solid red;padding:3px}';
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    const blocks: LBlock[] = [];
    const walk = (b: LBlock) => {
      blocks.push(b);
      for (const k of b.children ?? []) if ((k as LBlock).type === 'block') walk(k as LBlock);
    };
    importHtml(doc, s, { css }).document.sequences[0].flow.children.forEach((b) => walk(b as LBlock));
    expect(blocks.some((b) => b.children[0] === 'D' && (b.border as { bottom?: { width: number } })?.bottom?.width === 1.5)).toBe(true);
    expect(blocks.some((b) => b.clear === 'both' && b.bfc)).toBe(true);
  });

  it('direction: rtl を文字の書式に渡す。標準の合字は既定で使い、font-variant-ligatures: none で止める', () => {
    const doc = parse('<p dir="rtl" id="r">a</p><p style="font-variant-ligatures:none" id="n">fi</p>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const blocks: LBlock[] = [];
    const walk = (b: LBlock) => {
      blocks.push(b);
      for (const k of b.children ?? []) if ((k as LBlock).type === 'block') walk(k as LBlock);
    };
    const res = importHtml(doc, s);
    const flow = res.document.sequences[0].flow;
    flow.children.forEach((b) => walk(b as LBlock));
    expect(blocks.find((b) => b.id === 'r')!.direction).toBe('rtl');
    expect(blocks.find((b) => b.id === 'n')!.latinLigatures).toBe(false);
    // 既定 (根元) は合字を使う
    expect(JSON.stringify(res.document)).toContain('"latinLigatures":true');
  });

  it('表の行の height は、行の高さの最小値', () => {
    const doc = parse('<table><tr style="height: 5em"><td>x</td></tr><tr><td>y</td></tr></table>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const find = (n: { type?: string; children?: unknown[] }): LTable | undefined =>
      n.type === 'table' ? (n as LTable) : (n.children ?? []).map((k) => (typeof k === 'object' && k ? find(k as never) : undefined)).find(Boolean);
    const table = find(importHtml(doc, s).document.sequences[0].flow)!;
    expect(table.body.rows.map((r) => r.minHeight)).toEqual([60, undefined]); // 5 × 16px = 80px = 60pt
  });

  it('幅の決まった箱の margin: auto は左右を等分し、画像は中央に置く', () => {
    const doc = parse('<div id="d" style="width: 200px; margin: 0 auto">x</div><img id="i" src="a.png" style="display: block; margin: 0 auto">');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const blocks: LBlock[] = [];
    const walk = (b: LBlock) => {
      blocks.push(b);
      for (const k of b.children ?? []) if ((k as LBlock).type === 'block') walk(k as LBlock);
    };
    importHtml(doc, s).document.sequences[0].flow.children.forEach((b) => walk(b as LBlock));
    const div = blocks.find((b) => b.id === 'd')!;
    expect(div.margin).toMatchObject({ left: 144, right: 144 }); // (600 - 16 - 200) / 2 px = 144pt
    expect(blocks.some((b) => b.textAlign === 'center' && b.children.some((k) => (k as { type: string }).type === 'image'))).toBe(true);
  });
});

describe('アンテナハウスの拡張の罫線の線種', () => {
  it('ahBorderStyles (アンテナハウス互換) なら dot-dash・dot-dot-dash・wave を border-style の値として読む (既定では捨てる)', () => {
    const doc = parse('<p id="a" style="border: 2px dot-dash red">a</p><p id="b" style="border-style: wave">b</p><p id="c" style="border-style: dot-dot-dash">c</p>');
    const d = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    expect(d.style(byId(doc, 'b')).getPropertyValue('border-left-style')).toBe('none');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 }, ahBorderStyles: true });
    const at = (id: string, p: string) => s.style(byId(doc, id)).getPropertyValue(p);
    expect([at('a', 'border-top-style'), at('b', 'border-left-style'), at('c', 'border-bottom-style')]).toEqual(['dot-dash', 'wave', 'dot-dot-dash']);
  });
});
