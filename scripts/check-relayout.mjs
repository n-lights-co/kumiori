#!/usr/bin/env node
/**
 * 組み直しの組み比べ (重い版): 手元の大きな文書を、種を決めた乱数の所で少しずつ直しながら組み、使い回しをする器 (createTypesetter の reuse) と、
 * 使い回さない器 (reuse: false) で、領域の木・診断 (場所まで)・警告・PDF のバイト列が同じことを確かめる (scripts/relayout-check-lib.mjs)。
 * 違えば、使い回しの側の誤り。速い版 (リポジトリの小さな文書) は test/relayoutCheck.test.ts で、npm test に入っている。
 *
 * 使い方:
 *   node scripts/check-relayout.mjs [--only <群>,…] [--skip <群>,…] [--filter <文字列>] [--seed N] [--edits N] [--jobs N] [--no-pdf]
 *                                  [--json <file>] [--samples <dir>] [--weasyprint <dir>] [--src <dir>] [--no-build]
 *   群 (既定はすべて。手元に無い見本の群は、理由を書いて飛ばす):
 *     conformance … 対応仕様説明書 (HTML と CSS 編・XSL-FO 編。日本語と英語)
 *     examples    … examples の HTML と FO (examples/preview の画面のコードは除く)
 *     samples     … samples の FO (--compat spec と antenna)
 *     generated   … scripts/gen-stress-docs.mjs の種を決めた乱数の文書 (書き出す大きさ。続きから組む確かめの、左右で本文の幅の違うページの文書と、
 *                   罫線をつぶした表がページをまたぐ文書 (RESUME_SHAPES) と、章ごとに page-sequence を分け、脚注・マーカーのある XSL-FO と、初めに目次のある HTML・XSL-FO (REUSE_SHAPES) も)
 *     ah          … アンテナハウスのサンプル FO 集 (.cache/samples/fo/samples。--compat antenna)
 *     css-print   … 『CSSページ組版入門』第 4 版 (.cache/samples/css-print/src。--style ah)
 *     weasyprint  … WeasyPrint の見本 (既定はリポジトリの隣の weasyprint-samples。--style weasyprint。見本の printall.sh と同じ組み合わせ)
 *   --seed: 直す所を選ぶ乱数の種 (既定 1。文書ごとに、種と文書の名前から種を作る)。--edits: 重ねて直す回数 (既定 3)。
 *     組む並びは「元の文書・直したもの (edits 個)・元の文書に戻したもの」で、どれも 2 つの器で組んで比べる。直しは字の直しが多く、
 *     5 回に 1 回ほどは、ブロック (fo:block・p・li) を 1 つ消すか、同じものをもう 1 つ足す直し、5 回に 1 回ほどは、ブロックの開きタグに組み方の属性 (keep・区切り・widows・orphans) を足す直し、7 回に 1 回ほどは、ページのマスターだけの直し
 *     (XSL-FO の領域・HTML の @page に背景の色を足す。本文は変えない)
 *   --jobs: 文書を分けて、いくつのプロセスで組むか (既定 1。空いたプロセスに、重い文書から 1 つずつ渡す。同時に組む文書のメモリの見積もりは、機械のメモリの 8 割まで)。--no-pdf: PDF のバイト列を比べない (速い)
 *   --subjects: 比べる器 (既定 reuse)。splice-verify … 使い回しをする器で、前の組版と揃った境目で繋がずに終わりまで組み、繋いだはずの
 *     前の組版のページ・id の記録・警告と同じかを確かめる (resumeProbe.spliceVerify。違えば、境目の状態の比べに漏れがある)。reuse … 使い回しをする器。resume … 使い回しをする器で、1 段の page-sequence の続きから組める境目の
 *     すべてで、1 ページ先まで組んでから境目に戻り、境目の写しから続けて組む (design/resumable-flow.md の 4.4。scripts/check-resume.mjs)。
 *     resume-late … 1 段の page-sequence を終わりまで組んだ後、続きから組める境目を --late 個ほど (既定 4) 散らして選び、後ろから順に、
 *     境目に戻って終わりまで組み直す (組版の中で境目から組み直す使い方と同じ。resumeProbe.late)。
 *     resume・resume-late の行には、写した境目・続きから組めた境目・続けた回数・組めない理由ごとの数を出す。--edits 0 で、元の文書だけを組む
 *   --src・--no-build: scripts/profile-relayout.mjs と同じ (組版のソースの場所。ビルドは <src>/.cache/relayout-build)
 *   見本 (ah・css-print) は CLAUDE.md の「見本と書体の置き場」の手順で .cache/samples に戻す。書体は既定の書体で組む
 *   (見本と同じ書体にしなくても、使い回しの有無の比べには足りる)。
 * 結果は、文書ごとに 1 行 (組んだ版の数・ページ数・使い回しの当たった段落の数・時間)、違った版はその中身を出す。違う版があれば、終わりの状態を 1 にする。
 *
 * ページの境目から続けて組む作りは、器 resume (--subjects resume) で比べる (scripts/check-resume.mjs)。変わったページから組み直して
 * 前の組版と繋ぐ作り (R7) は、器 reuse の行に、繋いだ境目とページの数を出し (繋いだ境目:ページ)、器 splice-verify で、繋ぐ所の確かめをする。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { docMemoryGB, heavyFirst, listDocs } from './doc-sources.mjs';
import { checkRelayout, describeEdit, editSequence, seedOf } from './relayout-check-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = ['conformance', 'examples', 'samples', 'generated', 'ah', 'css-print', 'weasyprint'];

// ── 引数
const args = { late: 4, subjects: ['reuse'], only: GROUPS, skip: [], filter: undefined, seed: 1, edits: 3, jobs: 1, pdf: true, json: undefined, samples: path.join(root, '.cache', 'samples'), weasyprint: undefined, src: undefined, build: true, shard: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => {
    const x = process.argv[++i];
    if (x === undefined) throw new Error(`${a} の値がありません`);
    return x;
  };
  if (a === '--only') args.only = v().split(',');
  else if (a === '--skip') args.skip = v().split(',');
  else if (a === '--filter') args.filter = v(); // 文書の名前に含まれる文字列で絞る (正規表現にはしない)
  else if (a === '--seed') args.seed = Number(v());
  else if (a === '--edits') args.edits = Number(v());
  else if (a === '--subjects') args.subjects = v().split(',');
  else if (a === '--late') args.late = Math.max(1, Number(v()));
  else if (a === '--jobs') args.jobs = Math.max(1, Number(v()));
  else if (a === '--no-pdf') args.pdf = false;
  else if (a === '--json') args.json = path.resolve(v());
  else if (a === '--samples') args.samples = path.resolve(v());
  else if (a === '--weasyprint') args.weasyprint = path.resolve(v());
  else if (a === '--src') args.src = path.resolve(v());
  else if (a === '--no-build') args.build = false;
  // 内部: 子のプロセスが組む分 (k/n: 文書の並びの k 番目から n おき)
  else if (a === '--shard') args.shard = v();
  else throw new Error(`知らない引数: ${a}`);
}
for (const n of args.subjects) if (!['reuse', 'resume', 'resume-late', 'splice-verify'].includes(n)) throw new Error(`知らない器: ${n} (reuse・resume・resume-late・splice-verify)`);
for (const g of [...args.only, ...args.skip]) if (!GROUPS.includes(g)) throw new Error(`知らない群: ${g} (${GROUPS.join('・')})`);
const groups = args.only.filter((g) => !args.skip.includes(g));
const weasyDir = args.weasyprint ?? path.resolve(process.env.KUMIORI_WEASYPRINT_SAMPLES ?? path.join(root, '..', 'weasyprint-samples'));

// ── 組版のビルド (名前を残し、ソースのファイルごとに分ける。使い回しの当たりを数えるため、layoutEngine も入口にする)
const srcRoot = args.src ?? root;
const outDir = path.join(srcRoot, '.cache', 'relayout-build');
if (!args.shard && (args.build || !fs.existsSync(path.join(outDir, 'index.js'))))
  await build({
    configFile: false,
    root: srcRoot,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      ssr: true,
      rolldownOptions: {
        input: { index: 'src/index.ts', node: 'src/node.ts', layoutEngine: 'src/layoutEngine.ts' },
        output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
      },
    },
  });

// ── 文書の一覧 (名前・群・読み方。scripts/doc-sources.mjs)。読むのは組むときだけ
const fontDir = process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');

const { docs, skipped } = listDocs({ groups, filter: args.filter, samples: args.samples, weasyprint: weasyDir, fontDir });

// ── 分けて組む (--jobs): 子のプロセスを --jobs 個動かし (--shard queue)、空いた子に、重い文書から順に 1 つずつ渡す (IPC)。結果の JSON を集める。
// 決まった割り振り (i 番目を i % jobs 番目の子へ) にすると、重い文書 (対応仕様説明書の HTML 編・『CSSページ組版入門』) が同じ子に重なり、
// 終わりにその子だけが長く走ることがあるため
if (args.jobs > 1 && !args.shard) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-relayout-'));
  const pass = process.argv.slice(2).filter((a, i, all) => a !== '--json' && all[i - 1] !== '--json' && a !== '--jobs' && all[i - 1] !== '--jobs');
  const queue = heavyFirst(docs);
  // 同時に組む文書のメモリの見積もり (docMemoryGB) の合計を、機械のメモリの 8 割までに抑える (重い文書が重なって、メモリが足りずに止められないように)。
  // 入る文書が残っていなければ、子は、ほかの子が文書を組み終えるまで待つ (ほかに組んでいる子が無ければ、入らなくても渡す)
  const budget = (os.totalmem() / 2 ** 30) * 0.8;
  /** 子 → 組んでいる文書のメモリの見積もり */
  const running = new Map();
  /** 次の文書を待っている子 */
  const waiting = [];
  const used = () => [...running.values()].reduce((n, g) => n + g, 0);
  const dispatch = () => {
    while (waiting.length) {
      const at = queue.findIndex((i) => !running.size || used() + docMemoryGB(docs[i].id) <= budget);
      if (at < 0 && queue.length) return;
      const p = waiting.shift();
      const i = at < 0 ? null : queue.splice(at, 1)[0];
      if (i !== null) running.set(p, docMemoryGB(docs[i].id));
      p.send(i);
    }
  };
  const all = await Promise.all(
    Array.from({ length: Math.min(args.jobs, Math.max(1, docs.length)) }, (_, k) => {
      const out = path.join(tmp, `${k}.json`);
      return new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...pass, '--no-build', '--shard', 'queue', '--json', out], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        p.on('message', (m) => {
          if (m !== 'next') return;
          // 前に渡した文書は組み終えた
          running.delete(p);
          waiting.push(p);
          dispatch();
        });
        p.on('error', reject);
        p.on('exit', () => {
          running.delete(p);
          const w = waiting.indexOf(p);
          if (w >= 0) waiting.splice(w, 1);
          dispatch();
          resolve(fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { docs: [], error: `${k} 番目のプロセスが結果を書かずに終わった` });
        });
      });
    }),
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  const results = all.flatMap((r) => r.docs).sort((a, b) => a.id.localeCompare(b.id));
  const errors = all.flatMap((r) => (r.error ? [r.error] : []));
  finish(results, errors);
} else {
  const lib = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
  const { createFontLoader } = await import(pathToFileURL(path.join(outDir, 'node.js')).href);
  const { SharedLineMemo, LayoutEngine, resumeProbe } = await import(pathToFileURL(path.join(outDir, 'layoutEngine.js')).href);
  // 前の文書から使い回した page-sequence の数 (LayoutEngine.adoptPrev が付け替えた数)
  let seqHits = 0;
  // 前の組版と繋いだ回数と、繋いだページの数 (LayoutEngine.spliceAdopt。変わったページから組み直して、境目で揃ったら繋ぐ。R7)
  let spliceHits = 0;
  let splicePages = 0;
  // 前を飛ばした回数とページの数 (初めのページから前の組版を使ったもの)
  let skipHits = 0;
  let skipPages = 0;
  const spliceAdopt = LayoutEngine.prototype.spliceAdopt;
  LayoutEngine.prototype.spliceAdopt = function (...a) {
    const r = spliceAdopt.apply(this, a);
    if (a[1] > 0) {
      spliceHits++;
      splicePages += r.length;
    } else {
      skipHits++;
      skipPages += r.length;
    }
    return r;
  };
  const adopt = LayoutEngine.prototype.adoptPrev;
  LayoutEngine.prototype.adoptPrev = function (...a) {
    const r = adopt.apply(this, a);
    if (r) seqHits++;
    return r;
  };
  // 使い回しの当たった段落の数 (SharedLineMemo.get が結果を返した回数)
  let hits = 0;
  const get = SharedLineMemo.prototype.get;
  SharedLineMemo.prototype.get = function (...a) {
    const r = get.apply(this, a);
    if (r) hits++;
    return r;
  };
  /** 組む文書を 1 つずつ返す (子のプロセスなら、親に次の文書を尋ねる。無ければ undefined) */
  const nextDoc = args.shard
    ? () =>
        new Promise((resolve) => {
          process.once('message', (i) => resolve(i === null ? undefined : docs[i]));
          process.send('next');
        })
    : (() => {
        let i = 0;
        return async () => docs[i++];
      })();
  const results = [];
  for (let d; (d = await nextDoc()); ) {
    const t0 = performance.now();
    const res = { id: d.id, versions: [], ok: true };
    try {
      const doc = await d.load();
      const loadFont = createFontLoader({ cacheDir: fontDir, log: () => {} });
      const versions = args.edits > 0 ? editSequence(doc.text, { seed: seedOf(args.seed, d.id), edits: args.edits, attrRate: 0.2, masterRate: 0.15, blockRate: 0.2 }) : [{ label: '元の文書', text: doc.text }];
      let last = hits;
      let lastSeq = seqHits;
      let lastSplice = spliceHits;
      let lastSplicePages = splicePages;
      let lastSkip = skipHits;
      let lastSkipPages = skipPages;
      /** resume の器で組んだ間の、境目の数え (組み直しの回をまとめる) */
      let rs;
      /** 境目の数えを集める器 (name で組み、on で試しの印を立てる) */
      const probe = (name, on, off) => ({
        name,
        wrap: async (typeset) => {
          rs = { boundaries: 0, resumable: 0, resumed: 0, mismatched: 0, reasons: {} };
          on();
          resumeProbe.onStats = (s) => {
            for (const k of ['boundaries', 'resumable', 'resumed', 'mismatched']) rs[k] += s[k];
            for (const [k, n] of Object.entries(s.reasons)) rs.reasons[k] = (rs.reasons[k] ?? 0) + n;
          };
          try {
            return await typeset();
          } finally {
            off();
            resumeProbe.onStats = undefined;
          }
        },
        stats: () => {
          last = hits;
          return { resume: rs };
        },
      });
      const subjects = {
        reuse: {
          name: 'reuse',
          stats: () => {
            const n = hits - last;
            last = hits;
            const q = seqHits - lastSeq;
            lastSeq = seqHits;
            const sp = { spliced: spliceHits - lastSplice, splicedPages: splicePages - lastSplicePages, skipped: skipHits - lastSkip, skippedPages: skipPages - lastSkipPages };
            lastSplice = spliceHits;
            lastSplicePages = splicePages;
            lastSkip = skipHits;
            lastSkipPages = skipPages;
            return { sharedLineHits: n, sequenceHits: q, ...sp };
          },
        },
        resume: probe(
          'resume',
          () => (resumeProbe.check = true),
          () => (resumeProbe.check = false),
        ),
        'resume-late': probe(
          'resume-late',
          () => (resumeProbe.late = args.late),
          () => (resumeProbe.late = undefined),
        ),
        // 繋ぐ確かめ: 使い回しをする器で、前の組版と揃った境目で繋がずに終わりまで組み、繋いだはずのページと同じかを確かめる (resumeProbe.spliceVerify)
        'splice-verify': (() => {
          let v;
          return {
            name: 'splice-verify',
            wrap: async (typeset) => {
              v = { same: 0, pages: 0, diff: [] };
              resumeProbe.spliceVerify = (x) => {
                if (x.same) {
                  v.same++;
                  v.pages += x.pages;
                } else v.diff.push(x);
              };
              try {
                return await typeset();
              } finally {
                resumeProbe.spliceVerify = undefined;
              }
            },
            stats: () => {
              last = hits;
              lastSeq = seqHits;
              lastSplice = spliceHits;
              lastSplicePages = splicePages;
              lastSkip = skipHits;
              lastSkipPages = skipPages;
              return { verify: v };
            },
          };
        })(),
      };
      const r = await checkRelayout({
        lib,
        setup: { loadFont, ...doc.setup },
        options: doc.options,
        versions,
        pdf: args.pdf,
        subjects: args.subjects.map((n) => subjects[n]),
      });
      res.ok = r.ok;
      res.versions = r.versions;
    } catch (e) {
      res.ok = false;
      res.error = e instanceof Error ? e.stack : String(e);
    }
    res.ms = Math.round(performance.now() - t0);
    results.push(res);
    console.log(line(res));
  }
  if (args.shard) {
    fs.writeFileSync(args.json, JSON.stringify({ docs: results }));
    // 親との IPC の口を閉じる (開いたままだと、子のプロセスが終わらない)
    process.disconnect?.();
  }
  else finish(results, []);
}

