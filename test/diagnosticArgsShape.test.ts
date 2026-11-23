/**
 * 同じ名前の診断は、出す所によらず、同じ args を持つ (docs/diagnostics.md の args の欄)。
 * 字面の照らし合わせは test/docsTables.test.ts。ここでは、組んだ結果の診断で確かめる
 *  - font/file-unreadable: 読めなかった書体ファイルの名前 (file)。@font-face では書体の名前 (font) も
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
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

describe('font/file-unreadable の args', () => {
  it('@font-face の読めない書体: file と font', async () => {
    // 頭だけ TrueType の、中身の壊れたファイル
    const broken = new Uint8Array(64);
    broken.set([0, 1, 0, 0, 0, 9]);
    const html = '<!DOCTYPE html><html><head><title>t</title><style>@font-face { font-family: Broken; src: url(b.ttf) } p { font-family: Broken }</style></head><body><p>x</p></body></html>';
    const r = await typesetHtml(html, { name: 't.html', loadFont, files: [{ name: 'b.ttf', data: broken }] });
    const ds = r.diagnostics.filter((d) => d.code === 'font/file-unreadable');
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(d.args).toEqual({ file: 'b.ttf', font: 'Broken' });
  });
});
