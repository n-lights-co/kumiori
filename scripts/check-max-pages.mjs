#!/usr/bin/env node
/**
 * check-max-pages — 先頭から N ページで止めて組んだ (--max-pages N) 1〜N ページが、全体を組んだときの 1〜N ページと同じかを、文書ごとに数える。
 * 違うページは、その理由で分ける (N より後ろを指す参照の字だけが違うのか、行分けまで変わったのか)。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/check-max-pages.mjs [--pages 1,3,10] [--only <群>,…] [--filter <正規表現>] [--jobs <数>] [--dpi <解像度>]
 *                                    [--samples <dir>] [--weasyprint <dir>] [--out <dir>] [--timeout <秒>]
 *
 *  - Node のコマンド (dist-cli/cli.js。無ければ npm run build:cli で作る) で、文書を全体と --max-pages N で組み、PDF を比べる。
 *  - 組む文書の群 (--only で選ぶ。見本が手元に無い群は飛ばす):
 *      ah         … アンテナハウスのサンプル FO 集 (.cache/samples/fo/samples。--compat antenna)
 *      css-print  … 『CSSページ組版入門』第 4 版 (.cache/samples/css-print/src。--style ah)
 *      weasyprint … WeasyPrint の見本 (既定はリポジトリの隣の weasyprint-samples。--style weasyprint。scripts/compare-base.mjs と同じ 8 つ)
 *      conformance… 対応仕様説明書 (docs/conformance の HTML と XSL-FO。コードの表示を差し込まずに組む)
 *    見本は他の人の著作物なので、リポジトリには入れない (CLAUDE.md の「見本と書体の置き場」)。書体は既定の書体 (.cache/fonts) で組む。
 *  - 比べ方 (ページごと): ページの字 (pdftotext -bbox の語と位置。0.01pt で丸める) と、絵 (pdftoppm の --dpi (既定 40) のグレーの画素) が
 *    どちらも同じなら「同じ」。違えば、次のどれかに分ける:
 *      ref      … 参照の字だけ: 行の並び (語の上端の位置の集まり) が同じで、数字・"?"・リーダーの点を除けば、語の並びも同じ
 *                 (N より後ろを指す参照の字が "?" になり、同じ行の中で後ろの字とリーダーの長さが変わった)
 *      reflow   … 行分けまで変わった: 行の並びか、数字と "?" のほかの語が違う
 *      image    … 字は同じで、絵だけ違う
 *    N より後ろを指す参照の警告 (layout/beyond-max-pages) が出なかったのに違うページは、「理由の分からない違い」として別に数える
 *    (組版の作りの誤りの疑い)。
 * 出力: <出力先> (既定 .cache/check-max-pages) の report.md・report.json。終わりに要約を標準出力に書く。
 * 必要なもの: poppler (pdfinfo・pdftotext・pdftoppm)。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 時計と乱数を止める前読み (scripts/compare-base.mjs と同じ。組むたびに同じ PDF にして、組み比べの揺れを無くす) */
const freeze = path.join(root, 'scripts', 'compare-base-freeze.mjs');
const GROUPS = ['ah', 'css-print', 'weasyprint', 'conformance'];

