import { describe, expect, it } from 'vitest';
import { iccRgbToCmyk } from '../src/icc';

/** ICC プロファイルの枠 (ヘッダ 128 バイト + 札の表) に、札 1 つ (中身 body) を入れる */
function profile(tag: string, body: number[], pcs = 'Lab '): Uint8Array {
  const head = new Array(128).fill(0);
  const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
  put(12, 'prtr');
  put(16, 'CMYK');
  put(20, pcs);
  put(36, 'acsp');
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const table = [...u32(1), ...Array.from(tag, (c) => c.charCodeAt(0)), ...u32(144), ...u32(body.length)];
  const all = [...head, ...table, ...body];
  const size = u32(all.length);
  for (let k = 0; k < 4; k++) all[k] = size[k];
  return Uint8Array.from(all);
}
const u16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 255, x & 255]);
const u32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
const s15 = (...v: number[]) => u32(...v.map((x) => Math.round(x * 65536) >>> 0));
const sig = (t: string) => Array.from(t, (c) => c.charCodeAt(0));

/** sRGB → Lab (D50) (確かめる側の計算) */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4360747 * R + 0.3850649 * G + 0.1430804 * B) / 0.9642;
  const y = 0.2225045 * R + 0.7168786 * G + 0.0606169 * B;
  const z = (0.0139322 * R + 0.0971045 * G + 0.7141733 * B) / 0.8249;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

describe('ICC プロファイルの BToA の表で RGB を CMYK にする', () => {
  it('lut16Type (mft2): 入力の曲線・格子の表・出力の曲線を通す (PCS の Lab は 16 ビットの古い形)', () => {
    // 格子 2 点の表: C = 1 − L、M = a、Y = b、K = 0.25 (L・a・b は表の入力 0..1)
    const clut: number[] = [];
    for (const L of [0, 1]) for (const a of [0, 1]) for (const b of [0, 1]) clut.push(...u16(Math.round((1 - L) * 65535), Math.round(a * 65535), Math.round(b * 65535), 16384));
    const lin = u16(0, 65535);
    const body = [...sig('mft2'), 0, 0, 0, 0, 3, 4, 2, 0, ...s15(1, 0, 0, 0, 1, 0, 0, 0, 1), ...u16(2, 2), ...lin, ...lin, ...lin, ...clut, ...lin, ...lin, ...lin, ...lin];
    const conv = iccRgbToCmyk(profile('B2A1', body))!;
    expect(conv).toBeDefined();
    const white = conv(1, 1, 1);
    expect(white[0]).toBeCloseTo(1 - 0xff00 / 0xffff, 3);
    expect(white[3]).toBeCloseTo(0.25, 3);
    const [L, a, b] = lab(0.8, 0.2, 0.4);
    const v = conv(0.8, 0.2, 0.4);
    // RGB の格子の補間の分だけ、ずれる
    expect(v[0]).toBeCloseTo(1 - (L / 100) * (0xff00 / 0xffff), 2);
    expect(v[1]).toBeCloseTo(((a + 128) * 256) / 65535, 2);
    expect(v[2]).toBeCloseTo(((b + 128) * 256) / 65535, 2);
  });

  it('lutBToAType (mBA): B の曲線 (parametricCurveType) と格子の表 (8 ビット)。相対的な測色の表が無ければ知覚的の表', () => {
    // 曲線: γ = 2 の para (形 0)。格子 2 点・8 ビット: C = L'、M = 0、Y = 0、K = 1 − L'
    const para = [...sig('para'), 0, 0, 0, 0, ...u16(0, 0), ...s15(2)];
    const grid = [2, 2, 2, ...new Array(13).fill(0), 1, 0, 0, 0];
    const cl: number[] = [];
    for (const L of [0, 1]) for (let k = 0; k < 4; k++) cl.push(L * 255, 0, 0, (1 - L) * 255);
    const head = 32;
    const curvesAt = head;
    const clutAt = curvesAt + 3 * para.length;
    const body = [...sig('mBA '), 0, 0, 0, 0, 3, 4, 0, 0, ...u32(curvesAt, 0, 0, clutAt, 0), ...para, ...para, ...para, ...grid, ...cl];
    const conv = iccRgbToCmyk(profile('B2A0', body))!;
    expect(conv).toBeDefined();
    const [L] = lab(0.5, 0.5, 0.5);
    const v = conv(0.5, 0.5, 0.5);
    expect(v[0]).toBeCloseTo((L / 100) ** 2, 2);
    expect(v[3]).toBeCloseTo(1 - (L / 100) ** 2, 2);
  });

  it('CMYK の出力のプロファイルでない・表が無ければ undefined', () => {
    const rgb = profile('B2A1', []);
    rgb[16] = 'R'.charCodeAt(0);
    expect(iccRgbToCmyk(rgb)).toBeUndefined();
    expect(iccRgbToCmyk(profile('A2B0', [...sig('mft2')]))).toBeUndefined();
    expect(iccRgbToCmyk(new Uint8Array(10))).toBeUndefined();
  });
});