/** 文書ごとの 1 行 (違った版は、その下に中身) */
function line(r) {
  if (r.error) return `✗ ${r.id}: 組めない (${r.error.split('\n')[0]})`;
  const pages = r.versions.map((v) => v.pages);
  const hitsPer = r.versions.map((v) => v.subjects.find((x) => x.name === 'reuse')?.stats?.sharedLineHits ?? 0);
  const seqPer = r.versions.map((v) => v.subjects.find((x) => x.name === 'reuse')?.stats?.sequenceHits ?? 0);
  const splicePer = r.versions.map((v) => {
    const st = v.subjects.find((x) => x.name === 'reuse')?.stats;
    return `${st?.spliced ? `${st.spliced}:${st.splicedPages}` : '0'}${st?.skipped ? `+前${st.skippedPages}` : ''}`;
  });
  const res = r.versions.flatMap((v) => v.subjects.filter((x) => x.name.startsWith('resume')).map((x) => x.stats?.resume)).filter(Boolean);
  const sum = (k) => res.reduce((n, x) => n + x[k], 0);
  const why = {};
  for (const x of res) for (const [k, n] of Object.entries(x.reasons)) why[k] = (why[k] ?? 0) + n;
  const resume = res.length ? `・境目 ${sum('boundaries')} (続けられる ${sum('resumable')}・続けた ${sum('resumed')}${sum('mismatched') ? `・指紋の違い ${sum('mismatched')}` : ''}${Object.keys(why).length ? `・続けられない ${Object.entries(why).map(([k, n]) => `${k} ${n}`).join(' ')}` : ''})` : '';
  const ver = r.versions.map((v) => v.subjects.find((x) => x.name === 'splice-verify')?.stats?.verify).filter(Boolean);
  const verDiff = ver.flatMap((x) => x.diff);
  const verify = ver.length ? `・繋ぐ確かめ ${ver.reduce((n, x) => n + x.same, 0)} 回 (${ver.reduce((n, x) => n + x.pages, 0)} ページ) 同じ${verDiff.length ? `・違う ${verDiff.length} 回 (${verDiff.map((x) => `${x.at}: ${x.why}`).join(' / ')})` : ''}` : '';
  let s = `${r.ok && !sum('mismatched') && !verDiff.length ? '✓' : '✗'} ${r.id}: ${r.versions.length} 版・${Math.min(...pages)}〜${Math.max(...pages)} ページ${args.subjects.includes('reuse') ? `・使い回した段落 ${hitsPer.join('/')}・page-sequence ${seqPer.join('/')}・繋いだ境目:ページ ${splicePer.join('/')}` : ''}${resume}${verify}・${(r.ms / 1000).toFixed(1)} 秒`;
  for (const v of r.versions)
    for (const x of v.subjects)
      if (x.diff) s += `\n    ${v.index}: ${v.label}: ${x.name} が違う: ${Object.entries(x.diff).map(([k, d]) => `${{ tree: '領域の木', diagnostics: '診断', warnings: '警告', pdf: 'PDF' }[k]} ${d}`).join('・')}`;
  return s;
}

