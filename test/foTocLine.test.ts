/**
 * 目次の行: last-line-end-indent (XSL 1.1 §7.16.3) と leader-alignment (§7.22.1)。
 * 折り返す目次の行で、ページ番号だけを右端に出す書き方 (text-align-last="justify" + end-indent + 負の last-line-end-indent)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine, pt } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
// ページ 100mm 角、余白 20mm → 本文は x = 20mm から 80mm (幅 60mm ≒ 170.08pt。10pt の字で 17 字)
const page = (body: string, o: { seq?: string; region?: string } = {}) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="20mm"><fo:region-body ${o.region ?? ''}/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m" ${o.seq ?? ''}><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="14pt" text-align="start">${body}</fo:flow></fo:page-sequence></fo:root>`;

interface G { ch: string; x: number; y: number; w: number }
interface Line { y: number; glyphs: G[] }
/** 行ごとの字 (ページの左上からの位置。pt) */
const linesOf = (fo: string) => {
  const im = importXslFo(fo, parse, { compat: 'spec' });
  const t = E.engine.layout(im.document);
  const out: Line[] = [];
  const rec = (a: Area, x: number, y: number, line?: Line) => {
    let cur = line;
    if (a.type === 'line') {
      cur = { y: y + a.y, glyphs: [] };
      out.push(cur);
    }
    if (a.type === 'glyph' && cur) cur.glyphs.push({ ch: (a as GlyphArea).text, x: x + a.x, y: y + a.y, w: (a as GlyphArea).advance });
    // 子の位置は、内容の箱 (余白・罫線の内側) から
    const bw = (k: 'left' | 'top') => (a.border as Record<string, { width: number } | undefined> | undefined)?.[k]?.width ?? 0;
    for (const c of childrenOf(a as never)) rec(c, x + a.x + (a.padding?.left ?? 0) + bw('left'), y + a.y + (a.padding?.top ?? 0) + bw('top'), cur);
  };
  rec(t.sheets[0] as unknown as Area, 0, 0);
  for (const l of out) l.glyphs.sort((p, q) => p.x - q.x || p.y - q.y);
  return { lines: out, im };
};
const L = pt(20);
const R = pt(80);
const right = (l: Line) => Math.max(...l.glyphs.map((g) => g.x + g.w));
const text = (l: Line) => l.glyphs.map((g) => g.ch).join('');

