import { describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg } from '../src/svg';
import { rasterFilter } from '../src/svgFilterRaster';

// 検査 (5 回目) で見つかった、SVG の filter を図形で近似するときに、小さな入力で時間・メモリを使い切らせる問題

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (filter: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">${filter}</filter>` +
  '<rect x="20" y="20" width="20" height="20" fill="#0000ff" filter="url(#f)"/></svg>';
const vec = (filter: string) => parseSvg(svg(filter), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!;

describe('filter の部分領域で切る矩形の並び (Filter Effects 1 §9.4)', () => {
  it('feComposite の in の in と in2 に同じ切った結果を重ねて渡しても、並びが指数で増えない', () => {
    // 前は、in と in2 の切る矩形の並びをつなぐので、n 回重ねると 2^n 個になった (n=24 で 1 秒・900MB、n=28 でメモリを使い切った)
    let p = '<feFlood flood-color="#ff0000" x="5" y="5" width="20" height="20" result="r0"/>';
    for (let i = 1; i <= 40; i++) p += `<feComposite in="r${i - 1}" in2="r${i - 1}" operator="in" result="r${i}"/>`;
    // 最後の色の層を SourceAlpha の形で塗り、図形で描く (切る矩形の重なりの中だけ)
    p += '<feComposite in="r40" in2="SourceAlpha" operator="in"/>';
    const rss0 = process.memoryUsage().rss;
    const t0 = cpuClock();
    const doc = vec(p);
    expect(cpuClock() - t0).toBeLessThan(scaled(3000));
    expect(process.memoryUsage().rss - rss0).toBeLessThan(200e6);
    // 切る矩形 (5,5)-(25,25) の重なりの中だけ、図形 (20,20)-(40,40) を赤で塗る
    const red = doc.shapes.filter((s) => s.fill === '#ff0000');
    expect(red.length).toBeGreaterThan(0);
    for (const s of red) {
      expect(s.clips?.length ?? 0).toBeLessThanOrEqual(2);
      const xs = s.clips![0].segs.flatMap((g) => ('x' in g ? [g.x as number] : []));
      expect(Math.min(...xs)).toBeCloseTo(5);
      expect(Math.max(...xs)).toBeCloseTo(25);
    }
  });

  it('切る矩形の重なりが空なら、何も描かない', () => {
    // 部分領域の重ならない 2 つの色を in で重ねる。in2 の側を 3 回重ねて 8 個の並びにし、in の側と合わせて上限 (8) より長くして、重なりの 1 つの矩形にまとめさせる
    let p = '<feFlood flood-color="#ff0000" x="0" y="0" width="10" height="10" result="a0"/>';
    p += '<feFlood flood-color="#00ff00" x="50" y="50" width="10" height="10" result="b0"/>';
    for (let i = 1; i <= 3; i++) p += `<feComposite in="b${i - 1}" in2="b${i - 1}" operator="in" result="b${i}"/>`;
    p += '<feComposite in="a0" in2="b3" operator="in" result="c"/>';
    p += '<feComposite in="c" in2="SourceAlpha" operator="in"/>';
    const doc = vec(p);
    expect(doc.shapes.filter((s) => s.fill === '#ff0000' || s.fill === '#00ff00')).toEqual([]);
  });
});

describe('filter の近似の層の数 (Filter Effects 1 §9.8・§9.10)', () => {
  // 前は、feComposite の over・feMerge が入力の層を並べてつなぐので、同じ結果を 2 つ渡したものを n 回重ねると、層が 2^n 個になった
  // (n=24 で 2 秒・950MB、n=28 で 2.8GB を使った後に描けなくなった)。上限を超えたら、画素の計算に回す
  const chain = (n: number, step: (i: number) => string) => {
    let p = '<feOffset dx="1" result="r0"/>';
    for (let i = 1; i <= n; i++) p += step(i);
    return p;
  };
  it.each([
    ['feComposite の over', (i: number) => `<feComposite in="r${i - 1}" in2="r${i - 1}" operator="over" result="r${i}"/>`],
    ['feMerge', (i: number) => `<feMerge result="r${i}"><feMergeNode in="r${i - 1}"/><feMergeNode in="r${i - 1}"/></feMerge>`],
  ])('%s に同じ結果を 2 つ渡して 40 回重ねても、層が指数で増えず、画素で計算する', (_name, step) => {
    const rss0 = process.memoryUsage().rss;
    const t0 = cpuClock();
    const doc = vec(chain(40, step));
    expect(cpuClock() - t0).toBeLessThan(scaled(3000));
    expect(process.memoryUsage().rss - rss0).toBeLessThan(200e6);
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0].image).toBeDefined();
  });

  it('上限 (128) までの層は、今までどおり図形で描く', () => {
    // feMerge で元の図形を 100 個重ねる (同じ層を重ねると不透明度が重なるので、1 つにまとめずに 100 個描く)
    const doc = vec(`<feMerge>${'<feMergeNode in="SourceGraphic"/>'.repeat(100)}</feMerge>`);
    expect(doc.shapes.filter((s) => s.fill === '#0000ff')).toHaveLength(100);
    expect(doc.shapes.some((s) => s.image)).toBe(false);
  });
});
