/**
 * CSS-Print (『CSS ページ組版入門』第 4 版) との組み比べで直したものの回帰テスト:
 *  - --style ah の line-break: auto は、小書きの仮名・長音記号・繰返し記号の前でも改行する (ほかのスタイルは normal のまま)
 *  - 行グリッド (-ah-baseline-grid: new) の箱の終わり: 半行間が負の行は、em の箱の下端まで箱を伸ばす
 *  - -ah-baseline-grid: root の格子は、ページの本文の領域の上端から、根元の書式で引く
 *  - -ah-last-line-end-indent (XSL 1.1 §7.16.3 の last-line-end-indent) を HTML で読む (::before の指定も)
 *  - 横書きの中の、幅が中身で決まる縦書きの箱の、左右の auto の余白 (CSS 2.1 §10.3.3)
 *  - CSS の text-autospace は、全角の空白 (U+3000) と欧字の間を空けない (XSL-FO の axf:text-autospace は空ける)
 *  - -ah-lang (要素・::marker などの言語) を読む
 *  - 両端揃えで、約物の前後は字間を空けない (JLREQ §3.1.11)。--style ah は空ける (アンテナハウス互換)
 *  - --style ah: 接頭辞の付いた MathML (<m:math xmlns:m=…>) を MathML として組む
 *  - リストの外側の記号は本文の最初の行の箱に入る (記号の行が深ければ最初の行を下に伸ばす)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetFo, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import fs from 'node:fs';
import path from 'node:path';
import { ensureFonts, extraTestFont, fontDir, loadCachedFont } from './helpers';
import { prefixedForeignToHtml } from '../src/htmlPrepare';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

interface Glyph { text: string; x: number; y: number; w: number; h: number }
interface Box { x: number; y: number; w: number; h: number }
function scan(tree: AreaTree, sheet = 0) {
  const glyphs: Glyph[] = [];
  const lines: Array<{ y: number; text: string }> = [];
  const borders: Box[] = [];
  const rec = (a: Area, ox: number, oy: number, line?: { y: number; text: string }) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { text?: string; border?: Record<string, unknown> };
    if (b.border && Object.keys(b.border).length) borders.push({ x, y, w: a.width, h: a.height });
    let ln = line;
    if (a.type === 'line') {
      ln = { y, text: '' };
      lines.push(ln);
    }
    if (a.type === 'glyph') {
      glyphs.push({ text: b.text ?? '', x, y, w: a.width, h: a.height });
      if (ln) ln.text += b.text ?? '';
    }
    for (const c of childrenOf(a)) rec(c as Area, x, y, ln);
  };
  rec(tree.sheets[sheet].page as unknown as Area, 0, 0);
  return { glyphs, lines: lines.filter((l) => l.text), borders };
}
const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 20pt } body { margin: 0; font-size: 20pt; line-height: 30pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const html = async (body: string, css = '', style?: 'ah') => scan((await typesetHtml(doc(body, css), { loadFont: loadCachedFont, ...(style ? { style } : {}) })).areaTree);

describe('line-break: auto (--style ah)', () => {
  const body = '<p style="width: 100pt">あいうえこーろ</p><p style="width: 100pt">あいうえこゝろ</p><p style="width: 100pt">あいうえこょろ</p><p style="width: 100pt; line-break: normal">あいうえこーろ</p>';
  it('--style ah: 小書きの仮名・長音記号・繰返し記号の前でも改行する。line-break: normal の指定は normal のまま', async () => {
    const t = (await html(body, '', 'ah')).lines.map((l) => l.text);
    expect(t).toEqual(['あいうえこ', 'ーろ', 'あいうえこ', 'ゝろ', 'あいうえこ', 'ょろ', 'あいうえ', 'こーろ']);
  });
  it('ほかのスタイル: auto は normal (CSS Text 3 §5.2)。小書きの仮名・長音記号・繰返し記号の前で改行しない', async () => {
    const t = (await html(body)).lines.map((l) => l.text).filter((x) => !/^\d+$/.test(x));
    expect(t).toEqual(['あいうえ', 'こーろ', 'あいうえ', 'こゝろ', 'あいうえ', 'こょろ', 'あいうえ', 'こーろ']);
  });
});

describe('行グリッド (-ah-baseline-grid)', () => {
  it('new の箱の最後の行の半行間が負なら、箱は em の箱の下端まで (後ろの箱を下げる)', async () => {
    const css = 'h1 { -ah-baseline-grid: new; font-size: 40pt; line-height: 20pt; margin: 0 }';
    const g = await html('<h1>題</h1><p>本</p>', css);
    const g0 = await html('<h1 style="-ah-baseline-grid: normal">題</h1><p>本</p>', css);
    const gap = (r: typeof g) => r.glyphs.find((x) => x.text === '本')!.y - r.glyphs.find((x) => x.text === '題')!.y;
    // 題の後ろが、半行間 (20 − 40) / 2 = −10pt の分だけ広がる
    expect(gap(g) - gap(g0)).toBeCloseTo(10, 1);
  });
  it('root の格子はページの本文の領域の上端から引く (箱の上端からではない)', async () => {
    const css = 'figcaption { -ah-baseline-grid: root; font-size: 10pt; margin: 0 } div.sp { height: 7pt }';
    const a = await html('<div class="sp"></div><figcaption>図</figcaption>', css);
    const b = await html('<div class="sp" style="height: 3pt"></div><figcaption>図</figcaption>', css);
    const ya = a.glyphs.find((x) => x.text === '図')!;
    const yb = b.glyphs.find((x) => x.text === '図')!;
    // どちらも同じ格子の線 (本文の上端 + 根元の字のアセント + 30pt の倍数) に載る: 7pt と 3pt の箱の後ろは、どちらも最初の格子
    // (箱の上端から引くと、4pt ずれる)
    expect(yb.y).toBeCloseTo(ya.y, 1);
  });
});

describe('-ah-last-line-end-indent', () => {
  const css = 'p { width: 200pt; text-align: justify; text-align-last: end }';
  it('負の値は、最後の行の終わりを外へ出す。::before の 0 の指定は、その中の行に効く', async () => {
    const base = await html('<p>あいう</p>', css);
    const out = await html('<p style="-ah-last-line-end-indent: -1em">あいう</p>', css);
    const right = (r: typeof base) => Math.max(...r.glyphs.map((g) => g.x + g.w));
    expect(right(out) - right(base)).toBeCloseTo(20, 1);
  });
  it('受け継ぐ (em は指定した要素の字の大きさで解決する)', async () => {
    const base = await html('<div><p>あいう</p></div>', css);
    const out = await html('<div style="-ah-last-line-end-indent: -1em; font-size: 10pt"><p style="font-size: 20pt">あいう</p></div>', css);
    const right = (r: typeof base) => Math.max(...r.glyphs.map((g) => g.x + g.w));
    expect(right(out) - right(base)).toBeCloseTo(10, 1);
  });
});

describe('縦書きの箱の左右の auto の余白', () => {
  it('幅が中身で決まる縦書きの箱は、左右が auto なら中央に置く (-ah-display-align のある箱も)', async () => {
    for (const extra of ['', ' -ah-display-align: center;']) {
      const r = await html('<div class="v"><p>あいう</p></div>', `div.v { writing-mode: vertical-rl; height: 5em; margin-left: auto; margin-right: auto; border: 1pt solid;${extra} }`);
      const b = r.borders[0];
      // 本文の幅 360pt の中央
      expect(b.x - 20 + b.w / 2).toBeCloseTo(180, 0);
    }
  });
});

describe('段組の釣り合わせ', () => {
  it('後ろの段ほど短くするために伸ばして、使う段の数を減らさない (2 段目が 1 段目より長くても 3 段に組む)', async () => {
    // CSS-Print 第 4 版の 5.2 の例と同じ形 (A4・--style ah・column-width: 12em の 3 段)
    const src = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>div.M { column-width: 12em; column-gap: 1em; column-rule: solid 1pt; border: solid 0.3pt gray; padding: 3pt }</style></head><body>
<div class="M"><p> column-width:を 12em と指定した段組のブロックです．段間 column-gap，段間罫 column-rule も指定しています．</p>
<pre>
div.MultiColW {
  column-width: 12em;
  column-gap: 1em;
  column-rule:
     solid 1pt;
}
</pre>
<p>段組の指定には，column-count を指定する代わりに column-width を指定します．</p></div></body></html>`;
    const r = scan((await typesetHtml(src, { loadFont: loadCachedFont, style: 'ah' })).areaTree);
    // 3 段目 (左端 385pt 付近) にも字がある (直す前は、1 段目を長くするために伸ばして 2 段だけになり、3 段目が空だった)
    expect(r.glyphs.filter((g) => g.text.trim() && g.x >= 380).length).toBeGreaterThan(0);
  });
});

describe('-ah-text-decoration-*', () => {
  it('-ah-text-decoration-line・-style・-color・-ah-text-line-width を、text-decoration-line・-style・-color・-thickness と同じに読む (wave は wavy)', () => {
    const d = new DOMParser().parseFromString('<html><head><title>t</title></head><body><span>あ</span></body></html>', 'text/html') as unknown as Document;
    const st = cascadeStyles(d, 'span { -ah-text-decoration-line: line-through; -ah-text-decoration-style: wave; -ah-text-decoration-color: red; -ah-text-line-width: 2pt }', { viewport: { width: 600, height: 800 } });
    const s = st.style(d.getElementsByTagName('span')[0] as unknown as Element);
    expect(s.getPropertyValue('text-decoration-line').trim()).toBe('line-through');
    expect(s.getPropertyValue('text-decoration-style').trim()).toBe('wavy');
    expect(s.getPropertyValue('text-decoration-color').trim()).toMatch(/255, 0, 0|red/);
    expect(s.getPropertyValue('text-decoration-thickness').trim()).toMatch(/^(2pt|2\.6+7px)$/);
  });
});

describe('和欧間のアキと全角の空白', () => {
  const gap = (r: ReturnType<typeof scan>) => {
    const sp = r.glyphs.find((g) => g.text === '\u3000')!;
    const w = r.glyphs.find((g) => g.text === 'W')!;
    return w.x - sp.x;
  };
  it('CSS の text-autospace: 全角の空白と W の間は空けない (CSS Text 4 §8.4.1。--style ah でも)', async () => {
    const r = scan((await typesetHtml(doc('<p>章\u3000Web</p>', 'p { -ah-text-autospace: ideograph-alpha; -ah-text-autospace-width: 25% }'), { loadFont: loadCachedFont, style: 'ah' })).areaTree);
    expect(gap(r)).toBeCloseTo(20, 1);
  });
  it('XSL-FO の axf:text-autospace (互換モード): 全角の空白も和字として、W との間を四分空ける', async () => {
    const fo = `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="400pt" page-height="400pt"><fo:region-body margin="20pt"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-size="20pt">章\u3000Web</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = scan((await typesetFo(fo, { loadFont: loadCachedFont, compat: 'antenna' })).areaTree);
    expect(gap(r)).toBeCloseTo(25, 1);
  });
});

describe('-ah-lang', () => {
  it('::marker の -ah-lang: en で、記号を欧文の書体で組む (日本語の文書の中でも)', async () => {
    const body = '<ul><li>あいう</li></ul>';
    const font = async (css: string) => {
      const t = (await typesetHtml(doc(body, `ul { list-style: circle } ${css}`), { loadFont: loadCachedFont })).areaTree;
      const fonts: string[] = [];
      const rec = (a: Area) => {
        const g = a as unknown as { text?: string; fontId?: string };
        if (a.type === 'glyph' && g.text === '◦') fonts.push((g.fontId ?? '').replace(/@.*$/, ''));
        for (const c of childrenOf(a)) rec(c as Area);
      };
      rec(t.sheets[0].page as unknown as Area);
      return fonts[0] ?? '';
    };
    const ja = await font('li::marker { font-family: sans-serif }');
    const en = await font('li::marker { font-family: sans-serif; -ah-lang: en }');
    expect(ja).not.toBe(en);
    expect(en).toMatch(/Arimo/);
  });
});

describe('両端揃えで字間を空けない箇所 (JLREQ §3.1.11)', () => {
  // 1 行目を両端揃えにするため、2 行に折れる長さにする。行は 285pt。1 行目に「あいうえお、かきくけこさしす」(280pt) が入り、余り 5pt を字間に配る
  const body = '<p style="width: 285pt; text-align: justify">あいうえお、かきくけこさしすせそたちつてと</p>';
  const gaps = (r: ReturnType<typeof scan>) => {
    const line = r.glyphs.filter((g) => Math.abs(g.y - r.glyphs[0].y) < 1);
    const at = (ch: string) => line.findIndex((g) => g.text === ch);
    const adv = (k: number) => line[k + 1].x - line[k].x;
    return { beforeComma: adv(at('お')) - 20, afterComma: adv(at('、')) - 20, kana: adv(at('あ')) - 20 };
  };
  it('既定: 読点の前と後ろは空けず、仮名どうしの字間に配る', async () => {
    const g = gaps(await html(body));
    expect(g.kana).toBeGreaterThan(0.1);
    expect(g.beforeComma).toBeCloseTo(0, 1);
    expect(g.afterComma).toBeCloseTo(0, 1);
  });
  it('--style ah: 読点の前と後ろも空ける (アンテナハウス互換)', async () => {
    const g = gaps(await html(body, '', 'ah'));
    expect(g.beforeComma).toBeGreaterThan(0.1);
  });
});

describe('接頭辞の付いた MathML (--style ah)', () => {
  const body = '<p>式 <m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mi>x</m:mi><m:mo>=</m:mo><m:mn>1</m:mn></m:math></p><pre>\n&lt;m:math xmlns:m="http://www.w3.org/1998/Math/MathML"&gt;</pre>';
  const texts = async (style?: 'ah') => {
    const r = await html(body, '', style);
    return { lines: r.lines.map((l) => l.text), glyphs: r.glyphs.map((g) => g.text).join('') };
  };
  it('prefixedForeignToHtml: タグだけを書き直し、本文の文字 (&lt;m:math …&gt;) は変えない', () => {
    expect(prefixedForeignToHtml(body)).toBe('<p>式 <math><mi>x</mi><mo>=</mo><mn>1</mn></math></p><pre>\n&lt;m:math xmlns:m="http://www.w3.org/1998/Math/MathML"&gt;</pre>');
  });
  it('--style ah: <m:math> を MathML として組む。ほかのスタイルは HTML の構文どおり (知らない要素の中の字)', async () => {
    const ah = await texts('ah');
    expect(ah.lines.some((t) => t.includes('<m:math xmlns:m="http://www.w3.org/1998/Math/MathML">'))).toBe(true);
    const def = await texts();
    // MathML で組むと、数式は 1 つの図 (画像の領域) になり、x=1 は字として並ばない。HTML の構文どおりなら、知らない要素の中の字のまま
    expect(ah.glyphs).not.toContain('x=1');
    expect(def.glyphs).toContain('x=1');
  });
});

describe('リストの外側の記号は、本文の最初の行の箱に入る (CSS Lists 3 §3.5)', () => {
  it('記号の字の下の部分が本文の字より深ければ、最初の行が下に伸び、入れ子のリストが下がる', async () => {
    // 記号だけ line-height を大きくして、記号の行を本文の行より深くする
    const body = '<ul><li>あいう<ul><li>えお</li></ul></li></ul>';
    const y = async (css: string) => {
      const r = await html(body, `ul { margin: 0; padding-left: 40pt } ${css}`);
      return r.glyphs.find((g) => g.text === 'え')!.y - r.glyphs.find((g) => g.text === 'あ')!.y;
    };
    const plain = await y('');
    const tall = await y('li::marker { line-height: 60pt }');
    // 記号の行の箱 (60pt) は、本文の行 (30pt) より基線の上も下も 15pt ずつ大きい。最初の行は上 (基線そろえ) と下の両方へ伸び、合わせて 30pt 下がる
    // (直す前は、基線そろえの上の 15pt だけだった)
    expect(tall - plain).toBeCloseTo(30, 0);
  });
});

/** Arimo の OS/2 の typo の上下を 0.75em・−0.25em (ちょうど 1em。基準線の比 0.75) に書き換えた書体 (和文の書体と基準線の比が違う欧文の書体。見本の source-sans-pro に当たる) */
function typo1emArimo(): Uint8Array {
  const buf = new Uint8Array(fs.readFileSync(path.join(fontDir, 'Arimo-Regular.ttf')));
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let k = 0; k < v.getUint16(4); k++) {
    const at = 12 + 16 * k;
    if (String.fromCharCode(...buf.slice(at, at + 4)) !== 'OS/2') continue;
    const off = v.getUint32(at + 8);
    v.setInt16(off + 68, Math.round(2048 * 0.75));
    v.setInt16(off + 70, -Math.round(2048 * 0.25));
  }
  return buf;
}

