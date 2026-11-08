import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * ブラウザで単体で動くライブラリのビルド (npm run build:browser): src/index.ts を、依存パッケージ (pdf-lib・fontkit・xmldom・
 * ハイフネーション・UTIF) まで束ねた ES モジュール dist-browser/kumiori.js にする。バンドラーを使わずに
 * <script type="module"> や CDN (jsDelivr・unpkg) から読む人向け。ハイフネーションの辞書・UTIF・pako は、使うときだけ読む別ファイルになる。
 * Node でだけ使う linkedom は束ねない (api.ts が Node のときだけ動的に読む)。型の宣言は dist-lib/types (build:lib) のものを使う
 */
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    build: {
      outDir: 'dist-browser',
      emptyOutDir: true,
      sourcemap: false,
      lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'kumiori.js' },
      rolldownOptions: {
        external: ['linkedom'],
        output: { chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  }),
);
