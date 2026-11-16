/**
 * 深い入れ子 (入れ子の上限 128 段を超える要素が多い文書) の、カスケードとセレクタの照合の手間を減らした所 (HTM-65) の結果が、
 * 減らす前と同じであることを確かめる。時間ではなく、結果 (計算値・照合の答え) を、覚えを使わない求め方と比べる。
 *  - 計算値の表 (cssCascade.ts の ComputedValues): 親と違う値だけを持つ。引いた値は、要素ごとに全部を持っていたときと同じ
 *  - 子孫の結合子の照合の覚え (cssSelector.ts の SelectorMemo.anc): 16 段より遠い祖先の照合の答えを覚える
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { createSelectorMemo, matches, parseSelectorList } from '../src/cssSelector';
import { limitTreeDepth, MAX_TREE_DEPTH } from '../src/htmlPrepare';

const doc = (body: string) => parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;
const all = (d: Document) => Array.from(d.querySelectorAll('*'));
const depthOf = (e: Element) => {
  let n = 0;
  for (let p: Node | null = e; p && p.nodeType === 1; p = p.parentNode) n++;
  return n;
};

describe('深い入れ子のセレクタの照合 (子孫の結合子の覚え)', () => {
  it('覚えを使った照合と、覚えを使わない照合の答えが、どの要素でも同じ', () => {
    // 60 段の入れ子。途中の段に class・id を置き、深い要素から遠い祖先を照合させる
    let body = '';
    for (let k = 0; k < 60; k++) body += `<div class="d${k % 7}${k === 3 ? ' top' : ''}"${k === 25 ? ' id="mid"' : ''}><span class="s${k % 3}">x</span>`;
    body += '</div>'.repeat(60);
    const d = doc(body);
    const sels = ['.top span', '.top .d2 .s1', '#mid .s0', 'section span', '.top > .d4 span', '.d0 .d1 .d2 .d3 span', ':is(.top, #none) .d6 span', '.top ~ x', 'body .d5'].map((s) => parseSelectorList(s)[0]);
    const memo = createSelectorMemo();
    let deepHits = 0;
    for (const s of sels)
      for (const e of all(d)) {
        const plain = matches(e, s);
        expect(matches(e, s, undefined, memo)).toBe(plain);
        if (plain && depthOf(e) > 30) deepHits++;
      }
    // 遠い祖先で合う要素があること (覚えの経路を通っている)
    expect(deepHits).toBeGreaterThan(50);
  });
});

describe('深い入れ子の計算値 (親と違う値だけを持つ表)', () => {
  it('上限を超えて平らに並べた <b><i><a><font> の、継承する性質・しない性質・currentcolor の計算値', () => {
    const d = doc('<b><i><a href="#"><font color="red">x'.repeat(60) + '<span style="font-weight: normal; font-style: normal; color: blue; border: solid">y</span>');
    expect(limitTreeDepth(d)).toBe(true);
    const st = cascadeStyles(d, 'a { color: green; text-decoration: underline } span { display: block }', { uaCss: HTML_UA_CSS });
    const v = (e: Element, p: string) => st.style(e).getPropertyValue(p);
    for (const e of all(d)) {
      const name = e.localName;
      // 祖先の b・i・font からの継承 (b・i は入れ子の上限より深くても、上限の段の要素の後ろに並ぶので、祖先にある分だけ)
      const anc = (n: string) => {
        for (let p = e as Element | null; p; p = p.parentElement) if (p.localName === n) return p;
        return null;
      };
      if (name === 'span') {
        expect(v(e, 'font-weight')).toBe('400');
        expect(v(e, 'font-style')).toBe('normal');
        expect(v(e, 'color')).toBe('rgb(0, 0, 255)');
        // 宣言の無い border-color は currentcolor (この要素の色)
        expect(v(e, 'border-top-color')).toBe('rgb(0, 0, 255)');
        expect(v(e, 'border-top-width')).toBe('3px');
        expect(v(e, 'display')).toBe('block');
        continue;
      }
      expect(depthOf(e)).toBeLessThanOrEqual(MAX_TREE_DEPTH);
      if (name === 'html' || name === 'head' || name === 'title' || name === 'body') continue;
      // b の既定のスタイルは bolder (CSS Fonts 4 §2.2 の表: 400 → 700 → 900)
      let bs = 0;
      for (let p = e as Element | null; p; p = p.parentElement) if (p.localName === 'b') bs++;
      expect(v(e, 'font-weight')).toBe(bs === 0 ? '400' : bs === 1 ? '700' : '900');
      expect(v(e, 'font-style')).toBe(anc('i') ? 'italic' : 'normal');
      // 色: font の color 属性 (赤)、a の規則 (緑)、どちらも無ければ黒。いちばん近い祖先の分
      let want = 'rgb(0, 0, 0)';
      for (let p = e as Element | null; p; p = p.parentElement) {
        if (p.localName === 'font') ((want = 'rgb(255, 0, 0)'), (p = null));
        else if (p.localName === 'a') ((want = 'rgb(0, 128, 0)'), (p = null));
        if (!p) break;
      }
      expect(v(e, 'color')).toBe(want);
      expect(v(e, 'border-top-color')).toBe(want);
      expect(v(e, 'border-top-width')).toBe('0px');
      expect(v(e, 'display')).toBe('inline');
      expect(v(e, 'text-decoration-line')).toBe(name === 'a' ? 'underline' : 'none');
      expect(v(e, 'background-color')).toBe('rgba(0, 0, 0, 0)');
    }
  });
  it('親と同じ値に戻した性質・親と違う値にした性質を、子孫が受け継ぐ', () => {
    // 段ごとに font-size を 2 倍・半分に、line-height の数値と letter-spacing を交互に変える
    let body = '';
    for (let k = 0; k < 40; k++) body += `<span class="k${k % 2}">`;
    body += '<em>z</em>' + '</span>'.repeat(40);
    const d = doc(body);
    const st = cascadeStyles(d, '.k0 { font-size: 20px; letter-spacing: 1px } .k1 { font-size: 10px; line-height: 2 } em { letter-spacing: inherit }', { uaCss: HTML_UA_CSS });
    const em = d.querySelector('em')!;
    // em の親は .k1 (40 段目)
    expect(st.style(em).getPropertyValue('font-size')).toBe('10px');
    expect(st.style(em).getPropertyValue('letter-spacing')).toBe('1px');
    expect(st.style(em).getPropertyValue('line-height')).toBe('20px');
    const ks = Array.from(d.querySelectorAll('span'));
    ks.forEach((s, k) => {
      expect(st.style(s).getPropertyValue('font-size')).toBe(k % 2 ? '10px' : '20px');
      expect(st.style(s).getPropertyValue('line-height')).toBe(k === 0 ? 'normal' : k % 2 ? '20px' : '40px');
    });
  });
});
