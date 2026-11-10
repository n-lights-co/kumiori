/**
 * 組版エンジンの結果の誤りの確かめ (全体のレビューの LAY-02〜LAY-10)。LDocument を直接組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { doc, makeEngine, master, walk } from './helpers';
import type { Area, BlockArea, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

type Tree = ReturnType<typeof E.engine.layout>;
const kids = (t: Tree, sheet = 0) => t.sheets[sheet].page.regionBody.children as BlockArea[];
/** ページの本文領域の字 (脚注領域を含む) */
const text = (t: Tree, sheet: number) => {
  let s = '';
  walk(t.sheets[sheet].page.regionBody, (a) => {
    if (a.type === 'glyph') s += (a as GlyphArea).text;
  });
  return s;
};
const allText = (t: Tree) => t.sheets.map((_, k) => text(t, k)).join('');
const count = (s: string, ch: string) => s.split(ch).length - 1;

describe('コンテナの中の段組: 強制の段区切りと釣り合わせ (LAY-02)', () => {
  it('高さの指定が無い 2 段のコンテナで、強制の段区切りの後ろの長い中身が消えない', () => {
    const t = E.engine.layout(
      doc([{ type: 'block-container', columns: { count: 2, gap: 10 }, children: [{ type: 'block', children: ['あ'] }, { type: 'block', breakBefore: 'column', textAlign: 'start', children: ['い'.repeat(100)] }] }] as never),
    );
    expect(t.sheets).toHaveLength(1);
    expect(count(allText(t), 'い')).toBe(100);
    expect(t.warnings.filter((w) => w.includes('収まりません'))).toEqual([]);
  });
});

const fn = (body: string) => ({ type: 'footnote' as const, children: [body] });
const cell = (c: unknown[]) => ({ type: 'table-cell' as const, children: c });

describe('直交するブロック・回したコンテナ・inline-container の中の脚注 (LAY-04)', () => {
  /** 参照記号は仮の「*」でなく番号で、本体はページの脚注領域 (本文領域の最後の箱) に出る */
  const check = (t: Tree) => {
    expect(t.sheets).toHaveLength(1);
    const s = text(t, 0);
    expect(s).not.toContain('*');
    expect(count(s, '甲')).toBe(1);
    const area = kids(t, 0)[kids(t, 0).length - 1];
    let inArea = '';
    walk(area as Area, (a) => {
      if (a.type === 'glyph') inArea += (a as GlyphArea).text;
    });
    expect(inArea).toBe('1　甲乙丙');
    expect(area.y + area.height).toBeCloseTo(t.sheets[0].page.regionBody.height, 1);
  };
  it('横書きの本文の中の縦書きのブロック (ページに分けて組む経路)', () => {
    check(E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block', writingMode: 'vertical-rl', children: ['縦', fn('甲乙丙')] }] as never)));
  });
  it('90° 回したコンテナ (ページに分けて組む経路)', () => {
    check(E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block-container', rotation: 90, children: [{ type: 'block', children: ['回', fn('甲乙丙')] }] }] as never)));
  });
  it('inline-container の中', () => {
    check(E.engine.layout(doc([{ type: 'block', children: ['前', { type: 'inline-container', children: [{ type: 'block', children: ['箱', fn('甲乙丙')] }] }, '後'] }] as never)));
  });
  it('表のセルの中の inline-container の中 (行に持たせて、行を置くページに積む)', () => {
    const table = { type: 'table', columns: [{ type: 'table-column', width: '1*' }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell([{ type: 'block', children: ['前', { type: 'inline-container', children: [{ type: 'block', children: ['箱', fn('甲乙丙')] }] }] }])] }] } };
    check(E.engine.layout(doc([table] as never)));
  });
});

describe('段組ページ: 段の釣り合わせの試し組みと脚注 (LAY-03)', () => {
  const tableWithNote = { type: 'table', columns: [{ type: 'table-column', width: '1*' }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['表', fn('甲乙丙')])] }] } };
  const body = [tableWithNote, { type: 'block', children: ['段落'] }, { type: 'block', span: 'all', children: ['全幅'] }];
  it('span: all の前の段を釣り合わせても、表のセルの中の脚注の本体が出る', () => {
    const t = E.engine.layout(doc(body as never, 'horizontal-tb', { master: master({ columns: { count: 2, gap: 10 } }) }));
    expect(text(t, 0)).toContain('甲乙丙');
  });
  it('脚注を段ごとに置く (footnotePosition: column) ときも同じ', () => {
    const t = E.engine.layout(doc(body as never, 'horizontal-tb', { master: master({ columns: { count: 2, gap: 10, footnotePosition: 'column' } }) }));
    expect(text(t, 0)).toContain('甲乙丙');
  });
});
