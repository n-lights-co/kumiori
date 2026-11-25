/**
 * svgRenderer — SheetArea (組んだページ) を SVG の文書 (文字列) に書き出す。ブラウザでも Node でも動き、依存を足さない。
 *
 * 描き方は、ページを画面に描く canvasRenderer.ts・PDF に書く pdfRenderer.ts と同じ Painter (paint.ts) を実装するので、
 * 座標の計算はどれも同じ。座標は pt のまま (根の viewBox を pt にし、width・height も pt で書く)。
 *  - 字: 書体の輪郭 (fontkit の字形) を道 (path) にして描く。SVG を見る側に書体が無くても、PDF と同じ字形で描ける。
 *    字形と位置は、PDF と同じく領域の木の字形の番号と位置 (colorGlyph.ts の areaGlyphs)。
 *    色つきの字形 (COLR・SVG・CBDT・sbix の表) は、描画の命令 (ColorOp) を SVG の図形・グラデーション・画像にする
 *  - 画像: PNG・JPEG はそのまま data: の URI で埋め込む。GIF・BMP・WebP は画素に戻して PNG にする。
 *    SVG の画像は、PDF と同じく図形の並び (svg.ts の parseSvg) にしてから、SVG の要素に書き直す (字は書体の輪郭、
 *    近似できない filter は画素で計算した画像。PDF と同じ見た目になる)
 *  - 不透明度の付いた箱 (CSS の opacity) は、opacity を付けた g (SVG 1.1 §14.5: 中身を 1 枚の絵にしてから重ねる)
 *  - 切り抜きは clipPath (clipPathUnits の既定 userSpaceOnUse。SVG 1.1 §14.3.5: 参照した要素の座標で読む)
 *  - 同じ画像は、defs に 1 度だけ書き、置く所は use で参照する
 *  - リンク: 本文のリンク (a.link) と SVG の画像の中のリンク (a 要素。SvgShape.link) を、SVG の a 要素 (SVG 2 §16.2) にする。
 *    外への飛び先は、PDF と同じリンクの決まり (linkPolicy.ts の judgeExternalLink。TypesetOptions.links) に通したものだけを書き、
 *    通さないものは書かずに警告する。文書の中の飛び先は、同じページなら #id、別のページなら pageHref で名前を付けた SVG の #id。
 *    本文のリンクは、PDF のリンクの注釈と同じく、領域の矩形 (透明。押せる) を、ページの中身の上に重ねて書く
 * 描かないもの: 注釈・フォームの欄 (PDF の注釈。Canvas の画面の見本と同じ扱いにはしない)。
 */
import type { FontManager } from './fontManager';
import { parseColor } from './color';
import { FAKE_BOLD, ITALIC_SLANT, paintPlaceholder, paintSheet, pdfPlaceholderDiagnostic, type Line, type Matrix, type Painter, type PathSeg } from './paint';
import type { Diagnostic } from './diagnostics';
import type { AssetStore } from './assets';
import { areaGlyphs, colorFontOf, COMPOSITE, plainStops, type ColorFill, type ColorOp, type Rgb } from './colorGlyph';
import { ensureSvgGlyphReader } from './colorGlyphSvg';
import type { Area, GlyphArea, ImageArea, LinkTarget, Rect, SheetArea } from './types';
import { parseSvg, resolveNonScaling, type FilterRasterResult, type SvgClip, type SvgDoc, type SvgGradient, type SvgMask, type SvgPattern, type SvgShape, type XmlNode } from './svg';
import { rasterFilter } from './svgFilterRaster';
import { foreignObjectShapes, outlineText, registerSvgFonts, svgLanguageTag, type PdfRenderOptions } from './pdfRenderer';
import { base64 } from './base64';
import { resolveRef } from './resources';
import { decodeBmp, decodeGif, encodePng } from './pixels';
import { decodeWebp } from './webp';
import { msg } from './messages';
import { rejoin, thisCall } from './callContext';
import { countDroppedLink, droppedLinkWarning, judgeExternalLink, summarizeDroppedLinks, type DroppedLinks, type LinkPolicy } from './linkPolicy';
import { diag } from './diagnostics';

export interface SvgRenderOptions {
  /** 画像 (fo:external-graphic・img) の登録所 */
  assets?: AssetStore;
  /** SVG の画像を図形にするときの XML のパーサ (無ければ、SVG の画像は描かない) */
  parseXml?: (xml: string) => XmlNode;
  /** 仕上がり・塗り足しのガイド線 (画面確認用) */
  guides?: boolean;
  /**
   * 文書の中の id (切り抜き・グラデーション・模様・マスク) の頭に付ける文字列。既定 'k'。
   * 1 つの HTML に、書き出した SVG を何枚も直に入れるときは、ページごとに違う値にする (id がぶつからないように)
   */
  idPrefix?: string;
  /** systemLanguage を照らす言語 (SvgImageOptions.svgLanguages) */
  svgLanguages?: readonly string[];
  /** SVG の画像の foreignObject の中身を組む (SvgImageOptions.typesetForeign) */
  typesetForeign?: PdfRenderOptions['typesetForeign'];
  /** 描く途中の知らせの出し先 (PDF の画像を仮の枠で描いたこと、foreignObject の中身を近似したこと、書かなかったリンクなど) */
  warn?: (d: Diagnostic) => void;
  /** 外へのリンクのうち、書いてよいもの (PDF と同じ決まり。TypesetOptions.links)。既定は linkPolicy.ts の既定 */
  links?: LinkPolicy;
  /** このページの番号 (0 から。文書の中の飛び先が同じページかを見る) */
  pageIndex?: number;
  /** 文書の中の飛び先 (id → ページの番号。AreaTree.destinations)。無ければ、文書の中のリンクは書かない */
  destinations?: Record<string, number>;
  /** 別のページへのリンクの書き先: ページの番号を受け、そのページの SVG の URL を返す。無ければ (undefined を返せば)、別のページへのリンクは書かない */
  pageHref?: (pageIndex: number) => string | undefined;
}

/**
 * XML 1.0 に書けない字 (§2.2 の Char でないもの: C0 の制御文字 (タブ・改行を含む。属性の値の中では空白に正規化される。§3.3.3)・
 * 対になっていないサロゲート・U+FFFE・U+FFFF) と、DEL を、URL の %xx (UTF-8。対になっていないサロゲートは U+FFFD) にする
 */
