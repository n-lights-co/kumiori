/** exifOrientation — 画像の EXIF の向き (画面の描画と、ブラウザーで画像の大きさを頭から読むときに使う) */

/**
 * 画像の EXIF の向き (TIFF 6.0 Section 8 の Orientation。札 274 = 0x0112) が、縦横を入れ替える値 (5〜8) か。JPEG は APP1 の「Exif\0\0」の後の
 * TIFF の構造 (CIPA DC-008 (Exif) の APP1)、PNG は eXIf の塊 (PNG 第 3 版) の TIFF の構造の、最初の IFD を読む。読めなければ false
 */
export function exifSwapsAxes(b: Uint8Array, kind: 'png' | 'jpeg'): boolean {
  const tiff = (o: number, end: number): boolean => {
    if (o + 8 > end) return false;
    const le = b[o] === 0x49 && b[o + 1] === 0x49;
    if (!le && !(b[o] === 0x4d && b[o + 1] === 0x4d)) return false;
    const u16 = (i: number) => (i + 2 <= end ? (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]) : -1);
    const u32 = (i: number) => (i + 4 <= end ? (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000 : b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])) : -1);
    const ifd = o + u32(o + 4);
    const n = u16(ifd);
    for (let k = 0; k < n && k < 1000; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > end) return false;
      if (u16(e) === 0x0112) {
        const v = u16(e + 8);
        return v >= 5 && v <= 8;
      }
    }
    return false;
  };
  if (kind === 'jpeg') {
    let p = 2;
    while (p + 4 <= b.length && b[p] === 0xff) {
      // 標識の前の埋め草 (0xFF の続き。ITU-T T.81 B.1.1.2) は読み飛ばす
      if (b[p + 1] === 0xff) {
        p++;
        continue;
      }
      const m = b[p + 1];
      if (m === 0xda || m === 0xd9) break;
      const len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xe1 && len >= 8 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0) return tiff(p + 10, Math.min(b.length, p + 2 + len));
      p += 2 + len;
    }
    return false;
  }
  let p = 8;
  while (p + 8 <= b.length) {
    const len = ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === 'eXIf') return tiff(p + 8, Math.min(b.length, p + 8 + len));
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  return false;
}
