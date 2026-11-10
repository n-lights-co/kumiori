import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importHtml } from '../src/htmlImport';
import { matchMedia, matchSupports, parseContent, parseCss, printColor, resolvePageRules, resolveVars, splitDecls } from '../src/htmlPaged';
import type { LBlock, LBlockContainer, LFloat, LFootnote, LInline, LInlineContainer, LMarker, LPageSequence, LRuby, LTable, LTateChuYoko } from '../src/types';
import { fakeSelect, fakeStyles } from './htmlImport.test';

describe('HTML: ページの組版の CSS の読み取り', () => {
  it('@page の名前・擬似クラス・余白の箱。文字列の中の ; { } は区切らない。screen だけの @media は読まない', () => {
    const { pages, rules } = parseCss(`
      @page { size: A5; margin: 20mm; @top-center { content: "a;{b}"; font-size: 8pt } }
      @page :left { @bottom-left { content: counter(page) } }
      @page chapter:first { @top-center { content: none } }
      @media screen { h1 { string-set: x content() } }
      @media print { h1 { string-set: chapter content() } }
      .fn, .note { float: footnote }`);
    expect(pages.map((p) => [p.name, p.pseudos])).toEqual([[undefined, []], [undefined, ['left']], ['chapter', ['first']]]);
    expect(pages[0].boxes['top-center']).toEqual({ content: '"a;{b}"', 'font-size': '8pt' });
    expect(rules.map((r) => r.selector)).toEqual(['h1', '.fn', '.note']);
    expect(rules[0].decls['string-set']).toBe('chapter content()');
    // 詳細度: 名前付きの :first が勝つ。:left は左ページだけ
    const r = resolvePageRules(pages, { name: 'chapter', first: true, side: 'left' });
    expect([r.boxes['top-center'].content, r.boxes['top-center']['font-size'], r.boxes['bottom-left'].content]).toEqual(['none', '8pt', 'counter(page)']);
    expect(resolvePageRules(pages, { side: 'right' }).boxes['bottom-left']).toBeUndefined();
  });

  it('content の字句', () => {
    expect(parseContent(`"第" counter(chapter, cjk-decimal) "章\\a" leader('.') target-counter(attr(href), page) open-quote`)).toEqual([
      { kind: 'str', v: '第' },
      { kind: 'fn', name: 'counter', args: ['chapter', 'cjk-decimal'] },
      { kind: 'str', v: '章\n' },
      { kind: 'fn', name: 'leader', args: ["'.'"] },
      { kind: 'fn', name: 'target-counter', args: ['attr(href)', 'page'] },
      { kind: 'ident', v: 'open-quote' },
    ]);
  });
});

function load(body: string, css: string) {
  const doc = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const styles = { ...fakeStyles(), select: fakeSelect(doc) };
  return importHtml(doc, styles, { css });
}

/** 中身の文字 (children をたどる) */
const texts = (n: unknown): string[] => {
  if (typeof n === 'string') return [n];
  if (Array.isArray(n)) return n.flatMap(texts);
  if (n && typeof n === 'object') return texts((n as { children?: unknown }).children ?? []);
  return [];
};
/** 行内の要素を平らにする (inline の包みを外す) */
const flat = (n: unknown[]): unknown[] => n.flatMap((c) => (c && typeof c === 'object' && (c as LInline).type === 'inline' ? flat((c as LInline).children) : [c]));

