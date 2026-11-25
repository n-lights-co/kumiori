/**
 * flex の画像・画像の大きさの決め方 (値は Chrome で組んだ結果と同じ):
 *  - 画像そのものの flex の項目の余白・罫線・内側の余白は、項目の箱だけが持つ (前は画像にも残り、位置に 2 度かかった。Flexbox 1 §4)
 *  - 縦並びの flex の画像の百分率の max-width は、容器の幅が基準 (前は、項目の余白の内側の幅で解いた。CSS 2.1 §10.4)
 *  - 長さの max-width・none に min-width: 0 の画像の項目を縮めたら、画像も項目の幅で描く (前は本来の大きさのまま、はみ出した。Flexbox 1 §9.7)
 *  - grid の中の svg の width: 100% (前は、読み込みの見積もりの幅のまま)・画像の box-sizing: border-box (CSS Box Sizing 3 §4.1)・
 *    画像の aspect-ratio (auto を含まない比は本来の比に代わる。CSS Sizing 4 §5.1)
 *  - flex の容器は、外の float に重ならない (新しい整形文脈。Flexbox 1 §3・CSS 2.1 §9.5)
 *  - 縦書きの論理の名前の大きさ: max-block-size の画像 (物理の幅の上限)・max-inline-size・min-inline-size のブロック (物理の高さの上限・下限)
 */
import zlib from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 400 × 267 px (300 × 200.25 pt) の単色の PNG の data: URL */
const PNG = (() => {
  const w = 400, h = 267;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (b: Buffer) => {
    let x = 0xffffffff;
    for (const v of b) x = table[(x ^ v) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
})();

const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
/** 画像 (x・幅・高さ) と、背景のあるブロック (幅・高さ) と、行 (x・幅) を、組んだ順に */
const boxes = async (body: string, css = '') => {
  const html = `<!DOCTYPE html><html><head><style>@page{size:600pt 2000pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} p{margin:0;text-indent:0} ${css}</style></head><body>${body.replace(/IMG/g, PNG)}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const imgs: Array<{ x: number; w: number; h: number }> = [];
  const bgs: Array<{ w: number; h: number }> = [];
  const lines: Array<{ x: number; w: number }> = [];
  const rec = (a: Area, ox: number) => {
    const x = ox + (a.x ?? 0);
    if (a.type === 'image') imgs.push({ x: r1(x + ((a as { padding?: { left?: number } }).padding?.left ?? 0) + ((a as { border?: { left?: { width?: number } } }).border?.left?.width ?? 0)), w: r1(a.width), h: r1(a.height) });
    if (a.type === 'block' && (a as { backgroundColor?: string }).backgroundColor) bgs.push({ w: r1(a.width), h: r1(a.height) });
    if (a.type === 'line') lines.push({ x: r1(x), w: r1(a.width) });
    const pa = a as unknown as { padding?: Record<string, number>; border?: Record<string, { width?: number } | undefined> };
    const cx = x + (pa.padding?.left ?? 0) + (pa.border?.left?.width ?? 0);
    for (const c of childrenOf(a)) rec(c as Area, cx);
  };
  rec(r.areaTree.sheets[0].page as unknown as Area, 0);
  return { imgs, bgs, lines };
};

describe('flex の画像', () => {
  it('項目の余白・罫線・内側の余白は 1 度だけかかる', async () => {
    const { imgs } = await boxes('<div style="display:flex;width:450pt"><img style="margin:10pt;padding:5pt;border:2pt solid black" src="IMG"><p>L</p></div>');
    expect(imgs[0].x).toBeCloseTo(17, 0);
    expect(imgs[0].w).toBeCloseTo(300, 0);
    const neg = await boxes('<div style="display:flex;width:450pt"><img style="flex:1;margin:-5pt;padding:5pt" src="IMG"><p style="flex:1">Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor</p></div>');
    expect(neg.imgs[0]).toMatchObject({ x: 0, w: 300 });
  });
  it('縦並びの flex の画像の百分率の max-width は、容器の幅で解く', async () => {
    const { imgs } = await boxes('<div style="display:flex;flex-direction:column;width:450pt"><img style="flex:1;max-width:50%;margin:10pt" src="IMG"><img style="max-width:40%;padding:10pt;border:5pt solid" src="IMG"></div>');
    expect(imgs[0]).toMatchObject({ x: 10, w: 225 });
    expect(imgs[1].w).toBeCloseTo(180, 0);
  });
  it('長さの max-width・none に min-width: 0 の画像を縮めたら、画像も項目の幅で描く', async () => {
    const { imgs, lines } = await boxes('<div style="display:flex;width:200pt"><img style="max-width:none;min-width:0" src="IMG"><p>xxxxx</p></div>');
    expect(imgs[0].w).toBeCloseTo(lines[0].w, 0);
    expect(imgs[0].w).toBeLessThan(200);
  });
  it('flex の容器は、外の float の横の幅に縮む', async () => {
    const { lines } = await boxes('<div style="width:300pt"><div style="float:left;width:100pt;height:50pt"></div><div style="display:flex"><p style="flex:1">x</p></div></div>');
    expect(lines[0]).toMatchObject({ x: 100, w: 200 });
  });
});

describe('画像の大きさ', () => {
  it('grid の中の svg の width: 100% は、列の幅で解く', async () => {
    const { imgs } = await boxes('<div style="display:grid;grid-template-columns:100pt 200pt;width:300pt"><svg style="width:100%" viewBox="0 0 10 10"><rect width="10" height="10"/></svg><div>x</div></div>');
    expect(imgs[0]).toMatchObject({ w: 100, h: 100 });
  });
  it('box-sizing: border-box の幅は、枠と内側の余白を含む', async () => {
    const { imgs } = await boxes('<div style="width:300pt"><img style="width:200pt;padding:10pt;box-sizing:border-box" src="IMG"></div>');
    expect(imgs[0]).toMatchObject({ w: 180, h: 120.2 });
  });
  it('aspect-ratio の比 (auto を含まないもの) は、本来の比に代わる', async () => {
    const { imgs } = await boxes('<div style="width:300pt"><img style="width:200pt;aspect-ratio:2" src="IMG"><img style="width:200pt;aspect-ratio:auto 2" src="IMG"></div>');
    expect(imgs[0]).toMatchObject({ w: 200, h: 100 });
    expect(imgs[1]).toMatchObject({ w: 200, h: 133.5 });
  });
  it('縦書きの max-block-size の画像・max-inline-size・min-inline-size のブロック', async () => {
    const { imgs } = await boxes('<div style="writing-mode:vertical-rl;height:400pt;width:500pt"><img style="max-block-size:100pt" src="IMG"><img style="max-width:100pt" src="IMG"></div>', 'img{max-width:none}');
    expect(imgs.map((x) => x.w)).toEqual([100, 100]);
    const { bgs } = await boxes('<div style="writing-mode:vertical-rl;height:400pt;width:500pt"><div style="max-inline-size:120pt;background:#ccc">い</div><div style="max-height:100pt;background:#ccc">あ</div><div style="min-inline-size:450pt;background:#ccc">え</div></div>');
    expect(bgs.map((x) => x.h)).toEqual([120, 100, 450]);
  });
});
