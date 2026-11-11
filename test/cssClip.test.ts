/**
 * 切り抜きの矩形 (CSS の clip)。CSS 2.1 §11.1.2 (https://www.w3.org/TR/CSS21/visufx.html#clipping 、2026-11-11 取得) と
 * CSS Masking 1 付録 A「The deprecated clip property」(非推奨だが「UAs must support the clip property」):
 *  - 値は auto か rect(<top>, <right>, <bottom>, <left>)。コンマ区切りと、コンマ無しの書き方 (混ぜたものは不可)。値は <length> | auto (負の長さも可)
 *  - 絶対配置の要素にだけ効く。top・bottom は罫線の箱の上端から、right・left は左端からの距離。auto は、罫線の箱のその辺
 *  - 中身・子・背景・罫線・輪郭線を、その矩形で切り抜く。left と right が同じ値なら、何も見えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { parseCss } from '../src/htmlPaged';
import { unsupportedCssReport, UNSUPPORTED_CSS_PROPERTIES } from '../src/cssUnsupported';
import { paintSheet, type Painter } from '../src/paint';
import { DEFAULT_FONTS, parseAreaTree, serializeAreaTree, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
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

const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 100mm 100mm; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 15pt } p { margin: 0; text-indent: 0 } .a { position: absolute; left: 30pt; top: 30pt; width: 60pt; height: 30pt; background: #99ccff } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont });
const areas = (t: AreaTree, pred: (a: Area) => boolean): Area[] => {
  const out: Area[] = [];
  walkAreaTree(t, (a) => {
    if (a.type !== 'sheet' && pred(a as Area)) out.push(a as Area);
  });
  return out;
};
const clipped = (t: AreaTree) => areas(t, (a) => !!a.clipRect);
const rectOf = (a: Area) => [a.clipRect!.x, a.clipRect!.y, a.clipRect!.width, a.clipRect!.height].map((v) => +v.toFixed(3));
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
const MM = 72 / 25.4;

describe('clip の値を読む (cssCascade)', () => {
  const cs = (css: string) => {
    const doc = new DOMParser().parseFromString(`<html><head></head><body><p>x</p></body></html>`, 'text/html') as unknown as Document;
    const el = doc.getElementsByTagName('p')[0] as unknown as Element;
    return cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el).getPropertyValue('clip');
  };
  it('計算値は、auto か、4 つの値 (auto か絶対の長さ) の矩形。コンマ無しの書き方も読む (§11.1.2)。継承しない', () => {
    expect(cs('')).toBe('auto');
    expect(cs('p { clip: auto }')).toBe('auto');
    expect(cs('p { clip: rect(1px, 2px, 3px, 4px) }')).toBe('rect(1px, 2px, 3px, 4px)');
    expect(cs('p { clip: rect(1px 2px 3px 4px) }')).toBe('rect(1px, 2px, 3px, 4px)');
    expect(cs('p { clip: RECT(0 0 0 0) }')).toBe('rect(0px, 0px, 0px, 0px)');
    expect(cs('p { font-size: 10px; clip: rect(1em, auto, -2em, 3pt) }')).toBe('rect(10px, auto, -20px, 4px)');
    expect(cs('body { clip: rect(1px, 2px, 3px, 4px) }')).toBe('auto');
  });
  it('読めない値の宣言は捨てる (前の宣言が残る)。@supports も対応していないと答える', () => {
    for (const v of ['auto', 'rect(0, 0, 0, 0)', 'rect(0 0 0 0)', 'rect(1px, 2em, auto, -4px)', 'rect(auto auto auto auto)', 'rect(1px,2px,3px,4px)']) expect(supportsCssDeclaration('clip', v), v).toBe(true);
    // コンマと空白を混ぜた書き方・値の数が違うもの・百分率・ほかの形は読めない
    for (const v of ['rect(1px, 2px 3px 4px)', 'rect(1px 2px, 3px, 4px)', 'rect(1px, 2px, 3px)', 'rect(1px 2px 3px 4px 5px)', 'rect(10%, 0, 0, 0)', 'rect()', 'none', 'inset(1px)', 'circle(10px)', 'rect(a, b, c, d)', '1px 2px 3px 4px', 'rect(1px,, 3px, 4px)'])
      expect(supportsCssDeclaration('clip', v), v).toBe(false);
    expect(cs('p { clip: rect(1px, 2px, 3px, 4px); clip: rect(1px, 2px 3px 4px); clip: rect(10%, 0, 0, 0); clip: none }')).toBe('rect(1px, 2px, 3px, 4px)');
  });
  it('未対応の CSS の一覧に無い (警告に数えない)', () => {
    expect(UNSUPPORTED_CSS_PROPERTIES.has('clip')).toBe(false);
    expect(unsupportedCssReport(parseCss('.sr { clip: rect(0 0 0 0) } p { clip: auto }'))).toEqual({ unsupported: {}, unknown: {} });
  });
});

describe('絶対配置の箱を矩形で切り抜く', () => {
  it('組版に影響しない: clip の有る無しで、箱の位置・大きさが同じ', async () => {
    const body = (clip: string) => page(`<p>本文</p><div class="a" style="${clip}"><p>絶対配置の箱の中の文</p></div><p>後ろ</p>`);
    const plain = await set(body(''));
    const cl = await set(body('clip: rect(5pt, 40pt, 20pt, 10pt)'));
    expect(cl.warnings ?? []).toEqual([]);
    const strip = (t: AreaTree) => JSON.parse(serializeAreaTree(t), (k, v: unknown) => (k === 'clipRect' ? undefined : v)) as unknown;
    expect(clipped(cl.areaTree).length).toBe(1);
    expect(strip(cl.areaTree)).toEqual(strip(plain.areaTree));
  });
  it('矩形は、罫線の箱の左上からの距離 (right・bottom も左・上から測る)。auto の辺は、罫線の箱のその辺', async () => {
    const r = await set(
      page(
        '<div class="a" id="a" style="border: 3pt solid #000; padding: 3pt; clip: rect(6pt, 45pt, 24pt, 9pt)">a</div><div class="a" id="b" style="top: 80pt; border: 3pt solid #000; clip: rect(auto, auto, 15pt, auto)">b</div><div class="a" id="c" style="top: 130pt; clip: rect(-6pt, 300pt, 300pt, -6pt)">c</div><div class="a" id="d" style="top: 180pt; clip: rect(3pt, auto, auto, 6pt)">d</div>',
      ),
    );
    expect(r.warnings ?? []).toEqual([]);
    const got = Object.fromEntries(clipped(r.areaTree).map((a) => [a.sourceId, rectOf(a)]));
    expect(got.a).toEqual([9, 6, 36, 18]);
    // 罫線の箱は 66pt × 36pt (内容 60 × 30 + 罫線 3 × 2)
    expect(got.b).toEqual([0, 0, 66, 15]);
    expect(got.c).toEqual([-6, -6, 306, 306]);
    expect(got.d).toEqual([6, 3, 54, 27]);
  });
  it('箱の背景・罫線・中身を、矩形で切り抜いて描く (切り抜きの中で描き、後で戻す)', async () => {
    const r = await set(page('<div class="a" style="border: 3pt solid #000000; clip: rect(6pt, 45pt, 24pt, 9pt); outline: 3pt solid #ff0000"><p>中の字</p></div><p>後ろの字</p>'));
    const log = record(r.areaTree);
    const k0 = log.findIndex((c) => c.name === 'clipRect' && Math.abs((c.args[0] as { width: number }).width - 36) < 1e-6);
    expect(k0).toBeGreaterThan(-1);
    const x = 10 * MM + 30;
    const y = 10 * MM + 30;
    const rect = log[k0].args[0] as { x: number; y: number; width: number; height: number };
    expect([rect.x, rect.y, rect.width, rect.height].map((v) => +v.toFixed(3))).toEqual([+(x + 9).toFixed(3), +(y + 6).toFixed(3), 36, 18]);
    // 切り抜きの始まりから、対になる restore までに、箱の背景・罫線・輪郭線・中の字を描く
    let depth = 0;
    let k1 = -1;
    for (let k = k0; k < log.length; k++) {
      const n = log[k].name;
      if (n === 'clipRect' || n === 'clipPath' || n === 'save') depth++;
      else if (n === 'restore' && --depth === 0) {
        k1 = k;
        break;
      }
    }
    expect(k1).toBeGreaterThan(k0);
    const inside = log.slice(k0, k1);
    const colors = (cs: Call[]) => cs.flatMap((c) => (c.name === 'fillRect' ? [c.args[4]] : c.name === 'fillPath' ? [c.args[1]] : c.name === 'strokePath' ? [c.args[2]] : []));
    expect(colors(inside)).toContain('#99ccff');
    expect(colors(inside)).toContain('#000000');
    expect(colors(inside)).toContain('#ff0000');
    expect(inside.filter((c) => c.name === 'drawGlyph').length).toBe(3);
    // 箱の外の字 (後ろの字と、ページ番号) は、切り抜きの外で描く
    expect(log.slice(0, k0).concat(log.slice(k1)).filter((c) => c.name === 'drawGlyph').map((c) => (c.args[0] as { text: string }).text).join('')).toBe('後ろの字1');
    // 箱より前に、背景の色は描かない
    expect(colors(log.slice(0, k0))).not.toContain('#99ccff');
  });
  it('読み上げ用に隠す書き方 (clip: rect(0 0 0 0)) の箱は、何も描かない。right ≦ left・bottom ≦ top も同じ', async () => {
    const sr = 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0';
    const r = await set(page(`<p>前<span class="sr">隠した文</span>後</p><div class="a" style="clip: rect(0, 10pt, 20pt, 10pt)">幅 0</div><div class="a" style="top: 80pt; clip: rect(20pt, 30pt, 10pt, 0)">高さが負</div>`, `.sr { ${sr} }`));
    expect(r.warnings ?? []).toEqual([]);
    const got = clipped(r.areaTree);
    expect(got.length).toBe(3);
    for (const a of got) expect(a.clipRect!.width * a.clipRect!.height).toBe(0);
    const log = record(r.areaTree);
    // 描く字は「前」「後」(と、ページ番号) だけ。箱の背景も描かない
    expect(log.filter((c) => c.name === 'drawGlyph').map((c) => (c.args[0] as { text: string }).text).join('')).toBe('前後1');
    expect(log.some((c) => (c.name === 'fillRect' && c.args[4] === '#99ccff') || (c.name === 'fillPath' && c.args[1] === '#99ccff'))).toBe(false);
  });
  it('絶対配置でない箱の clip は効かない (§11.1.2)。auto は切り抜かない', async () => {
    const r = await set(page('<div style="clip: rect(0, 5pt, 5pt, 0); background: #9cf">流れの中</div><div style="position: relative; clip: rect(0, 5pt, 5pt, 0)">relative</div><div style="float: left; clip: rect(0, 5pt, 5pt, 0)">float</div><div class="a" style="clip: auto">auto</div>'));
    expect(r.warnings ?? []).toEqual([]);
    expect(clipped(r.areaTree)).toEqual([]);
  });
  it('箱の中の絶対配置の子孫・変換した箱も切り抜く。直列化した Area Tree から読み戻しても、同じに描く', async () => {
    const r = await set(page('<div class="a" style="clip: rect(0, 30pt, 30pt, 0); transform: rotate(10deg)">親<div style="position: absolute; left: 20pt; top: 10pt; width: 60pt; height: 10pt; background: #ffcc66">子</div></div>'));
    const a = clipped(r.areaTree)[0];
    expect(a.transform).toBeDefined();
    // 子の箱は、切り抜く箱の子孫にある
    let found = false;
    const walk = (x: Area) => {
      if (x.backgroundColor === '#ffcc66') found = true;
      for (const k of (x as { children?: Area[] }).children ?? []) walk(k);
    };
    walk(a);
    expect(found).toBe(true);
    const log = record(r.areaTree);
    // 変換の中で切り抜く (箱と一緒に回る)
    expect(log.findIndex((c) => c.name === 'transform')).toBeLessThan(log.findIndex((c) => c.name === 'clipRect' && Math.abs((c.args[0] as { width: number }).width - 30) < 1e-6));
    const back = parseAreaTree(serializeAreaTree(r.areaTree));
    expect(JSON.stringify(record(back))).toBe(JSON.stringify(log));
  });
  it('固定配置 (position: fixed) の箱の clip は描けないので、知らせる', async () => {
    const r = await set(page('<p>a</p><div class="a" style="position: fixed; clip: rect(0, 5pt, 5pt, 0)">f</div>'));
    expect((r.warnings ?? []).join('\n')).toContain('clip (position: fixed の箱)');
  });
});
