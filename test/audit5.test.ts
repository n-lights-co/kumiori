/**
 * 公開の前の脆弱性検査 (5 回目): 他人の書いた文書をサーバで組むときの、時間とメモリの守り
 *  - SVG の画像の幅・高さの読み取り、grid の repeat()、閉じない url( の正規表現が、長さの 2 乗の手間にならない
 *  - 入れ子の深い数学の関数で、スタックがあふれて文書全体が組めなくならない
 *  - 脚注の疑似要素の規則の照合・空になった字の並びの詰め・rowspan="0" が、文書の大きさの 2 乗以上の手間にならない
 *  - PDF/X で透明を平らにするとき、画像の画素の数の上限を守り、下の物を探す手間が描いた物の数の 2 乗にならない
 */
import { describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import { typeset } from '../src/index';
import { loadCachedFont } from './helpers';
import { GRID_REPEAT } from '../src/cssText';
import { FlatPage, FLATTEN_MAX_PIXELS, flattenPpi, meets, type Box, type FlatItem } from '../src/pdfFlatten';

const enc = (s: string) => new TextEncoder().encode(s);
const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = Date.now();
  const r = await f();
  return [r, Date.now() - t0];
};

describe('正規表現の手間', () => {
  it('SVG の画像の開始タグの長い空白で、幅・高さの読み取りが遅くならない', async () => {
    const sp = ' '.repeat(200_000);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1${sp}x" height="1${sp}x"><rect width="10" height="10"/></svg>`;
    const [r, ms] = await timed(() => typeset('<img src="a.svg">', { loadFont: loadCachedFont, files: [{ name: 'a.svg', data: enc(svg) }] }));
    expect(r.pageCount).toBe(1);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);

  it('repeat() の読み取りは、前の正規表現と同じ結果で、長い空白でも速い', () => {
    const before = /^repeat\(\s*([^,]+?)\s*,\s*([\s\S]*)\)$/i;
    for (const c of ['repeat(3, 1fr)', 'repeat( auto-fill , minmax(1px, 1fr) )', 'REPEAT(2,a b)', 'repeat(,a)', 'repeat( ,a)', 'repeat(  ,a)', 'repeat(1 ,  a)', 'repeat(1,)', 'repeat( 2 3 , x)', 'repeat(\t4\n,\ny )', 'repeat(a,b,c)', 'repeat(1, a) x)', 'repeat(1, a', 'repeat(1 a)', 'repeat()', 'repeat(x,　y)', 'repeatx(1,a)', 'repeat(1,a)\n']) {
      const a = before.exec(c);
      const b = GRID_REPEAT.exec(c);
      expect(b && [b[1], b[2]], c).toEqual(a && [a[1], a[2]]);
      expect(GRID_REPEAT.test(c), c).toBe(!!a);
    }
    const sp = ' '.repeat(200_000);
    const t0 = cpuClock();
    for (const s of [`repeat(a${sp}b)`, `repeat(1,${sp}x`, `repeat( 1${sp},${sp}a b${sp}`]) GRID_REPEAT.exec(s);
    expect(cpuClock() - t0).toBeLessThan(scaled(1000));
  });

  it('grid-template-columns の、カンマの無い repeat( と長い空白で、組むのが遅くならない', async () => {
    const html = `<div style="display:grid;grid-template-columns:repeat(a${' '.repeat(100_000)}b)"><div>x</div></div>`;
    const [r, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r.pageCount).toBe(1);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);

  it('閉じない url( を並べた filter・@page の background で、組むのが遅くならない', async () => {
    const urls = 'url('.repeat(100_000);
    const html = `<style>@page{background:url(a.png) ${urls}}</style><div style="filter:${urls}">x</div>`;
    const [r, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r.pageCount).toBe(1);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});

describe('入れ子・数の多い文書', () => {
  it('入れ子の深い calc() でも、スタックがあふれずに組める', async () => {
    const depth = 4000;
    const v = 'calc('.repeat(depth) + '1% + 1em' + ')'.repeat(depth);
    const html = `<div style="filter:blur(${v});letter-spacing:${v}">x</div>`;
    const [r, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r.pageCount).toBe(1);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);

  it('脚注の疑似要素の規則の前の選択子を、深い入れ子・多い兄弟に当てても遅くならない', async () => {
    const deep = '<div>'.repeat(60) + 'x' + '</div>'.repeat(60);
    const sibs = '<div>x</div>'.repeat(60);
    const html = `<style>.nope div div div div div div::footnote-call{color:red} .nope ~ div ~ div ~ div ~ div ~ div ~ div::footnote-call{color:red}</style>${deep}<section>${sibs}</section>`;
    const [r, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r.pageCount).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it('注釈を挟んだ改行の多い段落で、空になった字の並びを詰める手間が 2 乗にならない', async () => {
    const html = `<p>${'あ\n<!---->\n'.repeat(60_000)}</p>`;
    const [r, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r.pageCount).toBeGreaterThan(0);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);

  it('rowspan="0" は行のまとまりの残りの行すべてにわたる (行の数を、セルごとにたどり直さない)', async () => {
    const r = await typeset('<table><tbody><tr><td rowspan="0">A</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></tbody><tbody><tr><td>4</td><td>5</td></tr></tbody></table>', { loadFont: loadCachedFont });
    expect(r.pageCount).toBe(1);
    const rows = 1500;
    const html = `<table><tbody>${`<tr>${'<td rowspan="0">a</td>'.repeat(1)}<td>b</td></tr>`.repeat(rows)}</tbody></table>`;
    const [r2, ms] = await timed(() => typeset(html, { loadFont: loadCachedFont }));
    expect(r2.pageCount).toBeGreaterThan(0);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});

describe('PDF/X の透明を平らにする処理', () => {
  it('画像にする解像度は、広い範囲でも画素の数の上限を守る (1ppi でも超える範囲は 0)', () => {
    const it0 = (b: Box): FlatItem => ({ box: b, shapes: () => [] });
    for (const mm of [100, 2000, 5080, 20000, 200000]) {
      const side = (mm / 25.4) * 72;
      const box = { x0: 0, y0: 0, x1: side, y1: side };
      const ppi = flattenPpi([it0(box)], box);
      const inch = mm / 25.4;
      expect(inch * inch * ppi * ppi).toBeLessThanOrEqual(FLATTEN_MAX_PIXELS);
      if (mm <= 2000) expect(ppi).toBeGreaterThanOrEqual(72);
    }
    const huge = { x0: 0, y0: 0, x1: 1e9, y1: 1e9 };
    expect(flattenPpi([it0(huge)], huge)).toBe(0);
  });

  it('格子の索引で引いた下の物は、全部をたどったものと同じ (順も)', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const page = new FlatPage(2000, 2000);
    const boxAt = (w: number): Box => {
      const x = rnd() * 2200 - 100;
      const y = rnd() * 2200 - 100;
      return { x0: x, y0: y, x1: x + rnd() * w, y1: y + rnd() * w };
    };
    for (let i = 0; i < 3000; i++) {
      const b = i % 97 === 0 ? { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 } : i % 13 === 0 ? boxAt(1500) : boxAt(40);
      page.items.push({ box: b, shapes: () => [], ...(i % 7 === 0 ? { solid: { regions: [[b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1]], color: { cmyk: [0, 0, 0, i / 3000] } } } : {}) } as FlatItem);
      if (i % 50 === 0) {
        for (let q = 0; q < 20; q++) {
          const box = q % 5 === 0 ? boxAt(3000) : boxAt(60);
          const end = Math.floor(rnd() * (page.items.length + 1));
          const linear = page.items.slice(0, end).filter((it) => meets(it.box, box));
          expect(page.under(box, end)).toEqual(linear);
          const last = [...linear].reverse()[0];
          const bd = page.backdrop(box, end);
          if (!last) expect(bd).toBe('white');
        }
      }
    }
    // items を置き換えても、索引は作り直す
    const view = new FlatPage(2000, 2000);
    view.items = page.items.slice(0, 10);
    const all = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
    expect(view.under(all)).toEqual(page.items.slice(0, 10).filter((it) => meets(it.box, all)));
  });

  it('描いた物の多いページで、物ごとに下の物を引いても、描いた物の数の 2 乗の手間にならない', () => {
    // 半透明の字ごとに下の物を引く (前は、字ごとにページの描いた物を全部たどっていた)
    const page = new FlatPage(3000, 3000);
    const t0 = Date.now();
    let hits = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = (i % 300) * 10;
      const y = Math.floor(i / 300) * 9;
      const box = { x0: x, y0: y, x1: x + 8, y1: y + 8 };
      hits += (page.under(box) as FlatItem[]).length;
      if (page.backdrop(box) !== 'white') hits++;
      page.items.push({ box, shapes: () => [] });
    }
    expect(hits).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
