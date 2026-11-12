import { describe, expect, it } from 'vitest';
import { cgmToSvg } from '../src/cgm';
import { metafileSvgBudget } from '../src/imageLimits';
import { decodeJpeg } from '../src/jpeg';
import { emfToSvg, wmfToSvg } from '../src/metafile';
import { decodeBmp } from '../src/pixels';
import { deflateSync } from 'node:zlib';

/**
 * 脆弱性検査の残り (メタファイル・CGM・JPEG・BMP): 小さな記録が大きな SVG を何度も書かせる入力、記録ごとに領域の全部を演算させる入力、
 * 走査ごとに全部の区画をたどらせる JPEG が、上限で止まり、すぐ終わる。止まることは、結果と vitest の制限時間で確かめる
 */

const T = { timeout: 30_000 };

const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
};

// ───────────── WMF ─────────────

/** WMF の記録 (大きさは 2 バイトの語の数) */
const wrec = (fn: number, params: Uint8Array) => {
  const b = new Uint8Array(6 + params.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, b.length / 2, true);
  v.setUint16(4, fn, true);
  b.set(params, 6);
  return b;
};
const u16s = (...a: number[]) => {
  const b = new Uint8Array(a.length * 2);
  const v = new DataView(b.buffer);
  a.forEach((x, k) => v.setUint16(k * 2, x & 0xffff, true));
  return b;
};
/** 置き場所の頭 (1000 × 1000、96 単位/インチ) と WMF の頭 */
const wmfHead = () => {
  const p = new Uint8Array(22);
  const v = new DataView(p.buffer);
  v.setUint32(0, 0x9ac6cdd7, true);
  v.setInt16(10, 1000, true);
  v.setInt16(12, 1000, true);
  v.setUint16(14, 96, true);
  const h = new Uint8Array(18);
  const w = new DataView(h.buffer);
  w.setUint16(0, 1, true);
  w.setUint16(2, 9, true);
  w.setUint16(4, 0x300, true);
  return cat(p, h);
};
/** META_CREATEREGION ([MS-WMF] 2.2.1.5): 走査線の並び (上, 下, [左, 右]…) */
const createRegion = (scans: [number, number, number[]][]) => {
  const rh = new Uint8Array(22);
  new DataView(rh.buffer).setInt16(10, scans.length, true);
  const parts = scans.map(([t, b, xs]) => u16s(xs.length, t, b, ...xs, xs.length));
  return wrec(0x06ff, cat(rh, ...parts));
};
const WMF_EOF = wrec(0, new Uint8Array(0));

