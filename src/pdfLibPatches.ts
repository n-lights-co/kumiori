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
 *  7. 描き終えたページの内容の流れ (PDFPage の contentStream・contentStreamRef) を、圧縮したバイト列の流れに置き換える (sealPageContents)
 * (fontkit の異体字の並びの字形の引き方 (CmapProcessor.getVariationSelector) の差し替えは、PDF を作らないときの組版・描画にも
 *  要るので、書体を読む fontManager.ts の patchFontkitVariationSelector にある。同じ理由で、CFF の字形の輪郭の読み
 *  (CFFGlyph の _getPath の hflex・hflex1 と、CFFFont の fdForGlyph の FDSelect の範囲) の差し替えは fontkitCffFlex.ts にある)
 *
 * 前提 (差し替えるメソッドの存在) は、このモジュールを読み込んだときに assertPdfLibInternals で確かめる。
 * 「差し替え済み」の印はモジュールの変数でなく、差し替えた原型 (prototype) 自体に付ける (テストで同じ pdf-lib を複数回読み込んでも二重に包まない)
 */
import { Cache, CustomFontEmbedder, CustomFontSubsetEmbedder, PDFContentStream, PDFContext, PDFDict, PDFDocument, PDFFlateStream, PDFFont, PDFHexString, PDFImage, PDFPage, PDFRawStream, PDFRef, PngEmbedder } from 'pdf-lib';
import type { PDFOperator } from 'pdf-lib';
import type { FontManager } from './fontManager';
import { decodeJpeg } from './jpeg';
import { decodePngForPdf, pngDataComplete, pngWithinLimits } from './pixels';
import { cffGidToCid, cffTable, subsetCff } from './cff';
import { msg } from './messages';

/** 差し替え済みの印 (原型に付ける) */
const PATCHED = Symbol.for('kumiori.pdfLibPatched');

/** pdf-lib の中の欄・メソッドが見つからないときの誤り (pdf-lib の版が変わったことをはっきり知らせる) */
const internalsChanged = (what: string) => new Error(msg(`pdf-lib の ${what} が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)`, `pdf-lib ${what} not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)`));

/**
 * 差し替えるメソッドが pdf-lib にあることを確かめる (無ければ、版が変わったことをはっきり知らせる)。
 * fontkit の部分書体の _addGlyph は書体を読むまで原型が取れないので、patchFontkitSubset の中で確かめる
 */
function assertPdfLibInternals() {
  const need = (o: object, names: string[], what: string) => {
    for (const n of names) if (typeof (o as Record<string, unknown>)[n] !== 'function') throw internalsChanged(`${what}.${n}`);
  };
  need(CustomFontEmbedder.prototype, ['encodeText', 'glyphId', 'embedFontStream', 'serializeFont'], 'CustomFontEmbedder.prototype');
  need(PngEmbedder.prototype, ['embedIntoContext'], 'PngEmbedder.prototype');
  need(PDFImage, ['of'], 'PDFImage');
  need(Cache, ['populatedBy'], 'Cache');
  need(PDFRawStream, ['of'], 'PDFRawStream');
  // 描き終えたページの内容の流れを置き換える所 (sealPageContents)。ページの欄 (contentStream・contentStreamRef) と、内容の流れの欄
  // (encode・dict) は、作ったものにしか無いので、sealPageContents の中で確かめる
  need(PDFPage.prototype, ['getContentStream'], 'PDFPage.prototype');
  need(PDFContentStream.prototype, ['getUnencodedContents', 'getContents'], 'PDFContentStream.prototype');
  need(PDFContext.prototype, ['assign', 'lookup'], 'PDFContext.prototype');
}
assertPdfLibInternals();

/**
 * ページの内容の流れの、命令の並び (page.pushOperators が足していく配列そのもの)。後ろを切り取れば、描いた命令を取り出せる
 * (PdfPainter.group が、不透明度のグループの中身を Form XObject に移すのに使う)
 */
