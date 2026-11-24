/**
 * pdfLibPatches — pdf-lib と @pdf-lib/fontkit の内部に手を入れる所を 1 か所に集めたもの。
 *
 * pdf-lib の版が上がると壊れうる差し替えは、すべてこのファイルにある:
 *  1. fontkit の TrueType の部分書体 (createSubset の _addGlyph): 字形を 4 バイト境界にそろえる (patchFontkitSubset)
 *  2. CustomFontEmbedder.prototype (isCFF・encodeText・glyphId・embedFontStream): CFF の OpenType を CIDFontType0C で埋め込む (patchCffEmbedding)
 *  3. PngEmbedder.prototype の上に作る、圧縮の済んだ画像の流れを入れる埋め込み部品 (streamEmbedder。PNG の IDAT をそのまま FlateDecode の画像にする
 *     embedPngAsIs と、展開した画素を pdf-lib の pako でなく imageDeflate.ts の関数で圧縮して入れる embedRgbAlpha・embedImageStream)
 *  4. PDFFont の encodeText を結果を覚えるものに差し替え、fontkit の layout を一時的にすり替えて字形の番号から符号にする (memoEncode)
 *  (5. 圧縮の関数の差し替え (PDFFlateStream の contentsCache) は、書き出しを自前にしたので、書き手 (pdfWriter.ts の deflate) に移した)
 *  6. PDFPage の内容の流れ (getContentStream) の命令の並び (operators) をじかに読み書きする (pageOperators。描いた命令を Form XObject に移す)
 *  7. 描き終えたページの内容の流れ (PDFPage の contentStream・contentStreamRef) を、圧縮したバイト列の流れに置き換える (sealPageContents)
 *  8. PDFNumber.of: 絶対値が PDF の実数の最も小さい正規の値 (約 1.175e-38) より小さい数を 0 に、有限でない数・最も大きい値 (約 3.403e38) を超える数を抑える (patchSmallNumbers)
 * (fontkit の異体字の並びの字形の引き方 (CmapProcessor.getVariationSelector) の差し替えは、PDF を作らないときの組版・描画にも
 *  要るので、書体を読む fontManager.ts の patchFontkitVariationSelector にある。同じ理由で、CFF の字形の輪郭の読み
 *  (CFFGlyph の _getPath の hflex・hflex1 と、CFFFont の fdForGlyph の FDSelect の範囲) の差し替えは fontkitCffFlex.ts にある)
 *
 * 前提 (差し替えるメソッドの存在) は、このモジュールを読み込んだときに assertPdfLibInternals で確かめる。
 * 「差し替え済み」の印はモジュールの変数でなく、差し替えた原型 (prototype) 自体に付ける (テストで同じ pdf-lib を複数回読み込んでも二重に包まない)
 */
import { Cache, CustomFontEmbedder, CustomFontSubsetEmbedder, PDFContentStream, PDFContext, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFImage, PDFNumber, PDFPage, PDFRawStream, PDFRef, PngEmbedder } from 'pdf-lib';
import type { PDFOperator } from 'pdf-lib';
import type { FontManager } from './fontManager';
import { decodeJpeg } from './jpeg';
import { decodePngForPdf, pngDataComplete, pngFilterBytesOk, pngWithinLimits } from './pixels';
import { imageDeflater, inflateNode, type ImageDeflate } from './imageDeflate';
import { inflateFast } from './inflateFast';
import { cffGidToCid, cffTable, subsetCff } from './cff';
import { msg } from './messages';
import { KumioriError } from './errors';
import { rejoin, thisCall } from './callContext';

/** 差し替え済みの印 (原型に付ける) */
const PATCHED = Symbol.for('kumiori.pdfLibPatched');

/** pdf-lib の中の欄・メソッドが見つからないときの誤り (pdf-lib の版が変わったことをはっきり知らせる) */
const internalsChanged = (what: string) => new KumioriError('internal/patch-mismatch', msg(`pdf-lib の ${what} が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)`, `pdf-lib ${what} not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)`));

