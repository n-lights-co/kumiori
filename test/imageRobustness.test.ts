import { describe, expect, it } from 'vitest';
import { decodeModifiedHuffman } from '../src/ccitt';
import { imageInfo } from '../src/imageInfo';
import { decodeJpeg } from '../src/jpeg';

/**
 * 画像の復号器 (JPEG・TIFF・CCITT) が、細工した小さな入力で、止まらない・落ちない・メモリを使い切らない。
 * 止まらないことは、結果と vitest の制限時間で確かめる (時間の差は測らない)
 */

/** 止まる入力のテストの制限時間 (直す前は、どれも分の単位か、プロセスが落ちる) */
const T = { timeout: 30_000 };

describe('JPEG・TIFF・CCITT: 細工した入力 (IMG-09・IMG-10・IMG-14)', () => {
  const be16 = (v: number) => [(v >> 8) & 255, v & 255];
  const seg = (m: number, d: number[]) => [0xff, m, ...be16(d.length + 2), ...d];
  /** 2000 × 2000・1 成分の漸進の JPEG に、データの無い走査 (SOS) を n 個 */
  const jpegWithScans = (n: number, restart = 0) => {
    const head = [0xff, 0xd8, ...seg(0xdb, [0, ...new Array(64).fill(1)]), ...seg(0xc2, [8, ...be16(2000), ...be16(2000), 1, 1, 0x11, 0]), ...seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0])];
    const sos = [...(restart ? seg(0xdd, be16(restart)) : []), ...seg(0xda, [1, 1, 0x00, 0, 0, 0])];
    return Uint8Array.from([...head, ...Array.from({ length: n }, () => sos).flat(), 0xff, 0xd9]);
  };
  it('JPEG: 走査の数が上限 (500) を超える画像は読まない。データの尽きた走査は、区画をたどらずに打ち切る', T, () => {
    expect(decodeJpeg(jpegWithScans(800))).toBeUndefined();
    expect(decodeJpeg(jpegWithScans(501))).toBeUndefined();
    // 上限の中の数なら読む (データが無いので、係数は 0 = 一面の灰色)
    const px = decodeJpeg(jpegWithScans(500))!;
    expect([px.width, px.height, px.data[0], px.data[px.data.length - 1]]).toEqual([2000, 2000, 128, 128]);
    expect(decodeJpeg(jpegWithScans(300, 1))).toMatchObject({ width: 2000, height: 2000 });
  });

  it('TIFF: IFD の項ごとに 65,536 個の値を読まない (寸法と解像度は先頭の値だけ。位置がファイルの外なら打ち切る)', T, () => {
    // 同じ所を指す項 (BYTE が 65,536 個) を 20,000 個並べ、その後ろに ImageWidth・ImageLength。直す前は 13 億個の値を読む
    const n = 20_000;
    const b = new Uint8Array(8 + 2 + (n + 3) * 12 + 4);
    const v = new DataView(b.buffer);
    b.set([0x49, 0x49, 42, 0]);
    v.setUint32(4, 8, true);
    v.setUint16(8, n + 3, true);
    const entry = (k: number, tag: number, type: number, cnt: number, value: number) => {
      const e = 10 + k * 12;
      v.setUint16(e, tag, true);
      v.setUint16(e + 2, type, true);
      v.setUint32(e + 4, cnt, true);
      v.setUint32(e + 8, value, true);
    };
    for (let k = 0; k < n; k++) entry(k, 40000, 1, 65536, 0);
    entry(n, 256, 3, 1, 10);
    entry(n + 1, 257, 3, 1, 20);
    entry(n + 2, 40001, 3, 5, 0x7fffffff); // 値の位置がファイルの外
    expect(imageInfo(b)).toEqual({ mime: 'image/tiff', width: 10, height: 20 });
  });

  it('CCITT の 2 次元の行: 参照行の変わり目 b1 を、行の中で持ち越して探す (結果は T.6 の定義どおり)', T, () => {
    // 1 行目は 1 画素おきの白黒 (水平の符号: 001 + 白 1 個 000111 + 黒 1 個 010)、2 行目からは前の行と同じ (垂直 V0 = 1 を幅の数だけ)。
    // 変わり目が幅と同じ数だけあるので、符号ごとに参照行を頭から探すと、幅の 2 乗の手間になる
    const W = 100_000;
    const rows = 20;
    const first = '001000111010';
    const nbits = (W / 2) * first.length + (rows - 1) * W;
    const data = new Uint8Array(Math.ceil(nbits / 8) + 2);
    let p = 0;
    const put = (bit: number) => {
      if (bit) data[p >> 3] |= 0x80 >> (p & 7);
      p++;
    };
    for (let k = 0; k < W / 2; k++) for (const c of first) put(Number(c));
    for (let k = 0; k < (rows - 1) * W; k++) put(1);
    const out = decodeModifiedHuffman(data, { width: W, rows, compression: 4 })!;
    expect(out).toHaveLength(W * rows);
    // どの行も 白・黒・白・黒…
    let bad = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== ((i % W) & 1)) bad++;
    expect(bad).toBe(0);
  });
  it('CCITT の 2 次元の行: パス・垂直 (±1〜3)・水平の符号の混ざった行 (b1 の向きの選び方)', () => {
    // 幅 8。1 行目: 水平 (白 2・黒 3)、垂直 V0 (a1 = b1 = 8: 行の終わり) → 00111000
    // 2 行目: 垂直 VR1 (a1 = b1 + 1 = 3)、垂直 VL1 (a1 = b1 − 1 = 4: 白へ)、垂直 V0 (行の終わり) → 00010000
    // 3 行目: パス (b2 = 4 の真下へ。白のまま)、水平 (白 1・黒 2)、V0 → 00000110
    const bits = '001' + '0111' + '10' + '1' + '011' + '010' + '1' + '0001' + '001' + '000111' + '11' + '1';
    const data = new Uint8Array(Math.ceil(bits.length / 8) + 1);
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') data[i >> 3] |= 0x80 >> (i & 7);
    const out = decodeModifiedHuffman(data, { width: 8, rows: 3, compression: 4 })!;
    expect(Array.from(out).join('')).toBe('00111000' + '00010000' + '00000110');
  });
});