describe('-ah-alignment-baseline: text-after-edge の画像 (--style ah の和文の行)', () => {
  it("画像の下端を、和文の書体の em の箱の下端 (基線の 0.12em 下) にそろえる (先頭の欧文の書体の下の部分ではない)", async () => {
    const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
    const css = `@font-face { font-family: lat; src: url(Arimo-Regular.ttf) } p { font-family: lat, sans-serif } p::after { content: url("${svg}"); -ah-alignment-baseline: text-after-edge; height: 1em }`;
    const files = [{ name: 'c.css', data: css }, { name: 'Arimo-Regular.ttf', data: typo1emArimo() }];
    const tree = (await typesetHtml(doc('<p>あいう</p>'), { loadFont: loadCachedFont, style: 'ah', files })).areaTree;
    let img: { y: number; h: number } | undefined;
    let base: number | undefined;
    const rec = (a: Area, y: number) => {
      const ay = y + (a.y ?? 0);
      const g = a as unknown as { text?: string; baselineY?: number };
      if (a.type === 'image') img = { y: ay, h: a.height };
      if (a.type === 'glyph' && g.text === 'あ' && base === undefined) base = ay + (g.baselineY ?? 0);
      for (const c of childrenOf(a)) rec(c as Area, ay);
    };
    rec(tree.sheets[0].page as unknown as Area, 0);
    expect(img).toBeDefined();
    // 字の大きさ 20pt。和文の書体の em の箱の下端は基線の 0.12em (2.4pt) 下
    expect(img!.y + img!.h - base!).toBeCloseTo(2.4, 0);
  });
});

