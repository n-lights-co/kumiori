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

describe('NC-28 絶対配置の top・bottom・height の百分率 (CSS 2.1 §10.1 の 4・§10.5・§10.6.4、CSS Position 3 §3.1: 基準は包含ブロックの padding の箱の高さ)', () => {
  /** 字が text で、幅が w の箱 (基準の箱) */
  const cbOf = (bs: Box[], text: string, w: number) => {
    const hit = bs.find((b) => norm(b.text) === norm(text) && Math.abs(b.w - w) < 0.01);
    if (!hit) throw new Error(`基準の箱が無い: ${text}`);
    return hit;
  };

  it('top: 50%・left: 50% は、高さの決まった基準の箱のまん中から', () => {
    const bs = boxes('<p>p</p><div style="position: relative; height: 100pt; width: 200pt">A<div class="abs" style="top: 50%; left: 50%">X</div></div>');
    const cb = cbOf(bs, 'AX', 200);
    const x = find(bs, 'X');
    expect(x.x).toBeCloseTo(cb.pad.x0 + 100, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0 + 50, 3);
  });

  it('top: 100% は、高さが中身で決まる基準の箱の padding の箱の下端 (ドロップダウンの形)', () => {
    const bs = boxes('<p>p</p><div style="position: relative; width: 200pt; padding: 5pt 7pt; border: 3pt solid">menu<div class="abs" style="top: 100%; left: 0">X</div></div>');
    const cb = cbOf(bs, 'menuX', 220);
    const x = find(bs, 'X');
    expect(cb.pad.y1 - cb.pad.y0).toBeCloseTo(22, 3);
    expect(x.y).toBeCloseTo(cb.pad.y1, 3);
    expect(x.x).toBeCloseTo(cb.pad.x0, 3);
  });

  it('bottom: 10% は padding の箱の高さの 1 割だけ下端から上。margin は足す', () => {
    const bs = boxes('<div style="position: relative; height: 100pt; width: 200pt; padding: 10pt">A<div class="abs" style="bottom: 10%; right: 10%">X</div><div class="abs" style="top: 50%; left: 0; margin-top: -5pt">Y</div></div>');
    const cb = cbOf(bs, 'AXY', 220);
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.y + x.h).toBeCloseTo(cb.pad.y1 - 12, 3);
    expect(x.x + x.w).toBeCloseTo(cb.pad.x1 - 22, 3);
    expect(y.y).toBeCloseTo(cb.pad.y0 + 60 - 5, 3);
  });

  it('height: 50% は padding の箱の高さの半分 (box-sizing: border-box なら枠を含む)', () => {
    const bs = boxes(
      '<div style="position: relative; height: 100pt; width: 200pt; padding: 10pt">A<div style="position: absolute; top: 0; left: 0; width: 20pt; height: 50%">X</div>' +
        '<div style="position: absolute; top: 0; left: 30pt; width: 20pt; height: 50%; padding: 3pt; border: 1pt solid; box-sizing: border-box">Y</div>' +
        '<div style="position: absolute; bottom: 20%; left: 60pt; width: 20pt; height: 25%">Z</div></div>',
    );
    const cb = cbOf(bs, 'AXYZ', 220);
    expect(find(bs, 'X').h).toBeCloseTo(60, 3);
    expect(find(bs, 'Y').h).toBeCloseTo(60, 3);
    const z = find(bs, 'Z');
    expect(z.h).toBeCloseTo(30, 3);
    expect(z.y + z.h).toBeCloseTo(cb.pad.y1 - 24, 3);
  });

  it('inset: 10% は 4 辺とも (上下は高さ、左右は幅の 1 割)。高さは top と bottom から決まる', () => {
    const bs = boxes('<div style="position: relative; height: 100pt; width: 200pt; padding: 10pt">A<div style="position: absolute; inset: 10%">X</div></div>');
    const cb = cbOf(bs, 'AX', 220);
    const x = find(bs, 'X');
    expect(x.x).toBeCloseTo(cb.pad.x0 + 22, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0 + 12, 3);
    expect(x.w).toBeCloseTo(176, 3);
    expect(x.h).toBeCloseTo(96, 3);
  });

  it('基準の箱の高さが auto (中身で決まる) でも、組んだ後の高さに対する割合', () => {
    const bs = boxes(
      '<div style="position: relative; width: 200pt"><p>a</p><p>b</p><p>c</p><p>d</p><div class="abs" style="top: 50%; left: 0">X</div>' +
        '<div style="position: absolute; right: 0; bottom: 25%; width: 20pt; height: 50%">Y</div></div>',
      'p { margin: 0 }',
    );
    const cb = cbOf(bs, 'abcdXY', 200);
    expect(cb.h).toBeCloseTo(48, 3);
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(x.y).toBeCloseTo(cb.pad.y0 + 24, 3);
    expect(y.h).toBeCloseTo(24, 3);
    expect(y.y + y.h).toBeCloseTo(cb.pad.y1 - 12, 3);
  });

  it('絶対配置の箱が基準 (高さが auto・高さの指定あり) のとき', () => {
    const auto = boxes(
      '<div style="position: relative; width: 200pt; height: 200pt"><div style="position: absolute; left: 10pt; top: 20pt; width: 100pt; padding: 4pt"><p>a</p><p>b</p>' +
        '<div class="abs" style="top: 100%; left: 0">X</div><div style="position: absolute; top: 50%; right: 0; width: 20pt; height: 50%">Y</div></div></div>',
      'p { margin: 0 }',
    );
    const cb = cbOf(auto, 'abXY', 108);
    expect(cb.h).toBeCloseTo(32, 3);
    expect(find(auto, 'X').y).toBeCloseTo(cb.pad.y1, 3);
    const y = find(auto, 'Y');
    expect(y.y).toBeCloseTo(cb.pad.y0 + 16, 3);
    expect(y.h).toBeCloseTo(16, 3);
    const fixed = boxes(
      '<div style="position: relative; width: 200pt; height: 200pt"><div style="position: absolute; left: 10pt; top: 20pt; width: 100pt; height: 80pt; padding: 4pt">a' +
        '<div class="abs" style="top: 50%; left: 0">X</div><div class="abs" style="bottom: 25%; right: 0">Y</div></div></div>',
    );
    const cb2 = cbOf(fixed, 'aXY', 108);
    expect(find(fixed, 'X').y).toBeCloseTo(cb2.pad.y0 + 44, 3);
    const y2 = find(fixed, 'Y');
    expect(y2.y + y2.h).toBeCloseTo(cb2.pad.y1 - 22, 3);
  });

  it('表のセル・リストの項目が基準のとき', () => {
    const bs = boxes('<table><tr><td style="position: relative; width: 100pt; height: 50pt; padding: 5pt; border: 2pt solid">A<div class="abs" style="top: 50%; left: 0">X</div><div class="abs" style="bottom: 20%; right: 0">Y</div></td></tr></table>');
    const cell = find(bs, 'AXY', 'table-cell');
    const x = find(bs, 'X');
    const y = find(bs, 'Y');
    expect(cell.pad.y1 - cell.pad.y0).toBeCloseTo(60, 3);
    expect(x.y).toBeCloseTo(cell.pad.y0 + 30, 3);
    expect(y.y + y.h).toBeCloseTo(cell.pad.y1 - 12, 3);
    // リストの項目 (高さは中身の 2 行 = 24pt)
    const li = boxes('<ul><li style="position: relative">A<br>B<div class="abs" style="top: 50%; left: 0">X</div></li></ul>');
    const item = find(li, 'ABX', 'table-cell');
    expect(item.h).toBeCloseTo(24, 3);
    expect(find(li, 'X').y).toBeCloseTo(item.y + 12, 3);
  });

  it('行内の箱・inline-block が基準のとき (padding の箱の高さ)', () => {
    const body = '<p style="margin: 20pt">前<span style="position: relative; padding: 3pt">基準<span class="abs" style="top: 100%; left: 0">X</span></span>後</p>';
    const x = find(boxes(body), 'X');
    const zero = find(boxes(body.replace('top: 100%', 'top: 0')), 'X');
    // 行内の箱の内容の高さは字の上下 (書体の値) で決まる。その高さ + 上下の padding だけ下がる
    const bottom = find(boxes(body.replace('top: 100%', 'bottom: 0')), 'X');
    expect(x.y).toBeCloseTo(bottom.y + bottom.h, 3);
    expect(x.y - zero.y).toBeGreaterThan(6 + 9);
    const bs = boxes('<p style="margin: 20pt">前<span style="display: inline-block; position: relative; padding: 3pt; height: 40pt; width: 60pt">基準<span class="abs" style="top: 50%; left: 0">X</span></span>後</p>');
    const ib = bs.find((b) => Math.abs(b.pad.x1 - b.pad.x0 - 66) < 0.01 && Math.abs(b.pad.y1 - b.pad.y0 - 46) < 0.01)!;
    expect(ib).toBeTruthy();
    expect(find(bs, 'X').y).toBeCloseTo(ib.pad.y0 + 23, 3);
  });

  it('基準の祖先が無ければ、本文領域 (初期包含ブロック) の高さに対する割合。position: fixed も', () => {
    const mm = 72 / 25.4;
    const areaH = (210 - 20) * mm;
    for (const pos of ['absolute', 'fixed']) {
      const bs = boxes(`<p>p</p><div style="position: ${pos}; top: 50%; left: 10pt; width: 20pt; height: 10%">X</div><div style="position: ${pos}; bottom: 10%; right: 0; width: 20pt; height: 10pt">Y</div>`);
      const x = find(bs, 'X');
      const y = find(bs, 'Y');
      expect(x.y).toBeCloseTo(10 * mm + areaH / 2, 3);
      expect(x.h).toBeCloseTo(areaH / 10, 3);
      expect(y.y + y.h).toBeCloseTo(10 * mm + areaH * 0.9, 3);
    }
  });

  it('百分率でない top・bottom・height は、これまでと同じ', () => {
    const bs = boxes('<div style="position: relative; height: 100pt; width: 200pt; padding: 10pt">A<div class="abs" style="top: 7pt; left: 6pt">X</div><div class="abs" style="bottom: 4pt; right: 3pt">Y</div></div>');
    const cb = cbOf(bs, 'AXY', 220);
    expect(find(bs, 'X').y).toBeCloseTo(cb.pad.y0 + 7, 3);
    const y = find(bs, 'Y');
    expect(y.y + y.h).toBeCloseTo(cb.pad.y1 - 4, 3);
  });
});

