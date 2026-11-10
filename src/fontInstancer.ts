/**
 * fontInstancer — 可変フォント (OpenType Font Variations) の、軸の値を決めた「実体 (instance)」を、静的な書体のファイルとして作る。
 *
 * PDF は可変フォントを直接は扱えない (ISO 32000-2 の書体の種類に Font Variations は無い) ので、実体ごとに、
 * 輪郭・送り・位置合わせの値に差分を当てた静的な書体を作り、これまでの書体と同じ道 (fontkit で測る・部分書体にして埋める・
 * ブラウザに登録して描く) に流す。測る書体と描く書体が同じバイト列になるので、実体でも字の幅は食い違わない。
 *
 * 根拠は OpenType の仕様 (https://learn.microsoft.com/typography/opentype/spec/):
 *  - 軸の値の正規化と差分の重みの計算: 「OpenType Font Variations Overview」の Coordinate scales and normalization・
 *    Algorithm for interpolation of instance values ('fvar'・'avar')
 *  - 輪郭の差分: 'gvar' (Tuple Variation Store、Inferred deltas for un-referenced point numbers、幻影の点 phantom points)
 *  - 送り: 'HVAR'・'VVAR' (Item Variation Store と DeltaSetIndexMap。「OpenType Font Variations Common Table Formats」)。無ければ gvar の幻影の点
 *  - 書体全体の寸法: 'MVAR' (Value tags)
 *  - 位置合わせ: 'GDEF' の Item Variation Store と、'GPOS' の ValueRecord・Anchor の VariationIndex 表
 *  - 軸の値による機能の差し替え: 'GSUB'・'GPOS' の FeatureVariations 表 (「OpenType Layout Common Table Formats」)
 *  - ヒントの制御値: 'cvar'
 *
 * 輪郭は、TrueType ('glyf' + 'gvar') と CFF2 (可変の CFF) の両方。CFF2 の実体は、静的な CFF (版 1) の OpenType にする
 * (字形の差分 blend を計算して Type 2 の CharString に書き直す。cff2Instancer.ts)。送り・書体全体の寸法・位置合わせ・機能の差し替えは、
 * TrueType の輪郭と同じ扱い。輪郭の差分をどちらの形でも持たない可変フォント (readVariationInfo の unsupported が真) は、実体を作れない
 * (呼び出し側が、既定の形のまま使う)。
 */
import { instantiateCff2 } from './cff2Instancer';

/** 可変フォントの軸 ('fvar' の VariationAxisRecord) */
export interface VariationAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

/** 可変フォントの軸と、名前つきの実体 ('fvar' の InstanceRecord) */
export interface VariationInfo {
  axes: VariationAxis[];
  /** 名前つきの実体: 名前 ('name' 表の subfamilyNameID の文字列。読めなければ空) と、軸の値 (axes と同じ順) */
  instances: Array<{ name: string; coords: number[] }>;
  /** 輪郭が CFF2 (可変の CFF)。実体は、静的な CFF の OpenType になる */
  cff2: boolean;
  /** 実体を作れない (輪郭の差分を、TrueType の 'glyf' + 'gvar' でも CFF2 でも持たない) */
  unsupported: boolean;
}

interface TableRec {
  tag: string;
  offset: number;
  length: number;
}

