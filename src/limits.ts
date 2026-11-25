/**
 * limits — 入力の上限 (小さな入力で時間とメモリを使い切らせないためのもの) を、選択肢 (TypesetOptions.limits・コマンドの --limit) で変える所。
 *
 *  - 上限には 2 つの種類がある。時間・大きさの上限 ('size': 画素の数・バイト・字・手間・数) は上げ下げでき、
 *    入れ子の深さ・再帰の段の上限 ('depth': スタックを使い切らないためのもの) は下げることだけができる
 *  - 既定の値は、前から各所に決め打ちしていた値と同じ (選択肢を渡さなければ、前と同じに動く)。値の根拠は、元の定数のコメントにある
 *    (元の定数は、この表の既定の値を指す名前として残す。test/limits.test.ts が、表と元の定数が食い違わないことを確かめる)
 *  - 呼び出しの入口 (api.ts の beginCall) で、選択肢を確かめて凍ったオブジェクト (Limits) にし、呼び出しごとの文脈 (callContext.ts) に載せる。
 *    組版の途中の関数は limits() で読む (呼び出しの外では既定の値)。モジュールの変数を書き換えないので、同時に走る呼び出しの上限は混ざらない
 *  - 上げても、ファイルの大きさによる縛り (符号の密度・展開の比。imageLimits.ts) は変えない。上げた上限まで使えるのは、それに見合う大きさのファイルだけ
 */
import { currentCall } from './callContext';
import { KumioriOptionError } from './errors';
import { msg } from './messages';

/** 上限の種類: 'size' は上げ下げでき、'depth' は下げるだけ */
export type LimitKind = 'size' | 'depth';

interface LimitDef {
  /** 既定の値 (0 は「ほかの選択肢から決める」の印。説明は note) */
  readonly def: number;
  readonly kind: LimitKind;
  /** 上げられる上限の天井 (実装の天井: V8 の文字列の長さ・配列の大きさなど)。無ければ Number.MAX_SAFE_INTEGER */
  readonly ceiling?: number;
  /** 単位と、何の上限か (--list-limits と誤りの文に使う) */
  readonly ja: string;
  readonly en: string;
}

const MB = 1024 * 1024;
/** V8 の文字列の長さの上限 (2^29 - 24 字) の少し下。字の数の上限の天井 */
const STRING_CEILING = 500_000_000;
/** バイト列の天井 (ブラウザの ArrayBuffer が確保できる大きさ: 2GB 弱) */
const BYTES_CEILING = 2 ** 31 - 1;
/** 画素の数の天井 (RGBA で 4GB) */
const PIXELS_CEILING = 2 ** 30;

/**
 * 入力の上限 (TypesetOptions.limits)。渡さない名前は既定の値 (既定の値は LIMIT_DEFS と docs/library.md の「入力の上限」)。値は 1 以上の整数。
 * 時間・大きさの上限は上げ下げでき、入れ子の深さの上限 (下げるだけと書いたもの) は下げることだけができる。
 * 上げると、その分だけ時間とメモリを多く使いうる (SECURITY.md)
 */
