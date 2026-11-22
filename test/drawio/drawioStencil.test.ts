/**
 * draw.io の図形ライブラリ (ステンシル) の読み取りと描画 (src/drawioStencil.ts)。
 * draw.io の図形ライブラリはリポジトリに入れないので、ここで書いた小さなライブラリで確かめる (形の命令は mxGraph の mxStencil の決まり)
 */
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetStore } from '../../src/assets';
import { DEFAULT_FONTS, createDrawioStencilRegistry, typeset, walkAreaTree, type DrawioStencilRegistry, type FontSpec } from 'kumiori';
import { drawioToSvg } from '../../src/drawio/drawio';
import { drawioFormat } from '../../src/drawio/index';
import { stencilFiles } from '../../src/drawio/nodeFiles';
import { StencilRegistry, drawioImageUrl, isDrawioImagePath, libraryFiles, libraryOf } from '../../src/drawio/drawioStencil';
import { parseXml, type XEl } from '../../src/drawio/drawioXml';
import os from 'node:os';
import { parseSvg } from '../../src/svg';
import { encodePngStored } from '../../src/pixels';
import { ensureFonts, fontDir } from '../helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const enc = (s: string) => new TextEncoder().encode(s);

/** 試しのライブラリ (自作)。形の名前の空白は _ に、大文字は小文字にして引く */
const LIBRARY = `<shapes name="mxgraph.test">
  <shape name="Box Arrow" w="100" h="50" aspect="variable" strokewidth="inherit">
    <background><path><move x="0" y="0"/><line x="100" y="0"/><line x="100" y="50"/><close/></path></background>
    <foreground><fillstroke/><strokecolor color="#ff0000"/><ellipse x="40" y="20" w="20" h="10"/><stroke/></foreground>
  </shape>
  <shape name="fixed" w="10" h="10" aspect="fixed">
    <background><rect x="0" y="0" w="10" h="10"/></background>
    <foreground><fillstroke/><fillcolor color="accentColor" default="#0000ff"/><include-shape name="mxgraph.test.box_arrow" x="0" y="0" w="10" h="5"/></foreground>
  </shape>
</shapes>`;

/**
 * draw.io の配布物 (stencils.min.js) の 2 進の形に書く (decode の逆。5 つの流れ: 命令・x・y・そのほかの数・文字。
 * 数は 1000 倍の整数の差分を、ジグザグの可変長整数で)
 */
function encodeBinary(root: XEl): string {
  const ops: number[] = [];
  const streams: number[][] = [[], [], []];
  const strs: string[] = [];
  const names: string[] = [];
  const attrNames: string[] = [];
  const draw = new Set(['move', 'line', 'quad', 'curve', 'arc', 'rect', 'roundrect', 'ellipse', 'text', 'image', 'include-shape']);
  let px = 0;
  let py = 0;
  let pn = new Map<string, number>();
  const varint = (out: number[], v: number) => {
    let n = v >= 0 ? 2 * v : -2 * v - 1;
    do {
      const c = n % 128;
      n = Math.floor(n / 128);
      out.push(n ? c | 128 : c);
    } while (n);
  };
  const visit = (el: XEl) => {
    let id = names.indexOf(el.name);
    if (id < 0) {
      id = names.push(el.name) - 1;
      strs.push(el.name);
    }
    const leaf = el.children.length === 0;
    ops.push((id << 1) | (leaf ? 1 : 0), el.attrs.size);
    if (el.name === 'shape') {
      px = py = 0;
      pn = new Map();
    }
    for (const [k, v] of el.attrs) {
      let a = attrNames.indexOf(k);
      if (a < 0) {
        a = attrNames.push(k) - 1;
        strs.push(k);
      }
      ops.push(a);
      if (!/^-?\d+(\.\d+)?$/.test(v)) {
        ops.push(0);
        strs.push(v);
        continue;
      }
      ops.push(1);
      const n = Math.round(Number(v) * 1000);
      const coords = draw.has(el.name);
      if (coords && /^x\d?$/.test(k)) varint(streams[0], n - px), (px = n);
      else if (coords && /^y\d?$/.test(k)) varint(streams[1], n - py), (py = n);
      else {
        const key = `${el.name} ${k}`;
        varint(streams[2], n - (pn.get(key) ?? 0));
        pn.set(key, n);
      }
    }
    if (!leaf) {
      el.children.forEach(visit);
      ops.push(255);
    }
  };
  visit(root);
  const parts = [Uint8Array.from(ops), ...streams.map((x) => Uint8Array.from(x)), enc(strs.join('\0'))];
  const head = new Uint8Array(20);
  const v = new DataView(head.buffer);
  parts.forEach((p, k) => v.setUint32(4 * k, p.length));
  return Buffer.from(deflateRawSync(Buffer.concat([head, ...parts]))).toString('base64');
}

