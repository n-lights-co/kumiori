/**
 * canvasRenderer — SheetArea を Canvas 2D に描画する。
 * ctx を scale(px/pt) して pt 単位のまま描くため、レイアウトと画素の対応が崩れない。
 */
import { limits } from './limits';
import type { FontManager } from './fontManager';
import { uprightPositions } from './areaResources';
import { toCss } from './color';
import { FAKE_BOLD, ITALIC_SLANT, paintPlaceholder, paintSheet, pdfPlaceholderDiagnostic, type Line, type Matrix, type Painter, type PathSeg } from './paint';
import type { AssetStore, ImageAsset } from './assets';
import { readGradientSvg, type GradientPaint } from './cssGradient';
import { colorFontOf } from './colorGlyph';
import { drawColorGlyphArea } from './colorGlyphCanvas';
import type { Area, GlyphArea, ImageArea, Rect, SheetArea } from './types';
import { msg } from './messages';
import { diag, type Diagnostic } from './diagnostics';
import { parseSvg, type SvgDoc, type XmlNode } from './svg';
import { paintShapesToPixelsWithin, rasterFilter, shapesCostPerPixel } from './svgFilterRaster';
import { outlineText, registerSvgFonts, svgLanguageTag } from './pdfRenderer';
import { fromBase64 } from './base64';
import { resolveRef } from './resources';
import { decodeBmp, decodeGif, encodePngStored } from './pixels';
import { decodeWebp } from './webp';
import { walkAreas } from './areaTree';
import { hrefOfTag } from './xmlAttr';
import { rejoin, thisCall } from './callContext';
import { exifSwapsAxes } from './exifOrientation';

export { exifSwapsAxes };

export interface CanvasRenderOptions {
  /** 1pt あたりの CSS px (既定 1.3333 = 96dpi) */
  scale?: number;
  devicePixelRatio?: number;
  /** 仕上がり・塗り足しのガイド線(画面確認用。印刷物には出ない) */
  guides?: boolean;
  /** 画像 (fo:external-graphic) の登録所 */
  assets?: AssetStore;
  /**
   * 字を、書体ファイルの輪郭 (fontkit の字形) から描く。既定は false (ブラウザに登録した書体 (FontFace) で fillText する)。
   * 書体をブラウザに登録していないとき (公開 API の renderPage) に使う
   */
  glyphOutlines?: boolean;
  /**
   * SVG の画像を図形にして描くときの XML のパーサ。ブラウザの画像 (<img>) で SVG を読めない所 (Web Worker の中) の SVG の画像は、
   * ブラウザの画像 (ImageAsset.element) を持たないので、これで図形にして、画素にして描く (drawSvgShapes)
   */
  parseXml?: (xml: string) => XmlNode;
  /** 描けない SVG の画像などの警告を足す先 */
  warn?: (d: Diagnostic) => void;
  /** SVG の画像 1 つを画素にする手間の上限 (既定 SVG_RASTER_BUDGET。1 回の描画の合計は、この 4 倍)。試しで小さくするためのもの */
  svgRasterBudget?: number;
  /**
   * 読み込みのときに画素にしなかった画像 (ImageAsset.deferred) の、画像の中身ごとのブラウザーの画像 (画像のキャッシュから描画の前に引いたもの。
   * imageCache.ts)。無い画像は描画しない
   */
  deferredImage?: (bytes: Uint8Array) => CanvasImageSource | undefined;
}

/**
 * ページの描画に要る、読み込みのときに画素にしなかった画像 (ImageAsset.deferred) の中身と種類 (renderPage が、描画の前に画像のキャッシュから引く)。
 * 画像の領域と背景の画像 (重ねた背景も) と、SVG の画像の中から参照する画像のファイル (Web Worker の中で SVG を図形にして描くとき)
 */
export function deferredImagesOf(sheet: SheetArea, assets: AssetStore): Array<{ bytes: Uint8Array; mime: string }> {
  const out = new Map<Uint8Array, string>();
  const seenSvg = new Set<ImageAsset>();
  const add = (a: ImageAsset | undefined) => {
    if (a?.deferred && a.bytes) out.set(a.bytes, a.mime);
  };
  const visit = (src: string) => {
    const a = assets.peek(src);
    add(a);
    // SVG の中の image の外のファイル (SVG の場所が基準。svgShapesOf と同じ)
    if (a?.mime === 'image/svg+xml' && a.bytes && !a.element && !seenSvg.has(a)) {
      seenSvg.add(a);
      const text = new TextDecoder().decode(a.bytes);
      if (!/<(?:[\w-]+:)?image\b/i.test(text)) return;
      const base = /^data:/i.test(a.key) ? undefined : a.key;
      for (const m of text.matchAll(/<(?:[\w-]+:)?image\b[^>]*>/gi)) {
        const href = hrefOfTag(m[0]);
        if (href && !/^data:/i.test(href)) add(assets.peek(resolveRef(href, base)));
      }
    }
  };
  walkAreas(sheet, (a) => {
    if (a.type === 'image') return void visit(a.src);
    const bgi = a.backgroundImage;
    if (bgi) visit(bgi.src);
    for (const l of bgi?.under ?? []) visit(l.src);
  });
  return [...out].map(([bytes, mime]) => ({ bytes, mime }));
}

/** 描く先の Canvas (画面の canvas 要素か、Web Worker の中でも使える OffscreenCanvas) */
export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * SVG の画像を図形にしたもの。書体 (字の輪郭) ごと・SVG の中身ごと・置いた所の言語ごと (読めなければ null)。
 * 書体が足されたら (SVG の @font-face を後から読み込んだときなど。fonts の数で見分ける)、作り直す (古い書体の輪郭のまま描かない)
 */
const svgShapeCache = new WeakMap<FontManager, { fontCount: number; byBytes: WeakMap<Uint8Array, Map<string, SvgDoc | null>> }>();
/**
 * SVG の画像を画素にしたもの。図形 (SvgDoc) ごとに、画素の大きさ・置き方ごとに覚える (同じ SVG を 2 つの大きさで置いても、
 * 描き直すたびに画素にし直さない)。画素は SvgDoc の弱い表に持つので、組んだ結果を捨てて SvgDoc が消えれば、一緒に消える
 * (長く使う Web Worker で組み直しても、前の文書の画素を持ち続けない)。
 * 覚える画素の合計は SVG_RASTER_CACHE_PIXELS まで: 合計の数と、使った順の表 (svgRasterOrder) だけを外に持ち、超えたら、
 * 最も前に使ったものから捨てる。表は SvgDoc を弱く指す (WeakRef。ECMAScript 2021 §26.1) ので、表が画素を生かしておくことはない
 */
type SvgRaster = { pixels: number; image: CanvasImageSource };
const svgRasters = new WeakMap<SvgDoc, Map<string, SvgRaster>>();
/** 使った順の表 (初めが最も前に使ったもの)。鍵は図形の番号と画素の鍵 */
const svgRasterOrder = new Map<string, { doc: WeakRef<SvgDoc>; key: string; pixels: number }>();
/** 使った順の表にある画素の数の合計 (消えた SvgDoc の分は、消えたと分かったときに引く) */
let svgRasterPixels = 0;
/** 図形の番号 → 使った順の表の鍵 (SvgDoc が消えたときに、表から除く) */
const svgRasterKeysOfDoc = new Map<number, Set<string>>();
/**
 * SvgDoc が消えたら、その画素の数を合計から引く (FinalizationRegistry。ECMAScript 2021 §26.2)。
 * 無い環境では、消えた SvgDoc の分は、表の初めから捨てるときに引く (それまでは合計に数えたまま: 覚える量が控えめになるだけ)
 */
