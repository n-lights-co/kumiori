/**
 * WeasyPrint の既定のスタイル (--style weasyprint) のときだけの、WeasyPrint の組み方 (compat.ts の WEASYPRINT_HTML_IMPORT_OPTIONS) と、
 * 仕様どおりの組み方 (ほかのスタイル。Chromium と同じ) の違い:
 *  - 中身の無い目印 (<span id></span>) だけの行: 仕様では無いものとして前後のマージンを相殺する (CSS 2.1 §9.4.2)。WeasyPrint は相殺しない
 *  - 見つからない target-counter() の参照: 「?」。WeasyPrint は空
 *  - 高さの決まった折り返しの flex の容器の 1 つだけの行: 仕様では align-content が normal・stretch のときだけ容器の高さ (Flexbox 1 §9.4 の 15)。
 *    WeasyPrint は align-content に関わらず容器の高さ
 *  - 罫線の太さ: ブラウザ (Chrome) は 1px 未満を 1px に切り上げ、端数を切り捨てる。WeasyPrint は丸めない (0.3pt の線は 0.3pt)
 * あわせて、相対配置の top の百分率 (包含ブロックの高さが決まっていればその割合。CSS 2.1 §9.4.3) を、どのスタイルでも解く
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea, type HtmlDefaults } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

interface G { text: string; y: number; line: number }
/** 1 ページ目の字 (ページの上からの位置と、何行目か) */
async function glyphs(html: string, style: HtmlDefaults): Promise<G[]> {
  const t = (await typesetHtml(html, { loadFont: loadCachedFont, style })).areaTree;
  const out: G[] = [];
  let line = -1;
  const rec = (a: AreaNode, oy: number) => {
    const y = oy + a.y;
    if (a.type === 'line') line++;
    if (a.type === 'glyph') out.push({ text: (a as GlyphArea).text, y, line });
    for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0));
  };
  rec(t.sheets[0], 0);
  return out;
}
const doc = (css: string, body: string) =>
  `<!doctype html><html lang="en"><head><style>@page { size: 120mm 160mm; margin: 0 } body { margin: 0; font-size: 11pt; line-height: 1.5 } ${css}</style></head><body>${body}</body></html>`;
const first = (g: G[], text: string) => g.find((x) => x.text === text)!;

describe('中身の無い目印だけの行と、マージンの相殺', () => {
  const html = doc('p { margin: 0 0 11pt } h3 { font-size: 20pt; line-height: 30pt; margin: 20pt 0 }', '<section><p>A</p></section><section><span id="x"></span><h3>H</h3></section>');
  it('仕様 (browser): 段落の下 11pt と見出しの上 20pt を相殺する', async () => {
    const g = await glyphs(html, 'browser');
    const w = await glyphs(html, 'weasyprint');
    // 同じ文書の WeasyPrint の組み方より 11pt 上 (相殺しないと 11 + 20)
    expect(first(w, 'H').y - first(w, 'A').y - (first(g, 'H').y - first(g, 'A').y)).toBeCloseTo(11, 1);
  });
  it('目印の無い文書は、どちらも同じ', async () => {
    const plain = doc('p { margin: 0 0 11pt } h3 { font-size: 20pt; line-height: 30pt; margin: 20pt 0 }', '<section><p>A</p></section><section><h3>H</h3></section>');
    const g = await glyphs(plain, 'browser');
    const w = await glyphs(plain, 'weasyprint');
    expect(first(w, 'H').y - first(w, 'A').y).toBeCloseTo(first(g, 'H').y - first(g, 'A').y, 1);
  });
});

describe('見つからない target-counter() の参照', () => {
  const html = doc('a::after { content: "[" target-counter(attr(href url), page) "]" }', '<p><a href="#none">T</a></p>');
  const text = async (style: HtmlDefaults) => (await glyphs(html, style)).map((x) => x.text).join('');
  it('仕様 (browser): 「?」、WeasyPrint の組み方: 空', async () => {
    expect(await text('browser')).toBe('T[?]');
    expect(await text('weasyprint')).toBe('T[]');
  });
});

