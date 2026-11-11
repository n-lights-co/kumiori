/**
 * background-clip の初期値 border-box (OUT-20。CSS Backgrounds 3 §2.2・§2.7・§2.8・§4.3):
 * HTML の背景は、色も画像も border の箱 (罫線の下) まで描く。画像の位置の基準 (background-origin の初期値) は padding の箱のまま。
 * XSL-FO の背景は、これまでどおり (画像は padding の矩形まで。XSL 1.1 §4.9.4)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { paintSheet, type Painter } from '../src/paint';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
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

// a.png は 16×16px (12×12pt)
const png = (w: number, h: number, c: number[]) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, () => c).flat()) });
const files = [{ name: 'a.png', data: png(16, 16, [255, 0, 0, 255]) }];
// 箱: border の箱は (15, 15) から 120×72pt、罫線 6pt、padding 6pt (padding の箱は (21, 21) から 108×60、内容の箱は (27, 27) から 96×48)
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 200pt 200pt; margin: 0 } body { margin: 0; font-size: 8pt } .b { box-sizing: border-box; width: 120pt; height: 72pt; margin: 15pt; border: 6pt dashed #000; padding: 6pt } ${css}</style></head><body>${body}</body></html>`;
const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 2));
};
type Log = Array<[string, ...unknown[]]>;
function paintOf(tree: AreaTree): Log {
  const log: Log = [];
  const p = new Proxy({} as Painter, { get: (_t, name) => (name === 'drawImageTiled' || name === 'group' || name === 'mark' ? undefined : (...args: unknown[]) => void log.push([String(name), ...args])) });
  paintSheet(tree.sheets[0], p);
  return log;
}
/** 背景の画像の描き方: 切り抜きの矩形と、描いた画像の位置 (x・y の並び) */
function imagesOf(log: Log) {
  const out: Array<{ clip: number[]; xs: number[]; ys: number[] }> = [];
  let cur: { clip: number[]; at: Array<[number, number]> } | undefined;
  for (const [name, ...args] of log) {
    if (name === 'clipRect' || name === 'clipPath') {
      const c = args[0] as { x: number; y: number; width: number; height: number } | Array<{ x?: number; y?: number }>;
      const r = Array.isArray(c) ? (() => { const xs = c.filter((s) => s.x !== undefined).map((s) => s.x!); const ys = c.filter((s) => s.y !== undefined).map((s) => s.y!); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; })() : [c.x, c.y, c.width, c.height];
      cur = { clip: r, at: [] };
    } else if (name === 'drawImage' && cur) cur.at.push([args[1] as number, args[2] as number]);
    else if (name === 'restore') {
      if (cur?.at.length) out.push({ clip: cur.clip, xs: [...new Set(cur.at.map((q) => +q[0].toFixed(2)))], ys: [...new Set(cur.at.map((q) => +q[1].toFixed(2)))] });
      cur = undefined;
    }
  }
  return out;
}
const html = async (body: string, css = '') => {
  const r = await typesetHtml(page(body, css), { name: 't.html', loadFont, files });
  return { r, log: paintOf(r.areaTree), layers: imagesOf(paintOf(r.areaTree)) };
};
const bgArea = (t: AreaTree): Area => {
  let hit: Area | undefined;
  walkAreaTree(t, (a) => void (!hit && (a as Area).backgroundImage && (hit = a as Area)));
  return hit!;
};

