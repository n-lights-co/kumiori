#!/usr/bin/env node
/**
 * check-pdfs — 文書を PDF/UA-1・PDF/A・PDF/X などの設定で組み、出来た PDF を検査する (npm run ci:local の pdf のジョブ)。
 * 検査の中身は scripts/pdf-checks-lib.mjs: qpdf --check と Poppler (pdfinfo・pdffonts・pdftotext) で壊れた PDF を見つけ、
 * veraPDF (PDF/UA-1・PDF/A-2b・PDF/A-3b) の落ちた規則を基準と比べて、基準に無い規則が落ちたら落とす。
 * 軽い組 (小さなリポジトリの文書) は npm test (test/pdfChecks.test.ts) に入っている。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/check-pdfs.mjs [--only <群>,…] [--skip <群>,…] [--filter <文字列>] [--jobs N] [--out <dir>] [--keep]
 *                               [--baseline <JSON>] [--update] [--samples <dir>] [--weasyprint <dir>] [--no-build]
 *  - 群 (既定 conformance,examples,samples。中身は scripts/doc-sources.mjs。群ごとの組み方は pdf-checks-lib.mjs の GROUP_MODES):
 *      conformance (対応仕様説明書 4 冊。PDF/UA-1・PDF/A-2b・PDF/X-4)、examples・samples (すべての組み方)、
 *      ah・css-print・weasyprint (外の見本。PDF/UA-1 だけ)。手元に無い見本の群は、理由を書いて飛ばす
 *  - --baseline: veraPDF の基準のファイル (既定は test/pdf-checks.json。外の見本の群 (ah・css-print・weasyprint) だけを組むときは
 *    test/pdf-checks-samples.json)。--update: 組んだ文書の基準を、いまの落ちた規則に書き直す (組まなかった文書の基準は残す)
 *  - --jobs: 文書を組むプロセスの数 (既定は CPU の数と、メモリ 5GB に 1 つの小さい方)。文書ごとに子のプロセスで組み、すべての組み方の PDF を書く
 *  - --out: PDF を書く場所 (既定は一時の場所。終われば消す。--keep で残す)
 *  - --no-build: 組版のビルド (.cache/pdf-check-build) を作り直さない
 * 要るもの: qpdf・Poppler (pdfinfo・pdffonts・pdftotext)・Java (veraPDF)。veraPDF が .cache/verapdf (環境変数 KUMIORI_VERAPDF_DIR があればそこ) に無ければ取る
 * (NODE_USE_ENV_PROXY=1 node scripts/verapdf.mjs --fetch-only と同じ。ネットワークが要る)。道具が無ければ、検査せずに終わりの番号 2 で終わる。
 * 問題 (組めない・形の検査の問題・基準に無い規則・veraPDF で検査できない) があれば、終わりの番号は 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { heavyFirst, listDocs } from './doc-sources.mjs';
import { baselineKey, checkStructure, compareRules, GROUP_MODES, MODES, pdfFileName, readBaseline, ruleOrder, toolsAvailable } from './pdf-checks-lib.mjs';
import { fetchJars, runVerapdf, verapdfReady, VERSION as VERAPDF_VERSION } from './verapdf-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_GROUPS = ['ah', 'css-print', 'weasyprint'];
const GROUPS = ['conformance', 'examples', 'samples', 'generated', ...SAMPLE_GROUPS];
const memJobs = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, Math.floor(os.totalmem() / 5 / 2 ** 30)));
const args = {
  only: ['conformance', 'examples', 'samples'],
  skip: [],
  filter: undefined,
  jobs: memJobs,
  out: undefined,
  keep: false,
  baseline: undefined,
  update: false,
  samples: path.join(root, '.cache', 'samples'),
  weasyprint: undefined,
  build: true,
  child: undefined,
};
function usage(m) {
  if (m) console.error(m);
  console.error(
    '使い方: node scripts/check-pdfs.mjs [--only <群>,…] [--skip <群>,…] [--filter <文字列>] [--jobs N] [--out <dir>] [--keep] [--baseline <JSON>] [--update] [--samples <dir>] [--weasyprint <dir>] [--no-build]',
  );
  console.error(`群: ${GROUPS.join('・')}`);
  process.exit(2);
}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => {
    const x = process.argv[++i];
    if (x === undefined) usage(`${a} の値がありません`);
    return x;
  };
  if (a === '--only') args.only = v().split(',');
  else if (a === '--skip') args.skip = v().split(',');
  else if (a === '--filter') args.filter = v();
  else if (a === '--jobs') args.jobs = Math.max(1, Number(v()) || 1);
  else if (a === '--out') args.out = path.resolve(v());
  else if (a === '--keep') args.keep = true;
  else if (a === '--baseline') args.baseline = path.resolve(v());
  else if (a === '--update') args.update = true;
  else if (a === '--samples') args.samples = path.resolve(v());
  else if (a === '--weasyprint') args.weasyprint = path.resolve(v());
  else if (a === '--no-build') args.build = false;
  else if (a === '--child') args.child = v();
  else if (a === '-h' || a === '--help') usage();
  else usage(`知らない選択肢: ${a}`);
}
for (const g of [...args.only, ...args.skip]) if (!GROUPS.includes(g)) usage(`知らない群: ${g}`);
const groups = args.only.filter((g) => !args.skip.includes(g));
const weasyDir = args.weasyprint ?? path.resolve(process.env.KUMIORI_WEASYPRINT_SAMPLES ?? path.join(root, '..', 'weasyprint-samples'));
const fontDir = process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');
const buildDir = path.join(root, '.cache', 'pdf-check-build');
const verapdfDir = process.env.KUMIORI_VERAPDF_DIR ? path.resolve(process.env.KUMIORI_VERAPDF_DIR) : path.join(root, '.cache', 'verapdf');
const groupOf = (id) => id.split('/')[0];
const modesOf = (id) => GROUP_MODES[groupOf(id)] ?? ['pdfua'];

const { docs, skipped } = listDocs({ groups, filter: args.filter, samples: args.samples, weasyprint: weasyDir, fontDir });

// ── 子のプロセス: 1 つの文書を、群の組み方のすべてで組み、PDF と結果 (JSON) を書く
if (args.child) {
  const [idx, outDir] = JSON.parse(args.child);
  const d = docs[idx];
  const lib = await import(pathToFileURL(path.join(buildDir, 'index.js')).href);
  const { createFontLoader } = await import(pathToFileURL(path.join(buildDir, 'node.js')).href);
  const { testIccProfile } = await import(pathToFileURL(path.join(buildDir, 'icc.js')).href);
  const ctx = { profile: testIccProfile() };
  const loadFont = createFontLoader({ cacheDir: fontDir, log: () => {} });
  const doc = await d.load();
  const out = [];
  for (const mode of modesOf(d.id)) {
    const m = MODES[mode];
    const t0 = performance.now();
    const file = path.join(outDir, pdfFileName(d.id, mode));
    try {
      const options = typeof doc.options === 'function' ? doc.options() : doc.options;
      const r = await lib.typesetToPdf(doc.text, { ...doc.setup, loadFont, ...options, ...m.options }, m.pdf(ctx));
      fs.writeFileSync(file, r.pdf);
      out.push({ mode, file, pages: r.pageCount, warnings: r.warnings?.length ?? 0, sec: (performance.now() - t0) / 1000 });
    } catch (e) {
      out.push({ mode, file, error: e instanceof Error ? e.message : String(e), sec: (performance.now() - t0) / 1000 });
    }
  }
  fs.writeFileSync(path.join(outDir, `${idx}.json`), JSON.stringify(out));
  process.exit(0);
}

// ── 道具の確かめ
const tools = toolsAvailable();
const missing = Object.entries(tools)
  .filter(([, ok]) => !ok)
  .map(([k]) => k);
if (missing.length) {
  console.error(`道具がありません: ${missing.join('・')} (qpdf と poppler-utils を入れてください。例: sudo apt-get install -y qpdf poppler-utils)`);
  process.exit(2);
}
if (!verapdfReady(verapdfDir)) {
  try {
    await fetchJars(path.join(verapdfDir, VERAPDF_VERSION));
  } catch (e) {
    console.error(`veraPDF を取れません: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!verapdfReady(verapdfDir)) {
    console.error('veraPDF を動かせません (java が要ります。Java 21 で確かめた)');
    process.exit(2);
  }
}

// ── 組版のビルド (ライブラリと、試験の CMYK の ICC プロファイルを作る部品)
if (args.build || !fs.existsSync(path.join(buildDir, 'index.js'))) {
  const { build } = await import('vite');
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    publicDir: false,
    build: {
      outDir: buildDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      ssr: true,
      rolldownOptions: { input: { index: 'src/index.ts', node: 'src/node.ts', icc: 'test/iccTestProfile.ts' }, output: { entryFileNames: '[name].js' } },
    },
  });
}

const baselineFile = args.baseline ?? path.join(root, 'test', groups.every((g) => SAMPLE_GROUPS.includes(g)) ? 'pdf-checks-samples.json' : 'pdf-checks.json');
const baseline = readBaseline(baselineFile);
const outDir = args.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-check-pdfs-'));
fs.mkdirSync(outDir, { recursive: true });
const t0 = performance.now();

// ── 組む (文書ごとに子のプロセス。--jobs 個まで並べる。重い文書から先に組む)
const typeset = new Map();
{
  const queue = heavyFirst(docs);
  const worker = async () => {
    while (queue.length) {
      const idx = queue.shift();
      const d = docs[idx];
      const t = performance.now();
      const code = await new Promise((resolve) => {
        const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2).filter((a) => a !== '--update'), '--child', JSON.stringify([idx, outDir])], {
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        p.on('error', () => resolve(-1));
        p.on('exit', (c, sig) => resolve(sig ?? c));
      });
      const json = path.join(outDir, `${idx}.json`);
      const rows = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : [{ mode: '*', error: `組むプロセスが結果を書かずに終わった (${code})` }];
      typeset.set(d.id, rows);
      console.log(`組んだ: ${d.id} (${((performance.now() - t) / 1000).toFixed(1)} 秒。${rows.map((r) => `${r.mode}${r.error ? ' ×' : ''}`).join('・')})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.jobs, docs.length) }, worker));
}
const typesetSec = (performance.now() - t0) / 1000;

// ── 検査
/** 文書・組み方ごとの結果: { id, mode, problems: [], verapdf: { flavour: { failed, added, removed } } } */
const results = [];
const byFlavour = new Map();
for (const d of docs)
  for (const row of typeset.get(d.id) ?? []) {
    const res = { id: d.id, mode: row.mode, problems: [], verapdf: {} };
    results.push(res);
    if (row.error) {
      res.problems.push(`組めない: ${row.error}`);
      continue;
    }
    res.problems.push(...checkStructure(row.file, { tagged: MODES[row.mode].tagged }, tools).problems);
    for (const fl of MODES[row.mode].verapdf) {
      if (!byFlavour.has(fl)) byFlavour.set(fl, []);
      byFlavour.get(fl).push({ res, file: row.file });
    }
  }
