/**
 * ブラウザで単体で動くバンドル (npm run build:browser の dist-browser/kumiori.js) の結合テスト:
 * バンドラーを通さず、ファイルの中身をそのまま <script type="module"> の import で読み、HTML を組んで PDF にできることを確かめる
 * (CDN から読む使い方と同じ)。先に npm run build:browser を実行しておく
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { routeFontCache } from './fontCache';

const dist = fileURLToPath(new URL('../dist-browser/', import.meta.url));

/**
 * KUMIORI_E2E_FONT_DIR があれば、Google Fonts の代わりにそのディレクトリのフォントを返す (app.spec.ts と同じ)。
 * 無くて KUMIORI_E2E_FONT_CACHE があれば、配信元から取った書体をそこに覚えておく (e2e/fontCache.ts)
 */
async function routeFonts(page: Page) {
  await routeFontCache(page);
  const dir = process.env.KUMIORI_E2E_FONT_DIR;
  if (!dir) return;
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/') ? (u.includes('buE1') ? 'tinos700.ttf' : 'tinos400.ttf') : u.includes('/arimo/') ? (u.includes('CstsBw') ? 'arimo700.ttf' : 'arimo400.ttf') : u.includes('notoserifjp') ? (u.includes('zWPebA') && fs.existsSync(path.join(dir, 'notoserif700.ttf')) ? 'notoserif700.ttf' : 'notoserif.ttf') : u.includes('VFPYk75s') ? 'notosans700.ttf' : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
}

/**
 * バンドルを読める状態にする: バンドルとその別ファイル (chunks/) を、開発サーバーを通さずにファイルの中身そのままで返し (CDN と同じ条件)、
 * 書体の取り方を決めて、ページを開く。返すのは、ページで起きた誤りの一覧
 */
async function openWithBundle(page: Page): Promise<string[]> {
  const built = fs.existsSync(path.join(dist, 'kumiori.js'));
  // CI では、バンドルが無ければ失敗にする (PKG-12: 黙って飛ばすと、ビルドの手順が抜けたときに、バンドルを 1 度も試さないまま通る)。
  // 手元では飛ばすが、理由を出す (一覧の表示は、飛ばした理由を出さないので)
  const reason = 'dist-browser/kumiori.js が無い: 先に npm run build:browser を実行する';
  if (!built && process.env.CI) throw new Error(`${reason} (CI では、このテストを飛ばさずに失敗にする)`);
  if (!built) console.warn(`[skip] ${test.info().title}: ${reason}`);
  test.skip(!built, reason);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/dist-browser/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/dist-browser\//, ''));
    const file = path.join(dist, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
  });
  await routeFonts(page);
  await page.goto('/');
  return errors;
}

test('dist-browser/kumiori.js を import して HTML を組み、PDF を作れる', async ({ page }) => {
  const errors = await openWithBundle(page);
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
  // 既定の書体の数 (Noto Serif JP の Regular・Bold、Noto Sans JP の Regular・Bold、Tinos・Arimo の Regular・Bold)
  expect(r.defaults).toBe(8);
  expect(errors).toEqual([]);
});

