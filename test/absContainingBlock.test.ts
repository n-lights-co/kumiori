/**
 * 絶対配置の包含ブロック (NC-14。CSS 2.1 §9.3・§10.1・CSS Position 3 §2.1):
 *  - position が static でない表・表のセル・リストの項目・縦書きの箱を基準にする絶対配置
 *  - 基準の箱と絶対配置の箱の間に、表・リストの項目がある場合
 *  - 縦書きのブロックの position: relative のずらし
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const BASE = '@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 12pt } .abs { position: absolute; width: 20pt; height: 10pt }';
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `${BASE} ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};

interface Box { a: Area; x: number; y: number; w: number; h: number; text: string; pad: { x0: number; y0: number; x1: number; y1: number } }
/** 1 ページ目の箱 (用紙の左上からの位置。text は中の字)。pad は padding の箱 */
const boxes = (body: string, css = '', page = 0): Box[] => {
  const out: Box[] = [];
  const rec = (a: Area, ox: number, oy: number): string => {
    const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; border?: Record<string, { width: number } | undefined>; padding?: Record<string, number> };
    const x = ox + (g.x ?? 0);
    const y = oy + (g.y ?? 0);
    if (a.type === 'glyph') return a.text;
    const bw = (s: string) => g.border?.[s]?.width ?? 0;
    const cx = x + bw('left') + (g.padding?.left ?? 0);
    const cy = y + bw('top') + (g.padding?.top ?? 0);
    const b: Box = { a, x, y, w: g.width ?? 0, h: g.height ?? 0, text: '', pad: { x0: x + bw('left'), y0: y + bw('top'), x1: x + (g.width ?? 0) - bw('right'), y1: y + (g.height ?? 0) - bw('bottom') } };
    out.push(b);
    b.text = childrenOf(a).map((c) => rec(c, cx, cy)).join('');
    return b.text;
  };
  rec(E.engine.layout(imp(body, css).document).sheets[page].page, 0, 0);
  return out;
};
/** 字の並びを比べる形に (改行を除き、字を並べ替える: 絶対配置の箱は、基準の箱の子の最後に置かれる) */
const norm = (t: string) => [...t.replace(/\s/g, '')].sort().join('');
/** 中の字が text の字からなる、いちばん外の箱 (type で絞る) */
const find = (bs: Box[], text: string, type?: string) => {
  const hit = bs.find((b) => norm(b.text) === norm(text) && (!type || b.a.type === type));
  if (!hit) throw new Error(`箱が無い: ${text} ${type ?? ''}`);
  return hit;
};

describe('NC-14 表のセルを基準にする絶対配置 (CSS 2.1 §10.1 の 4: 基準は padding の箱)', () => {
  const td = 'position: relative; width: 100pt; height: 50pt; padding: 5pt; border: 2pt solid';
  it('position: relative のセルの右下・左上からの距離で置く', () => {
    const bs = boxes(`<p>p</p><table style="margin-left: 30pt"><tr><td>L</td><td style="${td}">A<div class="abs" style="right: 3pt; bottom: 4pt">X</div><div class="abs" style="left: 6pt; top: 7pt">Y</div></td></tr></table>`);
    const cell = find(bs, 'AXY', 'table-cell');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x + x.w).toBeCloseTo(cell.pad.x1 - 3, 3);
    expect(x.y + x.h).toBeCloseTo(cell.pad.y1 - 4, 3);
    expect(y.x).toBeCloseTo(cell.pad.x0 + 6, 3);
    expect(y.y).toBeCloseTo(cell.pad.y0 + 7, 3);
  });

  it('行の高さがほかのセルで決まるときも、伸びたセルの下端から置く', () => {
    const bs = boxes(`<table><tr><td style="position: relative; padding: 0">A<div class="abs" style="right: 0; bottom: 0">X</div></td><td style="height: 80pt">T</td></tr></table>`);
    const cell = find(bs, 'AX', 'table-cell');
    const x = find(bs, 'X');
    expect(cell.h).toBeGreaterThan(79);
    expect(x.y + x.h).toBeCloseTo(cell.pad.y1, 3);
    expect(x.x + x.w).toBeCloseTo(cell.pad.x1, 3);
  });

  it('セルの中のブロックを挟んでも、セルが基準', () => {
    const bs = boxes(`<table><tr><td style="${td}"><div style="margin-left: 20pt"><p>A</p><div class="abs" style="left: 0; top: 0">X</div></div></td></tr></table>`);
    const cell = find(bs, 'AX', 'table-cell');
    const x = find(bs, 'X');
    expect(x.x).toBeCloseTo(cell.pad.x0, 3);
    expect(x.y).toBeCloseTo(cell.pad.y0, 3);
  });

  it('位置の指定の無い箱は、見つけた所 (static position) に置く', () => {
    const bs = boxes(`<table><tr><td style="${td}"><p style="margin: 0">A</p><p style="margin: 0">B</p><div class="abs">X</div></td></tr></table>`);
    const cell = find(bs, 'ABX', 'table-cell');
    const x = find(bs, 'X');
    // 内容の箱の左端、2 行 (12pt × 2) の下
    expect(x.x).toBeCloseTo(cell.pad.x0 + 5, 3);
    expect(x.y).toBeCloseTo(cell.pad.y0 + 5 + 24, 3);
  });

  it('変換の付いたセルも基準になる (Transforms 1 §3)', () => {
    const bs = boxes(`<table><tr><td style="transform: translate(0, 0) rotate(0deg) scale(1.0001); width: 100pt; height: 50pt; padding: 5pt">A<div class="abs" style="right: 0; bottom: 0">X</div></td></tr></table>`);
    const cell = find(bs, 'AX', 'table-cell');
    const x = find(bs, 'X');
    expect(x.x + x.w).toBeCloseTo(cell.pad.x1, 3);
    expect(x.y + x.h).toBeCloseTo(cell.pad.y1, 3);
  });
});

