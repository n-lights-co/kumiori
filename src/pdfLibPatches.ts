/**
 * pdfLibPatches — pdf-lib と @pdf-lib/fontkit の内部に手を入れる所を 1 か所に集めたもの。
 *
 * pdf-lib の版が上がると壊れうる差し替えは、すべてこのファイルにある:
 *  1. fontkit の TrueType の部分書体 (createSubset の _addGlyph): 字形を 4 バイト境界にそろえる (patchFontkitSubset)
 *  2. CustomFontEmbedder.prototype (isCFF・encodeText・glyphId・embedFontStream): CFF の OpenType を CIDFontType0C で埋め込む (patchCffEmbedding)
 *  3. PngEmbedder.prototype の上に作る、PNG の IDAT をそのまま FlateDecode の画像にする埋め込み部品 (embedPngAsIs)
 *  4. PDFFont の encodeText を結果を覚えるものに差し替え、fontkit の layout を一時的にすり替えて字形の番号から符号にする (memoEncode)
 *  5. PDFFlateStream の contentsCache を差し替えて、圧縮の関数を替える (useDeflate)
 *  6. PDFPage の内容の流れ (getContentStream) の命令の並び (operators) をじかに読み書きする (pageOperators。描いた命令を Form XObject に移す)
 * (fontkit の異体字の並びの字形の引き方 (CmapProcessor.getVariationSelector) の差し替えは、PDF を作らないときの組版・描画にも
 *  要るので、書体を読む fontManager.ts の patchFontkitVariationSelector にある。同じ理由で、CFF の字形の輪郭の読み
 *  (CFFGlyph の _getPath の hflex・hflex1 と、CFFFont の fdForGlyph の FDSelect の範囲) の差し替えは fontkitCffFlex.ts にある)
 *
 * 前提 (差し替えるメソッドの存在) は、このモジュールを読み込んだときに assertPdfLibInternals で確かめる。
 * 「差し替え済み」の印はモジュールの変数でなく、差し替えた原型 (prototype) 自体に付ける (テストで同じ pdf-lib を複数回読み込んでも二重に包まない)
 */
import { Cache, CustomFontEmbedder, CustomFontSubsetEmbedder, PDFDocument, PDFFlateStream, PDFFont, PDFHexString, PDFImage, PDFRef, PngEmbedder } from 'pdf-lib';
import type { PDFOperator, PDFPage } from 'pdf-lib';
import type { FontManager } from './fontManager';
import { decodeJpeg } from './jpeg';
import { pngDataComplete, pngWithinLimits } from './pixels';
import { cffGidToCid, cffTable, subsetCff } from './cff';

/** 差し替え済みの印 (原型に付ける) */
const PATCHED = Symbol.for('kumiori.pdfLibPatched');

/**
 * 差し替えるメソッドが pdf-lib にあることを確かめる (無ければ、版が変わったことをはっきり知らせる)。
 * fontkit の部分書体の _addGlyph は書体を読むまで原型が取れないので、patchFontkitSubset の中で確かめる
 */
function assertPdfLibInternals() {
  const need = (o: object, names: string[], what: string) => {
    for (const n of names) if (typeof (o as Record<string, unknown>)[n] !== 'function') throw new Error(`pdf-lib の ${what}.${n} が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)`);
  };
  need(CustomFontEmbedder.prototype, ['encodeText', 'glyphId', 'embedFontStream', 'serializeFont'], 'CustomFontEmbedder.prototype');
  need(PngEmbedder.prototype, ['embedIntoContext'], 'PngEmbedder.prototype');
  need(PDFImage, ['of'], 'PDFImage');
  need(Cache, ['populatedBy'], 'Cache');
}
assertPdfLibInternals();

/**
 * ページの内容の流れの、命令の並び (page.pushOperators が足していく配列そのもの)。後ろを切り取れば、描いた命令を取り出せる
 * (PdfPainter.group が、不透明度のグループの中身を Form XObject に移すのに使う)
 */
export function pageOperators(page: PDFPage): PDFOperator[] {
  const p = page as unknown as { getContentStream?: () => { operators?: PDFOperator[] } };
  const ops = typeof p.getContentStream === 'function' ? p.getContentStream().operators : undefined;
  if (!Array.isArray(ops)) throw new Error('pdf-lib の PDFPage.getContentStream().operators が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)');
  return ops;
}

