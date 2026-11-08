/**
 * cff — CFF (Compact Font Format。Adobe Technical Note #5176) の書体を読み、PDF に埋め込む部分書体を作る。
 *
 *  - cffTable: OpenType (sfnt) の 'CFF ' の表を取り出す
 *  - cffGidToCid: CID 方式 (Top DICT に ROS がある) の書体の、字の番号 (GID) から CID への対応 (charset)
 *  - subsetCff: 使わない字の字形 (CharStrings) を空にした CFF を作る。字の番号・CID・FDSelect は変えない
 *
 * PDF の CIDFontType0 は、CID 方式の CFF では CID から charset で GID を引く (ISO 32000-2 §9.7.4.2)。
 * 字の番号を変えないので、部分書体でも、元の書体と同じ CID・GID で字を選べる。
 */
import { CFF_STANDARD_STRINGS, STANDARD_ENCODING } from './psEncodings';

/** sfnt の表を取り出す (無ければ undefined) */
export function cffTable(otf: Uint8Array): Uint8Array | undefined {
  if (otf.length < 12) return undefined;
  const v = new DataView(otf.buffer, otf.byteOffset, otf.byteLength);
  const n = v.getUint16(4);
  for (let k = 0; k < n; k++) {
    const p = 12 + k * 16;
    if (p + 16 > otf.length) return undefined;
    const tag = String.fromCharCode(otf[p], otf[p + 1], otf[p + 2], otf[p + 3]);
    if (tag !== 'CFF ') continue;
    const off = v.getUint32(p + 8);
    const len = v.getUint32(p + 12);
    if (off + len > otf.length) return undefined;
    return otf.subarray(off, off + len);
  }
  return undefined;
}

export interface Index {
  /** INDEX の始まりと終わり (CFF の中の位置) */
  start: number;
  end: number;
  /** 各項目の [始まり, 終わり] */
  items: Array<[number, number]>;
}

/**
 * INDEX (CFF §5) を読む。lenient でなければ、途中で切れた INDEX は Error (部分書体を作るときは元の CFF に戻る)。
 * lenient なら (EPS の中の壊れた書体でも読めるところまで読む) 検査をせず、足りないバイトは 0 とみなす
 */
export function readIndex(b: Uint8Array, at: number, lenient = false): Index {
  if (!lenient && at + 2 > b.length) throw new Error('CFF: INDEX が途中で切れています');
  const count = ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
  if (count === 0) return { start: at, end: at + 2, items: [] };
  const offSize = b[at + 2] ?? 0;
  if (!lenient && !(offSize >= 1 && offSize <= 4)) throw new Error('CFF: INDEX の offSize が読めません');
  const offAt = at + 3;
  // 位置の表が入りきらない (読むと undefined → NaN になり、下の end の検査を通ってしまう) 壊れた INDEX
  if (!lenient && offAt + (count + 1) * offSize > b.length) throw new Error('CFF: INDEX が途中で切れています');
  const dataBase = offAt + (count + 1) * offSize - 1;
  const off = (k: number) => {
    let x = 0;
    for (let q = 0; q < offSize; q++) x = x * 256 + (b[offAt + k * offSize + q] ?? 0);
    return x;
  };
  const items: Array<[number, number]> = [];
  for (let k = 0; k < count; k++) items.push([dataBase + off(k), dataBase + off(k + 1)]);
  const end = dataBase + off(count);
  if (!lenient && (!Number.isFinite(end) || end > b.length)) throw new Error('CFF: INDEX が途中で切れています');
  return { start: at, end, items };
}

/** INDEX を書く (項目の並びから) */
function writeIndex(items: Uint8Array[]): Uint8Array {
  if (!items.length) return new Uint8Array([0, 0]);
  const total = items.reduce((a, it) => a + it.length, 0) + 1;
  const offSize = total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
  const out = new Uint8Array(3 + (items.length + 1) * offSize + total - 1);
  out[0] = items.length >> 8;
  out[1] = items.length & 0xff;
  out[2] = offSize;
  let off = 1;
  let p = 3;
  const put = (x: number) => {
    for (let q = offSize - 1; q >= 0; q--) out[p + q] = (x >>> (8 * (offSize - 1 - q))) & 0xff;
    p += offSize;
  };
  put(off);
  for (const it of items) {
    off += it.length;
    put(off);
  }
  for (const it of items) {
    out.set(it, p);
    p += it.length;
  }
  return out;
}

