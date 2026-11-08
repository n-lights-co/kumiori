/**
 * 組版中核のコードレビュー (2026-11-07) で見つけた欠陥の回帰テスト:
 *  - M-2: 回り込みのある段落でも行グリッドに揃える
 *  - M-4: 脚注本体を、参照する行のあるページの本文幅で組む
 *  - M-5: 縦中横の字は、幅を測った書体 (代替書体) で描く
 *  - M-6: collapse の表の外枠の半分の太さは、グリッドの端の列のセルから取る
 *  - M-7: 前方 float で本文を押し下げたら、傍注の位置の記録も下げる
 *  - M-8: keep-with-next の試し組みでも、脚注の参照記号は本番と同じラベルで組む
 *  - L-5: 中身のあるページで入らず改ページしても、新しいページに入らない箱は警告する
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FAMILY, doc, lines, makeEngine, master, mathFontBuffer, pt, walk } from './helpers';
import { collapsedOuterHalves } from '../src/tableBorders';
import type { Area, BlockArea, GlyphArea, LTable, LTableCell } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 面積木の字の基線の絶対位置 (祖先の y と字の baselineY を足す)。pick が false を返す部分木は見ない */
function baselines(root: Area, pick: (a: Area) => boolean = () => true): number[] {
  const out: number[] = [];
  const rec = (n: Area & { y?: number; baselineY?: number; padding?: { top: number }; border?: { top?: { width: number } }; children?: Area[]; glyphs?: Area[] }, oy: number) => {
    if (!pick(n)) return;
    const y = oy + (n.y ?? 0);
    if (n.type === 'glyph') {
      out.push(y + (n.baselineY ?? 0));
      return;
    }
    const inner = n.type === 'block' ? (n.padding?.top ?? 0) + (n.border?.top?.width ?? 0) : 0;
    for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])] as typeof n[]) rec(c, y + inner);
  };
  rec(root as never, 0);
  return out;
}

const glyphTexts = (a: Area) => {
  const g: string[] = [];
  walk(a, (n) => n.type === 'glyph' && g.push((n as GlyphArea).text));
  return g.join('');
};

describe('M-2: 回り込みのある段落の行グリッド', () => {
  it('float の横の行も、後ろの段落の行と同じ格子に揃う', () => {
    // 行グリッド (ピッチ 15pt) の箱の中: 先頭の段落は start の float (高さ 40pt) を回り込み、次の段落は回り込みが無い
    const fl = { type: 'float', float: 'start', width: 30, children: [{ type: 'block', height: 40, backgroundColor: '#ccc', children: [] }] };
    const t = E.engine.layout(
      doc([
        {
          type: 'block',
          baselineGrid: 'new',
          lineHeight: 1.5,
          children: [
            { type: 'block', children: [fl, 'あ'.repeat(60)] },
            { type: 'block', children: ['い'.repeat(40)] },
          ],
        },
      ] as never),
    );
    expect(t.warnings).toEqual([]);
    const rb = t.sheets[0].page.regionBody;
    // float の箱 (字が無い) は見なくてよい。字の基線をすべて集める
    const bs = baselines(rb);
    expect(bs.length).toBeGreaterThanOrEqual(5);
    const pitch = 15;
    const r0 = ((bs[0] % pitch) + pitch) % pitch;
    for (const b of bs) {
      const r = ((b % pitch) + pitch) % pitch;
      const d = Math.abs(r - r0);
      expect(Math.min(d, pitch - d)).toBeLessThan(0.05);
    }
    // 回り込みの段落の行が、確かに float の横 (x が float の幅ぶん右) に置かれている
    const xs: number[] = [];
    walk(rb, (a) => a.type === 'line' && xs.push(a.x));
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(30 - 0.01);
  });
});

