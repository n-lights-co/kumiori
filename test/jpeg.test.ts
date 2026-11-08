/**
 * jpeg.ts のテスト: T.81 の表、基本の逐次の符号化と復号の往復、縮小 (shrinkJpeg)、扱わない形式。
 * (漸進・再開の印・4:2:2 などの復号は、PIL (libjpeg-turbo) で作った JPEG を読み、PIL の画素と ±3 以内であることを手元で確かめた)
 */
import { describe, expect, it } from 'vitest';
import { decodeJpeg, downscale, encodeJpeg, jpegInfo, shrinkJpeg, type JpegPixels } from '../src/jpeg';
import { AC_CHROMA, AC_LUMA, DC_CHROMA, DC_LUMA, UNZIGZAG, ZIGZAG } from '../src/jpegTables';

/** なめらかな色の画像 */
const smooth = (w: number, h: number, components: 1 | 3 = 3): JpegPixels => {
  const data = new Uint8Array(w * h * components);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * components;
      data[o] = 128 + 120 * Math.sin(x / 23);
      if (components === 3) {
        data[o + 1] = 128 + 120 * Math.cos(y / 17);
        data[o + 2] = 128 + 100 * Math.sin((x + y) / 31);
      }
    }
  return { width: w, height: h, components, data };
};
const psnr = (a: Uint8Array, b: Uint8Array) => {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
  return 10 * Math.log10((255 * 255) / (se / a.length));
};

describe('JPEG の表 (T.81)', () => {
  it('ジグザグ順は 0〜63 の並べ替えで、UNZIGZAG はその逆', () => {
    expect([...ZIGZAG].sort((a, b) => a - b)).toEqual([...Array(64).keys()]);
    for (let i = 0; i < 64; i++) expect(UNZIGZAG[ZIGZAG[i]]).toBe(i);
    // Figure A.6 の 2 行目の左端は 2、最後の行の左端は 35
    expect(ZIGZAG[8]).toBe(2);
    expect(ZIGZAG[56]).toBe(35);
  });
  it('ハフマン表の符号の数は、値の数と一致する (DC 12・AC 162)', () => {
    for (const [t, n] of [[DC_LUMA, 12], [DC_CHROMA, 12], [AC_LUMA, 162], [AC_CHROMA, 162]] as const) {
      expect(t.bits.reduce((a, b) => a + b, 0)).toBe(n);
      expect(t.values).toHaveLength(n);
      expect(new Set(t.values).size).toBe(n);
    }
  });
});

describe('符号化と復号', () => {
  it('RGB (4:2:0) を書いて読み戻すと、元の画像に近い', () => {
    const px = smooth(301, 203);
    const jpg = encodeJpeg(px);
    expect(jpegInfo(jpg)).toMatchObject({ width: 301, height: 203, components: 3, precision: 8, process: 0 });
    expect(jpegInfo(jpg)?.adobe).toBeUndefined();
    const back = decodeJpeg(jpg)!;
    expect(back).toMatchObject({ width: 301, height: 203, components: 3 });
    expect(psnr(back.data, px.data)).toBeGreaterThan(40);
  });
  it('濃淡 (1 成分)・端の半端な大きさ', () => {
    const px = smooth(37, 23, 1);
    const back = decodeJpeg(encodeJpeg(px))!;
    expect(back.components).toBe(1);
    expect(psnr(back.data, px.data)).toBeGreaterThan(40);
  });
  it('壊れたデータ・JPEG でないものは undefined', () => {
    const jpg = encodeJpeg(smooth(64, 64));
    // 途中で切れたデータでも例外を投げない
    expect(() => decodeJpeg(jpg.subarray(0, 200))).not.toThrow();
    expect(decodeJpeg(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(jpegInfo(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined();
  });
  it('面積の平均で縮める', () => {
    const px: JpegPixels = { width: 4, height: 2, components: 1, data: Uint8Array.from([0, 100, 200, 40, 0, 100, 200, 40]) };
    expect([...downscale(px, 2, 1).data]).toEqual([50, 120]);
  });
});

describe('shrinkJpeg', () => {
  const big = encodeJpeg(smooth(1200, 800), { quantScale: 0.2 });
  it('置かれる大きさに対して細かすぎる画像を、上限の解像度に縮める', () => {
    // 幅 144pt (2 インチ) に 1200 画素 = 600dpi → 150dpi なら 300 画素
    const out = shrinkJpeg(big, 144, 96, 150)!;
    expect(out.length).toBeLessThan(big.length);
    expect(jpegInfo(out)).toMatchObject({ width: 300, height: 200 });
  });
  /** APP14 (TN #5116 §18: 長さ・"Adobe"・版・flags0・flags1・色の変換の符号) を SOI の直後に入れる */
  const withAdobe = (jpg: Uint8Array, flags1: number, transform: number) => {
    const app14 = Uint8Array.from([0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, flags1 >> 8, flags1 & 255, transform]);
    const out = new Uint8Array(jpg.length + app14.length);
    out.set(jpg.subarray(0, 2));
    out.set(app14, 2);
    out.set(jpg.subarray(2), 2 + app14.length);
    return out;
  };
  it('上限より粗い画像はそのまま (undefined)', () => {
    expect(shrinkJpeg(big, 144, 96, 600)).toBeUndefined();
  });
  it('APP14 の色の変換の符号 1 (YCbCr) は縮める。flags1 に 1 のビットがあるもの・知らない符号はそのまま', () => {
    expect(jpegInfo(withAdobe(big, 0, 1))?.adobe).toEqual({ flags1: 0, transform: 1 });
    expect(jpegInfo(shrinkJpeg(withAdobe(big, 0, 1), 144, 96, 150)!)).toMatchObject({ width: 300, height: 200 });
    expect(shrinkJpeg(withAdobe(big, 1, 1), 144, 96, 150)).toBeUndefined();
    expect(shrinkJpeg(withAdobe(big, 0, 2), 144, 96, 150)).toBeUndefined();
  });
  it('APP14 の色の変換の符号 0: 3 つの成分を、そのまま R・G・B として読む', () => {
    const px = smooth(64, 48);
    const back = decodeJpeg(withAdobe(encodeJpeg(px), 0, 0))!;
    // 符号化した成分は Y・Cb・Cr なので、読んだ「R」は元の画像の輝度になる
    const lum = new Uint8Array(64 * 48);
    const red = new Uint8Array(64 * 48);
    for (let i = 0; i < 64 * 48; i++) {
      lum[i] = Math.round(0.299 * px.data[3 * i] + 0.587 * px.data[3 * i + 1] + 0.114 * px.data[3 * i + 2]);
      red[i] = back.data[3 * i];
    }
    expect(psnr(red, lum)).toBeGreaterThan(40);
  });
});
