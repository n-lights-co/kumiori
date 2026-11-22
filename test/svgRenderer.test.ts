/**
 * ページを SVG に書き出す (TypesetResult.renderPageToSvg・src/svgRenderer.ts) のテスト。
 *  - 書き出した SVG が整った XML で、紙の大きさ (pt) で、字を書体の輪郭の道にする (text 要素を使わない)
 *  - 画像 (PNG) を data: の URI で埋め込み、SVG の画像を図形 (グラデーション・字の輪郭) にして入れる
 *  - 不透明度の付いた箱・角丸の切り抜きを、g の opacity・clipPath にする
 *  - 書き出しても、PDF は変わらない (同じ結果から作った PDF と、書き出さずに作った PDF が同じ)
 * 描いた絵が画面の Canvas と同じことは、e2e/svgExport.spec.ts で確かめる。
 * KUMIORI_SVG_OUT にディレクトリを指すと、書き出した SVG をそこに置く (目で見るため)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOMParser } from '@xmldom/xmldom';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import fontkit from '@pdf-lib/fontkit';
import { colr1, cpal, paint, withTables } from './colorFontBuilder';
import { defaultFontBuffer, ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** pdftoppm (Poppler) があるか */
const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

/** 2×2 の赤・緑・青・白の PNG */
const png = encodePngStored({ width: 2, height: 2, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) });

const svgImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
  '<rect width="100" height="50" fill="url(#g)"/><text x="10" y="35" font-size="20" fill="#ffffff">SVG</text></svg>';

const html = `<!DOCTYPE html><html lang="ja"><head><style>
@page { size: 200pt 160pt; margin: 10pt }
body { margin: 0; font-size: 12pt }
.box { border: 2pt solid #336699; border-radius: 8pt; overflow: hidden; background: #ffeecc; padding: 4pt }
.op { opacity: 0.5; background: #00aa00; height: 10pt }
</style></head><body>
<div class="box">組版 Kumiori</div>
<div class="op"></div>
<p><img src="dot.png" style="width: 20pt; height: 20pt"> <img src="pic.svg" style="width: 60pt; height: 30pt"></p>
</body></html>`;

const parseXml = (s: string) => {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level, msg) => (level !== 'warning' ? errors.push(msg) : undefined) }).parseFromString(s, 'image/svg+xml');
  return { doc, errors };
};

