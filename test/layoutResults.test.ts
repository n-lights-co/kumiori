/**
 * 組版エンジンの結果の誤りの確かめ (全体のレビューの LAY-02〜LAY-10)。LDocument を直接組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { doc, lines, makeEngine, master, pt, walk } from './helpers';
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

describe('段組ページ: ページ単位の長い脚注を分けて次のページへ続ける (LAY-06)', () => {
  const m = master({ columns: { count: 2, gap: 10 } });
  /** ページの本文領域の中の、全段を貫く脚注領域 (本文領域の幅の箱) */
  const areas = (t: Tree, sheet: number) => kids(t, sheet).filter((b) => Math.abs(b.width - pt(80)) < 0.5);
  const check = (t: Tree) => {
    expect(count(allText(t), '注')).toBe(900);
    expect(count(text(t, 0), '注')).toBeGreaterThan(0); // 参照のあるページから始まる (XSL 1.1 §6.12.3)
    expect(text(t, 0)).toContain('本文');
    t.sheets.forEach((sh, k) => {
      const rb = sh.page.regionBody;
      for (const a of areas(t, k)) {
        expect(a.y).toBeGreaterThanOrEqual(-0.01); // 本文領域の上へはみ出さない
        expect(a.y + a.height).toBeLessThanOrEqual(rb.height + 0.01);
        // 段 (脚注領域でない箱) は、脚注領域の上で終わる
        for (const c of kids(t, k)) if (c !== a) expect(c.y + c.height).toBeLessThanOrEqual(a.y + 0.5);
      }
    });
    expect(t.warnings.filter((w) => w.includes('脚注'))).toEqual([]);
  };
  it('本文領域より長い脚注: 参照のあるページに入る分だけ置き、残りを次のページの脚注領域へ続ける', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['本文', fn('注'.repeat(900))] }] as never, 'horizontal-tb', { master: m }));
    expect(t.sheets.length).toBeGreaterThan(1);
    check(t);
  });
  it('参照が 2 段目にあるとき: 参照までの本文が段に収まる高さを残す', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', linefeedTreatment: 'preserve', children: [lines(17), '本文', fn('注'.repeat(900)), lines(40, '続')] }] as never, 'horizontal-tb', { master: m }));
    check(t);
    // 続きのページでは、脚注の続きが本文より先 (脚注領域の先頭) に来て、本文も進む
    expect(text(t, t.sheets.length - 1)).toContain('続40');
  });
  it('ページに収まる脚注は、これまでどおり分けない', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['本文', fn('注'.repeat(60))] }] as never, 'horizontal-tb', { master: m }));
    expect(t.sheets).toHaveLength(1);
    expect(count(text(t, 0), '注')).toBe(60);
    expect(areas(t, 0)).toHaveLength(1);
  });
});

describe('ページをまたぐ段組のコンテナの id と左右の罫線 (LAY-07)', () => {
  const side = { width: 2, color: '#f00', style: 'solid' as const };
  const container = { type: 'block-container', id: 'c1', border: { left: side, right: side }, padding: { left: 3, right: 5 }, columns: { count: 2, gap: 10 }, children: [{ type: 'block', textAlign: 'start', children: ['あ'.repeat(900)] }] };
  const t = () => E.engine.layout(doc([{ type: 'block', children: ['参照 ', { type: 'page-number-citation', refId: 'c1' }] }, container] as never));
  const rowsOf = (tr: Tree) => tr.sheets.map((_, k) => kids(tr, k).filter((b) => b.border?.left));
  it('コンテナの id を page-number-citation で参照できる', () => {
    const tr = t();
    expect(tr.sheets.length).toBeGreaterThan(1);
    expect(text(tr, 0)).toContain('参照 1');
    expect(tr.warnings.filter((w) => w.includes('c1'))).toEqual([]);
  });
  it('どのページの断片も左右の罫線を持ち、段は罫線と padding の内側に並ぶ', () => {
    const tr = t();
    const rows = rowsOf(tr);
    rows.forEach((r) => {
      expect(r).toHaveLength(1);
      expect(r[0].border.left).toMatchObject({ width: 2, color: '#f00' });
      expect(r[0].border.right).toMatchObject({ width: 2, color: '#f00' });
      expect(r[0].width).toBeCloseTo(pt(80), 1);
      const cols = (r[0].children as BlockArea[]).filter((c) => c.type === 'block');
      // 段の幅: (本文の幅 - 罫線 4 - padding 8 - 段間 10) / 2。段は、断片の内容の箱 (罫線と padding の内側) の端から端まで並ぶ
      const colW = (pt(80) - 4 - 8 - 10) / 2;
      expect(r[0].padding).toMatchObject({ left: 3, right: 5 });
      expect(cols[0].x).toBeCloseTo(0, 1);
      expect(cols[0].width).toBeCloseTo(colW, 1);
      expect(cols[1].x + cols[1].width).toBeCloseTo(pt(80) - 4 - 8, 1);
    });
    expect(rows.map((r) => r[0].isContinuation)).toEqual(rows.map((_, k) => k > 0));
    expect(count(allText(tr), 'あ')).toBe(900);
  });
});