describe('HTML: 本の体裁 (柱・ノンブル・脚注・目次)', () => {
  it('余白の箱は静的コンテンツになり、:first・:left・:right は条件付きのマスターになる', () => {
    const r = load('<h1>章</h1><p>本文</p>', `
      @page { size: A5; margin: 20mm 15mm; @bottom-center { content: counter(page, lower-roman) " / " counter(pages); font-size: 8pt } }
      @page :first { @bottom-center { content: none } }
      @page :left { @top-left { content: string(chapter); border-bottom: 0.5pt solid black } }
      h1 { string-set: chapter "第一章 " content() }`);
    const seq = r.document.sequences[0];
    expect(seq.pageNumberFormat).toBe('i');
    const alts = seq.masterAlternatives!;
    expect(alts.map((a) => a.when)).toEqual([{ pagePosition: 'first', oddOrEven: 'odd' }, { pagePosition: 'first', oddOrEven: 'even' }, { oddOrEven: 'odd' }, { oddOrEven: 'even' }]);
    // 先頭ページ: ノンブルなし。右ページ (奇数): ノンブルだけ。左ページ (偶数): 柱とノンブル
    expect(alts[0].staticContent).toEqual([]);
    const right = alts[2].staticContent!;
    expect(right).toHaveLength(1);
    const folio = right[0];
    // 下の余白 (20mm) の中、本文の幅いっぱいに中央揃え
    expect([Math.round(folio.top!), Math.round(folio.left!), Math.round(folio.width!), Math.round(folio.height!)]).toEqual([539, 43, 334, 57]);
    expect(((folio.children[0] as LBlock).children as string[]).join('')).toBe('{pageNumber} / {totalPages}');
    expect((folio.children[0] as LBlock).fontSize).toBe(8);
    const left = alts[3].staticContent!;
    const head = left.find((b) => b.top === 0) as LBlockContainer;
    expect((head.children[0] as LBlock).textAlign).toBe('start');
    expect((head.border as { bottom: { width: number } }).bottom.width).toBe(0.5);
    expect((head.children[0] as LBlock).children[0]).toMatchObject({ type: 'retrieve-marker', className: 'string:chapter', position: 'first-including-carryover' });
    // string-set は見出しの前のマーカー
    const marker = seq.flow.children[0] as LMarker;
    expect([marker.type, marker.className, marker.children]).toEqual(['marker', 'string:chapter', ['第一章 章']]);
  });

  it('position: running() は本文から外れ、element() で余白の箱に出る', () => {
    const r = load('<div class="hd">柱の<b>文字</b></div><p>本文</p>', `.hd { position: running(header) } @page { @top-right { content: element(header) } }`);
    const seq = r.document.sequences[0];
    const m = seq.flow.children[0] as LMarker;
    expect([m.type, m.className, texts(m.children).join('')]).toEqual(['marker', 'running:header', '柱の文字']);
    expect(texts(seq.flow.children.slice(1))).toEqual(['本文']);
    const box = seq.staticContent![0];
    expect((box.children[0] as LBlock).textAlign).toBe('end');
    expect((box.children[0] as LBlock).children[0]).toMatchObject({ type: 'retrieve-marker', className: 'running:header' });
  });

  it('float: footnote は脚注、target-counter() はページ番号の参照、leader() はリーダー', () => {
    const r = load('<p>本文<span class="fn">脚注の文</span>。</p><p class="toc"><a href="#c2">第二章</a></p><h1 id="c2">第二章</h1>', `
      .fn { float: footnote }
      .toc a::after { content: leader(dotted) target-counter(attr(href), page) }`);
    const [p, toc] = r.document.sequences[0].flow.children as LBlock[];
    const fn = p.children[1] as LFootnote;
    expect([fn.type, texts(fn.children)]).toEqual(['footnote', ['脚注の文']]);
    expect(r.report.counts.footnotes).toBe(1);
    const a = toc.children[0] as LInline;
    expect(flat(a.children)).toEqual(['第二章', { type: 'leader', cssLeader: true }, { type: 'page-number-citation', refId: 'c2' }]);
  });

  it('counter() / counters() (counter-reset・counter-increment)', () => {
    const r = load(
      '<div data-css="counter-reset: sec 0"><h1 data-css="counter-increment: sec 1" data-before=\'"§" counter(sec, upper-roman) ". "\'>a</h1><h1 data-css="counter-increment: sec 1" data-before=\'"§" counter(sec, upper-roman) ". "\'>b</h1></div>',
      '',
    );
    const div = r.document.sequences[0].flow.children[0] as LBlock;
    expect(div.children.map((h) => texts((h as LBlock).children).join(''))).toEqual(['§I. a', '§II. b']);
  });

  it('名前付きページ: page が変わるところでページシーケンスを分け、名前付きの @page を当てる', () => {
    const r = load('<section class="cover">表紙</section><section>一</section><section>二</section><section class="idx">索引</section>', `
      .cover { page: cover } .idx { page: back }
      @page { size: A5 } @page cover { size: A4; margin: 0 } @page back { @bottom-center { content: "索引" } }`);
    const seqs = r.document.sequences as LPageSequence[];
    expect(seqs.map((s) => texts(s.flow.children).join(''))).toEqual(['表紙', '一二', '索引']);
    expect(seqs.map((s) => Math.round(s.master.width))).toEqual([210, 148, 148]);
    expect(seqs[0].master.margins.top).toBe(0);
    expect(texts(seqs[2].staticContent).join('')).toBe('索引');
    expect(seqs[1].staticContent).toEqual([]);
  });
});

describe('HTML: 和文組版と段組 (第 3 段階)', () => {
  it('圏点は字ごとのルビ (約物・空白には付けない)、text-combine-upright: digits は縦書きの短い数字を縦中横にする', () => {
    const r = load('<p data-css="text-emphasis-style: filled sesame">圏点、だ</p><p data-css="writing-mode: vertical-rl">平成12年100日</p>', 'p { text-combine-upright: digits 2 }');
    const [p1, p2] = r.document.sequences[0].flow.children as LBlock[];
    expect(p1.children.map((c) => (typeof c === 'string' ? c : `${(c as LRuby).baseText}:${(c as LRuby).rubyText}`))).toEqual(['圏:﹅', '点:﹅', '、', 'だ:﹅']);
    expect(p2.children.map((c) => (typeof c === 'string' ? c : `[${(c as LTateChuYoko).text}]`))).toEqual(['平成', '[12]', '年100日']);
  });

  it('text-autospace・text-spacing-trim・hanging-punctuation', () => {
    const r = load('<p>既定</p><p class="a">指定</p>', 'html { hanging-punctuation: allow-end } .a { text-spacing: none }');
    const seq = r.document.sequences[0];
    expect(seq.hangingPunctuation).toBe(true);
    const a = seq.flow.children[1] as LBlock;
    expect([a.textAutospace, a.punctuationSqueeze, a.hangingPunctuation]).toEqual([false, false, undefined]);
    // CSS の既定 (hanging-punctuation: none) では、ぶら下げない
    expect(load('<p>x</p>', '').document.sequences[0].hangingPunctuation).toBe(false);
  });

  it('float は回り込み (箱の幅・枠・余白は float に移す)、inside / outside は自前で読む', () => {
    const r = load('<p><span class="f" data-css="float: right; width: 80px; margin-left: 8px; padding-top: 4px">囲み</span>本文</p><div class="g">外</div>', '.g { float: outside }');
    const [p, g] = r.document.sequences[0].flow.children as unknown as [LBlock, LFloat];
    const f = p.children[0] as LFloat;
    expect([f.type, f.float, f.width, (f.margin as { left: number }).left, (f.padding as { top: number }).top]).toEqual(['float', 'end', 60, 6, 3]);
    expect((f.children[0] as LBlock).width).toBeUndefined();
    expect([g.type, g.float]).toEqual(['float', 'outside']);
  });

  it('段組: body はページの段組、ほかのブロックは段組のコンテナ。column-span: all は段抜き', () => {
    const r = load(
      '<h1 data-css="column-span: all">見出し</h1><div data-css="column-count: 3; column-gap: 10pt; column-rule-style: solid; column-rule-width: 1px">三段</div>',
      '@page { size: A5; margin: 10mm }',
    );
    const seq = r.document.sequences[0];
    expect(seq.master.columns).toBeUndefined();
    const [h1, div] = seq.flow.children as unknown as [LBlock, LBlockContainer];
    expect(h1.span).toBe('all');
    expect([div.type, div.columns?.count, div.columns?.gap, div.columns?.rule?.width]).toEqual(['block-container', 3, 10, 0.75]);
    const doc = new DOMParser().parseFromString('<html><body data-css="column-count: 2; column-gap: 6mm"><p>x</p></body></html>', 'text/html') as unknown as Document;
    const r2 = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: '' });
    expect([r2.document.sequences[0].master.columns?.count, r2.document.sequences[0].master.columns?.gap]).toEqual([2, 6]);
  });

  it('position: absolute は本文領域を基準にした絶対配置、fixed は全ページの静的コンテンツ', () => {
    const r = load(
      '<div data-css="position: absolute; top: 20px; right: 0px; width: 40px">印</div><div data-css="position: fixed; bottom: 0px">全ページ</div><p>本文</p>',
      '@page { size: A5; margin: 10mm }',
    );
    const seq = r.document.sequences[0];
    const abs = seq.flow.children[0] as LBlockContainer;
    const mm10 = (10 * 72) / 25.4;
    expect([abs.type, abs.absolutePosition, abs.top, abs.right, abs.left, abs.width]).toEqual(['block-container', true, mm10 + 15, mm10, undefined, 30]);
    expect(texts(seq.flow.children.slice(1))).toEqual(['本文']);
    expect(texts(seq.staticContent)).toEqual(['全ページ']);
    expect(seq.staticContent![0].bottom).toBeCloseTo(mm10);
  });
});

