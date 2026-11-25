/**
 * 意図した変化の一覧 (test/intended-changes.json) の部品 (scripts/intended-changes.mjs): 一覧の形の確かめ、組み比べの結果との照らし合わせ、
 * 組み比べの前とするコミット (一覧を空にした、いちばん新しいコミット) の探し方を確かめる。リポジトリの一覧そのものの形も確かめる
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkIntended, findBase, INTENDED_PATH, parseIntended } from '../scripts/intended-changes.mjs';

const root = path.resolve(import.meta.dirname, '..');

describe('意図した変化の一覧', () => {
  it('リポジトリの一覧が正しい形', () => {
    expect(() => parseIntended(fs.readFileSync(path.join(root, INTENDED_PATH), 'utf8'))).not.toThrow();
  });

  it('形の誤りを知らせる', () => {
    expect(() => parseIntended('{')).toThrow(/JSON/);
    expect(() => parseIntended('{}')).toThrow(/changes/);
    expect(() => parseIntended('{"changes":[{"docs":[{"doc":"a"}]}]}')).toThrow(/commit/);
    expect(() => parseIntended('{"changes":[{"commit":"x","docs":[]}]}')).toThrow(/docs/);
    expect(() => parseIntended('{"changes":[{"commit":"x","docs":[{"doc":"a","pages":["3"]}]}]}')).toThrow(/pages/);
    expect(parseIntended('{"changes":[{"commit":"x","docs":[{"doc":"a","pages":[3,"5-7"]}]}]}').changes).toHaveLength(1);
  });

  it('一覧に無い文書・ページの変化を取り出す', () => {
    const intended = parseIntended(
      JSON.stringify({
        changes: [
          { commit: '表の罫線を直す', docs: [{ doc: 'examples/a.html', pages: [2, '5-6'] }, { doc: 'ah/*' }] },
          { commit: '見出しを直す', docs: [{ doc: 'conformance/x.fo' }, { doc: 'samples/z.fo' }] },
        ],
      }),
    );
    const changed = (id: string, pages: number[], base = 10, head = 10) => ({ id, status: 'changed', pages: { base, head }, changedPages: pages.map((page) => ({ page })) });
    const r = checkIntended(intended, [
      changed('examples/a.html', [2, 5, 6]),
      changed('examples/b.html', [1]),
      changed('examples/a.html (2)', [1]),
      changed('ah/keep', [1, 2, 3], 3, 4),
      changed('conformance/x.fo', [7], 100, 101),
      { id: 'examples/c.html', status: 'same' },
      { id: 'examples/d.html', status: 'looks-same' },
      { id: 'examples/e.html', status: 'diagnostics' },
      { id: 'ah/err', status: 'error', error: { head: '時間切れ' } },
    ]);
    expect(r.unlisted.map((u) => u.id)).toEqual(['examples/b.html', 'examples/a.html (2)', 'examples/d.html', 'examples/e.html', 'ah/err']);
    // ページを書いた文書は、ほかのページの変化とページ数の変化で落とす
    expect(checkIntended(intended, [changed('examples/a.html', [2, 3])]).unlisted[0].why).toMatch(/3 ページ/);
    expect(checkIntended(intended, [changed('examples/a.html', [2], 10, 11)]).unlisted[0].why).toMatch(/ページ数/);
    // 一覧にあって変わらなかった文書は知らせる (組まなかった文書の項は知らせない)
    expect(r.unused).toEqual([]);
    expect(checkIntended(intended, [{ id: 'conformance/x.fo', status: 'same' }]).unused).toEqual([{ commit: '見出しを直す', doc: 'conformance/x.fo' }]);
  });

  it('組み比べの前は、一覧を空にした、いちばん新しいコミット', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-intended-'));
    try {
      const git = (...a: string[]) => {
        const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
        return r.stdout.trim();
      };
      const write = (changes: unknown[]) => {
        fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
        fs.writeFileSync(path.join(dir, INTENDED_PATH), JSON.stringify({ changes }));
      };
      const entry = { commit: 'x', docs: [{ doc: 'a' }] };
      git('init', '-q');
      write([]);
      git('add', '.');
      git('commit', '-qm', '1');
      const first = git('rev-parse', 'HEAD');
      write([entry]);
      git('commit', '-qam', '2');
      expect(findBase(dir)).toBe(first);
      write([]);
      git('commit', '-qam', '3');
      const third = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
      git('add', '.');
      git('commit', '-qm', '4');
      expect(findBase(dir)).toBe(third);
      // 作業の場所の一覧に書き足した (まだコミットしていない) ときも、コミットの履歴から探す。空なら HEAD
      expect(findBase(dir, 'HEAD', { worktree: true })).toBe(git('rev-parse', 'HEAD'));
      write([entry]);
      expect(findBase(dir, 'HEAD', { worktree: true })).toBe(third);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