test("dist-browser/kumiori.js でも、links の relative: 'uri' で相対のリンクを URI の動作に書く (既定は GoToR)", async ({ page }) => {
  const errors = await openWithBundle(page);
  const enc = 'Bluetooth%E3%82%B9%E3%83%94%E3%83%BC%E3%82%AB%E3%83%BC%20%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B8.pdf';
  const hrefs = ['001-sibutomo.mp3', enc, './a.pdf', 'https://example.com/a.pdf', '#sec'];
  const r = await page.evaluate(async (hrefs) => {
    const url = '/dist-browser/kumiori.js';
    const mod = (await import(/* @vite-ignore */ url)) as typeof import('../src/index');
    const html = `<!DOCTYPE html><html><body>${hrefs.map((h) => `<p><a href="${h}">link</a></p>`).join('')}<h2 id="sec">sec</h2></body></html>`;
    const out: Record<string, { pdf: number[]; warnings: string[] }> = {};
    for (const [key, links] of [['uri', { relative: 'uri' }], ['default', undefined]] as const) {
      const res = await mod.typesetHtml(html, { name: 't.html', style: 'browser', ...(links ? { links } : {}) });
      out[key] = { pdf: Array.from(await res.toPdf()), warnings: res.warnings };
    }
    return out;
  }, hrefs);
  /** リンクの注釈を、文書の順に、動作の文字か "Dest" にする (ブラウザで作った PDF を、こちらで読む) */
  const linksOf = async (bytes: number[]) => {
    const pdf = await PDFDocument.load(Uint8Array.from(bytes));
    const out: string[] = [];
    for (const p of pdf.getPages())
      for (const ref of p.node.Annots()?.asArray() ?? []) {
        const annot = pdf.context.lookup(ref, PDFDict);
        const a = annot.lookup(PDFName.of('A'));
        out.push(a ? String(a).replace(/\s+/g, ' ') : annot.get(PDFName.of('Dest')) ? 'Dest' : '?');
      }
    return out;
  };
  expect(await linksOf(r.uri.pdf)).toEqual(['<< /S /URI /URI (001-sibutomo.mp3) >>', `<< /S /URI /URI (${enc}) >>`, '<< /S /URI /URI (./a.pdf) >>', '<< /S /URI /URI (https://example.com/a.pdf) >>', 'Dest']);
  expect(r.uri.warnings.filter((w) => w.includes('リンクの動作') || w.includes('link actions'))).toEqual([]);
  // 既定: 相対の PDF は GoToR (ASCII でない名前は、ファイル指定の辞書)、PDF でない相対のファイル (Launch) は書かずに警告する
  const def = await linksOf(r.default.pdf);
  expect(def).toHaveLength(4);
  expect(def[0]).toMatch(/^<< \/S \/GoToR \/F << \/Type \/Filespec \/F <[0-9a-f]+> \/UF <FEFF[0-9A-F]+> >> \/D \[ 0 \/Fit \] >>$/);
  expect(def.slice(1)).toEqual(['<< /S /GoToR /F (./a.pdf) /D [ 0 /Fit ] >>', '<< /S /URI /URI (https://example.com/a.pdf) >>', 'Dest']);
  expect(r.default.warnings.some((w) => w.includes('Launch ×1'))).toBe(true);
  expect(errors).toEqual([]);
});

