/**
 * HTML の横書きの行の中の基線の位置は、最初に使える書体の上の高さ・下の深さで決まる (LAY-20 の (2))。
 *  - CSS Inline 3 §5.3 (Working Draft 2024-12-18): 行間 L = line-height − (A + D) の半分ずつを、最初に使える書体の A の上と D の下に足す
 *    (A′ = A + L/2、D′ = D + L/2。L は負にもなる)。行内の箱の上端から基線までは A′ = (line-height + A − D) / 2
 *  - CSS 2.1 §10.8.1: 同じ式。行内の箱は基線でそろえ、行の箱は、いちばん高い箱の上端からいちばん低い箱の下端まで
 *    (書体の違う inline のある行は、line-height より高くなることがある)
 *  - §3.2.1: A・D は書体の ascent・descent。ここでは hhea の値 (line-height: normal の行の高さと同じ値。Chromium も同じ)
 *  - 縦書きは、字が中央の基線にそろう (CSS Writing Modes 4 §4.2) ので、行の中央のまま
 * 書体の値 (hhea。em に対する比): Noto Serif JP 1.151・0.286、Tinos 0.891・0.216・行間 0.042、Cousine 0.833・0.300、
 * Noto Serif Tibetan 1.466・1.349。
 * 直す前は、OS/2 の表のある書体をすべて A = 0.88em・D = 0.12em として置いていた (20pt・line-height: 2 の行は、どの書体でも上端から 27.6pt)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { defaultFontBuffer, ensureFonts, extraTestFont, fontBuffer, loadCachedFont } from './helpers';

let files: Array<{ name: string; data: Uint8Array }>;
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
  files = [
    { name: 'j.ttf', data: new Uint8Array(await fontBuffer()) },
    { name: 't.ttf', data: new Uint8Array(await defaultFontBuffer('Tinos-Regular.ttf')) },
    { name: 'c.ttf', data: new Uint8Array(await defaultFontBuffer('Cousine-Regular.ttf')) },
    { name: 'tib.ttf', data: new Uint8Array(fs.readFileSync(await extraTestFont('NotoSerifTibetan-Regular-v24.ttf'))) },
  ];
}, 300_000);

const FS = 20;
interface Metrics { a: number; d: number; gap: number }
const JP: Metrics = { a: 1.151, d: 0.286, gap: 0 };
const TINOS: Metrics = { a: 1825 / 2048, d: 443 / 2048, gap: 87 / 2048 };
const COUSINE: Metrics = { a: 1705 / 2048, d: 615 / 2048, gap: 0 };
const TIBETAN: Metrics = { a: 1.466, d: 1.349, gap: 0 };
/** 行内の箱の上端から基線まで A′ = (line-height + A − D) / 2 と、基線から下端まで D′ (pt)。lh は pt、size は字の大きさ */
const above = (f: Metrics, lh: number, size = FS) => (lh + (f.a - f.d) * size) / 2;
const below = (f: Metrics, lh: number, size = FS) => (lh - (f.a - f.d) * size) / 2;
const normal = (f: Metrics) => (f.a + f.d + f.gap) * FS;

