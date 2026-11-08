/**
 * テスト用ヘルパー: Node 上で fontkit バックエンド (Canvas 不要) のエンジンを組み立てる。
 * フォントは .cache/fonts に無ければ Google Fonts 配信元から取得する (KUMIORI_FONT_DIR で上書き可)。
 */
import { walkAreas } from '../src/areaTree';
import fs from 'node:fs';
import path from 'node:path';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { FONT_SPECS, LATIN_SPECS, MONO_SPECS } from '../src/fontMapping';
import type { Area, LBlockLevel, LDocument, PageMaster, WritingMode, LPageSequence } from '../src/types';

const FONT_URL = 'https://fonts.gstatic.com/s/notoserifjp/v34/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwxOubA.ttf';
export const FAMILY = 'Noto Serif JP';

export async function fontBuffer(): Promise<ArrayBuffer> {
  const dir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
  const file = path.join(dir, 'NotoSerifJP-Regular.ttf');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`font download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * 既定の書体 (src/fontMapping.ts の FONT_SPECS・LATIN_SPECS・MONO_SPECS) のファイルを読む。
 * .cache/fonts (KUMIORI_FONT_DIR で上書き可) に無ければ配信元から取得して置く。
 * 他のテストのファイルが同時に同じ書体を取りに行っても、書きかけのファイルを読まないように、一時ファイルに書いてから名前を変える。
 */
export async function defaultFontBuffer(name: string): Promise<ArrayBuffer> {
  const dir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    const spec = [...FONT_SPECS, ...LATIN_SPECS, ...MONO_SPECS].find((s) => s.urls.some((u) => !/^https:/.test(u) && path.basename(u) === name));
    const url = spec?.urls.find((u) => /^https:/.test(u));
    if (!url) throw new Error(`not a default font: ${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font download failed: ${res.status} ${url}`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, file);
  }
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export async function makeEngine() {
  const fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  const measurer = new Measurer(fonts, 'fontkit');
  return { fonts, measurer, engine: new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY }) };
}

export const pt = (mm: number) => (mm * 72) / 25.4;

/** 100mm 角、余白 10mm → 本文領域 80mm (226.77pt) */
export const master = (over: Partial<PageMaster> = {}): PageMaster => ({
  width: 100,
  height: 100,
  bleed: 3,
  trimMarks: false,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  ...over,
});

export function doc(children: LBlockLevel[], wm: WritingMode = 'horizontal-tb', seq: Partial<LPageSequence> = {}): LDocument {
  return {
    type: 'document',
    sequences: [
      { type: 'page-sequence', master: master(), flow: { type: 'flow', writingMode: wm, fontSize: 10, children }, ...seq },
    ],
  };
}

export const lines = (n: number, prefix = '行') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n');

/** Area Tree を深さ優先・前順にたどる (子の欄は areaTree.ts の childrenOf で決める) */
export function walk(a: Area, f: (a: Area) => void) {
  walkAreas(a, (x) => void f(x as Area));
}

/** 数式の書体 (STIX Two Math)。.cache/fonts に無ければ Google Fonts 配信元から取得する */
export async function mathFontBuffer(): Promise<ArrayBuffer> {
  const dir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
  const file = path.join(dir, 'STIXTwoMath-Regular.ttf');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch('https://fonts.gstatic.com/s/stixtwomath/v12/pONg1hwwL_6M9EkZySr_yteUi1o.ttf');
    if (!res.ok) throw new Error(`font download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