describe('相対配置の top の百分率と、折り返しの flex の容器の 1 つだけの行', () => {
  it('包含ブロックの高さが決まっていれば、その割合 (前は 0)', async () => {
    const g = await glyphs(doc('.box { height: 100pt } .r { position: relative; top: 40% }', '<div class="box"><div class="r">P</div></div>'), 'browser');
    const base = await glyphs(doc('.box { height: 100pt }', '<div class="box"><div>P</div></div>'), 'browser');
    expect(first(g, 'P').y - first(base, 'P').y).toBeCloseTo(40, 1);
  });
  it('高さの決まらない包含ブロックでは auto (0)', async () => {
    const g = await glyphs(doc('.r { position: relative; top: 40% }', '<div><div class="r">P</div></div>'), 'browser');
    const base = await glyphs(doc('', '<div><div>P</div></div>'), 'browser');
    expect(first(g, 'P').y).toBeCloseTo(first(base, 'P').y, 1);
  });
  // 包含ブロックは、いちばん近いブロックの容器の祖先 (CSS 2.1 §10.1 の 2)。行内の要素の height は効かない (§10.5) ので、その高さは基準にしない
  it('親が行内の要素なら、その height は読まず、ブロックの祖先までたどる', async () => {
    const at = async (css: string, body: string) => first(await glyphs(doc(css, body), 'browser'), 'X').y;
    const base = await at('', '<span style="height:100pt"><p>X</p></span>');
    // 高さの決まらない body が包含ブロックなので auto (ずらさない)
    expect(await at('', '<span style="height:100pt"><p style="position:relative;top:50%">X</p></span>')).toBeCloseTo(base, 1);
    // 行内の要素を 2 段はさんでも同じ
    expect(await at('', '<span style="height:100pt"><span style="height:80pt"><p style="position:relative;top:50%">X</p></span></span>')).toBeCloseTo(base, 1);
    // display: contents も飛ばす
    expect(await at('', '<div style="display:contents;height:100pt"><p style="position:relative;top:50%">X</p></div>')).toBeCloseTo(base, 1);
    // ブロックの祖先に height があれば、その割合でずらす (間の span の height は効かない)
    const blockBase = await at('', '<div style="height:60pt"><span style="height:100pt"><span><p>X</p></span></span></div>');
    expect((await at('', '<div style="height:60pt"><span style="height:100pt"><span><p style="position:relative;top:50%">X</p></span></span></div>')) - blockBase).toBeCloseTo(30, 1);
    expect((await at('', '<div style="height:60pt"><p style="position:relative;top:50%">X</p></div>')) - blockBase).toBeCloseTo(30, 1);
  });
  // flex・grid の項目は、計算値の display が inline (span) でもブロック化される (CSS Display 3 §2.7・Flexbox 1 §4・Grid 1 §6.1) ので、包含ブロックになる。
  // 祖父の容器 (100pt) でなく、項目の span (60pt) の割合でずらす。display: contents の中の項目も同じ (§2.5)
  for (const style of ['browser', 'weasyprint'] as const) {
    it(`flex・grid の項目の行内の要素は、包含ブロックとして飛ばさない (${style})`, async () => {
      const at = async (body: string) => first(await glyphs(doc('', body), style), 'X').y;
      for (const box of ['display:flex', 'display:inline-flex', 'display:grid', 'display:inline-grid']) {
        const html = (top: string, wrap = (x: string) => x) =>
          `<div style="${box};height:100pt;width:200pt">${wrap(`<span style="height:60pt"><b style="display:block;position:relative;top:${top}">X</b></span>`)}</div>`;
        const base = await at(html('0'));
        expect((await at(html('50%'))) - base).toBeCloseTo(30, 1);
        const contents = (x: string) => `<div style="display:contents">${x}</div>`;
        expect((await at(html('50%', contents))) - (await at(html('0', contents)))).toBeCloseTo(30, 1);
      }
    });
  }
  // Sphinx の印刷用の CSS の表紙の書き方: 項目の中の題を top: 40% で置く
  const cover = (ac: string) =>
    doc(`#cover { display: flex; flex-wrap: wrap; height: 400pt; align-content: ${ac} } .c { width: 100% } .m { position: relative; top: 40% }`, '<div id="cover"><div class="c"><div class="m">P</div></div></div>');
  it('仕様 (browser): align-content: normal なら項目は容器の高さに伸び、40% は容器の高さの割合 (Chromium と同じ)', async () => {
    const base = first(await glyphs(cover('normal').replace('top: 40%', 'top: 0'), 'browser'), 'P').y;
    expect(first(await glyphs(cover('normal'), 'browser'), 'P').y - base).toBeCloseTo(160, 1);
    // space-between では行を伸ばさず、項目の高さは決まらないので 0
    expect(first(await glyphs(cover('space-between'), 'browser'), 'P').y).toBeCloseTo(base, 1);
  });
  it('WeasyPrint の組み方: align-content: space-between でも、1 つだけの行は容器の高さ', async () => {
    const base = first(await glyphs(cover('normal').replace('top: 40%', 'top: 0'), 'weasyprint'), 'P').y;
    expect(first(await glyphs(cover('space-between'), 'weasyprint'), 'P').y - base).toBeCloseTo(160, 1);
  });
});

describe('罫線の太さの丸め', () => {
  const width = async (style: HtmlDefaults, w: string) => {
    const t = (await typesetHtml(doc(`p { border-top: ${w} solid #c1c1c1 }`, '<p>A</p>'), { loadFont: loadCachedFont, style })).areaTree;
    let out: number | undefined;
    const rec = (a: AreaNode) => {
      out ??= a.border?.top?.width;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(t.sheets[0]);
    return out;
  };
  it('ブラウザの組み方は 1px (0.75pt) に切り上げ、WeasyPrint の組み方は丸めない', async () => {
    expect(await width('browser', '0.3pt')).toBeCloseTo(0.75, 3);
    expect(await width('weasyprint', '0.3pt')).toBeCloseTo(0.3, 3);
    // 1px より太い線も、WeasyPrint の組み方は端数を残す (ブラウザは画素に切り捨てる)
    expect(await width('browser', '2pt')).toBeCloseTo(1.5, 3);
    expect(await width('weasyprint', '2pt')).toBeCloseTo(2, 3);
  });
  it('既定のスタイル (kumiori) も丸めない (PDF には画面の画素が無い)。vivliostyle はブラウザと同じに丸める', async () => {
    expect(await width('kumiori', '0.3pt')).toBeCloseTo(0.3, 3);
    expect(await width('kumiori', '2pt')).toBeCloseTo(2, 3);
    expect(await width('vivliostyle', '0.3pt')).toBeCloseTo(0.75, 3);
  });
});