describe('last-line-end-indent', () => {
  it('目次の行: 折り返した行は end-indent の手前で終わり、最後の行だけ右端まで伸びてページ番号が右端に来る', () => {
    const title = '見'.repeat(20);
    const { lines } = linesOf(page(`<fo:block text-align-last="justify" end-indent="30pt" last-line-end-indent="-30pt">${title}<fo:leader leader-pattern="dots"/>99</fo:block>`));
    expect(lines.length).toBe(2);
    // 1 行め: 幅 170 − 30 = 140pt に 14 字
    expect(text(lines[0])).toBe('見'.repeat(14));
    expect(right(lines[0])).toBeLessThanOrEqual(R - 30 + 0.01);
    // 最後の行: 残りの 6 字 + リーダー + 99。99 の右端が本文の右端
    expect(text(lines[1]).startsWith('見'.repeat(6))).toBe(true);
    expect(text(lines[1]).endsWith('99')).toBe(true);
    expect(right(lines[1])).toBeCloseTo(R, 1);
  });

  it('指定が無ければ、最後の行も end-indent の手前で終わる (いままでどおり)', () => {
    const { lines } = linesOf(page(`<fo:block text-align-last="justify" end-indent="30pt">${'見'.repeat(20)}<fo:leader leader-pattern="dots"/>99</fo:block>`));
    expect(right(lines[lines.length - 1])).toBeCloseTo(R - 30, 1);
  });

  it('負の値: 普通の幅には入らないが、伸ばした最後の行に入る中身は、最後の行に置く', () => {
    // 幅 140pt に 14 字。16 字は入らないが、最後の行 (170pt) には入る
    const { lines } = linesOf(page(`<fo:block end-indent="30pt" last-line-end-indent="-30pt">${'字'.repeat(16)}</fo:block>`));
    expect(lines.length).toBe(1);
    expect(right(lines[0])).toBeCloseTo(L + 160, 1);
  });

  it('正の値: 最後の行を短くする。短くした幅に入らなければ、手前で折り返す', () => {
    // 幅 170pt に 17 字。最後の行は 120pt (12 字) まで
    const a = linesOf(page(`<fo:block last-line-end-indent="50pt">${'字'.repeat(17 + 12)}</fo:block>`)).lines;
    expect(a.map((l) => l.glyphs.length)).toEqual([17, 12]);
    // 15 字: 1 行 (170pt) には入るが、最後の行としては 12 字まで → 12 字で折り返し、残り 3 字が最後の行
    const b = linesOf(page(`<fo:block last-line-end-indent="50pt">${'字'.repeat(15)}</fo:block>`)).lines;
    expect(b.map((l) => l.glyphs.length)).toEqual([12, 3]);
    // text-align-last="end" は、短くした端に寄せる
    const c = linesOf(page(`<fo:block text-align-last="end" last-line-end-indent="50pt">${'字'.repeat(17 + 5)}</fo:block>`)).lines;
    expect(right(c[1])).toBeCloseTo(R - 50, 1);
  });

  it('百分率は、ブロックを含む領域の幅に対する値。継承される', () => {
    const { lines } = linesOf(page(`<fo:block last-line-end-indent="50%"><fo:block text-align-last="end">${'字'.repeat(17 + 3)}</fo:block></fo:block>`));
    expect(right(lines[1])).toBeCloseTo(R - pt(30), 1);
  });

  it('子のブロックの前で終わる行にも当たる。強制改行で終わる行には当たらない', () => {
    const { lines } = linesOf(page(`<fo:block text-align-last="end" last-line-end-indent="20pt" linefeed-treatment="preserve">一\n二<fo:block last-line-end-indent="0pt">子</fo:block>三</fo:block>`));
    expect(lines.map((l) => text(l))).toEqual(['一', '二', '子', '三']);
    expect(right(lines[0])).toBeCloseTo(R, 1);
    expect(right(lines[1])).toBeCloseTo(R - 20, 1);
    expect(right(lines[2])).toBeCloseTo(R, 1);
    expect(right(lines[3])).toBeCloseTo(R - 20, 1);
  });

  it('縦書き: 最後の行だけ、行の終わり (下) の端まで伸びる', () => {
    const { lines } = linesOf(page(`<fo:block text-align-last="justify" end-indent="30pt" last-line-end-indent="-30pt">${'見'.repeat(20)}<fo:leader leader-pattern="dots"/>99</fo:block>`, { seq: 'writing-mode="tb-rl"' }));
    const bottom = (l: Line) => Math.max(...l.glyphs.map((g) => g.y + 10));
    expect(lines.length).toBe(2);
    expect(bottom(lines[0])).toBeLessThanOrEqual(R - 30 + 0.5);
    expect(bottom(lines[1])).toBeGreaterThan(R - 12);
  });
});

