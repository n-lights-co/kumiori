/**
 * 段組の中の、分けない指定のブロックを、段の取れる高さに合わせて分けるか分けないかを決める (置く場所の残り)。
 * - 分けない指定 (XSL-FO の keep-together、HTML の break-inside: avoid) は、満たせなければ破る (XSL 1.1 §7.20.3、
 *   CSS Fragmentation 3 §3.3)。分けずに釣り合わせた段組の箱が、置く場所 (ページの残り・版面) に入らないときは、入る高さで分ける
 *   (段組の箱の padding・罫線、span="all" の上の高さ、中の脚注も、置く場所の残りに数える)
 * - 領域の頭で捨てる余白 (XSL 1.1 §4.3.1 の conditionality="discard") は、残りから引かない (捨てた後なら段に入るものは分けない)
 * (https://www.w3.org/TR/xsl11/・https://www.w3.org/TR/css-break-3/ 2026-11-19 取得)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページは 300pt 四方、余白 20pt (本文の高さは 260pt。21 行と少し)。字は 10pt、行の高さは 12pt。段の幅は 124pt (段間 12pt) */
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-family="serif" font-size="10pt" line-height="12pt" xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const L = (n: number, p = 'L') => Array.from({ length: n }, (_, i) => `<fo:block>${p}${i}</fo:block>`).join('');
const kt = (n: number, p = 'K') => `<fo:block keep-together.within-column="always">${L(n, p)}</fo:block>`;
const BC = (inner: string, a = '') => `<fo:block-container axf:column-count="2" axf:column-gap="12pt"${a ? ' ' + a : ''}>${inner}</fo:block-container>`;
const html = (body: string) =>
  `<!doctype html><html lang="en"><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif} p{margin:0} .c{columns:2;column-gap:12pt} .k{break-inside:avoid}</style></head><body>${body}</body></html>`;
const HL = (n: number, p = 'L') => Array.from({ length: n }, (_, i) => `<p>${p}${i}</p>`).join('');
const hk = (n: number, p = 'K') => `<div class="k">${HL(n, p)}</div>`;

interface Line { page: number; x: number; y: number; bottom: number; t: string }
async function lay(text: string, opts: Record<string, string>) {
  const r = await typeset(text, { name: opts.compat ? 't.fo' : 't.html', loadFont: loadCachedFont, ...opts } as never);
  const lines: Line[] = [];
  const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
  r.areaTree.sheets.forEach((s, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const n = a as unknown as { x?: number; y?: number; height?: number; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
      const x = ox + (n.x ?? 0);
      const y = oy + (n.y ?? 0);
      if (a.type === 'line') {
        const t = textOf(a).trim();
        if (t) lines.push({ page, x, y, bottom: y + (n.height ?? 0), t });
        return;
      }
      for (const c of childrenOf(a)) rec(c, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0), y + (n.border?.top?.width ?? 0) + (n.padding?.top ?? 0));
    };
    rec(s.page as unknown as AreaNode, 0, 0);
  });
  return { lines, warnings: r.warnings.map((w) => (typeof w === 'string' ? w : (w as { message: string }).message)).join('\n'), pages: r.areaTree.sheets.length };
}
/** K の行 (分けない指定のブロックの行) の、段ごとの行の数と、いちばん下の行の下端・ページの数 */
const shape = (ls: Line[], re = /^K/) => {
  const k = ls.filter((l) => re.test(l.t));
  return { left: k.filter((l) => l.x < 150).length, right: k.filter((l) => l.x >= 150).length, bottom: Math.max(...k.map((l) => l.bottom)), pages: new Set(k.map((l) => l.page)).size };
};
const FO_MODES = ['spec', 'antenna'] as const;
const HTML_STYLES = [undefined, 'ah'] as const;

