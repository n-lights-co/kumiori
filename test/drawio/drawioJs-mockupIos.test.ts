import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_MOCKUP_IOS } from '../../src/drawio/drawioJs/mockupIos';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}): string[] {
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: () => undefined, gradient: (_a: string, _b: string, _d: string, a1 = 1, a2 = 1) => (a1 === 1 && a2 === 1 ? 'url(#g)' : `url(#g-${a1}-${a2})`), stencilCtx: { lookup: () => undefined, warn: () => {}, budget: { ops: 0 } } as never, style: {} },
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
  SHAPES_MOCKUP_IOS[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]).filter(Boolean);
const svgOf = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

describe('draw.io のモックアップの iOS・マークアップ・ナビゲーションの形', () => {
  it('70 の形がある', () => {
    expect(Object.keys(SHAPES_MOCKUP_IOS).length).toBe(70);
    expect(Object.keys(SHAPES_MOCKUP_IOS).filter((k) => !/^mxgraph\.(ios|mockup\.markup|mockup\.navigation)\./.test(k))).toEqual([]);
  });

  it('どの形も、描いたものが SVG として読める', () => {
    for (const name of Object.keys(SHAPES_MOCKUP_IOS)) {
      for (const [w, h] of [
        [300, 200],
        [60, 40],
      ]) {
        const out = draw(name, w, h);
        // 錨 (anchor) は、つなぐ点だけの形で、ソースでも何も描かない
        if (/\.anchor$/.test(name)) expect(out, name).toEqual([]);
        else expect(out.length, `${name} ${w}×${h}`).toBeGreaterThan(0);
        expect(out.join(''), name).not.toMatch(/NaN|undefined|Infinity/);
        if (out.length) expect(svgOf(out), name).not.toBeNull();
      }
    }
  });

  it('markup.line・redX・curlyBrace: ソースの経路', () => {
    expect(ds(draw('mxgraph.mockup.markup.line', 100, 40))).toEqual(['M0 20L100 20']);
    expect(ds(draw('mxgraph.mockup.markup.redX', 100, 100))).toEqual(['M10 0L50 40L90 0L100 10L60 50L100 90L90 100L50 60L10 100L0 90L40 50L0 10Z']);
    // midY = 20、rSize = min(200 × 0.125, 20) = 20
    expect(ds(draw('mxgraph.mockup.markup.curlyBrace', 200, 40))).toEqual(['M0 40A20 20 0 0 1 20 20L80 20A20 20 0 0 0 100 0A20 20 0 0 0 120 20L180 20A20 20 0 0 1 200 40']);
  });

  it('ios.checkbox: 四角と、チェックの線', () => {
    expect(ds(draw('mxgraph.ios.checkbox', 100, 100))).toEqual(['M0 0L100 0L100 100L0 100Z', 'M80 20L40 80L25 60']);
  });

  it('mockup.rrect: スタイルの文字の値 (rSize) を数にして角を丸める', () => {
    expect(ds(draw('mxgraph.ios.rrect', 100, 50, { rSize: '10' }))).toEqual(['M10 0L90 0A10 10 0 0 1 100 10L100 40A10 10 0 0 1 90 50L10 50A10 10 0 0 1 0 40L0 10A10 10 0 0 1 10 0Z']);
  });

  it('ios.iPhone: 上の縁と丸いボタンは不透明のグラデーション、ボタンの影は #000000 を 0.85 で塗り、画面の塗りは不透明', () => {
    const out = draw('mxgraph.ios.iPhone', 200, 400);
    expect(out.filter((s) => s.includes('fill="url(#g)"')).length).toBe(2);
    expect(out.some((s) => s.includes('fill="url(#g-'))).toBe(false);
    expect(out.some((s) => s.includes('fill="#000000" fill-opacity="0.85"'))).toBe(true);
    // 画面 (bgGreen の #1f2923) は不透明
    const screen = out.find((s) => s.includes('fill="#1f2923"'));
    expect(screen).toBeDefined();
    expect(screen).not.toContain('fill-opacity');
  });

  it('draw.io v24.7.5 の形は、後の版で足された色のキー (bodyColor・fillColor2・statusIconColor など) を読まない', () => {
    expect(draw('mxgraph.ios.iPhone', 200, 400, { bodyColor: '#ff0000' })[0]).toContain('fill="#000000"');
    const bar = draw('mxgraph.ios.iTopBarLocked', 200, 30, { fillColor2: '#ff0000', statusIconColor: '#00ff00' });
    expect(bar[0]).toContain('fill="#000000"');
    expect(bar.join('')).not.toMatch(/#ff0000|#00ff00/);
  });

  it('繰り返しで描く部分は、回数の上限 (縞は 10000 本、アイコンは 1000 個) まで描いて止まる (Kumiori の守り。v24.7.5 のソースには上限が無い)', () => {
    const lines = (d: string | undefined) => d?.match(/M/g)?.length ?? 0;
    // 5 ごとの縞: 幅 100000 なら 19999 本だが、10000 本で止まる (最後は x = 50000)
    const bg = ds(draw('mxgraph.ios.iBgStriped', 100000, 50, { strokeColor2: '#aaaaaa' }));
    const stripes = bg.find((d) => d?.startsWith('M5 0L5 50'));
    expect(lines(stripes)).toBe(10000);
    expect(stripes).toMatch(/M50000 0L50000 50$/);
    // iPhone (5 ごと)・iPad (7 ごと) の画面の縞も同じ
    for (const shape of ['mxgraph.ios.iPhone', 'mxgraph.ios.iPad']) {
      expect(Math.max(...ds(draw(shape, 200000, 400, { bgStyle: 'bgStriped' })).map(lines)), shape).toBe(10000);
    }
    // アイコンの升目: 2000 × 2000 は、四角とばつ印を 1000 個ずつ
    expect(ds(draw('mxgraph.ios.iIconGrid', 3000, 3000, { gridSize: '2000,2000' }))).toHaveLength(2000);
  });
});
