/**
 * 強制の区切り (break-before・break-after) の伝え方と効かせ方 (CSS Fragmentation 3 §3.1・§3.1.1・§4.3・§4.4):
 *  - 表: 最初の行の前・最後の行の後ろの区切り (行・セルの中身の最初 (最後) の子・行のまとまりの値) は、表の前後の区切り。
 *    行のまとまり (thead・tbody・tfoot) の break-* は、その最初・最後の行の前後の区切り。break-inside: avoid は、まとまりの行を分けない
 *  - flex の行・grid の行: 項目の区切りは、その項目の並ぶ行の前後の区切り (CSS Flexbox 1 §12・CSS Grid 2 §12)
 *  - 段組の中のページの区切りは、段の区切りも兼ねる (残りの段を空けて、次のページの最初の段から。§4.3)
 *  - 同じ区切りの所の左右のページの指定は、流れの中で後ろの要素の値が勝つ (§4.3)
 *  - 釣り合わせる段組は、ページの残りの高さを超えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { loadCachedFont, makeEngine } from './helpers';
import { typeset } from '../src/index';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 用紙 200pt 角・余白 10pt (本文の高さ 180pt)・行の高さ 12pt (1 ページ 15 行) */
const CSS = '@page { size: 200pt 200pt; margin: 10pt } body { margin: 0; line-height: 12pt; font-size: 8pt } p, ul, h2 { margin: 0 } table { border-collapse: collapse } td { padding: 0 }';
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `${CSS} ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ結果: ページごとの、行の字 (空白で区切る) と、ページの幅・警告 */
const layout = (body: string, css = '') => {
  const r = imp(body, css);
  const tree = E.engine.layout(r.document);
  const warnings = tree.warnings;
  const lines: Array<{ page: number; x: number; y: number; h: number; text: string }> = [];
  const textOf = (a: Area): string => (a.type === 'glyph' ? a.text : childrenOf(a).map(textOf).join(''));
  tree.sheets.forEach((s, page) => {
    const rec = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'line') {
        const t = textOf(a).trim();
        if (t) lines.push({ page, x, y, h: a.height, text: t });
        return;
      }
      for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
    };
    rec(s.page, 0, 0);
  });
  const pages = tree.sheets.map((_, k) => lines.filter((l) => l.page === k).map((l) => l.text).join(' '));
  return { pages, lines, widths: tree.sheets.map((s) => s.page.width), warnings, report: r.report };
};
const pages = (body: string, css = '') => layout(body, css).pages;
const BB = 'style="break-before: page"';
const BA = 'style="break-after: page"';

describe('表の最初の行の前・最後の行の後ろの区切りは、表の前後の区切り (§3.1.1)', () => {
  it('最初の行のセルの最初の子の break-before', () => {
    expect(pages(`<p>A1</p><table><tr><td><p ${BB}>B1</p></td></tr><tr><td>B2</td></tr></table>`)).toEqual(['A1', 'B1 B2']);
    // 同じ行のほかのセルも、いっしょに次のページへ (行を分けない)
    expect(pages(`<p>A1</p><table><tr><td>B0</td><td><p ${BB}>B1</p></td></tr></table>`)).toEqual(['A1', 'B0 B1']);
    // 古い page-break-before: always・div の中の表・罫線を分ける表
    expect(pages(`<p>A1</p><table><tr><td><h2 style="page-break-before: always">B1</h2></td></tr></table>`)).toEqual(['A1', 'B1']);
    expect(pages(`<p>A1</p><div><table><tr><td><p ${BB}>B1</p></td></tr></table></div>`)).toEqual(['A1', 'B1']);
    expect(pages(`<p>A1</p><table style="border-collapse: separate"><tr><td><p ${BB}>B1</p></td></tr></table>`)).toEqual(['A1', 'B1']);
  });

  it('最初の行・最後の行の break-before・break-after', () => {
    expect(pages(`<p>A1</p><table><tr ${BB}><td>B1</td></tr><tr><td>B2</td></tr></table>`)).toEqual(['A1', 'B1 B2']);
    expect(pages(`<table><tr><td>A1</td></tr><tr ${BA}><td>A2</td></tr></table><p>C1</p>`)).toEqual(['A1 A2', 'C1']);
    // 最後の行のセルの最後の子の break-after
    expect(pages(`<table><tr><td>A1</td></tr><tr><td><p ${BA}>A2</p></td></tr></table><p>C1</p>`)).toEqual(['A1 A2', 'C1']);
  });

  it('左右のページの指定: right は白ページを挟んで 3 ページ目', () => {
    expect(pages(`<p>A1</p><table><tr><td><p style="break-before: right">B1</p></td></tr></table>`)).toEqual(['A1', '', 'B1']);
  });

  it('1 度だけ区切る (表・行・セルの中身の区切りが同じ所なら、白ページを入れない)', () => {
    expect(pages(`<p>A1</p><table ${BB}><tr ${BB}><td><p ${BB}>B1</p></td></tr></table>`)).toEqual(['A1', 'B1']);
    expect(pages(`<table><tr><td>A1</td></tr><tr ${BB}><td><p ${BB}>B1</p></td></tr></table>`)).toEqual(['A1', 'B1']);
    // 左右の指定は、後ろの要素 (セルの中身) の値が勝つ (§4.3)
    expect(pages(`<p>A1</p><table><tr style="break-before: right"><td><p style="break-before: left">B1</p></td></tr></table>`)).toEqual(['A1', 'B1']);
  });

  it('見出し (caption) があるときは、本体の最初の行の前の区切りは、見出しと本体の間', () => {
    expect(pages(`<p>A1</p><table><caption>CAP</caption><tr ${BB}><td>B1</td></tr></table>`)).toEqual(['A1 CAP', 'B1']);
    expect(pages(`<p>A1</p><table><caption>CAP</caption><thead><tr><td>H</td></tr></thead><tbody><tr ${BB}><td>B1</td></tr></tbody></table>`)).toEqual(['A1 CAP', 'H B1']);
  });

  it('繰り返す thead があるときは、本体の最初の行 (tr・tbody・セルの最初の子) の前の区切りは、表の前 (見出しだけのページを作らない)', () => {
    const H = '<thead><tr><td>H</td></tr></thead>';
    expect(pages(`<p>A1</p><table>${H}<tbody><tr><td><p ${BB}>B1</p></td></tr></tbody></table>`)).toEqual(['A1', 'H B1']);
    expect(pages(`<p>A1</p><table>${H}<tbody><tr ${BB}><td>B1</td></tr></tbody></table>`)).toEqual(['A1', 'H B1']);
    expect(pages(`<p>A1</p><table>${H}<tbody ${BB}><tr><td>B1</td></tr></tbody></table>`)).toEqual(['A1', 'H B1']);
    expect(pages(`<p>A1</p><table>${H}<tbody><tr style="break-before: right"><td>B1</td></tr></tbody></table>`)).toEqual(['A1', '', 'H B1']);
    // 表がページの先頭にあれば、区切らない (前に中身が無い)
    expect(pages(`<table>${H}<tbody><tr ${BB}><td>B1</td></tr></tbody></table>`)).toEqual(['H B1']);
    // 本体の 2 番目より後ろの行の前は、これまでどおり見出しを繰り返して区切る
    expect(pages(`<p>A1</p><table>${H}<tbody><tr><td>B1</td></tr><tr ${BB}><td>B2</td></tr></tbody></table>`)).toEqual(['A1 H B1', 'H B2']);
  });

  it('セルの最初の子の break-before: avoid は、行の前の区切りに伝わり、表の前にも伝わる', () => {
    // x は 1 ページ目の最後の行に入るが、表の行は入らない。行の前を分けないので、x も次のページへ
    expect(pages(`<div style="height: 160pt">f</div><p>x</p><table><tr><td><p style="break-before: avoid">a</p></td></tr></table>`)).toEqual(['f', 'x a']);
  });
});

describe('行のまとまり (thead・tbody・tfoot) の break-*', () => {
  it('tbody の break-before・break-after (2 番目の tbody・display: table-row-group も)', () => {
    expect(pages(`<p>A1</p><table><tbody ${BB}><tr><td>B1</td></tr></tbody></table>`)).toEqual(['A1', 'B1']);
    expect(pages(`<table><tbody><tr><td>A1</td></tr></tbody><tbody ${BB}><tr><td>B1</td></tr></tbody></table>`)).toEqual(['A1', 'B1']);
    expect(pages(`<table><tbody ${BA}><tr><td>A1</td></tr></tbody></table><p>C1</p>`)).toEqual(['A1', 'C1']);
    expect(pages(`<table><tbody ${BA}><tr><td>A1</td></tr></tbody><tbody><tr><td>C1</td></tr></tbody></table>`)).toEqual(['A1', 'C1']);
    expect(pages(`<table><tbody><tr><td>A1</td></tr></tbody><div style="display: table-row-group; break-before: page"><tr><td>B1</td></tr></div></table>`.replace('<tr><td>B1</td></tr>', '<div style="display: table-row"><div style="display: table-cell">B1</div></div>'))).toEqual(['A1', 'B1']);
  });

  it('thead の break-before・tfoot の break-after は、表の前後', () => {
    expect(pages(`<p>A1</p><table><thead ${BB}><tr><td>H1</td></tr></thead><tbody><tr><td>B1</td></tr></tbody></table>`)).toEqual(['A1', 'H1 B1']);
    expect(pages(`<table><tbody><tr><td>A1</td></tr></tbody><tfoot ${BA}><tr><td>A2</td></tr></tfoot></table><p>C1</p>`)).toEqual(['A1 A2', 'C1']);
  });

  it('tbody の break-inside: avoid は、まとまりの行を分けない', () => {
    const rows = '<tr><td>R1</td></tr><tr><td>R2</td></tr><tr><td>R3</td></tr>';
    expect(pages(`<div style="height: 150pt">f</div><table><tbody>${rows}</tbody></table>`)).toEqual(['f R1 R2', 'R3']);
    expect(pages(`<div style="height: 150pt">f</div><table><tbody style="break-inside: avoid">${rows}</tbody></table>`)).toEqual(['f', 'R1 R2 R3']);
  });
});

describe('flex の行・grid の行: 項目の区切りは、行の前後の区切り (Flexbox 1 §12・Grid 2 §12)', () => {
  const g = 'display: grid; grid-template-columns: 1fr 1fr';
  it('flex の行の最初の項目の break-before は、行ごと (容器ごと) 次のページへ', () => {
    expect(pages(`<p>A1</p><div style="display: flex"><div ${BB}>B1</div><div>B2</div></div>`)).toEqual(['A1', 'B1 B2']);
    // 項目の最初の子
    expect(pages(`<p>A1</p><div style="display: flex"><div><p ${BB}>B1</p></div><div>B2</div></div>`)).toEqual(['A1', 'B1 B2']);
  });

  it('grid の 2 番目の項目の break-before も、その行ごと', () => {
    expect(pages(`<p>A1</p><div style="${g}"><div>B1</div><div ${BB}>B2</div></div>`)).toEqual(['A1', 'B1 B2']);
    expect(pages(`<div style="${g}"><div>A1</div><div>A2</div><div>B1</div><div ${BB}>B2</div></div>`)).toEqual(['A1 A2', 'B1 B2']);
  });

  it('項目の break-after は、行の後ろの区切り (最後の行なら容器の後ろ)', () => {
    expect(pages(`<div style="display: flex"><div>A1</div><div ${BA}>A2</div></div><p>C1</p>`)).toEqual(['A1 A2', 'C1']);
    expect(pages(`<div style="${g}"><div ${BA}>A1</div><div>A2</div><div>C1</div><div>C2</div></div>`)).toEqual(['A1 A2', 'C1 C2']);
    expect(pages(`<div style="display: grid"><div ${BA}>A1</div><div>C1</div></div>`)).toEqual(['A1', 'C1']);
    expect(pages(`<div style="display: flex; flex-wrap: wrap"><div style="width: 50%; break-after: page">A1</div><div style="width: 50%">A2</div><div style="width: 50%">C1</div></div>`)).toEqual(['A1 A2', 'C1']);
  });

  it('項目の break-inside: avoid は、項目を分けない', () => {
    const tall = 'L1<br>L2<br>L3<br>L4<br>L5';
    expect(pages(`<div style="height: 150pt">f</div><div style="display: flex"><div>${tall}</div><div>x</div></div>`)).toEqual(['f L1 L2 x', 'L3 L4 L5']);
    expect(pages(`<div style="height: 150pt">f</div><div style="display: flex"><div style="break-inside: avoid">${tall}</div><div>x</div></div>`)).toEqual(['f', 'L1 L2 L3 L4 L5 x']);
  });

  it('最後の項目の break-after: avoid は、容器の後ろに伝わる', () => {
    expect(pages(`<div style="height: 160pt">f</div><div style="display: flex"><div>x</div></div><p>a</p>`)).toEqual(['f x', 'a']);
    expect(pages(`<div style="height: 160pt">f</div><div style="display: flex"><div style="break-after: avoid">x</div></div><p>a</p>`)).toEqual(['f', 'x a']);
  });

  it('flex の column の項目の区切りは、前と同じ', () => {
    expect(pages(`<div style="display: flex; flex-direction: column"><div>A1</div><div ${BB}>B1</div></div>`)).toEqual(['A1', 'B1']);
  });
});

describe('段組の中のページの区切りは、段の区切りも兼ねる (§4.3)', () => {
  const mc = (inner: string) => `<div style="column-count: 2; column-gap: 0">${inner}</div>`;
  it('段組の中の break-before: page は、次のページの最初の段から', () => {
    const r = layout(mc(`<p>F0</p><p>F1</p><p ${BB}>B0</p>`));
    expect(r.pages).toEqual(['F0 F1', 'B0']);
    expect(r.lines.find((l) => l.text === 'B0')!.x).toBeCloseTo(10, 1);
  });

  it('入れ子の段組の中の break-before: page は、次のページへ送り、はみ出しの警告を出さない', async () => {
    const L = (p: string) => [0, 1, 2].map((i) => `<p>${p}${i}</p>`).join('');
    const m = (inner: string) => `<div class="m">${inner}</div>`;
    const css = '@page { size: 200pt 200pt; margin: 10pt; @bottom-center { content: none } } body { margin: 0; font-size: 8pt } p { margin: 0 } .m { columns: 2; column-gap: 10pt }';
    const html = `<!DOCTYPE html><html><head><title>t</title><style>${css}</style></head><body>${m(`${L('A')}${m(`${L('N')}<p ${BB}>B0</p>${L('B')}`)}`)}<p>C</p></body></html>`;
    const r = await typeset(html, { name: 't.html', loadFont: loadCachedFont });
    const textOf = (a: Area): string => (a.type === 'glyph' ? a.text : childrenOf(a).map(textOf).join(''));
    expect(r.areaTree.sheets.map((sh) => textOf(sh.page as unknown as Area))).toEqual(['A0A1A2N0N1N2', 'B0B0B1B2C']);
    expect(r.warnings).toEqual([]);
  });

  it('段組の最初の子の break-before・最後の子の break-after は、段組の前後', () => {
    expect(pages(`<p>T0</p>${mc(`<p ${BB}>A0</p><p>A1</p>`)}`)).toEqual(['T0', 'A0 A1']);
    expect(pages(`${mc(`<p>A0</p><p ${BA}>A1</p>`)}<p>C0</p>`)).toEqual(['A0 A1', 'C0']);
  });

  it('right: 白ページを挟んで 3 ページ目 (右ページ) の最初の段から。警告を出さない', () => {
    const r = layout(mc(`<p>F0</p><p style="break-before: right">B0</p>`));
    expect(r.pages).toEqual(['F0', '', 'B0']);
    expect(r.warnings.filter((w) => /収まりません/.test(w))).toEqual([]);
  });

  it('column-span: all の要素の break-before: page', () => {
    expect(pages(mc(`<p>A0</p><h2 style="column-span: all; break-before: page">S</h2><p>B0</p>`))).toEqual(['A0', 'S B0']);
    expect(pages(mc(`<p>A0</p><h2 style="column-span: all; break-after: page">S</h2><p>B0</p>`))).toEqual(['A0 S', 'B0']);
  });

  it('段の区切り (column) は、前と同じ (同じページの次の段)', () => {
    const r = layout(mc(`<p>F0</p><p style="break-before: column">B0</p>`));
    expect(r.pages).toEqual(['F0 B0']);
    expect(r.lines.find((l) => l.text === 'B0')!.x).toBeCloseTo(100, 1);
  });
});

describe('釣り合わせる段組は、ページの残りの高さを超えない', () => {
  const para = (k: number, n: number) => Array.from({ length: n }, (_, j) => `${k}x${j}`).join('<br>');
  it('分けられない塊が段の境目に来ても、段の高さはページの高さまで (塊は次の段へ)', () => {
    for (const mid of [`<p style="orphans: 3">${para(2, 4)}</p>`, `<div style="break-inside: avoid">${para(2, 4)}</div>`]) {
      const r = layout(`<div style="column-count: 2; column-gap: 0"><p>${para(1, 13)}</p>${mid}<p>${para(3, 11)}</p></div>`);
      expect(r.pages.length).toBe(1);
      // どの行も本文の領域 (下端 190pt) の中
      expect(Math.max(...r.lines.map((l) => l.y + l.h))).toBeLessThanOrEqual(190 + 0.01);
      expect(r.warnings.filter((w) => /溢れ|収まり/.test(w))).toEqual([]);
      // 1 段目は 13 行、塊は 2 段目の先頭
      expect(r.lines.filter((l) => l.x < 95).length).toBe(13);
      expect(r.lines.find((l) => l.text === '2x0')!.x).toBeCloseTo(100, 1);
    }
  });
});

describe('同じ区切りの所の左右のページの指定は、後ろの要素の値が勝つ (§4.3)', () => {
  it('前の箱の break-after と、次の箱の break-before', () => {
    expect(pages(`<p style="break-after: right">A1</p><p style="break-before: left">B1</p>`)).toEqual(['A1', 'B1']);
    expect(pages(`<p style="break-after: left">A1</p><p style="break-before: right">B1</p>`)).toEqual(['A1', '', 'B1']);
    expect(pages(`<div><p style="break-after: right">A1</p></div><div><p style="break-before: left">B1</p></div>`)).toEqual(['A1', 'B1']);
  });

  it('親の break-before と、最初の子の break-before', () => {
    expect(pages(`<p>A1</p><div style="break-before: right"><p style="break-before: left">B1</p></div>`)).toEqual(['A1', 'B1']);
    expect(pages(`<p>A1</p><div style="break-before: left"><p style="break-before: right">B1</p></div>`)).toEqual(['A1', '', 'B1']);
  });

  it('同じ向き・page との組み合わせは、前と同じ (1 度だけ)', () => {
    expect(pages(`<p style="break-after: right">A1</p><p style="break-before: right">B1</p>`)).toEqual(['A1', '', 'B1']);
    expect(pages(`<p style="break-after: page">A1</p><p style="break-before: left">B1</p>`)).toEqual(['A1', 'B1']);
    expect(pages(`<p>A1</p><section style="break-before: page"><h2 style="break-before: right">B1</h2></section>`)).toEqual(['A1', '', 'B1']);
  });
});

describe('page (名前付きのページ) を、切り替えられない箱に書いたら、未対応として知らせる', () => {
  const css = '@page wide { size: 300pt 200pt }';
  it('リストの項目の page は、ページを切り替える', () => {
    const r = layout(`<ul><li>A1</li><li style="page: wide">B1</li></ul>`, css);
    expect(r.pages).toEqual(['• A1', '• B1']);
    expect(r.widths.map(Math.round)).toEqual([200, 300]);
    // 記号の無いリスト・後ろの項目で、もとの名前に戻る
    const n = layout(`<ul style="list-style: none"><li>A1</li><li style="page: wide">B1</li><li>C1</li></ul>`, css);
    expect(n.pages).toEqual(['A1', 'B1', 'C1']);
    expect(n.widths.map(Math.round)).toEqual([200, 300, 200]);
  });

  it('flex・grid の項目・段組の中・セルの中の page は、黙って無視しない', () => {
    for (const body of [
      `<div style="display: flex"><div>A1</div><div style="page: wide">B1</div></div>`,
      `<div style="display: grid"><div style="page: wide">B1</div></div>`,
      `<div style="column-count: 2"><p>A1</p><p style="page: wide">B1</p></div>`,
      `<table><tr><td><p style="page: wide">B1</p></td></tr></table>`,
    ]) {
      const r = layout(body, css);
      expect(Object.keys(r.report.unsupported).some((k) => /^page/.test(k)), body).toBe(true);
    }
  });
});
