/**
 * Kumiori の公開 API: HTML+CSS・XSL-FO を組んで、Area Tree と PDF を作る。
 *
 *   import { typeset } from 'kumiori';
 *   const r = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 *   const pdf = await r.toPdf();   // Uint8Array
 *
 * ファイルシステムには触らない。ネットワークは、既定の書体の取得 (loadFont で差し替えられる) と、文書が http(s) で参照する画像の取得
 * (fetchImages で止められる) にだけ使う。ブラウザでも Node でも動く。
 * Node のコマンド (src/cli.ts) も、この関数で組む。
 */

import fontkit from '@pdf-lib/fontkit';
import { FontManager, type LoadedFont } from './fontManager';
import { Measurer } from './measurer';
import { LayoutEngine } from './layoutEngine';
import { renderPdf, renderPdfPages, svgTextWidth, type PdfRenderOptions } from './pdfRenderer';
import { pdfStandardOf, type PdfAOptions, type PdfXOptions } from './pdfStandard';
import { prepareSvgImagesForCanvas, renderSheetToCanvas } from './canvasRenderer';
import { renderSheetToSvg } from './svgRenderer';
import { renderSheetToPng } from './pageRaster';
import { importHtmlparser2, importLinkedom } from './linkedomModules';
import { AssetStore, imageExtensions, looksLikeImage, mentionedFiles, normalizeSrc } from './assets';
import { resourceUseOf } from './resourceUse';
import { formatsOf, pluginProblem, type ImageFormat, type KumioriPlugin } from './imageFormats';
import type { DrawioOptions } from './drawio/index';
import { droppedLinkWarning, summarizeDroppedLinks, type DroppedLinks, type LinkPolicy } from './linkPolicy';
import { SERIF } from './sampleData';
import { importHtml, parsePageSize } from './htmlImport';
import { importXslFo, type ImportOptions } from './xslfoImport';
import { xmlParse } from './xmlParse';
import { fetchReportedImages, mathOptionsFor, type MathOptions } from './documentResources';
import { collectionFaces, faceShapeOf, normalizeFamily, splitFontFile, type FaceTables, type UserFont } from './fontLoader';
import type { AreaTree, FontSpec, LDocument } from './types';
import { documentMode, prepareHtml, type HtmlDefaults } from './htmlPrepare';
import { cascadeStyles, HTML_UA_CSS } from './cssCascade';
import { patchHtmlParserStack } from './htmlParserStack';
import { ensureHtmlLocations, setDocumentSource } from './sourceLocation';
import { countedDiagnostics, diag, DIAGNOSTIC_CODES, DiagnosticList, MAX_DIAGNOSTICS_PER_CODE, type Diagnostic, type DiagnosticCode, type DiagnosticSource } from './diagnostics';
import { KumioriFontError, KumioriOptionError } from './errors';
import { summarizeCounts, unsupportedCssReport } from './cssUnsupported';
import { MESSAGE_LANGS, messageLang, msg, withMessageLang, type MessageLang } from './messages';
import { tooComplexTotal } from './htmlPaged';
import { FO_COMPATS, HTML_STYLES, styleCascadeOptions, compatLayoutOptions, compatPdfOptions, htmlImportCompatOptions, isAhCompat, loadFoHyphenators, type FoCompat } from './compat';
import { FONT_SPECS, FontNameTable, GENERIC_FONT_KEYS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC, EMOJI_SPEC, createFontMapping, faceFileWeights, hasMissingEmoji, hasMissingGlyphs, missingGlyphChars, setGenericFont, setupDefaultFonts, type GenericFontKey } from './fontMapping';
import { hyphenPositions, loadDocumentHyphenators } from './hyphenation';
import { xhtmlToHtml } from './xhtml';
import { collectResources, documentChars, fetchGuarded, refBasename } from './resources';
import { fetchLimits } from './imageLimits';

export type { HtmlDefaults } from './htmlPrepare';
export type { FontSpec } from './types';
export type { LinkPolicy } from './linkPolicy';

/** ファイルの中身 */
export type KumioriFileData = ArrayBuffer | Uint8Array | string;

/**
 * 入力と一緒に渡すファイル (CSS・画像・書体・SVG・MathML など)。name は入力の文書からの相対パス (例: "img/logo.png")。
 * data は中身か、中身を返す関数 (使うときだけ読む。たくさんのファイルを渡すときに)
 */
export interface KumioriFile {
  /** 入力の文書からの相対パス (例: "img/logo.png")。書体のファイルは、ファイル名だけでもよい */
  name: string;
  /** 中身か、中身を返す関数 (使うときだけ呼ぶ。1 度だけ読む) */
  data: KumioriFileData | (() => Promise<KumioriFileData>);
}

/**
 * 組み方の設定 (typeset・typesetToPdf の options。createTypesetter の器では、書体まわり (TypesetterOptions) と文書ごとの設定 (DocumentOptions) に分ける)。
 * どれも省略できる。知らない値は TypeError で拒む
 */
export interface TypesetOptions {
  /**
   * タグ付き PDF (ISO 32000-1 §14.8) にする: 文書の構造 (見出し・段落・リスト・図・リンク・表・脚注)・読む順・図の代わりの文・言語を PDF に入れ、
   * 背景・罫線・柱を飾り (Artifact) にする。既定 true (false でタグを付けない)。HTML・XSL-FO の入力で使える。
   * PDF/X-1a・X-3 (透明を平らにする出力) には付けられない: 既定のままなら、その PDF にはタグを付けずに書き、true と書いたときは誤りにする
   */
  tagged?: boolean;
  /**
   * PDF/UA-1 (ISO 14289-1) の PDF にする: タグ付き PDF (tagged を含む) に、XMP の版の印 (pdfuaid:part)・dc:title と DisplayDocTitle を書き、
   * 字形の無い字 (.notdef) を描かない。文書の題・言語・図と数式の代わりの文・見出しの順の足りないものを警告に出す
   * (true なら組版の警告に、{ warnings } ならその並びに)。PDF/X-1a・X-3 とは一緒に使えない。PDF/X-4・PDF/A とは合わせられる
   */
  pdfua?: boolean | {
    /** PDF/UA-1 の足りないものの警告を足す配列 (無ければ、組版の警告 (TypesetResult.warnings) に足す) */
    warnings?: string[];
  };
  /** 文書の言語 (BCP 47。タグ付き PDF のカタログの Lang)。入力に言語 (HTML の lang、XSL-FO の xml:lang・language) が無いときだけ使う */
  documentLang?: string;
  /** 入力の種類。省略すれば name の拡張子 (.fo・.xml は FO、.xhtml・.xht は XHTML) と中身 (XSL-FO の名前空間と root) で決める */
  kind?: 'html' | 'xhtml' | 'fo';
  /** 入力のファイル名 (種類の判定に使う) */
  name?: string;
  /** 入力と一緒に使うファイル。CSS は、文書から参照されていなければ利用者のスタイルシートとして足す。FO では、書体のファイルを FO の font-family の名前で使う */
  files?: KumioriFile[];
  /**
   * 文書 (HTML) から参照されていない CSS のファイル (files) の扱い。'user-stylesheet' (既定): 利用者のスタイルシートとして足す。
   * 'ignore': 足さずに、警告に出す (コマンドの既定。入力のディレクトリのファイルを全部渡すので、文書と関係の無い CSS が当たらないように)
   */
  unreferencedCss?: 'user-stylesheet' | 'ignore';
  /**
   * 足す書体のファイル (TTF・OTF・TTC・WOFF・WOFF2。システムに入れた書体のように、書体のファミリー名・太さ・幅・傾きで使う)。
   * 斜体の書体は font-style: italic の字に、幅の違う書体 (Arial Narrow など) は font-stretch の指定かその書体の名前で選ぶ (CSS Fonts 4 §5.2)
   */
  fonts?: KumioriFile[];
  /**
   * 総称の書体に使う書体のファミリー名 (fonts で渡した書体か、既定の書体)。CSS Fonts 4 §2.1.3: 総称の書体に当てる書体は処理系が決める。
   *  - serif・sans-serif・monospace: 欧文の字の書体 (既定は Tinos・Arimo・Cousine)
   *  - serif-cjk・sans-serif-cjk: 和文 (欧文の書体に無い字) の書体 (既定は Noto Serif JP・Noto Sans JP)。
   *    等幅の和文は、HTML は sans-serif-cjk、XSL-FO は serif-cjk の書体 (等幅の和文の既定と同じ側)
   */
  genericFonts?: Partial<Record<GenericFontKey, string>>;
  /** HTML の既定のスタイル。既定 kumiori (本の組版向け) */
  style?: HtmlDefaults;
  /**
   * HTML の既定の用紙: `@page` で size を指定していない文書の用紙の大きさ。既定は A4。CSS の size と同じ書き方
   * (CSS Paged Media 3 §7.1: 用紙の名前 "A5"・"JIS-B5"・"letter"、向きを付けた "A5 landscape"、長さ "148mm 210mm"。長さは絶対の単位)。
   * 文書の `@page { size: … }` があれば、そちらが勝つ (向きだけの size: landscape は、この用紙を横置きにする)。余白の既定 (20mm) は変わらない。
   * `@media` の width・height・orientation も、この用紙で評価する (同 §7.1: メディアクエリは、`@page` の規則が無いときに選ばれる用紙で評価する)。
   * 既定のスタイル (style) によらず効く。XSL-FO では使わない (用紙は page master で決まる)
   */
  pageSize?: string;
  /** XSL-FO の既定値の流儀。spec (既定): XSL-FO 1.1 の初期値、antenna: アンテナハウスに合わせる */
  compat?: FoCompat;
  /** 印刷用: 塗り足し 3mm とトンボを付ける */
  print?: boolean;
  /** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1) */
  spotColors?: Record<string, [number, number, number, number]>;
  /** 既定の書体 (Noto Serif JP など。FONT_SPECS) を読む。既定は spec.urls を順に fetch する。undefined を返せば次の手段 (既定の取得) へ */
  loadFont?: (spec: FontSpec) => Promise<ArrayBuffer | undefined>;
  /** ネットワークからの取得 (書体・画像) の時限 (ミリ秒)。既定 30000 */
  fetchTimeoutMs?: number;
  /**
   * 警告・誤りの文の言語 (ja・en)。省略すれば、それまでの設定 (既定は日本語)。
   * 言語は 1 か所で切り替えるので、違う lang の呼び出しを同時に (await を待たずに) 走らせると、重なっている間は、後に始まった呼び出しの言語になる
   * (先に始まった呼び出しの文も)。言語ごとに文を分けたいときは、呼び出しを順に待つか、別の Worker・プロセスで組む
   */
  lang?: MessageLang;
  /**
   * 診断の扱い。ignore: 出さない診断の名前 (docs/diagnostics.md。css/unknown-property など)。その名前の警告は、warnings にも diagnostics にも入れない
   * (PDF を書く途中の警告も)。知らない名前は、止めずに api/unknown-diagnostic-code の警告で知らせる。指定しなければ、すべて出す
   */
  diagnostics?: { ignore?: readonly string[] };
  /**
   * 文書が http(s) の URL で参照する画像 (external-graphic・img・background-image など) をネットワークから取るか。
   * 既定 true (取る)。false なら取らない (読めない画像として組む)。関数なら、URL ごとに取るかどうかを決める。
   * 他人の書いた文書をサーバーで組むときは、false か、取ってよい URL だけを許す関数にする (内部のホストへの要求を防ぐ)。
   * 関数には、文書に書かれた URL のほか、転送 (redirect) の先の URL も聞く (Node では、許されない先へは要求を出さない。たどるのは 20 回まで。
   * https から http への転送と、http(s) でない先への転送は断る)。ブラウザでは転送の先を前もって読めないので、たどった後の最後の URL を聞いて、
   * 許されなければ応答を使わない (要求そのものは転送の先に届く)。
   * 関数が見るのは URL の文字列だけなので、内部のアドレスに解決されるホスト名 (DNS rebinding を含む) は、この関数では防げない。
   * 内部の網を守るには、実行環境の側 (外向きの通信の制限・プロキシ) でも絞ること。
   * 取るものの大きさには上限がある (画像 256MB・CSS 16MB・書体 128MB。超えたものは読めない資源として扱う)
   */
  fetchImages?: boolean | ((url: string) => boolean);
  /**
   * 文書・CSS が参照するファイル (CSS・画像・書体・SVG など) のうち、files に無いものの中身を返す関数。url は書かれた参照
   * (file:///…/a.css・img/a.png・https://…)。CSS の中の相対参照は、その CSS の URL を基準に解決したもの。
   * 中身 (文字列・Uint8Array・ArrayBuffer) を返せば、その名前のファイルとして使う。undefined を返せば、これまでどおり
   * (http(s) の画像・CSS はネットワークから取る。fetchImages・fetchStyles)。ファイルシステムやデータベースから読むときに
   * 画像は、URL に拡張子が無くても (https://example.com/img?id=1 など)、返した中身の先頭のバイト列で画像と見分けて使う
   */
  resolveResource?: (url: string) => KumioriFileData | undefined | Promise<KumioriFileData | undefined>;
  /**
   * SVG の systemLanguage (switch の子を選ぶ条件。SVG 2 §5.6.5) を照らす言語 (BCP 47 の言語タグ。好む順。例 ["ja", "en"])。
   * SVG を置いた所に言語の指定 (HTML の lang・XSL-FO の xml:lang・language) があれば、そちらが勝つ。省けば実行環境の言語
   */
  svgLanguages?: string[];
  /**
   * 文書が http(s) の URL で参照する CSS (<link rel="stylesheet">・`@import`) と、CSS の `@font-face` が http(s) で参照する書体 (WOFF2 など。
   * unicode-range が文書の字と重なるものだけ) をネットワークから取るか。既定 true (取る)。
   * 関数なら、URL ごとに決める。他人の書いた文書をサーバーで組むときは、false か、取ってよい URL だけを許す関数にする。
   * 転送の先の URL の扱い・関数で防げないもの (名前の解決)・大きさの上限は、fetchImages と同じ
   */
  fetchStyles?: boolean | ((url: string) => boolean);
  /** PDF の圧縮 (zlib の deflate)。Node なら zlib.deflateSync を渡すと速い。既定は pdf-lib の圧縮 */
  deflate?: (data: Uint8Array) => Uint8Array;
  /**
   * 文書の外へのリンク (HTML の <a href>・XSL-FO の fo:basic-link・fo:bookmark の external-destination) のうち、PDF に動作を書くもの。
   * 既定では、スキームが http・https・mailto・tel の URL (URI 動作) と、相対参照の PDF (別の PDF を開く動作 GoToR) だけを書く。
   * ほかのスキーム (javascript:・data:・file: など)、PDF でない相対のファイル・絶対パスのファイル (ファイルを開く動作)、スキームの無い //host/… は、
   * 動作を書かず (字はそのまま組む)、warnings に知らせる (他人の書いた文書から作った PDF を、別の人が開くときのため)。
   * schemes: 許すスキームの一覧 (既定の一覧と置き換わる。'*' はすべて)。launch: true なら、ファイルを開く動作 (Launch など) も書く。
   * 以前の版と同じ動き (すべて書く) にするには { schemes: ['*'], launch: true }。
   * relative: スキームの無い相対参照 (file.pdf・a.mp3 など) の書き方。'file' (既定) は、PDF の場所からの相対のファイルを開く動作 (GoToR・Launch)。
   * 'uri' は、書かれた参照のままの URI 動作 (/S /URI /URI (file.pdf)。%xx は解かない)。ブラウザの中の PDF ビューアでも開けるようにするときに使う。
   * 'uri' のときは、PDF でない相対のファイルへのリンクも launch に関わらず書く (絶対パスと //host/… は launch: true のときだけ)。
   * #id は、どちらでも文書の中のリンク
   */
  links?: LinkPolicy;
  /**
   * プラグイン (いまは画像の形式を足すものだけ。KumioriPlugin)。画像のファイルが、プラグインの形式の判定 (sniff) に当たれば、
   * その形式が読み込んで SVG にする (PDF には図形のまま入る)。拡張子 (extensions) の名前のファイルも、文書に名前が出てくれば画像として読む。
   * プラグインはプログラムそのもので、Kumiori と同じ権限で動く。自分で選んだ、信頼できるものだけを渡すこと
   */
  plugins?: KumioriPlugin[];
  /**
   * draw.io (diagrams.net) の図のファイル (.drawio・.dio) の選択肢。図は画像として読み、ページを SVG にして PDF に図形と文字のまま入れる
   * (画像の参照の # の後ろで、描くページを選ぶ: #page=N・#page-id=ID・#ページの名前)。図を描く処理は、図が出てきたときだけ読み込む。
   * stencils: 図形ライブラリ (draw.io の js/stencils.min.js かライブラリの XML) と配布物の画像のファイル。
   * fetchStencils: 図に要る図形ライブラリ・画像が stencils に無いとき、draw.io の配布物から取るか (既定 false。true なら draw.io v24.7.5 の公開のリポジトリから。取った中身は、その版の SHA-256 の一覧と照らす)。
   * Kumiori は図形ライブラリを持たない (docs/drawio.md の「図形ライブラリの利用の条件」)。false なら、draw.io の図を画像として読まない。
   * 同じオブジェクトを渡せば、取った図形ライブラリを、組むたびに取り直さずに使い回す
   */
  drawio?: DrawioOptions | false;
}

