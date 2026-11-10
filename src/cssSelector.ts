/**
 * cssSelector — CSS のセレクタを読み、要素に合うかを調べる (ブラウザを経由しないカスケード用)。
 *
 *  - 単純セレクタ: 型 (* を含む)・#id・.class・[属性] (= ~= |= ^= $= *=、i)・疑似クラス
 *  - 結合子: 子孫 ( )・子 (>)・隣接 (+)・後続 (~)
 *  - 疑似クラス: :root :first-child :last-child :only-child :nth-child() :nth-last-child() :first-of-type :last-of-type
 *    :only-of-type :nth-of-type() :nth-last-of-type() :not() :is() :where() :matches() :has() :empty :lang() :link :any-link
 *    :checked :disabled :enabled。動的な疑似クラス (:hover など) は合わない
 *  - 疑似要素: ::before ::after (:before :after も)。ほかの疑似要素は名前だけ持つ
 *  - 詳細度は [id, class, type] を 1 つの数 (a×10⁶ + b×10³ + c) にする
 */
import { splitTop } from './cssText';

type AttrOp = '' | '=' | '~=' | '|=' | '^=' | '$=' | '*=';

interface Compound {
  tag?: string;
  ids: string[];
  classes: string[];
  /** ci: true は i (大文字小文字を区別しない)、false は s (区別する)、undefined は属性の名前で決める (HTML 5.2 §4.15.1) */
  attrs: Array<{ name: string; op: AttrOp; value: string; ci?: boolean }>;
  /** of: :nth-child(An+B of S) の S。subSiblings: :has() の相対セレクタ (sub) ごとの、先頭の結合子が + ~ か */
  pseudos: Array<{ name: string; arg?: string; sub?: Selector[]; nth?: [number, number]; of?: Selector[]; subSiblings?: boolean[] }>;
}

/** 右から左へ: compounds[i] と compounds[i+1] の間の結合子が combs[i] */
export interface Selector {
  compounds: Compound[];
  combs: string[];
  /** 疑似要素 (before / after など。無ければ undefined) */
  pseudoElement?: string;
  specificity: number;
}

const spec = (a: number, b: number, c: number) => a * 1e6 + b * 1e3 + c;

/**
 * セレクタの並び (a, b) を読む。どれか 1 つでも読めなければ、並び全体を読めないとして空を返す (Selectors 4 §3.9)。
 * forgiving (:is()・:where() の中) なら、読めないものだけ捨てる
 */
export function parseSelectorList(text: string, forgiving = false): Selector[] {
  const out: Selector[] = [];
  for (const part of splitComma(text)) {
    const s = parseComplex(part.trim());
    if (s) out.push(s);
    else if (!forgiving) return [];
  }
  return out;
}

/** 知っている疑似クラス (動的なもの・この処理では合わないものも含む)。知らない疑似クラスは、セレクタを読めなくする */
const KNOWN_PSEUDO_CLASSES = new Set(
  (
    'root scope first-child last-child only-child first-of-type last-of-type only-of-type nth-child nth-last-child nth-of-type nth-last-of-type ' +
    'not is where matches -webkit-any has empty lang dir link any-link visited local-link target target-within hover active focus focus-within ' +
    'focus-visible checked disabled enabled default indeterminate valid invalid in-range out-of-range required optional read-only read-write ' +
    'placeholder-shown autofill user-valid user-invalid blank current past future playing paused defined open closed modal fullscreen ' +
    'popover-open host host-context first left right heading'
  ).split(' '),
);
/** 知っている疑似要素 */
const KNOWN_PSEUDO_ELEMENTS = new Set('before after first-line first-letter marker placeholder selection backdrop footnote-call footnote-marker file-selector-button grammar-error spelling-error target-text cue'.split(' '));

/** セレクタの並びをカンマで分ける (括弧・[ ]・文字列の中では分けない) */
const splitComma = (s: string): string[] => splitTop(s, ',', { brackets: true });

