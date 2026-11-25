/**
 * 和欧間のアキ (CSS の text-autospace) の相手の字の範囲 (台帳 CSS-24 の (7))。
 * CSS Text 4 §8.4.1: ideographs と non-ideographic letters (一般カテゴリ L・M の字。East_Asian_Width が W・F の字を除く)・
 * non-ideographic numerals (Nd の字。F を除く) の間に空ける。縦書きで正立にする字は除く。記号・句読点は入らない。
 * HTML の既定のスタイルは、この定義どおり (ギリシャ・キリル・ヘブライ・インド系の字なども)。互換の指定 (--style ah・vivliostyle・weasyprint) は、
 * 見本で確かめられないので、これまでどおりラテン文字・数字 (と、欧文の書体で組むギリシャ文字・キリル文字の語) だけ
 *
 * テストの書体は Noto Sans JP (字形の無い字も、送りは決まるので、アキの量は測れる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import type { Area, GlyphArea } from '../src/types';
import { autospaceNonIdeographic } from '../src/jis';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

type G = { g: GlyphArea; x: number; y: number };
/** 本文の字 (GlyphArea) と、ページの上での位置 */
async function glyphs(body: string, opts: { style?: 'ah' | 'vivliostyle' | 'weasyprint'; css?: string } = {}): Promise<G[]> {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;margin:0} ${opts.css ?? ''}</style><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }], ...(opts.style ? { style: opts.style } : {}) });
  const out: G[] = [];
  const visit = (a: Area, ox: number, oy: number) => {
    if (a.type === 'glyph') out.push({ g: a, x: ox + a.x, y: oy + a.y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, ox + a.x, oy + a.y);
  };
  visit(r.areaTree.sheets[0].page.regionBody as never, 0, 0);
  return out;
}

/** 横書き: 字の組 (前の字・後ろの字) ごとの、字と字の間のアキ (pt)。字の送りの後ろから、次の字の始まりまで */
async function gaps(text: string, opts: { style?: 'ah' | 'vivliostyle' | 'weasyprint'; css?: string } = {}): Promise<number[]> {
  // 右から左の字 (ヘブライ文字) は並べ替えた後の位置なので、左から順に並べ直す
  const gs = (await glyphs(`<p>${text}</p>`, opts)).sort((a, b) => a.x - b.x);
  const out: number[] = [];
  for (let k = 0; k + 1 < gs.length; k++) out.push(Math.round((gs[k + 1].x - (gs[k].x + gs[k].g.width)) * 100) / 100 + 0);
  return out;
}
/** 縦書き: 字と字の間のアキ (pt) */
async function vgaps(text: string, css: string): Promise<number[]> {
  const gs = await glyphs(`<p>${text}</p>`, { css: `html{writing-mode:vertical-rl} ${css}` });
  const out: number[] = [];
  for (let k = 0; k + 1 < gs.length; k++) out.push(Math.round((gs[k + 1].y - (gs[k].y + gs[k].g.height)) * 100) / 100 + 0);
  return out;
}

/** 10pt の 1/8 (CSS Text 4 §8.4.1 の 0.125ic) */
const S = 1.25;

describe('字の種類 (CSS Text 4 §8.4.1。jis.ts の autospaceNonIdeographic)', () => {
  it('L・M の字は letters、Nd の字は numerals', () => {
    for (const c of ['A', 'é', 'α', 'Ж', 'ש', 'ع', 'क', 'ก', '́', 'ｱ']) expect(autospaceNonIdeographic(c), c).toBe('alpha');
    for (const c of ['0', '٣', '७']) expect(autospaceNonIdeographic(c), c).toBe('numeric');
  });
  it('ideographs・East_Asian_Width が W・F の字 (ハングル・全角の英数字)・記号・句読点・Nd でない数は入らない', () => {
    for (const c of ['漢', 'あ', 'ア', 'ー', '한', 'Ａ', '０', '©', '∞', '.', '-', ' ', 'Ⅻ', '①', '²']) expect(autospaceNonIdeographic(c), c).toBeUndefined();
  });
});