function finish(results, errors) {
  if (args.shard) return;
  const mism = (r) => r.versions?.some((v) => v.subjects.some((x) => x.stats?.resume?.mismatched || x.stats?.verify?.diff.length));
  const bad = results.filter((r) => !r.ok || mism(r));
  console.log(`\n${results.length} 文書 (${results.reduce((n, r) => n + r.versions.length, 0)} 版) を組み比べた: 同じ ${results.length - bad.length}・違う (か組めない) ${bad.length}`);
  // 使い回しの数の合計 (page-sequence の使い回しと、前の組版と繋いだ境目・ページ)
  const tot = { seq: 0, docs: 0, spliced: 0, pages: 0, spliceDocs: 0, skipped: 0, skippedPages: 0 };
  for (const r of results) {
    const st = (r.versions ?? []).map((v) => v.subjects.find((x) => x.name === 'reuse')?.stats).filter(Boolean);
    const q = st.reduce((n, x) => n + (x.sequenceHits ?? 0), 0);
    const sp = st.reduce((n, x) => n + (x.spliced ?? 0), 0);
    tot.seq += q;
    if (q) tot.docs++;
    tot.spliced += sp;
    tot.pages += st.reduce((n, x) => n + (x.splicedPages ?? 0), 0);
    if (sp) tot.spliceDocs++;
    tot.skipped += st.reduce((n, x) => n + (x.skipped ?? 0), 0);
    tot.skippedPages += st.reduce((n, x) => n + (x.skippedPages ?? 0), 0);
  }
  if (args.subjects.includes('reuse')) console.log(`page-sequence の使い回し: ${tot.docs} 文書・${tot.seq} 回。前の組版と繋いだ: ${tot.spliceDocs} 文書・${tot.spliced} 回・${tot.pages} ページ。前を飛ばした: ${tot.skipped} 回・${tot.skippedPages} ページ`);
  for (const r of bad) console.log(line(r));
  for (const s of skipped) console.log(`飛ばした群: ${s.group}: ${s.reason}`);
  for (const e of errors) console.log(`誤り: ${e}`);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ seed: args.seed, edits: args.edits, pdf: args.pdf, skipped, errors, docs: results.map((r) => ({ ...r, versions: r.versions.map((v) => ({ ...v, edit: v.edit && { ...v.edit, text: describeEdit(v.edit) } })) })) }, null, 1));
  if (bad.length || errors.length) process.exitCode = 1;
}
