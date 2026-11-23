/**
 * snapshotDocument — ブラウザの画面で、JS が組み上げた後の文書を文字 (HTML) にして、typeset にそのまま渡せる形にする。
 *
 * Kumiori は JS を動かさない。'<!doctype html>' + outerHTML だけでは落ちるもの (フォームのいまの値・相対の URL の基準など) を拾い、
 * 文字にする時を待つ仕組みと合わせて、1 つの関数にする。元の文書は変えない: 写しは、画面と関わりの無い文書
 * (document.implementation.createHTMLDocument。閲覧の文脈が無いので、画像を読まず、カスタム要素も作らない) に作る。
 *
 * 使えるのは、DOM と画面の描画のある所 (ブラウザの画面) だけ。Web Worker と Node では KumioriOptionError を投げる。
 * 組版の本体 (htmlImport.ts など) は読まない (使わない利用者のバンドルでは、木の揺すりで落ちる)。
 */
import type { KumioriFile, KumioriFileData, KumioriLimits } from './api';
import { checkAbort, rejoin, runInCall, thisCall, untilAbort, type CallContext } from './callContext';
import { diag, type Diagnostic } from './diagnostics';
import { KumioriOptionError } from './errors';
import { cleanUrl } from './linkPolicy';
import { DEFAULT_LIMITS, LIMIT_DEFS } from './limits';
import { MESSAGE_LANGS, messageLang, msg, type MessageLang } from './messages';
import { mapStyleRuleSelectors, quoteCss, renameTypeSelector, rewriteCssUrls, ruleDiff, scopeSelectorList, splitSelectorList } from './snapshotCss';

/** snapshotDocument の選択肢。どれも省略できる。知らない名前・型の違う値は KumioriOptionError (TypeError) で拒む */
export interface SnapshotOptions {
  /**
   * ページの側の「準備できた」の合図。Promise ならそれを待つ。関数なら、真の値を返すまで (Promise を返せば、その解決の値が真になるまで)、
   * 画面の描画の回 (requestAnimationFrame) ごとに呼ぶ
   */
  waitFor?: PromiseLike<unknown> | (() => unknown);
  /** 待つ時間の上限 (ミリ秒。既定 10000)。過ぎたら、その時の文書で文字にして、snapshot/wait-timeout の警告を出す */
  timeoutMs?: number;
  /** 止める合図 (WHATWG DOM §3.2 の AbortSignal)。止めると、返す Promise は signal.reason で失敗する */
  signal?: AbortSignal;
  /**
   * 中身に入れる影の木の根 (閉じた根を含む。HTML の getHTML() の shadowRoots と同じ考え)。開いた根 (Element.shadowRoot で見えるもの) は、渡さなくても入れる
   */
  shadowRoots?: ShadowRoot[];
  /**
   * CSS の `@font-face` に繋がらない書体 (new FontFace で作って document.fonts に足したもの) の中身を返す関数。
   * FontFace は書体のファイルの中身も URL も返さない (CSS Font Loading 3 §2) ので、ページの側で渡す。
   * 書体のファイルの中身 (ArrayBuffer・Uint8Array) か、書体の URL (文字列) を返す。undefined なら取り込まない
   */
  fontSources?: (face: FontFace) => KumioriFileData | undefined | PromiseLike<KumioriFileData | undefined>;
  /** canvas の扱い。'png' (既定): 絵を PNG にして img に置き換える。'skip': 置き換えない (canvas の代わりの中身を組む) */
  canvas?: 'png' | 'skip';
  /** 上限 (imagePixels・fileBytes は TypesetOptions.limits と同じ名前と既定。snapshotBytes は取り込む合計のバイト。既定 512MB) */
  limits?: Pick<KumioriLimits, 'imagePixels' | 'fileBytes'> & { snapshotBytes?: number };
  /** 警告の文の言語 (既定は setMessageLang で決めた言語) */
  lang?: MessageLang;
}

/** snapshotDocument の結果 */
export interface DocumentSnapshot {
  /** 文字にした文書 (<!doctype html> から) */
  html: string;
  /** typeset の選択肢にそのまま渡すもの (kind・name・files)。files の data はどれも Uint8Array (postMessage で Worker に送れる) */
  options: { kind: 'html'; name: string; files: KumioriFile[] };
  /** 文字にしたときの文書の基準の URL (document.baseURI)。html の中の URL は、もう絶対の URL にしてある */
  baseUrl: string;
  /** 取れなかったもの・近似したもの (snapshot/… の診断) */
  diagnostics: Diagnostic[];
  /** diagnostics の文 */
  warnings: string[];
}

/** 写しの中の名前 (files の名前。文書の名前 options.name からの相対のパス) の頭 */
export const SNAPSHOT_DIR = 'kumiori-snapshot';
/** 文字にした文書の名前 (options.name) */
const SNAPSHOT_NAME = 'snapshot.html';
/** 待つ時間の既定 (ミリ秒) */
const DEFAULT_TIMEOUT_MS = 10_000;
/** 取り込む合計の既定 (バイト) */
const DEFAULT_SNAPSHOT_BYTES = 512 * 1024 * 1024;

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const optionError = (m: string, option?: string) => new KumioriOptionError(msg(`選択肢の誤り: ${m}`, `invalid option: ${m}`), option);

const OPTION_NAMES = ['waitFor', 'timeoutMs', 'signal', 'shadowRoots', 'fontSources', 'canvas', 'limits', 'lang'] as const;

