import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const LINKEDOM_MODULES_BROWSER = fileURLToPath(new URL('src/linkedomModules.browser.ts', import.meta.url));

/**
 * ブラウザで単体で動くライブラリのビルド (npm run build:browser): src/index.ts を、依存パッケージ (pdf-lib・fontkit・xmldom・
 * ハイフネーション・UTIF) まで 1 つにまとめた ES モジュール dist-browser/kumiori.js にする。バンドラーを使わずに
 * <script type="module"> や CDN (jsDelivr・unpkg) から読む人向け。ハイフネーションの辞書と UTIF は、使うときだけ読む別ファイルになる。
 * CGM・EPS・WMF・EMF の処理 (cgm.ts・eps.ts と PostScript の解釈系 ps*.ts・metafile.ts) も、文書にその画像が出てきたときだけ読む
 * 別ファイル (chunks/cgm-….js・eps-….js・metafile-….js) になる (assets.ts・imageInfo.ts の import())。
 * pako も別ファイル (chunks/pako-….js) になるが、pdf-lib (PDFContext・PDFFlateStream)・@pdf-lib/standard-fonts・fontkit が
 * 静的に読むので、kumiori.js から最初に読まれる。別ファイルになるのは、使うときだけ読む UTIF と共有するため。
 * 同じく、本体と、使うときだけ読む CGM・EPS・WMF・EMF の処理が共に使うモジュール (pixels.ts・ccitt.ts・psFilters.ts・strokeOutline.ts など) も、
 * 別ファイル (chunks/pixels-….js など) になって、kumiori.js から最初に読まれる (ライブラリの入口は、出すものを変えないので、
 * 共に使うものを入口のファイルに置いて読ませることができない)
 * linkedom (と、それが使う htmlparser2) は、ブラウザに備わった DOMParser の無い Web Worker の中で HTML・SVG を読むときだけ使うので、
 * 使うときだけ読む別ファイル (chunks/) にする。src/linkedomModules.ts (名前を変数で渡して読む。ライブラリとコマンドの版) を
 * src/linkedomModules.browser.ts (名前を書いたまま読む) に差し替えて取り込む。画面の中で組むときは、このファイルを読まない。
 * 型の宣言は dist-lib/types (build:lib) のものを使う
 */
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    resolve: {
      // src の中から読む './linkedomModules' を、ブラウザ向けの版にする
      alias: [{ find: /^\.\/linkedomModules$/, replacement: LINKEDOM_MODULES_BROWSER }],
    },
    build: {
      outDir: 'dist-browser',
      emptyOutDir: true,
      sourcemap: false,
      lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'kumiori.js' },
      rolldownOptions: {
        output: { chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  }),
);
