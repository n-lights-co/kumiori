import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * ビルドの出力 (dist/・dist-cli/) に、Kumiori の LICENSE・NOTICE と第三者のソフトウェアの表示を入れる。
 * public/fonts/ に書体のファイルがあれば (出力にコピーされるので) 警告する。ビルドは止めない
 */
function licenseFiles(): Plugin {
  return {
    name: 'kumiori-license-files',
    apply: 'build',
    buildStart() {
      let fonts: string[] = [];
      try {
        fonts = readdirSync(new URL('public/fonts/', import.meta.url)).filter((f) => /\.(ttf|otf|ttc|woff2?)$/i.test(f));
      } catch {
        // public/fonts/ が無ければ何もしない
      }
      if (fonts.length) this.warn(`書体のファイルが public/fonts/ にあります (${fonts.join(', ')})。配布物に含めない場合は取り除いてください`);
    },
    generateBundle(_o, bundle) {
      for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(new URL(file, import.meta.url), 'utf8') });
      }
      // Node のコマンド (npm run build:cli の dist-cli/cli.js) は、package.json の bin から直接動くように shebang を付ける
      const cli = bundle['cli.js'];
      if (cli && cli.type === 'chunk' && cli.isEntry && !cli.code.startsWith('#!')) cli.code = `#!/usr/bin/env node\n${cli.code}`;
    },
  };
}

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * 出力する JS のファイルの先頭に付ける表示。ブラウザ向けの 1 ファイル (dist-browser/kumiori.js) とそのチャンクは、
 * pdf-lib・fontkit・pako などを取り込んでいて、CDN からファイル 1 つだけで配られることもあるので、
 * Kumiori のライセンスと、取り込んだ第三者のソフトウェアの表示 (THIRD_PARTY_NOTICES.md) の場所をファイルの中に書いておく。
 * 縮めた後に付ける (postBanner) ので、縮めるビルド (dist/) でも消えない
 */
const banner = [
  `/*! Kumiori (組み織り) ${version} | Apache License 2.0 | Copyright 2026 Northern Lights Co.`,
  ` * Third-party notices (第三者のソフトウェアの表示): THIRD_PARTY_NOTICES.md`,
  ` * https://cdn.jsdelivr.net/npm/kumiori@${version}/THIRD_PARTY_NOTICES.md */`,
].join('\n');

/**
 * 画面のビルド (dist/) の入口のチャンクには、Vite が表示の後から先頭に `const __vite__mapDeps=…` を足すので、表示が先頭から外れる。
 * 書き出した後のファイルを見て、先頭に表示が無ければ先頭へ移す (このチャンクはソースマップを出さないので、行がずれても困らない)
 */
function bannerFirst(): Plugin {
  return {
    name: 'kumiori-banner-first',
    apply: 'build',
    writeBundle(options, bundle) {
      if (!options.dir) return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.map) continue;
        const file = join(options.dir, chunk.fileName);
        const code = readFileSync(file, 'utf8');
        const shebang = code.match(/^#![^\n]*\n/)?.[0] ?? '';
        const rest = code.slice(shebang.length);
        if (rest.startsWith(banner)) continue;
        writeFileSync(file, shebang + banner + '\n' + rest.replace(banner + '\n', ''));
      }
    },
  };
}

export default defineConfig({
  plugins: [licenseFiles(), bannerFirst()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rolldownOptions: { output: { postBanner: banner } } },
});
