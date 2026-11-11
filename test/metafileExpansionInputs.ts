/**
 * 小さなファイルから大きな画像を作らせる入力 (連長の符号・タイルの並び) を、バイト列として組み立てる。
 * Kumiori 自身の上限 (imageLimits.ts) を確かめるテストのためだけのもの
 */

const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
};

/** BitmapInfoHeader ([MS-WMF] 2.2.2.3) と 2 項の色の表 (黒・白) */
const bmi = (w: number, h: number, bpp: number, comp: number) => {
  const m = new Uint8Array(48);
  const v = new DataView(m.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, w, true);
  v.setInt32(8, h, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, bpp, true);
  v.setUint32(16, comp, true);
  v.setUint32(32, 2, true);
  m.set([255, 255, 255, 0], 44);
  return m;
};
/** RLE8 の画素 ([MS-WMF] 3.1.6): 「画像の終わり」だけ (残りの画素は指定が無い = 0 番の色) */
const RLE_END = Uint8Array.from([0, 1, 0, 0]);

/** EMF: w × h の RLE8 の DIB を 1 枚描く (EMR_HEADER と EMR_STRETCHDIBITS。[MS-EMF] 2.3.4.2・2.3.1.7)。extra は記録の後ろに足す詰め物のバイト数 */
export function emfRle(w: number, h: number, extra = 0): Uint8Array {
  const head = new Uint8Array(88);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, 1, true);
  hv.setUint32(4, 88, true);
  hv.setInt32(16, 100, true);
  hv.setInt32(20, 100, true);
  hv.setInt32(32, 1000, true);
  hv.setInt32(36, 1000, true);
  hv.setUint32(40, 0x464d4520, true);
  hv.setInt32(72, 1000, true);
  hv.setInt32(76, 1000, true);
  hv.setInt32(80, 300, true);
  hv.setInt32(84, 300, true);
  const m = bmi(w, h, 8, 1);
  const r = new Uint8Array(80 + m.length + RLE_END.length);
  const v = new DataView(r.buffer);
  v.setUint32(0, 81, true);
  v.setUint32(4, r.length, true);
  v.setInt32(8 + 32, w, true);
  v.setInt32(8 + 36, h, true);
  v.setUint32(8 + 40, 80, true);
  v.setUint32(8 + 44, m.length, true);
  v.setUint32(8 + 48, 80 + m.length, true);
  v.setUint32(8 + 52, RLE_END.length, true);
  v.setUint32(8 + 60, 0x00cc0020, true);
  v.setInt32(8 + 64, 100, true);
  v.setInt32(8 + 68, 100, true);
  r.set(m, 80);
  r.set(RLE_END, 80 + m.length);
  // 詰め物は EMR_GDICOMMENT ([MS-EMF] 2.3.3: 読み飛ばす記録) に入れる
  const pad = new Uint8Array(extra ? Math.max(12, extra & ~3) : 0);
  if (pad.length) {
    const pv = new DataView(pad.buffer);
    pv.setUint32(0, 70, true);
    pv.setUint32(4, pad.length, true);
    pv.setUint32(8, pad.length - 12, true);
  }
  return cat(head, r, pad);
}

/** WMF: w × h の RLE8 の DIB を 1 枚描く (META_STRETCHDIB。[MS-WMF] 2.3.1.6)。寸法は 16 ビットに入る値 */
export function wmfRle(w: number, h: number, extra = 0): Uint8Array {
  const head = new Uint8Array(18);
  const hv = new DataView(head.buffer);
  hv.setUint16(0, 1, true);
  hv.setUint16(2, 9, true);
  hv.setUint16(4, 0x0300, true);
  const m = bmi(w, h, 8, 1);
  const r = new Uint8Array(6 + 22 + m.length + RLE_END.length);
  const v = new DataView(r.buffer);
  v.setUint32(0, r.length / 2, true);
  v.setUint16(4, 0x0f43, true);
  v.setUint32(6, 0x00cc0020, true);
  // ColorUsage 0、srcHeight、srcWidth、ySrc、xSrc、destHeight、destWidth、yDst、xDst
  [0, h, w, 0, 0, 100, 100, 0, 0].forEach((x, k) => v.setUint16(10 + 2 * k, x, true));
  r.set(m, 28);
  r.set(RLE_END, 28 + m.length);
  // 詰め物は META_ESCAPE ([MS-WMF] 2.3.6: 読み飛ばす記録) に入れる
  const pad = new Uint8Array(extra ? Math.max(6, extra & ~1) : 0);
  if (pad.length) {
    const pv = new DataView(pad.buffer);
    pv.setUint32(0, pad.length / 2, true);
    pv.setUint16(4, 0x0626, true);
  }
  const end = Uint8Array.from([3, 0, 0, 0, 0, 0]);
  return cat(head, r, pad, end);
}

/** CGM の命令 (ISO/IEC 8632-3 5.4。引数が 31 バイト以上なら長い形) */
function cmd(cls: number, id: number, data: number[] = []): number[] {
  const w = (cls << 12) | (id << 5) | Math.min(31, data.length);
  const out = data.length < 31 ? [w >> 8, w & 0xff] : [w >> 8, w & 0xff, data.length >> 8, data.length & 0xff];
  out.push(...data);
  if (data.length % 2) out.push(0);
  return out;
}
const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
const i32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
/** CGM (BEGIN METAFILE・記述子・BEGIN PICTURE・VDC EXTENT (0,0)-(100,100)・BEGIN PICTURE BODY・本体・END PICTURE・END METAFILE) */
const cgm = (body: number[], descriptor: number[] = [], extra = 0) =>
  new Uint8Array([
    ...cmd(0, 1, [1, 116]),
    ...descriptor,
    ...cmd(0, 3, [1, 112]),
    ...cmd(2, 6, i16(0, 0, 100, 100)),
    ...cmd(0, 4),
    ...body,
    // 詰め物は NO-OP (第 3 部 表 3 の 0 番: 読み飛ばす要素) に入れる
    ...(extra ? cmd(0, 0, new Array(Math.min(extra, 32000)).fill(0)) : []),
    ...cmd(0, 5),
    ...cmd(0, 2),
  ]);

/**
 * CGM: nx × ny の CELL ARRAY (ISO/IEC 8632-3 表 7 の 9 番) を、連なりの符号 (1 行が「数 nx・色 1 番」の 1 組) で描く。
 * 整数の精度を 32 ビットにして (INTEGER PRECISION)、1 組で nx 個のセルを塗る
 */
export function cgmCellRuns(nx: number, ny: number, extra = 0): Uint8Array {
  const rows = Array.from({ length: ny }, () => [...i32(nx), 1, 0]).flat();
  return cgm(cmd(4, 9, [...i16(0, 0, 100, 100, 100, 0), ...i32(nx, ny, 8), ...i16(0), ...rows]), cmd(1, 4, i16(32)), extra);
}

/** CGM: セルが w × h のタイル 1 枚の並び (BEGIN TILE ARRAY・TILE (圧縮の形 0 = 全部が背景の色)・END TILE ARRAY。第 3 部 表 3 の 19・20 番、表 7 の 29 番) */
export function cgmTiles(w: number, h: number, extra = 0): Uint8Array {
  const begin = cmd(0, 19, [...i16(0, 0, 0, 0, 1, 1, w, h), ...i32(0x10000, 0x10000), ...i16(0, 0, w, h)]);
  const tile = cmd(4, 29, [...i16(0, 0, 8), 0]);
  return cgm([...begin, ...tile, ...cmd(0, 20)], [], extra);
}
