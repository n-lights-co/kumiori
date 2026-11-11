/**
 * 既定の用紙 (HTM-26): @page で size を指定していない文書の用紙を、API (pageSize)・CLI (--page-size) から変える。
 *  - 値は CSS の size と同じ書き方 (CSS Paged Media 3 §7.1: <length>{1,2} | auto | [ <page-size> || [ portrait | landscape ] ])
 *  - @media の width・height・orientation は、その用紙で評価する (同 §7.1: Media queries do not honor size: they assume the paper size
 *    that would be chosen if no @page rules were specified)
 *  - 文書の @page { size } があれば、そちらが勝つ
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typeset, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
import { parsePageSize } from '../src/htmlImport';
import { childrenOf, type AreaNode } from '../src/areaTree';
import { UsageError, parseArgs, USAGE_EN, USAGE_JA } from '../src/cli';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const mm = (pt: number) => Math.round(((pt * 25.4) / 72) * 100) / 100;
const sheetMm = (r: Awaited<ReturnType<typeof typeset>>) => r.areaTree.sheets.map((s) => [mm(s.width), mm(s.height)]);

describe('用紙の大きさの値 (CSS Paged Media 3 §7.1 の size)', () => {
  it('用紙の名前・向き・長さを読む', () => {
    expect(parsePageSize('A5')).toEqual({ width: 148, height: 210 });
    expect(parsePageSize('a5 landscape')).toEqual({ width: 210, height: 148 });
    expect(parsePageSize('landscape A5')).toEqual({ width: 210, height: 148 });
    expect(parsePageSize('JIS-B5')).toEqual({ width: 182, height: 257 });
    expect(parsePageSize('letter portrait')).toEqual({ width: 215.9, height: 279.4 });
    const two = parsePageSize('148mm 210mm')!;
    expect([two.width, two.height].map((v) => Math.round(v * 1000) / 1000)).toEqual([148, 210]);
    // 長さ 1 つは正方形。単位は絶対の長さ (in・cm・pt・px・pc・Q)
    const sq = parsePageSize('5in')!;
    expect([sq.width, sq.height].map((v) => Math.round(v * 10) / 10)).toEqual([127, 127]);
    expect(Math.round(parsePageSize('10cm 720pt')!.height * 10) / 10).toBe(254);
    // 向きだけ・auto は、既定の用紙 (A4) に対して
    expect(parsePageSize('landscape')).toEqual({ width: 297, height: 210 });
    expect(parsePageSize('portrait')).toEqual({ width: 210, height: 297 });
    expect(parsePageSize('auto')).toEqual({ width: 210, height: 297 });
  });
  it('読めない値は undefined (負・0・単位なし・相対の単位・知らない名前・余分な語)', () => {
    for (const v of ['', 'A7x', '-10mm 20mm', '0 0', '100 200', '10em 20em', '50% 50%', 'A5 A4', '10mm 20mm 30mm', 'A5 10mm', 'portrait landscape', 'auto A5', '10mm landscape']) expect(parsePageSize(v), v).toBeUndefined();
  });
});

describe('API: pageSize (@page の無い文書の用紙)', () => {
  const body = '<p>本文</p>';
  it('指定が無ければ A4。pageSize で A5・長さ・横置きにできる', async () => {
    expect(sheetMm(await typesetHtml(body, { loadFont }))).toEqual([[210, 297]]);
    expect(sheetMm(await typesetHtml(body, { loadFont, pageSize: 'A5' }))).toEqual([[148, 210]]);
    expect(sheetMm(await typesetHtml(body, { loadFont, pageSize: '148mm 210mm' }))).toEqual([[148, 210]]);
    expect(sheetMm(await typesetHtml(body, { loadFont, pageSize: 'A5 landscape' }))).toEqual([[210, 148]]);
    expect(sheetMm(await typeset(body, { loadFont, pageSize: 'JIS-B5' }))).toEqual([[182, 257]]);
  });
  it('余白は既定のまま (20mm): 本文の幅は、用紙の幅 − 40mm', async () => {
    const r = await typesetHtml('<div style="height: 10pt; background: #000"></div>', { loadFont, pageSize: 'A5', style: 'browser' });
    const body2 = r.areaTree.sheets[0].page.regionBody;
    expect(mm(body2.width)).toBeCloseTo(148 - 40, 1);
    expect(mm(body2.height)).toBeCloseTo(210 - 40, 1);
  });
  it('文書の @page { size } があれば、そちらが勝つ。size の無い @page (余白だけ) は、pageSize の用紙に余白を当てる', async () => {
    expect(sheetMm(await typesetHtml(`<style>@page { size: A6 }</style>${body}`, { loadFont, pageSize: 'A5' }))).toEqual([[105, 148]]);
    const r = await typesetHtml(`<style>@page { margin: 10mm }</style>${body}`, { loadFont, pageSize: 'A5' });
    expect(sheetMm(r)).toEqual([[148, 210]]);
    expect(mm(r.areaTree.sheets[0].page.regionBody.width)).toBeCloseTo(128, 1);
    // 向きだけの size は、pageSize の用紙の向きを変える (§7.1: landscape — the size of the page sheet is chosen by the UA)
    expect(sheetMm(await typesetHtml(`<style>@page { size: landscape }</style>${body}`, { loadFont, pageSize: 'A5' }))).toEqual([[210, 148]]);
    // 名前付きページ・:first の size も、文書の指定が勝つ
    const named = await typesetHtml(`<style>@page wide { size: A4 landscape } .w { page: wide }</style><p>一</p><p class="w">二</p>`, { loadFont, pageSize: 'A5' });
    expect(sheetMm(named)).toEqual([[148, 210], [297, 210]]);
  });
  it('@media の width・height・orientation は、pageSize の用紙で評価する (文書の @page の size では評価しない)', async () => {
    // A5 は幅 148mm (559px)。A4 は 210mm (794px)
    const css = `<style>p { color: #000000 } @media (max-width: 160mm) { p { color: #ff0000 } } @media (orientation: landscape) { p { font-size: 30pt } }</style>`;
    const look = async (o: Parameters<typeof typesetHtml>[1], extra = '') => {
      const r = await typesetHtml(`${css}${extra}<p>字</p>`, { loadFont, ...o });
      let g: GlyphArea | undefined;
      walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (a as GlyphArea).text === '字' && (g ??= a as GlyphArea)));
      return [g!.color, Math.round(g!.fontSize)];
    };
    expect((await look({}))[0]).toBe('#000000');
    expect((await look({ pageSize: 'A5' }))[0]).toBe('#ff0000');
    expect((await look({ pageSize: 'A5 landscape' }))[1]).toBe(30);
    expect((await look({ pageSize: 'A4' }))[1]).not.toBe(30);
    // 文書の @page { size: A4 } があっても、メディアクエリは pageSize (A5) の用紙で評価する
    expect((await look({ pageSize: 'A5' }, '<style>@page { size: A4 }</style>'))[0]).toBe('#ff0000');
    // vw は、組む用紙 (ここでは A5) の領域の幅
  });
  it('既定のスタイル (style) によらず効く。XSL-FO では使わない (用紙は page master)', async () => {
    for (const style of ['kumiori', 'browser', 'ah', 'vivliostyle', 'weasyprint'] as const) expect(sheetMm(await typesetHtml(body, { loadFont, style, pageSize: 'B5' })), style).toEqual([[176, 250]]);
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="120mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    expect(sheetMm(await typesetFo(fo, { loadFont, pageSize: 'A5' }))).toEqual([[100, 120]]);
  });
  it('読めない値は TypeError (選択肢の誤り)', async () => {
    await expect(typesetHtml(body, { loadFont, pageSize: 'A7x' })).rejects.toThrow(TypeError);
    await expect(typesetHtml(body, { loadFont, pageSize: 5 as never })).rejects.toThrow(/pageSize/);
  });
});

describe('CLI: --page-size', () => {
  it('値を読む (カンマ区切りの 2 つの長さも)。読めない値・値なしは使い方の誤り', () => {
    expect(parseArgs(['a.html']).pageSize).toBeUndefined();
    expect(parseArgs(['a.html', '--page-size', 'A5']).pageSize).toBe('A5');
    expect(parseArgs(['a.html', '--page-size', '148mm,210mm']).pageSize).toBe('148mm 210mm');
    expect(parseArgs(['a.html', '--page-size', 'A5 landscape']).pageSize).toBe('A5 landscape');
    expect(parseArgs(['a.html', '--page-size', 'A5,landscape']).pageSize).toBe('A5 landscape');
    expect(() => parseArgs(['a.html', '--page-size', 'A7x'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--page-size'])).toThrow(UsageError);
  });
  it('使い方 (--help) に、日本語・英語とも書いてある', () => {
    expect(USAGE_JA).toContain('--page-size');
    expect(USAGE_EN).toContain('--page-size');
  });
});

describe('--style weasyprint のページの余白 (HTM-28 L)', () => {
  // 字 A までの x の合計 (座標の取り方は同じなので、比べるのは差だけ)
  const firstX = async (html: string, style: 'weasyprint' | 'browser-margin') => {
    const r = await typesetHtml(html, { loadFont, style });
    const go = (a: AreaNode, ox: number): number | undefined => {
      if (a.type === 'glyph' && (a as GlyphArea).text === 'A') return ox + a.x;
      for (const c of childrenOf(a)) {
        const v = go(c, ox + ('x' in a ? a.x : 0));
        if (v !== undefined) return v;
      }
      return undefined;
    };
    return go(r.areaTree.sheets[0], 0)!;
  };
  it('WeasyPrint の既定の余白は 75px (56.25pt。WeasyPrint 65.1 の css/html5_ua.css)。文書の @page の margin が勝つ', async () => {
    const body = '<html><body><p>A</p></body></html>';
    const wp = await firstX(body, 'weasyprint');
    // Kumiori の既定 20mm (56.69pt) より 0.44pt 左
    expect((await firstX(body, 'browser-margin')) - wp).toBeCloseTo((20 * 72) / 25.4 - 56.25, 2);
    const one = '<html><head><style>@page { margin-left: 1cm }</style></head><body><p>A</p></body></html>';
    expect(await firstX(one, 'weasyprint')).toBeCloseTo(await firstX(one, 'browser-margin'), 3);
  });
});
