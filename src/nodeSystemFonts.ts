/**
 * Node で、OS の書体の場所 (Linux などの fontconfig の設定・Windows・macOS の書体のフォルダ) を探し、字の範囲の索引を作って、
 * 読み込んだどの書体にも字形の無い字を持つ書体を選ぶ部品 (TypesetOptions.systemFonts に渡す SystemFontSource)。
 * CSS Fonts 4 §5.2 (Matching font styles) の手順の最後: どの書体にも無い字は、処理系の後備の書体 (system font fallback) で組んでよい。
 * ファイルシステムを使うので、ブラウザ向けの入口 (index.ts) からは読み込まない (kumiori/node の node.ts が出す)。
 *
 * 書体のファイルは全部を読まず、表の目次と、要る表 (cmap・name・OS/2) だけを読む (書体の全部を開くより、ずっと速い)。
 * 索引は部品が持ち、初めて find を呼んだときに 1 度だけ作る (ディスクには覚えない)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Parser } from 'htmlparser2';
import { extractFromCollection } from './fontLoader';
import { classifyFontKind, kindRank } from './fontKind';
import { rejoin, thisCall } from './callContext';
import { limits } from './limits';
import { msg } from './messages';
import type { SystemFontKind, SystemFontMatch, SystemFontRequest, SystemFontSource } from './types';

/** createSystemFonts の設定 */
export interface SystemFontOptions {
  /**
   * 探すディレクトリ (文字列の配列)。省略すれば systemFontDirs() (OS の書体の場所)。試験や、探す所を絞るときに。
   * 相対の道は、createSystemFonts を呼んだときのカレントディレクトリから決める。空の配列なら、どこも探さない
   */
  dirs?: readonly string[];
  /** 探すファイルの数の上限 (既定 20000)。超えた分は探さない */
  maxFiles?: number;
}

/** 探すファイルの数の上限の既定 */
const DEFAULT_MAX_FILES = 20_000;
/** ディレクトリを下へたどる段の上限 */
const MAX_DEPTH = 16;
/**
 * 見るディレクトリの数の上限。fontconfig の設定に <dir>~</dir> のような広い場所があると、家のディレクトリの全体をたどるので、
 * 書体のファイルの数 (maxFiles) と段 (MAX_DEPTH) のほかに、ディレクトリの数も限る
 */
const MAX_DIRS = 10_000;
/** 索引を作る間に、イベントループを空ける間隔 (ディレクトリかファイルを、この数だけ見るごと) */
const SCAN_YIELD_EVERY = 64;
/** 1 つのファイルから読む表 (cmap・name) の大きさの上限。壊れた目次で大きな読みを起こさない */
const MAX_TABLE_BYTES = 16 * 1024 * 1024;
/** fontconfig の設定の include の入れ子の上限 */
const MAX_INCLUDE_DEPTH = 8;
/** 書体のファイルの拡張子 (Kumiori が組める形: TrueType・OpenType とその集まり) */
const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

// ───────────────────────── OS の書体の場所 ─────────────────────────

/**
 * OS の書体の場所。環境変数・OS・home を引数で差し替えられる (試験のため)。
 *  - Windows: %WINDIR%\Fonts と、利用者ごとに入れた書体の %LOCALAPPDATA%\Microsoft\Windows\Fonts
 *  - macOS: /System/Library/Fonts・/Library/Fonts・~/Library/Fonts (後から取り込む書体の置き場は探さない)
 *  - ほか (Linux など): fontconfig の設定 (FONTCONFIG_FILE → FONTCONFIG_PATH の fonts.conf → /etc/fonts/fonts.conf) の <dir>。
 *    設定のファイルが無ければ、XDG Base Directory の決まりの $XDG_DATA_HOME/fonts・$XDG_DATA_DIRS の各 fonts と ~/.fonts
 */
export function systemFontDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string | undefined = os.homedir()): string[] {
  if (platform === 'win32') {
    const w = path.win32;
    const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
    const local = env.LOCALAPPDATA || (home ? w.join(home, 'AppData', 'Local') : undefined);
    return [w.join(windir, 'Fonts'), ...(local ? [w.join(local, 'Microsoft', 'Windows', 'Fonts')] : [])];
  }
  const p = path.posix;
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', ...(home ? [p.join(home, 'Library', 'Fonts')] : [])];
  const conf = fontconfigFile(env);
  const fromConf = conf ? fontconfigDirs(conf, env, home) : undefined;
  if (fromConf) return fromConf;
  const dataHome = env.XDG_DATA_HOME || (home ? p.join(home, '.local', 'share') : undefined);
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [...(dataHome ? [p.join(dataHome, 'fonts')] : []), ...dataDirs.map((d) => p.join(d, 'fonts')), ...(home ? [p.join(home, '.fonts')] : [])];
}

