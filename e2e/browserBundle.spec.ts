/**
 * ブラウザで単体で動くバンドル (npm run build:browser の dist-browser/kumiori.js) の結合テスト:
 * バンドラーを通さず、ファイルの中身をそのまま <script type="module"> の import で読み、HTML を組んで PDF にできることを確かめる
 * (CDN から読む使い方と同じ)。先に npm run build:browser を実行しておく
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist-browser/', import.meta.url));

/** KUMIORI_E2E_FONT_DIR があれば、Google Fonts の代わりにそのディレクトリのフォントを返す (app.spec.ts と同じ) */
async function routeFonts(page: Page) {
  const dir = process.env.KUMIORI_E2E_FONT_DIR;
  if (!dir) return;
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/') ? (u.includes('buE1') ? 'tinos700.ttf' : 'tinos400.ttf') : u.includes('/arimo/') ? (u.includes('CstsBw') ? 'arimo700.ttf' : 'arimo400.ttf') : u.includes('notoserifjp') ? 'notoserif.ttf' : u.includes('VFPYk75s') ? 'notosans700.ttf' : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
}

test('dist-browser/kumiori.js を import して HTML を組み、PDF を作れる', async ({ page }) => {
  test.skip(!fs.existsSync(path.join(dist, 'kumiori.js')), 'npm run build:browser を先に実行する');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // バンドルとその別ファイル (chunks/) を、開発サーバーを通さずにファイルの中身そのままで返す (CDN と同じ条件)
  await page.route('**/dist-browser/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/dist-browser\//, ''));
    const file = path.join(dist, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
  });
  await routeFonts(page);
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const url = '/dist-browser/kumiori.js';
    const mod = (await import(/* @vite-ignore */ url)) as typeof import('../src/index');
    const html = '<!DOCTYPE html><html><head><title>t</title><style>p { margin: 1em; line-height: 2 }</style></head><body><p>ブラウザで単体の<ruby>組版<rt>くみはん</rt></ruby>。Kumiori です。</p></body></html>';
    const res = await mod.typesetHtml(html, { name: 't.html' });
    const pdf = await res.toPdf();
    return { pages: res.pageCount, warnings: res.warnings, pdfHead: String.fromCharCode(...pdf.slice(0, 5)), pdfLength: pdf.length, defaults: mod.DEFAULT_FONTS.base.length };
  });
  expect(r.pages).toBe(1);
  expect(r.warnings.filter((w) => /未対応|知らない|読めません/.test(w))).toEqual([]);
  expect(r.pdfHead).toBe('%PDF-');
  expect(r.pdfLength).toBeGreaterThan(1000);
  expect(r.defaults).toBe(7);
  expect(errors).toEqual([]);
});