/** 埋め込む書体の区別 (書体の key に付ける、OpenType の機能の組) */
export const featureKey = (f: string[] | undefined) => (f?.length ? '|' + [...f].sort().join(',') : '');


/**
 * @pdf-lib/fontkit の TTF サブセットは、グリフデータを 4 バイト境界に揃えずに short 形式の loca を出力するため、
 * 奇数長のグリフ以降が全て化ける (Noto CJK 等で再現)。サブセット生成クラスの _addGlyph を差し替え、
 * 各グリフを 4 バイト境界にパディングして loca オフセットの整合を保つ。
 */
export function patchFontkitSubset(font: FontManager) {
  // TrueType の書体 (CFF の表の無いもの) のサブセットの型を差し替える。CFF の書体の createSubset は使えない (font.cff が無い)
  const tt = font.all().find((f) => !new Uint8Array(f.buffer, 0, 4).every((b, i) => b === 'OTTO'.charCodeAt(i)));
  const any = tt?.fk as unknown as { createSubset(): object } | undefined;
  if (!any) return;
  const proto = Object.getPrototypeOf(any.createSubset()) as {
    _addGlyph(this: { glyf: Uint8Array[]; offset: number }, gid: number): number;
    [PATCHED]?: boolean;
  };
  if (proto[PATCHED]) return;
  if (typeof proto._addGlyph !== 'function') throw new Error('@pdf-lib/fontkit の部分書体の _addGlyph が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)');
  const orig = proto._addGlyph;
  proto._addGlyph = function (gid: number) {
    const r = orig.call(this, gid);
    const last = this.glyf[this.glyf.length - 1];
    const pad = (4 - (last.length % 4)) % 4;
    if (pad) {
      const B = last.constructor as unknown as { alloc?: (n: number) => Uint8Array; new (n: number): Uint8Array };
      const padded = B.alloc ? B.alloc(last.length + pad) : new B(last.length + pad);
      padded.set(last, 0);
      this.glyf[this.glyf.length - 1] = padded;
      this.offset += pad;
    }
    return r;
  };
  proto[PATCHED] = true;
  patchSubsetSerialize(any.createSubset() as unknown as SubsetLike);
}

type EncodeStreamLike = { on(ev: string, fn: (v: never) => void): EncodeStreamLike; end(): void };
type SubsetLike = { encode(s: EncodeStreamLike): void; encodeStream(): EncodeStreamLike };

/**
 * 部分書体の書き出し (pdf-lib の CustomFontSubsetEmbedder.serializeFont) を、例外を受けられる形に差し替える。
 * 元の形は、fontkit の encodeStream が、書き出し (encode) を次の周回 (nextTick) のコールバックの中で走らせる。壊れた書体 (glyf・loca・head の
 * 位置が範囲の外など) で encode が投げると、その例外は、どの Promise にも届かず、プロセスの uncaughtException になる (toPdf を囲んだ
 * try/catch では受けられず、Node のプロセスが落ちる)。同じ流れ (EncodeStream) を自分で作り、encode を try の中で呼んで、例外は Promise の拒否にする
 */
function patchSubsetSerialize(sample: SubsetLike) {
  const proto = CustomFontSubsetEmbedder.prototype as unknown as { serializeFont(this: { subset: SubsetLike }): Promise<Uint8Array>; [PATCHED]?: boolean };
  if (proto[PATCHED]) return;
  if (typeof sample.encodeStream !== 'function' || typeof sample.encode !== 'function') throw new Error('@pdf-lib/fontkit の部分書体の encodeStream が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)');
  // 流れの型 (restructure の EncodeStream) は、fontkit の外からは見えないので、何も書かない encode で 1 つ作らせて、その型を取る
  const Stream = sample.encodeStream.call({ encode() {} } as unknown as SubsetLike).constructor as new () => EncodeStreamLike;
  proto.serializeFont = function () {
    return new Promise<Uint8Array>((resolve, reject) => {
      const parts: Uint8Array[] = [];
      const s = new Stream();
      s.on('data', ((bytes: Uint8Array) => void parts.push(bytes)) as never)
        .on('end', (() => {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let at = 0;
          for (const p of parts) {
            out.set(p, at);
            at += p.length;
          }
          resolve(out);
        }) as never)
        .on('error', ((err: unknown) => reject(err)) as never);
      try {
        this.subset.encode(s);
        s.end();
      } catch (e) {
        reject(e);
      }
    });
  };
  proto[PATCHED] = true;
}

