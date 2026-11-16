import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_ELECTRICAL } from '../../src/drawio/drawioJs/electrical';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
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
    direction: style.direction ?? 'east',
    value: '',
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_ELECTRICAL[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.filter((s) => s.startsWith('<path')).map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

describe('draw.io の電気の図・P&ID の形 (mxElectrical.js・pid2/*.js)', () => {
  it('66 の形を登録する', () => {
    expect(Object.keys(SHAPES_ELECTRICAL).length).toBe(66);
  });

  it('どの形も、描いたものが SVG として読める', () => {
    const variants: Record<string, Record<string, string>[]> = {
      'mxgraph.electrical.transmission.twoLineBusElbow': [{}, { notch: '20' }],
      'mxgraph.electrical.logic_gates.logic_gate': [{}, { operation: 'or', negating: '1' }, { operation: 'xor', numInputs: '3', negating: '1', negSize: '0.2' }],
      'mxgraph.electrical.logic_gates.dual_inline_ic': [{}, { startPin: 'e', pinStyle: 'square' }, { pinLabelType: 'cust', labelNames: 'a,b,c' }],
      'mxgraph.electrical.logic_gates.qfp_ic': [{}, { startPin: 'ne', pinStyle: 'square' }],
      'mxgraph.electrical.abstract.mux2': [{}, { operation: 'demux', selectorPins: '2', direction: 'south' }],
      'mxgraph.electrical.signal_sources.source': ['ac', 'none', 'square', 'triangular', 'sawtooth', 'noise', 'ideal', 'expSquib', 'pulse', 'invPulse', 'chopSquare', 'stepOn', 'stepOff', 'dc1', 'dc2', 'dc3'].map((t) => ({
        elSignalType: t,
        elSourceType: t === 'dc3' ? 'dependent' : 'independent',
      })),
      'mxgraph.pid2valves.valve': ['butterfly', 'check', 'gate', 'globe', 'needle', 'plug', 'selfDrain', 'angle', 'angleGlobe', 'threeWay', 'ball'].flatMap((v) =>
        ['none', 'man', 'diaph', 'balDiaph', 'motor', 'spring', 'pilot', 'solenoidManRes', 'singActing', 'dblActing', 'pilotCyl', 'elHyd'].map((a) => ({ valveType: v, actuator: a, defState: 'closed' })),
      ),
      'mxgraph.pid2valves.blockBleedValve': [{}, { actuator: 'motor' }, { actuator: 'pilotCyl' }],
      'mxgraph.pid2inst.indicator': ['inst', 'ctrl', 'func', 'plc'].map((t) => ({ indType: t, mounting: 'local' })),
      'mxgraph.pid2misc.column': ['common', 'fixed', 'fluid', 'baffle', 'valve', 'bubble', 'nozzle', 'tray'].map((t) => ({ columnType: t })),
    };
    for (const name of Object.keys(SHAPES_ELECTRICAL)) {
      for (const style of variants[name] ?? [{}, { elSwitchState: 'off' }, { elSwitchState: '2' }, { mounting: 'inaccessible' }]) {
        const out = draw(name, 160, 300, style);
        expect(out.length, `${name} ${JSON.stringify(style)}`).toBeGreaterThan(0);
        expect(readable(out), name).not.toBeNull();
      }
    }
  });

  it('straightBus: 下向きの矢の形 (y1 = min(h, w) / 2)', () => {
    expect(ds(draw('mxgraph.electrical.transmission.straightBus', 100, 40))).toEqual(['M80 0L80 20L100 20L50 40L0 20L20 20L20 0']);
  });

  it('twoLineBusElbow: 2 本の曲がった線 (notch の既定はソースの this.notch の 0)', () => {
    expect(ds(draw('mxgraph.electrical.transmission.twoLineBusElbow', 100, 80, { notch: '20' }))).toEqual(['M0 80L100 80L100 0', 'M0 60L80 60L80 0']);
    expect(ds(draw('mxgraph.electrical.transmission.twoLineBusElbow', 100, 80))).toEqual(['M0 80L100 80L100 0', 'M0 80L100 80L100 0']);
  });

  it('logic_gate: 入りと出の線と、and の胴', () => {
    expect(ds(draw('mxgraph.electrical.logic_gates.logic_gate', 100, 60))).toEqual(['M80 30L100 30M0 15L20 15M0 45L20 45', 'M20 0L50 0A30 30 0 0 1 50 60L20 60Z']);
  });

  it('pid2inst.logic: 菱形と、置き場所 (mounting) の線', () => {
    expect(ds(draw('mxgraph.pid2inst.logic', 100, 60, { mounting: 'room' }))).toEqual(['M0 30L50 0L100 30L50 60Z', 'M0 30L100 30']);
    expect(ds(draw('mxgraph.pid2inst.logic', 100, 60, { mounting: 'local' }))).toEqual(['M0 30L50 0L100 30L50 60Z', 'M2 28.8L98 28.8M2 31.2L98 31.2']);
    // inaccessible は、線を点線にする
    expect(draw('mxgraph.pid2inst.logic', 100, 60, { mounting: 'inaccessible' })[1]).toContain('stroke-dasharray="3 3"');
  });

  it('pid2valves.valve: 仕切り弁 (既定) と、手動の操作部 (actH = h × 0.4)', () => {
    expect(ds(draw('mxgraph.pid2valves.valve', 100, 60))).toEqual(['M0 0L50 30L0 60ZM100 0L50 30L100 60Z']);
    // 閉じ (defState=closed) は、線の色で塗る
    expect(draw('mxgraph.pid2valves.valve', 100, 60, { defState: 'closed' })[0]).toContain('fill="#000000"');
    expect(ds(draw('mxgraph.pid2valves.valve', 100, 100, { actuator: 'man' }))).toEqual(['M25 15L75 15M50 15L50 70', 'M0 40L50 70L0 100ZM100 40L50 70L100 100Z']);
  });

  it('mux2: 向き (direction) を打ち消す向きに字を回す', () => {
    const texts = draw('mxgraph.electrical.abstract.mux2', 60, 100, { direction: 'south' }).filter((s) => s.startsWith('<text'));
    expect(texts.length).toBe(3);
    expect(texts[0]).not.toContain('matrix(1 0 0 1 0 0)');
    const plain = draw('mxgraph.electrical.abstract.mux2', 60, 100).filter((s) => s.startsWith('<text'));
    expect(plain[0]).toContain('matrix(1 0 0 1 0 0)');
  });

  it('batteryStack: 2 つ目からの継ぎの点線の後も、ソースのとおり点線のまま (setDashed の字の "0" は真)', () => {
    const out = draw('mxgraph.electrical.miscellaneous.batteryStack', 100, 40);
    const dashed = out.map((s) => s.includes('stroke-dasharray'));
    // 0: 端の線、1・2: 1 つ目の極板、3・4: 2 つ目の極板、5: 継ぎの点線、6 から: 3 つ目の極板 (点線のまま)
    expect(dashed.slice(0, 7)).toEqual([false, false, false, false, false, true, true]);
    expect(dashed.at(-1)).toBe(true);
  });
  it('繰り返しで描く部分は、回数の上限 (足・電池・段は 1000、mux の選ぶ足は 10) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    const texts = (out: string[]) => out.filter((s) => s.startsWith('<text')).length;
    const moves = (out: string[]) => ds(out).join('').match(/M/g)?.length ?? 0;
    // 足の間が 0 でも、辺ごとに 1000 本 (両側の番号で 2000 の字) で止まる
    expect(texts(draw('mxgraph.electrical.logic_gates.dual_inline_ic', 100, 60, { pinSpacing: '0' }))).toBe(2000);
    expect(texts(draw('mxgraph.electrical.logic_gates.qfp_ic', 100, 100, { pinSpacing: '-5' }))).toBe(4000);
    // 上限までは、ソースと同じ間で描く (足の間 0.04: 60 / 0.04 = 1500 本のうち、上から 1000 本。最後は 0.02 + 999 × 0.04 = 39.98)
    const many = draw('mxgraph.electrical.logic_gates.dual_inline_ic', 100, 60, { pinSpacing: '0.04' });
    expect(texts(many)).toBe(2000);
    expect(ds(many)[1]).toMatch(/^M0 0\.02L10 0\.02M90 0\.02L100 0\.02M0 0\.06L.*M0 39\.98L10 39\.98M90 39\.98L100 39\.98$/);
    // 入りの線 5000 本のうち 1000 本 (間は 100 / 5000 = 0.02 のまま)。出の線と合わせて 1001
    const gate = ds(draw('mxgraph.electrical.logic_gates.logic_gate', 100, 100, { numInputs: '5000' }))[0] ?? '';
    expect(gate.match(/M/g)?.length).toBe(1001);
    expect(gate).toContain('M0 0.01L20 0.01M0 0.03L20 0.03');
    // 高さが 0 だと電池の数が無限になるが、1000 個で止まる
    expect(draw('mxgraph.electrical.miscellaneous.batteryStack', 100, 0).length).toBeGreaterThan(1000);
    // 幅が 0 の塔の段 (間が 0)、高さが 0 のコンベヤーの受け (間が 0) も、1000 で止まる
    expect(moves(draw('mxgraph.pid2misc.column', 0, 300, { columnType: 'tray' }))).toBeGreaterThanOrEqual(1000);
    expect(draw('mxgraph.pid2misc.conveyor', 100, 0).length).toBeGreaterThanOrEqual(2000);
    // mux の選ぶ足 40 本 (入りは 2 の 40 乗) は、選ぶ足 10 本・入り 1024 本で止まる
    const mux = draw('mxgraph.electrical.abstract.mux2', 60, 100, { selectorPins: '40' });
    expect(mux.filter((s) => s.startsWith('<text') && />S\d+</.test(s)).length).toBe(10);
    expect(mux.filter((s) => s.startsWith('<text') && />\d+</.test(s)).length).toBe(1024);
  });
});
