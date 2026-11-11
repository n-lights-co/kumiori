/**
 * attr() を、content のほかの性質の値に置き換える (CSS Values 5 §7.7。2024-11-11 の草案と、編集者の草案の <attr-type>)。
 *  - 型つきの attr(): 編集者の草案の number・単位の名前 (px・mm・% など)・type(<syntax>)・raw-string と、
 *    2024-11-11 の草案の attr(名前 <syntax>) (attr(x <number>) など)
 *  - 型の無い attr() は CSS の文字列になる。calc() の中で数として使った宣言は、計算値の時点で無効 (その性質は unset)
 *  - アンテナハウス互換 (ahAttrNumber) のときだけ、数の式 (calc() など) の中の型の無い attr() を、属性の値が数なら数として読む
 *  - 属性が無い・型に合わないときは fallback。fallback が無ければ宣言は無効
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, supportsCssDeclaration, ALL_AH } from '../src/cssCascade';
import { querySelectorAll } from '../src/cssSelector';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const run = (html: string, css: string, extra: object = {}) => {
  const doc = parse(html);
  const invalid: string[] = [];
  const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 }, onInvalidAttr: (prop: string, value: string) => invalid.push(`${prop}: ${value}`), ...extra });
  return { c: (id: string, p: string, pseudo?: '::before') => s.style(querySelectorAll(doc, `#${id}`)[0], pseudo).getPropertyValue(p), invalid };
};
const P = '<p id="a" data-position="2" data-w="30" data-len="12mm" data-c="red" data-s=" 1.5 " data-bad="abc">x</p><p id="b">y</p>';

describe('attr() の置き換え (CSS Values 5 §7.7)', () => {
  it('型つき: number・単位・type(<number>)・type(<length>) を calc() や長さの値に使える', () => {
    const r = run(
      P,
      `#a { margin-top: calc(attr(data-position number) * 20px); width: attr(data-w px); padding-left: attr(data-w %); margin-left: calc(attr(data-position type(<number>)) * 1px + 3px);
            margin-bottom: attr(data-len type(<length>)); text-indent: calc(attr(data-s number) * 10px) } #b { padding-left: 30% }`,
    );
    expect(r.c('a', 'margin-top')).toBe('40px');
    expect(r.c('a', 'width')).toBe('30px');
    // 百分率 (計算値は、同じ幅の兄弟に 30% と書いたものと同じ)
    expect(r.c('a', 'padding-left')).toBe(r.c('b', 'padding-left'));
    expect(parseFloat(r.c('a', 'padding-left'))).toBeGreaterThan(0);
    expect(r.c('a', 'margin-left')).toBe('5px');
    expect(parseFloat(r.c('a', 'margin-bottom'))).toBeCloseTo((12 * 96) / 25.4, 3);
    // 前後の空白は取り除いてから数として読む
    expect(r.c('a', 'text-indent')).toBe('15px');
    expect(r.invalid).toEqual([]);
  });

  it('2024-11-11 の草案の書き方 attr(名前 <syntax>) も読む。色・識別子の型', () => {
    const r = run(P, `#a { margin-top: calc(attr(data-position <number>) * 10px); color: attr(data-c type(<color>)); border-top-style: attr(data-st type(solid | dashed), dashed) }`);
    expect(r.c('a', 'margin-top')).toBe('20px');
    expect(r.c('a', 'color')).toBe('rgb(255, 0, 0)');
    expect(r.c('a', 'border-top-style')).toBe('dashed');
  });

  it('属性が無い・型に合わない: fallback を使う。fallback が無ければ宣言は無効 (性質は unset = 初期値)', () => {
    const r = run(P, `p { margin-top: 7px } #b { margin-top: calc(attr(data-position number, 3) * 10px); margin-left: attr(data-w px, auto) } #a { margin-top: attr(data-bad px); margin-left: attr(data-bad px, 9px) }`);
    expect(r.c('b', 'margin-top')).toBe('30px');
    expect(r.c('b', 'margin-left')).toBe('auto');
    // 型に合わず fallback も無い: 計算値の時点で無効。前の宣言 (7px) には戻らず、unset (margin は継承しないので初期値 0)
    expect(r.c('a', 'margin-top')).toBe('0px');
    expect(r.c('a', 'margin-left')).toBe('9px');
    expect(r.invalid).toEqual(['margin-top: attr(data-bad px)']);
  });

  it('型の無い attr() は文字列: calc() の中で数として使った宣言は無効 (unset) で、無効にしたことを知らせる', () => {
    const r = run(P, `p { margin-top: 7px } #a { margin-top: calc(attr(data-position) * 20px) }`);
    expect(r.c('a', 'margin-top')).toBe('0px');
    expect(r.invalid).toEqual(['margin-top: calc(attr(data-position) * 20px)']);
  });

  it('アンテナハウス互換 (ahAttrNumber): 数の式の中の型の無い attr() を、属性の値が数なら数として読む', () => {
    const r = run(P, `#a { margin-top: calc(attr(data-position) * 20px); margin-left: calc(attr(data-bad) * 20px) } #b { margin-top: calc(attr(data-position) * 20px) }`, { ahAttrNumber: true });
    expect(r.c('a', 'margin-top')).toBe('40px');
    // 数でない値・属性が無い (空の文字列) は、互換のときも無効
    expect(r.c('a', 'margin-left')).toBe('0px');
    expect(r.c('b', 'margin-top')).toBe('0px');
    expect(r.invalid.length).toBe(2);
  });

  it('疑似要素の attr() は、元の要素の属性を見る。content の attr() はいままでどおり (文字として使う)', () => {
    const r = run(P, `#a::before { content: attr(data-bad); margin-left: calc(attr(data-position number) * 4px) }`);
    expect(r.c('a', 'margin-left', '::before')).toBe('8px');
    expect(r.c('a', 'content', '::before')).toBe('attr(data-bad)');
  });

  it('CSS Values 3 (2013 年の勧告候補) の型の名前 string・length・color も読む。拡張の性質 (-ah- など) の attr() は置き換えない', () => {
    const invalid: string[] = [];
    const doc = parse(P);
    const st = cascadeStyles(doc, `#a { margin-top: attr(data-len length); color: attr(data-c color); -ah-alttext: attr(title string) }`, { viewport: { width: 600, height: 800 }, onInvalidAttr: (p: string, v: string) => invalid.push(`${p}: ${v}`) });
    const a = st.style(querySelectorAll(doc, '#a')[0]);
    expect(parseFloat(a.getPropertyValue('margin-top'))).toBeCloseTo((12 * 96) / 25.4, 3);
    expect(a.getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(invalid).toEqual([]);
  });

  it('@supports: attr() を含む宣言は、性質を知っていれば真 (構文は置き換えた後に調べる)', () => {
    expect(supportsCssDeclaration('margin-top', 'calc(attr(data-position number) * 20px)')).toBe(true);
    expect(supportsCssDeclaration('margin-top', 'calc(attr(data-position) * 20px)', ALL_AH)).toBe(true);
    expect(supportsCssDeclaration('no-such-property', 'attr(x number)')).toBe(false);
  });
});
