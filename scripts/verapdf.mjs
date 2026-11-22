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
 * veraPDF は、Maven Central (repo1.maven.org) から、コマンドの部品 (org.verapdf.apps:greenfield-apps) と、それが使う jar を取って
 * <dir>/<版>/ に置く (.cache は .gitignore 済み。リポジトリにも配る物にも入れない)。jar ごとに、ここに書いた SHA-256 と比べ、
 * 合わなければ消して止まる (配布元の差し替え・壊れたファイルを動かさない)。置いてあれば取り直さない。
 * jar の並びは、Maven で greenfield-apps の依存を集めたもの (mvn dependency:copy-dependencies。2026-11-19)。版を上げるときは、
 * 同じ手順で集め直し、座標と SHA-256 を書き直す。
 * 動かすには Java が要る (PATH の java。Java 21 で確かめた)。
 *
 * 結果は、PDF ごとに、合うか (compliant) と、落ちた規則 (規格の節・検査の番号・落ちた数・veraPDF の説明) を出す。
 * --raw は、veraPDF の文の報告 (--format text -v) をそのまま出す。どれかの PDF が合わないか、渡したファイル (ディレクトリなら、その中の 1 つ以上) を検査できなければ、終わりの番号は 1 (動かせなければ 2)。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = '1.28.2';
const MAVEN = 'https://repo1.maven.org/maven2';
/** [groupId, artifactId, 版, SHA-256] */
const JARS = [
  ['org.verapdf.apps', 'greenfield-apps', VERSION, '687d4d8bcfec48c9f7e931cf78ed061f1eeccfba55d4cdc000ba9b4d8aa46ce6'],
  ['org.verapdf.apps', 'gui', VERSION, 'b3382c806dfc11f780cdc51d398bdacc7cc23c0ba1899d687ad26dbef533c114'],
  ['org.verapdf', 'core', VERSION, '847b0d5ac9effa76d310db92dfb8e11a67c94f70271f54971fcbc75a358abf01'],
  ['org.verapdf', 'feature-reporting', VERSION, 'b11601c1644fc06ac09190632b7fc172946a707b55e976acbe804a25ab8500be'],
  ['org.verapdf', 'metadata-fixer', VERSION, '7a005db32a5781ea34502c0c4d99aeb0f97a742c7d6fd80756fd10e8a987862f'],
  ['org.verapdf', 'parser', VERSION, 'b51d39394b2d24f1e0303a0cffbaffc238604d4bb6010ea90a85150b4a2659f6'],
  ['org.verapdf', 'pdf-model', VERSION, '7f4695701faefaa9efd3a39265f0020dc622edbc66d528e96118c392c03ec4d2'],
  ['org.verapdf', 'validation-model', VERSION, '8d5891939a8302a9b5b1b4791fb63328ad5edb51728866e935bf89b3c6f469df'],
  ['org.verapdf', 'verapdf-xmp-core', VERSION, 'e7b827185f0480cc1a4347522eaea51a826e0177689d623b39646a02edfab421'],
  ['com.fasterxml.jackson.core', 'jackson-annotations', '2.15.0', '91adcd3dcf5fd9a16499934e7536a23d456692a0093e3d4fd52f138c3936348c'],
  ['com.fasterxml.jackson.core', 'jackson-core', '2.15.0', '5b483f68fa9dd6aa37da37d1f79dd5c4b9464238f4f0660a242cb6b5c724950c'],
  ['com.fasterxml.jackson.core', 'jackson-databind', '2.15.0', '00c5a5d5ae71ac8e8d5b8da606841e2251c806355939cb5d51c4cdc6b644a0dc'],
  ['javax.activation', 'javax.activation-api', '1.2.0', '43fdef0b5b6ceb31b0424b208b930c74ab58fac2ceeb7b3f6fd3aeb8b5ca4393'],
  ['javax.xml.bind', 'jaxb-api', '2.3.1', '88b955a0df57880a26a74708bc34f74dcaf8ebf4e78843a28b50eae945732b06'],
  ['com.sun.xml.bind', 'jaxb-core', '2.3.0.1', 'd2ecba63615f317a11fb55c6468f6a9480f6411c10951d9881bafd9a9a8d0467'],
  ['com.sun.xml.bind', 'jaxb-impl', '2.3.2', 'b3a3d3aeaa5503cadc24dca9539b87efcd7bc3bd8c48018887a1489f2a77bdc0'],
  ['com.beust', 'jcommander', '1.81', '9d8b42979c99f3daa99102fe9ba1fb25f52226cb48cf58bc18acb93132e41a05'],
  ['org.mozilla', 'rhino', '1.7.13', '931dda33789d8e004ff5b5478ee3d6d224305de330c48266df7c3e49d52fc606'],
  ['net.java.dev.stax-utils', 'stax-utils', '20070216', '7c7fd0892cb3362ed2e43ce2f76c8f18f2d7ff1d371ed7490775b7368f3fee9a'],
];
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

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** jar を取って置く (置いてあり、SHA-256 が合えば取り直さない) */
async function fetchJars(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [g, a, v, hash] of JARS) {
    const file = path.join(dir, `${a}-${v}.jar`);
    if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash) continue;
    const url = `${MAVEN}/${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}.jar`;
    // 一時的な誤り (429 Too Many Requests・5xx・つながらない) は、間を空けて取り直す (4 回まで)
    let r;
    let why = '';
    for (let k = 0; k < 4; k++) {
      if (k) await new Promise((ok) => setTimeout(ok, 2000 * 2 ** (k - 1)));
      try {
        r = await fetch(url);
      } catch (e) {
        r = undefined;
        why = String(e?.cause?.message ?? e?.message ?? e);
        continue;
      }
      if (r.ok || !(r.status === 429 || r.status >= 500)) break;
      why = String(r.status);
    }
    if (!r) fail(`取れません: ${url}\n  ${why}\n  (プロキシを通す環境では NODE_USE_ENV_PROXY=1 を付けてください。repo1.maven.org へのネットワークが要ります)`);
    if (!r.ok) fail(`取れません: ${url} (${r.status})`);
    const b = Buffer.from(await r.arrayBuffer());
    if (sha256(b) !== hash) fail(`SHA-256 が合いません: ${url}\n  期待 ${hash}\n  実際 ${sha256(b)}\n  (取ったものは置きません)`);
    fs.writeFileSync(file, b);
    console.error(`取りました: ${a}-${v}.jar (${(b.length / 1024).toFixed(0)}KB)`);
  }
}

