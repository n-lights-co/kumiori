import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_ARCHIMATE } from '../../src/drawio/drawioJs/archimate';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1。図形ライブラリの形は無い) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: style.strokeColor ?? '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
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
  SHAPES_ARCHIMATE[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

/** ArchiMate 3 の application の右上の印の種類 (appType) */
const APP_TYPES = [
  'generic', 'comp', 'collab', 'contract', 'interface', 'interface2', 'facility', 'func', 'gap', 'interaction', 'location', 'serv', 'equipment', 'event', 'event2', 'node', 'netw',
  'commPath', 'actor', 'assess', 'goal', 'grouping', 'outcome', 'role', 'passive', 'plateau', 'proc', 'product', 'deliverable', 'device', 'driver', 'principle', 'requirement',
  'representation', 'constraint', 'resource', 'capability', 'course', 'material', 'meaning', 'distribution', 'sysSw', 'artifact', 'path', 'amValue', 'valueStream', 'workPackage',
];

describe('draw.io の ArchiMate・C4・UML 2.5・DFD の形', () => {
  it('どの形も、描いたものが SVG として読める', () => {
    expect(Object.keys(SHAPES_ARCHIMATE).length).toBe(74);
    for (const name of Object.keys(SHAPES_ARCHIMATE)) {
      const out = draw(name, 160, 100);
      expect(out.length, name).toBeGreaterThan(0);
      expect(readable(out), name).not.toBeNull();
    }
  });

  it('application の右上の印は、どの種類も描ける', () => {
    for (const shape of ['mxgraph.archimate3.application']) {
      for (const appType of APP_TYPES) {
        const out = draw(shape, 160, 100, { appType, archiType: 'oct' });
        // generic は印を描かず、meaning は図形ライブラリの形 (テストでは無い) なので、背景だけ
        expect(out.length, `${shape} ${appType}`).toBeGreaterThan(['generic', 'meaning'].includes(appType) ? 0 : 1);
        expect(readable(out), `${shape} ${appType}`).not.toBeNull();
      }
    }
    for (const [shape, key, types] of [
      ['mxgraph.archimate3.tech', 'techType', ['device', 'plateau', 'facility', 'equipment', 'sysSw']],
      ['mxgraph.archimate.application', 'appType', ['comp', 'interface', 'interface2', 'function', 'interaction', 'service', 'node', 'network', 'commPath', 'artifact', 'sysSw', 'actor', 'role', 'collab']],
      ['mxgraph.archimate.business', 'busType', ['process', 'function', 'interaction', 'event', 'service']],
      ['mxgraph.archimate.tech', 'techType', ['device', 'plateau']],
      ['mxgraph.archimate.motiv', 'motivType', ['stake', 'driver', 'assess', 'goal', 'req', 'const', 'princ']],
    ] as const) {
      for (const t of types) {
        const out = draw(shape, 160, 100, { [key]: t });
        expect(out.length, `${shape} ${t}`).toBeGreaterThan(1);
        expect(readable(out), `${shape} ${t}`).not.toBeNull();
      }
    }
  });

  it('archimate3.process: 矢印の形 (h × 0.3・0.7 の軸と、w × 0.6 からの頭)', () => {
    expect(ds(draw('mxgraph.archimate3.process', 100, 50))).toEqual(['M0 15L60 15L60 0L100 25L60 50L60 35L0 35Z']);
  });

  it('dfd.archive・dfd.check2: 逆三角形と横線、六角形と内側の山', () => {
    expect(ds(draw('mxgraph.dfd.archive', 100, 50))).toEqual(['M0 0L100 0L50 50Z', 'M10 10L90 10']);
    // size = min(h, w) / 2 = 20
    expect(ds(draw('mxgraph.dfd.check2', 100, 40))).toEqual(['M0 20L20 0L80 0L100 20L80 40L20 40L0 20Z', 'M80 0L60 20L80 40']);
  });

  it('archimate3.application の component の印: 右上 (w - 20, 5) の 15 × 15 の枠を 1 px 内へ寄せた中の 3 つの四角', () => {
    // 印の枠: translate(80, 5)・translate(1, 0) で、w = 13、h = 15
    expect(ds(draw('mxgraph.archimate3.application', 100, 60, { appType: 'comp' }))).toEqual([
      'M0 0L100 0L100 60L0 60Z',
      'M84.25 5L94 5L94 20L84.25 20Z',
      'M81 8.75L87.5 8.75L87.5 11L81 11Z',
      'M81 14L87.5 14L87.5 16.25L81 16.25Z',
    ]);
  });

  it('application の印の背景は、元のソースと同じくスタイルを読まない (plateau の印は、線の色に関わらず #000000 で塗る)', () => {
    const out = draw('mxgraph.archimate3.application', 100, 60, { appType: 'plateau', strokeColor: '#ff0000' });
    expect(out.slice(1).every((s) => s.includes('fill="#000000"'))).toBe(true);
    // 単独の plateau の形は、線の色で塗る
    expect(draw('mxgraph.archimate3.plateau', 15, 15, { strokeColor: '#ff0000' })[0]).toContain('fill="#ff0000"');
  });

  it('uml25.action: 角は arcSize (absoluteArcSize なら px) で、右に 10 × 20 の端子', () => {
    expect(ds(draw('mxgraph.uml25.action', 100, 40, { absoluteArcSize: '1', arcSize: '10' }))).toEqual([
      'M0 10A10 10 0 0 1 10 0L80 0A10 10 0 0 1 90 10L90 30A10 10 0 0 1 80 40L10 40A10 10 0 0 1 0 30Z',
      'M90 10L100 10L100 30L90 30Z',
    ]);
    // arcSize が無ければ、v24.7.5 では NaN の経路になって本体は見えないので、端子だけ
    expect(ds(draw('mxgraph.uml25.action', 100, 40))).toEqual(['M90 10L100 10L100 30L90 30Z']);
    // rounded でない behaviorAction は、arcSize が無くても四角を描く
    expect(ds(draw('mxgraph.uml25.behaviorAction', 100, 40))[0]).toBe('M0 0L100 0L100 40L0 40Z');
  });
});
