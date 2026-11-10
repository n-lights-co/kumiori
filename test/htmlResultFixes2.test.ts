/**
 * HTML・CSS の「結果の誤り」の回帰テスト (全体レビューの残り):
 *  - HTM-23 @media の width・height・orientation は、@page の無いときに選ばれる用紙で評価する。用紙の大きさに依る条件の中の @page の size は読まない
 *  - HTM-24 li の break-before・break-after・break-inside が、リストの行に効く
 *  - PKG-16 @supports・@import の supports() は、未対応の性質・値を偽にする
 *  - PKG-18 @supports・@import の supports() は、読めない値 (カスケードが捨てる宣言) を偽にする
 *  - @page の中の、ASCII でない名前の var()・ページの名前・content の識別子
 *  - font・columns の一括指定の中の数の書き方
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { UNSUPPORTED_CSS_PROPERTIES } from '../src/cssUnsupported';
import { importHtml } from '../src/htmlImport';
import { matchMedia, matchSupports, mediaPageOf, parseContent, parseCss, resolveVars } from '../src/htmlPaged';
import { prepareHtml } from '../src/htmlPrepare';
import type { Area } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const A4 = { width: 210, height: 297, margin: 20 };
const A5 = { width: 148, height: 210, margin: 10 };
const A4_LANDSCAPE = { width: 297, height: 210, margin: 20 };
/** prepareHtml (linkedom)。files は一緒に渡す CSS のファイル */
const prep = (head: string, defaultPage = A4, files: Record<string, string> = {}) =>
  prepareHtml(
    `<!doctype html><html><head>${head}</head><body><p>a</p></body></html>`,
    Object.entries(files).map(([name, text]) => ({ name, text: async () => text })) as never,
    'browser',
    defaultPage,
    (t) => parseHTML(t).document as unknown as Document,
  );
/** 作成者スタイルシートの規則のセレクタ */
const selectors = async (head: string, defaultPage = A4, files: Record<string, string> = {}) => (await prep(head, defaultPage, files)).authorSheet.rules.map((r) => r.selector);

