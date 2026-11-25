/**
 * コマンドの draw.io の図の結合テスト: 本体のコマンド (dist-cli/cli.js) を作り、
 * kumiori doc.html --drawio-stencils … で draw.io の図を PDF に組む
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS } from 'kumiori';
import { ensureFonts, fontDir } from '../helpers';

const root = path.resolve(__dirname, '../..');
const shell = process.platform === 'win32';
let work = '';

beforeAll(async () => {
  execFileSync('npm', ['run', '--silent', 'build:cli'], { cwd: root, stdio: 'ignore', shell });
  await ensureFonts([...DEFAULT_FONTS.base]);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-drawio-cli-'));
}, 300_000);

const LIBRARY = '<shapes name="mxgraph.test"><shape name="Box" w="10" h="10" aspect="variable"><background><rect x="0" y="0" w="10" h="10"/></background><foreground><fillstroke/></foreground></shape></shapes>';

describe('コマンドの draw.io の図', () => {
  it('draw.io の図を描く。--drawio-stencils の図形ライブラリを使い、無い形は警告する。--no-drawio なら、図は画像として読まない', () => {
    const dir = fs.mkdtempSync(path.join(work, 'doc-'));
    fs.writeFileSync(
      path.join(dir, 'fig.drawio'),
      '<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="a" value="A" style="shape=mxgraph.test.box;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>' +
        '<mxCell id="b" value="B" style="shape=mxgraph.other.x;" vertex="1" parent="1"><mxGeometry x="100" width="80" height="40" as="geometry"/></mxCell>' +
        '</root></mxGraphModel></diagram></mxfile>',
    );
    fs.writeFileSync(path.join(dir, 'doc.html'), '<p><img src="fig.drawio"></p>');
    const lib = path.join(work, 'test.xml');
    fs.writeFileSync(lib, LIBRARY);
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), path.join(dir, 'doc.html'), '-o', path.join(dir, 'doc.pdf'), '--font-dir', fontDir, '--no-font-cache', ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, KUMIORI_LANG: 'ja' },
      });
    const r = cli('--drawio-stencils', lib);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('形 "mxgraph.other.x" は描画できない (図形ライブラリ other が無い。文字だけ描画する)');
    expect(r.stderr).not.toContain('mxgraph.test.box');
    expect(fs.statSync(path.join(dir, 'doc.pdf')).size).toBeGreaterThan(1000);
    // 図形ライブラリを渡さなければ、ライブラリの形も文字だけ描いて警告する
    const plain = cli();
    expect(plain.status).toBe(0);
    expect(plain.stderr).toContain('mxgraph.test.box');
    const none = cli('--no-drawio');
    expect(none.stderr).toContain('fig.drawio');
    expect(none.stderr).not.toContain('mxgraph.other.x');
    // 取り先の URL は http(s) だけ
    expect(cli('--drawio-stencils-url', 'file:///x').status).not.toBe(0);
  });
});
