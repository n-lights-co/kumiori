/**
 * 大きな画像の重さの修正 (IMG-21・IMG-22・PS-20) が、結果を変えないことの確かめ。
 *  - バイト列の展開 (inflateFast.ts) は、node の zlib と同じものを出す。壊れた所・上限までを返す
 *  - 無圧縮の PNG (encodePngStored) は、正しい CRC・Adler-32 を持つ
 *  - 不透明の画像の PNG (encodePng) は RGB、α のある画像は RGBA
 *  - PDF に入れるための PNG の展開 (decodePngForPdf) は、pdf-lib の展開と同じ RGB・α を出す。PDF の画像も同じになる
 *  - base64 の読み (fromBase64) は、atob と同じものを受け付け、同じものを誤りにする
 *  - PostScript の image のよくある形の速い道は、一般の形と同じ式の値を出す
 * 時間そのものは測らない (環境で変わる)
 */
import { describe, expect, it } from 'vitest';
import { constants, crc32, deflateRawSync, deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { PNG } from 'pdf-lib/cjs/utils/png';
import { inflateFast, inflatedLength } from '../src/inflateFast';
import { inflate } from '../src/psFilters';
import { decodePngForPdf, encodePng, encodePngStored, pngDataComplete } from '../src/pixels';
import { embedPngChecked } from '../src/pdfLibPatches';
import { fromBase64 } from '../src/base64';
import { latin1 } from '../src/psInterp';
import { runEps } from '../src/eps';

/** 決まった種から作る、圧縮の効き方の違うバイト列 */
function bytes(n: number, seed: number): Uint8Array {
  const a = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    a[i] = ((x >>> 16) % ((seed % 7) + 2)) + (i % 50 === 0 ? x & 255 : 0);
  }
  return a;
}

/** PostScript のフィルタの inflate (1 バイトずつ読む形) で、展開できたバイトの数 */
function filterLength(z: Uint8Array): number {
  let i = 0;
  const f = inflate({ read: () => (i < z.length ? z[i++] : -1) });
  let n = 0;
  try {
    while (f.read() >= 0) n++;
  } catch {
    /* 壊れた所まで */
  }
  return n;
}

describe('バイト列の展開 (inflateFast)', () => {
  it('zlib・頭の無い deflate・固定の符号・無圧縮のブロックを、node の zlib と同じに展開する', () => {
    for (let s = 1; s < 30; s++) {
      const d = bytes(s * 7001, s);
      const forms = [
        deflateSync(d, { level: s % 10 }),
        deflateRawSync(d),
        deflateSync(d, { strategy: constants.Z_FIXED }),
        deflateSync(d, { strategy: constants.Z_HUFFMAN_ONLY }),
        deflateSync(d, { strategy: constants.Z_RLE }),
        deflateSync(d, { level: 0 }),
      ];
      for (const z of forms) {
        expect(Buffer.from(inflateFast(z)).equals(Buffer.from(d))).toBe(true);
        expect(inflatedLength(z)).toBe(d.length);
        // 上限で切る
        expect(Buffer.from(inflateFast(z, 1000)).equals(Buffer.from(d.subarray(0, 1000)))).toBe(true);
        expect(inflatedLength(z, 1000)).toBe(1000);
        // 途中で切れたデータ: 展開できた所までの、元の頭の部分 (フィルタの inflate より短くならない)
        const cut = z.subarray(0, z.length >> 1);
        const t = inflateFast(cut);
        expect(Buffer.from(t).equals(Buffer.from(d.subarray(0, t.length)))).toBe(true);
        expect(inflatedLength(cut)).toBe(t.length);
        expect(t.length).toBeGreaterThanOrEqual(filterLength(cut));
      }
    }
  });
  it('壊れたデータ (知らないブロックの型・出力の始まりより前を指す距離・空) で投げずに止まる', () => {
    expect(inflateFast(Uint8Array.from([0x78, 0x9c, 0x07]))).toEqual(new Uint8Array(0));
    // 固定の符号のブロックで、最初の記号が距離 1 の繰り返し (出力が空なので前を指せない)
    const bad = deflateRawSync(Uint8Array.from([5, 5, 5, 5, 5, 5]), { strategy: constants.Z_FIXED });
    expect(inflateFast(bad)).toEqual(Uint8Array.from([5, 5, 5, 5, 5, 5]));
    expect(inflateFast(new Uint8Array(0))).toEqual(new Uint8Array(0));
    expect(inflateFast(Uint8Array.from([0xff, 0xff, 0xff, 0xff])).length).toBeLessThan(1 << 16);
  });
});