describe('合字の字形の行の高さ (代わりの書体の字。CSS Inline 3 §5.3)', () => {
  it('和文の行の欧文の合字 (ft) も、1 字の字と同じく、最初に使える書体 (和文の書体) の上下で行の高さを決める', async () => {
    // Source Sans 3 (見本の source-sans-pro の後継。OS/2 の typo の上下がちょうど 1em で、基準線の比が和文の書体と違う。ft・fi の合字を持つ)
    const css = '@font-face { font-family: lat; src: url(ss3.otf) } p { font-family: lat, sans-serif }';
    const files = [{ name: 'c.css', data: css }, { name: 'ss3.otf', data: fs.readFileSync(await extraTestFont('SourceSans3-Regular-3.052R.otf')) }];
    const pitch = async (word: string) => {
      const tree = (await typesetHtml(doc(`<p>${word}あ</p><p>あ</p>`, 'body { line-height: normal }'), { loadFont: loadCachedFont, style: 'ah', files })).areaTree;
      const ys: number[] = [];
      const rec = (a: Area, y: number) => {
        const ay = y + (a.y ?? 0);
        const g = a as unknown as { text?: string; baselineY?: number };
        if (a.type === 'glyph' && g.text === 'あ') ys.push(ay + (g.baselineY ?? 0));
        for (const c of childrenOf(a)) rec(c as Area, ay);
      };
      rec(tree.sheets[0].page as unknown as Area, 0);
      return ys[1] - ys[0];
    };
    // line-height: normal の行。合字にならない並び (fa) と同じ行送り (和文の書体の上下で決まる)。
    // これまでは合字の字形だけ代わりの書体の扱いにならず、欧文の書体の上下 (和文の書体より浅い) で行が決まり、行送りが 2pt 狭くなった
    const fa = await pitch('fa');
    expect(await pitch('ft')).toBeCloseTo(fa, 1);
  });
});