describe('WMF・EMF: 小さな記録が大きな SVG を何度も書かせる入力', () => {
  it('矩形の多い Region を PAINTREGION で何度も塗る: SVG の長さは上限まで、警告を出す', T, () => {
    // 走査線 1 本に 2,500 個の矩形。PAINTREGION (8 バイト) を 1,250 回 (直す前は SVG が 9,700 万字・72 秒)
    const xs: number[] = [];
    for (let k = 0; k < 2500; k++) xs.push(30000 + 2 * k, 30001 + 2 * k);
    const paints = Array.from({ length: 1250 }, () => wrec(0x012b, u16s(0)));
    const b = cat(wmfHead(), createRegion([[60000, 60001, xs]]), ...paints, WMF_EOF);
    const warnings: string[] = [];
    const svg = wmfToSvg(b, undefined, undefined, warnings)!;
    expect(svg.length).toBeLessThanOrEqual(metafileSvgBudget(b.length) + 10_000);
    expect(warnings.some((w) => w.includes('上限'))).toBe(true);
  });

  it('矩形の多い切り抜きに、全体を覆う INTERSECTCLIPRECT を繰り返す: すぐ終わり、切り抜きは変わらない', T, () => {
    // 走査線 3,000 本の Region を切り抜きにして、全体を覆う INTERSECTCLIPRECT (14 バイト) を 1,000 回 (直す前は 120 秒超)
    const scans: [number, number, number[]][] = Array.from({ length: 3000 }, (_, k) => [2 * k, 2 * k + 1, [10, 20]]);
    const isect = wrec(0x0416, u16s(32000, 32000, 0xffff, 0xffff));
    const draw = wrec(0x041b, u16s(100, 100, 0, 0));
    const once = wmfToSvg(cat(wmfHead(), createRegion(scans), wrec(0x012c, u16s(0)), isect, draw, WMF_EOF))!;
    const many = wmfToSvg(cat(wmfHead(), createRegion(scans), wrec(0x012c, u16s(0)), ...Array.from({ length: 1000 }, () => isect), draw, WMF_EOF))!;
    expect(many).toBe(once);
  });

  it('領域の演算 (走査線で解く): 2 つの矩形の領域と矩形の AND・DIFF', () => {
    // 領域 {x 0〜10, x 20〜30} × y 0〜10 を切り抜きにして、x 5〜25 との AND (INTERSECTCLIPRECT) と DIFF (EXCLUDECLIPRECT)
    const region = createRegion([[0, 10, [0, 10, 20, 30]]]);
    const draw = wrec(0x041b, u16s(10, 30, 0, 0));
    const and = wmfToSvg(cat(wmfHead(), region, wrec(0x012c, u16s(0)), wrec(0x0416, u16s(10, 25, 0, 5)), draw, WMF_EOF))!;
    const diff = wmfToSvg(cat(wmfHead(), region, wrec(0x012c, u16s(0)), wrec(0x0415, u16s(10, 25, 0, 5)), draw, WMF_EOF))!;
    const clipOf = (svg: string) => /<clipPath id="kmMfRgn\d+"><path d="([^"]*)"/.exec(svg)?.[1];
    expect(clipOf(and)).toBe('M5 0H10V10H5ZM20 0H25V10H20Z');
    expect(clipOf(diff)).toBe('M0 0H5V10H0ZM25 0H30V10H25Z');
  });
});

// ───────────── EMF ─────────────

const emfHead = () => {
  const h = new Uint8Array(88);
  const v = new DataView(h.buffer);
  v.setUint32(0, 1, true);
  v.setUint32(4, 88, true);
  v.setInt32(16, 1000, true);
  v.setInt32(20, 1000, true);
  v.setInt32(32, 10000, true);
  v.setInt32(36, 10000, true);
  v.setUint32(40, 0x464d4520, true);
  v.setInt32(72, 1000, true);
  v.setInt32(76, 1000, true);
  v.setInt32(80, 300, true);
  v.setInt32(84, 300, true);
  return h;
};
const erec = (type: number, ints: number[], extra = new Uint8Array(0)) => {
  const b = new Uint8Array(8 + ints.length * 4 + extra.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, type, true);
  v.setUint32(4, b.length, true);
  ints.forEach((x, k) => v.setInt32(8 + k * 4, x | 0, true));
  b.set(extra, 8 + ints.length * 4);
  return b;
};
const EMF_EOF = erec(14, [0, 0, 20]);

