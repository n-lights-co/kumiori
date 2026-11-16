import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_UI, textWidth } from '../../src/drawio/drawioJs/ui';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: style.strokeColor ?? '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: () => undefined, gradient: () => 'url(#g)', stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } } as never, style: {} },
  );
  const has = (k: string) => Object.hasOwn(style, k);
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => num(style[k], d),
    color: (k, d) => (has(k) ? (style[k] === 'none' ? undefined : style[k]) : d),
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
  SHAPES_UI[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]).filter((d) => d !== undefined);
const svgOk = (out: string[]) =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) } as never);

describe('draw.io の画面の部品の形 (iOS 7・ラック・Android・Bootstrap・GMDL)', () => {
  it('94 の形を登録している', () => {
    expect(Object.keys(SHAPES_UI).length).toBe(94);
  });

  it('どの形も、描いたものが SVG として読める (anchor は何も描かない)', () => {
    for (const name of Object.keys(SHAPES_UI)) {
      for (const style of [{} as Record<string, string>, { buttonText: '+A,B,C', mainText: 'A,+B', buttonState: 'off', switchState: 'off', checked: '1', ratingStyle: 'heart', handleStyle: 'rect', rangeStyle: 'rect', numDisp: 'off' }]) {
        const out = draw(name, 160, 100, style);
        if (name.endsWith('.anchor')) expect(out, name).toEqual([]);
        else expect(out.length, name).toBeGreaterThan(0);
        if (out.length) expect(svgOk(out), name).not.toBeNull();
      }
    }
  });

  it('bootstrap.x・ios7ui.leftButton・rrect: 経路', () => {
    expect(ds(draw('mxgraph.bootstrap.x', 100, 60))).toEqual(['M0 0L100 60M100 0L0 60']);
    expect(ds(draw('mxgraph.ios7ui.leftButton', 100, 40))).toEqual(['M100 0L100 40L10 40A10 10 0 0 1 0 30L0 10A10 10 0 0 1 10 0Z']);
    // roundrect(0, 0, w, h, rSize) は SVG の rect の rx だけを書く (ry も同じ)
    expect(ds(draw('mxgraph.ios7ui.rrect', 100, 40, { rSize: '10.7' }))).toEqual(['M10 0L90 0A10 10 0 0 1 100 10L100 30A10 10 0 0 1 90 40L10 40A10 10 0 0 1 0 30L0 10A10 10 0 0 1 10 0Z']);
  });

  it('rackGeneral.cabinetLeg: 脚の外形', () => {
    expect(ds(draw('mxgraph.rackGeneral.cabinetLeg', 50, 40))).toEqual(['M0 30L5 30L5 28L9 28L9 30L40 30L40 9L38 9L38 5L40 5L40 0L50 0L50 40L0 40Z']);
  });

  it('bootstrap.popover: 下の尖り (dx 100・dy 20)', () => {
    expect(ds(draw('mxgraph.bootstrap.popover', 200, 100, { dx: '100', dy: '20' }))).toEqual([
      'M10 0L190 0A10 10 0 0 1 200 10L200 70A10 10 0 0 1 190 80L120 80L100 100L80 80L10 80A10 10 0 0 1 0 70L0 10A10 10 0 0 1 10 0Z',
    ]);
  });

  it('gmdl.sliderDisabled: つまみと、左右 7 を空けた線', () => {
    expect(ds(draw('mxgraph.gmdl.sliderDisabled', 100, 20))).toEqual(['M45 10A5 5 0 1 1 55 10A5 5 0 1 1 45 10Z', 'M0 10L43 10', 'M57 10L100 10']);
  });

  it('rackGeneral.container: 番号の列を空ける (numDisp=off なら空けない)', () => {
    expect(ds(draw('mxgraph.rackGeneral.container', 100, 100))[0]).toBe('M24 0L100 0L100 100L24 100Z');
    expect(ds(draw('mxgraph.rackGeneral.container', 100, 100, { numDisp: 'off' }))[0]).toBe('M0 0L100 0L100 100L0 100Z');
    // 番号は (100 - 42) / 20 = 2 段。上から 2・1
    const texts = draw('mxgraph.rackGeneral.container', 100, 100).filter((s) => s.startsWith('<text'));
    expect(texts.map((s) => />([^<]*)</.exec(s)?.[1])).toEqual(['2', '1']);
  });

  it('rackGeneral.rackCabinet3: 番号の列は左 (rackUnitDirLeft は読まない)。既定の numDisp=on では番号の字を書かない', () => {
    const out = draw('mxgraph.rackGeneral.rackCabinet3', 204, 72, { rackUnitDirLeft: '0', rackUnitSize: '15' });
    // 番号の列 24 を左に空ける。棚の幅 204 - 24 = 180。番号の線は x = -24 から 0 まで (棚の座標)
    expect(ds(out)[0]).toBe('M24 0L204 0L204 72L24 72Z');
    expect(ds(out).at(-1)).toBe('M0 21L24 21M0 36L24 36M0 51L24 51');
    // ソースは on を cst.DIR_ON (無い) と比べるので、番号の字は書かない
    expect(out.filter((s) => s.startsWith('<text'))).toEqual([]);
    const desc = draw('mxgraph.rackGeneral.rackCabinet3', 204, 72, { numDisp: 'descend', rackUnitSize: '15' });
    expect(desc.filter((s) => s.startsWith('<text')).map((s) => />([^<]*)</.exec(s)?.[1])).toEqual(['1', '2']);
  });

  it('rackGeneral.horRoutingBank: 外の四角だけ (ソースは段の数が NaN になり、穴を描かない)', () => {
    expect(ds(draw('mxgraph.rackGeneral.horRoutingBank', 160, 30))).toEqual(['M0 0L160 0L160 30L0 30Z']);
  });

  it('bootstrap.switch: buttonState == true (字の true は偽)', () => {
    expect(draw('mxgraph.bootstrap.switch', 40, 20)[0]).toContain('fill="#0085FC"');
    expect(draw('mxgraph.bootstrap.switch', 40, 20, { buttonState: '0' })[0]).toContain('stroke="#000000"');
  });

  it('文字の幅の見積もり (Helvetica)', () => {
    expect(textWidth('Tab 1', 10)).toBeCloseTo((611 + 556 + 556 + 278 + 556) / 100);
  });

  it('繰り返しで描く部分は、回数の上限 (アイコン・溝・縞・印は 1000、区切りの線は 10000) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    expect(draw('mxgraph.ios7ui.iconGrid', 3000, 3000, { gridSize: '2000,2000' })).toHaveLength(1000);
    // selectBar: dx2 が 0 だと x = 0 の区切りが尽きないが、10000 本で止まる
    const bar = ds(draw('mxgraph.ios7ui.selectBar', 200, 30, { dx2: '0' })).find((d) => d.startsWith('M0 0L0 30'));
    expect(bar?.match(/M/g)).toHaveLength(10000);
    // horCableDuct: 幅 100000 の溝は 3030 個だが、1000 個で止まる。始めの位置はソースのまま (10 + floor((99980 − 3029 × 33) / 2) = 21)
    const duct = ds(draw('mxgraph.rackGeneral.horCableDuct', 100000, 15));
    expect(duct).toHaveLength(1 + 2 * 1000);
    expect(duct[1]).toBe('M21 0L24 0L24 7L21 7Z');
    // leftButtonStriped: 高さが 0 だと縞の間が 0 になるが、1000 本で止まる (ボタンと始めの三角の 2 つと、縞 1000 本)
    expect(draw('mxgraph.bootstrap.leftButtonStriped', 100, 0)).toHaveLength(2 + 1000);
    // rating: grade 5000・ratingScale 9000 は、塗った印と空の印を 1000 個ずつ
    expect(ds(draw('mxgraph.bootstrap.rating', 100, 10, { grade: '5000', ratingScale: '9000' }))).toHaveLength(2000);
  });
});