export interface KumioriLimits {
  // 画像・ファイル・取得
  /** 1 枚の画像のピクセルの数 (EPS の画像の合計、PNG に書き出すときにキャッシュする画像も)。上げ下げできる */
  imagePixels?: number;
  /** 渡したファイル 1 つ・取得する画像 1 件・EPUB の 1 項目の大きさ (バイト)。上げ下げできる */
  fileBytes?: number;
  /** 取得する CSS 1 件の大きさ (バイト)。上げ下げできる */
  cssBytes?: number;
  /** 取得するフォント 1 件・WOFF を戻したフォントの大きさ (バイト)。上げ下げできる */
  fontBytes?: number;
  /** フォントの集まり (TTC・OTC) から取り出すフォントの合計 (バイト)。上げ下げできる */
  fontCollectionBytes?: number;
  /** 1 つの文書で使う OS のフォントの数 (systemFonts)。上げ下げできる */
  systemFontFaces?: number;
  /** 文書の画像の取得の全体の時限 (ミリ秒。既定は fetchTimeoutMs の 10 倍)。上げ下げできる */
  imageFetchTotalMs?: number;
  /** 転送 (redirect) をたどる回数。下げるだけ */
  redirects?: number;
  /** 集める CSS・フォントの参照の数。上げ下げできる */
  styleRefs?: number;
  /** 取得する CSS の @import の段の数。下げるだけ */
  importDepth?: number;
  /** @import で広げた CSS の長さの合計 (文字)。上げ下げできる */
  importedCssChars?: number;
  /** @import の数。上げ下げできる */
  cssImports?: number;
  // プラグイン・draw.io の結果 (画像の形式)
  /** 画像の形式 (プラグイン・draw.io) の結果の幅・高さ (px。draw.io の図の大きさ・座標も)。上げ下げできる */
  formatSize?: number;
  /** 画像の形式の結果の SVG の長さの絶対の上限 (文字。ファイルの大きさによる制約は変えない)。上げ下げできる */
  formatSvgChars?: number;
  /** 画像の形式の読み込みの時限 (ミリ秒。これに fetchTimeoutMs の 3 倍を足す)。上げ下げできる */
  formatLoadMs?: number;
  /** 1 つのファイルを # の後ろの違う参照で読む数。上げ下げできる */
  formatFragments?: number;
  // PDF の画像 (PDF のページを図として貼るもの)
  /** 1 つの PDF の画像の間接オブジェクトの数。上げ下げできる */
  pdfImageObjects?: number;
  /** 1 つの PDF の画像のページの数 (ページツリーをたどる数)。上げ下げできる */
  pdfImagePages?: number;
  /** PDF の画像のページツリーの段・リソースの入れ子の深さ。下げるだけ */
  pdfImageDepth?: number;
  /** PDF の画像の 1 つのページ (ページの範囲は、範囲の全体) で圧縮を解くストリームの合計 (バイト)。上げ下げできる */
  pdfImageStreamBytes?: number;
  /** 1 つの PDF の画像を読み込む時限 (ミリ秒。ページの範囲の埋め込みは、範囲の全体で)。上げ下げできる */
  pdfImageLoadMs?: number;
  /** PDF の画像のページの範囲 (互換の指定の page=2-5・all など) で並べるページの数。上げ下げできる */
  pdfImageRangePages?: number;
  // EPS・メタファイル・EPUB
  /** 1 つの EPS の実行の時限 (ミリ秒)。上げ下げできる */
  epsMs?: number;
  /** 1 つの文書の EPS の実行の時間の合計 (ミリ秒)。上げ下げできる */
  epsDocumentMs?: number;
  /** 1 つの EPS のメモリの合計と VM の上限 (バイト)。上げ下げできる */
  epsMemoryBytes?: number;
  /** 1 つの EPS のパスの点の合計。上げ下げできる */
  epsPathPoints?: number;
  /** EPS の image 1 枚のピクセルの数。上げ下げできる */
  epsImagePixels?: number;
  /** EPS・メタファイル・CGM を SVG にした長さの絶対の上限 (文字)。上げ下げできる */
  epsSvgChars?: number;
  /** WMF・EMF・CGM の画像のピクセルの合計の絶対の上限 (ファイルの大きさによる制約は変えない)。上げ下げできる */
  metafileImagePixels?: number;
  /** WMF・EMF のクリッピングの演算の計算量 (クリップパスの点の数も同じ比で動かす)。上げ下げできる */
  metafileClipWork?: number;
  /** 1 つの EPUB を展開する量の合計 (バイト)。上げ下げできる */
  epubTotalBytes?: number;
  /** EPUB の項目の数 (zip の項目・章の並び)。下げるだけ */
  epubEntries?: number;
  /** EPUB の章と CSS の文字の数の合計。上げ下げできる */
  epubTextChars?: number;
  // 文書の木・CSS・XML (入れ子の深さは下げるだけ。種類ごとの既定の上限と、この値の小さい方を使う: nestLimit・cssNestLimit)
  /** 要素の入れ子の深さ。既定の 300 は、いちばん大きい種類の値で、実際の既定は種類ごと (HTML 128・XSL-FO 250・SVG 250・MathML 300・変換の入れ子 300・draw.io 256)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く (HTML が 300 段まで組めるわけではない)。下げるだけ */
  nestingDepth?: number;
  /** CSS の入れ子の深さ。既定の 64 は、いちばん大きい種類の値で、実際の既定は種類ごと (規則の入れ子・@supports・calc() 64、@layer の名前・数学の関数・セレクター・SVG の calc() 32)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く。下げるだけ */
  cssNesting?: number;
  /** XML の内部実体の入れ子の深さ。下げるだけ */
  entityDepth?: number;
  /** XML の内部実体の展開で増える文字の数。上げ下げできる */
  entityChars?: number;
  /** CSS の入れ子の規則を展開したセレクターの数。上げ下げできる */
  nestedSelectors?: number;
  /** セレクターの照合のキャッシュの計算量。上げ下げできる */
  selectorWork?: number;
  /** 同じ名前の診断の数 (超えた分は「ほかに n 件」にまとめる)。上げ下げできる */
  diagnosticsPerCode?: number;
  // 組版
  /** 表の列の数 (col の span・colspan も)。上げ下げできる */
  tableColumns?: number;
  /** 表の構造で、またがれるマスの数。上げ下げできる */
  tableSpannedCells?: number;
  /** 1 つのリーダーに並べる文字の数。上げ下げできる */
  leaderRepeats?: number;
  /** 1 つの数式の文字の数。上げ下げできる */
  mathGlyphs?: number;
  /** グリッドの列の並びを展開した数 (repeat())。上げ下げできる */
  gridTracks?: number;
  // SVG
  /** SVG の use で広げた要素の数。上げ下げできる */
  svgElements?: number;
  /** SVG の広げたパスの区間の数の絶対の上限 (ファイルの大きさによる制約は変えない)。上げ下げできる */
  svgPathSegments?: number;
  /** SVG の中の CSS の照合の回数。上げ下げできる */
  svgCssMatches?: number;
  /** SVG の filter をピクセルで計算する計算量 (1 つの SVG)。上げ下げできる */
  svgFilterWork?: number;
  /** 1 ページの SVG のリンク (a) の注釈の数。上げ下げできる */
  svgLinksPerPage?: number;
  // 描画 (PNG・画面・PDF/X のフラット化)
  /** PNG に書き出す 1 枚のピクセルの数。上げ下げできる */
  pngPixels?: number;
  /** PNG に書き出すときにキャッシュする画像のピクセルの合計 (既定は imagePixels と同じ)。上げ下げできる */
  pngImageCachePixels?: number;
  /** PNG の 1 ページでラスタライズする画像の合計。上げ下げできる */
  pngPageImagePixels?: number;
  /** PNG の 1 ページをラスタライズする計算量 (1 ピクセルあたり。基本の 6,400 万も同じ比で動かす)。上げ下げできる */
  pngRasterWork?: number;
  /** PNG を描画する間に同時に持つオフスクリーンのバッファーのピクセルの数の絶対の上限 (広がるバッファーは、実際に広げた大きさで数える)。上げ下げできる */
  pngLayerPixels?: number;
  /** 画面 (renderPage) で SVG の画像をラスタライズするときのピクセルの数。上げ下げできる */
  canvasSvgPixels?: number;
  /** 画面 (renderPage) で SVG の画像 1 つをラスタライズする計算量 (1 回の描画の合計は、その 4 倍)。上げ下げできる */
  canvasSvgWork?: number;
  /** PDF/X で透明をフラット化するときの 1 つの画像のピクセルの数。上げ下げできる */
  flattenPixels?: number;
  // draw.io
  /** 圧縮した draw.io の図を戻した長さ (バイト)。上げ下げできる */
  drawioChars?: number;
  /** draw.io の図のセルの数 (XML の要素の数は、その 10 倍)。上げ下げできる */
  drawioCells?: number;
  /** draw.io の 1 つの図のラベルの文字の数の合計。上げ下げできる */
  drawioLabelChars?: number;
  /** draw.io の図を SVG にした長さ (文字。書く文字の合計は、その 2 倍まで)。上げ下げできる */
  drawioSvgChars?: number;
  /** draw.io の 1 つの図で取得する画像の数 (配布物の画像・URL の画像のそれぞれ)。上げ下げできる */
  drawioImages?: number;
}