describe('NC-14 表を基準にする絶対配置', () => {
  it('position: relative の表の padding の箱の右下・左上からの距離で置く', () => {
    const bs = boxes(`<p>p</p><table style="position: relative; margin-left: 30pt; border: 3pt solid; border-spacing: 2pt"><tr><td>A<div class="abs" style="right: 0; bottom: 0">X</div></td><td>B</td></tr><tr><td>C<div class="abs" style="left: 1pt; top: 2pt">Y</div></td><td>D</td></tr></table>`, 'td { width: 60pt; height: 30pt }');
    const table = find(bs, 'AXBCYD', 'table');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x + x.w).toBeCloseTo(table.pad.x1, 3);
    expect(x.y + x.h).toBeCloseTo(table.pad.y1, 3);
    expect(y.x).toBeCloseTo(table.pad.x0 + 1, 3);
    expect(y.y).toBeCloseTo(table.pad.y0 + 2, 3);
  });

  it('位置の指定の無い箱は、見つけたセルの中の所 (static position)', () => {
    const bs = boxes(`<table style="position: relative; border-spacing: 0"><tr><td>A</td><td>B</td></tr><tr><td>C</td><td style="padding: 0"><p style="margin: 0">D</p><div class="abs">X</div></td></tr></table>`, 'td { width: 60pt; height: 30pt; padding: 0; vertical-align: top }');
    const d = find(bs, 'D', 'table-cell');
    const x = find(bs, 'X');
    expect(x.x).toBeCloseTo(d.pad.x0, 3);
    expect(x.y).toBeCloseTo(d.pad.y0 + 12, 3);
  });

  it('表の外の position: relative のブロックが基準で、間に表がある', () => {
    const bs = boxes(`<p>p</p><div id="cb" style="position: relative; margin-left: 20pt; padding: 4pt; border: 1pt solid; width: 200pt"><table><tr><td>A<div class="abs" style="right: 0; top: 0">X</div><div class="abs" style="left: 0; bottom: 0">Y</div></td></tr></table><p>Q</p></div>`);
    const cb = find(bs, 'AXYQ', 'block');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x + x.w).toBeCloseTo(cb.pad.x1, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0, 3);
    expect(y.x).toBeCloseTo(cb.pad.x0, 3);
    expect(y.y + y.h).toBeCloseTo(cb.pad.y1, 3);
  });

  it('絶対配置の箱は 1 つだけ置く (行を組み直しても重ねない)', () => {
    const rows = Array.from({ length: 60 }, (_, k) => `<tr><td>r${k}${k === 58 ? '<div class="abs" style="left: 0; top: 0">X</div>' : ''}</td></tr>`).join('');
    const d = E.engine.layout(imp(`<table style="position: relative">${rows}</table>`).document);
    let n = 0;
    for (const s of d.sheets) {
      const rec = (a: Area) => {
        if (a.type === 'glyph' && a.text === 'X') n++;
        for (const c of childrenOf(a)) rec(c);
      };
      rec(s.page);
    }
    expect(d.sheets.length).toBeGreaterThan(1);
    expect(n).toBe(1);
  });
});