const tagAt = (dv: DataView, o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

function tableDirectory(dv: DataView): Map<string, TableRec> | undefined {
  if (dv.byteLength < 12) return undefined;
  const ver = dv.getUint32(0);
  if (ver !== 0x00010000 && ver !== 0x4f54544f && ver !== 0x74727565) return undefined;
  const n = dv.getUint16(4);
  const out = new Map<string, TableRec>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (o + 16 > dv.byteLength) return undefined;
    const rec = { tag: tagAt(dv, o), offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
    if (rec.offset + rec.length > dv.byteLength) return undefined;
    out.set(rec.tag, rec);
  }
  return out;
}

/** 'name' 表から、nameID の文字列 (Windows の Unicode の英語を先に、無ければ最初に読めるもの) */
function nameString(dv: DataView, rec: TableRec | undefined, nameId: number): string {
  if (!rec || rec.length < 6) return '';
  const base = rec.offset;
  const count = dv.getUint16(base + 2);
  const strings = base + dv.getUint16(base + 4);
  let best = '';
  let bestRank = -1;
  for (let i = 0; i < count; i++) {
    const o = base + 6 + i * 12;
    if (o + 12 > base + rec.length) break;
    if (dv.getUint16(o + 6) !== nameId) continue;
    const platform = dv.getUint16(o);
    const lang = dv.getUint16(o + 4);
    const len = dv.getUint16(o + 8);
    const off = strings + dv.getUint16(o + 10);
    if (off + len > dv.byteLength) continue;
    let s = '';
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k));
    else if (platform === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(dv.getUint8(off + k));
    else continue;
    const rank = platform === 3 && lang === 0x409 ? 3 : platform === 3 ? 2 : platform === 0 ? 1 : 0;
    if (rank > bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * 可変フォントの実体の PostScript 名の接頭辞: 'name' 表の nameID 25 (Variations PostScript Name Prefix)、無ければ
 * nameID 16 (Typographic Family)、nameID 1 (Family) から、英数字でない字を除いたもの (Adobe Technical Note #5902 の作り方)
 */
export function variationNamePrefix(buffer: ArrayBuffer): string {
  const dv = new DataView(buffer);
  const name = tableDirectory(dv)?.get('name');
  for (const id of [25, 16, 1]) {
    const s = nameString(dv, name, id).replace(/[^A-Za-z0-9]/g, '');
    if (s) return s;
  }
  return '';
}

/** 書体のファイルが可変フォントなら、軸と名前つきの実体 ('fvar')。可変フォントでなければ undefined */
export function readVariationInfo(buffer: ArrayBuffer): VariationInfo | undefined {
  const dv = new DataView(buffer);
  const dir = tableDirectory(dv);
  const fvar = dir?.get('fvar');
  if (!dir || !fvar || fvar.length < 16) return undefined;
  const b = fvar.offset;
  const axesOffset = dv.getUint16(b + 4);
  const axisCount = dv.getUint16(b + 8);
  const axisSize = dv.getUint16(b + 10);
  const instanceCount = dv.getUint16(b + 12);
  const instanceSize = dv.getUint16(b + 14);
  if (!axisCount || axisSize < 20 || axesOffset + axisCount * axisSize + instanceCount * instanceSize > fvar.length) return undefined;
  const axes: VariationAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const o = b + axesOffset + i * axisSize;
    axes.push({ tag: tagAt(dv, o), min: dv.getInt32(o + 4) / 65536, default: dv.getInt32(o + 8) / 65536, max: dv.getInt32(o + 12) / 65536 });
  }
  const instances: VariationInfo['instances'] = [];
  const name = dir.get('name');
  for (let i = 0; i < instanceCount; i++) {
    const o = b + axesOffset + axisCount * axisSize + i * instanceSize;
    if (instanceSize < 4 + axisCount * 4) break;
    const coords: number[] = [];
    for (let a = 0; a < axisCount; a++) coords.push(dv.getInt32(o + 4 + a * 4) / 65536);
    instances.push({ name: nameString(dv, name, dv.getUint16(o)), coords });
  }
  const cff2 = dir.has('CFF2');
  return { axes, instances, cff2, unsupported: !cff2 && (!dir.has('glyf') || !dir.has('gvar')) };
}

/** 仕様の丸め (0.5 は上へ)。fontTools の otRound と同じ */
const otRound = (v: number) => Math.floor(v + 0.5);

/**
 * 軸の値 (利用者の尺度) を、正規化した値 (F2Dot14 の整数。-16384〜16384) にする。
 * Overview の「Coordinate scales and normalization」: 範囲に収め、既定の値の両側を別々に -1〜0・0〜1 に写し、
 * 'avar' の区分の写像 (version 1 の SegmentMaps) を当て、16.16 から 2.14 へ「2 を足して右へ 2 ずらす」で丸める
 */
export function normalizeCoords(buffer: ArrayBuffer, axes: readonly VariationAxis[], user: readonly number[]): number[] {
  const dv = new DataView(buffer);
  const avar = tableDirectory(dv)?.get('avar');
  const toFixed = (v: number) => otRound(v * 65536);
  const out: number[] = [];
  let seg = avar && avar.length >= 8 && dv.getUint16(avar.offset) === 1 && dv.getUint16(avar.offset + 6) === axes.length ? avar.offset + 8 : -1;
  axes.forEach((ax, i) => {
    const v = toFixed(Math.min(ax.max, Math.max(ax.min, user[i])));
    const d = toFixed(ax.default);
    const lo = toFixed(ax.min);
    const hi = toFixed(ax.max);
    let n = 0;
    if (v < d && d > lo) n = -otRound(((d - v) * 65536) / (d - lo));
    else if (v > d && hi > d) n = otRound(((v - d) * 65536) / (hi - d));
    n = Math.min(65536, Math.max(-65536, n));
    if (seg >= 0 && seg + 2 <= avar!.offset + avar!.length) {
      const count = dv.getUint16(seg);
      const maps = seg + 2;
      if (maps + count * 4 > avar!.offset + avar!.length) seg = -1;
      else {
        // 最初に fromCoordinate が n 以上になる記録 (endSeg) を探し、その前の記録との間を直線で補う
        for (let k = 0; k < count; k++) {
          const from = dv.getInt16(maps + k * 4) * 4;
          const to = dv.getInt16(maps + k * 4 + 2) * 4;
          if (from < n) continue;
          if (from === n || k === 0) n = to;
          else {
            const from0 = dv.getInt16(maps + (k - 1) * 4) * 4;
            const to0 = dv.getInt16(maps + (k - 1) * 4 + 2) * 4;
            n = to0 + otRound(((n - from0) * (to - to0)) / (from - from0));
          }
          break;
        }
        n = Math.min(65536, Math.max(-65536, n));
        seg = maps + count * 4;
      }
    }
    out.push((n + 2) >> 2);
  });
  return out;
}

/** 領域 (軸ごとの start・peak・end。F2Dot14 の整数) での重み。Overview の「Algorithm for interpolation of instance values」 */
function regionScalar(coords: readonly number[], axisCount: number, peak: (i: number) => number, start?: (i: number) => number, end?: (i: number) => number): number {
  let s = 1;
  for (let i = 0; i < axisCount; i++) {
    const p = peak(i);
    if (p === 0) continue;
    const v = coords[i];
    if (start && end) {
      const a = start(i);
      const b = end(i);
      if (a > p || p > b) continue;
      if (a < 0 && b > 0) continue;
      if (v < a || v > b) return 0;
      if (v === p) continue;
      s *= v < p ? (v - a) / (p - a) : (b - v) / (b - p);
    } else {
      // 途中の領域でない組: 0 から頂点までの範囲
      if (v === 0 || (v < 0) !== (p < 0) || Math.abs(v) > Math.abs(p)) return 0;
      s *= v / p;
    }
    if (s === 0) return 0;
  }
  return s;
}

/** Item Variation Store (Common Table Formats): 領域ごとの重みを先に計算し、(外・内) の番号の差分の合計を返す */
class ItemVariationStore {
  private scalars: number[] = [];
  private data: number[] = [];
  private ok = false;
  constructor(
    private dv: DataView,
    base: number,
    limit: number,
    coords: readonly number[],
  ) {
    if (base + 8 > limit || dv.getUint16(base) !== 1) return;
    const regions = base + dv.getUint32(base + 2);
    const dataCount = dv.getUint16(base + 6);
    if (regions + 4 > limit || base + 8 + dataCount * 4 > limit) return;
    const axisCount = dv.getUint16(regions);
    const regionCount = dv.getUint16(regions + 2);
    if (regions + 4 + regionCount * axisCount * 6 > limit) return;
    for (let r = 0; r < regionCount; r++) {
      const o = regions + 4 + r * axisCount * 6;
      this.scalars.push(
        regionScalar(
          coords,
          Math.min(axisCount, coords.length),
          (i) => dv.getInt16(o + i * 6 + 2),
          (i) => dv.getInt16(o + i * 6),
          (i) => dv.getInt16(o + i * 6 + 4),
        ),
      );
    }
    for (let i = 0; i < dataCount; i++) this.data.push(base + dv.getUint32(base + 8 + i * 4));
    this.limit = limit;
    this.ok = true;
  }
  private limit = 0;
  /**
   * 差分の組 outer (ItemVariationData) が使う領域の重み (regionIndexes の順)。組が無ければ undefined。
   * CFF2 の blend は、差分をこの表ではなく字形の中に持ち、領域の並びだけをここから引く (CFF2 の表の「VariationStore」)
   */
  regionScalars(outer: number): number[] | undefined {
    if (!this.ok || outer < 0 || outer >= this.data.length) return undefined;
    const d = this.data[outer];
    if (d + 6 > this.limit) return undefined;
    const regionCount = this.dv.getUint16(d + 4);
    if (d + 6 + regionCount * 2 > this.limit) return undefined;
    const out: number[] = [];
    for (let r = 0; r < regionCount; r++) out.push(this.scalars[this.dv.getUint16(d + 6 + r * 2)] ?? 0);
    return out;
  }
  /** 差分の合計 (丸めない)。番号が表に無ければ 0 */
  delta(outer: number, inner: number): number {
    if (!this.ok || outer >= this.data.length) return 0;
    const dv = this.dv;
    const d = this.data[outer];
    if (d + 6 > this.limit) return 0;
    const itemCount = dv.getUint16(d);
    const wordCountRaw = dv.getUint16(d + 2);
    const regionCount = dv.getUint16(d + 4);
    if (inner >= itemCount) return 0;
    const long = !!(wordCountRaw & 0x8000);
    const wordCount = wordCountRaw & 0x7fff;
    const big = long ? 4 : 2;
    const small = long ? 2 : 1;
    const rowSize = wordCount * big + (regionCount - wordCount) * small;
    let o = d + 6 + regionCount * 2 + inner * rowSize;
    if (o + rowSize > this.limit) return 0;
    let sum = 0;
    for (let r = 0; r < regionCount; r++) {
      const s = this.scalars[dv.getUint16(d + 6 + r * 2)] ?? 0;
      let v: number;
      if (r < wordCount) {
        v = long ? dv.getInt32(o) : dv.getInt16(o);
        o += big;
      } else {
        v = long ? dv.getInt16(o) : dv.getInt8(o);
        o += small;
      }
      if (s) sum += s * v;
    }
    return sum;
  }
}

/** DeltaSetIndexMap (Common Table Formats): 項目の番号 → (外, 内)。表が無ければ (0, 番号) */
function deltaSetIndex(dv: DataView, map: number, index: number): [number, number] {
  if (!map) return [0, index];
  const format = dv.getUint8(map);
  const entryFormat = dv.getUint8(map + 1);
  const count = format === 1 ? dv.getUint32(map + 2) : dv.getUint16(map + 2);
  if (!count) return [0, index];
  const data = map + (format === 1 ? 6 : 4);
  const size = ((entryFormat & 0x30) >> 4) + 1;
  const o = data + Math.min(index, count - 1) * size;
  let entry = 0;
  for (let k = 0; k < size; k++) entry = entry * 256 + dv.getUint8(o + k);
  const bits = (entryFormat & 0x0f) + 1;
  return [Math.floor(entry / 2 ** bits), entry % 2 ** bits];
}

/** Tuple Variation Store の、詰めた点の番号 (Packed "point" numbers)。null は「すべての点」 */
function readPoints(dv: DataView, pos: { o: number }): number[] | null {
  let count = dv.getUint8(pos.o++);
  if (count === 0) return null;
  if (count & 0x80) count = ((count & 0x7f) << 8) | dv.getUint8(pos.o++);
  const pts: number[] = [];
  let p = 0;
  while (pts.length < count) {
    const c = dv.getUint8(pos.o++);
    const words = !!(c & 0x80);
    let n = (c & 0x7f) + 1;
    while (n-- > 0 && pts.length < count) {
      p += words ? dv.getUint16(pos.o) : dv.getUint8(pos.o);
      pos.o += words ? 2 : 1;
      pts.push(p);
    }
  }
  return pts;
}

/** Tuple Variation Store の、詰めた差分 (Packed deltas) を n 個、out に読む */
function readDeltas(dv: DataView, pos: { o: number }, n: number, out: Float64Array) {
  let i = 0;
  while (i < n) {
    const c = dv.getUint8(pos.o++);
    let run = (c & 0x3f) + 1;
    if (c & 0x80) {
      while (run-- > 0 && i < n) out[i++] = 0;
    } else if (c & 0x40) {
      while (run-- > 0 && i < n) {
        out[i++] = dv.getInt16(pos.o);
        pos.o += 2;
      }
    } else {
      while (run-- > 0 && i < n) out[i++] = dv.getInt8(pos.o++);
    }
  }
}

/**
 * Tuple Variation Store (gvar の GlyphVariationData・cvar) を 1 つ読み、当たる組ごとに apply(重み, 点の番号 (null はすべて), x の差分, y の差分) を呼ぶ。
 * headerAt: TupleVariationHeader の並びの先頭、dataAt: 直列化した差分の先頭、sharedTuples: gvar の共有の頂点 (cvar は -1)
 */
function eachTuple(
  dv: DataView,
  headerAt: number,
  tupleCountRaw: number,
  dataAt: number,
  limit: number,
  axisCount: number,
  sharedTuples: number,
  sharedCount: number,
  coords: readonly number[],
  pointCount: number,
  twoCoords: boolean,
  apply: (scalar: number, points: number[] | null, dx: Float64Array, dy: Float64Array) => void,
) {
  const count = tupleCountRaw & 0x0fff;
  const pos = { o: dataAt };
  let shared: number[] | null = null;
  if (tupleCountRaw & 0x8000) shared = readPoints(dv, pos);
  let h = headerAt;
  let data = pos.o;
  const dx = new Float64Array(pointCount);
  const dy = new Float64Array(pointCount);
  for (let t = 0; t < count; t++) {
    if (h + 4 > limit) return;
    const size = dv.getUint16(h);
    const index = dv.getUint16(h + 2);
    h += 4;
    let peakAt: number;
    if (index & 0x8000) {
      peakAt = h;
      h += axisCount * 2;
    } else {
      const k = index & 0x0fff;
      if (sharedTuples < 0 || k >= sharedCount) return;
      peakAt = sharedTuples + k * axisCount * 2;
    }
    let scalar: number;
    if (index & 0x4000) {
      const s = h;
      const e = h + axisCount * 2;
      h += axisCount * 4;
      scalar = regionScalar(
        coords,
        axisCount,
        (i) => dv.getInt16(peakAt + i * 2),
        (i) => dv.getInt16(s + i * 2),
        (i) => dv.getInt16(e + i * 2),
      );
    } else scalar = regionScalar(coords, axisCount, (i) => dv.getInt16(peakAt + i * 2));
    if (scalar !== 0 && data + size <= limit) {
      const p = { o: data };
      const points = index & 0x2000 ? readPoints(dv, p) : shared;
      const n = points ? points.length : pointCount;
      {
        const bx = points ? new Float64Array(n) : dx;
        const by = points ? new Float64Array(n) : dy;
        readDeltas(dv, p, n, bx);
        if (twoCoords) readDeltas(dv, p, n, by);
        apply(scalar, points, bx, by);
      }
    }
    data += size;
  }
}

/** 触れていない点の差分の補い (gvar の「Inferred deltas for un-referenced point numbers」)。1 つの座標について */
function inferDelta(o: number, o1: number, o2: number, d1: number, d2: number): number {
  if (o1 === o2) return d1 === d2 ? d1 : 0;
  if (o1 > o2) {
    const t = o1;
    o1 = o2;
    o2 = t;
    const u = d1;
    d1 = d2;
    d2 = u;
  }
  if (o <= o1) return d1;
  if (o >= o2) return d2;
  return d1 + ((o - o1) * (d2 - d1)) / (o2 - o1);
}

/** 単純な字形 (輪郭を点で持つ) を読んだもの */
interface SimpleGlyph {
  endPts: number[];
  instructions: Uint8Array;
  flags: Uint8Array;
  xs: Float64Array;
  ys: Float64Array;
}

function parseSimple(u8: Uint8Array, dv: DataView, at: number, contours: number): SimpleGlyph {
  let o = at + 10;
  const endPts: number[] = [];
  for (let i = 0; i < contours; i++) {
    endPts.push(dv.getUint16(o));
    o += 2;
  }
  const n = contours ? endPts[contours - 1] + 1 : 0;
  const ilen = dv.getUint16(o);
  o += 2;
  const instructions = u8.subarray(o, o + ilen);
  o += ilen;
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; ) {
    const f = u8[o++];
    flags[i++] = f;
    if (f & 0x08) {
      let r = u8[o++];
      while (r-- > 0 && i < n) flags[i++] = f;
    }
  }
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const f = flags[i];
    if (f & 0x02) v += f & 0x10 ? u8[o++] : -u8[o++];
    else if (!(f & 0x10)) {
      v += dv.getInt16(o);
      o += 2;
    }
    xs[i] = v;
  }
  v = 0;
  for (let i = 0; i < n; i++) {
    const f = flags[i];
    if (f & 0x04) v += f & 0x20 ? u8[o++] : -u8[o++];
    else if (!(f & 0x20)) {
      v += dv.getInt16(o);
      o += 2;
    }
    ys[i] = v;
  }
  return { endPts, instructions, flags, xs, ys };
}

/** 単純な字形を書き出す (座標は整数)。点が重なりうるので、最初の点に OVERLAP_SIMPLE を立てる ('glyf' の Simple glyph flags) */
function writeSimple(g: SimpleGlyph, xs: Int32Array, ys: Int32Array, bbox: [number, number, number, number]): Uint8Array {
  const n = xs.length;
  const flags = new Uint8Array(n);
  const xb: number[] = [];
  const yb: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    let f = (g.flags[i] & 0x01) | (i === 0 ? 0x40 : 0);
    const dx = xs[i] - px;
    const dy = ys[i] - py;
    if (dx === 0) f |= 0x10;
    else if (dx >= -255 && dx <= 255) {
      f |= 0x02 | (dx > 0 ? 0x10 : 0);
      xb.push(Math.abs(dx));
    } else xb.push((dx >> 8) & 0xff, dx & 0xff);
    if (dy === 0) f |= 0x20;
    else if (dy >= -255 && dy <= 255) {
      f |= 0x04 | (dy > 0 ? 0x20 : 0);
      yb.push(Math.abs(dy));
    } else yb.push((dy >> 8) & 0xff, dy & 0xff);
    flags[i] = f;
    px = xs[i];
    py = ys[i];
  }
  const fb: number[] = [];
  for (let i = 0; i < n; ) {
    let r = 1;
    while (i + r < n && flags[i + r] === flags[i] && r < 256) r++;
    if (r > 1) fb.push(flags[i] | 0x08, r - 1);
    else fb.push(flags[i]);
    i += r;
  }
  const size = 10 + g.endPts.length * 2 + 2 + g.instructions.length + fb.length + xb.length + yb.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setInt16(0, g.endPts.length);
  dv.setInt16(2, bbox[0]);
  dv.setInt16(4, bbox[1]);
  dv.setInt16(6, bbox[2]);
  dv.setInt16(8, bbox[3]);
  let o = 10;
  for (const e of g.endPts) {
    dv.setUint16(o, e);
    o += 2;
  }
  dv.setUint16(o, g.instructions.length);
  o += 2;
  out.set(g.instructions, o);
  o += g.instructions.length;
  out.set(fb, o);
  o += fb.length;
  out.set(xb, o);
  o += xb.length;
  out.set(yb, o);
  return out;
}

