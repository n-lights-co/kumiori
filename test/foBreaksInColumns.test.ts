/**
 * XSL-FO の文書の、段組の中の強制の区切り・見出しと脚のある表の行の区切り・幅の指定の無い fo:inline-container の幅。
 *  - axf:column-count の block-container (アンテナハウスの拡張の段組) の中の break-before・break-after の page・even-page・odd-page は、
 *    ページの区切り (XSL 1.1 §7.20.1・§7.20.2・§4.8: その FO の最初 (最後) の領域を、ページの最初 (最後) に置く)。even-page・odd-page は、
 *    偶奇が合うまで白ページを挟む。column は次の段で、段の組の最初の段の頭 (span="all" の後ろ・コンテナの頭) では段を空けない
 *    (区切りの条件が、もう満たされている)。高さを決めたコンテナ (ページをまたげない) の中では、ページの区切りも段の区切り
 *  - region-body の column-count の段組の中も、同じ決まり
 *  - span="all" で分けたブロックの断片は、同じ FO の続き: id はどの断片にも残し (page-number-citation-last は最後の断片のページ。
 *    XSL 1.1 §6.6.12)、text-indent は最初の断片の最初の行だけ (§7.16.11)
 *  - fo:table-header のある表の本体の最初の行の break-before、fo:table-footer のある表の本体の最後の行の break-after は、区切らない
 *  - 幅の指定の無い fo:inline-container は、使える幅で組んだ最も長い行の幅 (fo:leader は行の残りいっぱい)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const fo = (body: string, size = 200) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="${size}pt" page-height="${size}pt" margin="10pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="8pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
const L = (p: string, n: number) => Array.from({ length: n }, (_, i) => `<fo:block>${p}${i}</fo:block>`).join('');
const cell = (t: string) => `<fo:table-cell><fo:block>${t}</fo:block></fo:table-cell>`;

/** ページごとの、行の字 (空白で区切る)。段の 2 段目 (ページの中央より右) の行の字には > を付ける (cols のとき) */
async function pages(src: string, compat: 'spec' | 'antenna' = 'spec', cols = false) {
  const r = await typeset(src, { name: 't.fo', loadFont: loadCachedFont, compat });
  const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
  const out = r.areaTree.sheets.map((sh) => {
    const toks: string[] = [];
    const rec = (a: AreaNode, ox: number) => {
      const x = ox + ((a as unknown as { x?: number }).x ?? 0);
      if (a.type === 'line') {
        const t = textOf(a).trim();
        if (t) toks.push((cols && x >= (sh.width ?? 0) / 2 ? '>' : '') + t);
        return;
      }
      for (const c of childrenOf(a)) rec(c, x);
    };
    rec(sh.page as unknown as AreaNode, 0);
    return toks.join(' ');
  });
  return { pages: out };
}

