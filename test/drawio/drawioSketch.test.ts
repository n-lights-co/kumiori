import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { drawioToSvg } from '../../src/drawio/drawio';
import { sketchKind, sketchSeed, sketchSvg } from '../../src/drawio/drawioSketch';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const enc = (s: string) => new TextEncoder().encode(s);
const model = (cells: string) => `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const vertex = (id: string, style: string, x: number, y: number, w: number, h: number, value = '') =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const svgOk = (svg: string) => parseSvg(svg, parse, { outline: () => ({ segs: [], advance: 5 }) });

describe('draw.io の手書き風 (sketch・comic)', () => {
  it('種はセルの id から作る (draw.io の RoughCanvas.getStyle と同じ式)', () => {
    expect(sketchSeed('')).toBe(1);
    // ((1 << 5) - 1 + 97) << 0 = 128、((128 << 5) - 128 + 98) << 0 = 4066
    expect(sketchSeed('ab')).toBe(4066);
    expect(sketchKind({ sketch: '1' })).toBe('rough');
    expect(sketchKind({ sketch: '1', sketchStyle: 'comic' })).toBe('comic');
    expect(sketchKind({ comic: '1' })).toBe('comic');
    expect(sketchKind({ sketch: '0' })).toBeUndefined();
  });

  it('色の塗りは斜線 (塗りの色の線。太さは線の太さの半分)、白とグラデーションは塗りつぶし。同じ id なら同じ結果', () => {
    const cell = { id: 'a', style: { sketch: '1' }, size: 160 };
    const out = sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#dae8fc" stroke="#6c8ebf" stroke-width="1"/>', cell);
    expect(out).not.toContain('<rect');
    expect(out).toMatch(/<path d="M[^"]+" fill="none" stroke="#dae8fc" stroke-width="0.5"/);
    expect(out).toMatch(/<path d="M[^"]+C[^"]+" fill="none" stroke="#6c8ebf" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"\/>/);
    expect(sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#dae8fc" stroke="#6c8ebf" stroke-width="1"/>', cell)).toBe(out);
    expect(sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#dae8fc" stroke="#6c8ebf" stroke-width="1"/>', { ...cell, id: 'b' })).not.toBe(out);
    const white = sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#ffffff" stroke="#000000"/>', cell);
    expect(white).toMatch(/<path d="M[^"]+" fill="#ffffff" stroke="none"\/>/);
    const grad = sketchSvg('<path d="M0 0L100 0L100 60Z" fill="url(#g)" stroke="none"/>', cell);
    expect(grad).toMatch(/^<path d="M[^"]+" fill="url\(#g\)" stroke="none"\/>$/);
    // fillStyle=solid は塗りつぶし、線の色が無ければ線を描かない
    expect(sketchSvg('<ellipse cx="50" cy="30" rx="50" ry="30" fill="#ff0000" stroke="none"/>', { ...cell, style: { sketch: '1', fillStyle: 'solid' } })).toMatch(/^<path d="M[^"]+" fill="#ff0000" stroke="none"\/>$/);
  });

  it('文字・定義・入れ子の svg (画像) の中は変えない。transform などの属性は写す', () => {
    const cell = { id: 'a', style: { sketch: '1' }, size: 100 };
    const keep = '<defs><path id="p" d="M0 0L10 0"/></defs><text x="0" y="0">A</text><svg x="0" y="0" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>';
    expect(sketchSvg(keep, cell)).toBe(keep);
    expect(sketchSvg('<path d="M0 0L50 0" fill="none" stroke="#000" transform="rotate(90)"/>', cell)).toMatch(/transform="rotate\(90\)"/);
  });

  it('comic: まっすぐの線を区切って横へずらす (端の点は変えない)。曲線と楕円はそのまま', () => {
    const cell = { id: 'a', style: { comic: '1' }, size: 160 };
    const out = sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#fff2cc" stroke="#d6b656"/>', cell);
    const d = /d="([^"]+)"/.exec(out)![1];
    // 上の辺 (長さ 100) は 10 に区切る: M の後に 10 個の点と、終わりの点
    expect(d).toMatch(/^M0 0L0 -?[\d.]+L10 -?[\d.]+L20 -?[\d.]+L30 /);
    expect(d).toMatch(/L90 -?[\d.]+L100 0L-?[\d.]+ 0L/);
    expect(d.endsWith('L0 0Z')).toBe(true);
    expect(out).toContain('fill="#fff2cc"');
    expect(out).toContain('stroke-linejoin="round"');
    expect(sketchSvg('<rect x="0" y="0" width="100" height="60" fill="#fff2cc" stroke="#d6b656"/>', cell)).toBe(out);
    const ell = '<ellipse cx="5" cy="5" rx="5" ry="5" fill="#000"/>';
    expect(sketchSvg(ell, cell)).toBe(ell);
  });

  it('図の中の形と線を手書き風に描き、Node の SVG としても読める', () => {
    const cells =
      vertex('a', 'sketch=1;fillColor=#dae8fc;strokeColor=#6c8ebf;', 0, 0, 120, 60, 'A') +
      vertex('b', 'ellipse;sketch=1;fillColor=#f8cecc;fillStyle=cross-hatch;', 200, 0, 120, 60, 'B') +
      vertex('c', 'shape=cylinder3;comic=1;', 0, 100, 60, 80) +
      `<mxCell id="e" style="sketch=1;endArrow=classic;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    const r = drawioToSvg(enc(model(cells)))!;
    expect(r.warnings).toEqual([]);
    expect(r.svg).toContain('>A</tspan>');
    expect(r.svg).toContain('stroke="#f8cecc"');
    expect(svgOk(r.svg)).not.toBeNull();
    // 手書き風でない図は変わらない
    expect(drawioToSvg(enc(model(vertex('a', 'fillColor=#dae8fc;', 0, 0, 120, 60))))!.svg).toContain('<rect x="0" y="0" width="120" height="60"');
  });
});