/** 複合の字形の部品 ('glyf' の Composite glyph description) */
interface Component {
  flags: number;
  glyph: number;
  arg1: number;
  arg2: number;
  /** 変形 (xscale, scale01, scale10, yscale) の F2Dot14 の値の並び (0・1・2・4 個) */
  transform: number[];
}

function parseComposite(dv: DataView, at: number): { components: Component[]; instructions: [number, number] | null } {
  let o = at + 10;
  const components: Component[] = [];
  let flags: number;
  do {
    flags = dv.getUint16(o);
    const glyph = dv.getUint16(o + 2);
    o += 4;
    let arg1: number;
    let arg2: number;
    if (flags & 0x0001) {
      arg1 = flags & 0x0002 ? dv.getInt16(o) : dv.getUint16(o);
      arg2 = flags & 0x0002 ? dv.getInt16(o + 2) : dv.getUint16(o + 2);
      o += 4;
    } else {
      arg1 = flags & 0x0002 ? dv.getInt8(o) : dv.getUint8(o);
      arg2 = flags & 0x0002 ? dv.getInt8(o + 1) : dv.getUint8(o + 1);
      o += 2;
    }
    const transform: number[] = [];
    const nt = flags & 0x0008 ? 1 : flags & 0x0040 ? 2 : flags & 0x0080 ? 4 : 0;
    for (let k = 0; k < nt; k++) {
      transform.push(dv.getInt16(o));
      o += 2;
    }
    components.push({ flags, glyph, arg1, arg2, transform });
  } while (flags & 0x0020);
  let instructions: [number, number] | null = null;
  if (flags & 0x0100) {
    const n = dv.getUint16(o);
    instructions = [o + 2, n];
  }
  return { components, instructions };
}

function writeComposite(c: { components: Component[] }, instr: Uint8Array | null, bbox: [number, number, number, number]): Uint8Array {
  let size = 10;
  for (const p of c.components) size += 4 + 4 + p.transform.length * 2;
  if (instr) size += 2 + instr.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setInt16(0, -1);
  dv.setInt16(2, bbox[0]);
  dv.setInt16(4, bbox[1]);
  dv.setInt16(6, bbox[2]);
  dv.setInt16(8, bbox[3]);
  let o = 10;
  c.components.forEach((p, i) => {
    // 引数は 16 ビットで書く (ARG_1_AND_2_ARE_WORDS)。最初の部品に OVERLAP_COMPOUND を立てる
    const f = (p.flags & ~0x0020 & ~0x0100) | 0x0001 | (i === 0 ? 0x0400 : 0) | (i < c.components.length - 1 ? 0x0020 : 0) | (instr && i === c.components.length - 1 ? 0x0100 : 0);
    dv.setUint16(o, f);
    dv.setUint16(o + 2, p.glyph);
    if (p.flags & 0x0002) {
      dv.setInt16(o + 4, p.arg1);
      dv.setInt16(o + 6, p.arg2);
    } else {
      dv.setUint16(o + 4, p.arg1);
      dv.setUint16(o + 6, p.arg2);
    }
    o += 8;
    for (const t of p.transform) {
      dv.setInt16(o, t);
      o += 2;
    }
  });
  if (instr) {
    dv.setUint16(o, instr.length);
    out.set(instr, o + 2);
  }
  return out;
}

/** 4 バイト単位の検査合計 ('head' の checkSumAdjustment・表の記録の checksum) */
function checksum(u8: Uint8Array): number {
  let sum = 0;
  const n = u8.length & ~3;
  for (let i = 0; i < n; i += 4) sum = (sum + ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3])) >>> 0;
  if (n < u8.length) {
    let last = 0;
    for (let i = n; i < u8.length; i++) last |= u8[i] << (24 - (i - n) * 8);
    sum = (sum + last) >>> 0;
  }
  return sum >>> 0;
}

/** MVAR の値の札 → 表と、その中の位置 (バイト)・符号つきか。'MVAR' の Value tags */
const MVAR_TARGETS: Record<string, [string, number, boolean]> = {
  hasc: ['OS/2', 68, true],
  hdsc: ['OS/2', 70, true],
  hlgp: ['OS/2', 72, true],
  hcla: ['OS/2', 74, false],
  hcld: ['OS/2', 76, false],
  xhgt: ['OS/2', 86, true],
  cpht: ['OS/2', 88, true],
  sbxs: ['OS/2', 10, true],
  sbys: ['OS/2', 12, true],
  sbxo: ['OS/2', 14, true],
  sbyo: ['OS/2', 16, true],
  spxs: ['OS/2', 18, true],
  spys: ['OS/2', 20, true],
  spxo: ['OS/2', 22, true],
  spyo: ['OS/2', 24, true],
  strs: ['OS/2', 26, true],
  stro: ['OS/2', 28, true],
  hcrs: ['hhea', 18, true],
  hcrn: ['hhea', 20, true],
  hcof: ['hhea', 22, true],
  vasc: ['vhea', 4, true],
  vdsc: ['vhea', 6, true],
  vlgp: ['vhea', 8, true],
  vcrs: ['vhea', 18, true],
  vcrn: ['vhea', 20, true],
  vcof: ['vhea', 22, true],
  undo: ['post', 8, true],
  unds: ['post', 10, true],
};

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));

