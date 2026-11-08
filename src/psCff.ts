/**
 * psCff — CFF (Compact Font Format) の書体の集まりを読み、Type 2 の字形の命令を実行して字の輪郭を作る。
 *
 * The Compact Font Format Specification (Adobe Technical Note #5176。以下 CFF) と
 * The Type 2 Charstring Format (Adobe Technical Note #5177。以下 T2) から書いた。
 *  - CFF: 頭 (§6)・INDEX (§5)・DICT (§4、表 9・10・23)・String INDEX と標準の文字列 (§10、付録 A)・符号化 (§12)・文字集合 (§13)・
 *    CharStrings (§14)・Private DICT (§15)・部分の命令と番号の偏り (§16)・CID の書体 (§18)・FDSelect (§19)
 *  - T2: 数の符号 (§3.2)・幅 (§3.1)・パスの命令 (§4.1)・endchar と seac (§4.2・付録 C)・ヒント (§4.3。字の形は変えないので数えるだけ)・
 *    算術・保存・条件・部分の命令 (§4.4〜4.7)
 * 予め決まった符号化は StandardEncoding だけを扱う (Expert の符号化・文字集合は扱わない)。
 */
import type { Seg } from './matrix';
import { readDict as readDictEntries, readIndex } from './cff';
import type { Glyph } from './psFonts';
import { CFF_STANDARD_STRINGS, STANDARD_ENCODING } from './psEncodings';

export interface CffPrivate {
  subrs: Uint8Array[];
  defaultWidthX: number;
  nominalWidthX: number;
}

export interface CffFont {
  name: string;
  /** CID の書体 (Top DICT が ROS で始まる。§18) */
  cid: boolean;
  charStrings: Uint8Array[];
  gsubrs: Uint8Array[];
  /** GID → SID (CID の書体では CID) */
  charset: number[];
  /** 符号 → GID (CID の書体では無い) */
  encoding: Map<number, number>;
  /** 字の名前 → GID */
  byName: Map<string, number>;
  /** CID → GID */
  byCid: Map<number, number>;
  fontMatrix: number[];
  fontBBox: number[];
  paintType: number;
  /** GID → FD の番号 (CID の書体) */
  fdSelect: (gid: number) => number;
  privates: CffPrivate[];
  /** FD の FontMatrix (CID の書体。無ければ undefined) */
  fdMatrices: Array<number[] | undefined>;
  strings: (sid: number) => string;
  charstringType: number;
}

class Reader {
  constructor(public b: Uint8Array) {}
  u8(o: number) {
    return this.b[o] ?? 0;
  }
  u16(o: number) {
    return (this.u8(o) << 8) | this.u8(o + 1);
  }
  off(o: number, n: number) {
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + this.u8(o + k);
    return v;
  }
  /** INDEX (§5): 中身の並びと、INDEX の次の位置 (cff.ts の readIndex。壊れた書体も読めるところまで読む) */
  index(o: number): { items: Uint8Array[]; end: number } {
    const ix = readIndex(this.b, o, true);
    return { items: ix.items.map(([s, e]) => this.b.subarray(s, e)), end: ix.end };
  }
}

/** DICT (§4): 演算子 (2 バイトのものは 1200 + 2 バイト目) → 数の並び (cff.ts の readDict。読めないバイトは読み飛ばす) */
function readDict(b: Uint8Array): Map<number, number[]> {
  return new Map(readDictEntries(b, 0, b.length, true).map((e) => [e.op, e.nums]));
}