describe('EMF', () => {
  it('EMR_GRADIENTFILL の三角形の多いもの: 分け方を粗くして、SVG の長さは上限の内', T, () => {
    // 三角形 4,000 個 (48KB。直す前は SVG が 3,100 万字・61 秒)
    const n = 4000;
    const vtx = (x: number, y: number, r: number, g: number, bl: number) => {
      const o = new Uint8Array(16);
      const v = new DataView(o.buffer);
      v.setInt32(0, x, true);
      v.setInt32(4, y, true);
      v.setUint16(8, r << 8, true);
      v.setUint16(10, g << 8, true);
      v.setUint16(12, bl << 8, true);
      return o;
    };
    const tri = new Uint8Array(n * 12);
    const tv = new DataView(tri.buffer);
    for (let k = 0; k < n; k++) {
      tv.setUint32(k * 12 + 4, 1, true);
      tv.setUint32(k * 12 + 8, 2, true);
    }
    const head = new Uint8Array(28);
    const hv = new DataView(head.buffer);
    hv.setUint32(16, 3, true);
    hv.setUint32(20, n, true);
    hv.setUint32(24, 2, true);
    const body = cat(head, vtx(0, 0, 255, 0, 0), vtx(1000, 0, 0, 255, 0), vtx(0, 1000, 0, 0, 255), tri);
    const b = cat(emfHead(), erec(118, [], body), EMF_EOF);
    const warnings: string[] = [];
    const svg = emfToSvg(b, undefined, undefined, warnings)!;
    expect(svg.length).toBeLessThanOrEqual(metafileSvgBudget(b.length));
    expect(warnings.some((w) => w.includes('粗く'))).toBe(true);
  });

  it('小さなパスを SELECTCLIPPATH の OR で切り抜きに足し続ける: 演算の手間の上限で止まる', T, () => {
    // 2,000 回の XOR (104KB。直す前は 18 秒。手間はファイルの大きさの 2 乗)
    const parts = [emfHead()];
    for (let k = 0; k < 2000; k++) {
      const x = (k % 100) * 10;
      const y = Math.floor(k / 100) * 10;
      parts.push(erec(59, []), erec(43, [x, y, x + 7, y + 7]), erec(60, []), erec(67, [k === 0 ? 5 : 3]));
    }
    parts.push(erec(43, [0, 0, 1000, 1000]), EMF_EOF);
    const warnings: string[] = [];
    const t = performance.now();
    expect(emfToSvg(cat(...parts), undefined, undefined, warnings)).toBeDefined();
    expect(performance.now() - t).toBeLessThan(15_000);
    expect(warnings.some((w) => w.includes('切り抜きのパスの演算'))).toBe(true);
  });

  it('パスの切り抜きの OR が少ないものは、上限に届かず、そのまま演算する', () => {
    const parts = [emfHead()];
    for (let k = 0; k < 20; k++) parts.push(erec(59, []), erec(43, [k * 40, 0, k * 40 + 20, 20]), erec(60, []), erec(67, [k === 0 ? 5 : 2]));
    parts.push(erec(43, [0, 0, 1000, 1000]), EMF_EOF);
    const warnings: string[] = [];
    const svg = emfToSvg(cat(...parts), undefined, undefined, warnings)!;
    expect(warnings).toEqual([]);
    expect(svg).toContain('clip-path');
  });
});

// ───────────── CGM ─────────────

