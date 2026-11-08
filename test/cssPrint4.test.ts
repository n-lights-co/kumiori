/**
 * CSS の組版の確認で直した点のテスト:
 *  - counter(page physical) (アンテナハウスの拡張。--style ah のときだけ。標準では宣言ごと無効)
 *  - float: sidenote は @page の @sidenote の float・width に従う
 *  - CSS のルビは行の高さに数えない (CSS Ruby 1 §3.6)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, childrenOf, typesetHtml, walkAreaTree, type AreaNode, type FontSpec, type GlyphArea } from '../src/index';

const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  fs.mkdirSync(fontDir, { recursive: true });
  for (const spec of DEFAULT_FONTS.base) {
    const file = fileOf(spec);
    if (fs.existsSync(file)) continue;
    const res = await fetch(spec.urls.find((u) => /^https:/.test(u))!);
    if (!res.ok) throw new Error(`font download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}, 300_000);

const glyphs = (tree: Awaited<ReturnType<typeof typesetHtml>>['areaTree'], sheet: number) => {
  const out: GlyphArea[] = [];
  walkAreaTree({ ...tree, sheets: [tree.sheets[sheet]] }, (a) => {
    if (a.type === 'glyph') out.push(a as GlyphArea);
  });
  return out;
};
const textOn = (tree: Awaited<ReturnType<typeof typesetHtml>>['areaTree'], sheet: number) => glyphs(tree, sheet).map((g) => g.text).join('');

describe('counter(page physical)', () => {
  const html = `<style>@page { size: A6; margin: 10mm } .n::after { content: "[" counter(page physical) "]" }</style>
    <p>one</p><p class="n" style="break-before: page">two</p>`;
  it('--style ah: 置かれたページの物理的なページ番号', async () => {
    const r = await typesetHtml(html, { loadFont, style: 'ah' });
    expect(r.pageCount).toBe(2);
    expect(textOn(r.areaTree, 1)).toContain('two[2]');
  });
  it('標準の流儀: カンマの無い counter(名前 語) は読めない (何も出さない)', async () => {
    const r = await typesetHtml(html, { loadFont });
    expect(textOn(r.areaTree, 1)).toContain('two');
    expect(textOn(r.areaTree, 1)).not.toContain('[');
  });
});

/** 字と、ページの上での位置 (親の位置を足したもの) */
const placed = (tree: Awaited<ReturnType<typeof typesetHtml>>['areaTree'], sheet: number) => {
  const out: { g: GlyphArea; x: number; y: number }[] = [];
  const go = (a: AreaNode, x: number, y: number) => {
    const ax = x + ((a as { x?: number }).x ?? 0);
    const ay = y + ((a as { y?: number }).y ?? 0);
    if ((a as { type?: string }).type === 'glyph') out.push({ g: a as GlyphArea, x: ax, y: ay });
    for (const c of childrenOf(a)) go(c, ax, ay);
  };
  go(tree.sheets[sheet], 0, 0);
  return out;
};

describe('float: sidenote', () => {
  it('@page の @sidenote の float の側に、width の幅で置く', async () => {
    const css = `@page { size: A5; margin: 10mm; @sidenote { float: left; width: 20% } } .s { float: sidenote }`;
    const r = await typesetHtml(`<style>${css}</style><p>Body text body text body text<span class="s">NOTE</span> more text.</p>`, { loadFont });
    const gs = placed(r.areaTree, 0);
    const note = gs.find((p) => p.g.text.includes('N'))!;
    const body = gs.find((p) => p.g.text.includes('B'))!;
    // 傍注が左、本文はその右から
    expect(note.x).toBeLessThan(body.x);
  });
});

describe('CSS のルビと行の高さ (CSS Ruby 1 §3.6)', () => {
  it('line-height が足りていれば、ルビのある最初の行も、ルビの無い行と同じ位置', async () => {
    const page = '<style>@page { size: A6; margin: 10mm } p { line-height: 2; margin: 0; font-size: 10pt }</style>';
    const a = await typesetHtml(`${page}<p>吾輩は猫である</p>`, { loadFont });
    const b = await typesetHtml(`${page}<p><ruby>吾輩<rt>わがはい</rt></ruby>は猫である</p>`, { loadFont });
    const ya = glyphs(a.areaTree, 0).find((g) => g.text.includes('は'))!;
    const yb = glyphs(b.areaTree, 0).find((g) => g.text.includes('は'))!;
    expect(yb.y).toBeCloseTo(ya.y, 1);
  });
});
