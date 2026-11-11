/**
 * 行の組版・擬似要素の箱の回帰テスト (0.2.0 までに入れるもの):
 *  - HTM-29 (1)(2) ::before・::after の箱は、ふつうの要素の箱と同じ書式 (margin・padding・border・background・box-decoration-break・opacity) を持つ
 *  - HTM-28 I 行内の箱の負の margin は、行分けの幅に数える
 *  - HTM-29 (3) 受け継いだ font-family でも、要素の言語 (lang) で書体を選ぶ (自分に指定したときと同じ)
 *  - HTM-29 (4) 空白の字を持たない書体を指定した XSL-FO で、空白を、字を持つ書体で組む
 *  - text-align: inside・outside (アンテナハウスの拡張の値。--style ah のときだけ)
 *  - HTM-28 J ページの余白の箱に、font-variant・font・text-transform・text-decoration・word-spacing などが効く
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetFo, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import fs from 'node:fs';
import { ensureFonts, extraTestFont, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

interface Box { x: number; y: number; w: number; h: number }
interface Found {
  /** 背景の色 → その色の箱 (ページの座標) */
  bg: Map<string, Box[]>;
  /** 罫線のある箱 */
  borders: Box[];
  /** 不透明度などの効果のある箱の数 */
  effects: number;
  glyphs: Array<{ text: string; x: number; y: number; w: number; h: number; size: number; weight: number; font: string }>;
  /** 細い線の箱 (下線など。高さ 3pt 未満で、字でないもの) */
  rules: Box[];
  lines: Array<{ y: number; h: number; x: number; w: number; text: string }>;
}
function scan(tree: AreaTree, sheet = 0): Found {
  const f: Found = { bg: new Map(), borders: [], effects: 0, glyphs: [], lines: [], rules: [] };
  const rec = (a: Area, ox: number, oy: number, line?: Found['lines'][number]) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { backgroundColor?: string; border?: Record<string, unknown>; opacity?: number; text?: string; fontSize?: number; fontWeight?: number; fontId?: string };
    const box = { x, y, w: a.width, h: a.height };
    if (b.backgroundColor) f.bg.set(b.backgroundColor.toLowerCase(), [...(f.bg.get(b.backgroundColor.toLowerCase()) ?? []), box]);
    if (b.border && Object.keys(b.border).length) f.borders.push(box);
    if (b.opacity !== undefined && b.opacity < 1) f.effects++;
    let ln = line;
    if (a.type === 'line') {
      ln = { x, y, w: a.width, h: a.height, text: '' };
      f.lines.push(ln);
    }
    if (a.type === 'glyph') {
      f.glyphs.push({ text: b.text ?? '', x, y, w: a.width, h: a.height, size: b.fontSize ?? 0, weight: b.fontWeight ?? 0, font: (b.fontId ?? '').replace(/@.*$/, '') });
      if (ln) ln.text += b.text ?? '';
    }
    else if (a.height > 0 && a.height < 3 && a.width > 0 && !childrenOf(a).length) f.rules.push(box);
    for (const c of childrenOf(a)) rec(c as Area, x, y, ln);
  };
  rec(tree.sheets[sheet].page as unknown as Area, 0, 0);
  return f;
}
const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 20pt } body { margin: 0; font-size: 20pt; line-height: 2 } p { margin: 0; text-indent: 0 } ${css}</style></head><body>${body}</body></html>`;
const html = async (body: string, css = '', opts: Record<string, unknown> = {}) => scan((await typesetHtml(doc(body, css), { loadFont: loadCachedFont, ...opts })).areaTree);
const round = (v: number) => Math.round(v * 100) / 100;
/** 比べるための形 (字の位置と、色の箱・罫線の箱の位置) */
const shape = (f: Found) => ({
  glyphs: f.glyphs.map((g) => [g.text, round(g.x), round(g.y)]),
  bg: [...f.bg.entries()].map(([c, bs]) => [c, bs.map((b) => [round(b.x), round(b.y), round(b.w), round(b.h)])]),
  borders: f.borders.map((b) => [round(b.x), round(b.y), round(b.w), round(b.h)]),
  effects: f.effects,
  lines: f.lines.map((l) => [round(l.y), round(l.h)]),
});

describe('HTM-29 ::before・::after の箱は、同じ指定の要素の箱と同じに組む (CSS Pseudo 4 §4.1)', () => {
  /** 擬似要素 (.q::before / ::after) と、同じ指定の span (.q) とを組んで比べる */
  const same = async (decl: string, which: '::before' | '::after' = '::before', pcss = '') => {
    const ps = await html(`<p class="q">本文の字</p>`, `${pcss} .q${which} { content: "A"; ${decl} }`);
    const el = await html(which === '::before' ? `<p><span class="q">A</span>本文の字</p>` : `<p>本文の字<span class="q">A</span></p>`, `${pcss} .q { ${decl} }`);
    expect(shape(ps)).toEqual(shape(el));
    return ps;
  };

  it('inline-block の ::before の負の margin-left が効く (字が、段落の左の余白の中へ出る)', async () => {
    const f = await same('display: inline-block; width: 30pt; margin-left: -30pt', '::before', 'p { margin-left: 30pt }');
    expect(f.glyphs.find((g) => g.text === 'A')!.x).toBeCloseTo(20, 1);
    expect(f.glyphs.find((g) => g.text === '本')!.x).toBeCloseTo(50, 1);
  });
  it('inline-block の ::before・::after の background・border・padding・margin', async () => {
    const f = await same('display: inline-block; width: 30pt; background: #ff0000');
    expect(f.bg.get('#ff0000')!.length).toBe(1);
    expect(f.bg.get('#ff0000')![0].w).toBeCloseTo(30, 1);
    await same('display: inline-block; width: 30pt; background: #ff0000; border: 2pt solid #000; padding: 3pt 4pt; margin: 0 5pt 0 6pt');
    await same('display: inline-block; background: #ff0000; border: 2pt solid #000; padding: 3pt 4pt; margin: 0 5pt 0 6pt', '::after');
    await same('display: inline-block; width: 40pt; height: 30pt; background: #ff0000; text-align: right');
  });
  it('inline の ::before・::after の background・border・padding・margin', async () => {
    const f = await same('background: #ff0000');
    expect(f.bg.get('#ff0000')!.length).toBe(1);
    await same('background: #ff0000; border: 2pt solid #000; padding: 0 4pt; margin: 0 5pt 0 -6pt');
    await same('background: #ff0000; border: 2pt solid #000; padding: 0 4pt; margin-left: 7pt', '::after');
    await same('border-bottom: 1pt dotted #00f; vertical-align: super; font-size: 10pt');
  });
  it('opacity は、擬似要素の箱にも効く', async () => {
    expect((await same('background: #ff0000; opacity: 0.5')).effects).toBe(1);
    expect((await same('display: inline-block; background: #ff0000; opacity: 0.5')).effects).toBe(1);
  });
  it('box-decoration-break: clone は、行で分かれた擬似要素の箱の断片ごとに罫線を付ける', async () => {
    const long = 'あ'.repeat(24);
    const decl = 'border: 2pt solid #000; padding: 0 3pt; background: #ff0000; box-decoration-break: clone';
    const ps = await html('<p class="q"></p>', `.q::before { content: "${long}"; ${decl} }`);
    const el = await html(`<p><span class="q">${long}</span></p>`, `.q { ${decl} }`);
    expect(shape(ps)).toEqual(shape(el));
    // 2 行に分かれ、どちらの断片も左の罫線と余白を持つ: 2 行目の最初の字も、1 行目と同じだけ行の左端 (20pt) から離れる
    expect(ps.bg.get('#ff0000')!.length).toBeGreaterThanOrEqual(2);
    const firsts = ps.lines.slice(0, 2).map((l) => ps.glyphs.find((g) => g.y >= l.y && g.y < l.y + l.h)!.x);
    expect(firsts[0]).toBeGreaterThan(24);
    expect(firsts[1]).toBeCloseTo(firsts[0], 1);
  });
  it('箱の書式の無い ::before・::after は、これまでどおり字だけを足す', async () => {
    const f = await html('<p class="q">本文</p>', '.q::before { content: "「" } .q::after { content: "」" }');
    expect(f.lines[0].text).toBe('「本文」');
    expect(f.bg.size).toBe(0);
  });
});

describe('HTM-28 I 行内の箱の負の margin は、行の幅の計算に入る (CSS 2.1 §8.3・§9.4.2・§10.3.1)', () => {
  // 幅 100pt の箱に、20pt の字 (1 行に 5 字)
  const lines = async (body: string, css = '') => (await html(`<div class="w">${body}</div>`, `.w { width: 100pt } ${css}`)).lines.map((l) => l.text).slice(0, -1);

  it('右の負の margin: 余白を引けば収まる字は、同じ行に入る', async () => {
    expect(await lines('一二三<span>四五六</span>')).toEqual(['一二三四五', '六']);
    expect(await lines('一二三<span style="margin-right: -20pt">四五六</span>')).toEqual(['一二三四五六']);
    // 余白を引いても収まらなければ、これまでどおり分ける
    expect(await lines('一二三<span style="margin-right: -10pt">四五六</span>')).toEqual(['一二三四五', '六']);
    // 箱の後ろの字は、余白の分だけ戻った所から続き、収まらなければ次の行へ
    expect(await lines('一二三<span style="margin-right: -20pt">四五六</span>七八')).toEqual(['一二三四五六', '七八']);
    expect(await lines('一二三<span style="margin-right: -40pt">四五六</span>七八')).toEqual(['一二三四五六七', '八']);
  });
  it('左の負の margin', async () => {
    expect(await lines('一二三<span style="margin-left: -20pt">四五六</span>')).toEqual(['一二三四五六']);
    const f = await html('<div class="w">一二三<span style="margin-left: -20pt">四五六</span></div>', '.w { width: 100pt }');
    // 四 は、三 の位置 (行の左端から 40pt) に重なる
    expect(f.glyphs.find((g) => g.text === '四')!.x).toBeCloseTo(20 + 40, 1);
  });
  it('入れ子の箱の負の margin は、合わせて数える', async () => {
    expect(await lines('一二三<span style="margin-right: -10pt"><span style="margin-right: -10pt">四五六</span></span>')).toEqual(['一二三四五六']);
    expect(await lines('一二三<span style="margin-right: -10pt"><span style="margin-left: -10pt">四五六</span></span>')).toEqual(['一二三四五六']);
  });
  it('行をまたぐ箱: 終わりの側の負の margin は、最後の断片の行で数える (box-decoration-break: clone でも)', async () => {
    expect(await lines('一二<span>三四五六七八九十壱</span>')).toEqual(['一二三四五', '六七八九十', '壱']);
    expect(await lines('一二<span style="margin-right: -20pt">三四五六七八九十壱</span>')).toEqual(['一二三四五', '六七八九十壱']);
    const clone = 'border: 0 solid #000; border-width: 0 5pt; box-decoration-break: clone';
    // 断片ごとに左右 5pt の罫線: 1 行目は 一二 + 罫線 + 三四 + 罫線 (90pt)、2 行目からは 4 字 (90pt)。最後の行の 4 字 + 壱 は 110pt − 20pt
    expect(await lines(`一二<span style="${clone}">三四五六七八九十壱</span>`)).toEqual(['一二三四', '五六七八', '九十壱']);
    expect(await lines(`一二<span style="${clone}; margin-right: -20pt">三四五六七八九十壱弐参</span>`)).toEqual(['一二三四', '五六七八', '九十壱弐参']);
  });
  it('XSL-FO の fo:inline の負の space-end・margin-right も、行の幅に数える', async () => {
    const fo = (attr: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja" font-size="20pt"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="140pt" page-height="200pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>一二三<fo:inline ${attr}>四五六</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const of = async (attr: string) => scan((await typesetFo(fo(attr), { loadFont: loadCachedFont })).areaTree).lines.map((l) => l.text);
    expect(await of('')).toEqual(['一二三四五', '六']);
    expect(await of('space-end="-20pt"')).toEqual(['一二三四五六']);
    expect(await of('margin-right="-20pt"')).toEqual(['一二三四五六']);
  });
  it('負の margin の無い行は、これまでどおり (正の margin は幅に数える)', async () => {
    expect(await lines('一二三<span style="margin-right: 20pt">四</span>五')).toEqual(['一二三四', '五']);
  });
});

describe('HTM-28 J ページの余白の箱の字の書式 (CSS Page 3 §6・付録 A)', () => {
  // 上の余白 60pt。html の字の大きさ 20pt (余白の箱が受け継ぐ)
  const mdoc = (pageCss: string, body = '<p>x</p>', css = '') =>
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Doc Title</title><style>@page { size: 400pt 400pt; margin: 60pt 20pt; ${pageCss} } html { font-size: 20pt } body { margin: 0 } h2 { string-set: h content(); font-size: 20pt; font-weight: normal; margin: 0 } ${css}</style></head><body>${body}</body></html>`;
  const top = async (pageCss: string, body?: string, css?: string) => {
    const f = scan((await typesetHtml(mdoc(pageCss, body, css), { loadFont: loadCachedFont })).areaTree);
    return { f, glyphs: f.glyphs.filter((g) => g.y < 60), text: f.glyphs.filter((g) => g.y < 60).map((g) => g.text).join(''), sizes: f.glyphs.filter((g) => g.y < 60).map((g) => `${g.text}${Math.round(g.size)}`).join(' ') };
  };
  // 本文の small caps (Tinos には smcp が無いので、小文字を 0.7 倍の大文字で代える) と同じ並び
  const SC = 'L20 E14  20 G20 R14';

  it('font-variant: small-caps・font-variant-caps が、文字列と string() の中身に効く', async () => {
    expect((await top('@top-left { content: "Le Gr" }')).sizes).toBe('L20 e20  20 G20 r20');
    expect((await top('@top-left { content: "Le Gr"; font-variant: small-caps }')).sizes).toBe(SC);
    expect((await top('@top-left { content: "Le Gr"; font-variant-caps: small-caps }')).sizes).toBe(SC);
    expect((await top('@top-left { content: "Le Gr"; font-variant-caps: all-small-caps }')).sizes).toBe('L14 E14  20 G14 R14');
    expect((await top('@top-left { content: string(h); font-variant: small-caps }', '<h2>Le Gr</h2>')).sizes).toBe(SC);
    expect((await top('@top-left { content: "Le Gr"; font: small-caps 20pt serif }')).sizes).toBe(SC);
    // 本文の small caps と同じ字の並び
    const body = (await top('', '<p style="font-variant: small-caps">Le Gr</p>')).f.glyphs.filter((g) => g.y >= 60 && g.y < 300).map((g) => `${g.text}${Math.round(g.size)}`).join(' ');
    expect(body).toBe(SC);
  });
  it('@page に書いた font-variant・text-transform は、余白の箱が受け継ぐ。余白の箱の指定で打ち消せる', async () => {
    expect((await top('font-variant: small-caps; @top-left { content: "Le Gr" }')).sizes).toBe(SC);
    expect((await top('font-variant: small-caps; @top-left { content: "Le Gr"; font-variant: normal }')).sizes).toBe('L20 e20  20 G20 r20');
    expect((await top('text-transform: uppercase; @top-left { content: "Le Gr" }')).text).toBe('LE GR');
    expect((await top('text-transform: uppercase; @top-left { content: "Le Gr"; text-transform: none }')).text).toBe('Le Gr');
  });
  it('text-transform が、文字列・文書の題・string() の中身に効く', async () => {
    expect((await top('@top-left { content: "Le Gr"; text-transform: uppercase }')).text).toBe('LE GR');
    expect((await top('@top-left { content: "le gr"; text-transform: capitalize }')).text).toBe('Le Gr');
    expect((await top('@top-left { content: string(h); text-transform: uppercase }', '<h2>Le Gr</h2>')).text).toBe('LE GR');
    expect((await top('@top-left { content: string(h) " " env(doc-title); text-transform: lowercase }', '<h2>Le Gr</h2>')).text).toBe('le gr doc title');
    // 変換と small caps の両方。変換の無い箱の string() は、元の字のまま
    expect((await top('@top-left { content: string(h); text-transform: lowercase; font-variant: small-caps } @top-right { content: string(h) }', '<h2>Le Gr</h2>')).sizes).toBe('L14 E14  20 G14 R14 L20 e20  20 G20 r20');
  });
  it('font の一括指定 (字の大きさ・太さ) が効く', async () => {
    const t = await top('@top-left { content: "ab"; font: italic bold 30pt serif }');
    expect(t.glyphs.map((g) => [Math.round(g.size), g.weight])).toEqual([[30, 700], [30, 700]]);
    // @page の font も受け継ぐ
    expect((await top('font: 30pt serif; @top-left { content: "ab" }')).sizes).toBe('a30 b30');
  });
  it('word-spacing・text-decoration が効く', async () => {
    const gap = (t: Awaited<ReturnType<typeof top>>) => t.glyphs.find((g) => g.text === 'c')!.x - t.glyphs.find((g) => g.text === 'b')!.x;
    const plain = await top('@top-left { content: "ab cd" }');
    const wide = await top('@top-left { content: "ab cd"; word-spacing: 20pt }');
    expect(gap(wide) - gap(plain)).toBeCloseTo(20, 1);
    const em = await top('@top-left { content: "ab cd"; word-spacing: 0.5em }');
    expect(gap(em) - gap(plain)).toBeCloseTo(10, 1);
    expect(plain.f.rules.filter((r) => r.y < 60).length).toBe(0);
    expect((await top('@top-left { content: "ab cd"; text-decoration: underline }')).f.rules.filter((r) => r.y < 60).length).toBeGreaterThan(0);
  });
  it('字の書式の指定の無い余白の箱は、これまでどおり', async () => {
    const t = await top('@top-center { content: "Page " counter(page); font-size: 12pt; font-weight: bold; letter-spacing: 1pt }');
    expect(t.text).toBe('Page 1');
    expect(t.glyphs.map((g) => [Math.round(g.size), g.weight])).toEqual(Array.from({ length: 6 }, () => [12, 700]));
  });
});

