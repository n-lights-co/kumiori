/**
 * ページの箱 (@page) と余白の箱の背景・罫線、入れ子の名前付きページの断片:
 *  - @page の背景画像の位置・大きさ・繰り返しの並べ始めは、ページの箱の padding の領域 (余白と罫線の内側) で決め、塗るのは塗り足しまで
 *    (CSS Paged Media 3 §3.1)。PDF の内容の命令で、画像を置く座標を確かめる
 *  - 位置の em・rem・calc() (CSS Values 4 §5・§10)。読めない値は宣言ごと無効にする
 *  - @page・余白の箱の罫線の太さの初期値は medium (CSS Backgrounds 3 §3.3)。文書の要素の罫線と同じ太さ
 *  - 包む箱を名前付きページの所で分けた断片の、高さの指定 (CSS Break 3 §5.3・§5.4)
 *  - 入れ子の深さの上限の所の名前付きページ (深すぎる入れ子を平らにした所で、空のページを出さない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib';
import { encodePngStored } from '../src/pixels';
import { paintSheet, type Painter } from '../src/paint';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import type { AreaTree, SheetArea } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const MM = 72 / 25.4;
// 画像: 16×16px (12×12pt)
const PNG = encodePngStored({ width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4).fill(200) });
const files = [{ name: 'a.png', data: PNG }];
const W = 120 * MM;
const H = 80 * MM;
const html = (css: string, body = '<p>B</p>') => `<!doctype html><html><head><style>@page { size: 120mm 80mm; ${css} } p { margin: 0 }</style></head><body>${body}</body></html>`;
const set = (css: string, opts: { print?: boolean; style?: 'ah' | 'browser'; body?: string } = {}) =>
  typesetHtml(html(css, opts.body), { loadFont: loadCachedFont, files, ...(opts.print ? { print: true } : {}), ...(opts.style ? { style: opts.style } : {}) });

/** PDF の各ページの内容の命令の、画像を置く変換 (a 0 0 d e f cm の直後に Do) の [e, f, a, d] */
async function pdfImages(r: Awaited<ReturnType<typeof set>>): Promise<Array<Array<[number, number, number, number]>>> {
  const pdf = await PDFDocument.load(await r.toPdf());
  return pdf.getPages().map((pg) => {
    const c = pg.node.Contents();
    const streams = c instanceof PDFArray ? c.asArray().map((x) => pdf.context.lookup(x as PDFRef)) : [c];
    const txt = streams.map((st) => Buffer.from(inflateSync((st as PDFRawStream).contents)).toString('latin1')).join('\n');
    const out: Array<[number, number, number, number]> = [];
    for (const m of txt.matchAll(/([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/KmI[-\w]* Do/g)) out.push([+m[3], +m[4], +m[1], +m[2]]);
    return out;
  });
}

/** PDF の繰り返しの画像 (タイルのパターン) の [並べ始めの x, y (PDF の座標), XStep, YStep] */
async function pdfTiles(r: Awaited<ReturnType<typeof set>>): Promise<Array<[number, number, number, number]>> {
  const pdf = await PDFDocument.load(await r.toPdf());
  const out: Array<[number, number, number, number]> = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    const d = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (!d?.get(PDFName.of('PatternType'))) continue;
    const num = (k: string) => (d.get(PDFName.of(k)) as PDFNumber).asNumber();
    const m = (d.get(PDFName.of('Matrix')) as PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
    out.push([m[4], m[5], num('XStep'), num('YStep')]);
  }
  return out;
}

/** 描く処理の呼び出しを記録する Painter (drawImageTiled は持たない: 1 枚ずつ描かせる) */
function sheetImages(s: SheetArea): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const p = new Proxy({} as Painter, {
    get: (_t, name) =>
      name === 'drawImageTiled' || name === 'group' || name === 'mark'
        ? undefined
        : (...args: unknown[]) => {
            if (name === 'drawImage') {
              const a = args[0] as { width: number; height: number };
              out.push([args[1] as number, args[2] as number, a.width, a.height]);
            }
          },
  });
  paintSheet(s, p);
  return out;
}
const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 2));
};

