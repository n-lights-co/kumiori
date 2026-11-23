/**
 * 種を決めた乱数の文書 (scripts/gen-stress-docs.mjs) を組み、組版の結果の指標と手間の伸び方を確かめる。
 * 段組の脚注の文書の試験は test/columnFootnoteReserve.test.ts。ここは、ほかの形 (深い入れ子・大きな表・多くの CSS の規則・長い段落・多くの画像、
 * XSL-FO の入れ子・表)。
 *
 * 指標 (形ごと。小さな大きさで組む):
 *  - ページ数: いまの値の ±10% の内 (ページ数が大きく変わる直しは、ここで気づく。正しい変わり方なら、値を直す。
 *    ページの中身の細かな変わりは、領域の木の指紋 (test/fingerprints) が捕まえる)
 *  - 数行だけのページ: 最後を除くページのうち、本文の行が 3 行以下のページの数。いまの値を上限にする (増えたら戻り)
 *  - 警告: 無いこと
 *  - 手間の伸び方: 主な形 (規則・表・段落) で、大きさを 4 倍にしたときの CPU の時間の比が 8 以下 (2 乗の手間が入ると 16 になる。test/timing.ts)
 * 大きな版 (書き出す大きさ) は、npm run compare:base の generated の群で、前と後のコミットで組み比べる (組版の秒が 1.5 倍を超えたら、その報告に出る)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf, DEFAULT_FONTS, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { expectGrowth } from './timing';
import { SHAPES, type Shape } from '../scripts/gen-stress-docs.mjs';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
  await typeset('<p>温め warm</p>', { kind: 'html', loadFont: loadCachedFont });
}, 300_000);

const run = (shape: Shape, n: number) => typeset(SHAPES[shape].make(n), { kind: SHAPES[shape].ext, loadFont: loadCachedFont });

/** ページごとの、本文領域 (region-body) の中の行の数 */
function bodyLines(sheets: AreaNode[]): number[] {
  return sheets.map((s) => {
    let n = 0;
    const rec = (a: AreaNode, inBody: boolean) => {
      const body = inBody || a.type === 'region-body';
      if (a.type === 'line') {
        if (body) n++;
        return;
      }
      for (const c of childrenOf(a)) rec(c, body);
    };
    rec(s, false);
    return n;
  });
}

/**
 * 形ごとの、組む大きさと、いまの main で組んだ指標 (ページ数・数行だけのページの数)。
 * 入れ子のリスト (ul > li > ul > li・入れ子の fo:list-block) の中のブロックを、ページの終わりで 1 つずつ別のページに置く誤りを直して、
 * 入れ子の文書 (nest・fonest) の数行だけのページは 0 にした (試験は test/nestedListPageBreak.test.ts)
 */
const EXPECT: Record<Shape, { n: number; pages: number; thin: number }> = {
  nest: { n: 300, pages: 16, thin: 0 },
  table: { n: 150, pages: 25, thin: 0 },
  rules: { n: 200, pages: 8, thin: 0 },
  para: { n: 10, pages: 8, thin: 0 },
  images: { n: 150, pages: 13, thin: 0 },
  fonest: { n: 300, pages: 16, thin: 0 },
  fotable: { n: 150, pages: 13, thin: 0 },
};

describe('乱数の文書の指標', () => {
  it.each(Object.keys(EXPECT) as Shape[])('%s', async (shape) => {
    const e = EXPECT[shape];
    const r = await run(shape, e.n);
    const lines = bodyLines(r.areaTree.sheets);
    const thin = lines.slice(0, -1).filter((n) => n <= 3).length;
    expect(r.warnings).toEqual([]);
    expect(r.pageCount, 'ページ数').toBeGreaterThanOrEqual(Math.floor(e.pages * 0.9));
    expect(r.pageCount, 'ページ数').toBeLessThanOrEqual(Math.ceil(e.pages * 1.1));
    expect(thin, `数行だけのページ (ページごとの行: ${lines.join(' ')})`).toBeLessThanOrEqual(e.thin);
  }, 120_000);
});

describe('乱数の文書の手間の伸び方 (大きさを 4 倍にして、CPU の時間の比が 8 以下)', () => {
  it.each(['rules', 'table', 'para'] as Shape[])('%s', async (shape) => {
    await expectGrowth(8, (n) => run(shape, n), EXPECT[shape].n, { label: shape });
  }, 300_000);
});
