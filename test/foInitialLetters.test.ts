/**
 * XSL-FO のドロップキャップ (アンテナハウスの拡張 axf:initial-letters と、その仲間の axf:initial-letters-*)。
 * 製品の公開の説明 (ahf-ext.html のドロップキャップの節) とサンプル FO 集の見本の PDF に合わせる。ここでは、自分で作った FO と、
 * テストの中で作る画像で確かめる:
 *  - 字の大きさ: 最初の行の大文字の高さの上端から、N 行目の基線まで (small-caps の小文字が続くときは x-height から)。長さで書けば、その大きさ
 *  - 続く行は、字の箱の後ろから。沈める行の後ろの行は、内容の端から (adjacent はブロックの終わりまで字下げ)
 *  - raise (沈める行が 1): 字の上の分だけ、最初の行を下げる
 *  - 画像の頭字: 高さは字と同じ範囲、幅は縦横比から
 *  - axf:initial-letters-end-indent (行ごとの後ろの空き)・text-indent (字の箱のずらし。dcem は互換モードだけ)・-width・-color・
 *    -leading-punctuation="hide"・-leading-punctuation-position="hang"
 *  - 右から左へ書く横組みでは、字は右の端
 *  - 働かないとき (中の fo:block に axf:initial-letters がある外のブロック・text-align が center) と、対応していない値の知らせ
 *  - 字の箱より短いブロックの後ろのブロックも字の箱の横に字下げし、前との間に空きがあれば字の箱の下へ送る。頭字の性質の長さの dcem・ic
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce sit amet risus ut sapien vehicula aliquam molestie vitae lacus. In aliquam sem quis suscipit iaculis.';
/** 10pt の字・行の高さ 12pt・幅 200pt の本文の FO */
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-family="serif" font-size="10pt" line-height="12pt"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="240pt" page-height="400pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
/** 幅 40px・高さ 20px の画像 (縦横比 2:1) */
const png = encodePngStored({ width: 40, height: 20, rgba: new Uint8Array(40 * 20 * 4).fill(128) });

