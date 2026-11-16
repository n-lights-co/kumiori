import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas, type Pt } from '../../src/drawio/drawioCanvas';
import { EDGES_ARROWS, SHAPES_ARROWS } from '../../src/drawio/drawioJs/arrows';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num, parseXml, type XEl } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 試しの図形ライブラリの形 (24 × 24 の四角を塗る)。names に挙げた名前だけ引ける */
const square = parseXml('<shape w="24" h="24" aspect="variable"><background><rect x="0" y="0" w="24" h="24"/></background><foreground><fill/></foreground></shape>') as XEl;

function setup(style: Record<string, string>, names: string[]) {
  const lookup = (n: string) => (names.includes(n) ? square : undefined);
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: lookup, gradient: (_a: string, _b: string, _d: string, a1 = 1, a2 = 1) => (a1 === 1 && a2 === 1 ? 'url(#g)' : `url(#g-${a1}-${a2})`), stencilCtx: { lookup, warn: () => {}, budget: { ops: 0 } }, style: {} },
  );
  const has = (k: string) => Object.hasOwn(style, k);
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => num(style[k], d),
    color: (k, d) => (has(k) ? (style[k] === 'none' ? undefined : style[k]) : d === 'none' ? undefined : d),
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
  return { c, e };
}

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}, names: string[] = []): string[] {
  const { c, e } = setup(style, names);
  SHAPES_ARROWS[name](c, w, h, e);
  return c.out;
}
function drawEdge(name: string, pts: Pt[], style: Record<string, string> = {}): string[] {
  const { c, e } = setup(style, []);
  EDGES_ARROWS[name](c, pts, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const svgOk = (out: string[]) =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

const KUBE = ['mxgraph.kubernetes.frame', 'mxgraph.kubernetes.pod', 'mxgraph.kubernetes2.pod', 'mxgraph.kubernetes2.control_plane'];

describe('draw.io の arrows2・infographic・eip・kubernetes・cabinets の形', () => {
  it('どの形も、描いたものが SVG として読める', () => {
    for (const name of Object.keys(SHAPES_ARROWS)) {
      const style: Record<string, string> = name.startsWith('mxgraph.kubernetes') ? { prIcon: 'pod', kubernetesLabel: '1' } : { strokeColor: '#333333', rounded: '1', headCrossline: '1', tailCrossline: '1', hasStand: '1' };
      const out = draw(name, 120, 80, style, KUBE);
      // EIP の anchor は、ソースでも何も描かない。tailedArrow・tailedNotchedArrow・uTurnArrow は、v24.7.5 では dx1・dx2 などの既定が無く、
      // キーが無いと NaN の経路になって何も見えない
      if (['mxgraph.eip.anchor', 'mxgraph.arrows2.tailedArrow', 'mxgraph.arrows2.tailedNotchedArrow', 'mxgraph.arrows2.uTurnArrow'].includes(name)) expect(out, name).toEqual([]);
      else expect(out.length, name).toBeGreaterThan(0);
      if (out.length) expect(svgOk(out), name).not.toBeNull();
      expect(out.join(''), name).not.toContain('NaN');
    }
    for (const name of Object.keys(EDGES_ARROWS)) {
      const out = drawEdge(name, [{ x: 10, y: 10 }, { x: 50, y: 30 }, { x: 200, y: 100 }]);
      expect(out.length, name).toBeGreaterThan(0);
      expect(svgOk(out), name).not.toBeNull();
    }
  });

  it('arrows2.arrow: 矢の外形と、頭・尾の横線', () => {
    // dy = 60 × 0.5 × 0.6 = 18
    expect(ds(draw('mxgraph.arrows2.arrow', 100, 60, { dx: '20', dy: '0.6' }))).toEqual(['M0 18L80 18L80 0L100 30L80 60L80 42L0 42L0 30Z']);
    expect(ds(draw('mxgraph.arrows2.arrow', 100, 60, { dx: '20', dy: '0.6', notch: '10', headCrossline: '1', tailCrossline: '1' }))).toEqual([
      'M0 18L80 18L80 0L100 30L80 60L80 42L0 42L10 30Z',
      'M80 18L80 42',
      'M10 18L10 42',
    ]);
    // 数の 0 は偽 (mxStylesheet が数に読む)
    expect(draw('mxgraph.arrows2.arrow', 100, 60, { headCrossline: '0' })).toHaveLength(1);
  });

  it('arrows2.bendArrow: rounded=1 の円弧', () => {
    // dy 10・dx 20・arrowHead 40 (既定)
    expect(ds(draw('mxgraph.arrows2.bendArrow', 100, 100, { dx: '20', dy: '10', rounded: '1' }))).toEqual([
      'M80 0L100 20L80 40L80 30L22 30A2 2 0 0 0 20 32L20 100L10 100L0 100L0 30A20 20 0 0 1 20 10L80 10Z',
    ]);
  });

  it('arrows2.tailedArrow・uTurnArrow: v24.7.5 は dx1・dy1・dx2・dy2 の既定を持たない', () => {
    const k = { dx1: '20', dy1: '10', dx2: '25', dy2: '30' };
    // x2 = 25 + 30 × (30 − 10) / 30 = 45
    expect(ds(draw('mxgraph.arrows2.tailedArrow', 100, 80, k))).toEqual(['M0 10L25 10L45 30L80 30L80 30L100 40L80 50L80 50L45 50L25 70L0 70L0 40Z']);
    // dy1 が無いと、3 つ目の点から NaN になり、その手前まで (閉じない) を描く
    expect(ds(draw('mxgraph.arrows2.tailedArrow', 100, 80, { dx2: '25', dy2: '30' }))).toEqual(['M0 10L25 10']);
    expect(draw('mxgraph.arrows2.tailedNotchedArrow', 100, 80, { dx1: '20', dy1: '10', dx2: '25' })).toEqual([]);
    // uTurnArrow の dx2 は上を抑えない
    expect(ds(draw('mxgraph.arrows2.uTurnArrow', 100, 100, { dx2: '1e8' }))[0]).toMatch(/^M\S+ 0L100000\d+(\.\d+)? 20L/);
  });

  it('infographic.parallelogram・barCallout・flag', () => {
    expect(ds(draw('mxgraph.infographic.parallelogram', 100, 60))).toEqual(['M0 60L20 0L100 0L80 60Z']);
    // x1 = 50 − 20 × 0.35 = 43、x2 = 57
    expect(ds(draw('mxgraph.infographic.barCallout', 100, 60, { dx: '50', dy: '20' }))).toEqual(['M0 0L100 0L100 40L57 40L50 60L43 40L0 40Z']);
    const flag = draw('mxgraph.infographic.flag', 100, 60, { dx: '30', dy: '10' });
    expect(ds(flag)).toEqual(['M0 0L100 0L100 50L30 50L15 60L0 50Z', 'M0 0L30 0L30 50L15 60L0 50Z']);
    expect(flag[1]).toContain('fill="#ffffff" fill-opacity="0.2" stroke="none"');
  });

  it('infographic.cylinder: 両端の不透明度 0.4 のグラデーションを重ねる', () => {
    const out = draw('mxgraph.infographic.cylinder', 100, 80);
    expect(ds(out)).toEqual(['M0 10A50 10 0 0 1 100 10L100 70A50 10 0 0 1 0 70Z', 'M0 10A50 10 0 0 0 100 10L100 70A50 10 0 0 1 0 70Z', 'M0 10A50 10 0 0 1 100 10L100 70A50 10 0 0 1 0 70Z']);
    expect(out[1]).toContain('fill="url(#g-0.4-0.4)" stroke="none"');
    expect(out[2]).toContain('fill="none" stroke="#000000"');
  });

  it('eip: deadLetterChannel の八角形・dataChannel の四角の数', () => {
    const out = draw('mxgraph.eip.deadLetterChannel', 100, 40);
    expect(ds(out)[2]).toBe('M44 17L47 14L53 14L56 17L56 23L53 26L47 26L44 23Z');
    expect(out[2]).toContain('fill="#ff0000"');
    expect(out[3]).toContain('d="M46 20L54 20" fill="none" stroke="#ffffff" stroke-width="2"');
    // i × 20 + 10 < 100 − 14 の i = 1, 2, 3
    expect(draw('mxgraph.eip.dataChannel', 100, 40).slice(2)).toHaveLength(3);
    // v24.7.5 の色は決まっていて、後の版の channelColor1・markerColor などのキーは読まない
    const colored = draw('mxgraph.eip.deadLetterChannel', 100, 40, { channelColor1: '#123456', markerColor: '#00ff00', markerIconColor: '#0000ff' });
    expect(colored[1]).toContain('fill="#e6e6e6"');
    expect(colored[2]).toContain('fill="#ff0000"');
    expect(colored[3]).toContain('stroke="#ffffff"');
  });

  it('cabinets: 台の高さ (hasStand が数の 1 なら 40、キーが無ければ 15)・寸法の線', () => {
    expect(ds(draw('mxgraph.cabinets.cabinet', 100, 100, { hasStand: '1' }))[3]).toBe('M0 60L100 60L100 100L0 100Z');
    expect(ds(draw('mxgraph.cabinets.cabinet', 100, 100))[3]).toBe('M0 85L100 85L100 100L0 100Z');
    expect(ds(draw('mxgraph.cabinets.dimension', 100, 60))).toEqual(['M0 20L100 20M10 15L0 20L10 25M90 15L100 20L90 25M0 15L0 60M100 15L100 60']);
    expect(ds(draw('mxgraph.cabinets.dimensionBottom', 100, 60))).toEqual(['M0 40L100 40M10 45L0 40L10 35M90 45L100 40L90 35M0 45L0 0M100 45L100 0']);
  });

  it('kubernetes.icon2: 枠 2 つ・アイコン・ラベル', () => {
    const out = draw('mxgraph.kubernetes.icon2', 100, 100, { prIcon: 'pod', kubernetesLabel: '1', fillColor: '#326CE5', strokeColor: '#ffffff' }, KUBE);
    expect(out).toHaveLength(4);
    expect(out[3]).toContain('>pod</text>');
    expect(out[3]).toContain('fill="#ffffff"');
    // ラベルが無ければ文字は無い
    expect(draw('mxgraph.kubernetes.icon2', 100, 100, { prIcon: 'pod' }, KUBE)).toHaveLength(3);
  });

  it('wedgeArrow: 始めの点の両側から終わりの点への三角', () => {
    // 向き (1, 0)・幅 20: (0, −20) と (0, 20) から (100, 0) へ
    expect(ds(drawEdge('mxgraph.arrows2.wedgeArrow', [{ x: 0, y: 0 }, { x: 100, y: 0 }]))).toEqual(['M0 -20L0 20L100 0Z']);
    // 段の間 10 で 100 の長さは 10 段 (11 本)
    expect(ds(drawEdge('mxgraph.arrows2.wedgeArrowDashed2', [{ x: 0, y: 0 }, { x: 100, y: 0 }]))[0]?.match(/M/g)).toHaveLength(11);
  });

  it('繰り返しで描く部分は、回数の上限 (楔の段は 10000、EIP の管の四角は 1000) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    // 段の間 0.1 で 2000 の長さは 20000 段。間はそのまま (0.1) で、始めから 10000 本
    const wedge = ds(drawEdge('mxgraph.arrows2.wedgeArrowDashed2', [{ x: 0, y: 0 }, { x: 2000, y: 0 }], { stepSize: '0.1' }))[0] ?? '';
    expect(wedge.match(/M/g)).toHaveLength(10000);
    expect(wedge).toMatch(/^M0 -20L0 20M0\.1 -20L0\.1 20M/);
    expect(wedge).toMatch(/M999\.9 -10L999\.9 10$/);
    // 段の間が 0 は、段の数が無限で、どの点も NaN になる (何も見えない) ので描かない
    expect(drawEdge('mxgraph.arrows2.wedgeArrowDashed2', [{ x: 0, y: 0 }, { x: 100, y: 0 }], { stepSize: '0' })).toEqual([]);
    // 幅 100000 の管の四角は、i × 20 + 10 < 100000 − 14 なら 4998 個だが、1000 個で止まる (最後は x = 20000)
    const data = draw('mxgraph.eip.dataChannel', 100000, 40).slice(2);
    expect(data).toHaveLength(1000);
    expect(ds(data).at(-1)).toBe('M20000 15L20010 15L20010 25L20000 25Z');
  });
});
