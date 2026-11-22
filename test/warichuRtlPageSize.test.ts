/**
 * 右から左の段落の割注の括弧と、小さすぎる用紙の大きさのテスト。
 *  - 右から左の段落の割注: 括弧は鏡像の字 (UAX #9 の L4) で、開きを右・閉じを左に置き、詰めるのは外側 (隣の字に重ならない)
 *  - 1pt 未満の用紙の大きさは無効で、既定の用紙になる。PDF の数は、指数で書くほど小さい数を 0 にする (MediaBox の数が壊れない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { DEFAULT_FONTS, typeset, typesetFo, walkAreaTree, type FontSpec } from '../src/index';
import { parsePageSize } from '../src/htmlImport';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

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

/** 字の領域の、ページの上の描く原点の x と、字 */
async function glyphs(html: string) {
  const r = await typeset(html, { kind: 'html', loadFont });
  const xs = new Map<unknown, number>();
  const out: Array<{ text: string; x: number; size: number }> = [];
  walkAreaTree(r.areaTree, (a, p) => {
    const x = (p ? xs.get(p)! : 0) + ((a as { x?: number }).x ?? 0);
    xs.set(a, x);
    if (a.type === 'glyph') out.push({ text: a.text, x: x + a.baselineX, size: a.fontSize });
  });
  return out;
}

describe('右から左の段落の割注', () => {
  it('括弧は内向き (開きは右に「）」の形、閉じは左に「（」の形) で、隣の字に重ならない', async () => {
    const g = await glyphs('<p dir="rtl" style="font-size: 20pt">G4<span style="-kumiori-warichu: auto; font-size: 0.5em">שלום עולם אבגדה</span>H4</p>');
    const open = g.find((a) => a.text === '）')!;
    const close = g.find((a) => a.text === '（')!;
    expect(open).toBeDefined();
    expect(close).toBeDefined();
    // 開きは右、閉じは左
    expect(open.x).toBeGreaterThan(close.x);
    // 割注の字は、2 つの括弧の間
    const heb = g.filter((a) => /[א-ת]/.test(a.text));
    for (const a of heb) {
      expect(a.x).toBeGreaterThanOrEqual(close.x + close.size / 2 - 0.01);
      expect(a.x).toBeLessThan(open.x);
    }
    // 括弧の字形の墨は半分 (開きの「）」は左半分、閉じの「（」は右半分)。前後の字 (右の G4、左の H4) に重ならない
    const G = g.find((a) => a.text === 'G')!;
    const four = g.filter((a) => a.text === '4');
    const H4end = Math.min(...four.map((a) => a.x)) + 10;
    expect(open.x + open.size / 2).toBeLessThanOrEqual(G.x + 0.01);
    expect(close.x + close.size / 2).toBeGreaterThanOrEqual(H4end - 0.5);
  });
  it('右から左の段落でも、割注の中が左から右の字だけなら、左から右に置く', async () => {
    const g = await glyphs('<p dir="rtl" style="font-size: 20pt">G4<span style="-kumiori-warichu: auto; font-size: 0.5em">abc def ghij</span>H4</p>');
    const open = g.find((a) => a.text === '（')!;
    const close = g.find((a) => a.text === '）')!;
    expect(open.x).toBeLessThan(close.x);
    const a = g.find((x) => x.text === 'a')!;
    expect(a.x).toBeGreaterThan(open.x);
  });
});

