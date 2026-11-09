/**
 * Node で使う部品: 既定の書体の読み込み (手元の置き場 → キャッシュ → ネットワーク) と、ファイルの参照の読み込み。
 * ファイルシステムを使うので、ブラウザ向けの入口 (index.ts) からは読み込まない。Node のコマンド (cli.ts) と、
 * ライブラリの入口 kumiori/node (node.ts) が使う
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFont } from './api';
import { msg } from './messages';
import type { FontSpec } from './types';

/** ネットワークからの取得の時限 (ミリ秒) */
export const FETCH_TIMEOUT_MS = 30_000;

/** 読んだ既定の書体 (変換ごとに使い回す) */
const fontCache = new Map<string, ArrayBuffer>();

/**
 * 書体のキャッシュの既定の場所: 環境変数 KUMIORI_FONT_CACHE があればそこ。無ければ OS のキャッシュ ディレクトリの kumiori/fonts
 * (Windows: %LOCALAPPDATA%、macOS: ~/Library/Caches、ほか: $XDG_CACHE_HOME か ~/.cache)。home が分からなければ undefined (キャッシュしない)
 */
export function defaultFontCacheDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string | undefined = os.homedir()): string | undefined {
  if (env.KUMIORI_FONT_CACHE) return path.resolve(env.KUMIORI_FONT_CACHE);
  const sub = path.join('kumiori', 'fonts');
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : undefined);
    return base ? path.join(base, sub) : undefined;
  }
  if (platform === 'darwin') return home ? path.join(home, 'Library', 'Caches', sub) : undefined;
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, sub);
  return home ? path.join(home, '.cache', sub) : undefined;
}

/** 書体のファイルらしいか (TrueType・OpenType (CFF)・TrueType Collection の先頭 4 バイト)。途中で切れた取得や壊れたキャッシュを見分ける */
export function looksLikeFont(buf: ArrayBuffer | Uint8Array): boolean {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 12) return false;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0);
}

/** 既定の書体のキャッシュのファイル名 (spec.urls の、ネットワークでない名前。NotoSerifJP-Regular.ttf など) */
function fontFileName(spec: FontSpec): string {
  return path.basename(spec.urls.find((u) => !/^https?:/.test(u)) ?? spec.urls[0]);
}

/**
 * 既定の書体を読む: --font-dir に同じ名前のファイル → 書体のキャッシュ → ネットワーク (Google Fonts) の順。
 * ネットワークから取った書体は、キャッシュに保存する (書体のファイルらしいものだけ。一時ファイルに書いてから名前を変える)。
 * キャッシュに書けなくても変換は続ける (1 度だけ知らせる)。ネットワークからも取れなければ、理由を添えて投げる
 */
