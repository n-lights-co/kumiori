import { expect, test, type Page } from '@playwright/test';
import { makeZip } from '../test/makeZip';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { routeFontCache } from './fontCache';
import { defaultFontBuffer, ensureFonts, extraTestFont, fontDir } from '../test/helpers';
import { LATIN_SPECS, MONO_SPECS } from '../src/fontMapping';
import { buildCff2Font } from '../test/cff2TestFont';

/**
 * KUMIORI_E2E_FONT_DIR があれば、Google Fonts の代わりにそのディレクトリのフォントを返す (ネットワークの無い環境用)。
 * 無くて KUMIORI_E2E_FONT_CACHE があれば、配信元から取った書体をそこに覚えておく (e2e/fontCache.ts)
 */
async function routeFonts(page: Page) {
  await routeFontCache(page);
  const dir = process.env.KUMIORI_E2E_FONT_DIR;
  if (!dir) return;
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/')
      ? u.includes('buE1')
        ? 'tinos700.ttf'
        : 'tinos400.ttf'
      : u.includes('/arimo/')
        ? u.includes('CstsBw')
          ? 'arimo700.ttf'
          : 'arimo400.ttf'
        : u.includes('notoserifjp')
          ? 'notoserif.ttf'
          : u.includes('notosanssymbols2') && fs.existsSync(path.join(dir, 'notosanssymbols2.ttf'))
            ? 'notosanssymbols2.ttf'
            : u.includes('VFPYk75s')
            ? 'notosans700.ttf'
            : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
}

/** 設定の引き出しを開く (既定のスタイルなどの部品は、引き出しの中にある) */
async function openSettings(page: Page) {
  if (await page.locator('#settings').isHidden()) await page.click('#settingsbtn');
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFonts(page);
  await page.goto('/');
  await page.waitForSelector('html[data-ready="1"]', { timeout: 150_000 });
  return errors;
}

async function downloadPdf(page: Page): Promise<PDFDocument> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  const file = await dl.path();
  return PDFDocument.load(fs.readFileSync(file!));
}

test('標準サンプル: 組版でき、Canvas と PDF のページ数が一致する', async ({ page }) => {
  const errors = await open(page);
  const canvases = await page.locator('#sheets canvas').count();
  expect(canvases).toBeGreaterThan(0);
  expect(await page.locator('#warnings').textContent()).toBe('');
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(canvases);
  expect(errors).toEqual([]);
});

