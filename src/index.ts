/**
 * Kumiori (組み織り) — 日本語組版のためのライブラリの入口。
 *
 * ```ts
 * import { typeset } from 'kumiori';
 * const result = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 * const pdf = await result.toPdf();          // Uint8Array
 * const { pdf: bytes } = await typesetToPdf(html); // PDF だけが要るとき (組んだ結果を持たないので、大きな文書で使うメモリが少ない)
 * result.renderPage(canvas, 0);              // 1 ページ目を canvas に描画する (ブラウザー)
 * walkAreaTree(result.areaTree, (a) => { … }); // 組んだ結果 (Area Tree) をたどる
 * ```
 *
 * ブラウザー向けの 1 ファイル (kumiori/browser) は、Web Worker の中でも使える (renderPage には OffscreenCanvas を渡す。TypesetResult.renderPage)。
 * Node でファイルシステムからフォント・リソースを読むモジュールは kumiori/node にある。
 *
 * ここから出すものだけが公開 API (ほかのモジュールの関数・型は、バージョンの間で変わることがある)。
 *
 * @module kumiori
 */

export { typeset, typesetHtml, typesetFo, typesetToPdf, typesetToPdfStream, createTypesetter, decodeDocumentText } from './api';
export type { TypesetOptions, TypesetResult, TypesetPdfResult, TypesetPdfOptions, TypesetPdfStreamResult, PdfOutput, PdfOptions, RenderPageOptions, RenderPageSvgOptions, RenderPagePngOptions, Typesetter, TypesetterOptions, DocumentOptions, KumioriFile, KumioriFileData, HtmlDefaults, FontSpec, LinkPolicy, KumioriLimits, ResourceContext, TypesetProgress, MemoryUsage, TypesetterMemoryUsage } from './api';
export type { SystemFontSource, SystemFontRequest, SystemFontMatch, SystemFontKind } from './types';
// オプションの値の型 (TypesetOptions の compat・lang、PdfOptions の pdfx・pdfa)
export type { FoCompat } from './compat';
export type { MessageLang } from './messages';
export type { PdfXOptions, PdfAOptions } from './pdfStandard';
export type { PdfEncryptOptions, PdfPermissions } from './pdfEncrypt';
// 文書を作らずに文字列を測る (Typesetter.measureText・breakLines。textMeasure.ts)
export type { TextStyle, MeasuredText, MeasuredLine } from './textMeasure';

// 診断 (TypesetResult.diagnostics。名前・重大度・文に埋めた値・入力の場所) と、Kumiori が投げるエラーの型 (どれも code を持つ)。名前の一覧は docs/diagnostics.md
export { DIAGNOSTIC_CODES, ERROR_CODES } from './diagnostics';
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity, DiagnosticSource, DiagnosticArgs, ErrorCode } from './diagnostics';
export { KumioriError, KumioriInputError, KumioriLimitError, KumioriFontError, KumioriPdfError, KumioriOptionError, isKumioriError } from './errors';
export type { KumioriErrorDetails } from './errors';

// プラグイン (TypesetOptions.plugins。いまは画像の形式を追加するものだけ。imageFormats.ts)
export { PLUGIN_API_VERSION } from './imageFormats';
export type { KumioriPlugin, ImageFormat, ImageFormatContext, ImageFormatResult, MeasureFont } from './imageFormats';

// ブラウザーの画面で、JS が組み上げた後の文書を、typeset に渡せる形にする (snapshot.ts。DOM のある所だけで使える)
export { snapshotDocument } from './snapshot';
export type { SnapshotOptions, DocumentSnapshot } from './snapshot';

// draw.io の図 (TypesetOptions.drawio。drawio/index.ts)
export { DRAWIO_MIME, isDrawio, createDrawioStencilRegistry } from './drawio/index';
export type { DrawioOptions, DrawioFile, DrawioFileData, DrawioStencilFetcher, DrawioStencilRegistry } from './drawio/index';

import { EMOJI_SPEC, FONT_SPECS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC } from './fontMapping';
import type { FontSpec } from './types';
/**
 * 既定で使うフォント (TypesetOptions.loadFont に渡される spec)。base は毎回使う本文のフォント、ほかは文書に必要なときだけ読む
 * (math: MathML、mono: 等幅の指定、symbol: 本文のフォントに無い記号、emoji: 記号のフォントにも無い絵文字)
 */
export const DEFAULT_FONTS: {
  /** 本文のフォント (和文と欧文。毎回使う) */
  base: readonly FontSpec[];
  /** 数式 (MathML) のフォント */
  math: FontSpec;
  /** 等幅のフォント */
  mono: readonly FontSpec[];
  /** 本文のフォントに無い記号のフォント */
  symbol: FontSpec;
  /** 記号のフォントにも無い絵文字のフォント */
  emoji: FontSpec;
} = {
  base: [...FONT_SPECS, ...LATIN_SPECS],
  math: MATH_SPEC,
  mono: [...MONO_SPECS],
  symbol: SYMBOL_SPEC,
  emoji: EMOJI_SPEC,
};

// Area Tree (組んだ結果) をたどる・読み書きする
export { AREA_TREE_SCHEMA_VERSION, childrenOf, walkAreas, walkAreaTree, serializeAreaTree, parseAreaTree, AreaTreeFormatError, documentNodes } from './areaTree';
export type { AreaNode } from './areaTree';
export type {
  AreaTree,
  Area,
  SheetArea,
  PageArea,
  RegionBodyArea,
  BlockArea,
  LineArea,
  InlineArea,
  GlyphArea,
  ImageArea,
  RubyArea,
  TateChuYokoArea,
  TableArea,
  TableRowArea,
  TableCellArea,
  BookmarkArea,
  DocumentInfo,
  Annotation,
  LinkTarget,
  FormField,
  BackgroundImage,
  BorderStyle,
  BorderSide,
  BorderLineStyle,
  CollapsedSide,
  BorderRadius,
  RadiusLength,
  BoxShadow,
  Outline,
  Edges,
  ObjectPosition,
  WritingMode,
  Rotation,
  AreaResources,
  FontResource,
  ImageResource,
  Rect,
} from './types';
export type { AreaStructure, StructNode, ArtifactKind } from './structure';
