import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_MOCKUP } from '../../src/drawio/drawioJs/mockup';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}, value = ''): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
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
    value,
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_MOCKUP[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.filter((s) => s.startsWith('<path')).map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

/** 何も描かない形 (draw.io でも paintVertexShape が空: 繋ぐ点だけの形) */
const EMPTY = new Set(['mxgraph.mockup.anchor', 'mxgraph.mockup.containers.anchor', 'mxgraph.mockup.forms.anchor', 'mxgraph.mockup.graphics.anchor', 'mxgraph.mockup.misc.anchor']);

describe('draw.io のモックアップの形 (shapes/mockup/mxMockup*.js)', () => {
  it('どの形も描けて、SVG として読める', () => {
    const names = Object.keys(SHAPES_MOCKUP);
    expect(names.length).toBe(88);
    for (const name of names) {
      const out = draw(name, 300, 200);
      if (EMPTY.has(name)) expect(out, name).toEqual([]);
      else expect(out.length, name).toBeGreaterThan(0);
      if (out.length) expect(readable(out), name).not.toBeNull();
    }
  });

  it('topButton: 上の角だけ丸い四角 (rSize の既定 10)', () => {
    expect(ds(draw('mxgraph.mockup.topButton', 100, 40))).toEqual(['M0 10A10 10 0 0 1 10 0L90 0A10 10 0 0 1 100 10L100 40L0 40Z']);
  });

  it('rrect: 角の半径を片方だけ渡すと、もう片方も同じ (SVG の rect の rx)', () => {
    expect(ds(draw('mxgraph.mockup.rrect', 100, 50, { rSize: '5' }))).toEqual(['M5 0L95 0A5 5 0 0 1 100 5L100 45A5 5 0 0 1 95 50L5 50A5 5 0 0 1 0 45L0 5A5 5 0 0 1 5 0Z']);
  });

  it('iconGrid: 2 × 2 の四角と、その中のばつ印 (箱の幅 = 70 / (2 + 0.5) = 28、間は 0.5 箱)', () => {
    const d = ds(draw('mxgraph.mockup.graphics.iconGrid', 70, 70, { gridSize: '2,2' }));
    expect(d).toEqual([
      'M0 0L28 0L28 28L0 28Z',
      'M0 42L28 42L28 70L0 70Z',
      'M42 0L70 0L70 28L42 28Z',
      'M42 42L70 42L70 70L42 70Z',
      'M0 0L28 28M28 0L0 28',
      'M0 42L28 70M28 42L0 70',
      'M42 0L70 28M70 0L42 28',
      'M42 42L70 70M70 42L42 70',
    ]);
  });

  it('videoPlayer: 再生の三角。begin の無いまま続けた経路 (音の印) は、draw.io と同じく描かない', () => {
    // v24.7.5 の元は barHeight を文字列 ('30') のまま読むので、+ は文字列のつなぎになる (draw.io と同じに写す):
    // 高さ h = max(200, '30' + 10 = '3010') = 3010。三角の大きさ 9、左 9、上 3010 - ('30' + 9 = '309') / 2 = 2855.5
    const d = ds(draw('mxgraph.mockup.containers.videoPlayer', 300, 200));
    expect(d).toContain('M0 0L300 0L300 3010L0 3010Z');
    expect(d).toContain('M9 2855.5L18 2860L9 2864.5Z');
    // 音の印 (begin の無いまま続けた経路。左は '30' + 1.5 = '301.5') は描かない
    expect(d.some((s) => s?.startsWith('M301.5'))).toBe(false);
  });

  it('button: 既定の文字 (Main Text) を太字で真ん中に。色は textColor', () => {
    const out = draw('mxgraph.mockup.buttons.button', 160, 40, { textColor: '#ff0000' });
    const t = out.find((s) => s.startsWith('<text'));
    expect(t).toContain('>Main Text</text>');
    expect(t).toContain('font-weight="bold"');
    expect(t).toContain('fill="#ff0000"');
    expect(t).toContain('text-anchor="middle"');
  });

  it('horButtonBar: 選んだボタン (+ の付いた名前) を fillColor2 で塗り、名前の + は描かない', () => {
    const out = draw('mxgraph.mockup.buttons.horButtonBar', 300, 30, { mainText: 'A,+B,C' });
    expect(out.some((s) => s.includes('fill="#008cff"'))).toBe(true);
    const texts = out.filter((s) => s.startsWith('<text')).map((s) => />([^<]*)</.exec(s)?.[1]);
    expect(texts).toEqual(['A', 'B', 'C']);
  });

  it('ruler2: セルの値を目盛りの単位にして、数を書く', () => {
    const out = draw('mxgraph.mockup.misc.ruler2', 400, 30, {}, '1');
    expect(out.some((s) => s.startsWith('<text') && s.includes('>2</text>'))).toBe(true);
  });

  it('繰り返しで描く部分は、回数の上限 (日・アイコンは 1000、目盛りは 10000) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    // 暦の日: 5000 日は、1000 日で止まる (1000 日と同じ絵)
    expect(draw('mxgraph.mockup.forms.calendar', 175, 175, { days: '5000' })).toEqual(draw('mxgraph.mockup.forms.calendar', 175, 175, { days: '1000' }));
    // アイコンの升目: 2000 × 2000 は、四角とばつ印を 1000 個ずつ (箱の大きさは 2000 × 2000 のまま)
    const grid = ds(draw('mxgraph.mockup.graphics.iconGrid', 3000, 3000, { gridSize: '2000,2000' }));
    expect(grid).toHaveLength(2000);
    expect(grid[0]).toBe('M0 0L1 0L1 1L0 1Z');
    // 評価の印: grade 5000・ratingScale 9000 は、塗った印と空の印を 1000 個ずつ
    expect(ds(draw('mxgraph.mockup.misc.rating', 100, 10, { grade: '5000', ratingScale: '9000' }))).toHaveLength(2000);
    // 物差し: 幅 200000 の目盛り (10 ごと) は、10000 本で止まる (最後は x = 100000)
    for (const shape of ['mxgraph.mockup.misc.ruler', 'mxgraph.mockup.misc.ruler2']) {
      // 背景の四角の後の経路 (ruler2 は 10 本ごとに数を書くので、経路が分かれる) の線を数える
      const ticks = ds(draw(shape, 200000, 30, {}, '1')).slice(1).join('');
      expect(ticks.match(/M/g), shape).toHaveLength(10000);
      expect(ticks, shape).toMatch(/M100000 \S+L100000 30$/);
    }
  });
});
