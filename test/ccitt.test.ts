import { describe, expect, it } from 'vitest';
import { decodeModifiedHuffman } from '../src/ccitt';

/** '0'/'1' の並びを、上位のビットから詰めたバイト列にする (足りない分は 0) */
const bytes = (bits: string) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 0x80 >> (i & 7);
  return out;
};

describe('CCITT の 1 次元の符号 (TIFF 6.0 Section 10・11)', () => {
  // 白 3 = 1000、黒 2 = 11 (Table 1/T.4)
  const row = '1000' + '11' + '1000';
  it('Compression=2: 白から始まる白・黒の連なり。行はバイトの境目から始まる', () => {
    const px = decodeModifiedHuffman(bytes(row + '000000' + row), { width: 8, rows: 2, compression: 2 });
    expect(Array.from(px!)).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0]);
  });
  it('黒から始まる行は、長さ 0 の白から始める。長い連なりは Make-up と Terminating の和', () => {
    // 白 0 = 00110101、黒 64 = 0000001111 + 黒 0 = 0000110111、白 2 = 0111 (幅 66)
    const px = decodeModifiedHuffman(bytes('00110101' + '0000001111' + '0000110111' + '0111'), { width: 66, rows: 1, compression: 2 });
    expect(px!.slice(0, 64).every((v) => v === 1)).toBe(true);
    expect(Array.from(px!.slice(64))).toEqual([0, 0]);
  });
  it('Compression=3: 行の前の EOL (と埋めの 0) を読み飛ばし、行はバイトの境目にそろえない', () => {
    const eol = '0000' + '000000000001';
    const px = decodeModifiedHuffman(bytes(eol + row + eol + row), { width: 8, rows: 2, compression: 3 });
    expect(Array.from(px!)).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0]);
  });
  it('FillOrder=2 は、各バイトの下位のビットから読む', () => {
    const rev = bytes(row).map((b) => parseInt(b.toString(2).padStart(8, '0').split('').reverse().join(''), 2));
    expect(Array.from(decodeModifiedHuffman(rev, { width: 8, rows: 1, compression: 2, fillOrder: 2 })!)).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
  });
  it('連なりの和が幅を超えれば読めない', () => {
    expect(decodeModifiedHuffman(bytes(row), { width: 6, rows: 1, compression: 2 })).toBeUndefined();
  });

  // 2 次元の符号 (Table 4/T.4): P = 0001、H = 001、V(0) = 1
  const twoRows = [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0];
  it('Compression=4: 最初の行は全部白の参照行に対して 2 次元の符号。水平 (H) と垂直 (V) で、上の行と同じ行を表す', () => {
    // 1 行目: H + 白 3 + 黒 2、V(0) (行末)。2 行目: V(0) × 3 (上の行の変わり目 3・5 と行末)
    const bits = '001' + '1000' + '11' + '1' + '111';
    expect(Array.from(decodeModifiedHuffman(bytes(bits), { width: 8, rows: 2, compression: 4 })!)).toEqual(twoRows);
  });
  it('Compression=3 の 2 次元の符号: EOL の後の 1 ビットで、1 次元 (1) と 2 次元 (0) の行を切り替える', () => {
    const eol = '000000000001';
    const bits = eol + '1' + row + eol + '0' + '111';
    expect(Array.from(decodeModifiedHuffman(bytes(bits), { width: 8, rows: 2, compression: 3, twoDimensional: true })!)).toEqual(twoRows);
  });
  it('パス (P): a0 を参照行の b2 の真下へ進め、色は変えない', () => {
    // 1 行目: 黒 2〜4 (H + 白 2 + 黒 2、V(0))。2 行目: P (b1=2・b2=4 を飛ばす)、V(0) で行末 → 全部白
    const bits = '001' + '0111' + '11' + '1' + '0001' + '1';
    expect(Array.from(decodeModifiedHuffman(bytes(bits), { width: 8, rows: 2, compression: 4 })!)).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('非圧縮の形 (Table 5/T.4): 1 次元の行は 000000001111 で入り、01 (白・黒)・1 (黒)、0000001T で抜けて T の色の連なりへ', () => {
    // 白 1 個・黒 2 個を非圧縮で、抜けて (T = 0: 白) 白 5 = 1100
    const bits = '000000001111' + '01' + '1' + '0000001' + '0' + '1100';
    expect(Array.from(decodeModifiedHuffman(bytes(bits), { width: 8, rows: 1, compression: 3 })!)).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
  });
  it('非圧縮の形: 2 次元の行は 0000001111 で入る。000001 は白 5 個、00000001T は白 1 個の後に抜ける', () => {
    // 全部白の参照行 (T.6)。非圧縮で 白 5 + (白 1 で抜け、T = 1: 黒) → 黒の連なりは 2 次元の符号で: V(0) で行末 (a1 = b1 = 8)
    const bits = '0000001111' + '000001' + '00000001' + '1' + '1';
    expect(Array.from(decodeModifiedHuffman(bytes(bits), { width: 8, rows: 1, compression: 4 })!)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });
});
