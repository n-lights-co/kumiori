/**
 * vp8 — VP8 (WebP の非可逆圧縮) のキーフレームを読み、RGBA にする (画像を Canvas に描けない環境 (Node) 用。RFC 6386)。
 *  - ブール符号・セグメント・係数の確率の更新・16×16 / 4×4 / 色差 8×8 の画面内予測・WHT と IDCT・ループフィルタ (簡易・通常)
 *  - YUV → RGB は libwebp と同じ (色差の補間 (fancy upsampling) と 14 ビットの係数)
 *
 * このファイルの一部は libwebp (https://chromium.googlesource.com/webm/libwebp) から派生している:
 * WHT と 4×4 の逆 DCT の組み立て (libwebp の src/dsp/dec.c の TransformWHT_C・TransformOne_C)、YUV → RGB の係数
 * (src/dsp/yuv.h の VP8YUVToR・VP8YUVToG・VP8YUVToB)、色差の補間 (src/dsp/upsampling.c の UPSAMPLE_FUNC)、予測の向きの番号。
 * 2026-11-08 に libwebp の main ブランチのソース (GitHub の写し https://github.com/webmproject/libwebp) と比べて確かめた。libwebp のライセンス (BSD 3-Clause) に従い、
 * 著作権表示と条文を下に書き換えずに載せる (libwebp の COPYING。PATENTS とあわせて THIRD_PARTY_NOTICES.md の 3 節):
 *
 * Copyright (c) 2010, Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *   * Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 *
 *   * Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in
 *     the documentation and/or other materials provided with the
 *     distribution.
 *
 *   * Neither the name of Google nor the names of its contributors may
 *     be used to endorse or promote products derived from this software
 *     without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { MAX_PIXELS } from './imageLimits';
import { AC_TABLE, BMODES_PROBA, COEFF_PROBA0, COEFF_UPDATE_PROBA, DC_TABLE } from './vp8Tables';

/** ブール符号 (RFC 6386 §7) */
class BoolDecoder {
  private value: number;
  private range = 255;
  private count = 0;
  private pos: number;
  constructor(
    private b: Uint8Array,
    start: number,
    private end: number,
  ) {
    this.value = ((b[start] ?? 0) << 8) | (b[start + 1] ?? 0);
    this.pos = start + 2;
  }
  bit(prob: number): number {
    const split = 1 + (((this.range - 1) * prob) >> 8);
    const big = split << 8;
    let r: number;
    if (this.value >= big) {
      r = 1;
      this.range -= split;
      this.value -= big;
    } else {
      r = 0;
      this.range = split;
    }
    while (this.range < 128) {
      this.value <<= 1;
      this.range <<= 1;
      if (++this.count === 8) {
        this.count = 0;
        if (this.pos < this.end) this.value |= this.b[this.pos];
        this.pos++;
      }
    }
    return r;
  }
  /** n ビットの数 (上のビットから) */
  value_(n: number): number {
    let v = 0;
    while (n-- > 0) v = (v << 1) | this.bit(128);
    return v;
  }
  signed(n: number): number {
    const v = this.value_(n);
    return this.bit(128) ? -v : v;
  }
}

// 予測の向き (libwebp の番号。16×16 の DC・TM・V・H は 4×4 の DC・TM・VE・HE と同じ番号)
const B_DC = 0;
const B_TM = 1;
const B_VE = 2;
const B_HE = 3;
/** 4×4 の向きの木 (RFC 6386 §11.2) */
const BMODE_TREE = [-B_DC, 1, -B_TM, 2, -B_VE, 3, 4, 6, -B_HE, 5, -4 /* RD */, -5 /* VR */, -6 /* LD */, 7, -7 /* VL */, 8, -8 /* HD */, -9 /* HU */];
const ZIGZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
const BANDS = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0];
const CAT3456 = [
  [173, 148, 140],
  [176, 155, 140, 135],
  [180, 157, 141, 134, 130],
  [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129],
];

const clip255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

interface MacroBlock {
  segment: number;
  skip: number;
  i4x4: boolean;
  /** 16×16 なら [向き]、4×4 なら 16 個の向き */
  ymodes: number[];
  uvmode: number;
  /** 係数 (25 個の 4×4 の箱: Y 16・U 4・V 4。Y2 は Y の DC に組み入れ済み) */
  coeffs: Int16Array;
  /** 係数が 0 でない箱 (25 ビット) */
  nzMask: number;
}

/** VP8 のキーフレーム (WebP の 'VP8 ' チャンクの中身) の画素。読めなければ undefined */
export function decodeVp8(b: Uint8Array): { width: number; height: number; rgba: Uint8Array } | undefined {
  try {
    return decode(b);
  } catch {
    return undefined;
  }
}

