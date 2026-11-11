/**
 * fontkit の CFF の字形の読みの直し (src/fontkitCffFlex.ts) が、CFF2 の書体しか登録しない文書でも当たること。
 * 差し替えは原型 (prototype) に 1 回当てるので、ほかの CFF の書体を読まない、このファイルだけのワーカーで確かめる
 */
import { describe, expect, it } from 'vitest';
import { FontManager } from '../src/fontManager';
import { buildCff2Font } from './cff2TestFont';

const PATCHED = Symbol.for('kumiori.fontkitCffFlexPatched');
type Fk = { getGlyph(gid: number): object; directory: { tables: Record<string, unknown> }; 'CFF '?: { fdForGlyph(gid: number): number | null } };
const marked = (fk: unknown) => (Object.getPrototypeOf((fk as Fk).getGlyph(0)) as { [PATCHED]?: boolean })[PATCHED];

describe('CFF2 の書体だけを登録したときの、CFF の字形の読みの直し', () => {
  it('CFF2 の可変フォント: 登録したときに当たり、作った実体 (静的な CFF) の FDSelect も正しく引く', async () => {
    const fonts = new FontManager();
    const master = await fonts.registerBuffer('K2', 400, buildCff2Font(), false);
    expect(marked(master.fk)).toBe(true);
    const bold = fonts.get('K2', 700).fk as unknown as Fk;
    expect(bold.directory.tables['CFF ']).toBeDefined();
    expect(marked(bold)).toBe(true);
    // 実体の FDSelect は元のまま (test/cff2TestFont.ts: GID 0〜1 は FD 0、2〜4 は FD 1、5 は FD 0)
    expect([0, 1, 2, 3, 4, 5].map((gid) => bold['CFF ']!.fdForGlyph(gid))).toEqual([0, 0, 1, 1, 1, 0]);
  });

  it('可変でない CFF2 の書体: 登録のときに作る静的な CFF に当たる', async () => {
    const fonts = new FontManager();
    const f = await fonts.registerBuffer('S', 400, buildCff2Font({ noVariations: true }), false);
    expect((f.fk as unknown as Fk).directory.tables['CFF ']).toBeDefined();
    expect(marked(f.fk)).toBe(true);
  });
});
