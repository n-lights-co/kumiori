import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, expand, lengthPx } from '../src/cssCascade';
import { matches, parseSelectorList } from '../src/cssSelector';
import { parseColor, splitWords } from '../src/cssText';

/** 全体のレビューで見つけた、CSS の処理の結果の誤り (CSS-02〜CSS-14) */

const doc = (body: string) => new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
const styleOf = (body: string, css: string, id = 'a') => {
  const d = doc(body);
  const st = cascadeStyles(d, css, { viewport: { width: 600, height: 800 } });
  return (prop: string) => st.style(d.getElementById(id)!).getPropertyValue(prop);
};
const RED = 'rgb(255, 0, 0)';

describe('HTML の属性による指定の強さ (CSS-02。Cascade 5 §6.5)', () => {
  it('層 (@layer) の中の作成者の規則は、属性による指定に勝つ', () => {
    expect(styleOf('<img id="a" width="100">', '@layer base { img { width: 50px } }')('width')).toBe('50px');
    expect(styleOf('<table><tr><td id="a" bgcolor="blue">x</td></tr></table>', '@layer base { td { background-color: red } }')('background-color')).toBe(RED);
  });
  it('層の無い規則・詳細度 0 の規則も勝ち、規則が無ければ属性による指定が効く', () => {
    expect(styleOf('<img id="a" width="100">', 'img { width: 50px }')('width')).toBe('50px');
    expect(styleOf('<img id="a" width="100">', ':where(img) { width: 50px }')('width')).toBe('50px');
    expect(styleOf('<img id="a" width="100">', '@layer base { p { width: 50px } }')('width')).toBe('100px');
  });
  it('層の中の !important は、層の無い !important より強いまま', () => {
    expect(styleOf('<img id="a" width="100">', 'img { width: 70px !important } @layer base { img { width: 50px !important } }')('width')).toBe('50px');
  });
});

describe('ASCII でない名前 (CSS-03。CSS Syntax 3 §4.2 の ident code point)', () => {
  const pseudoContent = (css: string) => {
    const d = doc('<p id="a">x</p>');
    return cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }).style(d.getElementById('a')!, '::before').getPropertyValue('content');
  };
  it('カスタム プロパティの名前に ASCII でない字を使える', () => {
    expect(styleOf('<p id="a">x</p>', '#a { --色: red; color: var(--色) }')('color')).toBe(RED);
    expect(styleOf('<p id="a">x</p>', ':root { --主-色: red } #a { color: var( --主-色 , blue) }')('color')).toBe(RED);
    // 定義の無い名前は fallback
    expect(styleOf('<p id="a">x</p>', '#a { color: var(--無, red) }')('color')).toBe(RED);
  });
  it('カウンターの名前に ASCII でない字を使った content を捨てない', () => {
    expect(pseudoContent('#a::before { content: counter(章) "." counters(節, ".", 番号) }')).toBe('counter(章) "." counters(節, ".", 番号)');
    // 数字で始まる名前は識別子ではない (宣言を捨てる)
    expect(pseudoContent('#a::before { content: counter(1章) }')).toBe('none');
  });
});

describe(':has() の相対セレクタ (CSS-04。Selectors 4 §4.5・§3.4)', () => {
  const d = doc('<div class="outer"><section id="s"><p class="x" id="x">1</p></section></div><ul id="u"><li>1</li></ul><ul id="v"><b>1</b></ul><h2 id="h">t</h2><div><p><i id="i">i</i></p></div><p id="last">z</p>');
  const ok = (sel: string, id: string) => {
    const s = parseSelectorList(sel);
    return s.length === 1 && matches(d.getElementById(id)!, s[0]);
  };
  it('相対セレクタの並びを、1 つずつ読む (先頭の結合子は、それぞれに付く)', () => {
    expect(parseSelectorList('ul:has(> li, > p)').length).toBe(1);
    expect(ok('ul:has(> li, > p)', 'u')).toBe(true);
    expect(ok('ul:has(> p, > li)', 'u')).toBe(true);
    expect(ok('ul:has(> li, > p)', 'v')).toBe(false);
    // 子孫と、後続の兄弟の混ざった並び
    expect(ok('ul:has(> p, + ul)', 'u')).toBe(true);
    expect(ok('ul:has(+ h2, > li)', 'v')).toBe(true);
    expect(ok('ul:has(+ h2, > li)', 'u')).toBe(true);
    expect(ok('ul:has(+ h2)', 'u')).toBe(false);
  });
  it('結合子の無い相対セレクタは、基準の要素の子孫だけで合わせる (外の祖先には合わない)', () => {
    expect(ok('section:has(.outer .x)', 's')).toBe(false);
    expect(ok('div:has(section .x)', 's')).toBe(false);
    expect(ok('section:has(.x)', 's')).toBe(true);
    expect(ok('div:has(section .x)', 'x')).toBe(false);
    expect(parseSelectorList('div.outer:has(section .x)').length && matches(d.getElementById('s')!.parentNode as Element, parseSelectorList('div.outer:has(section .x)')[0])).toBe(true);
  });
  it('後続の兄弟から先に結合子が続くときは、兄弟の子孫を調べる', () => {
    expect(ok('h2:has(+ div i)', 'h')).toBe(true);
    expect(ok('h2:has(~ div > p > i)', 'h')).toBe(true);
    expect(ok('h2:has(+ div > i)', 'h')).toBe(false);
    expect(ok('h2:has(~ p)', 'h')).toBe(true);
  });
  it('補った基準の要素 (:scope) は詳細度に数えない。疑似要素・空の引数は読めない', () => {
    const sp = (s: string) => parseSelectorList(s)[0].specificity;
    expect(sp('a:has(> img)')).toBe(2);
    expect(sp('a:has(img)')).toBe(2);
    expect(sp('a:has(> img, .x #y)')).toBe(1_001_001);
    expect(parseSelectorList('a:has(::before)')).toEqual([]);
    expect(parseSelectorList('a:has()')).toEqual([]);
    expect(parseSelectorList('a:has(> )')).toEqual([]);
  });
});

