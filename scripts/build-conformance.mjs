#!/usr/bin/env node
/**
 * 対応仕様説明書を Kumiori で組んで PDF にする。
 *   docs/conformance/fo/kumiori-xsl-fo.fo        → docs/conformance/out/kumiori-xsl-fo.pdf
 *   docs/conformance/html/kumiori-html-css.html  → docs/conformance/out/kumiori-html-css.pdf
 *   英語版 (kumiori-xsl-fo.en.fo・kumiori-html-css.en.html) があれば、同じく out/ の .en.pdf にする
 * 組版例の後にコードの表示を差し込んだ文書を docs/conformance/out/ に書き、Kumiori のコマンド (dist-cli) で組む。
 * dist-cli が無ければ先に作る (npm run build:cli)。
 * 書体: 本文は Kumiori の既定の書体 (Noto Serif JP・Noto Sans JP など。コマンドが、書体のキャッシュか Google Fonts の配信元から読む)。
 * 言語ごとの見本・絵文字の見本・可変フォントの見本は、既定の書体に無い字・機能を使うので、scripts/conformance-fonts.mjs の一覧の書体で組む。
 * 書体のファイルはリポジトリに入れないので、ここで配信元 (fonts.gstatic.com の、版の付いた URL) から置き場に取得する (無いものだけ。ネットワークが要る)。
 * 置き場は、環境変数 KUMIORI_FONT_CACHE (コマンドの書体のキャッシュと同じ場所) か、無ければ .cache/fonts (テストと同じ場所)。
 *  - HTML と CSS 編: 見本の @font-face は配信元の URL を指す。取得したファイルを、組む文書の隣 (out/html/fonts/) に URL の末尾の名前で置くので、
 *    コマンドは、ネットワークへ取りに行かずに、そのファイルを使う (Kumiori は、@font-face の url() を、一緒に渡したファイルの名前でも突き合わせる)
 *  - XSL-FO 編: 一覧の fo: true の書体を、コマンドの --font で渡す
 * 取得できない書体があれば、組まずに誤りで終わる (字の出ない説明書を、気付かずに作らない)。コマンドが警告を出したときも、誤りで終わる。
 * 奥付の印 (XSL-FO は <?kumiori-version?>、HTML は <!--kumiori-version-->) は、組む Kumiori の版 (package.json の version) にする。
 *
 * 使い方: npm run docs:conformance
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand } from './conformance-lib.mjs';
import { CONFORMANCE_FONTS, ensureConformanceFonts, fontUrlsIn, urlBasename } from './conformance-fonts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs', 'conformance');
const out = path.join(docs, 'out');
const cli = path.join(root, 'dist-cli', 'cli.js');
// 奥付の「組版」の欄に書く、組んだ Kumiori の版 (package.json の version。リリースのワークフローはタグのコミットで組むので、その版になる)
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versionMark = { fo: '<?kumiori-version?>', html: '<!--kumiori-version-->' };

if (!fs.existsSync(cli)) execFileSync('npm', ['run', 'build:cli'], { cwd: root, stdio: 'inherit' });

const jobs = [
  { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.fo', extra: [], args: ['--compat', 'spec'] },
  { kind: 'html', dir: 'html', file: 'kumiori-html-css.html', extra: ['kumiori-html-css.css'], args: [] },
  // 英語版 (同じ見本。本文を英語にしたもの)
  { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.en.fo', extra: [], args: ['--compat', 'spec', '--lang', 'en'] },
  { kind: 'html', dir: 'html', file: 'kumiori-html-css.en.html', extra: ['kumiori-html-css.css'], args: ['--lang', 'en'] },
].filter((j) => fs.existsSync(path.join(docs, j.dir, j.file)));

// 見本の書体を置き場に用意する (URL → 置き場のファイル)
const fontDir = process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');
const fontFiles = await ensureConformanceFonts(fontDir);
const foFonts = CONFORMANCE_FONTS.filter((f) => f.fo).flatMap((f) => ['--font', fontFiles.get(f.url)]);

for (const j of jobs) {
  const work = path.join(out, j.dir);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const src = fs.readFileSync(path.join(docs, j.dir, j.file), 'utf8');
  fs.writeFileSync(path.join(work, j.file), expand(src, j.kind).replaceAll(versionMark[j.kind], version));
  for (const f of j.extra) fs.copyFileSync(path.join(docs, j.dir, f), path.join(work, f));
  fs.cpSync(path.join(docs, j.dir, 'images'), path.join(work, 'images'), { recursive: true });
  if (j.kind === 'html') {
    // 見本の @font-face が指す配信元の書体を、文書の隣に URL の末尾の名前で置く
    fs.mkdirSync(path.join(work, 'fonts'));
    for (const url of fontUrlsIn(src)) {
      const file = fontFiles.get(url);
      if (!file) throw new Error(`${j.file}: 書体の URL が scripts/conformance-fonts.mjs の一覧にありません: ${url}`);
      fs.copyFileSync(file, path.join(work, 'fonts', urlBasename(url)));
    }
  }
  const pdf = path.join(out, j.file.replace(/\.\w+$/, '.pdf'));
  // コマンドの報告 (ページ数と、あれば警告) をそのまま出し、警告があれば誤りにする (取れない書体・読めない画像などを見逃さない)
  const r = spawnSync('node', [cli, path.join(work, j.file), '-o', pdf, ...j.args, ...(j.kind === 'fo' ? foFonts : [])], { cwd: root, encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`${j.file}: 組めませんでした`);
  if (/警告:|warning:/.test(r.stderr)) throw new Error(`${j.file}: 警告が出ました`);
}
