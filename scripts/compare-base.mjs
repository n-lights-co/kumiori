#!/usr/bin/env node
/**
 * compare-base — 前のコミット (--base) と後のコミット (--head) の Kumiori で、同じ文書を組み比べ、組版の結果の変わった文書とページを一覧にする。
 * 直す前と後で、どこが変わったか (変わるはずの所だけが変わったか) を確かめるための道具 (npm run compare:base)。
 *
 * 使い方 (リポジトリの直下で):
 *   npm run compare:base -- --base <コミット> [--head <コミット>|.] [--out <出力先>] [--only <群>,…] [--skip <群>,…] [--filter <正規表現>]
 *                           [--jobs <数>] [--dpi <解像度>] [--max-images <数>] [--timeout <秒>]
 *                           [--samples <dir>] [--weasyprint <dir>] [--fonts <dir>] [--spot-colors <JSON>] [--no-cache]
 *
 *  - --base: 前のコミット (git rev-parse で読める名前。例: main~3・e5b2f6d)。--head: 後のコミット (既定 HEAD)。
 *    --head . は、作業の場所のいまのファイル (まだコミットしていない変更を含む) を後とする。
 *  - 2 つのコミットを一時的な場所に取り出し (git worktree。scripts/ci-local.mjs の --worktree と同じ作り)、それぞれで Node のコマンド (dist-cli) を作る。
 *    作ったコマンドは .cache/compare-base/<コミット>/ に置き、次からは作り直さない (--no-cache で作り直す)。
 *    依存 (node_modules) は、コミットの package-lock.json がいまのものと同じなら、このリポジトリのものを使い、違えば、その置き場に npm ci で入れる。
 *  - 組む文書の群 (--only・--skip で選ぶ。見本や書体が手元に無い群は飛ばし、報告に飛ばした理由を書く):
 *      conformance … 対応仕様説明書 4 冊 (docs/conformance。scripts/build-conformance.mjs と同じく、コードの表示を差し込んで組む)
 *      examples    … examples の HTML と FO (examples/preview の画面のコードは除く)
 *      samples     … samples の FO (仕様どおりのモードと互換のモード (--compat antenna) の両方) と HTML
 *      generated   … 確かめの文書を作る道具で作る文書 (いまは scripts/gen-column-footnotes.mjs の段組の脚注の文書 30 個と、
 *                    scripts/gen-stress-docs.mjs の、深い入れ子・大きな表・多くの CSS の規則・長い段落・多くの画像などの文書 7 個。
 *                    後の版の道具 (無ければ前の版、それも無ければ作業の場所の道具) で 1 度だけ作り、前と後で同じ文書を組む)
 *      ah          … アンテナハウスのサンプル FO 集 (.cache/samples/fo/samples。--compat antenna)
 *      css-print   … 『CSSページ組版入門』第 4 版 (.cache/samples/css-print/src。--style ah)
 *      weasyprint  … WeasyPrint の見本 (CourtBouillon/weasyprint-samples。--style weasyprint。見本の printall.sh と同じ組み合わせの 8 つ)
 *    リポジトリの文書 (conformance・examples・samples) は、それぞれのコミットのものを組む (文書を直したコミットなら、その直しも差に出る)。
 *    手元の見本 (ah・css-print・weasyprint) は、どちらも同じファイルを組む。
 *  - 見本の置き場: --samples (既定 .cache/samples。CLAUDE.md の「見本と書体の置き場」の手順で戻したもの)、
 *    --weasyprint (既定は環境変数 KUMIORI_WEASYPRINT_SAMPLES か、リポジトリの隣の weasyprint-samples。
 *    取り方は GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <置き場>)。
 *  - 書体: 既定の書体は .cache/fonts (テストと同じ置き場。--font-cache で渡す。無い書体はコマンドが配信元から取って置く)。
 *    --fonts <dir> (既定 .cache/ms-fonts があればそれ) の書体を、ah・css-print の群に --font で渡し、総称の書体を見本と同じ書体にする
 *    (serif=Times New Roman・sans-serif=Arial・monospace=Courier New・serif-cjk=MS Mincho・sans-serif-cjk=MS Gothic)。
 *    前と後で同じ書体で組めば比べられるので、書体が無くても組み比べはできる (報告に、どの書体で組んだかを書く)。
 *  - 特色: css-print の群は、--spot-colors (既定 .cache/spot-colors.json) の特色の値で組む。無く、見本の PDF (CSS-Print-ja.pdf) があれば、
 *    scripts/spot-colors-from-pdf.mjs で出力先に取り出して使う (PANTONE の値なので、リポジトリには入れない)。
 *  - PDF の日時は、環境変数 SOURCE_DATE_EPOCH (2000-01-01) で決める。日時を渡せない前の版 (SOURCE_DATE_EPOCH を読まず、文書の識別子を乱数で作る版) を組むときだけ、
 *    時計と乱数も止める (scripts/compare-base-freeze.mjs を node --import で前読みする)。どちらの版も、同じコードで同じ入力を組めば、同じバイトの PDF になる。
 *    止めた版では Date.now() が進まないので、時間の上限 (EPS の epsMs・資源の取得の締め切りなど) が効かない (手数などの上限で止まる)。
 *    ふだんは時間の上限に当たる文書は、止めた前の版と止めない後の版で、結果や知らせが違うことがある
 *
 * 比べ方 (文書ごと):
 *  - PDF のバイト列が同じなら「バイトも同じ」(same。絵と字の比べを省く)
 *  - 違えば、ページ数 (pdfinfo)、ページごとの字 (pdftotext -bbox の語と位置。0.01pt で丸める)、絵 (pdftoppm で --dpi (既定 50) のグレーの画素にし、
 *    輝度の差が 32 を超える画素) を比べる。字か絵の変わったページを「変わったページ」とする。
 *    どれも同じなら「見た目は同じ」(looks-same。バイトは違う)。輝度の近い色・出力の決まり・XMP・構造・注釈・しおりだけの変わりは、ここに入る
 *  - 警告・誤り (コマンドの標準エラーの、警告・誤りの行) の増減も書く
 *  - 組版の秒 (前と後) も測る (時計を止めるのは前の版を組むプロセスの中だけで、この道具は本当の時計で測る)
 * 出力: <出力先> (既定 compare-base-out) の report.md・report.json と、変わったページの、前と後と差を並べた絵 (images/。文書ごとに --max-images 枚 (既定 20) まで。
 * 差の絵は、後にだけある字・線を赤、前にだけあるものを青で描く)。組んだ PDF は pdf/base・pdf/head にある。
 *
 * 必要なもの: git・poppler (pdfinfo・pdftotext・pdftoppm)。
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { shellArg } from './shellArg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freeze = path.join(root, 'scripts', 'compare-base-freeze.mjs');
const GROUPS = ['conformance', 'examples', 'samples', 'generated', 'ah', 'css-print', 'weasyprint'];

// ---- 引数 ----
function usage(message) {
  if (message) console.error(message);
  console.error(
    '使い方: npm run compare:base -- --base <コミット> [--head <コミット>|.] [--out <dir>] [--only <群>,…] [--skip <群>,…] [--filter <正規表現>] [--jobs <数>] [--dpi <解像度>] [--max-images <数>] [--timeout <秒>] [--samples <dir>] [--weasyprint <dir>] [--fonts <dir>] [--spot-colors <JSON>] [--no-cache]',
  );
  console.error(`群: ${GROUPS.join('・')}`);
  process.exit(2);
}
const opt = { head: 'HEAD', out: 'compare-base-out', dpi: 50, jobs: Math.max(1, os.availableParallelism?.() ?? os.cpus().length), maxImages: 20, timeout: 600, cache: true };
const valued = new Set(['base', 'head', 'out', 'only', 'skip', 'filter', 'jobs', 'dpi', 'max-images', 'timeout', 'samples', 'weasyprint', 'fonts', 'spot-colors']);
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage();
    else if (a === '--no-cache') opt.cache = false;
    else if (a.startsWith('--') && valued.has(a.slice(2))) {
      const v = argv[++i];
      if (v === undefined) usage(`${a} に値がありません`);
      opt[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    } else usage(`知らない選択肢: ${a}`);
  }
}
if (!opt.base) usage('--base が要ります');
for (const k of ['jobs', 'dpi', 'maxImages', 'timeout']) {
  opt[k] = Number(opt[k]);
  if (!Number.isFinite(opt[k]) || opt[k] < (k === 'maxImages' ? 0 : 1)) usage(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} の値が正しくありません`);
}
const listOpt = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
for (const g of [...listOpt(opt.only), ...listOpt(opt.skip)]) if (!GROUPS.includes(g)) usage(`知らない群: ${g}`);
const groups = (opt.only ? listOpt(opt.only) : GROUPS).filter((g) => !listOpt(opt.skip).includes(g));
const filter = opt.filter ? new RegExp(opt.filter) : undefined;
const outDir = path.resolve(opt.out);
const samplesDir = path.resolve(opt.samples ?? path.join(root, '.cache', 'samples'));
const weasyDir = path.resolve(opt.weasyprint ?? process.env.KUMIORI_WEASYPRINT_SAMPLES ?? path.join(root, '..', 'weasyprint-samples'));
const msFontsDir = opt.fonts ? path.resolve(opt.fonts) : fs.existsSync(path.join(root, '.cache', 'ms-fonts')) ? path.join(root, '.cache', 'ms-fonts') : undefined;
const fontCache = path.join(root, '.cache', 'fonts');

// ---- 道具 ----
const git = (args, cwd = root) => spawnSync('git', args, { cwd, encoding: 'utf8' });
/** npm の呼び方 (scripts/ci-local.mjs と同じ: npm run から走らせたときは npm の本体をいまの Node で直に動かし、ほかは PATH の npm を呼ぶ) */
const npmCli = process.env.npm_execpath && /(?:^|[\\/])npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : undefined;
const npm = (args, opts) =>
  npmCli ? spawnSync(process.execPath, [npmCli, ...args], opts) : spawnSync('npm', args.map((a) => shellArg(a)), { ...opts, shell: process.platform === 'win32' });
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const need = (cmd) => {
  const r = spawnSync(cmd, ['-v'], { encoding: 'utf8' });
  if (r.error) {
    console.error(`${cmd} が見つかりません (poppler-utils を入れてください)`);
    process.exit(2);
  }
};
for (const c of ['pdfinfo', 'pdftotext', 'pdftoppm']) need(c);
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

