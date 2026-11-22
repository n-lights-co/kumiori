#!/usr/bin/env node
/**
 * drawio-hashes — draw.io の配布物 (図形ライブラリの js/stencils.min.js と、img/ の下の画像) の SHA-256 の一覧を作る。
 * 組版の fetchStencils (コマンドは --fetch-drawio-stencils) が、既定の取り先 (draw.io の公開のリポジトリの、版を決めたタグの URL) から
 * 取った中身を、この一覧と照らす (src/drawio/load.ts。合わなければ使わずに警告する)。タグは付け替えられる (取る中身が変わりうる) ので、
 * 一覧を作った時の中身に決める。
 *
 * 使い方:
 *   node scripts/drawio-hashes.mjs [--tag v24.7.5] [--repo https://github.com/jgraph/drawio] [--src <取り出し済みのディレクトリ>] [--out src/drawio/drawioHashes.ts]
 *
 * --src が無ければ、git で、タグのコミットの webapp/img/ と webapp/js/stencils.min.js だけを一時的な場所に取り出す
 * (浅い・部分的な clone と sparse-checkout。全体を取らないので数秒。終わったら消す)。--src を渡すときは、そのタグを取り出した
 * draw.io のリポジトリ (src/main/webapp のあるディレクトリ) を渡す。
 * 中身は git のオブジェクト (コミットの木) から取り出すので、一覧は、タグの指すコミット (一覧の頭に書く) の中身になる。
 *
 * 取り先の版を上げるとき (docs/drawio.md の「取り先の版を上げるとき」):
 *   1. src/drawio/drawioStencil.ts の DRAWIO_STENCILS_URL のタグを書き換える (その版の stencils/・img/ の LICENSE を確かめる)
 *   2. node scripts/drawio-hashes.mjs --tag <新しいタグ> で一覧を作り直す (タグは DRAWIO_STENCILS_URL と同じにする。
 *      test/drawioFetchHash.test.ts が、一覧のタグと DRAWIO_STENCILS_URL のタグが同じことを確かめる)
 *   3. 一覧の頭のコミットが、draw.io のリポジトリのタグのコミットと同じことを確かめ、npm test を通す
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const tag = opt('--tag', 'v24.7.5');
const repo = opt('--repo', 'https://github.com/jgraph/drawio');
const out = opt('--out', 'src/drawio/drawioHashes.ts');
let src = opt('--src');

const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

let tmp;
if (!src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-hashes-'));
  src = path.join(tmp, 'drawio');
  console.error(`${repo} の ${tag} を取り出します: ${src}`);
  git(tmp, 'clone', '-q', '--depth', '1', '--branch', tag, '--filter=blob:none', '--sparse', repo, src);
  git(src, 'sparse-checkout', 'set', '--no-cone', '/src/main/webapp/img/', '/src/main/webapp/js/stencils.min.js');
}
try {
  const commit = git(src, 'rev-parse', 'HEAD');
  const webapp = path.join(src, 'src/main/webapp');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(svg|png|jpe?g)$/i.test(e.name)) files.push(path.relative(webapp, p).split(path.sep).join('/'));
    }
  };
  if (!fs.existsSync(path.join(webapp, 'js/stencils.min.js'))) throw new Error(`${webapp}/js/stencils.min.js がありません`);
  walk(path.join(webapp, 'img'));
  files.unshift('js/stencils.min.js');
  // 1 行に 1 つ: ディレクトリの行 (/ で終わる) の後に、そのディレクトリのファイルの「名前 ハッシュ」(ハッシュは SHA-256 の base64url。43 字)
  const lines = [];
  let dir = '';
  for (const f of files) {
    const k = f.lastIndexOf('/');
    const d = f.slice(0, k + 1);
    if (d !== dir) {
      lines.push(d);
      dir = d;
    }
    const name = f.slice(k + 1);
    if (/[\n\r`$\\]/.test(name)) throw new Error(`一覧に書けない名前です: ${f}`);
    lines.push(`${name} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(webapp, f))).digest('base64url')}`);
  }
  const text = `/**
 * drawioHashes — draw.io の配布物 (${tag}) のファイルの SHA-256 の一覧 (scripts/drawio-hashes.mjs で作ったもの。手で直さない)。
 * 既定の取り先 (DRAWIO_STENCILS_URL) から取った中身を、この一覧と照らす (load.ts)。
 * draw.io のリポジトリ ${repo} の ${tag} (コミット ${commit}) の src/main/webapp の下の、js/stencils.min.js と img/ の下の画像 (${files.length - 1} 個)。
 * 書き方: ディレクトリの行 (/ で終わる) の後に、そのディレクトリのファイルの「名前 ハッシュ」(SHA-256 の base64url)
 */
export const DRAWIO_HASH_TAG = '${tag}';
export const DRAWIO_HASH_COMMIT = '${commit}';
export const DRAWIO_HASHES: string = \`${lines.join('\n')}\`;
`;
  fs.writeFileSync(out, text);
  console.error(`${out} に ${files.length} 個のファイルの SHA-256 を書きました (${tag}・コミット ${commit})`);
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
