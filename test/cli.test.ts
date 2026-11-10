/**
 * Node のコマンド (src/cli.ts) の結合テスト: dist-cli/cli.js を作り、FO と HTML+CSS を PDF に組む。
 * 既定の書体は .cache/fonts (KUMIORI_FONT_DIR で上書き可) に無ければ Google Fonts 配信元から取得して置き、--font-dir で渡す。
 * 書体のキャッシュ (--font-cache) のテストは、そこに無い書体 1 つ (Tinos-Bold) だけをネットワークから取る。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { FONT_SPECS, LATIN_SPECS, MONO_SPECS } from '../src/fontMapping';
import { ensureFonts, fontDir } from './helpers';

const root = path.resolve(__dirname, '..');
let work = '';
/**
 * コマンドの子プロセスに渡す環境。コマンドは文言の言語を --lang・KUMIORI_LANG・OS のロケール (LC_ALL・LC_MESSAGES・LANG) で決める
 * (src/messages.ts の detectMessageLang) ので、テストを走らせる機械のロケールに頼らないように、日本語を明示する (PKG-05)。
 * ロケールから言語を決める動きそのものは、下の「--lang en・KUMIORI_LANG・LANG で…」のテストが、LANG などを明示して確かめる
 */
const JA_ENV = { ...process.env, KUMIORI_LANG: 'ja' };

/** コマンドを動かし、標準出力と PDF を返す */
async function run(input: string, ...args: string[]) {
  const out = path.join(work, path.basename(input).replace(/\.\w+$/, '.pdf'));
  const stdout = execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), input, '-o', out, '--font-dir', fontDir, ...args], { encoding: 'utf8', env: JA_ENV });
  return { stdout, pdf: await PDFDocument.load(fs.readFileSync(out)) };
}

