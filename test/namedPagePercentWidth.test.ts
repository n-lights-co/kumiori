/**
 * 名前付きのページ (page) を指定した箱から下の、百分率の幅の基準 (CSS Paged Media 3 §10.1・§3.3: ページの領域が、そのページの中身の包含ブロック)。
 *  - 流れの中のブロックに page を書くと、その中の百分率の幅は、そのページの領域の幅になる
 *  - ページの切り替わらない箱 (float・inline-block・表のセルの中・固定配置・段組・flex の項目の中など) は、親のページの幅のまま
 *    (見分け方は、読み込みがページを切り替える条件と同じ。pageFlow.ts)
 *  - 祖先の幅・max-width・min-width の指定は、切り替えたページでも効く (親の箱からはみ出さない)
 *  - html・body の page は、文書の最初のページ (と、page が auto の中の箱すべて) の名前
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { DOMParser as HtmlDomParser } from 'linkedom';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { querySelectorAll } from '../src/cssSelector';
import { prepareHtml } from '../src/htmlPrepare';
import { loadHtml } from '../src/htmlFrame';
import { blockLevelDisplay, bodyPageSwitchHolder, pageSwitchBox, pageSwitchHolder, rootPageName } from '../src/pageFlow';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

// 用紙 400pt 四方。名前の無いページの領域は 300pt、wide は 380pt、narrow は 200pt
const PAGES = '@page { size: 400pt 400pt; margin: 50pt } @page wide { margin: 10pt } @page narrow { margin: 100pt } ';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 赤い背景の箱 (.r) の、ページの番号 (0 から)・左端・幅 (pt) */
async function redBoxes(body: string, css = '') {
  const html = `<!DOCTYPE html><html><head><style>body { margin: 0; font-size: 10pt } p { margin: 0 } .r { background: #f00 } ${PAGES} ${css}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out: Array<{ page: number; x: number; w: number }> = [];
  r.areaTree.sheets.forEach((sh, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; backgroundColor?: unknown; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      if ((a.type === 'block' || a.type === 'table-cell') && g.backgroundColor && /255, 0, 0|f00/i.test(JSON.stringify(g.backgroundColor))) out.push({ page, x: r2(x), w: r2(g.width ?? 0) });
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  return { pages: r.areaTree.sheets.length, boxes: out };
}

describe('組んだ結果: 名前付きのページの中の百分率の幅', () => {
  it('流れの中のブロックに page を書くと、中の百分率の幅は、そのページの領域の幅になる (最初のページでも)', async () => {
    expect(await redBoxes('<p>a</p><section style="page: wide"><div class="r" style="width:100%">x</div><div class="r" style="width:50%">y</div></section>')).toEqual({
      pages: 2,
      boxes: [
        { page: 1, x: 10, w: 380 },
        { page: 1, x: 10, w: 190 },
      ],
    });
    expect((await redBoxes('<section style="page: wide"><div class="r" style="width:100%">x</div></section><p>b</p>')).boxes).toEqual([{ page: 0, x: 10, w: 380 }]);
    // 表・flex の容器そのものに page を書いたとき (容器は切り替える箱)
    expect((await redBoxes('<p>a</p><div class="r" style="page: wide; display: flex; width: 100%"><div>x</div></div>')).boxes).toEqual([{ page: 1, x: 10, w: 380 }]);
  });

  it('入れ子 (wide の中の narrow、その中の page: auto)・未定義の名前 (名前の無いページ)・__proto__ の名前', async () => {
    const nested = await redBoxes(
      '<p>a</p><section style="page: wide"><div class="r" style="width:100%">w</div><section style="page: narrow"><div class="r" style="width:100%">n</div><div style="page: auto"><div class="r" style="width:100%">n2</div></div></section><div class="r" style="width:100%">w2</div></section>',
    );
    expect(nested.boxes).toEqual([
      { page: 1, x: 10, w: 380 },
      { page: 2, x: 100, w: 200 },
      { page: 2, x: 100, w: 200 },
      { page: 3, x: 10, w: 380 },
    ]);
    // 名前の無い (@page nosuch の無い) ページは、名前の無いページの領域 (300pt)。wide の中でも
    expect((await redBoxes('<p>a</p><section style="page: wide"><section style="page: nosuch"><div class="r" style="width:100%">n</div></section></section>')).boxes).toEqual([{ page: 1, x: 50, w: 300 }]);
    const proto = await redBoxes('<p>a</p><section style="page: constructor"><div class="r" style="width:100%">x</div></section><section style="page: __proto__"><div class="r" style="width:100%">y</div></section>', '@page constructor { margin: 10pt } @page __proto__ { margin: 10pt }');
    expect(proto.boxes).toEqual([
      { page: 1, x: 10, w: 380 },
      { page: 2, x: 10, w: 380 },
    ]);
  });

  it('ページの切り替わらない箱 (float・inline-block・表のセルの中・固定配置・段組・flex の項目・display: contents・行内の要素の中) は、親のページの幅のまま', async () => {
    const one = async (body: string) => (await redBoxes(body)).boxes;
    expect(await one('<p>a</p><div class="r" style="float: left; page: wide; width: 50%">x</div><p>b</p>')).toEqual([{ page: 0, x: 50, w: 150 }]);
    expect((await one('<p>a <span class="r" style="display: inline-block; page: wide; width: 50%">x</span></p>')).map((b) => b.w)).toEqual([150]);
    // セルの内容の幅 (299.5pt) の 100% (幅が auto のブロックと同じ幅)
    expect((await one('<p>a</p><table style="width: 100%; border-spacing: 0"><tr><td style="padding: 0"><div class="r" style="page: wide; width: 100%">x</div></td></tr></table>')).map((b) => [b.page, b.w])).toEqual([[0, 299.5]]);
    expect(await one('<p>a</p><div class="r" style="position: fixed; top: 0; left: 0; page: wide; width: 100%">x</div><p>b</p>')).toEqual([{ page: 0, x: 50, w: 300 }]);
    // 段組の中の箱の包含ブロックは段の箱 (CSS Multi-column 1 §2): 段の幅 (300pt − 段の間 1em) の半分
    expect(await one('<p>a</p><div style="column-count: 2"><section style="page: wide"><div class="r" style="width: 100%">x</div></section></div>')).toEqual([{ page: 0, x: 50, w: 145 }]);
    expect(await one('<p>a</p><div style="display: flex"><section style="page: wide; width: 100%"><div class="r" style="width: 100%">x</div></section></div>')).toEqual([{ page: 0, x: 50, w: 300 }]);
    expect(await one('<p>a</p><div style="display: contents"><section style="page: wide"><div class="r" style="width: 100%">x</div></section></div>')).toEqual([{ page: 0, x: 50, w: 300 }]);
    expect(await one('<p>a</p><span><section style="page: wide"><div class="r" style="width: 100%">x</div></section></span>')).toEqual([{ page: 0, x: 50, w: 300 }]);
    expect(await one('<p>a</p><div style="float: left; width: 100%"><section style="page: wide"><div class="r" style="width: 100%">x</div></section></div>')).toEqual([{ page: 0, x: 50, w: 300 }]);
  });

  it('祖先の幅・max-width・min-width の指定は、切り替えたページでも効く (親の箱からはみ出さない)', async () => {
    const child = async (parentStyle: string) => (await redBoxes(`<p>a</p><div class="r" style="${parentStyle}"><section style="page: wide"><div class="r" style="width: 100%">x</div></section></div>`)).boxes.filter((b) => b.page === 1);
    expect(await child('width: 200pt')).toEqual([
      { page: 1, x: 10, w: 200 },
      { page: 1, x: 10, w: 200 },
    ]);
    expect((await child('max-width: 250pt')).map((b) => b.w)).toEqual([250, 250]);
    // 下限の効いた auto の幅の箱は、置いたページの領域の幅 (380pt) を下限で抑えた幅になるので (CSS 2.1 §10.4)、子もその幅
    expect((await child('min-width: 350pt')).map((b) => b.w)).toEqual([380, 380]);
    // 百分率の幅の親は、組むときに、断片を置いたページの領域の幅の 50% になる (CSS Fragmentation 3 §5.1: 断片ごとに、その断片の
    // 包含ブロックの大きさで寸法を決め直す)。子も、その中に収まる
    expect((await child('width: 50%')).map((b) => b.w)).toEqual([190, 190]);
    // 余白・枠・内側の余白は、そのページでも同じだけ引く
    expect((await child('padding: 0 20pt')).map((b) => b.w)).toEqual([380, 340]);
  });

  it('html・body の page は、文書の最初のページの名前 (page が auto の中の箱すべて)', async () => {
    expect(await redBoxes('<div class="r" style="width: 100%">x</div>', 'body { page: wide }')).toEqual({ pages: 1, boxes: [{ page: 0, x: 10, w: 380 }] });
    expect(await redBoxes('<div class="r" style="width: 100%">x</div>', 'html { page: wide }')).toEqual({ pages: 1, boxes: [{ page: 0, x: 10, w: 380 }] });
    // body の page が html の page に勝つ (中の箱の使用値は、近い祖先の値)
    expect((await redBoxes('<div class="r" style="width: 100%">x</div>', 'html { page: narrow } body { page: wide }')).boxes).toEqual([{ page: 0, x: 10, w: 380 }]);
    // 中の箱が別の名前を書けば、そこで切り替わり、終われば body の名前に戻る
    expect(await redBoxes('<p>a</p><section style="page: narrow"><div class="r" style="width: 100%">n</div></section><div class="r" style="width: 100%">w</div>', 'body { page: wide }')).toEqual({
      pages: 3,
      boxes: [
        { page: 1, x: 100, w: 200 },
        { page: 2, x: 10, w: 380 },
      ],
    });
    // flex の body も、最初のページの名前は body の page
    expect((await redBoxes('<div class="r" style="width: 100%">x</div>', 'body { page: wide; display: flex }')).boxes).toEqual([{ page: 0, x: 10, w: 380 }]);
  });
});

describe('カスケード: 名前付きのページの幅の見積もり (cascadeStyles の pageWidths)', () => {
  const widths = (body: string, css = '', pageWidths = new Map([['wide', 500], ['narrow', 200], ['__proto__', 450]])) => {
    const d = new DOMParser().parseFromString(`<html><head></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const s = cascadeStyles(d, `body { margin: 0 } ${css}`, { uaCss: HTML_UA_CSS, viewport: { width: 400, height: 400 }, pageWidths });
    return Object.fromEntries(querySelectorAll(d, '[id]').map((e) => [e.getAttribute('id'), s.style(e).getPropertyValue('width')]));
  };
  it('切り替える箱の中は、そのページの領域の幅。切り替わらない箱 (float・表のセルの中) と、幅の指定のある親の中は、親のページの幅のまま', () => {
    expect(widths('<section style="page: wide"><div id="a" style="width: 100%"></div></section>')).toEqual({ a: '500px' });
    expect(widths('<section style="page: __proto__"><div id="a" style="width: 100%"></div></section>')).toEqual({ a: '450px' });
    expect(widths('<section style="page: constructor"><div id="a" style="width: 100%"></div></section>')).toEqual({ a: '400px' });
    expect(widths('<div style="float: left; page: wide; width: 100%" id="f"></div><table><tr><td><div id="c" style="page: wide; width: 50%"></div></td></tr></table>')).toEqual({ f: '400px', c: '200px' });
    expect(widths('<div style="width: 300px"><section style="page: wide"><div id="a" style="width: 100%"></div></section></div><div style="max-width: 350px"><section style="page: wide"><div id="b" style="width: 100%"></div></section></div>')).toEqual({ a: '300px', b: '350px' });
    expect(widths('<div id="a" style="width: 100%"></div>', 'body { page: wide }')).toEqual({ a: '500px' });
  });
});

