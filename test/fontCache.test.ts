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
