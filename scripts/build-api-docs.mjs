/**
 * build-api-docs — API の説明書 (一覧の頁) を、型の宣言のコメントから作る (npm run docs:api)。
 *
 *   node scripts/build-api-docs.mjs [--out <ディレクトリ>]   (既定の出力は dist/api。GitHub Pages の画面 (dist) の下の /api/ に置く)
 *
 * 公開の API (src/index.ts・src/node.ts から出すもの) を TypeDoc で HTML にする。設定は tools/api-docs/typedoc.json、一覧の頁の初めの文は
 * tools/api-docs/index.md。説明は、型の宣言のコメント (配る型の宣言 dist-lib/types にも入るもの) をそのまま使う。
 *
 * TypeDoc とそれが使う TypeScript は、リポジトリの直下の依存と分けて、tools/api-docs の package.json・package-lock.json で入れる。
 * TypeDoc (0.28) は TypeScript 6.0 までにしか対応しておらず、直下の TypeScript 7 と同じ package.json には入れられないため
 * (npm が依存の食い違いとして断る)。このスクリプトは、tools/api-docs に依存が入っていない (か、package-lock.json と版が違う) ときは、
 * そこで npm ci をしてから作る。直下の npm ci では入らず、npm のパッケージ (package.json の files) にも入らない。
 *
 * TypeDoc の警告 (コメントの中の知らないタグ・公開の型が参照しているのに出していない型など) は誤りにする (typedoc.json の
 * treatWarningsAsErrors)。公開の API の型を足したら、それが参照する型も src/index.ts から出す。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolDir = path.join(root, 'tools', 'api-docs');

let out = path.join(root, 'dist', 'api');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out' && argv[i + 1]) out = path.resolve(argv[++i]);
  else {
    console.error('使い方: node scripts/build-api-docs.mjs [--out <ディレクトリ>]');
    process.exit(2);
  }
}

/** package-lock.json の版と、入っている版が合うか (TypeDoc と TypeScript) */
function installed() {
  const lock = JSON.parse(fs.readFileSync(path.join(toolDir, 'package-lock.json'), 'utf8'));
  return ['typedoc', 'typescript'].every((name) => {
    const want = lock.packages?.[`node_modules/${name}`]?.version;
    const file = path.join(toolDir, 'node_modules', name, 'package.json');
    return want && fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).version === want;
  });
}

/**
 * npm の呼び方 (scripts/ci-local.mjs と同じ): npm run で走らせたときは、npm の本体 (npm_execpath) を、いま動いている Node で直に動かす
 * (shell を通さない)。直に走らせたときは PATH の npm を呼ぶ (Windows の npm.cmd は shell を通す。引数に空白は無い)
 */
const npmCli = process.env.npm_execpath && /(?:^|[\\/])npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : undefined;
const npm = (args, opts) => (npmCli ? spawnSync(process.execPath, [npmCli, ...args], opts) : spawnSync('npm', args, { ...opts, shell: process.platform === 'win32' }));

if (!installed()) {
  console.log('tools/api-docs に TypeDoc を入れます (npm ci)');
  const r = npm(['ci', '--no-audit', '--no-fund'], { cwd: toolDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const typedoc = path.join(toolDir, 'node_modules', 'typedoc', 'bin', 'typedoc');
const r = spawnSync(process.execPath, [typedoc, '--options', path.join(toolDir, 'typedoc.json'), '--out', out], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`API の説明書を ${path.relative(root, out) || out} に作りました`);