describe('見分け方 (pageFlow.ts): 読み込みとカスケードで共通', () => {
  it('切り替えを置く箱・中も切り替えを置ける箱・body・最初のページの名前', () => {
    expect(['block', 'flow-root', 'list-item', 'table', 'flex', 'grid', 'table-row', 'block math'].every(blockLevelDisplay)).toBe(true);
    expect(['inline', 'inline-block', 'contents', 'inline-flex', 'ruby'].some(blockLevelDisplay)).toBe(false);
    expect(pageSwitchBox(true, 'static', 'none')).toBe(true);
    expect(pageSwitchBox(true, 'relative', '')).toBe(true);
    expect(pageSwitchBox(true, 'absolute', 'none') || pageSwitchBox(true, 'fixed', 'none') || pageSwitchBox(true, 'static', 'left') || pageSwitchBox(false, 'static', 'none')).toBe(false);
    expect(pageSwitchHolder('block', 'auto', 'auto', 'div') && pageSwitchHolder('flow-root', '1', 'auto', 'section')).toBe(true);
    expect(pageSwitchHolder('block', '2', 'auto', 'div') || pageSwitchHolder('list-item', 'auto', 'auto', 'li') || pageSwitchHolder('table', 'auto', 'auto', 'table') || pageSwitchHolder('block', 'auto', 'auto', 'img')).toBe(false);
    expect(bodyPageSwitchHolder('block') && !bodyPageSwitchHolder('flex') && !bodyPageSwitchHolder('inline-grid')).toBe(true);
    expect([rootPageName('wide', 'narrow'), rootPageName('auto', 'narrow'), rootPageName(undefined, 'AUTO'), rootPageName(' Wide ', undefined)]).toEqual(['wide', 'narrow', undefined, 'Wide']);
  });
});