/** 子のプロセスを走らせ、終わりを待つ (標準出力・標準エラーを集める。timeout 秒で止める) */
function run(cmd, args, { cwd = root, env = process.env, timeout } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // 字の符号 (UTF-8) の途中で切れたかたまりを 1 つずつ字にすると、日本語の字が化ける (pdftotext の語が「親��太さ」のようになり、
    // 変わっていないページを「字の変わったページ」に数えていた)。かたまりの境をまたぐ字をつなぐため、流れの側で字にする
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = timeout ? setTimeout(() => ((timedOut = true), p.kill('SIGKILL')), timeout * 1000) : undefined;
    p.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut, sec: (Date.now() - t0) / 1000 });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: -1, stdout, stderr: stderr + String(e), timedOut, sec: (Date.now() - t0) / 1000 });
    });
  });
}

/** 並べて走らせる (同時に jobs 個まで) */
async function pool(items, jobs, fn) {
  let k = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (k < items.length) {
        const i = k++;
        await fn(items[i], i);
      }
    }),
  );
}

// ---- コミットを取り出して、コマンドを作る ----
/**
 * その版を組むときに、時計と乱数を止める (compare-base-freeze.mjs を前読みする) か。
 * 文書の識別子を中身から作る版 (src/pdfStandard.ts に finishDocumentId がある版。PDF の日時は SOURCE_DATE_EPOCH で決まる) は、止めなくても同じバイトになるので止めない。
 * 止めると Date.now() が進まず、時間の上限 (EPS の epsMs・資源の取得の締め切り・PDF の画像の読み込みの上限など) が効かなくなるため、止めは要る前の版だけにする
 */
