/**
 * 1 つのセルの異常な値で、図の全体を読めない画像にしないことの確かめ。
 * 図の大きさの上限 (本体の画像の形式の結果の上限 FORMAT_MAX_SIZE。1,000 万 px) を超えさせるセルと、SVG の長さの上限 (1,600 万字) を
 * 1 つで超えるセルは、そのセルだけを描かずに警告を出し、図の残りのセルは描く
 */
import { describe, expect, it } from 'vitest';
import { drawioToSvg } from '../../src/drawio/drawio';
import { FORMAT_MAX_SIZE } from '../../src/imageFormats';
import { typeset } from '../../src/index';
import { loadCachedFont } from '../helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const xa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const vertex = (id: string, style: string, x: number, y: number, w: number, h: number, value = '') =>
  `<mxCell id="${id}" value="${xa(value)}" style="${xa(style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const edge = (id: string, style: string) =>
  `<mxCell id="${id}" style="${xa(style)}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="300" as="sourcePoint"/><mxPoint x="200" y="300" as="targetPoint"/></mxGeometry></mxCell>`;
const model = (cells: string) => enc(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`);
/** 普通のセル (描かれることを、その塗りの色で見る) */
const plain = vertex('ok', 'fillColor=#123456;', 200, 0, 50, 50, 'ok');

describe('図の大きさの上限 (1,000 万 px) を超えさせるセル', () => {
  const cases: Array<[string, string]> = [
    ['線の太さ', vertex('big', 'strokeWidth=1e7;', 0, 0, 100, 60)],
    ['線の太さ (もっと大きい)', vertex('big', 'strokeWidth=1e300;', 0, 0, 100, 60)],
    ['字の大きさ', vertex('big', 'fontSize=1e7;', 0, 0, 100, 60, 'label')],
    ['影のずれ', vertex('big', 'shadow=1;shadowOffsetX=2e7;', 0, 0, 100, 60)],
    ['影のぼかし', vertex('big', 'shadow=1;shadowBlur=5e6;', 0, 0, 100, 60)],
    ['回した太い線', vertex('big', 'rotation=45;strokeWidth=8e6;', 0, 0, 100, 60)],
    ['線の太さ (線)', edge('big', 'strokeWidth=2e7;')],
    ['矢印の大きさ', edge('big', 'endArrow=classic;endSize=1e7;')],
    ['太い矢印の幅', edge('big', 'shape=flexArrow;width=2e7;')],
    ['遠く離れたセル (座標は上限の内)', vertex('far', '', 9_999_000, 0, 100, 60) + vertex('far2', '', -9_999_000, 0, 100, 60)],
  ];
  for (const [what, cell] of cases)
    it(`${what}: そのセルだけを描かずに警告し、ほかのセルは描く (前は図の全体が読めない画像になった)`, () => {
      const r = drawioToSvg(model(plain + cell))!;
      expect(r).toBeDefined();
      expect(r.width).toBeLessThanOrEqual(FORMAT_MAX_SIZE);
      expect(r.height).toBeLessThanOrEqual(FORMAT_MAX_SIZE);
      expect(r.svg).toContain('#123456');
      expect(r.warnings.join('\n')).toContain('図を大きさの上限より大きくするセルを描かない');
    });
  it('上限いっぱいの影の付いた図も、本体の上限の内の大きさになる', () => {
    const r = drawioToSvg(enc(`<mxGraphModel shadow="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${vertex('a', 'strokeColor=none;', 0, 0, 1e7 - 8, 10)}</root></mxGraphModel>`))!;
    expect(r.width).toBeLessThanOrEqual(FORMAT_MAX_SIZE);
    expect(r.warnings).toEqual([]);
  });
  it('文書に置いても、図は画像として描かれる (読めない画像の警告にならない)', async () => {
    const files = [{ name: 'a.drawio', data: model(plain + vertex('big', 'strokeWidth=1e7;', 0, 0, 100, 60)) }];
    const r = await typeset('<img src="a.drawio">', { loadFont: loadCachedFont, files });
    expect(r.warnings.join('\n')).not.toContain('読めない画像');
    expect(r.warnings.join('\n')).toContain('図を大きさの上限より大きくするセルを描かない');
  }, 60_000);
});

describe('SVG の長さの上限 (1,600 万字) を 1 つで超えるセル', () => {
  const items = (n: number, v: string) => Array.from({ length: n }, () => v).join(',');
  it(', で区切る項目が多すぎる形 (ボタンの列 40 万個) は、そのセルだけを描かず、後ろのセルは描く (前は図が空になり、読めない画像になった)', () => {
    for (const shape of ['mxgraph.mockup.buttons.horButtonBar', 'mxgraph.mockup.graphics.pieChart', 'mxgraph.mockup.navigation.breadcrumb', 'mxgraph.ios7ui.horButtonBar']) {
      const big = vertex('big', `shape=${shape};mainText=${items(400_000, 'a')};buttonText=${items(400_000, 'a')};parts=${items(400_000, '1')}`, 0, 0, 400, 80);
      const r = drawioToSvg(model(big + plain))!;
      expect(r).toBeDefined();
      expect(r.svg).toContain('#123456');
      expect(r.svg.length).toBeLessThan(10_000);
      expect(r.warnings.join('\n')).toContain('SVG が大きすぎるセルを描かない');
    }
  }, 120_000);
  it('超えるセルを並べても、書いた字の合計の上限で止まる (後ろのセルは描かず、途中までを描いたと警告する)', () => {
    const big = (k: number) => vertex(`big${k}`, `shape=mxgraph.mockup.buttons.horButtonBar;mainText=${items(400_000, 'a')}`, 0, k * 100, 400, 80);
    let cells = plain;
    for (let k = 0; k < 20; k++) cells += big(k);
    cells += vertex('late', 'fillColor=#654321;', 300, 0, 50, 50);
    const t0 = Date.now();
    const r = drawioToSvg(model(cells))!;
    expect(r.svg).toContain('#123456');
    expect(r.svg).not.toContain('#654321');
    const w = r.warnings.join('\n');
    expect(w).toContain('SVG が大きすぎるセルを描かない');
    expect(w).toContain('図が大きすぎるので、途中までを描く');
    // 書いて捨てるのは、上限の 2 倍 (3,200 万字) まで (20 個を全部書くと 3 億字を超える)
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);
});
