import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, expand, lengthPx } from '../src/cssCascade';
import { gradientSvg } from '../src/cssGradient';
import { matches, parseSelectorList } from '../src/cssSelector';
import { parseColor, splitWords } from '../src/cssText';
import { parseCss, resolvePageRules } from '../src/htmlPaged';

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
  it('読める一括指定は、層ごとの値の並びに分ける (Backgrounds 3 §2.1・§2.10。固定・箱の語も、層ごとの値にする)', () => {
    const st = styleOf('<p id="a">x</p>', '#a { background: url(a.png) no-repeat 10px 50% / 20px auto fixed padding-box content-box, linear-gradient(red, blue) #00f }');
    expect(st('background-color')).toBe('rgb(0, 0, 255)');
    expect(st('background-image')).toBe('url("a.png"), linear-gradient(red, blue)');
    expect(st('background-repeat')).toBe('no-repeat, repeat');
    expect(st('background-position')).toBe('10px 50%, 0% 0%');
    expect(st('background-size')).toBe('20px auto, auto');
    expect(st('background-attachment')).toBe('fixed, scroll');
    expect(st('background-origin')).toBe('padding-box, padding-box');
    expect(st('background-clip')).toBe('content-box, border-box');
    // 1 層だけの一括指定は、並びにならない (これまでと同じ値)
    const one = styleOf('<p id="a">x</p>', '#a { background: url(a.png) no-repeat 10px 50% / 20px auto #00f }');
    expect([one('background-image'), one('background-repeat'), one('background-position'), one('background-size')]).toEqual(['url("a.png")', 'no-repeat', '10px 50%', '20px auto']);
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

describe('無効な var() (CSS-11。Variables 1 §2.3・§3・§3.1)', () => {
  it('値の無いカスタム プロパティを fallback なしで参照した宣言は、残りの語が読めても unset', () => {
    const st = styleOf('<div style="color: rgb(255, 0, 0)"><p id="a">x</p></div>', 'p { margin: 5px; padding-left: 7px; color: blue } #a { margin: 10px var(--nope); padding-left: var(--nope) 3px; color: var(--nope) }');
    expect(st('margin-top')).toBe('0px');
    expect(st('margin-left')).toBe('0px');
    expect(st('padding-left')).toBe('0px');
    // 継承する性質の unset は継承
    expect(st('color')).toBe(RED);
  });
  it('fallback があれば fallback を使い、空の値のカスタム プロパティは空として置き換える', () => {
    expect(styleOf('<p id="a">x</p>', '#a { margin: 10px var(--nope, 20px) }')('margin-left')).toBe('20px');
    expect(styleOf('<p id="a">x</p>', '#a { --e: ; margin: 10px var(--e) }')('margin-left')).toBe('10px');
    expect(styleOf('<p id="a">x</p>', '#a { margin: 10px var(--nope,) }')('margin-left')).toBe('10px');
  });
  it('循環するカスタム プロパティは、fallback があっても、すべて無効', () => {
    const css = (decls: string, use: string) => `#a { ${decls}; width: 5px; width: ${use} }`;
    // 2 つの輪: どちらも無効なので、使う側の fallback (9px)
    expect(styleOf('<p id="a">x</p>', css('--a: var(--b, 1px); --b: var(--a, 2px)', 'var(--a, 9px)'))('width')).toBe('9px');
    expect(styleOf('<p id="a">x</p>', css('--a: var(--b, 1px); --b: var(--a, 2px)', 'var(--b, 9px)'))('width')).toBe('9px');
    // 自分自身への参照、使われない fallback の中の参照も循環
    expect(styleOf('<p id="a">x</p>', css('--a: var(--a, 1px)', 'var(--a, 9px)'))('width')).toBe('9px');
    expect(styleOf('<p id="a">x</p>', css('--x: 3px; --a: var(--x, var(--a))', 'var(--a, 9px)'))('width')).toBe('9px');
    // 分かれて合流する道の先の輪 (a → b → d → a、a → c → d): a・b・c・d のすべてが無効
    const dia = '--a: var(--b) var(--c); --b: var(--d); --c: var(--d, 1px); --d: var(--a, 2px)';
    for (const n of ['a', 'b', 'c', 'd']) expect(styleOf('<p id="a">x</p>', css(dia, `var(--${n}, 9px)`))('width')).toBe('9px');
    // 輪を参照するだけ (輪の上には無い) のものは、fallback で有効
    expect(styleOf('<p id="a">x</p>', css('--a: var(--a); --e: var(--a, 4px)', 'var(--e, 9px)'))('width')).toBe('4px');
    // 親で決まった値への、同じ名前の参照は循環 (この要素で定義し直しているので)
    expect(styleOf('<div style="--a: 3px"><p id="a">x</p></div>', css('--a: var(--a)', 'var(--a, 9px)'))('width')).toBe('9px');
    // 循環の無い参照は今までどおり
    expect(styleOf('<p id="a">x</p>', css('--a: var(--b); --b: var(--c, 6px)', 'var(--a, 9px)'))('width')).toBe('6px');
  });
});

describe('値を語に分ける (CSS-12)', () => {
  it('入れ子の括弧の中の空白では分けない', () => {
    expect(splitWords('calc(10mm + (2mm * 2)) 20mm')).toEqual(['calc(10mm + (2mm * 2))', '20mm']);
    expect(splitWords('  max(1px, min(2px, (3px + 4px)))   url(a b)  x ')).toEqual(['max(1px, min(2px, (3px + 4px)))', 'url(a b)', 'x']);
    expect(splitWords('1mm 2mm\t3mm\n4mm')).toEqual(['1mm', '2mm', '3mm', '4mm']);
    expect(splitWords('"a b" c')).toEqual(['"a b"', 'c']);
    expect(splitWords('')).toEqual(['']);
  });
  it('@page の margin の、入れ子の括弧のある calc() を 1 つの値として辺に分ける', () => {
    const { pages } = parseCss('@page { margin: calc(10mm + (2mm * 2)) 20mm }');
    const d = resolvePageRules(pages, { first: true }).decls;
    expect([d['margin-top'], d['margin-right'], d['margin-bottom'], d['margin-left']]).toEqual(['calc(10mm + (2mm * 2))', '20mm', 'calc(10mm + (2mm * 2))', '20mm']);
  });
});

describe('止まりが 1 つのグラデーション、clamp()・calc() の読みすぎ (CSS-13)', () => {
  it('止まりが 1 つのグラデーションは、その色の一色 (NaN の座標にしない。Images 4 §3.5.1)', () => {
    for (const g of ['linear-gradient(red)', 'linear-gradient(to right, red 30%)', 'radial-gradient(red)', 'repeating-linear-gradient(red)', 'linear-gradient(45deg, rgba(255, 0, 0, 0.5))']) {
      const svg = gradientSvg(g, 100, 40);
      expect(svg, g).toBeDefined();
      expect(svg, g).not.toContain('NaN');
      expect(svg, g).toMatch(/#ff0000/);
      expect(svg, g).not.toMatch(/stop-color="#(?!ff0000)/);
    }
    expect(gradientSvg('linear-gradient(red)', 100, 40)).toContain('x1="50" y1="0" x2="50" y2="40"');
    // 止まりが無ければ読めない
    expect(gradientSvg('linear-gradient(to right)', 100, 40)).toBeUndefined();
  });
  it('clamp() は引数 3 つ、min()・max() は 1 つ以上。ほかの関数を clamp() として読まない', () => {
    const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 600 };
    expect(lengthPx('clamp(1px, 2px)', ctx)).toBeUndefined();
    expect(lengthPx('clamp(1px, 2px, 3px, 4px)', ctx)).toBeUndefined();
    expect(lengthPx('clamp(1px, , 3px)', ctx)).toBeUndefined();
    expect(lengthPx('min()', ctx)).toBeUndefined();
    expect(lengthPx('calc(1px + foo(1px, 2px, 3px))', ctx)).toBeUndefined();
    expect(lengthPx('clamp(1px, 5px, 3px)', ctx)).toBe(3);
    expect(lengthPx('min(4px, 1em)', ctx)).toBe(4);
    expect(lengthPx('max(4px)', ctx)).toBe(4);
    expect(lengthPx('calc(2 * max(1px, min(3px, 2px)))', ctx)).toBe(4);
  });
  it('calc() の中に項にならない字が残れば読めない (読める所だけを値にしない)', () => {
    const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 600 };
    expect(lengthPx('calc(10px foo)', ctx)).toBeUndefined();
    expect(lengthPx('calc(10px + 2px !)', ctx)).toBeUndefined();
    expect(lengthPx('calc(10px, 2px)', ctx)).toBeUndefined();
    expect(lengthPx('calc( 10px + (2em * 2) - 1e1px )', ctx)).toBe(64);
    expect(lengthPx('calc(100% - 10px)', { ...ctx, pct: 200 })).toBe(190);
    expect(styleOf('<p id="a">x</p>', '#a { width: 7px; width: calc(10px foo) }')('width')).toBe('7px');
    expect(styleOf('<p id="a">x</p>', '#a { width: 7px; width: clamp(1px, 2px) }')('width')).toBe('7px');
  });
});

describe('読めるかの検査と、計算値の読み方をそろえる (CSS-14)', () => {
  it('font-weight: 小数・先頭の +・指数の数も、その数になる (400 に戻さない)', () => {
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: 700; font-weight: 550.5 }')('font-weight')).toBe('550.5');
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: +700 }')('font-weight')).toBe('700');
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: 6e2 }')('font-weight')).toBe('600');
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: 700. }')('font-weight')).toBe('700');
    // 範囲の外・数でない値は、今までどおり宣言を捨てる
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: 700; font-weight: 1001 }')('font-weight')).toBe('700');
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: 700; font-weight: 0 }')('font-weight')).toBe('700');
    expect(styleOf('<p id="a">x</p>', '#a { font-weight: bold }')('font-weight')).toBe('700');
  });
  it('line-height: 先頭の +・指数・小数点から始まる数も、数値の行の高さになる (normal に戻さない)', () => {
    const lh = (v: string) => styleOf('<p id="a">x</p>', `#a { font-size: 10px; line-height: 3; line-height: ${v} }`)('line-height');
    expect(lh('+1.5')).toBe('15px');
    expect(lh('2e0')).toBe('20px');
    expect(lh('.5')).toBe('5px');
    expect(lh('1.')).toBe('10px');
    expect(lh('1.5')).toBe('15px');
    // 数値のまま継承する
    expect(styleOf('<div style="font-size: 10px; line-height: +1.5"><p id="a" style="font-size: 20px">x</p></div>', '')('line-height')).toBe('30px');
    // 負の数は、今までどおり宣言を捨てる
    expect(lh('-1')).toBe('30px');
  });
  it('z-index・column-count: 先頭の + の付いた整数も、その整数になる (auto に戻さない)', () => {
    expect(styleOf('<p id="a">x</p>', '#a { position: relative; z-index: 3; z-index: +5 }')('z-index')).toBe('5');
    expect(styleOf('<p id="a">x</p>', '#a { z-index: -2 }')('z-index')).toBe('-2');
    expect(styleOf('<p id="a">x</p>', '#a { column-count: +2 }')('column-count')).toBe('2');
  });
});
