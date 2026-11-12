/**
 * 未対応の CSS の通知: 作成者スタイルシート (文書が <link>・<style> で付けた CSS と、要素の style 属性。CSS Cascade の author の出どころ) の宣言のうち、
 * Kumiori が読まないものを数える。
 *  - 未対応のプロパティ: 対応仕様説明書 (docs/conformance/html) の 16 章「対応していないプロパティ」と同じ一覧。
 *    説明書の表を直したら、ここも同じに直す
 *  - 未対応の値: 対応しているプロパティのうち、特定の値だけ読まないもの (16 章の 2 つ目の表のうち、値で見分けられるもの)
 *  - 知らないプロパティ: Kumiori のカスケード (cssCascade の PROPS と一括指定) にも、自前で読む宣言 (htmlPaged の isPagedDecl) にも
 *    無い名前。綴りの誤りか未対応。カスタム プロパティ (--*) と、接頭辞付き (-webkit-* など) は数えない
 * 結果は typeset の warnings に 1 行ずつ出す (ブラウザの画面の「変換レポート」と同じ数え方)
 */
import { isKnownCssProperty } from './cssCascade';
import { stripImportant } from './cssText';
import { isPagedDecl, type ParsedCss } from './htmlPaged';

/** 対応していないプロパティ (対応仕様説明書 HTML と CSS 編 16 章) */
export const UNSUPPORTED_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'border-image',
  'border-image-source',
  'border-image-slice',
  'border-image-width',
  'border-image-outset',
  'border-image-repeat',
  'justify-items',
  'justify-self',
  'place-items',
  'font-size-adjust',
  'font-variant-alternates',
  'font-variant-emoji',
  'font-language-override',
  'ascent-override',
  'descent-override',
  'line-gap-override',
  'text-wrap-mode',
  'text-wrap-style',
  'text-decoration-skip-ink',
  'footnote-display',
  'footnote-policy',
  'grid',
  'grid-template',
  'grid-template-rows',
  'grid-template-areas',
  'grid-area',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-auto-columns',
  'image-orientation',
  'image-rendering',
  'marker-side',
  'text-overflow',
  'overflow-block',
  'overflow-inline',
  'overflow-clip-margin',
  'page-orientation',
  // 回り込みの形 (CSS Shapes 1 §6.1〜§6.3)。Kumiori の回り込みは、いつも箱の形 (margin box)
  'shape-outside',
  'shape-image-threshold',
  'shape-margin',

  'text-align-all',
  'text-justify',
  'text-wrap',
  'text-underline-position',
  'text-shadow',

  'glyph-orientation-vertical',
]);

/**
 * 印刷では意味のないプロパティ (画面の操作・表示だけに効く)。未対応・知らないプロパティとして数えない (警告に出さない)。
 *  - 対応仕様説明書 (HTML と CSS 編) の「印刷に関わらないプロパティ」の表の 22 項目。説明書の表を直したら、ここも同じに直す
 *  - アニメーション・遷移 (CSS Animations 1・CSS Transitions 1)、スクロール (CSS Overflow 3・4、CSS Scroll Snap 1・CSS Scrollbars 1)、
 *    タッチの操作 (touch-action)、描画の予告 (will-change)、画面の字の大きさの調整 (text-size-adjust)、画面の遷移 (view-transition-name)、
 *    音声 (speak。CSS Speech 1 は音声の媒体だけに効く)
 */
const PRINT_IRRELEVANT_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'speak-as',
  'font-display',
  'scroll-behavior',
  'scrollbar-gutter',
  'accent-color',
  'appearance',
  'caret',
  'caret-color',
  'caret-shape',
  'caret-animation',
  'cursor',
  'interactivity',
  'interest-delay',
  'interest-delay-start',
  'interest-delay-end',
  'nav-up',
  'nav-down',
  'nav-left',
  'nav-right',
  'pointer-events',
  'resize',
  'user-select',
  'touch-action',
  'will-change',
  'text-size-adjust',
  'view-transition-name',
  'view-transition-class',
  'speak',
]);
/** 名前の頭で見分ける、印刷では意味のないプロパティ (animation-name・transition-duration・scroll-margin-top・overscroll-behavior-x・scrollbar-width など) */
const PRINT_IRRELEVANT_PREFIX = /^(animation|transition|scroll-|overscroll-behavior|scrollbar-)/;

/** 印刷では意味のないプロパティか (警告に出さない) */
export function isPrintIrrelevantCssProperty(p: string): boolean {
  return PRINT_IRRELEVANT_CSS_PROPERTIES.has(p) || PRINT_IRRELEVANT_PREFIX.test(p);
}

