/**
 * PDF のページを図として貼る: 見分け方・ページの選び方 (RFC 8118 の page=、アンテナハウスの範囲と bbox= は互換の指定のときだけ)・
 * 大きさ (CropBox・MediaBox に切り詰め・受け継ぐ箱・/Rotate・UserUnit)・壊れた・暗号化した・上限を超えた PDF の診断
 * (design/pdf-as-image.md の 1 節)。試験の PDF は pdf-lib で作る (pdfImageFixtures.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetStore } from '../src/assets';
import { runInCall } from '../src/callContext';
import type { Diagnostic } from '../src/diagnostics';
import { isPdf, pdfHeaderOffset } from '../src/imageInfo';
import { DEFAULT_FONTS, typeset, typesetToPdf, walkAreaTree } from '../src/index';
import { resolveLimits } from '../src/limits';
import { parsePdfFragment } from '../src/pdfImage';
import { ensureFonts, loadCachedFont } from './helpers';
import { makeDeepPdf, makePdf } from './pdfImageFixtures';

const PX = 96 / 72;

const store = (compat = false) => {
  const ds: Diagnostic[] = [];
  return { ds, assets: new AssetStore({ report: (d) => ds.push(d), pdfCompat: compat }) };
};
const add = (assets: AssetStore, name: string, bytes: Uint8Array) => assets.addBlob(name, new Blob([bytes as BlobPart]));
const codes = (ds: readonly Diagnostic[]) => ds.map((d) => d.code);

describe('PDF の見分け方', () => {
  it('頭 %PDF- を先頭の 1,024 バイトの中で探す', async () => {
    const pdf = await makePdf([{}]);
    expect(pdfHeaderOffset(pdf)).toBe(0);
    expect(isPdf(new TextEncoder().encode('xx%PDF-1.7'))).toBe(true);
    expect(isPdf(new Uint8Array([...new Uint8Array(1100), ...new TextEncoder().encode('%PDF-1.7')]))).toBe(false);
    expect(isPdf(new TextEncoder().encode('<svg/>'))).toBe(false);
  });
});

describe('parsePdfFragment', () => {
  it('page=N はどのモードでも読む。読めない値は 1 ページ目と image/pdf-page', () => {
    expect(parsePdfFragment('page=3', false)).toMatchObject({ page: 3, box: 'CropBox', notes: [] });
    expect(parsePdfFragment('page=0', false)).toMatchObject({ page: 1, notes: [{ code: 'image/pdf-page' }] });
    expect(parsePdfFragment('page=x', true)).toMatchObject({ page: 1, notes: [{ code: 'image/pdf-page' }] });
  });
  it('範囲と bbox= は互換の指定のときだけ。指定の無いときは image/pdf-fragment', () => {
    expect(parsePdfFragment('page=2-3', false)).toMatchObject({ page: 1, notes: [{ code: 'image/pdf-fragment' }] });
    expect(parsePdfFragment('page=2-3', true)).toMatchObject({ page: 2, range: { first: 2, last: 3 }, notes: [] });
    expect(parsePdfFragment('page=2-', true)).toMatchObject({ page: 2, range: { first: 2 } });
    expect(parsePdfFragment('page=ALL', true)).toMatchObject({ page: 1, range: { first: 1 } });
    expect(parsePdfFragment('page=2&bbox=trimbox', true)).toMatchObject({ page: 2, box: 'TrimBox', notes: [] });
    expect(parsePdfFragment('bbox=TrimBox', false)).toMatchObject({ box: 'CropBox', notes: [{ code: 'image/pdf-fragment' }] });
    expect(parsePdfFragment('bbox=Paper', true)).toMatchObject({ box: 'CropBox', notes: [{ code: 'image/pdf-fragment' }] });
  });
  it('表示の仕方の引数・名前の付いた行き先は黙って読まない。知らない引数は image/pdf-fragment', () => {
    expect(parsePdfFragment('page=2&zoom=50&view=Fit&nameddest=x', false)).toMatchObject({ page: 2, notes: [] });
    expect(parsePdfFragment('Chapter6', false)).toMatchObject({ page: 1, notes: [] });
    expect(parsePdfFragment('foo=1', false).notes.map((n) => n.code)).toEqual(['image/pdf-fragment']);
  });
});

describe('PDF の画像の大きさ', () => {
  it('既定は CropBox (MediaBox に切り詰める)。無ければ MediaBox。MediaBox の左下が原点でなくてもよい', async () => {
    const { assets, ds } = store();
    const a = await add(assets, 'a.pdf', await makePdf([{ media: [0, 0, 300, 200], crop: [50, 20, 350, 120] }]));
    expect(a).toMatchObject({ mime: 'application/pdf', drawable: false, pdfSource: { page: 0, box: [50, 20, 300, 120], rotate: 0, userUnit: 1 } });
    expect(a!.width).toBeCloseTo(250 * PX);
    expect(a!.height).toBeCloseTo(100 * PX);
    const b = await add(assets, 'b.pdf', await makePdf([{ media: [100, 100, 400, 250] }]));
    expect(b!.pdfSource!.box).toEqual([100, 100, 400, 250]);
    expect(b!.width).toBeCloseTo(300 * PX);
    expect(ds).toEqual([]);
  });
  it('/Rotate 90 は幅と高さを入れ替える。90 の倍数でない値は 0 と image/pdf-repaired。UserUnit を掛ける', async () => {
    const { assets, ds } = store();
    const a = await add(assets, 'a.pdf', await makePdf([{ media: [0, 0, 300, 200], rotate: -90, userUnit: 2 }]));
    expect(a!.pdfSource).toMatchObject({ rotate: 270, userUnit: 2 });
    expect(a!.width).toBeCloseTo(400 * PX);
    expect(a!.height).toBeCloseTo(600 * PX);
    const b = await add(assets, 'b.pdf', await makePdf([{ rotate: 45 }]));
    expect(b!.pdfSource!.rotate).toBe(0);
    expect(codes(ds)).toEqual(['image/pdf-repaired']);
  });
  it('MediaBox をページの木から受け継ぐ', async () => {
    const { assets } = store();
    const a = await add(assets, 'a.pdf', await makePdf([{ media: [0, 0, 150, 90] }, {}], { inheritMedia: true }));
    expect(a!.pdfSource!.box).toEqual([0, 0, 150, 90]);
  });
  it('fragment の違う参照は、ページごとの画像 (addFragment)。ページの数を超えたら 1 ページ目と image/pdf-page', async () => {
    const { assets, ds } = store();
    await add(assets, 'a.pdf', await makePdf([{ media: [0, 0, 100, 100] }, { media: [0, 0, 300, 100] }]));
    expect(assets.get('a.pdf#page=2')).toBeUndefined();
    const p2 = await assets.addFragment('a.pdf#page=2');
    expect(p2!.pdfSource!.page).toBe(1);
    expect(p2!.width).toBeCloseTo(300 * PX);
    expect(assets.get('a.pdf')!.pdfSource!.page).toBe(0);
    const p9 = await assets.addFragment('a.pdf#page=9');
    expect(p9!.pdfSource!.page).toBe(0);
    expect(codes(ds)).toEqual(['image/pdf-page']);
    expect(ds[0].args).toMatchObject({ src: 'a.pdf#page=9' });
  });
  it('互換の指定: bbox=TrimBox と範囲 (最初のページと image/pdf-page-range)', async () => {
    const { assets, ds } = store(true);
    await add(assets, 'a.pdf', await makePdf([{ media: [0, 0, 300, 200], trim: [10, 10, 110, 60] }, {}, {}]));
    const t = await assets.addFragment('a.pdf#bbox=TrimBox');
    expect(t!.pdfSource!.box).toEqual([10, 10, 110, 60]);
    const r = await assets.addFragment('a.pdf#page=2-3');
    expect(r!.pdfSource!.page).toBe(1);
    expect(codes(ds)).toEqual(['image/pdf-page-range']);
  });
});

describe('data: の URI', () => {
  it('種類の引数 page=N (アンテナハウスの拡張) は互換の指定のときだけ読む。指定の無いときは 1 ページ目と image/pdf-fragment', async () => {
    const pdf = await makePdf([{ media: [0, 0, 100, 100] }, { media: [0, 0, 300, 100] }]);
    const uri = `data:application/pdf;page=2;base64,${Buffer.from(pdf).toString('base64')}`;
    const on = store(true);
    expect((await on.assets.addDataUri(uri))!.pdfSource!.page).toBe(1);
    expect(on.ds).toEqual([]);
    const off = store(false);
    expect((await off.assets.addDataUri(uri))!.pdfSource!.page).toBe(0);
    expect(codes(off.ds)).toEqual(['image/pdf-fragment']);
  });
});

describe('読めない PDF', () => {
  it('暗号化: image/pdf-encrypted と既定の大きさの仮の枠', async () => {
    const { assets, ds } = store();
    const a = await add(assets, 'a.pdf', await makePdf([{}], { encrypt: true }));
    expect(a).toMatchObject({ mime: 'application/pdf', drawable: false });
    expect(a!.pdfSource).toBeUndefined();
    expect(codes(ds)).toEqual(['image/pdf-encrypted']);
    expect(ds[0].args).toEqual({ src: 'a.pdf' });
  });
  it('頭だけの PDF: image/pdf-invalid。頭の前の余分なバイトは image/pdf-repaired', async () => {
    const { assets, ds } = store();
    await add(assets, 'a.pdf', new TextEncoder().encode('%PDF-1.7\n%%EOF\n'));
    expect(codes(ds)).toEqual(['image/pdf-invalid']);
    const good = await makePdf([{}]);
    const junk = new Uint8Array([...new TextEncoder().encode('junk\n'), ...good]);
    const b = await add(assets, 'b.pdf', junk);
    expect(b!.pdfSource).toBeDefined();
    expect(codes(ds)).toEqual(['image/pdf-invalid', 'image/pdf-repaired']);
  });
  it('輪になったページの木は止まる (image/pdf-repaired)。Count の食い違いも知らせる', async () => {
    const { assets, ds } = store();
    const a = await add(assets, 'a.pdf', await makePdf([{}, {}], { cyclePages: true }));
    expect(a!.pdfSource).toBeDefined();
    expect(codes(ds)).toEqual(['image/pdf-repaired']);
    const b = await add(assets, 'b.pdf', await makePdf([{}, {}], { count: 5 }));
    expect(b!.pdfSource).toBeDefined();
    expect(codes(ds)).toEqual(['image/pdf-repaired', 'image/pdf-repaired']);
  });
  it('上限: ページの木の深さ (pdfImageDepth)・ページの数 (pdfImagePages)・オブジェクトの数 (pdfImageObjects)。当たった上限を呼び出しに記録する', async () => {
    const deep = await makeDeepPdf(80);
    const three = await makePdf([{}, {}, {}]);
    for (const [given, bytes] of [[{}, deep], [{ pdfImagePages: 2 }, three], [{ pdfImageObjects: 3 }, three]] as const) {
      const { assets, ds } = store();
      const reached = new Set<string>();
      const a = await runInCall({ lang: 'en', limits: resolveLimits(given), limitsReached: reached }, () => add(assets, 'a.pdf', bytes));
      expect(a!.pdfSource, JSON.stringify(given)).toBeUndefined();
      expect(codes(ds)).toEqual(['image/pdf-invalid']);
      expect(reached.size).toBe(1);
    }
    // 上げれば読める (上限の違う呼び出しで、断った結果を使い回さない)
    const { assets } = store();
    const ok = await runInCall({ lang: 'en', limits: resolveLimits({ pdfImagePages: 3 }) }, () => add(assets, 'a.pdf', three));
    expect(ok!.pdfSource).toBeDefined();
  });
});

describe('文書に貼る', () => {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const loadFont = loadCachedFont;
  const images = (r: { areaTree: Parameters<typeof walkAreaTree>[0] }) => {
    const out: Array<[number, number]> = [];
    walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && out.push([Math.round(a.width), Math.round(a.height)])));
    return out;
  };
  it('PDF を書く間に当たった上限 (pdfImageStreamBytes) は、結果の toPdf でも typesetToPdf と同じく limit/reached に出す', async () => {
    const pdf = await makePdf([{}]);
    const html = '<!doctype html><html lang="ja"><body><p><img src="a.pdf"></p></body></html>';
    const o = { name: 'd.html', files: [{ name: 'a.pdf', data: pdf }], loadFont, limits: { pdfImageStreamBytes: 1 } };
    const reached = (ds: readonly Diagnostic[]) => ds.filter((d) => d.code === 'limit/reached').map((d) => d.args?.limit);
    const r = await typeset(html, o);
    expect(reached(r.diagnostics)).toEqual([]);
    await r.toPdf();
    expect(reached(r.diagnostics)).toEqual(['pdfImageStreamBytes']);
    expect(r.warnings.some((w) => /pdfImageStreamBytes \(1\)/.test(w))).toBe(true);
    // 2 度書いても 1 件
    await r.toPdf();
    expect(reached(r.diagnostics)).toEqual(['pdfImageStreamBytes']);
    const p = await typesetToPdf(html, o);
    expect(reached(p.diagnostics)).toEqual(['pdfImageStreamBytes']);
  });

  it('HTML の img と FO の external-graphic: ページの大きさで組む (見つからない画像の知らせは出ない)', async () => {
    const pdf = await makePdf([{ media: [0, 0, 144, 72] }, { media: [0, 0, 72, 144] }]);
    const html = '<!doctype html><html lang="ja"><body><p><img src="a.pdf"><img src="a.pdf#page=2"></p></body></html>';
    const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: pdf }], loadFont });
    expect(r.diagnostics.map((d) => d.code).filter((c) => c.startsWith('image/'))).toEqual([]);
    expect(images(r)).toEqual([
      [144, 72],
      [72, 144],
    ]);
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="210mm" page-height="297mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:external-graphic src="url(a.pdf#page=2)" content-type="application/pdf"/></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const f = await typeset(fo, { name: 'd.fo', files: [{ name: 'a.pdf', data: pdf }], loadFont });
    expect(f.diagnostics.map((d) => d.code).filter((c) => c.startsWith('image/'))).toEqual([]);
    expect(images(f)).toEqual([[72, 144]]);
  });
});