describe('HTM-23 @media の評価に使う用紙 (Page 3 §7.1・Media Queries 4 §4.1)', () => {
  it('matchMedia は、渡した用紙の page box (余白を含む用紙の全体) で評価する', () => {
    // A4 の幅 210mm・高さ 297mm は、余白 (20mm) を引かない
    expect(matchMedia('(min-width: 205mm)', mediaPageOf(A4))).toBe(true);
    expect(matchMedia('(width: 210mm)', mediaPageOf(A4))).toBe(true);
    expect(matchMedia('(min-width: 205mm)', mediaPageOf(A5))).toBe(false);
    expect(matchMedia('(max-height: 210mm)', mediaPageOf(A5))).toBe(true);
    expect(matchMedia('(orientation: landscape)', mediaPageOf(A4_LANDSCAPE))).toBe(true);
    expect(matchMedia('(orientation: landscape)', mediaPageOf(A4))).toBe(false);
    // 既定は A4
    expect(matchMedia('(min-width: 205mm)')).toBe(true);
  });

  it('prepareHtml は、利用者の既定の用紙で @media・@import の条件を評価する', async () => {
    const head = '<style>@media (max-width: 150mm) { .narrow { color: red } } @media (min-width: 200mm) { .wide { color: red } } @media (orientation: landscape) { .land { color: red } }</style>';
    expect(await selectors(head, A4)).toEqual(['.wide']);
    expect(await selectors(head, A5)).toEqual(['.narrow']);
    expect(await selectors(head, A4_LANDSCAPE)).toEqual(['.wide', '.land']);
    // @import の条件・link の media も同じ用紙で
    const files = { 'n.css': '.n { color: red }', 'w.css': '.w { color: red }' };
    const imp = '<style>@import "n.css" (max-width: 150mm); @import "w.css" (min-width: 200mm);</style>';
    expect(await selectors(imp, A4, files)).toEqual(['.w']);
    expect(await selectors(imp, A5, files)).toEqual(['.n']);
    const link = '<link rel="stylesheet" href="n.css" media="(max-width: 150mm)"><link rel="stylesheet" href="w.css" media="print and (min-width: 200mm)">';
    expect(await selectors(link, A4, files)).toEqual(['.w']);
    expect(await selectors(link, A5, files)).toEqual(['.n']);
  });

  it('メディアクエリは @page の size を見ない (@page の無いときに選ばれる用紙で評価する)', async () => {
    const head = '<style>@page { size: A5 } @media (max-width: 150mm) { .narrow { color: red } } @media (min-width: 200mm) { .wide { color: red } }</style>';
    expect(await selectors(head, A4)).toEqual(['.wide']);
  });

  it('用紙の大きさに依る条件の中の @page の size は読まない (ほかの宣言は読む)', () => {
    for (const q of ['(orientation: portrait)', '(min-width: 10mm)', 'print and (max-height: 400mm)', '(width >= 10mm)', '(device-width: 210mm), (min-height: 1mm)']) {
      const p = parseCss(`@media ${q} { @page { size: A5; margin: 7mm } @page :first { size: A6 landscape; margin-top: 30mm } }`).pages;
      expect(p.map((r) => r.decls), q).toEqual([{ margin: '7mm' }, { 'margin-top': '30mm' }]);
    }
    // 条件の中に入れ子になった @supports・@layer・@media の中も同じ
    expect(parseCss('@media (min-width: 10mm) { @supports (color: red) { @page { size: A5; margin: 7mm } } }').pages[0].decls).toEqual({ margin: '7mm' });
    expect(parseCss('@media (min-width: 10mm) { @media print { @page { size: A5; margin: 7mm } } }').pages[0].decls).toEqual({ margin: '7mm' });
    // 余白の箱の宣言は残る
    expect(parseCss('@media (min-width: 10mm) { @page { size: A5; @top-center { content: "x" } } }').pages[0].boxes['top-center']).toEqual({ content: '"x"' });
  });

  it('用紙の大きさに依らない条件 (print・color) の中と、条件の外の @page の size は読む', () => {
    expect(parseCss('@media print { @page { size: A5 } }').pages[0].decls).toEqual({ size: 'A5' });
    expect(parseCss('@media print and (color) { @page { size: A5 } }').pages[0].decls).toEqual({ size: 'A5' });
    expect(parseCss('@supports (color: red) { @page { size: A5 } }').pages[0].decls).toEqual({ size: 'A5' });
    // 条件の塊を出た後の @page は読む
    expect(parseCss('@media (min-width: 10mm) { p { color: red } } @page { size: A5 }').pages[0].decls).toEqual({ size: 'A5' });
  });

  it('用紙の大きさに依る条件の @import・link の中の @page の size も読まない', async () => {
    const files = { 'p.css': '@page { size: A5; margin: 7mm }' };
    expect((await prep('<style>@import "p.css" (min-width: 10mm);</style>', A4, files)).authorSheet.pages.map((r) => r.decls)).toEqual([{ margin: '7mm' }]);
    expect((await prep('<link rel="stylesheet" href="p.css" media="(orientation: portrait)">', A4, files)).authorSheet.pages.map((r) => r.decls)).toEqual([{ margin: '7mm' }]);
    // 条件の無い @import・print だけの条件は、size も読む
    expect((await prep('<style>@import "p.css";</style>', A4, files)).authorSheet.pages.map((r) => r.decls)).toEqual([{ size: 'A5', margin: '7mm' }]);
    expect((await prep('<style>@import "p.css" print;</style>', A4, files)).authorSheet.pages.map((r) => r.decls)).toEqual([{ size: 'A5', margin: '7mm' }]);
    // 本文の幅は、読まなかった size ではなく既定の用紙 (A4) と、読んだ余白 (7mm) で決まる
    expect((await prep('<style>@import "p.css" (min-width: 10mm);</style>', A4, files)).bodyWidthPx).toBeCloseTo(((210 - 14) / 25.4) * 96, 3);
  });
});

/** importHtml (A5・余白 10mm) */
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 組んだ結果の字 (ページごと) */
const pageTexts = (body: string, css = '') =>
  E.engine.layout(imp(body, css).document).sheets.map((s) => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s.page);
    return out.join('');
  });