describe('HTML: 印刷の色・target-counter()・脚注・アンテナハウスの拡張', () => {
  it('印刷の色 (device-cmyk・rgb-icc)、読めない色は前の宣言を使う、@font-face', () => {
    expect(printColor('device-cmyk(0 0.5 1 0)')).toBe('cmyk(0,0.5,1,0)');
    expect(printColor('rgb-icc(255, 0, 0, #CMYK, 0, 1, 1, 0)')).toBe('cmyk(0,1,1,0)');
    expect(printColor('rgb-icc(#Grayscale, 0.25)')).toBe('gray(0.25)');
    expect(printColor("rgb-icc(0, 61, 25, #Separation, 'PANTONE 627 PC', 0.15)")).toBe('#d9e2dd');
    // 前に同じ指定がある読めない色は、その指定を使わず、特色の値が渡されたときのために -kumiori-print- として残す
    expect(splitDecls('background-color: rgba(0, 61, 25, 0.15); background-color: rgb-icc(0, 61, 25, #Separation, "P", 0.15)')).toEqual([
      ['background-color', 'rgba(0, 61, 25, 0.15)'],
      ['-kumiori-print-background-color', 'rgb-icc(0, 61, 25, #Separation, "P", 0.15)'],
    ]);
    // 特色の値が渡されたときは、特色 (spot) にする。名前が無い・値の無い名前は、これまでどおり RGB
    const spots = { 'Ink A': [0.2, 0.4, 0.6, 0.8] as [number, number, number, number] };
    expect(printColor("rgb-icc(0, 61, 25, #Separation, 'Ink A', 0.15)", spots)).toBe('spot(0.15,0.2,0.4,0.6,0.8,Ink%20A)');
    expect(printColor("rgb-icc(0, 61, 25, #Separation, 'Ink A')", spots)).toBe('spot(1,0.2,0.4,0.6,0.8,Ink%20A)');
    expect(printColor("rgb-icc(0, 61, 25, #Separation, 'Ink B', 0.15)", spots)).toBe('#d9e2dd');
    const { fontFaces } = parseCss(`@font-face { font-family: "my sans"; src: url(fonts/My-Bold.otf) format("opentype"); font-weight: bold } @font-face { font-family: x; src: url('x-It.otf'); font-style: italic }`);
    expect(fontFaces).toEqual([
      // weightRange: font-weight の記述子の範囲 (1 つの値は両端が同じ。可変フォントの軸の値を収める範囲。NC-15)
      { family: 'my sans', weight: 700, italic: false, srcs: ['fonts/My-Bold.otf'], weightRange: [700, 700] },
      { family: 'x', weight: 400, italic: true, srcs: ['x-It.otf'] },
    ]);
    // unicode-range と太さの範囲 (Fonts 4 §4.4・§4.5)
    const r = parseCss(`@font-face { font-family: v; src: url(v.woff2); font-weight: 100 900; unicode-range: U+0000-00FF, U+4??, U+20AC }`).fontFaces[0];
    expect(r.weight).toBe(400);
    expect(r.ranges).toEqual([
      [0, 255],
      [0x400, 0x4ff],
      [0x20ac, 0x20ac],
    ]);
  });

  it('target-counter() の任意のカウンター・target-text() (2 回変換する)、要素の content、display: block の ::before', () => {
    const r = load(
      '<p class="ref"><a class="cr" href="#c2">x</a></p><div data-css="counter-reset: ch 0"><h2 data-css="counter-increment: ch 1" data-before=\'"Chapter " counter(ch)\' data-before-display="block">一</h2><h2 id="c2" data-css="counter-increment: ch 1" data-before=\'"Chapter " counter(ch)\' data-before-display="block">二</h2></div>',
      `.cr::before { content: "第" target-counter(attr(href url), ch) "章「" target-text(attr(href url), content) "」" } .cr { content: "" }`,
    );
    const [ref, div] = r.document.sequences[0].flow.children as LBlock[];
    expect(texts(ref.children).join('')).toBe('第2章「二」');
    const h2 = (div.children as LBlock[])[1];
    // ::before (display: block) はブロック、target-text(…, before) にも使える
    expect((h2.children[0] as LBlock).type).toBe('block');
    expect(texts(h2.children).join('')).toBe('Chapter 2二');
  });

  it('<object> は画像があればその画像、image-resolution (-ah-image-resolution) で本来の大きさを決める', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><p><object data="a.svg" type="image/svg+xml"><img src="a.png"/></object><object data="b.svg" type="image/svg+xml"><img src="b.png"/></object></p></body></html>',
      'text/html',
    ) as unknown as Document;
    const r = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: 'img { -ah-image-resolution: from-image 200 }', hasAsset: (s) => s !== 'b.svg' });
    const p = r.document.sequences[0].flow.children[0] as LBlock;
    const imgs = flat(p.children).filter((c) => (c as { type?: string }).type === 'image') as Array<{ src: string; widthScale?: number }>;
    expect(imgs.map((i) => i.src)).toEqual(['a.svg', 'b.png']);
    expect(imgs[1].widthScale).toBeCloseTo(0.48);
  });

  it('脚注の書式 (@footnote・::footnote-call)、-ah- の和文組版の指定', () => {
    const r = load('<p>本文<span class="fn">注</span></p><pre class="code">x</pre>', `
      .fn { float: footnote }
      @page { size: A5; margin: 10mm; @footnote { border-top: .5pt solid black; border-length: 30% 0; margin-top: 4pt; padding-top: 2pt } }
      ::footnote-call { content: counter(footnote, decimal) ")"; font-size: 6pt }
      html { -ah-line-height-shift-adjustment: disregard-shifts } .code { -ah-text-autospace: none }`);
    const seq = r.document.sequences[0];
    const sep = seq.footnotes?.separator as { thickness: number; length: number; spaceBefore: number; spaceAfter: number };
    expect([sep.thickness, Math.round(sep.length), sep.spaceBefore, sep.spaceAfter]).toEqual([0.5, Math.round((128 * 72 * 0.3) / 25.4), 4, 2]);
    expect([seq.footnotes?.labelSuffix, seq.footnotes?.referenceScale]).toEqual([')', 0.5]);
    expect(seq.lineHeightShiftAdjustment).toBe('disregard-shifts');
    expect((seq.flow.children[1] as LBlock).textAutospace).toBe(false);
  });

  it('和欧間のアキの大きさ: 既定は 1/8 em (CSS Text 4)、-ah-text-autospace-width で変える', () => {
    const r = load('<p>a</p><p class="w">b</p>', `.w { -ah-text-autospace-width: 25% }`);
    const seq = r.document.sequences[0];
    expect(seq.textAutospaceWidth).toBe(0.125);
    expect((seq.flow.children[1] as LBlock).textAutospaceWidth).toBe(0.25);
  });
});

