/**
 * 行分けの結果の覚え (layoutEngine.ts の lineMemos) の大きさの上限 (LayoutOptions.lineMemoAtoms。HTM-65)。
 * 覚えは、同じ段落を同じ幅で組み直すとき (段の高さ揃え・keep-with-next の試し組み・表のセルの計測) に使い回すだけで、結果は変えない。
 * 上限が無いと、文書の全部の段落の字ごとの atom・行を、組み終えるまで持ち続けた (組み終えた時点の、GC の後に残る量で、ふつうの文章 1MB で約 170MB、表 1MB で約 870MB)。
 * 時間ではなく、(1) 上限の大きさで結果 (Area Tree) が変わらないこと、(2) 覚えの大きさが上限で抑えられること、(3) 覚えが使われていることを確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { FAMILY, makeEngine } from './helpers';
import { LayoutEngine } from '../src/layoutEngine';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { serializeAreaTree } from '../src/areaTree';
import type { LDocument } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 段組 (高さ揃え)・keep-with-next の見出し・表を含む文書 (呼ぶたびに作る: 覚えは文書の節ごとなので、組み比べる文書を分ける) */
const doc = (): LDocument => {
  const p = (k: number) => `<p>${'段落の字。'.repeat(8 + (k % 5))}${k}</p>`;
  let body = '';
  for (let s = 0; s < 6; s++) {
    body += `<h2 style="break-after: avoid">見出し ${s}</h2><div style="column-count: 2">${Array.from({ length: 8 }, (_, k) => p(s * 8 + k)).join('')}</div>`;
    body += `<table><tbody>${Array.from({ length: 6 }, (_, r) => `<tr>${Array.from({ length: 4 }, (_, c) => `<td>セル ${r}-${c} ${'字'.repeat((r + c) % 4)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const d = parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;
  const css = '@page { size: A5; margin: 10mm } body { margin: 0 }';
  return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css }).document;
};
const run = (limit?: number) => {
  const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, ...(limit !== undefined ? { lineMemoAtoms: limit } : {}) });
  const tree = engine.layout(doc());
  return { tree: serializeAreaTree(tree), stats: { ...engine.stats } };
};

describe('行分けの結果の覚えの上限', () => {
  it('上限の大きさ (既定・小さい上限・覚えない) で、組んだ結果が同じ', () => {
    const base = run();
    expect(base.stats.lineMemoHits).toBeGreaterThan(0);
    for (const limit of [0, 300, 2000]) expect(run(limit).tree).toBe(base.tree);
  });
  it('覚えの大きさは上限で抑えられる (1 つの項目より小さい上限でも、いちばん新しい 1 つは持つ)。0 なら覚えない', () => {
    const small = run(2000);
    expect(small.stats.lineMemoPeak).toBeGreaterThan(0);
    expect(small.stats.lineMemoPeak).toBeLessThanOrEqual(2000);
    // 小さい上限でも、段の高さ揃え・試し組みの続けての組み直しには効く
    expect(small.stats.lineMemoHits).toBeGreaterThan(0);
    const none = run(0);
    expect(none.stats.lineMemoPeak).toBe(0);
    expect(none.stats.lineMemoHits).toBe(0);
    // 上限が無ければ、覚えはもっと大きくなる (上限が効いている)。使い回しは近くの段落の組み直しなので、使い回した回数は変わらない
    const unlimited = run(1e9);
    expect(unlimited.stats.lineMemoPeak).toBeGreaterThan(5 * 2000);
    expect(small.stats.lineMemoHits).toBe(unlimited.stats.lineMemoHits);
  });
});
