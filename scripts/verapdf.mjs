#!/usr/bin/env node
/**
 * verapdf — 書き出した PDF を veraPDF (https://verapdf.org/ 。PDF/UA・PDF/A の検査をする無償のソフト) で検査する。
 * タグ付き PDF (--tagged) の確かめに使う (PDF/UA-1 の検査。--flavour ua1 が既定)。
 *
 * 使い方:
 *   node scripts/verapdf.mjs [--flavour ua1|ua2|1a|1b|2a|2b|2u|3a|3b|3u|4|4f|4e] [--dir .cache/verapdf] [--raw] <PDF>...
 *   node scripts/verapdf.mjs --fetch-only [--dir .cache/verapdf]   veraPDF を取って置くだけ (検査しない)
 *   (この開発環境のようにプロキシを通すときは NODE_USE_ENV_PROXY=1 を付ける。Node 22.21 から)
 *
 * veraPDF の取り方 (Maven Central から取り、SHA-256 と比べて .cache/verapdf に置く) と動かし方は scripts/verapdf-lib.mjs にある。
 * 動かすには Java が要る (PATH の java。Java 21 で確かめた)。
 *
 * 結果は、PDF ごとに、合うか (compliant) と、落ちた規則 (規格の節・検査の番号・落ちた数・veraPDF の説明) を出す。
 * --raw は、veraPDF の文の報告 (--format text -v) をそのまま出す。どれかの PDF が合わないか、渡したファイル (ディレクトリなら、その中の 1 つ以上) を検査できなければ、終わりの番号は 1 (動かせなければ 2)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchJars, jarDir, runVerapdf, spawnVerapdf, verapdfReady, VERSION } from './verapdf-lib.mjs';

const FLAVOURS = new Set(['ua1', 'ua2', '1a', '1b', '2a', '2b', '2u', '3a', '3b', '3u', '4', '4f', '4e']);

const args = { flavour: 'ua1', dir: '.cache/verapdf', raw: false, fetchOnly: false, files: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--flavour' || a === '--dir') {
    const v = process.argv[++i];
    if (v === undefined) fail(`${a} の値がありません`);
    args[a.slice(2)] = v;
  } else if (a === '--raw') args.raw = true;
  else if (a === '--fetch-only') args.fetchOnly = true;
  else if (a === '-h' || a === '--help') {
    console.log('使い方: node scripts/verapdf.mjs [--flavour ua1] [--dir .cache/verapdf] [--raw] <PDF>...\n        node scripts/verapdf.mjs --fetch-only');
    process.exit(0);
  } else if (a.startsWith('-')) fail(`知らない選択肢です: ${a}`);
  else args.files.push(a);
}
if (!FLAVOURS.has(args.flavour)) fail(`--flavour の値 "${args.flavour}" は使えません (${[...FLAVOURS].join('・')})`);
if (!args.fetchOnly && !args.files.length) fail('検査する PDF を渡してください (node scripts/verapdf.mjs <PDF>...)');
for (const f of args.files) if (!fs.existsSync(f)) fail(`PDF がありません: ${f}`);

function fail(m) {
  console.error(m);
  process.exit(2);
}

const dir = jarDir(args.dir);
try {
  await fetchJars(dir);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (args.fetchOnly) {
  console.error(`veraPDF ${VERSION} を ${dir} に置きました`);
  process.exit(0);
}

if (!verapdfReady(args.dir)) fail('java が見つかりません。veraPDF を動かすには Java が要ります (Java 21 で確かめた)');

if (args.raw) {
  const r = spawnVerapdf(args.dir, args.flavour, 'text', args.files);
  process.stdout.write(r.stdout);
  if (r.error) fail(String(r.error));
  // 合うのは、どの PDF にも PASS の行があるときだけ (検査できなかった PDF (PDF として読めないなど) は PASS・FAIL の行が無く、
  // 前は終わりの番号が 0 になっていた。報告の形の --raw でないときと同じく 1 にする)
  // 数ではなく、渡したものごとに見る (同じ PDF を 2 度渡しても、ディレクトリを渡しても数がずれないように): ファイルはその道の PASS の行、
  // ディレクトリはその中の道の PASS か FAIL の行が 1 つ以上あること
  const results = [...r.stdout.matchAll(/^(PASS|FAIL) (.+) \S+$/gm)].map((m) => ({ ok: m[1] === 'PASS', file: path.resolve(m[2]) }));
  const unchecked = [...new Set(args.files)].filter((f) => {
    const p = path.resolve(f);
    let dir = false;
    try {
      dir = fs.statSync(p).isDirectory();
    } catch {
      // 無いものは、検査できなかったもの
    }
    return dir ? !results.some((x) => x.file.startsWith(p + path.sep)) : !results.some((x) => x.file === p);
  });
  // 読めなかった PDF の行 (… could not be parsed.) も、検査できなかったもの (ディレクトリの中の壊れた PDF は、ほかが PASS でも落とす)
  const unparsed = [...r.stdout.matchAll(/^(.+?) (?:does not appear to be a valid PDF file and )?could not be parsed\.?$/gm)].map((m) => m[1]);
  if (unchecked.length || unparsed.length) console.error(`検査できなかった PDF があります: ${[...unchecked, ...unparsed].join(', ')}`);
  process.exit(results.some((x) => !x.ok) || unchecked.length || unparsed.length ? 1 : 0);
}

let bad = false;
let results;
try {
  results = runVerapdf(args.dir, args.flavour, args.files);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
for (const { name, compliant, rules, error } of results) {
  if (compliant === undefined) {
    bad = true;
    console.log(`× ${name}: 検査できませんでした (${error})`);
    continue;
  }
  if (compliant) {
    console.log(`○ ${name}: ${args.flavour} に合います`);
    continue;
  }
  bad = true;
  console.log(`× ${name}: ${args.flavour} に合いません (落ちた規則 ${rules.length})`);
  for (const { clause, test, failed, description } of rules) console.log(`  ${clause}-${test} (${failed} か所): ${description}`);
}
process.exit(bad ? 1 : 0);
