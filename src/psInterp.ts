/**
 * psInterp — PostScript の言語の中心 (字句・オブジェクト・スタック・実行・辞書・save/restore・エラー・ファイル)。
 *
 * PostScript Language Reference, third edition (Adobe, 1999。以下 PLRM) の第 3 章と第 8 章の演算子の説明から書いた。
 * EPS (Encapsulated PostScript) を図形にするためのもので、出力機器の制御 (第 6 章) は持たない。
 * ファイルの書き込みと名前付きファイルの読み込みも持たない (外から受け取ったプログラムが、手元のファイルに触れないように)。
 * 図形の演算子は psGraphics.ts が足す。
 */
import { FilterError, UnsupportedFilter, filterSource, type ByteSource } from './psFilters';
import { PS_FILTER_MAX_BYTES, PS_MAX_MEMORY_BYTES, PS_MAX_VM_BYTES } from './imageLimits';

// ───────────────────────── オブジェクト (PLRM §3.3) ─────────────────────────

export type Access = 'unlimited' | 'readonly' | 'executeonly' | 'none';

export interface PSString {
  t: 'string';
  /** 値 (getinterval で作った文字列は、元の文字列と値を共有する) */
  b: Uint8Array;
  o: number;
  n: number;
  x: boolean;
  acc?: Access;
}
export interface PSArray {
  t: 'array';
  a: PSObj[];
  o: number;
  n: number;
  x: boolean;
  packed?: boolean;
  acc?: Access;
}
export interface PSDictObj {
  t: 'dict';
  d: PSDict;
}
export interface PSOperator {
  t: 'operator';
  name: string;
  fn: (I: Interp) => void;
  x: boolean;
  /**
   * 取るオペランドの個数 (の上限)。callOperator がエラーのときに戻すために写す分 (§3.11.1)。
   * 無ければ 8 個を写す。手続きを実行する演算子 (exec・if・forall・show など) には付けない (中で何個取られるか分からない)
   */
  n?: number;
}
export interface PSFileObj {
  t: 'file';
  f: PSFile;
  x: boolean;
}
export type PSObj =
  | { t: 'null'; x?: boolean }
  | { t: 'mark' }
  | { t: 'int'; v: number }
  | { t: 'real'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'name'; v: string; x: boolean }
  | PSString
  | PSArray
  | PSDictObj
  | PSOperator
  | PSFileObj
  | { t: 'save'; s: SaveRec }
  | { t: 'gstate'; g: unknown }
  | { t: 'fontid'; v: unknown };

export const NULL: PSObj = { t: 'null' };
export const MARK: PSObj = { t: 'mark' };
export const TRUE: PSObj = { t: 'bool', v: true };
export const FALSE: PSObj = { t: 'bool', v: false };
export const int = (v: number): PSObj => ({ t: 'int', v: v | 0 });
export const real = (v: number): PSObj => ({ t: 'real', v });
export const bool = (v: boolean): PSObj => (v ? TRUE : FALSE);
export const name = (v: string, x = false): PSObj => ({ t: 'name', v, x });
export const num = (v: number): PSObj => (Number.isInteger(v) && Math.abs(v) <= 0x7fffffff ? int(v) : real(v));
export const str = (s: string | Uint8Array): PSString => {
  const b = typeof s === 'string' ? latin1(s) : s;
  return { t: 'string', b, o: 0, n: b.length, x: false };
};
export const arr = (a: PSObj[], x = false): PSArray => ({ t: 'array', a, o: 0, n: a.length, x });
export const dictObj = (d: PSDict): PSDictObj => ({ t: 'dict', d });

export function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}
export function strText(s: PSString): string {
  let r = '';
  if (s.n <= 64) {
    for (let i = 0; i < s.n; i++) r += String.fromCharCode(s.b[s.o + i]);
    return r;
  }
  // 長い文字列は、まとめて文字にする (1 字ずつ足すと、100 万字の文字列を鍵・名前にするたびに数十ミリ秒かかる)
  for (let i = 0; i < s.n; i += 8192) r += String.fromCharCode.apply(null, s.b.subarray(s.o + i, s.o + Math.min(s.n, i + 8192)) as unknown as number[]);
  return r;
}
export const strBytes = (s: PSString): Uint8Array => s.b.subarray(s.o, s.o + s.n);
export const arrItems = (a: PSArray): PSObj[] => a.a.slice(a.o, a.o + a.n);

/** 実行できる属性を持つか (§3.3.2) */
export function isExec(o: PSObj): boolean {
  return 'x' in o && !!o.x;
}
export function isProc(o: PSObj): o is PSArray {
  return o.t === 'array' && o.x;
}

// ───────────────────────── エラー (§3.11) ─────────────────────────

/** PostScript のエラー (errordict の名前) */
export class PSError extends Error {
  constructor(public ps: string) {
    super(ps);
  }
}
/** stop (§8.2 stop): 一番内側の stopped まで抜ける */
class StopSignal {}
/** exit (§8.2 exit): 一番内側のループまで抜ける */
class ExitSignal {}
/** quit / 実行の上限: 解釈をやめる */
export class QuitSignal {
  constructor(public reason = 'quit') {}
}

// ───────────────────────── 辞書 (§3.3.9) ─────────────────────────

/**
 * VM に積む量 (Interp.vmAlloc)。PLRM 付録 B の §B.1 はオブジェクト 1 つを 8 バイトとしているので、配列は 1 要素 8 バイト、文字列は 1 字 1 バイト。
 * 辞書の 1 項・save の記録 1 件・グラフィックス状態 1 つは、この実装が実際に使う量に近い値にする (少なく数えると、上限の前にメモリを使い切る)
 */
export const VM_ARRAY_ITEM = 8;
const VM_DICT_ENTRY = 128;
const VM_JOURNAL_ENTRY = 64;
const VM_SAVE = 256;
/** 辞書 1 つ (項は別に積む) */
const VM_DICT = 256;
/** フィルタ 1 つ。Flate (窓 32KB と符号の表)・LZW (表) は大きい */
const VM_FILTER = 256;
const VM_FILTER_BIG = 65536;
/** グラフィックス状態 1 つ (gsave の段・gstate のオブジェクト・save が写す分) */
export const VM_GSTATE = 512;
/**
 * この長さまでの名前は VM に積まない: 名前は表に 1 つだけ置かれるもの (§3.3.6) で、同じ名前を何度作っても増えない。
 * 表 B.1 の名前の長さの上限 (127 字) を超える名前は、ここでは誤りにせずに受け付けるかわりに、作るたびに長さを積む
 */
const VM_NAME_FREE = 127;

/**
 * メモリの合計の勘定 (Interp.memAlloc。PS_MAX_MEMORY_BYTES の説明) に積む量。VM の勘定 (上の VM_*) は PLRM の数え方 (1 要素 8 バイト) だが、
 * こちらは、この処理系が実際に使う量 (Node 22 で、GC の後のヒープとヒープの外の増えを測った値) に近い、少し大きめの値にする:
 *  - 配列の 1 要素: 入れ物の 8 バイトと、要素のオブジェクト (整数 48・実数 58・文字列や配列の一部 66・名前 74・長さ 0 の配列 98 バイト)
 *  - 辞書の 1 項: 141〜189 バイト。辞書 1 つ: 298 バイト
 *  - 文字列 1 つ: 中身のほかに、バイト列の入れ物が約 250 バイト (長さ 0 の文字列を詰めた配列は、1 要素 258 バイト)
 */
export const MEM_ARRAY_ITEM = 88;
const MEM_DICT_ENTRY = 192;
const MEM_DICT = 320;
export const MEM_STRING = 256;
/** save の後の書き換えの控え 1 件 (戻すための関数と、記録した鍵の表の 1 項。測った値は約 150 バイト) */
const MEM_JOURNAL_ENTRY = 160;

let dictSerial = 0;
/** 辞書のキー: 名前と文字列は同じキー (§3.3.9)、整数と実数は値が等しければ同じキー */
function keyOf(k: PSObj): unknown {
  switch (k.t) {
    case 'name':
      return k.v;
    case 'string':
      return strText(k);
    case 'int':
    case 'real':
      return '\u0000n' + k.v;
    case 'bool':
      return k.v ? '\u0000T' : '\u0000F';
    case 'null':
      throw new PSError('typecheck');
    case 'array':
      return k.a;
    case 'dict':
      return k.d;
    case 'operator':
      return k.fn;
    case 'file':
      return k.f;
    case 'mark':
      return '\u0000mark';
    default:
      return k;
  }
}

export class PSDict {
  map = new Map<unknown, { k: PSObj; v: PSObj }>();
  acc: Access = 'unlimited';
  /** global VM に作った辞書 (restore で戻さない。§3.7.2) */
  global = false;
  id = ++dictSerial;
  constructor(
    public I: Interp | undefined,
    public max = 0,
  ) {}
  get size() {
    return this.map.size;
  }
  get(k: PSObj | string): PSObj | undefined {
    return this.map.get(typeof k === 'string' ? k : keyOf(k))?.v;
  }
  has(k: PSObj | string): boolean {
    return this.map.has(typeof k === 'string' ? k : keyOf(k));
  }
  put(k: PSObj | string, v: PSObj) {
    const key = typeof k === 'string' ? k : keyOf(k);
    const ko: PSObj = typeof k === 'string' ? name(k) : k.t === 'string' ? name(strText(k)) : k;
    const old = this.map.get(key);
    // 新しい項は VM に積む (鍵が長い名前・文字列なら、その長さも)
    if (!old) {
      const long = typeof key === 'string' && key.length > VM_NAME_FREE ? key.length : 0;
      this.I?.vmAlloc(VM_DICT_ENTRY + long, MEM_DICT_ENTRY + long);
    }
    this.I?.journalDict(this, key, old);
    this.map.set(key, { k: ko, v });
  }
  del(k: PSObj | string) {
    const key = typeof k === 'string' ? k : keyOf(k);
    const old = this.map.get(key);
    if (!old) return;
    this.I?.journalDict(this, key, old);
    this.map.delete(key);
  }
}

// ───────────────────────── ファイル (§3.8) ─────────────────────────

/** 読み出し専用のファイル (プログラムのファイル・文字列から作ったファイル・フィルタ) */
export class PSFile {
  closed = false;
  private back = -1;
  /** 読んだバイト数 (fileposition) */
  pos = 0;
  constructor(
    public src: ByteSource,
    public label = '',
  ) {}
  read(): number {
    if (this.back >= 0) {
      const c = this.back;
      this.back = -1;
      this.pos++;
      return c;
    }
    if (this.closed) return -1;
    const c = this.src.read();
    if (c < 0) {
      this.closed = true;
      return -1;
    }
    this.pos++;
    return c;
  }
  unread(c: number) {
    if (c < 0) return;
    this.back = c;
    this.pos--;
  }
  peek(): number {
    const c = this.read();
    this.unread(c);
    return c;
  }
  close() {
    this.closed = true;
    this.back = -1;
  }
}

/** バイト列を読むだけの元 */
export function bytesSource(b: Uint8Array): ByteSource {
  let i = 0;
  return { read: () => (i < b.length ? b[i++] : -1) };
}

