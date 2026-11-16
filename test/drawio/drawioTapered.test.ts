import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas, type Pt } from '../../src/drawio/drawioCanvas';
import { paintTaperedArrow, taperedArrowGrow, type TaperedArrowOptions } from '../../src/drawio/drawioTapered';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 先細りの矢印を描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(pts: Pt[], o: TaperedArrowOptions = {}): string[] {
  const c = new ShapeCanvas(
    { fill: '#ffffff', stroke: '#000000', strokeWidth: o.strokeWidth ?? 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: () => undefined, gradient: () => 'url(#g)', stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } } as never, style: {} },
  );
  paintTaperedArrow(c, pts, { fill: '#ffffff', stroke: '#000000', ...o });
  return c.out;
}

const readable = (out: string[]) =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

const ds = (out: string[]) => out.map((e) => /d="([^"]*)"/.exec(e)?.[1]);

const straight: Pt[] = [
  { x: 50, y: 200 },
  { x: 350, y: 200 },
];
const bent: Pt[] = [
  { x: 50, y: 50 },
  { x: 200, y: 50 },
  { x: 200, y: 300 },
  { x: 350, y: 300 },
];

describe('taperedArrow (draw.io の TaperedArrowShape)', () => {
  it('まっすぐの線: 幅 12 から 2 へ細る帯 (矢の頭なし)', () => {
    const out = draw(straight);
    // 左 (法線 (0, 1) の側) は半分の幅 6 → 1、右は -6 → -1
    expect(ds(out)).toEqual(['M50 206L350 201L350 199L50 194Z']);
    expect(out[0]).toContain('fill="#ffffff"');
    expect(out[0]).toContain('stroke="#000000"');
  });

  it('まっすぐの線: block の頭は帯の輪郭の一部', () => {
    // size = 6 + 2 × 2 / 2 = 8、先 = 350 - 1.118、根元 = 先 - (8 + 1)、頭の半分の幅 = 9 / 2
    const out = draw(straight, { endArrow: 'block' });
    expect(ds(out)).toEqual(['M50 206L339.88 201L339.88 204.5L348.88 200L339.88 195.5L339.88 199L50 194Z']);
  });

  it('まっすぐの線: 始まりの classic の頭 (根元は頭の 3/4 だけ縮める)', () => {
    // size = 6 + 12 × 2 / 2 = 18、先 = 50 + 1.118、根元 = 先 + 19 × 3/4、角 = 先 + 19 (半分の幅 9.5)
    const out = draw(straight, { startArrow: 'classic' });
    expect(ds(out)).toEqual(['M65.37 206L350 201L350 199L65.37 194L70.12 190.5L51.12 200L70.12 209.5Z']);
  });

  it('diamond は帯と同じ経路に足して 1 回で塗る', () => {
    const out = draw(straight, { endArrow: 'diamond' });
    expect(out).toHaveLength(1);
    expect(ds(out)[0]!.match(/M/g)).toHaveLength(2);
  });

  it('塗りの色を書いた頭・open の頭は、帯と別に描く', () => {
    const a = draw(straight, { endArrow: 'block', endFillColor: '#ff0000' });
    expect(a).toHaveLength(2);
    expect(a[1]).toContain('fill="#ff0000"');
    const b = draw(straight, { startArrow: 'open', endArrow: 'oval' });
    expect(b).toHaveLength(3);
    expect(b[1]).toContain('fill="none"');
  });

  const cases: Array<[string, Pt[], TaperedArrowOptions]> = [
    ['折れ線', bent, {}],
    ['折れ線・丸め', bent, { rounded: true }],
    ['折れ線・丸め・矢の頭', bent, { rounded: true, startArrow: 'classic', endArrow: 'block' }],
    ['曲線', bent, { curved: true }],
    ['曲線・矢の頭', bent, { curved: true, startArrow: 'diamond', endArrow: 'classicThin' }],
    ['3 次の曲線', bent, { bezier: true, endArrow: 'box', startWidth: 20, endWidth: 0 }],
    ['鋭い角 (輪を除く)', [{ x: 50, y: 50 }, { x: 350, y: 60 }, { x: 60, y: 80 }], { startWidth: 30, endArrow: 'doubleBlock' }],
    ['太い線・ER の印', straight, { strokeWidth: 3, endArrow: 'ERmany', startArrow: 'circle' }],
  ];
  for (const [name, pts, o] of cases) {
    it(`${name}: 描けて SVG として読める`, () => {
      const out = draw(pts, o);
      expect(out.length).toBeGreaterThan(0);
      expect(out.join('')).not.toMatch(/NaN|Infinity/);
      expect(readable(out)).not.toBeNull();
    });
  }

  it('点が重なるだけの線は、何も描かない', () => {
    expect(draw([{ x: 10, y: 10 }, { x: 10, y: 10 }])).toEqual([]);
  });

  it('呼ぶ側の点は書き換えない・囲みを広げる量', () => {
    const pts = straight.map((p) => ({ ...p }));
    draw(pts, { startArrow: 'classic', endArrow: 'block' });
    expect(pts).toEqual(straight);
    expect(taperedArrowGrow({})).toBe(12);
    expect(taperedArrowGrow({ startWidth: -3, endWidth: 20 })).toBe(20);
  });
});