const t1 = performance.now();
const newRules = {};
for (const [fl, list] of byFlavour) {
  // veraPDF は 1 度に多くの PDF を渡すと、Java の起動が 1 度で済む。報告の名前 (渡した道) で結果を組にする
  let reports;
  try {
    reports = runVerapdf(
      verapdfDir,
      fl,
      list.map((x) => x.file),
    );
  } catch (e) {
    for (const { res } of list) res.problems.push(`veraPDF (${fl}) を動かせない: ${e instanceof Error ? e.message : e}`);
    continue;
  }
  const byName = new Map(reports.map((r) => [path.resolve(r.name), r]));
  for (const { res, file } of list) {
    const rep = byName.get(path.resolve(file));
    if (!rep || rep.compliant === undefined) {
      res.problems.push(`veraPDF (${fl}) で検査できない: ${rep?.error ?? '報告が無い'}`);
      continue;
    }
    // 適合しないのに落ちた規則を 1 つも読めないとき (veraPDF の報告の形が変わったときなど) は、通さずに問題にする
    if (rep.compliant === false && !rep.rules.length) {
      res.problems.push(`veraPDF (${fl}) の報告は適合しないのに、落ちた規則を読めない (scripts/verapdf-lib.mjs の読み方を確認する)`);
      continue;
    }
    const key = baselineKey(res.id, res.mode, fl);
    const cmp = compareRules(baseline, key, rep.rules);
    res.verapdf[fl] = { ...cmp, descriptions: Object.fromEntries(rep.rules.map((r) => [`${r.clause}-${r.test}`, `${r.description} (${r.failed} か所)`])) };
    if (cmp.failed.length) newRules[key] = cmp.failed;
  }
}
const verapdfSec = (performance.now() - t1) / 1000;

