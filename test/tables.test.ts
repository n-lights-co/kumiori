import { beforeAll, describe, expect, it } from 'vitest';
import { collapseTableBorders, winningBorder } from '../src/tableBorders';
import { doc, makeEngine, pt, walk } from './helpers';
import type { Area, BorderStyle, LBlock, LTable, LTableCell } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const b = (width: number, color = '#000000', style?: 'double' | 'dotted') => ({ width, color, ...(style ? { style } : {}) });
const cell = (t: string, extra: Partial<LTableCell> = {}): LTableCell => ({ type: 'table-cell', border: b(1), children: [t], ...extra });
const table2x2 = (extra: Partial<LTable> = {}): LTable => ({
  type: 'table',
  borderCollapse: 'collapse',
  columns: [{ type: 'table-column' }, { type: 'table-column' }],
  body: {
    type: 'table-body',
    rows: [
      { type: 'table-row', cells: [cell('A'), cell('B')] },
      { type: 'table-row', cells: [cell('C'), cell('D')] },
    ],
  },
  ...extra,
});
const sidesOf = (c: LTableCell) => Object.keys(c.border as BorderStyle).sort().join(',');

describe('border-collapse (§7.28.3)', () => {
  it('勝ち負け: 太い方、同じ太さなら線種 (double > solid > dotted)', () => {
    expect(winningBorder(b(1), b(2))!.width).toBe(2);
    expect(winningBorder(b(1), b(1, '#f00', 'double'))!.style).toBe('double');
    expect(winningBorder(b(1, '#0f0', 'dotted'), b(1, '#00f'))!.color).toBe('#00f');
    expect(winningBorder(undefined, undefined)).toBeUndefined();
  });

  it('仕様: 内側の罫線は隣り合うセルが半分ずつ持ち、後ろ (右・下) のセルがグリッド線を中心に描く (§6.7.10)', () => {
    const t = collapseTableBorders(table2x2(), 'horizontal-tb');
    const [[A, B], [C, D]] = t.body.rows.map((r) => r.cells.map((c) => c.border as BorderStyle));
    // 外側 (表に外枠が無い): セルが全体の太さで持つ
    expect([A.left!.width, A.top!.width, D.right!.width, D.bottom!.width]).toEqual([1, 1, 1, 1]);
    // 内側: 前のセルは半分の場所だけ取り、描かない。後ろのセルは半分の場所を取り、全体の太さで描く
    expect(A.right).toMatchObject({ width: 0.5, collapse: { noPaint: true } });
    expect(B.left).toMatchObject({ width: 0.5, collapse: { paintWidth: 1 } });
    expect(A.bottom).toMatchObject({ width: 0.5, collapse: { noPaint: true } });
    expect(C.top).toMatchObject({ width: 0.5, collapse: { paintWidth: 1 } });
    expect([B.bottom?.collapse?.noPaint, C.right?.collapse?.noPaint, D.left?.collapse?.paintWidth, D.top?.collapse?.paintWidth]).toEqual([true, true, 1, 1]);
  });

  it('hidden はすべてに勝って線を消す。色だけ違えばセルが表に勝つ。行・列・フッターの罫線も重ねる', () => {
    const tb = table2x2({ border: b(1, '#000000') });
    tb.body.rows[0].cells[0].border = { top: b(1, '#ff0000'), left: b(1), bottom: b(1), right: { width: 0, color: '#000', style: 'hidden' } };
    const t = collapseTableBorders(tb, 'horizontal-tb');
    const [[A, B]] = t.body.rows.map((r) => r.cells.map((c) => c.border as BorderStyle));
    expect(A.right).toBeUndefined();
    expect(B.left).toBeUndefined();
    // 表の上の外枠: セルの赤が勝つ (同じ太さ・線種で色だけ違う → セル > 表)
    expect((t.border as BorderStyle).top!.color).toBe('#ff0000');
    // 行の罫線 (2pt) は、行の下の線分でセルの罫線 (1pt) に勝つ
    const tr = table2x2();
    tr.body.rows[0].border = { bottom: b(2) };
    const r = collapseTableBorders(tr, 'horizontal-tb');
    expect((r.body.rows[1].cells[0].border as BorderStyle).top).toMatchObject({ width: 1, collapse: { paintWidth: 2 } });
    // 列の罫線
    const tc = table2x2();
    tc.columns[0].border = { right: b(3) };
    const c = collapseTableBorders(tc, 'horizontal-tb');
    expect((c.body.rows[0].cells[1].border as BorderStyle).left).toMatchObject({ width: 1.5, collapse: { paintWidth: 3 } });
    // フッター: 本体の最後の行とフッターの境目も 1 本にまとまる
    const tf = table2x2({ footer: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell('F'), cell('G')] }] } });
    const f = collapseTableBorders(tf, 'horizontal-tb');
    expect((f.body.rows[1].cells[0].border as BorderStyle).bottom).toMatchObject({ width: 0.5, collapse: { noPaint: true } });
    expect((f.footer!.rows[0].cells[0].border as BorderStyle).top).toMatchObject({ width: 0.5, collapse: { paintWidth: 1 } });
  });

  it('アンテナハウス互換: 内側の罫線は 1 本 (右・下のセルの start/before 辺) に、外側の罫線は表の外枠にまとまる', () => {
    const t = collapseTableBorders(table2x2({ collapseToAfterCell: true }), 'horizontal-tb');
    const [[A, B], [C, D]] = t.body.rows.map((r) => r.cells);
    // 表に外枠が無いので、外側の罫線はセルに残る
    expect(sidesOf(A)).toBe('left,top');
    expect(sidesOf(B)).toBe('left,right,top');
    expect(sidesOf(C)).toBe('bottom,left,top');
    expect(sidesOf(D)).toBe('bottom,left,right,top');
    // 表に外枠があれば、外側は表の外枠にまとまる
    const t2 = collapseTableBorders(table2x2({ border: b(0.5), collapseToAfterCell: true }), 'horizontal-tb');
    const [[A2, B2], [C2, D2]] = t2.body.rows.map((r) => r.cells);
    expect([sidesOf(A2), sidesOf(B2), sidesOf(C2), sidesOf(D2)]).toEqual(['', 'left', 'top', 'left,top']);
    expect((t2.border as BorderStyle).top!.width).toBe(1); // セルの 1pt が表の 0.5pt に勝つ
  });

  it('太い方が勝つ: 左のセルの右辺 2pt と右のセルの左辺 1pt → 右のセルの左辺は 2pt', () => {
    const tb = table2x2({ collapseToAfterCell: true });
    tb.body.rows[0].cells[0].border = { ...b(1), right: b(2) } as never;
    tb.body.rows[0].cells[0].border = { top: b(1), left: b(1), bottom: b(1), right: b(2) };
    const t = collapseTableBorders(tb, 'horizontal-tb');
    expect((t.body.rows[0].cells[1].border as BorderStyle).left!.width).toBe(2);
  });

  it('separate の表は変えない', () => {
    const tb = table2x2({ borderCollapse: 'separate' });
    expect(collapseTableBorders(tb, 'horizontal-tb')).toBe(tb);
  });

  it('組版: collapse では内側の罫線が 1 本になる', () => {
    const count = (tb: LTable) => {
      let n = 0;
      const t = E.engine.layout(doc([tb] as never));
      walk(t.sheets[0].page.regionBody, (a) => {
        for (const s of ['top', 'right', 'bottom', 'left'] as const) if (a.border?.[s]) n++;
      });
      return n;
    };
    expect(count(table2x2({ borderCollapse: 'separate' }))).toBe(16);
    expect(count(table2x2({ collapseToAfterCell: true }))).toBe(12); // 内側の重なり 4 本ぶんが減る
    // 仕様どおり (半分ずつ): 辺の数は同じだが、描くのは 12 本
    const painted = (tb: LTable) => {
      let n = 0;
      const t = E.engine.layout(doc([tb] as never));
      walk(t.sheets[0].page.regionBody, (a) => {
        for (const s of ['top', 'right', 'bottom', 'left'] as const) if (a.border?.[s] && !a.border[s]!.collapse?.noPaint) n++;
      });
      return n;
    };
    expect(painted(table2x2())).toBe(12);
  });
});