describe('M-4: 脚注本体の幅', () => {
  const w = (lr: number) => master({ margins: { top: 10, right: lr, bottom: 10, left: lr } });
  const footArea = (sheet: { page: { regionBody: BlockArea } }) => {
    const rb = sheet.page.regionBody;
    const last = rb.children[rb.children.length - 1] as BlockArea;
    return last && last.children.some((c) => (c as BlockArea).backgroundColor) ? last : undefined;
  };

  it('幅の違うページマスター (first が広い) に続いた段落の脚注は、そのページの本文幅で組む', () => {
    // first: 本文 80mm、rest: 本文 40mm。脚注は 2 ページ目 (狭い方) に来る
    const t = E.engine.layout(
      doc(
        [
          { type: 'block', lineHeight: 1.7, children: [lines(20)] },
          { type: 'block', lineHeight: 1.7, children: ['注', { type: 'footnote', children: ['あ'.repeat(40)] }] },
        ] as never,
        'horizontal-tb',
        { master: w(30), masterAlternatives: [{ when: { pagePosition: 'first' }, master: w(10) }] },
      ),
    );
    expect(t.sheets.length).toBe(2);
    const narrow = pt(40);
    expect(t.sheets[1].page.regionBody.width).toBeCloseTo(narrow, 3);
    const fa = footArea(t.sheets[1] as never)!;
    expect(fa).toBeTruthy();
    expect(glyphTexts(fa)).toContain('あ'.repeat(10));
    // 本体の箱は脚注領域と同じ幅で、字は領域の右端を越えない (これまでは 1 ページ目の幅 80mm で組まれ、はみ出した)
    const body = fa.children.find((c) => !(c as BlockArea).backgroundColor) as BlockArea;
    expect(body.width).toBeCloseTo(narrow, 2);
    let right = 0;
    const rec = (n: Area & { x?: number; width?: number; advance?: number; children?: Area[]; glyphs?: Area[] }, ox: number) => {
      const x = ox + (n.x ?? 0);
      if (n.type === 'glyph') right = Math.max(right, x + (n.advance ?? n.width ?? 0));
      for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])] as typeof n[]) rec(c, x);
    };
    rec(fa as never, 0);
    expect(right).toBeLessThanOrEqual(narrow + 0.5);
    expect(right).toBeGreaterThan(narrow * 0.8);
  });
});

describe('M-5: 縦中横の字の書体', () => {
  it('先頭の字の書体に無い字は、幅を測った代替書体で描く', async () => {
    const E2 = await makeEngine();
    await E2.fonts.registerBuffer('STIX', 400, await mathFontBuffer(), false);
    // ∯ (U+222F) は Noto Serif JP に無く、STIX Two Math にある
    const m = E2.measurer.tateChuYoko('1∯', { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 });
    expect(m.chars.map((c) => c.font.family)).toEqual([FAMILY, 'STIX']);
    const t = E2.engine.layout(doc([{ type: 'block', children: ['縦', { type: 'tate-chu-yoko', text: '1∯' }, '書'] }] as never, 'vertical-rl'));
    const fams = new Map<string, string>();
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') fams.set((a as GlyphArea).text, (a as GlyphArea).fontFamily);
    });
    expect(fams.get('1')).toBe(FAMILY);
    expect(fams.get('∯')).toBe('STIX');
  });
});

describe('M-6: collapse の表の外枠の罫線の半分 (collapsedOuterHalves)', () => {
  const b = (width: number) => ({ width, color: '#000000' });
  const cell = (t: string, extra: Partial<LTableCell> = {}): LTableCell => ({ type: 'table-cell', border: b(1), children: [t], ...extra });
  const table = (rows: LTableCell[][]): LTable => ({
    type: 'table',
    borderCollapse: 'collapse',
    columns: [{ type: 'table-column' }, { type: 'table-column' }],
    body: { type: 'table-body', rows: rows.map((cells) => ({ type: 'table-row', cells })) },
  });

  it('上の行から rowSpan で伸びたセルが端の列を占める行では、行の最初のセルは外枠のセルではない', () => {
    // A (rowSpan 2) が列 0。2 行目の最初のセル C は列 1 で、その start 辺の太い罫線は表の中の線
    const t = table([
      [cell('A', { rowSpan: 2 }), cell('B')],
      [cell('C', { border: { top: b(1), right: b(1), bottom: b(1), left: b(4) } })],
    ]);
    const out = collapsedOuterHalves(t, 'horizontal-tb');
    expect(out.is).toBeCloseTo(0.5); // A の 1pt の半分 (これまでは C の 4pt の半分 = 2)
    expect(out.ie).toBeCloseTo(0.5);
  });

  it('セルの少ない行の最後のセルは、表の最後の列になければ外枠のセルではない', () => {
    const t = table([
      [cell('A'), cell('B')],
      [cell('C', { border: { top: b(1), right: b(4), bottom: b(1), left: b(1) } })],
    ]);
    const out = collapsedOuterHalves(t, 'horizontal-tb');
    expect(out.ie).toBeCloseTo(0.5); // B の 1pt の半分 (これまでは C の 4pt の半分 = 2)
    expect(out.is).toBeCloseTo(0.5);
  });
});

