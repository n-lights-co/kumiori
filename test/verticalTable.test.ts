/**
 * 書字方向を指定した表 (LAY-19 の (1)。CSS Writing Modes 3 §2.1・§7.3、CSS 2.1 §17):
 *  - 横書きの文書の中の writing-mode: vertical-rl・vertical-lr の表は、縦書きで組む (行は横に、セルは上から下へ並ぶ)
 *  - 縦書きの文書の中の writing-mode: horizontal-tb の表は、横書きで組む
 *  - 中身に合わせた幅を測るとき、罫線を分ける表のセルの間隔 (border-spacing) を表の幅に入れる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area, LTable } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const BASE = '@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 12pt } td { border: 1pt solid; padding: 3pt }';
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `${BASE} ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 字 ch の位置 (用紙の左上から) */
const glyphs = (body: string, css = '') => {
  const out = new Map<string, { x: number; y: number }>();
  let lines = 0;
  const rec = (a: Area, ox: number, oy: number) => {
    const g = a as unknown as { x?: number; y?: number; border?: Record<string, { width: number } | undefined>; padding?: Record<string, number> };
    const x = ox + (g.x ?? 0);
    const y = oy + (g.y ?? 0);
    if (a.type === 'line') lines++;
    if (a.type === 'glyph') {
      if (!out.has(a.text)) out.set(a.text, { x, y });
      return;
    }
    for (const c of childrenOf(a)) rec(c, x + (g.border?.left?.width ?? 0) + (g.padding?.left ?? 0), y + (g.border?.top?.width ?? 0) + (g.padding?.top ?? 0));
  };
  rec(E.engine.layout(imp(body, css).document).sheets[0].page, 0, 0);
  return { at: (ch: string) => out.get(ch)!, lines };
};
const TABLE = (style: string) => `<p>p</p><table style="${style}"><tr><td>あA</td><td>いB</td></tr><tr><td>うC</td><td>えD</td></tr></table><p>q</p>`;

describe('LAY-19 横書きの文書の中の縦書きの表 (Writing Modes 3 §2.1・CSS 2.1 §17)', () => {
  it('読み込み: 親と違う writing-mode の表に、書字方向を付ける (同じなら付けない)', () => {
    const find = (n: unknown): LTable | undefined => {
      if (!n || typeof n !== 'object') return undefined;
      if ((n as { type?: string }).type === 'table') return n as LTable;
      for (const v of Object.values(n)) {
        const hit = Array.isArray(v) ? v.map(find).find(Boolean) : find(v);
        if (hit) return hit;
      }
      return undefined;
    };
    expect(find(imp(TABLE('writing-mode: vertical-rl')).document.sequences[0].flow)!.writingMode).toBe('vertical-rl');
    expect(find(imp(TABLE('')).document.sequences[0].flow)!.writingMode).toBeUndefined();
    expect(find(imp(`<div style="writing-mode: vertical-rl">${TABLE('')}</div>`).document.sequences[0].flow)!.writingMode).toBeUndefined();
  });

  it('vertical-rl: 行は右から左へ、セルは上から下へ並ぶ。字は縦に進む', () => {
    const g = glyphs(TABLE('writing-mode: vertical-rl'));
    // 1 行目 (あ・い) は 2 行目 (う・え) より右。同じ行のセルは、上から下へ
    expect(g.at('あ').x).toBeGreaterThan(g.at('う').x + 10);
    expect(g.at('い').x).toBeCloseTo(g.at('あ').x, 1);
    expect(g.at('い').y).toBeGreaterThan(g.at('あ').y + 10);
    expect(g.at('え').y).toBeCloseTo(g.at('い').y, 1);
    // セルの中の字は縦に進む (折り返さない)
    expect(g.at('A').y).toBeGreaterThan(g.at('あ').y + 5);
    expect(Math.abs(g.at('A').x - g.at('あ').x)).toBeLessThan(6);
    // 表の後ろの段落は、表の下
    expect(g.at('q').y).toBeGreaterThan(g.at('い').y);
  });

  it('vertical-lr: 行は左から右へ並ぶ', () => {
    const g = glyphs(TABLE('writing-mode: vertical-lr'));
    expect(g.at('う').x).toBeGreaterThan(g.at('あ').x + 10);
    expect(g.at('い').y).toBeGreaterThan(g.at('あ').y + 10);
  });

  it('罫線を分ける表 (border-spacing) でも、セルの中の行を折り返さない', () => {
    const one = glyphs(TABLE('writing-mode: vertical-rl; border-collapse: collapse'));
    const sep = glyphs(TABLE('writing-mode: vertical-rl; border-collapse: separate; border-spacing: 4pt'));
    expect(sep.lines).toBe(one.lines);
    expect(sep.at('A').y).toBeGreaterThan(sep.at('あ').y + 5);
  });

  it('縦書きの文書の中の horizontal-tb の表は、横書きで組む', () => {
    const g = glyphs(TABLE('writing-mode: horizontal-tb'), 'body { writing-mode: vertical-rl }');
    expect(g.at('い').x).toBeGreaterThan(g.at('あ').x + 10);
    expect(g.at('う').y).toBeGreaterThan(g.at('あ').y + 10);
    expect(g.at('A').x).toBeGreaterThan(g.at('あ').x + 5);
  });

  it('writing-mode の指定の無い表は、これまでどおり (行は上から下へ)', () => {
    const g = glyphs(TABLE(''));
    expect(g.at('う').y).toBeGreaterThan(g.at('あ').y + 10);
    expect(g.at('い').x).toBeGreaterThan(g.at('あ').x + 10);
  });
});

describe('LAY-19 中身に合わせた幅と、セルの間隔 (CSS 2.1 §17.6.1)', () => {
  it('罫線を分ける表を入れた、幅の指定の無い inline-block・回り込みの中で、セルの中の行が折り返さない', () => {
    const t = '<table style="border-collapse: separate; border-spacing: 6pt"><tr><td>あいうえお</td><td>かきくけこ</td><td>さしすせそ</td></tr></table>';
    const plain = glyphs(t);
    for (const wrap of [`<span style="display: inline-block">${t}</span>`, `<div style="float: left">${t}</div>`, `<div style="position: absolute; left: 0; top: 0">${t}</div>`]) {
      const g = glyphs(wrap);
      expect(g.lines - plain.lines).toBeLessThanOrEqual(1);
      // 1 つのセルの字は、同じ行 (同じ高さ) に並ぶ
      expect(g.at('そ').y).toBeCloseTo(g.at('さ').y, 1);
      expect(g.at('こ').y).toBeCloseTo(g.at('か').y, 1);
    }
  });
});