const bias = (n: number, type: number) => (type === 1 ? 0 : n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

/** CFF のデータを読み、書体の並びを返す */
export function parseCff(data: Uint8Array): CffFont[] {
  const r = new Reader(data);
  if (r.u8(0) !== 1) return [];
  const hdrSize = r.u8(2);
  const names = r.index(hdrSize);
  const tops = r.index(names.end);
  const strs = r.index(tops.end);
  const gsubrs = r.index(strs.end).items;
  const strings = (sid: number) => (sid < CFF_STANDARD_STRINGS.length ? CFF_STANDARD_STRINGS[sid] : new TextDecoder('latin1').decode(strs.items[sid - CFF_STANDARD_STRINGS.length] ?? new Uint8Array(0)));
  const fonts: CffFont[] = [];
  names.items.forEach((nb, k) => {
    if (!nb.length || nb[0] === 0) return; // 消した書体 (§7)
    const top = readDict(tops.items[k] ?? new Uint8Array(0));
    const g = (key: number, def: number[]) => top.get(key) ?? def;
    const csType = g(1206, [2])[0];
    const cs = r.index(g(17, [0])[0]).items;
    const n = cs.length;
    const cid = top.has(1230);
    // 文字集合 (§13): 0 は ISOAdobe (GID i = SID i)
    const charset: number[] = [0];
    const co = g(15, [0])[0];
    if (co === 0 && !cid) for (let i = 1; i < n; i++) charset.push(i);
    else if (co > 2) {
      const fmt = r.u8(co);
      let p = co + 1;
      while (charset.length < n) {
        if (fmt === 0) {
          charset.push(r.u16(p));
          p += 2;
        } else {
          const first = r.u16(p);
          const left = fmt === 1 ? r.u8(p + 2) : r.u16(p + 2);
          p += fmt === 1 ? 3 : 4;
          for (let j = 0; j <= left && charset.length < n; j++) charset.push(first + j);
        }
      }
    } else for (let i = 1; i < n; i++) charset.push(i);
    const byName = new Map<string, number>();
    const byCid = new Map<number, number>();
    charset.forEach((s, gid) => {
      if (cid) byCid.set(s, gid);
      else byName.set(gid === 0 ? '.notdef' : strings(s), gid);
    });
    // 符号化 (§12): 0 は StandardEncoding (符号 → 名前 → GID)
    const encoding = new Map<number, number>();
    if (!cid) {
      const eo = g(16, [0])[0];
      if (eo === 0)
        STANDARD_ENCODING.forEach((nm, code) => {
          const gid = byName.get(nm);
          if (gid && nm !== '.notdef') encoding.set(code, gid);
        });
      else if (eo > 1) {
        const fmt = r.u8(eo);
        let p = eo + 1;
        if ((fmt & 0x7f) === 0) {
          const nc = r.u8(p++);
          for (let i = 0; i < nc; i++) encoding.set(r.u8(p++), i + 1);
        } else {
          const nr = r.u8(p++);
          let gid = 1;
          for (let i = 0; i < nr; i++) {
            const first = r.u8(p);
            const left = r.u8(p + 1);
            p += 2;
            for (let j = 0; j <= left; j++) encoding.set(first + j, gid++);
          }
        }
        if (fmt & 0x80) {
          const ns = r.u8(p++);
          for (let i = 0; i < ns; i++) {
            const code = r.u8(p);
            const gidOf = byName.get(strings(r.u16(p + 1)));
            if (gidOf !== undefined) encoding.set(code, gidOf);
            p += 3;
          }
        }
      }
    }
    const readPrivate = (pd: number[] | undefined): CffPrivate => {
      if (!pd || pd.length < 2) return { subrs: [], defaultWidthX: 0, nominalWidthX: 0 };
      const [size, off] = pd;
      const p = readDict(data.subarray(off, off + size));
      const so = p.get(19)?.[0];
      return { subrs: so ? r.index(off + so).items : [], defaultWidthX: p.get(20)?.[0] ?? 0, nominalWidthX: p.get(21)?.[0] ?? 0 };
    };
    const privates: CffPrivate[] = [];
    const fdMatrices: Array<number[] | undefined> = [];
    let fdSelect = (_gid: number) => 0;
    if (cid) {
      for (const fdb of r.index(g(1236, [0])[0]).items) {
        const fd = readDict(fdb);
        privates.push(readPrivate(fd.get(18)));
        fdMatrices.push(fd.get(1207));
      }
      const fo = g(1237, [0])[0];
      const fmt = r.u8(fo);
      if (fmt === 0) fdSelect = (gid) => r.u8(fo + 1 + gid);
      else if (fmt === 3) {
        const nr = r.u16(fo + 1);
        const ranges: Array<[number, number]> = [];
        for (let i = 0; i < nr; i++) ranges.push([r.u16(fo + 3 + i * 3), r.u8(fo + 5 + i * 3)]);
        fdSelect = (gid) => {
          let fd = 0;
          for (const [first, f] of ranges) {
            if (first > gid) break;
            fd = f;
          }
          return fd;
        };
      }
    } else privates.push(readPrivate(top.get(18)));
    fonts.push({
      name: new TextDecoder('latin1').decode(nb),
      cid,
      charStrings: cs,
      gsubrs,
      charset,
      encoding,
      byName,
      byCid,
      fontMatrix: g(1207, [0.001, 0, 0, 0.001, 0, 0]),
      fontBBox: g(5, [0, 0, 0, 0]),
      paintType: g(1205, [0])[0],
      fdSelect,
      privates,
      fdMatrices,
      strings,
      charstringType: csType,
    });
  });
  return fonts;
}

/** Type 2 の字形の命令を実行する (T2 第 3・4 章)。GID の字の輪郭と送り */
export function cffGlyph(f: CffFont, gid: number): Glyph | undefined {
  const cs = f.charStrings[gid];
  if (!cs) return undefined;
  const priv = f.privates[f.cid ? f.fdSelect(gid) : 0] ?? f.privates[0];
  return runType2(cs, f, priv, 0);
}

function runType2(cs: Uint8Array, f: CffFont, priv: CffPrivate, seacDepth: number): Glyph | undefined {
  const segs: Seg[] = [];
  let x = 0;
  let y = 0;
  let open = false;
  let width: number | undefined;
  let nStems = 0;
  const st: number[] = [];
  const transient: number[] = [];
  let done = false;
  let steps = 0;
  const lbias = bias(priv.subrs.length, f.charstringType);
  const gbias = bias(f.gsubrs.length, f.charstringType);
  const moveTo = (dx: number, dy: number) => {
    if (open) segs.push({ op: 'Z' });
    x += dx;
    y += dy;
    segs.push({ op: 'M', x, y });
    open = true;
  };
  const lineTo = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    segs.push({ op: 'L', x, y });
  };
  const curveTo = (dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number) => {
    const x1 = x + dxa;
    const y1 = y + dya;
    const x2 = x1 + dxb;
    const y2 = y1 + dyb;
    x = x2 + dxc;
    y = y2 + dyc;
    segs.push({ op: 'C', x1, y1, x2, y2, x, y });
  };
  /** 最初のスタックを空にする命令で、引数より 1 つ多ければ、先頭は幅 (nominalWidthX からの差。無ければ defaultWidthX。§3.1・§4.1 Note 4) */
  const takeWidth = (extra: boolean) => {
    if (width !== undefined) return;
    if (extra) width = st.shift()! + priv.nominalWidthX;
    else width = priv.defaultWidthX;
  };
  const stems = () => {
    takeWidth(st.length % 2 === 1);
    nStems += st.length >> 1;
    st.length = 0;
  };
  const exec = (b: Uint8Array, depth: number): boolean => {
    let i = 0;
    while (i < b.length && !done) {
      if (++steps > 200000) return false;
      const v = b[i++];
      if (v >= 32 || v === 28) {
        if (v === 28) {
          st.push(((b[i] << 24) >> 16) | b[i + 1]);
          i += 2;
        } else if (v <= 246) st.push(v - 139);
        else if (v <= 250) st.push((v - 247) * 256 + b[i++] + 108);
        else if (v <= 254) st.push(-(v - 251) * 256 - b[i++] - 108);
        else {
          // 16.16 の固定小数 (§3.2)
          st.push(((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) / 65536);
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          stems();
          break;
        case 19: // hintmask
        case 20: // cntrmask
          // 直前の数は vstem の暗黙の宣言 (§4.3 hintmask の説明)
          if (st.length) stems();
          else takeWidth(false);
          i += (nStems + 7) >> 3;
          st.length = 0;
          break;
        case 21: // rmoveto
          takeWidth(st.length > 2);
          moveTo(st[0] ?? 0, st[1] ?? 0);
          st.length = 0;
          break;
        case 22: // hmoveto
          takeWidth(st.length > 1);
          moveTo(st[0] ?? 0, 0);
          st.length = 0;
          break;
        case 4: // vmoveto
          takeWidth(st.length > 1);
          moveTo(0, st[0] ?? 0);
          st.length = 0;
          break;
        case 5: // rlineto
          for (let k = 0; k + 1 < st.length; k += 2) lineTo(st[k], st[k + 1]);
          st.length = 0;
          break;
        case 6: // hlineto
        case 7: {
          // vlineto: 横と縦を交互に
          let horiz = v === 6;
          for (const d of st) {
            if (horiz) lineTo(d, 0);
            else lineTo(0, d);
            horiz = !horiz;
          }
          st.length = 0;
          break;
        }
        case 8: // rrcurveto
          for (let k = 0; k + 5 < st.length; k += 6) curveTo(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          st.length = 0;
          break;
        case 24: {
          // rcurveline
          let k = 0;
          for (; k + 7 < st.length; k += 6) curveTo(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          lineTo(st[k], st[k + 1]);
          st.length = 0;
          break;
        }
        case 25: {
          // rlinecurve
          let k = 0;
          for (; k + 7 < st.length; k += 2) lineTo(st[k], st[k + 1]);
          curveTo(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          st.length = 0;
          break;
        }
        case 26: {
          // vvcurveto: dx1? {dya dxb dyb dyc}+
          let k = 0;
          let dx1 = 0;
          if (st.length % 4 === 1) dx1 = st[k++];
          for (; k + 3 < st.length; k += 4) {
            curveTo(dx1, st[k], st[k + 1], st[k + 2], 0, st[k + 3]);
            dx1 = 0;
          }
          st.length = 0;
          break;
        }
        case 27: {
          // hhcurveto: dy1? {dxa dxb dyb dxc}+
          let k = 0;
          let dy1 = 0;
          if (st.length % 4 === 1) dy1 = st[k++];
          for (; k + 3 < st.length; k += 4) {
            curveTo(st[k], dy1, st[k + 1], st[k + 2], st[k + 3], 0);
            dy1 = 0;
          }
          st.length = 0;
          break;
        }
        case 30: // vhcurveto
        case 31: {
          // hvcurveto: 始めの向き (縦 / 横) を交互に。最後に余る 1 つは、最後の曲線の終わりの向きと直交する成分
          let horiz = v === 31;
          let k = 0;
          while (k + 3 < st.length) {
            const last = st.length - k === 5;
            const e = last ? st[k + 4] : 0;
            if (horiz) curveTo(st[k], 0, st[k + 1], st[k + 2], e, st[k + 3]);
            else curveTo(0, st[k], st[k + 1], st[k + 2], st[k + 3], e);
            k += last ? 5 : 4;
            horiz = !horiz;
          }
          st.length = 0;
          break;
        }
        case 10: {
          // callsubr
          const n = (st.pop() ?? 0) + lbias;
          const s = priv.subrs[n];
          if (!s || depth >= 10 || !exec(s, depth + 1)) return false;
          break;
        }
        case 29: {
          // callgsubr
          const n = (st.pop() ?? 0) + gbias;
          const s = f.gsubrs[n];
          if (!s || depth >= 10 || !exec(s, depth + 1)) return false;
          break;
        }
        case 11: // return
          return true;
        case 14: {
          // endchar (4 つの数があれば seac。付録 C)
          takeWidth(st.length === 5 || st.length === 1);
          if (st.length >= 4 && seacDepth === 0) {
            const [adx, ady, bchar, achar] = st.slice(-4);
            const gb = f.byName.get(STANDARD_ENCODING[bchar] ?? '');
            const ga = f.byName.get(STANDARD_ENCODING[achar] ?? '');
            const base = gb !== undefined ? runType2(f.charStrings[gb], f, priv, 1) : undefined;
            const acc = ga !== undefined ? runType2(f.charStrings[ga], f, priv, 1) : undefined;
            if (base) segs.push(...base.segs);
            if (acc)
              for (const s of acc.segs) {
                if (s.op === 'Z') segs.push(s);
                else if (s.op === 'C') segs.push({ op: 'C', x1: s.x1 + adx, y1: s.y1 + ady, x2: s.x2 + adx, y2: s.y2 + ady, x: s.x + adx, y: s.y + ady });
                else segs.push({ op: s.op, x: s.x + adx, y: s.y + ady });
              }
            open = false;
          }
          st.length = 0;
          done = true;
          break;
        }
        case 12: {
          const e = b[i++];
          switch (e) {
            case 35: {
              // flex: 2 本の曲線 (常に曲線として描く)
              curveTo(st[0], st[1], st[2], st[3], st[4], st[5]);
              curveTo(st[6], st[7], st[8], st[9], st[10], st[11]);
              break;
            }
            case 34: {
              // hflex: dx1 dx2 dy2 dx3 dx4 dx5 dx6
              const [dx1, dx2, dy2, dx3, dx4, dx5, dx6] = st;
              curveTo(dx1, 0, dx2, dy2, dx3, 0);
              curveTo(dx4, 0, dx5, -dy2, dx6, 0);
              break;
            }
            case 36: {
              // hflex1: dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6
              const [dx1, dy1, dx2, dy2, dx3, dx4, dx5, dy5, dx6] = st;
              curveTo(dx1, dy1, dx2, dy2, dx3, 0);
              curveTo(dx4, 0, dx5, dy5, dx6, -(dy1 + dy2 + dy5));
              break;
            }
            case 37: {
              // flex1: 最後の点の dx か dy を d6 で与える (T2 §4.1 flex1)
              const a = st;
              let dx = 0;
              let dy = 0;
              for (let k = 0; k < 10; k += 2) {
                dx += a[k];
                dy += a[k + 1];
              }
              const horiz = Math.abs(dx) > Math.abs(dy);
              curveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
              curveTo(a[6], a[7], a[8], a[9], horiz ? a[10] : -dx, horiz ? -dy : a[10]);
              break;
            }
            case 9: // abs
              st.push(Math.abs(st.pop() ?? 0));
              break;
            case 10: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) + b2);
              break;
            }
            case 11: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) - b2);
              break;
            }
            case 12: {
              const b2 = st.pop() ?? 0;
              const a2 = st.pop() ?? 0;
              st.push(b2 ? a2 / b2 : 0);
              break;
            }
            case 14:
              st.push(-(st.pop() ?? 0));
              break;
            case 23:
              st.push(Math.random() || 1);
              break;
            case 24: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) * b2);
              break;
            }
            case 26:
              st.push(Math.sqrt(Math.max(0, st.pop() ?? 0)));
              break;
            case 18: // drop
              st.pop();
              break;
            case 28: {
              // exch
              const b2 = st.pop() ?? 0;
              const a2 = st.pop() ?? 0;
              st.push(b2, a2);
              break;
            }
            case 29: {
              // index
              const k = st.pop() ?? 0;
              st.push(st[st.length - 1 - Math.max(0, k)] ?? 0);
              break;
            }
            case 30: {
              // roll
              const j = st.pop() ?? 0;
              const n = st.pop() ?? 0;
              if (n > 0 && n <= st.length) {
                const part = st.splice(st.length - n, n);
                const k = ((j % n) + n) % n;
                st.push(...part.slice(n - k), ...part.slice(0, n - k));
              }
              break;
            }
            case 27: // dup
              st.push(st[st.length - 1] ?? 0);
              break;
            case 20: {
              // put
              const k = st.pop() ?? 0;
              transient[k] = st.pop() ?? 0;
              break;
            }
            case 21: {
              // get
              const k = st.pop() ?? 0;
              st.push(transient[k] ?? 0);
              break;
            }
            case 3: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) && b2 ? 1 : 0);
              break;
            }
            case 4: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) || b2 ? 1 : 0);
              break;
            }
            case 5:
              st.push(st.pop() ? 0 : 1);
              break;
            case 15: {
              const b2 = st.pop() ?? 0;
              st.push((st.pop() ?? 0) === b2 ? 1 : 0);
              break;
            }
            case 22: {
              // ifelse
              const v2 = st.pop() ?? 0;
              const v1 = st.pop() ?? 0;
              const s2 = st.pop() ?? 0;
              const s1 = st.pop() ?? 0;
              st.push(v1 <= v2 ? s1 : s2);
              break;
            }
            default:
              st.length = 0;
          }
          if (e === 35 || e === 34 || e === 36 || e === 37 || e === 0) st.length = 0;
          break;
        }
        default:
          st.length = 0;
      }
    }
    return true;
  };
  if (!exec(cs, 0)) return undefined;
  if (open) segs.push({ op: 'Z' });
  return { segs, wx: width ?? priv.defaultWidthX, wy: 0 };
}
