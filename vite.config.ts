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

/** hyph-utf8 のパターンのファイルの場所 (分綴のパターンの注記に書く、元のファイルの入手先) */
const HYPH_UTF8 = 'https://ctan.org/pkg/hyph-utf8 (tex/generic/hyph-utf8/patterns/tex/)';
const MIT_TEXT = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
  'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
  'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
  'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of',
  'the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
  'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,',
  'TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
];
/**
 * 分綴のパターン (npm の hyphen の patterns/<名前>.js。hyph-utf8 の hyph-<名前>.tex を JavaScript に変換したもの) を取り込んだ
 * チャンクの先頭に足す注記: パターンごとの著作権の表示と、ライセンスが求める表示。全文と上流の冒頭の表示は THIRD_PARTY_NOTICES.md §1.4。
 *  - MIT (en-gb・la・uk・el-monoton): 著作権の表示と許諾の表示を、すべての複製に含める
 *  - en-us: 「著作権の表示とこの表示を残せば、変更の有無によらず複製・配布してよい」という表示を残す
 *  - LPPL 1.3c (ru。上流は 1.2 以降): 変更したもの (Derived Work) を配る条件 (第 6 項) の b: 変更の内容を目立つように書く、
 *    c: 元の作者がサポートするかのように書かない、d: 元のファイルを入手するのに十分な情報を付ける。a (LaTeX などの上で、元の部品の
 *    代わりに使える部品が、変更したものと名乗ること) は、JavaScript に変換したものは元の部品の代わりにならないので当たらない
 */
const HYPHEN_NOTICES: Record<string, string[]> = {
  'en-us': [
    'Hyphenation patterns for American English (hyph-en-us.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken',
    'Copying and distribution of this file, with or without modification, are permitted in any medium without royalty',
    'provided the copyright notice and this notice are preserved.',
  ],
  'en-gb': [
    'Hyphenation patterns for British English (hyph-en-gb.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1992, 1996, 2005, 2016 Dominik Wujastyk, Graham Toal',
    'MIT License.',
    ...MIT_TEXT,
  ],
  la: [
    'Hyphenation patterns for modern and medieval Latin (hyph-la.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1999-2016 Claudio Beccari',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  uk: [
    'Hyphenation patterns for Ukrainian (hyph-uk.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1998-2001 Maksym Polyakov',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  'el-monoton': [
    'Hyphenation patterns for Modern Greek, monotonic (hyph-el-monoton.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2008-2011 Dimitrios Filippou',
    'Available under the LPPL or the MIT License; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  ru: [
    'Hyphenation patterns for Russian. Copyright (C) 1999-2003 Alexander I. Lebedev.',
    'License: LaTeX Project Public License (LPPL), version 1.2 or later; distributed here under LPPL 1.3c',
    '(https://latex-project.org/lppl/lppl-1-3c.txt).',
    'THIS IS A MODIFIED VERSION (a Derived Work under the LPPL), NOT THE ORIGINAL FILE. Nature of the changes:',
    'the patterns of hyph-ru.tex (part of the hyph-utf8 package) were converted from the TeX \\patterns{...} list into',
    'JavaScript data (arrays encoding the same patterns) by the npm package "hyphen" (its file patterns/ru.js), and that',
    'file was bundled (and, in some builds, minified) into this chunk by Kumiori. The TeX comments of the original are not included.',
    'The pattern data itself was not edited by Kumiori.',
    `The complete, unmodified original (hyph-ru.tex) can be obtained from the hyph-utf8 package: ${HYPH_UTF8}`,
    'or https://github.com/hyphenation/tex-hyphen (hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-ru.tex).',
    'The author and maintainers of the original patterns do not provide any support for this modified version;',
    'report problems to the Kumiori project.',
  ],
};

/** チャンクが取り込んだ分綴のパターンの注記 (取り込んでいなければ空) */
function hyphenNotice(moduleIds: readonly string[]): string {
  const out: string[] = [];
  for (const id of moduleIds) {
    const m = /[\\/]hyphen[\\/]patterns[\\/]([a-z-]+)\.js$/.exec(id.split('?')[0]);
    const lines = m ? HYPHEN_NOTICES[m[1]] : undefined;
    if (m && !lines) throw new Error(`分綴のパターン hyphen/patterns/${m[1]}.js の注記 (vite.config.ts の HYPHEN_NOTICES) がありません。ライセンスを確かめて足してください`);
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
  plugins: [licenseFiles(), bannerFirst()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rolldownOptions: {
      output: {
        // 分綴のパターンを取り込んだチャンクには、Kumiori の表示の後ろに、そのパターンの著作権・ライセンスの注記を足す
        postBanner: (chunk: { moduleIds: readonly string[] }) => {
          const extra = hyphenNotice(chunk.moduleIds);
          return extra ? `${banner}\n${extra}` : banner;
        },
      },
    },
  },
});
