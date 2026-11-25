/**
 * 構成図 (docs/architecture.md・docs/en/architecture.md の「構成図」の SVG) が、作るスクリプト (scripts/architecture-diagrams.mjs) の出力と同じことと、
 * 図に書いた src の名前 (関数・クラス・ファイル) が src にあることを確かめる。src の名前を変えたら、図に古い名前が残らないように知らせる。
 * 落ちたら、スクリプトを直して node scripts/architecture-diagrams.mjs で作り直す。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

describe('構成図', () => {
  it('SVG がスクリプトの出力と同じで、図に書いた名前が src にある', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/architecture-diagrams.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