// ---- 引数 ----
const opt = { pages: [1, 3, 10], only: GROUPS, filter: undefined, jobs: Math.max(1, Math.min(4, os.cpus().length)), dpi: 40, timeout: 600 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => {
    const x = process.argv[++i];
    if (x === undefined) throw new Error(`${a} に値がありません`);
    return x;
  };
  if (a === '--pages') opt.pages = v().split(',').map((x) => Number(x));
  else if (a === '--only') opt.only = v().split(',');
  else if (a === '--filter') opt.filter = new RegExp(v());
  else if (a === '--jobs') opt.jobs = Number(v());
  else if (a === '--dpi') opt.dpi = Number(v());
  else if (a === '--samples') opt.samples = v();
  else if (a === '--weasyprint') opt.weasyprint = v();
  else if (a === '--out') opt.out = v();
  else if (a === '--timeout') opt.timeout = Number(v());
  else if (a === '--help' || a === '-h') {
    console.log('使い方: node scripts/check-max-pages.mjs [--pages 1,3,10] [--only ah,css-print,weasyprint,conformance] [--filter <正規表現>] [--jobs <数>] [--dpi <解像度>] [--samples <dir>] [--weasyprint <dir>] [--out <dir>] [--timeout <秒>]');
    process.exit(0);
  } else throw new Error(`知らない引数: ${a}`);
}
if (!opt.pages.every((n) => Number.isSafeInteger(n) && n >= 1)) throw new Error('--pages は 1 以上の整数をカンマで区切る');
for (const g of opt.only) if (!GROUPS.includes(g)) throw new Error(`知らない群: ${g} (${GROUPS.join('・')})`);
const samplesDir = path.resolve(opt.samples ?? path.join(root, '.cache', 'samples'));
const weasyDir = path.resolve(opt.weasyprint ?? process.env.KUMIORI_WEASYPRINT_SAMPLES ?? path.join(root, '..', 'weasyprint-samples'));
const outDir = path.resolve(opt.out ?? path.join(root, '.cache', 'check-max-pages'));
const fontCache = path.join(root, '.cache', 'fonts');
for (const c of ['pdfinfo', 'pdftotext', 'pdftoppm'])
  if (spawnSync(c, ['-v'], { stdio: 'ignore' }).error) throw new Error(`${c} がありません (poppler を入れる)`);
