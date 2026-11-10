import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { defaultFontBuffer, doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { walkAreaTree } from '../src/areaTree';
import { renderSheetToCanvas } from '../src/canvasRenderer';
import type { Area, GlyphArea } from '../src/types';

/**
 * 字の単位は書記素クラスタ (CSS-09。UAX #29 の拡張書記素クラスタ、CSS Text 3 §1.3 の typographic character unit)。
 * 基底の字 + 結合文字・絵文字の並びは 1 つの字 (atom・GlyphArea) になり、1 つの書体でまとめて組む (GSUB・GPOS)。
 * 書体: 和文は Noto Serif JP、欧文は Arimo (結合文字の位置合わせ (GPOS の mark) を持つ)。手元の書体には、絵文字・タイ文字・
 * デーヴァナーガリー・ハングルの字母の字形が無いので、それらは「どの書体も並びを持たないとき」の組み方だけを確かめる
 */
let fonts: FontManager;
let measurer: Measurer;
let engine: LayoutEngine;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
  fonts.setLatinFallback(FAMILY, 'Arimo');
  measurer = new Measurer(fonts, 'fontkit');
  engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY });
});

const layout = (children: unknown[], extra: object = {}, wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') => engine.layout(doc([{ type: 'block', textAlign: 'start', children, ...extra }] as never, wm));
/** 組んだ字 (GlyphArea) と、その x (ブロックの左端から)・y */
const glyphsOf = (children: unknown[], extra: object = {}, wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') => {
  const out: Array<{ g: GlyphArea; x: number; y: number }> = [];
  const visit = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ g: a, x, y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
  };
  for (const c of layout(children, extra, wm).sheets[0].page.regionBody.children) visit(c, 0, 0);
  return out;
};
const texts = (text: string, extra: object = {}) => glyphsOf([text], extra).map((e) => e.g.text);
const xs = (text: string, extra: object = {}) => glyphsOf([text], extra).map((e) => e.x);
/** 行ごとの字 (GlyphArea の文字列を | でつなぐ) */
const lineTexts = (children: unknown[], extra: object = {}) => {
  const block = layout(children, extra).sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
  return block.children.map((line) => {
    const s: string[] = [];
    const visit = (a: Area) => {
      if (a.type === 'glyph') s.push(a.text);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    visit(line);
    return s.join('|');
  });
};

const E_ACUTE = 'e\u0301';
/** 合成済みの字の無い並び (q + U+0301)。書体の位置合わせ (GPOS の mark) で組む */
const Q_ACUTE = 'q\u0301';
const KA_DAKUTEN = 'が';
const FAMILY_EMOJI = '👨‍👩‍👧';
const THUMB = '👍🏽';
const FLAG_JP = '🇯🇵';
const KEYCAP = '1️⃣';

describe('基底の字 + 結合文字は 1 つの字になり、1 つの書体でまとめて組む (UAX #29 GB9・CSS Fonts 4 §5.3)', () => {
  it('e + U+0301 (分解形) は、合成済みの é を書体が持てば、その字で組む (正準等価な並びは同じ見た目。CSS Fonts 4 §5.3)', () => {
    expect(texts(`${E_ACUTE}x${E_ACUTE}`)).toEqual(['é', 'x', 'é']);
    expect(xs(`${E_ACUTE}x${E_ACUTE}`)).toEqual(xs('éxé'));
    // ベトナム語の 2 段の記号 (e + U+0323 + U+0302 → ệ)・多調のギリシャ語 (α + U+0313 + U+0301 → ἄ)・キリル文字 (и + U+0306 → й)
    expect(texts('e\u0323\u0302x')).toEqual(['ệ', 'x']);
    expect(texts('e\u0302\u0323x')).toEqual(['ệ', 'x']);
    expect(texts('\u03b1\u0313\u0301x')).toEqual(['ἄ', 'x']);
    expect(texts('\u0438\u0306x')).toEqual(['й', 'x']);
    // 一部だけ合成できる並び (ệ + U+0301): 合成した字 + 残りの結合文字を、1 つの字として書体でまとめて組む
    expect(texts('e\u0323\u0302\u0301x')).toEqual(['ệ\u0301', 'x']);
  });
  it('合成済みの字の無い並び (q + U+0301) は 1 つの字。送りは基底の字と同じ', () => {
    expect(texts(`${Q_ACUTE}x${Q_ACUTE}`)).toEqual([Q_ACUTE, 'x', Q_ACUTE]);
    expect(xs(`${Q_ACUTE}x${Q_ACUTE}`)).toEqual(xs('qxq'));
  });
  it('和文の分解形 (か + U+3099) は、合成せずに、書体でまとめて組む (ラテン・ギリシャ・キリル文字だけを合成する)', () => {
    expect(texts(`${KA_DAKUTEN}x`)).toEqual([KA_DAKUTEN, 'x']);
  });
  it('結合文字は基底の字と同じ書体 (欧文の書体) で組み、書体の位置合わせ (GPOS の mark) で基底の字の上に載る', () => {
    const [{ g }] = glyphsOf([Q_ACUTE]);
    const arimo = fonts.get('Arimo', 400);
    expect(g.fontFamily).toBe('Arimo');
    expect(g.glyphIds).toEqual([arimo.fk.glyphForCodePoint(0x71).id, arimo.fk.glyphForCodePoint(0x301).id]);
    // 送りは基底の字の分だけ。結合文字は送り 0 で、基底の字の送りの中 (左) へずらして置く
    const pos = g.glyphPositions!;
    expect(pos[0][0]).toBe(arimo.fk.glyphForCodePoint(0x71).advanceWidth);
    expect(pos[1][0]).toBe(0);
    expect(pos[1][1]).toBeLessThan(0);
    expect(g.advance).toBeCloseTo((pos[0][0] / arimo.unitsPerEm) * 10, 6);
  });
  it('か + U+3099 (濁点) は 1 つの字で、送りは全角 1 字分', () => {
    const g = glyphsOf([`${KA_DAKUTEN}き${KA_DAKUTEN}`]);
    expect(g.map((e) => e.g.text)).toEqual([KA_DAKUTEN, 'き', KA_DAKUTEN]);
    expect(g.map((e) => e.x)).toEqual([0, 10, 20]);
    expect(g[0].g.fontFamily).toBe(FAMILY);
    expect(g[0].g.glyphIds?.length).toBe(2);
  });
  it('結合文字が 2 つ続いても 1 つの字 (a + U+0308 + U+0301。合成できる分 (ä) は合成済みの字にする)', () => {
    expect(texts('a\u0308\u0301b')).toEqual(['ä\u0301', 'b']);
    expect(xs('a\u0308\u0301b')).toEqual(xs('ab'));
  });
  it('ZWJ でつないだ絵文字の並び (GB11) は 1 つの字。書体が ZWJ の字形を持たなければ、ZWJ は書体に渡さない (豆腐にしない)', () => {
    // 手元の書体が持つ Extended_Pictographic の字 (♥ U+2665) で確かめる
    const g = glyphsOf(['♥‍♥あ']);
    expect(g.map((e) => e.g.text)).toEqual(['♥♥', 'あ']);
    const f = fonts.get(g[0].g.fontFamily, 400);
    expect(g[0].g.glyphIds).toEqual([f.fk.glyphForCodePoint(0x2665).id, f.fk.glyphForCodePoint(0x2665).id]);
    // 並びの前後の字 (豆腐になる字を含む) の組み方は変わらない
    expect(glyphsOf(['\u{1F600}'])[0].g.advance).toBe(10);
  });
});

describe('字の単位の途中に、改行・字間・両端揃えの空きを入れない (CSS Text 3 §1.3・§5.1・§5.5・§8.2)', () => {
  it('字間 (letter-spacing) は、字の単位の後ろに 1 度だけ', () => {
    const w = xs(`${Q_ACUTE}x`)[1];
    expect(xs(`${Q_ACUTE}x`, { letterSpacing: 2 })[1]).toBeCloseTo(w + 2, 6);
    expect(xs(`${KA_DAKUTEN}き${KA_DAKUTEN}く`, { letterSpacing: 2 })).toEqual([0, 12, 24, 36]);
  });
  it('狭い幅 + word-break: break-all・overflow-wrap: anywhere でも、字の単位の途中で分けない', () => {
    for (const extra of [{ wordBreak: 'break-all' }, { overflowWrap: 'anywhere' }, { wordBreak: 'break-all', overflowWrap: 'anywhere' }]) {
      expect(lineTexts([`${KA_DAKUTEN}${KA_DAKUTEN}${KA_DAKUTEN}`], { width: 15, ...extra })).toEqual([KA_DAKUTEN, KA_DAKUTEN, KA_DAKUTEN]);
      expect(lineTexts([`${Q_ACUTE}${Q_ACUTE}${Q_ACUTE}`], { width: 3, ...extra })).toEqual([Q_ACUTE, Q_ACUTE, Q_ACUTE]);
      expect(lineTexts(['♥‍♥♥‍♥'], { width: 5, ...extra })).toEqual(['♥♥', '♥♥']);
    }
  });
  it('どの書体も並びを持たない絵文字の並び (字ごとに組む) も、途中で分けない。国旗は対の間でだけ分ける (UAX #14 LB30a)', () => {
    for (const extra of [{ wordBreak: 'break-all' }, { overflowWrap: 'anywhere' }]) {
      const one = (s: string) => [...s].filter((c) => c !== '️').join('|');
      expect(lineTexts([FAMILY_EMOJI + FAMILY_EMOJI], { width: 5, ...extra })).toEqual([one(FAMILY_EMOJI), one(FAMILY_EMOJI)]);
      expect(lineTexts([THUMB + THUMB], { width: 5, ...extra })).toEqual([one(THUMB), one(THUMB)]);
      expect(lineTexts([FLAG_JP + '🇺🇸'], { width: 5, ...extra })).toEqual(['🇯|🇵', '🇺|🇸']);
      expect(lineTexts([KEYCAP + KEYCAP], { width: 5, ...extra })).toEqual(['1️|⃣', '1️|⃣']);
    }
  });
  it('どの書体も並びを持たない並びの途中には、字間も両端揃えの空きも入らない', () => {
    // 字間: 並びの最後の字の後ろにだけ
    const g = glyphsOf([THUMB + 'あ'], { letterSpacing: 3 });
    expect(g.map((e) => e.x)).toEqual([0, 10, 23]);
    // 両端揃え: 2 行に分かれる 1 行目 (絵文字の並び 2 つ + 仮名) の空きは、字の単位の間にだけ入る
    const j = glyphsOf([`${THUMB}あ${THUMB}あ${THUMB}あ`], { width: 45, textAlign: 'justify' });
    expect(j[1].x - j[0].x).toBe(10);
    expect(j[4].x - j[3].x).toBe(10);
    expect(j[2].x - j[1].x).toBeGreaterThan(10);
  });
  it('両端揃えの空きは、基底の字と結合文字の間に入らない (1 つの字のまま広がる)', () => {
    const j = glyphsOf([`${KA_DAKUTEN}き${KA_DAKUTEN}き${KA_DAKUTEN}き`], { width: 45, textAlign: 'justify' });
    expect(j.slice(0, 4).map((e) => e.g.text)).toEqual([KA_DAKUTEN, 'き', KA_DAKUTEN, 'き']);
    expect(j[3].x + 10).toBeCloseTo(45, 3);
  });
});

describe('字の種類で決まる処理は、基底の字で決める (UAX #14 LB9)', () => {
  it('和欧間のアキ: 結合文字の付いた欧字と和字の間にも入る', () => {
    const gap = (t: string) => xs(t, { textAutospace: true })[1] - xs(t)[1];
    expect(gap(`${Q_ACUTE}漢`)).toBeCloseTo(2.5, 1);
    expect(gap(`漢${Q_ACUTE}`)).toBeCloseTo(2.5, 1);
    expect(gap(`${KA_DAKUTEN}A`)).toBeCloseTo(2.5, 1);
  });
  it('改行の機会: 結合文字の付いた字の前後は、基底の字と同じ (欧文の語の中では分けず、和字の間では分ける)', () => {
    expect(lineTexts([`caf${Q_ACUTE} caf${Q_ACUTE}`], { width: 25 })).toEqual([`c|a|f|${Q_ACUTE}`, `c|a|f|${Q_ACUTE}`]);
    expect(lineTexts([`あ${KA_DAKUTEN}あ${KA_DAKUTEN}`], { width: 25 })).toEqual([`あ|${KA_DAKUTEN}`, `あ|${KA_DAKUTEN}`]);
    // 行頭禁則の字 (小書きの仮名) は、結合文字が付いても行頭に来ない
    expect(lineTexts([`ああっ゙あ`], { width: 20 })).toEqual(['あ', `あ|っ゙`, 'あ']);
  });
  it('縦書き: 向きと送りは基底の字で決まる (和字は正立で全角送り、欧字は横倒し)', () => {
    const v = glyphsOf([`あ${KA_DAKUTEN}${Q_ACUTE}い`], {}, 'vertical-rl');
    expect(v.map((e) => e.g.text)).toEqual(['あ', KA_DAKUTEN, Q_ACUTE, 'い']);
    expect(v.map((e) => e.g.rotation)).toEqual([0, 0, 90, 0]);
    expect(v[2].y - v[1].y).toBe(10);
    const eWidth = xs(`${Q_ACUTE}x`)[1];
    expect(v[3].y - v[2].y).toBeCloseTo(eWidth, 6);
  });
  it('縦書きの正立の字: 字形は縦書き用 (vert) のまま、結合文字の位置は横書きと同じ (書体の GPOS の vert のずらしを使わない)', () => {
    const [{ g }] = glyphsOf([KA_DAKUTEN], {}, 'vertical-rl');
    const f = fonts.get(FAMILY, 400);
    const vert = f.fk.layout(KA_DAKUTEN, { vert: true } as never);
    // この書体は、縦書きの機能で濁点を 1 字分ずらす (そのまま使うと、濁点が基底の字から離れる)
    expect(vert.positions[1].yOffset).not.toBe(0);
    expect(g.features).toEqual(['vert']);
    expect(g.glyphIds).toEqual(vert.glyphs.map((x) => x.id));
    expect(g.glyphPositions).toBeUndefined();
  });
  it('縦書きの正立の字で、書体が 1 字分の字形にまとめない並び (合字の無い ZWJ の並び) は、字ごとに縦に並べる (横に並べて行からはみ出さない)', () => {
    const v = glyphsOf(['♥\u200D♥'], {}, 'vertical-rl');
    expect(v.map((e) => e.g.text)).toEqual(['♥', '\u200D', '♥']);
    expect(v[2].y).toBeGreaterThanOrEqual(10);
    expect(v[2].x).toBe(v[0].x);
    // 横書きでは 1 つの字 (送りは 2 字分)
    expect(glyphsOf(['♥\u200D♥あ']).map((e) => e.x)).toEqual([0, 20]);
  });
  it('ルビの親文字・ルビ文字の結合文字も、基底の字と 1 つ (割り付けの字の数に数えない)', () => {
    const r = measurer.ruby(`${KA_DAKUTEN}き`, `か${KA_DAKUTEN}`, { fontFamily: FAMILY, fontSize: 10 }, 'horizontal-tb');
    expect(r.baseGlyphs.map((g) => g.draw ?? g.ch)).toEqual([KA_DAKUTEN, 'き']);
    expect(r.rubyGlyphs.length).toBe(2);
    expect(r.baseAdvance).toBeCloseTo(20, 6);
  });
});

describe('書体が並びを持たないとき (CSS Fonts 4 §5.3 の 1 の後半・3)', () => {
  it('結合文字を持たないが合成済みの字を持つ書体では、合成済みの字 (NFC) で組む', async () => {
    const f = new FontManager();
    const buf = fs.readFileSync(await extraTestFont('NotoSansJP-Regular-v25.otf'));
    await f.registerBuffer('Sans', 400, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, false);
    const m = new Measurer(f, 'fontkit');
    expect(f.hasGlyph(f.get('Sans'), '́')).toBe(false);
    const gs = m.glyphs(`${E_ACUTE}x`, { fontFamily: 'Sans', fontSize: 10 }, 'horizontal-tb');
    expect(gs.map((g) => g.draw ?? g.ch)).toEqual(['é', 'x']);
    expect(gs[0].advance).toBe(m.glyph('é', { fontFamily: 'Sans', fontSize: 10 }, 'horizontal-tb').advance);
  });
  it('どの書体も持たない並び (デーヴァナーガリー・ハングルの字母) は、字ごとに組む (これまでと同じ字形と送り)', () => {
    const g = glyphsOf(['का가']);
    expect(g.map((e) => e.g.text)).toEqual(['क', 'ा', 'ᄀ', 'ᅡ']);
    expect(g.map((e) => e.x)).toEqual([0, 10, 20, 30]);
  });
});

describe('結合文字も絵文字の並びも含まない文字列は、クラスタの処理を通らない', () => {
  it('和文・欧文・拡張 B の漢字・絵文字 1 字の文字列では、クラスタの解決を呼ばない', () => {
    const spy = vi.spyOn(measurer, 'resolveClusters');
    const cl = vi.spyOn(measurer, 'clusterGlyph');
    try {
      layout(['吾輩は猫である。「名前」はまだ無い—Hello, world! café 𠮷野家 😀 한국어 ﬁ']);
      measurer.ruby('漢字', 'かんじ', { fontFamily: FAMILY, fontSize: 10 }, 'horizontal-tb');
      expect(spy).not.toHaveBeenCalled();
      // 異体字セレクタの並びは、これまでどおり異体字の組み方 (クラスタの計測は通らない)
      expect(texts('葛\u{E0100}城')).toEqual(['葛\u{E0100}', '城']);
      expect(cl).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      cl.mockRestore();
    }
  });
});

describe('PDF に出る字形 (クラスタの字形の番号と位置)', () => {
  it('q + U+0301 は、基底の字と結合文字の 2 つの字形を、結合文字を基底の字の送りの中へずらして書く', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    // 欧文の書体は Source Sans 3 (GPOS の mark を持つ。Arimo は、すべての字形を埋め込むと fontkit が読めない字形がある)
    const fonts = new FontManager();
    await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
    const buf = fs.readFileSync(await extraTestFont('SourceSans3-Regular-3.052R.otf'));
    await fonts.registerBuffer('Source Sans 3', 400, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, false);
    fonts.setLatinFallback(FAMILY, 'Source Sans 3');
    const tree = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY }).layout(doc([{ type: 'block', textAlign: 'start', children: [`${Q_ACUTE}x`] }] as never));
    const latin = fonts.get('Source Sans 3', 400);
    const [idE, idAcute, idX] = [0x71, 0x301, 0x78].map((c) => latin.fk.glyphForCodePoint(c).id);
    const seen: number[][] = [];
    walkAreaTree(tree, (a) => {
      if (a.type === 'glyph') seen.push(a.glyphIds ?? []);
    });
    expect(seen).toEqual([[idE, idAcute], [idX]]);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { subset: false }));
    const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
    const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
    const c = st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
    const hex = (id: number) => id.toString(16).padStart(4, '0');
    // 同じ基線の字形は 1 つの TJ にまとめて書く: e の後ろで、結合文字のずらしの分だけ戻り (TJ の正の数は左へ)、結合文字 (送り 0) の後ろで同じだけ進む
    const tj = new RegExp(`\\[<${hex(idE)}>([\\d.]+)<${hex(idAcute)}>(-[\\d.]+)<${hex(idX)}>\\] TJ`, 'i').exec(c);
    expect(tj).not.toBeNull();
    const back = Number(tj![1]);
    const adv = (latin.fk.glyphForCodePoint(0x71).advanceWidth / latin.unitsPerEm) * 1000;
    // 結合文字の原点は、基底の字の原点と、その送りの終わりの間。x の原点は、e の送りの終わり (結合文字は送りを足さない)
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(adv);
    expect(Number(tj![2])).toBe(-back);
  });
});