describe('HTML: しおり・スモールキャップス・text-transform', () => {
  it('bookmark-level・bookmark-label・bookmark-state で PDF のしおり (階層の木) を作る。id が無ければ付ける', () => {
    const r = load(
      '<h1>第一部</h1><h2 id="a" data-bookmark="1. はじめに">はじめに</h2><h2>本論</h2><h1>第二部</h1>',
      'h1 { bookmark-level: 1 } h2 { bookmark-level: 2; bookmark-state: closed } #a { bookmark-label: attr(data-bookmark, string) }',
    );
    const bm = r.document.bookmarks!;
    expect(bm.map((b) => b.title)).toEqual(['第一部', '第二部']);
    expect(bm[0].children!.map((b) => [b.title, b.ref, b.open])).toEqual([
      ['1. はじめに', 'a', false],
      ['本論', bm[0].children![1].ref, false],
    ]);
    // 飛び先の id は、見出しのブロックに付く
    const ids = (r.document.sequences[0].flow.children as LBlock[]).map((b) => b.id);
    expect(ids).toContain(bm[0].ref);
    expect(ids).toContain(bm[0].children![1].ref);
  });

  it('font-variant: small-caps は small caps の印を付けた inline に (字形を使うか縮めるかは組むときに決める)、text-transform は大文字化など', () => {
    const r = load('<p data-css="font-variant-caps: small-caps">Small caps 12</p><p data-css="text-transform: capitalize">hello world</p><p data-css="text-transform: full-width">AB 1</p>', '');
    const [p1, p2, p3] = r.document.sequences[0].flow.children as LBlock[];
    expect(p1.children).toEqual([{ type: 'inline', smallCaps: 'small', children: ['Small caps 12'] }]);
    expect(p2.children).toEqual(['Hello World']);
    expect(p3.children).toEqual(['ＡＢ　１']);
  });
});

