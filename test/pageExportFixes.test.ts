/**
 * ページの SVG・PNG の書き出し (renderPageToSvg・renderPageToPng) の直しのテスト。
 *  - SVG の行列・倍率を有効数字で書く (小数 3 桁に丸めると、小さい倍率が大きくずれる)
 *  - 書体の SVG の表の字を、Node でも (DOMParser が無くても)、SVG・PNG で色つきに描く (先に toPdf を呼ばなくても同じ絵)
 *  - PNG の画素化で、入れ子の不透明度のグループの板が同時に持つ画素の数に上限があり、超えるものは板を作る前に止める
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import fontkit from '@pdf-lib/fontkit';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { svgTable, withTables } from './colorFontBuilder';
import { defaultFontBuffer, ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const decode = (b: Uint8Array) => PNG.sync.read(Buffer.from(b));
const px = (p: PNG, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
const near = (a: number[], b: number[], tol = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('SVG の書き出しの倍率', () => {
  it('viewBox の大きい SVG を小さく置く倍率を、小数 3 桁に丸めずに書く (0.0075 が 0.008 にならない)', async () => {
    const big = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" width="100" height="100"><rect width="10000" height="10000" fill="#ff0000"/></svg>';
    const r = await typeset('<p><img src="b.svg" style="width: 100px; height: 100px"></p>', { kind: 'html', loadFont, files: [{ name: 'b.svg', data: big }] });
    const svg = await r.renderPageToSvg(0);
    // 100px = 75pt を 10000 で割った倍率
    const m = /<g transform="matrix\(([^ ]+) 0 0 ([^ ]+) /.exec(svg);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(0.0075);
    expect(Number(m![2])).toBe(0.0075);
  });
});

describe('SVG の書き出しの字形', () => {
  it('字形の輪郭は defs に 1 度だけ書き、置く所は use で参照する (同じ字を何度置いても、輪郭は増えない)', async () => {
    const one = await (await typeset('<p>永</p>', { kind: 'html', loadFont })).renderPageToSvg(0);
    const many = await (await typeset(`<p>${'永'.repeat(400)}</p>`, { kind: 'html', loadFont })).renderPageToSvg(0);
    const paths = (s: string) => s.match(/<path id="[^"]+" d="/g)?.length ?? 0;
    expect(paths(many)).toBe(paths(one));
    expect(many.match(/<use /g)!.length).toBeGreaterThanOrEqual(400);
    // 400 字の分は、use の分だけ (1 字あたり 120 バイトまで。前は 1 字ごとに輪郭を書き、この字で 1 字 1KB ほどだった)
    expect(many.length - one.length).toBeLessThan(400 * 120);
  });
});

describe('PNG の画素化の、描く範囲の外の線', () => {
  it('描く範囲 (SVG の画像の枠) の外の細かい破線は、輪郭を作らずに飛ばす', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `<line x1="0" y1="${-200 - i}" x2="400" y2="${-200 - i}" stroke="#000" stroke-width="2" stroke-dasharray="0.01"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">${lines}<rect width="40" height="40" fill="#ff0000"/></svg>`;
    const r = await typeset('<style>@page { size: 300pt 75pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="o.svg" style="width: 400px; height: 100px">', { kind: 'html', loadFont, files: [{ name: 'o.svg', data: svg }] });
    const t = cpuClock();
    const out = decode(await r.renderPageToPng(0, { dpi: 96 }));
    // 前は、200 本の輪郭 (1 本 8 万のかけら) を作って 5 秒ほどかかっていた (CHANGELOG の数)
    expect(cpuClock() - t).toBeLessThan(scaled(3000));
    expect(px(out, 20, 20)).toSatisfy((c: number[]) => near(c, [255, 0, 0]));
  });
});

describe('SVG の g の mask', () => {
  it('マスクは子を重ねた絵に掛ける (重なった子の下の色が透けない)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><defs><mask id="m"><rect width="100" height="40" fill="#808080"/></mask></defs>' +
      '<g mask="url(#m)"><rect x="0" width="60" height="40" fill="#ff0000"/><rect x="40" width="60" height="40" fill="#0000ff"/></g></svg>';
    const r = await typeset('<style>@page { size: 75pt 30pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="m.svg" style="width: 100px; height: 40px">', { kind: 'html', loadFont, files: [{ name: 'm.svg', data: svg }] });
    const out = decode(await r.renderPageToPng(0, { dpi: 96 }));
    // 重なった所 (x = 50) は、青を半分の濃さで白に重ねた色。前は、半分の赤の上に半分の青を重ね、紫に濁っていた
    expect(px(out, 50, 20)).toSatisfy((c: number[]) => near(c, [127, 127, 255], 3));
    expect(px(out, 20, 20)).toSatisfy((c: number[]) => near(c, [255, 127, 127], 3));
    // PDF も、子をまとめた 1 つのグループにマスクを掛ける (ソフトマスクの付いた透明のグループ)
    const ex = await r.renderPageToSvg(0);
    expect(ex.match(/mask="url\(#/g)).toHaveLength(1);
  });
});

describe('filter の近似の中の、mask と clip-path の付いたグループ', () => {
  // feDropShadow (図形で近似する filter) の中の、mask (上半分だけ白) と clip-path の付いたグループ (子が 2 つ)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs>' +
    '<filter id="f"><feDropShadow dx="1" dy="1" stdDeviation="0" flood-color="#000" flood-opacity="0.2"/></filter>' +
    '<mask id="m"><rect width="100" height="50" fill="#fff"/></mask><clipPath id="c"><rect width="90" height="100"/></clipPath></defs>' +
    '<g filter="url(#f)"><g mask="url(#m)" clip-path="url(#c)"><rect width="100" height="100" fill="#ff0000"/><rect x="50" width="50" height="100" fill="#00ff00"/></g></g></svg>';
  const doc = () => typeset('<style>@page { size: 75pt 75pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="f.svg" style="width: 100px; height: 100px">', { kind: 'html', loadFont, files: [{ name: 'f.svg', data: svg }] });
  it('PNG: マスクと切り抜きは、グループを開いて描くときも子に掛かる (下半分と右の端は描かない)', async () => {
    const out = decode(await (await doc()).renderPageToPng(0, { dpi: 96 }));
    expect(px(out, 25, 25)).toSatisfy((c: number[]) => near(c, [255, 0, 0]));
    expect(px(out, 70, 25)).toSatisfy((c: number[]) => near(c, [0, 255, 0]));
    // 下半分 (マスクで隠れる) と、右の端 (切り抜きの外) は白
    expect(px(out, 25, 75)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 2));
    expect(px(out, 95, 25)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 2));
  });
});

describe('filter の近似の影と、マスクの付いたグループ', () => {
  const page = (svg: string) =>
    typeset('<style>@page { size: 225pt 225pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="d.svg" style="width: 300px; height: 300px">', { kind: 'html', loadFont, files: [{ name: 'd.svg', data: svg }] });
  it('マスクの付いたグループに、ぼかしのある影を付けても、マスクを子ごと・層ごとに描き直さない (手間の上限に当たらない)', async () => {
    const rects = Array.from({ length: 150 }, (_, i) => `<rect x="${(i % 15) * 20}" y="${Math.floor(i / 15) * 20}" width="8" height="8" fill="#0000ff"/>`).join('');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><filter id="f"><feDropShadow dx="2" dy="2" stdDeviation="2"/></filter>' +
      `<mask id="m"><rect width="300" height="300" fill="#fff"/></mask></defs><g filter="url(#f)"><g mask="url(#m)">${rects}</g></g></svg>`;
    const r = await page(svg);
    const t = performance.now();
    const out = decode(await r.renderPageToPng(0, { dpi: 96 }));
    expect(performance.now() - t).toBeLessThan(10000);
    // 前は、マスクの板を 150 × 6 回描き直して手間の上限に当たり、SVG ごと仮の枠で描いていた
    expect(r.diagnostics.filter((d) => d.code === 'png/raster-budget')).toEqual([]);
    expect(px(out, 4, 4)).toSatisfy((c: number[]) => near(c, [0, 0, 255], 8));
  });
  it('影の写しは、子孫のマスクと一緒にずれる (元の位置のマスクで切らない)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="30" dy="0" stdDeviation="0" flood-color="#000" flood-opacity="0.5"/></filter>' +
      '<mask id="m"><rect width="150" height="300" fill="#fff"/></mask></defs><g filter="url(#f)"><g mask="url(#m)"><rect width="300" height="300" fill="#ff0000"/><rect width="10" height="10" fill="#00ff00"/></g></g></svg>';
    const out = decode(await (await page(svg)).renderPageToPng(0, { dpi: 96 }));
    // 元の図形 (赤) はマスクの中 (x < 150)。影はマスクごと 30 ずれて、x = 150〜180 に見える (前は元の位置のマスクで切れて白)
    expect(px(out, 100, 150)).toSatisfy((c: number[]) => near(c, [255, 0, 0], 4));
    expect(px(out, 165, 150)).toSatisfy((c: number[]) => near(c, [128, 128, 128], 6));
    expect(px(out, 200, 150)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 2));
  });
});

describe('filter の近似で残したグループの、重なりの順と不透明度の変換', () => {
  const page = (svg: string) =>
    typeset('<style>@page { size: 150pt 75pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="o.svg" style="width: 200px; height: 100px">', { kind: 'html', loadFont, files: [{ name: 'o.svg', data: svg }] });
  it('マスクの付いたグループの写しは、元の並びの位置に入る (後に書いた橙が、先に書いた青の上)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><filter id="f" x="0" y="0" width="200" height="100" filterUnits="userSpaceOnUse"><feOffset dx="30" dy="0"/></filter>' +
      '<mask id="m"><rect width="200" height="100" fill="#fff"/></mask></defs><g filter="url(#f)">' +
      '<rect x="0" width="100" height="100" fill="#0000ff"/><g mask="url(#m)"><rect x="50" width="70" height="100" fill="#ff8000"/><rect x="0" y="90" width="5" height="5" fill="#ff0000"/></g><rect x="160" width="5" height="100" fill="#00ff00"/></g></svg>';
    const out = decode(await (await page(svg)).renderPageToPng(0, { dpi: 96 }));
    // 写しは 30 ずれる: 青は 30〜130、橙は 80〜150。重なった所 (x = 110) は橙 (前は、グループの写しを先に入れて、青が上に出ていた)
    expect(px(out, 110, 50)).toSatisfy((c: number[]) => near(c, [255, 128, 0], 6));
    expect(px(out, 50, 50)).toSatisfy((c: number[]) => near(c, [0, 0, 255], 6));
    expect(px(out, 192, 50)).toSatisfy((c: number[]) => near(c, [0, 255, 0], 6));
  });
  it('不透明度を変える色の変換 (feFuncA の a × 0.5 + 0.5) は、マスクの付いたグループの不透明度にも掛かる', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><filter id="f"><feComponentTransfer><feFuncA type="linear" slope="0.5" intercept="0.5"/></feComponentTransfer></filter>' +
      '<mask id="m"><rect width="200" height="100" fill="#fff"/></mask></defs><g filter="url(#f)"><g mask="url(#m)" opacity="0.5"><rect width="100" height="100" fill="#0000ff"/><rect x="100" width="100" height="100" fill="#0000ff"/></g></g></svg>';
    const out = decode(await (await page(svg)).renderPageToPng(0, { dpi: 96 }));
    // 不透明度 0.5 → 0.75 (前は、残したグループの 0.5 のままだった)
    const w = Math.round(255 * 0.25);
    expect(px(out, 50, 50)).toSatisfy((c: number[]) => near(c, [w, w, 255], 6));
  });
});

describe('測るだけの組版での画像の警告', () => {
  it('break-inside: avoid の図を測るためにもう 1 度組んでも、画像の一部を描けない警告 (image/partial) を 2 度数えない', async () => {
    const dir = path.join(__dirname, '..', 'examples', 'drawio-pages');
    const r = await typeset(fs.readFileSync(path.join(dir, 'pages.html'), 'utf8'), { kind: 'html', loadFont, files: [{ name: 'diagrams.drawio', data: fs.readFileSync(path.join(dir, 'diagrams.drawio'), 'utf8') }] });
    const partial = r.diagnostics.filter((d) => d.code === 'image/partial');
    expect(partial).toHaveLength(1);
    expect(partial[0].count ?? 1).toBe(1);
  });
  it('測るだけの組版では、描けない画像の警告 (image/unsupported) も 2 度数えない', async () => {
    const r = await typeset('<figure style="break-inside: avoid; margin: 0"><img src="bad.png" style="width: 10pt; height: 10pt"><figcaption>c</figcaption></figure>', {
      kind: 'html',
      loadFont,
      files: [{ name: 'bad.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 1, 0, 0]) }],
    });
    for (const code of ['image/unsupported', 'image/partial', 'image/not-found'] as const) for (const d of r.diagnostics.filter((x) => x.code === code)) expect(d.count ?? 1).toBe(1);
  });
});

describe('拡大しない線・大きさ (vector-effect)', () => {
  // viewBox 100 を 200px に置く (SVG の 1 単位 = 2px = 1.5pt)
  const ve =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">' +
    '<line x1="0" y1="10" x2="100" y2="10" stroke="#000" stroke-width="4" stroke-dasharray="8 4" vector-effect="non-scaling-stroke"/>' +
    '<rect x="50" y="50" width="10" height="10" fill="#ff0000" vector-effect="non-scaling-size"/></svg>';
  const doc = () => typeset('<style>@page { size: 200pt 200pt; margin: 0 } body { margin: 0 } img { display: block }</style><img src="v.svg" style="width: 200px; height: 200px">', { kind: 'html', loadFont, files: [{ name: 'v.svg', data: ve }] });
  it('SVG の書き出しは、PDF と同じく、線の太さ・破線をページの上の CSS px の長さにする (SVG の根の座標で 0.5 倍)', async () => {
    const svg = await (await doc()).renderPageToSvg(0);
    expect(svg).not.toContain('vector-effect');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-dasharray="4 2"');
    // 拡大しない大きさの矩形は、要素の原点 (0, 0) の周りに 0.5 倍 (位置も大きさも、ページの上の CSS px: 50px の所に 10px)
    expect(svg).toMatch(/<path d="M25 25L30 25L30 30L25 30Z" fill="#ff0000"/);
  });
  it('PNG の書き出しも、拡大しない大きさの図形を、ページの上の大きさ (10px) で描く', async () => {
    const out = decode(await (await doc()).renderPageToPng(0, { dpi: 96 }));
    // 矩形は (50, 50) 画素から 10 画素 (96dpi で 1px = 1 画素。PDF と同じ置き方)。直す前は、拡大して (100, 100) から 20 画素に描いていた
    expect(px(out, 55, 55)).toSatisfy((c: number[]) => near(c, [255, 0, 0]));
    expect(px(out, 65, 65)).toSatisfy((c: number[]) => near(c, [255, 255, 255]));
    expect(px(out, 105, 105)).toSatisfy((c: number[]) => near(c, [255, 255, 255]));
  });
});

describe('SVG の書き出しの、SVG の画像の中の座標の桁', () => {
  it('1 単位の小さい SVG (viewBox 0.01) の座標と線の太さを、0 に丸めない', async () => {
    const small = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.01 0.01" width="100" height="100"><line x1="0.001" y1="0.005" x2="0.009" y2="0.005" stroke="#000" stroke-width="0.0002"/></svg>';
    const svg = await (await typeset('<p><img src="s.svg" style="width: 100px; height: 100px"></p>', { kind: 'html', loadFont, files: [{ name: 's.svg', data: small }] })).renderPageToSvg(0);
    expect(svg).toContain('d="M0.001 0.005L0.009 0.005"');
    expect(svg).toContain('stroke-width="0.0002"');
  });
  it('同じ SVG を違う大きさで置くと、大きさごとに、その大きさの桁で書く (1 度目の桁を使い回さない)', async () => {
    const small = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.01 0.01" width="10" height="10"><defs><clipPath id="c"><rect x="0.0012" y="0.0012" width="0.0076" height="0.0076"/></clipPath></defs><rect width="0.01" height="0.01" fill="#00f" clip-path="url(#c)"/></svg>';
    const svg = await (await typeset('<p><img src="s.svg" style="width: 1px; height: 1px"><img src="s.svg" style="width: 200px; height: 200px"></p>', { kind: 'html', loadFont, files: [{ name: 's.svg', data: small }] })).renderPageToSvg(0);
    // 小さく置いた方 (1 単位 75pt) は 0.0012 を小数 5 桁で、大きく置いた方 (1 単位 15,000pt) は 8 桁で書く。どちらも 0.0012 のまま
    const clips = [...svg.matchAll(/<clipPath id="[^"]+"><path d="M([^ ]+) /g)].map((m) => m[1]);
    expect(clips.filter((x) => x === '0.0012').length).toBeGreaterThanOrEqual(2);
  });
  it('1 単位の大きい SVG (viewBox 20 億) のマスクの範囲は、根の座標の全体を覆う', async () => {
    const big =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000000000 2000000000" width="100" height="100"><defs><mask id="m"><rect width="2000000000" height="1000000000" fill="#fff"/></mask></defs>' +
      '<rect width="2000000000" height="2000000000" fill="#0000ff" mask="url(#m)"/></svg>';
    const svg = await (await typeset('<p><img src="b.svg" style="width: 100px; height: 100px"></p>', { kind: 'html', loadFont, files: [{ name: 'b.svg', data: big }] })).renderPageToSvg(0);
    const m = /<mask [^>]*x="([^"]+)"[^>]*width="([^"]+)"/.exec(svg)!;
    expect(Number(m[1])).toBeLessThan(-2e9);
    expect(Number(m[2])).toBeGreaterThan(4e9);
  });
});

describe('書体の SVG の表の字 (Node。DOMParser が無い)', () => {
  const colorHtml = async () => {
    const tinos = await defaultFontBuffer('Tinos-Regular.ttf');
    const fk = fontkit.create(new Uint8Array(tinos)) as unknown as { glyphForCodePoint(cp: number): { id: number } };
    const gA = fk.glyphForCodePoint(65).id;
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" id="glyph${gA}"><rect x="100" y="-700" width="800" height="700" fill="#00c000"/></svg>`;
    const font = withTables(tinos, { 'SVG ': svgTable([{ start: gA, end: gA, doc }]) });
    return typeset('<style>@font-face { font-family: SvgColor; src: url(s.ttf) } @page { size: 100pt 60pt; margin: 0 } body { margin: 0 }</style><p style="font-family: SvgColor; font-size: 40pt; color: #333; margin: 0">A</p>', {
      kind: 'html',
      loadFont,
      files: [{ name: 's.ttf', data: new Uint8Array(font) }],
    });
  };
  it('前提: この試験の環境には DOMParser が無い', () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined');
  });
  it('SVG の書き出しで、toPdf を呼ぶ前でも色つきに描く', async () => {
    const r = await colorHtml();
    const svg = await r.renderPageToSvg(0);
    expect(svg).toContain('#00c000');
  });
  it('PNG の書き出しで、toPdf を呼ぶ前でも色つきに描く', async () => {
    const r = await colorHtml();
    const out = decode(await r.renderPageToPng(0, { dpi: 72 }));
    // 字の箱の中ほど (基線の少し上) が緑
    let green = 0;
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) if (near(px(out, x, y), [0, 0xc0, 0], 8)) green++;
    expect(green).toBeGreaterThan(100);
  });
});

describe('PNG の画素化の板の上限', () => {
  it('入れ子の不透明度のグループ (60 段。段ごとにページ全体の背景) は、上限を超える所から板を作らずに描き、警告を出す (板を確保する前に止める)', async () => {
    const depth = 60;
    // 300 × 225pt を 288dpi で 1200 × 900 画素 (108 万画素)。上限は 1,600 万画素 (下駄) なので、ページ全体に広がる板は 14 段ほどまで
    const html =
      '<style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } div { opacity: 0.99; background: #ffffff; height: 225pt } .red { background: #ff0000; width: 20pt; height: 20pt; margin: 0; opacity: 1 }</style>' +
      '<div>'.repeat(depth) +
      '<p class="red"></p>' +
      '</div>'.repeat(depth);
    const r = await typeset(html, { kind: 'html', loadFont });
    // ページの大きさの板 (1 画素 4 つの数) を作った数を数える
    const page = 1200 * 900 * 4;
    const Orig = globalThis.Float32Array;
    let layers = 0;
    globalThis.Float32Array = new Proxy(Orig, {
      construct(t, args) {
        if (typeof args[0] === 'number' && args[0] >= page * 0.9 && args[0] <= page * 1.1) layers++;
        return Reflect.construct(t, args);
      },
    });
    let out: PNG;
    try {
      out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    } finally {
      globalThis.Float32Array = Orig;
    }
    // 直す前は 60 段の全部の板を同時に持った (この大きさのページでは、150dpi の A4 で 2GB ほどになる入れ子)。ページそのものと、上限までの 14 段ほど
    expect(layers).toBeGreaterThan(5);
    expect(layers).toBeLessThanOrEqual(1 + 16);
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toHaveLength(1);
    // 赤の箱は最後に描くので、板を作らずに不透明度を掛けても同じ色 (白の上の、0.99 の 60 乗 ≒ 0.547 の赤)
    const a = 0.99 ** depth;
    const w = Math.round(255 * (1 - a));
    expect(px(out, 40, 40)).toSatisfy((c: number[]) => near(c, [255, w, w], 3));
    expect(px(out, 600, 600)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 2));
  });

  it('入れ子の不透明度のグループ (60 段) の中の小さな箱は、実際に広げた板の大きさで数えるので、上限に当たらない', async () => {
    const depth = 60;
    const html =
      '<style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } div { opacity: 0.99 } .red { background: #ff0000; width: 20pt; height: 20pt; margin: 0; opacity: 1 }</style>' +
      '<div>'.repeat(depth) +
      '<p class="red"></p>' +
      '</div>'.repeat(depth);
    const r = await typeset(html, { kind: 'html', loadFont });
    const out = decode(await r.renderPageToPng(0, { dpi: 288 }));
    // 前は、板を作るときの描ける範囲 (ページ全体) で数え、14 段ほどで上限に当たって警告を出していた
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toEqual([]);
    const w = Math.round(255 * (1 - 0.99 ** depth));
    expect(px(out, 40, 40)).toSatisfy((c: number[]) => near(c, [255, w, w], 3));
  });

  it('小さなページ・低い解像度でも、不透明度の入れ子 8 段の中のマスクは描く (上限には 1,600 万画素の下駄がある)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><defs><mask id="m"><rect width="40" height="20" fill="#fff"/></mask></defs><rect width="40" height="40" fill="#0000ff" mask="url(#m)"/></svg>';
    const html = '<style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } div { opacity: 0.95; width: 80px }</style>' + '<div>'.repeat(8) + '<img src="m.svg" style="display: block; width: 40px; height: 40px">' + '</div>'.repeat(8);
    const r = await typeset(html, { kind: 'html', loadFont, files: [{ name: 'm.svg', data: svg }] });
    const out = decode(await r.renderPageToPng(0, { dpi: 72 }));
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toEqual([]);
    // 上半分は青 (0.95 の 8 乗の濃さ)、下半分はマスクで隠れて白
    const b = Math.round(255 * (1 - 0.95 ** 8));
    expect(px(out, 15, 7)).toSatisfy((c: number[]) => near(c, [b, b, 255], 4));
    expect(px(out, 15, 25)).toSatisfy((c: number[]) => near(c, [255, 255, 255], 2));
  });

  it('浅い入れ子 (3 段) は、上限に当たらずに板に描く', async () => {
    const html = '<style>@page { size: 300pt 225pt; margin: 0 } body { margin: 0 } div { opacity: 0.5 }</style><div><div><div><p style="background: #0000ff; height: 50pt; margin: 0"></p></div></div></div>';
    const r = await typeset(html, { kind: 'html', loadFont });
    const out = decode(await r.renderPageToPng(0, { dpi: 72 }));
    expect(r.diagnostics.filter((d) => d.code === 'png/layer-limit')).toEqual([]);
    const w = Math.round(255 * (1 - 0.125));
    expect(px(out, 150, 25)).toSatisfy((c: number[]) => near(c, [w, w, 255], 3));
  });
});

describe('PNG の画素化の入れ子の切り抜きの上限', () => {
  /** 全面の div を depth 段入れ子にし (overflow: hidden)、中に赤の箱を置いて、dpi 400 で PNG に描く。ページの大きさの配列を作った数を数える */
  async function nested(radius: string, depth = 60) {
    const html = `<style>@page { size: 288pt 216pt; margin: 0 } body { margin: 0 } div { overflow: hidden; border-radius: ${radius}; height: 216pt } p { background: #ff0000; height: 100pt; margin: 0 }</style>` + '<div>'.repeat(depth) + '<p></p>' + '</div>'.repeat(depth);
    const r = await typeset(html, { kind: 'html', loadFont });
    const page = 1600 * 1200;
    const Orig = globalThis.Float32Array;
    let big = 0;
    globalThis.Float32Array = new Proxy(Orig, {
      construct(t, args) {
        if (typeof args[0] === 'number' && args[0] >= page * 0.9 && args[0] <= page * 1.1) big++;
        return Reflect.construct(t, args);
      },
    });
    let out: PNG;
    try {
      out = decode(await r.renderPageToPng(0, { dpi: 400 }));
    } finally {
      globalThis.Float32Array = Orig;
    }
    return { r, out, big };
  }
  it('角の丸い切り抜き 60 段は、上限で切り抜きの重なりの配列を作るのを止め、警告を 1 度出す (中の箱は描く)', async () => {
    const { r, out, big } = await nested('1px');
    // ページの大きさの配列は、切り抜きの外のもの 1 つ・切り抜きの形の覆う割合 60 個 (使い捨て)・持つ重なりの配列
    // (上限 1,600 万の板の画素分 = 1 枚 48 万の 33 枚ほどまで)。直す前は、重なりの配列を 59 枚作り、全部を同時に持った
    expect(big).toBeLessThanOrEqual(1 + 60 + 34);
    expect(r.diagnostics.filter((d) => d.code === 'png/clip-limit')).toHaveLength(1);
    expect(px(out, 300, 200)).toSatisfy((c: number[]) => near(c, [255, 0, 0], 2));
  });
  it('角の丸くない (画素に揃った矩形の) 切り抜きは、重なりの配列を作らない (外側の配列を分け合う)', async () => {
    const { r, out, big } = await nested('0');
    // 切り抜きの外のもの 1 つと、切り抜きの形の覆う割合 60 個 (使い捨て) だけ
    expect(big).toBeLessThanOrEqual(1 + 60);
    expect(r.diagnostics.filter((d) => d.code === 'png/clip-limit')).toEqual([]);
    expect(px(out, 300, 200)).toSatisfy((c: number[]) => near(c, [255, 0, 0], 2));
  });
});