describe('Canvas に描く字形 (クラスタ)', () => {
  /** 1 ページ目を、呼び出しを記録する描画先に描く */
  const draw = (children: unknown[], glyphOutlines: boolean, wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') => {
    const calls: Array<[string, ...unknown[]]> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' ? (...args: unknown[]) => void calls.push([k, ...args]) : undefined),
      set: () => true,
    });
    const had = 'Path2D' in globalThis;
    if (!had) (globalThis as Record<string, unknown>).Path2D = class { constructor(public d: string) {} };
    try {
      renderSheetToCanvas(layout(children, {}, wm).sheets[0], { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement, fonts, { glyphOutlines, scale: 1, devicePixelRatio: 1 });
    } finally {
      if (!had) delete (globalThis as Record<string, unknown>).Path2D;
    }
    return calls;
  };
  it('書体をブラウザに登録しているとき: クラスタの文字列を 1 度の fillText で描く (ブラウザが同じ書体でまとめて組む)', () => {
    const texts = draw([`${Q_ACUTE}x${KA_DAKUTEN}`], false).filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toEqual([Q_ACUTE, 'x', KA_DAKUTEN]);
  });
  it('輪郭で描くとき: 基底の字と結合文字の 2 つの輪郭を、PDF と同じ位置 (結合文字は基底の字の送りの中) に描く', () => {
    const arimo = fonts.get('Arimo', 400);
    const calls = draw([Q_ACUTE], true);
    const fills = calls.map((c, k) => (c[0] === 'fill' ? k : -1)).filter((k) => k >= 0);
    expect(fills.length).toBe(2);
    // 輪郭ごとの translate (fill の 2 つ前: translate → scale → fill)
    const at = fills.map((k) => calls[k - 2]);
    expect(at.map((c) => c[0])).toEqual(['translate', 'translate']);
    const pos = arimo.fk.layout(Q_ACUTE, { kern: false, liga: false, clig: false } as never).positions;
    const k = 10 / arimo.unitsPerEm;
    expect(at[0].slice(1)).toEqual([0, -0]);
    expect(at[1][1] as number).toBeCloseTo((pos[0].xAdvance + pos[1].xOffset) * k, 6);
    expect(at[1][2] as number).toBeCloseTo(-pos[1].yOffset * k, 6);
  });
  it('縦書きの正立の字を輪郭で描くとき: 結合文字の位置は横書きと同じ (基底の字の送りの後ろ。縦書きの機能のずらしを使わない)', () => {
    const calls = draw([KA_DAKUTEN], true, 'vertical-rl');
    const fills = calls.map((c, k) => (c[0] === 'fill' ? k : -1)).filter((k) => k >= 0);
    expect(fills.map((k) => calls[k - 2].slice(1))).toEqual([[0, -0], [10, -0]]);
  });
});
