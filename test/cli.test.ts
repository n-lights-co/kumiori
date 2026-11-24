/**
 * Node のコマンド (src/cli.ts) の結合テスト: dist-cli/cli.js を作り、FO と HTML+CSS を PDF に組む。
 * 既定の書体は .cache/fonts (KUMIORI_FONT_DIR で上書き可) に無ければ Google Fonts 配信元から取得して置き、--font-dir で渡す。
 * 書体のキャッシュ (--font-cache) のテストは、そこに無い書体 1 つ (Tinos-Bold) だけをネットワークから取る。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { EMOJI_SPEC, FONT_SPECS, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC } from '../src/fontMapping';
import { buildTestFont } from './sfntTestFont';
import { ensureFonts, fontDir } from './helpers';

const root = path.resolve(__dirname, '..');
let work = '';
/**
 * コマンドの子プロセスに渡す環境。コマンドは文言の言語を --lang・KUMIORI_LANG・OS のロケール (LC_ALL・LC_MESSAGES・LANG) で決める
 * (src/messages.ts の detectMessageLang) ので、テストを走らせる機械のロケールに頼らないように、日本語を明示する (PKG-05)。
 * ロケールから言語を決める動きそのものは、下の「--lang en・KUMIORI_LANG・LANG で…」のテストが、LANG などを明示して確かめる
 */
const JA_ENV = { ...process.env, KUMIORI_LANG: 'ja' };

/** 子のプロセスを動かす別の利用者 (nobody) の uid・gid */
const NOBODY = 65534;

/** test のコマンド (シェルを通さずに、引数で渡して動かす) */
const TEST_BIN = ['/usr/bin/test', '/bin/test'].find((p) => fs.existsSync(p));

/** nobody が読めるか (ancestors をたどれて、読めて、x なら動かせるか) を、nobody で動かす test で確かめる */
function nobodyCan(test: '-r' | '-x', p: string): boolean {
  const r = spawnSync(TEST_BIN!, [test, p], { uid: NOBODY, gid: NOBODY });
  return r.status === 0;
}

/**
 * nobody で動かすコマンドの node の本体・cli.js・書体のディレクトリ。nobody が届かない物 (npx の node は /root の下、
 * ci:local --worktree の取り出し先は 0700 の一時のディレクトリ) は、dir (nobody がたどれる) の下に写して、その場所を返す。
 * cli.js は、dist-cli の全体と、package.json の実行時の依存 (とその依存) を node_modules に写す。写してもたどれなければ、飛ばす理由の文を返す
 */
function nobodyTools(dir: string): { node: string; cli: string; fonts: string } | string {
  if (!TEST_BIN) return 'test のコマンドが無いので、nobody で確かめられない';
  const copy = (from: string, to: string) => fs.cpSync(from, to, { recursive: true, dereference: true });
  let node = process.execPath;
  if (!nobodyCan('-x', node)) {
    node = path.join(dir, 'tools', 'node');
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.copyFileSync(process.execPath, node);
    fs.chmodSync(node, 0o755);
  }
  let cli = path.join(root, 'dist-cli', 'cli.js');
  if (!nobodyCan('-r', cli)) {
    const base = path.join(dir, 'tools', 'app');
    copy(path.join(root, 'dist-cli'), path.join(base, 'dist-cli'));
    cli = path.join(base, 'dist-cli', 'cli.js');
    // 実行時の依存を、たどり着いた順に写す (npm の平らな node_modules。入れ子の node_modules は、包みごと写る)
    const queue = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies ?? {});
    const done = new Set<string>();
    while (queue.length) {
      const name = queue.shift()!;
      if (done.has(name)) continue;
      done.add(name);
      const from = path.join(root, 'node_modules', name);
      if (!fs.existsSync(from)) continue;
      copy(from, path.join(base, 'node_modules', name));
      const pkg = JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8'));
      queue.push(...Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
    }
  }
  let fonts = fontDir;
  if (!nobodyCan('-x', fonts)) {
    fonts = path.join(dir, 'tools', 'fonts');
    copy(fontDir, fonts);
  }
  for (const [what, ok] of [
    ['node の本体', nobodyCan('-x', node)],
    ['cli.js', nobodyCan('-r', cli)],
    ['書体のディレクトリ', nobodyCan('-x', fonts)],
  ] as const) {
    if (!ok) return `${what} を nobody がたどれる場所に置けなかった`;
  }
  return { node, cli, fonts };
}

/** コマンドを動かし、標準出力と PDF を返す */
async function run(input: string, ...args: string[]) {
  const out = path.join(work, path.basename(input).replace(/\.\w+$/, '.pdf'));
  const stdout = execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), input, '-o', out, '--font-dir', fontDir, ...args], { encoding: 'utf8', env: JA_ENV });
  return { stdout, pdf: await PDFDocument.load(fs.readFileSync(out)) };
}

