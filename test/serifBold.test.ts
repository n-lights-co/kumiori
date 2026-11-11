/**
 * 明朝の文の太字 (NC-27 (2)): 和文は、明朝 (Noto Serif JP) の Bold で組む。ゴシック (Noto Sans JP) に替えない。
 * CSS Fonts 4 §5.2 (font-weight の照合は、同じファミリーの中で行う。太い書体が無ければ、その書体から太い字を作る)・XSL 1.1 §7.9.9。
 * Bold が手に入らないとき (太字の枠に Regular と同じ中身のファイル) は、明朝の Regular を太らせて描く (fakeBold)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { DEFAULT_FONTS, typeset, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea, type HtmlDefaults } from '../src/index';
import { createFontLoader } from '../src/nodeFonts';
import { FontManager } from '../src/fontManager';
import { FONT_SPECS, LATIN_SPECS, createFontMapping, setupDefaultFonts } from '../src/fontMapping';
import { ensureFonts, fontDir, fontFileName, loadCachedFont } from './helpers';

const SERIF = 'Noto Serif JP';
const SANS = 'Noto Sans JP';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
});

/** 組んだ結果の字 (字 → 書体のファミリー名・書体の太さ・太らせて描くか) */
const glyphsOf = (r: Awaited<ReturnType<typeof typeset>>) => {
  const out: Array<{ ch: string; family: string; weight: number; fake: boolean }> = [];
  walkAreaTree(r.areaTree, (a) => {
    if (a.type !== 'glyph') return;
    const g = a as GlyphArea;
    out.push({ ch: g.text, family: g.fontFamily, weight: g.fontWeight, fake: !!g.fakeBold });
  });
  return out;
};
const of = (gs: ReturnType<typeof glyphsOf>, ch: string) => gs.find((g) => g.ch === ch)!;

const fo = (body: string, attrs = '') =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" ${attrs}>${body}</fo:flow></fo:page-sequence></fo:root>`;

