/**
 * 背景の残り (NC-13。CSS Backgrounds 3): 複数の背景 (§2.1)、background-clip (§2.7)、background-origin (§2.8)、
 * background-attachment (§2.5)、一括指定の箱の語 (§2.10)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { expand, supportsCssDeclaration } from '../src/cssCascade';
import { paintSheet, type Painter } from '../src/paint';
import { encodePngStored } from '../src/pixels';
import { childrenOf, DEFAULT_FONTS, serializeAreaTree, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
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

// 画像: a.png は 16×16px (12×12pt)、b.png は 8×8px (6×6pt)
const png = (w: number, h: number, c: number[]) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, () => c).flat()) });
const files = [
  { name: 'a.png', data: png(16, 16, [255, 0, 0, 255]) },
  { name: 'b.png', data: png(8, 8, [0, 0, 255, 255]) },
];
// 箱: border の箱は (15, 15) から 120×72pt、罫線 6pt、padding 6pt (padding の箱は (21, 21) から 108×60、内容の箱は (27, 27) から 96×48)。
// 長さは px にしても端数の出ない値 (6pt = 8px)。箱は用紙の端から離す (端に接する箱は、塗りを端の外へ少し伸ばすため)
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 200pt 200pt; margin: 0 } body { margin: 0; font-size: 8pt } .b { box-sizing: border-box; width: 120pt; height: 72pt; margin: 15pt; border: 6pt solid #000; padding: 6pt } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont, files });
const boxOf = (t: AreaTree): Area => {
  let hit: Area | undefined;
  walkAreaTree(t, (a) => {
    if (!hit && a.type === 'block' && Math.abs(a.width - 120) < 0.01 && Math.abs(a.height - 72) < 0.01) hit = a as Area;
  });
  return hit!;
};
const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 2));
};

/** 描く処理の呼び出しを記録する Painter (drawImageTiled は持たない: 1 枚ずつ描かせる) */
function recorder(): { p: Painter; log: Array<[string, ...unknown[]]> } {
  const log: Array<[string, ...unknown[]]> = [];
  const p = new Proxy({} as Painter, {
    get: (_t, name) => (name === 'drawImageTiled' || name === 'group' || name === 'mark' ? undefined : (...args: unknown[]) => void log.push([String(name), ...args])),
  });
  return { p, log };
}
/** 箱の背景の描き方: 切り抜き (clipRect) と、その中に描いた画像 (src と位置) の並び */
async function paintLog(html: string) {
  const r = await set(html);
  const { p, log } = recorder();
  paintSheet(r.areaTree.sheets[0], p);
  const out: Array<{ clip: number[]; images: Array<[string, number, number, number, number]> }> = [];
  let cur: (typeof out)[number] | undefined;
  for (const [name, ...args] of log) {
    if (name === 'clipRect') {
      const c = args[0] as { x: number; y: number; width: number; height: number };
      cur = { clip: [c.x, c.y, c.width, c.height], images: [] };
    } else if (name === 'drawImage' && cur) {
      const a = args[0] as { src: string; width: number; height: number };
      cur.images.push([a.src, args[1] as number, args[2] as number, a.width, a.height]);
    } else if (name === 'restore') {
      if (cur?.images.length) out.push(cur);
      cur = undefined;
    }
  }
  return { r, layers: out, log };
}