/**
 * CFF の OpenType の埋め込みを正す (pdf-lib の CustomFontEmbedder を差し替える)。
 *  - CFF と判定させる (CIDFontType0・FontFile3)。@pdf-lib/fontkit は font.cff を持たないので、CFF の表の有無で見る
 *  - CID 方式の CFF (Top DICT に ROS がある) では、本文の字の符号・W・ToUnicode を、GID でなく CID で書く
 *    (CIDFontType0 は、CID から CFF の charset で GID を引く。ISO 32000-2 §9.7.4.2)
 *  - CFF の表 (OpenType の 'CFF ') だけを FontFile3 (CIDFontType0C) に入れる。kumioriCffSubset の付いた書体は、
 *    使った字のほかの字形を空にした CFF (cff.ts の subsetCff) にする
 */
export function patchCffEmbedding() {
  if ((CustomFontEmbedder.prototype as unknown as Record<symbol, unknown>)[PATCHED]) return;
  type Ctx = { flateStream(b: Uint8Array, d: Record<string, unknown>): unknown; register(o: unknown): unknown };
  type Glyph = { id: number; codePoints: number[]; advanceWidth: number };
  type Emb = {
    isCFF(): boolean;
    serializeFont(): Promise<Uint8Array>;
    font: { cff?: unknown; directory?: { tables?: Record<string, unknown> }; layout(t: string, f?: unknown): { glyphs: Glyph[] } };
    fontData: Uint8Array;
    fontFeatures?: unknown;
    glyphCache: { access(): Glyph[] };
    kumioriCffSubset?: boolean;
    kumioriCid?: Uint32Array | null;
    kumioriUsed?: Map<number, Glyph>;
  };
  const proto = CustomFontEmbedder.prototype as unknown as Record<string, unknown>;
  const origEncode = proto.encodeText as (this: Emb, t: string) => unknown;
  const origGlyphId = proto.glyphId as (this: Emb, g: Glyph | undefined) => number;
  const isCff = function (this: Emb) {
    return !!(this.font.cff || this.font.directory?.tables?.['CFF ']);
  };
  /** CID 方式の CFF の GID → CID (CID 方式でなければ null) */
  const cidMap = (e: Emb): Uint32Array | null => {
    if (e.kumioriCid === undefined) {
      try {
        const t = cffTable(e.fontData);
        e.kumioriCid = t ? (cffGidToCid(t) ?? null) : null;
      } catch {
        e.kumioriCid = null;
      }
    }
    return e.kumioriCid;
  };
  proto.isCFF = isCff;
  proto.encodeText = function (this: Emb, text: string) {
    if (!isCff.call(this)) return origEncode.call(this, text);
    const glyphs = this.font.layout(text, this.fontFeatures).glyphs;
    const map = cidMap(this);
    this.kumioriUsed ??= new Map();
    let hex = '';
    for (const g of glyphs) {
      this.kumioriUsed.set(g.id, g);
      hex += (map ? (map[g.id] ?? 0) : g.id).toString(16).padStart(4, '0');
    }
    return PDFHexString.of(hex);
  };
  proto.glyphId = function (this: Emb, g: Glyph | undefined) {
    const map = isCff.call(this) ? cidMap(this) : null;
    return g && map ? (map[g.id] ?? 0) : origGlyphId.call(this, g);
  };
  // CFF の書体は、OpenType の 'CFF ' の表だけを入れる (CIDFontType0C)。部分書体なら、使った字のほかの字形を空にする
  const cffBytes = (e: Emb): Uint8Array | undefined => {
    const t = cffTable(e.fontData);
    if (!t) return undefined;
    if (!e.kumioriCffSubset) return t;
    try {
      return subsetCff(t, new Set(e.kumioriUsed?.keys() ?? []));
    } catch {
      return t;
    }
  };
  proto.embedFontStream = async function (this: Emb, context: Ctx) {
    if (isCff.call(this) && !(this instanceof CustomFontSubsetEmbedder)) {
      const bare = cffBytes(this);
      if (bare) return context.register(context.flateStream(bare, { Subtype: 'CIDFontType0C' }));
      return context.register(context.flateStream(this.fontData, { Subtype: 'OpenType' }));
    }
    const subtype = isCff.call(this) ? 'CIDFontType0C' : undefined;
    return context.register(context.flateStream(await this.serializeFont(), { Subtype: subtype }));
  };
  (proto as Record<symbol, unknown>)[PATCHED] = true;
}

