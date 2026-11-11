/**
 * 句読点のぶら下げと回り込みの回帰テスト:
 *  - hanging-punctuation: allow-end (CSS Text 3 §8.2.1) の行末の句読点は、行の終わりの側に回り込み (CSS 2.1 §9.5) が食い込んでいる行では
 *    ぶら下げない (ぶら下げた字は行の箱の外に置かれる (§8.2) ので、回り込みの箱に重なる)。その行では詰めるか追い出す
 *  - 行の始めの側だけに回り込みがある行・回り込みの無い行は、これまでどおりぶら下げる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

interface Box { x: number; y: number; w: number; h: number }
/** 1 ページ目の、背景の色の付いた箱と、字 (ページの座標) */
function scan(tree: AreaTree) {
  const boxes: Box[] = [];
  const glyphs: Array<{ text: string; x: number; y: number; w: number }> = [];
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { backgroundColor?: string; text?: string; padding?: { left: number; top: number }; border?: { left?: { width: number }; top?: { width: number } } };
    if (b.backgroundColor) boxes.push({ x, y, w: a.width, h: a.height });
    if (a.type === 'glyph') glyphs.push({ text: b.text ?? '', x, y, w: a.width });
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
  };
  rec(tree.sheets[0].page as unknown as Area, 0, 0);
  return { boxes, glyphs };
}
// 本文の幅は 280pt (用紙 400pt − 左右の余白 60pt)。字は 10pt
const doc = (body: string) =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 40pt 60pt } body { margin: 0; font-size: 10pt; line-height: 2 } p { margin: 0; text-indent: 0; text-align: justify; hanging-punctuation: allow-end } .f { width: 40pt; height: 15pt; background-color: #ccc } </style></head><body>${body}</body></html>`;
const typeset = async (body: string) => scan((await typesetHtml(doc(body), { loadFont: loadCachedFont })).areaTree);
// 24 字 (240pt) の後に句点。回り込みの横の 240pt の行では、句点が行に収まらない
const text = 'あ'.repeat(24) + '。' + 'い'.repeat(40);

describe('行の終わりの側に回り込みがある行では、句読点をぶら下げない', () => {
  it('float: right の横の行: 句点は回り込みの箱に重ならない', async () => {
    const { boxes, glyphs } = await typeset(`<div class="f" style="float: right"></div><p>${text}</p>`);
    const f = boxes[0];
    expect(f.x).toBeCloseTo(300, 1);
    const beside = glyphs.filter((g) => g.y < f.y + f.h);
    expect(beside.length).toBeGreaterThan(0);
    for (const g of beside) expect(g.x + g.w, g.text).toBeLessThanOrEqual(f.x + 0.01);
    // 句点は、この行に詰めて収めるか、次の行へ送る (行頭に来ないよう前の字といっしょに)。どちらでも本文の幅の外へは出ない
    const stop = glyphs.find((g) => g.text === '。')!;
    expect(stop.x + stop.w).toBeLessThanOrEqual(300.01);
  });

  it('float: left の横の行 (行の終わりの側は空いている): これまでどおり、句点を本文の幅の外へぶら下げる', async () => {
    const { glyphs } = await typeset(`<div class="f" style="float: left"></div><p>${text}</p>`);
    const stop = glyphs.find((g) => g.text === '。')!;
    // 行は x = 100〜340。句点は 340pt から外へぶら下がる
    expect(stop.x).toBeCloseTo(340, 1);
  });

  it('回り込みの無い行: これまでどおりぶら下げる', async () => {
    const { glyphs } = await typeset(`<p>${'あ'.repeat(28)}。${'い'.repeat(10)}</p>`);
    const stop = glyphs.find((g) => g.text === '。')!;
    expect(stop.x).toBeCloseTo(340, 1);
  });
});
