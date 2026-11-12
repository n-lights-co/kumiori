/**
 * 公開の前の脆弱性検査 (0.2.0): ネットワークの画像の取得。応答しない URL を並べた文書が、いつまでも取りに行き続けないこと
 * (同時に 8 個まで取り、文書の画像の取得の全体にも時限を置く)。登録は、取り終えた順でなく、文書に出てきた順
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { AssetStore } from '../src/assets';
import { fetchReportedImages } from '../src/documentResources';
import { encodePngStored } from '../src/pixels';

const png = (w: number) => encodePngStored({ width: w, height: 1, rgba: new Uint8Array(w * 4).fill(255) });

async function withServer<T>(handler: http.RequestListener, body: (base: string) => Promise<T>): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

describe('ネットワークの画像の取得の全体の時限と、登録の順', () => {
  it('応答しない URL を 40 個並べても、全体の時限 (1 つの時限の 10 倍) の内に終わる (1 つずつ順に取ると 40 倍)', async () => {
    let requests = 0;
    await withServer(
      () => void requests++,
      async (base) => {
        const t0 = Date.now();
        const urls = Array.from({ length: 40 }, (_, k) => `${base}/${k}.png`);
        const refused = await fetchReportedImages(new AssetStore(), urls, () => true, 300);
        const ms = Date.now() - t0;
        expect(refused).toEqual([]);
        // 同時に 8 個: 40 個は 5 回り (1.5 秒ほど)。順に取ると 12 秒。全体の時限は 3 秒
        expect(ms).toBeLessThan(6000);
        expect(requests).toBeLessThanOrEqual(40);
      },
    );
  }, 30_000);
  it('全体の時限を過ぎたら、残りは取りに行かない', async () => {
    let requests = 0;
    await withServer(
      () => void requests++,
      async (base) => {
        // 時限 100ms、同時に 8 個: 全体の時限 (1 秒) の内に始められるのは 10 回りほど (80 個前後)。400 個は取りきらない
        const urls = Array.from({ length: 400 }, (_, k) => `${base}/${k}.png`);
        const t0 = Date.now();
        await fetchReportedImages(new AssetStore(), urls, () => true, 100);
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(requests).toBeLessThan(200);
      },
    );
  }, 30_000);
  it('同じ名前の画像は、応答の速さに依らず、文書で後に出てきたものが名前で引かれる', async () => {
    await withServer(
      (req, res) => {
        // 先に出てくる a/x.png は遅く、後の b/x.png は速く返す
        const slow = req.url!.startsWith('/a/');
        setTimeout(() => res.writeHead(200, { 'content-type': 'image/png' }).end(png(slow ? 3 : 7)), slow ? 300 : 0);
      },
      async (base) => {
        const assets = new AssetStore();
        await fetchReportedImages(assets, [`${base}/a/x.png`, `${base}/b/x.png`], () => true, 5000);
        expect(assets.get(`${base}/a/x.png`)?.width).toBe(3);
        expect(assets.get(`${base}/b/x.png`)?.width).toBe(7);
        expect(assets.get('x.png')?.width).toBe(7);
      },
    );
  }, 30_000);
});

describe('base64: 組み込みの変換と、文字列を経る変換が同じ字の並びを出す', () => {
  it('長さ 0〜3 の端と、32KB の区切りをまたぐ長さで同じ', async () => {
    const { base64 } = await import('../src/base64');
    const slow = (b: Uint8Array) => {
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    };
    for (const n of [0, 1, 2, 3, 4, 0x8000 - 1, 0x8000, 0x8000 + 1, 100_003]) {
      const big = new Uint8Array(n + 7).map((_, i) => (i * 131 + 7) & 255);
      // 先頭をずらした部分の列 (byteOffset のある Uint8Array) でも同じ
      const b = big.subarray(5, 5 + n);
      expect(base64(b)).toBe(slow(b));
    }
  });
});

describe('読めない @font-face の書体は、結果の警告に出る', () => {
  it('壊れた書体のファイル', async () => {
    const { typeset } = await import('../src/index');
    const { loadCachedFont } = await import('./helpers');
    const bad = new Uint8Array(64);
    bad.set([0, 1, 0, 0, 0, 1]);
    const r = await typeset('<style>@font-face { font-family: X; src: url(x.ttf) } p { font-family: X }</style><p>a</p>', { loadFont: loadCachedFont, files: [{ name: 'x.ttf', data: bad }] });
    expect(r.warnings.some((w) => w.startsWith('@font-face X: '))).toBe(true);
  }, 60_000);
});

describe('担当の外に残った 2 乗の手間 (url(…)・var() の連鎖) と、数式の字の数の上限の報告', () => {
  it('閉じない url( を 20 万回並べた値・var() の 5000 段の連鎖が、すぐに組み終わる', async () => {
    const { typeset } = await import('../src/index');
    const { loadCachedFont } = await import('./helpers');
    const vars = Array.from({ length: 5000 }, (_, k) => `--a${k + 1}: var(--a${k})`).join('; ');
    for (const html of [`<p style="background-image: ${'url('.repeat(200_000)}">x</p>`, `<style>:root { --a0: red; ${vars} } p { color: var(--a5000) }</style><p>x</p>`]) {
      const t0 = Date.now();
      const r = await typeset(html, { loadFont: loadCachedFont });
      expect(r.pageCount).toBe(1);
      expect(Date.now() - t0).toBeLessThan(20_000);
    }
  }, 120_000);
});
