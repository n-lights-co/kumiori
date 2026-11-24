/**
 * 呼び出しごとの文脈: 1 回の呼び出し (typeset・toPdf など) の間だけ効く設定を持つ所。
 * 同時に走る呼び出し (await を待たずに重ねた呼び出し) の間で、設定が混ざらないようにする。
 *  - いまは、警告・誤りの文の言語 (lang) を持つ。止める合図・進み具合・上限なども、ここに欄を足して持つ
 *    (欄はどれも省略できる形で足し、文脈を作る所 (api.ts の入口) で埋める)
 *  - 置き場所は 2 つ。AsyncLocalStorage (Node。Deno・Bun も Node の互換で持つ) があれば、それで持つ (await をまたいでも、その呼び出しの文脈がついてくる)。
 *    無ければ (ブラウザ・Web Worker)、モジュールの変数で持つ: 同期の区間の途中では、ほかの呼び出しは割り込まないので、
 *    区間の初めに「いまの文脈」を置けば、その区間は正しい。割り込みが起きるのは await の後だけなので、呼び出しの道筋の await の後で
 *    置き直す (rejoin。then などの呼び返しは bound で包む)。置き直していない続きは、最後に置かれた文脈のまま
 */
import type { Limits } from './limits';
import type { MessageLang } from './messages';

/**
 * 進み具合 (TypesetOptions.onProgress に渡すもの)。段階 (phase) は、この並びの順に来る (使わない段階は飛ばす)。
 *  - 'fonts': 書体の読み込み (createTypesetter と、typeset・typesetToPdf の初めの既定の書体・fonts の書体)。loaded / total は書体の数
 *  - 'resources': 文書の資源の読み込み (CSS・@font-face の書体・画像・数式などの書体)。loaded は読み終えた数 (total は前もって分からないので無い)
 *  - 'import': 文書の読み込み・カスケード (HTML・XSL-FO を組版の木にする)。始まりに 1 回
 *  - 'layout': 組版。pass は組み直しの回 (1 から)、pages はその回で作ったページの数。ページを作るたびに 1 回
 *  - 'pdf': PDF の書き出し。pages は書いたページの数、total は総ページ数
 */
export interface TypesetProgress {
  phase: 'fonts' | 'resources' | 'import' | 'layout' | 'pdf';
  pass?: number;
  pages?: number;
  loaded?: number;
  total?: number;
}

/** 1 回の呼び出しの文脈 */
export interface CallContext {
  /** 警告・誤りの文の言語 */
  readonly lang: MessageLang;
  /** 止める合図 (TypesetOptions.signal など。WHATWG DOM §3.2) */
  readonly signal?: AbortSignal;
  /** 進み具合の呼び返し (TypesetOptions.onProgress など) */
  readonly onProgress?: (progress: TypesetProgress) => void;
  /** 入力の上限 (limits.ts。無ければ既定の値) */
  readonly limits?: Limits;
  /** この呼び出しで当たった上限の名前 (limits.ts の noteLimitReached が足す。呼び出しの終わりに診断 limit/reached にする) */
  readonly limitsReached?: Set<string>;
}

/** 文脈の置き場所 */
interface CallStore {
  /** いまの文脈 (呼び出しの外なら undefined) */
  get(): CallContext | undefined;
  /** fn の間 (fn の返す Promise が決まるまで) を、ctx の文脈にする */
  run<T>(ctx: CallContext, fn: () => T): T;
  /** await の後で、ctx をいまの文脈に置き直す (AsyncLocalStorage では要らない) */
  resume(ctx: CallContext): void;
}

/** Promise のようなもの (then を持つ) か */
function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

/**
 * モジュールの変数で持つ置き場所 (AsyncLocalStorage の無い環境)。current は、いまの同期の区間の文脈。
 * run の初めに置き、fn の同期の部分が終わったら、呼び出し元の文脈に戻す。await の後は、rejoin で置き直す
 * (置き直していない続きは、最後に置かれた文脈のまま)。呼び出しが終わったとき、いまの区間がその呼び出しのものなら、呼び出しの外に戻す
 */
