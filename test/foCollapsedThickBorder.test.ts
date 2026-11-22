/**
 * 罫線をつぶした表 (border-collapse="collapse") で、太さの違う罫線の中心をそろえる (台帳の FO-36)。
 * 仕様: CSS2 §17.6.2 (罫線の中心は、セルの間の格子の線に置く。XSL 1.1 §7.28.3 が CSS2 の定義を引く)。
 * XSL 1.1 §6.7.10: セルの内容の矩形は、グリッド線から、そのセルの辺の罫線の太さの半分だけ内側。
 * 表に罫線の無い辺 (表の外周の罫線をセルが持つ) でも、互換の組み方 (--compat antenna) の内側の線でも、細い線を太い線の外の縁に
 * そろえず、グリッド線を中心に置く。アンテナハウスの見本 (サンプル FO 集の table-border-conflict-resolution-1) も中心をそろえる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { paintSheet, type Painter } from '../src/paint';
import { childrenOf } from '../src/areaTree';
import type { Area, AreaTree } from '../src/types';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const BOTH = ['spec', 'antenna'] as const;
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;

/**
 * 2 行 2 列の表 (表に罫線は無い)。
 *  A (左上): 4pt #ff0000、後ろ側は無し (行の境目は C の前側の線)、背景 #cccccc。B (右上): 12pt #0000ff、後ろ側は 12pt #000080。
 *  C (左下): 4pt #00ff00、前側は #ffa500。D (右下): 2pt #ff00ff
 */
const TABLE =
  '<fo:table border-collapse="collapse" table-layout="fixed" width="80pt"><fo:table-column column-width="40pt"/><fo:table-column column-width="40pt"/><fo:table-body>' +
  '<fo:table-row><fo:table-cell border="4pt solid #ff0000" border-after-style="none" background-color="#cccccc"><fo:block background-color="#ffff00">A</fo:block></fo:table-cell>' +
  '<fo:table-cell border="12pt solid #0000ff" border-after-color="#000080"><fo:block background-color="#00ffff">B</fo:block></fo:table-cell></fo:table-row>' +
  '<fo:table-row><fo:table-cell border="4pt solid #00ff00" border-before-color="#ffa500"><fo:block>C</fo:block></fo:table-cell>' +
  '<fo:table-cell border="2pt solid #ff00ff"><fo:block>D</fo:block></fo:table-cell></fo:table-row>' +
  '</fo:table-body></fo:table>';

const layout = (compat: 'spec' | 'antenna'): AreaTree => E.engine.layout(importXslFo(fo(TABLE), parse, { compat }).document);

/** 背景の色ごとの箱 (ページの中の位置。子の位置は、親の罫線と padding の内側から測る) */
const backgrounds = (tree: AreaTree) => {
  const out: Record<string, { x: number; y: number }> = {};
  const visit = (n: Area, ox: number, oy: number) => {
    const x = ox + n.x;
    const y = oy + n.y;
    if (n.backgroundColor && !out[n.backgroundColor]) out[n.backgroundColor] = { x, y };
    const ix = x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0);
    const iy = y + (n.border?.top?.width ?? 0) + (n.padding?.top ?? 0);
    for (const c of childrenOf(n)) visit(c as Area, ix, iy);
  };
  visit(tree.sheets[0].page.regionBody as Area, 0, 0);
  return out;
};

type Seg = { op: string; x?: number; y?: number };
/** 色 color で塗った図形・線の外接矩形 [x0, y0, x1, y1] (Sheet の pt) */
const ink = (tree: AreaTree, color: string) => {
  let b: [number, number, number, number] | undefined;
  const add = (x: number, y: number, pad = 0) => {
    b = b ? [Math.min(b[0], x - pad), Math.min(b[1], y - pad), Math.max(b[2], x + pad), Math.max(b[3], y + pad)] : [x - pad, y - pad, x + pad, y + pad];
  };
  const p = new Proxy({} as Painter, {
    get:
      (_t, name) =>
      (...args: unknown[]) => {
        if (name === 'fillRect' && args[4] === color) {
          const [x, y, w, h] = args as number[];
          add(x, y);
          add(x + w, y + h);
        } else if (name === 'fillPath' && args[1] === color) for (const s of args[0] as Seg[]) s.x !== undefined && add(s.x, s.y!);
        else if (name === 'strokePath' && args[2] === color) for (const s of args[0] as Seg[]) s.x !== undefined && add(s.x, s.y!, (args[1] as number) / 2);
        for (const a of args) if (typeof a === 'function') (a as () => void)();
      },
  });
  for (const s of tree.sheets) paintSheet(s, p);
  if (!b) throw new Error(`色 ${color} の線が無い`);
  return b;
};

describe('FO-36: collapse の表の、太さの違う罫線の中心をそろえる (CSS2 §17.6.2)', () => {
  it('表に罫線の無い辺: 端のセルの罫線は、太さによらずグリッド線を中心に置く (細い線を太い線の外の縁にそろえない)', () => {
    for (const c of BOTH) {
      const tree = layout(c);
      const top = tree.sheets[0].page.regionBody.y;
      const red = ink(tree, '#ff0000');
      const blue = ink(tree, '#0000ff');
      // 上の辺のグリッド線は領域の頭 (FO-22 H)。4pt の線は ±2pt、12pt の線は ±6pt
      expect(red[1] - top, c).toBeCloseTo(-2, 3);
      expect(blue[1] - top, c).toBeCloseTo(-6, 3);
      // 中身は、グリッド線から自分の線の太さの半分の内側 (§6.7.10)
      const bg = backgrounds(tree);
      expect(bg['#ffff00'].y - top, c).toBeCloseTo(2, 3);
      expect(bg['#00ffff'].y - top, c).toBeCloseTo(6, 3);
      // 右の辺: B は 12pt、D は 2pt。どちらも同じグリッド線 (表の右端) を中心にする
      const magenta = ink(tree, '#ff00ff');
      expect(blue[2] - magenta[2], c).toBeCloseTo(5, 3);
      // A の背景は、内へずらした上の線の外の縁から (線の外へはみ出さない)
      expect(ink(tree, '#cccccc')[1] - top, c).toBeCloseTo(-2, 3);
      // 左の辺: A・C はどちらも 4pt (中心は表の左端)
      expect(red[0] - tree.sheets[0].page.regionBody.x, c).toBeCloseTo(-2, 3);
    }
  });

  it('内側の線 (行の境目): 4pt と 12pt の線の中心がそろう (互換の組み方でも)', () => {
    for (const c of BOTH) {
      const tree = layout(c);
      const orange = ink(tree, '#ffa500');
      const navy = ink(tree, '#000080');
      expect(orange[3] - orange[1], c).toBeCloseTo(4, 3);
      expect(navy[3] - navy[1], c).toBeCloseTo(12, 3);
      expect((orange[1] + orange[3]) / 2, c).toBeCloseTo((navy[1] + navy[3]) / 2, 3);
    }
  });
});