describe('HTM-29 (4) 空白の字を持たない書体 (絵文字の書体など) を指定したときの空白', () => {
  // Twemoji Mozilla は、空白 (U+0020・U+00A0)・英数字の字形を持たない
  const emoji = async () => [{ name: 'TwemojiMozilla.ttf', data: new Uint8Array(fs.readFileSync(await extraTestFont('TwemojiMozilla-colr-0.7.0.ttf'))) }];
  const fo = (text: string) =>
    `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja" font-family="serif" font-size="20pt"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="400pt" page-height="200pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Twemoji Mozilla">${text}</fo:block><fo:block>1 A</fo:block></fo:flow></fo:page-sequence></fo:root>`;

  it('XSL-FO: 空白は、字を持つ書体 (HTML と同じ後備) で組む。字が無いしるし (□) にしない', async () => {
    const f = scan((await typesetFo(fo('1 &#x1F600; &#xA0;A'), { loadFont: loadCachedFont, fonts: await emoji() })).areaTree);
    const row = f.glyphs.filter((g) => g.y < 45);
    expect(row.map((g) => g.text).join('')).toBe('1 😀 \u00a0A');
    expect(row.find((g) => g.text === '😀')!.font).toBe('Twemoji Mozilla');
    for (const g of row.filter((x) => /\s/.test(x.text))) expect(g.font, JSON.stringify(g.text)).not.toBe('Twemoji Mozilla');
    // 空白は、この書体に無いほかの字 (A) と同じ書体で、幅は半角ほど (絵文字の書体の「字が無い」しるしの幅 (1em 前後) ではない)
    expect(row.find((g) => g.text === ' ')!.font).toBe(row.find((g) => g.text === 'A')!.font);
    expect(row.find((g) => g.text === ' ')!.w).toBeLessThan(10);
    expect(row.find((g) => g.text === ' ')!.w).toBeGreaterThan(3);
  });
  it('HTML でも同じ (これまでどおり)', async () => {
    const f = scan((await typesetHtml(doc(`<p style="font-family: 'Twemoji Mozilla'">1 &#x1F600; A</p>`), { loadFont: loadCachedFont, fonts: await emoji() })).areaTree);
    const row = f.lines[0] && f.glyphs.filter((g) => g.y < 60);
    for (const g of row.filter((x) => x.text === ' ')) expect(g.font).not.toBe('Twemoji Mozilla');
  });
});