/**
 * GPOS の値 (ValueRecord・Anchor) の VariationIndex 表を解いて、値に差分を足し、表への参照を消す (表の大きさは変えない)。
 * 'GPOS' の ValueRecord・Anchor table format 3 と、'GDEF'/Common Table Formats の VariationIndex 表 (deltaFormat = 0x8000)。
 * 戻り値: 値の欄が無くて (valueFormat に Device だけがある) 足せなかった数
 */
function instantiateGpos(t: Uint8Array, store: ItemVariationStore): number {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const len = t.length;
  let skipped = 0;
  if (len < 10) return 0;
  const seen = new Set<number>();
  /** VariationIndex 表なら差分 (丸めない)。Device 表 (ヒント用) や範囲の外は null */
  const varDelta = (at: number): number | null => {
    if (at + 6 > len || dv.getUint16(at + 4) !== 0x8000) return null;
    return store.delta(dv.getUint16(at), dv.getUint16(at + 2));
  };
  const valueSize = (fmt: number) => {
    let n = 0;
    for (let b = 0; b < 8; b++) if (fmt & (1 << b)) n += 2;
    return n;
  };
  /** ValueRecord (at) を解く。parent: Device への参照の基準 */
  const value = (at: number, fmt: number, parent: number) => {
    if (!(fmt & 0xf0) || at + valueSize(fmt) > len) return;
    // 欄の順: XPlacement YPlacement XAdvance YAdvance XPlaDevice YPlaDevice XAdvDevice YAdvDevice
    const pos: number[] = [];
    let o = at;
    for (let b = 0; b < 8; b++) {
      pos.push(fmt & (1 << b) ? o : -1);
      if (fmt & (1 << b)) o += 2;
    }
    for (let b = 0; b < 4; b++) {
      const dev = pos[b + 4];
      if (dev < 0) continue;
      const off = dv.getUint16(dev);
      if (!off) continue;
      const d = varDelta(parent + off);
      if (d === null) continue;
      if (pos[b] < 0) {
        if (otRound(d) !== 0) skipped++;
      } else dv.setInt16(pos[b], clamp16(otRound(dv.getInt16(pos[b]) + d)));
      dv.setUint16(dev, 0);
    }
  };
  const anchor = (at: number) => {
    if (at + 6 > len || seen.has(at)) return;
    seen.add(at);
    if (dv.getUint16(at) !== 3 || at + 10 > len) return;
    for (let k = 0; k < 2; k++) {
      const off = dv.getUint16(at + 6 + k * 2);
      if (!off) continue;
      const d = varDelta(at + off);
      if (d === null) continue;
      dv.setInt16(at + 2 + k * 2, clamp16(otRound(dv.getInt16(at + 2 + k * 2) + d)));
      dv.setUint16(at + 6 + k * 2, 0);
    }
  };
  const markArray = (at: number) => {
    if (at + 2 > len || seen.has(at)) return;
    seen.add(at);
    const n = dv.getUint16(at);
    if (at + 2 + n * 4 > len) return;
    for (let i = 0; i < n; i++) anchor(at + dv.getUint16(at + 2 + i * 4 + 2));
  };
  /** 字 (行) × クラス (列) の Anchor の参照の表 (BaseArray・Mark2Array・LigatureAttach) */
  const anchorMatrix = (at: number, classCount: number) => {
    if (at + 2 > len || seen.has(at)) return;
    seen.add(at);
    const rows = dv.getUint16(at);
    if (at + 2 + rows * classCount * 2 > len) return;
    for (let i = 0; i < rows * classCount; i++) {
      const off = dv.getUint16(at + 2 + i * 2);
      if (off) anchor(at + off);
    }
  };
  const subtable = (at: number, type: number) => {
    if (at + 4 > len) return;
    if (type === 9) {
      // Extension Positioning: 実の種類と、32 ビットの参照
      if (at + 8 > len || dv.getUint16(at) !== 1) return;
      subtable(at + dv.getUint32(at + 4), dv.getUint16(at + 2));
      return;
    }
    if (seen.has(at)) return;
    seen.add(at);
    const format = dv.getUint16(at);
    if (type === 1) {
      const fmt = dv.getUint16(at + 4);
      if (format === 1) value(at + 6, fmt, at);
      else if (format === 2) {
        const n = dv.getUint16(at + 6);
        const size = valueSize(fmt);
        for (let i = 0; i < n; i++) value(at + 8 + i * size, fmt, at);
      }
    } else if (type === 2) {
      if (at + 10 > len) return;
      const f1 = dv.getUint16(at + 4);
      const f2 = dv.getUint16(at + 6);
      const s1 = valueSize(f1);
      const s2 = valueSize(f2);
      if (!((f1 | f2) & 0xf0)) return;
      if (format === 1) {
        const n = dv.getUint16(at + 8);
        for (let i = 0; i < n; i++) {
          const set = at + dv.getUint16(at + 10 + i * 2);
          if (set + 2 > len || seen.has(set)) continue;
          seen.add(set);
          const m = dv.getUint16(set);
          for (let k = 0; k < m; k++) {
            const rec = set + 2 + k * (2 + s1 + s2);
            value(rec + 2, f1, set);
            value(rec + 2 + s1, f2, set);
          }
        }
      } else if (format === 2) {
        if (at + 16 > len) return;
        const c1 = dv.getUint16(at + 12);
        const c2 = dv.getUint16(at + 14);
        for (let i = 0; i < c1 * c2; i++) {
          const rec = at + 16 + i * (s1 + s2);
          value(rec, f1, at);
          value(rec + s1, f2, at);
        }
      }
    } else if (type === 3) {
      if (format !== 1 || at + 6 > len) return;
      const n = dv.getUint16(at + 4);
      for (let i = 0; i < n * 2; i++) {
        const off = dv.getUint16(at + 6 + i * 2);
        if (off) anchor(at + off);
      }
    } else if (type === 4 || type === 6) {
      if (format !== 1 || at + 12 > len) return;
      const classCount = dv.getUint16(at + 6);
      markArray(at + dv.getUint16(at + 8));
      anchorMatrix(at + dv.getUint16(at + 10), classCount);
    } else if (type === 5) {
      if (format !== 1 || at + 12 > len) return;
      const classCount = dv.getUint16(at + 6);
      markArray(at + dv.getUint16(at + 8));
      const ligs = at + dv.getUint16(at + 10);
      if (ligs + 2 > len || seen.has(ligs)) return;
      seen.add(ligs);
      const n = dv.getUint16(ligs);
      for (let i = 0; i < n; i++) anchorMatrix(ligs + dv.getUint16(ligs + 2 + i * 2), classCount);
    }
  };
  const lookups = dv.getUint16(8);
  if (!lookups || lookups + 2 > len) return 0;
  const n = dv.getUint16(lookups);
  for (let i = 0; i < n; i++) {
    const lk = lookups + dv.getUint16(lookups + 2 + i * 2);
    if (lk + 6 > len) continue;
    const type = dv.getUint16(lk);
    const subs = dv.getUint16(lk + 4);
    for (let k = 0; k < subs; k++) subtable(lk + dv.getUint16(lk + 6 + k * 2), type);
  }
  return skipped;
}

/**
 * GSUB・GPOS の FeatureVariations 表 (OpenType Layout Common Table Formats の「FeatureVariations table」) を、軸の値で解く。
 * 条件 (ConditionSet。ConditionTable format 1: 軸の番号と、正規化した値の範囲) がすべて当たる最初の記録の差し替え
 * (FeatureTableSubstitution) を、機能の一覧 (FeatureList) に入れた表を作る。表は「新しい見出し + 新しい FeatureList + 元の表の全体」
 * に組み直し、ScriptList・LookupList は元の表の中のものを指す (中の参照は、それぞれの表の先頭が基準なので、動かしても変わらない)。
 * FeatureVariations が無ければ、元の表のまま。参照が 16 ビットに収まらなければ null (差し替えずに、既定の機能のまま)
 */
