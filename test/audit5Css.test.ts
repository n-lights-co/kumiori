import { describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import { DOMParser } from '@xmldom/xmldom';
import { DOMParser as HtmlDomParser } from 'linkedom';
import { cascadeStyles } from '../src/cssCascade';
import { BT_MEMO_BUDGET, createSelectorMemo, matches, parseSelectorList } from '../src/cssSelector';
import { parsePageRule } from '../src/htmlImport';
import { parseCss } from '../src/htmlPaged';
import { prepareHtml } from '../src/htmlPrepare';
import { typeset } from '../src/index';
import { loadCachedFont } from './helpers';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const htmlParser = (s: string) => new HtmlDomParser().parseFromString(s, 'text/html') as unknown as Document;

/** depth 段の入れ子で、各段に sib − 1 個の兄弟のいる div (要素の数は depth × sib) */
const nested = (depth: number, sib: number) => {
  let s = '';
  for (let d = 0; d < depth; d++) s += '<div></div>'.repeat(sib - 1) + '<div>';
  return s + 'x' + '</div>'.repeat(depth);
};
/** 結合子の種類の混ざった、複合セレクタ 64 個のセレクタ (どの要素にも合わない) */
const heavyRule = (i: number) => `:not(div):not(body):not(html):not(.q${i})${' div ~ div'.repeat(31)} div { color: red }`;

describe('結合子の種類の混ざったセレクタの照合の覚えの予算 (検査 5 回目)', () => {
  it('そのようなセレクタ 100 個と要素 5000 個の文書を、数秒で組み、予算を超えたことを知らせる (直す前は 6 秒・500MB)', () => {
    const css = Array.from({ length: 100 }, (_, i) => heavyRule(i)).join('\n') + '\n.ok { color: rgb(1, 2, 3) }';
    const doc = parse(nested(100, 50).replace('x', '<p class="ok">x</p>'));
    let over = 0;
    const t = Date.now();
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 }, onSelectorBudget: () => over++ });
    for (const d of Array.from(doc.getElementsByTagName('div'))) s.style(d).getPropertyValue('color');
    expect(over).toBe(1);
    // ほかの規則は当てる
    expect(s.style(doc.getElementsByTagName('p')[0]).getPropertyValue('color')).toBe('rgb(1, 2, 3)');
    expect(Date.now() - t).toBeLessThan(15000);
  });

  it('組版の警告 (未対応の CSS) に出す', async () => {
    const css = Array.from({ length: 100 }, (_, i) => heavyRule(i)).join('\n');
    const r = await typeset(`<style>${css}</style>${nested(100, 50)}`, { loadFont: loadCachedFont });
    expect(r.warnings.some((w) => w.includes('照合の計算量の合計が大きすぎる'))).toBe(true);
  }, 60000);

  it('予算の届かない文書では、知らせず、結果も予算の無い照合と同じ', () => {
    const doc = parse('<section><h2 class="a">t</h2><div><p>1</p><p class="b">2</p><p>3</p></div><h2>u</h2><div><p>4</p><span><p>5</p></span></div></section>');
    const sels = ['.a ~ div > p ~ p', 'section h2 ~ div p', 'section > h2 ~ div span p', ':not(.a ~ div p)', ':is(h2 ~ div > p ~ p) ~ p', 'div:has(> p ~ p .x, span p)'];
    const all = Array.from(doc.getElementsByTagName('*'));
    for (const text of sels) {
      const sel = parseSelectorList(text)[0];
      let over = false;
      const budget = createSelectorMemo({ btBudget: BT_MEMO_BUDGET, onBtOver: () => (over = true) });
      const free = createSelectorMemo();
      expect(all.map((e) => matches(e, sel, undefined, budget))).toEqual(all.map((e) => matches(e, sel, undefined, free)));
      expect(over).toBe(false);
    }
  });

  it('予算を使い切った後は、そのようなセレクタ (と、それを :not() などに含むもの) を当てず、ほかのセレクタは当てる', () => {
    const doc = parse('<div><p>1</p><p>2</p><span><p>3</p></span></div>');
    const p3 = doc.getElementsByTagName('p')[2];
    let over = 0;
    const memo = createSelectorMemo({ btBudget: 1, onBtOver: () => over++ });
    const mixed = parseSelectorList('div p ~ span p')[0];
    // 使い切ったのは、この照合の途中 (この照合は最後まで続けるので、答えは正しい)
    expect(matches(p3, mixed, undefined, memo)).toBe(true);
    expect(over).toBe(1);
    expect(matches(p3, mixed, undefined, memo)).toBe(false);
    expect(matches(p3, parseSelectorList(':not(div p ~ span p)')[0], undefined, memo)).toBe(false);
    expect(matches(p3, parseSelectorList(':not(div p ~ span p)')[0], undefined, memo)).toBe(false);
    expect(matches(p3, parseSelectorList('div span p')[0], undefined, memo)).toBe(true);
    expect(matches(p3, parseSelectorList('span > p')[0], undefined, memo)).toBe(true);
    expect(over).toBe(1);
  });
});

describe('名前付きのページの幅 (検査 5 回目)', () => {
  const def = { width: 210, height: 297, margin: 20 };
  const widthsOf = async (css: string) => (await prepareHtml(`<style>${css}</style><p>x</p>`, [], 'kumiori', def, htmlParser)).pageWidthsPx;
  /** 名前ごとに parsePageRule を呼ぶ (直す前の求め方) */
  const naive = (css: string) => {
    const sheet = parseCss(css);
    const out = new Map<string, number>();
    for (const name of new Set(sheet.pages.map((p) => p.name).filter((n): n is string => !!n))) {
      const pg = parsePageRule(sheet, def, { name });
      out.set(name, ((pg.width - pg.margins.left - pg.margins.right) / 25.4) * 96);
    }
    return out;
  };

  it('@page の名前 2 万個 (269KB) を、すぐに読む (直す前は 6.5 秒)', async () => {
    const css = Array.from({ length: 20000 }, (_, i) => `@page a${i}{}`).join('');
    const t = cpuClock();
    const w = await widthsOf(css);
    expect(w.size).toBe(20000);
    expect(cpuClock() - t).toBeLessThan(scaled(3000));
  });

  it('カスケードの順 (詳細度・出てくる順) は、名前ごとに全部の規則を重ねるのと同じ', async () => {
    const css = [
      '@page { size: A5; margin: 10mm }',
      '@page wide { margin-left: 30mm }',
      '@page :left { margin-left: 50mm }',
      '@page wide:first { margin-right: 40mm }',
      '@page { margin-inline: 5mm 7mm }',
      '@page narrow { size: 100mm 200mm; margin: 1mm 2mm 3mm 4mm }',
      '@page wide { margin: 8mm }',
      '@page { margin-right: 15mm; size: A4 landscape }',
      '@page wide { margin-right: 9mm }',
      '@page __proto__ { margin-left: 3mm }',
      '@page narrow:blank { size: A3 }',
    ].join('\n');
    const w = await widthsOf(css);
    expect([...w]).toEqual([...naive(css)]);
    // 名前の無い規則 (A4 横・左 5mm・右 15mm) に、その名前の規則が後から重なる
    expect(w.get('wide')).toBeCloseTo(((297 - 8 - 9) / 25.4) * 96, 6);
    expect(w.get('narrow')).toBeCloseTo(((100 - 4 - 2) / 25.4) * 96, 6);
    expect(w.get('__proto__')).toBeCloseTo(((297 - 3 - 15) / 25.4) * 96, 6);
  });
});