describe('分けずに釣り合わせた段組の箱が、置く場所に入らないときは、分けて収める', () => {
  for (const compat of FO_MODES) {
    it(`padding・罫線のある段組 (XSL-FO、${compat})`, async () => {
      // 段の取れる高さは 260 - 40 = 220pt、keep は 20 行 (240pt)。罫線 20pt でも同じ
      for (const a of ['padding="20pt"', 'border="20pt solid black"']) {
        const r = await lay(fo(BC(kt(20), a)), { compat });
        const s = shape(r.lines);
        expect(s.pages).toBe(1);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(260.01);
        expect(r.warnings).not.toMatch(/ページより大きい/);
      }
    });

    it(`span="all" の後ろの段の組 (XSL-FO、${compat})`, async () => {
      // span の 8 行 (96pt) の後ろは 164pt、keep は 15 行 (180pt)。span の前にも段の組があるとき
      for (const body of [BC(`<fo:block span="all">${L(8, 'S')}</fo:block>${kt(15)}`), BC(`${L(4, 'A')}<fo:block span="all">${L(6, 'S')}</fo:block>${kt(18)}`)]) {
        const r = await lay(fo(body), { compat });
        const s = shape(r.lines);
        expect(s.pages).toBe(1);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(280.01);
        expect(r.warnings).not.toMatch(/ページより大きい/);
      }
    });

    it(`keep の中の脚注も、ページの残りに数える (XSL-FO、${compat})`, async () => {
      const body = BC(`<fo:block keep-together.within-column="always">${L(10, 'K')}<fo:block>F<fo:footnote><fo:inline>1</fo:inline><fo:footnote-body>${L(4, 'N')}</fo:footnote-body></fo:footnote></fo:block>${L(8, 'M')}</fo:block>`);
      const r = await lay(fo(body), { compat });
      expect(r.pages).toBe(1);
      const s = shape(r.lines, /^[KM]/);
      expect(s.left).toBeGreaterThan(0);
      expect(s.right).toBeGreaterThan(0);
      // 脚注の行も、同じページの本文の領域に入る
      expect(Math.max(...r.lines.filter((l) => /^N/.test(l.t)).map((l) => l.bottom))).toBeLessThanOrEqual(280.01);
    });

    it(`絶対配置のコンテナ・fo:float の中の段組 (ページを持たない流れ。XSL-FO、${compat})`, async () => {
      // keep は 25 行 (300pt)。版面 (260pt) より高い段は取れない
      for (const body of [
        `<fo:block-container absolute-position="absolute" top="0pt" left="0pt" width="200pt">${BC(kt(25))}</fo:block-container><fo:block>after</fo:block>`,
        `<fo:float float="start"><fo:block-container width="200pt">${BC(kt(25))}</fo:block-container></fo:float><fo:block>after</fo:block>`,
      ]) {
        const r = await lay(fo(body), { compat });
        const k = r.lines.filter((l) => /^K/.test(l.t));
        // 200pt の幅の段 (94pt): 2 段目は x が 20 + 106 = 126 から
        expect(k.filter((l) => l.x < 100).length).toBeGreaterThan(0);
        expect(k.filter((l) => l.x >= 100).length).toBeGreaterThan(0);
        expect(Math.max(...k.map((l) => l.bottom))).toBeLessThanOrEqual(280.01);
        expect(r.warnings).not.toMatch(/ページより大きい/);
      }
    });
  }

  for (const style of HTML_STYLES) {
    const opts: Record<string, string> = style ? { style } : {};
    it(`HTML の padding のある段組・column-span: all の後ろ・float の段組 (${style ?? '既定'})`, async () => {
      for (const body of [`<div class="c" style="padding:20pt 0">${hk(20)}</div>`, `<div class="c"><div style="column-span:all">${HL(8, 'S')}</div>${hk(15)}</div>`]) {
        const r = await lay(html(body), opts);
        const s = shape(r.lines);
        expect(s.pages).toBe(1);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(280.01);
        expect(r.warnings).not.toMatch(/ページより大きい/);
      }
      const r = await lay(html(`<div class="c" style="float:left;width:200pt">${hk(25)}</div><p>after</p>`), opts);
      const k = r.lines.filter((l) => /^K/.test(l.t));
      expect(k.filter((l) => l.x < 100).length).toBeGreaterThan(0);
      expect(k.filter((l) => l.x >= 100).length).toBeGreaterThan(0);
      expect(Math.max(...k.map((l) => l.bottom))).toBeLessThanOrEqual(280.01);
      expect(r.warnings).not.toMatch(/ページより大きい/);
    });
  }
});

