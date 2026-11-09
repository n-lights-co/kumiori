/**
 * ウェブフォント (WOFF・WOFF2) を、ふつうの書体のファイル (sfnt: TrueType・OpenType (CFF)) に戻す。
 * 戻した書体は、TTF・OTF と同じに登録し、PDF に埋め込む (PDF には WOFF・WOFF2 をそのまま入れられない)。
 *
 *  - WOFF 1.0 (W3C Recommendation 13 December 2012): 表ごとに zlib で圧縮してある (§5)。自前の zlib の展開 (psFilters) で戻す
 *  - WOFF2 (W3C Recommendation, 08 August 2024。https://www.w3.org/TR/2024/REC-WOFF2-20240808/ 、2026-11-09 取得): 表をまとめて Brotli で圧縮し (§5)、glyf・loca・hmtx は形を変えて縮めてある (§5)。
 *    Brotli の展開は fontkit (@pdf-lib/fontkit 1.1.1 の WOFF2Font) に任せ、変換した表 (glyf・loca §5.1〜5.3、hmtx §5.4) はここで元に戻す。
 *    書体の集まり (flavor が ttcf。§4.2) は TTC にする (読み込みの側が、TTC の中の書体をそれぞれ取り出す)
 */
import fontkit from '@pdf-lib/fontkit';
import { inflateBytes } from './psFilters';

/** 先頭の印で見分ける: WOFF は 'wOFF'、WOFF2 は 'wOF2' */
export function webFontKind(buf: ArrayBuffer | Uint8Array): 'woff' | 'woff2' | undefined {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 4) return undefined;
  const sig = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return sig === 'wOFF' ? 'woff' : sig === 'wOF2' ? 'woff2' : undefined;
}

/** WOFF・WOFF2 なら sfnt に戻す。ほかの書体のファイルはそのまま返す */
export function toSfnt(buf: ArrayBuffer): ArrayBuffer {
  const kind = webFontKind(buf);
  if (kind === 'woff') return woffToSfnt(new Uint8Array(buf));
  if (kind === 'woff2') return woff2ToSfnt(new Uint8Array(buf));
  return buf;
}

interface Table {
  tag: string;
  data: Uint8Array;
}

/** WOFF 1.0 → sfnt (W3C WOFF 1.0 §3 の表の目録、§5 の表の圧縮: compLength が origLength より短ければ zlib) */
function woffToSfnt(b: Uint8Array): ArrayBuffer {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = v.getUint32(4);
  const numTables = v.getUint16(12);
  const tables: Table[] = [];
  for (let k = 0; k < numTables; k++) {
    const at = 44 + 20 * k;
    const tag = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
    const offset = v.getUint32(at + 4);
    const compLength = v.getUint32(at + 8);
    const origLength = v.getUint32(at + 12);
    const raw = b.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateBytes(raw, origLength + 1) : raw.slice();
    if (data.length !== origLength) throw new Error(`WOFF: the table ${tag} has a wrong length`);
    tables.push({ tag, data });
  }
  return buildSfnt(flavor, tables);
}

/** WOFF2 の表の名前 (表の目録の flags の下位 6 ビット。§4.1 の Known Table Tags) */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** 読み進める位置つきの読み手 */
class Reader {
  pos = 0;
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (this.pos + n > this.b.length) throw new Error('WOFF2: the data ends early');
  }
  u8() {
    this.need(1);
    return this.b[this.pos++];
  }
  u16() {
    this.need(2);
    const r = this.v.getUint16(this.pos);
    this.pos += 2;
    return r;
  }
  i16() {
    this.need(2);
    const r = this.v.getInt16(this.pos);
    this.pos += 2;
    return r;
  }
  u32() {
    this.need(4);
    const r = this.v.getUint32(this.pos);
    this.pos += 4;
    return r;
  }
  bytes(n: number) {
    this.need(n);
    const r = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }
  /** 読んだ範囲 (start から今の位置まで) */
  since(start: number) {
    return this.b.subarray(start, this.pos);
  }
  /** UIntBase128 (§3.1): 1〜5 バイト。先頭が 0x80 のものと、32 ビットを超えるものは誤り */
  base128() {
    let r = 0;
    for (let k = 0; k < 5; k++) {
      const c = this.u8();
      if (k === 0 && c === 0x80) throw new Error('WOFF2: bad UIntBase128');
      if (r & 0xfe000000) throw new Error('WOFF2: UIntBase128 overflow');
      r = (r << 7) | (c & 0x7f);
      if (!(c & 0x80)) return r >>> 0;
    }
    throw new Error('WOFF2: UIntBase128 too long');
  }
  /** 255UInt16 (§3.1) */
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 253 * 2;
    return c;
  }
}

