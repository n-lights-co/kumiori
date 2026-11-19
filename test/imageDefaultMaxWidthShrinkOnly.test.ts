/**
 * 既定のスタイルの img { max-width: 100% } が、属性の大きさ (HTML §15.4.3 の寸法の属性) の画像の幅を、実際に縮めたときだけ、高さも
 * 縦横比で縮める。縮めていないとき (百分率の属性の幅・0 の属性・下限で広げたとき・flex で伸ばしたとき) は、CSS 2.1 §10.4 のとおり
 * (属性の幅と高さに、それぞれ上限・下限を当てる)。あわせて、作成者の論理の名前 (max-inline-size など) を作成者の指定として扱うこと、
 * grid の項目そのものの画像が列の下限を広げないこと (CSS Grid 1 §6.6)、flex: 1 の画像の余白・枠が画像の中身を広げないこと
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, walkAreaTree } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const png = (w: number, h: number) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(128) });
const IMGS: Record<string, Uint8Array> = { 'a.png': png(600, 400), 'm.png': png(300, 200) };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 本文の幅 W pt のページで組んだ画像の大きさ (pt) */
async function sizes(body: string, css = '', W = 200, style?: string): Promise<string[]> {
  const html = `<!DOCTYPE html><html><head><style>@page { size: ${W + 100}pt 600pt; margin: 50pt } body { margin: 0; font-size: 10pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont: loadCachedFont, fetchImages: false, ...(style ? { style: style as 'kumiori' } : {}), resolveResource: (u) => IMGS[u] });
  const out: string[] = [];
  walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && out.push(`${r2(a.width)}x${r2(a.height)}`)));
  return out;
}

describe('既定のスタイルの max-width が縮めないときは、属性の高さのまま', () => {
  it('百分率の属性の幅と、属性の高さ (段落・表のセル・flex の項目・float)', async () => {
    expect(await sizes('<p><img src="a.png" width="50%" height="400"></p>')).toEqual(['100x300']);
    expect(await sizes('<p><img src="a.png" width="100%" height="400"></p>')).toEqual(['200x300']);
    expect(await sizes('<p><img src="a.png" width="50%" height="100"></p>')).toEqual(['100x75']);
    expect(await sizes('<div style="display:flex"><div><img src="a.png" width="50%" height="400"></div></div>')).toEqual(['100x300']);
    expect(await sizes('<div style="float:left"><img src="a.png" width="50%" height="400"></div><p>x</p>')).toEqual(['100x300']);
    const [td] = await sizes('<table style="width:100%"><tr><td><img src="a.png" width="50%" height="400"></td></tr></table>');
    expect(td.split('x')[1]).toBe('300');
  });
  it('0 の属性: 縦横比から出す向きは、下限で広げた幅・高さから', async () => {
    expect(await sizes('<p><img src="a.png" width="0" style="min-width:100pt"></p>')).toEqual(['100x66.67']);
    expect(await sizes('<p><img src="a.png" width="0" style="min-width:300pt"></p>')).toEqual(['300x200']);
    expect(await sizes('<p><img src="a.png" height="0" style="min-height:100pt"></p>')).toEqual(['150x100']);
    expect(await sizes('<p><img src="a.png" width="0" height="400"></p>')).toEqual(['0x300']);
  });
  it('flex で伸ばした属性の画像の高さは、属性のまま。max-width で縮めたときだけ比で縮める', async () => {
    const T = '<p>Some description text alongside the picture that wraps.</p>';
    const [small] = await sizes(`<div style="display:flex"><img src="m.png" width="100" height="50" style="flex:1">${T}</div>`, '', 360);
    expect(small.split('x')[1]).toBe('37.5');
    expect(Number(small.split('x')[0])).toBeGreaterThan(75);
    // 属性の幅 450pt を、容器の幅 360pt に縮めたもの: 比を保つ
    expect(await sizes(`<div style="display:flex"><img src="m.png" width="600" height="400" style="flex:1">${T}</div>`, '', 360)).toEqual(['360x240']);
  });
  it('作成者の min-width: 0・overflow で、flex が既定の上限より狭く縮めた画像の高さは、属性のまま', async () => {
    // 項目の幅 50pt は、既定の max-width (容器の幅 200pt) でなく、flex の縮み (作成者が自動の最小の大きさを外した: Flexbox 1 §4.5) で決まる
    const F = '<div style="flex:0 0 150pt">x</div>';
    expect(await sizes(`<div style="display:flex"><img src="a.png" width="600" height="400" style="min-width:0">${F}</div>`)).toEqual(['50x300']);
    expect(await sizes(`<div style="display:flex"><img src="a.png" width="600" height="100" style="min-width:0">${F}</div>`)).toEqual(['50x75']);
    expect(await sizes(`<div style="display:flex"><img src="a.png" width="600" height="400" style="overflow:hidden">${F}</div>`)).toEqual(['50x300']);
    // 自動の最小の大きさのままなら、項目は既定の上限 (容器の幅) で止まり、比を保って縮める
    expect(await sizes(`<div style="display:flex"><img src="a.png" width="600" height="400">${F}</div>`)).toEqual(['200x133.33']);
  });
  it('隣の無い min-width: 0・overflow の画像は、見積もりより狭い置き場でも、既定の上限 (実際の容器の幅) で止まり、比を保って縮める', async () => {
    // flex の容器の実際の幅 (100pt・60pt など) は、読み込みのときの見積もり (本文の幅 200pt) より狭い。項目は既定の max-width で止まっていて、
    // flex は縮めていない (隣が無い) ので、既定のスタイルの max-width が縮めたもの
    const img = (s: string) => `<div style="display:flex"><img src="a.png" width="600" height="400" style="${s}"></div>`;
    for (const s of ['min-width:0', 'overflow:hidden', 'flex:1 1 100pt;min-width:0']) {
      expect(await sizes(`<div style="display:grid;grid-template-columns:1fr 1fr"><div>${img(s)}</div><div>x</div></div>`), `grid 1fr 1fr / ${s}`).toEqual(['100x66.67']);
      expect(await sizes(`<div style="display:grid;grid-template-columns:40% 1fr"><div>${img(s)}</div><div>x</div></div>`), `grid 40% / ${s}`).toEqual(['80x53.33']);
      expect(await sizes(`<div style="columns:2;column-gap:0">${img(s)}</div>`), `columns:2 / ${s}`).toEqual(['100x66.67']);
      expect(await sizes(`<div style="columns:3;column-gap:10pt">${img(s)}</div>`), `columns:3 / ${s}`).toEqual(['60x40']);
      expect(await sizes(`<div style="display:flex"><div style="flex:0 0 100pt">${img(s)}</div><div>x</div></div>`), `flex の項目 / ${s}`).toEqual(['100x66.67']);
      const [td] = await sizes(`<table style="border-spacing:0"><tr><td style="padding:0">${img(s)}</td><td>xxxxxxxx yyyy zzzz wwww</td></tr></table>`);
      const [w, h] = td.split('x').map(Number);
      expect(w, `表のセル / ${s}`).toBeLessThan(200);
      expect(Math.abs(h - (w * 400) / 600), `表のセル / ${s}: ${td}`).toBeLessThan(0.02);
    }
    // 同じ置き場で、隣があって flex が既定の上限より狭く縮めたときは、属性の高さのまま (項目 100pt のうち、隣が 75pt)
    const sib = '<div style="flex:0 0 75pt">x</div>';
    expect(await sizes(`<div style="display:grid;grid-template-columns:1fr 1fr"><div><div style="display:flex"><img src="a.png" width="600" height="400" style="min-width:0">${sib}</div></div><div>x</div></div>`)).toEqual(['25x300']);
  });
  it('縮めるときは、比を保つ (0.3.0 と同じ大きさ)', async () => {
    expect(await sizes('<p><img src="a.png" width="600" height="400"></p>')).toEqual(['200x133.33']);
    expect(await sizes('<p><img src="a.png" width="150%" height="100"></p>')).toEqual(['200x50']);
  });
});

describe('作成者の論理の名前の大きさは、作成者の指定', () => {
  it('max-inline-size: 100% は max-width: 100% と同じ (高さは属性のまま)', async () => {
    const I = '<p><img src="a.png" width="600" height="400"></p>';
    expect(await sizes(I, 'img { max-width: 100% }')).toEqual(['200x300']);
    expect(await sizes(I, 'img { max-inline-size: 100% }')).toEqual(['200x300']);
    expect(await sizes(I, 'img { inline-size: 50% }')).toEqual(['100x300']);
  });
});

describe('grid の項目そのものの、幅の属性のある画像', () => {
  it('百分率の max-width の画像は、列の下限を広げず、はみ出さない', async () => {
    for (const a of ['width="600" height="400"', 'width="600"']) {
      const [s] = await sizes(`<div style="display:grid;grid-template-columns:auto 1fr"><img src="a.png" ${a}><div>y</div></div>`);
      expect(Number(s.split('x')[0]), a).toBeLessThanOrEqual(200);
    }
    const [s] = await sizes('<div style="display:grid;grid-template-columns:auto 1fr"><img src="a.png" width="600" height="400"><div>y</div></div>', 'img { max-width: 100%; height: auto }', 200, 'browser');
    expect(Number(s.split('x')[0])).toBeLessThanOrEqual(200);
  });
  it('max-width の無い画像 (browser) は、属性の幅が下限 (はみ出す。ブラウザと同じ)', async () => {
    expect(await sizes('<div style="display:grid;grid-template-columns:auto 1fr"><img src="a.png" width="600" height="400"><div>y</div></div>', '', 200, 'browser')).toEqual(['450x300']);
  });
});

describe('flex: 1 の画像の余白・枠', () => {
  it('margin・padding・border は、画像の中身の幅を広げない (中身は本来の 225×150)', async () => {
    const T = '<p>Some description text alongside the picture that wraps.</p>';
    for (const s of ['flex:1', 'flex:1;margin:10px', 'flex:1;padding:10px', 'flex:1;border:10px solid red', 'flex:1;margin:0 20px', 'flex:1;margin:0 -20px;padding:0 20px', 'flex:1;margin:0 -10px;padding:0 20px', 'flex:1;margin:0 -20px 0 20px', 'flex:1;box-sizing:border-box;padding:10px', 'flex:0 1 auto;padding:10px'])
      expect(await sizes(`<div style="display:flex;gap:10px"><img src="m.png" style="${s}">${T}</div>`, '', 360), s).toEqual(['225x150']);
  });
});