/** 組んだ結果 (typeset・Typesetter.typeset の返すもの)。PDF にする (toPdf)・ページを描く (renderPage)・組んだ結果をたどる (areaTree) */
export interface TypesetResult {
  /** 組んだ Area Tree (ページごとのシート) */
  areaTree: AreaTree;
  /** ページ数 */
  pageCount: number;
  /**
   * 組版の警告 (読めない画像・溢れなど)。toPdf を呼ぶと、PDF を書く途中の警告 (描けない字・色つきの字形を色つきで描けないことなど) も、
   * この配列に足す (同じ文は 1 度だけ)
   */
  warnings: string[];
  /**
   * 組版の診断: warnings と同じ出来事を、種類の名前 (code。版をまたいで変えない)・重さ (severity)・文に埋めた値 (args) で持つ (docs/diagnostics.md)。
   * 未対応・知らない CSS と XSL-FO の指定は、warnings では 1 つの文にまとめるが、ここでは名前ごとに 1 件にする。同じ診断は 1 件にして数える (count)。
   * toPdf を呼ぶと、PDF を書く途中の診断も足す
   */
  diagnostics: Diagnostic[];
  /** 組版にかかった時間 (ミリ秒。読み込み・PDF の書き出しは含まない) */
  layoutMs: number;
  /** PDF にする */
  toPdf(options?: PdfOptions): Promise<Uint8Array>;
  /**
   * ページ (0 から数える) を canvas に描く (ブラウザ。印刷プレビューなど)。canvas の大きさは、ページの大きさ × scale に合わせて設定し直す。
   * canvas は、画面の canvas 要素か OffscreenCanvas (Web Worker の中で組んで描くとき。画素にした結果は transferToImageBitmap で画面へ渡せる)。
   * 字は書体ファイルの輪郭から描くので、ページの外の書体の設定 (CSS の `@font-face` など) に左右されない
   */
  renderPage(canvas: HTMLCanvasElement | OffscreenCanvas, pageIndex: number, options?: RenderPageOptions): void;
  /**
   * ページ (0 から数える) を SVG の文書 (文字列) にする (ブラウザでも Node でも使える)。大きさは紙の大きさ (pt)。
   * 字は書体ファイルの輪郭の道にし、画像は文書の中に埋め込むので、SVG だけで描ける (書体・画像のファイルは要らない)
   */
  renderPageToSvg(pageIndex: number, options?: RenderPageSvgOptions): Promise<string>;
  /**
   * ページ (0 から数える) を PNG (8 ビットの RGB。紙は白) にする (ブラウザでも Node でも使える。依存を足さない)。
   * 字は書体ファイルの輪郭から描く。画素にできない画像 (CMYK の JPEG・インターレースの PNG) は描かずに、warnings に足す
   */
  renderPageToPng(pageIndex: number, options?: RenderPagePngOptions): Promise<Uint8Array>;
}

/** renderPageToPng の設定 */
export interface RenderPagePngOptions {
  /** 解像度 (1 インチあたりの画素の数)。既定 96 (1pt = 1.333 画素)。画素の数は 4,000 万まで */
  dpi?: number;
  /** 仕上がり・塗り足しのガイド線を描く (印刷用 print: true のとき)。既定 false */
  guides?: boolean;
}

/** renderPageToSvg の設定 */
export interface RenderPageSvgOptions {
  /** 仕上がり・塗り足しのガイド線を描く (印刷用 print: true のとき)。既定 false */
  guides?: boolean;
  /**
   * SVG の中の id (切り抜き・グラデーション・画像など) の頭に付ける文字列。既定 'k'。1 つの HTML に何枚もの SVG を直に入れるときは、
   * ページごとに違う値にする (id がぶつからないように)。XML の名前 (XML 1.0 §2.3 の Name から「:」を除いたもの) で書く (ほかの字を含むと RangeError)。
   * 頭の文字が別のページの頭の文字の頭にならないようにする (k と k1 では、k10 が重なる。p1-・p2- のように数字でない字で終える)
   */
  idPrefix?: string;
}

/** renderPage の設定 */
export interface RenderPageOptions {
  /** 1pt あたりの CSS px。既定 96 / 72 (等倍。1pt = 1.333px) */
  scale?: number;
  /** 画面の画素の細かさ。既定は window.devicePixelRatio (window の無い Web Worker の中では 1。画面の値を渡す) */
  devicePixelRatio?: number;
  /** 仕上がり・塗り足しのガイド線を描く (印刷用 print: true のとき)。既定 false */
  guides?: boolean;
}