function moduleStore(): CallStore {
  let current: CallContext | undefined;
  return {
    get: () => current,
    run(ctx, fn) {
      const outer = current;
      current = ctx;
      let out: unknown;
      try {
        out = fn();
      } finally {
        current = outer;
      }
      if (!isThenable(out)) return out as ReturnType<typeof fn>;
      return Promise.resolve(out).finally(() => {
        if (current === ctx) current = undefined;
      }) as ReturnType<typeof fn>;
    },
    resume(ctx) {
      current = ctx;
    },
  };
}

/** AsyncLocalStorage の形 (node:async_hooks。型は Node の型に頼らずに書く) */
interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/**
 * AsyncLocalStorage で持つ置き場所。process.getBuiltinModule (Node 20.16・22.3 から) で取るので、import を書かない
 * (ブラウザ向けのビルドが node の部品を探さない)。取れなければ undefined
 */
function asyncStore(): CallStore | undefined {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const mod = proc?.getBuiltinModule?.('node:async_hooks') as { AsyncLocalStorage?: new () => AsyncLocalStorageLike<CallContext> } | undefined;
    if (!mod?.AsyncLocalStorage) return undefined;
    const als = new mod.AsyncLocalStorage();
    return {
      get: () => als.getStore(),
      run: (ctx, fn) => als.run(ctx, fn),
      resume: () => {},
    };
  } catch {
    return undefined;
  }
}

let store: CallStore = asyncStore() ?? moduleStore();

/** いまの文脈 (呼び出しの外なら undefined) */
export function currentCall(): CallContext | undefined {
  return store.get();
}

/** fn の間を、ctx の文脈にする (fn が Promise を返せば、それが決まるまで) */
export function runInCall<T>(ctx: CallContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/**
 * await の後の置き直し (AsyncLocalStorage の無い環境のため)。呼び出しの道筋の async の関数の await は、どれも
 * `rejoin(thisCall(), await X)` と書く: 引数は左から順に評価されるので、thisCall() は await の前 (まだ自分の区間) に文脈を取り、
 * rejoin は await の後の続き (自分の区間の初め) で、その文脈を置き直して、await の値をそのまま返す。
 * AsyncLocalStorage の置き場所では、thisCall は文脈を返し、rejoin は値を返すだけ (置き直しは要らない)
 */
export function thisCall(): CallContext | undefined {
  return store.get();
}

/** await の後で ctx を置き直し、value をそのまま返す (thisCall の説明) */
export function rejoin<T>(ctx: CallContext | undefined, value: T): T {
  if (ctx) store.resume(ctx);
  return value;
}

/**
 * Promise の then・catch・finally に渡す関数を、いまの文脈で走るように包む (呼び返しは、後のマイクロタスクで、
 * ほかの呼び出しの区間の後に走りうるので、走る初めに、包んだときの文脈を置き直す)
 */
export function bound<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ctx = store.get();
  return (...a: A) => {
    if (ctx) store.resume(ctx);
    return fn(...a);
  };
}

/**
 * 進み具合の呼び返し (onProgress) が投げた誤り (呼び出しごと)。投げた誤りは組版を止めて、返す Promise の失敗になる約束なので、
 * 途中で誤りを飲む所 (画像の形式の読み込みなど: 形式の誤りを、読めない画像として扱う) を通っても、次の checkAbort・reportProgress で投げ直す
 */
const progressFailures = new WeakMap<CallContext, { error: unknown }>();

/**
 * 止める合図が来ていれば、その理由を投げる (WHATWG DOM §3.2 の throwIfAborted: 理由 (reason) を投げる。理由を渡さずに abort() したときは
 * AbortError の名前の DOMException)。合図が無ければ何もしない。進み具合の呼び返しが前に誤りを投げていれば、その誤りを投げる
 */
export function checkAbort(ctx: CallContext | undefined = store.get()): void {
  if (!ctx) return;
  const failed = progressFailures.get(ctx);
  if (failed) throw failed.error;
  ctx.signal?.throwIfAborted();
}

/** 進み具合を知らせる (呼び返しは同期で呼び、投げた誤りはそのまま返す)。続けて止める合図を確かめる (呼び返しの中で abort() したら、すぐ止める) */
export function reportProgress(p: TypesetProgress, ctx: CallContext | undefined = store.get()): void {
  if (!ctx) return;
  // 止めた後 (止める合図・呼び返しの誤り) は、呼び返しを呼ばない (並べて走る資源の読み込みが、返す Promise の失敗の後に知らせない)
  checkAbort(ctx);
  try {
    ctx.onProgress?.(p);
  } catch (e) {
    progressFailures.set(ctx, { error: e });
    throw e;
  }
  ctx.signal?.throwIfAborted();
}

