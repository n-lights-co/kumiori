/**
 * 入力の上限を選択肢で変える (src/limits.ts・TypesetOptions.limits・コマンドの --limit)。
 *  - 既定の値は、前から決め打ちしていた定数と同じ (渡さなければ前と同じに動く)
 *  - 下げると早く当たり、上げると組める。入れ子の深さの上限は上げられない (KumioriOptionError)
 *  - 上限は呼び出しごとの文脈に載るので、同時に走る呼び出しの上限は混ざらない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, KumioriOptionError, createTypesetter, typeset } from '../src/index';
import { DEFAULT_LIMITS, LIMIT_DEFS, LIMIT_NAMES, limits, limitsKey, raisedLimits, resolveLimits } from '../src/limits';
import { runInCall } from '../src/callContext';
import { MAX_PIXELS, WEBFONT_MAX_SFNT_BYTES, fetchLimits, gifPixelBudget, maxPixels } from '../src/imageLimits';
import { MAX_FILE_BYTES } from '../src/assets';
import { COLLECTION_MAX_BYTES } from '../src/fontLoader';
import { MAX_DEPTH, MAX_REFS } from '../src/resources';
import { MAX_IMPORTED_CSS_LENGTH, MAX_IMPORTS } from '../src/htmlPrepare';
import { EPUB_MAX_ENTRY_BYTES } from '../src/imageLimits';
import { encodePngStored } from '../src/pixels';
import { limitList, parseLimit } from '../src/cli';
import { ensureFonts, loadCachedFont } from './helpers';
import type { KumioriPlugin } from '../src/imageFormats';
import { runEps, EpsBudget } from '../src/eps';
import { metafilePixelBudget, metafileSvgBudget } from '../src/imageLimits';
import { readZip } from '../src/epub';
import { makeZip } from './makeZip';
import { drawioToSvg } from '../src/drawio/drawio';
import { nestLimit } from '../src/limits';
import { MAX_TREE_DEPTH } from '../src/htmlPrepare';
import { MAX_FO_NEST, MAX_TABLE_COLUMNS as FO_MAX_TABLE_COLUMNS } from '../src/xslfoImport';
import { MAX_TABLE_COLUMNS as HTML_MAX_TABLE_COLUMNS } from '../src/htmlImport';
import { SVG_MAX_NEST, MAX_EXPANDED_VISITS, MAX_EXPANDED_SEGS, CSS_MAX_MATCHES } from '../src/svg';
import { MAX_MATH_NEST, MAX_MATH_GLYPHS } from '../src/mathLayout';
import { MAX_NESTED_ORIENTATIONS } from '../src/paint';
import { MAX_CSS_NESTING, MAX_NESTED_SELECTORS } from '../src/htmlPaged';
import { ENTITY_MAX_DEPTH, ENTITY_MAX_ADDED, expandInternalEntities } from '../src/xmlParse';
import { BT_MEMO_BUDGET } from '../src/cssSelector';
import { MAX_DIAGNOSTICS_PER_CODE } from '../src/diagnostics';
import { MAX_SPANNED_SLOTS } from '../src/tableLimits';
import { MAX_LEADER_REPEATS } from '../src/inlineLayout';
import { MAX_GRID_REPEAT, gridTracks } from '../src/gridTracks';
import { PNG_IMAGE_CACHE_PIXELS, PNG_LAYER_MAX_PIXELS, PNG_MAX_PIXELS, PNG_PAGE_DECODE_PIXELS, PNG_RASTER_WORK_PER_PIXEL } from '../src/pageRaster';
import { SVG_RASTER_BUDGET, SVG_RASTER_MAX_PIXELS } from '../src/canvasRenderer';
import { BUDGET as SVG_FILTER_BUDGET } from '../src/svgFilterRaster';
import { FLATTEN_MAX_PIXELS } from '../src/pdfFlatten';
import { SVG_MAX_LINKS_PER_PAGE } from '../src/pdfRenderer';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const png = (w: number, h: number) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(200) });
const imageDoc = '<!doctype html><html lang="ja"><body><p>画像</p><img src="a.png"></body></html>';
const imageFiles = () => [{ name: 'a.png', data: png(20, 20) }];
const imageCodes = (ds: ReadonlyArray<{ code: string }>) => ds.map((d) => d.code).filter((c) => c.startsWith('image/'));

describe('上限の表', () => {
  it('既定の値は、前から決め打ちしていた定数と同じ', () => {
    expect(DEFAULT_LIMITS.imagePixels).toBe(MAX_PIXELS);
    expect(DEFAULT_LIMITS.fileBytes).toBe(MAX_FILE_BYTES);
    expect(DEFAULT_LIMITS.fileBytes).toBe(EPUB_MAX_ENTRY_BYTES);
    expect(DEFAULT_LIMITS.fontBytes).toBe(WEBFONT_MAX_SFNT_BYTES);
    expect(DEFAULT_LIMITS.fontCollectionBytes).toBe(COLLECTION_MAX_BYTES);
    expect(DEFAULT_LIMITS.styleRefs).toBe(MAX_REFS);
    expect(DEFAULT_LIMITS.importDepth).toBe(MAX_DEPTH);
    expect(DEFAULT_LIMITS.importedCssChars).toBe(MAX_IMPORTED_CSS_LENGTH);
    expect(DEFAULT_LIMITS.cssImports).toBe(MAX_IMPORTS);
    // 呼び出しの外では既定の値
    expect(limits()).toBe(DEFAULT_LIMITS);
    expect({ ...fetchLimits }).toEqual({ cssBytes: 16 * 1024 * 1024, fontBytes: 128 * 1024 * 1024, imageBytes: 256 * 1024 * 1024, redirects: 20 });
    expect(maxPixels()).toBe(MAX_PIXELS);
    expect(limitsKey()).toBe('');
  });

  it('resolveLimits: 名前ごとに重ね、誤りは KumioriOptionError (option に名前)', () => {
    expect(resolveLimits(undefined)).toBe(DEFAULT_LIMITS);
    const a = resolveLimits({ imagePixels: 1000 });
    expect(a.imagePixels).toBe(1000);
    expect(a.fileBytes).toBe(DEFAULT_LIMITS.fileBytes);
    expect(Object.isFrozen(a)).toBe(true);
    expect(resolveLimits({ cssImports: 5 }, a)).toMatchObject({ imagePixels: 1000, cssImports: 5 });
    expect(limitsKey(a)).toBe('imagePixels=1000');
    // 既定と同じ値は、下げるだけの上限でも受ける
    expect(resolveLimits({ redirects: 20, importDepth: 8 }).redirects).toBe(20);
    const bad = (v: unknown, option: string) => {
      let err: unknown;
      try {
        resolveLimits(v);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(KumioriOptionError);
      expect((err as KumioriOptionError).option).toBe(option);
    };
    bad({ redirects: 21 }, 'limits.redirects');
    bad({ importDepth: 9 }, 'limits.importDepth');
    bad({ imagePixel: 10 }, 'limits.imagePixel');
    bad({ imagePixels: 0 }, 'limits.imagePixels');
    bad({ imagePixels: -1 }, 'limits.imagePixels');
    bad({ imagePixels: 1.5 }, 'limits.imagePixels');
    bad({ imagePixels: Number.NaN }, 'limits.imagePixels');
    bad({ imagePixels: '100' }, 'limits.imagePixels');
    bad({ imagePixels: 2 ** 31 }, 'limits.imagePixels');
    bad({ importedCssChars: 600_000_000 }, 'limits.importedCssChars');
    bad([1], 'limits');
    bad('x', 'limits');
  });

  it('raisedLimits: 既定より上げた上限だけ', () => {
    expect(raisedLimits(DEFAULT_LIMITS)).toEqual([]);
    expect(raisedLimits(resolveLimits({ imagePixels: 2e8, cssImports: 3, imageFetchTotalMs: 5 }))).toEqual([{ name: 'imagePixels', value: 2e8, def: 1e8 }]);
  });

  it('組になった上限も、呼び出しの上限で動く (ファイルの大きさによる縛りは残る)', () => {
    const ctx = { lang: 'ja' as const, limits: resolveLimits({ imagePixels: 5000 }) };
    runInCall(ctx, () => {
      expect(maxPixels()).toBe(5000);
      expect(gifPixelBudget(34)).toBe(5000);
      expect(fetchLimits.imageBytes).toBe(DEFAULT_LIMITS.fileBytes);
    });
    const up = { lang: 'ja' as const, limits: resolveLimits({ imagePixels: 2e8 }) };
    // 上げても、数十バイトの GIF の画素の数は、ファイルの大きさの縛りのまま
    expect(runInCall(up, () => gifPixelBudget(34))).toBe(gifPixelBudget(34));
    expect(runInCall(up, () => gifPixelBudget(1e6))).toBeGreaterThan(gifPixelBudget(1e6));
  });
});

describe('TypesetOptions.limits', () => {
  it('渡さなければ前と同じ。下げると画像が読めず、上げれば limit/raised の知らせが 1 件出る', async () => {
    const base = await typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles() });
    expect(imageCodes(base.diagnostics)).toEqual([]);
    expect(base.diagnostics.some((d) => d.code === 'limit/raised')).toBe(false);
    const low = await typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles(), limits: { imagePixels: 100 } });
    expect(imageCodes(low.diagnostics).length).toBeGreaterThan(0);
    expect(low.diagnostics.some((d) => d.code === 'limit/raised')).toBe(false);
    const high = await typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles(), limits: { imagePixels: 2e8 } });
    expect(imageCodes(high.diagnostics)).toEqual([]);
    const raised = high.diagnostics.filter((d) => d.code === 'limit/raised');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ severity: 'info', args: { limits: 'imagePixels=200000000' } });
    // 出さない診断の名前に書けば出ない
    const quiet = await typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles(), limits: { imagePixels: 2e8 }, diagnostics: { ignore: ['limit/raised'] } });
    expect(quiet.diagnostics.some((d) => d.code === 'limit/raised')).toBe(false);
  });

  it('@import の数を下げると limit/css-import', async () => {
    const files = [
      { name: 'a.css', data: '@import "b.css"; @import "c.css";' },
      { name: 'b.css', data: 'p { color: red }' },
      { name: 'c.css', data: 'p { color: blue }' },
    ];
    const html = '<!doctype html><html lang="ja"><head><link rel="stylesheet" href="a.css"></head><body><p>字</p></body></html>';
    const base = await typeset(html, { loadFont: loadCachedFont, files });
    expect(base.diagnostics.some((d) => d.code === 'limit/css-import')).toBe(false);
    const low = await typeset(html, { loadFont: loadCachedFont, files, limits: { cssImports: 1 } });
    expect(low.diagnostics.some((d) => d.code === 'limit/css-import')).toBe(true);
  });

  it('上げられない上限・知らない名前は KumioriOptionError (組まない)', async () => {
    await expect(typeset('<p>字</p>', { loadFont: loadCachedFont, limits: { redirects: 100 } })).rejects.toMatchObject({ name: 'KumioriOptionError', option: 'limits.redirects' });
    await expect(typeset('<p>字</p>', { loadFont: loadCachedFont, limits: { nope: 1 } as never })).rejects.toBeInstanceOf(KumioriOptionError);
    // 誤りの文は、その呼び出しの言語で書く
    await expect(typeset('<p>字</p>', { loadFont: loadCachedFont, lang: 'en', limits: { redirects: 100 } })).rejects.toThrow(/can only be lowered/);
  });

  it('同時に走る呼び出しの上限は混ざらない', async () => {
    const [low, high] = await Promise.all([
      typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles(), limits: { imagePixels: 100 } }),
      typeset(imageDoc, { loadFont: loadCachedFont, files: imageFiles() }),
    ]);
    expect(imageCodes(low.diagnostics).length).toBeGreaterThan(0);
    expect(imageCodes(high.diagnostics)).toEqual([]);
  });

  it('器: setup.limits が文書ごとの既定になり、文書の limits を名前ごとに重ねる。上限の違う文書を交互に組んでも混ざらない', async () => {
    await expect(createTypesetter({ loadFont: loadCachedFont, limits: { importDepth: 9 } })).rejects.toMatchObject({ option: 'setup.limits.importDepth' });
    const t = await createTypesetter({ loadFont: loadCachedFont, limits: { imagePixels: 100 } });
    for (let i = 0; i < 2; i++) {
      const low = await t.typeset(imageDoc, { files: imageFiles() });
      expect(imageCodes(low.diagnostics).length).toBeGreaterThan(0);
      const ok = await t.typeset(imageDoc, { files: imageFiles(), limits: { imagePixels: 1e6 } });
      expect(imageCodes(ok.diagnostics)).toEqual([]);
      expect(ok.diagnostics.some((d) => d.code === 'limit/raised')).toBe(false);
    }
    // 文書ごとの limits は警告にしない (器と文書の両方に書ける)
    const r = await t.typeset('<p>字</p>', { limits: { cssImports: 3 } });
    expect(r.diagnostics.some((d) => d.code === 'api/setup-option-ignored')).toBe(false);
  });
});

describe('コマンドの --limit・--list-limits', () => {
  it('<名前>=<値>。…Bytes は K・M・G を付けられる', () => {
    expect(parseLimit('imagePixels=200000000')).toEqual({ imagePixels: 200000000 });
    expect(parseLimit('fileBytes=1GB')).toEqual({ fileBytes: 1024 ** 3 });
    expect(parseLimit('cssBytes=64m')).toEqual({ cssBytes: 64 * 1024 ** 2 });
    expect(parseLimit('redirects=3')).toEqual({ redirects: 3 });
    for (const v of ['imagePixels', 'imagePixels=', 'imagePixels=1e8', 'imagePixels=10M', 'nope=1', 'redirects=21', 'importDepth=0', 'fileBytes=1TB'])
      expect(() => parseLimit(v), v).toThrow();
  });

  it('--list-limits は、すべての名前と既定の値を並べる', () => {
    const t = limitList();
    for (const k of LIMIT_NAMES) expect(t).toContain(k);
    expect(t).toContain(String(LIMIT_DEFS.imagePixels.def));
  });
});

describe('画像の形式・EPS・メタファイル・EPUB・draw.io の上限', () => {
  const inCall = <T>(given: Parameters<typeof resolveLimits>[0], fn: () => T): T => runInCall({ lang: 'ja', limits: resolveLimits(given) }, fn);

  it('プラグイン: 文脈に上限を渡し、結果の大きさ (formatSize) と # の違う参照の数 (formatFragments) を上限で確かめる', async () => {
    const seen: Array<number | undefined> = [];
    const box = (w: number): KumioriPlugin => ({
      apiVersion: 1,
      name: 'box',
      imageFormats: [
        {
          name: 'box',
          mime: 'application/x-box',
          extensions: ['box'],
          sniff: (b) => new TextDecoder().decode(b.subarray(0, 4)) === 'BOX ',
          load: async (_b, ctx) => (seen.push(ctx.limits?.formatSize), { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"/>`, width: w, height: 10, warnings: [] }),
        },
      ],
    });
    const files = [{ name: 'a.box', data: 'BOX ' }];
    const big = 2e7;
    const def = await typeset('<p><img src="a.box"></p>', { loadFont: loadCachedFont, files, plugins: [box(big)] });
    expect(def.diagnostics.some((d) => d.code === 'image/invalid-size')).toBe(true);
    const up = await typeset('<p><img src="a.box"></p>', { loadFont: loadCachedFont, files, plugins: [box(big)], limits: { formatSize: 3e7 } });
    expect(up.diagnostics.some((d) => d.code === 'image/invalid-size')).toBe(false);
    expect(seen).toEqual([1e7, 3e7]);
    const html = '<p><img src="a.box#1"><img src="a.box#2"><img src="a.box#3"></p>';
    const few = await typeset(html, { loadFont: loadCachedFont, files, plugins: [box(10)], limits: { formatFragments: 2 } });
    expect(few.diagnostics.some((d) => d.code === 'image/too-many-fragments')).toBe(true);
    const many = await typeset(html, { loadFont: loadCachedFont, files, plugins: [box(10)] });
    expect(many.diagnostics.some((d) => d.code === 'image/too-many-fragments')).toBe(false);
  });

  it('EPS: パスの点 (epsPathPoints)・実行の時限 (epsMs) を呼び出しの上限で読む', () => {
    const eps = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n0 0 moveto 10 0 lineto 10 10 lineto 0 10 lineto closepath fill\nshowpage\n');
    expect(runEps(eps)?.error).toBeUndefined();
    expect(inCall({ epsPathPoints: 2 }, () => runEps(eps))?.error).toMatch(/limitcheck/);
    expect(inCall({ epsMs: 1 }, () => new EpsBudget().millisLeft)).toBe(60_000);
    expect(inCall({ epsDocumentMs: 5 }, () => new EpsBudget().millisLeft)).toBe(5);
  });

  it('メタファイル: 画像の画素の合計の絶対の上限 (metafileImagePixels)。ファイルの大きさの縛りは残る', () => {
    expect(inCall({ metafileImagePixels: 1000 }, () => metafilePixelBudget(1e6))).toBe(1000);
    expect(inCall({ metafileImagePixels: 1e8 }, () => metafilePixelBudget(10))).toBe(metafilePixelBudget(10));
    expect(inCall({ epsSvgChars: 100 }, () => metafileSvgBudget(1e6))).toBe(100);
  });

  it('EPUB: 項目の数 (epubEntries。下げるだけ) と展開の合計 (epubTotalBytes)', () => {
    const zip = makeZip([
      { name: 'a.txt', text: 'あ' },
      { name: 'b.txt', text: 'い' },
      { name: 'c.txt', text: 'う' },
    ]);
    expect(readZip(zip)).toHaveLength(3);
    expect(() => inCall({ epubEntries: 2 }, () => readZip(zip))).toThrow();
    expect(() => resolveLimits({ epubEntries: 70_000 })).toThrow(KumioriOptionError);
  });

  it('draw.io: セルの数 (drawioCells) を下げると、残りのセルを描かずに警告', () => {
    const cells = Array.from({ length: 5 }, (_, i) => `<mxCell id="c${i}" value="v${i}" vertex="1" parent="1"><mxGeometry x="${i * 20}" y="0" width="10" height="10" as="geometry"/></mxCell>`).join('');
    const file = new TextEncoder().encode(`<mxfile><diagram id="d" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`);
    const all = drawioToSvg(file)!;
    expect(all.warnings.some((w) => w.includes('セルが多すぎる'))).toBe(false);
    const few = drawioToSvg(file, { limits: { cells: 3 } })!;
    expect(few.warnings.some((w) => w.includes('セルが多すぎる'))).toBe(true);
    // 上限は、その呼び出しの間だけ (後の呼び出しは既定に戻る)
    expect(drawioToSvg(file)!.warnings.some((w) => w.includes('セルが多すぎる'))).toBe(false);
  });
});

describe('文書の木・CSS・XML・組版・SVG の上限', () => {
  const inCall = <T>(given: Parameters<typeof resolveLimits>[0], fn: () => T): T => runInCall({ lang: 'ja', limits: resolveLimits(given) }, fn);
  const codes = (r: { diagnostics: ReadonlyArray<{ code: string }> }) => r.diagnostics.map((d) => d.code);

  it('既定の値は、前から決め打ちしていた定数と同じ。入れ子の深さは、種類ごとの既定との小さい方', () => {
    expect(DEFAULT_LIMITS.nestingDepth).toBe(Math.max(MAX_TREE_DEPTH, MAX_FO_NEST, SVG_MAX_NEST, MAX_MATH_NEST, MAX_NESTED_ORIENTATIONS));
    expect(DEFAULT_LIMITS.cssNesting).toBe(MAX_CSS_NESTING);
    expect(DEFAULT_LIMITS.entityDepth).toBe(ENTITY_MAX_DEPTH);
    expect(DEFAULT_LIMITS.entityChars).toBe(ENTITY_MAX_ADDED);
    expect(DEFAULT_LIMITS.nestedSelectors).toBe(MAX_NESTED_SELECTORS);
    expect(DEFAULT_LIMITS.selectorWork).toBe(BT_MEMO_BUDGET);
    expect(DEFAULT_LIMITS.diagnosticsPerCode).toBe(MAX_DIAGNOSTICS_PER_CODE);
    expect(DEFAULT_LIMITS.tableColumns).toBe(HTML_MAX_TABLE_COLUMNS);
    expect(DEFAULT_LIMITS.tableColumns).toBe(FO_MAX_TABLE_COLUMNS);
    expect(DEFAULT_LIMITS.tableSpannedCells).toBe(MAX_SPANNED_SLOTS);
    expect(DEFAULT_LIMITS.leaderRepeats).toBe(MAX_LEADER_REPEATS);
    expect(DEFAULT_LIMITS.mathGlyphs).toBe(MAX_MATH_GLYPHS);
    expect(DEFAULT_LIMITS.gridTracks).toBe(MAX_GRID_REPEAT);
    expect(DEFAULT_LIMITS.svgElements).toBe(MAX_EXPANDED_VISITS);
    expect(DEFAULT_LIMITS.svgPathSegments).toBe(MAX_EXPANDED_SEGS);
    expect(DEFAULT_LIMITS.svgCssMatches).toBe(CSS_MAX_MATCHES);
    expect(nestLimit(MAX_TREE_DEPTH)).toBe(MAX_TREE_DEPTH);
    expect(nestLimit(MAX_FO_NEST)).toBe(MAX_FO_NEST);
    expect(inCall({ nestingDepth: 200 }, () => [nestLimit(MAX_TREE_DEPTH), nestLimit(MAX_FO_NEST)])).toEqual([MAX_TREE_DEPTH, 200]);
    expect(() => resolveLimits({ nestingDepth: 301 })).toThrow(KumioriOptionError);
    expect(() => resolveLimits({ cssNesting: 65 })).toThrow(KumioriOptionError);
    expect(() => resolveLimits({ entityDepth: 9 })).toThrow(KumioriOptionError);
  });

  it('HTML の入れ子を下げると limit/nesting-depth。XSL-FO は誤り', async () => {
    const deep = `<!doctype html><html lang="ja"><body>${'<div>'.repeat(12)}字${'</div>'.repeat(12)}</body></html>`;
    expect(codes(await typeset(deep, { loadFont: loadCachedFont }))).not.toContain('limit/nesting-depth');
    expect(codes(await typeset(deep, { loadFont: loadCachedFont, limits: { nestingDepth: 8 } }))).toContain('limit/nesting-depth');
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${'<fo:block>'.repeat(10)}字${'</fo:block>'.repeat(10)}</fo:flow></fo:page-sequence></fo:root>`;
    await expect(typeset(fo, { loadFont: loadCachedFont })).resolves.toBeTruthy();
    await expect(typeset(fo, { loadFont: loadCachedFont, limits: { nestingDepth: 6 } })).rejects.toMatchObject({ code: 'limit/nesting-depth' });
  });

  it('表の列: 下げると早く当たり、上げれば組める', async () => {
    const table = (n: number) => `<!doctype html><html lang="ja"><body><table><colgroup><col span="${n}"><col span="${n}"></colgroup><tr><td>字</td></tr></table></body></html>`;
    expect(codes(await typeset(table(3), { loadFont: loadCachedFont }))).not.toContain('limit/table-columns');
    expect(codes(await typeset(table(3), { loadFont: loadCachedFont, limits: { tableColumns: 4 } }))).toContain('limit/table-columns');
    expect(codes(await typeset(table(600), { loadFont: loadCachedFont }))).toContain('limit/table-columns');
    expect(codes(await typeset(table(600), { loadFont: loadCachedFont, limits: { tableColumns: 1500 } }))).not.toContain('limit/table-columns');
  });

  it('XML の内部実体の入れ子 (entityDepth) を下げると誤り', () => {
    const xml = '<!DOCTYPE r [<!ENTITY a "x"><!ENTITY b "&a;&a;"><!ENTITY c "&b;&b;">]><r>&c;</r>';
    expect(expandInternalEntities(xml)).toContain('xxxx');
    expect(() => inCall({ entityDepth: 2 }, () => expandInternalEntities(xml))).toThrow(/深すぎ/);
  });

  it('同じ名前の診断の数 (diagnosticsPerCode) を下げると、残りを「ほかに n 件」にまとめる', async () => {
    const html = `<!doctype html><html lang="ja"><body>${Array.from({ length: 5 }, (_, i) => `<p style="zz-unknown-${i}: 1">字</p>`).join('')}</body></html>`;
    const all = await typeset(html, { loadFont: loadCachedFont });
    const few = await typeset(html, { loadFont: loadCachedFont, limits: { diagnosticsPerCode: 2 } });
    const unknown = (r: typeof all) => r.diagnostics.filter((d) => d.code === 'css/unknown-property');
    expect(unknown(all).length).toBe(5);
    expect(unknown(few).length).toBe(3);
    expect(unknown(few).some((d) => typeof d.args?.omitted === 'number')).toBe(true);
  });

  it('グリッドの列の数 (gridTracks) は、覚えた計画を上限の違う呼び出しで使い回さない', () => {
    const W = 1000;
    const all = gridTracks('repeat(20, 10px)', W, 0);
    const few = inCall({ gridTracks: 5 }, () => gridTracks('repeat(20, 10px)', W, 0));
    expect(all?.length).toBe(20);
    expect(few?.length).toBe(5);
    expect(gridTracks('repeat(20, 10px)', W, 0)?.length).toBe(20);
  });
});

describe('描く (PNG・画面・PDF) の上限', () => {
  it('既定の値は、前から決め打ちしていた定数と同じ', () => {
    expect(DEFAULT_LIMITS.pngPixels).toBe(PNG_MAX_PIXELS);
    expect(DEFAULT_LIMITS.pngPageImagePixels).toBe(PNG_PAGE_DECODE_PIXELS);
    expect(DEFAULT_LIMITS.pngRasterWork).toBe(PNG_RASTER_WORK_PER_PIXEL);
    expect(DEFAULT_LIMITS.pngLayerPixels).toBe(PNG_LAYER_MAX_PIXELS);
    expect(DEFAULT_LIMITS.canvasSvgPixels).toBe(SVG_RASTER_MAX_PIXELS);
    expect(DEFAULT_LIMITS.canvasSvgWork).toBe(SVG_RASTER_BUDGET);
    expect(DEFAULT_LIMITS.svgFilterWork).toBe(SVG_FILTER_BUDGET);
    expect(DEFAULT_LIMITS.flattenPixels).toBe(FLATTEN_MAX_PIXELS);
    expect(DEFAULT_LIMITS.svgLinksPerPage).toBe(SVG_MAX_LINKS_PER_PAGE);
    // 覚える画像の画素は、渡さなければ imagePixels に連動 (PNG_IMAGE_CACHE_PIXELS と同じ既定)
    expect(PNG_IMAGE_CACHE_PIXELS).toBe(MAX_PIXELS);
    expect(raisedLimits(resolveLimits({ pngImageCachePixels: 5 }))).toEqual([]);
  });

  it('PNG: 1 枚の画素の数 (pngPixels) は、組んだときの上限で確かめる', async () => {
    const html = '<!doctype html><html lang="ja"><body><p>字</p></body></html>';
    const def = await typeset(html, { loadFont: loadCachedFont });
    expect((await def.renderPageToPng(0, { dpi: 72 })).length).toBeGreaterThan(0);
    const low = await typeset(html, { loadFont: loadCachedFont, limits: { pngPixels: 1000 } });
    await expect(low.renderPageToPng(0, { dpi: 72 })).rejects.toThrow(/1,000/);
  });

  it('PDF: 1 ページの SVG のリンクの数 (svgLinksPerPage)', async () => {
    const links = Array.from({ length: 3 }, (_, i) => `<a href="https://example.com/${i}"><rect x="${i * 10}" y="0" width="8" height="8"/></a>`).join('');
    const html = `<!doctype html><html lang="ja"><body><svg xmlns="http://www.w3.org/2000/svg" width="40" height="10">${links}</svg></body></html>`;
    const run = async (limits?: { svgLinksPerPage: number }) => {
      const r = await typeset(html, { loadFont: loadCachedFont, ...(limits ? { limits } : {}) });
      await r.toPdf();
      return r.diagnostics.map((d) => d.code);
    };
    expect(await run()).not.toContain('pdf/svg-links-capped');
    expect(await run({ svgLinksPerPage: 2 })).toContain('pdf/svg-links-capped');
  });
});

describe('説明書', () => {
  it('docs/library.md (日英) の上限の表に、すべての名前が既定の値と並ぶ', () => {
    for (const file of ['docs/library.md', 'docs/en/library.md']) {
      const text = fs.readFileSync(path.resolve(import.meta.dirname, '..', file), 'utf8');
      for (const k of LIMIT_NAMES) expect(text, `${file} の ${k}`).toMatch(new RegExp(`^\\| \`${k}\` \\| [^|]+ \\| [^|]+ \\| .+ \\|$`, 'm'));
    }
  });
});
