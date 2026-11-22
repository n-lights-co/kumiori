/**
 * PDF の、グループ・マスクの中の拡大しない線 (vector-effect: non-scaling-stroke) の太さのテスト。
 * 中の線も、置く所の拡大率で描く (グループ・マスクの Form の中でも)。同じ SVG を違う大きさで置いても、Form を使い回して太さを違えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
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

/** PDF を 96dpi の画素にして、列 x (画素) の黒い画素の数を、上から y0〜y1 の範囲で数える */
async function darkRun(html: string, files: Array<{ name: string; data: string }>, x: number, y0: number, y1: number): Promise<number> {
  const r = await typeset(html, { kind: 'html', loadFont, files });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-ns-'));
  try {
    fs.writeFileSync(path.join(dir, 'v.pdf'), await r.toPdf());
    execFileSync('pdftoppm', ['-r', '96', '-gray', '-singlefile', path.join(dir, 'v.pdf'), path.join(dir, 'v')]);
    const pgm = fs.readFileSync(path.join(dir, 'v.pgm'));
    const head = pgm.toString('latin1', 0, 20).split(/\s+/);
    const w = Number(head[1]);
    const h = Number(head[2]);
    const off = pgm.length - w * h;
    let n = 0;
    for (let y = y0; y < y1; y++) if (pgm[off + y * w + x] < 128) n++;
    return n;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const line = '<line x1="0" y1="5" x2="10" y2="5" stroke="#000" stroke-width="4" vector-effect="non-scaling-stroke"/>';
/** 図形の 2 つある不透明度のグループ (1 つなら、図形に不透明度を掛けて開く) */
const group = (inner: string) => `<g opacity="0.99">${inner}<rect x="0" y="0" width="1" height="1" fill="#fff" opacity="0"/></g>`;
const page = (img: string) => `<style>@page { size: 150pt 150pt; margin: 0 } body { margin: 0 } img { display: block }</style>${img}`;

describe.skipIf(!hasPdftoppm)('PDF の、グループ・マスクの中の拡大しない線', () => {
  it('不透明度のグループの中の線も、ページの上で 4px', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10">${group(line)}</svg>`;
    expect(await darkRun(page('<img src="g.svg" style="width: 100px; height: 100px">'), [{ name: 'g.svg', data: svg }], 50, 0, 100)).toBe(4);
  });
  it('グループの中の図形のマスクの中の線、マスクの中のグループの中の線も、ページの上で 4px', async () => {
    const white = line.replace('#000', '#fff');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10"><defs><mask id="m">${white}</mask><mask id="n">${group(white)}</mask></defs>${group('<rect width="10" height="10" fill="#000" mask="url(#m)"/>')}</svg>`;
    expect(await darkRun(page('<img src="m.svg" style="width: 100px; height: 100px">'), [{ name: 'm.svg', data: svg }], 50, 0, 100)).toBe(4);
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10"><defs><mask id="n">${group(white)}</mask></defs><rect width="10" height="10" fill="#000" mask="url(#n)"/></svg>`;
    expect(await darkRun(page('<img src="n.svg" style="width: 100px; height: 100px">'), [{ name: 'n.svg', data: svg2 }], 50, 0, 100)).toBe(4);
  });
  it('マスクの中の線も、ページの上で 4px', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10"><defs><mask id="m">${line.replace('#000', '#fff')}</mask></defs><rect width="10" height="10" fill="#000" mask="url(#m)"/></svg>`;
    expect(await darkRun(page('<img src="m.svg" style="width: 100px; height: 100px">'), [{ name: 'm.svg', data: svg }], 50, 0, 100)).toBe(4);
  });
  it('同じ SVG を違う大きさで 2 度置いても、グループの中の線は、どちらも 4px (Form を拡大率ごとに作る)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 10 10">${group(line)}</svg>`;
    const html = page('<img src="g.svg" style="width: 50px; height: 50px"><img src="g.svg" style="width: 100px; height: 100px">');
    expect(await darkRun(html, [{ name: 'g.svg', data: svg }], 25, 0, 50)).toBe(4);
    expect(await darkRun(html, [{ name: 'g.svg', data: svg }], 50, 50, 150)).toBe(4);
  });
});
