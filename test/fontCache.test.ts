/**
 * Node のコマンドの書体のキャッシュ (src/cli.ts):
 *  - 既定の場所: KUMIORI_FONT_CACHE → OS のキャッシュ ディレクトリ (Windows: %LOCALAPPDATA%、macOS: ~/Library/Caches、ほか: $XDG_CACHE_HOME か ~/.cache) の kumiori/fonts
 *  - 書体のファイルらしさの判定 (先頭 4 バイト)
 *  - localFont: --font-dir → キャッシュ → ネットワークの順。取れなければ、手元の書体の渡し方を添えて投げる
 *  - --font-cache・--no-font-cache の引数
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultFontCacheDir, localFont, looksLikeFont, parseArgs } from '../src/cli';
import { FONT_SPECS } from '../src/fontMapping';

describe('書体のキャッシュ', () => {
  it('既定の場所は、環境変数 → OS ごとのキャッシュ ディレクトリ', () => {
    expect(defaultFontCacheDir({ KUMIORI_FONT_CACHE: '/x/fonts' }, 'linux', '/home/u')).toBe(path.resolve('/x/fonts'));
    expect(defaultFontCacheDir({}, 'linux', '/home/u')).toBe(path.join('/home/u', '.cache', 'kumiori', 'fonts'));
    expect(defaultFontCacheDir({ XDG_CACHE_HOME: '/var/cache/u' }, 'linux', '/home/u')).toBe(path.join('/var/cache/u', 'kumiori', 'fonts'));
    expect(defaultFontCacheDir({}, 'darwin', '/Users/u')).toBe(path.join('/Users/u', 'Library', 'Caches', 'kumiori', 'fonts'));
    expect(defaultFontCacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe(path.join('C:\\Users\\u\\AppData\\Local', 'kumiori', 'fonts'));
    expect(defaultFontCacheDir({}, 'win32', 'C:\\Users\\u')).toBe(path.join('C:\\Users\\u', 'AppData', 'Local', 'kumiori', 'fonts'));
    expect(defaultFontCacheDir({}, 'linux', '')).toBeUndefined();
  });
  it('書体のファイルらしさ: TrueType・OTTO・true・ttcf の先頭だけを通す', () => {
    const head = (s: string | number[]) => new Uint8Array([...(typeof s === 'string' ? [...s].map((c) => c.charCodeAt(0)) : s), ...new Array(12).fill(0)]);
    expect(looksLikeFont(head([0, 1, 0, 0]))).toBe(true);
    expect(looksLikeFont(head('OTTO'))).toBe(true);
    expect(looksLikeFont(head('true'))).toBe(true);
    expect(looksLikeFont(head('ttcf'))).toBe(true);
    expect(looksLikeFont(head('<!DO'))).toBe(false);
    expect(looksLikeFont(new Uint8Array([0, 1, 0]))).toBe(false);
  });
  it('--font-cache と --no-font-cache を読む', () => {
    expect(parseArgs(['a.html', '--font-cache', '/c']).fontCache).toBe('/c');
    expect(parseArgs(['a.html']).noFontCache).toBe(false);
    expect(parseArgs(['a.html', '--no-font-cache']).noFontCache).toBe(true);
    expect(() => parseArgs(['a.html', '--font-cache'])).toThrow();
  });
  it('localFont: --font-dir の書体を使い、ネットワークから取れなければ理由を添えて投げる (時限 1ms で取れない状態にする)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-fc-'));
    const logs: string[] = [];
    const spec = FONT_SPECS[0];
    // 手元の書体: 中身は何でも読む (判定は取得したものとキャッシュだけ)
    fs.writeFileSync(path.join(dir, 'NotoSerifJP-Regular.ttf'), new Uint8Array([0, 1, 0, 0, ...new Array(20).fill(7)]));
    const buf = await localFont(dir, undefined, (s) => logs.push(s), 1)(spec);
    expect(buf?.byteLength).toBe(24);
    expect(logs).toEqual([]);
    // 別の書体はどこにも無く、1ms では取れない → 投げる (キャッシュには何も書かない)
    const cache = path.join(dir, 'cache');
    const load = localFont(dir, cache, (s) => logs.push(s), 1);
    await expect(load(FONT_SPECS[1])).rejects.toThrow(/書体を取得できません: Noto Sans JP .*--font-dir .*NotoSansJP-Regular\.ttf/);
    expect(fs.existsSync(cache)).toBe(false);
    // 壊れたキャッシュは捨てる (取り直しは 1ms で失敗するので投げるが、ファイルは消えている)
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'NotoSansJP-Bold.ttf'), 'broken');
    await expect(load(FONT_SPECS[2])).rejects.toThrow(/書体を取得できません/);
    expect(fs.existsSync(path.join(cache, 'NotoSansJP-Bold.ttf'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('kumiori/node の部品', () => {
  it('createFileResolver: file: の URL のファイルを読む。root の外・file: でない URL・無いファイルは undefined', async () => {
    const { createFileResolver } = await import('../src/node');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-res-'));
    fs.writeFileSync(path.join(dir, 'a.css'), 'h1{}');
    const url = (p: string) => pathToFileURL(p).href;
    const any = createFileResolver();
    expect(new TextDecoder().decode(any(url(path.join(dir, 'a.css'))))).toBe('h1{}');
    expect(any(url(path.join(dir, 'none.css')))).toBeUndefined();
    expect(any('https://example.com/a.css')).toBeUndefined();
    const inner = createFileResolver({ root: path.join(dir, 'sub') });
    expect(inner(url(path.join(dir, 'a.css')))).toBeUndefined();
  });
  it('createFileResolver の root: 実体のパスで範囲を見る (中のリンクが外を指せば読まない)。root はいくつも渡せる。「..」で始まる名前のファイルは中', async () => {
    const { createFileResolver } = await import('../src/node');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-root-')));
    const url = (p: string) => pathToFileURL(p).href;
    const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
    for (const d of ['a', 'b', 'out', 'a-other']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'a', 'in.css'), 'A');
    fs.writeFileSync(path.join(dir, 'a', '..style.css'), 'DOTS');
    fs.writeFileSync(path.join(dir, 'b', 'in.css'), 'B');
    fs.writeFileSync(path.join(dir, 'out', 'secret.txt'), 'SECRET');
    fs.writeFileSync(path.join(dir, 'a-other', 'x.css'), 'X');
    // root の中のリンク → 外のファイル・外のディレクトリ、外のリンク → 中のファイル、リンクの root
    fs.symlinkSync(path.join(dir, 'out', 'secret.txt'), path.join(dir, 'a', 'link.css'));
    fs.symlinkSync(path.join(dir, 'out'), path.join(dir, 'a', 'outdir'));
    fs.symlinkSync(path.join(dir, 'a', 'in.css'), path.join(dir, 'out', 'back.css'));
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'a-link'));
    const one = createFileResolver({ root: path.join(dir, 'a') });
    expect(text(one(url(path.join(dir, 'a', 'in.css'))))).toBe('A');
    expect(text(one(url(path.join(dir, 'a', '..style.css'))))).toBe('DOTS');
    expect(one(url(path.join(dir, 'a', 'link.css')))).toBeUndefined();
    expect(one(url(path.join(dir, 'a', 'outdir', 'secret.txt')))).toBeUndefined();
    expect(one(url(path.join(dir, 'a', '..', 'out', 'secret.txt')))).toBeUndefined();
    // 名前の頭が同じだけの隣のディレクトリは外。外にあるリンクでも、実体が中なら読む
    expect(one(url(path.join(dir, 'a-other', 'x.css')))).toBeUndefined();
    expect(text(one(url(path.join(dir, 'out', 'back.css'))))).toBe('A');
    // root がリンクなら、その指す先が範囲
    expect(text(createFileResolver({ root: path.join(dir, 'a-link') })(url(path.join(dir, 'a', 'in.css'))))).toBe('A');
    // いくつもの root: どれかの中なら読む。無い root は何も含まない
    const many = createFileResolver({ root: [path.join(dir, 'a'), path.join(dir, 'b'), path.join(dir, 'none')] });
    expect([text(many(url(path.join(dir, 'a', 'in.css')))), text(many(url(path.join(dir, 'b', 'in.css'))))]).toEqual(['A', 'B']);
    expect(many(url(path.join(dir, 'out', 'secret.txt')))).toBeUndefined();
    expect(createFileResolver({ root: [] })(url(path.join(dir, 'a', 'in.css')))).toBeUndefined();
    expect(createFileResolver({ root: path.join(dir, 'none') })(url(path.join(dir, 'a', 'in.css')))).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('createFontLoader: fontDir の書体を読む (cacheDir: null ならキャッシュを使わない)', async () => {
    const { createFontLoader } = await import('../src/node');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-fd-'));
    const spec = { family: 'X', urls: ['https://example.invalid/X-Regular.ttf'] };
    fs.writeFileSync(path.join(dir, 'X-Regular.ttf'), Buffer.from([0, 1, 0, 0, ...new Array(20).fill(0)]));
    const buf = await createFontLoader({ fontDir: dir, cacheDir: null })(spec as never);
    expect(buf?.byteLength).toBe(24);
  });
});
