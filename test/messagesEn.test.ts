/**
 * lang: 'en' (コマンドの --lang en) で組むと、警告に日本語の字 (ひらがな・カタカナ・漢字・全角の約物) が残らないこと。
 * 未対応の CSS・XSL-FO の通知、読めない画像、PDF/X と GWG の検査、書体、溢れ、リンクの警告をわざと出して確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';
import { encodePngStored } from '../src/pixels';
import { withMessageLang } from '../src/messages';
import { cgmToSvg } from '../src/cgm';
import { emfToSvg } from '../src/metafile';
import { parseAreaTree } from '../src/areaTree';
import { readEpub } from '../src/epub';
import { emfRle } from './metafileExpansionInputs';

const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** 日本語の字 (ひらがな・カタカナ・漢字・全角の約物と記号) */
const JAPANESE = /[　-〿぀-ヿ㐀-鿿＀-￯]/;
/** 日本語の字の残る警告 (文書の中の字を引いて出す警告は、その字を除いて調べる) */
const japanese = (warnings: string[], allow: string[] = []) => warnings.filter((w) => JAPANESE.test(allow.reduce((s, a) => s.split(a).join(''), w)));

/** ICC のプロファイルの頭だけのもの (色空間 space。変換の表は無い。ICC.1:2010 §7.2) */
function iccHeader(space: string): Uint8Array {
  const head = new Array(132).fill(0);
  const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
  put(12, 'prtr');
  put(16, space);
  put(20, 'Lab ');
  put(36, 'acsp');
  return Uint8Array.from(head);
}

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('lang: en の警告に日本語が残らない', () => {
  it('HTML: 未対応の CSS・読めない画像・溢れ・リンク・PDF/X と GWG の検査', async () => {
    const html = `<!doctype html><html><head><style>
      @page { size: 100mm 60mm; margin: 5mm }
      p { color: rgb-icc(#000, x, 0); position: sticky; text-wrap: balance; foo-bar: 1 }
      .tall { height: 2000mm }
      .ah { -ah-last-line-end-indent: 10% }
      </style></head><body>
      <p style="opacity: 0.5">a</p>
      <p class="ah">text</p>
      <img src="missing.png"><img src="broken.png">
      <div style="float: left; height: 500mm; width: 10mm">f</div>
      <p><a href="javascript:alert(1)">js</a> <a href="https://example.com/">ext</a> <a href="#nowhere">in</a></p>
      <p style="background: url(a.png), url(b.png)">bg</p>
      <table><thead style="opacity: 0.5"><tr><td>h</td></tr></thead><tr><td>c</td></tr></table>
      <div class="tall">x</div>
      </body></html>`;
    const r = await typeset(html, { loadFont, lang: 'en', files: [{ name: 'broken.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }] });
    const pdfx: string[] = [];
    await r.toPdf({ pdfx: { version: 'X-3', warnings: pdfx } });
    await r.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('CMYK'), warnings: pdfx } });
    const all = [...r.warnings, ...pdfx];
    expect(japanese(all)).toEqual([]);
  });

  it('書体 (字形の無い字)・SVG の要素の未対応の性質・深すぎる入れ子の規則・GWG の検査 (ページの大きさの違い・粗い画像)', async () => {
    // 20×20 画素の画像を 100mm に置く (25ppi 程度)
    const png = encodePngStored({ width: 20, height: 20, rgba: new Uint8Array(20 * 20 * 4).fill(128) });
    const deep = '@media print {'.repeat(70) + 'p { color: red }' + '}'.repeat(70);
    const html = `<!doctype html><html><head><style>
      @page wide { size: 200mm 100mm }
      .w { page: wide }
      ${deep}
      </style></head><body>
      <p>\uE000\uE001</p>
      <svg width="10" height="10"><circle cx="5" cy="5" r="4" style="paint-order: stroke"/></svg>
      <img src="low.png" style="width: 100mm">
      <div class="w">wide</div>
      </body></html>`;
    const r = await typeset(html, { loadFont, lang: 'en', files: [{ name: 'low.png', data: png }] });
    const pdfx: string[] = [];
    await r.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('CMYK'), warnings: pdfx } });
    const all = [...r.warnings, ...pdfx];
    // 字形の無い字は、その字を引いて出す (字そのものは調べない)
    expect(japanese(all, ['\uE000', '\uE001'])).toEqual([]);
    expect(all.some((w) => w.includes('R0004'))).toBe(true);
    expect(all.some((w) => w.includes('R0031'))).toBe(true);
    expect(all.some((w) => w.includes('SVG elements'))).toBe(true);
  });

  it('XSL-FO: 未対応の要素・プロパティ・単位、溢れ', async () => {
    const fo = `<?xml version="1.0"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions">
<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="60mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p" force-page-count="end-on-even-layout"><fo:flow flow-name="xsl-region-body">
<fo:block foo="1" reference-orientation="45" start-indent="10xx">a<fo:unknown/></fo:block>
<fo:block><fo:retrieve-marker retrieve-class-name="x"/></fo:block>
<fo:change-bar-begin/>
<fo:block-container height="2000mm"><fo:block>tall</fo:block></fo:block-container>
<fo:block><fo:external-graphic src="missing.png"/></fo:block>
<fo:block border-style="ah-double"> </fo:block>
<fo:block><fo:basic-link internal-destination="nowhere">x</fo:basic-link></fo:block>
</fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(fo, { loadFont, lang: 'en' });
    await r.toPdf();
    expect(japanese(r.warnings)).toEqual([]);
  });

  it('XSL-FO: 詰め込み (overflow="condense") の知らせ (縦書き・高さの決まらない容器・収まらない中身)', async () => {
    const fo = `<?xml version="1.0"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions">
<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="60mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">
<fo:block-container writing-mode="tb-rl" width="20mm" height="20mm" overflow="condense"><fo:block>v</fo:block></fo:block-container>
<fo:block-container overflow="condense"><fo:block>a</fo:block></fo:block-container>
<fo:block-container height="10pt" overflow="condense"><fo:block font-size="10pt">b</fo:block><fo:block font-size="10pt">c</fo:block></fo:block-container>
</fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(fo, { loadFont, lang: 'en', compat: 'antenna' });
    expect(r.warnings.filter((w) => /condense/.test(w)).length).toBeGreaterThanOrEqual(3);
    expect(japanese(r.warnings)).toEqual([]);
  });

  it('画像の形式の中の知らせ (CGM・EMF) と、Area Tree・EPUB の読み込みの誤り', async () => {
    /** CGM の命令 (ISO/IEC 8632-3 5.4。長さ 31 未満の短い形) */
    const cmd = (cls: number, id: number, data: number[] = []) => {
      const h = (cls << 12) | (id << 5) | data.length;
      return [h >> 8, h & 0xff, ...data, ...(data.length % 2 ? [0] : [])];
    };
    const str = (t: string) => [t.length, ...Array.from(t, (c) => c.charCodeAt(0))];
    const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
    // 描かない図形 (GDP・POLYSYMBOL など) ・知らない ESCAPE・束ね表に無い束を、わざと並べる
    const body = [
      ...cmd(5, 1, i16(9)), // LINE BUNDLE INDEX 9 (定められていない)
      ...cmd(5, 18, i16(2)), // LINE/EDGE/FILL の ASF は既定 (束ねる) にしないので、FILL の INTERIOR STYLE を pattern に
      ...cmd(5, 22, i16(2)),
      ...cmd(4, 10, i16(1, 0, 0, 0, 0)), // GENERALIZED DRAWING PRIMITIVE
      ...cmd(4, 7, i16(0, 0, 10, 0, 10, 10)), // POLYGON (塗り方 pattern の模様が無い)
      ...cmd(7, 1, i16(999)), // ESCAPE 999
    ];
    const bytes = new Uint8Array([...cmd(0, 1, str('t')), ...cmd(0, 3, str('p')), ...cmd(2, 6, i16(0, 0, 100, 50)), ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);
    const cgm = await withMessageLang('en', async () => cgmToSvg(bytes));
    expect(cgm?.warnings.length).toBeGreaterThan(0);
    expect(japanese(cgm!.warnings)).toEqual([]);
    // EMF: 文書の画像の画素の上限を超える DIB
    const emfWarnings: string[] = [];
    await withMessageLang('en', async () => emfToSvg(emfRle(1200, 1200), undefined, undefined, emfWarnings));
    expect(emfWarnings.length).toBeGreaterThan(0);
    expect(japanese(emfWarnings)).toEqual([]);
    // Area Tree の JSON と EPUB の読み込みの誤り
    const errorOf = async (f: () => unknown) => {
      try {
        await f();
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      return '';
    };
    const errors = await withMessageLang('en', async () => [
      await errorOf(() => parseAreaTree('{')),
      await errorOf(() => parseAreaTree('{"version": 99, "sheets": []}')),
      await errorOf(() => parseAreaTree('{"version": 1}')),
      await errorOf(() => readEpub(new Uint8Array([1, 2, 3]), () => {
        throw new Error('not used');
      })),
    ]);
    expect(errors.every((m) => m !== '')).toBe(true);
    expect(japanese(errors)).toEqual([]);
  });
});
