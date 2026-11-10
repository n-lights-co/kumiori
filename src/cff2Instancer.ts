/**
 * cff2Instancer — 可変の CFF ('CFF2' の表) の、軸の値を決めた実体を、静的な CFF (版 1。'CFF ' の表) に作り直す。
 *
 * PDF に埋め込める CFF は版 1 だけ (ISO 32000-2 §9.9 の表 126 の FontFile3: Type1C・CIDFontType0C・OpenType。CFF2 は無い)。
 * そこで、字形 (CharString) の差分 (blend) を、決めた軸の値で計算し、Type 2 の CharString に書き直す。
 *
 * 根拠は OpenType の仕様の「CFF2 — Compact Font Format (CFF) Version 2」(https://learn.microsoft.com/typography/opentype/spec/cff2。
 * CharString の章を含む。以下「CFF2」と節の名前で指す) と、Adobe Technical Note #5176 (CFF)・#5177 (Type 2 Charstring Format)。
 *
 *  - 読む: Header・TopDICT・GlobalSubrINDEX・CharStringINDEX・FontDICTINDEX・FontDICTSelect・PrivateDICT・LocalSubrINDEX・VariationStore
 *  - 字形: 部品 (callsubr・callgsubr) を開き、blend・vsindex を計算して、経路の演算子を絶対の座標に直す。座標は整数に丸める
 *    (TrueType の輪郭の実体と同じ。0.5 は上へ)。曲線は 3 次のまま (rrcurveto とその短い形) で書く。flex は 2 つの曲線にする
 *  - ヒント (hstem・vstem・hstemhm・vstemhm・hintmask・cntrmask) は書かない: 差分を当てた後のステムは、並びの順が入れ替わったり
 *    重なったりしうる (CFF2「Blended stem and edge hints」) が、Type 2 の CharString ではステムを位置の順に書く決まりなので、
 *    そのまま写すと壊れた字形になりうる。字の形 (輪郭) は変わらない。小さな字を画面に描くときの、画素への合わせ込みだけが無くなる
 *  - CFF2 の字形は幅を持たない (hmtx・HVAR にある) ので、実体の送りを、Type 2 の CharString の幅として入れる (#5177 §3.1・#5176 の
 *    defaultWidthX・nominalWidthX)
 *  - 書き出す CFF は CID 方式 (ROS は Adobe-Identity-0、CID = 字の番号)。CFF2 の FontDICT・FontDICTSelect が、そのまま CID 方式の
 *    FDArray・FDSelect になる (CFF2 は字の名前を持たないので、名前の方式にはしない)
 *  - PrivateDICT のヒントの値 (BlueValues・StdHW など) は、blend を計算した値を書く
 *
 * 輪郭の重なり: CFF2 の字形は輪郭が重なってよく、非ゼロの規則で塗る (CFF2「Path direction」)。重なりは取り除かない。
 * PDF の表示ソフト・ブラウザは、CFF の字形も非ゼロの規則で塗る (PDF の字は、文字を塗る演算子が非ゼロの規則で塗る。ISO 32000-2 §9.3.6・§8.5.3.3)。
 */

const MAX_STACK = 513; // CFF2「Stack-based CFF2 decoding」: 積める数は 513 まで
const MAX_SUBR_DEPTH = 10; // CFF2「Subroutines」: 部品の入れ子は 10 段まで

/** 仕様の丸め (0.5 は上へ) */
const otRound = (v: number) => Math.floor(v + 0.5);

interface Index2 {
  /** 項目 k の始まりは offsets[k]、終わりは offsets[k + 1] (表の中の位置) */
  offsets: Uint32Array;
  count: number;
  end: number;
}

/** CFF2 の INDEX (count は uint32。CFF2「INDEX data」) */
function readIndex2(b: Uint8Array, at: number): Index2 {
  if (at + 4 > b.length) throw new Error('CFF2: INDEX is truncated');
  const count = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  if (count === 0) return { offsets: new Uint32Array(1), count: 0, end: at + 4 };
  const offSize = b[at + 4];
  if (offSize < 1 || offSize > 4) throw new Error('CFF2: bad INDEX offset size');
  const offAt = at + 5;
  if (offAt + (count + 1) * offSize > b.length) throw new Error('CFF2: INDEX is truncated');
  const base = offAt + (count + 1) * offSize - 1;
  const offsets = new Uint32Array(count + 1);
  let prev = 0;
  for (let k = 0; k <= count; k++) {
    let x = 0;
    for (let q = 0; q < offSize; q++) x = x * 256 + b[offAt + k * offSize + q];
    if (x < prev || base + x > b.length) throw new Error('CFF2: bad INDEX offsets');
    prev = x;
    offsets[k] = base + x;
  }
  return { offsets, count, end: offsets[count] };
}

/**
 * CFF2 の DICT を読む (CFF2「DICT data」・「Encoded numbers」)。演算子 (12 x は 1200 + x) → 数の並び。
 * blend (PrivateDICT の演算子 23) は、blend で計算する (無ければ、積んだ数を捨てる: vsindex だけを先に読むとき)
 */
function readDict2(b: Uint8Array, start: number, end: number, blend?: (stack: number[]) => void): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let stack: number[] = [];
  let p = start;
  while (p < end) {
    const b0 = b[p];
    if (b0 === 28) {
      stack.push((((b[p + 1] << 8) | b[p + 2]) << 16) >> 16);
      p += 3;
    } else if (b0 === 29) {
      stack.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]);
      p += 5;
    } else if (b0 === 30) {
      // 実数 (2 進化 10 進。4 ビットずつ、0xf で終わる)
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
      stack.push(parseFloat(s));
    } else if (b0 >= 32 && b0 <= 246) {
      stack.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      stack.push((b0 - 247) * 256 + b[p + 1] + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      stack.push(-(b0 - 251) * 256 - b[p + 1] - 108);
      p += 2;
    } else if (b0 <= 27) {
      let op = b0;
      p++;
      if (b0 === 12) op = 1200 + b[p++];
      if (op === 23) {
        // blend は、鍵と値の組を作らない (数を置き換えるだけ)
        if (blend) blend(stack);
        else stack = [];
        continue;
      }
      out.set(op, stack);
      stack = [];
    } else throw new Error(`CFF2: bad DICT byte ${b0}`);
    if (stack.length > MAX_STACK) throw new Error('CFF2: DICT stack overflow');
  }
  return out;
}