/** WOFF2 の表の目録の 1 つ (§4.1) */
interface Woff2Entry {
  tag: string;
  origLength: number;
  transformLength?: number;
  version: number;
}

/**
 * WOFF2 → sfnt (W3C WOFF2 §3.2 の見出し、§4.1 の表の目録、§4.2 の書体の集まりの目録、§5 の表の変換)。
 * 書体の集まり (flavor が ttcf) なら TTC (書体の集まりの見出しの版 1.0) にする。表は目録の番号で区別する (集まりでは、同じ名前の表が書体ごとにある)
 */
function woff2ToSfnt(b: Uint8Array): ArrayBuffer {
  const r = new Reader(b);
  r.pos = 4;
  const flavor = r.u32();
  r.u32(); // length
  const numTables = r.u16();
  r.u16(); // reserved
  r.u32(); // totalSfntSize
  const totalCompressedSize = r.u32();
  r.pos = 48;
  // 表の目録 (§4.1): 変換した表は transformLength の長さで、展開したデータの中に順に並ぶ
  const dir: Woff2Entry[] = [];
  for (let k = 0; k < numTables; k++) {
    const flags = r.u8();
    const tagNo = flags & 0x3f;
    const tag = tagNo === 0x3f ? String.fromCharCode(...r.bytes(4)) : KNOWN_TAGS[tagNo];
    if (!tag) throw new Error('WOFF2: unknown table tag');
    const version = (flags >> 6) & 3;
    const origLength = r.base128();
    // glyf・loca は変換の版 0 が変換あり (3 は変換なし)、ほかの表は 0 が変換なし (§4.1)
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    dir.push({ tag, origLength, version, ...(transformed ? { transformLength: r.base128() } : {}) });
  }
  // 書体の集まりの目録 (§4.2): 書体ごとに、sfnt の版と、使う表の目録の番号
  const collection = flavor === 0x74746366;
  const fonts: Array<{ flavor: number; indices: number[] }> = [];
  if (collection) {
    r.u32(); // 元の TTC の見出しの版 (出力は版 1.0 にする。§4.2: 版 2.0 の DSIG の欄は捨ててよい)
    const numFonts = r.u255();
    for (let f = 0; f < numFonts; f++) {
      const n = r.u255();
      const fl = r.u32();
      const indices: number[] = [];
      for (let k = 0; k < n; k++) {
        const ix = r.u255();
        if (ix >= dir.length) throw new Error('WOFF2: bad table index in the collection directory');
        indices.push(ix);
      }
      fonts.push({ flavor: fl, indices });
    }
    if (!fonts.length) throw new Error('WOFF2: empty collection');
  } else fonts.push({ flavor, indices: dir.map((_, k) => k) });
  // Brotli の展開 (圧縮したデータは、目録のすぐ後ろから totalCompressedSize バイト。§5)
  if (r.pos + totalCompressedSize > b.length) throw new Error('WOFF2: the data is too short');
  const expected = dir.reduce((a, d) => a + (d.transformLength ?? d.origLength), 0);
  const data = brotliDecompress(b.subarray(r.pos, r.pos + totalCompressedSize), expected);
  if (data.length < expected) throw new Error('WOFF2: the decompressed data is too short');
  const raw: Uint8Array[] = [];
  let at = 0;
  for (const d of dir) {
    const len = d.transformLength ?? d.origLength;
    raw.push(data.subarray(at, at + len));
    at += len;
  }
  const out: Array<Uint8Array | undefined> = dir.map((d, k) => (d.transformLength === undefined ? raw[k].slice() : undefined));
  // glyf・loca の変換を戻す (§5.1〜5.3)。glyf の組の loca は、目録で glyf の後ろの最初の loca (§5.5。書体の集まりでは、すぐ後ろ)
  const xMinsOf = new Map<number, number[]>();
  const locaOf = new Map<number, number>();
  dir.forEach((d, gi) => {
    if (d.tag !== 'glyf') return;
    const li = dir.findIndex((e, k) => k > gi && e.tag === 'loca');
    if (li < 0 || (collection && li !== gi + 1)) throw new Error('WOFF2: glyf has no paired loca');
    locaOf.set(gi, li);
    if (d.transformLength === undefined) return;
    const g = reconstructGlyf(raw[gi]);
    out[gi] = g.glyf;
    out[li] = g.loca;
    xMinsOf.set(gi, g.xMins);
  });
  // 書体ごとの表の番号 (名前 → 番号)。書体の集まりでは、glyf と loca が組で使われているかを確かめる (§4.2)
  const byTag = fonts.map((f) => new Map(f.indices.map((ix) => [dir[ix].tag, ix])));
  for (const m of byTag) {
    const gi = m.get('glyf');
    if (gi !== undefined && m.get('loca') !== locaOf.get(gi)) throw new Error('WOFF2: glyf and loca are not paired');
  }
  // hmtx の変換を戻す (§5.4): 同じ書体の hhea・maxp と、glyf の外枠の xMin を使う
  dir.forEach((d, hi) => {
    if (d.tag !== 'hmtx' || d.transformLength === undefined) return;
    if (d.version !== 1) throw new Error('WOFF2: unknown hmtx transform');
    const m = byTag.find((t) => t.get('hmtx') === hi);
    const hhea = m?.get('hhea');
    const maxp = m?.get('maxp');
    if (hhea === undefined || maxp === undefined || !out[hhea] || !out[maxp]) throw new Error('WOFF2: hmtx needs hhea and maxp');
    const gi = m!.get('glyf');
    out[hi] = reconstructHmtx(raw[hi], out[hhea]!, out[maxp]!, gi !== undefined ? xMinsOf.get(gi) : undefined);
  });
  dir.forEach((d, k) => {
    if (!out[k]) throw new Error(`WOFF2: the transform of the table ${d.tag} is not supported`);
  });
  if (!collection) return buildSfnt(flavor, dir.map((d, k) => ({ tag: d.tag, data: out[k]! })));
  return buildTtc(fonts, dir.map((d) => d.tag), out as Uint8Array[]);
}