/** 上限の名前 */
export type LimitName = keyof KumioriLimits;

/**
 * 公開する上限の表。名前は「何の」+ 単位 (…Pixels は画素、…Bytes はバイト、…Chars は字、…Ms はミリ秒、ほかは数)。
 * 1 つの名前が、組になった内部の上限をまとめて動かすことがある (説明は各項目)
 */
export const LIMIT_DEFS = {
  // 画像・ファイル・取得
  imagePixels: { def: 1e8, kind: 'size', ceiling: PIXELS_CEILING, ja: '1 枚の画像のピクセルの数 (EPS の画像の合計、PNG に書き出すときにキャッシュする画像も)', en: 'pixels in one image (also the total of EPS images, and the images kept when writing PNG)' },
  fileBytes: { def: 256 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: '渡したファイル 1 つ・取得する画像 1 件の大きさ (バイト。画面で EPUB を読むときの 1 項目の大きさにも使う。画面では既定の値)', en: 'size of one given file or one fetched image (bytes; also the size of one EPUB entry when the browser app reads an EPUB, with the default value there)' },
  cssBytes: { def: 16 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: '取得する CSS 1 件の大きさ (バイト)', en: 'size of one fetched CSS file (bytes)' },
  fontBytes: { def: 128 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: '取得するフォント 1 件・WOFF を戻したフォントの大きさ (バイト)', en: 'size of one fetched font, or of a decoded WOFF font (bytes)' },
  fontCollectionBytes: { def: 1024 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: 'フォントの集まり (TTC・OTC) から取り出すフォントの合計 (バイト)', en: 'total size of the fonts taken out of a font collection (TTC/OTC) (bytes)' },
  systemFontFaces: { def: 16, kind: 'size', ceiling: 10_000, ja: '1 つの文書で使う OS のフォントの数 (systemFonts)', en: 'OS fonts used in one document (systemFonts)' },
  imageFetchTotalMs: { def: 0, kind: 'size', ja: '文書の画像の取得の全体の時限 (ミリ秒。既定は fetchTimeoutMs の 10 倍)', en: 'time limit for fetching all images of a document (ms; default: 10 times fetchTimeoutMs)' },
  redirects: { def: 20, kind: 'depth', ja: '転送 (redirect) をたどる回数', en: 'redirects to follow' },
  styleRefs: { def: 500, kind: 'size', ja: '集める CSS・フォントの参照の数', en: 'CSS and font references to collect' },
  importDepth: { def: 8, kind: 'depth', ja: '取得する CSS の @import の段の数', en: 'levels of @import in fetched CSS' },
  importedCssChars: { def: 8 * MB, kind: 'size', ceiling: STRING_CEILING, ja: '@import で広げた CSS の長さの合計 (文字)', en: 'total length of CSS expanded by @import (characters)' },
  cssImports: { def: 10_000, kind: 'size', ja: '@import の数', en: 'number of @import rules' },
  // プラグイン・draw.io の結果 (画像の形式)
  formatSize: { def: 1e7, kind: 'size', ceiling: 1e9, ja: '画像の形式 (プラグイン・draw.io) の結果の幅・高さ (px。draw.io の図の大きさ・座標も)', en: 'width and height of an image-format (plugin, draw.io) result (px; also the size and coordinates of draw.io diagrams)' },
  formatSvgChars: { def: 128 * MB, kind: 'size', ceiling: STRING_CEILING, ja: '画像の形式の結果の SVG の長さの絶対の上限 (文字。ファイルの大きさによる制約は変えない)', en: 'absolute limit on the length of the SVG from an image format (characters; the limit by file size is unchanged)' },
  formatLoadMs: { def: 60_000, kind: 'size', ja: '画像の形式の読み込みの時限 (ミリ秒。これに fetchTimeoutMs の 3 倍を足す)', en: 'time limit for loading with an image format (ms; three times fetchTimeoutMs is added)' },
  formatFragments: { def: 64, kind: 'size', ja: '1 つのファイルを # の後ろの違う参照で読む数', en: 'references to one file with different fragments (#)' },
  // PDF の画像 (pdfImage.ts。design/pdf-as-image.md の 4 節)
  pdfImageObjects: { def: 1_000_000, kind: 'size', ja: '1 つの PDF の画像の間接オブジェクトの数', en: 'indirect objects in one PDF image' },
  pdfImagePages: { def: 100_000, kind: 'size', ja: '1 つの PDF の画像のページの数 (ページツリーをたどる数)', en: 'pages in one PDF image (pages visited in its page tree)' },
  pdfImageDepth: { def: 64, kind: 'depth', ja: 'PDF の画像のページツリーの段・リソースの入れ子の深さ', en: 'depth of the page tree and of nested resources in a PDF image' },
  pdfImageStreamBytes: { def: 256 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: 'PDF の画像の 1 つのページ (ページの範囲は、範囲の全体) で圧縮を解くストリームの合計 (バイト)', en: 'total decompressed size of the streams of one page of a PDF image (for a page range, of the whole range) (bytes)' },
  pdfImageLoadMs: { def: 60_000, kind: 'size', ja: '1 つの PDF の画像を読み込む時限 (ミリ秒。ページの範囲の埋め込みは、範囲の全体で)', en: 'time limit for loading one PDF image (ms; for embedding a page range, for the whole range)' },
  pdfImageRangePages: { def: 64, kind: 'size', ja: 'PDF の画像のページの範囲 (互換の指定の page=2-5・all など) で並べるページの数', en: 'pages placed side by side for a page range of a PDF image (page=2-5, all and so on, in compatibility mode)' },
  // EPS・メタファイル・EPUB
  epsMs: { def: 20_000, kind: 'size', ja: '1 つの EPS の実行の時限 (ミリ秒)', en: 'time limit for running one EPS (ms)' },
  epsDocumentMs: { def: 60_000, kind: 'size', ja: '1 つの文書の EPS の実行の時間の合計 (ミリ秒)', en: 'total time for running the EPS files of one document (ms)' },
  epsMemoryBytes: { def: 512 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: '1 つの EPS のメモリの合計と VM の上限 (バイト)', en: 'total memory and VM of one EPS (bytes)' },
  epsPathPoints: { def: 5_000_000, kind: 'size', ja: '1 つの EPS のパスの点の合計', en: 'path points in one EPS' },
  epsImagePixels: { def: 64_000_000, kind: 'size', ceiling: PIXELS_CEILING, ja: 'EPS の image 1 枚のピクセルの数', en: 'pixels in one EPS image' },
  epsSvgChars: { def: 128 * MB, kind: 'size', ceiling: STRING_CEILING, ja: 'EPS・メタファイル・CGM を SVG にした長さの絶対の上限 (文字)', en: 'absolute limit on the length of the SVG made from EPS, metafiles and CGM (characters)' },
  metafileImagePixels: { def: 64_000_000, kind: 'size', ceiling: 1e8, ja: 'WMF・EMF・CGM の画像のピクセルの合計の絶対の上限 (ファイルの大きさによる制約は変えない)', en: 'absolute limit on the total pixels of the images in a WMF/EMF/CGM file (the limit by file size is unchanged)' },
  metafileClipWork: { def: 50_000_000, kind: 'size', ja: 'WMF・EMF のクリッピングの演算の計算量 (クリップパスの点の数も同じ比で動かす)', en: 'work for clipping operations in WMF/EMF (path clipping points scale by the same ratio)' },
  epubTotalBytes: { def: 1024 * MB, kind: 'size', ceiling: BYTES_CEILING, ja: '1 つの EPUB を展開する量の合計 (バイト) (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、limits・--limit で変えても効かない)', en: 'total uncompressed size of one EPUB (bytes) (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so limits and --limit have no effect on it)' },
  epubEntries: { def: 65_535, kind: 'depth', ja: 'EPUB の項目の数 (zip の項目・章の並び) (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、limits・--limit で変えても効かない)', en: 'entries in an EPUB (zip entries, chapters in the spine) (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so limits and --limit have no effect on it)' },
  epubTextChars: { def: 2 ** 27, kind: 'size', ceiling: STRING_CEILING, ja: 'EPUB の章と CSS の文字の数の合計 (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、limits・--limit で変えても効かない)', en: 'total characters of the chapters and stylesheets of an EPUB (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so limits and --limit have no effect on it)' },
  // 文書の木・CSS・XML (入れ子の深さは下げるだけ。種類ごとの既定の上限と、この値の小さい方を使う: nestLimit・cssNestLimit)
  nestingDepth: { def: 300, kind: 'depth', ja: '要素の入れ子の深さ。既定の 300 は、いちばん大きい種類の値で、実際の既定は種類ごと (HTML 128・XSL-FO 250・SVG 250・MathML 300・変換の入れ子 300・draw.io 256)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く (HTML が 300 段まで組めるわけではない)', en: 'element nesting depth. The default 300 is the value of the largest kind; the actual defaults are per kind (HTML 128, XSL-FO 250, SVG 250, MathML 300, transforms 300, draw.io 256). A given value is combined with each default by taking the smaller, so lowering it affects every kind (HTML cannot be nested 300 levels deep)' },
  cssNesting: { def: 64, kind: 'depth', ja: 'CSS の入れ子の深さ。既定の 64 は、いちばん大きい種類の値で、実際の既定は種類ごと (規則の入れ子・@supports・calc() 64、@layer の名前・数学の関数・セレクター・SVG の calc() 32)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く', en: 'CSS nesting depth. The default 64 is the value of the largest kind; the actual defaults are per kind (nested rules, @supports and calc() 64; @layer names, math functions, selectors and calc() in SVG 32). A given value is combined with each default by taking the smaller, so lowering it affects every kind' },
  entityDepth: { def: 8, kind: 'depth', ja: 'XML の内部実体の入れ子の深さ', en: 'nesting depth of XML internal entities' },
  entityChars: { def: 2 ** 27, kind: 'size', ceiling: STRING_CEILING, ja: 'XML の内部実体の展開で増える文字の数', en: 'characters added by expanding XML internal entities' },
  nestedSelectors: { def: 10_000, kind: 'size', ja: 'CSS の入れ子の規則を展開したセレクターの数', en: 'selectors made by expanding nested CSS rules' },
  selectorWork: { def: 30_000_000, kind: 'size', ja: 'セレクターの照合のキャッシュの計算量', en: 'work for memoized selector matching' },
  diagnosticsPerCode: { def: 200, kind: 'size', ja: '同じ名前の診断の数 (超えた分は「ほかに n 件」にまとめる)', en: 'diagnostics with the same code (the rest are summarized as "n more")' },
  // 組版
  tableColumns: { def: 1000, kind: 'size', ja: '表の列の数 (col の span・colspan も)', en: 'table columns (also col span and colspan)' },
  tableSpannedCells: { def: 20_000, kind: 'size', ja: '表の構造で、またがれるマスの数', en: 'spanned slots in a table structure' },
  leaderRepeats: { def: 20_000, kind: 'size', ja: '1 つのリーダーに並べる文字の数', en: 'characters repeated in one leader' },
  mathGlyphs: { def: 20_000, kind: 'size', ja: '1 つの数式の文字の数', en: 'glyphs in one formula' },
  gridTracks: { def: 10_000, kind: 'size', ja: 'グリッドの列の並びを展開した数 (repeat())', en: 'grid tracks after expanding repeat()' },
  // SVG
  svgElements: { def: 500_000, kind: 'size', ja: 'SVG の use で広げた要素の数', en: 'SVG elements expanded by use' },
  svgPathSegments: { def: 5_000_000, kind: 'size', ja: 'SVG の広げたパスの区間の数の絶対の上限 (ファイルの大きさによる制約は変えない)', en: 'absolute limit on expanded SVG path segments (the limit by file size is unchanged)' },
  svgCssMatches: { def: 500_000, kind: 'size', ja: 'SVG の中の CSS の照合の回数', en: 'CSS matches inside an SVG' },
  svgFilterWork: { def: 400_000_000, kind: 'size', ja: 'SVG の filter をピクセルで計算する計算量 (1 つの SVG)', en: 'work for computing SVG filters in pixels (one SVG)' },
  svgLinksPerPage: { def: 5000, kind: 'size', ja: '1 ページの SVG のリンク (a) の注釈の数', en: 'link annotations from SVG a elements on one page' },
  // 描く (PNG・画面・PDF/X の平らにする処理)
  pngPixels: { def: 40_000_000, kind: 'size', ceiling: 2 ** 28, ja: 'PNG に書き出す 1 枚のピクセルの数', en: 'pixels in one PNG page' },
  pngImageCachePixels: { def: 0, kind: 'size', ceiling: PIXELS_CEILING, ja: 'PNG に書き出すときにキャッシュする画像のピクセルの合計 (既定は imagePixels と同じ)', en: 'total pixels of the images kept when writing PNG (default: same as imagePixels)' },
  pngPageImagePixels: { def: 400_000_000, kind: 'size', ja: 'PNG の 1 ページでラスタライズする画像の合計', en: 'total image pixels decoded for one PNG page' },
  pngRasterWork: { def: 128, kind: 'size', ja: 'PNG の 1 ページをラスタライズする計算量 (1 ピクセルあたり。基本の 6,400 万も同じ比で動かす)', en: 'work for rasterizing one PNG page (per pixel; the base 64 million scales by the same ratio)' },
  pngLayerPixels: { def: 64_000_000, kind: 'size', ceiling: 2 ** 28, ja: 'PNG を描画する間に同時に持つオフスクリーンのバッファーのピクセルの数の絶対の上限 (広がるバッファーは、実際に広げた大きさで数える)', en: 'absolute limit on the pixels of layers held at once while drawing PNG (growing layers are counted by the size they grow to)' },
  canvasSvgPixels: { def: 16_000_000, kind: 'size', ceiling: 2 ** 28, ja: '画面 (renderPage) で SVG の画像をラスタライズするときのピクセルの数', en: 'pixels when rasterizing an SVG image for renderPage' },
  canvasSvgWork: { def: 8_000_000_000, kind: 'size', ja: '画面 (renderPage) で SVG の画像 1 つをラスタライズする計算量 (1 回の描画の合計は、その 4 倍)', en: 'work for rasterizing one SVG image for renderPage (four times this per drawing)' },
  flattenPixels: { def: 36_000_000, kind: 'size', ceiling: 2 ** 28, ja: 'PDF/X で透明をフラット化するときの 1 つの画像のピクセルの数', en: 'pixels of one image when flattening transparency for PDF/X' },
  // draw.io
  drawioChars: { def: 64 * MB, kind: 'size', ceiling: STRING_CEILING, ja: '圧縮した draw.io の図を戻した長さ (バイト)', en: 'decompressed size of a compressed draw.io diagram (bytes)' },
  drawioCells: { def: 20_000, kind: 'size', ja: 'draw.io の図のセルの数 (XML の要素の数は、その 10 倍)', en: 'cells in a draw.io diagram (XML elements: 10 times this)' },
  drawioLabelChars: { def: 2_000_000, kind: 'size', ceiling: STRING_CEILING, ja: 'draw.io の 1 つの図のラベルの文字の数の合計', en: 'total label characters in one draw.io diagram' },
  drawioSvgChars: { def: 16 * MB, kind: 'size', ceiling: STRING_CEILING / 2, ja: 'draw.io の図を SVG にした長さ (文字。書く文字の合計は、その 2 倍まで)', en: 'length of the SVG made from a draw.io diagram (characters; up to twice this is written in total)' },
  drawioImages: { def: 200, kind: 'size', ja: 'draw.io の 1 つの図で取得する画像の数 (配布物の画像・URL の画像のそれぞれ)', en: 'images fetched for one draw.io diagram (bundle images and URL images, each)' },
} as const satisfies Record<LimitName, LimitDef>;



