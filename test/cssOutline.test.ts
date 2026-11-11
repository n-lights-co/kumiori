/**
 * 輪郭線 (CSS の outline・outline-width・outline-style・outline-color・outline-offset)。CSS UI 4 §3
 * (https://www.w3.org/TR/css-ui-4/#outline-props 、2026-11-11 取得の 2026-01-20 版):
 *  - §3: 輪郭線は場所を取らない (ほかの箱を動かさない)
 *  - §3.1: 一括指定は太さ・線種・色 (outline-offset は含まない)。auto だけなら線種と色の両方が auto。行で分かれた要素は、断片を閉じた線で囲む。
 *    罫線の端に沿う所では、border-radius の曲線に沿う
 *  - §3.2〜§3.4: 太さは <line-width>、線種は auto | <outline-line-style> (hidden は無い。auto は実線としてよい)、色の auto は currentColor
 *  - §3.5: outline-offset だけ罫線の箱から離す。負の値は内側へ。外形は太さの 2 倍より小さくしない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, expand, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { parseCss } from '../src/htmlPaged';
import { unsupportedCssReport, UNSUPPORTED_CSS_PROPERTIES } from '../src/cssUnsupported';
import { paintSheet, type Painter } from '../src/paint';
import { DEFAULT_FONTS, parseAreaTree, serializeAreaTree, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, AreaTree, LineArea } from '../src/types';
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

const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 100mm 100mm; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 15pt } p { margin: 0; text-indent: 0 } .b { width: 40pt; height: 20pt; background: #9cf } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont });
const areas = (t: AreaTree, pred: (a: Area) => boolean): Area[] => {
  const out: Area[] = [];
  walkAreaTree(t, (a) => {
    if (a.type !== 'sheet' && pred(a as Area)) out.push(a as Area);
  });
  return out;
};
const outlined = (t: AreaTree) => areas(t, (a) => !!a.outline);
/** 輪郭線を除いた Area Tree (組版の結果の比較用) */
const withoutOutline = (t: AreaTree) => {
  const s = JSON.parse(serializeAreaTree(t)) as unknown;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip).filter((x) => !(x && typeof x === 'object' && (x as { __outlineOnly?: boolean }).__outlineOnly));
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    // 行内の輪郭線の箱 (描くだけの、子の無い箱) は除く
    if (o.outline && o.type === 'block' && Array.isArray(o.children) && !o.children.length && !o.backgroundColor) return { __outlineOnly: true };
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) if (k !== 'outline') out[k] = strip(x);
    return out;
  };
  return strip(s);
};

/** 描く処理の呼び出しを記録する Painter (座標は Sheet の pt) */
type Call = { name: string; args: unknown[] };
function record(t: AreaTree): Call[] {
  const log: Call[] = [];
  const p = new Proxy({} as Painter, {
    get:
      (_t, name) =>
      (...args: unknown[]) => {
        log.push({ name: String(name), args });
        for (const a of args) if (typeof a === 'function') (a as () => void)();
      },
  });
  for (const s of t.sheets) paintSheet(s, p);
  return log;
}
type Seg = { op: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
/** 色 color で描いた図形 (fillRect・fillPath・strokePath) の外接矩形 [x0, y0, x1, y1] (線は太さの半分だけ広げる) */
function inkBox(log: Call[], color: string): [number, number, number, number] | undefined {
  let b: [number, number, number, number] | undefined;
  const add = (x: number, y: number, pad = 0) => {
    b = b ? [Math.min(b[0], x - pad), Math.min(b[1], y - pad), Math.max(b[2], x + pad), Math.max(b[3], y + pad)] : [x - pad, y - pad, x + pad, y + pad];
  };
  for (const c of log) {
    if (c.name === 'fillRect' && c.args[4] === color) {
      const [x, y, w, h] = c.args as number[];
      add(x, y);
      add(x + w, y + h);
    } else if (c.name === 'fillPath' && c.args[1] === color) {
      for (const s of c.args[0] as Seg[]) if (s.x !== undefined) add(s.x, s.y!);
    } else if (c.name === 'strokePath' && c.args[2] === color) {
      for (const s of c.args[0] as Seg[]) if (s.x !== undefined) add(s.x, s.y!, (c.args[1] as number) / 2);
    } else if (c.name === 'strokeLine' || c.name === 'drawLine') {
      const l = c.args[0] as { x1: number; y1: number; x2: number; y2: number; width: number; color: string };
      if (l && l.color === color) {
        add(l.x1, l.y1, l.width / 2);
        add(l.x2, l.y2, l.width / 2);
      }
    }
  }
  return b;
}
const near = (a: readonly number[] | undefined, b: readonly number[], digits = 2) => {
  expect(a).toBeDefined();
  a!.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));
};
const MM = 72 / 25.4;

