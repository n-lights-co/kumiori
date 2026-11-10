/**
 * テストの補助: JPEG (ITU-T T.81) の符号の列を、テストの中で組み立てる。
 *
 * src/jpeg.ts の encodeJpeg は基本の逐次・4:2:0 だけを書くので、復号器 (decodeJpeg) のほかの道
 * (漸進 = SOF2、再開の印 = DRI・RSTn、4:2:2 などの標本化) を試す入力を、ここで作る。
 * 画素から量子化した係数を作り (quantize)、同じ係数を、走査の組み方を変えて書く (writeJpeg)。
 * 係数が同じなら、走査の組み方が違っても、復号した画素は同じになる (漸進の走査は、係数を分けて送るだけ: T.81 G.1)。
 *
 * 手順の出典: A.1.1 (成分の大きさ)・A.2 (区画の順)・A.3.3 (FDCT)・Annex C (符号表)・F.1.2 (逐次の符号化)・
 * G.1.2 (漸進の符号化)・B.2 (印の区切りの並び)・B.2.4.4 と E.1.4 (再開の間隔)。
 */
import { AC_CHROMA, AC_LUMA, DC_CHROMA, DC_LUMA, ZIGZAG, type HuffmanSpec } from '../src/jpegTables';
import type { JpegPixels } from '../src/jpeg';

/** 成分ごとの、量子化した係数 (区画ごとに 64 個、ジグザグ順) */
export interface CoefImage {
  width: number;
  height: number;
  comps: {
    h: number;
    v: number;
    /** 量子化表の番号 (0 輝度・1 色差) */
    tq: number;
    /** 係数の区画の横・縦の数 (MCU の数 × 標本化の係数) */
    bw: number;
    bh: number;
    coef: Int32Array;
  }[];
  /** 量子化の幅 (表の番号ごと。64 個とも同じ値) */
  quant: number[];
  hmax: number;
  vmax: number;
  mcusX: number;
  mcusY: number;
}

/** 1 つの走査: 成分の番号 (0 から) の並び、スペクトルの範囲 (Ss・Se)、逐次近似 (Ah・Al) */
export interface Scan {
  comps: number[];
  ss: number;
  se: number;
  ah: number;
  al: number;
}

export interface WriteOptions {
  /** 漸進 (SOF2) の走査の並び。無ければ基本の逐次 (SOF0) の 1 つの走査 */
  scans?: Scan[];
  /** 再開の間隔 (MCU の数)。0・無しなら再開の印を入れない */
  restart?: number;
  /** 書いた符号の数え (テストの入力が、試したい道を通ったことを確かめるため) */
  stats?: { zrl: number; maxEobRun: number; rst: number; refineBits: number };
}

/** A.3.3 の FDCT の余弦: COS[x * 8 + u] = cos((2x + 1)uπ / 16) */
const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

/**
 * 画素を、成分 (濃淡か、JFIF の YCbCr) の面に分け、標本化の係数 sampling ([H, V] の並び) で間引き (箱の平均)、
 * 区画ごとに FDCT と量子化をする。量子化の幅は quant (輝度・色差)
 */
