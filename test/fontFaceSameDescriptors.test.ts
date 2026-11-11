/**
 * 同じ font-family で、記述子の組 (font-weight・font-style・unicode-range) が同じ @font-face を並べたときの書体の選び方 (NC-26)。
 *  - 標準: CSS Fonts 4 §4.4 (記述子の無い font-weight は、選ぶときは normal)・§4.5 と §5.2 (同じ記述子の face は 1 つの組になり、
 *    後に定義したものから字ごとに調べる)
 *  - アンテナハウス互換 (--style ah): font-weight の記述子の無い face は、書体のファイルの太さ (OS/2 の usWeightClass) で登録する
 * 書体は、既定の書体 (.cache/fonts) と、その太さの値を書き換えた写し (テストの中で作る)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FontManager, fontFileStyle } from '../src/fontManager';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, createFontMapping, setupDefaultFonts } from '../src/fontMapping';
import { createTypesetter, walkAreaTree, type GlyphArea } from '../src/index';
import { ensureFonts, extraTestFont, fontDir, fontFileName, loadCachedFont } from './helpers';

const read = (file: string): ArrayBuffer => {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const cached = (name: string) => read(path.join(fontDir, name));

/** 書体 (sfnt) の OS/2 の usWeightClass を書き換えた写し (表の検査合計は直さない。読む側は見ない) */
function withWeightClass(src: ArrayBuffer, weight: number): ArrayBuffer {
  const buf = src.slice(0);
  const v = new DataView(buf);
  for (let i = 0; i < v.getUint16(4); i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3)) === 'OS/2') {
      v.setUint16(v.getUint32(rec + 8) + 4, weight);
      return buf;
    }
  }
  throw new Error('OS/2 の表が無い');
}

beforeAll(async () => {
  await ensureFonts([...FONT_SPECS, ...LATIN_SPECS]);
  await extraTestFont('Lobster-latin.woff2');
}, 300_000);

async function setup() {
  const fonts = new FontManager();
  for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) await fonts.registerBuffer(spec.family, spec.weight ?? 400, cached(fontFileName(spec)), false);
  setupDefaultFonts(fonts);
  const m = createFontMapping(fonts, new FontNameTable(), { canvas: false });
  /** names の並びで、字ごとに選ばれる書体の「PostScript 名@登録の太さ」 */
  const pick = (names: string[], chars: string, weight = 400) => {
    const fam = m.mapHtmlFont(names, weight >= 600);
    return [...chars].map((ch) => {
      const f = fonts.getForChar(fam, weight, ch);
      return `${f.postscriptName}@${f.weight}`;
    });
  };
  return { fonts, m, pick };
}
const file = (name: string, buf: ArrayBuffer | (() => ArrayBuffer)) => ({ name, arrayBuffer: async () => (typeof buf === 'function' ? buf() : buf) });

describe('書体のファイルの太さ・傾きを読む (fontFileStyle)', () => {
  it('OS/2 の usWeightClass と、斜体の印を読む。WOFF2 は sfnt に戻して読む', () => {
    expect(fontFileStyle(cached('NotoSansJP-Regular.ttf'))).toMatchObject({ weight: 400, italic: false, variable: false });
    expect(fontFileStyle(cached('NotoSansJP-Bold.ttf'))).toMatchObject({ weight: 700, italic: false, variable: false });
    expect(fontFileStyle(withWeightClass(cached('Arimo-Regular.ttf'), 900))).toMatchObject({ weight: 900 });
    expect(fontFileStyle(cached('Lobster-latin.woff2'))).toMatchObject({ weight: 400, variable: false });
    // 1〜1000 の外の値・書体でないものは、太さを返さない
    expect(fontFileStyle(withWeightClass(cached('Arimo-Regular.ttf'), 0)).weight).toBeUndefined();
    expect(fontFileStyle(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]).buffer).weight).toBeUndefined();
  });
});