describe('HTM-24 li の改ページの指定 (Fragmentation 3 §3.1)', () => {
  it('break-before: page・page-break-before: always は、その項目の前でページを改める', () => {
    expect(pageTexts('<ul><li>a</li><li style="break-before: page">b</li><li>c</li></ul>')).toEqual(['•a', '•b•c']);
    expect(pageTexts('<ul><li>a</li><li style="page-break-before: always">b</li><li>c</li></ul>')).toEqual(['•a', '•b•c']);
    expect(pageTexts('<ol><li>a</li><li>b</li><li style="break-before: right">c</li></ol>')[0]).toBe('1.a2.b');
  });

  it('break-after: page・page-break-after: always は、その項目の後ろでページを改める', () => {
    expect(pageTexts('<ul><li style="break-after: page">a</li><li>b</li><li>c</li></ul>')).toEqual(['•a', '•b•c']);
    expect(pageTexts('<ol><li style="page-break-after: always">a</li><li>b</li><li>c</li></ol>')).toEqual(['1.a', '2.b3.c']);
  });

  it('最初の項目の前・最後の項目の後ろの指定は、リストの前後でページを改める', () => {
    expect(pageTexts('<p>x</p><ul><li style="break-before: page">a</li><li>b</li></ul>')).toEqual(['x', '•a•b']);
    expect(pageTexts('<ul><li>a</li><li style="break-after: page">b</li></ul><p>x</p>')).toEqual(['•a•b', 'x']);
    // 奇数ページ (右ページ) から: 白ページを挟む
    expect(pageTexts('<p>x</p><p>y</p><ul><li style="break-before: left">a</li></ul>', 'p { break-before: page }')).toEqual(['x', 'y', '', '•a']);
  });

  it('指定の無いリストは、これまでどおり 1 ページに並ぶ', () => {
    expect(pageTexts('<ul><li>a</li><li>b</li><li>c</li></ul>')).toEqual(['•a•b•c']);
  });

  it('break-inside: avoid の項目は、ページをまたがずに次のページへ送る', () => {
    // 1 ページに 1080 字 (40 字 × 27 行)。段落 25 行の後ろの、5 行の項目
    const p = `<p style="margin: 0">${'あ'.repeat(1000)}</p>`;
    const li = 'い'.repeat(190);
    const split = pageTexts(`${p}<ul style="margin: 0"><li>${li}</li></ul>`);
    expect(split.length).toBe(2);
    expect(split[0]).toContain('い');
    const kept = pageTexts(`${p}<ul style="margin: 0"><li style="break-inside: avoid">${li}</li></ul>`);
    expect(kept.length).toBe(2);
    expect(kept[0]).not.toContain('い');
    expect(kept[1]).toBe(`•${li}`);
  });

  it('break-after: avoid・break-before: avoid の項目は、隣の項目と同じページに置く', () => {
    const p = (n: number) => `<p style="margin: 0">${'あ'.repeat(40 * n)}</p>`;
    // 段落の行の数 n を、項目 x がページの最後の行に入り、項目 y が次のページへ送られる数にする
    const list = (x = '', y = '') => (n: number) => pageTexts(`${p(n)}<ul style="margin: 0"><li${x}>x</li><li${y}>y</li></ul>`);
    const n = Array.from({ length: 20 }, (_, k) => 20 + k).find((k) => list()(k).join('|').endsWith('•x|•y'));
    expect(n).toBeDefined();
    const after = list(' style="break-after: avoid"')(n!);
    expect(after[0].endsWith('あ')).toBe(true);
    expect(after[1]).toBe('•x•y');
    const before = list('', ' style="break-before: avoid"')(n!);
    expect(before[0].endsWith('あ')).toBe(true);
    expect(before[1]).toBe('•x•y');
  });
});