/** blend (CFF2「blend」): 積んだ数の上から n、その下の n × k 個の差分、その下の n 個の既定の値。n 個の計算した値に置き換える */
function blendStack(stack: number[], scalars: ArrayLike<number> | undefined) {
  if (!scalars) throw new Error('CFF2: blend without a variation store');
  const k = scalars.length;
  const n = stack.pop();
  if (n === undefined || !Number.isInteger(n) || n < 0 || stack.length < n * (k + 1)) throw new Error('CFF2: blend operands are missing');
  const base = stack.length - n * (k + 1);
  for (let i = 0; i < n; i++) {
    let v = stack[base + i];
    const d = base + n + i * k;
    for (let r = 0; r < k; r++) if (scalars[r]) v += scalars[r] * stack[d + r];
    stack[base + i] = v;
  }
  stack.length = base + n;
}

/** 字形の区分 (経路の種類) */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;

/** 伸びるバイト列 */
class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(need: number) {
    if (this.len + need <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + need));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(b: number) {
    this.grow(1);
    this.buf[this.len++] = b;
  }
  /** Type 2 の CharString の整数 (#5177 §3.2) */
  int(v: number) {
    this.grow(3);
    const b = this.buf;
    if (v >= -107 && v <= 107) b[this.len++] = v + 139;
    else if (v >= 108 && v <= 1131) {
      v -= 108;
      b[this.len++] = 247 + (v >> 8);
      b[this.len++] = v & 0xff;
    } else if (v >= -1131 && v <= -108) {
      v = -v - 108;
      b[this.len++] = 251 + (v >> 8);
      b[this.len++] = v & 0xff;
    } else {
      if (v < -32768 || v > 32767) throw new Error('CFF2: coordinate out of range');
      b[this.len++] = 28;
      b[this.len++] = (v >> 8) & 0xff;
      b[this.len++] = v & 0xff;
    }
  }
}

/** Type 2 の CharString で、1 つの演算子に渡せる数 (#5177 付録 B: 積める数は 48 まで) */
const T2_ARGS = 48;

/**
 * 字形を解く器。1 つの字形を run で解いて、区分 (kinds) と、丸めた絶対の座標 (xy) に直す
 */
class Interpreter {
  private stack = new Float64Array(MAX_STACK + 1);
  private sp = 0;
  private stems = 0;
  private x = 0;
  private y = 0;
  private scalars: Float64Array | undefined;
  private vsSet = false;
  kinds = new Uint8Array(256);
  /** 区分ごとの点 (MOVE・LINE は 1 点、CURVE は 3 点) の、丸めた座標 */
  xy = new Int32Array(1024);
  nKinds = 0;
  nXy = 0;
  private localOffsets: Uint32Array = new Uint32Array(1);
  private localCount = 0;

  constructor(
    private b: Uint8Array,
    private gsubrs: Index2,
    private scalarsOf: (vsindex: number) => Float64Array | undefined,
  ) {}

  run(start: number, end: number, local: Index2 | undefined, vsindex: number) {
    this.sp = 0;
    this.stems = 0;
    this.x = 0;
    this.y = 0;
    this.nKinds = 0;
    this.nXy = 0;
    this.vsSet = false;
    this.scalars = this.scalarsOf(vsindex);
    this.localOffsets = local ? local.offsets : new Uint32Array(1);
    this.localCount = local ? local.count : 0;
    this.exec(start, end, 0);
  }

  private seg(kind: number) {
    if (this.nKinds === this.kinds.length) {
      const k = new Uint8Array(this.kinds.length * 2);
      k.set(this.kinds);
      this.kinds = k;
    }
    this.kinds[this.nKinds++] = kind;
    if (this.nXy + 6 > this.xy.length) {
      const c = new Int32Array(this.xy.length * 2);
      c.set(this.xy);
      this.xy = c;
    }
  }
  private pt(x: number, y: number) {
    this.xy[this.nXy++] = otRound(x);
    this.xy[this.nXy++] = otRound(y);
  }
  private moveTo(dx: number, dy: number) {
    this.seg(MOVE);
    this.pt((this.x += dx), (this.y += dy));
  }
  private lineTo(dx: number, dy: number) {
    this.seg(LINE);
    this.pt((this.x += dx), (this.y += dy));
  }
  /** 3 次の曲線: 制御点 2 つと終点 (どれも、前の点からの相対) */
  private curveTo(dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number) {
    this.seg(CURVE);
    const x1 = this.x + dxa;
    const y1 = this.y + dya;
    const x2 = x1 + dxb;
    const y2 = y1 + dyb;
    this.pt(x1, y1);
    this.pt(x2, y2);
    this.pt((this.x = x2 + dxc), (this.y = y2 + dyc));
  }