describe('ページをまたぐ段組のコンテナの断片の飾り: 背景の画像・角丸・影 (LAY-14 (3))', () => {
  const deco = { backgroundImage: { src: 'bg.png', width: 10, height: 10 }, borderRadius: { rx: 6, ry: 6 }, boxShadow: { dx: 2, dy: 2, color: '#000' } };
  const make = (extra: object = {}) => {
    const container = { type: 'block-container', backgroundColor: '#eee', ...deco, ...extra, columns: { count: 2, gap: 10 }, children: [{ type: 'block', textAlign: 'start', children: ['あ'.repeat(1500)] }] };
    const tr = E.engine.layout(doc([container] as never));
    return tr.sheets.map((_, k) => kids(tr, k).filter((b) => b.backgroundColor === '#eee')[0]);
  };
  it('どのページの断片も、背景の色・罫線・padding と同じく、背景の画像と影を持つ (ページをまたぐブロックの断片と同じ)', () => {
    const rows = make();
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) {
      expect(r.backgroundImage).toMatchObject({ src: 'bg.png', width: 10, height: 10 });
      expect(r.boxShadow).toMatchObject({ dx: 2, dy: 2 });
      expect(r.borderRadius).toBeDefined();
    }
  });
  it('box-decoration-break: slice (既定) では、切れ目の側の角を丸めない (CSS Fragmentation 3 §5.4。分けずに描いてから切った形)。clone では断片ごとに丸める', () => {
    const rows = make();
    const zero = [0, 0];
    const six = [6, 6];
    // 角は 左上・右上・右下・左下 の順
    expect(rows[0].borderRadius!.corners).toEqual([six, six, zero, zero]);
    for (const r of rows.slice(1, -1)) expect(r.borderRadius!.corners).toEqual([zero, zero, zero, zero]);
    expect(rows[rows.length - 1].borderRadius!.corners).toEqual([zero, zero, six, six]);
    const cloned = make({ edgeRetain: { borderBefore: true, paddingBefore: true, borderAfter: true, paddingAfter: true } });
    for (const r of cloned) expect(r.borderRadius).toEqual({ rx: 6, ry: 6 });
  });
  it('ページをまたぐブロックの断片も同じ: slice では切れ目の側の角を丸めない', () => {
    const tr = E.engine.layout(doc([{ type: 'block', backgroundColor: '#eee', borderRadius: { rx: 6, ry: 6 }, textAlign: 'start', children: ['あ'.repeat(1500)] }] as never));
    const frags = tr.sheets.map((_, k) => kids(tr, k).filter((b) => b.backgroundColor === '#eee')[0]);
    expect(frags.length).toBeGreaterThan(1);
    expect(frags[0].borderRadius!.corners).toEqual([[6, 6], [6, 6], [0, 0], [0, 0]]);
    expect(frags[frags.length - 1].borderRadius!.corners).toEqual([[0, 0], [0, 0], [6, 6], [6, 6]]);
  });
});

