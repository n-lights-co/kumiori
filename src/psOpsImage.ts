/**
 * psOpsImage — 画像の演算子 (§4.10: image・colorimage・imagemask) と、画像の辞書の読み方・標本の読み手・画素の展開 (paintImage)。
 * 展開した画素は DisplayItem (RGBA) として Graphics.items に積む
 */
import { invert, mul } from './matrix';
import { type Interp, type PSDict, type PSObj, PSError, arrItems, procSource, strBytes } from './psInterp';
import type { Graphics, Mat } from './psGraphics';
import { DEVICE_GRAY, DEVICE_RGB, DEVICE_CMYK, clamp01, type ColorSpace, type RGB } from './psColorSpace';
import { popMatrix } from './psOpsMatrix';
import type { ByteSource } from './psFilters';
import { PS_IMAGE_MAX_PIXELS, PS_TOTAL_IMAGE_PIXELS } from './imageLimits';

/** 画像の演算子を登録する */
export function installImageOperators(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  // 画像 (§4.10)
  d('image', (I) => {
    const top = I.ostack[I.ostack.length - 1];
    if (top && top.t === 'dict') return imageDict(I, G, I.popDict(), false);
    const src = I.pop();
    const m = popMatrix(I);
    const bpc = I.popInt();
    const h = I.popInt();
    const w = I.popInt();
    paintImage(I, G, { w, h, bpc, mat: m, sources: [src], multi: false, cs: DEVICE_GRAY, decode: [0, 1], interpolate: false });
  });
  d('colorimage', (I) => {
    const ncomp = I.popInt();
    const multi = I.popBool();
    const srcs: PSObj[] = [];
    for (let k = 0; k < (multi ? ncomp : 1); k++) srcs.push(I.pop());
    srcs.reverse();
    const m = popMatrix(I);
    const bpc = I.popInt();
    const h = I.popInt();
    const w = I.popInt();
    const cs = ncomp === 1 ? DEVICE_GRAY : ncomp === 3 ? DEVICE_RGB : ncomp === 4 ? DEVICE_CMYK : undefined;
    if (!cs) throw new PSError('rangecheck');
    paintImage(I, G, { w, h, bpc, mat: m, sources: srcs, multi, cs, decode: new Array(ncomp).fill([0, 1]).flat(), interpolate: false });
  });
  d('imagemask', (I) => {
    const top = I.ostack[I.ostack.length - 1];
    if (top && top.t === 'dict') return imageDict(I, G, I.popDict(), true);
    const src = I.pop();
    const m = popMatrix(I);
    const polarity = I.popBool();
    const h = I.popInt();
    const w = I.popInt();
    paintImage(I, G, { w, h, bpc: 1, mat: m, sources: [src], multi: false, cs: DEVICE_GRAY, decode: polarity ? [1, 0] : [0, 1], interpolate: false, mask: true });
  });
}

interface ImageSpec {
  w: number;
  h: number;
  bpc: number;
  mat: Mat;
  sources: PSObj[];
  multi: boolean;
  cs: ColorSpace;
  decode: number[];
  interpolate: boolean;
  mask?: boolean;
  /** 色で隠す (type 4 の MaskColor) */
  maskColor?: number[];
  /** 明示したマスク (type 3) */
  explicitMask?: { w: number; h: number; decode: number[]; source?: PSObj; interleave: number };
}

function imageDict(I: Interp, G: Graphics, dd: PSDict, mask: boolean) {
  const gi = (k: string, def?: number) => {
    const v = dd.get(k);
    if (!v) {
      if (def === undefined) throw new PSError('undefined');
      return def;
    }
    if (v.t !== 'int' && v.t !== 'real') throw new PSError('typecheck');
    return v.v;
  };
  const type = gi('ImageType', 1);
  if (type === 3) {
    const data = dd.get('DataDict');
    const md = dd.get('MaskDict');
    if (!data || data.t !== 'dict' || !md || md.t !== 'dict') throw new PSError('typecheck');
    const il = gi('InterleaveType');
    const mget = (k: string, def?: number) => {
      const v = md.d.get(k);
      if (!v) {
        if (def === undefined) throw new PSError('undefined');
        return def;
      }
      if (v.t !== 'int' && v.t !== 'real') throw new PSError('typecheck');
      return v.v;
    };
    const mdec = md.d.get('Decode');
    const spec = imageSpec(I, G, data.d, false);
    spec.explicitMask = {
      w: mget('Width'),
      h: mget('Height'),
      decode: mdec && mdec.t === 'array' ? arrItems(mdec).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0)) : [0, 1],
      source: md.d.get('DataSource'),
      interleave: il,
    };
    return paintImage(I, G, spec);
  }
  const spec = imageSpec(I, G, dd, mask);
  if (type === 4) {
    const mc = dd.get('MaskColor');
    if (mc && mc.t === 'array') spec.maskColor = arrItems(mc).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0));
  } else if (type !== 1) throw new PSError('rangecheck');
  paintImage(I, G, spec);
}

