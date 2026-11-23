/**
 * check-runtimes — 配る形 (npm pack した包み) を、Node・Deno・Bun で読み、API とコマンドが動くかを確かめる。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/check-runtimes.mjs [--deno <deno のコマンド>] [--bun <bun のコマンド>] [--font-dir <ディレクトリ>] [--skip-build] [--keep]
 *
 *  - 初めに npm run build:dist で配る形を作り (--skip-build で飛ばす)、npm pack した包みを、一時の場所の新しいプロジェクトに npm install で入れる
 *    (リポジトリの中から読むと、Deno はリポジトリの package.json を見て依存を探すので、利用者の入れ方と同じにする)
 *  - 実行環境ごとに、API (kumiori・kumiori/node・kumiori/browser の typeset・toPdf・renderPageToSvg・renderPageToPng・XSL-FO・createTypesetter、
 *    重ねた呼び出しの言語 (AsyncLocalStorage の文脈)) と、コマンド (dist-cli/cli.js の PDF・PNG・SVG・標準入力・--system-fonts) を走らせ、結果を並べる
 *  - --deno・--bun: 実行環境のコマンド (既定は PATH の deno・bun)。見つからなければ、その環境は飛ばす。
 *    入っていなければ、npm の包みで取れる: npm i --prefix <ディレクトリ> deno bun として、<ディレクトリ>/node_modules/.bin/deno・bun を渡す
 *  - --font-dir: 既定の書体を置いたディレクトリ (既定は .cache/fonts。テストと同じ置き場。無い書体は取って置く)
 *  - --keep: 一時の場所を消さない (場所を出す)
 * ネットワークは、npm install と、置き場に無い書体を取るときだけ使う。Deno・Bun は、Node の互換の API (node:fs・process.getBuiltinModule など) で動く
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const fontDir = path.resolve(opt('--font-dir', path.join(root, '.cache', 'fonts')));
const shell = process.platform === 'win32';
const run = (cmd, cmdArgs, o = {}) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell, ...o });

/** コマンドが動くか (--version が通るか) */
const found = (cmd) => run(cmd, ['--version']).status === 0;
const runtimes = [
  { name: 'node', cmd: process.execPath, pre: [] },
  { name: 'deno', cmd: opt('--deno', 'deno'), pre: ['run', '-A'] },
  { name: 'bun', cmd: opt('--bun', 'bun'), pre: [] },
];

if (!args.includes('--skip-build')) {
  const b = run('npm', ['run', 'build:dist'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) process.exit(1);
}
fs.mkdirSync(fontDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-runtimes-'));
const pack = run('npm', ['pack', '--pack-destination', tmp, '--silent'], { cwd: root });
if (pack.status !== 0) throw new Error(`npm pack: ${pack.stderr}`);
const tgz = path.join(tmp, pack.stdout.trim().split('\n').pop());
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'kumiori-runtimes-check', private: true, type: 'module' }));
const inst = run('npm', ['install', '--no-audit', '--no-fund', tgz], { cwd: tmp });
if (inst.status !== 0) throw new Error(`npm install: ${inst.stderr}`);