describe('HTML の既定のスタイル: §8.4.1 の定義どおりに空ける', () => {
  it('単独のギリシャ文字・キリル文字の前後も空ける (直す前は、2 字以上の語だけ)', async () => {
    expect(await gaps('漢α漢')).toEqual([S, S]);
    expect(await gaps('漢Ж漢')).toEqual([S, S]);
  });
  it('ヘブライ文字・デーヴァナーガリー・タイ文字の語の前後も空ける', async () => {
    expect((await gaps('漢नमस्ते'))[0]).toBe(S);
    expect((await gaps('漢สวัสดี'))[0]).toBe(S);
  });
  it('右から左の字との境目は、並べ替えの後の見た目の境目に空ける (§8.4.2)。左から右の段落・右から左の段落とも', async () => {
    // 左から右の段落: 漢 [םולש] 漢。直す前の置き方 (論理の前の字の後ろ) では、右の境目のアキがヘブライ文字の語の中に入った
    // (ヘブライ文字は 1 字ずつの GlyphArea)
    expect(await gaps('漢שלום漢')).toEqual([S, 0, 0, 0, S]);
    expect(await gaps('漢字שלום')).toEqual([0, S, 0, 0, 0]);
    expect(await gaps('שלום漢字')).toEqual([0, 0, 0, S, 0]);
    // 右から左の段落: [םולש] 漢字 [םולש] (左から)
    const rtl = (await glyphs('<p dir="rtl">שלום漢字שלום</p>')).sort((p, q) => p.x - q.x);
    const g = rtl.slice(0, -1).map((e, k) => Math.round((rtl[k + 1].x - (e.x + e.g.width)) * 100) / 100 + 0);
    expect(g).toEqual([0, 0, 0, S, 0, S, 0, 0, 0]);
  });
  it('右から左の字の後ろで折り返したとき、次の行の頭の字の前のアキは捨てる', async () => {
    // ヘブライ文字の語 (20.56pt) と、その後ろの漢字が入らない幅
    const gs = await glyphs('<p style="width:25pt;text-indent:0">שלום漢</p>');
    const han = gs.find((e) => e.g.text === '漢')!;
    const heb = gs.filter((e) => e.g.text !== '漢');
    expect(han.y).toBeGreaterThan(heb[0].y);
    expect(han.x).toBeCloseTo(Math.min(...heb.map((e) => e.x)), 6);
  });
  it('アラビア・インドの数字 (Nd) も空ける', async () => {
    expect(await gaps('漢٣漢')).toEqual([S, S]);
    expect(await gaps('漢७漢')).toEqual([S, S]);
  });
  it('ラテン文字・数字は、これまでどおり空ける', async () => {
    expect(await gaps('漢A1漢')).toEqual([S, 0, S]);
  });
  it('ハングル・全角の英字・記号・ローマ数字 (Nl) の前後は空けない', async () => {
    expect(await gaps('漢한漢')).toEqual([0, 0]);
    expect(await gaps('漢Ａ漢')).toEqual([0, 0]);
    expect(await gaps('漢©漢')).toEqual([0, 0]);
    expect(await gaps('漢Ⅻ漢')).toEqual([0, 0]);
  });
  it('結合文字は基底の字と 1 つの単位: e + U+0301 の前後は空け、漢字 + 結合文字と漢字の間は空けない', async () => {
    expect(await gaps('漢é漢')).toEqual([S, S]);
    expect(await gaps('漢⃝漢')).toEqual([0]);
  });
  it('縦書きで正立にする字 (text-orientation: upright) は相手に数えない。横倒しの字 (mixed) は空ける', async () => {
    expect(await vgaps('漢α漢', 'p{text-orientation:upright}')).toEqual([0, 0]);
    expect(await vgaps('漢α漢', '')).toEqual([S, S]);
  });
  it('text-autospace: no-autospace なら空けない', async () => {
    expect(await gaps('漢α漢', { css: 'p{text-autospace:no-autospace}' })).toEqual([0, 0]);
  });
});

describe('互換の指定 (--style ah・vivliostyle・weasyprint): これまでどおりラテン文字・数字だけ', () => {
  for (const style of ['ah', 'vivliostyle', 'weasyprint'] as const) {
    it(`${style}: 単独のギリシャ文字・ヘブライ文字の前後は空けず、ラテン文字の前後は空ける`, async () => {
      const g = await gaps('漢α漢', { style, css: 'p{text-autospace:normal}' });
      expect(g).toEqual([0, 0]);
      const he = await gaps('漢שלום漢', { style, css: 'p{text-autospace:normal}' });
      expect(he[0]).toBe(0);
      const la = await gaps('漢A漢', { style, css: 'p{text-autospace:normal}' });
      expect(la[0]).toBeGreaterThan(0);
    });
  }
});

describe('text-autospace の値の区別 (CSS Text 4 §8.4: ideograph-alpha・ideograph-numeric)', () => {
  it('normal は欧文の字と数字の両方、ideograph-alpha は欧文の字だけ、ideograph-numeric は数字だけに空ける', async () => {
    expect(await gaps('あAい1う')).toEqual([S, S, S, S]);
    expect(await gaps('あAい1う', { css: 'p { text-autospace: ideograph-alpha }' })).toEqual([S, S, 0, 0]);
    expect(await gaps('あAい1う', { css: 'p { text-autospace: ideograph-numeric }' })).toEqual([0, 0, S, S]);
    expect(await gaps('あAい1う', { css: 'p { text-autospace: ideograph-numeric ideograph-alpha insert }' })).toEqual([S, S, S, S]);
  });
  it('punctuation だけ (フランス語の約物の空き) なら、和字との間には空けない。text-spacing の autospace の語も同じに読む', async () => {
    expect(await gaps('あAい1う', { css: 'p { text-autospace: punctuation }' })).toEqual([0, 0, 0, 0]);
    expect(await gaps('あAい1う', { css: 'p { text-spacing: trim-start ideograph-numeric }' })).toEqual([0, 0, S, S]);
  });
  it('子の normal は、親の片方だけの指定を打ち消す。no-autospace の子孫の normal も両方に戻す', async () => {
    const css = 'div { text-autospace: ideograph-alpha } span { text-autospace: no-autospace } b { font-weight: normal; text-autospace: normal }';
    const gs = (await glyphs('<div><p><span><b>あ1い</b></span></p></div>', { css })).sort((a, b) => a.x - b.x);
    expect(Math.round((gs[1].x - (gs[0].x + gs[0].g.width)) * 100) / 100).toBe(S);
  });
});
