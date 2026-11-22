/**
 * ページを PNG にするときの、画素に戻した画像の覚えと上限 (src/pageRaster.ts の RasterImages) のテスト。
 *  - 同じ画像を置いたページを何枚描いても、画素に戻すのは 1 度 (ページをまたいで覚える)。覚えても絵は変わらない
 *  - 覚える画素の数の上限 (元の大きさのものから手放す)、1 ページで戻す画素の数の上限 (超えた画像は描かずに警告)
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { encodeJpeg } from '../src/jpeg';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { RasterImages } from '../src/pageRaster';
import { ensureFonts, fontDir } from './helpers';

/** JPEG を画素に戻した回数 */
const calls = vi.hoisted(() => ({ jpeg: 0 }));
vi.mock('../src/jpeg', async (orig) => {
  const m = await orig<typeof import('../src/jpeg')>();
  return { ...m, decodeJpeg: (b: Uint8Array) => (calls.jpeg++, m.decodeJpeg(b)) };
});

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

/** w × h の、横に色の変わる JPEG */
function jpeg(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) data.set([(i % w) % 256, 128, 255 - ((i / w) | 0) % 256], i * 3);
  return encodeJpeg({ width: w, height: h, components: 3, data });
}

/** 中身の無い w × h の画像 (戻す回数だけを数える) */
const fake = (w: number, h: number) => ({ w, h, rgba: new Uint8Array(w * h * 4).fill(255) });

describe('RasterImages', () => {
  it('同じ中身・同じ割合は 1 度だけ戻し、別の割合は覚えた元の大きさから縮める', () => {
    const r = new RasterImages();
    const bytes = new Uint8Array(1);
    let n = 0;
    const dec = () => (n++, fake(100, 80));
    const a = r.get(bytes, dec, () => 1);
    expect(r.get(bytes, dec, () => 1)).toBe(a);
    const half = r.get(bytes, dec, () => 2);
    expect(half).toMatchObject({ w: 50, h: 40 });
    expect(r.get(bytes, dec, () => 2)).toBe(half);
    expect(n).toBe(1);
    // 戻した 8,000 画素と、覚えた元の大きさから縮め直した 8,000 画素
    expect(r.decoded).toBe(16_000);
  });
  it('戻せない画像は null (2 度目は戻そうとしない)', () => {
    const r = new RasterImages();
    let n = 0;
    const bytes = new Uint8Array(1);
    expect(r.get(bytes, () => (n++, undefined), () => 1)).toBeNull();
    expect(r.get(bytes, () => (n++, undefined), () => 1)).toBeNull();
    expect(n).toBe(1);
  });
  it('覚える上限を超えたら、元の大きさのものから手放す (縮めたものは残す)。手放した元の大きさは、要れば戻し直す', () => {
    const r = new RasterImages(10_000);
    const b1 = new Uint8Array([1]);
    const b2 = new Uint8Array([2]);
    let n = 0;
    const dec = () => (n++, fake(100, 80));
    r.get(b1, dec, () => 4);
    r.get(b2, dec, () => 4);
    // 元の大きさ (8,000 画素) は、2 つ目を覚えたときに 1 つ目を手放す。描き終えたら上限まで手放す
    r.trim();
    expect(r.total).toBeLessThanOrEqual(10_000);
    expect(n).toBe(2);
    // 縮めたものは覚えている (戻し直さない)
    r.get(b1, dec, () => 4);
    r.get(b2, dec, () => 4);
    expect(n).toBe(2);
    // 元の大きさは戻し直す
    r.get(b1, dec, () => 1);
    expect(n).toBe(3);
  });
  it('1 ページで戻す画素の数の上限を超えたら、それより後の画像は戻さずに limit (覚えているものは使える)', () => {
    const r = new RasterImages(Infinity, 20_000);
    let n = 0;
    const dec = () => (n++, fake(100, 100));
    const bs = Array.from({ length: 4 }, (_, i) => new Uint8Array([i]));
    expect(r.get(bs[0], dec, () => 1)).toMatchObject({ w: 100 });
    expect(r.get(bs[1], dec, () => 1)).toMatchObject({ w: 100 });
    expect(r.get(bs[2], dec, () => 1)).toBe('limit');
    expect(r.get(bs[0], dec, () => 1)).toMatchObject({ w: 100 });
    // 覚えた元の大きさから縮め直すのも、上限を超えた後はしない
    expect(r.get(bs[0], dec, () => 2)).toBe('limit');
    expect(n).toBe(2);
    // 次のページ (戻した数を 0 に戻す) では、また戻せる
    r.decoded = 0;
    expect(r.get(bs[3], dec, () => 1)).toMatchObject({ w: 100 });
  });
});