/** PNG のチャンクを読む */
function chunks(png: Uint8Array): { type: string; data: Uint8Array; crc: number }[] {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const len = dv.getUint32(at);
    out.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), data: png.subarray(at + 8, at + 8 + len), crc: dv.getUint32(at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

describe('画素の PNG (encodePngStored・encodePng)', () => {
  it('無圧縮の PNG: チャンクの CRC と zlib の Adler-32 が正しく、走査線は元の画素 (ブロックの切れ目をまたぐ行も)', () => {
    for (const [w, h] of [[1, 1], [3, 7], [200, 300], [16384, 3], [16383, 5]]) {
      const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37 + (i >> 9)) & 255);
      const png = encodePngStored({ width: w, height: h, rgba });
      for (const c of chunks(png)) expect(c.crc).toBe(crc32(Buffer.concat([Buffer.from(c.type, 'latin1'), c.data])));
      // inflateSync は Adler-32 を確かめる
      const raw = inflateSync(chunks(png).find((c) => c.type === 'IDAT')!.data);
      expect(raw.length).toBe((w * 4 + 1) * h);
      for (let y = 0; y < h; y++) {
        expect(raw[y * (w * 4 + 1)]).toBe(0);
        expect(Buffer.from(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))).equals(Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)))).toBe(true);
      }
      expect(pngDataComplete(png)).toBe(true);
    }
  });
  it('不透明の画像は RGB (色の型 2)、α のある画像は RGBA (色の型 6)。どちらも画素は元のまま', async () => {
    const w = 31;
    const h = 17;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 11) & 255));
    const opaque = await encodePng({ width: w, height: h, rgba });
    expect(chunks(opaque)[0].data[9]).toBe(2);
    const translucent = rgba.slice();
    translucent[3] = 10;
    const withAlpha = await encodePng({ width: w, height: h, rgba: translucent });
    expect(chunks(withAlpha)[0].data[9]).toBe(6);
    const a = PNG.load(opaque);
    const b = PNG.load(withAlpha);
    expect(Buffer.from(a.rgbChannel).equals(Buffer.from(b.rgbChannel))).toBe(true);
    expect(a.alphaChannel).toBeUndefined();
    expect(b.alphaChannel![0]).toBe(10);
  });
});

/** フィルタの種類を行ごとに変えて (0〜4)、8 ビットの灰と α (ch 2)・RGBA (ch 4) の PNG を作る (PNG の仕様 §9) */
function filteredPng(w: number, h: number, ch: 2 | 4, px: Uint8Array, seed: number, idatParts = 2): Uint8Array {
  const stride = w * ch;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = (y * 7 + seed) % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const at = y * stride + i;
      const a = i >= ch ? px[at - ch] : 0;
      const b = y ? px[at - stride] : 0;
      const c = y && i >= ch ? px[at - stride - ch] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + i] = (px[at] - p) & 255;
    }
  }
  const chunk = (t: string, d: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(d.length, 0);
    head.write(t, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), d])), 0);
    return Buffer.concat([head, d, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, ch === 4 ? 6 : 4, 0, 0, 0], 8);
  const z = deflateSync(raw);
  const step = Math.ceil(z.length / idatParts);
  const idats = Array.from({ length: idatParts }, (_, k) => chunk('IDAT', z.subarray(k * step, (k + 1) * step)));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...idats, chunk('IEND', Buffer.alloc(0))]));
}

describe('PDF に入れるための PNG の展開 (decodePngForPdf)', () => {
  it('フィルタ 0〜4 の灰と α・RGBA の PNG を、pdf-lib の展開と同じ RGB・α にする (α が全部 255 なら α は無し)', () => {
    for (let s = 0; s < 24; s++)
      for (const ch of [2, 4] as const) {
        const w = 1 + s * 3;
        const h = 1 + s * 2;
        const px = new Uint8Array(w * h * ch).map((_, i) => ((i * (s + 13) * 7919) % 256) | (s % 3 === 0 && i % ch === ch - 1 ? 255 : 0));
        const png = filteredPng(w, h, ch, px, s, 1 + (s % 3));
        const ref = PNG.load(png);
        const mine = decodePngForPdf(png);
        if (!mine || mine === 'broken') throw new Error('展開できない');
        expect(Buffer.from(mine.rgb).equals(Buffer.from(ref.rgbChannel))).toBe(true);
        expect(!!mine.alpha).toBe(!!ref.alphaChannel);
        if (mine.alpha) expect(Buffer.from(mine.alpha).equals(Buffer.from(ref.alphaChannel!))).toBe(true);
      }
  });
  it('画素のデータが足りない PNG は broken、形の違う PNG (RGB・16 ビット・飛び越し) は undefined (pdf-lib に任せる)', async () => {
    const png = filteredPng(40, 30, 4, bytes(40 * 30 * 4, 3), 1, 1);
    const idat = chunks(png).find((c) => c.type === 'IDAT')!;
    const cut = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 20]), Buffer.from('IDAT'), idat.data.subarray(0, 20), Buffer.alloc(4)]);
    expect(decodePngForPdf(new Uint8Array(cut))).toBe('broken');
    await expect(embedPngChecked(await PDFDocument.create(), new Uint8Array(cut))).rejects.toThrow(/壊れて/);
    const rgb = await encodePng({ width: 2, height: 2, rgba: new Uint8Array(16).fill(255) });
    expect(decodePngForPdf(rgb)).toBeUndefined();
    const other = (k: number, v: number) => {
      const b = png.slice();
      b[k] = v;
      return b;
    };
    expect(decodePngForPdf(other(24, 16))).toBeUndefined();
    expect(decodePngForPdf(other(28, 1))).toBeUndefined();
  });
  it('PDF に入れた画像 (RGB と SMask の流れ) は、pdf-lib の embedPng と同じになる', async () => {
    const px = new Uint8Array(37 * 23 * 4).map((_, i) => (i * 13) & 255);
    const png = filteredPng(37, 23, 4, px, 2);
    const streams = async (embed: (pdf: PDFDocument) => Promise<unknown>) => {
      const pdf = await PDFDocument.create();
      await embed(pdf);
      return pdf.context
        .enumerateIndirectObjects()
        .map(([, o]) => o)
        .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
        .map((o) => [o.dict.toString(), Buffer.from(o.contents).toString('hex')]);
    };
    const mine = await streams((pdf) => embedPngChecked(pdf, png));
    expect(mine.length).toBe(2);
    expect(mine).toEqual(await streams((pdf) => pdf.embedPng(png).then((img) => img.embed())));
  });
});