export function pageOperators(page: PDFPage): PDFOperator[] {
  const p = page as unknown as { getContentStream?: () => { operators?: PDFOperator[] } };
  const ops = typeof p.getContentStream === 'function' ? p.getContentStream().operators : undefined;
  if (!Array.isArray(ops)) throw new Error(msg('pdf-lib の PDFPage.getContentStream().operators が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)', 'pdf-lib PDFPage.getContentStream().operators not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
  if (typeof proto._addGlyph !== 'function') throw new Error(msg('@pdf-lib/fontkit の部分書体の _addGlyph が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)', '_addGlyph of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
  const orig = proto._addGlyph;
  proto._addGlyph = function (gid: number) {
    const r = addGlyphOrEmpty(this as unknown as SubsetGlyphs, gid, orig);
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

/** fontkit の TrueType の部分書体 (TTFSubset) の、書き出しの途中の表 (_addGlyph が 1 字形ずつ足す) */
type SubsetGlyphs = {
  font: { hmtx?: { metrics?: { length: number; get(i: number): { advance?: number } | undefined } }; _getTableStream?(tag: string): { readBuffer(n: number): Uint8Array } | null };
  glyf: Uint8Array[];
  offset: number;
  loca: { offsets: number[] };
  hmtx: { metrics: Array<{ advance: number; bearing: number }> };
};

/**
 * 部分書体に字形 gid を足す (fontkit の _addGlyph = orig)。字形のデータが読めない字形 (loca の位置がずれて、glyf の中の別の所を指すなど。
 * 点の座標の読みが glyf の外へ出る・複合の字形の部品の番号を書く位置がデータの外になる) は、orig が例外になり、部分書体の全体が
 * 書けず、PDF の全体が失敗していた。その字形は、輪郭の無い字形 (長さ 0 のデータ。OpenType の 'loca' の表: 次の字形と位置が同じ字形は
 * 輪郭を持たない) にし、送りは hmtx の値のままにする (組版で測った送りと同じ)。足しかけた表は、呼ぶ前の長さに戻す
 * (部品として includeGlyph が並びに足した字形は残るが、それぞれ自分の番に足すので、表は食い違わない)
 */
function addGlyphOrEmpty(s: SubsetGlyphs, gid: number, orig: (this: SubsetGlyphs, gid: number) => number): number {
  const n = s.glyf.length;
  const [locaN, hmtxN, offset] = [s.loca.offsets.length, s.hmtx.metrics.length, s.offset];
  try {
    return orig.call(s, gid);
  } catch {
    s.glyf.length = n;
    s.loca.offsets.length = locaN;
    s.hmtx.metrics.length = hmtxN;
    s.offset = offset;
    let advance = 0;
    try {
      // hmtx の送り (hMetrics の数より後ろの字形は、最後の送り。OpenType の 'hmtx' の表)
      const m = s.font.hmtx?.metrics;
      if (m && m.length) advance = m.get(Math.min(gid, m.length - 1))?.advance ?? 0;
    } catch {
      advance = 0;
    }
    // 書き出しの流れ (restructure の EncodeStream) は、fontkit の中の Buffer の型だけを受けるので、fontkit の読みで長さ 0 のものを作る
    const empty = emptyFontkitBuffer(s);
    if (!empty) throw new Error(msg('fontkit の部分書体の字形のデータの型が分かりません', 'unknown type of glyph data in the fontkit subset'));
    s.glyf.push(empty);
    s.loca.offsets.push(s.offset);
    s.hmtx.metrics.push({ advance, bearing: 0 });
    return s.glyf.length - 1;
  }
}

/** fontkit の中の Buffer の型の、長さ 0 のもの (書体の glyf の流れから読む。読めなければ、足した字形のデータの型から作る) */
function emptyFontkitBuffer(s: SubsetGlyphs): Uint8Array | undefined {
  try {
    const b = s.font._getTableStream?.('glyf')?.readBuffer(0);
    if (b) return b;
  } catch {
    // 下の代わりへ
  }
  const B = s.glyf[0]?.constructor as unknown as { alloc?: (n: number) => Uint8Array } | undefined;
  return B?.alloc?.(0);
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
  if (typeof sample.encodeStream !== 'function' || typeof sample.encode !== 'function') throw new Error(msg('@pdf-lib/fontkit の部分書体の encodeStream が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)', 'encodeStream of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
 * 8 ビット・飛び越しでない、α の付いた PNG を自前で展開 (pixels.ts の decodePngForPdf) して、pdf-lib の PngEmbedder と同じ形の部品にする。
 * 部品の image (rgbChannel・alphaChannel) は pdf-lib の PNG と同じ中身なので、埋め込んだ PDF も同じになる。形の違う PNG は undefined
 */
function decodedPngEmbedder(png: Uint8Array): PngEmbedder | 'broken' | undefined {
  const px = decodePngForPdf(png);
  if (!px || px === 'broken') return px;
  const image = { rgbChannel: px.rgb, alphaChannel: px.alpha, width: px.width, height: px.height, bitsPerComponent: 8 };
  return Object.assign(Object.create(PngEmbedder.prototype) as PngEmbedder, { image, bitsPerComponent: 8, width: px.width, height: px.height, colorSpace: 'DeviceRGB' });
}

/**
 * PNG を埋め込む: 展開せずに入れられるものは embedPngAsIs、ほかは pdf-lib の embedPng (展開する)。
 * どちらも、画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) を超える PNG は埋め込まずに投げる
 * (pdf-lib は IHDR の寸法のとおりに配列を作る。PDF に入れても、PDF を見る側が同じだけ展開する)
 */
export async function embedPngChecked(pdf: PDFDocument, png: Uint8Array): Promise<PDFImage> {
  if (!pngWithinLimits(png)) throw new Error(msg('PNG: 画素の数か展開の大きさが上限を超えます', 'PNG: the number of pixels or the decompressed size exceeds the limit'));
  const asIs = await embedPngAsIs(pdf, png);
  if (asIs) return asIs;
  // 8 ビットの α の付いた PNG は、自前で展開して、pdf-lib と同じ RGB・α の画像にする (pdf-lib の展開は、1 億画素で 10 秒かかる)
  const own = decodedPngEmbedder(png);
  if (own === 'broken') throw new Error(msg('PNG: 画素のデータが壊れています', 'PNG: the pixel data is broken'));
  if (own) {
    const img = PDFImage.of(pdf.context.nextRef(), pdf, own);
    await img.embed();
    return img;
  }
  // 展開して埋め込む前に、画素のデータが終わりまで展開できることを確かめる (壊れたデータで、pdf-lib の展開が止まらなくなる。pngDataComplete)
  if (!pngDataComplete(png)) throw new Error(msg('PNG: 画素のデータが壊れています', 'PNG: the pixel data is broken'));
  return pdf.embedPng(png);
}

/**
 * 入稿用 (PDF/X) の出力: RGB の画像 (PNG・JPEG) を画素に戻し、CMYK (DeviceCMYK・8 ビット・FlateDecode) の画像として埋め込む。
 * 色の変換は toCmyk (ICC の変換はしない)。透明度は SMask (DeviceGray) として残し、hasAlpha で知らせる。
 * 灰色だけの画像 (画素がすべて R = G = B。RGB・RGBA の PNG、16 ビット・1 ビットの灰色の PNG、灰色 + α の PNG も、展開すると RGB の
 * 3 つの成分になる) は、DeviceGray (8 ビット・FlateDecode) の画像にする (pdfStandard.ts の PdfStandard.cmyk: 灰色の画像は DeviceGray。
 * 値は R の成分そのものなので、濃さは変わらない。ISO 32000-2 §8.6.4.2・§10.4.2.2: DeviceRGB の r = g = b と、DeviceGray の同じ値は同じ灰色)。
 * 呼ぶ側のふつうの埋め込みは、8 ビットの灰色 (色の型 0) の PNG のほかを DeviceRGB で書くので、PDF/X-1a・X-3 の検査で止まっていた。
 * 展開せずにそのまま DeviceGray で入れられる PNG (8 ビットの灰色・インターレース無し・tRNS 無し) は、そのまま入れる (embedPngAsIs)。
 * CMYK・灰色の JPEG (成分が 3 でないもの)・読めない画像は undefined (呼ぶ側で、ふつうに埋め込む)
 */
export async function embedCmykImage(
  pdf: PDFDocument,
  bytes: Uint8Array,
  kind: 'png' | 'jpg',
  toCmyk: (r: number, g: number, b: number) => number[],
  /**
   * 透明度のある画像の扱い: 'smask' はソフトマスク (SMask) を付けて埋め込む。'skip' は埋め込まずに、透明度があることと大きさだけを返す
   * (透明を平らにする出力。画像は、下の物と合わせて画素にする)
   */
  alphaMode: 'smask' | 'skip' = 'smask',
): Promise<{ image: PDFImage; hasAlpha: boolean } | { image?: undefined; hasAlpha: true; width: number; height: number } | undefined> {
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
      const own = decodedPngEmbedder(bytes);
      if (own === 'broken') return undefined;
      e = own ?? (await PngEmbedder.for(bytes));
    } catch {
      return undefined;
    }
    const png = (e as unknown as { image: { rgbChannel: Uint8Array; alphaChannel?: Uint8Array; bitsPerComponent: number; width: number; height: number } }).image;
    if (!png || png.bitsPerComponent !== 8 || png.rgbChannel.length !== png.width * png.height * 3) return undefined;
    ({ width, height } = png);
    rgb = png.rgbChannel;
    alpha = png.alphaChannel && png.alphaChannel.some((v) => v !== 255) ? png.alphaChannel : undefined;
  }
  if (alpha && alphaMode === 'skip') return { hasAlpha: true, width, height };
  let colourful = false;
  for (let i = 0; i < rgb.length && !colourful; i += 3) colourful = rgb[i] !== rgb[i + 1] || rgb[i + 1] !== rgb[i + 2];
  if (!colourful) {
    // 8 ビットの灰色 (IHDR の色の型 0) の PNG は、展開せずにそのまま DeviceGray で入れる (透明度が無いとき。tRNS があれば embedPngAsIs が断る)
    if (kind === 'png' && !alpha && bytes[25] === 0) {
      const asIs = await embedPngAsIs(pdf, bytes);
      if (asIs) return { image: asIs, hasAlpha: false };
    }
    const gray = new Uint8Array(width * height);
    for (let i = 0, o = 0; o < gray.length; i += 3, o++) gray[o] = rgb[i];
    return { image: await embedImageStream(pdf, gray, width, height, 'DeviceGray', alpha), hasAlpha: !!alpha };
  }
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
  return { image: await embedImageStream(pdf, cmyk, width, height, 'DeviceCMYK', alpha), hasAlpha: !!alpha };
}

/** 8 ビットの画素 data (色空間 colorSpace の成分の並び) を、FlateDecode の画像として埋め込む。alpha があれば SMask (DeviceGray) にする */
async function embedImageStream(pdf: PDFDocument, data: Uint8Array, width: number, height: number, colorSpace: 'DeviceCMYK' | 'DeviceGray', alpha: Uint8Array | undefined): Promise<PDFImage> {
  const embedder = Object.assign(Object.create(PngEmbedder.prototype) as PngEmbedder, {
    width,
    height,
    async embedIntoContext(context: PDFDocument['context'], ref?: PDFRef) {
      const smask = alpha
        ? context.register(context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }))
        : undefined;
      const stream = context.flateStream(data, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: colorSpace, ...(smask ? { SMask: smask } : {}) });
      if (ref) {
        context.assign(ref, stream);
        return ref;
      }
      return context.register(stream);
    },
  });
  const image = PDFImage.of(pdf.context.nextRef(), pdf, embedder);
  await image.embed();
  return image;
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
/**
 * 描き終えたページの内容の流れを、保存のときと同じに圧縮したバイト列の流れ (PDFRawStream) に、同じ番号のまま置き換える。
 * pdf-lib は、ページの命令 (PDFOperator) を保存まで持つので、数千ページの文書では、命令だけで数百 MB になっていた。
 * 圧縮は、保存のときと同じ: deflate を渡せば deflate (useDeflate で差し替えるもの)、無ければ pdf-lib の圧縮 (pako)。
 * 辞書は、内容の流れの辞書をそのまま使う (圧縮の印 Filter は作ったときに入っていて、長さ Length は保存のときに入る) ので、書き出す PDF は同じ。
 * 置き換えた後で、そのページに命令を足そうとしたら誤りにする (黙って捨てない)
 */
export function sealPageContents(pdf: PDFDocument, page: PDFPage, deflate?: (data: Uint8Array) => Uint8Array): void {
  const p = page as unknown as { contentStream?: unknown; contentStreamRef?: PDFRef; getContentStream(): unknown };
  const s = p.contentStream;
  const ref = p.contentStreamRef;
  // 何も描いていないページ (pdf-lib が内容の流れを作っていない) は、置き換えるものが無い。内容の流れがページにあるのに欄が無ければ、
  // pdf-lib の形が変わっている (黙って置き換えずにいると、命令を保存まで持ち続ける)
  if (s === undefined && ref === undefined && page.node.Contents() === undefined) return;
  if (!(s instanceof PDFContentStream) || !(ref instanceof PDFRef)) throw internalsChanged('PDFPage.contentStream・contentStreamRef');
  const f = s as unknown as { encode: unknown; getUnencodedContents(): Uint8Array; dict: unknown };
  if (typeof f.encode !== 'boolean' || !(f.dict instanceof PDFDict)) throw internalsChanged('PDFContentStream.encode・dict');
  const contents = !f.encode ? f.getUnencodedContents() : deflate ? deflate(f.getUnencodedContents()) : s.getContents();
  pdf.context.assign(ref, PDFRawStream.of(f.dict, contents));
  p.contentStream = SEALED_CONTENTS;
  // pdf-lib がページの内容の流れを、この欄から引いていること (引いていなければ、置き換えた後の命令が黙って捨てられる)
  if (p.getContentStream() !== SEALED_CONTENTS) throw internalsChanged('PDFPage.getContentStream (contentStream)');
}
const sealed = () => {
  throw new Error(msg('PDF: 描き終えたページに命令を足そうとしました (sealPageContents の後)', 'PDF: tried to add operators to a page that was already finished (after sealPageContents)'));
};
/** 置き換えた後のページの内容の流れの印 (命令を足す・読むと誤り) */
const SEALED_CONTENTS = {
  push: sealed,
  get operators(): never {
    return sealed();
  },
};

export function useDeflate(pdf: PDFDocument, deflate: (data: Uint8Array) => Uint8Array) {
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFFlateStream)) continue;
    const s = obj as unknown as { encode: boolean; contentsCache: Cache<Uint8Array>; getUnencodedContents(): Uint8Array };
    if (s.encode) s.contentsCache = Cache.populatedBy(() => deflate(s.getUnencodedContents()));
  }
}
