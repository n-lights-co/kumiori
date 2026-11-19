/**
 * CSS の値の読み方:
 *  - 計算値の長さを絶対の長さ (px) にする (CSS Values 4 §4.5・各性質の Computed value の “lengths made absolute”): grid-template-columns
 *    (CSS Grid 1 §7.2)・box-shadow (CSS Backgrounds 3 §6.1)・filter の drop-shadow() (Filter Effects 1 §5)。百分率を含む calc() は、
 *    式の中の長さだけを絶対にして、式のまま残す (border-radius・background-position・background-size・object-position)
 *  - 余白の箱・@footnote・::footnote-call・@page の宣言の百分率・calc()・字の大きさのキーワード (CSS Paged Media 3 §4・§5、CSS Fonts 4 §2.4)
 *  - 負の値が無効な性質の負の値は、宣言ごと捨てる (CSS Syntax 3・各性質の値の範囲)。calc() の結果は、範囲に切り詰める (CSS Values 4 §10.12)
 *  - 有効な 0 (グラデーションの背景の大きさ・画像の width・rowspan・絶対配置の擬似要素の width) を、指定なしにしない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { querySelectorAll } from '../src/cssSelector';
import { gridTracks, importHtml, shadowsOf } from '../src/htmlImport';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const parse = (html: string) => new DOMParser().parseFromString(`<!DOCTYPE html><html><head><title>t</title></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
/** #x の計算値 (親 #p の字の大きさ 20px、#x の字の大きさ 10px、根元の字の大きさ 16px) */
function computed(prop: string, decls: string, css = '', tag = 'div'): string {
  const doc = parse(`<div id="p" style="font-size:20px"><${tag} id="x" style="font-size:10px; ${decls}"><span id="c" style="font-size: 20px">c</span></${tag}></div>`);
  const cs = cascadeStyles(doc, HTML_UA_CSS + ` html { font-size: 16px } ${css}`);
  return cs.style(querySelectorAll(doc, '#x')[0]).getPropertyValue(prop);
}
/** #x の子 #c (字の大きさ 20px) の計算値 */
function childComputed(prop: string, decls: string, childDecls: string): string {
  const doc = parse(`<div id="x" style="font-size:10px; ${decls}"><div id="c" style="font-size: 20px; ${childDecls}">c</div></div>`);
  const cs = cascadeStyles(doc, HTML_UA_CSS + ' html { font-size: 16px }');
  return cs.style(querySelectorAll(doc, '#c')[0]).getPropertyValue(prop);
}

const imp = (body: string, css = '') => {
  const d = parse(body);
  const all = `@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10px } ${css}`;
  return importHtml(d, cascadeStyles(d, all, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: all }).document;
};
/** 木の中で、条件に合う最初の節 */
function find(n: unknown, test: (o: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(n)) {
    for (const k of n) {
      const r = find(k, test);
      if (r) return r;
    }
  } else if (n && typeof n === 'object') {
    const o = n as Record<string, unknown>;
    if (test(o)) return o;
    for (const v of Object.values(o)) {
      const r = find(v, test);
      if (r) return r;
    }
  }
  return undefined;
}