function imageSpec(_I: Interp, G: Graphics, dd: PSDict, mask: boolean): ImageSpec {
  const gi = (k: string, def?: number) => {
    const v = dd.get(k);
    if (!v) {
      if (def === undefined) throw new PSError('undefined');
      return def;
    }
    if (v.t !== 'int' && v.t !== 'real') throw new PSError('typecheck');
    return v.v;
  };
  const w = gi('Width');
  const h = gi('Height');
  const bpc = gi('BitsPerComponent', mask ? 1 : undefined);
  const im = dd.get('ImageMatrix');
  if (!im || im.t !== 'array' || im.n !== 6) throw new PSError('typecheck');
  const mat = arrItems(im).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0)) as Mat;
  const multiO = dd.get('MultipleDataSources');
  const multi = !!multiO && multiO.t === 'bool' && multiO.v;
  const ds = dd.get('DataSource');
  if (!ds) throw new PSError('undefined');
  const sources = multi && ds.t === 'array' ? arrItems(ds) : [ds];
  const cs = mask ? DEVICE_GRAY : G.g.cs.family === 'Pattern' ? DEVICE_GRAY : G.g.cs;
  const dec = dd.get('Decode');
  const decode = dec && dec.t === 'array' ? arrItems(dec).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0)) : cs.family === 'Indexed' ? [0, (1 << bpc) - 1] : new Array(cs.ncomp).fill([0, 1]).flat();
  const interp = dd.get('Interpolate');
  return { w, h, bpc, mat, sources, multi, cs, decode, interpolate: !!interp && interp.t === 'bool' && interp.v, mask };
}

/** データの元 (文字列は繰り返し使う。§4.10.2) */
function dataReader(I: Interp, src: PSObj): ByteSource {
  if (src.t === 'string') {
    const b = strBytes(src).slice();
    let i = 0;
    return { read: () => (b.length ? b[i++ % b.length] : -1) };
  }
  if (src.t === 'file') {
    const f = src.f;
    return { read: () => f.read(), jpeg: (f.src as ByteSource).jpeg };
  }
  return procSource(I, src);
}