  private exec(start: number, end: number, depth: number) {
    const b = this.b;
    const st = this.stack;
    // 積んだ数の個数は、この関数の中では手元の変数で持つ (部品を呼ぶ前と、戻るときに this.sp と合わせる)
    let sp = this.sp;
    let p = start;
    while (p < end) {
      const b0 = b[p++];
      if (b0 >= 32 || b0 === 28) {
        // 数 (CFF2「Encoded numbers」)
        let v: number;
        if (b0 === 28) {
          v = (((b[p] << 8) | b[p + 1]) << 16) >> 16;
          p += 2;
        } else if (b0 <= 246) v = b0 - 139;
        else if (b0 <= 250) v = (b0 - 247) * 256 + b[p++] + 108;
        else if (b0 <= 254) v = -(b0 - 251) * 256 - b[p++] - 108;
        else {
          v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) / 65536;
          p += 4;
        }
        if (sp >= MAX_STACK) throw new Error('CFF2: CharString stack overflow');
        st[sp++] = v;
        continue;
      }
      switch (b0) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          this.stems += sp >> 1;
          sp = 0;
          break;
        case 19: // hintmask
        case 20: // cntrmask
          // 直前の数は、書かれていない vstemhm (CFF2「Implied vertical stem operators」)。旗は、ステムの数だけのビット
          this.stems += sp >> 1;
          sp = 0;
          p += (this.stems + 7) >> 3;
          break;
        case 21: // rmoveto
          if (sp < 2) throw new Error('CFF2: rmoveto operands are missing');
          this.moveTo(st[sp - 2], st[sp - 1]);
          sp = 0;
          break;
        case 22: // hmoveto
          if (sp < 1) throw new Error('CFF2: hmoveto operands are missing');
          this.moveTo(st[sp - 1], 0);
          sp = 0;
          break;
        case 4: // vmoveto
          if (sp < 1) throw new Error('CFF2: vmoveto operands are missing');
          this.moveTo(0, st[sp - 1]);
          sp = 0;
          break;
        case 5: // rlineto
          for (let i = 0; i + 1 < sp; i += 2) this.lineTo(st[i], st[i + 1]);
          sp = 0;
          break;
        case 6: // hlineto
        case 7: {
          // vlineto: 横と縦を交互に
          let horizontal = b0 === 6;
          for (let i = 0; i < sp; i++) {
            if (horizontal) this.lineTo(st[i], 0);
            else this.lineTo(0, st[i]);
            horizontal = !horizontal;
          }
          sp = 0;
          break;
        }
        case 8: // rrcurveto
          for (let i = 0; i + 5 < sp; i += 6) this.curveTo(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]);
          sp = 0;
          break;
        case 24: {
          // rcurveline: 曲線の並びと、最後に線 1 本
          let i = 0;
          for (; i + 7 < sp; i += 6) this.curveTo(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]);
          if (i + 1 < sp) this.lineTo(st[i], st[i + 1]);
          sp = 0;
          break;
        }
        case 25: {
          // rlinecurve: 線の並びと、最後に曲線 1 本
          let i = 0;
          for (; i + 7 < sp; i += 2) this.lineTo(st[i], st[i + 1]);
          if (i + 5 < sp) this.curveTo(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]);
          sp = 0;
          break;
        }
        case 27: {
          // hhcurveto: [dya?] {dxa dxb dyb dxc}+
          let i = 0;
          let dy = 0;
          if (sp & 1) dy = st[i++];
          for (; i + 3 < sp; i += 4) {
            this.curveTo(st[i], dy, st[i + 1], st[i + 2], st[i + 3], 0);
            dy = 0;
          }
          sp = 0;
          break;
        }
        case 26: {
          // vvcurveto: [dxa?] {dya dxb dyb dyc}+
          let i = 0;
          let dx = 0;
          if (sp & 1) dx = st[i++];
          for (; i + 3 < sp; i += 4) {
            this.curveTo(dx, st[i], st[i + 1], st[i + 2], 0, st[i + 3]);
            dx = 0;
          }
          sp = 0;
          break;
        }
        case 31: // hvcurveto
        case 30: {
          // vhcurveto: 始まりと終わりの接線が、横と縦を交互に。数が 4 の倍数 + 1 なら、最後の曲線の終わりの接線に、残りの 1 つを使う
          let horizontal = b0 === 31;
          for (let i = 0; i + 3 < sp; i += 4) {
            const last = sp - i === 5 ? st[i + 4] : 0;
            if (horizontal) this.curveTo(st[i], 0, st[i + 1], st[i + 2], last, st[i + 3]);
            else this.curveTo(0, st[i], st[i + 1], st[i + 2], st[i + 3], last);
            horizontal = !horizontal;
          }
          sp = 0;
          break;
        }
        case 12: {
          const b1 = b[p++];
          if (b1 === 35 && sp >= 12) {
            // flex: 2 つの曲線 (最後の数は、直線にする深さの閾。ヒントの仕組みなので使わない)
            this.curveTo(st[0], st[1], st[2], st[3], st[4], st[5]);
            this.curveTo(st[6], st[7], st[8], st[9], st[10], st[11]);
          } else if (b1 === 34 && sp >= 7) {
            // hflex: 始点・終点と両端の制御点が同じ y、つなぎ目と隣の制御点が同じ y
            const y0 = this.y;
            this.curveTo(st[0], 0, st[1], st[2], st[3], 0);
            this.curveTo(st[4], 0, st[5], y0 - this.y, st[6], 0);
          } else if (b1 === 36 && sp >= 9) {
            // hflex1: 始点と終点が同じ y、つなぎ目と隣の制御点が同じ y
            const y0 = this.y;
            this.curveTo(st[0], st[1], st[2], st[3], st[4], 0);
            this.curveTo(st[5], 0, st[6], st[7], st[8], y0 - (this.y + st[7]));
          } else if (b1 === 37 && sp >= 11) {
            // flex1: 最後の数は、5 点目までの動きが横に長ければ dx、そうでなければ dy。もう片方は、始点に戻る
            const x0 = this.x;
            const y0 = this.y;
            const dx = st[0] + st[2] + st[4] + st[6] + st[8];
            const dy = st[1] + st[3] + st[5] + st[7] + st[9];
            this.curveTo(st[0], st[1], st[2], st[3], st[4], st[5]);
            if (Math.abs(dx) > Math.abs(dy)) this.curveTo(st[6], st[7], st[8], st[9], st[10], y0 - (this.y + st[7] + st[9]));
            else this.curveTo(st[6], st[7], st[8], st[9], x0 - (this.x + st[6] + st[8]), st[10]);
          }
          // ほかの 12 x は、CFF2 に無い演算子: 読み飛ばして、積んだ数を捨てる (CFF2「Stack-based CFF2 decoding」)
          sp = 0;
          break;
        }
        case 10: // callsubr
        case 29: {
          // callgsubr: 番号に偏り (bias) を足す (CFF2「Calling subroutines and subroutine bias」)。積んだ数は、そのまま引き継ぐ
          if (sp < 1) throw new Error('CFF2: subroutine number is missing');
          if (depth >= MAX_SUBR_DEPTH) throw new Error('CFF2: subroutines are nested too deeply');
          const count = b0 === 10 ? this.localCount : this.gsubrs.count;
          const offsets = b0 === 10 ? this.localOffsets : this.gsubrs.offsets;
          const bias = count < 1240 ? 107 : count < 33900 ? 1131 : 32768;
          const k = st[sp - 1] + bias;
          if (!Number.isInteger(k) || k < 0 || k >= count) throw new Error('CFF2: bad subroutine number');
          this.sp = sp - 1;
          this.exec(offsets[k], offsets[k + 1], depth + 1);
          sp = this.sp;
          break;
        }
        case 15: // vsindex: 差分の組を選ぶ。字形に 1 度だけ、最初の blend より前 (CFF2「vsindex」)
          if (sp < 1 || this.vsSet) throw new Error('CFF2: bad vsindex');
          this.vsSet = true;
          this.scalars = this.scalarsOf(st[sp - 1]);
          if (!this.scalars) throw new Error('CFF2: bad vsindex');
          sp = 0;
          break;
        case 16: {
          // blend (CFF2「blend」): 上から n、n × k 個の差分、n 個の既定の値
          const sc = this.scalars;
          if (!sc) throw new Error('CFF2: blend without a variation store');
          const k = sc.length;
          const n = sp > 0 ? st[sp - 1] : -1;
          if (!Number.isInteger(n) || n < 0 || sp - 1 < n * (k + 1)) throw new Error('CFF2: blend operands are missing');
          const base = sp - 1 - n * (k + 1);
          for (let i = 0; i < n; i++) {
            let v = st[base + i];
            const d = base + n + i * k;
            for (let r = 0; r < k; r++) if (sc[r]) v += sc[r] * st[d + r];
            st[base + i] = v;
          }
          sp = base + n;
          this.vsSet = true;
          break;
        }
        default:
          // CFF2 に無い演算子は、読み飛ばして、積んだ数を捨てる
          sp = 0;
      }
    }
    this.sp = sp;
  }
}