describe('HTML: flex・grid (第 4 段階)', () => {
  it('ブラウザが置いた位置を写す: 横に並ぶ項目は 1 行の表 (空きは空の列)、1 つだけの帯は余白で位置を決める', () => {
    const r = load(
      `<div data-css="display: flex" data-rect="0 0 400 300">
        <div data-rect="0 0 100 50">左</div><div data-rect="150 10 100 40">右</div>
        <div data-rect="50 100 200 60" data-css="background-color: rgb(1, 2, 3)">下</div>
      </div>`,
      '',
    );
    const box = r.document.sequences[0].flow.children[0] as LBlock;
    const [row, single] = box.children as unknown as [LTable, LBlock];
    expect(row.type).toBe('table');
    // 項目の幅には 1.5pt の余裕 (次の空きから引く)
    expect(row.columns.map((c) => c.width)).toEqual([76.5, 36, 76.5]);
    const cells = row.body.rows[0].cells;
    expect(cells.map((c) => texts(c.children).join(''))).toEqual(['左', '', '右']);
    expect((cells[2].padding as { top: number }).top).toBeCloseTo(7.5);
    expect([(cells[0].children[0] as LBlock).width, (cells[0].children[0] as LBlock).height]).toEqual([76.5, 37.5]);
    expect([single.type, (single.margin as { top: number; left: number }).top, (single.margin as { left: number }).left, single.width]).toEqual(['block', 37.5, 37.5, 151.5]);
  });

  it('幅が中身で決まり、枠も背景も無い項目は、ブラウザの幅を使わず、揃えを文字の揃えにする (書体の違いで箱からはみ出さない)', () => {
    const r = load(
      `<div data-css="display: flex; flex-direction: column; align-items: center" data-rect="0 0 400 300"><h1 data-rect="150 100 100 40">題</h1></div>`,
      '',
    );
    const h1 = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LBlock;
    expect([h1.width, h1.textAlign, (h1.margin as { top: number; left?: number }).left, (h1.margin as { top: number }).top]).toEqual([undefined, 'center', undefined, 75]);
  });

  it('位置が分からなければ (rect が無い)、ふつうのブロックとして組む', () => {
    const r = load('<div data-css="display: grid"><div>一</div><div>二</div></div>', '');
    const box = r.document.sequences[0].flow.children[0] as LBlock;
    expect(box.children.map((c) => (c as LBlock).type)).toEqual(['block', 'block']);
  });
});

describe('HTML: CSS の入れ子、ページの背景色', () => {
  it('入れ子の規則を、親のセレクタと組み合わせて読む (親の宣言の後に、中の規則を並べる)', () => {
    const { rules } = parseCss(`h2 { color: red; string-set: heading content(); &::before { content: "x" } } aside { display: flex; figure, img { margin: 0 } }`);
    expect(rules.map((r) => [r.selector, Object.keys(r.decls).join(',')])).toEqual([
      ['h2', 'color,string-set'],
      ['h2::before', 'content'],
      ['aside', 'display'],
      ['aside figure', 'margin'],
      ['aside img', 'margin'],
    ]);
  });
  it('@page の background は、ページの背景色', () => {
    const r = load('<p>x</p>', '@page { background: black } @page :first { background-color: rgb(255, 0, 0) }');
    const seq = r.document.sequences[0];
    expect(seq.masterAlternatives!.map((a) => a.master.backgroundColor)).toEqual(['#ff0000', 'black']);
  });
});

describe('HTML: WeasyPrint の見本との比較で足したもの', () => {
  it('float: right の ::after は行末に寄せる (目次のページ番号)、絶対配置の ::before は背面の箱', () => {
    const r = load(
      `<p data-after='"7"' data-after-float="right">一章</p>
       <section data-before='""' data-before-position="absolute" data-before-top="-20px" data-before-left="0px" data-before-width="200px" data-before-height="100px" data-before-z-index="-1" data-before-background-image='url("img/a.jpg")' data-before-background-size="cover"><p>本文</p></section>`,
      '@page { size: A5; margin: 10mm }',
    );
    const [p, sec] = r.document.sequences[0].flow.children as LBlock[];
    expect(flat(p.children)).toEqual(['一章', { type: 'leader', pattern: 'space' }, '7']);
    const bg = sec.children[0] as LBlockContainer;
    const mm10 = (10 * 72) / 25.4;
    expect([bg.type, bg.absolutePosition, bg.layer, bg.width, bg.height, bg.left, bg.top]).toEqual(['block-container', true, 'behind', 150, 75, mm10, mm10 - 15]);
    expect(bg.backgroundImage).toMatchObject({ src: 'img/a.jpg', size: 'cover', repeat: 'no-repeat' });
  });

  it('名前付きページの境目の右ページ始まりは、前のシーケンスを偶数ページで終える。白ページは次のページの名前 (既定) か前のページの名前', () => {
    const html = '<section class="full" data-css="break-after: right">表紙</section><section>本文</section>';
    const css = '.full { page: full } @page full { background: black } @page :blank { background: white }';
    const seqs = load(html, css).document.sequences;
    expect(seqs.map((s) => s.forcePageCount)).toEqual(['end-on-even', undefined]);
    const blank = (s: LPageSequence) => s.masterAlternatives!.find((a) => a.when.blankOrNotBlank === 'blank')!.master.backgroundColor;
    expect(blank(seqs[0])).toBe('white');
    const doc = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document;
    const prev = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css, blankPageName: 'previous' }).document.sequences;
    // 前のページの名前 (full) の規則は :blank より詳細度が高いので、白ページも黒
    expect(blank(prev[0])).toBe('black');
  });

  it('object-fit は、幅・高さの両方があるときの画像の収め方', () => {
    const r = load('<p><img src="a.png" data-css="width: 100px; height: 50px; object-fit: cover"/></p>', '');
    const img = flat((r.document.sequences[0].flow.children[0] as LBlock).children)[0] as { fit?: string; width?: number };
    expect([img.fit, img.width]).toEqual(['cover', 75]);
  });
});