function instantiateFeatureVariations(t: Uint8Array, coords: readonly number[]): Uint8Array | null {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const len = t.length;
  if (len < 14 || dv.getUint16(0) !== 1 || dv.getUint16(2) < 1) return t;
  const fv = dv.getUint32(10);
  if (!fv || fv + 8 > len) return t;
  const scriptList = dv.getUint16(4);
  const featureList = dv.getUint16(6);
  const lookupList = dv.getUint16(8);
  const count = dv.getUint32(fv + 4);
  /** 機能の番号 → 差し替える Feature 表の位置 */
  const subst = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const rec = fv + 8 + i * 8;
    if (rec + 8 > len) break;
    const cs = dv.getUint32(rec);
    const fs = dv.getUint32(rec + 4);
    let match = true;
    if (cs) {
      const set = fv + cs;
      const n = set + 2 <= len ? dv.getUint16(set) : 0;
      for (let k = 0; k < n && match; k++) {
        const c = set + dv.getUint32(set + 2 + k * 4);
        // 知らない形式の条件は、当たらないものとする
        if (c + 8 > len || dv.getUint16(c) !== 1) match = false;
        else {
          const v = coords[dv.getUint16(c + 2)] ?? 0;
          if (v < dv.getInt16(c + 4) || v > dv.getInt16(c + 6)) match = false;
        }
      }
    }
    if (!match) continue;
    if (fs) {
      const s = fv + fs;
      const n = s + 6 <= len ? dv.getUint16(s + 4) : 0;
      for (let k = 0; k < n; k++) subst.set(dv.getUint16(s + 6 + k * 6), s + dv.getUint32(s + 6 + k * 6 + 2));
    }
    break;
  }
  // 新しい FeatureList: 記録 (札 + 参照) と、Feature 表 (featureParams・lookupIndexCount・lookupListIndices) の写し
  const fcount = featureList && featureList + 2 <= len ? dv.getUint16(featureList) : 0;
  const tables: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 2 + fcount * 6;
  for (let i = 0; i < fcount; i++) {
    const src = subst.get(i) ?? featureList + dv.getUint16(featureList + 2 + i * 6 + 4);
    const n = src + 4 <= len ? dv.getUint16(src + 2) : 0;
    const ft = new Uint8Array(4 + n * 2);
    // featureParams (Feature 表からの参照) は、写した先では指せないので 0 にする (差し替えない機能は、元の表のものを残したいが、
    // 16 ビットの参照では元の位置を指せない。featureParams は 'size'・'ssNN'・'cvNN' の名前の情報で、組版には使わない)
    if (src + 4 + n * 2 <= len) ft.set(t.subarray(src + 2, src + 4 + n * 2), 2);
    tables.push(ft);
    offsets.push(at);
    at += ft.length;
  }
  if (at > 0xffff) return null;
  const head = 10;
  const base = head + at;
  if (base + Math.max(scriptList, lookupList) > 0xffff) return null;
  const out = new Uint8Array(base + len);
  const ov = new DataView(out.buffer);
  ov.setUint16(0, 1);
  ov.setUint16(2, 0);
  ov.setUint16(4, scriptList ? base + scriptList : 0);
  ov.setUint16(6, head);
  ov.setUint16(8, lookupList ? base + lookupList : 0);
  ov.setUint16(head, fcount);
  for (let i = 0; i < fcount; i++) {
    out.set(t.subarray(featureList + 2 + i * 6, featureList + 2 + i * 6 + 4), head + 2 + i * 6);
    ov.setUint16(head + 2 + i * 6 + 4, offsets[i]);
    out.set(tables[i], head + offsets[i]);
  }
  out.set(t, base);
  return out;
}

/** hmtx・vmtx の形 (どの字形も、送りと空きの組) */
function longMetrics(numGlyphs: number, adv: Int32Array, sb: Int32Array): Uint8Array {
  const t = new Uint8Array(numGlyphs * 4);
  const d = new DataView(t.buffer);
  for (let g = 0; g < numGlyphs; g++) {
    d.setUint16(g * 4, Math.min(65535, adv[g]));
    d.setInt16(g * 4 + 2, clamp16(sb[g]));
  }
  return t;
}

/** HVAR・VVAR (tag) の送りの差分を、字形ごとの既定の送り defOf に足して、out に入れる。表が無ければ、何もしない */
function metricVariations(dv: DataView, dir: Map<string, TableRec>, tag: string, coords: readonly number[], numGlyphs: number, defOf: (g: number) => number, out: Int32Array) {
  const r = dir.get(tag);
  if (!r || r.length < 20) return;
  const store = new ItemVariationStore(dv, r.offset + dv.getUint32(r.offset + 4), r.offset + r.length, coords);
  const mapOff = dv.getUint32(r.offset + 8);
  for (let g = 0; g < numGlyphs; g++) {
    const [outer, inner] = deltaSetIndex(dv, mapOff ? r.offset + mapOff : 0, g);
    out[g] = Math.max(0, otRound(defOf(g) + store.delta(outer, inner)));
  }
}

/** 書体全体の値に、実体の値を入れる: MVAR の差分と、太さ・幅・傾きの軸の値 (out の表を書き換える) */
function applyFontWideVariations(out: Map<string, Uint8Array>, dv: DataView, dir: Map<string, TableRec>, info: VariationInfo, user: readonly number[], coords: readonly number[]) {
  // MVAR: 書体全体の寸法
  const mvar = dir.get('MVAR');
  if (mvar && mvar.length >= 12) {
    const b = mvar.offset;
    const recSize = dv.getUint16(b + 6);
    const count = dv.getUint16(b + 8);
    const storeOff = dv.getUint16(b + 10);
    if (storeOff && recSize >= 8) {
      const store = new ItemVariationStore(dv, b + storeOff, b + mvar.length, coords);
      for (let i = 0; i < count; i++) {
        const o = b + 12 + i * recSize;
        if (o + 8 > b + mvar.length) break;
        const target = MVAR_TARGETS[tagAt(dv, o)];
        const t = target && out.get(target[0]);
        if (!t || target[1] + 2 > t.length) continue;
        const d = store.delta(dv.getUint16(o + 4), dv.getUint16(o + 6));
        const tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
        if (target[2]) tv.setInt16(target[1], clamp16(otRound(tv.getInt16(target[1]) + d)));
        else tv.setUint16(target[1], Math.max(0, Math.min(65535, otRound(tv.getUint16(target[1]) + d))));
      }
    }
  }
  // 太さ・幅・傾きの値を、OS/2 と post に写す ('OS/2' の usWeightClass・usWidthClass、'post' の italicAngle。軸の定義は Design-variation axis tag registry)
  const os2 = out.get('OS/2');
  info.axes.forEach((ax, i) => {
    const v = Math.min(ax.max, Math.max(ax.min, user[i]));
    if (ax.tag === 'wght' && os2 && os2.length >= 6) new DataView(os2.buffer).setUint16(4, Math.max(1, Math.min(1000, otRound(v))));
    if (ax.tag === 'wdth' && os2 && os2.length >= 8) {
      // usWidthClass の 1〜9 (50・62.5・75・87.5・100・112.5・125・150・200 %) の、最も近いもの
      const steps = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
      let best = 0;
      steps.forEach((s, k) => {
        if (Math.abs(s - v) < Math.abs(steps[best] - v)) best = k;
      });
      new DataView(os2.buffer).setUint16(6, best + 1);
    }
    const post = out.get('post');
    if (ax.tag === 'slnt' && post && post.length >= 8) new DataView(post.buffer).setInt32(4, otRound(v * 65536));
  });
}

/** 位置合わせと、軸の値による機能の差し替えを、実体の値にする (out の GDEF・GPOS・GSUB を書き換える) */
function applyLayoutVariations(out: Map<string, Uint8Array>, coords: readonly number[], notes: string[]) {
  // GDEF の差分の表で GPOS の値を解く。GDEF からは差分の表への参照を外す (version 1.3 の itemVarStoreOffset)
  const gdef = out.get('GDEF');
  const gpos = out.get('GPOS');
  if (gdef && gdef.length >= 18) {
    const gd = new DataView(gdef.buffer);
    const minor = gd.getUint16(2);
    const storeOff = minor >= 3 ? gd.getUint32(14) : 0;
    if (storeOff) {
      const store = new ItemVariationStore(gd, storeOff, gdef.length, coords);
      if (gpos) {
        const skipped = instantiateGpos(gpos, store);
        if (skipped) notes.push(`GPOS: ${skipped} variable values without a base field were left at the default`);
      }
      gd.setUint32(14, 0);
    }
  }
  for (const tag of ['GSUB', 'GPOS']) {
    const t = out.get(tag);
    if (!t) continue;
    const r = instantiateFeatureVariations(t, coords);
    if (r) out.set(tag, r);
    else notes.push(`${tag}: FeatureVariations could not be resolved (offset overflow); the default features are used`);
  }
}

/** 表の集まりを sfnt にする (表は札の順、4 バイト境界。version は sfnt の版: TrueType の輪郭は 0x00010000、CFF は 'OTTO') */
function assembleSfnt(out: Map<string, Uint8Array>, version: number): ArrayBuffer {
  const tags = [...out.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = tags.length;
  let size = 12 + n * 16;
  for (const t of tags) size += (out.get(t)!.length + 3) & ~3;
  const file = new Uint8Array(size);
  const fd = new DataView(file.buffer);
  fd.setUint32(0, version);
  fd.setUint16(4, n);
  const pow = 2 ** Math.floor(Math.log2(n));
  fd.setUint16(6, pow * 16);
  fd.setUint16(8, Math.floor(Math.log2(n)));
  fd.setUint16(10, n * 16 - pow * 16);
  let off = 12 + n * 16;
  let headAt = 0;
  tags.forEach((t, i) => {
    const data = out.get(t)!;
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) file[rec + k] = t.charCodeAt(k);
    fd.setUint32(rec + 4, checksum(data));
    fd.setUint32(rec + 8, off);
    fd.setUint32(rec + 12, data.length);
    file.set(data, off);
    if (t === 'head') headAt = off;
    off += (data.length + 3) & ~3;
  });
  fd.setUint32(headAt + 8, (0xb1b0afba - checksum(file)) >>> 0);
  return file.buffer;
}

/** 実体を作った結果 */
export interface InstanceResult {
  /** 静的な書体のファイル (TrueType の輪郭の書体は TrueType、CFF2 の書体は CFF の OpenType) */
  buffer: ArrayBuffer;
  /** 当てられなかったもの (利用者に知らせる文。無ければ空) */
  notes: string[];
}