// ── 報告
let bad = false;
let removedAny = false;
console.log(`\n出来た PDF の検査 (${results.length} 個の PDF。組版 ${typesetSec.toFixed(0)} 秒・veraPDF ${verapdfSec.toFixed(0)} 秒。基準 ${path.relative(root, baselineFile)})`);
for (const r of results) {
  const added = Object.entries(r.verapdf).flatMap(([fl, v]) => v.added.map((x) => ({ fl, x, desc: v.descriptions[x] })));
  const removed = Object.entries(r.verapdf).flatMap(([fl, v]) => v.removed.map((x) => `${fl} ${x}`));
  const known = Object.entries(r.verapdf).flatMap(([fl, v]) => v.failed.filter((x) => !v.added.includes(x)).map((x) => `${fl} ${x}`));
  const ok = !r.problems.length && !added.length;
  if (!ok && !args.update) bad = true;
  if (!ok && args.update && r.problems.length) bad = true;
  if (removed.length) removedAny = true;
  console.log(`${ok ? '○' : '×'} ${r.id} [${r.mode}]${known.length ? ` (基準どおりに落ちる規則: ${known.join('・')})` : ''}`);
  for (const p of r.problems) console.log(`    ${p}`);
  for (const { fl, x, desc } of added) console.log(`    veraPDF ${fl}: 基準に無い規則が落ちた ${x}: ${desc}`);
  if (removed.length) console.log(`    veraPDF: 基準にあって落ちなくなった規則 ${removed.join('・')} (基準を直してください: --update)`);
}
for (const s of skipped) console.log(`(飛ばした群 ${s.group}: ${s.reason})`);

