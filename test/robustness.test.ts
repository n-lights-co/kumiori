import { describe, expect, it } from 'vitest';
import { cgmToSvg } from '../src/cgm';
import { runEps } from '../src/eps';
import { emfToSvg, wmfToSvg } from '../src/metafile';
import { decodeModifiedHuffman } from '../src/ccitt';
import { decodeGif, expandRle } from '../src/pixels';
import { latin1 } from '../src/psInterp';

/** 壊れたファイル・細工したファイルで、止まらない・落ちない・メモリを使い切らない */

/** CGM の命令 (ISO/IEC 8632-3 5.4) */
function cmd(cls: number, id: number, data: number[] = []): number[] {
  const h = (cls << 12) | (id << 5) | data.length;
  const out = [h >> 8, h & 0xff, ...data];
  if (data.length % 2) out.push(0);
  return out;
}
const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
const cgm = (body: number[]) =>
  new Uint8Array([...cmd(0, 1, [1, 116]), ...cmd(0, 3, [1, 112]), ...cmd(2, 6, i16(0, 0, 100, 50)), ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);

const eps = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n${body}\nshowpage\n`);

describe('細工した入力への備え', () => {
  it('CGM: 規格に無い精度 (0) は警告して既定値のまま読む', () => {
    const r = cgmToSvg(cgm([...cmd(3, 1, i16(0)), ...cmd(4, 1, i16(0, 0, 100, 50))]))!;
    expect(r.warnings.join()).toContain('VDC INTEGER PRECISION');
    expect(r.svg).toContain('<path');
  });

  it('PostScript: 空の手続きの repeat でも時間の上限で止まる', () => {
    // 上限 (時間。速い機械では、先に手数の上限に当たることもある) で打ち切られたことを、結果の error で確かめる。
    // かかった時間そのものは比べない (混んだ機械で落ちる)。上限が効かずに回り続ければ、vitest の時限で落ちる
    const r = runEps(eps('2000000000 {} repeat'), { maxMillis: 300 })!;
    expect(r).toBeDefined();
    expect(r.error).toMatch(/^limit:(time|steps)$/);
  }, 60_000);

  it('PostScript: 大きすぎる array は limitcheck のエラー (メモリを使い切らない)', () => {
    const r = runEps(eps('300000000 array pop'))!;
    expect(r.error).toBeDefined();
    const ok = runEps(eps('{ 300000000 array } stopped { 0 0 moveto 10 10 lineto stroke } if'))!;
    expect(ok.items.length).toBe(1);
  });

  it('PostScript: save の後に同じ場所を書き換え続けても journal が伸びない (時間の上限で止まる)', () => {
    // journal (save の後の書き換えの記録) が伸びれば、その上限の limitcheck や VMerror で終わる。
    // 伸びなければ、無限の loop は時間 (速い機械では手数) の上限で打ち切られる。どちらで終わったかを、結果の error で確かめる
    const r = runEps(eps('/a 1 array def { a 0 1 put /x 1 def } loop'), { maxMillis: 300 })!;
    expect(r).toBeDefined();
    expect(r.error).toMatch(/^limit:(time|steps)$/);
  }, 60_000);

  it('PostScript: { の深い入れ子はエラーにする (スタックを使い切らない)', () => {
    const r = runEps(eps('{'.repeat(100000)))!;
    expect(r.error).toBeDefined();
  });

  it('PostScript: bitshift で 32 以上ずらすと 0 (PLRM)', () => {
    const r = runEps(eps('1 32 bitshift 256 -40 bitshift add 0 eq { 0 0 moveto 10 10 lineto stroke } if'))!;
    expect(r.items.length).toBe(1);
  });

  it('WMF: 途中で切れた記録は、そこで読むのをやめる (例外を出さない)', () => {
    const b = new Uint8Array(22 + 18 + 8);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x9ac6cdd7, true);
    v.setInt16(10, 100, true);
    v.setInt16(12, 100, true);
    v.setUint16(14, 1440, true);
    [1, 9, 0x300, 0, 0, 0, 0, 0, 0].forEach((w, k) => v.setUint16(22 + k * 2, w, true));
    // POLYGON (点 1000 個と書いて、点が無い)
    v.setUint32(40, 100, true);
    v.setUint16(44, 0x0324, true);
    v.setUint16(46, 1000, true);
    expect(() => wmfToSvg(b)).not.toThrow();
    expect(() => wmfToSvg(new Uint8Array(2))).not.toThrow();
  });

  it('EMF: 点の無い POLYBEZIER・引数の無い記録で例外を出さない', () => {
    const b = new Uint8Array(88 + 28 + 8);
    const v = new DataView(b.buffer);
    v.setUint32(0, 1, true);
    v.setUint32(4, 88, true);
    v.setUint32(40, 0x464d4520, true);
    // EMR_POLYBEZIER (2): Bounds (16 バイト) と点の数 0
    v.setUint32(88, 2, true);
    v.setUint32(92, 28, true);
    // EMR_SETWINDOWEXTEX (9): 大きさ 8 (引数なし)
    v.setUint32(116, 9, true);
    v.setUint32(120, 8, true);
    expect(() => emfToSvg(b)).not.toThrow();
  });

  it('画素の数の上限: GIF・CCITT・RLE は頭の寸法だけで大量のメモリを確保しない', () => {
    // GIF: 60000×60000 と書いた 35 バイトのファイル
    const gif = new Uint8Array(35);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x60, 0xea, 0x60, 0xea, 0x80, 0, 0], 0);
    expect(decodeGif(gif)).toBeUndefined();
    expect(decodeModifiedHuffman(new Uint8Array(500).fill(0xff), { width: 1e6, rows: 4000, compression: 4 })).toBeUndefined();
    expect(() => expandRle(new Uint8Array(4), 0x7fff0000, 1, 8)).toThrow(RangeError);
  });
});