describe('領域の頭で捨てる余白は、段の取れる高さから引かない (XSL-FO)', () => {
  for (const compat of FO_MODES) {
    it(`ページの頭の space-before を捨てた後に段に入る keep は、分けない (${compat})`, async () => {
      // keep は 20 行 (240pt)。space-before の 30pt は捨てるので、段は 260pt 取れる
      for (const [body, page] of [
        [BC(kt(20), 'space-before="30pt"'), 0],
        [`<fo:block space-before="30pt">${BC(kt(20))}</fo:block>`, 0],
        [L(21, 'P') + BC(kt(20), 'space-before="30pt"'), 1],
      ] as const) {
        const r = await lay(fo(body), { compat });
        const s = shape(r.lines);
        expect(s.pages).toBe(1);
        expect(s.left === 0 || s.right === 0).toBe(true);
        expect(r.lines.find((l) => l.t === 'K0')?.page).toBe(page);
        expect(r.lines.find((l) => l.t === 'K0')?.y).toBeCloseTo(20, 0);
        expect(s.bottom).toBeLessThanOrEqual(280.01);
      }
    });
  }
});

describe('ページの途中で、残りに入らない分けない指定のある段組の箱は、いまのページの残りで分けて収める', () => {
  // 行 8 本 (96pt) の後ろの残りは 164pt。padding 10pt の段組の段は 144pt で、keep の 13 行 (156pt) は入らないので、段組の中の keep を破って
  // 2 段に分け、いまのページに収める (XSL 1.1 §7.20.3: keep は、満たせなければ破る。CSS Fragmentation 3 §3.3)。
  // 次のページの頭なら入るときに、段組の箱ごと次のページへ送る (§4.8 の、すべての keep を満たす区切りを選ぶ) ことは、まだしない
  // (枠の無い段組と同じく、いまのページで分ける。送ると、送った箱の中の絶対配置の箱が前のページに残り、次のページの方が低いと、
  // 送った箱がはみ出していた)
  const LI = (inner: string) => `<fo:list-block><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>*</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()">${inner}</fo:list-item-body></fo:list-item></fo:list-block>`;
  const ABS = `<fo:block-container absolute-position="absolute" top="150pt" left="200pt" width="60pt"><fo:block>ABSBOX</fo:block></fo:block-container>`;
  /** 1 ページ目は本文 260pt、続くページは本文 160pt (page-sequence-master の single と repeatable) */
  const foShortNext = (body: string) =>
    fo(body)
      .replace(/<fo:layout-master-set>.*<\/fo:layout-master-set>/, '<fo:layout-master-set><fo:simple-page-master master-name="f" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body/></fo:simple-page-master><fo:simple-page-master master-name="r" page-width="300pt" page-height="200pt" margin="20pt"><fo:region-body/></fo:simple-page-master><fo:page-sequence-master master-name="m"><fo:single-page-master-reference master-reference="f"/><fo:repeatable-page-master-reference master-reference="r"/></fo:page-sequence-master></fo:layout-master-set>')
      .replace('master-reference="p"', 'master-reference="m"');
  const split = (r: Awaited<ReturnType<typeof lay>>) => {
    const s = shape(r.lines);
    expect(r.lines.find((l) => l.t === 'K0')?.page).toBe(0);
    expect(s.pages).toBe(1);
    expect(s.left).toBeGreaterThan(0);
    expect(s.right).toBeGreaterThan(0);
    expect(s.bottom).toBeLessThanOrEqual(280.01);
    expect(r.warnings).not.toMatch(/ページより大きい/);
  };
  for (const compat of FO_MODES) {
    it(`padding のある段組・リストの項目の中・padding のあるブロックの中 (XSL-FO、${compat})`, async () => {
      for (const body of [
        L(8, 'P') + BC(kt(13), 'padding="10pt"'),
        L(8, 'P') + BC(kt(13) + L(4, 'A'), 'padding="10pt"'),
        L(8, 'P') + LI(BC(kt(13), 'padding="10pt"')),
        L(8, 'P') + `<fo:block padding="5pt" border="1pt solid black">${BC(kt(13), 'padding="5pt"')}</fo:block>`,
      ]) split(await lay(fo(body), { compat }));
    });

    it(`keep-with-next の見出しの後ろ (XSL-FO、${compat})`, async () => {
      const r = await lay(fo(L(7, 'P') + `<fo:block keep-with-next.within-page="always">HEAD</fo:block>` + BC(kt(13), 'padding="10pt"')), { compat });
      split(r);
      expect(r.lines.find((l) => l.t === 'HEAD')?.page).toBe(0);
    });

    it(`段組の中の絶対配置の箱は、段組の箱と同じページに 1 つ (XSL-FO、${compat})`, async () => {
      const r = await lay(fo(L(8, 'P') + BC(ABS + kt(13), 'padding="10pt"')), { compat });
      split(r);
      const abs = r.lines.filter((l) => l.t === 'ABSBOX');
      expect(abs.map((l) => l.page)).toEqual([0]);
    });

    it(`次のページが低いときも、いまのページで分けて収める (XSL-FO、${compat})`, async () => {
      const r = await lay(foShortNext(L(8, 'P') + BC(kt(13), 'padding="10pt"')), { compat });
      split(r);
      expect(r.pages).toBe(1);
    });

    it(`次のページの頭にも入らない (1 ページより高い) keep は、いまのページで分ける (XSL-FO、${compat})`, async () => {
      // keep 19 行 (228pt) と 1 行。分けずに釣り合わせた箱 (228 + padding 40) は、次のページの頭 (260pt) にも入らない。
      // 分ければ、いまのページの残り (164pt) に入る
      const r = await lay(fo(L(8, 'P') + BC(kt(19) + L(1, 'A'), 'padding="20pt"')), { compat });
      const s = shape(r.lines);
      expect(s.left).toBeGreaterThan(0);
      expect(s.right).toBeGreaterThan(0);
      expect(r.lines.find((l) => l.t === 'K0')?.page).toBe(0);
      expect(s.bottom).toBeLessThanOrEqual(280.01);
      expect(r.warnings).not.toMatch(/ページより大きい/);
    });
  }

  for (const style of [undefined, 'ah', 'weasyprint', 'vivliostyle'] as const) {
    const opts: Record<string, string> = style ? { style } : {};
    it(`HTML の padding のある段組・中の絶対配置の箱・1 ページ目だけ高いページ (${style ?? '既定'})`, async () => {
      split(await lay(html(`${HL(8, 'P')}<div class="c" style="padding:10pt 0">${hk(13)}</div>`), opts));
      // position: relative の段組の中の絶対配置の箱 (top: 10pt): 段組の箱と同じ 1 ページ目に 1 つ
      const r = await lay(html(`${HL(8, 'P')}<div class="c" style="padding:10pt 0;position:relative"><div style="position:absolute;top:10pt;left:200pt">ABSBOX</div>${hk(13)}</div>`), opts);
      split(r);
      expect(r.lines.filter((l) => l.t === 'ABSBOX').map((l) => l.page)).toEqual([0]);
      // 続くページの本文が低い (@page :first だけ余白 20pt、ほかは上の余白 140pt)
      const low = html(`${HL(8, 'P')}<div class="c" style="padding:10pt 0">${hk(13)}</div>`).replace('@page{size:300pt 300pt;margin:20pt}', '@page{size:300pt 300pt;margin:140pt 20pt 20pt}@page :first{margin:20pt}');
      split(await lay(low, opts));
    });
  }
});

