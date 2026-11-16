import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { createSelectorMemo, matches, parseSelectorList, querySelectorAll } from '../src/cssSelector';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const deepest = (doc: Document): Element => {
  const divs = doc.getElementsByTagName('div');
  return divs[divs.length - 1];
};

describe('後戻りする結合子を重ねたセレクタの照合 (検査 3 回目)', () => {
  it('子孫の結合子を 60 個つないだ規則 500 個と 60 段の入れ子の div を、数秒で組む (直す前は 30 秒超)', () => {
    const css = Array.from({ length: 500 }, (_, i) => `${'div '.repeat(60)}{ color: rgb(${i % 256}, 0, 0) }`).join(' ');
    const doc = parse(`${'<div>'.repeat(60)}x${'</div>'.repeat(60)}`);
    const t = Date.now();
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    // 60 段目の div には全部の規則が合い、後の規則 (499 番) が勝つ。59 段目には合わない
    expect(s.style(deepest(doc)).getPropertyValue('color')).toBe('rgb(243, 0, 0)');
    expect(s.style(deepest(doc).parentNode as Element).getPropertyValue('color')).not.toBe('rgb(243, 0, 0)');
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('div を 61 個つないだ規則は、60 段の入れ子のどの div にも合わない', () => {
    const css = Array.from({ length: 300 }, (_, i) => `${'div '.repeat(60)}div { color: rgb(${i % 256}, 1, 0) }`).join(' ');
    const doc = parse(`${'<div>'.repeat(60)}x${'</div>'.repeat(60)}`);
    const t = Date.now();
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    for (const d of Array.from(doc.getElementsByTagName('div'))) expect(s.style(d).getPropertyValue('color')).not.toMatch(/, 1, 0\)/);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('後続の兄弟の結合子を 60 個つないだセレクタと 300 個の兄弟を、数秒で照合する', () => {
    const doc = parse('<p>x</p>'.repeat(300));
    const t = Date.now();
    const hit = querySelectorAll(doc, `${'p ~ '.repeat(60)}p`);
    expect(hit.length).toBe(300 - 60);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('覚えを使っても、基準 (:scope) を見るセレクタは基準ごとに答える', () => {
    const doc = parse('<div id="a"><div id="b"><p class="x"><span id="c"></span></p></div></div>');
    const [sel] = parseSelectorList(':scope div p span');
    const memo = createSelectorMemo();
    const c = doc.getElementById('c')!;
    expect(matches(c, sel, doc.getElementById('a')!, memo)).toBe(true);
    expect(matches(c, sel, doc.getElementById('b')!, memo)).toBe(false);
    expect(matches(c, sel, doc.getElementById('a')!, memo)).toBe(true);
  });

  it('子孫・子・兄弟の結合子と :has() :is() :not() を混ぜたセレクタの答え', () => {
    const doc = parse('<div class="x"><p></p><span class="y"><a></a></span><p><a id="t"></a></p></div>');
    const t = doc.getElementById('t')!;
    const yes = ['div p a', '.x ~ * a, div > p a', 'div span ~ p a', 'div :is(span ~ p) a', 'div:has(span a) p a', 'div *:not(span) a', 'body div p ~ p a'];
    const no = ['div span a#t', 'div p + p a', 'div span ~ span a', 'div :not(p) a#t', 'div:has(p ~ span a) p ~ p ~ p a'];
    for (const s of yes) expect(parseSelectorList(s).some((x) => matches(t, x)), s).toBe(true);
    for (const s of no) expect(parseSelectorList(s).some((x) => matches(t, x)), s).toBe(false);
  });
});