describe('outline の値を読む (cssCascade)', () => {
  const cs = (css: string) => {
    const doc = new DOMParser().parseFromString(`<html><head></head><body><p>x</p></body></html>`, 'text/html') as unknown as Document;
    const el = doc.getElementsByTagName('p')[0] as unknown as Element;
    const st = cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el);
    return (p: string) => st.getPropertyValue(p);
  };
  it('一括指定 outline は、太さ・線種・色に分ける (§3.1)。outline-offset は含まない', () => {
    expect(expand('outline', '2px dashed red')).toEqual([['outline-width', '2px'], ['outline-style', 'dashed'], ['outline-color', 'red']]);
    expect(expand('outline', 'solid')).toEqual([['outline-width', 'medium'], ['outline-style', 'solid'], ['outline-color', 'auto']]);
    expect(expand('outline', 'red thick dotted')).toEqual([['outline-width', 'thick'], ['outline-style', 'dotted'], ['outline-color', 'red']]);
    expect(expand('outline', 'none')).toEqual([['outline-width', 'medium'], ['outline-style', 'none'], ['outline-color', 'auto']]);
    expect(expand('outline', 'inherit').map(([p]) => p)).toEqual(['outline-width', 'outline-style', 'outline-color']);
  });
  it('auto だけ・auto と太さだけなら、線種と色の両方を auto にする (§3.1)。線種か色があれば、残りの方が auto', () => {
    expect(expand('outline', 'auto')).toEqual([['outline-width', 'medium'], ['outline-style', 'auto'], ['outline-color', 'auto']]);
    expect(expand('outline', 'auto 3px')).toEqual([['outline-width', '3px'], ['outline-style', 'auto'], ['outline-color', 'auto']]);
    expect(expand('outline', 'auto red')).toEqual([['outline-width', 'medium'], ['outline-style', 'auto'], ['outline-color', 'red']]);
    expect(expand('outline', 'solid auto')).toEqual([['outline-width', 'medium'], ['outline-style', 'solid'], ['outline-color', 'auto']]);
  });
  it('計算値: 太さの語 (thin 1px・medium 3px・thick 5px)・em の長さ。線種が none なら太さは 0。初期値は none・auto・0', () => {
    const a = cs('p { font-size: 20px; outline: thick solid; outline-offset: .5em }');
    expect([a('outline-width'), a('outline-style'), a('outline-color'), a('outline-offset')]).toEqual(['5px', 'solid', 'auto', '10px']);
    expect(cs('p { outline: thin dotted #0f0 }')('outline-width')).toBe('1px');
    expect(cs('p { font-size: 10px; outline: 1.5em double }')('outline-width')).toBe('15px');
    const i = cs('');
    expect([i('outline-width'), i('outline-style'), i('outline-color'), i('outline-offset')]).toEqual(['0px', 'none', 'auto', '0px']);
    // 継承しない
    expect(cs('body { outline: 2px solid red; outline-offset: 3px }')('outline-style')).toBe('none');
    expect(cs('body { outline: 2px solid red; outline-offset: 3px }')('outline-offset')).toBe('0px');
  });
  it('読めない値の宣言は捨てる (前の宣言が残る)。@supports も対応していないと答える', () => {
    const ok: Record<string, string[]> = {
      outline: ['1px solid', 'auto', 'thick double #f00', 'none', '0 solid rgb(1 2 3 / .5)', 'dashed 2px currentcolor'],
      'outline-width': ['thin', 'medium', 'thick', '0', '2px', '.1em', 'calc(1px + 1em)'],
      'outline-style': ['auto', 'none', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset'],
      'outline-color': ['auto', 'red', '#123', 'currentColor', 'transparent', 'rgba(0, 0, 0, .5)'],
      'outline-offset': ['0', '3px', '-2px', '1em'],
    };
    const ng: Record<string, string[]> = {
      outline: ['1px solid dashed', '1px 2px solid', 'solid red blue', 'zzz', 'hidden', '1px solid notacolor', 'auto auto auto', '-1px solid'],
      'outline-width': ['-1px', '10%', 'zzz', '1px 2px', 'auto'],
      // hidden は輪郭線の線種に無い (§3.3)
      'outline-style': ['hidden', 'zzz', 'solid dashed', '1px'],
      'outline-color': ['zzz', '1px', 'invert'],
      'outline-offset': ['10%', 'auto', 'zzz', '1px 2px'],
    };
    for (const [p, vs] of Object.entries(ok)) for (const v of vs) expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(true);
    for (const [p, vs] of Object.entries(ng)) for (const v of vs) expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(false);
    const c = cs('p { outline: 2px solid red; outline: 1px solid dashed; outline-width: -3px; outline-style: hidden; outline-color: invert; outline-offset: 4px; outline-offset: 10% }');
    expect([c('outline-width'), c('outline-style'), c('outline-color'), c('outline-offset')]).toEqual(['2px', 'solid', 'red', '4px']);
  });
  it('未対応の CSS の一覧に無い (警告に数えない)', () => {
    for (const p of ['outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset']) expect(UNSUPPORTED_CSS_PROPERTIES.has(p), p).toBe(false);
    const r = unsupportedCssReport(parseCss('p { outline: 1px solid red; outline-offset: 2px; outline-color: blue; outline-style: dotted; outline-width: thin }'));
    expect(r).toEqual({ unsupported: {}, unknown: {} });
  });
});

