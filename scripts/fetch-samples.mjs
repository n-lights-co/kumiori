#!/usr/bin/env node
/**
 * fetch-samples — 見本との比較 (scripts/compare-pdf.mjs・scripts/compare-view.mjs) に使う見本を、配布元から取って手元に置く。
 * 見本は他の人の著作物なので、リポジトリには入れない (CLAUDE.md)。置き場は既定で .cache/samples (.gitignore 済み)。
 *
 * 使い方:
 *   node scripts/fetch-samples.mjs [--out .cache/samples] [--only fo,css-print] [--force] [--offline]
 *   node scripts/fetch-samples.mjs --pack <ディレクトリ>    取ったもの (zip・PDF と manifest.json) を、置き場に預ける形に包む
 *   node scripts/fetch-samples.mjs --unpack <ディレクトリ>  包んだものを戻し、ネットを使わずに展開する
 *   (この開発環境のようにプロキシを通すときは NODE_USE_ENV_PROXY=1 を付ける。Node 22.21 から)
 *
 * --pack は、取ったファイルを tar にまとめ、10MB ずつに切って base64 の JavaScript (samples-NN.js) に包む
 * (claude.ai の Artifact の置き場が、zip や tar をそのまま受け付けないため)。--unpack はその逆をして、--offline で展開する。
 * --offline は、ネットを使わず、manifest.json に書いた見本の一覧と、手元の zip・PDF だけで展開する。
 *
 * 取るもの:
 *  - fo: アンテナハウスの「サンプル FO 集」(https://www.antenna.co.jp/AHF/ahf_samples/sample-fo.html) の見本ごとの FO の zip と、
 *    AH Formatter の出した PDF。比べるときは --compat antenna で組む。
 *      <out>/fo/samples/<分類>/<名前>/  zip を展開したもの (FO と、FO が参照する画像など)
 *      <out>/fo/fo/<名前>.fo            compare-pdf.mjs の --fo に渡す (平らに並べた写し)
 *      <out>/fo/ref/<名前>.pdf          見本の PDF (--ref に渡す)
 *      <out>/fo/img/                    FO が参照する画像など (--img に渡す。名前のぶつかるものは、先のものを残して manifest に書く)
 *      <out>/fo/groups.json             公開している比較ページの分け方 (XSL-FO 1〜4) ごとの見本の名前
 *  - css-print: 『CSS ページ組版入門』第 4 版 (アンテナハウス) の PDF と、元のファイルの zip。比べるときは --style ah で組む。
 *      <out>/css-print/CSS-Print-ja.pdf・<out>/css-print/src/ (zip を展開したもの)
 *
 * <out>/manifest.json に、取った日時・元の URL・大きさ・SHA-256 を書く。同じものが既にあれば取り直さない (--force で取り直す)。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = { out: '.cache/samples', only: 'fo,css-print', force: false, offline: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--force' || a === '--offline') args[a.slice(2)] = true;
  else if (a === '--out' || a === '--only' || a === '--pack' || a === '--unpack') args[a.slice(2)] = process.argv[++i];
  else {
    console.error('usage: node scripts/fetch-samples.mjs [--out .cache/samples] [--only fo,css-print] [--force] [--offline] [--pack <dir> | --unpack <dir>]');
    process.exit(2);
  }
}
const only = new Set(args.only.split(','));
const out = path.resolve(args.out);
const manifestFile = path.join(out, 'manifest.json');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** 包むときの 1 個の大きさ (base64 にする前) */
const CHUNK = 10 * 1024 * 1024;

if (args.pack) {
  // 取ったもの (manifest に書いたファイルと manifest.json) を tar にまとめ、切って base64 の JS に包む
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const list = ['manifest.json', ...Object.keys(m.files)];
  const tar = execFileSync('tar', ['-cf', '-', '-C', out, ...list], { maxBuffer: 2 ** 31 });
  fs.mkdirSync(args.pack, { recursive: true });
  const parts = [];
  for (let k = 0; k * CHUNK < tar.length; k++) {
    const name = `samples-${String(k).padStart(2, '0')}.js`;
    const body = tar.subarray(k * CHUNK, (k + 1) * CHUNK);
    fs.writeFileSync(path.join(args.pack, name), `export default ${JSON.stringify(Buffer.from(body).toString('base64'))};\n`);
    parts.push({ name, size: body.length, sha256: sha256(body) });
  }
  const index = { createdAt: new Date().toISOString(), tarSize: tar.length, tarSha256: sha256(tar), parts };
  fs.writeFileSync(path.join(args.pack, 'samples-index.json'), JSON.stringify(index, null, 2));
  console.log(`${parts.length} 個に包みました (tar ${tar.length} バイト): ${path.resolve(args.pack)}`);
  process.exit(0);
}

if (args.unpack) {
  // 包んだものを確かめて tar に戻し、置き場に展開してから、ネットを使わずに展開を続ける
  const index = JSON.parse(fs.readFileSync(path.join(args.unpack, 'samples-index.json'), 'utf8'));
  const bufs = index.parts.map((p) => {
    const src = fs.readFileSync(path.join(args.unpack, p.name), 'utf8');
    const b = Buffer.from(JSON.parse(src.slice(src.indexOf('"'), src.lastIndexOf('"') + 1)), 'base64');
    if (sha256(b) !== p.sha256) throw new Error(`${p.name} の中身が index と合いません`);
    return b;
  });
  const tar = Buffer.concat(bufs);
  if (sha256(tar) !== index.tarSha256) throw new Error('tar の中身が index と合いません');
  fs.mkdirSync(out, { recursive: true });
  execFileSync('tar', ['-xf', '-', '-C', out], { input: tar, maxBuffer: 2 ** 31 });
  args.offline = true;
}
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { files: {} };

