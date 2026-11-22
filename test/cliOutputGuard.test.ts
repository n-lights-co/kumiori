/**
 * コマンドの出力の上書きの検査 (src/cli.ts の checkOutputFiles) と、同じ入力のまとめ (planJobs) の単体の試験
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkOutputFiles, inputPaths, planJobs } from '../src/cli';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-guard-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('出力の上書きの検査', () => {
  it('入力の実体 (i ノード) は、確かめるたびに取り直す (名前の変更で保存した後、前の i ノードの出力を誤りにしない)', () => {
    const input = path.join(dir, 'w.html');
    fs.writeFileSync(input, '<p>1</p>');
    inputPaths.push(input);
    try {
      // 出力が、入力の (保存の前の) i ノードを持つ: ハードリンクで作る (名前の変更の保存の後、解放された番号を新しい出力が受け継いだのと同じ)
      const out = path.join(dir, 'w-2.svg');
      fs.linkSync(input, out);
      // 保存の前は、出力は入力の実体なので誤り
      expect(() => checkOutputFiles([out], input, new Set())).toThrow(/上書きしません|not overwritten/);
      // 新しいファイルに書いて名前を変える保存 (入力の i ノードが変わる)
      fs.writeFileSync(`${input}.tmp`, '<p>2</p>');
      fs.renameSync(`${input}.tmp`, input);
      // 前は、起動のときに覚えた入力の i ノードと比べていたので、ここでも誤りになった
      expect(() => checkOutputFiles([out], input, new Set())).not.toThrow();
    } finally {
      inputPaths.splice(inputPaths.indexOf(input), 1);
    }
  });
});

describe('同じ入力のまとめ', () => {
  it('まとめるのは、ディレクトリの実体と名前が同じときだけ (別のディレクトリのシンボリックリンク・ハードリンクの別名は別の入力)', () => {
    const d1 = path.join(dir, 'd1');
    const d2 = path.join(dir, 'd2');
    const d3 = path.join(dir, 'd3');
    for (const d of [d1, d2, d3]) fs.mkdirSync(d);
    const a = path.join(d1, 'a.html');
    fs.writeFileSync(a, '<p>a</p>');
    fs.symlinkSync(path.join('..', 'd1', 'a.html'), path.join(d2, 'a.html'));
    fs.linkSync(a, path.join(d3, 'a.html'));
    const notes: string[] = [];
    const jobs = planJobs({ inputs: [a, path.join(d2, 'a.html'), path.join(d3, 'a.html')], watch: false }, undefined, undefined, notes);
    // 前は、実体 (realpath・i ノード) が同じなので 1 つにまとめ、d2・d3 の隣には書かなかった
    expect(jobs.map((j) => j.output)).toEqual([path.join(d1, 'a.pdf'), path.join(d2, 'a.pdf'), path.join(d3, 'a.pdf')]);
    expect(notes).toEqual([]);
    // 同じディレクトリの同じ名前 (書き方の違い) は、まとめる
    const same = planJobs({ inputs: [a, path.join(d1, '.', 'a.html'), path.join(d2, '..', 'd1', 'a.html')], watch: false }, undefined, undefined, notes);
    expect(same.map((j) => j.output)).toEqual([path.join(d1, 'a.pdf')]);
    expect(notes.length).toBe(2);
  });
});
