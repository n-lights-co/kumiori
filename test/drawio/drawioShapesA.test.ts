import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_A } from '../../src/drawio/drawioShapesA';
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
    rounded: style.rounded === '1',
    direction: 'east',
    value: '',
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_A[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);

describe('draw.io の Shapes.js の標準の形', () => {
  // parseSvg は大きさ (width・height か viewBox) の無い svg を読まないので、200 × 200 を付ける
  it('どの形も、描いたものが SVG として読める', () => {
    for (const name of Object.keys(SHAPES_A)) {
      const out = draw(name, 120, 80, name === 'ext' ? { symbol0: 'plus', symbol0Width: '20', symbol0Height: '20', double: '1' } : {});
      // 表の線 (点は表の組み方が渡す) と透明の四角は、何も描かない
      if (name === 'tableLine' || name === 'transparent') expect(out, name).toEqual([]);
      else expect(out.length, name).toBeGreaterThan(0);
      if (out.length) expect(parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${out.join('')}</svg>`, parse), name).not.toBeNull();
    }
  });

  it('cube: 角を切った外形と、手前の面の縁', () => {
    expect(ds(draw('cube', 100, 80))).toEqual(['M0 0L80 0L100 20L100 80L20 80L0 60L0 0Z', 'M20 80L20 20L0 0M20 20L100 20']);
    // darkOpacity は上の面を黒で塗る
    const out = draw('cube', 100, 80, { darkOpacity: '0.5' });
    expect(out[1]).toContain('d="M0 0L80 0L100 20L20 20Z" fill="#000000" fill-opacity="0.5"');
  });

  it('folder: 右の耳と本体 (丸めなし・丸めあり)', () => {
    expect(ds(draw('folder', 100, 80))).toEqual(['M40 20L40 0L100 0L100 20M0 20L100 20L100 80L0 80Z']);
    // rounded: arcSize = min(80 × 0.1, 50, 30) = 8
    expect(ds(draw('folder', 100, 80, { rounded: '1', tabPosition: 'left' }))).toEqual([
      'M8 20L8 0L60 0L60 20M0 28A8 8 0 0 1 8 20L92 20A8 8 0 0 1 100 28L100 72A8 8 0 0 1 92 80L8 80A8 8 0 0 1 0 72Z',
    ]);
  });

  it('document: 下の縁の波 (size 0.3)', () => {
    expect(ds(draw('document', 100, 80))).toEqual(['M0 0L100 0L100 68Q75 46.4 50 68Q25 89.6 0 68L0 12Z']);
  });

  it('cylinder3: 蓋のある円柱と、蓋の無い円柱', () => {
    expect(ds(draw('cylinder3', 100, 80))).toEqual([
      'M0 15A50 15 0 0 1 50 0A50 15 0 0 1 100 15L100 65A50 15 0 0 1 50 80A50 15 0 0 1 0 65Z',
      'M100 15A50 15 0 0 1 50 30A50 15 0 0 1 0 15',
    ]);
    expect(ds(draw('cylinder3', 100, 80, { lid: '0' }))).toEqual(['M0 0A50 15 0 0 0 50 15A50 15 0 0 0 100 0L100 65A50 15 0 0 1 50 80A50 15 0 0 1 0 65Z']);
  });

  it('message・step・hexagon・note', () => {
    expect(ds(draw('message', 100, 60))).toEqual(['M0 0L100 0L100 60L0 60Z', 'M0 0L50 30L100 0']);
    expect(ds(draw('step', 100, 60))).toEqual(['M0 0L80 0L100 30L80 60L0 60L20 30Z']);
    expect(ds(draw('step', 100, 60, { fixedSize: '1', size: '10' }))).toEqual(['M0 0L90 0L100 30L90 60L0 60L10 30Z']);
    expect(ds(draw('hexagon', 100, 60))).toEqual(['M25 0L75 0L100 30L75 60L25 60L0 30Z']);
    expect(ds(draw('note', 100, 80))).toEqual(['M0 0L70 0L100 30L100 80L0 80L0 0Z', 'M70 0L70 30L100 30']);
  });

  it('process: 四角と、内側の 2 本の縦の線', () => {
    expect(ds(draw('process', 100, 60))).toEqual(['M0 0L100 0L100 60L0 60Z', 'M10 0L10 60M90 0L90 60']);
  });

  it('wedgeCallout: 尾は下の辺から、先は (25, 90)', () => {
    // tipX -0.25・tipY 1: 先 (50 - 25, 30 + 60)。下の辺の根元 ex = 50 + (-25 × 30) / 60 = 37.5、幅 20
    expect(ds(draw('wedgeCallout', 100, 60))).toEqual(['M0 0L100 0L100 60L47.5 60L25 90L27.5 60L0 60Z']);
  });

  it('parallelMarker: 線の色で塗った 3 本の棒', () => {
    const out = draw('parallelMarker', 50, 10);
    expect(ds(out)).toEqual(['M0 0L10 0L10 10L0 10Z', 'M20 0L30 0L30 10L20 10Z', 'M40 0L50 0L50 10L40 10Z']);
    expect(out[0]).toContain('fill="#000000"');
  });
});