describe('NC-14 リストの項目を基準にする絶対配置', () => {
  it('position: relative の li の箱 (本文の箱) が基準', () => {
    const bs = boxes(`<ul><li>L</li><li style="position: relative">A<br>B<div class="abs" style="right: 0; bottom: 0">X</div><div class="abs" style="left: 0; top: 0">Y</div></li></ul>`);
    const cell = find(bs, 'ABXY', 'table-cell');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x + x.w).toBeCloseTo(cell.pad.x1, 3);
    expect(x.y + x.h).toBeCloseTo(cell.y + cell.h, 3);
    expect(y.x).toBeCloseTo(cell.x, 3);
    expect(y.y).toBeCloseTo(cell.y, 3);
  });

  it('リストの外の position: relative のブロックが基準で、間にリストの項目がある', () => {
    const bs = boxes(`<div style="position: relative; margin-left: 20pt; width: 200pt"><ul><li>A<div class="abs" style="right: 0; top: 0">X</div></li></ul></div>`);
    const cb = bs.find((b) => b.a.type === 'block' && b.text.replace(/[^AX]/g, '') === 'AX' && Math.abs(b.w - 200) < 0.01)!;
    const x = find(bs, 'X');
    expect(x.x + x.w).toBeCloseTo(cb.pad.x1, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0, 3);
  });
});

describe('NC-14 縦書きの箱を基準にする絶対配置 (位置の指定は物理の向き)', () => {
  it('横書きの文書の中の、縦書きの position: relative の箱', () => {
    const bs = boxes(`<p>p</p><div style="writing-mode: vertical-rl; position: relative; height: 120pt; width: 200pt; margin-left: 30pt; padding: 3pt">A<div class="abs" style="left: 10pt; top: 20pt">X</div><div class="abs" style="right: 0; bottom: 0; writing-mode: horizontal-tb">Y</div></div>`);
    const cb = bs.find((b) => norm(b.text) === 'AXY' && Math.abs(b.w - 206) < 0.01 && Math.abs(b.h - 126) < 0.01)!;
    expect(cb).toBeTruthy();
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x).toBeCloseTo(cb.pad.x0 + 10, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0 + 20, 3);
    expect(y.x + y.w).toBeCloseTo(cb.pad.x1, 3);
    expect(y.y + y.h).toBeCloseTo(cb.pad.y1, 3);
  });

  it('縦書きの文書の中の position: relative のブロック', () => {
    const bs = boxes(`<p>p</p><div style="position: relative; width: 80pt; padding: 3pt">A<div class="abs" style="left: 10pt; top: 20pt; writing-mode: horizontal-tb">X</div><div class="abs" style="right: 1pt; bottom: 2pt; writing-mode: horizontal-tb">Y</div></div>`, 'body { writing-mode: vertical-rl }');
    const cb = bs.find((b) => norm(b.text) === 'AXY' && Math.abs(b.w - 86) < 0.01)!;
    expect(cb).toBeTruthy();
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x).toBeCloseTo(cb.pad.x0 + 10, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0 + 20, 3);
    expect(y.x + y.w).toBeCloseTo(cb.pad.x1 - 1, 3);
    expect(y.y + y.h).toBeCloseTo(cb.pad.y1 - 2, 3);
  });

  it('縦書きのブロックの position: relative のずらしは、物理の向き (CSS 2.1 §9.4.3)', () => {
    const css = 'body { writing-mode: vertical-rl } div { width: 30pt }';
    const a = find(boxes('<div>A</div><div>B</div>', css), 'B');
    const b = find(boxes('<div>A</div><div style="position: relative; left: 7pt; top: 9pt">B</div>', css), 'B');
    expect(b.x - a.x).toBeCloseTo(7, 3);
    expect(b.y - a.y).toBeCloseTo(9, 3);
  });
});