beforeAll(async () => {
  // Windows の npm は npm.cmd で、Node は .cmd・.bat をシェル無しでは起動しない (Node 18.20.2・20.12.2 からの変更) ので、Windows ではシェルを通す
  execFileSync('npm', ['run', '--silent', 'build:cli'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  // 数式の書体も置いておく (無いと、MathML のテストでコマンドがネットワークから取り、利用者のキャッシュ (~/.cache/kumiori/fonts) に保存する)
  await ensureFonts([...FONT_SPECS, ...LATIN_SPECS, ...MONO_SPECS, MATH_SPEC]);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-cli-'));
}, 300_000);

describe('Node のコマンド', () => {
  it('XSL-FO を組む (用紙の大きさ・改ページ)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'fo-'));
    const fo = path.join(dir, 'doc.fo');
    fs.writeFileSync(
      fo,
      `<?xml version="1.0" encoding="UTF-8"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja">
  <fo:layout-master-set>
    <fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="15mm"><fo:region-body/></fo:simple-page-master>
  </fo:layout-master-set>
  <fo:page-sequence master-reference="p">
    <fo:flow flow-name="xsl-region-body">
      <fo:block>組み織りの見本。</fo:block>
      <fo:block break-before="page">二ページ目。</fo:block>
    </fo:flow>
  </fo:page-sequence>
</fo:root>`,
    );
    const { stdout, pdf } = await run(fo);
    expect(stdout).toContain('2 ページ');
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([420, 595]); // A5 (pt)
  }, 120_000);

  it('--format svg: ページを SVG にする (複数ページの文書は -番号を付けた名前。--pages で選ぶ。標準出力は 1 ページだけ)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'svg-'));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><style>@page { size: A6 }</style><p id="one">一頁目 <a href="#third">三へ</a> <a href="#one">一へ</a></p><p style="break-before: page">二頁目</p><p id="third" style="break-before: page">三頁目</p></html>');
    const cli = path.join(root, 'dist-cli/cli.js');
    const all = execFileSync(process.execPath, [cli, html, '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(all).toContain('3 ページを SVG に書きました');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()).toEqual(['doc-1.svg', 'doc-2.svg', 'doc-3.svg']);
    const svg = fs.readFileSync(path.join(dir, 'doc-2.svg'), 'utf8');
    // A6 (105mm × 148mm) を pt で
    expect(svg).toMatch(/<svg [^>]*width="297\.638pt" height="419\.528pt"/);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
    // 文書の中の、別のページへのリンクは、そのページのファイルの名前に #id を付ける。同じページは #id。飛び先の id は、そのページに書く
    const first = fs.readFileSync(path.join(dir, 'doc-1.svg'), 'utf8');
    expect(first).toContain('<a xlink:href="doc-3.svg#third">');
    expect(first).toContain('<a xlink:href="#one">');
    expect(fs.readFileSync(path.join(dir, 'doc-3.svg'), 'utf8')).toMatch(/<rect id="third"/);
    // -o の拡張子が .svg なら --format は要らない。--pages で 1 ページだけ選んでも、複数ページの文書なら番号を付ける
    execFileSync(process.execPath, [cli, html, '-o', path.join(dir, 'p.svg'), '--pages', '3', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('p'))).toEqual(['p-3.svg']);
    // 文書に無いページを指すと、何も書かずに誤り (1 ページ目も書かない)
    const bad = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'q.svg'), '--pages', '1,9', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('--pages の 9 は文書にありません (文書は 3 ページ)');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('q'))).toEqual([]);
    // -o の拡張子と --format が食い違うのは誤り
    const mismatch = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'r.pdf'), '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('-o の拡張子 .pdf と --format svg が食い違います');
    // 標準出力には 1 ページだけ
    const one = execFileSync(process.execPath, [cli, html, '-o', '-', '--format', 'svg', '--pages', '1', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(one.startsWith('<?xml')).toBe(true);
    const many = spawnSync(process.execPath, [cli, html, '-o', '-', '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(many.status).toBe(1);
    expect(many.stderr).toContain('1 ページだけ');
  }, 120_000);

  it('--max-pages: 先頭から N ページまで組んで止める (PDF・SVG。報告の行と、N より後ろのページを指す --pages の誤り)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'max-'));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><style>@page { size: A6 } a::after { content: target-counter(attr(href), page) }</style><p>目次 <a href="#c3"></a></p><p style="break-before: page">二頁目</p><p id="c3" style="break-before: page">三頁目</p></html>');
    const { stdout, pdf } = await run(html, '--max-pages', '2');
    expect(stdout).toContain('2 ページ。--max-pages 2 で止めた');
    expect(pdf.getPageCount()).toBe(2);
    // 止めないときは、いまの報告のまま
    expect((await run(html, '--max-pages', '3')).stdout).toContain('3 ページ (組版');
    const cli = path.join(root, 'dist-cli/cli.js');
    const svg = execFileSync(process.execPath, [cli, html, '-o', path.join(dir, 's.svg'), '--max-pages', '1', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(svg).toContain('1 ページを SVG に書きました (文書は 1 ページ。--max-pages 1 で止めた');
    const bad = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'q.svg'), '--pages', '3', '--max-pages', '2', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('--pages の 3 は文書にありません (文書は 2 ページ。--max-pages 2 で止めた)');
    for (const v of ['0', '1.5', '0x10', '-1']) {
      const r = spawnSync(process.execPath, [cli, html, '--max-pages', v, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
      expect(r.status, v).toBe(1);
      expect(r.stderr).toContain(`--max-pages の値 "${v}" は使えません`);
    }
  }, 120_000);

  it('入力のファイルの名前の改行・制御文字は、報告の行と誤りの行で見える形にする ({ で始まる偽の行を出さない)', () => {
    if (process.platform === 'win32') return; // Windows のファイルの名前には改行を使えない
    const dir = fs.mkdtempSync(path.join(work, 'name-'));
    const html = path.join(dir, 'a\n{"code":"fake"}.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><p>字</p></html>');
    const cli = path.join(root, 'dist-cli/cli.js');
    const ok = spawnSync(process.execPath, [cli, html, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV, cwd: dir });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('a\\x0a{"code":"fake"}.pdf: 1 ページ');
    expect(ok.stdout.split('\n').some((l) => l.startsWith('{'))).toBe(false);
    const bad = path.join(dir, 'b\n{"code":"fake"}.fo');
    fs.writeFileSync(bad, '<fo:root');
    const ng = spawnSync(process.execPath, [cli, bad, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV, cwd: dir });
    expect(ng.status).toBe(1);
    expect(ng.stderr).toContain('b\\x0a{"code":"fake"}.fo: ');
    expect(ng.stderr.split('\n').some((l) => l.startsWith('{'))).toBe(false);
  }, 120_000);

  it('--format svg・png では構造の木を作らず、タグ付き PDF にだけ関わる診断 (表の構造の上限) を出さない', () => {
    const dir = fs.mkdtempSync(path.join(work, 'svg-tag-'));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, `<!doctype html><html lang="ja"><style>@page { size: A4 }</style><table><tr><td colspan="1000">a</td></tr>${'<tr><td>b</td></tr>'.repeat(20)}</table></html>`);
    const cli = path.join(root, 'dist-cli/cli.js');
    const svg = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'd.svg'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(svg.status).toBe(0);
    expect(svg.stderr).not.toContain('limit/table-structure-cells');
    // PDF では出る
    const pdf = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'd.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(pdf.stderr).toContain('limit/table-structure-cells');
  }, 120_000);

  it('--format png: ページを PNG にする (-o の .png でも。--dpi で解像度。--pages で選ぶ)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'png-'));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><style>@page { size: 144pt 72pt; margin: 0 } p { margin: 0; background: #f00; height: 36pt }</style><p>一</p><p style="break-before: page">二</p></html>');
    const cli = path.join(root, 'dist-cli/cli.js');
    const out = execFileSync(process.execPath, [cli, html, '-o', path.join(dir, 'p.png'), '--dpi', '144', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(out).toContain('2 ページを PNG に書きました');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()).toEqual(['p-1.png', 'p-2.png']);
    const b = fs.readFileSync(path.join(dir, 'p-2.png'));
    expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
    // 144pt × 72pt を 144dpi で: 288 × 144 画素 (IHDR の幅・高さ)
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([288, 144]);
    const one = spawnSync(process.execPath, [cli, html, '-o', '-', '--format', 'png', '--pages', '1', '--font-dir', fontDir], { env: JA_ENV });
    expect(one.status).toBe(0);
    expect(one.stdout.subarray(1, 4).toString('latin1')).toBe('PNG');
  }, 120_000);

  it('HTML+CSS を組む (別ファイルの CSS・head と body の無い HTML)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'html-'));
    fs.writeFileSync(path.join(dir, 'style.css'), '@page { size: A5 } h1 { break-before: page }');
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><link rel="stylesheet" href="style.css"><p>はじめに</p><h1>第一章</h1><p>本文。</p></html>');
    const { stdout, pdf } = await run(html);
    expect(stdout).toContain('2 ページ');
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(1).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([420, 595]);
  }, 120_000);

  it('入力のディレクトリの CSS のうち、文書が参照しないものは当てずに知らせる (--css で名指ししたものは足す)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'unref-'));
    fs.writeFileSync(path.join(dir, 'style.css'), '@page { size: A5 }');
    // 同じディレクトリにある、別の文書のための CSS
    fs.writeFileSync(path.join(dir, 'other.css'), '@page { size: A3 }');
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><link rel="stylesheet" href="style.css"><p>本文。</p></html>');
    const out = path.join(dir, 'doc.pdf');
    const a = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    // 知らせ (重さ info) は、--verbose のときだけ標準エラー出力に出す
    expect(a.stderr).not.toContain('参照されていない CSS');
    const v = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir, '--verbose'], { encoding: 'utf8', env: JA_ENV });
    expect(v.stderr).toContain('  知らせ [css/unreferenced-stylesheet] 文書から参照されていない CSS は当てません: other.css');
    // --diagnostics json: 1 件 1 行の JSON (知らせも書く)
    const j = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir, '--diagnostics', 'json'], { encoding: 'utf8', env: JA_ENV });
    const lines = j.stderr.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    expect(lines).toContainEqual(expect.objectContaining({ input: html, code: 'css/unreferenced-stylesheet', severity: 'info' }));
    expect(Math.round((await PDFDocument.load(fs.readFileSync(out))).getPage(0).getSize().width)).toBe(420); // A5
    // --css で名指しすれば、参照されていなくても利用者のスタイルシートとして足す
    const b = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir, '--css', 'style.css,other.css'], { encoding: 'utf8', env: JA_ENV });
    expect(b.stderr).not.toContain('参照されていない CSS');
    expect(Math.round((await PDFDocument.load(fs.readFileSync(out))).getPage(0).getSize().width)).toBe(842); // A3 (利用者のスタイルシートが後)
  }, 120_000);

  it('--diagnostics json: 組めずに止まる誤りも、診断と同じ形の JSON の 1 行 (重さ fatal) で書き、終了コード 1 で終わる', () => {
    const dir = fs.mkdtempSync(path.join(work, 'fatal-'));
    const bad = path.join(dir, 'bad.fo');
    fs.writeFileSync(bad, '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:x>');
    const missing = path.join(dir, 'missing.fo');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), bad, missing, '-o', dir, '--font-dir', fontDir, '--diagnostics', 'json'], { encoding: 'utf8', env: JA_ENV });
    expect(r.status).toBe(1);
    const lines = r.stderr.split('\n').filter((l) => l.trim());
    // 標準エラーの行は、どれも JSON
    const recs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(recs).toContainEqual(expect.objectContaining({ input: bad, name: 'KumioriInputError', code: 'input/xml-parse', severity: 'fatal', message: expect.stringContaining('XML の解析に失敗しました') }));
    // Kumiori の誤りでないもの (ファイルが無い) は code を持たない
    const m = recs.find((x) => x.input === missing);
    expect(m).toMatchObject({ name: 'Error', severity: 'fatal' });
    expect(m).not.toHaveProperty('code');
    // 文字の出力 (既定) は、前のとおり「ファイル名: 文」
    const t = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), bad, '-o', path.join(dir, 'x.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(t.status).toBe(1);
    expect(t.stderr).toContain('bad.fo: XML の解析に失敗しました');
  }, 120_000);

  it('--spot-colors: 名前の特色を PDF の Separation (代わりの色は DeviceCMYK) にする', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'spot-'));
    const spots = path.join(dir, 'spots.json');
    fs.writeFileSync(spots, JSON.stringify({ 'Ink A': 'cmyk(20%, 40%, 60%, 80%)', 'Ink B': [0, 1, 0, 0] }));
    const html = path.join(dir, 'spot.html');
    fs.writeFileSync(
      html,
      `<!doctype html><style>p { color: rgb(0, 61, 25); color: rgb-icc(0, 61, 25, #Separation, 'Ink A'); background-color: rgba(0, 61, 25, 0.2); background-color: rgb-icc(0, 61, 25, #Separation, 'Ink A', 0.2) }</style><p>特色</p>`,
    );
    const fo = path.join(dir, 'spot.fo');
    fs.writeFileSync(
      fo,
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block color="rgb-icc(255, 0, 255, #Separation, 'Ink B', 0.5)">特色</fo:block></fo:flow></fo:page-sequence></fo:root>`,
    );
    /** 1 ページ目の資源の Separation の [名前, 代わりの色空間] */
    const seps = (pdf: PDFDocument) => {
      const cs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ColorSpace'));
      if (!(cs instanceof PDFDict)) return [];
      return cs.values().map((v) => {
        const a = pdf.context.lookup(v) as unknown as { asArray(): unknown[] };
        return a.asArray().slice(0, 3).map(String);
      });
    };
    // HTML の rgb-icc() はアンテナハウスの拡張の書き方 (CSS の色の関数に無い) なので、--style ah のときだけ読む。XSL-FO では XSL 1.1 §5.10.2 の関数
    expect(seps((await run(html, '--style', 'ah', '--spot-colors', spots)).pdf)).toContainEqual(['/Separation', '/Ink#20A', '/DeviceCMYK']);
    expect(seps((await run(html, '--spot-colors', spots)).pdf)).toEqual([]);
    expect(seps((await run(fo, '--spot-colors', spots)).pdf)).toContainEqual(['/Separation', '/Ink#20B', '/DeviceCMYK']);
    // 渡さなければ、これまでどおり (Separation は無い)
    expect(seps((await run(html, '--style', 'ah')).pdf)).toEqual([]);
    // 名前の字は UTF-8 で書く (ISO 32000-2 §7.3.5)。トンボは色材名 All の Separation (§8.6.6.4)。ファイルの識別子 (ID) を書く
    fs.writeFileSync(spots, JSON.stringify({ 特色: [0, 1, 0, 0] }));
    const ja = path.join(dir, 'ja.html');
    fs.writeFileSync(ja, `<!doctype html><style>@page { size: A6; marks: crop; bleed: 3mm } p { color: rgb-icc(255, 0, 255, #Separation, '特色') }</style><p>特色</p>`);
    const out = (await run(ja, '--style', 'ah', '--spot-colors', spots)).pdf;
    expect(seps(out)).toContainEqual(['/Separation', '/#E7#89#B9#E8#89#B2', '/DeviceCMYK']);
    expect(seps(out)).toContainEqual(['/Separation', '/All', '/DeviceCMYK']);
    expect(String(out.context.trailerInfo.ID)).toMatch(/^\[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]$/);
  }, 120_000);

  it('HTML の MathML を数式用の書体で組む。--xhtml は接頭辞の付いた m:math も MathML として読む', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'math-'));
    const body = (p: string) =>
      `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>式 <${p}math xmlns${p ? ':m' : ''}="http://www.w3.org/1998/Math/MathML"><${p}mfrac><${p}mi>a</${p}mi><${p}mi>b</${p}mi></${p}mfrac></${p}math> です</p></body></html>`;
    /**
     * 描いた図形の曲線 (c) の数 (数式は字の輪郭の図形で描く。本文の字は書体で描くので曲線は無い)。
     * 図形の命令は、ページの内容の流れか、使い回す Form XObject (Subtype が Form) にある
     */
    const curves = (pdf: PDFDocument) => {
      const contents = [...pdf.context.enumerateIndirectObjects()]
        .map(([, o]) => o)
        .filter((o): o is PDFRawStream => {
          if (!(o instanceof PDFRawStream) || o.dict.get(PDFName.of('Length1'))) return false;
          const form = o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form');
          return form || (!o.dict.get(PDFName.of('Subtype')) && !o.dict.get(PDFName.of('Type')));
        });
      return contents.reduce((n, o) => {
        const flate = String(o.dict.get(PDFName.of('Filter'))) === '/FlateDecode';
        const text = Buffer.from(flate ? zlib.inflateSync(o.contents) : o.contents).toString('latin1');
        return n + (text.match(/ c\n/g)?.length ?? 0);
      }, 0);
    };
    const plain = path.join(dir, 'plain.html');
    fs.writeFileSync(plain, body(''));
    expect(curves((await run(plain)).pdf)).toBeGreaterThan(0);
    // HTML の構文では m:math は MathML にならない (字を並べる)。--xhtml なら MathML
    const prefixed = path.join(dir, 'prefixed.html');
    fs.writeFileSync(prefixed, body('m:'));
    expect(curves((await run(prefixed)).pdf)).toBe(0);
    expect(curves((await run(prefixed, '--xhtml')).pdf)).toBeGreaterThan(0);
  }, 180_000);

  it('文書が参照する画像 (下のディレクトリも) は読み、参照していない画像は読まない', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'img-'));
    fs.mkdirSync(path.join(dir, 'pics'));
    // 1×1 の PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(dir, 'pics', 'used.png'), png);
    // 参照していない、壊れた大きな画像 (読めば時間がかかる。読まなければ影響しない)
    fs.writeFileSync(path.join(dir, 'pics', 'unused.png'), Buffer.concat([png.subarray(0, 16), Buffer.alloc(5_000_000)]));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<p>図</p><img src="pics/used.png" style="width:20mm">');
    const { pdf } = await run(html);
    const xobjects = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
    expect(xobjects && (xobjects as PDFDict).keys().length).toBe(1);
  }, 120_000);

  it('8 ビット RGB の PNG は展開せずに (Predictor 15 で) 入れ、透明度つきの PNG はこれまでどおり展開して入れる', async () => {
    const zlib = await import('node:zlib');
    const dir = fs.mkdtempSync(path.join(work, 'png-'));
    // PNG を作る (2×2。colorType 2 = RGB、6 = RGBA)
    const crc = (b: Buffer) => {
      let c = ~0;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    const chunk = (type: string, body: Buffer) => {
      const t = Buffer.from(type, 'ascii');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(Buffer.concat([t, body])));
      return Buffer.concat([len, t, body, c]);
    };
    const png = (colorType: 2 | 6) => {
      const ch = colorType === 2 ? 3 : 4;
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(2, 0);
      ihdr.writeUInt32BE(2, 4);
      ihdr[8] = 8;
      ihdr[9] = colorType;
      const rows = Buffer.concat([0, 1].map(() => Buffer.concat([Buffer.from([0]), Buffer.alloc(2 * ch, 200)])));
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
    };
    fs.writeFileSync(path.join(dir, 'rgb.png'), png(2));
    fs.writeFileSync(path.join(dir, 'rgba.png'), png(6));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<img src="rgb.png" style="width:10mm"><img src="rgba.png" style="width:10mm">');
    const { pdf } = await run(html);
    const images = [...pdf.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image');
    const asIs = images.filter((o) => o.dict.get(PDFName.of('DecodeParms')));
    expect(asIs).toHaveLength(1);
    expect(String(asIs[0].dict.get(PDFName.of('ColorSpace')))).toBe('/DeviceRGB');
    // 透明度つきの PNG は、色と透明度 (SMask) に分けて入る
    expect(images.some((o) => o.dict.get(PDFName.of('SMask')))).toBe(true);
  }, 120_000);

  it('まとめて変換する (-o は出力先のディレクトリ)。1 つ失敗しても、ほかは作る', () => {
    const dir = fs.mkdtempSync(path.join(work, 'many-'));
    fs.writeFileSync(path.join(dir, 'a.html'), '<p>一</p>');
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>二</p><p style="break-before: page">三</p>');
    fs.writeFileSync(path.join(dir, 'c.fo'), '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:block>');
    const out = path.join(dir, 'out');
    const cli = path.join(root, 'dist-cli/cli.js');
    expect(() => execFileSync(process.execPath, [cli, 'a.html', 'b.html', 'c.fo', '-o', out, '--font-dir', fontDir], { cwd: dir, stdio: 'pipe', env: JA_ENV })).toThrow();
    expect(fs.readdirSync(out).sort()).toEqual(['a.pdf', 'b.pdf']);
  }, 120_000);

  it('標準入力から読み、標準出力へ書く (FO かどうかは中身で見分ける)', async () => {
    const fo =
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>あ</fo:block></fo:flow></fo:page-sequence></fo:root>';
    const pdf = execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), '-', '-o', '-', '--font-dir', fontDir, '--base', work], { input: fo, stdio: ['pipe', 'pipe', 'pipe'], env: JA_ENV });
    const doc = await PDFDocument.load(pdf);
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(283); // 100mm
  }, 120_000);

  it('--watch: 入力が変わるたびに組み直す', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'watch-'));
    const html = path.join(dir, 'w.html');
    fs.writeFileSync(html, '<p>一</p>');
    const child = spawn(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '--watch', '--font-dir', fontDir], { stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const until = async (re: RegExp) => {
      for (let i = 0; i < 300 && !re.test(log); i++) await new Promise((r) => setTimeout(r, 100));
      return re.test(log);
    };
    try {
      expect(await until(/見張って/), log).toBe(true);
      fs.writeFileSync(html, '<p>一</p><p style="break-before: page">二</p>');
      expect(await until(/w\.pdf: 2 ページ/), log).toBe(true);
    } finally {
      child.kill();
    }
  }, 120_000);

  it('--watch と --format svg: 複数ページの文書で、書いたページの SVG (a-1.svg …) の変更では組み直さない', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'watch-svg-'));
    const html = path.join(dir, 'w.html');
    fs.writeFileSync(html, '<p>一</p><p style="break-before: page">二</p>');
    const child = spawn(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '--format', 'svg', '--watch', '--font-dir', fontDir], { stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const until = async (re: RegExp) => {
      for (let i = 0; i < 300 && !re.test(log); i++) await new Promise((r) => setTimeout(r, 100));
      return re.test(log);
    };
    try {
      expect(await until(/見張って/), log).toBe(true);
      fs.writeFileSync(html, '<p>一</p><p style="break-before: page">二</p><p style="break-before: page">三</p>');
      expect(await until(/3 ページを SVG/), log).toBe(true);
      // 前は、書いた w-1.svg などの変更で組み直しが続いた (見張りが除いていたのは w.svg だけ)
      await new Promise((r) => setTimeout(r, 2000));
      expect(log.match(/ページを SVG に書きました/g)?.length, log).toBe(2);
    } finally {
      child.kill();
    }
  }, 120_000);

  it('出力は、その変換で読んだファイル (文書の画像・入力) と、別の入力の出力を上書きしない', () => {
    const dir = fs.mkdtempSync(path.join(work, 'guard-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    // 文書の使う画像 fig.svg と、--format svg の出力 fig.svg (前は画像をページの SVG で上書きし、終了 0)
    fs.writeFileSync(path.join(dir, 'fig.html'), '<p>図<img src="fig.svg"></p>');
    fs.writeFileSync(path.join(dir, 'fig.svg'), svg);
    const r1 = spawnSync(process.execPath, [cli, path.join(dir, 'fig.html'), '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r1.status, r1.stderr).toBe(1);
    expect(r1.stderr).toContain('上書きしません');
    expect(fs.readFileSync(path.join(dir, 'fig.svg'), 'utf8')).toBe(svg);
    // -o に入力と同じ名前 (前は入力を PDF で上書きした)
    const one = path.join(dir, 'one.html');
    fs.writeFileSync(one, '<p>一</p>');
    const r2 = spawnSync(process.execPath, [cli, one, '-o', one, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r2.status, r2.stderr).toBe(1);
    expect(fs.readFileSync(one, 'utf8')).toBe('<p>一</p>');
    // 3 ページの a.html と a.fo を一緒に組む (前は a.fo の出力が a-2.svg になり、a.html の 2 ページ目を消した)
    fs.writeFileSync(path.join(dir, 'a.html'), '<p>一</p><p style="break-before: page">二</p><p style="break-before: page">三</p>');
    fs.writeFileSync(path.join(dir, 'a.fo'), '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>FO</fo:block></fo:flow></fo:page-sequence></fo:root>');
    const r3 = spawnSync(process.execPath, [cli, path.join(dir, 'a.html'), path.join(dir, 'a.fo'), '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r3.status, r3.stderr).toBe(0);
    expect(fs.readdirSync(dir).filter((f) => /^a[.-].*\.svg$/.test(f)).sort()).toEqual(['a-1.svg', 'a-2.svg', 'a-3.svg', 'a.fo.svg']);
    expect(fs.readFileSync(path.join(dir, 'a-2.svg'), 'utf8')).not.toBe(fs.readFileSync(path.join(dir, 'a.fo.svg'), 'utf8'));
    // 名前がそれでも重なるとき (x.html の 2 ページ目と、x-2.html の出力): 後の入力は書かずに誤り
    fs.writeFileSync(path.join(dir, 'x.html'), '<p>一</p><p style="break-before: page">二</p>');
    fs.writeFileSync(path.join(dir, 'x-2.html'), '<p>別</p>');
    const r4 = spawnSync(process.execPath, [cli, path.join(dir, 'x.html'), path.join(dir, 'x-2.html'), '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r4.status, r4.stderr).toBe(1);
    expect(r4.stderr).toMatch(/x-2\.html: 書く先 x-2\.svg は、この実行で別の入力 \(x\.html\)/);
    // --format svg を同じ文書でもう 1 度組む (前に書いた出力は、参照していなければ読んだファイルではない)
    const r5 = spawnSync(process.execPath, [cli, path.join(dir, 'a.html'), '--format', 'svg', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r5.status, r5.stderr).toBe(0);
  }, 120_000);

  it('引数の誤りの文の制御文字 (ESC) は見える形にする。-o の値の所のオプション (-o --print) は値の誤り。--xhtml は .xml の入力でも効く', () => {
    const dir = fs.mkdtempSync(path.join(work, 'args-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    const html = path.join(dir, 'a.html');
    fs.writeFileSync(html, '<p>a</p>');
    const r1 = spawnSync(process.execPath, [cli, html, '--pages', '\u001b[2J'], { encoding: 'utf8', env: JA_ENV });
    expect(r1.status).toBe(1);
    expect(r1.stderr).not.toContain('\u001b');
    expect(r1.stderr).toContain('\\x1b[2J');
    // 前は --print という名前の PDF を書いて終了 0
    const r2 = spawnSync(process.execPath, [cli, html, '-o', '--print', '--font-dir', fontDir], { cwd: dir, encoding: 'utf8', env: JA_ENV });
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('-o の値がありません (続く --print はオプションです');
    expect(fs.existsSync(path.join(dir, '--print'))).toBe(false);
    // 前は --xhtml を見ずに、.xml を XSL-FO として読んで誤りになった
    const xml = path.join(dir, 'x.xml');
    fs.writeFileSync(xml, '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>XHTML</p></body></html>');
    const r3 = spawnSync(process.execPath, [cli, xml, '--xhtml', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.stdout).toContain('x.pdf: 1 ページ');
  }, 120_000);

  it('出力は、ハードリンクの別名・標準入力の元のファイル・--font-dir の書体も上書きしない。同じ入力を何度も渡したら 1 度だけ組む', () => {
    const dir = fs.mkdtempSync(path.join(work, 'guard2-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    const h = path.join(dir, 'h.html');
    fs.writeFileSync(h, '<p>h</p>');
    // ハードリンクの別名 (前は終了 0 で h.html が PDF になった)
    fs.linkSync(h, path.join(dir, 'hard.pdf'));
    const r1 = spawnSync(process.execPath, [cli, h, '-o', path.join(dir, 'hard.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r1.status, r1.stderr).toBe(1);
    expect(fs.readFileSync(h, 'utf8')).toBe('<p>h</p>');
    // 標準入力の元のファイル (kumiori - -o one.html < one.html)
    const one = path.join(dir, 'one.html');
    fs.writeFileSync(one, '<p>one</p>');
    const fd = fs.openSync(one, 'r');
    try {
      const r2 = spawnSync(process.execPath, [cli, '-', '-o', one, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV, stdio: [fd, 'pipe', 'pipe'] });
      expect(r2.status, r2.stderr).toBe(1);
    } finally {
      fs.closeSync(fd);
    }
    expect(fs.readFileSync(one, 'utf8')).toBe('<p>one</p>');
    // --font-dir の書体 (前は SVG で上書きした)
    const fdir = path.join(dir, 'fd');
    fs.mkdirSync(fdir);
    const font = path.join(fdir, 'NotoSerifJP-Regular.ttf');
    fs.copyFileSync(path.join(fontDir, 'NotoSerifJP-Regular.ttf'), font);
    const size = fs.statSync(font).size;
    const r3 = spawnSync(process.execPath, [cli, h, '--font-dir', fdir, '-o', font, '--format', 'svg'], { encoding: 'utf8', env: JA_ENV });
    expect(r3.status, r3.stderr).toBe(1);
    expect(fs.statSync(font).size).toBe(size);
    // 同じ入力を 3 度 (前は h.pdf・h.html.pdf・h.html.2.pdf を書いた)
    const before = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort();
    const r4 = spawnSync(process.execPath, [cli, h, h, path.join(dir, '.', 'h.html'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.stderr.match(/同じ入力 .* を何度も渡したので、1 度だけ組みます/g)?.length, r4.stderr).toBe(2);
    expect(r4.stdout.match(/ページ \(組版/g)?.length).toBe(1);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort()).toEqual([...new Set([...before, 'h.pdf'])].sort());
  }, 120_000);

  it('同じ入力をまとめても -o はディレクトリ。--watch で入力を名前の変更で保存しても組み直せる。-o /dev/stdout では報告を標準エラーに', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'guard3-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    const a = path.join(dir, 'a.html');
    fs.writeFileSync(a, '<p>a</p>');
    // 前は outdir という拡張子の無いファイルに PDF を書いて終了 0
    const r1 = spawnSync(process.execPath, [cli, a, a, '-o', path.join(dir, 'outdir'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r1.status, r1.stderr).toBe(0);
    expect(fs.statSync(path.join(dir, 'outdir')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'outdir', 'a.pdf'))).toBe(true);
    // -o /dev/stdout > out.pdf: 報告の行で PDF の先頭を壊さない
    const out = path.join(dir, 'out.pdf');
    const fd = fs.openSync(out, 'w');
    try {
      const r2 = spawnSync(process.execPath, [cli, a, '-o', '/dev/stdout', '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV, stdio: ['ignore', fd, 'pipe'] });
      expect(r2.status, r2.stderr).toBe(0);
      expect(r2.stderr).toContain('1 ページ');
    } finally {
      fs.closeSync(fd);
    }
    expect(fs.readFileSync(out).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // -o /dev/stdout をパイプで受ける (前は報告の行が PDF の末尾に付いた)
    // (Node の子プロセスの標準出力はソケットで、/dev/stdout として開けないので、シェルのパイプを通す)
    if (process.platform !== 'win32') {
      const piped = path.join(dir, 'p.pdf');
      const r3 = spawnSync('sh', ['-c', 'exec "$0" "$1" "$2" -o /dev/stdout --font-dir "$3" | cat > "$4"', process.execPath, cli, a, fontDir, piped], { encoding: 'utf8', env: JA_ENV });
      expect(r3.status, r3.stderr).toBe(0);
      const pdf = fs.readFileSync(piped).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pdf.trimEnd().endsWith('%%EOF'), pdf.slice(-80)).toBe(true);
      expect(r3.stderr).toContain('1 ページ');
    }
    // 同じ入力を 2 つと -o - (前は作業のディレクトリに - という空のディレクトリを作った)
    const r4 = spawnSync(process.execPath, [cli, a, a, '-o', '-', '--font-dir', fontDir], { env: JA_ENV, cwd: dir });
    expect(r4.status, String(r4.stderr)).toBe(0);
    expect(r4.stdout.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fs.existsSync(path.join(dir, '-'))).toBe(false);
    // --watch: 新しいファイルに書いて名前を変える保存 (i ノードが変わる) の後も組み直せる。入力の i ノードを確かめるたびに取り直すこと
    // (前は、起動のときの i ノードを受け継いだ新しい出力を誤りにした) は、i ノードの使い回しに頼らずに試せる test/cliOutputGuard.test.ts で
    // 確かめる (ここの PDF の出力は同じ i ノードに書くので、その直しを外しても落ちない)
    const w = path.join(dir, 'w.html');
    fs.writeFileSync(w, '<p>1</p>');
    const child = spawn(process.execPath, [cli, w, '--watch', '--font-dir', fontDir], { stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const until = async (re: RegExp) => {
      for (let i = 0; i < 300 && !re.test(log); i++) await new Promise((r) => setTimeout(r, 100));
      return re.test(log);
    };
    try {
      expect(await until(/見張って/), log).toBe(true);
      const save = (body: string) => {
        fs.writeFileSync(`${w}.tmp`, body);
        fs.renameSync(`${w}.tmp`, w);
      };
      // 2 回目からの保存も拾う (Node 22 の Linux の再帰の fs.watch は、名前の変更の 2 回目から拾わなかった)
      for (let n = 2; n <= 4; n++) {
        save(`<p>1</p>${'<p style="break-before: page">x</p>'.repeat(n - 1)}`);
        expect(await until(new RegExp(`w\\.pdf: ${n} ページ`)), log).toBe(true);
      }
      expect(log).not.toContain('上書きしません');
    } finally {
      child.kill();
    }
  }, 120_000);

  it('PDF を一時のファイルに流して書く途中で、合図 (SIGINT・SIGTERM) で止めても、一時のファイルを残さず、合図で終わる', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'signal-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    // PDF を書く間が長い文書 (ページが多い)。一時のファイルが出来た所で止める
    fs.writeFileSync(path.join(dir, 'big.html'), `<p>${'組み織りの見本の段落。'.repeat(40)}</p>`.repeat(6000));
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const out = path.join(dir, `big-${sig}.pdf`);
      const child = spawn(process.execPath, [cli, path.join(dir, 'big.html'), '-o', out, '--font-dir', fontDir], { stdio: 'ignore', env: JA_ENV });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
      const parts = () => fs.readdirSync(dir).filter((n) => n.startsWith(`big-${sig}.pdf.part-`));
      let seen = false;
      for (let i = 0; i < 3000 && !seen; i++) {
        seen = parts().length > 0;
        if (!seen) await new Promise((r) => setTimeout(r, 20));
      }
      expect(seen, `${sig}: 一時のファイルが出来なかった`).toBe(true);
      child.kill(sig);
      const r = await exited;
      expect(r.signal, `${sig}: ${JSON.stringify(r)}`).toBe(sig);
      expect(parts()).toEqual([]);
      expect(fs.existsSync(out)).toBe(false);
    }
  }, 300_000);

  // 読み取り専用の前の出力は、名前を替えて置き換えずに、前のとおり書けない誤りにする。root では読み取り専用のファイルにも書けるので、
  // 子のプロセスを別の利用者 (nobody) で動かす (root の Linux でだけ試せる)
  it.runIf(process.platform === 'linux' && process.getuid?.() === 0)('読み取り専用の前の出力は置き換えず、書けない誤りにする (前の中身が残る)', (ctx) => {
    // 試験の作業のディレクトリ (0700) は nobody がたどれないので、/tmp の直下に作る
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-ro-'));
    fs.chmodSync(dir, 0o777);
    ctx.onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    const tools = nobodyTools(dir);
    if (typeof tools === 'string') return ctx.skip(tools);
    const input = path.join(dir, 'a.html');
    fs.writeFileSync(input, '<p>あ</p>');
    const out = path.join(dir, 'a.pdf');
    fs.writeFileSync(out, 'old');
    fs.chmodSync(out, 0o444);
    const r = spawnSync(tools.node, [tools.cli, input, '-o', out, '--font-dir', tools.fonts, '--no-font-cache'], { encoding: 'utf8', env: { ...JA_ENV, HOME: dir }, uid: NOBODY, gid: NOBODY });
    expect(r.error).toBeUndefined();
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toMatch(/EACCES|permission/i);
    expect(fs.readFileSync(out, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir).filter((n) => n.includes('.part-'))).toEqual([]);
  });

  it('同じ文書の SVG・PNG の書き出しを 2 度続けられる (使っていない画像は「読んだファイル」に数えない)。--drawio-stencils のディレクトリの中は上書きしない', () => {
    const dir = fs.mkdtempSync(path.join(work, 'twice-'));
    const cli = path.join(root, 'dist-cli/cli.js');
    const go = (...a: string[]) => spawnSync(process.execPath, [cli, ...a, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV, cwd: dir });
    // 参照は img/a.svg、出力は a.svg (前は、名前の末尾だけで当たった a.svg を「読んだ」として、2 度目が誤り)
    fs.mkdirSync(path.join(dir, 'img'));
    fs.writeFileSync(path.join(dir, 'img', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    fs.writeFileSync(path.join(dir, 'a.html'), '<p>x<img src="img/a.svg"></p>');
    for (let k = 0; k < 2; k++) {
      const r = go('a.html', '--format', 'svg');
      expect(r.status, `${k}: ${r.stderr}`).toBe(0);
    }
    // 本文の字に名前が出てくるだけ (前は、2 度目に出力の b.png を「読んだ」として誤り)
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>See b.png</p>');
    for (let k = 0; k < 2; k++) {
      const r = go('b.html', '--format', 'png');
      expect(r.status, `${k}: ${r.stderr}`).toBe(0);
    }
    // 文書が実際に使う画像は、これまでどおり守る
    fs.writeFileSync(path.join(dir, 'c.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    fs.writeFileSync(path.join(dir, 'c.html'), '<p><img src="c.svg"></p>');
    expect(go('c.html', '--format', 'svg').status).toBe(1);
    // --drawio-stencils のディレクトリの中のファイル (前は st/x-1.svg を上書きして終了 0)
    fs.mkdirSync(path.join(dir, 'st'));
    fs.writeFileSync(path.join(dir, 'st', 'x-1.svg'), '<mxlibrary>[]</mxlibrary>');
    fs.writeFileSync(path.join(dir, 'm.html'), '<p>1</p><p style="break-before: page">2</p>');
    const r = go('m.html', '--drawio-stencils', 'st', '-o', path.join('st', 'x.svg'));
    expect(r.status, r.stderr).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'st', 'x-1.svg'), 'utf8')).toBe('<mxlibrary>[]</mxlibrary>');
  }, 120_000);

  it('相対参照に %2F のある画像は、読めない画像として警告し、PDF を作る (前は変換が止まり終了 1)', () => {
    const dir = fs.mkdtempSync(path.join(work, 'pct2f-'));
    const html = path.join(dir, 'p.html');
    fs.writeFileSync(html, '<p>x<img src="a%2Fb.png"><img src="../a%2Fb.png"></p>');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('image/not-found');
    expect(fs.existsSync(path.join(dir, 'p.pdf'))).toBe(true);
  }, 120_000);

  it('--help は使い方を、--version は版 (package.json の version) を標準出力に書いて 0 で終わる', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const help = execFileSync(process.execPath, [cli, '--help'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV });
    expect(help).toContain('使い方: kumiori');
    expect(help).toContain('--version');
    const ver = execFileSync(process.execPath, [cli, '--version'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV }).trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    expect(ver).toBe(pkg.version);
    expect(execFileSync(process.execPath, [cli, '-v'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV }).trim()).toBe(pkg.version);
  });

  it('書体のキャッシュ: --font-dir に無い既定の書体はネットワークから取って --font-cache に保存し、次からはそこから読む。壊れたキャッシュは捨てて取り直す', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const cache = path.join(work, 'font-cache');
    fs.mkdirSync(cache, { recursive: true });
    // キャッシュに Tinos-Bold 以外の既定の書体を置き、Tinos-Bold は壊れたファイルにする (--font-dir は渡さない)
    for (const f of fs.readdirSync(fontDir)) if (/\.ttf$/.test(f) && f !== 'Tinos-Bold.ttf') fs.copyFileSync(path.join(fontDir, f), path.join(cache, f));
    fs.writeFileSync(path.join(cache, 'Tinos-Bold.ttf'), 'broken');
    const html = path.join(work, 'cache.html');
    fs.writeFileSync(html, '<!DOCTYPE html><html><head><title>t</title></head><body><p>キャッシュ <b>bold</b></p></body></html>');
    const out = path.join(work, 'cache.pdf');
    const first = execFileSync(process.execPath, [cli, html, '-o', out, '--font-cache', cache], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    expect(first).toContain('cache.pdf: 1 ページ');
    const saved = fs.readFileSync(path.join(cache, 'Tinos-Bold.ttf'));
    expect(saved.length).toBeGreaterThan(10_000);
    expect(saved.subarray(0, 4)).toEqual(Buffer.from([0, 1, 0, 0]));
    // 2 回目はネットワークに行かない (保存の知らせが出ない)。--no-font-cache はキャッシュを読まない (ネットワークから取るが保存しない)
    const second = spawnSync(process.execPath, [cli, html, '-o', out, '--font-cache', cache], { encoding: 'utf8', env: JA_ENV });
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain('保存しました');
    // 書けない場所 (ファイル) をキャッシュにしても、変換は成功する (1 度だけ知らせる)
    fs.unlinkSync(path.join(cache, 'Tinos-Bold.ttf'));
    const bad = spawnSync(process.execPath, [cli, html, '-o', out, '--font-cache', path.join(work, 'cache.html'), '--font-dir', cache], { encoding: 'utf8', env: JA_ENV });
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain('書体のキャッシュに書けません');
    expect(fs.existsSync(path.join(cache, 'Tinos-Bold.ttf'))).toBe(false);
  }, 120_000);

  it('--ignore-warning: 名前を指定した診断を出さない (知らない名前は警告して続ける)。--fail-on: 当たる診断があれば、出力を書いた上で終了コード 2', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const html = path.join(work, 'failon.html');
    fs.writeFileSync(html, '<!DOCTYPE html><html lang="ja"><head><title>t</title><style>p { colr: red }</style></head><body><p>x</p></body></html>');
    const out = path.join(work, 'failon.pdf');
    const plain = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(plain.status).toBe(0);
    expect(plain.stderr).toContain('[css/unknown-property]');
    // --fail-on warning: 警告があれば 2 (PDF は書く)。--fail-on error: 誤り (重さ error) が無ければ 0
    fs.rmSync(out, { force: true });
    const w = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--fail-on', 'warning'], { encoding: 'utf8', env: JA_ENV });
    expect(w.status).toBe(2);
    expect(fs.existsSync(out)).toBe(true);
    expect(spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--fail-on', 'error'], { encoding: 'utf8', env: JA_ENV }).status).toBe(0);
    // 出さない診断は、書かず、--fail-on でも数えない。知らない名前は警告して続ける
    const ig = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--ignore-warning', 'css/unknown-property', '--fail-on', 'warning'], { encoding: 'utf8', env: JA_ENV });
    expect(ig.status).toBe(0);
    expect(ig.stderr).not.toContain('colr');
    const bad = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--ignore-warning', 'css/unknown-property,nope/x'], { encoding: 'utf8', env: JA_ENV });
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain('[api/unknown-diagnostic-code]');
    // 文は、コマンドの名前で書く (API の diagnostics.ignore で書かない)
    expect(bad.stderr).toContain('--ignore-warning の名前 "nope/x" は、診断の名前にありません');
    expect(bad.stderr).not.toContain('diagnostics.ignore');
    expect(bad.stderr).not.toContain('colr');
    // 値の誤りは使い方の誤り
    expect(spawnSync(process.execPath, [cli, html, '--fail-on', 'info'], { encoding: 'utf8', env: JA_ENV }).status).toBe(1);
  }, 120_000);
  it('--lang en・KUMIORI_LANG・LANG で、使い方・報告・警告・誤りの文が英語になる (既定と LANG=C は日本語)', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    // 言語を決める環境変数は、すべてここで明示する (テストを走らせる機械の値を持ち込まない)
    const env = { ...process.env, LANG: 'C', LC_ALL: '', LC_MESSAGES: '', KUMIORI_LANG: '' };
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env })).toMatch(/^使い方: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--lang', 'en', '--help'], { encoding: 'utf8', env })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8' } })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8', KUMIORI_LANG: 'ja' } })).toMatch(/^使い方: kumiori/);
    // LC_ALL は LC_MESSAGES・LANG より先、LC_MESSAGES は LANG より先。どれも無ければ日本語
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'ja_JP.UTF-8', LC_ALL: 'en_US.UTF-8' } })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' } })).toMatch(/^使い方: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: '' } })).toMatch(/^使い方: kumiori/);
    // 変換の報告と警告
    const html = path.join(work, 'lang.html');
    fs.writeFileSync(html, '<!DOCTYPE html><html><head><title>t</title><style>.g { display: grid; grid-template-areas: "a b" }</style></head><body><div class="g"><p>a</p></div></body></html>');
    const out = path.join(work, 'lang.pdf');
    const r = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--lang', 'en'], { encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^lang\.pdf: 1 page \(layout \d+ms\)/);
    // 診断は 1 件 1 行: 重さ・名前・場所 (ファイル:行:列)・文
    expect(r.stderr).toContain('  warning [css/unsupported] lang.html:1:71: ignored unsupported CSS: grid-template-areas');
    // 使い方の誤り (--lang は、どこに書いても誤りの文に効く)
    const bad = spawnSync(process.execPath, [cli, html, '--style', 'nope', '--lang', 'en'], { encoding: 'utf8', env });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^--style cannot be "nope"/);
    const badLang = spawnSync(process.execPath, [cli, html, '--lang', 'fr'], { encoding: 'utf8', env });
    expect(badLang.status).toBe(1);
    expect(badLang.stderr).toContain('--lang の値 "fr" は使えません');
  });
  it('dist-cli には、コマンドとライセンスの表示だけが入る (public/ の favicon・書体をコピーしない)', () => {
    // dist-cli は npm の配布物に入る (package.json の files)。public/ は画面 (dist/) のためのもので、手元では public/fonts に書体も置く
    const files = (fs.readdirSync(path.join(root, 'dist-cli'), { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'));
    for (const f of ['cli.js', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) expect(files).toContain(f);
    expect(files.filter((f) => fs.existsSync(path.join(root, 'public', f)))).toEqual([]);
    expect(files.filter((f) => /\.(ttf|otf|ttc|woff2?|ico|png|svg)$/i.test(f) || f.startsWith('fonts'))).toEqual([]);
  });
  it('知らないオプション・値の無いオプションは、使い方を出してエラーで終わる (値を入力のファイルとして扱わない)', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const fail = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV });
        return '';
      } catch (e) {
        return String((e as { stderr?: string }).stderr);
      }
    };
    const a = fail('a.html', '--fontdir', 'fonts');
    expect(a).toContain('知らないオプションです: --fontdir');
    expect(a).toContain('使い方');
    expect(fail('a.html', '-o')).toContain('-o の値がありません');
    const empty = fail('a.html', '-o', '');
    expect(empty).toContain('-o の値が空です');
    expect(empty).toContain('使い方');
    const bad = path.join(work, 'bad-spots.json');
    fs.writeFileSync(bad, JSON.stringify({ X: [0, 0, 1] }));
    expect(fail('a.html', '--spot-colors', bad)).toContain('--spot-colors の「X」の値は CMYK');
  });

  it('XML として読めない FO はエラーで終わる', () => {
    const fo = path.join(work, 'broken.fo');
    fs.writeFileSync(fo, '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:block>');
    expect(() => execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), fo, '--font-dir', fontDir], { stdio: 'pipe', env: JA_ENV })).toThrow();
  }, 120_000);

  it('文書・CSS の相対参照が入力のディレクトリの外を指す @font-face の書体も読む。どこにも無い書体のファイルは警告で知らせる (CSS-24 (11))', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'outside-'));
    fs.mkdirSync(path.join(dir, 'fx'));
    fs.mkdirSync(path.join(dir, 'sub', 'css'), { recursive: true });
    fs.copyFileSync(path.join(fontDir, 'Cousine-Regular.ttf'), path.join(dir, 'fx', 'Cousine-Regular.ttf'));
    /** PDF に埋め込んだ書体の名前 (BaseFont) */
    const baseFonts = (pdf: PDFDocument) =>
      pdf.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFDict && o.lookup(PDFName.of('Type')) === PDFName.of('Font') ? [String(o.lookup(PDFName.of('BaseFont')))] : []));
    // 文書の <style> の相対参照 (ブラウザで手元の HTML を開いたときと同じく、文書の場所を基準に解決したファイルを読む)
    const a = path.join(dir, 'sub', 'a.html');
    fs.writeFileSync(a, '<style>@font-face{font-family:X;src:url(../fx/Cousine-Regular.ttf)}p{font-family:X}</style><p>iiiWWW</p>');
    const ra = await run(a);
    expect(baseFonts(ra.pdf).some((n) => n.includes('Cousine'))).toBe(true);
    // CSS のファイルの中の相対参照 (CSS の場所 sub/css/ を基準に、入力のディレクトリ sub/ より 1 つ上)
    fs.writeFileSync(path.join(dir, 'sub', 'css', 'b.css'), '@font-face{font-family:X;src:url("../../fx/Cousine-Regular.ttf")}p{font-family:X}');
    const b = path.join(dir, 'sub', 'b.html');
    fs.writeFileSync(b, '<link rel="stylesheet" href="css/b.css"><p>iiiWWW</p>');
    const rb = await run(b);
    expect(baseFonts(rb.pdf).some((n) => n.includes('Cousine'))).toBe(true);
    // どこにも無いファイル: 黙って既定の書体にせず、警告で知らせる
    const c = path.join(dir, 'sub', 'c.html');
    fs.writeFileSync(c, '<style>@font-face{font-family:X;src:url(../fx/none.ttf)}p{font-family:X}</style><p>iiiWWW</p>');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), c, '-o', path.join(dir, 'c.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('@font-face の書体のファイルが見つかりません: X (../fx/none.ttf)');
  }, 120_000);
  it('警告の中の制御文字 (文書に書かれたエスケープ シーケンス・改行) は、見える形にして書く', () => {
    const dir = path.join(work, 'ctl');
    fs.mkdirSync(dir, { recursive: true });
    const h = path.join(dir, 'c.html');
    // 画像の URL に、題名を書き換える OSC・画面を消す CSI・8 ビットの CSI (U+009B)・改行 (偽の報告の行) を入れた文書
    fs.writeFileSync(h, '<p>x</p><img src="a\x1b]0;T\x07\x1b[2J\u009b31m&#10;b.pdf: 1 ページ.png">');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), h, '-o', path.join(dir, 'c.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env: JA_ENV });
    expect(r.status).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(r.stderr).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(r.stderr).toContain('a\\x1b]0;T\\x07\\x1b[2J\\x9b31m\\x0ab.pdf: 1 ページ.png');
    // 警告は 1 件が 1 行のまま (改行で行を増やせない)
    expect(r.stderr.split('\n').filter((l) => /^b\.pdf/.test(l))).toEqual([]);
  }, 120_000);
  it('--no-outside-files: 文書が file: の URL・../ で指した、入力のディレクトリの外のファイルを読まない', () => {
    const dir = path.join(work, 'outside', 'doc');
    const out = path.join(work, 'outside', 'secret');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    // 8 ビット RGB の小さな PNG (zlib の圧縮なしの塊)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
    fs.writeFileSync(path.join(out, 'p.png'), png);
    fs.writeFileSync(path.join(dir, 'in.png'), png);
    const h = path.join(dir, 'c.html');
    fs.writeFileSync(h, `<p><img src="../secret/p.png"><img src="file://${path.join(out, 'p.png')}"><img src="in.png"></p>`);
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), h, '-o', path.join(dir, 'c.pdf'), '--font-dir', fontDir, ...args], { encoding: 'utf8', env: JA_ENV });
    // 既定: 外のファイルも読む (警告なし)
    const a = run();
    expect(a.status).toBe(0);
    expect(a.stderr).not.toContain('p.png');
    // --no-outside-files: 外の 2 つは読めない画像、中の画像は読む
    const b = run('--no-outside-files');
    expect(b.status).toBe(0);
    expect(b.stderr).toContain('../secret/p.png');
    expect(b.stderr).toMatch(/file:\/\/.*p\.png/);
    expect(b.stderr).not.toContain('in.png');
  }, 120_000);

  it('--plugin: プラグインのモジュールを読み込み、--plugin-option の選択肢を渡す (画像の形式を足す)。見つからなければエラー', () => {
    const dir = fs.mkdtempSync(path.join(work, 'plugin-'));
    // 中身が「BOX」で始まるファイルを、選択肢の色の四角にするプラグイン。default は (選択肢, { cacheDir }) を受ける関数
    fs.writeFileSync(
      path.join(dir, 'box-plugin.mjs'),
      `export default (options, ctx) => ({
  apiVersion: 1,
  name: 'box',
  imageFormats: [{
    name: 'box', mime: 'application/x-box', extensions: ['box'],
    sniff: (b) => new TextDecoder().decode(b.subarray(0, 4)) === 'BOX ',
    load: async (b, c) => {
      c.warn('box: ' + options.color + ' ' + (typeof ctx.cacheDir));
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="' + options.color + '"/></svg>', width: 40, height: 20, warnings: [] };
    },
  }],
});
`,
    );
    fs.writeFileSync(path.join(dir, 'a.box'), 'BOX 40 20');
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<p><img src="a.box"></p>');
    const out = path.join(dir, 'doc.pdf');
    const ok = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir, '--no-font-cache', '--plugin', path.join(dir, 'box-plugin.mjs'), '--plugin-option', 'color=#ff0000'], { encoding: 'utf8', env: JA_ENV });
    expect(ok.status).toBe(0);
    expect(ok.stderr).toContain('box: #ff0000 undefined');
    expect(ok.stderr).not.toContain('a.box');
    const missing = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '-o', out, '--font-dir', fontDir, '--plugin', 'kumiori-no-such-plugin'], { encoding: 'utf8', env: JA_ENV });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('プラグインが見つかりません: kumiori-no-such-plugin');
  });
  it('--plugin <パッケージ名>: exports に import の条件しか無い ESM のパッケージを、今のディレクトリから読む (同じ名前のディレクトリがあっても)', () => {
    const dir = fs.mkdtempSync(path.join(work, 'plugin-pkg-'));
    const pd = path.join(dir, 'node_modules', 'kumiori-esm-plugin');
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, 'package.json'), JSON.stringify({ name: 'kumiori-esm-plugin', type: 'module', exports: { '.': { import: './index.js' } } }));
    fs.writeFileSync(path.join(pd, 'index.js'), "export default (o) => { console.error('esm plugin: ' + o.x); return { apiVersion: 1, name: 'esm' }; };\n");
    // 今のディレクトリの、パッケージと同じ名前のディレクトリ (前は、これを import しようとして失敗していた)
    fs.mkdirSync(path.join(dir, 'kumiori-esm-plugin'));
    fs.writeFileSync(path.join(dir, 'doc.html'), '<p>x</p>');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), 'doc.html', '-o', 'doc.pdf', '--font-dir', fontDir, '--no-font-cache', '--plugin', 'kumiori-esm-plugin', '--plugin-option', 'x=1'], { cwd: dir, encoding: 'utf8', env: JA_ENV });
    expect(r.stderr).not.toContain('見つかりません');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('esm plugin: 1');
    expect(fs.existsSync(path.join(dir, 'doc.pdf'))).toBe(true);
  });
  it('--plugin の .js で終わるパッケージの指定 (パッケージの中のファイル・exports の鍵・名前が .js で終わるもの) と、今のディレクトリのファイルへの落とし方', () => {
    const dir = fs.mkdtempSync(path.join(work, 'plugin-js-'));
    const pkgOf = (name: string, pjson: object, files: Record<string, string>) => {
      const d = path.join(dir, 'node_modules', name);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pjson));
      for (const [f, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
        fs.writeFileSync(path.join(d, f), body);
      }
    };
    const P = (n: string) => `export default () => { console.error('loaded: ${n}'); return { apiVersion: 1, name: '${n}' }; };\n`;
    pkgOf('kp', { name: 'kp', type: 'module' }, { 'dist/plugin.js': P('kp-dist') });
    pkgOf('kp2', { name: 'kp2', type: 'module', exports: { '.': './index.js', './extra.js': './e.js' } }, { 'index.js': P('kp2'), 'e.js': P('kp2-extra') });
    pkgOf('kplug.js', { name: 'kplug.js', type: 'module', main: 'main.js' }, { 'main.js': P('kplug-pkg') });
    fs.writeFileSync(path.join(dir, 'kplug.js'), P('kplug-file'));
    fs.writeFileSync(path.join(dir, 'mine.mjs'), P('mine-file'));
    fs.writeFileSync(path.join(dir, 'doc.html'), '<p>x</p>');
    const run = (spec: string) => spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), 'doc.html', '-o', 'doc.pdf', '--font-dir', fontDir, '--no-font-cache', '--plugin', spec], { cwd: dir, encoding: 'utf8', env: JA_ENV });
    for (const [spec, name] of [
      ['kp/dist/plugin.js', 'kp-dist'],
      ['kp2/extra.js', 'kp2-extra'],
      // 同じ名前のパッケージとファイルがあれば、パッケージ (import() と同じ)。ファイルは ./ を付けて指す
      ['kplug.js', 'kplug-pkg'],
      ['./kplug.js', 'kplug-file'],
      // パッケージとして見つからなければ、今のディレクトリのファイル
      ['mine.mjs', 'mine-file'],
    ]) {
      const r = run(spec);
      expect(r.status, `${spec}: ${r.stderr}`).toBe(0);
      expect(r.stderr, spec).toContain(`loaded: ${name}`);
    }
    // どちらも無い: 何をどの順に探したか
    const missing = run('nope/x.js');
    expect(missing.status).not.toBe(0);
    const real = fs.realpathSync(dir);
    expect(missing.stderr).toMatch(/プラグインが見つかりません: nope\/x\.js \(パッケージ nope を、.* から上の node_modules で探したが無い。今のディレクトリのファイル .*x\.js も無い\)/);
    expect(missing.stderr.includes(dir) || missing.stderr.includes(real)).toBe(true);
  }, 120_000);
  it('--watch と読めない --plugin: 文を 1 度だけ出し、スタックトレースを出さずに終了コード 1 で終わる', () => {
    const dir = fs.mkdtempSync(path.join(work, 'watch-plugin-'));
    const html = path.join(dir, 'a.html');
    fs.writeFileSync(html, '<p>x</p>');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '--watch', '--font-dir', fontDir, '--plugin', 'kumiori-no-such-plugin'], { encoding: 'utf8', env: JA_ENV, timeout: 60_000 });
    expect(r.signal, r.stderr).toBeNull();
    expect(r.status).toBe(1);
    expect(r.stderr.split('プラグインが見つかりません: kumiori-no-such-plugin').length - 1).toBe(1);
    expect(r.stderr).not.toMatch(/^\s*at /m);
    expect(r.stderr).not.toContain('見張って');
  }, 120_000);
  it('--no-outside-files: 入力のディレクトリの中の、外のファイルを指すシンボリックリンクも読まない', () => {
    const base = path.join(work, 'outside-link');
    const dir = path.join(base, 'doc');
    const out = path.join(base, 'secret');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
    fs.writeFileSync(path.join(out, 's.png'), png);
    fs.writeFileSync(path.join(dir, 'in.png'), png);
    try {
      fs.symlinkSync(path.join(out, 's.png'), path.join(dir, 'a.png'));
    } catch {
      return; // シンボリックリンクを作れない環境 (権限の無い Windows など) では確かめない
    }
    const h = path.join(dir, 'c.html');
    fs.writeFileSync(h, '<p><img src="a.png"><img src="in.png"></p>');
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), h, '-o', path.join(dir, 'c.pdf'), '--font-dir', fontDir, ...args], { encoding: 'utf8', env: JA_ENV });
    // 既定: リンクの先も読む (警告なし)
    expect(run().stderr).not.toContain('a.png');
    // --no-outside-files: リンクの先は外なので読めない画像、中の画像は読む
    const b = run('--no-outside-files');
    expect(b.status).toBe(0);
    expect(b.stderr).toContain('a.png');
    expect(b.stderr).not.toContain('in.png');
  }, 120_000);
  it('読み込んだプラグインが終わらないときは、何も言わずに 0 で終わらず、誤りとして 1 で終わる', () => {
    const dir = path.join(work, 'hang-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'p.mjs'), 'export default function () { return new Promise(() => {}); }\n');
    const h = path.join(dir, 'a.html');
    fs.writeFileSync(h, '<p>x</p>');
    const r = spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), h, '-o', path.join(dir, 'a.pdf'), '--font-dir', fontDir, '--plugin', path.join(dir, 'p.mjs')], { encoding: 'utf8', env: JA_ENV, timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('組み終える前に処理が止まりました');
    expect(fs.existsSync(path.join(dir, 'a.pdf'))).toBe(false);
  }, 120_000);

  it('--system-fonts: どの書体にも字形の無い字を OS の書体で組む。--no-outside-files とは一緒に使えない', async () => {
    // 記号・絵文字の書体も置いておく (私用の字は、それらを読んでから OS の書体で探す)
    await ensureFonts([SYMBOL_SPEC, EMOJI_SPEC]);
    const cli = path.join(root, 'dist-cli/cli.js');
    const dir = fs.mkdtempSync(path.join(work, 'sysfonts-'));
    const html = path.join(dir, 'a.html');
    fs.writeFileSync(html, `<p>あ${String.fromCodePoint(0xf0101)}</p>`);
    // OS の書体の場所を、一時のディレクトリに向ける (fontconfig の設定のファイルと XDG の場所。手元の OS の書体に頼らない)
    const share = path.join(dir, 'share');
    fs.mkdirSync(path.join(share, 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(share, 'fonts', 'sys.ttf'), buildTestFont({ family: 'Cli System', chars: [0xf0101] }));
    const env = { ...JA_ENV, FONTCONFIG_FILE: path.join(dir, 'none.conf'), XDG_DATA_HOME: share, XDG_DATA_DIRS: path.join(dir, 'nothing'), HOME: dir };
    const plain = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'a.pdf'), '--font-dir', fontDir], { encoding: 'utf8', env });
    expect(plain.status).toBe(0);
    expect(plain.stderr).toContain('[font/missing-glyph]');
    expect(plain.stderr).toContain('--system-fonts で、OS の書体から字形を探せます');
    // --no-outside-files のときは、一緒に使えない --system-fonts を勧めない
    const inside = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'd.pdf'), '--font-dir', fontDir, '--no-outside-files'], { encoding: 'utf8', env });
    expect(inside.status).toBe(0);
    expect(inside.stderr).toContain('[font/missing-glyph]');
    expect(inside.stderr).not.toContain('--system-fonts');
    const sys = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'b.pdf'), '--font-dir', fontDir, '--system-fonts', '--verbose'], { encoding: 'utf8', env });
    expect(sys.status).toBe(0);
    expect(sys.stderr).not.toContain('[font/missing-glyph]');
    expect(sys.stderr).toContain('[font/system-fallback]');
    expect(sys.stderr).toContain('Cli System (sys.ttf)');
    const bad = spawnSync(process.execPath, [cli, html, '-o', path.join(dir, 'c.pdf'), '--system-fonts', '--no-outside-files'], { encoding: 'utf8', env });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('--system-fonts は --no-outside-files と一緒に使えません');
    expect(fs.existsSync(path.join(dir, 'c.pdf'))).toBe(false);
  }, 120_000);
});