/** 16 進の逃がしの字。0・サロゲート・0x10FFFF を超える値は U+FFFD (CSS Syntax 3 §4.3.7) */
const cssCodePoint = (hex: string) => {
  const cp = parseInt(hex, 16);
  return String.fromCodePoint(cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? 0xfffd : cp);
};
// 逃がし (CSS Syntax 3 §4.3.7): 16 進の逃がしは、後ろの空白 1 つまでを含む。ほかの字の逃がしは、その字
const ESC = String.raw`\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f0-9a-fA-F])`;
const IDENT = new RegExp(String.raw`^-?(?:[_a-zA-Z\u0080-\uffff]|${ESC})(?:[-_a-zA-Z0-9\u0080-\uffff]|${ESC})*`);
const unesc = (s: string) => s.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\(.)/g, (_m, h: string | undefined, ch: string | undefined) => (h ? cssCodePoint(h) : (ch ?? '')));

function parseComplex(text: string): Selector | undefined {
  const compounds: Compound[] = [];
  const combs: string[] = [];
  let pseudoElement: string | undefined;
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  let cur: Compound = { ids: [], classes: [], attrs: [], pseudos: [] };
  let empty = true;
  const s = text;
  const push = () => {
    if (empty) return false;
    compounds.push(cur);
    cur = { ids: [], classes: [], attrs: [], pseudos: [] };
    empty = true;
    return true;
  };
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      // 結合子 (空白だけなら子孫)
      let j = i;
      let comb = ' ';
      while (j < s.length && /[\s>+~]/.test(s[j])) {
        if (s[j] !== ' ' && !/\s/.test(s[j])) comb = s[j];
        j++;
      }
      // 末尾の結合子 (div >) は不正なセレクタ (Selectors 4 §16。空白だけなら末尾の空白)
      if (j >= s.length) {
        if (comb !== ' ') return undefined;
        break;
      }
      if (!push()) {
        if (comb === ' ') {
          i = j;
          continue;
        }
        return undefined; // 先頭の結合子 (相対セレクタ) はここでは読まない
      }
      combs.push(comb);
      i = j;
      continue;
    }
    empty = false;
    if (ch === '*') {
      i++;
    } else if (ch === '#' || ch === '.') {
      const m = IDENT.exec(s.slice(i + 1));
      if (!m) return undefined;
      if (ch === '#') {
        cur.ids.push(unesc(m[0]));
        a++;
      } else {
        cur.classes.push(unesc(m[0]));
        b++;
      }
      i += 1 + m[0].length;
    } else if (ch === '[') {
      const close = findClose(s, i, '[', ']');
      if (close < 0) return undefined;
      const body = s.slice(i + 1, close).trim();
      const m = /^((?:[-\w*]*\|(?!=))?[-\w]+)\s*(?:([~|^$*]?=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]+))\s*([iIsS])?)?$/.exec(body);
      if (!m) return undefined;
      const flag = (m[6] ?? '').toLowerCase();
      cur.attrs.push({ name: m[1].replace(/^\*?\|/, '').toLowerCase(), op: (m[2] ?? '') as AttrOp, value: unesc(m[3] ?? m[4] ?? m[5] ?? ''), ...(flag ? { ci: flag === 'i' } : {}) });
      b++;
      i = close + 1;
    } else if (ch === ':') {
      const isElement = s[i + 1] === ':';
      const start = i + (isElement ? 2 : 1);
      const m = IDENT.exec(s.slice(start));
      if (!m) return undefined;
      const name = m[0].toLowerCase();
      let j = start + m[0].length;
      let arg: string | undefined;
      if (s[j] === '(') {
        const close = findClose(s, j, '(', ')');
        if (close < 0) return undefined;
        arg = s.slice(j + 1, close).trim();
        j = close + 1;
      }
      i = j;
      if (isElement || name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') {
        // 知らない疑似要素・疑似要素の後ろのものは読めない
        if (!KNOWN_PSEUDO_ELEMENTS.has(name) || pseudoElement) return undefined;
        pseudoElement = name;
        c++;
        continue;
      }
      if (!KNOWN_PSEUDO_CLASSES.has(name) || pseudoElement) return undefined;
      const p: Compound['pseudos'][number] = { name, ...(arg !== undefined ? { arg } : {}) };
      if (/^(not|is|where|matches|-webkit-any|has)$/.test(name)) {
        // :is()・:where() は読めないものだけ捨てる。:not()・:has() は 1 つでも読めなければ読めない
        const forgiving = !/^(not|has)$/.test(name);
        if (name === 'has') {
          // :has() の引数は相対セレクタの並び (Selectors 4 §4.5)。相対セレクタは、1 つずつ、基準の要素 (:scope) と結合子を先頭に補って読む
          // (結合子が無ければ子孫。§3.4)。補った :scope は詳細度に数えない。疑似要素は :has() の中に書けない
          p.sub = [];
          p.subSiblings = [];
          for (const rel of splitComma(arg ?? '')) {
            const sub = parseComplex(`:scope ${rel.trim()}`);
            if (!sub || sub.pseudoElement) return undefined;
            sub.specificity -= spec(0, 1, 0);
            p.sub.push(sub);
            p.subSiblings.push(/^[+~]/.test(rel.trim()));
          }
        } else p.sub = parseSelectorList(arg ?? '', forgiving);
        if (!p.sub.length && !forgiving) return undefined;
        // :is・:not・:has は中で一番高い詳細度、:where は 0
        if (name !== 'where') {
          const top = Math.max(0, ...p.sub.map((x) => x.specificity));
          a += Math.floor(top / 1e6);
          b += Math.floor((top % 1e6) / 1e3);
          c += top % 1e3;
        }
      } else {
        if (/^nth-/.test(name)) {
          const ofM = /^(.*?)\s+of\s+(.*)$/s.exec(arg ?? '');
          const nth = parseNth(ofM ? ofM[1] : (arg ?? ''));
          if (!nth) return undefined;
          p.nth = nth;
          // :nth-child(An+B of S): S に合う兄弟の中の順。詳細度に S の一番高いものを足す (Selectors 4 §13.3.1)
          if (ofM && /^nth-(last-)?child$/.test(name)) {
            p.of = parseSelectorList(ofM[2]);
            if (!p.of.length) return undefined;
            const top = Math.max(0, ...p.of.map((x) => x.specificity));
            a += Math.floor(top / 1e6);
            b += Math.floor((top % 1e6) / 1e3);
            c += top % 1e3;
          } else if (ofM) return undefined;
        }
        b++;
      }
      cur.pseudos.push(p);
    } else if (ch === '&') {
      i++;
    } else {
      const m = IDENT.exec(s.slice(i));
      if (!m) return undefined;
      // 名前空間の接頭辞 (svg|rect など) は読み飛ばす
      let tag = m[0];
      i += tag.length;
      if (s[i] === '|') {
        const m2 = IDENT.exec(s.slice(i + 1));
        if (!m2) return undefined;
        tag = m2[0];
        i += 1 + m2[0].length;
      }
      cur.tag = unesc(tag).toLowerCase();
      c++;
    }
  }
  if (!push() && !compounds.length) return undefined;
  // 右から左に並べる
  compounds.reverse();
  combs.reverse();
  return { compounds, combs, ...(pseudoElement ? { pseudoElement } : {}), specificity: spec(a, b, c) };
}

