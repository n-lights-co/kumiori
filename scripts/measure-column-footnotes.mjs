/**
 * measure-column-footnotes — scripts/gen-column-footnotes.mjs の文書を Kumiori のコマンドで組み、段組の脚注の組み直しの結果を数える。
 * poppler の pdftotext が要る。
 *
 * 使い方: node scripts/measure-column-footnotes.mjs <cli.js> <文書のディレクトリ> <PDF の出力のディレクトリ> [文書の名前...]
 *   cli.js は、ビルドしたコマンド (dist-cli/cli.js。比べる版ごとにビルドしたもの)。文書のディレクトリには meta.json が要る。
 *   --no-tagged を知らない版 (0.4.0 まで) には、--legacy を付ける。
 *
 * 文書ごとに 1 行、JSON で書く: pages (ページ)・thin (最後を除くページのうち、本文が 4 行以下で脚注の無いページ)・
 * warn (「行がページに収まりません」の数)・away (頭を参照と別のページに置いた脚注)・lostBody・lostFoot (組んだ PDF に無い本文・脚注の行)・
 * sec (組版の秒)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const legacy = args.includes('--legacy');
const [cli, inDir, outDir, ...names] = args.filter((a) => a !== '--legacy');
if (!outDir) {
  console.error('使い方: node scripts/measure-column-footnotes.mjs <cli.js> <文書のディレクトリ> <PDF の出力のディレクトリ> [文書の名前...] [--legacy]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(inDir, 'meta.json'), 'utf8'));
for (const name of names.length ? names : Object.keys(meta)) {
  const pdf = path.join(outDir, name + '.pdf');
  const t0 = Date.now();
  const r = spawnSync('node', [cli, path.join(inDir, name), '-o', pdf, ...(legacy ? [] : ['--no-tagged'])], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const sec = (Date.now() - t0) / 1000;
  const warn = (r.stderr.match(/行がページに収まりません/g) ?? []).length;
  // -raw は描いた順に字を並べる。2 つの行が 1 行につながることがあるので、本文の行は「line N text」を数える
  const txt = spawnSync('pdftotext', ['-raw', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout ?? '';
  const pages = txt.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  const linePage = new Map();
  const notePage = new Map();
  let thin = 0;
  pages.forEach((p, i) => {
    let body = 0;
    let foot = 0;
    for (const l of p.split('\n').filter((x) => x.trim())) {
      const f = /fn(\d+)x(\d+)/.exec(l);
      if (f) {
        foot++;
        if (!notePage.has(`${f[1]}x${f[2]}`)) notePage.set(`${f[1]}x${f[2]}`, i);
        continue;
      }
      const ms = [...l.matchAll(/line (\d+) text/g)];
      body += Math.max(1, ms.length);
      for (const m of ms) if (!linePage.has(Number(m[1]))) linePage.set(Number(m[1]), i);
    }
    if (i < pages.length - 1 && body <= 4 && foot === 0) thin++;
  });
  const { lines, notes } = meta[name];
  let away = 0;
  let lostFoot = 0;
  let lostBody = 0;
  for (let n = 1; n <= lines; n++) if (!linePage.has(n)) lostBody++;
  for (const [n, c] of Object.entries(notes)) {
    for (let j = 1; j <= c; j++) if (!notePage.has(`${n}x${j}`)) lostFoot++;
    if (notePage.get(`${n}x1`) !== linePage.get(Number(n))) away++;
  }
  console.log(name, JSON.stringify({ pages: pages.length, thin, warn, away, lostBody, lostFoot, sec, status: r.status }));
}
