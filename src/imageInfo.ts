/**
 * imageInfo — ブラウザが描けない画像形式 (TIFF・WMF・EMF・EPS・CGM) の、形式と自然なサイズをファイルの先頭から読む。
 *
 * 中身を描けなくても、自然なサイズが分かれば、仮の枠を正しい寸法で組める (ページ数・行の位置がずれない)。
 * サイズは CSS px (96dpi)。解像度の情報が無ければ 96dpi とみなす。
 */

import { epsBoundingBox } from './eps';

export interface ImageInfo {
  mime: string;
  width: number;
  height: number;
}

const PX_PER_PT = 96 / 72;
const PX_PER_MM = 96 / 25.4;

export function imageInfo(b: Uint8Array): ImageInfo | undefined {
  try {
    return tiffInfo(b) ?? wmfInfo(b) ?? emfInfo(b) ?? epsInfo(b) ?? cgmInfo(b);
  } catch {
    return undefined;
  }
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * PNG (pHYs)・JPEG (JFIF の APP0)・BMP (biXPelsPerMeter) に書かれた解像度 (dpi)。書かれていなければ undefined。
 * CSS の image-resolution: from-image (画像の解像度で、本来の大きさを決める) に使う
 */
export function pixelDensity(b: Uint8Array): number | undefined {
  const v = view(b);
  // PNG: シグネチャの後のチャンクを順にたどり、IDAT より前の pHYs を探す (単位 1 = 1 メートルあたり)
  if (b.length > 16 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    for (let p = 8; p + 8 <= b.length; ) {
      const len = v.getUint32(p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs' && len >= 9) {
        const x = v.getUint32(p + 8);
        return b[p + 16] === 1 && x > 0 ? x * 0.0254 : undefined;
      }
      if (type === 'IDAT' || type === 'IEND') return undefined;
      p += 12 + len;
    }
    return undefined;
  }
  // JPEG: 最初の APP0 (JFIF) の密度 (単位 1 = dpi、2 = dpcm。0 は比だけ)
  if (b.length > 18 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(...b.subarray(6, 10)) === 'JFIF') {
    const unit = b[13];
    const x = v.getUint16(14);
    if (x > 0 && unit === 1) return x;
    if (x > 0 && unit === 2) return x * 2.54;
  }
  // BMP: BITMAPINFOHEADER 以降の biXPelsPerMeter (1 メートルあたりの画素。0 は書かれていない。OS/2 の古い頭には無い)
  if (b.length >= 46 && b[0] === 0x42 && b[1] === 0x4d && v.getUint32(14, true) >= 40) {
    const x = v.getInt32(38, true);
    if (x > 0) return x * 0.0254;
  }
  return undefined;
}

/** TIFF: 最初の IFD の ImageWidth・ImageLength と解像度 (XResolution・YResolution・ResolutionUnit) */
export function tiffInfo(b: Uint8Array): ImageInfo | undefined {
  const le = b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0;
  const be = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42;
  if (!le && !be) return undefined;
  const ifd = readIfd(b, view(b).getUint32(4, le), le);
  const w = ifd.get(256)?.[0];
  const h = ifd.get(257)?.[0];
  if (!w || !h) return undefined;
  const unit = ifd.get(296)?.[0] ?? 2;
  const dpi = (tag: number) => {
    const r = ifd.get(tag)?.[0];
    if (!r || unit === 1) return 96;
    return unit === 3 ? r * 2.54 : r;
  };
  return { mime: 'image/tiff', width: (w * 96) / dpi(282), height: (h * 96) / dpi(283) };
}

/** TIFF の IFD を読む (タグ → 値の並び。RATIONAL は割った値) */
export function readIfd(b: Uint8Array, off: number, le: boolean): Map<number, number[]> {
  const v = view(b);
  const n = v.getUint16(off, le);
  const out = new Map<number, number[]>();
  const size: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    const tag = v.getUint16(e, le);
    const type = v.getUint16(e + 2, le);
    const count = v.getUint32(e + 4, le);
    const bytes = (size[type] ?? 1) * count;
    const at = bytes <= 4 ? e + 8 : v.getUint32(e + 8, le);
    const vals: number[] = [];
    for (let i = 0; i < Math.min(count, 1 << 16); i++) {
      if (type === 3) vals.push(v.getUint16(at + i * 2, le));
      else if (type === 4) vals.push(v.getUint32(at + i * 4, le));
      else if (type === 5) vals.push(v.getUint32(at + i * 8, le) / (v.getUint32(at + i * 8 + 4, le) || 1));
      else if (type === 1 || type === 7) vals.push(b[at + i]);
      else if (type === 8) vals.push(v.getInt16(at + i * 2, le));
      else if (type === 9) vals.push(v.getInt32(at + i * 4, le));
      else vals.push(b[at + i]);
    }
    out.set(tag, vals);
  }
  return out;
}