function decode(b: Uint8Array) {
  if (b.length < 10) return undefined;
  const tag = b[0] | (b[1] << 8) | (b[2] << 16);
  const keyFrame = !(tag & 1);
  const firstSize = tag >>> 5;
  if (!keyFrame || b[3] !== 0x9d || b[4] !== 0x01 || b[5] !== 0x2a) return undefined;
  const width = (b[6] | (b[7] << 8)) & 0x3fff;
  const height = (b[8] | (b[9] << 8)) & 0x3fff;
  if (!width || !height || width * height > MAX_PIXELS) return undefined;
  const mbw = (width + 15) >> 4;
  const mbh = (height + 15) >> 4;
  if (10 + firstSize > b.length) return undefined;
  const br = new BoolDecoder(b, 10, 10 + firstSize);
  br.value_(1); // 色空間
  br.value_(1); // 切り詰めの種類

  // セグメント
  const seg = { use: false, updateMap: false, absolute: false, quant: [0, 0, 0, 0], filter: [0, 0, 0, 0], proba: [255, 255, 255] };
  if (br.value_(1)) {
    seg.use = true;
    seg.updateMap = !!br.value_(1);
    if (br.value_(1)) {
      seg.absolute = !!br.value_(1);
      for (let s = 0; s < 4; s++) seg.quant[s] = br.value_(1) ? br.signed(7) : 0;
      for (let s = 0; s < 4; s++) seg.filter[s] = br.value_(1) ? br.signed(6) : 0;
    }
    if (seg.updateMap) for (let s = 0; s < 3; s++) seg.proba[s] = br.value_(1) ? br.value_(8) : 255;
  }
  // ループフィルタ
  const simple = !!br.value_(1);
  const level = br.value_(6);
  const sharpness = br.value_(3);
  const useLfDelta = !!br.value_(1);
  const refLfDelta = [0, 0, 0, 0];
  const modeLfDelta = [0, 0, 0, 0];
  if (useLfDelta && br.value_(1)) {
    for (let i = 0; i < 4; i++) if (br.value_(1)) refLfDelta[i] = br.signed(6);
    for (let i = 0; i < 4; i++) if (br.value_(1)) modeLfDelta[i] = br.signed(6);
  }
  // 係数の区画
  const nparts = 1 << br.value_(2);
  let p = 10 + firstSize;
  const sizesAt = p;
  p += 3 * (nparts - 1);
  const parts: BoolDecoder[] = [];
  for (let i = 0; i < nparts; i++) {
    const size = i < nparts - 1 ? b[sizesAt + i * 3] | (b[sizesAt + i * 3 + 1] << 8) | (b[sizesAt + i * 3 + 2] << 16) : b.length - p;
    parts.push(new BoolDecoder(b, p, Math.min(p + size, b.length)));
    p += size;
  }
  // 量子化
  const baseQ = br.value_(7);
  const dq = [0, 0, 0, 0, 0].map(() => (br.value_(1) ? br.signed(4) : 0)); // y1_dc・y2_dc・y2_ac・uv_dc・uv_ac
  const clipQ = (q: number, max = 127) => (q < 0 ? 0 : q > max ? max : q);
  const quants = [0, 1, 2, 3].map((s) => {
    const q = seg.use ? (seg.absolute ? seg.quant[s] : baseQ + seg.quant[s]) : baseQ;
    const y2ac = Math.floor((AC_TABLE[clipQ(q + dq[2])] * 101581) / 65536);
    return {
      y1: [DC_TABLE[clipQ(q + dq[0])], AC_TABLE[clipQ(q)]],
      y2: [DC_TABLE[clipQ(q + dq[1])] * 2, y2ac < 8 ? 8 : y2ac],
      uv: [DC_TABLE[clipQ(q + dq[3], 117)], AC_TABLE[clipQ(q + dq[4])]],
    };
  });
  br.value_(1); // 確率を保存するか (キーフレームでは使わない)
  // 係数の確率
  const proba = new Uint8Array(COEFF_PROBA0);
  for (let i = 0; i < proba.length; i++) if (br.bit(COEFF_UPDATE_PROBA[i])) proba[i] = br.value_(8);
  const useSkip = !!br.value_(1);
  const skipProba = useSkip ? br.value_(8) : 0;

  // マクロブロックの予測の向き (最初の区画) と係数 (係数の区画)
  const mbs: MacroBlock[] = new Array(mbw * mbh);
  const topModes = new Uint8Array(mbw * 4); // 上の 4×4 の向き (B_DC で始まる)
  const topNz = new Uint8Array(mbw * 9); // 上の 0 でない係数の印 (Y 4・U 2・V 2・Y2 1)
  for (let my = 0; my < mbh; my++) {
    const leftModes = new Uint8Array(4);
    const leftNz = new Uint8Array(9);
    const tb = parts[my & (nparts - 1)];
    for (let mx = 0; mx < mbw; mx++) {
      const mb: MacroBlock = { segment: 0, skip: 0, i4x4: false, ymodes: [], uvmode: 0, coeffs: new Int16Array(25 * 16), nzMask: 0 };
      if (seg.updateMap) mb.segment = !br.bit(seg.proba[0]) ? br.bit(seg.proba[1]) : br.bit(seg.proba[2]) + 2;
      mb.skip = useSkip ? br.bit(skipProba) : 0;
      mb.i4x4 = !br.bit(145);
      const top = topModes.subarray(mx * 4, mx * 4 + 4);
      if (!mb.i4x4) {
        const ym = br.bit(156) ? (br.bit(128) ? B_TM : B_HE) : br.bit(163) ? B_VE : B_DC;
        mb.ymodes = [ym];
        top.fill(ym);
        leftModes.fill(ym);
      } else {
        for (let y = 0; y < 4; y++) {
          let left = leftModes[y];
          for (let x = 0; x < 4; x++) {
            const pr = (top[x] * 10 + left) * 9;
            let i = BMODE_TREE[br.bit(BMODES_PROBA[pr])];
            while (i > 0) i = BMODE_TREE[2 * i + br.bit(BMODES_PROBA[pr + i])];
            const m = -i;
            mb.ymodes[y * 4 + x] = m;
            top[x] = m;
            left = m;
          }
          leftModes[y] = left;
        }
      }
      mb.uvmode = !br.bit(142) ? B_DC : !br.bit(114) ? B_VE : br.bit(183) ? B_TM : B_HE;
      // 係数
      const tnz = topNz.subarray(mx * 9, mx * 9 + 9);
      if (!mb.skip) residuals(tb, mb, proba, quants[mb.segment], tnz, leftNz);
      else {
        tnz.fill(0, 0, 8);
        leftNz.fill(0, 0, 8);
        if (!mb.i4x4) tnz[8] = leftNz[8] = 0;
      }
      mbs[my * mbw + mx] = mb;
    }
  }

  // 画面内の予測と逆変換
  const yw = mbw * 16;
  const uvw = mbw * 8;
  const Y = new Uint8Array(yw * mbh * 16);
  const U = new Uint8Array(uvw * mbh * 8);
  const V = new Uint8Array(uvw * mbh * 8);
  for (let my = 0; my < mbh; my++) for (let mx = 0; mx < mbw; mx++) reconstruct(mbs[my * mbw + mx], mx, my, mbw, Y, U, V);

  // ループフィルタ
  if (level > 0) {
    const strengths = [0, 1, 2, 3].map((s) =>
      [0, 1].map((i4) => {
        let lv = seg.use ? (seg.absolute ? seg.filter[s] : level + seg.filter[s]) : level;
        if (useLfDelta) {
          lv += refLfDelta[0];
          if (i4) lv += modeLfDelta[0];
        }
        lv = lv < 0 ? 0 : lv > 63 ? 63 : lv;
        if (lv === 0) return { limit: 0, ilevel: 0, hev: 0 };
        let il = lv;
        if (sharpness > 0) {
          il >>= sharpness > 4 ? 2 : 1;
          if (il > 9 - sharpness) il = 9 - sharpness;
        }
        if (il < 1) il = 1;
        return { limit: 2 * lv + il, ilevel: il, hev: lv >= 40 ? 2 : lv >= 15 ? 1 : 0 };
      }),
    );
    for (let my = 0; my < mbh; my++) {
      for (let mx = 0; mx < mbw; mx++) {
        const mb = mbs[my * mbw + mx];
        const f = strengths[mb.segment][mb.i4x4 ? 1 : 0];
        if (!f.limit) continue;
        const inner = mb.i4x4 || mb.nzMask !== 0;
        const yo = my * 16 * yw + mx * 16;
        const uo = my * 8 * uvw + mx * 8;
        if (simple) {
          if (mx > 0) simpleFilter(Y, yo, 1, yw, 16, f.limit + 4);
          if (inner) for (let k = 4; k < 16; k += 4) simpleFilter(Y, yo + k, 1, yw, 16, f.limit);
          if (my > 0) simpleFilter(Y, yo, yw, 1, 16, f.limit + 4);
          if (inner) for (let k = 4; k < 16; k += 4) simpleFilter(Y, yo + k * yw, yw, 1, 16, f.limit);
        } else {
          if (mx > 0) {
            filterLoop(Y, yo, 1, yw, 16, f.limit + 4, f.ilevel, f.hev, true);
            filterLoop(U, uo, 1, uvw, 8, f.limit + 4, f.ilevel, f.hev, true);
            filterLoop(V, uo, 1, uvw, 8, f.limit + 4, f.ilevel, f.hev, true);
          }
          if (inner) {
            for (let k = 4; k < 16; k += 4) filterLoop(Y, yo + k, 1, yw, 16, f.limit, f.ilevel, f.hev, false);
            filterLoop(U, uo + 4, 1, uvw, 8, f.limit, f.ilevel, f.hev, false);
            filterLoop(V, uo + 4, 1, uvw, 8, f.limit, f.ilevel, f.hev, false);
          }
          if (my > 0) {
            filterLoop(Y, yo, yw, 1, 16, f.limit + 4, f.ilevel, f.hev, true);
            filterLoop(U, uo, uvw, 1, 8, f.limit + 4, f.ilevel, f.hev, true);
            filterLoop(V, uo, uvw, 1, 8, f.limit + 4, f.ilevel, f.hev, true);
          }
          if (inner) {
            for (let k = 4; k < 16; k += 4) filterLoop(Y, yo + k * yw, yw, 1, 16, f.limit, f.ilevel, f.hev, false);
            filterLoop(U, uo + 4 * uvw, uvw, 1, 8, f.limit, f.ilevel, f.hev, false);
            filterLoop(V, uo + 4 * uvw, uvw, 1, 8, f.limit, f.ilevel, f.hev, false);
          }
        }
      }
    }
  }
  return { width, height, rgba: toRgba(Y, U, V, yw, uvw, width, height) };
}