const dir = path.resolve(args.dir, VERSION);
await fetchJars(dir);
if (args.fetchOnly) {
  console.error(`veraPDF ${VERSION} を ${dir} に置きました`);
  process.exit(0);
}

const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
if (java.error || java.status !== 0) fail('java が見つかりません。veraPDF を動かすには Java が要ります (Java 21 で確かめた)');

const classPath = `${dir}${path.sep}*`;
const run = (format) =>
  spawnSync('java', ['-cp', classPath, 'org.verapdf.apps.GreenfieldCliWrapper', '-f', args.flavour, '--format', format, ...(format === 'text' ? ['-v'] : []), ...args.files], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });

if (args.raw) {
  const r = run('text');
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

const r = run('mrr');
if (r.error || !/<report/.test(r.stdout)) fail(`veraPDF を動かせませんでした\n${(r.stderr ?? '').split('\n').filter((l) => !/^Picked up /.test(l)).join('\n')}`);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
let bad = false;
for (const job of r.stdout.split('<job>').slice(1)) {
  const name = decode(/<name>([^<]*)<\/name>/.exec(job)?.[1] ?? '?');
  const rep = /<validationReport [^>]*isCompliant="(true|false)"[^>]*>/.exec(job);
  const ex = /<taskException[^>]*>[\s\S]*?<exceptionMessage>([^<]*)/.exec(job);
  if (!rep) {
    bad = true;
    console.log(`× ${name}: 検査できませんでした${ex ? ` (${decode(ex[1])})` : ''}`);
    continue;
  }
  const rules = [...job.matchAll(/<rule [^>]*clause="([^"]*)" testNumber="([^"]*)" status="failed" failedChecks="(\d+)"[^>]*>\s*<description>([^<]*)<\/description>/g)];
  if (rep[1] === 'true') {
    console.log(`○ ${name}: ${args.flavour} に合います`);
    continue;
  }
  bad = true;
  console.log(`× ${name}: ${args.flavour} に合いません (落ちた規則 ${rules.length})`);
  for (const [, clause, test, n, desc] of rules) console.log(`  ${clause}-${test} (${n} か所): ${decode(desc)}`);
}
process.exit(bad ? 1 : 0);