describe('行内の箱の背景は、中の inline-block・画像の所も塗る (LAY-20 (3))', () => {
  it('背景の色の span の中の inline-block の所も、span の内容の領域の高さで塗る (CSS 2.1 §9.2.2・§14.2、CSS Backgrounds 3 §3.7)', () => {
    const box = { type: 'inline-container', width: 100, height: 10, children: [] };
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', fontSize: 20, children: [{ type: 'inline', backgroundColor: '#f00', children: ['AB', box, 'CD'] }] }] as never));
    const line = (kids(t)[0].children as Area[])[0] as unknown as { children: Area[] };
    // 行の直下の、背景を塗る箱 (block)。位置は行の始めからの x
    const bgs = line.children.filter((a) => a.type === 'block' && (a as BlockArea).backgroundColor === '#f00') as BlockArea[];
    let text = 0;
    walk(line as unknown as Area, (a) => {
      if (a.type === 'glyph') text += (a as GlyphArea).advance;
    });
    // 塗った範囲を合わせると、A の始めから D の終わりまで、すき間なく続く
    const spans = bgs.map((b) => [b.x, b.x + b.width]).sort((a, b) => a[0] - b[0]);
    expect(spans.length).toBeGreaterThan(1);
    for (let k = 1; k < spans.length; k++) expect(spans[k][0]).toBeLessThanOrEqual(spans[k - 1][1] + 0.01);
    const total = spans[spans.length - 1][1] - spans[0][0];
    expect(total).toBeCloseTo(text + 100, 1);
    // 高さは、字の領域と同じ (inline-block の高さではない)
    const hs = new Set(bgs.map((b) => b.height.toFixed(3)));
    expect(hs.size).toBe(1);
  });
});

describe('列定義の無い表の列数 (LAY-08)', () => {
  const cellsOf = (t: Tree) => {
    const out: BlockArea[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'table-cell') out.push(a as unknown as BlockArea);
    });
    return out;
  };
  const tableOf = (t: Tree) => kids(t, 0)[0] as unknown as { columnSizes: number[] };
  it('上の行から rowSpan で埋まる列も数える: 3 列目のセルの幅が 0 にならない', () => {
    const rows = [
      { type: 'table-row', cells: [{ ...cell(['A']), rowSpan: 2 }] },
      { type: 'table-row', cells: [cell(['B']), cell(['CCCCCC'])] },
    ];
    const t = E.engine.layout(doc([{ type: 'table', columns: [], body: { type: 'table-body', rows } }] as never));
    expect(tableOf(t).columnSizes).toHaveLength(3);
    const cs = cellsOf(t);
    expect(cs).toHaveLength(3);
    for (const c of cs) expect(c.width).toBeCloseTo(pt(80) / 3, 1);
  });
  it('表フッターだけ列の多い表: フッターの列も数える', () => {
    const t = E.engine.layout(
      doc([{ type: 'table', columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['A'])] }] }, footer: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['F']), cell(['G'])] }] } }] as never),
    );
    expect(tableOf(t).columnSizes).toHaveLength(2);
    for (const c of cellsOf(t)) expect(c.width).toBeGreaterThan(1);
  });
  it('列定義より多くの列を rowSpan で使う行があれば、足りない列を補う', () => {
    const rows = [
      { type: 'table-row', cells: [{ ...cell(['A']), rowSpan: 2 }, cell(['x'])] },
      { type: 'table-row', cells: [cell(['B']), cell(['C'])] },
    ];
    const t = E.engine.layout(doc([{ type: 'table', columns: [{ type: 'table-column', width: 50 }, { type: 'table-column', width: 50 }], body: { type: 'table-body', rows } }] as never));
    expect(tableOf(t).columnSizes).toHaveLength(3);
    for (const c of cellsOf(t)) expect(c.width).toBeGreaterThan(1);
  });
});

describe('masterSequence だけにある段組・傍注のマスター (LAY-09)', () => {
  const seqOf = (m: object) => ({ master: master(), masterSequence: [{ kind: 'repeatable', masters: [{ when: {}, master: m }] }] });
  it('段組のマスターが masterSequence だけにあっても、段に組む', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', linefeedTreatment: 'preserve', children: [lines(20)] }] as never, 'horizontal-tb', seqOf(master({ columns: { count: 2, gap: 10 } })) as never));
    expect(t.sheets).toHaveLength(1);
    const cols = kids(t, 0);
    expect(cols).toHaveLength(2);
    expect(cols[0].width).toBeCloseTo((pt(80) - pt(10)) / 2, 1);
    expect(cols[1].x).toBeCloseTo(cols[0].width + pt(10), 1);
  });
  it('傍注のマスターが masterSequence だけにあっても、脚注を傍注の領域に置く', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文', fn('甲乙丙')] }] as never, 'horizontal-tb', seqOf(master({ sideNotes: { end: { x: 60, width: 15 } } })) as never));
    // 傍注: 参照する行の上端から、領域の位置 (x) と幅で置く (ページの下端の脚注領域ではない)
    const note = kids(t, 0).find((b) => Math.abs(b.x - pt(60)) < 0.5)!;
    expect(note).toBeTruthy();
    expect(note.width).toBeCloseTo(pt(15), 1);
    expect(note.y).toBeCloseTo(0, 1);
  });
});

