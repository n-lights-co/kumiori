// 後戻りする結合子 (子孫・後続の兄弟) を多く重ねたセレクタの照合の手間とメモリ
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { parseCss } from '../src/htmlPaged';
import { MAX_BACKTRACK_COMPOUNDS, parseSelectorList, querySelectorAll } from '../src/cssSelector';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;

describe('結合子がすべて同じセレクタは、要素の数に比例する手間で照合する', () => {
  it('i を 2 万個 ~ でつないだセレクタと 2 万個の <i> (240KB) を、落ちずに数秒で組む。当たるのは最後の i だけ (直す前はメモリを使い切って落ちた)', () => {
    const n = 20_000;
    const css = `${Array(n).fill('i').join(' ~ ')} { color: red }`;
    const doc = parse(`<p>${'<i>x</i>'.repeat(n)}</p>`);
    const t = Date.now();
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    const is = Array.from(doc.getElementsByTagName('i'));
    const red = is.filter((e) => s.style(e).getPropertyValue('color') === 'rgb(255, 0, 0)');
    expect(red).toEqual([is[n - 1]]);
    expect(Date.now() - t).toBeLessThan(10_000);
  }, 30_000);

  it('i を 2 万個空白でつないだセレクタと 2 万段の入れ子の <i> を、落ちずに照合する。当たるのは最も深い i だけ', () => {
    const n = 20_000;
    const doc = parse(`${'<i>'.repeat(n)}x${'</i>'.repeat(n)}`);
    const t = Date.now();
    const hit = querySelectorAll(doc, Array(n).fill('i').join(' '));
    const is = doc.getElementsByTagName('i');
    expect(hit).toEqual([is[n - 1]]);
    expect(Date.now() - t).toBeLessThan(10_000);
  }, 30_000);

  it('間を空けて合わせる: 合わない要素を挟んでも、左から順に合う要素があれば当たる', () => {
    const doc = parse('<a></a><b></b><c></c><a></a><c></c><b class="t"></b><a></a>');
    const t = Array.from(doc.getElementsByTagName('b'))[1];
    for (const [s, want] of [
      ['a ~ c ~ a ~ b', true],
      ['a ~ b ~ c ~ b', true],
      ['a ~ a ~ a ~ b', false],
      ['b ~ a ~ c ~ b', true],
      ['c ~ b ~ a ~ b', false],
    ] as const)
      expect(querySelectorAll(doc, s).includes(t), s).toBe(want);
    const deep = parse('<a><b><a><c><b><i id="t"></i></b></c></a></b></a>');
    const i = deep.getElementById('t')!;
    for (const [s, want] of [
      ['a b a c b i', true],
      ['a a b i', true],
      ['b a b c i', false],
      ['a c a i', false],
    ] as const)
      expect(querySelectorAll(deep, s).includes(i), s).toBe(want);
  });
});

describe('結合子の種類が混ざったセレクタの、複合セレクタの数の上限', () => {
  // div の子の p 70 個。div の後に「p ~」を k 個と p を続けると、複合セレクタは k + 2 個
  const doc = () => parse(`<div>${'<p>x</p>'.repeat(70)}</div>`);
  const mixed = (k: number) => `div ${'p ~ '.repeat(k)}p`;

  it(`上限 (${MAX_BACKTRACK_COMPOUNDS} 個) までは当てる`, () => {
    const k = MAX_BACKTRACK_COMPOUNDS - 2;
    const [sel] = parseSelectorList(mixed(k));
    expect(sel.compounds.length).toBe(MAX_BACKTRACK_COMPOUNDS);
    expect(sel.tooComplex).toBeUndefined();
    expect(querySelectorAll(doc(), mixed(k)).length).toBe(70 - k);
  });

  it('上限を超えるセレクタは当てない。:is() などの中にあるものも。並びのほかのセレクタは当てる', () => {
    const k = MAX_BACKTRACK_COMPOUNDS - 1;
    expect(parseSelectorList(mixed(k))[0].tooComplex).toBe(true);
    expect(querySelectorAll(doc(), mixed(k))).toEqual([]);
    expect(querySelectorAll(doc(), `p:is(${mixed(k)})`)).toEqual([]);
    expect(querySelectorAll(doc(), `p:not(${mixed(k)})`)).toEqual([]);
    expect(querySelectorAll(doc(), `div, ${mixed(k)}`).length).toBe(1);
    // 結合子がすべて同じなら、上限は無い
    expect(querySelectorAll(doc(), `${'p ~ '.repeat(k)}p`).length).toBe(70 - k);
  });

  it('上限を超えるセレクタの規則は警告に数える (読める規則は数えない)', () => {
    const k = MAX_BACKTRACK_COMPOUNDS - 1;
    const r = parseCss(`${mixed(k)}, b { color: red } ${mixed(k - 1)} { color: blue }`);
    expect(r.ignored).toHaveLength(1);
    expect(r.ignored![0]).toMatch(/複合セレクタが 64 個を超える、結合子の種類の混ざったセレクタ/);
    expect(r.rules.length).toBe(3);
    expect(parseCss(`${mixed(k - 1)} { color: blue }`).ignored).toBeUndefined();
  });

  it('上限の内の、種類の混ざったセレクタを要素 1 万個の文書で照合しても、数秒で終わる', () => {
    const sel = mixed(MAX_BACKTRACK_COMPOUNDS - 2);
    const d = parse(`<div>${'<p>x</p>'.repeat(10_000)}</div>`);
    const t = Date.now();
    expect(querySelectorAll(d, sel).length).toBe(10_000 - (MAX_BACKTRACK_COMPOUNDS - 2));
    expect(Date.now() - t).toBeLessThan(10_000);
  }, 30_000);
});

describe('後続の兄弟の結合子 (~) が 1 つのセレクタ', () => {
  it('親ごとに覚えた、初めに合う子の位置で照合しても、前の兄弟を 1 つずつ見るのと同じ要素に当たる (Selectors 4 §16.4)', () => {
    // 親が 2 つ。前の親では 5 番目と 30 番目の子が .a、後の親には .a が無い。右端が .b・:not(.b) のもの (照合しない兄弟を飛ばす) と、
    // 左に子孫の結合子のあるもの (.x .a ~ .b) も確かめる
    const kids = (as: number[]) => Array.from({ length: 40 }, (_, i) => `<i${as.includes(i) ? ' class="a"' : ''}${i % 7 === 0 ? ' class="b"' : ''}>x</i>`).join('');
    const doc = parse(`<div class="x">${kids([5, 30])}</div><div>${kids([])}</div>`);
    const css = '.a ~ i { color: red } .x .a ~ .b { background-color: blue } .a ~ :not(.b) { text-decoration-line: underline }';
    const s = cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } });
    const divs = Array.from(doc.getElementsByTagName('div'));
    for (const [d, div] of divs.entries()) {
      const is = Array.from(div.getElementsByTagName('i'));
      for (const [i, e] of is.entries()) {
        const after = d === 0 && i > 5;
        const st = s.style(e);
        expect(st.getPropertyValue('color') === 'rgb(255, 0, 0)', `${d}:${i} ~ i`).toBe(after);
        expect(st.getPropertyValue('background-color') === 'rgb(0, 0, 255)', `${d}:${i} .x .a ~ .b`).toBe(after && i % 7 === 0);
        expect(st.getPropertyValue('text-decoration-line') === 'underline', `${d}:${i} ~ :not(.b)`).toBe(after && i % 7 !== 0);
      }
    }
  });
});