function findClose(s: string, from: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  for (let k = from; k < s.length; k++) {
    const ch = s[k];
    if (quote) {
      if (ch === '\\') k++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return k;
  }
  return -1;
}

/** an+b (odd・even を含む) → [a, b] */
export function parseNth(t: string): [number, number] | undefined {
  const s = t.replace(/\s+/g, '').toLowerCase();
  if (s === 'odd') return [2, 1];
  if (s === 'even') return [2, 0];
  if (/^[+-]?\d+$/.test(s)) return [0, parseInt(s, 10)];
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s);
  if (!m) return undefined;
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10);
  return [a, m[2] ? parseInt(m[2], 10) : 0];
}

const nthOk = ([a, b]: [number, number], pos: number) => (a === 0 ? pos === b : (pos - b) / a >= 0 && (pos - b) % a === 0);

const elementChildren = (p: Node | null): Element[] => {
  const out: Element[] = [];
  for (let n = p?.firstChild ?? null; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
};
/**
 * 親ごとの子の要素の一覧と、要素の位置・種類ごとの位置を覚えておく (構造の疑似クラスを、兄弟の多い親で毎回作り直さない)。
 * 最初と最後の子が変わっているか、調べる要素 el の覚えた位置の前後の兄弟が今と違えば作り直す (文書を書き換えた後でも古い一覧を使わない)。
 * 子の数は見ない: linkedom の childNodes.length は子の数に比例する時間がかかり、兄弟 n 個の照合が n² になる
 */
interface SibInfo { first: Node | null; last: Node | null; all: Element[]; pos: Map<Element, number>; types: Map<string, Element[]>; typePos: Map<Element, number> }
const sibCache = new WeakMap<Node, SibInfo>();
const sibInfo = (p: Node, el: Element): SibInfo => {
  const c = sibCache.get(p);
  if (c && c.first === p.firstChild && c.last === p.lastChild) {
    const k = c.pos.get(el);
    if (k !== undefined && (c.all[k - 1] ?? null) === prevEl(el) && (c.all[k + 1] ?? null) === nextEl(el)) return c;
  }
  const all = elementChildren(p);
  const pos = new Map<Element, number>();
  const types = new Map<string, Element[]>();
  const typePos = new Map<Element, number>();
  all.forEach((e, k) => {
    pos.set(e, k);
    const t = nameOf(e);
    let list = types.get(t);
    if (!list) types.set(t, (list = []));
    typePos.set(e, list.length);
    list.push(e);
  });
  const info = { first: p.firstChild, last: p.lastChild, all, pos, types, typePos };
  sibCache.set(p, info);
  return info;
};
const parentEl = (el: Element): Element | null => {
  const p = el.parentNode;
  return p && p.nodeType === 1 ? (p as Element) : null;
};
const prevEl = (el: Element): Element | null => {
  for (let n = el.previousSibling; n; n = n.previousSibling) if (n.nodeType === 1) return n as Element;
  return null;
};
const nextEl = (el: Element): Element | null => {
  for (let n = el.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) return n as Element;
  return null;
};
const nameOf = (el: Element) => (el.localName ?? el.nodeName).toLowerCase();

/** 要素がセレクタに合うか (疑似要素の部分は見ない) */
export function matches(el: Element, sel: Selector, scope?: Element): boolean {
  return matchFrom(el, sel, 0, scope);
}

function matchFrom(el: Element, sel: Selector, k: number, scope?: Element): boolean {
  if (!matchCompound(el, sel.compounds[k], scope)) return false;
  if (k === sel.compounds.length - 1) return true;
  const comb = sel.combs[k];
  if (comb === '>') {
    const p = parentEl(el);
    return !!p && matchFrom(p, sel, k + 1, scope);
  }
  if (comb === ' ') {
    for (let p = parentEl(el); p; p = parentEl(p)) if (matchFrom(p, sel, k + 1, scope)) return true;
    return false;
  }
  if (comb === '+') {
    const p = prevEl(el);
    return !!p && matchFrom(p, sel, k + 1, scope);
  }
  for (let p = prevEl(el); p; p = prevEl(p)) if (matchFrom(p, sel, k + 1, scope)) return true;
  return false;
}

function attrValue(el: Element, name: string): string | null {
  if (el.hasAttribute(name)) return el.getAttribute(name);
  // xml:lang など、接頭辞つきの属性
  for (const a of Array.from(el.attributes ?? [])) if (a.name.toLowerCase() === name) return a.value;
  return null;
}

/** HTML の文書で、値の大文字小文字を区別しない属性 (HTML 5.2 §4.15.1) */
const CI_ATTRS = new Set(
  (
    'accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare defer dir direction disabled enctype face ' +
    'frame hreflang http-equiv lang language link media method multiple nohref noresize noshade nowrap readonly rel rev rules scope scrolling ' +
    'selected shape target text type valign valuetype vlink'
  ).split(' '),
);
const isHtmlDoc = (el: Element) => ((el.ownerDocument as Document | null)?.contentType ?? 'text/html') === 'text/html';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const isHtmlEl = (el: Element) => !el.namespaceURI || el.namespaceURI === HTML_NS;

/**
 * 文書の互換性のモード (no-quirks・limited-quirks・quirks)。カスケードを作るときに記録し、セレクタの照合と組版で引く。
 * quirks の文書では、ID とクラスのセレクタは ASCII の大文字小文字を区別しない (HTML Living Standard §4.16.2)
 */
export type DocumentMode = 'no-quirks' | 'limited-quirks' | 'quirks';
const docModes = new WeakMap<object, DocumentMode>();
export function setDocumentMode(doc: Document, mode: DocumentMode): void {
  docModes.set(doc, mode);
}
export const documentModeOf = (doc: Document | null | undefined): DocumentMode => (doc && docModes.get(doc)) || 'no-quirks';
export const isQuirksDoc = (doc: Document | null | undefined) => documentModeOf(doc) === 'quirks';
/** ASCII の大文字だけを小文字にする */
export const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

function matchCompound(el: Element, c: Compound, scope?: Element): boolean {
  if (c.tag && nameOf(el) !== c.tag) return false;
  const q = (c.ids.length || c.classes.length) && isQuirksDoc(el.ownerDocument as Document | null);
  const norm = q ? asciiLower : (s: string) => s;
  for (const id of c.ids) if (norm(el.getAttribute('id') ?? '') !== norm(id)) return false;
  if (c.classes.length) {
    const cls = norm(el.getAttribute('class') ?? '').split(/\s+/);
    for (const k of c.classes) if (!cls.includes(norm(k))) return false;
  }
  for (const a of c.attrs) {
    const v0 = attrValue(el, a.name);
    if (v0 === null) return false;
    if (!a.op) continue;
    const ci = a.ci ?? (CI_ATTRS.has(a.name) && isHtmlEl(el) && isHtmlDoc(el));
    const v = ci ? v0.toLowerCase() : v0;
    const w = ci ? a.value.toLowerCase() : a.value;
    const ok =
      a.op === '=' ? v === w : a.op === '~=' ? v.split(/\s+/).includes(w) : a.op === '|=' ? v === w || v.startsWith(w + '-') : a.op === '^=' ? !!w && v.startsWith(w) : a.op === '$=' ? !!w && v.endsWith(w) : !!w && v.includes(w);
    if (!ok) return false;
  }
  for (const p of c.pseudos) if (!matchPseudo(el, p, scope)) return false;
  return true;
}

function matchPseudo(el: Element, p: Compound['pseudos'][number], scope?: Element): boolean {
  const parent = parentEl(el);
  const info = () => (el.parentNode ? sibInfo(el.parentNode, el) : { all: [el], pos: new Map([[el, 0]]), types: new Map([[nameOf(el), [el]]]), typePos: new Map([[el, 0]]) });
  const sibs = () => info().all;
  const sameType = () => info().types.get(nameOf(el)) ?? [el];
  switch (p.name) {
    case 'root':
      return !parent;
    case 'scope':
      return scope ? el === scope : !parent;
    case 'first-child':
      return sibs()[0] === el;
    case 'last-child': {
      const s = sibs();
      return s[s.length - 1] === el;
    }
    case 'only-child':
      return sibs().length === 1;
    case 'first-of-type':
      return sameType()[0] === el;
    case 'last-of-type': {
      const s = sameType();
      return s[s.length - 1] === el;
    }
    case 'only-of-type':
      return sameType().length === 1;
    case 'nth-child':
    case 'nth-last-child': {
      if (p.of) {
        if (!p.of.some((x) => matches(el, x, scope))) return false;
        const s = sibs().filter((e) => p.of!.some((x) => matches(e, x, scope)));
        return nthOk(p.nth!, p.name === 'nth-child' ? s.indexOf(el) + 1 : s.length - s.indexOf(el));
      }
      const k = info().pos.get(el) ?? 0;
      return nthOk(p.nth!, p.name === 'nth-child' ? k + 1 : sibs().length - k);
    }
    case 'nth-of-type':
      return nthOk(p.nth!, (info().typePos.get(el) ?? 0) + 1);
    case 'nth-last-of-type': {
      const s = sameType();
      return nthOk(p.nth!, s.length - (info().typePos.get(el) ?? 0));
    }
    case 'not':
      return !p.sub!.some((s) => matches(el, s, scope));
    case 'is':
    case 'where':
    case 'matches':
    case '-webkit-any':
      return p.sub!.some((s) => matches(el, s, scope));
    case 'has':
      return p.sub!.some((s, k) => {
        // 子孫 (> は子)・後続の兄弟 (+ ~。その先に結合子が続けば兄弟の子孫も) のどれかが合えば (:scope を el に置き換えて調べる)
        const sibs = p.subSiblings?.[k] ? followingSiblings(el) : undefined;
        const all = sibs ? (s.compounds.length > 2 ? sibs.flatMap((x) => [x, ...descendants(x)]) : sibs) : descendants(el);
        return all.some((d) => matches(d, s, el));
      });
    case 'empty':
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 || (n.nodeType === 3 && (n.nodeValue ?? '') !== '')) return false;
      return true;
    case 'lang': {
      // 言語の範囲の並び。拡張した絞り込み (RFC 4647 §3.3.2) で比べる (Selectors 4 §7.2)。lang="" は言語が分からない (どれにも合わない)
      const ranges = (p.arg ?? '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
      // HTML の文書 (text/html) では lang だけを見る (xml:lang は XML の文書だけ。ブラウザと同じ)
      const xml = ((el.ownerDocument as Document | null)?.contentType ?? 'text/html') !== 'text/html';
      for (let e: Element | null = el; e; e = parentEl(e)) {
        const has = e.hasAttribute('lang') || (xml && e.hasAttribute('xml:lang'));
        if (!has) continue;
        const v = (xml ? e.getAttribute('xml:lang') || e.getAttribute('lang') : e.getAttribute('lang')) ?? '';
        if (!v) return false;
        return ranges.some((r) => langMatches(v.toLowerCase(), r));
      }
      return false;
    }
    case 'dir': {
      const want = (p.arg ?? '').trim().toLowerCase();
      return (want === 'ltr' || want === 'rtl') && directionality(el) === want;
    }
    case 'heading': {
      // :heading は h1〜h6、:heading(整数#) は見出しの段階がそのどれかのもの (HTML Living Standard §4.16.3)
      const lv = headingLevel(el);
      if (lv === undefined) return false;
      if (p.arg === undefined) return true;
      return p.arg.split(',').some((x) => /^\s*[+]?\d+\s*$/.test(x) && parseInt(x, 10) === lv);
    }
    case 'link':
    case 'any-link':
      return /^(a|area|link)$/.test(nameOf(el)) && el.hasAttribute('href');
    case 'checked':
      return el.hasAttribute('checked') || el.hasAttribute('selected');
    case 'disabled':
      return el.hasAttribute('disabled');
    case 'enabled':
      return /^(input|button|select|textarea|option)$/.test(nameOf(el)) && !el.hasAttribute('disabled');
    default:
      // 動的な疑似クラス (:hover・:visited など) と、知らない疑似クラスは合わない
      return false;
  }
}

/** 言語の範囲 (r) が言語の名前 (t) に合うか (RFC 4647 §3.3.2 の拡張した絞り込み) */
function langMatches(tag: string, range: string): boolean {
  const t = tag.split('-');
  const r = range.split('-');
  if (r[0] !== '*' && r[0] !== t[0]) return false;
  let i = 1;
  let j = 1;
  while (i < r.length) {
    if (r[i] === '*') i++;
    else if (j >= t.length) return false;
    else if (r[i] === t[j]) {
      i++;
      j++;
    } else if (t[j].length === 1) return false;
    else j++;
  }
  return true;
}

/**
 * 見出しの段階 (HTML Living Standard §4.3.11.1 の computed heading level)。h1〜h6 でなければ undefined。
 * 名前の数に、祖先 (自分を含む) の headingoffset 属性の値を足す。headingreset 属性のある要素で止める。9 を超えれば 9
 */
export function headingLevel(el: Element): number | undefined {
  const m = /^h([1-6])$/.exec(nameOf(el));
  if (!m) return undefined;
  let offset = 0;
  for (let e: Element | null = el; e; e = parentEl(e)) {
    // 負でない整数の読み方 (rules for parsing non-negative integers): 前の空白を飛ばし、+ は認め、数字の並びを読む
    const v = /^[\t\n\f\r ]*\+?(\d+)/.exec(e.getAttribute('headingoffset') ?? '');
    if (v) offset += parseInt(v[1], 10);
    if (e.hasAttribute('headingreset')) break;
  }
  return Math.min(9, parseInt(m[1], 10) + offset);
}

/** 要素の書字の向き (HTML 5.2 §3.2.5.5 の dir 属性。auto は中の文字の最初の強い向きの字で決める) */
function directionality(el: Element): 'ltr' | 'rtl' {
  for (let e: Element | null = el; e; e = parentEl(e)) {
    const d = (e.getAttribute('dir') ?? '').toLowerCase();
    if (d === 'ltr' || d === 'rtl') return d;
    if (d === 'auto' || (nameOf(e) === 'bdi' && !d)) {
      const m = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u0900-\u1FFF\u3040-\u9FFF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(e.textContent ?? '');
      return m && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]) ? 'rtl' : 'ltr';
    }
  }
  return 'ltr';
}