const needsFreeze = (dir) => {
  const f = path.join(dir, 'src', 'pdfStandard.ts');
  return !(fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('finishDocumentId'));
};
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
/**
 * <dir>/node_modules を modules へのリンクにする (作ったコマンドが、その場所から依存を見つけるように)。
 * 本物のディレクトリがあれば、そのままにする (置き場に npm ci で入れたもの)。別の所を指すリンクは、結び直す
 */
function linkModules(dir, modules) {
  const at = path.join(dir, 'node_modules');
  if (fs.existsSync(at) && !isLink(at)) return;
  if (isLink(at)) {
    if (path.resolve(dir, fs.readlinkSync(at)) === path.resolve(modules)) return;
    fs.rmSync(at);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(path.resolve(modules), at, process.platform === 'win32' ? 'junction' : 'dir');
}

/** コマンドを作るときの環境 (vite の設定の読み方の注意は、比べるのに関わらないので出さない) */
const buildEnv = { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' };
const worktrees = [];
function cleanup() {
  for (const w of worktrees.splice(0)) {
    git(['worktree', 'remove', '--force', w]);
    fs.rmSync(w, { recursive: true, force: true });
  }
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

/**
 * 比べる版を用意する: { key: 'base'|'head', label, sha, dir (文書を読む場所), cli (dist-cli/cli.js) }
 * rev が . なら、作業の場所をそのまま使い、コマンドは出力先の build/ に作る (置き場には置かない)
 */
function prepare(key, rev) {
  if (rev === '.') {
    const dist = path.join(outDir, 'build', key, 'dist-cli');
    console.log(`[${key}] 作業の場所 (まだコミットしていない変更を含む) でコマンドを作ります`);
    const r = npm(['run', 'build:cli', '--', '--outDir', dist, '--emptyOutDir'], { cwd: root, env: buildEnv, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) throw new Error(`[${key}] コマンドを作れませんでした`);
    // 出力先がリポジトリの外でも、作ったコマンドが依存を見つけられるように、作業の場所の node_modules を隣に結ぶ
    linkModules(path.dirname(dist), path.join(root, 'node_modules'));
    const head = git(['rev-parse', '--short', 'HEAD']).stdout.trim();
    return { key, label: `作業の場所 (${head} とまだコミットしていない変更)`, sha: 'worktree', dir: root, cli: path.join(dist, 'cli.js'), freeze: needsFreeze(root) };
  }
  const r = git(['rev-parse', '--verify', `${rev}^{commit}`]);
  if (r.status !== 0) throw new Error(`[${key}] コミット ${rev} がありません`);
  const sha = r.stdout.trim();
  const subject = git(['log', '-1', '--format=%s', sha]).stdout.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kumiori-compare-${key}-`));
  const w = git(['worktree', 'add', '--detach', dir, sha]);
  if (w.status !== 0) throw new Error(`[${key}] 取り出せませんでした: ${w.stderr}`);
  worktrees.push(dir);
  const cache = path.join(root, '.cache', 'compare-base', sha);
  const cli = path.join(cache, 'dist-cli', 'cli.js');
  // 依存: package-lock.json がいまのものと同じなら、このリポジトリの node_modules を使う (置き場の上のディレクトリをたどって見つかる)。
  // 違えば、置き場に npm ci で入れる (コマンドは置き場の node_modules を先に見つける)
  const lock = (d) => (fs.existsSync(path.join(d, 'package-lock.json')) ? fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8') : '');
  const sameDeps = lock(dir) === lock(root) && fs.existsSync(path.join(root, 'node_modules'));
  let modules = path.join(root, 'node_modules');
  if (!sameDeps) {
    modules = path.join(cache, 'node_modules');
    // 前に依存が同じだったときの結び (リンク) が残っていれば、外して入れ直す
    if (isLink(modules)) fs.rmSync(modules);
    if (!fs.existsSync(modules) || !opt.cache) {
      console.log(`[${key}] 依存がいまと違うので、${cache} に npm ci で入れます`);
      fs.mkdirSync(cache, { recursive: true });
      for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(dir, f), path.join(cache, f));
      const i = npm(['ci', '--no-audit', '--no-fund'], { cwd: cache, stdio: ['ignore', 'ignore', 'inherit'] });
      if (i.status !== 0) throw new Error(`[${key}] 依存を入れられませんでした`);
    }
  }
  if (!fs.existsSync(cli) || !opt.cache) {
    console.log(`[${key}] ${sha.slice(0, 7)} でコマンドを作ります`);
    fs.symlinkSync(modules, path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const b = npm(['run', 'build:cli', '--', '--outDir', path.dirname(cli), '--emptyOutDir'], { cwd: dir, env: buildEnv, stdio: ['ignore', 'ignore', 'inherit'] });
    if (b.status !== 0) throw new Error(`[${key}] コマンドを作れませんでした`);
  } else console.log(`[${key}] ${sha.slice(0, 7)} のコマンドは作ってあります (${path.dirname(cli)})`);
  // 組むときに、コマンドが依存を見つける場所 (Node は、リンクをたどった先の、本当の場所から上へ node_modules を探す)。
  // 置き場の隣に node_modules が無いと、.cache が別の作業の場所へのリンクのとき、リンクの先の作業の場所の (古いかもしれない) 依存で組んでしまう。
  // 依存が同じなら、置き場の隣に、このリポジトリの node_modules を結ぶ (違えば、置き場に入れたものがある)
  if (sameDeps) linkModules(cache, modules);
  return { key, label: `${sha.slice(0, 7)} ${subject}`, sha, dir, cli, freeze: needsFreeze(dir) };
}

// ---- 組む文書 ----
/** 見本と同じ書体 (ah・css-print の群) のコマンドの引数 */
function msFontArgs() {
  if (!msFontsDir || !fs.existsSync(msFontsDir)) return [];
  const files = fs.readdirSync(msFontsDir).filter((f) => /\.(ttf|otf|ttc)$/i.test(f)).sort();
  return [
    ...files.flatMap((f) => ['--font', path.join(msFontsDir, f)]),
    ...['serif=Times New Roman', 'sans-serif=Arial', 'monospace=Courier New', 'serif-cjk=MS Mincho', 'sans-serif-cjk=MS Gothic'].flatMap((g) => ['--generic-font', g]),
  ];
}

/** 版ごとに組む文書の準備 (対応仕様説明書は、コードの表示を差し込んだ文書を作業の場所に書く) */
const skipped = [];
const notes = [];

/**
 * 文書の一覧: { id, group, name, input: (版) => 入力のファイル, args: (版) => 引数 }。
 * リポジトリの文書の id は、版によらず同じ (前と後で組にする)。
 */
async function listDocs(revs) {
  const docs = [];
  const add = (d) => {
    if (!filter || filter.test(d.id)) docs.push(d);
  };
  const repoFiles = (rel, re) => {
    // どちらかの版にある文書 (片方にしか無いものは、報告に「片方だけ」と書く)
    const set = new Set();
    for (const v of revs) for (const f of walk(path.join(v.dir, rel))) if (re.test(f)) set.add(path.relative(v.dir, f).split(path.sep).join('/'));
    return [...set].sort();
  };
  const inRev = (v, rel) => (fs.existsSync(path.join(v.dir, rel)) ? path.join(v.dir, rel) : undefined);

  if (groups.includes('conformance')) {
    const jobs = [
      { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.fo', args: ['--compat', 'spec'] },
      { kind: 'html', dir: 'html', file: 'kumiori-html-css.html', args: [] },
      { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.en.fo', args: ['--compat', 'spec'] },
      { kind: 'html', dir: 'html', file: 'kumiori-html-css.en.html', args: [] },
    ];
    // 版ごとに、その版の scripts/conformance-lib.mjs・conformance-fonts.mjs で、組む文書を作る
    const prepared = new Map();
    let failed;
    for (const v of revs) {
      const lib = path.join(v.dir, 'scripts', 'conformance-lib.mjs');
      const fonts = path.join(v.dir, 'scripts', 'conformance-fonts.mjs');
      if (!fs.existsSync(lib) || !fs.existsSync(fonts)) {
        failed = `${v.key} の版に scripts/conformance-lib.mjs・conformance-fonts.mjs が無い`;
        break;
      }
      try {
        const { expand } = await import(pathToFileURL(lib).href);
        const cf = await import(pathToFileURL(fonts).href);
        const fontFiles = await cf.ensureConformanceFonts(fontCache);
        const foFonts = cf.CONFORMANCE_FONTS.filter((f) => f.fo).flatMap((f) => ['--font', fontFiles.get(f.url)]);
        for (const j of jobs) {
          const src = inRev(v, `docs/conformance/${j.dir}/${j.file}`);
          if (!src) continue;
          const work = path.join(outDir, 'work', v.key, 'conformance', j.file.replace(/\.\w+$/, ''));
          fs.rmSync(work, { recursive: true, force: true });
          fs.mkdirSync(work, { recursive: true });
          const text = fs.readFileSync(src, 'utf8');
          // 奥付の版の印は、版によらず同じ字にする (版の番号を上げたコミットでも、差に出ないように)
          fs.writeFileSync(path.join(work, j.file), expand(text, j.kind).replaceAll('<?kumiori-version?>', '0.0.0').replaceAll('<!--kumiori-version-->', '0.0.0'));
          for (const f of fs.readdirSync(path.dirname(src)).filter((n) => /\.css$/.test(n))) fs.copyFileSync(path.join(path.dirname(src), f), path.join(work, f));
          fs.cpSync(path.join(path.dirname(src), 'images'), path.join(work, 'images'), { recursive: true });
          if (j.kind === 'html') {
            fs.mkdirSync(path.join(work, 'fonts'), { recursive: true });
            for (const url of cf.fontUrlsIn(text)) {
              const file = fontFiles.get(url);
              if (file) fs.copyFileSync(file, path.join(work, 'fonts', cf.urlBasename(url)));
            }
          }
          prepared.set(`${v.key}:${j.file}`, { input: path.join(work, j.file), args: [...j.args, ...(j.kind === 'fo' ? foFonts : [])] });
        }
      } catch (e) {
        failed = `組む文書を作れない (${e instanceof Error ? e.message : e})。書体を取るのにネットワークが要ることがある`;
        break;
      }
    }
    if (failed) skipped.push({ group: 'conformance', reason: failed });
    else
      for (const j of jobs)
        add({
          id: `conformance/${j.file}`,
          group: 'conformance',
          input: (v) => prepared.get(`${v.key}:${j.file}`)?.input,
          args: (v) => prepared.get(`${v.key}:${j.file}`)?.args ?? [],
        });
  }

  if (groups.includes('examples')) {
    for (const rel of repoFiles('examples', /\.(fo|x?html?)$/i).filter((f) => !f.startsWith('examples/preview/')))
      add({ id: rel, group: 'examples', input: (v) => inRev(v, rel), args: () => [] });
  }

  if (groups.includes('samples')) {
    for (const rel of repoFiles('samples', /\.(fo|x?html?)$/i)) {
      if (rel.endsWith('.fo'))
        for (const compat of ['spec', 'antenna']) add({ id: `${rel} (--compat ${compat})`, group: 'samples', input: (v) => inRev(v, rel), args: () => ['--compat', compat] });
      else add({ id: rel, group: 'samples', input: (v) => inRev(v, rel), args: () => [] });
    }
  }

  if (groups.includes('generated')) {
    // 確かめの文書を作る道具: 後の版にあれば後の版の、無ければ前の版の道具で作る (前と後で同じ文書を組む)
    const gens = [
      { script: 'scripts/gen-column-footnotes.mjs', name: 'column-footnotes' },
      { script: 'scripts/gen-stress-docs.mjs', name: 'stress' },
    ];
    for (const g of gens) {
      // どちらの版にも無ければ (道具を足す前のコミットどうしを比べるとき)、作業の場所の道具で作る
      const v = [...revs].reverse().find((r) => fs.existsSync(path.join(r.dir, g.script))) ?? (fs.existsSync(path.join(root, g.script)) ? { key: 'worktree', dir: root } : undefined);
      if (!v) {
        skipped.push({ group: 'generated', reason: `${g.script} がどちらの版にも、作業の場所にも無い` });
        continue;
      }
      const dir = path.join(outDir, 'work', 'generated', g.name);
      fs.mkdirSync(dir, { recursive: true });
      const r = spawnSync(process.execPath, [path.join(v.dir, g.script), dir], { encoding: 'utf8' });
      const meta = path.join(dir, 'meta.json');
      if (r.status !== 0 || !fs.existsSync(meta)) {
        skipped.push({ group: 'generated', reason: `${g.script} で文書を作れない (${r.stderr.trim().split('\n').pop()})` });
        continue;
      }
      notes.push(`generated: ${g.script} は${{ head: '後の版', base: '前の版', worktree: '作業の場所' }[v.key]}のもので作った`);
      for (const name of Object.keys(JSON.parse(fs.readFileSync(meta, 'utf8'))).sort())
        add({ id: `generated/${g.name}/${name}`, group: 'generated', input: () => path.join(dir, name), args: () => [] });
    }
  }

  if (groups.includes('ah')) {
    const dir = path.join(samplesDir, 'fo', 'samples');
    const fos = walk(dir).filter((f) => f.endsWith('.fo')).sort();
    if (!fos.length) skipped.push({ group: 'ah', reason: `見本が無い (${dir}。CLAUDE.md の「見本と書体の置き場」の手順で戻す)` });
    const fonts = msFontArgs();
    if (fos.length) notes.push(`ah: ${fonts.length ? `見本と同じ書体 (${msFontsDir})` : '既定の書体 (見本と同じ書体が手元に無い)'}で組んだ`);
    for (const f of fos) add({ id: `ah/${path.basename(f, '.fo')}`, group: 'ah', input: () => f, args: () => ['--compat', 'antenna', ...fonts] });
  }

  if (groups.includes('css-print')) {
    const html = path.join(samplesDir, 'css-print', 'src', 'CSS-Print-ja.html');
    if (!fs.existsSync(html)) skipped.push({ group: 'css-print', reason: `見本が無い (${html})` });
    else {
      let spot = opt.spotColors ? path.resolve(opt.spotColors) : path.join(root, '.cache', 'spot-colors.json');
      const refPdf = path.join(samplesDir, 'css-print', 'CSS-Print-ja.pdf');
      if (!fs.existsSync(spot) && fs.existsSync(refPdf)) {
        spot = path.join(outDir, 'spot-colors.json');
        spawnSync(process.execPath, [path.join(root, 'scripts', 'spot-colors-from-pdf.mjs'), refPdf, '-o', spot], { stdio: 'ignore' });
      }
      const fonts = msFontArgs();
      const spotArgs = fs.existsSync(spot) ? ['--spot-colors', spot] : [];
      notes.push(`css-print: ${fonts.length ? '見本と同じ書体' : '既定の書体 (見本と同じ書体が手元に無い)'}、${spotArgs.length ? '見本の特色の値' : '特色の値なし (代わりの RGB)'}で組んだ`);
      add({ id: 'css-print/CSS-Print-ja', group: 'css-print', input: () => html, args: () => ['--style', 'ah', ...spotArgs, ...fonts] });
    }
  }

  if (groups.includes('weasyprint')) {
    // 見本の printall.sh と同じ組み合わせ (HTML と、weasyprint -s で足す CSS)
    const list = [
      ['ticket', 'ticket/ticket.html'],
      ['report', 'report/report.html'],
      ['poster', 'poster/poster.html', 'poster.css'],
      ['flyer', 'poster/poster.html', 'flyer.css'],
      ['letter', 'letter/letter.html'],
      ['invoice', 'invoice/invoice.html'],
      ['book-classical', 'book/book.html', 'book-classical.css'],
      ['book', 'book/book.html', 'book.css'],
    ];
    if (!fs.existsSync(path.join(weasyDir, 'ticket', 'ticket.html')))
      skipped.push({ group: 'weasyprint', reason: `見本が無い (${weasyDir}。GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <置き場> で取り、--weasyprint で渡す)` });
    else
      for (const [name, html, css] of list)
        add({ id: `weasyprint/${name}`, group: 'weasyprint', input: () => path.join(weasyDir, html), args: () => ['--style', 'weasyprint', ...(css ? ['--css', css] : [])] });
  }
  return docs;
}

// ---- 組む ----
const safe = (id) => id.replace(/[^\w.-]+/g, '_');
/** 警告・誤りの行 (場所の前の、取り出した場所のパスは除く) */
const diagLines = (stderr, v) =>
  stderr
    .split('\n')
    .filter((l) => /^\s*(警告|誤り|warning|error)\b/i.test(l) || /^\s*(警告|誤り) \[/.test(l))
    .map((l) => l.replaceAll(path.join(outDir, 'work', v.key), '<work>').replaceAll(v.dir, '<dir>').replaceAll(outDir, '<out>').trim());

async function typeset(doc, v) {
  const input = doc.input(v);
  if (!input) return { missing: true };
  const pdf = path.join(outDir, 'pdf', v.key, `${safe(doc.id)}.pdf`);
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.rmSync(pdf, { force: true });
  const env = { ...process.env, KUMIORI_LANG: 'ja', TZ: 'UTC', SOURCE_DATE_EPOCH: '946684800' };
  const r = await run(process.execPath, [...(v.freeze ? ['--import', pathToFileURL(freeze).href] : []), v.cli, input, '-o', pdf, '--font-cache', fontCache, ...doc.args(v)], {
    cwd: path.dirname(input),
    env,
    timeout: opt.timeout,
  });
  const ok = fs.existsSync(pdf);
  return {
    pdf: ok ? pdf : undefined,
    status: r.status,
    sec: Math.round(r.sec * 10) / 10,
    timedOut: r.timedOut,
    diagnostics: diagLines(r.stderr, v),
    error: ok ? undefined : (r.timedOut ? `${opt.timeout} 秒で止めた` : r.stderr.trim().split('\n').slice(-3).join(' / ')) || `終わりの番号 ${r.status}`,
  };
}

// ---- 比べる ----
const pageCount = async (pdf) => Number(/Pages:\s+(\d+)/.exec((await run('pdfinfo', [pdf])).stdout)?.[1] ?? 0);

/** ページごとの語 (字と位置。pdftotext -bbox) */
async function words(pdf) {
  const html = (await run('pdftotext', ['-bbox', pdf, '-'])).stdout;
  const pages = [];
  for (const p of html.split(/<page\b/).slice(1)) {
    const ws = [];
    for (const m of p.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g))
      ws.push({ t: m[5], k: `${(+m[1]).toFixed(2)},${(+m[2]).toFixed(2)},${(+m[3]).toFixed(2)},${(+m[4]).toFixed(2)}` });
    pages.push(ws);
  }
  return pages;
}

/** 字の比べ: 足した語・消した語・動いた語 (同じ字で位置の違う語) の数 */
function textDiff(a = [], b = []) {
  const key = (w) => `${w.t}@${w.k}`;
  const count = (ws, f) => ws.reduce((m, w) => m.set(f(w), (m.get(f(w)) ?? 0) + 1), new Map());
  if (a.length === b.length && a.every((w, i) => key(w) === key(b[i]))) return undefined;
  const ma = count(a, key);
  const mb = count(b, key);
  let onlyA = [];
  let onlyB = [];
  for (const w of a) if ((mb.get(key(w)) ?? 0) > 0) mb.set(key(w), mb.get(key(w)) - 1);
  else onlyA.push(w);
  for (const w of b) if ((ma.get(key(w)) ?? 0) > 0) ma.set(key(w), ma.get(key(w)) - 1);
  else onlyB.push(w);
  // 字が同じで位置だけ違う語は「動いた」
  const ta = count(onlyA, (w) => w.t);
  let moved = 0;
  const restB = [];
  for (const w of onlyB)
    if ((ta.get(w.t) ?? 0) > 0) {
      ta.set(w.t, ta.get(w.t) - 1);
      moved++;
    } else restB.push(w);
  const removed = [...ta.entries()].flatMap(([t, n]) => Array(n).fill(t));
  return {
    moved,
    added: restB.length,
    removed: removed.length,
    // 並びだけ違う (同じ語の集まりで順が違う) こともある
    sample: { added: restB.slice(0, 8).map((w) => w.t).join(' '), removed: removed.slice(0, 8).join(' ') },
  };
}

/** PDF のページを画像にする (グレー。<dir>/p-<番号>.png) */
async function rasterize(pdf, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await run('pdftoppm', ['-r', String(opt.dpi), '-gray', '-png', pdf, path.join(dir, 'p')]);
  const files = fs.readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f));
  return new Map(files.map((f) => [Number(/(\d+)/.exec(f)[1]), path.join(dir, f)]));
}

/** 2 枚の画像の差の画素の数 (輝度の差が 32 を超えるもの。大きさが違えば、はみ出しも差に数える) と、前・後・差を並べた絵 */
function pixelDiff(fa, fb, imageFile) {
  const a = fa ? PNG.sync.read(fs.readFileSync(fa)) : undefined;
  const b = fb ? PNG.sync.read(fs.readFileSync(fb)) : undefined;
  const w = Math.max(a?.width ?? 0, b?.width ?? 0);
  const h = Math.max(a?.height ?? 0, b?.height ?? 0);
  const at = (img, x, y) => (img && x < img.width && y < img.height ? img.data[(y * img.width + x) * 4] : 255);
  let bad = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(at(a, x, y) - at(b, x, y)) > 32) bad++;
  if (bad && imageFile) {
    const gap = 8;
    const out = new PNG({ width: w * 3 + gap * 2, height: h });
    out.data.fill(0xff);
    const put = (ox, x, y, r, g, bl) => {
      const i = (y * out.width + ox + x) * 4;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = bl;
      out.data[i + 3] = 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pa = at(a, x, y);
        const pb = at(b, x, y);
        put(0, x, y, pa, pa, pa);
        put(w + gap, x, y, pb, pb, pb);
        // 差: 後にだけある (後が濃い) 所は赤、前にだけある所は青、同じ所は薄いグレー
        if (Math.abs(pa - pb) > 32) pb < pa ? put(2 * (w + gap), x, y, 220, 30, 30) : put(2 * (w + gap), x, y, 30, 80, 220);
        else {
          const g = 255 - Math.round((255 - Math.min(pa, pb)) * 0.25);
          put(2 * (w + gap), x, y, g, g, g);
        }
      }
      for (const ox of [w, 2 * w + gap]) for (let x = 0; x < gap; x++) put(ox, x, y, 200, 200, 200);
    }
    fs.mkdirSync(path.dirname(imageFile), { recursive: true });
    fs.writeFileSync(imageFile, PNG.sync.write(out));
  }
  return { bad, ratio: w * h ? bad / (w * h) : 0 };
}

async function compareDoc(doc, ra, rb) {
  const res = { id: doc.id, group: doc.group, sec: { base: ra.sec, head: rb.sec } };
  if (ra.missing || rb.missing) return { ...res, status: ra.missing && rb.missing ? 'missing' : ra.missing ? 'only-head' : 'only-base' };
  const diag = {
    added: rb.diagnostics.filter((l) => !ra.diagnostics.includes(l)),
    removed: ra.diagnostics.filter((l) => !rb.diagnostics.includes(l)),
  };
  if (diag.added.length || diag.removed.length) res.diagnostics = diag;
  if (!ra.pdf || !rb.pdf) return { ...res, status: 'error', error: { base: ra.error, head: rb.error } };
  const ba = fs.readFileSync(ra.pdf);
  const bb = fs.readFileSync(rb.pdf);
  res.pages = { base: await pageCount(ra.pdf), head: await pageCount(rb.pdf) };
  if (sha256(ba) === sha256(bb)) return { ...res, status: res.diagnostics ? 'diagnostics' : 'same', bytes: 'same' };
  res.bytes = 'different';
  const tmp = path.join(outDir, 'tmp', safe(doc.id));
  const [wa, wb, ia, ib] = await Promise.all([words(ra.pdf), words(rb.pdf), rasterize(ra.pdf, path.join(tmp, 'base')), rasterize(rb.pdf, path.join(tmp, 'head'))]);
  const n = Math.max(res.pages.base, res.pages.head);
  res.changedPages = [];
  let images = 0;
  for (let p = 1; p <= n; p++) {
    const text = textDiff(wa[p - 1], wb[p - 1]);
    const image = images < opt.maxImages ? path.join(outDir, 'images', `${safe(doc.id)}-p${p}.png`) : undefined;
    const px = pixelDiff(ia.get(p), ib.get(p), image);
    if (!text && !px.bad) continue;
    const page = { page: p, ...(text ? { text } : {}), pixels: Math.round(px.ratio * 100000) / 1000 };
    if (px.bad && image) {
      page.image = path.relative(outDir, image).split(path.sep).join('/');
      images++;
    }
    res.changedPages.push(page);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const changed = res.pages.base !== res.pages.head || res.changedPages.length > 0;
  // バイトは違うが、ページ数・字・絵 (グレーの画素) が同じ文書は「見た目は同じ」(looks-same) とし、バイトも同じ文書 (same) と分ける。
  // 輝度の近い色 (CMYK・特色・ICC) や、出力の決まり (OutputIntent)・XMP・タグ付きの構造・注釈・しおりだけの変わりは、ここに入る
  return { ...res, status: changed ? 'changed' : res.diagnostics ? 'diagnostics' : 'looks-same' };
}

// ---- 報告 ----
function writeReport(revs, results, totalSec) {
  const [b, h] = revs;
  const by = (s) => results.filter((r) => r.status === s);
  const groupCount = Object.fromEntries(groups.map((g) => [g, results.filter((r) => r.group === g).length]).filter(([, n]) => n));
  const json = { base: { rev: opt.base, sha: b.sha, label: b.label }, head: { rev: opt.head, sha: h.sha, label: h.label }, dpi: opt.dpi, groups: groupCount, skipped, notes, totalSec, results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(json, null, 2) + '\n');
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const pagesOf = (r) => (r.pages ? (r.pages.base === r.pages.head ? `${r.pages.base}` : `${r.pages.base} → ${r.pages.head} ⚠`) : '—');
  const pageList = (r) => {
    const ps = (r.changedPages ?? []).map((p) => p.page);
    if (ps.length <= 12) return ps.join('・');
    return `${ps.slice(0, 12).join('・')} ほか ${ps.length - 12} ページ`;
  };
  const md = [
    '# 前と後の組み比べ',
    '',
    `- 前 (--base ${opt.base}): ${b.label}`,
    `- 後 (--head ${opt.head}): ${h.label}`,
    `- 組んだ文書: ${results.length} (${Object.entries(groupCount).map(([g, n]) => `${g} ${n}`).join('・')})。${Math.round(totalSec)} 秒`,
    `- 変わった文書: ${by('changed').length}。バイトも同じ: ${by('same').length}。見た目は同じ (バイトは違う): ${by('looks-same').length}。警告・誤りだけ変わった: ${by('diagnostics').length}。組めなかった: ${by('error').length}。片方だけ: ${by('only-base').length + by('only-head').length}`,
    ...notes.map((n) => `- ${n}`),
    ...(skipped.length ? ['', '## 飛ばした群', '', ...skipped.map((s) => `- ${s.group}: ${s.reason}`)] : []),
    '',
    '## 変わった文書',
    '',
    ...(by('changed').length
      ? [
          '| 群 | 文書 | ページ数 (前 → 後) | 変わったページ | 字の変わったページ | 絵の変わったページ |',
          '|---|---|---|---|---|---|',
          ...by('changed').map(
            (r) =>
              `| ${r.group} | ${esc(r.id)} | ${pagesOf(r)} | ${pageList(r) || '(ページ数だけ)'} | ${r.changedPages.filter((p) => p.text).length} | ${r.changedPages.filter((p) => p.pixels > 0).length} |`,
          ),
        ]
      : ['(無い)']),
    ...(by('looks-same').length
      ? [
          '',
          '## 見た目は同じでバイトの違う文書',
          '',
          'ページ数・字・絵 (グレーの画素) は同じだが、PDF のバイトが違う。輝度の近い色・出力の決まり (OutputIntent)・XMP・タグ付きの構造・注釈・しおりなどの変わりは、この比べ方では見えないので、要るときは pdfinfo・veraPDF などで別に確かめる。',
          '',
          ...by('looks-same').map((r) => `- ${r.group}: ${r.id}`),
        ]
      : []),
    ...(by('error').length
      ? ['', '## 組めなかった文書', '', '| 群 | 文書 | 前 | 後 |', '|---|---|---|---|', ...by('error').map((r) => `| ${r.group} | ${esc(r.id)} | ${esc(r.error.base ?? '組めた')} | ${esc(r.error.head ?? '組めた')} |`)]
      : []),
    ...(by('only-base').length + by('only-head').length
      ? ['', '## 片方の版にだけある文書', '', ...[...by('only-base'), ...by('only-head')].map((r) => `- ${r.id} (${r.status === 'only-base' ? '前' : '後'}にだけある)`)]
      : []),
    ...(results.some((r) => r.diagnostics)
      ? [
          '',
          '## 警告・誤りの変わった文書',
          '',
          ...results
            .filter((r) => r.diagnostics)
            .flatMap((r) => [`- ${r.id}`, ...r.diagnostics.added.slice(0, 10).map((l) => `  - 足された: ${l}`), ...r.diagnostics.removed.slice(0, 10).map((l) => `  - 消えた: ${l}`)]),
        ]
      : []),
    ...(() => {
      // 組版の秒が 1.5 倍を超えて (2 秒以上) 遅くなった文書
      const slow = results.filter((r) => r.sec?.base && r.sec?.head && r.sec.head >= 2 && r.sec.head > r.sec.base * 1.5);
      // 並べて 1 度ずつ組んだ壁の時計の秒なので、揺れを含む。確かめは、交互に何度も測る npm run perf:compare (scripts/perf-compare.mjs) で
      return slow.length
        ? [
            '',
            '## 遅くなった文書 (組版の秒が 1.5 倍を超えたもの)',
            '',
            ...slow.map((r) => `- ${r.id}: ${r.sec.base} 秒 → ${r.sec.head} 秒`),
            '',
            '並べて 1 度ずつ組んだ秒なので、機械の揺れを含む。本当に遅いかは、`npm run perf:compare -- --base <前> --head <後>` (前と後を交互に何度も測る) で確かめる。',
          ]
        : [];
    })(),
    ...(by('changed').length
      ? [
          '',
          '## 変わったページ',
          '',
          '並べた絵は、左から前・後・差 (赤は後にだけある字や線、青は前にだけあるもの)。字は pdftotext の語で比べた数 (動いた: 同じ字で位置が違う語)。',
          ...by('changed').flatMap((r) => [
            '',
            `### ${r.id}`,
            '',
            ...(r.pages.base !== r.pages.head ? [`ページ数 ${r.pages.base} → ${r.pages.head}`, ''] : []),
            ...r.changedPages.map((p) => {
              const t = p.text ? `字: 動いた ${p.text.moved}・足した ${p.text.added}・消した ${p.text.removed}${p.text.sample.added ? ` (足した語: ${esc(p.text.sample.added)})` : ''}${p.text.sample.removed ? ` (消した語: ${esc(p.text.sample.removed)})` : ''}` : '字: 同じ';
              return `- ${p.page} ページ: ${t}。絵: ${p.pixels > 0 ? `差 ${p.pixels}%` : '同じ'}${p.image ? ` ([並べた絵](${p.image}))` : ''}`;
            }),
          ]),
        ]
      : []),
  ];
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n') + '\n');
}