/** CGM の要素 (2 進符号化。ISO/IEC 8632-3 の 5 章)。長いものは分けた形 */
const cmd = (cls: number, id: number, data: number[] = []): number[] => {
  const out: number[] = [];
  if (data.length < 31) {
    const h = (cls << 12) | (id << 5) | data.length;
    out.push(h >> 8, h & 0xff, ...data);
    if (data.length % 2) out.push(0);
    return out;
  }
  const h = (cls << 12) | (id << 5) | 31;
  out.push(h >> 8, h & 0xff);
  for (let o = 0; o < data.length; o += 32766) {
    const part = data.slice(o, o + 32766);
    const w = part.length | (o + 32766 >= data.length ? 0 : 0x8000);
    out.push(w >> 8, w & 0xff);
    for (const x of part) out.push(x);
    if (part.length % 2) out.push(0);
  }
  return out;
};
const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
const i32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
const str = (t: string) => [t.length, ...Array.from(t, (c) => c.charCodeAt(0))];
const cgm = (body: number[]) => new Uint8Array([...cmd(0, 1, str('t')), ...cmd(0, 3, str('p')), ...cmd(2, 6, i16(0, 0, 100, 100)), ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);

describe('CGM', () => {
  it('点の多いセグメントを COPY SEGMENT で何度も写す: SVG の長さは上限まで、警告を出す', T, () => {
    // 4,000 点の POLYLINE のセグメントを 700 回写す (33KB。直す前は 18 秒・1.2GB)
    const pts: number[] = [];
    for (let k = 0; k < 4000; k++) pts.push(...i16((k * 37) % 100, (k * 53) % 100));
    const body = [...cmd(0, 6, i16(1)), ...cmd(4, 1, pts), ...cmd(0, 7)];
    const copy = cmd(8, 1, [...i16(1), ...i32(0x10000, 0, 0, 0x10000), ...i16(0, 0)]);
    for (let k = 0; k < 700; k++) body.push(...copy);
    const b = cgm(body);
    const r = cgmToSvg(b)!;
    expect(r.svg.length).toBeLessThanOrEqual(metafileSvgBudget(b.length) + 10_000);
    expect(r.warnings.some((w) => w.includes('上限'))).toBe(true);
  });

  it('写す回数の少ないセグメントは、全部を描く', () => {
    const body = [...cmd(0, 6, i16(1)), ...cmd(4, 1, i16(0, 0, 50, 50, 100, 0)), ...cmd(0, 7)];
    const copy = cmd(8, 1, [...i16(1), ...i32(0x10000, 0, 0, 0x10000), ...i16(0, 0)]);
    for (let k = 0; k < 5; k++) body.push(...copy);
    const r = cgmToSvg(cgm(body))!;
    expect(r.warnings).toEqual([]);
    expect(r.svg.split('<path').length - 1).toBe(6);
  });

  it('deflate で縮めた 1 ビットのタイル: セルの色を画素にじかに書く (色は 0 番と 1 番の交互)', T, () => {
    // 2000 × 2000 のタイル (直す前は、セルごとに色のオブジェクトを作り、8000 × 8000 で 52 秒・3GB)
    const w = 2000;
    const h = 2000;
    const begin = cmd(0, 19, [...i16(0, 0, 0, 0, 1, 1, w, h), ...i32(0x10000, 0x10000), ...i16(0, 0, w, h)]);
    const bs = [...deflateSync(new Uint8Array(Math.ceil(w / 8) * h).fill(0x55), { level: 9 })];
    const tile = cmd(4, 29, [...i16(9, 0, 1), 0, ...bs]);
    const pad = Math.ceil((w * h - 262144) / 1024) + 200 - bs.length;
    const noop: number[] = [];
    for (let n = pad; n > 0; n -= 30000) noop.push(...cmd(0, 0, new Array(Math.min(n, 30000)).fill(0)));
    const r = cgmToSvg(cgm([...begin, ...tile, ...cmd(0, 20), ...noop]))!;
    expect(r.warnings).toEqual([]);
    const m = /base64,([A-Za-z0-9+/=]+)/.exec(r.svg)!;
    const png = Buffer.from(m[1], 'base64');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
  });
});

// ───────────── JPEG ─────────────

describe('JPEG', () => {
  /** 漸進の JPEG (1 成分): AC の続く走査 (Ss=1・Se=63・Ah=1) を scans 個。走査のデータは EOBRUN の符号だけ */
  const refineScans = (X: number, Y: number, scans: number) => {
    const seg = (m: number, data: number[]) => [0xff, m, (data.length + 2) >> 8, (data.length + 2) & 255, ...data];
    const blocks = Math.ceil(X / 8) * Math.ceil(Y / 8);
    const scanBytes = Math.ceil((Math.ceil(blocks / 16384) * 15) / 8) + 4;
    const one = [...seg(0xda, [1, 1, 0x00, 1, 63, 0x10]), ...new Array(scanBytes).fill(0)];
    const out = [0xff, 0xd8, ...seg(0xdb, [0, ...new Array(64).fill(1)]), ...seg(0xc2, [8, Y >> 8, Y & 255, X >> 8, X & 255, 1, 1, 0x11, 0]), ...seg(0xc4, [0x10, 1, ...new Array(15).fill(0), 0xe0])];
    for (let k = 0; k < scans; k++) out.push(...one);
    out.push(0xff, 0xd9);
    return new Uint8Array(out);
  };

  it('EOBRUN だけの続く走査を 500 個並べたもの: たどる区画の合計の上限で、読めない画像にする', T, () => {
    // 1000 × 1000 (区画 15,625) で 500 個 (直す前は、区画ごとに 63 個の係数を調べて、2600 × 2600 で 13 秒)
    const t = performance.now();
    expect(decodeJpeg(refineScans(1000, 1000, 500))).toBeUndefined();
    expect(performance.now() - t).toBeLessThan(5_000);
  });

  it('続く走査の少ないもの (10 個) は読める', () => {
    const px = decodeJpeg(refineScans(64, 64, 10));
    expect(px?.width).toBe(64);
    expect(px?.height).toBe(64);
  });
});

// ───────────── BMP ─────────────

describe('BMP: 画素を RGBA にじかに書く (結果は前と同じ)', () => {
  const bmp = (bpp: number, w: number, h: number, data: number[], opts: { masks?: number[]; pal?: number[][]; hs?: number } = {}) => {
    const hs = opts.hs ?? 40;
    const pal = (opts.pal ?? []).flatMap(([r, g, b]) => [b, g, r, 0]);
    const head = new Uint8Array(hs + (opts.masks && hs === 40 ? 12 : 0));
    const v = new DataView(head.buffer);
    v.setUint32(0, hs, true);
    v.setInt32(4, w, true);
    v.setInt32(8, h, true);
    v.setUint16(12, 1, true);
    v.setUint16(14, bpp, true);
    v.setUint32(16, opts.masks ? 3 : 0, true);
    // biClrUsed: 色の表の項の数
    v.setUint32(32, opts.pal?.length ?? 0, true);
    opts.masks?.forEach((m, k) => (hs > 40 || k < 3) && v.setUint32(40 + k * 4, m, true));
    const off = 14 + head.length + pal.length;
    const f = new Uint8Array(off + data.length);
    const fv = new DataView(f.buffer);
    f[0] = 0x42;
    f[1] = 0x4d;
    fv.setUint32(2, f.length, true);
    fv.setUint32(10, off, true);
    f.set(head, 14);
    f.set(pal, 14 + head.length);
    f.set(data, off);
    return f;
  };

  it('16 ビットの 5-6-5 のビットフィールド', () => {
    // 1 × 1: 0xf800 (赤いっぱい)、行は 4 バイトに揃える
    const px = decodeBmp(bmp(16, 1, 1, [0x00, 0xf8, 0, 0], { masks: [0xf800, 0x7e0, 0x1f] }))!;
    expect([...px.rgba]).toEqual([255, 0, 0, 255]);
  });

  it('32 ビットの α のマスク付き (V4 の頭)', () => {
    const px = decodeBmp(bmp(32, 1, 1, [0x10, 0x20, 0x30, 0x80], { masks: [0xff0000, 0xff00, 0xff, 0xff000000], hs: 108 }))!;
    expect([...px.rgba]).toEqual([0x30, 0x20, 0x10, 0x80]);
  });

  it('4 ビットの色の表 (表に無い番号は黒)、下から上の行', () => {
    // 2 × 2: 下の行 [1, 2]、上の行 [0, 5]。表は 3 色
    const px = decodeBmp(bmp(4, 2, 2, [0x12, 0, 0, 0, 0x05, 0, 0, 0], { pal: [[1, 2, 3], [10, 20, 30], [40, 50, 60]] }))!;
    expect([...px.rgba]).toEqual([1, 2, 3, 255, 0, 0, 0, 255, 10, 20, 30, 255, 40, 50, 60, 255]);
  });
});