/** fontconfig の設定のファイル (fonts-conf(5) の環境変数の節: FONTCONFIG_FILE、FONTCONFIG_PATH、既定の /etc/fonts/fonts.conf) */
function fontconfigFile(env: NodeJS.ProcessEnv): string | undefined {
  if (env.FONTCONFIG_FILE) return path.resolve(env.FONTCONFIG_FILE);
  for (const d of (env.FONTCONFIG_PATH ?? '').split(':').filter(Boolean)) {
    const f = path.join(d, 'fonts.conf');
    if (fs.existsSync(f)) return f;
  }
  return '/etc/fonts/fonts.conf';
}

/**
 * fontconfig の設定から、書体のディレクトリ (<dir>) を集める。読むのは <dir> と <include> だけ (fonts-conf(5) の
 * 「CONFIGURATION FILE FORMAT」)。<selectfont>・<match> などは見ない。設定のファイルが読めなければ undefined
 */
function fontconfigDirs(file: string, env: NodeJS.ProcessEnv, home: string | undefined): string[] | undefined {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const xdg = (v: string | undefined, sub: string[]) => v || (home ? path.join(home, ...sub) : undefined);
  const expand = (text: string, prefix: string | undefined, base: string, xdgBase: string | undefined): string | undefined => {
    if (text.startsWith('~')) return home ? path.join(home, text.slice(1)) : undefined;
    if (prefix === 'xdg') return xdgBase ? path.join(xdgBase, text) : undefined;
    if (path.isAbsolute(text)) return text;
    // relative は設定のファイルの場所、default・cwd は作業のディレクトリ (fontconfig と同じ)
    return prefix === 'relative' ? path.join(base, text) : path.resolve(text);
  };
  const read = (f: string, depth: number): boolean => {
    let real: string;
    let text: string;
    try {
      real = fs.realpathSync(f);
      if (seen.has(real)) return true;
      seen.add(real);
      text = fs.readFileSync(real, 'utf8');
    } catch {
      return false;
    }
    const base = path.dirname(f);
    const items: Array<{ name: string; attrs: Record<string, string>; text: string }> = [];
    let cur: { name: string; attrs: Record<string, string>; text: string } | undefined;
    const parser = new Parser(
      {
        onopentag(name, attrs) {
          if (name === 'dir' || name === 'include') cur = { name, attrs, text: '' };
        },
        ontext(t) {
          if (cur) cur.text += t;
        },
        onclosetag(name) {
          if (cur && name === cur.name) {
            items.push(cur);
            cur = undefined;
          }
        },
      },
      { xmlMode: true, decodeEntities: true },
    );
    parser.write(text);
    parser.end();
    for (const it of items) {
      const t = it.text.trim();
      if (!t) continue;
      if (it.name === 'dir') {
        const d = expand(t, it.attrs.prefix, base, xdg(env.XDG_DATA_HOME, ['.local', 'share']));
        if (d && !dirs.includes(d)) dirs.push(d);
      } else if (depth < MAX_INCLUDE_DEPTH) {
        // include の相対の道は、設定のファイルの場所から (prefix="xdg" なら $XDG_CONFIG_HOME から)
        const target = expand(t, it.attrs.prefix === 'xdg' ? 'xdg' : 'relative', base, xdg(env.XDG_CONFIG_HOME, ['.config']));
        if (!target) continue;
        let st: fs.Stats | undefined;
        try {
          st = fs.statSync(target);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          // ディレクトリなら、数字で始まり .conf で終わるファイルを、名前の順に
          let names: string[] = [];
          try {
            names = fs.readdirSync(target).filter((n) => /^[0-9].*\.conf$/.test(n)).sort();
          } catch {
            // 読めないディレクトリは飛ばす
          }
          for (const n of names) read(path.join(target, n), depth + 1);
        } else if (st.isFile()) read(target, depth + 1);
      }
    }
    return true;
  };
  return read(file, 0) ? dirs : undefined;
}