describe('標準: 記述子の組が同じ @font-face は、後に定義したものから字ごとに調べる (CSS Fonts 4 §4.4・§4.5・§5.2)', () => {
  // F: Cousine (欧文・ギリシャ文字)、Arimo (欧文・ギリシャ文字)、Lobster (欧文だけ) の順。どれも font-weight の記述子が無い (選ぶときは 400)
  const css = `@font-face { font-family: F; src: url(c.ttf) }
    @font-face { font-family: F; src: url(a.ttf) }
    @font-face { font-family: F; src: url(l.woff2) }`;
  const files = () => [file('c.ttf', () => cached('Cousine-Regular.ttf')), file('a.ttf', () => cached('Arimo-Regular.ttf')), file('l.woff2', () => cached('Lobster-latin.woff2'))];

  it('後に定義した書体 (Lobster) が持つ字は、その書体。持たない字 (α) は、その前に定義した書体 (Arimo)', async () => {
    const { fonts, m, pick } = await setup();
    await m.loadFontFaces(css, files());
    expect(pick(['F', 'sans-serif'], 'aα')).toEqual(['Lobster-Regular@400', 'Arimo-Regular@400']);
    // 太字の指定でも、3 つとも太さ 400 の face なので、同じ書体 (太らせて描くかどうかは、登録の太さ 400 で決まる)
    expect(pick(['F', 'sans-serif'], 'aα', 700)).toEqual(['Lobster-Regular@400', 'Arimo-Regular@400']);
    // 行の基準などに使う、最初に使える書体 (空白を受け持つ書体) も、後に定義した書体
    expect(fonts.get(m.mapHtmlFont(['F'], false)!.split('+')[0], 400).postscriptName).toBe('Lobster-Regular');
  });

  it('太さの違う face があれば、太さを先に照合する (同じ記述子の組は、その太さの中だけ)', async () => {
    const { m, pick } = await setup();
    // 400 が 2 つ (Cousine → Arimo)、700 が 1 つ (Cousine Bold)
    const css2 = `@font-face { font-family: F; src: url(c.ttf) }
      @font-face { font-family: F; src: url(cb.ttf); font-weight: bold }
      @font-face { font-family: F; src: url(a.ttf); font-weight: 400 }`;
    await m.loadFontFaces(css2, [...files(), file('cb.ttf', () => cached('Cousine-Bold.ttf'))]);
    expect(pick(['F', 'sans-serif'], 'aα', 400)).toEqual(['Arimo-Regular@400', 'Arimo-Regular@400']);
    expect(pick(['F', 'sans-serif'], 'aα', 700)).toEqual(['Cousine-Bold@700', 'Cousine-Bold@700']);
    // 900 は、最も近い 700 (§5.2)。400 の組の後の定義 (Arimo) は使わない
    expect(pick(['F', 'sans-serif'], 'a', 900)).toEqual(['Cousine-Bold@700']);
  });

  it('同じファイルを指す繰り返しと、1 つだけの定義は、今までと同じ (書体そのもの)', async () => {
    const { fonts, m } = await setup();
    await m.loadFontFaces('@font-face { font-family: G; src: url(a.ttf) } @font-face { font-family: G; src: url(a.ttf) }', files());
    const fam = m.mapHtmlFont(['G', 'sans-serif'], false)!;
    expect(fam.startsWith('css:G+')).toBe(true);
    expect(fonts.getForChar(fam, 400, 'a').family).toBe('css:G');
  });

  it('unicode-range の違う face は、別の組 (範囲ごとに、後の定義から)', async () => {
    const { m, pick } = await setup();
    const css3 = `@font-face { font-family: F; src: url(c.ttf); unicode-range: U+61-7A }
      @font-face { font-family: F; src: url(a.ttf); unicode-range: U+61-7A }
      @font-face { font-family: F; src: url(l.woff2); unicode-range: U+41-5A }`;
    await m.loadFontFaces(css3, files());
    expect(pick(['F', 'sans-serif'], 'aA')).toEqual(['Arimo-Regular@400', 'Lobster-Regular@400']);
  });
});

