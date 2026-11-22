/**
 * 診断の入力の場所 (DiagnosticSource): 要素の行・列と、要素の手がかり、組版の節との結び付き。
 *
 *  - XSL-FO・XHTML (@xmldom/xmldom): 要素の節が lineNumber・columnNumber を持つ (xmldom の locator。1 から数える)
 *  - HTML (Node と Web Worker の linkedom): linkedom の節は場所を持たないので、linkedom が使う htmlparser2 の Parser が開きタグを
 *    渡す間 (endOpenTag) の開きタグの位置 (文字の位置) を覚え、その間に作られた要素に結び付ける (patchHtmlLocations)。
 *    行・列は、文書の字 (setDocumentSource) の改行の位置から、診断を作るときにだけ数える
 *  - ブラウザの DOMParser・画面の iframe: 場所の情報が無いので、要素の手がかり (名前・id・class) だけ
 *  - 組版の節 (LNode): 読み込みが、要素から作った節に、その要素の場所を結び付ける (tagNodeSource)。組版の診断は、節から場所を引き
 *    (withSource)、sourceRef (入力の節の通し番号) を足す。写した節 (柱など) は、copySourceRef で元の節の場所も引き継ぐ
 */
import type { Diagnostic, DiagnosticSource } from './diagnostics';
import { nodeSource, sourceRef } from './sourceRef';

export { copySourceRef, nodeSource, tagNodeSource } from './sourceRef';

/** 要素として読むもの (DOM の Element と、XSL-FO の読み込みの XNode の共通の形) */
interface ElementLike {
  nodeName?: string;
  localName?: string | null;
  prefix?: string | null;
  getAttribute?: (name: string) => string | null;
  ownerDocument?: unknown;
  lineNumber?: number;
  columnNumber?: number;
}

/** 要素 → 開きタグの文字の位置 (htmlparser2) */
const OFFSETS = new WeakMap<object, number>();
/** 文書 → 読んだ字とファイルの名前 (行・列を数えるため)。lines は改行の後の位置の表 (初めて数えるときに作る) */
const TEXTS = new WeakMap<object, { text?: string; file?: string; lines?: number[]; useLines?: boolean; useColumns?: boolean }>();

/** 読んだ文書の字とファイルの名前を覚える (text は、その文書を読んだ字そのもの。違う字を渡すと行がずれるので、分からなければ渡さない) */
export function setDocumentSource(doc: object, text: string | undefined, file: string | undefined, use: { lines?: boolean; columns?: boolean } = {}): void {
  TEXTS.set(doc, { ...(text !== undefined ? { text } : {}), ...(file !== undefined ? { file } : {}), useLines: use.lines !== false, useColumns: use.columns !== false && use.lines !== false });
}

/** 文字の位置 → 行・列 (1 から) */
function lineColumn(entry: { text?: string; lines?: number[] }, offset: number): { line: number; column: number } | undefined {
  const text = entry.text;
  if (text === undefined || offset < 0 || offset > text.length) return undefined;
  if (!entry.lines) {
    const lines = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lines.push(i + 1);
    entry.lines = lines;
  }
  const ls = entry.lines;
  let lo = 0;
  let hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - ls[lo] + 1 };
}

/** 要素の手がかり: 名前 (接頭辞付き)・id・class の最初の 1 つ (p#intro・div.note・fo:block#a) */
export function elementHint(el: ElementLike): string {
  const name = el.nodeName && el.nodeName.includes(':') ? el.nodeName : (el.localName ?? el.nodeName ?? '');
  const id = el.getAttribute?.('id');
  const cls = el.getAttribute?.('class')?.trim().split(/\s+/)[0];
  return `${name}${id ? `#${id.slice(0, 60)}` : ''}${!id && cls ? `.${cls.slice(0, 60)}` : ''}`;
}