function descendants(el: Element): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    for (const k of elementChildren(e)) {
      out.push(k);
      walk(k);
    }
  };
  walk(el);
  return out;
}

function followingSiblings(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

/**
 * 文書の要素の索引から選ぶ関数 (querySelectorAll と同じ結果)。右端の複合セレクタのクラス・タグで候補を絞るので、
 * 規則の数だけ選ぶとき (htmlImport の collectPaged) に、規則ごとの全要素の照合を繰り返さない。
 * 索引は作った時点の木 (文書の要素の増減には追わない。カスケードの後は id 属性を付けるだけという前提。id は索引に使わない)
 */
export function selectorIndex(doc: Document): (text: string) => Element[] {
  const root = doc.documentElement;
  const all = root ? [root, ...descendants(root)] : [];
  const q = isQuirksDoc(doc);
  const norm = q ? asciiLower : (s: string) => s;
  const byTag = new Map<string, Element[]>();
  const byClass = new Map<string, Element[]>();
  const add = (m: Map<string, Element[]>, k: string, e: Element) => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };
  for (const e of all) {
    add(byTag, nameOf(e), e);
    for (const c of (e.getAttribute('class') ?? '').split(/\s+/)) if (c) add(byClass, norm(c), e);
  }
  const pool = (s: Selector): Element[] => {
    // compounds は右端 (要素自身に当てる複合セレクタ) から順
    const c = s.compounds[0];
    if (c.classes.length) return byClass.get(norm(c.classes[0])) ?? [];
    if (c.tag && c.tag !== '*') return byTag.get(c.tag) ?? [];
    return all;
  };
  return (text) => {
    const sels = parseSelectorList(text).filter((s) => !s.pseudoElement);
    if (!sels.length) return [];
    if (sels.length === 1) return pool(sels[0]).filter((e) => matches(e, sels[0]));
    const hit = new Set<Element>();
    for (const s of sels) for (const e of pool(s)) if (matches(e, s)) hit.add(e);
    return all.filter((e) => hit.has(e));
  };
}

/** 文書の中の、セレクタの並びに合う要素 (文書順) */
export function querySelectorAll(doc: Document, text: string): Element[] {
  const sels = parseSelectorList(text).filter((s) => !s.pseudoElement);
  if (!sels.length) return [];
  const root = doc.documentElement;
  return root ? [root, ...descendants(root)].filter((e) => sels.some((s) => matches(e, s))) : [];
}