const FO_INDEX = 'https://www.antenna.co.jp/AHF/ahf_samples/sample-fo.html';
const CSS_PRINT = 'https://www.antenna.co.jp/AHF/ahf_publication/CSSPrint/4th/';
/** 比較ページの分け方 (公開している「Kumiori 見本比較 XSL-FO 1〜4」と同じ) */
const FO_GROUPS = {
  'XSL-FO 1 (構造・ページ・フロート)': ['structure', 'page-set', 'float'],
  'XSL-FO 2 (ブロック)': ['block'],
  'XSL-FO 3 (行・字・ルビ・言語)': ['line', 'character', 'ruby', 'language'],
  'XSL-FO 4 (表・図・PDF)': ['table', 'graphics', 'pdf', 'barcode', 'color'],
};


/** url を取る (同時に取る数は呼ぶ側で抑える)。失敗は 3 回まで取り直す */
async function get(url) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (k >= 2) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** k));
    }
  }
}

/** url を file に保存する (manifest に同じ URL・同じ中身があれば取らない)。中身を返す */
async function fetchTo(url, file) {
  const rel = path.relative(out, file).split(path.sep).join('/');
  const known = manifest.files[rel];
  if (args.offline) {
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== known?.sha256) throw new Error(`手元に無いか、manifest と合いません: ${rel}`);
    return fs.readFileSync(file);
  }
  if (!args.force && known?.url === url && fs.existsSync(file) && sha256(fs.readFileSync(file)) === known.sha256) return fs.readFileSync(file);
  const b = await get(url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
  manifest.files[rel] = { url, size: b.length, sha256: sha256(b), fetchedAt: new Date().toISOString() };
  return b;
}

/** zip (PKZIP。格納・deflate だけ) の中身を dir に展開する。ディレクトリの外を指す名前は捨てる */
function unzip(b, dir) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // 中央ディレクトリの終わり (EOCD) を後ろから探す
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip の終わりが見つかりません');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const names = [];
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip の中央ディレクトリが壊れています');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const elen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const flags = v.getUint16(p + 8, true);
    const raw = b.subarray(p + 46, p + 46 + nlen);
    // 名前は、UTF-8 の印 (ビット 11) があれば UTF-8、無ければ Shift_JIS として読む (日本語の名前の zip)
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'shift_jis').decode(raw);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const target = path.resolve(dir, name);
    if (!target.startsWith(path.resolve(dir) + path.sep)) continue;
    const lnlen = v.getUint16(local + 26, true);
    const lelen = v.getUint16(local + 28, true);
    const data = b.subarray(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize);
    const content = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : undefined;
    if (!content) throw new Error(`扱えない圧縮の方式 ${method}: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    names.push(path.relative(dir, target));
  }
  return names;
}

/** 同時に limit 個ずつ fn を流す */
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

if (only.has('fo')) {
  const base = path.join(out, 'fo');
  const items = args.offline
    ? manifest.fo?.items ?? []
    : [...new TextDecoder().decode(await get(FO_INDEX)).matchAll(/href="\.\/(ja\/fo\/([^/"]+)\/([^/"]+))\.zip"/g)].map((m) => ({ stem: m[1], cat: m[2], name: m[3] }));
  console.log(`サンプル FO 集: ${items.length} 本`);
  const clashes = [];
  const imgOwner = new Map();
  let done = 0;
  await pool(items, 6, async (it) => {
    const url = new URL(`./${it.stem}`, FO_INDEX).href;
    const zip = await fetchTo(`${url}.zip`, path.join(base, 'zip', it.cat, `${it.name}.zip`));
    await fetchTo(`${url}.pdf`, path.join(base, 'ref', `${it.name}.pdf`));
    const dir = path.join(base, 'samples', it.cat);
    for (const f of unzip(zip, dir)) {
      const src = path.join(dir, f);
      if (f.endsWith('.fo')) {
        fs.mkdirSync(path.join(base, 'fo'), { recursive: true });
        fs.copyFileSync(src, path.join(base, 'fo', path.basename(f)));
      } else {
        const key = path.basename(f).toLowerCase();
        const owner = imgOwner.get(key);
        if (owner && owner !== it.name) clashes.push(`${path.basename(f)} (${owner} と ${it.name})`);
        else {
          imgOwner.set(key, it.name);
          fs.mkdirSync(path.join(base, 'img'), { recursive: true });
          fs.copyFileSync(src, path.join(base, 'img', path.basename(f)));
        }
      }
    }
    if (++done % 20 === 0) console.log(`  ${done} / ${items.length}`);
  });
  const groups = Object.fromEntries(Object.entries(FO_GROUPS).map(([g, cats]) => [g, items.filter((it) => cats.includes(it.cat)).map((it) => it.name)]));
  fs.writeFileSync(path.join(base, 'groups.json'), JSON.stringify(groups, null, 2));
  manifest.fo = { index: FO_INDEX, count: items.length, items, imageNameClashes: clashes };
  if (clashes.length) console.log(`名前のぶつかる画像 (先のものを img に残した): ${clashes.length} 個`);
}

if (only.has('css-print')) {
  const base = path.join(out, 'css-print');
  await fetchTo(`${CSS_PRINT}CSS-Print-ja.pdf`, path.join(base, 'CSS-Print-ja.pdf'));
  const zip = await fetchTo(`${CSS_PRINT}CSS-Print-ja-SauceFiles.zip`, path.join(base, 'CSS-Print-ja-SauceFiles.zip'));
  const names = unzip(zip, path.join(base, 'src'));
  console.log(`CSS-Print: 元のファイル ${names.length} 個`);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`置き場: ${out}`);