describe('HTML: background-clip の初期値 border-box', () => {
  it('繰り返す画像は、padding の箱の左上を基準に、border の箱を覆うまで並べ、border の箱で切り抜く (§2.7・§2.8)', async () => {
    const { r, layers } = await html('<div class="b" style="background-image: url(a.png)"></div>');
    expect(bgArea(r.areaTree).backgroundImage).toMatchObject({ src: 'a.png', clip: 'border-box' });
    expect(bgArea(r.areaTree).backgroundImage!.origin).toBeUndefined();
    near(layers[0].clip, [15, 15, 120, 72]);
    // 並びの始まり (位相) は padding の箱の左上 (21, 21)。そこから 12pt ごとに、罫線の下 (15 から 135、15 から 87) も覆う
    expect(layers[0].xs).toEqual([9, 21, 33, 45, 57, 69, 81, 93, 105, 117, 129]);
    expect(layers[0].ys).toEqual([9, 21, 33, 45, 57, 69, 81]);
    expect(r.warnings).toEqual([]);
  });
  it('明示の border-box も同じ (初期値と区別しない)。padding-box・content-box は、その箱で切り抜く', async () => {
    const clipOf = async (st: string) => (await html(`<div class="b" style="background-image: url(a.png); ${st}"></div>`)).layers[0].clip;
    near(await clipOf('background-clip: border-box'), [15, 15, 120, 72]);
    near(await clipOf('background-clip: padding-box'), [21, 21, 108, 60]);
    near(await clipOf('background-clip: content-box'), [27, 27, 96, 48]);
    // 一括指定は、background-clip を初期値に戻す (§2.10)
    near(await clipOf('background-clip: padding-box; background: url(a.png)'), [15, 15, 120, 72]);
  });
  it('no-repeat の画像の位置は変わらない (基準は padding の箱)。切り抜きだけが border の箱になる', async () => {
    const { layers } = await html('<div class="b" style="background: url(a.png) no-repeat"></div><div class="b" style="background: url(a.png) no-repeat right bottom"></div>');
    expect([layers[0].xs, layers[0].ys]).toEqual([[21], [21]]);
    near(layers[0].clip, [15, 15, 120, 72]);
    // 2 つ目の箱は 87pt 下 (高さ 72 + 余白 15)。padding の箱の右下の角に寄せる
    expect([layers[1].xs, layers[1].ys]).toEqual([[21 + 108 - 12], [87 + 21 + 60 - 12]]);
  });
  it('背景の色は border の箱に塗る (§2.2: 破線・点線・二重線・透明の罫線のすき間に見える)。これまでと同じ', async () => {
    for (const style of ['dashed', 'dotted', 'double', 'solid']) {
      const { log } = await html(`<div class="b" style="border-style: ${style}; background-color: #00ff00"></div>`);
      near(log.find((l) => l[0] === 'fillRect' && l[5] === '#00ff00')!.slice(1, 5) as number[], [15, 15, 120, 72]);
    }
    const t = await html('<div class="b" style="border-color: transparent; background-color: #00ff00"></div>');
    near(t.log.find((l) => l[0] === 'fillRect' && l[5] === '#00ff00')!.slice(1, 5) as number[], [15, 15, 120, 72]);
  });
  it('罫線の無い箱・角丸の箱: 罫線が無ければ、描く範囲はこれまでと同じ矩形。角丸は border の箱の角丸で切り抜く (§4.3)', async () => {
    const none = await html('<div class="b" style="border: none; background-image: url(a.png)"></div>');
    near(none.layers[0].clip, [15, 15, 120, 72]);
    expect(none.layers[0].xs[0]).toBe(15);
    const round = await html('<div class="b" style="border-radius: 12pt; background-image: url(a.png)"></div>');
    const cp = round.log.find((l) => l[0] === 'clipPath')![1] as Array<{ op: string; x?: number; y?: number }>;
    // 切り抜きの形は border の箱 (15, 15) から。左上の角の丸みは外側の半径 12pt (最初の点は x = 15 + 12)
    near([Math.min(...cp.filter((s) => s.x !== undefined).map((s) => s.x!)), Math.min(...cp.filter((s) => s.y !== undefined).map((s) => s.y!))], [15, 15]);
    near([cp[0].x!, cp[0].y!], [27, 15]);
  });
  it('回り込み・絶対配置・表のセル・縦書きの箱・::before も、border の箱まで描く', async () => {
    const r = await typesetHtml(
      page(
        '<div class="b" style="float: left; background-image: url(a.png)"></div><div class="b" style="position: absolute; left: 20pt; top: 100pt; background-image: url(a.png)"></div>' +
          '<table><tr><td style="border: 4pt dotted #000; background-image: url(a.png)">c</td></tr></table><div class="b" style="writing-mode: vertical-rl; background-image: url(a.png)">縦</div>' +
          '<p class="q">x</p>',
        '.q { position: relative } .q::before { content: "y"; position: absolute; left: 0; top: 0; width: 20pt; height: 20pt; border: 4pt dashed #000; background-image: url(a.png) }',
      ),
      { name: 't.html', loadFont, files },
    );
    const clips: string[] = [];
    walkAreaTree(r.areaTree, (a) => void ((a as Area).backgroundImage && clips.push(`${a.type} ${(a as Area).backgroundImage!.clip}`)));
    expect(clips.sort()).toEqual(['block border-box', 'block border-box', 'block border-box', 'block border-box', 'table-cell border-box']);
  });
});

