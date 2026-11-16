import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
// 本体の画像の登録所・判定は、テストのためだけに本体の src から読む (パッケージの src は、本体の公開の API (の型) だけを使う)
import { AssetStore, looksLikeImage, mentionedFiles } from '../../src/assets';
import { imageInfo } from '../../src/imageInfo';
import { formatOf, formatsOf } from '../../src/imageFormats';
import { fetchReportedImages } from '../../src/documentResources';
import { DRAWIO_MIME, drawioToSvg, isDrawio } from '../../src/drawio/drawio';
import { drawioFormat } from '../../src/drawio/index';
import { encodePngStored } from '../../src/pixels';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const enc = (s: string) => new TextEncoder().encode(s);
const xa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** セルの並びから draw.io のファイルを作る (id 0 の根と、id 1 の層は足す) */
function model(cells: string, attrs = ''): string {
  return `<mxGraphModel${attrs ? ' ' + attrs : ''}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
}
const file = (cells: string, attrs = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="test"><diagram id="a" name="Page-1">${model(cells, attrs)}</diagram></mxfile>`;
const vertex = (id: string, style: string, x: number, y: number, w: number, h: number, value = '', parent = '1') =>
  `<mxCell id="${id}" value="${xa(value)}" style="${xa(style)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const edge = (id: string, style: string, source: string, target: string, inner = '', value = '') =>
  `<mxCell id="${id}" value="${xa(value)}" style="${xa(style)}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${inner}</mxGeometry></mxCell>`;
const render = (xml: string) => drawioToSvg(enc(xml))!;
const pathDs = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe('draw.io の図 (mxGraph の XML)', () => {
  it('mxfile と mxGraphModel で始まるものを draw.io とみなし、形と大きさを読む', async () => {
    const xml = file(vertex('a', 'rounded=0;', 10, 20, 100, 50));
    expect(isDrawio(enc(xml))).toBe(true);
    expect(isDrawio(enc('﻿  <!-- c -->' + model(vertex('a', '', 0, 0, 10, 10))))).toBe(true);
    expect(isDrawio(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
    // 外接の枠: 四角 (10, 20)〜(110, 70) と線の太さの半分 (0.5) で 101 × 51
    expect([render(xml).width, render(xml).height]).toEqual([101, 51]);
    // 大きさは本体と一緒に配る画像の形式 (IMAGE_FORMATS の draw.io) が読み込んで決める。imageInfo (同期の見積もり) は知らない。
    // drawio: false の形式の並び (formatsOf(undefined, false)) では、画像として見分けない
    const formats = [drawioFormat()];
    const without = formatsOf(undefined, false);
    expect(await imageInfo(enc(xml))).toBeUndefined();
    expect(formatOf(enc(xml))?.name).toBe('draw.io');
    expect(formatOf(enc(xml), without)).toBeUndefined();
    expect(formatOf(enc(xml), formats)?.name).toBe('draw.io');
    expect(DRAWIO_MIME).toBe('application/vnd.jgraph.mxfile');
    expect(await looksLikeImage(enc(xml))).toBe(true);
    expect(await looksLikeImage(enc(xml), without)).toBe(false);
    // 本文に書いた名前 (.drawio・.dio) を、画像の名前として拾う (drawio: false なら拾わない)
    expect([...mentionedFiles(['<img src="fig/a.drawio"> <img src=b.dio>'])].sort()).toEqual(['a.drawio', 'b.dio']);
    expect([...mentionedFiles(['<img src="fig/a.drawio">'], without)]).toEqual([]);
  });

  it('圧縮したページ (encodeURIComponent → deflate (頭の無い形) → base64) を戻して読む', () => {
    const inner = model(vertex('a', 'ellipse;', 0, 0, 80, 40, '日本語 & <b>'));
    const packed = Buffer.from(deflateRawSync(Buffer.from(encodeURIComponent(inner)))).toString('base64');
    const compressed = `<mxfile><diagram id="x" name="P">${packed}</diagram></mxfile>`;
    const a = render(compressed);
    const b = render(`<mxfile><diagram id="x" name="P">${inner}</diagram></mxfile>`);
    expect(a.svg).toBe(b.svg);
    expect(a.svg).toContain('<ellipse cx="40" cy="20" rx="40" ry="20"');
    // 字は XML の実体参照を戻してから、SVG に書くときにまた逃がす
    expect(a.svg).toContain('日本語 &amp; &lt;b&gt;');
  });

  describe('ページ (<diagram>) の選び方 (画像の参照の fragment。pageOf)', () => {
    // 1 ページ目は 10 × 10、2 ページ目 (名前「詳細 図」・id "p2") は 500 × 500、3 ページ目 (圧縮した形) は 30 × 30
    const packed = Buffer.from(deflateRawSync(Buffer.from(encodeURIComponent(model(vertex('c', '', 0, 0, 30, 30)))))).toString('base64');
    const xml =
      `<mxfile><diagram id="p1" name="Page-1">${model(vertex('a', '', 0, 0, 10, 10))}</diagram>` +
      `<diagram id="p2" name="詳細 図">${model(vertex('b', '', 0, 0, 500, 500))}</diagram><diagram id="p3" name="p2">${packed}</diagram></mxfile>`;
    const page = (p?: string) => drawioToSvg(enc(xml), p === undefined ? {} : { page: p })!;

    it('指定が無い・空なら、最初のページ', () => {
      expect(page().width).toBe(11);
      expect(page('').width).toBe(11);
      expect(page().warnings).toEqual([]);
    });

    it('page=N は N ページ目 (1 から数える)、page-id=ID は id、ほかはページの名前 (無ければ id)。%xx は戻して読む', () => {
      expect(page('page=1').width).toBe(11);
      expect(page('page=2').width).toBe(501);
      expect(page('page=3').width).toBe(31);
      expect(page('page-id=p3').width).toBe(31);
      expect(page('%E8%A9%B3%E7%B4%B0%20%E5%9B%B3').width).toBe(501);
      expect(page('詳細 図').width).toBe(501);
      // 名前を先に探す (名前「p2」の 3 ページ目)。id で選ぶなら page-id=
      expect(page('p2').width).toBe(31);
      expect(page('page-id=p2').width).toBe(501);
      expect(page('p1').width).toBe(11);
      expect(page('page=2').warnings).toEqual([]);
    });

    it('無いページは、最初のページを描いて警告する', () => {
      expect(page('page=4')).toMatchObject({ width: 11, warnings: ['draw.io の図に 4 ページ目がありません (3 ページ。最初のページを描きます)'] });
      expect(page('page=0').width).toBe(11);
      expect(page('無い').warnings).toEqual(['draw.io の図に、指したページがありません: #無い (最初のページを描きます)']);
      expect(page('page-id=x').warnings).toEqual(['draw.io の図に、指したページがありません: #page-id=x (最初のページを描きます)']);
      expect(drawioToSvg(enc(xml), { page: 'page=9', lang: 'en' })!.warnings).toEqual(['the draw.io diagram has no page 9 (it has 3; the first page is drawn)']);
      // ページの無い形 (<mxGraphModel> だけ) は 1 ページの図
      const one = model(vertex('a', '', 0, 0, 10, 10));
      expect(drawioToSvg(enc(one), { page: 'page=1' })!.warnings).toEqual([]);
      expect(drawioToSvg(enc(one), { page: 'page=2' })).toMatchObject({ width: 11, warnings: ['draw.io の図に 2 ページ目がありません (1 ページ。最初のページを描きます)'] });
    });

    it('登録所: fragment の付いた参照を、同じファイルの別の画像として作る (fetchReportedImages も同じ道を通る)', async () => {
      const assets = new AssetStore({ parseXml: parse, formats: [drawioFormat()] });
      expect((await assets.addBlob('fig/a.drawio', new Blob([xml])))?.width).toBe(11);
      expect((await assets.addFragment('fig/a.drawio#page=2'))?.width).toBe(501);
      expect((await assets.addFragment('a.drawio#%E8%A9%B3%E7%B4%B0%20%E5%9B%B3'))?.width).toBe(501);
      expect(assets.get('fig/a.drawio')?.width).toBe(11);
      expect(assets.get('fig/a.drawio#page=2')?.width).toBe(501);
      // ファイル名だけで引く参照には、fragment の無いファイルの画像が当たる (ページの画像で上書きしない)
      expect(assets.get('other/a.drawio')?.width).toBe(11);
      expect(await assets.addFragment('fig/a.drawio#page=2')).toBe(assets.get('fig/a.drawio#page=2'));
      // 無いページは、最初のページを描いた画像に警告が付く
      expect(await assets.addFragment('a.drawio#page=7')).toMatchObject({ width: 11, notes: ['draw.io の図に 7 ページ目がありません (3 ページ。最初のページを描きます)'] });
      // fragment の無い参照・元の画像の無い参照・本体の外の形式でない画像は作らない
      expect(await assets.addFragment('fig/a.drawio')).toBeUndefined();
      expect(await assets.addFragment('b.drawio#page=2')).toBeUndefined();
      assets.registerSize('c.png', 5, 5);
      expect(await assets.addFragment('c.png#x')).toBeUndefined();
      const reported = new AssetStore({ parseXml: parse, formats: [drawioFormat()] });
      await reported.addBlob('a.drawio', new Blob([xml]));
      expect(await fetchReportedImages(reported, ['a.drawio', 'a.drawio#page=3'], () => false)).toEqual([]);
      expect(reported.get('a.drawio#page=3')?.width).toBe(31);
      // 元の図を登録し直したら (選択肢が変わった・開き直した)、ページの画像は捨て、読み込みの報告から作り直す (ページを保つ)
      await reported.addBlob('a.drawio', new Blob([xml]));
      expect(reported.get('a.drawio#page=3')).toBeUndefined();
      await fetchReportedImages(reported, ['a.drawio', 'a.drawio#page=3'], () => false);
      expect(reported.get('a.drawio#page=3')?.width).toBe(31);
    });
  });

  it('子の図形の位置は親の左上から。見えない層・たたんだ容器の中は描かない', () => {
    const cells =
      vertex('g', 'swimlane;startSize=20;', 100, 100, 200, 100, 'レーン') +
      vertex('c', 'fillColor=#ff0000;', 10, 30, 50, 20, '', 'g') +
      '<mxCell id="L2" parent="0" visible="0"/>' +
      vertex('h', 'fillColor=#00ff00;', 0, 0, 10, 10, '', 'L2') +
      '<mxCell id="k" value="" style="" vertex="1" parent="1" collapsed="1"><mxGeometry x="400" y="0" width="40" height="40" as="geometry"/></mxCell>' +
      vertex('kc', 'fillColor=#0000ff;', 5, 5, 10, 10, '', 'k');
    const r = render(file(cells));
    expect(r.svg).toContain('<rect x="110" y="130" width="50" height="20" fill="#ff0000"');
    expect(r.svg).not.toContain('#00ff00');
    expect(r.svg).not.toContain('#0000ff');
    // スイムレーン: 見出しの帯 (startSize) と、見出しの下の線
    expect(r.svg).toContain('<rect x="100" y="100" width="200" height="20" fill="#ffffff" stroke="none"/>');
    expect(pathDs(r.svg)).toContain('M100 120H300');
  });

  it('親をたどると輪になるセル・親の無いセルは描かずに、ほかを描く', () => {
    const cells = vertex('a', '', 0, 0, 10, 10, '', 'b') + vertex('b', '', 0, 0, 10, 10, '', 'a') + vertex('c', 'fillColor=#123456;', 0, 0, 30, 30, '', 'zz') + vertex('d', '', 0, 0, 20, 20);
    const r = render(file(cells));
    expect(r.width).toBe(21);
    expect(r.svg).not.toContain('#123456');
  });

  it('直角に曲げる線 (orthogonalEdgeStyle): 横に離れた図形は、向かい合う辺の真ん中から中間の x で曲げる。矢印は classic', () => {
    const cells = vertex('a', '', 0, 0, 100, 40) + vertex('b', '', 200, 100, 100, 40) + edge('e', 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;', 'a', 'b');
    const r = render(file(cells));
    // 横の隔たり (100) が縦の隔たり (60) より大きい: 右の辺から出て、b の上の辺へ入る L の形
    const d = pathDs(r.svg);
    expect(d[0]).toMatch(/^M100 20L250 20L250 9[0-9.]+$/);
    // classic の矢印 (線の色で塗った 4 点の形。先は b の上の辺の少し手前)
    expect(r.svg).toMatch(/<path d="M250 98\.88L[^"]+Z" fill="#000000" stroke="#000000"/);
  });

  it('縦に並ぶ図形は、下の辺から上の辺へまっすぐ。決まった接続点 (exitX・entryX) を使う', () => {
    const cells = vertex('a', '', 0, 0, 100, 40) + vertex('b', '', 0, 100, 100, 40) + vertex('c', '', 300, 0, 40, 40);
    const down = render(file(cells + edge('e', 'edgeStyle=orthogonalEdgeStyle;endArrow=none;', 'a', 'b')));
    expect(pathDs(down.svg)[0]).toBe('M50 40L50 100');
    const fixed = render(file(cells + edge('e', 'edgeStyle=orthogonalEdgeStyle;endArrow=none;exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=0;', 'a', 'c')));
    // 上から出て上へ入る: 高い方の上 20px を回る
    expect(pathDs(fixed.svg)[0]).toBe('M50 0L50 -20L320 -20L320 0');
  });

  it('sideToSideEdgeStyle・topToBottomEdgeStyle は elbow の横・縦と同じに曲げる。知らない曲げ方は、まっすぐ引いて警告する', () => {
    const cells = vertex('a', '', 0, 0, 100, 40) + vertex('b', '', 200, 100, 100, 40);
    const side = render(file(cells + edge('e', 'edgeStyle=sideToSideEdgeStyle;endArrow=none;', 'a', 'b')));
    expect(pathDs(side.svg)[0]).toBe('M100 20L150 20L150 120L200 120');
    const top = render(file(cells + edge('e', 'edgeStyle=topToBottomEdgeStyle;endArrow=none;', 'a', 'b')));
    expect(pathDs(top.svg)[0]).toBe('M50 40L50 70L250 70L250 100');
    expect(side.warnings).toEqual([]);
    const odd = render(file(cells + edge('e', 'edgeStyle=myEdgeStyle;endArrow=none;', 'a', 'b')));
    expect(odd.warnings).toEqual(['線の曲げ方 "myEdgeStyle" は知らない (まっすぐの線で描く)']);
  });

  it('まっすぐの線は、中心を結ぶ直線と図形の周の交わる点で始まり終わる (楕円・ひし形の周)。折れ点を通る', () => {
    const cells = vertex('a', 'ellipse;', 0, 0, 100, 100) + vertex('b', 'rhombus;', 200, 0, 100, 100);
    const r = render(file(cells + edge('e', 'endArrow=none;html=1;', 'a', 'b')));
    expect(pathDs(r.svg).at(-1)).toBe('M100 50L200 50');
    const w = render(file(cells + edge('e', 'endArrow=none;', 'a', 'b', '<Array as="points"><mxPoint x="150" y="-50"/></Array>')));
    const d = pathDs(w.svg).at(-1)!;
    expect(d).toContain('L150 -50L');
    // 楕円の周の点 (中心 (50, 50) から (150, -50) へ 45 度。半径 50)
    expect(d.startsWith(`M${Math.round((50 + 50 * Math.SQRT1_2) * 100) / 100} ${Math.round((50 - 50 * Math.SQRT1_2) * 100) / 100}`)).toBe(true);
  });

  it('自分へ戻る線 (mxEdgeStyle.Loop): 図形の右へ方眼の 2 倍出た所の 2 点 (上下に方眼の大きさ) を通る', () => {
    const r = render(file(vertex('a', '', 0, 0, 80, 40) + edge('l', 'endArrow=none;', 'a', 'a')));
    // 中心 (40, 20)、segment = gridSize (既定 10): 点 (100, 10)・(100, 30)。端は、中心からその点へ向かう半直線と四角の周の交わる点 (x = 80)
    expect(pathDs(r.svg).at(-1)).toBe('M80 13.33L100 10L100 30L80 26.67');
  });

  it('シーケンス図の線 (sequenceEdgeStyle): 生存線の間に、折れ点の高さで横の線を引く。生存線の文字は頭の箱の中', () => {
    const cells = vertex('a', 'shape=umlLifeline;perimeter=lifelinePerimeter;size=30;', 0, 0, 80, 200, 'A') + vertex('b', 'shape=umlLifeline;perimeter=lifelinePerimeter;size=30;', 200, 0, 80, 200, 'B');
    const r = render(file(cells + edge('m', 'edgeStyle=sequenceEdgeStyle;endArrow=none;', 'a', 'b', '<Array as="points"><mxPoint x="100" y="90"/></Array>')));
    // 生存線の周: 縦の線 (中心 x) の、線の太さの半分だけ外
    expect(pathDs(r.svg).at(-1)).toBe('M40.5 90L239.5 90');
    // 名前は頭の箱 (高さ 30) の真ん中: 基線は 15 + 0.35 × 12
    expect(r.svg).toMatch(/<text x="40" y="19\.2"[^>]*><tspan[^>]*>A<\/tspan>/);
  });

  it('多角形の周 (trianglePerimeter・hexagonPerimeter2) と、周の間隔 (perimeterSpacing)', () => {
    const cells = vertex('a', '', 0, 0, 40, 40) + vertex('t', 'triangle;', 200, 0, 60, 40) + vertex('h', 'shape=hexagon;perimeter=hexagonPerimeter2;size=0.25;', 200, 100, 80, 40);
    // 三角形 (右向き) へ左から: 左の辺 (x = 200) で止まる。四角へは、周の間隔 5 だけ手前で止まる
    const t = render(file(cells + edge('e', 'endArrow=none;perimeterSpacing=5;', 'a', 't')));
    expect(pathDs(t.svg).at(-1)).toBe('M45 20L195 20');
    // 六角形へ、中心から左上へ伸ばすと、斜めの辺 (x = 200〜220) の上で止まる
    const h = render(file(cells + edge('e', 'endArrow=none;', 'a', 'h')));
    const end = pathDs(h.svg).at(-1)!.split('L')[1].split(' ').map(Number);
    expect(end[0]).toBeGreaterThan(200);
    expect(end[0]).toBeLessThan(220);
    expect(end[1]).toBeLessThan(120);
  });

  it('先細りの矢印 (taperedArrow): 警告なしに、始まりの幅 12 から終わりの幅 2 へ細る帯を、線の塗りで描く', () => {
    const r = render(file(`<mxCell id="t" style="shape=taperedArrow;endArrow=none;fillColor=#ff0000;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="50" y="200" as="sourcePoint"/><mxPoint x="350" y="200" as="targetPoint"/></mxGeometry></mxCell>`));
    expect(r.warnings).toEqual([]);
    expect(r.svg).toContain('<path d="M50 206L350 201L350 199L50 194Z" fill="#ff0000"');
  });

  it('曲げた文字 (curvedText): セルの文字を、円弧に沿って textPath で書き、字の間を経路の長さにそろえる', () => {
    const r = render(file(vertex('a', 'shape=curvedText;noLabel=1;strokeColor=none;fillColor=none;html=1;', 0, 0, 200, 60, 'ABC')));
    expect(r.warnings).toEqual([]);
    // 余白 6 (字の大きさの半分)。弦の高さは 25 + 縦の真ん中への寄せ 17.5 + 字の中心の分 4.2。真ん中は 25 上がる (半径 189.22 の円弧)
    expect(r.svg).toMatch(/<path id="dio-ct\d+" d="M6 46\.7A189\.22 189\.22 0 0 1 194 46\.7"\/>/);
    expect(r.svg).toMatch(/<textPath href="#dio-ct\d+" startOffset="50%" textLength="[\d.]+" lengthAdjust="spacing">ABC<\/textPath>/);
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 5 }) })).not.toBeNull();
  });

  it('サンキー図の線 (mermaidSankeyLink): 幅 width の帯を、乗算で塗る', () => {
    const r = render(file(`<mxCell id="k" style="shape=mermaidSankeyLink;endArrow=none;fillColor=#ff0000;strokeColor=none;width=10;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="0" as="sourcePoint"/><mxPoint x="100" y="0" as="targetPoint"/></mxGeometry></mxCell>`));
    expect(r.warnings).toEqual([]);
    expect(r.svg).toMatch(/<path style="mix-blend-mode:multiply" d="M0 5L[^"]+Z" fill="#ff0000"/);
  });

  it('JavaScript の線の形 (リーン生産の情報の流れ・ネットワークの通信の線): 両端を 5% ずつ縮め、真ん中で稲妻の形に折る', () => {
    const one = (shape: string, extra = '') =>
      render(file(`<mxCell id="k" style="shape=${shape};${extra}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="0" as="sourcePoint"/><mxPoint x="200" y="0" as="targetPoint"/></mxGeometry></mxCell>`));
    const manual = one('mxgraph.lean_mapping.manual_info_flow_edge');
    expect(manual.warnings).toEqual([]);
    expect(pathDs(manual.svg)).toEqual(['M10 0L190 0', 'M180 5L190 0L180 -5']);
    expect(manual.svg).toMatch(/d="M180 5L190 0L180 -5" fill="#000000"/);
    const elec = one('mxgraph.lean_mapping.electronic_info_flow_edge');
    expect(elec.warnings).toEqual([]);
    expect(pathDs(elec.svg)[0]).toBe('M10 0L118 -6L82 6L190 0');
    const comm = one('mxgraph.networks.comm_link_edge', 'fillColor=#29AAE1;');
    expect(comm.warnings).toEqual([]);
    expect(pathDs(comm.svg)).toEqual(['M10 0L118 -18L106 6L190 0L82 18L94 -6Z']);
    expect(comm.svg).toMatch(/fill="#29AAE1"/);
    expect(parseSvg(comm.svg, parse, { outline: () => ({ segs: [], advance: 5 }) })).not.toBeNull();
  });

  it('両端の不透明度の付いたグラデーション (iOS の形の光沢): stop-opacity に書く', () => {
    const r = render(file(vertex('p', 'shape=mxgraph.ios.iVideoControls;', 0, 0, 200, 400)));
    // mxMockupiOS.js の mxShapeMockupiVideoControls (v24.7.5): setGradient('#ffffff', '#ffffff', …, DIRECTION_SOUTH, 0.8, 0.1)
    expect(r.svg).toMatch(/<linearGradient id="dio-g\d+" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.8"\/><stop offset="1" stop-color="#ffffff" stop-opacity="0.1"\/><\/linearGradient>/);
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 5 }) })).not.toBeNull();
  });

  it('ガラスの光沢 (glass=1): 四角・楕円・ひし形の上の部分を、白の 0.9 から 0.1 へのグラデーションで塗る。表・塗りの無い形には描かない', () => {
    const one = (style: string) => render(file(vertex('g', style, 0, 0, 100, 40)));
    const rect = one('glass=1;');
    expect(pathDs(rect.svg)).toEqual(['M-1 -1L-1 16Q50 28 101 16L101 -1Z']);
    expect(rect.svg).toMatch(/<stop offset="0" stop-color="#ffffff" stop-opacity="0.9"\/><stop offset="1" stop-color="#ffffff" stop-opacity="0.1"\/>/);
    expect(rect.svg).toMatch(/<path d="M-1 -1L[^"]+" fill="url\(#dio-g\d+\)" stroke="none"/);
    // 角の丸め: getArcSize(101, 41) = 41 × 15% = 6.15 に、線の太さの分 2 を足す
    expect(pathDs(one('glass=1;rounded=1;').svg)).toEqual(['M7.15 -1Q-1 -1 -1 7.15L-1 16Q50 28 101 16L101 7.15Q101 -1 92.85 -1Z']);
    expect(pathDs(one('ellipse;glass=1;').svg)[0]).toMatch(/^M-1 20C/);
    expect(pathDs(one('rhombus;glass=1;').svg)).toEqual(['M50 0L100 20L50 40L0 20Z', 'M0 20L50 0L100 20Q50 28 0 20Z']);
    expect(pathDs(one('glass=1;fillColor=none;').svg)).toEqual([]);
    expect(one('shape=table;glass=1;').svg).not.toContain('stop-opacity');
    expect(parseSvg(rect.svg, parse, { outline: () => ({ segs: [], advance: 5 }) })).not.toBeNull();
  });

  it('線の跳び越し (jumpStyle): 先に描いた線と交わる所で、jumpSize (既定 6) の幅だけ跳ぶ', () => {
    const v = `<mxCell id="v" style="endArrow=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="50" y="0" as="sourcePoint"/><mxPoint x="50" y="100" as="targetPoint"/></mxGeometry></mxCell>`;
    const hz = (style: string) => `<mxCell id="h" style="endArrow=none;${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="50" as="sourcePoint"/><mxPoint x="100" y="50" as="targetPoint"/></mxGeometry></mxCell>`;
    expect(pathDs(render(file(v + hz('jumpStyle=gap;'))).svg).at(-1)).toBe('M0 50L44 50M56 50L100 50');
    expect(pathDs(render(file(v + hz('jumpStyle=arc;'))).svg).at(-1)).toBe('M0 50L44 50C44 42.2 56 42.2 56 50L56 50L100 50');
    // 後に描く線だけが跳ぶ (先の線は跳ばない)
    expect(pathDs(render(file(hz('') + v.replace('endArrow=none;', 'endArrow=none;jumpStyle=gap;'))).svg).at(-1)).toBe('M50 0L50 44M50 56L50 100');
    expect(pathDs(render(file(v + hz(''))).svg).at(-1)).toBe('M0 50L100 50');
  });

  it('線の端の形 (open・oval・diamond・block の塗らない形)、描けない形は警告して線だけ引く', () => {
    const cells = vertex('a', '', 0, 0, 40, 40) + vertex('b', '', 200, 0, 40, 40);
    const r = render(file(cells + edge('e', 'endArrow=open;startArrow=diamond;startFill=0;', 'a', 'b')));
    expect(r.svg).toMatch(/<path d="M[^"Z]+" fill="none" stroke="#000000"[^>]*\/><path d="M[^"]+Z" fill="none"/);
    const hc = render(file(cells + edge('e', 'endArrow=myArrow;', 'a', 'b')));
    expect(hc.warnings).toEqual(['線の端の形 "myArrow" は描けない']);
    expect(pathDs(hc.svg)).toEqual(['M40 20L200 20']);
  });

  it('ER 図の印 (draw.io の mxER.js): 線は縮めず、棒・鳥の足・円 (白で塗る) を線の端から並べる', () => {
    const cells = vertex('a', '', 0, 0, 40, 40) + vertex('b', '', 200, 0, 40, 40);
    // 長さ L = size (6) + 線の太さ (1) + 1 = 8
    const many = render(file(cells + edge('e', 'endArrow=ERmany;', 'a', 'b')));
    expect(pathDs(many.svg)).toEqual(['M40 20L200 20', 'M200 16L192 20L200 24']);
    const one = render(file(cells + edge('e', 'endArrow=ERmandOne;', 'a', 'b')));
    expect(pathDs(one.svg)[1]).toBe('M196 24L196 16M192 24L192 16');
    const zero = render(file(cells + edge('e', 'endArrow=ERzeroToMany;', 'a', 'b')));
    // 0 の円: 中心は端から 1.5 L、半径は size / 2
    expect(zero.svg).toContain('<path d="M185 20A3 3 0 1 1 191 20A3 3 0 1 1 185 20Z" fill="#ffffff"');
  });

  it('どの線の端の形も、警告なしに描け、Node の SVG の読み取りで図形にできる', () => {
    const types = ['classic', 'classicThin', 'block', 'blockThin', 'open', 'openThin', 'oval', 'diamond', 'diamondThin', 'dash', 'baseDash', 'cross', 'box', 'circle', 'circlePlus', 'async', 'openAsync', 'doubleBlock', 'ERone', 'ERmandOne', 'ERmany', 'ERoneToMany', 'ERzeroToMany', 'ERzeroToOne', 'none', 'halfCircle', 'manyOptional', 'mermaidExtension', 'mermaidDiamond', 'sysMLPackCont', 'sysMLReqInt', 'sysMLProvInt', 'sysMLx', 'sysMLLost', 'sysMLFound'];
    const cells = types.map((t, k) => `<mxCell id="e${k}" style="endArrow=${t};startArrow=${t};startFill=0;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="${k * 20}" as="sourcePoint"/><mxPoint x="100" y="${k * 20 + 5}" as="targetPoint"/></mxGeometry></mxCell>`).join('');
    const r = render(file(cells));
    expect(r.warnings).toEqual([]);
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 0 }) })).not.toBeNull();
  });

  it('影 (shadow=1): 図形と線に feDropShadow の影を付ける (文字には付けない)。影の範囲は図の座標で、外接の枠に影の分を足す', () => {
    const plain = render(file(vertex('a', '', 0, 0, 100, 50, '字')));
    const r = render(file(vertex('a', 'shadow=1;', 0, 0, 100, 50, '字') + `<mxCell id="e" style="shadow=1;endArrow=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="80" as="sourcePoint"/><mxPoint x="100" y="80" as="targetPoint"/></mxGeometry></mxCell>`));
    // mxShape.getShadowStyle の既定: ずらす 2・3、ぼかし 2、黒の 25%
    expect(r.svg).toMatch(/<filter id="dio-shadow" filterUnits="userSpaceOnUse" [^>]*><feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000000" flood-opacity="0.25"\/><\/filter>/);
    expect(r.svg).toMatch(/<g filter="url\(#dio-shadow\)"><rect x="0" y="0" width="100" height="50"[^>]*\/><\/g><text/);
    expect(r.svg).toMatch(/<g filter="url\(#dio-shadow\)"><path d="M0 80L100 80"/);
    expect(plain.svg).not.toContain('filter');
    // 影は、ずらし 2 にぼかしの広がり 2 × 3 を足した分だけ右に、引いた分 (4) だけ左にはみ出す
    expect(r.width).toBe(Math.ceil(100 + 2 + 6 - (2 - 6)));
    expect(parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 0 }), approximateFilters: true })).not.toBeNull();
  });

  it('影の色・不透明度・ずらす量・ぼかしはスタイルで変える。値ごとに別のフィルタ。文字の影 (textShadow) は文字だけに付ける', () => {
    const r = render(
      file(
        vertex('a', 'shadow=1;shadowColor=#ff0000;shadowOpacity=50;shadowOffsetX=4;shadowOffsetY=-1;shadowBlur=0;', 0, 0, 100, 50) +
          vertex('b', 'shadow=1;', 0, 100, 100, 50) +
          vertex('c', 'textShadow=1;', 0, 200, 100, 50, '影'),
      ),
    );
    expect(r.svg).toContain('<feDropShadow dx="4" dy="-1" stdDeviation="0" flood-color="#ff0000" flood-opacity="0.5"/>');
    expect(r.svg).toContain('<feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000000" flood-opacity="0.25"/>');
    expect(new Set([...r.svg.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1])).size).toBe(2);
    // 文字の影は、形の影と同じ既定の値のフィルタを、文字の要素に付ける (形には付けない)
    expect(r.svg).toMatch(/<rect x="0" y="200" width="100" height="50"[^>]*\/><g filter="url\(#dio-shadow1?\)"><text[^>]*>(?:<tspan[^>]*>)?影/);
  });

  it('図の全体の影 (mxGraphModel の shadow="1"): 図の全体を #3D4574 の 40% の影で包み、大きさを 6 広げる', () => {
    const r = render(file(vertex('a', '', 0, 0, 100, 50), 'shadow="1"'));
    expect(r.svg).toContain('<feDropShadow dx="3" dy="3" stdDeviation="1.7" flood-color="#3D4574" flood-opacity="0.4"/>');
    expect(r.svg).toMatch(/<g transform="translate\([^)]*\)" filter="url\(#dio-shadow\)">/);
    expect([r.width, r.height]).toEqual([107, 57]);
  });

  it('HTML のラベル: 太字・色・改行と、字の実体参照。文字の揃えと内側の余白', () => {
    const r = render(file(vertex('a', 'html=1;align=left;verticalAlign=top;fontSize=10;', 0, 0, 200, 100, '<b>太字</b>と<font color="#ff0000">赤</font><br>2&nbsp;行目<div>3 行目</div>')));
    const texts = [...r.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="start"[^>]*>(.*?)<\/text>/g)];
    expect(texts.length).toBe(3);
    // 左上の揃え: x は spacing (既定 2)、1 行目の基線は 2 + 10 × 0.95、行の高さは 10 × 1.2
    expect(texts.map((t) => [Number(t[1]), Number(t[2])])).toEqual([
      [2, 11.5],
      [2, 23.5],
      [2, 35.5],
    ]);
    expect(texts[0][3]).toContain('font-weight="bold">太字</tspan>');
    expect(texts[0][3]).toContain('fill="#ff0000">赤</tspan>');
    expect(texts[1][3]).toContain('>2\u00a0行目</tspan>');
    // 書式の切れ目をまたぐ空白は 1 つにまとめる
    const sp = render(file(vertex('a', 'html=1;', 0, 0, 200, 40, 'a <b> b</b>')));
    expect([...sp.svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1])).toEqual(['a ', 'b']);
  });

  it('HTML のラベルの行ごとの揃え (text-align・align の属性): 文字の塊の中で揃える。無い行はセルの align', () => {
    const r = render(file(vertex('a', 'html=1;whiteSpace=wrap;fontSize=10;', 0, 0, 104, 60, '<div style="text-align: left">左</div><div>中</div><div align="right">右</div>')));
    const xs = [...r.svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="(\w+)"/g)].map((m) => [Number(m[1]), m[2]]);
    // 折り返す塊の幅は 104 - 2 × 2 = 100 (左端 2・右端 102)。揃えの無い行は、セルの align (center) で真ん中 (52)
    expect(xs).toEqual([
      [2, 'start'],
      [52, 'middle'],
      [102, 'end'],
    ]);
  });

  it('形ごとの文字の置き場 (getLabelMargins・getLabelBounds): 円柱のふたの下、書類の波の上、処理の縦の線の内側。向きで余白を回す', () => {
    // 文字の塊の真ん中の y (1 行・字の大きさ 10。基線 = 真ん中 + 0.35 × 10)
    const mid = (svg: string) => Number(/<text x="[\d.]+" y="([\d.]+)"/.exec(svg)![1]) - 3.5;
    const cx = (svg: string) => Number(/<text x="([\d.]+)"/.exec(svg)![1]);
    const one = (style: string, w = 100, h = 100) => render(file(vertex('a', `${style}fontSize=10;`, 0, 0, w, h, '字'))).svg;
    // 円柱 (cylinder3、size 15): 上の余白 30・下の余白 4.5 → 5 (Math.round で丸める)。文字の枠は 30〜95、真ん中は 62.5
    expect(mid(one('shape=cylinder3;boundedLbl=1;'))).toBe(62.5);
    // boundedLbl が無ければ、形の全体の真ん中
    expect(mid(one('shape=cylinder3;'))).toBe(50);
    // 書類 (size 0.3): 下の余白 30。真ん中は 35
    expect(mid(one('shape=document;boundedLbl=1;'))).toBe(35);
    // 向き south: 東向きの下の余白は、左の余白になる (文字の枠は x 30〜100、真ん中は 65)
    expect(cx(one('shape=document;boundedLbl=1;direction=south;'))).toBe(65);
    // UML の枠 (umlFrame): 文字は左上の見出し (幅 60・高さ 30) の中
    const fr = one('shape=umlFrame;', 200, 100);
    expect([cx(fr), mid(fr)]).toEqual([30, 15]);
    // 文字が形の外にあるときは使わない
    expect(mid(one('shape=cylinder3;boundedLbl=1;verticalLabelPosition=bottom;verticalAlign=top;'))).toBeGreaterThan(100);
  });

  it('whiteSpace=wrap: 枠の幅 (内側の余白を除く) で折り返す。全角の字の間でも折る', () => {
    const r = render(file(vertex('a', 'whiteSpace=wrap;html=1;fontSize=10;', 0, 0, 44, 100, 'あいうえおかきくけこ')));
    const lines = [...r.svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
    // 使える幅は 44 - 2 × 2 = 40 (全角の字 4 つ)
    expect(lines).toEqual(['あいうえ', 'おかきく', 'けこ']);
    const en = render(file(vertex('a', 'whiteSpace=wrap;html=1;fontSize=10;', 0, 0, 60, 100, 'one two three four')));
    expect([...en.svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1])).toEqual(['one two', 'three four']);
  });

  it('文字の幅は、渡した測り方 (measureText) で測って折り返す。測れなければ見積もる', () => {
    const xml = file(vertex('a', 'whiteSpace=wrap;html=1;fontSize=10;', 0, 0, 60, 100, 'one two three four'));
    const lines = (svg: string) => [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
    const asked: string[] = [];
    // どの字も 1em の幅とする測り方: 使える幅 56 に 5 字まで
    const wide = drawioToSvg(enc(xml), { measureText: (t, ft) => (asked.push(`${ft.family}/${ft.bold}`), t.length * ft.size) })!;
    expect(lines(wide.svg)).toEqual(['one', 'two', 'three', 'four']);
    expect(new Set(asked)).toEqual(new Set(['Helvetica/false']));
    // 測れない (undefined) なら見積もり (Helvetica の幅) と同じ
    expect(lines(drawioToSvg(enc(xml), { measureText: () => undefined })!.svg)).toEqual(['one two', 'three four']);
    // 測り方を渡さない結果は覚えたものと同じ (測り方の結果は覚えない)
    expect(lines(render(xml).svg)).toEqual(['one two', 'three four']);
  });

  it('モックアップのボタンの幅も、渡した測り方で測る (mxUtils.getSizeForString)', () => {
    const asked: string[] = [];
    drawioToSvg(enc(file(vertex('m', 'shape=mxgraph.mockup.navigation.breadcrumb;', 0, 0, 300, 30, 'Layer 1,Layer 2,Layer 3'))), { measureText: (t) => (asked.push(t), t.length * 50) });
    expect(asked).toEqual(expect.arrayContaining(['Layer 1', ' Layer 2', ' Layer 3']));
  });

  it('UserObject の label と placeholders の %名前%', () => {
    const cells = `<UserObject label="名前: %name%" name="値" id="u"><mxCell style="placeholders=1;" vertex="1" parent="1"><mxGeometry width="100" height="40" as="geometry"/></mxCell></UserObject>`;
    expect(render(file(cells)).svg).toContain('>名前: 値</tspan>');
  });

  it('図形ライブラリの無いステンシルの形と、取っていない URL の画像は描かずに警告し、描く側に求める。文字は描く', () => {
    const r = render(file(vertex('a', 'shape=mxgraph.aws4.lambda;', 0, 0, 40, 40, 'λ') + vertex('b', 'shape=image;image=https://example.com/a.png;', 100, 0, 40, 40) + vertex('c', 'shape=image;image=../a.png;', 200, 0, 40, 40)));
    expect(r.warnings).toEqual([
      '形 "mxgraph.aws4.lambda" は描けない (図形ライブラリ aws4 が無い。文字だけ描く)',
      '画像 https://example.com/a.png は描けない (取れない・取るのを許していない)',
      '画像の URL は読まない (../a.png)',
    ]);
    expect(r.missingImages).toEqual(['https://example.com/a.png']);
    expect(r.svg).toContain('>λ</tspan>');
  });

  it('draw.io の v24.7.5 より後に足された形は、図形ライブラリが無いのとは別の警告にし、ライブラリを求めない。文字は描く', () => {
    const r = render(file(vertex('a', 'shape=mxgraph.archimate4.application;', 0, 0, 60, 40, 'A') + vertex('b', 'shape=mxgraph.bpmn.task2;', 100, 0, 60, 40, 'B')));
    expect(r.warnings).toEqual([
      '形 "mxgraph.archimate4.application" は描かない (draw.io の v24.7.5 より後に足された形。Kumiori は v24.7.5 の形を描く。文字だけ描く)',
      '形 "mxgraph.bpmn.task2" は描かない (draw.io の v24.7.5 より後に足された形。Kumiori は v24.7.5 の形を描く。文字だけ描く)',
    ]);
    expect(r.missingLibraries).toEqual([]);
    expect(r.svg).toContain('>A</tspan>');
    // 名前の頭が似ているだけの形 (archimate4x) は、これまでどおり図形ライブラリが無いと知らせる
    expect(render(file(vertex('c', 'shape=mxgraph.archimate4x.foo;', 0, 0, 60, 40))).missingLibraries).toEqual(['archimate4x']);
  });

  it('描いた SVG は、Node の SVG の読み取りで図形にできる (どの形も・画像を入れた図も)', () => {
    const shapes = ['rounded=1', 'ellipse', 'doubleEllipse', 'rhombus', 'triangle;direction=north', 'shape=hexagon', 'shape=parallelogram', 'shape=trapezoid', 'shape=step', 'shape=process', 'shape=document', 'shape=tape', 'shape=cylinder3', 'shape=cylinder', 'shape=note', 'shape=card', 'shape=cube', 'shape=delay', 'shape=cloud', 'shape=actor', 'shape=umlActor', 'shape=callout', 'shape=singleArrow', 'shape=doubleArrow', 'line', 'shape=partialRectangle;top=0', 'shape=internalStorage', 'shape=manualInput', 'shape=offPageConnector', 'shape=loopLimit', 'shape=sumEllipse', 'shape=orEllipse', 'swimlane;horizontal=0', 'text', 'rounded=1;rotation=30;flipH=1;gradientColor=#ff0000;dashed=1;opacity=50'];
    const png = Buffer.from(encodePngStored({ width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) })).toString('base64');
    const inner = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" fill="#00f"/></svg>').toString('base64');
    const cells = shapes.map((s, k) => vertex(`v${k}`, `${s};html=1;whiteSpace=wrap;`, (k % 6) * 120, Math.floor(k / 6) * 100, 100, 60, `形 ${k}`)).join('') + vertex('p', `shape=image;image=data:image/png,${png};`, 0, 700, 40, 20) + vertex('s', `shape=image;image=data:image/svg+xml,${inner};`, 100, 700, 40, 40) + edge('e', 'edgeStyle=orthogonalEdgeStyle;rounded=1;curved=0;startArrow=oval;', 'v0', 'v8', '', 'ラベル');
    const r = render(file(cells, 'background="#fafafa"'));
    expect(r.warnings).toEqual([]);
    const d = parseSvg(r.svg, parse, { outline: () => ({ segs: [], advance: 0 }) });
    expect(d).not.toBeNull();
    expect(r.svg).toContain('<image x="0" y="700" width="40" height="20" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,');
    expect(r.svg).toContain('<svg x="100" y="700" width="40" height="40" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet" overflow="hidden"><svg>');
  });

  it('画像の登録所: draw.io の図を SVG にして登録する (Node では図形で描く)', async () => {
    const assets = new AssetStore({ parseXml: parse, formats: [drawioFormat()] });
    const a = await assets.addBlob('fig.drawio', new Blob([file(vertex('a', 'shape=mxgraph.x.y;', 0, 0, 40, 40) + vertex('b', '', 50, 0, 40, 40))]));
    expect(a).toMatchObject({ mime: 'image/svg+xml', width: 91, height: 41, notes: ['形 "mxgraph.x.y" は描けない (図形ライブラリ x が無い。文字だけ描く)'] });
    expect(a?.drawable).toBeUndefined();
    // 影のある図も、仮の枠にせず図形で描く (影は Node で近似する)
    const sh = await assets.addBlob('sh.drawio', new Blob([file(vertex('a', 'shadow=1;', 0, 0, 40, 40))]));
    expect(sh).toMatchObject({ mime: 'image/svg+xml' });
    expect(sh?.drawable).toBeUndefined();
  });
});
