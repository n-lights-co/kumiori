/**
 * npm の配布物 (tarball) を、利用者の側から確かめるテスト: ライブラリとブラウザ用のバンドルを作り (build:lib・build:browser)、
 * `npm pack` の tarball を一時のディレクトリの node_modules/kumiori に展開して、
 *  - `import`・`require()` の両方で kumiori・kumiori/node・kumiori/browser・kumiori/package.json が読めること
 *  - 利用者役の TypeScript のプロジェクト (moduleResolution が NodeNext・Node16・Bundler、skipLibCheck が false・true) で型が効くこと
 * を見る。
 *
 * tarball は、package.json と出力 (dist-lib・dist-browser) を写した場所で作る: リポジトリの直下で `npm pack` すると dist-cli も読み、
 * 並んで走る test/cli.test.ts の build:cli (dist-cli を空にして作り直す) とぶつかる。dist-cli の中身は test/cli.test.ts が見る。
 * 依存パッケージは取得せず、リポジトリの node_modules のものへリンクを張る (ネットワークを使わない)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  files: string[];
  engines: { node: string };
  dependencies: Record<string, string>;
};
/** Windows の npm は npm.cmd なので、シェルを通す (test/cli.test.ts と同じ) */
const shell = process.platform === 'win32';
let work = '';
/** 利用者役のプロジェクトの場所 (node_modules/kumiori に tarball の中身がある) */
let app = '';
/** tarball に入ったファイルの一覧 (パッケージの直下からの相対パス) */
let packed: string[] = [];

beforeAll(() => {
  execFileSync('npm', ['run', '--silent', 'build:lib'], { cwd: root, stdio: 'ignore', shell });
  execFileSync('npm', ['run', '--silent', 'build:browser'], { cwd: root, stdio: 'ignore', shell });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-package-'));
  // tarball を作る場所: package.json・files の挙げるもの (dist-cli を除く) を写す
  const stage = path.join(work, 'stage');
  fs.mkdirSync(stage);
  for (const name of ['package.json', ...pkg.files.filter((f) => f !== 'dist-cli')]) {
    fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  }
  const out = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell });
  const info = (JSON.parse(out) as { filename: string; files: { path: string }[] }[])[0]!;
  packed = info.files.map((f) => f.path);
  // 利用者役のプロジェクト: node_modules/kumiori に tarball を展開し、依存パッケージはリポジトリのものへリンクする
  app = path.join(work, 'app');
  const modules = path.join(app, 'node_modules');
  fs.mkdirSync(path.join(modules, 'kumiori'), { recursive: true });
  execFileSync('tar', ['-xzf', path.join(stage, info.filename), '-C', path.join(modules, 'kumiori'), '--strip-components=1']);
  for (const dep of [...Object.keys(pkg.dependencies), '@types/node']) {
    fs.mkdirSync(path.dirname(path.join(modules, dep)), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules', dep), path.join(modules, dep), 'junction');
  }
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'kumiori-consumer', private: true, type: 'module' }));
});

