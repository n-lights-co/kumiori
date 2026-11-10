/**
 * imageInfo — ブラウザが描けない画像形式 (TIFF・WMF・EMF・EPS・CGM) の、形式と自然なサイズをファイルの先頭から読む。
 *
 * 中身を描けなくても、自然なサイズが分かれば、仮の枠を正しい寸法で組める (ページ数・行の位置がずれない)。
 * サイズは CSS px (96dpi)。解像度の情報が無ければ 96dpi とみなす。
 */

import { cgmPictureSize } from './cgm';
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
  // 使うのは各項の先頭の値だけ (ImageWidth・ImageLength・解像度・ResolutionUnit は、どれも値が 1 つ: TIFF 6.0 Section 8)
  const ifd = readIfd(b, view(b).getUint32(4, le), le, 1);
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

/**
 * TIFF の IFD を読む (タグ → 値の並び。RATIONAL は割った値)。値は、項ごとに先頭から maxValues 個までで、ファイルの中にあるものだけ
 * (値の位置がファイルの外なら、そこで打ち切る)。項の数 (65,535 まで) × 値の数を、数の欄のとおりに読むと、同じ所を指す項を
 * 並べた小さなファイルで、項の数 × 65,536 個を読むことになる
 */
export function readIfd(b: Uint8Array, off: number, le: boolean, maxValues = 1 << 16): Map<number, number[]> {
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
    const unit = type === 5 ? 8 : type === 3 || type === 8 ? 2 : type === 4 || type === 9 ? 4 : 1; // (下で 1 つの値として読むバイトの数)
    const inFile = Math.max(0, Math.floor((b.length - at) / unit));
    for (let i = 0; i < Math.min(count, maxValues, inFile); i++) {
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

/**
 * EMF: ヘッダのレコードの rclFrame (0.01mm 単位。[MS-EMF] 2.2.9 の Frame)。
 * 左右・上下が逆に書かれた枠は、大きさ (差の絶対値) を使う (WMF・CGM と同じ)。幅か高さが 0 なら、大きさは決まらない (TIFF・CGM と同じ)
 */
function emfInfo(b: Uint8Array): ImageInfo | undefined {
  const v = view(b);
  if (b.length < 88 || v.getUint32(0, true) !== 1 || v.getUint32(40, true) !== 0x464d4520) return undefined;
  const l = v.getInt32(24, true);
  const t = v.getInt32(28, true);
  const r = v.getInt32(32, true);
  const btm = v.getInt32(36, true);
  if (r === l || btm === t) return undefined;
  return { mime: 'image/emf', width: (Math.abs(r - l) / 100) * PX_PER_MM, height: (Math.abs(btm - t) / 100) * PX_PER_MM };
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
 * CGM (2 進形式): 最初の絵の VDC EXTENT の大きさ。SCALING MODE が metric なら mm に直し、abstract なら縦横比だけを使う
 * (幅を 400px とする。FO は content-width などで大きさを決めることが多い)。
 * 描くとき (cgm.ts の cgmToSvg) と同じ大きさになるように、精度の指定・倍率の型などの読みは cgm.ts の cgmPictureSize に任せる
 */
function cgmInfo(b: Uint8Array): ImageInfo | undefined {
  const size = cgmPictureSize(b);
  return size && { mime: 'image/cgm', width: size.width, height: size.height };
}
