import { readdirSync, readFileSync } from 'node:fs';
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

export default defineConfig({
  plugins: [licenseFiles()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
