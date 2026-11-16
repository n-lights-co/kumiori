/**
 * 変換した SVG (draw.io の図に埋め込んだ SVG・プラグインの画像の形式が返す SVG) の中の filter を、ふつうの SVG の画像と同じに扱うこと。
 * 図形で描けない filter (部分領域を書いたぼかし・feComposite の out など) は、PDF を書くときに画素で計算する (svgFilterRaster.ts)。
 * 画像を読むときの確かめ (assets.ts) も、画素で計算できるものとして通さないと、Node では画像の全体が仮の枠になる
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, walkAreaTree, type FontSpec, type KumioriPlugin } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (s: FontSpec) => path.join(fontDir, path.basename(s.urls.find((u) => !/^https:/.test(u)) ?? s.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(() => ensureFonts([...DEFAULT_FONTS.base]), 120000);

/** 図形で描けず、画素の計算に回る filter (部分領域を書いたぼかしと、feComposite の out) */
const FILTERS = {
  blur: '<feGaussianBlur stdDeviation="3" x="0" y="0" width="50" height="50"/>',
  compositeOut: '<feOffset dx="5" dy="5" in="SourceAlpha" result="o"/><feComposite in="SourceGraphic" in2="o" operator="out"/>',
};
const svgWith = (filter: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><filter id="f">${filter}</filter><rect x="10" y="10" width="40" height="40" fill="#c00" filter="url(#f)"/></svg>`;

const drawio = (svg: string) => {
  const b64 = Buffer.from(svg).toString('base64');
  const cell = (id: string, style: string, x: number) =>
    `<mxCell id="${id}" value="" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="60" height="60" as="geometry"/></mxCell>`;
  return `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell('a', `shape=image;image=data:image/svg+xml,${b64};`, 0)}${cell('b', 'rounded=0;', 100)}</root></mxGraphModel></diagram></mxfile>`;
};

const svgPlugin = (svg: string): KumioriPlugin => ({
  apiVersion: 1,
  name: 'svgbox',
  imageFormats: [{ name: 'svgbox', mime: 'application/x-svgbox', extensions: ['svgbox'], sniff: (b) => new TextDecoder().decode(b.subarray(0, 6)) === 'SVGBOX', load: async () => ({ svg, width: 60, height: 60, warnings: [] }) }],
});

/** PDF に描く。画素で計算した filter の結果は、画像 (/Subtype /Image) になって入る */
const pdfImageCount = async (r: Awaited<ReturnType<typeof typeset>>) => {
  const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
  return pdf.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length;
};

const images = (r: Awaited<ReturnType<typeof typeset>>) => {
  const got: unknown[] = [];
  walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, a.missing ?? false])));
  return got;
};

describe('変換した SVG の中の filter (画素で計算するもの)', () => {
  for (const [label, filter] of Object.entries(FILTERS)) {
    it(`draw.io の図に埋め込んだ SVG (${label}): 仮の枠にせず、警告も出さない`, async () => {
      const r = await typeset('<p><img src="a.drawio"></p>', { loadFont, files: [{ name: 'a.drawio', data: drawio(svgWith(filter)) }] });
      expect(images(r)).toEqual([['a.drawio', false]]);
      expect(r.warnings).toEqual([]);
      expect(await pdfImageCount(r)).toBeGreaterThan(0);
    }, 60000);

    it(`プラグインの画像の形式が返す SVG (${label}): 仮の枠にせず、警告も出さない`, async () => {
      const r = await typeset('<p><img src="a.svgbox"></p>', { loadFont, files: [{ name: 'a.svgbox', data: 'SVGBOX' }], plugins: [svgPlugin(svgWith(filter))] });
      expect(images(r)).toEqual([['a.svgbox', false]]);
      expect(r.warnings).toEqual([]);
      expect(await pdfImageCount(r)).toBeGreaterThan(0);
    }, 60000);

    it(`ふつうの SVG の画像 (${label}): 仮の枠にせず、警告も出さない (比べる相手)`, async () => {
      const r = await typeset('<p><img src="a.svg"></p>', { loadFont, files: [{ name: 'a.svg', data: svgWith(filter) }] });
      expect(images(r)).toEqual([['a.svg', false]]);
      expect(r.warnings).toEqual([]);
      expect(await pdfImageCount(r)).toBeGreaterThan(0);
    }, 60000);
  }
});