describe('leader-alignment', () => {
  /** 行ごとの、点の左端の位置 (ページの左上から) */
  const dots = (fo: string) => linesOf(fo).lines.map((l) => l.glyphs.filter((g) => g.ch === '.').map((g) => g.x));
  const body = (la: string, inner = '') =>
    `<fo:block ${la} text-align-last="justify" start-indent="7pt" ${inner}>あ<fo:leader leader-pattern="dots" leader-pattern-width="10pt"/>1</fo:block>` +
    `<fo:block ${la} text-align-last="justify" start-indent="13pt" ${inner}>あ<fo:leader leader-pattern="dots" leader-pattern-width="10pt"/>1</fo:block>`;
  /** 点の箱 (幅 10pt の周期) の始まりの位置を、周期で割った余り */
  const phase = (xs: number[], origin: number) => {
    const g = xs[0];
    return (((g - origin) % 10) + 10) % 10;
  };

  it('reference-area: 周期の始まりを、参照領域 (本文の領域) の始めの端からの格子に合わせる。字下げの違う行でも点が縦に揃う', () => {
    const [a, b] = dots(page(body('leader-alignment="reference-area"')));
    expect(a.length).toBeGreaterThan(5);
    expect(phase(a, L)).toBeCloseTo(phase(b, L), 2);
    // 周期の始まりは L + 10 の倍数。点はその周期の中央 (周期 10pt − 点の幅) / 2 の所
    const { lines } = linesOf(page(body('leader-alignment="reference-area"')));
    const dot = lines[0].glyphs.find((g) => g.ch === '.')!;
    const off = (((dot.x - (10 - dot.w) / 2 - L) % 10) + 10) % 10;
    expect(Math.min(off, 10 - off)).toBeCloseTo(0, 2);
  });

  it('none (初期値) は、いままでどおり (行の始めからの格子。字下げが違えば揃わない)', () => {
    const [a, b] = dots(page(body('')));
    expect(Math.abs(phase(a, L) - phase(b, L))).toBeGreaterThan(1);
    expect(dots(page(body('leader-alignment="none"')))).toEqual([a, b]);
  });

  it('page: ページの始めの端からの格子に合わせる', () => {
    const { lines } = linesOf(page(body('leader-alignment="page"')));
    for (const l of lines) {
      const dot = l.glyphs.find((g) => g.ch === '.')!;
      const off = (((dot.x - (10 - dot.w) / 2) % 10) + 10) % 10;
      expect(Math.min(off, 10 - off)).toBeCloseTo(0, 2);
    }
  });

  it('表のセルの中では、セルの内容の始めの端が基準', () => {
    const cell = (ind: string) => `<fo:table-cell padding-left="3pt"><fo:block leader-alignment="reference-area" text-align-last="justify" start-indent="${ind}">あ<fo:leader leader-pattern="dots" leader-pattern-width="10pt"/>1</fo:block></fo:table-cell>`;
    const fo = page(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="100%"/><fo:table-body><fo:table-row>${cell('4pt')}</fo:table-row></fo:table-body></fo:table>`);
    const { lines } = linesOf(fo);
    const dot = lines[0].glyphs.find((g) => g.ch === '.')!;
    const off = (((dot.x - (10 - dot.w) / 2 - (L + 3)) % 10) + 10) % 10;
    expect(Math.min(off, 10 - off)).toBeCloseTo(0, 2);
  });

  it('点はリーダーの範囲からはみ出さない (前後の字に重ならない)', () => {
    const { lines } = linesOf(page(body('leader-alignment="reference-area"')));
    for (const l of lines) {
      const a = l.glyphs.find((g) => g.ch === 'あ')!;
      const one = l.glyphs.find((g) => g.ch === '1')!;
      for (const g of l.glyphs.filter((x) => x.ch === '.')) {
        expect(g.x).toBeGreaterThanOrEqual(a.x + a.w - 0.01);
        expect(g.x + g.w).toBeLessThanOrEqual(one.x + 0.01);
      }
    }
  });

  it('縦書きでも、行の向き (上から下) の格子に合わせる', () => {
    const fo = page(body('leader-alignment="reference-area"').replace(/leader-pattern="dots"/g, 'leader-pattern="use-content"').replace(/<fo:leader ([^/]*)\/>/g, '<fo:leader $1>.</fo:leader>'), { seq: 'writing-mode="tb-rl"' });
    const ls = linesOf(fo).lines.map((l) => l.glyphs.filter((g) => g.ch === '.').map((g) => g.y));
    expect(ls[0].length).toBeGreaterThan(5);
    const ph = (ys: number[]) => (((Math.min(...ys) - L) % 10) + 10) % 10;
    expect(ph(ls[0])).toBeCloseTo(ph(ls[1]), 2);
  });
});
