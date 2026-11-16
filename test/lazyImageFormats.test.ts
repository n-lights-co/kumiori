/**
 * CGM・EPS・WMF・EMF の処理の境目を見張る (IMG-31):
 * 入口 (ライブラリの index.ts・node.ts、コマンドの cli.ts、画面の main.ts) から静的に読むモジュールに、
 * CGM (cgm.ts)・EPS (eps.ts と PostScript の解釈系 ps*.ts)・WMF・EMF (metafile.ts と regionBool.ts) の処理が入らないこと。
 * これらは、文書にその画像が出てきたときだけ、assets.ts・imageInfo.ts の import() で読み込む (画面とブラウザ向けのライブラリでは別のチャンク)。
 * 静的な import を 1 つ足すだけで、どの文書でも最初から読む形に戻ってしまうので、ソースの import をたどって確かめる
 * (型だけの import と import() はたどらない)。
 * draw.io の図 (drawio/。IMG-34) も同じ: 入口が静的に読むのは、見分け (drawio/index.ts・sniff.ts) と、コマンドのファイルを読む道具 (nodeFiles.ts)
 * と警告の文 (messages.ts) だけで、図を描く処理 (drawio/load.ts から先) は、図が出てきたときに drawio/index.ts の import() で読む
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = path.resolve(__dirname, '..', 'src');
/** src/ からの相対の名前 (区切りは、どの OS でも「/」。Windows の path.relative は「\\」で区切る) */
const rel = (file: string) => path.relative(src, file).split(path.sep).join('/');

/** 値を読む静的な import・export … from の指定子 (import type・export type と import() は除く) */
const staticSpecifiers = (file: string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)].filter((m) => !m[2]).map((m) => m[3] ?? m[4]);
/** 動的な import() の指定子 */
const dynamicSpecifiers = (file: string) => [...fs.readFileSync(file, 'utf8').matchAll(/\bimport\('(\.[^']+)'\)/g)].map((m) => m[1]);

const resolve = (from: string, spec: string) => {
  const r = path.resolve(path.dirname(from), spec).replace(/\.js$/, '');
  return [`${r}.ts`, path.join(r, 'index.ts')].find((c) => fs.existsSync(c));
};

/** 入口から静的にたどれるモジュール (src/ からの相対の名前。どこから読んだかも返す) */
function staticGraph(entries: string[]): Map<string, string> {
  const from = new Map<string, string>();
  const todo = entries.map((f) => path.join(src, f));
  for (const f of todo) from.set(rel(f), '(入口)');
  while (todo.length) {
    const f = todo.pop()!;
    for (const spec of staticSpecifiers(f)) {
      if (!spec.startsWith('.')) continue;
      const hit = resolve(f, spec);
      if (!hit) continue;
      const name = rel(hit);
      if (from.has(name)) continue;
      from.set(name, rel(f));
      todo.push(hit);
    }
  }
  return from;
}

/** draw.io の図の処理のうち、入口から静的に読んでよいもの (drawio/ からの相対の名前) */
const DRAWIO_EAGER = new Set(['index.ts', 'sniff.ts', 'options.ts', 'messages.ts', 'nodeFiles.ts', 'notice.ts']);
const DRAWIO_LAZY = (function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
})(path.join(src, 'drawio'))
  .map(rel)
  .filter((f) => !DRAWIO_EAGER.has(f.slice('drawio/'.length)));

/** 使うときだけ読み込むモジュール */
const LAZY = [
  ...DRAWIO_LAZY,
  'cgm.ts',
  'eps.ts',
  'metafile.ts',
  'regionBool.ts',
  'psInterp.ts',
  'psGraphics.ts',
  'psShading.ts',
  'psColorSpace.ts',
  'psFonts.ts',
  'psResources.ts',
  'psOpsFont.ts',
  'psOpsImage.ts',
  'psOpsMatrix.ts',
  'psOpsPath.ts',
  'psOpsState.ts',
];

describe('CGM・EPS・WMF・EMF と draw.io の図の処理は、使うときだけ読み込む', () => {
  for (const [label, entries] of [
    ['ライブラリ (index.ts・node.ts)', ['index.ts', 'node.ts']],
    ['コマンド (cli.ts)', ['cli.ts']],
    ['画面 (main.ts)', ['main.ts']],
  ] as const) {
    it(`${label} から静的に読むモジュールに入らない`, () => {
      const graph = staticGraph([...entries]);
      expect(graph.size).toBeGreaterThan(20);
      // 入っていたら、どのモジュールから読んだかを出す (その import を import() にするか、軽い部分を別のファイルに分ける)
      expect(LAZY.filter((m) => graph.has(m)).map((m) => `${m} ← ${graph.get(m)}`)).toEqual([]);
      // 軽い部分 (形式の判定・大きさの見積もり・EPS の時間の予算) は、最初から読む
      for (const m of ['assets.ts', 'imageInfo.ts', 'epsInfo.ts']) expect(graph.has(m), m).toBe(true);
    });
  }

  it('画像を読み込む所 (assets.ts・imageInfo.ts) は、cgm.ts・eps.ts・metafile.ts を import() で読む', () => {
    const lazy = ['assets.ts', 'imageInfo.ts'].flatMap((f) => dynamicSpecifiers(path.join(src, f)).map((s) => (resolve(path.join(src, f), s) ?? s)).map(rel));
    for (const m of ['cgm.ts', 'eps.ts', 'metafile.ts']) expect(lazy).toContain(m);
  });

  it('draw.io の図の形式 (drawio/index.ts) は、図を描く処理 (drawio/load.ts) を import() で読む。本体と一緒に配る形式 (IMAGE_FORMATS) に載っている', () => {
    // 形式の load と、図形ライブラリの登録所を作る createDrawioStencilRegistry の 2 か所から、同じ load.ts を読む
    expect([...new Set(dynamicSpecifiers(path.join(src, 'drawio/index.ts')).map((s) => resolve(path.join(src, 'drawio/index.ts'), s) ?? s).map(rel))]).toEqual(['drawio/load.ts']);
    expect(DRAWIO_LAZY).toContain('drawio/drawio.ts');
    expect(DRAWIO_LAZY.length).toBeGreaterThan(20);
    expect(staticGraph(['imageFormats.ts']).has('drawio/index.ts')).toBe(true);
  });

  it('LAZY のモジュールは、どれも在る (名前を変えたら、この一覧も直す)', () => {
    for (const m of LAZY) expect(fs.existsSync(path.join(src, m)), m).toBe(true);
  });
});