// ───────────────────────── 字句 (§3.2) ─────────────────────────

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number) => c >= 0 && !WS.has(c) && !DELIM.has(c);

/** 数の字句 (整数・実数・基数付き) を数にする。数でなければ undefined (§3.2.2 Numbers) */
function parseNumber(s: string): PSObj | undefined {
  if (/^[+-]?\d+$/.test(s)) {
    const v = parseInt(s, 10);
    return Math.abs(v) <= 0x7fffffff ? int(v) : real(v);
  }
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(s) && /[.eE]/.test(s)) return real(parseFloat(s));
  const m = /^(\d+)#([0-9A-Za-z]+)$/.exec(s);
  if (m) {
    const base = parseInt(m[1], 10);
    if (base < 2 || base > 36) return undefined;
    let v = 0;
    for (const ch of m[2].toLowerCase()) {
      const d = parseInt(ch, 36);
      if (!(d < base)) return undefined;
      v = v * base + d;
    }
    if (v > 0xffffffff) throw new PSError('limitcheck');
    return int(v | 0);
  }
  return undefined;
}

export interface ScanOptions {
  /** { } の手続きを packed array にする (setpacking) */
  packing: boolean;
}

/** ファイルから字句を 1 つ読み、オブジェクトにする。ファイルの終わりなら undefined (§3.2・token 演算子) */
export function scanToken(f: PSFile, opts: ScanOptions, I: Interp): PSObj | undefined {
  for (;;) {
    let c = f.read();
    while (WS.has(c)) c = f.read();
    if (c < 0) return undefined;
    if (c === 0x25) {
      // 注釈: 改行・改ページまで
      while (c >= 0 && c !== 10 && c !== 13 && c !== 12) c = f.read();
      continue;
    }
    if (c === 0x28) return readLiteralString(f, I);
    if (c === 0x3c) {
      const d = f.read();
      if (d === 0x3c) return name('<<', true);
      if (d === 0x7e) return readA85String(f, I);
      f.unread(d);
      return readHexString(f, I);
    }
    if (c === 0x3e) {
      const d = f.read();
      if (d === 0x3e) return name('>>', true);
      throw new PSError('syntaxerror');
    }
    if (c === 0x5b) return name('[', true);
    if (c === 0x5d) return name(']', true);
    if (c === 0x7b) {
      // 手続きの入れ子の深さの上限 (JS のスタックを使い切らない)
      if (++I.scanDepth > 1000) {
        I.scanDepth = 0;
        throw new PSError('limitcheck');
      }
      try {
      const items: PSObj[] = [];
      for (;;) {
        // 手続きの終わり (空白と注釈は読み飛ばす)
        let q = f.peek();
        while (WS.has(q) || q === 0x25) {
          if (q === 0x25) {
            let c2 = f.read();
            while (c2 >= 0 && c2 !== 10 && c2 !== 13 && c2 !== 12) c2 = f.read();
          } else f.read();
          q = f.peek();
        }
        if (q === 0x7d) {
          f.read();
          break;
        }
        const t = scanToken(f, opts, I);
        if (!t) throw new PSError('syntaxerror');
        items.push(t);
        // 手続きの値は VM に置く (終わらない元から読む手続きが、メモリを使い切る前に VMerror にする)
        if ((items.length & 4095) === 0) I.vmAlloc(4096 * VM_ARRAY_ITEM, 4096 * MEM_ARRAY_ITEM);
      }
      I.vmAlloc((items.length & 4095) * VM_ARRAY_ITEM, (items.length & 4095) * MEM_ARRAY_ITEM);
      const a = arr(items, true);
      if (opts.packing) a.packed = true;
      return a;
      } finally {
        I.scanDepth = Math.max(0, I.scanDepth - 1);
      }
    }
    if (c === 0x7d) throw new PSError('syntaxerror');
    if (c === 0x2f) {
      // /name (文字通りの名前)・//name (すぐに値に置き換える名前。§3.12.2)
      let imm = false;
      let d = f.read();
      if (d === 0x2f) {
        imm = true;
        d = f.read();
      }
      let s = '';
      while (isRegular(d)) {
        s += String.fromCharCode(d);
        if ((s.length & 4095) === 0) I.vmAlloc(4096);
        d = f.read();
      }
      f.unread(d);
      if (s.length > VM_NAME_FREE) I.vmAlloc(s.length & 4095);
      if (imm) {
        const v = I?.lookup(s);
        if (!v) throw new PSError('undefined');
        return v;
      }
      return name(s, false);
    }
    if (c >= 128 && c <= 159) throw new PSError('syntaxerror'); // 2 進の字句 (§3.14) は持たない
    let s = String.fromCharCode(c);
    let d = f.read();
    while (isRegular(d)) {
      s += String.fromCharCode(d);
      // 長い字句 (名前・数) は、読むたびに VM と手間に積む (終わらない元・100 万字の字句の繰り返し)
      if ((s.length & 4095) === 0) {
        I.vmAlloc(4096);
        I.charge(64);
      }
      d = f.read();
    }
    if (s.length > VM_NAME_FREE) I.vmAlloc(s.length & 4095);
    // 字句の後ろの空白は 1 字だけ読み捨てる (§8.2 token・currentfile と組み合わせて画像のデータを読むとき)
    if (!WS.has(d)) f.unread(d);
    else if (d === 13 && f.peek() === 10) f.read();
    return parseNumber(s) ?? name(s, true);
  }
}

/**
 * 字句の文字列を読みながら、その長さを VM に積む (64KB ごと。終わらない元から読む文字列が、メモリを使い切る前に VMerror にする)。
 * 読み終わったら done で残りを積む
 */
function scanCharge(I: Interp) {
  let charged = 0;
  // 文字列のオブジェクト 1 つの入れ物の分 (メモリの合計の勘定だけ。VM の勘定は中身の長さ)
  I.memAlloc(MEM_STRING);
  return {
    grow(len: number) {
      if (len - charged >= 65536) this.done(len);
    },
    done(len: number) {
      I.vmAlloc(len - charged);
      charged = len;
    },
  };
}

function readLiteralString(f: PSFile, I: Interp): PSString {
  const out: number[] = [];
  const vm = scanCharge(I);
  let depth = 1;
  for (;;) {
    vm.grow(out.length);
    let c = f.read();
    if (c < 0) throw new PSError('syntaxerror');
    if (c === 0x5c) {
      c = f.read();
      const esc: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x5c: 0x5c, 0x28: 0x28, 0x29: 0x29 };
      if (c in esc) out.push(esc[c]);
      else if (c >= 0x30 && c <= 0x37) {
        let v = c - 0x30;
        for (let k = 0; k < 2; k++) {
          const d = f.read();
          if (d >= 0x30 && d <= 0x37) v = v * 8 + d - 0x30;
          else {
            f.unread(d);
            break;
          }
        }
        out.push(v & 255);
      } else if (c === 13) {
        if (f.peek() === 10) f.read();
      } else if (c === 10) {
        /* 行の続き */
      } else if (c >= 0) out.push(c);
      continue;
    }
    if (c === 0x28) depth++;
    if (c === 0x29 && --depth === 0) break;
    if (c === 13) {
      // CR・CR LF は LF にする (§3.8.1 の行の終わり)
      if (f.peek() === 10) f.read();
      c = 10;
    }
    out.push(c);
  }
  vm.done(out.length);
  return str(Uint8Array.from(out));
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 55;
  if (c >= 0x61 && c <= 0x66) return c - 87;
  return -1;
}