describe('table-cell の display-align', () => {
  it('center / end: 行の高さの余りの分だけ、セルの内容が下がる', () => {
    const mk = (align?: 'center' | 'end') => {
      const tb: LTable = {
        type: 'table',
        columns: [{ type: 'table-column' }, { type: 'table-column' }],
        body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', children: ['あ\nい\nう\nえ'] }, { type: 'table-cell', ...(align ? { blockAlign: align } : {}), children: ['か'] }] }] },
      };
      const t = E.engine.layout(doc([tb]));
      let y = -1;
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'table-cell' && (a as unknown as { children: { y: number }[] }).children.length && y < 0 && a.x > 1) y = (a as unknown as { children: { y: number }[] }).children[0].y;
      });
      return y;
    };
    const top = mk();
    const center = mk('center');
    const end = mk('end');
    expect(center).toBeGreaterThan(top + 1);
    expect(end).toBeGreaterThan(center + 1);
    expect(end - top).toBeCloseTo(2 * (center - top), 0);
  });
});

describe('表のフッターの繰り返し・行の分割 (E-15)', () => {
  const row = (t: string, extra = {}) => ({ type: 'table-row', ...extra, cells: [{ type: 'table-cell', children: [t] }] });
  const rowsText = (t: ReturnType<typeof E.engine.layout>, k: number) => {
    const out: string[] = [];
    walk(t.sheets[k].page.regionBody, (a) => {
      if (a.type === 'table-row') {
        let s = '';
        walk(a, (g) => {
          if (g.type === 'glyph') s += g.text;
        });
        out.push(s);
      }
    });
    return out;
  };

  it('table-footer は各ページの末尾に繰り返す (omitFooterAtBreak なら表の末尾だけ)', () => {
    const mk = (extra = {}) => ({
      type: 'table',
      columns: [{ type: 'table-column' }],
      footer: { type: 'table-body', rows: [row('フッター')] },
      body: { type: 'table-body', rows: Array.from({ length: 20 }, (_, k) => row(`行${k + 1}`)) },
      ...extra,
    });
    const t = E.engine.layout(doc([mk()] as never));
    expect(t.sheets.length).toBe(2);
    expect(rowsText(t, 0).at(-1)).toBe('フッター');
    expect(rowsText(t, 1).at(-1)).toBe('フッター');
    const o = E.engine.layout(doc([mk({ omitFooterAtBreak: true })] as never));
    expect(rowsText(o, 0).at(-1)).not.toBe('フッター');
    expect(rowsText(o, o.sheets.length - 1).at(-1)).toBe('フッター');
  });

  it('ページに入らない行は、セルの中身を行単位で次ページへ分ける。keepTogether の行は分けずに送る', () => {
    const big = 'あ\n'.repeat(8).trim();
    const mk = (extra = {}) => ({
      type: 'table',
      columns: [{ type: 'table-column' }],
      body: { type: 'table-body', rows: [...Array.from({ length: 9 }, (_, k) => row(`行${k + 1}`)), row(big, extra)] },
    });
    const t = E.engine.layout(doc([mk()] as never));
    // 13 行入るページに 9 行 + 大きい行 (8 行) → 大きい行の前半 4 行がページ 1 に、残りが 2 ページ目に
    expect(rowsText(t, 0)).toHaveLength(10);
    expect(rowsText(t, 0).at(-1)).toBe('ああああ');
    expect(rowsText(t, 1)).toEqual(['ああああ']);
    const k = E.engine.layout(doc([mk({ keepTogether: true })] as never));
    expect(rowsText(k, 0)).toHaveLength(9);
    expect(rowsText(k, 1)).toEqual(['ああああああああ']);
  });
});