/** 要素の場所 (分かるものだけ。file は、文書から分からないときに使う名前) */
export function elementSource(el: ElementLike, file?: string): DiagnosticSource {
  const src: DiagnosticSource = {};
  const doc = el.ownerDocument as object | undefined;
  const entry = doc && typeof doc === 'object' ? TEXTS.get(doc) : undefined;
  const f = entry?.file ?? file;
  if (f !== undefined) src.file = f;
  if (entry?.useLines === false) {
    // 読む前に字を変えた (内部実体の展開で改行の数が変わった) ので、行・列は読んだ字と合わない
  } else if (typeof el.lineNumber === 'number' && el.lineNumber > 0) {
    src.line = el.lineNumber;
    if (entry?.useColumns !== false && typeof el.columnNumber === 'number' && el.columnNumber > 0) src.column = el.columnNumber;
  } else {
    const off = OFFSETS.get(el as object);
    const lc = off !== undefined && entry ? lineColumn(entry, off) : undefined;
    if (lc) Object.assign(src, lc);
  }
  const hint = elementHint(el);
  if (hint) src.element = hint;
  return src;
}

/** 組版の診断に、節の場所と sourceRef を足す (節が無い・場所が分からなければ、そのまま) */
export function withSource(d: Diagnostic, node: unknown): Diagnostic {
  if (!node || typeof node !== 'object') return d;
  const ref = sourceRef(node);
  const src = nodeSource(node);
  if (!src && ref === undefined) return d;
  return { ...d, source: { ...d.source, ...src, ...(ref !== undefined ? { sourceRef: ref } : {}) } };
}

// ── htmlparser2 (linkedom) の開きタグの位置 ──

/** いま開きタグを渡している Parser の、開きタグの位置 (endOpenTag の間だけ) */
let openTagAt: number | undefined;

let patched: Promise<boolean> | undefined;
/**
 * htmlparser2 の Parser と linkedom の文書に、開きタグの位置を要素に結び付ける仕掛けを入れる (1 度だけ)。
 * 入れたか (作りが合わないときは偽で、何もしない。場所が無いだけで、読み取りは変わらない)
 */
export function patchHtmlLocations(Parser: unknown, linkedomDomParser: unknown): boolean {
  if (typeof Parser !== 'function' || typeof linkedomDomParser !== 'function') return false;
  const proto = Parser.prototype as { endOpenTag?: (this: { openTagStart?: number }, implied: boolean) => void; [k: symbol]: unknown };
  const end = proto.endOpenTag;
  if (typeof end !== 'function') return false;
  // 作られる文書の型 (linkedom の HTMLDocument) の createElement・createElementNS を探す
  let doc: object;
  try {
    doc = new (linkedomDomParser as new () => { parseFromString(t: string, m: string): object })().parseFromString('<p></p>', 'text/html');
  } catch {
    return false;
  }
  const owner = (name: string) => {
    for (let p: object | null = doc; p; p = Object.getPrototypeOf(p)) if (Object.prototype.hasOwnProperty.call(p, name)) return p as Record<string, unknown>;
    return undefined;
  };
  const targets = ['createElement', 'createElementNS'].map((n) => [n, owner(n)] as const);
  if (targets.some(([n, o]) => !o || typeof o[n] !== 'function')) return false;
  const MARK = Symbol.for('kumiori.htmlLocations');
  if (proto[MARK]) return true;
  proto[MARK] = true;
  proto.endOpenTag = function (this: { openTagStart?: number }, implied: boolean) {
    const prev = openTagAt;
    // 書かれていない (補った) 開きタグは、場所を持たない
    openTagAt = implied ? undefined : this.openTagStart;
    try {
      end.call(this, implied);
    } finally {
      openTagAt = prev;
    }
  };
  for (const [name, o] of targets) {
    const orig = o![name] as (...a: unknown[]) => object;
    o![name] = function (this: unknown, ...a: unknown[]) {
      const el = orig.apply(this, a);
      if (openTagAt !== undefined && el && typeof el === 'object' && !OFFSETS.has(el)) OFFSETS.set(el, openTagAt);
      return el;
    };
  }
  return true;
}

/** patchHtmlLocations を 1 度だけ行う (htmlparser2 と linkedom を読み込む関数を渡す) */
export function ensureHtmlLocations(load: () => Promise<{ Parser: unknown; DOMParser: unknown }>): Promise<boolean> {
  return (patched ??= load()
    .then((m) => patchHtmlLocations(m.Parser, m.DOMParser))
    .catch(() => false));
}
