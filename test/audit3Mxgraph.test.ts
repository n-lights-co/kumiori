/**
 * 検査 (3 回目) の draw.io の図 (src/drawio/。検査のときはプラグイン @kumiori/mxgraph) と、本体のプラグインの受け口 (assets.ts) の、
 * 小さな入力で時間・メモリを使い切らせる問題を直したことの確かめ
 */
import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../src/assets';
import type { ImageFormat, ImageFormatResult } from '../src/imageFormats';
import { FORMAT_MAX_SIZE, MAX_FORMAT_FRAGMENTS } from '../src/imageFormats';
import { parseXml } from '../src/drawio/drawioXml';
import { ShapeCanvas } from '../src/drawio/drawioCanvas';
import { lineJumps, MAX_LINE_JUMPS } from '../src/drawio/drawioEdges';
import { drawioPage, drawioToSvg } from '../src/drawio/drawio';
import { createState, loadDrawio } from '../src/drawio/load';
import { decodeInlineStencil, stencilSvg } from '../src/drawio/drawioStencil';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const enc = (s: string) => new TextEncoder().encode(s);
const xa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const vertex = (id: string, style: string, x: number | string, y: number | string, w: number | string, h: number | string, value = '') =>
  `<mxCell id="${id}" value="${xa(value)}" style="${xa(style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
/** 圧縮したページの図 (draw.io の Graph.compress: encodeURIComponent → deflateRaw → base64) */
const compressed = (xml: string) => `<mxfile><diagram id="p" name="p">${deflateRawSync(Buffer.from(encodeURIComponent(xml), 'latin1')).toString('base64')}</diagram></mxfile>`;
const timed = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
};

describe('XML の読み取り (drawioXml.ts の parseXml)', () => {
  it('対応しない閉じのタグを並べても、すぐ読み終わる (前は閉じのタグごとに開いている要素を後ろから探した)', () => {
    const src = '<mxGraphModel>' + '<a>'.repeat(100000) + '</q>'.repeat(170000);
    const [root, ms] = timed(() => parseXml(src));
    expect(root?.name).toBe('mxGraphModel');
    expect(ms).toBeLessThan(5000);
  });
  it('閉じの無い要素は、外の要素の閉じのタグで閉じる (前と同じ)', () => {
    const root = parseXml('<r><a><b><c></b><d/></a><e/></r>')!;
    expect(root.children.map((c) => c.name)).toEqual(['a', 'e']);
    expect(root.children[0].children.map((c) => c.name)).toEqual(['b', 'd']);
    expect(root.children[0].children[0].children.map((c) => c.name)).toEqual(['c']);
  });
  it('<!x> を並べても、すぐ読み終わる (前は [ を文字列の終わりまで探した)。DOCTYPE の内部サブセットは飛ばす', () => {
    const src = '<mxGraphModel><root>' + '<!x>'.repeat(250000) + '</root></mxGraphModel>';
    const [root, ms] = timed(() => parseXml(src));
    expect(root?.name).toBe('mxGraphModel');
    expect(ms).toBeLessThan(5000);
    expect(parseXml('<!DOCTYPE r [<!ENTITY a "<x/>">]><r><b/></r>')!.children.map((c) => c.name)).toEqual(['b']);
  });
  it('深すぎる要素 (256 段より下) は木に入れない', () => {
    const root = parseXml('<r>' + '<p>'.repeat(1000) + '</r>')!;
    let depth = 1;
    for (let e = root; e.children.length; e = e.children[0]) depth++;
    expect(depth).toBe(256);
  });
});

describe('道具 (drawioCanvas.ts) の moveTo', () => {
  const host = { stencil: () => undefined, gradient: () => '', stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } }, style: {} };
  const canvas = () => new ShapeCanvas({ stroke: '#000', strokeWidth: 1, dashed: false, dashPattern: '', fixDash: false, fillAlpha: 1, strokeAlpha: 1 }, host);
  it('続く移動は置き換え、座標に英字の入る移動は残す (前と同じ)', () => {
    const c = canvas();
    c.begin();
    c.moveTo(1, 1);
    c.moveTo(2, 2);
    c.lineTo(3, 3);
    c.moveTo(NaN, 0);
    c.moveTo(4, 4);
    c.moveTo(5, 5);
    c.stroke();
    expect(c.out[0]).toContain('d="M2 2L3 3MNaN NaNM5 5"');
  });
  it('移動と線を何万回も繰り返しても、2 乗の手間にならない', () => {
    const c = canvas();
    const [, ms] = timed(() => {
      c.begin();
      for (let i = 0; i < 200000; i++) {
        c.moveTo(i, 0);
        c.lineTo(i, 10);
      }
      c.stroke();
    });
    expect(ms).toBeLessThan(5000);
    expect(c.out[0].length).toBeGreaterThan(200000 * 8);
  });
  it('書いてよい字の数を使い切ったら投げる (図のセルを描くのをやめる)', () => {
    const c = new ShapeCanvas({ stroke: '#000', strokeWidth: 1, dashed: false, dashPattern: '', fixDash: false, fillAlpha: 1, strokeAlpha: 1 }, { ...host, stencilCtx: { ...host.stencilCtx, budget: { ops: 0, chars: 1000 } } });
    expect(() => {
      for (let i = 0; i < 1e9; i++) c.lineTo(i, i);
    }).toThrow();
  });
});

describe('draw.io の図の上限 (drawio.ts)', () => {
  it('html=0 のラベルにも長さの上限があり、placeholders の置き換えた結果も上限までにする', () => {
    const [r1, ms1] = timed(() => drawioToSvg(enc(compressed(model(vertex('c', '', 0, 0, 200, 100, 'ab\n'.repeat(2_000_000)))))));
    expect(r1).toBeDefined();
    expect(ms1).toBeLessThan(10000);
    expect((r1!.svg.match(/<text/g) ?? []).length).toBeLessThanOrEqual(50001);
    const v = '%a%'.repeat(20000);
    const a = 'x '.repeat(5000);
    const [r2, ms2] = timed(() => drawioToSvg(enc(model(`<UserObject id="u" label="${v}" a="${a}"><mxCell style="placeholders=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry width="200" height="100" as="geometry"/></mxCell></UserObject>`))));
    expect(r2).toBeDefined();
    expect(ms2).toBeLessThan(10000);
    expect(r2!.svg.length).toBeLessThan(5_000_000);
  });
  it('図のラベルの字の合計に上限があり、超えたラベルは描かずに警告する', () => {
    let s = '';
    for (let i = 0; i < 25; i++) s += vertex('c' + i, '', i * 10, 0, 10, 10, 'x'.repeat(99000));
    const r = drawioToSvg(enc(compressed(model(s))), { lang: 'en' })!;
    expect(r.warnings).toContain('too many label characters (up to 2000000 per diagram; labels beyond that are not drawn)');
    expect((r.svg.match(/<text/g) ?? []).length).toBe(20);
  });
  it('SVG の長さに上限があり、超えたセルからあとは描かずに警告する (手書き風の巨大なセル)', () => {
    let s = '';
    for (let i = 0; i < 20; i++) s += vertex('a' + i, 'sketch=1;fillColor=#ff0000;fillStyle=zigzag;strokeWidth=0.01;', 0, 0, 99999, 99999);
    const [r, ms] = timed(() => drawioToSvg(enc(compressed(model(s))), { lang: 'en' })!);
    expect(ms).toBeLessThan(20000);
    expect(r.svg.length).toBeLessThanOrEqual(16 << 20);
    expect(r.warnings).toContain(`the diagram is too large; only part of it is drawn (up to ${16 << 20} characters of SVG)`);
  });
  it('座標の絶対値が上限を超えるセルは描かず、図の大きさは有限 (前は x=±1e308 で幅が Infinity)', () => {
    const r = drawioToSvg(enc(model(vertex('a', '', '-1e308', 0, 100, 60) + vertex('b', '', '1e308', 0, 100, 60) + vertex('c', '', 0, 0, 100, 60))), { lang: 'en' })!;
    expect(r.width).toBe(101);
    expect(Number.isFinite(r.height)).toBe(true);
    expect(r.warnings).toContain('cells with too large a position or size are not drawn (absolute values up to 10000000 px)');
    // 上限の中の大きな座標は、そのまま描く
    expect(drawioToSvg(enc(model(vertex('a', '', 0, 0, 10, 10) + vertex('b', '', 9e6, 0, 10, 10))))!.width).toBe(9000011);
  });
  it('埋め込んだ形 (stencil(…)) を戻す大きさに、1 つの形と図の全体の上限がある', () => {
    const b64 = deflateRawSync(Buffer.from('<shape w="10" h="10">' + ' '.repeat(60_000_000) + '</shape>'), { level: 9 }).toString('base64');
    let s = '';
    for (let i = 0; i < 100; i++) s += vertex('a' + i, `shape=stencil(${b64.slice(0, 10 + i)} ${b64.slice(10 + i)});`, 0, 0, 10, 10);
    const [r, ms] = timed(() => drawioToSvg(enc(compressed(model(s))), { lang: 'en' })!);
    expect(ms).toBeLessThan(10000);
    expect(r.warnings).toContain('too many embedded shapes (stencil) (up to 16777216 bytes inflated per diagram)');
    // 小さな形は前と同じく読む
    const small = deflateRawSync(Buffer.from('<shape w="10" h="10"><foreground><rect x="0" y="0" w="10" h="10"/><fillstroke/></foreground></shape>')).toString('base64');
    expect(decodeInlineStencil(small, 4 << 20)?.name).toBe('shape');
    expect(drawioToSvg(enc(model(vertex('a', `shape=stencil(${small});`, 0, 0, 10, 10))))!.svg).toContain('<path');
  });
  it('埋め込んだ形の深すぎる入れ子は、浅い所だけ描く (前は図の全体が読めない画像になった)', () => {
    const deep = '<shape w="10" h="10"><foreground><rect x="0" y="0" w="10" h="10"/><fillstroke/>' + '<path>'.repeat(200000) + '</foreground></shape>';
    const r = drawioToSvg(enc(model(vertex('a', `shape=stencil(${deflateRawSync(Buffer.from(deep)).toString('base64')});`, 0, 0, 10, 10))));
    expect(r?.svg).toContain('<path');
    const shape = parseXml('<shape w="10" h="10"><foreground>' + '<path>'.repeat(5000) + '</foreground></shape>')!;
    expect(() => stencilSvg(shape, { x: 0, y: 0, w: 10, h: 10 }, { strokeWidth: 1, dashed: false, dashPattern: '', fixDash: false, fillOpacity: 1, strokeOpacity: 1, style: {} }, { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } })).not.toThrow();
  });
});

