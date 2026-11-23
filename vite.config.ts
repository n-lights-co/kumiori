import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { drawioBanner } from './src/drawio/notice';
import { HYPHEN_NOTICES, hyphenPatternOf } from './src/hyphenationNotices';

/**
 * ビルドの出力 (dist/・dist-cli/) に、Kumiori の LICENSE・NOTICE と第三者のソフトウェアの表示を入れる。
 * public/fonts/ に書体のファイルがあれば (出力にコピーされるので) 警告する。ビルドは止めない
 */
/**
 * draw.io の図を描く処理 (draw.io と mxGraph から移したコード) の場所。取り込んだチャンクの先頭に、その著作権表示を書く。
 * Vite のモジュールの id は、Windows でも「/」で区切る (fileURLToPath の道は「\\」で区切る) ので、「/」に揃えて比べる
 */
const toSlash = (p: string) => p.replace(/\\/g, '/');
const DRAWIO_DIR = toSlash(fileURLToPath(new URL('src/drawio/', import.meta.url)));

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

/** pako 1 を自分の依存に持つパッケージ (この中のファイルが読む 'pako' を、1 つの写しに寄せる) */
const PAKO1_USERS = /[\\/]node_modules[\\/](?:pdf-lib|@pdf-lib[\\/][^\\/]+|utif)[\\/]/;
/** 寄せる先: pdf-lib が読む pako */
const PAKO1_FROM = fileURLToPath(new URL('node_modules/pdf-lib/es/index.js', import.meta.url));

/**
 * pdf-lib・@pdf-lib/fontkit・@pdf-lib/standard-fonts・@pdf-lib/upng・utif が読む pako (どれも ^1.0.11) を、1 つの写しにする。
 * Kumiori の本体は pako 3 を使う (src/drawio/inflate.ts) ので、npm は直下に pako 3 を置き、pako 1 をそれぞれの下の node_modules に
 * 1 つずつ置く。そのまま 1 つのファイルにまとめると、同じ版の pako 1 が 5 つ入る (kumiori.js と chunks で 約 230KB 増える)。
 * 寄せる先が pako の 1.x でなければ (置き方が違うときなど)、何もしない。依存を取り込むビルド (画面の dist/ とブラウザ向けの 1 ファイルの dist-browser/) に効く。
 * ライブラリ (dist-lib) とコマンド (dist-cli) は依存を取り込まない (pdf-lib などのファイルを読まない) ので、関わらない
 */
function onePako1(): Plugin {
  let target: string | null | undefined;
  return {
    name: 'kumiori-one-pako1',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source !== 'pako' || !importer || !PAKO1_USERS.test(importer)) return null;
      if (target === undefined) {
        const r = await this.resolve('pako', PAKO1_FROM, { skipSelf: true });
        target = null;
        if (r && !r.external) {
          // 解決したファイルから上へたどって、pako の package.json の版を見る
          for (let d = dirname(r.id); d !== dirname(d); d = dirname(d)) {
            try {
              const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { name?: string; version?: string };
              if (pkg.name === 'pako') {
                if (/^1\./.test(pkg.version ?? '')) target = r.id;
                break;
              }
            } catch {
              // package.json の無いディレクトリ
            }
          }
        }
      }
      return target ?? null;
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

/** チャンクが取り込んだ分綴のパターンの注記 (取り込んでいなければ空) */
function hyphenNotice(moduleIds: readonly string[]): string {
  const out: string[] = [];
  for (const id of moduleIds) {
    const name = hyphenPatternOf(id);
    const lines = name ? HYPHEN_NOTICES[name] : undefined;
    if (name && !lines) throw new Error(`分綴のパターン hyphen/patterns/${name}.js の注記 (src/hyphenationNotices.ts の HYPHEN_NOTICES) がありません。ライセンスを確かめて足してください`);
    if (lines) out.push(['/*!', ...lines.map((l) => ` * ${l}`), ' * See THIRD_PARTY_NOTICES.md, section 1.4. */'].join('\n'));
  }
  return out.join('\n');
}

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
  plugins: [onePako1(), licenseFiles(), bannerFirst()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rolldownOptions: {
      output: {
        // 分綴のパターンを取り込んだチャンクには、Kumiori の表示の後ろに、そのパターンの著作権・ライセンスの注記を足す
        postBanner: (chunk: { moduleIds: readonly string[] }) => {
          // draw.io の図を描く処理 (src/drawio/ の、draw.io と mxGraph から移したコード) を取り込んだチャンクには、その著作権表示も足す
          const extra = [hyphenNotice(chunk.moduleIds), ...(chunk.moduleIds.some((id) => toSlash(id).startsWith(DRAWIO_DIR) && !/[\\/](index|sniff|options|messages|nodeFiles)\.ts$/.test(id)) ? [drawioBanner()] : [])].filter(Boolean);
          return [banner, ...extra].join('\n');
        },
      },
    },
  },
});
