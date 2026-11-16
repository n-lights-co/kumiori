/**
 * 公開の前の脆弱性検査 (4 回目): draw.io の図を本体が既定で読むようになった後の守り
 *  - 手書き風 (sketch=1) の形が style の値でセルの枠より大きく描かれても、斜線を作りすぎない (300 バイトに満たない図でメモリが尽きていた)
 *  - 文書ごとの決まりで取った URL の画像を、選択肢を使い回す別の文書に残さない (fetchImages: false の文書に、取らずに描かれていた)
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { typeset } from '../src/index';
import { loadCachedFont } from './helpers';
import { pathExtent } from '../src/drawio/drawioSketch';
import { prefixSums } from '../src/drawio/prefixSums';
import { encodePngStored } from '../src/pixels';

const cell = (style: string, w = 100, h = 60, value = '') =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry width="${w}" height="${h}" as="geometry"/></mxCell></root></mxGraphModel>`;
const enc = (s: string) => new TextEncoder().encode(s);

describe('draw.io の手書き風の形', () => {
  it('セルの枠より大きく描く形 (rackCabinet の unitNum・ボタンの列の textSize) でも、すぐに組み終わる', async () => {
    for (const [style, value] of [
      ['shape=mxgraph.rackGeneral.rackCabinet;unitNum=1e9;unitHeight=1;sketch=1', ''],
      ['shape=mxgraph.mockup.buttons.horButtonBar;textSize=1e9;sketch=1', 'A,B'],
      ['shape=mxgraph.mockup.buttons.horButtonBar;textSize=1e5;sketch=1', 'A,B'],
    ]) {
      const t0 = Date.now();
      const r = await typeset('<img src="a.drawio">', { loadFont: loadCachedFont, files: [{ name: 'a.drawio', data: enc(cell(style, 100, 60, value)) }] });
      expect(r.pageCount).toBe(1);
      expect(Date.now() - t0).toBeLessThan(20_000);
    }
  }, 120_000);
  it('経路の大きさの見積もり (端点と制御点の外接の幅 + 高さ)', () => {
    expect(pathExtent('M0 0L100 50')).toBe(150);
    expect(pathExtent('M10 10l100 0v50h-100z')).toBe(150);
    expect(pathExtent('M0 0C0 0 1e9 0 10 10')).toBe(1e9 + 10);
    expect(pathExtent('')).toBe(0);
  });
});

describe('draw.io の図の URL の画像', () => {
  it('fetchImages: true の文書のために取った画像を、同じ選択肢を使う fetchImages: false の文書に描かない', async () => {
    const png = encodePngStored({ width: 2, height: 2, rgba: new Uint8Array(16).fill(255) });
    let requests = 0;
    const server = http.createServer((_q, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'image/png' }).end(png);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      // 運用者が 1 度作って使い回す選択肢 (図形ライブラリを 1 つ渡す)
      const drawio = { stencils: [{ name: 'x.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>' }] };
      const files = [{ name: 'a.drawio', data: enc(cell(`shape=image;image=http://127.0.0.1:${port}/secret.png`)) }];
      const hasImage = async (r: Awaited<ReturnType<typeof typeset>>) => /\/Subtype\s*\/Image/.test(Buffer.from(await r.toPdf()).toString('latin1'));
      const a = await typeset('<img src="a.drawio">', { loadFont: loadCachedFont, files, drawio, fetchImages: true });
      expect(await hasImage(a)).toBe(true);
      const b = await typeset('<img src="a.drawio">', { loadFont: loadCachedFont, files, drawio, fetchImages: false });
      expect(await hasImage(b)).toBe(false);
      expect(b.warnings.some((w) => /fetchImages/.test(w))).toBe(true);
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }, 120_000);
});

describe('draw.io の形の、, で区切る項目の数', () => {
  it('項目が多い (20 万個) ボタンの列・円グラフ・パンくずでも、すぐに組み終わる (毎回足し直すと項目の数の 2 乗だった)', async () => {
    const many = Array.from({ length: 200_000 }, () => 'a').join(',');
    const nums = Array.from({ length: 200_000 }, () => '1').join(',');
    for (const shape of ['mxgraph.mockup.buttons.horButtonBar', 'mxgraph.mockup.graphics.pieChart', 'mxgraph.mockup.navigation.breadcrumb', 'mxgraph.ios7ui.horButtonBar']) {
      const t0 = Date.now();
      const r = await typeset('<img src="a.drawio">', { loadFont: loadCachedFont, files: [{ name: 'a.drawio', data: enc(cell(`shape=${shape};mainText=${many};buttonText=${many};parts=${nums}`, 400, 80)) }] });
      expect(r.pageCount).toBe(1);
      expect(Date.now() - t0).toBeLessThan(20_000);
    }
  }, 180_000);
  it('途中の和の表は、0 から毎回足し直すのと同じ値 (足す順が同じ)', () => {
    const w = Array.from({ length: 500 }, (_, k) => Math.sin(k) * 1e3 + 0.1 * k);
    const p = prefixSums(w.length, (j) => w[j] + 2 * 3.7);
    for (let i = 0; i <= w.length; i++) {
      let x = 0;
      for (let j = 0; j < i; j++) x += w[j] + 2 * 3.7;
      expect(p[i]).toBe(x);
    }
  });
});
