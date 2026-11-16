/**
 * ブラウザで単体で動くバンドル (npm run build:browser の dist-browser/kumiori.js) の結合テスト:
 * バンドラーを通さず、ファイルの中身をそのまま <script type="module"> の import で読み、HTML を組んで PDF にできることを確かめる
 * (CDN から読む使い方と同じ)。先に npm run build:browser を実行しておく
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
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
