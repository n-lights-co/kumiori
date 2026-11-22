/**
 * 測る組み (measure: true の Flow) の中の画像の警告 (image/unsupported・image/partial・image/not-found・image/reference-not-found) の数え方のテスト。
 * 結果をそのまま使う組み (行内の箱・脚注の本体) では 1 度出し、結果を捨てる試しの組み (keep-together・break-inside: avoid の高さを測る組み) と、
 * fo:inline-container の中身の幅で組み直す組みでは出さないので、どこに置いても 1 件ずつになる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typeset, typesetFo, type FontSpec, type TypesetResult } from '../src/index';
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

const drawio = fs.readFileSync(path.join(__dirname, '..', 'examples', 'drawio-pages', 'diagrams.drawio'), 'utf8');
// IHDR の途中で切れた PNG (描けない画像: image/unsupported)
const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 1, 0, 0]);
const files = [
  { name: 'd.drawio', data: drawio },
  { name: 'bad.png', data: bad },
];
const imgs = '<img src="bad.png" style="width:10pt;height:10pt"><img src="d.drawio#page=9" style="width:10pt;height:10pt"><img src="none.png" style="width:10pt;height:10pt">';
const fimgs = '<fo:external-graphic src="bad.png" content-width="10pt"/><fo:external-graphic src="d.drawio#page=9" content-width="10pt"/><fo:external-graphic src="none.png" content-width="10pt"/>';
const fo = (body: string) =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 画像の警告の [名前, 数] (数は、まとめた数 count。無ければ 1) */
const imageWarnings = (r: TypesetResult) => r.diagnostics.filter((d) => d.code.startsWith('image/')).map((d) => [d.code, d.count ?? 1]);
const once = [
  ['image/unsupported', 1],
  ['image/partial', 1],
  ['image/not-found', 1],
];

describe('測る組みの中の画像の警告は、1 件ずつ', () => {
  const cases: Array<[string, () => Promise<TypesetResult>]> = [
    ['HTML の inline-block の中', () => typeset(`<p>a<span style="display:inline-block">${imgs}</span></p>`, { kind: 'html', loadFont, files })],
    ['HTML の脚注 (float: footnote) の中', () => typeset(`<p>a<span style="float:footnote">${imgs}</span></p>`, { kind: 'html', loadFont, files })],
    ['HTML の break-inside: avoid の figure の中', () => typeset(`<figure style="break-inside:avoid">${imgs}</figure>`, { kind: 'html', loadFont, files })],
    ['XSL-FO の fo:inline-container の中 (中身の幅で組み直す)', () => typesetFo(fo(`<fo:block>a<fo:inline-container><fo:block>${fimgs}</fo:block></fo:inline-container></fo:block>`), { loadFont, files })],
    ['XSL-FO の fo:footnote-body の中', () => typesetFo(fo(`<fo:block>a<fo:footnote><fo:inline>1</fo:inline><fo:footnote-body><fo:block>${fimgs}</fo:block></fo:footnote-body></fo:footnote></fo:block>`), { loadFont, files })],
    ['XSL-FO の keep-together の中', () => typesetFo(fo(`<fo:block keep-together.within-page="always">${fimgs}</fo:block>`), { loadFont, files })],
  ];
  for (const [name, run] of cases)
    it(name, async () => {
      expect(imageWarnings(await run())).toEqual(once);
    });
});

describe('測る組みの中の SVG の、見つからない画像の参照 (image/reference-not-found) も 1 件', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="gone.png" width="10" height="10"/></svg>';
  const sfiles = [{ name: 's.svg', data: svg }];
  const refs = (r: TypesetResult) => r.diagnostics.filter((d) => d.code === 'image/reference-not-found').map((d) => [d.code, d.count ?? 1]);
  const one = [['image/reference-not-found', 1]];
  const cases: Array<[string, () => Promise<TypesetResult>]> = [
    ['HTML の inline-block の中', () => typeset('<p>a<span style="display:inline-block"><img src="s.svg" style="width:10pt;height:10pt"></span></p>', { kind: 'html', loadFont, files: sfiles })],
    ['HTML の脚注 (float: footnote) の中', () => typeset('<p>a<span style="float:footnote"><img src="s.svg" style="width:10pt;height:10pt"></span></p>', { kind: 'html', loadFont, files: sfiles })],
    ['XSL-FO の fo:inline-container の中', () => typesetFo(fo('<fo:block>a<fo:inline-container><fo:block><fo:external-graphic src="s.svg" content-width="10pt"/></fo:block></fo:inline-container></fo:block>'), { loadFont, files: sfiles })],
    ['XSL-FO の fo:footnote-body の中', () => typesetFo(fo('<fo:block>a<fo:footnote><fo:inline>1</fo:inline><fo:footnote-body><fo:block><fo:external-graphic src="s.svg" content-width="10pt"/></fo:block></fo:footnote-body></fo:footnote></fo:block>'), { loadFont, files: sfiles })],
    ['XSL-FO の keep-together の中', () => typesetFo(fo('<fo:block keep-together.within-page="always"><fo:external-graphic src="s.svg" content-width="10pt"/></fo:block>'), { loadFont, files: sfiles })],
  ];
  for (const [name, run] of cases)
    it(name, async () => {
      expect(refs(await run())).toEqual(one);
    });
});
