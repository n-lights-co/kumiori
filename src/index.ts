/**
 * Kumiori (組み織り) — 日本語組版のためのライブラリの入口。
 *
 * ```ts
 * import { typeset } from 'kumiori';
 * const result = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 * const pdf = await result.toPdf();          // Uint8Array
 * const { pdf: bytes } = await typesetToPdf(html); // PDF だけが要るとき (組んだ結果を持たないので、大きな文書で使うメモリが少ない)
 * result.renderPage(canvas, 0);              // 1 ページ目を canvas に描く (ブラウザ)
 * walkAreaTree(result.areaTree, (a) => { … }); // 組んだ結果 (Area Tree) をたどる
 * ```
 *
 * ブラウザ向けの 1 ファイル (kumiori/browser) は、Web Worker の中でも使える (renderPage には OffscreenCanvas を渡す。TypesetResult.renderPage)。
 * Node でファイルシステムから書体・資源を読む部品は kumiori/node にある。
 *
 * ここから出すものだけが公開 API (ほかのモジュールの関数・型は、版の間で変わることがある)。
 *
 * @module kumiori
 */

export { typeset, typesetHtml, typesetFo, typesetToPdf, createTypesetter, decodeDocumentText } from './api';
export type { TypesetOptions, TypesetResult, TypesetPdfResult, TypesetPdfOptions, PdfOptions, RenderPageOptions, RenderPageSvgOptions, RenderPagePngOptions, Typesetter, TypesetterOptions, DocumentOptions, KumioriFile, KumioriFileData, HtmlDefaults, FontSpec, LinkPolicy, KumioriLimits, ResourceContext, TypesetProgress } from './api';
export type { SystemFontSource, SystemFontRequest, SystemFontMatch, SystemFontKind } from './types';
// 選択肢の値の型 (TypesetOptions の compat・lang、PdfOptions の pdfx・pdfa)
export type { FoCompat } from './compat';
export type { MessageLang } from './messages';
export type { PdfXOptions, PdfAOptions } from './pdfStandard';

// 診断 (TypesetResult.diagnostics。名前・重さ・文に埋めた値・入力の場所) と、Kumiori が投げる誤りの型 (どれも code を持つ)。名前の一覧は docs/diagnostics.md
export { DIAGNOSTIC_CODES, ERROR_CODES } from './diagnostics';
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity, DiagnosticSource, DiagnosticArgs, ErrorCode } from './diagnostics';
export { KumioriError, KumioriInputError, KumioriLimitError, KumioriFontError, KumioriPdfError, KumioriOptionError, isKumioriError } from './errors';
export type { KumioriErrorDetails } from './errors';

// プラグイン (TypesetOptions.plugins。いまは画像の形式を足すものだけ。imageFormats.ts)
export { PLUGIN_API_VERSION } from './imageFormats';
export type { KumioriPlugin, ImageFormat, ImageFormatContext, ImageFormatResult, MeasureFont } from './imageFormats';

// ブラウザの画面で、JS が組み上げた後の文書を、typeset に渡せる形にする (snapshot.ts。DOM のある所だけで使える)
export { snapshotDocument } from './snapshot';
export type { SnapshotOptions, DocumentSnapshot } from './snapshot';

// draw.io の図 (TypesetOptions.drawio。drawio/index.ts)
export { DRAWIO_MIME, isDrawio, createDrawioStencilRegistry } from './drawio/index';
export type { DrawioOptions, DrawioFile, DrawioFileData, DrawioStencilFetcher, DrawioStencilRegistry } from './drawio/index';

import { EMOJI_SPEC, FONT_SPECS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC } from './fontMapping';
import type { FontSpec } from './types';
/**
 * 既定で使う書体 (TypesetOptions.loadFont に渡される spec)。base は毎回使う本文の書体、ほかは文書に必要なときだけ読む
 * (math: MathML、mono: 等幅の指定、symbol: 本文の書体に無い記号、emoji: 記号の書体にも無い絵文字)
 */
export const DEFAULT_FONTS: {
  /** 本文の書体 (和文と欧文。毎回使う) */
  base: readonly FontSpec[];
  /** 数式 (MathML) の書体 */
  math: FontSpec;
  /** 等幅の書体 */
  mono: readonly FontSpec[];
  /** 本文の書体に無い記号の書体 */
  symbol: FontSpec;
  /** 記号の書体にも無い絵文字の書体 */
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