describe('NC-14 これまでの経路 (横書きのブロックが基準) は変えない', () => {
  it('position: relative のブロック・変換の付いたブロック', () => {
    for (const st of ['position: relative', 'transform: scale(1.0001)']) {
      const bs = boxes(`<p>p</p><div style="${st}; margin-left: 30pt; width: 200pt; padding: 4pt">A<div class="abs" style="right: 0; bottom: 0">X</div></div>`);
      const cb = bs.find((b) => norm(b.text) === 'AX' && Math.abs(b.w - 208) < 0.01)!;
      const x = find(bs, 'X');
      expect(x.x + x.w).toBeCloseTo(cb.pad.x1, 3);
      expect(x.y + x.h).toBeCloseTo(cb.pad.y1, 3);
    }
  });
});

/** 字 ch の位置 (用紙の左上から。祖先の変換の移動を足す) と、同じ行かを見るための y */
const glyphAt = (body: string, css: string, ch: string) => {
  let hit: { x: number; y: number } | undefined;
  const rec = (a: Area, ox: number, oy: number) => {
    const g = a as unknown as { x?: number; y?: number; border?: Record<string, { width: number } | undefined>; padding?: Record<string, number>; transform?: number[] };
    const t = g.transform;
    const x = ox + (g.x ?? 0) + (t ? t[4] : 0);
    const y = oy + (g.y ?? 0) + (t ? t[5] : 0);
    if (a.type === 'glyph') {
      if (a.text === ch && !hit) hit = { x, y };
      return;
    }
    for (const c of childrenOf(a)) rec(c, x + (g.border?.left?.width ?? 0) + (g.padding?.left ?? 0), y + (g.border?.top?.width ?? 0) + (g.padding?.top ?? 0));
  };
  rec(E.engine.layout(imp(body, css).document).sheets[0].page, 0, 0);
  if (!hit) throw new Error(`字が無い: ${ch}`);
  return hit;
};

describe('NC-14 行の中の position: relative (CSS 2.1 §9.4.3)', () => {
  it('行内の要素を left・top だけずらし、後に続く字は動かさない', () => {
    const plain = (ch: string) => glyphAt('<p>a<span>M</span>n</p>', '', ch);
    const moved = (ch: string) => glyphAt('<p>a<span style="position: relative; left: 7pt; top: 3pt">M</span>n</p>', '', ch);
    expect(moved('M').x - plain('M').x).toBeCloseTo(7, 3);
    expect(moved('M').y - plain('M').y).toBeCloseTo(3, 3);
    expect(moved('n').x).toBeCloseTo(plain('n').x, 3);
    expect(moved('n').y).toBeCloseTo(plain('n').y, 3);
  });

  it('right・bottom は逆向き。中の行内の要素もいっしょに動く', () => {
    const plain = (ch: string) => glyphAt('<p>a<span>M<b>B</b><i style="border: 1pt solid">I</i></span>n</p>', '', ch);
    const moved = (ch: string) => glyphAt('<p>a<span style="position: relative; right: 2pt; bottom: 4pt">M<b>B</b><i style="border: 1pt solid">I</i></span>n</p>', '', ch);
    for (const ch of ['M', 'B', 'I']) {
      expect(moved(ch).x - plain(ch).x).toBeCloseTo(-2, 3);
      expect(moved(ch).y - plain(ch).y).toBeCloseTo(-4, 3);
    }
    expect(moved('n').x).toBeCloseTo(plain('n').x, 3);
  });

  it('入れ子の relative は足し合わせる。inline-block も動く', () => {
    const plain = (ch: string) => glyphAt('<p>a<span>M<span>N</span></span><span style="display: inline-block">K</span>z</p>', '', ch);
    const moved = (ch: string) => glyphAt('<p>a<span style="position: relative; top: 3pt">M<span style="position: relative; top: 2pt; left: 1pt">N</span></span><span style="display: inline-block; position: relative; top: 6pt">K</span>z</p>', '', ch);
    expect(moved('M').y - plain('M').y).toBeCloseTo(3, 3);
    expect(moved('N').y - plain('N').y).toBeCloseTo(5, 3);
    expect(moved('N').x - plain('N').x).toBeCloseTo(1, 3);
    expect(moved('K').y - plain('K').y).toBeCloseTo(6, 3);
    expect(moved('z').x).toBeCloseTo(plain('z').x, 3);
  });

  it('ずらしの無い relative の行内の要素は、何も変えない', () => {
    const d1 = E.engine.layout(imp('<p>a<span>M</span>n</p>').document);
    const d2 = E.engine.layout(imp('<p>a<span style="position: relative">M</span>n</p>').document);
    const strip = (t: unknown) => JSON.stringify(t, (k, v) => (k === 'sourceRef' ? undefined : v));
    expect(strip(d2.sheets[0].page)).toBe(strip(d1.sheets[0].page));
  });
});

