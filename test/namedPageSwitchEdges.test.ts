/**
 * 名前付きのページ (CSS Paged Media 3 §8) の切り替えの端の場合:
 *  - html・body の page (文書の最初のページの名前) の文書で、最初の流れの箱より前の絶対配置・固定配置の箱は、最初のページの領域を基準にする
 *    (CSS 2.1 §10.1 の 3: 初期包含ブロックの大きさはページの領域。CSS Paged Media 3 §3.3)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

// 用紙 400pt 四方。名前の無いページの余白は 50pt (領域 300pt)、wide は 10pt (380pt)
const PAGES = '@page { size: 400pt 400pt; margin: 50pt } @page wide { margin: 10pt } ';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 組んだ結果: ページ数・赤い箱 (.r) のページの番号 (0 から)・左上・大きさ・警告・ページごとの字 */
async function set(body: string, css = '', opts: Record<string, unknown> = {}, bodyAttr = '') {
  const html = `<!DOCTYPE html><html><head><style>body { margin: 0; font-size: 10pt } p { margin: 0 } .r { background: #f00 } ${PAGES} ${css}</style></head><body ${bodyAttr}>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont, ...opts });
  const boxes: Array<{ page: number; x: number; y: number; w: number; h: number }> = [];
  const texts: string[] = [];
  r.areaTree.sheets.forEach((sh, page) => {
    let t = '';
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; text?: string; backgroundColor?: unknown; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      if (a.type === 'glyph') t += g.text ?? '';
      if (a.type !== 'glyph' && g.backgroundColor && /255, 0, 0|f00/i.test(JSON.stringify(g.backgroundColor))) boxes.push({ page, x: r2(x), y: r2(y), w: r2(g.width ?? 0), h: r2(g.height ?? 0) });
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
    texts.push(t);
  });
  const warnings = (r.warnings ?? []).map((w) => (typeof w === 'string' ? w : ((w as { message?: string }).message ?? JSON.stringify(w))));
  return { pages: r.areaTree.sheets.length, boxes, texts, warnings };
}

describe('body・html の page の文書の、最初の流れの箱より前の絶対配置・固定配置の箱', () => {
  const abs = (s: string) => `<div class="r" style="position:${s};width:20pt;height:10pt"></div><p>a</p>`;
  it('最初のページ (wide) の領域を基準にする (section に page を書いたときと同じ)', async () => {
    // body の page で書いても、最初の section の page で書いても同じ
    const ways = [(b: string) => set(b, 'body { page: wide }'), (b: string) => set(`<section style="page:wide">${b}</section>`)];
    for (const way of ways) {
      expect((await way(abs('absolute;top:0;left:0'))).boxes[0]).toMatchObject({ x: 10, y: 10 });
      // top の百分率は、ページの領域の高さ (380pt) に、left・right の百分率は、ページの領域の幅 (380pt) に対して (CSS 2.1 §10.1 の 3)
      expect((await way(abs('absolute;top:10%;left:10%'))).boxes[0]).toMatchObject({ x: 48, y: 48 });
      expect((await way(abs('absolute;top:0;right:calc(10% + 2pt)'))).boxes[0]).toMatchObject({ x: 330, y: 10 });
      expect((await way(abs('absolute;top:10%;left:10%'))).boxes[0]).toEqual((await ways[1](abs('absolute;top:10%;left:10%'))).boxes[0]);
      expect((await way(abs('fixed;right:0;bottom:0'))).boxes[0]).toMatchObject({ x: 370, y: 380 });
    }
    // html の page も同じ
    expect((await set(abs('absolute;top:0;left:0'), 'html { page: wide }')).boxes[0]).toMatchObject({ x: 10, y: 10 });
  });
  it('名前の無いページの文書は、これまでどおり', async () => {
    expect((await set(abs('absolute;top:0;left:0'))).boxes[0]).toMatchObject({ x: 50, y: 50 });
  });
});

describe('リストの 2 番目より後ろの項目の page の auto (大文字小文字を区別しない。CSS Values 4 §2.1 のキーワード)', () => {
  it('page: AUTO・Auto は、親のページの名前 (改ページしない)', async () => {
    for (const v of ['AUTO', 'Auto', ' auto ']) {
      for (const ls of ['', 'list-style:none']) {
        const r = await set(`<p>a</p><ul style="page:wide;${ls}"><li>a</li><li style="page:${v}">b<div class="r" style="width:100%">x</div></li></ul>`);
        expect(r.pages, `${v} ${ls}`).toBe(2);
        // 箱は wide のページ (2 ページ目) の、リストの字下げの内側 (領域 380pt から字下げ 20pt を引いた幅) に収まる
        expect(r.boxes, `${v} ${ls}`).toEqual([{ page: 1, x: 30, y: expect.any(Number), w: 360, h: expect.any(Number) }]);
      }
    }
  });
  it('名前を書いた項目は、これまでどおり切り替える', async () => {
    const r = await set('<p>a</p><ul><li>a</li><li style="page:wide">b<div class="r" style="width:100%">x</div></li></ul>');
    expect(r.pages).toBe(2);
    expect(r.boxes[0]).toMatchObject({ page: 1, x: 30, w: 360 });
  });
});

describe('切り替えを置けない所の page の、未対応の知らせ', () => {
  const ignored = (w: string[]) => w.filter((m) => /page \(/.test(m));
  it('そこで使われているページの名前と同じなら、知らせない (切り替えが要らない)', async () => {
    for (const [body, css] of [
      ['<div style="page:wide"><div style="display:flex"><section style="page:wide">s</section></div></div>', ''],
      ['<table><tr><td><div style="page:wide">c</div></td></tr></table>', 'body { page: wide }'],
      ['<div style="page:wide"><div style="columns:2"><div style="page:wide">m</div></div></div>', ''],
      ['<table><tr><td><ul><li>a</li><li style="page:wide">b</li></ul></td></tr></table>', 'body { page: wide }'],
      ['<table><tr style="page:wide"><td>a</td></tr></table>', 'body { page: wide }'],
      ['<div style="display:grid"><div style="page:wide">g</div></div>', 'html { page: wide }'],
    ])
      expect(ignored((await set(body, css)).warnings), body).toEqual([]);
  });
  it('名前が違えば、これまでどおり知らせる', async () => {
    for (const [body, css] of [
      ['<div style="page:wide"><div style="display:flex"><section style="page:narrow">s</section></div></div>', '@page narrow { margin: 100pt }'],
      ['<table><tr><td><div style="page:narrow">c</div></td></tr></table>', 'body { page: wide } @page narrow { margin: 100pt }'],
      ['<table><tr><td><div style="page:wide">c</div></td></tr></table>', ''],
    ])
      expect(ignored((await set(body, css)).warnings).length, body).toBe(1);
  });
});

describe('段組 (column-width だけのものも) と running() の中の page は、ページの名前を進めない', () => {
  it('column-width の段組の中の page は無視して知らせ、後ろの section は切り替わる', async () => {
    for (const mc of ['column-width:100pt', 'columns:100pt', 'column-width:500pt', 'column-count:2']) {
      const r = await set(`<p>a</p><div style="${mc}"><div style="page:wide">i</div></div><section style="page:wide"><div class="r" style="width:100%">x</div></section>`);
      expect(r.pages, mc).toBe(2);
      expect(r.boxes, mc).toEqual([{ page: 1, x: 10, y: 10, w: 380, h: expect.any(Number) }]);
      expect(r.warnings.filter((m) => /page \(/.test(m)).length, mc).toBe(1);
    }
  });
  it('running() の中の page は、後ろの切り替えを消さない', async () => {
    const r = await set(
      '<p>a</p><div style="position:running(hd)"><p style="page:wide">h</p></div><section style="page:wide"><div class="r" style="width:100%">x</div></section>',
      '@page { @top-center { content: element(hd) } }',
    );
    expect(r.pages).toBe(2);
    expect(r.boxes).toEqual([{ page: 1, x: 10, y: 10, w: 380, h: expect.any(Number) }]);
  });
});

describe('page のカウンター (counter-reset・counter-set の page) と、同じ名前のページ', () => {
  const nums = async (body: string, css: string, opts: Record<string, unknown> = {}) =>
    (await set(body, `@page { @bottom-center { content: counter(page) } } ${css}`, opts)).texts.map((t) => t.replace(/[a-z]/g, ''));
  it('body { page: x } の中で、同じ名前を書いた、強制の改ページのある箱の counter-reset: page は、その改ページで効く', async () => {
    const body = '<p>a</p><section style="page:wide;counter-reset:page 5;break-before:page">b</section>';
    // 名前の切り替わる文書 (body に page を書かない) と同じ番号 (ページ番号の振り直しのために、白のページは入れない)
    const want = await nums(body, '');
    expect(want).toEqual(['1', '5']);
    expect(await nums(body, 'body { page: wide }')).toEqual(want);
    expect(await nums(body.replace('counter-reset:page 5', 'counter-set:page 5'), 'body { page: wide }')).toEqual(want);
    // 互換のスタイル (ah) は、これまでどおり、5 の前に偶奇を合わせる白のページを入れる
    expect(await nums(body, 'body { page: wide }', { style: 'ah' })).toEqual(['1', '2', '5']);
    expect(await nums(body, '', { style: 'ah' })).toEqual(['1', '2', '5']);
  });
  it('強制の改ページの無い箱・名前を書かない箱は、これまでどおり (切り替えない)', async () => {
    expect(await nums('<p>a</p><section style="page:wide;counter-reset:page 5">b</section>', 'body { page: wide }')).toEqual(['1']);
    expect(await nums('<p>a</p><section style="counter-reset:page 5;break-before:page">b</section>', 'body { page: wide }')).toEqual(['1', '2']);
  });
  it('body・html の counter-reset: page は、最初のページの番号', async () => {
    expect(await nums('<p>a</p><p style="break-before:page">b</p>', 'body { counter-reset: page 3 }')).toEqual(['3', '4']);
    expect(await nums('<p>a</p><p style="break-before:page">b</p>', 'html { counter-reset: page 3 }')).toEqual(['3', '4']);
  });
  it('最初の流れの箱の counter-reset: page は、最初のページの番号 (強制の改ページ・page の無い箱も。body・html のものより強い)', async () => {
    const body = '<h1 style="counter-reset:page 5;margin:0">a</h1><p style="break-before:page">b</p>';
    expect(await nums(body, '')).toEqual(['5', '6']);
    expect(await nums(body, 'body { page: wide }')).toEqual(['5', '6']);
    expect(await nums(body, 'body { counter-reset: page 3 }')).toEqual(['5', '6']);
    // 前に字があっても、改ページしない
    expect((await set(`a${body}`, '')).pages).toBe(2);
  });
});

describe('ページ番号の振り直しの前に、偶奇を合わせる白のページを入れない (CSS Paged Media 3 §6.1。白のページは左右の区切りだけ: CSS Fragmentation 3 §3.1)', () => {
  const nums = async (body: string, css: string, opts: Record<string, unknown> = {}) =>
    (await set(body, `@page { @bottom-center { content: counter(page) } } ${css}`, opts)).texts.map((t) => t.replace(/[a-z]/g, ''));
  const sec = (name: string, extra: string, t: string) => `<section style="page:${name};break-before:page${extra}"><p>${t}</p></section>`;
  it('body の page と同じ名前の章で、番号を 5 にする (1 の次が 5)', async () => {
    const body = `<p>a</p>${sec('wide', ';counter-reset:page 5', 'b')}`;
    expect(await nums(body, 'body { page: wide }')).toEqual(['1', '5']);
    expect(await nums(body, 'body { page: wide }', { style: 'browser' })).toEqual(['1', '5']);
  });
  it('同じ名前のページの章が並び、2 番目の章で番号を 5 にする・数を書かずに振り直す', async () => {
    expect(await nums(`${sec('c', '', 'a')}${sec('c', ';counter-reset:page 5', 'b')}${sec('c', '', 'c')}`, '')).toEqual(['1', '5', '6']);
    expect(await nums(`${sec('c', '', 'a')}${sec('c', ';counter-reset:page', 'b')}`, '')).toEqual(['1', '1']);
    // 最初に名前の切り替わる章でも同じ
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section>', '')).toEqual(['1', '5']);
  });
  it('互換のスタイル (ah・weasyprint・vivliostyle) は、これまでどおり白のページを入れる', async () => {
    const body = `${sec('c', '', 'a')}${sec('c', ';counter-reset:page 5', 'b')}${sec('c', '', 'c')}`;
    for (const style of ['ah', 'weasyprint', 'vivliostyle']) expect(await nums(body, '', { style }), style).toEqual(['1', '2', '5', '6']);
    expect(await nums(`${sec('c', '', 'a')}${sec('c', ';counter-reset:page', 'b')}`, '', { style: 'ah' })).toEqual(['1', '2', '1']);
  });
  it('break-before: right・left・page-break-before: right の白のページは入れる (左右は、ページ番号の偶奇でなく、ページの順で決める)', async () => {
    // 1 の後の right: 2 を白にして 3 から
    expect(await nums('<p>a</p><section style="page:x;break-before:right"><p>b</p></section>', '')).toEqual(['1', '2', '3']);
    // 番号を 5 に振り直す right: 2 枚目 (左ページ) を白にして、3 枚目 (右ページ) を 5 に
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5;break-before:right"><p>b</p></section>', '')).toEqual(['1', '2', '5']);
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 4;page-break-before:right"><p>b</p></section>', '')).toEqual(['1', '2', '4']);
    // 番号を 5 に振り直す left: 2 枚目が左ページなので、白のページは入れない
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5;break-before:left"><p>b</p></section>', '')).toEqual(['1', '5']);
    // 振り直した組の後の right も、ページの順で決める (3 枚目は右ページなので、白のページは入れない)
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section><section style="page:y;break-before:right"><p>c</p></section>', '')).toEqual(['1', '5', '6']);
    // 互換のスタイル (ah) は、これまでどおりページ番号の偶奇で決める
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 4;page-break-before:right"><p>b</p></section>', '', { style: 'ah' })).toEqual(['1', '2', '4', '5']);
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5;break-before:left"><p>b</p></section>', '', { style: 'ah' })).toEqual(['1', '5', '6']);
    expect(await nums('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section><section style="page:y;break-before:right"><p>c</p></section>', '', { style: 'ah' })).toEqual(['1', '2', '5', '6', '7']);
  });
});