/** DICT の 1 項目: 演算子 (12 x は 1200 + x)、数の並び、数の部分の元のバイト列 */
export interface DictEntry {
  op: number;
  nums: number[];
  raw: Uint8Array;
}

/**
 * DICT (CFF §4) を読む (b の start から end まで)。lenient でなければ、読めないバイトは Error。
 * lenient なら (EPS の中の書体) 読めないバイトは 1 バイト読み飛ばす
 */
export function readDict(b: Uint8Array, start: number, end: number, lenient = false): DictEntry[] {
  const out: DictEntry[] = [];
  let nums: number[] = [];
  let numStart = start;
  let p = start;
  while (p < end) {
    const b0 = b[p];
    if (b0 <= 21) {
      let op = b0;
      const opStart = p;
      p++;
      if (b0 === 12) op = 1200 + b[p++];
      out.push({ op, nums, raw: b.subarray(numStart, opStart) });
      nums = [];
      numStart = p;
    } else if (b0 === 28) {
      nums.push((((b[p + 1] << 8) | b[p + 2]) << 16) >> 16);
      p += 3;
    } else if (b0 === 29) {
      nums.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]);
      p += 5;
    } else if (b0 === 30) {
      // 実数 (表 5 の 4 ビットの組。0xf で終わる)
      let s = '';
      p++;
      const nib = '0123456789.EE?-';
      for (let done = false; !done && p < end; p++) {
        for (const n of [b[p] >> 4, b[p] & 15]) {
          if (n === 15) {
            done = true;
            break;
          }
          s += n === 0xc ? 'E-' : nib[n];
        }
      }
      nums.push(parseFloat(s));
    } else if (b0 >= 32 && b0 <= 246) {
      nums.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      nums.push((b0 - 247) * 256 + b[p + 1] + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      nums.push(-(b0 - 251) * 256 - b[p + 1] - 108);
      p += 2;
    } else if (lenient) p++;
    else throw new Error(`CFF: DICT の値 ${b0} が読めません`);
  }
  return out;
}

