import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_B } from '../../src/drawio/drawioShapesB';
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
    direction: 'east',
    value: '',
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_B[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) => parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

describe('draw.io の Shapes.js の標準の形 (UML・流れ図・mermaid・git)', () => {
  it('どの形も、描いたものが空でなく、SVG として読める', () => {
    const styles: Array<Record<string, string>> = [{}, { rounded: '1' }, { lifelineMirror: '1', participant: 'umlActor', business: '1', actorType: 'hollow', dirs: 'x,y' }];
    for (const name of Object.keys(SHAPES_B)) {
      for (const st of styles) {
        const out = draw(name, 120, 80, st);
        expect(out.length, name).toBeGreaterThan(0);
        expect(readable(out), name).not.toBeNull();
      }
    }
  });

  it('担当の形がそろっている', () => {
    expect(Object.keys(SHAPES_B).length).toBe(55);
  });

  it('startState・endState: 内の円 (4 だけ内側) を塗り、endState は外の円の線も引く', () => {
    expect(ds(draw('startState', 40, 40))).toEqual(['M4 20A16 16 0 1 1 36 20A16 16 0 1 1 4 20Z']);
    const out = draw('endState', 40, 40);
    expect(ds(out)).toEqual(['M4 20A16 16 0 1 1 36 20A16 16 0 1 1 4 20Z', 'M0 20A20 20 0 1 1 40 20A20 20 0 1 1 0 20Z']);
    expect(out[1]).toContain('fill="none"');
  });

  it('or・xor: 2 次の曲線の経路 (丸めない)', () => {
    expect(ds(draw('or', 100, 60))).toEqual(['M0 0Q100 0 100 30Q100 60 0 60Z']);
    expect(ds(draw('xor', 100, 60))).toEqual(['M0 0Q100 0 100 30Q100 60 0 60Q50 30 0 0Z']);
  });

  it('dataStorage: 既定の size (幅の 0.1) と fixedSize', () => {
    expect(ds(draw('dataStorage', 100, 60))).toEqual(['M10 0L100 0Q80 30 100 60L10 60Q-10 30 10 0Z']);
    expect(ds(draw('dataStorage', 100, 60, { fixedSize: '1' }))).toEqual(['M20 0L100 0Q60 30 100 60L20 60Q-20 30 20 0Z']);
  });

  it('umlLifeline: 見出しの四角と、下の真ん中の破線', () => {
    const out = draw('umlLifeline', 100, 300);
    expect(ds(out)).toEqual(['M0 0L100 0L100 40L0 40Z', 'M50 40L50 300']);
    expect(out[1]).toContain('stroke-dasharray="3 3"');
    // 線の色と、破線にしない指定
    const solid = draw('umlLifeline', 100, 300, { lifelineDashed: '0', lifelineColor: '#ff0000' });
    expect(solid[1]).toContain('stroke="#ff0000"');
    expect(solid[1]).not.toContain('stroke-dasharray');
    // 足にも見出しを描く (線は見出しの間だけ)
    expect(ds(draw('umlLifeline', 100, 300, { lifelineMirror: '1' }))).toEqual(['M0 0L100 0L100 40L0 40Z', 'M0 260L100 260L100 300L0 300Z', 'M50 40L50 260']);
    // participant の形 (棒の人) を見出しに描く
    expect(ds(draw('umlLifeline', 100, 300, { participant: 'umlActor' }))[0]).toBe('M25 5A25 5 0 1 1 75 5A25 5 0 1 1 25 5Z');
  });

  it('umlFrame: 角を切った見出しと、残りの枠の線', () => {
    expect(ds(draw('umlFrame', 200, 100))).toEqual(['M0 0L60 0L60 15L50 30L0 30Z', 'M60 0L200 0L200 100L0 100L0 30']);
  });

  it('cross・manualInput・offPageConnector: 折れ線の経路', () => {
    expect(ds(draw('cross', 100, 60))).toEqual(['M0 24L44 24L44 0L56 0L56 24L100 24L100 36L56 36L56 60L44 60L44 36L0 36Z']);
    expect(ds(draw('manualInput', 100, 60))).toEqual(['M0 60L0 30L100 0L100 60Z']);
    expect(ds(draw('offPageConnector', 80, 80))).toEqual(['M0 0L80 0L80 50L40 80L0 50Z']);
  });

  it('module: 背景の外形と、前景の 2 つの端子 (線だけ)', () => {
    const out = draw('module', 100, 80);
    expect(ds(out)).toEqual(['M10 0L100 0L100 80L10 80L10 40L0 40L0 30L10 30L10 20L0 20L0 10L10 10Z', 'M10 10L20 10L20 20L10 20M10 30L20 30L20 40L10 40']);
    expect(out[1]).toContain('fill="none"');
  });

  it('gitMergeCommit: 外の円と、内の円 (innerColor)', () => {
    const out = draw('gitMergeCommit', 20, 20);
    expect(ds(out)).toEqual(['M0 10A10 10 0 1 1 20 10A10 10 0 1 1 0 10Z', 'M4 10A6 6 0 1 1 16 10A6 6 0 1 1 4 10Z']);
    expect(out[1]).toContain('fill="#ECECFF"');
  });

  it('mermaidBlockArrow: 右向きの矢印 (nodePadding 8)', () => {
    expect(ds(draw('mermaidBlockArrow', 100, 40))).toEqual(['M20 36L80 36L80 40L100 20L80 0L80 4L20 4Z']);
  });
});