test('dist-browser/kumiori.js: CGM・EPS・WMF の処理は、文書にその画像が出てきたときだけ別のファイル (chunks/) から読み込み、これまでどおり描く (IMG-31)', async ({ page }) => {
  const errors = await openWithBundle(page);
  const chunks: string[] = [];
  page.on('request', (r) => {
    const m = /\/dist-browser\/chunks\/([a-zA-Z]+)-/.exec(r.url());
    if (m) chunks.push(m[1]);
  });
  // CGM (2 進符号化): VDC EXTENT (0,0)-(100,50) の絵に、赤の POLYGON (test/cgm.test.ts の cmd と同じ作り方)
  const cmd = (cls: number, id: number, data: number[] = []) => {
    const h = (cls << 12) | (id << 5) | data.length;
    return [h >> 8, h & 0xff, ...data, ...(data.length % 2 ? [0] : [])];
  };
  const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
  const str = (t: string) => [t.length, ...Array.from(t, (c) => c.charCodeAt(0))];
  const cgm = [...cmd(0, 1, str('t')), ...cmd(0, 3, str('p')), ...cmd(2, 6, i16(0, 0, 100, 50)), ...cmd(0, 4), ...cmd(5, 23, [255, 0, 0]), ...cmd(4, 7, i16(0, 0, 100, 0, 50, 50)), ...cmd(0, 5), ...cmd(0, 2)];
  // WMF (Placeable ヘッダ付き): 緑の CREATEBRUSHINDIRECT・SELECTOBJECT・RECTANGLE (test/imageInfo.test.ts の wmfOf と同じ作り方)
  const words: number[] = [];
  for (const [fn, w] of [[0x02fc, [0, 0xff00, 0, 0]], [0x012d, [0]], [0x041b, [800, 1000, 0, 0]], [0, []]] as Array<[number, number[]]>) words.push((3 + w.length) & 0xffff, (3 + w.length) >> 16, fn, ...w);
  const head = [1, 9, 0x300, 0, 0, 0, 0, 0, 0];
  const wmf = new Uint8Array(22 + (head.length + words.length) * 2);
  const v = new DataView(wmf.buffer);
  v.setUint32(0, 0x9ac6cdd7, true);
  v.setInt16(10, 1000, true), v.setInt16(12, 800, true), v.setUint16(14, 1440, true);
  [...head, ...words].forEach((w, k) => v.setUint16(22 + k * 2, w & 0xffff, true));
  const eps = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n0 0 1 setrgbcolor 0 0 100 50 rectfill\n';
  const r = await page.evaluate(
    async ({ cgm, wmf, eps }) => {
      const url = '/dist-browser/kumiori.js';
      const mod = (await import(/* @vite-ignore */ url)) as typeof import('../src/index');
      const plain = await mod.typesetHtml('<!DOCTYPE html><p>画像の無い文書</p>', { name: 'p.html' });
      const before = performance.getEntriesByType('resource').map((e) => e.name);
      const html = '<!DOCTYPE html><p><img src="a.cgm" style="width:100px"> <img src="b.wmf" style="width:100px"> <img src="c.eps" style="width:100px"></p>';
      const res = await mod.typesetHtml(html, {
        name: 'i.html',
        files: [
          { name: 'a.cgm', data: Uint8Array.from(cgm) },
          { name: 'b.wmf', data: Uint8Array.from(wmf) },
          { name: 'c.eps', data: new TextEncoder().encode(eps) },
        ],
      });
      const pdf = await res.toPdf();
      return { plainPages: plain.pageCount, before, pages: res.pageCount, warnings: res.warnings, pdfLength: pdf.length };
    },
    { cgm, wmf: Array.from(wmf), eps },
  );
  // 画像の無い文書を組んだ所までは、CGM・EPS・WMF の処理を読んでいない
  expect(r.plainPages).toBe(1);
  expect(r.before.filter((u) => /\/chunks\/(cgm|eps|metafile)-/.test(u))).toEqual([]);
  // 画像のある文書を組むと読み込み、描けない画像の警告を出さない
  for (const c of ['cgm', 'eps', 'metafile']) expect(chunks).toContain(c);
  expect(r.pages).toBe(1);
  expect(r.warnings.filter((w) => /CGM|EPS|WMF|読めない|描けない|unsupported/i.test(w))).toEqual([]);
  expect(r.pdfLength).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

/**
 * Web Worker の中で動かすスクリプト: 文書の SVG の画像 (data: の URI) と、HTML の中の svg 要素 (どちらも、ブラウザの <img> を使えない所で読む) と
 * 字のある HTML を組み、OffscreenCanvas に描いて、画素を返す。PDF も作る。
 * 画面は CSP (script-src 'self') で blob: の Worker を作れないので、同じオリジンの URL (/e2e-worker.js) で返す
 */
const WORKER_SOURCE = `
self.onmessage = async () => {
  try {
    const kumiori = await import('/dist-browser/kumiori.js');
    const red = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#ff0000"/><text x="5" y="30" font-size="10" fill="#ffffff">SVG</text></svg>');
    const html = '<!DOCTYPE html><html><head><title>w</title><style>@page { size: 200pt 200pt; margin: 0 } body { margin: 0 } img, svg { display: block }</style></head><body>'
      + '<img src="' + red + '" style="width: 100pt; height: 50pt">'
      + '<svg width="100" height="50" viewBox="0 0 100 50" style="width: 100pt; height: 50pt"><rect width="100" height="50" fill="#0000ff"/></svg>'
      + '<p style="margin: 0">Worker の中で組む。</p></body></html>';
    const typesetter = await kumiori.createTypesetter();
    const res = await typesetter.typeset(html, { name: 'w.html', style: 'browser' });
    const canvas = new OffscreenCanvas(1, 1);
    res.renderPage(canvas, 0, { scale: 1, devicePixelRatio: 1 });
    const ctx = canvas.getContext('2d');
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const size = [canvas.width, canvas.height];
    const result = { pages: res.pageCount, warnings: res.warnings, size, redAt: at(80, 5), blueAt: at(80, 75) };
    const bitmap = canvas.transferToImageBitmap();
    result.bitmap = [bitmap.width, bitmap.height];
    const pdf = await res.toPdf({ title: 'w' });
    result.pdfHead = String.fromCharCode(...pdf.slice(0, 5));
    result.pdfLength = pdf.length;
    const only = await typesetter.typesetToPdf(html, { name: 'w.html', style: 'browser' });
    result.onlyPages = only.pageCount;
    result.onlyHead = String.fromCharCode(...only.pdf.slice(0, 5));
    self.postMessage(result);
  } catch (e) {
    self.postMessage({ error: String((e && e.stack) || e) });
  }
};
self.postMessage('ready');
`;

test('dist-browser/kumiori.js を Web Worker の中で読み、組んで、OffscreenCanvas に描き、PDF を作れる (SVG の画像も)', async ({ page }) => {
  const errors = await openWithBundle(page);
  await page.route('**/e2e-worker.js', (route) => route.fulfill({ body: WORKER_SOURCE, contentType: 'text/javascript' }));
  const chunks: string[] = [];
  page.on('request', (r) => {
    const m = /\/dist-browser\/chunks\/([\w-]+)\.js/.exec(r.url());
    if (m) chunks.push(m[1]);
  });
  // 画面の中で組むときは、linkedom (Web Worker の中で HTML を読むもの) の別ファイルを読まない
  await page.evaluate(async () => {
    const url = '/dist-browser/kumiori.js';
    const mod = (await import(/* @vite-ignore */ url)) as typeof import('../src/index');
    await mod.typesetHtml('<p>a</p>', { name: 't.html' });
  });
  const linkedomChunk = (name: string) => /^esm-/.test(name);
  expect(chunks.filter(linkedomChunk)).toEqual([]);
  const r = await page.evaluate(async () => {
    const worker = new Worker('/e2e-worker.js', { type: 'module' });
    return await new Promise<Record<string, unknown>>((resolve) => {
      worker.onerror = (e) => resolve({ error: `worker error: ${e.message}` });
      worker.onmessage = (e) => {
        if (e.data === 'ready') worker.postMessage('go');
        else resolve(e.data);
      };
    });
  });
  expect(r.error).toBeUndefined();
  expect(r.pages).toBe(1);
  expect((r.warnings as string[]).filter((w) => /未対応|知らない|読めません|見つから/.test(w))).toEqual([]);
  // 200pt 四方を 1pt = 1px で描く。上の 50pt は SVG の画像 (赤)、その下の 50pt は HTML の中の svg 要素 (青)
  expect(r.size).toEqual([200, 200]);
  expect(r.bitmap).toEqual([200, 200]);
  expect(r.redAt).toEqual([255, 0, 0, 255]);
  expect(r.blueAt).toEqual([0, 0, 255, 255]);
  expect(r.pdfHead).toBe('%PDF-');
  expect(r.pdfLength).toBeGreaterThan(1000);
  expect(r.onlyPages).toBe(1);
  expect(r.onlyHead).toBe('%PDF-');
  // Worker の中では、HTML を linkedom の別ファイルで読む
  expect(chunks.filter(linkedomChunk).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/**
 * Web Worker の中で、ブラウザの画像を持たない SVG の画像 (図形を画素にして描くもの) を描くスクリプト:
 * 放射グラデーション・組版の画素の読み取りで読めない画像 (インターレースの PNG)・SVG の @font-face の書体を描いて、画素を返す
 */
const WORKER_SVG_SOURCE = `
self.onmessage = async (ev) => {
  try {
    const { png } = ev.data;
    const kumiori = await import('/dist-browser/kumiori.js');
    const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const uri = (s) => 'data:image/svg+xml,' + encodeURIComponent(s);
    const radial = '<svg ' + NS + ' width="100" height="50" viewBox="0 0 100 50"><defs><radialGradient id="r"><stop offset="0" stop-color="#ffff00"/><stop offset="1" stop-color="#008000"/></radialGradient></defs><rect width="100" height="50" fill="url(#r)"/></svg>';
    const image = '<svg ' + NS + ' width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#0000ff"/><image width="50" height="50" preserveAspectRatio="none" xlink:href="' + png + '"/></svg>';
    // SVG の @font-face の書体 (Arimo の太字を、data: の URI で埋め込む) と、無い名前の書体の SVG (既定の書体で描く。読み込んだ書体は、
    // 同じ文書のほかの SVG からも名前で引けるので、別の名前にする)
    const spec = kumiori.DEFAULT_FONTS.base.find((s) => s.family === 'Arimo' && s.weight === 700);
    const bytes = new Uint8Array(await (await fetch(spec.urls.find((u) => /^https:/.test(u)))).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const text = (family, face) => '<svg ' + NS + ' width="150" height="50" viewBox="0 0 150 50">' + face + '<text x="5" y="40" font-family="' + family + '" font-size="36">iiWW</text></svg>';
    const withFace = text('EmbX', '<style>@font-face { font-family: EmbX; src: url(data:font/ttf;base64,' + btoa(bin) + ') }</style>');
    const html = '<!DOCTYPE html><html><head><style>@page { size: 300pt 120pt; margin: 0 } body { margin: 0 } img { position: absolute }</style></head><body>'
      + '<img src="' + uri(radial) + '" style="left: 0; top: 0; width: 100pt; height: 50pt">'
      + '<img src="' + uri(image) + '" style="left: 110pt; top: 0; width: 100pt; height: 50pt">'
      + '<img src="' + uri(withFace) + '" style="left: 0; top: 60pt; width: 150pt; height: 50pt">'
      + '<img src="' + uri(text('EmbY', '')) + '" style="left: 150pt; top: 60pt; width: 150pt; height: 50pt">'
      + '</body></html>';
    const typesetter = await kumiori.createTypesetter();
    const res = await typesetter.typeset(html, { name: 'w.html', style: 'browser' });
    const canvas = new OffscreenCanvas(1, 1);
    // toPdf より先に描く (SVG の書体は、組んだときに読み込んでおく)
    res.renderPage(canvas, 0, { scale: 1, devicePixelRatio: 1 });
    const ctx = canvas.getContext('2d');
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const region = (x) => Array.from(ctx.getImageData(x, 60, 150, 50).data);
    self.postMessage({ center: at(50, 25), edge: at(99, 25), pngAt: at(130, 25), rectAt: at(190, 25), sameText: region(0).join() === region(150).join() });
  } catch (e) {
    self.postMessage({ error: String((e && e.stack) || e) });
  }
};
self.postMessage('ready');
`;

/** 1 × 1 の赤のインターレース (Adam7) の PNG。1 画素の絵は、最初の段だけで、行の並びはインターレースでないものと同じ (PNG §8.2) */
function interlacedPng(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(tb));
    return Buffer.concat([head, tb, tail]);
  };
  // 幅 1・高さ 1・8 ビット・RGBA (6)・圧縮 0・フィルター 0・インターレース 1 (Adam7)
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 1]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

test('Web Worker の中の Canvas: SVG の放射グラデーション・読めない形の中の画像 (インターレースの PNG)・SVG の @font-face を描く', async ({ page }) => {
  const errors = await openWithBundle(page);
  await page.route('**/e2e-worker-svg.js', (route) => route.fulfill({ body: WORKER_SVG_SOURCE, contentType: 'text/javascript' }));
  const r = await page.evaluate(async (png) => {
    const worker = new Worker('/e2e-worker-svg.js', { type: 'module' });
    return await new Promise<Record<string, unknown>>((resolve) => {
      worker.onerror = (e) => resolve({ error: `worker error: ${e.message}` });
      worker.onmessage = (e) => {
        if (e.data === 'ready') worker.postMessage({ png });
        else resolve(e.data);
      };
    });
  }, interlacedPng());
  expect(r.error).toBeUndefined();
  const near = (a: unknown, b: number[], tol: number) => (a as number[]).every((v, i) => Math.abs(v - b[i]) <= tol);
  // 放射グラデーション: 中心は最初の止まり (黄)、端は最後の止まり (緑) に近い
  expect(near(r.center, [255, 255, 0, 255], 12), String(r.center)).toBe(true);
  expect(near(r.edge, [0, 128, 0, 255], 24), String(r.edge)).toBe(true);
  // インターレースの PNG は、createImageBitmap で読んで描く (例外にしない)。ほかの図形 (青の四角) も描く
  expect(r.pngAt).toEqual([255, 0, 0, 255]);
  expect(r.rectAt).toEqual([0, 0, 255, 255]);
  // SVG の @font-face の書体で描く (既定の書体の SVG と違う絵になる)
  expect(r.sameText).toBe(false);
  expect(errors).toEqual([]);
});