describe('カスケード: 背景の性質は、層ごとの値の並び (Backgrounds 3 §2.1・§2.10)', () => {
  it('background の一括指定: 層ごとの画像・繰り返し・位置・大きさ・origin・clip・attachment。色は最後の層', () => {
    const got = Object.fromEntries(expand('background', 'url(a.png) no-repeat right bottom / 10px content-box, url(b.png) repeat-x fixed padding-box border-box, linear-gradient(red, blue) #fff'));
    expect(got).toEqual({
      'background-color': '#fff',
      'background-image': 'url(a.png), url(b.png), linear-gradient(red, blue)',
      'background-repeat': 'no-repeat, repeat-x, repeat',
      'background-position-x': '100%, 0%, 0%',
      'background-position-y': '100%, 0%, 0%',
      'background-size': '10px, auto, auto',
      // 箱の語が 1 つなら origin と clip の両方、2 つなら 1 つ目が origin・2 つ目が clip。無ければ初期値 (padding-box・border-box)
      'background-origin': 'content-box, padding-box, padding-box',
      'background-clip': 'content-box, border-box, border-box',
      'background-attachment': 'scroll, fixed, scroll',
    });
  });
  it('1 層の一括指定は、これまでと同じ値 (並びにならない)', () => {
    expect(Object.fromEntries(expand('background', 'no-repeat top left / 125% url("img/a.png") #fff'))).toMatchObject({
      'background-image': 'url("img/a.png")',
      'background-repeat': 'no-repeat',
      'background-position-x': '0%',
      'background-position-y': '0%',
      'background-size': '125%',
      'background-color': '#fff',
      'background-origin': 'padding-box',
      'background-clip': 'border-box',
      'background-attachment': 'scroll',
    });
  });
  it('色を最後でない層に書いた宣言・箱の語が 3 つの宣言は読めない (空)。background-position も層ごと', () => {
    expect(expand('background', 'red url(a.png), url(b.png)')).toEqual([]);
    expect(expand('background', 'url(a.png) border-box padding-box content-box')).toEqual([]);
    expect(Object.fromEntries(expand('background-position', 'center, left 10px bottom, 20% 30%'))).toEqual({ 'background-position-x': '50%, 10px, 20%', 'background-position-y': '50%, 100%, 30%' });
  });
  it('@supports: background-clip・background-origin・background-attachment は対応。background-clip: text と fixed は読まない', () => {
    for (const [p, v] of [['background-clip', 'content-box'], ['background-clip', 'padding-box, border-box'], ['background-origin', 'border-box'], ['background-attachment', 'scroll'], ['background-attachment', 'local'], ['background', 'url(a.png) content-box, url(b.png) #fff']])
      expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(true);
    for (const [p, v] of [['background-clip', 'text'], ['background-clip', 'margin-box'], ['background-origin', 'text'], ['background-attachment', 'fixed'], ['background-attachment', 'scroll, fixed'], ['background', 'url(a.png) fixed']])
      expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(false);
  });
});

describe('複数の背景 (§2.1)', () => {
  it('層ごとに画像・位置・繰り返し・大きさを持ち、最初の画像がいちばん手前。足りない値は、並びを繰り返して使う', async () => {
    const r = await set(page('<div class="b" style="background-image: url(a.png), none, url(b.png); background-repeat: no-repeat, repeat-x; background-position: right bottom, 0 0, 3pt 5pt; background-size: auto, auto, 12pt 3pt"></div>'));
    const bi = boxOf(r.areaTree).backgroundImage!;
    expect(bi).toMatchObject({ src: 'a.png', repeat: 'no-repeat', x: '100%', y: '100%', width: 12, height: 12 });
    // none の層は何も描かない (層としては数える: 3 層目の繰り返しは、並びを繰り返した 1 つ目の no-repeat)
    expect(bi.under!.length).toBe(1);
    expect(bi.under![0]).toMatchObject({ src: 'b.png', repeat: 'no-repeat', width: 12, height: 3 });
    near([bi.under![0].x as number, bi.under![0].y as number], [3, 5]);
    expect(r.warnings).toEqual([]);
  });
  it('後ろの層から順に描く。位置は、それぞれの層の値', async () => {
    const { layers } = await paintLog(page('<div class="b" style="background: url(a.png) no-repeat right bottom, url(b.png) no-repeat 3pt 5pt"></div>'));
    expect(layers.map((l) => l.images.map((i) => i[0]))).toEqual([['b.png'], ['a.png']]);
    // 描く範囲は border の箱 (background-clip の初期値)。位置の基準は padding の箱 (21, 21) から 108×60
    near(layers[0].clip, [15, 15, 120, 72]);
    near(layers[0].images[0].slice(1) as number[], [21 + 3, 21 + 5, 6, 6]);
    near(layers[1].images[0].slice(1) as number[], [21 + 108 - 12, 21 + 60 - 12, 12, 12]);
  });
  it('1 枚だけの背景は、under・origin・backgroundClip の欄を持たない (clip は、background-clip の初期値の border-box)', async () => {
    const r = await set(page('<div class="b" style="background: url(a.png) no-repeat 10pt 10pt #eee"></div>'));
    const b = boxOf(r.areaTree);
    expect(Object.keys(b.backgroundImage!).sort()).toEqual(['clip', 'height', 'repeat', 'src', 'width', 'x', 'y']);
    expect(b.backgroundImage!.clip).toBe('border-box');
    expect(b.backgroundClip).toBeUndefined();
    expect(serializeAreaTree(r.areaTree)).not.toMatch(/"under"|"origin"|"backgroundClip"/);
  });
  it('グラデーションと画像を重ねられる。読めない画像の層は、何も描かない (後ろの層は描く)', async () => {
    const r = await set(page('<div class="b" style="background: url(none.png), linear-gradient(red, blue), url(b.png)"></div>'));
    const bi = boxOf(r.areaTree).backgroundImage!;
    expect(bi.src).toMatch(/^kumiori-gradient-\d+\.svg$/);
    // グラデーションの大きさは、位置の基準の領域 (padding の箱) の大きさ
    near([bi.width!, bi.height!], [108, 60]);
    expect(bi.under!.map((l) => l.src)).toEqual(['b.png']);
  });
  it('conic-gradient も背景のグラデーションにする (これまでは描かれず、警告も出なかった。CSS Images 4 §3.3)', async () => {
    for (const bg of ['conic-gradient(red, blue)', 'url(a.png) no-repeat, repeating-conic-gradient(#000 0 15deg, #fff 15deg 30deg)']) {
      const r = await set(page(`<div class="b" style="background: ${bg}"></div>`));
      const bi = boxOf(r.areaTree).backgroundImage!;
      const srcs = [bi.src, ...(bi.under ?? []).map((l) => l.src)];
      expect(srcs.some((s) => /^kumiori-gradient-\d+\.svg$/.test(s))).toBe(true);
      expect(r.warnings).toEqual([]);
    }
  });
  it('PDF: 後ろの層の画像も埋め込む', async () => {
    const r = await set(page('<div class="b" style="background: url(a.png) no-repeat, url(b.png) no-repeat 20pt 20pt"></div>'));
    expect(r.areaTree.resources?.images?.map((i) => i.src).sort()).toEqual(['a.png', 'b.png']);
    const pdf = await PDFDocument.load(await r.toPdf());
    const xo = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(xo.entries().length).toBe(2);
  });
});