/** 確かめて既定の値を埋めた上限 (凍っている) */
export type Limits = Readonly<{ [K in LimitName]: number }>;

export const LIMIT_NAMES = Object.keys(LIMIT_DEFS) as LimitName[];

/** 既定の上限 */
export const DEFAULT_LIMITS: Limits = Object.freeze(Object.fromEntries(LIMIT_NAMES.map((k) => [k, LIMIT_DEFS[k].def])) as { [K in LimitName]: number });

/** いまの呼び出しの上限 (呼び出しの外では既定の値) */
export function limits(): Limits {
  return currentCall()?.limits ?? DEFAULT_LIMITS;
}

/**
 * 上限に当たって、入力を切った・近似したことを、いまの呼び出しに記録する (呼び出しの終わりに、上限の名前ごとに 1 件の診断 limit/reached にする。
 * api.ts の limitsReachedDiagnostics)。上限を下げた利用者が、何が切られたかを知れるように。呼び出しの外では何もしない。
 * 前から専用の診断・警告のある所 (limit/table-columns・limit/css-import など) では使わない
 */
export function noteLimitReached(name: LimitName): void {
  currentCall()?.limitsReached?.add(name);
  limitTap.fn?.(name);
}

/**
 * 上限に当たった名前を、記録と別に知らせる先 (組版エンジンが、page-sequence を組む間に当たった上限を集める。器が前の文書のページを
 * 使い回すとき、組まずに済ませた page-sequence の分も、同じ記録を残すため)
 */