/** CFF の書体を部分書体として埋め込む印を付ける (patchCffEmbedding)。W・ToUnicode も使った字だけにする */
export function markCffSubset(f: PDFFont) {
  const e = (f as unknown as { embedder: { kumioriCffSubset?: boolean; kumioriUsed?: Map<number, unknown>; glyphCache: unknown; glyphId(g: unknown): number } }).embedder;
  e.kumioriCffSubset = true;
  e.glyphCache = {
    access: () => [...(e.kumioriUsed?.values() ?? [])].sort((a, b) => e.glyphId(a) - e.glyphId(b)),
    invalidate: () => {},
  };
}

/**
 * 8 ビットのグレー・RGB で、インターレース・透明度 (tRNS) の無い PNG は、展開せずに埋め込む:
 * PNG の圧縮データ (IDAT) は、PNG の予測のフィルタ付きの zlib なので、そのまま FlateDecode (Predictor 15) の画像になる。
 * 条件に合わなければ undefined (pdf-lib の embedPng で、展開して埋め込む)
 */
export async function embedPngAsIs(pdf: PDFDocument, png: Uint8Array): Promise<PDFImage | undefined> {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return undefined;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let colors = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const body = png.subarray(at + 8, at + 8 + len);
    if (body.length < len) return undefined;
    if (type === 'IHDR') {
      width = dv.getUint32(at + 8);
      height = dv.getUint32(at + 12);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (colorType !== 0 && colorType !== 2)) return undefined;
      colors = colorType === 2 ? 3 : 1;
    } else if (type === 'tRNS') return undefined;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height || !colors || !idat.length) return undefined;
  const data = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  idat.reduce((o, b) => (data.set(b, o), o + b.length), 0);
  // PDFImage は pdf-lib の PngEmbedder しか受け付けないので、その原型の上に、埋め込み方だけを差し替えた部品を作る
  const embedder = Object.assign(Object.create(PngEmbedder.prototype) as PngEmbedder, {
    width,
    height,
    async embedIntoContext(context: PDFDocument['context'], ref?: PDFRef) {
      const stream = context.stream(data, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: width,
        Height: height,
        BitsPerComponent: 8,
        ColorSpace: colors === 3 ? 'DeviceRGB' : 'DeviceGray',
        Filter: 'FlateDecode',
        DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: 8, Columns: width },
      });
      if (ref) {
        context.assign(ref, stream);
        return ref;
      }
      return context.register(stream);
    },
  });
  try {
    const img = PDFImage.of(pdf.context.nextRef(), pdf, embedder);
    await img.embed();
    return img;
  } catch {
    // 埋め込めなければ、pdf-lib の embedPng (展開して埋め込む) に任せる
    return undefined;
  }
}

/**
 * PNG を埋め込む: 展開せずに入れられるものは embedPngAsIs、ほかは pdf-lib の embedPng (展開する)。
 * どちらも、画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) を超える PNG は埋め込まずに投げる
 * (pdf-lib は IHDR の寸法のとおりに配列を作る。PDF に入れても、PDF を見る側が同じだけ展開する。IMG-19)
 */
export async function embedPngChecked(pdf: PDFDocument, png: Uint8Array): Promise<PDFImage> {
  if (!pngWithinLimits(png)) throw new Error('PNG: 画素の数か展開の大きさが上限を超えます');
  const asIs = await embedPngAsIs(pdf, png);
  if (asIs) return asIs;
  // 展開して埋め込む前に、画素のデータが終わりまで展開できることを確かめる (壊れたデータで、pdf-lib の展開が止まらなくなる。pngDataComplete)
  if (!pngDataComplete(png)) throw new Error('PNG: 画素のデータが壊れています');
  return pdf.embedPng(png);
}

/**
 * 入稿用 (PDF/X) の出力: RGB の画像 (PNG・JPEG) を画素に戻し、CMYK (DeviceCMYK・8 ビット・FlateDecode) の画像として埋め込む。
 * 色の変換は toCmyk (ICC の変換はしない)。透明度は SMask (DeviceGray) として残し、hasAlpha で知らせる。
 * グレーの画像・CMYK の JPEG・読めない画像は undefined (呼ぶ側で、ふつうに埋め込む)
 */