describe('HTML: 透明・半透明の罫線 (背景が罫線の下に見える)', () => {
  /** 罫線を描く呼び出し (色が c のもの) と、それを囲む不透明度のグループ */
  function borderCalls(tree: AreaTree) {
    const log: Array<{ name: string; color?: string; group: number[] }> = [];
    const groups: number[] = [];
    const p = new Proxy({} as Painter, {
      get: (_t, name) => {
        if (name === 'drawImageTiled' || name === 'mark') return undefined;
        if (name === 'group')
          return (op: number, draw: () => void) => {
            groups.push(op);
            draw();
            groups.pop();
          };
        return (...args: unknown[]) => void log.push({ name: String(name), color: args.find((x) => typeof x === 'string' && /^#|^transparent$/.test(x)) as string | undefined, group: [...groups] });
      },
    });
    paintSheet(tree.sheets[0], p);
    return log;
  }
  const box = (st: string) => typesetHtml(page(`<div class="b" style="border-style: solid; background-color: #00ff00; ${st}"></div>`), { name: 't.html', loadFont, files });
  it('border-color: transparent の罫線は描かない (場所は取る)。これまでは黒で描いていた', async () => {
    const r = await box('border-color: transparent');
    const calls = borderCalls(r.areaTree);
    // 描くのは背景の色だけ (border の箱。罫線の太さの分も塗る)
    expect(calls.filter((c) => c.color && c.color !== '#ffffff').map((c) => c.color)).toEqual(['#00ff00']);
    let b: Area | undefined;
    walkAreaTree(r.areaTree, (a) => void (!b && (a as Area).backgroundColor === '#00ff00' && (b = a as Area)));
    expect([b!.border.top?.width, b!.border.top?.color, b!.width]).toEqual([6, 'transparent', 120]);
  });
  it('半透明の罫線 (rgba() の border-color) は、その濃さで背景に重ねる (4 辺をまとめて 1 つのグループ。角は濃くならない)', async () => {
    const r = await box('border-color: rgba(255, 0, 0, 0.5)');
    const calls = borderCalls(r.areaTree).filter((c) => c.color === '#ff0000');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // (濃さは 8 ビットで運ぶ: 0.5 は 128/255)
    for (const c of calls) expect(c.group.map((g) => +g.toFixed(2))).toEqual([0.5]);
    // 背景の色は、グループの外 (不透明)
    expect(borderCalls(r.areaTree).find((c) => c.color === '#00ff00')!.group).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('不透明の罫線は、これまでどおり (グループを使わない)。辺ごとに濃さが違えば、濃さごとに重ねる', async () => {
    const plain = borderCalls((await box('border-color: #ff0000')).areaTree).filter((c) => c.color === '#ff0000');
    expect(plain.length).toBeGreaterThanOrEqual(1);
    for (const c of plain) expect(c.group).toEqual([]);
    const mixed = borderCalls((await box('border-color: #ff0000; border-top-color: rgba(0, 0, 255, 0.25)')).areaTree);
    expect(mixed.filter((c) => c.color === '#0000ff').every((c) => c.group.length === 1 && Math.abs(c.group[0] - 0.25) < 0.01)).toBe(true);
    expect(mixed.filter((c) => c.color === '#0000ff').length).toBeGreaterThanOrEqual(1);
    expect(mixed.filter((c) => c.color === '#ff0000').every((c) => c.group.length === 0)).toBe(true);
  });
});

describe('XSL-FO: 背景は padding の矩形まで (XSL 1.1 §4.9.4)', () => {
  it('罫線のある箱の background-image は、padding の箱で切り抜く (clip の欄は付かない)。色も、罫線の下が見える線種 (破線) の箱では padding の箱まで', async () => {
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200pt" page-height="200pt"><fo:region-body margin="15pt"/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block border="6pt dashed #000000" padding="6pt" background-image="url(a.png)" background-color="#00ff00" font-size="8pt">x</fo:block></fo:flow></fo:page-sequence></fo:root>';
    for (const compat of ['spec', 'antenna'] as const) {
      const r = await typesetFo(fo, { name: 't.fo', loadFont, files, compat });
      const a = bgArea(r.areaTree);
      expect(a.backgroundImage!.clip).toBeUndefined();
      const log = paintOf(r.areaTree);
      const layer = imagesOf(log)[0];
      // XSL-FO のブロックは、行の向きの罫線と padding が内容の箱 (15 から) の外へ出る: border の箱の左上は (3, 15)、padding の箱は (9, 21)
      near(layer.clip.slice(0, 2), [9, 21]);
      expect([layer.xs[0], layer.ys[0]]).toEqual([9, 21]);
      // 背景の色も padding の箱 (§4.9.4: The background, if any, is rendered in the padding-rectangle。test/foBackgroundPaddingRect.test.ts)
      const fill = log.find((l) => l[0] === 'fillRect' && l[5] === '#00ff00')!;
      near(fill.slice(1, 3) as number[], [9, 21]);
    }
  });
});
