/**
 * 公開の前の脆弱性検査 (0.2.0) で見つけた、細工した入力への守り: 数十〜数百バイトのファイルで、時間かメモリを使い切らせる入力が、
 * すぐに「読めない画像」か PostScript のエラーで終わること。どの入力も、直す前は、数十秒〜時限なし・数 GB を使っていた
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Interp, latin1, type InterpOptions } from '../src/psInterp';
import { Graphics } from '../src/psGraphics';
import { epsBoundingBox, epsProgram } from '../src/eps';
import { decodeBmp, encodePngStored, pngDataComplete, pngWithinLimits } from '../src/pixels';
import { mentionedFiles, tiffStructureOk } from '../src/assets';
import { collectionFaces, extractFromCollection } from '../src/fontLoader';

function run(src: string, opts: InterpOptions = {}) {
  const I = new Interp({ maxMillis: 5000, ...opts });
  new Graphics(I, { bbox: [0, 0, 100, 100] });
  const t0 = Date.now();
  const error = I.run(latin1(src));
  return { I, error, ms: Date.now() - t0 };
}

describe('PostScript: 勘定の外の確保と、数の欄だけで回るループ', () => {
  it('画像の Width・Height は整数だけ (実数の 2.4e10 × 0.001 を、画素の数の上限の内として通さない)', () => {
    const r = run('<< /ImageType 1 /Width 2.4e10 /Height 0.001 /BitsPerComponent 1 /ImageMatrix [1 0 0 1 0 0] /DataSource (a) /Decode [0 1] >> image');
    expect(r.error).toMatch(/^typecheck/);
    expect(r.ms).toBeLessThan(2000);
    // 値が整数の実数は通す
    expect(run('<< /ImageType 1 /Width 2.0 /Height 1.0 /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0] /DataSource (ab) /Decode [0 1] >> image').error).toBeUndefined();
  });
  it('破線の配列は 1024 要素まで (長い配列を、stroke・gsave のたびに写させない)', () => {
    expect(run('/A 1025 array def 0 1 1024 { A exch 1 put } for A 0 setdash').error).toMatch(/^limitcheck/);
    expect(run('/A 1024 array def 0 1 1023 { A exch 1 put } for A 0 setdash').error).toBeUndefined();
  });
  it('クリップの入れ子は 1000 段まで', () => {
    expect(run('0 0 moveto 1 1 lineto 5000 { clip } repeat').error).toMatch(/^limitcheck/);
    expect(run('0 0 moveto 1 1 lineto 200 { clip } repeat').error).toBeUndefined();
  });
  it('matrix の配列は VM に数える', () => {
    const r = run('{ matrix } loop', { maxVM: 1024 * 1024 });
    expect(r.error).toMatch(/^VMerror/);
  });
  it('標本の関数 (FunctionType 0) の標本の配列は、手間とメモリに数える。関数の配列は 32 個まで', () => {
    const f = '/F << /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [16777216] /BitsPerSample 8 /Order 3 /DataSource (abcd) >> def';
    const r = run(`${f} { << /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /Function [ F F null ] >> shfill } loop`);
    // 網かけを繰り返しても、メモリの上限 (VMerror) か手間の上限で、すぐに終わる
    expect(r.error).toMatch(/VMerror|limit/);
    expect(r.ms).toBeLessThan(5000);
  }, 30_000);
  it('usecmap: 自分自身を足して倍々に増やす CMap は limitcheck', () => {
    const r = run(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def
      1 begincidrange <00> <ff> 0 endcidrange CMapName currentdict /CMap defineresource pop 40 { /X usecmap } repeat`);
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.ms).toBeLessThan(3000);
  });
  it('外接矩形の値が数でない・有限でない EPS は、EPS として読まない', () => {
    expect(epsBoundingBox('%%BoundingBox: 0 0 1.2.3 100')).toBeUndefined();
    expect(epsBoundingBox(`%%BoundingBox: 0 0 ${'9'.repeat(400)} 100`)).toBeUndefined();
    expect(epsBoundingBox('%%BoundingBox: 0 0 100.5 -20')).toEqual([0, 0, 100.5, -20]);
    expect(epsProgram(latin1('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1.2.3 100\n'))).toBeUndefined();
  });
});

describe('画像: 頭の値だけで通る検査', () => {
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (type: string, data: number[]) => [...u32(data.length), ...Array.from(type, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const png = encodePngStored({ width: 4, height: 4, rgba: new Uint8Array(64).fill(200) });
  /** PNG の IHDR の後ろに、チャンクを差し込む */
  const withChunk = (c: number[]) => new Uint8Array([...png.subarray(0, 33), ...c, ...png.subarray(33)]);

  it('PNG: 2 つ目の IHDR・長さの違う IHDR のあるものは読まない', () => {
    expect(pngWithinLimits(png)).toBe(true);
    expect(pngWithinLimits(withChunk(chunk('IHDR', [...u32(10000), ...u32(10000)])))).toBe(false);
    expect(pngWithinLimits(withChunk(chunk('IHDR', [...u32(10000), ...u32(10000), 8, 6, 0, 0, 0])))).toBe(false);
  });
  it('PNG: 動く PNG のコマ (fcTL) が画像からはみ出すもの・コマの画素の合計が上限を超えるものは読まない', () => {
    const fctl = (w: number, h: number) => chunk('fcTL', [...u32(0), ...u32(w), ...u32(h), ...u32(0), ...u32(0), 0, 1, 0, 1, 0, 0]);
    expect(pngWithinLimits(withChunk(fctl(4, 4)))).toBe(true);
    expect(pngWithinLimits(withChunk(fctl(16000, 16000)))).toBe(false);
  });
  it('PNG: 画素のデータが途中で壊れているものは、展開する側 (pdf-lib) に渡さない', () => {
    expect(pngDataComplete(png)).toBe(true);
    // IDAT の中身 (zlib の列) を途中から壊す: 圧縮しない塊の長さを偽る
    const bad = png.slice();
    const at = bad.findIndex((_, i) => bad[i] === 0x49 && bad[i + 1] === 0x44 && bad[i + 2] === 0x41 && bad[i + 3] === 0x54);
    bad.fill(0xff, at + 6, at + 14);
    expect(pngDataComplete(bad)).toBe(false);
  });
  it('BMP: 1 画素のビット数が 0 のものは読まない (54 バイトで 10000 × 10000)', () => {
    const b = new Uint8Array(54);
    const dv = new DataView(b.buffer);
    b[0] = 0x42;
    b[1] = 0x4d;
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, 10000, true);
    dv.setInt32(22, 10000, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 0, true);
    const t0 = Date.now();
    expect(decodeBmp(b)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('TIFF: 次の IFD が自分自身を指すもの・値の数がファイルに収まらないものは、utif に渡さない', () => {
    const tiff = (next: number, count: number) => {
      const b = new Uint8Array(64);
      const dv = new DataView(b.buffer);
      b[0] = b[1] = 0x49;
      dv.setUint16(2, 42, true);
      dv.setUint32(4, 8, true);
      dv.setUint16(8, 1, true); // 項目 1 つ
      dv.setUint16(10, 256, true);
      dv.setUint16(12, 4, true);
      dv.setUint32(14, count, true);
      dv.setUint32(18, 32, true);
      dv.setUint32(22, next, true);
      return b;
    };
    expect(tiffStructureOk(tiff(0, 1))).toBe(true);
    expect(tiffStructureOk(tiff(8, 1))).toBe(false);
    expect(tiffStructureOk(tiff(0, 60_000_000))).toBe(false);
    // 見本の TIFF (LZW) は通る
    expect(tiffStructureOk(new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../docs/conformance/fo/images/woven.tif'))))).toBe(true);
  });
});

describe('文字の走査・書体の集まり', () => {
  it('mentionedFiles: 区切りの無い長い並び (data: の URL) でも、長さに比例した時間で終わる。拾う名前はこれまでと同じ', () => {
    const t0 = Date.now();
    const got = mentionedFiles([`@font-face { src: url(data:font/ttf;base64,${'A'.repeat(2_000_000)}) } p { background: url(img/a%20b.png) } <img src=c.jpg> x.png.bak d.gif?x=1 e/f.svg,g.webp`]);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect([...got].sort()).toEqual(['a b.png', 'c.jpg', 'd.gif', 'f.svg', 'g.webp']);
    // 引用符の中の名前 (空白を含む。空白の後ろだけの名前も拾う: 多めに拾う決まり)、名前の無い拡張子だけの並び
    expect([...mentionedFiles(['<img src="my pic.png"> (.png) a.b.tiff'])].sort()).toEqual(['a.b.tiff', 'my pic.png', 'pic.png']);
  });
  it('書体の集まり: 同じ場所を指す表を並べた書体は読まない (取り出しで写しを増やさない)', () => {
    // 書体 1 つ、表 4 つが、どれも同じ 64 バイトを指す TTC
    const n = 4;
    const b = new Uint8Array(12 + 4 + 12 + n * 16 + 64);
    const dv = new DataView(b.buffer);
    b.set([0x74, 0x74, 0x63, 0x66]);
    dv.setUint32(4, 0x00010000);
    dv.setUint32(8, 1);
    dv.setUint32(12, 16);
    dv.setUint32(16, 0x00010000);
    dv.setUint16(20, n);
    const data = 28 + n * 16;
    for (let i = 0; i < n; i++) {
      b.set([0x74, 0x30 + i, 0x20, 0x20], 28 + i * 16);
      dv.setUint32(28 + i * 16 + 8, data);
      dv.setUint32(28 + i * 16 + 12, 64);
    }
    expect(() => extractFromCollection(b.buffer, 0)).toThrow();
    expect(() => collectionFaces(b.buffer)).toThrow();
    // 表が重ならなければ取り出せる
    dv.setUint16(20, 1);
    expect(extractFromCollection(b.buffer, 0).byteLength).toBe(12 + 16 + 64);
  });
});
