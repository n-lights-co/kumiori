import { describe, expect, it } from 'vitest';
import { cgmToSvg } from '../src/cgm';
import { METAFILE_FREE_PIXELS, METAFILE_PIXELS_PER_BYTE, METAFILE_TOTAL_IMAGE_PIXELS, metafilePixelBudget } from '../src/imageLimits';
import { emfToSvg, wmfToSvg } from '../src/metafile';
import { cgmCellRuns, cgmTiles, emfRle, wmfRle } from './metafileExpansionInputs';

/**
 * 連長の符号 (RLE の DIB・CELL ARRAY の連なり・タイルの並び) で、数百バイトのファイルから大きな画像を作らせない (IMG-18)。
 * 画素にできる数は、ファイルの大きさに応じた上限 (imageLimits.ts の metafilePixelBudget) まで。
 * 早く・小さく終わることは、作った画像の数・寸法と SVG の長さで確かめる (時間の差は測らない)
 */

/** 直す前は、1 つの場合に数秒〜10 秒と数百 MB を使う (上限いっぱいの 8000 × 8000 なら、1 分あまりと 1.7GB。タイルの並びはヒープを使い切って落ちる) */
const T = { timeout: 120_000 };

/** SVG の中の PNG (data: の URI) の幅と高さ (IHDR) */
const pngSizes = (svg: string) =>
  [...svg.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => {
    const b = Uint8Array.from(atob(m[1].slice(0, 44)), (c) => c.charCodeAt(0));
    const v = new DataView(b.buffer);
    return [v.getUint32(16), v.getUint32(20)];
  });

describe('メタファイル・CGM: 画素にできる数は、ファイルの大きさに応じた上限まで (IMG-18)', () => {
  it('上限の値: ファイルの大きさに依らない分 + 1 バイトあたりの分。合計の上限は超えない', () => {
    expect(metafilePixelBudget(0)).toBe(METAFILE_FREE_PIXELS);
    expect(metafilePixelBudget(300)).toBe(METAFILE_FREE_PIXELS + 300 * METAFILE_PIXELS_PER_BYTE);
    expect(metafilePixelBudget(1 << 30)).toBe(METAFILE_TOTAL_IMAGE_PIXELS);
    // 数百バイトのファイルが作れる画素は、合計の上限の 1/20 より少ない (500 バイトで約 77 万画素)
    expect(metafilePixelBudget(500)).toBeLessThan(METAFILE_TOTAL_IMAGE_PIXELS / 20);
    // 上限いっぱいの画像 (A0 判を 200dpi で走査した図面) は、64KB のファイルなら入る
    expect(metafilePixelBudget(64 * 1024)).toBe(METAFILE_TOTAL_IMAGE_PIXELS);
  });

  // 3000 × 3000 = 900 万画素。合計の上限 (6,400 万画素) よりは小さいので、直す前は画像を作る (SVG が 4,800 万字)
  const N = 3000;
  it('EMF: 220 バイトの RLE8 の DIB (画素は「画像の終わり」だけ) から、900 万画素の画像を作らない', T, () => {
    const b = emfRle(N, N);
    expect(b.length).toBeLessThan(300);
    expect(N * N).toBeGreaterThan(metafilePixelBudget(b.length));
    const svg = emfToSvg(b)!;
    expect(pngSizes(svg)).toEqual([]);
    expect(svg.length).toBeLessThan(1000);
  });
  it('WMF: 104 バイトの RLE8 の DIB から、900 万画素の画像を作らない', T, () => {
    const b = wmfRle(N, N);
    expect(b.length).toBeLessThan(300);
    const svg = wmfToSvg(b)!;
    expect(pngSizes(svg)).toEqual([]);
    expect(svg.length).toBeLessThan(1000);
  });
  it('CGM: 連なりの符号の CELL ARRAY (1 行が 1 組) から、900 万画素の画像を作らない。警告に出し、後ろの図形は描く', T, () => {
    // 140,625 × 64 = 900 万セル。1 行は 6 バイト (数 32 ビット + 色 8 ビット + 語の境目)
    const b = cgmCellRuns((N * N) / 64, 64);
    expect(b.length).toBeLessThan(500);
    expect(cgmToSvg(b)).toBeUndefined(); // (描くものが無い)
    // 後ろに折れ線を足す (END PICTURE の前に入れる: 末尾の END PICTURE・END METAFILE の 4 バイトの前)
    const line = [0x40, 0x28, 0, 0, 0, 0, 0, 10, 0, 10]; // POLYLINE (0,0)-(10,10)
    const withLine = new Uint8Array([...b.subarray(0, b.length - 4), ...line, ...b.subarray(b.length - 4)]);
    const r = cgmToSvg(withLine)!;
    expect(pngSizes(r.svg)).toEqual([]);
    expect(r.svg).toContain('<path');
    expect(r.svg.length).toBeLessThan(1000);
    expect(r.warnings.join()).toMatch(/CELL ARRAY は、文書の画像の画素の合計が上限 \(\d+ バイトのファイルでは \d+ 画素\) を超えるので描きません/);
  });
  it('CGM: 72 バイトのタイルの並び (全部が背景の色のタイル 1 枚) から、900 万画素の画像を作らない。警告に出す', T, () => {
    const b = cgmTiles(N, N);
    expect(b.length).toBeLessThan(100);
    const r = cgmToSvg(b);
    expect(r).toBeUndefined(); // (描くものが無い)
    const line = [0x40, 0x28, 0, 0, 0, 0, 0, 10, 0, 10];
    const r2 = cgmToSvg(new Uint8Array([...b.subarray(0, b.length - 4), ...line, ...b.subarray(b.length - 4)]))!;
    expect(pngSizes(r2.svg)).toEqual([]);
    expect(r2.warnings.join()).toContain('タイルの並び は、文書の画像の画素の合計が上限');
  });

  it('上限の中の画像は、これまでどおり描く (ファイルの大きさに依らない分・ファイルの大きさに応じた分)', T, () => {
    // 512 × 512 は、どんなに小さなファイルでも描く
    expect(pngSizes(emfToSvg(emfRle(512, 512))!)).toEqual([[512, 512]]);
    expect(pngSizes(wmfToSvg(wmfRle(512, 512))!)).toEqual([[512, 512]]);
    expect(pngSizes(cgmToSvg(cgmTiles(512, 512))!.svg)).toEqual([[512, 512]]);
    expect(pngSizes(cgmToSvg(cgmCellRuns(4096, 64))!.svg)).toEqual([[4096, 64]]);
    // 1200 × 1200 = 144 万画素: 220 バイトの EMF (上限 約 49 万画素) では描かず、同じ画像でも、ほかの記録のある 2KB あまりのファイル (上限 約 258 万画素) なら描く
    expect(1200 * 1200).toBeGreaterThan(metafilePixelBudget(emfRle(1200, 1200).length));
    expect(pngSizes(emfToSvg(emfRle(1200, 1200))!)).toEqual([]);
    expect(pngSizes(emfToSvg(emfRle(1200, 1200, 2048))!)).toEqual([[1200, 1200]]);
    expect(pngSizes(wmfToSvg(wmfRle(1200, 1200))!)).toEqual([]);
    expect(pngSizes(wmfToSvg(wmfRle(1200, 1200, 2048))!)).toEqual([[1200, 1200]]);
    expect(cgmToSvg(cgmTiles(1200, 1200))).toBeUndefined();
    expect(pngSizes(cgmToSvg(cgmTiles(1200, 1200, 2048))!.svg)).toEqual([[1200, 1200]]);
  });
});
