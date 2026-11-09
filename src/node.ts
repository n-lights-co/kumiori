/**
 * Kumiori の Node 用の部品 (kumiori/node)。ファイルシステムを使うので、ブラウザでは読み込まない。
 *
 *   import { typeset } from 'kumiori';
 *   import { createFontLoader, createFileResolver } from 'kumiori/node';
 *   const r = await typeset(html, {
 *     loadFont: createFontLoader(),            // 既定の書体: 置き場 → キャッシュ → ネットワーク (Node のコマンドと同じ)
 *     resolveResource: createFileResolver(),   // file:///…/style.css などの参照を読む
 *   });
 */
export { createFontLoader, createFileResolver, defaultFontCacheDir, looksLikeFont } from './nodeFonts';
export type { FontLoaderOptions } from './nodeFonts';
