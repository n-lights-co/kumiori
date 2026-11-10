/**
 * 直交する書字方向の箱 (横書きの中の縦書き・縦書きの中の横書き。CSS Writing Modes 3 §7.3) の大きさと位置:
 *  - 行の向きの大きさ (縦書きの箱なら高さ) の指定があれば、それで折り返す。無ければ fit-content (§7.3.2):
 *    min(中身の長さ, max(最小の長さ, 使える長さ))。使える長さは、包含ブロックのその向きの大きさ (決まっていれば)、
 *    決まっていなければページの残り (本文の流れ)・版面の大きさ (セル・箱の中。§7.3.1 の代わりの大きさ)
 *  - 親の幅の計算 (float・表のセル・flex の項目の shrink-to-fit) には、直交する子の、組んだ後の block の大きさを使う (§7.3 の Note)
 *  - float (LAY-15)・flex の項目 (LAY-16)・表のセル・inline-block・絶対配置・ページをまたぐ場合
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
});

type Box = { type: string; wm?: string; text?: string; x: number; y: number; w: number; h: number; bg?: string; page: number };
type RawArea = { type?: string; x?: number; y?: number; width?: number; height?: number; text?: string; backgroundColor?: string; writingMode?: string; children?: RawArea[] };

/** 400pt × 300pt のページ (余白なし)、字は 10pt・行の送り 15pt。組んだ箱を、本文の領域の左上からの位置で返す (テストでは祖先に枠・内側の余白を付けない) */
async function lay(body: string, css = '', page = '@page { size: 400pt 300pt; margin: 0 }') {
  const all = `${page} html { font-family: 'Noto Serif JP' } body { margin: 0; font-size: 10pt; line-height: 15pt } p { margin: 0; text-indent: 0; text-align: left } ${css}`;
  const r = await typesetHtml(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${all}</style></head><body>${body}</body></html>`, { style: 'browser', loadFont });
  const out: Box[] = [];
  r.areaTree.sheets.forEach((sh, k) => {
    const walk = (a: RawArea, ox: number, oy: number) => {
      const x = ox + (a.x ?? 0);
      const y = oy + (a.y ?? 0);
      if (a.type) out.push({ type: a.type, wm: a.writingMode, text: a.text, x, y, w: a.width ?? 0, h: a.height ?? 0, bg: a.backgroundColor, page: k + 1 });
      for (const c of a.children ?? []) walk(c, x, y);
    };
    const rb = sh.page.regionBody as unknown as RawArea;
    for (const c of rb.children ?? []) walk(c, 0, 0);
    // 絶対配置の箱はページの原点から (余白なしのページなので、本文の領域の原点と同じ)
    for (const c of (sh.page.absoluteAreas ?? []) as unknown as RawArea[]) walk(c, 0, 0);
  });
  const bg = (color: string) => out.find((b) => b.bg === color)!;
  /** 字 ch を含む行 (最初のもの) */
  const glyphs = (ch: string) => out.filter((b) => b.type === 'glyph' && b.text === ch);
  return { boxes: out, bg, glyphs, pages: r.areaTree.sheets.length, warnings: r.areaTree.warnings };
}

const RED = 'background: #ff0000';
const BLUE = 'background: #0000ff';
const a = (n: number) => 'あ'.repeat(n);
const size = (b: Box) => [Math.round(b.w * 10) / 10, Math.round(b.h * 10) / 10];
const at = (b: Box) => [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10];

describe('横書きの中の縦書きの float (LAY-15。Writing Modes 3 §7.3・CSS 2.1 §10.3.5)', () => {
  it('高さを指定した float は、長い文をその高さで折り返し、幅は行の数だけ。右端に置き、本文は左に回り込む', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; height: 100pt; float: right; margin-left: 10pt; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    const f = r.bg('#ff0000');
    // 100pt に 10 字ずつ、3 行 (15pt × 3)
    expect(size(f)).toEqual([45, 100]);
    expect(at(f)).toEqual([355, 0]);
    // 字は箱の中にある (上から 100pt まで、箱の左右の内)
    for (const g of r.glyphs('あ')) {
      expect(g.y + g.h).toBeLessThanOrEqual(100.01);
      expect(g.x).toBeGreaterThanOrEqual(355 - 0.01);
    }
    // 本文の字は float とその左の余白 (10pt) を避ける。float の下 (100pt より下) の行は全幅
    const body = r.glyphs('い');
    expect(body).toHaveLength(60);
    for (const g of body.filter((b) => b.y < 100)) expect(g.x + g.w).toBeLessThanOrEqual(345.01);
    expect(Math.max(...body.filter((b) => b.y < 100).map((g) => g.x + g.w))).toBeGreaterThan(330);
    expect(r.warnings.join()).toBe('');
  });
  it('左の float (float: left) も同じ大きさで、左端に置く', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; height: 100pt; float: left; margin-right: 10pt; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([0, 0]);
    expect(Math.min(...r.glyphs('い').filter((b) => b.y < 100).map((g) => g.x))).toBeCloseTo(55, 1);
  });
  it('文が短く 1 行に収まる float は、1 行の幅', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; height: 100pt; float: right; ${RED}">${a(5)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([15, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([385, 0]);
  });
  it('高さの指定の無い float は fit-content: 短ければ中身の長さ、長ければページの残りで折り返す (§7.3.2)', async () => {
    const s = await lay(`<div style="writing-mode: vertical-rl; float: right; ${RED}">${a(5)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(s.bg('#ff0000'))).toEqual([15, 50]);
    expect(at(s.bg('#ff0000'))).toEqual([385, 0]);
    const l = await lay(`<div style="writing-mode: vertical-rl; float: right; ${RED}">${a(50)}</div><p>${'い'.repeat(60)}</p>`);
    // 300pt に 30 字ずつ、2 行
    expect(size(l.bg('#ff0000'))).toEqual([30, 300]);
    expect(at(l.bg('#ff0000'))).toEqual([370, 0]);
    expect(l.pages).toBe(1);
  });
  it('max-height は行の向きの大きさの上限 (§7.2: 高さの指定は物理の高さ。縦書きの箱では行の長さ)', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; max-height: 100pt; float: right; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
  });
  it('min-height は、高さの指定の無い float の行の長さの下限', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; min-height: 100pt; float: right; ${RED}">${a(5)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([15, 100]);
  });
  it('幅と高さを指定した float は、その大きさ。中の行は高さで折り返す', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; width: 60pt; height: 100pt; float: right; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([60, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([340, 0]);
    // 最初の行は箱の右端 (block-start)。3 行目は 30pt 左
    const xs = [...new Set(r.glyphs('あ').map((g) => Math.round(g.x)))].sort((p, q) => q - p);
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeGreaterThan(380);
    for (const g of r.glyphs('あ')) expect(g.y + g.h).toBeLessThanOrEqual(100.01);
  });
  it('幅だけを指定した float: 幅は指定のまま、高さは fit-content (中身の長さ)', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; width: 60pt; float: right; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([60, 250]);
  });
  it('枠と内側の余白のある float: 高さは内容の高さ (content-box)、幅は行の数 + 左右の枠・余白', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; height: 100pt; float: right; padding: 4pt 6pt; border: 3pt solid #000; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45 + 12 + 6, 100 + 8 + 6]);
    expect(at(r.bg('#ff0000'))).toEqual([400 - 63, 0]);
  });
  it('段落の後ろの float は、その位置から置く', async () => {
    const r = await lay(`<p>前</p><div style="writing-mode: vertical-rl; height: 100pt; float: right; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([355, 15]);
  });
});

describe('縦書きの中の横書きの float (逆向き)', () => {
  const V = 'html { writing-mode: vertical-rl }';
  it('幅を指定した float は、長い文をその幅で折り返し、高さは行の数だけ。float: left は行の頭 (上)', async () => {
    const r = await lay(`<div style="writing-mode: horizontal-tb; width: 100pt; float: left; margin-bottom: 10pt; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`, V);
    expect(size(r.bg('#ff0000'))).toEqual([100, 45]);
    expect(at(r.bg('#ff0000'))).toEqual([300, 0]);
    // 本文は float とその下の余白を避ける
    for (const g of r.glyphs('い').filter((b) => b.x >= 300)) expect(g.y).toBeGreaterThanOrEqual(55 - 0.01);
  });
  it('短い文の float は 1 行の高さ。幅の指定が無ければ fit-content (中身の長さ)', async () => {
    const s = await lay(`<div style="writing-mode: horizontal-tb; width: 100pt; float: left; ${RED}">${a(5)}</div><p>${'い'.repeat(60)}</p>`, V);
    expect(size(s.bg('#ff0000'))).toEqual([100, 15]);
    const n = await lay(`<div style="writing-mode: horizontal-tb; float: left; ${RED}">${a(25)}</div><p>${'い'.repeat(60)}</p>`, V);
    expect(size(n.bg('#ff0000'))).toEqual([250, 15]);
    expect(at(n.bg('#ff0000'))).toEqual([150, 0]);
  });
});