describe('計算値の長さを絶対の長さにする', () => {
  it('grid-template-columns の em・rem・calc()・minmax()・repeat() の中の長さ (CSS Grid 1 §7.2)', () => {
    expect(computed('grid-template-columns', 'grid-template-columns: 5em 1fr')).toBe('50px 1fr');
    expect(computed('grid-template-columns', 'grid-template-columns: 5rem 1fr')).toBe('80px 1fr');
    expect(computed('grid-template-columns', 'grid-template-columns: calc(10px + 1em) 1fr')).toBe('20px 1fr');
    expect(computed('grid-template-columns', 'grid-template-columns: minmax(5em, 1fr) 3em')).toBe('minmax(50px, 1fr) 30px');
    expect(computed('grid-template-columns', 'grid-template-columns: repeat(2, 5em) [end] fit-content(2em)')).toBe('repeat(2, 50px) [end] fit-content(20px)');
    // 百分率・fr・語はそのまま
    expect(computed('grid-template-columns', 'grid-template-columns: 10% 2fr auto min-content')).toBe('10% 2fr auto min-content');
    // 受け継いだ値 (inherit) は親の計算値 (子の字の大きさで計算し直さない)
    expect(childComputed('grid-template-columns', 'grid-template-columns: 5em 1fr', 'grid-template-columns: inherit')).toBe('50px 1fr');
  });

  it('grid の列: em・rem・calc() の列の幅を読み、0fr を 1fr にしない (§7.2.4)', () => {
    const cols = (tpl: string) => {
      const doc = imp(`<div style="display:grid;width:300px;grid-template-columns: ${tpl}"><div>a</div><div>b</div></div>`);
      // 容器の幅で伸びる列は比例の列 ('N*' と、足す長さ widthExtra) なので、容器の幅 (225pt) で分けた幅にする
      const columns = find(doc, (o) => o.type === 'table')!.columns as Array<{ width: number | string; widthExtra?: number }>;
      const fixedSum = columns.reduce((a, c) => a + (typeof c.width === 'number' ? c.width : (c.widthExtra ?? 0)), 0);
      const starSum = columns.reduce((a, c) => a + (typeof c.width === 'string' ? parseFloat(c.width) : 0), 0);
      return columns.map((c) => (typeof c.width === 'number' ? c.width : (c.widthExtra ?? 0) + ((225 - fixedSum) * parseFloat(c.width)) / starSum));
    };
    // 幅 300px = 225pt。5em = 50px = 37.5pt
    expect(cols('5em 1fr')).toEqual([37.5, 187.5]);
    expect(cols('5rem 1fr')).toEqual([60, 165]);
    expect(cols('calc(40px + 10px) 1fr')).toEqual([37.5, 187.5]);
    expect(cols('3em minmax(5em, 1fr)')).toEqual([22.5, 202.5]);
    // 0fr の列は、余りを取らず、中身の最も狭い幅になる
    expect(gridTracks('0fr 1fr', 225, 0)).toEqual([0, 225]);
    expect(gridTracks('0fr 1fr', 225, 0, () => 10)).toEqual([10, 215]);
    // 中身の最も狭い幅は、組版エンジンが、組むときに測る (読み込みは、項目のセルと列を gridTemplate.items に渡す。
    // 組んだ幅は gridItemMinContent.test.ts)
    const doc = imp(`<div style="display:grid;width:300px;grid-template-columns: 0fr 1fr"><div>a</div><div>b</div></div>`);
    const g = (find(doc, (o) => o.type === 'table') as { gridTemplate?: { items?: Array<{ col: number; floor?: number }> } }).gridTemplate;
    expect(g?.items?.map((x) => [x.col, x.floor])).toEqual([
      [0, undefined],
      [1, undefined],
    ]);
    // fr の和が 1 より小さければ、余りのその割合だけを配る (§12.7.1)
    expect(gridTracks('0.25fr 0.25fr', 200, 0)).toEqual([50, 50]);
  });

  it('grid の列の並びの読み方: 括弧の中の空白で分けない・線の名前を列に数えない・repeat(auto-fill) の回数 (CSS Grid 1 §7.2)', () => {
    // 百分率と長さの和・min() は、容器の幅に対する割合で解く (前は calc(10% + 16px) を 3 つの列にして、幅が NaN になった)
    expect(gridTracks('calc(10% + 16px) 1fr', 300, 0)).toEqual([42, 258]);
    expect(gridTracks('80px 1fr 0fr calc(10% + 16px)', 300, 0)).toEqual([60, 198, 0, 42]);
    expect(gridTracks('min(160px, 50%) 1fr', 300, 0)).toEqual([120, 180]);
    // 線の名前 ([a]・[a b]) は列ではない
    expect(gridTracks('[a] 80px [b] 1fr [c]', 300, 0)).toEqual([60, 240]);
    expect(gridTracks('[a b] 1fr [c d]', 300, 0)).toEqual([300]);
    expect(gridTracks('repeat(2, [x] 10px)', 300, 0)).toEqual([7.5, 7.5]);
    // repeat(auto-fill, …): 容器の幅に入る最大の回数 (minmax の最大が fr なら、最小の 80px = 60pt で数える。間隔も数える)
    expect(gridTracks('repeat(auto-fill, minmax(80px, 1fr))', 300, 0)).toHaveLength(5);
    expect(gridTracks('repeat(auto-fill, minmax(80px, 1fr))', 300, 10)).toHaveLength(4);
    expect(gridTracks('repeat(auto-fit, 100px)', 300, 0)).toHaveLength(4);
    expect(gridTracks('repeat(auto-fill, 1fr)', 300, 0)).toHaveLength(1);
    // 百分率だけの列も、容器の幅で解いて回数を数える (calc(10% + 0px) と同じ)
    for (const v of ['repeat(auto-fill, 10%)', 'repeat(auto-fill, calc(10% + 0px))']) expect(gridTracks(v, 400, 0).map((x) => Math.round(x * 100) / 100), v).toEqual(Array(10).fill(40));
    // 無効な並びは、宣言ごと無効 (none と同じ 1 列): 負の大きさ・auto-fill と fr の列・repeat() の入れ子 (CSS Grid 1 §7.2.1・§7.2.3)
    expect(gridTracks('repeat(auto-fill, -10px)', 400, 0)).toEqual([400]);
    expect(gridTracks('-10px 1fr', 400, 0)).toEqual([400]);
    expect(gridTracks('1fr repeat(auto-fill, 50px) 1fr', 400, 0)).toEqual([400]);
    expect(gridTracks('repeat(2, repeat(2, 1fr))', 400, 0)).toEqual([400]);
    // ほかの列の分を引いた残りに入る回数 (50px = 37.5pt の残り 362.5pt に 75pt が 4 回)
    expect(gridTracks('50px repeat(auto-fill, 100px)', 400, 0)).toHaveLength(5);
    // 組んだ結果に NaN が出ない
    const t = find(imp('<div style="display:grid;width:300px;grid-template-columns:calc(10% + 1em) 1fr"><div>a</div><div>b</div></div>'), (o) => o.type === 'table')!;
    expect(JSON.stringify(t)).not.toMatch(/NaN|null/);
    expect((t.columns as unknown[]).length).toBe(2);
  });
  it('box-shadow・filter の drop-shadow() の em・rem・calc() (CSS Backgrounds 3 §6.1)', () => {
    expect(computed('box-shadow', 'box-shadow: 1em 2em 0.5em red')).toBe('10px 20px 5px red');
    expect(computed('box-shadow', 'box-shadow: 1px 1px red, 1em 1em blue')).toBe('1px 1px red, 10px 10px blue');
    expect(computed('box-shadow', 'box-shadow: calc(1px + 2px) 0.1rem rgb(0 0 0 / 50%)')).toBe('3px 1.6px rgb(0 0 0 / 50%)');
    expect(computed('box-shadow', '--s: 1em; box-shadow: var(--s) var(--s) red')).toBe('10px 10px red');
    expect(computed('filter', 'filter: drop-shadow(1em 1em 0 red) blur(0.2em)')).toBe('drop-shadow(10px 10px 0 red) blur(2px)');
    expect(childComputed('box-shadow', 'box-shadow: 1em 1em red', 'box-shadow: inherit')).toBe('10px 10px red');
    // 影の長さとして読む (px × 0.75 = pt)
    expect(shadowsOf(computed('box-shadow', 'box-shadow: 1em 2em 0.5em red'))).toEqual([{ dx: 7.5, dy: 15, blur: 3.75, color: 'red' }]);
    expect(shadowsOf('none', computed('filter', 'filter: drop-shadow(1em 1em 0 red)'))).toEqual([{ dx: 7.5, dy: 7.5, color: 'red' }]);
  });

  it('border-radius の百分率を含む calc() は、式のまま残し、箱の大きさで解く (CSS Backgrounds 3 §5.1)', () => {
    expect(computed('border-top-left-radius', 'border-radius: calc(10% + 1em)')).toBe('calc(10% + 10px)');
    const doc = imp('<div style="width:100px;height:50px;border:1px solid;border-radius: calc(10% + 10px)">x</div>');
    const r = find(doc, (o) => !!o.borderRadius)!.borderRadius as { corners: unknown[] };
    expect(r.corners[0]).toEqual([{ pct: 10, len: 7.5 }, { pct: 10, len: 7.5 }]);
  });
});