describe('線の跳び越し (drawioEdges.ts の lineJumps)', () => {
  const V = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: i % 2 ? 2000 : 0 }));
  const H = Array.from({ length: 2000 }, (_, i) => ({ x: i % 2 ? 2000 : 0, y: i + 0.3 }));
  it('跳ぶ点が多すぎる線は跳ばない (前は交わり 100 万個を 2 乗の手間で探した)', () => {
    const budget = { pairs: 1e8, limited: false };
    const [r, ms] = timed(() => lineJumps(H, [V], budget));
    expect(r).toBeUndefined();
    expect(budget.limited).toBe(true);
    expect(ms).toBeLessThan(3000);
  });
  it('調べる線分の組の数が残りを超える線は跳ばない。少ない交わりは前と同じく跳ぶ', () => {
    const budget = { pairs: 100, limited: false };
    expect(lineJumps(H, [V], budget)).toBeUndefined();
    expect(budget).toEqual({ pairs: 100, limited: true });
    const cross = lineJumps([{ x: 0, y: 5 }, { x: 10, y: 5 }], [[{ x: 5, y: 0 }, { x: 5, y: 10 }]], { pairs: 100, limited: false });
    expect(cross).toEqual([{ x: 0, y: 5 }, { x: 5, y: 5, jump: true }, { x: 10, y: 5 }]);
    expect(MAX_LINE_JUMPS).toBe(1000);
  });
  it('図の全体でも、跳ばずに描いて警告する', () => {
    const edge = (id: string, pts: number[][], style: string) =>
      `<mxCell id="${id}" style="${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${pts[0][0]}" y="${pts[0][1]}" as="sourcePoint"/><mxPoint x="${pts.at(-1)![0]}" y="${pts.at(-1)![1]}" as="targetPoint"/><Array as="points">${pts
        .slice(1, -1)
        .map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`)
        .join('')}</Array></mxGeometry></mxCell>`;
    const xml = model(edge('v', V.map((p) => [p.x, p.y]), 'endArrow=none;') + edge('h', H.map((p) => [p.x, p.y]), 'jumpStyle=arc;endArrow=none;'));
    const [r, ms] = timed(() => drawioToSvg(enc(compressed(xml)), { lang: 'en' })!);
    expect(ms).toBeLessThan(5000);
    expect(r.warnings.some((w) => w.startsWith('lines with too many line-jump crossings'))).toBe(true);
    expect(r.svg.length).toBeLessThan(1_000_000);
  });
});

describe('ページの選び方と、描いた図の使い回し (load.ts)', () => {
  const xml = `<mxfile><diagram id="a" name="A">${model(vertex('a', '', 0, 0, 10, 10))}</diagram><diagram id="b" name="B">${model(vertex('b', '', 0, 0, 30, 10))}</diagram></mxfile>`;
  it('drawioPage は、fragment の指すページの番号と警告を返す', () => {
    expect(drawioPage(enc(xml), undefined)).toEqual({ index: 0, warnings: [] });
    expect(drawioPage(enc(xml), 'B')).toEqual({ index: 1, warnings: [] });
    expect(drawioPage(enc(xml), 'page=9', 'en')).toEqual({ index: 0, warnings: ['the draw.io diagram has no page 9 (it has 2; the first page is drawn)'] });
    expect(drawioPage(enc('<html/>'), undefined)).toBeUndefined();
  });
  it('同じページになる fragment (無いページ・書き方の違い) は、描き直さずに使い回す', async () => {
    const state = createState({});
    const ctx = { lang: 'en' as const };
    const a = await loadDrawio(enc(xml), ctx, state);
    const b = await loadDrawio(enc(xml), { ...ctx, fragment: 'nope' }, state);
    const c = await loadDrawio(enc(xml), { ...ctx, fragment: 'page=2' }, state);
    const d = await loadDrawio(enc(xml), { ...ctx, fragment: 'page-id=b' }, state);
    expect(a!.width).toBe(11);
    expect(b).toEqual({ ...a, warnings: ['the draw.io diagram has no such page: #nope (the first page is drawn)'] });
    expect(b!.svg).toBe(a!.svg);
    expect(c!.width).toBe(31);
    expect(d!.svg).toBe(c!.svg);
    expect(state.renders?.pages.size).toBe(2);
  });
});

describe('本体のプラグインの受け口 (assets.ts)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>';
  const fake = (load: ImageFormat['load']): ImageFormat => ({ name: 'fake', mime: 'application/x-fake', extensions: ['fake'], sniff: (b) => b[0] === 0x46, load });
  const store = (load: ImageFormat['load'], warns: string[], timeout?: number) =>
    new AssetStore({ parseXml: parse, formats: [fake(load)], formatContext: { warn: (m) => warns.push(m), lang: 'en' }, ...(timeout ? { formatTimeoutMs: timeout } : {}) });
  it('大きさが有限でない・上限を超える画像は、読めない画像として警告する (前は Infinity を受け取り、文書の全体が誤りで終わった)', async () => {
    for (const w of [Infinity, 1e300, FORMAT_MAX_SIZE * 2]) {
      const warns: string[] = [];
      const s = store(async () => ({ svg, width: w, height: 50, warnings: [] }), warns);
      expect(await s.addBlob('x.fake', new Blob([enc('F')]))).toBeUndefined();
      expect(warns).toHaveLength(1);
    }
    const s = store(async () => ({ svg, width: NaN, height: 50, warnings: [] }), []);
    expect(await s.addBlob('x.fake', new Blob([enc('F')]))).toBeUndefined();
  });
  it('長すぎる SVG は描かず、大きさだけの画像に警告を付ける。警告の無い結果も読む', async () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">${'<rect width="1" height="1"/>'.repeat(1_300_000)}</svg>`;
    const a = await store(async () => ({ svg: big, width: 100, height: 50, warnings: [] }), []).addBlob('x.fake', new Blob([enc('F')]));
    expect(a).toMatchObject({ width: 100, height: 50, drawable: false });
    expect(a!.notes![0]).toMatch(/^形式 fake の SVG が長すぎるので描きません/);
    const b = await store(async () => ({ svg, width: 100, height: 50 }) as unknown as ImageFormatResult, []).addBlob('x.fake', new Blob([enc('F')]));
    expect(b).toMatchObject({ mime: 'image/svg+xml', width: 100 });
    expect(b!.notes).toBeUndefined();
  });
  it('読み込みが時限までに終わらなければ、読めない画像として警告する (前は何も言わずに終わった)', async () => {
    const warns: string[] = [];
    const s = store(() => new Promise(() => {}), warns, 50);
    expect(await s.addBlob('x.fake', new Blob([enc('F')]))).toBeUndefined();
    expect(warns).toEqual(['画像 x.fake の読み込み (fake) が 0 秒で終わらないので、読めない画像として扱います']);
  });
  it('1 つのファイルを fragment の違う参照で読み直す数に上限がある。同じ SVG は読み直さずに使い回す', async () => {
    const warns: string[] = [];
    const load = vi.fn(async () => ({ svg, width: 100, height: 50, warnings: [] }));
    const s = store(load, warns);
    await s.addBlob('x.fake', new Blob([enc('F')]));
    for (let i = 0; i < MAX_FORMAT_FRAGMENTS; i++) expect(await s.addFragment(`x.fake#p${i}`)).toMatchObject({ width: 100, mime: 'image/svg+xml' });
    expect(await s.addFragment('x.fake#over')).toBeUndefined();
    expect(await s.addFragment('x.fake#over2')).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(MAX_FORMAT_FRAGMENTS + 1);
    expect(warns).toHaveLength(1);
    // 同じ参照は、作ったものを返す (数えない)
    expect(await s.addFragment('x.fake#p0')).toBe(s.get('x.fake#p0'));
  });
});