describe('既定の書体の一覧', () => {
  it('明朝 (Noto Serif JP) の Bold がある (ファイル名は NotoSerifJP-Bold.ttf。Regular の次)', () => {
    const serif = DEFAULT_FONTS.base.filter((s) => s.family === SERIF);
    expect(serif.map((s) => [s.weight ?? 400, fontFileName(s)])).toEqual([
      [400, 'NotoSerifJP-Regular.ttf'],
      [700, 'NotoSerifJP-Bold.ttf'],
    ]);
    expect(serif[1].urls[0]).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\/notoserifjp\/v34\//);
    // 同じ版 (v34) の Regular と対
    expect(serif[0].urls[0]).toMatch(/\/notoserifjp\/v34\//);
  });

  it('取得した Bold は、Regular と同じファミリー名・同じ字の集まりで、太さが 700', () => {
    const open = (name: string) => fontkit.create(new Uint8Array(fs.readFileSync(path.join(fontDir, name)))) as unknown as { familyName: string; numGlyphs: number; characterSet: number[]; 'OS/2': { usWeightClass: number } };
    const r = open('NotoSerifJP-Regular.ttf');
    const b = open('NotoSerifJP-Bold.ttf');
    expect(b.familyName).toBe(r.familyName);
    expect(b['OS/2'].usWeightClass).toBe(700);
    expect(r['OS/2'].usWeightClass).toBe(400);
    expect(b.numGlyphs).toBe(r.numGlyphs);
    expect(b.characterSet.length).toBe(r.characterSet.length);
  });
});

describe('書体の割り当て (mapFont・mapHtmlFont): 明朝系・未指定の太字', () => {
  const setup = async () => {
    const fonts = new FontManager();
    for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) await fonts.registerBuffer(spec.family, spec.weight ?? 400, (await loadCachedFont(spec))!, false);
    setupDefaultFonts(fonts);
    return { fonts, m: createFontMapping(fonts, undefined, { canvas: false }) };
  };
  it('XSL-FO: 和文は Noto Serif JP の Bold、欧文は Tinos の Bold', async () => {
    const { fonts, m } = await setup();
    for (const names of [['serif'], ['明朝'], [], ['Unknown Font']]) {
      const fam = m.mapFont(names, true);
      expect(fam).toBe(SERIF);
      expect(fonts.getForChar(fam, 700, '字')).toMatchObject({ family: SERIF, weight: 700 });
      expect(fonts.getForChar(fam, 700, 'a')).toMatchObject({ family: 'Tinos', weight: 700 });
    }
  });
  it('HTML: 和文は Noto Serif JP の Bold、欧文は Tinos の Bold (欧文の文書でも)', async () => {
    const { fonts, m } = await setup();
    for (const lang of [undefined, 'ja', 'en']) {
      const fam = m.mapHtmlFont(['serif'], true, lang)!;
      expect(fonts.getForChar(fam, 700, '字')).toMatchObject({ family: SERIF, weight: 700 });
      expect(fonts.getForChar(fam, 700, 'a')).toMatchObject({ family: 'Tinos', weight: 700 });
    }
  });
  it('ゴシック系の太字は、これまでどおり Noto Sans JP の Bold', async () => {
    const { fonts, m } = await setup();
    expect(fonts.getForChar(m.mapFont(['sans-serif'], true), 700, '字')).toMatchObject({ family: SANS, weight: 700 });
    expect(fonts.getForChar(m.mapHtmlFont(['sans-serif'], true), 700, '字')).toMatchObject({ family: SANS, weight: 700 });
  });
  it('等幅の太字: 和文は、標準の太さと同じファミリー (HTML はゴシック、XSL-FO は明朝) の Bold', async () => {
    const { fonts, m } = await setup();
    expect(fonts.getForChar(m.mapHtmlFont(['monospace'], true), 700, '字')).toMatchObject({ family: SANS, weight: 700 });
    expect(fonts.getForChar(m.mapHtmlFont(['monospace'], false), 400, '字')).toMatchObject({ family: SANS, weight: 400 });
    expect(fonts.getForChar(m.mapFont(['monospace'], true), 700, '字')).toMatchObject({ family: SERIF, weight: 700 });
    expect(fonts.getForChar(m.mapFont(['monospace'], false), 400, '字')).toMatchObject({ family: SERIF, weight: 400 });
  });
});