const model = (cells: string) => `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const cell = (id: string, style: string, x: number, y: number, w: number, h: number, value = '') =>
  `<mxCell id="${id}" value="${value}" style="${style.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const pathDs = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe('draw.io の図形ライブラリ (ステンシル)', () => {
  it('形の名前から、ライブラリの名前と読むファイル (draw.io の getBasenameForStencil・libraries の表)', () => {
    expect(libraryOf('mxgraph.aws4.lambda_function')).toBe('aws4');
    expect(libraryOf('mxgraph.electrical.abstract.x')).toBe('electrical/abstract');
    expect(libraryOf('rect')).toBeUndefined();
    expect(libraryFiles('flowchart')).toEqual(['flowchart.xml']);
    expect(libraryFiles('aws4b')).toEqual(['aws4.xml']);
    expect(libraryFiles('c4')).toEqual([]);
  });

  it('ライブラリの XML の形を、セルの枠に写して描く (variable は縦横を別の倍率に。背景の経路を前景で塗る)', () => {
    const reg = new StencilRegistry();
    expect(reg.add(LIBRARY)).toBe(2);
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.test.Box_Arrow;fillColor=#00ff00;strokeWidth=2;', 0, 0, 200, 100))), { stencils: reg })!;
    expect(r.warnings).toEqual([]);
    expect(r.missingLibraries).toEqual([]);
    expect(r.svg).toContain('<path d="M0 0L200 0L200 100Z" fill="#00ff00" stroke="#000000" stroke-width="2" stroke-miterlimit="10"/>');
    // 前景の楕円は、線の色を変えて線だけ (strokewidth="inherit" はセルの線の太さ)
    expect(r.svg).toContain('<path d="M80 50A20 10 0 1 1 120 50A20 10 0 1 1 80 50Z" fill="none" stroke="#ff0000" stroke-width="2"');
  });

  it('aspect="fixed" は縦横同じ倍率で真ん中に置く。線の太さは倍率を掛ける。include-shape・スタイルのキーの色', () => {
    const reg = new StencilRegistry();
    reg.add(LIBRARY);
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.test.fixed;accentColor=#123456;', 0, 0, 200, 100))), { stencils: reg })!;
    const d = pathDs(r.svg);
    expect(d[0]).toBe('M50 0H150V100H50Z');
    expect(r.svg).toContain('stroke-width="10"');
    // include-shape の形は (50, 0) から 100 × 50 の枠に。塗りはスタイルの accentColor
    expect(d[1]).toBe('M50 0L150 0L150 50Z');
    expect(r.svg).toContain('<path d="M50 0L150 0L150 50Z" fill="#123456"');
  });

  it('図形ライブラリの形の labelBounds: 形の座標の文字の枠を、形の写し方で枠に写す (if のキーが 1 のときだけ)', () => {
    const reg = new StencilRegistry();
    reg.add('<shapes name="mxgraph.lb"><shape name="a" w="100" h="100"><labelBounds x="10" y="0" w="80" h="50"/><labelBounds if="other" x="0" y="0" w="10" h="10"/><background><rect x="0" y="0" w="100" h="100"/></background><foreground><fillstroke/></foreground></shape></shapes>');
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.lb.a;fontSize=10;', 0, 0, 200, 100, '字'))), { stencils: reg })!;
    // 枠 (20, 0)〜(180, 50): 文字の真ん中は (100, 25)。基線は 25 + 3.5
    expect(r.svg).toMatch(/<text x="100" y="28\.5"/);
  });

  it('lineShape=1 の形は、塗りを線の色にする (draw.io の Editor.js)', () => {
    const reg = new StencilRegistry();
    reg.add(LIBRARY);
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.test.box_arrow;lineShape=1;fillColor=#00ff00;strokeColor=#0000ff;', 0, 0, 200, 100))), { stencils: reg })!;
    expect(r.svg).toContain('<path d="M0 0L200 0L200 100Z" fill="#0000ff" stroke="#0000ff"');
  });

  it('draw.io の配布物 (stencils.min.js) の 2 進の形を戻して、XML のライブラリと同じに描く', () => {
    const xml = new StencilRegistry();
    xml.add(LIBRARY);
    const bundle = new StencilRegistry();
    expect(bundle.add(`var f = Object.create(null);\nf['other.xml'] = 'AAAA';\nf['test.xml'] = '${encodeBinary(parseXml(LIBRARY)!)}';\n`)).toBe(2);
    expect(bundle.hasLibrary('test')).toBe(true);
    const doc = enc(model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 200, 100) + cell('b', 'shape=mxgraph.test.fixed;', 0, 200, 50, 50)));
    expect(drawioToSvg(doc, { stencils: bundle })!.svg).toBe(drawioToSvg(doc, { stencils: xml })!.svg);
  });

  it('style に埋め込んだ形 stencil(…) (encodeURIComponent → deflate → base64) を描く', () => {
    const shape = '<shape w="10" h="10"><background><rect x="0" y="0" w="10" h="10"/></background><foreground><fillstroke/></foreground></shape>';
    const packed = Buffer.from(deflateRawSync(Buffer.from(encodeURIComponent(shape)))).toString('base64');
    const r = drawioToSvg(enc(model(cell('a', `shape=stencil(${packed});fillColor=#ff00ff;`, 10, 10, 40, 20))))!;
    expect(r.warnings).toEqual([]);
    expect(pathDs(r.svg)).toEqual(['M10 10H50V30H10Z']);
    const bad = drawioToSvg(enc(model(cell('a', 'shape=stencil(!!);', 0, 0, 10, 10))))!;
    expect(bad.warnings).toEqual(['埋め込んだ形 (stencil) が読めない (文字だけ描く)']);
  });

  it('ライブラリが無い形と、ライブラリにあって形が無いもの (JavaScript で書かれた形) を分けて警告する', () => {
    const reg = new StencilRegistry();
    reg.add(LIBRARY);
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.test.nothing;', 0, 0, 10, 10) + cell('b', 'shape=mxgraph.aws4.ec2;', 20, 0, 10, 10))), { stencils: reg })!;
    expect(r.warnings).toEqual(['形 "mxgraph.test.nothing" は図形ライブラリ test に無い (JavaScript で書かれた形など。文字だけ描く)', '形 "mxgraph.aws4.ec2" は描けない (図形ライブラリ aws4 が無い。文字だけ描く)']);
    expect(r.missingLibraries).toEqual(['aws4']);
  });

  it('包みの形 (AWS の resourceIcon など): 塗りの四角の中に、名指しした図形ライブラリの形を線の色で描く', () => {
    const reg = new StencilRegistry();
    reg.add(LIBRARY);
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.test.box_arrow;fillColor=#ff8800;strokeColor=#ffffff;', 0, 0, 100, 100))), { stencils: reg })!;
    expect(r.warnings).toEqual([]);
    const d = pathDs(r.svg);
    // 外の四角 (塗りの色) と、8 割の大きさのアイコン (線の色で塗り、線は引かない)
    expect(d[0]).toBe('M0 0L100 0L100 100L0 100Z');
    expect(r.svg).toContain(`<path d="M0 0L100 0L100 100L0 100Z" fill="#ff8800" stroke="none"/>`);
    expect(r.svg).toContain('<path d="M10 10L90 10L90 90Z" fill="#ffffff" stroke="none"/>');
    // AWS のグループ: 枠の線と、左上のアイコン (grIconSize)
    const g = drawioToSvg(enc(model(cell('g', 'shape=mxgraph.aws4.group;grIcon=mxgraph.test.box_arrow;grIconSize=20;strokeColor=#232F3E;fillColor=none;', 0, 0, 200, 100))), { stencils: reg })!;
    expect(g.svg).toContain('<path d="M0 0L200 0L200 100L0 100Z" fill="none" stroke="#232F3E"');
    expect(pathDs(g.svg)[1]).toBe('M0 0L20 0L20 20Z');
  });

  it('包みの形の中のアイコンのライブラリが無ければ、警告して、そのライブラリを求める', () => {
    const r = drawioToSvg(enc(model(cell('a', 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;', 0, 0, 50, 50))))!;
    expect(r.warnings).toEqual(['形 "mxgraph.aws4.resourceIcon" の中の "mxgraph.aws4.lambda" は描けない (図形ライブラリ aws4 が無い)']);
    expect(r.missingLibraries).toEqual(['aws4']);
    // 包みの外の四角は描く
    expect(pathDs(r.svg)).toEqual(['M0 0L50 0L50 50L0 50Z']);
  });

  it('画像の登録所は、draw.io の図を本体の画像の形式として読み、足りないライブラリがあるときだけライブラリを求めて描き直す', async () => {
    const asked: string[][] = [];
    const formats = [drawioFormat({
      provideStencils: async (libs: string[]) => {
        asked.push(libs);
        const reg = new StencilRegistry();
        reg.add(LIBRARY);
        return reg;
      },
    })];
    const assets = new AssetStore({ parseXml: parse, formats });
    const a = await assets.addBlob('a.drawio', new Blob([model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 100, 50))]));
    expect(a).toMatchObject({ mime: 'image/svg+xml', width: 101, height: 51, formatSource: { format: 'draw.io' } });
    expect(a?.notes).toBeUndefined();
    expect(new TextDecoder().decode(a!.bytes)).toContain('M0 0L100 0L100 50Z');
    await assets.addBlob('b.drawio', new Blob([model(cell('a', 'rounded=1;', 0, 0, 100, 50))]));
    expect(asked).toEqual([['test']]);
  });

  it('公開の createDrawioStencilRegistry で作った登録所を provideStencils で返せる。読めないファイルは拒む', async () => {
    let reg: DrawioStencilRegistry | undefined;
    const formats = [drawioFormat({
      provideStencils: async () => {
        reg ??= await createDrawioStencilRegistry();
        reg.add(LIBRARY, 'test.xml');
        return reg;
      },
    })];
    const assets = new AssetStore({ parseXml: parse, formats });
    const a = await assets.addBlob('a.drawio', new Blob([model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 100, 50))]));
    expect(new TextDecoder().decode(a!.bytes)).toContain('M0 0L100 0L100 50Z');
    const r = await createDrawioStencilRegistry([{ name: 'lib/test.xml', data: LIBRARY }]);
    expect(r.get('mxgraph.test.box_arrow')).toBeDefined();
    await expect(createDrawioStencilRegistry([{ name: 'x.txt', data: 'hello' }])).rejects.toThrow('draw.io の図形ライブラリとして読めません: x.txt');
    await expect(createDrawioStencilRegistry([{ name: 'x.txt', data: 'hello' }], { lang: 'en' })).rejects.toThrow('not a draw.io shape library: x.txt');
  });
});