describe('@page の背景画像の位置の基準は、ページの箱の padding の領域 (CSS Paged Media 3 §3.1)', () => {
  it('位置を書かなければ、余白の内側の左上 (塗り足しの無いとき・あるとき)', async () => {
    const css = 'margin: 15mm; background: url(a.png) no-repeat';
    // PDF の座標は下から: 画像の下端 = 用紙の高さ − 上の余白 − 画像の高さ
    near((await pdfImages(await set(css)))[0][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
    // 塗り足し 3mm とトンボ (--print): 仕上がりの左上は、用紙の端から塗り足しとトンボの領域の分だけ内側
    const r = await set(css, { print: true });
    const s = r.areaTree.sheets[0];
    const sheetH = s.height;
    near((await pdfImages(r))[0][0], [s.trimBox.x + 15 * MM, sheetH - s.trimBox.y - 15 * MM - 12, 12, 12]);
  });
  it('罫線の内側から (padding は基準の領域の中)', async () => {
    const [img] = (await pdfImages(await set('margin: 15mm; border: 3pt solid #000; padding: 5mm; background: url(a.png) no-repeat')))[0];
    near(img, [15 * MM + 3, H - 15 * MM - 3 - 12, 12, 12]);
  });
  it('端からの位置 (right 10px bottom 5px) も、余白の内側の右下から', async () => {
    const [img] = (await pdfImages(await set('margin: 15mm 20mm; background: url(a.png) no-repeat right 10px bottom 5px')))[0];
    near(img, [W - 20 * MM - 7.5 - 12, 15 * MM + 3.75, 12, 12]);
  });
  it('百分率の位置・大きさ・cover は、余白の内側の大きさに対して', async () => {
    const pw = W - 30 * MM;
    const ph = H - 30 * MM;
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat 100% 0')))[0][0], [15 * MM + pw - 12, H - 15 * MM - 12, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat; background-size: 50%')))[0][0], [15 * MM, H - 15 * MM - pw / 2, pw / 2, pw / 2]);
    // cover: 横長の領域を覆う正方形 (幅に合わせる)。位置は初期値の左上
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat; background-size: cover')))[0][0], [15 * MM, H - 15 * MM - pw, pw, pw]);
    expect(pw).toBeGreaterThan(ph);
  });
  it('繰り返す画像は、余白の内側の左上から並べ、塗り足しまで覆う', async () => {
    const r = await set('margin: 15mm; background: url(a.png)', { print: true });
    const s = r.areaTree.sheets[0];
    const tiles = sheetImages(s);
    const ox = s.trimBox.x + 15 * MM;
    const oy = s.trimBox.y + 15 * MM;
    // 基準の左上に 1 枚 (並べ始めの位置)
    expect(tiles.some(([x, y]) => Math.abs(x - ox) < 0.01 && Math.abs(y - oy) < 0.01)).toBe(true);
    // 塗り足しの左上・右下の角まで覆う
    const b = s.bleedBox;
    expect(Math.min(...tiles.map((t) => t[0]))).toBeLessThanOrEqual(b.x + 1e-6);
    expect(Math.min(...tiles.map((t) => t[1]))).toBeLessThanOrEqual(b.y + 1e-6);
    expect(Math.max(...tiles.map((t) => t[0] + t[2]))).toBeGreaterThanOrEqual(b.x + b.width - 1e-6);
    expect(Math.max(...tiles.map((t) => t[1] + t[3]))).toBeGreaterThanOrEqual(b.y + b.height - 1e-6);
  });
  it(':first で余白が違えば、ページごとの余白の内側', async () => {
    const r = await set('margin: 15mm; background: url(a.png) no-repeat } @page :first { margin: 25mm 10mm', { body: '<p>A</p><p style="break-before: page">B</p>' });
    const imgs = await pdfImages(r);
    near(imgs[0][0], [10 * MM, H - 25 * MM - 12, 12, 12]);
    near(imgs[1][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
  });
  it('余白の箱の背景画像は、その箱の padding の領域 (罫線の内側) から', async () => {
    const r = await set('margin: 20mm; @top-left { content: "T"; border: 2pt solid #000; padding: 3pt; background: url(a.png) no-repeat }');
    // 箱の位置 (罫線の箱の左上) を Area Tree から取る
    let box: { x: number; y: number } | undefined;
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (!box && (a as { backgroundImage?: unknown }).backgroundImage && a.type !== 'sheet') box = { x, y };
      for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0), y + a.padding.top + (a.border.top?.width ?? 0));
    };
    for (const p of childrenOf(r.areaTree.sheets[0])) rec(p, 0, 0);
    expect(box).toBeDefined();
    near((await pdfImages(r))[0][0], [box!.x + 2, H - box!.y - 2 - 12, 12, 12]);
  });
});