export const limitTap: { fn?: (name: LimitName) => void } = {};

const optionError = (m: string, option: string) => new KumioriOptionError(msg(`オプションのエラー: ${m}`, `invalid option: ${m}`), option);

/** 上限の値を確かめる (誤りは KumioriOptionError)。path は誤りの option の名前の頭 (limits・setup.limits) */
function checkValue(k: LimitName, v: unknown, path: string): number {
  const d: LimitDef = LIMIT_DEFS[k];
  const name = `${path}.${k}`;
  if (!(typeof v === 'number' && Number.isSafeInteger(v) && v >= 1)) throw optionError(msg(`${name} は 1 以上の整数にしてください: ${String(v)}`, `${name} must be an integer of 1 or more: ${String(v)}`), name);
  if (d.kind === 'depth' && v > d.def)
    throw optionError(msg(`${name} は下げることだけができます (既定の ${d.def} 以下にしてください): ${v}`, `${name} can only be lowered (use ${d.def} or less): ${v}`), name);
  const ceiling = d.ceiling ?? Number.MAX_SAFE_INTEGER;
  if (v > ceiling) throw optionError(msg(`${name} は ${ceiling} までです: ${v}`, `${name} can be at most ${ceiling}: ${v}`), name);
  return v;
}

/**
 * 選択肢の上限を確かめて、base (器の上限・既定) の上に名前ごとに重ねる。given が無ければ base。
 * 知らない名前・1 以上の整数でない値・下げるだけの上限を既定より大きくした値・天井を超える値は KumioriOptionError
 */
