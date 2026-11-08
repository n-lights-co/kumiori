/**
 * EMF の EMR_GRADIENTFILL ([MS-EMF] 2.3.5.12): 矩形 (左から右・上から下) と三角形の色の変わる塗り
 */
import { describe, expect, it } from 'vitest';
import { emfToSvg } from '../src/metafile';

/** EMF の見出し (88 バイト) と記録を並べる。参照の装置は 1 画素 = 0.25mm */
function emf(records: Uint8Array[]): Uint8Array {
  const body = records.reduce((a, r) => a + r.length, 0);
  const eof = rec(14, [0, 16, 20]);
  const h = new DataView(new ArrayBuffer(88));
  h.setUint32(0, 1, true);
  h.setUint32(4, 88, true);
  [0, 0, 99, 99].forEach((n, k) => h.setInt32(8 + k * 4, n, true));
  [0, 0, 2499, 2499].forEach((n, k) => h.setInt32(24 + k * 4, n, true));
  h.setUint32(40, 0x464d4520, true);
  h.setUint32(44, 0x10000, true);
  h.setUint32(48, 88 + body + eof.length, true);
  h.setUint32(52, records.length + 2, true);
  h.setUint16(56, 1, true);
  [1000, 1000, 250, 250].forEach((n, k) => h.setInt32(72 + k * 4, n, true));
  const out = new Uint8Array(88 + body + eof.length);
  out.set(new Uint8Array(h.buffer), 0);
  let at = 88;
  for (const r of [...records, eof]) {
    out.set(r, at);
    at += r.length;
  }
  return out;
}

/** 記録: 型と、32 ビットの値の並び */
function rec(type: number, words: number[]): Uint8Array {
  const v = new DataView(new ArrayBuffer(8 + words.length * 4));
  v.setUint32(0, type, true);
  v.setUint32(4, 8 + words.length * 4, true);
  words.forEach((n, k) => v.setUint32(8 + k * 4, n >>> 0, true));
  return new Uint8Array(v.buffer);
}

/** TriVertex: x・y (32 ビット) と Red・Green・Blue・Alpha (16 ビット) を 32 ビットの値 4 つに詰める */
const vertex = (x: number, y: number, [r, g, b]: number[]) => [x, y, ((g << 8) << 16) | (r << 8), b << 8];

describe('EMR_GRADIENTFILL', () => {
  it('GRADIENT_FILL_RECT_V: 上から下へ色を変える矩形 (頂点の番号の後ろの VertexPadding は読み飛ばす)', () => {
    const g = rec(118, [0, 0, 100, 50, 2, 1, 1, ...vertex(0, 0, [255, 0, 0]), ...vertex(100, 50, [0, 0, 255]), 0, 1, 0]);
    const svg = emfToSvg(emf([g]))!;
    expect(svg).toMatch(/<linearGradient[^>]*x1="0" y1="0" x2="0" y2="50"/);
    expect(svg).toContain('stop-color="#ff0000"');
    expect(svg).toContain('stop-color="#0000ff"');
  });
  it('GRADIENT_FILL_RECT_H: 左から右', () => {
    const g = rec(118, [0, 0, 100, 50, 2, 1, 0, ...vertex(0, 0, [0, 0, 0]), ...vertex(100, 50, [255, 255, 255]), 0, 1, 0]);
    expect(emfToSvg(emf([g]))!).toMatch(/<linearGradient[^>]*x1="0" y1="0" x2="100" y2="0"/);
  });
  it('GRADIENT_FILL_TRIANGLE: 小さな三角形に分けて、頂点の色の間の色で塗る', () => {
    const g = rec(118, [0, 0, 100, 100, 3, 1, 2, ...vertex(0, 0, [255, 0, 0]), ...vertex(100, 0, [0, 255, 0]), ...vertex(0, 100, [0, 0, 255]), 0, 1, 2]);
    const svg = emfToSvg(emf([g]))!;
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    // 8 × 8 = 64 個の小さな三角形
    expect(fills.length).toBe(64);
    // 赤の頂点の近くは赤に、青の頂点の近くは青に近い
    expect(fills.some((c) => parseInt(c.slice(1, 3), 16) > 200)).toBe(true);
    expect(fills.some((c) => parseInt(c.slice(5, 7), 16) > 200)).toBe(true);
  });
});