/**
 * 可変フォントの、軸の値 user (info.axes と同じ順。利用者の尺度) の実体を、静的な書体のファイルにする。
 * 輪郭が CFF2 の書体は instantiateCff2Font (下)。TrueType の輪郭の書体は:
 *  - 'glyf'・'loca': gvar の差分を当てた輪郭 (座標は整数に丸める)。複合の字形は、部品の位置に差分を当てる
 *  - 'hmtx' (・'vmtx'): HVAR (・VVAR) があればその差分、無ければ gvar の幻影の点から
 *  - 'OS/2'・'hhea'・'vhea'・'post': MVAR の差分。usWeightClass・usWidthClass・italicAngle は、wght・wdth・slnt の値から
 *  - 'GPOS': GDEF の Item Variation Store の差分を値に足す。'GSUB'・'GPOS' の FeatureVariations は、当たる差し替えを機能の一覧に入れる
 *  - 'cvt ': cvar の差分
 *  - 可変フォントの表 (fvar・avar・gvar・cvar・HVAR・VVAR・MVAR・STAT) と、実体では値の合わなくなる表 (hdmx・LTSH・VDMX・DSIG) は入れない
 */
export function instantiateFont(buffer: ArrayBuffer, info: VariationInfo, user: readonly number[]): InstanceResult {
  const src = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const dir = tableDirectory(dv);
  const notes: string[] = [];
  if (!dir || info.unsupported) throw new Error('not a variable font with glyf + gvar or CFF2 outlines');
  if (info.cff2) return instantiateCff2Font(buffer, dir, info, user);
  const need = (tag: string) => {
    const r = dir.get(tag);
    if (!r) throw new Error(`missing table ${tag}`);
    return r;
  };
  const coords = normalizeCoords(buffer, info.axes, user);
  const axisCount = info.axes.length;
  const copy = (tag: string) => {
    const r = dir.get(tag);
    return r ? src.slice(r.offset, r.offset + r.length) : undefined;
  };
  const head = copy('head')!;
  const maxp = need('maxp');
  const numGlyphs = dv.getUint16(maxp.offset + 4);
  const glyf = need('glyf');
  const loca = need('loca');
  const gvar = need('gvar');
  const hhea = copy('hhea')!;
  const hmtxRec = need('hmtx');
  need('head');
  need('hhea');
  const headDv = new DataView(head.buffer);
  const hheaDv = new DataView(hhea.buffer);
  const longLoca = headDv.getInt16(50) === 1;
  const glyphAt = (g: number) => (longLoca ? dv.getUint32(loca.offset + g * 4) : dv.getUint16(loca.offset + g * 2) * 2);
  const numH = hheaDv.getUint16(34);
  const advanceOf = (g: number) => dv.getUint16(hmtxRec.offset + Math.min(g, numH - 1) * 4);
  const lsbOf = (g: number) => (g < numH ? dv.getInt16(hmtxRec.offset + g * 4 + 2) : dv.getInt16(hmtxRec.offset + numH * 4 + (g - numH) * 2));
  const vhea = copy('vhea');
  const vmtxRec = vhea ? dir.get('vmtx') : undefined;
  const numV = vhea ? new DataView(vhea.buffer).getUint16(34) : 0;
  const vAdvanceOf = (g: number) => dv.getUint16(vmtxRec!.offset + Math.min(g, numV - 1) * 4);
  const tsbOf = (g: number) => (g < numV ? dv.getInt16(vmtxRec!.offset + g * 4 + 2) : dv.getInt16(vmtxRec!.offset + numV * 4 + (g - numV) * 2));

  // gvar の見出し
  const gv = gvar.offset;
  const gvLimit = gv + gvar.length;
  const gvAxisCount = dv.getUint16(gv + 4);
  if (gvAxisCount !== axisCount) throw new Error('gvar axis count mismatch');
  const sharedCount = dv.getUint16(gv + 6);
  const sharedTuples = gv + dv.getUint32(gv + 8);
  const gvGlyphs = dv.getUint16(gv + 12);
  const gvLong = !!(dv.getUint16(gv + 14) & 1);
  const gvData = gv + dv.getUint32(gv + 16);
  const gvOffset = (g: number) => (gvLong ? dv.getUint32(gv + 20 + g * 4) : dv.getUint16(gv + 20 + g * 2) * 2);

  const outGlyphs: Array<Uint8Array | null> = new Array(numGlyphs).fill(null);
  const boxes: Array<[number, number, number, number] | null> = new Array(numGlyphs).fill(null);
  const advances = new Int32Array(numGlyphs);
  const lsbs = new Int32Array(numGlyphs);
  const vAdvances = new Int32Array(numGlyphs);
  const tsbs = new Int32Array(numGlyphs);
  /** 部品として使われる字形の、実体の点 (複合の字形の外接の箱を計算するのに使う) */
  const usedAsComponent = new Set<number>();
  const kinds = new Int8Array(numGlyphs); // 0: 空、1: 単純、2: 複合
  for (let g = 0; g < numGlyphs; g++) {
    const a = glyf.offset + glyphAt(g);
    const b = glyf.offset + glyphAt(g + 1);
    if (b - a < 10) continue;
    const nc = dv.getInt16(a);
    kinds[g] = nc >= 0 ? 1 : 2;
    if (nc < 0) for (const c of parseComposite(dv, a).components) usedAsComponent.add(c.glyph);
  }
  const points = new Map<number, { xs: Int32Array; ys: Int32Array }>();
  const hasVmtx = !!vmtxRec;

  /** 字形 g の差分 (点の数 n + 幻影の点 4 つ) を足し合わせる。単純な字形は、触れていない点を補う */
  const deltasFor = (g: number, n: number, ox: Float64Array, oy: Float64Array, endPts: number[] | null): { dx: Float64Array; dy: Float64Array } => {
    const total = n + 4;
    const dx = new Float64Array(total);
    const dy = new Float64Array(total);
    if (g >= gvGlyphs) return { dx, dy };
    const a = gvData + gvOffset(g);
    const b = gvData + gvOffset(g + 1);
    if (b - a < 4 || b > gvLimit) return { dx, dy };
    const tupleCount = dv.getUint16(a);
    const dataAt = a + dv.getUint16(a + 2);
    eachTuple(dv, a + 4, tupleCount, dataAt, b, axisCount, sharedTuples, sharedCount, coords, total, true, (scalar, pts, tx, ty) => {
      if (!pts) {
        for (let i = 0; i < total; i++) {
          dx[i] += scalar * tx[i];
          dy[i] += scalar * ty[i];
        }
        return;
      }
      if (!endPts) {
        // 複合の字形: 補わない (番号の無い部品は 0)
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          if (p < total) {
            dx[p] += scalar * tx[k];
            dy[p] += scalar * ty[k];
          }
        }
        return;
      }
      const fx = new Float64Array(total);
      const fy = new Float64Array(total);
      const touched = new Uint8Array(total);
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        if (p < total) {
          // 同じ番号が重ねて出たら、差分を足し合わせる (Packed "point" numbers)
          fx[p] += tx[k];
          fy[p] += ty[k];
          touched[p] = 1;
        }
      }
      let start = 0;
      for (const end of endPts) {
        let first = -1;
        let cnt = 0;
        for (let i = start; i <= end; i++)
          if (touched[i]) {
            if (first < 0) first = i;
            cnt++;
          }
        if (cnt && cnt < end - start + 1) {
          // 触れた点 cur から次の触れた点 next まで (輪郭を巡る) の間の点を補う
          let cur = first;
          do {
            let next = cur;
            do next = next === end ? start : next + 1;
            while (!touched[next]);
            for (let i = cur === end ? start : cur + 1; i !== next; i = i === end ? start : i + 1) {
              fx[i] = inferDelta(ox[i], ox[cur], ox[next], fx[cur], fx[next]);
              fy[i] = inferDelta(oy[i], oy[cur], oy[next], fy[cur], fy[next]);
            }
            cur = next;
          } while (cur !== first);
        }
        start = end + 1;
      }
      for (let i = 0; i < total; i++) {
        dx[i] += scalar * fx[i];
        dy[i] += scalar * fy[i];
      }
    });
    return { dx, dy };
  };

  /** 幻影の点から、送りと左 (上) の空き。gvar の「Phantom points」: 左・右・上・下の順 */
  const metrics = (g: number, n: number, dx: Float64Array, dy: Float64Array, box: [number, number, number, number] | null, defXMin: number, defYMax: number) => {
    const adv = advanceOf(g);
    const left = defXMin - lsbOf(g) + dx[n];
    const right = defXMin - lsbOf(g) + adv + dx[n + 1];
    advances[g] = Math.max(0, otRound(right - left));
    lsbs[g] = otRound((box ? box[0] : 0) - left);
    if (hasVmtx) {
      const top = defYMax + tsbOf(g) + dy[n + 2];
      const bottom = defYMax + tsbOf(g) - vAdvanceOf(g) + dy[n + 3];
      vAdvances[g] = Math.max(0, otRound(top - bottom));
      tsbs[g] = otRound(top - (box ? box[3] : 0));
    }
  };

  for (let g = 0; g < numGlyphs; g++) {
    if (kinds[g] === 2) continue;
    const a = glyf.offset + glyphAt(g);
    if (kinds[g] === 0) {
      const z = new Float64Array(0);
      const { dx, dy } = deltasFor(g, 0, z, z, []);
      metrics(g, 0, dx, dy, null, 0, 0);
      continue;
    }
    const sg = parseSimple(src, dv, a, dv.getInt16(a));
    const n = sg.xs.length;
    const { dx, dy } = deltasFor(g, n, sg.xs, sg.ys, sg.endPts);
    const xs = new Int32Array(n);
    const ys = new Int32Array(n);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = (xs[i] = otRound(sg.xs[i] + dx[i]));
      const y = (ys[i] = otRound(sg.ys[i] + dy[i]));
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const box: [number, number, number, number] = n ? [x0, y0, x1, y1] : [0, 0, 0, 0];
    boxes[g] = box;
    outGlyphs[g] = writeSimple(sg, xs, ys, box);
    if (usedAsComponent.has(g)) points.set(g, { xs, ys });
    metrics(g, n, dx, dy, box, dv.getInt16(a + 2), dv.getInt16(a + 8));
  }

  // 複合の字形: 部品の位置に差分を当てる。外接の箱は、部品の実体の点を変形して求める
  const phantom = new Map<number, number[]>();
  const composites = new Map<number, { components: Component[]; instr: Uint8Array | null }>();
  for (let g = 0; g < numGlyphs; g++) {
    if (kinds[g] !== 2) continue;
    const a = glyf.offset + glyphAt(g);
    const c = parseComposite(dv, a);
    const n = c.components.length;
    const ox = new Float64Array(n);
    const oy = new Float64Array(n);
    c.components.forEach((p, i) => {
      if (p.flags & 0x0002) {
        ox[i] = p.arg1;
        oy[i] = p.arg2;
      }
    });
    const { dx, dy } = deltasFor(g, n, ox, oy, null);
    c.components.forEach((p, i) => {
      if (p.flags & 0x0002) {
        p.arg1 = clamp16(otRound(p.arg1 + dx[i]));
        p.arg2 = clamp16(otRound(p.arg2 + dy[i]));
      }
    });
    composites.set(g, { components: c.components, instr: c.instructions ? src.subarray(c.instructions[0], c.instructions[0] + c.instructions[1]) : null });
    // 送りは、箱が決まってから (下で)
    advances[g] = -1;
    lsbs[g] = 0;
    // 幻影の点の差分を覚える
    phantom.set(g, [dx[n], dx[n + 1], dy[n + 2], dy[n + 3]]);
  }
  function pointsOf(g: number, depth: number): { xs: Int32Array | number[]; ys: Int32Array | number[] } {
    const hit = points.get(g);
    if (hit) return hit;
    const c = composites.get(g);
    if (!c || depth > 8) return { xs: [], ys: [] };
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of c.components) {
      const sub = pointsOf(p.glyph, depth + 1);
      const t = p.transform;
      const a = (t.length === 1 ? t[0] : t.length >= 2 ? t[0] : 16384) / 16384;
      const b = (t.length === 4 ? t[1] : 0) / 16384;
      const cc = (t.length === 4 ? t[2] : 0) / 16384;
      const d = (t.length === 1 ? t[0] : t.length === 2 ? t[1] : t.length === 4 ? t[3] : 16384) / 16384;
      let ex = 0;
      let ey = 0;
      const tx = (k: number) => a * sub.xs[k] + cc * sub.ys[k];
      const ty = (k: number) => b * sub.xs[k] + d * sub.ys[k];
      if (p.flags & 0x0002) {
        ex = p.arg1;
        ey = p.arg2;
      } else if (p.arg1 < xs.length && p.arg2 < sub.xs.length) {
        // 点どうしを合わせる部品: 親の点 arg1 に、部品の点 arg2 を重ねる
        ex = xs[p.arg1] - tx(p.arg2);
        ey = ys[p.arg1] - ty(p.arg2);
      }
      for (let k = 0; k < sub.xs.length; k++) {
        xs.push(otRound(tx(k) + ex));
        ys.push(otRound(ty(k) + ey));
      }
    }
    const r = { xs, ys };
    if (usedAsComponent.has(g)) points.set(g, { xs: Int32Array.from(xs), ys: Int32Array.from(ys) });
    return r;
  }
  for (const [g, c] of composites) {
    const a = glyf.offset + glyphAt(g);
    const p = pointsOf(g, 0);
    let box: [number, number, number, number] = [0, 0, 0, 0];
    if (p.xs.length) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < p.xs.length; i++) {
        if (p.xs[i] < x0) x0 = p.xs[i];
        if (p.xs[i] > x1) x1 = p.xs[i];
        if (p.ys[i] < y0) y0 = p.ys[i];
        if (p.ys[i] > y1) y1 = p.ys[i];
      }
      box = [clamp16(x0), clamp16(y0), clamp16(x1), clamp16(y1)];
    }
    boxes[g] = box;
    outGlyphs[g] = writeComposite(c, c.instr, box);
    const ph = phantom.get(g)!;
    const dx = new Float64Array([ph[0], ph[1], 0, 0]);
    const dy = new Float64Array([0, 0, ph[2], ph[3]]);
    metrics(g, 0, dx, dy, box, dv.getInt16(a + 2), dv.getInt16(a + 8));
  }

  // HVAR・VVAR があれば、送りはその差分で決める (組版 (HarfBuzz・ブラウザ) が使う値。'HVAR' の表の説明: 送りの差分は必須、空きの差分は任意)
  metricVariations(dv, dir, 'HVAR', coords, numGlyphs, advanceOf, advances);
  if (hasVmtx) metricVariations(dv, dir, 'VVAR', coords, numGlyphs, vAdvanceOf, vAdvances);

  // glyf・loca (長い形式)
  let glyfSize = 0;
  for (const g of outGlyphs) if (g) glyfSize += (g.length + 3) & ~3;
  const newGlyf = new Uint8Array(glyfSize);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const locaDv = new DataView(newLoca.buffer);
  let at = 0;
  let fx0 = Infinity;
  let fy0 = Infinity;
  let fx1 = -Infinity;
  let fy1 = -Infinity;
  for (let g = 0; g < numGlyphs; g++) {
    locaDv.setUint32(g * 4, at);
    const b = outGlyphs[g];
    if (b) {
      newGlyf.set(b, at);
      at += (b.length + 3) & ~3;
      const box = boxes[g]!;
      if (box[0] < fx0) fx0 = box[0];
      if (box[1] < fy0) fy0 = box[1];
      if (box[2] > fx1) fx1 = box[2];
      if (box[3] > fy1) fy1 = box[3];
    }
  }
  locaDv.setUint32(numGlyphs * 4, at);
  headDv.setInt16(50, 1);
  if (Number.isFinite(fx0)) {
    headDv.setInt16(36, clamp16(fx0));
    headDv.setInt16(38, clamp16(fy0));
    headDv.setInt16(40, clamp16(fx1));
    headDv.setInt16(42, clamp16(fy1));
  }
  headDv.setUint32(8, 0);

  const out = new Map<string, Uint8Array>();
  for (const [tag, r] of dir) {
    if (['fvar', 'avar', 'gvar', 'cvar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'hdmx', 'LTSH', 'VDMX', 'DSIG', 'glyf', 'loca', 'hmtx', 'vmtx', 'head', 'hhea', 'vhea'].includes(tag)) continue;
    out.set(tag, src.slice(r.offset, r.offset + r.length));
  }
  out.set('glyf', newGlyf);
  out.set('loca', newLoca);
  out.set('head', head);
  out.set('hmtx', longMetrics(numGlyphs, advances, lsbs));
  hheaDv.setUint16(34, numGlyphs);
  let advMax = 0;
  for (let g = 0; g < numGlyphs; g++) if (advances[g] > advMax) advMax = advances[g];
  hheaDv.setUint16(10, Math.min(65535, advMax));
  out.set('hhea', hhea);
  if (vhea && hasVmtx) {
    out.set('vmtx', longMetrics(numGlyphs, vAdvances, tsbs));
    new DataView(vhea.buffer).setUint16(34, numGlyphs);
    out.set('vhea', vhea);
  } else if (vhea) out.set('vhea', vhea);

  applyFontWideVariations(out, dv, dir, info, user, coords);

  // cvar: ヒントの制御値
  const cvar = dir.get('cvar');
  const cvt = out.get('cvt ');
  if (cvar && cvt && cvar.length >= 8) {
    const n = cvt.length >> 1;
    const cd = new DataView(cvt.buffer);
    const sum = new Float64Array(n);
    const b = cvar.offset;
    eachTuple(dv, b + 8, dv.getUint16(b + 4), b + dv.getUint16(b + 6), b + cvar.length, axisCount, -1, 0, coords, n, false, (scalar, pts, tx) => {
      if (!pts) for (let i = 0; i < n; i++) sum[i] += scalar * tx[i];
      else
        for (let k = 0; k < pts.length; k++) {
          if (pts[k] < n) sum[pts[k]] += scalar * tx[k];
        }
    });
    for (let i = 0; i < n; i++) if (sum[i]) cd.setInt16(i * 2, clamp16(otRound(cd.getInt16(i * 2) + sum[i])));
  }

  applyLayoutVariations(out, coords, notes);

  return { buffer: assembleSfnt(out, 0x00010000), notes };
}

/**
 * 輪郭が CFF2 の可変フォントの実体を、静的な CFF (版 1) の OpenType にする。
 *  - 'CFF ': 字形の差分 (blend) を計算した輪郭 (cff2Instancer.ts)。字形の幅は、実体の送り
 *  - 'hmtx' (・'vmtx'): HVAR (・VVAR) の差分 (CFF2 の輪郭には幻影の点が無いので、送りの差分はこの表だけにある。'HVAR'・'VVAR' の表の説明)。
 *    左の空きは、輪郭の左の端。上の空きは、縦書きの原点 ('VORG') から輪郭の上の端まで
 *  - 'VORG': VVAR の vOrgMapping の差分 ('VVAR' の表の説明: 縦書きの原点の y の差分は、CFF2 の書体だけが持つ)
 *  - 'OS/2'・'hhea'・'vhea'・'post'・'GPOS'・'GSUB' は、TrueType の輪郭の実体と同じ
 *  - 可変フォントの表 (fvar・avar・HVAR・VVAR・MVAR・STAT)・'CFF2'・DSIG は入れない
 */
function instantiateCff2Font(buffer: ArrayBuffer, dir: Map<string, TableRec>, info: VariationInfo, user: readonly number[]): InstanceResult {
  const src = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const notes: string[] = [];
  const need = (tag: string) => {
    const r = dir.get(tag);
    if (!r) throw new Error(`missing table ${tag}`);
    return r;
  };
  const copy = (tag: string) => {
    const r = need(tag);
    return src.slice(r.offset, r.offset + r.length);
  };
  const coords = normalizeCoords(buffer, info.axes, user);
  const head = copy('head');
  const hhea = copy('hhea');
  const headDv = new DataView(head.buffer);
  const hheaDv = new DataView(hhea.buffer);
  const numGlyphs = dv.getUint16(need('maxp').offset + 4);
  const hmtxRec = need('hmtx');
  const cff2Rec = need('CFF2');
  const numH = hheaDv.getUint16(34);
  if (!numH || hmtxRec.length < numH * 4) throw new Error('bad hmtx');
  const advanceOf = (g: number) => dv.getUint16(hmtxRec.offset + Math.min(g, numH - 1) * 4);
  const vheaRec = dir.get('vhea');
  const vmtxRec = vheaRec ? dir.get('vmtx') : undefined;
  const vhea = vheaRec ? src.slice(vheaRec.offset, vheaRec.offset + vheaRec.length) : undefined;
  const numV = vhea ? new DataView(vhea.buffer).getUint16(34) : 0;
  const hasVmtx = !!vmtxRec && numV > 0 && vmtxRec.length >= numV * 4;
  const vAdvanceOf = (g: number) => dv.getUint16(vmtxRec!.offset + Math.min(g, numV - 1) * 4);
  const tsbOf = (g: number) => (g < numV ? dv.getInt16(vmtxRec!.offset + g * 4 + 2) : vmtxRec!.offset + numV * 4 + (g - numV) * 2 + 2 <= vmtxRec!.offset + vmtxRec!.length ? dv.getInt16(vmtxRec!.offset + numV * 4 + (g - numV) * 2) : 0);

  // 送り: 既定の値に、HVAR・VVAR の差分
  const advances = new Int32Array(numGlyphs);
  const vAdvances = new Int32Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) advances[g] = advanceOf(g);
  metricVariations(dv, dir, 'HVAR', coords, numGlyphs, advanceOf, advances);
  if (hasVmtx) {
    for (let g = 0; g < numGlyphs; g++) vAdvances[g] = vAdvanceOf(g);
    metricVariations(dv, dir, 'VVAR', coords, numGlyphs, vAdvanceOf, vAdvances);
  }

  // 字形
  const psName = nameString(dv, dir.get('name'), 6) || variationNamePrefix(buffer) || 'Font';
  const scalarMemo = new Map<number, Float64Array | undefined>();
  const made = instantiateCff2(
    src.subarray(cff2Rec.offset, cff2Rec.offset + cff2Rec.length),
    (at, length) => {
      const store = new ItemVariationStore(dv, cff2Rec.offset + at, cff2Rec.offset + at + length, coords);
      return (vsindex) => {
        if (!scalarMemo.has(vsindex)) {
          // 軸の無い書体 (可変でない CFF2) は、どの領域の重みも 0 (既定の値のまま)
          const sc = store.regionScalars(vsindex);
          scalarMemo.set(vsindex, sc && (info.axes.length ? Float64Array.from(sc) : new Float64Array(sc.length)));
        }
        return scalarMemo.get(vsindex);
      };
    },
    advances,
    psName,
    headDv.getUint16(18),
  );
  const { boxes, hasOutline } = made;

  // 書体全体の外接の箱 ('head')
  let any = false;
  let fx0 = 0;
  let fy0 = 0;
  let fx1 = 0;
  let fy1 = 0;
  const lsbs = new Int32Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    if (!hasOutline[g]) continue;
    lsbs[g] = boxes[g * 4];
    if (!any || boxes[g * 4] < fx0) fx0 = boxes[g * 4];
    if (!any || boxes[g * 4 + 1] < fy0) fy0 = boxes[g * 4 + 1];
    if (!any || boxes[g * 4 + 2] > fx1) fx1 = boxes[g * 4 + 2];
    if (!any || boxes[g * 4 + 3] > fy1) fy1 = boxes[g * 4 + 3];
    any = true;
  }
  if (any) {
    headDv.setInt16(36, clamp16(fx0));
    headDv.setInt16(38, clamp16(fy0));
    headDv.setInt16(40, clamp16(fx1));
    headDv.setInt16(42, clamp16(fy1));
  }
  headDv.setUint32(8, 0);

  const out = new Map<string, Uint8Array>();
  for (const [tag, r] of dir) {
    if (['fvar', 'avar', 'gvar', 'cvar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'hdmx', 'LTSH', 'VDMX', 'DSIG', 'CFF2', 'hmtx', 'vmtx', 'head', 'hhea', 'vhea', 'VORG'].includes(tag)) continue;
    out.set(tag, src.slice(r.offset, r.offset + r.length));
  }
  out.set('CFF ', made.cff);
  out.set('head', head);
  out.set('hmtx', longMetrics(numGlyphs, advances, lsbs));
  hheaDv.setUint16(34, numGlyphs);
  let advMax = 0;
  for (let g = 0; g < numGlyphs; g++) if (advances[g] > advMax) advMax = advances[g];
  hheaDv.setUint16(10, Math.min(65535, advMax));
  out.set('hhea', hhea);

  // 縦書きの原点 ('VORG'): 既定の値に、VVAR の vOrgMapping の差分。字形ごとの値を求めてから、最も多い値を既定の値にして書き直す
  const vorgRec = dir.get('VORG');
  let originOf: ((g: number) => number) | undefined;
  if (vorgRec && vorgRec.length >= 8) {
    const b = vorgRec.offset;
    const def = dv.getInt16(b + 4);
    const count = Math.min(dv.getUint16(b + 6), (vorgRec.length - 8) >> 2);
    const ys = new Int32Array(numGlyphs).fill(def);
    for (let i = 0; i < count; i++) {
      const g = dv.getUint16(b + 8 + i * 4);
      if (g < numGlyphs) ys[g] = dv.getInt16(b + 8 + i * 4 + 2);
    }
    const vvar = dir.get('VVAR');
    const mapOff = vvar && vvar.length >= 24 ? dv.getUint32(vvar.offset + 20) : 0;
    if (vvar && mapOff) {
      const store = new ItemVariationStore(dv, vvar.offset + dv.getUint32(vvar.offset + 4), vvar.offset + vvar.length, coords);
      for (let g = 0; g < numGlyphs; g++) {
        const [outer, inner] = deltaSetIndex(dv, vvar.offset + mapOff, g);
        ys[g] = clamp16(otRound(ys[g] + store.delta(outer, inner)));
      }
    }
    const freq = new Map<number, number>();
    let common = def;
    let commonCount = 0;
    for (let g = 0; g < numGlyphs; g++) {
      const c = (freq.get(ys[g]) ?? 0) + 1;
      freq.set(ys[g], c);
      if (c > commonCount) {
        common = ys[g];
        commonCount = c;
      }
    }
    const t = new Uint8Array(8 + (numGlyphs - commonCount) * 4);
    const td = new DataView(t.buffer);
    td.setUint16(0, 1);
    td.setInt16(4, common);
    td.setUint16(6, numGlyphs - commonCount);
    let o = 8;
    for (let g = 0; g < numGlyphs; g++) {
      if (ys[g] === common) continue;
      td.setUint16(o, g);
      td.setInt16(o + 2, ys[g]);
      o += 4;
    }
    out.set('VORG', t);
    originOf = (g) => ys[g];
  }
  if (vhea && hasVmtx) {
    // 上の空き: 縦書きの原点から、輪郭の上の端まで ('VORG' の表の説明)。原点の表が無い書体・輪郭の無い字形は、既定の値のまま
    const tsbs = new Int32Array(numGlyphs);
    for (let g = 0; g < numGlyphs; g++) tsbs[g] = originOf && hasOutline[g] ? originOf(g) - boxes[g * 4 + 3] : tsbOf(g);
    out.set('vmtx', longMetrics(numGlyphs, vAdvances, tsbs));
    new DataView(vhea.buffer).setUint16(34, numGlyphs);
    out.set('vhea', vhea);
  } else {
    if (vhea) out.set('vhea', vhea);
    if (vmtxRec) out.set('vmtx', src.slice(vmtxRec.offset, vmtxRec.offset + vmtxRec.length));
  }

  applyFontWideVariations(out, dv, dir, info, user, coords);
  applyLayoutVariations(out, coords, notes);
  return { buffer: assembleSfnt(out, 0x4f54544f), notes };
}

/**
 * 可変でない CFF2 の書体 (輪郭が 'CFF2' の表で、'fvar' を持たない OpenType) を、静的な CFF (版 1) の OpenType に作り直す
 * (CFF2 の輪郭は、可変でなくても PDF に埋め込めない)。そういう書体でなければ undefined。読めない書体は Error
 */
export function staticCff2ToCff(buffer: ArrayBuffer): ArrayBuffer | undefined {
  const dir = tableDirectory(new DataView(buffer));
  if (!dir || !dir.has('CFF2') || dir.has('fvar')) return undefined;
  return instantiateCff2Font(buffer, dir, { axes: [], instances: [], cff2: true, unsupported: false }, []).buffer;
}