const svgRasterGone =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>((id) => {
        for (const k of svgRasterKeysOfDoc.get(id) ?? []) {
          const e = svgRasterOrder.get(k);
          if (!e) continue;
          svgRasterOrder.delete(k);
          svgRasterPixels -= e.pixels;
        }
        svgRasterKeysOfDoc.delete(id);
      })
    : undefined;
/**
 * WeakRef の無い環境 (古いブラウザ) では、使った順の表を持てない (強く指すと、画素が消えない) ので、SvgDoc ごとに、
 * 最後に使った SVG_RASTER_FALLBACK_PER_DOC 枚だけを覚える (合計の上限は無いが、どれも SvgDoc と一緒に消える)
 */
const SVG_RASTER_FALLBACK_PER_DOC = 2;
/** 画素にした図形の番号 (使った順の表の鍵) */
const svgDocIds = new WeakMap<SvgDoc, number>();
let svgDocNext = 0;
/** SVG の画像を画素にするときの画素の数の上限 (大きく置いた画像は、解像度を下げて描く) */
export const SVG_RASTER_MAX_PIXELS = 16_000_000;
/**
 * 覚えておく、画素にした SVG の画素の数の合計の上限。RGBA 8 ビットで 128MB (1 画素 4 バイト × 3,200 万)。1 枚の上限 (SVG_RASTER_MAX_PIXELS) の
 * 2 枚分: いちばん大きく置いた画像を覚えたまま、もう 1 つの画像も覚えられる (A4 のページ全体の SVG を 300dpi 相当 (約 870 万画素) で描いても、3 枚は持てる)
 */
const SVG_RASTER_CACHE_PIXELS = 32_000_000;
/**
 * SVG の画像 1 つを画素にする手間の上限 (svgFilterRaster.ts の charge の単位。1 単位はおよそ 0.5ns (2026 年の x86 の Node 22) で、
 * 80 億単位は数秒)。図形を画素にする処理 (paintShapes) は、図形ごとに画像の全体を回すので、手間は「図形の数 × 画素の数」になる
 * (ページ全体の矩形 1,000 個の 1KB 足らずの SVG を 1,600 万画素で描くと、数分かかっていた)。
 * 見積もり (shapesCostPerPixel × 画素の数) がこれを超える画像は、超えない画素の数まで解像度を下げて描く。
 * 1 回の描画 (renderSheetToCanvas) の手間の合計は、この 4 倍まで。超えた後の画像と、見積もりを外れて 1 つの上限の 2 倍を超えた画像は、
 * 仮の枠で描いて警告に出す
 */
export const SVG_RASTER_BUDGET = 8_000_000_000;

/** 図形 doc を key (画素の大きさ・置き方) で画素にしたもの (覚えていなければ undefined)。見つけたら、最近に使ったものにする */
function rasterOf(doc: SvgDoc, key: string): SvgRaster | undefined {
  const own = svgRasters.get(doc);
  const hit = own?.get(key);
  if (!own || !hit) return undefined;
  // 最近に使ったものを、表の終わりへ (捨てるのは、表の初めから)
  own.delete(key);
  own.set(key, hit);
  const id = svgDocIds.get(doc);
  const k = `${id}\u0000${key}`;
  const e = svgRasterOrder.get(k);
  if (e) {
    svgRasterOrder.delete(k);
    svgRasterOrder.set(k, e);
  }
  return hit;
}

/** 図形 doc を key で画素にしたもの r を覚える。合計が上限を超えたら、最も前に使ったものから捨てる (いま覚えたものは捨てない) */
function keepRaster(doc: SvgDoc, key: string, r: SvgRaster) {
  let own = svgRasters.get(doc);
  if (!own) svgRasters.set(doc, (own = new Map()));
  own.set(key, r);
  if (typeof WeakRef !== 'function') {
    for (const k of own.keys()) {
      if (own.size <= SVG_RASTER_FALLBACK_PER_DOC) break;
      own.delete(k);
    }
    return;
  }
  let id = svgDocIds.get(doc);
  if (id === undefined) {
    svgDocIds.set(doc, (id = svgDocNext++));
    svgRasterGone?.register(doc, id);
  }
  const k = `${id}\u0000${key}`;
  let keys = svgRasterKeysOfDoc.get(id);
  if (!keys) svgRasterKeysOfDoc.set(id, (keys = new Set()));
  keys.add(k);
  const prev = svgRasterOrder.get(k);
  if (prev) svgRasterPixels -= prev.pixels;
  svgRasterOrder.delete(k);
  svgRasterOrder.set(k, { doc: new WeakRef(doc), key, pixels: r.pixels });
  svgRasterPixels += r.pixels;
  for (const [k2, e] of svgRasterOrder) {
    if (svgRasterPixels <= SVG_RASTER_CACHE_PIXELS || k2 === k) break;
    svgRasterOrder.delete(k2);
    svgRasterPixels -= e.pixels;
    // 消えた SvgDoc の分 (FinalizationRegistry がまだ知らせていないもの・FinalizationRegistry の無い環境) は、数を引くだけ
    const d = e.doc.deref();
    if (d) svgRasters.get(d)?.delete(e.key);
    const id2 = k2.slice(0, k2.indexOf('\u0000'));
    const ks = svgRasterKeysOfDoc.get(+id2);
    ks?.delete(k2);
    if (ks && !ks.size) svgRasterKeysOfDoc.delete(+id2);
  }
}

/** 画像の画素 (RGBA 8 ビット。乗算していない値) */
type Pixels = { w: number; h: number; rgba: Uint8Array };
/**
 * SVG の中の画像のうち、組版の画素の読み取り (decodeShapeImage) で読めないもの (CMYK の JPEG・インターレースの PNG など) を、
 * Web Worker の中で前もって createImageBitmap で読んだ画素 (prepareSvgImagesForCanvas)。画像の置き場ごと (組んだ結果と一緒に消える)・
 * 中身ごと (鍵は中身の長さと散らし値)。pixels は、読んだ画素の数の合計
 */
const preparedPixels = new WeakMap<AssetStore, { pixels: number; byKey: Map<string, Array<{ bytes: Uint8Array; px: Pixels }>> }>();
/**
 * 前もって読む画像 1 枚の画素の数の上限 (これより大きい画像は、縦横を同じ割合で縮めて読む)。SVG の中の画像は、SVG を画素にするときの
 * 上限 (SVG_RASTER_MAX_PIXELS の 1,600 万画素) より細かくは描かれず、どの大きさで描かれるかは、組んだ時点では分からないので、
 * その 1/4 の 400 万画素 (A4 のページ全体に置いても 200dpi 相当。画面の確かめには足りる) で読む
 */
const SVG_IMAGE_PREPARE_MAX_PIXELS = 4_000_000;
/**
 * 1 つの組んだ結果で、前もって読む画像の画素の数の合計の上限。画素にした SVG の覚え (SVG_RASTER_CACHE_PIXELS) と同じ、
 * RGBA 8 ビットで 128MB。読んだ画素は、結果のある間 (描かれないページの分も、toPdf だけを使うときも) 持つので、上限を置く。
 * 超える分は読まない (その画像は描かない。ほかの図形は描く: 読めない画像と同じ)
 */
const SVG_IMAGE_PREPARE_TOTAL_PIXELS = 32_000_000;
/**
 * SVG の外の画像のファイル (登録した画像) の中身 → その画像のブラウザの画像 (Worker の中では createImageBitmap で読んだもの) と、
 * そこから読んだ画素 (読めなければ null)。画像の置き場 (AssetStore。組んだ結果ごと) ごとに分ける: 中身のバイト列だけを鍵にすると、
 * 同じバイト列を持つ別の結果の画像 (dispose で閉じた ImageBitmap) を引くことがある (閉じた ImageBitmap は幅 0 で、画素が読めない)
 */