describe('脚注の参照記号の行の高さ (代わりの書体の字。CSS Inline 3 §5.3)', () => {
  it('参照記号の字も、最初に使える書体 (和文の書体) の上下で、その字の行内の箱を決める', async () => {
    // 先頭の欧文の書体 (基準線の比 0.75) に参照記号の字 (数字) があり、和文の書体 (比 0.88) とは下の部分が違う
    const css = '@font-face { font-family: lat; src: url(Arimo-Regular.ttf) } p { font-family: lat, sans-serif; -ah-line-height-shift-adjustment: disregard-shifts } .fn { float: footnote } ::footnote-call { font-size: 10pt }';
    const files = [{ name: 'c.css', data: css }, { name: 'Arimo-Regular.ttf', data: typo1emArimo() }];
    const tree = (await typesetHtml(doc('<p>あいう<span class="fn">注</span></p><p>あ</p>'), { loadFont: loadCachedFont, style: 'ah', files })).areaTree;
    const ys: number[] = [];
    const rec = (a: Area, y: number) => {
      const ay = y + (a.y ?? 0);
      const g = a as unknown as { text?: string; baselineY?: number };
      if (a.type === 'glyph' && g.text === 'あ') ys.push(ay + (g.baselineY ?? 0));
      for (const c of childrenOf(a)) rec(c as Area, ay);
    };
    rec(tree.sheets[0].page as unknown as Area, 0);
    // 見本 (CSS-Print 第 4 版) と同じく、持ち上げた参照記号を、持ち上げる前の位置で行の高さに数える (disregard-shifts)。
    // 字の大きさ 20pt・行の高さ 30pt。本文の行内の箱の下は 0.12em + 半行間 5pt = 7.4pt。参照記号 (10pt) の箱の下は、和文の書体の
    // 0.12em (1.2pt) + 半行間 10pt = 11.2pt で、行は 3.8pt 下に伸びる (欧文の書体の 0.25em で数えると 5.1pt 伸びる)
    expect(ys[1] - ys[0]).toBeCloseTo(33.8, 1);
  });
});