beforeAll(async () => {
  // Windows の npm は npm.cmd で、Node は .cmd・.bat をシェル無しでは起動しない (Node 18.20.2・20.12.2 からの変更) ので、Windows ではシェルを通す
  execFileSync('npm', ['run', '--silent', 'build:cli'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  await ensureFonts([...FONT_SPECS, ...LATIN_SPECS, ...MONO_SPECS]);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-cli-'));
}, 300_000);

describe('Node のコマンド', () => {
  it('XSL-FO を組む (用紙の大きさ・改ページ)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'fo-'));
    const fo = path.join(dir, 'doc.fo');
    fs.writeFileSync(
      fo,
      `<?xml version="1.0" encoding="UTF-8"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja">
  <fo:layout-master-set>
    <fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="15mm"><fo:region-body/></fo:simple-page-master>
  </fo:layout-master-set>
  <fo:page-sequence master-reference="p">
    <fo:flow flow-name="xsl-region-body">
      <fo:block>組み織りの見本。</fo:block>
      <fo:block break-before="page">二ページ目。</fo:block>
    </fo:flow>
  </fo:page-sequence>
</fo:root>`,
    );
    const { stdout, pdf } = await run(fo);
    expect(stdout).toContain('2 ページ');
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([420, 595]); // A5 (pt)
  }, 120_000);

  it('HTML+CSS を組む (別ファイルの CSS・head と body の無い HTML)', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'html-'));
    fs.writeFileSync(path.join(dir, 'style.css'), '@page { size: A5 } h1 { break-before: page }');
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<!doctype html><html lang="ja"><link rel="stylesheet" href="style.css"><p>はじめに</p><h1>第一章</h1><p>本文。</p></html>');
    const { stdout, pdf } = await run(html);
    expect(stdout).toContain('2 ページ');
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(1).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([420, 595]);
  }, 120_000);

  it('--spot-colors: 名前の特色を PDF の Separation (代わりの色は DeviceCMYK) にする', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'spot-'));
    const spots = path.join(dir, 'spots.json');
    fs.writeFileSync(spots, JSON.stringify({ 'Ink A': 'cmyk(20%, 40%, 60%, 80%)', 'Ink B': [0, 1, 0, 0] }));
    const html = path.join(dir, 'spot.html');
    fs.writeFileSync(
      html,
      `<!doctype html><style>p { color: rgb(0, 61, 25); color: rgb-icc(0, 61, 25, #Separation, 'Ink A'); background-color: rgba(0, 61, 25, 0.2); background-color: rgb-icc(0, 61, 25, #Separation, 'Ink A', 0.2) }</style><p>特色</p>`,
    );
    const fo = path.join(dir, 'spot.fo');
    fs.writeFileSync(
      fo,
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block color="rgb-icc(255, 0, 255, #Separation, 'Ink B', 0.5)">特色</fo:block></fo:flow></fo:page-sequence></fo:root>`,
    );
    /** 1 ページ目の資源の Separation の [名前, 代わりの色空間] */
    const seps = (pdf: PDFDocument) => {
      const cs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ColorSpace'));
      if (!(cs instanceof PDFDict)) return [];
      return cs.values().map((v) => {
        const a = pdf.context.lookup(v) as unknown as { asArray(): unknown[] };
        return a.asArray().slice(0, 3).map(String);
      });
    };
    expect(seps((await run(html, '--spot-colors', spots)).pdf)).toContainEqual(['/Separation', '/Ink#20A', '/DeviceCMYK']);
    expect(seps((await run(fo, '--spot-colors', spots)).pdf)).toContainEqual(['/Separation', '/Ink#20B', '/DeviceCMYK']);
    // 渡さなければ、これまでどおり (Separation は無い)
    expect(seps((await run(html)).pdf)).toEqual([]);
    // 名前の字は UTF-8 で書く (ISO 32000-2 §7.3.5)。トンボは色材名 All の Separation (§8.6.6.4)。ファイルの識別子 (ID) を書く
    fs.writeFileSync(spots, JSON.stringify({ 特色: [0, 1, 0, 0] }));
    const ja = path.join(dir, 'ja.html');
    fs.writeFileSync(ja, `<!doctype html><style>@page { size: A6; marks: crop; bleed: 3mm } p { color: rgb-icc(255, 0, 255, #Separation, '特色') }</style><p>特色</p>`);
    const out = (await run(ja, '--spot-colors', spots)).pdf;
    expect(seps(out)).toContainEqual(['/Separation', '/#E7#89#B9#E8#89#B2', '/DeviceCMYK']);
    expect(seps(out)).toContainEqual(['/Separation', '/All', '/DeviceCMYK']);
    expect(String(out.context.trailerInfo.ID)).toMatch(/^\[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]$/);
  }, 120_000);

  it('HTML の MathML を数式用の書体で組む。--xhtml は接頭辞の付いた m:math も MathML として読む', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'math-'));
    const body = (p: string) =>
      `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>式 <${p}math xmlns${p ? ':m' : ''}="http://www.w3.org/1998/Math/MathML"><${p}mfrac><${p}mi>a</${p}mi><${p}mi>b</${p}mi></${p}mfrac></${p}math> です</p></body></html>`;
    /** 描いた図形の曲線 (c) の数 (数式は字の輪郭の図形で描く。本文の字は書体で描くので曲線は無い) */
    const curves = (pdf: PDFDocument) => {
      const contents = [...pdf.context.enumerateIndirectObjects()]
        .map(([, o]) => o)
        .filter((o): o is PDFRawStream => o instanceof PDFRawStream && !o.dict.get(PDFName.of('Subtype')) && !o.dict.get(PDFName.of('Length1')) && !o.dict.get(PDFName.of('Type')));
      return contents.reduce((n, o) => {
        const flate = String(o.dict.get(PDFName.of('Filter'))) === '/FlateDecode';
        const text = Buffer.from(flate ? zlib.inflateSync(o.contents) : o.contents).toString('latin1');
        return n + (text.match(/ c\n/g)?.length ?? 0);
      }, 0);
    };
    const plain = path.join(dir, 'plain.html');
    fs.writeFileSync(plain, body(''));
    expect(curves((await run(plain)).pdf)).toBeGreaterThan(0);
    // HTML の構文では m:math は MathML にならない (字を並べる)。--xhtml なら MathML
    const prefixed = path.join(dir, 'prefixed.html');
    fs.writeFileSync(prefixed, body('m:'));
    expect(curves((await run(prefixed)).pdf)).toBe(0);
    expect(curves((await run(prefixed, '--xhtml')).pdf)).toBeGreaterThan(0);
  }, 180_000);

  it('文書が参照する画像 (下のディレクトリも) は読み、参照していない画像は読まない', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'img-'));
    fs.mkdirSync(path.join(dir, 'pics'));
    // 1×1 の PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(dir, 'pics', 'used.png'), png);
    // 参照していない、壊れた大きな画像 (読めば時間がかかる。読まなければ影響しない)
    fs.writeFileSync(path.join(dir, 'pics', 'unused.png'), Buffer.concat([png.subarray(0, 16), Buffer.alloc(5_000_000)]));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<p>図</p><img src="pics/used.png" style="width:20mm">');
    const { pdf } = await run(html);
    const xobjects = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
    expect(xobjects && (xobjects as PDFDict).keys().length).toBe(1);
  }, 120_000);

  it('8 ビット RGB の PNG は展開せずに (Predictor 15 で) 入れ、透明度つきの PNG はこれまでどおり展開して入れる', async () => {
    const zlib = await import('node:zlib');
    const dir = fs.mkdtempSync(path.join(work, 'png-'));
    // PNG を作る (2×2。colorType 2 = RGB、6 = RGBA)
    const crc = (b: Buffer) => {
      let c = ~0;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    const chunk = (type: string, body: Buffer) => {
      const t = Buffer.from(type, 'ascii');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(Buffer.concat([t, body])));
      return Buffer.concat([len, t, body, c]);
    };
    const png = (colorType: 2 | 6) => {
      const ch = colorType === 2 ? 3 : 4;
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(2, 0);
      ihdr.writeUInt32BE(2, 4);
      ihdr[8] = 8;
      ihdr[9] = colorType;
      const rows = Buffer.concat([0, 1].map(() => Buffer.concat([Buffer.from([0]), Buffer.alloc(2 * ch, 200)])));
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
    };
    fs.writeFileSync(path.join(dir, 'rgb.png'), png(2));
    fs.writeFileSync(path.join(dir, 'rgba.png'), png(6));
    const html = path.join(dir, 'doc.html');
    fs.writeFileSync(html, '<img src="rgb.png" style="width:10mm"><img src="rgba.png" style="width:10mm">');
    const { pdf } = await run(html);
    const images = [...pdf.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image');
    const asIs = images.filter((o) => o.dict.get(PDFName.of('DecodeParms')));
    expect(asIs).toHaveLength(1);
    expect(String(asIs[0].dict.get(PDFName.of('ColorSpace')))).toBe('/DeviceRGB');
    // 透明度つきの PNG は、色と透明度 (SMask) に分けて入る
    expect(images.some((o) => o.dict.get(PDFName.of('SMask')))).toBe(true);
  }, 120_000);

  it('まとめて変換する (-o は出力先のディレクトリ)。1 つ失敗しても、ほかは作る', () => {
    const dir = fs.mkdtempSync(path.join(work, 'many-'));
    fs.writeFileSync(path.join(dir, 'a.html'), '<p>一</p>');
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>二</p><p style="break-before: page">三</p>');
    fs.writeFileSync(path.join(dir, 'c.fo'), '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:block>');
    const out = path.join(dir, 'out');
    const cli = path.join(root, 'dist-cli/cli.js');
    expect(() => execFileSync(process.execPath, [cli, 'a.html', 'b.html', 'c.fo', '-o', out, '--font-dir', fontDir], { cwd: dir, stdio: 'pipe', env: JA_ENV })).toThrow();
    expect(fs.readdirSync(out).sort()).toEqual(['a.pdf', 'b.pdf']);
  }, 120_000);

  it('標準入力から読み、標準出力へ書く (FO かどうかは中身で見分ける)', async () => {
    const fo =
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>あ</fo:block></fo:flow></fo:page-sequence></fo:root>';
    const pdf = execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), '-', '-o', '-', '--font-dir', fontDir, '--base', work], { input: fo, stdio: ['pipe', 'pipe', 'pipe'], env: JA_ENV });
    const doc = await PDFDocument.load(pdf);
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(283); // 100mm
  }, 120_000);

  it('--watch: 入力が変わるたびに組み直す', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'watch-'));
    const html = path.join(dir, 'w.html');
    fs.writeFileSync(html, '<p>一</p>');
    const child = spawn(process.execPath, [path.join(root, 'dist-cli/cli.js'), html, '--watch', '--font-dir', fontDir], { stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const until = async (re: RegExp) => {
      for (let i = 0; i < 300 && !re.test(log); i++) await new Promise((r) => setTimeout(r, 100));
      return re.test(log);
    };
    try {
      expect(await until(/見張って/), log).toBe(true);
      fs.writeFileSync(html, '<p>一</p><p style="break-before: page">二</p>');
      expect(await until(/w\.pdf: 2 ページ/), log).toBe(true);
    } finally {
      child.kill();
    }
  }, 120_000);

  it('--help は使い方を、--version は版 (package.json の version) を標準出力に書いて 0 で終わる', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const help = execFileSync(process.execPath, [cli, '--help'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV });
    expect(help).toContain('使い方: kumiori');
    expect(help).toContain('--version');
    const ver = execFileSync(process.execPath, [cli, '--version'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV }).trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    expect(ver).toBe(pkg.version);
    expect(execFileSync(process.execPath, [cli, '-v'], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV }).trim()).toBe(pkg.version);
  });

  it('書体のキャッシュ: --font-dir に無い既定の書体はネットワークから取って --font-cache に保存し、次からはそこから読む。壊れたキャッシュは捨てて取り直す', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const cache = path.join(work, 'font-cache');
    fs.mkdirSync(cache, { recursive: true });
    // キャッシュに Tinos-Bold 以外の既定の書体を置き、Tinos-Bold は壊れたファイルにする (--font-dir は渡さない)
    for (const f of fs.readdirSync(fontDir)) if (/\.ttf$/.test(f) && f !== 'Tinos-Bold.ttf') fs.copyFileSync(path.join(fontDir, f), path.join(cache, f));
    fs.writeFileSync(path.join(cache, 'Tinos-Bold.ttf'), 'broken');
    const html = path.join(work, 'cache.html');
    fs.writeFileSync(html, '<!DOCTYPE html><html><head><title>t</title></head><body><p>キャッシュ <b>bold</b></p></body></html>');
    const out = path.join(work, 'cache.pdf');
    const first = execFileSync(process.execPath, [cli, html, '-o', out, '--font-cache', cache], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: JA_ENV });
    expect(first).toContain('cache.pdf: 1 ページ');
    const saved = fs.readFileSync(path.join(cache, 'Tinos-Bold.ttf'));
    expect(saved.length).toBeGreaterThan(10_000);
    expect(saved.subarray(0, 4)).toEqual(Buffer.from([0, 1, 0, 0]));
    // 2 回目はネットワークに行かない (保存の知らせが出ない)。--no-font-cache はキャッシュを読まない (ネットワークから取るが保存しない)
    const second = spawnSync(process.execPath, [cli, html, '-o', out, '--font-cache', cache], { encoding: 'utf8', env: JA_ENV });
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain('保存しました');
    // 書けない場所 (ファイル) をキャッシュにしても、変換は成功する (1 度だけ知らせる)
    fs.unlinkSync(path.join(cache, 'Tinos-Bold.ttf'));
    const bad = spawnSync(process.execPath, [cli, html, '-o', out, '--font-cache', path.join(work, 'cache.html'), '--font-dir', cache], { encoding: 'utf8', env: JA_ENV });
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain('書体のキャッシュに書けません');
    expect(fs.existsSync(path.join(cache, 'Tinos-Bold.ttf'))).toBe(false);
  }, 120_000);

  it('--lang en・KUMIORI_LANG・LANG で、使い方・報告・警告・誤りの文が英語になる (既定と LANG=C は日本語)', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    // 言語を決める環境変数は、すべてここで明示する (テストを走らせる機械の値を持ち込まない)
    const env = { ...process.env, LANG: 'C', LC_ALL: '', LC_MESSAGES: '', KUMIORI_LANG: '' };
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env })).toMatch(/^使い方: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--lang', 'en', '--help'], { encoding: 'utf8', env })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8' } })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8', KUMIORI_LANG: 'ja' } })).toMatch(/^使い方: kumiori/);
    // LC_ALL は LC_MESSAGES・LANG より先、LC_MESSAGES は LANG より先。どれも無ければ日本語
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'ja_JP.UTF-8', LC_ALL: 'en_US.UTF-8' } })).toMatch(/^Usage: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: 'en_US.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' } })).toMatch(/^使い方: kumiori/);
    expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...env, LANG: '' } })).toMatch(/^使い方: kumiori/);
    // 変換の報告と警告
    const html = path.join(work, 'lang.html');
    fs.writeFileSync(html, '<!DOCTYPE html><html><head><title>t</title><style>.g { display: grid; grid-template-areas: "a b" }</style></head><body><div class="g"><p>a</p></div></body></html>');
    const out = path.join(work, 'lang.pdf');
    const r = spawnSync(process.execPath, [cli, html, '-o', out, '--font-dir', fontDir, '--lang', 'en'], { encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^lang\.pdf: 1 page \(layout \d+ms\)/);
    expect(r.stderr).toContain('warning: ignored unsupported CSS: grid-template-areas');
    // 使い方の誤り (--lang は、どこに書いても誤りの文に効く)
    const bad = spawnSync(process.execPath, [cli, html, '--style', 'nope', '--lang', 'en'], { encoding: 'utf8', env });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^--style cannot be "nope"/);
    const badLang = spawnSync(process.execPath, [cli, html, '--lang', 'fr'], { encoding: 'utf8', env });
    expect(badLang.status).toBe(1);
    expect(badLang.stderr).toContain('--lang の値 "fr" は使えません');
  });
  it('dist-cli には、コマンドとライセンスの表示だけが入る (public/ の favicon・書体をコピーしない)', () => {
    // dist-cli は npm の配布物に入る (package.json の files)。public/ は画面 (dist/) のためのもので、手元では public/fonts に書体も置く
    const files = (fs.readdirSync(path.join(root, 'dist-cli'), { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'));
    for (const f of ['cli.js', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) expect(files).toContain(f);
    expect(files.filter((f) => fs.existsSync(path.join(root, 'public', f)))).toEqual([]);
    expect(files.filter((f) => /\.(ttf|otf|ttc|woff2?|ico|png|svg)$/i.test(f) || f.startsWith('fonts'))).toEqual([]);
  });
  it('知らないオプション・値の無いオプションは、使い方を出してエラーで終わる (値を入力のファイルとして扱わない)', () => {
    const cli = path.join(root, 'dist-cli/cli.js');
    const fail = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe', encoding: 'utf8', env: JA_ENV });
        return '';
      } catch (e) {
        return String((e as { stderr?: string }).stderr);
      }
    };
    const a = fail('a.html', '--fontdir', 'fonts');
    expect(a).toContain('知らないオプションです: --fontdir');
    expect(a).toContain('使い方');
    expect(fail('a.html', '-o')).toContain('-o の値がありません');
    const bad = path.join(work, 'bad-spots.json');
    fs.writeFileSync(bad, JSON.stringify({ X: [0, 0, 1] }));
    expect(fail('a.html', '--spot-colors', bad)).toContain('--spot-colors の「X」の値は CMYK');
  });

  it('XML として読めない FO はエラーで終わる', () => {
    const fo = path.join(work, 'broken.fo');
    fs.writeFileSync(fo, '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:block>');
    expect(() => execFileSync(process.execPath, [path.join(root, 'dist-cli/cli.js'), fo, '--font-dir', fontDir], { stdio: 'pipe', env: JA_ENV })).toThrow();
  }, 120_000);
});
