/**
 * 段組の中の絶対配置の箱は、1 度だけ置く。
 * 段組を釣り合わせる試し組み (段の高さを変えて組み直す) が、絶対配置の箱をページの置き場に積んでいて、本番の組みの箱と合わせて、
 * 同じ箱が何度も描かれていた (XSL-FO の axf:column-count の block-container の中の absolute-position="absolute" の箱)。
 * 試し組みの箱は、ページに置かない (XSL 1.1 §7.6.1: 絶対配置の箱は、その FO が作る 1 つの領域)。
 * 標準の段組 (region-body の column-count)・表のセル・float の中・HTML の段組 (columns) の中の position: absolute も確かめる。
 * 分けない指定のブロックのために、段組のコンテナを組み直すとき (置いてみて、置く場所に入らないとき) も、1 度目の組みの箱を残さない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const text = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const fo = (body: string, region = '') =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body${region}/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const abs = `<fo:block-container absolute-position="absolute" top="150pt" left="40pt" width="80pt"><fo:block>ABSBOX</fo:block></fo:block-container>`;

/** 組んだ領域の木の中の、字の並びが ABSBOX の行の数 (ページごと) */
async function count(src: string, opts: Record<string, unknown> = {}): Promise<number[]> {
  const r = await typeset(src, { loadFont: loadCachedFont, ...opts });
  const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
  return r.areaTree.sheets.map((sh) => {
    let n = 0;
    const rec = (a: AreaNode) => {
      if (a.type === 'line') {
        if (textOf(a).includes('ABSBOX')) n++;
        return;
      }
      for (const c of childrenOf(a)) rec(c);
    };
    rec(sh.page as unknown as AreaNode);
    return n;
  });
}

describe('段組の中の絶対配置の箱は 1 度だけ置く', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`axf:column-count の block-container の中 (1 ページに収まる・ページをまたぐ) (${compat})`, async () => {
      const bc = (n: number) => `<fo:block-container axf:column-count="2" axf:column-gap="10pt"><fo:block>${text(n, 'a')}</fo:block>${abs}<fo:block>${text(n, 'b')}</fo:block></fo:block-container>`;
      expect(await count(fo(bc(20)), { name: 't.fo', compat })).toEqual([1]);
      // ページをまたぐ段組 (layoutColumnsPaged の試し組み)。箱は、箱を見つけたページに 1 つ
      const many = await count(fo(bc(300)), { name: 't.fo', compat });
      expect(many.reduce((a, b) => a + b, 0)).toBe(1);
      // span="all" で段の組を分けるもの
      expect(await count(fo(`<fo:block-container axf:column-count="2"><fo:block>${text(20, 'a')}</fo:block>${abs}<fo:block span="all">S</fo:block><fo:block>${text(20, 'b')}</fo:block></fo:block-container>`), { name: 't.fo', compat })).toEqual([1]);
    });
    it(`region-body の column-count・表のセル・float の中 (${compat})`, async () => {
      expect(await count(fo(`<fo:block>${text(20, 'a')}</fo:block>${abs}<fo:block>${text(20, 'b')}</fo:block>`, ' column-count="2"'), { name: 't.fo', compat })).toEqual([1]);
      const cell = `<fo:table width="100%"><fo:table-body><fo:table-row><fo:table-cell><fo:block>${text(10, 'a')}</fo:block>${abs}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
      expect(await count(fo(`<fo:block-container axf:column-count="2">${cell}<fo:block>${text(20, 'b')}</fo:block></fo:block-container>`), { name: 't.fo', compat })).toEqual([1]);
      const fl = `<fo:block><fo:float float="start"><fo:block-container width="60pt"><fo:block>F</fo:block>${abs}</fo:block-container></fo:float>${text(30, 'a')}</fo:block>`;
      expect(await count(fo(`<fo:block-container axf:column-count="2">${fl}<fo:block>${text(20, 'b')}</fo:block></fo:block-container>`), { name: 't.fo', compat })).toEqual([1]);
    });
  }
  it('HTML の段組 (columns) の中の position: absolute', async () => {
    const html = `<!doctype html><html><body><div style="columns:2; position:relative"><p>${text(40, 'a')}</p><div style="position:absolute; top:150pt; left:40pt">ABSBOX</div><p>${text(40, 'b')}</p></div></body></html>`;
    expect(await count(html, { name: 't.html' })).toEqual([1]);
    const html2 = `<!doctype html><html><body><div style="columns:2"><p>${text(40, 'a')}</p><div style="position:absolute; top:150pt; left:40pt">ABSBOX</div><p>${text(40, 'b')}</p></div></body></html>`;
    expect(await count(html2, { name: 't.html' })).toEqual([1]);
  });

  // 分けない指定のブロックを分けずに釣り合わせた段組の箱が、置く場所に入らず、段を低くして組み直すとき: 1 度目の組みの箱を残さない
  // (padding のある段組のコンテナ。ページの頭なので、次のページへ送らずに組み直す)
  const L = (n: number, p: string) => Array.from({ length: n }, (_, i) => `<fo:block>${p}${i}</fo:block>`).join('');
  const kt = (n: number) => `<fo:block keep-together.within-column="always">${L(n, 'K')}</fo:block>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`組み直す段組のコンテナの中 (${compat})`, async () => {
      const bc = (inner: string) => `<fo:block-container axf:column-count="2" axf:column-gap="12pt" padding="20pt">${inner}</fo:block-container>`;
      // keep は 20 行。段の取れる高さ (260 - 40) に入らないので、組み直して分ける
      expect(await count(fo(bc(abs + kt(20))), { name: 't.fo', compat })).toEqual([1]);
      expect(await count(fo(bc(kt(10) + abs + kt(20))), { name: 't.fo', compat })).toEqual([1]);
    });
  }
  for (const style of [undefined, 'ah'] as const) {
    it(`HTML の組み直す段組 (break-inside: avoid) の中の position: absolute (${style ?? '既定'})`, async () => {
      const ps = Array.from({ length: 20 }, (_, i) => `<p style="margin:0">K${i}</p>`).join('');
      const page = (body: string) => `<!doctype html><html><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif}</style></head><body>${body}</body></html>`;
      const box = (pos: string) => `<div style="columns:2;column-gap:12pt;padding:20pt 0${pos}"><div style="position:absolute;top:10pt;left:200pt">ABSBOX</div><div style="break-inside:avoid">${ps}</div></div>`;
      for (const pos of [';position:relative', '']) expect(await count(page(box(pos)), { name: 't.html', ...(style ? { style } : {}) })).toEqual([1]);
    });
  }
});