describe('float でない直交の箱', () => {
  it('高さを指定した縦書きの箱は、その高さで折り返し、左端に置く。後ろの段落はその下', async () => {
    const r = await lay(`<p>前</p><div style="writing-mode: vertical-rl; height: 100pt; ${RED}">${a(25)}</div><p>い</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([0, 15]);
    expect(r.glyphs('い')[0].y).toBeGreaterThanOrEqual(115);
  });
  it('幅と高さを指定した縦書きの箱は、その大きさ。幅だけなら、高さは中身の長さ (ページの残りまで)', async () => {
    const r = await lay(`<p>前</p><div style="writing-mode: vertical-rl; width: 60pt; height: 100pt; ${RED}">${a(25)}</div><p>い</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([60, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([0, 15]);
    const w = await lay(`<p>前</p><div style="writing-mode: vertical-rl; width: 60pt; ${RED}">${a(25)}</div><p>い</p>`);
    expect(size(w.bg('#ff0000'))).toEqual([60, 250]);
  });
  it('高さの指定の無い縦書きの箱は fit-content: 短ければ中身の長さ、長ければページの残り', async () => {
    const s = await lay(`<p>前</p><div style="writing-mode: vertical-rl; ${RED}">${a(5)}</div><p>い</p>`);
    expect(size(s.bg('#ff0000'))).toEqual([15, 50]);
    expect(at(s.bg('#ff0000'))).toEqual([0, 15]);
    const l = await lay(`<p>前</p><div style="writing-mode: vertical-rl; ${RED}">${a(50)}</div><p>い</p>`);
    // ページの残り 285pt に 28 字ずつ、2 行
    expect(size(l.bg('#ff0000'))).toEqual([30, 285]);
    expect(l.glyphs('あ')).toHaveLength(50);
  });
  it('高さの決まったブロックの中の縦書きの箱は、そのブロックの高さで折り返す (§7.3.1: 包含ブロックの大きさが使える長さ)', async () => {
    const r = await lay(`<p>前</p><div style="height: 100pt; ${BLUE}"><div style="writing-mode: vertical-rl; ${RED}">${a(25)}</div></div><p>い</p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([0, 15]);
    // 後ろの段落は、ブロックの下 (115pt) の行 (行の送り 15pt の中に 10pt の字)
    expect(r.glyphs('い')[0].y).toBeGreaterThanOrEqual(115);
    expect(r.glyphs('い')[0].y).toBeLessThan(120);
  });
  it('min-height・max-height は、高さの指定の無い縦書きの箱の行の長さの下限・上限', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl; min-height: 100pt; ${RED}">${a(5)}</div><div style="writing-mode: vertical-rl; max-height: 100pt; ${BLUE}">${a(25)}</div>`);
    expect(size(r.bg('#ff0000'))).toEqual([15, 100]);
    expect(size(r.bg('#0000ff'))).toEqual([45, 100]);
  });
  it('ページの幅を超える行の数の縦書きの箱は、次のページへ続く', async () => {
    const r = await lay(`<div style="writing-mode: vertical-rl">${a(2000)}</div>`);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.glyphs('あ')).toHaveLength(2000);
    for (const g of r.glyphs('あ')) {
      expect(g.x).toBeGreaterThanOrEqual(-0.01);
      expect(g.x + g.w).toBeLessThanOrEqual(400.01);
      expect(g.y + g.h).toBeLessThanOrEqual(300.01);
    }
  });
  it('縦書きの文書の中の横書きの箱: 幅の指定で折り返す。無ければ中身の長さ', async () => {
    const V = 'html { writing-mode: vertical-rl }';
    const r = await lay(`<p>前</p><div style="writing-mode: horizontal-tb; width: 100pt; ${RED}">${a(25)}</div><p>い</p>`, V);
    expect(size(r.bg('#ff0000'))).toEqual([100, 45]);
    expect(at(r.bg('#ff0000'))).toEqual([400 - 15 - 100, 0]);
    const n = await lay(`<p>前</p><div style="writing-mode: horizontal-tb; ${RED}">${a(25)}</div><p>い</p>`, V);
    expect(size(n.bg('#ff0000'))).toEqual([250, 15]);
  });
});

describe('表のセル・inline-block・絶対配置の中の縦書きの箱', () => {
  it('セルの中の、高さを指定した縦書きの箱。セルの幅は、箱の行の数の幅 (§7.3 の Note: 直交する子の block の大きさが親の幅の計算に入る)', async () => {
    const r = await lay(
      `<table style="border-collapse: collapse"><tr><td style="padding: 0; ${BLUE}"><div style="writing-mode: vertical-rl; height: 100pt; ${RED}">${a(25)}</div></td><td style="padding: 0; background: #00ff00"><div style="writing-mode: vertical-rl; height: 100pt">${a(5)}</div></td><td style="padding: 0; background: #ffff00"><div style="writing-mode: vertical-rl">${a(4)}</div></td></tr></table>`,
    );
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(r.bg('#0000ff').w).toBeCloseTo(45, 0);
    expect(r.bg('#00ff00').w).toBeCloseTo(15, 0);
    expect(r.bg('#ffff00').w).toBeCloseTo(15, 0);
    // 高さの指定の無い箱の字は、1 行に並ぶ
    expect(new Set(r.glyphs('あ').filter((g) => g.x >= r.bg('#ffff00').x - 0.01).map((g) => Math.round(g.x))).size).toBe(1);
  });
  it('inline-block の縦書きの箱: 高さの指定で折り返す。無ければ中身の長さ', async () => {
    const r = await lay(`<p>前<span style="display: inline-block; writing-mode: vertical-rl; height: 100pt; ${RED}">${a(25)}</span>後<span style="display: inline-block; writing-mode: vertical-rl; ${BLUE}">${a(4)}</span></p>`);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(size(r.bg('#0000ff'))).toEqual([15, 40]);
  });
  it('絶対配置の縦書きの箱: 高さの指定で折り返す。無ければ fit-content (中身の長さ。ページの下端までは伸ばさない)', async () => {
    const r = await lay(
      `<div style="position: absolute; right: 20pt; top: 30pt; writing-mode: vertical-rl; height: 100pt; ${RED}">${a(25)}</div><div style="position: absolute; left: 20pt; top: 30pt; writing-mode: vertical-rl; ${BLUE}">${a(4)}</div>`,
    );
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([400 - 20 - 45, 30]);
    expect(size(r.bg('#0000ff'))).toEqual([15, 40]);
    expect(at(r.bg('#0000ff'))).toEqual([20, 30]);
  });
});

describe('flex の中の縦書きの項目 (LAY-16。Flexbox 1 §9.2・Writing Modes 3 §7.3)', () => {
  const ROW = '.row { display: flex }';
  it('幅と高さを指定した項目は、その大きさ (中身の行の数の幅に縮まない)。次の項目はその右', async () => {
    const r = await lay(`<div class="row"><div style="writing-mode: vertical-rl; width: 120pt; height: 100pt; ${RED}">${a(25)}</div><div style="width: 80pt; ${BLUE}">い</div></div>`, ROW);
    expect(size(r.bg('#ff0000'))).toEqual([120, 100]);
    expect(at(r.bg('#ff0000'))).toEqual([0, 0]);
    expect(r.bg('#0000ff').x).toBeCloseTo(120, 1);
    // 最初の行は箱の右端 (block-start)
    expect(Math.max(...r.glyphs('あ').map((g) => g.x + g.w))).toBeGreaterThan(115);
    expect(Math.max(...r.glyphs('あ').map((g) => g.x + g.w))).toBeLessThanOrEqual(120.01);
  });
  it('高さだけを指定した項目の幅は、中身の行の数の幅 (max-content。§9.2 の 3)。項目は左から詰めて並ぶ', async () => {
    const r = await lay(
      `<div class="row" style="gap: 10pt"><div style="writing-mode: vertical-rl; height: 100pt; ${RED}">${a(25)}</div><div style="writing-mode: vertical-rl; height: 100pt; ${BLUE}">${a(5)}</div><div style="writing-mode: vertical-rl; height: 100pt; background: #00ff00">${a(1)}</div></div>`,
      ROW,
    );
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(size(r.bg('#0000ff'))).toEqual([15, 100]);
    expect(size(r.bg('#00ff00'))).toEqual([15, 100]);
    expect(at(r.bg('#0000ff'))).toEqual([55, 0]);
    expect(at(r.bg('#00ff00'))).toEqual([80, 0]);
  });
  it('幅だけを指定した項目: 幅は指定のまま、行は中身の長さ (高さの指定の無い項目は fit-content)', async () => {
    const r = await lay(`<div class="row"><div style="writing-mode: vertical-rl; width: 120pt; ${RED}">${a(25)}</div><div style="${BLUE}">い</div></div>`, ROW);
    expect(size(r.bg('#ff0000'))).toEqual([120, 250]);
    expect(r.bg('#0000ff').x).toBeCloseTo(120, 1);
    expect(new Set(r.glyphs('あ').map((g) => Math.round(g.x))).size).toBe(1);
  });
  it('flex: 1 の項目は、容器の幅を分け合う (幅は中身の行の数によらない)', async () => {
    const r = await lay(`<div class="row"><div style="writing-mode: vertical-rl; height: 100pt; flex: 1; ${RED}">${a(25)}</div><div style="writing-mode: vertical-rl; height: 100pt; flex: 1; ${BLUE}">${a(5)}</div></div>`, ROW);
    expect(size(r.bg('#ff0000'))).toEqual([200, 100]);
    expect(size(r.bg('#0000ff'))).toEqual([200, 100]);
    expect(at(r.bg('#0000ff'))).toEqual([200, 0]);
  });
  it('高さの決まった容器の中の、高さの指定の無い項目は、容器の高さで折り返す (§9.8: 1 行の容器の、伸ばす項目の交差軸の大きさは決まっている)', async () => {
    const r = await lay(`<div class="row" style="height: 100pt"><div style="writing-mode: vertical-rl; ${RED}">${a(25)}</div><div style="${BLUE}">い</div></div>`, ROW);
    expect(size(r.bg('#ff0000'))).toEqual([45, 100]);
    expect(r.bg('#0000ff').x).toBeCloseTo(45, 1);
  });
  it('折り返す容器 (flex-wrap) は、高さの決まった項目の行の数の幅で行に分ける', async () => {
    // 項目は 45pt の幅 (3 行)。100pt の容器には 2 つまで入る
    const item = (c: string) => `<div style="writing-mode: vertical-rl; height: 100pt; background: ${c}">${a(25)}</div>`;
    const r = await lay(`<div class="row" style="flex-wrap: wrap; width: 100pt">${item('#ff0000')}${item('#0000ff')}${item('#00ff00')}</div>`, ROW);
    expect(at(r.bg('#ff0000'))).toEqual([0, 0]);
    expect(at(r.bg('#0000ff'))).toEqual([45, 0]);
    expect(at(r.bg('#00ff00'))).toEqual([0, 100]);
  });
  it('高さの指定の無い項目は、同じ行の高い項目の高さまで伸びる (align-items: stretch)', async () => {
    const r = await lay(`<div class="row"><div style="writing-mode: vertical-rl; ${RED}">${a(5)}</div><div style="height: 120pt; ${BLUE}">い</div></div>`, ROW);
    expect(size(r.bg('#ff0000'))).toEqual([15, 120]);
    expect(r.bg('#0000ff').x).toBeCloseTo(15, 1);
  });
  it('縦書きの文書の flex の中の横書きの項目 (逆向き): 幅と高さの指定のとおり', async () => {
    const r = await lay(`<div class="row"><div style="writing-mode: horizontal-tb; width: 100pt; height: 80pt; ${RED}">${a(25)}</div><div style="${BLUE}">い</div></div>`, `html { writing-mode: vertical-rl } ${ROW}`);
    expect(size(r.bg('#ff0000'))).toEqual([100, 80]);
    expect(at(r.bg('#ff0000'))).toEqual([300, 0]);
    expect(r.bg('#0000ff').y).toBeCloseTo(80, 1);
  });
});
