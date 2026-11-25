/**
 * renderPage は画像をデコードするのを待ってから描画するので、同じ canvas に続けて呼んだとき、描画を呼んだ順にすることを確かめる
 * (ブラウザーの API (createImageBitmap・OffscreenCanvas・Path2D・ImageData) はモックする)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, createTypesetter, type FontSpec } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

class FakeBitmap {
  closed = 0;
  drawnAfterClose = 0;
  constructor(public width: number, public height: number, public tag: string) {}
  close() {
    this.closed++;
    this.width = 0;
    this.height = 0;
  }
}
const bitmaps: FakeBitmap[] = [];
/** decode を待たせる鍵 (tag) */
const gates = new Map<string, Promise<void>>();
const drawLog: string[] = [];

function fakeCtx(canvas: { tag: string }) {
  const target: Record<string, unknown> = {
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: () => ({ width: 1 }),
    drawImage: (el: unknown) => {
      if (el instanceof FakeBitmap) {
        if (el.closed) el.drawnAfterClose++;
        drawLog.push(`${canvas.tag}:${el.tag}`);
      }
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[a-z]/.test(k) ? () => undefined : undefined),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
}
class FakeCanvas {
  width = 0;
  height = 0;
  tag = 'c';
  ctx = fakeCtx(this);
  getContext() {
    return this.ctx;
  }
}

const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
  for (const k of ['createImageBitmap', 'OffscreenCanvas', 'Path2D', 'ImageData']) saved[k] = g[k];
  g.createImageBitmap = async (blob: Blob) => {
    const b = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(b.buffer);
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    const gate = gates.get(`${w}x${h}`);
    if (gate) await gate;
    const bm = new FakeBitmap(w, h, `${w}x${h}`);
    bitmaps.push(bm);
    return bm;
  };
  g.OffscreenCanvas = FakeCanvas;
  g.Path2D = class {};
  g.ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  };
}, 300_000);
afterAll(() => {
  for (const k of Object.keys(saved)) g[k] = saved[k];
});

const png = (w: number, h: number) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(100) });
const html = (srcs: string[]) => srcs.map((s, i) => `<p style="${i ? 'break-before:page' : ''}"><img src="${s}" style="width:20pt"></p>`).join('');

describe('renderPage の描画の順', () => {
  it('同じ canvas に await せずに続けて呼ぶと、デコードの終わる順によらず、呼んだ順に描画する (後に呼んだページが残る)', async () => {
    const t = await createTypesetter({ loadFont });
    const r = await t.typeset(html(['a.png', 'b.png']), { files: [{ name: 'a.png', data: png(102, 50) }, { name: 'b.png', data: png(103, 50) }] });
    // 0 ページ目の画像のデコードを、1 ページ目のデコードの後まで待たせる
    let open!: () => void;
    gates.set('102x50', new Promise((ok) => (open = ok)));
    const canvas = new FakeCanvas();
    canvas.tag = 'C';
    drawLog.length = 0;
    const p0 = r.renderPage(canvas as unknown as OffscreenCanvas, 0);
    const p1 = r.renderPage(canvas as unknown as OffscreenCanvas, 1);
    await new Promise((ok) => setTimeout(ok, 50));
    open();
    await Promise.all([p0, p1]);
    gates.delete('102x50');
    expect(drawLog).toEqual(['C:102x50', 'C:103x50']);
    // 別の canvas は待たない: 待たせた画像のある描画の間にも、別の canvas に描画する
    gates.set('102x50', new Promise((ok) => (open = ok)));
    drawLog.length = 0;
    await t.releaseCaches({ images: true });
    const other = new FakeCanvas();
    other.tag = 'D';
    const q0 = r.renderPage(canvas as unknown as OffscreenCanvas, 0);
    await r.renderPage(other as unknown as OffscreenCanvas, 1);
    expect(drawLog).toEqual(['D:103x50']);
    open();
    await q0;
    gates.delete('102x50');
    expect(drawLog).toEqual(['D:103x50', 'C:102x50']);
    // 描画が失敗しても、同じ canvas の次の描画は止まらない
    await expect(r.renderPage(canvas as unknown as OffscreenCanvas, 5)).rejects.toThrow(RangeError);
    drawLog.length = 0;
    await r.renderPage(canvas as unknown as OffscreenCanvas, 1);
    expect(drawLog).toEqual(['C:103x50']);
  });
});