/** マクロブロックの係数を読む (RFC 6386 §13) */
function residuals(br: BoolDecoder, mb: MacroBlock, proba: Uint8Array, q: { y1: number[]; y2: number[]; uv: number[] }, tnz: Uint8Array, lnz: Uint8Array) {
  const out = mb.coeffs;
  let first = 0;
  let yType = 3;
  if (!mb.i4x4) {
    const dc = new Int16Array(16);
    const n = coeffs(br, proba, 1, tnz[8] + lnz[8], q.y2, 0, dc, 0);
    tnz[8] = lnz[8] = n > 0 ? 1 : 0;
    // WHT で 16 個の箱の DC にする
    const tmp = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
      const a0 = dc[i] + dc[12 + i];
      const a1 = dc[4 + i] + dc[8 + i];
      const a2 = dc[4 + i] - dc[8 + i];
      const a3 = dc[i] - dc[12 + i];
      tmp[i] = a0 + a1;
      tmp[8 + i] = a0 - a1;
      tmp[4 + i] = a3 + a2;
      tmp[12 + i] = a3 - a2;
    }
    for (let i = 0; i < 4; i++) {
      const d = tmp[i * 4] + 3;
      const a0 = d + tmp[3 + i * 4];
      const a1 = tmp[1 + i * 4] + tmp[2 + i * 4];
      const a2 = tmp[1 + i * 4] - tmp[2 + i * 4];
      const a3 = d - tmp[3 + i * 4];
      out[(i * 4) * 16] = (a0 + a1) >> 3;
      out[(i * 4 + 1) * 16] = (a3 + a2) >> 3;
      out[(i * 4 + 2) * 16] = (a0 - a1) >> 3;
      out[(i * 4 + 3) * 16] = (a3 - a2) >> 3;
    }
    first = 1;
    yType = 0;
  }
  let mask = 0;
  for (let y = 0; y < 4; y++) {
    let l = lnz[y];
    for (let x = 0; x < 4; x++) {
      const k = y * 4 + x;
      const n = coeffs(br, proba, yType, l + tnz[x], q.y1, first, out, k * 16);
      l = n > first ? 1 : 0;
      tnz[x] = l;
      // 16×16 の予測では AC は位置 1 から読むので、AC が空でも n は 1 (DC は Y2 から)
      if (n > first || out[k * 16] !== 0) mask |= 1 << k;
    }
    lnz[y] = l;
  }
  for (let c = 0; c < 2; c++) {
    for (let y = 0; y < 2; y++) {
      let l = lnz[4 + c * 2 + y];
      for (let x = 0; x < 2; x++) {
        const k = 16 + c * 4 + y * 2 + x;
        const n = coeffs(br, proba, 2, l + tnz[4 + c * 2 + x], q.uv, 0, out, k * 16);
        l = n > 0 ? 1 : 0;
        tnz[4 + c * 2 + x] = l;
        if (n > 0) mask |= 1 << k;
      }
      lnz[4 + c * 2 + y] = l;
    }
  }
  mb.nzMask = mask;
}