const bytesOf = (d: KumioriFileData): Uint8Array => (typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));
const bufferOf = (d: KumioriFileData): ArrayBuffer => {
  const b = bytesOf(d);
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b.buffer as ArrayBuffer) : (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const textOf = (d: KumioriFileData) => (typeof d === 'string' ? d : new TextDecoder().decode(bytesOf(d)));
/**
 * 中の処理が使う形 (ブラウザの File と同じ: 名前はファイル名、読み出しは text・arrayBuffer)。関数の中身は 1 度だけ読む。
 * url: 参照から取ったファイルの、参照の URL の全体 (問い合わせの ?… も含む。名前が同じでも URL の違うものを取り違えないため)。
 * forget: 読んだ中身の覚えを捨てる (画像の置き場に写した画像。もう 1 度要るときは、関数を呼び直して読む。中身を値で渡されたものは、
 * 値を持つ側がいるので、捨てても空かない)
 */
const toFile = (f: KumioriFile, css = false, url?: string) => {
  let got: Promise<KumioriFileData> | undefined;
  const data = () => (got ??= typeof f.data === 'function' ? f.data() : Promise.resolve(f.data));
  const forget = () => {
    if (typeof f.data === 'function') got = undefined;
  };
  return { name: f.name.split(/[\\/]/).pop()!, path: f.name, css, ...(url !== undefined ? { url } : {}), data, forget, text: async () => textOf(await data()), arrayBuffer: async () => bufferOf(await data()) };
};
/**
 * 相対の道を整える (\\ を / に、. と空の段を除き、a/../ を畳む。先頭の .. は残す)。sub/./note.txt・sub//note.txt・./sub/note.txt を
 * sub/note.txt にそろえる (添付ファイルを、files の名前と参照の両側で同じ形にして比べる。大文字と小文字は変えない)
 */
function tidyRelPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('\\').join('/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** CSS として読むファイル (拡張子 .css か、参照から CSS として取ったもの) */
const isCss = (f: { name: string; css?: boolean }) => !!f.css || /\.css$/i.test(f.name);
type InnerFile = ReturnType<typeof toFile>;

/**
 * 既定の書体を spec.urls (https のもの) から取る (時限つき)。読めた書体は、同じ実行の中で使い回す。
 * 取れなければ undefined (投げない)。Node のコマンドは、これで取った書体をキャッシュに保存する (cli.ts)
 */
const fetchedFonts = new Map<string, Promise<ArrayBuffer | undefined>>();
export async function fetchFont(spec: FontSpec, timeoutMs: number): Promise<ArrayBuffer | undefined> {
  const key = `${spec.family}|${spec.weight ?? 400}`;
  let p = fetchedFonts.get(key);
  if (!p) {
    p = (async () => {
      for (const u of spec.urls.filter((x) => /^https?:/.test(x))) {
        const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined);
        // 中身の読み取りの失敗 (切断など) は、次の URL を試す (この関数は拒否しない)
        if (res?.ok) {
          const buf = await res.arrayBuffer().catch(() => undefined);
          if (buf) return buf;
        }
      }
      return undefined;
    })();
    fetchedFonts.set(key, p);
    p.then(
      (b) => b || fetchedFonts.delete(key),
      () => fetchedFonts.delete(key),
    );
  }
  return p;
}

export { decodeDocumentText } from './documentText';

export { expandInternalEntities } from './xmlParse';

/**
 * HTML・SVG の読み取り。ブラウザの画面の中では、ブラウザに備わった DOMParser (HTML の仕様の読み取り) を使う。
 * Node と、DOMParser の無いブラウザの Web Worker の中では linkedom を使う。linkedom は、そのときだけ読み込む (linkedomModules.ts)
 */
type Parsers = { html: (t: string) => Document; svg: (t: string) => unknown };
let parsersP: Promise<Parsers> | undefined;
function parsers(): Promise<Parsers> {
  return (parsersP ??= (async () => {
    if (typeof DOMParser !== 'undefined' && typeof document !== 'undefined') {
      return {
        html: (t: string) => new DOMParser().parseFromString(t, 'text/html'),
        svg: (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml'),
      };
    }
    const lk = await importLinkedom();
    // linkedom の構文解析器 (htmlparser2) の、開いた要素の列を軽い入れ物にする (深い入れ子で、深さの 2 乗の手間にしない)
    await patchHtmlParserStack();
    // 診断の場所: htmlparser2 の開きタグの位置を、linkedom の要素に結び付ける (sourceLocation.ts)
    await ensureHtmlLocations(async () => ({ Parser: (await importHtmlparser2()).Parser, DOMParser: lk.DOMParser }));
    return {
      html: (t: string) => {
        const w = wrapHtml(t);
        const d = lk.parseHTML(w).document as unknown as Document;
        // 行・列は、読んだ字 (<html> で包んだもの。包んでも改行の数は同じ) で数える
        setDocumentSource(d, w, undefined);
        fixImplicitStructure(d);
        return d;
      },
      svg: (t: string) => new lk.DOMParser().parseFromString(t, 'image/svg+xml'),
    };
  })());
}
/** SVG の読み取り (typeset の始めに parsers() を読み込んでから使う) */
let svgParser: ((t: string) => unknown) | undefined;
const svgParse = (t: string) => svgParser!(t) as never;

/** 画像 (と、FO の external-graphic が指す MathML の文字のファイル) として読むファイル */
/** 画像 (と MathML の文字) のファイルの名前 (assets.ts の imageExtensions。本体の外の形式 (プラグインを含む) の拡張子も含む) */
const imageFileRe = (formats: readonly ImageFormat[]) => new RegExp(`\\.(?:${imageExtensions(formats).join('|')})$`, 'i');

/** 入力の種類 (TypesetOptions.kind) に使える値 */
const KINDS = ['html', 'xhtml', 'fo'] as const;

/** 選択肢の誤り。入口 (createTypesetter・typeset) で検証し、知らない値を無言で下流へ流さない (JavaScript や JSON の設定から呼ぶ利用者には型の守りが無い) */
const optionError = (m: string, option?: string) => new KumioriOptionError(msg(`選択肢の誤り: ${m}`, `invalid option: ${m}`), option);
/**
 * 選択肢の引数そのもの: 省略 (undefined) か、オブジェクト。null や文字列などは、中の値を読む前に選択肢の誤りにする
 * (前は null で、o.lang を読むところの生の TypeError になっていた)
 */
function optionsObject<T extends object>(o: T | undefined, name: string): T {
  if (o === undefined) return {} as T;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw optionError(msg(`${name} はオブジェクトにしてください`, `${name} must be an object`), name);
  return o;
}

/** 決まった値のどれか (省略 (undefined) はそのまま) */
function oneOf<T extends string>(name: string, v: unknown, allowed: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw optionError(msg(`${name} の値 ${JSON.stringify(v)} は使えません (${allowed.join('・')} のどれか)`, `${name} cannot be ${JSON.stringify(v)} (one of ${allowed.join(', ')})`), name);
  return v as T;
}
/**
 * 選択肢の検証: kind・compat・style は決まった値、fetchTimeoutMs は正の数、files・fonts は配列、loadFont・deflate は関数、fetchImages は真偽値か関数。
 * createTypesetter の設定と、文書ごとの設定 (と両方を合わせたもの) に使う。誤りは TypeError
 */
function checkOptions(o: TypesetOptions) {
  oneOf('kind', o.kind, KINDS);
  oneOf('unreferencedCss', o.unreferencedCss, ['user-stylesheet', 'ignore'] as const);
  for (const k of ['tagged', 'print'] as const) if (o[k] !== undefined && typeof o[k] !== 'boolean') throw optionError(msg(`${k} は真偽値にしてください`, `${k} must be a boolean`), k);
  if (o.pdfua !== undefined && typeof o.pdfua !== 'boolean' && (typeof o.pdfua !== 'object' || o.pdfua === null || (o.pdfua.warnings !== undefined && !Array.isArray(o.pdfua.warnings))))
    throw optionError(msg('pdfua は真偽値か、{ warnings?: string[] } のオブジェクトにしてください', 'pdfua must be a boolean or an object { warnings?: string[] }'), 'pdfua');
  if (o.name !== undefined && typeof o.name !== 'string') throw optionError(msg('name は文字列 (入力のファイルの名前) にしてください', 'name must be a string (the input file name)'), 'name');
  // 文書の言語: 言語タグ (BCP 47。RFC 5646 §2.1 の形。コマンドの --document-lang と同じ照らし方)。型の外の値 (123 など) を、
  // そのまま構造の木の言語にすると、PDF の Lang が文字列でなくなり、読めない PDF になっていた
  if (o.documentLang !== undefined && !(typeof o.documentLang === 'string' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(o.documentLang)))
    throw optionError(msg(`documentLang は言語タグ (ja・en-US など) にしてください: ${JSON.stringify(o.documentLang)}`, `documentLang must be a language tag (ja, en-US, etc.): ${JSON.stringify(o.documentLang)}`), 'documentLang');
  oneOf('compat', o.compat, FO_COMPATS);
  oneOf('style', o.style, HTML_STYLES);
  oneOf('lang', o.lang, MESSAGE_LANGS);
  const dg = o.diagnostics;
  if (dg !== undefined && (typeof dg !== 'object' || dg === null)) throw optionError(msg('diagnostics はオブジェクトにしてください', 'diagnostics must be an object'), 'diagnostics');
  if (dg?.ignore !== undefined && !(Array.isArray(dg.ignore) && dg.ignore.every((x) => typeof x === 'string'))) throw optionError(msg('diagnostics.ignore は診断の名前 (文字列) の配列にしてください', 'diagnostics.ignore must be an array of diagnostic codes (strings)'), 'diagnostics.ignore');
  if (o.pageSize !== undefined && (typeof o.pageSize !== 'string' || !parsePageSize(o.pageSize)))
    throw optionError(msg(`pageSize の値 ${JSON.stringify(o.pageSize)} は使えません (CSS の size の書き方: "A5"・"A5 landscape"・"148mm 210mm" など。長さは 1pt 以上)`, `pageSize cannot be ${JSON.stringify(o.pageSize)} (write it like the CSS size property: "A5", "A5 landscape", "148mm 210mm", etc.; lengths of 1pt or more)`), 'pageSize');
  const t = o.fetchTimeoutMs;
  if (t !== undefined && !(typeof t === 'number' && Number.isFinite(t) && t > 0)) throw optionError(msg(`fetchTimeoutMs は正の数 (ミリ秒) にしてください: ${String(t)}`, `fetchTimeoutMs must be a positive number of milliseconds: ${String(t)}`), 'fetchTimeoutMs');
  for (const k of ['files', 'fonts'] as const) if (o[k] !== undefined && !Array.isArray(o[k])) throw optionError(msg(`${k} は KumioriFile の配列にしてください`, `${k} must be an array of KumioriFile`), k);
  for (const k of ['loadFont', 'deflate'] as const) if (o[k] !== undefined && typeof o[k] !== 'function') throw optionError(msg(`${k} は関数にしてください`, `${k} must be a function`), k);
  for (const k of ['fetchImages', 'fetchStyles'] as const) {
    const fi = o[k];
    if (fi !== undefined && typeof fi !== 'boolean' && typeof fi !== 'function') throw optionError(msg(`${k} は真偽値か関数にしてください`, `${k} must be a boolean or a function`), k);
  }
  if (o.resolveResource !== undefined && typeof o.resolveResource !== 'function') throw optionError(msg('resolveResource は関数にしてください', 'resolveResource must be a function'), 'resolveResource');
  // 言語タグ (BCP 47。RFC 5646 §2.1 の形: 2〜8 字の英字と、ハイフンで続く 1〜8 字の英数字)
  if (o.svgLanguages !== undefined && !(Array.isArray(o.svgLanguages) && o.svgLanguages.every((l) => typeof l === 'string' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(l))))
    throw optionError(msg('svgLanguages は言語タグ (ja・en-US など) の配列にしてください', 'svgLanguages must be an array of language tags (ja, en-US, etc.)'), 'svgLanguages');
  if (o.plugins !== undefined) {
    if (!Array.isArray(o.plugins)) throw optionError(msg('plugins は KumioriPlugin の配列にしてください', 'plugins must be an array of KumioriPlugin'), 'plugins');
    for (const [k, p] of o.plugins.entries()) {
      const bad = pluginProblem(p, k);
      if (bad) throw optionError(msg(bad.ja, bad.en), 'plugins');
    }
  }
  const dw = o.drawio;
  if (dw !== undefined && dw !== false) {
    if (typeof dw !== 'object' || dw === null) throw optionError(msg('drawio はオブジェクトか false にしてください', 'drawio must be an object or false'), 'drawio');
    if (dw.stencils !== undefined && !(Array.isArray(dw.stencils) && dw.stencils.every((f) => f && typeof f === 'object' && typeof f.name === 'string')))
      throw optionError(msg('drawio.stencils は、name を持つファイルの配列にしてください', 'drawio.stencils must be an array of files with a name'), 'drawio.stencils');
    const fs = dw.fetchStencils;
    if (fs !== undefined && typeof fs !== 'boolean' && typeof fs !== 'string' && typeof fs !== 'function') throw optionError(msg('drawio.fetchStencils は真偽値・URL の文字列・関数にしてください', 'drawio.fetchStencils must be a boolean, a URL string or a function'), 'drawio.fetchStencils');
    for (const k of ['stencilsUrl'] as const) if (dw[k] !== undefined && typeof dw[k] !== 'string') throw optionError(msg(`drawio.${k} は文字列にしてください`, `drawio.${k} must be a string`), `drawio.${k}`);
    if (dw.provideStencils !== undefined && typeof dw.provideStencils !== 'function') throw optionError(msg('drawio.provideStencils は関数にしてください', 'drawio.provideStencils must be a function'), 'drawio.provideStencils');
  }
  for (const k of ['genericFonts', 'spotColors'] as const) if (o[k] !== undefined && (typeof o[k] !== 'object' || o[k] === null)) throw optionError(msg(`${k} はオブジェクトにしてください`, `${k} must be an object`), k);
  for (const k of Object.keys(o.genericFonts ?? {}))
    if (!(GENERIC_FONT_KEYS as readonly string[]).includes(k)) throw optionError(msg(`genericFonts の名前 "${k}" は使えません (${GENERIC_FONT_KEYS.join('・')})`, `genericFonts cannot have "${k}" (${GENERIC_FONT_KEYS.join(', ')})`), 'genericFonts');
  const ln = o.links;
  if (ln !== undefined) {
    if (typeof ln !== 'object' || ln === null) throw optionError(msg('links はオブジェクトにしてください', 'links must be an object'), 'links');
    if (ln.schemes !== undefined && !(Array.isArray(ln.schemes) && ln.schemes.every((s) => typeof s === 'string'))) throw optionError(msg('links.schemes は文字列の配列にしてください', 'links.schemes must be an array of strings'), 'links.schemes');
    if (ln.launch !== undefined && typeof ln.launch !== 'boolean') throw optionError(msg('links.launch は真偽値にしてください', 'links.launch must be a boolean'), 'links.launch');
    if (ln.relative !== undefined && ln.relative !== 'file' && ln.relative !== 'uri') throw optionError(msg("links.relative は 'file' か 'uri' にしてください", "links.relative must be 'file' or 'uri'"), 'links.relative');
  }
}
/** createTypesetter の設定のうち、Typesetter.typeset の文書ごとの設定に渡しても使われないもの (器を作るときに読み込みが済んでいる) */
const SETUP_ONLY_OPTIONS = ['fonts', 'genericFonts', 'loadFont'] as const;

/** 入力の種類を決める (kind は checkOptions で検証済み) */
function kindOf(text: string, o: TypesetOptions): 'html' | 'xhtml' | 'fo' {
  if (o.kind) return o.kind;
  if (o.name && /\.(fo|xml)$/i.test(o.name)) return 'fo';
  if (o.name && /\.(xhtml|xht)$/i.test(o.name)) return 'xhtml';
  const head = text.slice(0, 4000);
  return /http:\/\/www\.w3\.org\/1999\/XSL\/Format/.test(head) && /<([\w-]+:)?root[\s>]/.test(head) ? 'fo' : 'html';
}

/** HTML+CSS・XSL-FO を組む */
export async function typeset(text: string, options: TypesetOptions = {}): Promise<TypesetResult> {
  options = optionsObject(options, 'options');
  return withMessageLang(options.lang, async () => (await buildTypesetter(options))(text, options) as Promise<TypesetResult>);
}

/**
 * PDF の設定 (TypesetResult.toPdf・typesetToPdf): 文書の題・入稿用 (PDF/X)・長期保存用 (PDF/A)・JPEG の解像度の上限。
 * タグ付き PDF・PDF/UA-1・文書の言語は、組むときの設定 (TypesetOptions の tagged・pdfua・documentLang) で決める
 */
export interface PdfOptions {
  /** 文書の題 (PDF の文書情報の Title)。文書に題 (HTML の title・XSL-FO の文書情報) が無いときだけ使う */
  title?: string;
  /**
   * 入稿用 (PDF/X) の PDF にする: 出力意図 (印刷条件)・版の印 (GTS_PDFXVersion)・Trapped を書き、ページには TrimBox を書く。
   * 版は PdfXOptions.version ('X-3' が既定。'X-4'・'X-1a'・'X-1a:2003')。CMYK の ICC プロファイル (profile) を渡せば、
   * RGB の色と画像を、そのプロファイルで CMYK にする (X-4 では profile が要る)。
   * X-3・X-1a は透明を使えないので、透明を平らにして書く。そのときタグ付き PDF にはできない (TypesetOptions.tagged)。
   * 塗り足しまでの範囲に掛かる注釈・リンク・フォームの欄は書かずに、警告に件数を書く。
   * 出力意図の辞書は ISO 32000-2 §14.11.5 (Table 401) による。PDF/X-1a:2001 (ISO 15930-1)・PDF/X-4 (ISO 15930-7) は、規格の本文を読んで作り、
   * その決まりに適合することを確かめている。PDF/X-1a:2003・PDF/X-3 は、その本文では確かめておらず、PDF/X-1a:2001 と同じ決まりを当てる。
   * 入稿の前には、プリフライト (Acrobat Pro など) で確かめること
   */
  pdfx?: PdfXOptions;
  /**
   * 長期保存用 (PDF/A) の PDF にする: 版は PdfAOptions.version ('A-2b' は ISO 19005-2、'A-3b' は ISO 19005-3。見た目を保存する水準 b)。
   * 出力意図 (pdfx と合わせないときは sRGB) と、XMP のメタデータの pdfaid:part・pdfaid:conformance を書く。
   * RGB の出力意図では CMYK の色を使えない (ISO 19005-2 §6.2.4.3) ので、CMYK の色と特色の代わりの色を RGB に直し、直した数を警告に書く。
   * ファイルを開く動作 (Launch)・フォームの欄の動作・字形の無い字は書かない。書き出した PDF を読み直して調べ、合わなければ誤りとして投げる。
   * pdfx と合わせるときは、pdfx.profile (CMYK の ICC プロファイル) が要る。規格の本文では確かめていないので、規格への適合は保証しない
   */
  pdfa?: PdfAOptions;
  /**
   * JPEG の画像の解像度の上限 (dpi)。置かれる大きさに対してこれより細かい JPEG は、この解像度に縮めて符号化し直す
   * (PDF が小さくなるときだけ)。既定は指定なし (元の JPEG をそのまま埋め込む)
   */
  imageMaxDpi?: number;
}
/** typesetToPdf の設定: PDF の設定 (PdfOptions) と、組み方 */
export interface TypesetPdfOptions extends PdfOptions {
  /**
   * メモリ節約: 組み直しの回 (ページ番号の参照を決めるもの) で、前の回のページを使い回さず、組み終えた page-sequence の組版の途中の木を
   * 手放す (既定 false)。使うメモリは、文書全体の組版の途中の木から、いちばん大きな page-sequence と書きかけの PDF の分ほどに減る
   * (PostgreSQL の文書の FO (3,231 ページ) で、約 2.3GB → 約 0.9GB。いちばん多いのは FO の読み込みの所)。その代わり、組み直しの回ごとに文書全体を組み、決まった後に
   * もう 1 度組む (同じ文書で、時間は約 1.5 倍)。PDF は、使い回すときと同じ (使い回すときは、前の回のページのページ番号の参照の字を、
   * 組み直したときと同じ字・同じ位置になると確かめられたとき (字数・字の種類・書体・送りが同じで、前後の字との詰め (カーニング) に加わらないとき) だけ
   * 差し替え、確かめられなければ、その page-sequence を組み直す)
   */
  lowMemory?: boolean;
}
/** typesetToPdf の結果 (TypesetResult から、組んだ結果 (areaTree) と、それを使う toPdf・renderPage を除いたもの) */
export interface TypesetPdfResult {
  /** PDF のバイト列 */
  pdf: Uint8Array;
  /** ページ数 */
  pageCount: number;
  /** 組版の警告と、PDF を書く途中の警告 (typeset の warnings に、toPdf の警告を足したものと同じ並び) */
  warnings: string[];
  /** 組版の診断と、PDF を書く途中の診断 (TypesetResult.diagnostics と同じ) */
  diagnostics: Diagnostic[];
  /** 組版にかかった時間 (ミリ秒)。ページを領域の木にする時間は含まない (PDF を書く時間に入る。TypesetResult.layoutMs より短い) */
  layoutMs: number;
}

/**
 * 文書を組み、PDF だけを作る (typeset の後に toPdf を呼ぶのと同じ PDF・警告・ページ数)。ページを 1 枚ずつ領域の木にして書き、
 * 書いたページを手放すので、文書全体の領域の木を 1 度に持たない (数千ページの文書で、使うメモリが少ない)。
 * 組んだ結果 (Area Tree) を使わず、PDF だけが要るときに使う。ページの領域の木を 2 度作る (使う書体・画像を集めるときと、描くとき)。
 * Node のコマンドもこれで PDF を作る
 */
export async function typesetToPdf(text: string, options: TypesetOptions = {}, pdf: TypesetPdfOptions = {}): Promise<TypesetPdfResult> {
  options = optionsObject(options, 'options');
  pdf = optionsObject(pdf, 'pdf');
  return withMessageLang(options.lang, async () => (await buildTypesetter(options))(text, options, pdf) as Promise<TypesetPdfResult>);
}

/** createTypesetter の設定: 書体まわり (何度組んでも同じもの) */
export type TypesetterOptions = Pick<TypesetOptions, 'fonts' | 'genericFonts' | 'loadFont' | 'fetchTimeoutMs' | 'deflate'>;
/** Typesetter.typeset の設定: 文書ごとのもの */
export type DocumentOptions = Omit<TypesetOptions, keyof TypesetterOptions>;

/** 書体を読み込んだ組版の器。同じ書体で、文書を何度でも組む (エディタの印刷プレビューなど) */
export interface Typesetter {
  /** 文書を組む (typeset と同じ。書体は読み込み済みのものを使い回す) */
  typeset(text: string, options?: DocumentOptions): Promise<TypesetResult>;
  /** 文書を組み、PDF だけを作る (typesetToPdf と同じ。書体は読み込み済みのものを使い回す) */
  typesetToPdf(text: string, options?: DocumentOptions, pdf?: TypesetPdfOptions): Promise<TypesetPdfResult>;
}

/**
 * 書体を 1 度だけ読み込み (取得と字形の解析)、文書を何度でも組める器を作る。typeset を何度も呼ぶより速い。
 * 数式・等幅・記号の書体は、使う文書を初めて組むときに読み込み、その後は使い回す。
 * 文書ごとの書体 (XSL-FO と一緒に渡した書体ファイル・CSS の @font-face) は、その文書を組むときだけ使う
 */
export async function createTypesetter(setup: TypesetterOptions = {}): Promise<Typesetter> {
  const run = await buildTypesetter(optionsObject(setup, 'setup'));
  return {
    typeset: async (text, given = {}) => {
      const options = optionsObject(given, 'options');
      return withMessageLang(options.lang, async () => {
        // 書体まわりの設定 (fonts・genericFonts・loadFont) は器を作るときのもの。文書ごとの設定に渡しても使われないので、無言で捨てずに警告にする
        // (typeset(text, options) は同じ options を器と文書の両方に渡すので、ここは Typesetter.typeset だけ)
        const ignored = setupOnlyWarnings(options, 'Typesetter.typeset');
        const r = (await run(text, options)) as TypesetResult;
        // r.warnings は、toPdf の警告を後から足す配列なので、作り直さずに前へ足す
        if (ignored.length) {
          r.warnings.unshift(...ignored.map((d) => d.message));
          r.diagnostics.unshift(...ignored);
        }
        return r;
      });
    },
    typesetToPdf: async (text, given = {}, givenPdf = {}) => {
      const options = optionsObject(given, 'options');
      const pdf = optionsObject(givenPdf, 'pdf');
      return withMessageLang(options.lang, async () => {
        const r = (await run(text, options, pdf)) as TypesetPdfResult;
        const ignored = setupOnlyWarnings(options, 'Typesetter.typesetToPdf');
        r.warnings.unshift(...ignored.map((d) => d.message));
        r.diagnostics.unshift(...ignored);
        return r;
      });
    },
  };
}

/** 器の文書ごとの設定に渡された、器を作るときの設定 (書体まわり) の警告 (使われないので、無言で捨てない) */
function setupOnlyWarnings(options: DocumentOptions, method: string): Diagnostic[] {
  if (options.diagnostics?.ignore?.includes('api/setup-option-ignored')) return [];
  return SETUP_ONLY_OPTIONS.filter((k) => (options as TypesetOptions)[k] !== undefined).map((k) => diag('api/setup-option-ignored', msg(`${k} は createTypesetter の設定です (${method} の文書ごとの設定では使われません)`, `${k} is a createTypesetter option (it is not used in the per-document options of ${method})`), { option: k }));
}

/**
 * 未対応・知らない CSS の項目 (property・property: value・function()・@rule。後ろの (…) は説明) が、CSS のファイルか文書に最初に書かれた所。
 * 字面で探す (コメントの中も当たることがある)。見つからなければ undefined
 */
function locateCssItem(sources: Array<{ name?: string; text: string; lineStarts?: number[] }>, item: string): DiagnosticSource | undefined {
  const head = /^(@?[-\w]+)(\(\))?(?::\s*([^()]*?))?(?:\s*\(.*\))?\s*$/.exec(item.trim());
  if (!head) return undefined;
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = esc(head[1]);
  const re = head[2] ? new RegExp(`${name}\\(`, 'i') : head[1].startsWith('@') ? new RegExp(name, 'i') : new RegExp(`(?:^|[\\s;{"'])(${name}\\s*:${head[3] ? `\\s*${esc(head[3].trim())}` : ''})`, 'i');
  for (const s of sources) {
    const m = re.exec(s.text);
    if (!m) continue;
    const off = m.index + (m[1] !== undefined ? m[0].indexOf(m[1]) : 0);
    // 行は、改行の位置の表 (源ごとに 1 度だけ作る) から二分探しで引く (項目ごとに、見つけた所までを行に分けていた)
    const starts = (s.lineStarts ??= lineStartsOf(s.text));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return { ...(s.name !== undefined ? { file: s.name } : {}), line: lo + 1, column: off - starts[lo] + 1 };
  }
  return undefined;
}


/** 行の始まりの位置の並び (0 番は 0) */
function lineStartsOf(text: string): number[] {
  const out = [0];
  for (let k = text.indexOf('\n'); k >= 0; k = text.indexOf('\n', k + 1)) out.push(k + 1);
  return out;
}

/** 書体を読み込み、文書を組む関数を返す (createTypesetter と typeset の中身) */
async function buildTypesetter(setup: TypesetterOptions): Promise<(text: string, options: DocumentOptions, pdfOnly?: TypesetPdfOptions) => Promise<TypesetResult | TypesetPdfResult>> {
  checkOptions(setup);
  svgParser ??= (await parsers()).svg;
  const timeout = setup.fetchTimeoutMs ?? 30_000;
  const bufferOfSpec = async (spec: FontSpec) => {
    const buf = (await setup.loadFont?.(spec)) ?? (await fetchFont(spec, timeout));
    if (!buf) throw new KumioriFontError('font/load-failed', msg(`書体を読めません: ${spec.family}`, `cannot load font: ${spec.family}`), { args: { font: spec.family } });
    return buf;
  };
  const base = new FontManager();
  const baseWarnings: Diagnostic[] = [];
  base.onNotice = (d) => baseWarnings.push(d);
  /** 書体の名前 → ファミリー名の表 (fontMapping の FontNameTable)。ここには fonts で足した書体 (installed) を登録し、文書ごとの書体は文書を組むときに写しへ足す */
  const fontNames = new FontNameTable();
  // 既定の書体 (明朝・ゴシックの標準と太字、欧文の標準と太字)。太字の枠に、同じファミリーの標準の太さと同じ中身のファイルが渡されたときは、
  // 太字の書体は無いものとして登録しない (FontManager.registerDefaults。太字の字は、標準の太さの書体を太らせて描く)
  const defaults: Array<{ spec: FontSpec; buf: ArrayBuffer }> = [];
  for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) defaults.push({ spec, buf: await bufferOfSpec(spec) });
  await base.registerDefaults(defaults, false);
  setupDefaultFonts(base);
  // 足す書体: name 表のファミリー名 (nameID 16、無ければ 1) と OS/2 の太さ・幅 (usWidthClass)・傾き (fsSelection) で登録する。
  // 同じファミリー名・太さでも、幅・傾きの違う書体は別の書体で、font-stretch・font-style の指定で選ばれる (CSS Fonts 4 §5.2: 幅 → 傾き → 太さの順)
  for (const f of (setup.fonts ?? []).map((f) => toFile(f))) {
    // TTC (書体の集まり) は、中の書体を一つずつ取り出して登録する。壊れた・短いファイルは警告にして、ほかの書体は登録する
    let faces: ArrayBuffer[];
    try {
      faces = collectionFaces(await f.arrayBuffer());
    } catch (e) {
      baseWarnings.push(diag('font/file-unreadable', msg(`${f.name} の書体を読めません${e instanceof Error && e.message ? ` (${e.message})` : ''}`, `cannot read the font file ${f.name}${e instanceof Error && e.message ? ` (${e.message})` : ''}`), { file: f.name }));
      continue;
    }
    for (const buf of faces) {
      let fk: { familyName?: string; name?: { records?: { preferredFamily?: Record<string, string>; fontFamily?: Record<string, string> } } } & FaceTables;
      try {
        fk = fontkit.create(new Uint8Array(buf)) as unknown as typeof fk;
      } catch {
        baseWarnings.push(diag('font/file-unreadable', msg(`${f.name} の書体を読めません`, `cannot read the font file ${f.name}`), { file: f.name }));
        continue;
      }
      const shape = faceShapeOf(fk);
      const family = fk.name?.records?.preferredFamily?.en ?? fk.familyName;
      if (!family) {
        baseWarnings.push(diag('font/family-unreadable', msg(`${f.name} の書体のファミリー名が読めません`, `cannot read the family name of the font file ${f.name}`), { file: f.name }));
        continue;
      }
      // 足した書体は、HTML の line-height: normal の行の高さを書体の値から決める (@font-face の書体と同じ。fontMapping.ts の htmlNormalLineHeight)
      const lf = await base.registerBuffer(family, fk['OS/2']?.usWeightClass ?? 400, buf, false, undefined, shape);
      lf.metricsLineHeight = true;
      // name 表のファミリー名 (各言語の nameID 16・1。「ＭＳ ゴシック」と「MS Gothic」など) のどれでも引けるようにする
      const recs = fk.name?.records;
      const legacy = fk.name?.records?.fontFamily?.en ?? fk.familyName;
      if (shape.width !== undefined && legacy && normalizeFamily(legacy) !== normalizeFamily(family)) {
        // 幅の違う書体が 1 つのファミリーにまとまっている書体 (Arial Narrow: nameID 16 は "Arial"、nameID 1 は "Arial Narrow"、幅は condensed):
        // nameID 16 の名前はファミリー (font-stretch の指定で、幅の違う書体から選ぶ)。nameID 1 の名前は、その幅の書体だけを指す別名
        // (CSS Fonts 4 §5.2: ファミリー名は、入っている書体から探す。別名を含めてよい)
        base.addFamilyAlias(legacy, lf);
        fontNames.add('installed', [family, ...Object.values(recs?.preferredFamily ?? {})], family);
        fontNames.add('installed', [legacy, ...Object.values(recs?.fontFamily ?? {})], legacy);
      } else fontNames.add('installed', [family, fk.familyName, ...Object.values(recs?.preferredFamily ?? {}), ...Object.values(recs?.fontFamily ?? {})], family);
    }
  }
  // 総称の書体を、指定の書体にする (欧文の書体を先に。和文の書体の組は、そのときの欧文の書体を持つ: setGenericFont)
  for (const generic of GENERIC_FONT_KEYS) {
    const family = setup.genericFonts?.[generic];
    if (!family) continue;
    if (!base.has(family)) {
      baseWarnings.push(diag('font/generic-not-loaded', msg(`genericFonts の書体 "${family}" が読み込まれていません (fonts で書体ファイルを渡してください)`, `the genericFonts font "${family}" is not loaded (pass its font file in fonts)`), { font: family, generic }));
      continue;
    }
    setGenericFont(base, generic, family);
  }
  // 文書によって使う書体 (数式・等幅・記号): 初めて使うときに読み込んで base に入れ、その後は解析し直さない
  const optional = new Map<string, Promise<LoadedFont>>();
  const loadOptional = async (fonts: FontManager, spec: FontSpec) => {
    const key = `${spec.family}|${spec.weight ?? 400}`;
    let p = optional.get(key);
    if (!p) {
      p = bufferOfSpec(spec).then((buf) => base.registerBuffer(spec.family, spec.weight ?? 400, buf, false));
      optional.set(key, p);
      // 読めなかったときは、次の文書でまた試す
      p.catch(() => optional.delete(key));
    }
    fonts.adopt(await p);
  };
  return (text, options, pdfOnly) => typesetDocument(text, { ...setup, ...options }, base, loadOptional, baseWarnings, fontNames, pdfOnly);
}

/** 文書を 1 つ組む: base (読み込み済みの書体) の写しに、文書ごとの書体を足して組む */
async function typesetDocument(
  text: string,
  options: TypesetOptions,
  base: FontManager,
  loadSpec: (fonts: FontManager, spec: FontSpec) => Promise<void>,
  baseWarnings: Diagnostic[],
  baseNames: FontNameTable,
  /** PDF だけを作るときの toPdf の設定 (typesetToPdf)。無ければ、領域の木を持つ結果 (TypesetResult) を返す */
  pdfOnly?: TypesetPdfOptions,
): Promise<TypesetResult | TypesetPdfResult> {
  // 選択肢は入口で検証し、compat は 1 つの真偽値 (ah) に正規化して下流 (組版・PDF の設定) に渡す (読み込みの Importer も同じ判定 isAntennaCompat を使う)
  checkOptions(options);
  // タグ付き PDF は既定で付ける (tagged: false で外す)。PDF/UA-1 はタグ付き PDF を含む (構造の木は読み込みで作る)。
  // 作成者が tagged: true・pdfua と書いたか (透明を平らにする PDF/X-1a・X-3 と合わせたときに、誤りにするか、黙ってタグを外すかを分ける)
  const taggedAsked = options.tagged === true || !!options.pdfua;
  // PDF だけを作るとき (typesetToPdf) に PDF/X-1a・X-3 を指定していれば、既定のタグは付けないので、構造の木も作らない
  const flatOnly = !!pdfOnly?.pdfx && pdfStandardOf(pdfOnly.pdfx)?.transparency === 'flatten';
  const taggedOn = taggedAsked || (options.tagged !== false && !flatOnly);
  if (!!options.tagged !== taggedOn) options = { ...options, tagged: taggedOn };
  const kind = kindOf(text, options);
  const isFo = kind === 'fo';
  const timeout = options.fetchTimeoutMs ?? 30_000;
  const style = options.style ?? 'kumiori';
  const compat: FoCompat = options.compat ?? 'spec';
  // アンテナハウス互換 (XSL-FO の既定・HTML の style ah) の設定は compat.ts (画面と同じ)
  const ah = isAhCompat(isFo ? 'fo' : 'html', { compat, style });
  const files = (options.files ?? []).map((f) => toFile(f));
  // 警告の文 (warnings) と、同じ出来事の診断 (diagnostics)。report で両方に足す。未対応・知らない指定は、文は 1 つにまとめ、診断は名前ごとに 1 件 (reportSummary)
  // 出さない診断の名前 (TypesetOptions.diagnostics.ignore)。知らない名前は、止めずに知らせる
  const ignore = new Set(options.diagnostics?.ignore ?? []);
  const shown = (d: Diagnostic) => !ignore.has(d.code);
  const warnings: string[] = [];
  const diags: Diagnostic[] = [];
  const report = (d: Diagnostic) => {
    if (!shown(d)) return;
    warnings.push(d.message);
    diags.push(d);
  };
  const reportSummary = (message: string, parts: Diagnostic[]) => {
    const kept = parts.filter(shown);
    if (!kept.length) return;
    warnings.push(message);
    diags.push(...kept);
  };
  for (const name of ignore)
    if (!(DIAGNOSTIC_CODES as readonly string[]).includes(name))
      report(diag('api/unknown-diagnostic-code', msg(`diagnostics.ignore の名前 "${name.slice(0, 100)}" は、診断の名前にありません (止めずに続けます)`, `diagnostics.ignore has "${name.slice(0, 100)}", which is not a diagnostic code (nothing is suppressed for it)`), { code: name.slice(0, 100) }));
  for (const d of baseWarnings) report(d);
  /** 読み込みに失敗した書体 (数式・等幅・記号・絵文字) の知らせ */
  const fontLoadFailed = (spec: FontSpec) => (e: unknown) => report(diag('font/load-failed', String(e instanceof Error ? e.message : e), { font: spec.family }));
  // 文書・CSS が参照するファイルのうち、files に無いもの: resolveResource に問い合わせ、http(s) の CSS は取る (fetchStyles)
  {
    const names = new Set(files.flatMap((f) => [f.path.split('\\').join('/').replace(/^\.\//, ''), f.name.toLowerCase()]));
    // 文書に出てくる字 (タグや CSS の字も含む、多めの見積もり)。@font-face の書体のうち、unicode-range がこれと重ならないものは取らない
    // (CSS Fonts 4 §4.5)。数値の文字参照と CSS の逃がしの字も入る (documentChars)。CSS の content の文字列の字は collectResources が足す
    const chars = documentChars(text);
    // 名前の文字参照 (&alpha;・&hellip; など) は、HTML の解析に解かせる (名前の表を持たない)。XML で決まっている 5 つは ASCII の字
    const named = new Set((text.match(/&[A-Za-z][A-Za-z0-9]*;?/g) ?? []).filter((n) => !/^&(amp|lt|gt|quot|apos);?$/.test(n)));
    if (named.size) for (const ch of (await parsers()).html(`<p>${[...named].join(' ')}</p>`).body?.textContent ?? '') chars.add(ch.codePointAt(0)!);
    const got = await collectResources(text, {
      chars,
      has: (u) => names.has(u) || names.has(refBasename(u)),
      cssTexts: await Promise.all(files.filter(isCss).map(async (f) => ({ name: f.path, text: await f.text() }))),
      ...(options.resolveResource ? { resolve: options.resolveResource } : {}),
      fetchStyle: (u) => (typeof options.fetchStyles === 'function' ? options.fetchStyles(u) : options.fetchStyles !== false),
      timeoutMs: timeout,
    });
    for (const f of got.files) {
      files.push(toFile({ name: f.name, data: f.data }, f.css, f.url));
      names.add(f.name);
    }
    for (const w of got.warnings) {
      const [kind, url0] = w.split('\t');
      const url = url0.slice(0, 200);
      const font = kind.startsWith('font');
      report(
        kind.endsWith('not-fetched')
          ? diag('resource/not-fetched', msg(`${font ? '書体' : 'CSS'}を取りません (fetchStyles): ${url}`, `${font ? 'font' : 'stylesheet'} not fetched (fetchStyles): ${url}`), { url, kind: font ? 'font' : 'stylesheet' })
          : diag('resource/fetch-failed', msg(`${font ? '書体' : 'CSS'}を取得できません: ${url}`, `cannot fetch the ${font ? 'font' : 'stylesheet'}: ${url}`), { url, kind: font ? 'font' : 'stylesheet' }),
      );
    }
  }

  // 書体。FO では、一緒に渡した書体ファイルを、FO の font-family の名前 (和名・英名) から使う (画面で書体を読み込んだのと同じ)
  const fonts = base.fork();
  fonts.onNotice = report;
  const fontNames = baseNames.fork();
  const userFonts: UserFont[] = [];
  if (isFo) {
    // 同じファミリー・太さの書体が複数あれば、先のものを使う。書体は輪郭から描くので、ブラウザの document.fonts には登録しない (canvas: false)
    const cands: UserFont[] = [];
    for (const f of files.filter((x) => /\.(ttf|otf|ttc|otc|woff2?)$/i.test(x.name))) cands.push(...splitFontFile(await f.arrayBuffer()));
    for (const u of cands) {
      if (userFonts.some((x) => x.family === u.family && x.weight === u.weight && x.style === u.style)) continue;
      // 斜体・斜めの書体は、同じファミリーの傾きの違う書体として登録する (font-style の指定で選ばれる。XSL 1.1 §7.9.7・CSS Fonts 4 §5.2)
      await fonts.registerBuffer(u.family, u.weight, u.buffer, false, undefined, u.style ? { style: u.style } : undefined);
      userFonts.push(u);
      fontNames.add('document', u.names, u.family);
    }
  }
  // FO の font-family は、files の書体 (document) を先に、次に fonts で足した書体 (installed) を探す。HTML は @font-face の書体 (face) の次に fonts の書体を探す (FontNameTable)
  const mapping = createFontMapping(fonts, fontNames, { canvas: false });

  // 画像 (と、FO の external-graphic が指す MathML の文字のファイル)。文書と CSS (と、そこから参照された SVG) に名前が出てくるものだけを読む。
  // 画像の突き合わせはファイル名 (basename) でも当たるので、ファイル名で選ぶ
  // 本体の外の画像の形式 (imageFormats.ts。プラグインの形式を先に判定する) には、文字の幅を PDF に SVG の文字を描くときと同じ書体で測る道具と、
  // 図が URL で指す資源を文書の画像と同じ決まり (resolveResource・fetchImages・大きさの上限) で取る道具、プラグインの選択肢で許されたものを取る道具、
  // 警告を出す道具を渡す
  const formats = formatsOf(options.plugins, options.drawio);
  const IMAGE_FILE = imageFileRe(formats);
  const allowFormatFetch = (url: string) => (typeof options.fetchImages === 'function' ? options.fetchImages(url) : options.fetchImages !== false);
  // 組版が実際に引いた画像を、呼ぶ側 (コマンド) に知らせる内部の仕組み (resourceUse.ts。公開の選択肢ではない)
  const use = resourceUseOf(options);
  const assets = new AssetStore({
    parseXml: svgParse,
    formats,
    report,
    ...(use ? { onUse: (key: string) => use.usedKeys.add(key) } : {}),
    formatContext: {
      fetchTimeoutMs: timeout,
      warn: (m) => report(diag('image/format-warning', m)),
      lang: messageLang(),
      fetch: async (url) => (/^https?:\/\//i.test(url) ? (await fetchGuarded(url, { timeoutMs: timeout, maxBytes: fetchLimits.imageBytes }).catch(() => undefined))?.bytes : undefined),
      measureText: (t, ft) => svgTextWidth(fonts, t, ft.family, ft.bold ? 700 : 400, ft.size),
      fetchResource: async (url) => {
        const given = options.resolveResource ? await Promise.resolve(options.resolveResource(url)).catch(() => undefined) : undefined;
        if (given !== undefined) return bytesOf(given);
        if (!/^https?:\/\//i.test(url) || !allowFormatFetch(url)) {
          if (/^https?:\/\//i.test(url)) report(diag('resource/not-fetched', msg(`画像を取りません (fetchImages): ${url.slice(0, 200)}`, `image not fetched (fetchImages): ${url.slice(0, 200)}`), { url: url.slice(0, 200), kind: 'image' }));
          return undefined;
        }
        return (await fetchGuarded(url, { timeoutMs: timeout, maxBytes: fetchLimits.imageBytes, allow: allowFormatFetch }).catch(() => undefined))?.bytes;
      },
    },
  });
  const mentioned = mentionedFiles([text, ...(await Promise.all(files.filter(isCss).map((f) => f.text())))], formats);
  const images = files.filter((x) => IMAGE_FILE.test(x.name));
  if (use) for (const f of images) use.imageNames.add(f.path);
  // 文書に名前が出てくるか。mentionedFiles は %xx を戻した名前を返すので、参照から取ったファイル (名前は参照の URL のまま =
  // %xx のまま。resolveResource にも、その URL で問い合わせている) は、%xx を戻した名前でも突き合わせる。戻さないと、名前に空白・
  // 括弧・日本語などのある画像 (a%20b.png) が、中身を受け取っているのに「見つからない画像」になる (RFC 3986 §2.1・§6.2.2.2:
  // %xx と元の字は同じ参照)
  const isMentioned = (x: (typeof files)[number]) => mentioned.has(x.name.toLowerCase()) || (x.url !== undefined && mentioned.has(refBasename(x.url)));
  for (const f of images.filter((x) => /\.svg$/i.test(x.name) && isMentioned(x))) {
    for (const n of mentionedFiles([await f.text()], formats)) mentioned.add(n);
  }
  for (const f of images.filter(isMentioned)) {
    const asset = await assets.addBlob(f.path.split('\\').join('/'), new Blob([bytesOf(await f.data()) as BlobPart]));
    // 画像の置き場が中身を写して持つので、ファイルの読んだ中身は捨てる (同じ画像を 2 度持たない。画像の多い文書で、画像の量の分のメモリになっていた)
    f.forget();
    // 参照から取った画像は、参照の URL の全体 (問い合わせの ?… を含む) でも登録する。画像は「完全一致 → ファイル名」の順に引くので、
    // 問い合わせだけが違う 2 つの画像 (a.png?id=1 と a.png?id=2) が、それぞれの画像になる (名前だけだと、後に登録したものに両方が当たる)
    if (asset && f.url !== undefined && normalizeSrc(f.url) !== asset.key) {
      const { key: _key, ...rest } = asset;
      assets.register(f.url, rest);
    }
  }
  // 参照から取った中身 (resolveResource の返したもの) のうち、名前に画像の拡張子の無いもの (https://example.com/img?id=1 など):
  // 中身の先頭のバイト列が画像なら、参照の URL の画像として読む (拡張子では決めない。HTML の画像の種類は、中身の先頭で決まる:
  // MIME Sniffing Standard §8.2「Sniffing in an image context」・§6.1。looksLikeImage)。CSS と、名前に書体の拡張子のあるものは見ない。
  // 画像でない中身は使わない (その参照は、これまでどおり: http(s) の画像なら fetchImages の判定でネットワークから取る)
  for (const f of files) {
    if (f.url === undefined || isCss(f) || IMAGE_FILE.test(f.name) || /\.(ttf|otf|ttc|otc|woff2?)$/i.test(f.name) || assets.get(f.url)?.key === normalizeSrc(f.url)) continue;
    const bytes = bytesOf(await f.data());
    if (await looksLikeImage(bytes, formats)) {
      await assets.addBlob(f.url, new Blob([bytes as BlobPart]));
      f.forget();
    }
  }

  const measurer = new Measurer(fonts, 'fontkit');
  // MathML のある文書なら、数式の書体を読み込む (読めなければ、本文の書体で組む。画面と同じ手順: documentResources)
  const mathOpts = await mathOptionsFor(text, fonts, () => loadSpec(fonts, MATH_SPEC).catch(fontLoadFailed(MATH_SPEC)));
  // XHTML は XML の構文で読み、名前空間に従って HTML に書き直してから組む
  const html = kind === 'xhtml' ? xhtmlToHtml(text) : text;
  let res = isFo ? await importFo(text, options, compat, mapping, assets, mathOpts) : await importHtmlText(html, options, style, files, mapping, assets, measurer, mathOpts, kind === 'xhtml', { ...(options.name !== undefined ? { name: options.name } : {}), original: kind !== 'xhtml' });
  // ブラウザの既定のスタイル (line-height: normal を既定の書体の値でも決める。compat.ts の BROWSER_HTML_IMPORT_OPTIONS): 等幅の書体 (Cousine) は、
  // 読み込みの中で等幅の指定が分かってから読むので、読み込みの時点では normal の値を引けない (和文の書体の値になる)。読んでから読み込み直す
  if (!isFo && htmlImportCompatOptions(style).normalLineHeightAllFonts && mapping.usesMono() && !fonts.has('Cousine')) {
    for (const spec of MONO_SPECS) await loadSpec(fonts, spec).catch(fontLoadFailed(spec));
    if (fonts.has('Cousine')) res = await importHtmlText(html, options, style, files, mapping, assets, measurer, mathOpts, kind === 'xhtml', { ...(options.name !== undefined ? { name: options.name } : {}), original: kind !== 'xhtml' });
  }
  // 文書の言語の指定 (documentLang): 入力に言語が無ければ、構造の木の根元 (文書) の言語にする
  const docStruct = res.document.structure?.[0];
  if (options.documentLang && docStruct && !docStruct.lang) docStruct.lang = options.documentLang;
  // ネットワーク上の画像・data URI の画像 (画面と同じ手順: documentResources)。http(s) の画像は fetchImages (既定 true) で取るかどうかを決める
  const allowFetch = (url: string) => (typeof options.fetchImages === 'function' ? options.fetchImages(url) : options.fetchImages !== false);
  for (const d of res.warnings ?? []) report(d);
  for (const d of res.report.diagnostics ?? []) report(d);
  for (const src of await fetchReportedImages(assets, res.report.images, allowFetch, timeout)) report(diag('resource/not-fetched', msg(`画像を取りません (fetchImages): ${src.slice(0, 200)}`, `image not fetched (fetchImages): ${src.slice(0, 200)}`), { url: src.slice(0, 200), kind: 'image' }));
  // 未対応の指定 (黙って無視しない): XSL-FO は読めなかった要素・プロパティ、HTML は未対応・知らない CSS (ブラウザの画面の変換レポートと同じ数え方)
  // 診断の場所: 読み込みが覚えた、最初に現れた要素。CSS の宣言から数えたもの (要素の分からないもの) は、CSS のファイルと文書から字面で探す
  const cssSources = isFo ? [] : [...(await Promise.all(files.filter(isCss).map(async (f) => ({ name: f.path, text: await f.text() })))), ...(kind === 'html' ? [{ name: options.name, text }] : [])];
  // 字面で探すのは、診断に残る分 (名前ごとに MAX_DIAGNOSTICS_PER_CODE 件。出さない名前は探さない) だけ: 項目ごとに CSS と文書の全体を
  // 探していたので、知らない・未対応の項目を多く並べた文書で、項目の数 × 文書の長さの手間になっていた (389KB で 24 秒)
  const locator = (code: DiagnosticCode) => {
    let left = ignore.has(code) ? 0 : MAX_DIAGNOSTICS_PER_CODE;
    return (item: string) => res.report.unsupportedAt?.[item] ?? (isFo || left-- <= 0 ? undefined : locateCssItem(cssSources, item));
  };
  const miss = summarizeCounts(res.report.unsupported);
  const at = locator(isFo ? 'fo/unsupported' : 'css/unsupported');
  if (miss)
    reportSummary(
      msg(`${isFo ? '未対応の XSL-FO の要素・プロパティを' : '未対応の CSS を'}無視しました: ${miss}`, `ignored unsupported ${isFo ? 'XSL-FO elements/properties' : 'CSS'}: ${miss}`),
      countedDiagnostics(res.report.unsupported, (item) =>
        diag(isFo ? 'fo/unsupported' : 'css/unsupported', msg(`${isFo ? '未対応の XSL-FO の要素・プロパティを' : '未対応の CSS を'}無視しました: ${item}`, `ignored unsupported ${isFo ? 'XSL-FO elements/properties' : 'CSS'}: ${item}`), { item }, at(item)),
      ),
    );
  // 添付ファイルの注釈が参照するファイル (files の中から、パスか名前で探す)。
  // 探すのは、呼ぶ側が files に渡したものだけ。参照をたどって集めたもの (resolveResource の返した file: のファイル・ネットワークから取った
  // CSS や書体。url を持つ) は添付しない: 添付はファイルの中身をそのまま PDF に入れるので、集めたものまで添付できると、他人の書いた文書が、
  // 組む側の機械のファイル (file:///etc/passwd) や内部のネットワークの応答 (http://169.254.169.254/…) を、別の参照 (<link>・url()) で
  // 集めさせた上で、出力の PDF に写し取れる。画像・書体・CSS は、その形式として読めた中身しか出力に現れないが、添付は形式を問わない
  const attachable = files.filter((x) => x.url === undefined);
  for (const src of (res.report as { files?: string[] }).files ?? []) {
    const norm = tidyRelPath(src);
    const base = norm.split('/').pop()!.toLowerCase();
    // 文書の場所の外を指す参照 (スキームのある URL (file: など)・/ か \ で始まる道・.. で上へ出る道) は、名前でも当てない
    // (files に渡したファイルは、入力のディレクトリの中のもの。file: の URL のファイルは添付しない: docs/xslfo-import.md)
    const outside = /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[\\/]/.test(src) || norm === '..' || norm.startsWith('../');
    // 道の全体で探し (両側の ./・// を整えて)、無ければ名前で探す。名前で当てるのは、呼ぶ側がディレクトリ無しの名前で渡したファイルだけ
    // (前は、どのディレクトリのファイルにも名前の末尾だけで当たり、url(../../x/.env) のような参照が、入力のディレクトリの下の別の .env を添付できた)
    const f = (outside ? undefined : attachable.find((x) => tidyRelPath(x.path) === norm)) ?? (outside ? undefined : attachable.find((x) => !tidyRelPath(x.path).includes('/') && x.name.toLowerCase() === base));
    if (f) assets.registerFile(src, bytesOf(await f.data()));
    // 外を指す参照は、探さなかったので、そう知らせる (診断の名前は同じ。url('../doc/note.txt') のように、上へ出てから入力のディレクトリの
    // 中へ戻る道も、文書の場所の外を指すものとして扱う)
    else if (outside) report(diag('resource/attachment-not-found', msg(`添付するファイルの参照が文書の場所の外を指すので、添付しません: ${src}`, `the attachment reference points outside the document's location, so it is not attached: ${src}`), { file: src }));
    else report(diag('resource/attachment-not-found', msg(`添付するファイルが見つかりません: ${src}`, `attachment file not found: ${src}`), { file: src }));
  }
  // 動作を書かなかった、文書の外へのリンク (links の設定で通さないもの)
  const dropped = summarizeDroppedLinks(res.report.droppedLinks);
  if (dropped) report(diag('link/action-dropped', droppedLinkWarning(dropped, 'read')));
  const unknown = summarizeCounts(res.report.unknownCss);
  const atUnknown = locator('css/unknown-property');
  if (unknown)
    reportSummary(
      msg(`知らない CSS のプロパティを無視しました (綴りの誤りか未対応): ${unknown}`, `ignored unknown CSS properties (misspelled or unsupported): ${unknown}`),
      countedDiagnostics(res.report.unknownCss, (property) => diag('css/unknown-property', msg(`知らない CSS のプロパティを無視しました (綴りの誤りか未対応): ${property}`, `ignored unknown CSS properties (misspelled or unsupported): ${property}`), { property }, atUnknown(property))),
    );
  // 等幅の指定があれば、等幅の書体を読み込む (SVG の字に Courier・monospace の指定があっても読み込む)。見るのは、文書に名前の出てくる SVG だけ
  // (渡されたファイルの全部の SVG を読むと、参照していない SVG (前に書き出したページの SVG など) まで読んでいた)
  const svgMono = async () => {
    for (const f of images.filter((x) => /\.svg$/i.test(x.name) && isMentioned(x))) if (/font-family\s*[=:]\s*["']?[^;>]*(courier|monospace)/i.test(await f.text().catch(() => ''))) return true;
    return false;
  };
  if (mapping.usesMono() || (await svgMono())) for (const spec of MONO_SPECS) await loadSpec(fonts, spec).catch(fontLoadFailed(spec));
  if (hasMissingGlyphs(fonts, res.document)) await loadSpec(fonts, SYMBOL_SPEC).catch(fontLoadFailed(SYMBOL_SPEC));
  // 記号の書体にも無い絵文字があれば、絵文字の書体を読み込む (記号の書体の後に読むので、記号の書体が持つ字はこれまでどおり記号の書体で組む)
  if (hasMissingEmoji(fonts, res.document)) await loadSpec(fonts, EMOJI_SPEC).catch(fontLoadFailed(EMOJI_SPEC));
  // 読み込んだどの書体にも字形の無い字 (字形の無い字の形 = 豆腐で出る) を知らせる: 字と数。多ければ、多い順の先頭と残りの数
  const tofu = [...missingGlyphChars(fonts, res.document)].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  if (tofu.length) {
    const cp = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    const head = tofu.slice(0, 20).map(([ch, n]) => `${ch} (${cp(ch)}${n > 1 ? ` ×${n}` : ''})`).join(msg('、', ', '));
    const rest = tofu.length > 20 ? msg(` …ほか ${tofu.length - 20} 種`, ` … and ${tofu.length - 20} more`) : '';
    reportSummary(
      msg(`読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます): ${head}${rest}`, `no loaded font has a glyph for these characters (they are drawn as the missing-glyph box): ${head}${rest}`),
      tofu.map(([ch, n]) => ({ ...diag('font/missing-glyph', msg(`読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます): ${ch} (${cp(ch)})`, `no loaded font has a glyph for these characters (they are drawn as the missing-glyph box): ${ch} (${cp(ch)})`), { char: ch, codePoint: cp(ch) }), ...(n > 1 ? { count: n } : {}) })),
    );
  }

  const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: SERIF, assets, hyphenate: hyphenPositions, ...compatLayoutOptions(ah), ...(ignore.size ? { ignoreDiagnostics: ignore } : {}) });
  /**
   * SVG の foreignObject の中身 (HTML・MathML) を、本文と同じ HTML の組版で、幅 width・高さ height (CSS px) の余白の無いページとして組む
   * (SVG 2 の foreignObject: 中身は CSS の組版で、foreignObject の枠を初めの包含ブロックとして組む)。中身の文書の警告は出さない。
   * context.css (SVG の <style> の規則) は、作成者のスタイルシートとして入れる (中身は SVG の文書の中の要素なので、SVG の規則が当たる。SVG 2 §6.3)。
   * 既定のスタイルは、本文の既定 (style。kumiori の p の字下げ・両端揃えなど) でなく、ブラウザの既定 (browser) にし、
   * 本文の CSS のファイル (文書から参照されないもの) も当てない: 中身は SVG の中の文書で、本文の書式を受け継がない
   */
  const typesetForeign = async (content: string, width: number, height: number, context?: { css?: string }) => {
    // ページは縦に長くして、中身を 1 ページに組む (foreignObject の枠の外は、描くときに切る。SVG 2 の UA スタイルシートの overflow)
    const svgCss = context?.css?.trim() ? `<style>${context.css.replace(/<\/(style)/gi, '<\\/$1')}</style>` : '';
    const html = `<!DOCTYPE html><html><head><style>@page{size:${width}px ${Math.max(height, 20000)}px;margin:0}html,body{margin:0;padding:0}</style>${svgCss}</head><body>${content}</body></html>`;
    // 中身に MathML があれば、数式の書体を読み込む (本文に数式が無くても)
    const math = await mathOptionsFor(content, fonts, () => loadSpec(fonts, MATH_SPEC).catch(() => {}));
    const r = await importHtmlText(html, { ...options, unreferencedCss: 'ignore' }, 'browser', files, mapping, assets, measurer, math, false);
    // 中身の画像 (数式を描いた SVG の data: の URI など) を登録する (本文と同じ手順)
    await fetchReportedImages(assets, r.report.images, allowFetch, timeout);
    return new LayoutEngine(fonts, measurer, { defaultFontFamily: SERIF, assets, hyphenate: hyphenPositions, ...compatLayoutOptions(ah) }).layout(r.document).sheets[0];
  };
  /** PDF を書く設定 (toPdf と typesetToPdf で同じもの) */
  const pdfOptions = (o: PdfOptions, pdfWarnings: string[], pdfDiagnostics: Diagnostic[]): PdfRenderOptions => ({
    ...compatPdfOptions(isFo ? 'fo' : 'html', ah),
    ...(ignore.size ? { ignoreDiagnostics: ignore } : {}),
    assets,
    parseXml: svgParse,
    typesetForeign,
    ...(options.svgLanguages ? { svgLanguages: options.svgLanguages } : {}),
    ...(options.deflate ? { deflate: options.deflate } : {}),
    ...(options.links ? { links: options.links } : {}),
    // 既定で付けたタグは 'auto' (透明を平らにする出力では、黙って付けない)
    ...(options.tagged ? { tagged: taggedAsked ? true : ('auto' as const) } : {}),
    ...(options.pdfua ? { pdfua: typeof options.pdfua === 'object' ? options.pdfua : {} } : {}),
    ...o,
    warnings: pdfWarnings,
    diagnostics: pdfDiagnostics,
  });
  const t0 = Date.now();
  if (pdfOnly) {
    // PDF だけを作る (typesetToPdf): ページを 1 枚ずつ領域の木にして書き、書いたページを手放す (文書全体の領域の木を 1 度に持たない)
    const { lowMemory, ...pdfOpts } = pdfOnly;
    // 書体の知らせ: ページを集めるたどり (layout の attachResources に当たる) の間は組版の警告に、ページを描く間は PDF を書く途中の知らせに入れる
    // (typeset の後に toPdf を呼んだときと同じ順にする)
    const pdfNotices: Diagnostic[] = [];
    const scanned = () => {
      fonts.onNotice = (d) => pdfNotices.push(d);
    };
    let info: Pick<AreaTree, 'warnings' | 'diagnostics'> | undefined;
    const pdfWarnings: string[] = [];
    const pdfDiagnostics: Diagnostic[] = [];
    let pageCount: number;
    let layoutMs: number;
    let bytes: Uint8Array;
    if (lowMemory) {
      // メモリ節約: 組み直しの回で前の回のページを使い回さず、組み終えた page-sequence の組版の途中の木を手放す (組版の手間は増える)
      const pages = engine.layoutLowMemory(res.document);
      bytes = await renderPdfPages(
        { title: pages.title, info: pages.info, structure: pages.structure, scan: (v, r) => pages.scan(v, r), paint: (v) => pages.paint(v), finish: () => (info = pages.finish()), scanned },
        fonts,
        { ...pdfOptions(pdfOpts, pdfWarnings, pdfDiagnostics), releaseImageBytes: true },
      );
      pageCount = pages.count;
      layoutMs = pages.layoutMs;
    } else {
      const pages = engine.layoutSheets(res.document);
      layoutMs = Date.now() - t0;
      bytes = await renderPdfPages(
        {
          title: pages.title,
          info: pages.info,
          structure: pages.structure,
          scan: (visit) => {
            for (let i = 0; i < pages.count; i++) visit(pages.sheet(i));
          },
          paint: (visit) => {
            for (let i = 0; i < pages.count; i++) {
              visit(pages.sheet(i));
              pages.release(i);
            }
          },
          finish: () => (info = pages.finish()),
          scanned,
        },
        fonts,
        { ...pdfOptions(pdfOpts, pdfWarnings, pdfDiagnostics), releaseImageBytes: true },
      );
      pageCount = pages.count;
    }
    const out = [...warnings, ...(info?.warnings ?? [])];
    const outDiags = new DiagnosticList();
    outDiags.addAll([...diags, ...(info?.diagnostics ?? [])]);
    // PDF を書く途中の警告 (書体の知らせと renderPdf の警告) は、同じ文を 1 度だけ足す (診断も、文を足したものだけ)
    for (const d of [...pdfNotices, ...pdfDiagnostics.filter((d) => pdfWarnings.includes(d.message))])
      if (!out.includes(d.message)) {
        out.push(d.message);
        outDiags.add(d);
      }
    for (const m of pdfWarnings) if (!out.includes(m)) out.push(m);
    for (const d of pdfDiagnostics) if (!pdfWarnings.includes(d.message)) outDiags.add(d);
    return { pdf: bytes, pageCount, warnings: out, diagnostics: outDiags.list, layoutMs };
  }
  const tree = engine.layout(res.document);
  const layoutMs = Date.now() - t0;
  // Web Worker の中の renderPage (同期) が描く SVG の画像の用意 (SVG の @font-face・読めない形の中の画像)。画面の中と Node では何もしない
  await prepareSvgImagesForCanvas(assets, fonts);
  // 結果の警告。組んだ後の書体の知らせ (PDF を書くときに初めて読む色つきの字形の上限など。fontSanity.ts の fontNotice) と、
  // PDF を書く途中の警告 (renderPdf の warnings) も、ここに足す (同じ文は 1 度だけ)
  const resultWarnings = [...warnings, ...tree.warnings];
  const resultDiags = new DiagnosticList();
  resultDiags.addAll([...diags, ...(tree.diagnostics ?? [])]);
  const addWarning = (d: Diagnostic) => {
    if (resultWarnings.includes(d.message)) return;
    resultWarnings.push(d.message);
    resultDiags.add(d);
  };
  fonts.onNotice = addWarning;
  // toPdf は typeset の後に呼ばれるので、警告の言語 (TypesetOptions.lang) を、組んだときの言語に戻して書く
  const lang = messageLang();
  return {
    areaTree: tree,
    pageCount: tree.sheets.length,
    warnings: resultWarnings,
    diagnostics: resultDiags.list,
    layoutMs,
    toPdf: (o = {}) =>
      withMessageLang(lang, async () => {
        const pdfWarnings: string[] = [];
        const pdfDiagnostics: Diagnostic[] = [];
        try {
          return await renderPdf(tree, fonts, pdfOptions(o, pdfWarnings, pdfDiagnostics));
        } finally {
          // 警告の文は、前と同じに足す (同じ文は 1 度)。診断は、文を足したものと、warnings に出さない知らせ (pdfx.warnings など) を足す
          for (const m of pdfWarnings) {
            const d = pdfDiagnostics.find((x) => x.message === m);
            if (d) addWarning(d);
            else if (!resultWarnings.includes(m)) resultWarnings.push(m);
          }
          for (const d of pdfDiagnostics) if (!pdfWarnings.includes(d.message)) resultDiags.add(d);
        }
      }),
    renderPage: (canvas, pageIndex, o = {}) => {
      const sheet = tree.sheets[pageIndex];
      if (!sheet) throw new RangeError(msg(`ページ ${pageIndex} はありません (0〜${tree.sheets.length - 1})`, `there is no page ${pageIndex} (0 to ${tree.sheets.length - 1})`));
      renderSheetToCanvas(sheet, canvas, fonts, {
        ...(o.scale !== undefined ? { scale: o.scale } : {}),
        ...(o.devicePixelRatio !== undefined ? { devicePixelRatio: o.devicePixelRatio } : {}),
        guides: !!o.guides,
        assets,
        glyphOutlines: true,
        parseXml: svgParse,
        warn: addWarning,
      });
    },
    renderPageToSvg: (pageIndex, o = {}) =>
      withMessageLang(lang, async () => {
        const sheet = tree.sheets[pageIndex];
        if (!sheet) throw new RangeError(msg(`ページ ${pageIndex} はありません (0〜${tree.sheets.length - 1})`, `there is no page ${pageIndex} (0 to ${tree.sheets.length - 1})`));
        return renderSheetToSvg(sheet, fonts, { assets, parseXml: svgParse, guides: !!o.guides, ...(o.idPrefix !== undefined ? { idPrefix: o.idPrefix } : {}) });
      }),
    renderPageToPng: (pageIndex, o = {}) =>
      withMessageLang(lang, async () => {
        const sheet = tree.sheets[pageIndex];
        if (!sheet) throw new RangeError(msg(`ページ ${pageIndex} はありません (0〜${tree.sheets.length - 1})`, `there is no page ${pageIndex} (0 to ${tree.sheets.length - 1})`));
        return renderSheetToPng(sheet, fonts, { assets, parseXml: svgParse, guides: !!o.guides, warn: addWarning, ...(o.dpi !== undefined ? { dpi: o.dpi } : {}) });
      }),
  };
}

/** HTML+CSS を組む (typeset の kind: 'html') */
export const typesetHtml = (html: string, options: Omit<TypesetOptions, 'kind'> = {}) => typeset(html, { ...options, kind: 'html' });
/** XSL-FO を組む (typeset の kind: 'fo') */
export const typesetFo = (fo: string, options: Omit<TypesetOptions, 'kind'> = {}) => typeset(fo, { ...options, kind: 'fo' });

type Mapping = ReturnType<typeof createFontMapping>;
type Imported = { document: LDocument; report: { images: string[]; unsupported?: Record<string, number>; unknownCss?: Record<string, number>; droppedLinks?: DroppedLinks; diagnostics?: Diagnostic[]; unsupportedAt?: Record<string, DiagnosticSource> }; /** 文書の用意の途中の警告 (深すぎる入れ子など) */ warnings?: Diagnostic[] };
type MathOpts = MathOptions;

/** XSL-FO を論理ツリーにする (画面の XSL-FO の読み込みと同じ) */
async function importFo(text: string, o: TypesetOptions, compat: FoCompat, mapping: Mapping, assets: AssetStore, extra: Partial<ImportOptions> = {}): Promise<Imported> {
  // 分綴 (hyphenate="true") を使う文書なら、文書に出てくる言語の分綴の規則を先に読み込む
  await loadFoHyphenators(text);
  return importXslFo(text, (t) => xmlParse(t, o.name), {
    ...(o.name !== undefined ? { sourceName: o.name } : {}),
    mapFont: mapping.mapFoFont,
    compat,
    bleedMm: o.print ? 3 : 0,
    trimMarks: !!o.print,
    readText: (src) => assets.getText(src),
    ...(o.links ? { links: o.links } : {}),
    ...(o.spotColors ? { spotColors: o.spotColors } : {}),
    ...(o.tagged ? { tagged: true } : {}),
    ...extra,
  });
}

/**
 * linkedom の読み取りを、HTML の仕様の読み取り (ブラウザ) に合わせる:
 *  - 書かれていない <head>・<body> を補う。html の直下に並んだ要素と文字を、メタデータ (meta・title・link・style・script・base) は head へ、ほかは body へ順に移す
 *  - </html> の後ろに書かれた要素と文字 (linkedom は、html 要素の後ろの、文書の直下の兄弟にする) を、body の終わりへ順に移す
 *    (HTML Living Standard §13.2.6.4.17「after body」・§13.2.6.4.20「after after body」の挿入モード。2026-11-11 取得: コメントのほかは、
 *    「in body」の挿入モードに戻して処理する = body の続きになる)。コメントは文書の直下に残す。空白だけの文字は、後ろに移す内容が
 *    続くときだけ移す (移す内容の間の空白を残す。文書の終わりの空白は動かさない)
 *  - <pre>・<textarea>・<listing> の開始タグの直後の改行を捨てる
 */
export function fixImplicitStructure(doc: Document) {
  const html = doc.documentElement;
  const head = doc.head ?? html.insertBefore(doc.createElement('head'), html.firstChild);
  const body = doc.body ?? html.appendChild(doc.createElement('body'));
  {
    const after: ChildNode[] = [];
    for (let n = html.nextSibling; n; n = n.nextSibling) after.push(n);
    const content = (n: ChildNode) => n.nodeType === 1 || (n.nodeType === 3 && /[^ \t\n\f\r]/.test(n.nodeValue ?? ''));
    let last = after.length - 1;
    while (last >= 0 && !content(after[last])) last--;
    // html の直下の終わりへ移す (下の振り分けが、</body> と </html> の間の内容と同じに body へ入れる)
    for (const n of after.slice(0, last + 1)) if (n.nodeType === 1 || n.nodeType === 3) html.appendChild(n);
  }
  for (const n of Array.from(html.childNodes)) {
    if (n === head || n === body) continue;
    const meta = n.nodeType === 1 && /^(meta|title|link|style|script|base|noscript|template)$/i.test((n as Element).localName);
    // body に何も入っていないうちのメタデータは head へ、ほかは body へ
    if (meta && !body.hasChildNodes()) head.appendChild(n);
    else body.appendChild(n);
  }
  doc.querySelectorAll('pre, textarea, listing').forEach((el) => {
    const t = el.firstChild;
    if (t && t.nodeType === 3 && /^\r?\n/.test(t.nodeValue ?? '')) t.nodeValue = (t.nodeValue ?? '').replace(/^\r?\n/, '');
  });
}

/**
 * <html> の無い HTML (<p>… だけのもの) を <html> で包む (linkedom は、ブラウザのように文書の形を補わない)。
 * <!doctype> はそのまま前に残す。中身は fixImplicitStructure が head と body に分ける
 */
export function wrapHtml(t: string): string {
  if (/<html[\s>]/i.test(t)) return t;
  const m = /^\s*(<!doctype[^>]*>)/i.exec(t);
  return m ? `${m[1]}<html>${t.slice(m[0].length)}</html>` : `<html>${t}</html>`;
}

/** HTML と CSS を論理ツリーにする (画面と同じ集め方。計算値は自前のカスケード) */
async function importHtmlText(
  html: string,
  o: TypesetOptions,
  style: HtmlDefaults,
  files: InnerFile[],
  mapping: Mapping,
  assets: AssetStore,
  measurer: Measurer,
  math: MathOpts,
  /** XML の構文 (XHTML) で読んだ文書 (互換モードにならない) */
  xml: boolean,
  /** 診断の場所: 入力のファイルの名前と、html が入力の字そのものか (違えば、行・列を付けない) */
  source: { name?: string; original: boolean } = { original: false },
): Promise<Imported> {
  const parsed0 = (await parsers()).html;
  const parseHtml = (t: string) => {
    const d = parsed0(t);
    if (!(source.original && t === html)) setDocumentSource(d, undefined, source.name, { lines: false });
    else if (source.name !== undefined) setDocumentSource(d, t === wrapHtml(t) ? t : wrapHtml(t), source.name);
    return d;
  };
  // @page の無いときに選ばれる用紙 (既定は A4。TypesetOptions.pageSize で変える) と余白 20mm。@media の width・height・orientation も、この用紙で評価する
  // (CSS Paged Media 3 §7.1: メディアクエリは size に従わず、@page の規則が無いときに選ばれる用紙を前提にする)
  const defaultPage = { ...((o.pageSize !== undefined ? parsePageSize(o.pageSize) : undefined) ?? { width: 210, height: 297 }), margin: 20 };
  const prepared = await prepareHtml(html, files.filter(isCss), style, defaultPage, parseHtml, { unreferencedCss: o.unreferencedCss });
  // 画像は data-kumiori-src に元のパスを残す (画面と同じ)
  prepared.doc.querySelectorAll('img[src]').forEach((img) => img.setAttribute('data-kumiori-src', img.getAttribute('src') ?? ''));
  // 既定のスタイル (style) は、作成者スタイルシート ではなく既定のスタイルシート (UA) として当てる (作成者スタイルシート に詳細度で勝たない)
  // attr() を置き換えた結果、読めない値になって無効にした宣言 (CSS Values 5 §7.7.1。警告に出す)
  const invalidAttr: Record<string, number> = {};
  // 結合子の種類の混ざったセレクタの照合の覚えの予算を使い切った (未対応の CSS の警告に出す)
  let selectorBudget = false;
  const fontFiles = files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name));
  // アンテナハウス互換の bolder・lighter は、@font-face の書体の太さで決める (記述子の無い face は、書体のファイルの太さ。compat.ts の ahCascadeOptions)
  const ahWeights = style === 'ah' ? await faceFileWeights(prepared.sheet, fontFiles) : undefined;
  const styles = cascadeStyles(prepared.doc, prepared.authorSheet, { uaCss: HTML_UA_CSS, uaExtraCss: prepared.uaSheet, quirksMode: documentMode(prepared.doc, xml), viewport: { width: Math.max(prepared.bodyWidthPx, 100), height: prepared.pageHeightPx }, pageWidths: prepared.pageWidthsPx, ...styleCascadeOptions(style, prepared.sheet, ahWeights), onInvalidAttr: (p, v) => (invalidAttr[`${p}: ${v}`] = (invalidAttr[`${p}: ${v}`] ?? 0) + 1), onSelectorBudget: () => (selectorBudget = true) });
  // @font-face の書体 (TTF・OTF と、ふつうの書体のファイルに戻して使う WOFF・WOFF2)
  // アンテナハウス互換 (style ah) では、font-weight の記述子の無い face を、書体のファイルの太さで登録する (fontMapping.loadFontFaces)
  // 当たるファイルの無かった face は、次の書体で組み (CSS Fonts 4 §4.3)、警告で知らせる
  const faceWarnings: Diagnostic[] = [];
  const faces = await mapping.loadFontFaces(prepared.sheet, fontFiles, { ahFaceWeight: style === 'ah' });
  for (const m of faces.missing) faceWarnings.push(diag('font/face-not-found', msg(`@font-face の書体のファイルが見つかりません: ${m.family} (${m.src.slice(0, 200)})`, `font file of @font-face not found: ${m.family} (${m.src.slice(0, 200)})`), { font: m.family, url: m.src.slice(0, 200) }));
  // 分綴を使う文書なら、文書に出てくる言語の分綴の規則を読み込む
  await loadDocumentHyphenators(prepared.doc, prepared.css);
  // 作成者スタイルシート と style 属性のうち、読まない宣言 (未対応・知らないプロパティ) を数える
  const cssRep = unsupportedCssReport(prepared.authorSheet, prepared.doc);
  const imported = importHtml(prepared.doc, styles, {
    mapFont: mapping.mapHtmlFont,
    measureText: (t, st) => measurer.textAdvance(t, st, { kerning: st.kerning, features: st.features }),
    hasAsset: (src) => !!assets.get(src),
    imageSize: (src) => assets.get(src),
    normalLineHeight: mapping.htmlNormalLineHeight,
    // 既定のスタイルごとの互換の設定 (アンテナハウス互換・ブラウザ。compat.ts。画面と同じ)
    ...htmlImportCompatOptions(style),
    css: prepared.css,
    sheet: prepared.sheet,
    defaultPage,
    bleedMm: o.print ? 3 : 0,
    trimMarks: !!o.print,
    ...(o.links ? { links: o.links } : {}),
    ...(o.spotColors ? { spotColors: o.spotColors } : {}),
    ...(o.tagged ? { tagged: true } : {}),
    ...math,
  });
  const unsupported = { ...imported.report.unsupported };
  for (const [k, n] of Object.entries(cssRep.unsupported)) unsupported[k] = (unsupported[k] ?? 0) + n;
  if (selectorBudget) unsupported[tooComplexTotal()] = (unsupported[tooComplexTotal()] ?? 0) + 1;
  const badAttr = summarizeCounts(invalidAttr);
  const attrWarnings = badAttr
    ? [
        diag('css/invalid-attr-value', msg(
          `attr() を置き換えた値が読めない宣言を無視しました (型の無い attr() は文字列です。数や長さとして使うには attr(名前 number)・attr(名前 px) のように型を書きます): ${badAttr}`,
          `ignored declarations whose value is invalid after attr() substitution (an attr() without a type is a string; write a type such as attr(name number) or attr(name px) to use it as a number or a length): ${badAttr}`,
        )),
      ]
    : [];
  return { ...imported, report: { ...imported.report, unsupported, unknownCss: cssRep.unknown }, warnings: [...prepared.warnings, ...faceWarnings, ...attrWarnings] };
}