/** 3 次の曲線の、1 つの座標の極値を、範囲 [lo, hi] に入れる (制御点が端の点の間にあれば、極値は端の点) */
function cubicExtent(p0: number, p1: number, p2: number, p3: number, range: Float64Array, at: number) {
  const lo = Math.min(p0, p3);
  const hi = Math.max(p0, p3);
  if (lo < range[at]) range[at] = lo;
  if (hi > range[at + 1]) range[at + 1] = hi;
  if (p1 >= lo && p1 <= hi && p2 >= lo && p2 <= hi) return;
  // 導関数 3(a t² + b t + c) の根
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const bb = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const at_ = (t: number) => {
    if (t <= 0 || t >= 1) return;
    const u = 1 - t;
    const v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    if (v < range[at]) range[at] = v;
    if (v > range[at + 1]) range[at + 1] = v;
  };
  if (Math.abs(a) < 1e-12) {
    if (bb !== 0) at_(-c / bb);
    return;
  }
  const disc = bb * bb - 4 * a * c;
  if (disc < 0) return;
  const s = Math.sqrt(disc);
  at_((-bb + s) / (2 * a));
  at_((-bb - s) / (2 * a));
}

/**
 * 解いた字形 (区分と絶対の座標) を、Type 2 の CharString に書く (#5177 §4.1 の経路の演算子)。width が undefined でなければ、最初に幅を書く。
 * 線は rlineto (横と縦が交互に続くところは hlineto・vlineto)、曲線は rrcurveto (接線が横・縦のところは hvcurveto・vhcurveto・hhcurveto・vvcurveto)。
 * 最後に endchar。box に、字形の外接の箱 [xMin, xMax, yMin, yMax] を入れる (点が無ければ、そのまま)
 */
