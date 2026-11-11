/** 文書・CSS の参照の集め方 (src/resources.ts) */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { collectResources, cssRefs, documentRefs, fetchGuarded, resolveRef } from '../src/resources';
import { fetchLimits } from '../src/imageLimits';

describe('参照の集め方', () => {
  it('文書の参照: <link rel=stylesheet> と @import は CSS、@font-face の url() は書体、src・data・SVG の href・ほかの url() はそのほか。<a href> は拾わない', () => {
    const refs = documentRefs(
      '<link rel="preload" href="p.css"><link href=\'s.css\' rel="alternate stylesheet"><style>@import url("i.css"); p { background: url(bg.png) }</style>' +
        '<img src="a.png"><svg><image xlink:href="b.svg"/></svg><object data="c.svg"></object><a href="doc.pdf">d</a><fo:external-graphic src="url(\'e.png\')"/>',
    );
    expect(refs).toEqual([
      { url: 's.css', kind: 'css' },
      { url: 'a.png', kind: 'other' },
      { url: 'b.svg', kind: 'other' },
      { url: 'c.svg', kind: 'other' },
      { url: 'e.png', kind: 'other' },
      { url: 'i.css', kind: 'css' },
      { url: 'bg.png', kind: 'other' },
    ]);
    expect(cssRefs("@import 'a.css' screen; @font-face { src: url(f.ttf) }")).toEqual([
      { url: 'a.css', kind: 'css' },
      { url: 'f.ttf', kind: 'font' },
    ]);
  });
  it('CSS の中の相対参照は CSS の URL を基準に解決する (RFC 3986 §5.2。スキームの無い名前はパスとしてつなぐ)', () => {
    expect(resolveRef('../img/a.png', 'file:///w/css/main.css')).toBe('file:///w/img/a.png');
    expect(resolveRef('b.css', 'https://cdn.example/x/a.css?v=1')).toBe('https://cdn.example/x/b.css');
    expect(resolveRef('../img/a.png', 'css/main.css')).toBe('img/a.png');
    // 基準より上を指す参照は、上がりきれなかった .. を残す (入力のディレクトリの外のファイル。名前の上で消すと、別のファイルを指してしまう)
    expect(resolveRef('../../fx/a.ttf', 'css/main.css')).toBe('../fx/a.ttf');
    expect(resolveRef('../a.png', 'main.css')).toBe('../a.png');
    expect(resolveRef('../b.png', '../x/main.css')).toBe('../b.png');
    expect(resolveRef('https://x/y.css', 'css/main.css')).toBe('https://x/y.css');
    expect(resolveRef('a.png')).toBe('a.png');
  });
  it('files にあるものは問い合わせない。data:・#・javascript: は問い合わせない。CSS の @import の輪で止まる', async () => {
    const asked: string[] = [];
    const r = await collectResources('<link rel="stylesheet" href="a.css"><img src="data:image/png;base64,AA"><img src="have.png"><img src="#x">', {
      has: (u) => u === 'have.png',
      cssTexts: [],
      resolve: (u) => (asked.push(u), u === 'a.css' ? '@import "b.css";' : u === 'b.css' ? '@import "a.css";' : undefined),
      fetchStyle: () => false,
      timeoutMs: 1000,
    });
    expect(asked).toEqual(['a.css', 'b.css']);
    expect(r.files.map((f) => [f.name, f.css])).toEqual([
      ['a.css', true],
      ['b.css', true],
    ]);
  });
});

/**
 * ネットワークからの取得の守り (fetchGuarded): 転送の先を許可の関数に聞く (OUT-01)・大きさの上限で読むのをやめる (OUT-11)。
 * 手元の HTTP サーバー (127.0.0.1 の空いているポート) だけを使う
 */