/** 選択肢を確かめて、上限を埋めたものを返す */
function checkOptions(o: unknown): { o: SnapshotOptions; limits: { imagePixels: number; fileBytes: number; snapshotBytes: number } } {
  if (o === undefined) o = {};
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw optionError(msg('snapshotDocument の選択肢はオブジェクトにしてください', 'snapshotDocument options must be an object'));
  const so = o as SnapshotOptions & Record<string, unknown>;
  for (const k of Object.keys(so)) if (so[k] !== undefined && !(OPTION_NAMES as readonly string[]).includes(k)) throw optionError(msg(`${k} は snapshotDocument の選択肢にありません`, `${k} is not a snapshotDocument option`), k);
  const wf = so.waitFor as unknown;
  if (wf !== undefined && typeof wf !== 'function' && !isThenable(wf)) throw optionError(msg('waitFor は Promise か関数にしてください', 'waitFor must be a Promise or a function'), 'waitFor');
  const t = so.timeoutMs;
  if (t !== undefined && !(typeof t === 'number' && Number.isFinite(t) && t >= 0)) throw optionError(msg(`timeoutMs は 0 以上の数 (ミリ秒) にしてください: ${String(t)}`, `timeoutMs must be a number of milliseconds (0 or more): ${String(t)}`), 'timeoutMs');
  const sg = so.signal as { aborted?: unknown; addEventListener?: unknown; throwIfAborted?: unknown } | undefined;
  if (sg !== undefined && (typeof sg !== 'object' || sg === null || typeof sg.aborted !== 'boolean' || typeof sg.addEventListener !== 'function' || typeof sg.throwIfAborted !== 'function'))
    throw optionError(msg('signal は AbortSignal にしてください', 'signal must be an AbortSignal'), 'signal');
  const sr = so.shadowRoots as unknown;
  if (sr !== undefined && !(Array.isArray(sr) && sr.every((r) => typeof r === 'object' && r !== null && typeof (r as ShadowRoot).host === 'object' && (r as ShadowRoot).host !== null)))
    throw optionError(msg('shadowRoots は ShadowRoot の配列にしてください', 'shadowRoots must be an array of ShadowRoot'), 'shadowRoots');
  if (so.fontSources !== undefined && typeof so.fontSources !== 'function') throw optionError(msg('fontSources は関数にしてください', 'fontSources must be a function'), 'fontSources');
  if (so.canvas !== undefined && so.canvas !== 'png' && so.canvas !== 'skip') throw optionError(msg("canvas は 'png' か 'skip' にしてください", "canvas must be 'png' or 'skip'"), 'canvas');
  if (so.lang !== undefined && !MESSAGE_LANGS.includes(so.lang)) throw optionError(msg(`lang は ${MESSAGE_LANGS.join('・')} のどれかにしてください`, `lang must be one of ${MESSAGE_LANGS.join(', ')}`), 'lang');
  const lim = { imagePixels: DEFAULT_LIMITS.imagePixels, fileBytes: DEFAULT_LIMITS.fileBytes, snapshotBytes: DEFAULT_SNAPSHOT_BYTES };
  const given = so.limits as Record<string, unknown> | undefined;
  if (given !== undefined) {
    if (typeof given !== 'object' || given === null || Array.isArray(given)) throw optionError(msg('limits はオブジェクトにしてください', 'limits must be an object'), 'limits');
    for (const [k, v] of Object.entries(given)) {
      if (v === undefined) continue;
      if (k !== 'imagePixels' && k !== 'fileBytes' && k !== 'snapshotBytes')
        throw optionError(msg(`limits.${k} は snapshotDocument の上限にありません (imagePixels・fileBytes・snapshotBytes)`, `limits.${k} is not a snapshotDocument limit (imagePixels, fileBytes, snapshotBytes)`), `limits.${k}`);
      const ceiling = k === 'snapshotBytes' ? 2 ** 31 - 1 : (LIMIT_DEFS[k].ceiling ?? Number.MAX_SAFE_INTEGER);
      if (!(typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= ceiling))
        throw optionError(msg(`limits.${k} は 1 以上 ${ceiling} 以下の整数にしてください: ${String(v)}`, `limits.${k} must be an integer from 1 to ${ceiling}: ${String(v)}`), `limits.${k}`);
      lim[k] = v;
    }
  }
  return { o: so, limits: lim };
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

/**
 * JS が組み上げた後の文書を、typeset にそのまま渡せる形 (DocumentSnapshot) にする。
 * 文書の読み込み・書体の読み込み・ページの側の合図 (waitFor)・描画の落ち着きを、この順に待ってから文字にする。
 * 使い方: const snap = await snapshotDocument(document); const r = await typeset(snap.html, { ...snap.options, pageSize: 'A4' });
 */
export async function snapshotDocument(doc?: Document, options?: SnapshotOptions): Promise<DocumentSnapshot> {
  const { o, limits } = checkOptions(options);
  const d = doc ?? (globalThis as { document?: Document }).document;
  if (!d || typeof d !== 'object' || !d.documentElement || !d.defaultView)
    throw optionError(
      msg(
        'snapshotDocument は、DOM と画面のある所 (ブラウザの画面) で呼んでください。Web Worker では、画面で snapshotDocument を呼び、結果を postMessage で送ってください',
        'call snapshotDocument where there is a DOM and a rendered page (a browser window). For a Web Worker, call snapshotDocument in the window and send the result with postMessage',
      ),
      'doc',
    );
  const ctx: CallContext = { lang: o.lang ?? messageLang(), ...(o.signal ? { signal: o.signal } : {}) };
  return runInCall(ctx, () => run(d, o, limits));
}

async function run(doc: Document, o: SnapshotOptions, limits: { imagePixels: number; fileBytes: number; snapshotBytes: number }): Promise<DocumentSnapshot> {
  checkAbort();
  const snap = new Snapshot(doc, limits, o.canvas ?? 'png', o.shadowRoots ?? []);
  rejoin(thisCall(), await waitReady(doc, o, snap));
  checkAbort();
  const root = snap.copy(doc.documentElement) as Element;
  snap.addAdoptedSheets(root);
  snap.addShadowStyles(root);
  snap.addFontFaces(root, o.fontSources);
  rejoin(thisCall(), await snap.runJobs());
  checkAbort();
  snap.renameCanvasSelectors(root);
  snap.escapeRawText(root);
  const html = sanitizeHtml(doc, snap.finish(`<!doctype html>\n${root.outerHTML}`));
  return {
    html,
    options: { kind: 'html', name: SNAPSHOT_NAME, files: snap.files },
    baseUrl: snap.base,
    diagnostics: snap.diagnostics,
    warnings: snap.diagnostics.map((x) => x.message),
  };
}

// ---- 待つ ----

const TIMEOUT = Symbol('timeout');

/**
 * 文字にする前に待つ: 文書の読み込み (HTML §8.4 の load。readyState は §3.1.3) → 書体 (CSS Font Loading 3 §3.4 の document.fonts.ready) →
 * ページの側の合図 (waitFor) → 描画の落ち着き (描画の回を 2 回と、終わりのある Web Animations の finished。Web Animations 1 §5.3)。
 * 合わせて timeoutMs まで。過ぎたら snapshot/wait-timeout の警告を出し、残りは待たない
 */
async function waitReady(doc: Document, o: SnapshotOptions, snap: Snapshot): Promise<void> {
  const win = doc.defaultView!;
  const limitMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // 0 は「待たない」: その時の文書で、すぐ文字にする (警告は出さない)
  if (limitMs === 0) return;
  const deadline = Date.now() + limitMs;
  let stopPolling = false;
  const step = async (waiting: 'load' | 'fonts' | 'waitFor' | 'animations', p: () => PromiseLike<unknown>): Promise<boolean> => {
    const left = deadline - Date.now();
    let timer: number | undefined;
    const timeout = new Promise<typeof TIMEOUT>((ok) => {
      timer = win.setTimeout(() => ok(TIMEOUT), Math.max(0, left));
    });
    try {
      const r = rejoin(thisCall(), await untilAbort(Promise.race([Promise.resolve(p()), timeout])));
      if (r !== TIMEOUT) return true;
    } finally {
      win.clearTimeout(timer);
      // waitFor の段が、待ち終えた・時間が過ぎた・止めた (untilAbort が失敗した) のどれでも、waitFor の関数を呼ぶのをやめる
      if (waiting === 'waitFor') stopPolling = true;
    }
    snap.warn(diag('snapshot/wait-timeout', msg(`待つ時間 (${limitMs}ms) が過ぎたので、その時の文書で文字にしました (待っていたもの: ${waiting})`, `the wait (${limitMs}ms) ran out, so the document was taken as it was (waiting for: ${waiting})`), { waiting, ms: limitMs }));
    return false;
  };
  if (doc.readyState !== 'complete' && !rejoin(thisCall(), await step('load', () => new Promise((ok) => win.addEventListener('load', ok, { once: true }))))) return;
  const fonts = (doc as Document & { fonts?: { ready?: PromiseLike<unknown> } }).fonts;
  if (fonts?.ready && !rejoin(thisCall(), await step('fonts', () => fonts.ready!))) return;
  const wf = o.waitFor;
  if (wf !== undefined) {
    const ready = typeof wf === 'function' ? () => poll(win, wf, () => stopPolling) : () => wf;
    if (!rejoin(thisCall(), await step('waitFor', ready))) return;
  }
  if (!rejoin(thisCall(), await step('animations', () => settled(win, doc)))) return;
}

/** 描画の回を 1 つ待つ (requestAnimationFrame。画面が隠れていて描画の回が来ないときのため、50ms で先へ進む) */
function nextFrame(win: Window): Promise<void> {
  return new Promise((ok) => {
    const t = win.setTimeout(ok, 50);
    win.requestAnimationFrame(() => {
      win.clearTimeout(t);
      ok();
    });
  });
}

/** fn が真の値を返すまで、描画の回ごとに呼ぶ (stop が真になったらやめる。fn の誤りは、そのまま返す) */
function poll(win: Window, fn: () => unknown, stop: () => boolean): Promise<void> {
  return new Promise<void>((ok, ng) => {
    const tick = async () => {
      if (stop()) return;
      try {
        let v = fn();
        if (isThenable(v)) v = rejoin(thisCall(), await v);
        if (v) {
          ok();
          return;
        }
        rejoin(thisCall(), await nextFrame(win));
        void tick();
      } catch (e) {
        ng(e);
      }
    };
    void tick();
  });
}

/** 描画の落ち着き: 描画の回を 2 回と、走っている、終わりのある Web Animations の finished */
async function settled(win: Window, doc: Document): Promise<void> {
  rejoin(thisCall(), await nextFrame(win));
  rejoin(thisCall(), await nextFrame(win));
  const anims = typeof doc.getAnimations === 'function' ? doc.getAnimations() : [];
  const finite = anims.filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
  if (finite.length) rejoin(thisCall(), await Promise.all(finite.map((a) => a.finished.catch(() => undefined))));
}

// ---- 写す ----

/** 要素の短い記述 (警告の文と args に使う: canvas#chart・my-card.big) */
export function describeElement(e: Element): string {
  const id = e.getAttribute('id');
  const cls = (e.getAttribute('class') ?? '').trim().split(/\s+/)[0];
  return `${e.localName}${id ? `#${id}` : cls ? `.${cls}` : ''}`;
}

/** 文書の中の URL を持つ属性 (HTML の要素ごと)。SVG の要素は href と xlink:href */
const URL_ATTRS: Record<string, readonly string[]> = {
  a: ['href'],
  area: ['href'],
  link: ['href'],
  img: ['src'],
  source: ['src'],
  track: ['src'],
  input: ['src', 'formaction'],
  button: ['formaction'],
  form: ['action'],
  video: ['src', 'poster'],
  audio: ['src'],
  embed: ['src'],
  iframe: ['src'],
  object: ['data'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite'],
  ins: ['cite'],
};

/** 1 回の snapshotDocument の写し */
class Snapshot {
  /** 写しを作る文書 (画面と関わりが無い) */
  readonly inert: Document;
  /** 文書の基準の URL (HTML §2.4.1。<base href> があればそれ) */
  readonly base: string;
  /** 文書の URL の # の前まで (文書の中を指す参照を見分ける) */
  private readonly docUrl: string;
  readonly files: KumioriFile[] = [];
  readonly diagnostics: Diagnostic[] = [];
  /** 写した後で、順に行う取り込み (canvas の PNG・blob: の中身。非同期) */
  private jobs: Array<() => Promise<void>> = [];
  /** 取り込んだ合計のバイト */
  private total = 0;
  /** 合計の上限に届いたか */
  private full = false;
  /** blob: の URL → 写しの中の仮の名前 */
  private blobs = new Map<string, string>();
  /** 仮の名前 → 取り込んだ後の名前 (拡張子を付けたもの。読めなければ元の blob: の URL) */
  private renames = new Map<string, string>();
  private counter = 0;
  /** img に置き換えた canvas があるか (canvas を名指しした CSS の規則を、img にも当てる) */
  private canvasReplaced = false;
  /** 渡された影の木の根 (host → 根。閉じた根のため) */
  private readonly givenRoots = new Map<Element, ShadowRoot>();
  /** 展開した影の木の根 → 影の木の番号 */
  private readonly rootScope = new Map<Node, number>();
  /** 影の木のスタイル (囲った規則) */
  private readonly shadowCss: string[] = [];
  /** 読めなかったスタイルシートがあるか (CSS の @font-face を全部は知れない) */
  private unreadableSheets = false;
  /** 読めた @font-face の書体の名前 (小文字。引用符を外したもの) */
  private readonly cssFamilies = new Set<string>();

  constructor(
    readonly doc: Document,
    readonly limits: { imagePixels: number; fileBytes: number; snapshotBytes: number },
    readonly canvasMode: 'png' | 'skip' = 'png',
    shadowRoots: readonly ShadowRoot[] = [],
  ) {
    for (const r of shadowRoots) this.givenRoots.set(r.host, r);
    this.inert = doc.implementation.createHTMLDocument('');
    this.base = doc.baseURI;
    this.docUrl = doc.URL.replace(/#.*$/, '');
  }

  warn(d: Diagnostic): void {
    this.diagnostics.push(d);
  }

  /**
   * 文書の中の URL を、絶対の URL にする (HTML §2.4.2 の URL の解決。URL Standard §4.4)。
   *  - # だけの参照と、文書の URL に # の付いた参照は、# からの形にする (PDF の中のリンクになるように)
   *  - data: などの、基準に依らない URL はそのまま
   *  - javascript: は null (属性ごと取り除く)
   */
  resolveUrl(value: string, base = this.base, img?: HTMLImageElement): string | null {
    const t = cleanUrl(value);
    if (/^blob:/i.test(t)) return this.blobName(t, img);
    return resolveSnapshotUrl(value, base, this.docUrl);
  }

  /** CSS の文字の中の URL を絶対にする (base は、その CSS の基準) */
  css(text: string, base = this.base): string {
    // CSS の中の javascript: は、空の URL の代わりに about:invalid にする (CSS の値の形を崩さない)
    return rewriteCssUrls(text, (url) => this.resolveUrl(url, base) ?? 'about:invalid');
  }

  /** 節を写す (写さない節は null) */
  copy(o: Node, scope?: number): Node | null {
    if (o.nodeType === 1) return this.copyElement(o as Element, scope);
    // 注釈は写さない (HTML §13.3 は注釈の中身を逃がさずに書き出すので、--> を含む注釈で、読み直したときに要素を差し込める。組版にも使わない)
    if (o.nodeType === 3 || o.nodeType === 4) return this.inert.importNode(o, false);
    return null;
  }

  private copyElement(o: Element, scope?: number): Node | null {
    const name = o.localName;
    const ns = o.namespaceURI;
    const html = ns === HTML_NS;
    // ページの側の script は文字にしない (Kumiori は JS を動かさない。写しを送ったり残したりするときに、中の鍵などを出さない)。
    // noscript は、画面では JS が動いていたので中身が出ていない (Kumiori は scripting の無い文書として読み、中身を組んでしまう)
    if (name === 'script' || (html && name === 'noscript')) return null;
    if (html && name === 'base') return null;
    if (html && name === 'meta' && /^\s*refresh\s*$/i.test(o.getAttribute('http-equiv') ?? '')) return null;
    if (html && name === 'source' && o.parentElement?.localName === 'picture') return null;
    // URL の属性を javascript: に動かす SVG のアニメーション (set・animate など) は写さない
    if (ns === SVG_NS && animatesToScript(o)) return null;
    // 無効にしたスタイルシート (HTML §4.2.6 の disabled・CSSOM §6.1 の disabled の旗) は、画面にも当たっていない
    if ((name === 'style' || (html && name === 'link')) && (o as HTMLStyleElement | HTMLLinkElement).sheet?.disabled) return null;
    // 影の木の中のスタイルシートは、囲った規則にして文書に置く (addShadowStyles) ので、要素は写さない
    if (scope !== undefined && (name === 'style' || (html && name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(o.getAttribute('rel') ?? '')))) return null;
    if (html && name === 'slot' && scope !== undefined) return this.copySlot(o as HTMLSlotElement, scope);
    if (html && name === 'template') {
      // 中身 (template.content。HTML §4.12.3) も、ほかの所と同じ取り除きを通して写す (組むときは中を組まないが、写しには鍵などを残さない)
      const t = this.inert.importNode(o, false) as HTMLTemplateElement;
      this.fixAttributes(o, t);
      for (const k of (o as HTMLTemplateElement).content.childNodes) {
        const cc = this.copy(k, scope);
        if (cc) t.content.appendChild(cc);
      }
      return t;
    }
    // 中の字を逃がさずに書き出す要素 (HTML §13.3 の serializing。xmp・plaintext は字を、noembed・noframes・iframe の子は、ブラウザが組まない字)。
    // xmp・plaintext は、字を逃がす pre にする。noembed・noframes は写さず、iframe の子は写さない (下)
    if (html && (name === 'noembed' || name === 'noframes')) return null;
    if (html && (name === 'xmp' || name === 'plaintext')) {
      const pre = this.inert.createElement('pre');
      const tmp = this.inert.importNode(o, false) as Element;
      this.fixAttributes(o, tmp);
      for (const a of tmp.attributes) pre.setAttribute(a.name, a.value);
      if (scope !== undefined) pre.setAttribute('data-ks-s', String(scope));
      pre.textContent = o.textContent ?? '';
      return pre;
    }
    const c = this.inert.importNode(o, false) as Element;
    this.fixAttributes(o, c);
    if (scope !== undefined) c.setAttribute('data-ks-s', String(scope));
    if (html && name === 'iframe') {
      c.removeAttribute('srcdoc');
      c.replaceChildren();
      const src = c.getAttribute('src') ?? '';
      this.warn(diag('snapshot/iframe-skipped', msg(`<iframe> の中の文書は写していません: ${src || '(srcdoc)'}`, `the document inside an <iframe> was not copied: ${src || '(srcdoc)'}`), { src }));
    }
    if (html && name === 'img') this.fixImage(o as HTMLImageElement, c);
    if (html && name === 'canvas' && this.canvasMode === 'png') {
      const img = this.canvasImage(o as HTMLCanvasElement, c);
      if (img) {
        // 代わりの中身 (img が置き換わらなかったときに組むもの) も写しておく
        for (const k of o.childNodes) {
          const cc = this.copy(k, scope);
          if (cc) c.appendChild(cc);
        }
        return img;
      }
    }
    const shadow = o.shadowRoot ?? this.givenRoots.get(o);
    if (shadow) {
      // 影の木を、平らな木 (CSS Scoping 1 §2) に展開する: host の子を、影の根の子の写しにする (光の木の子は、slot に割り当てられた所に出る)
      const n = this.rootScope.size + 1;
      this.rootScope.set(shadow, n);
      c.setAttribute('data-ks-h', String(n));
      this.collectShadowCss(shadow, n);
      for (const k of shadow.childNodes) {
        const cc = this.copy(k, n);
        if (cc) c.appendChild(cc);
      }
    } else if (!(html && name === 'iframe')) {
      this.noteClosedRoot(o);
      for (const k of o.childNodes) {
        const cc = this.copy(k, scope);
        if (cc) c.appendChild(cc);
      }
    }
    if (html) {
      if (name === 'style') return this.copyStyle(o as HTMLStyleElement, c);
      else if (name === 'input') this.fixInput(o as HTMLInputElement, c);
      else if (name === 'textarea') c.textContent = (o as HTMLTextAreaElement).value;
      else if (name === 'select') {
        const os = (o as HTMLSelectElement).querySelectorAll('option');
        const cs = c.querySelectorAll('option');
        if (os.length === cs.length) os.forEach((op, k) => cs[k].toggleAttribute('selected', op.selected));
      }
    } else if (ns === SVG_NS && name === 'style') return this.copyStyle(o as SVGStyleElement, c);
    return c;
  }

  /**
   * 影の木の中の slot を、割り当てられた節 (DOM §4.2.2.4 の assignedNodes({ flatten: true })) の写しに置き換える。割り当てが無ければ、slot の代わりの中身。
   * slot は既定で display: contents なので、slot の箱は無くてよい。割り当てられた要素には、その影の木の ::slotted() が当たる印を付ける
   */
  private copySlot(o: HTMLSlotElement, scope: number): Node {
    const frag = this.inert.createDocumentFragment();
    const assigned = o.assignedNodes({ flatten: true });
    if (assigned.length) {
      for (const a of assigned) {
        const cc = this.copy(a, this.rootScope.get(a.getRootNode()));
        if (cc && cc.nodeType === 1) (cc as Element).setAttribute('data-ks-sl', String(scope));
        if (cc) frag.appendChild(cc);
      }
    } else {
      for (const k of o.childNodes) {
        const cc = this.copy(k, scope);
        if (cc) frag.appendChild(cc);
      }
    }
    return frag;
  }

  /**
   * 閉じた影の根がありそうなカスタム要素を見分ける (確かめる API は無いので、推し量り): 定義されたカスタム要素で、見える影の根が無く、
   * 光の木の子が無いのに、画面に箱がある
   */
  private noteClosedRoot(o: Element): void {
    if (!o.localName.includes('-') || o.childNodes.length) return;
    const reg = this.doc.defaultView?.customElements;
    if (!reg?.get(o.localName)) return;
    const r = o.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const element = describeElement(o);
    this.warn(diag('snapshot/shadow-root-closed', msg(`${element} には、閉じた影の根 (Shadow DOM) がありそうです (中身は写していません。shadowRoots の選択肢で根を渡せば写します)`, `${element} seems to have a closed shadow root (its content was not copied; pass the root in the shadowRoots option to copy it)`), { element }));
  }

  /**
   * 影の根のスタイルシート (影の根の中の <style>・<link> と、影の根の adoptedStyleSheets) を、その影の木の中だけに当たるように囲って集める
   * (CSS Scoping 1 §3。セレクタの書き換えは snapshotCss.ts の scopeSelectorList。詳しさが (0,1,0) 上がる近似)
   */
  private collectShadowCss(root: ShadowRoot, n: number): void {
    const sheets = [...root.styleSheets, ...((root as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [])];
    const texts: string[] = [];
    for (const sh of sheets) {
      if (sh.disabled) continue;
      const owner = sh.ownerNode as Element | null;
      let t: string | undefined;
      if (owner && owner.localName === 'style') {
        t = this.styleText(owner.textContent ?? '', sh);
        const media = sh.media?.mediaText;
        if (media) t = `@media ${media} {\n${t}\n}`;
      } else {
        const raw = sheetText(sh);
        if (raw === undefined) {
          this.unreadableSheets = true;
          continue;
        }
        t = this.css(raw, sh.href ?? this.base);
      }
      this.noteFontFamilies(sh);
      texts.push(t);
    }
    if (!texts.length) return;
    const scope = { inside: `[data-ks-s="${n}"]`, host: `[data-ks-h="${n}"]`, slotted: `[data-ks-sl="${n}"]` };
    this.shadowCss.push(mapStyleRuleSelectors(texts.join('\n'), (sel) => scopeSelectorList(sel, scope)));
  }

  /** 影の木のスタイル (囲った規則) を、<head> の初めの <style data-kumiori-shadow> に置く (文書の規則が後ろになり、!important でない限り文書の規則が勝つ。CSS Cascade 5 §6.1) */
  addShadowStyles(root: Element): void {
    if (!this.shadowCss.length) return;
    const style = this.inert.createElement('style');
    style.setAttribute('data-kumiori-shadow', '');
    style.textContent = this.shadowCss.join('\n');
    const head = root.querySelector('head') ?? root;
    head.insertBefore(style, head.firstChild);
  }

  /** スタイルシートの @font-face の書体の名前を覚える (JS で足した書体を見分けるため。読めないスタイルシートは覚えておく) */
  private noteFontFamilies(sheet: CSSStyleSheet): void {
    const walk = (rules: CSSRuleList) => {
      for (const r of rules) {
        if (r.type === 5) this.cssFamilies.add(familyKey((r as CSSFontFaceRule).style.getPropertyValue('font-family')));
        const inner = (r as CSSGroupingRule).cssRules;
        if (inner) walk(inner);
        const imported = r.type === 3 ? (r as CSSImportRule).styleSheet : null;
        if (imported) this.noteFontFamilies(imported);
      }
    };
    try {
      walk(sheet.cssRules);
    } catch {
      this.unreadableSheets = true;
    }
  }

  /**
   * JS で作って document.fonts に足した書体 (CSS の @font-face に繋がらないもの。CSS Font Loading 3 §3) を、fontSources で中身をもらって files に入れ、
   * 同じ名前・太さ・傾き・幅・unicode-range の @font-face を、<head> の初めの <style data-kumiori-fonts> に書く。
   * 中身をもらえなければ snapshot/font-face-source-unknown (読めないスタイルシートがあると、その中の @font-face かもしれないので出さない)
   */
  addFontFaces(root: Element, sources: SnapshotOptions['fontSources']): void {
    const set = (this.doc as Document & { fonts?: Iterable<FontFace> }).fonts;
    if (!set) return;
    for (const sh of this.doc.styleSheets) this.noteFontFamilies(sh);
    for (const sh of (this.doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []) this.noteFontFamilies(sh);
    const faces = [...set].filter((f) => f.status === 'loaded' && !this.cssFamilies.has(familyKey(f.family)));
    if (!faces.length) return;
    const style = this.inert.createElement('style');
    style.setAttribute('data-kumiori-fonts', '');
    const head = root.querySelector('head') ?? root;
    head.insertBefore(style, head.firstChild);
    const rules: string[] = [];
    for (const face of faces) {
      this.jobs.push(async () => {
        const family = familyKey(face.family, false);
        let got: KumioriFileData | undefined;
        if (sources) got = rejoin(thisCall(), await untilAbort(Promise.resolve(sources(face))));
        let src: string | undefined;
        if (typeof got === 'string') src = this.resolveUrl(got) ?? undefined;
        else if (got) {
          const data = got instanceof Uint8Array ? got : new Uint8Array(got);
          const name = `${SNAPSHOT_DIR}/font-${++this.counter}${fontExt(data)}`;
          const tooLarge = () =>
            this.warn(diag('snapshot/font-face-source-unknown', msg(`JS で足した書体 ${family} の中身 (${data.length} バイト) が上限 (fileBytes: ${this.limits.fileBytes}) を超えるので、取り込みませんでした`, `the content of the font ${family} added by JavaScript (${data.length} bytes) is larger than the limit (fileBytes: ${this.limits.fileBytes}), so it was not taken in`), { family }));
          if (this.take(name, data, tooLarge)) src = name;
        } else if (!this.unreadableSheets)
          this.warn(diag('snapshot/font-face-source-unknown', msg(`JS で足した書体 ${family} の中身を取れませんでした (fontSources の選択肢で渡してください。組むと、別の書体になります)`, `could not get the content of the font ${family} added by JavaScript (pass it with the fontSources option; it will be typeset with another font)`), { family }));
        if (!src) return;
        rules.push(fontFaceRule(face, family, src));
        style.textContent = rules.join('\n');
      });
    }
  }

  /** <style> の元の字 (URL を絶対にしたもの) と、CSSOM で足された規則 (後ろに足す)。消された規則があれば警告 */
  private styleText(text: string, sheet: CSSStyleSheet): string {
    const { added } = this.sheetDiff(text, sheet);
    return added.length ? `${this.css(text)}\n${this.css(added.join('\n'))}` : this.css(text);
  }

  /** 元の字と、いまの cssRules の差 (消された規則があれば snapshot/stylesheet-rule-removed) */
  private sheetDiff(text: string, sheet: CSSStyleSheet): { added: string[] } {
    const live = ruleTexts(sheet);
    const base = parsedRuleTexts(this.doc, text);
    if (!live || !base) return { added: [] };
    const { added, removed } = ruleDiff(base, live);
    if (removed) this.warn(diag('snapshot/stylesheet-rule-removed', msg(`<style> の元の字にあって、CSSOM から消された規則が ${removed} 個あります (元の字から消せないので、残しました)`, `${removed} rule(s) in the source text of a <style> were removed through the CSSOM (they were kept, as they cannot be removed from the text)`), { count: removed }));
    return { added };
  }

  /**
   * <style>: 元の字を残し (ブラウザの知らない指定 (string-set・-ah-* など) が消えないように)、CSSOM で足された規則 (insertRule など) だけを、
   * 直後の <style data-kumiori-cssom> に書き足す (CSSOM §6.1 の cssRules と、元の字を作ったスタイルシート (replaceSync) で読んだ規則の差)。
   * 消された規則は元の字から消せないので、残して snapshot/stylesheet-rule-removed の警告を出す
   */
  private copyStyle(o: HTMLStyleElement | SVGStyleElement, c: Element): Node {
    const text = o.textContent ?? '';
    c.textContent = this.css(text);
    const sheet = o.sheet;
    if (!sheet) return c;
    const { added } = this.sheetDiff(text, sheet);
    if (!added.length) return c;
    const extra = this.inert.createElementNS(c.namespaceURI, 'style');
    extra.setAttribute('data-kumiori-cssom', '');
    const media = c.getAttribute('media');
    if (media) extra.setAttribute('media', media);
    extra.textContent = this.css(added.join('\n'));
    const frag = this.inert.createDocumentFragment();
    frag.append(c, extra);
    return frag;
  }

  /**
   * 文書の作ったスタイルシート (document.adoptedStyleSheets。CSSOM の DocumentOrShadowRoot の拡張) を、<style data-kumiori-adopted> にして置く。
   * 並びの順は、文書のスタイルシートの後ろ (本文に <style>・<link> があれば本文の終わり、無ければ <head> の終わり)。
   * 元の字は無いので、規則の文字 (cssText) を書き出す (ブラウザの知らない指定は、作ったときに捨てられていて、戻せない)
   */
  addAdoptedSheets(root: Element): void {
    const sheets = (this.doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const texts = sheets.map((s) => sheetText(s)).filter((t): t is string => !!t);
    if (!texts.length) return;
    const style = this.inert.createElement('style');
    style.setAttribute('data-kumiori-adopted', '');
    style.textContent = this.css(texts.join('\n'));
    const body = root.querySelector('body');
    const head = root.querySelector('head');
    if (body && body.querySelector('style, link[rel~="stylesheet" i]')) body.appendChild(style);
    else (head ?? root).appendChild(style);
  }

  /**
   * canvas の絵を PNG にして、img に置き換える (HTML §4.12.5.1 の toBlob)。置き換える img を返す (置き換えないなら undefined)。
   * PNG にするのは後で (runJobs)。別の origin の画像で汚れた canvas・大きすぎる canvas は、canvas のまま残す
   */
  private canvasImage(o: HTMLCanvasElement, c: Element): Element | undefined {
    const w = o.width;
    const h = o.height;
    if (!w || !h) return undefined;
    const element = describeElement(o);
    if (w * h > this.limits.imagePixels) {
      this.warn(diag('snapshot/canvas-too-large', msg(`${element} の画素の数 (${w * h}) が上限 (imagePixels: ${this.limits.imagePixels}) を超えるので、画像にしませんでした`, `${element} has more pixels (${w * h}) than the limit (imagePixels: ${this.limits.imagePixels}), so it was not turned into an image`), { element, size: w * h, limit: this.limits.imagePixels }));
      return undefined;
    }
    const img = this.inert.createElement('img');
    for (const a of c.attributes) img.setAttribute(a.name, a.value);
    img.setAttribute('data-kumiori-canvas', '');
    const alt = (o.textContent ?? '').trim();
    if (alt && !img.hasAttribute('alt')) img.setAttribute('alt', alt);
    const name = `${SNAPSHOT_DIR}/canvas-${++this.counter}.png`;
    img.setAttribute('src', name);
    this.canvasReplaced = true;
    this.jobs.push(async () => {
      let data: Uint8Array | undefined;
      try {
        data = rejoin(thisCall(), await canvasPng(o));
      } catch (e) {
        if ((e as { name?: string })?.name === 'SecurityError') this.warn(diag('snapshot/canvas-tainted', msg(`${element} は別の origin の画像で汚れているので、画像にできませんでした (canvas のまま残しました)`, `${element} is tainted by a cross-origin image, so it could not be turned into an image (it was left as a canvas)`), { element }));
        else this.warn(diag('snapshot/canvas-too-large', msg(`${element} を画像にできませんでした (ブラウザが PNG を作れなかった)`, `${element} could not be turned into an image (the browser could not make a PNG)`), { element, size: w * h, limit: this.limits.imagePixels }));
      }
      const tooLarge = () =>
        this.warn(diag('snapshot/canvas-too-large', msg(`${element} の画像 (${data!.length} バイト) が上限 (fileBytes: ${this.limits.fileBytes}) を超えるので、取り込みませんでした`, `the image of ${element} (${data!.length} bytes) is larger than the limit (fileBytes: ${this.limits.fileBytes}), so it was not taken in`), { element, size: data!.length, limit: this.limits.fileBytes }));
      if (data && !this.take(name, data, tooLarge)) data = undefined;
      if (!data) img.replaceWith(c);
    });
    return img;
  }

  /** 取り込んだファイルを files に足す (ファイル 1 つの上限 (超えれば tooLarge を呼ぶ)・合計の上限を超えれば、足さずに false) */
  private take(name: string, data: Uint8Array, tooLarge: () => void): boolean {
    if (data.length > this.limits.fileBytes) {
      tooLarge();
      return false;
    }
    if (this.full || this.total + data.length > this.limits.snapshotBytes) {
      if (!this.full) this.warn(diag('snapshot/limit', msg(`取り込んだものの合計が上限 (snapshotBytes: ${this.limits.snapshotBytes}) に届いたので、その後の canvas・blob: の中身・書体を取り込みませんでした`, `the total taken in reached the limit (snapshotBytes: ${this.limits.snapshotBytes}), so later canvases, blob: contents and fonts were not taken in`), { limit: this.limits.snapshotBytes }));
      this.full = true;
      return false;
    }
    this.total += data.length;
    this.files.push({ name, data });
    return true;
  }

  /**
   * blob: の URL (File API §8。作った文書の中でだけ読める) の、写しの中の仮の名前。中身は後で (runJobs) fetch で読み、files に入れる。
   * 消された URL (URL.revokeObjectURL の後) で、読み終わった img があれば、その絵を PNG にする
   */
  private blobName(url: string, img?: HTMLImageElement): string {
    const had = this.blobs.get(url);
    if (had) return had;
    const name = `${SNAPSHOT_DIR}/blob-${++this.counter}.bin`;
    this.blobs.set(url, name);
    this.jobs.push(async () => {
      const win = this.doc.defaultView!;
      let data: Uint8Array | undefined;
      let ext = '';
      try {
        const res = rejoin(thisCall(), await untilAbort(win.fetch(url, { signal: thisCall()?.signal })));
        const blob = rejoin(thisCall(), await untilAbort(res.blob()));
        data = new Uint8Array(rejoin(thisCall(), await untilAbort(blob.arrayBuffer())));
        ext = extOf(blob.type);
      } catch {
        // 止めたときは、取り込みの続きをせずに止める
        checkAbort();
        if (img && img.complete && img.naturalWidth) {
          try {
            const cv = this.doc.createElement('canvas');
            cv.width = img.naturalWidth;
            cv.height = img.naturalHeight;
            cv.getContext('2d')?.drawImage(img, 0, 0);
            data = rejoin(thisCall(), await canvasPng(cv));
            ext = '.png';
          } catch {
            data = undefined;
          }
        }
      }
      const final = name.replace(/\.bin$/, ext || '.bin');
      const tooLarge = () =>
        this.warn(diag('snapshot/blob-unreadable', msg(`blob: の URL の中身 (${data!.length} バイト) が上限 (fileBytes: ${this.limits.fileBytes}) を超えるので、取り込みませんでした: ${url}`, `the content of a blob: URL (${data!.length} bytes) is larger than the limit (fileBytes: ${this.limits.fileBytes}), so it was not taken in: ${url}`), { url }));
      if (data && this.take(final, data, tooLarge)) this.renames.set(name, final);
      else {
        if (!data) this.warn(diag('snapshot/blob-unreadable', msg(`blob: の URL の中身を読めませんでした (消された URL など): ${url}`, `could not read the content of a blob: URL (a revoked URL, etc.): ${url}`), { url }));
        this.renames.set(name, url);
      }
    });
    return name;
  }

  /** 写した後の取り込みを、順に行う (同時に多くは走らせない。間に止める合図を確かめる) */
  async runJobs(): Promise<void> {
    for (let k = 0; k < this.jobs.length; k++) {
      checkAbort();
      rejoin(thisCall(), await this.jobs[k]());
    }
  }

  /**
   * canvas を img に置き換えたとき、文書の <style> の、canvas を名指しした規則を img[data-kumiori-canvas] にも当てる
   * (セレクタの並びに、置き換えた形を足す。元の canvas の形も残す: 置き換えなかった canvas のため)
   */
  renameCanvasSelectors(root: Element): void {
    if (!this.canvasReplaced) return;
    const to = 'img[data-kumiori-canvas]';
    // 文書の img を名指しした規則は、置き換えた img に当てない (元は canvas なので)
    const notCanvas = 'img:not([data-kumiori-canvas])';
    for (const st of root.querySelectorAll('style')) {
      const t = st.textContent ?? '';
      if (!/canvas|img/i.test(t)) continue;
      st.textContent = mapStyleRuleSelectors(t, (sel) => {
        const parts = splitSelectorList(sel);
        const out: string[] = [];
        let changed = false;
        for (const p of parts) {
          const q = renameTypeSelector(p, 'img', notCanvas);
          out.push(q);
          const r = renameTypeSelector(p, 'canvas', to);
          if (r !== p) out.push(r);
          if (q !== p || r !== p) changed = true;
        }
        return changed ? out.join(', ') : undefined;
      });
    }
  }

  /**
   * HTML の <style> の字の </style を逃がす (HTML §13.3 は style の字を逃がさずに書き出すので、写しを読み直したときに、
   * 字の中の </style の後ろが要素になる)。CSS では <\/style は <\/style と同じ字 (CSS Syntax 3 §4.3.7 の逃がし)
   */
  escapeRawText(root: Element): void {
    for (const st of root.querySelectorAll('style')) {
      if (st.namespaceURI !== HTML_NS) continue;
      const t = st.textContent ?? '';
      const e = escapeStyleText(t);
      if (e !== t) st.textContent = e;
    }
  }

  /** 文字にした文書の、仮の名前を、取り込んだ後の名前に直す */
  finish(html: string): string {
    for (const [from, to] of this.renames) if (from !== to) html = html.split(from).join(to);
    return html;
  }

  /** 属性を直す: イベントの扱い手 (on…) を取り除き、URL を絶対にし、style の属性の中の URL も絶対にする */
  private fixAttributes(o: Element, c: Element): void {
    for (const a of [...c.attributes]) {
      if (/^on/i.test(a.localName) && !a.namespaceURI) c.removeAttributeNode(a);
    }
    const names = o.namespaceURI === HTML_NS ? URL_ATTRS[o.localName] : undefined;
    const img = o.namespaceURI === HTML_NS && o.localName === 'img' ? (o as HTMLImageElement) : undefined;
    for (const n of names ?? []) {
      const v = c.getAttribute(n);
      if (v === null) continue;
      const r = this.resolveUrl(v, this.base, img);
      if (r === null || activeDataUrl(o.localName, r)) c.removeAttribute(n);
      else if (r !== v) c.setAttribute(n, r);
    }
    if (o.namespaceURI !== HTML_NS) {
      for (const [nsUri, n] of [
        [null, 'href'],
        [XLINK_NS, 'href'],
      ] as const) {
        const v = c.getAttributeNS(nsUri, n);
        if (v === null) continue;
        const r = this.resolveUrl(v);
        if (r === null) c.removeAttributeNS(nsUri, n);
        else if (r !== v) c.setAttributeNS(nsUri, nsUri ? `xlink:${n}` : n, r);
      }
    }
    const style = c.getAttribute('style');
    if (style) {
      const s = this.css(style);
      if (s !== style) c.setAttribute('style', s);
    }
  }

  /**
   * img: Kumiori は srcset・sizes・picture の source を読まないので、画面で選ばれた画像 (currentSrc。HTML §4.8.4.3) を src にする
   * (画面の幅で選んだ画像になる)
   */
  private fixImage(o: HTMLImageElement, c: Element): void {
    const inPicture = o.parentElement?.localName === 'picture';
    if (!o.hasAttribute('srcset') && !inPicture) return;
    const cur = o.currentSrc;
    if (cur) {
      const r = this.resolveUrl(cur);
      if (r) c.setAttribute('src', r);
    }
    c.removeAttribute('srcset');
    c.removeAttribute('sizes');
  }

  /**
   * フォームのいまの値を、属性に書き戻す (HTML §4.10.5.4: 値・選びの状態は IDL の属性にだけあり、文字にすると落ちる)。
   * password の値と file は書かない (紙に出さない)。hidden は画面に出ないので書き換えない
   */
  private fixInput(o: HTMLInputElement, c: Element): void {
    const type = o.type;
    if (type === 'password' || type === 'file' || type === 'hidden') c.removeAttribute('value');
    else if (type === 'checkbox' || type === 'radio') c.toggleAttribute('checked', o.checked);
    else if (type === 'submit' || type === 'reset' || type === 'button' || type === 'image') return;
    else c.setAttribute('value', o.value);
  }
}

/** スタイルシートの規則の文字の並び (@import の規則は除く: 作ったスタイルシートでは読まないので、比べに入れない)。読めなければ undefined */
function ruleTexts(sheet: CSSStyleSheet): string[] | undefined {
  try {
    return [...sheet.cssRules].filter((r) => r.type !== 3).map((r) => r.cssText);
  } catch {
    return undefined;
  }
}

/** スタイルシートの規則をつないだ文字 (別の origin のものなど、読めなければ undefined)。media があれば @media で包む */
function sheetText(sheet: CSSStyleSheet): string | undefined {
  try {
    const t = [...sheet.cssRules].map((r) => r.cssText).join('\n');
    const media = sheet.media?.mediaText;
    return media ? `@media ${media} {\n${t}\n}` : t;
  } catch {
    return undefined;
  }
}

/** 元の字を、文書と同じ読み方 (作ったスタイルシート。CSSOM §6.1 の replaceSync) で読んだ規則の文字の並び */
function parsedRuleTexts(doc: Document, text: string): string[] | undefined {
  const Sheet = (doc.defaultView as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null)?.CSSStyleSheet;
  if (!Sheet) return undefined;
  try {
    const s = new Sheet();
    s.replaceSync(text);
    return ruleTexts(s);
  } catch {
    return undefined;
  }
}

/** canvas を PNG のバイト列にする (toBlob。別の origin で汚れた canvas は SecurityError を投げる) */
function canvasPng(cv: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise<Blob>((ok, ng) => {
    cv.toBlob((b) => (b ? ok(b) : ng(new Error('toBlob'))), 'image/png');
  }).then((b) => b.arrayBuffer().then((a) => new Uint8Array(a)));
}

/** MIME の型から拡張子 */
function extOf(type: string): string {
  const t = type.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'text/css': '.css',
    'font/woff2': '.woff2',
    'font/woff': '.woff',
    'font/ttf': '.ttf',
    'font/otf': '.otf',
  };
  return map[t] ?? '';
}

/** 書体の名前を比べる形にする (引用符を外す。lower なら小文字にも) */
function familyKey(f: string, lower = true): string {
  const t = f.trim().replace(/^(["'])(.*)\1$/, '$2');
  return lower ? t.toLowerCase() : t;
}

/** 書体のファイルの拡張子 (先頭のバイト列から。OpenType §5 の sfnt の版・WOFF・WOFF2 の印) */
function fontExt(d: Uint8Array): string {
  const tag = String.fromCharCode(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0);
  return tag === 'wOF2' ? '.woff2' : tag === 'wOFF' ? '.woff' : tag === 'OTTO' ? '.otf' : tag === 'ttcf' ? '.ttc' : '.ttf';
}

/** FontFace と同じ記述子の @font-face の規則 (CSS Fonts 4 §4。既定の値の記述子は書かない) */
function fontFaceRule(face: FontFace, family: string, src: string): string {
  const parts = [`font-family: "${family.replace(/["\\]/g, (m) => `\\${m}`).replace(/[\n\r\f]/g, ' ')}"`, `src: ${quoteCss(src)}`];
  const add = (prop: string, v: string | undefined, def: string, same?: string) => {
    if (v && v !== def && v !== same) parts.push(`${prop}: ${v}`);
  };
  add('font-style', face.style, 'normal');
  add('font-weight', face.weight, 'normal', '400');
  add('font-stretch', face.stretch, 'normal');
  add('unicode-range', face.unicodeRange, 'U+0-10FFFF');
  add('font-feature-settings', face.featureSettings, 'normal');
  add('font-variation-settings', (face as FontFace & { variationSettings?: string }).variationSettings, 'normal');
  return `@font-face { ${parts.join('; ')} }`;
}

/**
 * 写しの中の URL を、絶対の URL にする (HTML §2.4.2 の URL の解決。URL Standard §4.4)。DOM の要らない部分 (試験のために出す)。
 *  - 前処理 (URL Standard §4.4 の始めの手順: 前後の C0 制御字と空白を取り、タブ・改行を取り除く。linkPolicy.ts の cleanUrl) の後でスキームを見る
 *    (java\tscript:・前の制御字で隠した javascript: も見分ける)
 *  - javascript:・vbscript: は null (属性ごと取り除く)
 *  - # だけの参照と、文書の URL (docUrl。# の前まで) に # の付いた参照は、# からの形にする (PDF の中のリンクになるように)
 *  - data: などの、基準に依らない URL はそのまま
 */
export function resolveSnapshotUrl(value: string, base: string, docUrl: string): string | null {
  const t = cleanUrl(value);
  if (/^(javascript|vbscript):/i.test(t)) return null;
  if (!t || t.startsWith('#')) return t || value;
  if (/^(data|blob|about|mailto|tel|cid|urn):/i.test(t)) return t;
  let u: URL;
  try {
    u = new URL(t, base);
  } catch {
    return t;
  }
  if (/^(javascript|vbscript):$/i.test(u.protocol)) return null;
  if (u.hash && u.href.slice(0, u.href.length - u.hash.length) === docUrl) return u.hash;
  return u.href;
}

/** HTML の <style> の字の、</style (大文字小文字を問わない) の / を逃がす (CSS では同じ字) */
export function escapeStyleText(css: string): string {
  return css.replace(/<\/(?=style)/gi, '<\\/');
}

/** SVG のアニメーションの要素 (SVG 2 §19.2・SVG Animations の set・animate・animateMotion・animateTransform と、古い animateColor) */
const SVG_ANIMATIONS = new Set(['set', 'animate', 'animatemotion', 'animatetransform', 'animatecolor']);

/**
 * SVG のアニメーションの要素が、URL の属性 (href・xlink:href) を javascript:・vbscript: に動かすか (attributeName と、to・from・by・values の値)。
 * 写しを開いて押したときに、動かした href で JS が動かないように、写さない
 */
export function animatesToScript(e: Pick<Element, 'localName' | 'getAttribute'>): boolean {
  if (!SVG_ANIMATIONS.has(e.localName.toLowerCase())) return false;
  const target = (e.getAttribute('attributeName') ?? '').trim().replace(/^xlink:/i, '').toLowerCase();
  if (target !== 'href') return false;
  const values = [e.getAttribute('to'), e.getAttribute('from'), e.getAttribute('by'), ...(e.getAttribute('values') ?? '').split(';')];
  return values.some((v) => v !== null && /^(javascript|vbscript):/i.test(cleanUrl(v)));
}

/**
 * 中で文書を動かす要素 (iframe の src・object の data・embed の src) の data: の URL か (data:text/html などの文書は、写しを開いたときに中で JS が動く)。
 * 画像の data: (SVG を除く image/…) は残す
 */
export function activeDataUrl(element: string, url: string): boolean {
  if (element !== 'iframe' && element !== 'object' && element !== 'embed') return false;
  const t = cleanUrl(url);
  if (!/^data:/i.test(t)) return false;
  return element === 'iframe' || !/^data:image\/(?!svg)[a-z0-9.+-]+[;,]/i.test(t);
}

/** 動かす中身を持つ属性 (イベントの扱い手は on… で見る) と、URL を持つ属性の名前 (読み直した後の、念のための取り除き) */
const URL_ATTR_NAMES = new Set(['href', 'src', 'action', 'formaction', 'data', 'poster', 'cite', 'xlink:href', 'background', 'srcdoc']);

/**
 * 出来上がった写しを、Kumiori と同じ DOMParser で読み直し、写しの中で取り除いたもの (script・noscript・base・meta refresh・イベントの扱い手・
 * javascript: の URL・iframe の srcdoc・URL を javascript: に動かす SVG のアニメーション・iframe・object・embed の文書の data: の URL) が、逃がしきれずに現れていれば、もう一度取り除く (念のため。ふつうは何も変わらない)。
 * 何も見つからなければ、元の字をそのまま返す (読み直した字にしない)
 */
function sanitizeHtml(doc: Document, html: string): string {
  const P = (doc.defaultView as (Window & { DOMParser?: typeof DOMParser }) | null)?.DOMParser;
  if (!P) return html;
  const d = new P().parseFromString(html, 'text/html');
  let found = false;
  const walk = (root: ParentNode) => {
    for (const e of [...root.querySelectorAll('*')]) {
      const name = e.localName;
      if (name === 'script' || name === 'noscript' || name === 'base' || (name === 'meta' && /^\s*refresh\s*$/i.test(e.getAttribute('http-equiv') ?? '')) || (e.namespaceURI === SVG_NS && animatesToScript(e))) {
        e.remove();
        found = true;
        continue;
      }
      for (const a of [...e.attributes]) {
        if (/^on/i.test(a.name) || a.name === 'srcdoc' || (URL_ATTR_NAMES.has(a.name) && (/^(javascript|vbscript):/i.test(cleanUrl(a.value)) || activeDataUrl(name, a.value)))) {
          e.removeAttributeNode(a);
          found = true;
        }
      }
      if (name === 'template') walk((e as HTMLTemplateElement).content);
    }
  };
  walk(d);
  return found ? `<!doctype html>\n${d.documentElement.outerHTML}` : html;
}