/**
 * p を待つ。その間に止める合図が来たら、p を待たずに合図の理由で失敗する (p そのものは止めない: ほかの呼び出しと分け合う読み込みの Promise を、
 * この呼び出しの合図で止めないため)。合図が無ければ p をそのまま返す
 */
export function untilAbort<T>(p: Promise<T>, ctx: CallContext | undefined = store.get()): Promise<T> {
  const signal = ctx?.signal;
  if (!signal) return p;
  if (signal.aborted) {
    // 捨てる p の失敗を、拾われない失敗にしない
    p.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((ok, ng) => {
    const onAbort = () => ng(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
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
}

/**
 * 取得 (fetch) に渡す合図: 時限 (timeoutMs。0・undefined なら無し) と、いまの呼び出しの止める合図を合わせたもの (WHATWG DOM §3.2 の AbortSignal.any)。
 * どちらも無ければ undefined
 */
export function fetchSignal(timeoutMs?: number, ctx: CallContext | undefined = store.get()): AbortSignal | undefined {
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const call = ctx?.signal;
  if (!call) return timeout;
  if (!timeout) return call;
  return AbortSignal.any([timeout, call]);
}

/** 間をあける呼び出しか (止める合図か進み具合の呼び返しを渡した呼び出し。渡さなければ、組版の途中で間をあけない) */
export function pacing(ctx: CallContext | undefined = store.get()): boolean {
  return !!ctx && (!!ctx.signal || !!ctx.onProgress);
}

/** 呼び出しごとの、前に間をあけた時刻 (pause が、短い間に何度もタスクを返さないように) */
const lastPause = new WeakMap<CallContext, number>();
/** 間をあける間隔 (ミリ秒。1 コマ (60Hz) の長さ。これより短い間に呼ばれた pause は、合図を確かめるだけ) */
const PAUSE_INTERVAL_MS = 16;

/**
 * 間をあける: 止める合図を確かめ、前に間をあけてから PAUSE_INTERVAL_MS 以上たっていれば、1 度タスクを返して (ほかの処理を走らせて)、もう 1 度確かめる。
 * 間をあける呼び出しでなければ何もしない (呼ぶ側は pacing() のときだけ await する)
 */
export async function pause(ctx: CallContext | undefined = store.get()): Promise<void> {
  if (!ctx || !pacing(ctx)) return;
  checkAbort(ctx);
  const now = Date.now();
  if (now - (lastPause.get(ctx) ?? 0) < PAUSE_INTERVAL_MS) return;
  await yieldTask();
  // await の後は、この呼び出しの文脈に置き直す (rejoin と同じ。このファイルは rejoin を使わずに直に書く)
  store.resume(ctx);
  lastPause.set(ctx, Date.now());
  checkAbort(ctx);
}

/**
 * タスクを 1 度返す: scheduler.yield があればそれ (ブラウザ。Prioritized Task Scheduling)、無ければ setImmediate (Node)、MessageChannel (ブラウザ・Worker)。
 * setTimeout(0) は、入れ子になると 4ms 待つ (HTML の timer initialization steps) ので、最後の手段にする
 */
function yieldTask(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> }; setImmediate?: (f: () => void) => unknown; MessageChannel?: typeof MessageChannel };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof g.setImmediate === 'function') return new Promise((ok) => g.setImmediate!(ok));
  if (typeof g.MessageChannel === 'function') {
    return new Promise((ok) => {
      const ch = new g.MessageChannel!();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ok();
      };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((ok) => setTimeout(ok, 0));
}

/**
 * 試験だけで使う: 置き場所を切り替える ('async' は AsyncLocalStorage、'module' はモジュールの変数)。
 * 進行中の呼び出しが無いときに呼ぶこと。'async' を選んで AsyncLocalStorage が無ければ false
 */
export function __setCallStoreForTest(kind: 'async' | 'module'): boolean {
  const next = kind === 'async' ? asyncStore() : moduleStore();
  if (!next) return false;
  store = next;
  return true;
}
