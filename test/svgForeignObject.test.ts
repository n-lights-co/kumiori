/**
 * SVG の foreignObject の中身を、本文と同じ HTML の組版で組んで描く (API・PDF の書き出し)。svgLanguages の指定
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, decodePDFRawStream, type PDFArray } from 'pdf-lib';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { sheetToSvgShapes } from '../src/pdfRenderer';
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

/** ページの描画の命令 */
async function pageOps(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const c = doc.getPage(0).node.Contents()!;
  const streams = 'asArray' in c ? (c as PDFArray).asArray().map((r) => doc.context.lookup(r)) : [c];
  let ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
  // Form XObject (透明のグループなど) の中身も
  const xo = doc.getPage(0).node.Resources()?.lookup((await import('pdf-lib')).PDFName.of('XObject')) as { keys(): unknown[]; lookup(k: unknown): unknown } | undefined;
  for (const k of xo?.keys() ?? []) {
    const s = xo!.lookup(k) as { dict?: unknown };
    if (s && 'contents' in (s as object)) ops += '\n' + new TextDecoder().decode(decodePDFRawStream(s as never).decode());
  }
  return ops;
}

const svgFile = (body: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${body}</svg>`);

describe('SVG の foreignObject の中身を、本文と同じ組版で組む', () => {
  it('HTML の背景・罫線・表を組んで描く (文字だけの近似でない)', async () => {
    const body =
      '<foreignObject x="10" y="10" width="180" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#ff0000;border:2px solid #0000ff;font-size:12px">' +
      '<table style="border-collapse:collapse"><tr><td style="border:1px solid #00ff00">セル1</td><td>セル2</td></tr></table></div></foreignObject>';
    const r = await typesetHtml('<img src="a.svg" style="width:200px">', { loadFont, files: [{ name: 'a.svg', data: svgFile(body) }] });
    const ops = await pageOps(await r.toPdf());
    // 背景の赤・罫線の青・セルの罫線の緑 (罫線は、paint.ts が辺ごとの台形を塗る)
    expect(ops).toMatch(/1 0 0 rg/);
    expect(ops).toMatch(/0 0 1 rg/);
    expect(ops).toMatch(/0 1 0 rg/);
  }, 120_000);

  it('MathML の foreignObject も組む (前は仮の枠)', async () => {
    const body = '<foreignObject x="0" y="0" width="200" height="100"><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math></foreignObject>';
    const r = await typesetHtml('<img src="m.svg" style="width:200px">', { loadFont, files: [{ name: 'm.svg', data: svgFile(body) }] });
    expect(r.warnings.join('\n')).not.toMatch(/プレースホルダー/);
    const ops = await pageOps(await r.toPdf());
    // 分数の線と字 (輪郭の曲線)
    expect((ops.match(/ c\n/g) ?? []).length).toBeGreaterThan(5);
  }, 120_000);
});

describe('svgLanguages (systemLanguage を照らす言語)', () => {
  const body = '<switch><rect systemLanguage="ja" width="200" height="100" fill="#f00"/><rect width="200" height="100" fill="#00f"/></switch>';
  it('SVG を置いた所に言語の指定が無ければ、svgLanguages で照らす。置いた所の言語が勝つ', async () => {
    const run = async (html: string, svgLanguages?: string[]) => pageOps(await (await typesetHtml(html, { loadFont, files: [{ name: 's.svg', data: svgFile(body) }], ...(svgLanguages ? { svgLanguages } : {}) })).toPdf());
    expect(await run('<img src="s.svg">', ['ja'])).toMatch(/1 0 0 rg/);
    expect(await run('<img src="s.svg">', ['en'])).toMatch(/0 0 1 rg/);
    expect(await run('<p lang="ja"><img src="s.svg"></p>', ['en'])).toMatch(/1 0 0 rg/);
  }, 120_000);
  it('言語タグでない値は誤り', async () => {
    await expect(typesetHtml('<p>a</p>', { loadFont, svgLanguages: ['日本'] })).rejects.toThrow(/svgLanguages/);
  });
});

describe('組んだページを SVG の図形にする描き手', () => {
  it('sheetToSvgShapes は、ページの座標 (pt) を CSS px にする', async () => {
    const r = await typesetHtml('<div style="width:30pt;height:15pt;background:#123456"></div>', { loadFont });
    const { fonts } = await (await import('./helpers')).makeEngine();
    const shapes = sheetToSvgShapes(r.areaTree.sheets[0], fonts);
    const bg = shapes.find((s) => s.fill === '#123456')!;
    const xs = bg.segs.filter((g) => g.op !== 'Z').map((g) => (g as { x: number }).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 3);
  }, 120_000);
});

describe('foreignObject の中身に、SVG の <style> と祖先の書式を当てる (SVG-32)', () => {
  const opsOf = async (body: string, extra: Partial<Parameters<typeof typesetHtml>[1]> = {}) => {
    const r = await typesetHtml('<img src="a.svg" style="width:200px">', { loadFont, files: [{ name: 'a.svg', data: svgFile(body) }], ...extra });
    const ops = await pageOps(await r.toPdf());
    return { ops, warnings: r.warnings };
  };
  /** 字の輪郭を塗る命令の数 (曲線を含む経路の塗り) */
  const glyphFills = (ops: string) => (ops.match(/ c\n(?:[^\n]*\n)*?f\*?\n/g) ?? []).length;
  /** 字を描く命令の数 (字の輪郭の塗りと、PDF の文字 (文字だけの近似の SVG の text は、PDF の文字で描く)) */
  const drawnText = (ops: string) => glyphFills(ops) + (ops.match(/T[jJ]\n/g) ?? []).length;
  // Mermaid 10 以降の flowchart のラベルの形 (台帳の SVG-32 の最小の例)
  const mermaid = (label: string) =>
    '<style>#m{font-family:sans-serif;font-size:16px}#m p{margin:0}#m .nodeLabel{color:#c00}</style><g id="m"><g transform="translate(60,35)"><foreignObject width="80" height="24">' +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell;white-space:nowrap;line-height:1.5">${label}</div></foreignObject></g></g>`;
  // 同じものを、中身の style 属性でじかに指定したもの
  const direct = (label: string) =>
    '<g transform="translate(60,35)"><foreignObject width="80" height="24">' +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell;white-space:nowrap;line-height:1.5;font-family:sans-serif;font-size:16px">${label}</div></foreignObject></g>`;

  // <p> のある形 (行内の要素の中のブロック <span><p>。CSS 2.1 §9.2.1.1 で行内の箱をブロックの前後で分ける。HTM-88) も、<p> の無い形も、
  // 本文の組版で組んで描く (文字だけの近似に落ちず、警告も出ない。枠の外に出たときの近似は、下の別の入力で確かめる)
  for (const [title, label, directLabel] of [
    ['<p> のあるラベル', '<span class="nodeLabel"><p>Start here</p></span>', '<span style="color:#c00"><p style="margin:0">Start here</p></span>'],
    ['<p> の無いラベル', '<span class="nodeLabel">Start here</span>', '<span style="color:#c00">Start here</span>'],
  ] as const) {
    it(`Mermaid の${title}: 本文の組版で字が描かれ、色が #c00、書体が <style> の指定 (中身にじかに指定したものと同じ)`, async () => {
      const a = await opsOf(mermaid(label));
      expect(drawnText(a.ops)).toBeGreaterThan(0);
      expect(a.ops).toMatch(/0\.8 0 0 rg/);
      expect(glyphFills(a.ops)).toBeGreaterThan(3);
      expect(a.warnings.join('\n')).not.toMatch(/foreignObject|行内のボックスの中のブロック/);
      const b = await opsOf(direct(directLabel));
      expect(a.ops).toBe(b.ops);
      // 書体の指定が効いている (既定の明朝のものと違う)
      const serif = await opsOf(direct(directLabel).replace('font-family:sans-serif;', ''));
      expect(a.ops).not.toBe(serif.ops);
    }, 120_000);
  }

  it('SVG の祖先の書式 (表現の属性・style 属性) を受け継ぐ', async () => {
    const a = await opsOf('<g font-family="sans-serif" style="color:#c00"><foreignObject x="10" y="10" width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml">Start here</div></foreignObject></g>');
    const b = await opsOf('<foreignObject x="10" y="10" width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:sans-serif;color:#c00">Start here</div></foreignObject>');
    expect(a.ops).toMatch(/0\.8 0 0 rg/);
    expect(a.ops).toBe(b.ops);
  }, 120_000);

  it('本文の既定のスタイル (kumiori の p の字下げなど) と、本文から参照されない CSS は、中身に掛けない', async () => {
    const css = { name: 'main.css', data: new TextEncoder().encode('p{color:#00f;text-indent:3em}') };
    const fo = (inner: string) => `<foreignObject x="10" y="10" width="180" height="40"><div xmlns="http://www.w3.org/1999/xhtml">${inner}</div></foreignObject>`;
    const run = async (inner: string) => {
      const r = await typesetHtml('<p>本文</p><img src="a.svg" style="width:200px">', { loadFont, style: 'kumiori', files: [{ name: 'a.svg', data: svgFile(fo(inner)) }, css] });
      return pageOps(await r.toPdf());
    };
    const withP = await run('<p style="margin:0">ab cd</p>');
    const withDiv = await run('<div>ab cd</div>');
    expect(withP).toBe(withDiv);
  }, 120_000);

  it('中身が枠の外に全部出て 1 字も描かれないときは、警告して、文字だけを近似して描く', async () => {
    const a = await opsOf('<foreignObject x="10" y="10" width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="margin-top:100px;color:#c00">Hidden</div></foreignObject>');
    expect(a.warnings.join('\n')).toMatch(/foreignObject の中身を組んだものが、枠/);
    expect(a.ops).toMatch(/0\.8 0 0 rg/);
    expect(drawnText(a.ops)).toBeGreaterThan(0);
  }, 120_000);

  it('注釈の中の「<foreignObject」の字で、番号がずれない (SVG-41)', async () => {
    const fo = (bg: string) => `<foreignObject x="0" y="0" width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="background:${bg};height:50px">x</div></foreignObject>`;
    const a = await opsOf(`<!-- a <foreignObject width='10' height='10'> in a comment -->${fo('#ff0000')}<g transform="translate(100,50)">${fo('#0000ff')}</g>`);
    expect(a.ops).toMatch(/1 0 0 rg/);
    expect(a.ops).toMatch(/0 0 1 rg/);
    expect(a.ops).not.toMatch(/in a/);
  }, 120_000);
});
