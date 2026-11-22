/**
 * 右端が条件の無い * (や、要素名だけ) で、その左が子孫・子の結合子の規則の照合の手間。
 * そのような規則の、右端より左の部分の答えは、要素の親で決まり、兄弟どうしで同じなので、カスケードと SVG の <style> は、
 * 親ごとに 1 度だけ照合して兄弟に使い回す。照合の回数で確かめ (時間では確かめない)、どの要素にどの宣言が当たるかが変わらないことも確かめる
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { DOMParser as HtmlDomParser } from 'linkedom';
import { cascadeStyles } from '../src/cssCascade';
import { createSelectorMemo, matches, matchesAbove, matchesRightmost, parentDecides, parseSelectorList, splitsAtParent } from '../src/cssSelector';
import { parseSvg } from '../src/svg';

const htmlDoc = (body: string) => new HtmlDomParser().parseFromString(`<html><head></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
/** 木の順の要素 (linkedom の getElementsByTagName('*') は、要素を返さない) */
const elements = (doc: Document): Element[] => {
  const out: Element[] = [];
  const walk = (e: Element) => {
    out.push(e);
    for (const c of Array.from(e.children)) walk(c);
  };
  walk(doc.documentElement);
  return out;
};
/** groups 個の section に、per 個ずつの span を入れた本文 */
const sections = (groups: number, per: number) => `<section>${'<span>x</span>'.repeat(per)}</section>`.repeat(groups);
/** 全部の要素の計算値を求めたときの、照合の回数 */
const matchCount = (doc: Document, css: string) => {
  const stats = { selectorMatches: 0 };
  const s = cascadeStyles(doc, css, { stats });
  for (const e of elements(doc)) s.style(e).getPropertyValue('opacity');
  return stats.selectorMatches;
};