function writeCharString(out: Bytes, it: Interpreter, width: number | undefined, box: Float64Array) {
  const kinds = it.kinds;
  const xy = it.xy;
  const n = it.nKinds;
  if (width !== undefined) out.int(width);
  if (n && kinds[0] !== MOVE) {
    // 輪郭は moveto で始める決まり (CFF2「CharString organization」)。無ければ、原点から始める (幅の後の最初の演算子を moveto にする)
    out.int(0);
    out.push(22);
  }
  let cx = 0;
  let cy = 0;
  let q = 0; // xy の中の位置
  let i = 0;
  while (i < n) {
    const kind = kinds[i];
    if (kind === MOVE) {
      const dx = xy[q] - cx;
      const dy = xy[q + 1] - cy;
      // 幅の後の最初の moveto は、数が 1 つ多い。hmoveto・vmoveto でも同じ (#5177 §4.1)
      if (dy === 0) {
        out.int(dx);
        out.push(22);
      } else if (dx === 0) {
        out.int(dy);
        out.push(4);
      } else {
        out.int(dx);
        out.int(dy);
        out.push(21);
      }
      cx = xy[q];
      cy = xy[q + 1];
      if (cx < box[0]) box[0] = cx;
      if (cx > box[1]) box[1] = cx;
      if (cy < box[2]) box[2] = cy;
      if (cy > box[3]) box[3] = cy;
      q += 2;
      i++;
      continue;
    }
    // 同じ種類の区分の並び
    let j = i;
    while (j < n && kinds[j] === kind) j++;
    if (kind === LINE) {
      while (i < j) {
        const dx = xy[q] - cx;
        const dy = xy[q + 1] - cy;
        if (dx === 0 || dy === 0) {
          // 横と縦が交互に続くところ: hlineto・vlineto (長さ 0 の線は、横の線として書く)
          let horizontal = dy === 0;
          const first = horizontal;
          let count = 0;
          while (i < j && count < T2_ARGS) {
            const ddx = xy[q] - cx;
            const ddy = xy[q + 1] - cy;
            if (horizontal ? ddy !== 0 : ddx !== 0) break;
            out.int(horizontal ? ddx : ddy);
            cx = xy[q];
            cy = xy[q + 1];
            if (cx < box[0]) box[0] = cx;
            if (cx > box[1]) box[1] = cx;
            if (cy < box[2]) box[2] = cy;
            if (cy > box[3]) box[3] = cy;
            q += 2;
            i++;
            count++;
            horizontal = !horizontal;
          }
          out.push(first ? 6 : 7);
        } else {
          let count = 0;
          while (i < j && count < T2_ARGS / 2) {
            const ddx = xy[q] - cx;
            const ddy = xy[q + 1] - cy;
            if (count && (ddx === 0 || ddy === 0)) break;
            out.int(ddx);
            out.int(ddy);
            cx = xy[q];
            cy = xy[q + 1];
            if (cx < box[0]) box[0] = cx;
            if (cx > box[1]) box[1] = cx;
            if (cy < box[2]) box[2] = cy;
            if (cy > box[3]) box[3] = cy;
            q += 2;
            i++;
            count++;
          }
          out.push(5);
        }
      }
      continue;
    }
    // 曲線の並び
    while (i < j) {
      // 1 本ずつ、相対の値 (dxa dya dxb dyb dxc dyc) と、接線の向き
      const startI = i;
      const startQ = q;
      // この位置から続けられる数を、形ごとに数える
      const rel = (r: number, px: number, py: number, o: number[]) => {
        o[0] = xy[r] - px;
        o[1] = xy[r + 1] - py;
        o[2] = xy[r + 2] - xy[r];
        o[3] = xy[r + 3] - xy[r + 1];
        o[4] = xy[r + 4] - xy[r + 2];
        o[5] = xy[r + 5] - xy[r + 3];
      };
      const d = REL;
      rel(q, cx, cy, d);
      // 形: 0 = hv (横で始まり縦で終わる)、1 = vh、2 = hh、3 = vv、4 = そのほか
      const shapeOf = (o: number[]) => (o[1] === 0 && o[4] === 0 ? 0 : o[0] === 0 && o[5] === 0 ? 1 : o[1] === 0 && o[5] === 0 ? 2 : o[0] === 0 && o[4] === 0 ? 3 : 4);
      const shape = shapeOf(d);
      let count = 0;
      let px = cx;
      let py = cy;
      let r = q;
      if (shape === 0 || shape === 1) {
        // hvcurveto・vhcurveto: 横で始まる曲線と縦で始まる曲線が交互
        let horizontal = shape === 0;
        while (i + count < j && count < T2_ARGS / 4) {
          rel(r, px, py, d);
          if (horizontal ? !(d[1] === 0 && d[4] === 0) : !(d[0] === 0 && d[5] === 0)) break;
          if (horizontal) {
            out.int(d[0]);
            out.int(d[2]);
            out.int(d[3]);
            out.int(d[5]);
          } else {
            out.int(d[1]);
            out.int(d[2]);
            out.int(d[3]);
            out.int(d[4]);
          }
          px = xy[r + 4];
          py = xy[r + 5];
          r += 6;
          count++;
          horizontal = !horizontal;
        }
        out.push(shape === 0 ? 31 : 30);
      } else if (shape === 2 || shape === 3) {
        // hhcurveto・vvcurveto
        while (i + count < j && count < T2_ARGS / 4) {
          rel(r, px, py, d);
          if (shape === 2 ? !(d[1] === 0 && d[5] === 0) : !(d[0] === 0 && d[4] === 0)) break;
          if (shape === 2) {
            out.int(d[0]);
            out.int(d[2]);
            out.int(d[3]);
            out.int(d[4]);
          } else {
            out.int(d[1]);
            out.int(d[2]);
            out.int(d[3]);
            out.int(d[5]);
          }
          px = xy[r + 4];
          py = xy[r + 5];
          r += 6;
          count++;
        }
        out.push(shape === 2 ? 27 : 26);
      } else {
        while (i + count < j && count < T2_ARGS / 6) {
          rel(r, px, py, d);
          if (count && shapeOf(d) !== 4) break;
          for (let k = 0; k < 6; k++) out.int(d[k]);
          px = xy[r + 4];
          py = xy[r + 5];
          r += 6;
          count++;
        }
        out.push(8);
      }
      // 箱
      let bx = cx;
      let by = cy;
      for (let s = startQ; s < r; s += 6) {
        cubicExtent(bx, xy[s], xy[s + 2], xy[s + 4], box, 0);
        cubicExtent(by, xy[s + 1], xy[s + 3], xy[s + 5], box, 2);
        bx = xy[s + 4];
        by = xy[s + 5];
      }
      i = startI + count;
      q = r;
      cx = px;
      cy = py;
    }
  }
  out.push(14); // endchar
}
const REL = [0, 0, 0, 0, 0, 0];