/** PDF の実数の最も大きい値 (ISO 32000-1 の附属書 C の表 C.1 の 32 ビットの浮動小数の値) */
export const PDF_REAL_MAX = 3.403e38;

/**
 * PDF の数 (PDFNumber.of) で、絶対値が PDF の実数の最も小さい正規の値 (約 1.175e-38。ISO 32000-1 の附属書 C の表 C.1 が示す、
 * 32 ビットの浮動小数の値) より小さい数を 0 にする。pdf-lib の numberToString は、指数の形の数を小数に書き直すとき、10 の 308 乗を
 * 超える桁 (1e-320 などの非正規化数) で Infinity を掛け、「0.000…finity」のような PDF の数でない字を書いていた (ISO 32000-2 §7.3.3 の実数は、
 * 指数を書かない小数)。それより大きい小さな数 (大きな viewBox の SVG を置く倍率 5e-8 など) は、0 にすると絵が消えるので、そのまま書く。
 * 有限でない数も PDF の数でない字 (「Infinity」「NaN」) になり、読み手が構文の誤りで止まる (viewBox 1e300 の SVG を scale(1e10) で置くなど) ので、
 * NaN は 0 に、無限大と、最も大きい値を超える数は、最も大きい値 (符号は残す) にする
 */
export function patchSmallNumbers() {
  const cls = PDFNumber as unknown as Record<symbol, unknown> & { of(n: number): PDFNumber };
  if (cls[PATCHED]) return;
  if (typeof cls.of !== 'function') throw internalsChanged('PDFNumber.of');
  const orig = cls.of.bind(PDFNumber);
  cls.of = (n: number) => orig(Number.isNaN(n) ? 0 : Math.abs(n) < 1.175494e-38 ? 0 : Math.max(-PDF_REAL_MAX, Math.min(PDF_REAL_MAX, n)));
  cls[PATCHED] = true;
}

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
  if (!Array.isArray(ops)) throw new KumioriError('internal/patch-mismatch', msg('pdf-lib の PDFPage.getContentStream().operators が見つかりません (pdf-lib の版が変わり、pdfLibPatches.ts の差し替えが合いません)', 'pdf-lib PDFPage.getContentStream().operators not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
  if (typeof proto._addGlyph !== 'function') throw new KumioriError('internal/patch-mismatch', msg('@pdf-lib/fontkit の部分書体の _addGlyph が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)', '_addGlyph of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
    if (!empty) throw new KumioriError('internal/patch-mismatch', msg('fontkit の部分書体の字形のデータの型が分かりません', 'unknown type of glyph data in the fontkit subset'));
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
  if (typeof sample.encodeStream !== 'function' || typeof sample.encode !== 'function') throw new KumioriError('internal/patch-mismatch', msg('@pdf-lib/fontkit の部分書体の encodeStream が見つかりません (fontkit の版が変わり、pdfLibPatches.ts の差し替えが合いません)', 'encodeStream of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
    return context.register(context.flateStream(rejoin(thisCall(), await this.serializeFont()), { Subtype: subtype }));
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

/** 展開せずに入れる PNG の選び方と、展開して入れる画像の圧縮 (embedPngChecked・embedCmykImage) */
export interface PngEmbedOptions {
  /**
   * 16 ビットの PNG も、展開せずに BitsPerComponent 16 の画像として入れるか。16 は PDF 1.5 から (PDF Reference の PDF 1.5 版 §4.8.4)
   * なので、PDF 1.3・1.4 が元の PDF/X-1a・X-3 では false (展開して 8 ビットにする。pdf-lib と同じ、上位の 8 ビット)。既定 false
   */
  bits16?: boolean;
  /** 展開した画素を圧縮する関数 (imageDeflate.ts の imageDeflater。既定は imageDeflater()) */
  deflate?: ImageDeflate;
}

/** 展開せずに入れられる PNG の中身 (pngAsIs) */
interface PngAsIs {
  width: number;
  height: number;
  /** ビットの深さ (BitsPerComponent) */
  depth: number;
  /** 1 画素の成分の数 (DecodeParms の Colors) */
  colors: number;
  /** 色空間 (DeviceGray・DeviceRGB・色の表の Indexed) */
  colorSpace: unknown[] | string;
  /** IDAT をつないだもの (PNG の予測のフィルタ付きの zlib) */
  data: Uint8Array;
}

/**
 * IDAT をつないだ zlib の列 data が、走査線の大きさ need バイト (飛び越しでない並びの「(1 行のバイト数 + フィルタの 1 バイト) × 高さ」。
 * PNG の仕様 §7.2・§9.1) まで展開できるか。そのまま入れる PNG でも、切れた・壊れた画素のデータは、PDF を見る側で画像の流れの誤りになるので、
 * 入れる前に確かめる (pixels.ts の pngDataComplete と同じ確かめ)。Node では zlib で展開して見る (自前の展開より速い)。
 * zlib が断ったとき (Node でない・壊れた・need より長い) は、自前の展開 (inflateFast.ts の inflateFast) で、need まで出るかを見る
 */
function idatComplete(data: Uint8Array, width: number, height: number, bpp: number): boolean {
  const need = (Math.ceil((width * bpp) / 8) + 1) * height;
  // 長さに加えて、各行の頭のフィルタの種類のバイトが 0〜4 かも見る (pixels.ts の pngFilterBytesOk。5 以上の行のある PNG を、
  // そのまま Predictor 15 の画像として入れない)。zlib が断ったときの自前の展開も、走査線の大きさまでのバイト列を作って見る
  let raw = inflateNode(data, need);
  if (!raw || raw.length < need) raw = inflateFast(data, need);
  return raw.length >= need && pngFilterBytesOk(raw, width, height, bpp, false);
}

/**
 * 展開せずに FlateDecode (Predictor 15) の画像にできる PNG か。PNG の圧縮データ (IDAT をつないだもの) は、走査線ごとに PNG の予測の
 * フィルタの種類のバイトが付いた zlib (W3C の PNG の仕様 (Second Edition) §9・§10) なので、PDF の Flate の PNG の予測 (Predictor 15。
 * ISO 32000-2 §7.4.4.4 の表 10) の入力と同じ形になる。予測の 1 画素のバイト数は、どちらも成分の数 × ビットの深さを 8 で割って切り上げたもの。
 * 入れられるのは、飛び越しでなく、透明度 (tRNS) の無い、次の形 (§11.2.2 の表 11.1):
 *  - 灰 (色の型 0): 1・2・4・8 ビット (と、bits16 なら 16 ビット)。DeviceGray。PNG の灰の値 v / (2^深さ − 1) は、
 *    PDF の既定の Decode [0 1] の値と同じ (ISO 32000-2 §8.9.5.2)
 *  - RGB (色の型 2): 8 ビット (と、bits16 なら 16 ビット)。DeviceRGB
 *  - 色の表 (色の型 3): 1・2・4・8 ビット。Indexed (ISO 32000-2 §8.6.6.3)。表 (PLTE。§11.2.3) は 2^深さ の項に 0 (黒) で埋める
 *    (表に無い番号の画素は、pdf-lib の展開 (UPNG) が黒にするのと同じ)
 * 16 ビットの成分は、PNG も PDF も、上位のバイトが先 (PNG の §7.1・ISO 32000-2 §8.9.5.2)。
 * α・tRNS・飛び越しのあるもの、IHDR が最初のチャンクでない・長さが 13 でないもの (§5.6・§11.2.2)、色の表が IDAT の後・項の数が合わないものは undefined。
 * 形は合うが、画素のデータが終わりまで展開できない (切れた・壊れた) ものは 'broken' (checked のときは確かめない。呼ぶ側で確かめたもの)
 */
function pngAsIs(png: Uint8Array, bits16: boolean, checked = false): PngAsIs | 'broken' | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return undefined;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (dv.getUint32(8) !== 13 || String.fromCharCode(png[12], png[13], png[14], png[15]) !== 'IHDR') return undefined;
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const [depth, colorType, compression, filter, interlace] = png.subarray(24, 29);
  if (!width || !height || compression || filter || interlace) return undefined;
  const depths = colorType === 0 ? [1, 2, 4, 8, ...(bits16 ? [16] : [])] : colorType === 2 ? [8, ...(bits16 ? [16] : [])] : colorType === 3 ? [1, 2, 4, 8] : [];
  if (!depths.includes(depth)) return undefined;
  let plte: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let at = 33; at + 8 <= png.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const body = png.subarray(at + 8, at + 8 + len);
    if (body.length < len) return undefined;
    if (type === 'tRNS' || type === 'IHDR') return undefined;
    if (type === 'PLTE') {
      // 色の表は IDAT の前に 1 つ (§5.6)。項の数は 1〜2^深さ (§11.2.3)
      if (plte || idat.length || len % 3 || !len || len / 3 > 2 ** Math.min(depth, 8)) return undefined;
      plte = body;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!idat.length || (colorType === 3 && !plte)) return undefined;
  const data = idat.length === 1 ? idat[0] : new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  if (idat.length > 1) idat.reduce((o, b) => (data.set(b, o), o + b.length), 0);
  const colors = colorType === 2 ? 3 : 1;
  if (!checked && !idatComplete(data, width, height, colors * depth)) return 'broken';
  let colorSpace: PngAsIs['colorSpace'] = colorType === 2 ? 'DeviceRGB' : 'DeviceGray';
  if (colorType === 3 && plte) {
    const table = new Uint8Array(3 << depth);
    table.set(plte);
    colorSpace = ['Indexed', 'DeviceRGB', (1 << depth) - 1, PDFHexString.of(Array.from(table, (b) => b.toString(16).padStart(2, '0')).join(''))];
  }
  return { width, height, depth, colors, colorSpace, data };
}

/**
 * 画像の XObject の流れを作って入れる部品。PDFImage は pdf-lib の PngEmbedder しか受け付けないので、その原型の上に、埋め込み方だけを差し替えた部品を作る。
 * make は、圧縮の済んだ流れ (context.stream。PDFRawStream) を返す (pdf-lib の圧縮 (pako) を通さない)
 */
function streamEmbedder(width: number, height: number, make: (context: PDFContext) => PDFRawStream): PngEmbedder {
  return Object.assign(Object.create(PngEmbedder.prototype) as PngEmbedder, {
    width,
    height,
    async embedIntoContext(context: PDFContext, ref?: PDFRef) {
      const stream = make(context);
      if (ref) {
        context.assign(ref, stream);
        return ref;
      }
      return context.register(stream);
    },
  });
}

/**
 * JPEG を、いま埋め込む (pdf-lib の embedJpg は番号だけを取り、流れは保存の前の flush で入れる)。JPEG の埋め込みは、取った番号に流れを入れるだけで
 * 新しい番号を取らないので、いま入れても保存のときに入れても、同じ PDF になる。PDF を流して書くとき、埋め込んだ画像をすぐ書き出し先へ書けるようにする
 */
export async function embedJpgNow(pdf: PDFDocument, jpg: Uint8Array): Promise<PDFImage> {
  const img = rejoin(thisCall(), await pdf.embedJpg(jpg));
  rejoin(thisCall(), await img.embed());
  return img;
}

/** 部品 embedder の画像を、いま埋め込む (番号を取って、流れを入れる) */
async function embedNow(pdf: PDFDocument, embedder: PngEmbedder): Promise<PDFImage> {
  const img = PDFImage.of(pdf.context.nextRef(), pdf, embedder);
  rejoin(thisCall(), await img.embed());
  return img;
}

/**
 * 展開せずに埋め込める PNG (pngAsIs) は、IDAT をそのまま FlateDecode (Predictor 15) の画像にする。
 * 条件に合わなければ undefined (展開して埋め込む)。画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) は、呼ぶ側で確かめる
 * (そのまま入れても、PDF を見る側が同じだけ展開する)。
 * 画素のデータが終わりまで展開できない PNG は、埋め込まずに投げる (展開して埋め込むときの pngDataComplete と同じ断り。
 * 確かめないと、切れた画素のデータが、知らせなしに壊れた画像の流れとして PDF に入る)。checked は、呼ぶ側で展開して確かめた PNG (確かめを省く)
 */
export async function embedPngAsIs(pdf: PDFDocument, png: Uint8Array, o: Pick<PngEmbedOptions, 'bits16'> = {}, checked = false): Promise<PDFImage | undefined> {
  const a = pngAsIs(png, o.bits16 ?? false, checked);
  if (a === 'broken') throw brokenPng();
  if (!a) return undefined;
  const { width, height, depth, colors, colorSpace, data } = a;
  const embedder = streamEmbedder(width, height, (context) =>
    context.stream(data, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: width,
      Height: height,
      BitsPerComponent: depth,
      ColorSpace: colorSpace,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: depth, Columns: width },
    } as never),
  );
  try {
    return rejoin(thisCall(), await embedNow(pdf, embedder));
  } catch {
    // 埋め込めなければ、展開して埋め込む
    return undefined;
  }
}

/** 画素のデータが終わりまで展開できない PNG の誤り */
const brokenPng = () => new Error(msg('PNG: 画素のデータが壊れています', 'PNG: the pixel data is broken'));

/** 展開した PNG の画素 (8 ビットの RGB と、透明な画素があれば α) */
interface PngPixels {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha?: Uint8Array;
}

/**
 * PNG を、8 ビットの RGB と α に展開する。8 ビット・飛び越しでない、α の付いた PNG は自前で展開し (pixels.ts の decodePngForPdf。
 * pdf-lib の展開は、1 億画素で 10 秒かかる)、ほかの形 (16 ビット・色の表・tRNS・飛び越しなど) は pdf-lib の展開 (UPNG。PngEmbedder.for) に任せる。
 * どちらも、pdf-lib の embedPng と同じ RGB と α (α が全部 255 なら無し) になる。
 * 画素のデータが終わりまで展開できなければ 'broken'。pngWithinLimits を通った PNG に使う
 */
async function decodePngPixels(png: Uint8Array): Promise<PngPixels | 'broken'> {
  const own = decodePngForPdf(png);
  if (own) return own;
  // pdf-lib の展開に渡す前に、画素のデータが終わりまで展開できることを確かめる (壊れたデータで、pdf-lib の展開が止まらなくなる。pngDataComplete)
  if (!pngDataComplete(png)) return 'broken';
  const e = rejoin(thisCall(), await PngEmbedder.for(png));
  const img = (e as unknown as { image?: { rgbChannel: Uint8Array; alphaChannel?: Uint8Array; bitsPerComponent: number; width: number; height: number } }).image;
  if (!img || img.bitsPerComponent !== 8 || img.rgbChannel.length !== img.width * img.height * 3) throw internalsChanged('PngEmbedder の image');
  return { width: img.width, height: img.height, rgb: img.rgbChannel, ...(img.alphaChannel ? { alpha: img.alphaChannel } : {}) };
}

/**
 * 展開した RGB と α を、圧縮してから埋め込む。辞書は pdf-lib の PngEmbedder (embedIntoContext・embedAlphaChannel) の作るものと同じ
 * (α は DeviceGray・Decode [0 1] の SMask)。圧縮は deflate (pdf-lib の pako でなく)
 */
async function embedRgbAlpha(pdf: PDFDocument, px: PngPixels, deflate: ImageDeflate): Promise<PDFImage> {
  const { width, height } = px;
  const rgb = rejoin(thisCall(), await deflate(px.rgb));
  const alpha = px.alpha ? rejoin(thisCall(), await deflate(px.alpha)) : undefined;
  const embedder = streamEmbedder(width, height, (context) => {
    const smask = alpha
      ? context.register(context.stream(alpha, { Type: 'XObject', Subtype: 'Image', Height: height, Width: width, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Decode: [0, 1], Filter: 'FlateDecode' }))
      : undefined;
    return context.stream(rgb, { Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: width, Height: height, ColorSpace: 'DeviceRGB', ...(smask ? { SMask: smask } : {}), Filter: 'FlateDecode' });
  });
  return embedNow(pdf, embedder);
}

/**
 * PNG を埋め込む: 展開せずに入れられるもの (pngAsIs) は embedPngAsIs、ほかは展開して (decodePngPixels)、RGB と α を o.deflate で圧縮して入れる。
 * どちらも、画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) を超える PNG は埋め込まずに投げる
 * (展開せずに入れても、PDF を見る側が同じだけ展開する)
 */
export async function embedPngChecked(pdf: PDFDocument, png: Uint8Array, o: PngEmbedOptions = {}): Promise<PDFImage> {
  if (!pngWithinLimits(png)) throw new Error(msg('PNG: 画素の数か展開の大きさが上限を超えます', 'PNG: the number of pixels or the decompressed size exceeds the limit'));
  const asIs = rejoin(thisCall(), await embedPngAsIs(pdf, png, o));
  if (asIs) return asIs;
  const px = rejoin(thisCall(), await decodePngPixels(png));
  if (px === 'broken') throw brokenPng();
  return embedRgbAlpha(pdf, px, o.deflate ?? imageDeflater());
}

/**
 * 入稿用 (PDF/X) の出力: RGB の画像 (PNG・JPEG) を画素に戻し、CMYK (DeviceCMYK・8 ビット・FlateDecode) の画像として埋め込む。
 * 色の変換は toCmyk (ICC の変換はしない)。透明度は SMask (DeviceGray) として残し、hasAlpha で知らせる。
 * 灰色だけの画像 (画素がすべて R = G = B。RGB・RGBA の PNG、16 ビット・1 ビットの灰色の PNG、灰色 + α の PNG も、展開すると RGB の
 * 3 つの成分になる) は、DeviceGray (8 ビット・FlateDecode) の画像にする (pdfStandard.ts の PdfStandard.cmyk: 灰色の画像は DeviceGray。
 * 値は R の成分そのものなので、濃さは変わらない。ISO 32000-2 §8.6.4.2・§10.4.2.2: DeviceRGB の r = g = b と、DeviceGray の同じ値は同じ灰色)。
 * 呼ぶ側のふつうの埋め込みは、灰色 (色の型 0) の PNG のほかを DeviceRGB で書くので、PDF/X-1a・X-3 の検査で止まっていた。
 * 展開せずにそのまま DeviceGray で入れられる PNG (灰色・インターレース無し・tRNS 無し。16 ビットは o.bits16 のときだけ) は、そのまま入れる (embedPngAsIs)。
 * 展開した画素は o.deflate で圧縮する。CMYK・灰色の JPEG (成分が 3 でないもの)・読めない画像は undefined (呼ぶ側で、ふつうに埋め込む)
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
  o: PngEmbedOptions = {},
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
    if (!pngWithinLimits(bytes)) return undefined;
    let px: PngPixels | 'broken';
    try {
      px = rejoin(thisCall(), await decodePngPixels(bytes));
    } catch {
      return undefined;
    }
    if (px === 'broken') return undefined;
    ({ width, height, rgb } = px);
    alpha = px.alpha;
  }
  if (alpha && alphaMode === 'skip') return { hasAlpha: true, width, height };
  let colourful = false;
  for (let i = 0; i < rgb.length && !colourful; i += 3) colourful = rgb[i] !== rgb[i + 1] || rgb[i + 1] !== rgb[i + 2];
  const deflate = o.deflate ?? imageDeflater();
  if (!colourful) {
    // 灰色 (IHDR の色の型 0) の PNG は、展開せずにそのまま DeviceGray で入れる (透明度が無いとき。tRNS があれば embedPngAsIs が断る)
    if (kind === 'png' && !alpha && bytes[25] === 0) {
      // 画素のデータは、上の展開 (decodePngPixels) で確かめてある
      const asIs = rejoin(thisCall(), await embedPngAsIs(pdf, bytes, o, true));
      if (asIs) return { image: asIs, hasAlpha: false };
    }
    const gray = new Uint8Array(width * height);
    for (let i = 0, o = 0; o < gray.length; i += 3, o++) gray[o] = rgb[i];
    return { image: rejoin(thisCall(), await embedImageStream(pdf, gray, width, height, 'DeviceGray', alpha, deflate)), hasAlpha: !!alpha };
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
  return { image: rejoin(thisCall(), await embedImageStream(pdf, cmyk, width, height, 'DeviceCMYK', alpha, deflate)), hasAlpha: !!alpha };
}

/** 8 ビットの画素 data (色空間 colorSpace の成分の並び) を、deflate で圧縮して FlateDecode の画像として埋め込む。alpha があれば SMask (DeviceGray) にする */
async function embedImageStream(pdf: PDFDocument, data: Uint8Array, width: number, height: number, colorSpace: 'DeviceCMYK' | 'DeviceGray', alpha: Uint8Array | undefined, deflate: ImageDeflate): Promise<PDFImage> {
  const z = rejoin(thisCall(), await deflate(data));
  const za = alpha ? rejoin(thisCall(), await deflate(alpha)) : undefined;
  const embedder = streamEmbedder(width, height, (context) => {
    const smask = za ? context.register(context.stream(za, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' })) : undefined;
    return context.stream(z, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: colorSpace, ...(smask ? { SMask: smask } : {}), Filter: 'FlateDecode' });
  });
  return embedNow(pdf, embedder);
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

/**
 * 描き終えたページの内容の流れを、保存のときと同じに圧縮したバイト列の流れ (PDFRawStream) に、同じ番号のまま置き換える。
 * pdf-lib は、ページの命令 (PDFOperator) を保存まで持つので、数千ページの文書では、命令だけで数百 MB になっていた。
 * 圧縮は、保存のときと同じ: deflate を渡せば deflate (書き手 (pdfWriter.ts) が圧縮する流れに当てるもの)、無ければ pdf-lib の圧縮 (pako)。
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
  pdf.context.assign(ref, sealContentStream(s, deflate));
  p.contentStream = SEALED_CONTENTS;
  // pdf-lib がページの内容の流れを、この欄から引いていること (引いていなければ、置き換えた後の命令が黙って捨てられる)
  if (p.getContentStream() !== SEALED_CONTENTS) throw internalsChanged('PDFPage.getContentStream (contentStream)');
}
/**
 * 内容の流れ (Form XObject など) を、圧縮したバイト列の流れにする (sealPageContents と同じ圧縮。命令を保存まで持たない)
 */
export function sealContentStream(s: PDFContentStream, deflate?: (data: Uint8Array) => Uint8Array): PDFRawStream {
  const f = s as unknown as { encode: unknown; getUnencodedContents(): Uint8Array; dict: unknown };
  if (typeof f.encode !== 'boolean' || !(f.dict instanceof PDFDict)) throw internalsChanged('PDFContentStream.encode・dict');
  const contents = !f.encode ? f.getUnencodedContents() : deflate ? deflate(f.getUnencodedContents()) : s.getContents();
  return PDFRawStream.of(f.dict, contents);
}
const sealed = () => {
  throw new KumioriError('internal/page-sealed', msg('PDF: 描き終えたページに命令を足そうとしました (sealPageContents の後)', 'PDF: tried to add operators to a page that was already finished (after sealPageContents)'));
};
/** 置き換えた後のページの内容の流れの印 (命令を足す・読むと誤り) */
const SEALED_CONTENTS = {
  push: sealed,
  get operators(): never {
    return sealed();
  },
};
