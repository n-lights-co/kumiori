/**
 * カーニングは、字形を差し替える機能 (smcp・onum など) を当てた後の字形の組で引く (OpenType: GSUB の後に GPOS)。
 * たとえば small-caps oldstyle-nums では、差し替えた字形の組 (p と s、1 と 2) にカーニングを当てる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

describe('カーニングと字形の差し替え', () => {
  it('features を layout に渡し、機能ごとに別に覚える', () => {
    const font = E.fonts.all()[0];
    const fk = font.fk as unknown as { layout(t: string, o?: Record<string, boolean>): unknown };
    const orig = fk.layout.bind(fk);
    const seen: Array<Record<string, boolean> | undefined> = [];
    fk.layout = (t: string, o?: Record<string, boolean>) => {
      seen.push(o);
      return orig(t, o);
    };
    try {
      const fam = font.family;
      E.measurer.kern('1', '2', { fontFamily: fam, fontWeight: 400 });
      E.measurer.kern('1', '2', { fontFamily: fam, fontWeight: 400, features: ['onum'] });
      E.measurer.kern('1', '2', { fontFamily: fam, fontWeight: 400, features: ['onum'] });
    } finally {
      fk.layout = orig;
    }
    // 機能なし・onum の 2 回だけ引く (同じ組と機能は覚えた値を使う)
    expect(seen.length).toBe(2);
    expect(seen[0]?.kern).toBe(true);
    expect(seen[0]?.onum).toBeUndefined();
    expect(seen[1]?.kern).toBe(true);
    expect(seen[1]?.onum).toBe(true);
  });
});