describe('HTM-29 (3) 受け継いだ font-family と、自分に指定した font-family とで、同じ書体を選ぶ', () => {
  const fontsOf = async (body: string) => {
    const f = await html(body);
    return f.glyphs.filter((g) => g.y < 60 && /[\u0400-\u04ff]/.test(g.text)).map((g) => `${g.text}:${g.font}`).join(' ');
  };
  const RU = 'духе и в у';
  it('親の font-family を受け継いだ lang="ru" の段落も、キリル文字の 1 字の語を欧文の書体で組む', async () => {
    const own = await fontsOf(`<p lang="ru" style="font-family: Tinos">${RU}</p>`);
    expect(own).toMatch(/и:Tinos в:Tinos у:Tinos$/);
    expect(await fontsOf(`<div style="font-family: Tinos"><p lang="ru">${RU}</p></div>`)).toBe(own);
    expect(await fontsOf(`<div style="font-family: Tinos"><div><p lang="ru">${RU}</p></div></div>`)).toBe(own);
    // 行内の要素の lang も同じ
    expect(await fontsOf(`<p style="font-family: Tinos">和文 <span lang="ru">${RU}</span></p>`)).toBe(own);
    // 総称 (既定の書体) を受け継いだときも、自分に指定したときと同じ
    expect(await fontsOf(`<p lang="ru">${RU}</p>`)).toBe(await fontsOf(`<p lang="ru" style="font-family: serif">${RU}</p>`));
  });
  it('lang の無い要素・日本語の要素は、これまでどおり (単独の 1 字は和文の書体)', async () => {
    expect(await fontsOf(`<div style="font-family: Tinos"><p>${RU}</p></div>`)).toMatch(/и:Noto Serif JP в:Noto Serif JP у:Noto Serif JP$/);
    expect(await fontsOf(`<div lang="ru" style="font-family: Tinos"><p lang="ja">${RU}</p></div>`)).toMatch(/и:Noto Serif JP в:Noto Serif JP у:Noto Serif JP$/);
  });
});

