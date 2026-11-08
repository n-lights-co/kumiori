import { expect, it } from 'vitest';
import { makeEngine } from './helpers';
import { buildSampleDocument } from '../src/sampleData';

it('サンプル文書: 6 シート・警告なし (回帰)', async () => {
  const { engine } = await makeEngine();
  const t = engine.layout(buildSampleDocument());
  expect(t.sheets.length).toBe(6);
  expect(t.warnings).toEqual([]);
  // どのページにも、中身の無い断片 (罫線だけの表・ブロック) が残っていない
  for (const sh of t.sheets) for (const c of sh.page.regionBody.children as { children?: unknown[]; type: string }[]) expect(c.children?.length ?? 1).toBeGreaterThan(0);
  // 横書き章 (3〜5 ページ目): 先頭は天 44mm、以降は奇数/偶数でミラー余白
  const [p3, p4, p5] = t.sheets.slice(2).map((s) => s.page.regionBody);
  const mm = (v: number) => (v * 72) / 25.4;
  expect(p3.y).toBeCloseTo(mm(44));
  expect(p3.x).toBeCloseTo(mm(20));
  expect(p4.y).toBeCloseTo(mm(34));
  expect(p4.x).toBeCloseTo(mm(26)); // 偶数ページ: 左 26mm
  expect(p5.x).toBeCloseTo(mm(20)); // 奇数ページ: 左 20mm
});
