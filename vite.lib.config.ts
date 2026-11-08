import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * ライブラリとしてのビルド (npm run build:lib): src/index.ts を ES モジュールにして dist-lib/ に出す。
 * 依存パッケージは束ねず、使う側で読み込む (package.json の dependencies)
 */
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    build: {
      outDir: 'dist-lib',
      emptyOutDir: true,
      sourcemap: true,
      lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
      rolldownOptions: {
        external: [/^@pdf-lib\//, 'pdf-lib', 'linkedom', /^@xmldom\//, 'hyphen', /^hyphen\//, 'utif'],
      },
    },
  }),
);