/** 4×4 の箱の係数を読む。読んだ最後の位置 + 1 を返す (0 なら係数なし) */
function coeffs(br: BoolDecoder, proba: Uint8Array, type: number, ctx: number, dq: number[], n: number, out: Int16Array, o: number): number {
  const at = (band: number, c: number) => ((type * 8 + band) * 3 + c) * 11;
  let p = at(BANDS[n], ctx);
  for (; n < 16; n++) {
    if (!br.bit(proba[p])) return n; // 終わり
    while (!br.bit(proba[p + 1])) {
      // 0 の係数
      p = at(BANDS[++n], 0);
      if (n === 16) return 16;
    }
    let v: number;
    const next = BANDS[n + 1];
    if (!br.bit(proba[p + 2])) {
      v = 1;
      p = at(next, 1);
    } else {
      if (!br.bit(proba[p + 3])) {
        v = !br.bit(proba[p + 4]) ? 2 : 3 + br.bit(proba[p + 5]);
      } else if (!br.bit(proba[p + 6])) {
        if (!br.bit(proba[p + 7])) v = 5 + br.bit(159);
        else {
          v = 7 + 2 * br.bit(165);
          v += br.bit(145);
        }
      } else {
        const b1 = br.bit(proba[p + 8]);
        const b0 = br.bit(proba[p + 9 + b1]);
        const cat = 2 * b1 + b0;
        v = 0;
        for (const t of CAT3456[cat]) v += v + br.bit(t);
        v += 3 + (8 << cat);
      }
      p = at(next, 2);
    }
    out[o + ZIGZAG[n]] = (br.bit(128) ? -v : v) * dq[n > 0 ? 1 : 0];
  }
  return 16;
}