describe('XSL-FO の段組 (axf:column-count) の中の強制の区切り', () => {
  const bc = (inner: string, attrs = '') => `<fo:block-container axf:column-count="2"${attrs}>${inner}</fo:block-container>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`page・even-page・odd-page・span="all"・break-after は、ページの区切り (${compat})`, async () => {
      expect((await pages(fo(`<fo:block>A0</fo:block>${bc(`${L('A', 3)}<fo:block break-before="page">B0</fo:block>${L('B', 3)}`)}`), compat)).pages).toEqual(['A0 A0 A1 A2', 'B0 B0 B1 B2']);
      // 1 ページ目の次の偶数のページは 2 ページ目。奇数のページは、白ページ (2 ページ目) を挟んで 3 ページ目
      expect((await pages(fo(`<fo:block>A0</fo:block>${bc(`${L('A', 3)}<fo:block break-before="even-page">B0</fo:block>${L('B', 3)}`)}`), compat)).pages).toEqual(['A0 A0 A1 A2', 'B0 B0 B1 B2']);
      expect((await pages(fo(`<fo:block>A0</fo:block>${bc(`${L('A', 3)}<fo:block break-before="odd-page">B0</fo:block>${L('B', 3)}`)}`), compat)).pages).toEqual(['A0 A0 A1 A2', '', 'B0 B0 B1 B2']);
      expect((await pages(fo(`${bc(`${L('A', 3)}<fo:block break-after="page">A9</fo:block>${L('B', 3)}`)}<fo:block>C</fo:block>`), compat)).pages).toEqual(['A0 A1 A2 A9', 'B0 B1 B2 C']);
      expect((await pages(fo(bc(`${L('A', 5)}<fo:block span="all" break-before="page">S</fo:block>${L('B', 5)}`)), compat)).pages).toEqual(['A0 A1 A2 A3 A4', 'S B0 B1 B2 B3 B4']);
      expect((await pages(fo(bc(`${L('A', 5)}<fo:block span="all" break-after="page">S</fo:block>${L('B', 5)}`)), compat)).pages).toEqual(['A0 A1 A2 A3 A4 S', 'B0 B1 B2 B3 B4']);
      // 段組の中の表の行の even-page
      const t = `<fo:table><fo:table-body><fo:table-row>${cell('A9')}</fo:table-row><fo:table-row break-before="even-page">${cell('B1')}</fo:table-row></fo:table-body></fo:table>`;
      expect((await pages(fo(bc(`${L('A', 3)}${t}${L('B', 3)}`)), compat)).pages).toEqual(['A0 A1 A2 A9', 'B1 B0 B1 B2']);
    });
  }

  it('区切りの前の段の組は釣り合わせず、ページの最後の段の組は釣り合わせる', async () => {
    const r = await pages(fo(bc(`${L('A', 6)}<fo:block break-before="page">B0</fo:block>${L('B', 5)}`)), 'spec', true);
    expect(r.pages).toEqual(['A0 A1 A2 A3 A4 A5', 'B0 B0 B1 >B2 >B3 >B4']);
  });

  it('最初の子の break-before・最後の子の break-after のページの区切りは、コンテナの前・後ろ (入れ子のブロックの最初の子も 1 度だけ)', async () => {
    expect((await pages(fo(`<fo:block>T</fo:block>${bc(`<fo:block break-before="page">A0</fo:block>${L('B', 2)}`)}`))).pages).toEqual(['T', 'A0 B0 B1']);
    expect((await pages(fo(`<fo:block>T</fo:block>${bc(`<fo:block break-before="page"><fo:block break-before="page">A0</fo:block></fo:block>${L('B', 2)}`)}`))).pages).toEqual(['T', 'A0 B0 B1']);
    expect((await pages(fo(`${bc(`${L('A', 2)}<fo:block break-after="page">A9</fo:block>`)}<fo:block>C</fo:block>`))).pages).toEqual(['A0 A1 A9', 'C']);
  });

  it('段の区切り (column) は、段の組の最初の段の頭では段を空けない (span="all" の後ろ・入れ子の span・コンテナの頭)', async () => {
    for (const s of ['<fo:block span="all">S</fo:block>', '<fo:block span="all"></fo:block>']) {
      const r = await pages(fo(bc(`${L('A', 4)}${s}<fo:block break-before="column">X</fo:block>${L('B', 3)}`)), 'spec', true);
      expect(r.pages[0]).toMatch(/ X B0 >B1 >B2$/);
    }
    // 入れ子のブロックの中の span="all" も、コンテナの幅に置いて、段の組を分ける (アンテナハウスの見本と同じ)
    const nested = await pages(fo(bc(`<fo:block>${L('A', 4)}<fo:block span="all">S</fo:block><fo:block break-before="column">X</fo:block>${L('B', 3)}</fo:block>`)), 'spec', true);
    expect(nested.pages).toEqual(['A0 A1 >A2 >A3 S X B0 >B1 >B2']);
    expect((await pages(fo(`<fo:block>T</fo:block>${bc(`<fo:block break-before="column">X</fo:block>${L('B', 3)}`)}`), 'spec', true)).pages).toEqual(['T X B0 >B1 >B2']);
  });

  it('ページをまたぐ段組の span="all" の break-before="page" は、その前の段の組を釣り合わせず、span をコンテナの幅で次のページに置く', async () => {
    const r = await pages(fo(bc(`${L('A', 40)}<fo:block span="all" break-before="page">S</fo:block>${L('B', 4)}`)), 'spec', true);
    expect(r.pages).toHaveLength(3);
    // 2 ページ目の段の組 (A の残り) は、1 段目から順に埋める
    expect(r.pages[1]).toMatch(/^A\d+( A\d+)*$/);
    expect(r.pages[2]).toBe('S B0 B1 >B2 >B3');
  });

  it('高さを決めたコンテナ (ページをまたげない) の中のページの区切りは、段の区切り (中身を消さない)', async () => {
    for (const k of ['page', 'odd-page']) {
      const r = await pages(fo(bc(`${L('A', 3)}<fo:block break-before="${k}">X</fo:block>${L('B', 2)}`, ' height="60pt"')), 'spec', true);
      expect(r.pages).toEqual(['A0 A1 A2 >X >B0 >B1']);
    }
  });
});

describe('XSL-FO の region-body の段組 (column-count) の中の強制の区切り', () => {
  const rb = (body: string) => fo(body).replace('<fo:region-body/>', '<fo:region-body column-count="2"/>');
  it('page・odd-page はページの区切り、column は span="all" の後ろの最初の段では段を空けない', async () => {
    expect((await pages(rb(`${L('A', 3)}<fo:block break-before="page">X</fo:block>${L('B', 2)}`))).pages).toEqual(['A0 A1 A2', 'X B0 B1']);
    expect((await pages(rb(`${L('A', 3)}<fo:block break-before="odd-page">X</fo:block>${L('B', 2)}`))).pages).toEqual(['A0 A1 A2', '', 'X B0 B1']);
    expect((await pages(rb(`${L('A', 4)}<fo:block span="all">S</fo:block><fo:block break-before="column">X</fo:block>${L('B', 3)}`), 'spec', true)).pages).toEqual(['A0 A1 >A2 >A3 S X B0 B1 B2']);
  });
});

describe('XSL-FO の見出し・脚のある表の、本体の最初の行の前・最後の行の後ろの区切り', () => {
  it('fo:table-header のある表の本体の最初の行の break-before・fo:table-footer のある表の本体の最後の行の break-after では区切らない', async () => {
    const head = `<fo:table-header><fo:table-row>${cell('H')}</fo:table-row></fo:table-header>`;
    const foot = `<fo:table-footer><fo:table-row>${cell('F')}</fo:table-row></fo:table-footer>`;
    expect((await pages(fo(`<fo:block>A</fo:block><fo:table>${head}${foot}<fo:table-body><fo:table-row break-before="page">${cell('B1')}</fo:table-row></fo:table-body></fo:table>`))).pages).toEqual(['A H B1 F']);
    expect((await pages(fo(`<fo:table>${foot}<fo:table-body><fo:table-row>${cell('B1')}</fo:table-row><fo:table-row break-after="page">${cell('B2')}</fo:table-row></fo:table-body></fo:table><fo:block>C</fo:block>`))).pages).toEqual(['B1 B2 F C']);
  });
});

describe('XSL-FO の幅の指定の無い fo:inline-container', () => {
  it('fo:leader は、使える幅で組んだ行の残りいっぱい (中身の幅の 1 行に縮めない)', async () => {
    const src = fo('<fo:block>before <fo:inline-container><fo:block>Chapter<fo:leader leader-pattern="dots"/>1</fo:block></fo:inline-container> after</fo:block>', 300);
    const r = await pages(src);
    // before・Chapter……1・after の 3 行 (容器は行の幅いっぱいなので、前後の字と同じ行に入らない)
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].split(' ')).toHaveLength(3);
    expect(r.pages[0]).toMatch(/^before Chapter\.{40,}1 after$/);
  });
});

describe('XSL-FO の段組の span="all" で分けたブロックの断片', () => {
  const rootFo = (body: string, tree = '') =>
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200pt" page-height="200pt" margin="10pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>${tree}<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="8pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
  const cite = (id: string) => `<fo:block>first=<fo:page-number-citation ref-id="${id}"/> last=<fo:page-number-citation-last ref-id="${id}"/></fo:block>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`id は、どの断片にも残す: page-number-citation は最初の断片、page-number-citation-last は最後の断片のページ (${compat})`, async () => {
      // 包むブロックの id (span="all" の前後で分ける。後ろの断片は 3 ページ目まで続く)
      const inner = `${cite('X')}<fo:block-container axf:column-count="2"><fo:block id="X">${L('A', 30)}<fo:block span="all">HEAD</fo:block>${L('B', 60)}</fo:block></fo:block-container>`;
      const tree = `<fo:bookmark-tree><fo:bookmark internal-destination="X"><fo:bookmark-title>X</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>`;
      const r = await typeset(rootFo(`<fo:block><fo:basic-link internal-destination="X">go</fo:basic-link></fo:block>${inner}`, tree), { name: 't.fo', loadFont: loadCachedFont, compat });
      const p = (await pages(rootFo(inner), compat)).pages;
      expect(p.length).toBe(3);
      expect(p[0]).toMatch(/^first=1 last=3 /);
      expect(p[2]).toMatch(/B59$/);
      // リンクの飛び先・しおりは、最初の断片のページ (1 ページ目)
      expect(r.areaTree.destinations?.X).toBe(0);
      expect(r.areaTree.bookmarks?.[0].sheet).toBe(0);
      // コンテナ自身の id (分けた段の組の断片)
      const cont = `${cite('C')}<fo:block-container id="C" axf:column-count="2">${L('A', 30)}<fo:block span="all">HEAD</fo:block>${L('B', 60)}</fo:block-container>`;
      expect((await pages(rootFo(cont), compat)).pages[0]).toMatch(/^first=1 last=3 /);
    });
    it(`text-indent は、最初の断片の最初の行だけ (後ろの断片の行は字下げしない。中の子のブロックは字下げする) (${compat})`, async () => {
      const src = rootFo(`<fo:block-container axf:column-count="2"><fo:block text-indent="20pt">AAA aaa<fo:block span="all">HEAD</fo:block>BBB bbb<fo:block>CCC ccc</fo:block></fo:block>${'<fo:block>x</fo:block>'.repeat(4)}</fo:block-container>`);
      const r = await typeset(src, { name: 't.fo', loadFont: loadCachedFont, compat });
      const xs: Record<string, number> = {};
      const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
      const rec = (a: AreaNode, ox: number) => {
        const x = ox + ((a as unknown as { x?: number }).x ?? 0);
        if (a.type === 'glyph') {
          const t = textOf(a);
          if (/^[ABCH]$/.test(t) && xs[t] === undefined) xs[t] = x;
          return;
        }
        for (const c of childrenOf(a)) rec(c, x);
      };
      rec(r.areaTree.sheets[0].page as unknown as AreaNode, 0);
      expect(Math.round(xs.A)).toBe(30);
      expect(Math.round(xs.H)).toBe(30);
      expect(Math.round(xs.B)).toBe(10);
      expect(Math.round(xs.C)).toBe(30);
    });
  }
});
