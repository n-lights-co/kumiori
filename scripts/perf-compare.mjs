#!/usr/bin/env node
/**
 * perf-compare — 前のコミット (--base) と後のコミット (--head) の組版の時間を、同じ機械で交互に測り比べ、後が大きく遅いときに知らせる (npm run perf:compare)。
 * 組版を遅くする変更 (組み直しの回の増え・2 乗の手間の戻り・止める合図の確かめの手間など) を、主な文書で見つけるための道具。
 *
 * 使い方 (リポジトリの直下で):
 *   npm run perf:compare -- --base <コミット> [--head <コミット>|.] [--doc <名前>]... [--rounds N] [--runs N] [--threshold 比] [--json <file>] [--no-fail]
 *
 *  - --base・--head: 比べる 2 つのコミット (git rev-parse で読める名前)。--head の既定は HEAD。. は作業の場所のいまのファイル (まだコミットしていない変更を含む)
 *  - --doc: 組む文書 (scripts/profile-relayout.mjs の --doc と同じ名前)。既定は対応仕様説明書の HTML と XSL-FO (html-spec・fo-spec) と、
 *    種を決めた乱数の文書のうち、表・規則・段落・XSL-FO の入れ子 (gen:table・gen:rules・gen:para・gen:fonest)。文書と書体は、どちらのコミットでも、
 *    このリポジトリ (作業の場所) のものを組む (同じ入力で、組版のコードだけを比べる)
 *  - --rounds: 前と後を交互に測る組の数 (既定 5)。--runs: 1 つのプロセスで 1 つの文書を組む回数 (既定 3。初めの回は温まっていないので捨て、残りの一番短い値を、その組の値にする)
 *  - --threshold: 遅いと見る比 (既定 1.1)。--json: 結果を JSON で書く。--no-fail: 遅い文書があっても、終わりの状態を 0 にする
 *
 * 機械の揺れの扱い:
 *  - 測るのは組版 (typeset) の CPU の時間 (組むスレッドの process.threadCpuUsage の差。ほかのプロセスに CPU を取られて待った時間と、GC のほかのスレッドの時間が入らない)。
 *    壁の時計の時間も並べて書く
 *  - 前と後を、組ごとに順を入れ替えて交互に測る (前・後、後・前、…)。機械の速さが測る間に変わっても (ほかの仕事・熱・クラウドの隣の仕事)、両方に同じように入る
 *  - 1 つの組の中で、同じ文書を --runs 回組み、温まった回の一番短い値を取る (遅れの揺れは足し算でしか入らない)
 *  - 組ごとの比 (後 ÷ 前) の中央値を比とし、比が --threshold を超え、かつ組の 8 割以上で後のほうが遅いときに「遅い」とする
 *    (1 つの組だけが揺れて大きく遅くても、遅いとしない)
 *
 * npm run compare:base との分け方: compare:base は、多くの文書 (見本を含む) を 1 度ずつ並べて組み、組版の秒が 1.5 倍を超えた文書を報告に書く (粗い見張り)。
 * この道具は、主な数個の文書を、交互に何度も測り、1 割ほどの違いを見分ける (細かい確かめ)。compare:base の報告に遅い文書が出たら、この道具で確かめる。
 * リリースの前に、前のリリースのタグと比べる (docs/development.md の「組版の時間の比べ」)。
 *
 * 必要なもの: git。コミットを一時的な場所に取り出し (git worktree)、そこで scripts/profile-relayout.mjs の --src のビルドを作る
 * (依存は、コミットの package-lock.json がいまのものと同じなら、このリポジトリの node_modules を使い、違えば一時的な場所に npm ci で入れる)。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profiler = path.join(root, 'scripts', 'profile-relayout.mjs');

function usage(message) {
  if (message) console.error(message);
  console.error('使い方: npm run perf:compare -- --base <コミット> [--head <コミット>|.] [--doc <名前>]... [--rounds N] [--runs N] [--threshold 比] [--json <file>] [--no-fail]');
  process.exit(2);
}
const opt = { head: 'HEAD', docs: [], rounds: 5, runs: 3, threshold: 1.1, fail: true };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i] ?? usage(`${a} に値がありません`);
    if (a === '--base') opt.base = v();
    else if (a === '--head') opt.head = v();
    else if (a === '--doc') opt.docs.push(v());
    else if (a === '--rounds') opt.rounds = Number(v());
    else if (a === '--runs') opt.runs = Number(v());
    else if (a === '--threshold') opt.threshold = Number(v());
    else if (a === '--json') opt.json = path.resolve(v());
    else if (a === '--no-fail') opt.fail = false;
    else if (a === '--help' || a === '-h') usage();
    else usage(`知らない選択肢: ${a}`);
  }
  if (!opt.base) usage('--base がありません');
  if (!(opt.rounds >= 1) || !(opt.runs >= 2) || !(opt.threshold > 1)) usage('--rounds は 1 以上、--runs は 2 以上、--threshold は 1 より大きい数');
  if (!opt.docs.length) opt.docs = ['html-spec', 'fo-spec', 'gen:table', 'gen:rules', 'gen:para', 'gen:fonest'];
}

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
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

/** 比べる版を用意し、profile-relayout のビルドを作る: { key, label, dir } */
function prepare(key, rev) {
  let dir = root;
  let label;
  if (rev === '.') label = `作業の場所 (${git(['rev-parse', '--short', 'HEAD']).stdout.trim()} とまだコミットしていない変更)`;
  else {
    const r = git(['rev-parse', '--verify', `${rev}^{commit}`]);
    if (r.status !== 0) throw new Error(`[${key}] コミット ${rev} がありません`);
    const sha = r.stdout.trim();
    label = `${sha.slice(0, 7)} ${git(['log', '-1', '--format=%s', sha]).stdout.trim()}`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `kumiori-perf-${key}-`));
    const w = git(['worktree', 'add', '--detach', dir, sha]);
    if (w.status !== 0) throw new Error(`[${key}] 取り出せませんでした: ${w.stderr}`);
    worktrees.push(dir);
    const lock = (d) => (fs.existsSync(path.join(d, 'package-lock.json')) ? fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8') : '');
    if (lock(dir) === lock(root) && fs.existsSync(path.join(root, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    else {
      console.log(`[${key}] 依存がいまと違うので、${dir} に npm ci で入れます`);
      const i = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
      if (i.status !== 0) throw new Error(`[${key}] 依存を入れられませんでした`);
    }
  }
  console.log(`[${key}] ${label}: 組版のビルドを作ります`);
  const b = spawnSync(process.execPath, [profiler, '--src', dir, '--build-only'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  if (b.status !== 0) throw new Error(`[${key}] ビルドを作れませんでした`);
  return { key, label, dir };
}

/** 1 つの組の片方: 1 つのプロセスで、文書ごとに --runs 回組み、温まった回の一番短い値 (CPU と壁の時計) と、ページ数を返す */
function measure(v, round) {
  const out = path.join(os.tmpdir(), `kumiori-perf-${process.pid}-${v.key}-${round}.json`);
  const r = spawnSync(
    process.execPath,
    [profiler, '--src', v.dir, '--no-build', '--no-profile', '--no-pdf', '--pages', '0', '--runs', String(opt.runs), '--json', out, ...opt.docs.flatMap((d) => ['--doc', d])],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (r.status !== 0) throw new Error(`[${v.key}] 組めませんでした:\n${r.stderr.trim().split('\n').slice(-5).join('\n')}`);
  const rows = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  const res = {};
  for (const d of opt.docs) {
    const warm = rows.filter((x) => x.doc === d && x.run > 1);
    res[d] = { cpu: Math.min(...warm.map((x) => x.typesetCpu)), wall: Math.min(...warm.map((x) => x.typeset)), pages: warm[0]?.pages };
  }
  return res;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

let exitCode = 0;
try {
  const base = prepare('base', opt.base);
  const head = prepare('head', opt.head);
  const samples = { base: [], head: [] };
  for (let i = 0; i < opt.rounds; i++) {
    // 組ごとに順を入れ替える (前・後、後・前、…)
    for (const v of i % 2 ? [head, base] : [base, head]) {
      const t0 = Date.now();
      samples[v.key].push(measure(v, i));
      console.log(`  組 ${i + 1}/${opt.rounds} ${v.key === 'base' ? '前' : '後'}: ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    }
  }
  const results = opt.docs.map((doc) => {
    const b = samples.base.map((s) => s[doc]);
    const h = samples.head.map((s) => s[doc]);
    const pairs = b.map((x, i) => h[i].cpu / x.cpu);
    const ratio = median(pairs);
    const slowerShare = pairs.filter((p) => p > 1).length / pairs.length;
    const verdict = ratio > opt.threshold && slowerShare >= 0.8 ? '遅い' : ratio < 1 / opt.threshold && slowerShare <= 0.2 ? '速い' : '同じほど';
    return {
      doc,
      pages: { base: b[0].pages, head: h[0].pages },
      cpuMs: { base: median(b.map((x) => x.cpu)), head: median(h.map((x) => x.cpu)) },
      wallMs: { base: median(b.map((x) => x.wall)), head: median(h.map((x) => x.wall)) },
      ratio,
      pairs,
      slowerShare,
      verdict,
    };
  });
  const f = (ms) => `${Math.round(ms).toLocaleString('en-US')}ms`;
  const lines = [
    `# 組版の時間の比べ`,
    '',
    `- 前: ${base.label}`,
    `- 後: ${head.label}`,
    `- ${opt.rounds} 組を交互に測った (1 組で文書ごとに ${opt.runs} 回組み、温まった回の一番短い値)。比は組ごとの比 (後 ÷ 前。CPU の時間) の中央値。` +
      `比が ${opt.threshold} を超え、組の 8 割以上で後が遅いときに「遅い」とする`,
    '',
    '| 文書 | ページ (前→後) | CPU (前) | CPU (後) | 比 | 組ごとの比 | 壁の時計 (前→後) | 見立て |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.doc} | ${r.pages.base}${r.pages.head !== r.pages.base ? `→${r.pages.head}` : ''} | ${f(r.cpuMs.base)} | ${f(r.cpuMs.head)} | ${r.ratio.toFixed(3)} | ${r.pairs.map((p) => p.toFixed(2)).join(' ')} | ${f(r.wallMs.base)}→${f(r.wallMs.head)} | ${r.verdict} |`,
    ),
  ];
  console.log(`\n${lines.join('\n')}`);
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ base: base.label, head: head.label, rounds: opt.rounds, runs: opt.runs, threshold: opt.threshold, results }, null, 1));
  if (results.some((r) => r.verdict === '遅い')) {
    console.log(`\n後のほうが遅い文書: ${results.filter((r) => r.verdict === '遅い').map((r) => r.doc).join('・')}`);
    if (opt.fail) exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  exitCode = 2;
} finally {
  cleanup();
}
process.exit(exitCode);