describe('右端より左の部分が親で決まる規則の照合', () => {
  const rules = (right: string) => Array.from({ length: 300 }, (_, i) => `*:nth-child(${i + 2}n+${i + 2}) ${right} { opacity: 0.5 }`).join('\n');

  it('右端が * の規則は、親ごとに 1 度だけ照合する (規則の数 × 親の数。直す前は 規則の数 × 要素の数)', () => {
    const doc = htmlDoc(sections(20, 50));
    // 親になる要素は html・body と section 20 個
    const extra = matchCount(doc, rules('*')) - matchCount(doc, '');
    expect(extra).toBeLessThanOrEqual(300 * 22);
    expect(extra).toBeGreaterThan(0);
  });

  it('右端が要素名の規則も、右端より左の部分は、同じ親の兄弟に使い回す', () => {
    const doc = htmlDoc(sections(20, 50));
    // 右端の span に合うのは、section の子 (親 20 個) だけ
    const extra = matchCount(doc, rules('span')) - matchCount(doc, '');
    expect(extra).toBeLessThanOrEqual(300 * 20);
    expect(extra).toBeGreaterThan(0);
  });

  it('当たる宣言は、要素ごとに照合したのと同じ (木の順でも、逆の順でも)', () => {
    const doc = htmlDoc(
      '<div id="x" class="a"><p><span>1</span><span class="b">2</span><em>3</em></p><p class="a"><span>4</span></p></div>' +
        '<section><div><p><span>5</span></p><p><span class="b">6</span><span>7</span></p></div><span>8</span></section>' +
        '<div><span>9</span><p class="b"><em>10</em></p></div>' +
        sections(3, 3),
    );
    const sels = [
      'section *', 'section > *', '*:nth-child(2n) *', '*:nth-child(odd) > *', '.a *', 'div .a *', 'div > p *', 'div p *', ':has(> .b) *', ':not(.a) > *',
      'section span', '.a > span', 'div p span', '#x *', 'section ~ div *', 'body > * > p > *', ':is(div, section) > :nth-child(1) *', 'p:has(.b) > span',
    ];
    const all = elements(doc);
    for (const text of sels) {
      const sel = parseSelectorList(text)[0];
      const expected = all.map((e) => matches(e, sel, undefined, createSelectorMemo()));
      expect(expected.some(Boolean), text).toBe(true);
      for (const order of [all, [...all].reverse()]) {
        const s = cascadeStyles(doc, `${text} { margin-left: 7px }`);
        const got = new Map(order.map((e) => [e, s.style(e).getPropertyValue('margin-left') === '7px']));
        expect(all.map((e) => got.get(e)), `${text} (${order === all ? '木の順' : '逆の順'})`).toEqual(expected);
      }
    }
  });

  it('疑似要素の規則も同じに当てる', () => {
    const doc = htmlDoc('<section><p>a</p><p>b</p></section><p>c</p>');
    const s = cascadeStyles(doc, 'section *::before { content: "x" } body > *::after { content: "y" }');
    const ps = Array.from(doc.getElementsByTagName('p'));
    expect(ps.map((p) => s.style(p, '::before').getPropertyValue('content'))).toEqual(['"x"', '"x"', 'none']);
    expect(ps.map((p) => s.style(p, '::after').getPropertyValue('content'))).toEqual(['none', 'none', '"y"']);
  });

  it('照合を右端と左の部分に分けても、答えは matches と同じ', () => {
    const doc = htmlDoc('<div class="a"><p><span>1</span></p><p class="b"><span>2</span><span>3</span></p></div><section><span>4</span></section>');
    const all = elements(doc);
    for (const text of ['div span', '.a > p > span', 'div p span', '* > *', ':nth-child(2) *', 'p:not(.b) *', 'div *']) {
      const sel = parseSelectorList(text)[0];
      expect(splitsAtParent(sel), text).toBe(true);
      const memo = createSelectorMemo();
      expect(all.map((e) => matchesRightmost(e, sel, memo) && matchesAbove(e, sel, memo)), text).toEqual(all.map((e) => matches(e, sel, undefined, createSelectorMemo())));
    }
    // 親で決まるのは、右端に条件の無い * だけ。結合子の種類の混ざった backtrack のセレクタと、右端の左が兄弟の結合子のものは分けない
    expect(['div *', 'div > *', 'a b c *'].map((t) => parentDecides(parseSelectorList(t)[0]))).toEqual([true, true, true]);
    expect(['div span', '*', 'div *:first-child', 'div ~ p *', 'p + *', 'div [a]'].map((t) => parentDecides(parseSelectorList(t)[0]))).toEqual([false, false, false, false, false, false]);
    expect(splitsAtParent(parseSelectorList('div ~ p span')[0])).toBe(false);
    expect(splitsAtParent(parseSelectorList('p + span')[0])).toBe(false);
  });

  it('SVG の <style> の、右端が * の規則は、親ごとに 1 度だけ照らす (1000 規則と図形 2000 個でも、照らす回数の上限に届かずに描ける)', () => {
    const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
    // どの要素にも合わない 1000 規則 (g は 2 番目から 21 番目の子、svg は根元) と、最初の g の子にだけ合う規則
    const css = Array.from({ length: 1000 }, (_, i) => `*:nth-child(${i + 30}n+${i + 30}) * {fill:#f00}`).join('\n') + '\ng:nth-child(2) > * {fill:#0f0}';
    const g = `<g>${'<rect width="1" height="1"/>'.repeat(100)}</g>`.repeat(20);
    let why = '';
    const d = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><style>${css}</style>${g}</svg>`, parse, { onUnsupported: (m) => (why = m) });
    expect(why).toBe('');
    expect(d!.shapes).toHaveLength(2000);
    expect(d!.shapes.slice(0, 100).every((s) => s.fill === '#00ff00')).toBe(true);
    expect(d!.shapes.slice(100).every((s) => s.fill === '#000000')).toBe(true);
  });
});
