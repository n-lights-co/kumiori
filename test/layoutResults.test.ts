/**
 * 組版エンジンの結果の誤りの確かめ (全体のレビューの LAY-02〜LAY-10)。LDocument を直接組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { doc, lines, makeEngine, master, walk } from './helpers';
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

describe('親と直交する書字方向のブロック・表の break-before / break-after / keep-together (LAY-05)', () => {
  const pages = (t: Tree) => t.sheets.map((_, k) => text(t, k));
  it('縦書きのブロックの breakBefore / breakAfter: page (ページに分けて組む経路)', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block', writingMode: 'vertical-rl', breakBefore: 'page', breakAfter: 'page', children: ['縦'] }, { type: 'block', children: ['後'] }] as never));
    expect(pages(t)).toEqual(['前', '縦', '後']);
  });
  it('行の長さを指定した縦書きのブロック (1 つの箱で置く経路) も同じ', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block', writingMode: 'vertical-rl', height: 60, breakBefore: 'page', breakAfter: 'page', children: ['縦'] }, { type: 'block', children: ['後'] }] as never));
    expect(pages(t)).toEqual(['前', '縦', '後']);
  });
  it('縦書きの表の breakBefore / breakAfter: page', () => {
    const table = { type: 'table', writingMode: 'vertical-rl', breakBefore: 'page', breakAfter: 'page', columns: [{ type: 'table-column', width: 40 }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['縦'])] }] } };
    const t = E.engine.layout(doc([{ type: 'block', children: ['前'] }, table, { type: 'block', children: ['後'] }] as never));
    expect(pages(t)).toEqual(['前', '縦', '後']);
  });
  it('2 段のページでの breakBefore: column は、次の段へ送る', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block', writingMode: 'vertical-rl', breakBefore: 'column', children: ['縦'] }] as never, 'horizontal-tb', { master: master({ columns: { count: 2, gap: 10 } }) }));
    expect(t.sheets).toHaveLength(1);
    const cols = kids(t, 0);
    expect(cols).toHaveLength(2);
    expect(cols[1].x).toBeGreaterThan(cols[0].x + cols[0].width);
  });
  it('keepTogether: ページの残りで分かれ、次のページなら 1 つに収まる縦書きのブロックは、次のページへ送る', () => {
    // 20 字 (200pt) × 10 行の縦書きの段落。ページの残り (約 77pt) では行が短くなって本文の幅に収まらず、2 ページに分かれる
    const v = (extra: object) => ({ type: 'block', writingMode: 'vertical-rl', textAlign: 'start', children: [Array.from({ length: 10 }, () => '縦'.repeat(20)).join('\n')], linefeedTreatment: 'preserve', ...extra });
    const fill = { type: 'block', textAlign: 'start', linefeedTreatment: 'preserve', children: [lines(10)] };
    const free = E.engine.layout(doc([fill, v({})] as never));
    expect(free.sheets).toHaveLength(2);
    expect(count(text(free, 0), '縦')).toBeGreaterThan(0);
    const kept = E.engine.layout(doc([fill, v({ keepTogether: true })] as never));
    expect(kept.sheets).toHaveLength(2);
    expect(count(text(kept, 0), '縦')).toBe(0);
    expect(count(text(kept, 1), '縦')).toBe(200);
  });
});