describe('HTML: 明朝の文の太字は、明朝の Bold で組む', () => {
  const STYLES: HtmlDefaults[] = ['kumiori', 'browser', 'ah', 'vivliostyle', 'weasyprint'];
  const html = (body: string, css = '') => `<html lang="ja"><head><style>body { font-family: serif; } ${css}</style></head><body>${body}</body></html>`;
  for (const style of STYLES) {
    it(`<b>・<strong>・見出し・font-weight: bold・700 (既定のスタイル ${style})`, async () => {
      const r = await typesetHtml(html('<h1>題</h1><h3>節</h3><p>地<b>太</b><strong>強</strong><span style="font-weight: bold">指</span><span style="font-weight: 700">数</span><b>abc</b></p>'), { loadFont: loadCachedFont, style });
      const gs = glyphsOf(r);
      for (const ch of ['題', '節', '太', '強', '指', '数']) expect(of(gs, ch), ch).toEqual({ ch, family: SERIF, weight: 700, fake: false });
      expect(of(gs, '地')).toEqual({ ch: '地', family: SERIF, weight: 400, fake: false });
      expect(of(gs, 'a')).toMatchObject({ family: 'Tinos', weight: 700, fake: false });
    });
  }
  it('書体の指定の無い文書 (既定のスタイルの body は serif) の見出しも、明朝の Bold', async () => {
    const r = await typesetHtml('<h1>題</h1><h2>節</h2><p>地</p>', { loadFont: loadCachedFont });
    const gs = glyphsOf(r);
    expect(of(gs, '題')).toMatchObject({ family: SERIF, weight: 700, fake: false });
    expect(of(gs, '節')).toMatchObject({ family: SERIF, weight: 700, fake: false });
  });
  it('縦書き・ルビ・圏点も、明朝の Bold', async () => {
    const r = await typesetHtml(html('<p><b>縦<ruby>漢<rt>かん</rt></ruby><span class="em">圏</span></b></p>', 'body { writing-mode: vertical-rl; } .em { text-emphasis: sesame; }'), { loadFont: loadCachedFont });
    const gs = glyphsOf(r);
    for (const ch of ['縦', '漢', '圏']) expect(of(gs, ch), ch).toMatchObject({ family: SERIF, weight: 700, fake: false });
    // ルビの字・圏点も、同じ書体 (明朝) の Bold。ゴシックの字は 1 つも無い
    expect(of(gs, 'か')).toMatchObject({ family: SERIF, weight: 700, fake: false });
    expect(gs.filter((g) => g.family === SANS)).toEqual([]);
  });
  it('太字の中で標準の太さに戻すと、明朝の Regular', async () => {
    const r = await typesetHtml(html('<p><b>太<span style="font-weight: normal">戻</span></b></p>'), { loadFont: loadCachedFont });
    expect(of(glyphsOf(r), '戻')).toEqual({ ch: '戻', family: SERIF, weight: 400, fake: false });
  });
  it('ゴシックの文の太字は、これまでどおりゴシックの Bold。その中の明朝の指定は、明朝の Bold', async () => {
    const r = await typesetHtml(html('<p style="font-family: sans-serif"><b>ゴ<span style="font-family: serif">明</span></b></p>'), { loadFont: loadCachedFont });
    const gs = glyphsOf(r);
    expect(of(gs, 'ゴ')).toMatchObject({ family: SANS, weight: 700 });
    expect(of(gs, '明')).toMatchObject({ family: SERIF, weight: 700, fake: false });
  });
});

describe('XSL-FO: 明朝の文の太字は、明朝の Bold で組む', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`font-weight="bold"・700・bolder (--compat ${compat})`, async () => {
      const r = await typesetFo(
        fo('<fo:block>地<fo:inline font-weight="bold">太</fo:inline><fo:inline font-weight="700">数</fo:inline><fo:inline font-weight="bolder">上</fo:inline><fo:inline font-weight="bold">abc</fo:inline></fo:block>' + '<fo:block font-weight="bold" font-family="serif">塊<fo:inline font-weight="normal">戻</fo:inline></fo:block>'),
        { loadFont: loadCachedFont, compat },
      );
      const gs = glyphsOf(r);
      for (const ch of ['太', '数', '上', '塊']) expect(of(gs, ch), ch).toEqual({ ch, family: SERIF, weight: 700, fake: false });
      expect(of(gs, '地')).toEqual({ ch: '地', family: SERIF, weight: 400, fake: false });
      expect(of(gs, '戻')).toEqual({ ch: '戻', family: SERIF, weight: 400, fake: false });
      expect(of(gs, 'a')).toMatchObject({ family: 'Tinos', weight: 700, fake: false });
    });
  }
  it('縦書きも、明朝の Bold。ゴシックの文の太字は、これまでどおりゴシックの Bold', async () => {
    const v = fo('<fo:block font-weight="bold">縦</fo:block>').replace('<fo:simple-page-master ', '<fo:simple-page-master writing-mode="tb-rl" ');
    expect(of(glyphsOf(await typesetFo(v, { loadFont: loadCachedFont })), '縦')).toMatchObject({ family: SERIF, weight: 700, fake: false });
    const g = await typesetFo(fo('<fo:block font-family="sans-serif">地<fo:inline font-weight="bold">太</fo:inline><fo:inline font-weight="bold" font-family="serif">明</fo:inline></fo:block>'), { loadFont: loadCachedFont });
    expect(of(glyphsOf(g), '太')).toMatchObject({ family: SANS, weight: 700 });
    expect(of(glyphsOf(g), '明')).toMatchObject({ family: SERIF, weight: 700, fake: false });
  });
});