describe('base64 の読み (fromBase64)', () => {
  it('atob と同じバイトを返す (空白・詰め物の無いもの)。atob の誤りにするものは、同じく投げる', () => {
    const data = bytes(1000, 5);
    const b64 = Buffer.from(data).toString('base64');
    const viaAtob = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    for (const s of [b64, b64.replace(/=+$/, ''), b64.replace(/(.{76})/g, '$1\n'), ' ' + b64 + '\t', '', 'QQ', 'QUI=', 'QUJD'])
      expect(Array.from(fromBase64(s))).toEqual(Array.from(viaAtob(s)));
    for (const s of ['Q', 'QQ=', 'Q===', 'QU-I', 'QUJD=', '日本']) {
      expect(() => atob(s)).toThrow();
      expect(() => fromBase64(s)).toThrow();
    }
    // 小さな結果も、ほかのバイトの混じらない自前の領域
    const small = fromBase64('QUI=');
    expect(small.buffer.byteLength).toBe(2);
  });
});

describe('PostScript の image のよくある形 (PS-20)', () => {
  const eps = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n`);
  const imageOf = (body: string) => {
    const r = runEps(eps(body))!;
    expect(r.error).toBeUndefined();
    const it = r.items.find((x) => x.k === 'image');
    if (!it || it.k !== 'image' || !it.rgba) throw new Error('画像でない');
    return Array.from(it.rgba);
  };
  const v = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  it('DeviceGray の 1・4・12・16 ビットと Decode の指定を、成分の値の式どおりに写す', () => {
    // 4 ビット、Decode [1 0]: 標本 0・5・10・15
    const g4 = imageOf('<< /ImageType 1 /Width 4 /Height 1 /BitsPerComponent 4 /Decode [1 0] /ImageMatrix [4 0 0 1 0 0] /DataSource <05af> >> image');
    expect(g4).toEqual([0, 5, 10, 15].flatMap((s) => [v(1 - s / 15), v(1 - s / 15), v(1 - s / 15), 255]));
    // 1 ビット
    const g1 = imageOf('8 1 1 [8 0 0 1 0 0] {<a5>} image');
    expect(g1).toEqual([1, 0, 1, 0, 0, 1, 0, 1].flatMap((b) => [b * 255, b * 255, b * 255, 255]));
    // 12 ビット: 0x123・0xfff
    const g12 = imageOf('2 1 12 [2 0 0 1 0 0] {<123fff>} image');
    expect(g12).toEqual([0x123, 0xfff].flatMap((s) => [v(s / 4095), v(s / 4095), v(s / 4095), 255]));
    // 16 ビット
    const g16 = imageOf('1 1 16 [1 0 0 1 0 0] {<8000>} image');
    expect(g16).toEqual([v(0x8000 / 65535), v(0x8000 / 65535), v(0x8000 / 65535), 255]);
  });
  it('DeviceRGB は成分ごとの Decode を使う (範囲の外の値は 0〜1 に収める)', () => {
    const rgb = imageOf('/DeviceRGB setcolorspace << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /Decode [0 0.5 1 0 0 2] /ImageMatrix [2 0 0 1 0 0] /DataSource <ff8040 00c0ff> >> image');
    expect(rgb).toEqual([v(0.5), v(1 - 128 / 255), v((64 / 255) * 2), 255, 0, v(1 - 192 / 255), v(2), 255]);
  });
});
