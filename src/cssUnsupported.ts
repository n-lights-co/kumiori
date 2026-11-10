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
import { isPagedDecl, type ParsedCss } from './htmlPaged';

/** 対応していないプロパティ (対応仕様説明書 HTML と CSS 編 16 章) */
export const UNSUPPORTED_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'empty-cells',
  'background-attachment',
  'background-clip',
  'background-origin',
  'border-image',
  'border-image-source',
  'border-image-slice',
  'border-image-width',
  'border-image-outset',
  'border-image-repeat',
  'justify-items',
  'justify-self',
  'place-items',
  'opacity',
  'font-size-adjust',
  'font-synthesis',
  'font-synthesis-weight',
  'font-synthesis-style',
  'font-synthesis-small-caps',
  'font-synthesis-position',
  'font-variant-alternates',
  'font-variant-east-asian',
  'font-variant-emoji',
  'font-variation-settings',
  'font-optical-sizing',
  'font-language-override',
  'font-palette',
  'font-width',
  'ascent-override',
  'descent-override',
  'line-gap-override',
  'font-named-instance',
  'base-palette',
  'override-colors',
  'box-decoration-break',
  'hyphenate-limit-zone',
  'hyphenate-limit-lines',
  'hyphenate-limit-last',
  'text-wrap-mode',
  'text-wrap-style',
  'text-decoration-thickness',
  'text-underline-offset',
  'text-decoration-skip-ink',
  'clip',
  'fill',
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
  'object-position',
  'initial-letter',
  'list-style-image',
  'marker-side',
  'text-overflow',
  'overflow-block',
  'overflow-inline',
  'overflow-clip-margin',
  'page-orientation',
  'ruby-position',
  'ruby-align',
  'ruby-merge',
  'ruby-overhang',
  'tab-size',
  'text-align-all',
  'text-justify',
  'hyphenate-character',
  'hyphenate-limit-chars',
  'text-wrap',
  'text-decoration-style',
  'text-emphasis-color',
  // text-emphasis-position は under・left に対応した (htmlImport の decorateText)。この一覧は対応仕様説明書 16 章の表と同じにしてあるので
  // (test/unsupportedWarnings.test.ts)、説明書の表から外すときに、ここからも外す
  'text-emphasis-position',
  'text-underline-position',
  'text-shadow',
  'transform',
  'transform-origin',
  'transform-box',
  'outline',
  'outline-color',
  'outline-style',
  'outline-width',
  'outline-offset',
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

/** 1 つの宣言を数える */
function count(rep: UnsupportedCssReport, prop: string, value: string) {
  const p = prop.toLowerCase();
  if (!p || p.startsWith('--') || isPrintIrrelevantCssProperty(p)) return;
  const v = value.replace(/\s*!important\s*$/i, '').trim();
  if (UNSUPPORTED_CSS_PROPERTIES.has(p)) {
    rep.unsupported[p] = (rep.unsupported[p] ?? 0) + 1;
    return;
  }
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
 * @page の宣言と余白の箱の宣言、@font-face の記述子は数えない (別の決まりで読む)
 */
export function unsupportedCssReport(sheet: ParsedCss | undefined, doc?: Document): UnsupportedCssReport {
  const rep: UnsupportedCssReport = { unsupported: {}, unknown: {} };
  for (const r of sheet?.rules ?? []) for (const [p, v] of Object.entries(r.decls)) count(rep, p, v);
  if (doc) {
    const els = doc.querySelectorAll?.('[style]') ?? [];
    for (const el of Array.from(els) as Element[]) {
      const st = el.getAttribute('style');
      if (st) for (const [p, v] of splitStyleAttribute(st)) count(rep, p, v);
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
