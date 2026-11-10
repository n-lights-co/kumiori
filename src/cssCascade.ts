/**
 * cssCascade — ブラウザを経由せずに CSS を解釈し、要素ごとの計算値を返す (htmlImport の StyleSource の代わり)。
 *
 *  ① 規則を集める: 既定のスタイルシート (HTML_UA_CSS) → 文書の CSS → style 属性。HTML の属性による指定 (img の width など) も読む
 *  ② カスケード: !important・出どころ (既定 < 作成者 < style 属性。!important は逆順)・詳細度・書いた順で、性質ごとに勝つ宣言を決める。
 *     一括指定 (margin・border・background・font など) は個別の性質に分けてから比べる。読めない値の宣言は捨てる (前の宣言が残る)
 *  ③ 計算値: 継承・初期値・inherit / initial / unset、var()、長さ (em・rem・%・vw・calc() など) を px に、色を rgb() にする。
 *     値の形はブラウザの getComputedStyle に合わせる (htmlImport はブラウザの値と同じように読む)
 *
 * レイアウトはしないので、幅・高さが auto の要素の寸法 (ブラウザが返す使用値) は返さない (auto のまま)。
 * 百分率の幅・余白は、包含ブロックの幅を親から順に見積もって px にする。
 */
import { MAX_VAR_LENGTH, parseCss, setSupportsDecl, splitDecls, unescapeCss, type ParsedCss } from './htmlPaged';
import { fmtColor, parseColor, splitTop, UNIT_PX, type RGBA } from './cssText';
import { UNSUPPORTED_CSS_PROPERTIES, UNSUPPORTED_CSS_VALUES } from './cssUnsupported';
import { is3dTransformValue } from './cssTransform';
import { asciiLower, matches, parseSelectorList, selectorIndex, setDocumentMode, type Selector } from './cssSelector';
import type { StyleSource } from './htmlImport';

/** 計算値を持つ疑似要素 */
type PseudoName = 'before' | 'after' | 'first-letter' | 'first-line' | 'marker';

/**
 * HTML の既定のスタイルシート。
 *
 * 前半は、HTML Living Standard (WHATWG) の 15 章「Rendering」の CSS (15.3〜15.5) による
 * (https://html.spec.whatwg.org/multipage/rendering.html 、2026-11-04 取得)。
 * Copyright © WHATWG (Apple, Google, Mozilla, Microsoft)。ソースコードに取り込んだ部分は BSD 3-Clause License
 * (THIRD_PARTY_NOTICES.md の 5 節)。
 * 仕様の CSS のうち、組版に効かないもの (:hover などの動的な疑似クラス・::backdrop・フォームの部品の appearance・
 * ISO-8859-8 の文書の規則) は除いた。
 * 文書の互換モード (quirks mode) の規則は、Kumiori が互換モードを判定しないので入れていない。
 * 文章で書かれた規則のうち、CSS で書けるものは CSS で書いた (center 要素)。
 * th の text-align: center (親の text-align が初期値のときだけ) と、閉じた details の中身を隠すことは、カスケードの中で行う。
 * ol・ul・menu の counter-reset: list-item は、htmlImport が start・reversed とまとめて行う。
 *
 * 後半は、仕様に値の決まりの無い部分の既定 (Chrome の既定のうち組版に効くもの): フォームの部品の字の大きさ・書体・余白・背景、
 * ルビの注釈の字の大きさなど。
 *
 * 後半のうちルビの規則 (rb の white-space と、rtc・rt の字の大きさなど) は、CSS Ruby 1 の付録 A.1 の既定のスタイルシートを写したもの
 * (https://www.w3.org/TR/css-ruby-1/#default-stylesheet 、取得した版は https://www.w3.org/TR/2022/WD-css-ruby-1-20221231/ )。
 * This software includes material copied from or derived from CSS Ruby Annotation Layout Module Level 1 (https://www.w3.org/TR/2022/WD-css-ruby-1-20221231/).
 * Copyright © 2022 W3C® (MIT, ERCIM, Keio, Beihang).
 * (ライセンスの本文は THIRD_PARTY_NOTICES.md の 8 節)
 */
export const HTML_UA_CSS = `
/* 15.3.1 Hidden elements */
area, base, basefont, datalist, head, link, meta, noembed, noframes, param, rp, script, style, template, title { display: none; }
[hidden]:not([hidden=until-found i]):not(embed) { display: none; }
[hidden=until-found i]:not(embed) { content-visibility: hidden; }
embed[hidden] { display: inline; height: 0; width: 0; }
input[type=hidden i] { display: none !important; }

/* 15.3.2 The page */
html, body { display: block; }
/* body の余白 8px は、仕様では属性 (marginheight など) による指定の既定。印刷向けの既定のスタイルで打ち消せるように、ここに置く */
body { margin: 8px; }

/* 15.3.3 Flow content */
address, blockquote, center, dialog, div, figure, figcaption, footer, form, header, hr, legend, listing, main, p, plaintext, pre, search, xmp { display: block; }
blockquote, figure, listing, p, plaintext, pre, xmp { margin-block: 1em; }
blockquote, figure { margin-inline: 40px; }
address { font-style: italic; }
listing, plaintext, pre, xmp { font-family: monospace; white-space: pre; }
dialog:not([open]) { display: none; }
dialog { position: absolute; inset-inline-start: 0; inset-inline-end: 0; width: fit-content; height: fit-content; margin: auto; border: solid; padding: 1em; background-color: Canvas; color: CanvasText; }
[popover]:not(:popover-open):not(dialog[open]) { display: none; }
dialog:popover-open { display: block; }
[popover] { position: fixed; inset: 0; width: fit-content; height: fit-content; margin: auto; border: solid; padding: 0.25em; overflow: auto; color: CanvasText; background-color: Canvas; }
slot { display: contents; }
/* center 要素は、中の字と子孫の箱を中央にそろえる (15.3.3 の文章) */
center { text-align: -webkit-center; }

/* 15.3.4 Phrasing content */
cite, dfn, em, i, var { font-style: italic; }
b, strong { font-weight: bolder; }
code, kbd, samp, tt { font-family: monospace; }
big { font-size: larger; }
small { font-size: smaller; }
sub { vertical-align: sub; }
sup { vertical-align: super; }
sub, sup { line-height: normal; font-size: smaller; }
ruby { display: ruby; }
rt { display: ruby-text; }
:link { color: #0000EE; }
:link { text-decoration: underline; }
mark { background: yellow; color: black; }
abbr[title], acronym[title] { text-decoration: dotted underline; }
ins, u { text-decoration: underline; }
del, s, strike { text-decoration: line-through; }
q::before { content: open-quote; }
q::after { content: close-quote; }
nobr { white-space: nowrap; }
nobr wbr { white-space: normal; }

/* 15.3.5 Bidirectional text */
[dir]:dir(ltr), bdi:dir(ltr), input[type=tel i]:dir(ltr) { direction: ltr; }
[dir]:dir(rtl), bdi:dir(rtl) { direction: rtl; }

address, blockquote, center, div, figure, figcaption, footer, form, header, hr,
legend, listing, main, p, plaintext, pre, summary, xmp, article, aside,
:heading, hgroup, nav, search, section, table, caption, colgroup, col, thead,
tbody, tfoot, tr, td, th, dir, dd, dl, dt, menu, ol, ul, li, bdi, output,
[dir=ltr i], [dir=rtl i], [dir=auto i] {
  unicode-bidi: isolate; 
}

bdo, bdo[dir] { unicode-bidi: isolate-override; } 

input[dir=auto i]:is([type=search i], [type=tel i], [type=url i],
[type=email i]), textarea[dir=auto i], pre[dir=auto i] {
  unicode-bidi: plaintext;
}

/* 15.3.6 Sections and headings */
article, aside, :heading, hgroup, nav, section { display: block; }
:heading { font-weight: bold; }
:heading(1) { margin-block: 0.67em; font-size: 2.00em; }
:heading(2) { margin-block: 0.83em; font-size: 1.50em; }
:heading(3) { margin-block: 1.00em; font-size: 1.17em; }
:heading(4) { margin-block: 1.33em; font-size: 1.00em; }
:heading(5) { margin-block: 1.67em; font-size: 0.83em; }
:heading(6, 7, 8, 9) { font-size: 0.67em; margin-block: 2.33em; }

/* 15.3.7 Lists */
dir, dd, dl, dt, menu, ol, ul { display: block; }
li { display: list-item; text-align: match-parent; }
dir, dl, menu, ol, ul { margin-block: 1em; }
:is(dir, dl, menu, ol, ul) :is(dir, dl, menu, ol, ul) { margin-block: 0; }
dd { margin-inline-start: 40px; }
dir, menu, ol, ul { padding-inline-start: 40px; }
ol { list-style-type: decimal; }
dir, menu, ul { list-style-type: disc; }
:is(dir, menu, ol, ul) :is(dir, menu, ul) { list-style-type: circle; }
:is(dir, menu, ol, ul) :is(dir, menu, ol, ul) :is(dir, menu, ul) { list-style-type: square; }

/* 15.3.8 Tables */
table { display: table; }
caption { display: table-caption; }
colgroup, colgroup[hidden] { display: table-column-group; }
col, col[hidden] { display: table-column; }
thead, thead[hidden] { display: table-header-group; }
tbody, tbody[hidden] { display: table-row-group; }
tfoot, tfoot[hidden] { display: table-footer-group; }
tr, tr[hidden] { display: table-row; }
td, th { display: table-cell; }
colgroup[hidden], col[hidden], thead[hidden], tbody[hidden], tfoot[hidden], tr[hidden] { visibility: collapse; }
table { box-sizing: border-box; border-spacing: 2px; border-collapse: separate; text-indent: initial; }
td, th { padding: 1px; }
th { font-weight: bold; }
caption { text-align: center; }
thead, tbody, tfoot, table > tr { vertical-align: middle; }
tr, td, th { vertical-align: inherit; }
thead, tbody, tfoot, tr { border-color: inherit; }
table:is([rules=none i], [rules=groups i], [rules=rows i], [rules=cols i], [rules=all i], [frame=void i], [frame=above i], [frame=below i], [frame=hsides i], [frame=lhs i], [frame=rhs i], [frame=vsides i], [frame=box i], [frame=border i]),
table:is([rules=none i], [rules=groups i], [rules=rows i], [rules=cols i], [rules=all i]) > tr > :is(td, th),
table:is([rules=none i], [rules=groups i], [rules=rows i], [rules=cols i], [rules=all i]) > :is(thead, tbody, tfoot) > tr > :is(td, th) { border-color: black; }
:is(table, thead, tbody, tfoot, tr) > form { display: none !important; }

/* 15.3.10 Form controls */
input, button, textarea { letter-spacing: initial; word-spacing: initial; line-height: initial; }
input, select, button, textarea { text-transform: initial; text-indent: initial; text-shadow: initial; }
input, select, textarea { text-align: initial; }
input:is([type=reset i], [type=button i], [type=submit i]), button { text-align: center; }
input, button { display: inline-block; }
input:is([type=radio i], [type=checkbox i], [type=reset i], [type=button i], [type=submit i], [type=color i], [type=search i]), select, button { box-sizing: border-box; }
textarea { white-space: pre-wrap; }

/* 15.3.11 The hr element */
hr { color: gray; border-style: inset; border-width: 1px; margin-block: 0.5em; margin-inline: auto; overflow: hidden; }

/* 15.3.12 The fieldset and legend elements */
fieldset { display: block; margin-inline: 2px; border: groove 2px ThreeDFace; padding-block: 0.35em 0.625em; padding-inline: 0.75em; min-inline-size: min-content; }
legend { padding-inline: 2px; }

/* 15.4.1 Embedded content */
iframe { border: 2px inset; }
video { object-fit: contain; }

/* 15.5.5 The details and summary elements */
details, summary { display: block; }
details > summary:first-of-type { display: list-item; counter-increment: list-item 0; list-style: disclosure-closed inside; }
details[open] > summary:first-of-type { list-style-type: disclosure-open; }

/* 15.5.13 The marquee element */
marquee { display: inline-block; text-align: initial; }

/* 15.5.16 The select element */
option { display: block; }
optgroup { display: block; font-weight: bolder; }
select { letter-spacing: initial; word-spacing: initial; line-height: initial; }
select { display: inline-block; }

/* ここから、仕様に値の決まりの無い部分の既定 (Chrome の既定のうち組版に効くもの) */
ruby { text-indent: 0; } rt { text-align: start; }

/* CSS Ruby 1 の付録 A.1 (ルビを組む UA の既定のスタイルシート。https://www.w3.org/TR/css-ruby-1/#default-stylesheet)。
   台湾の注音 (bopomofo) の 30% の規則は、セレクタの並びの終わりに , があって無効な規則なので入れない。
   rbc・rtc・rb の display (ruby-base-container・ruby-text-container・ruby-base) も入れない: Kumiori の読める display の語 (KEYWORDS) に無く、
   書いても宣言ごと捨てられる (3 つとも inline のまま。ルビの組み立ては htmlImport が要素の名前 rb・rt・rtc で行う) */
rb   { white-space: nowrap; }
ruby, rb, rt, rbc, rtc { unicode-bidi: isolate; }
rtc, rt {
  font-variant-east-asian: ruby;
  text-justify: ruby;
  text-emphasis: none;
  white-space: nowrap;
  line-height: 1; }
rtc, :not(rtc) > rt {
  font-size: 50%; }
/* CSS Text Decoration 3 の付録 B (UA の既定のスタイルシート。https://www.w3.org/TR/css-text-decor-3/#default-stylesheet) のうち、
   言語ごとの圏点の位置: 中国語は字の下 (縦書きは右)、日本語・韓国語は字の上 (clreq §5.3.1 の着重号) */
:root:lang(zh), [lang|=zh] { text-emphasis-position: under right; }
[lang|=ja], [lang|=ko] { text-emphasis-position: over right; }
input, textarea, select, button { font-size: 13.3333px; }
input { padding: 1px 2px; } textarea { padding: 2px; }
input, textarea, select { background-color: white; }
input, select, button { font-family: Arial; } textarea { font-family: monospace; }
input[type="submit"], input[type="button"], input[type="reset"], button { padding: 1px 6px; white-space: pre; background-color: rgb(239, 239, 239); }
textarea { display: inline-block; }
`;

/**
 * 互換モード (quirks mode) の文書の既定のスタイル (HTML Living Standard の 15 章の「In quirks mode」の規則。2026-11-04 取得)。
 * Copyright © WHATWG (Apple, Google, Mozilla, Microsoft)。ソースコードに取り込んだ部分は BSD 3-Clause License (THIRD_PARTY_NOTICES.md の 5 節)
 */
export const QUIRKS_UA_CSS = `
/* 15.3.3 */ form { margin-block-end: 1em; }
/* 15.3.7 */ li { list-style-position: inside; }
li :is(dir, menu, ol, ul) { list-style-position: outside; }
:is(dir, menu, ol, ul) :is(dir, menu, ol, ul, li) { list-style-position: unset; }
/* 15.3.8 */ table { font-weight: initial; font-style: initial; font-variant: initial; font-size: initial; line-height: initial; white-space: initial; text-align: initial; }
/* 15.3.10 */ input:not([type=image i]), textarea { box-sizing: border-box; }
/* 15.4.2 */ img[align=left i] { margin-right: 3px; }
img[align=right i] { margin-left: 3px; }
`;