// ───────────────────────── 書体の表の読み ─────────────────────────

/** 索引の 1 つの書体 */
export interface SystemFace {
  /** ファイルの実体のパス */
  file: string;
  /** TTC の中の番号 (TTC でなければ 0) */
  index: number;
  collection: boolean;
  /** ファイルの大きさと更新の時刻 (読むときに、索引を作ったときと同じかを見る) */
  size: number;
  mtimeMs: number;
  /** ファミリー名 (英語の nameID 16、無ければ 1) */
  family: string;
  /** OS/2 の値 (表が無ければ既定の値) */
  weight: number;
  width: number;
  italic: boolean;
  fsType: number;
  /** OS/2 の ulCodePageRange1 (言語の手がかり) */
  codePages: number;
  /** OS/2 の sFamilyClass と panose (書体の種類の手がかり) */
  familyClass: number;
  panose: number[];
  /** 書体の種類 (fontKind.ts の classifyFontKind: panose → sFamilyClass → 名前) */
  kind: SystemFontKind;
  /** 輪郭の表 (glyf・CFF ・CFF2) があるか */
  outlines: boolean;
  /** 字の範囲 (始まりと終わりの符号位置の組を並べたもの。符号位置の順で重ならない) */
  ranges: Uint32Array;
}

/** ファイルの pos から len バイト (ファイルの外なら undefined) */
function readAt(fd: number, size: number, pos: number, len: number): Buffer | undefined {
  if (pos < 0 || len < 0 || pos + len > size) return undefined;
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (n <= 0) return undefined;
    got += n;
  }
  return b;
}

/** 書体の 1 つ (sfnt の頭が off にあるもの) の表を読む。読めなければ undefined */
function readFace(fd: number, size: number, off: number): Omit<SystemFace, 'file' | 'index' | 'collection' | 'size' | 'mtimeMs'> | undefined {
  const head = readAt(fd, size, off, 12);
  if (!head) return undefined;
  const n = head.readUInt16BE(4);
  const dir = readAt(fd, size, off + 12, n * 16);
  if (!dir) return undefined;
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) tables.set(dir.toString('latin1', i * 16, i * 16 + 4), { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) });
  const table = (tag: string) => {
    const t = tables.get(tag);
    return t && t.length <= MAX_TABLE_BYTES ? readAt(fd, size, t.offset, t.length) : undefined;
  };
  const cmap = table('cmap');
  if (!cmap) return undefined;
  const ranges = cmapRanges(cmap);
  if (!ranges) return undefined;
  const family = nameOf(table('name'));
  if (!family) return undefined;
  const os2 = table('OS/2');
  const u16 = (b: Buffer | undefined, at: number, d: number) => (b && b.length >= at + 2 ? b.readUInt16BE(at) : d);
  const panose = os2 && os2.length >= 42 ? [...os2.subarray(32, 42)] : [];
  const familyClass = u16(os2, 30, 0);
  return {
    family,
    weight: u16(os2, 4, 400),
    width: u16(os2, 6, 5),
    fsType: u16(os2, 8, 0),
    familyClass,
    panose,
    kind: classifyFontKind({ panose, familyClass, family }),
    italic: (u16(os2, 62, 0) & 1) !== 0,
    codePages: os2 && os2.length >= 82 ? os2.readUInt32BE(78) : 0,
    outlines: (tables.has('glyf') && tables.has('loca')) || tables.has('CFF ') || tables.has('CFF2'),
    ranges,
  };
}

/**
 * cmap の表 (OpenType 1.9 の cmap) から、字形のある字の範囲。Unicode の部分表を選ぶ: format 12 (platform 3 の encoding 10、platform 0)、
 * 無ければ format 4 (platform 3 の encoding 1、platform 0)。字形の番号 0 (.notdef) に当たる字は除く。
 * format 13 (多くの字を 1 つの字形に当てる、最後の手段の書体のもの) は、字を持つとは数えない
 */
