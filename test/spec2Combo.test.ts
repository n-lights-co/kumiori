/**
 * 第 2 弾の機能どうしの組み合わせ: 描くときだけの効果 (transform・opacity)・背景の層 (複数の背景・background-clip) と、
 * 箱の組版 (box-decoration-break: clone・initial-letter・empty-cells)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, serializeAreaTree, typesetHtml, walkAreas, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, AreaTree } from '../src/types';
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

const png = (w: number, h: number, c: number[]) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, () => c).flat()) });
const files = [
  { name: 'a.png', data: png(16, 16, [255, 0, 0, 255]) },
  { name: 'b.png', data: png(8, 8, [0, 0, 255, 255]) },
];
const page = (css: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 200pt 150pt; margin: 20pt } body { margin: 0; font-size: 10pt } p { margin: 0; text-indent: 0 } ${css}</style></head><body>${body}</body></html>`;
const set = (css: string, body: string) => typesetHtml(page(css, body), { name: 't.html', loadFont, files });
const areas = (t: AreaTree, pred: (a: Area) => boolean): Area[] => {
  const out: Area[] = [];
  walkAreaTree(t, (a) => void (a.type !== 'sheet' && pred(a as Area) && out.push(a as Area)));
  return out;
};
const inside = (root: Area): Area[] => {
  const out: Area[] = [];
  walkAreas(root, (a) => void out.push(a as Area));
  return out;
};
const textOf = (root: Area) => inside(root).filter((a) => a.type === 'glyph').map((a) => (a as unknown as { text: string }).text).join('');
const sides = (a: Area) => (['top', 'right', 'bottom', 'left'] as const).filter((k) => a.border[k]).join(' ');

describe('box-decoration-break: clone と transform・opacity・背景の層', () => {
  it('行内の clone の枠 + opacity: 行ごとに、4 辺のそろった枠と字を 1 つの Area にまとめて薄くする', async () => {
    const r = await set('.c { box-decoration-break: clone; border: 2pt solid #f00; padding: 0 3pt; background: #ff0; opacity: .5 }', '<p>前の字 <span class="c">枠の中の長い字が次の行へ折り返して続く文です</span> 後の字</p>');
    const groups = areas(r.areaTree, (a) => a.opacity !== undefined);
    expect(groups.length).toBe(2);
    for (const g of groups) {
      expect([g.type, g.opacity]).toEqual(['inline', 0.5]);
      // 枠は、どの行でも 4 辺 (clone)。枠・背景・字が、まとめた Area の中にある
      expect(inside(g).filter((a) => a.border.top?.color === '#ff0000').map(sides)).toEqual(['top right bottom left']);
      expect(textOf(g).length).toBeGreaterThan(3);
    }
    expect(groups.map(textOf).join('')).toBe('枠の中の長い字が次の行へ折り返して続く文です');
    expect(r.warnings).toEqual([]);
    expect(serializeAreaTree(r.areaTree)).not.toContain('__paint');
  });
  it('ブロックの clone + transform: ページで分かれた断片ごとに、4 辺の枠のまま、その断片の箱を基準に回す', async () => {
    const r = await set('.t { transform: rotate(180deg); box-decoration-break: clone; border: 2pt solid #00f; width: 100pt }', '<div style="height: 70pt"></div><div class="t">一行目<br>二行目<br>三行目<br>四行目<br>五行目</div>');
    expect(r.pageCount).toBe(2);
    const frags = areas(r.areaTree, (a) => !!a.transform);
    expect(frags.map(sides)).toEqual(['top right bottom left', 'top right bottom left']);
    for (const f of frags) {
      expect(f.transform!.slice(0, 4)).toEqual([-1, 0, 0, -1]);
      expect(f.transform![4]).toBeCloseTo(f.width, 3);
      expect(f.transform![5]).toBeCloseTo(f.height, 3);
    }
  });
  it('ブロックの clone + 複数の背景・background-clip: どの断片も、背景の層と色の範囲を持つ', async () => {
    const r = await set(
      '.b { box-decoration-break: clone; border: 4pt solid #000; padding: 6pt; background: url(a.png) no-repeat right bottom, url(b.png) content-box; background-clip: padding-box, content-box; background-color: #ddffdd }',
      '<div style="height: 60pt"></div><div class="b">一行目<br>二行目<br>三行目<br>四行目<br>五行目<br>六行目<br>七行目</div>',
    );
    expect(r.pageCount).toBe(3);
    const frags = areas(r.areaTree, (a) => !!a.backgroundImage);
    expect(frags.length).toBe(3);
    for (const f of frags) {
      expect(sides(f)).toBe('top right bottom left');
      expect(f.backgroundImage).toMatchObject({ src: 'a.png', repeat: 'no-repeat', x: '100%', y: '100%' });
      expect(f.backgroundImage!.under).toMatchObject([{ src: 'b.png', origin: 'content-box', clip: 'content-box' }]);
      // 色の範囲は、いちばん後ろの層の background-clip
      expect(f.backgroundClip).toBe('content-box');
      expect(f.padding.top).toBeCloseTo(6, 3);
      expect(f.padding.bottom).toBeCloseTo(6, 3);
    }
  });
});

describe('initial-letter と opacity', () => {
  it('沈めた最初の字 (::first-letter) の opacity: 字とその箱の背景を、まとめて薄くする。行の回り込みは変わらない', async () => {
    const body = '<p>Drop cap paragraph with enough text to wrap around the sunk initial letter over two lines of text.</p>';
    const css = (op: string) => `p::first-letter { initial-letter: 2; color: #00f; background: #ffdd00; padding: 2pt; ${op} }`;
    const plain = await set(css(''), body);
    const r = await set(css('opacity: .4; transform: rotate(30deg)'), body);
    const got = areas(r.areaTree, (a) => a.opacity !== undefined);
    expect(got.length).toBe(1);
    expect(got[0].opacity).toBe(0.4);
    expect(textOf(got[0])).toBe('D');
    expect(inside(got[0]).some((a) => a.backgroundColor === '#ffdd00')).toBe(true);
    // ::first-letter に変換は効かない (CSS Pseudo 4 の、効く性質の一覧に無い)
    expect(areas(r.areaTree, (a) => !!a.transform)).toEqual([]);
    delete got[0].opacity;
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(plain.areaTree));
    expect(r.warnings).toEqual([]);
  });
});

describe('empty-cells: hide と背景の層・opacity', () => {
  it('見える中身の無いセルは、背景の層も色の範囲も持たない。中身のあるセルは持つ', async () => {
    const r = await set(
      'table { border-collapse: separate; empty-cells: hide } td { border: 2pt solid #000; width: 30pt; height: 20pt; background: url(a.png) no-repeat, url(b.png); background-clip: content-box; background-color: #00ff00; opacity: .5 }',
      '<table><tr><td>a</td><td></td></tr></table>',
    );
    const cells = areas(r.areaTree, (a) => a.type === 'table-cell');
    expect(cells.length).toBe(2);
    expect(cells[0].backgroundImage).toMatchObject({ src: 'a.png', clip: 'content-box', under: [{ src: 'b.png', clip: 'content-box' }] });
    expect([cells[0].backgroundColor, cells[0].backgroundClip, cells[0].opacity]).toEqual(['#00ff00', 'content-box', 0.5]);
    // (隠したセルの罫線は、場所を残して透明の色にしてある)
    expect([cells[1].backgroundImage, cells[1].backgroundColor, cells[1].backgroundClip, cells[1].border.top?.color]).toEqual([undefined, undefined, undefined, 'transparent']);
    expect(r.warnings).toEqual([]);
  });
});
