import { describe, expect, it } from 'vitest';
import { evalExpr, evalLength } from '../src/foExpr';

const L = (s: string, pct?: number) => evalLength(s, { fs: 10, ...(pct !== undefined ? { pct } : {}) });

describe('XSL §5.9 の式', () => {
  it('単位と数', () => {
    expect(L('12pt')).toBe(12);
    expect(L('1in')).toBe(72);
    expect(L('2em')).toBe(20);
    expect(L('-3pt')).toBe(-3);
    expect(L('+3pt')).toBe(3);
    expect(L('10')).toBe(10);
    expect(L('50%', 200)).toBe(100);
    expect(L('50%')).toBeUndefined();
  });

  it('掛け算・割り算は足し算・引き算より強く結びつく', () => {
    expect(L('2pt + 3pt * 2')).toBe(8);
    expect(L('10pt - 4pt div 2')).toBe(8);
    expect(L('2 * 3pt + 1pt')).toBe(7);
    expect(L('12pt*14')).toBe(168);
    expect(L('(2pt+3pt)*2')).toBe(10);
    expect(L('7pt mod 3pt')).toBe(1);
    expect(L('20mm+18pt+30pt')).toBeCloseTo((20 * 72) / 25.4 + 48);
  });

  it('数の関数', () => {
    expect(L('max(10pt, 2em)')).toBe(20);
    expect(L('min(10pt, 2em)')).toBe(10);
    expect(L('abs(-4pt)')).toBe(4);
    expect(L('floor(2.7) * 1pt')).toBe(2);
    expect(L('round(2.5pt)')).toBe(3);
  });

  it('評価できないもの', () => {
    expect(L('auto')).toBeUndefined();
    expect(L('3pt * 2pt')).toBeUndefined();
    expect(L('1pt + 2')).toBeUndefined();
    expect(L('from-parent(width)')).toBeUndefined();
    expect(L('1pt / 2')).toBeUndefined();
    expect(L('proportional-column-width(1)')).toBeUndefined();
  });

  it('proportional-column-width() と長さの式 (§5.10.4)', () => {
    expect(evalExpr('proportional-column-width(2)+2pc', { fs: 10, proportional: true })).toEqual({ pt: 24, prop: 2, dim: 1 });
    expect(evalExpr('proportional-column-width(1)', { fs: 10, proportional: true })).toEqual({ pt: 0, prop: 1, dim: 1 });
  });
});
