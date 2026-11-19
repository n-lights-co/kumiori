/**
 * ci-local — CI (.github/workflows/ci.yml) のジョブと、GitHub Pages (.github/workflows/pages.yml) の画面のビルドと同じ手順を、手元で走らせる。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/ci-local.mjs                     (npm run ci:local と同じ。build・pages・e2e のジョブ。node-min は Node の下限に切り替えて、下のように別に走らせる)
 *   node scripts/ci-local.mjs --job node-min      (Node の下限のジョブ。Node 20.19.x で走らせる)
 *   node scripts/ci-local.mjs --job build --job e2e --no-install --worktree
 *
 *  - --job <名前> (何度でも): 走らせるジョブ (build・pages・node-min・e2e)。無ければ build・pages・e2e。
 *    node-min は、動かせる Node の下限 (package.json の engines) で確かめるジョブなので、Node 20.19.x で走らせたときだけ動く
 *    (このスクリプトは Node を切り替えない。nvm などで切り替えてから走らせる)。
 *    pages は、pages.yml の build のジョブと同じく、アセットの土台 (base) をリポジトリ名にして画面を作る (下の pagesBase)。
 *    出力は一時の場所に出して、終われば消す (build のジョブの dist/ と混ざらず、dist/ も変えない)
 *  - --no-install: 初めの npm ci (package-lock.json のとおりに依存を入れ直す) をしない
 *  - --worktree: いまのコミット (HEAD) を一時的な場所に取り出して (git worktree)、そこで走らせる。CI と同じく、コミットした中身だけを試す
 *    (まだコミットしていない変更・前のビルドの出力 (dist-*) が混ざらない)。終われば取り出した場所を消す。
 *    テストの書体・Unicode の適合試験・e2e の書体の置き場は、このリポジトリの .cache を使う (取り直さない)
 *
 * ジョブの手順は ci.yml・pages.yml と同じ (actions/checkout・setup-node・cache・upload-pages-artifact・Pages への配置は、手元に当たるものが無いので除く)。
 * ci.yml・pages.yml を変えたら、下の JOBS も合わせる。1 つのジョブの中では、失敗した手順で止め、次のジョブへ進む (CI のジョブは互いに別に動くため)。
 * e2e の Chromium は入れない (CI の npx playwright install --with-deps chromium に当たる)。初めは npx playwright install chromium を走らせるか、
 * KUMIORI_CHROMIUM で入っている Chromium を指す (scripts/chromium.mjs)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellArg } from './shellArg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * npm の呼び方。npm run ci:local で走らせたときは、npm が子のプロセスに渡す npm_execpath (npm の本体 npm-cli.js) を、
 * いま動いている Node (process.execPath) で直に動かす (node <npm-cli.js> run build のように、shell を通さない)。
 * OS によらず同じ呼び方になり、Windows でも npm.cmd (バッチファイル) を動かさないので shell が要らず、引数を囲まずにそのまま渡せる
 * (Node 24 からの、shell: true に引数の並びを渡す呼び方の非推奨 (DEP0190) にも当たらない)。npm がこのスクリプトと同じ Node で動くので、
 * node-min のジョブで PATH の先頭に Node の下限を置いたときも、途中で別の版の Node に替わらない。
 * node scripts/ci-local.mjs で直に走らせたとき (npm_execpath が無い) と、npm でない道具 (yarn・pnpm) から走らせたときは、PATH の npm を呼ぶ:
 * Windows の npm は npm.cmd で、Node は .cmd・.bat を shell なしで動かすのを拒む (CVE-2024-27980 への対応) ので shell を通し、
 * 引数は shellArg で囲む (一時の場所のパスに空白が入ることがある。囲み方は scripts/shellArg.mjs)
 */
const npmCli = process.env.npm_execpath && /(?:^|[\\/])npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : undefined;
const npm = (args, opts) =>
  npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], opts)
    : spawnSync('npm', args.map((a) => shellArg(a)), { ...opts, shell: process.platform === 'win32' });

/**
 * pages.yml の Build と同じ土台 (base)。pages.yml は github.event.repository.name (動いたリポジトリの名前) から
 * /<リポジトリ名>/ を作る (<アカウント>.github.io という名前のリポジトリなら /)。
 * 手元にはそれに当たるものが無いので、package.json の repository.url (無ければ homepage) の GitHub のリポジトリ名から作る。
 * 画面が実際に置かれるのは公開のリポジトリ (kumiori) の Pages で、package.json はそのリポジトリを指しているため
 * (開発用のリポジトリの名前や、取り出した場所のディレクトリの名前は、置かれる URL と関わりが無い)
 */
function pagesBase(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const urls = [typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url, pkg.homepage];
  for (const u of urls) {
    const m = typeof u === 'string' && /github\.com[/:][^/]+\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/.exec(u);
    if (m) return m[1].endsWith('.github.io') ? '/' : `/${m[1]}/`;
  }
  throw new Error('package.json の repository.url・homepage から GitHub のリポジトリ名が取れません');
}

/** pages のジョブの出力の場所 (一時の場所。ジョブを走らせるときに作り、終われば消す) */
let pagesOut;

/**
 * pages のジョブで作った index.html の、アセットの参照 (src・href) が土台で始まることを確かめる
 * (土台が効いていない・絶対の /assets/… で書いたものが残っている、という誤りを見つける)。
 * 確かめるのは index.html の参照だけで、JS の中で組み立てるパス (分かれたチャンク・worker・fetch で読むファイル) は確かめない
 */
