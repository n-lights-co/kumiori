/**
 * 組むときに測る flex の項目の幅 (HTM-69) の、残りの確かめ:
 *  - target-text() (CSS GCPM 3 §6.2): 組むまで字の決まらない中身の項目も、組むときに測る (HTM-22 の残り)
 *  - 縦書きの flex の容器: 主軸は縦。項目の大きさ (高さ) を組むときに測り、入りきらなければ縮める (Flexbox 1 §9.7・CSS Writing Modes 3)
 *
 * テストの書体は Noto Sans JP。用紙は 300pt × 300pt、余白 0
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

type G = { text: string; x: number; y: number; w: number; h: number; page: number };
type N = { type: string; text?: string; x?: number; y?: number; width?: number; height?: number; children?: N[] };
async function glyphs(css: string, body: string): Promise<G[]> {
  const r = await typeset(`<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} @page{size:300pt 300pt;margin:0} body{margin:0;font:10pt K} ${css}</style><body>${body}`, {
    loadFont,
    fetchImages: false,
    fetchStyles: false,
    files: [{ name: 'k.ttf', data }],
  });
  const out: G[] = [];
  r.areaTree.sheets.forEach((s, page) => {
    const visit = (a: N, ox: number, oy: number) => {
      const x = ox + (a.x ?? 0);
      const y = oy + (a.y ?? 0);
      if (a.type === 'glyph') out.push({ text: a.text ?? '', x, y, w: a.width ?? 0, h: a.height ?? 0, page });
      for (const c of a.children ?? []) visit(c, x, y);
    };
    visit(s.page.regionBody as unknown as N, 0, 0);
  });
  return out;
}

describe('target-text() の項目も、組むときに測る', () => {
  const css = 'a.f{display:flex} a.f::before{content:target-text(attr(href url))} a.f>span{flex:1;border-bottom:1pt dotted} a.f::after{content:target-counter(attr(href url),page)}';
  it('項目名が 1 行に収まり、ページ番号は右端', async () => {
    const g = (await glyphs(css, '<a class="f" href="#s1"><span></span></a><h2 id="s1" style="break-before:page">ecoモードの使い方</h2>')).filter((x) => x.page === 0);
    const title = g.filter((x) => x.text !== '2');
    expect(new Set(title.map((x) => x.y.toFixed(1))).size).toBe(1);
    expect(title.map((x) => x.text).join('')).toBe('ecoモードの使い方');
    const num = g.find((x) => x.text === '2')!;
    expect(num.x + num.w).toBeGreaterThan(299);
  });
  it('長い項目名は容器の幅の中で折り返し、ページ番号は右端に残る', async () => {
    const g = (await glyphs(css, '<a class="f" href="#s1"><span></span></a><h2 id="s1" style="break-before:page">' + 'ecoモードの使い方と設定 '.repeat(4) + '</h2>')).filter((x) => x.page === 0);
    const num = g.find((x) => x.text === '2')!;
    expect(num.x + num.w).toBeGreaterThan(299);
    for (const x of g.filter((x) => x !== num)) expect(x.x + x.w).toBeLessThanOrEqual(num.x + 0.01);
  });
});

describe('縦書きの flex の容器 (主軸は縦)', () => {
  const css = 'body{writing-mode:vertical-rl} .f{display:flex} .l{flex:1;border-left:1pt dotted}';
  it('項目名が 1 列に収まり、ページ番号は下端', async () => {
    const g = await glyphs(css, '<div class="f"><span>ecoモードの使い方</span><span class="l"></span><span>16</span></div>');
    const title = g.filter((x) => !/^[16]$/.test(x.text));
    expect(new Set(title.map((x) => x.x.toFixed(1))).size).toBe(1);
    const six = g.find((x) => x.text === '6')!;
    expect(six.y + six.h).toBeGreaterThan(299);
  });
  it('長い項目名は次の列に送られ、ページ番号は下端に残る (組むときに縮める)', async () => {
    const g = await glyphs(css, '<div class="f"><span>' + 'ecoモードの使い方と設定'.repeat(3) + '</span><span class="l"></span><span>16</span></div>');
    const one = g.find((x) => x.text === '1')!;
    const six = g.find((x) => x.text === '6')!;
    expect(six.y + six.h).toBeGreaterThan(299);
    const title = g.filter((x) => x !== one && x !== six);
    expect(new Set(title.map((x) => x.x.toFixed(1))).size).toBe(2);
    for (const x of title) expect(x.y + x.h).toBeLessThanOrEqual(one.y + 0.01);
  });
  it('要素の間の空白も数える (「第1章 概要」)', async () => {
    const g = await glyphs(css, '<div class="f"><span><b>第1章</b> <b>概要</b></span><span class="l"></span><span>16</span></div>');
    const title = g.filter((x) => x.y < 200);
    expect(title.map((x) => x.text).join('')).toBe('第1章 概要');
    expect(new Set(title.map((x) => x.x.toFixed(1))).size).toBe(1);
  });
});