describe('renderPageToSvg', () => {
  it('ページを、整った SVG の文書にする (字は輪郭の道、画像は埋め込み、SVG の画像は図形)', async () => {
    const r = await typeset(html, {
      kind: 'html',
      loadFont,
      files: [
        { name: 'dot.png', data: png },
        { name: 'pic.svg', data: svgImage },
      ],
    });
    expect(r.pageCount).toBe(1);
    const svg = await r.renderPageToSvg(0);
    if (process.env.KUMIORI_SVG_OUT) {
      fs.mkdirSync(process.env.KUMIORI_SVG_OUT, { recursive: true });
      fs.writeFileSync(path.join(process.env.KUMIORI_SVG_OUT, 'page.svg'), svg);
      fs.writeFileSync(path.join(process.env.KUMIORI_SVG_OUT, 'page.pdf'), await r.toPdf());
    }
    const { doc, errors } = parseXml(svg);
    expect(errors).toEqual([]);
    const root = doc.documentElement!;
    expect(root.localName).toBe('svg');
    expect(root.getAttribute('width')).toBe('200pt');
    expect(root.getAttribute('height')).toBe('160pt');
    expect(root.getAttribute('viewBox')).toBe('0 0 200 160');
    // 字は道 (text 要素を使わない。SVG を見る側に書体が無くても描ける)
    expect(doc.getElementsByTagName('text').length).toBe(0);
    expect(doc.getElementsByTagName('path').length).toBeGreaterThan(10);
    // PNG は data: の URI で埋め込む
    const hrefs = [...Array.from(doc.getElementsByTagName('image'))].map((e) => e.getAttribute('xlink:href') ?? '');
    expect(hrefs.some((h) => h.startsWith('data:image/png;base64,'))).toBe(true);
    // SVG の画像のグラデーションは、linearGradient にして入れる
    expect(doc.getElementsByTagName('linearGradient').length).toBe(1);
    // 不透明度の付いた箱は opacity の g、角丸の切り抜きは clipPath
    expect(svg).toMatch(/<g opacity="0\.5">/);
    expect(doc.getElementsByTagName('clipPath').length).toBeGreaterThan(0);
    // 参照する id は、どれも文書の中にある
    const ids = new Set(Array.from(doc.getElementsByTagName('*')).map((e) => e.getAttribute('id')).filter(Boolean));
    for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(m[1])).toBe(true);
  });

  it('id の頭の文字を変えられ、無いページは RangeError', async () => {
    const r = await typeset('<p style="border: 1pt solid red; border-radius: 4pt; overflow: hidden">a</p>', { kind: 'html', loadFont });
    const svg = await r.renderPageToSvg(0, { idPrefix: 'p1-' });
    expect(svg).toMatch(/id="p1-\d+"/);
    expect(svg).not.toMatch(/id="k\d+"/);
    await expect(r.renderPageToSvg(5)).rejects.toThrow(RangeError);
  });

  it.skipIf(!hasPdftoppm)('SVG に書き出しても、PDF の絵は変わらない (書き出す前と後の PDF を pdftoppm で画像にして比べる)', async () => {
    const r = await typeset(html, { kind: 'html', loadFont, files: [{ name: 'dot.png', data: png }, { name: 'pic.svg', data: svgImage }] });
    const before = await r.toPdf();
    await r.renderPageToSvg(0);
    const after = await r.toPdf();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-svg-'));
    const raster = (pdf: Uint8Array, name: string) => {
      fs.writeFileSync(path.join(dir, `${name}.pdf`), pdf);
      execFileSync('pdftoppm', ['-r', '72', '-png', '-singlefile', path.join(dir, `${name}.pdf`), path.join(dir, name)]);
      return fs.readFileSync(path.join(dir, `${name}.png`));
    };
    expect(raster(after, 'after').equals(raster(before, 'before'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('色つきの字形 (COLR の層・グラデーション) を、色の付いた道とグラデーションにする', async () => {
    const tinos = await defaultFontBuffer('Tinos-Regular.ttf');
    const fk = fontkit.create(new Uint8Array(tinos)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
    const gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
    // A: B の輪郭を、赤から青への線形のグラデーションで塗る (COLR version 1)。Z: H の輪郭を、緑で塗る層 (version 0)
    const stops = [[0, 0, 1], [1, 1, 1]] as Array<[number, number, number]>;
    const font = withTables(tinos, {
      COLR: colr1({ glyphs: [{ gid: gid('A'), paint: paint.glyph(gid('B'), paint.linear(stops, [0, 0, 1000, 0, 0, 1000])) }], v0: [{ gid: gid('Z'), layers: [[gid('H'), 2]] }] }),
      CPAL: cpal([[[255, 0, 0, 255], [0, 0, 255, 255], [0, 160, 0, 255]]]),
    });
    const r = await typeset('<style>@font-face { font-family: ColorTest; src: url(c.ttf) }</style><p style="font-family: ColorTest; font-size: 40pt; color: #333">AZx</p>', { kind: 'html', loadFont, files: [{ name: 'c.ttf', data: new Uint8Array(font) }] });
    const svg = await r.renderPageToSvg(0);
    const { doc, errors } = parseXml(svg);
    expect(errors).toEqual([]);
    const grads = Array.from(doc.getElementsByTagName('linearGradient'));
    expect(grads).toHaveLength(1);
    expect(Array.from(grads[0].getElementsByTagName('stop')).map((e) => e.getAttribute('stop-color'))).toEqual(['#ff0000', '#0000ff']);
    expect(svg).toContain(`fill="url(#${grads[0].getAttribute('id')})"`);
    expect(svg).toContain('fill="#00a000"');
    // 色つきの絵の無い字 (x) は、文字の色で塗る
    expect(svg).toContain('fill="#333333"');
  });

  it('同じ画像は defs に 1 度だけ埋め込み、置く所は use で参照する (置く数に比例して大きくならない)', async () => {
    const svgWithImg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><image width="10" height="10" xlink:href="data:image/png;base64,${Buffer.from(png).toString('base64')}"/></svg>`;
    const imgs = (n: number) => '<img src="dot.png" style="width:5pt;height:5pt">'.repeat(n) + '<img src="s.svg" style="width:5pt;height:5pt">'.repeat(n);
    const files = [
      { name: 'dot.png', data: png },
      { name: 's.svg', data: svgWithImg },
    ];
    const one = await (await typeset(`<p>${imgs(1)}</p>`, { kind: 'html', loadFont, files })).renderPageToSvg(0);
    const many = await (await typeset(`<p>${imgs(40)}</p>`, { kind: 'html', loadFont, files })).renderPageToSvg(0);
    const b64 = Buffer.from(png).toString('base64');
    // ページの PNG と SVG の中の PNG は同じ中身なので、埋め込むのは 1 度だけ
    // (ページの画像は置く大きさの image、SVG の中の画像は単位正方形の image に、それぞれ 1 度)
    expect(many.split(b64).length - 1).toBe(2);
    expect(one.split(b64).length - 1).toBe(2);
    const { doc, errors } = parseXml(many);
    expect(errors).toEqual([]);
    expect(doc.getElementsByTagName('image').length).toBe(2);
    // use の参照する id は、どれも文書の中の image か、字形の輪郭 (defs の path。字も use で置く)
    const ids = new Map(Array.from(doc.getElementsByTagName('*')).map((e) => [e.getAttribute('id'), e.localName] as const));
    const uses = Array.from(doc.getElementsByTagName('use')).map((u) => ids.get(u.getAttribute('xlink:href')!.slice(1)));
    expect(uses.filter((n) => n === 'image')).toHaveLength(80);
    expect(uses.every((n) => n === 'image' || n === 'path')).toBe(true);
    // 置く数が 40 倍でも、大きさは置く要素の分だけ増える (画像の中身は増えない)
    expect(many.length - one.length).toBeLessThan(79 * 200);
  });

  it('id の頭の文字は、XML の名前 (XML 1.0 §2.3 の Name から「:」を除いたもの) に限る', async () => {
    const r = await typeset('<p style="border: 1pt solid red; border-radius: 4pt; overflow: hidden">a</p>', { kind: 'html', loadFont });
    // 引用符・空白・括弧・「:」、Name の字でないもの (上付きの数字・分数・丸数字・µ (U+00B5))
    for (const bad of ['a"b', 'x)y', '1a', 'a b', '', '#k', '<k>', 'a:b', 'a²', 'a½', 'a①', 'µ']) await expect(r.renderPageToSvg(0, { idPrefix: bad })).rejects.toThrow(RangeError);
    // 結合文字 (U+0301。NameChar) は通る
    for (const ok of ['p1-', '_a.b', 'ページ1-', 'a\u0301', 'x·y']) expect(await r.renderPageToSvg(0, { idPrefix: ok })).toContain(`id="${ok}0"`);
  });

  it('画像は置く大きさの image を参照し、大きさの違う置き方が 8 通りを超える画像は、単位正方形を引き伸ばして参照する', async () => {
    const sizes = Array.from({ length: 12 }, (_, i) => `<img src="dot.png" style="width:${4 + i}pt;height:${4 + i}pt">`).join('');
    const svg = await (await typeset(`<p>${sizes}</p>`, { kind: 'html', loadFont, files: [{ name: 'dot.png', data: png }] })).renderPageToSvg(0);
    const { doc } = parseXml(svg);
    const images = Array.from(doc.getElementsByTagName('image'));
    // 8 通りの大きさ + 単位正方形の 1 つ
    expect(images).toHaveLength(9);
    expect(images.filter((e) => e.getAttribute('width') === '1')).toHaveLength(1);
    const ids = new Map(Array.from(doc.getElementsByTagName('*')).map((e) => [e.getAttribute('id'), e.localName] as const));
    expect(Array.from(doc.getElementsByTagName('use')).filter((u) => ids.get(u.getAttribute('xlink:href')!.slice(1)) === 'image')).toHaveLength(12);
  });

  it('SVG の画像の中のリンク (a 要素) は書かない (ページのリンクと同じく、リンクを書き出さない)', async () => {
    const svgA =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="30" height="10">' +
      '<a xlink:href="ftp://example.com/x"><rect width="10" height="10" fill="red"/></a><a href="https://example.com/"><rect x="20" width="10" height="10"/></a></svg>';
    const r = await typeset('<p><img src="a.svg"> <a href="https://example.com/">x</a></p>', { kind: 'html', loadFont, files: [{ name: 'a.svg', data: svgA }] });
    const svg = await r.renderPageToSvg(0);
    expect(svg).not.toMatch(/<a[\s>]/);
    expect(svg).not.toContain('example.com');
    // 図形は描く
    expect(svg).toContain('fill="#ff0000"');
  });
});

describe('負の用紙の大きさ', () => {
  it('@page の size の負の長さ・0 の長さは読まない (CSS Paged Media 3 §7.1)。SVG・PNG・PDF の大きさは正のまま', async () => {
    // 字面で分かる負・0 の長さは読み捨て、前の規則の size が残る
    for (const size of ['-100mm 100mm', '100mm -100mm', '0 100mm', '100mm 0.0pt']) {
      const r = await typeset(`<html><head><style>@page { size: 200pt 100pt } @page { size: ${size} }</style></head><body><p>x</p></body></html>`, { kind: 'html', loadFont });
      const svg = await r.renderPageToSvg(0);
      expect(svg).toContain('width="200pt" height="100pt"');
      const png = await r.renderPageToPng(0, { dpi: 72 });
      const dv = new DataView(png.buffer, png.byteOffset);
      expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([200, 100]);
    }
    // calc() の結果が負なら、その宣言を読まない (既定の A4)
    const r = await typeset('<html><head><style>@page { size: calc(10mm - 20mm) 100mm }</style></head><body><p>x</p></body></html>', { kind: 'html', loadFont });
    expect(await r.renderPageToSvg(0)).toContain('width="595.276pt" height="841.89pt"');
  });

  it('XSL-FO の page-width・page-height の 0 以下の長さは、既定の大きさにして知らせる', async () => {
    const fo = (w: string, h: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="a" page-width="${w}" page-height="${h}"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="a"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const ok = await typeset(fo('100mm', '50mm'), { kind: 'fo', loadFont });
    const dflt = await typeset(fo('auto', 'auto'), { kind: 'fo', loadFont });
    const neg = await typeset(fo('-100mm', '0mm'), { kind: 'fo', loadFont });
    const size = (svg: string) => /width="([^"]+)" height="([^"]+)"/.exec(svg)!.slice(1);
    expect(size(await ok.renderPageToSvg(0))).toEqual(['283.465pt', '141.732pt']);
    expect(size(await neg.renderPageToSvg(0))).toEqual(size(await dflt.renderPageToSvg(0)));
    expect(neg.warnings.join('\n')).toMatch(/page-width:-100mm/);
    expect(neg.warnings.join('\n')).toMatch(/page-height:0mm/);
  });
});
