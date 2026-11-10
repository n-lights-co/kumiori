/**
 * 色つきの字形の書体を、画面 (Canvas) に描く結合テスト。
 *  - 書体をブラウザに登録して fillText する道 (ブラウザが色つきに描く) と、輪郭から描く道 (自前の図形。src/colorGlyphCanvas.ts) で、
 *    色つきの字形が、同じ位置に、同じ色で出る
 *  - 描いた位置は、組版が測った送り (書体の hmtx) のとおり
 * 書体は、既定の欧文の書体 (Tinos) の表を差し替えて、テストの中で組み立てる (test/colorFontBuilder.ts。書体のファイルはリポジトリに入れない)
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { colr0, cpal, withTables } from '../test/colorFontBuilder';
import { routeFontCache } from './fontCache';

const TINOS = 'https://fonts.gstatic.com/s/tinos/v26/buE4poGnedXvwgX8.ttf';

/** KUMIORI_E2E_FONT_DIR があれば、Google Fonts の代わりにそのディレクトリの書体を返す (app.spec.ts と同じ。ここで取るのは Tinos だけ) */
async function routeFonts(page: Page) {
  await routeFontCache(page);
  const dir = process.env.KUMIORI_E2E_FONT_DIR;
  if (!dir) return;
  await page.route('**/fonts.gstatic.com/**', (route) => route.fulfill({ body: fs.readFileSync(path.join(dir, 'tinos400.ttf')), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } }));
}

test('色つきの字形 (COLR) を、fillText の道と輪郭から描く道の両方で、同じ位置・同じ色に描く', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFonts(page);
  // 字形 A を、「H の輪郭を赤で塗る層」1 つの色つきの字形にした書体を組み立てる (Node の側で。ページからは、書体のバイト列を受け取って返す)
  await page.exposeFunction('kumioriBuildColorFont', (base64: string) => {
    const tinos = Buffer.from(base64, 'base64');
    const buffer = tinos.buffer.slice(tinos.byteOffset, tinos.byteOffset + tinos.byteLength) as ArrayBuffer;
    const fk = fontkit.create(new Uint8Array(buffer)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
    const built = withTables(buffer, { COLR: colr0([{ gid: fk.glyphForCodePoint(0x41).id, layers: [[fk.glyphForCodePoint(0x48).id, 0]] }]), CPAL: cpal([[[255, 0, 0, 255]]]) });
    return Buffer.from(built).toString('base64');
  });
  await page.goto('/');
  const r = await page.evaluate(async (tinosUrl) => {
    const toBase64 = (b: ArrayBuffer) => {
      let s = '';
      const u = new Uint8Array(b);
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const tinos = await (await fetch(tinosUrl)).arrayBuffer();
    const b64 = await (window as unknown as { kumioriBuildColorFont(b: string): Promise<string> }).kumioriBuildColorFont(toBase64(tinos));
    const built = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    // 開発サーバーが返すソースを、そのまま読む (画面と同じ部品)
    const src = (p: string) => import(/* @vite-ignore */ p);
    const { FontManager } = (await src('/src/fontManager.ts')) as typeof import('../src/fontManager');
    const { Measurer } = (await src('/src/measurer.ts')) as typeof import('../src/measurer');
    const { LayoutEngine } = (await src('/src/layoutEngine.ts')) as typeof import('../src/layoutEngine');
    const { renderSheetToCanvas } = (await src('/src/canvasRenderer.ts')) as typeof import('../src/canvasRenderer');
    const fonts = new FontManager();
    await fonts.registerBuffer('KumioriColorTest', 400, built, true);
    const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: 'KumioriColorTest' });
    const tree = engine.layout({
      type: 'document',
      sequences: [{ type: 'page-sequence', master: { width: 80, height: 30, bleed: 0, trimMarks: false, margins: { top: 5, right: 5, bottom: 5, left: 5 } }, flow: { type: 'flow', writingMode: 'horizontal-tb', fontSize: 40, children: [{ type: 'block', textAlign: 'start', children: ['AZA'] }] } }],
    } as never);
    // 字の領域の位置 (Sheet の座標。pt) を集める
    const glyphs: Array<{ text: string; x: number; advance: number }> = [];
    const visit = (a: { type: string; x: number; text?: string; advance?: number; children?: unknown[] }, ox: number) => {
      if (a.type === 'glyph') glyphs.push({ text: a.text!, x: ox + a.x, advance: a.advance! });
      for (const c of a.children ?? []) visit(c as never, ox + a.x);
    };
    const sheet = tree.sheets[0];
    visit(sheet.page.regionBody as never, sheet.page.x ?? 0);
    const scale = 4;
    /** 赤い画素 (色つきの層) と黒い画素 (色つきでない字) の、横の範囲 (pt) */
    const inks = (outlines: boolean) => {
      const canvas = document.createElement('canvas');
      renderSheetToCanvas(sheet, canvas, fonts, { scale, devicePixelRatio: 1, glyphOutlines: outlines });
      const ctx = canvas.getContext('2d')!;
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const red: number[] = [];
      const black: number[] = [];
      for (let x = 0; x < width; x++) {
        let r = false;
        let k = false;
        for (let y = 0; y < height; y++) {
          const o = (y * width + x) * 4;
          if (data[o] > 200 && data[o + 1] < 60 && data[o + 2] < 60) r = true;
          else if (data[o] < 60 && data[o + 1] < 60 && data[o + 2] < 60) k = true;
        }
        if (r) red.push(x / scale);
        if (k) black.push(x / scale);
      }
      // 赤い画素の、つながった範囲 (字形 A が 2 つ)
      const runs: Array<[number, number]> = [];
      for (const x of red) {
        const last = runs[runs.length - 1];
        if (last && x - last[1] < 1) last[1] = x;
        else runs.push([x, x]);
      }
      return { runs: runs.filter((run) => run[1] - run[0] > 2), black: black.length ? [black[0], black[black.length - 1]] : [] };
    };
    return { glyphs, text: inks(false), outline: inks(true) };
  }, TINOS);
  expect(errors).toEqual([]);
  expect(r.glyphs.map((g) => g.text)).toEqual(['A', 'Z', 'A']);
  // どちらの道でも、赤い字形が 2 つ (A)、その間に黒い字 (Z)
  for (const ink of [r.text, r.outline]) {
    expect(ink.runs).toHaveLength(2);
    expect(ink.black[0]).toBeGreaterThan(ink.runs[0][1]);
    expect(ink.black[1]).toBeLessThan(ink.runs[1][0]);
  }
  // 2 つの道で、同じ位置 (画素 1 つ分 = 0.25pt + 縁のぼかしの分まで)
  for (const k of [0, 1]) {
    expect(Math.abs(r.text.runs[k][0] - r.outline.runs[k][0])).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.text.runs[k][1] - r.outline.runs[k][1])).toBeLessThanOrEqual(0.5);
  }
  // 2 つ目の A は、1 つ目から「A の送り + Z の送り」だけ右 (組版が測った送りのとおりに描かれている)
  const shift = r.glyphs[2].x - r.glyphs[0].x;
  expect(shift).toBeCloseTo(r.glyphs[0].advance + r.glyphs[1].advance, 6);
  for (const ink of [r.text, r.outline]) expect(Math.abs(ink.runs[1][0] - ink.runs[0][0] - shift)).toBeLessThanOrEqual(0.5);
});
