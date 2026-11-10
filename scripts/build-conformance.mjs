#!/usr/bin/env node
/**
 * 対応仕様説明書を Kumiori で組んで PDF にする。
 *   docs/conformance/fo/kumiori-xsl-fo.fo        → docs/conformance/out/kumiori-xsl-fo.pdf
 *   docs/conformance/html/kumiori-html-css.html  → docs/conformance/out/kumiori-html-css.pdf
 *   英語版 (kumiori-xsl-fo.en.fo・kumiori-html-css.en.html) があれば、同じく out/ の .en.pdf にする
 * 組版例の後にコードの表示を差し込んだ文書を docs/conformance/out/ に書き、Kumiori のコマンド (dist-cli) で組む。
 * dist-cli が無ければ先に作る (npm run build:cli)。書体は Kumiori の既定 (Noto Serif JP・Noto Sans JP など)。
 * 奥付の印 (XSL-FO は <?kumiori-version?>、HTML は <!--kumiori-version-->) は、組む Kumiori の版 (package.json の version) にする。
 *
 * 使い方: npm run docs:conformance
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand } from './conformance-lib.mjs';

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

for (const j of jobs) {
  const work = path.join(out, j.dir);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const src = fs.readFileSync(path.join(docs, j.dir, j.file), 'utf8');
  fs.writeFileSync(path.join(work, j.file), expand(src, j.kind).replaceAll(versionMark[j.kind], version));
  for (const f of j.extra) fs.copyFileSync(path.join(docs, j.dir, f), path.join(work, f));
  fs.cpSync(path.join(docs, j.dir, 'images'), path.join(work, 'images'), { recursive: true });
  const pdf = path.join(out, j.file.replace(/\.\w+$/, '.pdf'));
  execFileSync('node', [cli, path.join(work, j.file), '-o', pdf, ...j.args], { cwd: root, stdio: 'inherit' });
}