describe('ブロックの輪郭線', () => {
  it('組版に影響しない (§3): 輪郭線の有る無しで、箱の位置・大きさ・ページ数が同じ', async () => {
    const body = (ol: string) =>
      page(
        `<div class="b" style="${ol}">a</div><p>次の段落 <span style="${ol}">行内の箱が行をまたぐほど長い文を書いておく。行内の箱が行をまたぐほど長い文を書いておく。</span> 後ろ</p><table><tr><td style="${ol}">セル</td><td>次</td></tr></table><div class="b" style="float: left; ${ol}">f</div><p>回り込みの横</p>`,
      );
    const plain = await set(body(''));
    const ol = await set(body('outline: 6pt double red; outline-offset: 4pt'));
    expect(ol.warnings ?? []).toEqual(plain.warnings ?? []);
    expect(ol.areaTree.sheets.length).toBe(plain.areaTree.sheets.length);
    expect(outlined(ol.areaTree).length).toBeGreaterThan(3);
    expect(withoutOutline(ol.areaTree)).toEqual(withoutOutline(plain.areaTree));
  });
  it('太さ・線種・色・離す距離を Area に付ける。色の既定は currentColor、auto は実線', async () => {
    const r = await set(
      page(
        '<div class="b" id="a" style="outline: 3pt dashed #ff0000; outline-offset: 3pt">a</div><div class="b" id="b" style="color: #008000; outline: thin solid">b</div><div class="b" id="c" style="color: #0000ff; outline: auto 6pt">c</div><div class="b" id="d" style="outline: 2pt none red">d</div><div class="b" id="e" style="outline: 0 solid red">e</div><div class="b" id="f" style="outline: 2pt solid transparent">f</div>',
      ),
    );
    expect(r.warnings ?? []).toEqual([]);
    const got = Object.fromEntries(outlined(r.areaTree).map((a) => [a.sourceId, a.outline]));
    expect(Object.keys(got).sort()).toEqual(['a', 'b', 'c']);
    expect(got.a).toEqual({ width: 3, color: '#ff0000', style: 'dashed', offset: 3 });
    // thin は 1px = 0.75pt
    expect(got.b).toEqual({ width: 0.75, color: '#008000' });
    expect(got.c).toEqual({ width: 6, color: '#0000ff' });
  });
  it('罫線の箱の外側に、離す距離をあけて描く (§3.5)。箱の中身と罫線より後に描く', async () => {
    const r = await set(page('<div class="b" style="margin: 20pt; border: 1.5pt solid #000000; outline: 3pt solid #ff0000; outline-offset: 3pt"><p style="background: #00ff00">中</p></div>'));
    const b = areas(r.areaTree, (a) => !!a.outline)[0];
    // 箱 (border の箱) は、ページの余白 10mm + margin 20pt の所から 42pt × 22pt
    const x = 10 * MM + 20;
    const y = 10 * MM + 20;
    expect([b.width, b.height].map((v) => +v.toFixed(3))).toEqual([43, 23]);
    const log = record(r.areaTree);
    // 輪郭線の外形 = 箱を 3 + 3 = 6pt ずつ広げた矩形
    near(inkBox(log, '#ff0000'), [x - 6, y - 6, x + 43 + 6, y + 23 + 6]);
    const at = (color: string) => log.findIndex((c) => (c.name === 'fillRect' && c.args[4] === color) || ((c.name === 'fillPath' || c.name === 'strokePath') && (c.args[1] === color || c.args[2] === color)));
    const lastBlack = log.map((c, k) => ((c.name === 'fillPath' && c.args[1] === '#000000') || (c.name === 'fillRect' && c.args[4] === '#000000') || (c.name === 'strokePath' && c.args[2] === '#000000') ? k : -1)).filter((k) => k >= 0).pop()!;
    expect(at('#00ff00')).toBeGreaterThan(-1);
    expect(at('#ff0000')).toBeGreaterThan(at('#00ff00'));
    expect(at('#ff0000')).toBeGreaterThan(lastBlack);
  });
  it('負の outline-offset は内側へ縮める。外形は、向きごとに、太さの 2 倍より小さくしない (§3.5)', async () => {
    const r = await set(page('<div class="b" style="outline: 3pt solid #ff0000; outline-offset: -6pt"></div><div class="b" style="margin-top: 20pt; outline: 3pt solid #0000ff; outline-offset: -100pt"></div>'));
    const log = record(r.areaTree);
    const x = 10 * MM;
    const y = 10 * MM;
    near(inkBox(log, '#ff0000'), [x + 3, y + 3, x + 40 - 3, y + 20 - 3]);
    // 40pt × 20pt の箱の中央に、6pt × 6pt (太さ 3pt の 2 倍)
    near(inkBox(log, '#0000ff'), [x + 17, y + 40 + 7, x + 23, y + 40 + 13]);
  });
  it('角丸の箱では、輪郭線の角も丸める (§3.1)。外形の角の半径は、箱の半径 + 離す距離 + 太さ', async () => {
    const r = await set(page('<div class="b" style="border-radius: 6pt; outline: 3pt solid #ff0000; outline-offset: 1.5pt"></div><div class="b" style="margin-top: 20pt; outline: 3pt solid #0000ff"></div>'));
    const log = record(r.areaTree);
    const red = log.filter((c) => c.name === 'strokePath' && c.args[2] === '#ff0000');
    expect(red.length).toBe(1);
    const segs = red[0].args[0] as Seg[];
    expect(segs.filter((s) => s.op === 'C').length).toBe(4);
    // 線の中心は、外形 (箱 + 4.5pt) から太さの半分 (1.5pt) だけ内側。上の辺の直線は、左上の角の半径 (6 + 4.5 − 1.5 = 9pt) の後から始まる
    const x = 10 * MM;
    const y = 10 * MM;
    expect(segs[0]).toMatchObject({ op: 'M' });
    expect(segs[0].x!).toBeCloseTo(x - 3 + 9, 2);
    expect(segs[0].y!).toBeCloseTo(y - 3, 2);
    near(inkBox(log, '#ff0000'), [x - 4.5, y - 4.5, x + 44.5, y + 24.5]);
    // 角丸の無い箱の輪郭線に、曲線は無い
    expect(log.some((c) => (c.name === 'strokePath' && c.args[2] === '#0000ff' && (c.args[0] as Seg[]).some((s) => s.op === 'C')) || (c.name === 'fillPath' && c.args[1] === '#0000ff' && (c.args[0] as Seg[]).some((s) => s.op === 'C')))).toBe(false);
  });
  it('ページをまたぐブロックは、断片ごとに閉じた線で囲む', async () => {
    const r = await set(page(`<div id="long" style="outline: 3pt solid #ff0000">${'<p>行</p>'.repeat(30)}</div>`));
    expect(r.areaTree.sheets.length).toBe(2);
    const fr = outlined(r.areaTree).filter((a) => a.sourceId === 'long');
    expect(fr.length).toBe(2);
    r.areaTree.sheets.forEach((s, k) => {
      const log = record({ ...r.areaTree, sheets: [s] });
      const b = inkBox(log, '#ff0000')!;
      // 断片の箱の 4 辺の外側
      near([b[0], b[2]], [10 * MM - 3, 10 * MM + fr[k].width + 3]);
      expect(b[3] - b[1]).toBeCloseTo(fr[k].height + 6, 2);
    });
  });
  it('表のセル・絶対配置の箱・画像・行内ブロック・回り込みの箱・変換した箱にも付く', async () => {
    const img = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%2369c'/%3E%3C/svg%3E";
    const r = await set(
      page(
        `<table><tr><td id="td" class="o">セル</td></tr></table><div id="abs" class="b o" style="position: absolute; left: 100pt; top: 0">絶対</div><p><img id="img" class="o" src="${img}"> <span id="ib" class="o" style="display: inline-block">行内ブロック</span></p><div id="fl" class="b o" style="float: right">f</div><div id="tr" class="b o" style="transform: rotate(10deg); opacity: .5">t</div>`,
        '.o { outline: 1.5pt solid #ff0000 }',
      ),
    );
    expect(r.warnings ?? []).toEqual([]);
    const got = outlined(r.areaTree);
    const types = got.map((a) => a.type).sort();
    expect(types).toEqual(['block', 'block', 'block', 'block', 'image', 'table-cell']);
    for (const a of got) expect(a.outline).toEqual({ width: 1.5, color: '#ff0000' });
    // 変換・不透明度の付いた箱: 輪郭線は、その箱と一緒に変換して、同じ濃さで描く (transform・group の中で描く)
    const t = got.find((a) => a.transform)!;
    expect(t.opacity).toBe(0.5);
    const log = record(r.areaTree);
    const k0 = log.findIndex((c) => c.name === 'transform');
    expect(k0).toBeGreaterThan(-1);
  });
  it('見えない箱 (visibility: hidden)・箱を作らない要素 (display: none・contents) には描かない。html・body の輪郭線は描けないので知らせる', async () => {
    const r = await set(page('<div class="b" style="visibility: hidden; outline: 2pt solid red">a</div><div style="display: contents; outline: 2pt solid red"><p>b</p></div><div style="display: none; outline: 2pt solid red">c</div>'));
    expect(outlined(r.areaTree)).toEqual([]);
    expect(r.warnings ?? []).toEqual([]);
    const b = await set(page('<p>a</p>', 'body { outline: 2pt solid red }'));
    expect(outlined(b.areaTree)).toEqual([]);
    expect((b.warnings ?? []).join('\n')).toContain('outline (html・body)');
  });
  it('直列化した Area Tree から読み戻しても、同じに描く', async () => {
    const r = await set(page('<div class="b" style="border-radius: 4pt; outline: 3pt dotted #ff0000; outline-offset: 1.5pt">a</div>'));
    const back = parseAreaTree(serializeAreaTree(r.areaTree));
    expect(outlined(back)[0].outline).toEqual({ width: 3, color: '#ff0000', style: 'dotted', offset: 1.5 });
    expect(JSON.stringify(record(back))).toBe(JSON.stringify(record(r.areaTree)));
  });
});