describe('小さすぎる用紙の大きさ', () => {
  it('1pt 未満の size は無効で既定の用紙 (A4) になり、PDF の MediaBox の数が壊れない', async () => {
    const r = await typeset('<style>@page { size: 1e-320pt 5pt }</style><p>a</p>', { kind: 'html', loadFont });
    const bytes = await r.toPdf();
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/finity|NaN/);
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getMediaBox();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });
  it('--page-size・pageSize の値も、1pt 未満の長さは読まない', () => {
    expect(parsePageSize('0.5pt 10pt')).toBeUndefined();
    expect(parsePageSize('1pt 1pt')).toBeDefined();
  });
  it('XSL-FO の page-width・page-height も、1pt 未満は既定の大きさ', async () => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="1e-320pt" page-height="0.5pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typesetFo(fo, { loadFont });
    const s = r.areaTree.sheets[0];
    expect(s.width).toBeGreaterThan(100);
    expect(s.height).toBeGreaterThan(100);
  });
  it('PDF の数は、PDF の実数の最も小さい正規の値 (約 1.175e-38) より小さい数だけを 0 にする', async () => {
    // 差し替えは PDF を作るときに入る (上の試験で toPdf を呼んだ)
    expect(PDFNumber.of(1e-320).toString()).toBe('0');
    expect(PDFNumber.of(-1e-40).toString()).toBe('0');
    // 大きな viewBox の SVG を置く倍率ほどの小さい数は、0 にしない (0 にすると絵が消える)
    expect(Number(PDFNumber.of(5e-8).toString())).toBe(5e-8);
    expect(PDFNumber.of(0.25).toString()).toBe('0.25');
    // 有限でない数は、PDF の数でない字 (Infinity・NaN) にしない
    expect(PDFNumber.of(Number.NaN).toString()).toBe('0');
    expect(Number(PDFNumber.of(Number.POSITIVE_INFINITY).toString())).toBeCloseTo(3.403e38, -35);
    expect(Number(PDFNumber.of(Number.NEGATIVE_INFINITY).toString())).toBeCloseTo(-3.403e38, -35);
  });
  it.skipIf(!hasPdftoppm)('viewBox 1e300 の SVG を scale(1e10) で置いても、PDF の内容の流れに Infinity を書かない (pdftoppm が構文の誤りを出さない)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 1e300 1e300"><g transform="scale(1e10)"><line x1="0" y1="0" x2="1e300" y2="1e300" stroke="#000" stroke-width="1e298"/></g><rect width="1e299" height="1e299" fill="#0000ff"/></svg>';
    const r = await typeset('<style>@page { size: 75pt 75pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="v.svg" style="width: 100px; height: 100px">', { kind: 'html', loadFont, files: [{ name: 'v.svg', data: svg }] });
    const bytes = await r.toPdf();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-inf-'));
    fs.writeFileSync(path.join(dir, 'v.pdf'), bytes);
    const err = spawnSync('pdftoppm', ['-r', '10', '-singlefile', path.join(dir, 'v.pdf'), path.join(dir, 'v')], { encoding: 'utf8' }).stderr;
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toMatch(/Syntax Error/);
  });
  it.skipIf(!hasPdftoppm)('viewBox が 20 億の SVG を 100px に置いても、PDF で描く (倍率 5e-8 を 0 にしない)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 2000000000 2000000000"><rect width="2000000000" height="2000000000" fill="#0000ff"/></svg>';
    const r = await typeset('<style>@page { size: 75pt 75pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="v.svg" style="width: 100px; height: 100px">', { kind: 'html', loadFont, files: [{ name: 'v.svg', data: svg }] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-vb-'));
    fs.writeFileSync(path.join(dir, 'v.pdf'), await r.toPdf());
    execFileSync('pdftoppm', ['-r', '72', '-singlefile', path.join(dir, 'v.pdf'), path.join(dir, 'v')]);
    const ppm = fs.readFileSync(path.join(dir, 'v.ppm'));
    fs.rmSync(dir, { recursive: true, force: true });
    // ppm の頭 (P6・幅 高さ・255) の後の、真ん中の画素
    const head = ppm.toString('latin1', 0, 20).split(/\s+/);
    const w = Number(head[1]);
    const h = Number(head[2]);
    const off = ppm.length - w * h * 3 + ((h >> 1) * w + (w >> 1)) * 3;
    expect([ppm[off], ppm[off + 1], ppm[off + 2]]).toEqual([0, 0, 255]);
  });
  it('とても大きな用紙でも、字の行列 (Tm) の数を指数で書かない (PDF の数に指数の表記は無い)', async () => {
    const r = await typeset('<style>@page { size: 1e25px 1e25px }</style><p>abc</p>', { kind: 'html', loadFont });
    const pdf = await PDFDocument.load(await r.toPdf());
    // ページの内容の流れ (書体のファイル・Form でない流れ)
    const text = [...pdf.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && !o.dict.get(PDFName.of('Length1')) && !o.dict.get(PDFName.of('Subtype')))
      .map((o) => Buffer.from(String(o.dict.get(PDFName.of('Filter'))) === '/FlateDecode' ? zlib.inflateSync(o.contents) : o.contents).toString('latin1'))
      .join('\n');
    const tm = text.match(/[^\n]*Tm/g) ?? [];
    expect(tm.length).toBeGreaterThan(0);
    for (const t of tm) expect(t).not.toMatch(/e[+-]?\d/i);
  });
});