describe('collapse の表の外枠と寸法', () => {
  const tbl = (extra: Partial<LTable> = {}): LTable => ({
    type: 'table',
    borderCollapse: 'collapse',
    border: b(4),
    width: 200,
    columns: [{ type: 'table-column' }, { type: 'table-column' }],
    body: {
      type: 'table-body',
      rows: [
        { type: 'table-row', minHeight: 30, cells: [{ type: 'table-cell', children: ['A'] }, { type: 'table-cell', children: ['B'] }] },
        { type: 'table-row', minHeight: 30, cells: [{ type: 'table-cell', children: ['C'] }, { type: 'table-cell', children: ['D'] }] },
      ],
    },
    ...extra,
  });
  const tableArea = (tb: LTable) => {
    const t = E.engine.layout(doc([tb] as never));
    let found: { width: number; height: number; x: number } | undefined;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (!found && a.type === 'table') found = a as never;
    });
    return found!;
  };

  it('幅の指定は外枠の罫線の中心から中心まで (外の半分は表の外へ出る)', () => {
    const a = tableArea(tbl());
    // 外の端から外の端まで: 200 + 4/2 × 2
    expect(a.width).toBeCloseTo(204);
  });

  it('アンテナハウス互換: 外枠に接する行の高さは、罫線の中心から測る', () => {
    const a = tableArea(tbl({ collapseToAfterCell: true }));
    // 罫線の中心から中心まで 30 + 30 → 外の端から外の端まで 60 + 4
    expect(a.height).toBeCloseTo(64);
  });
});