test('XSL-FO の読み込み: 段組・脚注・表・ページ番号の書式・仕様モードの切り替え', async ({ page }) => {
  const errors = await open(page);
  const fo = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/basic.fo'), 'utf8');
  await page.evaluate(async (t) => {
    await (window as unknown as { __kumioriLoadFo: (t: string, n: string) => Promise<void> }).__kumioriLoadFo(t, 'basic.fo');
  }, fo);
  await expect(page.locator('#sheets canvas')).toHaveCount(2);
  // 変換レポートの見出しは、文書の種類 (XSL-FO) に合わせる
  await expect(page.locator('#report summary')).toContainText('XSL-FO 変換レポート: basic.fo');
  // ヘッダーのページ番号はローマ数字
  const header = await page.evaluate(() => {
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { absoluteAreas: unknown[] } }> } } }).__kumiori;
    const texts: string[] = [];
    const walk = (a: { type?: string; text?: string; children?: unknown[] }) => {
      if (a.type === 'glyph' && a.text) texts.push(a.text);
      for (const c of a.children ?? []) walk(c as never);
    };
    for (const a of k.tree.sheets[1].page.absoluteAreas) walk(a as never);
    return texts.join('');
  });
  expect(header).toContain('ii');
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(2);
  // 仕様どおりの既定値に切り替えると、組み直される (文字が大きくなる)
  const size = () =>
    page.evaluate(() => {
      const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> } } }).__kumiori;
      let fs = 0;
      // 本文 (文字サイズの指定が無い「本文です」) の文字の大きさ
      const walk = (a: { type?: string; text?: string; fontSize?: number; children?: unknown[] }) => {
        if (a.type === 'glyph' && a.text === '本' && a.fontSize && !fs) fs = a.fontSize;
        for (const c of a.children ?? []) walk(c as never);
      };
      walk(k.tree.sheets[0].page.regionBody as never);
      return fs;
    });
  const before = await size();
  await openSettings(page);
  // 既定は仕様どおり (12pt)。外すとアンテナハウスに合わせた既定 (10pt) になり、字が小さくなる
  await page.uncheck('#fospec');
  await expect.poll(size).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test('EPUB の読み込み: spine の順に章をつなぎ、章ごとに改ページする', async ({ page }) => {
  const errors = await open(page);
  const xhtml = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../book.css"/></head><body>${body}</body></html>`;
  const epub = makeZip([
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>' },
    {
      name: 'OEBPS/content.opf',
      deflate: true,
      text: `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>見本</dc:title><dc:language>ja</dc:language></metadata>
<manifest><item id="a" href="t/a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="t/b.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    },
    { name: 'OEBPS/book.css', text: '@page { size: A5; margin: 15mm; } h1 { font-size: 16pt; }' },
    { name: 'OEBPS/t/a.xhtml', text: xhtml('<h1>第一章</h1><p>一つ目<a id="n1"/>の章。</p>'), deflate: true },
    { name: 'OEBPS/t/b.xhtml', text: xhtml('<h1>第二章</h1><p>二つ目の章。</p>'), deflate: true },
  ]);
  await page.locator('#fofile').setInputFiles({ name: 'sample.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(epub) });
  await expect(page.locator('#sheets canvas')).toHaveCount(2);
  const texts = await page.evaluate(() => {
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> } } }).__kumiori;
    return k.tree.sheets.map((s) => {
      const out: string[] = [];
      const walk = (a: { type?: string; text?: string; children?: unknown[] }) => {
        if (a.type === 'glyph' && a.text) out.push(a.text);
        for (const c of a.children ?? []) walk(c as never);
      };
      walk(s.page.regionBody as never);
      return out.join('');
    });
  });
  expect(texts[0]).toContain('第一章');
  expect(texts[0]).toContain('一つ目の章。');
  expect(texts[1]).toContain('第二章');
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getSize().width).toBeCloseTo(420, 0);
  expect(errors).toEqual([]);
});

test('設定を変えたら、読み込んだ文書をすぐ組み直す (トンボと塗り足し・既定のスタイル)', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    await (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml('<!DOCTYPE html><h1>見出し</h1><p>本文</p>', 'set.html');
  });
  const bleed = () => page.evaluate(() => (window as unknown as { __kumiori: { tree: { sheets: Array<{ bleed: number }> } } }).__kumiori.tree.sheets[0].bleed);
  await expect.poll(bleed).toBe(0);
  // 印刷: トンボと塗り足しを付けると、組み直して塗り足し (3mm) が付く
  await page.evaluate(() => {
    const el = document.getElementById('foprint') as HTMLInputElement;
    el.checked = true;
    el.dispatchEvent(new Event('change'));
  });
  await expect.poll(bleed).toBeGreaterThan(8);
  await page.evaluate(() => {
    const el = document.getElementById('foprint') as HTMLInputElement;
    el.checked = false;
    el.dispatchEvent(new Event('change'));
  });
  await expect.poll(bleed).toBe(0);
  expect(errors).toEqual([]);
});

test('HTML の本の体裁: 柱・ノンブル・脚注・目次のページ番号・名前付きページ', async ({ page }) => {
  const errors = await open(page);
  const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/book.html'), 'utf8');
  await page.evaluate(async (t) => {
    await (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml(t, 'book.html');
  }, html);
  await expect(page.locator('#sheets canvas')).toHaveCount(4);
  const pages = await page.evaluate(() => {
    type A = { type?: string; text?: string; children?: unknown[] };
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: A; absoluteAreas: A[] } }> } } }).__kumiori;
    const text = (a: A): string => (a.type === 'glyph' ? (a.text ?? '') : '') + (a.children ?? []).map((c) => text(c as A)).join('');
    return k.tree.sheets.map((s) => ({ body: text(s.page.regionBody), margin: s.page.absoluteAreas.map(text).join('|') }));
  });
  // 目次: リーダーと、章の見出しのページ番号
  expect(pages[1].body).toMatch(/組版の基本\.+3/);
  expect(pages[1].body).toMatch(/和文の規則\.+4/);
  // 章の番号 (counter)、脚注
  expect(pages[2].body).toContain('第一章');
  expect(pages[3].body).toContain('第二章');
  expect(pages[2].body).toContain('脚注の本文です。');
  // 先頭ページはノンブルなし。左ページは string(book)、右ページは element(runhead)
  expect(pages[0].margin).not.toContain('/ 4');
  expect(pages[1].margin).toContain('組み織りの本');
  expect(pages[1].margin).toContain('2 / 4');
  expect(pages[2].margin).toContain('柱：本文の章');
  expect(pages[3].margin).toContain('組み織りの本');
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(4);
  expect(errors).toEqual([]);
});

test('HTML の和文組版と段組: 2 段組・段抜き・回り込み・圏点・縦中横・絶対配置', async ({ page }) => {
  const errors = await open(page);
  const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/japanese.html'), 'utf8');
  await page.evaluate(async (t) => {
    await (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml(t, 'japanese.html');
  }, html);
  await expect(page.locator('#sheets canvas')).toHaveCount(1);
  const info = await page.evaluate(() => {
    type A = { type?: string; text?: string; x?: number; y?: number; width?: number; children?: unknown[]; ruby?: unknown[]; base?: unknown[] };
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: A; absoluteAreas: A[] } }> } } }).__kumiori;
    const p = k.tree.sheets[0].page;
    let rubies = 0;
    const kinds = new Set<string>();
    const text = (a: A): string => {
      if (a.type) kinds.add(a.type);
      if (a.type === 'ruby') rubies++;
      return (a.type === 'glyph' ? (a.text ?? '') : '') + [...(a.children ?? []), ...(a.base ?? [])].map((c) => text(c as A)).join('');
    };
    return { body: text(p.regionBody), margin: p.absoluteAreas.map(text).join('|'), rubies, kinds: [...kinds] };
  });
  expect(info.body).toContain('和文組版と段組');
  expect(info.body).toContain('回り込みの囲み');
  expect(info.rubies).toBeGreaterThanOrEqual(5); // 圏点 (字ごとのルビ)
  expect(info.kinds).toContain('tate-chu-yoko');
  expect(info.margin).toContain('全ページに出す');
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(1);
  expect(errors).toEqual([]);
});

for (const engine of ['kumiori', 'browser']) {
  test(`HTML の flex・grid (CSS の解釈: ${engine}): 中央に寄せた表紙、2 列のカード`, async ({ page }) => {
    const errors = await open(page);
    await openSettings(page);
    await page.selectOption('#cssengine', engine);
    const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/layout.html'), 'utf8');
    await page.evaluate(async (t) => {
      await (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml(t, 'layout.html');
    }, html);
    await expect(page.locator('#sheets canvas')).toHaveCount(2);
    const pos = await page.evaluate(() => {
      type A = { type?: string; text?: string; x?: number; y?: number; width?: number; children?: unknown[] };
      const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { width: number; height: number; regionBody: A } }> } } }).__kumiori;
      return k.tree.sheets.map((s) => {
        const glyphs: Record<string, { x: number; y: number }> = {};
        const walk = (a: A, x: number, y: number) => {
          const ax = x + (a.x ?? 0);
          const ay = y + (a.y ?? 0);
          if (a.type === 'glyph' && a.text && !glyphs[a.text]) glyphs[a.text] = { x: ax, y: ay };
          for (const c of a.children ?? []) walk(c as A, ax, ay);
        };
        walk(s.page.regionBody, 0, 0);
        return { w: s.page.width, h: s.page.height, glyphs };
      });
    });
    // 表紙: 題 (組み織りの見本) は用紙の左右の中央・上下の中ほど
    const [cover, body] = pos;
    const g = cover.glyphs;
    const mid = (g['組'].x + g['本'].x) / 2 + 14;
    expect(Math.abs(mid - cover.w / 2)).toBeLessThan(20);
    expect(g['組'].y).toBeGreaterThan(cover.h * 0.3);
    expect(g['組'].y).toBeLessThan(cover.h * 0.6);
    // カード: 一つ目と二つ目は同じ高さに、左右に並ぶ。三つ目は一つ目の下
    const b = body.glyphs;
    expect(Math.abs(b['一'].y - b['二'].y)).toBeLessThan(1);
    expect(b['二'].x - b['一'].x).toBeGreaterThan(100);
    expect(b['三'].y).toBeGreaterThan(b['一'].y + 30);
    expect(Math.abs(b['三'].x - b['一'].x)).toBeLessThan(1);
    expect(errors).toEqual([]);
  });
}

test('HTML の読み込み: @page の用紙・改ページ・リスト・表・ルビ、既定のスタイルの切り替え', async ({ page }) => {
  const errors = await open(page);
  const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/sample.html'), 'utf8');
  await page.evaluate(async (t) => {
    await (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml(t, 'sample.html');
  }, html);
  // break-before: page で 2 ページ
  await expect(page.locator('#sheets canvas')).toHaveCount(2);
  // 変換レポートの見出しは、文書の種類 (HTML) に合わせる (HTML の文書を「XSL-FO 変換レポート」と出さない。HTM-31 の (6))
  await expect(page.locator('#report summary')).toContainText('HTML 変換レポート: sample.html');
  await expect(page.locator('#report summary')).not.toContainText('XSL-FO');
  const info = () =>
    page.evaluate(() => {
      const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> } } }).__kumiori;
      const texts: string[] = [];
      let size = 0;
      const walk = (a: { type?: string; text?: string; fontSize?: number; children?: unknown[] }) => {
        if (a.type === 'glyph' && a.text) {
          texts.push(a.text);
          if (a.text === 'ブ') size = size || a.fontSize!;
        }
        for (const c of [...(a.children ?? []), ...((a as { base?: unknown[] }).base ?? []), ...((a as { ruby?: unknown[] }).ruby ?? [])]) walk(c as never);
      };
      walk(k.tree.sheets[0].page.regionBody as never);
      return { text: texts.join(''), size };
    });
  const kumiori = await info();
  expect(kumiori.text).toContain('第一章');
  expect(kumiori.text).toContain('•'); // 箇条書きの記号
  expect(kumiori.text).toContain('1.'); // 番号
  expect(kumiori.text).toContain('わぶん'); // ルビ
  expect(kumiori.size).toBeCloseTo(10, 1); // 本の組版向けの既定は 10pt
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(2);
  // @page { size: A5 }
  const { width, height } = pdf.getPage(0).getSize();
  expect([Math.round(width), Math.round(height)]).toEqual([420, 595]);
  // ブラウザの既定に切り替えると組み直される (16px = 12pt)
  await openSettings(page);
  await page.selectOption('#htmlstyle', 'browser');
  await expect.poll(async () => (await info()).size).toBeCloseTo(12, 1);
  // body の余白を残す既定では、本文が 8px (6pt) 内側に入る
  const firstX = () =>
    page.evaluate(() => {
      const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: { children: Array<{ x: number; children?: Array<{ x: number }> }> } } }> } } }).__kumiori;
      const b = k.tree.sheets[0].page.regionBody.children[0];
      return b.x + (b.children?.[0]?.x ?? 0);
    });
  const x0 = await firstX();
  await openSettings(page);
  await page.selectOption('#htmlstyle', 'browser-margin');
  await expect.poll(async () => (await firstX()) - x0).toBeCloseTo(6, 1);
  // CSS の解釈を自前のカスケード (試験) にしても、同じように組める (字の大きさ・ページ数)
  await openSettings(page);
  await page.selectOption('#htmlstyle', 'kumiori');
  await openSettings(page);
  await page.selectOption('#cssengine', 'kumiori');
  await expect.poll(async () => (await info()).size).toBeCloseTo(10, 1);
  await expect(page.locator('#sheets canvas')).toHaveCount(2);
  expect((await info()).text).toContain('わぶん');
  expect(errors).toEqual([]);
});

test('画面: ファイルをドラッグ&ドロップして開き、左の一覧に縮小画像が並ぶ。設定は引き出しに入っている', async ({ page }) => {
  const errors = await open(page);
  // 設定の部品は、引き出しを開くまで見えない
  await expect(page.locator('#htmlstyle')).toBeHidden();
  await page.click('#settingsbtn');
  await expect(page.locator('#htmlstyle')).toBeVisible();
  await page.click('#settingsbtn');
  await expect(page.locator('#settings')).toBeHidden();
  // HTML と CSS を画面にドラッグ&ドロップする
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['<!doctype html><link rel="stylesheet" href="s.css"><h1>ドロップした文書</h1><p class="b">二ページ目</p>'], 'dropped.html', { type: 'text/html' }));
    dt.items.add(new File(['@page { size: A6 } .b { break-before: page }'], 's.css', { type: 'text/css' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  });
  await expect(page.locator('#status')).toContainText('dropped.html');
  await expect(page.locator('#sheets canvas')).toHaveCount(2);
  await expect(page.locator('#thumbs canvas')).toHaveCount(2);
  await expect(page.locator('#dropzone')).toBeHidden();
  expect(errors).toEqual([]);
});

test('画面: 読み込みの警告を左の欄に出す (落としたリンク・未対応と知らない CSS・深すぎる入れ子)。多ければ畳む', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#warnings')).toBeEmpty();
  const drop = (html: string, name: string) =>
    page.evaluate(
      ([h, n]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([h], n, { type: 'text/html' }));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
      },
      [html, name],
    );
  // 警告が少ない (3 件まで) ときは、開いた形で出す。帯の状態の欄にも件数が出る
  await drop('<!doctype html><p><a href="javascript:alert(1)">危ないリンク</a></p>', 'link.html');
  await expect(page.locator('#status')).toContainText('link.html');
  await expect(page.locator('#status')).toContainText('警告 1 件');
  await expect(page.locator('#warnings summary')).toHaveText('⚠ 警告 1 件');
  await expect(page.locator('#warnings details')).toHaveAttribute('open', '');
  await expect(page.locator('#warnings li')).toHaveCount(1);
  await expect(page.locator('#warnings li')).toBeVisible();
  await expect(page.locator('#warnings li')).toContainText('javascript:');
  // 多いときは畳む (見出しに件数。開けば読める)
  const deep = '<div>'.repeat(300) + '<p>深い</p>' + '</div>'.repeat(300);
  await drop(`<!doctype html><style>p { image-rendering: pixelated; colr: red }</style><p><a href="javascript:alert(1)">危ないリンク</a></p>${deep}`, 'many.html');
  await expect(page.locator('#status')).toContainText('many.html');
  await expect(page.locator('#status')).toContainText('警告 4 件');
  await expect(page.locator('#warnings summary')).toHaveText('⚠ 警告 4 件');
  await expect(page.locator('#warnings details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#warnings li').first()).toBeHidden();
  await page.click('#warnings summary');
  await expect(page.locator('#warnings li')).toHaveCount(4);
  await expect(page.locator('#warnings li').first()).toBeVisible();
  const text = (await page.locator('#warnings').textContent()) ?? '';
  expect(text).toContain('javascript:');
  expect(text).toContain('未対応の CSS を無視しました: image-rendering');
  expect(text).toContain('知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr');
  expect(text).toContain('入れ子が深すぎます');
  // 警告の無い文書を開けば、欄は空に戻る
  await drop('<!doctype html><p>警告の無い文書</p>', 'clean.html');
  await expect(page.locator('#status')).toContainText('clean.html');
  await expect(page.locator('#warnings')).toBeEmpty();
  await expect(page.locator('#status')).not.toContainText('警告');
  expect(errors).toEqual([]);
});

test('画面: 既定の用紙 (@page で size を指定していない HTML の用紙) を、設定の引き出しで選ぶ', async ({ page }) => {
  const errors = await open(page);
  const load = (html: string, name: string) => page.evaluate(([h, n]) => (window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml(h, n), [html, name]);
  const caption = page.locator('#sheets figcaption').first();
  await load('<!doctype html><p>用紙を指定していない文書</p>', 'nosize.html');
  await expect(caption).toContainText('仕上がり 210×297mm');
  await openSettings(page);
  // 選ぶと、すぐ組み直す
  await page.selectOption('#pagesize', 'A5');
  await expect(caption).toContainText('仕上がり 148×210mm');
  await page.selectOption('#pagesize', 'JIS-B5');
  await expect(caption).toContainText('仕上がり 182×257mm');
  // 自由入力: CSS の size の書き方 (用紙の名前と向き、幅と高さ)
  await expect(page.locator('#pagesizecustom')).toBeHidden();
  await page.selectOption('#pagesize', 'custom');
  await expect(page.locator('#pagesizecustom')).toBeVisible();
  await page.fill('#pagesizecustom', 'A5 landscape');
  await page.locator('#pagesizecustom').press('Enter');
  await expect(caption).toContainText('仕上がり 210×148mm');
  await page.fill('#pagesizecustom', '100mm,150mm');
  await page.locator('#pagesizecustom').press('Enter');
  await expect(caption).toContainText('仕上がり 100×150mm');
  // 読めない値は、欄に印を付けて知らせ、組み直さない
  await page.fill('#pagesizecustom', 'でたらめ');
  await page.locator('#pagesizecustom').press('Enter');
  await expect(page.locator('#pagesizecustom')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#status')).toContainText('読めません');
  await expect(caption).toContainText('仕上がり 100×150mm');
  // @page で size を指定した文書の用紙は変わらない
  await page.selectOption('#pagesize', 'A5');
  await load('<!doctype html><style>@page { size: A6 }</style><p>用紙を指定した文書</p>', 'sized.html');
  await expect(caption).toContainText('仕上がり 105×148mm');
  expect(errors).toEqual([]);
});

test('公開 API: typeset した結果を renderPage で canvas に描く (書体はブラウザに登録しない)', async ({ page }) => {
  const errors = await open(page);
  const info = await page.evaluate(async () => {
    // 開発サーバーが配る公開 API (src/index.ts) を、ページの中で読み込む
    const entry = '/src/index.ts';
    const k = (await import(/* @vite-ignore */ entry)) as typeof import('../src/index');
    const html = '<!doctype html><html lang="ja"><body><h1>印刷プレビュー</h1><p>吾輩は猫である。名前はまだ無い。</p><p style="break-before: page">二ページ目</p></body></html>';
    const r = await k.typeset(html, { kind: 'html', files: [{ name: 'p.css', data: '@page { size: A6; margin: 10mm } body { font-family: serif }' }] });
    const canvas = document.createElement('canvas');
    canvas.id = 'api-preview';
    document.body.append(canvas);
    r.renderPage(canvas, 0, { scale: 2, devicePixelRatio: 1 });
    // 字の部分 (濃い画素) が描かれているか
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
    let bad = '';
    try {
      r.renderPage(canvas, 5);
    } catch (e) {
      bad = (e as Error).name;
    }
    return { pages: r.pageCount, w: canvas.width, h: canvas.height, sheetW: r.areaTree.sheets[0].width, dark, bad };
  });
  expect(info.pages).toBe(2);
  expect(info.w).toBe(Math.ceil(info.sheetW * 2));
  expect(info.dark).toBeGreaterThan(500);
  expect(info.bad).toBe('RangeError');
  await page.locator('#api-preview').screenshot({ path: test.info().outputPath('api-preview.png') });
  expect(errors).toEqual([]);
});

test('公開 API: CSS のグラデーションの背景を renderPage で canvas に描く (線形・放射・繰り返し・複数の層・background-clip)', async ({ page }) => {
  const errors = await open(page);
  const px = await page.evaluate(async () => {
    const entry = '/src/index.ts';
    const k = (await import(/* @vite-ignore */ entry)) as typeof import('../src/index');
    // 箱はどれも幅 200pt・高さ 20pt。上から 30pt ごとに並べる (用紙の端から 20pt 離す)
    const boxes = [
      'background: linear-gradient(to right, #f00, #00f)',
      'background: radial-gradient(circle closest-side, #fff, #000)',
      'background: repeating-linear-gradient(to right, #f00 0 20pt, #00f 20pt 40pt)',
      'background: linear-gradient(to right, #f00 50%, transparent 50%), linear-gradient(#00f, #00f)',
      'box-sizing: border-box; padding: 0 50pt; background: linear-gradient(to right, #f00, #f00); background-clip: content-box',
    ];
    const html = `<!doctype html><html><head><style>@page { size: 240pt 200pt; margin: 20pt } body { margin: 0 } div { width: 200pt; height: 20pt; margin-bottom: 10pt }</style></head><body>${boxes.map((b) => `<div style="${b}"></div>`).join('')}</body></html>`;
    const r = await k.typeset(html, { kind: 'html' });
    const canvas = document.createElement('canvas');
    r.renderPage(canvas, 0, { scale: 2, devicePixelRatio: 1 });
    const ctx = canvas.getContext('2d')!;
    /** n 番目の箱の、左から x (pt) の所の、高さの中央の色 */
    const at = (n: number, x: number) => Array.from(ctx.getImageData(Math.round((20 + x) * 2), Math.round((20 + 30 * n + 10) * 2), 1, 1).data.slice(0, 3));
    return { linear: [at(0, 10), at(0, 100), at(0, 190)], radial: [at(1, 100), at(1, 91), at(1, 50)], repeat: [at(2, 10), at(2, 30), at(2, 50), at(2, 190)], layers: [at(3, 50), at(3, 150)], clip: [at(4, 25), at(4, 100), at(4, 175)] };
  });
  const near = (got: number[], want: number[], tol = 8) => got.forEach((v, i) => expect(Math.abs(v - want[i]), `${got} ≈ ${want}`).toBeLessThanOrEqual(tol));
  // 線形 (CSS Images 3 §3.1): 左から 5%・50%・95% の色
  near(px.linear[0], [242, 0, 13]);
  near(px.linear[1], [128, 0, 128]);
  near(px.linear[2], [13, 0, 242]);
  // 放射 (§3.2): closest-side の円の半径は 10pt (高さの半分)。中心は白、半径の 9 割の所はほぼ黒、その外は最後の色
  near(px.radial[0], [255, 255, 255], 16);
  near(px.radial[1], [26, 26, 26], 16);
  near(px.radial[2], [0, 0, 0]);
  // 繰り返し (§3.5): 40pt ごとに赤・青
  near(px.repeat[0], [255, 0, 0]);
  near(px.repeat[1], [0, 0, 255]);
  near(px.repeat[2], [255, 0, 0]);
  near(px.repeat[3], [0, 0, 255]);
  // 複数の層 (CSS Backgrounds 3 §2.1): 手前の層の透明な所に、後ろの層が見える
  near(px.layers[0], [255, 0, 0]);
  near(px.layers[1], [0, 0, 255]);
  // background-clip: content-box (§2.7): padding の所には描かない
  near(px.clip[0], [255, 255, 255]);
  near(px.clip[1], [255, 0, 0]);
  near(px.clip[2], [255, 255, 255]);
  expect(errors).toEqual([]);
});

test('可変フォント: 太さ・幅の実体を、測った幅のまま canvas に描く (実体を静的な書体としてブラウザに登録する)', async ({ page }) => {
  const errors = await open(page);
  // 可変フォント (Anybody。幅と太さの 2 軸) は、テストの書体の置き場から (test/helpers.ts の EXTRA_TEST_FONTS)
  const font = fs.readFileSync(await extraTestFont('Anybody-wdth-wght-5bb2873.ttf')).toString('base64');
  await page.evaluate((b64) => {
    const html =
      '<!doctype html><html lang="en"><head><style>@page { size: A6; margin: 10mm } @font-face { font-family: Any; src: url(any.ttf); font-weight: 100 900; font-stretch: 50% 150% } p { font-family: Any; font-size: 18pt; margin: 0 }</style></head>' +
      '<body><p>Hamburg</p><p><b>Hamburg</b></p><p style="font-stretch: 75%">Hamburg</p></body></html>';
    const dt = new DataTransfer();
    dt.items.add(new File([html], 'variable.html', { type: 'text/html' }));
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'any.ttf', { type: 'font/ttf' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, font);
  await expect(page.locator('#status')).toContainText('variable.html');
  await expect(page.locator('#sheets canvas')).toHaveCount(1);
  const info = await page.evaluate(() => {
    type Lf = { key: string; family: string; weight: number; unitsPerEm: number; face?: FontFace; cssFamily?: string; instanceOf?: { coords: Record<string, number> }; fk: { layout(t: string, f: object): { glyphs: Array<{ advanceWidth: number }> } } };
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> }; fonts: { all(): Lf[]; cssFont(f: Lf, px: number): string } } }).__kumiori;
    const glyphs: Array<{ text: string; fontFamily: string; fontWeight: number; fakeBold?: boolean; scaleX: number }> = [];
    const walk = (a: { type?: string; children?: unknown[] }) => {
      if (a.type === 'glyph') glyphs.push(a as never);
      for (const c of a.children ?? []) walk(c as never);
    };
    walk(k.tree.sheets[0].page.regionBody as never);
    const hs = glyphs.filter((g) => g.text === 'H').map((g) => ({ family: g.fontFamily, weight: g.fontWeight, fakeBold: !!g.fakeBold, scaleX: g.scaleX }));
    // 実体ごとに、ブラウザに登録した書体で測った幅 (描く幅) と、fontkit の実体で測った幅 (組んだ幅) を比べる。
    // 字の大きさは 1000px (Measurer が Canvas で測るときの大きさと同じ): 字の送りを整数の画素に丸める環境 (下の説明) でも、丸めが幅に比べて小さくなる。
    // master は、可変フォントの既定の形 (太さ 100・幅 100) を fontkit で測った幅 (実体が既定の形のまま描かれていないかを見分ける)
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fontKerning = 'none';
    const PX = 1000;
    const laidOf = (f: Lf) => (f.fk.layout('Hamburg', { kern: false, liga: false, clig: false }).glyphs.reduce((a, g) => a + g.advanceWidth, 0) / f.unitsPerEm) * PX;
    const master = laidOf(k.fonts.all().find((f) => !f.instanceOf && f.family === 'css:Any')!);
    const instances = k.fonts
      .all()
      .filter((f) => f.instanceOf)
      .map((f) => {
        ctx.font = k.fonts.cssFont(f, PX);
        const drawn = ctx.measureText('Hamburg').width;
        return { coords: f.instanceOf!.coords, registered: !!f.face && f.face.status === 'loaded' && !!f.cssFamily, drawn, laid: laidOf(f) };
      });
    // 字が描かれているか (濃い画素)
    const canvas = document.querySelector('#sheets canvas') as HTMLCanvasElement;
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
    return { hs, instances, dark, master };
  });
  // 太字は本物の太字 (擬似太字にしない)。幅は軸の値 (字形を拡縮しない)
  expect(info.hs).toEqual([
    { family: 'css:Any', weight: 400, fakeBold: false, scaleX: 1 },
    { family: 'css:Any', weight: 700, fakeBold: false, scaleX: 1 },
    { family: 'css:Any{;wdth=75}', weight: 400, fakeBold: false, scaleX: 1 },
  ]);
  expect(info.instances.map((i) => i.coords)).toEqual([
    { wdth: 100, wght: 400 },
    { wdth: 100, wght: 700 },
    { wdth: 75, wght: 400 },
  ]);
  // 描く幅 (ブラウザに登録した実体) と、組んだ幅 (fontkit の実体) が合う。許す差は、字の数 × 0.5px:
  // Chromium は、書体のヒンティングが medium・full の環境 (Linux の fontconfig の設定で決まる。GitHub Actions の ubuntu がそう。
  // 起動の指定 --font-render-hinting=full で再現できる) では、字の送りを字ごとに整数の画素に丸める (subpixel positioning を使わない) ので、
  // 字ごとに最大 0.5px ずれる。可変フォントでない書体 (Arimo など) でも同じだけずれる、ブラウザの側の丸め。
  // Kumiori は、字 (字の単位) ごとに、組んだ位置を指定して描く (canvasRenderer.ts の drawGlyph) ので、この丸めは字の位置に積もらない。
  // ヒンティングの無い環境では、差は 0.01px より小さい
  const tolerance = [...'Hamburg'].length * 0.5 + 0.01;
  for (const i of info.instances) {
    expect(i.registered).toBe(true);
    expect(Math.abs(i.drawn - i.laid)).toBeLessThan(tolerance);
    // 既定の形 (太さ 100・幅 100) のまま描かれてはいない: 既定の形の幅とは、丸めの幅よりずっと大きく違う
    expect(Math.abs(i.drawn - info.master)).toBeGreaterThan(20 * tolerance);
  }
  // 3 つの実体は、描く幅が互いに違う (丸めの幅より大きく)
  const widths = info.instances.map((i) => i.drawn).sort((a, b) => a - b);
  expect(widths[1] - widths[0]).toBeGreaterThan(20 * tolerance);
  expect(widths[2] - widths[1]).toBeGreaterThan(20 * tolerance);
  expect(info.dark).toBeGreaterThan(500);
  // PDF には、実体ごとに静的な書体が埋まる
  const pdf = await downloadPdf(page);
  const names: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0')) names.push(String(obj.get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, ''));
  }
  expect(names.filter((n) => n.startsWith('Anybody')).sort()).toEqual(['Anybody_400wght', 'Anybody_700wght', 'Anybody_75wdth_400wght']);
  await page.locator('#sheets canvas').first().screenshot({ path: test.info().outputPath('variable.png') });
  expect(errors).toEqual([]);
});

test('斜体の @font-face: 斜体の字を斜体の書体で、測った幅のまま canvas に描く (傾けて描かない)', async ({ page }) => {
  const errors = await open(page);
  // 立体は Arimo、斜体は Cousine (どちらも既定の欧文の書体のファイル。斜体の書体のファイルの代わりに、字の送りの違う書体を斜体の face に使う)
  await ensureFonts([...LATIN_SPECS, ...MONO_SPECS]);
  const b64 = (name: string) => fs.readFileSync(path.join(fontDir, name)).toString('base64');
  await page.evaluate(
    ([regular, italic]) => {
      const html =
        '<!doctype html><html lang="en"><head><style>@page { size: A6; margin: 10mm } @font-face { font-family: F; src: url(r.ttf) } @font-face { font-family: F; src: url(i.ttf); font-style: italic } p { font-family: F; font-size: 18pt; margin: 0 }</style></head>' +
        '<body><p>Hamburg</p><p><em>Hamburg</em></p></body></html>';
      const dt = new DataTransfer();
      const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      dt.items.add(new File([html], 'italic.html', { type: 'text/html' }));
      dt.items.add(new File([bytes(regular)], 'r.ttf', { type: 'font/ttf' }));
      dt.items.add(new File([bytes(italic)], 'i.ttf', { type: 'font/ttf' }));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
    },
    [b64('Arimo-Regular.ttf'), b64('Cousine-Regular.ttf')],
  );
  await expect(page.locator('#status')).toContainText('italic.html');
  await expect(page.locator('#sheets canvas')).toHaveCount(1);
  const info = await page.evaluate(() => {
    type Lf = { key: string; family: string; weight: number; unitsPerEm: number; style?: string; face?: FontFace; fk: { layout(t: string, f: object): { glyphs: Array<{ advanceWidth: number }> } } };
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> }; fonts: { all(): Lf[]; get(family: string, weight: number): Lf; cssFont(f: Lf, px: number): string } } }).__kumiori;
    const glyphs: Array<{ text: string; fontFamily: string; fontWeight: number; italic?: boolean }> = [];
    const walk = (a: { type?: string; children?: unknown[] }) => {
      if (a.type === 'glyph') glyphs.push(a as never);
      for (const c of a.children ?? []) walk(c as never);
    };
    walk(k.tree.sheets[0].page.regionBody as never);
    const hs = glyphs.filter((g) => g.text === 'H').map((g) => ({ family: g.fontFamily, weight: g.fontWeight, slant: !!g.italic }));
    // ブラウザに登録した書体で測った幅 (描く幅) と、fontkit で測った幅 (組んだ幅)
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fontKerning = 'none';
    const PX = 1000;
    const faces = hs.map((h) => {
      const f = k.fonts.get(h.family, h.weight);
      ctx.font = k.fonts.cssFont(f, PX);
      const laid = (f.fk.layout('Hamburg', { kern: false, liga: false, clig: false }).glyphs.reduce((a, g) => a + g.advanceWidth, 0) / f.unitsPerEm) * PX;
      return { style: f.style ?? 'normal', registered: !!f.face && f.face.status === 'loaded', drawn: ctx.measureText('Hamburg').width, laid };
    });
    return { hs, faces };
  });
  // 斜体の字は、斜体の face (名前の後ろに、その書体を指す印) で組み、傾けて描く印は付かない
  expect(info.hs).toEqual([
    { family: 'css:F', weight: 400, slant: false },
    { family: 'css:F{ital=1}', weight: 400, slant: false },
  ]);
  expect(info.faces.map((f) => f.style)).toEqual(['normal', 'italic']);
  // 描く幅 (ブラウザに登録した書体) と、組んだ幅 (fontkit) が合う (許す差は、可変フォントのテストと同じ: 字の数 × 0.5px)。
  // 斜体の face は、立体の書体 (Arimo) とは違う書体 (Cousine) の幅で描かれる
  const tolerance = [...'Hamburg'].length * 0.5 + 0.01;
  for (const f of info.faces) {
    expect(f.registered).toBe(true);
    expect(Math.abs(f.drawn - f.laid)).toBeLessThan(tolerance);
  }
  expect(Math.abs(info.faces[0].drawn - info.faces[1].drawn)).toBeGreaterThan(20 * tolerance);
  // PDF には、立体と斜体の 2 つの書体が埋まる
  const pdf = await downloadPdf(page);
  const names: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0')) names.push(String(obj.get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, ''));
  }
  expect(names).toContain('Arimo-Regular');
  expect(names).toContain('Cousine-Regular');
  expect(errors).toEqual([]);
});

test('@font-face: 前に開いた文書の書体が、同じ font-family の名前の次の文書に残らない (HTM-32 の (4))', async ({ page }) => {
  const errors = await open(page);
  const b64 = async (name: string) => Buffer.from(await defaultFontBuffer(name)).toString('base64');
  // 1 つ目の文書: F = 等幅の書体 (Cousine。どの字も 0.6em)。標準の太さと太字の face
  // 2 つ目の文書: 同じ名前 F で、別の書体 (Arimo。W は広く、i は狭い)。太字の face は無い
  const mono = await b64('Cousine-Regular.ttf');
  const monoBold = await b64('Cousine-Bold.ttf');
  const sans = await b64('Arimo-Regular.ttf');
  const drop = (name: string, html: string, fontFiles: Array<[string, string]>) =>
    page.evaluate(
      ([n, h, fs2]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([h as string], n as string, { type: 'text/html' }));
        for (const [fname, data] of fs2 as Array<[string, string]>) dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], fname, { type: 'font/ttf' }));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
      },
      [name, html, fontFiles] as const,
    );
  const doc = (faces: string) =>
    `<!doctype html><html lang="en"><head><style>@page { size: A6; margin: 10mm } ${faces} p { font-family: F; font-size: 20pt; margin: 0 }</style></head><body><p>Wi</p><p><b>Wi</b></p></body></html>`;
  /** 字ごとの [字, 幅 (pt), 太らせて描くか] (1 行目が標準の太さ、2 行目が太字) */
  const glyphs = () =>
    page.evaluate(() => {
      const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> } } }).__kumiori;
      const out: Array<[string, number, boolean]> = [];
      const walk = (a: { type?: string; text?: string; width?: number; fakeBold?: boolean; children?: unknown[] }) => {
        if (a.type === 'glyph') out.push([a.text ?? '', Math.round((a.width ?? 0) * 100) / 100, !!a.fakeBold]);
        for (const c of a.children ?? []) walk(c as never);
      };
      walk(k.tree.sheets[0].page.regionBody as never);
      return out;
    });
  await drop('first.html', doc('@font-face { font-family: F; src: url(a.ttf) } @font-face { font-family: F; src: url(abold.ttf); font-weight: 700 }'), [['a.ttf', mono], ['abold.ttf', monoBold]]);
  await expect(page.locator('#status')).toContainText('first.html');
  const first = await glyphs();
  // 等幅: W も i も 12pt (0.6em)。太字は太字の face (太らせて描かない)
  expect(first.map((g) => g[1])).toEqual([12, 12, 12, 12]);
  expect(first.map((g) => g[2])).toEqual([false, false, false, false]);
  await drop('second.html', doc('@font-face { font-family: F; src: url(b.ttf) }'), [['b.ttf', sans]]);
  await expect(page.locator('#status')).toContainText('second.html');
  const second = await glyphs();
  // 2 つ目の文書の書体 (Arimo) で組む: W は i より広い (前の文書の等幅の書体が残っていれば、どちらも 12pt)
  expect(second[0][1]).toBeGreaterThan(16);
  expect(second[1][1]).toBeLessThan(6);
  // 太字の face はこの文書に無いので、この文書の標準の太さの書体を太らせて描く (前の文書の太字の face を使わない)
  expect(second[2][1]).toBeCloseTo(second[0][1], 1);
  expect(second[3][1]).toBeCloseTo(second[1][1], 1);
  expect(second.slice(2).map((g) => g[2])).toEqual([true, true]);
  // ブラウザに登録した書体 (Canvas が描くのに使う) も、この文書の 1 つだけ (前の文書の同じ名前の書体・太字の書体が残っていない)
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'css:F').map((f) => f.weight));
  expect(faces).toEqual(['400']);
  // 1 つ目の文書に戻しても、1 つ目の書体で組む
  await drop('first.html', doc('@font-face { font-family: F; src: url(a.ttf) } @font-face { font-family: F; src: url(abold.ttf); font-weight: 700 }'), [['a.ttf', mono], ['abold.ttf', monoBold]]);
  await expect(page.locator('#status')).toContainText('first.html');
  expect(await glyphs()).toEqual(first);
  expect(errors).toEqual([]);
});

test('CFF2 の可変フォント: 既定の形も含めて、静的な CFF にした実体を、測った幅のまま canvas に描く', async ({ page }) => {
  const errors = await open(page);
  // 輪郭が CFF2 の可変フォント (太さと幅の 2 軸。字は A・B・C・D) は、テストの中でバイト列を組む (test/cff2TestFont.ts)
  const font = Buffer.from(buildCff2Font()).toString('base64');
  await page.evaluate((b64) => {
    const html =
      '<!doctype html><html lang="en"><head><style>@page { size: A6; margin: 10mm } @font-face { font-family: K; src: url(k.otf); font-weight: 100 900; font-stretch: 50% 200% } p { font-family: K; font-size: 18pt; margin: 0 }</style></head>' +
      '<body><p>ABCD</p><p><b>ABCD</b></p><p style="font-stretch: 200%">ABCD</p></body></html>';
    const dt = new DataTransfer();
    dt.items.add(new File([html], 'cff2.html', { type: 'text/html' }));
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'k.otf', { type: 'font/otf' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, font);
  await expect(page.locator('#status')).toContainText('cff2.html');
  await expect(page.locator('#sheets canvas')).toHaveCount(1);
  const info = await page.evaluate(() => {
    type Lf = { key: string; family: string; weight: number; unitsPerEm: number; buffer: ArrayBuffer; face?: FontFace; cssFamily?: string; instanceOf?: { coords: Record<string, number> }; fk: { layout(t: string, f: object): { glyphs: Array<{ advanceWidth: number }> } } };
    const k = (window as unknown as { __kumiori: { tree: { sheets: Array<{ page: { regionBody: unknown } }> }; fonts: { all(): Lf[]; cssFont(f: Lf, px: number): string } } }).__kumiori;
    const glyphs: Array<{ text: string; fontFamily: string; fontWeight: number; fakeBold?: boolean; scaleX: number }> = [];
    const walk = (a: { type?: string; children?: unknown[] }) => {
      if (a.type === 'glyph') glyphs.push(a as never);
      for (const c of a.children ?? []) walk(c as never);
    };
    walk(k.tree.sheets[0].page.regionBody as never);
    const as = glyphs.filter((g) => g.text === 'A').map((g) => ({ family: g.fontFamily, weight: g.fontWeight, fakeBold: !!g.fakeBold, scaleX: g.scaleX }));
    // 実体ごとに、ブラウザに登録した書体で測った幅 (描く幅) と、fontkit の実体で測った幅 (組んだ幅) を比べる (字の大きさは 1000px。上の可変フォントのテストと同じ)
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fontKerning = 'none';
    const PX = 1000;
    const instances = k.fonts
      .all()
      .filter((f) => f.instanceOf)
      .map((f) => {
        ctx.font = k.fonts.cssFont(f, PX);
        const head = new DataView(f.buffer);
        return {
          coords: f.instanceOf!.coords,
          registered: !!f.face && f.face.status === 'loaded' && !!f.cssFamily,
          drawn: ctx.measureText('ABCD').width,
          laid: (f.fk.layout('ABCD', { kern: false, liga: false, clig: false }).glyphs.reduce((a, g) => a + g.advanceWidth, 0) / f.unitsPerEm) * PX,
          // 実体のファイルは OpenType の CFF ('OTTO')
          otto: head.getUint32(0) === 0x4f54544f,
        };
      });
    const canvas = document.querySelector('#sheets canvas') as HTMLCanvasElement;
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
    return { as, instances, dark };
  });
  expect(info.as).toEqual([
    { family: 'css:K', weight: 400, fakeBold: false, scaleX: 1 },
    { family: 'css:K', weight: 700, fakeBold: false, scaleX: 1 },
    { family: 'css:K{;wdth=200}', weight: 400, fakeBold: false, scaleX: 1 },
  ]);
  // 既定の形 (太さ 400・幅 100) も実体になる (CFF2 のままでは PDF に埋め込めない)
  expect(info.instances.map((i) => i.coords)).toEqual([
    { wght: 400, wdth: 100 },
    { wght: 700, wdth: 100 },
    { wght: 400, wdth: 200 },
  ]);
  // 組んだ幅は、書体の送り (A 500・B 600・C 600・D 600) に HVAR の差分を当てた値: 既定 2300、太さ 700 は A +48・B +12、幅 200% は A +200
  expect(info.instances.map((i) => i.laid)).toEqual([2300, 2360, 2500]);
  // 描く幅と組んだ幅が合う。許す差は、字の数 × 0.5px (字の送りを整数の画素に丸める環境。上の可変フォントのテストの説明)
  const tolerance = [...'ABCD'].length * 0.5 + 0.01;
  for (const i of info.instances) {
    expect(i.registered).toBe(true);
    expect(i.otto).toBe(true);
    expect(Math.abs(i.drawn - i.laid)).toBeLessThan(tolerance);
  }
  expect(info.dark).toBeGreaterThan(500);
  // PDF には、実体ごとに静的な書体が埋まる
  const pdf = await downloadPdf(page);
  const names: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0')) names.push(String(obj.get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, ''));
  }
  expect(names.filter((n) => n.startsWith('K2Test')).sort()).toEqual(['K2Test-Regular', 'K2Test_200wdth', 'K2Test_700wght']);
  await page.locator('#sheets canvas').first().screenshot({ path: test.info().outputPath('cff2.png') });
  expect(errors).toEqual([]);
});

test('見本: 印刷プレビュー (examples/preview) で、編集すると組み直される', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFonts(page);
  await page.goto('/examples/preview/');
  await expect(page.locator('#status')).toContainText('ページ', { timeout: 150_000 });
  const before = await page.locator('#preview canvas').count();
  expect(before).toBeGreaterThan(0);
  // 「HTML」欄には編集欄の中身 (ルビを含む) が出ている
  await expect(page.locator('#source')).toHaveValue(/<ruby>吾輩<rt>わがはい<\/rt><\/ruby>/);
  // 編集欄に段落をたくさん足すと、ページが増え、「HTML」欄にも写る
  await page.locator('#editor').evaluate((el) => {
    el.insertAdjacentHTML('beforeend', '<p>吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。</p>'.repeat(60));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.locator('#preview canvas').count(), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.locator('#source')).toHaveValue(/見当がつかぬ。<\/p>$/);
  // 「HTML」欄を書き換えると、編集欄に写り、組み直される (1 ページに戻る)
  await page.locator('details', { has: page.locator('#source') }).locator('summary').click();
  await page.locator('#source').fill('<h1>差し替え</h1><p><ruby>漢字<rt>かんじ</rt></ruby>の段落</p>');
  await expect(page.locator('#editor h1')).toHaveText('差し替え');
  await expect(page.locator('#editor rt')).toHaveText('かんじ');
  await expect.poll(() => page.locator('#preview canvas').count(), { timeout: 30_000 }).toBe(1);
  // 「印刷の CSS」欄を書き換えると組み直される: 用紙を A5 から A4 にすると、ページが広くなる
  const pageWidth = () => page.locator('#preview canvas').first().evaluate((c) => (c as HTMLCanvasElement).getBoundingClientRect().width);
  const a5 = await pageWidth();
  await page.locator('details', { has: page.locator('#css') }).locator('summary').click();
  const css = await page.locator('#css').inputValue();
  expect(css).toContain('size: A5');
  await page.locator('#css').fill(css.replace('size: A5', 'size: A4'));
  await expect.poll(pageWidth, { timeout: 30_000 }).toBeCloseTo((a5 * 210) / 148, 0);
  // 対応していないプロパティを書くと、組んだページの上に警告が出る
  await expect(page.locator('#warnings')).toBeEmpty();
  await page.locator('#css').fill(`${css}\np { image-rendering: pixelated }`);
  await expect(page.locator('#warnings')).toContainText('image-rendering', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
