/**
 * 描画まわりの小さな穴 (NC-16 のうち): object-fit の none・scale-down と object-position (CSS Images 3 §4.5・§4.6)、
 * list-style-image (CSS Lists 3 §3.2・§3.3)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { supportsCssDeclaration } from '../src/cssCascade';
import { paintSheet, type Painter } from '../src/paint';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, AreaTree, ImageArea } from '../src/types';
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

// 画像: pic.png は 80×40px (60×30pt)、dot.png は 16×16px (12×12pt)
const png = (w: number, h: number, c: number[]) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, () => c).flat()) });
const files = [
  { name: 'pic.png', data: png(80, 40, [255, 0, 0, 255]) },
  { name: 'dot.png', data: png(16, 16, [0, 0, 255, 255]) },
];
const page = (body: string, css = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 30pt } body { margin: 0; font-size: 9pt } p { margin: 0; text-indent: 0 } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont, files });
const images = (t: AreaTree): ImageArea[] => {
  const out: ImageArea[] = [];
  walkAreaTree(t, (a) => void (a.type === 'image' && out.push(a as ImageArea)));
  return out;
};
/** 画像を描いた位置と大きさ (枠の左上からの位置): [dx, dy, 幅, 高さ] と、切り抜きの矩形の大きさ */
async function drawn(style: string) {
  const r = await set(page(`<p><img src="pic.png" style="${style}"></p>`));
  const log: Array<[string, ...unknown[]]> = [];
  const p = new Proxy({} as Painter, { get: (_t, name) => (name === 'drawImageTiled' || name === 'group' || name === 'mark' ? undefined : (...args: unknown[]) => void log.push([String(name), ...args])) });
  paintSheet(r.areaTree.sheets[0], p);
  const k = log.findIndex((l) => l[0] === 'drawImage');
  const d = log[k];
  const img = d[1] as { width: number; height: number };
  const clip = log.slice(0, k).reverse().find((l) => l[0] === 'clipRect' && (l[1] as { width: number }).width < 250)?.[1] as { x: number; y: number; width: number; height: number } | undefined;
  const area = images(r.areaTree)[0];
  return { at: clip ? [(d[2] as number) - clip.x, (d[3] as number) - clip.y, img.width, img.height] : [0, 0, img.width, img.height], box: clip ? [clip.width, clip.height] : undefined, area, warnings: r.warnings };
}
const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 2));
};

describe('object-fit の none・scale-down (CSS Images 3 §4.5)', () => {
  it('none: 画像本来の大きさ (60×30pt) のまま、枠の中央に置いて、枠で切り抜く', async () => {
    // 枠 90×60pt: 本来の大きさより大きい
    const big = await drawn('width: 120px; height: 80px; object-fit: none');
    near(big.at, [15, 15, 60, 30]);
    near(big.box!, [90, 60]);
    expect(big.area).toMatchObject({ fit: 'none', naturalWidth: 60, naturalHeight: 30 });
    // 枠 30×30pt: 本来の大きさより小さい (はみ出しは切り抜く)
    near((await drawn('width: 40px; height: 40px; object-fit: none')).at, [-15, 0, 60, 30]);
    expect(big.warnings).toEqual([]);
  });
  it('scale-down: none と contain のうち、小さくなるほう', async () => {
    // 枠が大きい: none (本来の大きさ)
    near((await drawn('width: 120px; height: 80px; object-fit: scale-down')).at, [15, 15, 60, 30]);
    // 枠が小さい: contain (30×15pt)
    near((await drawn('width: 40px; height: 40px; object-fit: scale-down')).at, [0, 7.5, 30, 15]);
  });
  it('fill・contain・cover は、これまでどおり (Area の形も同じ)', async () => {
    const fill = await drawn('width: 120px; height: 80px; object-fit: fill');
    near(fill.at, [0, 0, 90, 60]);
    expect(fill.area.fit).toBeUndefined();
    const contain = await drawn('width: 120px; height: 80px; object-fit: contain');
    near(contain.at, [0, 7.5, 90, 45]);
    expect(Object.keys(contain.area).includes('fitPosition')).toBe(false);
    near((await drawn('width: 120px; height: 80px; object-fit: cover')).at, [-15, 0, 120, 60]);
  });
});