afterAll(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

/** Node の版が major.minor 以上か */
function nodeAtLeast(major: number, minor: number): boolean {
  const [M, m] = process.versions.node.split('.').map(Number) as [number, number];
  return M > major || (M === major && m >= minor);
}

describe('配布物を Node から読む', () => {
  const entries = ['kumiori', 'kumiori/node', 'kumiori/browser', 'kumiori/package.json'];

  it('tarball に、入口・型の宣言・ライセンスの表示が入り、ソースは入らない', () => {
    for (const f of ['package.json', 'README.md', 'README.en.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'dist-lib/index.js', 'dist-lib/node.js', 'dist-lib/types/index.d.ts', 'dist-lib/types/node.d.ts', 'dist-browser/kumiori.js']) {
      expect(packed).toContain(f);
    }
    for (const dir of ['dist-lib', 'dist-browser']) {
      for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) expect(packed).toContain(`${dir}/${f}`);
    }
    expect(packed.filter((f) => /^(src|test|scripts|public)\//.test(f))).toEqual([]);
    // 書体・画面用の画像 (public/ の中身) は、ビルドの出力に入らない
    expect(packed.filter((f) => /^dist-[^/]+\/.*\.(ttf|otf|ttc|woff2?|ico|png|svg)$/i.test(f))).toEqual([]);
  });

  it('import で kumiori・kumiori/node・kumiori/browser・kumiori/package.json が読める', () => {
    const code = `
      const lib = await import('kumiori');
      const node = await import('kumiori/node');
      const browser = await import('kumiori/browser');
      const meta = await import('kumiori/package.json', { with: { type: 'json' } });
      console.log(JSON.stringify([typeof lib.typeset, typeof node.createFontLoader, typeof browser.typeset, meta.default.version]));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: app, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual(['function', 'function', 'function', pkg.version]);
  });

  // require() で ES モジュールを読めるのは、Node 20.19.0 以降と 22.12.0 以降 (フラグ無し)。
  // Node の文書 Modules: CommonJS modules の「Loading ECMAScript modules using require()」の変更の履歴による
  const requireEsm = nodeAtLeast(22, 12) || (process.versions.node.startsWith('20.') && nodeAtLeast(20, 19));
  it.skipIf(!requireEsm)('require() で kumiori・kumiori/node・kumiori/browser・kumiori/package.json が読める', () => {
    // require() は、top-level await を含む ES モジュールを読めない (ERR_REQUIRE_ASYNC_MODULE)。配る入口に無いことも、ここで確かまる
    const code = `
      const lib = require('kumiori');
      const node = require('kumiori/node');
      const browser = require('kumiori/browser');
      const meta = require('kumiori/package.json');
      console.log(JSON.stringify([typeof lib.typeset, typeof node.createFontLoader, typeof browser.typeset, meta.version]));
    `;
    const r = spawnSync(process.execPath, ['--input-type=commonjs', '-e', code], { cwd: app, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual(['function', 'function', 'function', pkg.version]);
  });

  it('入口は条件つきの exports で、型 (types) が先、既定 (default) が最後にある', () => {
    // Node の文書 Modules: Packages の「Conditional exports」: 条件は書いた順に見る。"default" は常に当たるので最後に置く。
    // "import" だけでは require() に当たる条件が無く、ERR_PACKAGE_PATH_NOT_EXPORTED になる
    const exportsMap = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { exports: Record<string, Record<string, string> | string> }).exports;
    for (const entry of ['.', './node', './browser']) {
      const keys = Object.keys(exportsMap[entry] as Record<string, string>);
      expect(keys[0]).toBe('types');
      expect(keys[keys.length - 1]).toBe('default');
    }
    expect(entries.length).toBe(Object.keys(exportsMap).length);
  });
});

describe('配布物の型の宣言を利用者の TypeScript から使う', () => {
  /**
   * 利用者役のソース。型が any に落ちていれば、@ts-expect-error が「誤りが無い」(TS2578) で落ちる。
   * 型が解決できなければ TS2307・TS7016・TS2834 で落ちる
   */
  const source = `
import { typeset, serializeAreaTree, type TypesetResult, type AreaTree } from 'kumiori';
import { createFontLoader, type FontLoaderOptions } from 'kumiori/node';
import { typeset as typesetInBrowser } from 'kumiori/browser';

export async function main(): Promise<number> {
  const options: FontLoaderOptions = { cacheDir: null };
  const r: TypesetResult = await typeset('<p>a</p>', { loadFont: createFontLoader(options) });
  const count: number = r.pageCount;
  const tree: AreaTree = r.areaTree;
  const json: string = serializeAreaTree(tree);
  // @ts-expect-error pageCount は number
  const wrong: string = r.pageCount;
  // @ts-expect-error 文書は文字列かバイト列
  await typeset(123);
  // @ts-expect-error cacheDir は文字列か null
  createFontLoader({ cacheDir: 1 });
  // @ts-expect-error 無い名前は出していない
  const missing = (await import('kumiori')).noSuchExport;
  const viaBrowser: number = (await typesetInBrowser('<p>a</p>')).pageCount;
  // @ts-expect-error ブラウザ用の入口も同じ型
  const wrongBrowser: string = (await typesetInBrowser('<p>a</p>')).pageCount;
  return count + json.length + viaBrowser + String(wrong).length + String(missing).length + wrongBrowser.length;
}
`;
  /** CommonJS の利用者 (.cts): require() で読む。TypeScript が require(esm) を認めるのは module: NodeNext のとき */
  const sourceCjs = `
import kumiori = require('kumiori');
import node = require('kumiori/node');

export async function main(): Promise<number> {
  const r = await kumiori.typeset('<p>a</p>', { loadFont: node.createFontLoader() });
  const count: number = r.pageCount;
  // @ts-expect-error pageCount は number
  const wrong: string = r.pageCount;
  return count + String(wrong).length;
}
`;
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  const cases: { module: string; moduleResolution: string; cjs: boolean }[] = [
    { module: 'NodeNext', moduleResolution: 'NodeNext', cjs: true },
    { module: 'Node16', moduleResolution: 'Node16', cjs: false },
    { module: 'ESNext', moduleResolution: 'Bundler', cjs: false },
  ];
  for (const c of cases) {
    for (const skipLibCheck of [false, true]) {
      it(`moduleResolution: ${c.moduleResolution}・skipLibCheck: ${skipLibCheck} で、型が効く`, () => {
        const dir = path.join(app, `${c.moduleResolution}-${skipLibCheck}`.toLowerCase());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'main.ts'), source);
        if (c.cjs) fs.writeFileSync(path.join(dir, 'main.cts'), sourceCjs);
        fs.writeFileSync(
          path.join(dir, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: { target: 'ES2022', module: c.module, moduleResolution: c.moduleResolution, lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true, noEmit: true, skipLibCheck, types: ['node'] },
            include: ['*.ts', '*.cts'],
          }),
        );
        const r = spawnSync(process.execPath, [tsc, '-p', dir, '--pretty', 'false'], { cwd: dir, encoding: 'utf8' });
        expect(r.stdout + r.stderr).toBe('');
        expect(r.status).toBe(0);
      });
    }
  }

  it('型の宣言の相対の参照は、どれも拡張子 (.js) つき', () => {
    // TypeScript の手引き「Modules - Reference」の Node16・NodeNext の節: ES モジュールの相対の import は、拡張子を省けない (TS2834)。
    // skipLibCheck: true の利用者では誤りが出ないまま型が any になるので、宣言の側で確かめる
    const types = path.join(app, 'node_modules/kumiori/dist-lib/types');
    const bad: string[] = [];
    for (const name of fs.readdirSync(types, { recursive: true }) as string[]) {
      if (!name.endsWith('.d.ts')) continue;
      const text = fs.readFileSync(path.join(types, name), 'utf8');
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g)) {
        if (!/\.js$/.test(m[2]!)) bad.push(`${name}: ${m[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
