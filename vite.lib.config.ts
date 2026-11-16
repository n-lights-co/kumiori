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
      // sourcemap は作らない (npm の配布物に入れない。dist-browser・dist-cli と同じ)。
      // ライブラリの ES モジュールは行を詰めず、クラスのメソッドの名前も残る (短くなるのは、関数の名前と、変数・引数の名前) ので、エラーの場所はこの JS の行とメソッドの名前で分かる。
      // ソースは GitHub のその版のタグで見る。手元で要るときは `npx vite build --config vite.lib.config.ts --sourcemap` で作れる
      sourcemap: false,
      // index: ブラウザでも Node でも使う入口、node: Node 用の部品 (書体のキャッシュ・file: の参照の読み込み)
      lib: { entry: { index: 'src/index.ts', node: 'src/node.ts' }, formats: ['es'], fileName: (_f, name) => `${name}.js` },
      rolldownOptions: {
        external: [/^@pdf-lib\//, 'pdf-lib', 'linkedom', /^@xmldom\//, 'hyphen', /^hyphen\//, 'utif', 'pako', 'roughjs', /^roughjs\//, /^node:/],
      },
    },
  }),
);
