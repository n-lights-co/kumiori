/**
 * XSL-FO (仕様モード) の行:
 *  - 代わりの書体 (和文の書体) の字を含む行も、最初に使える書体の上下で基線を決める (欧文だけの隣のセルと基線がそろう)
 *  - fo:inline の keep-together.within-line="always" は、直前に和文が空白なしで続いても中で折り返さない
 *  - 「.optimum」のように行頭に置けない字 (UAX #14 の IS) で始まる語の前では、空白があっても改行しない (WeasyPrint・ブラウザと同じ)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string, width = '100mm') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="${width}" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const layout = (body: string, width?: string) => E.engine.layout(importXslFo(fo(body, width), parse, { compat: 'spec' }).document);
/** 行ごとの字の並びと、字の絶対位置 */
function lines(sheet: unknown): Array<{ text: string; y: number }> {
  const out: Array<{ text: string; y: number }> = [];
  const visit = (n: unknown, ox: number, oy: number) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, ox, oy));
    const a = n as { type?: string; x?: number; y?: number; children?: unknown[] };
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    if (a.type === 'line') {
      const glyphs: string[] = [];
      walk(a as unknown as Area, (g) => g.type === 'glyph' && glyphs.push((g as GlyphArea).text));
      out.push({ text: glyphs.join(''), y });
      return;
    }
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, x, y);
  };
  visit(sheet, 0, 0);
  return out;
}

describe('XSL-FO 仕様モードの行の基線と改行', () => {
  it('欧文だけのセルと和文を含むセルの基線がそろう (代わりの書体の字は最初に使える書体の上下)', () => {
    const t = layout(
      `<fo:table table-layout="fixed" width="60mm" font-size="9pt" line-height="1.5"><fo:table-column column-width="20mm"/><fo:table-column column-width="40mm"/><fo:table-body>` +
        `<fo:table-row><fo:table-cell><fo:block>antenna</fo:block></fo:table-cell><fo:table-cell><fo:block>spec (既定・仕様)</fo:block></fo:table-cell></fo:table-row>` +
        `<fo:table-row><fo:table-cell><fo:block>12pt</fo:block></fo:table-cell><fo:table-cell><fo:block>font-size の medium</fo:block></fo:table-cell></fo:table-row>` +
        `</fo:table-body></fo:table>`,
    );
    const ys = new Map<string, number>();
    const visit = (n: unknown, oy: number) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => visit(c, oy));
      const a = n as { type?: string; y?: number; text?: string };
      const y = oy + (a.y ?? 0);
      if (a.type === 'glyph' && a.text && /^[as1f]$/.test(a.text) && !ys.has(a.text)) ys.set(a.text, y);
      for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, y);
    };
    visit(t.sheets[0], 0);
    // 1 行目: antenna の a と spec の s、2 行目: 12pt の 1 と font-size の f
    expect(ys.get('s')).toBeCloseTo(ys.get('a')!, 3);
    expect(ys.get('f')).toBeCloseTo(ys.get('1')!, 3);
    // 和文を含む行も行送りは line-height (1.5 × 9pt)
    expect(ys.get('1')! - ys.get('a')!).toBeCloseTo(13.5, 1);
  });
  it('fo:inline の keep-together.within-line="always" は、直前が和文 (空白なし) でも中で折り返さない', () => {
    const body = (keep: boolean) =>
      `<fo:block font-size="9pt" line-height="1.6">仕様どおりに組みます)。<fo:inline${keep ? ' keep-together.within-line="always"' : ''}>--compat antenna</fo:inline> は、互換のための既定値で組んでいます。もう 1 つの <fo:inline${keep ? ' keep-together.within-line="always"' : ''}>--compat antenna</fo:inline> は同じです。</fo:block>`;
    for (const width of ['70mm', '74mm', '78mm', '82mm', '86mm', '90mm']) {
      const kept = lines(layout(body(true), width).sheets[0]).map((l) => l.text);
      for (const l of kept) {
        expect(l.endsWith('--compat')).toBe(false);
        expect(l.endsWith('--')).toBe(false);
        expect(l.startsWith('antenna')).toBe(false);
        expect(l.startsWith('compat')).toBe(false);
      }
      expect(kept.filter((l) => l.includes('--compat antenna'))).toHaveLength(kept.filter((l) => /--compat|antenna/.test(l)).length);
    }
    // keep が無ければ、どこかの幅で語間や -- の後ろで分かれる
    const split = ['70mm', '74mm', '90mm'].some((w) => lines(layout(body(false), w).sheets[0]).some((l) => l.text.endsWith('--compat') || l.text.endsWith('--')));
    expect(split).toBe(true);
  });
  it('空白の後でも「.」で始まる語の前では改行しない (UAX #14 LB13。「一部: .optimum・.conditionality」は「一」の後で折り返す)', () => {
    const t = layout('<fo:block-container width="34mm" font-size="8pt" line-height="1.5"><fo:block>一部: .optimum・.conditionality を使います</fo:block></fo:block-container>');
    const ls = lines(t.sheets[0]).map((l) => l.text);
    expect(ls[0]).toBe('一');
    expect(ls[1].startsWith('部: .optimum')).toBe(true);
  });
});