describe('@page の背景の background-attachment: fixed は、余白を含むページの箱 (仕上がりの用紙) が基準 (CSS Paged Media 3 §3.1)', () => {
  it('一括指定の fixed: 右下・左上は用紙の角 (余白の内側ではない)', async () => {
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat right bottom fixed')))[0][0], [W - 12, 0, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat fixed')))[0][0], [0, H - 12, 12, 12]);
  });
  it('個別の background-attachment: fixed も。塗り足しとトンボがあっても、仕上がりの角が基準', async () => {
    const css = 'margin: 15mm; background: url(a.png) no-repeat; background-attachment: fixed';
    near((await pdfImages(await set(css)))[0][0], [0, H - 12, 12, 12]);
    const r = await set(css, { print: true });
    const s = r.areaTree.sheets[0];
    expect(s.bleed).toBeGreaterThan(0);
    near((await pdfImages(r))[0][0], [s.trimBox.x, s.height - s.trimBox.y - 12, 12, 12]);
    const rb = await set('margin: 15mm; background: url(a.png) no-repeat right bottom; background-attachment: fixed', { print: true });
    const t = rb.areaTree.sheets[0].trimBox;
    near((await pdfImages(rb))[0][0], [t.x + t.width - 12, rb.areaTree.sheets[0].height - t.y - t.height, 12, 12]);
  });
  it('大きさ (cover・百分率) の基準も用紙の全体: fixed の cover は用紙いっぱいに 1 枚で覆う', async () => {
    // 塗り足し・トンボのある用紙で見る (用紙の端に接する画像は、端の外へ少し伸ばして描くため。paint.ts の snapToEdge)
    for (const [size, k] of [['cover', 1], ['50%', 0.5]] as const) {
      const r = await set(`margin: 15mm; background: url(a.png) no-repeat fixed; background-size: ${size}`, { print: true });
      const s = r.areaTree.sheets[0];
      near((await pdfImages(r))[0][0], [s.trimBox.x, s.height - s.trimBox.y - W * k, W * k, W * k]);
    }
  });
  it('一括指定の色を関数 (rgb()・rgba()) で書いても、fixed を読む (重ねの区切りは、括弧の外のカンマだけ。CSS Backgrounds 3 §2.10)', async () => {
    near((await pdfImages(await set('margin: 15mm; background: rgb(255, 255, 255) url(a.png) no-repeat right bottom fixed')))[0][0], [W - 12, 0, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) rgba(0, 0, 0, .1) no-repeat fixed')))[0][0], [0, H - 12, 12, 12]);
    // 2 つめの重ねの fixed は、1 つめの重ねの基準を変えない
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat, url(a.png) no-repeat rgb(1, 2, 3) fixed')))[0][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
  });
  it('scroll (初期値) は、これまでどおり余白の内側', async () => {
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat scroll')))[0][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
  });
  it('個別の指定と一括指定は、後に書いたほうが勝つ (CSS Cascade 4 §6.1。一括指定は、前の個別の指定を初期値に戻す。CSS Backgrounds 3 §2.10)', async () => {
    // 直す前は、個別の指定を先に見て scroll と読んだ
    near((await pdfImages(await set('margin: 15mm; background-attachment: scroll; background: url(a.png) no-repeat fixed')))[0][0], [0, H - 12, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat fixed; background-attachment: scroll')))[0][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
    // 別の @page 規則に書いても同じ (後の規則の一括指定が、前の規則の個別の指定を戻す)
    near((await pdfImages(await set('margin: 15mm; background-attachment: scroll } @page { background: url(a.png) no-repeat fixed')))[0][0], [0, H - 12, 12, 12]);
    // 一括指定の後の個別の繰り返しは効く。前の個別の繰り返しは、一括指定が初期値 (repeat) に戻す
    expect((await set('background: url(a.png); background-repeat: no-repeat')).areaTree.sheets[0].backgroundImage?.repeat).toBe('no-repeat');
    expect((await set('background-repeat: no-repeat; background: url(a.png)')).areaTree.sheets[0].backgroundImage?.repeat).toBeUndefined();
  });
});

describe('@page の背景の background-repeat の repeat-x・repeat-y と 2 値 (CSS Backgrounds 3 §2.4)', () => {
  const rep = async (css: string) => (await set(css)).areaTree.sheets[0].backgroundImage?.repeat;
  it('個別の指定と一括指定の中の repeat-x・repeat-y (直す前は repeat として、縦横に並べた)', async () => {
    expect(await rep('background: url(a.png); background-repeat: repeat-x')).toBe('repeat-x');
    expect(await rep('background: url(a.png); background-repeat: repeat-y')).toBe('repeat-y');
    expect(await rep('background: url(a.png) repeat-x')).toBe('repeat-x');
    expect(await rep('background: url(a.png) repeat-y')).toBe('repeat-y');
    expect(await rep('background-image: url(a.png); background-repeat: REPEAT-X')).toBe('repeat-x');
  });
  it('2 値は横・縦の順', async () => {
    expect(await rep('background: url(a.png); background-repeat: repeat no-repeat')).toBe('repeat-x');
    expect(await rep('background: url(a.png); background-repeat: no-repeat repeat')).toBe('repeat-y');
    expect(await rep('background: url(a.png); background-repeat: no-repeat no-repeat')).toBe('no-repeat');
    expect(await rep('background: url(a.png) space no-repeat')).toBe('repeat-x');
    expect(await rep('background: url(a.png); background-repeat: repeat repeat')).toBeUndefined();
  });
  it('最初の重ねの値を使い、url() の名前の中の語は読まない', async () => {
    expect(await rep('background: url(a.png); background-repeat: repeat-y, no-repeat')).toBe('repeat-y');
    expect(await rep('background: url(no-repeat.png)')).toBeUndefined();
  });
  it('repeat-x は横にだけ、repeat-y は縦にだけ並べる (1 段・1 列)', async () => {
    const x = sheetImages((await set('margin: 15mm; background: url(a.png) repeat-x')).areaTree.sheets[0]);
    expect(x.length).toBeGreaterThan(1);
    expect(new Set(x.map((t) => t[1].toFixed(2))).size).toBe(1);
    const y = sheetImages((await set('margin: 15mm; background: url(a.png) repeat-y')).areaTree.sheets[0]);
    expect(y.length).toBeGreaterThan(1);
    expect(new Set(y.map((t) => t[0].toFixed(2))).size).toBe(1);
  });
});

describe('@page の背景の background-size は、繰り返しを変えない (CSS Backgrounds 3 §2.4: background-repeat の初期値は repeat)', () => {
  it('繰り返しを書かない cover は、余白の内側に合わせた大きさで並べ、余白・塗り足しまで覆う', async () => {
    const r = await set('margin: 15mm; background: url(a.png); background-size: cover', { print: true });
    const s = r.areaTree.sheets[0];
    const pw = W - 30 * MM;
    const tiles = sheetImages(s);
    expect(tiles.length).toBeGreaterThan(1);
    for (const t of tiles) {
      expect(t[2]).toBeCloseTo(pw, 2);
      expect(t[3]).toBeCloseTo(pw, 2);
    }
    const ox = s.trimBox.x + 15 * MM;
    const oy = s.trimBox.y + 15 * MM;
    expect(tiles.some(([x, y]) => Math.abs(x - ox) < 0.01 && Math.abs(y - oy) < 0.01)).toBe(true);
    const b = s.bleedBox;
    expect(Math.min(...tiles.map((t) => t[0]))).toBeLessThanOrEqual(b.x + 1e-6);
    expect(Math.min(...tiles.map((t) => t[1]))).toBeLessThanOrEqual(b.y + 1e-6);
    expect(Math.max(...tiles.map((t) => t[0] + t[2]))).toBeGreaterThanOrEqual(b.x + b.width - 1e-6);
    expect(Math.max(...tiles.map((t) => t[1] + t[3]))).toBeGreaterThanOrEqual(b.y + b.height - 1e-6);
    // PDF ではタイルのパターン 1 つ: 大きさは余白の内側に合わせた大きさ、並べ始めは余白の内側の左上を通る格子の上
    const ph = H - 30 * MM;
    for (const css of ['background: url(a.png); background-size: cover', 'background: url(a.png); background-size: contain', 'background: url(a.png); background-size: 30%']) {
      const k = css.endsWith('cover') ? pw : css.endsWith('contain') ? ph : pw * 0.3;
      const t = await pdfTiles(await set(`margin: 15mm; ${css}`));
      expect(t, css).toHaveLength(1);
      near([t[0][2], t[0][3]], [k, k]);
      const off = (v: number) => Math.min(((v % k) + k) % k, k - (((v % k) + k) % k));
      expect(off(t[0][0] - 15 * MM), css).toBeLessThan(0.01);
      expect(off(t[0][1] - (H - 15 * MM)), css).toBeLessThan(0.01);
    }
  });
  it('長さの大きさも、繰り返しを書かなければ並べる。no-repeat を書けば 1 枚', async () => {
    const rep = sheetImages((await set('margin: 15mm; background: url(a.png); background-size: 40pt 30pt')).areaTree.sheets[0]);
    expect(rep.length).toBeGreaterThan(1);
    for (const t of rep) near(t.slice(2), [40, 30]);
    expect(rep.some(([x, y]) => Math.abs(x - 15 * MM) < 0.01 && Math.abs(y - 15 * MM) < 0.01)).toBe(true);
    const one = sheetImages((await set('margin: 15mm; background: url(a.png) no-repeat; background-size: cover')).areaTree.sheets[0]);
    expect(one).toHaveLength(1);
    const two = sheetImages((await set('margin: 15mm; background: url(a.png); background-repeat: no-repeat; background-size: contain')).areaTree.sheets[0]);
    expect(two).toHaveLength(1);
  });
});

describe('@page・余白の箱の背景の位置の長さ (em・rem・calc())', () => {
  const at = async (pos: string) => (await pdfImages(await set(`margin: 15mm; font-size: 10pt; background: url(a.png) no-repeat ${pos}`)))[0][0];
  it('em は @page の字の大きさ', async () => {
    near(await at('2em 1em'), [15 * MM + 20, H - 15 * MM - 10 - 12, 12, 12]);
  });
  it('百分率を含まない calc() は長さにする', async () => {
    near(await at('calc(10px + 5px) 0'), [15 * MM + 11.25, H - 15 * MM - 12, 12, 12]);
  });
  it('百分率を含む calc() は、百分率の位置に長さを足す (CSS Values 4 §10.11)', async () => {
    // 位置の基準の領域は、余白の内側 (W − 30mm) × (H − 30mm)。画像は 12pt 四方。10px = 7.5pt
    const x50 = 15 * MM + (W - 30 * MM - 12) / 2 - 7.5;
    const y50 = H - 15 * MM - ((H - 30 * MM - 12) / 2 - 7.5) - 12;
    near(await at('calc(50% - 10px) 0'), [x50, H - 15 * MM - 12, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat; background-position: calc(50% - 10px) 0')))[0][0], [x50, H - 15 * MM - 12, 12, 12]);
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat; background-position: 0 calc(50% - 10px)')))[0][0], [15 * MM, y50, 12, 12]);
  });
  it('読めない値 (長さでない語) は、宣言ごと無効 (残りの値を別の軸に当てない)', async () => {
    near((await pdfImages(await set('margin: 15mm; background: url(a.png) no-repeat; background-position: calc(50% - 10deg) 2em')))[0][0], [15 * MM, H - 15 * MM - 12, 12, 12]);
  });
});

describe('@page・余白の箱の罫線の太さの初期値は medium (CSS Backgrounds 3 §3.3)', () => {
  /** ページの箱の罫線の箱 (本文の背面の箱) と、余白の箱の罫線の太さ */
  const widths = async (css: string, style?: 'ah') => {
    const r = await set(css, style ? { style } : {});
    const out: number[] = [];
    const rec = (a: AreaNode) => {
      if (a.border?.top) out.push(a.border.top.width);
      for (const c of childrenOf(a)) rec(c);
    };
    for (const p of childrenOf(r.areaTree.sheets[0])) rec(p);
    return out;
  };
  it('一括指定だけでも、個別の指定を足しても、同じ太さ', async () => {
    expect(await widths('margin: 15mm; border: solid')).toEqual([2.25]);
    expect(await widths('margin: 15mm; border: solid; border-color: red')).toEqual([2.25]);
    expect(await widths('margin: 15mm; @top-center { content: "T"; border: solid }')).toEqual([2.25]);
    expect(await widths('margin: 15mm; @top-center { content: "T"; border: solid; border-color: red }')).toEqual([2.25]);
  });
  it('文書の要素の罫線と同じ太さ (アンテナハウス互換では 3pt)', async () => {
    const r = await set('margin: 15mm; border: solid', { style: 'ah', body: '<p style="border-top: solid">B</p>' });
    const out: number[] = [];
    const rec = (a: AreaNode) => {
      if (a.border?.top) out.push(a.border.top.width);
      for (const c of childrenOf(a)) rec(c);
    };
    for (const p of childrenOf(r.areaTree.sheets[0])) rec(p);
    expect(out).toEqual([3, 3]);
  });
});

/** ページごとの字と、背景のある箱の高さ */
function pages(t: AreaTree) {
  return t.sheets.flatMap((s) =>
    childrenOf(s).map((p) => {
      const lines: string[] = [];
      const bg: number[] = [];
      const rec = (a: AreaNode) => {
        if (a.type === 'line') lines.push('');
        if (a.type === 'glyph') lines[lines.length - 1] += (a as GlyphArea).text;
        if ((a as { backgroundColor?: string }).backgroundColor && a.type === 'block') bg.push(Math.round(a.height * 100) / 100);
        for (const c of childrenOf(a)) rec(c);
      };
      rec(p);
      return { text: lines.filter(Boolean).join(' '), bg };
    }),
  );
}
const named = (body: string, css = '') =>
  typesetHtml(`<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 15mm } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont, style: 'browser' });

describe('包む箱を名前付きページの所で分けた断片の高さ (CSS Break 3 §5.3・§5.4)', () => {
  it('min-height・height は最初の断片だけ', async () => {
    for (const decl of ['min-height: 30mm', 'height: 30mm']) {
      const ps = pages((await named(`<div style="${decl}; background: #eee"><p>front</p><section style="page: ch"><p>chap</p></section></div>`)).areaTree);
      expect(ps.map((p) => p.text)).toEqual(['front', 'chap']);
      expect(ps[0].bg).toEqual([Math.round(30 * MM * 100) / 100]);
      expect(ps[1].bg.length).toBe(1);
      expect(ps[1].bg[0]).toBeLessThan(30 * MM - 1);
    }
  });
  it('aspect-ratio の包む箱は、最初の断片だけを比の大きさにする (後の断片で正方形を取り直さない)', async () => {
    // 幅 90mm の正方形の最初の断片は、本文の領域 (高さ 50mm) を超えて次のページへ続く。名前のページの断片は中身の高さ
    const ps = pages((await named('<div style="aspect-ratio: 1; background: #eee"><p>front</p><section style="page: ch"><p>chap</p></section></div>')).areaTree);
    expect(ps.map((p) => p.text)).toEqual(['front', '', 'chap']);
    expect(ps[2].bg.length).toBe(1);
    expect(ps[2].bg[0]).toBeLessThan(10 * MM);
  });
  it('box-decoration-break: clone の箱は、分けた所にも罫線を付ける (ページの境で分かれるときと同じ)', async () => {
    const r = await named('<div style="border: 4px solid #000; box-decoration-break: clone"><p>front</p><section style="page: ch"><p>chap</p></section></div>');
    const sides: Array<{ top: boolean; bottom: boolean }> = [];
    for (const s of r.areaTree.sheets)
      for (const p of childrenOf(s)) {
        const rec = (a: AreaNode) => {
          if ((a.border?.left?.width ?? 0) > 2) sides.push({ top: !!a.border.top, bottom: !!a.border.bottom });
          for (const c of childrenOf(a)) rec(c);
        };
        rec(p);
      }
    expect(sides).toEqual([
      { top: true, bottom: true },
      { top: true, bottom: true },
    ]);
  });
});

describe('入れ子の深さの上限の所の名前付きページ', () => {
  it('平らにした入れ子では名前を変えず、空のページを出さない', async () => {
    const body = '<div>'.repeat(127) + '<p>a</p><section class="ch"><p>chap</p></section>' + '</div>'.repeat(127);
    const r = await named(body, '.ch { page: ch } @page ch { @top-center { content: "CH" } }');
    expect(r.warnings.some((w) => w.includes('入れ子が深すぎます'))).toBe(true);
    const ps = pages(r.areaTree);
    // 0.3.0 と同じ 1 ページ (名前のページの柱だけの空のページと、柱の無いページの「chap」に分けない)
    expect(ps.map((p) => p.text)).toEqual(['a chap']);
  });
  it('上限より浅い入れ子では、これまでどおり名前のページに出す', async () => {
    const body = '<div>'.repeat(100) + '<p>a</p><section class="ch"><p>chap</p></section>' + '</div>'.repeat(100);
    const ps = pages((await named(body, '.ch { page: ch } @page ch { @top-center { content: "CH" } }')).areaTree);
    expect(ps.map((p) => p.text)).toEqual(['a', 'chap CH']);
  });
});