/** 対応しているプロパティのうち、読まない値 (16 章の 2 つ目の表のうち、値で見分けられるもの) */
export const UNSUPPORTED_CSS_VALUES: Readonly<Record<string, readonly string[]>> = {
  position: ['sticky'],
  display: ['run-in'],
  'writing-mode': ['sideways-lr'],
  'ruby-merge': ['auto'],
  // 描く範囲の text は CSS Backgrounds 4 の値 (Backgrounds 3 §2.7 の <visual-box> は border-box・padding-box・content-box)
  'background-clip': ['text'],
  'hyphenate-limit-last': ['column', 'page', 'spread'],
};

/**
 * 対応しているプロパティのうち、値の中の語で見分ける、読まない値 (ほかの語と組んで書ける値)。「prop: 語」として数える
 *  - hanging-punctuation の last (CSS Text 3 §8.2.1: 最後の行の末尾の終わり括弧・引用符をぶら下げる。first・allow-end などは読む)
 */
const UNSUPPORTED_CSS_VALUE_WORDS: Readonly<Record<string, readonly string[]>> = {
  'hanging-punctuation': ['last'],
};
/** 宣言の値の中の、読まない関数 (prop → 関数の名前)。「名前()」として数える。target-counters() (CSS Content 3 §6.2。入れ子のカウンターの値の並び) */
const UNSUPPORTED_CSS_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
  content: ['target-counters'],
};

export interface UnsupportedCssReport {
  /** 未対応のプロパティ・値 (「prop」「prop: value」) → 宣言の数 */
  unsupported: Record<string, number>;
  /** 知らないプロパティ → 宣言の数 */
  unknown: Record<string, number>;
}

/** style 属性の宣言を分ける (括弧・引用符の中の ; と : は区切りにしない) */
export function splitStyleAttribute(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const flush = (end: number) => {
    const decl = text.slice(start, end);
    const colon = decl.indexOf(':');
    if (colon > 0) out.push([decl.slice(0, colon).trim().toLowerCase(), decl.slice(colon + 1).trim()]);
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(depth - 1, 0);
    else if (ch === ';' && depth === 0) flush(i);
  }
  flush(text.length);
  return out;
}

/**
 * SVG の要素にだけ当てはまる性質のうち、文書の中にじかに書いた <svg> に届けないもの。HTML の要素の箱には当てはまらないので、
 * そこに書いても何もしないのが正しい (未対応・知らないプロパティに数えない)。文書の中に <svg> があるときだけ、
 * 「<名前> (SVG の要素)」として未対応に数える (SVG の要素に書いても効かないため)。
 *  - paint-order (SVG 2 §13.8)、color-interpolation (§13.9)、図形の位置と大きさ cx・cy・r・rx・ry・x・y (§7) と d (§9.3.1)
 *  - color-interpolation-filters・flood-color・flood-opacity・lighting-color (Filter Effects 1)、mask-type (CSS Masking 1 §7.2)
 * fill・stroke など、<svg> に届ける性質は cssCascade の SVG_STYLE_PROPS (isKnownCssProperty が真)
 */
const SVG_ONLY_UNSUPPORTED: ReadonlySet<string> = new Set(['paint-order', 'color-interpolation', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'd', 'color-interpolation-filters', 'flood-color', 'flood-opacity', 'lighting-color', 'mask-type']);
/**
 * SVG の描き方の手がかり (SVG 2 §13.10.1 shape-rendering・§13.10.2 text-rendering:「provides a hint to the implementation」)。
 * 手がかりに従わなくてもよいので、何もしない (未対応・知らないプロパティに数えない)
 */