// ---- 本体 ----
const t0 = Date.now();
let revs;
try {
  fs.mkdirSync(outDir, { recursive: true });
  for (const d of ['pdf', 'images', 'work', 'tmp']) fs.rmSync(path.join(outDir, d), { recursive: true, force: true });
  revs = [prepare('base', opt.base), prepare('head', opt.head)];
  if (revs[0].sha === revs[1].sha) console.log('注意: 前と後が同じコミットです');
  const docs = await listDocs(revs);
  for (const s of skipped) console.log(`飛ばす: ${s.group} (${s.reason})`);
  console.log(`${docs.length} 個の文書を、前と後で組みます (同時に ${opt.jobs} つ)`);
  const tasks = docs.flatMap((d) => revs.map((v) => ({ d, v })));
  const out = new Map();
  let done = 0;
  // 大きい文書 (対応仕様説明書・CSS-Print) を先に組む (終わりに長い 1 つだけが残らないように)
  const weight = (t) => (t.d.group === 'conformance' || t.d.group === 'css-print' ? 0 : 1);
  tasks.sort((a, b) => weight(a) - weight(b));
  await pool(tasks, opt.jobs, async ({ d, v }) => {
    out.set(`${v.key}:${d.id}`, await typeset(d, v));
    if (++done % 20 === 0 || done === tasks.length) console.log(`  組んだ: ${done} / ${tasks.length}`);
  });
  console.log('比べています');
  const results = [];
  await pool(docs, opt.jobs, async (d) => {
    results.push(await compareDoc(d, out.get(`base:${d.id}`), out.get(`head:${d.id}`)));
  });
  const order = new Map(docs.map((d, i) => [d.id, i]));
  results.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || order.get(a.id) - order.get(b.id));
  fs.rmSync(path.join(outDir, 'tmp'), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, 'work'), { recursive: true, force: true });
  writeReport(revs, results, (Date.now() - t0) / 1000);
  const changed = results.filter((r) => r.status === 'changed');
  console.log(`\n変わった文書: ${changed.length} / ${results.length}${changed.length ? ` (${changed.map((r) => r.id).join('、')})` : ''}`);
  const looks = results.filter((r) => r.status === 'looks-same').length;
  if (looks) console.log(`見た目は同じでバイトの違う文書: ${looks} (色・構造・メタデータの変わりは、この比べ方では見えない。report.md を見る)`);
  console.log(`${path.join(outDir, 'report.md')} に書き出しました`);
} finally {
  cleanup();
}
