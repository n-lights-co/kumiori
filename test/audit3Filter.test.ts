import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg } from '../src/svg';
import { boxBlur, morphPass, rasterFilter } from '../src/svgFilterRaster';

// 検査 (3 回目) で見つかった、SVG の filter を画素で計算するときに、小さな入力で時間・メモリを使い切らせる問題

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string, attrs = 'width="100" height="100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** 直す前の feMorphology の 1 方向 (窓ごとに数える) */
function morphNaive(d: Float32Array, W: number, H: number, r: number, horizontal: boolean, dil: boolean): Float32Array {
  const pick = dil ? Math.max : Math.min;
  const o = new Float32Array(d.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 4; c++) {
        let v = dil ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          v = pick(v, xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : d[(yy * W + xx) * 4 + c]);
        }
        o[(y * W + x) * 4 + c] = v;
      }
  return o;
}

/** 直す前の箱のぼかし (初めの窓を、窓の幅の回数で足す) */
function boxNaive(src: Float32Array, w: number, h: number, size: number, off: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const sum = new Float64Array(4);
  for (let l = 0; l < lines; l++) {
    const at = (p: number) => (horizontal ? (l * w + p) * 4 : (p * w + l) * 4);
    sum.fill(0);
    for (let p = -off; p < -off + size; p++) if (p >= 0 && p < n) for (let k = 0; k < 4; k++) sum[k] += src[at(p) + k];
    for (let p = 0; p < n; p++) {
      const o = at(p);
      for (let k = 0; k < 4; k++) out[o + k] = sum[k] / size;
      const add = p - off + size;
      const rem = p - off;
      if (add >= 0 && add < n) for (let k = 0; k < 4; k++) sum[k] += src[at(add) + k];
      if (rem >= 0 && rem < n) for (let k = 0; k < 4; k++) sum[k] -= src[at(rem) + k];
    }
  }
  return out;
}

const randomImage = (W: number, H: number) => Float32Array.from({ length: W * H * 4 }, () => (rnd() < 0.3 ? 0 : rnd() * 1.4 - 0.2));

describe('画素の計算の書き換えは、直す前と同じ結果', () => {
  it('feMorphology の窓の最大・最小 (van Herk / Gil-Werman) は、窓ごとに数えたものと同じ (半径が画像より大きいときも)', () => {
    for (let t = 0; t < 300; t++) {
      const W = 1 + Math.floor(rnd() * 25);
      const H = 1 + Math.floor(rnd() * 25);
      const r = Math.floor(rnd() * 40);
      const d = randomImage(W, H);
      for (const horizontal of [true, false])
        for (const dil of [true, false]) expect(morphPass(d, W, H, r, horizontal, dil)).toEqual(morphNaive(d, W, H, r, horizontal, dil));
    }
  });
  it('半径が Infinity でも止まり、半径が画像の幅のときと同じ', () => {
    const d = randomImage(7, 5);
    expect(morphPass(d, 7, 5, Infinity, true, true)).toEqual(morphNaive(d, 7, 5, 7, true, true));
    expect(morphPass(d, 7, 5, Infinity, false, false)).toEqual(morphNaive(d, 7, 5, 5, false, false));
  });
  it('箱のぼかしは、窓が画像より広くても、直す前と同じ', () => {
    for (let t = 0; t < 300; t++) {
      const W = 1 + Math.floor(rnd() * 30);
      const H = 1 + Math.floor(rnd() * 30);
      const size = 1 + Math.floor(rnd() * 80);
      const off = Math.floor(rnd() * (size + 1));
      const d = randomImage(W, H);
      for (const horizontal of [true, false]) expect(boxBlur(d, W, H, size, off, horizontal)).toEqual(boxNaive(d, W, H, size, off, horizontal));
    }
  });
});