describe('-ah-text-justify-trim・axf:text-justify-trim (追込みで詰めてよいアキ。アンテナハウスの拡張)', () => {
  /** 1 行目の字 (行の基線が最初の 'あ' と同じ字) */
  const firstLine = (tree: AreaTree): string => {
    const gs: { y: number; t: string; x: number }[] = [];
    const rec = (a: Area, x: number, y: number) => {
      const ax = x + (a.x ?? 0);
      const ay = y + (a.y ?? 0);
      const g = a as unknown as { text?: string; baselineY?: number };
      if (a.type === 'glyph' && g.text) gs.push({ y: Math.round(ay + (g.baselineY ?? 0)), t: g.text, x: ax });
      for (const c of childrenOf(a)) rec(c as Area, ax, ay);
    };
    rec(tree.sheets[0].page as unknown as Area, 0, 0);
    const y0 = Math.min(...gs.map((g) => g.y));
    return gs.filter((g) => g.y === y0).sort((a, b) => a.x - b.x).map((g) => g.t).join('');
  };
  it('punctuation: 行中の句点の後ろも詰めて、字を行に収める (既定は JLREQ §3.8.3 のとおり詰めない)', async () => {
    // 幅 9.5em (と少し) に 10 字: 句点「。」の後ろの二分を詰めれば入る
    const body = (v: string) => `<p style="width: 190.5pt; text-align: justify; text-indent: 0${v}">あいうえお。かきくけ</p>`;
    expect(firstLine((await typesetHtml(doc(body('')), { loadFont: loadCachedFont, style: 'ah' })).areaTree)).toBe('あいうえお。かきく');
    expect(firstLine((await typesetHtml(doc(body('; -ah-text-justify-trim: punctuation')), { loadFont: loadCachedFont, style: 'ah' })).areaTree)).toBe('あいうえお。かきくけ');
    // 句点を除く指定は既定と同じ。接頭辞の付いた拡張なので、--style ah でなくても読む
    expect(firstLine((await typesetHtml(doc(body('; -ah-text-justify-trim: punctuation-except-fullstop')), { loadFont: loadCachedFont, style: 'ah' })).areaTree)).toBe('あいうえお。かきく');
    expect(firstLine((await typesetHtml(doc(body('; -ah-text-justify-trim: punctuation')), { loadFont: loadCachedFont })).areaTree)).toBe('あいうえお。かきくけ');
  });
  it('none: 約物のアキを詰めない (axf:text-justify-trim。見本の axf-text-justify-trim-1 と同じ行分け)', async () => {
    const fo = (v: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block-container width="10em" font-size="13pt"${v}><fo:block text-align="justify">（あいうえお。かき・くけこ）</fo:block></fo:block-container></fo:flow></fo:page-sequence></fo:root>`;
    // 互換モードの既定 (auto) は、中点の前後のアキを詰めて「く」まで入れる
    expect(firstLine((await typesetFo(fo(''), { loadFont: loadCachedFont, compat: 'antenna' })).areaTree)).toBe('（あいうえお。かき・く');
    expect(firstLine((await typesetFo(fo(' axf:text-justify-trim="none"'), { loadFont: loadCachedFont, compat: 'antenna' })).areaTree)).toBe('（あいうえお。かき・');
  });
});

describe('::footnote-call の text-autospace (-ah-text-autospace)', () => {
  it('no-autospace (-ah-text-autospace: none) なら、参照番号と前の和字の間を空けない (見本の PDF: CSS-Print 第 4 版)', async () => {
    const xOf1 = async (rule: string) => {
      const tree = (await typesetHtml(doc('<p>あいう<span class="fn">注</span></p>', `.fn { float: footnote } ::footnote-call { font-size: 10pt; ${rule} }`), { loadFont: loadCachedFont, style: 'ah' })).areaTree;
      const xs: Record<string, number> = {};
      const rec = (a: Area, x: number) => {
        const ax = x + (a.x ?? 0);
        const g = a as unknown as { text?: string };
        if (a.type === 'glyph' && g.text && xs[g.text] === undefined) xs[g.text] = ax;
        for (const c of childrenOf(a)) rec(c as Area, ax);
      };
      rec(tree.sheets[0].page as unknown as Area, 0);
      return xs['1'] - xs['う'];
    };
    // 既定は和欧間の四分アキ (参照番号の字の大きさ 10pt の 1/4 = 2.5pt) を空ける
    expect(await xOf1('')).toBeCloseTo(22.5, 1);
    expect(await xOf1('-ah-text-autospace: none')).toBeCloseTo(20, 1);
    expect(await xOf1('text-autospace: no-autospace')).toBeCloseTo(20, 1);
  });
});

describe('リストの最後の項目の最後の子の下の余白 (CSS 2.1 §8.3.1)', () => {
  it('リストの後ろのブロックの上の余白と重なる (足し合わせない)', async () => {
    const gap = async (body: string) => {
      const tree = (await typesetHtml(doc(body, 'ul { margin: 0 } h3 { font-size: 20pt; margin: 10pt 0 0 }'), { loadFont: loadCachedFont })).areaTree;
      const ys: Record<string, number> = {};
      const rec = (a: Area, y: number) => {
        const ay = y + (a.y ?? 0);
        const g = a as unknown as { text?: string; baselineY?: number };
        if (a.type === 'glyph' && g.text && ys[g.text] === undefined) ys[g.text] = ay + (g.baselineY ?? 0);
        for (const c of childrenOf(a)) rec(c as Area, ay);
      };
      rec(tree.sheets[0].page as unknown as Area, 0);
      return ys['見'] - ys['あ'];
    };
    // div の中の最後の子の余白 20pt と、見出しの余白 10pt は重なって 20pt
    const div = await gap('<div><div style="margin-bottom: 20pt">あ</div></div><h3>見</h3>');
    expect(await gap('<ul><li><div style="margin-bottom: 20pt">あ</div></li></ul><h3>見</h3>')).toBeCloseTo(div, 1);
    // li の余白とも重なる (大きい方の 30pt)
    expect(await gap('<ul><li style="margin-bottom: 30pt"><div style="margin-bottom: 20pt">あ</div></li></ul><h3>見</h3>')).toBeCloseTo(div + 10, 1);
  });
});

describe('表の -ah-baseline-grid (行グリッド。継承する)', () => {
  it('表に new があれば、セルの中も行グリッドの領域: 最初の行の前・最後の行の後ろに半行間を付けない', async () => {
    const pitch = async (grid: string) => {
      const css = `table { border-collapse: collapse; font-size: 10pt; line-height: 20pt; ${grid} } td { padding: 2pt; border-bottom: 1pt solid }`;
      const tree = (await typesetHtml(doc('<table><tr><td>あ</td></tr><tr><td>い</td></tr></table>', css), { loadFont: loadCachedFont, style: 'ah' })).areaTree;
      const ys: Record<string, number> = {};
      const rec = (a: Area, y: number) => {
        const ay = y + (a.y ?? 0);
        const g = a as unknown as { text?: string; baselineY?: number };
        if (a.type === 'glyph' && g.text) ys[g.text] = ay + (g.baselineY ?? 0);
        for (const c of childrenOf(a)) rec(c as Area, ay);
      };
      rec(tree.sheets[0].page as unknown as Area, 0);
      return ys['い'] - ys['あ'];
    };
    // 指定が無ければ、行の送りは line-height 20pt + padding 4pt + 罫線 (重ねた罫線の分) 0.5pt
    const plain = await pitch('');
    expect(plain).toBeCloseTo(24.5, 1);
    // 行グリッドでは、行の箱は字の大きさ (10pt) だけで、半行間 10pt の分だけ狭い (見本の PDF: CSS-Print 第 4 版の 10.1 の表は、
    // 行の高さが 字の大きさ + padding + 罫線 = line-height 1 つ分)
    expect(await pitch('-ah-baseline-grid: new')).toBeCloseTo(plain - 10, 1);
  });
});

describe('行グリッドに行を載せる位置 (-ah-baseline-grid)', () => {
  const baselineOf = async (body: string, ch: string) => {
    const tree = (await typesetHtml(doc(body), { loadFont: loadCachedFont, style: 'ah' })).areaTree;
    let top: number | undefined;
    let base: number | undefined;
    const rec = (a: Area, y: number) => {
      const ay = y + (a.y ?? 0);
      const g = a as unknown as { text?: string; baselineY?: number };
      if (a.type === 'glyph' && g.text === '基' && top === undefined) top = ay + (g.baselineY ?? 0);
      if (a.type === 'glyph' && g.text === ch && base === undefined) base = ay + (g.baselineY ?? 0);
      for (const c of childrenOf(a)) rec(c as Area, ay);
    };
    rec(tree.sheets[0].page as unknown as Area, 0);
    return base! - top!;
  };
  it('格子を作った字より小さい字の行も、格子の字の em の箱の上端が入る格子に載せる', async () => {
    // 格子: 字の大きさ 20pt・行送り 30pt。基の行の次に、上の余白 10pt の 10pt の段落。行の上端 + 格子の字の em の上 (20pt × 0.88) が
    // 次の格子の基線を越えるので、その次の格子 (2 つ下) に載る (見本の PDF: CSS-Print 第 4 版の root の figcaption)。
    // これまでは段落の字 (10pt) の em の上で数え、次の格子に載せていた
    const d = await baselineOf('<div style="-ah-baseline-grid: new; font-size: 20pt; line-height: 30pt"><p>基</p><p style="font-size: 10pt; margin-top: 10pt">小</p></div>', '小');
    expect(d).toBeCloseTo(60, 1);
  });
  it('disregard-shifts の行では、上付きの字で次の格子へ送らない', async () => {
    const h = (sup: string) => `<div style="-ah-baseline-grid: new; -ah-line-height-shift-adjustment: disregard-shifts; font-size: 20pt; line-height: 30pt"><p>基</p><p style="margin-top: 5pt">見${sup}</p></div>`;
    // 上付きが無ければ次の格子 (30pt 下)。これまでは上付きの字の持ち上げた上端で数え、その次の格子 (60pt 下) へ送っていた
    expect(await baselineOf(h('®'), '見')).toBeCloseTo(30, 1);
    expect(await baselineOf(h('<sup>®</sup>'), '見')).toBeCloseTo(30, 1);
  });
});

describe('XSL-FO の行内の箱の角丸 (HTM-64)', () => {
  const radiusOf = async (attr: string, compat: 'spec' | 'antenna') => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200pt" page-height="200pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>a<fo:inline-container width="20pt" height="20pt" border="1pt solid black" ${attr}><fo:block>b</fo:block></fo:inline-container></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const tree = (await typesetFo(fo, { loadFont: loadCachedFont, compat })).areaTree;
    let r: unknown;
    const rec = (a: Area) => {
      const b = a as unknown as { borderRadius?: unknown; border?: unknown };
      if (b.border && b.borderRadius) r = b.borderRadius;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(tree.sheets[0].page as unknown as Area);
    return r;
  };
  it('fo:inline-container の axf:border-radius を描く (どのモードでも)。接頭辞の無い border-radius は互換モードだけ (見本の axf-form-field-1)', async () => {
    expect(await radiusOf('axf:border-radius="5pt"', 'spec')).toBeDefined();
    expect(await radiusOf('axf:border-radius="5pt"', 'antenna')).toBeDefined();
    expect(await radiusOf('border-radius="5pt"', 'antenna')).toBeDefined();
    expect(await radiusOf('border-radius="5pt"', 'spec')).toBeUndefined();
  });
});

describe('ページの余白の箱の counter(page) (HTM-31 (4))', () => {
  it('箱ごとの数の書式で数を字にし、その箱の text-transform を当てる (文書の最初の counter(page) の書式を全部の箱に使わない)', async () => {
    const html = '<!DOCTYPE html><html><head><style>@page { size: 200pt 100pt; margin: 30pt; @top-left { content: "p" counter(page) } @bottom-center { content: counter(page, lower-roman) "abc"; text-transform: uppercase } }</style></head><body><p>x</p><p style="break-before: page">y</p></body></html>';
    const tree = (await typesetHtml(html, { loadFont: loadCachedFont })).areaTree;
    const texts = tree.sheets.map((sh) => {
      let t = '';
      const rec = (a: Area) => {
        const g = a as unknown as { text?: string };
        if (a.type === 'glyph' && g.text) t += g.text;
        for (const c of childrenOf(a)) rec(c);
      };
      rec(sh.page as unknown as Area);
      return t;
    });
    expect(texts[0]).toContain('p1');
    expect(texts[0]).toContain('IABC');
    expect(texts[1]).toContain('p2');
    expect(texts[1]).toContain('IIABC');
  });
});

describe('--style ah の幅が auto の表の列の幅 (HTM-32 (2))', () => {
  it('入りきらない表は、最大の長さが均等割りの半分を超える短い列も、最大の長さの比で縮める (CSS-Print の「PDF/A の大きな特徴」の表)', async () => {
    const th = Array.from({ length: 8 }, (_, k) => `<th>PDF/A-${k}a</th>`).join('');
    const td = Array.from({ length: 8 }, () => '<td>○</td>').join('');
    const html = doc(
      `<table><tr><th>要件</th>${th}</tr><tr><td>${'あ'.repeat(40)}</td>${td}</tr></table>`,
      '@page { size: 437pt 400pt; margin: 20pt } body { margin: 0; font-size: 8.5pt } table { border-collapse: collapse; margin: 0 auto } td, th { padding: 3pt; border: 0.5pt solid }',
    );
    const r = scan((await typesetHtml(html, { loadFont: loadCachedFont, style: 'ah' })).areaTree);
    // 「PDF/」の行の左端 (列の始まり) の間隔 = 列の幅
    const xs = r.glyphs.filter((g) => g.text === 'P').map((g) => g.x).sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThanOrEqual(8);
    const colW = xs[1] - xs[0];
    // 列の最大の長さ (「PDF/A-0a」+ padding) の比: 均等割り (397 / 9 ≒ 44pt) 以下でも、最大の長さ (約 39pt) のままにしない
    expect(colW).toBeLessThan(34);
    // 1 列目は、その分だけ広い (最大の長さの比で配った幅)
    expect(xs[0]).toBeGreaterThan(160);
  });
});

describe('行グリッドの表のセルの行の送り (HTM-32 (2))', () => {
  it('-ah-baseline-grid: new の表のセルの中の行は、格子 (line-height) に載せず、em の箱を積む', async () => {
    const cellText = 'あ'.repeat(12);
    const html = doc(`<table><tr><td>${cellText}</td></tr></table>`, 'table { font-size: 10pt; line-height: 20pt; -ah-baseline-grid: new; border-collapse: collapse } td { width: 50pt; padding: 0 }');
    const r = scan((await typesetHtml(html, { loadFont: loadCachedFont })).areaTree);
    const ys = [...new Set(r.glyphs.filter((g) => g.text === 'あ').map((g) => Math.round(g.y * 10) / 10))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    // 行の送りは字の大きさ (10pt)。line-height (20pt) の格子に載せない
    expect(ys[1] - ys[0]).toBeCloseTo(10, 0);
  });
});