describe('明朝の Bold が手に入らないとき: ゴシックに替えずに、明朝の Regular を太らせる', () => {
  const HTML = '<p style="font-family: serif">地<b>太</b></p>';
  /** 明朝の太字の枠に、明朝の Regular と同じ中身を返す loadFont */
  const sameAsRegular = async (spec: FontSpec) => loadCachedFont(spec.family === SERIF ? DEFAULT_FONTS.base.find((s) => s.family === SERIF && (s.weight ?? 400) === 400)! : spec);

  it('loadFont が、明朝の太字の枠に Regular と同じ中身を返したとき (HTML・XSL-FO)', async () => {
    const h = glyphsOf(await typeset(HTML, { loadFont: sameAsRegular }));
    expect(of(h, '太')).toEqual({ ch: '太', family: SERIF, weight: 400, fake: true });
    expect(of(h, '地')).toEqual({ ch: '地', family: SERIF, weight: 400, fake: false });
    const f = glyphsOf(await typesetFo(fo('<fo:block>地<fo:inline font-weight="bold">太</fo:inline></fo:block>'), { loadFont: sameAsRegular }));
    expect(of(f, '太')).toEqual({ ch: '太', family: SERIF, weight: 400, fake: true });
  });

  it('--font-dir に、NotoSerifJP-Bold.ttf として Regular と同じファイルを置いたとき', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-serifbold-'));
    try {
      for (const spec of DEFAULT_FONTS.base) fs.copyFileSync(path.join(fontDir, spec.family === SERIF ? 'NotoSerifJP-Regular.ttf' : fontFileName(spec)), path.join(dir, fontFileName(spec)));
      // キャッシュもネットワークも使わない (置き場のファイルだけで組めること)
      const loadFont = createFontLoader({ fontDir: dir, cacheDir: null, timeoutMs: 1, log: () => {} });
      const gs = glyphsOf(await typeset(HTML, { loadFont, fetchTimeoutMs: 1 }));
      expect(of(gs, '太')).toEqual({ ch: '太', family: SERIF, weight: 400, fake: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--font-dir に NotoSerifJP-Bold.ttf が無いときは、ほかの既定の書体と同じに、書体のキャッシュから読む', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-serifbold-'));
    try {
      for (const spec of DEFAULT_FONTS.base) if (fontFileName(spec) !== 'NotoSerifJP-Bold.ttf') fs.copyFileSync(path.join(fontDir, fontFileName(spec)), path.join(dir, fontFileName(spec)));
      const loadFont = createFontLoader({ fontDir: dir, cacheDir: fontDir, timeoutMs: 1, log: () => {} });
      const gs = glyphsOf(await typeset(HTML, { loadFont, fetchTimeoutMs: 1 }));
      expect(of(gs, '太')).toEqual({ ch: '太', family: SERIF, weight: 700, fake: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('画面の既定の書体の読み込み (FontManager.registerDefaults)', () => {
  it('渡した順に登録し、太字の枠が標準の太さと同じ中身なら登録しない', async () => {
    const fonts = new FontManager();
    const reg = (await loadCachedFont(FONT_SPECS.find((s) => s.family === SERIF && (s.weight ?? 400) === 400)!))!;
    const list = [];
    for (const spec of FONT_SPECS) list.push({ spec, buf: spec.family === SERIF ? reg.slice(0) : (await loadCachedFont(spec))! });
    await fonts.registerDefaults(list, false);
    expect(fonts.all().map((f) => `${f.family}@${f.weight}`)).toEqual([`${SERIF}@400`, `${SANS}@400`, `${SANS}@700`]);
  });
});