interface Glyph { t: string; x: number; y: number; w: number; fs: number; color?: string }
async function lay(body: string, compat: 'spec' | 'antenna' = 'antenna') {
  const r = await typeset(fo(body), { name: 't.fo', loadFont: loadCachedFont, compat, files: [{ name: 'pic.png', data: png }] });
  const lines: Array<{ x: number; y: number; t: string }> = [];
  const glyphs: Glyph[] = [];
  const images: Array<{ x: number; y: number; w: number; h: number }> = [];
  const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
  const rec = (a: AreaNode, ox: number, oy: number) => {
    const n = a as unknown as { x?: number; y?: number; width?: number; height?: number; text?: string; fontSize?: number; color?: string; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
    const x = ox + (n.x ?? 0);
    const y = oy + (n.y ?? 0);
    if (a.type === 'glyph') glyphs.push({ t: n.text ?? '', x, y, w: n.width ?? 0, fs: n.fontSize ?? 0, color: n.color });
    if (a.type === 'image') images.push({ x, y, w: n.width ?? 0, h: n.height ?? 0 });
    if (a.type === 'line') {
      lines.push({ x, y, t: textOf(a).trim() });
    }
    for (const c of childrenOf(a)) rec(c, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0), y + (n.border?.top?.width ?? 0) + (n.padding?.top ?? 0));
  };
  rec(r.areaTree.sheets[0].page as unknown as AreaNode, 0, 0);
  // 本文の行 (字の大きさ 10pt の字を含む行。頭字の箱の中の行を除く)
  const body10 = lines.filter((l) => glyphs.some((g) => Math.abs(g.fs - 10) < 0.01 && Math.abs(g.y - l.y) < 12 && g.x >= l.x - 0.01) && l.t.length > 3);
  const big = glyphs.filter((g) => g.fs > 14);
  return { lines: body10, big, images, warnings: r.warnings.join('\n'), pages: r.areaTree.sheets.length };
}
const near = (a: number, b: number, d = 0.6) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('XSL-FO の axf:initial-letters (ドロップキャップ)', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`3 行の字: 続く 3 行は字の後ろから、4 行目は内容の端から。adjacent はブロックの終わりまで (${compat})`, async () => {
      const r = await lay(`<fo:block xml:lang="en" axf:initial-letters="3">${LOREM}</fo:block>`, compat);
      expect(r.warnings).not.toMatch(/initial-letters/);
      expect(r.big.map((g) => g.t)).toEqual(['L']);
      const L = r.big[0];
      // 字の大きさ: (2 行 + 最初の行の大文字の高さ) ÷ 字の大文字の高さ。書体は同じなので、24 ÷ cap + 10
      expect(L.fs).toBeGreaterThan(40);
      expect(L.fs).toBeLessThan(50);
      near(L.x, 20);
      expect(r.lines.length).toBeGreaterThanOrEqual(4);
      for (const l of r.lines.slice(0, 3)) near(l.x, 20 + L.w);
      near(r.lines[3].x, 20);
      expect(r.lines[0].t.startsWith('orem')).toBe(true);
      const a = await lay(`<fo:block xml:lang="en" axf:initial-letters="3 adjacent">${LOREM}</fo:block>`, compat);
      for (const l of a.lines) near(l.x, 20 + L.w);
      // <integer2>: 字の行の後ろの 1 行も字下げ
      const b = await lay(`<fo:block xml:lang="en" axf:initial-letters="3 3 1">${LOREM} ${LOREM}</fo:block>`, compat);
      expect(b.lines.slice(0, 4).map((l) => Math.round(l.x - L.w))).toEqual([20, 20, 20, 20]);
      near(b.lines[4].x, 20);
    });
    it(`raise: 字の上の 2 行分だけ、最初の行を下げ、2 行目からは内容の端 (${compat})`, async () => {
      const d = await lay(`<fo:block xml:lang="en" axf:initial-letters="3">${LOREM}</fo:block>`, compat);
      const r = await lay(`<fo:block xml:lang="en" axf:initial-letters="3 raise">${LOREM}</fo:block>`, compat);
      near(r.lines[0].y, d.lines[0].y + 24);
      near(r.lines[0].x, 20 + r.big[0].w);
      near(r.lines[1].x, 20);
      near(r.big[0].fs, d.big[0].fs, 0.01);
    });
    it(`字の大きさを長さで書く (12em 2): 字の大きさはその長さ (${compat})`, async () => {
      const r = await lay(`<fo:block xml:lang="en" font-size="5pt" line-height="6pt" axf:initial-letters="12em 2">gazing ${LOREM}</fo:block>`, compat);
      expect(r.big.map((g) => g.t)).toEqual(['g']);
      near(r.big[0].fs, 60, 0.01);
    });
    it(`画像の頭字: 高さは字と同じ範囲 (2 行 + 大文字の高さ)、幅は縦横比から。end-indent の後ろから行を始める (${compat})`, async () => {
      const r = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-end-indent="5pt"><fo:external-graphic src="pic.png" content-width="300pt"/> ${LOREM}</fo:block>`, compat);
      expect(r.images.length).toBe(1);
      const img = r.images[0];
      // 最初の行の大文字の高さの上端から 3 行目の基線まで (2 行 + 大文字の高さ 6〜7pt)。画像の大きさの指定 (content-width) は使わない
      expect(img.h).toBeGreaterThan(24 + 5);
      expect(img.h).toBeLessThan(24 + 8);
      near(img.w, img.h * 2);
      near(img.x, 20);
      for (const l of r.lines.slice(0, 3)) near(l.x, 20 + img.w + 5);
      near(r.lines[3].x, 20);
    });
  }
  it('axf:initial-letters-end-indent は行ごと (最後の値はその後の行にも)。dcem は字の大きさ', async () => {
    const r = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-end-indent="0 5pt">${LOREM}</fo:block>`);
    const w = r.big[0].w;
    expect(r.lines.slice(0, 3).map((l) => Math.round(l.x - 20 - w))).toEqual([0, 5, 5]);
    const d = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-end-indent="-0.1dcem 0">${LOREM}</fo:block>`);
    near(d.lines[0].x, 20 + w - 0.1 * d.big[0].fs);
    near(d.lines[1].x, 20 + w);
  });
  it('text-indent は字の箱をずらす (最初の行の字下げにしない)。dcem は互換モードだけ (仕様モードは知らせて読まない)', async () => {
    const a = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" text-indent="-4pt">${LOREM}</fo:block>`);
    near(a.big[0].x, 16);
    near(a.lines[0].x, 16 + a.big[0].w);
    near(a.lines[3].x, 20);
    const b = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" text-indent="(236 div 2048) * -1dcem">${LOREM}</fo:block>`, 'antenna');
    near(b.big[0].x, 20 - (236 / 2048) * b.big[0].fs);
    const c = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" text-indent="(236 div 2048) * -1dcem">${LOREM}</fo:block>`, 'spec');
    near(c.big[0].x, 20);
    expect(c.warnings).toMatch(/dcem/);
  });
  it('small-caps の小文字が続く字は、最初の行の x-height に合わせる (字が小さくなる)。字の箱は行内の要素の外に置く', async () => {
    const cap = await lay(`<fo:block xml:lang="en" axf:initial-letters="3"><fo:inline>Lorem ipsum</fo:inline> ${LOREM}</fo:block>`);
    const x = await lay(`<fo:block xml:lang="en" axf:initial-letters="3"><fo:inline font-variant="small-caps">Lorem ipsum</fo:inline> ${LOREM}</fo:block>`);
    expect(x.big.map((g) => g.t)).toEqual(['L']);
    expect(x.big[0].fs).toBeLessThan(cap.big[0].fs - 1);
    near(x.lines[0].x, 20 + x.big[0].w);
    // first-line-head-height="cap-height" なら大文字の高さ
    const c = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-first-line-head-height="cap-height"><fo:inline font-variant="small-caps">Lorem ipsum</fo:inline> ${LOREM}</fo:block>`);
    near(c.big[0].fs, cap.big[0].fs, 0.01);
  });
  it('右から左へ書く横組みでは、字を右の端に置き、行は字の左まで', async () => {
    const he = 'הואיל והכרה בכבוד הטבעי אשר לכל בני משפהת האדם ובזכויותיהם השוות והבלתי נפקעות הוא יסוד החופש, הצדק והשלום בעולם.';
    const r = await lay(`<fo:block-container writing-mode="rl-tb"><fo:block xml:lang="he" axf:initial-letters="2">${he} ${he}</fo:block></fo:block-container>`);
    expect(r.big.length).toBe(1);
    const g = r.big[0];
    near(g.x + g.w, 220);
    // 字の横の 2 行は、字の左端までで終わる (行の右端 = 行の左端 + 行の幅 ではなく、字と重ならない)
    expect(Math.max(...r.lines.slice(0, 2).map((l) => l.x))).toBeLessThan(g.x);
  });
  it('約物: hide は描かず、hang は字の箱を行の頭の外へ出す。色 (axf:initial-letters-color)・幅 (axf:initial-letters-width)', async () => {
    const n = await lay(`<fo:block xml:lang="da" axf:initial-letters="3">«Har De seet Oscarshall?» ${LOREM}</fo:block>`);
    expect(n.big.map((g) => g.t)).toEqual(['«', 'H']);
    near(n.big[0].x, 20);
    const h = await lay(`<fo:block xml:lang="da" axf:initial-letters="3" axf:initial-letters-leading-punctuation="hide">«Har De seet Oscarshall?» ${LOREM}</fo:block>`);
    expect(h.big.map((g) => g.t)).toEqual(['H']);
    near(h.big[0].x, 20);
    const g = await lay(`<fo:block xml:lang="da" axf:initial-letters="3" axf:initial-letters-leading-punctuation-position="hang">«Har De seet Oscarshall?» ${LOREM}</fo:block>`);
    near(g.big[1].x, 20);
    near(g.big[0].x, 20 - g.big[0].w);
    const c = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-color="red">${LOREM}</fo:block>`);
    expect(c.big[0].color).toMatch(/^(red|#ff0000|rgb\(255, ?0, ?0\))$/i);
    const w = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-width="50pt" axf:initial-letters-text-align="start">${LOREM}</fo:block>`);
    near(w.big[0].x, 20);
    near(w.lines[0].x, 70);
    const e = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-width="50pt">${LOREM}</fo:block>`);
    near(e.big[0].x + e.big[0].w, 70);
  });
  it('オランダ語の語頭の IJ は 2 字とも頭字', async () => {
    const r = await lay(`<fo:block xml:lang="nl" axf:initial-letters="3">IJzel zorgt voor zeer gevaarlijke omstandigheden op de weg. IJzel zorgt voor zeer gevaarlijke omstandigheden op de weg.</fo:block>`);
    expect(r.big.map((g) => g.t).join('')).toBe('IJ');
    expect(r.lines[0].t.startsWith('zel')).toBe(true);
  });
  it('働かないとき: 中の fo:block に axf:initial-letters がある外のブロック・text-align="center"・normal', async () => {
    const nest = await lay(`<fo:block axf:initial-letters="3"><fo:block xml:lang="en" axf:initial-letters="2">${LOREM}</fo:block></fo:block>`);
    expect(nest.big.length).toBe(1);
    expect(nest.lines.slice(0, 2).every((l) => l.x > 21)).toBe(true);
    near(nest.lines[2].x, 20);
    // 中の fo:block (axf:initial-letters の無いもの) には入る
    const inner = await lay(`<fo:block axf:initial-letters="3"><fo:block xml:lang="en">${LOREM}</fo:block></fo:block>`);
    expect(inner.big.map((g) => g.t)).toEqual(['L']);
    expect((await lay(`<fo:block xml:lang="en" text-align="center" axf:initial-letters="3">${LOREM}</fo:block>`)).big.length).toBe(0);
    expect((await lay(`<fo:block xml:lang="en" axf:initial-letters="normal">${LOREM}</fo:block>`)).big.length).toBe(0);
  });
  it('対応していない値は知らせる', async () => {
    const r = await lay(`<fo:block xml:lang="da" axf:initial-letters="3" axf:initial-letters-leading-punctuation="1em" axf:initial-letters-start-intrusion="first-line">«Har De seet Oscarshall?» ${LOREM}</fo:block>`);
    expect(r.warnings).toMatch(/axf:initial-letters-leading-punctuation="1em"/);
    expect(r.warnings).toMatch(/axf:initial-letters-start-intrusion="first-line"/);
    expect((await lay(`<fo:block axf:initial-letters="0.5">${LOREM}</fo:block>`)).warnings).toMatch(/axf:initial-letters="0.5"/);
  });
  it('縦書き: 字の大きさは 2 行分の字の枠 (行の高さ + 字の大きさ)、幅は axf:initial-letters-width', async () => {
    const t = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';
    const r = await lay(`<fo:block-container writing-mode="tb-rl" height="200pt"><fo:block xml:lang="ja" axf:initial-letters="2" axf:initial-letters-width="2.2ic" axf:initial-letters-text-align="start">${t}</fo:block></fo:block-container>`);
    expect(r.big.map((g) => g.t)).toEqual(['吾']);
    near(r.big[0].fs, 22, 0.01);
  });
});