describe('HTML: WeasyPrint の報告書の見本との比較で足したもの', () => {
  it('CSS の変数を展開する (@page・余白の箱・自前で読む宣言)', () => {
    const { pages } = parseCss(':root { --c: #fbc847; --w: 1cm } @page { @top-left { background: var(--c); width: var(--w); content: counter(page) } background: var(--nope, red) }');
    expect(pages[0].boxes['top-left']).toMatchObject({ background: '#fbc847', width: '1cm' });
    expect(pages[0].decls.background).toBe('red');
    expect(resolveVars('var(--a)', { '--a': 'var(--b)', '--b': '3pt' })).toBe('3pt');
  });

  it('余白の箱の width・height・opacity、余白が 0 のページでは箱を出さない、@page の背景画像', () => {
    const r = load(
      '<p>x</p>',
      `@page { size: A5; margin: 20mm; @top-left { content: counter(page); width: 1cm; height: 1cm; background: #000000; opacity: .5 } }
       @page :first { margin: 0; background: url(cover.jpg) no-repeat center; background-size: cover }`,
    );
    const alts = r.document.sequences[0].masterAlternatives!;
    const first = alts.find((a) => a.when.pagePosition === 'first')!;
    expect(first.staticContent).toEqual([]);
    expect([first.master.backgroundImage?.src, first.master.backgroundImage?.size, first.master.backgroundImage?.repeat]).toEqual(['cover.jpg', 'cover', 'no-repeat']);
    const rest = alts.find((a) => !a.when.pagePosition)!.staticContent!;
    const cm = 72 / 2.54;
    const box = rest[0];
    expect([Math.round(box.width!), Math.round(box.height!), Math.round(box.left!), box.backgroundColor]).toEqual([Math.round(cm), Math.round(cm), Math.round((20 * 72) / 25.4), '#808080']);
    // 縦の揃えは中央: 余白 20mm の中に 1cm の箱
    expect(box.top).toBeCloseTo(((20 * 72) / 25.4 - cm) / 2, 1);
  });

  it('記号の無いリストはブロックの並び (li の枠・余白が付く)、大きさのある回り込みの ::before は箱の回り込み', () => {
    const r = load(
      `<ul><li data-css="list-style-type: none; border-top-style: solid; border-top-width: 1px">一</li><li data-css="list-style-type: none">二</li></ul>
       <section data-before='""' data-before-float="left" data-before-width="80px" data-before-height="80px" data-before-background-color="rgb(251, 200, 71)" data-before-background-image='url("a.svg")' data-before-background-size="50%"><p>本文</p></section>`,
      '',
    );
    const [ul, sec] = r.document.sequences[0].flow.children as LBlock[];
    const list = ul.children[0] as LBlock;
    expect([list.type, (list.children as LBlock[]).map((b) => b.type)]).toEqual(['block', ['block', 'block']]);
    expect(((list.children[0] as LBlock).border as { top: { width: number } }).top.width).toBe(0.75);
    const f = sec.children[0] as LFloat;
    const icon = f.children[0] as LBlockContainer;
    expect([f.type, f.float, f.width, icon.width, icon.height, icon.backgroundColor, icon.backgroundImage?.width]).toEqual(['float', 'start', 60, 60, 60, '#fbc847', 30]);
  });

  it('高さが決まった flex の容器は、ページをまたがない箱', () => {
    const r = load('<div data-css="display: flex; height: 400px" data-rect="0 0 400 400"><div data-rect="0 0 100 50" data-css="background-color: rgb(0, 0, 0)">a</div></div>', '');
    expect((r.document.sequences[0].flow.children[0] as LBlock).type).toBe('block-container');
  });
});

describe('HTML: WeasyPrint のポスター・チケットの見本との比較で足したもの', () => {
  it('根元の要素 (html) の背景はページの背景、inline-block は行内の箱、改行しない特殊な空白 (U+202F) はそのまま、ほかの特殊な空白は普通の空白', () => {
    const doc = new DOMParser().parseFromString(
      '<html data-css="background-color: rgb(10, 20, 30)"><body><p>25 juin !<span data-css="display: inline-block; vertical-align: middle">箱</span></p></body></html>',
      'text/html',
    ) as unknown as Document;
    const r = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: '' });
    const seq = r.document.sequences[0];
    expect(seq.master.backgroundColor).toBe('#0a141e');
    const p = seq.flow.children[0] as LBlock;
    expect(p.children[0]).toBe('25\u202Fjuin !');
    expect(p.children[1]).toMatchObject({ type: 'inline-container', alignmentBaseline: 'central' });
  });

  it('右から左へ書く段落の float: start は右、位置の基準の親の中の絶対配置は親を基準にする (基準にできない親の中で、上下の指定なしなら左右の回り込み)', () => {
    const r = load(
      `<div data-css="direction: rtl"><span data-css="direction: rtl" class="s">始</span>本文</div>
       <div data-css="position: relative"><h1 data-css="position: absolute; right: 20px">右</h1>本文</div>
       <div data-css="position: relative; writing-mode: vertical-rl"><h1 data-css="position: absolute; right: 20px">右</h1>本文</div>`,
      '.s { float: start }',
    );
    const [a, b, c] = r.document.sequences[0].flow.children as LBlock[];
    expect((a.children[0] as LFloat).float).toBe('end');
    // 親 (position: relative のブロック) の内容の箱を基準にする
    const abs = b.children[0] as LBlockContainer;
    expect([b.containingBlock, abs.type, abs.positionInContainer, abs.right, abs.top]).toEqual([true, 'block-container', true, 15, undefined]);
    // 縦書きの親は基準にできない: 上下の指定が無ければ、左右の回り込みで近づける
    const f = c.children[0] as LFloat;
    expect([f.type, f.float, (f.margin as { right: number }).right]).toEqual(['float', 'end', 15]);
  });

  it('line-height: normal は、normalLineHeight があればその値 (読み込んだ書体の値)', () => {
    const doc = new DOMParser().parseFromString('<html><body><p data-css="font-family: Archivo">x</p></body></html>', 'text/html') as unknown as Document;
    const r = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: '', normalLineHeight: (f) => (f[0] === 'Archivo' ? 1.088 : undefined) });
    expect((r.document.sequences[0].flow.children[0] as LBlock).lineHeight).toBe(1.088);
  });
});