describe('アンテナハウス互換: font-weight の記述子の無い @font-face は、書体のファイルの太さで登録する', () => {
  // 『CSS ページ組版入門』の CSS と同じ形: 同じ名前で、記述子の無い face を 3 つ (Regular・Bold・Heavy)
  const css = `@font-face { font-family: shs; src: url(r.ttf) }
    @font-face { font-family: shs; src: url(b.ttf) }
    @font-face { font-family: shs; src: url(h.ttf) }`;
  const files = () => [file('r.ttf', () => cached('NotoSansJP-Regular.ttf')), file('b.ttf', () => cached('NotoSansJP-Bold.ttf')), file('h.ttf', () => withWeightClass(cached('Arimo-Bold.ttf'), 900))];

  it('太さ 400・700・900 の指定に、Regular・Bold・Heavy のファイルを使う', async () => {
    const { m, pick } = await setup();
    await m.loadFontFaces(css, files(), { ahFaceWeight: true });
    expect(pick(['shs', 'sans-serif'], 'a', 400)).toEqual(['NotoSansJP-Regular@400']);
    expect(pick(['shs', 'sans-serif'], 'a', 700)).toEqual(['NotoSansJP-Bold@700']);
    expect(pick(['shs', 'sans-serif'], 'a', 900)).toEqual(['Arimo-Bold@900']);
    // 600 は、重い方の最も近い 700 (CSS Fonts 4 §5.2)
    expect(pick(['shs', 'sans-serif'], 'a', 600)).toEqual(['NotoSansJP-Bold@700']);
  });

  it('font-weight の記述子があれば、その値 (書体のファイルの太さは見ない)', async () => {
    const { m, pick } = await setup();
    await m.loadFontFaces('@font-face { font-family: shs; src: url(b.ttf); font-weight: 400 } @font-face { font-family: shs; src: url(r.ttf); font-weight: 700 }', files(), { ahFaceWeight: true });
    expect(pick(['shs', 'sans-serif'], 'a', 400)).toEqual(['NotoSansJP-Bold@400']);
    expect(pick(['shs', 'sans-serif'], 'a', 700)).toEqual(['NotoSansJP-Regular@700']);
  });

  it('標準 (互換の指定なし) では、3 つとも太さ 400 の face で、後に定義したものを使う', async () => {
    const { m, pick } = await setup();
    await m.loadFontFaces(css, files());
    expect(pick(['shs', 'sans-serif'], 'a', 400)).toEqual(['Arimo-Bold@400']);
    expect(pick(['shs', 'sans-serif'], 'a', 700)).toEqual(['Arimo-Bold@400']);
    // 後の 2 つに無い字は、最初の定義 (Noto Sans JP Regular)
    expect(pick(['shs', 'sans-serif'], '字', 700)).toEqual(['NotoSansJP-Bold@400']);
  });
});

describe('公開の API: 同じ名前で記述子の無い @font-face を並べた文書', () => {
  const loadFont = async (spec: Parameters<typeof loadCachedFont>[0]) => (await loadCachedFont(spec))!;
  const html = `<!DOCTYPE html><html lang="ja"><head><style>
    @font-face { font-family: shs; src: url(r.ttf) }
    @font-face { font-family: shs; src: url(b.ttf) }
    p { font-family: shs; margin: 0 }</style></head><body><p style="font-weight:400">標</p><p style="font-weight:700">太</p></body></html>`;
  const files = () => [
    { name: 'r.ttf', data: new Uint8Array(cached('NotoSansJP-Regular.ttf')) },
    { name: 'b.ttf', data: new Uint8Array(cached('NotoSansJP-Bold.ttf')) },
  ];
  const glyphs = async (style: 'ah' | 'kumiori') => {
    const t = await createTypesetter({ loadFont });
    const r = await t.typeset(html, { kind: 'html', style, files: files() });
    const got: Record<string, string> = {};
    walkAreaTree(r.areaTree, (a) => {
      if (a.type !== 'glyph' || !/[標太]/.test((a as GlyphArea).text)) return;
      const g = a as GlyphArea;
      got[g.text] = `${g.fontFamily}@${g.fontWeight}${g.fakeBold ? ':太らせる' : ''}`;
    });
    return got;
  };

  it('--style ah: 太字は、太字のファイル (太さ 700) で組み、太らせて描かない', async () => {
    expect(await glyphs('ah')).toEqual({ 標: 'css:shs@400', 太: 'css:shs@700' });
  });

  it('標準: どちらも後に定義した書体 (太さ 400 の face)。太字の指定は、太らせて描く (§4.4: 太らせるかどうかは、記述子の太さで決める)', async () => {
    expect(await glyphs('kumiori')).toEqual({ 標: 'css:shs~2@400', 太: 'css:shs~2@400:太らせる' });
  });
});
