/**
 * pdf-checks-lib — 出来た PDF の検査の部品。scripts/check-pdfs.mjs (npm run ci:local の pdf のジョブ) と test/pdfChecks.test.ts (npm test の軽い組) で使う。
 *
 * 検査は 2 つ:
 *  - 形の検査 (壊れた PDF を見つける):
 *      qpdf --check (相互参照の表・オブジェクトの流れ・ページの木などの PDF の構文。誤りも警告も問題とする)、
 *      Poppler の pdfinfo (読めるか・ページ数・タグ付きか)・pdffonts (書体がどれも埋め込まれているか)・pdftotext (ページの中身の流れを読めるか)。
 *      Poppler は、読めても中身の流れに誤りがあれば標準エラーに Syntax Error などを出すので、その行も問題とする
 *  - veraPDF の規格の検査 (PDF/UA-1・PDF/A-2b・PDF/A-3b。scripts/verapdf-lib.mjs):
 *      落ちた規則 (規格の節と検査の番号。「7.1-3」の形) を、リポジトリに置いた基準 (test/pdf-checks.json など) と比べ、基準に無い規則が落ちたら問題とする。
 *      基準にあって落ちなくなった規則は、問題とせずに、基準を直すよう知らせる (check-pdfs.mjs の --update で書き直す)。
 *      PDF/X は veraPDF に検査の規則が無いので、形の検査だけをする (Kumiori は PDF/X を書いた後に自分で読み直して決まりを確かめる。src/pdfStandard.ts)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

/**
 * 組み方 (PDF の出力の設定) の一覧。options は TypesetOptions に足すもの、pdf は TypesetPdfOptions (ctx.profile は試験の CMYK の ICC プロファイル)、
 * verapdf は veraPDF の検査の種類 (flavour)、tagged はタグ付き PDF になるはずか
 */
export const MODES = {
  // PDF/UA-1 (ISO 14289-1。タグ付き PDF を含む)
  pdfua: { options: { pdfua: true }, pdf: () => ({}), verapdf: ['ua1'], tagged: true },
  // PDF/A-2b (ISO 19005-2。見た目を保存する水準。タグは既定のまま付く)
  'pdfa-2b': { options: {}, pdf: () => ({ pdfa: { version: 'A-2b' } }), verapdf: ['2b'], tagged: true },
  // PDF/A-3b と PDF/UA-1 を合わせたもの (PDF/A の拡張のスキーマで pdfuaid を定義する所も確かめる)
  'pdfa-3b-ua': { options: { pdfua: true }, pdf: () => ({ pdfa: { version: 'A-3b' } }), verapdf: ['3b', 'ua1'], tagged: true },
  // PDF/X-4 (ISO 15930-7。透明はそのまま。CMYK の出力の ICC プロファイルが要る)
  'pdfx-4': { options: {}, pdf: (ctx) => ({ pdfx: { version: 'X-4', profile: ctx.profile } }), verapdf: [], tagged: true },
  // PDF/X-1a:2001 (ISO 15930-1。CMYK と特色だけ。透明を平らにする。タグは付けない。印刷条件は ICC の登録簿の名前で渡す)
  'pdfx-1a': { options: {}, pdf: () => ({ pdfx: { version: 'X-1a', condition: 'JC200103' } }), verapdf: [], tagged: false },
};

/** 群ごとの組み方 (対応仕様説明書は大きいので 3 つ、小さなリポジトリの文書はすべて、外の見本は PDF/UA-1 だけ) */
export const GROUP_MODES = {
  conformance: ['pdfua', 'pdfa-2b', 'pdfx-4'],
  examples: Object.keys(MODES),
  samples: Object.keys(MODES),
  generated: ['pdfua'],
  ah: ['pdfua'],
  'css-print': ['pdfua'],
  weasyprint: ['pdfua'],
};

/** PDF を書くファイルの名前 (文書の名前と組み方から。/ と空白・括弧を - にする) */
export const pdfFileName = (id, mode) => `${id.replace(/[^\w.-]+/g, '-').replace(/-+$/, '')}.${mode}.pdf`;

/** 基準の鍵 (文書の名前・組み方・veraPDF の検査の種類) */
export const baselineKey = (id, mode, flavour) => `${id} [${mode}] ${flavour}`;

/** 形の検査に使う道具があるか ({ qpdf, pdfinfo, pdffonts, pdftotext }) */
export function toolsAvailable() {
  const has = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return !r.error;
  };
  return { qpdf: has('qpdf', ['--version']), pdfinfo: has('pdfinfo', ['-v']), pdffonts: has('pdffonts', ['-v']), pdftotext: has('pdftotext', ['-v']) };
}

/** Poppler の標準エラーのうち、問題とする行 (誤り・構文の誤り。Poppler は読めた所までで続けるので、終わりの番号だけでは分からない) */
const popplerErrors = (stderr) =>
  (stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(Syntax Error|Syntax Warning|Internal Error|Command Line Error|I\/O Error|Permission Error)\b/.test(l) || /^Error\b/.test(l));