describe('background-origin と background-clip (§2.7・§2.8)', () => {
  it('origin: 位置と百分率の大きさの基準の領域 (content-box・border-box。初期値は padding-box)', async () => {
    const one = async (st: string) => (await paintLog(page(`<div class="b" style="background: url(a.png) no-repeat; ${st}"></div>`))).layers[0];
    // 初期値: padding の箱の左上
    near((await one('')).images[0].slice(1) as number[], [21, 21, 12, 12]);
    // content-box: 内容の箱の右下に寄せる。切り抜きは border の箱 (background-clip の初期値) のまま
    const c = await one('background-origin: content-box; background-position: right bottom');
    near(c.images[0].slice(1) as number[], [27 + 96 - 12, 27 + 48 - 12, 12, 12]);
    near(c.clip, [15, 15, 120, 72]);
    // border-box: border の箱の左上。百分率の大きさは border の箱 (120×72) に対して。描く範囲も border の箱
    const b = await one('background-origin: border-box; background-size: 50% 50%');
    near(b.images[0].slice(1) as number[], [15, 15, 60, 36]);
    near(b.clip, [15, 15, 120, 72]);
    // border-box でも、描く範囲が padding-box なら padding の箱で切り抜く
    near((await one('background-origin: border-box; background-clip: padding-box')).clip, [21, 21, 108, 60]);
  });
  it('clip: content-box は内容の箱で切り抜く。繰り返しは、基準の領域の左上から、描く範囲を覆うまで並べる', async () => {
    const { layers } = await paintLog(page('<div class="b" style="background: url(a.png); background-clip: content-box"></div>'));
    near(layers[0].clip, [27, 27, 96, 48]);
    const xs = [...new Set(layers[0].images.map((i) => +(i[1] as number).toFixed(2)))];
    const ys = [...new Set(layers[0].images.map((i) => +(i[2] as number).toFixed(2)))];
    // 並びの始まりは padding の箱の左上 (21, 21)。12pt ごとに、内容の箱の右端 (123)・下端 (75) を覆うまで
    expect(xs).toEqual([21, 33, 45, 57, 69, 81, 93, 105, 117]);
    expect(ys).toEqual([21, 33, 45, 57, 69]);
  });
  it('背景の色は、いちばん後ろの層の background-clip の箱に塗る (§2.2)。初期値 (border-box) はこれまでどおり border の箱', async () => {
    const fill = async (st: string) => {
      const { r, log } = await paintLog(page(`<div class="b" style="background-color: #00ff00; ${st}"></div>`));
      const f = log.find((l) => l[0] === 'fillRect' && l[5] === '#00ff00')!;
      return { rect: f.slice(1, 5) as number[], clip: boxOf(r.areaTree).backgroundClip };
    };
    const d = await fill('');
    near(d.rect, [15, 15, 120, 72]);
    expect(d.clip).toBeUndefined();
    const p = await fill('background-clip: padding-box');
    near(p.rect, [21, 21, 108, 60]);
    expect(p.clip).toBe('padding-box');
    near((await fill('background-clip: content-box')).rect, [27, 27, 96, 48]);
    // 層が 2 つなら、後ろの層の値 (1 つ目の content-box ではない)
    near((await fill('background-image: url(a.png), url(b.png); background-clip: content-box, padding-box')).rect, [21, 21, 108, 60]);
  });
  it('一括指定の箱の語: 1 つなら origin と clip の両方', async () => {
    const { r, layers } = await paintLog(page('<div class="b" style="background: url(a.png) no-repeat content-box #00ff00"></div>'));
    expect(boxOf(r.areaTree).backgroundImage).toMatchObject({ origin: 'content-box', clip: 'content-box' });
    expect(boxOf(r.areaTree).backgroundClip).toBe('content-box');
    near(layers[0].clip, [27, 27, 96, 48]);
    near(layers[0].images[0].slice(1) as number[], [27, 27, 12, 12]);
  });
  it('角丸の箱は、描く範囲の箱の角丸で切り抜く (§4.2)。回り込み・表のセルの箱にも効く', async () => {
    const r = await set(page('<div class="b" style="border-radius: 10pt; background: url(a.png) content-box #00ff00"></div>'));
    const { p, log } = recorder();
    paintSheet(r.areaTree.sheets[0], p);
    // 色は内容の箱の形を塗り (fillPath)、画像は内容の箱の形で切り抜く (clipPath)
    const bounds = (path: Array<{ x?: number; y?: number }>) => [Math.min(...path.filter((s) => s.x !== undefined).map((s) => s.x!)), Math.min(...path.filter((s) => s.y !== undefined).map((s) => s.y!))];
    near(bounds(log.find((l) => l[0] === 'fillPath' && l[2] === '#00ff00')![1] as never), [27, 27]);
    near(bounds(log.find((l) => l[0] === 'clipPath')![1] as never), [27, 27]);
    const t = await set(page('<div class="b" style="float: left; background: #00ff00 padding-box"></div><table><tr><td style="padding: 5pt; border: 2pt solid; background: #0000ff content-box">c</td></tr></table>'));
    const clips: string[] = [];
    walkAreaTree(t.areaTree, (a) => void ((a as Area).backgroundClip && clips.push(`${a.type} ${(a as Area).backgroundClip}`)));
    expect(clips.sort()).toEqual(['block padding-box', 'table-cell content-box']);
  });
});

