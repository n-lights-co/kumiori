/**
 * line-height: normal の行の高さと、代わりの書体 (font-family の並びの 2 番目以降・後備の書体) の字 (LAY-20 の (1))。
 *  - CSS Inline 3 §5.3: 計算値が normal の行内の箱の「layout bounds」は、中の字すべてを囲む (いちばん高い A から、いちばん深い D まで。
 *    1 つの箱の字が別々の書体から来ることがあり、A・D は書体ごとに違う)。normal でないときは、最初に使える書体の値だけで決める
 *  - §5.1 の注: 最初に使える書体のほかの書体の値が効くのは、line-height: normal の行内の箱だけ
 *  - §6.4 の注: 代わりの書体の字は、内容の領域 (背景の箱) の高さには効かないが、line-height が normal なら行の箱の大きさには効く
 *  - CSS 2.1 §10.8.1: 字ごとに A・D を決める (1 つの要素の字が別々の書体から来ることがある)
 * 書体の値 (hhea。em に対する比): Noto Serif JP 1.151・0.286・行間 0、Tinos 0.891・0.216・行間 0.042、
 * Noto Sans Myanmar 1.324・0.860・行間 0、Noto Serif Tibetan 1.466・1.349・行間 0。
 * 行の高さ = (上の最大) + (下の最大)。行間 (line gap) は、書体ごとに半分ずつ上下に足す (§5.3)
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
    { name: 'm.ttf', data: new Uint8Array(fs.readFileSync(await extraTestFont('NotoSansMyanmar-Regular-v27.ttf'))) },
    { name: 'tib.ttf', data: new Uint8Array(fs.readFileSync(await extraTestFont('NotoSerifTibetan-Regular-v24.ttf'))) },
  ];
}, 300_000);

const FS = 20;
const JP = { a: 1.151, d: 0.286, gap: 0 };
const TINOS = { a: 1825 / 2048, d: 443 / 2048, gap: 87 / 2048 };
const MYANMAR = { a: 1.324, d: 0.86, gap: 0 };
const TIBETAN = { a: 1.466, d: 1.349, gap: 0 };
/** 書体の並びの字が混じる行の高さ (pt): 上 (A + 行間の半分) の最大 + 下 (D + 行間の半分) の最大 */
const mixed = (...fonts: Array<{ a: number; d: number; gap: number }>) => (Math.max(...fonts.map((f) => f.a + f.gap / 2)) + Math.max(...fonts.map((f) => f.d + f.gap / 2))) * FS;

