/**
 * 釣り合わせる段組 (CSS Multi-column 1 §7.1 の balance) の、最後の段落の後ろの余白 (margin-bottom・padding-bottom):
 * 最後の段が、その余白の分だけ前の段より長くても、行を前の段へ寄せて、段の行の数を崩さない (12・12・12 行を 13・13・10 行にしない)。
 * 余白は段組の箱の中のもので (CSS 2.1 §8.3.1・§10.6.7)、中身の終わりは区切りではないので切り詰めない (CSS Fragmentation 3 §5.2):
 * 箱の高さは 12 行と余白
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
});

const W = 'Text is set in three columns and flows from the left column to the right one. The heights of the columns are balanced. Weaving combines the warp and the weft. ';
/** 用紙 300pt 角・余白 20pt・行の高さ 12pt。3 段の段組に、36 行の段落を 1 つ置き、後ろに Z の段落を置く */
const html = (css: string, body = `<p>${W.repeat(4)}</p>`, cols = 3) =>
  `<!doctype html><html><head><style>@page{size:300pt 300pt;margin:20pt}body{margin:0;font-family:serif;font-size:10pt;line-height:12pt}${css}.z{margin:0}</style></head><body><div style="columns:${cols};column-gap:12pt">${body}</div><p class="z">Z</p></body></html>`;

/** 1 ページ目の、段ごとの行の数 (行の x で分ける) と、Z の行の上端 */
const columns = async (text: string, style?: string) => {
  const r = await typeset(text, { name: 't.html', loadFont: loadCachedFont, ...(style ? { style: style as 'weasyprint' } : {}) });
  const lines: Array<{ x: number; y: number; t: string }> = [];
  const textOf = (a: Area): string => (a.type === 'glyph' ? a.text : childrenOf(a).map(textOf).join(''));
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'line') {
      const t = textOf(a).trim();
      if (t) lines.push({ x, y, t });
      return;
    }
    for (const c of childrenOf(a)) rec(c, x + (a.border?.left?.width ?? 0) + (a.padding?.left ?? 0), y + (a.border?.top?.width ?? 0) + (a.padding?.top ?? 0));
  };
  rec(r.areaTree.sheets[0].page, 0, 0);
  const z = lines.find((l) => l.t === 'Z')!;
  const body = lines.filter((l) => l !== z && l.y < 280);
  const xs = [...new Set(body.map((l) => Math.round(l.x)))].sort((a, b) => a - b);
  return { counts: xs.map((x) => body.filter((l) => Math.round(l.x) === x).length), zTop: z.y, warnings: r.warnings };
};

describe('段組の最後の段落の後ろの余白で、段の行の数を崩さない', () => {
  it('margin-bottom (既定のスタイル): 12・12・12 行、箱の高さは 12 行と余白', async () => {
    const r = await columns(html('p{margin:0 0 10pt}'));
    expect(r.counts).toEqual([12, 12, 12]);
    expect(r.zTop).toBeCloseTo(20 + 144 + 10, 1);
  });
  it('padding-bottom: 12・12・12 行', async () => {
    const r = await columns(html('p{margin:0;padding-bottom:10pt}'));
    expect(r.counts).toEqual([12, 12, 12]);
    expect(r.zTop).toBeCloseTo(20 + 144 + 10, 1);
  });
  it('入れ子のブロックの最後の子の margin-bottom: 12・12・12 行', async () => {
    const r = await columns(html('p{margin:0 0 10pt}', `<div><p>${W.repeat(4)}</p></div>`));
    expect(r.counts).toEqual([12, 12, 12]);
  });
  it('既定の段落の余白 (1em 0) の weasyprint のスタイル: 12・12・12 行', async () => {
    const r = await columns(html(''), 'weasyprint');
    expect(r.counts).toEqual([12, 12, 12]);
  });
  it('45 行の段落: 15・15・15 行', async () => {
    const r = await columns(html('p{margin:0 0 10pt}', `<p>${W.repeat(5)}</p>`));
    expect(r.counts).toEqual([15, 15, 15]);
  });
});

/**
 * 釣り合わせる段組の高さを探すとき、1 段に組んだ高さを上限にして見つけた高さが、ページの残りの高さを超えたら、
 * 残りの高さを上限にして探し直す (CSS Multi-column 1 §7.1 の balance。超えると、段組がページより高くなり、下へはみ出す)。
 * 探し直さないと、1 段目に 16 行を詰め込み、最後の行がページの下へはみ出して、後ろの段落を次のページへ送ってしまう。
 */
describe('段組の釣り合わせで見つけた高さがページの残りを超えたら、残りの高さで探し直す', () => {
  const S = 'Text is set in columns and flows from the left column to the right one. The heights of the columns are balanced. ';
  /** 用紙 300pt 角・余白 20pt・行の高さ 12pt。80pt の箱の後ろに 2 段の段組 (8 行の段落 2 つと 55pt の箱)、その後ろに段落 2 つ */
  const text =
    `<!doctype html><html><head><style>@page{size:300pt 300pt;margin:20pt}body{margin:0;font-family:serif;font-size:10pt;line-height:12pt}.z{margin:0}</style></head><body>` +
    `<div style="height:80pt;background:#eee"></div>` +
    `<div style="columns:2;column-gap:10pt"><p style="orphans:3;widows:4">${S.repeat(2)}</p><p>${S.repeat(2)}</p>` +
    `<div style="height:55pt;background:#ccc;margin:4pt 0"></div></div>` +
    `<p class="z">ZZZ end</p><p class="z">ZZY after</p></body></html>`;

  it('11 行と 5 行 + 箱に分かれ、1 段目の最後の行はページの本文の下端 (280pt) を超えず、後ろの段落も 1 ページ目に入る', async () => {
    const r = await typeset(text, { name: 't.html', loadFont: loadCachedFont });
    const textOf = (a: Area): string => (a.type === 'glyph' ? a.text : childrenOf(a).map(textOf).join(''));
    /** ページごとの行 (位置・下端・字) */
    const linesOf = (page: Area) => {
      const lines: Array<{ x: number; y: number; bottom: number; t: string }> = [];
      const rec = (a: Area, ox: number, oy: number) => {
        const x = ox + a.x;
        const y = oy + a.y;
        if (a.type === 'line') {
          const t = textOf(a).trim();
          if (t) lines.push({ x, y, bottom: y + a.height, t });
          return;
        }
        for (const c of childrenOf(a)) rec(c, x + (a.border?.left?.width ?? 0) + (a.padding?.left ?? 0), y + (a.border?.top?.width ?? 0) + (a.padding?.top ?? 0));
      };
      rec(page, 0, 0);
      return lines;
    };
    const p1 = linesOf(r.areaTree.sheets[0].page);
    // 段組の中の行 (後ろの段落と、ページ番号の行を除く)
    const body = p1.filter((l) => !l.t.startsWith('ZZ') && !/^\d+$/.test(l.t));
    const xs = [...new Set(body.map((l) => Math.round(l.x)))].sort((a, b) => a - b);
    const cols = xs.map((x) => body.filter((l) => Math.round(l.x) === x));
    expect(cols.map((c) => c.length)).toEqual([11, 5]);
    expect(Math.max(...cols[0].map((l) => l.bottom))).toBeLessThanOrEqual(280 + 0.01);
    expect(p1.map((l) => l.t)).toEqual(expect.arrayContaining(['ZZZ end', 'ZZY after']));
    expect(r.warnings).toEqual([]);
  });
});