function cmapRanges(b: Buffer): Uint32Array | undefined {
  if (b.length < 4) return undefined;
  const n = b.readUInt16BE(2);
  let best: { rank: number; at: number } | undefined;
  for (let i = 0; i < n && 4 + i * 8 + 8 <= b.length; i++) {
    const r = 4 + i * 8;
    const pid = b.readUInt16BE(r);
    const eid = b.readUInt16BE(r + 2);
    const at = b.readUInt32BE(r + 4);
    if (at + 2 > b.length) continue;
    const format = b.readUInt16BE(at);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    if (!unicode) continue;
    const rank = format === 12 ? 2 : format === 4 ? 1 : 0;
    if (rank && (!best || rank > best.rank)) best = { rank, at };
  }
  if (!best) return undefined;
  const out: number[] = [];
  const push = (s: number, e: number) => {
    if (out.length && out[out.length - 1] + 1 >= s) out[out.length - 1] = Math.max(out[out.length - 1], e);
    else out.push(s, e);
  };
  const at = best.at;
  if (best.rank === 2) {
    if (at + 16 > b.length) return undefined;
    const groups = b.readUInt32BE(at + 12);
    const list: Array<[number, number, number]> = [];
    for (let g = 0; g < groups && at + 16 + g * 12 + 12 <= b.length; g++) {
      const p = at + 16 + g * 12;
      list.push([b.readUInt32BE(p), b.readUInt32BE(p + 4), b.readUInt32BE(p + 8)]);
    }
    list.sort((x, y) => x[0] - y[0]);
    for (const [s, e, gid] of list) {
      if (e < s || s > 0x10ffff) continue;
      // 字形の番号 0 から始まる組は、その始まりの字だけが .notdef
      const from = gid === 0 ? s + 1 : s;
      if (from <= e) push(from, Math.min(e, 0x10ffff));
    }
  } else {
    if (at + 14 > b.length) return undefined;
    const segX2 = b.readUInt16BE(at + 6);
    const ends = at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const offsets = deltas + segX2;
    if (offsets + segX2 > b.length) return undefined;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = b.readUInt16BE(ends + s * 2);
      const start = b.readUInt16BE(starts + s * 2);
      const delta = b.readInt16BE(deltas + s * 2);
      const ro = b.readUInt16BE(offsets + s * 2);
      if (start > end) continue;
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (ro === 0) gid = (c + delta) & 0xffff;
        else {
          const p = offsets + s * 2 + ro + (c - start) * 2;
          if (p + 2 > b.length) break;
          gid = b.readUInt16BE(p);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) push(c, c);
      }
    }
  }
  return out.length ? Uint32Array.from(out) : undefined;
}

/**
 * name の表から、英語のファミリー名 (nameID 16、無ければ 1。OpenType の name の表の nameID 1・16)。Windows (platform 3) の英語、Mac (platform 1) の英語、
 * Windows のほかの言語の順に探し、同じ言語の中では nameID 16 を先にする (前は nameID を先に見たので、英語でない nameID 16 を英語の nameID 1 より先に選んだ)
 */
function nameOf(b: Buffer | undefined): string | undefined {
  if (!b || b.length < 6) return undefined;
  const count = b.readUInt16BE(2);
  const strings = b.readUInt16BE(4);
  const found = new Map<string, string>();
  for (let i = 0; i < count && 6 + i * 12 + 12 <= b.length; i++) {
    const r = 6 + i * 12;
    const pid = b.readUInt16BE(r);
    const eid = b.readUInt16BE(r + 2);
    const lang = b.readUInt16BE(r + 4);
    const id = b.readUInt16BE(r + 6);
    const len = b.readUInt16BE(r + 8);
    const off = strings + b.readUInt16BE(r + 10);
    if ((id !== 16 && id !== 1) || off + len > b.length) continue;
    let rank: number;
    let text: string;
    if (pid === 3 && (eid === 1 || eid === 10)) {
      rank = lang === 0x409 ? 0 : 2;
      const s = b.subarray(off, off + len);
      text = '';
      for (let k = 0; k + 1 < s.length; k += 2) text += String.fromCharCode(s.readUInt16BE(k));
    } else if (pid === 1 && eid === 0 && lang === 0) {
      rank = 1;
      text = b.toString('latin1', off, off + len);
    } else continue;
    const key = `${id === 16 ? 0 : 1}|${rank}`;
    if (text && !found.has(key)) found.set(key, text);
  }
  for (const rank of [0, 1, 2]) for (const id of [0, 1]) if (found.has(`${id}|${rank}`)) return found.get(`${id}|${rank}`);
  return undefined;
}

