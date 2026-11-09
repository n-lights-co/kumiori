import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * ライブラリとしてのビルド (npm run build:lib): src/index.ts (と Node 用の src/node.ts) を ES モジュールにして dist-lib/ に出す。
 * 依存パッケージは取り込まず、使う側で読み込む (package.json の dependencies)
 */
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    build: {
      outDir: 'dist-lib',
      emptyOutDir: true,
      sourcemap: true,
      // index: ブラウザでも Node でも使う入口、node: Node 用の部品 (書体のキャッシュ・file: の参照の読み込み)
      lib: { entry: { index: 'src/index.ts', node: 'src/node.ts' }, formats: ['es'], fileName: (_f, name) => `${name}.js` },
      rolldownOptions: {
        external: [/^@pdf-lib\//, 'pdf-lib', 'linkedom', /^@xmldom\//, 'hyphen', /^hyphen\//, 'utif', /^node:/],
      },
    },
  }),
);