describe('M-7: 前方 float で押し下げた後の傍注', () => {
  it('前方 float が本文を押し下げた後の傍注は、押し下げた前の傍注の下に置く (重ならない)', () => {
    const note = (t: string) => ({ type: 'float', float: 'end', marginal: true, children: [{ type: 'block', margin: { left: -50, right: -50 }, textAlign: 'end', children: [t] }] });
    const before = { type: 'float', float: 'before', children: [{ type: 'block', height: 30, backgroundColor: '#eee', children: [] }] };
    // 3 行の傍注 → 本文 1 行 → 前方 float (本文と傍注を 30pt 押し下げる) → 2 つ目の傍注
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [note('注1\n注1\n注1'), 'あ'.repeat(10), before, note('注2'), 'い'.repeat(10)] }] as never));
    const body = t.sheets[0].page.regionBody.children as BlockArea[];
    const notes = body.filter((b) => b.type === 'block' && b.children.length && (b.children[0] as BlockArea).x < 0);
    expect(notes).toHaveLength(2);
    expect(glyphTexts(notes[0])).toContain('注1');
    expect(glyphTexts(notes[1])).toContain('注2');
    // 前方 float は本文領域の先頭
    const fl = body.find((b) => b.type === 'block' && b.children.some((c) => (c as BlockArea).backgroundColor === '#eee'))!;
    expect(fl.y).toBeCloseTo(0, 1);
    expect(notes[1].y).toBeGreaterThanOrEqual(notes[0].y + notes[0].height - 0.5);
  });
});

describe('M-8: keep-with-next の試し組みの脚注の参照記号', () => {
  it('参照記号のラベルが長くて行が増えるとき、試し組みも同じ行数で判定する (ブロックごと次ページへ送る)', () => {
    // 残りの高さ 45pt: 「*」なら 1 行 (17pt) + 次の 1 行 (17pt) で入るが、本番のラベル「[footnote number 1]」では 2 行になり入らない
    const bodyH = pt(80);
    const t = E.engine.layout(
      doc(
        [
          { type: 'block', lineHeightPt: bodyH - 45, children: ['filler'] },
          { type: 'block', keepWithNext: true, lineHeight: 1.7, widows: 1, orphans: 1, children: ['a'.repeat(30) + ' ', { type: 'footnote', children: ['x'] }] },
          { type: 'block', lineHeight: 1.7, children: ['next'] },
        ] as never,
        'horizontal-tb',
        { footnotes: { labelPrefix: '[footnote number ', labelSuffix: ']', referenceScale: 1 } },
      ),
    );
    expect(t.sheets.length).toBe(2);
    // 1 ページ目には filler だけ (これまでは「a…」の 1 行目が残り、keep-with-next のブロックが分かれた)
    expect(glyphTexts(t.sheets[0].page.regionBody)).toBe('filler');
    const p2 = glyphTexts(t.sheets[1].page.regionBody);
    expect(p2).toContain('a'.repeat(30));
    expect(p2).toContain('next');
    // 本番の参照記号は長いラベルで 2 行になっている
    let linesOnP2 = 0;
    walk(t.sheets[1].page.regionBody, (a) => a.type === 'line' && linesOnP2++);
    expect(linesOnP2).toBeGreaterThanOrEqual(3); // a… の 2 行 + next (+ 脚注本体)
  });
});

describe('L-5: ページより大きい箱の警告', () => {
  it('中身のあるページで入らず改ページしても、新しいページに入らなければ警告する', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['x'] }, { type: 'block-container', height: pt(80) + 50, children: [{ type: 'block', children: ['大きい箱'] }] }] as never));
    expect(t.warnings.some((w) => w.includes('ボックスがページより大きい'))).toBe(true);
    expect(t.sheets.length).toBe(2);
  });
});