describe('表の見出し (caption)', () => {
  it('表の上・下に、表の罫線の外側の幅で置く。表の左右の余白は見出しにも効く (CSS 2.1 §17.4)', () => {
    const tb = table2x2({ borderCollapse: 'separate', width: 100, margin: { left: 30, top: 10 }, id: 't' });
    tb.captions = [
      { side: 'top', block: { type: 'block', id: 'top', children: ['上'] } },
      { side: 'bottom', block: { type: 'block', id: 'bottom', children: ['下'] } },
    ];
    const t = E.engine.layout(doc([tb] as never));
    const by: Record<string, { x: number; y: number; width: number; height: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.sourceId) by[a.sourceId] = a;
    });
    const { top, bottom, t: table } = by;
    expect(top.x).toBeCloseTo(table.x);
    expect(top.width).toBeCloseTo(table.width);
    expect(bottom.width).toBeCloseTo(table.width);
    // 表の上の余白は見出しの上に (表と包む箱の余白)
    expect(top.y).toBeCloseTo(10);
    expect(table.y).toBeCloseTo(top.y + top.height);
    expect(bottom.y).toBeCloseTo(table.y + table.height);
  });
});

describe('break-before: avoid (keepWithPrevious) と中身の無い inline の id', () => {
  it('字の並びの直後の keepWithPrevious のブロックは、並びの最後の行と同じページに置く', () => {
    for (let n = 8; n <= 24; n++) {
      const filler: LBlock = { type: 'block', whiteSpace: 'pre', children: [Array.from({ length: n }, (_, i) => `行${i + 1}`).join('\n')] } as LBlock;
      const item: LBlock = { type: 'block', children: [{ type: 'inline', id: 't', children: ['項目'] }, { type: 'block', id: 'd', keepWithPrevious: true, children: ['説明'] }] } as LBlock;
      const t = E.engine.layout(doc([filler, item] as never));
      const sheetOf = (id: string) => t.sheets.findIndex((s) => {
        let hit = false;
        walk(s.page.regionBody, (a) => void (a.sourceId === id && (hit = true)));
        return hit;
      });
      expect(sheetOf('t')).toBe(sheetOf('d'));
    }
  });
  it('中身の無い inline (<a id="…"></a>) の id も、置いたページで記録する', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前', { type: 'inline', id: 'q', children: [] }, '後'] }] as never));
    let hit = false;
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId === 'q' && (hit = true)));
    expect(hit).toBe(true);
  });
});

describe('高さの指定のある箱の上の余白・セルの基線揃え', () => {
  it('高さの指定があっても、最初の子の上の余白は箱の上の余白と畳まれる (CSS 2.1 §8.3.1)', () => {
    const t = E.engine.layout(doc([{ type: 'block', id: 'box', height: 100, children: [{ type: 'block', id: 'h', margin: { top: 20 }, children: ['見出し'] }] }] as never));
    const by: Record<string, { y: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId && (by[a.sourceId] = a)));
    expect(by.box.y).toBeCloseTo(20);
    expect(by.h.y).toBeCloseTo(0);
  });
  it('blockAlign: baseline のセルは、同じ行の最初の行の基線をそろえる', () => {
    const tb: LTable = {
      type: 'table',
      columns: [{ type: 'table-column', width: 40 }, { type: 'table-column' }],
      body: {
        type: 'table-body',
        rows: [
          {
            type: 'table-row',
            cells: [
              { type: 'table-cell', id: 'm', blockAlign: 'baseline', children: ['1.'] },
              { type: 'table-cell', id: 'b', blockAlign: 'baseline', children: [{ type: 'block', fontSize: 20, children: ['大'] }] },
            ],
          },
        ],
      },
    } as LTable;
    const t = E.engine.layout(doc([tb] as never));
    // 字の基線の絶対位置 (親の原点 = 親の位置 + 罫線 + padding)
    const base: Record<string, number> = {};
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'glyph') base[(a as unknown as { text: string }).text] = y + (a as unknown as { baselineY: number }).baselineY;
      const kids = (a as unknown as { children?: Area[]; glyphs?: Area[] }).children ?? (a as unknown as { glyphs?: Area[] }).glyphs ?? [];
      for (const c of kids) visit(c, y + (a.border.top?.width ?? 0) + a.padding.top);
    };
    visit(t.sheets[0].page.regionBody, 0);
    expect(base['1']).toBeCloseTo(base['大'], 1);
  });
});