describe('NC-28 (4) 行の中の絶対配置の箱の static position (CSS 2.1 §10.3.7・§10.6.4)', () => {
  it('left・right・top・bottom が auto なら、行の中の見つけた所 (後ろの字の前) に置く', () => {
    const body = '<div style="position: relative; margin-left: 30pt; width: 200pt">PRE <span class="abs">S</span>Q</div>';
    const s = glyphAt(body, '', 'S');
    const q = glyphAt(body, '', 'Q');
    expect(s.x).toBeCloseTo(q.x, 3);
    expect(s.y).toBeCloseTo(q.y, 3);
  });

  it('2 行目で見つけたら、2 行目の高さ', () => {
    const body = '<div style="position: relative; width: 40pt">AAAA BBBB <span class="abs">S</span>C</div>';
    const s = glyphAt(body, '', 'S');
    const c = glyphAt(body, '', 'C');
    expect(c.y - glyphAt(body, '', 'A').y).toBeCloseTo(12, 3);
    expect(s.x).toBeCloseTo(c.x, 3);
    expect(s.y).toBeCloseTo(c.y, 3);
  });

  it('表のセルの中で見つけた箱 (基準は外のブロック)', () => {
    const body = '<div style="position: relative; margin-left: 30pt"><table><tr><td>PRE <span class="abs">S</span>Q</td></tr></table></div>';
    const s = glyphAt(body, '', 'S');
    const q = glyphAt(body, '', 'Q');
    expect(s.x).toBeCloseTo(q.x, 3);
    expect(s.y).toBeCloseTo(q.y, 3);
  });

  it('見つけた所の目印は、行の字の位置を変えない (右寄せ・両端揃え・行末の空白)', () => {
    for (const align of ['right', 'center', 'justify']) {
      const text = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo';
      const plain = `<div style="position: relative; width: 120pt; text-align: ${align}">${text} <span>Z</span></div>`;
      const marked = `<div style="position: relative; width: 120pt; text-align: ${align}">${text} <span class="abs">S</span><span>Z</span></div>`;
      for (const ch of ['a', 'f', 'k', 'o', 'Z']) {
        expect(glyphAt(marked, '', ch).x).toBeCloseTo(glyphAt(plain, '', ch).x, 3);
        expect(glyphAt(marked, '', ch).y).toBeCloseTo(glyphAt(plain, '', ch).y, 3);
      }
    }
    // どの語の後ろに箱があっても (行の終わり・行の頭になる所も)、ほかの字の位置は同じ
    const words = 'aaa bbb ccc ddd eee 「fff」 ggg hhh iii jjj kkk lll'.split(' ');
    const all = (body: string) => {
      const out: string[] = [];
      const rec = (a: Area, ox: number, oy: number) => {
        const g = a as unknown as { x?: number; y?: number };
        const x = ox + (g.x ?? 0);
        const y = oy + (g.y ?? 0);
        if (a.type === 'glyph') {
          if (a.text !== 'S') out.push(`${a.text}@${x.toFixed(3)},${y.toFixed(3)}`);
          return;
        }
        for (const c of childrenOf(a)) rec(c, x, y);
      };
      rec(E.engine.layout(imp(body).document).sheets[0].page, 0, 0);
      return out.sort().join(' ');
    };
    for (const align of ['left', 'right', 'justify']) {
      const wrap = (t: string) => `<div style="position: relative; width: 70pt; text-align: ${align}">${t}</div>`;
      const plain = all(wrap(words.join(' ')));
      for (let k = 1; k < words.length; k++) {
        expect(all(wrap(`${words.slice(0, k).join(' ')} <span class="abs">S</span>${words.slice(k).join(' ')}`))).toBe(plain);
        expect(all(wrap(`${words.slice(0, k).join(' ')}<span class="abs">S</span> ${words.slice(k).join(' ')}`))).toBe(plain);
      }
    }
    // 段落の終わりの箱 (後ろに字が無い): 行末の空白は、これまでどおり右寄せの字の位置に数えない
    const p0 = '<div style="position: relative; width: 120pt; text-align: right">abc </div>';
    const p1 = '<div style="position: relative; width: 120pt; text-align: right">abc <span class="abs">S</span></div>';
    expect(glyphAt(p1, '', 'c').x).toBeCloseTo(glyphAt(p0, '', 'c').x, 3);
  });

  it('left の指定があれば、左右は指定どおり (上下は行の高さ)', () => {
    const body = '<div style="position: relative; margin-left: 30pt; width: 200pt">PRE <span class="abs" style="left: 5pt">S</span>Q</div>';
    const s = glyphAt(body, '', 'S');
    expect(s.x).toBeCloseTo((10 * 72) / 25.4 + 35, 3);
    expect(s.y).toBeCloseTo(glyphAt(body, '', 'Q').y, 3);
  });
});

