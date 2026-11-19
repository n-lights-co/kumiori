/**
 * Kumiori (組み織り) — 日本語組版のためのライブラリの入口。
 *
 *   import { typeset } from 'kumiori';
 *   const result = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 *   const pdf = await result.toPdf();          // Uint8Array
 *   const { pdf: bytes } = await typesetToPdf(html); // PDF だけが要るとき (組んだ結果を持たないので、大きな文書で使うメモリが少ない)
 *   result.renderPage(canvas, 0);              // 1 ページ目を canvas に描く (ブラウザ)
 *   walkAreaTree(result.areaTree, (a) => { … }); // 組んだ結果 (Area Tree) をたどる
 *
 * ここから出すものだけが公開 API (ほかのモジュールの関数・型は、版の間で変わることがある)。
 */

export { typeset, typesetHtml, typesetFo, typesetToPdf, createTypesetter, decodeDocumentText } from './api';
export type { TypesetOptions, TypesetResult, TypesetPdfResult, TypesetPdfOptions, PdfOptions, RenderPageOptions, Typesetter, TypesetterOptions, DocumentOptions, KumioriFile, KumioriFileData, HtmlDefaults, FontSpec } from './api';

// プラグイン (TypesetOptions.plugins。いまは画像の形式を足すものだけ。imageFormats.ts)
export { PLUGIN_API_VERSION } from './imageFormats';
export type { KumioriPlugin, ImageFormat, ImageFormatContext, ImageFormatResult, MeasureFont } from './imageFormats';

// draw.io の図 (TypesetOptions.drawio。drawio/index.ts)
export { DRAWIO_MIME, isDrawio, createDrawioStencilRegistry } from './drawio/index';
export type { DrawioOptions, DrawioFile, DrawioFileData, DrawioStencilFetcher, DrawioStencilRegistry } from './drawio/index';

import { EMOJI_SPEC, FONT_SPECS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC } from './fontMapping';
import type { FontSpec } from './types';
/**
 * 既定で使う書体 (TypesetOptions.loadFont に渡される spec)。base は毎回使う本文の書体、ほかは文書に必要なときだけ読む
 * (math: MathML、mono: 等幅の指定、symbol: 本文の書体に無い記号、emoji: 記号の書体にも無い絵文字)
 */
export const DEFAULT_FONTS: { base: readonly FontSpec[]; math: FontSpec; mono: readonly FontSpec[]; symbol: FontSpec; emoji: FontSpec } = {
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
  AreaResources,
  FontResource,
  ImageResource,
  Rect,
} from './types';
