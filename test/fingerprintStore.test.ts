/**
 * 領域の木の指紋の記録 (test/fingerprint.ts の fingerprintStore) の試験。
 * 書き直すとき (npm run fingerprints:update) に、組まなかった文書の指紋を消さず、もう組まない文書の指紋だけを消す
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AreaTree } from '../src/types';
import { areaFingerprint, fingerprintStore } from './fingerprint';

const tree = (n: number) => ({ sheets: [{ n }] }) as unknown as AreaTree;

function withDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-fp-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('指紋の記録 (fingerprintStore)', () => {
  it('書き直すとき、このたび組まなかった文書 (絞った・check の前で落ちた) の指紋は、ファイルにあるものを残す', () => {
    withDir((dir) => {
      fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ a: areaFingerprint(tree(1)), b: areaFingerprint(tree(2)), gone: areaFingerprint(tree(3)) }));
      const st = fingerprintStore('x', { dir, update: true });
      st.expect('a');
      st.expect('b');
      st.expect('c');
      // a だけを組み直す (b は組まなかった。c は新しい文書で、組む前に落ちた)
      expect(st.check('a', tree(10))).toBeUndefined();
      expect(st.finish()).toEqual(['c']);
      const out = read(st.file);
      expect(Object.keys(out)).toEqual(['a', 'b']);
      expect(out.a).toEqual(areaFingerprint(tree(10)));
      expect(out.b).toEqual(areaFingerprint(tree(2)));
    });
  });
  it('書き直すのは 1 度だけ (finish を何度呼んでもよい)', () => {
    withDir((dir) => {
      const st = fingerprintStore('x', { dir, update: true });
      st.check(st.expect('a'), tree(1));
      st.finish();
      fs.writeFileSync(st.file, '{}');
      st.finish();
      expect(read(st.file)).toEqual({});
    });
  });
  it('比べるとき、絞って組まなかった文書は「残っている指紋」に数えず、もう組まない文書だけを返す', () => {
    withDir((dir) => {
      fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ a: areaFingerprint(tree(1)), b: areaFingerprint(tree(2)), gone: areaFingerprint(tree(3)) }));
      const st = fingerprintStore('x', { dir, update: false });
      st.expect('a');
      st.expect('b');
      expect(st.check('a', tree(1))).toBeUndefined();
      expect(st.check('b', tree(5))).toMatch(/組版の結果が変わりました/);
      expect(st.finish()).toEqual(['gone']);
    });
  });
});