describe('HTML: Vivliostyle の見本との比較で足したもの', () => {
  it('@page の百分率の余白 (左右は用紙の幅、上下は高さに対して)、env(doc-title)、余白の箱は @page の字の大きさを受け継ぐ', () => {
    const r = load('<p>x</p>', '@page { size: A4; margin: 10%; font-size: 9pt; @top-center { content: env(doc-title) } }');
    const seq = r.document.sequences[0];
    expect([seq.master.margins.left, seq.master.margins.top]).toEqual([21, 29.7]);
    const box = seq.staticContent![0];
    const inner = box.children[0] as LBlock;
    expect([inner.children, inner.fontSize]).toEqual([['t'], 9]);
  });
});

describe('HTML: inline-block の ::before・clear・根元の要素の背景', () => {
  it('幅のある inline-block の ::before は、その幅の行内の箱 (最後の行の基線で揃える)。inline の左右の margin は行内の空き', () => {
    const r = load(
      `<h1 data-before='"1.2"' data-before-display="inline-block" data-before-width="45px">見出し</h1><p>a<span data-css="margin-left: 16px">b</span></p>`,
      '',
    );
    const [h1, p] = r.document.sequences[0].flow.children as LBlock[];
    const ic = h1.children[0] as LInlineContainer;
    expect([ic.type, ic.width, ic.baselineFrom]).toEqual(['inline-container', 33.75, 'last']);
    expect(texts(ic.children as never).join('')).toBe('1.2');
    expect((p.children[1] as LInline).inlineMargin).toEqual({ start: 12, end: 0 });
  });

  it('clear: left / right / both は、行の始端・終端・両側の回り込みの下まで下げる (右から左へ書く段落では左右が入れ替わる)', () => {
    const r = load('<p data-css="clear: left">a</p><p data-css="clear: right">b</p><p data-css="clear: both">c</p><p data-css="clear: left; direction: rtl">d</p><p>e</p>', '');
    const ps = r.document.sequences[0].flow.children as LBlock[];
    expect(ps.map((p) => p.clear)).toEqual(['start', 'end', 'both', 'end', undefined]);
  });

  it('根元の要素 (html・body) の背景は、ページの余白の内側に描く (@page の背景は用紙全体)', () => {
    const doc = new DOMParser().parseFromString('<html data-css="background-color: rgb(255, 0, 0)"><body><p>x</p></body></html>', 'text/html') as unknown as Document;
    const r = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: '' });
    expect(r.document.sequences[0].master.backgroundArea).toBe('content');
    const r2 = load('<p>x</p>', '@page { background: #00ff00 }');
    expect(r2.document.sequences[0].master.backgroundArea).toBeUndefined();
  });
});

describe('HTML: ブラウザの配置を使わない画像の大きさ', () => {
  it('上限・下限は縦横比を保って当てる (CSS 2.1 §10.4)', async () => {
    const { constrainReplaced } = await import('../src/htmlImport');
    expect(constrainReplaced(800, 400, 0, 200, 0, Infinity)).toEqual([200, 100]);
    expect(constrainReplaced(800, 400, 0, 400, 0, 100)).toEqual([200, 100]);
    expect(constrainReplaced(50, 100, 100, Infinity, 0, Infinity)).toEqual([100, 200]);
    expect(constrainReplaced(100, 100, 0, Infinity, 0, Infinity)).toEqual([100, 100]);
  });

  it('rect が無ければ、本来の大きさ (imageSize) と max-width から決める', () => {
    const doc = new DOMParser().parseFromString('<html><body><p><img src="a.png" data-css="max-width: 150px"/></p></body></html>', 'text/html') as unknown as Document;
    const { rect: _r, ...noRect } = fakeStyles();
    void _r;
    const r = importHtml(doc, { ...noRect, select: fakeSelect(doc) }, { css: '', imageSize: () => ({ width: 600, height: 300 }) });
    const img = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as { width: number; height: number };
    expect([img.width, img.height]).toEqual([112.5, 56.25]);
  });
});

