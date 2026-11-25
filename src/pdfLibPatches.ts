/**
 * pdfLibPatches — pdf-lib と @pdf-lib/fontkit の内部に手を入れる所を 1 か所に集めたもの。
 *
 * pdf-lib の版が上がると壊れうる差し替えは、すべてこのファイルにある:
 *  1. fontkit の TrueType の部分書体 (createSubset の _addGlyph): 字形を 4 バイト境界にそろえる (patchFontkitSubset)
 *  2. CustomFontEmbedder.prototype (isCFF・encodeText・glyphId・embedFontStream): CFF の OpenType を CIDFontType0C で埋め込む (patchCffEmbedding)
 *  (3. PngEmbedder.prototype の上に作っていた画像の埋め込み部品は、画像の埋め込みを自前にしたので、imageEmbed.ts に移した (pdf-lib の
 *      embedJpg・embedPng・PngEmbedder・PDFImage を使わずに、画像の XObject を直に作る))
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
import { Cache, CustomFontEmbedder, CustomFontSubsetEmbedder, PDFContentStream, PDFContext, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFNumber, PDFPage, PDFRawStream, PDFRef } from 'pdf-lib';
import type { PDFOperator } from 'pdf-lib';
import type { FontManager } from './fontManager';
import { cffGidToCid, cffTable, subsetCff } from './cff';
import { msg } from './messages';
import { KumioriError } from './errors';
import { rejoin, thisCall } from './callContext';

/** 差し替え済みの印 (原型に付ける) */
const PATCHED = Symbol.for('kumiori.pdfLibPatched');

/** pdf-lib の中の欄・メソッドが見つからないときの誤り (pdf-lib の版が変わったことをはっきり知らせる) */
const internalsChanged = (what: string) => new KumioriError('internal/patch-mismatch', msg(`pdf-lib の ${what} が見つかりません (pdf-lib のバージョンが変わり、pdfLibPatches.ts の差し替えが合いません)`, `pdf-lib ${what} not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)`));

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
  if (!Array.isArray(ops)) throw new KumioriError('internal/patch-mismatch', msg('pdf-lib の PDFPage.getContentStream().operators が見つかりません (pdf-lib のバージョンが変わり、pdfLibPatches.ts の差し替えが合いません)', 'pdf-lib PDFPage.getContentStream().operators not found (the pdf-lib version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
  if (typeof proto._addGlyph !== 'function') throw new KumioriError('internal/patch-mismatch', msg('@pdf-lib/fontkit のサブセットフォントの _addGlyph が見つかりません (fontkit のバージョンが変わり、pdfLibPatches.ts の差し替えが合いません)', '_addGlyph of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
    if (!empty) throw new KumioriError('internal/patch-mismatch', msg('fontkit のサブセットフォントの字形のデータの型が分かりません', 'unknown type of glyph data in the fontkit subset'));
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
  if (typeof sample.encodeStream !== 'function' || typeof sample.encode !== 'function') throw new KumioriError('internal/patch-mismatch', msg('@pdf-lib/fontkit のサブセットフォントの encodeStream が見つかりません (fontkit のバージョンが変わり、pdfLibPatches.ts の差し替えが合いません)', 'encodeStream of the @pdf-lib/fontkit subset not found (the fontkit version has changed and the patches in pdfLibPatches.ts no longer fit)'));
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
  throw new KumioriError('internal/page-sealed', msg('PDF: 描画し終えたページに命令を追加しようとしました (sealPageContents の後)', 'PDF: tried to add operators to a page that was already finished (after sealPageContents)'));
};
/** 置き換えた後のページの内容の流れの印 (命令を足す・読むと誤り) */
const SEALED_CONTENTS = {
  push: sealed,
  get operators(): never {
    return sealed();
  },
};