function xmlSafeUrl(u: string): string {
  return u.replace(/[\u0000-\u001f\u007f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (c) => {
    try {
      return encodeURIComponent(c);
    } catch {
      return '%EF%BF%BD';
    }
  });
}

/**
 * 文書の中の飛び先の id を、URL の飛び先 (fragment。WHATWG URL §1.3 の fragment percent-encode set) に書く。空白・引用符・<>・`・% と、
 * 区切りの #・XML に書けない字を %xx にする (ブラウザは、%xx を戻した id でも要素を探す。HTML の §7.4.6.4 indicated part)
 */
const fragmentOf = (id: string) => xmlSafeUrl(id.replace(/[\u0000-\u0020"<>`%#\u007f]/g, (c) => encodeURIComponent(c)));

/**
 * id の値に書けるか (XML に書けない字を含まない。空でない。XML 1.0 §2.2 の Char)。
 * 2 つの選択肢は先頭の 1 文字で決まる (前者はサロゲートを含まない) ので、後戻りは伸びない (手間は長さに比例する)
 */
const XML_CHARS = /^(?:[\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd]|[\ud800-\udbff][\udc00-\udfff])+$/;

/** 2 つの変換の積 (m を先に、a を後に掛ける) */
const mulMatrix = (a: Matrix, m: Matrix): Matrix => [
  a[0] * m[0] + a[2] * m[1],
  a[1] * m[0] + a[3] * m[1],
  a[0] * m[2] + a[2] * m[3],
  a[1] * m[2] + a[3] * m[3],
  a[0] * m[4] + a[2] * m[5] + a[4],
  a[1] * m[4] + a[3] * m[5] + a[5],
];

/**
 * いまの座標の 1 単位の、ページの上の長さ (pt)。SVG の画像の中で、SVG の根の座標の 1 単位が長い (小さな viewBox を大きく置く) ときは、
 * 座標・線の太さの桁をその分だけ増やす (num。前は小数 3 桁に丸め、細い線の太さが 0 になっていた)。書き出しは同期で 1 ページずつなので、描く間だけ書き換える
 */
let unitPt = 1;

/**
 * 書く数の絶対値の上限: 32 ビットの浮動小数の最も大きい値 (約 3.403e38)。SVG を読むソフトには、数を 32 ビットの浮動小数で持つものが多く、
 * それを超える数 (1e308 など) は、読むと無限大になる。有限でない数は、前から 0 にしている
 */
const SVG_NUM_MAX = 3.402823e38;

/** 数を短く書く (ページの上で 0.001pt の細かさまで: ページの座標は小数 3 桁、SVG の画像の中は 1 単位の長さに合わせて桁を増やす。-0 は 0) */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  v = Math.max(-SVG_NUM_MAX, Math.min(SVG_NUM_MAX, v));
  // 小数の桁の無い大きさ (丸めに掛ける数で Infinity にならないよう、掛けずに書く)
  if (Math.abs(v) >= 1e15) return String(Math.round(v));
  const d = unitPt <= 1 ? 3 : Math.min(15, 3 + Math.ceil(Math.log10(unitPt)));
  const k = 10 ** d;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * 倍率 (行列の a・b・c・d の成分と scale()) を、有効数字 7 桁で書く。座標と違い、小数 3 桁に丸めると小さい倍率が大きくずれる
 * (viewBox が 10000 の SVG を 100px に置く倍率 0.0075 が 0.008 になり、6.7% 大きく描かれる)。SVG 1.1 §4.2 の数は指数の書き方も許す
 */
function coef(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Number(Math.max(-SVG_NUM_MAX, Math.min(SVG_NUM_MAX, v)).toPrecision(7));
  return r === 0 ? '0' : String(r);
}

/** 属性の値・文字の中身の特別な字を、文字参照にする (XML 1.0 §2.4) */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * 色 (CSS の色・cmyk()・spot()) を、SVG の色 (#rrggbb) と不透明度にする。CMYK と特色は、画面の Canvas と同じ式 (color.ts の toCss) で
 * RGB にする (特色は、濃度を掛けた代わりの CMYK)
 */
function rgbOf(css: string): { hex: string; a: number } {
  const c = parseColor(css);
  if (c.mode === 'rgb') return { hex: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`, a: c.a ?? 1 };
  return { hex: `#${hex2((1 - c.c) * (1 - c.k))}${hex2((1 - c.m) * (1 - c.k))}${hex2((1 - c.y) * (1 - c.k))}`, a: 1 };
}

/** fill="…" (と fill-opacity) の属性 */
function fillAttr(css: string, opacity = 1): string {
  const { hex, a } = rgbOf(css);
  const o = a * opacity;
  return ` fill="${hex}"${o < 1 ? ` fill-opacity="${num(o)}"` : ''}`;
}

/** 図形の輪郭 → SVG の道のデータ (SVG 1.1 §8.3) */
function pathData(segs: readonly PathSeg[]): string {
  let d = '';
  for (const g of segs) {
    if (g.op === 'M') d += `M${num(g.x)} ${num(g.y)}`;
    else if (g.op === 'L') d += `L${num(g.x)} ${num(g.y)}`;
    else if (g.op === 'C') d += `C${num(g.x1)} ${num(g.y1)} ${num(g.x2)} ${num(g.y2)} ${num(g.x)} ${num(g.y)}`;
    else d += 'Z';
  }
  return d;
}

/** 行列 (a b c d e f): 倍率の成分は有効数字で、ずれ (e・f) は座標と同じく小数 3 桁で書く */
const matrixAttr = (m: readonly number[]) => `matrix(${m.map((v, i) => (i < 4 ? coef(v) : num(v))).join(' ')})`;

/** 線の端・つなぎ (SvgShape・ColorOp の 0〜2 の値) の名前 (SVG 1.1 §11.4 stroke-linecap・stroke-linejoin) */
const CAPS = ['butt', 'round', 'square'] as const;
const JOINS = ['miter', 'round', 'bevel'] as const;

/** 色つきの字形の合成の種類 (COLR の CompositeMode) → CSS の mix-blend-mode (Compositing and Blending 1 §3.4.1) */
const BLEND_OF: Record<number, string> = {
  [COMPOSITE.SCREEN]: 'screen',
  [COMPOSITE.OVERLAY]: 'overlay',
  [COMPOSITE.DARKEN]: 'darken',
  [COMPOSITE.LIGHTEN]: 'lighten',
  [COMPOSITE.COLOR_DODGE]: 'color-dodge',
  [COMPOSITE.COLOR_BURN]: 'color-burn',
  [COMPOSITE.HARD_LIGHT]: 'hard-light',
  [COMPOSITE.SOFT_LIGHT]: 'soft-light',
  [COMPOSITE.DIFFERENCE]: 'difference',
  [COMPOSITE.EXCLUSION]: 'exclusion',
  [COMPOSITE.MULTIPLY]: 'multiply',
  [COMPOSITE.HSL_HUE]: 'hue',
  [COMPOSITE.HSL_SATURATION]: 'saturation',
  [COMPOSITE.HSL_COLOR]: 'color',
  [COMPOSITE.HSL_LUMINOSITY]: 'luminosity',
};

/** XML 1.0 第 5 版 §2.3 の NameStartChar (「:」を除く) */
const NAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
/** idPrefix の字の決まり: NameStartChar に続けて NameChar (NameStartChar・-・.・数字・U+00B7・U+0300〜036F・U+203F〜2040) */
const ID_PREFIX = new RegExp(`^[${NAME_START}][${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

/** 背景の繰り返しのタイルの大きさごとに画像を書く数の上限 (画像ごと。sizedImageId) */
const TILED_SIZES_MAX = 8;

/** 埋め込む画像 (data: の URI) */
/** pdf: PDF の画像 (PDF の出力だけが描く。SVG の書き出しは仮の枠。design/pdf-as-image.md の 3 節) */
type Prepared = { kind: 'raster'; uri: string } | { kind: 'svg'; doc: SvgDoc } | { kind: 'pdf' };

/** fontkit の字形の道の命令 */
type GlyphCommand = { command: string; args: number[] };

/** 書き出す前に、ページの画像の src (と置いた所の言語) を集めるだけの描き手 (PNG に描く pageRaster.ts も使う) */
class ImageCollector implements Painter {
  readonly images = new Map<string, Set<string>>();
  fillRect() {}
  drawGlyph() {}
  drawImage(a: ImageArea) {
    let langs = this.images.get(a.src);
    if (!langs) this.images.set(a.src, (langs = new Set()));
    langs.add(a.language ?? '');
  }
  transform(_m: Matrix, draw: () => void) {
    draw();
  }
  group(_o: number, draw: () => void) {
    draw();
  }
  strokeLine() {}
  clipRect() {}
  restore() {}
  fillPath() {}
  clipPath() {}
  strokePath() {}
}

/** ページに置いた画像の src と、それぞれを置いた所の言語 (無ければ '') */
export function pageImages(sheet: SheetArea): Map<string, Set<string>> {
  const collect = new ImageCollector();
  paintSheet(sheet, collect);
  return collect.images;
}

/** 画像の表の鍵 (src と、置いた所の言語。SVG の systemLanguage を照らす言語ごとに図形を分ける) */
export const imageKey = (src: string, lang: string) => `${src}\u0000${lang}`;

/** SVG の画像を図形にする設定 (ページの SVG・PNG の書き出しで同じもの) */
export interface SvgImageOptions {
  /** 画像の登録所 */
  assets?: AssetStore;
  /** XML のパーサ */
  parseXml: (xml: string) => XmlNode;
  /** systemLanguage を照らす言語 (置いた所に言語の指定が無いとき。TypesetOptions.svgLanguages。PDF と同じ) */
  svgLanguages?: readonly string[];
  /** foreignObject の中身を組む (PdfRenderOptions.typesetForeign と同じもの)。無ければ、中身の文字だけを近似して描く */
  typesetForeign?: PdfRenderOptions['typesetForeign'];
  /** foreignObject の中身を近似したときなどの警告を足す先 */
  warn?: (d: Diagnostic) => void;
}

/**
 * SVG の画像 (登録した src の中身 text) を、置いた所の言語 langs ごとに図形にする (pdfRenderer.ts の toVectors・canvasRenderer.ts と同じ選択肢:
 * 字は書体の輪郭、近似できない filter は画素で計算する)。systemLanguage (SVG 2 §5.6.5) は、置いた所の言語で照らし、言語の指定が無ければ
 * svgLanguages で照らす (どちらも無ければ実行環境の言語)。foreignObject (SVG 2 §23.2) の中身は、typesetForeign で本文と同じ組版で組む
 * (PDF と同じく、中身は svgLanguages で照らして 1 度だけ組む)。
 * SVG の @font-face の書体は、先に読み込む (registerSvgFonts)。結果は言語 ('' は言語の指定の無い所) → 図形。読めない言語は入れない
 */
export async function svgImageDocs(src: string, text: string, langs: Iterable<string>, fonts: FontManager, opts: SvgImageOptions): Promise<Map<string, SvgDoc>> {
  const { assets, parseXml } = opts;
  // SVG の image・use の外のファイル: SVG の場所を基準に、登録した画像を引く (pdfRenderer.ts の toVectors と同じ)
  const base = /^data:/i.test(src) ? undefined : src;
  const image = (href: string) => {
    const r = assets?.get(resolveRef(href, base));
    if (!r?.bytes) return undefined;
    if (r.mime === 'image/png' || r.mime === 'image/jpeg') return { kind: r.mime === 'image/png' ? ('png' as const) : ('jpeg' as const), bytes: r.bytes };
    return undefined;
  };
  const resource = (href: string) => {
    const r = assets?.get(resolveRef(href, base));
    return r?.bytes && r.mime === 'image/svg+xml' ? new TextDecoder().decode(r.bytes) : undefined;
  };
  const fallback = opts.svgLanguages?.length ? opts.svgLanguages.map(svgLanguageTag) : undefined;
  rejoin(thisCall(), await registerSvgFonts(fonts, text));
  // foreignObject の中身を、先に組んでおく (文書の順の番号で引く。parseSvg は同期なので)
  const foreign = opts.typesetForeign
    ? rejoin(thisCall(), await foreignObjectShapes(text, parseXml, opts.typesetForeign, fonts, assets, opts.warn ?? (() => {}), { resource, ...(fallback ? { languages: fallback } : {}) }))
    : [];
  const out = new Map<string, SvgDoc>();
  for (const lang of langs) {
    const languages = lang ? [svgLanguageTag(lang)] : fallback;
    try {
      const doc = parseSvg(text, parseXml, {
        outline: (t, fam, wt, size, style, vertical) => outlineText(fonts, t, fam, wt, size, false, style, vertical),
        image,
        resource,
        approximateFilters: true,
        rasterFilter,
        ...(foreign.length ? { foreignShapes: (i: number) => foreign[i] } : {}),
        ...(languages ? { languages } : {}),
      });
      if (doc) out.set(lang, doc);
    } catch {
      // 読めない SVG は描かない
    }
  }
  return out;
}

/**
 * ページの画像を、SVG に埋め込める形にする (非同期: SVG の @font-face の書体の読み込み・画素の PNG への符号化)。
 * 埋め込めない画像 (中身の無い登録・読めない形式) は、表に入れない (描かない)
 */
async function prepareImages(
  sheet: SheetArea,
  fonts: FontManager,
  opts: SvgRenderOptions,
): Promise<{ images: Map<string, Prepared>; pixels: Map<FilterRasterResult, string> }> {
  const images = new Map<string, Prepared>();
  const pixels = new Map<FilterRasterResult, string>();
  const assets = opts.assets;
  for (const [src, langs] of pageImages(sheet)) {
    const asset = assets?.get(src);
    if (asset?.pdfSource) {
      images.set(imageKey(src, ''), { kind: 'pdf' });
      opts.warn?.(pdfPlaceholderDiagnostic(src, 'SVG'));
      continue;
    }
    if (!asset?.bytes || asset.drawable === false) continue;
    const bytes = asset.bytes;
    if (asset.mime === 'image/png' || asset.mime === 'image/jpeg') {
      images.set(imageKey(src, ''), { kind: 'raster', uri: `data:${asset.mime};base64,${base64(bytes)}` });
      continue;
    }
    if (asset.mime === 'image/gif' || asset.mime === 'image/bmp' || asset.mime === 'image/webp') {
      const px = asset.mime === 'image/gif' ? decodeGif(bytes) : asset.mime === 'image/bmp' ? decodeBmp(bytes) : decodeWebp(bytes);
      if (px) images.set(imageKey(src, ''), { kind: 'raster', uri: `data:image/png;base64,${base64(rejoin(thisCall(), await encodePng(px)))}` });
      continue;
    }
    if (asset.mime !== 'image/svg+xml' || !opts.parseXml) continue;
    const text = new TextDecoder().decode(bytes);
    // SVG の style の @font-face の書体を読み込んでから、図形にする (PDF と同じ)
    const docs = rejoin(thisCall(), await svgImageDocs(src, text, langs, fonts, { ...opts, parseXml: opts.parseXml }));
    for (const [lang, doc] of docs) {
      images.set(imageKey(src, lang), { kind: 'svg', doc });
      // filter を画素で計算した画像は、PNG にしておく (書き出しは同期で行うため)
      const visit = (shapes: SvgShape[]) => {
        for (const sh of shapes) {
          if (sh.image?.pixels && !pixels.has(sh.image.pixels)) pixels.set(sh.image.pixels, '');
          if (sh.group) visit(sh.group.shapes);
          if (sh.fillPattern) visit(sh.fillPattern.shapes);
          for (const m of sh.masks ?? []) visit(m.shapes);
        }
      };
      visit(doc.shapes);
    }
  }
  for (const px of pixels.keys()) pixels.set(px, `data:image/png;base64,${base64(rejoin(thisCall(), await encodePng({ width: px.width, height: px.height, rgba: px.rgba })))}`);
  return { images, pixels };
}

class SvgPainter implements Painter {
  /** 本体の要素 */
  private out: string[] = [];
  /** defs の中身 (切り抜き・グラデーション・模様・マスク) */
  private defs: string[] = [];
  private nextId = 0;
  /** 開いている切り抜きの g の数 (変換・不透明度のグループごと。restore で 1 つ閉じ、グループの終わりで残りを閉じる) */
  private clipDepth: number[] = [0];
  /** 図形の並びの切り抜き・マスク・模様・グラデーション → id (同じ物を 2 度書かない) */
  private shapeIds = new WeakMap<object, Map<number, string>>();
  /** 書体の字形の道の命令 (書体の鍵と字形の番号ごと) */
  private glyphPaths = new Map<string, GlyphCommand[]>();
  /** defs に書いた字形の輪郭の id (書体の鍵と字形の番号ごと。輪郭の無い字形は undefined) */
  private glyphIds = new Map<string, string | undefined>();
  /** 画像の data: の URI → defs に 1 度だけ書いた画像の id (同じ画像を何度置いても、中身は 1 度だけ書く) */
  private imageIds = new Map<string, string>();
  /** 背景の繰り返しのタイルの画像: data: の URI → タイルの大きさ → id */
  private sizedIds = new Map<string, Map<string, string>>();
  /** 画像のバイト列 (SVG の中の画像・色つきの字形の画像) → その画像の id (同じバイト列を、置くたびに base64 にしない) */
  private bytesIds = new WeakMap<Uint8Array, string>();
  /** いまの座標の拡大率 (ページの座標 pt に対して。変換の行列式の平方根の積)。SVG の画像の中では、SVG の根の座標の拡大率 */
  private scale = 1;

  /** いまの変換 (ページの座標 → SVG の根の座標)。本文のリンクの矩形を、ページの中身の上 (本体の後) に、置いた所の変換で書くため */
  private ctm: Matrix = [1, 0, 0, 1, 0, 0];
  /** 本文のリンクの a 要素 (本体の後に書く) */
  private linkEls: string[] = [];
  /** 本体の外 (defs の中の模様・マスクなど) を書いている深さ。その中のリンクは書かない */
  private capturing = 0;
  /** 書かなかった外への飛び先 (警告にする) */
  readonly dropped: DroppedLinks = {};

  constructor(
    private fonts: FontManager,
    private images: Map<string, Prepared>,
    private pixels: Map<FilterRasterResult, string>,
    private prefix: string,
    private parseXml?: (xml: string) => XmlNode,
    private linkOpts: Pick<SvgRenderOptions, 'links' | 'pageIndex' | 'destinations' | 'pageHref'> = {},
    /** 文書の id (このページの飛び先)。中で付ける id は、これとぶつからないものにする */
    private reserved: ReadonlySet<string> = new Set(),
  ) {}

  private id(): string {
    let id: string;
    do id = `${this.prefix}${this.nextId++}`;
    while (this.reserved.has(id));
    return id;
  }

  /**
   * リンクの飛び先を、a 要素の href の値 (エスケープの前) にする。書かないものは undefined。
   * 外への飛び先は、PDF と同じ決まり (judgeExternalLink) に通し、通さないものは数える (判定に使った、前処理の後の文字列を書く)。
   * 文書の中の飛び先は、同じページなら #id、別のページなら pageHref の名前に #id を付ける
   */
  private hrefOf(link: LinkTarget): string | undefined {
    if (link.external !== undefined) {
      const j = judgeExternalLink(link.external, this.linkOpts.links);
      if (!j.allowed) {
        countDroppedLink(this.dropped, j);
        return undefined;
      }
      return xmlSafeUrl(j.url);
    }
    if (link.internal === undefined || !XML_CHARS.test(link.internal)) return undefined;
    const page = this.linkOpts.destinations?.[link.internal];
    if (page === undefined) return undefined;
    const frag = `#${fragmentOf(link.internal)}`;
    if (page === this.linkOpts.pageIndex) return frag;
    const file = this.linkOpts.pageHref?.(page);
    return typeof file === 'string' ? xmlSafeUrl(file) + frag : undefined;
  }

  /** 本文のリンク: 領域の矩形 (透明で押せる。pointer-events の既定 visiblePainted は、塗りが none でなければ当たる。SVG 2 §16.6) */
  mark(a: Area, x: number, y: number) {
    if (!a.link || this.capturing || !(a.width > 0 && a.height > 0)) return;
    const href = this.hrefOf(a.link);
    if (href === undefined) return;
    const c = this.ctm;
    const tf = c[0] === 1 && c[1] === 0 && c[2] === 0 && c[3] === 1 && c[4] === 0 && c[5] === 0 ? '' : ` transform="${matrixAttr(c)}"`;
    this.linkEls.push(`<a xlink:href="${esc(href)}"><rect x="${num(x)}" y="${num(y)}" width="${num(a.width)}" height="${num(a.height)}"${tf} fill="#ffffff" fill-opacity="0"/></a>`);
  }

  /**
   * 画像 (data: の URI) を、defs の中の単位正方形 (左上が原点。(0, 0)〜(1, 1) が画像の全体) の image 要素として 1 度だけ書き、その id を返す。
   * 置く所は use で参照する (SVG 1.1 §5.6: use は参照した要素を、use の transform の座標で描く)。同じ画像を何度置いても、
   * base64 の中身は 1 度だけ書く (置くたびに書くと、小さな画像でも置く数に比例して出力が大きくなる)
   */
  private imageId(uri: string): string {
    let id = this.imageIds.get(uri);
    if (!id) {
      id = this.id();
      this.imageIds.set(uri, id);
      this.defs.push(`<image id="${id}" width="1" height="1" preserveAspectRatio="none" xlink:href="${uri}"/>`);
    }
    return id;
  }

  /** 画像 (data: の URI) を w × h の image として defs に 1 度だけ書いた id。画像ごとに TILED_SIZES_MAX 通りまで (超えたら undefined) */
  private sizedImageId(uri: string, w: number, h: number): string | undefined {
    let sizes = this.sizedIds.get(uri);
    if (!sizes) this.sizedIds.set(uri, (sizes = new Map()));
    const k = `${num(w)}x${num(h)}`;
    let id = sizes.get(k);
    if (!id) {
      if (sizes.size >= TILED_SIZES_MAX) return undefined;
      id = this.id();
      sizes.set(k, id);
      this.defs.push(`<image id="${id}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" xlink:href="${uri}"/>`);
    }
    return id;
  }

  /** 画像のバイト列 (mime の画像) の id (imageId)。同じバイト列は、2 度目からは base64 にしない */
  private bytesImageId(bytes: Uint8Array, mime: string): string {
    let id = this.bytesIds.get(bytes);
    if (!id) {
      id = this.imageId(`data:${mime};base64,${base64(bytes)}`);
      this.bytesIds.set(bytes, id);
    }
    return id;
  }

  /** 画像 id を、単位正方形 → いまの座標の行列 m で置く use 要素 (attrs は opacity・style など) */
  private useImage(id: string, m: readonly number[], attrs = ''): string {
    return `<use xlink:href="#${id}" transform="${matrixAttr(m)}"${attrs}/>`;
  }

  result(): { defs: string; body: string; links: string } {
    this.closeClips();
    return { defs: this.defs.join(''), body: this.out.join(''), links: this.linkEls.join('') };
  }

  private closeClips() {
    const n = this.clipDepth[this.clipDepth.length - 1];
    for (let i = 0; i < n; i++) this.out.push('</g>');
    this.clipDepth[this.clipDepth.length - 1] = 0;
  }

  /** 中で開いた切り抜きを、終わりで閉じる (Canvas の save・restore と同じく、切り抜きは変換・グループの中だけで効く) */
  private scope(open: string, draw: () => void) {
    this.out.push(open);
    this.clipDepth.push(0);
    try {
      draw();
    } finally {
      this.closeClips();
      this.clipDepth.pop();
      this.out.push('</g>');
    }
  }

  transform(m: Matrix, draw: () => void) {
    const saved = this.scale;
    const savedCtm = this.ctm;
    this.scale *= Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    this.ctm = mulMatrix(savedCtm, m);
    try {
      this.scope(`<g transform="${matrixAttr(m)}">`, draw);
    } finally {
      this.scale = saved;
      this.ctm = savedCtm;
    }
  }

  group(opacity: number, draw: () => void) {
    this.scope(`<g opacity="${num(opacity)}">`, draw);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${fillAttr(color)}/>`);
  }

  strokeLine(l: Line, width: number, color = '#000') {
    const { hex, a } = rgbOf(color);
    this.out.push(
      `<line x1="${num(l.x1)}" y1="${num(l.y1)}" x2="${num(l.x2)}" y2="${num(l.y2)}" stroke="${hex}"${a < 1 ? ` stroke-opacity="${num(a)}"` : ''} stroke-width="${num(width)}"/>`,
    );
  }

  private openClip(d: string, evenOdd?: boolean) {
    const id = this.id();
    this.defs.push(`<clipPath id="${id}"><path d="${d}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.out.push(`<g clip-path="url(#${id})">`);
    this.clipDepth[this.clipDepth.length - 1]++;
  }

  clipRect(r: Rect) {
    this.openClip(`M${num(r.x)} ${num(r.y)}h${num(r.width)}v${num(r.height)}h${num(-r.width)}Z`);
  }

  clipPath(path: PathSeg[], evenOdd?: boolean) {
    this.openClip(pathData(path), evenOdd);
  }

  restore() {
    const i = this.clipDepth.length - 1;
    if (this.clipDepth[i] > 0) {
      this.clipDepth[i]--;
      this.out.push('</g>');
    }
  }

  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity = 1) {
    this.out.push(`<path d="${pathData(path)}"${fillAttr(color, opacity)}${evenOdd ? ' fill-rule="evenodd"' : ''}/>`);
  }

  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]) {
    const { hex, a } = rgbOf(color);
    this.out.push(
      `<path d="${pathData(path)}" fill="none" stroke="${hex}"${a < 1 ? ` stroke-opacity="${num(a)}"` : ''} stroke-width="${num(width)}"${dash ? ` stroke-dasharray="${num(dash[0])} ${num(dash[1])}"` : ''}/>`,
    );
  }

  /** 書体 f の字形 id の道の命令 (書体の単位。y 上向き)。読めなければ空 */
  private glyphCommands(f: ReturnType<FontManager['get']>, id: number): GlyphCommand[] {
    const key = `${f.key}\u0000${id}`;
    let cmds = this.glyphPaths.get(key);
    if (!cmds) {
      try {
        cmds = (f.fk as unknown as { getGlyph(id: number): { path: { commands: GlyphCommand[] } } }).getGlyph(id).path.commands;
      } catch {
        // 字形のデータが壊れている書体 (fontkit が読めない字) は、その字を描かずに続ける (PDF・Canvas と同じ)
        cmds = [];
      }
      this.glyphPaths.set(key, cmds);
    }
    return cmds;
  }

  drawGlyph(g: GlyphArea, x: number, y: number) {
    const f = this.fonts.get(g.fontFamily, g.fontWeight);
    // 字の描く原点 (基線の左端) への変換: 位置 → 回転 → 横の伸縮 → 疑似斜体 (Canvas の drawGlyph と同じ順)
    const tf = [`translate(${num(x + g.baselineX)} ${num(y + g.baselineY)})`];
    if (g.rotation) tf.push(`rotate(${g.rotation})`);
    if (g.scaleX !== 1) tf.push(`scale(${coef(g.scaleX)} 1)`);
    if (g.italic) tf.push(`matrix(1 0 ${coef(-ITALIC_SLANT)} 1 0 0)`);
    const cf = colorFontOf(f);
    if (cf) {
      this.out.push(`<g transform="${tf.join(' ')}">`);
      this.drawColorGlyph(g, f, cf);
      this.out.push('</g>');
      return;
    }
    const glyphs = areaGlyphs(g, f);
    const k = g.fontSize / f.unitsPerEm;
    // 字形は、書体の単位の道 (y 上向き) として defs に字形ごとに 1 度だけ書き、置く所は use で参照する (同じ字を何度置いても、輪郭は 1 度だけ書く。
    // SVG 1.1 §5.6)。字の描く原点の座標へは scale(k −k)、字形ごとの位置 (書体の単位の (u, v)) は use の x・y
    const uses: string[] = [];
    for (const gl of glyphs) {
      const id = this.glyphId(f, gl.id);
      if (id) uses.push(`<use xlink:href="#${id}"${gl.u ? ` x="${num(gl.u)}"` : ''}${gl.v ? ` y="${num(gl.v)}"` : ''}`);
    }
    if (!uses.length) return;
    const { hex, a } = rgbOf(g.color);
    tf.push(`scale(${coef(k)} ${coef(-k)})`);
    // 疑似太字: 輪郭を、字の大きさの FAKE_BOLD 倍の太さでなぞる (Canvas・PDF と同じ)。太さは書体の単位 (字の大きさ ÷ k = unitsPerEm)
    const bold = g.fakeBold ? ` stroke="${hex}"${a < 1 ? ` stroke-opacity="${num(a)}"` : ''} stroke-width="${num(f.unitsPerEm * FAKE_BOLD)}"` : '';
    const paint = ` transform="${tf.join(' ')}" fill="${hex}"${a < 1 ? ` fill-opacity="${num(a)}"` : ''}${bold}`;
    // 字形が 1 つなら use に直に書く (和文の字は、ふつう 1 字ずつの字の領域)
    this.out.push(uses.length === 1 ? `${uses[0]}${paint}/>` : `<g${paint}>${uses.map((u) => `${u}/>`).join('')}</g>`);
  }

  /** 書体 f の字形 gid の輪郭 (書体の単位。y 上向き) を defs に 1 度だけ書き、その id を返す。輪郭の無い字形 (空白など) は undefined */
  private glyphId(f: ReturnType<FontManager['get']>, gid: number): string | undefined {
    const key = `${f.key}\u0000${gid}`;
    if (this.glyphIds.has(key)) return this.glyphIds.get(key);
    let d = '';
    for (const c of this.glyphCommands(f, gid)) {
      const a = c.args;
      if (c.command === 'moveTo') d += `M${num(a[0])} ${num(a[1])}`;
      else if (c.command === 'lineTo') d += `L${num(a[0])} ${num(a[1])}`;
      else if (c.command === 'quadraticCurveTo') d += `Q${num(a[0])} ${num(a[1])} ${num(a[2])} ${num(a[3])}`;
      else if (c.command === 'bezierCurveTo') d += `C${num(a[0])} ${num(a[1])} ${num(a[2])} ${num(a[3])} ${num(a[4])} ${num(a[5])}`;
      else if (c.command === 'closePath') d += 'Z';
    }
    const id = d ? this.id() : undefined;
    if (id) this.defs.push(`<path id="${id}" d="${d}"/>`);
    this.glyphIds.set(key, id);
    return id;
  }

  /**
   * 色つきの字形を描く (colorGlyphCanvas.ts の drawColorGlyphArea と同じ命令の並び)。いまの座標は、字の描く原点 (pt。y 下向き)。
   * 色つきの絵の無い字形は、輪郭を文字の色で塗る
   */
  private drawColorGlyph(g: GlyphArea, f: ReturnType<FontManager['get']>, cf: NonNullable<ReturnType<typeof colorFontOf>>) {
    ensureSvgGlyphReader(cf, this.parseXml);
    const k = g.fontSize / cf.unitsPerEm;
    const pc = parseColor(g.color);
    const fg: Rgb = pc.mode === 'rgb' ? [pc.r, pc.g, pc.b] : [(1 - pc.c) * (1 - pc.k), (1 - pc.m) * (1 - pc.k), (1 - pc.y) * (1 - pc.k)];
    const fgAlpha = pc.mode === 'rgb' ? (pc.a ?? 1) : 1;
    for (const gl of areaGlyphs(g, f)) {
      const glyph = cf.glyph(gl.id, g.fontPalette);
      this.out.push(`<g transform="translate(${num(gl.u * k)} ${num(-gl.v * k)}) scale(${coef(k)} ${coef(-k)})">`);
      if (glyph) {
        const b = glyph.bbox;
        if (glyph.clip) {
          const id = this.id();
          this.defs.push(`<clipPath id="${id}"><rect x="${num(b[0])}" y="${num(b[1])}" width="${num(b[2] - b[0])}" height="${num(b[3] - b[1])}"/></clipPath>`);
          this.out.push(`<g clip-path="url(#${id})">`);
        }
        const e = Math.max(b[2] - b[0], b[3] - b[1], 1) * 0.01 + 1;
        this.colorOps(glyph.ops, fg, fgAlpha, [b[0] - e, b[1] - e, b[2] + e, b[3] + e]);
        if (glyph.clip) this.out.push('</g>');
      } else {
        const outline = cf.outline(gl.id);
        if (outline.length) this.out.push(`<path d="${pathData(outline)}"${fillAttr(g.color)}/>`);
      }
      this.out.push('</g>');
    }
  }

  /** 色つきの字形の塗り → SVG の fill の値 (グラデーションは defs に書く) と不透明度 */
  private colorFill(fill: ColorFill, fg: Rgb, fgAlpha: number): { paint: string; opacity: number } {
    const rgbHex = (rgb: Rgb) => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
    if (fill.kind === 'solid') return { paint: rgbHex(fill.color.rgb ?? fg), opacity: fill.color.a * (fill.color.rgb ? 1 : fgAlpha) };
    const stops = plainStops(fill.stops, fg);
    if (fill.kind === 'sweep') {
      // 扇形のグラデーション (COLR の PaintSweepGradient) は SVG に無いので、止まり点の色の平均で塗る (近似)
      const n = Math.max(1, stops.length);
      const avg = [0, 1, 2].map((i) => stops.reduce((s, st) => s + st.rgb[i], 0) / n) as Rgb;
      return { paint: rgbHex(avg), opacity: stops.reduce((s, st) => s + st.a, 0) / n };
    }
    // 止まり点の外の延ばし方 (COLR の Extend) は SVG の spreadMethod (SVG 1.1 §13.2.2 の pad・repeat・reflect) と同じ
    const spread = fill.extend === 1 ? ' spreadMethod="repeat"' : fill.extend === 2 ? ' spreadMethod="reflect"' : '';
    const stopEls = stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${rgbHex(s.rgb)}"${s.a < 1 ? ` stop-opacity="${num(s.a)}"` : ''}/>`).join('');
    const id = this.id();
    if (fill.kind === 'linear') this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(fill.x0)}" y1="${num(fill.y0)}" x2="${num(fill.x1)}" y2="${num(fill.y1)}"${spread}>${stopEls}</linearGradient>`);
    else
      // 2 つの円のグラデーション: 0 の円を焦点の円 (fx・fy・fr。SVG 2 §14.4.2)、1 の円を終わりの円にする
      this.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${num(fill.x0)}" fy="${num(fill.y0)}" fr="${num(fill.r0)}" cx="${num(fill.x1)}" cy="${num(fill.y1)}" r="${num(fill.r1)}"${spread}>${stopEls}</radialGradient>`,
      );
    return { paint: `url(#${id})`, opacity: 1 };
  }

  /** 色つきの字形の描画の命令を書く (書体の単位。y 上向き)。box は、いまの切り抜きの中の全体を塗るときの範囲 */
  private colorOps(ops: readonly ColorOp[], fg: Rgb, fgAlpha: number, box: [number, number, number, number]) {
    for (const o of ops) {
      if (o.op === 'fill' || o.op === 'paint') {
        const { paint, opacity } = this.colorFill(o.fill, fg, fgAlpha);
        const d = o.op === 'fill' ? pathData(o.path) : `M${num(box[0])} ${num(box[1])}H${num(box[2])}V${num(box[3])}H${num(box[0])}Z`;
        this.out.push(`<path d="${d}" fill="${paint}"${opacity < 1 ? ` fill-opacity="${num(opacity)}"` : ''}${o.op === 'fill' && o.evenOdd ? ' fill-rule="evenodd"' : ''}/>`);
      } else if (o.op === 'stroke') {
        const { paint, opacity } = this.colorFill(o.fill, fg, fgAlpha);
        this.out.push(
          `<path d="${pathData(o.path)}" fill="none" stroke="${paint}"${opacity < 1 ? ` stroke-opacity="${num(opacity)}"` : ''} stroke-width="${num(o.width)}" stroke-linecap="${CAPS[o.cap]}" stroke-linejoin="${JOINS[o.join]}" stroke-miterlimit="${num(o.miter)}"${o.dash?.length ? ` stroke-dasharray="${o.dash.map(num).join(' ')}"` : ''}${o.dashOffset ? ` stroke-dashoffset="${num(o.dashOffset)}"` : ''}/>`,
        );
      } else if (o.op === 'clip') {
        const id = this.id();
        this.defs.push(`<clipPath id="${id}"><path d="${pathData(o.path)}"${o.evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
        this.out.push(`<g clip-path="url(#${id})">`);
        this.colorOps(o.ops, fg, fgAlpha, box);
        this.out.push('</g>');
      } else if (o.op === 'transform') {
        this.out.push(`<g transform="${matrixAttr(o.m)}">`);
        this.colorOps(o.ops, fg, fgAlpha, box);
        this.out.push('</g>');
      } else if (o.op === 'composite') {
        // 描画モード (混ぜ方) は mix-blend-mode にする。Porter-Duff の合成 (source-in など) は SVG の要素に無いので、上に重ねる (近似)。
        // CLEAR は何も描かず、SRC は上だけ、DEST は下だけを描く
        if (o.mode === COMPOSITE.CLEAR) continue;
        this.out.push('<g style="isolation:isolate">');
        if (o.mode !== COMPOSITE.SRC) this.colorOps(o.backdrop, fg, fgAlpha, box);
        if (o.mode !== COMPOSITE.DEST) {
          const blend = BLEND_OF[o.mode];
          this.out.push(blend ? `<g style="mix-blend-mode:${blend}">` : '<g>');
          this.colorOps(o.source, fg, fgAlpha, box);
          this.out.push('</g>');
        }
        this.out.push('</g>');
      } else if (o.op === 'image') {
        // 左下 (x, y)・幅 w・高さ h (y 上向き)。画像の 1 行目が上に来るように、y を裏返して置く (単位正方形 (u, v) → (x + u·w, y + h − v·h))
        this.out.push(this.useImage(this.bytesImageId(o.data, `image/${o.kind === 'jpg' ? 'jpeg' : 'png'}`), [o.w, 0, 0, -o.h, o.x, o.y + o.h]));
      }
    }
  }

  /**
   * 背景画像の繰り返し: 1 枚のタイルを模様 (pattern。SVG 1.1 §13.3) にして region を塗る (1 枚ずつ並べると、隣どうしの縁のぼかしが重なって、
   * 継ぎ目に筋が出る。PDF のタイリングパターンと同じ)。模様の原点は (x, y)、間隔は画像の大きさ
   */
  drawImageTiled(a: ImageArea, x: number, y: number, region: Rect): boolean {
    if (!(a.width > 0 && a.height > 0)) return false;
    // 画素の画像のタイルは、タイルの大きさの image (defs に、画像と大きさごとに 1 度) を変換なしで参照する。単位正方形を変換で引き伸ばして
    // 参照すると、Chromium で模様の中の画素がわずかに (最大 1/255) 変わった。大きさの違うタイルが多い画像 (TILED_SIZES_MAX を超える) は、
    // 単位正方形の参照に戻す (大きさごとに中身を書き、出力が大きくなるのを避ける)
    const p = this.images.get(imageKey(a.src, a.language ?? '')) ?? this.images.get(imageKey(a.src, ''));
    const sized = p?.kind === 'raster' ? this.sizedImageId(p.uri, a.width, a.height) : undefined;
    const tile = sized ? `<use xlink:href="#${sized}"/>` : this.capture(() => this.drawImage(a, 0, 0));
    if (!tile) return true;
    const id = this.id();
    this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(a.width)}" height="${num(a.height)}">${tile}</pattern>`);
    this.out.push(`<rect x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}" fill="url(#${id})"/>`);
    return true;
  }

  drawImage(a: ImageArea, x: number, y: number) {
    const p = this.images.get(imageKey(a.src, a.language ?? '')) ?? this.images.get(imageKey(a.src, ''));
    if (!p) return;
    if (p.kind === 'pdf') return paintPlaceholder(a, x, y, this);
    if (p.kind === 'raster') {
      // 領域の大きさに引き伸ばす (組版が、置く大きさを決めてある。Canvas の drawImage と同じ)
      // 置く大きさの image を参照する (大きさの違う置き方が多い画像は、単位正方形を変換で引き伸ばす。sizedImageId)
      const sized = this.sizedImageId(p.uri, a.width, a.height);
      this.out.push(sized ? `<use xlink:href="#${sized}" x="${num(x)}" y="${num(y)}"/>` : this.useImage(this.imageId(p.uri), [a.width, 0, 0, a.height, x, y]));
      return;
    }
    // SVG の画像: viewBox と preserveAspectRatio で置く (SVG 2 §8.2 の equivalent transform。canvasRenderer.ts の drawSvgShapes と同じ)。
    // 画像の領域で切り抜く
    const doc = p.doc;
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
    this.clipRect({ x, y, width: a.width, height: a.height });
    this.out.push(`<g transform="${matrixAttr([sx, 0, 0, sy, x + ox - sx * vx, y + oy - sy * vy])}">`);
    const savedScale = this.scale;
    const savedUnit = unitPt;
    this.scale *= Math.sqrt(Math.abs(sx * sy)) || 1;
    unitPt = this.scale;
    try {
      this.shapes(doc.shapes);
    } finally {
      this.scale = savedScale;
      unitPt = savedUnit;
    }
    this.out.push('</g>');
    this.restore();
  }

  /** 図形の切り抜き・マスク・模様・グラデーションの id (同じ物は 1 度だけ defs に書く) */
  private defId(o: object, write: (id: string) => string): string {
    // 同じ物も、置く拡大率 (this.scale) が違えば別に書く (座標の桁 (num の unitPt) とマスクの範囲が、拡大率で変わるので。
    // 同じ SVG を違う大きさで置いたとき、2 度目が 1 度目の桁で書かれないように)
    let byScale = this.shapeIds.get(o);
    if (!byScale) this.shapeIds.set(o, (byScale = new Map()));
    let id = byScale.get(this.scale);
    if (!id) {
      id = this.id();
      byScale.set(this.scale, id);
      this.defs.push(write(id));
    }
    return id;
  }

  private gradientId(g: SvgGradient): string {
    return this.defId(g, (id) => {
      const c = g.coords;
      const stops = g.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${esc(s.color)}"${s.opacity !== undefined && s.opacity < 1 ? ` stop-opacity="${num(s.opacity)}"` : ''}/>`).join('');
      const tf = ` gradientUnits="userSpaceOnUse" gradientTransform="${matrixAttr(g.matrix)}"`;
      return g.kind === 'linear'
        ? `<linearGradient id="${id}"${tf} x1="${num(c[0])}" y1="${num(c[1])}" x2="${num(c[2])}" y2="${num(c[3])}">${stops}</linearGradient>`
        : `<radialGradient id="${id}"${tf} fx="${num(c[0])}" fy="${num(c[1])}" fr="${num(c[2])}" cx="${num(c[3])}" cy="${num(c[4])}" r="${num(c[5])}">${stops}</radialGradient>`;
    });
  }

  private patternId(p: SvgPattern): string {
    return this.defId(p, (id) => `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(p.width)}" height="${num(p.height)}" patternTransform="${matrixAttr(p.matrix)}">${this.capture(() => this.shapes(p.shapes))}</pattern>`);
  }

  private clipId(c: SvgClip): string {
    return this.defId(c, (id) => `<clipPath id="${id}"><path d="${pathData(c.segs)}"${c.evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
  }

  private maskId(m: SvgMask): string {
    // マスクの範囲は、図形の座標の全体 (maskUnits を userSpaceOnUse にして、十分に広く取る。SVG 1.1 §14.4 の既定 -10% は、図形の外接矩形が基準で狭い)。
    // 広さは、ページの上の 100,000pt (どの紙よりも広い) を、いまの座標の単位にしたもの (大きな viewBox の SVG では、根の座標の数が大きい)
    const R = 100000 / this.scale;
    return this.defId(
      m,
      (id) =>
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(-R)}" y="${num(-R)}" width="${num(2 * R)}" height="${num(2 * R)}"${m.alpha ? ' style="mask-type:alpha"' : ''}>${this.capture(() => this.shapes(m.shapes))}</mask>`,
    );
  }

  /** draw が本体に書くものを、文字列にして返す (本体には書かない) */
  private capture(draw: () => void): string {
    const saved = this.out;
    this.out = [];
    this.capturing++;
    try {
      draw();
      return this.out.join('');
    } finally {
      this.out = saved;
      this.capturing--;
    }
  }

  /** 図形の並び (svg.ts の SvgShape。座標は SVG の根の座標) を書く */
  private shapes(shapes: readonly SvgShape[]) {
    for (let sh of shapes) {
      // SVG の画像の中のリンク (a 要素。sh.link): 本文のリンクと同じ決まりに通したものだけを、図形を包む a にする
      // (決まりを通さずに書くと、--link-schemes で止めた URI が、SVG を見る側で開けるリンクになる)。模様・マスクの中には書かない
      const href = sh.link !== undefined && !this.capturing ? this.hrefOf({ external: sh.link }) : undefined;
      let close = '';
      if (href !== undefined) {
        this.out.push(`<a xlink:href="${esc(href)}">`);
        close = '</a>';
      }
      for (const c of sh.clips ?? []) {
        this.out.push(`<g clip-path="url(#${this.clipId(c)})">`);
        close = '</g>' + close;
      }
      for (const m of sh.masks ?? []) {
        this.out.push(`<g mask="url(#${this.maskId(m)})">`);
        close = '</g>' + close;
      }
      const blend = sh.blend ? `mix-blend-mode:${sh.blend}` : '';
      if (sh.group) {
        // 透明のグループ: 中を重ねてから、不透明度と描画モードで置く (Compositing and Blending 1 §3.3 の isolated group)
        this.out.push(`<g${sh.fillOpacity < 1 ? ` opacity="${num(sh.fillOpacity)}"` : ''} style="isolation:isolate${blend ? `;${blend}` : ''}">`);
        this.shapes(sh.group.shapes);
        this.out.push('</g>');
      } else if (sh.image) {
        const uri = sh.image.pixels ? this.pixels.get(sh.image.pixels) : undefined;
        const id = sh.image.pixels ? (uri ? this.imageId(uri) : undefined) : this.bytesImageId(sh.image.bytes, `image/${sh.image.kind}`);
        if (id) {
          // matrix は、画像の単位正方形 (左下が原点、上の辺が画像の 1 行目) → 根の座標。SVG の image の単位正方形 (左上が原点) を裏返して合わせる
          const [a, b, c, d, e, f] = sh.image.matrix;
          this.out.push(this.useImage(id, [a, b, -c, -d, c + e, d + f], `${sh.fillOpacity < 1 ? ` opacity="${num(sh.fillOpacity)}"` : ''}${blend ? ` style="${blend}"` : ''}`));
        }
      } else if (sh.segs.length) {
        // 拡大しない線・大きさ (vector-effect): PDF と同じく、SVG を置く拡大率で割った太さ・破線・大きさの、ふつうの図形にする
        // (SVG の vector-effect に任せると、破線の長さと non-scaling-size が PDF と違う)
        if (sh.nonScalingStroke || sh.nonScalingAnchor) sh = resolveNonScaling(sh, 0.75 / this.scale);
        let attrs = '';
        if (sh.fillPaint) attrs += ` fill="url(#${this.gradientId(sh.fillPaint)})"`;
        else if (sh.fillPattern) attrs += ` fill="url(#${this.patternId(sh.fillPattern)})"`;
        else if (sh.fill !== undefined) attrs += ` fill="${esc(sh.fill)}"`;
        else attrs += ' fill="none"';
        if (sh.fillOpacity < 1) attrs += ` fill-opacity="${num(sh.fillOpacity)}"`;
        if (sh.evenOdd) attrs += ' fill-rule="evenodd"';
        if ((sh.stroke !== undefined || sh.strokePaint) && sh.strokeWidth > 0) {
          attrs += sh.strokePaint ? ` stroke="url(#${this.gradientId(sh.strokePaint)})"` : ` stroke="${esc(sh.stroke!)}"`;
          if (sh.strokeOpacity < 1) attrs += ` stroke-opacity="${num(sh.strokeOpacity)}"`;
          attrs += ` stroke-width="${num(sh.strokeWidth)}"`;
          if (sh.lineCap) attrs += ` stroke-linecap="${CAPS[sh.lineCap]}"`;
          if (sh.lineJoin) attrs += ` stroke-linejoin="${JOINS[sh.lineJoin]}"`;
          if (sh.miterLimit !== undefined && sh.miterLimit !== 4) attrs += ` stroke-miterlimit="${num(sh.miterLimit)}"`;
          if (sh.dash?.length) attrs += ` stroke-dasharray="${sh.dash.map(num).join(' ')}"`;
          if (sh.dashOffset) attrs += ` stroke-dashoffset="${num(sh.dashOffset)}"`;
        }
        if (blend) attrs += ` style="${blend}"`;
        this.out.push(`<path d="${pathData(sh.segs)}"${attrs}/>`);
      }
      this.out.push(close);
    }
  }
}

/**
 * ページ (SheetArea) を SVG の文書にする。大きさは紙の大きさ (pt。塗り足し・トンボの領域を含む)。紙は白で塗る (Canvas と同じ)
 */
export async function renderSheetToSvg(sheet: SheetArea, fonts: FontManager, opts: SvgRenderOptions = {}): Promise<string> {
  const prefix = opts.idPrefix ?? 'k';
  // id の頭の文字は、XML の名前 (XML 1.0 第 5 版 §2.3 の Name。ただし名前空間で意味を持つ「:」は除く (Namespaces in XML 1.0 §3 の NCName)) にする。
  // id 属性 (id="…") と、CSS の url(#…) の中にそのまま書くので、引用符・空白・括弧などが入ると、文書が壊れる
  if (!ID_PREFIX.test(prefix))
    throw new RangeError(
      msg(
        `idPrefix は、XML の名前 (英字・_・ほかの言語の文字などで始め、数字・-・. なども続けられる。: は使えない) にしてください: ${JSON.stringify(prefix.slice(0, 40))}`,
        `idPrefix must be an XML name without colons (starting with a letter, _ or another name-start character, followed by name characters such as digits, - and .): ${JSON.stringify(prefix.slice(0, 40))}`,
      ),
    );
  const { images, pixels } = rejoin(thisCall(), await prepareImages(sheet, fonts, opts));
  // このページの飛び先の id (文書の中のリンクの #id の先)。ページの上の端を指す (PDF のリンクの飛び先 (XYZ のページの上) と同じ)
  const anchors = Object.entries(opts.destinations ?? {})
    .filter(([id, k]) => k === opts.pageIndex && XML_CHARS.test(id))
    .map(([id]) => id);
  const painter = new SvgPainter(fonts, images, pixels, prefix, opts.parseXml, opts, new Set(anchors));
  paintSheet(sheet, painter, { guides: opts.guides });
  const { defs, body, links } = painter.result();
  const summary = summarizeDroppedLinks(painter.dropped);
  if (summary) opts.warn?.(diag('link/action-dropped', droppedLinkWarning(summary, 'svg')));
  const w = num(sheet.width);
  const h = num(sheet.height);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    // 飛び先: ページの全体の、塗らない矩形 (押しても当たらない。HTML に直に入れたときも、そこへ送られる)
    anchors.map((id) => `<rect id="${esc(id)}" width="${w}" height="${h}" fill="none"/>`).join('') +
    body +
    links +
    `</svg>\n`
  );
}
