import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_BPMN } from '../../src/drawio/drawioJs/bpmn';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1。図形ライブラリの形は無い) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: () => undefined, gradient: () => 'url(#g)', stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } } as never, style: {} },
  );
  // draw.io の mxStylesheet と同じく、none の値は無いものとして読む
  const has = (k: string) => Object.hasOwn(style, k) && style[k] !== 'none';
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => (has(k) ? num(style[k], d) : d),
    color: (k, d) => (has(k) ? style[k] : d === 'none' ? undefined : d),
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
  SHAPES_BPMN[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

/** 形ごとの、印などを出すスタイル (既定では何も描かない形に、描く値を渡す) */
const STYLES: Record<string, Record<string, string>> = {
  'mxgraph.bpmn.shape': { outline: 'throwing', symbol: 'message', background: 'gateway' },
  'mxgraph.bpmn.event': { outline: 'end', symbol: 'error' },
  'mxgraph.bpmn.task': { bpmnShapeType: 'transaction', taskMarker: 'send', isLoopMultiParallel: '1', isLoopSub: '1', outline: 'catching', symbol: 'timer' },
  'mxgraph.bpmn.data': { bpmnTransferType: 'output', isCollection: '1' },
  'mxgraph.bpmn.swimlane': { isCollection: '1', footerSize: '10', separatorColor: '#ff0000' },
  'mxgraph.bpmn.conversation': { bpmnConversationType: 'call', isLoopSub: '1' },
  'mxgraph.lean_mapping.timeline2': { dy1: '0', dx2: '20', dy2: '1', dx3: '40', dy3: '0', dx4: '60', dy4: '1', dx5: '80', dy5: '0', dy6: '1' },
};

describe('draw.io の BPMN・リーン・間取り図・ER の形 (JavaScript で書かれた形)', () => {
  it('どの形も、描いたものが SVG として読める', () => {
    for (const name of Object.keys(SHAPES_BPMN)) {
      const out = draw(name, 160, 120, STYLES[name] ?? {});
      // 線をつなぐための形 (mxgraph.er.anchor) は何も描かない
      if (name === 'mxgraph.er.anchor') expect(out, name).toEqual([]);
      else expect(out.length, name).toBeGreaterThan(0);
      if (out.length) expect(readable(out), name).not.toBeNull();
    }
  });

  it('移した形の数 (レジストリの名前)', () => {
    const names = Object.keys(SHAPES_BPMN);
    expect(names.filter((n) => n.startsWith('mxgraph.bpmn.'))).toHaveLength(8);
    expect(names.filter((n) => n.startsWith('mxgraph.lean_mapping.'))).toHaveLength(27);
    expect(names.filter((n) => n.startsWith('mxgraph.floorplan.'))).toHaveLength(28);
    expect(names.filter((n) => n.startsWith('mxgraph.er.'))).toHaveLength(12);
  });

  it('work_cell・wallCorner・rrect の経路', () => {
    expect(ds(draw('mxgraph.lean_mapping.work_cell', 100, 80))).toEqual(['M0 0L100 0L100 80L65 80L65 32L35 32L35 80L0 80Z']);
    expect(ds(draw('mxgraph.floorplan.wallCorner', 100, 80))).toEqual(['M0 80L0 0L100 0L100 10L10 10L10 80Z']);
    expect(ds(draw('mxgraph.floorplan.wallCorner', 100, 80, { wallThickness: '20' }))).toEqual(['M0 80L0 0L100 0L100 20L20 20L20 80Z']);
    expect(ds(draw('mxgraph.er.rrect', 100, 80))).toEqual(['M10 0L90 0A10 10 0 0 1 100 10L100 70A10 10 0 0 1 90 80L10 80A10 10 0 0 1 0 70L0 10A10 10 0 0 1 10 0Z']);
  });

  it('gateway2 の parallel: 菱形と、真ん中の半分の大きさの十字 (線の色で塗る)', () => {
    const out = draw('mxgraph.bpmn.gateway2', 100, 80, { gwType: 'parallel' });
    expect(ds(out)).toEqual(['M50 0L100 40L50 80L0 40Z', 'M44 20L56 20L56 35.2L75 35.2L75 44.8L56 44.8L56 60L44 60L44 44.8L25 44.8L25 35.2L44 35.2Z']);
    expect(out[1]).toContain('fill="#000000"');
  });

  it('event の catching: 外の円と、2 内側の円 (線だけ)', () => {
    const out = draw('mxgraph.bpmn.event', 40, 40, { outline: 'catching' });
    expect(ds(out)).toEqual(['M0 20A20 20 0 1 1 40 20A20 20 0 1 1 0 20Z', 'M2 20A18 18 0 1 1 38 20A18 18 0 1 1 2 20Z']);
    expect(out[1]).toContain('fill="none"');
  });

  it('task: mxgraph.basic.rect の四角 (外形の塗りと線)。transaction は内側 3 の二重の線', () => {
    expect(ds(draw('mxgraph.bpmn.task', 120, 80))).toEqual(['M0 0L120 0L120 80L0 80L0 0Z', 'M0 0L120 0L120 80L0 80L0 0Z']);
    expect(ds(draw('mxgraph.bpmn.task', 120, 80, { bpmnShapeType: 'transaction' }))[1]).toBe('M0 0L120 0L120 80L0 80L0 0ZM3 77L3 77L117 77L117 3L3 3L3 77Z');
    // rounded の角 (size 10): 外形は arcTo の角
    expect(ds(draw('mxgraph.bpmn.task', 120, 80, { rectStyle: 'rounded' }))[0]).toBe('M0 10A10 10 0 0 1 10 0L110 0A10 10 0 0 1 120 10L120 70A10 10 0 0 1 110 80L10 80A10 10 0 0 1 0 70L0 10Z');
  });

  it('event の throwing の印は、塗りと線の色を入れ替える', () => {
    const out = draw('mxgraph.bpmn.event', 40, 40, { outline: 'throwing', symbol: 'signal' });
    // 縁の 2 つの円と、塗りを線の色にした三角 (inverse なので塗るだけ)
    expect(out).toHaveLength(3);
    expect(out[2]).toContain('fill="#000000" stroke="none"');
  });

  it('繰り返しで描く部分は、回数の上限 (10000) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    // 階段: 幅 300000 なら 25 ごとに 11999 本だが、10000 本で止まる (最後は x = 250000)
    const stairs = draw('mxgraph.floorplan.stairs', 300000, 60);
    const d = ds(stairs).find((s) => s?.startsWith('M25 0L25 60')) ?? '';
    expect(d.match(/M/g)).toHaveLength(10000);
    expect(d).toMatch(/M250000 0L250000 60$/);
    // 踊り場のある階段も同じ (ふつうの幅では、25 ごとに右の踊り場の手前まで)
    const rest = ds(draw('mxgraph.floorplan.stairsRest', 300000, 60)).find((s) => s?.startsWith('M25 0L25 60')) ?? '';
    expect(rest.match(/M/g)).toHaveLength(10000);
    expect(ds(draw('mxgraph.floorplan.stairsRest', 160, 60)).find((s) => s?.startsWith('M25 0L25 60'))).toBe('M25 0L25 60M50 0L50 60M75 0L75 60M100 0L100 60M125 0L125 60');
    // 共有の工程の斜めの線: 10 ずつ 10000 回で止まる (見出しの下の 20 から 100000 までの 9999 本)
    const shared = draw('mxgraph.lean_mapping.manufacturing_process_shared', 100000, 100);
    const last = ds(shared).at(-1) ?? '';
    expect(last.match(/M/g)).toHaveLength(9999);
    expect(last).toMatch(/M99900 100L99988 12$/);
  });
});