describe('行内の箱の輪郭線', () => {
  const lineOf = (t: AreaTree, a: Area): LineArea => areas(t, (x) => x.type === 'line' && (x as LineArea).children.includes(a))[0] as LineArea;
  it('行をまたぐ span は、行ごとの断片を閉じた線で囲む (§3.1)。行の字より後に描く', async () => {
    const r = await set(page('<p style="width: 100pt">前 <span id="s" style="outline: 1.5pt solid #ff0000">行をまたぐほど長い行内の箱の中の文です</span> 後</p>'));
    expect(r.warnings ?? []).toEqual([]);
    const got = outlined(r.areaTree);
    expect(got.length).toBeGreaterThanOrEqual(2);
    const lines = got.map((a) => lineOf(r.areaTree, a));
    // 断片ごとに別の行
    expect(new Set(lines).size).toBe(got.length);
    got.forEach((a, k) => {
      // 行の子の末尾 (字より後)
      const kids = lines[k].children;
      expect(kids[kids.length - 1]).toBe(a);
      expect(a.outline).toEqual({ width: 1.5, color: '#ff0000' });
      // 内容の領域の高さ (行送り 15pt より低く、字の大きさ 10pt 以上)
      expect(a.height).toBeGreaterThanOrEqual(10);
      expect(a.height).toBeLessThan(15);
    });
    // 最初の断片は「前」の字より右から、最後の断片は行の左端から始まる
    expect(got[0].x).toBeGreaterThan(5);
    expect(got[got.length - 1].x).toBeCloseTo(0, 3);
    // 描く順: 輪郭線の赤は、その行の字 (drawGlyph) より後
    const log = record(r.areaTree);
    const firstRed = log.findIndex((c) => (c.name === 'fillRect' && c.args[4] === '#ff0000') || (c.name === 'fillPath' && c.args[1] === '#ff0000') || (c.name === 'strokePath' && c.args[2] === '#ff0000'));
    const glyphsBefore = log.slice(0, firstRed).filter((c) => c.name === 'drawGlyph').length;
    expect(glyphsBefore).toBeGreaterThan(3);
  });
  it('罫線・余白のある span は、罫線の箱の外側を囲む。無い span は、内容の領域を囲む', async () => {
    const r = await set(page('<p><span id="a" style="outline: 1pt solid #ff0000">字</span> <span id="b" style="border: 1.5pt solid #000000; padding: 3pt; outline: 1.5pt solid #0000ff">字</span></p>'));
    const [a, b] = outlined(r.areaTree).sort((p, q) => p.x - q.x);
    // 枠 (罫線・余白) の Area と同じ箱
    const frame = areas(r.areaTree, (x) => x.type === 'block' && !!x.border.top && !x.outline)[0];
    expect([b.x, b.y, b.width, b.height].map((v) => +v.toFixed(3))).toEqual([frame.x, frame.y, frame.width, frame.height].map((v) => +v.toFixed(3)));
    expect(b.height).toBeCloseTo(a.height + 9, 3);
    expect(a.width).toBeCloseTo(10, 1);
  });
  it('縦書きの行内の箱も、行ごとの断片を囲む', async () => {
    const r = await set(page('<div style="writing-mode: vertical-rl; height: 60pt"><p>前<span style="outline: 1pt solid #ff0000">縦書きで行をまたぐ行内の箱</span>後</p></div>'));
    expect(r.warnings ?? []).toEqual([]);
    const got = outlined(r.areaTree);
    expect(got.length).toBeGreaterThanOrEqual(2);
    for (const a of got) {
      // 縦に長い箱 (幅は内容の領域 = 字の大きさほど)
      expect(a.width).toBeGreaterThanOrEqual(10);
      expect(a.width).toBeLessThan(15);
      expect(a.height).toBeGreaterThan(a.width);
    }
  });
  it('不透明度のある span の輪郭線は、字と一緒に同じ濃さで描く', async () => {
    const r = await set(page('<p>前 <span style="opacity: .5; outline: 1pt solid #ff0000">半透明</span> 後</p>'));
    const ol = outlined(r.areaTree)[0];
    const holder = areas(r.areaTree, (a) => a.opacity === 0.5)[0] as Area & { children: Area[] };
    expect(holder).toBeDefined();
    expect(holder.children).toContain(ol);
  });
});