interface Line { x: number; y: number; h: number; w: number; text: string; bases: number[]; xs: number[] }
function linesOf(tree: AreaTree): Line[] {
  const out: Line[] = [];
  const rec = (a: Area, ox: number, oy: number, line?: Line) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    let cur = line;
    if (a.type === 'line') out.push((cur = { x, y, h: a.height, w: a.width, text: '', bases: [], xs: [] }));
    const g = a as unknown as { text?: string; baselineY?: number; baselineX?: number };
    if (a.type === 'glyph' && cur) {
      cur.text += g.text ?? '';
      cur.bases.push(y + (g.baselineY ?? 0));
      cur.xs.push(x);
    }
    for (const c of childrenOf(a)) rec(c as Area, x, y, cur);
  };
  // 本文の領域だけ (既定のスタイルのページ番号の行は数えない)
  rec(tree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  return out;
}
/** 行の上端から、行の中の字の基線まで (字がすべて同じ基線にあることも確かめる) */
function baseOf(l: Line): number {
  for (const b of l.bases) expect(b).toBeCloseTo(l.bases[0], 2);
  return l.bases[0] - l.y;
}
const page = (body: string, wm = 'horizontal-tb') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 600pt; margin: 20pt }
@font-face { font-family: J; src: url(j.ttf) } @font-face { font-family: T; src: url(t.ttf) } @font-face { font-family: C; src: url(c.ttf) } @font-face { font-family: Tib; src: url(tib.ttf) }
html { writing-mode: ${wm} } body { margin: 0; font-size: ${FS}pt } p { margin: 0; text-indent: 0; text-align: left }</style></head><body>${body}</body></html>`;
const html = async (body: string, style: 'kumiori' | 'browser' | 'ah' | 'weasyprint' | 'vivliostyle' = 'kumiori', wm?: string) => linesOf((await typesetHtml(page(body, wm), { loadFont: loadCachedFont, files, style })).areaTree);

const TB = 'བོད་ཡིག';
const IMG = `<img src="data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22><rect width=%2212%22 height=%2212%22/></svg>" style="width: 12pt; height: 12pt">`;

describe('行の上端から基線までは (line-height + A − D) / 2: 最初に使える書体の上の高さ・下の深さで決まる (CSS Inline 3 §5.3・CSS 2.1 §10.8.1)', () => {
  const fonts: Array<[string, Metrics, string]> = [['J', JP, '漢字'], ['T', TINOS, 'abc'], ['C', COUSINE, 'abc'], ['Tib', TIBETAN, TB]];
  for (const [fam, f, text] of fonts) {
    it(`${fam}: line-height が 2・1・1.5 の行。行の高さ (行送り) は line-height のまま`, async () => {
      for (const lh of [2, 1, 1.5]) {
        const ls = await html(`<p style="font-family: ${fam}; line-height: ${lh}">${text}<br>${text}</p>`);
        expect(ls).toHaveLength(2);
        for (const l of ls) {
          expect(l.h, `${lh}`).toBeCloseTo(lh * FS, 2);
          expect(baseOf(l), `${lh}`).toBeCloseTo(above(f, lh * FS), 2);
        }
        expect(ls[1].bases[0] - ls[0].bases[0]).toBeCloseTo(lh * FS, 2);
      }
    });
    it(`${fam}: line-height: normal の行は、基線の上に A + 行間の半分、下に D + 行間の半分`, async () => {
      const ls = await html(`<p style="font-family: ${fam}; line-height: normal">${text}</p>`);
      expect(ls[0].h).toBeCloseTo(normal(f), 1);
      expect(baseOf(ls[0])).toBeCloseTo((f.a + f.gap / 2) * FS, 1);
    });
  }

  it('書体ごとに基線の位置が違う (直す前は、どの書体でも 0.88em の位置 = 27.6pt)', async () => {
    const at = async (fam: string, text: string) => baseOf((await html(`<p style="font-family: ${fam}; line-height: 2">${text}</p>`))[0]);
    expect(await at('J', '漢字')).toBeCloseTo(28.65, 2);
    expect(await at('T', 'abc')).toBeCloseTo(26.75, 1);
    expect(await at('C', 'abc')).toBeCloseTo(25.32, 1);
    expect(await at('Tib', TB)).toBeCloseTo(21.17, 2);
  });

  it('既定の書体 (総称の serif = 欧文 Tinos + 和文 Noto Serif JP): 最初に使える書体は Tinos。和文だけ・欧文だけ・混在の行で、基線の位置も行の高さも同じ', async () => {
    for (const style of ['kumiori', 'browser'] as const) {
      const ls = await html('<p style="font-family: serif; line-height: 2">abc<br>漢字<br>abc 漢字</p>', style);
      expect(ls).toHaveLength(3);
      for (const l of ls) {
        expect(l.h, style).toBeCloseTo(40, 2);
        expect(baseOf(l), style).toBeCloseTo(above(TINOS, 40), 2);
      }
    }
  });

  it('既定のスタイルの指定の無い段落 (line-height: 1.75): 行送りは 1.75 のまま、基線は 0.88em の位置より (0.88 − 0.8375) em 上', async () => {
    const ls = await html('<p>漢字 abc<br>漢字</p>');
    for (const l of ls) {
      expect(l.h).toBeCloseTo(1.75 * FS, 2);
      expect(baseOf(l)).toBeCloseTo(above(TINOS, 1.75 * FS), 2);
    }
    // 直す前の位置 (半行間 + 0.88em) との差
    expect((1.75 * FS - FS) / 2 + 0.88 * FS - baseOf(ls[0])).toBeCloseTo((0.88 - (0.5 + (TINOS.a - TINOS.d) / 2)) * FS, 2);
  });

  it('代わりの書体の字 (font-family: T, J の漢字): 行内の箱は最初に使える書体 (T) の値で決まるので、基線も行の高さも欧文だけの行と同じ', async () => {
    const ls = await html('<p style="font-family: T, J; line-height: 2">abc<br>abc 漢字<br>漢字</p>');
    for (const l of ls) {
      expect(l.h).toBeCloseTo(40, 2);
      expect(baseOf(l)).toBeCloseTo(above(TINOS, 40), 2);
    }
  });
});

describe('別の書体・大きさの inline: それぞれの箱 (A′・D′) を基線でそろえて、行の箱はいちばん高い上端からいちばん深い下端まで (CSS 2.1 §10.8・§10.8.1)', () => {
  it('欧文の書体の段落の中の、等幅の書体を名指しした span: 上は段落の書体の A′、下は span の書体の D′ (行は line-height より高くなる)', async () => {
    const ls = await html('<p style="font-family: T; line-height: 1.5">abc<span style="font-family: C">code</span>abc<br>abc</p>');
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 30), 2);
    expect(ls[0].h).toBeCloseTo(above(TINOS, 30) + below(COUSINE, 30), 2);
    expect(ls[0].h).toBeCloseTo(31.43, 1);
    // span の無い行は line-height のまま
    expect(ls[1].h).toBeCloseTo(30, 2);
  });

  it('和文の書体の段落の中の、欧文の書体の span と、その逆: どちらも、上は和文の書体の A′、下は欧文の書体の D′', async () => {
    const a = await html('<p style="font-family: J; line-height: 2">漢字<span style="font-family: T">abc</span>漢字</p>');
    const b = await html('<p style="font-family: T; line-height: 2">abc<span style="font-family: J">漢字</span>abc</p>');
    for (const ls of [a, b]) {
      expect(baseOf(ls[0])).toBeCloseTo(above(JP, 40), 2);
      expect(ls[0].h).toBeCloseTo(above(JP, 40) + below(TINOS, 40), 2);
    }
  });

  it('line-height: normal の和文の段落の中の、チベット文字の書体を名指しした span: span の箱は、その書体の A・D をそのまま囲む (下が切れない)', async () => {
    const ls = await html(`<p style="font-family: J; line-height: normal">漢字<span style="font-family: Tib">${TB}</span>漢字</p>`);
    // 上 = max(1.151, 1.466) × 20、下 = max(0.286, 1.349) × 20。直す前は、span の箱 (56.3pt) を em の箱の中央に置いていて、
    // 基線の上が 35.75pt・下が 20.55pt (チベット文字の下の深さ 26.98pt に足りない)
    expect(baseOf(ls[0])).toBeCloseTo(TIBETAN.a * FS, 1);
    expect(ls[0].h - baseOf(ls[0])).toBeCloseTo(TIBETAN.d * FS, 1);
  });

  it('大きい字の span (同じ書体・line-height は倍率): 行は span の line-height。基線は span の A′', async () => {
    const ls = await html('<p style="font-family: T; line-height: 1.5">abc<span style="font-size: 30pt">BIG</span>abc</p>');
    expect(ls[0].h).toBeCloseTo(45, 2);
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 45, 30), 2);
  });

  it('大きい字に小さい line-height・小さい字に大きい line-height が混じる行: 箱ごとの上端・下端の最大 (字の大きさの最大と line-height の最大を足し合わせない)', async () => {
    const ls = await html('<p style="font-family: T; line-height: 60pt">abc<span style="font-size: 40pt; line-height: 40pt">BIG</span></p>');
    // 段落の字: 上 (60 + 0.675 × 20) / 2 = 36.75、下 23.25。span: 上 (40 + 0.675 × 40) / 2 = 33.5、下 6.5 → 行は 60pt のまま
    expect(ls[0].h).toBeCloseTo(60, 2);
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 60), 2);
  });

  it('小さい inline-block (別の書体) のある行: 箱の上下が行の箱に収まれば、行は line-height のまま', async () => {
    const ls = await html('<p style="font-family: T; line-height: 2">abc<span style="display: inline-block; font-family: C; font-size: 14pt; line-height: 1.2">ib</span>abc</p>');
    const outer = ls.find((l) => l.text.includes('abc'))!;
    expect(outer.h).toBeCloseTo(40, 2);
    // inline-block の基線 (中の行の基線) は、まわりの字の基線にそろう
    const inner = ls.find((l) => l.text === 'ib')!;
    expect(inner.bases[0]).toBeCloseTo(outer.bases[0], 2);
    expect(baseOf(inner)).toBeCloseTo(above(COUSINE, 1.2 * 14, 14), 2);
  });
});

describe('行の中のほかのものは、基線の移動についてくる (行の高さは変わらない)', () => {
  const plain = async (fam: string, text: string) => baseOf((await html(`<p style="font-family: ${fam}; line-height: 2">${text}</p>`))[0]);

  it('強制改行 (br) で終わる行・空の行', async () => {
    const ls = await html('<p style="font-family: T; line-height: 2">abc<br><br>abc</p>');
    expect(ls).toHaveLength(3);
    for (const l of ls) expect(l.h).toBeCloseTo(40, 2);
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 40), 2);
    expect(ls[2].bases[0] - ls[0].bases[0]).toBeCloseTo(80, 2);
  });

  it('分綴した行 (行末にハイフンの字が付く行) も、ほかの行と同じ基線・同じ高さ', async () => {
    const ls = await html('<p lang="en" style="font-family: T; line-height: 2; width: 150pt; hyphens: auto">internationalization representation extraordinarily characteristically</p>');
    expect(ls.some((l) => /[-‐]$/.test(l.text))).toBe(true);
    for (const l of ls) {
      expect(l.h).toBeCloseTo(40, 2);
      expect(baseOf(l)).toBeCloseTo(above(TINOS, 40), 2);
    }
  });

  it('ルビ: 親文字の基線は、ルビの無い行と同じ。ルビの字は、親文字の基線からの位置が変わらない', async () => {
    const ls = await html('<p style="font-family: J; line-height: 2">前<ruby>漢字<rt>かんじ</rt></ruby>後</p>');
    expect(ls[0].h).toBeCloseTo(40, 2);
    const bases = [...new Set(ls[0].bases.map((b) => Math.round((b - ls[0].y) * 100) / 100))].sort((a, b) => a - b);
    // ルビの字 (10pt) の基線と、親文字の基線の 2 つ。親文字の上端 (基線 − 0.88em) にルビの字の下端 (基線 + 0.12em × 10pt) が接する
    expect(bases).toHaveLength(2);
    expect(bases[1]).toBeCloseTo(await plain('J', '漢字'), 2);
    expect(bases[1] - bases[0]).toBeCloseTo(0.88 * FS + 0.12 * 10, 1);
  });

  it('基線に置く画像: 画像の下端が字の基線。行の高さは変わらない', async () => {
    const tree = (await typesetHtml(page(`<p style="font-family: T; line-height: 2">abc${IMG}abc</p>`), { loadFont: loadCachedFont, files })).areaTree;
    const ls = linesOf(tree);
    expect(ls[0].h).toBeCloseTo(40, 2);
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 40), 2);
    let bottom = NaN;
    const rec = (a: Area, oy: number) => {
      const y = oy + (a.y ?? 0);
      if (a.type === 'image') bottom = y + a.height;
      for (const c of childrenOf(a)) rec(c as Area, y);
    };
    rec(tree.sheets[0].page.regionBody as unknown as Area, 0);
    expect(bottom).toBeCloseTo(ls[0].bases[0], 2);
  });

  it('罫線つきの inline (同じ書体): 行の高さも基線も変わらない', async () => {
    const ls = await html('<p style="font-family: T; line-height: 2">abc<span style="border: 1pt solid; padding: 2pt">box</span>abc</p>');
    expect(ls[0].h).toBeCloseTo(40, 2);
    expect(baseOf(ls[0])).toBeCloseTo(above(TINOS, 40), 2);
  });

  it('上付き (vertical-align: super。line-height: 0 の字): まわりの字の基線は動かない', async () => {
    const ls = await html('<p style="font-family: T; line-height: 2">abc<span style="vertical-align: super; font-size: 10pt; line-height: 0">2</span>abc</p>');
    expect(ls[0].h).toBeCloseTo(40, 2);
    const bases = ls[0].bases.map((b) => b - ls[0].y);
    expect(bases[0]).toBeCloseTo(above(TINOS, 40), 2);
    expect(bases[bases.length - 1]).toBeCloseTo(above(TINOS, 40), 2);
    expect(Math.min(...bases)).toBeLessThan(above(TINOS, 40) - 3);
  });
});

describe('行グリッド (-ah-baseline-grid) と initial-letter も、同じ基線の位置を使う', () => {
  it('行グリッド: 格子の最初の基線は、箱の上端から、格子の書式の最初に使える書体の (0.5 + (A − D) / 2) em。以後は行送りごと', async () => {
    for (const [fam, f, text] of [['T', TINOS, 'abc'], ['J', JP, '漢字']] as const) {
      const ls = await html(`<div style="-ah-baseline-grid: new; font-family: ${fam}; line-height: 40pt"><p>${text}<br>${text}</p><p style="font-size: 10pt; line-height: 15pt">${text}<br>${text}</p><p>${text}</p></div>`);
      expect(ls).toHaveLength(5);
      // ページの上の余白 20pt の下から
      ls.forEach((l, k) => expect(l.bases[0], `${fam} ${k}`).toBeCloseTo(20 + (0.5 + (f.a - f.d) / 2) * FS + k * 40, 1));
    }
  });

  it('initial-letter (和文の字。ideographic): 字の枠の上端は最初の行の字の枠の上端、下端は N 行目の字の枠の下端', async () => {
    const tree = (await typesetHtml(page(`<style>p.d::first-letter { initial-letter: 2 }</style><p class="d" style="font-family: J; line-height: 2; width: 200pt">漢${'あ'.repeat(30)}</p>`), { loadFont: loadCachedFont, files })).areaTree;
    const gs: Array<{ text: string; y: number; size: number; base: number }> = [];
    const rec = (a: Area, oy: number) => {
      const y = oy + (a.y ?? 0);
      const g = a as unknown as { text?: string; fontSize?: number; baselineY?: number };
      if (a.type === 'glyph') gs.push({ text: g.text ?? '', y, size: g.fontSize ?? 0, base: y + (g.baselineY ?? 0) });
      for (const c of childrenOf(a)) rec(c as Area, y);
    };
    rec(tree.sheets[0].page.regionBody as unknown as Area, 0);
    const letter = gs.find((g) => g.text === '漢')!;
    const rows = [...new Set(gs.filter((g) => g.text === 'あ').map((g) => Math.round(g.base * 100) / 100))].sort((a, b) => a - b);
    // まわりの字: 1 行目の基線は、ページの上の余白 20pt + (40 + (1.151 − 0.286) × 20) / 2 = 28.65pt、字の枠はその 0.88em 上から。2 行目は 40pt 下
    expect(rows[0]).toBeCloseTo(20 + above(JP, 40), 1);
    expect(letter.size).toBeCloseTo(40 + FS, 1);
    expect(letter.y).toBeCloseTo(rows[0] - 0.88 * FS, 1);
    expect(letter.y + letter.size).toBeCloseTo(rows[1] + 0.12 * FS, 1);
  });
});

describe('既定のスタイルごと: アンテナハウス互換 (--style ah) だけは、基線を字の枠 (em の箱) の位置に置く', () => {
  it('kumiori・browser・weasyprint・vivliostyle: 書体の上の高さ・下の深さから (CSS Inline 3 §5.3)', async () => {
    for (const style of ['kumiori', 'browser', 'weasyprint', 'vivliostyle'] as const) {
      const ls = await html('<p style="font-family: J; line-height: 2">漢字</p><p style="font-family: T; line-height: 2">abc</p>', style);
      expect(baseOf(ls[0]), style).toBeCloseTo(above(JP, 40), 2);
      expect(baseOf(ls[1]), style).toBeCloseTo(above(TINOS, 40), 2);
    }
  });

  it('ah: 行の上端から基線までは、半行間 + 0.88em (和文の書体の字の枠の上端から基線まで)。別の書体の span があっても行は高くならない', async () => {
    // アンテナハウスの公開の見本 (『CSS ページ組版入門』) との組み比べで、基線が合うのは字の枠の位置 (htmlImport.ts の emBoxBaselineAh の説明)
    const ls = await html('<p style="font-family: J; line-height: 2">漢字</p><p style="font-family: T; line-height: 2">abc</p><p style="font-family: T; line-height: 2">abc<span style="font-family: C">code</span>abc</p>', 'ah');
    for (const l of ls) {
      expect(l.h).toBeCloseTo(40, 2);
      expect(baseOf(l)).toBeCloseTo(10 + 0.88 * FS, 2);
    }
  });

  it('ah の line-height: normal の行: 代わりの書体 (読み込んだ書体) の上下は、字の枠の位置の基線に合わせて数える (行の高さは、書体の上下を囲む高さ)', async () => {
    const ls = await html(`<p style="font-family: J, Tib; line-height: normal">${TB} 漢字</p>`, 'ah');
    // 上 max(1.151, 1.466)、下 max(0.286, 1.349) を囲む高さ (1651f72 と同じ)
    expect(ls[0].h).toBeCloseTo((TIBETAN.a + TIBETAN.d) * FS, 1);
  });
});

describe('縦書きの行は、字が中央の基線にそろう (CSS Writing Modes 4 §4.2): 書体が違っても行の幅は line-height のまま、字は行の中央', () => {
  it('和文の書体の段落・欧文の書体の span のある段落: 行の幅は line-height。和文の字の箱 (1em) の中央が行の中央', async () => {
    const ls = await html('<p style="font-family: J; line-height: 2">漢字</p><p style="font-family: J; line-height: 2">漢<span style="font-family: C">abc</span>字</p>', 'kumiori', 'vertical-rl');
    expect(ls).toHaveLength(2);
    for (const l of ls) {
      expect(l.w).toBeCloseTo(40, 2);
      // 漢字の字の箱の左端 (最初の字) は、行の左端 + 半行間 (10pt)
      expect(l.xs[0] - l.x).toBeCloseTo(10, 2);
    }
  });
});