/** 4×4 の逆 DCT を dst に足す (libwebp の TransformOne と同じ) */
function idctAdd(c: Int16Array, o: number, dst: Uint8Array, d: number, stride: number) {
  const mul1 = (a: number) => Math.floor((a * 20091) / 65536) + a;
  const mul2 = (a: number) => Math.floor((a * 35468) / 65536);
  const tmp = new Int32Array(16);
  for (let i = 0; i < 4; i++) {
    const a = c[o + i] + c[o + 8 + i];
    const b = c[o + i] - c[o + 8 + i];
    const cc = mul2(c[o + 4 + i]) - mul1(c[o + 12 + i]);
    const dd = mul1(c[o + 4 + i]) + mul2(c[o + 12 + i]);
    tmp[i * 4] = a + dd;
    tmp[i * 4 + 1] = b + cc;
    tmp[i * 4 + 2] = b - cc;
    tmp[i * 4 + 3] = a - dd;
  }
  for (let i = 0; i < 4; i++) {
    const dc = tmp[i] + 4;
    const a = dc + tmp[8 + i];
    const b = dc - tmp[8 + i];
    const cc = mul2(tmp[4 + i]) - mul1(tmp[12 + i]);
    const dd = mul1(tmp[4 + i]) + mul2(tmp[12 + i]);
    const r = d + i * stride;
    dst[r] = clip255(dst[r] + ((a + dd) >> 3));
    dst[r + 1] = clip255(dst[r + 1] + ((b + cc) >> 3));
    dst[r + 2] = clip255(dst[r + 2] + ((b - cc) >> 3));
    dst[r + 3] = clip255(dst[r + 3] + ((a - dd) >> 3));
  }
}

/**
 * マクロブロックを組み立てる: 予測して係数の逆変換を足す。予測に使う周りの画素は、ループフィルタの前の値
 * (フレームの上の外は 127、左の外は 129。libwebp と同じ)
 */
function reconstruct(mb: MacroBlock, mx: number, my: number, mbw: number, Y: Uint8Array, U: Uint8Array, V: Uint8Array) {
  const yw = mbw * 16;
  const uvw = mbw * 8;
  // 作業用の箱 (左に 1 列・上に 1 行、右上に 4 画素の余白)
  const S = 21;
  const ybuf = new Uint8Array(S * 17);
  const yo = S + 1; // (0, 0) の位置
  for (let x = -1; x < 20; x++) {
    let v: number;
    if (my === 0) v = 127;
    else if (x === -1) v = mx === 0 ? 129 : Y[(my * 16 - 1) * yw + mx * 16 - 1];
    else if (x < 16) v = Y[(my * 16 - 1) * yw + mx * 16 + x];
    else v = mx < mbw - 1 ? Y[(my * 16 - 1) * yw + mx * 16 + x] : Y[(my * 16 - 1) * yw + mx * 16 + 15];
    ybuf[yo - S + x] = v;
  }
  if (my > 0 && mx === 0) ybuf[yo - S - 1] = 129;
  for (let y = 0; y < 16; y++) ybuf[yo + y * S - 1] = mx === 0 ? 129 : Y[(my * 16 + y) * yw + mx * 16 - 1];
  if (mb.i4x4) {
    // 右の列の 4×4 は、どの行でも上のマクロブロックの右上の画素を使う
    for (const r of [3, 7, 11]) for (let k = 0; k < 4; k++) ybuf[yo + r * S + 16 + k] = ybuf[yo - S + 16 + k];
    for (let n = 0; n < 16; n++) {
      const d = yo + (n >> 2) * 4 * S + (n & 3) * 4;
      predict4(mb.ymodes[n], ybuf, d, S);
      if (mb.nzMask & (1 << n)) idctAdd(mb.coeffs, n * 16, ybuf, d, S);
    }
  } else {
    predictBlock(checkMode(mb.ymodes[0], mx, my), ybuf, yo, S, 16);
    for (let n = 0; n < 16; n++) if (mb.nzMask & (1 << n)) idctAdd(mb.coeffs, n * 16, ybuf, yo + (n >> 2) * 4 * S + (n & 3) * 4, S);
  }
  for (let y = 0; y < 16; y++) Y.set(ybuf.subarray(yo + y * S, yo + y * S + 16), (my * 16 + y) * yw + mx * 16);
  // 色差
  for (const [P, base] of [
    [U, 16],
    [V, 20],
  ] as const) {
    const T = 9;
    const buf = new Uint8Array(T * 9);
    const o = T + 1;
    for (let x = -1; x < 8; x++) buf[o - T + x] = my === 0 ? 127 : x === -1 ? (mx === 0 ? 129 : P[(my * 8 - 1) * uvw + mx * 8 - 1]) : P[(my * 8 - 1) * uvw + mx * 8 + x];
    for (let y = 0; y < 8; y++) buf[o + y * T - 1] = mx === 0 ? 129 : P[(my * 8 + y) * uvw + mx * 8 - 1];
    predictBlock(checkMode(mb.uvmode, mx, my), buf, o, T, 8);
    for (let n = 0; n < 4; n++) if (mb.nzMask & (1 << (base + n))) idctAdd(mb.coeffs, (base + n) * 16, buf, o + (n >> 1) * 4 * T + (n & 1) * 4, T);
    for (let y = 0; y < 8; y++) P.set(buf.subarray(o + y * T, o + y * T + 8), (my * 8 + y) * uvw + mx * 8);
  }
}