describe('ネットワークからの取得: 転送の先と大きさの上限', () => {
  let server: http.Server;
  let other: http.Server;
  let base = '';
  let otherBase = '';
  /** パスごとの、届いた要求の数 */
  const hits = new Map<string, number>();
  /** 終わらない本体を送っている途中で、相手が接続を切ったことを知らせる */
  let endlessClosed: Promise<void>;
  const listen = (s: http.Server) => new Promise<number>((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as { port: number }).port)));
  beforeAll(async () => {
    other = http.createServer((req, res) => {
      hits.set('other' + req.url, (hits.get('other' + req.url) ?? 0) + 1);
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('p { color: red }');
    });
    otherBase = `http://127.0.0.1:${await listen(other)}`;
    let closed: () => void;
    endlessClosed = new Promise<void>((ok) => (closed = ok));
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      hits.set(url, (hits.get(url) ?? 0) + 1);
      const redirect = (to: string) => (res.writeHead(302, { location: to }), res.end());
      const chain = /^\/chain\/(\d+)$/.exec(url);
      if (url === '/ok.css' || url === '/secret.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('p { color: red }');
      } else if (url === '/r/secret') redirect('/secret.css');
      else if (url === '/r/relative') redirect('../ok.css');
      else if (url === '/r/port') redirect(`${otherBase}/x.css`);
      else if (url === '/r/file') redirect('file:///etc/passwd');
      else if (url === '/r/data') redirect('data:text/css,p{}');
      else if (url === '/loop') redirect('/loop');
      else if (chain) Number(chain[1]) > 0 ? redirect(`/chain/${Number(chain[1]) - 1}`) : redirect('/ok.css');
      else if (url === '/endless') {
        // Content-Length の無い、終わらない本体 (相手が切るまで送り続ける)
        res.writeHead(200, { 'content-type': 'text/css' });
        const timer = setInterval(() => res.write('a'.repeat(1024)), 1);
        res.on('close', () => (clearInterval(timer), closed()));
      } else if (url === '/declared') {
        res.writeHead(200, { 'content-type': 'text/css', 'content-length': '5000' });
        res.end('a'.repeat(5000));
      } else if (url.startsWith('/sized/')) {
        // Content-Length を付けずに、決まった大きさの本体を送る
        res.writeHead(200, { 'content-type': 'text/css' });
        res.write('a'.repeat(Number(url.slice(7))));
        res.end();
      } else if (url === '/stall') {
        // ヘッダーと本体の頭だけを送って、後を送らない
        res.writeHead(200, { 'content-type': 'text/css' });
        res.write('p {');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
    other.closeAllConnections();
    other.close();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    hits.clear();
  });
  const text = (r: Awaited<ReturnType<typeof fetchGuarded>>) => (r ? new TextDecoder().decode(r.bytes) : undefined);
  const big = { maxBytes: 1 << 20 };

  it('転送の先の URL を許可の関数に聞き、許されなければ、そこへ要求を出さない (別のパス・別のポート)', async () => {
    const asked: string[] = [];
    const allow = (u: string) => (asked.push(u), !u.includes('secret') && u.startsWith(base));
    expect(await fetchGuarded(`${base}/r/secret`, { ...big, allow })).toBeUndefined();
    expect(asked).toEqual([`${base}/secret.css`]);
    expect(hits.get('/secret.css')).toBeUndefined();
    expect(await fetchGuarded(`${base}/r/port`, { ...big, allow })).toBeUndefined();
    expect(hits.get('other/x.css')).toBeUndefined();
    // 許される先へはたどる (Location は今の URL に対して解決する)
    expect(text(await fetchGuarded(`${base}/r/relative`, { ...big, allow }))).toBe('p { color: red }');
    expect(asked[asked.length - 1]).toBe(`${base}/ok.css`);
    // 許可の関数が無ければ (fetchImages・fetchStyles が true)、これまでどおりたどる
    expect(text(await fetchGuarded(`${base}/r/port`, big))).toBe('p { color: red }');
    expect((await fetchGuarded(`${base}/ok.css`, big))?.type).toBe('text/css');
  });
  it('転送の連なりは、1 つずつ許可の関数に聞いてたどる。上限 (fetchLimits.redirects) を超える連なり・輪はたどらない', async () => {
    const asked: string[] = [];
    expect(text(await fetchGuarded(`${base}/chain/3`, { ...big, allow: (u) => (asked.push(u), true) }))).toBe('p { color: red }');
    expect(asked).toEqual([`${base}/chain/2`, `${base}/chain/1`, `${base}/chain/0`, `${base}/ok.css`]);
    // 連なりの途中で許されなければ、そこで止まる
    hits.clear();
    expect(await fetchGuarded(`${base}/chain/3`, { ...big, allow: (u) => !u.endsWith('/chain/1') })).toBeUndefined();
    expect(hits.get('/chain/1')).toBeUndefined();
    hits.clear();
    // 既定の上限 20: 20 回の転送 (/chain/19 → … → /chain/0 → /ok.css) はたどり、21 回はたどらない
    expect(fetchLimits.redirects).toBe(20);
    expect(text(await fetchGuarded(`${base}/chain/19`, big))).toBe('p { color: red }');
    hits.clear();
    expect(await fetchGuarded(`${base}/chain/20`, big)).toBeUndefined();
    expect(hits.get('/ok.css')).toBeUndefined();
    expect(await fetchGuarded(`${base}/loop`, big)).toBeUndefined();
    expect(hits.get('/loop')).toBe(21);
  });
  it('http(s) でないスキームへの転送は断る', async () => {
    const asked: string[] = [];
    const allow = (u: string) => (asked.push(u), true);
    expect(await fetchGuarded(`${base}/r/file`, { ...big, allow })).toBeUndefined();
    expect(await fetchGuarded(`${base}/r/data`, { ...big, allow })).toBeUndefined();
    expect(asked).toEqual([]);
  });
  it('解決できない Location の転送は network error (Fetch Standard §2.2.6 の location URL が failure)。Location の無い転送の応答は使わない', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u);
      if (u === 'https://a.example/bad') return new Response(null, { status: 302, headers: { location: 'http://[' } });
      if (u === 'https://a.example/none') return new Response('moved', { status: 302 });
      return new Response('p {}', { status: 200 });
    });
    expect(await fetchGuarded('https://a.example/bad', big)).toBeUndefined();
    expect(await fetchGuarded('https://a.example/none', big)).toBeUndefined();
    expect(calls).toEqual(['https://a.example/bad', 'https://a.example/none']);
  });
  it('https から http への転送 (格下げ) は断る。https から https へはたどる', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u);
      if (u === 'https://a.example/down') return new Response(null, { status: 302, headers: { location: 'http://a.example/x.css' } });
      if (u === 'https://a.example/same') return new Response(null, { status: 307, headers: { location: 'https://b.example/x.css' } });
      return new Response('p {}', { status: 200 });
    });
    expect(await fetchGuarded('https://a.example/down', big)).toBeUndefined();
    expect(calls).toEqual(['https://a.example/down']);
    expect(text(await fetchGuarded('https://a.example/same', big))).toBe('p {}');
    expect(calls[calls.length - 1]).toBe('https://b.example/x.css');
  });
  it('Location を読めない実行環境 (ブラウザ): 転送された応答は、最後の URL を許可の関数に聞き、許されなければ使わない', async () => {
    const modes: Array<string | undefined> = [];
    const redirected = (finalUrl: string) => {
      const res = new Response('p {}', { status: 200 });
      Object.defineProperty(res, 'redirected', { value: true });
      Object.defineProperty(res, 'url', { value: finalUrl });
      return res;
    };
    vi.stubGlobal('document', {});
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => (modes.push(init?.redirect), redirected('http://internal.example/x.css')));
    const asked: string[] = [];
    expect(await fetchGuarded('http://a.example/x.css', { ...big, allow: (u) => (asked.push(u), !u.includes('internal')) })).toBeUndefined();
    expect(asked).toEqual(['http://internal.example/x.css']);
    expect(modes).toEqual(['follow']);
    expect(text(await fetchGuarded('http://a.example/x.css', { ...big, allow: () => true }))).toBe('p {}');
    // 許可の関数が無ければ、ブラウザに任せる (これまでどおり)。ただし https から http へ格下げされた応答は使わない
    expect(text(await fetchGuarded('http://a.example/x.css', big))).toBe('p {}');
    expect(await fetchGuarded('https://a.example/x.css', big)).toBeUndefined();
    // document が無くても、redirect: 'manual' の応答が opaqueredirect になる実行環境では、たどり直して同じように確かめる
    vi.unstubAllGlobals();
    modes.length = 0;
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      modes.push(init?.redirect);
      if (init?.redirect !== 'manual') return redirected('http://internal.example/x.css');
      const res = new Response(null, { status: 200 });
      Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
      Object.defineProperty(res, 'status', { value: 0 });
      return res;
    });
    expect(await fetchGuarded('http://a.example/x.css', { ...big, allow: (u) => !u.includes('internal') })).toBeUndefined();
    expect(modes).toEqual(['manual', 'follow']);
  });
  it('Content-Length の無い本体が上限を超えたら、読むのをやめて接続を切る (終わらない本体でも止まる)', async () => {
    expect(await fetchGuarded(`${base}/endless`, { maxBytes: 10_000 })).toBeUndefined();
    // サーバーの側で、送り終える前に相手が切ったことが分かる (切らなければ、このテストは時限で落ちる)
    await endlessClosed;
    // ちょうど上限までは読める。1 バイトでも超えれば読まない
    expect((await fetchGuarded(`${base}/sized/3000`, { maxBytes: 3000 }))?.bytes.length).toBe(3000);
    expect(await fetchGuarded(`${base}/sized/3001`, { maxBytes: 3000 })).toBeUndefined();
  });
  it('Content-Length が上限を超えていれば、本体を読まずに断る', async () => {
    expect(await fetchGuarded(`${base}/declared`, { maxBytes: 4999 })).toBeUndefined();
    expect((await fetchGuarded(`${base}/declared`, { maxBytes: 5000 }))?.bytes.length).toBe(5000);
    // 本体を少しずつ読めない実行環境 (res.body が無い) では、全部を読んでから大きさを見る
    const noBody = (n: number) => ({ ok: true, status: 200, type: 'basic', redirected: false, url: '', headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(n) });
    vi.stubGlobal('fetch', async (u: string) => noBody(Number(u.split('/').pop())));
    expect((await fetchGuarded('http://a.example/10', { maxBytes: 10 }))?.bytes.length).toBe(10);
    expect(await fetchGuarded('http://a.example/11', { maxBytes: 10 })).toBeUndefined();
  });
  it('時限は、本体を読み終えるまで効く (ヘッダーの後で止まった応答を待ち続けない)', async () => {
    expect(await fetchGuarded(`${base}/stall`, { maxBytes: 1 << 20, timeoutMs: 200 })).toBeUndefined();
    expect(hits.get('/stall')).toBe(1);
  });
  it('collectResources: CSS・書体の取得は、転送の先を fetchStyle に聞き、種類ごとの上限 (fetchLimits) で読むのをやめる', async () => {
    const run = (html: string, fetchStyle: (u: string) => boolean = () => true) => collectResources(html, { has: () => false, cssTexts: [], fetchStyle, timeoutMs: 5000 });
    const link = (p: string) => `<link rel="stylesheet" href="${base}${p}">`;
    const a = await run(link('/r/secret'), (u) => !u.endsWith('/secret.css'));
    expect(a.files).toEqual([]);
    expect(a.warnings).toEqual([`css-fetch-failed\t${base}/r/secret`]);
    expect(hits.get('/secret.css')).toBeUndefined();
    const saved = { ...fetchLimits };
    try {
      fetchLimits.cssBytes = 2000;
      fetchLimits.fontBytes = 4000;
      expect((await run(link('/sized/2000'))).files.map((f) => f.data.length)).toEqual([2000]);
      const b = await run(link('/sized/2001'));
      expect(b.files).toEqual([]);
      expect(b.warnings).toEqual([`css-fetch-failed\t${base}/sized/2001`]);
      // 書体は書体の上限で見る (CSS の上限より大きくても取る)
      const face = (n: number) => `<style>@font-face { font-family: F; src: url(${base}/sized/${n}) }</style>`;
      expect((await run(face(4000))).files.map((f) => f.data.length)).toEqual([4000]);
      const c = await run(face(4001));
      expect(c.files).toEqual([]);
      expect(c.warnings).toEqual([`font-fetch-failed\t${base}/sized/4001`]);
    } finally {
      Object.assign(fetchLimits, saved);
    }
  });
});
