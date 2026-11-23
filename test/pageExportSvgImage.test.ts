/**
 * ページの SVG・PNG の書き出し (renderPageToSvg・renderPageToPng) で、SVG の画像を図形にするときも、PDF と同じく
 *  - systemLanguage (SVG 2 §5.6.5 の switch) を、svgLanguages (--svg-lang) で照らす (置いた所の言語が勝つ)
 *  - foreignObject (SVG 2 §23.2) の中身を、本文と同じ組版で組んで描く
 * ことを確かめる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { PNG } from 'pngjs';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const svgFile = (body: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${body}</svg>`);

/** PNG の (x, y) の画素の RGB */
function pixelAt(png: Uint8Array, x: number, y: number): number[] {
  const p = PNG.sync.read(Buffer.from(png));
  return Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
}

describe('SVG・PNG の書き出しでも、svgLanguages で systemLanguage を照らす', () => {
  const body = '<switch><rect systemLanguage="ja" width="200" height="100" fill="#f00"/><rect width="200" height="100" fill="#00f"/></switch>';
  const run = async (html: string, svgLanguages?: string[]) =>
    typesetHtml(`<html><head><style>@page{size:200px 100px;margin:0}body{margin:0}img{display:block}</style></head><body>${html}</body></html>`, {
      loadFont,
      files: [{ name: 's.svg', data: svgFile(body) }],
      ...(svgLanguages ? { svgLanguages } : {}),
    });
  it('置いた所に言語が無ければ svgLanguages で、あれば置いた所の言語で選ぶ', async () => {
    const ja = await run('<img src="s.svg">', ['ja']);
    expect(await ja.renderPageToSvg(0)).toMatch(/fill="#f00"|fill="#ff0000"/);
    expect(pixelAt(await ja.renderPageToPng(0, { dpi: 72 }), 75, 37)).toEqual([255, 0, 0]);
    const en = await run('<img src="s.svg">', ['en']);
    expect(await en.renderPageToSvg(0)).toMatch(/fill="#00f"|fill="#0000ff"/);
    expect(pixelAt(await en.renderPageToPng(0, { dpi: 72 }), 75, 37)).toEqual([0, 0, 255]);
    const lang = await run('<div lang="ja"><img src="s.svg"></div>', ['en']);
    expect(await lang.renderPageToSvg(0)).toMatch(/fill="#f00"|fill="#ff0000"/);
    expect(pixelAt(await lang.renderPageToPng(0, { dpi: 72 }), 75, 37)).toEqual([255, 0, 0]);
  }, 120_000);
});

describe('SVG・PNG の書き出しでも、foreignObject の中身を組んで描く', () => {
  it('HTML の背景を描く (前は何も描かなかった)', async () => {
    const body = '<foreignObject x="0" y="0" width="200" height="100"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#00ff00;height:100px">x</div></foreignObject>';
    const r = await typesetHtml('<html><head><style>@page{size:200px 100px;margin:0}body{margin:0}img{display:block}</style></head><body><img src="a.svg"></body></html>', {
      loadFont,
      files: [{ name: 'a.svg', data: svgFile(body) }],
    });
    expect(await r.renderPageToSvg(0)).toMatch(/fill="#00ff00"/i);
    expect(pixelAt(await r.renderPageToPng(0, { dpi: 72 }), 110, 60)).toEqual([0, 255, 0]);
  }, 120_000);
});
