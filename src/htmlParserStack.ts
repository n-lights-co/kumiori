/**
 * Node と Web Worker の中で HTML を読む構文解析器 (linkedom が使う htmlparser2) の、開いた要素の列の持ち方を軽くする。
 *
 * htmlparser2 の Parser は、開いた要素の名前の列 (stack) と、外来の要素 (svg・math) の中かどうかの列 (foreignContext) を、
 * 先頭を「いちばん内側」とする配列で持ち、要素を開くたびに先頭へ足し (unshift)、閉じるたびに先頭から取る (shift)。
 * 配列の先頭への足し引きは、配列の全体をずらすので、閉じられない要素が深く積もる文書 (<b><i><a><font> × 3 万、
 * <h1><button> × 5 万。htmlparser2 は、HTML Living Standard §13.2.6 の木の組み立てのように前の a・button・見出しを閉じない) で、
 * 深さの 2 乗の手間になった (5 万で約 10 秒)。
 *
 * ここでは、Parser が作る 2 つの配列を、同じ見え方 (添字 0 がいちばん内側。shift・unshift・indexOf・length・添字) のまま、
 * 中では末尾で足し引きする入れ物 (TopFirstList) に替える。構文解析の結果 (DOM) は変わらない。
 * Parser の作りが、ここで受け持つ使い方 (上の操作だけ) から外れていれば (htmlparser2 の版が変わったときなど)、替えずにそのまま使う
 */
import { importHtmlparser2 } from './linkedomModules';
import { rejoin, thisCall } from './callContext';

/** 添字 0 を末尾の要素とする列 (配列を逆に見る)。先頭への足し引きが、配列の末尾への足し引きになる */
class TopFirstList {
  /** 中身 (末尾がいちばん内側) */
  readonly items: unknown[] = [];
  constructor(from: readonly unknown[]) {
    for (let i = from.length - 1; i >= 0; i--) this.items.push(from[i]);
  }
  shift(): unknown {
    return this.items.pop();
  }
  unshift(...xs: unknown[]): number {
    for (let i = xs.length - 1; i >= 0; i--) this.items.push(xs[i]);
    return this.items.length;
  }
  indexOf(x: unknown): number {
    const a = this.items;
    for (let i = a.length - 1; i >= 0; i--) if (a[i] === x) return a.length - 1 - i;
    return -1;
  }
}

const INDEX = /^(?:0|[1-9]\d*)$/;
/** 配列と同じに読み書きできる、TopFirstList の見え方 (添字・length は Proxy で読み替える) */
export function topFirstArray(from: readonly unknown[]): unknown[] {
  const list = new TopFirstList(from);
  const methods = { shift: list.shift.bind(list), unshift: list.unshift.bind(list), indexOf: list.indexOf.bind(list) };
  return new Proxy(list, {
    get(target, prop) {
      if (prop === 'length') return target.items.length;
      if (typeof prop === 'string') {
        if (INDEX.test(prop)) {
          const i = +prop;
          return i < target.items.length ? target.items[target.items.length - 1 - i] : undefined;
        }
        if (prop in methods) return methods[prop as keyof typeof methods];
      }
      return undefined;
    },
    set(target, prop, value) {
      const a = target.items;
      if (prop === 'length') {
        // 配列の length を縮めるのと同じ: 添字の小さい (内側の) n 個を残す
        const n = Number(value);
        if (!(n >= 0 && n <= a.length && Number.isInteger(n))) return false;
        a.splice(0, a.length - n);
        return true;
      }
      if (typeof prop === 'string' && INDEX.test(prop) && +prop < a.length) {
        a[a.length - 1 - +prop] = value;
        return true;
      }
      return false;
    },
  }) as unknown as unknown[];
}

/** 替える配列の名前 (Parser の持ち物) */
const LISTS = ['stack', 'foreignContext'] as const;
/** ここで受け持つ使い方 (Parser の中の、これらの配列への操作) */
const SUPPORTED_USE = /^(?:\.(?:shift|unshift|indexOf|length)\b|\[|\s*=\s*\[)/;

/**
 * Parser の作り (クラスの元の字) が、2 つの配列を、ここで受け持つ使い方だけでたどっているか。
 * 配列を作るのは、コンストラクターの代入 (this.stack = [...]) だけであること (代入のたびに、下の setter で入れ物に替える)
 */
export function parserUsesSupportedListOps(source: string): boolean {
  let seen = 0;
  for (const name of LISTS) {
    const re = new RegExp(`this\\.${name}\\b`, 'g');
    let assigned = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      seen++;
      const rest = source.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (!SUPPORTED_USE.test(rest)) return false;
      if (/^\s*=\s*\[/.test(rest)) assigned++;
    }
    if (assigned !== 1) return false;
  }
  return seen > 0;
}

/** 入れ物に替えた配列の数 (テストで、linkedom の使う Parser が替わっていることを確かめる) */
let wrapped = 0;
export const parserListsWrapped = () => wrapped;

let patched: Promise<boolean> | undefined;

/**
 * htmlparser2 の Parser に、2 つの配列を入れ物に替える仕掛けを入れる (1 度だけ。linkedom を読み込む前後のどちらでもよい)。
 * 入れたか (htmlparser2 が読めない・作りが受け持つ使い方から外れているときは偽で、何もしない)
 */
export function patchHtmlParserStack(): Promise<boolean> {
  return (patched ??= (async () => {
    let Parser: unknown;
    try {
      Parser = rejoin(thisCall(), await importHtmlparser2()).Parser;
    } catch {
      return false;
    }
    if (typeof Parser !== 'function' || !parserUsesSupportedListOps(Function.prototype.toString.call(Parser))) return false;
    const proto = Parser.prototype as object;
    for (const name of LISTS) {
      if (Object.prototype.hasOwnProperty.call(proto, name)) return false;
    }
    for (const name of LISTS) {
      Object.defineProperty(proto, name, {
        configurable: true,
        get: () => undefined,
        set(this: object, v: unknown) {
          const value = Array.isArray(v) ? (wrapped++, topFirstArray(v)) : v;
          Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true });
        },
      });
    }
    return true;
  })());
}
