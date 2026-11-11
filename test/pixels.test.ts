import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { decodeBmp, decodeGif, encodePng, type Pixels } from '../src/pixels';
import { decodeWebp } from '../src/webp';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const at = (p: Pixels, x: number, y: number) => Array.from(p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

// 5×9 の GIF (PIL で作った)。(x + y) % 4 の色: 赤・緑・青・黄
const GIF = '47494638376105000900810000ffff0000ff00ff00000000ff2c00000000050009000008160005041800402041830507263ca810a1c386100f0604003b';
const COLORS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
];

describe('画素の読み書き (Node 用)', () => {
  it('GIF: LZW を展開し、色の表で色にする。飛び越し (interlace) の行の順', () => {
    const p = decodeGif(hex(GIF))!;
    expect([p.width, p.height]).toEqual([5, 9]);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) expect(at(p, x, y)).toEqual(COLORS[(x + y) % 4]);
    // 同じデータを飛び越しとして読むと、k 番目の行は 0,8,4,2,6,1,3,5,7 行目に置かれる
    const b = hex(GIF);
    b[13 + 12 + 9] |= 0x40; // 画像の記述子の印 (頭 13 バイト・色の表 4 色 12 バイトの後の、記述子の 10 バイト目)
    const q = decodeGif(b)!;
    [0, 8, 4, 2, 6, 1, 3, 5, 7].forEach((row, k) => expect(at(q, 0, row)).toEqual(at(p, 0, k)));
    // GIF でないもの
    expect(decodeGif(new TextEncoder().encode('<!DOCTYPE html>'))).toBeUndefined();
  });

  it('GIF: 画素の数をファイルの大きさでも縛る (IMG-19 (2)。34 バイトで 10000×10000 画素を指定したファイルは読まない)', async () => {
    const { gifPixelBudget, GIF_FREE_PIXELS, GIF_PIXELS_PER_BYTE } = await import('../src/imageLimits');
    // 頭の寸法 (論理画面・画像) を 10000×10000 にした、データのほとんど無い GIF
    const big = hex(GIF);
    const set16 = (o: number, v: number) => ((big[o] = v & 255), (big[o + 1] = v >> 8));
    set16(6, 10000);
    set16(8, 10000);
    set16(13 + 12 + 1 + 4, 10000);
    set16(13 + 12 + 1 + 6, 10000);
    expect(decodeGif(big)).toBeUndefined();
    // 上限は、ファイルの大きさに依らない分 + 1 バイトあたりの分
    expect(gifPixelBudget(34)).toBe(GIF_FREE_PIXELS + GIF_PIXELS_PER_BYTE * 34);
    // 正当な GIF の密度 (LZW の 12 ビットの符号 1 つで 4,096 画素まで = 1 バイトで約 2,730 画素) は上限の内に入る
    expect(GIF_PIXELS_PER_BYTE).toBeGreaterThan(4096 / 1.5);
    // 小さな GIF は、これまでどおり読む
    expect(decodeGif(hex(GIF))).toBeDefined();
  });

  it('BMP: 24 ビット (下から上へ・行の 4 バイト揃え) と 8 ビット (色の表)', () => {
    const bmp = (bpp: number, w: number, h: number, pal: number[][], px: (x: number, y: number) => number[]) => {
      const row = Math.floor((bpp * w + 31) / 32) * 4;
      const off = 54 + pal.length * 4;
      const b = new Uint8Array(off + row * Math.abs(h));
      const dv = new DataView(b.buffer);
      b.set([0x42, 0x4d]);
      dv.setUint32(10, off, true);
      dv.setUint32(14, 40, true);
      dv.setInt32(18, w, true);
      dv.setInt32(22, h, true);
      dv.setUint16(28, bpp, true);
      dv.setUint32(46, pal.length, true);
      pal.forEach((c, i) => b.set([c[2], c[1], c[0], 0], 54 + i * 4));
      for (let y = 0; y < Math.abs(h); y++) {
        const r = off + (h > 0 ? Math.abs(h) - 1 - y : y) * row;
        for (let x = 0; x < w; x++) b.set(px(x, y), r + (x * bpp) / 8);
      }
      return b;
    };
    const p24 = decodeBmp(bmp(24, 3, 2, [], (x, y) => [x * 10, y * 20, 255]))!; // BGR
    expect([p24.width, p24.height]).toEqual([3, 2]);
    expect(at(p24, 2, 1)).toEqual([255, 20, 20, 255]);
    const p8 = decodeBmp(bmp(8, 2, -2, [[1, 2, 3], [200, 100, 50]], (x, y) => [(x + y) % 2]))!; // 上から下へ
    expect(at(p8, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(at(p8, 1, 0)).toEqual([200, 100, 50, 255]);
    expect(decodeBmp(new TextEncoder().encode('<!DOCTYPE html>'))).toBeUndefined();
  });

  it('WebP の可逆圧縮 (変換・色の表)', () => {
    // libwebp 1.6 で作った 13×7 (RGBA。色は x・y の式、3 画素に 1 つは半透明)
    const t1 = hex(
      '524946466a000000574542505650384c5d0000002f0c800110b93244f43f7611d1ff8082b66d1893297f8eddc130136a22498a269fe8f8518017542088f004134cd2f4f9f0f1a1306d1b269d7a05c824f1281886f08f82dec102eff05df0e031447c81766e088f71e0c9163a44883cc60600',
    );
    const p = decodeWebp(t1)!;
    expect([p.width, p.height]).toEqual([13, 7]);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 13; x++) expect(at(p, x, y)).toEqual([(x * 19) % 256, (y * 37) % 256, (x * y * 11) % 256, (x + y) % 3 ? 255 : 128]);
    // 4 色の 9×5 (色の表・1 画素 2 ビットに詰める)
    const pal = [
      [255, 0, 0, 255],
      [0, 128, 255, 255],
      [20, 200, 20, 255],
      [250, 250, 0, 255],
    ];
    const q = decodeWebp(hex('5249464642000000574542505650384c350000002f080001001f201020fc17a910a44421db0890c7fcf1cee015082441ec2fb8c4fc077713510341b6cd73de728e31a2ffc1eaacce0000'))!;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) expect(at(q, x, y)).toEqual(pal[(x + 2 * y) % 4]);
    // 頭だけの非可逆 (VP8)・WebP でないもの
    expect(decodeWebp(hex('52494646240000005745425056503820180000003001009d012a0100010000'))).toBeUndefined();
    expect(decodeWebp(new TextEncoder().encode('<!DOCTYPE html>'))).toBeUndefined();
  });

  it('動く WebP は最初のコマを canvas の中の位置に置く (RFC 9649 §2.7.1.1・§2.7.2)', () => {
    // 4 色の 9×5 の可逆の画像 (上のテストと同じもの) の VP8L のチャンクを、コマ (ANMF) の中身にする
    const still = hex('5249464642000000574542505650384c350000002f080001001f201020fc17a910a44421db0890c7fcf1cee015082441ec2fb8c4fc077713510341b6cd73de728e31a2ffc1eaacce0000');
    const vp8l = still.subarray(12);
    const pal = [
      [255, 0, 0, 255],
      [0, 128, 255, 255],
      [20, 200, 20, 255],
      [250, 250, 0, 255],
    ];
    const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
    const chunk = (id: string, body: number[]) => [...id].map((c) => c.charCodeAt(0)).concat([body.length & 255, (body.length >> 8) & 255, 0, 0], body, body.length & 1 ? [0] : []);
    const anmf = (fx: number, fy: number, w: number, h: number, flags: number, data: Uint8Array) => chunk('ANMF', [...u24(fx), ...u24(fy), ...u24(w - 1), ...u24(h - 1), ...u24(100), flags, ...data]);
    const file = (cw: number, ch: number, flags: number, frames: number[][]) => {
      const body = [...chunk('VP8X', [flags, 0, 0, 0, ...u24(cw - 1), ...u24(ch - 1)]), ...chunk('ANIM', [0, 0, 255, 255, 0, 0]), ...frames.flat()];
      const n = body.length + 4;
      return Uint8Array.from([0x52, 0x49, 0x46, 0x46, n & 255, (n >> 8) & 255, 0, 0, 0x57, 0x45, 0x42, 0x50, ...body]);
    };
    // canvas は 16×12。最初のコマは Frame X = 2・Frame Y = 3 (位置は 2 倍の (4, 6))。2 つ目のコマ (位置 (0, 0)) は描かない
    const p = decodeWebp(file(16, 12, 0x12, [anmf(2, 3, 9, 5, 0, vp8l), anmf(0, 0, 9, 5, 0, vp8l)]))!;
    expect([p.width, p.height]).toEqual([16, 12]);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 16; x++) {
        const inside = x >= 4 && x < 13 && y >= 6 && y < 11;
        // コマの外は透明 (背景の色は目安で、使わなくてよい)
        expect(at(p, x, y), `${x},${y}`).toEqual(inside ? pal[(x - 4 + 2 * (y - 6)) % 4] : [0, 0, 0, 0]);
      }
    // コマが canvas からはみ出す (MUST に反する)・コマの大きさがビット列と違う・Animation の旗が無い → 読めない
    expect(decodeWebp(file(16, 12, 0x12, [anmf(4, 3, 9, 5, 0, vp8l)]))).toBeUndefined();
    expect(decodeWebp(file(16, 12, 0x12, [anmf(0, 0, 8, 5, 0, vp8l)]))).toBeUndefined();
    expect(decodeWebp(file(16, 12, 0x10, [anmf(2, 3, 9, 5, 0, vp8l)]))).toBeUndefined();
  });

  it('WebP の非可逆圧縮 (VP8。通常・簡易のループフィルタ) と透明度 (ALPH): libwebp が読んだ画素と同じ', () => {
    // 画素の和と、31 倍して足していった値 (1000000007 で割った余り) を、PIL の読んだ結果と比べる
    const check = (p: Pixels) => {
      let sum = 0;
      let h = 0;
      for (const v of p.rgba) {
        sum += v;
        h = (h * 31 + v) % 1000000007;
      }
      return [sum, h];
    };
    // 24×18 の RGBA (品質 60。右半分は半透明: VP8X・ALPH・VP8)
    const a = decodeWebp(
      hex(
        '52494646f000000057454250565038580a00000010000000170000110000414c50481e000000091f20102038f01fab2322020f06d946eabdbff3041e20a2ff710c54ff0156503820ac000000f005009d012a180012003eb5489c4aa72422a1b0180c00e016896c00b11ee3750797db8308781343d8671ec46a221e9e60d65436f427dba000fefa93324093da5e0a1dcdf05ed9408be873b6dcfc38125082653a5396916b3943ee52e80e0d9161842442ad596c19c7484edbfe4e4c547afd7a3dfa641b0fc7e36958d8b2a9ad0305608768c50a4ad0c4d3e9fff1520f9effe3ffe2c8316618d7af7036818063ded2caf005e462f794078000',
      ),
    )!;
    expect([a.width, a.height]).toEqual([24, 18]);
    expect(at(a, 5, 3)).toEqual([61, 40, 72, 255]);
    expect(at(a, 20, 10)).toEqual([217, 153, 45, 150]);
    expect(check(a)).toEqual([246384, 334353837]);
    // 33×17 の写真 (品質 40。16 の倍数でない大きさ)
    const r = decodeWebp(
      hex(
        '524946468e0000005745425056503820820000009004009d012a210011003eed6caf4f29a624a22aaa01301d894018cf8272cfcf2b4b9c5210990711968fbc300000fe8d30803e0b95a730d9e1341c1fee598e40c85f0563e1df087f04d3449f9b791b7d1f5dc2761712675b384ab0ca88b4b633db00c5544018e0523b6c97519d0a9db3cad0e7e079c6843ad5f1c4b0346f28000000',
      ),
    )!;
    expect([r.width, r.height]).toEqual([33, 17]);
    expect(at(r, 5, 3)).toEqual([125, 195, 212, 255]);
    expect(check(r)).toEqual([487867, 3206522]);
    // 40×24 の写真 (簡易ループフィルタ・シャープネス 3・セグメント 2。cwebp -nostrong で作り、dwebp が読んだ画素と比べる)
    const sf = decodeWebp(
      hex(
        '52494646940000005745425056503820880000007205009d012a280018003f1146c4623223b2321aa6462209401956858a4bf8abaafbbe2767a6c5db4685cda6cbb188ac156eddd000fedff43e71a0651ef1204d1a1bf4fb9f497510b6837cb15c74563de14b4f48e00551df296052edf04c41d03191536e93e4dc739d141255ef9e891911642f9935cd61fd32593c8a71c89370d459e0fd44800000',
      ),
    )!;
    expect(at(sf, 5, 3)).toEqual([186, 170, 157, 255]);
    expect(at(sf, 30, 20)).toEqual([255, 255, 229, 255]);
    expect(check(sf)).toEqual([861625, 78820968]);
  });

  it('PNG にして読み戻すと同じ画素', async () => {
    const p = decodeGif(hex(GIF))!;
    const png = PNG.sync.read(Buffer.from(await encodePng(p)));
    expect([png.width, png.height]).toEqual([5, 9]);
    expect(Array.from(png.data)).toEqual(Array.from(p.rgba));
  });
});

