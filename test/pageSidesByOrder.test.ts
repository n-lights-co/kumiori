/**
 * HTML の文書の、ページの左右 (@page の :left・:right、break-before の left・right・recto・verso の白ページ): 既定のスタイルでは、
 * ページ番号の偶奇でなく、文書の最初からのページの順 (何枚目か。白ページも 1 枚と数える) で決める。
 * CSS Paged Media 3 §3.3 (左右のページは交互に来て、左から右へ進む文書の最初のページは右ページ。縦書きの右から左へ進む文書は左ページ)・
 * §4.2.1 (:left・:right)・§6.1 (page のカウンターは番号の表示のためのもので、左右とは別)、CSS Fragmentation 3 §3.1 (left・right は、
 * 次のページが左・右ページになるように、1 つか 2 つの区切りを入れる)。
 * 互換のスタイル (ah・weasyprint・vivliostyle) は、これまでどおりページ番号の偶奇で決める (振り直しの前に、偶奇を合わせる白ページを入れる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { DEFAULT_FONTS, childrenOf, typeset, typesetHtml, typesetToPdf, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

// 右ページ (:right) は左の余白 50pt、左ページ (:left) は左の余白 20pt。下の余白の箱にページ番号
const PG = '@page { size: 300pt 200pt; margin: 20pt 20pt 20pt 50pt; @bottom-center { content: counter(page) } } @page :left { margin-left: 20pt; margin-right: 50pt } ';
const doc = (body: string, css = '', bodyAttr = '') =>
  `<!DOCTYPE html><html><head><style>body { margin: 0; font-size: 10pt } p { margin: 0 } ${PG} ${css}</style></head><body ${bodyAttr}>${body}</body></html>`;

/**
 * ページごとに「番号 + 左右」: 本文の最初の字 (小文字) の左端が、左の余白 50 の所なら R (:right の余白)、20 の所なら L (:left の余白)。本文の無いページ (白ページ) は「番号」だけ。
 * 縦書きは、本文の字の右端で決める (右の余白 20 なら R、50 なら L)
 */
async function sides(body: string, css = '', opts: Record<string, unknown> = {}, bodyAttr = ''): Promise<string[]> {
  const r = await typesetHtml(doc(body, css, bodyAttr), { loadFont: loadCachedFont, ...opts });
  return r.areaTree.sheets.map((sh) => {
    let num = '';
    let left: number | undefined;
    let right: number | undefined;
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; text?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      if (a.type === 'glyph') {
        if (/^[0-9]+$/.test(g.text ?? '')) num += g.text;
        else if (/[a-z]/.test(g.text ?? '') && left === undefined) [left, right] = [x, x + (g.width ?? 0)];
        return;
      }
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
    if (left === undefined) return num;
    const vertical = /vertical-rl/.test(css);
    const side = vertical ? (right! > 300 - 35 ? 'R' : 'L') : left > 35 ? 'R' : 'L';
    return num + side;
  });
}

describe('既定のスタイルの HTML: ページの左右は、ページの順で決める', () => {
  it('ページ番号を振り直しても、見開きの左右は変わらない (1 の次の 5 は、2 枚目なので左ページ)', async () => {
    for (const style of [undefined, 'browser']) {
      const o = style ? { style } : {};
      expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section>', '', o)).toEqual(['1R', '5L']);
      expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5;break-before:page"><p>b</p></section><p style="break-before:page">c</p>', '', o)).toEqual(['1R', '5L', '6R']);
      // 同じ名前のページの中の振り直し
      const sec = (extra: string, t: string) => `<section style="page:c;break-before:page${extra}"><p>${t}</p></section>`;
      expect(await sides(`${sec('', 'a')}${sec(';counter-reset:page 5', 'b')}${sec('', 'c')}`, '', o)).toEqual(['1R', '5L', '6R']);
    }
  });
  it('振り直した後の break-before: right・left は、ページの順で白ページを入れる', async () => {
    // 番号を 5 に振り直す right: 2 枚目は左ページなので、白ページ (2) を 1 枚入れて、3 枚目 (5) から
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5;break-before:right"><p>b</p></section>')).toEqual(['1R', '2', '5R']);
    // 番号を 4 に振り直す right も同じ (直す前は、偶奇を合わせる白ページを 2 枚入れて 1 | 2 | 4 | 5)
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 4;break-before:right"><p>b</p></section>')).toEqual(['1R', '2', '4R']);
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 4;page-break-before:right"><p>b</p></section>')).toEqual(['1R', '2', '4R']);
    // 番号を 5 に振り直す left: 2 枚目が左ページなので、白ページを入れない
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5;break-before:left"><p>b</p></section>')).toEqual(['1R', '5L']);
    // 振り直した組の後の right: 3 枚目は右ページなので、白ページを入れない (番号の偶奇では 6 なので、白ページを入れていた)
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section><section style="page:y;break-before:right"><p>c</p></section>')).toEqual(['1R', '5L', '6R']);
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p><p style="break-before:right">c</p></section>')).toEqual(['1R', '5L', '6R']);
    // recto・verso (左から右へ進む文書では、右・左ページ)
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p><p style="break-before:recto">c</p><p style="break-before:verso">d</p></section>')).toEqual(['1R', '5L', '6R', '7L']);
  });
  it('最初のページの番号を偶数から始めても、最初のページは右ページ (白ページを入れない)', async () => {
    expect(await sides('<p>a</p><p style="break-before:page">b</p>', '', {}, 'style="counter-reset:page 2"')).toEqual(['2R', '3L']);
    expect(await sides('<p style="break-before:right">a</p><p style="break-before:page">b</p>', '', {}, 'style="counter-reset:page 2"')).toEqual(['2R', '3L']);
    expect(await sides('<section style="page:x;counter-reset:page 2;break-before:right"><p>a</p><p style="break-before:page">b</p></section>')).toEqual(['2R', '3L']);
    expect(await sides('<p>a</p><p style="break-before:page">b</p><p style="break-before:right">c</p>', '', {}, 'style="counter-reset:page 10"')).toEqual(['10R', '11L', '12R']);
  });
  it('縦書き (vertical-rl) の文書は、最初のページが左ページ。振り直しても交互', async () => {
    expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section><p style="break-before:page">c</p>', 'html { writing-mode: vertical-rl }')).toEqual(['1L', '5R', '6L']);
  });
  it('ページ番号を振り直さない文書は、これまでと同じ', async () => {
    expect(await sides('<p>a</p><p style="break-before:right">b</p><p style="break-before:left">c</p><p style="break-before:recto">d</p><p style="break-before:verso">e</p>')).toEqual(['1R', '2', '3R', '4L', '5R', '6L']);
    expect(await sides('<p>a</p><section style="page:x"><p>b</p></section>')).toEqual(['1R', '2L']);
    // 最初の子の break-before: left は、白ページを挟まずに、最初のページを左ページにする (CSS Paged Media 3 §3.3: 空の最初のページを出さない)
    expect(await sides('<p style="break-before:left">a</p><p style="break-before:page">b</p>')).toEqual(['1L', '2R']);
  });
});

