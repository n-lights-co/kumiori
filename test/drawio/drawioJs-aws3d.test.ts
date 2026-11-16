import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_AWS3D } from '../../src/drawio/drawioJs/aws3d';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: () => undefined, gradient: () => 'url(#g)', stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } } as never, style: {} },
  );
  const has = (k: string) => Object.hasOwn(style, k);
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => num(style[k], d),
    color: (k, d) => (has(k) ? style[k] : d),
    flag: (k, d = false) => (has(k) ? style[k] === '1' || style[k] === 'true' : d),
    fill: c.fillColor,
    stroke: c.strokeColor,
    strokeWidth: 1,
    rounded: false,
    direction: 'east',
    value: '',
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_AWS3D[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);

describe('draw.io の mxAWS3D.js の形', () => {
  it('登録されたすべての形 (57) が、SVG として読めるものを描く', () => {
    const names = Object.keys(SHAPES_AWS3D);
    expect(names.length).toBe(57);
    for (const name of names) {
      expect(name.startsWith('mxgraph.aws3d.'), name).toBe(true);
      for (const style of [{}, { flipH: '1', shadingCols: '0.2,0.4' }] as Record<string, string>[]) {
        const out = draw(name, 120, 100, style);
        expect(out.length, name).toBeGreaterThan(0);
        expect(parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse), name).not.toBeNull();
      }
    }
  });

  it('arrowNE: 右上へ向かう矢印と、左下の丸い端', () => {
    expect(ds(draw('mxgraph.aws3d.arrowNE', 100, 50))).toEqual([
      'M83 8L79 5.5L100 0L90.3 12.2L86.1 9.8L9.7 46.5A6 3 0 0 1 9 49.6A5.2 3 0 0 1 1 48.6A6 2.8 0 0 1 3 44.6A5 3 0 0 1 6.7 44.8Z',
    ]);
  });

  it('dashedEdgeDouble: 両端の矢じり (線なし) と、太さ 4 の破線', () => {
    const out = draw('mxgraph.aws3d.dashedEdgeDouble', 100, 50);
    expect(ds(out)).toEqual(['M21 5.5L0 0L9.7 12.2', 'M79 44.5L100 50L90.3 37.8', 'M7.68 4.43L92.33 45.58']);
    expect(out[0]).toContain('fill="#2D6195" stroke="none"');
    expect(out[2]).toContain('fill="none" stroke="#2D6195" stroke-width="4"');
    expect(out[2]).toContain('stroke-linecap="round"');
    // 破線は 3 3 を太さ倍
    expect(out[2]).toContain('stroke-dasharray="12 12"');
  });

  it('ami: 外形の縁 (#292929・太さ 2 倍) と、陰の面 (shadingCols を flipH で振り分ける)', () => {
    // 線の太さは min(100 / 92, 100 / 60) = 1.087 の 2 倍 (座標は小数 2 桁に丸めて書く)
    const out = draw('mxgraph.aws3d.ami', 100, 100);
    expect(ds(out)[0]).toBe('M0 64.83L6.84 41.33L53.26 0L66.85 0L93.59 23.67L100 46.5L40 100Z');
    expect(out[0]).toContain('stroke="#292929" stroke-width="2.17"');
    expect(out[0]).toContain('stroke-linejoin="round"');
    // 左の面は 0.1、右の面は 0.3
    expect(ds(out)[1]).toBe('M0 65L6.52 50L33.26 76.67L46.63 76.67L40 100Z');
    expect(out[1]).toContain('fill="#000000" fill-opacity="0.1"');
    expect(out[2]).toContain('fill-opacity="0.3"');
    const flipped = draw('mxgraph.aws3d.ami', 100, 100, { flipH: '1' });
    expect(flipped[1]).toContain('fill-opacity="0.3"');
    expect(flipped[2]).toContain('fill-opacity="0.1"');
    // 元の大きさ (92 × 60) の半分の幅なら、線は 0.5 の 2 倍
    expect(draw('mxgraph.aws3d.ami', 46, 60)[0]).toContain('stroke-width="1"');
  });

  it('application_server: background・foreground に分けた形の、外形と色', () => {
    // v24.7.5 のソースは外形の縁を #292929 に決めて描き、style の strokeColor2 は読まない
    const out = draw('mxgraph.aws3d.application_server', 123, 124, { strokeColor2: '#ff0000' });
    expect(out.length).toBeGreaterThan(3);
    expect(out[0]).toContain('stroke="#292929"');
  });
});