/** 1 つのファイルの書体 (TTC なら中の書体の全部)。読めなければ空 */
export function readFontFile(file: string, st: fs.Stats): SystemFace[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = readAt(fd, st.size, 0, 12);
    if (!head) return [];
    const tag = head.toString('latin1', 0, 4);
    const collection = tag === 'ttcf';
    let offsets = [0];
    if (collection) {
      const n = head.readUInt32BE(8);
      const list = n <= 4096 ? readAt(fd, st.size, 12, n * 4) : undefined;
      if (!list) return [];
      offsets = Array.from({ length: n }, (_, i) => list.readUInt32BE(i * 4));
    } else if (!(tag === 'OTTO' || tag === 'true' || head.readUInt32BE(0) === 0x00010000)) return [];
    const out: SystemFace[] = [];
    offsets.forEach((off, index) => {
      const f = readFace(fd!, st.size, off);
      if (f) out.push({ ...f, file, index, collection, size: st.size, mtimeMs: st.mtimeMs });
    });
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * dirs の下の書体を探して、索引にする。リンクはたどるが、実体のパスで、同じディレクトリ・ファイルは 1 度だけ見る (循環で止まらない)。
 * 下へたどるのは MAX_DEPTH 段まで、見るディレクトリは MAX_DIRS まで。ふつうのファイルだけを開く (FIFO などは開かない)。
 * 大きすぎるファイル (TTF・OTF は limits.fontBytes、TTC・OTC は limits.fontCollectionBytes を超えるもの) は入れない
 */
export function scanSystemFonts(dirs: readonly string[], maxFiles = DEFAULT_MAX_FILES): SystemFace[] {
  const steps = scanSteps(dirs, maxFiles);
  for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value;
}

/**
 * scanSystemFonts と同じ索引を、SCAN_YIELD_EVERY 個ごとにイベントループを空けながら作る (書体の多い機械で、索引を作る間、
 * ほかの仕事 (画面・ほかの呼び出し) を止めない)
 */
export async function scanSystemFontsAsync(dirs: readonly string[], maxFiles = DEFAULT_MAX_FILES): Promise<SystemFace[]> {
  const steps = scanSteps(dirs, maxFiles);
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    rejoin(thisCall(), await new Promise<void>((done) => setImmediate(done)));
  }
}

/** 索引を作る手順 (SCAN_YIELD_EVERY 個のディレクトリ・ファイルを見るごとに yield する) */
function* scanSteps(dirs: readonly string[], maxFiles: number): Generator<void, SystemFace[]> {
  const seenDirs = new Set<string>();
  const seenFiles = new Set<string>();
  const faces: SystemFace[] = [];
  // 上限は初めに読む (間を空けた後も、同じ上限で見る)
  const maxFont = limits().fontBytes;
  const maxCollection = limits().fontCollectionBytes;
  let files = 0;
  let seen = 0;
  function* walk(dir: string, depth: number): Generator<void, void> {
    if (depth > MAX_DEPTH || files >= maxFiles || seenDirs.size >= MAX_DIRS) return;
    let real: string;
    let names: string[];
    try {
      real = fs.realpathSync(dir);
      if (seenDirs.has(real)) return;
      seenDirs.add(real);
      names = fs.readdirSync(real).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (files >= maxFiles) return;
      if (++seen % SCAN_YIELD_EVERY === 0) yield;
      const p = path.join(real, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) yield* walk(p, depth + 1);
      else if (st.isFile() && FONT_FILE.test(name)) {
        let file: string;
        try {
          file = fs.realpathSync(p);
        } catch {
          continue;
        }
        if (seenFiles.has(file)) continue;
        seenFiles.add(file);
        files++;
        const max = /\.(ttc|otc)$/i.test(name) ? maxCollection : maxFont;
        if (st.size > max) continue;
        faces.push(...readFontFile(file, st));
      }
    }
  }
  for (const d of dirs) yield* walk(d, 0);
  return faces;
}

/** 書体のファイルが、索引を作った後に変わった (faceData)。索引を作り直す合図 */
class FaceChangedError extends Error {}