describe('大きな値・多い要素の filter でも、すぐに終わる', () => {
  /** filter を付けた要素を組み、画素で計算した画像を返す (計算できなければ undefined)。かかった時間も返す */
  const run = (body: string, opts: { res?: number; attrs?: string } = {}) => {
    const t0 = performance.now();
    const d = parseSvg(svg(body, opts.attrs), parse, { approximateFilters: true, rasterFilter, filterResolution: opts.res ?? 1 });
    const ms = performance.now() - t0;
    const px = d?.shapes.find((x) => x.image?.pixels)?.image?.pixels;
    return { d, px, ms };
  };
  const at = (px: { width: number; rgba: Uint8Array }, x: number, y: number) => Array.from(px.rgba.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4));

  it('feMorphology の radius="1e308" は、領域の全体を見る半径として計算する (止まらなかった)', () => {
    const r = run('<filter id="f"><feMorphology operator="dilate" radius="1e308"/></filter><rect width="50" height="50" fill="#f00" filter="url(#f)"/>');
    expect(r.ms).toBeLessThan(5000);
    expect(r.px).toBeDefined();
    // 全体が、領域の中の最大 (赤) になる
    expect(at(r.px!, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(r.px!, r.px!.width - 1, r.px!.height - 1)).toEqual([255, 0, 0, 255]);
    // erode は、窓が外 (透明) を含むので、全体が透明
    const e = run('<filter id="f"><feMorphology radius="1e308"/></filter><rect width="50" height="50" filter="url(#f)"/>');
    expect(at(e.px!, 30, 30)[3]).toBe(0);
  });
  it('filter の領域が非常に小さく (画素への倍率が Infinity)、ぼかし・半径が限りなくなっても止まる', () => {
    for (const p of ['<feMorphology radius="1e308"/>', '<feGaussianBlur stdDeviation="5"/><feTurbulence baseFrequency="0.1"/>', '<feMorphology radius="0"/><feConvolveMatrix order="1" kernelMatrix="1"/>'])
      expect(run(`<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="1e-320" height="1e-320">${p}</filter><rect width="50" height="50" filter="url(#f)"/>`).ms).toBeLessThan(5000);
  });
  it('feTurbulence の numOctaves は 24 段で止める (結果は 24 段と同じ。100000 で 1 分を超えていた)', () => {
    const big = run('<filter id="f"><feTurbulence baseFrequency="0.05" numOctaves="100000"/></filter><rect width="50" height="50" filter="url(#f)"/>');
    expect(big.ms).toBeLessThan(5000);
    const k24 = run('<filter id="f"><feTurbulence baseFrequency="0.05" numOctaves="24"/></filter><rect width="50" height="50" filter="url(#f)"/>');
    expect(big.px!.rgba).toEqual(k24.px!.rgba);
  });
  it('feGaussianBlur・feDropShadow の大きな stdDeviation は、手間が画像の幅まで', () => {
    for (const p of ['<feGaussianBlur stdDeviation="1e6"/>', '<feDropShadow stdDeviation="1e7"/>', '<feGaussianBlur stdDeviation="1e300"/>']) {
      const r = run(`<filter id="f"><feMorphology radius="0.2"/>${p}</filter><rect width="50" height="50" filter="url(#f)"/>`, { res: 4 });
      expect(r.ms).toBeLessThan(5000);
    }
  });
  it('feConvolveMatrix の大きな order は、予算で抑える (解像度を下げるか、計算しない)', () => {
    const k = Array(40 * 40).fill('1').join(' ');
    const r = run(`<filter id="f"><feConvolveMatrix order="40" kernelMatrix="${k}"/></filter><rect width="400" height="400" fill="red" filter="url(#f)"/>`, { res: 4, attrs: 'width="400" height="400"' });
    expect(r.ms).toBeLessThan(15000);
  });
  it('参照されない名前付きの結果は持たない (result を付けた feOffset 200 個)', () => {
    const offs = Array.from({ length: 200 }, (_, i) => `<feOffset dx="${i % 3}" result="r${i}"/>`).join('');
    const r = run(`<filter id="f"><feTurbulence baseFrequency="0.05" result="t"/>${offs}</filter><rect width="400" height="400" fill="red" filter="url(#f)"/>`, { res: 4, attrs: 'width="400" height="400"' });
    expect(r.ms).toBeLessThan(15000);
    expect(r.px).toBeDefined();
  });
  it('同時に参照を待つ結果が多ければ、解像度を下げる (結果は持ったまま、正しく参照する)', () => {
    const offs = Array.from({ length: 50 }, (_, i) => `<feOffset in="SourceGraphic" dx="${i}" result="r${i}"/>`).join('');
    const nodes = Array.from({ length: 50 }, (_, i) => `<feMergeNode in="r${i}"/>`).join('');
    const r = run(`<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="10"><feConvolveMatrix order="1" kernelMatrix="1"/>${offs}<feMerge>${nodes}</feMerge></filter><rect width="2" height="10" fill="#00f" filter="url(#f)"/>`);
    expect(r.px).toBeDefined();
    // 0〜51 は、ずらした写しのどれかで塗られ、その先は透明
    expect(at(r.px!, 40, 5)).toEqual([0, 0, 255, 255]);
    expect(at(r.px!, 60, 5)[3]).toBe(0);
  });
  it('filter を付けた要素が多い SVG は、1 つの SVG の予算で抑える (続く filter は解像度を下げ、尽きたら計算しない)', () => {
    const els = Array.from({ length: 60 }, (_, i) => `<rect x="${(i % 10) * 20}" y="${Math.floor(i / 10) * 20}" width="20" height="20" fill="red" filter="url(#f)"/>`).join('');
    const r = run(`<filter id="f" x="-100" y="-100" width="600" height="600" filterUnits="userSpaceOnUse"><feFlood flood-color="red" flood-opacity="0.01"/><feComposite operator="arithmetic" k1="0" k2="1" k3="0" k4="0"/></filter>${els}`, { res: 4, attrs: 'width="400" height="400" viewBox="0 0 400 400"' });
    expect(r.ms).toBeLessThan(20000);
  });
  it('予算は、rasterFilter に渡した budget に足していく', () => {
    const budget: { used?: number } = {};
    const d = parseSvg(svg('<filter id="f"><feMorphology radius="1"/></filter><rect width="50" height="50" filter="url(#f)"/><rect y="50" width="50" height="50" filter="url(#f)"/>'), parse, {
      approximateFilters: true,
      rasterFilter: (q) => rasterFilter({ ...q, budget }),
      filterResolution: 1,
    });
    expect(d?.shapes.filter((x) => x.image?.pixels)).toHaveLength(2);
    expect(budget.used).toBeGreaterThan(0);
  });
  it('feImage が filter の付いた要素を指す入れ子 (8 段 × 4 個) も、予算で止まる', () => {
    let body = '';
    for (let k = 0; k < 7; k++) body += `<filter id="f${k}" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">${`<feImage href="#e${k + 1}"/>`.repeat(4)}<feMorphology radius="0.3"/></filter>`;
    body += '<filter id="f7" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><feFlood flood-color="red"/><feMorphology radius="0.3"/></filter><defs>';
    for (let k = 1; k < 8; k++) body += `<rect id="e${k}" width="100" height="100" filter="url(#f${k})"/>`;
    body += '</defs><rect width="100" height="100" filter="url(#f0)"/>';
    const r = run(body, { res: 4, attrs: 'width="100" height="100" viewBox="0 0 100 100"' });
    expect(r.ms).toBeLessThan(20000);
  });
});