describe('PKG-16 @supports の答え (Conditional 3 §6.1)', () => {
  it('名前は読むが組版に使わない性質は、対応していないと答える', () => {
    for (const c of ['transform: rotate(5deg)', 'opacity: .5', 'font-variant-alternates: historical-forms', 'object-position: top', 'text-decoration-skip-ink: none', 'text-underline-position: under', 'list-style-image: url(a.png)', 'text-shadow: 1px 1px red', 'outline: 1px solid'])
      expect(matchSupports(`(${c})`), c).toBe(false);
    // 未対応の一覧の性質は、どれも偽
    expect([...UNSUPPORTED_CSS_PROPERTIES].filter((p) => matchSupports(`(${p}: initial)`))).toEqual([]);
  });

  it('対応している性質の、読まない値は、対応していないと答える (!important・大文字も同じ)', () => {
    for (const c of ['position: sticky', 'display: run-in', 'writing-mode: sideways-lr', 'position: sticky !important', 'POSITION: STICKY']) expect(matchSupports(`(${c})`), c).toBe(false);
    for (const c of ['position: relative', 'display: block', 'writing-mode: vertical-rl', 'position: absolute !important']) expect(matchSupports(`(${c})`), c).toBe(true);
  });

  it('一括指定は、未対応の性質に初期値でない値を入れるものだけ偽にする', () => {
    expect(matchSupports('(list-style: url(a.png) inside)')).toBe(false);
    expect(matchSupports('(text-decoration: underline)')).toBe(true);
    expect(matchSupports('(text-decoration: underline wavy)')).toBe(true);
    expect(matchSupports('(list-style: none)')).toBe(true);
    expect(matchSupports('(list-style: square inside)')).toBe(true);
    // font の一括指定は、font-variant-east-asian などを初期値に戻すだけ
    expect(matchSupports('(font: bold 12pt serif)')).toBe(true);
  });

  it('対応している性質の答えは変わらない (grid・flex など、働きの一部が未対応のものも真のまま)', () => {
    for (const c of ['display: grid', 'display: flex', 'grid-template-columns: 1fr 1fr', 'gap: 1em', 'columns: 2', 'hanging-punctuation: first', 'aspect-ratio: 1', 'object-fit: cover', 'inset: 0', 'margin-inline: auto', 'text-emphasis: dot', 'filter: blur(1px)', 'break-inside: avoid', 'string-set: a "x"', 'bookmark-level: 1', 'float: footnote', '--x: 1', '--色: 1'])
      expect(matchSupports(`(${c})`), c).toBe(true);
    // 知らない性質・印刷に関わらない性質 (読まない) は、これまでどおり偽
    for (const c of ['foo: bar', 'cursor: pointer', 'animation-name: x', 'transition: all 1s', 'scroll-behavior: smooth', 'user-select: none', 'grid-template-areas: "a"', 'text-wrap: balance'])
      expect(matchSupports(`(${c})`), c).toBe(false);
  });

  it('not・and・or と、@supports の規則・@import の supports() に効く', async () => {
    expect(matchSupports('not (transform: rotate(5deg))')).toBe(true);
    expect(matchSupports('(display: block) and (position: sticky)')).toBe(false);
    expect(matchSupports('(transform: none) or (display: block)')).toBe(true);
    expect(supportsCssDeclaration('transform', 'none')).toBe(false);
    const css = '@supports (transform: rotate(5deg)) { .t { color: red } } @supports not (transform: rotate(5deg)) { .nt { color: red } } @supports (position: sticky) { .s { color: red } } @supports (display: grid) { .g { color: red } } p { color: blue; @supports (opacity: .5) { margin: 0 } }';
    const rules = parseCss(css).rules;
    expect(rules.map((r) => r.selector)).toEqual(['.nt', '.g', 'p']);
    const files = { 't.css': '.t { color: red }', 'g.css': '.g { color: red }', 's.css': '.s { color: red }' };
    expect(await selectors('<style>@import "t.css" supports(transform: rotate(5deg)); @import "g.css" supports(display: grid); @import "s.css" supports((position: sticky));</style>', A4, files)).toEqual(['.g']);
  });
});

