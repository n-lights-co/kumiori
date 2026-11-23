/**
 * HTM-121 半透明の字の色 (color: rgba(…) など) を、透明度つき (#rrggbbaa) のまま持ち、描くときにその濃さで重ねる (CSS Color 4 §4.1)。
 * 前は白い紙に重ねた不透明の色にしていたので、背景の上の字の色が違った。字の色を使う下線、余白の箱の字も同じ。
 * 色を読む parseColor は #rrggbbaa・#rgba・rgba() の透明度を持つ (前は 8 桁の色を読めずに黒にした)
 */
import { testIccProfile } from './iccTestProfile';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, decodePDFRawStream, type PDFArray, type PDFDict } from 'pdf-lib';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { alphaOf, parseColor, toCss } from '../src/color';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

describe('色の透明度を読む', () => {
  it('#rrggbbaa・#rgba・rgba()', () => {
    expect(parseColor('#ff000080')).toMatchObject({ mode: 'rgb', r: 1, g: 0, b: 0 });
    expect(alphaOf('#ff000080')).toBeCloseTo(128 / 255, 5);
    expect(alphaOf('#f008')).toBeCloseTo(136 / 255, 5);
    expect(alphaOf('rgba(0, 0, 0, 0.25)')).toBe(0.25);
    expect(alphaOf('#ff0000')).toBe(1);
    expect(toCss('#ff000080')).toBe('rgba(255,0,0,0.502)');
    expect(toCss('#ff0000')).toBe('rgb(255,0,0)');
  });
});

describe('半透明の字の色', () => {
  const html = `<!doctype html><html lang="en"><head><style>@page { size: 120mm 60mm; margin: 10mm; @top-left { content: "H"; color: rgba(0, 0, 255, .5) } }
    body { margin: 0 } p { color: rgba(200, 0, 0, .5); text-decoration: underline; margin: 0 }</style></head><body><p>T</p></body></html>`;
  it('字の色は透明度つきのまま (余白の箱の字も)', async () => {
    const r = await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' });
    const colors: Record<string, string> = {};
    const rec = (a: AreaNode) => {
      if (a.type === 'glyph') colors[(a as GlyphArea).text] = (a as GlyphArea).color;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(r.areaTree.sheets[0]);
    expect(colors.T).toBe('#c8000080');
    expect(colors.H).toBe('#0000ff80');
  });
  it('PDF: 字と下線を、不透明度 0.5 の ExtGState (ca) で描く', async () => {
    const r = await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' });
    const doc = await PDFDocument.load(await r.toPdf());
    const page = doc.getPage(0).node;
    const gs = page.Resources()!.lookup(PDFName.of('ExtGState')) as PDFDict;
    const cas = gs.keys().map((k) => ((gs.lookup(k) as PDFDict).lookup(PDFName.of('ca')) as { asNumber(): number } | undefined)?.asNumber());
    expect(cas.some((a) => a !== undefined && Math.abs(a - 128 / 255) < 0.01)).toBe(true);
    const c = page.Contents()!;
    const streams = 'asArray' in c ? (c as PDFArray).asArray().map((x) => doc.context.lookup(x)) : [c];
    const ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
    // 字の色は 200/255 の赤 (白と混ぜていない)
    expect(ops).toMatch(/0\.78\d* 0 0 rg/);
  });
});

// 透明を使える出力 (PDF/X-4 と PDF/X でない出力) では、字とその飾りの色の透明度を、透明度つきのまま (ExtGState の ca) 描く
describe('PDF の出力の半透明の字の色', () => {
  const page = (body: string) =>
    `<!doctype html><html lang="ja"><head><style>@page { size: 120mm 60mm; margin: 10mm } body { margin: 0; font-size: 12pt } p, ul { margin: 0 }</style></head><body>${body}</body></html>`;
  const body = (c: string) =>
    `<p>A<span style="color: ${c}; text-decoration: underline">B</span><span style="color: ${c}; text-decoration: line-through dotted">D</span></p>` +
    `<p><ruby>字<rt style="color: ${c}">じ</rt></ruby><span style="text-emphasis: dot ${c}">圏点</span></p>` +
    `<ul><li style="color: ${c}">項目</li></ul>`;
  /** 1 ページ目の内容の命令と、ページの ExtGState の ca・CA と、警告 */
  const out = async (html: string, version?: 'X-4') => {
    const r = await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' });
    const warnings: string[] = [];
    const bytes = await r.toPdf(version ? { pdfx: { version, warnings, ...(version === 'X-4' ? { profile: cmykProfile() } : {}) } } : {});
    const d = await PDFDocument.load(bytes, { updateMetadata: false });
    const pg = d.getPage(0).node;
    const gs = pg.Resources()!.lookup(PDFName.of('ExtGState')) as PDFDict | undefined;
    const alphas = (gs?.keys() ?? []).flatMap((k) => ['ca', 'CA'].map((n) => ((gs!.lookup(k) as PDFDict).lookup(PDFName.of(n)) as { asNumber(): number } | undefined)?.asNumber() ?? 1)).filter((a) => a < 1);
    const c = pg.Contents()!;
    const streams = 'asArray' in c ? (c as PDFArray).asArray().map((x) => d.context.lookup(x)) : [c];
    const ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
    return { ops, alphas, warnings };
  };
  it('PDF/X-4 と PDF/X でない出力は、透明度つきのまま (ExtGState の ca)', async () => {
    for (const v of ['X-4', undefined] as const) {
      const o = await out(page(body('rgba(255, 0, 0, .5)')), v);
      expect(o.alphas.some((a) => Math.abs(a - 128 / 255) < 0.01)).toBe(true);
    }
  });
});

/** 試験の CMYK の出力機器のプロファイル (iccTestProfile.ts。PDF/X-4 の出力の検査を通すため) */
function cmykProfile(): Uint8Array {
  return testIccProfile();
}
