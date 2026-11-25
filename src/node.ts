/**
 * Kumiori の Node 用のモジュール (kumiori/node)。ファイルシステムを使うので、ブラウザーでは読み込まない。
 *
 * ```ts
 * import { typeset } from 'kumiori';
 * import { createFontLoader, createFileResolver } from 'kumiori/node';
 * const r = await typeset(html, {
 *   loadFont: createFontLoader(),            // 既定のフォント: 格納先 → キャッシュ → ネットワーク (Node のコマンドと同じ)
 *   resolveResource: createFileResolver(),   // file:///…/style.css などの参照を読む
 * });
 * ```
 *
 * @module kumiori/node
 */
export { createFontLoader, createFileResolver, defaultFontCacheDir, looksLikeFont } from './nodeFonts';
export type { FontLoaderOptions } from './nodeFonts';
export { createSystemFonts, systemFontDirs } from './nodeSystemFonts';
export type { SystemFontOptions } from './nodeSystemFonts';
export type { SystemFontSource, SystemFontRequest, SystemFontMatch, SystemFontKind } from './types';