describe('HTML: ブラウザの配置を使わない flex・grid', () => {
  const noRect = (body: string, width = 400) => {
    const doc = new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const { rect: _r, ...src } = fakeStyles();
    void _r;
    return importHtml(doc, { ...src, select: fakeSelect(doc), contentWidth: () => width }, { css: '' }).document.sequences[0].flow.children;
  };
  const widths = (t: LTable) => t.columns!.map((c) => Math.round(c.width as number));

  it('grid-template-columns の列 (fr・px・repeat) に、項目を順に置く', async () => {
    const { gridTracks } = await import('../src/htmlImport');
    expect(gridTracks('repeat(2, 1fr) 100pt', 300, 0)).toEqual([100, 100, 100]);
    expect(gridTracks('25% 3fr', 400, 0)).toEqual([100, 300]);
    const [g] = noRect('<div data-css="display: grid; grid-template-columns: 1fr 1fr"><p>a</p><p>b</p><p>c</p></div>') as LBlock[];
    const tables = g.children as LTable[];
    expect(tables.length).toBe(2);
    expect(widths(tables[0])).toEqual([150, 150]); // 400px = 300pt
  });

  it('幅の指定の無い項目は、measureText で中身の幅を測る (行内の要素は、それぞれの字の大きさで)', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div data-css="display: flex"><p>ab<span data-css="font-size: 32px">cd</span></p><p data-css="flex-grow: 1">e</p></div></body></html>',
      'text/html',
    ) as unknown as Document;
    const { rect: _r, ...src } = fakeStyles();
    void _r;
    const seen: Array<[string, number]> = [];
    const r = importHtml(doc, { ...src, select: fakeSelect(doc), contentWidth: () => 400 }, {
      css: '',
      measureText: (t, st) => (seen.push([t, st.fontSize]), t.length * st.fontSize),
    });
    const t = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LTable;
    // "ab" (12pt) + "cd" (24pt) = 24 + 48 = 72pt。残りは伸びる項目へ (比例の列: 組版時の容器の幅の余りをもらう)
    expect(t.columns.map((c) => c.width)).toEqual([72, '1*']);
    expect(seen).toContainEqual(['cd', 24]);
  });

  it('flex の項目の表は、表の max-content (列ごとの最大の和・border-spacing・枠) を幅にする (セルの文字がはみ出さない)', () => {
    const cell = 'padding-left: 10px; padding-right: 10px; border-left-width: 2px; border-right-width: 2px';
    const doc = new DOMParser().parseFromString(
      `<html><body><div data-css="display: flex; column-gap: 8px">` +
        `<table data-css="border-collapse: collapse"><tr><td data-css="${cell}">a</td><td data-css="${cell}">bb</td></tr></table>` +
        `<table data-css="border-spacing: 4px; border-left-width: 1px; border-right-width: 1px"><tr><td data-css="${cell}">a</td></tr></table>` +
        `<table data-css="border-collapse: collapse"><tr><td>aaa</td><td>b</td></tr><tr><td>c</td><td>dddd</td></tr><tr><td colspan="2">eeeeeeeeee</td></tr></table>` +
        `</div></body></html>`,
      'text/html',
    ) as unknown as Document;
    const { rect: _r, ...src } = fakeStyles();
    void _r;
    const r = importHtml(doc, { ...src, select: fakeSelect(doc), contentWidth: () => 400 }, { css: '', measureText: (t, st) => t.length * st.fontSize });
    const t = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LTable;
    // 字は 1 字 12pt。内側の余白 7.5pt × 2、枠 1.5pt × 2
    //  - collapse: セルの和 (a 12 + 15 + 3、bb 24 + 15 + 3) から、分け合う左右の枠の半分ずつ (1.5pt × 2) を引く → 69
    //  - separate: セル 30 + border-spacing 3pt × 2 + 表の枠 0.75pt × 2 → 37.5
    //  - 列ごとの最大 (36・48) の和 84 より、列をまたぐセル (120) が広い → 120
    expect(widths(t)).toEqual([69, 6, 38, 6, 120]);
  });

  it('flex: flex-basis で幅を決め、flex-wrap で折る。justify-content: center は両側に空きの列', () => {
    const [w] = noRect('<div data-css="display: flex; flex-wrap: wrap"><p data-css="flex-basis: 50%">a</p><p data-css="flex-basis: 50%">b</p><p data-css="flex-basis: 50%">c</p></div>') as LBlock[];
    expect((w.children as LTable[]).map(widths)).toEqual([[150, 150], [150]]);
    const [cn] = noRect('<div data-css="display: flex; justify-content: center"><p data-css="width: 100px">a</p><p data-css="width: 100px">b</p></div>') as LBlock[];
    // 100px = 75pt の項目 2 つ: 残りを前後の比例の空きの列で半分ずつ
    expect((cn.children as LTable[])[0].columns.map((c) => c.width)).toEqual(['1*', 75, 75, '1*']);
  });
});

describe('HTML: 角丸 (border-radius)', () => {
  it('4 隅が同じなら rx・ry、違えば角ごと (百分率はそのまま)。組版エンジンは角ごとの輪郭を描く', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><p data-css="border-top-left-radius: 4px; border-top-right-radius: 4px; border-bottom-right-radius: 4px; border-bottom-left-radius: 4px">x</p><p data-css="border-bottom-right-radius: 50% 20px; border-bottom-left-radius: 50% 20px">y</p></body></html>',
      'text/html',
    ) as unknown as Document;
    const res = importHtml(doc, { ...fakeStyles(), select: fakeSelect(doc) }, { css: '' });
    const [a, b] = res.document.sequences[0].flow.children as LBlock[];
    expect(a.borderRadius).toEqual({ rx: 3, ry: 3 });
    expect(b.borderRadius?.corners).toEqual([[0, 0], [0, 0], ['50%', 15], ['50%', 15]]);
    const { roundRectPathCorners } = await import('../src/paint');
    const path = roundRectPathCorners(0, 0, 100, 40, [[0, 0], [0, 0], [50, 15], [50, 15]]);
    expect(path[0]).toEqual({ op: 'M', x: 0, y: 0 });
    expect(path.filter((s) => s.op === 'C').length).toBe(4);
    // 丸めない角 (半径 0) のある辺があっても、ほかの角の半径を 0 に縮めない (CSS Backgrounds 3 §4.5)
    expect(path[3]).toEqual({ op: 'L', x: 100, y: 25 });
    expect(path[5]).toEqual({ op: 'L', x: 50, y: 40 });
  });
});

describe('HTML: @media・@supports・@layer', () => {
  it('印刷の媒体として、ページの大きさで評価する', () => {
    expect([matchMedia('print'), matchMedia('screen'), matchMedia('not print'), matchMedia('all and (min-width: 500px)'), matchMedia('(max-width: 300px)'), matchMedia('screen, print')]).toEqual([true, false, false, true, false, true]);
    expect([matchSupports('(display: grid)'), matchSupports('not (display: grid)'), matchSupports('(a: b) and (not (c: d))')]).toEqual([true, false, false]);
    const { rules } = parseCss('@layer base { h1 { color: red } } @media (max-width: 300px) { p { color: blue } } @supports not (display: grid) { em { color: green } } @media print { b { color: black } }');
    expect(rules.map((r) => r.selector)).toEqual(['h1', 'b']);
  });
});

describe('グレースケール (rgb-icc(#Grayscale, g))', () => {
  it('gray(g) は墨 1 − g の CMYK として読み、グレースケールの印を付ける (PDF では DeviceGray で書く)', async () => {
    const { parseColor } = await import('../src/color');
    expect(parseColor('gray(0.25)')).toEqual({ mode: 'cmyk', c: 0, m: 0, y: 0, k: 0.75, gray: true });
  });
});