/** DC の予測: フレームの端では、上・左の無いものにする (10: 左なし、11: 上なし、12: 両方なし) */
function checkMode(mode: number, mx: number, my: number) {
  if (mode !== B_DC) return mode;
  if (mx === 0) return my === 0 ? 12 : 10;
  return my === 0 ? 11 : B_DC;
}

/** 16×16・8×8 の予測 */
function predictBlock(mode: number, b: Uint8Array, o: number, S: number, n: number) {
  const top = (x: number) => b[o - S + x];
  const left = (y: number) => b[o + y * S - 1];
  const shift = n === 16 ? 4 : 3;
  let fill = -1;
  if (mode === B_DC || mode >= 10) {
    let st = 0;
    let sl = 0;
    for (let i = 0; i < n; i++) {
      st += top(i);
      sl += left(i);
    }
    fill = mode === B_DC ? (st + sl + n) >> (shift + 1) : mode === 10 ? (st + (n >> 1)) >> shift : mode === 11 ? (sl + (n >> 1)) >> shift : 0x80;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      b[o + y * S + x] = fill >= 0 ? fill : mode === B_TM ? clip255(top(x) + left(y) - top(-1)) : mode === B_VE ? top(x) : left(y);
    }
  }
}

/** 4×4 の予測 (RFC 6386 §12.3。libwebp と同じ) */
function predict4(mode: number, b: Uint8Array, o: number, S: number) {
  const T = (x: number) => b[o - S + x]; // T(-1) は左上、T(4..7) は右上
  const L = (y: number) => b[o + y * S - 1];
  const set = (x: number, y: number, v: number) => (b[o + y * S + x] = v);
  const avg3 = (a: number, c: number, d: number) => (a + 2 * c + d + 2) >> 2;
  const avg2 = (a: number, c: number) => (a + c + 1) >> 1;
  const X = T(-1);
  const [A, B, C, D, E, F, G, H] = [0, 1, 2, 3, 4, 5, 6, 7].map(T);
  const [I, J, K, LL] = [0, 1, 2, 3].map(L);
  switch (mode) {
    case B_DC: {
      let dc = 4;
      for (let i = 0; i < 4; i++) dc += T(i) + L(i);
      dc >>= 3;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, dc);
      break;
    }
    case B_TM:
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, clip255(T(x) + L(y) - X));
      break;
    case B_VE: {
      const v = [avg3(X, A, B), avg3(A, B, C), avg3(B, C, D), avg3(C, D, E)];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, v[x]);
      break;
    }
    case B_HE: {
      const v = [avg3(X, I, J), avg3(I, J, K), avg3(J, K, LL), avg3(K, LL, LL)];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, v[y]);
      break;
    }
    case 4: // RD
      set(0, 3, avg3(J, K, LL));
      set(1, 3, avg3(I, J, K));
      set(0, 2, avg3(I, J, K));
      for (const [x, y] of [[2, 3], [1, 2], [0, 1]]) set(x, y, avg3(X, I, J));
      for (const [x, y] of [[3, 3], [2, 2], [1, 1], [0, 0]]) set(x, y, avg3(A, X, I));
      for (const [x, y] of [[3, 2], [2, 1], [1, 0]]) set(x, y, avg3(B, A, X));
      for (const [x, y] of [[3, 1], [2, 0]]) set(x, y, avg3(C, B, A));
      set(3, 0, avg3(D, C, B));
      break;
    case 5: // VR
      for (const [x, y] of [[0, 0], [1, 2]]) set(x, y, avg2(X, A));
      for (const [x, y] of [[1, 0], [2, 2]]) set(x, y, avg2(A, B));
      for (const [x, y] of [[2, 0], [3, 2]]) set(x, y, avg2(B, C));
      set(3, 0, avg2(C, D));
      set(0, 3, avg3(K, J, I));
      set(0, 2, avg3(J, I, X));
      for (const [x, y] of [[0, 1], [1, 3]]) set(x, y, avg3(I, X, A));
      for (const [x, y] of [[1, 1], [2, 3]]) set(x, y, avg3(X, A, B));
      for (const [x, y] of [[2, 1], [3, 3]]) set(x, y, avg3(A, B, C));
      set(3, 1, avg3(B, C, D));
      break;
    case 6: // LD
      set(0, 0, avg3(A, B, C));
      for (const [x, y] of [[1, 0], [0, 1]]) set(x, y, avg3(B, C, D));
      for (const [x, y] of [[2, 0], [1, 1], [0, 2]]) set(x, y, avg3(C, D, E));
      for (const [x, y] of [[3, 0], [2, 1], [1, 2], [0, 3]]) set(x, y, avg3(D, E, F));
      for (const [x, y] of [[3, 1], [2, 2], [1, 3]]) set(x, y, avg3(E, F, G));
      for (const [x, y] of [[3, 2], [2, 3]]) set(x, y, avg3(F, G, H));
      set(3, 3, avg3(G, H, H));
      break;
    case 7: // VL
      set(0, 0, avg2(A, B));
      for (const [x, y] of [[1, 0], [0, 2]]) set(x, y, avg2(B, C));
      for (const [x, y] of [[2, 0], [1, 2]]) set(x, y, avg2(C, D));
      for (const [x, y] of [[3, 0], [2, 2]]) set(x, y, avg2(D, E));
      set(0, 1, avg3(A, B, C));
      for (const [x, y] of [[1, 1], [0, 3]]) set(x, y, avg3(B, C, D));
      for (const [x, y] of [[2, 1], [1, 3]]) set(x, y, avg3(C, D, E));
      for (const [x, y] of [[3, 1], [2, 3]]) set(x, y, avg3(D, E, F));
      set(3, 2, avg3(E, F, G));
      set(3, 3, avg3(F, G, H));
      break;
    case 8: // HD
      for (const [x, y] of [[0, 0], [2, 1]]) set(x, y, avg2(I, X));
      for (const [x, y] of [[0, 1], [2, 2]]) set(x, y, avg2(J, I));
      for (const [x, y] of [[0, 2], [2, 3]]) set(x, y, avg2(K, J));
      set(0, 3, avg2(LL, K));
      set(3, 0, avg3(A, B, C));
      set(2, 0, avg3(X, A, B));
      for (const [x, y] of [[1, 0], [3, 1]]) set(x, y, avg3(I, X, A));
      for (const [x, y] of [[1, 1], [3, 2]]) set(x, y, avg3(J, I, X));
      for (const [x, y] of [[1, 2], [3, 3]]) set(x, y, avg3(K, J, I));
      set(1, 3, avg3(LL, K, J));
      break;
    default: // HU
      set(0, 0, avg2(I, J));
      for (const [x, y] of [[2, 0], [0, 1]]) set(x, y, avg2(J, K));
      for (const [x, y] of [[2, 1], [0, 2]]) set(x, y, avg2(K, LL));
      set(1, 0, avg3(I, J, K));
      for (const [x, y] of [[3, 0], [1, 1]]) set(x, y, avg3(J, K, LL));
      for (const [x, y] of [[3, 1], [1, 2]]) set(x, y, avg3(K, LL, LL));
      for (const [x, y] of [[3, 2], [2, 2], [0, 3], [1, 3], [2, 3], [3, 3]]) set(x, y, LL);
  }
}