function checkPagesBase(base) {
  const html = fs.readFileSync(path.join(pagesOut, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((r) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r));
  const bad = refs.filter((r) => !r.startsWith(base));
  if (bad.length) console.error(`土台 ${base} で始まらない参照: ${bad.join(' ')}`);
  if (!refs.some((r) => r.startsWith(`${base}assets/`))) {
    console.error(`${base}assets/ を指す参照がありません`);
    return false;
  }
  console.log(`index.html の参照 ${refs.length} 個は、どれも ${base} で始まる`);
  return !bad.length;
}

/**
 * ci.yml・pages.yml のジョブ (npm ci の後の手順)。
 * 手順は npm の引数の配列か、それを返す関数 (走らせる場所 dir を受け取る)、または { label, fn } (このスクリプトの中で確かめるもの。真を返せば通った)
 */
const JOBS = {
  // Node 22。画面・ライブラリ・ブラウザ用の 1 ファイルを作り、単体テスト (中で Node のコマンドも作る) を走らせる
  build: [['run', 'build'], ['run', 'build:lib'], ['run', 'build:browser'], ['test']],
  // pages.yml の build のジョブ。土台をリポジトリ名にした画面のビルド (npx vite build --base=… に当たる) と、その土台が効いていることの確かめ
  pages: [
    (dir) => {
      pagesOut = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-ci-pages-'));
      return ['exec', '--', 'vite', 'build', `--base=${pagesBase(dir)}`, '--outDir', pagesOut, '--emptyOutDir'];
    },
    { label: '土台の確かめ (index.html のアセットの参照)', fn: (dir) => checkPagesBase(pagesBase(dir)) },
  ],
  // Node の下限 (20.19.0)。型の検査と単体テスト (require('kumiori') の確かめは dist-lib を読む)
  'node-min': [['run', 'typecheck'], ['run', 'build:lib'], ['run', 'build:browser'], ['test']],
  // ブラウザでの結合テスト (dist-browser も読んで試す)
  e2e: [['run', 'build:browser'], ['run', 'e2e']],
};

function usage(message) {
  if (message) console.error(message);
  console.error('使い方: node scripts/ci-local.mjs [--job build|pages|node-min|e2e]... [--no-install] [--worktree]');
  process.exit(2);
}

const jobs = [];
let install = true;
let worktree = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--job') {
    const v = argv[++i];
    if (!v || !Object.hasOwn(JOBS, v)) usage(`--job は ${Object.keys(JOBS).join('・')} のどれか: ${v ?? '(無い)'}`);
    if (!jobs.includes(v)) jobs.push(v);
  } else if (a === '--no-install') install = false;
  else if (a === '--worktree') worktree = true;
  else if (a === '--help' || a === '-h') usage();
  else usage(`知らない選択肢: ${a}`);
}
if (!jobs.length) jobs.push('build', 'pages', 'e2e');

// node-min は Node 20.19.x で走らせたときだけ (ほかの版で走らせても、下限で確かめたことにならない)
const [major, minor] = process.versions.node.split('.').map(Number);
if (jobs.includes('node-min') && !(major === 20 && minor === 19)) {
  console.error(`node-min のジョブは Node 20.19.x で走らせてください (いまは ${process.version})。例: nvm install 20.19.0 && nvm use 20.19.0`);
  process.exit(2);
}

const git = (args, cwd = root) => spawnSync('git', args, { cwd, encoding: 'utf8' });

let cwd = root;
const env = { ...process.env };
// e2e の書体を覚えておく場所 (ci.yml の e2e の KUMIORI_E2E_FONT_CACHE と同じ)
env.KUMIORI_E2E_FONT_CACHE ??= path.join(root, '.cache', 'e2e-fonts');
if (worktree) {
  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (dirty) console.log('注意: まだコミットしていない変更は試しません (--worktree は HEAD を取り出して試す)');
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-ci-'));
  const r = git(['worktree', 'add', '--detach', cwd, 'HEAD']);
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  // 書体・Unicode の適合試験は、このリポジトリの .cache を使う (取り出した場所で取り直さない)
  env.KUMIORI_FONT_DIR ??= path.join(root, '.cache', 'fonts');
  env.KUMIORI_UCD_DIR ??= path.join(root, '.cache', 'unicode');
  console.log(`HEAD (${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}) を ${cwd} に取り出して試します`);
}

/** 走らせた手順の結果 (最後に並べる) */
const results = [];
const run = (job, step) => {
  const t0 = Date.now();
  let label = typeof step === 'object' && !Array.isArray(step) ? step.label : '';
  let ok;
  try {
    if (label) {
      console.log(`\n▶ [${job}] ${label}`);
      ok = step.fn(cwd) === true;
    } else {
      const args = typeof step === 'function' ? step(cwd) : step;
      label = `npm ${args.join(' ')}`;
      console.log(`\n▶ [${job}] ${label}`);
      ok = npm(args, { cwd, env, stdio: 'inherit' }).status === 0;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    label ||= '(手順の準備)';
    ok = false;
  }
  results.push({ job, label, ok, sec: Math.round((Date.now() - t0) / 1000) });
  return ok;
};

let failed = false;
try {
  if (install && !run('install', ['ci'])) failed = true;
  else
    for (const job of jobs) {
      for (const step of JOBS[job])
        if (!run(job, step)) {
          failed = true;
          break;
        }
    }
} finally {
  if (pagesOut) fs.rmSync(pagesOut, { recursive: true, force: true });
  if (worktree) {
    git(['worktree', 'remove', '--force', cwd]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

console.log('\n結果:');
for (const r of results) console.log(`  ${r.ok ? '○' : '×'} [${r.job}] ${r.label} (${r.sec} 秒)`);
const skipped = jobs.filter((j) => !results.some((r) => r.job === j));
if (skipped.length) console.log(`  (走らせなかったジョブ: ${skipped.join('・')})`);
console.log(failed ? '失敗した手順があります' : 'すべて通りました');
process.exit(failed ? 1 : 0);