interface Line { y: number; h: number; w: number; text: string; base: number }
function linesOf(tree: AreaTree): Line[] {
  const out: Line[] = [];
  const rec = (a: Area, ox: number, oy: number, line?: Line) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    let cur = line;
    if (a.type === 'line') out.push((cur = { y, h: a.height, w: a.width, text: '', base: NaN }));
    const g = a as unknown as { text?: string; baselineY?: number };
    if (a.type === 'glyph' && cur) {
      cur.text += g.text ?? '';
      cur.base = y + (g.baselineY ?? 0);
    }
    for (const c of childrenOf(a)) rec(c as Area, x, y, cur);
  };
  // 本文の領域だけ (既定のスタイルのページ番号の行は数えない)
  rec(tree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  return out;
}
const page = (body: string, wm = 'horizontal-tb') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 600pt; margin: 20pt }
@font-face { font-family: J; src: url(j.ttf) } @font-face { font-family: T; src: url(t.ttf) } @font-face { font-family: M; src: url(m.ttf) } @font-face { font-family: Tib; src: url(tib.ttf) } @font-face { font-family: R; src: url(j.ttf); unicode-range: U+0-7F } @font-face { font-family: R; src: url(j.ttf); unicode-range: U+3000-9FFF }
html { writing-mode: ${wm} } body { margin: 0; font-size: ${FS}pt } p { margin: 0; text-indent: 0; text-align: left }</style></head><body>${body}</body></html>`;
const html = async (body: string, style: 'kumiori' | 'browser' = 'kumiori', wm?: string) => linesOf((await typesetHtml(page(body, wm), { loadFont: loadCachedFont, files, style })).areaTree);

const MY = 'မြန်မာ';
const TB = 'བོད་ཡིག';

describe('line-height: normal の行の高さは、行の字に使われた書体それぞれの上下から決める (CSS Inline 3 §5.3)', () => {
  it('和文の書体の後ろに並べたミャンマー文字の書体 (font-family: J, M) の字の混じる行は、両方の書体の上下を囲む高さ。行が重ならない', async () => {
    const ls = await html(`<p style="font-family: J, M; line-height: normal">${MY} 漢字<br>${MY} 漢字<br>${MY} 漢字</p>`);
    expect(ls).toHaveLength(3);
    // (1.324 + 0.860) × 20 = 43.68 (直す前は、和文の書体だけの 1.437 × 20 = 28.74)
    for (const l of ls) expect(l.h).toBeCloseTo(mixed(JP, MYANMAR), 1);
    expect(ls[1].base - ls[0].base).toBeCloseTo(43.68, 1);
    // 基線の下に、ミャンマー文字の書体の下の深さ (0.860em) が入る: 行の下端 − 基線は、和文だけの行より深い
    const jp = await html('<p style="font-family: J, M; line-height: normal">漢字</p>');
    expect(ls[0].y + ls[0].h - ls[0].base - (jp[0].y + jp[0].h - jp[0].base)).toBeCloseTo((MYANMAR.d - JP.d) * FS, 1);
  });

  it('同じ段落でも、代わりの書体の字の無い行は、最初に使える書体の高さのまま', async () => {
    const ls = await html(`<p style="font-family: J, M; line-height: normal">漢字<br>${MY}<br>漢字<br>漢字</p>`);
    expect(ls.map((l) => Math.round(l.h * 100) / 100)).toEqual([28.74, 43.68, 28.74, 28.74]);
  });

  it('上下にさらに大きい書体 (チベット文字) の字: (1.466 + 1.349) × 20 = 56.3', async () => {
    const ls = await html(`<p style="font-family: J, Tib; line-height: normal">${TB} 漢字<br>${TB} 漢字</p>`);
    for (const l of ls) expect(l.h).toBeCloseTo(mixed(JP, TIBETAN), 1);
    expect(mixed(JP, TIBETAN)).toBeCloseTo(56.3, 1);
  });

  it('欧文の書体の後ろに和文の書体を並べた指定 (font-family: T, J): 和文の字のある行は和文の書体の高さ、欧文だけの行は欧文の書体の高さ', async () => {
    const ls = await html('<p style="font-family: T, J; line-height: normal">abc<br>abc 漢字<br>漢字<br>abc</p>');
    const t = (TINOS.a + TINOS.d + TINOS.gap) * FS;
    expect(ls[0].h).toBeCloseTo(t, 1);
    expect(ls[1].h).toBeCloseTo(mixed(TINOS, JP), 1);
    expect(ls[2].h).toBeCloseTo(mixed(TINOS, JP), 1);
    expect(ls[3].h).toBeCloseTo(t, 1);
    expect(mixed(TINOS, JP)).toBeCloseTo(28.74, 1);
  });

  it('unicode-range で分けた同じ書体 (上下の値が同じ) の字が混じっても、行の高さは変わらない', async () => {
    const ls = await html('<p style="font-family: R; line-height: normal">abc<br>abc 漢字<br>漢字</p>');
    for (const l of ls) expect(l.h).toBeCloseTo((JP.a + JP.d) * FS, 2);
    // 基線の位置も同じ
    expect(ls[1].base - ls[1].y).toBeCloseTo(ls[0].base - ls[0].y, 2);
  });

  it('ルビの親文字が代わりの書体の字のときも、その書体の上下を数える', async () => {
    const ls = await html(`<p style="font-family: J, M; line-height: normal"><ruby>${MY}<rt>みゃんまー</rt></ruby></p>`);
    expect(ls[0].h).toBeGreaterThanOrEqual(mixed(JP, MYANMAR) - 0.05);
  });

  it('縦書き: 字は中央の基線にそろうので、代わりの書体の字の行の幅は、その書体の上下 + 行間を半分ずつ', async () => {
    const ls = await html(`<p style="font-family: J, M; line-height: normal">漢字<br>${MY}漢字</p>`, 'kumiori', 'vertical-rl');
    expect(ls).toHaveLength(2);
    // 縦書きの行の「高さ」は block 方向 (横) の幅。和文だけの行は 1.437 × 20、ミャンマー文字の混じる行は (1.324 + 0.860) × 20
    expect(ls[0].w).toBeCloseTo((JP.a + JP.d) * FS, 1);
    expect(ls[1].w).toBeCloseTo((MYANMAR.a + MYANMAR.d) * FS, 1);
  });
});

describe('line-height が normal でないときは、代わりの書体の字があっても行の高さは指定の値 (CSS Inline 3 §5.3: 最初に使える書体の値だけで決める)', () => {
  it('数 (line-height: 2)・長さ (30pt)・百分率 (150%)', async () => {
    for (const [lh, h] of [['2', 40], ['30pt', 30], ['150%', 30]] as const) {
      const ls = await html(`<p style="font-family: J, M; line-height: ${lh}">${MY} 漢字<br>${MY} 漢字</p>`);
      for (const l of ls) expect(l.h, lh).toBeCloseTo(h, 2);
    }
  });

  it('既定のスタイル (html の line-height: 1.75) の段落: 指定の無い段落の行は 1.75 のまま', async () => {
    const ls = await html(`<p style="font-family: J, M">${MY} 漢字<br>漢字</p>`);
    for (const l of ls) expect(l.h).toBeCloseTo(1.75 * FS, 2);
  });

  it('normal の段落の中の、line-height を指定した span の字: 指定の値 (親の normal は受け継がない)', async () => {
    const ls = await html(`<p style="font-family: J, M; line-height: normal">漢字<span style="line-height: 1">${MY}</span></p>`);
    expect(ls[0].h).toBeCloseTo((JP.a + JP.d) * FS, 1);
  });
});

describe('既定の書体 (読み込んだ書体でないもの) の line-height: normal は、これまでどおり 1.2。代わりの書体として使われたときは数えない', () => {
  it('総称の書体 (serif = 欧文 Tinos + 和文 Noto Serif JP) の和欧の混じる行・和文だけの行・欧文だけの行は、どれも 1.2 × 字の大きさ', async () => {
    const ls = await html('<p style="font-family: serif; line-height: normal">abc 漢字<br>漢字<br>abc</p>', 'browser');
    for (const l of ls) expect(l.h).toBeCloseTo(1.2 * FS, 2);
  });

  it('総称の書体の後ろに読み込んだ書体を並べた指定 (font-family: serif, M): 最初に使える書体は既定の書体なので、ミャンマー文字の無い行は 1.2、ある行はその書体の上下を囲む', async () => {
    const ls = await html(`<p style="font-family: serif, M; line-height: normal">abc 漢字<br>${MY} 漢字</p>`, 'browser');
    // 直す前は、並びの中の読み込んだ書体 (M) の値 (2.184) を、最初に使える書体でないのに段落の全部の行に当てていた
    expect(ls[0].h).toBeCloseTo(1.2 * FS, 1);
    expect(ls[1].h).toBeCloseTo((MYANMAR.a + MYANMAR.d) * FS, 1);
  });

  it('読み込んだ欧文の書体 (行の高さ 1.149) の後備として既定の和文の書体で組まれた字は、行の高さに数えない (行は最初に使える書体の高さのまま)', async () => {
    const ls = await html('<p style="font-family: T; line-height: normal">abc<br>abc 漢字</p>', 'browser');
    for (const l of ls) expect(l.h).toBeCloseTo((TINOS.a + TINOS.d + TINOS.gap) * FS, 1);
  });
});