export function quantize(px: JpegPixels, sampling: [number, number][], quant: [number, number] = [2, 3]): CoefImage {
  const { width: X, height: Y, components: n, data } = px;
  if (sampling.length !== n) throw new Error('sampling');
  const full: Float64Array[] = [];
  if (n === 1) full.push(Float64Array.from(data));
  else {
    const [yp, cb, cr] = [new Float64Array(X * Y), new Float64Array(X * Y), new Float64Array(X * Y)];
    for (let i = 0; i < X * Y; i++) {
      const [r, g, b] = [data[3 * i], data[3 * i + 1], data[3 * i + 2]];
      // JFIF「Conversion to and from RGB」
      yp[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      cb[i] = -0.1687 * r - 0.3313 * g + 0.5 * b + 128;
      cr[i] = 0.5 * r - 0.4187 * g - 0.0813 * b + 128;
    }
    full.push(yp, cb, cr);
  }
  const hmax = Math.max(...sampling.map((s) => s[0]));
  const vmax = Math.max(...sampling.map((s) => s[1]));
  const mcusX = Math.ceil(X / (8 * hmax));
  const mcusY = Math.ceil(Y / (8 * vmax));
  const s = new Float64Array(64);
  const comps = sampling.map(([h, v], ci) => {
    const [rx, ry] = [hmax / h, vmax / v];
    if (!Number.isInteger(rx) || !Number.isInteger(ry)) throw new Error('sampling ratio');
    const bw = mcusX * h;
    const bh = mcusY * v;
    const tq = ci === 0 ? 0 : 1;
    const coef = new Int32Array(bw * bh * 64);
    /** 間引いた面の標本 (cx, cy)。画像の外は、端の画素を繰り返す */
    const sample = (cx: number, cy: number) => {
      let sum = 0;
      for (let dy = 0; dy < ry; dy++) for (let dx = 0; dx < rx; dx++) sum += full[ci][Math.min(Y - 1, cy * ry + dy) * X + Math.min(X - 1, cx * rx + dx)];
      return sum / (rx * ry);
    };
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s[y * 8 + x] = sample(bx * 8 + x, by * 8 + y) - 128;
        for (let vv = 0; vv < 8; vv++)
          for (let u = 0; u < 8; u++) {
            let a = 0;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) a += s[y * 8 + x] * COS[x * 8 + u] * COS[y * 8 + vv];
            a *= ((u === 0 ? Math.SQRT1_2 : 1) * (vv === 0 ? Math.SQRT1_2 : 1)) / 4;
            // 自然な順 (vv * 8 + u) の係数を、ジグザグ順の位置に置く
            coef[(by * bw + bx) * 64 + ZIGZAG[vv * 8 + u]] = Math.round(a / quant[tq]);
          }
      }
    return { h, v, tq, bw, bh, coef };
  });
  return { width: X, height: Y, comps, quant, hmax, vmax, mcusX, mcusY };
}

/** Annex C: BITS・HUFFVAL から、値ごとの符号と符号長 */
function codesOf(spec: HuffmanSpec) {
  const code = new Int32Array(256).fill(-1);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < spec.bits[l - 1]; i++, c++, k++) {
      code[spec.values[k]] = c;
      size[spec.values[k]] = l;
    }
    c <<= 1;
  }
  return { code, size };
}

/**
 * 0〜255 のすべての値を持つ符号表 (8 ビットの符号 255 個と、9 ビットの符号 1 個。すべて 1 のビットの符号は無い: Annex C)。
 * 漸進の走査の値 (EOB の連なり EOB0〜EOB14 など) は、Annex K の表 (逐次の値だけ) に無いので、この表で書く
 */
const FULL: HuffmanSpec = { bits: [0, 0, 0, 0, 0, 0, 0, 255, 1, 0, 0, 0, 0, 0, 0, 0], values: Array.from({ length: 256 }, (_, i) => i) };

/** 値の大きさの区分 SSSS (Table F.1・F.2) */
const category = (v: number) => {
  let a = Math.abs(v);
  let s = 0;
  for (; a; a >>= 1) s++;
  return s;
};