describe('RasterImages の鍵と手放し方', () => {
  it('中身で引く: 同じ中身の別のバイト列 (ページごとに読み直した SVG の中の data: の画像) も当たる。違う中身は当たらない', () => {
    const r = new RasterImages();
    let n = 0;
    const dec = () => (n++, fake(10, 10));
    const a = new Uint8Array([1, 2, 3, 4]);
    r.get(a, dec, () => 1);
    r.get(new Uint8Array([1, 2, 3, 4]), dec, () => 1);
    r.get(Uint8Array.from(a), dec, () => 2);
    expect(n).toBe(1);
    r.get(new Uint8Array([1, 2, 3, 5]), dec, () => 1);
    expect(n).toBe(2);
  });
  /** 長さも FNV-1a (32 ビット) の散らし値も同じで、中身の違う 2 つのバイト列 (鍵がぶつかる) */
  const clashA = new Uint8Array([190, 97, 33, 45, 37, 148]);
  const clashB = new Uint8Array([148, 183, 150, 198, 112, 209]);
  it('覚えから手放した中身の項目は消す (手放した中身と鍵のぶつかる画像も、覚えて使い回す)', () => {
    // 手放した後も項目が残ると、鍵のぶつかる別の中身は「散らし値が同じで中身の違う画像」として覚えずに、引くたびに戻し直す
    const r = new RasterImages(1000);
    r.get(clashA, () => fake(10, 10), () => 1);
    for (let i = 0; i < 20; i++) r.get(new Uint8Array([i, 7]), () => fake(10, 10), () => 1);
    r.trim();
    expect(r.total).toBeLessThanOrEqual(1000);
    let n = 0;
    const dec = () => (n++, fake(10, 10));
    r.get(clashB, dec, () => 1);
    r.get(clashB, dec, () => 1);
    expect(n).toBe(1);
  });
  it('覚えから手放した中身のバイト列は持ち続けない (手放した後は、ほかから参照が無ければ消える)', async () => {
    // ゴミ集めを呼べるようにする (Node の --expose-gc を、実行の途中で入れる)
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const r = new RasterImages(1000);
    const refs: WeakRef<Uint8Array>[] = [];
    for (let i = 0; i < 50; i++) {
      const b = new Uint8Array([i, 7]);
      refs.push(new WeakRef(b));
      r.get(b, () => fake(10, 10), () => 1);
    }
    r.trim();
    // WeakRef は、作った仕事 (job) の終わりまで中身を保つので、次の仕事に移ってから集める
    await new Promise((res) => setTimeout(res, 0));
    gc();
    // 覚えに残っている (上限 1,000 画素 = 10 枚) もの以外は、消えている
    expect(refs.filter((w) => w.deref() !== undefined).length).toBeLessThanOrEqual(10);
  });
  it('戻せなかった画像は中身で覚える (鍵のぶつかる正しい画像は描く)', () => {
    const r = new RasterImages();
    expect(r.get(clashA, () => undefined, () => 1)).toBeNull();
    expect(r.get(clashB, () => fake(10, 10), () => 1)).toMatchObject({ w: 10 });
    // 戻せなかった方は、同じ中身の別のバイト列でも、2 度目は戻そうとしない
    let n = 0;
    expect(r.get(Uint8Array.from(clashA), () => (n++, undefined), () => 1)).toBeNull();
    expect(n).toBe(0);
  });
  it('覚えた元の大きさから縮め直す元の画素の数も、1 ページで戻す画素の数に数える (戻したばかりの元の大きさを縮めるのは数えない)', () => {
    const r = new RasterImages(Infinity, 25_000);
    let n = 0;
    const b = new Uint8Array([3]);
    const dec = () => (n++, fake(100, 100));
    // 戻して縮める: 戻した 1 万画素だけ
    expect(r.get(b, dec, () => 2)).toMatchObject({ w: 50 });
    expect(r.decoded).toBe(10_000);
    // 覚えた大きさは数えない
    r.get(b, dec, () => 2);
    expect(r.decoded).toBe(10_000);
    // 別の大きさに縮め直す: 元の 1 万画素ずつ。上限を超えた後は limit
    expect(r.get(b, dec, () => 3)).toMatchObject({ w: 33 });
    expect(r.get(b, dec, () => 4)).toMatchObject({ w: 25 });
    expect(r.decoded).toBe(30_000);
    expect(r.get(b, dec, () => 5)).toBe('limit');
    expect(n).toBe(1);
    // 次のページでは、また縮められる
    r.decoded = 0;
    expect(r.get(b, dec, () => 5)).toMatchObject({ w: 20 });
  });
  it('縮めたものを覚えるために上限を超えて残した元の大きさは、別の画像を戻す前に手放す。手放した縮めたものは、元の大きさの覚えからも外す', () => {
    const r = new RasterImages(10_000);
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    let aImg: ReturnType<typeof fake> | undefined;
    // a: 元の大きさ 1 万画素 + 縮めたもの 2,500 画素で、上限を超えて持つ
    r.get(a, () => (aImg = fake(100, 100)), () => 2);
    expect(r.total).toBe(12_500);
    // b を戻すとき、戻す前に a の元の大きさを手放している
    let before = -1;
    r.get(b, () => ((before = r.total), fake(100, 100)), () => 1);
    expect(before).toBe(2_500);
    expect(r.total).toBe(10_000);
    // 元の大きさを残したまま縮めたものを手放すと、元の大きさの画像の覚え (reduced) からも外す
    const r2 = new RasterImages(12_000);
    r2.get(a, () => (aImg = fake(100, 100)), () => 2);
    r2.get(a, () => fake(100, 100), () => 3);
    expect(r2.total).toBe(10_000 + 33 * 33);
    expect([...((aImg as { reduced?: Map<number, unknown> }).reduced?.keys() ?? [])]).toEqual([3]);
  });
  it('同じ画像を 1 ページに違う大きさで何度も置いても、縮めたものを覚えるために元の大きさを手放さない (戻すのは 1 度)', () => {
    // 覚える上限は元の大きさ 1 枚分。縮めたものを足すと超えるが、元の大きさは、縮めたものの方を手放して残す
    // (縮め直す元の画素は 1 ページで戻す画素の数に数えるので、その上限は掛けない)
    const r = new RasterImages(10_000, Infinity);
    let n = 0;
    const b = new Uint8Array([9]);
    for (let f = 2; f <= 40; f++) expect(r.get(b, () => (n++, fake(100, 100)), () => f)).toMatchObject({ w: Math.floor(100 / f) });
    expect(n).toBe(1);
  });
});