/** CFF (版 1) の INDEX (#5176 §5) */
function writeIndex1(count: number, data: Uint8Array, offsets: ArrayLike<number>): Uint8Array {
  if (!count) return new Uint8Array([0, 0]);
  const total = data.length + 1;
  const offSize = total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
  const out = new Uint8Array(3 + (count + 1) * offSize + data.length);
  out[0] = count >> 8;
  out[1] = count & 0xff;
  out[2] = offSize;
  let p = 3;
  for (let k = 0; k <= count; k++) {
    const x = offsets[k] + 1;
    for (let s = offSize - 1; s >= 0; s--) out[p++] = (x >>> (8 * s)) & 0xff;
  }
  out.set(data, p);
  return out;
}
const indexOf = (items: Uint8Array[]): Uint8Array => {
  const offsets = [0];
  for (const it of items) offsets.push(offsets[offsets.length - 1] + it.length);
  const data = new Uint8Array(offsets[offsets.length - 1]);
  items.forEach((it, k) => data.set(it, offsets[k]));
  return writeIndex1(items.length, data, offsets);
};

/** DICT の数 (#5176 §4 の表 3)。整数は短い形、ほかは実数 (2 進化 10 進) */
function dictNumber(out: number[], v: number) {
  if (Number.isInteger(v)) {
    if (v >= -107 && v <= 107) out.push(v + 139);
    else if (v >= 108 && v <= 1131) out.push(247 + ((v - 108) >> 8), (v - 108) & 0xff);
    else if (v >= -1131 && v <= -108) out.push(251 + ((-v - 108) >> 8), (-v - 108) & 0xff);
    else if (v >= -32768 && v <= 32767) out.push(28, (v >> 8) & 0xff, v & 0xff);
    else out.push(29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return;
  }
  const s = String(+v.toPrecision(12));
  const nib: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') nib.push(0xa);
    else if (c === '-') nib.push(0xe);
    else if (c === 'e') {
      if (s[i + 1] === '-') {
        nib.push(0xc);
        i++;
      } else {
        nib.push(0xb);
        if (s[i + 1] === '+') i++;
      }
    } else nib.push(c.charCodeAt(0) - 48);
  }
  nib.push(0xf);
  if (nib.length & 1) nib.push(0xf);
  out.push(30);
  for (let i = 0; i < nib.length; i += 2) out.push((nib[i] << 4) | nib[i + 1]);
}
/** 位置を書く、長さの決まる整数 (4 バイト) */
const dictOffset = (out: number[], v: number) => out.push(29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
const dictOp = (out: number[], op: number) => (op >= 1200 ? out.push(12, op - 1200) : out.push(op));

/** PrivateDICT の、差の並び (deltaArray) で書く演算子: BlueValues・OtherBlues・FamilyBlues・FamilyOtherBlues・StemSnapH・StemSnapV */
const DELTA_ARRAYS = [6, 7, 8, 9, 1212, 1213];
/** PrivateDICT の、1 つの数の演算子: StdHW・StdVW (差分を当てた値は整数に丸める)、BlueScale・BlueShift・BlueFuzz・LanguageGroup・ExpansionFactor (そのまま) */
const SINGLE_ROUNDED = [10, 11];
const SINGLE_AS_IS = [1209, 1210, 1211, 1217, 1218];

export interface Cff2Instance {
  /** 静的な CFF (版 1。CID 方式) の表 */
  cff: Uint8Array;
  /** 字形ごとの外接の箱 [xMin, yMin, xMax, yMax] (4 つずつ)。輪郭の無い字形は 0 */
  boxes: Int32Array;
  /** 輪郭のある字形か */
  hasOutline: Uint8Array;
}

/**
 * 'CFF2' の表 cff2 の実体を、静的な CFF (版 1) の表にする。
 *  - makeScalars: CFF2 の中の Item Variation Store (表の中の位置と長さ) から、差分の組 (vsindex) ごとの領域の重みを返す関数を作る
 *    (重みの計算は fontInstancer.ts。Font Variations の概説の「Algorithm for interpolation of instance values」)
 *  - advances: 字形ごとの、実体の横の送り (hmtx に HVAR の差分を当てた値)。CharString の幅にする
 *  - psName: 書体の PostScript 名 (CFF の Name INDEX)
 *  - unitsPerEm: head の値 (TopDICT に FontMatrix が無いときの、1000 でない書体の FontMatrix)
 * 読めない表・字形 (CFF2 の決まりに合わないもの) は Error (呼び出し側が、実体を作らずに知らせる)
 */
export function instantiateCff2(
  cff2: Uint8Array,
  makeScalars: (storeAt: number, storeLength: number) => (vsindex: number) => Float64Array | undefined,
  advances: ArrayLike<number>,
  psName: string,
  unitsPerEm: number,
): Cff2Instance {
  const b = cff2;
  if (b.length < 5 || b[0] !== 2) throw new Error('CFF2: not a version 2 table');
  const headerSize = b[2];
  const topSize = (b[3] << 8) | b[4];
  if (headerSize + topSize > b.length) throw new Error('CFF2: TopDICT is truncated');
  const top = readDict2(b, headerSize, headerSize + topSize);
  const gsubrs = readIndex2(b, headerSize + topSize);
  const csAt = top.get(17)?.[0];
  const fdAt = top.get(1236)?.[0];
  if (csAt === undefined || fdAt === undefined) throw new Error('CFF2: CharStringINDEX or FontDICTINDEX is missing');
  const charStrings = readIndex2(b, csAt);
  const nGlyphs = charStrings.count;
  if (nGlyphs < 1 || nGlyphs > 65535 || advances.length < nGlyphs) throw new Error('CFF2: bad glyph count');
  // 差分の組ごとの領域の重み (VariationStore: uint16 の長さ + Item Variation Store。CFF2「VariationStore」)
  const vsAt = top.get(24)?.[0];
  let scalarsOf: (vsindex: number) => Float64Array | undefined = () => undefined;
  if (vsAt !== undefined) {
    if (vsAt + 2 > b.length) throw new Error('CFF2: VariationStore is truncated');
    const len = (b[vsAt] << 8) | b[vsAt + 1];
    if (vsAt + 2 + len > b.length) throw new Error('CFF2: VariationStore is truncated');
    scalarsOf = makeScalars(vsAt + 2, len);
  }

  // FontDICT と PrivateDICT (CFF2「FontDICT」・「PrivateDICT」)
  const fdIndex = readIndex2(b, fdAt);
  const nFd = fdIndex.count;
  if (nFd < 1 || nFd > 256) throw new Error('CFF2: unsupported number of FontDICTs'); // CFF (版 1) の FDSelect は、FD の番号が 1 バイト
  interface Fd {
    priv: Map<number, number[]>;
    vsindex: number;
    local: Index2 | undefined;
  }
  const fds: Fd[] = [];
  for (let k = 0; k < nFd; k++) {
    const fd = readDict2(b, fdIndex.offsets[k], fdIndex.offsets[k + 1]);
    const [size, at] = fd.get(18) ?? [0, 0];
    if (at + size > b.length) throw new Error('CFF2: PrivateDICT is truncated');
    // vsindex を先に読む (blend より前に書いてあるとは限らない)。その差分の組で、blend を計算する
    const vsindex = readDict2(b, at, at + size).get(22)?.[0] ?? 0;
    const sc = scalarsOf(vsindex);
    const priv = readDict2(b, at, at + size, (stack) => blendStack(stack, sc));
    const subrsAt = priv.get(19)?.[0];
    fds.push({ priv, vsindex, local: subrsAt !== undefined ? readIndex2(b, at + subrsAt) : undefined });
  }

  // FontDICTSelect (CFF2「FontDICTSelect」の形式 0・3・4)
  const fdOf = new Uint8Array(nGlyphs);
  const selAt = top.get(1237)?.[0];
  if (selAt !== undefined) {
    const fmt = b[selAt];
    if (fmt === 0) {
      if (selAt + 1 + nGlyphs > b.length) throw new Error('CFF2: FontDICTSelect is truncated');
      fdOf.set(b.subarray(selAt + 1, selAt + 1 + nGlyphs));
    } else if (fmt === 3 || fmt === 4) {
      const wide = fmt === 4;
      const rd = (o: number) => (wide ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : (b[o] << 8) | b[o + 1]);
      const rec = wide ? 6 : 3;
      const ranges = rd(selAt + 1);
      const first = selAt + 1 + (wide ? 4 : 2);
      if (first + ranges * rec + (wide ? 4 : 2) > b.length) throw new Error('CFF2: FontDICTSelect is truncated');
      for (let r = 0; r < ranges; r++) {
        const o = first + r * rec;
        const from = rd(o);
        const fd = wide ? (b[o + 4] << 8) | b[o + 5] : b[o + 2];
        const to = Math.min(nGlyphs, rd(o + rec));
        if (fd >= nFd) throw new Error('CFF2: bad FontDICT number');
        for (let g = from; g < to; g++) fdOf[g] = fd;
      }
    } else throw new Error(`CFF2: unsupported FontDICTSelect format ${fmt}`);
    for (let g = 0; g < nGlyphs; g++) if (fdOf[g] >= nFd) throw new Error('CFF2: bad FontDICT number');
  }

  // 幅: FD ごとに、最も多い送りを defaultWidthX (その字形は幅を書かない)、ほかの送りの平均を nominalWidthX (差を書く) にする
  const defaultWidth = new Int32Array(nFd);
  const nominalWidth = new Int32Array(nFd);
  {
    const counts: Array<Map<number, number>> = Array.from({ length: nFd }, () => new Map());
    for (let g = 0; g < nGlyphs; g++) {
      const m = counts[fdOf[g]];
      m.set(advances[g], (m.get(advances[g]) ?? 0) + 1);
    }
    for (let k = 0; k < nFd; k++) {
      let best = 0;
      let bestCount = -1;
      let sum = 0;
      let cnt = 0;
      for (const [w, c] of counts[k]) {
        if (c > bestCount) {
          best = w;
          bestCount = c;
        }
        sum += w * c;
        cnt += c;
      }
      defaultWidth[k] = best;
      const rest = cnt - bestCount;
      nominalWidth[k] = rest > 0 ? otRound((sum - best * bestCount) / rest) : 0;
    }
  }

  // 字形
  const it = new Interpreter(b, gsubrs, scalarsOf);
  const out = new Bytes();
  const csOffsets = new Uint32Array(nGlyphs + 1);
  const boxes = new Int32Array(nGlyphs * 4);
  const hasOutline = new Uint8Array(nGlyphs);
  const box = new Float64Array(4);
  for (let g = 0; g < nGlyphs; g++) {
    const fd = fds[fdOf[g]];
    it.run(charStrings.offsets[g], charStrings.offsets[g + 1], fd.local, fd.vsindex);
    const w = advances[g];
    box[0] = box[2] = Infinity;
    box[1] = box[3] = -Infinity;
    writeCharString(out, it, w === defaultWidth[fdOf[g]] ? undefined : w - nominalWidth[fdOf[g]], box);
    if (box[0] <= box[1]) {
      boxes[g * 4] = Math.floor(box[0]);
      boxes[g * 4 + 1] = Math.floor(box[2]);
      boxes[g * 4 + 2] = Math.ceil(box[1]);
      boxes[g * 4 + 3] = Math.ceil(box[3]);
      hasOutline[g] = 1;
    }
    csOffsets[g + 1] = out.len;
  }
  const charStringsOut = writeIndex1(nGlyphs, out.buf.subarray(0, out.len), csOffsets);

  // Private DICT (版 1): ヒントの値 (blend を計算した値) と、幅の既定の値
  const privs = fds.map((fd, k) => {
    const o: number[] = [];
    for (const op of DELTA_ARRAYS) {
      const v = fd.priv.get(op);
      if (!v?.length) continue;
      // 差の並びを絶対の値にして整数に丸め、差の並びに戻す
      let abs = 0;
      let prev = 0;
      for (const d of v) {
        abs += d;
        const r = otRound(abs);
        dictNumber(o, r - prev);
        prev = r;
      }
      dictOp(o, op);
    }
    for (const op of SINGLE_ROUNDED) {
      const v = fd.priv.get(op);
      if (v?.length !== 1) continue;
      dictNumber(o, Math.max(0, otRound(v[0])));
      dictOp(o, op);
    }
    for (const op of SINGLE_AS_IS) {
      const v = fd.priv.get(op);
      if (v?.length !== 1) continue;
      dictNumber(o, v[0]);
      dictOp(o, op);
    }
    dictNumber(o, defaultWidth[k]);
    dictOp(o, 20);
    dictNumber(o, nominalWidth[k]);
    dictOp(o, 21);
    return new Uint8Array(o);
  });

  // charset (形式 2): CID 1 から続きの番号。FDSelect (形式 3)
  const charset = nGlyphs > 1 ? new Uint8Array([2, 0, 1, ((nGlyphs - 2) >> 8) & 0xff, (nGlyphs - 2) & 0xff]) : new Uint8Array([0]);
  const sel: number[] = [3, 0, 0];
  let ranges = 0;
  for (let g = 0; g < nGlyphs; g++) {
    if (g && fdOf[g] === fdOf[g - 1]) continue;
    sel.push(g >> 8, g & 0xff, fdOf[g]);
    ranges++;
  }
  sel[1] = ranges >> 8;
  sel[2] = ranges & 0xff;
  sel.push(nGlyphs >> 8, nGlyphs & 0xff);
  const fdSelect = new Uint8Array(sel);

  // 書体全体の外接の箱 (FontBBox)
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  let any = false;
  for (let g = 0; g < nGlyphs; g++) {
    if (!hasOutline[g]) continue;
    if (!any || boxes[g * 4] < x0) x0 = boxes[g * 4];
    if (!any || boxes[g * 4 + 1] < y0) y0 = boxes[g * 4 + 1];
    if (!any || boxes[g * 4 + 2] > x1) x1 = boxes[g * 4 + 2];
    if (!any || boxes[g * 4 + 3] > y1) y1 = boxes[g * 4 + 3];
    any = true;
  }

  // 組み立て: Header・Name INDEX・Top DICT INDEX・String INDEX・Global Subr INDEX・charset・FDSelect・CharStrings・FDArray・Private
  const header = new Uint8Array([1, 0, 4, 4]);
  const name = psName.replace(/[^!-~]|[()<>[\]{}/%]/g, '').slice(0, 127) || 'Font';
  const nameIndex = indexOf([Uint8Array.from(name, (c) => c.charCodeAt(0))]);
  // 文字列: 標準の文字列は 391 個 (#5176 付録 A) なので、足した文字列の番号 (SID) は 391 から
  const strings = indexOf(['Adobe', 'Identity'].map((s) => Uint8Array.from(s, (c) => c.charCodeAt(0))));
  const globalSubrs = new Uint8Array([0, 0]);
  const matrix = top.get(1207) ?? (unitsPerEm !== 1000 ? [1 / unitsPerEm, 0, 0, 1 / unitsPerEm, 0, 0] : undefined);
  const topDict = (pos: { charset: number; fdSelect: number; charStrings: number; fdArray: number }): Uint8Array => {
    const o: number[] = [];
    // ROS は最初に書く (#5176 §18)
    dictNumber(o, 391);
    dictNumber(o, 392);
    dictNumber(o, 0);
    dictOp(o, 1230);
    if (matrix?.length === 6) {
      for (const v of matrix) dictNumber(o, v);
      dictOp(o, 1207);
    }
    for (const v of [x0, y0, x1, y1]) dictNumber(o, v);
    dictOp(o, 5);
    dictNumber(o, nGlyphs);
    dictOp(o, 1234); // CIDCount
    dictOffset(o, pos.charset);
    dictOp(o, 15);
    dictOffset(o, pos.fdSelect);
    dictOp(o, 1237);
    dictOffset(o, pos.charStrings);
    dictOp(o, 17);
    dictOffset(o, pos.fdArray);
    dictOp(o, 1236);
    return indexOf([new Uint8Array(o)]);
  };
  const fontDict = (size: number, at: number): Uint8Array => {
    const o: number[] = [];
    dictOffset(o, size);
    dictOffset(o, at);
    dictOp(o, 18);
    return new Uint8Array(o);
  };
  const topLen = topDict({ charset: 0, fdSelect: 0, charStrings: 0, fdArray: 0 }).length;
  let at = header.length + nameIndex.length + topLen + strings.length + globalSubrs.length;
  const pos = { charset: at, fdSelect: 0, charStrings: 0, fdArray: 0 };
  at += charset.length;
  pos.fdSelect = at;
  at += fdSelect.length;
  pos.charStrings = at;
  at += charStringsOut.length;
  pos.fdArray = at;
  at += indexOf(privs.map(() => fontDict(0, 0))).length;
  const privAt: number[] = [];
  for (const p of privs) {
    privAt.push(at);
    at += p.length;
  }
  const parts = [header, nameIndex, topDict(pos), strings, globalSubrs, charset, fdSelect, charStringsOut, indexOf(privs.map((p, k) => fontDict(p.length, privAt[k]))), ...privs];
  const cff = new Uint8Array(at);
  let q = 0;
  for (const part of parts) {
    cff.set(part, q);
    q += part.length;
  }
  if (q !== at) throw new Error('CFF2: instance layout mismatch');
  return { cff, boxes, hasOutline };
}
