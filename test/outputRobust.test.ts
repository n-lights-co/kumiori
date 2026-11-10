/**
 * 出力・資源の読み込みで、1 つの読めないもののために全体が落ちない (全体レビューの OUT-03・04・08):
 *  - OUT-03 renderPage (Canvas の輪郭描画) は、読めない字形 (Arimo の U+00A0) を飛ばしてページの残りを描く
 *  - OUT-04 壊れた data URI・@font-face の不正な % の URL は、読めない画像・書体として続ける
 *  - OUT-08 CLI は、入力のディレクトリの下の読めないディレクトリを飛ばす
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import { AssetStore } from '../src/assets';
import { listFiles } from '../src/cli';
import { defaultFontBuffer } from './helpers';

/** 書体を手元の置き場から読む (無ければ helpers が配信元から取って置く) */
const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const noNet = { loadFont, fetchImages: false, fetchStyles: false } as const;

describe('OUT-03: renderPage の読めない字形', () => {
  const had = 'Path2D' in globalThis;
  beforeAll(() => {
    if (!had) (globalThis as Record<string, unknown>).Path2D = class { constructor(public d: string) {} };
  });
  afterAll(() => {
    if (!had) delete (globalThis as Record<string, unknown>).Path2D;
  });
  it('Arimo の U+00A0 のあるページを描ける (ほかの字は描く)', async () => {
    const r = await typeset('<html><body><pre style="font-family:sans-serif">a&nbsp;b</pre></body></html>', noNet);
    const fills: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === 'fill' ? (p?: { d: string }) => void (p && fills.push(p.d)) : typeof k === 'string' ? () => {} : undefined),
      set: () => true,
    });
    const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      r.renderPage(canvas, 0);
    } finally {
      warn.mockRestore();
    }
    // a・b の輪郭 (中身のあるパス) を描いている
    expect(fills.filter((d) => d.length > 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe('OUT-04: 壊れた data URI・@font-face の URL', () => {
  it('addDataUri は、壊れた base64・不正な % の並びを読めない画像にする (例外にしない)', async () => {
    const s = new AssetStore();
    expect(await s.addDataUri('data:image/png;base64,@@@@')).toBeUndefined();
    // 16 進の続かない % は、そのままの字として残す (RFC 2397 の中身はバイトの並び。OUT-07)。例外にはならず、中身は SVG として読めないもの
    await expect(s.addDataUri('data:image/svg+xml,%E0%A4%A')).resolves.not.toThrow();
  });
  it('壊れた data URI の画像のある文書を組める', async () => {
    for (const src of ['data:image/png;base64,@@@@', 'data:image/svg+xml,%E0%A4%A']) {
      const r = await typeset(`<html><body><p>abc<img src="${src}"></p></body></html>`, noNet);
      expect(r.pageCount).toBe(1);
      // 壊れた base64 は、ほかの読めない画像と同じ警告。不正な % の方は、中身が SVG でない画像として扱う (例外にならなければよい)
      if (/;base64,/.test(src)) expect(r.warnings.some((w) => w.includes(src.slice(0, 20)))).toBe(true);
    }
  });
  it('@font-face の url() に不正な % の並びがあっても組める', async () => {
    const r = await typeset('<html><head><style>@font-face{font-family:X;src:url("a%zz.woff2")} p{font-family:X}</style></head><body><p>abc</p></body></html>', noNet);
    expect(r.pageCount).toBe(1);
  });
});

describe('OUT-08: CLI の入力のディレクトリの下の読めないディレクトリ', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-list-'));
    for (const d of ['img', 'locked', '.git', 'node_modules']) fs.mkdirSync(path.join(dir, d));
    for (const f of ['a.html', 'img/a.png', 'locked/b.png', '.git/c', 'node_modules/d.css']) fs.writeFileSync(path.join(dir, f), '');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rel = (files: string[]) => files.map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
  it('読めるディレクトリは今までどおり (node_modules と . で始まるものは見ない)', () => {
    expect(rel(listFiles(dir))).toEqual(['a.html', 'img/a.png', 'locked/b.png']);
  });
  it('読めないディレクトリ (EACCES) は飛ばし、ほかは読む', () => {
    // 権限のテストは、root で動かすと効かないので、読み取りの関数を差し替えて確かめる
    const readdir = (d: string) => {
      if (path.basename(d) === 'locked') throw Object.assign(new Error(`EACCES: permission denied, scandir '${d}'`), { code: 'EACCES' });
      return fs.readdirSync(d, { withFileTypes: true });
    };
    expect(rel(listFiles(dir, readdir))).toEqual(['a.html', 'img/a.png']);
  });
  it('入力のディレクトリそのものが読めなければ、今までどおり誤り', () => {
    expect(() => listFiles(path.join(dir, 'no-such-dir'))).toThrow(/ENOENT/);
  });
});