describe('読めない background の一括指定 (CSS-07。Backgrounds 3 §2.10・CSS 2.1 §4.2)', () => {
  it('どの種類にも当たらない語のある宣言は捨て、前の宣言を消さない', () => {
    expect(styleOf('<p id="a">x</p>', '#a { background: red; background: -webkit-linear-gradient(top, red, blue) }')('background-color')).toBe(RED);
    expect(styleOf('<p id="a">x</p>', 'p { background: red } #a { background: foo(1) }')('background-color')).toBe(RED);
    expect(styleOf('<p id="a">x</p>', 'p { background: url(a.png) } #a { background: bogus-word }')('background-image')).toBe('url("a.png")');
    expect(expand('background', '-webkit-linear-gradient(top, red, blue)')).toEqual([]);
    // 色は最後の層だけ。大きさの無い / ・空の層も読めない
    expect(expand('background', 'red url(a.png), url(b.png)')).toEqual([]);
    expect(expand('background', 'url(a.png) left /')).toEqual([]);
    expect(expand('background', 'url(a.png),')).toEqual([]);
  });
  it('読める一括指定は、今までどおりに分ける (固定・箱の語は読み飛ばす)', () => {
    const st = styleOf('<p id="a">x</p>', '#a { background: url(a.png) no-repeat 10px 50% / 20px auto fixed padding-box content-box, linear-gradient(red, blue) #00f }');
    expect(st('background-color')).toBe('rgb(0, 0, 255)');
    expect(st('background-image')).toBe('url("a.png")');
    expect(st('background-repeat')).toBe('no-repeat');
    expect(st('background-position')).toBe('10px 50%');
    expect(st('background-size')).toBe('20px auto');
    expect(styleOf('<p id="a">x</p>', '#a { background: none }')('background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(styleOf('<p id="a">x</p>', 'p { background: red } #a { background: linear-gradient(red, blue) }')('background-color')).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('不正な成分・範囲の外の成分の色 (CSS-08。Color 4 §4.2・§5.1・§7)', () => {
  it('数として読めない成分のある色は、色として読めない (宣言を捨てる)', () => {
    expect(parseColor('rgb(1,2,3,foo)')).toBeUndefined();
    expect(parseColor('rgb(1 2 3 / x%)')).toBeUndefined();
    expect(parseColor('rgb(1 2 3 4 5)')).toBeUndefined();
    expect(parseColor('rgb(1px 2 3)')).toBeUndefined();
    expect(parseColor('hsl(0 a% 50%)')).toBeUndefined();
    expect(parseColor('hsl(0 100% foo)')).toBeUndefined();
    expect(styleOf('<p id="a">x</p>', '#a { color: red; color: rgb(1,2,3,foo) }')('color')).toBe(RED);
    expect(styleOf('<p id="a">x</p>', '#a { color: red; color: hsl(0 100% bar) }')('color')).toBe(RED);
  });
  it('範囲の外の成分は、範囲に丸める', () => {
    expect(parseColor('hsl(0 100% 150%)')).toEqual([255, 255, 255, 1]);
    expect(parseColor('hsl(0 100% -50%)')).toEqual([0, 0, 0, 1]);
    expect(parseColor('hsl(120 -50% 50%)')).toEqual([128, 128, 128, 1]);
    expect(parseColor('hsl(0 200% 50%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('rgb(300 -5 0 / 150%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('rgba(1, 2, 3, -0.5)')).toEqual([1, 2, 3, 0]);
    expect(parseColor('hsla(120, 100%, 25%, 2)')).toEqual([0, 128, 0, 1]);
  });
  it('読める色は今までどおり', () => {
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5]);
    expect(parseColor('rgb(100%, 0%, 50%)')).toEqual([255, 0, 128, 1]);
    expect(parseColor('hsl(0.5turn 100% 50% / .25)')).toEqual([0, 255, 255, 0.25]);
    expect(parseColor('rgba(1e1, 2, 3, +.5)')).toEqual([10, 2, 3, 0.5]);
  });
});
