import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, minifySync, type Plugin } from 'vite';
import { hyphenPatternOf } from './src/hyphenationNotices';
import base from './vite.config';

const LINKEDOM_MODULES_BROWSER = fileURLToPath(new URL('src/linkedomModules.browser.ts', import.meta.url));

/** 縮めない分綴のパターン: hu (MPL 1.1)。ソースの形 (MPL 1.1 §1.11) のまま配る (src/hyphenationNotices.ts の hu の注記) */
const UNMINIFIED_HYPHEN_PATTERNS = new Set(['hu']);

/**
 * 分綴のパターン (hyphen/patterns/<名前>.js) を取り込んだチャンクを縮める (空白を除く・名前を短くする)。パターンは大きい (ドイツ語は 1 つで 750KB ほど) ので、
 * npm の配布物を小さくするため。このビルドはほかのチャンクを縮めない (読める形のまま配る) ので、パターンのチャンクだけにする。
 * Vite が renderChunk でコードを書き直す (整形し直す) ので、書き出す前 (generateBundle) に縮める。先頭の表示 (Kumiori の表示と、
 * パターンの著作権・ライセンスの表示。postBanner が足したもの) は縮めずにそのまま残す
 */
function minifyHyphenPatterns(): Plugin {
  return {
    name: 'kumiori-minify-hyphen-patterns',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const names = chunk.moduleIds.map((id) => hyphenPatternOf(id)).filter((n): n is string => !!n);
        if (!names.length || names.some((n) => UNMINIFIED_HYPHEN_PATTERNS.has(n))) continue;
        const head = /^(?:\s*\/\*![\s\S]*?\*\/)+\s*/.exec(chunk.code)?.[0] ?? '';
        const r = minifySync(chunk.fileName, chunk.code.slice(head.length), { module: true, compress: true, mangle: true });
        if (r.errors.length) throw new Error(`分綴のパターンのチャンク ${chunk.fileName} を縮められません: ${r.errors.map((e) => e.message).join('; ')}`);
        chunk.code = `${head.trimEnd()}\n${r.code}`;
      }
    },
  };
}

/**
 * ブラウザで単体で動くライブラリのビルド (npm run build:browser): src/index.ts を、依存パッケージ (pdf-lib・fontkit・xmldom・
 * ハイフネーション・UTIF) まで 1 つにまとめた ES モジュール dist-browser/kumiori.js にする。バンドラーを使わずに
 * <script type="module"> や CDN (jsDelivr・unpkg) から読む人向け。ハイフネーションの辞書と UTIF は、使うときだけ読む別ファイルになる。
 * CGM・EPS・WMF・EMF の処理 (cgm.ts・eps.ts と PostScript の解釈系 ps*.ts・metafile.ts) も、文書にその画像が出てきたときだけ読む
 * 別ファイル (chunks/cgm-….js・eps-….js・metafile-….js) になる (assets.ts・imageInfo.ts の import())。
 * pako 1 (pdf-lib などの依存) も別ファイル (chunks/pako-….js) になるが、pdf-lib (PDFContext・PDFFlateStream)・@pdf-lib/standard-fonts・fontkit が
 * 静的に読むので、kumiori.js から最初に読まれる。別ファイルになるのは、使うときだけ読む UTIF と共有するため。
 * 本体の使う pako 3 (draw.io の圧縮を解く) は、draw.io の図を読む別ファイルに入る (pako 1 の写しは、vite.config.ts の onePako1 で 1 つにする)。
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
    plugins: [minifyHyphenPatterns()],
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