export async function embedCmykImage(
  pdf: PDFDocument,
  bytes: Uint8Array,
  kind: 'png' | 'jpg',
  toCmyk: (r: number, g: number, b: number) => number[],
): Promise<{ image: PDFImage; hasAlpha: boolean } | undefined> {
  let width = 0;
  let height = 0;
  let rgb: Uint8Array;
  let alpha: Uint8Array | undefined;
  if (kind === 'jpg') {
    const px = decodeJpeg(bytes);
    if (!px || px.components !== 3) return undefined;
    ({ width, height } = px);
    rgb = px.data;
  } else {
    // 上限を超える PNG は展開しない (呼ぶ側のふつうの埋め込み (embedPngChecked) も断る)
    if (!pngWithinLimits(bytes) || !pngDataComplete(bytes)) return undefined;
    let e: PngEmbedder;
    try {
      e = await PngEmbedder.for(bytes);
    } catch {
      return undefined;
    }
    const png = (e as unknown as { image: { rgbChannel: Uint8Array; alphaChannel?: Uint8Array; bitsPerComponent: number; width: number; height: number } }).image;
    if (!png || png.bitsPerComponent !== 8 || png.rgbChannel.length !== png.width * png.height * 3) return undefined;
    ({ width, height } = png);
    rgb = png.rgbChannel;
    alpha = png.alphaChannel && png.alphaChannel.some((v) => v !== 255) ? png.alphaChannel : undefined;
  }
  // 灰色だけの画像は DeviceGray のままでよい (呼ぶ側でふつうに埋め込む)
  let colourful = false;
  for (let i = 0; i < rgb.length && !colourful; i += 3) colourful = rgb[i] !== rgb[i + 1] || rgb[i + 1] !== rgb[i + 2];
  if (!colourful && !alpha) return undefined;
  const cmyk = new Uint8Array(width * height * 4);
  const memo = new Map<number, number[]>();
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    let c = memo.get(key);
    if (!c) {
      c = toCmyk(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
      if (memo.size < 1 << 16) memo.set(key, c);
    }
    cmyk.set(c, o);
  }
  const embedder = Object.assign(Object.create(PngEmbedder.prototype) as PngEmbedder, {
    width,
    height,
    async embedIntoContext(context: PDFDocument['context'], ref?: PDFRef) {
      const smask = alpha
        ? context.register(context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }))
        : undefined;
      const stream = context.flateStream(cmyk, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceCMYK', ...(smask ? { SMask: smask } : {}) });
      if (ref) {
        context.assign(ref, stream);
        return ref;
      }
      return context.register(stream);
    },
  });
  const image = PDFImage.of(pdf.context.nextRef(), pdf, embedder);
  await image.embed();
  return { image, hasAlpha: !!alpha };
}


/**
 * 字を符号にする関数を、結果を覚えるものにする。features を渡すと、その OpenType の機能を当てた字形の符号にする
 * (書体は 1 回だけ埋め込み、機能の違う字形も同じ埋め込みの部分書体に入れる)
 */
/** 符号 (PDFHexString) ごとの、その文字列の送り (1/1000 em。pdf-lib が W に書く値と同じ計算)。同じ基線の字を TJ にまとめるときの字送りに使う */
const hexWidth = new WeakMap<PDFHexString, number>();
/** 符号の文字列の送り (1/1000 em)。memoEncode で作った符号でなければ undefined */
export const widthOfHex = (hex: PDFHexString) => hexWidth.get(hex);