describe('セルの幅の指定・新しいブロック整形文脈', () => {
  it('幅の指定のあるセルは、その幅を列の幅にし、余りは指定の無い列に配る', () => {
    const tb: LTable = {
      type: 'table',
      width: 200,
      fillContent: true,
      columns: [],
      body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', id: 'a', width: 40, children: ['A'] }, { type: 'table-cell', id: 'b', children: ['B'] }] }] },
    } as LTable;
    const t = E.engine.layout(doc([tb] as never));
    const by: Record<string, { width: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId && (by[a.sourceId] = a)));
    expect(by.a.width).toBeCloseTo(40);
    expect(by.b.width).toBeCloseTo(160);
  });
  it('新しいブロック整形文脈: 子の上下の余白は箱の中に置き、箱の高さは中の float を含む', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', id: 'p', bfc: true, children: [{ type: 'block', margin: { top: 10, bottom: 10 }, children: ['子'] }] },
        { type: 'block', id: 'q', bfc: true, children: [{ type: 'float', float: 'start', width: 50, children: [{ type: 'block', height: 80, children: [] }] }, 'x'] },
      ] as never),
    );
    const by: Record<string, { y: number; height: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId && (by[a.sourceId] = a)));
    expect(by.p.y).toBeCloseTo(0);
    expect(by.p.height).toBeGreaterThan(20);
    expect(by.q.height).toBeGreaterThanOrEqual(80 - 0.01);
  });
});

describe('折り返さない行内要素', () => {
  it('nowrap の字があふれたら、その前の折り返してよい空白で改行する', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 60, children: ['あ ', { type: 'inline', noWrap: true, id: 'nw', children: ['いいいいいいいい'] }] }] as never));
    const ys = new Set<number>();
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'glyph' && (a as unknown as { text: string }).text === 'い') ys.add(Math.round(y));
      for (const c of ((a as unknown as { children?: Area[] }).children ?? [])) visit(c, y + (a.border.top?.width ?? 0) + a.padding.top);
    };
    visit(t.sheets[0].page.regionBody, 0);
    // 「い」はすべて同じ行 (2 行目) に並ぶ
    expect(ys.size).toBe(1);
  });
});

describe('CSS の float', () => {
  it('同じ側の float は横に並べ、包含ブロックの端を基準に置く。幅の指定が無ければ中身の幅', () => {
    const fl = (id: string) => ({ type: 'float', float: 'start', cssPlacement: true, children: [{ type: 'block', id, children: ['ああ'] }] });
    const t = E.engine.layout(doc([{ type: 'block', margin: { left: 30 }, children: [fl('f1'), fl('f2'), '本文'] }] as never));
    const xs: Record<string, { x: number; width: number }> = {};
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.sourceId) xs[a.sourceId] = { x, width: a.width };
      for (const c of ((a as unknown as { children?: Area[] }).children ?? [])) visit(c, x + (a.border.left?.width ?? 0) + a.padding.left);
    };
    const rb = t.sheets[0].page.regionBody;
    visit(rb, -rb.x);
    expect(xs.f1.x).toBeCloseTo(30, 0);
    expect(xs.f2.x).toBeCloseTo(30 + xs.f1.width, 0);
  });
});

describe('中身の無い目印の行', () => {
  it('<a id> だけの並びは行を作らず、id は記録する', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: [{ type: 'inline', id: 'm', children: [] }] }, { type: 'block', id: 'next', children: ['次'] }] as never));
    const by: Record<string, { y: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId && (by[a.sourceId] = a)));
    expect(by.next.y).toBeCloseTo(0);
  });
});

describe('負の余白', () => {
  it('畳んだ余白の合計が負なら、その分だけ上へ寄せる (CSS 2.1 §8.3.1)', () => {
    const t = E.engine.layout(doc([{ type: 'block', id: 'a', children: ['あ'] }, { type: 'block', id: 'b', margin: { top: -5 }, children: ['い'] }] as never));
    const by: Record<string, { y: number; height: number }> = {};
    walk(t.sheets[0].page.regionBody, (a) => void (a.sourceId && (by[a.sourceId] = a)));
    expect(by.b.y).toBeCloseTo(by.a.y + by.a.height - 5, 1);
  });
});

describe('ページをまたぐ箱の高さ', () => {
  it('height の残りが入らなければ、ページの終わりまで伸ばして次のページに続ける (Fragmentation 3 §5.3)', () => {
    // 本文領域の高さは 80mm (約 226.8pt)。200pt の空きの後に、高さ 100pt の箱
    const t = E.engine.layout(doc([{ type: 'block', height: 200, children: [] }, { type: 'block', id: 'box', height: 100, children: [] }, { type: 'block', id: 'after', children: ['後'] }] as never));
    expect(t.sheets.length).toBe(2);
    let y: number | undefined;
    walk(t.sheets[1].page.regionBody, (a) => void (a.sourceId === 'after' && (y = a.y)));
    // 1 ページ目で約 26.8pt を使ったので、残りは約 73.2pt
    expect(y).toBeCloseTo(100 - (pt(80) - 200), 0);
  });
});