function paintImage(I: Interp, G: Graphics, s: ImageSpec) {
  const { w, h, bpc } = s;
  // Width・Height は整数 (PLRM 第 3 版 §4.10.5 の表 4.20。値が整数の実数 100.0 は通す)。辞書の形は実数も受け取るので、ここで確かめる:
  // Width 2.4e10・Height 0.001 のように、積 (画素の数) は上限の内でも、1 行が何 GB にもなる寸法を通さない
  if (!Number.isInteger(w) || !Number.isInteger(h)) throw new PSError('typecheck');
  if (w <= 0 || h <= 0) return;
  if (![1, 2, 4, 8, 12, 16].includes(bpc)) throw new PSError('rangecheck');
  if (w * h > PS_IMAGE_MAX_PIXELS) throw new PSError('limitcheck');
  // 画像の画素は重いので、手間として数える (64 画素で 1 ステップ)。文書の中の画像の画素の合計にも上限を置く
  // (同じ大きな画像を何度も描くループで、時間とメモリを使い切らない)
  I.charge((w * h) / 64);
  G.imagePixels = (G.imagePixels ?? 0) + w * h;
  if (G.imagePixels > PS_TOTAL_IMAGE_PIXELS) throw new PSError('limitcheck');
  // 明示したマスク (Type 3 の画像の MaskDict。§4.10.6) の寸法にも、画像と同じ上限と手間を当てる。
  // マスクの寸法は画像と別に指定でき (InterleaveType 1 は画像と同じ、2 は行の数が整数倍、3 は別の元で寸法も自由)、
  // マスクの画素ごとにループと確保をする
  const em0 = s.explicitMask;
  if (em0) {
    if (em0.w * em0.h > PS_IMAGE_MAX_PIXELS) throw new PSError('limitcheck');
    I.charge((em0.w * em0.h) / 64);
  }
  G.countItem();
  const inv = invert(s.mat);
  if (!inv) throw new PSError('undefinedresult');
  const mat = mul(G.g.ctm, inv);
  const ncomp = s.mask ? 1 : s.cs.ncomp;
  const readers = s.sources.map((x) => dataReader(I, x));
  // JPEG をそのまま使えるのは、DCTDecode のファイルから 1 つの元で読む、Decode が既定の DeviceGray・DeviceRGB の画像
  const jp = readers[0].jpeg;
  if (jp && !s.multi && !s.mask && !s.explicitMask && !s.maskColor && bpc === 8 && (s.cs.family === 'DeviceGray' || s.cs.family === 'DeviceRGB') && isDefaultDecode(s.decode)) {
    G.emit({ k: 'image', width: w, height: h, jpeg: jp(), mat, interpolate: s.interpolate, clip: G.g.clip });
    return;
  }
  if (jp) I.warn('JPEG の画像 (CMYK など)');
  // 画素 (RGBA) は、メモリの合計の勘定に積む (PS_MAX_MEMORY_BYTES。JPEG のまま持つ画像は、読みためた分を VM に積んである)
  I.memAlloc(w * h * 4);
  const rgba = new Uint8Array(w * h * 4);
  const maxv = (1 << bpc) - 1;
  // 1 行の成分を読む
  const rowBits = (n: number) => Math.ceil((w * n * bpc) / 8);
  const readRow = (rd: ByteSource, n: number, out: Uint8Array): boolean => {
    for (let k = 0; k < out.length; k++) {
      const c = rd.read();
      if (c < 0) return false;
      out[k] = c;
    }
    void n;
    return true;
  };
  const sample = (row: Uint8Array, i: number): number => {
    if (bpc === 8) return row[i];
    if (bpc === 16) return (row[i * 2] << 8) | row[i * 2 + 1];
    if (bpc === 12) {
      const bit = i * 12;
      const byte = bit >> 3;
      return bit & 7 ? ((row[byte] & 15) << 8) | row[byte + 1] : (row[byte] << 4) | (row[byte + 1] >> 4);
    }
    const bit = i * bpc;
    return (row[bit >> 3] >> (8 - bpc - (bit & 7))) & maxv;
  };
  const dec = s.decode;
  const fastGray = !s.mask && s.cs.family === 'DeviceGray';
  const fastRGB = !s.mask && s.cs.family === 'DeviceRGB';
  const fastCMYK = !s.mask && s.cs.family === 'DeviceCMYK';
  // 型紙 (imagemask) を None の色で塗るときは何も描かない (§4.8.4)
  if (s.mask && G.invisible()) {
    for (let y = 0; y < h; y++) for (const rd of readers) for (let k = 0; k < Math.ceil(w / 8); k++) rd.read();
    return;
  }
  const maskRGB = s.mask ? G.currentRGB() : undefined;
  const colorCache = new Map<string, RGB>();
  // 明示したマスク (interleave 1: 標本ごとに、マスクの成分が色の前に付く)。
  // マスクの極性は imagemask と同じ: MaskDict の Decode で復号した値が 0 の標本の所を描き、1 の所は描かない
  // (PLRM §4.10.6 Explicit Masking の表 4.24 の Decode)。Decode [0 1] (既定) なら標本の 0 を、[1 0] なら 1 を描く
  const il = s.explicitMask?.interleave;
  const maskOne = s.explicitMask?.decode[0] === 1;
  const compsInRow = ncomp + (il === 1 ? 1 : 0);
  const single = new Uint8Array(rowBits(compsInRow));
  const multiRows = s.multi ? readers.map(() => new Uint8Array(rowBits(1))) : [];
  let maskAlpha: Uint8Array | undefined;
  if (s.explicitMask && il === 3 && s.explicitMask.source) maskAlpha = readMask(I, s.explicitMask.w, s.explicitMask.h, s.explicitMask.source, s.explicitMask.decode);
  const em = s.explicitMask;
  let maskRowBuf: Uint8Array | undefined;
  if (em && il === 2) maskRowBuf = new Uint8Array(Math.ceil(em.w / 8));
  const ratio = em && il === 2 ? Math.max(1, Math.round(h / em.h)) : 1;
  const mratio = em && il === 2 ? Math.max(1, Math.round(em.h / h)) : 1;
  let curMask: Uint8Array | undefined;
  for (let y = 0; y < h; y++) {
    if (em && il === 2 && maskRowBuf) {
      // 行ごとの組: マスクの行のあとに画像の行 (§4.10.6 interleave 2)
      if (y % ratio === 0) {
        for (let r = 0; r < mratio; r++) if (!readRow(readers[0], 1, maskRowBuf)) break;
        curMask = maskRowBuf.slice();
      }
    }
    let ok: boolean;
    if (s.multi) {
      ok = true;
      for (let k = 0; k < readers.length; k++) ok = readRow(readers[k], 1, multiRows[k]) && ok;
    } else ok = readRow(readers[0], compsInRow, single);
    if (!ok) break;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const comps: number[] = [];
      let alpha = 255;
      if (s.multi) for (let k = 0; k < ncomp; k++) comps.push(sample(multiRows[k], x));
      else {
        const base = x * compsInRow;
        if (il === 1) {
          // マスクの成分は画像と同じビット数で、全部のビットが 0 か 1。ほかの値は 1 として扱う (表 4.22 の InterleaveType 1)
          if ((sample(single, base) !== 0) !== maskOne) alpha = 0;
          for (let k = 0; k < ncomp; k++) comps.push(sample(single, base + 1 + k));
        } else for (let k = 0; k < ncomp; k++) comps.push(sample(single, base + k));
      }
      if (curMask && em) {
        const mx = Math.min(em.w - 1, Math.floor((x * em.w) / w));
        const bit = (curMask[mx >> 3] >> (7 - (mx & 7))) & 1;
        const paint = maskOne ? bit === 1 : bit === 0;
        if (!paint) alpha = 0;
      }
      if (maskAlpha && em) {
        const mx = Math.min(em.w - 1, Math.floor((x * em.w) / w));
        const my = Math.min(em.h - 1, Math.floor((y * em.h) / h));
        alpha = maskAlpha[my * em.w + mx];
      }
      if (s.maskColor) {
        const mc = s.maskColor;
        let hit = true;
        for (let k = 0; k < comps.length && hit; k++) {
          const lo = mc.length === comps.length ? mc[k] : mc[k * 2];
          const hi = mc.length === comps.length ? mc[k] : mc[k * 2 + 1];
          hit = comps[k] >= lo && comps[k] <= hi;
        }
        if (hit) alpha = 0;
      }
      if (s.mask) {
        // 型紙 (imagemask): polarity が true (decode が [1 0]) なら標本の 1 を、false (decode が [0 1]) なら 0 を塗る
        // (§8.2 の imagemask・§4.10.6 Stencil Masking)
        const v = comps[0];
        const paint = dec[0] === 1 ? v !== 0 : v === 0;
        if (paint) {
          rgba[o] = maskRGB![0] * 255;
          rgba[o + 1] = maskRGB![1] * 255;
          rgba[o + 2] = maskRGB![2] * 255;
          rgba[o + 3] = 255;
        }
        continue;
      }
      const cv = comps.map((v, k) => dec[k * 2] + (v * (dec[k * 2 + 1] - dec[k * 2])) / maxv);
      let rgb: RGB;
      if (fastGray) rgb = [clamp01(cv[0]), clamp01(cv[0]), clamp01(cv[0])];
      else if (fastRGB) rgb = [clamp01(cv[0]), clamp01(cv[1]), clamp01(cv[2])];
      else if (fastCMYK) rgb = G.toRGB(DEVICE_CMYK, cv);
      else {
        const key = comps.join(',');
        let c = colorCache.get(key);
        if (!c) {
          c = G.toRGB(s.cs, cv);
          if (colorCache.size < 100000) colorCache.set(key, c);
        }
        rgb = c;
      }
      rgba[o] = Math.round(rgb[0] * 255);
      rgba[o + 1] = Math.round(rgb[1] * 255);
      rgba[o + 2] = Math.round(rgb[2] * 255);
      rgba[o + 3] = alpha;
    }
  }
  G.emit({ k: 'image', width: w, height: h, rgba, mat, interpolate: s.interpolate, clip: G.g.clip });
}

function isDefaultDecode(d: number[]): boolean {
  for (let k = 0; k < d.length; k += 2) if (d[k] !== 0 || d[k + 1] !== 1) return false;
  return true;
}

/** type 3 の画像の別の元のマスクを読む (1 ビット)。描く所は 255 */
function readMask(I: Interp, w: number, h: number, src: PSObj, decode: number[]): Uint8Array {
  const rd = dataReader(I, src);
  I.memAlloc(w * h);
  const out = new Uint8Array(w * h);
  const rb = Math.ceil(w / 8);
  const row = new Uint8Array(rb);
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < rb; k++) {
      const c = rd.read();
      if (c < 0) return out;
      row[k] = c;
    }
    for (let x = 0; x < w; x++) {
      const bit = (row[x >> 3] >> (7 - (x & 7))) & 1;
      // imagemask と同じ極性: Decode [0 1] は標本の 0 を、[1 0] は 1 を描く
      const paint = decode[0] === 1 ? bit === 1 : bit === 0;
      out[y * w + x] = paint ? 255 : 0;
    }
  }
  return out;
}