export function resolveLimits(given: unknown, base: Limits = DEFAULT_LIMITS, path = 'limits'): Limits {
  if (given === undefined) return base;
  if (typeof given !== 'object' || given === null || Array.isArray(given)) throw optionError(msg(`${path} はオブジェクトにしてください`, `${path} must be an object`), path);
  const out: { [K in LimitName]: number } = { ...base };
  for (const [k, v] of Object.entries(given)) {
    if (v === undefined) continue;
    if (!Object.hasOwn(LIMIT_DEFS, k))
      throw optionError(msg(`${path}.${k} は知らない上限の名前です (kumiori --list-limits で一覧が出ます)`, `${path}.${k} is not a known limit name (kumiori --list-limits shows the list)`), `${path}.${k}`);
    out[k as LimitName] = checkValue(k as LimitName, v, path);
  }
  return Object.freeze(out);
}

/** 既定より上げた上限 (名前と値。表の順) */
export function raisedLimits(l: Limits): Array<{ name: LimitName; value: number; def: number }> {
  return LIMIT_NAMES.filter((k) => LIMIT_DEFS[k].def > 0 ? l[k] > LIMIT_DEFS[k].def : false).map((k) => ({ name: k, value: l[k], def: LIMIT_DEFS[k].def }));
}

/**
 * 上限の指紋: 既定と違う名前と値を並べた文字列 (既定なら '')。器 (createTypesetter) が文書をまたいで覚える結果 (書体の下ごしらえ・段落の行分け) は、
 * 上限で変わりうるので、覚えの鍵に入れて、上限の違う文書の結果を使い回さない
 */
export function limitsKey(l: Limits = limits()): string {
  if (l === DEFAULT_LIMITS) return '';
  return LIMIT_NAMES.filter((k) => l[k] !== LIMIT_DEFS[k].def)
    .map((k) => `${k}=${l[k]}`)
    .join(',');
}

/** 入れ子の深さの上限: 種類ごとの既定 (def) と、呼び出しの nestingDepth の小さい方 */
export function nestLimit(def: number): number {
  return Math.min(def, limits().nestingDepth);
}

/** CSS の入れ子の深さの上限: 種類ごとの既定 (def) と、呼び出しの cssNesting の小さい方 */
export function cssNestLimit(def: number): number {
  return Math.min(def, limits().cssNesting);
}

/** 上限の説明 (--list-limits) */
export function limitDescription(k: LimitName): string {
  const d: LimitDef = LIMIT_DEFS[k];
  return msg(d.ja, d.en);
}