describe('画面の既定のカスケード (htmlFrame の noFrame) も、名前付きのページの幅で見積もる', () => {
  it('loadHtml (noFrame) の計算値が、Node のコマンドと同じ (prepareHtml の pageWidthsPx を渡す)', async () => {
    const g = globalThis as { DOMParser?: unknown };
    const saved = g.DOMParser;
    g.DOMParser = HtmlDomParser;
    try {
      const html = `<!DOCTYPE html><html><head><style>${PAGES} body { margin: 0 } @page __proto__ { margin: 20pt }</style></head><body><p>a</p><section style="page: wide"><div id="a" style="width: 100%">x</div></section><section style="page: __proto__"><div id="b" style="width: 100%">y</div></section></body></html>`;
      const loaded = await loadHtml(html, [], 'kumiori', undefined, { noFrame: true });
      const w = (id: string) => loaded.styles.style(querySelectorAll(loaded.doc, `#${id}`)[0]).getPropertyValue('width');
      // 380pt・360pt (px にして)
      expect([w('a'), w('b')].map((v) => r2((parseFloat(v) * 72) / 96))).toEqual([380, 360]);
      const prepared = await prepareHtml(html, [], 'kumiori', { width: 210, height: 297, margin: 20 }, (t) => new HtmlDomParser().parseFromString(t, 'text/html') as unknown as Document);
      expect([...prepared.pageWidthsPx.keys()].sort()).toEqual(['__proto__', 'narrow', 'wide']);
    } finally {
      g.DOMParser = saved;
    }
  });
});