if (args.update) {
  // 組んだ文書の鍵を、いまの結果で置き換える (組まなかった文書の鍵は残す)。合う (落ちた規則の無い) ものは書かない
  const checked = new Set(results.flatMap((r) => MODES[r.mode].verapdf.map((fl) => baselineKey(r.id, r.mode, fl))));
  const rules = Object.fromEntries(Object.entries(baseline.rules).filter(([k]) => !checked.has(k)));
  Object.assign(rules, newRules);
  const sorted = Object.fromEntries(
    Object.keys(rules)
      .sort()
      .map((k) => [k, [...rules[k]].sort(ruleOrder)]),
  );
  const body = {
    description:
      baseline.description ??
      'veraPDF の基準 (scripts/check-pdfs.mjs・test/pdfChecks.test.ts)。鍵は「文書 [組み方] 検査の種類」、値は落ちてよい規則 (規格の節-検査の番号)。基準に無い規則が落ちたら試験が落ちる。直すときは node scripts/check-pdfs.mjs --update',
    veraPDF: VERAPDF_VERSION,
    rules: sorted,
  };
  fs.writeFileSync(baselineFile, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`\n基準を書き直しました: ${path.relative(root, baselineFile)}`);
} else if (removedAny) console.log('\n基準にあって落ちなくなった規則があります。直ったのなら、--update で基準を書き直してください');

if (!args.keep && !args.out) fs.rmSync(outDir, { recursive: true, force: true });
else console.log(`PDF: ${outDir}`);
console.log(bad ? '問題があります' : 'すべて通りました');
process.exit(bad ? 1 : 0);