describe('XSL-FO のドロップキャップの後ろのブロックと、頭字の性質の長さ', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`字の箱の行の数より短いブロックの後ろのブロックも、字の箱の横に字下げする (adjacent・行ごとの空きでも) (${compat})`, async () => {
      for (const v of ['3', '3 adjacent']) {
        const r = await lay(`<fo:block xml:lang="en" axf:initial-letters="${v}">Short one.</fo:block><fo:block>${LOREM}</fo:block>`, compat);
        expect(r.big.map((g) => g.t)).toEqual(['S']);
        const w = r.big[0].w;
        expect(r.lines[0].t).toBe('hort one.');
        // 後ろのブロックの最初の 2 行は字の箱の横、字の箱の下の行は内容の端から (adjacent でも、字の箱の範囲は切らない)
        expect(r.lines.slice(0, 4).map((l) => Math.round(l.x - w))).toEqual([20, 20, 20, Math.round(20 - w)]);
      }
      const e = await lay(`<fo:block xml:lang="en" axf:initial-letters="3 adjacent" axf:initial-letters-end-indent="2pt 4pt 6pt">Short one.</fo:block><fo:block>${LOREM}</fo:block>`, compat);
      const w = e.big[0].w;
      expect(e.lines.slice(0, 3).map((l) => Math.round(l.x - 20 - w))).toEqual([2, 4, 6]);
      near(e.lines[3].x, 20);
    });
    it(`前のブロックとの間に空きのある後ろのブロックは、字下げせずに、字の箱の下へ送る (clear と同じ) (${compat})`, async () => {
      const short = (a: string, b: string) => `<fo:block xml:lang="en" axf:initial-letters="3"${a}>Short one.</fo:block><fo:block${b}>${LOREM}</fo:block>`;
      const clear = await lay(short('', ' clear="start"'), compat);
      near(clear.lines[1].x, 20);
      expect(clear.lines[1].y).toBeGreaterThan(clear.lines[0].y + 30);
      for (const [a, b] of [['', ' space-before="6pt"'], [' space-after="6pt"', ''], [' space-after="6pt"', ' space-before="6pt"']]) {
        const r = await lay(short(a, b), compat);
        near(r.lines[1].x, 20);
        near(r.lines[1].y, clear.lines[1].y);
      }
      const adj = await lay(`<fo:block xml:lang="en" axf:initial-letters="3 adjacent">Short one.</fo:block><fo:block space-before="6pt">${LOREM}</fo:block>`, compat);
      near(adj.lines[1].x, 20);
      near(adj.lines[1].y, clear.lines[1].y);
      // 空きの無い後ろのブロック・字を置いたブロックの中の子のブロックは、空きがあっても字の箱の横
      const inner = await lay(`<fo:block xml:lang="en" axf:initial-letters="3">Short <fo:block space-before="6pt">${LOREM}</fo:block></fo:block>`, compat);
      near(inner.lines[1].x, 20 + inner.big[0].w);
      // 字の箱より長いブロックの後ろのブロックは、もとから字の箱の下 (変わらない)
      const long = await lay(`<fo:block xml:lang="en" axf:initial-letters="3">${LOREM}</fo:block><fo:block space-before="6pt">${LOREM}</fo:block>`, compat);
      near(long.lines[3].x, 20);
      near(long.lines[4].x, 20);
      near(long.lines[4].y - long.lines[3].y, 18);
    });
    it(`頭字の性質の長さの dcem・ic は、どのモードでも読む (${compat})`, async () => {
      const w = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-width="1.2dcem">${LOREM}</fo:block>`, compat);
      expect(w.warnings).not.toMatch(/initial-letters/);
      near(w.lines[0].x, 20 + 1.2 * w.big[0].fs);
      // 字の揃えは end (初期値): 字の箱の後ろの端に字を置く
      near(w.big[0].x + w.big[0].w, 20 + 1.2 * w.big[0].fs);
      const c = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-width="1dcem + 5pt">${LOREM}</fo:block>`, compat);
      expect(c.warnings).not.toMatch(/initial-letters/);
      near(c.lines[0].x, 25 + c.big[0].fs);
      const ei = await lay(`<fo:block xml:lang="en" axf:initial-letters="3" axf:initial-letters-end-indent="1ic">${LOREM}</fo:block>`, compat);
      expect(ei.warnings).not.toMatch(/initial-letters/);
      near(ei.lines[0].x, 30 + ei.big[0].w);
      const len = await lay(`<fo:block xml:lang="en" axf:initial-letters="3ic">${LOREM}</fo:block>`, compat);
      expect(len.warnings).not.toMatch(/initial-letters|単位 ic/);
      near(len.big[0].fs, 30, 0.01);
      // axf:initial-letters の値そのものには dcem を使えない
      expect((await lay(`<fo:block xml:lang="en" axf:initial-letters="3dcem">${LOREM}</fo:block>`, compat)).warnings).toMatch(/axf:initial-letters="3dcem"/);
    });
  }
});