/**
 * Brotli の展開 (RFC 7932)。fontkit (@pdf-lib/fontkit 1.1.1) の WOFF2 の読み込みが持つ展開を使う: 圧縮したデータを、表が 1 つだけの
 * WOFF2 (変換なし・任意の名前の表) に包んで fontkit に読ませ、展開したデータを受け取る。size は展開した後の大きさ
 */
function brotliDecompress(comp: Uint8Array, size: number): Uint8Array {
  const entry = [0x3f, 0x5f, 0x5f, 0x5f, 0x5f]; // 任意の名前 '____' の表、変換なし
  const len: number[] = [size & 0x7f];
  for (let n = size >>> 7; n; n >>>= 7) len.unshift((n & 0x7f) | 0x80);
  const head = 48 + entry.length + len.length;
  const w = new Uint8Array(head + comp.length);
  const v = new DataView(w.buffer);
  w.set([0x77, 0x4f, 0x46, 0x32]); // wOF2
  v.setUint32(4, 0x00010000);
  v.setUint32(8, w.length);
  v.setUint16(12, 1);
  v.setUint32(16, size);
  v.setUint32(20, comp.length);
  w.set(entry, 48);
  w.set(len, 48 + entry.length);
  w.set(comp, head);
  const font = fontkit.create(w) as unknown as { _decompress?: () => void; stream?: { buffer?: Uint8Array } };
  if (typeof font._decompress !== 'function') throw new Error('WOFF2: cannot decompress (fontkit has no WOFF2 support)');
  font._decompress();
  const buf = font.stream?.buffer;
  if (!(buf instanceof Uint8Array)) throw new Error('WOFF2: cannot decompress');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * TTC (書体の集まり。OpenType の TTC Header の版 1.0) を組み立てる。表は 1 度だけ置き (分け合う表は、書体ごとの表の記録から同じ位置を指す)、
 * 書体の順は元のまま (§4.2)。head の checkSumAdjustment は元の値のまま
 */
function buildTtc(fonts: Array<{ flavor: number; indices: number[] }>, tags: string[], data: Uint8Array[]): ArrayBuffer {
  const headerLen = 12 + 4 * fonts.length;
  const dirLens = fonts.map((f) => 12 + 16 * f.indices.length);
  let offset = headerLen + dirLens.reduce((a, b) => a + b, 0);
  const tableAt: number[] = [];
  data.forEach((d, k) => {
    tableAt[k] = offset;
    offset += (d.length + 3) & ~3;
  });
  const w = new Writer();
  w.u32(0x74746366); // ttcf
  w.u32(0x00010000);
  w.u32(fonts.length);
  let dirAt = headerLen;
  for (const len of dirLens) {
    w.u32(dirAt);
    dirAt += len;
  }
  for (const f of fonts) {
    const n = f.indices.length;
    let pow = 1;
    let log = 0;
    while (pow * 2 <= n) {
      pow *= 2;
      log++;
    }
    w.u32(f.flavor);
    w.u16(n);
    w.u16(pow * 16);
    w.u16(log);
    w.u16(n * 16 - pow * 16);
    for (const ix of [...f.indices].sort((a, b) => (tags[a] < tags[b] ? -1 : tags[a] > tags[b] ? 1 : 0))) {
      for (let k = 0; k < 4; k++) w.u8(tags[ix].charCodeAt(k));
      w.u32(checksum(data[ix]));
      w.u32(tableAt[ix]);
      w.u32(data[ix].length);
    }
  }
  for (const d of data) {
    w.bytes(d);
    w.pad4();
  }
  return w.result().buffer;
}

/** glyf の点の組の読み方 (§5.2 の表: 先頭の 1 バイトの値で、差のバイト数と符号が決まる) */
function tripletDecode(flag: number, r: Reader): [number, number] {
  const sign = (f: number, v: number) => (f & 1 ? v : -v);
  if (flag < 10) return [0, sign(flag, ((flag & 14) << 7) + r.u8())];
  if (flag < 20) return [sign(flag, (((flag - 10) & 14) << 7) + r.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20;
    const b1 = r.u8();
    return [sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    const d0 = r.u8();
    const d1 = r.u8();
    return [sign(flag, 1 + (Math.floor(b0 / 12) << 8) + d0), sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + d1)];
  }
  if (flag < 124) {
    const d0 = r.u8();
    const b2 = r.u8();
    const d2 = r.u8();
    return [sign(flag, (d0 << 4) + (b2 >> 4)), sign(flag >> 1, ((b2 & 0x0f) << 8) + d2)];
  }
  const d0 = r.u8();
  const d1 = r.u8();
  const d2 = r.u8();
  const d3 = r.u8();
  return [sign(flag, (d0 << 8) + d1), sign(flag >> 1, (d2 << 8) + d3)];
}

/** 書き足していく、大きさの伸びるバイト列 */
class Writer {
  private buf = new Uint8Array(1024);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  u8(x: number) {
    this.grow(1);
    this.buf[this.len++] = x & 0xff;
  }
  u16(x: number) {
    this.grow(2);
    this.buf[this.len++] = (x >> 8) & 0xff;
    this.buf[this.len++] = x & 0xff;
  }
  u32(x: number) {
    this.u16((x >>> 16) & 0xffff);
    this.u16(x & 0xffff);
  }
  bytes(b: Uint8Array) {
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  pad4() {
    while (this.len % 4) this.u8(0);
  }
  result() {
    return this.buf.slice(0, this.len);
  }
}

/** 変換した glyf を元の glyf と loca に戻す (§5.1 の形、§5.3 の手順)。xMins は hmtx の左の余白を補うのに使う */
function reconstructGlyf(data: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; xMins: number[] } {
  const h = new Reader(data);
  h.u16(); // reserved
  const optionFlags = h.u16();
  const numGlyphs = h.u16();
  const indexFormat = h.u16();
  const sizes = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  // 7 つの流れ: 輪郭の数・点の数・点の印・点の座標 (と命令の長さ)・複合の字形・外枠・命令
  let at = h.pos;
  const streams = sizes.map((n) => {
    if (at + n > data.length) throw new Error('WOFF2: glyf stream out of range');
    const s = data.subarray(at, at + n);
    at += n;
    return s;
  });
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = streams.map((s) => new Reader(s));
  // 外枠の流れは、字形ごとの「外枠を書いたか」のビット表で始まる
  const bitmapLen = 4 * Math.floor((numGlyphs + 31) / 32);
  const bboxBitmap = bboxS.bytes(bitmapLen);
  const hasBbox = (i: number) => (bboxBitmap[i >> 3] & (0x80 >> (i & 7))) !== 0;
  // 単純な字形の輪郭の重なりのビット表 (optionFlags の 0 ビット目。§5.1)
  const overlap = optionFlags & 1 ? data.subarray(at, at + Math.floor((numGlyphs + 7) / 8)) : undefined;
  const hasOverlap = (i: number) => !!overlap && (overlap[i >> 3] & (0x80 >> (i & 7))) !== 0;

  const glyf = new Writer();
  const offsets: number[] = [];
  const xMins: number[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    offsets.push(glyf.len);
    const nContours = nContourS.i16();
    if (nContours === 0) {
      // 空の字形 (外枠を書いてはいけない)
      if (hasBbox(i)) throw new Error('WOFF2: empty glyph with a bounding box');
      xMins.push(0);
      continue;
    }
    if (nContours > 0) {
      // 単純な字形
      const ends: number[] = [];
      let total = 0;
      for (let k = 0; k < nContours; k++) {
        total += nPointsS.u255();
        ends.push(total - 1);
      }
      const pts: Array<{ x: number; y: number; on: boolean }> = [];
      let x = 0;
      let y = 0;
      for (let k = 0; k < total; k++) {
        const f = flagS.u8();
        const [dx, dy] = tripletDecode(f & 0x7f, glyphS);
        x += dx;
        y += dy;
        pts.push({ x, y, on: !(f & 0x80) });
      }
      const instrLen = glyphS.u255();
      const instr = instrS.bytes(instrLen);
      let box: [number, number, number, number];
      if (hasBbox(i)) box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      else {
        box = [Infinity, Infinity, -Infinity, -Infinity];
        for (const p of pts) box = [Math.min(box[0], p.x), Math.min(box[1], p.y), Math.max(box[2], p.x), Math.max(box[3], p.y)];
      }
      xMins.push(box[0]);
      glyf.u16(nContours);
      for (const v of box) glyf.u16(v & 0xffff);
      for (const e of ends) glyf.u16(e);
      glyf.u16(instrLen);
      glyf.bytes(instr);
      // 点の印と座標 (TrueType の glyf の単純な字形の形。差が 0 なら座標を書かず、1 バイトで足りれば短い形)
      const xs = new Writer();
      const ys = new Writer();
      let px = 0;
      let py = 0;
      pts.forEach((p, k) => {
        let fl = p.on ? 1 : 0;
        if (k === 0 && hasOverlap(i)) fl |= 0x40; // OVERLAP_SIMPLE
        const dx = p.x - px;
        const dy = p.y - py;
        if (dx === 0) fl |= 0x10;
        else if (dx > -256 && dx < 256) {
          fl |= 0x02 | (dx > 0 ? 0x10 : 0);
          xs.u8(Math.abs(dx));
        } else xs.u16(dx & 0xffff);
        if (dy === 0) fl |= 0x20;
        else if (dy > -256 && dy < 256) {
          fl |= 0x04 | (dy > 0 ? 0x20 : 0);
          ys.u8(Math.abs(dy));
        } else ys.u16(dy & 0xffff);
        glyf.u8(fl);
        px = p.x;
        py = p.y;
      });
      glyf.bytes(xs.result());
      glyf.bytes(ys.result());
    } else {
      // 複合の字形: 部品の記述をそのまま写す (外枠は必ず書いてある)
      if (!hasBbox(i)) throw new Error('WOFF2: composite glyph without a bounding box');
      const box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      xMins.push(box[0]);
      glyf.u16(nContours & 0xffff);
      for (const v of box) glyf.u16(v & 0xffff);
      const start = compositeS.pos;
      let haveInstr = false;
      for (;;) {
        const fl = compositeS.u16();
        compositeS.u16(); // glyphIndex
        compositeS.bytes(fl & 0x0001 ? 4 : 2); // ARG_1_AND_2_ARE_WORDS
        if (fl & 0x0008) compositeS.bytes(2); // WE_HAVE_A_SCALE
        else if (fl & 0x0040) compositeS.bytes(4); // WE_HAVE_AN_X_AND_Y_SCALE
        else if (fl & 0x0080) compositeS.bytes(8); // WE_HAVE_A_TWO_BY_TWO
        if (fl & 0x0100) haveInstr = true; // WE_HAVE_INSTRUCTIONS
        if (!(fl & 0x0020)) break; // MORE_COMPONENTS
      }
      glyf.bytes(compositeS.since(start));
      if (haveInstr) {
        const n = glyphS.u255();
        glyf.u16(n);
        glyf.bytes(instrS.bytes(n));
      }
    }
    glyf.pad4();
  }
  offsets.push(glyf.len);
  // loca (indexFormat 0 は 2 で割った 16 ビット、1 は 32 ビット)
  const loca = new Writer();
  for (const o of offsets) {
    if (indexFormat === 0) loca.u16(o / 2);
    else loca.u32(o);
  }
  return { glyf: glyf.result(), loca: loca.result(), xMins };
}

/** 変換した hmtx を戻す (§5.4): 省いた左の余白 (lsb) は、字形の外枠の xMin で補う */
function reconstructHmtx(data: Uint8Array, hhea: Uint8Array, maxp: Uint8Array, xMins: number[] | undefined): Uint8Array {
  const numberOfHMetrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
  const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
  const r = new Reader(data);
  const flags = r.u8();
  const adv: number[] = [];
  for (let k = 0; k < numberOfHMetrics; k++) adv.push(r.u16());
  const lsbFromGlyf = (k: number) => {
    if (!xMins) throw new Error('WOFF2: hmtx without glyf');
    return xMins[k] ?? 0;
  };
  const lsb: number[] = [];
  for (let k = 0; k < numberOfHMetrics; k++) lsb.push(flags & 1 ? lsbFromGlyf(k) : r.i16());
  for (let k = numberOfHMetrics; k < numGlyphs; k++) lsb.push(flags & 2 ? lsbFromGlyf(k) : r.i16());
  const w = new Writer();
  for (let k = 0; k < numberOfHMetrics; k++) {
    w.u16(adv[k]);
    w.u16(lsb[k] & 0xffff);
  }
  for (let k = numberOfHMetrics; k < numGlyphs; k++) w.u16(lsb[k] & 0xffff);
  return w.result();
}

/** 表の検査値 (OpenType の table directory: 4 バイトずつの和) */
function checksum(d: Uint8Array): number {
  let sum = 0;
  for (let k = 0; k < d.length; k += 4) sum = (sum + ((d[k] << 24) | ((d[k + 1] ?? 0) << 16) | ((d[k + 2] ?? 0) << 8) | (d[k + 3] ?? 0))) >>> 0;
  return sum;
}

/** sfnt を組み立てる (OpenType の table directory。表の記録は名前の順、表は 4 バイトの境に置く。head の checkSumAdjustment を計算し直す) */
function buildSfnt(flavor: number, tables: Table[]): ArrayBuffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  // head の checkSumAdjustment は 0 にしてから検査値を取る
  const head = sorted.find((t) => t.tag === 'head');
  if (head && head.data.length >= 12) {
    head.data = head.data.slice();
    head.data.set([0, 0, 0, 0], 8);
  }
  const w = new Writer();
  w.u32(flavor);
  w.u16(n);
  w.u16(pow * 16);
  w.u16(log);
  w.u16(n * 16 - pow * 16);
  let offset = 12 + 16 * n;
  for (const t of sorted) {
    for (let k = 0; k < 4; k++) w.u8(t.tag.charCodeAt(k));
    w.u32(checksum(t.data));
    w.u32(offset);
    w.u32(t.data.length);
    offset += (t.data.length + 3) & ~3;
  }
  for (const t of sorted) {
    w.bytes(t.data);
    w.pad4();
  }
  const out = w.result();
  if (head) {
    const at = 12 + 16 * n + sorted.slice(0, sorted.indexOf(head)).reduce((a, t) => a + ((t.data.length + 3) & ~3), 0);
    const adj = (0xb1b0afba - checksum(out)) >>> 0;
    new DataView(out.buffer).setUint32(at + 8, adj);
  }
  return out.buffer;
}