describe('先頭の余白を捨てる状態での clear と、float の下へ送る行 (LAY-10)', () => {
  const fl = { type: 'float', float: 'start', width: 60, children: [{ type: 'block', textAlign: 'start', linefeedTreatment: 'preserve', children: [lines(3, '浮')] }] };
  it('discardLeadingSpace のページの先頭: float だけのブロックの後ろの clear: both のブロックは、float の下に置く', () => {
    const body = [{ type: 'block', children: [fl] }, { type: 'block', clear: 'both', margin: { top: 5 }, children: ['後'] }];
    const run = (seq: object) => {
      const t = E.engine.layout(doc(body as never, 'horizontal-tb', seq as never));
      const all = kids(t, 0);
      const float = all.find((b) => Math.abs(b.width - 60) < 0.5)!;
      let after: BlockArea | undefined;
      for (const b of all) {
        let s = '';
        walk(b as Area, (a) => {
          if (a.type === 'glyph') s += (a as GlyphArea).text;
        });
        if (s === '後') after = b;
      }
      return { float, after: after! };
    };
    const base = run({});
    expect(base.after.y).toBeGreaterThanOrEqual(base.float.y + base.float.height - 0.01);
    const discard = run({ discardLeadingSpace: true });
    expect(discard.after.y).toBeGreaterThanOrEqual(discard.float.y + discard.float.height - 0.01);
    expect(discard.after.y).toBeCloseTo(base.after.y, 1);
  });
  it('clear: both の表は、float の下に置く (CSS 2.1 §9.5.2。OUT-22 (4))', () => {
    const table = { type: 'table', clear: 'both', columns: [{ type: 'table-column', width: 100 }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['表'])] }] } };
    const t = E.engine.layout(doc([{ type: 'block', children: [fl] }, table] as never));
    const all = kids(t, 0);
    const float = all.find((b) => Math.abs(b.width - 60) < 0.5)!;
    let tableY = -1;
    for (const b of all)
      walk(b as Area, (a) => {
        if (a.type === 'glyph' && (a as GlyphArea).text === '表' && tableY < 0) tableY = b.y;
      });
    expect(tableY).toBeGreaterThanOrEqual(float.y + float.height - 0.01);
  });
  it('discardLeadingSpace のページの先頭: float の横が狭すぎる行は、float の下へ送る', () => {
    // 本文の幅 226.77pt のうち 215pt を float が占める (残り 11.77pt は 2 字に足りない)
    const wide = { ...fl, width: 215 };
    const body = [{ type: 'block', textAlign: 'start', children: [wide, 'あいうえお'] }];
    const lineY = (seq: object) => {
      const t = E.engine.layout(doc(body as never, 'horizontal-tb', seq as never));
      // 本文領域の先頭からの位置 (箱の y は親の箱の中の位置なので、たどりながら足す。この文書に罫線・padding は無い)
      let y = -1;
      let floatBottom = -1;
      const visit = (a: Area, y0: number) => {
        const b = a as unknown as BlockArea;
        if (a.type === 'block' && Math.abs(b.width - 215) < 0.5 && floatBottom < 0) floatBottom = y0 + b.y + b.height;
        if (a.type === 'line') {
          let s = '';
          walk(a, (g) => {
            if (g.type === 'glyph') s += (g as GlyphArea).text;
          });
          if (s === 'あいうえお') y = y0 + b.y;
          return;
        }
        for (const c of (b.children ?? []) as Area[]) visit(c, y0 + b.y);
      };
      for (const c of kids(t, 0)) visit(c as Area, 0);
      return { y, floatBottom };
    };
    const base = lineY({});
    expect(base.y).toBeGreaterThanOrEqual(base.floatBottom - 0.01);
    const discard = lineY({ discardLeadingSpace: true });
    expect(discard.y).toBeGreaterThanOrEqual(discard.floatBottom - 0.01);
    expect(discard.y).toBeCloseTo(base.y, 1);
  });
});