/** WMF: Placeable ヘッダ (0x9AC6CDD7) の外接矩形と 1 インチあたりの単位 */
function wmfInfo(b: Uint8Array): ImageInfo | undefined {
  const v = view(b);
  if (b.length < 22 || v.getUint32(0, true) !== 0x9ac6cdd7) return undefined;
  const l = v.getInt16(6, true);
  const t = v.getInt16(8, true);
  const r = v.getInt16(10, true);
  const btm = v.getInt16(12, true);
  const inch = v.getUint16(14, true) || 1440;
  return { mime: 'image/wmf', width: (Math.abs(r - l) / inch) * 96, height: (Math.abs(btm - t) / inch) * 96 };
}

/** EMF: ヘッダのレコードの rclFrame (0.01mm 単位) */
function emfInfo(b: Uint8Array): ImageInfo | undefined {
  const v = view(b);
  if (b.length < 88 || v.getUint32(0, true) !== 1 || v.getUint32(40, true) !== 0x464d4520) return undefined;
  const l = v.getInt32(24, true);
  const t = v.getInt32(28, true);
  const r = v.getInt32(32, true);
  const btm = v.getInt32(36, true);
  return { mime: 'image/emf', width: ((r - l) / 100) * PX_PER_MM, height: ((btm - t) / 100) * PX_PER_MM };
}

/** EPS: %%HiResBoundingBox / %%BoundingBox (pt)。DOS 形式 (C5D0D3C6) は PostScript の部分から読む */
function epsInfo(b: Uint8Array): ImageInfo | undefined {
  let ps = b;
  if (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) {
    const v = view(b);
    ps = b.subarray(v.getUint32(4, true), v.getUint32(4, true) + v.getUint32(8, true));
  } else if (!(b[0] === 0x25 && b[1] === 0x21 && b[2] === 0x50 && b[3] === 0x53)) return undefined;
  const bbox = epsBoundingBox(new TextDecoder('latin1').decode(ps.subarray(0, 64 * 1024)));
  if (!bbox) return undefined;
  const [x0, y0, x1, y1] = bbox;
  return { mime: 'application/postscript', width: (x1 - x0) * PX_PER_PT, height: (y1 - y0) * PX_PER_PT };
}

/** EPS (DOS 形式) に入っているプレビュー (TIFF または WMF) */
export function epsPreview(b: Uint8Array): Uint8Array | undefined {
  if (!(b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6)) return undefined;
  const v = view(b);
  const tiffOff = v.getUint32(20, true);
  const tiffLen = v.getUint32(24, true);
  if (tiffOff && tiffLen) return b.subarray(tiffOff, tiffOff + tiffLen);
  const wmfOff = v.getUint32(12, true);
  const wmfLen = v.getUint32(16, true);
  if (wmfOff && wmfLen) return b.subarray(wmfOff, wmfOff + wmfLen);
  return undefined;
}

/**
 * CGM (2 進形式): VDC EXTENT の大きさ。SCALING MODE が metric なら mm に直し、abstract なら縦横比だけを使う
 * (幅を 400px とする。FO は content-width などで大きさを決めることが多い)
 */