export function memoEncode(f: PDFFont): FeatureFont {
  const orig = f.encodeText.bind(f);
  const emb = (f as unknown as { embedder: { fontFeatures?: Record<string, boolean> } }).embedder;
  const cache = new Map<string, ReturnType<PDFFont['encodeText']>>();
  (f as FeatureFont).encodeText = (t: string, features?: string[]) => {
    const key = t + featureKey(features);
    let v = cache.get(key);
    if (!v) {
      const saved = emb.fontFeatures;
      if (features?.length) emb.fontFeatures = Object.fromEntries(features.map((x) => [x, true]));
      try {
        v = orig(t);
        // 送りは、この機能の組で組んだ字形の advanceWidth の合計 (pdf-lib の widthOfTextAtSize と W は同じ字形から計算する)
        hexWidth.set(v, f.widthOfTextAtSize(t, 1000));
      } finally {
        emb.fontFeatures = saved;
      }
      cache.set(key, v);
    }
    return v;
  };
  // 字形の番号 (GlyphArea.glyphIds) から符号にする。書体の組む処理 (layout) を、その字形を返すものに差し替えて encodeText を通す
  // (部分書体への字形の追加・CID の書き方・W・ToUnicode は encodeText と同じになる)。字 (text) は ToUnicode に使う
  const fk = (emb as unknown as { font: { unitsPerEm: number; layout: (t: string, f?: unknown) => unknown; getGlyph(id: number, cps?: number[]): { id: number; advanceWidth: number } } }).font;
  // ToUnicode の字: 互換用の合字の字 (組版で fi を U+FB01 に置き換えたもの) は、元の字の並びにする (ISO 32000-1 §9.10.3 の
  // 1 つの符号から複数の字への対応)。字を取り出したとき・検索したときに「fi」になる。fontkit は字形を最初に作ったときの字で覚え、
  // 書体の中の呼び出し (glyphForCodePoint など) も this.getGlyph を通るので、ここで差し替える
  const getGlyph = fk.getGlyph.bind(fk);
  fk.getGlyph = (id: number, cps?: number[]) => getGlyph(id, cps && decomposeLigatures(cps));
  const glyphCache = new Map<string, ReturnType<PDFFont['encodeText']>>();
  (f as FeatureFont).encodeGlyphs = (ids: number[], text: string) => {
    const key = ids.join(',') + '\u0000' + text;
    let v = glyphCache.get(key);
    if (!v) {
      const cps = [...text].map((c) => c.codePointAt(0)!);
      // ToUnicode の符号位置: 字と字形が同じ数なら 1 つずつ、違えば (合字など) 最初の字形に全部。fontkit は字形を番号で記憶し、
      // 符号位置は最初に作ったときの値で固定されるので、空で作られた字形には後から分かった符号位置を入れる。合字の字は元の字の並びにする
      const glyphs = ids.map((id, k) => {
        const own = decomposeLigatures(ids.length === cps.length ? [cps[k]] : k === 0 ? cps : []);
        const g = fk.getGlyph(id, own) as { id: number; advanceWidth: number; codePoints?: number[] };
        if (own.length && (!g.codePoints?.length || (g.codePoints.length === 1 && LIGATURE_SEQ[g.codePoints[0]]))) g.codePoints = own;
        return g;
      });
      const layout = fk.layout;
      fk.layout = () => ({ glyphs, positions: [] });
      try {
        v = orig(text);
      } finally {
        fk.layout = layout;
      }
      hexWidth.set(v, (glyphs.reduce((a, g) => a + g.advanceWidth, 0) * 1000) / fk.unitsPerEm);
      glyphCache.set(key, v);
    }
    return v;
  };
  // 書体の字形 id に登録されている字 (ToUnicode に書かれる字。最初に使ったときの字)。無ければ空の文字列
  (f as FeatureFont).glyphText = (id: number) => {
    const g = fk.getGlyph(id) as { codePoints?: number[] };
    return g.codePoints?.length ? String.fromCodePoint(...g.codePoints) : '';
  };
  return f as FeatureFont;
}

/** 互換用の欧文の合字 (U+FB00〜U+FB06) を、元の字の並びにする (Unicode の互換分解) */
const LIGATURE_SEQ: Record<number, string> = { 0xfb00: 'ff', 0xfb01: 'fi', 0xfb02: 'fl', 0xfb03: 'ffi', 0xfb04: 'ffl', 0xfb05: 'ſt', 0xfb06: 'st' };
export function decomposeLigatures(cps: number[]): number[] {
  return cps.some((c) => LIGATURE_SEQ[c]) ? cps.flatMap((c) => (LIGATURE_SEQ[c] ? [...LIGATURE_SEQ[c]].map((x) => x.codePointAt(0)!) : [c])) : cps;
}

/** 機能の組を渡せる encodeText と、字形の番号から符号にする encodeGlyphs を持つ書体 (memoEncode) */
export type FeatureFont = PDFFont & { encodeText(t: string, features?: string[]): PDFHexString; encodeGlyphs(ids: number[], text: string): PDFHexString; glyphText(id: number): string };

/** 保存のときに圧縮する流れ (ページの中身など) の圧縮を、渡した関数に替える (pdf-lib は保存のときに中身を作って圧縮する) */
export function useDeflate(pdf: PDFDocument, deflate: (data: Uint8Array) => Uint8Array) {
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFFlateStream)) continue;
    const s = obj as unknown as { encode: boolean; contentsCache: Cache<Uint8Array>; getUnencodedContents(): Uint8Array };
    if (s.encode) s.contentsCache = Cache.populatedBy(() => deflate(s.getUnencodedContents()));
  }
}
