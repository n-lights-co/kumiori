/**
 * 入れ子のリストの中身を、ページの終わりで分ける (XSL 1.1 §6.8・§4.8、CSS 2.1 §13.3.3)。
 * リストは記号の列と本文の列の表として組み、入れ子のリストは、外側の本文のセルの中の表になる。外側の行をページで分けるとき、
 * セルの中の流れで入れ子の表の行を分けるが、続きの断片の高さを、いまのページの残りで出していたので、続きの断片が、どれもその残りの高さで切られ、
 * 中のブロックを 1 つずつ別のページに置いていた (数行だけのページが続いた)。続きの断片は、次のページの高さいっぱいに置く。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf, DEFAULT_FONTS, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの、本文領域 (region-body) の中の行の数 */
function bodyLines(sheets: AreaNode[]): number[] {
  return sheets.map((s) => {
    let n = 0;
    const rec = (a: AreaNode, inBody: boolean) => {
      const body = inBody || a.type === 'region-body';
      if (a.type === 'line') {
        if (body) n++;
        return;
      }
      for (const c of childrenOf(a)) rec(c, body);
    };
    rec(s, false);
    return n;
  });
}

const A = 'あいうえおかきくけこ';
const lead = A.repeat(90);
const part = A.repeat(8);

const html = (inner: (body: string) => string) =>
  `<!doctype html><style>@page{size:A5;margin:15mm} body{font-size:10pt;line-height:1.6} ul{margin:0;padding-left:6pt} p{margin:0} div{margin:0}</style><p>${lead}</p>${inner(`${part}<p>x</p>${part}<p>y</p>${part}`)}`;

const fo = (nested: boolean) => {
  const blocks = [part, 'x', part, 'y', part].map((t) => `<fo:block>${t}</fo:block>`).join('');
  const list = (body: string) =>
    `<fo:list-block provisional-distance-between-starts="6pt"><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block/></fo:list-item-label><fo:list-item-body start-indent="body-start()">${body}</fo:list-item-body></fo:list-item></fo:list-block>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="15mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="1.6"><fo:block>${lead}</fo:block>${nested ? list(`<fo:block>${list(blocks)}</fo:block>`) : list(blocks)}</fo:flow></fo:page-sequence></fo:root>`;
};

const lines = async (src: string, kind: 'html' | 'fo') => {
  const r = await typeset(src, { kind, loadFont: loadCachedFont });
  expect(r.warnings).toEqual([]);
  return bodyLines(r.areaTree.sheets);
};

/**
 * 入れ子にしないときと同じページ数で、最初のページを、入れ子にしないとき (の 1 行の差の内) 以上に埋めている
 * (行の数は、記号のセルの行 (入れ子の段ごとに 1 つ) を含む。入れ子にすると本文の幅が狭くなるので、行の数は少し違ってよい)
 */
const expectFilled = (ls: number[], flat: number[]) => {
  expect(ls.length, `ページごとの行: ${ls.join(' ')}`).toBe(flat.length);
  expect(ls[0], `ページごとの行: ${ls.join(' ')}`).toBeGreaterThanOrEqual(flat[0] - 1);
};

describe('入れ子のリストの中身のページ分け', () => {
  it('HTML の ul > li > ul > li の中の字と段落は、入れ子にしないときと同じページに分ける', async () => {
    const flat = await lines(html((b) => `<ul><li>${b}</li></ul>`), 'html');
    const nested = await lines(html((b) => `<ul><li><ul><li>${b}</li></ul></li></ul>`), 'html');
    const deep = await lines(html((b) => `<ul><li><ul><li><ul><li>${b}</li></ul></li></ul></li></ul>`), 'html');
    expect(flat.length).toBe(2);
    for (const ls of [nested, deep]) expectFilled(ls, flat);
  }, 60_000);

  it('XSL-FO の入れ子の fo:list-block の中のブロックは、入れ子にしないときと同じページに分ける', async () => {
    const flat = await lines(fo(false), 'fo');
    const nested = await lines(fo(true), 'fo');
    expect(flat.length).toBe(2);
    expectFilled(nested, flat);
  }, 60_000);
});