/** 字の範囲 (ranges) が cp を持つか (二分探索) */
export function coversCodePoint(ranges: Uint32Array, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid * 2]) hi = mid - 1;
    else if (cp > ranges[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * PDF に埋め込めるか (OpenType 1.9 の OS/2 の fsType): 0x0002 (Restricted License embedding)・0x0200 (Bitmap embedding only) は埋め込めない。
 * 0x0100 (No subsetting) も選ばない (Kumiori は、既定では字の部分集合にして埋め込む)。
 * 使い方の印 (bit 0〜3) が重なっているときは、いちばん緩い印に従う (同じ節: 古い書体は Restricted と Preview & Print を両方立てることがある)
 */
export function embeddableFsType(fsType: number): boolean {
  const restricted = (fsType & 0x0002) !== 0 && (fsType & 0x000c) === 0;
  return !restricted && (fsType & 0x0300) === 0;
}

/** 文書の言語に合う、OS/2 の ulCodePageRange1 の印 (bit 17 日本語・18 簡体字・20 繁体字・19 と 21 韓国語) */
function codePageBits(lang: string | undefined): number {
  const l = (lang ?? 'ja').toLowerCase();
  if (/^zh(-hant|-tw|-hk|-mo)/.test(l)) return 1 << 20;
  if (/^zh/.test(l)) return 1 << 18;
  if (/^ko/.test(l)) return (1 << 19) | (1 << 21);
  if (/^ja/.test(l)) return 1 << 17;
  return 1 << 17;
}

const HAN = /\p{Script=Han}/u;

/**
 * 字 (cps) を、なるべく少ない書体で覆う (貪欲法: 残りの字をいちばん多く持つ書体を選び、その字を除いて繰り返す)。
 * 持つ字の数が同じなら、漢字を含むときは文書の言語の印を持つ書体、太さが 400 に近い・傾いていない・幅が普通の書体、実体のパスと TTC の番号の順。
 * 返すのは、選んだ書体と、それが受け持つ字。覆えなかった字は残る (rest)
 */
export function pickFaces(faces: readonly SystemFace[], cps: readonly number[], lang: string | undefined, maxFaces: number): { picks: Array<{ face: SystemFace; cps: number[] }>; rest: number[] } {
  let rest = [...cps];
  const picks: Array<{ face: SystemFace; cps: number[] }> = [];
  const bits = codePageBits(lang);
  const shape = (f: SystemFace) => Math.abs(f.weight - 400) + (f.italic ? 1000 : 0) + Math.abs(f.width - 5) * 100;
  while (rest.length && picks.length < maxFaces) {
    const han = rest.some((cp) => HAN.test(String.fromCodePoint(cp)));
    let best: { face: SystemFace; cps: number[] } | undefined;
    for (const f of faces) {
      if (picks.some((p) => p.face === f)) continue;
      const got = rest.filter((cp) => coversCodePoint(f.ranges, cp));
      if (!got.length) continue;
      if (!best || better(f, got.length, best.face, best.cps.length)) best = { face: f, cps: got };
    }
    if (!best) break;
    picks.push(best);
    const taken = new Set(best.cps);
    rest = rest.filter((cp) => !taken.has(cp));
    function better(a: SystemFace, na: number, b: SystemFace, nb: number): boolean {
      if (na !== nb) return na > nb;
      if (han) {
        const la = (a.codePages & bits) !== 0;
        const lb = (b.codePages & bits) !== 0;
        if (la !== lb) return la;
      }
      const sa = shape(a);
      const sb = shape(b);
      if (sa !== sb) return sa < sb;
      if (a.file !== b.file) return a.file < b.file;
      return a.index < b.index;
    }
  }
  return { picks, rest };
}

/**
 * 書体の種類 kind の求めに、字 (cps) を覆う書体を選ぶ: その種類の書体だけで pickFaces で選び、覆えなかった字は、種類の分からない書体、
 * serif と sans の残りの方、other の順に補う (fontKind.ts の kindRank の順位ごと)
 */
function pickForKind(faces: readonly SystemFace[], cps: readonly number[], kind: SystemFontKind, lang: string | undefined): Array<{ face: SystemFace; cps: number[] }> {
  const picks: Array<{ face: SystemFace; cps: number[] }> = [];
  let rest = [...cps];
  for (const rank of [0, 1, 2, 3]) {
    if (!rest.length) break;
    const r = pickFaces(
      faces.filter((f) => kindRank(kind, f.kind) === rank),
      rest,
      lang,
      Infinity,
    );
    picks.push(...r.picks);
    rest = r.rest;
  }
  return picks;
}

/**
 * 種類ごとに選んだ書体を 1 つの並びにまとめる。maxFaces に達するまで、どの種類にも 1 つずつ順に割り当てる (種類の並びの順。
 * 既定は serif → sans)。同じ書体がいくつかの種類に選ばれたら 1 つにまとめ、受け持つ字は合わせる
 */
function mergeKinds(lists: ReadonlyArray<{ kind: SystemFontKind; picks: Array<{ face: SystemFace; cps: number[] }> }>, maxFaces: number): Array<{ face: SystemFace; cps: number[]; forKind: SystemFontKind }> {
  const out: Array<{ face: SystemFace; cps: number[]; forKind: SystemFontKind }> = [];
  const longest = Math.max(0, ...lists.map((l) => l.picks.length));
  for (let i = 0; i < longest; i++)
    for (const l of lists) {
      const p = l.picks[i];
      if (!p) continue;
      const have = out.find((o) => o.face === p.face);
      if (have) have.cps = [...new Set([...have.cps, ...p.cps])].sort((a, b) => a - b);
      else if (out.length < maxFaces) out.push({ face: p.face, cps: [...p.cps], forKind: l.kind });
    }
  return out;
}

/** 知らせに出す名前 */
const faceName = (f: SystemFace) => `${f.family} (${path.basename(f.file)}${f.collection ? ` #${f.index}` : ''})`;

/**
 * 書体の中身を読む。索引を作った後にファイルが変わっていれば (大きさ・更新の時刻が違えば) 読まない。
 * 消された・ディレクトリになったなど、開けないファイル (ENOENT・ENOTDIR・EISDIR) も、変わったファイルとして扱う
 * (索引を作り直す合図にする。前は、消した書体を、器を作り直すまで選び続けた)
 */
function faceData(f: SystemFace): ArrayBuffer {
  let fd: number;
  try {
    fd = fs.openSync(f.file, 'r');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')
      throw new FaceChangedError(msg(`OS の書体のファイルが、探した後に無くなりました: ${f.file}`, `the OS font file disappeared after it was scanned: ${f.file}`));
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size !== f.size || st.mtimeMs !== f.mtimeMs)
      throw new FaceChangedError(msg(`OS の書体のファイルが、探した後に変わりました: ${f.file}`, `the OS font file changed after it was scanned: ${f.file}`));
    const b = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = fs.readSync(fd, b, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    let buf = b.buffer.slice(b.byteOffset, b.byteOffset + got) as ArrayBuffer;
    if (f.collection) buf = extractFromCollection(buf, f.index);
    if (buf.byteLength > limits().fontBytes) throw new Error(msg(`OS の書体が大きすぎます: ${f.file}`, `the OS font is too large: ${f.file}`));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * OS の書体を探す部品 (TypesetOptions.systemFonts に渡す)。字の範囲の索引は、初めて find を呼んだときに作り、この部品が持つ
 * (器 (createTypesetter) やコマンドの --watch で、1 つの部品を使い回せば、索引を作るのは 1 度だけ)。索引は、間をあけながら作り
 * (書体の多い機械でもイベントループを長く止めない)、止める合図 (signal) が来たら待つのをやめる。索引を作った後に書体のファイルが
 * 変わったと分かったら (書体を読むときに、大きさ・更新の時刻が違う)、次の find で作り直す。
 *
 *   import { createTypesetter } from 'kumiori';
 *   import { createSystemFonts } from 'kumiori/node';
 *   const t = await createTypesetter({ systemFonts: createSystemFonts() });
 */
export function createSystemFonts(o: SystemFontOptions = {}): SystemFontSource {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new TypeError(msg('createSystemFonts の設定はオブジェクトです', 'createSystemFonts: the options must be an object'));
  const maxFiles = o.maxFiles ?? DEFAULT_MAX_FILES;
  if (!Number.isInteger(maxFiles) || maxFiles < 0) throw new TypeError(msg('createSystemFonts の maxFiles は 0 以上の整数です', 'createSystemFonts: maxFiles must be an integer of 0 or more'));
  // dirs は文字列の配列 (文字列そのものを広げると 1 字ずつの道になり、ルート (/) からファイルシステムの全体を探してしまう)。
  // 空の文字列は誤り (カレントディレクトリを黙って探さない)。相対の道は、いま (部品を作ったとき) のカレントディレクトリから決める
  // (探すのは初めて find を呼んだときなので、その間にカレントディレクトリが変わっても、探す所を変えない)
  let dirs: string[] | undefined;
  if (o.dirs !== undefined) {
    if (!Array.isArray(o.dirs)) throw new TypeError(msg('createSystemFonts の dirs は、ディレクトリの道の文字列の配列です', 'createSystemFonts: dirs must be an array of directory path strings'));
    dirs = (o.dirs as readonly unknown[]).map((d) => {
      if (typeof d !== 'string' || !d) throw new TypeError(msg('createSystemFonts の dirs の項は、空でない文字列です', 'createSystemFonts: each item of dirs must be a non-empty string'));
      return path.resolve(d);
    });
  }
  let index: SystemFace[] | undefined;
  /** 作っている索引 (同時に呼んだ find は、同じものを待つ) */
  let building: Promise<SystemFace[]> | undefined;
  /** 索引 (無ければ作る)。止める合図が来たら、待つのをやめる (作るのは続け、次の find で使う) */
  const indexFor = async (signal: AbortSignal | undefined): Promise<SystemFace[]> => {
    if (index) return index;
    if (!building) {
      const b = scanSystemFontsAsync(dirs ?? systemFontDirs(), maxFiles).then(
        (faces) => {
          if (building === b) index = faces;
          return faces;
        },
      );
      b.finally(() => {
        if (building === b) building = undefined;
      }).catch(() => {});
      building = b;
    }
    const b = building;
    if (!signal) return b;
    signal.throwIfAborted();
    return new Promise<SystemFace[]>((ok, ng) => {
      const onAbort = () => ng(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      b.then(
        (v) => {
          signal.removeEventListener('abort', onAbort);
          ok(v);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          ng(e);
        },
      );
    });
  };
  return {
    async find(request: SystemFontRequest): Promise<SystemFontMatch[]> {
      request.signal?.throwIfAborted();
      const all = rejoin(thisCall(), await indexFor(request.signal));
      request.signal?.throwIfAborted();
      const cps = [...new Set(request.chars.map((c) => c.codePointAt(0)!))].sort((a, b) => a - b);
      const usable = all.filter((f) => f.outlines && embeddableFsType(f.fsType));
      // 種類ごと (既定は serif と sans) に選び、まとめる (書体の種類を合わせる: 組版は、指定の書体と同じ種類の書体を先に使う)
      const kinds: SystemFontKind[] = request.kinds?.length ? [...new Set(request.kinds)] : ['serif', 'sans'];
      // 種類ごとに探す字 (charsByKind。その種類の文脈に出る字だけ。chars に無い字は探さない)
      const cpsFor = (kind: SystemFontKind) => {
        const only = request.charsByKind?.[kind];
        if (!only) return cps;
        const want = new Set(only.map((c) => c.codePointAt(0)!));
        return cps.filter((cp) => want.has(cp));
      };
      const perKind = kinds.map((kind) => ({ kind, picks: pickForKind(usable, cpsFor(kind), kind, request.lang) }));
      const picks = mergeKinds(perKind, request.maxFaces ?? Infinity);
      // 埋め込める書体のどれも持たない字を、埋め込めない書体が持つか (知らせるためだけに返す)。書体の数の上限 (maxFaces) で選ばなかった
      // 埋め込める書体が持つ字は入れない (埋め込めないことが、字の無い理由ではないので)
      const coverable = new Set(perKind.flatMap((k) => k.picks.flatMap((p) => p.cps)));
      const rest = cps.filter((cp) => !coverable.has(cp));
      const refused = rest.length ? pickFaces(all.filter((f) => f.outlines && !embeddableFsType(f.fsType)), rest, request.lang, Infinity).picks.map((p) => ({ ...p, forKind: p.face.kind })) : [];
      const match = (p: { face: SystemFace; cps: number[]; forKind: SystemFontKind }, embeddable: boolean): SystemFontMatch => ({
        key: `${p.face.file}|${p.face.index}|${p.face.size}|${p.face.mtimeMs}`,
        name: faceName(p.face),
        chars: p.cps.map((cp) => String.fromCodePoint(cp)),
        kind: p.face.kind,
        forKind: p.forKind,
        embeddable,
        data: () => {
          try {
            return Promise.resolve(faceData(p.face));
          } catch (e) {
            // 索引を作った後に書体のファイルが変わった (OS の書体を入れ直したなど): 次に探すときに索引を作り直す
            // (長く使う器・--watch で、同じ誤りを文書ごとに出し続けない)
            if (e instanceof FaceChangedError && index === all) index = undefined;
            return Promise.reject(e);
          }
        },
      });
      return [...picks.map((p) => match(p, true)), ...refused.map((p) => match(p, false))];
    },
  };
}