const PNG = encodePngStored({ width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4).fill(200) });
const files = [{ name: 'a.png', data: PNG }];
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 10pt } html { font-size: 10pt } body { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string, opts: { style?: 'ah' } = {}) => typesetHtml(html, { name: 't.html', loadFont: loadCachedFont, files, ...opts });
/** 背景の画像のある最初の領域の、背景の画像 */
const bgOf = (t: AreaTree) => {
  let hit: Area | undefined;
  walkAreaTree(t, (a) => {
    if (!hit && a.backgroundImage) hit = a;
  });
  return hit?.backgroundImage;
};

describe('グラデーションの背景の大きさ (CSS Backgrounds 3 §3.9)', () => {
  const grad = async (size: string) => {
    const b = bgOf((await set(page(`<div style="height:20pt;background:linear-gradient(red,blue) no-repeat;background-size:${size}">a</div>`))).areaTree);
    return b && { width: Math.round(b.width! * 100) / 100, height: Math.round(b.height! * 100) / 100 };
  };
  it('百分率は、背景の位置の領域に対する割合', async () => {
    // 箱は 280×20pt
    expect(await grad('50% 100%')).toMatchObject({ width: 140, height: 20 });
    expect(await grad('25%')).toMatchObject({ width: 70, height: 20 });
    expect(await grad('auto 50%')).toMatchObject({ width: 280, height: 10 });
    expect(await grad('calc(50% + 10pt) 4pt')).toMatchObject({ width: 150, height: 4 });
  });
  it('幅か高さが 0 なら描かない (0 を指定なしにしない)', async () => {
    for (const s of ['0% 2px', '0 0', '50% 0', '0 auto']) {
      const b = await grad(s);
      expect(!b || b.width === 0 || b.height === 0, s).toBe(true);
    }
  });
  it('@page と、根元の要素 (html・body。ページへ伝わる: §2.11.1) のグラデーションの背景も、大きさ・繰り返しを読む', async () => {
    // 用紙 300pt 角・余白 10pt。@page の背景の領域は用紙の全体 (300pt)、根元の要素の背景は、ページの余白の内側 (280pt)
    const sheetBg = async (css: string) => {
      const sh = (await set(page('<p>a</p>', css))).areaTree.sheets[0];
      const b = sh.backgroundImage;
      return b && { width: Math.round(b.width! * 100) / 100, height: Math.round(b.height! * 100) / 100, repeat: b.repeat };
    };
    expect(await sheetBg('@page { background: linear-gradient(red, blue) no-repeat; background-size: 50% 100% }')).toEqual({ width: 150, height: 300, repeat: 'no-repeat' });
    expect(await sheetBg('@page { background: linear-gradient(red, blue); background-size: 40pt 20pt }')).toMatchObject({ width: 40, height: 20 });
    expect(await sheetBg('@page { background: linear-gradient(red, blue) }')).toMatchObject({ width: 300, height: 300 });
    expect(await sheetBg('html { background: linear-gradient(red, blue) no-repeat; background-size: 50% 100% }')).toEqual({ width: 140, height: 280, repeat: 'no-repeat' });
    expect(await sheetBg('body { background: linear-gradient(red, blue) }')).toMatchObject({ width: 280, height: 280 });
  });
  it('長さと auto は、これまでどおり', async () => {
    expect(await grad('40pt 5pt')).toMatchObject({ width: 40, height: 5 });
    expect(await grad('auto')).toMatchObject({ width: 280, height: 20 });
    expect(await grad('cover')).toMatchObject({ width: 280, height: 20 });
  });
});