function readHexString(f: PSFile, I: Interp): PSString {
  const out: number[] = [];
  const vm = scanCharge(I);
  let hi = -1;
  for (;;) {
    vm.grow(out.length);
    const c = f.read();
    if (c < 0) throw new PSError('syntaxerror');
    if (c === 0x3e) break;
    if (WS.has(c)) continue;
    const v = hexVal(c);
    if (v < 0) throw new PSError('syntaxerror');
    if (hi < 0) hi = v;
    else {
      out.push(hi * 16 + v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi * 16);
  vm.done(out.length);
  return str(Uint8Array.from(out));
}

function readA85String(f: PSFile, I: Interp): PSString {
  const src = filterSource('ASCII85Decode', { read: () => f.read() }, undefined);
  const out: number[] = [];
  const vm = scanCharge(I);
  try {
    for (let c = src.read(); c >= 0; c = src.read()) {
      out.push(c);
      vm.grow(out.length);
    }
  } catch (e) {
    // 壊れた ASCII85 の文字列の字句は syntaxerror (§3.2.2)
    if (e instanceof FilterError) throw new PSError('syntaxerror');
    throw e;
  }
  vm.done(out.length);
  return str(Uint8Array.from(out));
}

// ───────────────────────── save (§3.7.3) ─────────────────────────

export interface SaveRec {
  journal: number;
  gstates: unknown;
  valid: boolean;
  level: number;
  /** この save の記録 (グラフィックス状態の写し) として VM に積んだ量。restore で戻す */
  vm: number;
}

type Undo = () => void;

// ───────────────────────── インタプリタ ─────────────────────────

export interface InterpOptions {
  /** 実行する演算子・手続きの数の上限 (終わらないプログラムを止める) */
  maxSteps?: number;
  /** 経過時間の上限 (ミリ秒) */
  maxMillis?: number;
  /** VM の使用量 (配列・文字列・辞書などの確保の合計。バイト) の上限。超えれば VMerror。既定は PS_MAX_VM_BYTES */
  maxVM?: number;
  /** フィルタ (ReusableStreamDecode・DCTDecode) が元を読みためる量 (バイト) の上限。超えれば limitcheck。既定は PS_FILTER_MAX_BYTES */
  maxFilterBytes?: number;
  /** メモリの合計 (VM・パスの点・描画の並び・画像を、実際に使う量に近いバイト数で積んだもの) の上限。超えれば VMerror。既定は PS_MAX_MEMORY_BYTES */
  maxMemory?: number;
}

export class Interp {
  ostack: PSObj[] = [];
  dstack: PSDict[] = [];
  /** 字句を読むときの手続き ({ }) の入れ子の深さ (scanToken) */
  scanDepth = 0;
  /** 大域 VM に作った配列 (gcheck・save/restore の記録の対象外) */
  globalArrays = new WeakSet<PSObj[]>();
  /** 資源の実装の辞書ごとの実例 (局所と大域。psGraphics の資源の演算子が使う。辞書の中に置かない: Generic を写して作った分類と混ざらないように) */
  resourceInstances = new WeakMap<PSDict, { local: PSDict; global: PSDict }>();
  systemdict: PSDict;
  globaldict: PSDict;
  userdict: PSDict;
  errordict: PSDict;
  $error: PSDict;
  statusdict: PSDict;
  packing = false;
  globalAlloc = false;
  /** 実行中のファイル (currentfile) */
  fileStack: PSFile[] = [];
  /** 実行中のオブジェクトの深さ (execstack の代わり。深すぎる再帰を止める) */
  depth = 0;
  steps = 0;
  maxSteps: number;
  deadline: number;
  /**
   * VM の使用量 (バイト)。確保 (array・string・dict の項・長い名前・字句の文字列と手続き・save の記録・フィルタの読みためなど) のたびに積む。
   * restore で戻すのは、その save の記録 (グラフィックス状態の写しと、値を戻すための控え) の分だけ: save のあとに作ったオブジェクトの分は戻さない。
   * PLRM §3.7.3 は「restore は、save のあとに local VM に作ったものを捨てる」とするが、ここでは捨てたはずのオブジェクトがスタックや
   * global VM の辞書からまだ指されていないこと (invalidrestore の検査) を確かめていないので、戻すと、数えた量より多くのメモリを持ち続けられる
   */
  vmUsed = 0;
  maxVM: number;
  maxFilterBytes: number;
  /**
   * メモリの合計の勘定 (バイト。PS_MAX_MEMORY_BYTES の説明)。VM に積むもの (vmAlloc) は、実際に使う量に近い重み (MEM_*) で、ここにも積む。
   * パスの点・描画の並び・画像 (psGraphics・psOpsImage・psShading) も、同じ勘定に積む (memAlloc)。
   * vmUsed と同じく、restore で戻すのは save の記録の分だけ (捨てたオブジェクトの分は戻さない)
   */
  memUsed = 0;
  maxMemory: number;
  /** プログラムを実行し始めたか (組み込みの辞書を作る間は、VM の上限を確かめない) */
  private started = false;
  /** エラーを記録している間 (VM の上限を確かめない) */
  private vmExempt = false;
  saves: SaveRec[] = [];
  private journal: Undo[] = [];
  /** 図形の状態 (psGraphics が持つ。save・gsave の対象) */
  gfx: { saveForRestore(): unknown; restoreTo(s: unknown): void; saveCost?(): number } | undefined;
  /** 警告 (描けなかったもの) */
  warnings = new Set<string>();
  /** 注意 (近似して描いたもの。例: 埋め込まれた書体を代わりの書体で描いた) */
  notes = new Set<string>();
  randSeed = 1;

  constructor(opts: InterpOptions = {}) {
    this.maxSteps = opts.maxSteps ?? 50_000_000;
    this.deadline = Date.now() + (opts.maxMillis ?? 20_000);
    this.maxVM = opts.maxVM ?? PS_MAX_VM_BYTES;
    this.maxFilterBytes = opts.maxFilterBytes ?? PS_FILTER_MAX_BYTES;
    this.maxMemory = opts.maxMemory ?? PS_MAX_MEMORY_BYTES;
    this.systemdict = new PSDict(this, 500);
    this.globaldict = new PSDict(this, 100);
    this.globaldict.global = true;
    this.userdict = new PSDict(this, 200);
    this.errordict = new PSDict(this, 40);
    this.$error = new PSDict(this, 20);
    this.statusdict = new PSDict(this, 20);
    installCoreOperators(this);
    const sd = this.systemdict;
    sd.put('systemdict', dictObj(sd));
    sd.put('userdict', dictObj(this.userdict));
    sd.put('globaldict', dictObj(this.globaldict));
    sd.put('errordict', dictObj(this.errordict));
    sd.put('$error', dictObj(this.$error));
    sd.put('statusdict', dictObj(this.statusdict));
    sd.put('true', TRUE);
    sd.put('false', FALSE);
    sd.put('null', NULL);
    this.$error.put('newerror', FALSE);
    this.$error.put('recordstacks', TRUE);
    this.$error.put('binary', FALSE);
    for (const e of ERRORS) this.errordict.put(e, { t: 'operator', name: e, fn: (I) => I.defaultErrorHandler(e), x: true });
    this.errordict.put('handleerror', { t: 'operator', name: 'handleerror', fn: () => {}, x: true });
    sd.acc = 'readonly';
    this.dstack = [sd, this.globaldict, this.userdict];
  }

  // ── 演算子の登録 ──
  def(nm: string, fn: (I: Interp) => void) {
    const acc = this.systemdict.acc;
    this.systemdict.acc = 'unlimited';
    this.systemdict.put(nm, { t: 'operator', name: nm, fn, x: true });
    this.systemdict.acc = acc;
  }

  /**
   * 演算子の「取るオペランドの個数」(PSOperator.n) を宣言する。callOperator はエラーのときにこの分だけ写して戻す
   * (0 なら写さない)。宣言の無い演算子は 8 個を写す。無い名前は作りの誤り
   */
  operandCounts(counts: Record<string, number>) {
    for (const [nm, n] of Object.entries(counts)) {
      const op = this.systemdict.get(nm);
      if (!op || op.t !== 'operator') throw new Error(`演算子 ${nm} が定義されていません (operandCounts)`);
      op.n = n;
    }
  }

  // ── save と restore の記録 (§3.7.3: 配列と辞書の値を戻す。文字列は戻さない) ──
  /** 今の save の後に記録した (辞書・配列, 鍵) の組。同じ組は最初の 1 回だけ記録すれば戻せる (journal が際限なく伸びない) */
  private journaled: Array<WeakMap<object, Set<unknown>>> = [];
  private firstChange(o: object, key: unknown): boolean {
    const m = this.journaled[this.journaled.length - 1];
    if (!m) return true;
    let set = m.get(o);
    if (!set) m.set(o, (set = new Set()));
    if (set.has(key)) return false;
    // 控え 1 件も VM に積む (積めなければ、書き換える前に VMerror。restore で戻す)
    this.vmAlloc(VM_JOURNAL_ENTRY, MEM_JOURNAL_ENTRY);
    set.add(key);
    if (this.journal.length >= 5_000_000) throw new PSError('limitcheck');
    return true;
  }
  journalDict(d: PSDict, key: unknown, old: { k: PSObj; v: PSObj } | undefined) {
    if (!this.saves.length || d.global || !this.firstChange(d, key)) return;
    this.journal.push(() => {
      if (old) d.map.set(key, old);
      else d.map.delete(key);
    });
  }
  journalArray(a: PSObj[], i: number) {
    if (!this.saves.length || this.globalArrays.has(a) || !this.firstChange(a, i)) return;
    const old = a[i];
    this.journal.push(() => {
      a[i] = old;
    });
  }
  doSave(): SaveRec {
    // save の記録 (グラフィックス状態のスタックの写し) も VM に置く ({ save pop } loop が、メモリを使い切る前に VMerror にする)
    const vm = VM_SAVE + (this.gfx?.saveCost?.() ?? 0);
    this.vmAlloc(vm);
    const s: SaveRec = { journal: this.journal.length, gstates: this.gfx?.saveForRestore(), valid: true, level: this.saves.length + 1, vm };
    this.saves.push(s);
    this.journaled.push(new WeakMap());
    return s;
  }
  doRestore(s: SaveRec) {
    const k = this.saves.indexOf(s);
    if (k < 0 || !s.valid) throw new PSError('invalidrestore');
    // 控えと save の記録は、ここで実際に手放すので、VM の使用量からも引く (save のあとに作ったオブジェクトの分は引かない。vmUsed の説明)
    this.vmUsed -= (this.journal.length - s.journal) * VM_JOURNAL_ENTRY;
    this.memUsed -= (this.journal.length - s.journal) * MEM_JOURNAL_ENTRY;
    while (this.journal.length > s.journal) this.journal.pop()!();
    const gstates = s.gstates;
    for (const t of this.saves.splice(k)) {
      t.valid = false;
      this.vmUsed -= t.vm;
      this.memUsed -= t.vm;
      // 無効になった save のオブジェクトがスタックに残っていても、写しは持ち続けない
      t.gstates = undefined;
    }
    this.journaled.splice(k);
    if (gstates !== undefined) this.gfx?.restoreTo(gstates);
  }

  // ── スタック ──
  push(o: PSObj) {
    if (this.ostack.length > 100_000) throw new PSError('stackoverflow');
    this.ostack.push(o);
  }
  pop(): PSObj {
    const o = this.ostack.pop();
    if (!o) throw new PSError('stackunderflow');
    return o;
  }
  need(n: number) {
    if (this.ostack.length < n) throw new PSError('stackunderflow');
  }
  popNum(): number {
    const o = this.pop();
    if (o.t !== 'int' && o.t !== 'real') throw new PSError('typecheck');
    return o.v;
  }
  popInt(): number {
    const o = this.pop();
    if (o.t !== 'int') {
      if (o.t === 'real' && Number.isInteger(o.v)) return o.v;
      throw new PSError('typecheck');
    }
    return o.v;
  }
  popBool(): boolean {
    const o = this.pop();
    if (o.t !== 'bool') throw new PSError('typecheck');
    return o.v;
  }
  popDict(): PSDict {
    const o = this.pop();
    if (o.t !== 'dict') throw new PSError('typecheck');
    return o.d;
  }
  popString(): PSString {
    const o = this.pop();
    if (o.t !== 'string') throw new PSError('typecheck');
    return o;
  }
  popArray(): PSArray {
    const o = this.pop();
    if (o.t !== 'array') throw new PSError('typecheck');
    return o;
  }
  popProc(): PSObj {
    const o = this.pop();
    if (o.t !== 'array' && o.t !== 'operator' && o.t !== 'name') throw new PSError('typecheck');
    return o;
  }

  // ── 名前を探す (§3.3.9) ──
  lookup(k: string | PSObj): PSObj | undefined {
    // 鍵は 1 度だけ作る (文字列の鍵を、辞書スタックの段ごとに文字にし直さない)
    const key = typeof k === 'string' ? k : this.keyFor(k);
    for (let i = this.dstack.length - 1; i >= 0; i--) {
      const v = this.dstack[i].map.get(key)?.v;
      if (v) return v;
    }
    return undefined;
  }
  where(k: PSObj): PSDict | undefined {
    const key = this.keyFor(k);
    for (let i = this.dstack.length - 1; i >= 0; i--) if (this.dstack[i].map.has(key)) return this.dstack[i];
    return undefined;
  }
  /** 辞書の鍵。長い文字列を鍵にする手間も数える */
  private keyFor(k: PSObj): unknown {
    if (k.t === 'string') this.work(k.n);
    return keyOf(k);
  }
  get currentdict(): PSDict {
    return this.dstack[this.dstack.length - 1];
  }

  newDict(max = 0): PSDict {
    this.vmAlloc(VM_DICT, MEM_DICT);
    const d = new PSDict(this, max);
    d.global = this.globalAlloc;
    return d;
  }
  /** 配列のオブジェクトを作る。charged: 呼び手が、items を作る前に vmAlloc で積んである */
  newArray(items: PSObj[], x = false, charged = false): PSArray {
    if (!charged) this.vmAlloc(items.length * VM_ARRAY_ITEM, items.length * MEM_ARRAY_ITEM);
    if (this.globalAlloc) this.globalArrays.add(items);
    return arr(items, x);
  }

  /**
   * VM に n バイトを確保したと数える。上限 (maxVM) を超えるなら、確保する前に VMerror にする (§3.11.2・付録 B)。
   * 呼ぶのは、実際にメモリを取る前。mem は、メモリの合計の勘定 (memUsed) に積む量 (実際に使う量に近いバイト数。省けば n と同じ)
   */
  vmAlloc(n: number, mem = n) {
    if (!(n > 0)) return;
    if (this.started && !this.vmExempt && this.vmUsed + n > this.maxVM) throw new PSError('VMerror');
    this.memAlloc(mem);
    this.vmUsed += n;
  }
  /**
   * メモリの合計の勘定に n バイトを積む。上限 (maxMemory) を超えるなら、確保する前に VMerror にする
   * (PLRM 付録 B の冒頭: 仮想メモリを使い切る操作は VMerror。PS_MAX_MEMORY_BYTES の説明)
   */
  memAlloc(n: number) {
    if (!(n > 0)) return;
    if (this.started && !this.vmExempt && this.memUsed + n > this.maxMemory) throw new PSError('VMerror');
    this.memUsed += n;
  }
  /** 演算子の中で、長さ n に比例して回るループの手間を数える (64 要素で 1 ステップ。短いものは数えない) */
  work(n: number) {
    if (n >= 4096) this.charge(n / 64);
  }

  // ── 実行 (§3.5) ──
  tick() {
    if (++this.steps > this.maxSteps) throw new QuitSignal('steps');
    if ((this.steps & 255) === 0 && Date.now() > this.deadline) throw new QuitSignal('time');
  }
  /** 重い処理 (画像の画素など) を、手間 n ステップとして数える。時間の上限もここで確かめる */
  charge(n: number) {
    this.steps += Math.max(0, Math.floor(n));
    if (this.steps > this.maxSteps) throw new QuitSignal('steps');
    if (Date.now() > this.deadline) throw new QuitSignal('time');
  }

  /** オブジェクトを実行する。direct: スキャナが直接読んだもの (手続きは積むだけ。§3.5.3) */
  exec(o: PSObj, direct = false): void {
    this.tick();
    if (!isExec(o)) {
      this.push(o);
      return;
    }
    switch (o.t) {
      case 'name': {
        const v = this.lookup(o.v);
        if (!v) return this.error('undefined', o);
        if (v.t === 'operator') return this.callOperator(v, o);
        if (isProc(v)) return this.execProc(v);
        // 名前が実行できる名前を指す連鎖 (/a /a cvx def a など) も実行スタックの深さとして数える (JS の呼び出しの深さを使い切らない)
        if (++this.depth > 1500) {
          this.depth--;
          throw new PSError('execstackoverflow');
        }
        try {
          return this.exec(v);
        } finally {
          this.depth--;
        }
      }
      case 'operator':
        return this.callOperator(o, o);
      case 'array':
        if (direct) return this.push(o);
        return this.execProc(o);
      case 'string':
        return this.runFile(new PSFile(bytesSource(strBytes(o)), 'string'));
      case 'file':
        return this.runFile(o.f);
      case 'null':
        return;
      default:
        return this.push(o);
    }
  }

  callOperator(op: PSOperator, cmd: PSObj) {
    const before = this.ostack.length;
    // §3.11.1 のために、取られうるオペランドを写しておく: 取る個数 (op.n) の分かる演算子はその分だけ (0 なら写さない)、分からなければ 8 個
    const n = op.n ?? 8;
    const saved = n ? this.ostack.slice(Math.max(0, before - n)) : undefined;
    try {
      op.fn(this);
    } catch (e) {
      // 演算子の中で起きた JS の例外 (RangeError・TypeError) も PostScript のエラーに写す (EPS 全体を「読めない画像」にしない)
      const ps = e instanceof PSError ? e.ps : jsErrorToPS(e);
      if (ps) {
        // §3.11.1: 実行を始めたときのオペランドスタックに戻し、実行していたオブジェクトを積んでエラーの手続きを呼ぶ
        if (this.ostack.length < before) {
          this.ostack.length = Math.max(0, before - (saved?.length ?? 0));
          if (saved) this.ostack.push(...saved);
        } else this.ostack.length = before;
        return this.error(ps, cmd);
      }
      throw e;
    }
  }

  /** エラー (§3.11): errordict の手続きを呼ぶ */
  error(e: string, cmd: PSObj): void {
    this.push(cmd);
    const h = this.errordict.get(e);
    if (!h) throw new StopSignal();
    if (h.t === 'operator') return h.fn(this);
    if (isProc(h)) return this.execProc(h);
    return this.exec(h);
  }

  /** 既定のエラーの手続き: $error に記録して stop (§3.11.2) */
  defaultErrorHandler(e: string) {
    const cmd = this.ostack.pop() ?? NULL;
    // エラーの記録は、VM が尽きていてもできるようにする (VMerror そのものを記録できなくならないように)
    this.vmExempt = true;
    try {
      this.$error.put('newerror', TRUE);
      this.$error.put('errorname', name(e));
      this.$error.put('command', cmd);
    } finally {
      this.vmExempt = false;
    }
    // 名前は 100 字までを書く (100 万字の名前を、そのままエラーの文に入れない)
    const top = this.ostack.slice(-4).map((o) => (o.t === 'name' ? '/' + (o.v.length > 100 ? o.v.slice(0, 100) + '…' : o.v) : o.t === 'int' || o.t === 'real' ? String(o.v) : o.t));
    this.lastError = `${e} (${cmd.t === 'name' || cmd.t === 'operator' ? (cmd.t === 'name' ? cmd.v : cmd.name) : cmd.t === 'file' ? 'file@' + cmd.f.pos : cmd.t}) [${top.join(' ')}]`;
    throw new StopSignal();
  }
  lastError = '';

  execProc(p: PSArray) {
    // 手続きを呼ぶこと自体も 1 ステップと数える (空の手続きの repeat・for・loop でも、ステップ数と時間の上限が効く)
    this.tick();
    if (++this.depth > 1500) {
      this.depth--;
      throw new PSError('execstackoverflow');
    }
    try {
      const a = p.a;
      const end = p.o + p.n;
      for (let i = p.o; i < end; i++) {
        const o = a[i];
        // 手続きの中の手続きは積むだけ (§3.5.3)
        if (o.t === 'array' && o.x) {
          this.tick();
          this.push(o);
        } else this.exec(o);
      }
    } finally {
      this.depth--;
    }
  }

  /** 手続き (または実行できる任意のオブジェクト) を呼ぶ */
  call(o: PSObj) {
    if (isProc(o)) this.execProc(o);
    else this.exec(o);
  }

  /** ファイルを実行する: 字句を読んでは実行する (§3.5.5) */
  runFile(f: PSFile) {
    this.fileStack.push(f);
    if (++this.depth > 1500) {
      this.depth--;
      this.fileStack.pop();
      throw new PSError('execstackoverflow');
    }
    try {
      for (;;) {
        let t: PSObj | undefined;
        try {
          t = scanToken(f, this, this);
        } catch (e) {
          if (e instanceof PSError) {
            this.error(e.ps, { t: 'file', f, x: true });
            continue;
          }
          // フィルタを通したファイルを実行していて、データが壊れていた: ioerror (§3.13.3)。壊れた先は読めないので、このファイルの実行は終える
          if (e instanceof FilterError) {
            this.error(e.message === 'limitcheck' ? 'limitcheck' : 'ioerror', { t: 'file', f, x: true });
            break;
          }
          throw e;
        }
        if (!t) break;
        this.exec(t, true);
      }
    } finally {
      this.depth--;
      this.fileStack.pop();
    }
  }

  /** stopped の中で実行する。stop されたら true */
  stopped(o: PSObj): boolean {
    try {
      this.call(o);
      return false;
    } catch (e) {
      if (e instanceof StopSignal) {
        this.lastError = '';
        if (this.dstack.length < 3) this.dstack.length = 3;
        return true;
      }
      if (e instanceof PSError) return true;
      throw e;
    }
  }

  /** ループの本体を実行する。exit されたら false */
  loopBody(o: PSObj): boolean {
    try {
      this.call(o);
      return true;
    } catch (e) {
      if (e instanceof ExitSignal) return false;
      throw e;
    }
  }

  /** プログラムを実行する。stop で終わったら、そのエラーを返す */
  run(program: Uint8Array): string | undefined {
    const f = new PSFile(bytesSource(program), 'program');
    this.lastError = '';
    if (!this.started) {
      // 組み込みの辞書・演算子の分は、プログラムの VM の使用量に入れない
      this.started = true;
      this.vmUsed = 0;
      this.memUsed = 0;
    }
    try {
      this.call({ t: 'file', f, x: true });
      return undefined;
    } catch (e) {
      // stopped() を通さずに自分で受ける (stopped() はプログラムが処理したエラーとして lastError を消すので、エラー名が呼び手に伝わらなかった)
      if (e instanceof StopSignal) {
        if (this.dstack.length < 3) this.dstack.length = 3;
        return this.lastError || 'stop';
      }
      if (e instanceof PSError) return e.ps;
      if (e instanceof QuitSignal) return e.reason === 'quit' ? undefined : `limit:${e.reason}`;
      if (e instanceof ExitSignal) return undefined;
      // 最終防衛線: 演算子の外 (字句の読み取りなど) で起きた JS の例外も、呼び手には PostScript のエラーとして返す
      const ps = jsErrorToPS(e);
      if (ps) return `${ps} (js: ${e instanceof Error ? e.message : String(e)})`;
      throw e;
    }
  }

  warn(w: string) {
    // 警告・注意の種類は 1000 までを覚える (名前を変えながら警告を出し続けるプログラムで、メモリを使い切らない)
    if (this.warnings.size < 1000) this.warnings.add(w.length > 200 ? w.slice(0, 200) + '…' : w);
  }
  note(w: string) {
    if (this.notes.size < 1000) this.notes.add(w.length > 200 ? w.slice(0, 200) + '…' : w);
  }
}

/**
 * JS の例外を PostScript のエラー名に写す。RangeError (JS の呼び出しの深さ・配列の長さ・引数の数の上限) は
 * execstackoverflow か limitcheck、TypeError (undefined の参照など、解釈器の取りこぼし) は typecheck。
 * それ以外 (QuitSignal・StopSignal など解釈器の信号を含む) は undefined を返し、呼び手がそのまま投げ直す
 */
function jsErrorToPS(e: unknown): string | undefined {
  // フィルタ (psFilters) の例外: 読み出し中に符号化されたデータが壊れていれば ioerror、持っていないフィルタの名前は undefined
  // (PLRM §8.2 の filter のエラーの一覧: invalidaccess・ioerror・limitcheck・rangecheck・stackunderflow・typecheck・undefined)。
  // PostScript のエラーにするので、stopped で受けられ、受けなくても、それまでに描いたものは残る
  // 読みためる量の上限 (PS_FILTER_MAX_BYTES) を超えたときだけは limitcheck (FilterError の message が、その名前)
  if (e instanceof FilterError) return e.message === 'limitcheck' ? 'limitcheck' : 'ioerror';
  if (e instanceof UnsupportedFilter) return 'undefined';
  if (e instanceof RangeError) return /call stack/i.test(e.message) ? 'execstackoverflow' : 'limitcheck';
  if (e instanceof TypeError) return 'typecheck';
  return undefined;
}

/** 配列・辞書・文字列の長さの上限 (PLRM 付録 B の 65535 の 16 倍。細工したファイルでメモリを使い切らない) */
const MAX_LEN = 65535 * 16;

const ERRORS = [
  'configurationerror',
  'dictfull',
  'dictstackoverflow',
  'dictstackunderflow',
  'execstackoverflow',
  'interrupt',
  'invalidaccess',
  'invalidcontext',
  'invalidexit',
  'invalidfileaccess',
  'invalidfont',
  'invalidid',
  'invalidrestore',
  'ioerror',
  'limitcheck',
  'nocurrentpoint',
  'rangecheck',
  'stackoverflow',
  'stackunderflow',
  'syntaxerror',
  'timeout',
  'typecheck',
  'undefined',
  'undefinedfilename',
  'undefinedresource',
  'undefinedresult',
  'unmatchedmark',
  'unregistered',
  'VMerror',
];

// ───────────────────────── 比較 (eq・lt など。§8.2) ─────────────────────────

export function psEq(a: PSObj, b: PSObj): boolean {
  if ((a.t === 'int' || a.t === 'real') && (b.t === 'int' || b.t === 'real')) return a.v === b.v;
  if ((a.t === 'string' || a.t === 'name') && (b.t === 'string' || b.t === 'name')) {
    const sa = a.t === 'string' ? strText(a) : a.v;
    const sb = b.t === 'string' ? strText(b) : b.v;
    return sa === sb;
  }
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'bool':
      return a.v === (b as typeof a).v;
    case 'null':
    case 'mark':
      return true;
    case 'array':
      return a.a === (b as PSArray).a && a.o === (b as PSArray).o && a.n === (b as PSArray).n;
    case 'dict':
      return a.d === (b as PSDictObj).d;
    case 'operator':
      return a.fn === (b as PSOperator).fn;
    case 'file':
      return a.f === (b as PSFileObj).f;
    default:
      return a === b;
  }
}

/** 型の名前 (type 演算子。§8.2 type) */
export function typeName(o: PSObj): string {
  switch (o.t) {
    case 'int':
      return 'integertype';
    case 'real':
      return 'realtype';
    case 'bool':
      return 'booleantype';
    case 'array':
      return o.packed ? 'packedarraytype' : 'arraytype';
    case 'string':
      return 'stringtype';
    case 'name':
      return 'nametype';
    case 'dict':
      return 'dicttype';
    case 'operator':
      return 'operatortype';
    case 'file':
      return 'filetype';
    case 'mark':
      return 'marktype';
    case 'null':
      return 'nulltype';
    case 'save':
      return 'savetype';
    case 'gstate':
      return 'gstatetype';
    case 'fontid':
      return 'fonttype';
  }
}

/** cvs の文字 (§8.2 cvs) */
export function cvsText(o: PSObj): string {
  switch (o.t) {
    case 'int':
      return String(o.v);
    case 'real': {
      if (Number.isInteger(o.v)) return o.v.toFixed(1);
      const s = String(Math.round(o.v * 1e6) / 1e6);
      return s;
    }
    case 'bool':
      return o.v ? 'true' : 'false';
    case 'string':
      return strText(o);
    case 'name':
      return o.v;
    case 'operator':
      return o.name;
    default:
      return '--nostringval--';
  }
}

// ───────────────────────── 中心の演算子 (§8.2) ─────────────────────────

function installCoreOperators(I: Interp) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  const numOf = (o: PSObj) => {
    if (o.t !== 'int' && o.t !== 'real') throw new PSError('typecheck');
    return o;
  };

  // スタック
  d('pop', (I) => void I.pop());
  d('exch', (I) => {
    I.need(2);
    const s = I.ostack;
    const n = s.length;
    [s[n - 1], s[n - 2]] = [s[n - 2], s[n - 1]];
  });
  d('dup', (I) => {
    I.need(1);
    I.push(I.ostack[I.ostack.length - 1]);
  });
  d('copy', (I) => {
    const top = I.pop();
    if (top.t === 'int') {
      if (top.v < 0) throw new PSError('rangecheck');
      I.need(top.v);
      for (const o of I.ostack.slice(I.ostack.length - top.v)) I.push(o);
      return;
    }
    const src = I.pop();
    if (src.t === 'array' && top.t === 'array') {
      if (top.n < src.n) throw new PSError('rangecheck');
      I.work(src.n);
      for (let i = 0; i < src.n; i++) {
        I.journalArray(top.a, top.o + i);
        top.a[top.o + i] = src.a[src.o + i];
      }
      I.push({ ...top, n: src.n });
      return;
    }
    if (src.t === 'string' && top.t === 'string') {
      if (top.n < src.n) throw new PSError('rangecheck');
      I.work(src.n / 16);
      top.b.set(strBytes(src), top.o);
      I.push({ ...top, n: src.n });
      return;
    }
    if (src.t === 'dict' && top.t === 'dict') {
      I.work(src.d.size * 4);
      for (const { k, v } of src.d.map.values()) top.d.put(k, v);
      I.push(top);
      return;
    }
    throw new PSError('typecheck');
  });
  d('index', (I) => {
    const n = I.popInt();
    if (n < 0 || n >= I.ostack.length) throw new PSError('rangecheck');
    I.push(I.ostack[I.ostack.length - 1 - n]);
  });
  d('roll', (I) => {
    const j = I.popInt();
    const n = I.popInt();
    if (n < 0) throw new PSError('rangecheck');
    I.need(n);
    if (n === 0) return;
    const s = I.ostack;
    const part = s.splice(s.length - n, n);
    const k = ((j % n) + n) % n;
    // spread (push(...)) は引数の数の上限で RangeError になりうるので (スタックは 10 万個まで)、1 つずつ戻す
    for (let i = n - k; i < n; i++) s.push(part[i]);
    for (let i = 0; i < n - k; i++) s.push(part[i]);
  });
  d('clear', (I) => void (I.ostack.length = 0));
  d('count', (I) => I.push(int(I.ostack.length)));
  d('mark', (I) => I.push(MARK));
  d('[', (I) => I.push(MARK));
  d('<<', (I) => I.push(MARK));
  const toMark = (I: Interp) => {
    for (let i = I.ostack.length - 1; i >= 0; i--) if (I.ostack[i].t === 'mark') return i;
    throw new PSError('unmatchedmark');
  };
  d('cleartomark', (I) => void (I.ostack.length = toMark(I)));
  d('counttomark', (I) => I.push(int(I.ostack.length - 1 - toMark(I))));
  d(']', (I) => {
    const m = toMark(I);
    const items = I.ostack.splice(m);
    items.shift();
    I.push(I.newArray(items));
  });
  d('>>', (I) => {
    const m = toMark(I);
    const items = I.ostack.splice(m);
    items.shift();
    if (items.length % 2) throw new PSError('rangecheck');
    const dd = I.newDict(items.length / 2);
    for (let i = 0; i < items.length; i += 2) dd.put(items[i], items[i + 1]);
    I.push(dictObj(dd));
  });

  // 算術 (§8.2)
  const arith = (n: string, f: (a: number, b: number) => number, intOk: boolean) =>
    d(n, (I) => {
      const b = numOf(I.pop());
      const a = numOf(I.pop());
      const r = f(a.v, b.v);
      if (intOk && a.t === 'int' && b.t === 'int' && Number.isInteger(r) && Math.abs(r) <= 0x7fffffff) I.push(int(r));
      else I.push(real(r));
    });
  arith('add', (a, b) => a + b, true);
  arith('sub', (a, b) => a - b, true);
  arith('mul', (a, b) => a * b, true);
  d('div', (I) => {
    const b = I.popNum();
    const a = I.popNum();
    if (b === 0) throw new PSError('undefinedresult');
    I.push(real(a / b));
  });
  d('idiv', (I) => {
    const b = I.popInt();
    const a = I.popInt();
    if (b === 0) throw new PSError('undefinedresult');
    I.push(int(Math.trunc(a / b)));
  });
  d('mod', (I) => {
    const b = I.popInt();
    const a = I.popInt();
    if (b === 0) throw new PSError('undefinedresult');
    I.push(int(a % b));
  });
  const unary = (n: string, f: (a: number) => number, keepInt: boolean) =>
    d(n, (I) => {
      const a = numOf(I.pop());
      const r = f(a.v);
      I.push(keepInt && a.t === 'int' ? int(r) : real(r));
    });
  unary('abs', Math.abs, true);
  unary('neg', (a) => -a, true);
  unary('ceiling', Math.ceil, true);
  unary('floor', Math.floor, true);
  // round: 半分は大きい方へ (§8.2 round)
  unary('round', (a) => Math.floor(a + 0.5), true);
  unary('truncate', Math.trunc, true);
  d('sqrt', (I) => {
    const a = I.popNum();
    if (a < 0) throw new PSError('rangecheck');
    I.push(real(Math.sqrt(a)));
  });
  d('atan', (I) => {
    const den = I.popNum();
    const nm = I.popNum();
    if (den === 0 && nm === 0) throw new PSError('undefinedresult');
    let a = (Math.atan2(nm, den) * 180) / Math.PI;
    if (a < 0) a += 360;
    I.push(real(a));
  });
  d('cos', (I) => I.push(real(Math.cos((I.popNum() * Math.PI) / 180))));
  d('sin', (I) => I.push(real(Math.sin((I.popNum() * Math.PI) / 180))));
  d('exp', (I) => {
    const e = I.popNum();
    const b = I.popNum();
    I.push(real(Math.pow(b, e)));
  });
  d('ln', (I) => {
    const a = I.popNum();
    if (a <= 0) throw new PSError('rangecheck');
    I.push(real(Math.log(a)));
  });
  d('log', (I) => {
    const a = I.popNum();
    if (a <= 0) throw new PSError('rangecheck');
    I.push(real(Math.log10(a)));
  });
  d('rand', (I) => {
    I.randSeed = (I.randSeed * 1103515245 + 12345) & 0x7fffffff;
    I.push(int(I.randSeed));
  });
  d('srand', (I) => void (I.randSeed = I.popInt()));
  d('rrand', (I) => I.push(int(I.randSeed)));

  // 配列 (§8.2)
  d('array', (I) => {
    const n = I.popInt();
    if (n < 0) throw new PSError('rangecheck');
    // 長さの上限 (PLRM 付録 B の表 B.1 は 65535。string と同じく、その 16 倍まで受け付ける。超えたら limitcheck)
    if (n > MAX_LEN) throw new PSError('limitcheck');
    I.vmAlloc(n * VM_ARRAY_ITEM, n * MEM_ARRAY_ITEM);
    I.push(I.newArray(Array.from({ length: n }, () => NULL), false, true));
  });
  d('length', (I) => {
    const o = I.pop();
    if (o.t === 'array' || o.t === 'string') I.push(int(o.n));
    else if (o.t === 'dict') I.push(int(o.d.size));
    else if (o.t === 'name') I.push(int(o.v.length));
    else throw new PSError('typecheck');
  });
  d('get', (I) => {
    const k = I.pop();
    const o = I.pop();
    if (o.t === 'dict') {
      if (k.t === 'string') I.work(k.n);
      const v = o.d.get(k);
      if (!v) throw new PSError('undefined');
      I.push(v);
      return;
    }
    if (k.t !== 'int') throw new PSError('typecheck');
    if (o.t === 'array') {
      if (k.v < 0 || k.v >= o.n) throw new PSError('rangecheck');
      I.push(o.a[o.o + k.v]);
    } else if (o.t === 'string') {
      if (k.v < 0 || k.v >= o.n) throw new PSError('rangecheck');
      I.push(int(o.b[o.o + k.v]));
    } else throw new PSError('typecheck');
  });
  d('put', (I) => {
    const v = I.pop();
    const k = I.pop();
    const o = I.pop();
    if (o.t === 'dict') {
      if (o.d.acc !== 'unlimited' && o.d !== I.systemdict) throw new PSError('invalidaccess');
      if (k.t === 'string') I.work(k.n);
      o.d.put(k, v);
      return;
    }
    if (k.t !== 'int') throw new PSError('typecheck');
    if (o.t === 'array') {
      if (k.v < 0 || k.v >= o.n) throw new PSError('rangecheck');
      I.journalArray(o.a, o.o + k.v);
      o.a[o.o + k.v] = v;
    } else if (o.t === 'string') {
      if (k.v < 0 || k.v >= o.n) throw new PSError('rangecheck');
      if (v.t !== 'int') throw new PSError('typecheck');
      o.b[o.o + k.v] = v.v & 255;
    } else throw new PSError('typecheck');
  });
  d('getinterval', (I) => {
    const n = I.popInt();
    const i = I.popInt();
    const o = I.pop();
    if (o.t !== 'array' && o.t !== 'string') throw new PSError('typecheck');
    if (i < 0 || n < 0 || i + n > o.n) throw new PSError('rangecheck');
    I.push({ ...o, o: o.o + i, n });
  });
  d('putinterval', (I) => {
    const src = I.pop();
    const i = I.popInt();
    const o = I.pop();
    if (o.t === 'array' && src.t === 'array') {
      if (i < 0 || i + src.n > o.n) throw new PSError('rangecheck');
      I.work(src.n);
      for (let k = 0; k < src.n; k++) {
        I.journalArray(o.a, o.o + i + k);
        o.a[o.o + i + k] = src.a[src.o + k];
      }
    } else if (o.t === 'string' && src.t === 'string') {
      if (i < 0 || i + src.n > o.n) throw new PSError('rangecheck');
      o.b.set(strBytes(src), o.o + i);
    } else throw new PSError('typecheck');
  });
  d('astore', (I) => {
    const a = I.popArray();
    I.need(a.n);
    const items = I.ostack.splice(I.ostack.length - a.n);
    for (let k = 0; k < a.n; k++) {
      I.journalArray(a.a, a.o + k);
      a.a[a.o + k] = items[k];
    }
    I.push(a);
  });
  d('aload', (I) => {
    const a = I.popArray();
    for (let k = 0; k < a.n; k++) I.push(a.a[a.o + k]);
    I.push(a);
  });
  d('packedarray', (I) => {
    const n = I.popInt();
    I.need(n);
    const items = I.ostack.splice(I.ostack.length - n);
    const a = I.newArray(items);
    a.packed = true;
    I.push(a);
  });
  d('setpacking', (I) => void (I.packing = I.popBool()));
  d('currentpacking', (I) => I.push(bool(I.packing)));
  d('forall', (I) => {
    const p = I.popProc();
    const o = I.pop();
    if (o.t === 'array') {
      for (let k = 0; k < o.n; k++) {
        I.push(o.a[o.o + k]);
        if (!I.loopBody(p)) break;
      }
    } else if (o.t === 'string') {
      for (let k = 0; k < o.n; k++) {
        I.push(int(o.b[o.o + k]));
        if (!I.loopBody(p)) break;
      }
    } else if (o.t === 'dict') {
      I.work(o.d.size);
      for (const { k, v } of [...o.d.map.values()]) {
        I.push(k);
        I.push(v);
        if (!I.loopBody(p)) break;
      }
    } else throw new PSError('typecheck');
  });

  // 辞書 (§8.2)
  d('dict', (I) => {
    const n = I.popInt();
    if (n < 0) throw new PSError('rangecheck');
    if (n > MAX_LEN) throw new PSError('limitcheck');
    I.push(dictObj(I.newDict(n)));
  });
  d('maxlength', (I) => {
    const dd = I.popDict();
    I.push(int(Math.max(dd.max, dd.size)));
  });
  d('begin', (I) => {
    if (I.dstack.length > 1000) throw new PSError('dictstackoverflow');
    I.dstack.push(I.popDict());
  });
  d('end', (I) => {
    if (I.dstack.length <= 3) throw new PSError('dictstackunderflow');
    I.dstack.pop();
  });
  d('def', (I) => {
    const v = I.pop();
    const k = I.pop();
    const cd = I.currentdict;
    if (cd === I.systemdict) throw new PSError('invalidaccess');
    if (k.t === 'string') I.work(k.n);
    cd.put(k, v);
  });
  d('load', (I) => {
    const k = I.pop();
    const v = I.lookup(k);
    if (!v) throw new PSError('undefined');
    I.push(v);
  });
  d('store', (I) => {
    const v = I.pop();
    const k = I.pop();
    (I.where(k) ?? I.currentdict).put(k, v);
  });
  d('undef', (I) => {
    const k = I.pop();
    if (k.t === 'string') I.work(k.n);
    I.popDict().del(k);
  });
  d('known', (I) => {
    const k = I.pop();
    if (k.t === 'string') I.work(k.n);
    I.push(bool(I.popDict().has(k)));
  });
  d('where', (I) => {
    const k = I.pop();
    const w = I.where(k);
    if (w) {
      I.push(dictObj(w));
      I.push(TRUE);
    } else I.push(FALSE);
  });
  d('currentdict', (I) => I.push(dictObj(I.currentdict)));
  d('countdictstack', (I) => I.push(int(I.dstack.length)));
  d('dictstack', (I) => {
    const a = I.popArray();
    if (a.n < I.dstack.length) throw new PSError('rangecheck');
    I.dstack.forEach((dd, k) => (a.a[a.o + k] = dictObj(dd)));
    I.push({ ...a, n: I.dstack.length });
  });
  d('cleardictstack', (I) => void (I.dstack.length = 3));

  // 文字列 (§8.2)
  d('string', (I) => {
    const n = I.popInt();
    if (n < 0) throw new PSError('rangecheck');
    if (n > MAX_LEN) throw new PSError('limitcheck');
    I.memAlloc(MEM_STRING);
    I.vmAlloc(n);
    I.push(str(new Uint8Array(n)));
  });
  d('anchorsearch', (I) => {
    const seek = I.popString();
    const s = I.popString();
    const a = strBytes(s);
    const b = strBytes(seek);
    I.work(Math.min(a.length, b.length));
    if (b.length <= a.length && b.every((c, k) => a[k] === c)) {
      I.push({ ...s, o: s.o + b.length, n: s.n - b.length });
      I.push({ ...s, n: b.length });
      I.push(TRUE);
    } else {
      I.push(s);
      I.push(FALSE);
    }
  });
  d('search', (I) => {
    const seek = I.popString();
    const s = I.popString();
    const a = strBytes(s);
    const b = strBytes(seek);
    // 探す手間は、2 つの長さの和に比例させる (Knuth・Morris・Pratt の探し方。素朴な二重のループは長さの積に比例し、
    // 10 万字の中から 5 万字を探すだけで数秒かかる)。その手間は、時間とステップの上限に数える
    const n = a.length;
    const m = b.length;
    I.work(n + m);
    let at = -1;
    if (m === 0) at = 0;
    else if (m <= n) {
      // fail[i]: b の先頭 i + 1 字の、前と後ろで一致する最も長い部分 (全体を除く) の長さ
      const fail = new Int32Array(m);
      for (let i = 1, k = 0; i < m; i++) {
        while (k > 0 && b[i] !== b[k]) k = fail[k - 1];
        if (b[i] === b[k]) k++;
        fail[i] = k;
      }
      for (let i = 0, k = 0; i < n; i++) {
        while (k > 0 && a[i] !== b[k]) k = fail[k - 1];
        if (a[i] === b[k]) k++;
        if (k === m) {
          at = i - m + 1;
          break;
        }
      }
    }
    if (at >= 0) {
      I.push({ ...s, o: s.o + at + m, n: s.n - at - m });
      I.push({ ...s, o: s.o + at, n: m });
      I.push({ ...s, n: at });
      I.push(TRUE);
      return;
    }
    I.push(s);
    I.push(FALSE);
  });
  d('token', (I) => {
    const o = I.pop();
    if (o.t === 'string') {
      const f = new PSFile(bytesSource(strBytes(o)), 'string');
      const t = scanToken(f, { packing: I.packing }, I);
      if (!t) return I.push(FALSE);
      const used = f.pos;
      I.push({ ...o, o: o.o + used, n: o.n - used });
      I.push(t);
      I.push(TRUE);
    } else if (o.t === 'file') {
      const t = scanToken(o.f, { packing: I.packing }, I);
      if (!t) return I.push(FALSE);
      I.push(t);
      I.push(TRUE);
    } else throw new PSError('typecheck');
  });

  // 比較・論理 (§8.2)
  /** 文字列・名前どうしの比較の手間 (長さに比例する) を数える */
  const cmpWork = (I: Interp, a: PSObj, b: PSObj) => {
    if (a.t === 'string' && (b.t === 'string' || b.t === 'name')) I.work(a.n);
    else if (b.t === 'string' && a.t === 'name') I.work(b.n);
  };
  d('eq', (I) => {
    const b = I.pop();
    const a = I.pop();
    cmpWork(I, a, b);
    I.push(bool(psEq(a, b)));
  });
  d('ne', (I) => {
    const b = I.pop();
    const a = I.pop();
    cmpWork(I, a, b);
    I.push(bool(!psEq(a, b)));
  });
  const cmp = (n: string, f: (c: number) => boolean) =>
    d(n, (I) => {
      const b = I.pop();
      const a = I.pop();
      let c: number;
      if ((a.t === 'int' || a.t === 'real') && (b.t === 'int' || b.t === 'real')) c = a.v - b.v;
      else if (a.t === 'string' && b.t === 'string') {
        cmpWork(I, a, b);
        const sa = strText(a);
        const sb = strText(b);
        c = sa < sb ? -1 : sa > sb ? 1 : 0;
      } else throw new PSError('typecheck');
      I.push(bool(f(c)));
    });
  cmp('ge', (c) => c >= 0);
  cmp('gt', (c) => c > 0);
  cmp('le', (c) => c <= 0);
  cmp('lt', (c) => c < 0);
  const logic = (n: string, fb: (a: boolean, b: boolean) => boolean, fi: (a: number, b: number) => number) =>
    d(n, (I) => {
      const b = I.pop();
      const a = I.pop();
      if (a.t === 'bool' && b.t === 'bool') I.push(bool(fb(a.v, b.v)));
      else if (a.t === 'int' && b.t === 'int') I.push(int(fi(a.v, b.v)));
      else throw new PSError('typecheck');
    });
  logic(
    'and',
    (a, b) => a && b,
    (a, b) => a & b,
  );
  logic(
    'or',
    (a, b) => a || b,
    (a, b) => a | b,
  );
  logic(
    'xor',
    (a, b) => a !== b,
    (a, b) => a ^ b,
  );
  d('not', (I) => {
    const a = I.pop();
    if (a.t === 'bool') I.push(bool(!a.v));
    else if (a.t === 'int') I.push(int(~a.v));
    else throw new PSError('typecheck');
  });
  d('bitshift', (I) => {
    const s = I.popInt();
    const a = I.popInt();
    // ずらし出したビットは捨て、ずらし入れるのは 0 (PLRM の bitshift)。JS のシフトは幅を 32 で割った余りを使うので、32 以上は 0
    I.push(int(Math.abs(s) >= 32 ? 0 : s >= 0 ? a << s : a >>> -s));
  });

  // 制御 (§8.2)
  d('exec', (I) => I.call(I.pop()));
  d('if', (I) => {
    const p = I.popProc();
    if (I.popBool()) I.call(p);
  });
  d('ifelse', (I) => {
    const p2 = I.popProc();
    const p1 = I.popProc();
    I.call(I.popBool() ? p1 : p2);
  });
  d('for', (I) => {
    const p = I.popProc();
    const lim = numOf(I.pop());
    const inc = numOf(I.pop());
    const ini = numOf(I.pop());
    const isInt = ini.t === 'int' && inc.t === 'int';
    for (let v = ini.v; inc.v >= 0 ? v <= lim.v : v >= lim.v; v += inc.v) {
      I.push(isInt ? int(v) : real(v));
      if (!I.loopBody(p)) break;
      if (inc.v === 0) I.tick();
    }
  });
  d('repeat', (I) => {
    const p = I.popProc();
    const n = I.popInt();
    if (n < 0) throw new PSError('rangecheck');
    for (let k = 0; k < n; k++) if (!I.loopBody(p)) break;
  });
  d('loop', (I) => {
    const p = I.popProc();
    while (I.loopBody(p)) I.tick();
  });
  d('exit', () => {
    throw new ExitSignal();
  });
  d('stop', () => {
    throw new StopSignal();
  });
  d('stopped', (I) => {
    const o = I.pop();
    I.push(bool(I.stopped(o)));
  });
  d('countexecstack', (I) => I.push(int(I.depth)));
  d('execstack', (I) => {
    const a = I.popArray();
    I.push({ ...a, n: 0 });
  });
  d('quit', () => {
    throw new QuitSignal('quit');
  });
  d('start', () => {});

  // 型・属性・変換 (§8.2)
  d('type', (I) => I.push(name(typeName(I.pop()), true)));
  d('cvlit', (I) => {
    const o = I.pop();
    I.push('x' in o ? ({ ...o, x: false } as PSObj) : o);
  });
  d('cvx', (I) => {
    const o = I.pop();
    I.push(o.t === 'int' || o.t === 'real' || o.t === 'bool' || o.t === 'mark' || o.t === 'save' || o.t === 'gstate' || o.t === 'fontid' || o.t === 'dict' ? o : ({ ...o, x: true } as PSObj));
  });
  d('xcheck', (I) => I.push(bool(isExec(I.pop()))));
  const setAcc = (acc: Access) => (I: Interp) => {
    const o = I.pop();
    if (o.t === 'dict') {
      o.d.acc = acc;
      I.push(o);
    } else if (o.t === 'array' || o.t === 'string') I.push({ ...o, acc });
    else if (o.t === 'file') I.push(o);
    else throw new PSError('typecheck');
  };
  d('executeonly', setAcc('executeonly'));
  d('noaccess', setAcc('none'));
  d('readonly', setAcc('readonly'));
  d('rcheck', (I) => {
    const o = I.pop();
    const acc = o.t === 'dict' ? o.d.acc : o.t === 'array' || o.t === 'string' ? (o.acc ?? 'unlimited') : 'unlimited';
    I.push(bool(acc === 'unlimited' || acc === 'readonly'));
  });
  d('wcheck', (I) => {
    const o = I.pop();
    const acc = o.t === 'dict' ? o.d.acc : o.t === 'array' || o.t === 'string' ? (o.acc ?? (o.t === 'array' && o.packed ? 'readonly' : 'unlimited')) : 'unlimited';
    I.push(bool(acc === 'unlimited'));
  });
  d('cvi', (I) => {
    const o = I.pop();
    if (o.t === 'int') return I.push(o);
    if (o.t === 'real') return I.push(int(Math.trunc(o.v)));
    if (o.t === 'string') {
      I.work(o.n);
      const n = parseNumber(strText(o).trim());
      if (!n || (n.t !== 'int' && n.t !== 'real')) throw new PSError('syntaxerror');
      return I.push(int(Math.trunc(n.v)));
    }
    throw new PSError('typecheck');
  });
  d('cvr', (I) => {
    const o = I.pop();
    if (o.t === 'int' || o.t === 'real') return I.push(real(o.v));
    if (o.t === 'string') {
      I.work(o.n);
      const n = parseNumber(strText(o).trim());
      if (!n || (n.t !== 'int' && n.t !== 'real')) throw new PSError('syntaxerror');
      return I.push(real(n.v));
    }
    throw new PSError('typecheck');
  });
  d('cvn', (I) => {
    const s = I.popString();
    // 名前の表に置く分 (§3.3.6)。短い名前は積まない (VM_NAME_FREE の説明)
    if (s.n > VM_NAME_FREE) {
      I.work(s.n);
      I.vmAlloc(s.n);
    }
    I.push(name(strText(s), s.x));
  });
  d('cvs', (I) => {
    const s = I.popString();
    const t = latin1(cvsText(I.pop()));
    if (t.length > s.n) throw new PSError('rangecheck');
    s.b.set(t, s.o);
    I.push({ ...s, n: t.length });
  });
  d('cvrs', (I) => {
    const s = I.popString();
    const radix = I.popInt();
    const v = I.popNum();
    const t = latin1(radix === 10 ? String(v) : (Math.trunc(v) >>> 0).toString(radix).toUpperCase());
    if (t.length > s.n) throw new PSError('rangecheck');
    s.b.set(t, s.o);
    I.push({ ...s, n: t.length });
  });

  // ファイル (§3.8。読み出しだけ)
  d('currentfile', (I) => {
    const f = I.fileStack[I.fileStack.length - 1];
    I.push(f ? { t: 'file', f, x: false } : { t: 'file', f: new PSFile(bytesSource(new Uint8Array(0)), 'invalid'), x: false });
  });
  const popFile = (I: Interp) => {
    const o = I.pop();
    if (o.t !== 'file') throw new PSError('typecheck');
    return o.f;
  };
  d('read', (I) => {
    const f = popFile(I);
    const c = f.read();
    if (c < 0) I.push(FALSE);
    else {
      I.push(int(c));
      I.push(TRUE);
    }
  });
  d('readhexstring', (I) => {
    const s = I.popString();
    const f = popFile(I);
    let n = 0;
    let hi = -1;
    while (n < s.n) {
      const c = f.read();
      if (c < 0) break;
      const v = hexVal(c);
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        s.b[s.o + n++] = hi * 16 + v;
        hi = -1;
      }
    }
    I.work(n);
    I.push({ ...s, n });
    I.push(bool(n === s.n));
  });
  d('readstring', (I) => {
    const s = I.popString();
    const f = popFile(I);
    let n = 0;
    while (n < s.n) {
      const c = f.read();
      if (c < 0) break;
      s.b[s.o + n++] = c;
    }
    I.work(n);
    I.push({ ...s, n });
    I.push(bool(n === s.n));
  });
  d('readline', (I) => {
    const s = I.popString();
    const f = popFile(I);
    let n = 0;
    let eol = false;
    for (;;) {
      const c = f.read();
      if (c < 0) break;
      if (c === 10) {
        eol = true;
        break;
      }
      if (c === 13) {
        if (f.peek() === 10) f.read();
        eol = true;
        break;
      }
      if (n >= s.n) throw new PSError('rangecheck');
      s.b[s.o + n++] = c;
    }
    I.push({ ...s, n });
    I.push(bool(eol));
  });
  d('bytesavailable', (I) => {
    popFile(I);
    I.push(int(-1));
  });
  d('closefile', (I) => popFile(I).close());
  d('flushfile', (I) => {
    // 読み出し用のファイルでは、ファイルの終わりまで読み捨てる (§8.2 flushfile)
    const f = popFile(I);
    if (f.label === 'program') return;
    while (f.read() >= 0) I.tick();
  });
  d('status', (I) => {
    const o = I.pop();
    if (o.t === 'file') I.push(bool(!o.f.closed));
    else {
      // 名前付きファイルは持たない
      I.push(FALSE);
    }
  });
  d('fileposition', (I) => I.push(int(popFile(I).pos)));
  d('resetfile', (I) => void popFile(I));
  d('file', (I) => {
    I.pop();
    I.pop();
    throw new PSError('invalidfileaccess');
  });
  d('run', (I) => {
    I.pop();
    throw new PSError('invalidfileaccess');
  });
  d('deletefile', () => {
    throw new PSError('invalidfileaccess');
  });
  d('renamefile', () => {
    throw new PSError('invalidfileaccess');
  });
  d('filenameforall', (I) => {
    I.pop();
    I.pop();
    I.pop();
  });
  d('write', (I) => {
    I.pop();
    I.pop();
  });
  d('writestring', (I) => {
    I.pop();
    I.pop();
  });
  d('writehexstring', (I) => {
    I.pop();
    I.pop();
  });
  d('flush', () => {});
  d('print', (I) => void I.pop());
  d('=', (I) => void I.pop());
  d('==', (I) => void I.pop());
  d('stack', () => {});
  d('pstack', () => {});
  d('echo', (I) => void I.pop());
  d('prompt', () => {});
  d('setfileposition', (I) => {
    I.pop();
    I.pop();
  });
  d('filter', (I) => {
    const fname = I.pop();
    if (fname.t !== 'name') throw new PSError('typecheck');
    // パラメータの辞書 (任意)。SubFileDecode は 2 つのパラメータを取る
    let params: PSDict | undefined;
    let subfile: { count: number; eod: Uint8Array } | undefined;
    // SubFileDecode のオペランドの形は 3 つ: 「元 EODCount EODString」「元 辞書 EODCount EODString」と、
    // LanguageLevel 3 の「元 辞書」(EODCount・EODString を辞書に入れる。PLRM §3.13.3 SubFileDecode Filter・表 3.23)。
    // 一番上が辞書なら、辞書の形 (下の「パラメータの辞書」で取り、filterSource が辞書から読む)
    const top = I.ostack[I.ostack.length - 1];
    if (fname.v === 'SubFileDecode' && top?.t !== 'dict') {
      const eod = I.pop();
      const count = I.popInt();
      if (eod.t !== 'string') throw new PSError('typecheck');
      subfile = { count, eod: strBytes(eod) };
    }
    let src = I.pop();
    if (src.t === 'dict') {
      params = src.d;
      src = I.pop();
    }
    let read: ByteSource;
    if (src.t === 'file') {
      const f = src.f;
      read = { read: () => f.read() };
    } else if (src.t === 'string') {
      I.vmAlloc(src.n);
      read = bytesSource(strBytes(src).slice());
    } else if (isProc(src) || src.t === 'operator') read = procSource(I, src);
    else throw new PSError('typecheck');
    // フィルタの持つ状態 (Flate の窓 32KB・LZW の表など) も VM に置く
    I.vmAlloc(fname.v === 'FlateDecode' || fname.v === 'LZWDecode' ? VM_FILTER_BIG : VM_FILTER);
    let fs: ByteSource;
    try {
      // 読みためるフィルタ (ReusableStreamDecode・DCTDecode) は、ためる分を VM に積みながら読む。上限を超えれば limitcheck
      // (PLRM §8.2 filter のエラーの一覧にある、実装の限界を超えたときのエラー)
      fs = filterSource(fname.v, read, params, subfile, { maxBytes: I.maxFilterBytes, alloc: (n) => I.vmAlloc(n) });
    } catch (e) {
      if (e instanceof FilterError) throw new PSError(e.message);
      throw e;
    }
    I.push({ t: 'file', f: new PSFile(fs, fname.v), x: false });
  });

  // VM (§3.7)
  d('save', (I) => I.push({ t: 'save', s: I.doSave() }));
  d('restore', (I) => {
    const o = I.pop();
    if (o.t !== 'save') throw new PSError('typecheck');
    I.doRestore(o.s);
  });
  d('setglobal', (I) => void (I.globalAlloc = I.popBool()));
  d('currentglobal', (I) => I.push(bool(I.globalAlloc)));
  d('gcheck', (I) => {
    const o = I.pop();
    I.push(bool(o.t === 'dict' ? o.d.global : o.t === 'array' ? I.globalArrays.has(o.a) : false));
  });
  d('vmstatus', (I) => {
    I.push(int(I.saves.length));
    I.push(int(100000));
    I.push(int(10000000));
  });
  d('vmreclaim', (I) => void I.pop());
  d('setvmthreshold', (I) => void I.pop());
  d('bind', (I) => {
    // 手続きの中の、演算子を値に持つ名前を演算子に置き換える (§3.12.1・§8.2 bind)
    const p = I.pop();
    const seen = new Set<PSObj[]>();
    // 入れ子の深さに上限を置く (字句の { } は 1000 段で止まるが、プログラムで作った入れ子 ([ exch ] cvx の繰り返し) は止まらない)。
    // 深い所は束縛しないだけで、意味は変わらない (bind は最適化)
    const bindProc = (a: PSArray, depth: number) => {
      if (seen.has(a.a) || depth > 1000) return;
      seen.add(a.a);
      I.work(a.n);
      for (let k = a.o; k < a.o + a.n; k++) {
        const o = a.a[k];
        if (o.t === 'name' && o.x) {
          const v = I.lookup(o.v);
          if (v && v.t === 'operator') a.a[k] = v;
        } else if (o.t === 'array' && o.x) bindProc(o, depth + 1);
      }
    };
    if (p.t === 'array') bindProc(p, 0);
    I.push(p);
  });

  // 雑多 (§8.2)
  d('null', (I) => I.push(NULL));
  d('version', (I) => I.push(str('3010')));
  // languagelevel: 演算子ではなく整数 3 として定義する。名前を実行すると 3 が積まれるのは演算子と同じで、
  // Adobe CoolType の手続き集の「systemdict /languagelevel get 2 ge」(get のあと exec しない) も通る
  I.systemdict.map.set('languagelevel', { k: name('languagelevel'), v: int(3) });
  d('realtime', (I) => I.push(int(Date.now() & 0x7fffffff)));
  d('usertime', (I) => I.push(int(I.steps & 0x7fffffff)));
  d('product', (I) => I.push(str('Kumiori')));
  d('revision', (I) => I.push(int(1)));
  d('serialnumber', (I) => I.push(int(0)));
  d('executive', () => {});
  // ユーザパラメータ・システムパラメータ (付録 C の表 C.1・C.2)。値は実装に依存するので、上限は大きめの値にする
  const params = (pairs: Array<[string, PSObj]>) => {
    const p = new PSDict(I, pairs.length);
    p.global = true;
    for (const [k, v] of pairs) p.map.set(k, { k: name(k), v });
    return p;
  };
  const big = int(100_000_000);
  const userParams = params([
    ['AccurateScreens', FALSE],
    ['HalftoneMode', int(0)],
    ['IdiomRecognition', FALSE],
    ['JobName', str('')],
    ['MaxDictStack', int(1000)],
    ['MaxExecStack', int(1500)],
    ['MaxFontItem', big],
    ['MaxFormItem', big],
    ['MaxLocalVM', big],
    ['MaxOpStack', int(100000)],
    ['MaxPatternItem', big],
    ['MaxScreenItem', big],
    ['MaxSuperScreen', int(1016)],
    ['MaxUPathItem', big],
    ['MinFontCompress', int(100)],
    ['VMReclaim', int(0)],
    ['VMThreshold', int(1000000)],
  ]);
  const sysParams = params(
    [
      'CurDisplayList',
      'CurFontCache',
      'CurFormCache',
      'CurOutlineCache',
      'CurPatternCache',
      'CurScreenStorage',
      'CurSourceList',
      'CurStoredScreenCache',
      'CurUPathCache',
    ]
      .map((k): [string, PSObj] => [k, int(0)])
      .concat(
        [
          'MaxDisplayAndSourceList',
          'MaxDisplayList',
          'MaxFontCache',
          'MaxFormCache',
          'MaxImageBuffer',
          'MaxOutlineCache',
          'MaxPatternCache',
          'MaxScreenStorage',
          'MaxSourceList',
          'MaxStoredScreenCache',
          'MaxUPathCache',
        ].map((k): [string, PSObj] => [k, big]),
      )
      .concat([
        ['ByteOrder', FALSE],
        ['BuildTime', int(0)],
        ['PageCount', int(0)],
        ['Revision', int(1)],
        ['RealFormat', str('IEEE')],
        ['PrinterName', str('Kumiori')],
        ['StartupMode', int(0)],
        ['FontResourceDir', str('')],
        ['GenericResourceDir', str('')],
        ['GenericResourcePathSep', str('/')],
      ]),
  );
  const copyParams = (src: PSDict) => {
    const c = I.newDict(src.size);
    for (const { k, v } of src.map.values()) c.put(k, v);
    return dictObj(c);
  };
  d('setuserparams', (I) => {
    const p = I.popDict();
    for (const { k, v } of p.map.values()) if (k.t === 'name' && userParams.has(k.v)) userParams.put(k, v);
  });
  d('currentuserparams', (I) => I.push(copyParams(userParams)));
  d('setsystemparams', (I) => void I.pop());
  d('currentsystemparams', (I) => I.push(copyParams(sysParams)));
  d('setdevparams', (I) => {
    I.pop();
    I.pop();
  });
  d('currentdevparams', (I) => {
    I.pop();
    I.push(dictObj(I.newDict()));
  });
  d('setobjectformat', (I) => void I.pop());
  d('currentobjectformat', (I) => I.push(int(0)));
  d('defineuserobject', (I) => {
    I.pop();
    I.pop();
  });
  d('undefineuserobject', (I) => void I.pop());
  d('execuserobject', (I) => void I.pop());
  d('UserObjects', (I) => I.push(I.newArray([])));
  // internaldict (§8.2): 合言葉 1183615869 で、内部の辞書を返す
  const internal = new PSDict(I, 10);
  internal.global = true;
  d('internaldict', (I) => {
    if (I.popInt() !== 1183615869) throw new PSError('invalidaccess');
    I.push(dictObj(internal));
  });
  d('sethalftonephase', (I) => {
    I.pop();
    I.pop();
  });
  // 取るオペランドの個数 (PLRM の演算子の形から。手続きを実行するもの (exec・if・ifelse・for・repeat・loop・forall・stopped・run・
  // filter・bind・token など) と、個数の決まらないもの (copy・index・roll・]・>>・astore・packedarray・aload の逆) は付けない)
  I.operandCounts({
    pop: 1, exch: 0, dup: 0, clear: 0, count: 0, mark: 0, '[': 0, '<<': 0, cleartomark: 0, counttomark: 0,
    add: 2, sub: 2, mul: 2, div: 2, idiv: 2, mod: 2, abs: 1, neg: 1, ceiling: 1, floor: 1, round: 1, truncate: 1,
    sqrt: 1, atan: 2, cos: 1, sin: 1, exp: 2, ln: 1, log: 1, rand: 0, srand: 1, rrand: 0,
    array: 1, length: 1, get: 2, put: 3, getinterval: 3, putinterval: 3, aload: 1, setpacking: 1, currentpacking: 0,
    dict: 1, maxlength: 1, begin: 1, end: 0, def: 2, load: 1, store: 2, undef: 2, known: 2, where: 1,
    currentdict: 0, countdictstack: 0, cleardictstack: 0,
    string: 1, anchorsearch: 2, search: 2,
    eq: 2, ne: 2, ge: 2, gt: 2, le: 2, lt: 2, and: 2, or: 2, xor: 2, not: 1, bitshift: 2,
    countexecstack: 0, quit: 0, start: 0,
    type: 1, cvlit: 1, cvx: 1, xcheck: 1, executeonly: 1, noaccess: 1, readonly: 1, rcheck: 1, wcheck: 1,
    cvi: 1, cvr: 1, cvn: 1, cvs: 2, cvrs: 3,
    currentfile: 0, read: 1, readhexstring: 2, readstring: 2, readline: 2, bytesavailable: 1, closefile: 1, flushfile: 1,
    status: 1, fileposition: 1, resetfile: 1, file: 2, write: 2, writestring: 2, writehexstring: 2, flush: 0,
    print: 1, '=': 1, '==': 1, stack: 0, pstack: 0, echo: 1, prompt: 0, setfileposition: 2,
    save: 0, restore: 1, setglobal: 1, currentglobal: 0, gcheck: 1, vmstatus: 0, vmreclaim: 1, setvmthreshold: 1,
    null: 0, version: 0, realtime: 0, usertime: 0, product: 0, revision: 0, serialnumber: 0, executive: 0,
    setuserparams: 1, currentuserparams: 0, setsystemparams: 1, currentsystemparams: 0, setdevparams: 2, currentdevparams: 1,
    setobjectformat: 1, currentobjectformat: 0, defineuserobject: 2, undefineuserobject: 1, execuserobject: 1, UserObjects: 0,
    internaldict: 1, sethalftonephase: 2,
  });
}

/** 手続きをデータの元にする: 呼ぶたびに返す文字列を続けて読む。長さ 0 の文字列で終わり (§3.13 データの元) */
export function procSource(I: Interp, p: PSObj): ByteSource {
  let buf: Uint8Array = new Uint8Array(0);
  let i = 0;
  let done = false;
  return {
    read: () => {
      while (i >= buf.length) {
        if (done) return -1;
        I.call(p);
        const s = I.pop();
        if (s.t !== 'string') throw new PSError('typecheck');
        buf = strBytes(s).slice();
        i = 0;
        if (!buf.length) {
          done = true;
          return -1;
        }
      }
      return buf[i++];
    },
  };
}