/**
 * 1 つの PDF の形の検査。tools は toolsAvailable() の結果 (無い道具の検査は飛ばす)。expect.tagged が真なら、pdfinfo の Tagged: yes を求める。
 * { problems (問題の文の並び), pages (pdfinfo のページ数), skipped (飛ばした道具) } を返す
 */
export function checkStructure(file, { tagged = false } = {}, tools = toolsAvailable()) {
  const problems = [];
  const skipped = Object.entries(tools)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (tools.qpdf) {
    // 終わりの番号は 0 (問題なし)・2 (誤り)・3 (警告だけ)。警告も、読み手が直しながら読んだもの (壊れた所がある) なので問題とする
    const r = run('qpdf', ['--check', file]);
    if (r.status !== 0) {
      const lines = `${r.stdout}\n${r.stderr}`
        .split('\n')
        .filter((l) => /WARNING|ERROR|error|warning/i.test(l) && !/^checking /.test(l))
        .slice(0, 5);
      problems.push(`qpdf --check (終わりの番号 ${r.status}): ${lines.join(' / ') || '(文なし)'}`);
    }
  }
  let pages;
  if (tools.pdfinfo) {
    const r = run('pdfinfo', [file]);
    if (r.status !== 0) problems.push(`pdfinfo (終わりの番号 ${r.status}): ${r.stderr.trim().split('\n')[0] ?? ''}`);
    else {
      pages = Number(/^Pages:\s+(\d+)/m.exec(r.stdout)?.[1] ?? 0);
      if (!(pages > 0)) problems.push('pdfinfo: ページが無い');
      const tag = /^Tagged:\s+(\w+)/m.exec(r.stdout)?.[1];
      if (tagged && tag !== 'yes') problems.push(`pdfinfo: タグ付き PDF でない (Tagged: ${tag ?? '?'})`);
    }
    for (const l of popplerErrors(r.stderr)) problems.push(`pdfinfo: ${l}`);
  }
  if (tools.pdffonts) {
    const r = run('pdffonts', [file]);
    if (r.status !== 0) problems.push(`pdffonts (終わりの番号 ${r.status}): ${r.stderr.trim().split('\n')[0] ?? ''}`);
    else {
      // 表の頭の 2 行の後が書体ごとの行。欄は name・type・encoding・emb・sub・uni・object ID (name は空白を含まない。type は空白を含むことがある)
      // emb の欄は、後ろから 5 つ目 (emb sub uni の 3 つと object ID の 2 つ)
      const rows = r.stdout
        .split('\n')
        .slice(2)
        .filter((l) => l.trim());
      for (const row of rows) {
        const cols = row.trim().split(/\s+/);
        const emb = cols[cols.length - 5];
        if (emb !== 'yes') problems.push(`pdffonts: 埋め込んでいない書体 ${cols[0]}`);
      }
    }
    for (const l of popplerErrors(r.stderr)) problems.push(`pdffonts: ${l}`);
  }
  if (tools.pdftotext) {
    const r = run('pdftotext', ['-enc', 'UTF-8', file, os.devNull]);
    if (r.status !== 0) problems.push(`pdftotext (終わりの番号 ${r.status}): ${r.stderr.trim().split('\n')[0] ?? ''}`);
    for (const l of popplerErrors(r.stderr)) problems.push(`pdftotext: ${l}`);
  }
  // 同じ文の問題は 1 つにまとめる (ページごとに同じ構文の誤りが出ることがある)
  const uniq = [...new Map(problems.map((p) => [p, 0])).keys()];
  return { problems: uniq.length > 20 ? [...uniq.slice(0, 20), `ほか ${uniq.length - 20} 件`] : uniq, pages, skipped };
}

/** 基準のファイルを読む (無ければ空の基準)。{ veraPDF (版), rules: { 鍵: ['節-番号', …] } } */
export function readBaseline(file) {
  if (!fs.existsSync(file)) return { rules: {} };
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...j, rules: j.rules ?? {} };
}

/**
 * 落ちた規則を基準と比べる。rules は veraPDF の結果の rules ([{ clause, test }])。
 * { failed (落ちた規則の名前の並び), added (基準に無いのに落ちた規則), removed (基準にあって落ちなくなった規則) } を返す
 */
export function compareRules(baseline, key, rules) {
  const failed = [...new Set(rules.map((r) => `${r.clause}-${r.test}`))].sort(ruleOrder);
  const base = new Set(baseline.rules[key] ?? []);
  return { failed, added: failed.filter((r) => !base.has(r)), removed: [...base].filter((r) => !failed.includes(r)).sort(ruleOrder) };
}

/** 規則の名前の並べ方 (節の番号を数として並べ、次に検査の番号) */
export function ruleOrder(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}
