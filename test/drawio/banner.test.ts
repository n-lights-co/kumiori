/**
 * ビルドした配布物 (dist-lib・dist-cli・dist-browser) の、draw.io と mxGraph から移したコードを取り込んだチャンクが、どれも先頭に
 * 著作権表示 (src/drawio/notice.ts の drawioBanner) を持つことを見る。
 * ビルドするとソースのコメント (移したファイルの先頭の表示) が除かれるので、vite.config.ts の postBanner が、チャンクに取り込んだ
 * モジュールの道で選んで付ける。チャンクの分かれ方や選び方が変わると、何も言わずに消えるので、ここで見張る。
 *
 * 目印は、移した各ファイルの文字列の定数のうち、ほかのソース (src の下の、移していないファイル) に無いもの。目印を含むチャンクは、
 * 移したコードを取り込んでいるので、バナーを持たなければならない。ビルドは一時のディレクトリに出す (並んで走る test/package.test.ts・
 * test/cli.test.ts の dist-lib・dist-cli とぶつからない)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drawioBanner } from '../../src/drawio/notice';

const root = path.resolve(__dirname, '../..');
const src = path.join(root, 'src');
const walk = (d: string, ext: RegExp): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), ext) : ext.test(e.name) ? [path.join(d, e.name)] : []));

const sources = walk(src, /\.ts$/);
/** 移したファイル (先頭に「元のソースの表示」があるもの。test/drawio/notices.test.ts が表と合うことを見る) */
const ported = sources.filter((f) => f.startsWith(path.join(src, 'drawio') + path.sep) && fs.readFileSync(f, 'utf8').includes('元のソースの表示'));
const others = sources
  .filter((f) => !ported.includes(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
/**
 * 目印にできる文字列の定数の無い、移したファイル。drawioCanvas.ts (形を描く道具) は drawio.ts・drawioStencil.ts から、drawioTapered.ts (先の細い矢印) は
 * drawio.ts から読まれ、同じチャンクに入るので、そちらの目印で見る
 */
const NO_MARKER = ['drawioCanvas.ts', 'drawioTapered.ts'];

/**
 * 文字列の定数 (10 字以上の ASCII。\ と ${ を含まないもの。import の道 ./… を除く。名前だけの字 (英数字と _) のものは、依存のパッケージの
 * 属性の名前と取り違えないように、16 字以上のものだけ)。引用符の前後が、式の区切りの字のものだけを取る
 * (2 つの定数の間のコードを、1 つの定数と取り違えない)
 */
const literals = (code: string) =>
  [...code.matchAll(/(?<=[(,=:[?{\s+])(['"])([ -~]{10,}?)\1(?=[),;:\]}.\s+])/g)].map((m) => m[2]).filter((s) => !/['"\\`]|\$\{/.test(s) && !s.startsWith('.') && (/\W/.test(s) || s.length >= 16));
const markers = new Map(ported.map((f) => [path.relative(path.join(src, 'drawio'), f).split(path.sep).join('/'), [...new Set(literals(fs.readFileSync(f, 'utf8')))].filter((s) => !others.includes(s))]));

const BUILDS = { 'dist-lib': 'vite.lib.config.ts', 'dist-cli': 'vite.cli.config.ts', 'dist-browser': 'vite.browser.config.ts' } as const;
let work = '';

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-banner-'));
  const vite = path.join(root, 'node_modules/vite/bin/vite.js');
  for (const [name, config] of Object.entries(BUILDS))
    execFileSync(process.execPath, [vite, 'build', '--config', config, '--outDir', path.join(work, name), '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'ignore' });
}, 600_000);

afterAll(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe('配布物の draw.io の著作権表示', () => {
  it('目印: 移したファイルのどれもが、目印の文字列を持つ (目印の無いファイルは決まった一覧だけ)', () => {
    expect([...markers].filter(([, m]) => !m.length).map(([f]) => f)).toEqual(NO_MARKER);
  });
  for (const name of Object.keys(BUILDS))
    it(`${name}: 移したコードを含むチャンクは、どれも先頭に draw.io と mxGraph の著作権表示を持つ`, () => {
      const chunks = walk(path.join(work, name), /\.js$/).map((f) => ({ name: path.relative(path.join(work, name), f), text: fs.readFileSync(f, 'utf8') }));
      const all = [...markers.values()].flat();
      const withCode = chunks.filter((c) => all.some((m) => c.text.includes(m)));
      expect(withCode.length, '移したコードを含むチャンクがある').toBeGreaterThan(0);
      // 目印が配布物に残っている (縮めても文字列の定数は残る)。目印を持つ移したファイルの、どれもが、どこかのチャンクに入っている
      for (const [file, m] of markers)
        if (m.length) expect(withCode.some((c) => m.some((s) => c.text.includes(s))), `${name} に ${file} の目印が無い`).toBe(true);
      const banner = drawioBanner();
      for (const c of withCode) {
        const at = c.text.indexOf(banner);
        // 先頭の注釈の中にある (Kumiori の表示などの注釈の後ろ。コードの前)
        expect(at, `${name}/${c.name} に draw.io の著作権表示が無い`).toBeGreaterThanOrEqual(0);
        expect(/^(?:#![^\n]*\n)?(?:\s*\/\*[\s\S]*?\*\/)*\s*$/.test(c.text.slice(0, at)), `${name}/${c.name} の draw.io の著作権表示が先頭の注釈に無い`).toBe(true);
      }
    });
});