const elementsOf = new WeakMap<AssetStore, { element: WeakMap<Uint8Array, CanvasImageSource>; pixels: WeakMap<Uint8Array, Pixels | null> }>();
function elementTable(assets: AssetStore) {
  let t = elementsOf.get(assets);
  if (!t) elementsOf.set(assets, (t = { element: new WeakMap(), pixels: new WeakMap() }));
  return t;
}
/** 画像の置き場 assets で、中身 bytes の画像に覚えたブラウザの画像 (SVG の中の画像を描くとき。無ければ undefined) */
export function elementOfImage(assets: AssetStore, bytes: Uint8Array): CanvasImageSource | undefined {
  return elementsOf.get(assets)?.element.get(bytes);
}
/** 画像の置き場 assets で、中身 bytes の画像のブラウザの画像を覚える (SVG の画像を図形にするとき) */
export function noteImageElement(assets: AssetStore, bytes: Uint8Array, element: CanvasImageSource): void {
  elementTable(assets).element.set(bytes, element);
}

/** 前もって読んだ画素 (prepareSvgImagesForCanvas) の大きさ (バイト。TypesetResult.memoryUsage の images に足す): 画素 (RGBA) と、読んだ画像の中身 */
export function preparedPixelBytes(assets: AssetStore): number {
  const store = preparedPixels.get(assets);
  if (!store) return 0;
  let n = store.pixels * 4;
  for (const list of store.byKey.values()) for (const e of list) n += e.bytes.byteLength;
  return n;
}

/**
 * 組んだ結果の、描くためのキャッシュを手放す (TypesetResult.dispose): 前もって読んだ画素・画像の置き場のブラウザの画像の表と画素・
 * SVG の画像を図形と画素にしたもの (書体の組 fonts ごと)
 */
export function releaseRenderCaches(assets: AssetStore, fonts: FontManager): void {
  preparedPixels.delete(assets);
  elementsOf.delete(assets);
  svgShapeCache.delete(fonts);
}

/** 中身の鍵 (長さと FNV-1a の散らし値) */
function bytesKey(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return `${b.length}:${(h >>> 0).toString(36)}`;
}

/**
 * 文字列 s の start からの base64 の字の並び (data: の URL の中身。base64 の字と空白が続く所まで) の、頭のバイトだけを戻すもの
 * (画像の頭を見るのに、全部を戻さない)。要るだけ、初めから順に戻す。空白 (HTML の ASCII の空白) は除く。誤りは fromBase64 と同じく投げる
 */
class Base64Head {
  private got = new Uint8Array(0);
  private pos: number;
  private end = Infinity;
  private rest = '';
  constructor(
    private readonly s: string,
    start: number,
  ) {
    this.pos = start;
  }
  /** 頭の n バイト (全体が n バイトより短ければ、全体) */
  bytes(n: number): Uint8Array {
    while (this.got.length < n && this.pos < Math.min(this.end, this.s.length)) {
      // 4 字が 3 バイト。少しずつ戻し直さないように、少なくとも 4,096 字、または戻した分と同じだけ戻す
      const want = Math.max(4096, this.got.length, Math.ceil(((n - this.got.length) * 4) / 3) + 8);
      let chunk = this.s.slice(this.pos, Math.min(this.end, this.pos + want));
      const stop = chunk.search(/[^A-Za-z0-9+/=\s]/);
      if (stop >= 0) {
        chunk = chunk.slice(0, stop);
        this.end = this.pos + stop;
      }
      this.pos += chunk.length;
      const t = this.rest + chunk.replace(/[\t\n\f\r ]+/g, '');
      const last = this.pos >= Math.min(this.end, this.s.length);
      const take = last ? t.length : t.length - (t.length % 4);
      this.rest = t.slice(take);
      const b = fromBase64(t.slice(0, take));
      const g = new Uint8Array(this.got.length + b.length);
      g.set(this.got);
      g.set(b, this.got.length);
      this.got = g;
    }
    return this.got;
  }
}

/**
 * 画像の頭から、組版の画素の読み取り (decodeShapeImage) が読まない画像か (前もって読むものを選ぶ。読める画像を 2 度読まない) と、
 * 画素の大きさを見る。PNG はインターレース (PNG §8.2 の Adam7。IHDR (§11.2.2) の interlace method が 0 でない)、JPEG は CMYK・YCCK
 * (成分が 4 つ。T.81 §B.2.2 の Nf) と、ハフマンの基本・拡張・プログレッシブ (SOF0・SOF1・SOF2) のほかの符号化 (算術符号・ロスレスなど)。
 * JPEG の SOF は、APP の区切り (EXIF・ICC など) の後にあるので、区切りの長さで飛ばしながら、要る所までを戻す (§B.1.1.4。区切りの中身は戻すが、
 * 符号化された画像の本体 (SOS の後) は戻さない)。見分けられなければ undefined
 */
