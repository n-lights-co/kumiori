/**
 * psFonts — PostScript の書体の字の形 (埋め込まれた書体)。
 *
 *  - Type 1 の字形の命令 (charstring): Adobe Type 1 Font Format (以下 T1) の第 6 章の命令、第 7 章の暗号化、
 *    第 8 章の flex (OtherSubrs 0〜2) と字形の切り替え (OtherSubrs 3)。OtherSubrs は T1 §6.4 callothersubr にある
 *    「同じ働きをする組み込みの機能」として持つ (書体の中の OtherSubrs の PostScript は実行しない)。字形の切り替えは常に行える扱い
 *  - eexec の暗号を解くフィルタ (T1 §7.2・PLRM §8.2 eexec)
 *  - CIDFontType 0 の字形の位置の表 (PLRM §5.11.3 Type 0 CIDFonts: CIDMapOffset・FDBytes・GDBytes・SubrMapOffset など)
 *  - CMap (PLRM §5.11.4): 符号の範囲と CID の対応
 * ヒント (hstem・vstem など) は字の形を変えないので読み捨てる。
 */
import type { Seg } from './matrix';
import type { ByteSource } from './psFilters';

// ───────────────────────── 暗号 (T1 第 7 章) ─────────────────────────

const C1 = 52845;
const C2 = 22719;

/** 字形の命令の暗号を解く (鍵 4330。先頭の lenIV バイトを捨てる。lenIV が負なら暗号なし。T1 §7.3) */
export function decryptCharstring(b: Uint8Array, lenIV: number): Uint8Array {
  if (lenIV < 0) return b;
  let r = 4330;
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    out[i] = c ^ (r >> 8);
    r = ((c + r) * C1 + C2) & 0xffff;
  }
  return out.subarray(Math.min(lenIV, out.length));
}

const isHex = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const hexVal = (c: number) => (c <= 0x39 ? c - 0x30 : c <= 0x46 ? c - 55 : c - 87);

/**
 * eexec の暗号を解くデータの元 (鍵 55665、先頭の 4 バイトを捨てる。T1 §7.2)。
 * 最初の 4 バイトがすべて 16 進の字なら 16 進の形として読む (空白は読み飛ばす)
 */
export function eexecSource(src: ByteSource): ByteSource {
  let r = 55665;
  let hex: boolean | undefined;
  const head: number[] = [];
  let skipped = 0;
  const raw = (): number => {
    if (hex === undefined) {
      // 先頭の空白は読み飛ばす (T1 §7.2: 最初の暗号のバイトは空白ではない)
      let c = src.read();
      while (c === 32 || c === 9 || c === 10 || c === 13) c = src.read();
      head.push(c);
      for (let k = 0; k < 3; k++) head.push(src.read());
      hex = head.every((x) => x >= 0 && isHex(x));
    }
    if (!hex) return head.length ? head.shift()! : src.read();
    // 16 進: 2 字で 1 バイト。空白は読み飛ばす
    const nib = (): number => {
      for (;;) {
        const c = head.length ? head.shift()! : src.read();
        if (c < 0) return -1;
        if (isHex(c)) return hexVal(c);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 0) continue;
        return -1;
      }
    };
    const a = nib();
    if (a < 0) return -1;
    const b2 = nib();
    if (b2 < 0) return -1;
    return a * 16 + b2;
  };
  const dec = (): number => {
    const c = raw();
    if (c < 0) return -1;
    const p = c ^ (r >> 8);
    r = ((c + r) * C1 + C2) & 0xffff;
    return p;
  };
  return {
    read() {
      while (skipped < 4) {
        if (dec() < 0) return -1;
        skipped++;
      }
      return dec();
    },
  };
}

// ───────────────────────── Type 1 の字形の命令 (T1 第 6 章) ─────────────────────────

export interface Glyph {
  /** 字の空間の輪郭 */
  segs: Seg[];
  /** 送り (字の空間) */
  wx: number;
  wy: number;
}

export interface CharstringContext {
  /** Subrs の i 番目 (暗号を解いたもの) */
  subr(i: number): Uint8Array | undefined;
  /** seac: StandardEncoding の符号 code の字の命令 (暗号を解いたもの) */
  standardGlyph?(code: number): Uint8Array | undefined;
}