describe('text-align: inside・outside (アンテナハウスの拡張の値。XSL 1.1 §7.16.9 の値を、--style ah の HTML で読む)', () => {
  // 本文は 20pt〜380pt。1 ページ目 (右ページ) のノドは左、2 ページ目 (左ページ) のノドは右
  const css = 'p { text-align: left } .b { break-before: page }';
  const pages = async (body: string, style?: 'ah', extra = '') => {
    const t = (await typesetHtml(doc(body, `${css} ${extra}`), { loadFont: loadCachedFont, ...(style ? { style } : {}) })).areaTree;
    return [0, 1].map((k) => {
      const g = scan(t, k).glyphs.filter((x) => '一二三'.includes(x.text));
      return { left: Math.min(...g.map((x) => x.x)), right: Math.max(...g.map((x) => x.x + x.w)) };
    });
  };
  const two = (decl: string) => `<p style="${decl}">一二三</p><p class="b" style="${decl}">一二三</p>`;

  it('--style ah: inside はノドの側 (右ページは左、左ページは右)、outside は小口の側', async () => {
    const i = await pages(two('text-align: inside'), 'ah');
    expect(i[0].left).toBeCloseTo(20, 0);
    expect(i[1].right).toBeCloseTo(380, 0);
    const o = await pages(two('text-align: outside'), 'ah');
    expect(o[0].right).toBeCloseTo(380, 0);
    expect(o[1].left).toBeCloseTo(20, 0);
    // -ah-text-align でも同じ
    const a = await pages(two('-ah-text-align: outside'), 'ah');
    expect(a[0].right).toBeCloseTo(380, 0);
    expect(a[1].left).toBeCloseTo(20, 0);
  });
  it('--style ah: 規則の宣言・継承・打ち消し', async () => {
    // 規則で指定した親から受け継ぐ
    const inh = await pages('<div class="o"><p>一二三</p><p class="b">一二三</p></div>', 'ah', 'p { text-align: inherit } .o { text-align: outside }');
    expect(inh[0].right).toBeCloseTo(380, 0);
    expect(inh[1].left).toBeCloseTo(20, 0);
    // 子が別の値を指定すれば、その値
    const over = await pages('<div style="text-align: outside"><p style="text-align: left">一二三</p><p class="b" style="text-align: right">一二三</p></div>', 'ah');
    expect(over[0].left).toBeCloseTo(20, 0);
    expect(over[1].right).toBeCloseTo(380, 0);
    // 後の (強い) 宣言が CSS の値なら、そちら
    const later = await pages('<p class="x">一二三</p><p class="b x">一二三</p>', 'ah', '.x { text-align: outside } p.x { text-align: left }');
    expect(later[0].left).toBeCloseTo(20, 0);
    expect(later[1].left).toBeCloseTo(20, 0);
  });
  it('縦書きの行: ノド・小口は行の向き (上下) に無いので、どのページでも inside は行の始め (上)、outside は行の終わり (下)。XSL-FO も同じ', async () => {
    const tops = async (v: string) => {
      const t = (await typesetHtml(doc(`<p style="text-align: ${v}">一二三</p><p class="b" style="text-align: ${v}">一二三</p>`, 'html { writing-mode: vertical-rl } .b { break-before: page }'), { loadFont: loadCachedFont, style: 'ah' })).areaTree;
      return [0, 1].map((k) => Math.min(...scan(t, k).glyphs.filter((x) => '一二三'.includes(x.text)).map((x) => x.y)));
    };
    const i = await tops('inside');
    expect(i[0]).toBeCloseTo(20, 0);
    expect(i[1]).toBeCloseTo(20, 0);
    const o = await tops('outside');
    expect(o[0]).toBeCloseTo(380 - 60, 0);
    expect(o[1]).toBeCloseTo(380 - 60, 0);
    const fo = (v: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja" font-size="20pt"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="400pt" page-height="400pt" margin="20pt"><fo:region-body writing-mode="tb-rl"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block text-align="${v}">一二三</fo:block><fo:block break-before="page" text-align="${v}">一二三</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const foTops = async (v: string) => {
      const t = (await typesetFo(fo(v), { loadFont: loadCachedFont })).areaTree;
      return [0, 1].map((k) => Math.min(...scan(t, k).glyphs.filter((x) => '一二三'.includes(x.text)).map((x) => x.y)));
    };
    expect((await foTops('inside')).map(Math.round)).toEqual([20, 20]);
    expect((await foTops('outside')).map(Math.round)).toEqual([320, 320]);
  });
  it('標準のスタイルでは、無効の値として捨てる (CSS Text 3 §6.1 の text-align に無い値)', async () => {
    for (const v of ['inside', 'outside']) {
      const s = await pages(two(`text-align: ${v}`));
      // p { text-align: left } のまま
      expect(s[0].left).toBeCloseTo(20, 0);
      expect(s[1].left).toBeCloseTo(20, 0);
    }
  });
});