describe('互換のスタイル (ah・weasyprint・vivliostyle) は、これまでどおりページ番号の偶奇で決める', () => {
  it('振り直しの前に偶奇を合わせる白ページを入れ、番号の偶奇で左右を選ぶ', async () => {
    for (const style of ['ah', 'weasyprint', 'vivliostyle']) {
      expect(await sides('<p>a</p><section style="page:x;counter-reset:page 5"><p>b</p></section>', '', { style }), style).toEqual(['1R', '2', '5R']);
      expect(await sides('<p>a</p><section style="page:x;counter-reset:page 4;break-before:right"><p>b</p></section>', '', { style }), style).toEqual(['1R', '2', '4', '5R']);
      expect(await sides('<p>a</p><p style="break-before:page">b</p>', '', { style }, 'style="counter-reset:page 2"'), style).toEqual(['2L', '3R']);
    }
  });
});

/** PDF の中身 (ストリームを展開して並べる。作った日時と相互参照のストリームは除く) */
function contents(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g)) {
    if (/\/Type\s*\/XRef/.test(m[2])) continue;
    const len = Number(/\/Length (\d+)/.exec(m[2])![1]);
    const start = m.index! + m[0].length;
    let data = Buffer.from(pdf.subarray(start, start + len));
    if (/\/FlateDecode/.test(m[2])) data = inflateSync(data);
    out.push(`${m[1]} ${m[2].replace(/\/Length \d+/, '')}\n${data.toString('latin1')}`.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, ''));
  }
  return out;
}

describe('組み直し (ページ番号の参照) と PDF の道', () => {
  // 前の組のページ数が、組み直しの回で増える文書: 振り直した組の番号 (8) は回によらないが、何枚目かが変わる。
  // 前の回の組を使い回すときも、左右は、いまの順で決める
  // (100 個の参照: 1 回目の仮の値「I」では 1 ページ、決まった値「VIII」では 2 ページ)
  const refs = Array.from({ length: 100 }, () => '<a class="ref" href="#t"></a>').join(' ');
  const css = '.ref::after { content: target-counter(attr(href url), page, upper-roman) }';
  const body = `<p>${refs}</p><section style="page:x;counter-reset:page 8;break-before:page"><p id="t">b</p><p style="break-before:page">c</p></section>`;
  it('typeset (前の回のページを使い回す)・typesetToPdf・lowMemory で、同じ左右', async () => {
    const r = await typeset(doc(body, css), { loadFont: loadCachedFont });
    const n = r.areaTree.sheets.length;
    // 後ろの組の最初のページ (8) は 3 枚目 (右ページ)
    expect(n).toBe(4);
    const want = ['8R', '9L'];
    expect((await sides(body, css)).slice(-2)).toEqual(want);
    const whole = contents(await r.toPdf());
    const pdf = await typesetToPdf(doc(body, css), { loadFont: loadCachedFont });
    const low = await typesetToPdf(doc(body, css), { loadFont: loadCachedFont }, { lowMemory: true });
    expect(pdf.pageCount).toBe(n);
    expect(low.pageCount).toBe(n);
    expect(contents(pdf.pdf)).toEqual(whole);
    expect(contents(low.pdf)).toEqual(whole);
  });
});
