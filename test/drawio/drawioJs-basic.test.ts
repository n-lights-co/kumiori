import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_BASIC } from '../../src/drawio/drawioJs/basic';
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
  // none と書いたキーは無いものとして読む (mxStylesheet.getCellStyle)
  const has = (k: string) => Object.hasOwn(style, k) && style[k] !== 'none';
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => num(has(k) ? style[k] : undefined, d),
    color: (k, d) => (Object.hasOwn(style, k) ? (style[k] === 'none' ? undefined : style[k]) : d),
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
  SHAPES_BASIC[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse);

describe('draw.io の mxBasic.js・mxSysML.js・mxShapeBasicRect2 の形', () => {
  it('どの形も、描いたものが SVG として読める (sysml.none と、記号の無い sysml.composite・向きの無い sysml.itemFlow は何も描かない)', () => {
    const empty = ['mxgraph.sysml.none', 'mxgraph.sysml.composite', 'mxgraph.sysml.itemFlow'];
    for (const name of Object.keys(SHAPES_BASIC)) {
      const out = draw(name, 120, 90, name === 'mxgraph.basic.polygon' ? { polyCoords: '[[0,0],[1,0.5],[0.2,1]]' } : {});
      if (empty.includes(name)) expect(out, name).toEqual([]);
      else expect(out.length, name).toBeGreaterThan(0);
      if (out.length) expect(readable(out), name).not.toBeNull();
    }
    expect(Object.keys(SHAPES_BASIC).length).toBe(78);
  });

  it('cross2・octagon2: 手で計算した経路', () => {
    expect(ds(draw('mxgraph.basic.cross2', 100, 80, { dx: '10' }))).toEqual(['M60 0L60 30L100 30L100 50L60 50L60 80L40 80L40 50L0 50L0 30L40 30L40 0Z']);
    // dx の 2 倍 (20) を、幅・高さの半分までに収める
    expect(ds(draw('mxgraph.basic.octagon2', 100, 80, { dx: '10' }))).toEqual(['M20 0L80 0L100 20L100 60L80 80L20 80L0 60L0 20Z']);
  });

  it('pie: 既定 (0.25〜0.75) は右から左への下の半周', () => {
    expect(ds(draw('mxgraph.basic.pie', 100, 80))).toEqual(['M50 40L100 40A50 40 0 1 1 0 40Z']);
  });

  it('sysml.package: 四角と、見出し (labelX 既定 90) の線', () => {
    expect(ds(draw('mxgraph.sysml.package', 100, 80))).toEqual(['M0 0L100 0L100 80L0 80Z', 'M0 20L80 20L90 10L90 0']);
    expect(ds(draw('mxgraph.sysml.package2', 100, 80, { labelX: '50' }))).toEqual(['M0 0L100 0L100 80L0 80Z', 'M0 20L40 20L50 10L50 0L0 0Z']);
  });

  it('basic.rect: 四角 (塗りと縁)、丸めた角、辺の一部と frame', () => {
    expect(ds(draw('mxgraph.basic.rect', 100, 80))).toEqual(['M0 0L100 0L100 80L0 80L0 0Z', 'M0 0L100 0L100 80L0 80L0 0Z']);
    const r = 'M0 10A10 10 0 0 1 10 0L90 0A10 10 0 0 1 100 10L100 70A10 10 0 0 1 90 80L10 80A10 10 0 0 1 0 70L0 10Z';
    expect(ds(draw('mxgraph.basic.rect', 100, 80, { rectStyle: 'rounded', size: '10' }))).toEqual([r, r]);
    // 上と下の辺だけ (塗りは、無い辺の角を角の点への直線で回る。線は上の辺と下の辺を別に引く)
    expect(ds(draw('mxgraph.basic.rect', 100, 80, { left: '0', right: '0' }))).toEqual(['M0 0L0 0L100 0L100 80L100 80L0 80L0 0Z', 'M0 0L100 0', 'M100 80L0 80']);
    // frame: 左の辺だけの帯を、外と内 (indent 2) を結んで塗る
    expect(ds(draw('mxgraph.basic.rect', 100, 80, { top: '0', right: '0', bottom: '0', rectOutline: 'frame' }))).toEqual(['M0 80L0 0L2 0L2 80Z']);
  });

  it('basic.rect: 辺・角・縁のどの組み合わせも SVG として読める', () => {
    for (let m = 1; m < 16; m++)
      for (const rectOutline of ['single', 'double', 'frame'])
        for (const rectStyle of ['square', 'rounded', 'snip', 'invRound', 'fold']) {
          const style = { top: String(m & 1), right: String((m >> 1) & 1), bottom: String((m >> 2) & 1), left: String((m >> 3) & 1), rectOutline, rectStyle, fillColor2: '#ff0000' };
          const out = draw('mxgraph.basic.rect', 100, 80, style);
          expect(out.length, JSON.stringify(style)).toBeGreaterThan(0);
          expect(readable(out), JSON.stringify(style)).not.toBeNull();
          expect(out.join(''), JSON.stringify(style)).not.toContain('NaN');
        }
  });

  it('basic.arc: 楕円の弧 (線の端の形は付けない)', () => {
    // 既定 (0.25〜0.75) はちょうど半周で、大きい弧の旗は立てない (angDiff > π のときだけ)
    expect(ds(draw('mxgraph.basic.arc', 100, 80))).toEqual(['M100 40A50 40 0 0 1 0 40']);
    // endArrow は読まない (v24.7.5 の形は楕円を寄せず、矢の頭も描かない)
    expect(ds(draw('mxgraph.basic.arc', 100, 80, { endArrow: 'classic' }))).toEqual(['M100 40A50 40 0 0 1 0 40']);
  });

  it('basic.polygon: 直線の辺と、閉じない折れ線', () => {
    // polyCurves は読まない (v24.7.5 の形は辺を直線で結ぶ)
    expect(ds(draw('mxgraph.basic.polygon', 100, 100, { polyCoords: '[[0,0],[1,0],[1,1]]', polyCurves: '[["Q",0.5,0.5]]' }))).toEqual(['M0 0L100 0L100 100Z']);
    expect(ds(draw('mxgraph.basic.polygon', 100, 100, { polyCoords: '[[0,0],[1,0],[1,1]]', polyline: '1' }))).toEqual(['M0 0L100 0L100 100']);
    expect(draw('mxgraph.basic.polygon', 100, 100, { polyCoords: '[[0,0' })).toEqual([]);
  });

  it('basic.patternFillRect: 模様の線と縁', () => {
    const out = draw('mxgraph.basic.patternFillRect', 20, 10, { fillStyle: 'vert', step: '10', top: '0' });
    expect(ds(out)).toEqual(['M0 0L20 0L20 10L0 10Z', 'M0 0L0 10M10 0L10 10M20 0L20 10', 'M20 0L20 10L0 10L0 0']);
    expect(out[1]).toContain('stroke="#cccccc"');
  });

  it('basic.patternFillRect: 模様の線は、回数の上限 (10000) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    // 間隔が 0 だと線が尽きないが、10000 本で止まる
    expect(ds(draw('mxgraph.basic.patternFillRect', 20, 10, { fillStyle: 'vert', step: '0' }))[1]?.match(/M/g)).toHaveLength(10000);
    // 幅 200000・間隔 10 は 20001 本だが、間はそのまま 10 で、始めから 10000 本 (最後は x = 99990)
    const d = ds(draw('mxgraph.basic.patternFillRect', 200000, 10, { fillStyle: 'vert', step: '10' }))[1] ?? '';
    expect(d.match(/M/g)).toHaveLength(10000);
    expect(d).toMatch(/^M0 0L0 10M10 0L10 10M.*M99990 0L99990 10$/);
  });

  it('sysml.composite: 記号を重ねる (symbol0 は全体、symbol1 は置き場を決めて)', () => {
    const out = draw('mxgraph.sysml.composite', 100, 80, { symbol0: 'mxgraph.sysml.rect', symbol1: 'mxgraph.sysml.rect', symbol1Width: '10', symbol1Height: '10', symbol1Align: 'right', symbol1VerticalAlign: 'bottom' });
    expect(ds(out)).toEqual(['M0 0L100 0L100 80L0 80Z', 'M90 70L100 70L100 80L90 80Z']);
  });

  it('sysml.itemFlow・sysml.port: 種類ごとの矢印', () => {
    expect(ds(draw('mxgraph.sysml.itemFlow', 100, 80, { flowDir: 'e', flowType: 'out' }))).toEqual(['M0 0L90 0L90 80L0 80Z', 'M80 30L100 30L100 50L80 50Z', 'M82 40L98 40M94 35L98 40L94 45']);
    expect(ds(draw('mxgraph.sysml.port', 20, 20, { sysMLPortType: 'flowE' }))).toEqual(['M0 0L20 0L20 20L0 20Z', 'M10 5L15 10L10 15M15 10L5 10']);
  });
});
