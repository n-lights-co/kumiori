/**
 * Kumiori (組み織り) — 日本語組版のためのライブラリの入口。
 *
 *   import { typeset } from 'kumiori';
 *   const result = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 *   const pdf = await result.toPdf();          // Uint8Array
 *   result.renderPage(canvas, 0);              // 1 ページ目を canvas に描く (ブラウザ)
 *   walkAreaTree(result.areaTree, (a) => { … }); // 組んだ結果 (Area Tree) をたどる
 *
 * ここから出すものだけが公開 API (ほかのモジュールの関数・型は、版の間で変わることがある)。
 */

export { typeset, typesetHtml, typesetFo, createTypesetter, decodeDocumentText } from './api';
export type { TypesetOptions, TypesetResult, RenderPageOptions, Typesetter, TypesetterOptions, DocumentOptions, KumioriFile, KumioriFileData, HtmlDefaults, FontSpec } from './api';

import { FONT_SPECS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC } from './fontMapping';
import type { FontSpec } from './types';
/**
 * 既定で使う書体 (TypesetOptions.loadFont に渡される spec)。base は毎回使う本文の書体、ほかは文書に必要なときだけ読む
 * (math: MathML、mono: 等幅の指定、symbol: 本文の書体に無い記号)
 */
export const DEFAULT_FONTS: { base: readonly FontSpec[]; math: FontSpec; mono: readonly FontSpec[]; symbol: FontSpec } = {
  base: [...FONT_SPECS, ...LATIN_SPECS],
  math: MATH_SPEC,
  mono: [...MONO_SPECS],
  symbol: SYMBOL_SPEC,
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