/** 実行環境の中で走らせる API の試験 (結果を 1 行ずつ「OK|FAIL 名前 — 中身」で出す) */
const smoke = String.raw`
const fontDir = ${JSON.stringify(fontDir)};
const line = (ok, name, info) => console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const step = async (name, fn) => { try { line(true, name, await fn()); return true; } catch (e) { line(false, name, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')); return false; } };
const html = '<html lang="ja"><body><h1>組み織り</h1><p>段落と<b>太字</b>と<ruby>漢字<rt>かんじ</rt></ruby>。</p></body></html>';
const fo = '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="80mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>XSL-FO の段落。</fo:block></fo:flow></fo:page-sequence></fo:root>';
await step('process.getBuiltinModule の AsyncLocalStorage', async () => {
  const als = new (globalThis.process.getBuiltinModule('node:async_hooks').AsyncLocalStorage)();
  const v = await als.run('x', async () => { await new Promise((r) => setTimeout(r, 1)); return als.getStore(); });
  if (v !== 'x') throw new Error('await の後に文脈が残らない');
});
let k, kn, kb;
await step('import kumiori・kumiori/node・kumiori/browser', async () => { k = await import('kumiori'); kn = await import('kumiori/node'); kb = await import('kumiori/browser'); });
if (k && kn && kb) {
  const loadFont = kn.createFontLoader({ fontDir, cacheDir: fontDir, log: () => {} });
  let r;
  await step('typeset (HTML)', async () => { r = await k.typeset(html, { name: 'a.html', loadFont }); if (r.pageCount !== 1) throw new Error('pages=' + r.pageCount); return 'warnings=' + r.warnings.length; });
  if (r) {
    await step('toPdf', async () => { const b = await r.toPdf(); if (new TextDecoder().decode(b.slice(0, 5)) !== '%PDF-') throw new Error('not PDF'); return b.length + ' bytes'; });
    await step('renderPageToSvg', async () => { const s = await r.renderPageToSvg(0); if (!s.includes('<svg')) throw new Error('not SVG'); return s.length + ' chars'; });
    await step('renderPageToPng', async () => { const b = await r.renderPageToPng(0, { dpi: 48 }); if (b[1] !== 0x50) throw new Error('not PNG'); return b.length + ' bytes'; });
  }
  await step('typesetFo', async () => { const r = await k.typesetFo(fo, { name: 'a.fo', loadFont }); if (r.pageCount !== 1) throw new Error('pages=' + r.pageCount); });
  await step('createTypesetter・typesetToPdf', async () => { const t = await k.createTypesetter({ loadFont }); const { pdf } = await t.typesetToPdf(html, { name: 'a.html' }); return pdf.length + ' bytes'; });
  await step('重ねた呼び出しの言語 (lang)', async () => {
    const bad = '<html><body><p style="color: nosuchcolor">x</p></body></html>';
    const [a, b] = await Promise.all([k.typeset(bad, { name: 'a.html', loadFont, lang: 'ja' }), k.typeset(bad, { name: 'b.html', loadFont, lang: 'en' })]);
    const ja = String(a.warnings[0] ?? ''), en = String(b.warnings[0] ?? '');
    if (!/[぀-ヿ]/.test(ja) || /[぀-ヿ]/.test(en)) throw new Error('ja=' + ja + ' en=' + en);
  });
  await step('kumiori/browser の typeset・toPdf', async () => { const r = await kb.typeset(html, { name: 'a.html', loadFont }); const b = await r.toPdf(); return b.length + ' bytes'; });
}
`;
fs.writeFileSync(path.join(tmp, 'smoke.mjs'), smoke);
fs.writeFileSync(path.join(tmp, 'a.html'), '<html lang="ja"><body><h1>見出し</h1><p>本文の段落。</p></body></html>');
const cli = path.join(tmp, 'node_modules', 'kumiori', 'dist-cli', 'cli.js');
const cliCases = [
  ['コマンド: PDF', ['a.html', '-o', 'o.pdf'], 'o.pdf'],
  ['コマンド: PNG', ['a.html', '--format', 'png', '--dpi', '48', '-o', 'o.png'], 'o.png'],
  ['コマンド: SVG', ['a.html', '--format', 'svg', '-o', 'o.svg'], 'o.svg'],
  ['コマンド: 標準入力', ['-', '-o', 'i.pdf'], 'i.pdf', '<p>標準入力</p>'],
  ['コマンド: --system-fonts', ['a.html', '--system-fonts', '-o', 's.pdf'], 's.pdf'],
];

const summary = [];
let failed = false;
for (const rt of runtimes) {
  if (rt.name !== 'node' && !found(rt.cmd)) {
    summary.push(`== ${rt.name}: 見つからない (${rt.cmd})。飛ばした`);
    continue;
  }
  summary.push(`== ${rt.name} ${run(rt.cmd, ['--version']).stdout.trim().split('\n')[0]}`);
  const s = run(rt.cmd, [...rt.pre, 'smoke.mjs'], { cwd: tmp });
  const lines = (s.stdout || '').trim().split('\n').filter(Boolean);
  if (s.status !== 0 || lines.length === 0) lines.push(`FAIL 試験のスクリプト (終わりの値 ${s.status}): ${(s.stderr || '').trim().split('\n').slice(0, 3).join(' | ')}`);
  for (const [name, cliArgs, out, input] of cliCases) {
    fs.rmSync(path.join(tmp, out), { force: true });
    const c = run(rt.cmd, [...rt.pre, cli, ...cliArgs, '--font-dir', fontDir], { cwd: tmp, input });
    const ok = c.status === 0 && fs.existsSync(path.join(tmp, out));
    lines.push(ok ? `OK   ${name}` : `FAIL ${name} (終わりの値 ${c.status}): ${(c.stderr || '').trim().split('\n').slice(-2).join(' | ')}`);
  }
  if (lines.some((l) => l.startsWith('FAIL'))) failed = true;
  summary.push(...lines.map((l) => '  ' + l));
}
console.log(summary.join('\n'));
if (args.includes('--keep')) console.log(`一時の場所: ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
