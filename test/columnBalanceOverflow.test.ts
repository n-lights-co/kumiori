/**
 * 段組の釣り合わせ (段数に収まる最小の段の高さを試し組みで探す) で、空の段の先頭でも入らずにはみ出させた行のある高さを、収まるとみなさない。
 * 前は、平均の段の高さより高い行 (大きな行内の画像) のある段組で、その行より低い段の高さを選び、本番の組版で行が段からはみ出して
 * 「行がページに収まりません」と警告した (PostgreSQL の文書の 3 段組の索引)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

describe('段組の釣り合わせと、段より高い行', () => {
  it('平均の段の高さより高い画像の行があっても、段の高さはその行より低くならず、警告も出ない', async () => {
    const body = `<div class="c"><p>${'Word '.repeat(30)}</p><p><img src="${PNG}" style="width: 20pt; height: 140pt"></p><p>${'Word '.repeat(30)}</p></div>`;
    const r = await typesetHtml(`<!doctype html><html><head><style>@page { size: 160mm 200mm; margin: 10mm } p { margin: 0 } .c { columns: 3 }</style></head><body>${body}</body></html>`, {
      loadFont: loadCachedFont,
      style: 'browser',
    });
    expect(r.warnings.filter((w) => /収まり/.test(w))).toEqual([]);
    // 画像は、置かれた段の中に収まる (画像の下端は、段組の箱の下端より上)
    let img: { y: number; h: number } | undefined;
    let box: { y: number; h: number } | undefined;
    const rec = (a: AreaNode, oy: number, depth: number) => {
      const y = oy + a.y;
      if (a.type === 'image') img = { y, h: a.height };
      // 段組の箱 (段を子に持つ箱) は、本文の領域の最初の子
      if (depth === 3 && !box) box = { y, h: a.height };
      for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0), depth + 1);
    };
    rec(r.areaTree.sheets[0], 0, 0);
    expect(img).toBeDefined();
    expect(img!.y + img!.h).toBeLessThanOrEqual(box!.y + box!.h + 0.5);
  });
});