describe('NC-28 (2) flex・grid の容器が基準の絶対配置 (CSS Flexbox 1 §4.1・CSS Grid 1 §9.1・CSS 2.1 §10.1 の 4)', () => {
  for (const disp of ['flex', 'grid']) {
    it(`position: relative の ${disp} の容器の padding の箱から`, () => {
      const bs = boxes(`<div style="position: relative; display: ${disp}; margin-left: 30pt; width: 200pt; height: 50pt; padding: 4pt">F<div class="abs" style="left: 7pt; top: 9pt">X</div></div>`);
      const cb = bs.find((b) => Math.abs(b.w - 208) < 0.01 && Math.abs(b.h - 58) < 0.01)!;
      expect(cb).toBeTruthy();
      const x = find(bs, 'X');
      expect(x.x).toBeCloseTo(cb.pad.x0 + 7, 3);
      expect(x.y).toBeCloseTo(cb.pad.y0 + 9, 3);
      const r = find(boxes(`<div style="position: relative; display: ${disp}; margin-left: 30pt; width: 200pt; height: 50pt; padding: 4pt">F<div class="abs" style="right: 0; bottom: 0">X</div></div>`), 'X');
      expect(r.x + r.w).toBeCloseTo(cb.pad.x1, 3);
      expect(r.y + r.h).toBeCloseTo(cb.pad.y1, 3);
    });
  }

  it('flex の項目の中の絶対配置の箱も、容器が基準 (高さが中身で決まる容器も)', () => {
    for (const h of ['height: 50pt; ', '']) {
      const bs = boxes(`<div style="position: relative; display: flex; margin-left: 30pt; width: 200pt; ${h}padding: 4pt"><div>A<div class="abs" style="left: 7pt; top: 9pt">X</div></div><div>B</div></div>`);
      const cb = bs.find((b) => Math.abs(b.w - 208) < 0.01 && norm(b.text) === norm('ABX'))!;
      expect(cb).toBeTruthy();
      const x = find(bs, 'X');
      expect(x.x).toBeCloseTo(cb.pad.x0 + 7, 3);
      expect(x.y).toBeCloseTo(cb.pad.y0 + 9, 3);
    }
  });

  it('position が static の flex の容器は、これまでどおり基準にしない (外の基準のブロックから)', () => {
    const bs = boxes('<div style="position: relative; margin-left: 30pt; width: 300pt; padding: 2pt"><div style="display: flex; margin-left: 40pt">F<div class="abs" style="left: 7pt; top: 9pt">X</div></div></div>');
    const cb = bs.find((b) => Math.abs(b.w - 304) < 0.01)!;
    const x = find(bs, 'X');
    expect(x.x).toBeCloseTo(cb.pad.x0 + 7, 3);
    expect(x.y).toBeCloseTo(cb.pad.y0 + 9, 3);
    // 項目の中の箱も (項目は表のセルに組む)
    const bs2 = boxes('<div style="position: relative; margin-left: 30pt; width: 300pt; padding: 2pt"><p>p</p><div style="display: flex; margin-left: 40pt"><div>A<div class="abs" style="left: 7pt; top: 9pt">X</div></div><div>B</div></div></div>');
    const cb2 = bs2.find((b) => Math.abs(b.w - 304) < 0.01)!;
    const x2 = find(bs2, 'X');
    expect(x2.x).toBeCloseTo(cb2.pad.x0 + 7, 3);
    expect(x2.y).toBeCloseTo(cb2.pad.y0 + 9, 3);
  });
});

describe('NC-28 (3) リストの項目・表のセルの position: relative のずらし (CSS 2.1 §9.4.3)', () => {
  it('li の left・top', () => {
    const a = glyphAt('<ul><li>L</li></ul>', '', 'L');
    const b = glyphAt('<ul><li style="position: relative; left: 100pt; top: 5pt">L</li></ul>', '', 'L');
    expect(b.x - a.x).toBeCloseTo(100, 3);
    expect(b.y - a.y).toBeCloseTo(5, 3);
  });

  it('td の left・top (後ろのセルは動かない)', () => {
    const a = (ch: string) => glyphAt('<table><tr><td>T</td><td>U</td></tr></table>', '', ch);
    const b = (ch: string) => glyphAt('<table><tr><td style="position: relative; left: 100pt; top: 5pt">T</td><td>U</td></tr></table>', '', ch);
    expect(b('T').x - a('T').x).toBeCloseTo(100, 3);
    expect(b('T').y - a('T').y).toBeCloseTo(5, 3);
    expect(b('U').x).toBeCloseTo(a('U').x, 3);
  });
});
