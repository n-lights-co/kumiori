/**
 * width・height の属性 (HTML §15.4.3 の寸法の属性。表示のための指定) で大きさを書いた画像を、既定のスタイルの img { max-width: 100% } で
 * 縮めるときは、縦横比を保つ (CSS 2.1 §10.4 の表。属性の大きさを望む大きさとして縮める)。作成者が width・height・max-width を CSS で
 * 書いたときは、CSS のとおり (幅と高さがどちらも決まっていれば、それぞれに上限・下限を当てるだけ)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, walkAreaTree } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const png = (w: number, h: number) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(128) });
const IMGS: Record<string, Uint8Array> = { 'a.png': png(600, 400), 'sq.png': png(100, 100), 's.png': png(100, 50) };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 本文の幅 200pt のページで組んだ画像の大きさ (pt) */
async function sizes(body: string, css = '', style?: string): Promise<string[]> {
  const html = `<!DOCTYPE html><html><head><style>@page { size: 300pt 600pt; margin: 50pt } body { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont: loadCachedFont, fetchImages: false, ...(style ? { style: style as 'kumiori' } : {}), resolveResource: (u) => IMGS[u] });
  const out: string[] = [];
  walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && out.push(`${r2(a.width)}x${r2(a.height)}`)));
  return out;
}

describe('属性の大きさの画像を、既定のスタイルの max-width で縮める', () => {
  it('属性の比を保って縮める (600×400 の属性を幅 200pt に: 200×133.33)', async () => {
    expect(await sizes('<p><img src="a.png" width="600" height="400"></p>')).toEqual(['200x133.33']);
    // 高さだけの属性も、幅は縦横比から出して、高さも縮める
    expect(await sizes('<p><img src="a.png" height="400"></p>')).toEqual(['200x133.33']);
    // 本来の比と違う属性の比 (100×100 の画像に 600×400): 属性の比で縮める
    expect(await sizes('<p><img src="sq.png" width="600" height="400"></p>')).toEqual(['200x133.33']);
    // 縮めないもの・幅だけの属性は、これまでどおり
    expect(await sizes('<p><img src="s.png" width="100" height="50"></p>')).toEqual(['75x37.5']);
    expect(await sizes('<p><img src="a.png" width="600"></p>')).toEqual(['200x133.33']);
  });
  it('表のセル・回り込み・flex の項目・inline-block・ブロックの画像も、比を保つ', async () => {
    const I = '<img src="a.png" width="600" height="400"';
    expect(await sizes(`<div style="float:left;width:50%">${I}></div><p>x</p>`)).toEqual(['100x66.67']);
    expect(await sizes(`<div style="display:flex"><div>${I}></div></div>`)).toEqual(['200x133.33']);
    expect(await sizes(`<div style="display:flex">${I}></div>`)).toEqual(['200x133.33']);
    expect(await sizes(`<p><span style="display:inline-block;width:100pt">${I}></span></p>`)).toEqual(['100x66.67']);
    expect(await sizes(`${I} style="display:block">`)).toEqual(['200x133.33']);
    const [td] = await sizes(`<table style="width:100%"><tr><td>${I}></td></tr></table>`);
    const [w, h] = td.split('x').map(Number);
    expect(h).toBeCloseTo((w * 400) / 600, 1);
  });
  it('作成者が width・height・max-width を書いたときは、CSS のとおり', async () => {
    const I = '<p><img src="a.png" width="600" height="400"></p>';
    // 作成者の max-width: 100% だけなら、ブラウザと同じに、高さは属性のまま
    expect(await sizes(I, 'img { max-width: 100% }')).toEqual(['200x300']);
    // height: auto を書けば、比を保つ
    expect(await sizes(I, 'img { max-width: 100%; height: auto }')).toEqual(['200x133.33']);
    expect(await sizes(I, 'img { height: auto }')).toEqual(['200x133.33']);
    expect(await sizes(I, 'img { width: 50% }')).toEqual(['100x300']);
    expect(await sizes('<p><img src="a.png" width="600" height="400" style="height: 100pt"></p>')).toEqual(['200x100']);
  });
  it('max-width の無い既定のスタイル (browser・ah) は、縮めない', async () => {
    for (const style of ['browser', 'ah']) expect(await sizes('<p><img src="a.png" width="600" height="400"></p>', '', style), style).toEqual(['450x300']);
  });
});
