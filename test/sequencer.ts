/**
 * npm test (vitest) の試験のファイルを走らせる順。時間のかかるファイルから先に走らせ、終わりに 1 つのファイルだけが長く走る (ほかのワーカーが空く) のを防ぐ。
 *
 * vitest の既定の順 (BaseSequencer) は、前の走りの結果 (node_modules/.vite の中の覚え。落ちたもの・時間) があればそれで並べ、
 * 無ければファイルの大きさの大きい順に並べる。覚えの無い走り (npm ci の直後・npm run ci:local の --worktree の取り出した場所) では、
 * 小さなファイルの重い試験 (対応仕様説明書を組む test/conformance.test.ts など) が後に回り、終わりの数分をそのファイルだけが走ることがある。
 * ここでは、覚えの無いファイルの時間を、test/durations.json (主なファイルの、測った秒) から見積もって並べる。
 * 覚えのあるファイルは、覚えの時間で並べる (既定と同じ。落ちたものを先にするのも同じ)。どちらも無いファイルは、大きさで並べた既定の順で、その後ろに置く。
 * test/durations.json は、順を決めるためだけのもので、古くなっても試験の結果は変わらない (書き直し方は docs/development.md の「確かめの時間」)
 */
import fs from 'node:fs';
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const durations: Record<string, number> = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'durations.json'), 'utf8')).seconds;

export default class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const base = await super.sort(files);
    const order = new Map(base.map((f, i) => [f, i]));
    const cache = this.ctx.cache;
    /** [落ちたか, 見積もりの秒 (無ければ undefined)] */
    const key = (f: TestSpecification): [boolean, number | undefined] => {
      const r = cache.getTestSpecificationResult(f);
      if (r) return [r.failed, r.duration / 1000];
      const rel = path.relative(path.join(f.project.config.root, 'test'), f.moduleId).split(path.sep).join('/');
      return [false, durations[rel]];
    };
    const keys = new Map(base.map((f) => [f, key(f)]));
    return [...base].sort((a, b) => {
      const [fa, da] = keys.get(a)!;
      const [fb, db] = keys.get(b)!;
      if (fa !== fb) return fa ? -1 : 1;
      if (da !== undefined && db !== undefined && da !== db) return db - da;
      if ((da === undefined) !== (db === undefined)) return da === undefined ? 1 : -1;
      return order.get(a)! - order.get(b)!;
    });
  }
}