/** 先頭の # を省いた 16 進の色 (color: ff0000 など) を認める性質 (CSS Color 4 の付録 B。Quirks Mode §3.1) */
const QUIRKY_COLOR_PROPS = new Set(['background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'color']);
/** 単位の無い長さを認める性質 (CSS Values 4 の付録 C。Quirks Mode §3.2) */
const QUIRKY_LENGTH_PROPS = new Set(
  'background-position border-spacing border-top-width border-right-width border-bottom-width border-left-width border-width bottom clip font-size height left letter-spacing margin-right margin-left margin-top margin-bottom margin max-height max-width min-height min-width padding-top padding-right padding-bottom padding-left padding right text-indent top vertical-align width word-spacing'.split(' '),
);
/**
 * 互換モードで読む作成者スタイルシートの値 (Quirks Mode Standard §3.1・§3.2。https://quirks.spec.whatwg.org/ 、2026-11-04 取得)。
 * 色: 3 字か 6 字の 16 進の名前 (ident)、整数、整数と単位をつないだもの (6 字に満たなければ前に 0 を足す) を、# の付いた色とする。
 * 長さ: 関数の外の、単位の無い数を px とする (0 以外)
 */
function quirkyValue(prop: string, value: string): string {
  const v = value.trim();
  if (QUIRKY_COLOR_PROPS.has(prop)) {
    if (/^[A-Za-z][0-9A-Fa-f]{2}$|^[A-Za-z][0-9A-Fa-f]{5}$/.test(v) && /^[0-9A-Fa-f]+$/.test(v)) return '#' + v;
    const m = /^(\d+)([A-Za-z][A-Za-z0-9]*)?$/.exec(v);
    if (m) {
      const s = (m[1] + (m[2] ?? '')).padStart(6, '0');
      if (s.length === 6 && /^[0-9A-Fa-f]+$/.test(s)) return '#' + s;
    }
    return value;
  }
  if (QUIRKY_LENGTH_PROPS.has(prop) && !/\(/.test(v)) return v.replace(/(^|\s)([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?=\s|$)/g, (_m, sp: string, n: string) => (parseFloat(n) === 0 ? sp + n : `${sp}${n}px`));
  return value;
}

/** 既定の余白を持つ要素 (HTML Living Standard §15.3.9) */
const DEFAULT_MARGIN_ELEMENTS = /^(blockquote|dir|dl|h[1-6]|listing|menu|ol|p|plaintext|pre|ul|xmp)$/;
/** 中身のある節: 要素の空白だけでない字か、要素 (§15.3.9 の substantial) */
const isSubstantial = (n: Node) => n.nodeType === 1 || ((n.nodeType === 3 || n.nodeType === 4) && /[^\t\n\f\r ]/.test(n.textContent ?? ''));
/**
 * 互換モードの余白の打ち消し (HTML Living Standard §15.3.9)。body・td・th の子の、既定の余白を持つ要素について、
 * 前に中身のある兄弟が無ければ上の余白を 0 (空なら下の余白も 0)。td・th の子で、後ろに中身のある兄弟が無く空なら上の余白を 0。
 * td・th の子の p で、後ろに中身のある兄弟が無ければ下の余白を 0
 */
function marginQuirks(el: Element): Array<[string, string]> {
  const n = (el.localName ?? el.nodeName).toLowerCase();
  if (!DEFAULT_MARGIN_ELEMENTS.test(n)) return [];
  const parent = el.parentNode as Element | null;
  const pn = (parent?.nodeType === 1 ? ((parent.localName ?? parent.nodeName) as string) : '').toLowerCase();
  if (!/^(body|td|th)$/.test(pn)) return [];
  const sibs = Array.from(parent!.childNodes);
  const at = sibs.indexOf(el as unknown as ChildNode);
  const noBefore = !sibs.slice(0, at).some(isSubstantial);
  const noAfter = !sibs.slice(at + 1).some(isSubstantial);
  const blank = !Array.from(el.childNodes).some(isSubstantial);
  const cell = pn === 'td' || pn === 'th';
  const out: Array<[string, string]> = [];
  if (noBefore || (cell && noAfter && blank)) out.push(['margin-block-start', '0']);
  if ((noBefore && blank) || (cell && n === 'p' && noAfter)) out.push(['margin-block-end', '0']);
  return out;
}

type Origin = 0 | 0.5 | 1 | 2; // 既定 (HTML の既定のスタイル)・既定 (その上に重ねる既定)・作成者・style 属性

interface RuleEntry {
  sel: Selector;
  decls: Array<[string, string, boolean]>;
  origin: Origin;
  order: number;
  /** カスケードの層の順位 (層の無い規則は undefined) */
  layer?: number;
}

/** 計算値 (要素 1 つ分) */
interface Computed {
  v: Map<string, string>;
  /** line-height の数値 (number のまま継承する。値は px にして返す) */
  lhNumber?: number;
  /** 字の大きさ (px) */
  fs: number;
  /** 行の高さ (px。根元の要素の値を rlh の基準にする) */
  lh?: number;
  /** 字の大きさが既定の大きさ (medium など) から来たか (monospace は 13px にする: Chrome と同じ) */
  fsKeyword: boolean;
  /** text-emphasis-color が currentcolor か (受け継いだ先の字の色にする。Text Decoration 3 §3.2)。偽のときだけ色が決まっている */
  emphasisCurrent?: boolean;
  /** 内容の幅の見積もり (px。百分率の基準) */
  cw: number;
  /** 絶対配置の子の包含ブロックの幅 (位置の基準の祖先の padding box の幅。無ければページの領域の幅) */
  pcw: number;
  /** 子の高さの百分率の基準 (px。決まらなければ undefined で、子の百分率の高さは auto) */
  ch?: number;
  /** カスタム プロパティ (--名前) */
  vars: Map<string, string>;
  /** 明示した性質 (auto かどうか) */
  specified: Map<string, string>;
  /** SVG の表示の性質 (と color・opacity) の、勝った宣言 (文書の中の <svg> に渡すかを決める) */
  svgFrom?: Map<string, DeclaredValue>;
  /** style() が返す読み手 (1 度作って使い回す) */
  view?: { getPropertyValue(name: string): string };
}

// ───────────────────────── 性質の表 ─────────────────────────

type Kind = 'len' | 'len-auto' | 'len-normal' | 'len-none' | 'color' | 'raw' | 'border-width' | 'int-auto';

/** 性質: [継承するか, 初期値, 値の種類] */
const PROPS: Record<string, [boolean, string, Kind]> = {
  color: [true, 'rgb(0, 0, 0)', 'color'],
  'background-color': [false, 'rgba(0, 0, 0, 0)', 'color'],
  'background-image': [false, 'none', 'raw'],
  'background-repeat': [false, 'repeat', 'raw'],
  'background-position-x': [false, '0%', 'raw'],
  'background-position-y': [false, '0%', 'raw'],
  'background-size': [false, 'auto', 'raw'],
  // 層ごとの、位置の基準の領域・描く範囲・固定 (Backgrounds 3 §2.8・§2.7・§2.5)。背景の性質は、どれも層ごとの値のコンマ区切りの並び (§2.1)
  'background-origin': [false, 'padding-box', 'raw'],
  'background-clip': [false, 'border-box', 'raw'],
  'background-attachment': [false, 'scroll', 'raw'],
  display: [false, 'inline', 'raw'],
  position: [false, 'static', 'raw'],
  float: [false, 'none', 'raw'],
  clear: [false, 'none', 'raw'],
  'z-index': [false, 'auto', 'int-auto'],
  top: [false, 'auto', 'len-auto'],
  right: [false, 'auto', 'len-auto'],
  bottom: [false, 'auto', 'len-auto'],
  left: [false, 'auto', 'len-auto'],
  width: [false, 'auto', 'len-auto'],
  'aspect-ratio': [false, 'auto', 'raw'],
  height: [false, 'auto', 'len-auto'],
  'min-width': [false, 'auto', 'len-auto'],
  'min-height': [false, 'auto', 'len-auto'],
  'max-width': [false, 'none', 'len-none'],
  'max-height': [false, 'none', 'len-none'],
  'box-sizing': [false, 'content-box', 'raw'],
  'margin-top': [false, '0px', 'len-auto'],
  'margin-right': [false, '0px', 'len-auto'],
  'margin-bottom': [false, '0px', 'len-auto'],
  'margin-left': [false, '0px', 'len-auto'],
  'padding-top': [false, '0px', 'len'],
  'padding-right': [false, '0px', 'len'],
  'padding-bottom': [false, '0px', 'len'],
  'padding-left': [false, '0px', 'len'],
  'border-top-width': [false, 'medium', 'border-width'],
  'border-right-width': [false, 'medium', 'border-width'],
  'border-bottom-width': [false, 'medium', 'border-width'],
  'border-left-width': [false, 'medium', 'border-width'],
  'border-top-style': [false, 'none', 'raw'],
  'border-right-style': [false, 'none', 'raw'],
  'border-bottom-style': [false, 'none', 'raw'],
  'border-left-style': [false, 'none', 'raw'],
  'border-top-color': [false, 'currentcolor', 'color'],
  'border-right-color': [false, 'currentcolor', 'color'],
  'border-bottom-color': [false, 'currentcolor', 'color'],
  'border-left-color': [false, 'currentcolor', 'color'],
  'border-collapse': [true, 'separate', 'raw'],
  'border-spacing': [true, '0px 0px', 'raw'],
  'table-layout': [false, 'auto', 'raw'],
  'caption-side': [true, 'top', 'raw'],
  'vertical-align': [false, 'baseline', 'raw'],
  // Chrome の既定の書体 (標準の書体の設定)
  'font-family': [true, '"Times New Roman"', 'raw'],
  'font-size': [true, '16px', 'raw'],
  'font-weight': [true, '400', 'raw'],
  'font-style': [true, 'normal', 'raw'],
  'font-stretch': [true, '100%', 'raw'],
  'font-variant': [true, 'normal', 'raw'],
  'font-variant-caps': [true, 'normal', 'raw'],
  'font-variant-numeric': [true, 'normal', 'raw'],
  'font-variant-east-asian': [true, 'normal', 'raw'],
  'font-variant-ligatures': [true, 'normal', 'raw'],
  'font-variant-position': [true, 'normal', 'raw'],
  'font-kerning': [true, 'auto', 'raw'],
  'font-feature-settings': [true, 'normal', 'raw'],
  'line-height': [true, 'normal', 'raw'],
  'letter-spacing': [true, 'normal', 'len-normal'],
  'word-spacing': [true, '0px', 'len-normal'],
  'text-align': [true, 'start', 'raw'],
  'text-align-last': [true, 'auto', 'raw'],
  'text-indent': [true, '0px', 'len'],
  'text-transform': [true, 'none', 'raw'],
  'text-decoration-line': [false, 'none', 'raw'],
  'text-decoration-style': [false, 'solid', 'raw'],
  'text-decoration-color': [false, 'currentcolor', 'color'],
  // 線の太さ (Text Decoration 4 §2.4: auto | from-font | <length> | <percentage>。百分率は 1em に対する割合で、計算値は % のまま)
  'text-decoration-thickness': [false, 'auto', 'len-auto'],
  // 下線をずらす量 (Text Decoration 4 §2.8: auto | <length> | <percentage>。受け継ぐ。百分率は % のまま受け継ぎ、線を指定した要素の 1em で決める)
  'text-underline-offset': [true, 'auto', 'len-auto'],
  'white-space': [true, 'normal', 'raw'],
  'word-break': [true, 'normal', 'raw'],
  'overflow-wrap': [true, 'normal', 'raw'],
  'line-break': [true, 'auto', 'raw'],
  hyphens: [true, 'manual', 'raw'],
  direction: [true, 'ltr', 'raw'],
  'unicode-bidi': [false, 'normal', 'raw'],
  'writing-mode': [true, 'horizontal-tb', 'raw'],
  'text-orientation': [true, 'mixed', 'raw'],
  'text-combine-upright': [true, 'none', 'raw'],
  'text-emphasis-style': [true, 'none', 'raw'],
  'text-emphasis-color': [true, 'currentcolor', 'color'],
  'text-emphasis-position': [true, 'over right', 'raw'],
  'text-spacing-trim': [true, 'normal', 'raw'],
  // 初期値は normal (CSS Text 4 §8.4 https://www.w3.org/TR/css-text-4/ 2026-11-05 取得。ideograph-alpha ideograph-numeric と同じ)
  'text-autospace': [true, 'normal', 'raw'],
  'ruby-position': [true, 'over', 'raw'],
  'list-style-type': [true, 'disc', 'raw'],
  'list-style-position': [true, 'outside', 'raw'],
  'list-style-image': [true, 'none', 'raw'],
  visibility: [true, 'visible', 'raw'],
  'content-visibility': [false, 'visible', 'raw'],
  orphans: [true, '2', 'raw'],
  widows: [true, '2', 'raw'],
  quotes: [true, 'auto', 'raw'],
  overflow: [false, 'visible', 'raw'],
  'overflow-x': [false, 'visible', 'raw'],
  'overflow-y': [false, 'visible', 'raw'],
  'object-fit': [false, 'fill', 'raw'],
  'object-position': [false, '50% 50%', 'raw'],
  opacity: [false, '1', 'raw'],
  content: [false, 'normal', 'raw'],
  'counter-reset': [false, 'none', 'raw'],
  'counter-increment': [false, 'none', 'raw'],
  'counter-set': [false, 'none', 'raw'],
  'break-before': [false, 'auto', 'raw'],
  'break-after': [false, 'auto', 'raw'],
  'break-inside': [false, 'auto', 'raw'],
  'page-break-before': [false, 'auto', 'raw'],
  'page-break-after': [false, 'auto', 'raw'],
  'page-break-inside': [false, 'auto', 'raw'],
  page: [false, 'auto', 'raw'],
  'column-count': [false, 'auto', 'int-auto'],
  'column-width': [false, 'auto', 'len-auto'],
  'column-gap': [false, 'normal', 'len-normal'],
  'row-gap': [false, 'normal', 'len-normal'],
  'column-rule-width': [false, 'medium', 'border-width'],
  'column-rule-style': [false, 'none', 'raw'],
  'column-rule-color': [false, 'currentcolor', 'color'],
  'column-span': [false, 'none', 'raw'],
  'column-fill': [false, 'balance', 'raw'],
  'flex-direction': [false, 'row', 'raw'],
  'flex-wrap': [false, 'nowrap', 'raw'],
  'flex-grow': [false, '0', 'raw'],
  'flex-shrink': [false, '1', 'raw'],
  'flex-basis': [false, 'auto', 'len-auto'],
  order: [false, '0', 'raw'],
  'grid-template-columns': [false, 'none', 'raw'],
  'grid-column-start': [false, 'auto', 'raw'],
  'grid-column-end': [false, 'auto', 'raw'],
  'justify-content': [false, 'normal', 'raw'],
  'align-items': [false, 'normal', 'raw'],
  'align-self': [false, 'auto', 'raw'],
  'align-content': [false, 'normal', 'raw'],
  'border-top-left-radius': [false, '0px', 'raw'],
  'border-top-right-radius': [false, '0px', 'raw'],
  'border-bottom-right-radius': [false, '0px', 'raw'],
  'border-bottom-left-radius': [false, '0px', 'raw'],
  'box-shadow': [false, 'none', 'raw'],
  filter: [false, 'none', 'raw'],
  transform: [false, 'none', 'raw'],
  // 変換の原点・基準の箱 (CSS Transforms 1 §5・§6) と、個別の変換 (CSS Transforms 2 §5)
  'transform-origin': [false, '50% 50%', 'raw'],
  'transform-box': [false, 'view-box', 'raw'],
  translate: [false, 'none', 'raw'],
  rotate: [false, 'none', 'raw'],
  scale: [false, 'none', 'raw'],
  'string-set': [false, 'none', 'raw'],
};
/** 計算値を決めるプロパティの名前 (要素ごとに Object.keys を作らない) */
const PROP_NAMES = Object.keys(PROPS);
/** カスタム プロパティの「必ず無効な値」の印 */
const INVALID = Symbol('invalid');

/** ブロック化 (float・絶対配置・根元の要素の display) */
// CSS 2.1 §9.7 の表 (float・絶対配置の箱の display): 表の内部の箱はすべて block
/**
 * 2 値の display (Display 3 §2.2) の短い書き方 (block flow → block、inline flow-root → inline-block など。計算値の表記はこの形。
 * 短い書き方の無い block math・block ruby は 2 値のまま)
 */
const DISPLAY_SHORT: Record<string, string> = {
  'block flow': 'block', 'inline flow': 'inline', 'run-in flow': 'run-in', 'block flow-root': 'flow-root', 'inline flow-root': 'inline-block',
  'block flex': 'flex', 'inline flex': 'inline-flex', 'block grid': 'grid', 'inline grid': 'inline-grid', 'block table': 'table', 'inline table': 'inline-table',
  'inline ruby': 'ruby', 'inline math': 'math',
};
function shortDisplay(v: string): string {
  const t = v.trim().toLowerCase().split(/\s+/);
  if (t.length < 2) return v;
  // list-item を含むもの (Display 3 §2.4): block flow list-item → list-item、inline flow list-item → inline list-item
  if (t.includes('list-item')) {
    const outer = t.filter((x) => x !== 'list-item' && x !== 'flow').join(' ') || 'block';
    return outer === 'block' ? 'list-item' : `${outer} list-item`;
  }
  // 外側 (block・inline・run-in) と内側の語の順は問わない
  const outer = t.find((x) => x === 'block' || x === 'inline' || x === 'run-in');
  const inner = t.find((x) => x !== outer);
  if (t.length !== 2 || !outer || !inner) return v;
  return DISPLAY_SHORT[`${outer} ${inner}`] ?? `${outer} ${inner}`;
}
const BLOCKIFY: Record<string, string> = { inline: 'block', 'inline-block': 'block', 'inline-table': 'table', 'inline-flex': 'flex', 'inline-grid': 'grid', 'table-row': 'block', 'table-cell': 'block', 'table-row-group': 'block', 'table-header-group': 'block', 'table-footer-group': 'block', 'table-column': 'block', 'table-column-group': 'block', 'table-caption': 'block', contents: 'contents', 'run-in': 'block' };

// ───────────────────────── 値 ─────────────────────────

/** CSS の色の読み取りは cssText (cssGradient などと共通)。ここから使う側のために名前を残す */
export { parseColor } from './cssText';

const fmtPx = (n: number) => `${+n.toFixed(4)}px`;

/**
 * 色を読む。color-mix() の中の currentcolor は、current (計算値の色。rgb() の形) にする。
 * 計算値は混ぜた結果の色にする (Color 5 §10.1 では、currentcolor を含む color-mix() の計算値は関数のままで、継承先の color で決め直す。
 * Kumiori は宣言した要素の色で決める)
 */
const parseColorWith = (raw: string, current: string | undefined) => {
  const cur = current !== undefined && /color-mix\(/i.test(raw) && /currentcolor/i.test(raw) ? parseColor(current) : undefined;
  return parseColor(raw, Array.isArray(cur) ? (cur as RGBA) : undefined);
};

/**
 * 宣言の無い、継承しないプロパティの初期値の計算値 (要素によらないもの)。プロパティごとに 1 度だけ求めて覚える。
 * 要素によるもの (currentcolor は要素の色、border-*-width は同じ要素の線種で決まる) と、初期値が読めないものは undefined (本来の経路で計算する)
 */
const INITIAL_COMPUTED = new Map<string, string | null>();
function initialComputed(p: string, kind: Kind, initial: string, colorVal: string): string | undefined {
  if (kind === 'color') {
    const c = parseColor(initial);
    return c === 'current' || c === undefined ? colorVal : fmtColor(c);
  }
  if (kind === 'border-width') return undefined;
  let hit = INITIAL_COMPUTED.get(p);
  if (hit === undefined) {
    const lv = initial.toLowerCase();
    if (kind === 'len' || kind === 'len-auto' || kind === 'len-none' || kind === 'len-normal') {
      if ((kind === 'len-auto' && lv === 'auto') || (kind === 'len-none' && lv === 'none') || (kind === 'len-normal' && lv === 'normal')) hit = lv;
      else {
        const m = /^(-?\d*\.?\d+)(px)?$/.exec(lv);
        hit = m ? fmtPx(parseFloat(m[1])) : null;
      }
    } else if (kind === 'int-auto') hit = /^-?\d+$/.test(initial) ? initial : 'auto';
    else hit = computeKeyword(p, initial, undefined, { fs: 16, rootFs: 16, vw: 0, vh: 0 });
    INITIAL_COMPUTED.set(p, hit);
  }
  return hit ?? undefined;
}
/** 開発用: 近道の値と本来の計算の値を比べて、食い違いを console.error に出す (環境変数 KUMIORI_CSS_CHECK) */
const CHECK_FAST = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.KUMIORI_CSS_CHECK;
const checkSeen = new Set<string>();

/** 長さの基準 */
interface LenCtx {
  fs: number;
  rootFs: number;
  vw: number;
  vh: number;
  /** 要素の行の高さ・根元の行の高さ (px。lh・rlh の単位)。無ければ字の大きさの 1.2 倍 */
  lh?: number;
  rootLh?: number;
  /** % の基準 (無ければ % は読めない) */
  pct?: number;
}

/** 長さ (calc() を含む) を px に。読めなければ undefined */
export function lengthPx(v: string, ctx: LenCtx): number | undefined {
  const s = v.trim().toLowerCase();
  if (s === '0') return 0;
  // 数の書き方: 先頭の + と、指数の + も読む (Values 4 §5.3)
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/.exec(s);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[2];
    if (UNIT_PX[u] !== undefined) return n * UNIT_PX[u];
    if (u === 'em') return n * ctx.fs;
    if (u === 'rem') return n * ctx.rootFs;
    // ex・ch は字形から測れないので 0.5em (Values 4 §6.1.1 の代わりの値)。ic は全角の字の幅 (1em)、cap は大文字の高さ (0.7em で見積もる)
    if (u === 'ex' || u === 'ch') return n * ctx.fs * 0.5;
    if (u === 'ic') return n * ctx.fs;
    if (u === 'cap') return n * ctx.fs * 0.7;
    if (u === 'rex' || u === 'rch') return n * ctx.rootFs * 0.5;
    if (u === 'ric') return n * ctx.rootFs;
    if (u === 'lh') return n * (ctx.lh ?? ctx.fs * 1.2);
    if (u === 'rlh') return n * (ctx.rootLh ?? ctx.rootFs * 1.2);
    // 印刷のページでは、小さい・大きい・動的なビューポートの単位も、ページの領域の大きさ。vi・vb は横書きの inline・block 方向
    if (/^[sld]?v(w|i)$/.test(u)) return (n * ctx.vw) / 100;
    if (/^[sld]?v(h|b)$/.test(u)) return (n * ctx.vh) / 100;
    if (/^[sld]?vmin$/.test(u)) return (n * Math.min(ctx.vw, ctx.vh)) / 100;
    if (/^[sld]?vmax$/.test(u)) return (n * Math.max(ctx.vw, ctx.vh)) / 100;
    if (u === '%') return ctx.pct === undefined ? undefined : (n * ctx.pct) / 100;
    if (u === '' && n === 0) return 0;
    return undefined;
  }
  const f = /^(calc|min|max|clamp)\((.*)\)$/.exec(s);
  if (f) return calcPx(f[1], f[2], ctx);
  return undefined;
}

/** calc() / min() / max() / clamp() を px に */
function calcPx(fn: string, body: string, ctx: LenCtx): number | undefined {
  if (fn !== 'calc') {
    // 読むのは min()・max()・clamp() だけ (ほかの関数を clamp() として読まない)。引数は、min()・max() が 1 つ以上、
    // clamp() はちょうど 3 つ (Values 4 §10.2。空の引数は読めない)
    if (fn !== 'min' && fn !== 'max' && fn !== 'clamp') return undefined;
    const raw = splitTop(body, ',', { keepEmpty: true });
    if (fn === 'clamp' ? raw.length !== 3 : raw.length < 1) return undefined;
    const args = raw.map((a) => (a ? calcPx('calc', a, ctx) : undefined));
    if (args.some((a) => a === undefined)) return undefined;
    const n = args as number[];
    return fn === 'min' ? Math.min(...n) : fn === 'max' ? Math.max(...n) : Math.max(n[0], Math.min(n[1], n[2]));
  }
  // 項に分ける: 数・長さ・( ) と + - * /
  // 数は指数表記 (1e2px) も 1 つの項 (Values 4 §5.3。e の後に数字が続くときだけ。1em の e は単位)
  const toks = body.match(/(?:-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]*)|[()+\-*/]|[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/gi) ?? [];
  // 項にならない字 (calc(10px foo) の foo など) が残れば、式として読めない (読める所だけを拾って値にしない)
  if (toks.join('').replace(/\s+/g, '') !== body.replace(/\s+/g, '')) return undefined;
  let k = 0;
  // 単位の無い数は { n, unitless: true }
  type Val = { n: number; unitless: boolean } | undefined;
  const primary = (): Val => {
    const t = toks[k++];
    if (t === undefined) return undefined;
    if (t === '(') {
      const v = expr();
      k++; // )
      return v;
    }
    if (/^[a-z-]+\(/i.test(t)) {
      const inner = /^([a-z-]+)\((.*)\)$/i.exec(t)!;
      const r = inner[1].toLowerCase() === 'var' ? undefined : calcPx(inner[1].toLowerCase(), inner[2], ctx);
      return r === undefined ? undefined : { n: r, unitless: false };
    }
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/.test(t)) return { n: parseFloat(t), unitless: true };
    const px = lengthPx(t, ctx);
    return px === undefined ? undefined : { n: px, unitless: false };
  };
  const term = (): Val => {
    let a = primary();
    while (toks[k] === '*' || toks[k] === '/') {
      const op = toks[k++];
      const b = primary();
      if (!a || !b) return undefined;
      // 型の検査 (Values 4 §10.9): 掛け算は少なくとも一方が数、割り算の右は 0 でない数
      if (op === '*' && !a.unitless && !b.unitless) return undefined;
      if (op === '/' && (!b.unitless || b.n === 0)) return undefined;
      a = op === '*' ? { n: a.n * b.n, unitless: a.unitless && b.unitless } : { n: a.n / b.n, unitless: a.unitless };
    }
    return a;
  };
  const expr = (): Val => {
    let a = term();
    while (toks[k] === '+' || toks[k] === '-') {
      const op = toks[k++];
      const b = term();
      if (!a || !b) return undefined;
      // 足し算・引き算は同じ型どうし (数と長さは足せない)
      if (a.unitless !== b.unitless) return undefined;
      a = { n: op === '+' ? a.n + b.n : a.n - b.n, unitless: a.unitless && b.unitless };
    }
    return a;
  };
  const r = expr();
  // 余った字があれば読めない。長さの文脈では、結果が単位の無い数なら読めない (0 は除く)
  if (k < toks.length) return undefined;
  if (r && r.unitless && r.n !== 0) return undefined;
  return r?.n;
}

/** 値を語に分ける (括弧・文字列の外の空白で) */
const tokens = (v: string) => splitTop(v, ' ');

/** 数・整数の書き方 (Values 4 §5.2・§5.3)。読めるかの検査・計算値を決める所・一括指定を分ける所で使う (食い違うと、読めると判定した値が初期値になる) */
const CSS_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const CSS_INTEGER = /^[+-]?\d+$/;

// ───────────────────────── SVG の表示の性質 ─────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * 文書の中にじかに書いた <svg> に渡す、SVG の表示の性質: [継承するか, 初期値 (計算値の形)]。
 * 値の定義・初期値・継承は SVG 2 の 13 章 (https://www.w3.org/TR/SVG2/painting.html 、2026-11-10 取得): fill・fill-rule・fill-opacity は §13.4、
 * stroke・stroke-opacity・stroke-width・stroke-linecap・stroke-linejoin・stroke-miterlimit・stroke-dasharray・stroke-dashoffset は §13.5。
 * HTML の要素の箱には効かない (継承して、中の <svg> に届くだけ)。color と opacity は PROPS にある
 */
const SVG_STYLE_PROPS: Record<string, [boolean, string]> = {
  fill: [true, 'rgb(0, 0, 0)'],
  stroke: [true, 'none'],
  'stroke-width': [true, '1px'],
  'fill-opacity': [true, '1'],
  'stroke-opacity': [true, '1'],
  'fill-rule': [true, 'nonzero'],
  'stroke-linecap': [true, 'butt'],
  'stroke-linejoin': [true, 'miter'],
  'stroke-miterlimit': [true, '4'],
  'stroke-dasharray': [true, 'none'],
  'stroke-dashoffset': [true, '0px'],
};
const SVG_STYLE_PROP_NAMES = Object.keys(SVG_STYLE_PROPS);
const SVG_PRESENTATION_ATTRS = [...SVG_STYLE_PROP_NAMES, 'color', 'opacity'];
const SVG_STYLE_KEYWORDS: Record<string, RegExp> = { 'fill-rule': /^(nonzero|evenodd)$/, 'stroke-linecap': /^(butt|round|square)$/, 'stroke-linejoin': /^(miter|round|bevel)$/ };
/** fill の属性が別の意味を持つ要素 (アニメーションの要素。SVG 2 §6.6 の表) */
const SVG_ANIMATION = /^(animate|animatemotion|animatetransform|animatecolor|set)$/;

/**
 * SVG の表示の性質の値 → 計算値。読めない値は undefined (宣言を捨てる)。
 *  - <paint> (SVG 2 §13.2): none | <color> | <url> [none | <color>]? | context-fill | context-stroke。色は計算値にし、currentcolor は語のまま
 *    (CSS Color 4 §15.5: currentcolor の計算値はそれ自身)
 *  - 不透明度 (<'opacity'> = 数か百分率): 数にして [0, 1] に丸める (SVG 2 §13.4.3)
 *  - stroke-width・stroke-dashoffset (<length-percentage> | <number>): 数は利用者単位 (px)。計算値は絶対の長さか百分率。stroke-width の負の値は不正 (§13.5.3)
 *  - stroke-dasharray: none か、カンマか空白で区切った長さ・百分率・数の並び。負の値があれば不正 (§13.5.6)
 *  - stroke-miterlimit: 数。負の値は不正 (§13.5.5)
 */
function svgStyleValue(prop: string, raw: string, ctx: LenCtx, current?: string): string | undefined {
  const s = raw.trim();
  const l = s.toLowerCase();
  const color = (t: string) => {
    const c = parseColorWith(t, current);
    return c === undefined ? undefined : c === 'current' ? 'currentcolor' : fmtColor(c);
  };
  // 数 (利用者単位 = px)・長さ → px、百分率はそのまま
  const len = (t: string, nonNegative: boolean) => {
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%$/.test(t)) return nonNegative && parseFloat(t) < 0 ? undefined : `${parseFloat(t)}%`;
    const px = CSS_NUMBER.test(t) ? parseFloat(t) : lengthPx(t, { ...ctx, pct: undefined });
    return px === undefined || !Number.isFinite(px) || (nonNegative && px < 0) ? undefined : fmtPx(px);
  };
  switch (prop) {
    case 'fill':
    case 'stroke': {
      if (l === 'none' || l === 'context-fill' || l === 'context-stroke') return l;
      const u = /^(url\((?:"[^"]*"|'[^']*'|[^()"']*)\))\s*(.*)$/i.exec(s);
      if (!u) return color(s);
      if (!u[2]) return u[1];
      const fb = u[2].toLowerCase() === 'none' ? 'none' : color(u[2]);
      return fb === undefined ? undefined : `${u[1]} ${fb}`;
    }
    case 'fill-opacity':
    case 'stroke-opacity': {
      const n = CSS_NUMBER.test(l) ? parseFloat(l) : /^[+-]?(\d+\.?\d*|\.\d+)%$/.test(l) ? parseFloat(l) / 100 : NaN;
      return Number.isFinite(n) ? String(+Math.min(1, Math.max(0, n)).toFixed(4)) : undefined;
    }
    case 'stroke-width':
      return len(l, true);
    case 'stroke-dashoffset':
      return len(l, false);
    case 'stroke-miterlimit':
      return CSS_NUMBER.test(l) && parseFloat(l) >= 0 ? String(parseFloat(l)) : undefined;
    case 'stroke-dasharray': {
      if (l === 'none') return l;
      const parts = splitTop(l, ',', { keepEmpty: true }).map((g) => tokens(g));
      if (!parts.length || parts.some((g) => !g.length)) return undefined;
      const out = parts.flat().map((t) => len(t, true));
      return out.every((x) => x !== undefined) ? out.join(' ') : undefined;
    }
    default:
      return SVG_STYLE_KEYWORDS[prop]?.test(l) ? l : undefined;
  }
}
/** 計算値 → 書き出す SVG の値 (px の長さは利用者単位の数。currentcolor は SVG の書き方) */
const svgStyleText = (prop: string, v: string) =>
  prop === 'stroke-width' || prop === 'stroke-dashoffset' || prop === 'stroke-dasharray' ? v.replace(/px\b/g, '') : v.replace(/\bcurrentcolor\b/g, 'currentColor');

/**
 * text-indent の値を、長さ (百分率) の部分と hanging・each-line の語に分ける (CSS Text 3 §8.1:
 * [ <length-percentage> ] && hanging? && each-line?)。構文に合わなければ undefined
 */
export function splitTextIndent(v: string): { len: string; kws: string[] } | undefined {
  const ts = tokens(v.trim());
  const kws = ts.filter((t) => /^(hanging|each-line)$/i.test(t)).map((t) => t.toLowerCase());
  const rest = ts.filter((t) => !/^(hanging|each-line)$/i.test(t));
  if (rest.length !== 1 || new Set(kws).size !== kws.length) return undefined;
  return { len: rest[0], kws };
}

// ───────────────────────── 一括指定 ─────────────────────────

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const BORDER_STYLES = /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/;
/** アンテナハウスの拡張の線種 (CSS の値ではない)。cascadeStyles の ahBorderStyles のときだけ読む */
const AH_BORDER_STYLES = /^(dot-dash|dot-dot-dash|wave)$/;
/**
 * アンテナハウスの拡張の読み方 (cascadeStyles の設定から作り、expand・valid に引数で渡す。モジュール全体の状態にはしない:
 * 計算値は style() が呼ばれたときに遅延して決まるので、別の設定の cascadeStyles が後から作られても、前の StyleSource の計算に効かない)
 *  - ahBorderStyles: 線種 dot-dash・dot-dot-dash・wave を border-style の値として読む
 *  - ahCounterFlags: counter() の名前の後の physical・reverse を読む
 */
export interface AhFlags {
  ahBorderStyles: boolean;
  ahCounterFlags: boolean;
}
/** 拡張を読まない (ブラウザと同じ) */
const NO_AH: AhFlags = { ahBorderStyles: false, ahCounterFlags: false };
/** 拡張をすべて読む (@supports の答え。互換の指定が分からない所で、拡張の値を読めるものとして扱う) */
const ALL_AH: AhFlags = { ahBorderStyles: true, ahCounterFlags: true };
const isBorderStyle = (t: string, ah: AhFlags) => BORDER_STYLES.test(t) || (ah.ahBorderStyles && AH_BORDER_STYLES.test(t));
const isLenLike = (t: string) => /^(-?(?:\d+\.?\d*|\.\d+)[a-z%]*|calc\(.*\)|min\(.*\)|max\(.*\)|clamp\(.*\)|var\(.*\))$/i.test(t);
const isColorLike = (t: string) => parseColor(t) !== undefined || /^var\(/i.test(t);

function fourSides(v: string): [string, string, string, string] {
  const t = tokens(v);
  const [a, b = a, c = a, d = b] = t;
  return [a, b, c, d];
}

/** font の一括指定が初期値に戻すだけの性質 (Fonts 4 §2.7 の Reset Implicitly のうち、ここで扱うもの) */
const FONT_RESET_ONLY: Array<[string, string]> = [
  ['font-variant-numeric', 'normal'],
  ['font-variant-east-asian', 'normal'],
  ['font-variant-ligatures', 'normal'],
  ['font-variant-position', 'normal'],
  ['font-kerning', 'auto'],
  ['font-feature-settings', 'normal'],
];

/** Kumiori の知っているプロパティか: PROPS にある (論理のプロパティは物理に直して)、または一括指定を分けた性質がすべて PROPS にある */
export function isKnownCssProperty(prop: string, value = ''): boolean {
  const known = (p: string) => !!PROPS[p] || !!SVG_STYLE_PROPS[p] || !!PROPS[logicalToPhysical(p, 'horizontal-tb', 'ltr') ?? ''];
  if (known(prop)) return true;
  const parts = expand(prop, value);
  return parts.length > 0 && parts.every(([p]) => p !== prop && known(p));
}

/**
 * @supports の宣言 (と @import の supports()) に、対応していると答えるか。CSS Conditional 3 §6.1 (Definition of support):
 * 宣言を、規則の中で (構文の誤りとして捨てずに) 受け付けるときに対応しているとし、性質と値の両方を「使える水準で」実装していなければ、
 * 受け付けても対応していると答えてもいけない。値の一部だけを実装しているものも、対応しているとは答えない。
 *  - 名前を知らない性質は偽 (印刷に関わらない性質 (animation-*・cursor など) も、読まないので偽)
 *  - 名前は読むが組版に使わない性質 (cssUnsupported の UNSUPPORTED_CSS_PROPERTIES。text-shadow・outline など) は偽
 *  - 対応している性質の、読まない値 (UNSUPPORTED_CSS_VALUES。position: sticky など。3D の変換 (transform: rotateX() など) も) は偽
 *  - 一括指定は、分けた性質のどれかが上の 2 つに当たれば偽 (未対応の性質を初期値に戻すだけの一括指定は真)
 *  - 値が読めない宣言は偽 (display: foo・color: notacolor など)。カスケードが宣言を構文の誤りとして捨てるかの検査
 *    (cascadeDecls の、一括指定を分けて valid で調べる検査) と同じ判定を通す: 一括指定は、分けられない値・分けた性質のどれかが読めない値なら偽。
 *    値の無い宣言 (display: ) も偽
 *  - var() を含む値は、性質が上の 3 つに当たらなければ真 (Variables 1 §3: var() を含む値は、構文を調べる時点では有効とみなし、
 *    置き換えた後の計算値の時点で調べる。@supports は置き換える前に答えるので、読めるかは決まらない)
 *  - カスタム プロパティ (--x: 何でも) は、ここへ来る前に真 (htmlPaged の matchSupports。Variables 1 §2.1: 値の構文はほぼ何でも受け付ける)
 * アンテナハウスの拡張の値 (線種 dot-dash など・counter() の physical・reverse) は、互換の指定のときだけカスケードが読むが、
 * @supports を読む時点では互換の指定が分からないので、真のままにする (これまでと同じ)。
 * display: grid のように、性質と値は読み、働きの一部が未対応のものも真のまま
 */
export function supportsCssDeclaration(prop: string, value: string): boolean {
  const p = prop.toLowerCase();
  const v = value.replace(/\s*!\s*important\s*$/i, '').trim();
  const unsupported = (lp: string, lv: string, longhandOfShorthand: boolean) => {
    const t = lv.trim().toLowerCase();
    if (UNSUPPORTED_CSS_PROPERTIES.has(lp)) return !longhandOfShorthand || !(t === (PROPS[lp]?.[1] ?? '').toLowerCase() || /^(inherit|initial|unset|revert|revert-layer)$/.test(t));
    // 3D の変換 (transform の 3D の関数など) は読まない
    if (is3dTransformValue(lp, t)) return true;
    // ページに固定する背景 (background-attachment: fixed) は、箱に付く背景として描く (読まない値)
    if (lp === 'background-attachment' && /\bfixed\b/.test(t)) return true;
    return !!UNSUPPORTED_CSS_VALUES[lp]?.includes(t);
  };
  if (unsupported(p, v, false)) return false;
  // var() を含む値は、性質を知っているかを、var() の無い仮の値で見る (一括指定は、値が無いと分けられない)
  const hasVar = /var\(/i.test(v);
  if (!isKnownCssProperty(p, v) && !(hasVar && isKnownCssProperty(p, 'initial'))) return false;
  if (hasVar) return true;
  const parts = expand(p, v);
  if (parts.some(([lp, lv]) => lp !== p && unsupported(lp, lv, true))) return false;
  // 値が読めるか (カスケードが宣言を捨てるかの検査と同じ。cascadeDecls)
  if (!v || !parts.length) return false;
  return parts.every(([lp, lv]) => valid(lp, lv, ANY_CTX, NO_AH) || valid(lp, lv, ANY_CTX, ALL_AH));
}
setSupportsDecl(supportsCssDeclaration);

/** 一括指定を分けた結果 ([性質, 値] の並び) */
type Longhands = Array<[string, string]>;
/** 一括指定を分ける関数。v は前後の空白を除いた値、global は大域のキーワード (inherit など) か */
type Expander = (prop: string, v: string, global: boolean, ah: AhFlags) => Longhands;

const GLOBAL_KEYWORD = /^(inherit|initial|unset|revert|revert-layer)$/i;
/** 同じ値を、それぞれの性質に */
const each = (props: readonly string[], v: string): Longhands => props.map((p) => [p, v] as [string, string]);
/** 1〜2 値 (start end) の一括指定を、start・end の性質に */
const startEnd = (start: string, end: string, v: string, global: boolean): Longhands => {
  const [a, b = a] = global ? [v, v] : tokens(v);
  return [[start, a], [end, b]];
};

/** 四辺の一括指定 (margin・padding・inset・border-width など): 性質の名前は side(辺) で作る */
const fourSideShorthand =
  (side: (prop: string, s: (typeof SIDES)[number]) => string): Expander =>
  (prop, v, global) => {
    if (global) return each(SIDES.map((s) => side(prop, s)), v);
    const f = fourSides(v);
    return SIDES.map((s, k) => [side(prop, s), f[k]]);
  };

/** border・border-<辺>・column-rule: 幅・線種・色を語の種類で振り分ける */
const borderShorthand: Expander = (prop, v, global, ah) => {
  const sides = prop === 'border' ? [...SIDES] : prop === 'column-rule' ? [''] : [prop.slice(7)];
  const pre = (s: string) => (prop === 'column-rule' ? 'column-rule-' : `border-${s}-`);
  if (global) return sides.flatMap((s) => ['width', 'style', 'color'].map((k) => [pre(s) + k, v] as [string, string]));
  let w = 'medium';
  let st = 'none';
  let col = 'currentcolor';
  for (const t of tokens(v)) {
    if (isBorderStyle(t.toLowerCase(), ah)) st = t.toLowerCase();
    else if (/^(thin|medium|thick)$/i.test(t) || isLenLike(t)) w = t;
    else col = t;
  }
  return sides.flatMap((s) => [[pre(s) + 'width', w], [pre(s) + 'style', st], [pre(s) + 'color', col]] as Longhands);
};

/**
 * background の一括指定 (Backgrounds 3 §2.10: <bg-layer># , <final-bg-layer>)。層ごとの画像・繰り返し・位置・大きさ・基準の領域・描く範囲・
 * 固定を、それぞれの性質のコンマ区切りの並びにする (§2.1)。色は最後の層にだけ書ける。
 * 箱の語 (<visual-box>) は、1 つなら background-origin と background-clip の両方、2 つなら 1 つ目が origin、2 つ目が clip (§2.10)。
 * どの種類にも当たらない語 (-webkit-linear-gradient() など、読めない値) があれば、宣言ごと読めない (空を返す。前の宣言を消さない。
 * CSS 2.1 §4.2: 読めない値の宣言は無視する)。Backgrounds 4 の text (描く範囲) は読み飛ばす
 */
const backgroundShorthand: Expander = (_prop, v, global) => {
  const props = ['background-color', 'background-image', 'background-repeat', 'background-position-x', 'background-position-y', 'background-size', 'background-origin', 'background-clip', 'background-attachment'];
  if (global) return each(props, v);
  const layers = splitTop(v, ',', { keepEmpty: true });
  let color = 'rgba(0, 0, 0, 0)';
  const images: string[] = [];
  const repeats: string[] = [];
  const xs: string[] = [];
  const ys: string[] = [];
  const sizes: string[] = [];
  const origins: string[] = [];
  const clips: string[] = [];
  const attachments: string[] = [];
  for (let li = 0; li < layers.length; li++) {
    const isLast = li === layers.length - 1;
    // 位置と大きさを分ける / は、括弧 (url() など) の外のものだけ
    let depth = 0;
    const spaced = [...layers[li]].map((ch) => (ch === '(' ? (depth++, ch) : ch === ')' ? (depth--, ch) : ch === '/' && depth === 0 ? ' / ' : ch)).join('');
    const ts = tokens(spaced);
    if (!ts.length) return [];
    let lImage: string | undefined;
    let lRepeat: string | undefined;
    const lPos: string[] = [];
    let lSize: string | undefined;
    let lAttachment: string | undefined;
    const lBoxes: string[] = [];
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k];
      const tl = t.toLowerCase();
      if (/^(url|(repeating-)?(linear|radial|conic)-gradient|image-set)\(/i.test(t) || tl === 'none') lImage = t;
      else if (/^(repeat|no-repeat|repeat-x|repeat-y|space|round)$/.test(tl)) lRepeat = lRepeat === undefined || lRepeat === 'repeat' || !/^(repeat|no-repeat|space|round)$/.test(tl) ? tl : `${lRepeat} ${tl}`;
      else if (t === '/') {
        const sz: string[] = [];
        while (k + 1 < ts.length && (isLenLike(ts[k + 1]) || /^(auto|cover|contain)$/i.test(ts[k + 1]))) sz.push(ts[++k]);
        if (!sz.length) return [];
        lSize = sz.join(' ');
      } else if (/^(left|right|top|bottom|center)$/.test(tl) || isLenLike(t)) lPos.push(t);
      else if (/^(scroll|fixed|local)$/.test(tl)) lAttachment = tl;
      else if (/^(border-box|padding-box|content-box)$/.test(tl)) lBoxes.push(tl);
      else if (tl === 'text') continue;
      else if (isColorLike(t)) {
        // 色は最後の層だけ。var() は何になるか分からないので通す (色としては使わない)
        if (/^var\(/i.test(t)) continue;
        if (!isLast) return [];
        color = t;
      } else return [];
    }
    if (lBoxes.length > 2) return [];
    const [px, py] = positionXY(lPos);
    images.push(lImage ?? 'none');
    repeats.push(lRepeat ?? 'repeat');
    xs.push(px);
    ys.push(py);
    sizes.push(lSize ?? 'auto');
    origins.push(lBoxes[0] ?? 'padding-box');
    clips.push(lBoxes[1] ?? lBoxes[0] ?? 'border-box');
    attachments.push(lAttachment ?? 'scroll');
  }
  const list = (a: string[]) => a.join(', ');
  return [
    ['background-color', color],
    ['background-image', list(images)],
    ['background-repeat', list(repeats)],
    ['background-position-x', list(xs)],
    ['background-position-y', list(ys)],
    ['background-size', list(sizes)],
    ['background-origin', list(origins)],
    ['background-clip', list(clips)],
    ['background-attachment', list(attachments)],
  ];
};

const fontVariantShorthand: Expander = (_prop, v, global) => {
  // 一括指定 (Fonts 4 §6.11): 値の語を、それぞれの個別の指定に振り分ける。none は合字だけ none、ほかは normal
  const parts = ['font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-position'];
  if (global) return [['font-variant', v], ...each(parts, v)];
  const t = v.trim().toLowerCase();
  const out: Record<string, string[]> = Object.fromEntries(parts.map((p) => [p, []]));
  if (t !== 'normal' && t !== 'none')
    for (const w of tokens(t)) {
      if (/^(no-)?(common|discretionary|historical)-ligatures$|^(no-)?contextual$/.test(w)) out['font-variant-ligatures'].push(w);
      else if (/^(small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps)$/.test(w)) out['font-variant-caps'].push(w);
      else if (/^(lining-nums|oldstyle-nums|proportional-nums|tabular-nums|diagonal-fractions|stacked-fractions|ordinal|slashed-zero)$/.test(w)) out['font-variant-numeric'].push(w);
      else if (/^(jis78|jis83|jis90|jis04|simplified|traditional|full-width|proportional-width|ruby)$/.test(w)) out['font-variant-east-asian'].push(w);
      else if (/^(sub|super)$/.test(w)) out['font-variant-position'].push(w);
      else return []; // 知らない値: 宣言を捨てる
    }
  return [
    ['font-variant', v.trim()],
    ...parts.map((p): [string, string] => [p, t === 'none' && p === 'font-variant-ligatures' ? 'none' : out[p].join(' ') || 'normal']),
  ];
};

const fontShorthand: Expander = (_prop, v, global) => {
  // 指定できるものと、初期値に戻すだけのもの (Fonts 4 §2.7)
  const props = ['font-style', 'font-variant', 'font-variant-caps', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family', ...FONT_RESET_ONLY.map(([p]) => p)];
  if (global) return each(props, v);
  const ts = tokens(v.replace(/\s*\/\s*/g, ' / '));
  const out: Record<string, string> = { 'font-style': 'normal', 'font-variant': 'normal', 'font-variant-caps': 'normal', 'font-weight': 'normal', 'font-stretch': 'normal', 'line-height': 'normal', ...Object.fromEntries(FONT_RESET_ONLY) };
  let k = 0;
  for (; k < ts.length; k++) {
    const t = ts[k].toLowerCase();
    if (t === 'normal') continue;
    if (/^(italic|oblique)$/.test(t)) out['font-style'] = t;
    else if (t === 'small-caps') out['font-variant'] = out['font-variant-caps'] = t;
    // 太さ (Fonts 4 §2.2 の <font-weight-absolute> = normal | bold | <number [1,1000]>、bolder・lighter)。数は font-weight の
    // 宣言と同じ読み方 (550.5・+700・50 も太さ。範囲の外の数は太さではない)
    else if (/^(bold|bolder|lighter)$/.test(t) || (CSS_NUMBER.test(t) && parseFloat(t) >= 1 && parseFloat(t) <= 1000)) out['font-weight'] = t;
    else if (/condensed|expanded/.test(t)) out['font-stretch'] = t;
    else break;
  }
  if (k >= ts.length) return []; // システムの書体 (caption など) は読まない
  out['font-size'] = ts[k++];
  if (ts[k] === '/') {
    out['line-height'] = ts[k + 1] ?? 'normal';
    k += 2;
  }
  out['font-family'] = ts.slice(k).join(' ');
  if (!out['font-family']) return [];
  return Object.entries(out);
};

const listStyleShorthand: Expander = (_prop, v, global) => {
  if (global) return each(['list-style-type', 'list-style-position', 'list-style-image'], v);
  let type = 'disc';
  let position = 'outside';
  let image = 'none';
  let nones = 0;
  for (const t of tokens(v)) {
    const tl = t.toLowerCase();
    if (tl === 'inside' || tl === 'outside') position = tl;
    else if (/^url\(/.test(tl)) image = t;
    else if (tl === 'none') nones++;
    else type = t;
  }
  if (nones && type === 'disc') type = 'none';
  return [['list-style-type', type], ['list-style-position', position], ['list-style-image', image]];
};

const textDecorationShorthand: Expander = (_prop, v, global) => {
  // 一括指定 (Text Decoration 3 §2.4 の <line> || <style> || <color> に、Text Decoration 4 §2.6 で太さが加わった)。
  // 書いていないものは初期値に戻す。text-underline-position・text-underline-offset は含まない (戻さない)
  if (global) return each(['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'], v);
  const lines: string[] = [];
  let style = 'solid';
  let color = 'currentcolor';
  let thickness = 'auto';
  for (const t of tokens(v)) {
    const tl = t.toLowerCase();
    if (/^(underline|overline|line-through|blink)$/.test(tl)) lines.push(tl);
    else if (/^(solid|double|dotted|dashed|wavy)$/.test(tl)) style = tl;
    else if (tl === 'auto' || tl === 'from-font' || lengthPx(tl, { ...ANY_CTX, pct: 100 }) !== undefined) thickness = tl;
    else if (tl !== 'none' && isColorLike(t)) color = t;
  }
  return [['text-decoration-line', lines.join(' ') || 'none'], ['text-decoration-style', style], ['text-decoration-color', color], ['text-decoration-thickness', thickness]];
};

/** 圏点の一括指定 (Text Decoration 3 §3.3: <'text-emphasis-style'> || <'text-emphasis-color'>)。書いていないものは初期値に戻す。位置は含まない */
const textEmphasisShorthand: Expander = (_prop, v, global) => {
  if (global) return each(['text-emphasis-style', 'text-emphasis-color'], v);
  const style: string[] = [];
  let color = 'currentcolor';
  for (const t of tokens(v)) {
    // 圏点にする文字列 ('＊' など) と形の語は style、それ以外で色として読めるものは color
    if (!/^["']/.test(t) && !/^(none|filled|open|dot|circle|double-circle|triangle|sesame)$/i.test(t) && isColorLike(t)) color = t;
    else style.push(t);
  }
  return [['text-emphasis-style', style.join(' ') || 'none'], ['text-emphasis-color', color]];
};

const flexShorthand: Expander = (_prop, v, global) => {
  if (global) return each(['flex-grow', 'flex-shrink', 'flex-basis'], v);
  const lv = v.toLowerCase();
  if (lv === 'none') return [['flex-grow', '0'], ['flex-shrink', '0'], ['flex-basis', 'auto']];
  if (lv === 'auto') return [['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', 'auto']];
  const nums: string[] = [];
  let basis = '0%';
  for (const t of tokens(v)) {
    if (/^-?[\d.]+$/.test(t)) nums.push(t);
    else basis = t;
  }
  return [['flex-grow', nums[0] ?? '1'], ['flex-shrink', nums[1] ?? '1'], ['flex-basis', basis]];
};

/**
 * 一括指定ごとの、個別の性質への分け方の表 (ここに無い性質はそのまま 1 つの宣言)。
 * 論理的な性質 (margin-block など) は論理的な名前のまま持ち、要素の書字方向が決まってから物理的な性質に写す (Logical 1 §4。logicalToPhysical)
 */
const SHORTHANDS = new Map<string, Expander>();
const shorthand = (props: string[], f: Expander) => props.forEach((p) => SHORTHANDS.set(p, f));

// all: direction・unicode-bidi とカスタム プロパティのほかのすべて。値は大域のキーワードだけ (Cascade 5 §3.2)
shorthand(['all'], (_p, v, global) => (global ? each(Object.keys(PROPS).filter((p) => p !== 'direction' && p !== 'unicode-bidi'), v) : []));
shorthand(['margin', 'padding'], fourSideShorthand((prop, s) => `${prop}-${s}`));
shorthand(['inset'], fourSideShorthand((_prop, s) => s));
shorthand(['border-width', 'border-style', 'border-color'], fourSideShorthand((prop, s) => `border-${s}-${prop.split('-')[1]}`));
// アンテナハウスの拡張の -ah-padding-start などは、XSL の padding-start などに当たる (論理的な余白・内側の余白)
shorthand(
  ['-ah-padding-start', '-ah-padding-end', '-ah-padding-before', '-ah-padding-after', '-ah-margin-start', '-ah-margin-end', '-ah-margin-before', '-ah-margin-after'],
  (prop, v) => {
    const [, base, side] = /^-ah-(padding|margin)-(\w+)$/.exec(prop)!;
    return [[`${base}-${{ start: 'inline-start', end: 'inline-end', before: 'block-start', after: 'block-end' }[side]}`, v]];
  },
);
shorthand(['margin-block', 'padding-block', 'margin-inline', 'padding-inline'], (prop, v, global) => {
  const [base, axis] = prop.split('-');
  return startEnd(`${base}-${axis}-start`, `${base}-${axis}-end`, v, global);
});
shorthand(['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'column-rule'], borderShorthand);
// 論理的な罫線 (Logical 1 §5): 論理的な名前の個別の性質 (border-block-start-width など) のまま持ち、
// 要素の書字方向が決まってから物理的な辺に写す (logicalToPhysical)
shorthand(['border-block-start', 'border-block-end', 'border-inline-start', 'border-inline-end'], (prop, v, _g, ah) =>
  expand('border-top', v, ah).map(([k, x]) => [k.replace('border-top', prop), x] as [string, string]),
);
shorthand(['border-block', 'border-inline'], (prop, v, _g, ah) => [...expand(`${prop}-start`, v, ah), ...expand(`${prop}-end`, v, ah)]);
shorthand(['border-block-width', 'border-block-style', 'border-block-color', 'border-inline-width', 'border-inline-style', 'border-inline-color'], (prop, v, global) => {
  const [, axis, k] = /^border-(block|inline)-(\w+)$/.exec(prop)!;
  return startEnd(`border-${axis}-start-${k}`, `border-${axis}-end-${k}`, v, global);
});
shorthand(['inset-block', 'inset-inline'], (prop, v, global) => startEnd(`${prop}-start`, `${prop}-end`, v, global));
// アンテナハウスの拡張の -ah-border-radius (角の丸み)。border-radius と同じに読む
shorthand(['-ah-border-radius'], (_p, v, _g, ah) => expand('border-radius', v, ah));
// アンテナハウスの拡張の -ah-text-align・-ah-text-align-last (text-align・text-align-last と同じに読む)・角の丸み
shorthand(['-ah-text-align', '-ah-text-align-last', '-ah-border-top-left-radius', '-ah-border-top-right-radius', '-ah-border-bottom-right-radius', '-ah-border-bottom-left-radius'], (prop, v) => [[prop.slice(4), v]]);
shorthand(['border-radius'], (_p, v, global) => {
  if (global) return each(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], v);
  // 水平の半径 / 垂直の半径 (/ が無ければ同じ)
  const [hv, vv] = v.split('/').map((x) => x.trim());
  const fh = fourSides(hv);
  const fv = vv ? fourSides(vv) : fh;
  return (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((c, k) => [`border-${c}-radius`, fh[k] === fv[k] ? fh[k] : `${fh[k]} ${fv[k]}`]);
});
shorthand(['background'], backgroundShorthand);
shorthand(['background-position'], (_p, v, global) => {
  if (global) return each(['background-position-x', 'background-position-y'], v);
  // 層ごとの位置 (コンマ区切り。Backgrounds 3 §2.1・§2.6)
  const pairs = splitTop(v, ',').map((layer) => positionXY(tokens(layer)));
  if (!pairs.length) pairs.push(positionXY([]));
  return [['background-position-x', pairs.map((q) => q[0]).join(', ')], ['background-position-y', pairs.map((q) => q[1]).join(', ')]];
});
shorthand(['font-variant'], fontVariantShorthand);
shorthand(['font'], fontShorthand);
shorthand(['list-style'], listStyleShorthand);
shorthand(['columns'], (_p, v, global) => {
  if (global) return each(['column-width', 'column-count'], v);
  let width = 'auto';
  let count = 'auto';
  for (const t of tokens(v)) {
    // 段の数は整数 (Multi-column 1 §3.2 の column-count: auto | <integer [1,∞]>。column-count の宣言と同じ読み方: +2 も整数)
    if (CSS_INTEGER.test(t)) count = t;
    else if (t !== 'auto') width = t;
  }
  return [['column-width', width], ['column-count', count]];
});
shorthand(['text-decoration'], textDecorationShorthand);
shorthand(['text-emphasis'], textEmphasisShorthand);
shorthand(['overflow'], (_p, v) => {
  const [a, b = a] = tokens(v);
  return [['overflow', v], ['overflow-x', a], ['overflow-y', b]];
});
shorthand(['gap'], (_p, v) => {
  const [a, b = a] = tokens(v);
  return [['row-gap', a], ['column-gap', b]];
});
shorthand(['flex'], flexShorthand);
shorthand(['grid-column'], (_p, v) => {
  const [a, b = 'auto'] = v.split('/').map((x) => x.trim());
  return [['grid-column-start', a], ['grid-column-end', b]];
});
shorthand(['flex-flow'], (_p, v) => {
  let dir = 'row';
  let wrap = 'nowrap';
  for (const t of tokens(v)) {
    if (/wrap/.test(t)) wrap = t;
    else dir = t;
  }
  return [['flex-direction', dir], ['flex-wrap', wrap]];
});
// 改ページの古い書き方 page-break-* と break-* は、互いの値も持つ
shorthand(['page-break-before', 'page-break-after', 'page-break-inside'], (prop, v) => {
  const side = prop.slice(11);
  const lv = v.toLowerCase();
  return [[prop, v], [`break-${side}`, lv === 'always' ? 'page' : lv]];
});
shorthand(['break-before', 'break-after'], (prop, v) => [[prop, v], [`page-break-${prop.slice(6)}`, v === 'page' || v === 'always' ? 'always' : /^(auto|avoid|left|right)$/.test(v) ? v : 'auto']]);
shorthand(['break-inside'], (prop, v) => [[prop, v], ['page-break-inside', /avoid/.test(v) ? 'avoid' : 'auto']]);
shorthand(['white-space-collapse'], (_p, v) => [['white-space', v === 'preserve' ? 'pre-wrap' : v === 'collapse' ? 'normal' : v]]);
shorthand(['word-wrap'], (_p, v) => [['overflow-wrap', v]]);

/** 一括指定を個別の性質に分ける (分けないものはそのまま)。ah はアンテナハウスの拡張の読み方 (線種) */
export function expand(prop: string, value: string, ah: AhFlags = NO_AH): Longhands {
  const v = value.trim();
  const f = SHORTHANDS.get(prop);
  return f ? f(prop, v, GLOBAL_KEYWORD.test(v), ah) : [[prop, v]];
}

/** 論理的な性質の名前 → 物理的な性質の名前 (Logical 1 §4: 要素自身の writing-mode と direction で写す) */
export function logicalToPhysical(prop: string, wm: string, dir: string): string | undefined {
  const vertical = /^vertical|^tb|^sideways/.test(wm);
  const rl = wm === 'vertical-rl' || wm === 'tb-rl' || wm === 'tb' || wm === 'sideways-rl';
  // sideways-lr は行が下から上へ進むので、inline-start は下 (Writing Modes 4 §3.2)
  const inlineUp = wm === 'sideways-lr';
  if (prop === 'inline-size') return vertical ? 'height' : 'width';
  if (prop === 'block-size') return vertical ? 'width' : 'height';
  const mm = /^(min|max)-(inline|block)-size$/.exec(prop);
  if (mm) return `${mm[1]}-${(mm[2] === 'inline') !== vertical ? 'width' : 'height'}`;
  const m = /^(margin|padding|border|inset)-(block|inline)-(start|end)(-width|-style|-color)?$/.exec(prop);
  if (!m || (m[1] === 'border') !== !!m[4]) return undefined;
  const [, base, axis, edge, sub = ''] = m;
  let side: string;
  if (axis === 'block') side = vertical ? ((edge === 'start') === rl ? 'right' : 'left') : edge === 'start' ? 'top' : 'bottom';
  else side = vertical ? ((edge === 'start') !== (dir === 'rtl') !== inlineUp ? 'top' : 'bottom') : (edge === 'start') !== (dir === 'rtl') ? 'left' : 'right';
  // inset-* は top・right・bottom・left (Logical 1 §4.3)
  return base === 'inset' ? side : `${base}-${side}${sub}`;
}

/**
 * 背景の位置の語 (left center 20% など) → [x, y]。
 * 3・4 値 (bottom 10px right 20px など) は、語の後の長さ・百分率をその端からの距離とする (Backgrounds 3 §3.6)。
 * 右・下の端からの長さは "right 10px" のように端の語を付けて返す (百分率は 100% から引く)
 */
function positionXY(ts: string[]): [string, string] {
  const kw: Record<string, string> = { left: '0%', right: '100%', top: '0%', bottom: '100%', center: '50%' };
  let x = '0%';
  let y = '0%';
  if (!ts.length) return [x, y];
  if (ts.length >= 3) {
    // 語と、その後の距離 (省略は 0) の組。center の後には距離を置けない
    const groups: Array<[string, string | undefined]> = [];
    for (const t of ts) {
      const l = t.toLowerCase();
      const last = groups[groups.length - 1];
      if (kw[l] !== undefined) groups.push([l, undefined]);
      else if (last && last[1] === undefined && last[0] !== 'center') last[1] = t;
      else return [x, y];
    }
    if (groups.length !== 2) return [x, y];
    const horiz = (k: string) => k === 'left' || k === 'right';
    const vert = (k: string) => k === 'top' || k === 'bottom';
    let [[ka, oa], [kb, ob]] = groups;
    if (vert(ka) || horiz(kb)) [[ka, oa], [kb, ob]] = [[kb, ob], [ka, oa]];
    if (vert(ka) || horiz(kb)) return [x, y];
    const edge = (k: string, off: string | undefined) => {
      if (off === undefined) return kw[k];
      if (k === 'left' || k === 'top') return off;
      const pct = /^(-?[\d.]+)%$/.exec(off);
      return pct ? `${100 - parseFloat(pct[1])}%` : `${k} ${off}`;
    };
    return [edge(ka, oa), edge(kb, ob)];
  }
  if (ts.length === 1) {
    const t = ts[0].toLowerCase();
    if (t === 'top' || t === 'bottom') return ['50%', kw[t]];
    return [kw[t] ?? ts[0], '50%'];
  }
  const [a, b] = ts.map((t) => t.toLowerCase());
  if (a === 'top' || a === 'bottom' || b === 'left' || b === 'right') [x, y] = [kw[b] ?? ts[1], kw[a] ?? ts[0]];
  else [x, y] = [kw[a] ?? ts[0], kw[b] ?? ts[1]];
  return [x, y];
}

// ───────────────────────── カスケード ─────────────────────────

/** アンテナハウス互換の罫線の太さの thin・medium・thick (1pt・3pt・5pt を px で) */
export const AH_BORDER_KEYWORDS = { thin: 4 / 3, medium: 4, thick: 20 / 3 };

export interface CascadeOptions {
  /** ページの領域の大きさ (px)。vw・vh と、根元の要素の幅の基準 */
  viewport?: { width: number; height: number };
  /** 既定のスタイルシート (省略時は HTML_UA_CSS) */
  uaCss?: string;
  /**
   * uaCss の上に重ねる既定のスタイル (印刷向け・互換の既定)。出どころは既定のままで、uaCss の宣言には詳細度によらず勝つ
   * (HTML の既定のスタイルの :heading() などは詳細度が高いので、同じ層に入れると h2 { … } のような上書きが効かない)。
   * 文字列か、parseCss で読んだもの (prepareHtml の uaSheet。同じ CSS を読み直さない)
   */
  uaExtraCss?: string | ParsedCss;
  /**
   * 文書の互換性のモード (HTML Living Standard §13.2.6.4.1。documentMode で決める)。省略時は no-quirks。
   * quirks では、15 章の互換モードの規則 (QUIRKS_UA_CSS・余白の打ち消し・nowrap と width) を当て、ID とクラスのセレクタは大文字小文字を区別しない
   */
  quirksMode?: 'no-quirks' | 'limited-quirks' | 'quirks';
  /**
   * 罫線の太さを画素に丸めない (ブラウザ (Chrome) は 1px 未満を 1px に切り上げ、それ以上は端数を切り捨てる)。
   * アンテナハウス互換で使う (border: 0.3pt の枠は 0.3pt の太さで描く)
   */
  noBorderSnap?: boolean;
  /**
   * 等幅の書体 (font-family が monospace だけ) で、字の大きさが既定の大きさから来ていれば 13/16 にする (Chrome の既定の書体の設定の大きさ。
   * CSS の仕様の決まりではない)。ブラウザの計算値と比べるときに使う。既定は使わない
   */
  monospaceSize13?: boolean;
  /**
   * font-weight の bolder・lighter を、CSS 2.1 §15.6 のとおり書体にある太さで決める (互換。既定は Fonts 4 §2.2.1 の表)。
   * family は計算値の font-family。書体の太さが分からなければ undefined を返す (Fonts 4 の表で決める)
   */
  relativeWeight?: (family: string, parentWeight: number, kind: 'bolder' | 'lighter') => number | undefined;
  /**
   * 罫線の太さの thin・medium・thick (px)。省略時はブラウザと同じ 1px・3px・5px。アンテナハウス互換では 1pt・3pt・5pt
   */
  borderKeywords?: { thin: number; medium: number; thick: number };
  /** アンテナハウスの拡張の線種 (dot-dash・dot-dot-dash・wave) を border-style の値として読む (アンテナハウス互換。既定ではブラウザと同じく捨てる) */
  ahBorderStyles?: boolean;
  /** content の counter() の名前に続く physical・reverse (アンテナハウスの拡張: counter(<ident> [physical || reverse]?, …)) を読む */
  ahCounterFlags?: boolean;
}

/** 宣言の強さ (rank) が既定のスタイル (UA) の出どころか */
const isUa = (rank: number) => rank < 1 || rank === 5;

/** 要素に当たる宣言 (declsFor)。rank は出どころと !important による強さ、lay は層、spec は詳細度、order は書いた順 */
interface DeclaredValue {
  prop: string;
  value: string;
  rank: number;
  lay: number;
  spec: number;
  order: number;
}

/**
 * 識別子に使える字 (CSS Syntax 3 §4.2 の ident code point: 英数字・_・-・ASCII でない字。cssSelector の IDENT と同じ範囲で、
 * ASCII でない字は U+0080 以上をすべて通す)
 */
const NAME_CHAR = String.raw`[-\w\u0080-\uffff]`;
const NAME_START = String.raw`[a-zA-Z_\u0080-\uffff]`;

/** var(--名前[, fallback]) (fallback は括弧の入れ子 2 段まで) */
/** var( に続く名前 (値の中の参照を、fallback の中のものも含めて拾う) */
const VAR_NAME_RE = new RegExp(String.raw`var\(\s*(--${NAME_CHAR}+)`, 'g');
const VAR_RE = new RegExp(String.raw`var\(\s*(--${NAME_CHAR}+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)`, 'g');

/** 組み込みの既定のスタイルシート (HTML_UA_CSS・QUIRKS_UA_CSS) を読んだもの (文書ごとに読み直さない。parseCss の結果は書き換えない) */
const BUILTIN_UA_SHEETS = new Map<string, ParsedCss>();
const sheetOf = (css: string | ParsedCss): ParsedCss => {
  if (typeof css !== 'string') return css;
  if (css !== HTML_UA_CSS && css !== QUIRKS_UA_CSS) return parseCss(css);
  let hit = BUILTIN_UA_SHEETS.get(css);
  if (!hit) BUILTIN_UA_SHEETS.set(css, (hit = parseCss(css)));
  return hit;
};

/**
 * 文書と作成者スタイルシート (文書の CSS をまとめたもの。文字列か、parseCss で読んだもの (prepareHtml の authorSheet)) から、
 * 計算値を返す StyleSource を作る。既定のスタイルシートは opts.uaCss・uaExtraCss
 */
export function cascadeStyles(doc: Document, authorCss: string | ParsedCss, opts: CascadeOptions = {}): StyleSource {
  const vw = opts.viewport?.width ?? 794;
  const vh = opts.viewport?.height ?? 1123;
  // アンテナハウスの拡張の読み方 (expand・valid に渡す。この StyleSource の計算にだけ効く)
  const ah: AhFlags = { ahBorderStyles: !!opts.ahBorderStyles, ahCounterFlags: !!opts.ahCounterFlags };
  const rules: RuleEntry[] = [];
  const selCache = new Map<string, Selector[]>();
  let order = 0;
  const addSheet = (css: string | ParsedCss, origin: Origin) => {
    for (const r of sheetOf(css).rules) {
      let sels = selCache.get(r.selector);
      if (!sels) selCache.set(r.selector, (sels = parseSelectorList(r.selector)));
      // 書いた順の宣言 (list)。同じ性質が並ぶときは、それぞれの !important で比べる
      const decls = r.list.map(([k, v, i]) => [k, v, !!i] as [string, string, boolean]);
      for (const sel of sels) rules.push({ sel, decls, origin, order: order++, ...(r.layer !== undefined ? { layer: r.layer } : {}) });
    }
  };
  const quirks = opts.quirksMode === 'quirks';
  setDocumentMode(doc, opts.quirksMode ?? 'no-quirks');
  addSheet(opts.uaCss ?? HTML_UA_CSS, 0);
  if (quirks) addSheet(QUIRKS_UA_CSS, 0);
  if (opts.uaExtraCss) addSheet(opts.uaExtraCss, 0.5);
  addSheet(authorCss, 1);

  // 右端の単純セレクタで分ける (要素ごとに調べる規則を減らす)
  const byId = new Map<string, RuleEntry[]>();
  const byClass = new Map<string, RuleEntry[]>();
  const byTag = new Map<string, RuleEntry[]>();
  const rest: RuleEntry[] = [];
  const add = (m: Map<string, RuleEntry[]>, k: string, r: RuleEntry) => (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  for (const r of rules) {
    const c = r.sel.compounds[0];
    // 互換モードでは、ID とクラスの大文字小文字を区別しないので、小文字にした名前で分ける
    if (c.ids.length) add(byId, quirks ? asciiLower(c.ids[0]) : c.ids[0], r);
    else if (c.classes.length) add(byClass, quirks ? asciiLower(c.classes[0]) : c.classes[0], r);
    else if (c.tag) add(byTag, c.tag, r);
    else rest.push(r);
  }
  const candidates = (el: Element): RuleEntry[] => {
    const out: RuleEntry[] = [...rest];
    const id = el.getAttribute('id');
    if (id) out.push(...(byId.get(quirks ? asciiLower(id) : id) ?? []));
    for (const c of (el.getAttribute('class') ?? '').split(/\s+/)) if (c) out.push(...(byClass.get(quirks ? asciiLower(c) : c) ?? []));
    out.push(...(byTag.get((el.localName ?? el.nodeName).toLowerCase()) ?? []));
    return out;
  };

  const cache = new Map<Element, Computed>();
  const pseudoCache = new Map<Element, Partial<Record<PseudoName, Computed>>>();
  /** 擬似要素に当たる規則があるか (要素と擬似要素ごとに 1 度だけ照合する) */
  const pseudoHas = new Map<Element, Partial<Record<string, boolean>>>();
  const hasRules = (el: Element, which: string) => {
    let m = pseudoHas.get(el);
    if (!m) pseudoHas.set(el, (m = {}));
    let h = m[which];
    if (h === undefined) m[which] = h = declsFor(el, which).length > 0;
    return h;
  };
  const rootEl = doc.documentElement;

  /** 要素 (と疑似要素) に当たる宣言を、優先度の高い順に */
  const declsFor = (el: Element, pseudo?: string, parent?: Computed) => {
    const out: DeclaredValue[] = [];
    const push = (prop: string, value0: string, important: boolean, origin: Origin, specificity: number, ord: number, layer?: number) => {
      // 互換モードの作成者スタイルシート: 先頭の # を省いた 16 進の色・単位の無い長さ (Quirks Mode §3.1・§3.2)
      const value = quirks && origin >= 1 ? quirkyValue(prop, value0) : value0;
      // !important は出どころの順を逆にする (既定 > style 属性 > 作成者)
      const rank = important ? (origin < 1 ? 5 : origin === 2 ? 4 : 3) : origin;
      // 一括指定は、var() を置き換えてから分ける (計算値を決めるとき)
      // 層 (Cascade 5 §6.4): 通常の宣言は、層の無い規則が最も強く、層の間では後の層が強い。!important は逆
      const l = layer ?? Infinity;
      out.push({ prop, value, rank, lay: important ? -l : l, spec: specificity, order: ord });
    };
    const seen = new Set<RuleEntry>();
    for (const r of candidates(el)) {
      if (seen.has(r)) continue;
      seen.add(r);
      const pe = r.sel.pseudoElement;
      if ((pe ?? undefined) !== pseudo) continue;
      if (!matches(el, r.sel)) continue;
      r.decls.forEach(([p, v, imp], k) => push(p, v, imp, r.origin, r.sel.specificity, r.order + k / 1e4, r.layer));
    }
    if (!pseudo) {
      // th は、親の text-align が初期値 (start) のときだけ、既定のスタイルで中央にそろえる (HTML Living Standard §15.3.8)
      if ((el.localName ?? el.nodeName).toLowerCase() === 'th' && (parent?.v.get('text-align') ?? 'start') === 'start') push('text-align', 'center', false, 0, 1, -1);
      // 互換モードの余白の打ち消し (HTML Living Standard §15.3.9)。既定のスタイルの規則として、h1 などの余白の規則より強く
      if (quirks) for (const [p, v] of marginQuirks(el)) push(p, v, false, 0, 1e9, -1);
      // HTML の属性による指定 (作成者スタイルシート より弱い)。Cascade 5 §6.5: 利用者と作成者の間の独立した出どころ
      // (author presentational hint origin) なので、作成者の規則には、層 (@layer) の中のものにも負ける。
      // revert では作成者の出どころの一部なので、出どころは作成者のまま、どの層よりも前 (弱い) 層に置く
      presentational(el, quirks).forEach(([p, v], k) => push(p, v, false, 1, -1, -1 + k / 1e6, -Infinity));
      // SVG の表示の属性 (fill="…" など) も同じ扱い: 作成者の出どころの、詳細度 0 の規則で、ほかの作成者のスタイルシートより前 (SVG 2 §6.6)
      if (el.namespaceURI === SVG_NS) svgPresentation(el).forEach(([p, v], k) => push(p, v, false, 1, -1, -1 + k / 1e6, -Infinity));
      const st = el.getAttribute('style');
      if (st) splitDecls(st).forEach(([p, v, imp], k) => push(p, v, !!imp, 2, 0, order + 1 + k / 1e4));
    }
    out.sort((a, b) => b.rank - a.rank || (a.lay === b.lay ? 0 : b.lay > a.lay ? 1 : -1) || b.spec - a.spec || b.order - a.order);
    return out;
  };

  /**
   * ① カスタム プロパティの解決 (Variables 1 §2・§3)。計算値は、この要素で var() を置き換えた値。
   * initial・循環するもの・読めない参照を含むものは「必ず無効な値」(変数の表から除き、使う側で fallback を使う)。
   * 表は、自分で定義していなければ親の表をそのまま使う (要素ごとに写さない)
   */
  const resolveCustomProps = (decls: DeclaredValue[], parent: Computed | undefined): Map<string, string> => {
    const ownVars = decls.some((d) => d.prop.startsWith('--'));
    const vars = ownVars || !parent ? new Map(parent?.vars ?? []) : parent.vars;
    const own = new Map<string, string>();
    for (const d of decls) if (d.prop.startsWith('--') && !own.has(d.prop)) own.set(d.prop, d.value);
    const state = new Map<string, 'busy' | 'done'>();
    // 循環 (Variables 1 §2.3): この要素のカスタム プロパティを節、値の中の var() の参照 (fallback の中のものも含む) を辺とするグラフで、
    // 循環の上にあるものは、すべて「必ず無効な値」(fallback があっても、使われない fallback の中の参照でも)
    const refs = new Map<string, string[]>();
    for (const [n, raw] of own) {
      if (!/var\(/i.test(raw)) continue;
      const to = [...raw.matchAll(VAR_NAME_RE)].map((m) => m[1]).filter((x) => own.has(x));
      if (to.length) refs.set(n, to);
    }
    const cyclic = new Set<string>();
    for (const start of refs.keys()) {
      const seen = new Set<string>();
      const todo = [...refs.get(start)!];
      while (todo.length) {
        const n = todo.pop()!;
        if (n === start) {
          cyclic.add(start);
          break;
        }
        if (seen.has(n)) continue;
        seen.add(n);
        todo.push(...(refs.get(n) ?? []));
      }
    }
    const resolveOwn = (name: string): string | typeof INVALID | undefined => {
      if (!own.has(name)) return vars.get(name);
      if (cyclic.has(name)) {
        vars.delete(name);
        return INVALID;
      }
      if (state.get(name) === 'done') return vars.get(name) ?? INVALID;
      if (state.get(name) === 'busy') return INVALID; // 循環
      state.set(name, 'busy');
      const raw = own.get(name)!.trim();
      const kw = raw.toLowerCase();
      let val: string | typeof INVALID;
      if (kw === 'initial' || kw === 'revert' || kw === 'revert-layer') val = INVALID;
      else if (kw === 'inherit' || kw === 'unset') val = parent?.vars.get(name) ?? INVALID;
      else {
        let bad = false;
        // 置き換えた値の長さの合計。上限 (MAX_VAR_LENGTH) を超えたら無効にする (Variables 1 §3.3: 多重参照で値を膨らませない)
        let length = 0;
        const sub = (t: string, depth = 0): string =>
          depth > 20
            ? ((bad = true), '')
            : t.replace(VAR_RE, (_m, n: string, fb?: string) => {
                const r = resolveOwn(n);
                if (typeof r === 'string') {
                  if ((length += r.length) <= MAX_VAR_LENGTH) return r;
                  bad = true;
                  return '';
                }
                // 循環に入ると、fallback があっても無効 (Variables 1 §2.3)
                if (r === INVALID && own.has(n) && state.get(n) === 'busy') {
                  bad = true;
                  return '';
                }
                if (fb !== undefined) return sub(fb, depth + 1);
                bad = true;
                return '';
              });
        const out = sub(raw);
        val = bad ? INVALID : out;
      }
      state.set(name, 'done');
      if (val === INVALID) vars.delete(name);
      else vars.set(name, val);
      return val;
    };
    for (const n of own.keys()) resolveOwn(n);
    return vars;
  };

  /**
   * ② cascaded の決定 (Cascade 5 §5): 性質ごとに、読める値のうち一番強い宣言。一括指定は var() を置き換えてから分け、
   * どれか 1 つでも読めなければ宣言ごと捨てる。revert は既定のスタイルの宣言まで戻す。
   * 返す rank は、性質ごとの、決まった宣言の強さの順 (小さいほど強い)
   */
  const cascadeDecls = (decls: DeclaredValue[], vars: Map<string, string>, fsCtx: () => LenCtx): { cascaded: Map<string, string>; rank: Map<string, number>; svgFrom?: Map<string, DeclaredValue> } => {
    const cascaded = new Map<string, string>();
    const rank = new Map<string, number>();
    let svgFrom: Map<string, DeclaredValue> | undefined;
    const noteSvg = (p: string, d: DeclaredValue) => {
      if (SVG_STYLE_PROPS[p] || p === 'color' || p === 'opacity') (svgFrom ??= new Map()).set(p, d);
    };
    // 値の無い (必ず無効な値の) カスタム プロパティを fallback なしで参照した宣言は、計算値の時点で無効 (Variables 1 §3・§3.1)。
    // 残りの語だけで読める値になっても、有効な宣言にしない
    let invalidVar = false;
    // 置き換えた値の長さの合計が上限 (MAX_VAR_LENGTH) を超えたら、空の値 (計算値の時点で無効な宣言) にする (Variables 1 §3.3)
    const resolveVar = (v: string, depth = 0, budget = { left: MAX_VAR_LENGTH }): string => {
      if (depth > 10 || !/var\(/i.test(v)) return v;
      const out = v.replace(VAR_RE, (_m, n: string, fb?: string) => {
        const r = vars.get(n) ?? fb ?? ((invalidVar = true), '');
        return (budget.left -= r.length) < 0 ? '' : r;
      });
      return budget.left < 0 ? '' : resolveVar(out, depth + 1, budget);
    };
    /** revert で既定のスタイルまで戻った性質 */
    const reverted = new Set<string>();
    for (const d of decls) {
      if (d.prop.startsWith('--')) continue;
      const hasVar = /var\(/i.test(d.value);
      invalidVar = false;
      const resolved = resolveVar(d.value);
      const parts = expand(d.prop, resolved, ah);
      const bad = invalidVar || !resolved.trim() || !parts.length || (parts.length > 1 ? parts.some(([p, v]) => !valid(p, v, ANY_CTX, ah)) : parts.some(([p, v]) => !valid(p, v, fsCtx(), ah)));
      // var() を含む宣言は、置き換えた結果が読めなくても捨てない: 計算値の時点で無効な宣言として unset にする (Variables 1 §3.1)
      if (bad && hasVar) {
        for (const [p] of expand(d.prop, 'unset', ah))
          if (!cascaded.has(p) && !(reverted.has(p) && !isUa(d.rank))) {
            cascaded.set(p, 'unset');
            rank.set(p, rank.size);
            noteSvg(p, d);
          }
        continue;
      }
      // 一括指定は、どれか 1 つでも読めなければ宣言ごと捨てる
      if (parts.length > 1 && bad) continue;
      for (const [p, v] of parts) {
        if (cascaded.has(p) || (reverted.has(p) && !isUa(d.rank)) || !valid(p, v, fsCtx(), ah)) continue;
        // revert: 作成者の出どころなら、既定のスタイル (UA) の宣言まで戻る。既定のスタイルの中の revert は unset (Cascade 5 §7.3)。
        // revert-layer は層を区別しないので revert と同じに扱う
        if (/^revert(-layer)?$/i.test(v.trim())) {
          if (isUa(d.rank)) {
            cascaded.set(p, 'unset');
            rank.set(p, rank.size);
          } else reverted.add(p);
          continue;
        }
        cascaded.set(p, v);
        rank.set(p, rank.size);
        noteSvg(p, d);
      }
    }
    return { cascaded, rank, ...(svgFrom ? { svgFrom } : {}) };
  };

  /** ③ 論理→物理: 論理的な性質を、この要素の書字方向で物理的な性質に写す。同じ辺の物理的な性質と両方あれば、強い (先に決まった) 方 */
  const mapLogical = (cascaded: Map<string, string>, rank: Map<string, number>, parent: Computed | undefined) => {
    const pick = (p: string) => {
      const v = cascaded.get(p);
      return v === undefined || /^(inherit|initial|unset|revert|revert-layer)$/i.test(v) ? undefined : v.toLowerCase();
    };
    const wmV = pick('writing-mode') ?? parent?.v.get('writing-mode') ?? 'horizontal-tb';
    const dirV = pick('direction') ?? parent?.v.get('direction') ?? 'ltr';
    for (const [p, v] of [...cascaded]) {
      const phys = logicalToPhysical(p, wmV, dirV);
      if (!phys) continue;
      cascaded.delete(p);
      const rp = rank.get(p)!;
      if (!cascaded.has(phys) || (rank.get(phys) ?? Infinity) > rp) {
        cascaded.set(phys, v);
        rank.set(phys, rp);
      }
    }
  };

  /**
   * ④ 幅・高さの見積もり: 内容の幅 (cw。子の百分率の基準)・位置の基準の幅 (pcw)・子の高さの基準 (ch) を、
   * 包含ブロックの幅 cbw と自分の計算値から見積もる。text-indent の百分率と、互換モードの表のセルの高さもここで決める
   */
  const estimateBoxSizes = (out: Computed, cbw: number, parent: Computed | undefined, isRoot: boolean, floated: boolean, abs: boolean, rootFs: number) => {
    // 内容の幅 (百分率の基準) の見積もり
    const pxOf = (p: string) => parseFloat(out.v.get(p) ?? '0') || 0;
    const hb = pxOf('padding-left') + pxOf('padding-right') + pxOf('border-left-width') + pxOf('border-right-width');
    const w = out.v.get('width')!;
    if (w !== 'auto' && /px$/.test(w)) out.cw = Math.max(0, parseFloat(w) - (out.v.get('box-sizing') === 'border-box' ? hb : 0));
    else if (/^(block|list-item|flex|grid|table|flow-root)$/.test(out.v.get('display')!) && !floated && !abs) out.cw = Math.max(0, cbw - pxOf('margin-left') - pxOf('margin-right') - hb);
    else out.cw = cbw;
    // text-indent の百分率: 基準は自分の内側の幅 (Text 3 §8.1)
    {
      const sp = splitTextIndent(out.v.get('text-indent') ?? '');
      if (sp && /%/.test(sp.len)) {
        const px = lengthPx(sp.len, { fs: out.fs, rootFs, vw, vh, pct: out.cw });
        out.v.set('text-indent', [px !== undefined ? fmtPx(px) : '0px', ...sp.kws].join(' '));
      }
    }
    // max-width・min-width (CSS 2.1 §10.4): 幅を上限で抑え、下限まで広げる (下限が勝つ)。
    // 値は box-sizing に従う (border-box なら padding・border を含む)
    {
      const bs = out.v.get('box-sizing') === 'border-box' ? hb : 0;
      const mx = out.v.get('max-width') ?? 'none';
      const mn = out.v.get('min-width') ?? 'auto';
      if (/px$/.test(mx)) out.cw = Math.min(out.cw, Math.max(0, parseFloat(mx) - bs));
      if (/px$/.test(mn)) out.cw = Math.max(out.cw, Math.max(0, parseFloat(mn) - bs));
    }
    out.pcw = out.v.get('position') !== 'static' ? out.cw + pxOf('padding-left') + pxOf('padding-right') : (parent?.pcw ?? vw);
    // 互換モードの表のセルの高さ (Quirks Mode Standard §3.13。https://quirks.spec.whatwg.org/ 、2026-11-04 取得)。
    // html・body をページの領域まで広げる §3.6・§3.7 は、計算値の min-height にはしない (body の最後の子の下の余白が body の余白と相殺されて
    // 広げた body の外に出て、ページからあふれることがある)。htmlImport の quirkBodyFill で、body を包むブロックに入れる
    if (quirks) {
      const vPad = pxOf('padding-top') + pxOf('padding-bottom') + pxOf('border-top-width') + pxOf('border-bottom-width');
      const contentBox = out.v.get('box-sizing') !== 'border-box';
      // §3.13: 表のセルの height・min-height・max-height は border-box として使う (計算値を内容の高さに直す)
      if (out.v.get('display') === 'table-cell' && contentBox)
        for (const hp of ['height', 'min-height', 'max-height']) {
          const hv = out.v.get(hp) ?? '';
          if (/px$/.test(hv)) out.v.set(hp, fmtPx(Math.max(0, parseFloat(hv) - vPad)));
        }
    }
    // 子の高さの百分率の基準: 自分の高さが決まっていれば内容の高さ。互換モードでは、高さが auto でも、
    // 絶対配置でなく表のセルでないブロックの箱なら、祖先の基準 (根元の要素は初期包含ブロックの高さ) を引き継ぐ (Quirks Mode §3.5)
    {
      const hv = out.v.get('height') ?? 'auto';
      const disp2 = out.v.get('display') ?? '';
      if (/px$/.test(hv)) {
        const vb = out.v.get('box-sizing') === 'border-box' ? pxOf('padding-top') + pxOf('padding-bottom') + pxOf('border-top-width') + pxOf('border-bottom-width') : 0;
        out.ch = Math.max(0, parseFloat(hv) - vb);
      } else if (quirks && !abs && /^(block|list-item|flow-root|inline-block|table-caption)$/.test(disp2)) out.ch = isRoot ? vh : parent?.ch;
    }
  };

  const compute = (el: Element, parent: Computed | undefined, pseudo?: PseudoName): Computed => {
    const decls = declsFor(el, pseudo, parent);
    const isRoot = !pseudo && el === rootEl;
    const rootFs = cache.get(rootEl)?.fs ?? 16;
    const vars = resolveCustomProps(decls, parent);
    const fsCtx = (): LenCtx => ({ fs: parent?.fs ?? 16, rootFs: isRoot ? 16 : rootFs, vw, vh, pct: parent?.fs ?? 16 });
    const { cascaded, rank, svgFrom } = cascadeDecls(decls, vars, fsCtx);
    mapLogical(cascaded, rank, parent);
    const out: Computed = { v: new Map(), fs: 16, fsKeyword: true, cw: parent?.cw ?? vw, pcw: parent?.pcw ?? vw, vars, specified: cascaded, ...(svgFrom ? { svgFrom } : {}) };
    const pv = (p: string) => parent?.v.get(p);
    const valueOf = (p: string): string => {
      const def = PROPS[p];
      let v = cascaded.get(p);
      const inheritedProp = def?.[0] ?? false;
      if (v !== undefined) {
        const lv = v.toLowerCase();
        if (lv === 'inherit' || ((lv === 'unset' || lv === 'revert' || lv === 'revert-layer') && inheritedProp)) return pv(p) ?? def?.[1] ?? '';
        if (lv === 'initial' || lv === 'unset' || lv === 'revert' || lv === 'revert-layer') return def?.[1] ?? '';
        return v;
      }
      v = inheritedProp && parent ? pv(p) : undefined;
      return v ?? def?.[1] ?? '';
    };

    // 字の大きさ
    const fsRaw = cascaded.get('font-size');
    const pfs = parent?.fs ?? 16;
    let fs = pfs;
    let fsKw = parent?.fsKeyword ?? true;
    if (fsRaw !== undefined && !/^(inherit|unset)$/i.test(fsRaw)) {
      const k = fsRaw.toLowerCase();
      const KW: Record<string, number> = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
      if (k === 'initial') ((fs = 16), (fsKw = true));
      else if (KW[k] !== undefined) ((fs = KW[k]), (fsKw = true));
      else if (k === 'smaller') fs = pfs / 1.2;
      else if (k === 'larger') fs = pfs * 1.2;
      else {
        // lh は親の行の高さ、rlh は根元の行の高さ (Values 4 §6.1.1。font-size の中では、自身の行の高さはまだ決まらない)
        const px = lengthPx(fsRaw, { fs: pfs, rootFs: isRoot ? 16 : rootFs, vw, vh, pct: pfs, lh: parent?.lh, rootLh: isRoot ? undefined : cache.get(rootEl)?.lh });
        if (px !== undefined) {
          fs = px;
          fsKw = /em|%/.test(k) && fsKw;
        }
      }
    }
    // 書体
    const family = fmtFamily(valueOf('font-family'));
    out.v.set('font-family', family);
    // Chrome の既定 (monospaceSize13): 等幅 (monospace だけの指定) で、字の大きさが既定の大きさから来ていれば 13/16 にする
    const mono = (f?: string) => (f ?? '').trim().toLowerCase() === 'monospace';
    if (opts.monospaceSize13 && fsKw && mono(family) !== mono(parent?.v.get('font-family') ?? 'serif')) fs = mono(family) ? (fs * 13) / 16 : (fs * 16) / 13;
    out.fs = fs;
    out.fsKeyword = fsKw;
    out.v.set('font-size', fmtPx(fs));
    // lh・rlh の単位の基準: この要素 (と根元) の行の高さ (px)。行の高さが決まってから入れる (line-height の値の中では親の値)
    let ownLh: number | undefined = parent?.lh;
    let rootLh: number | undefined = isRoot ? undefined : cache.get(rootEl)?.lh;
    const ctx = (pct?: number): LenCtx => ({ fs, rootFs: isRoot ? fs : rootFs, vw, vh, pct, lh: ownLh, rootLh });

    // 色 (currentcolor の基準)
    const colorRaw = valueOf('color');
    // color の中の currentcolor は、継承した値 (Color 4 §15.5)
    const pc = parseColorWith(colorRaw, pv('color'));
    let colorVal = pc === 'current' || pc === undefined ? (pv('color') ?? 'rgb(0, 0, 0)') : fmtColor(pc);
    // 互換モード: color の初期値は quirk-inherit。初期値になった table は、文書の body の色を使う (Quirks Mode §3.12)
    if (quirks && !pseudo && (el.localName ?? el.nodeName).toLowerCase() === 'table' && /^(initial|revert|revert-layer)$/i.test((cascaded.get('color') ?? '').trim())) {
      const body = Array.from(rootEl?.children ?? []).find((k) => (k.localName ?? k.nodeName).toLowerCase() === 'body');
      const bc = body ? cache.get(body)?.v.get('color') : undefined;
      if (bc) colorVal = bc;
    }
    out.v.set('color', colorVal);
    // 圏点の色 (Text Decoration 3 §3.2): currentcolor は語のまま受け継ぎ、受け継いだ要素の字の色になる
    // (「currentcolor keyword computes to itself and is resolved to the value of color after inheritance」)。
    // 返す値は色 (この要素の字の色) にし、currentcolor であることは別に覚えて子へ渡す
    {
      const ecRaw = cascaded.get('text-emphasis-color');
      const lv = ecRaw?.trim().toLowerCase();
      let current: boolean;
      let ec = colorVal;
      if (lv === undefined || /^(inherit|unset|revert|revert-layer)$/.test(lv)) {
        current = parent ? parent.emphasisCurrent !== false : true;
        if (!current) ec = pv('text-emphasis-color') ?? colorVal;
      } else {
        const c = lv === 'initial' ? 'current' : parseColor(ecRaw!);
        current = c === 'current' || c === undefined;
        if (!current) ec = fmtColor(c as Exclude<typeof c, 'current' | undefined>);
      }
      out.emphasisCurrent = current;
      out.v.set('text-emphasis-color', ec);
    }

    // 行の高さ (数値は数値のまま継承する)
    const lhRaw = cascaded.get('line-height');
    if (lhRaw === undefined || /^(inherit|unset)$/i.test(lhRaw)) {
      out.lhNumber = parent?.lhNumber;
      out.v.set('line-height', parent?.lhNumber !== undefined ? fmtPx(parent.lhNumber * fs) : (pv('line-height') ?? 'normal'));
    } else if (/^(normal|initial)$/i.test(lhRaw)) out.v.set('line-height', 'normal');
    else if (CSS_NUMBER.test(lhRaw.trim())) {
      // 数の書き方は、読めるかの検査 (validUncached) と同じ (+1.5・1e1・.5 も数)
      out.lhNumber = parseFloat(lhRaw);
      out.v.set('line-height', fmtPx(out.lhNumber * fs));
    } else {
      const px = lengthPx(lhRaw, ctx(fs));
      out.v.set('line-height', px !== undefined ? fmtPx(px) : 'normal');
    }
    // 数値の line-height (計算値は数値のまま。CSS 2.1 §10.8.1) を読み手に渡す (脚注の参照番号など、字の大きさの違う擬似要素が受け継ぐとき)
    if (out.lhNumber !== undefined) out.v.set('-kumiori-line-height-number', String(out.lhNumber));
    // normal は字の大きさの 1.2 倍で見積もる
    const lhv = out.v.get('line-height') ?? 'normal';
    ownLh = lhv === 'normal' ? fs * 1.2 : parseFloat(lhv);
    if (isRoot) rootLh = ownLh;
    out.lh = ownLh;

    // 包含ブロックの幅 (百分率の基準)。絶対配置は位置の基準の祖先の padding box、固定配置はページの領域
    const posv = valueOf('position').toLowerCase();
    const cbw = posv === 'fixed' ? vw : posv === 'absolute' ? (parent?.pcw ?? vw) : parent ? parent.cw : vw;
    for (const p of PROP_NAMES) {
      if (out.v.has(p)) continue;
      const [inh, initial, kind] = PROPS[p];
      // 宣言の無いプロパティの近道: 継承するものは親の計算値をそのまま、継承しないものは初期値の計算値 (要素によらないもの) をそのまま使う。
      // 計算値は既に絶対値 (px・rgb()・語) なので、親の値を解釈し直しても同じ値になる。142 のプロパティを要素ごとに解釈し直す手間を省く
      let fast: string | undefined;
      if (!cascaded.has(p)) fast = inh ? parent?.v.get(p) : initialComputed(p, kind, initial, colorVal);
      if (fast !== undefined && !CHECK_FAST) {
        out.v.set(p, fast);
        continue;
      }
      const raw = valueOf(p);
      const lv = raw.toLowerCase();
      let val = raw;
      switch (kind) {
        case 'color': {
          const c = parseColorWith(raw, colorVal);
          val = c === 'current' || c === undefined ? colorVal : fmtColor(c);
          break;
        }
        case 'len':
        case 'len-auto':
        case 'len-none':
        case 'len-normal': {
          if ((kind === 'len-auto' && lv === 'auto') || (kind === 'len-none' && lv === 'none') || (kind === 'len-normal' && lv === 'normal')) {
            val = p === 'word-spacing' ? '0px' : lv;
            break;
          }
          // 表の列の幅の %: 基準は表の幅 (レイアウトで決まる) なので、% のまま返す (htmlImport が比例の列幅にする)
          if (p === 'width' && /%\s*$/.test(raw) && /^table-column/.test(valueOf('display').trim())) {
            val = raw.trim();
            break;
          }
          // 百分率の基準: margin・padding は包含ブロックの inline size (縦書きの包含ブロックでは高さ。ページの領域の高さで見積もる。
          // Writing Modes 3 §7.2)。text-indent は自分の内側の幅 (下で内容の幅が決まってから計算する。Text 3 §8.1)
          if (p === 'text-indent') {
            // hanging・each-line の語は計算値に残す (CSS Text 3 §8.1 の Computed value: plus any specified keywords)
            const sp = splitTextIndent(raw);
            if (sp && sp.kws.length) {
              const px = /%/.test(sp.len) ? undefined : lengthPx(sp.len, ctx(cbw));
              val = [px !== undefined ? fmtPx(px) : sp.len, ...sp.kws].join(' ');
              break;
            }
          }
          // row-gap・column-gap の %: 基準は自分の内容の箱 (包含ブロックではない) で、計算値は % のまま (CSS Box Alignment 3 §8.1)。
          // htmlImport が、flex・grid の容器の幅・高さから求める
          if ((p === 'text-indent' || p === 'row-gap' || p === 'column-gap') && /%/.test(raw)) {
            val = raw.trim();
            break;
          }
          // 飾りの線の太さ・下線のずらし (Text Decoration 4 §2.4・§2.8): 百分率は 1em に対する割合。% のまま返し (受け継ぐ先の字の大きさで変わる)、
          // htmlImport が、線を指定した要素の字の大きさで決める。from-font は語のまま
          if (p === 'text-decoration-thickness' || p === 'text-underline-offset') {
            if (lv === 'from-font' || /%/.test(raw)) {
              val = lv;
              break;
            }
          }
          const cbVertical = /^(vertical|tb|sideways)/.test(parent?.v.get('writing-mode') ?? '');
          // 高さの百分率: 包含ブロックの高さが決まっていればその高さ、根元の要素は初期包含ブロック (ページの領域) の高さ (CSS 2.1 §10.5)。
          // 互換モードでは、高さの決まった祖先までさかのぼる (Quirks Mode §3.5。ch の決め方は下)
          const heightBase = isRoot ? vh : parent?.ch;
          const base = /^(height|min-height|max-height)$/.test(p) ? heightBase : /^(top|bottom)$/.test(p) ? undefined : cbVertical && /^(margin|padding)-/.test(p) ? vh : cbw;
          const px = lengthPx(raw, ctx(base));
          val = px !== undefined ? fmtPx(px) : p === 'height' || p === 'min-height' || p === 'max-height' ? initial : raw;
          break;
        }
        case 'border-width': {
          // 線の種類が none・hidden なら 0 (Chrome は段間罫の幅は 0 にしない)
          const style = p === 'column-rule-width' ? 'solid' : valueOf(p.replace('-width', '-style'));
          if (/^(none|hidden)$/.test(style)) val = '0px';
          else {
            const kw = opts.borderKeywords ?? { thin: 1, medium: 3, thick: 5 };
            const px = lv === 'thin' ? kw.thin : lv === 'medium' ? kw.medium : lv === 'thick' ? kw.thick : lengthPx(raw, ctx());
            // Chrome は 1px 未満を 1px に切り上げ、それ以上は端数を切り捨てる (noBorderSnap では丸めない)
            val = fmtPx(px === undefined ? kw.medium : opts.noBorderSnap ? px : px > 0 && px < 1 ? 1 : Math.floor(px));
          }
          break;
        }
        case 'int-auto':
          // 整数の書き方は、読めるかの検査と同じ (先頭の + も読む)
          val = CSS_INTEGER.test(raw.trim()) ? String(parseInt(raw, 10)) : 'auto';
          break;
        default:
          // border-spacing の計算値は 2 つの絶対長さ (CSS 2.1 §17.6.1)。pt・em なども px に直す (htmlImport は px として読む)
          if (p === 'border-spacing') {
            const xs = raw.trim().split(/\s+/).map((v) => lengthPx(v, ctx()));
            if (xs.length >= 1 && xs.length <= 2 && xs.every((x) => x !== undefined && x >= 0)) {
              val = xs.map((x) => fmtPx(x!)).join(' ');
              break;
            }
          }
          // CSS 2.1 §15.6 の bolder・lighter (互換。書体にある、継承した太さより濃い・淡い次の太さ)
          if (p === 'font-weight' && opts.relativeWeight && (lv === 'bolder' || lv === 'lighter')) {
            const w = opts.relativeWeight(valueOf('font-family'), parseInt(parent?.v.get('font-weight') ?? '400', 10), lv);
            if (w !== undefined) {
              val = String(w);
              break;
            }
          }
          val = computeKeyword(p, raw, parent, ctx());
      }
      if (CHECK_FAST && fast !== undefined && fast !== val && !checkSeen.has(`${p}|${fast}|${val}`)) {
        checkSeen.add(`${p}|${fast}|${val}`);
        console.error(`[css fast] ${p}: 近道=${JSON.stringify(fast)} 本来=${JSON.stringify(val)} (${(el.localName ?? el.nodeName).toLowerCase()}${pseudo ? '::' + pseudo : ''})`);
      }
      out.v.set(p, val);
    }
    // 2 値の display (block flow など) は短い書き方に。ブロック化: float・絶対配置・根元の要素
    out.v.set('display', shortDisplay(out.v.get('display')!));
    const disp = out.v.get('display')!;
    const floated = out.v.get('float') !== 'none';
    const abs = /^(absolute|fixed)$/.test(out.v.get('position')!);
    if ((floated || abs || isRoot) && BLOCKIFY[disp] && disp !== 'contents') out.v.set('display', BLOCKIFY[disp]);
    if (abs) out.v.set('float', 'none');
    estimateBoxSizes(out, cbw, parent, isRoot, floated, abs, rootFs);
    // 一括指定の値 (htmlImport が読むもの)
    out.v.set('text-decoration', out.v.get('text-decoration-line')!);
    // font-variant は個別の性質から (ligatures が none で、ほかが normal なら none)
    const fv = ['font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-position'].map((p) => out.v.get(p)!);
    out.v.set('font-variant', fv[0] === 'none' && fv.slice(1).every((x) => x === 'normal') ? 'none' : fv.filter((x) => x !== 'normal' && x !== 'none').join(' ') || 'normal');
    {
      // 層ごと (コンマ区切り) に、x と y を組にする
      const bx = splitTop(out.v.get('background-position-x')!, ',');
      const by = splitTop(out.v.get('background-position-y')!, ',');
      out.v.set('background-position', bx.length <= 1 && by.length <= 1 ? `${out.v.get('background-position-x')} ${out.v.get('background-position-y')}` : Array.from({ length: Math.max(bx.length, by.length) }, (_, k) => `${bx[k % bx.length]} ${by[k % by.length]}`).join(', '));
    }
    if (pseudo && !cascaded.has('content')) out.v.set('content', 'none');
    return out;
  };

  const get = (el: Element): Computed => {
    const hit = cache.get(el);
    if (hit) return hit;
    const p = el.parentNode && el.parentNode.nodeType === 1 ? get(el.parentNode as Element) : undefined;
    const c = compute(el, p);
    cache.set(el, c);
    return c;
  };
  const getPseudo = (el: Element, which: PseudoName): Computed => {
    const m = pseudoCache.get(el) ?? {};
    let c = m[which];
    if (c === undefined) {
      c = compute(el, get(el), which);
      m[which] = c;
      pseudoCache.set(el, m);
    }
    return c;
  };
  const view = (c: Computed) => (c.view ??= { getPropertyValue: (name: string) => c.v.get(name) ?? '' });
  // 当たる規則の無い ::before / ::after は content: none。読み込みはまず content を見るので、ほかの性質は読まれたときに計算する
  const NO_CONTENT = { getPropertyValue: (name: string) => (name === 'content' ? 'none' : '') };
  const pseudoView = (el: Element, which: PseudoName) => {
    if (pseudoCache.get(el)?.[which] === undefined && !hasRules(el, which)) {
      return { getPropertyValue: (name: string) => (name === 'content' ? NO_CONTENT.getPropertyValue(name) : view(getPseudo(el, which)).getPropertyValue(name)) };
    }
    return view(getPseudo(el, which));
  };

  /**
   * SVG の表示の性質の計算値 (要素ごと。継承は HTML の要素も通る) と、文書のスタイルシートで決まった性質 (own)。
   * own に入れるのは、作成者のスタイルシートの規則が勝った性質と、style 属性の var() を含む宣言が勝った性質
   * (表示の属性と、var() の無い style 属性は、単独の SVG でも同じに読めるので、書き足さない)。
   * 表示の属性・style 属性でも、Color 4・5 の色の関数 (SVG の読み込みは読まない) を使った値は、sRGB にした計算値を書き足す
   */
  const svgCache = new Map<Element, { v: Map<string, string>; own: string[] }>();
  const SVG_UNREADABLE = /\b(hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
  const fromSheet = (d: DeclaredValue | undefined) => !!d && (((d.rank === 1 || d.rank === 3) && d.spec >= 0) || ((d.rank === 2 || d.rank === 4) && /var\(/i.test(d.value)) || (d.rank >= 1 && d.rank <= 4 && SVG_UNREADABLE.test(d.value)));
  const svgOf = (el: Element): { v: Map<string, string>; own: string[] } => {
    const hit = svgCache.get(el);
    if (hit) return hit;
    const parent = el.parentNode && el.parentNode.nodeType === 1 ? svgOf(el.parentNode as Element) : undefined;
    const c = get(el);
    const ctx: LenCtx = { fs: c.fs, rootFs: cache.get(rootEl)?.fs ?? 16, vw, vh };
    const v = new Map<string, string>();
    const own: string[] = [];
    for (const p of SVG_STYLE_PROP_NAMES) {
      const [inh, initial] = SVG_STYLE_PROPS[p];
      const raw = c.specified.get(p);
      const lv = raw?.trim().toLowerCase();
      const inherited = () => parent?.v.get(p) ?? initial;
      let val: string | undefined;
      if (lv === undefined) val = inh ? inherited() : initial;
      else if (lv === 'inherit') val = inherited();
      else if (lv === 'initial') val = initial;
      else if (lv === 'unset' || lv === 'revert' || lv === 'revert-layer') val = inh ? inherited() : initial;
      else val = svgStyleValue(p, raw!, ctx, c.v.get('color')) ?? (inh ? inherited() : initial);
      v.set(p, val);
      if (fromSheet(c.svgFrom?.get(p))) own.push(p);
    }
    const out = { v, own };
    svgCache.set(el, out);
    return out;
  };
  /** opacity の計算値 (数か百分率) → 数 ([0, 1] に丸める。Color 4 §4.2) */
  const opacityNumber = (t: string) => {
    const n = parseFloat(t) / (/%\s*$/.test(t) ? 100 : 1);
    return String(+Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1)).toFixed(4));
  };
  const svgStyle = (el: Element, isRoot: boolean): Array<[string, string]> => {
    const s = svgOf(el);
    const c = get(el);
    const out: Array<[string, string]> = s.own.map((p) => [p, svgStyleText(p, s.v.get(p)!)]);
    if (isRoot) {
      // <svg> の外の要素から継承した値 (<svg> に宣言・属性が無く、初期値でないもの)。単独の SVG には外が無いので、根元に書く
      for (const p of SVG_STYLE_PROP_NAMES) if (SVG_STYLE_PROPS[p][0] && !c.svgFrom?.has(p) && s.v.get(p) !== SVG_STYLE_PROPS[p][1]) out.push([p, svgStyleText(p, s.v.get(p)!)]);
      out.sort((a, b) => SVG_STYLE_PROP_NAMES.indexOf(a[0]) - SVG_STYLE_PROP_NAMES.indexOf(b[0]));
    }
    // color (currentcolor の基準。Color 4 §15.5): 根元では継承した値も書く (初期値の黒は書かない)
    const cf = c.svgFrom?.get('color');
    const color = c.v.get('color') ?? 'rgb(0, 0, 0)';
    if (fromSheet(cf) || (isRoot && !cf && color !== 'rgb(0, 0, 0)')) out.push(['color', color]);
    if (fromSheet(c.svgFrom?.get('opacity'))) out.push(['opacity', opacityNumber(c.v.get('opacity') ?? '1')]);
    return out;
  };

  let selIndex: ((text: string) => Element[]) | undefined;
  return {
    svgStyle,
    style: (el, pseudo) => (pseudo ? pseudoView(el, pseudo.slice(2) as PseudoName) : view(get(el))),
    hasPseudo: (el, pseudo) => hasRules(el, pseudo.slice(2)),
    isAuto: (el, prop) => {
      const v = get(el).specified.get(prop);
      return v === undefined || /^(auto|initial|unset|inherit)$/i.test(v.trim());
    },
    // 要素の索引は最初に選ぶときに作る (collectPaged が規則ごとに呼ぶ。全要素の照合を規則の数だけ繰り返さない)
    select: (selector) => (selIndex ??= selectorIndex(doc))(selector),
    contentWidth: (el) => get(el).cw,
  };
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

/** 書体の並び: 名前は二重引用符で囲む (総称と、空白を含まない名前はそのまま。Chrome と同じ) */
function fmtFamily(v: string): string {
  return splitTop(v, ',')
    .map((n) => {
      const name = n.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
      return GENERIC.test(name) || /^[-_a-zA-Z][-\w]*$/.test(name) ? name : `"${name}"`;
    })
    .join(', ');
}

const BORDER_STYLE = 'none hidden dotted dashed solid double groove ridge inset outset';
/** 語で指定する性質の、ブラウザ (Chrome) が読める語 (ほかの語を含む宣言は捨てる。float: footnote などは自前の読み取り (htmlPaged) で扱う) */
const KEYWORDS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries({
    float: 'none left right inline-start inline-end',
    clear: 'none left right both inline-start inline-end',
    position: 'static relative absolute fixed sticky',
    display:
      'none contents block inline inline-block flow-root flow list-item table inline-table table-row-group table-header-group table-footer-group table-row table-cell table-column-group table-column table-caption flex inline-flex grid inline-grid ruby ruby-text math',
    'border-top-style': BORDER_STYLE,
    'border-right-style': BORDER_STYLE,
    'border-bottom-style': BORDER_STYLE,
    'border-left-style': BORDER_STYLE,
    'column-rule-style': BORDER_STYLE,
    direction: 'ltr rtl',
    hyphens: 'none manual auto',
    'text-align': 'start end left right center justify match-parent -webkit-center -webkit-left -webkit-right -internal-center',
    'text-align-last': 'auto start end left right center justify match-parent',
    'white-space': 'normal pre nowrap pre-wrap pre-line break-spaces',
    'list-style-position': 'inside outside',
    'box-sizing': 'content-box border-box',
    visibility: 'visible hidden collapse',
    'content-visibility': 'visible auto hidden',
    'border-collapse': 'collapse separate',
    'table-layout': 'auto fixed',
    'column-span': 'none all',
    'column-fill': 'auto balance',
    'text-autospace': 'normal no-autospace auto ideograph-alpha ideograph-numeric punctuation insert replace',
    'text-spacing-trim': 'normal space-all space-first trim-start trim-both trim-all auto',
    'writing-mode': 'horizontal-tb vertical-rl vertical-lr sideways-rl sideways-lr lr lr-tb rl rl-tb tb tb-rl',
    'text-transform': 'none capitalize uppercase lowercase full-width full-size-kana math-auto',
  }).map(([k, v]) => [k, new Set(v.split(' '))]),
);

/** 値が読めるかを調べるための、仮の長さの基準 */
const ANY_CTX: LenCtx = { fs: 16, rootFs: 16, vw: 800, vh: 800, pct: 100 };

/** 1 語だけを取るキーワードの性質 */
const SINGLE_KEYWORD = new Set([
  'float', 'clear', 'position', 'visibility', 'box-sizing', 'table-layout', 'border-collapse', 'caption-side', 'empty-cells', 'list-style-position', 'direction', 'overflow-x', 'overflow-y', 'white-space', 'word-break', 'overflow-wrap', 'hyphens',
  'text-align', 'text-align-last', 'writing-mode', 'column-span', 'column-fill', 'content-visibility', 'text-spacing-trim', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'column-rule-style',
]);

/** 読める値か (読めない宣言は捨てて、次に強い宣言を使う) */
/** valid の結果 (同じ規則の宣言を、当たる要素ごとに検査し直さない。読めるかは長さの基準の値にはよらない。モードの旗には左右されるので鍵に入れる) */
const VALID_CACHE = new Map<string, boolean>();
function valid(prop: string, v: string, ctx: LenCtx, ah: AhFlags): boolean {
  const key = `${ctx === ANY_CTX ? 'a' : 'f'}${ah.ahBorderStyles ? 'b' : ''}${ah.ahCounterFlags ? 'c' : ''}|${prop}|${v}`;
  let hit = VALID_CACHE.get(key);
  if (hit === undefined) {
    if (VALID_CACHE.size > 50000) VALID_CACHE.clear();
    VALID_CACHE.set(key, (hit = validUncached(prop, v, ctx, ah)));
  }
  return hit;
}
function validUncached(prop: string, v: string, ctx: LenCtx, ah: AhFlags): boolean {
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v.trim())) return true;
  // always (Fragmentation 4 §3.1: いちばん近い断片化の文脈で改ページ・改段) は、ページでは page と同じ
  if (/^break-(before|after)$/.test(prop)) return /^(auto|avoid|avoid-page|avoid-column|page|column|left|right|recto|verso|always)$/i.test(v.trim());
  if (prop === 'break-inside') return /^(auto|avoid|avoid-page|avoid-column)$/i.test(v.trim());
  if (prop === 'content') {
    // ブラウザが知らない関数 (leader()・target-counter() など) を含む content は読めない (自前の読み取り htmlPaged で扱う)
    const bare = v.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '"s"');
    const fns = [...bare.matchAll(/([a-z-]+)\(/gi)].map((m) => m[1].toLowerCase());
    if (!fns.every((f) => /^(counter|counters|attr|url|image-set|(repeating-)?(linear|radial|conic)-gradient)$/.test(f))) return false;
    // counter(名前[, 書式])・counters(名前, 文字列[, 書式]) の引数。カンマの無い counter(page physical) は CSS の構文に無い (読めない)。
    // アンテナハウス互換 (ahCounterFlags) では、その拡張 counter(<ident> [physical || reverse]?, …) として通す
    // 名前は識別子 (CSS Syntax 3 §4.2。ASCII でない字も使える)
    const ident = new RegExp(`^-?${NAME_START}${NAME_CHAR}*$`);
    const counterName = ah.ahCounterFlags ? new RegExp(String.raw`^-?${NAME_START}${NAME_CHAR}*(\s+(physical|reverse)){0,2}$`, 'i') : ident;
    for (const m of bare.matchAll(/\b(counters?)\(([^()]*)\)/gi)) {
      const args = m[2].split(',').map((x) => x.trim());
      const ok =
        m[1].toLowerCase() === 'counter'
          ? args.length <= 2 && counterName.test(args[0]) && (args.length < 2 || ident.test(args[1]))
          : args.length >= 2 && args.length <= 3 && ident.test(args[0]) && args[1] === '"s"' && (args.length < 3 || ident.test(args[2]));
      if (!ok) return false;
    }
    return true;
  }
  if (ah.ahBorderStyles && /^(border-(top|right|bottom|left)|column-rule)-style$/.test(prop) && AH_BORDER_STYLES.test(v.trim().toLowerCase())) return true;
  const kw = KEYWORDS[prop];
  // 1 語だけを取る性質 (float: left right などは読めない)
  if (kw && SINGLE_KEYWORD.has(prop) && tokens(v.toLowerCase()).length !== 1) return false;
  if (kw) return tokens(v.toLowerCase()).every((t) => kw.has(t));
  // 数・整数の性質 (Cascade 5 §5: 読めない宣言は捨てる)
  const s0 = v.trim().toLowerCase();
  const num = CSS_NUMBER;
  const int = CSS_INTEGER;
  switch (prop) {
    case 'font-weight':
      return /^(normal|bold|bolder|lighter)$/.test(s0) || (num.test(s0) && parseFloat(s0) >= 1 && parseFloat(s0) <= 1000);
    case 'opacity':
      return num.test(s0) || /^[+-]?(\d+\.?\d*|\.\d+)%$/.test(s0);
    case 'background-origin':
    case 'background-clip':
      // <visual-box># (Backgrounds 3 §2.7・§2.8: border-box | padding-box | content-box)
      return splitTop(s0, ',').every((t) => /^(border-box|padding-box|content-box)$/.test(t.trim()));
    case 'background-attachment':
      // <attachment># (Backgrounds 3 §2.5: scroll | fixed | local)
      return splitTop(s0, ',').every((t) => /^(scroll|fixed|local)$/.test(t.trim()));
    case 'transform':
      // none | <transform-function>+ (Transforms 1 §4。関数の名前は 2D と 3D (Transforms 2 §12)。引数の中身は読み込みのときに調べる)
      return s0 === 'none' || /^(\s*(matrix|matrix3d|translate|translatex|translatey|translatez|translate3d|scale|scalex|scaley|scalez|scale3d|rotate|rotatex|rotatey|rotatez|rotate3d|skew|skewx|skewy|perspective)\([^()]*(\([^()]*\)[^()]*)*\))+\s*$/.test(s0);
    case 'transform-box':
      // content-box | border-box | fill-box | stroke-box | view-box (Transforms 1 §6)
      return /^(content-box|border-box|fill-box|stroke-box|view-box)$/.test(s0);
    case 'z-index':
      return s0 === 'auto' || int.test(s0);
    case 'text-decoration-style':
      // solid | double | dotted | dashed | wavy (Text Decoration 3 §2.2)
      return /^(solid|double|dotted|dashed|wavy)$/.test(s0);
    case 'text-decoration-thickness':
      // auto | from-font | <length> | <percentage> (Text Decoration 4 §2.4)
      return s0 === 'auto' || s0 === 'from-font' || lengthPx(s0, { ...ctx, pct: 100 }) !== undefined;
    case 'text-underline-offset':
      // auto | <length> | <percentage> (Text Decoration 4 §2.8)
      return s0 === 'auto' || lengthPx(s0, { ...ctx, pct: 100 }) !== undefined;
    case 'text-emphasis-position': {
      // [ over | under ] && [ right | left ]? (Text Decoration 3 §3.4)
      const ws = tokens(s0);
      const ou = ws.filter((w) => w === 'over' || w === 'under').length;
      const rl = ws.filter((w) => w === 'right' || w === 'left').length;
      return ou === 1 && rl <= 1 && ou + rl === ws.length;
    }
    case 'font-variant-east-asian': {
      // normal | [ <east-asian-variant-values> || <east-asian-width-values> || ruby ] (Fonts 4 §6.10): 組ごとに 1 つまで
      if (s0 === 'normal') return true;
      const ws = tokens(s0);
      const n = (re: RegExp) => ws.filter((w) => re.test(w)).length;
      const variant = n(/^(jis78|jis83|jis90|jis04|simplified|traditional)$/);
      const width = n(/^(full-width|proportional-width)$/);
      const ruby = n(/^ruby$/);
      return ws.length > 0 && variant <= 1 && width <= 1 && ruby <= 1 && variant + width + ruby === ws.length;
    }
    // order は整数だけ (2.5 などの宣言は捨てる。Flexbox 1 §5.4)
    case 'order':
      return int.test(s0);
    case 'orphans':
    case 'widows':
      return int.test(s0) && parseInt(s0, 10) >= 1;
    case 'column-count':
      return s0 === 'auto' || (int.test(s0) && parseInt(s0, 10) >= 1);
    case 'line-height':
      // normal・負でない数・負でない長さか百分率 (CSS 2.1 §10.8.1: 負の値は不正)
      if (s0 === 'normal') return true;
      if (num.test(s0)) return parseFloat(s0) >= 0;
      return !/^-/.test(s0) && lengthPx(s0, { ...ctx, pct: 100 }) !== undefined;
  }
  // 論理的な性質 (margin-inline-start・inline-size など。表には無い) は、対応する物理的な性質 (横書き・ltr のとき) の値として調べる
  const def = PROPS[prop] ?? PROPS[logicalToPhysical(prop, 'horizontal-tb', 'ltr') ?? ''];
  if (!def) return SVG_STYLE_PROPS[prop] ? svgStyleValue(prop, v, ctx) !== undefined : true;
  const kind = def[2];
  if (kind === 'color') return parseColor(v) !== undefined;
  if (prop === 'font-size') return /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i.test(v.trim()) || lengthPx(v, { ...ctx, pct: 16 }) !== undefined;
  if (prop === 'text-indent') {
    const sp = splitTextIndent(v.toLowerCase());
    return !!sp && lengthPx(sp.len, { ...ctx, pct: 100 }) !== undefined;
  }
  if (kind === 'len' || kind === 'len-auto' || kind === 'len-none' || kind === 'len-normal' || kind === 'border-width') {
    const s = v.trim().toLowerCase();
    if (/^(auto|none|normal|thin|medium|thick|fit-content|min-content|max-content)$/.test(s)) return true;
    return lengthPx(s, { ...ctx, pct: 100 }) !== undefined;
  }
  return true;
}

/** 語で決まる性質の計算値 */
function computeKeyword(p: string, raw: string, parent: Computed | undefined, ctx: LenCtx): string {
  const lv = raw.trim().toLowerCase();
  switch (p) {
    case 'font-weight': {
      const pw = parseInt(parent?.v.get('font-weight') ?? '400', 10);
      if (lv === 'normal') return '400';
      if (lv === 'bold') return '700';
      if (lv === 'bolder') return String(pw < 350 ? 400 : pw < 550 ? 700 : 900);
      if (lv === 'lighter') return String(pw < 550 ? 100 : pw < 750 ? 400 : 700);
      // 数の書き方は、読めるかの検査 (validUncached) と同じ (550.5・+700・1e2 も数。Fonts 4 §2.2: 1〜1000 の数)
      return CSS_NUMBER.test(lv) ? String(parseFloat(lv)) : '400';
    }
    case 'font-stretch': {
      const KW: Record<string, string> = { 'ultra-condensed': '50%', 'extra-condensed': '62.5%', condensed: '75%', 'semi-condensed': '87.5%', normal: '100%', 'semi-expanded': '112.5%', expanded: '125%', 'extra-expanded': '150%', 'ultra-expanded': '200%' };
      return KW[lv] ?? raw;
    }
    case 'writing-mode':
      return /^(tb-rl|tb)$/.test(lv) ? 'vertical-rl' : lv === 'tb-lr' ? 'vertical-lr' : /^(lr|lr-tb|rl|rl-tb)$/.test(lv) ? 'horizontal-tb' : lv;
    case 'vertical-align': {
      const px = lengthPx(raw, { ...ctx, pct: undefined });
      return px !== undefined && !/^(baseline|sub|super|top|text-top|middle|bottom|text-bottom)$/.test(lv) ? `${+px.toFixed(4)}px` : lv;
    }
    case 'background-position-x':
    case 'background-position-y': {
      // 層ごとの値 (コンマ区切り。Backgrounds 3 §2.1) は、層ごとに計算値にする
      const layers = splitTop(raw, ',');
      if (layers.length > 1) return layers.map((l) => computeKeyword(p, l, parent, ctx)).join(', ');
      const kw: Record<string, string> = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
      if (kw[lv]) return kw[lv];
      if (/%$/.test(lv)) return lv;
      // 端の語と距離 (right 10px など)。左・上からなら距離だけ。右・下からの百分率は 100% から引き、長さは端の語を残す
      const edge = /^(left|right|top|bottom)\s+(\S+)$/.exec(lv);
      if (edge) {
        const far = edge[1] === 'right' || edge[1] === 'bottom';
        if (/%$/.test(edge[2])) return far ? `${100 - parseFloat(edge[2])}%` : edge[2];
        const px = lengthPx(edge[2], ctx);
        if (px === undefined) return raw;
        return far ? `${edge[1]} ${+px.toFixed(4)}px` : `${+px.toFixed(4)}px`;
      }
      const px = lengthPx(raw, ctx);
      return px !== undefined ? `${+px.toFixed(4)}px` : raw;
    }
    case 'object-position': {
      // <position> (CSS Images 3 §4.6。計算値は background-position と同じ): 横と縦の組にし、長さは px に。右・下の端からの距離は
      // calc(100% - 距離) (Chrome の計算値と同じ形)
      const [x, y] = positionXY(tokens(raw));
      const one = (v: string, axis: string) => {
        const c = computeKeyword(axis, v, parent, ctx);
        const far = /^(right|bottom)\s+(.+)$/.exec(c);
        return far ? `calc(100% - ${far[2]})` : c;
      };
      return `${one(x, 'background-position-x')} ${one(y, 'background-position-y')}`;
    }
    case 'transform': {
      // 計算値は、指定のまま、長さだけを絶対の長さにする (Transforms 1 §4)。translate 系の関数の引数の長さを px に (百分率はそのまま)
      if (lv === 'none') return 'none';
      return raw.trim().replace(/\b(translate[xy]?)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_m, fn: string, body: string) => {
        const as = splitTop(body, ',').map((a) => {
          const px = /%\s*$/.test(a) ? undefined : lengthPx(a, { ...ctx, pct: undefined });
          return px !== undefined ? `${+px.toFixed(4)}px` : a.trim();
        });
        return `${fn.toLowerCase()}(${as.join(', ')})`;
      });
    }
    case 'translate':
    case 'transform-origin': {
      // 長さは px に (百分率と語はそのまま。Transforms 1 §5・Transforms 2 §5)
      if (lv === 'none') return 'none';
      return tokens(raw)
        .map((t) => {
          const px = /%$/.test(t) ? undefined : lengthPx(t, { ...ctx, pct: undefined });
          return px !== undefined ? `${+px.toFixed(4)}px` : t.toLowerCase();
        })
        .join(' ');
    }
    case 'border-top-left-radius':
    case 'border-top-right-radius':
    case 'border-bottom-right-radius':
    case 'border-bottom-left-radius': {
      // 長さは px に (百分率はそのまま)。水平と垂直が同じなら 1 つ (Chrome と同じ)
      const vals = tokens(raw).map((t) => (/%$/.test(t) ? t : `${+(lengthPx(t, { ...ctx, pct: undefined }) ?? 0).toFixed(4)}px`));
      return vals.length === 2 && vals[0] === vals[1] ? vals[0] : vals.join(' ');
    }
    case 'counter-reset':
    case 'counter-increment':
    case 'counter-set': {
      // 数の無い名前には既定の数を付ける (increment は 1、reset・set は 0。Chrome と同じ)
      if (lv === 'none') return 'none';
      const ts = tokens(raw);
      const out: string[] = [];
      for (let k = 0; k < ts.length; k++) {
        const name = ts[k];
        const hasNum = /^-?\d+$/.test(ts[k + 1] ?? '');
        out.push(`${name} ${hasNum ? ts[++k] : p === 'counter-increment' ? '1' : '0'}`);
      }
      return out.join(' ');
    }
    case 'content': {
      // 文字列の中のエスケープ (\A0 など) は字にする (Chrome と同じ)
      if (/^(normal|none)$/.test(lv)) return lv;
      return raw.trim().replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (_m, a?: string, b?: string) => JSON.stringify(unescapeCss(a ?? b ?? '')));
    }
    case 'background-size': {
      // 層ごとの値 (コンマ区切り。Backgrounds 3 §2.1) は、層ごとに計算値にする
      const layers = splitTop(raw, ',');
      if (layers.length > 1) return layers.map((l) => computeKeyword(p, l, parent, ctx)).join(', ');
      // 1 つだけの大きさは、高さが auto (Chrome は「125% auto」と返す)
      const ts = tokens(raw);
      return ts.length === 1 && !/^(auto|cover|contain)$/i.test(ts[0]) ? `${ts[0]} auto` : raw.trim();
    }
    case 'background-image':
    case 'list-style-image':
      return raw.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g, (_m, a?: string, b?: string, c?: string) => `url("${(a ?? b ?? c ?? '').trim()}")`);
    case 'text-align':
      // match-parent: 親の計算値を継ぐ。親の start・end は、親の direction で left・right にする (Text 3 §6.1)
      if (lv === 'match-parent') {
        // 根元の要素では start
        if (!parent) return 'start';
        const pv = parent.v.get('text-align') ?? 'start';
        if (pv !== 'start' && pv !== 'end') return pv;
        const rtl = parent.v.get('direction') === 'rtl';
        return (pv === 'start') !== rtl ? 'left' : 'right';
      }
      return lv;
    case 'display':
    case 'position':
    case 'float':
    case 'clear':
    case 'white-space':
    case 'list-style-position':
    case 'font-style':
    case 'box-sizing':
    case 'border-collapse':
    case 'direction':
      return lv;
    default:
      return raw.trim();
  }
}

/** 負でない整数の読み方 (HTML 5.2 §2.4.4.2)。読めなければ undefined */
const nonNegInt = (v: string | null): number | undefined => {
  const m = /^[\t\n\f\r ]*\+?(\d+)/.exec(v ?? '');
  return m ? parseInt(m[1], 10) : undefined;
};
/** 寸法の値の読み方 (HTML 5.2 §2.4.4.6): 数の後ろの字は無視する。nonZero なら 0 を無視する */
const dimension = (v: string | null, nonZero = false): string | undefined => {
  const m = /^[\t\n\f\r ]*(\d+(?:\.\d*)?)(%)?/.exec(v ?? '');
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (nonZero && n === 0) return undefined;
  return m[2] ? `${n}%` : `${n}px`;
};
/** 旧来の色の値 (色の名前・#16 進)。先頭の # を省いた 6 桁の 16 進は # を付ける */
const legacyColor = (v: string | null): string | undefined => {
  const t = (v ?? '').trim();
  if (!t || /^transparent$/i.test(t)) return undefined;
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t}` : t;
};
/** 旧来の字の大きさ (font の size。HTML 5.2 §10.3.4) */
const legacyFontSize = (v: string | null): string | undefined => {
  const m = /^[\t\n\f\r ]*([+-]?)(\d+)/.exec(v ?? '');
  if (!m) return undefined;
  let n = parseInt(m[2], 10);
  if (m[1] === '+') n += 3;
  else if (m[1] === '-') n = 3 - n;
  n = Math.max(1, Math.min(7, n));
  return ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'][n - 1];
};
/** 表の部品の、属する表 (table > tr > td、table > thead・tbody・tfoot > tr > td) */
const tableOfCell = (el: Element): Element | undefined => {
  const tr = el.parentElement;
  if (!tr || tr.localName !== 'tr') return undefined;
  const p = tr.parentElement;
  if (p?.localName === 'table') return p;
  if (p && /^(thead|tbody|tfoot)$/.test(p.localName) && p.parentElement?.localName === 'table') return p.parentElement;
  return undefined;
};

/** HTML の属性による指定 (HTML Living Standard §15.3・§15.4 の presentational hints)。後のものほど強い */
/** 文書の body (リンクの色の属性を読む。要素ごとに探さない) */
const BODY_OF = new WeakMap<Document, Element | null>();
function bodyOf(doc: Document | null | undefined): Element | null {
  if (!doc) return null;
  let b = BODY_OF.get(doc);
  if (b === undefined) BODY_OF.set(doc, (b = doc.getElementsByTagName('body')[0] ?? null));
  return b;
}
/**
 * SVG の表示の属性のうち、文書の中の <svg> に渡す性質のもの (SVG 2 §6.6 の表: SVG の名前空間のどの要素にも書ける。
 * fill は、アニメーションの要素では別の意味の属性なので除く)。値は性質の値として読む (!important の付いた値は読めない値)
 */
function svgPresentation(el: Element): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const anim = SVG_ANIMATION.test((el.localName ?? el.nodeName).toLowerCase());
  for (const p of SVG_PRESENTATION_ATTRS) {
    const v = el.getAttribute(p);
    if (v !== null && v.trim() && !(anim && p === 'fill')) out.push([p, v]);
  }
  return out;
}
function presentational(el: Element, quirks = false): Array<[string, string]> {
  const n = (el.localName ?? el.nodeName).toLowerCase();
  const out: Array<[string, string]> = [];
  const at = (a: string) => el.getAttribute(a);
  const ci = (a: string) => at(a)?.trim().toLowerCase();
  const setDim = (prop: string, a: string, nonZero = false) => {
    const v = dimension(at(a), nonZero);
    if (v) out.push([prop, v]);
  };
  const tablePart = /^(table|thead|tbody|tfoot|tr|td|th)$/.test(n);
  // 幅と高さ (table の width と td・th の width・height は 0 を無視する。§15.3.8)
  if (/^(img|video|canvas|iframe|embed|object)$/.test(n)) {
    setDim('width', 'width');
    setDim('height', 'height');
  } else if (n === 'table') {
    setDim('width', 'width', true);
    setDim('height', 'height');
  } else if (n === 'td' || n === 'th') {
    setDim('width', 'width', true);
    setDim('height', 'height', true);
  } else if (n === 'col') setDim('width', 'width');
  else if (/^(thead|tbody|tfoot|tr)$/.test(n)) setDim('height', 'height');
  else if (n === 'hr') setDim('width', 'width');
  // align
  const align = ci('align');
  // 表のセル・行の align は、Chrome と同じく -webkit-left などにする (htmlImport は接頭辞を除いて読む)
  const part = /^(td|th|tr|thead|tbody|tfoot|col|colgroup)$/.test(n);
  if (align) {
    if (part) {
      // absmiddle は text-align: center だけ。center・middle・left・right は子孫の箱もそろえる (-webkit-*)
      const a = align === 'middle' ? 'center' : align;
      if (/^(left|right|center)$/.test(a)) out.push(['text-align', `-webkit-${a}`]);
      else if (a === 'absmiddle') out.push(['text-align', 'center']);
      else if (a === 'justify') out.push(['text-align', 'justify']);
    } else if (/^(p|h[1-6])$/.test(n)) {
      if (/^(left|right|center|justify)$/.test(align)) out.push(['text-align', align]);
    } else if (n === 'div') {
      // 子孫の箱もそろえる (表の部品と同じ)
      const a = align === 'middle' ? 'center' : align;
      if (/^(left|right|center)$/.test(a)) out.push(['text-align', `-webkit-${a}`]);
      else if (a === 'justify') out.push(['text-align', 'justify']);
    } else if (n === 'caption') {
      if (align === 'bottom') out.push(['caption-side', 'bottom']);
    } else if (n === 'table') {
      if (align === 'left' || align === 'right') out.push(['float', align]);
      else if (align === 'center') out.push(['margin-inline-start', 'auto'], ['margin-inline-end', 'auto']);
    } else if (/^(img|embed|iframe|object)$/.test(n)) {
      if (align === 'left' || align === 'right') out.push(['float', align]);
      else {
        // center・middle は「要素の中央を親の基線に」(CSS の値に無いので middle で代える)
        const VA: Record<string, string> = { top: 'top', baseline: 'baseline', texttop: 'text-top', absmiddle: 'middle', abscenter: 'middle', bottom: 'bottom', center: 'middle', middle: 'middle' };
        if (VA[align]) out.push(['vertical-align', VA[align]]);
      }
    } else if (n === 'hr') {
      if (align === 'left') out.push(['margin-left', '0'], ['margin-right', 'auto']);
      else if (align === 'right') out.push(['margin-left', 'auto'], ['margin-right', '0']);
      else if (align === 'center') out.push(['margin-left', 'auto'], ['margin-right', 'auto']);
    }
  }
  const valign = ci('valign');
  if (valign && /^(thead|tbody|tfoot|tr|td|th)$/.test(n) && /^(top|middle|bottom|baseline)$/.test(valign)) out.push(['vertical-align', valign]);
  // 背景 (表の部品・body)
  if (tablePart || n === 'body') {
    const bg = legacyColor(at('bgcolor'));
    if (bg) out.push(['background-color', bg]);
    const im = at('background');
    if (im && im.trim()) out.push(['background-image', `url("${im.trim().replace(/"/g, '\\"')}")`]);
  }
  if (n === 'table') {
    const cs = nonNegInt(at('cellspacing'));
    if (cs !== undefined) out.push(['border-spacing', `${cs}px`]);
    const bc = legacyColor(at('bordercolor'));
    if (bc) out.push(['border-color', bc]);
    const b = at('border');
    if (b !== null) {
      // 読めなければ 1px。0 でなければ outset
      const w = nonNegInt(b) ?? 1;
      out.push(['border-width', `${w}px`]);
      if (w !== 0) out.push(['border-style', 'outset']);
    }
    const rules = ci('rules');
    if (rules && /^(none|groups|rows|cols|all)$/.test(rules)) out.push(['border-style', 'hidden'], ['border-collapse', 'collapse']);
    const FRAME: Record<string, string> = { void: 'hidden', above: 'outset hidden hidden hidden', below: 'hidden hidden outset hidden', hsides: 'outset hidden outset hidden', lhs: 'hidden hidden hidden outset', rhs: 'hidden outset hidden hidden', vsides: 'hidden outset', box: 'outset', border: 'outset' };
    const frame = ci('frame');
    if (frame && FRAME[frame]) out.push(['border-style', FRAME[frame]]);
  }
  if (n === 'td' || n === 'th') {
    const t = tableOfCell(el);
    if (t) {
      const b = t.getAttribute('border');
      if (b !== null && (nonNegInt(b) ?? 1) !== 0) out.push(['border-width', '1px'], ['border-style', 'inset']);
      const rules = t.getAttribute('rules')?.trim().toLowerCase();
      if (rules === 'none' || rules === 'groups' || rules === 'rows') out.push(['border-width', '1px'], ['border-style', 'none']);
      // cols: 行の向きの両側だけ実線 (左右どちらも同じなので物理の名前で書く)
      else if (rules === 'cols') out.push(['border-width', '1px'], ['border-style', 'none solid']);
      else if (rules === 'all') out.push(['border-width', '1px'], ['border-style', 'solid']);
    }
    // cellpadding は、その表のセルの padding
    let tb: Element | null = el.parentElement;
    while (tb && tb.localName !== 'table') tb = tb.parentElement;
    const cp = nonNegInt(tb?.getAttribute('cellpadding') ?? null);
    if (cp !== undefined) out.push(['padding', `${cp}px`]);
    if (el.hasAttribute('nowrap')) {
      // 互換モード: width 属性が長さ (百分率でない) なら、nowrap を打ち消す (§15.3.8)
      const w = dimension(at('width'), true);
      out.push(['white-space', quirks && w && !w.endsWith('%') ? 'normal' : 'nowrap']);
    }
  }
  // rules=groups・rows の、行グループ・列グループ・行の罫線
  const ptab = el.parentElement?.localName === 'table' ? el.parentElement : el.parentElement?.parentElement?.localName === 'table' && n === 'tr' && /^(thead|tbody|tfoot)$/.test(el.parentElement.localName) ? el.parentElement.parentElement : undefined;
  const prules = ptab?.getAttribute('rules')?.trim().toLowerCase();
  if (prules === 'groups' && el.parentElement === ptab) {
    if (/^(thead|tbody|tfoot)$/.test(n)) out.push(['border-top-width', '1px'], ['border-top-style', 'solid'], ['border-bottom-width', '1px'], ['border-bottom-style', 'solid']);
    else if (n === 'colgroup') out.push(['border-left-width', '1px'], ['border-left-style', 'solid'], ['border-right-width', '1px'], ['border-right-style', 'solid']);
  }
  if (prules === 'rows' && n === 'tr') out.push(['border-top-width', '1px'], ['border-top-style', 'solid'], ['border-bottom-width', '1px'], ['border-bottom-style', 'solid']);
  if (n === 'body') {
    const m = (a: string[]) => {
      for (const x of a) {
        if (!el.hasAttribute(x)) continue;
        const v = nonNegInt(el.getAttribute(x));
        return v === undefined ? '8px' : `${v}px`;
      }
      return undefined;
    };
    const MS: Array<[string, string[]]> = [
      // 上下は marginheight・topmargin、左右は marginwidth・leftmargin (§15.3.2。bottommargin・rightmargin は読まない)
      ['margin-top', ['marginheight', 'topmargin']],
      ['margin-right', ['marginwidth', 'leftmargin']],
      ['margin-bottom', ['marginheight', 'topmargin']],
      ['margin-left', ['marginwidth', 'leftmargin']],
    ];
    for (const [p, a] of MS) {
      const v = m(a);
      if (v) out.push([p, v]);
    }
    const tc = legacyColor(at('text'));
    if (tc) out.push(['color', tc]);
  }
  // body の link: 未訪問のリンクの色 (訪問済みのリンクは無い)
  if ((n === 'a' || n === 'area') && el.hasAttribute('href')) {
    const lc = legacyColor(bodyOf(el.ownerDocument)?.getAttribute('link') ?? null);
    if (lc) out.push(['color', lc]);
  }
  if (n === 'font') {
    const c = legacyColor(at('color'));
    if (c) out.push(['color', c]);
    const f = at('face');
    if (f) out.push(['font-family', f]);
    const sz = legacyFontSize(at('size'));
    if (sz) out.push(['font-size', sz]);
  }
  if (n === 'br') {
    const c = ci('clear');
    if (c === 'left' || c === 'right') out.push(['clear', c]);
    else if (c === 'all' || c === 'both') out.push(['clear', 'both']);
  }
  if (n === 'pre' && el.hasAttribute('wrap')) out.push(['white-space', 'pre-wrap']);
  if (/^(img|embed|object)$/.test(n)) {
    const hs = dimension(at('hspace'));
    if (hs) out.push(['margin-left', hs], ['margin-right', hs]);
    const vs = dimension(at('vspace'));
    if (vs) out.push(['margin-top', vs], ['margin-bottom', vs]);
  }
  if (n === 'img' || n === 'object') {
    const bw = nonNegInt(at('border'));
    if (bw !== undefined && bw > 0) out.push(['border-width', `${bw}px`], ['border-style', 'solid']);
  }
  // iframe の frameborder: 整数として読んで 0 か読めないなら、罫線の太さを 0 (§15.4.3)
  if (n === 'iframe' && el.hasAttribute('frameborder')) {
    const fb = /^[\t\n\f\r ]*([+-]?\d+)/.exec(at('frameborder') ?? '');
    if (!fb || parseInt(fb[1], 10) === 0) out.push(['border-width', '0']);
  }
  if (n === 'hr') {
    const col = legacyColor(at('color'));
    const solid = !!col || el.hasAttribute('noshade');
    if (solid) out.push(['border-style', 'solid']);
    const size = nonNegInt(at('size'));
    if (size !== undefined) {
      if (solid) out.push(['border-width', `${size / 2}px`]);
      else if (size === 1) out.push(['border-bottom-width', '0']);
      else if (size > 1) out.push(['height', `${size - 2}px`]);
    }
    if (col) out.push(['color', col]);
  }
  // リストの type (ol と li の数の種類は大文字小文字を区別する)
  const type = at('type')?.trim();
  if (type !== undefined && (n === 'ol' || n === 'li')) {
    const OL: Record<string, string> = { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };
    if (OL[type]) out.push(['list-style-type', OL[type]]);
  }
  if (type !== undefined && (n === 'ul' || n === 'li') && /^(none|disc|circle|square)$/i.test(type)) out.push(['list-style-type', type.toLowerCase()]);
  return out;
}

/**
 * CSS 2.1 §15.6 の bolder・lighter: 書体にある太さ (weights) のうち、継承した太さより濃い (淡い) 次の太さ。無ければ、数値で次の太さ
 * (100 刻み。900 より濃く、100 より淡くはしない)
 */
export function relativeWeightCss21(weights: number[], parentWeight: number, kind: 'bolder' | 'lighter'): number {
  const sorted = [...new Set(weights)].sort((a, b) => a - b);
  if (kind === 'bolder') return sorted.find((w) => w > parentWeight) ?? Math.min(900, Math.floor(parentWeight / 100) * 100 + 100);
  return [...sorted].reverse().find((w) => w < parentWeight) ?? Math.max(100, Math.ceil(parentWeight / 100) * 100 - 100);
}

/**
 * CSS の文字列 (か parseCss で読んだもの) の @font-face の規則から、書体の名前 (小文字) ごとの太さの一覧を集める
 * (規則は parseCss で読む: 注釈・@media・@supports・@layer の中も読み、太さの範囲は parseCss の登録する太さにする)
 */
export function fontFaceWeights(css: string | ParsedCss): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of (typeof css === 'string' ? parseCss(css) : css).fontFaces) {
    const fam = f.family.toLowerCase();
    if (fam) out.set(fam, [...(out.get(fam) ?? []), f.weight]);
  }
  return out;
}