export function localFont(fontDir: string | undefined, cacheDir: string | undefined, log: (s: string) => void = (s) => console.error(s), timeoutMs = FETCH_TIMEOUT_MS) {
  let cacheWriteFailed = false;
  const readFile = (p: string): ArrayBuffer | undefined => {
    try {
      const b = fs.readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return undefined;
    }
  };
  return async (spec: FontSpec): Promise<ArrayBuffer | undefined> => {
    // 置き場が違えば別の書体として読む (ライブラリから、置き場を変えて何度も作るときに)
    const key = `${fontDir ?? ''}|${cacheDir ?? ''}|${spec.family}|${spec.weight ?? 400}`;
    const hit = fontCache.get(key);
    if (hit) return hit;
    const names = [...new Set(spec.urls.map((u) => path.basename(u)))];
    const local = fontDir && names.map((n) => path.join(fontDir, n)).find((p) => fs.existsSync(p));
    let buf = local ? readFile(local) : undefined;
    // キャッシュ: 壊れたファイル (途中で切れた取得など) は捨てて取り直す
    const cached = !buf && cacheDir ? names.map((n) => path.join(cacheDir, n)).find((p) => fs.existsSync(p)) : undefined;
    if (cached) {
      buf = readFile(cached);
      if (buf && !looksLikeFont(buf)) {
        buf = undefined;
        try {
          fs.unlinkSync(cached);
        } catch {
          // 消せなくても取り直す
        }
      }
    }
    if (!buf) {
      buf = await fetchFont(spec, timeoutMs);
      if (!buf || !looksLikeFont(buf)) {
        throw new Error(
          msg(
            `書体を取得できません: ${spec.family}${spec.weight && spec.weight !== 400 ? ` (${spec.weight})` : ''} (ネットワークに接続できないときは、--font-dir で手元の書体 (${fontFileName(spec)}) を渡してください)`,
            `cannot fetch the font ${spec.family}${spec.weight && spec.weight !== 400 ? ` (${spec.weight})` : ''} (without network access, pass a local copy (${fontFileName(spec)}) with --font-dir)`,
          ),
        );
      }
      if (cacheDir) {
        const file = path.join(cacheDir, fontFileName(spec));
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, new Uint8Array(buf));
          fs.renameSync(tmp, file);
          log(msg(`書体 ${path.basename(file)} を取得して ${cacheDir} に保存しました`, `fetched the font ${path.basename(file)} and saved it to ${cacheDir}`));
        } catch (e) {
          if (!cacheWriteFailed) log(msg(`書体のキャッシュに書けません: ${cacheDir} (${e instanceof Error ? e.message : String(e)})`, `cannot write to the font cache: ${cacheDir} (${e instanceof Error ? e.message : String(e)})`));
          cacheWriteFailed = true;
        }
      }
    }
    fontCache.set(key, buf);
    return buf;
  };
}

/** createFontLoader の設定 */
export interface FontLoaderOptions {
  /** 既定の書体のファイル (NotoSerifJP-Regular.ttf など) を先に探すディレクトリ */
  fontDir?: string;
  /** ネットワークから取った書体を保存して使い回すディレクトリ。既定は defaultFontCacheDir() (KUMIORI_FONT_CACHE か OS のキャッシュ)。null ならキャッシュしない */
  cacheDir?: string | null;
  /** 保存したこと・保存できなかったことの知らせ。既定は console.error */
  log?: (message: string) => void;
  /** ネットワークからの取得の時限 (ミリ秒)。既定 30000 */
  timeoutMs?: number;
}

/**
 * TypesetOptions.loadFont に渡す、既定の書体の読み込み (Node のコマンドと同じ): fontDir → キャッシュ → ネットワークの順。
 * ネットワークから取った書体はキャッシュに保存し、次からはネットワークに行かない
 *
 *   import { typeset } from 'kumiori';
 *   import { createFontLoader } from 'kumiori/node';
 *   const r = await typeset(html, { loadFont: createFontLoader() });
 */
export function createFontLoader(o: FontLoaderOptions = {}): (spec: FontSpec) => Promise<ArrayBuffer | undefined> {
  const cacheDir = o.cacheDir === null ? undefined : o.cacheDir !== undefined ? path.resolve(o.cacheDir) : defaultFontCacheDir();
  return localFont(o.fontDir, cacheDir, o.log, o.timeoutMs);
}

/**
 * TypesetOptions.resolveResource に渡す、file: の URL の参照を読む関数。ファイルが無ければ undefined (これまでどおりの扱い)。
 * root を渡すと、その中のファイルだけを読む (他人の書いた文書を組むときに、ほかの場所のファイルを読ませない)
 */
export function createFileResolver(o: { root?: string } = {}): (url: string) => Uint8Array | undefined {
  const root = o.root ? path.resolve(o.root) : undefined;
  return (url) => {
    if (!/^file:/i.test(url)) return undefined;
    let p: string;
    try {
      p = fileURLToPath(url);
    } catch {
      return undefined;
    }
    if (root && path.relative(root, p).startsWith('..')) return undefined;
    try {
      return fs.statSync(p).isFile() ? new Uint8Array(fs.readFileSync(p)) : undefined;
    } catch {
      return undefined;
    }
  };
}