describe('百分率と長さの和の calc() (CSS Values 4 §10.11)', () => {
  const bgImg = (decls: string) => find(imp(`<div style="width:100px;height:50px;background: url(a.png) no-repeat; ${decls}">x</div>`), (o) => !!o.backgroundImage)!.backgroundImage as Record<string, unknown>;
  it('background-position: 百分率の位置に長さを足す', () => {
    expect(computed('background-position-x', 'background-position: calc(50% + 1em) 0')).toBe('calc(50% + 10px)');
    expect(bgImg('background-position: calc(50% + 1em) 0')).toMatchObject({ x: '50%', xOffset: 7.5, y: 0 });
    expect(bgImg('background-position: right calc(10% + 1em) top 0')).toMatchObject({ x: '90%', xOffset: -7.5, y: 0 });
    // これまでどおり読めていたもの
    expect(bgImg('background-position: right 1em bottom 10%')).toMatchObject({ x: 7.5, xFromEnd: true, y: '90%' });
  });
  it('background-size: 百分率の大きさに長さを足す', () => {
    expect(computed('background-size', 'background-size: calc(50% + 1em)')).toBe('calc(50% + 10px) auto');
    expect(bgImg('background-size: calc(50% + 1em) 4px')).toMatchObject({ widthPct: 0.5, widthOffset: 7.5, height: 3 });
  });
  it('object-position: 百分率の位置に長さを足す', () => {
    const img = find(imp('<img src="a.png" style="width:40px;height:40px;object-fit:none;object-position: calc(50% + 10px) 0">'), (o) => o.type === 'image')!;
    expect(img.fitPosition).toEqual({ x: '50%', y: 0, xOffset: 7.5 });
  });
});