/** 係数を、走査の組み方 opts で JPEG の符号の列にする */
export function writeJpeg(img: CoefImage, opts: WriteOptions = {}): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push((v >> 8) & 255, v & 255);
  const n = img.comps.length;
  const progressive = !!opts.scans;
  const restart = opts.restart ?? 0;
  const stats = opts.stats;

  u16(0xffd8);
  // DQT (B.2.4.1)
  const nq = n === 1 ? 1 : 2;
  u16(0xffdb);
  u16(2 + 65 * nq);
  for (let t = 0; t < nq; t++) {
    out.push(t);
    for (let k = 0; k < 64; k++) out.push(img.quant[t]);
  }
  // SOF0・SOF2 (B.2.2)
  u16(progressive ? 0xffc2 : 0xffc0);
  u16(8 + 3 * n);
  out.push(8);
  u16(img.height);
  u16(img.width);
  out.push(n);
  img.comps.forEach((c, i) => out.push(i + 1, (c.h << 4) | c.v, c.tq));
  // DHT (B.2.4.2): 逐次は Annex K の表、漸進はすべての値を持つ表
  const specs: [number, HuffmanSpec][] = progressive
    ? [[0x00, FULL], [0x10, FULL]]
    : n === 1
      ? [[0x00, DC_LUMA], [0x10, AC_LUMA]]
      : [[0x00, DC_LUMA], [0x10, AC_LUMA], [0x01, DC_CHROMA], [0x11, AC_CHROMA]];
  u16(0xffc4);
  u16(2 + specs.reduce((a, [, sp]) => a + 17 + sp.values.length, 0));
  for (const [id, sp] of specs) out.push(id, ...sp.bits, ...sp.values);
  const tables = new Map(specs.map(([id, sp]) => [id, codesOf(sp)]));
  // DRI (B.2.4.4)
  if (restart) {
    u16(0xffdd);
    u16(4);
    u16(restart);
  }

  for (const scan of opts.scans ?? [{ comps: img.comps.map((_, i) => i), ss: 0, se: 63, ah: 0, al: 0 }]) {
    // SOS (B.2.3)
    u16(0xffda);
    u16(6 + 2 * scan.comps.length);
    out.push(scan.comps.length);
    const tableOf = (ci: number) => (progressive || ci === 0 ? 0 : 1);
    for (const ci of scan.comps) out.push(ci + 1, (tableOf(ci) << 4) | tableOf(ci));
    out.push(scan.ss, scan.se, (scan.ah << 4) | scan.al);

    // 符号のビット (F.1.2.3: 0xFF の後に 0x00。区切りの前は 1 のビットで埋める)
    let acc = 0;
    let nacc = 0;
    const put = (code: number, size: number) => {
      for (let i = size - 1; i >= 0; i--) {
        acc = (acc << 1) | ((code >> i) & 1);
        if (++nacc === 8) {
          out.push(acc);
          if (acc === 0xff) out.push(0);
          acc = 0;
          nacc = 0;
        }
      }
    };
    const flushBits = () => {
      if (nacc) put(0xff, 8 - nacc);
    };
    const sym = (ac: boolean, ci: number, value: number) => {
      const t = tables.get((ac ? 0x10 : 0) | tableOf(ci))!;
      if (t.code[value] < 0) throw new Error(`符号表に無い値 ${value}`);
      put(t.code[value], t.size[value]);
    };
    /** 大きさ s ビットの値 (F.1.2.1.1: 負の値は 1 を引いた下位のビット) */
    const bitsOf = (v: number, s: number) => put((v < 0 ? v - 1 : v) & ((1 << s) - 1), s);

    const preds = img.comps.map(() => 0);
    let eobRun = 0;
    /** EOB の連なりの後に送る、訂正のビット (G.1.2.3) */
    let eobBits: number[] = [];
    const flushEob = (ci: number) => {
      if (eobRun > 0) {
        if (stats) stats.maxEobRun = Math.max(stats.maxEobRun, eobRun);
        const r = 31 - Math.clz32(eobRun);
        sym(true, ci, r << 4);
        if (r) put(eobRun & ((1 << r) - 1), r);
        eobRun = 0;
      }
      for (const bit of eobBits) put(bit, 1);
      if (stats) stats.refineBits += eobBits.length;
      eobBits = [];
    };

    const block = (ci: number, off: number) => {
      const zz = img.comps[ci].coef;
      const { ss, se, ah, al } = scan;
      if (!progressive) {
        // F.1.2: DC の差分と、AC の (0 の連なり・大きさ) の組
        const diff = zz[off] - preds[ci];
        preds[ci] = zz[off];
        const t = category(diff);
        sym(false, ci, t);
        if (t) bitsOf(diff, t);
        let r = 0;
        for (let k = 1; k < 64; k++) {
          const v = zz[off + k];
          if (v === 0) {
            r++;
            continue;
          }
          for (; r > 15; r -= 16) {
            sym(true, ci, 0xf0);
            if (stats) stats.zrl++;
          }
          const c = category(v);
          sym(true, ci, (r << 4) | c);
          bitsOf(v, c);
          r = 0;
        }
        if (r > 0) sym(true, ci, 0);
        return;
      }
      if (ss === 0) {
        // G.1.2.1: DC。最初の走査は Al ビット右に移した値の差分、続く走査は Al のビットを 1 つ
        const v = zz[off] >> al;
        if (ah === 0) {
          const diff = v - preds[ci];
          preds[ci] = v;
          const t = category(diff);
          sym(false, ci, t);
          if (t) bitsOf(diff, t);
        } else put(v & 1, 1);
        return;
      }
      if (ah === 0) {
        // G.1.2.2: AC の最初の走査。大きさを Al ビット右に移した値と、EOB の連なり
        let r = 0;
        for (let k = ss; k <= se; k++) {
          const v = zz[off + k];
          const a = Math.abs(v) >> al;
          if (a === 0) {
            r++;
            continue;
          }
          flushEob(ci);
          for (; r > 15; r -= 16) {
            sym(true, ci, 0xf0);
            if (stats) stats.zrl++;
          }
          const c = category(a);
          sym(true, ci, (r << 4) | c);
          bitsOf(v < 0 ? -a : a, c);
          r = 0;
        }
        if (r > 0 && ++eobRun === 0x7fff) flushEob(ci);
        return;
      }
      // G.1.2.3: AC の続く走査。すでに 0 でない係数には訂正のビット、新しく 0 でなくなる係数 (大きさ 1) には符号
      const abs: number[] = [];
      let last = -1;
      for (let k = ss; k <= se; k++) {
        abs[k] = Math.abs(zz[off + k]) >> al;
        if (abs[k] === 1) last = k;
      }
      let r = 0;
      let pending: number[] = [];
      const flushPending = () => {
        for (const bit of pending) put(bit, 1);
        if (stats) stats.refineBits += pending.length;
        pending = [];
      };
      for (let k = ss; k <= se; k++) {
        const a = abs[k];
        if (a === 0) {
          r++;
          continue;
        }
        // 0 が 16 個続いた所 (ZRL)。この後に新しい係数が無ければ、EOB にまとめる
        while (r > 15 && k <= last) {
          flushEob(ci);
          sym(true, ci, 0xf0);
          if (stats) stats.zrl++;
          r -= 16;
          flushPending();
        }
        if (a > 1) {
          pending.push(a & 1);
          continue;
        }
        flushEob(ci);
        sym(true, ci, (r << 4) | 1);
        put(zz[off + k] < 0 ? 0 : 1, 1);
        flushPending();
        r = 0;
      }
      if (r > 0 || pending.length) {
        eobRun++;
        eobBits.push(...pending);
        if (eobRun === 0x7fff) flushEob(ci);
      }
    };

    // 区画の順 (A.2): 成分が 1 つの走査は、その成分の区画を行ごとに (区画の数は成分の標本の数から)。複数なら MCU ごと
    const units: [number, number][][] = [];
    if (scan.comps.length === 1) {
      const ci = scan.comps[0];
      const c = img.comps[ci];
      const cw = Math.ceil(Math.ceil((img.width * c.h) / img.hmax) / 8);
      const ch = Math.ceil(Math.ceil((img.height * c.v) / img.vmax) / 8);
      for (let by = 0; by < ch; by++) for (let bx = 0; bx < cw; bx++) units.push([[ci, (by * c.bw + bx) * 64]]);
    } else {
      for (let my = 0; my < img.mcusY; my++)
        for (let mx = 0; mx < img.mcusX; mx++) {
          const u: [number, number][] = [];
          for (const ci of scan.comps) {
            const c = img.comps[ci];
            for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) u.push([ci, ((my * c.v + v) * c.bw + mx * c.h + h) * 64]);
          }
          units.push(u);
        }
    }
    let rst = 0;
    units.forEach((u, i) => {
      if (restart && i > 0 && i % restart === 0) {
        // 再開の間隔の終わり (E.1.4。EOB の連なりもここで切る): ビットを埋め、RSTm (m は 0〜7 を巡る) を置き、DC の予測を 0 に戻す
        flushEob(scan.comps[0]);
        flushBits();
        u16(0xffd0 + (rst++ & 7));
        if (stats) stats.rst++;
        preds.fill(0);
      }
      for (const [ci, off] of u) block(ci, off);
    });
    flushEob(scan.comps[0]);
    flushBits();
  }
  u16(0xffd9);
  return Uint8Array.from(out);
}