describe('PKG-18 @supports は、読めない値の宣言を偽にする (Conditional 3 §6.1: 宣言を構文の誤りとして捨てずに受け付けるときだけ、対応と答える)', () => {
  /** p に当てた宣言が、カスケードで生き残るか (捨てられれば、先に書いた目印の値のまま) */
  const accepted = (decl: string) => {
    const prop = decl.slice(0, decl.indexOf(':')).trim().toLowerCase();
    const d = new DOMParser().parseFromString('<html><body><p>a</p></body></html>', 'text/html') as unknown as Document;
    const el = d.getElementsByTagName('p')[0] as unknown as Element;
    const plain = cascadeStyles(d, 'p { }', { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el).getPropertyValue(prop);
    const got = cascadeStyles(d, `p { ${decl} }`, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el).getPropertyValue(prop);
    return got !== plain;
  };

  it('読めない値は偽。読める値は真のまま (!important・大文字も同じ)', () => {
    for (const c of [
      'display: foo', 'color: notacolor', 'color: #12', 'color: rgb(1,2)', 'color: red blue', 'width: abc', 'width: 10', 'width: 10qq', 'font-weight: heavy', 'font-weight: 1001', 'font-size: big',
      'line-height: -1', 'z-index: 1.5', 'order: 2.5', 'orphans: 0', 'column-count: 0', 'break-before: sometimes', 'break-inside: never', 'text-align: middle', 'text-align: left right',
      'writing-mode: diagonal', 'visibility: gone', 'box-sizing: padding-box', 'content: foo(1)', 'content: counter(c d)', 'margin-top: 1px 2px', 'margin-inline-start: nope', 'inline-size: nope',
      'display: foo !important', 'DISPLAY: FOO', 'display:', 'color: ',
    ])
      expect(matchSupports(`(${c})`), c).toBe(false);
    for (const c of [
      'display: block', 'color: red', 'color: RED', 'color: #123', 'color: rgb(1 2 3)', 'color: transparent', 'width: 10px', 'width: 0', 'width: calc(1px + 2px)', 'width: auto', 'width: 50%', 'font-weight: 700', 'font-size: larger',
      'line-height: 1.5', 'z-index: auto', 'order: 2', 'orphans: 2', 'column-count: 2', 'break-before: always', 'text-align: justify', 'content: "a" counter(c, upper-roman)', 'content: counters(c, ".")',
      'margin-inline-start: 1em', 'inline-size: 10em', 'display: block !important', 'DISPLAY: BLOCK',
      // 広域の語は、どの性質でも読める
      'color: inherit', 'display: initial', 'margin: unset', 'width: revert',
    ])
      expect(matchSupports(`(${c})`), c).toBe(true);
  });

  it('一括指定は、分けられない値・分けた性質のどれかが読めない値なら偽', () => {
    for (const c of ['margin: 1px foo', 'padding: red', 'border: foo', 'border-color: nope', 'border-width: fat', 'columns: foo', 'column-rule: nope', 'inset: nope', 'margin-inline: nope', 'gap: nope', 'flex: nope'])
      expect(matchSupports(`(${c})`), c).toBe(false);
    for (const c of ['margin: 1em 2em', 'margin: auto', 'padding: 1px', 'border: 1px solid red', 'border-color: red blue', 'border-width: thin', 'columns: 2 10em', 'column-rule: 1px solid red', 'inset: 0', 'margin-inline: auto', 'gap: 1em', 'flex: 1', 'font: bold 12pt serif', 'background: url(a.png) no-repeat'])
      expect(matchSupports(`(${c})`), c).toBe(true);
  });

  it('カスタム プロパティは何でも真 (Variables 1 §2.1)。var() を含む値は、置き換えるまで読めるか決まらないので真 (Variables 1 §3)', () => {
    for (const c of ['--x: anything goes', '--x: foo(', '--x:', '--色: 1']) expect(matchSupports(`(${c})`), c).toBe(true);
    for (const c of ['color: var(--c)', 'display: var(--d)', 'width: var(--w, 10px)', 'margin: var(--m) 1px', 'border: var(--b)', 'color: VAR(--c)']) expect(matchSupports(`(${c})`), c).toBe(true);
    // var() があっても、知らない性質・未対応の性質は偽のまま
    for (const c of ['foo: var(--x)', 'transform: var(--t)', 'cursor: var(--c)']) expect(matchSupports(`(${c})`), c).toBe(false);
  });

  it('@supports の答えは、カスケードが宣言を受け付けるかと同じ', () => {
    for (const c of ['display: foo', 'color: notacolor', 'width: abc', 'width: 10', 'font-weight: heavy', 'text-align: middle', 'z-index: 1.5', 'margin-top: 1px 2px', 'display: flex', 'color: blue', 'width: 10px', 'font-weight: 700', 'text-align: justify', 'z-index: 3', 'margin-top: 1px'])
      expect(matchSupports(`(${c})`), c).toBe(accepted(c));
  });

  it('アンテナハウスの拡張の値は、互換の指定が分からない所なので真のまま', () => {
    for (const c of ['border-style: dot-dash', 'border-top-style: wave', 'column-rule-style: dot-dot-dash']) expect(matchSupports(`(${c})`), c).toBe(true);
    expect(matchSupports('(border-top-style: zigzag)')).toBe(false);
  });

  it('@supports の規則・not・@import の supports() に効く', async () => {
    const css = '@supports (display: foo) { .a { color: red } } @supports not (display: foo) { .b { color: red } } @supports (color: notacolor) or (display: block) { .c { color: red } } @supports (display: grid) and (width: abc) { .d { color: red } } @supports (color: var(--c)) { .e { color: red } } p { color: blue; @supports (color: notacolor) { margin: 0 } }';
    expect(parseCss(css).rules.map((r) => r.selector)).toEqual(['.b', '.c', '.e', 'p']);
    const files = { 'a.css': '.a { color: red }', 'b.css': '.b { color: red }' };
    expect(await selectors('<style>@import "a.css" supports(display: foo); @import "b.css" supports(display: block);</style>', A4, files)).toEqual(['.b']);
  });
});

describe('@page の中の ASCII でない名前 (CSS Syntax 3 §4.2)', () => {
  it('@page の宣言・余白の箱の var(--色) を、根元の変数で置き換える', () => {
    const p = parseCss(':root { --余白: 12mm; --題: "見出し"; --a-1: 3mm } @page { margin: var(--余白); padding: var(--a-1); @top-center { content: var(--題) } @bottom-center { content: var(--無い, "既定") } }').pages[0];
    expect(p.decls).toEqual({ margin: '12mm', padding: '3mm' });
    expect(p.boxes['top-center']).toEqual({ content: '"見出し"' });
    expect(p.boxes['bottom-center']).toEqual({ content: '"既定"' });
    expect(resolveVars('var(--幅) var(--é_1, 2px)', { '--幅': '10mm' })).toBe('10mm 2px');
  });

  it('ASCII でない名前のページ (@page 表紙) を読む', () => {
    const p = parseCss('@page 表紙 { margin: 0 } @page 章:first { margin: 1mm } @page a-1 { margin: 2mm }').pages;
    expect(p.map((r) => [r.name, r.pseudos])).toEqual([
      ['表紙', []],
      ['章', ['first']],
      ['a-1', []],
    ]);
    expect(pageTexts('<p>a</p><p class="c">b</p>', '.c { page: 表紙 } @page 表紙 { @top-center { content: "題" } }')).toEqual(['a', 'b題']);
  });

  it('content・string-set の ASCII でない識別子を字句に分ける', () => {
    expect(parseContent('string(題) counter(章, upper-roman) 見出し content()')).toEqual([
      { kind: 'fn', name: 'string', args: ['題'] },
      { kind: 'fn', name: 'counter', args: ['章', 'upper-roman'] },
      { kind: 'ident', v: '見出し' },
      { kind: 'fn', name: 'content', args: [] },
    ]);
    // 柱に、ASCII でない名前の string-set を出す
    expect(pageTexts('<h1>はじめに</h1><p>a</p>', 'h1 { string-set: 題 content() } @page { @top-center { content: string(題) } }')[0]).toBe('はじめにaはじめに');
  });

  it('ASCII でない名前の running() の要素を、余白の箱に出す', () => {
    expect(pageTexts('<div class="h">柱</div><p>a</p>', '.h { position: running(柱) } @page { @top-center { content: element(柱) } }')).toEqual(['a柱']);
  });
});

describe('一括指定の中の数の書き方', () => {
  const computed = (css: string, prop: string) => {
    const d = new DOMParser().parseFromString('<html><body><p>a</p></body></html>', 'text/html') as unknown as Document;
    return cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(d.getElementsByTagName('p')[0] as unknown as Element).getPropertyValue(prop);
  };
  it('font の太さは、font-weight の宣言と同じ数を読む (Fonts 4 §2.2: <number [1,1000]>)', () => {
    expect(computed('p { font: 700 12px serif }', 'font-weight')).toBe('700');
    expect(computed('p { font: 550.5 12px serif }', 'font-weight')).toBe('550.5');
    expect(computed('p { font: 50 12px serif }', 'font-weight')).toBe('50');
    expect(computed('p { font: 1000 12px serif }', 'font-weight')).toBe('1000');
    expect(computed('p { font: +700 12px serif }', 'font-weight')).toBe('700');
    expect(computed('p { font: italic 1 12px/2 serif }', 'font-weight')).toBe('1');
    for (const w of ['550.5', '50', '1000', '+700']) {
      expect(computed(`p { font: ${w} 12px serif }`, 'font-size'), w).toBe('12px');
      expect(computed(`p { font: ${w} 12px serif }`, 'font-family'), w).toBe('serif');
    }
  });
  it('columns の段の数は、column-count の宣言と同じ整数を読む (Multi-column 1 §3.2)', () => {
    expect(computed('p { columns: 2 }', 'column-count')).toBe('2');
    expect(computed('p { columns: +3 }', 'column-count')).toBe('3');
    expect(computed('p { columns: 10em +3 }', 'column-count')).toBe('3');
    expect(computed('p { columns: 10em +3 }', 'column-width')).toBe(computed('p { columns: 10em 3 }', 'column-width'));
    expect(computed('p { columns: 10em }', 'column-count')).toBe('auto');
  });
});