describe('余白の箱・@footnote・::footnote-call・@page の宣言の百分率・calc()・キーワード (CSS Paged Media 3 §4・§5)', () => {
  const seqOf = (css: string, body = '<p>abc</p>') => {
    const all = `@page { size: 300pt 300pt; margin: 40pt } html { font-size: 10pt } body { margin: 0 } ${css}`;
    const d = parse(body);
    return importHtml(d, cascadeStyles(d, all, { uaCss: HTML_UA_CSS }), { css: all }).document.sequences[0];
  };
  const box = (css: string) => (seqOf(`@page { ${css} }`).staticContent as unknown as Array<Record<string, unknown>>).find((b) => (b.children as unknown[])?.length) as Record<string, unknown>;
  const text = (css: string) => (box(css).children as Array<Record<string, unknown>>)[0];
  it('余白の箱の font-size: 百分率・calc()・キーワードは、ページの文脈の字の大きさに対して (CSS Fonts 4 §2.4)', () => {
    expect(text('@top-center { content: "XY"; font-size: 150% }').fontSize).toBeCloseTo(15, 3);
    expect(text('@top-center { content: "XY"; font-size: calc(10pt + 5pt) }').fontSize).toBeCloseTo(15, 3);
    expect(text('@top-center { content: "XY"; font-size: x-large }').fontSize).toBeCloseTo(18, 3);
    expect(text('@top-center { content: "XY"; font-size: 1.5em }').fontSize).toBeCloseTo(15, 3);
    expect(text('font-size: 20pt; @bottom-center { content: "XY"; font-size: 80% }').fontSize).toBeCloseTo(16, 3);
    expect(text('font-size: 150%; @top-center { content: "XY" }').fontSize).toBeCloseTo(15, 3);
  });
  it('余白の箱の width・padding・letter-spacing・罫線の太さの calc()', () => {
    expect(box('@top-left { content: "XY"; width: calc(50pt + 10pt) }').width).toBeCloseTo(60, 6);
    expect(box('@top-left { content: "XY"; width: calc(10% + 2pt) }').width).toBeCloseTo(24, 6);
    expect((box('@top-center { content: "XY"; padding-left: calc(5pt * 2) }').padding as Record<string, number>).left).toBe(10);
    expect((box('@top-center { content: "XY"; padding: calc(1pt + 1pt) 3pt }').padding as Record<string, number>).top).toBe(2);
    expect(text('@top-center { content: "XY"; letter-spacing: calc(2pt + 3pt) }').letterSpacing).toBe(5);
    expect((box('@top-center { content: "XY"; border-bottom: calc(1pt + 1pt) solid red }').border as Record<string, { width: number }>).bottom.width).toBe(2);
  });
  it('::footnote-call の font-size の百分率・@footnote の margin-top の calc()', () => {
    const fn = (css: string) => seqOf(`.fn { float: footnote; font-size: 10pt } ${css}`, '<p>abc<span class="fn">note</span> def</p>').footnotes as unknown as Record<string, unknown>;
    expect(fn('::footnote-call { font-size: 50% }').referenceScale).toBe(0.5);
    expect(fn('::footnote-call { font-size: 0.5em }').referenceScale).toBe(0.5);
    expect((fn('@page { @footnote { margin-top: calc(5pt + 5pt); border-top: 1pt solid } }').separator as Record<string, number>).spaceBefore).toBe(10);
  });
  it('@page の余白の calc() の百分率は、用紙の幅・高さに対して (前の @page の余白を、既定の余白に戻さない)', () => {
    const MM = 25.4 / 72;
    const m = seqOf('@page { margin-left: calc(10% + 10pt) }').master.margins as Record<string, number>;
    expect(m.left).toBeCloseTo(40 * MM, 6);
    expect(m.top).toBeCloseTo(40 * MM, 6);
  });
  it('@page の背景の位置・大きさの calc() の百分率', () => {
    const bi = seqOf('@page { background: url(a.png) no-repeat; background-position: calc(50% + 1em) 0; background-size: calc(50% + 2pt) auto }').master.backgroundImage as unknown as Record<string, unknown>;
    expect(bi).toMatchObject({ x: '50%', widthPct: 0.5, widthOffset: 2 });
    expect(bi.xOffset).toBeCloseTo(10, 3);
  });
});