describe('PNG の、CSS の transform の中の SVG の拡大しない線', () => {
  it('transform: scale(3) の img の中の vector-effect: non-scaling-stroke の線は、PDF・SVG と同じく 2px (6px にしない)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><line x1="0" y1="10" x2="20" y2="10" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
    const widths: number[] = [];
    for (const tr of ['none', 'scale(3)']) {
      const r = await typeset(`<style>@page { size: 150pt 150pt; margin: 0 } body { margin: 0 } img { display: block; margin: 60px; transform: ${tr} }</style><img src="v.svg" style="width: 20px; height: 20px">`, { kind: 'html', loadFont, files: [{ name: 'v.svg', data: svg }] });
      const p = decode(await r.renderPageToPng(0, { dpi: 96 }));
      let n = 0;
      for (let y = 0; y < p.height; y++) if (p.data[(y * p.width + 70) * 4] < 128) n++;
      widths.push(n);
      // SVG の書き出しでも、ページの上で 2px (線の太さ × 外側の倍率)
      const out = String(await r.renderPageToSvg(0));
      const sw = Number(out.match(/stroke-width="([^"]+)"/)![1]);
      expect(sw * (tr === 'none' ? 1 : 3)).toBeCloseTo(2, 3);
    }
    expect(widths).toEqual([2, 2]);
  });
});

describe('SVG の書き出しの、とても大きな数', () => {
  it('1e308 の座標の SVG の画像でも、Infinity・NaN を書かず、32 ビットの浮動小数の範囲 (約 3.4e38) に抑える', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M0 0 L1e308 1e308" stroke="#000"/></svg>';
    const r = await typeset('<style>@page { size: 150pt 150pt; margin: 0 } body { margin: 0 }</style><img src="v.svg" style="width: 20px; height: 20px">', { kind: 'html', loadFont, files: [{ name: 'v.svg', data: svg }] });
    const out = String(await r.renderPageToSvg(0));
    expect(out).not.toMatch(/Infinity|NaN/);
    const nums = (out.match(/-?\d+(\.\d+)?(e[+-]?\d+)?/gi) ?? []).map(Number);
    expect(Math.max(...nums.map(Math.abs))).toBeLessThanOrEqual(3.402823e38);
  });
});