describe('対応しない値は知らせる', () => {
  it('background-attachment: fixed は、箱に付く背景として描き、未対応として知らせる (scroll・local は知らせない)', async () => {
    const r = await set(page('<div class="b" style="background: url(a.png) fixed"></div><div class="b" style="background: url(a.png); background-attachment: local"></div>'));
    expect(boxOf(r.areaTree).backgroundImage).toMatchObject({ src: 'a.png' });
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual(['未対応の CSS を無視しました: background-attachment: fixed']);
  });
  it('background-clip: text (Backgrounds 4 の値) は未対応として知らせる。html・body の背景の 2 枚目以降も', async () => {
    const r = await set(page('<p style="background-clip: text">x</p>', 'body { background: url(a.png) no-repeat, url(b.png) }'));
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual(['未対応の CSS を無視しました: background-clip: text、background-image: 2 枚目以降 (html・body)']);
  });
});

describe('行内ブロック (inline-block) の角丸・影 (HTM-64)', () => {
  it('border-radius と box-shadow を、ブロックの箱と同じく行内ブロックの箱に付ける (背景・罫線・背景のグラデーションを角丸で切り抜く。CSS Backgrounds 3 §5.3)', async () => {
    const r = await set(page('<p><span style="display: inline-block; width: 60pt; height: 60pt; border-radius: 30pt; box-shadow: 4pt 4pt 0 #888; background: linear-gradient(red, blue)">x</span></p>'));
    const found: Array<{ borderRadius?: unknown; boxShadow?: unknown }> = [];
    const rec = (a: Area) => {
      const b = a as unknown as { borderRadius?: unknown; boxShadow?: unknown; backgroundImage?: unknown };
      if (b.backgroundImage) found.push(b);
      for (const c of childrenOf(a)) rec(c);
    };
    for (const s of r.areaTree.sheets) rec(s.page);
    expect(found).toHaveLength(1);
    expect(found[0].borderRadius).toBeDefined();
    expect(found[0].boxShadow).toBeDefined();
  });
});