describe('draw.io の配布物の画像 (SAP のアイコンの中の画像)', () => {
  const sap = (name: string, x = 0) => cell(`s${x}`, `shape=mxgraph.sap.icon;SAPIcon=${name};`, x, 0, 50, 50);
  const ICON = (c: string) => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="10"><defs><linearGradient id="A"><stop stop-color="${c}"/></linearGradient></defs><rect width="20" height="10" fill="url(#A)"/></svg>`;

  it('画像が無ければ円だけ描き、警告して、その画像を求める', () => {
    const r = drawioToSvg(enc(model(sap('Foo'))))!;
    expect(r.missingImages).toEqual(['img/lib/sap/Foo.svg']);
    expect(r.warnings).toEqual(['形 "mxgraph.sap.icon" の画像 img/lib/sap/Foo.svg は描けない (draw.io の配布物の画像が無い。図形ライブラリと一緒に渡すか、取るのを許す)']);
    expect(r.svg).not.toContain('<svg x=');
  });

  it('渡した画像 (名前で引く) を、内側の 6 割の枠に、比を保って入れ子の svg で置く。画像ごとに id を分ける', () => {
    const reg = new StencilRegistry();
    expect(reg.add(ICON('#ff0000'), 'Foo.svg')).toBe(1);
    expect(reg.add(ICON('#0000ff'), 'dir/bar.SVG')).toBe(1);
    expect(reg.add('<html/>', 'x.svg')).toBe(0);
    const r = drawioToSvg(enc(model(sap('Foo') + sap('Bar', 100))), { stencils: reg })!;
    expect(r.warnings).toEqual([]);
    expect(r.missingImages).toEqual([]);
    const nested = [...r.svg.matchAll(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 20 10" preserveAspectRatio="xMidYMid meet"/g)].map((m) => m.slice(1).map(Number));
    // 枠は形の座標 (セルの位置は、包む要素の写し方で移す)
    expect(nested).toEqual([
      [10, 10, 30, 30],
      [10, 10, 30, 30],
    ]);
    expect(r.svg).toMatch(/<g transform="matrix\(1 0 0 1 100 0\)"><svg x="10"/);
    // 2 つの画像の A は別の名前になり、それぞれ自分の定義を指す
    const ids = [...r.svg.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(r.svg).toContain(`fill="url(#${id})"`);
    expect(r.svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 0 }) })).not.toBeNull();
  });

  it('画像の道は配布物の img の下の .svg・.png・.jpg だけ。URL は図形ライブラリの配布物と同じ版の場所', () => {
    for (const p of ['img/lib/sap/SAP_BTP,_Cloud_Foundry_runtime.svg', 'img/lib/clip_art/computers/Laptop_128x128.png', 'img/lib/sap/a/b.svg']) expect(isDrawioImagePath(p)).toBe(true);
    for (const p of ['img/lib/sap/../../x.svg', 'img/lib/./a.svg', 'img/lib/sap/a.gif', '../x.svg', 'img/a.svg', 'https://example.com/a.svg']) expect(isDrawioImagePath(p)).toBe(false);
    expect(drawioImageUrl('img/lib/sap/A,_B.svg')).toBe('https://raw.githubusercontent.com/jgraph/drawio/v24.7.5/src/main/webapp/img/lib/sap/A%2C_B.svg');
    expect(drawioImageUrl('img/lib/sap/A.svg', 'https://example.com/drawio/js/stencils.min.js')).toBe('https://example.com/drawio/img/lib/sap/A.svg');
  });
});

describe('draw.io の図の画像 (URL・配布物の PNG)', () => {
  const png = encodePngStored({ width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });

  it('登録所の画像 (URL・配布物の道) を、PNG は data: の image 要素で置く。PNG・JPEG・SVG でないものは足さない', () => {
    const reg = new StencilRegistry();
    expect(reg.addImage('https://example.com/a.png', png)).toBe(true);
    expect(reg.addImage('img/lib/clip_art/computers/Laptop_128x128.png', png)).toBe(true);
    expect(reg.addImage('https://example.com/b.gif', new TextEncoder().encode('GIF89a'))).toBe(false);
    const r = drawioToSvg(
      enc(model(cell('a', 'shape=image;image=https://example.com/a.png;imageAspect=0;', 0, 0, 40, 20) + cell('b', 'shape=image;image=img/lib/clip_art/computers/Laptop_128x128.png;', 100, 0, 40, 40))),
      { stencils: reg },
    )!;
    expect(r.warnings).toEqual([]);
    expect(r.missingImages).toEqual([]);
    expect(r.svg).toMatch(/<image x="0" y="0" width="40" height="20" preserveAspectRatio="none" href="data:image\/png;base64,[^"]+"\/>/);
    expect(r.svg).toMatch(/<image x="100" y="0" width="40" height="40" preserveAspectRatio="xMidYMid meet" href="data:image\/png;base64,/);
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 0 }) })).not.toBeNull();
  });
});

describe('draw.io の図形ライブラリの選択肢 (API・コマンド)', () => {
  const fileOf = (s: FontSpec) => path.join(fontDir, path.basename(s.urls.find((u) => !/^https:/.test(u)) ?? s.urls[0]));
  const loadFont = async (spec: FontSpec) => {
    const f = fileOf(spec);
    if (!fs.existsSync(f)) return undefined;
    const b = fs.readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  beforeAll(() => ensureFonts([...DEFAULT_FONTS.base]), 120000);
  const fig = model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 100, 50));
  const html = '<p><img src="fig.drawio"></p>';

  it('画像の参照の fragment で、描くページを選ぶ (typeset)', async () => {
    const page = (id: string, name: string, cells: string) => `<diagram id="${id}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`;
    const two = `<mxfile>${page('p1', '一', cell('a', '', 0, 0, 10, 10))}${page('p2', '二', cell('b', '', 0, 0, 300, 200))}</mxfile>`;
    const doc = '<p><img src="fig.drawio"><img src="fig.drawio#page=2"><img src="fig.drawio#%E4%BA%8C"><img src="fig.drawio#page=5"></p>';
    const r = await typeset(doc, { loadFont, files: [{ name: 'fig.drawio', data: two }], drawio: {} });
    const got: Array<[string, number, number, boolean]> = [];
    walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, Math.round(a.width), Math.round(a.height), !!a.missing])));
    // CSS px のまま pt にする (96dpi: 1px = 0.75pt)。1 ページ目 11 × 11px、2 ページ目 301 × 201px
    expect(got).toEqual([
      ['fig.drawio', 8, 8, false],
      ['fig.drawio#page=2', 226, 151, false],
      ['fig.drawio#二', 226, 151, false],
      ['fig.drawio#page=5', 8, 8, false],
    ]);
    expect(r.warnings).toEqual(['画像 fig.drawio#page=5 の一部を描けません: draw.io の図に 5 ページ目がありません (2 ページ。最初のページを描きます)']);
  });

  it('見本 examples/drawio-pages: 参照ごとに、指したページを描く (見本が壊れていないか)', async () => {
    const dir = path.resolve(__dirname, '../../examples/drawio-pages');
    const doc = fs.readFileSync(path.join(dir, 'pages.html'), 'utf8');
    const r = await typeset(doc, { loadFont, files: [{ name: 'diagrams.drawio', data: fs.readFileSync(path.join(dir, 'diagrams.drawio')) }], drawio: {} });
    const got: Array<[string, boolean]> = [];
    walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, !!a.missing])));
    expect(got).toEqual(['diagrams.drawio', 'diagrams.drawio#page=2', 'diagrams.drawio#page-id=legend', 'diagrams.drawio#組版の流れ', 'diagrams.drawio#凡例', 'diagrams.drawio#page=9'].map((s) => [s, false]));
    expect(r.pageCount).toBe(3);
    expect(r.warnings).toEqual(['画像 diagrams.drawio#page=9 の一部を描けません: draw.io の図に 9 ページ目がありません (3 ページ。最初のページを描きます)']);
    // 3 つのページは大きさが違い、同じページを指す書き方は同じ図になる
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'diagrams.drawio')));
    const svg = (page?: string) => drawioToSvg(bytes, page ? { page } : {})!;
    const sizes = [svg(), svg('page=2'), svg('page=3')].map((x) => `${x.width}x${x.height}`);
    expect(new Set(sizes).size).toBe(3);
    expect(svg('page=3').warnings).toEqual([]);
    expect(svg('組版の流れ').svg).toBe(svg('page=2').svg);
    expect(svg('page-id=legend').svg).toBe(svg('page=3').svg);
    expect(svg('%E5%87%A1%E4%BE%8B').svg).toBe(svg('page=3').svg);
    // XSL-FO の版 (fo:external-graphic の src。url() で囲まない形も)
    const fo = await typeset(fs.readFileSync(path.join(dir, 'pages.fo'), 'utf8'), { loadFont, files: [{ name: 'diagrams.drawio', data: bytes }], drawio: {} });
    const foGot: Array<[string, boolean]> = [];
    walkAreaTree(fo.areaTree, (a) => void (a.type === 'image' && foGot.push([a.src, !!a.missing])));
    expect(foGot).toEqual(['diagrams.drawio', 'diagrams.drawio#page=2', 'diagrams.drawio#page-id=legend', 'diagrams.drawio#組版の流れ', 'diagrams.drawio#凡例', 'diagrams.drawio#page=9'].map((s) => [s, false]));
    expect(fo.pageCount).toBe(3);
    expect(fo.warnings).toEqual(r.warnings);
  });

  it('既定ではネットワークから取らず、警告する。stencils のライブラリで描く。fetchStencils の関数は、許したときだけ、1 回だけ呼ぶ', async () => {
    const plain = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: {} });
    expect(plain.warnings).toContain('画像 fig.drawio の一部を描けません: 形 "mxgraph.test.box_arrow" は描けない (図形ライブラリ test が無い。文字だけ描く)');
    // draw.io の図を読まない (drawio: false) なら、図は画像として読まない
    const none = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: false });
    expect(none.warnings.some((w) => w.includes('fig.drawio') && !w.includes('一部を描けません'))).toBe(true);
    const given = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: { stencils: [{ name: 'test.xml', data: LIBRARY }] } });
    expect(given.warnings.filter((w) => w.includes('fig.drawio'))).toEqual([]);
    let calls = 0;
    // 取り先を決めた関数 (既定の取り先の版の中身でない、試しの図形ライブラリを返すので、SHA-256 の一覧と照らさない取り先にする)
    const once = { stencilsUrl: 'https://example.com/w/js/stencils.min.js', fetchStencils: async () => (calls++, LIBRARY) };
    const fetched = await typeset(html + '<p><img src="g.drawio"></p>', {
      loadFont,
      files: [
        { name: 'fig.drawio', data: fig },
        { name: 'g.drawio', data: fig },
      ],
      drawio: once,
    });
    expect(fetched.warnings.filter((w) => w.includes('drawio'))).toEqual([]);
    expect(calls).toBe(1);
    const broken = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: { stencils: [{ name: 'x.xml', data: '<html/>' }] } });
    expect(broken.warnings).toContain('draw.io の図形ライブラリとして読めません: x.xml');
  }, 60000);

  it('fetchStencils の関数は、配布物の中の道と取り先の URL を受ける (図形ライブラリは js/stencils.min.js、画像は img/lib/sap/<名前>.svg)', async () => {
    const asked: string[] = [];
    const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>';
    const both = model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 100, 50) + cell('b', 'shape=mxgraph.sap.icon;SAPIcon=Foo;', 200, 0, 50, 50));
    const r = await typeset(html, {
      loadFont,
      files: [{ name: 'fig.drawio', data: both }],
      drawio: { stencilsUrl: 'https://example.com/w/js/stencils.min.js', fetchStencils: async (p, { url }) => (asked.push(`${p} ${url}`), p.endsWith('.svg') ? svgIcon : LIBRARY) },
    });
    expect(r.warnings.filter((w) => w.includes('drawio') || w.includes('draw.io'))).toEqual([]);
    expect(asked.sort()).toEqual(['img/lib/sap/Foo.svg https://example.com/w/img/lib/sap/Foo.svg', 'js/stencils.min.js https://example.com/w/js/stencils.min.js']);
    // 渡したファイルの .svg も画像として使う (ネットワークに行かない)
    const given = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: both }], drawio: { stencils: [{ name: 'test.xml', data: LIBRARY }, { name: 'Foo.svg', data: svgIcon }] } });
    expect(given.warnings.filter((w) => w.includes('fig.drawio'))).toEqual([]);
  }, 60000);

  it('URL の画像は文書の画像と同じく resolveResource・fetchImages で決める。配布物の PNG は fetchStencils', async () => {
    const png = encodePngStored({ width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });
    const fig2 = model(cell('a', 'shape=image;image=https://example.com/a.png;', 0, 0, 40, 20) + cell('b', 'shape=image;image=img/lib/clip_art/a/b.png;', 100, 0, 40, 20));
    const asked: string[] = [];
    const r = await typeset(html, {
      loadFont,
      files: [{ name: 'fig.drawio', data: fig2 }],
      resolveResource: (u) => (asked.push(u), u === 'https://example.com/a.png' ? png : undefined),
      drawio: { stencilsUrl: 'https://example.com/w/js/stencils.min.js', fetchStencils: async (p) => (asked.push(p), png) },
    });
    expect(r.warnings.filter((w) => w.includes('drawio') || w.includes('draw.io'))).toEqual([]);
    expect(asked.sort()).toEqual(['https://example.com/a.png', 'img/lib/clip_art/a/b.png']);
    // fetchImages: false なら取らない (警告する)。配布物の画像は、許さなければ求めない
    const refused = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig2 }], fetchImages: false, drawio: {} });
    expect(refused.warnings).toContain('画像を取りません (fetchImages): https://example.com/a.png');
    expect(refused.warnings.some((w) => w.includes('img/lib/clip_art/a/b.png は描けない'))).toBe(true);
  }, 60000);

  it('警告の文は Kumiori の lang に従う (既定は日本語。lang: \'en\' なら英語)', async () => {
    const two = model(cell('a', 'shape=mxgraph.test.box_arrow;', 0, 0, 100, 50) + cell('b', 'shape=image;image=../a.png;', 120, 0, 40, 20));
    const en = await typeset(html, { loadFont, lang: 'en', files: [{ name: 'fig.drawio', data: two }], drawio: { stencils: [{ name: 'x.xml', data: '<html/>' }] } });
    expect(en.warnings).toContain('not a draw.io shape library: x.xml');
    expect(en.warnings.some((w) => w.includes('shape "mxgraph.test.box_arrow" cannot be drawn (the shape library test is missing; only its text is drawn)'))).toBe(true);
    expect(en.warnings.some((w) => w.includes('image: URL not read (../a.png)'))).toBe(true);
    expect(en.warnings.join('\n')).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(drawioToSvg(new TextEncoder().encode(two), { lang: 'en' })!.warnings).toEqual([
      'shape "mxgraph.test.box_arrow" cannot be drawn (the shape library test is missing; only its text is drawn)',
      'image: URL not read (../a.png)',
    ]);
    expect(() => stencilFiles('/no/such/dir', 'en')).toThrow('draw.io shape library file not found: /no/such/dir');
  }, 60000);

  it('drawio の選択肢は Kumiori の検証を通る。形の違う選択肢は誤り', async () => {
    await expect(typeset('<p>x</p>', { loadFont, drawio: {} })).resolves.toBeDefined();
    await expect(typeset('<p>x</p>', { loadFont, drawio: false })).resolves.toBeDefined();
    await expect(typeset('<p>x</p>', { loadFont, drawio: 'yes' as never })).rejects.toThrow('drawio はオブジェクトか false');
    await expect(typeset('<p>x</p>', { loadFont, drawio: { fetchStencils: 1 as never } })).rejects.toThrow('drawio.fetchStencils');
    await expect(typeset('<p>x</p>', { loadFont, drawio: { stencils: [{}] as never } })).rejects.toThrow('drawio.stencils');
  }, 60000);

  it('コマンドの --drawio-stencils の読み方 (nodeFiles.ts の stencilFiles): ファイル・ディレクトリを読む', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-mxgraph-'));
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'lib', 'test.xml'), LIBRARY);
    fs.writeFileSync(path.join(dir, 'lib', 'note.txt'), 'x');
    expect(stencilFiles(path.join(dir, 'lib')).map((f) => f.name)).toEqual(['test.xml']);
    expect(() => stencilFiles(path.join(dir, 'none'))).toThrow('見つかりません');
    const r = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: { stencils: stencilFiles(path.join(dir, 'lib')) } });
    expect(r.warnings.filter((w) => w.includes('fig.drawio'))).toEqual([]);
  }, 60000);
});
