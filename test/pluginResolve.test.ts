import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPluginPath, pluginNotFoundMessage, resolvePlugin, resolvePluginUrl } from '../src/pluginResolve';
import { setMessageLang } from '../src/messages';

/** --plugin のパッケージの名前の解決 (import() と同じ条件。今のディレクトリを基準にする) */

let dir = '';
/** node_modules/<name> に package.json とファイルを置く */
const pkg = (name: string, pjson: object | undefined, files: Record<string, string>) => {
  const d = path.join(dir, 'node_modules', name);
  fs.mkdirSync(d, { recursive: true });
  if (pjson) fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pjson));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), body);
  }
};
const PLUGIN = (n: string) => `export default { apiVersion: 1, name: '${n}' };\n`;
/** 解決して import し、default の name を返す */
const load = async (spec: string, cwd = dir) => {
  const url = resolvePluginUrl(spec, cwd);
  if (!url) return undefined;
  return ((await import(url)) as { default: { name: string } }).default.name;
};

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-plugin-resolve-')));
  pkg('esm-import', { name: 'esm-import', type: 'module', exports: { '.': { import: './index.js' } } }, { 'index.js': PLUGIN('esm-import') });
  pkg('esm-default', { name: 'esm-default', type: 'module', exports: { '.': { default: './lib/main.js' } } }, { 'lib/main.js': PLUGIN('esm-default') });
  pkg('cjs-require', { name: 'cjs-require', main: './main.js' }, { 'main.js': "module.exports = { apiVersion: 1, name: 'cjs-require' };\n" });
  pkg('cjs-only-require', { name: 'cjs-only-require', exports: { require: './r.cjs' } }, { 'r.cjs': "module.exports = { apiVersion: 1, name: 'x' };\n" });
  pkg('cond-order', { name: 'cond-order', type: 'module', exports: { require: './r.cjs', import: './i.js', default: './d.js' } }, { 'r.cjs': '', 'i.js': PLUGIN('import'), 'd.js': PLUGIN('default') });
  pkg('@scope/name', { name: '@scope/name', type: 'module', exports: { '.': { import: './index.js' }, './plugin': { import: './p/plugin.js' }, './extra/*': './extra/*.js', './private/*': null } }, {
    'index.js': PLUGIN('scope'),
    'p/plugin.js': PLUGIN('scope-sub'),
    'extra/a.js': PLUGIN('scope-extra'),
    'private/x.js': PLUGIN('private'),
  });
  pkg('subpath', { name: 'subpath', type: 'module', exports: { '.': './index.js', './plugin': { node: { import: './plugin.mjs' } } } }, { 'index.js': PLUGIN('subpath'), 'plugin.mjs': PLUGIN('subpath-plugin') });
  pkg('no-pjson', undefined, { 'index.js': PLUGIN('no-pjson') });
  pkg('same-name', { name: 'same-name', type: 'module', exports: { import: './index.js' } }, { 'index.js': PLUGIN('same-name-pkg') });
  // 今のディレクトリに、パッケージと同じ名前のディレクトリ
  fs.mkdirSync(path.join(dir, 'same-name'));
  fs.writeFileSync(path.join(dir, 'same-name', 'index.js'), PLUGIN('same-name-dir'));
  fs.writeFileSync(path.join(dir, 'local.mjs'), PLUGIN('local'));
  fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
  // .js で終わるパッケージの指定: パッケージの中のファイル・exports の鍵・名前が .js で終わるパッケージ
  pkg('kp', { name: 'kp', type: 'module' }, { 'dist/plugin.js': PLUGIN('kp-dist') });
  pkg('kp2', { name: 'kp2', type: 'module', exports: { '.': './index.js', './extra.js': './e.js' } }, { 'index.js': PLUGIN('kp2'), 'e.js': PLUGIN('kp2-extra') });
  pkg('kplug.js', { name: 'kplug.js', type: 'module', main: 'main.js' }, { 'main.js': PLUGIN('kplug.js-pkg') });
  // 今のディレクトリに、パッケージと同じ名前のファイル (パッケージを先にする)
  fs.writeFileSync(path.join(dir, 'kplug.js'), PLUGIN('kplug.js-file'));
  fs.mkdirSync(path.join(dir, 'kp', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'kp', 'dist', 'plugin.js'), PLUGIN('kp-dist-file'));
  fs.mkdirSync(path.join(dir, 'kp2'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'kp2', 'local.js'), PLUGIN('kp2-local-file'));
  // パッケージの無い名前のファイル (今のディレクトリのファイルに落とす)
  fs.writeFileSync(path.join(dir, 'only-file.js'), PLUGIN('only-file'));
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'p.mjs'), PLUGIN('lib-p'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('--plugin の解決', () => {
  it('exports に import の条件しか無い ESM のパッケージ', async () => expect(await load('esm-import')).toBe('esm-import'));
  it('exports に default の条件だけのパッケージ', async () => expect(await load('esm-default')).toBe('esm-default'));
  it('exports の無い CommonJS のパッケージ (main)', async () => expect(await load('cjs-require')).toBe('cjs-require'));
  it('exports に require の条件しか無いパッケージは、import() と同じく見つからない', () => expect(resolvePluginUrl('cjs-only-require', dir)).toBeUndefined());
  it('条件は書いた順に、import() の条件の最初のもの', async () => expect(await load('cond-order')).toBe('import'));
  it('scope つきの名前・サブパス・型 (*)・null (出さない)', async () => {
    expect(await load('@scope/name')).toBe('scope');
    expect(await load('@scope/name/plugin')).toBe('scope-sub');
    expect(await load('@scope/name/extra/a')).toBe('scope-extra');
    expect(resolvePluginUrl('@scope/name/private/x', dir)).toBeUndefined();
    expect(resolvePluginUrl('@scope/name/p/plugin.js', dir)).toBeUndefined();
    expect(await load('subpath/plugin')).toBe('subpath-plugin');
  });
  it('package.json の無いパッケージは index.js', async () => expect(await load('no-pjson')).toBe('no-pjson'));
  it('今のディレクトリに同じ名前のディレクトリがあっても、パッケージとして解決する', async () => expect(await load('same-name')).toBe('same-name-pkg'));
  it('下のディレクトリからも、上の node_modules を探す', async () => expect(await load('esm-import', path.join(dir, 'sub', 'deeper'))).toBe('esm-import'));
  it('ファイルの道: ./・../・絶対の道・file: の URL。今のディレクトリを基準にする', async () => {
    expect(await load('./local.mjs')).toBe('local');
    expect(await load(pathToFileURL(path.join(dir, 'local.mjs')).href, os.tmpdir())).toBe('local');
    expect(await load('../../local.mjs', path.join(dir, 'sub', 'deeper'))).toBe('local');
    expect(await load(path.join(dir, 'local.mjs'), os.tmpdir())).toBe('local');
    expect(await load('./same-name/index.js')).toBe('same-name-dir');
    expect(fileURLToPath(resolvePluginUrl('./local.mjs', dir)!)).toBe(path.join(dir, 'local.mjs'));
  });
  it('見つからないもの', () => {
    expect(resolvePluginUrl('kumiori-no-such-plugin', dir)).toBeUndefined();
    expect(resolvePluginUrl('./nope.mjs', dir)).toBeUndefined();
    expect(resolvePluginUrl('@scope', dir)).toBeUndefined();
  });
  it('道かパッケージの名前かの見分け: 道の形だけを道とする (拡張子では決めない)', () => {
    for (const s of ['./a', '../a', '.', '..', '.\\a', '..\\a', '/a/b', 'C:\\a\\b.js', 'C:/a/b.js', '\\\\server\\share\\p.js', 'file:///a/b.js']) expect(isPluginPath(s), s).toBe(true);
    for (const s of ['foo', '@scope/name', 'name/plugin', '.hidden', 'a.js', 'dir/a.mjs', 'a.cjs', 'a.ts', 'kp/dist/plugin.js', 'chart.js']) expect(isPluginPath(s), s).toBe(false);
  });
  it('.js で終わるパッケージの指定 (パッケージの中のファイル・exports の鍵・名前が .js で終わるパッケージ) は、import() と同じくパッケージ', async () => {
    expect(await load('kp/dist/plugin.js')).toBe('kp-dist');
    expect(await load('kp2/extra.js')).toBe('kp2-extra');
    expect(await load('kplug.js')).toBe('kplug.js-pkg');
  });
  it('パッケージとして見つからなければ、今のディレクトリのファイルに落とす (同じ名前のパッケージがあれば、パッケージが先)', async () => {
    expect(await load('only-file.js')).toBe('only-file');
    expect(await load('local.mjs')).toBe('local');
    expect(await load('lib/p.mjs')).toBe('lib-p');
    expect(resolvePlugin('only-file.js', dir)).toMatchObject({ via: 'file' });
    expect(resolvePlugin('kplug.js', dir)).toMatchObject({ via: 'package' });
    expect(resolvePlugin('./kplug.js', dir)).toMatchObject({ via: 'path' });
    expect(await load('./kplug.js')).toBe('kplug.js-file');
    // パッケージがあっても、そのサブパスを出していなければ、今のディレクトリのファイルに落とす
    expect(await load('kp2/local.js')).toBe('kp2-local-file');
    expect(await load('kp2/dist/plugin.js')).toBeUndefined();
    // ディレクトリには落とさない
    expect(resolvePluginUrl('lib', dir)).toBeUndefined();
  });
  it('末尾が / の指定は、Node と同じく断る', () => {
    expect(resolvePluginUrl('kp2/', dir)).toBeUndefined();
    expect(resolvePluginUrl('@scope/name/', dir)).toBeUndefined();
    expect(resolvePluginUrl('esm-import/', dir)).toBeUndefined();
    setMessageLang('ja');
    expect(pluginNotFoundMessage('kp2/', resolvePlugin('kp2/', dir).tried)).toContain('パッケージの指定は / で終われない');
  });
  it('見つからないときの文: 何をどの順に探したか', () => {
    setMessageLang('ja');
    const r = resolvePlugin('nope/x.js', dir);
    expect(r.url).toBeUndefined();
    const m = pluginNotFoundMessage('nope/x.js', r.tried);
    expect(m).toContain('プラグインが見つかりません: nope/x.js');
    expect(m).toContain(`パッケージ nope を、${dir} から上の node_modules で探した`);
    expect(m).toContain(`今のディレクトリのファイル ${path.join(dir, 'nope', 'x.js')} も無い`);
    expect(m.indexOf('パッケージ nope')).toBeLessThan(m.indexOf('今のディレクトリのファイル'));
    // パッケージはあるが、サブパスを出していない
    const m2 = pluginNotFoundMessage('kp2/nope.js', resolvePlugin('kp2/nope.js', dir).tried);
    expect(m2).toContain(`パッケージ kp2 (${path.join(dir, 'node_modules', 'kp2')}) に ./nope.js が無いか、exports で出していない`);
    // 道の形
    const m3 = pluginNotFoundMessage('./nope.mjs', resolvePlugin('./nope.mjs', dir).tried);
    expect(m3).toContain(`ファイル ${path.join(dir, 'nope.mjs')} が無い`);
    expect(m3).not.toContain('パッケージ');
    setMessageLang('en');
    expect(pluginNotFoundMessage('nope/x.js', r.tried)).toContain(`searched for the package nope in node_modules from ${dir} upward`);
    setMessageLang('ja');
  });
});