const sclip1 = (v: number) => (v < -128 ? -128 : v > 127 ? 127 : v);
const sclip2 = (v: number) => (v < -16 ? -16 : v > 15 ? 15 : v);

/** 2 画素ずつ直す (端の強さが強いとき・簡易フィルタ) */
function filter2(P: Uint8Array, i: number, s: number) {
  const p1 = P[i - 2 * s];
  const p0 = P[i - s];
  const q0 = P[i];
  const q1 = P[i + s];
  const a = 3 * (q0 - p0) + sclip1(p1 - q1);
  const a1 = sclip2((a + 4) >> 3);
  const a2 = sclip2((a + 3) >> 3);
  P[i - s] = clip255(p0 + a2);
  P[i] = clip255(q0 - a1);
}

/** 簡易フィルタ: 端 (step の向きに直交) に沿って n 画素 */
function simpleFilter(P: Uint8Array, o: number, step: number, along: number, n: number, thresh: number) {
  const t2 = 2 * thresh + 1;
  for (let k = 0; k < n; k++) {
    const i = o + k * along;
    if (4 * Math.abs(P[i - step] - P[i]) + Math.abs(P[i - 2 * step] - P[i + step]) <= t2) filter2(P, i, step);
  }
}

/** 通常のフィルタ (mbEdge: マクロブロックの端は 6 画素、内側の端は 4 画素を直す) */
function filterLoop(P: Uint8Array, o: number, s: number, along: number, n: number, thresh: number, ithresh: number, hevThresh: number, mbEdge: boolean) {
  const t2 = 2 * thresh + 1;
  for (let k = 0; k < n; k++) {
    const i = o + k * along;
    const p3 = P[i - 4 * s];
    const p2 = P[i - 3 * s];
    const p1 = P[i - 2 * s];
    const p0 = P[i - s];
    const q0 = P[i];
    const q1 = P[i + s];
    const q2 = P[i + 2 * s];
    const q3 = P[i + 3 * s];
    if (4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) > t2) continue;
    if (Math.abs(p3 - p2) > ithresh || Math.abs(p2 - p1) > ithresh || Math.abs(p1 - p0) > ithresh || Math.abs(q3 - q2) > ithresh || Math.abs(q2 - q1) > ithresh || Math.abs(q1 - q0) > ithresh) continue;
    const hev = Math.abs(p1 - p0) > hevThresh || Math.abs(q1 - q0) > hevThresh;
    if (hev) filter2(P, i, s);
    else if (mbEdge) {
      const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1));
      const a1 = (27 * a + 63) >> 7;
      const a2 = (18 * a + 63) >> 7;
      const a3 = (9 * a + 63) >> 7;
      P[i - 3 * s] = clip255(p2 + a3);
      P[i - 2 * s] = clip255(p1 + a2);
      P[i - s] = clip255(p0 + a1);
      P[i] = clip255(q0 - a1);
      P[i + s] = clip255(q1 - a2);
      P[i + 2 * s] = clip255(q2 - a3);
    } else {
      const a = 3 * (q0 - p0);
      const a1 = sclip2((a + 4) >> 3);
      const a2 = sclip2((a + 3) >> 3);
      const a3 = (a1 + 1) >> 1;
      P[i - 2 * s] = clip255(p1 + a3);
      P[i - s] = clip255(p0 + a2);
      P[i] = clip255(q0 - a1);
      P[i + s] = clip255(q1 - a3);
    }
  }
}