function imageHead(r: Base64Head, kind: 'png' | 'jpeg'): { undecodable: boolean; w: number; h: number } | undefined {
  if (kind === 'png') {
    const b = r.bytes(29);
    if (b.length <= 28 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return undefined;
    const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { undecodable: b[28] !== 0, w: u32(16), h: u32(20) };
  }
  let b = r.bytes(2);
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  for (let p = 2; ; ) {
    b = r.bytes(p + 10);
    if (p + 9 >= b.length || b[p] !== 0xff) return undefined;
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2;
      continue;
    }
    // SOF (§B.2.2): 長さ・精度の後に、行の数 Y・列の数 X・成分の数 Nf
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { undecodable: m > 0xc2 || b[p + 9] === 4, h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
    if (m === 0xda || m === 0xd9) return undefined;
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
}

/**
 * ブラウザの画像 (ImageBitmap など) の画素。描けなければ undefined。
 * maxPixels を渡せば、それより大きい画像は、縦横を同じ割合で縮めて読む (渡さなければ、SVG_RASTER_MAX_PIXELS より大きい画像は読まない)
 */
function pixelsOfElement(el: CanvasImageSource, maxPixels?: number): Pixels | undefined {
  const size = el as { width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  let w = typeof size.width === 'number' ? size.width : 0;
  let h = typeof size.height === 'number' ? size.height : 0;
  if (!(w > 0 && h > 0)) return undefined;
  const scaled = maxPixels !== undefined && w * h > maxPixels;
  if (scaled) {
    const k = Math.sqrt(maxPixels / (w * h));
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  } else if (w * h > limits().canvasSvgPixels) return undefined;
  const c = scratchCanvas(w, h);
  const ctx = c?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null | undefined;
  if (!ctx) return undefined;
  try {
    if (scaled) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(el, 0, 0, w, h);
    } else ctx.drawImage(el, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    return { w, h, rgba: new Uint8Array(d.buffer, d.byteOffset, d.length) };
  } catch {
    return undefined;
  }
}

/**
 * Web Worker の中で Canvas に描く (renderPage) SVG の画像 (ブラウザの画像を持たないもの。drawSvgShapes で図形を画素にして描くもの) の、
 * 描く前に待つ用意 (Canvas の描画は同期なので、組んだ後に、ここで待っておく)。
 * - SVG の style の @font-face (data: の書体) を読み込む (PDF の toVectors と同じ registerSvgFonts。組んだ後に読むので、本文の書体は変わらない)
 * - SVG の中の data: の画像のうち、組版の画素の読み取りで読めないもの (CMYK の JPEG・インターレースの PNG) を、createImageBitmap で画素にしておく。
 *   どの画像も、base64 の頭だけを戻して見分ける (読める画像は、全部を戻さない)。同じ中身の画像は 1 度だけ読む。
 *   1 枚は SVG_IMAGE_PREPARE_MAX_PIXELS まで縮めて読み、合わせて SVG_IMAGE_PREPARE_TOTAL_PIXELS を超える分は読まない (描かない)
 * ブラウザの画面 (Image がある) と Node (OffscreenCanvas が無い) では、何もしない
 */
export async function prepareSvgImagesForCanvas(assets: AssetStore, fonts: FontManager): Promise<void> {
  if (typeof Image !== 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  let store = preparedPixels.get(assets);
  /** この呼び出しで見た、読めない画像の base64 (同じ data: の URL が何度も出ても、1 度だけ戻して読む) */
  const seen = new Set<string>();
  for (const a of [...assets.values()]) {
    if (a.mime !== 'image/svg+xml' || !a.bytes || a.element || a.drawable === false) continue;
    const text = new TextDecoder().decode(a.bytes);
    // @ の無い SVG は、大文字・小文字を区別しない探し方で読み通さない (base64 の中身に @ は無い)
    if (text.includes('@') && /@font-face/i.test(text)) rejoin(thisCall(), await registerSvgFonts(fonts, text));
    if (typeof createImageBitmap === 'undefined' || (store && store.pixels >= SVG_IMAGE_PREPARE_TOTAL_PIXELS)) continue;
    // data: の URL の初めだけを探し、中身 (base64) は、頭だけを見る (読める画像の中身を、全部は読み通さない)
    const re = /data:image\/(png|jpe?g);base64,/gi;
    for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
      const kind = m[1].toLowerCase() === 'png' ? ('png' as const) : ('jpeg' as const);
      const start = re.lastIndex;
      let head: ReturnType<typeof imageHead>;
      try {
        head = imageHead(new Base64Head(text, start), kind);
      } catch {
        continue;
      }
      if (!head?.undecodable) continue;
      const body = /[A-Za-z0-9+/=\s]*/y;
      body.lastIndex = start;
      const b64 = body.exec(text)?.[0] ?? '';
      re.lastIndex = start + b64.length;
      if (seen.has(b64)) continue;
      seen.add(b64);
      if (!store) preparedPixels.set(assets, (store = { pixels: 0, byKey: new Map() }));
      // 読む前に、頭の大きさで合計の上限を見る (大きさの分からない画像は、1 枚の上限として数える)
      const est = head.w > 0 && head.h > 0 ? Math.min(head.w * head.h, SVG_IMAGE_PREPARE_MAX_PIXELS) : SVG_IMAGE_PREPARE_MAX_PIXELS;
      if (store.pixels + est > SVG_IMAGE_PREPARE_TOTAL_PIXELS) continue;
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(b64);
      } catch {
        continue;
      }
      const key = bytesKey(bytes);
      if (store.byKey.get(key)?.some((e) => sameBytes(e.bytes, bytes))) continue;
      let px: Pixels | undefined;
      try {
        // 縮めるのは、読んだ後 (pixelsOfElement)。ただし、頭の縦横が 1 枚の上限を超える画像は、元の大きさで戻さず、読むときに縮める
        // (HTML §8.10 の createImageBitmap の resizeWidth・resizeHeight)。
        // 読んだ画像の幅は、EXIF の向き (createImageBitmap の imageOrientation の既定の from-image) が縦横を入れ替える (5〜8) なら頭の高さなので、
        // 向きを読んで、読んだ後の幅を上限の画素の数に合わせて縮めた長さにする。
        // 高さも渡す: 幅だけを渡すと、高さは読んだ画像の縦横の比で決まる (§8.10.1 の手順) ので、向きの読みがブラウザと食い違うと
        // (読み違えの例: 標識の前の埋め草 0xFF。ITU-T T.81 B.1.1.2)、読んだ画像が上限を縦横の比の 2 乗倍に超える。
        // 高さは、幅だけを渡したときと同じ式 (§8.10.1: 元の高さ × 縮めた幅 ÷ 元の幅 の切り上げ) で決めるので、向きを正しく読めたときは、
        // 幅だけを渡したときと同じ縦横の比 (ブラウザの計算の丸めで、高さが 1 画素違うことはある。Chromium は単精度で計算する) になり、
        // 読み違えても、画像が歪むだけで、上限 (の 1 行ぶん) を超えない
        const over = head.w > 0 && head.h > 0 && head.w * head.h > SVG_IMAGE_PREPARE_MAX_PIXELS;
        const swapped = exifSwapsAxes(bytes, kind);
        const [srcW, srcH] = swapped ? [head.h, head.w] : [head.w, head.h];
        const resizeWidth = Math.max(1, Math.floor(srcW * Math.sqrt(SVG_IMAGE_PREPARE_MAX_PIXELS / (head.w * head.h))));
        const resize: ImageBitmapOptions | undefined = over
          ? { resizeWidth, resizeHeight: Math.max(1, Math.ceil((srcH * resizeWidth) / srcW)), resizeQuality: 'high' }
          : undefined;
        const blob = new Blob([bytes as BlobPart], { type: kind === 'png' ? 'image/png' : 'image/jpeg' });
        const bmp = rejoin(thisCall(), await (resize ? createImageBitmap(blob, resize) : createImageBitmap(blob)));
        px = pixelsOfElement(bmp, SVG_IMAGE_PREPARE_MAX_PIXELS);
        bmp.close();
      } catch {
        // ブラウザも読めない画像 (壊れた画像) は、描かない (PDF も描かない: pdfRenderer.ts の embedSvgImages)
      }
      if (!px) continue;
      store.pixels += px.w * px.h;
      store.byKey.set(key, [...(store.byKey.get(key) ?? []), { bytes, px }]);
    }
  }
}


function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** w × h の画像を描ける Canvas (OffscreenCanvas が無ければ canvas 要素)。作れなければ undefined */
function scratchCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return undefined;
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** SVG の根の preserveAspectRatio (無ければ既定の xMidYMid meet)。根の開始タグだけを見る */
const svgAspectCache = new WeakMap<Uint8Array, { align: string; slice: boolean }>();
function svgAspect(bytes: Uint8Array | undefined): { align: string; slice: boolean } {
  const dflt = { align: 'xMidYMid', slice: false };
  if (!bytes) return dflt;
  const hit = svgAspectCache.get(bytes);
  if (hit) return hit;
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
  const m = /\bpreserveAspectRatio\s*=\s*["']\s*(?:defer\s+)?(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(meet|slice))?/i.exec(tag);
  const v = m ? { align: m[1] === 'none' ? 'none' : m[1], slice: m[2]?.toLowerCase() === 'slice' } : dflt;
  svgAspectCache.set(bytes, v);
  return v;
}

/**
 * CSS のグラデーションの背景 (組版が SVG の画像にして登録したもの。layoutEngine.ts の registerGradients) の中身。
 * この画像には、ブラウザの画像 (element) が無い (組版の中で同期に作るので、読み込みを待てない) ので、Canvas のグラデーションで直に描く
 */
const gradientCache = new WeakMap<Uint8Array, GradientPaint | null>();
function gradientOf(asset: ImageAsset): GradientPaint | undefined {
  if (asset.mime !== 'image/svg+xml' || !asset.bytes || !/^kumiori-gradient-\d+\.svg$/.test(asset.key)) return undefined;
  let g = gradientCache.get(asset.bytes);
  if (g === undefined) {
    g = readGradientSvg(new TextDecoder().decode(asset.bytes)) ?? null;
    gradientCache.set(asset.bytes, g);
  }
  return g ?? undefined;
}

/** 字の並びの輪郭 (字の大きさ 1em = unitsPerEm の座標) と送り。書体・文字列・機能ごとに覚えておく */
type Outline = { paths: Path2D[]; offsets: { x: number; y: number }[] };

class CanvasPainter implements Painter {
  private outlineCache = new Map<string, Outline>();
  /** 画素にしていない画像の、描画の前に引いたブラウザーの画像 (CanvasRenderOptions.deferredImage) */
  deferredImage?: (bytes: Uint8Array) => CanvasImageSource | undefined;
  /** この描画で、SVG の画像を画素にするのに使った手間 (svgBudget の 4 倍まで) */
  private svgWork = 0;
  /** SVG の画像 1 つを画素にする手間の上限 (CanvasRenderOptions.svgRasterBudget) */
  // 既定は、呼び出しの上限 (limits.canvasSvgWork。既定 SVG_RASTER_BUDGET)
  svgBudget = limits().canvasSvgWork;
  constructor(
    private ctx: CanvasRenderingContext2D,
    private fonts: FontManager,
    private assets?: AssetStore,
    private outlines = false,
    private parseXml?: (xml: string) => XmlNode,
    private warn?: (d: Diagnostic) => void,
  ) {
    const all = fonts.all();
    this.colorFonts = all.some((f) => colorFontOf(f));
    this.fontCount = all.length;
  }
  /** 読み込んだ書体の数 (SVG の図形の覚え (svgShapeCache) を、書体が足されたら作り直す) */
  private fontCount: number;
  /** 色つきの表 (COLR・CBDT・sbix・SVG) を持つ書体を読み込んでいるか (無ければ、色つきの字形の処理を通らない) */
  private colorFonts: boolean;
  /** 書体 f で text を組んだ字形の輪郭 (OpenType の機能 features を当てる) */
  private outlineOf(f: ReturnType<FontManager['get']>, text0: string, features: string[]): Outline | undefined {
    // 改行しない空白 (U+00A0) は、通常の空白の字形で描く (Arimo の U+00A0 の字形は、fontkit が読めない壊れたデータ。PDF の drawGlyph と同じ)
    const text = text0.replace(/\u00A0/g, ' ');
    const key = `${f.key}\u0000${features.join(',')}\u0000${text}`;
    const hit = this.outlineCache.get(key);
    if (hit) return hit;
    const feats = Object.fromEntries(features.map((t) => [t, true]));
    let run: ReturnType<typeof f.fk.layout>;
    let positions: ReturnType<typeof uprightPositions>;
    try {
      run = f.fk.layout(text, feats as never);
      // 縦書き用の字形の並び (正立の字のクラスタ) の位置は、横書きの位置 (PDF と同じ。areaResources.ts)
      positions = uprightPositions(f.fk, text, feats, run);
    } catch (e) {
      // 字の並びを組めない書体・字 (fontkit が字形のデータを読めない) は、輪郭にできない。1 つの並びのために、ページの残りを失わない
      // (呼び出し元は、ブラウザの fillText で描く)
      console.warn(msg(`Canvas: ${f.key} の「${text}」をアウトラインにできません`, `Canvas: cannot make outlines of "${text}" in ${f.key}`), e);
      return undefined;
    }
    const paths: Path2D[] = [];
    const offsets: { x: number; y: number }[] = [];
    let x0 = 0;
    for (let i = 0; i < run.glyphs.length; i++) {
      let d = '';
      try {
        d = (run.glyphs[i] as unknown as { path: { toSVG(): string } }).path.toSVG();
      } catch (e) {
        // 字形のデータが壊れている書体 (fontkit が読めない字) は、その字を描かずに続ける (ページの残りを描く。PDF の drawGlyph と同じ)
        console.warn(msg(`Canvas: ${f.key} の「${text}」の字形 (${i} 番目) を描画できません`, `Canvas: cannot draw glyph ${i} of "${text}" in ${f.key}`), e);
      }
      paths.push(new Path2D(d));
      // 最初の字形の位置のずれ: OpenType の機能 (palt など) を当てた字は、組版で描く原点に入れてある (inlineLayout.ts の glyphNode) ので
      // 足さない。機能の無い並びでは、ここで足す (PDF の drawGlyph と同じ)。右から左の並び (アラビア文字・ヘブライ文字) は、描く順の最初の
      // 字形が、基底の字からずらして置く記号 (最後の字の母音記号など) になる
      const own = i > 0 || !features.length;
      offsets.push({ x: x0 + (own ? positions[i].xOffset : 0), y: own ? positions[i].yOffset : 0 });
      x0 += positions[i].xAdvance;
    }
    const o = { paths, offsets };
    if (this.outlineCache.size > 20000) this.outlineCache.clear();
    this.outlineCache.set(key, o);
    return o;
  }
  transform(m: Matrix, draw: () => void) {
    this.ctx.save();
    this.ctx.transform(...m);
    draw();
    this.ctx.restore();
  }
  /**
   * 不透明度の付いた箱 (CSS の opacity): 中身を同じ大きさの別の canvas に描いてから、不透明度を掛けて重ねる
   * (Color 4 §3.3: 要素とその中身を 1 枚の絵にしてから重ねる。中の重なりは濃くならない)。切り抜きは、重ねるときに元の canvas のものが効く
   */
  group(opacity: number, draw: () => void) {
    const main = this.ctx;
    const { width, height } = main.canvas;
    const off: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const octx = off.getContext('2d') as CanvasRenderingContext2D | null;
    if (!octx || !width || !height) return draw();
    octx.setTransform(main.getTransform());
    octx.fontKerning = main.fontKerning;
    this.ctx = octx;
    try {
      draw();
    } finally {
      this.ctx = main;
    }
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = opacity;
    main.drawImage(off, 0, 0);
    main.restore();
  }
  drawImage(a: ImageArea, x: number, y: number) {
    const asset = this.assets?.get(a.src);
    // PDF の画像は、PDF の出力だけが描く (design/pdf-as-image.md の 3 節)。画面は仮の枠
    if (asset?.pdfSource) {
      this.warn?.(pdfPlaceholderDiagnostic(a.src, 'screen'));
      return paintPlaceholder(a, x, y, this);
    }
    const el = asset?.element ?? (asset?.deferred && asset.bytes ? this.deferredImage?.(asset.bytes) : undefined);
    // 画素にしていない画像で、キャッシュから引けなかったもの (読めなかった画像) は描画しない
    if (!el && asset?.deferred) return;
    if (!el || !asset) {
      const g = asset && gradientOf(asset);
      if (g) this.drawGradient(g, x, y, a.width, a.height);
      else if (asset) this.drawSvgShapes(asset, a, x, y);
      return;
    }
    // SVG: ブラウザは <img> を枠の大きさに引き伸ばすので、preserveAspectRatio (SVG 1.1 §7.8。既定 xMidYMid meet) を自分で当てる
    // (PDF の drawVector と同じ見た目にする)。none は引き伸ばす。slice は枠で切り抜く
    const par = asset.mime === 'image/svg+xml' && asset.width > 0 && asset.height > 0 ? svgAspect(asset.bytes) : undefined;
    if (par && par.align !== 'none' && !a.stretch) {
      const sx = a.width / asset.width;
      const sy = a.height / asset.height;
      if (Math.abs(sx - sy) > 1e-9) {
        const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
        const w = asset.width * s;
        const h = asset.height * s;
        const fx = /xMid/.test(par.align) ? 0.5 : /xMax/.test(par.align) ? 1 : 0;
        const fy = /YMid/.test(par.align) ? 0.5 : /YMax/.test(par.align) ? 1 : 0;
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, a.width, a.height);
        ctx.clip();
        ctx.drawImage(el, x + (a.width - w) * fx, y + (a.height - h) * fy, w, h);
        ctx.restore();
        return;
      }
    }
    this.ctx.drawImage(el, x, y, a.width, a.height);
  }
  /**
   * ブラウザの画像 (element) の無い SVG の画像 (Web Worker の中で読んだもの) を、図形にして、画素にして描く。
   * 図形は PDF に描くもの (pdfRenderer.ts の toVectors) と同じ選択肢で作る: 字は書体の輪郭、中の画像は登録した画像、
   * 外のファイルの use は登録した SVG、近似できない filter は画素で計算する。foreignObject の中は、HTML の文字だけを近似して描く
   * (PDF は本文と同じ組版で組む)。置き方は preserveAspectRatio どおり (PDF の drawVector と同じ)。
   * 画素の大きさは、画像の領域を今の変換で画面の画素にした大きさ (倍率を変えて描き直せば、その解像度で描き直す)。
   * 画像の領域で切り抜く (根の overflow が visible の SVG (SvgDoc.noClip) も、領域の外は描かない)
   */
  private drawSvgShapes(asset: ImageAsset, a: ImageArea, x: number, y: number) {
    if (asset.mime !== 'image/svg+xml' || !asset.bytes || asset.drawable === false) return;
    const doc = this.svgShapesOf(asset, a.language);
    if (!doc) return;
    const ctx = this.ctx;
    const t = ctx.getTransform();
    // 組版の丸め・浮動小数の誤差 (HTML の 200pt の画像の幅が 200.000025pt になるなど) で 1 画素大きくして、縮めて描いてぼかさないように、
    // 1/100 画素までの端数は切り捨てる (それより大きい端数は切り上げる)
    let w = Math.ceil(a.width * Math.hypot(t.a, t.b) - 0.01);
    let h = Math.ceil(a.height * Math.hypot(t.c, t.d) - 0.01);
    if (w < 1 || h < 1) return;
    const maxPx = limits().canvasSvgPixels;
    if (w * h > maxPx) {
      const k = Math.sqrt(maxPx / (w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    // 画素にする手間の見積もりが上限を超えるなら、超えない画素の数まで解像度を下げる (図形の多い SVG を大きく置いたとき)
    const budget = this.svgBudget;
    const perPixel = shapesCostPerPixel(doc.shapes);
    if (perPixel * w * h > budget) {
      const k = Math.sqrt(budget / (perPixel * w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    // 置く位置 (preserveAspectRatio。PDF の drawVector と同じ): 画像の領域の中の、viewBox の原点の位置と拡大率。
    // SVG 2 §8.2 (SVG の viewport の equivalent transform を求める手順。viewBox は §8.6): none は縦横を別々に合わせ、meet は小さい方・
    // slice は大きい方の倍率にそろえ、xMin・xMid・xMax (YMin・YMid・YMax) で、余り (はみ出し) の 0・半分・すべてを左 (上) に置く
    // (preserveAspectRatio は §8.7)
    const [vx, vy, vw, vh] = doc.viewBox;
    let sx = a.width / vw;
    let sy = a.height / vh;
    let ox = 0;
    let oy = 0;
    const align = a.stretch ? 'none' : (doc.aspect?.align ?? 'xMidYMid');
    if (align !== 'none' && Math.abs(sx - sy) > 1e-9) {
      const s = doc.aspect?.slice ? Math.max(sx, sy) : Math.min(sx, sy);
      ox = (a.width - vw * s) * (/xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0);
      oy = (a.height - vh * s) * (/YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0);
      sx = sy = s;
    }
    const key = `${w}x${h}:${a.width},${a.height},${align},${ox},${oy},${sx},${sy}`;
    let hit = rasterOf(doc, key);
    if (!hit) {
      const kx = w / a.width;
      const ky = h / a.height;
      // SVG の座標 → 画素の座標。読めない画像は、前もって読んだ画素か、登録した画像のブラウザの画像の画素で描き、
      // それも無ければ、その画像だけを描かない (ほかの図形は描く。PDF も、埋め込めない SVG の中の画像だけを描かない: pdfRenderer.ts の embedSvgImages)
      // 手間の上限: 1 つの画像は見積もりの 2 倍 (見積もりは多めだが、模様・マスクの入れ子で外れることがある) まで、かつ、この描画の残りまで
      const limit = Math.min(2 * budget, 4 * budget - this.svgWork);
      const r =
        limit > 0
          ? paintShapesToPixelsWithin(doc.shapes, [sx * kx, 0, 0, sy * ky, (ox - sx * vx) * kx, (oy - sy * vy) * ky], w, h, limit, { missingImage: (img) => this.missingImage(img.bytes) })
          : undefined;
      if (!r) {
        // 上限を超えた: 使った手間を数え、仮の枠で描いて知らせる (覚えない: 次の描画で、残りがあれば描き直す)
        this.svgWork += Math.max(0, limit);
        paintPlaceholder(a, x, y, this);
        this.warn?.(
          diag(
            'canvas/svg-not-drawn',
            msg(`SVG の画像 ${a.src.startsWith('data:') ? a.src.slice(0, 40) + '…' : a.src} は、ラスタライズする計算量が上限を超えるので、プレースホルダーで描画します`, `SVG image ${a.src.startsWith('data:') ? a.src.slice(0, 40) + '…' : a.src} would take too much work to rasterize, so a placeholder frame is drawn`),
            { src: a.src.startsWith('data:') ? a.src.slice(0, 40) + '…' : a.src },
          ),
        );
        return;
      }
      this.svgWork += r.used;
      const px = r.pixels;
      const canvas = scratchCanvas(w, h);
      const c2 = canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
      if (!canvas || !c2) return;
      // 乗算済みの浮動小数 (0〜1) → 乗算しない 8 ビット (ImageData)
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        const al = px[i + 3];
        if (al <= 0) continue;
        data[i] = (px[i] / al) * 255 + 0.5;
        data[i + 1] = (px[i + 1] / al) * 255 + 0.5;
        data[i + 2] = (px[i + 2] / al) * 255 + 0.5;
        data[i + 3] = al * 255 + 0.5;
      }
      c2.putImageData(new ImageData(data, w, h), 0, 0);
      hit = { pixels: w * h, image: canvas };
      keepRaster(doc, key, hit);
    }
    ctx.drawImage(hit.image, x, y, a.width, a.height);
  }

  /** SVG の中の、組版の画素の読み取りで読めない画像の画素 (前もって読んだもの・登録した画像のブラウザの画像から読んだもの)。無ければ undefined */
  private missingImage(bytes: Uint8Array): Pixels | undefined {
    // 画素にしていない画像のファイル (描画の前にキャッシュから引いたもの)。キャッシュの画像は後で閉じることがあるので、読んだ画素は覚えない
    const deferred = this.deferredImage?.(bytes);
    if (deferred) return pixelsOfElement(deferred) ?? undefined;
    const table = this.assets && elementsOf.get(this.assets);
    const el = this.assets && elementOfImage(this.assets, bytes);
    if (table && el) {
      let px = table.pixels.get(bytes);
      if (px === undefined) table.pixels.set(bytes, (px = pixelsOfElement(el) ?? null));
      if (px) return px;
    }
    const byKey = this.assets && preparedPixels.get(this.assets)?.byKey;
    return byKey?.get(bytesKey(bytes))?.find((e) => sameBytes(e.bytes, bytes))?.px;
  }

  /** SVG の画像を図形にしたもの (svgShapeCache)。置いた所の言語 lang で systemLanguage を照らす。読めなければ undefined */
  private svgShapesOf(asset: ImageAsset, lang: string | undefined): SvgDoc | undefined {
    const parse = this.parseXml;
    const bytes = asset.bytes;
    if (!parse || !bytes) return undefined;
    let cached = svgShapeCache.get(this.fonts);
    if (!cached || cached.fontCount !== this.fontCount) svgShapeCache.set(this.fonts, (cached = { fontCount: this.fontCount, byBytes: new WeakMap() }));
    const byBytes = cached.byBytes;
    let byLang = byBytes.get(bytes);
    if (!byLang) byBytes.set(bytes, (byLang = new Map()));
    const langKey = lang ?? '';
    let doc = byLang.get(langKey);
    if (doc === undefined) {
      const src = asset.key;
      const assets = this.assets;
      const fonts = this.fonts;
      // SVG の image・use の外のファイル: SVG の場所を基準に、登録した画像を引く (pdfRenderer.ts の toVectors と同じ)
      const base = /^data:/i.test(src) ? undefined : src;
      const image = (href: string) => {
        const r = assets?.get(resolveRef(href, base));
        if (!r?.bytes) return undefined;
        // 組版の画素の読み取りで読めない形 (CMYK の JPEG など) は、登録した画像のブラウザの画像 (Worker の中では createImageBitmap で読んだもの) で描く (missingImage)
        if (r.element && assets) noteImageElement(assets, r.bytes, r.element);
        if (r.mime === 'image/png' || r.mime === 'image/jpeg') return { kind: r.mime === 'image/png' ? ('png' as const) : ('jpeg' as const), bytes: r.bytes };
        const p = r.mime === 'image/gif' ? decodeGif(r.bytes) : r.mime === 'image/bmp' ? decodeBmp(r.bytes) : r.mime === 'image/webp' ? decodeWebp(r.bytes) : undefined;
        return p ? { kind: 'png' as const, bytes: encodePngStored(p) } : undefined;
      };
      const resource = (href: string) => {
        const r = assets?.get(resolveRef(href, base));
        return r?.bytes && r.mime === 'image/svg+xml' ? new TextDecoder().decode(r.bytes) : undefined;
      };
      try {
        doc =
          parseSvg(new TextDecoder().decode(bytes), parse, {
            outline: (t, fam, wt, size, style, vertical) => outlineText(fonts, t, fam, wt, size, false, style, vertical),
            image,
            resource,
            approximateFilters: true,
            rasterFilter,
            ...(lang ? { languages: [svgLanguageTag(lang)] } : {}),
          }) ?? null;
      } catch {
        doc = null;
      }
      byLang.set(langKey, doc);
    }
    return doc ?? undefined;
  }

  /**
   * CSS のグラデーションの画像 (幅 g.width・高さ g.height の SVG) を、(x, y) に幅 w・高さ h で描く。PDF は同じ SVG を図形として描く (同じ線・同じ止まり)。
   * 止まりの外は、端の色で塗る (SVG の spreadMethod の初期値 pad。Canvas のグラデーションも同じ)。
   * 色の補間は、SVG も Canvas も乗算しない値 (HTML の CanvasGradient の決まり: 不透明度を掛けない値で補間する)。乗算済みの補間 (CSS Images 3 §3.4.4) に
   * 近づける止まりは、SVG を作るときに足してある
   */
  private drawGradient(g: GradientPaint, x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.save();
    // 回転・傾きの無いときは、描く四角の辺を画面の画素の境に合わせる (繰り返して並べたとき、隣どうしの縁のぼかしが重なって、継ぎ目に筋が出るのを防ぐ)
    const m = ctx.getTransform();
    if (m.b === 0 && m.c === 0) {
      const x0 = Math.round(m.a * x + m.e);
      const y0 = Math.round(m.d * y + m.f);
      const x1 = Math.round(m.a * (x + w) + m.e);
      const y1 = Math.round(m.d * (y + h) + m.f);
      if (x1 === x0 || y1 === y0) return ctx.restore();
      ctx.setTransform(1, 0, 0, 1, x0, y0);
      ctx.scale((x1 - x0) / g.width, (y1 - y0) / g.height);
    } else {
      ctx.translate(x, y);
      ctx.scale(w / g.width, h / g.height);
    }
    ctx.beginPath();
    ctx.rect(0, 0, g.width, g.height);
    if (g.kind === 'wedges') {
      // conic: 箱で切り抜いて、三角形をそれぞれの色で塗る (PDF と同じ図形)
      ctx.clip();
      for (const w of g.wedges) {
        const c = parseInt(w.color.slice(1), 16);
        ctx.fillStyle = `rgba(${c >> 16}, ${(c >> 8) & 255}, ${c & 255}, ${w.opacity})`;
        ctx.beginPath();
        ctx.moveTo(w.pts[0], w.pts[1]);
        ctx.lineTo(w.pts[2], w.pts[3]);
        ctx.lineTo(w.pts[4], w.pts[5]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (g.kind === 'solid') ctx.fillStyle = g.color;
    else {
      let cg: CanvasGradient;
      if (g.kind === 'linear') cg = ctx.createLinearGradient(...g.coords);
      else {
        // 楕円: 塗りの座標だけを、中心のまわりに縦へ伸ばす (道は伸ばす前に作ってあるので、塗る範囲は変わらない)
        ctx.translate(g.cx, g.cy);
        ctx.scale(1, g.scaleY);
        ctx.translate(-g.cx, -g.cy);
        cg = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r);
      }
      for (const s of g.stops) {
        const c = parseInt(s.color.slice(1), 16);
        cg.addColorStop(Math.min(1, Math.max(0, s.offset)), `rgba(${c >> 16}, ${(c >> 8) & 255}, ${c & 255}, ${s.opacity})`);
      }
      ctx.fillStyle = cg;
    }
    ctx.fill();
    ctx.restore();
  }
  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = toCss(color);
    this.ctx.fillRect(x, y, w, h);
  }
  drawGlyph(g: GlyphArea, x: number, y: number) {
    const f = this.fonts.get(g.fontFamily, g.fontWeight);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x + g.baselineX, y + g.baselineY);
    if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180);
    if (g.scaleX !== 1) ctx.scale(g.scaleX, 1);
    if (g.italic) ctx.transform(1, 0, -ITALIC_SLANT, 1, 0, 0);
    ctx.font = this.fonts.cssFont(f, g.fontSize);
    ctx.fillStyle = toCss(g.color);
    ctx.textBaseline = 'alphabetic';
    // 色つきの書体の字を、輪郭から描くとき・パレットを指定したとき・ブラウザが色つきに描けない表のときは、PDF と同じ図形・画像で描く
    if (this.colorFonts && drawColorGlyphArea(ctx, this.fonts, g, !!g.features?.length || this.outlines, this.parseXml)) {
      ctx.restore();
      return;
    }
    if (g.features?.length || this.outlines || (f.instanceOf && !f.face)) {
      // OpenType の機能を当てた字形 (Canvas では指定できない)、または書体をブラウザに登録していないとき: 字形の輪郭を描く。
      // 可変フォントの実体は、ブラウザへの登録 (静的な書体にしたもの) が終わるまで、輪郭で描く
      const o = this.outlineOf(f, g.text, g.features ?? []);
      const k = g.fontSize / f.unitsPerEm;
      for (let i = 0; o && i < o.paths.length; i++) {
        ctx.save();
        ctx.translate(o.offsets[i].x * k, -o.offsets[i].y * k);
        ctx.scale(k, -k);
        ctx.fill(o.paths[i]);
        if (g.fakeBold) {
          ctx.strokeStyle = toCss(g.color);
          ctx.lineWidth = FAKE_BOLD * f.unitsPerEm;
          ctx.stroke(o.paths[i]);
        }
        ctx.restore();
      }
      if (o) {
        ctx.restore();
        return;
      }
    }
    ctx.fillText(g.text, 0, 0);
    if (g.fakeBold) {
      // 疑似太字: 字の輪郭を、字の大きさの 3% の太さでなぞる
      ctx.strokeStyle = toCss(g.color);
      ctx.lineWidth = g.fontSize * FAKE_BOLD;
      ctx.lineJoin = 'round';
      ctx.strokeText(g.text, 0, 0);
    }
    ctx.restore();
  }
  strokeLine(l: Line, width: number, color = '#000') {
    const ctx = this.ctx;
    ctx.strokeStyle = toCss(color);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  clipPath(path: PathSeg[], evenOdd?: boolean) {
    this.ctx.save();
    this.tracePath(path);
    this.ctx.clip(evenOdd ? 'evenodd' : 'nonzero');
  }
  clipRect(r: Rect) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(r.x, r.y, r.width, r.height);
    this.ctx.clip();
  }
  restore() {
    this.ctx.restore();
  }
  private tracePath(path: PathSeg[]) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const g of path) {
      if (g.op === 'M') ctx.moveTo(g.x, g.y);
      else if (g.op === 'L') ctx.lineTo(g.x, g.y);
      else if (g.op === 'C') ctx.bezierCurveTo(g.x1, g.y1, g.x2, g.y2, g.x, g.y);
      else ctx.closePath();
    }
  }
  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity = 1) {
    this.tracePath(path);
    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = toCss(color);
    this.ctx.fill(evenOdd ? 'evenodd' : 'nonzero');
    this.ctx.restore();
  }
  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]) {
    const ctx = this.ctx;
    this.tracePath(path);
    ctx.save();
    ctx.strokeStyle = toCss(color);
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }
  /** フォームの欄の見本 (PDF では欄そのものが値を表示する)。罫線の内側に、初期値・チェック・選択肢・ボタンの表示を描く */
  private drawField(a: Area, x: number, y: number) {
    const f = a.formField!;
    const ctx = this.ctx;
    const bl = a.border.left?.width ?? 0;
    const bt = a.border.top?.width ?? 0;
    const ix = x + bl;
    const iy = y + bt;
    const iw = a.width - bl - (a.border.right?.width ?? 0);
    const ih = a.height - bt - (a.border.bottom?.width ?? 0);
    const fs = Math.min(f.fontSize === 'auto' ? ih * 0.8 : (f.fontSize ?? 10), ih * 0.8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();
    ctx.fillStyle = toCss(f.color ?? '#000');
    ctx.strokeStyle = toCss(f.color ?? '#000');
    ctx.font = `${fs}px sans-serif`;
    ctx.textBaseline = 'middle';
    const pad = a.padding.left;
    if (f.kind === 'checkbox' || f.kind === 'radio') {
      if (f.checked) {
        // チェック印
        ctx.lineWidth = Math.max(ih * 0.12, 0.8);
        ctx.beginPath();
        ctx.moveTo(ix + iw * 0.2, iy + ih * 0.55);
        ctx.lineTo(ix + iw * 0.42, iy + ih * 0.78);
        ctx.lineTo(ix + iw * 0.8, iy + ih * 0.22);
        ctx.stroke();
      }
    } else if (f.kind === 'listbox') {
      const lh = fs * 1.25;
      (f.options ?? []).forEach((o, k) => {
        if (o.selected) {
          ctx.save();
          ctx.fillStyle = '#99c1f1';
          ctx.fillRect(ix, iy + a.padding.top + k * lh, iw, lh);
          ctx.restore();
        }
        ctx.fillText(o.label, ix + pad, iy + a.padding.top + k * lh + lh / 2);
      });
    } else if (f.kind === 'button') {
      ctx.textAlign = 'center';
      ctx.fillText(f.caption ?? '', ix + iw / 2, iy + ih / 2);
    } else {
      const text = f.kind === 'combobox' ? ((f.options ?? []).find((o) => o.selected) ?? f.options?.[0])?.label ?? '' : f.password ? '•'.repeat((f.value ?? '').length) : (f.value ?? '');
      ctx.fillText(text, ix + pad, iy + ih / 2);
      if (f.kind === 'combobox') {
        // 開くボタンの ▼
        const s = Math.min(ih * 0.5, fs);
        ctx.beginPath();
        ctx.moveTo(ix + iw - s * 1.5, iy + ih / 2 - s / 4);
        ctx.lineTo(ix + iw - s * 0.5, iy + ih / 2 - s / 4);
        ctx.lineTo(ix + iw - s, iy + ih / 2 + s / 3);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 注釈の目印 (画面確認用)。テキスト注釈はアイコンの位置に小さな付箋、FreeText・スタンプは枠と中身 */
  mark(a: Area, x: number, y: number) {
    if (a.formField) this.drawField(a, x, y);
    const an = a.annotation;
    if (!an) return;
    const ctx = this.ctx;
    const ax = x + (an.dx ?? 0);
    const ay = y + (an.dy ?? 0);
    const color = toCss(an.color ?? '#ffd400');
    ctx.save();
    if (an.kind === 'text' || an.kind === 'file-attachment') {
      const s = 12;
      ctx.fillStyle = color;
      ctx.fillRect(ax, ay, s, s);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.4;
      ctx.strokeRect(ax, ay, s, s);
      ctx.beginPath();
      for (const k of [3.5, 6, 8.5]) {
        ctx.moveTo(ax + 2.5, ay + k);
        ctx.lineTo(ax + s - 2.5, ay + k);
      }
      ctx.stroke();
    } else {
      const w = an.width ?? 100;
      const h = an.height ?? 30;
      ctx.beginPath();
      ctx.rect(ax, ay, w, h);
      ctx.clip();
      if (an.kind === 'free-text') {
        // FreeText: 注釈の色が背景、中身を改行ごとに描く
        ctx.fillStyle = color;
        if (an.color) ctx.fillRect(ax, ay, w, h);
        const fs = an.fontSize ?? 10;
        ctx.fillStyle = toCss(an.textColor ?? '#000');
        ctx.font = `${fs}px sans-serif`;
        ctx.textBaseline = 'top';
        (an.contents ?? '').split(/\r?\n/).forEach((t, k) => ctx.fillText(t, ax + 2, ay + 2 + k * fs * 1.2));
      } else {
        ctx.strokeStyle = toCss(an.color ?? '#c00');
        ctx.lineWidth = 2;
        ctx.strokeRect(ax + 1, ay + 1, w - 2, h - 2);
        const fs = Math.min(h * 0.5, 18);
        ctx.fillStyle = toCss(an.color ?? '#c00');
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText((an.icon ?? 'Draft').toUpperCase(), ax + 4, ay + (h - fs) / 2, w - 8);
      }
    }
    ctx.restore();
  }
}

/**
 * ページを canvas に描く。canvas は画面の canvas 要素か OffscreenCanvas (Web Worker の中でも描ける)。
 * 画素の大きさは、ページの大きさ × scale × devicePixelRatio。canvas 要素は、画面の大きさ (style の width・height) も
 * ページの大きさ × scale にする (OffscreenCanvas は画面に出ないので、大きさは画素の大きさだけ)。
 * devicePixelRatio の既定は window.devicePixelRatio (window の無い Web Worker の中では 1)
 */
export function renderSheetToCanvas(sheet: SheetArea, canvas: RenderCanvas, fonts: FontManager, opts: CanvasRenderOptions = {}) {
  const scale = opts.scale ?? 96 / 72;
  const dpr = opts.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.ceil(sheet.width * scale * dpr);
  canvas.height = Math.ceil(sheet.height * scale * dpr);
  if ('style' in canvas) {
    canvas.style.width = `${sheet.width * scale}px`;
    canvas.style.height = `${sheet.height * scale}px`;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.fontKerning = 'none';
  // 用紙
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const painter = new CanvasPainter(ctx, fonts, opts.assets, !!opts.glyphOutlines, opts.parseXml, opts.warn);
  if (opts.svgRasterBudget !== undefined) painter.svgBudget = opts.svgRasterBudget;
  painter.deferredImage = opts.deferredImage;
  paintSheet(sheet, painter, { guides: opts.guides });
}