/** 4 バイトの整数 (29 の形。値によらず長さが同じなので、位置を後から入れられる) */
const int32 = (x: number) => [29, (x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff];

/** DICT を書く。replace にある演算子は、その数の並び (4 バイトの整数) で書き直す */
function writeDict(entries: DictEntry[], replace: Map<number, number[]>): Uint8Array {
  const out: number[] = [];
  for (const e of entries) {
    const r = replace.get(e.op);
    if (r) for (const x of r) out.push(...int32(x));
    else out.push(...e.raw);
    if (e.op >= 1200) out.push(12, e.op - 1200);
    else out.push(e.op);
  }
  return new Uint8Array(out);
}

const get = (d: DictEntry[], op: number) => d.find((e) => e.op === op)?.nums;

/** charset の長さ (バイト) と、GID ごとの SID・CID (GID 0 は 0) */
function readCharset(b: Uint8Array, at: number, nGlyphs: number): { len: number; ids: Uint32Array } {
  const ids = new Uint32Array(nGlyphs);
  const fmt = b[at];
  let p = at + 1;
  let g = 1;
  if (fmt === 0) {
    for (; g < nGlyphs; g++, p += 2) ids[g] = (b[p] << 8) | b[p + 1];
  } else if (fmt === 1 || fmt === 2) {
    while (g < nGlyphs) {
      if (p + (fmt === 1 ? 3 : 4) > b.length) throw new Error('CFF: charset が途中で切れています');
      const first = (b[p] << 8) | b[p + 1];
      const nLeft = fmt === 1 ? b[p + 2] : (b[p + 2] << 8) | b[p + 3];
      p += fmt === 1 ? 3 : 4;
      for (let k = 0; k <= nLeft && g < nGlyphs; k++) ids[g++] = first + k;
    }
  } else throw new Error(`CFF: charset の形 ${fmt} が読めません`);
  return { len: p - at, ids };
}

/** FDSelect の長さ (バイト) */
function fdSelectLength(b: Uint8Array, at: number, nGlyphs: number): number {
  const fmt = b[at];
  if (fmt === 0) return 1 + nGlyphs;
  if (fmt === 3) return 1 + 2 + 3 * ((b[at + 1] << 8) | b[at + 2]) + 2;
  throw new Error(`CFF: FDSelect の形 ${fmt} が読めません`);
}

/** Encoding の長さ (バイト。名前の書体の独自の Encoding) */
function encodingLength(b: Uint8Array, at: number): number {
  const fmt = b[at] & 0x7f;
  let len = fmt === 0 ? 2 + b[at + 1] : fmt === 1 ? 2 + 2 * b[at + 1] : NaN;
  if (Number.isNaN(len)) throw new Error(`CFF: Encoding の形 ${fmt} が読めません`);
  if (b[at] & 0x80) len += 1 + 3 * b[at + len];
  return len;
}

interface Parsed {
  hdrSize: number;
  name: Index;
  top: DictEntry[];
  strings: Index;
  gsubrs: Index;
  charStrings: Index;
  cidKeyed: boolean;
}

function parse(b: Uint8Array): Parsed {
  if (b.length < 4 || b[0] !== 1) throw new Error('CFF: 版 1 の CFF ではありません');
  const hdrSize = b[2];
  const name = readIndex(b, hdrSize);
  const topIdx = readIndex(b, name.end);
  if (name.items.length !== 1 || topIdx.items.length !== 1) throw new Error('CFF: 書体が 1 つではありません');
  const top = readDict(b, topIdx.items[0][0], topIdx.items[0][1]);
  const strings = readIndex(b, topIdx.end);
  const gsubrs = readIndex(b, strings.end);
  const cs = get(top, 17);
  if (!cs) throw new Error('CFF: CharStrings がありません');
  const charStrings = readIndex(b, cs[0]);
  return { hdrSize, name, top, strings, gsubrs, charStrings, cidKeyed: !!get(top, 1230) };
}

/** 字形 (CharStrings INDEX の各項目) の並び (試験・点検用) */
export function cffCharStrings(cff: Uint8Array): Uint8Array[] {
  return parse(cff).charStrings.items.map(([a, z]) => cff.slice(a, z));
}

/** CID 方式の CFF の、GID から CID への対応。CID 方式でなければ undefined (CID = GID。ISO 32000-2 §9.7.4.2) */
export function cffGidToCid(cff: Uint8Array): Uint32Array | undefined {
  const p = parse(cff);
  if (!p.cidKeyed) return undefined;
  const cs = get(p.top, 15)?.[0] ?? 0;
  const n = p.charStrings.items.length;
  // CID 方式の書体の charset は、定義済みの charset (0〜2) ではなく、書体の中の表
  if (cs <= 2) return Uint32Array.from({ length: n }, (_, g) => g);
  return readCharset(cff, cs, n).ids;
}

/**
 * 字形の命令 (Type 2) の endchar が 4 引数 (seac: 標準の符号で部品の字を合成する。Type 2 付録 C) なら、その [bchar, achar] を返す。
 * 数と hintmask の長さだけを追い、callsubr・callgsubr は追わない (スタックを空にして続ける。部品を subr から渡す字は見つけない)
 */
function seacComponents(cs: Uint8Array): number[] {
  const st: number[] = [];
  let stems = 0;
  for (let i = 0; i < cs.length; ) {
    const b0 = cs[i++];
    if (b0 >= 32 || b0 === 28) {
      if (b0 === 28) {
        st.push(((cs[i] << 24) | (cs[i + 1] << 16)) >> 16);
        i += 2;
      } else if (b0 <= 246) st.push(b0 - 139);
      else if (b0 <= 250) st.push((b0 - 247) * 256 + cs[i++] + 108);
      else if (b0 <= 254) st.push(-(b0 - 251) * 256 - cs[i++] - 108);
      else {
        st.push(((cs[i] << 24) | (cs[i + 1] << 16) | (cs[i + 2] << 8) | cs[i + 3]) / 65536);
        i += 4;
      }
      continue;
    }
    switch (b0) {
      case 1: // hstem
      case 3: // vstem
      case 18: // hstemhm
      case 23: // vstemhm
        stems += st.length >> 1;
        st.length = 0;
        break;
      case 19: // hintmask
      case 20: // cntrmask
        stems += st.length >> 1;
        st.length = 0;
        i += (stems + 7) >> 3;
        break;
      case 14: // endchar
        return st.length >= 4 ? st.slice(-2).map((v) => Math.round(v)) : [];
      case 12: // escape
        i++;
        st.length = 0;
        break;
      default:
        st.length = 0;
    }
  }
  return [];
}

/** 非 CID の書体の、字の名前 → GID (charset の SID から。ISOAdobe (0) は GID = SID) */
function glyphNames(p: Parsed, cff: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  const n = p.charStrings.items.length;
  const cs = get(p.top, 15)?.[0] ?? 0;
  if (cs === 1 || cs === 2) return out; // Expert の charset は持たない
  const sids = cs === 0 ? Uint32Array.from({ length: n }, (_, g) => g) : readCharset(cff, cs, n).ids;
  const name = (sid: number) => (sid < CFF_STANDARD_STRINGS.length ? CFF_STANDARD_STRINGS[sid] : new TextDecoder('latin1').decode(cff.subarray(...(p.strings.items[sid - CFF_STANDARD_STRINGS.length] ?? [0, 0]))));
  for (let g = 0; g < n; g++) if (!out.has(name(sids[g]))) out.set(name(sids[g]), g);
  return out;
}

/**
 * 使う字 (GID の集合) のほかの字形を空 (endchar だけ) にした CFF を作る。GID 0 (.notdef) は残す。
 * 字の番号・charset・FDSelect・Encoding・字形の部品 (Subrs) はそのまま写すので、字の番号と CID は元の書体と同じ。
 * endchar の 4 引数 (seac: 標準の符号で部品の字を合成する) で参照される字も残す (非 CID の書体。部品を subr から渡す字は除く)
 */
export function subsetCff(cff: Uint8Array, keep: Set<number>): Uint8Array {
  const p = parse(cff);
  if ((get(p.top, 1206)?.[0] ?? 2) !== 2) throw new Error('CFF: Type 2 の字形ではありません');
  if (get(p.top, 1220)) throw new Error('CFF: SyntheticBase の書体は扱いません');
  const n = p.charStrings.items.length;
  const raw = (a: number, z: number) => cff.subarray(a, z);
  const keepAll = new Set(keep);
  if (!p.cidKeyed) {
    const names = glyphNames(p, cff);
    const queue = [...keep];
    while (queue.length) {
      const g = queue.pop()!;
      const item = p.charStrings.items[g];
      if (!item) continue;
      for (const code of seacComponents(raw(item[0], item[1]))) {
        const gid = names.get(STANDARD_ENCODING[code] ?? '');
        if (gid !== undefined && !keepAll.has(gid)) {
          keepAll.add(gid);
          queue.push(gid);
        }
      }
    }
  }
  const glyphs = p.charStrings.items.map(([a, z], g) => (g === 0 || keepAll.has(g) ? raw(a, z) : new Uint8Array([14])));

  // 写すだけの表 (元の位置と長さ)
  const charsetAt = get(p.top, 15)?.[0] ?? 0;
  const charset = charsetAt > 2 ? raw(charsetAt, charsetAt + readCharset(cff, charsetAt, n).len) : undefined;
  const encAt = get(p.top, 16)?.[0] ?? 0;
  const encoding = encAt > 1 ? raw(encAt, encAt + encodingLength(cff, encAt)) : undefined;
  const fdSelAt = get(p.top, 1237)?.[0];
  const fdSelect = fdSelAt !== undefined ? raw(fdSelAt, fdSelAt + fdSelectLength(cff, fdSelAt, n)) : undefined;

  // Private DICT と、その局所の Subrs (Private DICT の始まりからの位置)
  type Priv = { dict: DictEntry[]; subrs?: Uint8Array };
  const readPrivate = (d: DictEntry[]): Priv | undefined => {
    const pr = get(d, 18);
    if (!pr) return undefined;
    const [size, at] = pr;
    const dict = readDict(cff, at, at + size);
    const so = get(dict, 19)?.[0];
    const subrs = so !== undefined ? (() => {
      const ix = readIndex(cff, at + so);
      return raw(ix.start, ix.end);
    })() : undefined;
    return { dict, subrs };
  };
  const fdArrayAt = get(p.top, 1236)?.[0];
  const fds = fdArrayAt !== undefined ? readIndex(cff, fdArrayAt).items.map(([a, z]) => readDict(cff, a, z)) : undefined;
  const fdPrivs = fds?.map(readPrivate);
  const topPriv = fds ? undefined : readPrivate(p.top);

  const privBytes = (pv: Priv) => writeDict(pv.dict, pv.subrs ? new Map([[19, [0]]]) : new Map());
  const charStrings = writeIndex(glyphs);
  const head = raw(0, p.hdrSize);
  const nameIdx = raw(p.name.start, p.name.end);
  const strings = raw(p.strings.start, p.strings.end);
  const gsubrs = raw(p.gsubrs.start, p.gsubrs.end);

  // 位置を決める: Top DICT の長さは、位置を 4 バイトの整数で書くので、値によらず決まる
  const topReplace = (pos: Record<string, number>) => {
    const m = new Map<number, number[]>();
    if (charset) m.set(15, [pos.charset]);
    if (encoding) m.set(16, [pos.encoding]);
    m.set(17, [pos.charStrings]);
    if (fdSelect) m.set(1237, [pos.fdSelect]);
    if (fds) m.set(1236, [pos.fdArray]);
    if (topPriv) m.set(18, [privBytes(topPriv).length, pos.priv0]);
    return m;
  };
  const topLen = writeIndex([writeDict(p.top, topReplace({ charset: 0, encoding: 0, charStrings: 0, fdSelect: 0, fdArray: 0, priv0: 0 }))]).length;
  let at = head.length + nameIdx.length + topLen + strings.length + gsubrs.length;
  const pos: Record<string, number> = {};
  const place = (key: string, len: number) => {
    pos[key] = at;
    at += len;
  };
  if (encoding) place('encoding', encoding.length);
  if (charset) place('charset', charset.length);
  if (fdSelect) place('fdSelect', fdSelect.length);
  place('charStrings', charStrings.length);
  // FDArray: 各 FD の Private の位置が決まってから書く (FD DICT の長さは位置によらない)
  const privs = fds ? fdPrivs! : topPriv ? [topPriv] : [];
  const fdArrayLen = fds ? writeIndex(fds.map((d, k) => writeDict(d, fdPrivs![k] ? new Map([[18, [0, 0]]]) : new Map()))).length : 0;
  if (fds) place('fdArray', fdArrayLen);
  const privPos: number[] = [];
  for (const pv of privs) {
    if (!pv) {
      privPos.push(0);
      continue;
    }
    privPos.push(at);
    at += privBytes(pv).length + (pv.subrs?.length ?? 0);
  }
  pos.priv0 = privPos[0] ?? 0;

  const parts: Uint8Array[] = [head, nameIdx, writeIndex([writeDict(p.top, topReplace(pos))]), strings, gsubrs];
  if (encoding) parts.push(encoding);
  if (charset) parts.push(charset);
  if (fdSelect) parts.push(fdSelect);
  parts.push(charStrings);
  if (fds) parts.push(writeIndex(fds.map((d, k) => (fdPrivs![k] ? writeDict(d, new Map([[18, [privBytes(fdPrivs![k]!).length, privPos[k]]]])) : writeDict(d, new Map())))));
  for (const pv of privs) {
    if (!pv) continue;
    const pb = pv.subrs ? writeDict(pv.dict, new Map([[19, [privBytes(pv).length]]])) : privBytes(pv);
    parts.push(pb);
    if (pv.subrs) parts.push(pv.subrs);
  }
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let q = 0;
  for (const x of parts) {
    out.set(x, q);
    q += x.length;
  }
  if (q !== at) throw new Error('CFF: 部分書体の長さが合いません');
  return out;
}
