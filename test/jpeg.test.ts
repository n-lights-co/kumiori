/**
 * jpeg.ts のテスト: T.81 の表、基本の逐次の符号化と復号の往復、縮小 (shrinkJpeg)、扱わない形式、
 * 漸進 (SOF2)・再開の印 (DRI・RSTn)・4:2:2 などの標本化の復号 (入力は test/jpegStream.ts で、テストの中で組み立てる)。
 * (漸進・再開の印・4:2:2 などの復号は、PIL (libjpeg-turbo) で作った JPEG を読み、PIL の画素と ±3 以内であることも手元で確かめた)
 */
import { describe, expect, it } from 'vitest';
import { decodeJpeg, downscale, encodeJpeg, jpegInfo, shrinkJpeg, type JpegPixels } from '../src/jpeg';
import { AC_CHROMA, AC_LUMA, DC_CHROMA, DC_LUMA, UNZIGZAG, ZIGZAG } from '../src/jpegTables';
import { progressiveScans, quantize, writeJpeg } from './jpegStream';

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

describe('標本化・再開の印・漸進 (テストの中で組み立てた符号)', () => {
  /** なめらかな色に、輝度の細かい模様 (左上) と点を足した画像。高い周波数の係数・0 の長い連なり・係数が全部 0 の区画の連なりができる */
  const textured = (w: number, h: number, components: 1 | 3 = 3): JpegPixels => {
    const px = smooth(w, h, components);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = x < w / 3 && y < h / 2 ? (rnd() % 81) - 40 : x % 13 === 5 && y % 11 === 3 ? 90 : 0;
        for (let c = 0; c < components; c++) {
          const o = (y * w + x) * components + c;
          px.data[o] = Math.max(0, Math.min(255, px.data[o] + d));
        }
      }
    return px;
  };
  /** b の中の印 (0xFF と m) の数。符号のデータの中の 0xFF は、0x00 が続く (F.1.2.3) ので、印と重ならない */
  const markers = (b: Uint8Array, test: (m: number) => boolean) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff && test(b[i + 1])) out.push(b[i + 1]);
    return out;
  };
  const isRst = (m: number) => m >= 0xd0 && m <= 0xd7;
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
  const newStats = () => ({ zrl: 0, maxEobRun: 0, rst: 0, refineBits: 0 });

  it.each([
    ['4:4:4', [[1, 1], [1, 1], [1, 1]]],
    ['4:2:2 (横だけ半分)', [[2, 1], [1, 1], [1, 1]]],
    ['4:4:0 (縦だけ半分)', [[1, 2], [1, 1], [1, 1]]],
    ['4:2:0', [[2, 2], [1, 1], [1, 1]]],
    ['4:1:1 (横を 1/4)', [[4, 1], [1, 1], [1, 1]]],
  ] as [string, [number, number][]][])('標本化 %s の逐次の JPEG を読むと、元の画像に近い (端の半端な大きさ)', (_name, sampling) => {
    // 幅・高さとも、MCU (4:1:1 は 32×8、4:2:0 は 16×16) の倍数でない大きさ
    const px = smooth(83, 45);
    const jpg = writeJpeg(quantize(px, sampling));
    expect(jpegInfo(jpg)).toMatchObject({ width: 83, height: 45, components: 3, precision: 8, process: 0 });
    const back = decodeJpeg(jpg)!;
    expect(back).toMatchObject({ width: 83, height: 45, components: 3 });
    expect(back.data).toHaveLength(83 * 45 * 3);
    expect(psnr(back.data, px.data)).toBeGreaterThan(38);
  });

  it('4:2:2 は、輝度を間引かない (横に細かい輝度の縞が残る)。色差は横だけ半分', () => {
    // 1 画素ごとの白黒の縦縞 (輝度だけ)。輝度が横に間引かれていれば、縞は灰色につぶれる
    const px: JpegPixels = { width: 32, height: 16, components: 3, data: new Uint8Array(32 * 16 * 3) };
    for (let i = 0; i < 32 * 16; i++) px.data.fill(i % 2 ? 235 : 20, 3 * i, 3 * i + 3);
    const back = decodeJpeg(writeJpeg(quantize(px, [[2, 1], [1, 1], [1, 1]])))!;
    expect(psnr(back.data, px.data)).toBeGreaterThan(38);
  });

  it.each([1, 3] as const)('再開の印 (DRI・RSTn): 成分 %d つ。再開の間隔があっても、同じ係数からは同じ画素', (n) => {
    const px = textured(83, 45, n);
    const img = quantize(px, n === 1 ? [[1, 1]] : [[2, 2], [1, 1], [1, 1]]);
    const mcus = img.mcusX * img.mcusY;
    const plain = decodeJpeg(writeJpeg(img))!;
    expect(psnr(plain.data, px.data)).toBeGreaterThan(30);
    for (const ri of [1, 4, mcus - 1, mcus, 65535]) {
      const stats = newStats();
      const jpg = writeJpeg(img, { restart: ri, stats });
      // 再開の印は、間隔ごとに 1 つ (最後の間隔の後には無い)。番号は 0〜7 を巡る (B.1.1.3 の RSTm・E.1.4)
      const rst = markers(jpg, isRst);
      expect(rst).toHaveLength(Math.ceil(mcus / ri) - 1);
      expect(rst).toEqual(rst.map((_, i) => 0xd0 + (i % 8)));
      expect(markers(jpg, (m) => m === 0xdd)).toHaveLength(1);
      const back = decodeJpeg(jpg)!;
      expect(same(back.data, plain.data)).toBe(true);
    }
  });

  it.each([
    ['濃淡', 1, [[1, 1]]],
    ['4:2:0', 3, [[2, 2], [1, 1], [1, 1]]],
    ['4:2:2', 3, [[2, 1], [1, 1], [1, 1]]],
  ] as [string, 1 | 3, [number, number][]][])('漸進 (SOF2) %s: スペクトルの分割と逐次近似の走査を全部読むと、逐次と同じ画素', (_name, n, sampling) => {
    // 83 × 45: 成分 1 つの走査の区画の数 (標本の数から) が、MCU ごとの走査の区画の数より少ない大きさ (A.2.2・A.2.3)
    const px = textured(83, 45, n);
    const img = quantize(px, sampling);
    const sequential = decodeJpeg(writeJpeg(img))!;
    const stats = newStats();
    const scans = progressiveScans(n);
    const jpg = writeJpeg(img, { scans, stats });
    expect(jpegInfo(jpg)).toMatchObject({ width: 83, height: 45, components: n, precision: 8, process: 2 });
    expect(markers(jpg, (m) => m === 0xda)).toHaveLength(scans.length);
    // この入力は、0 の 16 個の連なり (ZRL)・EOB の連なり (EOBn)・訂正のビットの道を通る
    expect(stats.zrl).toBeGreaterThan(0);
    expect(stats.maxEobRun).toBeGreaterThan(1);
    expect(stats.refineBits).toBeGreaterThan(0);
    const back = decodeJpeg(jpg)!;
    expect(back).toMatchObject({ width: 83, height: 45, components: n });
    expect(same(back.data, sequential.data)).toBe(true);
    expect(psnr(back.data, px.data)).toBeGreaterThan(30);
  });

  it('漸進 + 再開の印: 走査ごとに、再開の間隔で EOB の連なりと DC の予測を切っても、同じ画素', () => {
    const px = textured(83, 45);
    const img = quantize(px, [[2, 2], [1, 1], [1, 1]]);
    const sequential = decodeJpeg(writeJpeg(img))!;
    for (const ri of [1, 5]) {
      const stats = newStats();
      const jpg = writeJpeg(img, { scans: progressiveScans(3), restart: ri, stats });
      expect(stats.rst).toBeGreaterThan(0);
      expect(markers(jpg, isRst)).toHaveLength(stats.rst);
      expect(same(decodeJpeg(jpg)!.data, sequential.data)).toBe(true);
    }
  });

  it('漸進の走査の途中まで (DC の最初の走査だけ) でも、粗い画像になる', () => {
    const px = smooth(83, 45);
    const img = quantize(px, [[2, 2], [1, 1], [1, 1]]);
    const scans = progressiveScans(3);
    const full = decodeJpeg(writeJpeg(img, { scans }))!;
    const coarse = decodeJpeg(writeJpeg(img, { scans: scans.slice(0, 1) }))!;
    expect(coarse).toMatchObject({ width: 83, height: 45, components: 3 });
    // DC だけ (区画ごとの平均) なので、全部の走査を読んだものより粗いが、画像の大まかな形はある
    expect(psnr(coarse.data, px.data)).toBeLessThan(psnr(full.data, px.data));
    expect(psnr(coarse.data, px.data)).toBeGreaterThan(20);
  });

  it('shrinkJpeg: 漸進・4:2:2・再開の印のある JPEG も、縮めて基本の逐次に書き直す', () => {
    const jpg = writeJpeg(quantize(textured(96, 64), [[2, 1], [1, 1], [1, 1]]), { scans: progressiveScans(3), restart: 3 });
    // 幅 14.4pt (0.2 インチ) に 96 画素 = 480dpi → 120dpi なら 24 画素
    const out = shrinkJpeg(jpg, 14.4, 9.6, 120)!;
    expect(jpegInfo(out)).toMatchObject({ width: 24, height: 16, components: 3, process: 0 });
  });
});
