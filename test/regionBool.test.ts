import { describe, expect, it } from 'vitest';
import { flattenPath, polyBool, type Rings } from '../src/regionBool';

/** 輪の面積の合計 (向きを問わない) */
const area = (rs: Rings) => rs.reduce((t, r) => t + Math.abs(r.reduce((a, p, k) => a + p[0] * r[(k + 1) % r.length][1] - r[(k + 1) % r.length][0] * p[1], 0)) / 2, 0);
const sq = (x: number, y: number, s: number): Rings => [
  [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ],
];

describe('regionBool: 多角形の論理演算', () => {
  it('重なる 2 つの正方形の共通部分・和・排他的論理和・差の面積', () => {
    const a = sq(0, 0, 2);
    const b = sq(1, 1, 2);
    expect(area(polyBool(a, false, b, false, 1))).toBeCloseTo(1, 9);
    expect(area(polyBool(a, false, b, false, 2))).toBeCloseTo(7, 9);
    expect(area(polyBool(a, false, b, false, 3))).toBeCloseTo(6, 9);
    expect(area(polyBool(a, false, b, false, 4))).toBeCloseTo(3, 9);
  });
  it('斜めの辺が交わる三角形、偶奇の規則の穴', () => {
    // 三角形 2 つ (ダビデの星の形) の和: 一辺 1 の正三角形 2 つ、重なりは正六角形 (面積は三角形の 2/3)
    const h = Math.sqrt(3) / 2;
    const t1: Rings = [
      [
        [0, 0],
        [1, 0],
        [0.5, h],
      ],
    ];
    const t2: Rings = [
      [
        [0, (2 * h) / 3],
        [1, (2 * h) / 3],
        [0.5, -h / 3],
      ],
    ];
    const tri = Math.sqrt(3) / 4;
    expect(area(polyBool(t1, false, t2, false, 1))).toBeCloseTo((tri * 2) / 3, 9);
    expect(area(polyBool(t1, false, t2, false, 2))).toBeCloseTo(tri * 2 - (tri * 2) / 3, 9);
    // 外の正方形と内の正方形 (同じ向き): 偶奇なら穴、非ゼロなら塗りつぶし
    const ring = [...sq(0, 0, 4), ...sq(1, 1, 2)];
    expect(area(polyBool(ring, true, [], false, 2))).toBeCloseTo(12, 9);
    expect(area(polyBool(ring, false, [], false, 2))).toBeCloseTo(16, 9);
  });
  it('パスの円弧を折れ線にする (誤差は半径の 0.025% 以内)', () => {
    const rings = flattenPath('M0 -10A10 10 0 0 1 0 10A10 10 0 0 1 0 -10Z');
    expect(area(rings)).toBeCloseTo(Math.PI * 100, 0);
    for (const p of rings[0]) expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 6);
  });
});