describe('NC-14 行内の箱を基準にする絶対配置 (CSS 2.1 §10.1 の 4)', () => {
  it('position: relative の行内の要素の箱の左上・右下からの距離で置く', () => {
    const body = '<p>before <span style="position: relative">MMMM<span class="abs" style="left: 0; top: 0">X</span><span class="abs" style="right: 0; bottom: 0">Y</span></span> after</p>';
    const bs = boxes(body);
    const m = glyphAt(body, '', 'M');
    const a = glyphAt(body, '', 'a');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    // 左上は、行内の箱 (字の並び) の左上
    expect(x.x).toBeCloseTo(m.x, 3);
    expect(Math.abs(x.y - m.y)).toBeLessThan(2);
    // 右下は、行内の箱の右端 (後ろの空白の前) と下端
    expect(y.x + y.w).toBeGreaterThan(m.x + 20);
    expect(y.x + y.w).toBeLessThan(a.x);
    expect(Math.abs(y.y + y.h - (m.y + 10))).toBeLessThan(3);
  });

  it('行内の要素の padding の箱が基準', () => {
    const body = '<p>before <span style="position: relative; padding: 0 6pt">MMMM<span class="abs" style="left: 0; top: 0">X</span></span> after</p>';
    expect(find(boxes(body), 'X').x).toBeCloseTo(glyphAt(body, '', 'M').x - 6, 3);
  });

  it('position: relative の inline-block の padding の箱が基準 (中のブロックを挟んでも)', () => {
    const body = '<p>before <span id="ib" style="display: inline-block; position: relative; width: 80pt; height: 30pt; padding: 3pt; border: 2pt solid">M<span class="abs" style="right: 0; bottom: 0">X</span><div><div class="abs" style="left: 1pt; top: 2pt">Y</div></div></span> after</p>';
    const bs = boxes(body);
    const ib = bs.find((b) => Math.abs(b.pad.x1 - b.pad.x0 - 86) < 0.01 && Math.abs(b.pad.y1 - b.pad.y0 - 36) < 0.01)!;
    expect(ib).toBeTruthy();
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.x + x.w).toBeCloseTo(ib.pad.x1, 3);
    expect(x.y + x.h).toBeCloseTo(ib.pad.y1, 3);
    expect(y.x).toBeCloseTo(ib.pad.x0 + 1, 3);
    expect(y.y).toBeCloseTo(ib.pad.y0 + 2, 3);
  });

  it('行内の要素の中の絶対配置の箱は消えず、行を分けない', () => {
    const body = '<p>a<b>B<span class="abs" style="left: 100pt; top: 50pt">X</span></b>c</p>';
    const x = find(boxes(body), 'X');
    // 基準の祖先が無いので、本文領域の左上から
    expect(x.x).toBeCloseTo((10 * 72) / 25.4 + 100, 3);
    expect(x.y).toBeCloseTo((10 * 72) / 25.4 + 50, 3);
    expect(glyphAt(body, '', 'c').y).toBeCloseTo(glyphAt(body, '', 'a').y, 3);
    // 段落の直下の絶対配置の箱も、行を分けない
    const body2 = '<p>a<span class="abs" style="left: 100pt; top: 50pt">X</span>c</p>';
    expect(glyphAt(body2, '', 'c').y).toBeCloseTo(glyphAt(body2, '', 'a').y, 3);
  });

  it('行内の要素を挟んで、外の position: relative のブロックが基準', () => {
    const bs = boxes('<div style="position: relative; margin-left: 30pt; width: 200pt; padding: 4pt">A<b>B<span class="abs" style="right: 0; top: 0">X</span></b></div>');
    const cb = bs.find((b) => norm(b.text) === 'ABX' && Math.abs(b.w - 208) < 0.01)!;
    const x = find(bs, 'X');
    expect(x.x + x.w).toBeCloseTo(cb.pad.x1, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0, 3);
  });
});