/** YUV → RGBA (libwebp と同じ: 色差は上下左右を 9:3:3:1 で補間し、14 ビットの係数で変換する) */
function toRgba(Y: Uint8Array, U: Uint8Array, V: Uint8Array, yw: number, uvw: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const mh = (v: number, c: number) => (v * c) >> 8;
  const clip8 = (v: number) => ((v & ~16383) === 0 ? v >> 6 : v < 0 ? 0 : 255);
  const put = (y: number, x: number, yy: number, u: number, v: number) => {
    const o = (y * width + x) * 4;
    out[o] = clip8(mh(yy, 19077) + mh(v, 26149) - 14234);
    out[o + 1] = clip8(mh(yy, 19077) - mh(u, 6419) - mh(v, 13320) + 8708);
    out[o + 2] = clip8(mh(yy, 19077) + mh(u, 33050) - 17685);
    out[o + 3] = 255;
  };
  /** 1 行 (と、その下の行) を、上の色差の行 tr と、いまの色差の行 cr から作る */
  const line = (top: number, bottom: number, tr: number, cr: number) => {
    const uvAt = (r: number, x: number): [number, number] => [U[r * uvw + x], V[r * uvw + x]];
    const yAt = (r: number, x: number) => Y[r * yw + x];
    let [tlu, tlv] = uvAt(tr, 0);
    let [lu, lv] = uvAt(cr, 0);
    put(top, 0, yAt(top, 0), (3 * tlu + lu + 2) >> 2, (3 * tlv + lv + 2) >> 2);
    if (bottom >= 0) put(bottom, 0, yAt(bottom, 0), (3 * lu + tlu + 2) >> 2, (3 * lv + tlv + 2) >> 2);
    const last = (width - 1) >> 1;
    for (let x = 1; x <= last; x++) {
      const [tu, tv] = uvAt(tr, x);
      const [cu, cv] = uvAt(cr, x);
      const au = tlu + tu + lu + cu + 8;
      const av = tlv + tv + lv + cv + 8;
      const d12u = (au + 2 * (tu + lu)) >> 3;
      const d12v = (av + 2 * (tv + lv)) >> 3;
      const d03u = (au + 2 * (tlu + cu)) >> 3;
      const d03v = (av + 2 * (tlv + cv)) >> 3;
      put(top, 2 * x - 1, yAt(top, 2 * x - 1), (d12u + tlu) >> 1, (d12v + tlv) >> 1);
      put(top, 2 * x, yAt(top, 2 * x), (d03u + tu) >> 1, (d03v + tv) >> 1);
      if (bottom >= 0) {
        put(bottom, 2 * x - 1, yAt(bottom, 2 * x - 1), (d03u + lu) >> 1, (d03v + lv) >> 1);
        put(bottom, 2 * x, yAt(bottom, 2 * x), (d12u + cu) >> 1, (d12v + cv) >> 1);
      }
      tlu = tu;
      tlv = tv;
      lu = cu;
      lv = cv;
    }
    if (!(width & 1)) {
      put(top, width - 1, yAt(top, width - 1), (3 * tlu + lu + 2) >> 2, (3 * tlv + lv + 2) >> 2);
      if (bottom >= 0) put(bottom, width - 1, yAt(bottom, width - 1), (3 * lu + tlu + 2) >> 2, (3 * lv + tlv + 2) >> 2);
    }
  };
  line(0, -1, 0, 0);
  for (let y = 1; y + 1 < height; y += 2) line(y, y + 1, (y - 1) >> 1, (y + 1) >> 1);
  if (!(height & 1)) line(height - 1, -1, (height - 1) >> 1, (height - 1) >> 1);
  return out;
}
