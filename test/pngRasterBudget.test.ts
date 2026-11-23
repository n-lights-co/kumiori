/**
 * PNG の画素化の手間と板の勘定:
 *  - 止まり点の多いグラデーションは、止まり点を二分で探す (1 画素の手間が止まり点の数に比例しない)。手間の勘定に log2 (止まり点の数) を足す
 *  - 同時に持つ板の上限は、広がる板を実際に広げた大きさで数える。広げると超える不透明度のグループの板は、そこまでを重ねてから続きを描く
 *  - 勘定が上限の近くにあっても、いちばん外の切り抜きは持つ (中を描く)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { stopSearchWork, stopSpan } from '../src/gradientStops';
import { ensureFonts, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
});
const decode = (b: Uint8Array) => PNG.sync.read(Buffer.from(b));
const px = (p: PNG, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
const near = (a: number[], b: number[], tol = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('グラデーションの止まり点を二分で探す', () => {
  it('先頭から順に探すのと同じ区間になる (同じ位置の止まり点・範囲の外も)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 1; n < 40; n++) {
      const off: number[] = [];
      for (let i = 0; i < n; i++) off.push(i ? off[i - 1] + (rnd() < 0.3 ? 0 : rnd()) : rnd() * 0.2);
      for (const inclusive of [false, true]) {
        const last = Math.max(0, n - 1 - (inclusive ? 1 : 0));
        const ts = [-1, 0, off[n - 1] + 1, ...off, ...off.map((o) => o + 1e-6), ...Array.from({ length: 20 }, () => rnd() * (off[n - 1] + 0.1))];
        for (const t of ts) {
          let i = 0;
          while (i < last && (inclusive ? off[i + 1] <= t : off[i + 1] < t)) i++;
          expect(stopSpan(last, (j) => off[j], t, inclusive)).toBe(i);
        }
      }
    }
  });

  it('止まり点を探す手間は、止まり点の数の log2 (16 個までは足さない)', () => {
    expect(stopSearchWork(2)).toBe(0);
    expect(stopSearchWork(16)).toBe(0);
    expect(stopSearchWork(17)).toBe(5);
    expect(stopSearchWork(4000)).toBe(12);
  });

  it('止まり点の多い細かい repeating-linear-gradient の箱も、2 色のグラデーションの箱と同じほどの時間で PNG に描く', async () => {
    // 1 つの箱の止まり点は 4,000 個 (cssGradient.ts の repeatStops の上限)。直す前は 1 画素ごとに先頭から探し、2 色の 10 倍以上かかった
    // (A4 の 300dpi で、この 40 個で 16 秒。2 色は 1 秒)。時間の揺れに強いように、同じ大きさの 2 色の箱と比べる
    const time = async (g: string) => {
      const r = await typeset(`<style>div { height: 10px; margin: 2px; background: ${g} }</style>` + '<div></div>'.repeat(30), { kind: 'html', loadFont });
      let best = Infinity;
      for (let k = 0; k < 2; k++) {
        const t = performance.now();
        await r.renderPageToPng(0, { dpi: 200 });
        best = Math.min(best, performance.now() - t);
      }
      expect(r.diagnostics.filter((d) => d.code.startsWith('png/'))).toEqual([]);
      return best;
    };
    const many = await time('repeating-linear-gradient(90deg, red 0, blue 0.02px, red 0.04px)');
    const two = await time('linear-gradient(90deg, red, blue)');
    expect(many / two).toBeLessThan(4);
  });
});

describe('PNG の板の勘定 (実際に広げた大きさで数える)', () => {
  // 300 × 225pt を 288dpi で 1200 × 900 画素 (108 万画素)
  const page = '@page { size: 300pt 225pt; margin: 0 } body { margin: 0 }';

  it('ページ全体より小さな上限でも、小さな不透明度の箱の入れ子は板に描く (中の重なりは濃くならない)', async () => {
    const html =
      `<style>${page} .o { opacity: 0.5 } p { background: #ff0000; width: 20pt; height: 20pt; margin: 0 }</style>` +
      '<div class="o"><div class="o"><p style="margin: 10pt 0 0 10pt"></p><p style="margin: -10pt 0 0 20pt"></p></div></div>';
    // 前は、板を作るときの描ける範囲 (ページ全体の 108 万画素) で数えたので、2 段目で上限 (200 万画素) を超え、中の図形ごとに不透明度を掛けていた
    const r = await typeset(html, { kind: 'html', loadFont, limits: { pngLayerPixels: 2_000_000 } });
    const out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toEqual([]);
    // 0.25 の赤。重なり (25〜30pt) も同じ
    const w = Math.round(255 * 0.75);
    expect(px(out, 60, 60)).toSatisfy((c: number[]) => near(c, [255, w, w], 3));
    expect(px(out, 110, 110)).toSatisfy((c: number[]) => near(c, [255, w, w], 3));
  });

  it('広げると上限を超える不透明度のグループの板は、そこまでを重ねてから続きを描き、警告を出す (中身を落とさない)', async () => {
    // 2 つの箱は、それぞれ 63 万画素 (上限の 80 万画素に収まる)、合わせた外接矩形は 108 万画素 (超える)
    const html =
      `<style>${page} .o { opacity: 0.5 } p { position: absolute; top: 0; background: #0000ff; width: 175pt; height: 225pt; margin: 0 }</style>` +
      '<div class="o"><p style="left: 0"></p><p style="left: 125pt"></p></div>';
    const r = await typeset(html, { kind: 'html', loadFont, limits: { pngLayerPixels: 800_000 } });
    const out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toHaveLength(1);
    // 両方の箱を、0.5 の青で描く。重なり (125〜175pt) は、2 つに分けて重ねたので 0.75
    const h = Math.round(255 * 0.5);
    expect(px(out, 100, 450)).toSatisfy((c: number[]) => near(c, [h, h, 255], 3));
    expect(px(out, 1100, 450)).toSatisfy((c: number[]) => near(c, [h, h, 255], 3));
    const q = Math.round(255 * 0.25);
    expect(px(out, 600, 450)).toSatisfy((c: number[]) => near(c, [q, q, 255], 3));
  });

  it('板を諦めて平らに描いた後の、そのページの小さな不透明度のグループは、板に描く (中の重なりは濃くならない)', async () => {
    // 1 つ目のグループ: ページ全体の白い箱 (108 万画素。上限の 50 万画素を超えて広げられず、板を諦めて平らに描く。白なので見た目は変わらない)。
    // 2 つ目: 重なる 20pt の赤い箱 2 つ。前は、1 つ目で止めた量 (0) が残り、2 つ目も平らに描いたので、重なりが濃くなった
    const html =
      `<style>${page} .o { opacity: 0.5 } p { background: #ff0000; width: 20pt; height: 20pt; margin: 0 }</style>` +
      '<div class="o" style="height: 0"><p style="width: 300pt; height: 225pt; background: #ffffff"></p></div>' +
      '<div class="o"><p style="margin: 100pt 0 0 100pt"></p><p style="margin: -10pt 0 0 110pt"></p></div>';
    const r = await typeset(html, { kind: 'html', loadFont, limits: { pngLayerPixels: 500_000 } });
    const out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    const h = Math.round(255 * 0.5);
    // 重ならない所 (105pt) と重なり (115pt) の、どちらも 0.5 の赤
    expect(px(out, 420, 420)).toSatisfy((c: number[]) => near(c, [255, h, h], 3));
    expect(px(out, 460, 460)).toSatisfy((c: number[]) => near(c, [255, h, h], 3));
  });

  it('勘定が上限の近くにあっても、いちばん外の切り抜きの中を描く', async () => {
    // ページの切り抜き (板の 1/4 の 27 万画素分) と、SVG の不透明度のグループの板 (ページ全体の 108 万画素。グループの中は、外の切り抜きを外して描く) の中の、
    // ページ全体に広がる円の切り抜き (27 万画素分)。上限は 150 万画素。前は、円の切り抜きの配列を勘定に入れられず、外側の切り抜きも無いので、中を描かなかった
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><defs><clipPath id="c"><circle cx="200" cy="150" r="250"/></clipPath></defs>' +
      '<g opacity="0.5"><rect width="400" height="300" fill="#ffffff"/><rect width="400" height="100" fill="#ff0000" clip-path="url(#c)"/></g></svg>';
    const html = `<style>${page}</style><img src="c.svg" style="display: block; width: 300pt; height: 225pt">`;
    const r = await typeset(html, { kind: 'html', loadFont, files: [{ name: 'c.svg', data: svg }], limits: { pngLayerPixels: 1_500_000 } });
    const out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    expect(r.diagnostics.filter((d) => d.code === 'png/clip-limit')).toEqual([]);
    const h = Math.round(255 * 0.5);
    expect(px(out, 600, 150)).toSatisfy((c: number[]) => near(c, [255, h, h], 3));
  });
});