describe('負の値が無効な性質の負の値は、宣言ごと捨てる', () => {
  it('padding・width・min-*・max-*・gap・column-width・flex-basis・font-size・background-size の負の長さ', () => {
    expect(computed('padding-left', 'padding-left: 3px; padding-left: -10px')).toBe('3px');
    // UA の既定 (ul の padding-inline-start: 40px) が残る
    expect(computed('padding-left', '', 'ul { padding-left: -20pt }', 'ul')).toBe('40px');
    expect(computed('padding-left', 'padding-inline-start: -2em', '', 'ul')).toBe('40px');
    expect(computed('width', 'width: -10px')).toBe('auto');
    expect(computed('height', 'height: -1em')).toBe('auto');
    expect(computed('max-width', 'max-width: -10px')).toBe('none');
    expect(computed('min-height', 'min-height: -5%')).toBe('auto');
    expect(computed('column-gap', 'column-gap: -5px')).toBe('normal');
    expect(computed('row-gap', 'gap: 4px; row-gap: -5px')).toBe('4px');
    expect(computed('column-width', 'column-width: -5px')).toBe('auto');
    expect(computed('flex-basis', 'flex-basis: -10px')).toBe('auto');
    expect(computed('font-size', 'font-size: -1em')).toBe('10px');
    expect(computed('background-size', 'background-size: -10px')).toBe('auto');
    expect(computed('background-size', 'background-size: 5px, -1em auto')).toBe('auto');
    expect(computed('background-size', 'background: url(a.png) 0 0 / -1em')).toBe('auto');
  });
  it('-0・-0px・-0% は 0 (負の値ではない。範囲の検査は数の値で見る: CSS Values 4 §4.1・§5)', () => {
    expect(computed('width', 'width: -0px')).toBe('0px');
    expect(computed('width', 'width: -0')).toBe('0px');
    expect(computed('padding-left', 'padding-left: -0')).toBe('0px');
    expect(computed('padding-left', 'padding: -0 10px')).toBe('10px');
    expect(computed('padding-top', 'padding: -0 10px')).toBe('0px');
    expect(computed('padding-left', 'padding-left: -0.0em')).toBe('0px');
    expect(computed('font-size', 'font-size: -0px')).toBe('0px');
    expect(computed('padding-left', 'padding-left: -0%')).toBe(computed('padding-left', 'padding-left: 0%'));
    expect(computed('padding-left', 'padding-left: 5px; padding-left: -0e3px')).toBe('0px');
    expect(computed('background-size', 'background-size: -0px 3px')).toBe('0px 3px');
    // UA の字下げ (ul の padding-inline-start: 40px) を -0 で消せる
    const doc = parse('<ul id="x"><li>a</li></ul>');
    const cs = cascadeStyles(doc, HTML_UA_CSS + ' ul { padding-left: -0 }');
    expect(cs.style(querySelectorAll(doc, '#x')[0]).getPropertyValue('padding-left')).toBe('0px');
    // 0 より小さい値は、これまでどおり捨てる
    expect(computed('width', 'width: -0.01px')).toBe('auto');
    expect(computed('padding-left', 'padding-left: 3px; padding-left: -.5px')).toBe('3px');
  });
  it('calc() の負の結果は、0 に切り詰める (CSS Values 4 §10.12)', () => {
    expect(computed('padding-left', 'padding-left: calc(10px - 20px)')).toBe('0px');
    expect(computed('width', 'width: calc(1em - 20px)')).toBe('0px');
    expect(computed('font-size', 'font-size: calc(1px - 2px)')).toBe('0px');
    expect(computed('background-size', 'background-size: calc(1px - 2px) 3px')).toBe('0px 3px');
    expect(computed('border-left-width', 'border-left: calc(1px - 3px) solid')).toBe('0px');
  });
  it('負が有効な性質は、これまでどおり負の値を使う', () => {
    expect(computed('margin-left', 'margin-left: -10px')).toBe('-10px');
    expect(computed('letter-spacing', 'letter-spacing: -1px')).toBe('-1px');
    expect(computed('word-spacing', 'word-spacing: -2px')).toBe('-2px');
    expect(computed('text-indent', 'text-indent: -1em')).toBe('-10px');
    expect(computed('vertical-align', 'vertical-align: -2px')).toBe('-2px');
    expect(computed('outline-offset', 'outline-offset: -3px')).toBe('-3px');
    expect(computed('top', 'position: relative; top: -5px')).toBe('-5px');
    expect(computed('z-index', 'position: relative; z-index: -1')).toBe('-1');
    expect(computed('order', 'order: -1')).toBe('-1');
    expect(computed('background-position-x', 'background-position: -5px 0')).toBe('-5px');
  });
  it('組んだ結果: 負の padding で行が領域からはみ出さず、負の column-gap で段が重ならない', () => {
    const blk = find(imp('<div style="padding-left:-10px">a</div>'), (o) => o.type === 'block')!;
    expect(blk.padding).toBeUndefined();
    const ul = find(imp('<ul><li>a</li></ul>', 'ul { padding-left: -20pt }'), (o) => o.type === 'list-block' || o.type === 'block')!;
    expect(JSON.stringify(ul)).not.toMatch(/-15|-20/);
    const mc = find(imp('<div style="columns: 2; column-gap: -5px">a</div>'), (o) => o.columnCount !== undefined || o.columns !== undefined);
    expect(JSON.stringify(mc ?? {})).not.toMatch(/"(columnGap|gap)":-/);
  });
});