describe('ページを持たない流れ (絶対配置の箱・高さを決めた親の中) の段組は、包含ブロックの残りに入る高さで分ける', () => {
  for (const compat of FO_MODES) {
    it(`絶対配置の箱 (top="150pt") の中・高さを決めた親の中 (XSL-FO、${compat})`, async () => {
      // 絶対配置の箱は y = 20 + 150 から、版面の下端 (280) まで 110pt。keep は 13 行 (156pt)
      for (const body of [
        L(8, 'P') + `<fo:block-container absolute-position="absolute" top="150pt" left="0pt" width="260pt">${BC(kt(13), 'padding="10pt"')}</fo:block-container>`,
        `<fo:block-container absolute-position="absolute" top="150pt" left="0pt" width="260pt" axf:column-count="2" axf:column-gap="12pt">${kt(13)}</fo:block-container>`,
      ]) {
        const r = await lay(fo(body), { compat });
        const s = shape(r.lines);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(280.01);
      }
      // 高さ 200pt の親 (y = 20..220) の中の keep 20 行 (240pt)
      for (const a of ['', 'padding="5pt"']) {
        const r = await lay(fo(`<fo:block-container height="200pt">${BC(kt(20), a)}</fo:block-container>`), { compat });
        const s = shape(r.lines);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(220.01);
      }
    });
  }

  for (const style of HTML_STYLES) {
    it(`HTML の高さを決めた親の中・max-height の段組 (${style ?? '既定'})`, async () => {
      // 親 (y = 20..220) の中、段組の max-height 200pt (y = 20..220。padding 10pt の内側の段は 180pt)
      for (const body of [`<div style="height:200pt"><div class="c" style="padding:5pt 0">${hk(20)}</div></div>`, `<div class="c" style="max-height:200pt;padding:10pt 0">${hk(20)}</div>`]) {
        const r = await lay(html(body), style ? { style } : {});
        const s = shape(r.lines);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(220.01);
      }
      // float の中 (ページを持たない流れ) の段組の max-height が版面より大きいとき: 段の取れる高さは、版面の高さのまま (広げない)
      const r = await lay(html(`<div style="float:left;width:200pt"><div class="c" style="max-height:3000px">${hk(30)}</div></div>${HL(3)}`), style ? { style } : {});
      const k = r.lines.filter((l) => /^K/.test(l.t));
      expect(k.filter((l) => l.x < 100).length).toBeGreaterThan(0);
      expect(k.filter((l) => l.x >= 100).length).toBeGreaterThan(0);
      expect(Math.max(...k.map((l) => l.bottom))).toBeLessThanOrEqual(280.01);
    });
  }

  for (const compat of FO_MODES) {
    it(`間に高さの無いコンテナを挟む入れ子 (XSL-FO、${compat})`, async () => {
      // 高さ 200pt の親 (y = 20..220) > padding のあるコンテナ > 段組。行 3 本 (36pt) の後ろの keep 20 行 (240pt)
      for (const body of [
        `<fo:block-container height="200pt"><fo:block-container padding="10pt">${L(3, 'P')}${BC(kt(20))}</fo:block-container></fo:block-container>`,
        `<fo:block-container height="200pt"><fo:block-container padding="5pt"><fo:block-container padding="5pt">${L(3, 'P')}${BC(kt(20))}</fo:block-container></fo:block-container></fo:block-container>`,
      ]) {
        const r = await lay(fo(body), { compat });
        const s = shape(r.lines);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.bottom).toBeLessThanOrEqual(220.01);
      }
      // 絶対配置の箱 (top="100pt"。y = 120 から版面の下端 280 まで) > padding のあるコンテナ > 段組
      const r = await lay(fo(`<fo:block-container absolute-position="absolute" top="100pt" left="0pt" width="260pt"><fo:block-container padding="5pt">${L(2, 'P')}${BC(kt(20))}</fo:block-container></fo:block-container>`), { compat });
      const s = shape(r.lines);
      expect(s.left).toBeGreaterThan(0);
      expect(s.right).toBeGreaterThan(0);
      expect(s.bottom).toBeLessThanOrEqual(280.01);
    });
  }
});