describe('TIFF: パレット + 透明度 (1 画素 2 サンプル)', () => {
  it('BitsPerSample が 1 つだけ書かれていても、2 サンプル目まで読んで画像全体を組む (EPS のプレビューに多い形)', async () => {
    const { AssetStore } = await import('../src/assets');
    const W = 2;
    const H = 4;
    const tags: Array<[number, number, number, number]> = [];
    // 後で埋める位置
    const ifdOff = 8;
    const nTags = 10;
    const mapOff = ifdOff + 2 + nTags * 12 + 4;
    const dataOff = mapOff + 768 * 2;
    tags.push([256, 3, 1, W], [257, 3, 1, H], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 3], [273, 4, 1, dataOff], [277, 3, 1, 2], [279, 4, 1, W * H * 2], [320, 3, 768, mapOff], [338, 3, 1, 1]);
    const b = new Uint8Array(dataOff + W * H * 2);
    const v = new DataView(b.buffer);
    b.set([0x49, 0x49, 42, 0]);
    v.setUint32(4, ifdOff, true);
    v.setUint16(ifdOff, nTags, true);
    tags.forEach(([t, ty, c, val], k) => {
      const o = ifdOff + 2 + k * 12;
      v.setUint16(o, t, true);
      v.setUint16(o + 2, ty, true);
      v.setUint32(o + 4, c, true);
      if (ty === 3 && c === 1) v.setUint16(o + 8, val, true);
      else v.setUint32(o + 8, val, true);
    });
    // 色 1 = 赤 (R=65535)
    v.setUint16(mapOff + 2, 65535, true);
    // 全画素: 色 1・不透明
    for (let i = 0; i < W * H; i++) b.set([1, 255], dataOff + i * 2);
    const store = new AssetStore();
    const a = await store.addBlob('p.tif', new Blob([b]));
    expect(a).toBeDefined();
    // PNG に直したものを、最後の行まで赤・不透明として読めること (PNG の IDAT を展開して確かめる)
    const { inflateSync } = await import('node:zlib');
    const png = a!.bytes!;
    let p = 8;
    const idat: number[] = [];
    while (p < png.length) {
      const len = new DataView(png.buffer, png.byteOffset).getUint32(p);
      const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      if (type === 'IDAT') idat.push(...png.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    const raw = inflateSync(Uint8Array.from(idat));
    const row = 1 + W * 4;
    const last = raw.subarray((H - 1) * row + 1, H * row);
    expect([...last.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});