/** CGM の命令を順に取り出す (第 3 部 5.4)。長い形の分割された引数はつなぐ (cgm.ts の elements と同じ)。壊れていれば途中まで */
function* cgmElements(b: Uint8Array): Generator<{ cls: number; id: number; data: Uint8Array }> {
  let p = 0;
  for (let guard = 0; p + 2 <= b.length && guard < 10000; guard++) {
    const h = (b[p] << 8) | b[p + 1];
    p += 2;
    const cls = h >> 12;
    const id = (h >> 5) & 0x7f;
    let len = h & 0x1f;
    if (len !== 31) {
      if (p + len > b.length) return;
      yield { cls, id, data: b.subarray(p, p + len) };
      p += len + (len & 1);
      continue;
    }
    const parts: Uint8Array[] = [];
    for (;;) {
      if (p + 2 > b.length) return;
      const w = (b[p] << 8) | b[p + 1];
      p += 2;
      len = w & 0x7fff;
      if (p + len > b.length) return;
      parts.push(b.subarray(p, p + len));
      p += len + (len & 1);
      if (!(w & 0x8000)) break;
    }
    if (parts.length === 1) yield { cls, id, data: parts[0] };
    else {
      const all = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
      let o = 0;
      for (const x of parts) {
        all.set(x, o);
        o += x.length;
      }
      yield { cls, id, data: all };
    }
  }
}

function cgmInfo(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 4 || view(b).getUint16(0, false) >> 5 !== ((0 << 7) | 1)) return undefined; // BEGIN METAFILE
  let vdcReal = false;
  let intPrec = 16;
  let realForm: 'fixed32' | 'fixed64' | 'float32' | 'float64' = 'fixed32';
  let metric: number | undefined;
  let extent: number[] | undefined;
  const readReal = (v: DataView, at: number) =>
    realForm === 'float32' ? v.getFloat32(at) : realForm === 'float64' ? v.getFloat64(at) : realForm === 'fixed64' ? v.getInt32(at) + v.getUint32(at + 4) / 2 ** 32 : v.getInt16(at) + v.getUint16(at + 2) / 65536;
  const realSize = () => (realForm === 'float64' || realForm === 'fixed64' ? 8 : 4);
  /** 1 つの命令を見る。true なら読み終わり (VDC EXTENT を見つけた・END METAFILE) */
  const handle = ({ cls, id, data }: { cls: number; id: number; data: Uint8Array }): boolean => {
    const v = view(data);
    const len = data.length;
    try {
      if (cls === 1 && id === 3) vdcReal = v.getInt16(0) === 1; // VDC TYPE
      else if (cls === 3 && id === 1) intPrec = v.getInt16(0); // VDC INTEGER PRECISION
      else if (cls === 3 && id === 2) {
        // VDC REAL PRECISION: 形式 (0 浮動・1 固定)、指数 (整数部)、仮数 (小数部)
        const form = v.getInt16(0);
        const a = v.getInt16(2);
        realForm = form === 0 ? (a > 9 ? 'float64' : 'float32') : a > 16 ? 'fixed64' : 'fixed32';
      } else if (cls === 2 && id === 1) {
        // SCALING MODE: 0 abstract / 1 metric (+ 倍率: VDC 1 単位あたりの mm。実数は既定の固定小数点 32 ビット)
        if (v.getInt16(0) === 1 && len >= 6) metric = v.getFloat32(2);
      } else if (cls === 2 && id === 6) {
        // VDC EXTENT: 2 点
        const ext: number[] = [];
        for (let k = 0; k < 4; k++) {
          if (vdcReal) ext.push(readReal(v, k * realSize()));
          else ext.push(intPrec === 32 ? v.getInt32(k * 4) : v.getInt16(k * 2));
        }
        extent = ext;
        return true;
      } else if (cls === 0 && id === 2) return true; // END METAFILE
    } catch {
      /* 引数の足りない壊れた命令は見ない */
    }
    return false;
  };
  for (const el of cgmElements(b)) {
    if (el.cls === 1 && el.id === 12) {
      // METAFILE DEFAULTS REPLACEMENT: 中の命令 (VDC EXTENT などの既定値) も見る (入れ子の MDR は見ない。cgm.ts と同じ)
      let done = false;
      for (const sub of cgmElements(el.data)) if ((done = sub.cls !== 1 || sub.id !== 12 ? handle(sub) : false)) break;
      if (done) break;
      continue;
    }
    if (handle(el)) break;
  }
  if (!extent) return undefined;
  const w = Math.abs(extent[2] - extent[0]);
  const h = Math.abs(extent[3] - extent[1]);
  if (!w || !h) return undefined;
  if (metric && Number.isFinite(metric) && metric > 0) return { mime: 'image/cgm', width: w * metric * PX_PER_MM, height: h * metric * PX_PER_MM };
  return { mime: 'image/cgm', width: 400, height: (400 * h) / w };
}