describe('有効な 0 を指定なしにしない・字間の百分率', () => {
  it('画像の width: 0 (style・属性) を読む (CSS 2.1 §10.2・HTML §15.4.3)', () => {
    const img = (html: string) => find(imp(html), (o) => o.type === 'image')!;
    expect(img('<img src="a.png" style="width:0;height:10px">')).toMatchObject({ width: 0, height: 7.5 });
    expect(img('<img src="a.png" width="0" height="0">')).toMatchObject({ width: 0, height: 0 });
    // 0 でない値は、これまでどおり
    expect(img('<img src="a.png" width="20">')).toMatchObject({ width: 15 });
  });
  it('rowspan="0" は、行のまとまりの残りの行すべて (HTML §4.9.11)', () => {
    const cell = (html: string) => find(imp(html), (o) => o.type === 'table-cell')!;
    expect(cell('<table><tr><td rowspan="0">a</td><td>b</td></tr><tr><td>c</td></tr><tr><td>d</td></tr></table>').rowSpan).toBe(3);
    expect(cell('<table><tbody><tr><td rowspan="0">a</td><td>b</td></tr><tr><td>c</td></tr></tbody><tbody><tr><td>d</td></tr></tbody></table>').rowSpan).toBe(2);
    expect(cell('<table><tr><td rowspan="0">a</td></tr></table>').rowSpan).toBeUndefined();
  });
  it('絶対配置の ::before の width: 0 は、中身の幅に広げない', () => {
    const doc = imp('<p class="x">a</p>', ".x { position: relative } .x::before { content: 'abc def'; position: absolute; top: 20pt; width: 0 }");
    const box = find(doc, (o) => o.type === 'block-container' && o.absolutePosition === true)!;
    expect(box.width).toBe(0);
    expect(box.shrinkToFit).toBeUndefined();
  });
  it('letter-spacing・word-spacing の百分率は、字の大きさに対する割合 (CSS Text 4 §8.1・§8.2)', () => {
    expect(computed('letter-spacing', 'letter-spacing: 10%')).toBe('10%');
    expect(childComputed('letter-spacing', 'letter-spacing: 10%', '')).toBe('10%');
    const blk = (html: string) => find(imp(html), (o) => o.type === 'block')!;
    // 字の大きさ 10px = 7.5pt
    expect(blk('<div style="letter-spacing:10%">abc</div>').letterSpacing).toBeCloseTo(0.75, 6);
    expect(blk('<div style="word-spacing:20%">a b</div>').wordSpacing).toBeCloseTo(1.5, 6);
    expect(blk('<div style="letter-spacing:calc(10% + 1px)">abc</div>').letterSpacing).toBeCloseTo(1.5, 6);
    // 受け継いだ子は、子の字の大きさで解く (20px = 15pt の 10%)
    const doc = imp('<div style="letter-spacing:10%"><p style="font-size:20px">abc</p></div>');
    expect(find(doc, (o) => o.type === 'block' && o.fontSize === 15)!.letterSpacing).toBeCloseTo(1.5, 6);
  });
});