describe('renderPageToPng の画像の覚え', () => {
  const big = jpeg(1200, 900);
  const doc = (pages: number) =>
    `<!DOCTYPE html><html><head><style>@page { size: 200pt 150pt; margin: 0; background: url(big.jpg) 0 0 / 100% 100% } p { break-after: page; margin: 0 }
     img { width: 30pt; height: 20pt }</style></head><body>${Array.from({ length: pages }, (_, i) => `<p>${i + 1} <img src="big.jpg"></p>`).join('')}</body></html>`;

  it('同じ画像を置いたページを何枚描いても、画素に戻すのは 1 度。覚えても、覚えずに描いたものと同じ画素', async () => {
    const r = await typeset(doc(6), { kind: 'html', loadFont, files: [{ name: 'big.jpg', data: big }] });
    expect(r.pageCount).toBe(6);
    calls.jpeg = 0;
    const pngs: Uint8Array[] = [];
    for (let i = 0; i < 6; i++) pngs.push(await r.renderPageToPng(i, { dpi: 72 }));
    expect(calls.jpeg).toBe(1);
    // 覚えの無い結果で描いたものと同じ (縮める割合ごとに覚えるので、縮め方も同じ)
    for (const i of [0, 5]) {
      const fresh = await typeset(doc(6), { kind: 'html', loadFont, files: [{ name: 'big.jpg', data: big }] });
      expect(Buffer.from(await fresh.renderPageToPng(i, { dpi: 72 })).equals(Buffer.from(pngs[i]))).toBe(true);
    }
    // 別の解像度でも、戻し直さない (元の大きさから縮め直す)
    calls.jpeg = 0;
    await r.renderPageToPng(2, { dpi: 150 });
    expect(calls.jpeg).toBe(0);
  });
});