describe('object-position (CSS Images 3 §4.6)', () => {
  it('百分率は (枠 − 画像) に対する割合、長さは左・上の端から、端の語と距離は右・下の端から', async () => {
    const box = 'width: 120px; height: 80px; object-fit: none;';
    near((await drawn(`${box} object-position: left top`)).at, [0, 0, 60, 30]);
    near((await drawn(`${box} object-position: 100% 100%`)).at, [30, 30, 60, 30]);
    near((await drawn(`${box} object-position: 6pt 3pt`)).at, [6, 3, 60, 30]);
    near((await drawn(`${box} object-position: right 6pt bottom 3pt`)).at, [30 - 6, 30 - 3, 60, 30]);
    // 1 つだけなら、もう一方は center
    near((await drawn(`${box} object-position: bottom`)).at, [15, 30, 60, 30]);
    const a = (await drawn(`${box} object-position: right 6pt bottom 3pt`)).area;
    expect(a.fitPosition!.xFromEnd).toBe(true);
    near([a.fitPosition!.x as number, a.fitPosition!.y as number], [6, 3]);
  });
  it('contain・cover の位置にも効く。fill では効かない (枠いっぱい)。初期値 50% 50% は欄を付けない', async () => {
    const box = 'width: 120px; height: 80px;';
    near((await drawn(`${box} object-fit: contain; object-position: 0 100%`)).at, [0, 15, 90, 45]);
    near((await drawn(`${box} object-fit: cover; object-position: 100% 0`)).at, [-30, 0, 120, 60]);
    near((await drawn(`${box} object-fit: fill; object-position: left top`)).at, [0, 0, 90, 60]);
    expect((await drawn(`${box} object-fit: none; object-position: center`)).area.fitPosition).toBeUndefined();
  });
  it('@supports は真を返す', () => {
    for (const v of ['left top', '10px 20%', 'right 3px bottom 4px', 'center']) expect(supportsCssDeclaration('object-position', v), v).toBe(true);
    for (const v of ['none', 'scale-down']) expect(supportsCssDeclaration('object-fit', v), v).toBe(true);
  });
});

describe('list-style-image (CSS Lists 3 §3.2・§3.3)', () => {
  const marks = (t: AreaTree) => images(t).map((i) => [i.src, +i.width.toFixed(2), +i.height.toFixed(2)]);
  const texts = (t: AreaTree) => {
    let s = '';
    walkAreaTree(t, (a) => void (a.type === 'glyph' && (s += (a as unknown as { text: string }).text)));
    return s;
  };
  it('記号の代わりに、画像 (本来の大きさ) を置く。番号付きのリストでも同じ', async () => {
    const r = await set(page('<ul style="list-style-image: url(dot.png)"><li>一</li><li>二</li></ul><ol style="list-style-image: url(dot.png)"><li>三</li></ol>'));
    expect(marks(r.areaTree)).toEqual([['dot.png', 12, 12], ['dot.png', 12, 12], ['dot.png', 12, 12]]);
    // 記号・番号の字は出ない (最後の 1 はページ番号)
    expect(texts(r.areaTree).replace(/\s/g, '')).toBe('一二三1');
    expect(r.warnings).toEqual([]);
    // 画像は項目の本文より行の始め側 (左) にある
    const xs: number[] = [];
    walkAreaTree(r.areaTree, (a, parent) => void (a.type === 'table-cell' && (parent as Area | undefined)?.type === 'table-row' && xs.push(a.x)));
    expect(xs[0]).toBeLessThan(xs[1]);
  });
  it('none と、読めない画像は、list-style-type の記号を使う (§3.3)', async () => {
    const r = await set(page('<ul style="list-style-image: url(dot.png)"><li style="list-style-image: none">一</li><li style="list-style-image: url(nai.png)">二</li></ul>'));
    expect(marks(r.areaTree)).toEqual([]);
    expect(texts(r.areaTree).replace(/\s/g, '')).toBe('•一•二1');
  });
  it('inside: 画像を本文の最初の行の先頭に置き、後ろに空白を 1 つ (§3.2)。list-style-type: none でも画像は出る', async () => {
    const r = await set(page('<ul style="list-style: inside url(dot.png)"><li>一</li></ul><ul style="list-style: none url(dot.png)"><li>二</li></ul>'));
    expect(marks(r.areaTree).length).toBe(2);
    expect(texts(r.areaTree)).toContain(' 一');
    expect(r.warnings).toEqual([]);
  });
  it('url() でない画像 (グラデーション) は、記号のままにして、未対応として知らせる', async () => {
    const r = await set(page('<ul style="list-style-image: linear-gradient(red, blue)"><li>一</li></ul>'));
    expect(texts(r.areaTree).replace(/\s/g, '')).toBe('•一1');
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual(['未対応の CSS を無視しました: list-style-image: linear-gradient()']);
  });
});