const cli = path.join(root, 'dist-cli', 'cli.js');
if (!fs.existsSync(cli)) {
  console.log('dist-cli/cli.js が無いので、npm run build:cli で作ります');
  const r = spawnSync('npm', ['run', '--silent', 'build:cli'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(1);
}
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

/** 子のプロセスを走らせ、終わりを待つ */
function run(cmd, args, { cwd = root, timeout } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, KUMIORI_LANG: 'ja', TZ: 'UTC', KUMIORI_FREEZE_EPOCH: '946684800' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // 字の符号 (UTF-8) を、塊の切れ目で壊さずに読む (塊のまま文字列に足すと、塊の境の字が壊れ、比べるたびに結果が揺れる)
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const timer = timeout ? setTimeout(() => p.kill('SIGKILL'), timeout * 1000) : undefined;
    p.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

// ---- 文書 ----
const docs = [];
const skipped = [];
if (opt.only.includes('ah')) {
  const fos = walk(path.join(samplesDir, 'fo', 'samples')).filter((f) => f.endsWith('.fo')).sort();
  if (!fos.length) skipped.push(`ah: 見本が無い (${path.join(samplesDir, 'fo', 'samples')})`);
  for (const f of fos) docs.push({ id: `ah/${path.basename(f, '.fo')}`, input: f, args: ['--compat', 'antenna'] });
}
if (opt.only.includes('css-print')) {
  const html = path.join(samplesDir, 'css-print', 'src', 'CSS-Print-ja.html');
  if (!fs.existsSync(html)) skipped.push(`css-print: 見本が無い (${html})`);
  else docs.push({ id: 'css-print/CSS-Print-ja', input: html, args: ['--style', 'ah'] });
}
if (opt.only.includes('weasyprint')) {
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
  if (!fs.existsSync(path.join(weasyDir, 'ticket', 'ticket.html'))) skipped.push(`weasyprint: 見本が無い (${weasyDir})`);
  else for (const [name, html, css] of list) docs.push({ id: `weasyprint/${name}`, input: path.join(weasyDir, html), args: ['--style', 'weasyprint', ...(css ? ['--css', css] : [])] });
}
if (opt.only.includes('conformance')) {
  const conf = path.join(root, 'docs', 'conformance');
  for (const [id, f] of [['conformance/html', 'html/kumiori-html-css.html'], ['conformance/fo', 'fo/kumiori-xsl-fo.fo']])
    if (fs.existsSync(path.join(conf, f))) docs.push({ id, input: path.join(conf, f), args: f.endsWith('.fo') ? ['--compat', 'spec'] : [] });
}
const chosen = docs.filter((d) => !opt.filter || opt.filter.test(d.id));

// ---- 組む・比べる ----
const safe = (id) => id.replace(/[^\w.-]+/g, '_');
fs.mkdirSync(path.join(outDir, 'pdf'), { recursive: true });

async function typeset(doc, n) {
  const pdf = path.join(outDir, 'pdf', `${safe(doc.id)}${n ? `-max${n}` : ''}.pdf`);
  fs.rmSync(pdf, { force: true });
  const r = await run(process.execPath, ['--import', pathToFileURL(freeze).href, cli, doc.input, '-o', pdf, '--font-cache', fontCache, ...doc.args, ...(n ? ['--max-pages', String(n)] : [])], { cwd: path.dirname(doc.input), timeout: opt.timeout });
  const lines = r.stderr.split('\n');
  return {
    pdf: fs.existsSync(pdf) ? pdf : undefined,
    error: fs.existsSync(pdf) ? undefined : r.stderr.trim().split('\n').slice(-2).join(' / ') || `終わりの番号 ${r.status}`,
    beyond: lines.filter((l) => l.includes('[layout/beyond-max-pages]')).map((l) => l.trim()),
  };
}

const pageCount = async (pdf) => Number(/Pages:\s+(\d+)/.exec((await run('pdfinfo', [pdf])).stdout)?.[1] ?? 0);

/** ページごとの語 (字と位置) */
async function words(pdf, last) {
  const html = (await run('pdftotext', ['-bbox', '-l', String(last), pdf, '-'])).stdout;
  return html
    .split(/<page\b/)
    .slice(1)
    .map((p) => [...p.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g)].map((m) => ({ t: m[5], x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] })));
}
const wkey = (w) => `${w.t}@${w.x0.toFixed(2)},${w.y0.toFixed(2)},${w.x1.toFixed(2)},${w.y1.toFixed(2)}`;
/** 参照の字・リーダーの字 (数字・"?"・点) を除いた語の字 */
const bare = (t) => t.replace(/[0-9?.…‥・·]+/g, '');
/** 行の並び: 語の上端の位置 (0.1pt で丸める) の集まり。参照の字だけの語は除く ("?" と数字は字の高さが違い、語の上端がずれる) */
const lineSet = (ws) => [...new Set(ws.filter((w) => bare(w.t)).map((w) => w.y0.toFixed(1)))].sort().join(' ');
/**
 * 参照の字の違いを除いた語の並び: 数字・"?" と、リーダー (目次の点の並び。参照の字の幅の違いで長さが変わる) の字を除き、空になった語は捨てる
 * (WeasyPrint の組み方では、決まらない参照は空なので、語ごと無くなる)
 */
const normText = (ws) => ws.map((w) => bare(w.t)).filter((t) => t).join(' ');

/** ページの絵 (グレー) */
async function rasters(pdf, last, dir) {
  fs.mkdirSync(dir, { recursive: true });
  await run('pdftoppm', ['-gray', '-r', String(opt.dpi), '-l', String(last), pdf, path.join(dir, 'p')]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pgm')).sort((a, b) => Number(/(\d+)\.pgm$/.exec(a)[1]) - Number(/(\d+)\.pgm$/.exec(b)[1]));
  return files.map((f) => fs.readFileSync(path.join(dir, f)));
}

async function check(doc) {
  const full = await typeset(doc);
  if (!full.pdf) return { id: doc.id, error: `全体を組めない: ${full.error}` };
  const P = await pageCount(full.pdf);
  const fullWords = await words(full.pdf, Math.max(...opt.pages));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-maxpages-'));
  const fullImgs = await rasters(full.pdf, Math.max(...opt.pages), path.join(tmp, 'full'));
  const runs = [];
  for (const n of opt.pages) {
    if (n >= P) continue;
    const r = await typeset(doc, n);
    if (!r.pdf) {
      runs.push({ n, error: r.error });
      continue;
    }
    const got = await pageCount(r.pdf);
    const ws = await words(r.pdf, n);
    const imgs = await rasters(r.pdf, n, path.join(tmp, `n${n}`));
    const pages = [];
    for (let k = 0; k < n; k++) {
      const a = fullWords[k] ?? [];
      const b = ws[k] ?? [];
      const sameText = a.length === b.length && a.every((w, i) => wkey(w) === wkey(b[i]));
      const sameImg = fullImgs[k] && imgs[k] && Buffer.compare(fullImgs[k], imgs[k]) === 0;
      if (sameText && sameImg) continue;
      const kind = sameText ? 'image' : lineSet(a) === lineSet(b) && normText(a) === normText(b) ? 'ref' : 'reflow';
      pages.push({ page: k + 1, kind });
    }
    runs.push({ n, pageCount: got, beyond: r.beyond, pages });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return { id: doc.id, pages: P, runs };
}

const results = [];
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: Math.min(opt.jobs, chosen.length) }, async () => {
    while (next < chosen.length) {
      const doc = chosen[next++];
      results.push(await check(doc));
      if (++done % 20 === 0) console.log(`  比べた: ${done} / ${chosen.length}`);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));

// ---- 報告 ----
const sum = { docs: results.length, errors: 0, runs: 0, samePages: 0, ref: 0, reflow: 0, image: 0, unexplained: 0, pagesChecked: 0 };
const lines = ['# --max-pages の 1〜N ページと全体の比べ', '', `N: ${opt.pages.join('・')} (文書のページ数以上の N は組まない)。絵は ${opt.dpi}dpi のグレーで比べた。`, ''];
if (skipped.length) lines.push('飛ばした群:', ...skipped.map((s) => `- ${s}`), '');
const rows = [];
for (const r of results) {
  if (r.error) {
    sum.errors++;
    rows.push(`| ${r.id} | — | 誤り: ${r.error.replaceAll('|', '/')} |`);
    continue;
  }
  for (const x of r.runs) {
    if (x.error) {
      sum.errors++;
      rows.push(`| ${r.id} | ${x.n} | 誤り: ${x.error.replaceAll('|', '/')} |`);
      continue;
    }
    sum.runs++;
    sum.pagesChecked += x.n;
    sum.samePages += x.n - x.pages.length;
    for (const p of x.pages) sum[p.kind]++;
    const unexplained = x.beyond.length === 0 ? x.pages.length : 0;
    sum.unexplained += unexplained;
    if (x.pages.length || x.pageCount !== x.n)
      rows.push(`| ${r.id} (${r.pages} ページ) | ${x.n} | ${x.pageCount !== x.n ? `ページ数 ${x.pageCount}。` : ''}${x.pages.map((p) => `${p.page} ページ目: ${{ ref: '参照の字だけ', reflow: '行分けまで変わった', image: '絵だけ' }[p.kind]}`).join('、')}${unexplained ? ' (後ろを指す参照の警告が無い)' : ''}${x.beyond.length ? `<br>${x.beyond.map((b) => b.replace(/^警告 \[layout\/beyond-max-pages\]\s*/, '').replaceAll('|', '/')).join('<br>')}` : ''} |`);
  }
}
lines.push(
  `- 文書 ${sum.docs} 個、止めて組んだ回 ${sum.runs} 回、比べたページ ${sum.pagesChecked} 枚`,
  `- 同じ: ${sum.samePages} 枚。参照の字だけ違う: ${sum.ref} 枚。行分けまで変わった: ${sum.reflow} 枚。絵だけ違う: ${sum.image} 枚`,
  `- 後ろを指す参照の警告が無いのに違うページ: ${sum.unexplained} 枚。組めなかった: ${sum.errors} 件`,
  '',
);
if (rows.length) lines.push('| 文書 | N | 違うページ |', '| --- | --- | --- |', ...rows, '');
fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ options: opt, skipped, summary: sum, results }, null, 2));
console.log(lines.slice(0, lines.indexOf('') >= 0 ? undefined : 8).join('\n'));
console.log(`報告: ${path.join(outDir, 'report.md')}`);
