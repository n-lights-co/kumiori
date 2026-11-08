import { describe, expect, it } from 'vitest';
import { cffCharStrings, cffGidToCid, cffTable, subsetCff } from '../src/cff';

/** INDEX (Technical Note #5176 §5。offSize 1) */
const index = (items: number[][]) => {
  if (!items.length) return [0, 0];
  const offs = [1];
  for (const it of items) offs.push(offs[offs.length - 1] + it.length);
  return [items.length >> 8, items.length & 0xff, 1, ...offs, ...items.flat()];
};
const int32 = (x: number) => [29, (x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff];
const small = (x: number) => [x + 139];

/**
 * CID 方式の小さな CFF: 字 4 つ (GID 0〜3)、GID 1〜3 の CID は 5・9・2。FD 1 つ、Private DICT に defaultWidthX と局所の Subrs
 */
function makeCidCff() {
  const header = [1, 0, 4, 1];
  const name = index([[...'T'].map((c) => c.charCodeAt(0))]);
  const strings = index([[...'Adobe'].map((c) => c.charCodeAt(0)), [...'Identity'].map((c) => c.charCodeAt(0))]);
  const gsubrs = index([]);
  const glyphs = [0, 1, 2, 3].map((g) => [...small(g), ...small(0), 21, 14]); // rmoveto endchar
  const charset = [0, 0, 5, 0, 9, 0, 2];
  const fdSelect = [0, 0, 0, 0, 0];
  const charStrings = index(glyphs);
  const subrs = index([[11]]);
  const priv = (subrsOff: number) => [248, 136, 20, ...int32(subrsOff), 19]; // defaultWidthX 500, Subrs
  const privLen = priv(0).length;
  // Top DICT: ROS (SID 391 = Adobe, 392 = Identity, 0)、CIDCount、charset、FDSelect、CharStrings、FDArray
  const top = (o: Record<string, number>) => [...int32(391), ...int32(392), ...small(0), 12, 30, ...int32(10), 12, 34, ...int32(o.charset), 15, ...int32(o.fdSelect), 12, 37, ...int32(o.charStrings), 17, ...int32(o.fdArray), 12, 36];
  const fd = (o: Record<string, number>) => [...int32(privLen), ...int32(o.priv), 18];
  const topLen = index([top({ charset: 0, fdSelect: 0, charStrings: 0, fdArray: 0 })]).length;
  let at = header.length + name.length + topLen + strings.length + gsubrs.length;
  const o: Record<string, number> = {};
  o.charset = at;
  at += charset.length;
  o.fdSelect = at;
  at += fdSelect.length;
  o.charStrings = at;
  at += charStrings.length;
  o.fdArray = at;
  at += index([fd({ priv: 0 })]).length;
  o.priv = at;
  return new Uint8Array([...header, ...name, ...index([top(o)]), ...strings, ...gsubrs, ...charset, ...fdSelect, ...charStrings, ...index([fd(o)]), ...priv(privLen), ...subrs]);
}

describe('CFF の部分書体 (cff.ts)', () => {
  it('CID 方式の CFF の GID → CID は charset から (ISO 32000-2 §9.7.4.2)', () => {
    expect(Array.from(cffGidToCid(makeCidCff())!)).toEqual([0, 5, 9, 2]);
  });
  it('使わない字の字形を空にし、字の番号・CID・Private DICT・局所の Subrs は保つ', () => {
    const src = makeCidCff();
    const out = subsetCff(src, new Set([2]));
    expect(Array.from(cffGidToCid(out)!)).toEqual([0, 5, 9, 2]);
    const before = cffCharStrings(src);
    const after = cffCharStrings(out);
    expect(after.length).toBe(4);
    expect(Array.from(after[0])).toEqual(Array.from(before[0])); // .notdef は残す
    expect(Array.from(after[2])).toEqual(Array.from(before[2]));
    expect(Array.from(after[1])).toEqual([14]);
    expect(Array.from(after[3])).toEqual([14]);
    // Private DICT (defaultWidthX 500 と Subrs の位置) の直後に、局所の Subrs (return 1 つ) が来る
    expect(Array.from(out.slice(-15))).toEqual([248, 136, 20, 29, 0, 0, 0, 9, 19, 0, 1, 1, 1, 2, 11]);
    // 部分書体を、もう一度部分書体にしても同じ
    expect(Array.from(subsetCff(out, new Set([2])))).toEqual(Array.from(out));
  });
  it('OpenType (sfnt) の表の一覧から CFF の表を取り出す', () => {
    const cff = makeCidCff();
    const sfnt = new Uint8Array(12 + 16 + cff.length);
    const v = new DataView(sfnt.buffer);
    sfnt.set([0x4f, 0x54, 0x54, 0x4f]); // OTTO
    v.setUint16(4, 1);
    sfnt.set([0x43, 0x46, 0x46, 0x20], 12); // 'CFF '
    v.setUint32(20, 28);
    v.setUint32(24, cff.length);
    sfnt.set(cff, 28);
    expect(Array.from(cffTable(sfnt)!)).toEqual(Array.from(cff));
  });
});