/** Type 1 の字形の命令を実行して、字の輪郭と送りを返す。seacDepth: seac の部品として呼ばれた深さ (自分を参照する字形で再帰が止まらなくならない) */
export function runType1Charstring(cs: Uint8Array, ctx: CharstringContext, seacDepth = 0): Glyph | undefined {
  const segs: Seg[] = [];
  let x = 0;
  let y = 0;
  let wx = 0;
  let wy = 0;
  let sbx = 0;
  let sby = 0;
  let open = false;
  // flex (T1 §8.3): OtherSubrs 1 で始め、2 で rmoveto の点を集め、0 で 2 本の曲線にする
  let flex: Array<[number, number]> | undefined;
  const ps: number[] = []; // PostScript のオペランドスタックの代わり (callothersubr と pop)
  let done = false;
  let calls = 0;
  const moveTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    if (flex) {
      flex.push([x, y]);
      return;
    }
    if (open) segs.push({ op: 'Z' });
    segs.push({ op: 'M', x, y });
    open = true;
  };
  const lineTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    if (!open) {
      segs.push({ op: 'M', x, y });
      open = true;
      return;
    }
    segs.push({ op: 'L', x, y });
  };
  const curveTo = (dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) => {
    const x1 = x + dx1;
    const y1 = y + dy1;
    const x2 = x1 + dx2;
    const y2 = y1 + dy2;
    x = x2 + dx3;
    y = y2 + dy3;
    if (!open) {
      segs.push({ op: 'M', x: x1, y: y1 });
      open = true;
    }
    segs.push({ op: 'C', x1, y1, x2, y2, x, y });
  };
  // オペランドスタック (部分の命令と共有する。T1 §6.4 callsubr)
  const st: number[] = [];
  const exec = (b: Uint8Array, depth: number): boolean => {
    let i = 0;
    while (i < b.length && !done) {
      if (++calls > 100000) return false;
      const v = b[i++];
      if (v >= 32) {
        if (v <= 246) st.push(v - 139);
        else if (v <= 250) st.push((v - 247) * 256 + b[i++] + 108);
        else if (v <= 254) st.push(-(v - 251) * 256 - b[i++] - 108);
        else {
          st.push((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 13: // hsbw
          sbx = st[0];
          wx = st[1];
          wy = 0;
          x = sbx;
          y = 0;
          st.length = 0;
          break;
        case 14: // endchar
          done = true;
          break;
        case 9: // closepath (現在の点は動かさない)
          if (open) {
            segs.push({ op: 'Z' });
            open = false;
          }
          st.length = 0;
          break;
        case 6: // hlineto
          lineTo(x + st[0], y);
          st.length = 0;
          break;
        case 7: // vlineto
          lineTo(x, y + st[0]);
          st.length = 0;
          break;
        case 5: // rlineto
          lineTo(x + st[0], y + st[1]);
          st.length = 0;
          break;
        case 21: // rmoveto
          moveTo(x + st[0], y + st[1]);
          st.length = 0;
          break;
        case 22: // hmoveto
          moveTo(x + st[0], y);
          st.length = 0;
          break;
        case 4: // vmoveto
          moveTo(x, y + st[0]);
          st.length = 0;
          break;
        case 8: // rrcurveto
          curveTo(st[0], st[1], st[2], st[3], st[4], st[5]);
          st.length = 0;
          break;
        case 30: // vhcurveto
          curveTo(0, st[0], st[1], st[2], st[3], 0);
          st.length = 0;
          break;
        case 31: // hvcurveto
          curveTo(st[0], 0, st[1], st[2], 0, st[3]);
          st.length = 0;
          break;
        case 1: // hstem
        case 3: // vstem
          st.length = 0;
          break;
        case 10: {
          // callsubr (入れ子は 10 段まで。T1 §6.4)
          const n = st.pop()!;
          const sb = ctx.subr(n);
          if (!sb || depth >= 10) return false;
          if (!exec(sb, depth + 1)) return false;
          break;
        }
        case 11: // return
          return true;
        case 12: {
          const e = b[i++];
          switch (e) {
            case 0: // dotsection
            case 1: // vstem3
            case 2: // hstem3
              st.length = 0;
              break;
            case 6: {
              // seac (T1 §6.4): アクセントの字を (adx, ady) にずらして重ねる
              const [asb, adx, ady, bchar, achar] = st;
              st.length = 0;
              // 部品の字がさらに seac を使う入れ子は 1 段まで (T1 §6.4 では部品は単純な字。psCff.ts の Type 2 と同じ)
              const base = seacDepth < 1 ? ctx.standardGlyph?.(bchar) : undefined;
              const acc = seacDepth < 1 ? ctx.standardGlyph?.(achar) : undefined;
              if (base) {
                const g = runType1Charstring(base, ctx, seacDepth + 1);
                if (g) segs.push(...g.segs);
              }
              if (acc) {
                const g = runType1Charstring(acc, ctx, seacDepth + 1);
                // アクセントの字の原点は、本体の字の原点から (adx, ady) の位置 (T1 §6.4 seac)
                void asb;
                const ox = adx;
                const oy = ady;
                if (g)
                  for (const s of g.segs) {
                    if (s.op === 'Z') segs.push(s);
                    else if (s.op === 'C') segs.push({ op: 'C', x1: s.x1 + ox, y1: s.y1 + oy, x2: s.x2 + ox, y2: s.y2 + oy, x: s.x + ox, y: s.y + oy });
                    else segs.push({ op: s.op, x: s.x + ox, y: s.y + oy });
                  }
              }
              done = true;
              break;
            }
            case 7: // sbw
              sbx = st[0];
              sby = st[1];
              wx = st[2];
              wy = st[3];
              x = sbx;
              y = sby;
              st.length = 0;
              break;
            case 12: {
              // div
              const d = st.pop()!;
              const n = st.pop()!;
              st.push(n / d);
              break;
            }
            case 16: {
              // callothersubr: arg1 … argn n othersubr#
              const which = st.pop()!;
              const n = st.pop()!;
              const args = st.splice(st.length - n, n);
              if (which === 1) flex = [];
              else if (which === 2) {
                /* rmoveto で点を集めている */
              } else if (which === 0 && flex) {
                // 7 つの点: 基準の点と、2 本の曲線の制御点・終点 (T1 §8.3)
                const p = flex;
                flex = undefined;
                if (p.length >= 7) {
                  if (!open) {
                    segs.push({ op: 'M', x, y });
                    open = true;
                  }
                  segs.push({ op: 'C', x1: p[1][0], y1: p[1][1], x2: p[2][0], y2: p[2][1], x: p[3][0], y: p[3][1] });
                  segs.push({ op: 'C', x1: p[4][0], y1: p[4][1], x2: p[5][0], y2: p[5][1], x: p[6][0], y: p[6][1] });
                }
                // 終わりの点 (絶対の座標) を返す: pop pop setcurrentpoint
                ps.push(args[2], args[1]);
                break;
              } else if (which === 3) {
                // 字形の切り替え: 新しいヒントの Subrs の番号をそのまま返す (T1 §8.1)
                ps.push(args[0]);
                break;
              }
              // それ以外: 引数をそのまま返す
              for (const a of args) ps.push(a);
              break;
            }
            case 17: // pop
              st.push(ps.length ? ps.pop()! : 0);
              break;
            case 33: // setcurrentpoint
              x = st[0];
              y = st[1];
              st.length = 0;
              break;
            default:
              st.length = 0;
          }
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
  void sby;
  return { segs, wx, wy };
}

// ───────────────────────── CMap (PLRM §5.11.4) ─────────────────────────

export interface CMapData {
  /** 符号の範囲 (バイト数ごと) */
  space: Array<{ lo: number[]; hi: number[] }>;
  /** 範囲の対応: 符号 lo〜hi (同じバイト数) → cid + (符号 − lo) */
  ranges: Array<{ n: number; lo: number; hi: number; cid: number }>;
  /** 1 字の対応 */
  chars: Map<string, number>;
  wmode: number;
}

export function newCMap(): CMapData {
  return { space: [], ranges: [], chars: new Map(), wmode: 0 };
}

/** Identity-H・Identity-V (2 バイトの符号をそのまま CID にする) */
export function identityCMap(wmode = 0): CMapData {
  return { space: [{ lo: [0, 0], hi: [255, 255] }], ranges: [{ n: 2, lo: 0, hi: 0xffff, cid: 0 }], chars: new Map(), wmode };
}

/** 文字列を符号に区切り、CID にする (符号の範囲に合う一番短いバイト数で区切る) */
export function decodeCMap(cm: CMapData, b: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < b.length) {
    let n = 0;
    for (let len = 1; len <= 4 && !n; len++) {
      if (i + len > b.length) break;
      for (const r of cm.space) {
        if (r.lo.length !== len) continue;
        let ok = true;
        for (let k = 0; k < len && ok; k++) ok = b[i + k] >= r.lo[k] && b[i + k] <= r.hi[k];
        if (ok) {
          n = len;
          break;
        }
      }
    }
    // 範囲に当たらないとき: 最初の codespacerange の長さ (空なら 1 バイト) で進む。0 だと止まらなくなる
    if (!n) n = Math.max(1, Math.min(cm.space[0]?.lo.length || 1, b.length - i));
    let code = 0;
    for (let k = 0; k < n; k++) code = code * 256 + b[i + k];
    const key = `${n}:${code}`;
    let cid = cm.chars.get(key);
    if (cid === undefined) {
      for (const r of cm.ranges)
        if (r.n === n && code >= r.lo && code <= r.hi) {
          cid = r.cid + code - r.lo;
          break;
        }
    }
    out.push(cid ?? 0);
    i += n;
  }
  return out;
}