/**
 * 漸進の走査の並び (スペクトルの分割と逐次近似の両方を使う。G.1 の決まり: DC は AC と分ける。AC の走査は成分 1 つ。
 * 続く走査の Ah は前の走査の Al)。成分が 3 つなら、DC は 3 成分をまとめた走査 (MCU ごと) にする
 */
export function progressiveScans(n: 1 | 3): Scan[] {
  const all = n === 1 ? [0] : [0, 1, 2];
  const scans: Scan[] = [{ comps: all, ss: 0, se: 0, ah: 0, al: 1 }];
  scans.push({ comps: [0], ss: 1, se: 5, ah: 0, al: 2 });
  if (n === 3) scans.push({ comps: [2], ss: 1, se: 63, ah: 0, al: 1 }, { comps: [1], ss: 1, se: 63, ah: 0, al: 1 });
  scans.push({ comps: [0], ss: 6, se: 63, ah: 0, al: 2 }, { comps: [0], ss: 1, se: 63, ah: 2, al: 1 }, { comps: all, ss: 0, se: 0, ah: 1, al: 0 });
  if (n === 3) scans.push({ comps: [2], ss: 1, se: 63, ah: 1, al: 0 }, { comps: [1], ss: 1, se: 63, ah: 1, al: 0 });
  scans.push({ comps: [0], ss: 1, se: 63, ah: 1, al: 0 });
  return scans;
}