const SVG_RENDERING_HINTS: ReadonlySet<string> = new Set(['shape-rendering', 'text-rendering']);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 1 つの宣言を数える。svg: この宣言が、文書の中の <svg> の要素に当たりうるか (規則は文書に <svg> があるか、style 属性はその要素が SVG の要素か) */
function count(rep: UnsupportedCssReport, prop: string, value: string, svg = false) {
  const p = prop.toLowerCase();
  if (!p || p.startsWith('--') || isPrintIrrelevantCssProperty(p)) return;
  if (SVG_RENDERING_HINTS.has(p)) return;
  if (SVG_ONLY_UNSUPPORTED.has(p)) {
    if (svg) rep.unsupported[`${p} (SVG の要素)`] = (rep.unsupported[`${p} (SVG の要素)`] ?? 0) + 1;
    return;
  }
  const v = stripImportant(value, false);
  if (UNSUPPORTED_CSS_PROPERTIES.has(p)) {
    rep.unsupported[p] = (rep.unsupported[p] ?? 0) + 1;
    return;
  }
  const words = UNSUPPORTED_CSS_VALUE_WORDS[p];
  if (words) {
    const ws = v.toLowerCase().split(/\s+/);
    for (const w of words) if (ws.includes(w)) rep.unsupported[`${p}: ${w}`] = (rep.unsupported[`${p}: ${w}`] ?? 0) + 1;
  }
  for (const fn of UNSUPPORTED_CSS_FUNCTIONS[p] ?? []) if (new RegExp(`(^|[^-\\w])${fn}\\(`, 'i').test(v)) rep.unsupported[`${fn}()`] = (rep.unsupported[`${fn}()`] ?? 0) + 1;
  const vals = UNSUPPORTED_CSS_VALUES[p];
  if (vals) {
    const lv = v.toLowerCase();
    if (vals.includes(lv)) {
      const key = `${p}: ${lv}`;
      rep.unsupported[key] = (rep.unsupported[key] ?? 0) + 1;
      return;
    }
  }
  // 接頭辞付き (-webkit-・-moz-・-ms-・-o-・-ah-・-kumiori-) は数えない (ブラウザ向けの指定か、自前で読む拡張)
  if (p.startsWith('-')) return;
  if (isKnownCssProperty(p, v) || isPagedDecl(p, v)) return;
  rep.unknown[p] = (rep.unknown[p] ?? 0) + 1;
}

/**
 * 作成者スタイルシート (読んだスタイルシート) と、文書の style 属性の宣言を数える。
 * @page の宣言と余白の箱の宣言、@font-face の記述子は、知らないプロパティとしては数えない (別の決まりで読む)。
 * @page の未対応の記述子 (page-orientation) と、余白の箱の content の未対応の関数 (target-counters()) は数える。
 * 読まずに捨てた規則・書き方 (@namespace・@page :nth()。parseCss の ignored) も数える
 */
export function unsupportedCssReport(sheet: ParsedCss | undefined, doc?: Document): UnsupportedCssReport {
  const rep: UnsupportedCssReport = { unsupported: Object.create(null), unknown: Object.create(null) };
  const add = (k: string) => (rep.unsupported[k] = (rep.unsupported[k] ?? 0) + 1);
  for (const k of sheet?.ignored ?? []) add(k);
  for (const pg of sheet?.pages ?? []) {
    for (const p of Object.keys(pg.decls)) if (UNSUPPORTED_CSS_PROPERTIES.has(p.toLowerCase())) add(p.toLowerCase());
    for (const box of Object.values(pg.boxes)) if (box.content && /(^|[^-\w])target-counters\(/i.test(box.content)) add('target-counters()');
  }
  // 文書の中にじかに書いた <svg> があるか (SVG の要素にだけ当てはまる性質を、未対応に数えるかを決める)
  const hasSvg = !!doc && Array.from((doc.getElementsByTagName?.('svg') ?? []) as ArrayLike<Element>).length > 0;
  for (const r of sheet?.rules ?? []) for (const [p, v] of Object.entries(r.decls)) count(rep, p, v, hasSvg);
  if (doc) {
    const els = doc.querySelectorAll?.('[style]') ?? [];
    for (const el of Array.from(els) as Element[]) {
      const st = el.getAttribute('style');
      // style 属性は、その要素が SVG の要素 (<svg> とその中の要素) のときだけ、SVG の性質が当たる
      const inSvg = hasSvg && (el.namespaceURI === SVG_NS || !!el.closest?.('svg'));
      if (st) for (const [p, v] of splitStyleAttribute(st)) count(rep, p, v, inSvg);
    }
  }
  return rep;
}

/** 警告の文: 多い順に「名前 (数)」を並べる (多すぎれば先頭の max 件と残りの数) */
export function summarizeCounts(counts: Record<string, number> | undefined, max = 20): string {
  const items = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!items.length) return '';
  const head = items.slice(0, max).map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
  return head.join('、') + (items.length > max ? ` …ほか ${items.length - max} 種` : '');
}

// 入力の名前 (プロパティ・値・属性の値) で引く定数の表は、原型を持たないものにする: 原型があると、constructor・__proto__・toString などの名前で
// Object.prototype の関数を拾い、30 バイトほどの入力 (p { constructor: 1 }) で、文書の全体が TypeError で組めなくなる
for (const t of [UNSUPPORTED_CSS_VALUES, UNSUPPORTED_CSS_VALUE_WORDS, UNSUPPORTED_CSS_FUNCTIONS]) Object.setPrototypeOf(t, null);
