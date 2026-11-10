/**
 * htmlImport — HTML+CSS を Kumiori の論理ツリー (LDocument) に変換する。
 *
 * スタイルの確定 (継承・セレクタの優先順位・既定のスタイル・単位の換算) はブラウザに任せ、
 * 各要素の確定したスタイル (getComputedStyle) を読んで、論理ツリーへ写す (docs/html-css-plan.md)。
 * ページの指定 (@page の size・margin) は、CSS の文字列から自前で読む。
 *
 * 第 1 段階の対応: 見出し・段落などのブロック、インラインの装飾、リスト、表、画像、改行、ルビ、縦中横、
 * 縦書き、::before / ::after の文字列、改ページ (break-before / after / inside)、@page の size・margin。
 * 第 2 段階の対応: ページ余白の箱 (柱・ノンブル。counter(page) / counter(pages) / string() / element())、
 * :first / :left / :right / :blank・名前付きページ、string-set・position: running()、float: footnote (脚注)、
 * target-counter() (目次のページ番号)・leader()、counter() / counters() (counter-reset / increment / set)。
 * 第 3 段階の対応: text-autospace・text-spacing-trim・text-spacing・hanging-punctuation、text-emphasis (圏点。字ごとのルビにする)、
 * text-combine-upright: digits、段組 (columns・column-span)、float (left / right / inside / outside / top)、position: absolute / fixed。
 * 第 4 段階の対応: flex・grid (ブラウザが置いた項目の位置と大きさを読み、上下に重なる項目を帯にまとめて、帯は 1 行の表、
 * 項目の間の空きは空の列にして、同じ配置を再現する)。
 * ブラウザが知らない指定 (string-set など) は CSS から自前で読み、セレクタで要素に当てはめる (詳細度は見ず、後に書いたものが勝つ)。
 */
import { firstGradient } from './cssGradient';
import { applyTextTransform } from './textTransform';
import type {
  LinkTarget,
  BorderInput,
  EdgesInput,
  BackgroundImage,
  LInlineContainer,
  LBookmark,
  FootnoteOptions,
  LFootnote,
  BorderRadius,
  BorderSide,
  BoxShadow,
  LFloat,
  ConditionalPageMaster,
  LBlock,
  LBlockContainer,
  LBlockLevel,
  LDocument,
  LImage,
  LInline,
  LInlineLevel,
  LLeader,
  LMarker,
  LPageSequence,
  LRetrieveMarker,
  LRuby,
  LTable,
  LTableCell,
  LTableColumn,
  LTableRow,
  PageMaster,
  TextStyle,
  WritingMode,
} from './types';
import { TOTAL_PAGES_ID } from './types';
import type { ImportReport, ImportResult } from './xslfoImport';
import { normalizeSrc } from './assets';
import { expand, lengthPx, splitTextIndent } from './cssCascade';
import { inlineSvgDataUri, isInlineSvg } from './htmlSvg';
import { isColorName } from './color';
import type { FkFont, MathFont } from './mathFont';
import { layoutMathML, type MNode } from './mathLayout';
import { CounterStyles } from './counterStyle';
import { COMPLEX_COUNTER, complexCounterSuffix, complexCounterText, predefinedCounterStyles } from './counterStylePredefined';
import { cssColor, cssColorAlpha, cssLen, parseRgbFn, rgbHex, splitTop, splitWords } from './cssText';
import { AH_ALIASES, counterText, isPagedDecl, mediaPageOf, printColor, type SpotColors, pageNumberFormatOf, parseContent, parseCss, resolvePageRules, splitDecls, substituteRootVars, unquote, type ContentToken, type PageRule, type ParsedCss, type StyleRule } from './htmlPaged';
import { documentModeOf, isQuirksDoc, parseSelectorList } from './cssSelector';

/** 確定したスタイルの読み取り (ブラウザでは getComputedStyle。テストでは差し替える) */
/** ブロック水準の部品か (行内の並びを区切る) */
const isBlockLevel = (n: unknown): boolean =>
  typeof n === 'object' && n !== null && /^(block|block-container|table)$/.test((n as { type: string }).type);

/** 疑似要素 */
export type PseudoSel = '::before' | '::after' | '::first-letter' | '::first-line' | '::marker';

export interface StyleSource {
  /** 要素 (と ::before / ::after) の確定したスタイル */
  style(el: Element, pseudo?: PseudoSel): { getPropertyValue(name: string): string };
  /** 疑似要素に当たる規則があるか (::first-letter・::first-line を作るか決める)。分からなければ undefined */
  hasPseudo?(el: Element, pseudo: PseudoSel): boolean;
  /** 指定が auto か (幅・高さ。ブラウザの確定値は auto でも寸法になるので、別に確かめる)。分からなければ undefined */
  isAuto?(el: Element, prop: 'width' | 'height' | 'top' | 'right' | 'bottom' | 'left'): boolean | undefined;
  /** セレクタに合う要素 (既定は document.querySelectorAll。テストでは差し替える) */
  select?(selector: string): Element[];
  /** ブラウザが置いた要素の位置と大きさ (px、border-box)。flex・grid の配置に使う */
  rect?(el: Element): { x: number; y: number; width: number; height: number } | undefined;
  /** 要素の内容の幅 (px) の見積もり。ブラウザの配置 (rect) が無いとき、flex・grid の項目の幅を決める基準 */
  contentWidth?(el: Element): number | undefined;
}

export interface HtmlImportOptions {
  /** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1)。rgb-icc(…, #Separation, '名前', 濃度) を特色 (PDF の Separation) にする */
  spotColors?: SpotColors;
  /**
   * 数式用の書体 (OpenType の MATH 表を持つ書体)。あれば math 要素 (MathML) を、この書体の MATH 表の値で組み (XSL-FO の読み込みと同じ mathLayout)、
   * 字の輪郭の図形 (SVG) にする。無ければ、これまでどおり math 要素の中の字を並べる
   */
  mathFont?: MathFont;
  /**
   * ::footnote-marker の list-style-position の既定を outside (番号を本文の外にぶら下げる) にする (アンテナハウス互換。
   * 脚注番号を左の余白にはみ出させる)。指定が無ければ inside (GCPM 3 §2.7)
   */
  footnoteMarkerOutside?: boolean;
  /**
   * ページの文脈 (@page の @footnote) の字の大きさ (pt。em の基準)。指定が無ければ根元の要素の字の大きさ。
   * ページの文脈は根元の要素から受け継ぐが、初期値にする実装も適合 (CSS Paged Media 3 §5、
   * https://www.w3.org/TR/2023/WD-css-page-3-20230914/ 、2026-11-04 取得)。アンテナハウス互換では 10pt
   * (@footnote の padding-top: 0.3em が 3pt になる)
   */
  pageContextFontSize?: number;
  /** 数式の書体に無い字 (和字など) を描く書体 */
  mathFallback?: (ch: string) => FkFont | undefined;
  /** CSS の font-family の並びと太さから、使う書体を決める (XSL-FO の読み込みと同じ) */
  /** lang は要素が属する言語 (lang / xml:lang を祖先から受け継いだもの。無ければ undefined) */
  mapFont?: (families: string[], bold: boolean, lang?: string) => string | undefined;
  /** 文書の CSS の文字列 (target-counter() などを使う文書かを見る。sheet が無ければ、これを parseCss で読む) */
  css?: string;
  /** 文書の CSS を parseCss で読んだもの (prepareHtml の sheet。同じ CSS を読み直さない)。無ければ css を読む */
  sheet?: ParsedCss;
  /** @page の指定が無いときのページ (mm)。既定 A4・余白 20mm */
  defaultPage?: { width: number; height: number; margin: number };
  bleedMm?: number;
  trimMarks?: boolean;
  /** 画像が読み込まれているか (<object> の data が無ければ、中の代わりの内容を使う)。省略時は、あるものとみなす */
  hasAsset?: (src: string) => boolean;
  /**
   * 文字列の幅 (pt) を、組版と同じ書体の字幅で測る。ブラウザの配置 (rect) が無いとき、flex の項目の中身の幅に使う。
   * 無ければ、字数 × 字の大きさで見積もる
   */
  measureText?: (text: string, style: { fontFamily?: string; fontWeight: number; fontSize: number }) => number;
  /** 読み込んだ画像の本来の大きさ (CSS px)。ブラウザの配置 (rect) が無いとき、画像の大きさを max-width などの上限から決めるのに使う */
  imageSize?: (src: string) => { width: number; height: number } | undefined;
  /** 欧文の語間を、行に収めるために本来の幅より詰めてよいか。既定 false (ブラウザ・CSS と同じ。アンテナハウス互換でも詰めない) */
  wordSpaceShrink?: boolean;
  /** 和欧間のアキ (text-autospace) の大きさ (字の大きさに対する比)。既定 0.125 (CSS Text 4 の 1/8ic)。アンテナハウス互換では 0.25 */
  autospaceWidth?: number;
  /** line-height: normal の行送りの比 (font-family の並びと太さから)。分からなければ undefined (1.2 にする) */
  normalLineHeight?: (families: string[], bold: boolean) => number | undefined;
  /**
   * 左右の改ページで入る白ページの、ページの名前 (@page の名前付きの規則を選ぶ)。next (既定): 次のページの名前 (CSS の仕様・WeasyPrint)、
   * previous: 前のページの名前 (アンテナハウス互換)
   */
  blankPageName?: 'next' | 'previous';
  /**
   * 名前付きページの :first (@page Chapter:first など) を、ページの組 (page と強制改ページを持つ要素 1 つが作るページの並び。
   * CSS GCPM 3 §3.2 の page group) ごとの最初のページに当てる (アンテナハウス互換)。CSS Paged Media 3 §4.2.2 の :first は文書の最初のページだけで、
   * GCPM 3 も :first を組の最初のページとして定義し直さない (組の最初のページは :nth(1 of 名前))。
   * 既定では、名前の変わるところで分けたページの並びの最初のページに当てる
   */
  pageGroupFirst?: boolean;
  /**
   * counter() の最初の引数に、カウンタの名前 page に続けて physical を書ける (アンテナハウスの拡張: counter(<ident> [physical || reverse]?, <list-style-type>?)。
   * physical は FO の axf:physical-page-number に当たる、initial-page-number によらない物理的なページ番号)。
   * 既定では CSS Lists 3 の構文どおり、名前の後に語の続く counter() を含む content は読めない (何も出さない)
   */
  ahCounterPagePhysical?: boolean;
  /**
   * 脚注の参照番号 (::footnote-call) の行の高さを、置く所の要素から受け継ぐ (アンテナハウス互換。既定は、元の脚注の要素から)。
   * 置く所の line-height が数値なら、参照番号の字の大きさに掛かる
   */
  footnoteCallLineHeightFromParent?: boolean;
  /** 段組の箱で、最後の子の下の余白を段の高さに数えない (アンテナハウス互換。LBlockContainer.columns.discardEndMargin) */
  columnsDiscardEndMargin?: boolean;
  /** 段組の箱で、最初の段の頭の、最初の子の上の余白を捨てる (アンテナハウス互換。LBlockContainer.columns.discardStartMargin) */
  columnsDiscardStartMargin?: boolean;
  /**
   * collapse の表の外枠の罫線の外へ出る半分を、余白にはみ出させず、表全体を内側に置く
   * (アンテナハウス互換。LTable.collapseSpillAh)
   */
  tableCollapseSpillAh?: boolean;
  /** 行をまたぐセルの中央寄せで、またいだ行の間の間隔を除く (アンテナハウス互換。LTable.rowspanMiddleAh) */
  tableRowspanMiddleAh?: boolean;
  /** アンテナハウス互換: lang が日本語・中国語・韓国語の行は、和文の字の書体の上下で行の基準線を決める (TextStyle.primaryFontByLang) */
  primaryFontByLangAh?: boolean;
  /**
   * vertical-align: super の上げ幅を、親の字の大きさの 1/3 にする (アンテナハウス互換。既定は 0.35)。
   * 上付き (sup・::footnote-call) は、本文の字の大きさによらず親の字の大きさの 1/3 上げる
   */
  superShiftAh?: boolean;
  /**
   * ::before・::after の中身を、書式が親と同じでも inline の箱として渡す (アンテナハウス互換。LayoutOptions.kernAh で、
   * 要素の境目では字の組を詰めないため。::before の ‘ と続く字の間を詰めない)
   */
  pseudoInlineBoxAh?: boolean;
  /**
   * 和欧間アキの既定 (text-autospace の指定が無いとき)。既定は true (CSS Text 4 §8.4: 初期値 normal は
   * ideograph-alpha ideograph-numeric と同じ)。false は、空きを入れない組版 (互換モードの既定)
   */
  autospaceInitial?: boolean;
  /**
   * アンテナハウス互換の和文組版: text-autospace: none を「空きを入れない」と読み (アンテナハウスの拡張の構文。CSS Text 4 の値には無い)、
   * 段落の 1 行目の行頭の始め括弧類を詰める (XSL-FO の互換の既定と同じ)
   */
  jaDefaultsAh?: boolean;
  /**
   * CSS の leader() を、始めの端から並べ、dotted を leader(". ") とする (アンテナハウス互換。点は、前の内容のすぐ後から、
   * 点と空白の送りの間隔で並ぶ)
   */
  leaderFromStart?: boolean;
  /**
   * list-style-type の box・check・diamond・hyphen を記号の書式として使う (アンテナハウス互換。古い list-style-type の仕様との互換)。
   * 字は、その古い仕様 (CSS3 Lists の 2002 年 11 月 7 日の草案 §4.1) が例に挙げる字の最初のもの (OBSOLETE_LIST_GLYPHS)
   */
  ahObsoleteListStyles?: boolean;
  /** 幅が auto の表の列が入りきらないときの列の幅の配り方を互換の規則にする (アンテナハウス互換。LTable.fitContentRule の 'ah-html') */
  tableAutoWidthAh?: boolean;
  /** 表の上の見出しと表ヘッダーを、本体の最初の行と同じページに置く (アンテナハウス互換。LTable.keepHeaderWithBodyAh) */
  tableHeaderWithBodyAh?: boolean;
}

/** target-counter() / target-text() のための、id を持つ要素の情報 (1 回目の変換で集める) */
interface TargetInfo {
  counters: Record<string, number>;
  text: string;
  before: string;
  after: string;
}

const PT_PER_PX = 0.75;
const MM_PER_PT = 25.4 / 72;

/** CSS の長さ (px・pt・mm・cm・in・pc・q) → pt。単位の無い 0 も可 */
/**
 * 計算値の background-position-x・-y (最初の層) を背景画像の位置にする。
 * "right 10px"・"bottom 10px" は右・下の端からの距離 (Backgrounds 3 §3.6)
 */
/** 組んだ節 (LNode の木) の中の id を、文書の順に集める */
function collectIds(n: unknown, out: string[] = []): string[] {
  if (Array.isArray(n)) for (const k of n) collectIds(k, out);
  else if (n && typeof n === 'object') {
    const o = n as { type?: unknown; id?: unknown };
    if (o.type && typeof o.id === 'string') out.push(o.id);
    for (const v of Object.values(n)) if (v && typeof v === 'object') collectIds(v, out);
  }
  return out;
}

function setBackgroundPosition(img: BackgroundImage, px: string, py: string) {
  const one = (v: string, far: string): [number | `${number}%` | undefined, boolean] => {
    const t = v.split(',')[0].trim();
    if (/%$/.test(t)) return [t as `${number}%`, false];
    const m = new RegExp(`^${far}\\s+(\\S+)$`).exec(t);
    return m ? [cssLen(m[1]), true] : [cssLen(t), false];
  };
  if (px) {
    const [v, end] = one(px, 'right');
    img.x = v;
    if (end) img.xFromEnd = true;
  }
  if (py) {
    const [v, end] = one(py, 'bottom');
    img.y = v;
    if (end) img.yFromEnd = true;
  }
}

/**
 * ::first-letter の字 (2 つ目の組): 最初の字 (字・数字・記号と、続く結合文字) と、その前後に付く約物
 * (CSS Inline 3 §7.2 の注: ::first-letter は最初の字の前後の約物も選ぶ)。1 つ目の組は前の空白
 */
const FIRST_LETTER = /^(\s*)([\p{Ps}\p{Pi}\p{Po}]*\s*[\p{L}\p{N}\p{S}]\p{M}*[\p{Pe}\p{Pf}\p{Po}]*)/u;

/** text-indent の計算値 (長さと hanging・each-line の語。CSS Text 3 §8.1) を、字下げの書式にする */
function textIndentOf(v: string): Pick<TextStyle, 'textIndent' | 'textIndentHanging' | 'textIndentEachLine'> {
  const sp = splitTextIndent(v);
  const len = sp ? cssLen(sp.len) : undefined;
  if (len === undefined) return {};
  return { textIndent: len, textIndentHanging: !!sp?.kws.includes('hanging'), textIndentEachLine: !!sp?.kws.includes('each-line') };
}

/**
 * 表の列・行をまたぐ数の上限 (HTML Living Standard §4.9.12.1「Forming a table」: <col>・<colgroup> の span と colspan は
 * 1000 を超えたら 1000、rowspan は 65534 を超えたら 65534 にする)
 */
const MAX_COL_SPAN = 1000;
const MAX_ROW_SPAN = 65534;

/**
 * 名前の引数が要る関数 (attr()・counter()・counters()・target-counter()・target-text()) に、引数が無いもの。
 * どれも文法で最初の引数が要る (attr( <attr-name> … ) は CSS Values 5 §7.7、counter( <counter-name> … )・counters() は
 * CSS Lists 3 §4.6、target-counter()・target-text() は CSS GCPM 3 §4.1) ので、これを含む宣言は無効 (生成内容なし) として扱う
 */
function missingArgument(t: ContentToken): boolean {
  return t.kind === 'fn' && /^(attr|counters?|target-counter|target-text)$/.test(t.name) && !t.args[0]?.trim();
}

/**
 * grid-template-columns の列の数の上限。CSS Grid 1 §5.4 (Limiting Large Grids) は、実装がグリッドの大きさを実装の決めた上限に
 * 切ってよいとし、その上限は [-10000, 10000] の線を収めるべきとする。repeat() の回数 (§7.2.3 の <integer [1,∞]>) が大きくても
 * 宣言は有効のままなので、無効にはせず、列の数がこの上限に収まる回数に切る (ブラウザも repeat() の回数を自分の上限に切る)
 */
export const MAX_GRID_REPEAT = 10000;

/** grid-template-columns → 列の幅 (pt)。px・%・fr・auto・minmax()・repeat(n, …) を読む (auto と minmax は残りを等分する) */
export function gridTracks(v: string, W: number, gap: number): number[] {
  const src = (v ?? '').trim();
  if (!src || src === 'none') return [W];
  // repeat(n, a b) を展開する
  // 回数は、中の列の数 × 回数が上限 (MAX_GRID_REPEAT) に収まる数に切る (巨大な回数で配列・文字列を作らない)
  const trackTokens = (s: string) => s.match(/minmax\([^)]*\)|[^\s]+/g) ?? [];
  const expanded = src.replace(/repeat\(\s*(\d+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g, (_m, n: string, body: string) => {
    const times = Math.min(parseInt(n, 10), Math.max(1, Math.floor(MAX_GRID_REPEAT / Math.max(trackTokens(body).length, 1))));
    return Array(times).fill(body.trim()).join(' ');
  });
  const toks = trackTokens(expanded).slice(0, MAX_GRID_REPEAT);
  const free0 = W - gap * Math.max(toks.length - 1, 0);
  const fixed = toks.map((t) => (/%$/.test(t) ? (parseFloat(t) * W) / 100 : /fr$|^auto$|^minmax/.test(t) ? undefined : cssLen(t)));
  const rest = Math.max(free0 - fixed.reduce<number>((a, x) => a + (x ?? 0), 0), 0);
  const frs = toks.map((t, k) => (fixed[k] !== undefined ? 0 : /fr$/.test(t) ? parseFloat(t) || 1 : 1));
  const frSum = frs.reduce((a, b) => a + b, 0);
  return toks.map((_t, k) => fixed[k] ?? (frSum ? (rest * frs[k]) / frSum : 0));
}

/**
 * 縦横比のある置換要素 (画像) の大きさに、最小・最大の幅と高さを当てる (CSS 2.1 §10.4 の表)。
 * 縦横比を保ったまま、上限を超えれば縮め、下限に届かなければ広げる
 */
export function constrainReplaced(w: number, h: number, minW: number, maxW: number, minH: number, maxH: number): [number, number] {
  maxW = Math.max(minW, maxW);
  maxH = Math.max(minH, maxH);
  if (w > maxW && h > maxH) return maxW / w <= maxH / h ? [maxW, Math.max(minH, (maxW * h) / w)] : [Math.max(minW, (maxH * w) / h), maxH];
  if (w < minW && h < minH) return minW / w <= minH / h ? [Math.min(maxW, (minH * w) / h), minH] : [minW, Math.min(maxH, (minW * h) / w)];
  if (w > maxW && h < minH) return [maxW, minH];
  if (w < minW && h > maxH) return [minW, maxH];
  if (w > maxW) return [maxW, Math.max((maxW * h) / w, minH)];
  if (w < minW) return [minW, Math.min((minW * h) / w, maxH)];
  if (h > maxH) return [Math.max((maxH * w) / h, minW), maxH];
  if (h < minH) return [Math.min((minH * w) / h, maxW), minH];
  return [w, h];
}

/**
 * box-shadow (と filter の drop-shadow()。箱の形の影として近似する) を読む。
 * 1 つの影は「[inset] 横 縦 [ぼかし [広がり]] 色」(inset と色は前でも後でも)。色の alpha は不透明度にする
 */
export function shadowsOf(boxShadow: string, filter = ''): BoxShadow[] {
  const one = (v0: string, drop: boolean): BoxShadow | undefined => {
    const inset = /\binset\b/i.test(v0);
    const v = inset ? v0.replace(/\binset\b/gi, ' ') : v0;
    // 色: rgb()・hsl()・#…、無ければ英字だけの語 (色の名前)。無ければ黒 (currentColor の近似)
    const colorText = /(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/i.exec(v)?.[0] ?? v.split(/\s+/).find((t) => /^[a-z]+$/i.test(t)) ?? 'black';
    const lens = v
      .replace(colorText, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => cssLen(t) ?? (/^-?0$/.test(t) ? 0 : undefined));
    if (lens.length < 2 || lens.some((x) => x === undefined)) return undefined;
    const [dx, dy, blur = 0, spread = 0] = lens as number[];
    // 色と不透明度 (alpha は白に混ぜずに、不透明度として持つ)
    const rgba = parseRgbFn(colorText);
    let color: string | undefined;
    let opacity = 1;
    if (rgba) {
      color = rgbHex(rgba.r, rgba.g, rgba.b);
      opacity = rgba.a;
    } else color = cssColor(colorText);
    if (!color || opacity <= 0 || /^transparent$/i.test(colorText)) return undefined;
    return { dx, dy, color, ...(blur > 0 ? { blur } : {}), ...(!drop && spread ? { spread } : {}), ...(opacity < 1 ? { opacity } : {}), ...(inset && !drop ? { inset: true } : {}) };
  };
  const out: BoxShadow[] = [];
  if (boxShadow && boxShadow !== 'none') for (const v of splitTop(boxShadow, ',')) {
    const s = one(v, false);
    if (s) out.push(s);
  }
  for (const m of filter.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/gi)) {
    const s = one(m[1], true);
    if (s) out.push(s);
  }
  return out;
}

/** 用紙の大きさのキーワード (mm、縦置き) */
const PAGE_SIZES: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  a6: [105, 148],
  b4: [250, 353],
  b5: [176, 250],
  'jis-b4': [257, 364],
  'jis-b5': [182, 257],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  ledger: [279.4, 431.8],
};

/** @page の宣言 (size・margin・bleed・marks) から、用紙の大きさと余白 (mm) を読む */
function pageBox(
  decls: Record<string, string>,
  def: { width: number; height: number; margin: number },
  rootFsPx = 16,
  spots?: SpotColors,
): Pick<PageMaster, 'width' | 'height' | 'margins'> & { bleed?: number; marks?: boolean; cropOffset?: number; background?: string } {
  // ページの文脈は根元の要素から継ぐ (Paged Media 3 §9)。em は @page の font-size、rem は根元の要素の字の大きさ
  const fsDecl = decls['font-size'] ? lengthPx(decls['font-size'], { fs: rootFsPx, rootFs: rootFsPx, vw: 0, vh: 0, pct: rootFsPx }) : undefined;
  const fsPx = fsDecl ?? rootFsPx;
  /** 長さ (calc() を含む) → pt。vw・vh は用紙の大きさ (決まってから呼ぶ) */
  const lenPt = (v: string | undefined): number | undefined => {
    if (!v) return undefined;
    const px = lengthPx(v, { fs: fsPx, rootFs: rootFsPx, vw: width / MM_PER_PT / PT_PER_PX, vh: height / MM_PER_PT / PT_PER_PX });
    return px === undefined ? undefined : px * PT_PER_PX;
  };
  /** 括弧の外の空白で分ける */
  const words = (v: string) => splitWords(v).filter(Boolean);
  let width = def.width;
  let height = def.height;
  const margins = { top: def.margin, right: def.margin, bottom: def.margin, left: def.margin };
  const out: { bleed?: number; marks?: boolean; cropOffset?: number; background?: string } = {};
  const rawMargins: Partial<Record<'top' | 'right' | 'bottom' | 'left', string>> = {};
  for (const [prop, raw] of Object.entries(decls)) {
    const val = raw.toLowerCase();
    if (prop === 'size') {
      const parts = words(val);
      const named = parts.find((p) => PAGE_SIZES[p]);
      const lens = parts.map(lenPt).filter((n): n is number => n !== undefined);
      if (named) [width, height] = PAGE_SIZES[named];
      else if (lens.length >= 1) {
        width = lens[0] * MM_PER_PT;
        height = (lens[1] ?? lens[0]) * MM_PER_PT;
      }
      if (parts.includes('landscape') && width < height) [width, height] = [height, width];
      if (parts.includes('portrait') && width > height) [width, height] = [height, width];
    } else if (prop === 'margin') {
      const [t, r = t, b = t, l = r] = words(val);
      Object.assign(rawMargins, { top: t, right: r, bottom: b, left: l });
    } else if (/^margin-(top|right|bottom|left)$/.test(prop)) {
      rawMargins[prop.slice(7) as 'top'] = val;
    } else if (prop === 'bleed') {
      const n = lenPt(val);
      if (n !== undefined) out.bleed = n * MM_PER_PT;
    } else if (prop === 'marks') out.marks = /crop|cross/.test(val);
    else if (prop === 'background' || prop === 'background-color') {
      // ページの背景色 (塗り足しまで届く)。background の一括指定は、色だけ読む
      const col = printColor(raw, spots) ?? splitWords(raw).map(cssColor).find((c) => c && (/^#/.test(c) || isColorName(c)));
      if (col) out.background = col;
    } else if (prop === '-ah-crop-offset') {
      // 仕上がりの端から用紙の端までの幅 (アンテナハウスの拡張)
      const n = lenPt(words(val)[0]);
      if (n !== undefined) out.cropOffset = n * MM_PER_PT;
    }
  }
  // 余白 (用紙の大きさが決まってから。百分率は、左右は用紙の幅、上下は用紙の高さに対して)
  for (const [sd, v] of Object.entries(rawMargins) as Array<['top' | 'right' | 'bottom' | 'left', string]>) {
    const pct = /^(-?[\d.]+)%$/.exec(v.trim());
    if (pct) margins[sd] = ((sd === 'left' || sd === 'right' ? width : height) * parseFloat(pct[1])) / 100;
    else {
      const n = lenPt(v);
      if (n !== undefined) margins[sd] = n * MM_PER_PT;
    }
  }
  return { width, height, margins, ...out };
}

/**
 * CSS の @page 規則 (名前・擬似クラスの無いもの) から、用紙の大きさと余白を読む。
 * :first などの規則・余白の箱は、importHtml の中で扱う
 */
export function parsePageRule(css: string | ParsedCss, def: { width: number; height: number; margin: number }): Pick<PageMaster, 'width' | 'height' | 'margins'> {
  const { width, height, margins } = pageBox(resolvePageRules((typeof css === 'string' ? parseCss(css) : css).pages, {}).decls, def);
  return { width, height, margins };
}

/** Kumiori が表記を持つ定義済みの数え方 (counterText) */
const BUILTIN_COUNTER = /^(none|disc|circle|square|disclosure-open|disclosure-closed|decimal|decimal-leading-zero|lower-alpha|lower-latin|upper-alpha|upper-latin|lower-roman|upper-roman|cjk-decimal|full-width-decimal)$/;

/** 定義済みの数え方の、リストの目印の後置き (記号は無し、cjk-decimal は「、」、ほかの数は「.」) */
function builtinSuffix(type: string): string | undefined {
  if (COMPLEX_COUNTER.has(type)) return complexCounterSuffix(type);
  if (!BUILTIN_COUNTER.test(type)) return undefined;
  return /^(none|disc|circle|square|disclosure-open|disclosure-closed)$/.test(type) ? '' : type === 'cjk-decimal' ? '、' : '.';
}

/**
 * リストの番号・記号。文書の @counter-style の書式は 前置き + 表記 + 後置き (Counter Styles 3 §3.1)。
 * 定義の無い名前は decimal と同じ (§5)
 */
function listMarker(type: string, n: number, styles?: CounterStyles, glyphs?: Record<string, string>): string {
  if (/^["'].*["']$/.test(type)) return type.slice(1, -1);
  const custom = styles?.marker(type, n);
  if (custom !== undefined) return custom;
  if (glyphs && Object.hasOwn(glyphs, type)) return glyphs[type];
  if (COMPLEX_COUNTER.has(type)) return complexText(type, n) + (builtinSuffix(type) ?? '');
  if (!BUILTIN_COUNTER.test(type)) return counterText('decimal', n) + '.';
  return counterText(type, n) + (builtinSuffix(type) ?? '');
}

/** 手順で作る定義済みの数え方 (CSS Counter Styles 3 §7.1.3・§7.2)。範囲の外は代わりの書式 (中国語は cjk-decimal、ethiopic-numeric は decimal) */
function complexText(type: string, n: number): string {
  return complexCounterText(type, n) ?? counterText(type === 'ethiopic-numeric' ? 'decimal' : 'cjk-decimal', n);
}

/**
 * CSS3 Lists の 2002 年 11 月 7 日の草案 (https://www.w3.org/TR/2002/WD-css3-lists-20021107/) §4.1 の記号の書式と、
 * その例の字の最初のもの: box は U+25A1 WHITE SQUARE、check は U+2713 CHECK MARK、diamond は U+25C6 BLACK DIAMOND、
 * hyphen は U+2043 HYPHEN BULLET。今の仕様には無い書式で、アンテナハウス互換 (ahObsoleteListStyles) のときだけ使う
 */
const OBSOLETE_LIST_GLYPHS: Record<string, string> = { box: '\u25A1', check: '\u2713', diamond: '\u25C6', hyphen: '\u2043' };

/** 余白の箱の位置 (どの辺か・既定の揃え) */
const MARGIN_BOXES: Record<string, { edge: 'top' | 'bottom' | 'left' | 'right'; part: 'start' | 'center' | 'end' | 'corner-start' | 'corner-end' }> = {
  'top-left-corner': { edge: 'top', part: 'corner-start' },
  'top-left': { edge: 'top', part: 'start' },
  'top-center': { edge: 'top', part: 'center' },
  'top-right': { edge: 'top', part: 'end' },
  'top-right-corner': { edge: 'top', part: 'corner-end' },
  'bottom-left-corner': { edge: 'bottom', part: 'corner-start' },
  'bottom-left': { edge: 'bottom', part: 'start' },
  'bottom-center': { edge: 'bottom', part: 'center' },
  'bottom-right': { edge: 'bottom', part: 'end' },
  'bottom-right-corner': { edge: 'bottom', part: 'corner-end' },
  'left-top': { edge: 'left', part: 'start' },
  'left-middle': { edge: 'left', part: 'center' },
  'left-bottom': { edge: 'left', part: 'end' },
  'right-top': { edge: 'right', part: 'start' },
  'right-middle': { edge: 'right', part: 'center' },
  'right-bottom': { edge: 'right', part: 'end' },
};

/** string() / element() の位置 → retrieve-marker の position */
const MARKER_POS: Record<string, LRetrieveMarker['position']> = {
  first: 'first-including-carryover',
  start: 'start',
  'first-except': 'first-except',
  last: 'last-including-carryover',
};

/**
 * float の値 (アンテナハウスの拡張を含む) → left / right / start / end / inside / outside / top / bottom / center / alternate。
 * top page / page top / before は top、bottom page / page bottom / after は bottom。multicol などの修飾は読まない。sidenote は end
 * (要素の float: sidenote は、@page の @sidenote の float の側へ置く: sidenoteSide)
 */
function floatSide(v: string): string {
  const t = v.trim().toLowerCase().split(/\s+/);
  if (t.includes('footnote')) return 'footnote';
  if (t.includes('sidenote')) return 'end';
  // before・after は書字方向によらず block-start・block-end (段の先頭・末尾)。top・bottom は物理の上下で、縦書きでは行頭・行末 (float())
  if (t.includes('before')) return 'before';
  if (t.includes('after')) return 'after';
  if (t.includes('top')) return 'top';
  if (t.includes('bottom')) return 'bottom';
  return t.find((x) => /^(left|right|start|end|inside|outside|center|alternate)$/.test(x)) ?? 'none';
}

/** flex・grid の項目の幅の余裕 (pt) */
const FLEX_SLACK = 1.5;

/**
 * 縦書きの flex の容器で、物理の向きのプロパティの名前を、横書きのときの役割の名前に読み替える (CSS Writing Modes 4 §6: 縦書きでは
 * 行の向き (inline) が縦、ブロックの向きが横)。width ↔ height、左右 (行の始め・終わり) → 上下、上下 (ブロックの始め・終わり) → 右左
 * (vertical-rl はブロックの始めが右、vertical-lr は左)。flex の横並びの組み方 (flexNoRect) を、縦書きでもそのまま使うため
 */
function axisMapper(writingMode: string): (n: string) => string {
  const blockStart = /vertical-lr|sideways-lr/.test(writingMode) ? 'left' : 'right';
  const blockEnd = blockStart === 'left' ? 'right' : 'left';
  const swap: Record<string, string> = {
    width: 'height',
    height: 'width',
    'min-width': 'min-height',
    'min-height': 'min-width',
    'max-width': 'max-height',
    'max-height': 'max-width',
    'overflow-x': 'overflow-y',
    'overflow-y': 'overflow-x',
  };
  const sides: Record<string, string> = { left: 'top', right: 'bottom', top: blockStart, bottom: blockEnd };
  return (n) => {
    if (swap[n]) return swap[n];
    const m = /^(margin|padding|border)-(left|right|top|bottom)(-width)?$/.exec(n);
    return m ? `${m[1]}-${sides[m[2]]}${m[3] ?? ''}` : n;
  };
}

/**
 * 詰める空白 (CSS Text 3 §4.1.1 の document white space: 半角の空白・タブ・改行)。JavaScript の \s は和文の全角の空白 (U+3000) なども含むので使わない
 * (U+3000 は詰めない字で、幅は 1 字分)
 */
const CSS_WS = /[ \t\n\r\f]+/g;

/** aspect-ratio の値 (CSS Sizing 4 §5.1: auto || <ratio>。<ratio> は「数」か「数 / 数」)。比が無い・0 なら undefined */
function parseAspectRatio(v: string): { ratio: number; auto: boolean } | undefined {
  const s = v.trim().toLowerCase();
  if (!s || s === 'auto') return undefined;
  const auto = /\bauto\b/.test(s);
  const m = /([0-9]*\.?[0-9]+)\s*(?:\/\s*([0-9]*\.?[0-9]+))?/.exec(s.replace(/\bauto\b/, ''));
  if (!m) return undefined;
  const ratio = parseFloat(m[1]) / (m[2] !== undefined ? parseFloat(m[2]) : 1);
  return Number.isFinite(ratio) && ratio > 0 ? { ratio, auto } : undefined;
}

/** 揃えの値の前の safe・unsafe (はみ出したときの扱い。CSS Box Alignment 3 §4.4) を除く */
function alignKeyword(v: string): string {
  return v.trim().replace(/^(safe|unsafe)\s+/, '');
}

/**
 * flex の容器の justify-content (Flexbox 1 §8.2・CSS Box Alignment 3 §5.1) を、主軸の始め・終わり・中央・空きの分け方にする。
 * reverse: 主軸が逆向き (row-reverse・column-reverse)。flex-start・flex-end は主軸の向きで決まり、start・end・left・right は
 * 書字方向で決まる (left・right は、主軸が行の向きでなければ start と同じ)。normal・stretch は flex の項目では flex-start と同じ
 */
function flexJustify(v: string, reverse: boolean, inlineAxis: boolean, rtl = false): 'start' | 'end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' {
  const k = alignKeyword(v);
  if (k === 'center' || k === 'space-between' || k === 'space-around' || k === 'space-evenly') return k;
  if (k === 'flex-end') return reverse ? 'start' : 'end';
  // left・right は物理の向き: 右から左へ書く行 (rtl) では、right が始め、left が終わり
  if (k === 'end' || (inlineAxis && k === (rtl ? 'left' : 'right'))) return 'end';
  if (k === 'start' || k === 'left' || k === 'right') return 'start';
  return reverse ? 'end' : 'start';
}

/**
 * flex の項目の交差軸の揃え (align-items・align-self・align-content。Flexbox 1 §8.3・§8.4)。reverse: 交差軸が逆向き (wrap-reverse)。
 * flex-start・flex-end は交差軸の向き、start・end・self-start・self-end は書字方向で決まる。last baseline は最後の行の基線で揃える
 * (CSS Box Alignment 3 §9.3。基線で揃えられないときの代わりの揃えは end)
 */
function flexCross(v: string, reverse: boolean): 'start' | 'end' | 'center' | 'baseline' | 'last-baseline' | 'stretch' {
  const k = alignKeyword(v);
  if (k === 'center') return 'center';
  if (k === 'last baseline') return 'last-baseline';
  if (/baseline$/.test(k)) return 'baseline';
  if (k === 'flex-end') return reverse ? 'start' : 'end';
  if (k === 'flex-start') return reverse ? 'end' : 'start';
  if (/end$/.test(k)) return 'end';
  if (/start$/.test(k)) return 'start';
  return 'stretch';
}

/** 名前付きページの切り替えの印 (flowChildren が body の直下に置き、run で分ける) */
/** 流し込みの途中の項目 (block は、ブロックの箱として並ぶもの) */
type FlowItem = { v: LBlockLevel | LInlineLevel; block: boolean };

interface PageSwitch {
  type: 'page-switch';
  page: string;
  /** counter-reset: page N */
  initial?: number;
}

/** CSS の border の一括指定 (幅・線種・色) */
function parseBorder(v: string, fs: number): BorderSide | undefined {
  let width = 1.5;
  let style = 'solid';
  let color = '#000000';
  for (const t of splitWords(v)) {
    const n = lenEm(t, fs);
    if (n !== undefined) width = n;
    else if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(t)) style = t;
    else if (t === 'thin' || t === 'medium' || t === 'thick') width = { thin: 0.75, medium: 2.25, thick: 3.75 }[t];
    else color = cssColor(t) ?? color;
  }
  if (style === 'none' || style === 'hidden' || width <= 0) return undefined;
  return { width, color, ...(style !== 'solid' ? { style: style as BorderSide['style'] } : {}) };
}

/** 長さ (em・rem は fs pt を基準にする) → pt */
function lenEm(v: string, fs: number): number | undefined {
  const m = /^(-?[\d.]+)(r?em)$/i.exec(v.trim());
  if (m) return parseFloat(m[1]) * fs;
  return cssLen(v);
}

/** 1〜4 個の値の一括指定 (margin・padding) */
function edges4(v: string, fs: number): { top: number; right: number; bottom: number; left: number } {
  const n = v.trim().split(/\s+/).map((x) => lenEm(x, fs) ?? 0);
  const [t, r = t, b = t, l = r] = n;
  return { top: t, right: r, bottom: b, left: l };
}

const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/u;

class HtmlImporter {
  report: ImportReport = { unsupported: {}, notes: [], images: [], counts: { sequences: 1, blocks: 0, tables: 0, footnotes: 0, floats: 0, rubies: 0 } };
  /** ブラウザが確定させない指定 (要素ごと、::before / ::after ごと) */
  private paged = new Map<Element, Record<string, string>>();
  private pagedPseudo = new Map<Element, Partial<Record<'::before' | '::after' | '::marker', Record<string, string>>>>();
  /** カウンター (名前ごとの入れ子。owner の要素の中身を読み終えたら外す) */
  private counters = new Map<string, Array<{ owner: Element | null; v: number }>>();
  /** 組んでいるブロック (本文の中の counter(page) は、このブロックの置かれたページ番号) */
  private blockStack: LBlock[] = [];
  /** position: running() の要素を組んでいる */
  private inRunning = false;
  private autoId = 0;
  /** 直前に組んだ ::before / ::after の文字 (target-text の before / after) */
  private lastPseudoText: Record<'::before' | '::after', string> = { '::before': '', '::after': '' };
  /** 組んだ ::before / ::after の文字 (要素ごと。target-text() の子孫の生成した内容を、組んだときのカウンターの値で取る) */
  private pseudoTextOf = new WeakMap<Element, Partial<Record<'::before' | '::after', string>>>();
  /** target-text() を使う文書 (1 回目の変換で、id を持つ要素の文字を集める) */
  private readonly wantText: boolean;
  /** インラインの中で生じたマーカー (段落の外へ出す) */
  private pendingMarkers: LMarker[] = [];
  private bodyEl?: Element;
  private curPage?: string;
  /** counter(page, 書式) の書式 (ページシーケンスごとに、最初に出たもの。null はまだ出ていない) */
  private pageFormat: string | null = null;
  /** body の段組 (ページの段組にする) */
  private pageColumns?: PageMaster['columns'];
  /** ページが右から左へ進む (本文が vertical-rl)。:left・:right と同じく、左ページが奇数ページになる */
  private pagesRtl = false;
  /** 本文領域の余白 (pt) と幅 (position: absolute の基準・段の幅の計算) */
  private area = { top: 0, right: 0, bottom: 0, left: 0, width: 400, height: 600 };
  /** 縦書きの flex の容器の中身の幅の見積もりの間だけ使う、プロパティの名前の読み替え (axisMapper) */
  private axisMap?: (n: string) => string;
  private pageRules: PageRule[] = [];
  /** 根元の要素の字の大きさ (px。@page の em・rem の基準) */
  private rootFsPx = 16;
  /** ページの書字方向と向き (根元の要素の writing-mode・direction。@page の論理的な余白 margin-block などを写す基準) */
  private pageWm: [string, string] = ['horizontal-tb', 'ltr'];
  /** 名前付きページの本文領域 (余白が違うページの、position: absolute の基準) */
  private areaOf(name: string) {
    if (!name) return this.area;
    const PT = 72 / 25.4;
    const b = pageBox(resolvePageRules(this.pageRules, { name }, ...this.pageWm).decls, this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 }, this.rootFsPx, this.opts.spotColors);
    return { top: b.margins.top * PT, right: b.margins.right * PT, bottom: b.margins.bottom * PT, left: b.margins.left * PT, width: (b.width - b.margins.left - b.margins.right) * PT, height: (b.height - b.margins.top - b.margins.bottom) * PT };
  }
  /** position: fixed の箱 (全ページに出す) */
  private fixed: LBlockContainer[] = [];
  /** 縦に並べる flex の項目の揃え (align-items / align-self。ブラウザの配置が無いとき)。項目のブロックの文字の揃えにする */
  private flexItemAlign = new Map<Element, 'center' | 'end'>();
  /** id → 要素の情報。1 回目の変換で集め (record)、2 回目で使う (lookup) */
  readonly record = new Map<string, TargetInfo>();
  constructor(
    private src: StyleSource,
    private opts: HtmlImportOptions,
    /** 文書の CSS を読んだもの (opts.sheet か、opts.css を読んだもの。importHtml が 2 回の変換で使い回す) */
    private sheet: ParsedCss,
    private lookup?: Map<string, TargetInfo>,
  ) {
    this.wantText = !lookup && /target-text\(/.test(opts.css ?? '');
  }

  /**
   * CSS の規則のうち、ブラウザが知らない宣言 (string-set・float: footnote・::before の content: url() など) を、要素に当てはめる。
   * 勝ち負けは通常のカスケード (Cascade 5 §6) で決める: !important、層 (@layer)、詳細度、書いた順。
   * 自前で読む性質について、より強い宣言が自前で読まない値 (float: none など) なら、その性質は当てない (前の宣言を打ち消す)
   */
  private collectPaged(doc: Document, rules: StyleRule[], rootVars: Record<string, string> | undefined) {
    const wanted = (p: string, v: string, pseudo: boolean) => isPagedDecl(p, v) || (p === 'content' && (!pseudo || /url\(/i.test(v))) || (pseudo && (p === 'width' || p === 'height'));
    // 自前で読む宣言のある性質 (要素用と ::before / ::after 用)
    const tracked = { el: new Set<string>(), pseudo: new Set<string>() };
    const prepared = rules.map((r, order) => {
      let sel = r.selector;
      let pseudo: '::before' | '::after' | '::marker' | undefined;
      // ::marker は、リストの記号の印刷の色 (特色・CMYK) を読むため (CSS Lists 3 §3.1。:marker は 1 つのコロンでは書けない)
      const pm = /(?:::?(before|after)|::(marker))\s*$/i.exec(sel);
      if (pm) {
        pseudo = `::${(pm[1] ?? pm[2]).toLowerCase()}` as '::before' | '::after' | '::marker';
        sel = sel.slice(0, pm.index).trim() || '*';
      }
      // 書いた順の宣言 (list) を、それぞれの !important で比べる (color: red !important; color: blue で blue を !important と取り違えない)。
      // 根元の var() は置き換えて読む (自前で読む宣言は要素ごとのカスタム プロパティを追わない)。
      // 自前で読むかは元の名前で決め (アンテナハウスの別名 -ah-* など)、当てるときは別名を CSS の名前に読み替える
      const decls = r.list.map(([p, v0, imp]) => {
        const v = substituteRootVars(v0, rootVars);
        const al = AH_ALIASES[p];
        const ok = wanted(p, v, !!pseudo);
        return al ? { p: al.prop, v: al.value(v), imp: !!imp, ok } : { p, v, imp: !!imp, ok };
      });
      for (const d of decls) if (d.ok) (pseudo ? tracked.pseudo : tracked.el).add(d.p);
      const spec = parseSelectorList(r.selector)[0]?.specificity ?? 0;
      return { sel, pseudo, decls, spec, order, layer: r.layer };
    });
    // 宣言の強さ (大きいほど強い): !important は層の順を逆にする
    const rank = (imp: boolean, layer: number | undefined, spec: number, order: number): [number, number, number, number] => {
      const l = layer ?? Infinity;
      return [imp ? 1 : 0, imp ? -l : l, spec, order];
    };
    const stronger = (a: [number, number, number, number], b: [number, number, number, number]) => {
      for (let k = 0; k < 4; k++) if (a[k] !== b[k]) return a[k] > b[k];
      return false;
    };
    const best = new Map<Element, Map<string, { v: string; ok: boolean; r: [number, number, number, number] }>>();
    const keyOf = (pseudo: string | undefined, p: string) => `${pseudo ?? ''}|${p}`;
    for (const pr of prepared) {
      if (/::/.test(pr.sel)) continue; // ::footnote-call などは扱わない
      const set = pr.pseudo ? tracked.pseudo : tracked.el;
      const ds = pr.decls.filter((d) => set.has(d.p));
      if (!ds.length) continue;
      let els: Element[];
      try {
        els = this.src.select?.(pr.sel) ?? Array.from((doc as Partial<Document>).querySelectorAll?.(pr.sel) ?? []);
      } catch {
        continue;
      }
      for (const el of els) {
        let m = best.get(el);
        if (!m) best.set(el, (m = new Map()));
        for (const d of ds) {
          const r = rank(d.imp, pr.layer, pr.spec, pr.order);
          const k = keyOf(pr.pseudo, d.p);
          const cur = m.get(k);
          if (!cur || !stronger(cur.r, r)) m.set(k, { v: d.v, ok: d.ok, r });
        }
      }
    }
    for (const [el, m] of best) {
      for (const [k, { v, ok }] of m) {
        const [pseudo, p] = k.split('|') as ['' | '::before' | '::after' | '::marker', string];
        if (!ok) continue; // 勝った宣言が自前で読まない値なら、当てない
        if (pseudo) {
          const pm = this.pagedPseudo.get(el) ?? {};
          pm[pseudo] = { ...pm[pseudo], [p]: v };
          this.pagedPseudo.set(el, pm);
        } else this.paged.set(el, { ...this.paged.get(el), [p]: v });
      }
    }
  }

  private pg(el: Element): Record<string, string> {
    let v = this.paged.get(el);
    // style 属性の宣言 (規則より優先する)。1 度読んだら覚えておく
    if (!this.styleAttrRead.has(el)) {
      this.styleAttrRead.add(el);
      const attr = el.getAttribute?.('style');
      if (attr) {
        // アンテナハウスの別名 (-ah-line-height-shift-adjustment など) は、規則と同じく CSS の名前に読み替える
        const own = splitDecls(attr)
          .filter(([p, val]) => isPagedDecl(p, val) || p === 'content')
          .map(([p, val]): [string, string] => (AH_ALIASES[p] ? [AH_ALIASES[p].prop, AH_ALIASES[p].value(val)] : [p, val]));
        if (own.length) this.paged.set(el, (v = { ...v, ...Object.fromEntries(own) }));
      }
    }
    return v ?? {};
  }
  private styleAttrRead = new WeakSet<Element>();

  /** 継承する指定を、ブラウザの確定値 → 自前で読んだ指定 (祖先をたどる) の順に読む */
  private inh(el: Element, prop: string, pagedFirst = false): string {
    const v = pagedFirst ? '' : this.cs(el)(prop);
    if (v) return v;
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      // style 属性の宣言も見る (pg が読む)
      const p = this.pg(e as Element)[prop];
      if (p) return p.trim().toLowerCase();
    }
    return pagedFirst ? this.cs(el)(prop) : '';
  }

  /** 和文の字間の指定 (text-autospace・text-spacing-trim・text-spacing・hanging-punctuation) */
  private spacing(el: Element): { autospace?: boolean; squeeze?: boolean; trimStart?: boolean; trimEnd?: boolean; hang: boolean; hangFirst: boolean } {
    // 自前で読んだ指定 (アンテナハウスの -ah- を含む) を先に見る。ブラウザは、指定が無くても normal を返すため
    let as = this.inh(el, 'text-autospace', true);
    // none は CSS Text 4 の値に無い (無効な宣言として無視する)。アンテナハウス互換では、空きを入れない
    if (as === 'none') as = this.opts.jaDefaultsAh ? 'no-autospace' : '';
    let tr = this.inh(el, 'text-spacing-trim', true);
    const ts = this.inh(el, 'text-spacing', true);
    if (ts === 'none') [as, tr] = ['no-autospace', 'space-all'];
    else if (ts && ts !== 'normal') {
      if (/no-autospace/.test(ts)) as = 'no-autospace';
      else if (/autospace|ideograph/.test(ts)) as ||= 'normal';
      if (/space-all/.test(ts)) tr = 'space-all';
      else if (/trim|space-first/.test(ts)) tr ||= 'normal';
    }
    // text-spacing-trim (CSS Text 4 §8.5): trim-start・trim-both は行頭の全角の始め括弧類を二分に、trim-both は行末の終わり括弧類も二分に
    const trv = (tr ?? '').trim();
    return {
      ...(as ? { autospace: as !== 'no-autospace' } : {}),
      ...(tr ? { squeeze: trv !== 'space-all' } : {}),
      ...(tr ? { trimStart: trv === 'trim-start' || trv === 'trim-both', trimEnd: trv === 'trim-both' } : {}),
      hang: /allow-end|force-end/.test(this.inh(el, 'hanging-punctuation', true)),
      hangFirst: /(^|\s)first(\s|$)/.test(this.inh(el, 'hanging-punctuation', true)),
    };
  }

  /** 圏点の記号 (text-emphasis-style)。無ければ undefined */
  private emphasisMark(el: Element, vertical: boolean): string | undefined {
    const v = this.cs(el)('text-emphasis-style');
    if (!v || v === 'none') return undefined;
    if (/^["']/.test(v)) return unquote(v);
    const shapes: Record<string, [string, string]> = { dot: ['•', '◦'], circle: ['●', '○'], 'double-circle': ['◉', '◎'], triangle: ['▲', '△'], sesame: ['﹅', '﹆'] };
    const shape = Object.keys(shapes).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(v)) ?? (vertical ? 'sesame' : 'circle');
    return shapes[shape][/open/.test(v) ? 1 : 0];
  }

  /** 文字列に、縦中横 (text-combine-upright: digits) と圏点を当てる */
  private decorateText(raw: string, el: Element): LInlineLevel[] {
    const t = this.transformText(raw, el);
    const vertical = /vertical|tb-rl/.test(this.cs(el)('writing-mode'));
    const dg = vertical ? /digits(?:\s+(\d))?/.exec(this.inh(el, 'text-combine-upright', true)) : null;
    const maxDigits = dg ? parseInt(dg[1] ?? '2', 10) : 0;
    const mark = this.emphasisMark(el, vertical);
    if (!maxDigits && !mark) return this.smallCaps(t, el);
    const out: LInlineLevel[] = [];
    let buf = '';
    const flush = () => {
      if (buf) out.push(...this.smallCaps(buf, el));
      buf = '';
    };
    for (const m of t.matchAll(/[0-9]+|[\s\S]/gu)) {
      const s = m[0];
      if (maxDigits && /^[0-9]+$/.test(s) && s.length <= maxDigits) {
        flush();
        out.push({ type: 'tate-chu-yoko', text: s, fit: true });
        continue;
      }
      for (const ch of s) {
        // 圏点は、空白・約物・記号には付けない
        if (mark && !/[\s\p{P}\p{S}]/u.test(ch)) {
          flush();
          out.push({ type: 'ruby', baseText: ch, rubyText: mark });
        } else buf += ch;
      }
    }
    flush();
    return out;
  }

  /** text-transform (uppercase・lowercase・capitalize・full-width) */
  private transformText(t: string, el: Element): string {
    return applyTextTransform(t, this.cs(el)('text-transform'));
  }

  /**
   * font-variant: small-caps / all-small-caps: 文字列を、small caps の印を付けた inline にする (字形を使うか、大文字を縮めて代わりにするかは、
   * 組むときに書体を見て決める。LInline.smallCaps)
   */
  private smallCaps(t: string, el: Element): LInlineLevel[] {
    const c = this.cs(el);
    const v = c('font-variant-caps') || c('font-variant');
    const all = /all-small-caps/.test(v);
    if (!all && !/small-caps/.test(v)) return [t];
    return [{ type: 'inline', smallCaps: all ? 'all' : 'small', children: [t] } as LInline];
  }

  /** アンテナハウスの -ah-display-align (XSL 1.1 §7.14.4 の display-align。before・center・after) の、箱の中の上下の揃え */
  private displayAlignOf(el: Element): 'center' | 'end' | undefined {
    const v = this.pg(el)['-ah-display-align']?.trim().toLowerCase();
    return v === 'center' ? 'center' : v === 'after' ? 'end' : undefined;
  }

  /**
   * 項目の位置を読めない (直下に文字がある) 縦並びの flex: 高さが決まっていれば、justify-content を
   * 箱の中の上下の揃え (blockAlign) にする (見出しを箱の下端に寄せる、space-around で項目を上下に散らす、など)
   */
  private flexColumn(el: Element, parent: Element): LBlock | undefined {
    const c = this.cs(el);
    // 主軸の大きさ (横書きは高さ、縦書きは幅) が決まっている縦並びの容器だけ
    if (!/^column/.test(c('flex-direction')) || this.src.isAuto?.(el, this.axisOf(el)('height') as 'height' | 'width') !== false) return undefined;
    // column-reverse は主軸が下から上なので、flex-start (既定) は下端に寄せる (Flexbox 1 §5.1)
    const j = flexJustify(c('justify-content'), c('flex-direction') === 'column-reverse', false);
    const align = j === 'start' ? undefined : j;
    // 高さが決まっているので、項目を伸ばし・縮め、auto の余白で余りを吸い取れるように、高さの決まった箱にする (項目の flexGrow・flexShrink・
    // flexAutoMargin。組版エンジンが箱の中で分ける)
    const b = this.block(el, parent, true) as LBlock | undefined;
    if (!b) return undefined;
    // 折り返し (flex-wrap: wrap・wrap-reverse): 組版エンジンが、高さを超える所で次の列へ移す (Flexbox 1 §9.3)。列の間は column-gap
    const wrap = c('flex-wrap') !== 'nowrap';
    const cg = c('column-gap');
    const W = /^(vertical|sideways|tb)/.test(c('writing-mode')) ? this.verticalInlineSize(el) : (this.src.contentWidth?.(el) ?? 0) * PT_PER_PX;
    const gap = !cg || cg === 'normal' ? 0 : /%$/.test(cg) ? (parseFloat(cg) * W) / 100 : (cssLen(cg) ?? 0);
    return {
      ...b,
      type: 'block-container',
      ...(align && !wrap ? { blockAlign: align } : {}),
      ...(wrap ? { flexWrapColumns: { gap, ...(align ? { justify: align } : {}), ...(c('flex-wrap') === 'wrap-reverse' ? { reverse: true } : {}), ...(/^(normal|stretch)$/.test(alignKeyword(c('align-content'))) ? { stretch: true } : {}) } } : {}),
    } as unknown as LBlock;
  }

  /**
   * flex・grid の容器: ブラウザが置いた項目の位置と大きさ (rect) をそのまま写す。
   *  - 上下に重なる項目を 1 つの帯にまとめる。帯の項目が 1 つなら、余白で位置を決めたブロック、
   *    2 つ以上なら 1 行の表 (項目の間の空きは空の列、項目の上下の位置はセルの上の余白)
   *  - 項目の幅・高さは、ブラウザが決めたもの (枠・余白を含む)
   * 位置が分からない (rect が無い)・縦書きの容器・容器の直下に文字があるときは undefined (ふつうのブロックとして組む)
   */
  private flexGrid(el: Element, parent: Element): LBlock | undefined {
    // ブラウザの配置が無いとき (自前のカスケード): CSS の指定から項目の幅を決める
    if (!this.src.rect) return this.flexNoRect(el, parent);
    const box = this.src.rect?.(el);
    const c = this.cs(el);
    if (!box || /vertical|tb-rl|sideways-rl/.test(c('writing-mode'))) return undefined;
    if (Array.from(el.childNodes).some((n) => (n.nodeType === 3 || n.nodeType === 4) && (n.textContent ?? '').trim())) return this.flexColumn(el, parent);
    const items: Array<{ el: Element; x: number; y: number; w: number; h: number }> = [];
    const extra: LBlockLevel[] = [];
    for (const k of Array.from(el.children)) {
      if (this.display(k) === 'none') continue;
      const pos = this.cs(k)('position');
      if (pos === 'absolute' || pos === 'fixed') {
        const cont = this.positioned(k, el);
        if (pos === 'fixed') this.fixed.push(cont);
        else extra.push(cont);
        continue;
      }
      const r = this.src.rect?.(k);
      if (!r) return undefined;
      items.push({ el: k, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    const px = (v: string) => parseFloat(v) || 0;
    const top = box.y + px(c('border-top-width')) + px(c('padding-top'));
    const left = box.x + px(c('border-left-width')) + px(c('padding-left'));
    // 項目の箱: ブラウザが決めた幅・高さ (border-box)。外側の余白は、帯の中の位置で表す
    const itemNode = (it: (typeof items)[number]): LBlockLevel => {
      const d = this.display(it.el);
      const n = (this.isBlock(d, it.el) ? this.block(it.el, el) : undefined) ?? ({ type: 'block', ...this.textStyle(it.el, el), ...this.boxStyle(it.el), children: this.inline(it.el, el) } as LBlock);
      const b = n as LBlock;
      delete b.margin;
      b.width = it.w * PT_PER_PX + FLEX_SLACK;
      b.height = it.h * PT_PER_PX;
      b.boxSizing = 'border-box';
      return n;
    };
    // 上下に重なる項目を帯にまとめる
    const bands: Array<{ top: number; bottom: number; items: typeof items }> = [];
    for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const last = bands[bands.length - 1];
      if (last && it.y < last.bottom - 0.5) {
        last.items.push(it);
        last.bottom = Math.max(last.bottom, it.y + it.h);
      } else bands.push({ top: it.y, bottom: it.y + it.h, items: [it] });
    }
    const children: LBlockLevel[] = [];
    let cursor = top;
    for (const band of bands) {
      const gap = Math.max(band.top - cursor, 0) * PT_PER_PX;
      if (band.items.length === 1) {
        const it = band.items[0];
        const n = itemNode(it) as LBlock;
        const ic = this.cs(it.el);
        // 幅が中身で決まり (width: auto)、枠も背景も無い項目は、ブラウザの幅を使わない (ブラウザと Kumiori で書体が違うと、
        // 文字の幅が違って箱からはみ出す)。容器の幅いっぱいにして、項目の揃え (align-items / align-self) を文字の揃えにする
        if (this.src.isAuto?.(it.el, 'width') !== false && !n.border && !n.backgroundColor && !n.backgroundImage) {
          delete n.width;
          if (this.src.isAuto?.(it.el, 'height') !== false) delete n.height;
          delete n.boxSizing;
          const al = ic('align-self') !== 'auto' && ic('align-self') ? ic('align-self') : c('align-items');
          if (/^column/.test(c('flex-direction')) && (!n.textAlign || n.textAlign === 'start')) {
            if (al === 'center') n.textAlign = 'center';
            else if (/end$/.test(al)) n.textAlign = 'end';
          }
          n.margin = { top: gap };
        } else n.margin = { top: gap, left: Math.max(it.x - left, 0) * PT_PER_PX };
        children.push(n);
      } else {
        const columns: LTableColumn[] = [];
        const cells: LTableCell[] = [];
        let right = left;
        // 項目の幅には少し余裕を持たせる (ブラウザと Kumiori の字幅のわずかな違いで、項目の中の文字が折り返さないように)。余裕の分は次の空きから引く
        let carry = 0;
        for (const it of [...band.items].sort((a, b) => a.x - b.x)) {
          const sp = (it.x - right) * PT_PER_PX - carry;
          if (sp > 0.4) {
            columns.push({ type: 'table-column', width: sp });
            cells.push({ type: 'table-cell', children: [] });
          }
          columns.push({ type: 'table-column', width: it.w * PT_PER_PX + FLEX_SLACK });
          carry = FLEX_SLACK;
          const off = (it.y - band.top) * PT_PER_PX;
          cells.push({ type: 'table-cell', ...(off > 0.01 ? { padding: { top: off } } : {}), children: [itemNode(it)] });
          right = Math.max(right, it.x + it.w);
        }
        this.report.counts.tables++;
        children.push({ type: 'table', columns, ...(gap > 0.01 ? { margin: { top: gap } } : {}), body: { type: 'table-body', rows: [{ type: 'table-row', cells }] } } as LTable);
      }
      cursor = band.bottom;
    }
    this.report.counts.blocks++;
    // 高さが決まった容器 (全面の表紙など) は、ページをまたがない箱にする (中の文字がブラウザより少し大きくても、次のページへはみ出さない)
    const fixed = this.src.isAuto?.(el, 'height') === false;
    return { type: fixed ? 'block-container' : 'block', ...this.textStyle(el, parent), ...this.paragraphStyle(el, parent), ...this.boxStyle(el), children: [...extra, ...children] } as LBlock;
  }

  /**
   * ブラウザの配置 (rect) を使わない flex・grid: 項目を行に分け、行ごとに 1 行の表にする (列の幅は CSS の指定から決める)。
   *  - flex (横並び): flex-basis・width で項目の幅を決め、flex-wrap なら容器の幅で行を折る。余りは flex-grow で分け、
   *    伸びる項目が無ければ justify-content (center・flex-end・space-between・space-around・space-evenly) で空きの列にする。幅の分からない項目は、余りを等分する
   *  - grid: grid-template-columns (px・%・fr・auto・repeat()) の列に、項目を順に置く (grid-column の span を読む)
   *  - 縦並びの flex・幅の分からない容器・直下に文字がある容器は、ふつうのブロックとして組む (undefined)
   */
  private flexNoRect(el: Element, parent: Element): LBlock | undefined {
    // 縦書きの容器: 行の向き (主軸) が縦になる。プロパティの名前を読み替えて、横書きと同じに組む (行の表は縦書きでは上から下へ列を並べる)
    const wm = this.cs(el)('writing-mode');
    const vert = /^(vertical|sideways|tb)/.test(wm);
    const L = vert ? axisMapper(wm) : (n: string) => n;
    const c0 = this.cs(el);
    const c = (n: string) => c0(L(n));
    const autoOf = (e: Element, p: 'width' | 'height') => this.src.isAuto?.(e, L(p) as 'width' | 'height');
    /** 中身の幅の見積もり (縦書きでは行の向きの大きさ) を、読み替えを効かせて呼ぶ */
    const measure = <T,>(f: () => T): T => {
      const prev = this.axisMap;
      this.axisMap = vert ? L : undefined;
      try {
        return f();
      } finally {
        this.axisMap = prev;
      }
    };
    const W = vert ? this.verticalInlineSize(el) : (this.src.contentWidth?.(el) ?? 0) * PT_PER_PX;
    const isGrid = /grid$/.test(this.display(el));
    if (!W) return undefined;
    // 直下の文字は、続いた文字の並びごとに無名の項目にする (下の flexItemSources。目次の <a> の題とページ番号など)
    // 縦に並べる flex: ふつうのブロックとして組み、項目の揃えは項目の文字の揃えにする (幅が中身で決まる項目を中央・終わりに寄せるのと同じ)。
    // 高さが決まっていれば、justify-content を中身の上下の揃えにする
    if (!isGrid && /^column/.test(c('flex-direction'))) {
      // 項目の要素 (display: contents の子は、その子。CSS Display 3 §2.5)
      for (const k of (this.flexItemSources(el) ?? []).filter((x) => !x.ps).map((x) => x.el)) {
        const kc0 = this.cs(k);
        const kc = (n: string) => kc0(L(n));
        const al = kc('align-self') && kc('align-self') !== 'auto' ? kc('align-self') : c('align-items');
        // 交差軸 (横) の margin: auto は揃えより先に空きを取る (Flexbox 1 §8.1)。wrap-reverse は交差軸が右から左
        const ml = kc('margin-left') === 'auto';
        const mr = kc('margin-right') === 'auto';
        // 縦並びでは交差軸が行の向きなので、基線では揃えられない: last baseline は代わりの end (first baseline は start)
        const x0 = ml && mr ? 'center' : ml ? 'end' : mr ? 'start' : flexCross(al, c('flex-wrap') === 'wrap-reverse');
        const x = x0 === 'last-baseline' ? 'end' : x0;
        if (x === 'center' || x === 'end') this.flexItemAlign.set(k, x);
      }
      return this.flexColumn(el, parent) ?? (this.block(el, parent, true) as LBlock | undefined);
    }
    const srcs = this.flexItemSources(el);
    if (!srcs) return this.flexColumn(el, parent) ?? (this.block(el, parent, true) as LBlock | undefined);
    const extra: LBlockLevel[] = [];
    /** 項目: 子の要素か ::before・::after (ps)。node は組んだ中身 (文書の順に組む: カウンターの値が文書の順になるように) */
    type Item = { el: Element; ps?: '::before' | '::after'; anon?: boolean; node: LBlockLevel; text?: string; order: number; collapse?: boolean; fit?: boolean };
    const items: Item[] = [];
    let pseudoSeen = false;
    for (const src of srcs) {
      const k = src.el;
      if (src.text !== undefined) {
        // 無名の項目: 文字の並びを包むブロック。字の書式は持ち主から受け継ぐ (持ち主が容器なら、容器の箱が持つ)
        const fi: FlowItem[] = this.decorateText(this.text(src.text, k), k).map((v) => ({ v, block: false }));
        const children = this.collapseFlowWhitespace(fi, /^pre/.test(this.cs(k)('white-space')));
        items.push({ el: k, anon: true, node: { type: 'block', ...(k !== el ? this.textStyle(k, el) : {}), children } as LBlock, text: src.text, order: 0 });
        continue;
      }
      const kc0 = this.cs(k, src.ps);
      const kc = (n: string) => kc0(L(n));
      const pos = kc('position');
      if (src.ps) {
        pseudoSeen = true;
        const r = this.flexPseudo(k, src.ps);
        if (r.positioned) {
          if (pos === 'fixed') this.fixed.push(r.positioned as LBlockContainer);
          else extra.push(r.positioned);
        }
        if (r.node) items.push({ el: k, ps: src.ps, node: r.node, text: r.text, order: parseInt(kc('order'), 10) || 0 });
        continue;
      }
      if (pos === 'absolute' || pos === 'fixed') {
        const cont = this.positioned(k, el);
        if (pos === 'fixed') this.fixed.push(cont);
        else extra.push(cont);
        continue;
      }
      // 項目の上下の margin は、セルの先頭・末尾でも捨てない (CSS の flex の項目。表紙の h1 の margin-top: 5cm など)
      const d = this.display(k);
      const node = (this.isBlock(d, k) ? this.block(k, el) : undefined) ?? ({ type: 'block', ...this.textStyle(k, el), ...this.boxStyle(k), children: this.inline(k, el) } as LBlock);
      // visibility: collapse の flex の項目 (Flexbox 1 §4.4): 主軸の大きさを 0 にして、交差軸の大きさだけを支柱として残す (下の行の組み立て)。
      // grid の項目の collapse は hidden と同じ (場所を残す。CSS 2.1 §11.2)
      items.push({ el: k, node, order: parseInt(kc('order'), 10) || 0, ...(src.collapse && !isGrid ? { collapse: true } : {}) });
    }
    // ::before・::after のカウンターの範囲を閉じる (ふつうのブロックなら flowChildren が閉じる)
    if (pseudoSeen) this.leaveCounters(el);
    // order の順 (同じ order の間は文書の順。Flexbox 1 §5.4)
    items.sort((a, b) => a.order - b.order);
    const ics = (it: Item): ((n: string) => string) => {
      const base = it.anon ? (n: string) => HtmlImporter.ANON_ITEM[n] ?? (/^(margin|padding|border)-/.test(n) ? '0' : this.cs(it.el)(n)) : this.cs(it.el, it.ps);
      return (n) => base(L(n));
    };
    const rowReverse = !isGrid && c('flex-direction') === 'row-reverse';
    // 右から左へ書く容器 (direction: rtl): 主軸 (行の向き) の始めは右 (Flexbox 1 §2.1)。行の表も右から左に列を並べる (CSS 2.1 §17.5) ので、
    // 列は主軸の始めからの順のままでよい。表が容器いっぱいになるように、伸びる列が無い行には終わりの側 (左) に空きの列を足す
    const rtl = c('direction') === 'rtl';
    if (rowReverse) items.reverse();
    // wrap-reverse: 交差軸の始めと終わりを入れ替える (行は下から上へ積む。Flexbox 1 §5.2)
    const crossReverse = !isGrid && c('flex-wrap') === 'wrap-reverse';
    const fixed = autoOf(el, 'height') === false;
    const len = (v: string, base: number) => (/%$/.test(v) ? (parseFloat(v) * base) / 100 : cssLen(v));
    const colGap = len(c('column-gap'), W) ?? 0;
    // row-gap の % は内容の高さに対する割合で、高さが決まっていなければ 0 (CSS Box Alignment 3 §8.1)
    const rowGap = (/%$/.test(c('row-gap')) ? (fixed && cssLen(c('height')) !== undefined ? len(c('row-gap'), cssLen(c('height'))!) : 0) : cssLen(c('row-gap'))) ?? 0;
    // 項目の外側の幅のうち、内容の幅以外 (左右の余白・枠・内側の余白)
    const outer = (k: Item) => {
      const kc = ics(k);
      const p = (n: string) => cssLen(kc(n)) ?? 0;
      return p('margin-left') + p('margin-right') + (kc('box-sizing') === 'border-box' ? 0 : p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width'));
    };
    /** 行の 1 列: 項目 (el) か空き。w は固定の幅 (pt)、star があれば比例の列 (組版時の容器の幅の余りを star の比で分け、w を足す。表の 'N*' + widthExtra) */
    /** collapse の項目の支柱のもと: 畳む前の組みで同じ行にあった項目と、その幅 (同じ行の支柱どうしで分け合う) */
    type StrutLine = Array<{ el: Item; w: number }>;
    type Cell = { el?: Item; w: number; star?: number; strut?: StrutLine };
    const lines: Cell[][] = [];
    if (isGrid) {
      const tracks = gridTracks(c('grid-template-columns'), W, colGap);
      let line: Cell[] = [];
      let col = 0;
      for (const k of items) {
        const span = Math.min(tracks.length, parseInt(/span\s+(\d+)/.exec(ics(k)('grid-column-start') + ' ' + ics(k)('grid-column-end'))?.[1] ?? '1', 10) || 1);
        if (col + span > tracks.length) {
          lines.push(line);
          line = [];
          col = 0;
        }
        const w = tracks.slice(col, col + span).reduce((a, b) => a + b, 0) + colGap * (span - 1);
        if (line.length && colGap > 0) line.push({ w: colGap });
        line.push({ el: k, w });
        col += span;
      }
      if (line.length) lines.push(line);
    } else {
      /**
       * 縮める下限 (外側の幅)。min-width: auto は自動の最小の大きさ (Flexbox 1 §4.5): 中身の最も狭い幅 (min-content。max-width で抑える) と、
       * 幅の指定があればその小さい方。overflow が visible でない (切り取る・流す) 項目は 0。min-width の指定があれば、それ
       */
      const minOf = (k: Item, kc: (n: string) => string, fixedW: boolean) => {
        const margins = (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0);
        const mw = kc('min-width');
        if (mw && mw !== 'auto') return (len(mw, W) ?? 0) + outer(k);
        if (!/^(visible|clip)?$/.test(kc('overflow-x') || kc('overflow'))) return outer(k);
        let content = k.anon ? measure(() => this.minTextWidth(k.text ?? '', k.el)) : k.ps ? measure(() => this.minTextWidth(k.text ?? '', k.el, k.ps)) + (outer(k) - margins) : measure(() => this.minContentWidth(k.el, false));
        const max = len(kc('max-width'), W);
        if (max !== undefined) content = Math.min(content, max + (kc('box-sizing') === 'border-box' ? 0 : outer(k) - margins));
        const specified = fixedW ? len(kc('width'), W) : undefined;
        const auto = specified !== undefined ? Math.min(content, specified + (kc('box-sizing') === 'border-box' ? 0 : outer(k) - margins)) : content;
        return auto + margins;
      };
      /** 項目の幅の基準 (w: flex-basis、無ければ width。分からなければ undefined)・伸び縮みの比と下限・上限。strut は collapse の項目の本来の幅 */
      type Info = { el: Item; w: number | undefined; grow: number; shrink: number; base: number; floor: number; cap?: number; orig?: Info };
      const info = items.map((k): Info => {
        const kc = ics(k);
        const b = kc('flex-basis');
        // ::before・::after は、幅の指定が長さか % なら、それ
        const fixedW = k.ps || k.anon ? kc('width') !== 'auto' && len(kc('width'), W) !== undefined : autoOf(k.el, 'width') === false;
        // flex-basis の min-content は中身の最も狭い幅、max-content・content は中身の幅 (下の見積もり)、fit-content は中身の幅を容器の幅で抑えたもの
        // (Flexbox 1 §7.2.3・CSS Sizing 3 §2.1)。枠・内側の余白を含む見積もりなので、内容の幅に直す
        const kwBasis = b === 'min-content' ? (k.anon ? measure(() => this.minTextWidth(k.text ?? '', k.el)) : k.ps ? measure(() => this.minTextWidth(k.text ?? '', k.el, k.ps)) : measure(() => this.minContentWidth(k.el, false))) : undefined;
        const basis = kwBasis !== undefined ? Math.max(0, kwBasis - (outer(k) - (cssLen(kc('margin-left')) ?? 0) - (cssLen(kc('margin-right')) ?? 0))) : b && b !== 'auto' && !/content$/.test(b) ? len(b, W) : /content$/.test(b) ? undefined : fixedW ? len(kc('width'), W) : undefined;
        const max = len(kc('max-width'), W);
        const inner = basis === undefined ? undefined : max !== undefined ? Math.min(basis, max) : basis;
        // flex-basis も width も無い項目は、中身の幅 (max-content) の見積もり。flex: 1 (basis 0) の項目は 0 から伸びる
        const est =
          inner === undefined
            ? Math.min(k.anon ? measure(() => this.textWidth((k.text ?? '').replace(CSS_WS, ' '), k.el)) : k.ps ? measure(() => this.pseudoMaxContentWidth(k.el, k.ps!, k.text ?? '')) : measure(() => this.maxContentWidth(k.el)), max ?? Infinity, W)
            : undefined;
        // 見積もりは枠・内側の余白を含むので、足すのは外側の余白だけ
        const margins = (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0);
        const shrink = parseFloat(kc('flex-shrink'));
        // 中身の幅で決まる項目にページ番号の引用 (target-counter(…, page)) があれば、番号の桁の数は組むまで分からないので、
        // 列の幅を組版エンジンに測らせる (LTableColumn.fitContent。ここの見積もりは、引用の字を数えていない)
        if (inner === undefined && hasPageCitation(k.node)) k.fit = true;
        const own: Info = {
          el: k,
          w: inner !== undefined ? inner + outer(k) : est !== undefined ? est + margins : undefined,
          grow: parseFloat(kc('flex-grow')) || 0,
          shrink: Number.isFinite(shrink) && shrink >= 0 ? shrink : 1,
          // 縮める比の基準 (flex の基準の大きさ) と、縮める下限 (min-width と、内容の幅以外の分)
          base: inner ?? est ?? 0,
          floor: minOf(k, kc, fixedW),
          // 伸ばす上限 (外側の幅。max-width が無ければ無し)
          cap: max !== undefined ? max + outer(k) : undefined,
        };
        // collapse の項目 (§4.4・§9.1 の 4): 行に分けるときも、伸ばし縮めるときも、主軸の大きさは 0。畳む前の組み (orig) は支柱に使う
        return k.collapse ? { el: k, w: 0, grow: 0, shrink: 0, base: 0, floor: 0, orig: own } : own;
      });
      /** 行に分ける (flex-wrap)。hidden (collapse の項目) は主軸の大きさも間の空きも 0 で、そこでは折り返さない (支柱は前の項目と同じ行に残る) */
      const split = (list: Info[], hidden: (it: Info) => boolean): Info[][] => {
        const out: Info[][] = [];
        let cur: Info[] = [];
        let used = 0;
        let shownBefore = false;
        for (const it of list) {
          const w = it.w ?? 0;
          const h = hidden(it);
          // 間の空きは、見える項目どうしの間にだけ数える
          const gap = !h && shownBefore ? colGap : 0;
          if (c('flex-wrap') !== 'nowrap' && !h && shownBefore && used + gap + w > W + 0.5) {
            out.push(cur);
            cur = [];
            used = w;
          } else used += gap + w;
          cur.push(it);
          if (!h) shownBefore = true;
        }
        if (cur.length) out.push(cur);
        return out;
      };
      /**
       * 行の項目の幅を決める (it.w を書き換える。返す値は間の空きの合計)。入りきらなければ縮め (Flexbox 1 §9.7): はみ出した分を
       * flex-shrink × 基準の大きさの比で分けて引く。下限 (min-width) に当たった項目はそこで止め、残りを他の項目で分ける。flex-shrink: 0 の項目は縮めない。
       * 伸ばす上限 (max-width) に当たる項目は、その幅で止め (固定の列)、残りの余りをほかの項目で分ける (§9.7 の凍結)。
       * 当たるかどうかは、読み込みのときの容器の幅 W で判定する
       */
      const resolveLine = (g: Info[], hidden: (it: Info) => boolean): number => {
        // 間の空き (column-gap) は、collapse でない項目の間にだけ置く
        const gaps = colGap * Math.max(g.filter((it) => !hidden(it)).length - 1, 0);
        let over = g.reduce((a, it) => a + (it.w ?? 0), 0) + gaps - W;
        const frozen = new Set<(typeof g)[number]>();
        for (let pass = 0; pass <= g.length && over > 0.01; pass++) {
          const act = g.filter((it) => it.w !== undefined && !frozen.has(it) && it.shrink > 0 && it.base > 0);
          const sum = act.reduce((a, it) => a + it.shrink * it.base, 0);
          if (!sum) break;
          let taken = 0;
          for (const it of act) {
            const want = it.w! - (over * it.shrink * it.base) / sum;
            const nw = Math.max(want, it.floor);
            if (want < it.floor) frozen.add(it);
            taken += it.w! - nw;
            it.w = nw;
          }
          over -= taken;
        }
        if (g.some((it) => it.grow > 0 && it.cap !== undefined)) {
          const frozen = new Set<(typeof g)[number]>();
          for (let pass = 0; pass <= g.length; pass++) {
            const act = g.filter((it) => it.grow > 0 && !frozen.has(it));
            const sumG = act.reduce((a, it) => a + it.grow, 0);
            const free = W - g.reduce((a, it) => a + (it.w ?? 0), 0) - gaps;
            if (!sumG || free <= 0) break;
            const hit = act.filter((it) => it.cap !== undefined && (it.w ?? 0) + (free * it.grow) / sumG > it.cap);
            if (!hit.length) break;
            for (const it of hit) {
              it.w = Math.max(it.w ?? 0, it.cap!);
              it.grow = 0;
              frozen.add(it);
            }
          }
        }
        return gaps;
      };
      const isCollapsed = (it: Info) => !!it.el.collapse;
      // collapse の項目の支柱 (§9.4 の 15 の後): 畳む前に入っていた行の交差軸の大きさ。畳む前の組み (項目を本来の大きさで並べた行) の
      // 同じ行の項目と、その幅を覚えておき、組版エンジンがその行を測るだけ組んだ高さを支柱にする (LBlock.phantom)
      const struts = new Map<Item, StrutLine>();
      if (info.some((it) => it.orig)) {
        for (const ga of split(info.map((it) => ({ ...(it.orig ?? it) })), () => false)) {
          const gaps = resolveLine(ga, () => false);
          // 余りは、伸ばす比で (幅の分からない項目があれば等分で) 分けた幅にする
          const free = Math.max(W - ga.reduce((a, it) => a + (it.w ?? 0), 0) - gaps, 0);
          const gs = ga.reduce((a, it) => a + it.grow, 0);
          const unk = ga.filter((it) => it.w === undefined).length;
          const line: StrutLine = ga.map((it) => ({ el: it.el, w: (it.w ?? 0) + (gs > 0 ? (free * it.grow) / Math.max(gs, 1) : unk && it.w === undefined ? free / unk : 0) }));
          for (const it of ga) if (it.el.collapse) struts.set(it.el, line);
        }
      }
      for (const g of split(info, isCollapsed)) {
        const shown = g.filter((it) => !isCollapsed(it)).length;
        resolveLine(g, isCollapsed);
        // 余り (容器の幅 − 項目の幅の合計) の分け方は、比例の列 (star) にして組版に任せる: 容器の幅がここで見た W と違っても
        // (余白 0 の 1 ページ目の全面の表紙など) 正しく分かれる。flex-grow の項目はその比で、幅の分からない項目は等分、
        // 伸びる項目が無ければ justify-content の空きの列で分ける
        const growSum = g.reduce((a, it) => a + it.grow, 0);
        const unknown = g.filter((it) => it.w === undefined);
        const stars = g.map((it) => (growSum > 0 ? it.grow : unknown.length && it.w === undefined ? 1 : 0));
        // 項目の margin-left / margin-right: auto は、伸びる項目が無ければ余りを吸い取る (Flexbox 1 §8.1。バーコードを右端に寄せるなど)
        // 列の並びは主軸の始めから。右から左の行 (rtl) では、物理の左の margin が終わりの側になる
        const autoM = g.map((it) => {
          if (it.el.collapse) return { l: false, r: false };
          const l = ics(it.el)('margin-left') === 'auto';
          const r = ics(it.el)('margin-right') === 'auto';
          return rtl ? { l: r, r: l } : { l, r };
        });
        const autoSpacers = growSum === 0 && unknown.length === 0 && autoM.some((a) => a.l || a.r);
        const spacers = growSum > 0 || unknown.length > 0 || autoSpacers;
        const n = shown;
        // justify-content の空き (比例): center は前後に 1、終わりへ寄せるなら前に 1、space-between は間に 1、space-around は間に 2・前後に 1、
        // space-evenly はすべて 1。項目が 1 つの space-between は flex-start と同じ (Flexbox 1 §8.2)。row-reverse の flex-start は右へ寄せる
        let jc = flexJustify(c('justify-content'), rowReverse, true, rtl);
        if (jc === 'space-between' && n < 2) jc = rowReverse ? 'end' : 'start';
        // flex-grow の合計が 1 未満なら、項目は余りのその割合だけ取り、残り (1 − 合計) は justify-content で分ける (Flexbox 1 §9.7 の 4)
        const rest = growSum > 0 && growSum < 1 && unknown.length === 0 ? 1 - growSum : 0;
        const leadU = jc === 'center' || jc === 'space-around' || jc === 'space-evenly' || jc === 'end' ? 1 : 0;
        let trailU = jc === 'center' || jc === 'space-around' || jc === 'space-evenly' ? 1 : 0;
        const betweenU = jc === 'space-between' ? 1 : jc === 'space-around' ? 2 : jc === 'space-evenly' ? 1 : 0;
        // 始めに寄せるときの残りは、終わりの側の空きにする
        if (rest && !leadU && !trailU && !betweenU) trailU = 1;
        const units = leadU + trailU + betweenU * (n - 1) || 1;
        const share = spacers ? (rest ? rest / units : 0) : 1;
        const lead = leadU * share;
        const trail = trailU * share;
        const between = betweenU * share;
        const line: Cell[] = [];
        if (lead) line.push({ w: 0, star: lead });
        let seen = 0;
        g.forEach((it, k) => {
          if (it.el.collapse) {
            line.push({ el: it.el, w: 0, strut: struts.get(it.el) });
            return;
          }
          if (seen++ > 0 && (colGap > 0.4 || between)) line.push({ w: colGap, ...(between ? { star: between } : {}) });
          if (autoSpacers && autoM[k].l) line.push({ w: 0, star: 1 });
          line.push({ el: it.el, w: it.w ?? 0, ...(stars[k] ? { star: stars[k] } : {}) });
          if (autoSpacers && autoM[k].r) line.push({ w: 0, star: 1 });
        });
        if (trail) line.push({ w: 0, star: trail });
        lines.push(line);
      }
    }
    // wrap-reverse: 行を下から上へ積む (最初の行がいちばん下。Flexbox 1 §5.2)
    if (crossReverse) lines.reverse();
    // 高さの決まった容器の行が 1 つなら、行の高さは容器の内側の高さ (1 行の容器 (nowrap) と、align-content: normal・stretch で
    // 伸ばした行。Flexbox 1 §9.4 の 15・§9.6 の 9)。項目の揃え・stretch・上下の margin: auto は、容器の高さの中で効く
    const pb = (n: string) => cssLen(c(n)) ?? 0;
    const innerH = fixed && cssLen(c('height')) !== undefined ? cssLen(c('height'))! - (c('box-sizing') === 'border-box' ? pb('padding-top') + pb('padding-bottom') + pb('border-top-width') + pb('border-bottom-width') : 0) : undefined;
    const ac0 = alignKeyword(c('align-content'));
    const fullLine = !isGrid && lines.length === 1 && innerH !== undefined && innerH > 0 && (c('flex-wrap') === 'nowrap' || ac0 === 'normal' || ac0 === 'stretch');
    // 高さの決まった複数行の容器の align-content: stretch (normal も同じ): 余った高さを行に等しく分ける (Flexbox 1 §8.4・§9.4 の 15)。
    // 行の表に伸ばす比 1 を付け、組版エンジンが行とセルを伸ばす
    const stretchLines = fixed && lines.length > 1 && (ac0 === 'normal' || ac0 === 'stretch');
    const children: LBlockLevel[] = [];
    if (rtl) for (const line of lines) if (!line.some((cell) => cell.star)) line.push({ w: 0, star: 1 });
    /** 項目のセル: 行の中の縦の揃え・伸ばしを付ける */
    const itemCell = (item: Item): LTableCell => {
      const n = item.node;
      delete (n as LBlock).width;
      // 行の中の縦の揃え (align-self、無ければ容器の align-items)。baseline は、同じ行の baseline の項目の最初の行の基線をそろえる
      // (Flexbox 1 §8.3。セルの vertical-align: baseline と同じ)。交差軸 (上下) の margin: auto は、揃えより先に空きを取る (§8.1)
      const ic = ics(item);
      const as = ic('align-self');
      const mt = ic('margin-top') === 'auto';
      const mb = ic('margin-bottom') === 'auto';
      const x = mt && mb ? 'center' : mt ? 'end' : mb ? 'start' : flexCross(as && as !== 'auto' ? as : c('align-items'), crossReverse);
      const blockAlign = x === 'center' || x === 'end' || x === 'baseline' || x === 'last-baseline' ? x : undefined;
      // stretch (既定): 項目を行の高さまで伸ばす (背景・枠が行いっぱいに広がる。表紙の帯など)
      // 交差軸の大きさ (高さ) の決まった項目は伸ばさない。max-height があれば、そこで止める (§8.3: 交差軸の大きさが auto の項目だけを伸ばす)
      const auto = item.ps || item.anon ? !/\d/.test(ic('height')) || ic('height') === 'auto' : autoOf(item.el, 'height') !== false;
      const stretch = x === 'stretch' && auto;
      const mh = stretch ? cssLen(ic('max-height')) : undefined;
      const stretchMax = mh === undefined ? undefined : mh + (ic('box-sizing') === 'border-box' ? 0 : (cssLen(ic('padding-top')) ?? 0) + (cssLen(ic('padding-bottom')) ?? 0) + (cssLen(ic('border-top-width')) ?? 0) + (cssLen(ic('border-bottom-width')) ?? 0));
      return { type: 'table-cell', keepEdgeSpace: true, ...(blockAlign ? { blockAlign } : {}), ...(stretch ? { stretchContent: true } : {}), ...(stretchMax !== undefined ? { stretchMax } : {}), children: [n] };
    };
    /** 支柱のもとの行 → 畳む前の行を組んだ表 (測るだけ組む。基線の揃えで行が高くなる分も入る。Flexbox 1 §9.4 の 8) */
    const strutTables = new Map<StrutLine, { table: LTable; total: number }>();
    const strutTable = (sl: StrutLine) => {
      let t = strutTables.get(sl);
      if (!t) {
        const table = { type: 'table', columns: sl.map((x) => ({ type: 'table-column', width: Math.max(x.w, 0) })), body: { type: 'table-body', rows: [{ type: 'table-row', cells: sl.map((x) => itemCell(x.el)) }] } } as LTable;
        strutTables.set(sl, (t = { table, total: sl.reduce((a, x) => a + Math.max(x.w, 0), 0) }));
      }
      return t;
    };
    lines.forEach((line, k) => {
      const columns: LTableColumn[] = line.map((cell) => (cell.star ? { type: 'table-column', width: `${cell.star}*`, ...(cell.w ? { widthExtra: cell.w } : {}) } : { type: 'table-column', width: Math.max(cell.w, 0), ...(cell.el?.fit ? { fitContent: true } : {}) }));
      const cells: LTableCell[] = line.map((cell) => {
        if (!cell.el) return { type: 'table-cell', children: [] };
        // collapse の項目の支柱: 幅 0 の列の中に、畳む前の行の高さの空の箱を置く (phantom。中身は描かない。伸ばさず、揃えない)。
        // 測る行の長さは主軸の向き (縦書きの容器では高さ)
        if (cell.strut) {
          // 中の id は、リンク・target-counter() の飛び先として残す (LBlock.phantomIds)
          const ids = collectIds(cell.el.node);
          const { table, total } = strutTable(cell.strut);
          return { type: 'table-cell', keepEdgeSpace: true, children: [{ type: 'block', phantom: true, [L('width')]: total, ...(ids.length ? { phantomIds: ids } : {}), children: [table] } as LBlock] };
        }
        return itemCell(cell.el);
      });
      this.report.counts.tables++;
      children.push({ type: 'table', columns, ...(stretchLines ? { flexGrow: 1 } : {}), ...(k > 0 && rowGap > 0 ? { margin: { top: rowGap } } : {}), body: { type: 'table-body', rows: [{ type: 'table-row', ...(fullLine ? { minHeight: innerH } : {}), cells }] } } as LTable);
    });
    this.report.counts.blocks++;
    // 高さの決まった容器の行の揃え: 複数行 (flex-wrap の複数行と grid) は align-content、1 行だけなら行の高さは容器いっぱいなので
    // align-items (center・flex-end で項目を上下の中央・下端に。章扉の見出しを縦の中央に置くなど。Flexbox 1 §9.4)。
    // wrap-reverse は交差軸が下から上なので、flex-start は下端に寄せる (stretch・normal は stretchLines で行を伸ばす)
    const ac = alignKeyword(c('align-content'));
    const ai = flexCross(c('align-items'), crossReverse);
    const acx = /^space-(between|around|evenly)$/.test(ac) ? (ac as 'space-between' | 'space-around' | 'space-evenly') : flexCross(ac, crossReverse);
    // 折り返しの容器 (flex-wrap: wrap・wrap-reverse) は複数行の容器なので、行が 1 つでも align-content で揃える (§8.4)
    const multiLine = lines.length > 1 || (!isGrid && c('flex-wrap') !== 'nowrap' && innerH !== undefined);
    const blockAlign: LBlockContainer['blockAlign'] = !fixed || fullLine
      ? undefined
      : multiLine
        ? acx === 'center' || acx === 'end' || /^space-/.test(acx)
          ? (acx as 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly')
          : undefined
        : ai === 'center' || ai === 'end' || ai === 'last-baseline'
          ? ai === 'last-baseline' ? 'end' : ai
          : undefined;
    return { type: fixed ? 'block-container' : 'block', ...this.textStyle(el, parent), ...this.paragraphStyle(el, parent), ...this.boxStyle(el), ...(blockAlign ? { blockAlign } : {}), children: [...extra, ...children] } as LBlock;
  }

  /** ::before・::after に content がある (none・normal でない) か */
  private hasPseudoContent(el: Element, which: '::before' | '::after'): boolean {
    const v = this.pagedPseudo.get(el)?.[which]?.content ?? this.cs(el, which)('content');
    return !!v && v !== 'none' && v !== 'normal';
  }

  /**
   * flex・grid の容器の項目の元 (文書の順): 子の要素と、中身のある ::before・::after (Flexbox 1 §4。疑似要素も項目になる)。
   * display: contents の子は自分の箱を作らないので、その子と疑似要素が項目になる (CSS Display 3 §2.5)。display: none は除く。
   * display: contents の子の直下に文字があれば (無名の項目は扱わない) undefined
   */
  private flexItemSources(el: Element): Array<{ el: Element; ps?: '::before' | '::after'; text?: string; collapse?: boolean }> | undefined {
    const out: Array<{ el: Element; ps?: '::before' | '::after'; text?: string; collapse?: boolean }> = [];
    const walk = (e: Element): boolean => {
      if (this.hasPseudoContent(e, '::before')) out.push({ el: e, ps: '::before' });
      // 続いた文字の並び (空白だけのものは除く) は、無名の項目 (Flexbox 1 §4)。el は文字の持ち主 (display: contents の子の中ならその要素)
      let run = '';
      const flush = () => {
        if (run.trim()) out.push({ el: e, text: run });
        run = '';
      };
      for (const n of Array.from(e.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) {
          run += n.textContent ?? '';
          continue;
        }
        if (n.nodeType !== 1) continue;
        const k = n as Element;
        const d = this.display(k);
        if (d === 'none') continue;
        flush();
        if (d === 'contents') {
          if (!walk(k)) return false;
        } else out.push({ el: k, ...(this.cs(k)('visibility') === 'collapse' ? { collapse: true } : {}) });
      }
      flush();
      if (this.hasPseudoContent(e, '::after')) out.push({ el: e, ps: '::after' });
      return true;
    };
    return walk(el) ? out : undefined;
  }

  /** 無名の flex の項目の計算値: 受け継がない性質は初期値 (余白・枠・幅は無し。CSS Display 3 §2.6・Flexbox 1 §4) */
  private static readonly ANON_ITEM: Record<string, string> = {
    'flex-grow': '0',
    'flex-shrink': '1',
    'flex-basis': 'auto',
    width: 'auto',
    'min-width': 'auto',
    'max-width': 'none',
    'align-self': 'auto',
    order: '0',
    'box-sizing': 'content-box',
    position: 'static',
    'grid-column-start': 'auto',
    'grid-column-end': 'auto',
  };

  /**
   * flex・grid の項目になる ::before・::after を組む。中身はブロックにし、箱の書式 (余白・枠・背景) を付ける (項目はブロック化される。
   * Flexbox 1 §4)。絶対配置なら項目にせず positioned に返す。text: 中身の文字 (幅の見積もりに使う)
   */
  private flexPseudo(el: Element, which: '::before' | '::after'): { node?: LBlockLevel; positioned?: LBlockLevel; text?: string } {
    const tmp: FlowItem[] = [];
    this.lastPseudoText[which] = '';
    this.pseudo(el, which, tmp);
    const text = this.lastPseudoText[which];
    if (!tmp.length) return {};
    const pos = this.cs(el, which)('position');
    if (pos === 'absolute' || pos === 'fixed') return { positioned: tmp[0].v as LBlockLevel };
    if (tmp.length === 1 && tmp[0].block) return { node: tmp[0].v as LBlockLevel, text };
    return { node: { type: 'block', ...this.textStyle(el, el, which), ...this.boxStyle(el, which), children: tmp.map((x) => x.v) } as LBlock, text };
  }

  /** ::before・::after の中身の幅 (max-content) の見積もり (pt): 幅の指定があればそれ、無ければ中身の文字の幅。枠・内側の余白を含む */
  /** 縦書きの flex の容器の見積もりの間 (axisMap があるとき) は、プロパティの名前を読み替えて読む (axisMapper) */
  private csA(el: Element, pseudo?: PseudoSel): (n: string) => string {
    const c = this.cs(el, pseudo);
    const m = this.axisMap;
    return m ? (n) => c(m(n)) : c;
  }
  private isAutoA(el: Element, p: 'width' | 'height'): boolean | undefined {
    return this.src.isAuto?.(el, (this.axisMap ? this.axisMap(p) : p) as 'width' | 'height');
  }

  /**
   * 縦書きの flex の容器の行の向きの大きさ (内容の高さ。pt): 高さが決まっていればそれ。決まらなければ、親の行の向きの大きさから余白・枠・内側の余白を
   * 引いたもの (縦書きの親)。根元か、横書きの親の中 (直交する流れ。CSS Writing Modes 4 §7.3) なら、本文の領域の高さから引く
   */
  private verticalInlineSize(el: Element): number {
    let used = 0;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = this.cs(e);
      const p = (n: string) => cssLen(c(n)) ?? 0;
      const pad = p('padding-top') + p('padding-bottom') + p('border-top-width') + p('border-bottom-width');
      if (this.src.isAuto?.(e, 'height') === false && cssLen(c('height')) !== undefined) return Math.max(0, cssLen(c('height'))! - (c('box-sizing') === 'border-box' ? pad : 0) - used);
      // 高さの決まらない箱: 内容の高さは、親の内容の高さからこの箱の上下の余白・枠・内側の余白を引いたもの
      used += pad + p('margin-top') + p('margin-bottom');
      const parent = e.parentElement;
      if (!parent || !/^(vertical|sideways|tb)/.test(this.cs(parent)('writing-mode'))) break;
    }
    return Math.max(0, this.area.height - used);
  }

  private pseudoMaxContentWidth(el: Element, which: '::before' | '::after', text: string): number {
    const c = this.csA(el, which);
    const p = (n: string) => cssLen(c(n)) ?? 0;
    const pad = p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
    const w = c('width') !== 'auto' ? cssLen(c('width')) : undefined;
    if (w !== undefined) return w + (c('box-sizing') === 'border-box' ? 0 : pad);
    return this.textWidth(text.replace(CSS_WS, ' '), el, which) + pad;
  }

  /**
   * 文字の最も狭い幅 (min-content。CSS Sizing 3 §5.1) の見積もり (pt): 改行できる所で全部改行したときの、いちばん広い塊の幅。
   * 欧文は空白で区切った語、和文 (CJK) は 1 字ずつ (字の間で改行できる。CSS Text 3 §5.1 の近似)。改行しない (nowrap・pre) なら行ごと
   */
  private minTextWidth(t: string, el: Element, pseudo?: '::before' | '::after'): number {
    const ws = this.csA(el, pseudo)('white-space');
    const nowrap = /^(nowrap|pre)$/.test(ws);
    const chunks = nowrap ? t.split('\n') : t.split(/[ \t\n\r\f]+|(?<=[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef])|(?=[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef])/u);
    return chunks.reduce((m, w) => Math.max(m, w ? this.textWidth(this.transformText(w, el), el, pseudo) : 0), 0);
  }

  /**
   * 要素の中身の最も狭い幅 (min-content) の見積もり (pt。枠・内側の余白を含む)。flex の項目の自動の最小の大きさ (Flexbox 1 §4.5) に使う。
   * 幅の指定があれば、それ (ownWidth: false なら、自分の幅の指定は見ずに中身を測る。自動の最小の大きさの「中身の大きさ」)。
   * 画像は置かれる幅。中のブロックは、いちばん広いもの。表は max-content と同じに数える (近似)
   */
  private minContentWidth(el: Element, ownWidth = true): number {
    const c = this.csA(el);
    const p = (n: string) => cssLen(c(n)) ?? 0;
    const pad = p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
    if (ownWidth && this.isAutoA(el, 'width') === false && cssLen(c('width')) !== undefined) return cssLen(c('width'))! + (c('box-sizing') === 'border-box' ? 0 : pad);
    if (el.localName === 'img' || /^(inline-)?table$/.test(this.display(el))) return ownWidth ? this.maxContentWidth(el) : pad;
    let widest = 0;
    const walk = (k: Element) => {
      for (const n of Array.from(k.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) widest = Math.max(widest, this.minTextWidth(n.textContent ?? '', k));
        else if (n.nodeType === 1) {
          const e = n as Element;
          const d = this.display(e);
          if (d === 'none' || /^(absolute|fixed)$/.test(this.csA(e)('position'))) continue;
          if (this.isBlock(d, e) || e.localName === 'img') {
            const ec = this.csA(e);
            widest = Math.max(widest, this.minContentWidth(e) + (this.isBlock(d, e) ? (cssLen(ec('margin-left')) ?? 0) + (cssLen(ec('margin-right')) ?? 0) : 0));
          } else walk(e);
        }
      }
    };
    walk(el);
    return widest + pad;
  }

  /**
   * 要素の中身の幅 (max-content) の見積もり (pt)。字を測れないので、いちばん長い行の字数 × 字の大きさ (欧文は 0.55 倍) で近似する。
   * 改行を残す (pre・pre-line) なら行ごと、画像は width 属性・指定の幅
   */
  private maxContentWidth(el: Element): number {
    const c = this.csA(el);
    const p = (n: string) => cssLen(c(n)) ?? 0;
    const pad = p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
    // 幅の指定があれば、それ
    if (this.isAutoA(el, 'width') === false && cssLen(c('width')) !== undefined) return cssLen(c('width'))! + (c('box-sizing') === 'border-box' ? 0 : pad);
    if (el.localName === 'img') {
      const w = cssLen(c('width')) ?? (parseFloat(el.getAttribute('width') ?? '') || 0) * PT_PER_PX;
      if (w) return w + pad;
      // 幅の指定が無ければ、本来の大きさに上限・下限を当てた幅
      const nat = this.opts.imageSize?.(normalizeSrc(el.getAttribute('data-kumiori-src') ?? el.getAttribute('src') ?? ''));
      if (!nat) return pad;
      const lim = (n: string, def: number) => {
        const v = cssLen(c(n));
        return v === undefined ? def : v / PT_PER_PX;
      };
      const [cw] = constrainReplaced(nat.width, nat.height, lim('min-width', 0), lim('max-width', Infinity), lim('min-height', 0), lim('max-height', Infinity));
      return cw * PT_PER_PX + pad;
    }
    if (/^(inline-)?table$/.test(this.display(el))) return this.tableMaxContentWidth(el);
    const pre = /^pre/.test(c('white-space'));
    // 中のブロックは、いちばん広いもの。続く文字と行内の要素は、1 行につなげた幅 (改行を残すなら行ごと)
    let widest = 0;
    let line = 0;
    const end = () => {
      widest = Math.max(widest, line);
      line = 0;
    };
    const text = (t: string, owner: Element) => {
      const parts = pre ? t.split('\n') : [t.replace(CSS_WS, ' ')];
      parts.forEach((part, k) => {
        if (k > 0) end();
        line += this.textWidth(this.transformText(part, owner), owner);
      });
    };
    // 行内の要素は、それぞれの書体・字の大きさで測る (中の要素もたどる)
    const inline = (k: Element) => {
      for (const n of Array.from(k.childNodes)) {
        if (n.nodeType === 3) text(n.textContent ?? '', k);
        else if (n.nodeType === 1) {
          const e = n as Element;
          if (this.display(e) === 'none') continue;
          if (e.localName === 'img') line += this.maxContentWidth(e);
          else if (e.localName === 'br') end();
          else inline(e);
        }
      }
    };
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) text(n.textContent ?? '', el);
      else if (n.nodeType === 1) {
        const k = n as Element;
        const d = this.display(k);
        if (d === 'none' || /^(absolute|fixed)$/.test(this.csA(k)('position'))) continue;
        if (this.isBlock(d, k)) {
          end();
          const kc = this.csA(k);
          widest = Math.max(widest, this.maxContentWidth(k) + (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0));
        } else if (k.localName === 'img') line += this.maxContentWidth(k);
        else if (k.localName === 'br') end();
        else inline(k);
      }
    }
    end();
    return widest + pad;
  }

  /**
   * 表の中身の幅 (max-content) の見積もり (pt。CSS 2.1 §17.5.2 の自動の配置): 列ごとにセルの max-content のいちばん広いものを取り、
   * 列を足す。列をまたぐセルは、足りない分を列に等分する。border-spacing (separate) と表の枠・内側の余白を足す。
   * border-collapse: collapse では、セルの左右の枠は隣と分け合うので半分ずつ数え、表の枠と内側の余白は数えない。
   * 見出し (caption) は、それより広ければその幅
   */
  private tableMaxContentWidth(el: Element): number {
    const c = this.csA(el);
    const p = (n: string) => cssLen(c(n)) ?? 0;
    const collapse = c('border-collapse') === 'collapse';
    const spacing = collapse ? 0 : (cssLen((c('border-spacing') || '0').trim().split(/\s+/)[0]) ?? 0);
    const rows: Element[] = [];
    let caption = 0;
    for (const k of Array.from(el.children)) {
      const d = this.display(k);
      if (d === 'table-row') rows.push(k);
      else if (/^table-(header|footer|row)-group$/.test(d)) rows.push(...Array.from(k.children).filter((r) => this.display(r) === 'table-row'));
      else if (d === 'table-caption') caption = Math.max(caption, this.maxContentWidth(k));
    }
    const cols: number[] = [];
    const spans: Array<[number, number, number]> = [];
    // 上の行から下へ伸びるセル (rowspan) が占める列
    const taken: number[] = [];
    for (const r of rows) {
      let col = 0;
      for (const cell of Array.from(r.children)) {
        if (this.display(cell) !== 'table-cell') continue;
        while ((taken[col] ?? 0) > 0) col++;
        const kc = this.csA(cell);
        let w = this.maxContentWidth(cell);
        if (collapse) w -= ((cssLen(kc('border-left-width')) ?? 0) + (cssLen(kc('border-right-width')) ?? 0)) / 2;
        const span = Math.min(MAX_COL_SPAN, Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
        const rs = Math.min(MAX_ROW_SPAN, Math.max(1, parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1));
        if (span === 1) cols[col] = Math.max(cols[col] ?? 0, w);
        else spans.push([col, span, w]);
        for (let k = 0; k < span; k++) taken[col + k] = Math.max(taken[col + k] ?? 0, rs);
        col += span;
      }
      for (let k = 0; k < taken.length; k++) if (taken[k] > 0) taken[k]--;
    }
    for (const [start, span, w] of spans) {
      let have = spacing * (span - 1);
      for (let k = start; k < start + span; k++) have += cols[k] ?? 0;
      if (w > have) for (let k = start; k < start + span; k++) cols[k] = (cols[k] ?? 0) + (w - have) / span;
    }
    const n = cols.length;
    const sum = Array.from({ length: n }, (_, k) => cols[k] ?? 0).reduce((a, b) => a + b, 0);
    const frame = collapse ? 0 : p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
    const grid = n ? sum + spacing * (n + 1) : 0;
    return Math.max(grid, caption) + frame;
  }

  /** 1 行の文字列の幅 (pt)。measureText があれば要素の書体・字の大きさ・太さ・字間で測り、無ければ字数 × 字の大きさ (欧文は 0.55 倍) */
  private textWidth(t: string, el: Element, pseudo?: '::before' | '::after'): number {
    // 前後の空白は、詰める空白だけを取る (全角の空白 U+3000 は字として数える)
    const s = t.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
    if (!s) return 0;
    const c = this.cs(el, pseudo);
    const fs = cssLen(c('font-size')) ?? 12;
    const ls = cssLen(c('letter-spacing')) ?? 0;
    if (!this.opts.measureText) return [...s].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0) * fs + ls * [...s].length;
    const weight = parseInt(c('font-weight'), 10) || 400;
    const names = c('font-family')
      .split(',')
      .map((n) => n.replace(/['"]/g, '').trim())
      .filter(Boolean);
    const fontFamily = this.opts.mapFont?.(names, weight >= 600, this.langOf(el));
    return this.opts.measureText(s, { fontFamily, fontWeight: weight, fontSize: fs }) + ls * [...s].length;
  }

  /** 段組 (column-count・column-width・column-gap・column-rule)。avail: 段組する幅 (pt) */
  private columnsOf(el: Element, avail: number): ({ count: number; gap: number; rule?: BorderSide; fill: 'balance' | 'auto' } & Pick<NonNullable<LBlockContainer['columns']>, 'ruleDisplay' | 'ruleLength' | 'ruleAlign' | 'discardEndMargin' | 'discardStartMargin'>) | undefined {
    const c = this.cs(el);
    let count = parseInt(c('column-count'), 10) || 0;
    const width = cssLen(c('column-width'));
    const g = c('column-gap');
    // % は段組する幅に対する割合 (CSS Box Alignment 3 §8.1)
    const gap = g && g !== 'normal' ? (/%$/.test(g.trim()) ? (parseFloat(g) * avail) / 100 : (cssLen(g) ?? 0)) : (cssLen(c('font-size')) ?? 12);
    if (width) {
      const byWidth = Math.max(1, Math.floor((avail + gap) / (width + gap)));
      count = count ? Math.min(count, byWidth) : byWidth;
    }
    if (count <= 1) return undefined;
    const out: NonNullable<ReturnType<typeof this.columnsOf>> = { count, gap, fill: c('column-fill') === 'auto' ? 'auto' : 'balance' };
    if (this.opts.columnsDiscardEndMargin) out.discardEndMargin = true;
    if (this.opts.columnsDiscardStartMargin) out.discardStartMargin = true;
    const rs = c('column-rule-style');
    const rw = cssLen(c('column-rule-width')) ?? 0;
    if (rs && rs !== 'none' && rs !== 'hidden' && rw > 0)
      out.rule = { width: rw, color: cssColor(c('column-rule-color')) ?? '#000000', ...(rs !== 'solid' ? { style: rs as BorderSide['style'], symmetric: true } : {}) };
    // アンテナハウスの段間罫の拡張: 長さ (百分率は段の高さに対する割合)・段の中の位置・引く所
    const pg = this.pg(el);
    const rl = pg['-ah-column-rule-length']?.trim().toLowerCase();
    if (rl && rl !== 'auto') {
      const pm = /^([\d.]+)%$/.exec(rl);
      const len = pm ? undefined : lenEm(rl, cssLen(c('font-size')) ?? 12);
      if (pm) out.ruleLength = { pct: parseFloat(pm[1]) / 100 };
      else if (len !== undefined) out.ruleLength = { len };
    }
    const ra = pg['-ah-column-rule-align']?.trim().toLowerCase();
    if (ra === 'before' || ra === 'after' || ra === 'center') out.ruleAlign = ra;
    const rd = pg['-ah-column-rule-display']?.trim().toLowerCase();
    if (rd === 'all' || rd === 'end' || rd === 'gap') out.ruleDisplay = rd;
    return out;
  }

  /**
   * 要素が段組の文脈の中にあるか: 祖先に段組の容器 (column-count か column-width が auto でない要素。CSS Multi-column 1 §2) があるか、
   * ページを段に組む (body・html の段組)
   */
  private inMulticol(el: Element): boolean {
    if (this.pageColumns) return true;
    for (let e = el.parentNode as Element | null; e && e.nodeType === 1; e = e.parentNode as Element | null) {
      const c = this.cs(e);
      const cc = c('column-count');
      const cw = c('column-width');
      if ((cc && cc !== 'auto') || (cw && cw !== 'auto')) return true;
    }
    return false;
  }

  /** float (left / right / inside / outside / top) → LFloat */
  private float(e: Element, parent: Element, fl: string, sidenote = false): LFloat {
    this.report.counts.floats++;
    const rtl = this.cs(e)('direction') === 'rtl';
    // top・bottom は、包含ブロックの書字方向で block-start / block-end か inline-start / inline-end になる (CSS Page Floats 3 §3.2)。
    // 縦書きでは物理の上下は行の頭・行末なので inline-start / inline-end。float-reference の初期値 inline では、行の箱を基準にした
    // 行内の float になり、本文は回り込む。横書きは従来どおり段の上下に置く
    // 組版エンジンの start / end は物理の向き (縦書きでは上 / 下) なので、left / right と同じに読み替える
    if ((fl === 'top' || fl === 'bottom') && this.wm(this.cs(parent)('writing-mode'))?.startsWith('vertical')) fl = fl === 'top' ? 'left' : 'right';
    // 組版エンジンの start / end は左 / 右 (横書き)。CSS の start / end は書く向きによるので、右から左へ書く段落では入れ替える
    const side: LFloat['float'] =
      fl === 'left'
        ? 'start'
        : fl === 'right'
          ? 'end'
          : fl === 'start'
            ? rtl
              ? 'end'
              : 'start'
            : fl === 'end'
              ? rtl
                ? 'start'
                : 'end'
              : fl === 'bottom'
                ? 'after'
                : fl === 'top'
                  ? 'before'
                  : (fl as LFloat['float']);
    const d = this.display(e);
    const inner = (d === 'table' || this.isBlock(d, e) ? this.block(e, parent) : ({ type: 'block', ...this.textStyle(e, parent), ...this.paragraphStyle(e, parent), ...this.boxStyle(e), children: this.flowChildren(e, true) } as LBlock)) as LBlock;
    // (float はブロックの箱になるので、行内の要素から作るときも text-indent などの段落の書式を渡す。渡さないと
    // span.sidenote { text-indent: 0 } のような指定が効かず、本文の字下げを受け継いでしまう)
    // 置き換え要素 (画像など) の float は行の箱を持たないので、受け継いだ text-indent を掛けない
    if (/^(img|svg|object|video|canvas|embed|iframe)$/.test(e.localName) && inner.type === 'block') inner.textIndent = 0;
    // 左右・綴じ側・小口側の float は、CSS の置き方 (包含ブロックの内容の端に置く。CSS 2.1 §9.5.1)。inside・outside は組むページの
    // 偶奇で左右に読み替える (float: sidenote を outside の側に置くときも、箱の内側の余白の内に置く)
    const f: LFloat = { type: 'float', float: side, children: [inner], ...(side === 'start' || side === 'end' || side === 'inside' || side === 'outside' ? { cssPlacement: true } : {}) };
    // 箱の寸法・余白・枠・背景は float に移す (外側の余白は本文との間隔、幅は回り込みの幅になる)
    for (const k of ['margin', 'padding', 'border', 'backgroundColor', 'backgroundImage', 'borderRadius', 'boxShadow', 'width', 'height', 'boxSizing', 'clear'] as const) {
      if (inner[k] === undefined) continue;
      (f as unknown as Record<string, unknown>)[k] = inner[k];
      delete inner[k];
    }
    // -ah-display-align: 高さの決まった float は、中身を float の箱の中の上下の中央・末尾に寄せる (float は block-container として組む)
    const da = this.displayAlignOf(e);
    if (da && f.height !== undefined) f.blockAlign = da;
    // float: sidenote の幅が auto なら、@page の @sidenote の width (% は包含ブロックの幅に対する割合。アンテナハウスの拡張)
    if (f.width === undefined && sidenote) {
      const wv = (resolvePageRules(this.pageRules, {}).boxes.sidenote?.width ?? '').trim();
      const cbPx = this.src.contentWidth?.(parent);
      const cb = cbPx !== undefined ? cbPx * PT_PER_PX : undefined;
      const w = /%$/.test(wv) ? (cb !== undefined ? (cb * parseFloat(wv)) / 100 : undefined) : cssLen(wv);
      // @sidenote の width はサイドノートの領域の幅。サイドノートの箱 (内側の余白・罫線を含む) をその幅に収めるので、
      // 内容の幅は、そこから左右の内側の余白と罫線を引いたもの (width: 20% なら、padding: 0 0.5em の箱の外の幅が 20%)
      const pad = (f.padding ?? {}) as Record<string, number>;
      const bd = (f.border ?? {}) as Record<string, { width: number } | undefined>;
      const hb = (pad.left ?? 0) + (pad.right ?? 0) + (bd.left?.width ?? 0) + (bd.right?.width ?? 0);
      if (w !== undefined && w > hb) f.width = w - hb;
    }
    // min-width・max-width (CSS 2.1 §10.4)。内容の幅に直す。幅の指定があれば、ここで抑える (下限が勝つ)
    if (f.cssPlacement) {
      const c = this.cs(e);
      const pad = (f.padding ?? {}) as Record<string, number>;
      const bd = (f.border ?? {}) as Record<string, { width: number } | undefined>;
      const hb = (pad.left ?? 0) + (pad.right ?? 0) + (bd.left?.width ?? 0) + (bd.right?.width ?? 0);
      const lim = (p: string) => {
        const v = /px$/.test(c(p)) ? cssLen(c(p)) : undefined;
        return v === undefined ? undefined : Math.max(0, v - (c('box-sizing') === 'border-box' ? hb : 0));
      };
      const mx = lim('max-width');
      const mn = lim('min-width');
      if (typeof f.width === 'number') {
        const bb = f.boxSizing === 'border-box' ? hb : 0;
        let w = f.width - bb;
        if (mx !== undefined) w = Math.min(w, mx);
        if (mn !== undefined) w = Math.max(w, mn);
        f.width = w + bb;
      } else {
        if (mx !== undefined) f.maxWidth = mx;
        if (mn !== undefined && mn > 0) f.minWidth = mn;
      }
    }
    return f;
  }

  /** 位置の基準になる祖先 (position が static でない。html・body は除く) */
  private positionedAncestor(e: Element): Element | undefined {
    for (let p = e.parentElement; p && p !== this.bodyEl && p.localName !== 'html'; p = p.parentElement) if (this.cs(p)('position') !== 'static' && this.cs(p)('position')) return p;
    return undefined;
  }

  /**
   * そのまま 1 つのブロック (LBlock) に組む要素か (表・flex・grid・回り込み・段組・置換要素・縦書きでない、display: block の要素)。
   * 絶対配置の基準になる祖先と、その間の要素を調べる
   */
  private plainBlock(p: Element): boolean {
    const c = this.cs(p);
    if (!/^(block|flow-root)$/.test(c('display')) || (c('float') || 'none') !== 'none' || /^(img|svg|object|math|table)$/.test(p.localName)) return false;
    if (/vertical|sideways/.test(c('writing-mode'))) return false;
    if ((c('column-count') && c('column-count') !== 'auto') || (c('column-width') && c('column-width') !== 'auto')) return false;
    const pg = this.pg(p);
    return !pg.float && !/running\(/.test(pg.position ?? '');
  }

  /**
   * position: absolute の箱の基準 (containing block) にする祖先 (CSS 2.1 §10.1): start から上へ、position が static でない、いちばん近い祖先。
   * Kumiori が祖先の箱を基準に置けるもの (祖先は position: relative・sticky のそのまま組むブロックか、絶対配置の箱。
   * 間の要素も、そのまま組むブロック) だけを返す。それ以外は undefined (本文領域を基準にする)
   */
  private localCb(start: Element | null): Element | undefined {
    for (let p = start; p && p !== this.bodyEl && p.localName !== 'html'; p = p.parentElement) {
      const pos = this.cs(p)('position');
      if (pos && pos !== 'static') {
        if (/^(relative|sticky)$/.test(pos)) return this.plainBlock(p) ? p : undefined;
        if (/^(absolute|fixed)$/.test(pos)) return p.localName !== 'img' && !/vertical|sideways/.test(this.cs(p)('writing-mode')) ? p : undefined;
        return undefined;
      }
      if (!this.plainBlock(p)) return undefined;
    }
    return undefined;
  }

  /** 絶対配置の箱の位置 (left・top・right・bottom) を、基準の祖先 cb の内容の箱からの距離にする (CSS の基準は padding の箱なので、padding を引く) */
  private placeInCb(cont: LBlockContainer, cb: Element, off: { top?: number; right?: number; bottom?: number; left?: number }) {
    const pc = this.cs(cb);
    const pad = (side: string) => cssLen(pc(`padding-${side}`)) ?? 0;
    cont.positionInContainer = true;
    if (off.left !== undefined) cont.left = off.left - pad('left');
    if (off.right !== undefined && (off.left === undefined || cont.width === undefined)) cont.right = off.right - pad('right');
    if (off.top !== undefined) cont.top = off.top - pad('top');
    if (off.bottom !== undefined && (off.top === undefined || cont.height === undefined)) cont.bottom = off.bottom - pad('bottom');
  }

  /** position: absolute / fixed → 絶対配置の箱 (基準の祖先 (localCb) の箱、無ければ本文領域を基準にする) */
  private positioned(e: Element, parent: Element): LBlockContainer {
    const c = this.cs(e);
    const off = (p: 'top' | 'right' | 'bottom' | 'left') => (this.src.isAuto?.(e, p) === false ? cssLen(c(p)) : undefined);
    const box = this.boxStyle(e);
    // 余白 (margin) は、位置の指定 (top・left など) に足す (CSS 2.1 §10.3.7・§10.6.4: 絶対配置の箱の margin は基準からの距離に加わる)。
    // top も bottom も無ければ、static position を margin-top だけ下げる
    const mg = (box.margin ?? {}) as Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
    delete box.margin;
    delete box.breakBefore;
    delete box.breakAfter;
    // 画像 (<img>) は、画像そのものを箱の大きさで置く (object-fit も)
    const src = e.localName === 'img' ? (e.getAttribute('data-kumiori-src') ?? e.getAttribute('src')) : null;
    const cont: LBlockContainer = {
      type: 'block-container',
      absolutePosition: true,
      ...this.textStyle(e, parent),
      ...this.paragraphStyle(e, parent),
      ...(box as Omit<LBlockContainer, 'type' | 'children'>),
      // 表 (<table>) は表として組む (中身の幅で列を配る自動レイアウト。flowChildren では行の塊になる)
      children: src ? [this.image(e, src)] : e.localName === 'table' ? [this.table(e, parent)] : this.flowChildren(e),
    };
    // z-index が負の箱は、本文の背面に置く
    if ((parseInt(c('z-index'), 10) || 0) < 0) cont.layer = 'behind';
    const add = (v: number | undefined, m: number | undefined) => (v === undefined ? undefined : v + (m ?? 0));
    const [top, right, bottom, left] = [add(off('top'), mg.top), add(off('right'), mg.right), add(off('bottom'), mg.bottom), add(off('left'), mg.left)];
    if (top === undefined && bottom === undefined && mg.top) cont.staticOffset = mg.top;
    // 左右の位置の指定が無ければ、static position (基準の左端) から margin-left だけずらす (table#total { margin: 0 -3cm } など)
    const staticI = left === undefined && right === undefined ? (mg.left ?? 0) : 0;
    // 幅は、ブラウザが決めた幅。指定が無ければ中身に合わせた幅 (shrink-to-fit。CSS 2.1 §10.3.7)
    if (cont.width === undefined) {
      const w = cssLen(c('width'));
      if (w) cont.width = w;
      else cont.shrinkToFit = true;
    }
    // 絶対配置の表 (table#total { position: absolute; width: 18cm; border-width: 2cm 3cm } など): CSS の表の width は罫線を含む幅
    // (CSS 2.1 §17.4 の表の箱。ブラウザ・WeasyPrint と同じ) なので、箱は border-box にし、中の表はその内側いっぱいに広げる
    if (e.localName === 'table' && cont.width !== undefined) {
      cont.boxSizing = 'border-box';
      const side = (sd: 'left' | 'right') => {
        const b = box.border;
        const bw = !b ? 0 : 'width' in b ? (b as BorderSide).width : ((b as Partial<Record<'left' | 'right', BorderSide>>)[sd]?.width ?? 0);
        const p = box.padding;
        const pw = p === undefined ? 0 : typeof p === 'number' ? p : (p[sd] ?? 0);
        return bw + pw;
      };
      // 罫線を重ねる表 (border-collapse: collapse): 表の幅は罫線の半分だけを含み、残りの半分は表の外へ出る (CSS 2.1 §17.6.2)。
      // 中身の幅は width − 左右の罫線の半分、箱は外へ出る分だけ広い (WeasyPrint の invoice の合計の表と同じ)
      if (c('border-collapse') === 'collapse') cont.width += (side('left') + side('right')) / 2;
      const inner = Math.max(cont.width - side('left') - side('right'), 0);
      for (const ch of cont.children) {
        if (typeof ch === 'string' || ch.type !== 'table') continue;
        ch.width = inner;
        // 幅に満たない分は中身の幅の比で列に配る (自動レイアウト)
        if (!ch.fitContent && !ch.columns.some((col) => typeof col.width === 'string')) ch.fillContent = true;
        // 罫線・余白・背景は箱 (cont) が持つ。表には二重に付けない
        delete ch.margin;
        delete ch.border;
        delete ch.padding;
        delete ch.backgroundColor;
        delete ch.backgroundImage;
        delete ch.fitContent;
        delete ch.autoMargins;
      }
    }
    const cb = c('position') === 'absolute' ? this.localCb(e.parentElement) : undefined;
    if (cb) this.placeInCb(cont, cb, { top, right, bottom, left: staticI ? staticI : left });
    else {
      const a = this.areaOf(this.curPage ?? '');
      if (left !== undefined) cont.left = a.left + left;
      else if (right !== undefined) cont.right = a.right + right;
      else cont.left = a.left + staticI;
      if (top !== undefined) cont.top = a.top + top;
      else if (bottom !== undefined) cont.bottom = a.bottom + bottom;
      else cont.top = a.top;
    }
    const wm = this.wm(c('writing-mode'));
    if (wm) cont.writingMode = wm;
    return cont;
  }

  /**
   * counter-reset / counter-increment / counter-set (確定したスタイル) を、この順に当てる (Lists 3 §4)。owner: reset した値の有効範囲の要素。
   * li: リストの項目 (display: list-item)。list-item カウンターを、counter-increment に無ければ 1 足し (§4.6)、
   * HTML の value 属性は counter-set として当てる
   */
  private enterCounters(c: (p: string) => string, owner: Element | null, li?: { value?: number; step?: number }) {
    const pairs = (v: string, def: number): Array<[string, number]> =>
      // 名前は CSS の識別子 (CSS Syntax 3 §4.2: ASCII でない字 (U+0080 以上) も名前の字。counter(章) など)
      !v || v === 'none' ? [] : [...v.matchAll(/([a-z_\u0080-\uffff-][\w\u0080-\uffff-]*)(?:\s+(-?\d+))?/gi)].map((m) => [m[1], m[2] !== undefined ? parseInt(m[2], 10) : def]);
    const top = (n: string) => {
      let st = this.counters.get(n);
      if (!st) this.counters.set(n, (st = []));
      // 有効範囲に無いカウンターの counter-increment・counter-set は、その要素に 0 で作る (Lists 3 §4.2。有効範囲は reset と同じ:
      // 要素とその後続の兄弟。owner (親) を出るときに外れる。文書全体には残らない)
      if (!st.length) st.push({ owner, v: 0 });
      return st[st.length - 1];
    };
    for (const [n, v] of pairs(c('counter-reset'), 0)) {
      if (!this.counters.has(n)) this.counters.set(n, []);
      const st = this.counters.get(n)!;
      // 前の兄弟が作った同じ名前のカウンターは、置き換える (入れ子にしない。§4.4.2)
      if (st.length && st[st.length - 1].owner === owner && owner !== null) st[st.length - 1].v = v;
      else st.push({ owner, v });
    }
    const inc = pairs(c('counter-increment'), 1);
    for (const [n, v] of inc) top(n).v += v;
    if (li && !inc.some(([n]) => n === 'list-item')) top('list-item').v += li.step ?? 1;
    if (li?.value !== undefined) top('list-item').v = li.value;
    for (const [n, v] of pairs(c('counter-set'), 0)) top(n).v = v;
  }

  private leaveCounters(el: Element) {
    for (const st of this.counters.values()) while (st.length && st[st.length - 1].owner === el) st.pop();
  }

  private counterValue(name: string): number {
    const st = this.counters.get(name);
    return st?.length ? st[st.length - 1].v : 0;
  }

  /** 引用符の入れ子の深さ (Content 3 §4.1)。組む ::before / ::after の content を読むときだけ進める */
  private quoteDepth = 0;
  private countQuotes = false;

  /**
   * open-quote・close-quote の字 (Content 3 §4.1)。入れ子の深さで quotes の組を選ぶ (深さが組の数以上なら最後の組)。
   * close-quote で深さが負になるときは何も入れない。quotes: auto は言語に合う引用符 (日本語・中国語は「」『』、ほかは “” ‘’)
   */
  private quote(el: Element, pseudo: '::before' | '::after' | undefined, kind: string): string {
    const v = (pseudo ? this.cs(el, pseudo) : this.cs(el))('quotes')?.trim() ?? 'auto';
    let pairs: Array<[string, string]>;
    if (v === 'none') pairs = [];
    else if (v === 'auto' || !v) {
      const lang = (this.langOf(el) ?? '').toLowerCase();
      pairs = /^(ja|zh)\b/.test(lang) ? [['「', '」'], ['『', '』']] : [['“', '”'], ['‘', '’']];
    } else {
      const strs = parseContent(v).filter((x): x is { kind: 'str'; v: string } => x.kind === 'str').map((x) => x.v);
      pairs = [];
      for (let k = 0; k + 1 < strs.length; k += 2) pairs.push([strs[k], strs[k + 1]]);
    }
    const open = kind === 'open-quote' || kind === 'no-open-quote';
    const depth = this.quoteDepth;
    if (this.countQuotes) this.quoteDepth = open ? depth + 1 : Math.max(0, depth - 1);
    if (kind.startsWith('no-') || !pairs.length) return '';
    if (open) return pairs[Math.min(depth, pairs.length - 1)][0];
    if (depth === 0) return '';
    return pairs[Math.min(depth - 1, pairs.length - 1)][1];
  }

  /** content の値 (本文の中の ::before / ::after) を、行内の要素にする */
  private evalContent(el: Element, toks: ContentToken[], pseudo?: '::before' | '::after'): LInlineLevel[] {
    const out: LInlineLevel[] = [];
    if (toks.some(missingArgument)) return [];
    // counter(名前 語 …): カウンタの名前の後に語が続くのは CSS の構文にない (アンテナハウスの拡張 physical だけ互換で読む)
    let physical = false;
    for (const t of toks) {
      if (t.kind !== 'fn' || t.name !== 'counter') continue;
      const words = (t.args[0] ?? '').trim().split(/\s+/);
      if (words.length === 1) continue;
      if (this.opts.ahCounterPagePhysical && words.length === 2 && words[0] === 'page' && words[1] === 'physical') physical = true;
      else return [];
    }
    for (const t of toks) {
      if (t.kind === 'str') out.push(t.v);
      else if (t.kind === 'ident') {
        const q = t.v.toLowerCase();
        if (q === 'open-quote' || q === 'close-quote' || q === 'no-open-quote' || q === 'no-close-quote') {
          const s = this.quote(el, pseudo, q);
          if (s) out.push(s);
        }
      } else {
        const a = t.args;
        switch (t.name) {
          case 'counter':
            if (physical && a[0].trim().split(/\s+/)[0] === 'page' && a[0].trim() !== 'page') {
              // counter(page physical) (アンテナハウスの拡張): 囲むブロックの置かれたページの、物理的なページ番号
              if (!this.blockStack.length) break;
              const b = this.blockStack[this.blockStack.length - 1];
              b.id ??= `kumiori-page-${++this.autoId}`;
              out.push({ type: 'page-number-citation', refId: b.id, physical: true, format: pageNumberFormatOf(a[1] ?? 'decimal') ?? '1' });
            } else if (this.inRunning && (a[0] === 'page' || a[0] === 'pages')) {
              // 柱に出す要素 (running()) の中: 柱と同じく、置いたページの番号・総ページ数
              out.push(a[0] === 'page' ? '{pageNumber}' : '{totalPages}');
            } else if (a[0] === 'page' && this.blockStack.length) {
              // 本文の中のページ番号: 囲むブロックの置かれたページ番号を参照する。書式は counter() の計数の書式 (既定 decimal)。
              // ページの柱の書式 (@page の counter の書式) ではない
              const b = this.blockStack[this.blockStack.length - 1];
              b.id ??= `kumiori-page-${++this.autoId}`;
              out.push({ type: 'page-number-citation', refId: b.id, format: pageNumberFormatOf(a[1] ?? 'decimal') ?? '1' });
            } else if (a[0] === 'pages') {
              // 本文の中の総ページ数
              out.push({ type: 'page-number-citation', refId: TOTAL_PAGES_ID, format: pageNumberFormatOf(a[1] ?? 'decimal') ?? '1' });
            } else if (a[0] === 'page') this.miss(`content:counter(${a[0]}) (本文の中)`);
            else out.push(this.counterString(a[1] ?? 'decimal', this.counterValue(a[0])));
            break;
          case 'counters': {
            const st = this.counters.get(a[0]) ?? [];
            out.push((st.length ? st : [{ v: 0 }]).map((x) => this.counterString(a[2] ?? 'decimal', x.v)).join(unquote(a[1] ?? '.')));
            break;
          }
          case 'attr':
            // attr(名前 型, 既定値) の型 (string・url など) は見ない
            out.push(el.getAttribute(a[0].split(/\s+/)[0]) ?? unquote(a[1] && !/^[a-z-]+$/i.test(a[1]) ? a[1] : ''));
            break;
          case 'target-counter': {
            const ref = this.targetId(el, a[0]);
            if (!ref) break;
            if (a[1] === 'page') out.push({ type: 'page-number-citation', refId: ref });
            else if (this.lookup) out.push(this.counterString(a[2] ?? 'decimal', this.lookup.get(ref)?.counters[a[1]] ?? 0));
            break;
          }
          case 'target-text': {
            const ref = this.targetId(el, a[0]);
            const info = ref ? this.lookup?.get(ref) : undefined;
            const which = (a[1] ?? 'content').trim();
            if (info) out.push(which === 'before' ? info.before : which === 'after' ? info.after : which === 'first-letter' ? (FIRST_LETTER.exec(info.text)?.[2] ?? '') : info.text);
            break;
          }
          case 'leader': {
            const v = unquote(a[0] ?? 'dotted');
            const ld: LLeader = { type: 'leader', cssLeader: true };
            // solid は leader("_") と同じ (Content 3 §5.1: 下線の字の繰り返し。罫線ではない)
            if (v === 'solid') ld.patternText = '_';
            else if (v === 'space') ld.pattern = 'space';
            else if (v !== 'dotted' && v !== '.') ld.patternText = v;
            if (this.opts.leaderFromStart) {
              ld.cssLeaderFromStart = true;
              if (v === 'dotted') ld.patternText = '. ';
            }
            out.push(ld);
            break;
          }
          case 'url': {
            const img: LImage = { type: 'image', src: normalizeSrc(unquote(a[0] ?? '')) };
            // ::before / ::after の寸法 (ブラウザは、生成した画像の寸法を確定させない)
            const pd = pseudo ? this.pagedPseudo.get(el)?.[pseudo] : undefined;
            const fs = cssLen(this.cs(el)('font-size')) ?? 12;
            for (const k of ['width', 'height'] as const) {
              const v = pd?.[k] ? lenEm(pd[k], fs) : undefined;
              if (v) img[k] = v;
            }
            this.report.images.push(img.src);
            // 下端を字面の下端に揃える (アンテナハウスの -ah-alignment-baseline: text-after-edge。CSS Inline 3 の alignment-baseline の
            // text-bottom・XSL の text-after-edge)。上端は字面の上端 (text-before-edge・text-top)
            const ab = (pd?.['-ah-alignment-baseline'] ?? pd?.['alignment-baseline'] ?? '').trim().toLowerCase();
            const edge = /^(text-after-edge|after-edge|text-bottom|bottom)$/.test(ab) ? 'after-edge' : /^(text-before-edge|before-edge|text-top|top)$/.test(ab) ? 'before-edge' : undefined;
            if (edge) img.alignmentBaseline = edge;
            out.push(img);
            break;
          }
          default:
            this.miss(`content:${t.name}()`);
        }
      }
    }
    return out;
  }

  /** float: multicol top / before の float (段組の箱の先頭へ移す) */
  private multicolTop = new WeakMap<LFloat, string | undefined>();
  /** float: multicol top の箱のうち、box-sizing: border-box のもの (gr の幅を罫線・内側の余白込みの幅にする) */
  private multicolTopBorderBox = new WeakSet<LFloat>();

  /** 文書の @counter-style の定義 (run で読む) */
  private counterStyles = new CounterStyles(new Map(), () => undefined, () => undefined);
  /** 古い仕様の記号の書式 (アンテナハウス互換のときだけ。run で決める) */
  private obsoleteGlyphs: Record<string, string> | undefined;

  /** counter()・counters() の数の表記 (文書の @counter-style、定義済みの書式、定義の無い名前は decimal。Counter Styles 3 §5) */
  private counterString(type: string, n: number): string {
    const t = type.trim();
    return this.counterStyles.text(t, n) ?? this.builtinCounter(t, n) ?? String(n);
  }

  /** 定義済みの書式の表記 (アンテナハウス互換のときは古い仕様の記号の書式も)。定義の無い名前は undefined */
  private builtinCounter(t: string, n: number): string | undefined {
    if (this.obsoleteGlyphs && Object.hasOwn(this.obsoleteGlyphs, t)) return this.obsoleteGlyphs[t];
    if (COMPLEX_COUNTER.has(t)) return complexText(t, n);
    return BUILTIN_COUNTER.test(t) ? counterText(t, n) : undefined;
  }

  /** target-counter の飛び先 (attr(href) / "#id" / url(#id)) → id */
  private targetId(el: Element, arg: string | undefined): string | undefined {
    if (!arg) return undefined;
    const m = /^attr\(\s*([\w:-]+)(?:\s+[\w%-]+)?\s*(?:,[^)]*)?\)$/.exec(arg);
    const v = m ? (el.getAttribute(m[1]) ?? '') : unquote(arg.replace(/^url\((.*)\)$/, '$1'));
    const id = v.replace(/^.*#/, '');
    return id ? this.fragmentId(el, id) : undefined;
  }

  /** 文書の中の id (fragmentId が飛び先を探すのに使う。最初に使うときに集める) */
  private docIds?: Set<string>;

  /**
   * URL の fragment (# の後ろ) の指す要素の id (HTML Living Standard §7.4.6.4 Scrolling to a fragment の「indicated part」の手順):
   * まず fragment そのままの id を探し、無ければ、% の符号化を解いて UTF-8 として読んだもの (BOM は取らない) で探す
   * (href="#%E7%AB%A0" は id="章" を指す)。どちらも無ければ、そのまま返す
   */
  private fragmentId(el: Element, fragment: string): string {
    if (!/%[0-9a-f]{2}/i.test(fragment)) return fragment;
    if (!this.docIds) {
      const ids = (this.docIds = new Set<string>());
      const walk = (n: Node) => {
        for (const k of Array.from(n.childNodes ?? [])) {
          if (k.nodeType !== 1) continue;
          const id = (k as Element).getAttribute('id');
          if (id) ids.add(id);
          walk(k);
        }
      };
      if (el.ownerDocument) walk(el.ownerDocument);
    }
    if (this.docIds.has(fragment)) return fragment;
    // percent-decode (URL Standard §1.3: % の後ろが 16 進の 2 桁でなければ、そのままの字)
    const bytes: number[] = [];
    const enc = new TextEncoder();
    for (let i = 0; i < fragment.length; ) {
      const hex = fragment[i] === '%' ? /^[0-9a-f]{2}/i.exec(fragment.slice(i + 1, i + 3)) : null;
      if (hex) {
        bytes.push(parseInt(hex[0], 16));
        i += 3;
      } else {
        const cp = fragment.codePointAt(i)!;
        const ch = String.fromCodePoint(cp);
        bytes.push(...enc.encode(ch));
        i += ch.length;
      }
    }
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(bytes));
    return this.docIds.has(decoded) ? decoded : fragment;
  }

  /**
   * 要素の文字 (空白を詰める)。string-set の content()・target-text() の content・しおりの題。
   * 要素自身の ::before / ::after は含めない (GCPM 3 §1.1.1 の例: content(before) と content(text) を別に取る)。
   * 子孫は、組んだときの文字にする: display: none の子孫は除き、子孫の ::before / ::after の文字を含め、content で中身を
   * 置き換えた子孫は置き換えた文字にする (GCPM 3 は子孫の生成した内容の扱いを定めていない。たとえば target-text() は、
   * 子孫の span の ::before / ::after の引用符を含み、content: "" の span の文字を含まない)
   */
  private plainText(el: Element): string {
    let s = '';
    const strings = (e: Element, v: string, which?: '::before' | '::after') =>
      this.evalContent(e, parseContent(v), which)
        .filter((x): x is string => typeof x === 'string')
        .join('');
    const pseudoText = (e: Element, which: '::before' | '::after') => {
      const done = this.pseudoTextOf.get(e)?.[which];
      if (done !== undefined) return done;
      const v = this.pagedPseudo.get(e)?.[which]?.content ?? this.cs(e, which)('content');
      return !v || v === 'none' || v === 'normal' ? '' : strings(e, v, which);
    };
    const walk = (e: Element, self: boolean) => {
      if (!self) s += pseudoText(e, '::before');
      const own = self ? undefined : this.pg(e).content;
      if (own !== undefined && own !== 'normal' && own !== 'none') s += strings(e, own);
      else
        for (const n of Array.from(e.childNodes)) {
          if (n.nodeType === 3 || n.nodeType === 4) s += n.textContent ?? '';
          else if (n.nodeType === 1 && this.display(n as Element) !== 'none') walk(n as Element, false);
        }
      if (!self) s += pseudoText(e, '::after');
    };
    walk(el, true);
    return s.replace(/\s+/g, (w) => (/\n/.test(w) ? '' : ' ')).trim();
  }

  /** string-set → マーカー */
  private stringSet(el: Element): LMarker[] {
    const v = this.pg(el)['string-set'];
    if (!v || v === 'none') return [];
    const out: LMarker[] = [];
    const parts = v.split(/,(?![^(]*\))/).map((part) => parseContent(part));
    // 引数の無い attr() などのある宣言は、全体が無効 (missingArgument)
    if (parts.some((toks) => toks.some(missingArgument))) return [];
    for (const toks of parts) {
      const name = toks[0]?.kind === 'ident' ? toks[0].v : undefined;
      if (!name) continue;
      out.push({ type: 'marker', className: `string:${name}`, children: [this.textValue(el, toks.slice(1))] });
    }
    return out;
  }

  /** 文字の値 (string-set・bookmark-label): 文字列・content() / content(before|after)・attr()・counter() をつなぐ */
  private textValue(el: Element, toks: ContentToken[]): string {
    let text = '';
    for (const t of toks) {
      if (t.kind === 'str') text += t.v;
      else if (t.kind === 'fn' && t.name === 'content') {
        const which = t.args[0] ?? 'text';
        if (which === 'before' || which === 'after') {
          const c = this.pagedPseudo.get(el)?.[`::${which}`]?.content ?? this.cs(el, `::${which}`)('content');
          text += this.evalContent(el, parseContent(c)).filter((x): x is string => typeof x === 'string').join('');
        } else text += this.plainText(el);
      } else if (t.kind === 'fn') text += this.evalContent(el, [t]).filter((x): x is string => typeof x === 'string').join('');
    }
    return text;
  }

  /** しおり (bookmark-level・bookmark-label・bookmark-state)。飛び先は要素の id (無ければ付ける) */
  private bookmark(el: Element) {
    const pg = this.pg(el);
    const level = parseInt(pg['bookmark-level'] ?? '', 10);
    if (!(level >= 1)) return;
    let id = el.getAttribute('id');
    if (!id) el.setAttribute('id', (id = `kumiori-bookmark-${++this.autoId}`));
    const label = pg['bookmark-label'];
    const title = (label ? this.textValue(el, parseContent(label)) : this.plainText(el)).replace(/\s+/g, ' ').trim();
    if (!title) return;
    this.bookmarks.push({ level, title, ref: id, open: !/closed/.test(pg['bookmark-state'] ?? '') });
  }
  private bookmarks: Array<{ level: number; title: string; ref: string; open: boolean }> = [];

  private cs(el: Element, pseudo?: PseudoSel) {
    const s = this.src.style(el, pseudo);
    return (p: string) => s.getPropertyValue(p).trim();
  }

  /**
   * 印刷の色 (device-cmyk・rgb-icc)。特色の値が渡されていて、前の値に隠れた rgb-icc(…, #Separation, …) がその特色なら、それを使う
   * (特色で塗る)。ほかは、その性質の印刷の色 (無ければ undefined)
   */
  private printOf(decls: Record<string, string>, prop: string, alt?: string): string | undefined {
    const hidden = decls[`-kumiori-print-${prop}`] ?? (alt ? decls[`-kumiori-print-${alt}`] : undefined);
    if (hidden && this.opts.spotColors) {
      const c = printColor(hidden, this.opts.spotColors);
      if (c?.startsWith('spot(')) return c;
    }
    return printColor(decls[prop] ?? (alt ? decls[alt] : undefined) ?? '', this.opts.spotColors);
  }

  /**
   * 罫線の辺の印刷の色 (device-cmyk・cmyk・rgb-icc)。自前で読んだ宣言から、辺の色 > 辺の一括指定 > border-color > border の順に探す
   * (宣言の順は覚えていないので、詳しい指定を優先する)。無ければ undefined
   */
  private borderPrint(decls: Record<string, string>, sd: 'top' | 'right' | 'bottom' | 'left'): string | undefined {
    const fn = /(?:device-cmyk|rgb-icc|(?<![\w-])cmyk)\([^)]*\)/gi;
    const one = (v: string | undefined) => (v ? (v.match(fn) ?? [])[0] : undefined);
    const own = one(decls[`border-${sd}-color`]) ?? one(decls[`border-${sd}`]);
    if (own) return printColor(own, this.opts.spotColors);
    const bc = decls['border-color'];
    if (bc) {
      // 1〜4 個の値 (上・右・下・左)
      const vals = splitTop(bc, ' ');
      const [t, r = t, b = t, l = r] = vals;
      const v = { top: t, right: r, bottom: b, left: l }[sd];
      if (one(v)) return printColor(one(v)!, this.opts.spotColors);
    }
    const all = one(decls.border);
    return all ? printColor(all, this.opts.spotColors) : undefined;
  }

  private miss(what: string) {
    this.report.unsupported[what] = (this.report.unsupported[what] ?? 0) + 1;
  }

  /** 文字の書式: 親と違うものだけ (CSS の継承は Kumiori の resolveStyle と同じく子へ引き継ぐ) */
  private textStyle(el: Element, parent: Element | undefined, pseudo?: PseudoSel): TextStyle {
    const c = this.cs(el, pseudo);
    const p = parent ? this.cs(parent) : undefined;
    const diff = (prop: string) => !p || c(prop) !== p(prop);
    const s: TextStyle = {};
    if (diff('font-size')) {
      const v = cssLen(c('font-size'));
      if (v) s.fontSize = v;
    }
    const bold = (parseInt(c('font-weight'), 10) || 400) >= 600;
    if (diff('font-weight')) s.fontWeight = parseInt(c('font-weight'), 10) || 400;
    if (diff('font-family') || diff('font-weight')) {
      const names = c('font-family')
        .split(',')
        .map((n) => n.replace(/['"]/g, '').trim())
        .filter(Boolean);
      const mapped = this.opts.mapFont?.(names, bold, this.langOf(el));
      if (mapped) s.fontFamily = mapped;
    }
    // direction: 行の中の向き (右から左の段落。Writing Modes 3 §2.1)。text-align の left・right は paragraphStyle で start・end に読み替える
    if (!pseudo && diff('direction')) s.direction = c('direction') === 'rtl' ? 'rtl' : 'ltr';
    // unicode-bidi (引き継がない。Writing Modes 3 §2.2): normal 以外を渡す
    {
      const ub = c('unicode-bidi');
      if (ub === 'embed' || ub === 'isolate' || ub === 'bidi-override' || ub === 'isolate-override' || ub === 'plaintext') s.unicodeBidi = ub;
    }
    if (diff('font-style')) s.fontStyle = c('font-style') === 'italic' || c('font-style').startsWith('oblique') ? 'italic' : 'normal';
    // 印刷の色 (特色・CMYK)。::before / ::after / ::marker は、その擬似要素の規則の宣言から
    const pdecl = pseudo === '::before' || pseudo === '::after' || pseudo === '::marker' ? this.pagedPseudo.get(el)?.[pseudo] : pseudo ? undefined : this.pg(el);
    const pcol = pdecl ? this.printOf(pdecl, 'color') : undefined;
    if (pcol) s.color = pcol;
    else if (diff('color')) {
      const col = cssColor(c('color'));
      if (col) s.color = col;
    }
    // visibility (CSS 2.1 §11.2・CSS Display 3 §4): hidden・collapse の要素は、場所を残して描かない。字の色を transparent にして運び、
    // 描画で描かない (字・リーダー・リストの記号・画像。paint.ts)。visibility は受け継ぐので、見えない親の中で visible の子は自分の色に戻す
    const hiddenOf = (cc: (n: string) => string) => /^(hidden|collapse)$/.test(cc('visibility'));
    if (hiddenOf(c)) s.color = 'transparent';
    else if (p && hiddenOf(p)) s.color = s.color ?? pcol ?? cssColor(c('color')) ?? '#000000';
    if (diff('line-height') || diff('font-size') || (c('line-height') === 'normal' && diff('font-family'))) {
      const lh = c('line-height');
      const v = cssLen(lh);
      // 0 も有効な値 (画像の行などで使う。CSS 2.1 §10.8.1)
      if (v !== undefined) s.lineHeightPt = v;
      else if (lh === 'normal') {
        // normal: 書体の値 (読み込んだ書体なら ascent・descent・lineGap から)、分からなければ 1.2
        const fams = c('font-family').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        s.lineHeight = this.opts.normalLineHeight?.(fams, (parseInt(c('font-weight'), 10) || 400) >= 600) ?? 1.2;
      }
    }
    // letter-spacing・word-spacing の normal は 0 (Text 3 §7.1・§7.2)。親の値を打ち消せるように、変わったら必ず設定する
    if (diff('letter-spacing')) s.letterSpacing = cssLen(c('letter-spacing')) ?? 0;
    if (diff('word-spacing')) s.wordSpacing = cssLen(c('word-spacing')) ?? 0;
    // white-space: nowrap・pre は折り返さない (行内要素でも。Text 3 §3)。子の normal などで打ち消せる
    if (diff('white-space')) {
      s.noWrap = /^(nowrap|pre)$/.test(c('white-space'));
      s.collapseSpaces = /^(normal|nowrap|pre-line)$/.test(c('white-space') || 'normal');
    }
    // overflow-wrap (初期値 normal: 収まらない語は分けずにはみ出す。Text 3 §5.5)
    if (diff('overflow-wrap')) {
      const ow = c('overflow-wrap');
      s.overflowWrap = ow === 'anywhere' ? 'anywhere' : ow === 'break-word' ? 'break-word' : 'normal';
    }
    // word-break (Text 3 §5.2)。break-word (古い値) は normal と overflow-wrap: anywhere と同じ
    if (diff('word-break')) {
      const wb = c('word-break');
      s.wordBreak = wb === 'break-all' ? 'break-all' : wb === 'keep-all' ? 'keep-all' : 'normal';
      if (wb === 'break-word') s.overflowWrap = 'anywhere';
    }
    // line-break (Text 3 §5.2)
    if (diff('line-break')) {
      const lb = c('line-break');
      if (/^(auto|strict|normal|loose|anywhere)$/.test(lb)) s.lineBreak = lb as LBlock['lineBreak'];
    }
    const deco = c('text-decoration-line') || c('text-decoration');
    // 線の色は、線を指定したこの要素の text-decoration-color (初期値 currentcolor はこの要素の color)。子孫の字の色では変えない
    // (CSS Text Decoration 3 §2.3)。currentcolor なら、印刷の色 (特色など) の指定も字と同じに使う
    const decoColor = () => {
      const v = c('text-decoration-color');
      return v === c('color') ? (pcol ?? cssColor(c('color'))) : cssColor(v);
    };
    if (deco && deco !== 'none' && (!p || deco !== (p('text-decoration-line') || p('text-decoration')) || c('text-decoration-color') !== p('text-decoration-color'))) {
      const dc = decoColor();
      const colors = dc ? { ...(deco.includes('underline') ? { underline: dc } : {}), ...(deco.includes('overline') ? { overline: dc } : {}), ...(deco.includes('line-through') ? { lineThrough: dc } : {}) } : undefined;
      s.textDecoration = { ...(deco.includes('underline') ? { underline: true } : {}), ...(deco.includes('overline') ? { overline: true } : {}), ...(deco.includes('line-through') ? { lineThrough: true } : {}), ...(colors ? { colors } : {}) };
    }
    // 互換モード: 祖先の飾り線は表に伝えない (表に自分の飾り線があれば、それだけ。Quirks Mode §3.11)
    if (!pseudo && isQuirksDoc(el.ownerDocument as Document | null) && /^(inline-)?table$/.test(c('display'))) {
      const own = deco && deco !== 'none' ? deco : '';
      const dc = own ? decoColor() : undefined;
      s.textDecoration = { underline: own.includes('underline'), overline: own.includes('overline'), lineThrough: own.includes('line-through'), ...(dc ? { colors: { underline: dc, overline: dc, lineThrough: dc } } : {}) };
    }
    // hyphens: auto だけが自動の分綴。子の none・manual で打ち消せる (Text 3 §5.3)
    if (diff('hyphens')) s.hyphenate = c('hyphens') === 'auto';
    if (!pseudo) {
      const sp = this.spacing(el);
      const ps = parent ? this.spacing(parent) : undefined;
      if (sp.autospace !== undefined && sp.autospace !== ps?.autospace) s.textAutospace = sp.autospace;
      // アンテナハウスの -ah-text-autospace-width (百分率または長さの em)
      const aw = this.inh(el, 'text-autospace-width', true);
      if (aw && aw !== (parent ? this.inh(parent, 'text-autospace-width', true) : '')) {
        const v = /^([\d.]+)%$/.exec(aw) ? parseFloat(aw) / 100 : /^([\d.]+)em$/.exec(aw) ? parseFloat(aw) : undefined;
        if (v !== undefined && Number.isFinite(v)) s.textAutospaceWidth = v;
      }
      if (sp.squeeze !== undefined && sp.squeeze !== ps?.squeeze) s.punctuationSqueeze = sp.squeeze;
      if (sp.trimStart !== undefined && sp.trimStart !== ps?.trimStart) s.punctuationTrimStart = sp.trimStart;
      if (sp.trimEnd !== undefined && sp.trimEnd !== ps?.trimEnd) s.punctuationTrimEnd = sp.trimEnd;
      if (sp.hang !== ps?.hang) s.hangingPunctuation = sp.hang;
      if (sp.hangFirst !== (ps?.hangFirst ?? false)) s.hangFirst = sp.hangFirst;
    }
    // 字形を差し替える OpenType の機能: font-variant-numeric (oldstyle-nums など)・font-variant-position (super・sub)・
    // font-variant-ligatures (discretionary・historical・contextual) と font-feature-settings。
    // 字は 1 字ずつ字形を引くので、字の並びで決まる機能 (frac の分数・ordn の序数・calt) は書体が 1 字で差し替えるものだけ効く
    if (diff('font-variant-numeric') || diff('font-variant-position') || diff('font-variant-ligatures') || diff('font-feature-settings')) {
      const NUM: Record<string, string> = {
        'oldstyle-nums': 'onum',
        'lining-nums': 'lnum',
        'proportional-nums': 'pnum',
        'tabular-nums': 'tnum',
        'diagonal-fractions': 'frac',
        'stacked-fractions': 'afrc',
        'slashed-zero': 'zero',
        ordinal: 'ordn',
      };
      const feats = c('font-variant-numeric').split(/\s+/).flatMap((v) => (NUM[v] ? [NUM[v]] : []));
      const pos = c('font-variant-position');
      if (pos === 'super') feats.push('sups');
      else if (pos === 'sub') feats.push('subs');
      const LIG: Record<string, string> = { 'discretionary-ligatures': 'dlig', 'historical-ligatures': 'hlig', contextual: 'calt' };
      for (const v of c('font-variant-ligatures').split(/\s+/)) if (LIG[v] && !feats.includes(LIG[v])) feats.push(LIG[v]);
      for (const m of c('font-feature-settings').matchAll(/["']([a-z0-9]{4})["']\s*(on|off|\d+)?/gi)) {
        const on = m[2] === undefined || m[2] === 'on' || parseInt(m[2], 10) > 0;
        if (on && !feats.includes(m[1])) feats.push(m[1]);
      }
      s.fontFeatures = feats;
    }
    // text-orientation (Writing Modes 3 §5.1)。sideways-right は sideways と同じ。
    // writing-mode: sideways-rl の中では、字の組み方が横書きなので、字はすべて横倒し (Writing Modes 4 §3.2)
    if (diff('text-orientation') || diff('writing-mode')) {
      const to = c('text-orientation');
      s.textOrientation = c('writing-mode') === 'sideways-rl' || to === 'sideways' || to === 'sideways-right' ? 'sideways' : to === 'upright' ? 'upright' : 'mixed';
    }
    // 標準の合字 (fi・fl など): 既定で使う (Fonts 4 §6.4)。font-variant-ligatures の none・no-common-ligatures、
    // font-feature-settings の "liga" 0・off で止める
    if (!parent || diff('font-variant-ligatures') || diff('font-feature-settings')) {
      const vl = c('font-variant-ligatures');
      const liga = /["']liga["']\s*(on|off|\d+)?/i.exec(c('font-feature-settings'));
      let on = !/(^|\s)(none|no-common-ligatures)(\s|$)/.test(vl);
      if (liga) on = liga[1] === undefined || liga[1] === 'on' || parseInt(liga[1], 10) > 0;
      s.latinLigatures = on;
    }
    // カーニング: auto (既定) も、ブラウザと同じく欧文にかける。none で止める
    const fk = c('font-kerning');
    if (!parent || diff('font-kerning')) {
      if (fk === 'normal' || fk === 'auto') s.kerning = true;
      else if (fk === 'none') s.kerning = false;
    }
    // font-feature-settings の "kern" 0・off でもカーニングを止める
    if (diff('font-feature-settings')) {
      const kern = /["']kern["']\s*(on|off|\d+)?/i.exec(c('font-feature-settings'));
      if (kern) s.kerning = kern[1] === undefined || kern[1] === 'on' || parseInt(kern[1], 10) > 0;
    }
    if (!pseudo) {
      const lhsa = this.inh(el, 'line-height-shift-adjustment', true);
      const plhsa = parent ? this.inh(parent, 'line-height-shift-adjustment', true) : '';
      if ((lhsa === 'disregard-shifts' || lhsa === 'consider-shifts') && lhsa !== plhsa) s.lineHeightShiftAdjustment = lhsa;
      const lss = this.inh(el, 'line-stacking-strategy', true);
      const plss = parent ? this.inh(parent, 'line-stacking-strategy', true) : '';
      if ((lss === 'font-height' || lss === 'max-height' || lss === 'line-height') && lss !== plss) s.lineStackingStrategy = lss;
    }
    if (diff('font-stretch')) {
      const fsr = parseFloat(c('font-stretch'));
      if (fsr && fsr !== 100 && /%$/.test(c('font-stretch'))) s.fontStretch = fsr / 100;
    }
    const lang = el.getAttribute?.('lang') ?? el.getAttribute?.('xml:lang');
    if (lang && !pseudo) s.language = lang;
    return s;
  }

  /** 要素が属する言語 (自身か祖先の lang / xml:lang) */
  private langOf(el: Element): string | undefined {
    for (let e: Element | null = el; e && e.getAttribute; e = e.parentNode as Element | null) {
      const v = e.getAttribute('lang') || e.getAttribute('xml:lang');
      if (v) return v;
    }
    return undefined;
  }

  /** 段落の書式 (揃え・字下げ・孤立行) */
  private paragraphStyle(el: Element, parent: Element | undefined): TextStyle {
    const c = this.cs(el);
    const p = parent ? this.cs(parent) : undefined;
    const diff = (prop: string) => !p || c(prop) !== p(prop);
    const s: TextStyle = {};
    // -webkit-center (Chrome の caption の既定) などは、接頭辞を除いて読む
    const ta = c('text-align').replace(/^-(webkit|internal)-/, '');
    if (diff('text-align') || diff('direction')) {
      const rtl = c('direction') === 'rtl';
      s.textAlign = ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : ta === 'end' || ta === (rtl ? 'left' : 'right') ? 'end' : 'start';
    }
    // text-align-last の left・right も、text-align と同じく direction で start・end に読み替える (rtl では left が end)
    const tal = c('text-align-last');
    if ((diff('text-align-last') || diff('direction')) && tal && tal !== 'auto') {
      const rtl = c('direction') === 'rtl';
      s.textAlignLast = tal === 'center' ? 'center' : tal === 'justify' ? 'justify' : tal === 'end' || tal === (rtl ? 'left' : 'right') ? 'end' : 'start';
    }
    if (diff('text-indent')) Object.assign(s, textIndentOf(c('text-indent')));
    for (const k of ['orphans', 'widows'] as const) {
      const n = parseInt(c(k), 10);
      if (Number.isFinite(n) && diff(k)) s[k] = n;
    }
    if (diff('white-space') && /^(nowrap|pre)$/.test(c('white-space'))) s.noWrap = true;
    return s;
  }

  /** 箱の書式 (余白・枠・背景・寸法) */
  /** 箱の書式 (余白・枠・背景・寸法・改ページ)。pseudo を渡すと、el の ::before / ::after の箱の書式 */
  private boxStyle(el: Element, pseudo?: PseudoSel): Omit<Partial<LBlock>, 'type' | 'children'> {
    const c = this.cs(el, pseudo);
    const o: Omit<Partial<LBlock>, 'type' | 'children'> = {};
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const edges = (prop: (s: string) => string) => {
      const e: Record<string, number> = {};
      for (const sd of sides) {
        const v = cssLen(c(prop(sd)));
        if (v) e[sd] = v;
      }
      return Object.keys(e).length ? e : undefined;
    };
    const margin = edges((sd) => `margin-${sd}`);
    if (margin) o.margin = margin;
    const padding = edges((sd) => `padding-${sd}`);
    if (padding) o.padding = padding;
    const border: Partial<Record<(typeof sides)[number], BorderSide>> = {};
    for (const sd of sides) {
      const style = c(`border-${sd}-style`);
      const w = cssLen(c(`border-${sd}-width`)) ?? 0;
      if (!style || style === 'none' || style === 'hidden' || w <= 0) continue;
      border[sd] = {
        width: w,
        color: (pseudo ? undefined : this.borderPrint(this.pg(el), sd)) ?? cssColor(c(`border-${sd}-color`)) ?? '#000000',
        ...(style !== 'solid' ? { style: style as BorderSide['style'], symmetric: true } : {}),
      };
    }
    if (Object.keys(border).length) o.border = border;
    const bg = (pseudo ? undefined : this.printOf(this.pg(el), 'background-color', 'background')) ?? cssColorAlpha(c('background-color'));
    if (bg) o.backgroundColor = bg;
    // 背景画像 (最初の 1 枚。位置は百分率・長さ・キーワード、大きさは長さだけ)。グラデーションは組版で箱の大きさから画像にする
    const bimg = c('background-image');
    const bi = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bimg);
    const grad = !bi || bimg.search(/(linear|radial)-gradient\(/i) < bimg.search(/url\(/i) ? firstGradient(bimg) : undefined;
    if (bi || grad) {
      const img: BackgroundImage = grad ? { src: '', gradient: grad, gradientFontSize: cssLen(c('font-size')) ?? 12 } : { src: normalizeSrc(bi![1]) };
      const rep = c('background-repeat').split(',')[0].trim();
      if (rep === 'no-repeat' || rep === 'repeat-x' || rep === 'repeat-y') img.repeat = rep;
      else if (rep === 'no-repeat no-repeat') img.repeat = 'no-repeat';
      else if (rep === 'repeat no-repeat') img.repeat = 'repeat-x';
      else if (rep === 'no-repeat repeat') img.repeat = 'repeat-y';
      setBackgroundPosition(img, c('background-position-x'), c('background-position-y'));
      const bsz = c('background-size').split(',')[0].trim();
      if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
      // 百分率は、背景の領域 (padding box) の大きさに対して (ブラウザが置いた箱の大きさから)
      const r = /%/.test(bsz) ? this.src.rect?.(el) : undefined;
      const area = r && { w: (r.width - (parseFloat(c('border-left-width')) || 0) - (parseFloat(c('border-right-width')) || 0)) * PT_PER_PX, h: (r.height - (parseFloat(c('border-top-width')) || 0) - (parseFloat(c('border-bottom-width')) || 0)) * PT_PER_PX };
      const size = bsz.split(/\s+/).map((v, k) => (/%$/.test(v) ? (area ? (parseFloat(v) / 100) * (k === 0 ? area.w : area.h) : undefined) : cssLen(v)));
      if (size[0] !== undefined) img.width = size[0];
      if (size[1] !== undefined) img.height = size[1];
      // ブラウザの配置が無いとき (コマンドで組むとき): 百分率は、組版で箱の大きさが決まってから長さにする (CSS Backgrounds 3 §2.9)
      if (!area && !img.size) {
        bsz.split(/\s+/).forEach((v, k) => {
          if (/%$/.test(v) && !Number.isNaN(parseFloat(v))) img[k === 0 ? 'widthPct' : 'heightPct'] = parseFloat(v) / 100;
        });
        const parts = bsz.split(/\s+/);
        if (img.widthPct !== undefined && (parts[1] ?? 'auto') === 'auto') img.pctAuto = 'height';
        else if (img.heightPct !== undefined && parts[0] === 'auto') img.pctAuto = 'width';
      }
      o.backgroundImage = img;
      if (!grad) this.report.images.push(img.src);
    }
    for (const prop of ['width', 'height'] as const) {
      if (pseudo ? c(prop) === 'auto' || !c(prop) : this.src.isAuto?.(el, prop) !== false) continue;
      const v = cssLen(c(prop));
      if (v !== undefined) o[prop] = v;
    }
    // max-width・min-width (CSS 2.1 §10.4): 幅が auto のブロックで上限・下限が効いたら、その幅にする (カスケードの見積もりの幅)。
    // 幅の指定があれば、指定の幅を上限・下限で抑える
    // 置換要素 (画像など) の auto の幅は本来の大きさなので、ここでは扱わない (image() で上限・下限を当てる)
    const replaced = /^(img|svg|object|video|canvas|iframe|embed|input|textarea|select|button|math)$/.test(el.localName);
    // aspect-ratio (CSS Sizing 4 §5.1): 幅と高さの一方だけが決まっていれば、もう一方を比から決める (box-sizing の箱どうしの比)。どちらも
    // 決まらないブロック (流れの中のブロックでないもの・flex・grid の容器) は、幅 (容器の幅の見積もり) から高さを決める。置換要素に auto 付きで書いたときは、本来の縦横比を使う (image() が扱う)
    const ar = parseAspectRatio(c('aspect-ratio'));
    if (ar && !(replaced && ar.auto)) {
      const bbA = c('box-sizing') === 'border-box';
      const hb = (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
      const vb = (padding?.top ?? 0) + (padding?.bottom ?? 0) + (border.top?.width ?? 0) + (border.bottom?.width ?? 0);
      // 流れの中のブロック (float・絶対配置でなく、書字方向が親と同じ) は、組むときの実際の幅から高さを決める (flex の項目の中など、
      // 幅が組むときに決まる場所でもずれない)。書字方向が親と違うブロックは、組版エンジンが別の道で組むので、ここで決める
      const sameWm = !el.parentElement || this.cs(el.parentElement)('writing-mode') === c('writing-mode');
      const flowBlock = !pseudo && !replaced && sameWm && /^(block|list-item|flow-root)$/.test(c('display')) && c('float') === 'none' && !/^(absolute|fixed)$/.test(c('position'));
      if (o[this.axisOf(el)('height') as 'height' | 'width'] === undefined && flowBlock) o.aspectRatio = ar.ratio;
      else if (o.width !== undefined && o.height === undefined) o.height = o.width / ar.ratio;
      else if (o.height !== undefined && o.width === undefined) o.width = o.height * ar.ratio;
      else if (o.width === undefined && o.height === undefined && !pseudo && /^(block|list-item|flow-root|flex|grid)$/.test(c('display'))) {
        const cw = this.src.contentWidth?.(el);
        // 比は box-sizing の箱どうし: content-box なら内容の幅、border-box なら枠までの幅から高さを出す
        if (cw) o.height = (cw * PT_PER_PX + (bbA ? hb : 0)) / ar.ratio;
        if (bbA && o.height !== undefined) o.height = Math.max(o.height, vb);
      }
    }
    // aspect-ratio の箱 (組むときに大きさを決めるもの) の min-width・max-width は、比で移す min・max との兼ね合いがあるので、
    // ここではなく組むときに当てる (下の minInlineSize・maxInlineSize)
    if (!pseudo && !this.src.rect && !replaced && !o.aspectRatio && /^(block|list-item|flow-root)$/.test(c('display')) && c('float') === 'none' && !/^(absolute|fixed)$/.test(c('position'))) {
      const bb = c('box-sizing') === 'border-box';
      const hbPt = (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
      const lim = (p: string) => (/px$/.test(c(p)) ? cssLen(c(p)) : undefined);
      const mx = lim('max-width');
      const mn = lim('min-width');
      if (o.width !== undefined) {
        // 指定の幅を、同じ box-sizing の上限・下限で抑える
        let w = o.width;
        if (mx !== undefined) w = Math.min(w, mx);
        if (mn !== undefined) w = Math.max(w, mn);
        o.width = w;
      } else if ((mx !== undefined || mn !== undefined) && el.parentElement) {
        const own = this.src.contentWidth?.(el);
        const pcw = this.src.contentWidth?.(el.parentElement);
        if (own !== undefined && pcw !== undefined) {
          const mPx = (p: string) => (c(p) === 'auto' ? 0 : parseFloat(c(p)) || 0);
          const avail = pcw - mPx('margin-left') - mPx('margin-right');
          const ownBorderPx = own + hbPt / PT_PER_PX;
          if (Math.abs(ownBorderPx - avail) > 0.01) o.width = own * PT_PER_PX + (bb ? hbPt : 0);
        }
      }
    }
    if ((o.width !== undefined || o.height !== undefined || o.aspectRatio) && c('box-sizing') === 'border-box') o.boxSizing = 'border-box';
    // min-height (CSS 2.1 §10.7): 高さの最小値。max-height は、高さの指定を抑える (中身が多い auto の高さは抑えない: はみ出しの描き方が無いため)
    if (!replaced) {
      const mnh = /px$/.test(c('min-height')) ? cssLen(c('min-height')) : undefined;
      const mxh = /px$/.test(c('max-height')) ? cssLen(c('max-height')) : undefined;
      if (o.height !== undefined && mxh !== undefined) o.height = Math.min(o.height, mxh);
      if (o.height !== undefined && mnh !== undefined) o.height = Math.max(o.height, mnh);
      // block 方向の最小値・最大値は、縦書きでは min-width・max-width (CSS Writing Modes 4 §6.2。枠と内側の余白も左右の分)
      const B = this.axisOf(el);
      const pB = (p: string) => (/px$/.test(c(B(p))) ? cssLen(c(B(p))) : undefined);
      const vertB = B('height') === 'width';
      const bbH = c('box-sizing') !== 'border-box' ? 0 : vertB ? (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0) : (padding?.top ?? 0) + (padding?.bottom ?? 0) + (border.top?.width ?? 0) + (border.bottom?.width ?? 0);
      const mnB = pB('min-height');
      if (mnB) o.minBlockSize = Math.max(0, mnB - bbH);
      if (o.aspectRatio) {
        // aspect-ratio の箱: block・inline の min・max を、組版エンジンが組むときに当てる (CSS Sizing 4 §5.1)。min の指定 (0 も) は
        // auto (自動の最小の大きさ: 中身で伸びる) と区別して運ぶ。縦書きでは、inline の向きは min-height・max-height
        if (mnB !== undefined) o.minBlockSize = Math.max(0, mnB - bbH);
        const mxB = pB('max-height');
        if (mxB !== undefined) o.maxBlockSize = Math.max(0, mxB - bbH);
        const bbI = c('box-sizing') !== 'border-box' ? 0 : vertB ? (padding?.top ?? 0) + (padding?.bottom ?? 0) + (border.top?.width ?? 0) + (border.bottom?.width ?? 0) : (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
        const mnI = pB('min-width');
        if (mnI) o.minInlineSize = Math.max(0, mnI - bbI);
        const mxI = pB('max-width');
        if (mxI !== undefined) o.maxInlineSize = Math.max(0, mxI - bbI);
      }
      // aspect-ratio の箱は、min・max で幅が組むときに決まることがあるので、inline の向きの auto の余白は組むときに配る (CSS 2.1 §10.3.3)
      if (o.aspectRatio && !this.src.rect) {
        const ms = c(B('margin-left')) === 'auto';
        const me = c(B('margin-right')) === 'auto';
        if (ms || me) o.autoMargins = ms && me ? 'center' : ms ? 'start' : 'end';
      }
    }
    // ブラウザの配置が無いとき: 幅の決まった箱の左右の余白が両方 auto なら、残りを等分する (CSS 2.1 §10.3.3)
    const cbEl = pseudo ? el : el.parentElement;
    if (!this.src.rect && o.width !== undefined && c('margin-left') === 'auto' && c('margin-right') === 'auto' && cbEl) {
      const cw = this.src.contentWidth?.(cbEl);
      if (cw !== undefined) {
        const extra = o.boxSizing === 'border-box' ? 0 : (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
        const m = (cw * PT_PER_PX - o.width - extra) / 2;
        if (m > 0) o.margin = { ...margin, left: m, right: m };
      }
      // 組むときの置く場所の幅が見積もりと違えば、組版エンジンが残りを等分し直す
      o.autoMargins ??= 'center';
    }
    // 左右の一方だけが auto: 組むときに、残りをその余白に配る (margin-left が auto なら右へ寄る)
    else if (!this.src.rect && o.width !== undefined && (c('margin-left') === 'auto' || c('margin-right') === 'auto')) {
      o.autoMargins ??= c('margin-left') === 'auto' ? 'start' : 'end';
    }
    // HTML の center 要素・align 属性 (-webkit-center など) は、子孫のブロックもそろえる (HTML 5.2 §10.3.3・§10.3.9)。
    // 幅の決まった箱で、左右の余白の指定が無い (0) ものを、親の中で寄せる
    else if (!this.src.rect && !pseudo && o.width !== undefined && cbEl && c('float') === 'none' && c('margin-left') === '0px' && c('margin-right') === '0px') {
      const pa = this.cs(cbEl)('text-align');
      const al = /^-webkit-(center|right|left)$/.exec(pa)?.[1];
      const cw = al && al !== 'left' ? this.src.contentWidth?.(cbEl) : undefined;
      if (cw !== undefined) {
        const extra = o.boxSizing === 'border-box' ? 0 : (padding?.left ?? 0) + (padding?.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
        const free = cw * PT_PER_PX - o.width - extra;
        if (free > 0) o.margin = { ...margin, ...(al === 'center' ? { left: free / 2, right: free / 2 } : { left: free }) };
        // 寄せた箱は、rtl の「右端から置く」決まりの外 (寄せる向きは text-align が決める)
        o.autoMargins ??= al === 'center' ? 'center' : 'start';
      }
    }
    const rad = this.radiusOf(c);
    if (rad) o.borderRadius = rad;
    const shadows = shadowsOf(c('box-shadow'), c('filter'));
    if (shadows.length) o.boxShadow = shadows.length === 1 ? shadows[0] : shadows;
    // 改ページ (break-before / after。left・right・recto・verso は偶数・奇数ページ)。
    // recto (右から左へ進む本では左ページ) は奇数ページ、verso は偶数ページ。left・right は、ページが右から左へ進む文書では
    // 左ページが奇数ページなので入れ替える (:left・:right の選び方と同じ。CSS Fragmentation 3 §3.1 の left・right・recto・verso)
    const rtlPages = this.pagesRtl;
    const brk = (v: string): LBlock['breakBefore'] =>
      v === 'page' || v === 'always'
        ? 'page'
        : v === 'verso' || v === (rtlPages ? 'right' : 'left')
          ? 'even-page'
          : v === 'recto' || v === (rtlPages ? 'left' : 'right')
            ? 'odd-page'
            : v === 'column'
              ? 'column'
              : undefined;
    const bb = brk(c('break-before') || c('page-break-before'));
    const ba = brk(c('break-after') || c('page-break-after'));
    if (bb) o.breakBefore = bb;
    if (ba) o.breakAfter = ba;
    // 分けるのを避ける値。avoid-column は段組の文脈の中だけで効く (CSS Fragmentation 3 §3.1 の Column Break Values は
    // 段組の文脈の外では効かない。§3.2 の break-inside: avoid-column も、段の区切りだけを避ける)。
    // avoid-region も、領域をつなぐ流れが無いので効かない
    let multicol: boolean | undefined;
    const avoids = (v: string) => v === 'avoid' || v === 'avoid-page' || (v === 'avoid-column' && (multicol ??= this.inMulticol(el)));
    if (avoids(c('break-inside') || c('page-break-inside'))) o.keepTogether = true;
    if (avoids(c('break-after') || c('page-break-after'))) o.keepWithNext = true;
    // break-before: avoid は、直前の箱との間で分けない (CSS Fragmentation 3 §3.1。例: 索引の項目の直後の説明)
    if (avoids(c('break-before') || c('page-break-before'))) o.keepWithPrevious = true;
    // clear: その側の回り込みの下まで下げる (左右は行の始端・終端。右から左へ書く段落では入れ替わる)
    const cl = c('clear');
    if (cl && cl !== 'none') {
      const rtl = c('direction') === 'rtl';
      o.clear = cl === 'both' ? 'both' : /^(inline-)?start$/.test(cl) || cl === (rtl ? 'right' : 'left') ? 'start' : 'end';
    }
    const id = pseudo ? null : el.getAttribute('id');
    if (id) o.id = id;
    // visibility: hidden・collapse の箱は、背景・影を描かず、枠は太さを残して色を transparent にする (場所は変えない。CSS 2.1 §11.2)
    if (/^(hidden|collapse)$/.test(c('visibility'))) {
      delete o.backgroundColor;
      delete o.backgroundImage;
      delete o.boxShadow;
      if (o.border) for (const sd of Object.values(o.border)) if (sd) sd.color = 'transparent';
    }
    return o;
  }

  /**
   * 互換モードの html・body の高さ (Quirks Mode Standard §3.6・§3.7。https://quirks.spec.whatwg.org/ 、2026-11-04 取得)。
   * html の枠の箱の block 方向の寸法は、初期包含ブロック (ページの本文領域。areaW・areaH は mm) から html の余白を引いた値以上。
   * body の枠の箱は、html の内容の箱から body の余白を引いた値以上。body の内容の寸法の最小値 (pt) を返す (当たらなければ undefined)。
   * body の block 方向の両側に罫線か内側の余白があるときだけ広げる。無い側では、子の余白が body の余白と相殺されて body の外に出るので、
   * 広げた body と合わせてページからあふれる (仕様の margins は body の余白の使用値で、相殺した余白をどう数えるかは書いていない)。
   * 両側に罫線も内側の余白も無い body は、背景のほかに描くものが無い
   */
  private quirkBodyFill(html: Element, body: Element, wm: WritingMode, areaW: number, areaH: number): number | undefined {
    if (!isQuirksDoc(html.ownerDocument as Document | null) || html.localName !== 'html' || body === html) return undefined;
    const PT = 72 / 25.4;
    const vert = wm !== 'horizontal-tb';
    const [a, b] = vert ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
    const sizeProp = vert ? 'width' : 'height';
    const len = (e: Element, p: string) => cssLen(this.cs(e)(p)) ?? 0;
    const edges = (e: Element, kind: 'margin' | 'padding' | 'border') => (kind === 'border' ? len(e, `border-${a}-width`) + len(e, `border-${b}-width`) : len(e, `${kind}-${a}`) + len(e, `${kind}-${b}`));
    const isAuto = (e: Element) => this.src.isAuto?.(e, sizeProp) ?? this.cs(e)(sizeProp) === 'auto';
    // §3.6: html の内容の箱の block 方向の寸法
    const hc = this.cs(html);
    const htmlBorderBox = isAuto(html) ? (vert ? areaW : areaH) * PT - edges(html, 'margin') : undefined;
    const htmlContent = htmlBorderBox !== undefined ? htmlBorderBox - edges(html, 'padding') - edges(html, 'border') : hc('box-sizing') === 'border-box' ? len(html, sizeProp) - edges(html, 'padding') - edges(html, 'border') : len(html, sizeProp);
    // §3.7: body の条件 (寸法が auto・絶対配置でない・float でない・行内でない・段をまたがない)
    const c = this.cs(body);
    if (!(len(body, `border-${a}-width`) + len(body, `padding-${a}`) > 0 && len(body, `border-${b}-width`) + len(body, `padding-${b}`) > 0)) return undefined;
    if (!isAuto(body) || /^(absolute|fixed)$/.test(c('position')) || (c('float') || 'none') !== 'none' || /^inline/.test(this.display(body)) || c('column-span') === 'all') return undefined;
    const content = htmlContent - edges(body, 'margin') - edges(body, 'padding') - edges(body, 'border');
    return content > 0 ? content : undefined;
  }

  /**
   * 互換モードで、行内の img が、幅が auto の表のセルを包含ブロックとする行の並び (inline formatting context) の中にあるか
   * (Quirks Mode Standard §3.8。https://quirks.spec.whatwg.org/ 、2026-11-04 取得)。行内の要素だけをたどって、セルに着けば当たり
   */
  private inAutoCellIfc(el: Element): boolean {
    if (!isQuirksDoc(el.ownerDocument as Document | null)) return false;
    if (this.display(el) !== 'inline') return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const d = this.display(p);
      if (d === 'table-cell') return this.src.isAuto?.(p, 'width') ?? this.cs(p)('width') === 'auto';
      if (d !== 'inline' && d !== 'contents') return false;
    }
    return false;
  }

  private display(el: Element): string {
    return this.cs(el)('display') || 'inline';
  }

  /** 文字列の空白の扱い (white-space)。和文どうしの間の改行は詰める (CSS Text 3 の segment break の扱い) */
  private text(raw: string, parent: Element): string {
    // 特殊な空白: 改行する幅の空白 (U+2000〜U+200A など) は普通の空白にする。改行しない U+202F・U+2007 はそのまま
    // (書体が持たなければ、決まった幅の空白として測る)
    let t = raw.replace(/[\u2000-\u2006\u2008-\u200A\u205F]/g, ' ');
    // アンテナハウスの -ah-linefeed-treatment: ignore (XSL §7.16.7): 改行を捨てる (空白にもしない)
    if (this.inh(parent, 'linefeed-treatment', true) === 'ignore') t = t.replace(/\r\n?|\n/g, '');
    const ws = this.cs(parent)('white-space') || 'normal';
    if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces') return t.replace(/\r\n?/g, '\n');
    let s = t.replace(/\r\n?/g, '\n').replace(/[ \t]*\n[ \t]*/g, '\n');
    // 改行 (CSS Text 3 §4.1.3): 続いた改行は 1 つにまとめ、残った改行は、前後の字で空白にするか消すかを決める (決め方は UA に任されている)。
    // ここでは、前後が和文なら消し、それ以外は空白にする (pre-line は改行のまま)。前後の字は見るだけで、置き換えには含めない
    // (含めると、1 字だけの行が続くとき (あ\nい\nう) に、次の改行の前の字を見られない)
    if (ws !== 'pre-line')
      s = s.replace(/\n+/g, (m, at: number, all: string) => {
        const a = Array.from(all.slice(Math.max(0, at - 2), at)).pop() ?? '';
        const cp = all.codePointAt(at + m.length);
        const b = cp === undefined ? '' : String.fromCodePoint(cp);
        return CJK.test(a) && CJK.test(b) ? '' : ' ';
      });
    return s.replace(/[ \t]+/g, ' ');
  }

  /**
   * flex・grid の容器 (el) をふつうのブロックとして組むときの、display: contents の子 (e) の中身: ::before・::after、続いた文字の並び
   * (無名の項目。字の書式は e から受け継ぐ)、子の要素 (ブロック化した項目)。項目ごとに marks に区切りと order を足す (flowChildren が並べ替える)
   */
  private flexContentsItems(e: Element, el: Element, items: FlowItem[], marks: Array<{ at: number; order: number }>, orderOf: (x: Element, ps?: '::before' | '::after') => number) {
    marks.push({ at: items.length, order: orderOf(e, '::before') });
    this.lastPseudoText['::before'] = '';
    this.pseudo(e, '::before', items);
    let run = '';
    const flush = () => {
      if (run.trim()) {
        marks.push({ at: items.length, order: 0 });
        const fi: FlowItem[] = this.decorateText(this.text(run, e), e).map((v) => ({ v, block: false }));
        items.push({ v: { type: 'block', ...this.textStyle(e, el), children: this.collapseFlowWhitespace(fi, /^pre/.test(this.cs(e)('white-space'))) } as LBlock, block: true });
      }
      run = '';
    };
    for (const n of Array.from(e.childNodes)) {
      if (n.nodeType === 3 || n.nodeType === 4) {
        run += n.textContent ?? '';
        continue;
      }
      if (n.nodeType !== 1) continue;
      const k = n as Element;
      const d = this.display(k);
      if (d === 'none') continue;
      flush();
      if (d === 'contents') {
        this.flexContentsItems(k, el, items, marks, orderOf);
        continue;
      }
      marks.push({ at: items.length, order: orderOf(k) });
      this.enterCounters(this.cs(k), e);
      this.bookmark(k);
      const node = (this.isBlock(d, k) ? this.block(k, el) : undefined) ?? ({ type: 'block', ...this.textStyle(k, el), ...this.boxStyle(k), children: this.inline(k, el) } as LBlock);
      items.push({ v: this.withFlexGrow(node, k, el), block: true });
    }
    flush();
    marks.push({ at: items.length, order: orderOf(e, '::after') });
    this.lastPseudoText['::after'] = '';
    this.pseudo(e, '::after', items);
    this.leaveCounters(e);
  }

  /**
   * 高さの決まった縦並びの flex の容器 (el) の項目 (e) なら、flex-grow をブロックの flexGrow に写す (Flexbox 1 §9.7。組版エンジンが余った高さを
   * 比で分ける)。ブロックでなければ包む
   */
  /** 要素の書字方向が縦書きなら、プロパティの名前の読み替え (axisMapper)。横書きなら、そのまま */
  private axisOf(el: Element): (n: string) => string {
    const wm = this.cs(el)('writing-mode');
    return /^(vertical|sideways|tb)/.test(wm) ? axisMapper(wm) : (n: string) => n;
  }

  /**
   * 縦並びの flex の容器 (el) の項目 (e) のブロックに、主軸 (縦並びでは横書きの高さ・縦書きの幅) の flex の値を付ける: flex-basis、
   * 交差軸の寄せ (背景・枠のある項目の箱)、高さの決まった容器なら伸ばす比・縮める比と下限・主軸の auto の余白、折り返しなら列の中の揃え。
   * 縦書きの容器は、プロパティの名前を読み替えて (axisMapper) 横書きと同じに扱う
   */
  private withFlexGrow(b: LBlockLevel, e: Element, el: Element): LBlockLevel {
    if (!/^(inline-)?flex$/.test(this.display(el))) return b;
    const L = this.axisOf(el);
    const c0 = this.cs(el);
    const c = (n: string) => c0(L(n));
    if (!/^column/.test(c('flex-direction'))) return b;
    const vert = /^(vertical|sideways|tb)/.test(c0('writing-mode'));
    const e0 = this.cs(e);
    const ec = (n: string) => e0(L(n));
    const autoOf = (x: Element, p: 'width' | 'height') => this.src.isAuto?.(x, L(p) as 'width' | 'height');
    // 主軸 (main) と交差軸 (cross) の大きさの物理の名前 (縦書きでは width と height が入れ替わる)
    const main = L('height') as 'height' | 'width';
    const cross = L('width') as 'height' | 'width';
    const len = (v: string) => cssLen(v) ?? 0;
    const vpad = (cc: (n: string) => string) => len(cc('padding-top')) + len(cc('padding-bottom')) + len(cc('border-top-width')) + len(cc('border-bottom-width'));
    const hpad = (cc: (n: string) => string) => len(cc('padding-left')) + len(cc('padding-right')) + len(cc('border-left-width')) + len(cc('border-right-width'));
    /** 中身の幅の見積もり (交差軸。縦書きでは行の向きの大きさ) */
    const measure = (x: Element) => {
      const prev = this.axisMap;
      this.axisMap = vert ? L : undefined;
      try {
        return this.maxContentWidth(x);
      } finally {
        this.axisMap = prev;
      }
    };
    const crossW = vert ? this.verticalInlineSize(el) : (this.src.contentWidth?.(el) ?? 0) * PT_PER_PX;
    // 容器の主軸の内容の大きさ (決まっていれば)。flex-basis の % の基準
    const fixed = autoOf(el, 'height') === false && cssLen(c('height')) !== undefined;
    const H = fixed ? cssLen(c('height'))! - (c('box-sizing') === 'border-box' ? vpad(c) : 0) : undefined;
    const extra: Partial<LBlock> = {};
    // flex-basis (主軸の大きさ。Flexbox 1 §7.2): 長さか、容器の主軸の大きさが決まっていれば %。auto・content は中身の大きさ (今のまま)
    const fb = ec('flex-basis');
    const basis = !fb || fb === 'auto' || /content$/.test(fb) ? undefined : /%$/.test(fb) ? (H !== undefined ? (parseFloat(fb) * H) / 100 : undefined) : cssLen(fb);
    if (basis !== undefined) {
      extra[main] = basis;
      if (ec('box-sizing') === 'border-box') extra.boxSizing = 'border-box';
    }
    // 交差軸の揃えの center・end: 背景・枠のある項目は、箱を中身の幅にして寄せる (Flexbox 1 §8.3。字だけ寄せると、箱は容器いっぱいのまま)
    const al = this.flexItemAlign.get(e);
    const box = b as LBlock;
    if (al && b.type === 'block' && autoOf(e, 'width') !== false && (box.border || box.backgroundColor || box.backgroundImage)) {
      const inner = measure(e) - (ec('box-sizing') === 'border-box' ? 0 : hpad(ec)) + FLEX_SLACK;
      extra[cross] = crossW ? Math.min(inner, crossW - (ec('box-sizing') === 'border-box' ? 0 : hpad(ec))) : inner;
      if (ec('box-sizing') === 'border-box') extra.boxSizing = 'border-box';
      // 'start' は始めの側の余白に足す (箱は終わりへ寄る)
      extra.autoMargins = al === 'center' ? 'center' : 'start';
    }
    if (H === undefined) return this.withExtra(b, extra);
    const wrap = c('flex-wrap') !== 'nowrap';
    // 伸ばす比 (§9.7) と、主軸の margin: auto (§8.1)。項目は見た目の順に並べてあるので、column-reverse でも主軸の始めの側の余白が前
    const g = parseFloat(ec('flex-grow')) || 0;
    if (g > 0) extra.flexGrow = g;
    const top = ec('margin-top') === 'auto';
    const bottom = ec('margin-bottom') === 'auto';
    if (top || bottom) extra.flexAutoMargin = { before: top, after: bottom };
    if (wrap) {
      // 折り返し: 項目は列に並ぶので、交差軸の大きさの決まらない項目は中身の幅 (見積もり) にし、align-items: stretch なら組版エンジンが
      // 列の幅まで広げる。伸ばす比と auto の余白は、列ごとに組版エンジンが分ける。縮めはしない (入りきらない項目は次の列へ移る)
      if (autoOf(e, 'width') !== false && extra[cross] === undefined) {
        const inner = measure(e) - (ec('box-sizing') === 'border-box' ? 0 : hpad(ec)) + FLEX_SLACK;
        extra[cross] = crossW ? Math.min(inner, crossW) : inner;
        if (ec('box-sizing') === 'border-box') extra.boxSizing = 'border-box';
      }
      // 列の中の揃え (wrap-reverse は交差軸の向きが逆。Flexbox 1 §5.2・§8.3): stretch は列の幅まで広げ、ほかは寄せる (baseline は start)
      const as = ec('align-self');
      const x = flexCross(as && as !== 'auto' ? as : c('align-items'), c('flex-wrap') === 'wrap-reverse');
      if (x === 'stretch') {
        if (autoOf(e, 'width') !== false) extra.flexWrapStretch = true;
      } else if (x === 'center' || x === 'end' || x === 'last-baseline') extra.flexWrapAlign = x === 'center' ? 'center' : 'end';
      delete extra.autoMargins;
      return this.withExtra(b, extra);
    }
    // 縮める比 (既定 1) と下限: min-height の指定があればそれ (枠・内側の余白を足す)、overflow が visible でなければ枠・内側の余白だけ、
    // どちらでもなければ組版エンジンが中身の大きさにする (§4.5 の自動の最小の大きさ)
    const sh = parseFloat(ec('flex-shrink'));
    const shrink = Number.isFinite(sh) && sh >= 0 ? sh : 1;
    if (shrink > 0) {
      extra.flexShrink = shrink;
      const mh = ec('min-height');
      const pad = ec('box-sizing') === 'border-box' ? 0 : vpad(ec);
      if (mh && mh !== 'auto' && cssLen(mh) !== undefined) extra.flexMin = cssLen(mh)! + pad;
      else if (!/^(visible|clip)?$/.test(ec('overflow-y') || ec('overflow'))) extra.flexMin = vpad(ec);
    }
    return this.withExtra(b, extra);
  }

  /** ブロックに flex の値を付ける (ブロックでなければ包む) */
  private withExtra(b: LBlockLevel, extra: Partial<LBlock>): LBlockLevel {
    if (!Object.keys(extra).length) return b;
    if (b.type === 'block') return Object.assign(b, extra);
    return { type: 'block', ...extra, children: [b] } as LBlock;
  }

  /** ブロックの中身: 文字列・インライン・ブロックを並べ、ブロック境界の空白を除く */
  /**
   * flex・grid の容器の子のうち display: contents のものを、その子に置き換える (CSS Display 3 §2.5: 箱を作らず、子が項目になる)。
   * 直下に文字があるもの、::before・::after のあるものは、置き換えない (受け継ぐ書式と疑似要素を失わないように)
   */
  private expandContents(kids: Node[]): Node[] {
    return kids.flatMap((n) => {
      const e = n.nodeType === 1 ? (n as Element) : undefined;
      if (!e || this.display(e) !== 'contents') return [n];
      if (Array.from(e.childNodes).some((x) => (x.nodeType === 3 || x.nodeType === 4) && (x.textContent ?? '').trim())) return [n];
      if (this.hasPseudoContent(e, '::before') || this.hasPseudoContent(e, '::after')) return [n];
      return this.expandContents(Array.from(e.childNodes));
    });
  }

  /** 流し込む項目 (ブロックか行の中のもの) */
  private flowChildren(el: Element, inline = false): Array<LBlockLevel | LInlineLevel> {
    const items: FlowItem[] = [];
    // flex・grid の容器をふつうのブロックとして組むとき (縦並びの flex など) も、項目は order の順 (order-modified document order。
    // CSS Flexbox 1 §5.4) に並べる。::before・::after も項目 (§4)。項目ごとに items の区切り (at) と order を覚え、最後に並べ替える。
    // 続いた文字の並びは 1 つの無名の項目で、order は 0
    const flexBox = /^(inline-)?(flex|grid)$/.test(this.display(el));
    const marks: Array<{ at: number; order: number }> = [];
    const orderOf = (e: Element, ps?: '::before' | '::after') => (!ps && /^(absolute|fixed)$/.test(this.cs(e)('position')) ? 0 : parseInt(this.cs(e, ps)('order'), 10) || 0);
    if (flexBox) marks.push({ at: 0, order: orderOf(el, '::before') });
    this.lastPseudoText['::before'] = '';
    this.pseudo(el, '::before', items);
    const before = this.lastPseudoText['::before'];
    // 参照先の番号は、要素 (と ::before) のカウンターを当てた直後の値
    let snap: Record<string, number> | undefined;
    const elId = el.getAttribute?.('id');
    if (elId && !this.lookup) {
      snap = {};
      for (const [n, st] of this.counters) if (st.length) snap[n] = st[st.length - 1].v;
    }
    // 要素の content (normal 以外) は、中身を置き換える (Content 3 §1.2)。ただし空の文字列 ('') は、その要素に ::before / ::after の
    // content が無ければ何もしない (footer { content: '' } で中身を捨てない。ブラウザ・WeasyPrint は要素の文字列の content を解釈しない)
    const own = this.pg(el).content;
    const pseudoContent = (w: '::before' | '::after') => {
      const v = this.pagedPseudo.get(el)?.[w]?.content ?? this.cs(el, w)('content');
      return !!v && v !== 'none' && v !== 'normal';
    };
    const emptyOwn = own !== undefined && /^\s*(''|"")\s*$/.test(own) && !pseudoContent('::before') && !pseudoContent('::after');
    const replaced = own !== undefined && own !== 'normal' && own !== 'none' && !emptyOwn;
    if (flexBox && replaced) marks.push({ at: items.length, order: 0 });
    if (replaced) for (const v of this.evalContent(el, parseContent(own))) items.push({ v, block: false });
    let kids = replaced ? [] : Array.from(el.childNodes);
    // content-visibility: hidden は中身 (子孫の字と要素) を組まない (Contain 2 §4)
    if (this.cs(el)('content-visibility') === 'hidden') kids = [];
    // 閉じた details は、最初の summary の子だけを出す。ほかの中身は、content-visibility: hidden の slot に入る (HTML Living Standard §15.5.5)
    if (el.localName === 'details' && !el.hasAttribute('open')) {
      const sum = kids.find((n) => n.nodeType === 1 && (n as Element).localName === 'summary');
      kids = sum ? [sum] : [];
    }
    // display: contents の子 (直下に文字が無く、::before・::after も無いもの) は、その子を項目として並べる (CSS Display 3 §2.5)
    if (flexBox) kids = this.expandContents(kids) as ChildNode[];
    let listStarted = false;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (flexBox && (n.nodeType !== 3 || i === 0 || kids[i - 1].nodeType !== 3)) marks.push({ at: items.length, order: n.nodeType === 1 ? orderOf(n as Element) : 0 });
      if (n.nodeType === 3 || n.nodeType === 4) {
        const t = this.text(n.textContent ?? '', el);
        if (t) for (const v of this.decorateText(t, el)) items.push({ v, block: false });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const d = this.display(e);
      if (d === 'none') continue;
      // flex の容器の visibility: collapse の項目は、主軸から外す (Flexbox 1 §4.4)
      if (flexBox && /flex$/.test(this.display(el)) && this.cs(e)('visibility') === 'collapse') continue;
      const pg = this.pg(e);
      // 名前付きページ (body の直下のブロック): ページの名前が変わるところで、ページシーケンスを分ける
      // page は class A の区切りを作る箱 (流れの中のブロック) に効く (CSS Page 3 §8.1)。絶対配置・固定配置・float の箱は、ページの名前を変えない
      if (el === this.bodyEl && this.isBlock(d, e) && !/^(absolute|fixed)$/.test(this.cs(e)('position')) && (this.cs(e)('float') || 'none') === 'none') this.flowPageSwitch(e, pg, items);
      if (d !== 'list-item') this.enterCounters(this.cs(e), el);
      else {
        // リストの項目: 容器の list-item カウンターの暗黙の reset は、容器ごとに 1 度だけ (Lists 3 §4.6。項目の並びが、ほかの子や
        // 流れの外の項目で切れても、番号は続く)。項目のカウンターは、しおり・string-set の値を読む前に当てる (§4 の順)
        if (!listStarted) this.listStart(el, kids);
        listStarted = true;
        this.listItemCounters(e, el);
      }
      this.bookmark(e);
      // string-set: 要素の前にマーカーを置く (インラインの中なら、段落の外へ出す)
      for (const m of this.stringSet(e)) this.pushMarker(m, inline, items);
      if (this.flowRunning(e, el, d, pg, inline, items)) continue;
      if (this.flowFootnote(e, el, pg, items)) continue;
      if (this.flowFloat(e, el, pg, items)) continue;
      // position: absolute は本文領域を基準にそのページへ、fixed は全ページに置く
      const pos = this.cs(e)('position');
      if ((pos === 'absolute' || pos === 'fixed') && this.cs(e)('visibility') === 'hidden') {
        // 見えない箱も飛び先にはなる (visibility: hidden は箱を描かないだけ。CSS 2.1 §11.2): id (しおり・リンクの飛び先) があれば、
        // 高さの無い印を残す (book の表題の h1 { position: absolute; visibility: hidden } のしおりなど)
        const hid = e.getAttribute('id');
        if (hid) {
          const mark = { type: 'block', id: hid, children: [] } as LBlock;
          this.outOfFlowMarks.add(mark);
          items.push({ v: mark, block: true });
        }
        continue;
      }
      if (this.flowPositioned(e, el, pos, items)) continue;
      if (/^table-(row|cell|row-group|header-group|footer-group|caption|column|column-group)$/.test(d)) {
        // 表の外の表の部分 (セル・行など): 続くものをまとめて、匿名の表で包む (CSS 2.1 §17.2.1)
        const parts = this.siblingRun(kids, i, (x) => /^table-(row|cell|row-group|header-group|footer-group|caption|column|column-group)$/.test(this.display(x)));
        i = parts.last;
        items.push({ v: this.table(el, el, parts.elements), block: true });
        continue;
      }
      if (d === 'list-item') {
        // 続く list-item をまとめて 1 つのリスト (2 列の表) にする。流れの外の項目 (回り込み・脚注・絶対配置・running()) は並びに入れず、
        // 上の前処理 (flowFloat など) を通す (float・position は list-item の箱にも効く。CSS 2.1 §9.7)
        const lis = this.siblingRun(kids, i, (x) => this.display(x) === 'list-item' && !this.outOfFlow(x));
        i = lis.last;
        items.push({ v: this.list(el, lis.elements), block: true });
        continue;
      }
      if (flexBox && d === 'contents') {
        // flex・grid の容器の中の display: contents (直下の文字か ::before・::after を持つもの。ほかは expandContents で展開済み):
        // 中の文字の並び・疑似要素・子の要素を、それぞれ項目として並べる (CSS Display 3 §2.5・Flexbox 1 §4)
        this.flexContentsItems(e, el, items, marks, orderOf);
        continue;
      }
      if (d === 'contents' && this.hasBlockChild(e)) {
        // display: contents (CSS Display 3 §2.5): 要素自身は箱を作らず、子がその場所に入る。ブロックの子を持つときは、
        // 箱の書式 (罫線・背景・余白) を持たない入れ物のブロックで包み、受け継ぐ書式 (字の色・大きさ・揃えなど) だけを子に渡す
        items.push({ v: { type: 'block', ...this.textStyle(e, el), ...this.paragraphStyle(e, el), children: this.flowChildren(e) } as LBlock, block: true });
      } else if (this.isBlock(d, e)) {
        const b = this.block(e, el);
        if (b) items.push({ v: this.withFlexGrow(b, e, el), block: true });
      } else {
        for (const v of this.inline(e, el)) items.push({ v, block: false });
      }
      if (!inline) for (const m of this.pendingMarkers.splice(0)) items.push({ v: m, block: false });
    }
    if (flexBox) marks.push({ at: items.length, order: orderOf(el, '::after') });
    this.lastPseudoText['::after'] = '';
    this.pseudo(el, '::after', items);
    // column-reverse は項目を逆の順に積む (Flexbox 1 §5.1。row-reverse は flexNoRect で並べ替える)
    const reverse = flexBox && /flex$/.test(this.display(el)) && this.cs(el)('flex-direction') === 'column-reverse';
    // 縦並びの flex の項目の間の空き (row-gap。CSS Box Alignment 3 §8: % は容器の高さが決まっていればその割合、決まらなければ 0)
    const column = flexBox && /flex$/.test(this.display(el)) && /^column/.test(this.cs(el)('flex-direction'));
    const rg = column ? this.cs(el)('row-gap') : '';
    // 主軸の大きさ (横書きは高さ、縦書きは幅) が決まっていれば、% の基準
    const mainP = this.axisOf(el)('height') as 'height' | 'width';
    const fixedH = this.src.isAuto?.(el, mainP) === false ? cssLen(this.cs(el)(mainP)) : undefined;
    const rowGap = !rg || rg === 'normal' ? 0 : /%$/.test(rg) ? (fixedH !== undefined ? (parseFloat(rg) * fixedH) / 100 : 0) : (cssLen(rg) ?? 0);
    if (marks.length && (reverse || rowGap > 0 || marks.some((m) => m.order !== 0))) {
      const segs = marks.map((m, k) => ({ order: m.order, v: items.slice(m.at, marks[k + 1]?.at ?? items.length) }));
      segs.sort((a, b) => a.order - b.order);
      if (reverse) segs.reverse();
      // 空き: 中身のある項目 (空白だけの文字でないもの) の間に、高さだけの空のブロックを置く
      const filled = (g: { v: FlowItem[] }) => g.v.some((x) => x.block || (typeof x.v === 'string' ? x.v.trim() !== '' : true));
      const out: FlowItem[] = [];
      let seen = false;
      for (const g of segs) {
        if (rowGap > 0 && filled(g)) {
          // 空きは主軸の向きの大きさ (横書きは高さ、縦書きは幅)
          if (seen) out.push({ v: { type: 'block', [mainP]: rowGap, children: [] } as LBlock, block: true });
          seen = true;
        }
        out.push(...g.v);
      }
      items.splice(0, items.length, ...out);
    }
    if (snap && elId) this.record.set(elId, { counters: snap, text: this.wantText ? this.plainText(el) : '', before, after: this.lastPseudoText['::after'] });
    this.leaveCounters(el);
    return this.collapseFlowWhitespace(items, /^pre/.test(this.cs(el)('white-space')));
  }

  /** マーカー (string-set・running) を置く: インラインの中なら段落の外へ出す (pendingMarkers)、ブロックの中ならその場所に */
  private pushMarker(m: LMarker, inline: boolean, items: FlowItem[]) {
    if (inline) this.pendingMarkers.push(m);
    else items.push({ v: m, block: false });
  }

  /** 流れの外の箱の代わりに置いた印 (見えない絶対配置の箱の id の印)。ページの名前の切り替えでは、流れの中の箱に数えない */
  private outOfFlowMarks = new WeakSet<object>();

  /** body の直下の項目が、流れの中の箱 (か字) か: 空白・マーカー・回り込み・絶対配置の箱・見えない絶対配置の箱の印は、流れの中の箱ではない */
  private inFlowItem(x: LBlockLevel | LInlineLevel): boolean {
    if (typeof x === 'string') return !!x.trim();
    if (this.outOfFlowMarks.has(x)) return false;
    const n = x as { type?: string; absolutePosition?: boolean };
    return !(n.type === 'marker' || n.type === 'float' || (n.type === 'block-container' && n.absolutePosition));
  }

  /** 名前付きページ: body の直下のブロック e で、ページの名前が変わるところにページシーケンスの切り替え (page-switch) を置く */
  private flowPageSwitch(e: Element, pg: Record<string, string>, items: FlowItem[]) {
    const name = pg.page && pg.page !== 'auto' ? pg.page : '';
    // アンテナハウス互換: 同じ名前でも、強制改ページを持つ要素ごとに新しいページの組にする (pageGroupFirst)
    const forced = /^(page|left|right|recto|verso|always)$/.test(this.cs(e)('break-before') || this.cs(e)('page-break-before') || '');
    if (name !== this.curPage || (this.opts.pageGroupFirst && name && forced)) {
      const sw: PageSwitch = { type: 'page-switch', page: name };
      // カウンターの名前は全体で見る (pagenote・page-x は page ではない)
      const reset = /(?:^|\s)page(?![-\w\u0080-\uffff])(?:\s+(-?\d+))?/.exec(this.cs(e)('counter-reset'));
      if (reset) sw.initial = reset[1] !== undefined ? Math.max(1, parseInt(reset[1], 10)) : 1;
      items.push({ v: sw as unknown as LBlockLevel, block: true });
      this.curPage = name;
    }
  }

  /** position: running(name): 本文から外し、余白の箱の element(name) で出す。扱ったら true */
  private flowRunning(e: Element, parent: Element, d: string, pg: Record<string, string>, inline: boolean, items: FlowItem[]): boolean {
    const run = /running\(\s*([-\w\u0080-\uffff]+)\s*\)/.exec(pg.position ?? '');
    if (!run) return false;
    this.inRunning = true;
    const content = this.isBlock(d, e) ? this.block(e, parent) : ({ type: 'block', children: this.inline(e, parent) } as LBlock);
    this.inRunning = false;
    const m: LMarker = { type: 'marker', className: `running:${run[1]}`, children: content ? [content] : [] };
    this.pushMarker(m, inline, items);
    return true;
  }

  /** float: footnote: 脚注 (参照記号は自動の連番)。扱ったら true */
  private flowFootnote(e: Element, parent: Element, pg: Record<string, string>, items: FlowItem[]): boolean {
    if (pg.float !== 'footnote') return false;
    this.report.counts.footnotes++;
    // 脚注の本文は、要素の書式 (字の大きさ・行送り・揃え) で組む (書式は脚注に付ける。本文の前に番号が付く)
    // 段落の書式 (揃え・字下げ) は親と比べずに全部渡す (脚注の領域の既定は始め揃えなので、親と同じ両端揃えでも渡す)
    const fn: LFootnote = { type: 'footnote', ...this.textStyle(e, parent), ...this.paragraphStyle(e, undefined), children: this.flowChildren(e, true) };
    // 参照番号 (::footnote-call) は、脚注の要素の場所に差し込む擬似要素 (GCPM 3 §2.2・§2.6)。元の脚注の要素から受け継ぐと読み、字の大きさ・太さは脚注の要素の値を
    // ::footnote-call の規則で上書きする (見出しの中の脚注でも、見出しの太字・字の大きさにはならない)
    Object.assign(fn, this.footnoteCallStyle(e, parent));
    items.push({ v: fn, block: false });
    return true;
  }

  /** 回り込みの側 (flowFloat の説明を参照)。回り込みでなければ undefined */
  private floatSideOf(e: Element, pg: Record<string, string>): string | undefined {
    const fl = (pg.float && /\bsidenote\b/i.test(pg.float) ? this.sidenoteSide() : pg.float && pg.float !== 'footnote' ? floatSide(pg.float) : this.cs(e)('float')).replace(/^inline-(start|end)$/, '$1');
    return /^(left|right|inside|outside|top|bottom|before|after|center|alternate|start|end)$/.test(fl) ? fl : undefined;
  }

  /** 流れの外に出す要素か (flowChildren の前処理の flowRunning・flowFootnote・flowFloat・絶対配置・固定配置のどれかに当たる) */
  private outOfFlow(e: Element): boolean {
    const pg = this.pg(e);
    if (/running\(\s*[-\w\u0080-\uffff]+\s*\)/.test(pg.position ?? '') || pg.float === 'footnote' || this.floatSideOf(e, pg)) return true;
    return /^(absolute|fixed)$/.test(this.cs(e)('position'));
  }

  /**
   * float (left / right、ページの組版の inside / outside / top)。扱ったら true。
   * float: sidenote (アンテナハウスの拡張) は、@page の @sidenote の float (left・right・inside・outside・start・end) の側へ。指定が無ければ end。
   * float: inline-start・inline-end (Logical 1 §2.1) は start・end と同じ
   */
  private flowFloat(e: Element, parent: Element, pg: Record<string, string>, items: FlowItem[]): boolean {
    const fl = this.floatSideOf(e, pg);
    if (!fl) return false;
    const fv = this.float(e, parent, fl, !!pg.float && /\bsidenote\b/i.test(pg.float));
    if (pg.float && /\bmulticol\b/i.test(pg.float) && (fl === 'top' || fl === 'before')) {
      this.multicolTop.set(fv, /^\s*([\d.]+)gr\s*$/i.exec(pg.width ?? '')?.[1]);
      if (this.cs(e)('box-sizing') === 'border-box') this.multicolTopBorderBox.add(fv);
    }
    items.push({ v: fv, block: false });
    return true;
  }

  /**
   * 絶対配置・固定配置 (pos は計算値の position)。扱ったら true。
   * 位置の基準になる親 (position: relative など) を基準に置けない (localCb が無い) とき、上下の位置の指定が無い絶対配置の要素は、
   * 左右の回り込みにする (ページを基準にする代わりに、親の中の位置を回り込みで近づける)。ほかの absolute は本文領域を基準にそのページへ、fixed は全ページに置く
   */
  private flowPositioned(e: Element, parent: Element, pos: string, items: FlowItem[]): boolean {
    if (pos === 'absolute' && !this.localCb(e.parentElement) && this.positionedAncestor(e) && this.src.isAuto?.(e, 'top') !== false && this.src.isAuto?.(e, 'bottom') !== false) {
      const right = this.src.isAuto?.(e, 'right') === false;
      const left = this.src.isAuto?.(e, 'left') === false;
      if (right || left) {
        const f = this.float(e, parent, right ? 'right' : 'left');
        const off = cssLen(this.cs(e)(right ? 'right' : 'left')) ?? 0;
        f.margin = { ...(typeof f.margin === 'object' ? f.margin : {}), [right ? 'right' : 'left']: off };
        // 上下の位置は、同じ行の高さ (static position): 回り込みを、いまの行の並び (直前のブロックの後) の先頭に入れる
        let at = items.length;
        while (at > 0 && !items[at - 1].block) at--;
        items.splice(at, 0, { v: f, block: false });
        return true;
      }
    }
    if (pos !== 'absolute' && pos !== 'fixed') return false;
    const cont = this.positioned(e, parent);
    if (pos === 'fixed') this.fixed.push(cont);
    else items.push({ v: cont, block: false });
    return true;
  }

  /**
   * kids[i] から続く、match に合う要素の並び。匿名の表の部分・リストの項目をまとめる。間の、箱を作らないもの (空白だけの文字・
   * コメント・処理命令・display: none の要素) は読み飛ばす: 並びは箱の並びで決まり (CSS 2.1 §17.2.1・§9.2.1.1)、display: none の要素は
   * 箱を作らず、カウンターも動かさない (Lists 3 §4.5)。last は並びの最後の子の位置 (呼び出し側はそこまで読み終えたことにする)
   */
  private siblingRun(kids: Node[], i: number, match: (e: Element) => boolean): { elements: Element[]; last: number } {
    const elements: Element[] = [kids[i] as Element];
    while (i + 1 < kids.length) {
      const nx = kids[i + 1];
      if ((nx.nodeType === 3 && !(nx.textContent ?? '').trim()) || nx.nodeType === 8 || nx.nodeType === 7 || (nx.nodeType === 1 && this.display(nx as Element) === 'none')) {
        i++;
        continue;
      }
      if (nx.nodeType === 1 && match(nx as Element)) {
        elements.push(nx as Element);
        i++;
        continue;
      }
      break;
    }
    return { elements, last: i };
  }

  /** 隣り合う文字列をつなぎ、ブロック境界の空白を除く (pre は white-space: pre*。空白をそのまま残す) */
  private collapseFlowWhitespace(items: FlowItem[], pre: boolean): Array<LBlockLevel | LInlineLevel> {
    const merged: FlowItem[] = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      if (typeof it.v === 'string' && last && typeof last.v === 'string') last.v += it.v;
      else merged.push({ ...it });
    }
    const out: Array<LBlockLevel | LInlineLevel> = [];
    merged.forEach((it, k) => {
      if (typeof it.v !== 'string' || pre) {
        out.push(it.v);
        return;
      }
      let t = it.v;
      // 行の頭・終わりの空白は消す (CSS Text 3 §4.1.2)。間にある float・マーカー (行の中に場所を取らない) は飛ばして見る
      const outOfFlow = (m: FlowItem) => typeof m.v !== 'string' && (m.v.type === 'float' || m.v.type === 'marker');
      const edge = (from: number, step: number) => {
        for (let j = from; j >= 0 && j < merged.length; j += step) {
          if (merged[j].block) return true;
          // 空白だけの文字列 (行の頭・終わりで消える) も飛ばす
          if (!outOfFlow(merged[j]) && !(typeof merged[j].v === 'string' && !(merged[j].v as string).trim())) return false;
        }
        return true;
      };
      const atStart = edge(k - 1, -1);
      const atEnd = edge(k + 1, 1);
      if (atStart) t = t.replace(/^ /, '');
      if (atEnd) t = t.replace(/ $/, '');
      // ブロックの境界 (行の頭・終わり) に接する、空白だけの文字列は捨てる。br の改行 (HTML の既定のスタイルは br { display-outside: newline }、
      // 強制改行) は残す。これを CSS 2.1 §9.4.2 の「保たれた改行で終わる行」と読み、高さ 0 の行として扱わない。
      // インラインの間の空白 (無名のブロックの行の中。CSS 2.1 §9.2.1.1) は、ほかにブロックの子があっても残す
      const boundary = (atStart || atEnd) && merged.some((m) => m.block);
      if (t.trim() === '' && !t.includes('\n') && boundary) t = '';
      else if (t.trim() === '' && boundary) t = t.replace(/[^\n]/g, '');
      if (t) out.push(t);
    });
    return out;
  }

  /** display: contents の要素が、ブロックになる子 (入れ子の display: contents の中も見る) を持つか */
  private hasBlockChild(e: Element): boolean {
    return Array.from(e.children).some((k) => {
      const d = this.display(k);
      return d === 'contents' ? this.hasBlockChild(k) : d !== 'none' && this.isBlock(d, k);
    });
  }

  private isBlock(d: string, e: Element): boolean {
    // block math・block ruby は、短い書き方の無い 2 値の display (Display 3 §2.2)
    if (/^(block|flow-root|table|list-item|flex|grid|block math|block ruby)$/.test(d)) return true;
    // 表の部品は表の中で扱う。単独で現れたらブロックとして扱う
    if (/^table-/.test(d)) return true;
    return this.isMath(e) && (this.cs(e)('display') === 'block' || this.mathBlock(e));
  }

  /** MathML の math 要素 (HTML の構文で読んだ <math>、XHTML から書き直した math) */
  private isMath(e: Element): boolean {
    return e.localName === 'math' && (!e.namespaceURI || /\/(1998\/Math\/MathML|1999\/xhtml)$/.test(e.namespaceURI));
  }

  /**
   * display="block" の math 要素 (MathML Core の既定のスタイル: math[display="block" i] { display: block math }。
   * 作成者スタイルシート が display を inline 以外にしていれば、そちらに従う。
   * https://www.w3.org/TR/2025/CR-mathml-core-20250624/ 付録 A、2026-11-04 取得)
   */
  private mathBlock(e: Element): boolean {
    return /^block$/i.test(e.getAttribute('display')?.trim() ?? '') && /^(inline|math|)$/.test(this.cs(e)('display'));
  }

  /**
   * math 要素を、数式用の書体の MATH 表の値で組み (mathLayout)、字の輪郭の SVG の画像にする。
   * 画像の下端を、数式の基線から下の深さだけ、行の基線より下げる (XSL-FO の読み込みと同じ)
   */
  private mathFormula(el: Element): LInlineLevel {
    const c = this.cs(el);
    const r = layoutMathML(el as unknown as MNode, {
      font: this.opts.mathFont!,
      fallback: this.opts.mathFallback,
      size: cssLen(c('font-size')) ?? 10.5,
      lineWidth: this.area.width,
      color: cssColor(c('color')) ?? '#000000',
      parseColor: (v) => cssColor(v),
    });
    const bytes = new TextEncoder().encode(r.svg);
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    const src = `data:image/svg+xml;base64,${btoa(bin)}`;
    if (!this.report.images.includes(src)) this.report.images.push(src);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const img: LImage = { type: 'image', src, width: r2(r.width), height: r2(r.ascent + r.descent) };
    const alt = el.getAttribute('alttext');
    if (alt) img.alt = alt;
    return r.descent > 0 ? { type: 'inline', baselineShift: -r2(r.descent), children: [img] } : img;
  }

  /** ::before / ::after の content (文字列・counter()・attr()・target-counter()・leader()) */
  private pseudo(el: Element, which: '::before' | '::after', items: Array<{ v: LBlockLevel | LInlineLevel; block: boolean }>) {
    const c = this.cs(el, which);
    const content = this.pagedPseudo.get(el)?.[which]?.content ?? c('content');
    if (!content || content === 'none' || content === 'normal') return;
    this.enterCounters(c, el);
    this.countQuotes = true;
    const parts = this.evalContent(el, parseContent(content), which);
    this.countQuotes = false;
    this.lastPseudoText[which] = parts.filter((x): x is string => typeof x === 'string').join('');
    if (this.wantText) this.pseudoTextOf.set(el, { ...this.pseudoTextOf.get(el), [which]: this.lastPseudoText[which] });
    // 絶対配置の ::before / ::after (章の扉の背景画像など): 本文領域を基準にした箱にする
    const pos = c('position');
    if (pos === 'absolute' || pos === 'fixed') {
      items.push({ v: this.positionedPseudo(el, which, parts), block: false });
      return;
    }
    // 中身が空でも、ブロックの箱は作る (クリアフィックスの content: ""; display: table; clear: both)
    if (!parts.length && !/^(block|table|flow-root|list-item)$/.test(c('display'))) return;
    if (!parts.length && c('float') !== 'none') return;
    const style = this.textStyle(el, el, which);
    // float: right / left の ::after / ::before (目次のページ番号など): 行の右端 / 左端に寄せる (空白のリーダーで押す)
    const fl = c('float');
    if (fl === 'right' || fl === 'left') {
      // 大きさや背景のある回り込み (アイコンなど): その大きさの箱を回り込ませる
      const w = cssLen(c('width'));
      const h = cssLen(c('height'));
      const bgc = cssColor(c('background-color'));
      const bu = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(c('background-image'));
      const bgrad = bu ? undefined : firstGradient(c('background-image'));
      if ((w && h) || bgc || bu || bgrad) {
        const boxC: LBlockContainer = { type: 'block-container', children: parts.some((x) => x !== '') ? [{ type: 'block', ...style, children: parts }] : [] };
        if (w) boxC.width = w;
        if (h) boxC.height = h;
        if (bgc) boxC.backgroundColor = bgc;
        if (bu) {
          const img: BackgroundImage = { src: normalizeSrc(bu[1]) };
          const bsz = c('background-size').split(',')[0].trim();
          if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
          else {
            // 百分率は箱の大きさに対して (高さが auto なら縦横比を保つ)
            const [sw, sh] = bsz.split(/\s+/);
            const len = (v: string | undefined, room: number | undefined) => (v && /%$/.test(v) && room ? (room * parseFloat(v)) / 100 : cssLen(v ?? ''));
            const ww = len(sw, w);
            const hh = sh && sh !== 'auto' ? len(sh, h) : undefined;
            if (ww) img.width = ww;
            if (hh) img.height = hh;
          }
          setBackgroundPosition(img, c('background-position-x'), c('background-position-y'));
          if (/no-repeat/.test(c('background-repeat'))) img.repeat = 'no-repeat';
          boxC.backgroundImage = img;
          this.report.images.push(img.src);
        }
        if (bgrad) boxC.backgroundImage = { src: '', gradient: bgrad, gradientFontSize: cssLen(c('font-size')) ?? 12 };
        const mg: Record<string, number> = {};
        for (const sd of ['top', 'right', 'bottom', 'left']) {
          const v = cssLen(c(`margin-${sd}`));
          if (v) mg[sd] = v;
        }
        const f: LFloat = { type: 'float', float: fl === 'left' ? 'start' : 'end', children: [boxC], cssPlacement: true };
        if (Object.keys(mg).length) f.margin = mg;
        if (w) f.width = w;
        items.push({ v: f, block: false });
        return;
      }
      const ld: LLeader = { type: 'leader', pattern: 'space' };
      const inner = Object.keys(style).length ? [{ type: 'inline', ...style, children: parts } as LInline] : parts;
      for (const v of fl === 'right' ? [ld, ...inner] : [...inner, ld]) items.push({ v, block: false });
      return;
    }
    // 行内の要素 (display: inline) の、中身の無いブロックの ::before / ::after (dt::before { content: ''; display: block } で行を分ける):
    // 空の箱は行の中では何も残さないので、行を分ける改行 (行頭では空の行を作らない) にする。中身のあるブロックは、そのままブロックにする
    if (
      /^(block|flow-root|list-item)$/.test(c('display')) &&
      this.display(el) === 'inline' &&
      parts.every((p) => typeof p === 'string' && p === '') &&
      !cssLen(c('width')) &&
      !cssLen(c('height'))
    ) {
      items.push({ v: { type: 'inline', softBreak: true, children: ['\n'] } as LInline, block: false });
      return;
    }
    // ブロックの ::before / ::after: 箱の書式 (余白・枠・背景・幅・clear) も付ける (CSS 2.1 §12.1)。
    // display: table・flow-root・list-item などブロックの外側の表示も、ブロックとして組む (クリアフィックスの display: table)
    const pd = c('display');
    if (/^(block|table|flow-root|list-item|flex|grid)$/.test(pd)) {
      const pb: LBlock = { type: 'block', ...style, ...this.boxStyle(el, which), children: parts };
      if (pd === 'flow-root' || pd === 'table') pb.bfc = true;
      items.push({ v: pb, block: true });
    }
    else if (c('display') === 'inline-block' && cssLen(c('width'))) {
      // 幅のある inline-block (見出しの番号を 12mm の箱に入れるなど): その幅の行内の箱。中は字下げしない
      // 中の揃え・字下げは、::before / ::after 自身の text-align・text-indent。padding も箱に付ける
      const ta = c('text-align').replace(/^-webkit-/, '');
      // left・right は書く向きで start・end に読み替える (右から左へ書くなら right が start)
      const rtlTa = c('direction') === 'rtl';
      const align = ta === 'end' || ta === (rtlTa ? 'left' : 'right') ? 'end' : ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : 'start';
      const pad: Record<string, number> = {};
      for (const sd of ['top', 'right', 'bottom', 'left']) {
        const v = cssLen(c(`padding-${sd}`));
        if (v) pad[sd] = v;
      }
      const ic: LInlineContainer = {
        type: 'inline-container',
        ...style,
        width: cssLen(c('width')),
        ...(Object.keys(pad).length ? { padding: pad } : {}),
        baselineFrom: 'last',
        children: [{ type: 'block', textIndent: 0, ...textIndentOf(c('text-indent')), textAlign: align, children: parts } as LBlock],
      };
      items.push({ v: ic, block: false });
    } else if (Object.keys(style).length || this.opts.pseudoInlineBoxAh) items.push({ v: { type: 'inline', ...style, children: parts } as LInline, block: false });
    else for (const v of parts) items.push({ v, block: false });
  }

  /** 絶対配置の ::before / ::after → 絶対配置の箱 (大きさ・位置・背景はブラウザが確定させた値) */
  private positionedPseudo(el: Element, which: '::before' | '::after', parts: LInlineLevel[]): LBlockContainer {
    const c = this.cs(el, which);
    const a = this.areaOf(this.curPage ?? '');
    const cont: LBlockContainer = { type: 'block-container', absolutePosition: true, ...this.textStyle(el, el, which), children: parts.length ? [{ type: 'block', children: parts }] : [] };
    const len = (p: string) => cssLen(c(p));
    const w = len('width');
    const h = len('height');
    if (w) cont.width = w;
    if (h) cont.height = h;
    const [top, left, right, bottom] = [len('top'), len('left'), len('right'), len('bottom')];
    if (!w) cont.shrinkToFit = true;
    // 基準は、要素自身 (position が static でなければ) か、その祖先
    const cb = c('position') === 'absolute' ? this.localCb(el) : undefined;
    if (cb) this.placeInCb(cont, cb, { top, right, bottom, left });
    else {
      if (left !== undefined) cont.left = a.left + left;
      else if (right !== undefined) cont.right = a.right + right;
      if (top !== undefined) cont.top = a.top + top;
      else if (bottom !== undefined) cont.bottom = a.bottom + bottom;
    }
    const bg = cssColor(c('background-color'));
    if (bg) cont.backgroundColor = bg;
    const bi = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(c('background-image'));
    if (bi) {
      const img: BackgroundImage = { src: normalizeSrc(bi[1]) };
      const bsz = c('background-size').split(',')[0].trim();
      if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
      setBackgroundPosition(img, c('background-position-x'), c('background-position-y'));
      if (/no-repeat/.test(c('background-repeat')) || img.size) img.repeat = 'no-repeat';
      cont.backgroundImage = img;
      this.report.images.push(img.src);
    }
    const cgrad = bi ? undefined : firstGradient(c('background-image'));
    if (cgrad) cont.backgroundImage = { src: '', gradient: cgrad, gradientFontSize: cssLen(c('font-size')) ?? 12 };
    if ((parseInt(c('z-index'), 10) || 0) < 0) cont.layer = 'behind';
    const rad = this.radiusOf(c);
    if (rad) cont.borderRadius = rad;
    return cont;
  }

  /** border-*-radius → 角丸 (すべて 0 なら undefined。4 隅が同じ長さなら rx・ry、違えば角ごと) */
  private radiusOf(c: (p: string) => string): BorderRadius | undefined {
    const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((k) => {
      const [h, v = h] = (c(`border-${k}-radius`) || '0px').trim().split(/\s+/);
      const one = (x: string): number | `${number}%` => (/%$/.test(x) ? (x as `${number}%`) : (cssLen(x) ?? 0));
      return [one(h), one(v)] as [number | `${number}%`, number | `${number}%`];
    });
    if (corners.every(([h, v]) => !parseFloat(String(h)) && !parseFloat(String(v)))) return undefined;
    const [h0, v0] = corners[0];
    if (typeof h0 === 'number' && typeof v0 === 'number' && corners.every(([h, v]) => h === h0 && v === v0)) return { rx: h0, ry: v0 };
    return { rx: 0, ry: 0, corners };
  }

  /** ブロック要素 */
  /**
   * <a href> の飛び先 (HTML Living Standard §4.6.1)。#id は文書の中、スキームのある URL (RFC 3986 §3.1 の形:
   * 英字の後に英字・数字・+・-・.) と相対参照 (§4.2。file.pdf・../a/b.html など) は外。相対参照は PDF の場所からの相対として書き出す
   */
  private linkOf(el: Element): LinkTarget | undefined {
    if (el.localName !== 'a') return undefined;
    const href = (el.getAttribute('href') ?? '').trim();
    if (!href) return undefined;
    if (href.startsWith('#')) return href.length > 1 ? { internal: this.fragmentId(el, href.slice(1)) } : undefined;
    return { external: href };
  }

  /** ブロックの箱を組む。<a href> なら箱にリンクを付ける (ブロック・flex・表の <a> も、箱の全体が飛び先へのリンクになる) */
  private block(el: Element, parent: Element, plain = false): LBlockLevel | undefined {
    const b = this.blockBox(el, parent, plain);
    const link = b && this.linkOf(el);
    if (!b || !link) return b;
    if (b.type === 'block' && !(b as LBlock).link) {
      (b as LBlock).link = link;
      return b;
    }
    // 表・高さの決まった箱などは、書式を持たないブロックで包んでリンクにする
    return { type: 'block', link, children: [b] } as LBlock;
  }

  private blockBox(el: Element, parent: Element, plain = false): LBlockLevel | undefined {
    const d = this.display(el);
    if (!plain && /^(inline-)?(flex|grid)$/.test(d)) {
      const fg = this.flexGrid(el, parent);
      if (fg) return fg;
    }
    if (d === 'table' || el.localName === 'table') return this.table(el, parent);
    // 別行立ての数式 (display: block math): 数式の箱を、内容の箱の中央に置く (MathML Core §2.1 の math 要素。
    // https://www.w3.org/TR/2025/CR-mathml-core-20250624/ 、2026-11-04 取得)
    if (this.opts.mathFont && this.isMath(el)) return { type: 'block', ...this.boxStyle(el), textAlign: 'center', noStrut: true, children: [this.mathFormula(el)] };
    if (el.localName === 'img' || el.localName === 'svg' || el.localName === 'object') {
      // ブラウザの配置が無いとき: 左右の余白が両方 auto なら、中央に置く
      const c = this.cs(el);
      const center = !this.src.rect && c('margin-left') === 'auto' && c('margin-right') === 'auto';
      const align = center ? 'center' : this.flexItemAlign.get(el);
      // 行の箱を持たない (ブロックの画像) ので、画像の下に支柱の下がりを空けない
      // 行の箱を持たないので、受け継いだ text-indent は掛けない (字下げは行の箱の最初の行に掛かる。CSS Text 3 §8.1)
      const bs = this.boxStyle(el);
      // ブロックの img: 罫線・余白・背景・角丸はこのブロックに付ける (行内の包みで二重にしない)。画像は内側の角丸で切り抜く
      const src = el.localName === 'img' ? (el.getAttribute('data-kumiori-src') ?? el.getAttribute('src') ?? '') : '';
      const kids = src ? [this.image(el, src)] : el.localName === 'img' ? [] : this.inline(el, parent);
      const img = kids[0] as LImage | undefined;
      if (img?.type === 'image' && img.borderRadius && bs.borderRadius) img.borderRadius = innerRadius(bs.borderRadius, bs.border, bs.padding);
      // ブロックの置換要素の箱の幅は画像の使われる幅 (CSS 2.1 §10.3.4 → §10.3.2: 本来の大きさと上限・下限で決まる)。親いっぱいにすると、
      // 罫線・背景・角丸が画像より広く描かれる (border-radius: 50% が楕円になる)。画像の幅が分かるときだけ (分からなければ組版で本来の大きさになる)
      // 幅の指定のある画像: 箱の幅も、上限・下限 (max-width・min-width) で抑えた、画像の使われる幅にする (CSS 2.1 §10.4)。
      // 指定の幅のままだと、箱が画像より広くなり、margin: auto で箱を中央に置いても画像は箱の左に寄る
      if (img?.type === 'image' && bs.width !== undefined && img.width !== undefined) {
        const side = (s: 'left' | 'right') => ((bs.border as Partial<Record<string, BorderSide>> | undefined)?.[s]?.width ?? 0) + (typeof bs.padding === 'number' ? bs.padding : ((bs.padding as Partial<Record<string, number>> | undefined)?.[s] ?? 0));
        const used = bs.boxSizing === 'border-box' ? img.width + side('left') + side('right') : img.width;
        if (Math.abs(used - bs.width) > 0.01) bs.width = used;
      }
      if (img?.type === 'image' && bs.width === undefined && img.width !== undefined) {
        const side = (s: 'left' | 'right') => ((bs.border as Partial<Record<string, BorderSide>> | undefined)?.[s]?.width ?? 0) + (typeof bs.padding === 'number' ? bs.padding : ((bs.padding as Partial<Record<string, number>> | undefined)?.[s] ?? 0));
        const extra = side('left') + side('right');
        bs.width = bs.boxSizing === 'border-box' ? img.width + extra : img.width;
        const m0 = typeof bs.margin === 'object' ? bs.margin : {};
        const r = this.src.rect?.(el);
        const pr = el.parentElement ? this.src.rect?.(el.parentElement) : undefined;
        if (r && pr) {
          // ブラウザが置いた位置: 親の内容の箱の左端からの距離を左の余白にする (auto の余白の解決もブラウザに従う)
          const pc = this.cs(el.parentElement!);
          const left = (r.x - pr.x - (parseFloat(pc('border-left-width')) || 0) - (parseFloat(pc('padding-left')) || 0)) * PT_PER_PX;
          if (left > 0.01) bs.margin = { ...m0, left };
        } else if (!this.src.rect) {
          // 左右の余白が auto: 組むときに、置く場所の残りを配る (CSS 2.1 §10.3.3。読み込みのときの包含ブロックの幅の見積もりは、
          // flex の項目の中などで当てにならない)
          const ml = c('margin-left') === 'auto';
          const mr = c('margin-right') === 'auto';
          if (ml || mr) bs.autoMargins = ml && mr ? 'center' : ml ? 'start' : 'end';
        }
      }
      return { type: 'block', ...bs, noStrut: true, textIndent: 0, ...(align ? { textAlign: align } : {}), children: kids };
    }
    this.report.counts.blocks++;
    const c = this.cs(el);
    const b: LBlock = { type: 'block', ...this.textStyle(el, parent), ...this.paragraphStyle(el, parent), ...this.boxStyle(el), children: [] };
    // overflow (CSS 2.1 §11.1.1・Overflow 3): visible 以外は padding の外端で切り抜く (印刷では auto・scroll も hidden と同じ)。
    // hidden・auto・scroll と display: flow-root は、新しいブロック整形文脈を作る (clip は作らない)
    const ov = [c('overflow-x'), c('overflow-y'), c('overflow')].find((v) => v && v !== 'visible') ?? 'visible';
    if (ov !== 'visible') b.overflow = 'hidden';
    if (d === 'flow-root' || /^(hidden|auto|scroll)$/.test(ov)) b.bfc = true;
    // position が static でない箱は、中の絶対配置の箱の基準 (CSS 2.1 §10.1)。relative は、組んだ箱を left・top (無ければ right・bottom の逆) だけずらす (§9.4.3)
    const posv = c('position');
    if (posv === 'relative' || posv === 'sticky') b.containingBlock = true;
    if (posv === 'relative') {
      const off = (p: 'top' | 'right' | 'bottom' | 'left') => (this.src.isAuto?.(el, p) === false ? cssLen(c(p)) : undefined);
      const x = off('left') ?? (off('right') !== undefined ? -off('right')! : 0);
      const y = off('top') ?? (off('bottom') !== undefined ? -off('bottom')! : 0);
      if (x || y) b.relativeOffset = { x, y };
    }
    // アンテナハウスの行グリッド (-ah-baseline-grid。normal は何もしない)
    const bgrid = this.pg(el)['-ah-baseline-grid']?.trim().toLowerCase();
    if (bgrid === 'new' || bgrid === 'root' || bgrid === 'none') b.baselineGrid = bgrid;
    this.blockStack.push(b);
    b.children = this.flowChildren(el);
    this.blockStack.pop();
    this.firstLetterLine(el, b);
    const wm = this.wm(c('writing-mode'));
    if (wm && wm !== this.wm(this.cs(parent)('writing-mode'))) b.writingMode = wm;
    if (c('column-span') === 'all') b.span = 'all';
    // 縦に並べる flex の項目 (幅が中身で決まり、枠も背景も無いもの): 項目の揃えを文字の揃えにする
    const fa = this.flexItemAlign.get(el);
    if (fa && (!b.textAlign || b.textAlign === 'start') && b.width === undefined && !b.border && !b.backgroundColor && !b.backgroundImage) b.textAlign = fa;
    // 段組: 段組のコンテナにする
    // 段の数を column-width から出すときの幅 (CSS Multi-column 1 §3.4 の U: 段組の容器の使われる幅) は、要素の内容の幅。
    // 幅の指定が無ければ、包含ブロックの内容の幅から余白・罫線を除いた幅 (見積もり)。見積もりが無ければ本文領域の幅
    const ownW = !wm?.startsWith('vertical') ? this.src.contentWidth?.(el) : undefined;
    const cols = this.columnsOf(el, b.width ?? (ownW !== undefined ? ownW * PT_PER_PX : this.area.width));
    if (cols) {
      const { type: _t, ...rest } = b;
      void _t;
      const { fill: _f, ...colSpec } = cols;
      void _f;
      // アンテナハウスの拡張 float: multicol top: 段組の箱の先頭に、段をまたいで置く (段の本文はどれもその下から始まる)。
      // 段をまたぐブロック (column-span: all) にして先頭へ移す。幅 (1gr など) はそのまま
      const tops = rest.children.filter((k): k is LFloat => typeof k === 'object' && k.type === 'float' && this.multicolTop.has(k));
      if (tops.length) {
        // gr: 段の幅と段の間の幅を、段・間・段… の順に 1 つずつ数える長さ (n 段なら (2n − 1)gr。端数も使える)
        const cwPx = this.src.contentWidth?.(el);
        const cw = cwPx !== undefined ? cwPx * PT_PER_PX : undefined;
        const colW = cw !== undefined ? (cw - (cols.count - 1) * cols.gap) / cols.count : undefined;
        const grLen = (n: number) => {
          let w = 0;
          for (let k = 0; k < Math.ceil(n); k++) w += Math.min(1, n - k) * (k % 2 === 0 ? colW! : cols.gap);
          return w;
        };
        const spans = tops.map((f) => {
          const { type: _a, float: _b, children: ch, cssPlacement: _c, clear: _d, ...bx } = f;
          void [_a, _b, _c, _d];
          const gr = this.multicolTop.get(f);
          const b2 = { type: 'block', span: 'all', ...bx, children: ch } as unknown as LBlock;
          // width は box-sizing のとおり (border-box なら罫線・内側の余白込み)。値は gr を pt に直したもの。
          // ブロックの width は内容の幅なので、border-box なら左右の内側の余白と罫線を引く (1gr の箱が段の幅になる)
          if (gr !== undefined && colW !== undefined) {
            const b3 = b2 as unknown as { padding?: { left?: number; right?: number }; border?: { left?: { width?: number }; right?: { width?: number } } };
            const hb = this.multicolTopBorderBox.has(f) ? (b3.padding?.left ?? 0) + (b3.padding?.right ?? 0) + (b3.border?.left?.width ?? 0) + (b3.border?.right?.width ?? 0) : 0;
            b2.width = Math.max(0, grLen(parseFloat(gr)) - hb);
          }
          return b2;
        });
        rest.children = [...spans, ...rest.children.filter((k) => !tops.includes(k as LFloat))];
      }
      return { ...rest, type: 'block-container', columns: colSpec } as LBlockContainer;
    }
    // アンテナハウスの -ah-display-align: 高さの決まったブロックは、中身を箱の中の上下の中央・末尾に寄せる
    // (たとえば div.Back { -ah-display-align: after; height: 100vh } は、中身をページの下端に寄せる)
    const da = this.displayAlignOf(el);
    if (da && this.src.isAuto?.(el, 'height') === false) return { ...b, type: 'block-container', blockAlign: da } as unknown as LBlockContainer;
    return b;
  }

  /**
   * ::first-letter・::first-line (CSS 2.1 §5.12)。ブロックの直下の、最初の行内の並びに当てる
   * (最初の行が中の子のブロックにある場合は扱わない)
   */
  private firstLetterLine(el: Element, b: LBlock) {
    const has = (p: '::first-letter' | '::first-line') => this.src.hasPseudo?.(el, p) ?? false;
    if (has('::first-letter')) {
      // 最初の字 (前後の約物を含む。Pseudo 4 §3.2) を、::first-letter の書式の inline で包む。float なら回り込みの字 (ドロップキャップ)
      const take = (list: Array<LBlockLevel | LInlineLevel>): boolean => {
        for (let i = 0; i < list.length; i++) {
          const k = list[i];
          if (typeof k === 'string') {
            const m = FIRST_LETTER.exec(k);
            if (!m) {
              if (k.trim()) return true;
              continue;
            }
            const letter = m[2];
            const st = this.textStyle(el, el, '::first-letter');
            const fc = this.cs(el, '::first-letter');
            const fl = fc('float');
            let node: LInlineLevel;
            if (fl === 'left' || fl === 'right') {
              const inner: LBlock = { type: 'block', ...st, ...this.boxStyle(el, '::first-letter'), children: [letter] };
              const f: LFloat = { type: 'float', float: fl === 'left' ? 'start' : 'end', cssPlacement: true, children: [inner] };
              for (const key of ['margin', 'padding', 'border', 'backgroundColor', 'width', 'height', 'boxSizing'] as const) {
                if (inner[key] === undefined) continue;
                (f as unknown as Record<string, unknown>)[key] = inner[key];
                delete inner[key];
              }
              node = f as unknown as LInlineLevel;
            } else {
              const inl: LInline = { type: 'inline', ...st, children: [letter] };
              const bg = cssColor(fc('background-color'));
              if (bg) inl.backgroundColor = bg;
              node = inl;
            }
            const rest = k.slice(m[0].length);
            list.splice(i, 1, ...(m[1] ? [m[1]] : []), node, ...(rest ? [rest] : []));
            return true;
          }
          if (typeof k === 'object' && k.type === 'inline') {
            if (take(k.children as Array<LBlockLevel | LInlineLevel>)) return true;
            continue;
          }
          // 画像などの行内の箱が先にあれば、最初の字は無い
          if (typeof k === 'object' && !isBlockLevel(k)) return true;
          return true;
        }
        return false;
      };
      take(b.children as Array<LBlockLevel | LInlineLevel>);
    }
    if (has('::first-line')) {
      // 行内の並びだけを包む (回り込み・マーカーの前まで)
      let n = 0;
      while (n < b.children.length && !isBlockLevel(b.children[n]) && !/^(float|marker|retrieve-marker)$/.test((b.children[n] as { type?: string }).type ?? '')) n++;
      if (n > 0) {
        const st = this.textStyle(el, el, '::first-line');
        const wrap: LInline = { type: 'inline', firstLine: true, ...st, children: b.children.slice(0, n) as LInlineLevel[] };
        b.children.splice(0, n, wrap);
      }
    }
  }

  private wm(v: string): WritingMode | undefined {
    // sideways-rl は、ブロックが右から左へ進む縦の書字方向で、字は横書きの組み方 (Writing Modes 4 §3.2)。vertical-rl として組み、
    // 字はすべて横倒しにする (textStyle の textOrientation)。sideways-lr (行の中を下から上へ進む) は組めないので、親の書字方向のまま
    return v === 'vertical-rl' || v === 'tb-rl' || v === 'sideways-rl' ? 'vertical-rl' : v === 'vertical-lr' ? 'vertical-lr' : v === 'horizontal-tb' || v === 'lr-tb' ? 'horizontal-tb' : undefined;
  }

  /** 画像 (<img> と、画像を指す <object>) */
  private image(el: Element, src: string): LImage {
    const key = normalizeSrc(src);
    this.report.images.push(key);
    const img: LImage = { type: 'image', src: key };
    const alt = el.getAttribute('alt') ?? el.getAttribute('title');
    if (alt) img.alt = alt;
    const c = this.cs(el);
    if (el.localName === 'img' && this.inAutoCellIfc(el)) img.noWrapInCellMin = true;
    // 角丸 (border-radius): 画像を角丸で切り抜く (CSS Backgrounds 3 §5.3)
    const rad = this.radiusOf(c);
    if (rad) img.borderRadius = rad;
    // 寸法: 幅・高さの指定 (auto でなければ確定した値)、無ければ width / height 属性 (px)
    for (const prop of ['width', 'height'] as const) {
      const auto = this.src.isAuto?.(el, prop);
      const attr = el.getAttribute(prop);
      const v = auto === false ? cssLen(c(prop)) : attr && /^\d+(\.\d+)?$/.test(attr) ? parseFloat(attr) * PT_PER_PX : undefined;
      if (v) img[prop] = v;
    }
    // 指定が無く、max-width などの上限・下限があれば、ブラウザが置いた大きさ (上限・下限が効いた大きさ。画像を読めたときだけ)。
    // 上限・下限が無ければ、Kumiori が読んだ画像本来の大きさ (image-resolution の指定がある画像は、その解像度で決める。ブラウザはこの指定を知らない)
    const limited = ['max-width', 'max-height'].some((p) => !/^(none|)$/.test(c(p))) || ['min-width', 'min-height'].some((p) => !/^(0px|auto|)$/.test(c(p)));
    if (limited && el.localName === 'img' && img.width === undefined && img.height === undefined && !this.inh(el, 'image-resolution', true)) {
      const r = this.src.rect?.(el);
      if (r && r.width > 0 && r.height > 0 && (el as HTMLImageElement).complete !== false && ((el as HTMLImageElement).naturalWidth ?? 1) > 0) {
        img.width = r.width * PT_PER_PX;
        img.height = r.height * PT_PER_PX;
      }
    }
    // ブラウザの配置が無いとき (自前のカスケード): 本来の大きさと上限・下限から決める (CSS 2.1 §10.4)
    if (limited && !this.src.rect && (el.localName === 'img' || el.localName === 'object') && !this.inh(el, 'image-resolution', true)) {
      const nat = this.opts.imageSize?.(key);
      if (nat && nat.width > 0 && nat.height > 0) {
        const px = (p: string, def: number) => {
          const v = cssLen(c(p));
          return v === undefined ? def : v / PT_PER_PX;
        };
        const ratio = nat.height / nat.width;
        const w0 = img.width !== undefined ? img.width / PT_PER_PX : img.height !== undefined ? img.height / PT_PER_PX / ratio : nat.width;
        const h0 = img.height !== undefined ? img.height / PT_PER_PX : w0 * ratio;
        const [w, h] = constrainReplaced(w0, h0, px('min-width', 0), px('max-width', Infinity), px('min-height', 0), px('max-height', Infinity));
        img.width = w * PT_PER_PX;
        img.height = h * PT_PER_PX;
      }
    }
    // vertical-align (CSS 2.1 §10.8.1): text-bottom・text-top は字面の下端・上端に、bottom・top は行の箱の下端・上端に揃える
    const va = c('vertical-align');
    if (va === 'text-bottom') img.alignmentBaseline = 'after-edge';
    else if (va === 'text-top') img.alignmentBaseline = 'before-edge';
    else if (va === 'bottom') img.alignmentBaseline = 'line-bottom';
    else if (va === 'top') img.alignmentBaseline = 'line-top';
    // alignment-baseline (CSS Inline 3。アンテナハウスの -ah-alignment-baseline): central・middle は画像の中央を中央の基線に、
    // text-after-edge・text-before-edge は字面の下端・上端に揃える
    const pgv = this.pg(el);
    const ab = (pgv['-ah-alignment-baseline'] ?? pgv['alignment-baseline'] ?? '').trim().toLowerCase();
    if (ab === 'central' || ab === 'middle') img.alignmentBaseline = 'central';
    else if (/^(text-after-edge|after-edge|text-bottom)$/.test(ab)) img.alignmentBaseline = 'after-edge';
    else if (/^(text-before-edge|before-edge|text-top)$/.test(ab)) img.alignmentBaseline = 'before-edge';
    // object-fit (幅・高さの両方があるとき)
    const fit = c('object-fit');
    if (img.width !== undefined && img.height !== undefined && (fit === 'cover' || fit === 'contain' || fit === 'fill')) img.fit = fit;
    // アンテナハウスの -ah-content-width / -ah-content-height (寸法の指定が無いとき): % は本来の大きさに対する倍率、長さはその大きさ。
    // 片方だけなら縦横比を保つ
    if (img.width === undefined && img.height === undefined) {
      const pg = this.pg(el);
      const cw = pg['-ah-content-width']?.trim();
      const ch = pg['-ah-content-height']?.trim();
      const pct = (v: string | undefined) => (v && /%$/.test(v) ? parseFloat(v) / 100 : undefined);
      const sw = pct(cw);
      const sh = pct(ch);
      if (sw !== undefined || sh !== undefined) {
        img.widthScale = sw ?? sh;
        img.heightScale = sh ?? sw;
        // 割合の基準の本来の大きさは、XSL の content-width と同じく、画像に書かれた解像度で決める (書かれていなければ 96dpi。
        // XSL-FO の external-graphic と同じ。100dpi の PNG の 50% は 200ppi で置く)
        img.intrinsicFromImage = true;
      }
      const lw = cw && !/%$|^auto$/i.test(cw) ? cssLen(cw) : undefined;
      const lh = ch && !/%$|^auto$/i.test(ch) ? cssLen(ch) : undefined;
      if (lw !== undefined) img.width = lw;
      if (lh !== undefined) img.height = lh;
    }
    // image-resolution (アンテナハウスの -ah-image-resolution): 寸法の指定が無ければ、その解像度で本来の大きさを決める (既定は 96dpi)
    if (img.width === undefined && img.height === undefined && img.widthScale === undefined) {
      const res = this.inh(el, 'image-resolution', true);
      if (/from-image/i.test(res)) img.resolutionFromImage = true;
      const m = /(\d+(?:\.\d+)?)\s*(dpi|dpcm|dppx|x)?\s*$/i.exec(res.replace(/from-image|snap/gi, '').trim());
      if (m) {
        const n = parseFloat(m[1]);
        const dpi = (m[2] ?? 'dpi').toLowerCase() === 'dpcm' ? n * 2.54 : /^(dppx|x)$/i.test(m[2] ?? '') ? n * 96 : n;
        if (dpi > 0 && Math.abs(dpi - 96) > 1e-6) img.widthScale = img.heightScale = 96 / dpi;
      }
    }
    // visibility: hidden・collapse の画像は、場所を残して描かない (色を transparent にして運ぶ。組版エンジンが画像に描かない印を付ける)
    if (/^(hidden|collapse)$/.test(this.cs(el)('visibility'))) img.color = 'transparent';
    return img;
  }

  /** インライン要素 */
  private inline(el: Element, parent: Element): LInlineLevel[] {
    const name = el.localName;
    if (name === 'br') {
      // clear のある br: 改行の後の行を、回り込みの下から始める
      const cl = this.cs(el)('clear');
      if (/^(left|right|both)$/.test(cl)) {
        const rtl = this.cs(el)('direction') === 'rtl';
        const side = cl === 'both' ? 'both' : (cl === 'left') !== rtl ? 'start' : 'end';
        return [{ type: 'inline', breakClear: side, children: ['\n'] } as LInline];
      }
      return ['\n'];
    }
    if (name === 'wbr') return ['​'];
    // <object data="図.svg"> は、その画像が読み込まれていれば画像として、無ければ中の代わりの内容を組む
    if (name === 'object') {
      const data = el.getAttribute('data') ?? '';
      const isImage = /^image\//i.test(el.getAttribute('type') ?? '') || /\.(svgz?|png|jpe?g|gif|webp|bmp|tiff?)$/i.test(data);
      if (data && isImage && this.opts.hasAsset?.(normalizeSrc(data)) !== false) return [this.image(el, data)];
    }
    if (name === 'img') {
      const src = el.getAttribute('data-kumiori-src') ?? el.getAttribute('src') ?? '';
      if (!src) return [];
      const img = this.image(el, src);
      // 画像の罫線・内側の余白・背景色 (img { border: … }): 画像を囲む行内の箱に付ける。
      // 角丸 (border-radius) は枠に付け、画像は枠の内側の角丸 (外側の半径 − 罫線と余白) で切り抜く (CSS Backgrounds 3 §5.1・§5.3)
      const bs = this.boxStyle(el);
      if (bs.border || bs.padding || bs.backgroundColor) {
        const rad = img.borderRadius;
        if (rad) img.borderRadius = innerRadius(rad, bs.border, bs.padding);
        return [{ type: 'inline', ...(bs.border ? { border: bs.border } : {}), ...(bs.padding ? { padding: bs.padding } : {}), ...(bs.backgroundColor ? { backgroundColor: bs.backgroundColor } : {}), ...(rad ? { borderRadius: rad } : {}), children: [img] } as LInline];
      }
      return [img];
    }
    // 文書の中に直接書いた <svg>: 単独の SVG 文書 (data URI) にして、<img> と同じ画像として組む
    if (isInlineSvg(el)) return [this.image(el, inlineSvgDataUri(el))];
    // 数式 (MathML の math 要素): 数式用の書体があれば、組んだ図形にする
    if (this.opts.mathFont && this.isMath(el)) return [this.mathFormula(el)];
    if (name === 'ruby') {
      // <ruby>親文字<rt>ルビ</rt>…</ruby> (rp は除く)。ルビは、直前の rt から後の親文字と対になる (Ruby 1 §2.3。
      // <ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby> は 2 組)。rb を並べた書き方 (rb…rb rt…rt) は、順番どうしで対にする
      const kids = Array.from(el.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).localName === 'rp'));
      const isEl = (n: Node, nm: string) => n.nodeType === 1 && (n as Element).localName === nm;
      const txt = (n: Node) => n.textContent ?? '';
      const out: LInlineLevel[] = [];
      // rtEl・underEl: 注釈の要素 (rt・rtc。ルビの字の色を取る)
      const pairs: Array<{ base: string; rt: string; under?: string; rtEl?: Node; underEl?: Node }> = [];
      // rtc (ルビの段の入れ物): rt の後の rtc は 2 段目 (ruby-position: alternate で下側。Ruby 1 §4.1)。
      // それまでの組をまとめた親文字に掛ける (rt の無い最初の rtc は 1 段目)
      if (kids.some((n) => isEl(n, 'rb'))) {
        // rb を使う書き方は、CSS Ruby 1 §2.2 の無名の箱の作り方で組を作る: ruby の直下の、続いた字の並び (rb・rt・rtc の外) は
        // 無名の親文字にして、rb と同じ親文字の段に入れる (空白だけなら捨てる)。続いた rt は 1 つの段 (無名の段の入れ物)、rtc は 1 段。
        // 親文字の段と、その後の段が 1 つの区切り (ruby segment。§2.3.1)
        type Level = { anon: boolean; items: string[]; nodes: Node[] };
        const segs: Array<{ bases: string[]; levels: Level[] }> = [];
        let seg: { bases: string[]; levels: Level[] } | undefined;
        let rtRun: Level | undefined;
        let text = '';
        const addBase = (b: string) => {
          if (!seg || seg.levels.length) segs.push((seg = { bases: [], levels: [] }));
          seg.bases.push(b);
          rtRun = undefined;
        };
        const flushText = () => {
          if (text.trim()) addBase(text);
          text = '';
        };
        for (const n of kids) {
          if (isEl(n, 'rb')) {
            flushText();
            addBase(txt(n));
          } else if (isEl(n, 'rt') || isEl(n, 'rtc')) {
            flushText();
            if (!seg) segs.push((seg = { bases: [], levels: [] }));
            if (isEl(n, 'rt')) {
              if (!rtRun) seg.levels.push((rtRun = { anon: false, items: [], nodes: [] }));
              rtRun.items.push(txt(n));
              rtRun.nodes.push(n);
            } else {
              // rtc の中の rt はそれぞれの注釈、rt の無い rtc は 1 つの無名の注釈 (区切りの親文字すべてに掛かる。§2.3.2)
              const rts = Array.from((n as Element).childNodes).filter((k) => isEl(k, 'rt'));
              seg.levels.push(rts.length ? { anon: false, items: rts.map(txt), nodes: rts } : { anon: true, items: [txt(n)], nodes: [n] });
              rtRun = undefined;
            }
          } else if (n.nodeType === 3 || n.nodeType === 4 || n.nodeType === 1) text += txt(n);
        }
        flushText();
        // 区切りごとに対にする (§2.3.2)。1 段目はルビ、2 段目は下側のルビ。親文字ごとに対にできれば親文字ごとの組、
        // 無名の注釈 (親文字すべてに掛かる) を含めば、区切りの親文字をまとめた 1 組にする。余った注釈は最後の親文字に付ける
        for (const sg of segs) {
          const [l1, l2] = sg.levels;
          const nb = sg.bases.length;
          const per = (l: Level | undefined, k: number) => (!l ? '' : k === nb - 1 ? l.items.slice(k).join('') : (l.items[k] ?? ''));
          if (!nb || l1?.anon || l2?.anon) pairs.push({ base: sg.bases.join(''), rt: l1?.items.join('') ?? '', rtEl: l1?.nodes[0], ...(l2 ? { under: l2.items.join(''), underEl: l2.nodes[0] } : {}) });
          else sg.bases.forEach((b, k) => pairs.push({ base: b, rt: per(l1, k), rtEl: l1?.nodes[Math.min(k, l1.nodes.length - 1)], ...(l2 ? { under: per(l2, k), underEl: l2.nodes[Math.min(k, l2.nodes.length - 1)] } : {}) }));
        }
      } else {
        let base = '';
        let sinceRtc = 0;
        for (const n of kids) {
          if (isEl(n, 'rtc') && !base.trim() && sinceRtc > 0) {
            // 2 段目: 直前の rtc の後の組をまとめ、下側のルビにする
            const group = pairs.splice(pairs.length - sinceRtc, sinceRtc);
            pairs.push({ base: group.map((g) => g.base).join(''), rt: group.map((g) => g.rt).join(''), rtEl: group[0]?.rtEl, under: txt(n), underEl: n });
            sinceRtc = 0;
            base = '';
          } else if (isEl(n, 'rt') || isEl(n, 'rtc')) {
            pairs.push({ base, rt: txt(n), rtEl: n });
            sinceRtc++;
            base = '';
          } else base += txt(n);
        }
        // 対になるルビの無い親文字は、ふつうの字
        if (base.trim()) pairs.push({ base, rt: '' });
      }
      // ルビの字の大きさ: 最初の rt (無ければ rtc) の計算値の、ruby の字の大きさに対する比 (UA の既定は 50%。CSS Ruby 1 付録 A.1)
      const firstRt = kids.find((n) => isEl(n, 'rt')) ?? kids.find((n) => isEl(n, 'rtc'));
      const rfs = cssLen(this.cs(el)('font-size'));
      const tfs = firstRt ? cssLen(this.cs(firstRt as Element)('font-size')) : undefined;
      const scale = rfs && tfs ? tfs / rfs : undefined;
      // ルビの字の色: 注釈の要素 (rt・rtc) の color (印刷の色の指定も読む)。ruby の字の色と同じなら付けない
      const rubyColor = cssColor(this.cs(el)('color'));
      const colorOf = (n: Node | undefined) => {
        if (!n || n.nodeType !== 1) return undefined;
        const e = n as Element;
        const v = this.printOf(this.pg(e), 'color') ?? cssColor(this.cs(e)('color'));
        return v && v !== rubyColor ? v : undefined;
      };
      for (const pr of pairs) {
        const b = pr.base.trim();
        const t = pr.rt.trim();
        const u = pr.under?.trim();
        if (!t && !u) {
          if (b) out.push(b);
          continue;
        }
        this.report.counts.rubies++;
        const rc = t ? colorOf(pr.rtEl) : undefined;
        const uc = u ? colorOf(pr.underEl) : undefined;
        out.push({
          type: 'ruby',
          baseText: b,
          rubyText: t,
          ...(u ? { rubyTextUnder: u } : {}),
          ...(scale && Math.abs(scale - 0.5) > 1e-6 ? { rubyScale: scale } : {}),
          ...(rc ? { rubyColor: rc } : {}),
          ...(uc ? { rubyColorUnder: uc } : {}),
        } as LRuby);
      }
      return out;
    }
    const c = this.cs(el);
    // text-combine-upright: all は、どれだけ縮めても 1em に収める (Writing Modes 4 §9.1.3)
    if (c('text-combine-upright') === 'all' || c('-webkit-text-combine') === 'horizontal') return [{ type: 'tate-chu-yoko', text: (el.textContent ?? '').trim(), fit: true }];
    // inline-table: 表を行内の箱に入れる (表の箱・罫線・余白は表の側が持つ)。基線は表の最初の基線
    // ("inline-table uses its first baseline by default." CSS Box Alignment 3 §4.2、https://www.w3.org/TR/css-align-3/ 2026-11-06 取得)
    if (c('display') === 'inline-table') {
      const t = this.table(el, parent) as LBlockLevel & { margin?: LInlineContainer['margin'] };
      const ic: LInlineContainer = { type: 'inline-container', ...this.textStyle(el, parent), children: [t] };
      // 表の外側の余白は、行内の箱の余白にする (中身に合わせた箱の幅に余白を含める)
      if (t.margin) {
        ic.margin = t.margin;
        delete t.margin;
      }
      ic.baselineFrom = 'first';
      const iva = c('vertical-align');
      if (iva === 'middle') ic.alignmentBaseline = 'central';
      else if (iva === 'top' || iva === 'text-top') ic.alignmentBaseline = 'before-edge';
      else if (iva === 'bottom' || iva === 'text-bottom') ic.alignmentBaseline = 'after-edge';
      return [ic];
    }
    // inline-block: 行内の箱 (中にブロックを持てる。幅の指定が無ければ中身に合わせた幅)
    if (c('display') === 'inline-block') {
      const box = this.boxStyle(el);
      delete box.breakBefore;
      delete box.breakAfter;
      const ic: LInlineContainer = {
        type: 'inline-container',
        ...this.textStyle(el, parent),
        ...this.paragraphStyle(el, parent),
        ...(box as Omit<LInlineContainer, 'type' | 'children'>),
        children: this.flowChildren(el),
      };
      // 親と違う書字方向 (縦書きの行の中の横書きの inline-block。縦中横など) は、箱の中をその向きで組む (Writing Modes 3 §7 の直交フロー)
      const icWm = this.wm(c('writing-mode'));
      if (icWm && icWm !== this.wm(this.cs(parent)('writing-mode'))) ic.writingMode = icWm;
      // CSS の inline-block の基線は、中の最後の行の基線
      ic.baselineFrom = 'last';
      const iva = c('vertical-align');
      if (iva === 'middle') ic.alignmentBaseline = 'central';
      else if (iva === 'top' || iva === 'text-top') ic.alignmentBaseline = 'before-edge';
      else if (iva === 'bottom' || iva === 'text-bottom') ic.alignmentBaseline = 'after-edge';
      return [ic];
    }
    // display: contents (CSS Display 3 §2.5): 箱を作らないので、罫線・背景・内側と外側の余白・vertical-align は付けず、受け継ぐ書式だけを中身に渡す
    if (c('display') === 'contents') return [{ type: 'inline', ...this.textStyle(el, parent), children: this.flowChildren(el, true) as LInlineLevel[] }];
    const inl: LInline = { type: 'inline', ...this.textStyle(el, parent), children: this.flowChildren(el, true) as LInlineLevel[] };
    const va = c('vertical-align');
    if (va === 'super' && this.opts.superShiftAh) inl.baselineShift = (cssLen(this.cs(parent)('font-size')) ?? 12) / 3;
    else if (va === 'super' || va === 'sub') inl.baselineShift = va;
    else if (cssLen(va)) inl.baselineShift = cssLen(va);
    const bg = this.printOf(this.pg(el), 'background-color', 'background') ?? cssColor(c('background-color'));
    if (bg) inl.backgroundColor = bg;
    const box = this.boxStyle(el);
    if (box.border) inl.border = box.border;
    if (box.padding) inl.padding = box.padding;
    // 行の進む方向の margin は行内の空き (横書きは左右。右から左へ書く段落では入れ替わる。縦書きは上下)
    const vert = /^(vertical|sideways-rl)/.test(c('writing-mode'));
    const [ms, me] = vert ? [cssLen(c('margin-top')) ?? 0, cssLen(c('margin-bottom')) ?? 0] : [cssLen(c('margin-left')) ?? 0, cssLen(c('margin-right')) ?? 0];
    if (ms || me) {
      const rtl = !vert && c('direction') === 'rtl';
      inl.inlineMargin = { start: rtl ? me : ms, end: rtl ? ms : me };
    }
    const inlId = el.getAttribute('id');
    if (inlId) inl.id = inlId;
    // 中身の無い行内要素も、字の大きさと行の高さを行の箱に入れる (CSS 2.1 §10.8)
    if (!inl.children.length) inl.emptyStrut = true;
    const link = this.linkOf(el);
    if (link) inl.link = link;
    return [inl];
  }

  /**
   * リストの容器 (ol・ul・menu) の list-item カウンターの暗黙の reset (Lists 3 §4.6 と付録 A の ol, ul { counter-reset: list-item }。
   * ol の start は、最初の項目がその番号になるように)。reversed は、start (無ければ項目の数) + 1 から始め、項目ごとに 1 減らす
   * (HTML の ol reversed)。容器の中身を読み始めるときに 1 度だけ呼ぶ (kids は容器の子)
   */
  private listStart(container: Element, kids: Node[]) {
    if (!/^(ol|ul|menu)$/.test(container.localName) || /(^|\s)list-item(\s|$)/.test(this.cs(container)('counter-reset'))) return;
    // start は 0 や負の数でもよい (読めなければ 1。HTML の ol start、Lists 3 付録の ol[start] の規則)
    const s0 = parseInt(container.getAttribute('start') ?? '1', 10);
    const start = Number.isNaN(s0) ? 1 : s0;
    const reversed = !!container.hasAttribute?.('reversed');
    const count = () => kids.filter((k) => k.nodeType === 1 && this.display(k as Element) === 'list-item').length;
    if (!this.counters.has('list-item')) this.counters.set('list-item', []);
    const first = reversed ? (container.hasAttribute('start') ? start : count()) + 1 : start - 1;
    this.counters.get('list-item')!.push({ owner: container, v: first });
  }

  /** リストの項目 (display: list-item) のカウンター: list-item を 1 つ進め (reversed の容器では 1 つ戻し)、value 属性の番号にする */
  private listItemCounters(li: Element, container: Element) {
    const v = parseInt(li.getAttribute('value') ?? '', 10);
    this.enterCounters(this.cs(li), container, { value: Number.isFinite(v) ? v : undefined, step: container.hasAttribute?.('reversed') ? -1 : 1 });
  }

  /**
   * list-item の並び → 2 列の表 (記号・番号の列と本文の列)。記号の列の幅は、リストの字下げ (padding-start)。
   * 最初の項目のカウンター・しおり・string-set は、呼び出し側 (flowChildren) が済ませている
   */
  private list(container: Element, lis: Element[]): LBlockLevel {
    const c = this.cs(container);
    const s0 = parseInt(container.getAttribute('start') ?? '1', 10);
    const start = Number.isNaN(s0) ? 1 : s0;
    const reversed = !!container.hasAttribute?.('reversed');
    // 並びの 2 つ目からの項目の前処理 (最初の項目は flowChildren が済ませている): カウンター・しおり・string-set のマーカー
    // (マーカーは項目の中身の先頭に置く)
    const enter = (li: Element, k: number): LMarker[] => {
      if (k === 0) return [];
      this.listItemCounters(li, container);
      this.bookmark(li);
      return this.stringSet(li);
    };
    // 記号の無いリスト (list-style: none) は、ふつうのブロックの並びにする (li の枠・余白がそのまま付く)
    if (lis.every((li) => this.cs(li)('list-style-type') === 'none')) {
      const blocks: Array<LBlockLevel | LInlineLevel> = [];
      lis.forEach((li, k) => {
        blocks.push(...enter(li, k));
        const b = this.block(li, container);
        if (b) blocks.push(b);
      });
      return { type: 'block', children: blocks };
    }
    this.report.counts.tables++;
    // 記号の列の幅は、リストの inline-start 側の字下げ (UA の padding-inline-start)。縦書きでは上 (padding-top)。表もその側へ引き戻す
    const startSide = /^(vertical|sideways-rl)/.test(c('writing-mode')) ? 'top' : 'left';
    const indent = (cssLen(c(`padding-${startSide}`)) ?? 0) + (cssLen(c(`margin-${startSide}`)) ?? 0);
    let n = reversed ? start + lis.length - 1 : start;
    // 項目の改ページの指定 (CSS Fragmentation 3 §3.1: break-before・break-after・break-inside は、通常の流れの block-level の箱に当たる。
    // list-item の箱も block-level)。項目は表の行にして組むので、行の指定にする (表の tr と同じ。left・right・recto・verso は、行の間では
    // ページを改めるだけ)。最初の項目の前・最後の項目の後ろの強制の区切りは、リストの箱の前後の区切りと同じ所なので
    // (§3.1 の区切りの値の伝播)、リストを組む表の前後の指定にする (左右のページの指定もそのまま効く)
    const rtlPages = this.pagesRtl;
    const forced = (v: string): LBlock['breakBefore'] =>
      v === 'page' || v === 'always' ? 'page' : v === 'verso' || v === (rtlPages ? 'right' : 'left') ? 'even-page' : v === 'recto' || v === (rtlPages ? 'left' : 'right') ? 'odd-page' : v === 'column' ? 'column' : undefined;
    let listBefore: LBlock['breakBefore'];
    let listAfter: LBlock['breakBefore'];
    const rowBreaks = (li: Element, k: number): Pick<LTableRow, 'breakBefore' | 'breakAfter' | 'keepTogether' | 'keepWithNext' | 'keepWithPrevious'> => {
      const lc = this.cs(li);
      const bb = lc('break-before') || lc('page-break-before');
      const ba = lc('break-after') || lc('page-break-after');
      const bi = lc('break-inside') || lc('page-break-inside');
      let multicol: boolean | undefined;
      const avoids = (v: string) => v === 'avoid' || v === 'avoid-page' || (v === 'avoid-column' && (multicol ??= this.inMulticol(li)));
      const fb = forced(bb);
      const fa = forced(ba);
      const o: ReturnType<typeof rowBreaks> = {};
      if (k === 0) listBefore = fb;
      else if (fb && fb !== 'column') o.breakBefore = true;
      if (k === lis.length - 1) listAfter = fa;
      else if (fa && fa !== 'column') o.breakAfter = true;
      if (avoids(bi)) o.keepTogether = true;
      if (avoids(ba)) o.keepWithNext = true;
      if (avoids(bb)) o.keepWithPrevious = true;
      return o;
    };
    const rows: LTableRow[] = lis.map((li, k) => {
      const lc = this.cs(li);
      const marks = enter(li, k);
      // 番号: list-item カウンターの値
      n = this.counterValue('list-item');
      // inside: 記号・番号は、本文の最初の行の先頭に置く行内の字 (Lists 3 §3.5)。記号の後ろに空白を 1 つ
      const inside = lc('list-style-position') === 'inside';
      // 記号の後ろの文字 (suffix。Counter Styles 3 §6): 既定の数の種類・記号は空白、cjk-decimal は「、」だけ、文字列の記号はその文字列だけ
      const lst = lc('list-style-type');
      const insideText = inside && lst !== 'none' ? listMarker(lst, n, this.counterStyles, this.obsoleteGlyphs) + (/^["']/.test(lst) || lst === 'cjk-decimal' || COMPLEX_COUNTER.has(lst) || this.counterStyles.has(lst) ? '' : ' ') : '';
      const outsideText = inside ? '' : listMarker(lc('list-style-type'), n, this.counterStyles, this.obsoleteGlyphs);
      // ::marker の書式 (字の書式と色。CSS Lists 3 §3.1・CSS Pseudo 4 §3.2): li と違うものだけを、記号を包む inline に
      const styled = (t: string): LInlineLevel => {
        if (!t || !(this.src.hasPseudo?.(li, '::marker') ?? false)) return t;
        const ms = this.textStyle(li, li, '::marker');
        return Object.keys(ms).length ? { type: 'inline', ...ms, children: [t] } : t;
      };
      const insideMarker = styled(insideText);
      const marker = styled(outsideText);
      n += reversed ? -1 : 1;
      const fs = cssLen(lc('font-size')) ?? 12;
      const body: LTableCell = { type: 'table-cell', ...this.textStyle(li, container), ...this.paragraphStyle(li, container), children: this.flowChildren(li) };
      // 記号は li の内容の先頭の行内の字 (最初の子がブロックなら、その前の行になる。Lists 3 §3.5)
      if (insideMarker) (body.children as Array<LBlockLevel | LInlineLevel>).unshift(insideMarker);
      if (marks.length) (body.children as Array<LBlockLevel | LInlineLevel>).unshift(...marks);
      // li の id (目次・索引の参照先) は、本文の列のセルに付ける
      const liId = li.getAttribute('id');
      if (liId) body.id = liId;
      const box = this.boxStyle(li);
      if (box.margin) body.padding = { top: (box.margin as Record<string, number>).top ?? 0, bottom: (box.margin as Record<string, number>).bottom ?? 0 };
      return {
        type: 'table-row',
        ...rowBreaks(li, k),
        // 記号・番号は、本文の最初の行の基線にそろえる (CSS Lists: 外側の記号は最初の行の箱に置く)
        // 本文の最後の子の下の余白は、li の外へ抜けて次の項目との間に残る (CSS 2.1 §8.3.1)。セルの高さに含める
        cells: [{ type: 'table-cell', textAlign: 'end', blockAlign: 'baseline', padding: { right: fs * 0.5 }, ...this.textStyle(li, container), noWrap: true, alignOverflow: true, children: marker ? [marker] : [] }, { ...body, blockAlign: 'baseline', keepTrailingSpace: true }],
      };
    });
    const table = {
      type: 'table',
      columns: [
        { type: 'table-column', width: Math.max(indent, 1) },
        { type: 'table-column', width: '1*' },
      ],
      margin: { [startSide]: -indent },
      body: { type: 'table-body', rows },
    } as LTable;
    // リストの箱の行グリッド (-ah-baseline-grid): 表を、その指定を持つ箱で包む (ページの終わりの判定に使う)
    const bgrid = this.pg(container)['-ah-baseline-grid']?.trim().toLowerCase();
    const out = bgrid === 'new' || bgrid === 'root' || bgrid === 'none' ? ({ type: 'block', baselineGrid: bgrid, children: [table] } as LBlock) : table;
    if (listBefore) out.breakBefore = listBefore;
    if (listAfter) out.breakAfter = listAfter;
    return out;
  }

  /** 表 (<table> / display: table) */
  /**
   * 表 (<table> / display: table)。anon を渡すと、el の子のうち anon の要素 (表の外で続くセル・行など) を包む匿名の表
   * (CSS 2.1 §17.2.1)。匿名の表は、表の書式を el から継承する値だけで組む
   */
  private table(el: Element, parent: Element, anon?: Element[]): LTable {
    this.report.counts.tables++;
    const c = this.cs(el);
    const header: LTableRow[] = [];
    let headerAvoidBreak = false;
    const footer: LTableRow[] = [];
    const body: LTableRow[] = [];
    const columns: LTableColumn[] = [];
    const captions: NonNullable<LTable['captions']> = [];
    const collapse = c('border-collapse') === 'collapse';
    // 行・行グループの背景: 自分の背景の無いセルに塗る (CSS 2.1 §17.5.1: 背景はセル・行・行グループ・表の順に重なる)
    const bgOf = (e: Element) => this.printOf(this.pg(e), 'background-color', 'background') ?? cssColor(this.cs(e)('background-color'));
    const paintCells = (row: LTableRow, bg: string | undefined) => {
      if (bg) for (const cell of row.cells) if (!cell.backgroundColor) cell.backgroundColor = bg;
    };
    // 表の部分 (行グループ・行・セル・caption) の前処理: カウンター (Lists 3 §4: 箱を作る要素はどれも counter-* を当てる。reset した
    // カウンターの有効範囲は親 owner の中)・しおり・string-set。匿名の表の最初の部分 (entered) は、flowChildren が済ませている。
    // string-set のマーカーは、次に作るセル・caption の中身の先頭に置く (行・行グループのものは、その最初のセルに入る)
    const entered = anon?.[0];
    let marks: LMarker[] = [];
    const enter = (e: Element, owner: Element) => {
      if (e === entered) return;
      this.enterCounters(this.cs(e), owner);
      this.bookmark(e);
      marks.push(...this.stringSet(e));
    };
    const takeMarks = (): LMarker[] => marks.splice(0);
    const rowOf = (tr: Element, anonCells?: Element[], owner: Element = el): LTableRow => {
      if (!anonCells) enter(tr, owner);
      const row = rowOf0(tr, anonCells);
      // 匿名の行 (行の無いセルを包む行) は、書式を持たない
      if (anonCells) return row;
      // 行の中で reset したカウンター (セルの counter-reset) は、行を出るときに外す (Lists 3 §4.4: 有効範囲は親の中)
      this.leaveCounters(tr);
      // 行の id は、リンク・しおりの飛び先 (行の領域に付く)
      const rowId = tr.getAttribute('id');
      if (rowId) row.id = rowId;
      // 行の改ページの指定 (Fragmentation 3 §3: break-* は表の行にも効く)
      const rc = this.cs(tr);
      const bb = rc('break-before') || rc('page-break-before');
      const ba = rc('break-after') || rc('page-break-after');
      if (/avoid/.test(rc('break-inside') || rc('page-break-inside'))) row.keepTogether = true;
      if (/^(page|always|left|right|recto|verso)$/.test(bb)) row.breakBefore = true;
      if (/avoid/.test(bb)) row.keepWithPrevious = true;
      if (/avoid/.test(ba)) row.keepWithNext = true;
      if (/^(page|always|left|right|recto|verso)$/.test(ba)) row.breakAfter = true;
      paintCells(row, bgOf(tr));
      // 行の罫線は、罫線を重ねる表でだけ使う (CSS 2.1 §17.6.1: 罫線を分ける表の行・行グループには罫線が無い)
      const rb = collapse ? this.boxStyle(tr).border : undefined;
      if (rb) row.border = rb;
      return row;
    };
    const rowOf0 = (tr: Element, anonCells?: Element[]): LTableRow => ({
      type: 'table-row',
      // 行の書式 (表との差分)。セルの書式は行との差分なので、行に付けた font-size などをセルへ受け継がせる
      ...(anonCells ? {} : this.textStyle(tr, el)),
      // 行の height は、行の高さの最小値 (CSS 2.1 §17.5.3)
      ...(() => {
        if (anonCells || this.src.isAuto?.(tr, 'height') !== false) return {};
        const h = this.cs(tr)('height');
        const v = /%$/.test(h) ? undefined : cssLen(h);
        return v ? { minHeight: v } : {};
      })(),
      cells: (anonCells ?? Array.from(tr.children))
        .filter((td) => this.display(td) !== 'none' && (/^table-cell$/.test(this.display(td)) || /^t[dh]$/.test(td.localName)))
        .map((td): LTableCell => {
          const tc = this.cs(td);
          enter(td, tr);
          const pre = takeMarks();
          // セルの中の最初・最後のブロックの margin は捨てない (CSS 2.1 §17.5: セルは新しい整形文脈で、中の margin はセルの外と重ならない。<td><p> の上下の margin)
          const cell: LTableCell = { type: 'table-cell', keepEdgeSpace: true, ...this.textStyle(td, tr), ...this.paragraphStyle(td, tr), ...this.boxStyle(td), children: this.flowChildren(td) };
          if (pre.length) cell.children.unshift(...pre);
          const cs = Math.min(MAX_COL_SPAN, parseInt(td.getAttribute('colspan') ?? '1', 10));
          const rs = Math.min(MAX_ROW_SPAN, parseInt(td.getAttribute('rowspan') ?? '1', 10));
          if (cs > 1) cell.colSpan = cs;
          if (rs > 1) cell.rowSpan = rs;
          const va = tc('vertical-align');
          if (va === 'middle') cell.blockAlign = 'center';
          else if (va === 'bottom') cell.blockAlign = 'end';
          else if (va === 'baseline') cell.blockAlign = 'baseline';
          delete (cell as { margin?: unknown }).margin;
          return cell;
        }),
    });
    // 行グループ: 中の行を読み、グループの背景 (行より下) と、罫線を重ねる表ではグループの罫線を付ける
    const group = (g: Element, into: LTableRow[], owner: Element) => {
      const start = into.length;
      enter(g, owner);
      walk(g, into);
      this.leaveCounters(g);
      const rows = into.slice(start);
      // 行グループの id (リンク・しおりの飛び先) は、最初の行に付ける (その行に id が無ければ)
      const gid = g.getAttribute('id');
      if (gid && rows[0] && !rows[0].id) rows[0].id = gid;
      const bg = bgOf(g);
      for (const r of rows) paintCells(r, bg);
      const gb = collapse && rows.length ? this.boxStyle(g).border : undefined;
      if (gb) rows.forEach((r, k) => (r.group = { border: gb, first: k === 0, last: k === rows.length - 1 }));
    };
    const walk = (n: Element, into: LTableRow[], list?: Element[]) => {
      // 表・行グループの直下のセルは、続くものをまとめて匿名の行で包む (CSS 2.1 §17.2.1)
      let pend: Element[] = [];
      const flushCells = () => {
        if (pend.length) into.push(rowOf(n, pend));
        pend = [];
      };
      for (const ch of list ?? Array.from(n.children)) {
        const d = this.display(ch);
        if (d === 'none') continue;
        // visibility: collapse の行・行グループは、表から除く (CSS 2.1 §17.5.5)
        if (/^table-(row|row-group|header-group|footer-group)$/.test(d) && this.cs(ch)('visibility') === 'collapse') continue;
        if (d === 'table-cell' || /^t[dh]$/.test(ch.localName)) {
          pend.push(ch);
          continue;
        }
        flushCells();
        if (d === 'table-row' || ch.localName === 'tr') into.push(rowOf(ch, undefined, n));
        else if (d === 'table-header-group' || ch.localName === 'thead') {
          group(ch, header, n);
          // 見出しの行の組の後ろで改ページしない (break-after: avoid。CSS 2.1 §13.3.3 の規則 A)
          if (this.cs(ch)('break-after') === 'avoid' || this.cs(ch)('page-break-after') === 'avoid') headerAvoidBreak = true;
        }
        else if (d === 'table-footer-group' || ch.localName === 'tfoot') group(ch, footer, n);
        else if (d === 'table-row-group' || ch.localName === 'tbody') group(ch, body, n);
        else if (d === 'table-column-group' || ch.localName === 'colgroup') walk(ch, body);
        else if (d === 'table-column' || ch.localName === 'col') {
          const span = Math.min(MAX_COL_SPAN, parseInt(ch.getAttribute('span') ?? '1', 10) || 1);
          // 幅の % (自前のカスケードは % のまま返す) は、比例の列幅にする (表の幅を % の比で分ける)
          const cw = this.cs(ch)('width');
          const w: LTableColumn['width'] | undefined =
            this.src.isAuto?.(ch, 'width') !== false ? undefined : /%$/.test(cw.trim()) ? (`${parseFloat(cw)}*` as const) : cssLen(cw);
          for (let k = 0; k < span; k++) columns.push({ type: 'table-column', ...(w ? { width: w } : {}) });
        } else if (d === 'table-caption' || ch.localName === 'caption') {
          // 見出し: 表の子 (表の部分の中ではない) のときだけ。caption-side は top・bottom (CSS Tables 3 §3.5.3)
          if (n !== el || anon) continue;
          // caption のマーカーは caption の中身の先頭に置く (前の行・セルのマーカーの残りは、次のセルへ送る)
          const held = takeMarks();
          enter(ch, el);
          const pre = takeMarks();
          marks = held;
          const block: LBlock = { type: 'block', ...this.textStyle(ch, el), ...this.paragraphStyle(ch, el), ...this.boxStyle(ch), children: [] };
          this.blockStack.push(block);
          block.children = [...pre, ...this.flowChildren(ch)];
          this.blockStack.pop();
          captions.push({ side: this.cs(ch)('caption-side') === 'bottom' ? 'bottom' : 'top', block });
        }
      }
      flushCells();
    };
    walk(el, body, anon);
    // 表の部分が表の中に reset したカウンターは、表を出るときに外す (匿名の表では、el は外の容器なので、容器を出るときに外れる)
    if (!anon) this.leaveCounters(el);
    const t: LTable = {
      type: 'table',
      ...(anon ? {} : this.textStyle(el, parent)),
      ...(anon ? {} : this.boxStyle(el)),
      columns,
      body: { type: 'table-body', rows: body },
      borderCollapse: c('border-collapse') === 'collapse' ? 'collapse' : 'separate',
    } as LTable;
    // border-spacing (罫線を分ける表のセルの間隔。計算値は "横 縦" の px)
    if (t.borderCollapse === 'separate') {
      const bs = (c('border-spacing') ?? '').trim().split(/\s+/).map((v) => (parseFloat(v) || 0) * PT_PER_PX);
      const si = bs[0] ?? 0;
      const sb = bs[1] ?? si;
      if (si > 0 || sb > 0) t.borderSpacing = { i: si, b: sb };
    }
    // 固定レイアウト (幅の指定のある table-layout: fixed): 列の幅の指定が無い列は、1 行目のセルの幅の指定で決める (CSS 2.1 §17.5.2.1)
    const firstRow = [...header, ...body][0];
    if (c('table-layout') === 'fixed' && t.width !== undefined && firstRow) {
      const ws: Array<number | undefined> = [];
      for (const cell of firstRow.cells) {
        const span = Math.max(cell.colSpan ?? 1, 1);
        const w = typeof cell.width === 'number' ? cell.width : undefined;
        const pad = (cell.padding ?? {}) as Record<string, number>;
        const bd = (cell.border ?? {}) as Record<string, { width: number } | undefined>;
        const extra = cell.boxSizing === 'border-box' ? 0 : (pad.left ?? 0) + (pad.right ?? 0) + (bd.left?.width ?? 0) + (bd.right?.width ?? 0);
        for (let k = 0; k < span; k++) ws.push(w !== undefined ? (w + extra) / span : undefined);
      }
      // 列の幅の指定のある列はそのまま、無い列だけ 1 行目のセルの幅で
      ws.forEach((w, k) => {
        if (w === undefined) return;
        if (!columns[k]) {
          while (columns.length < k) columns.push({ type: 'table-column' });
          columns.push({ type: 'table-column', width: w });
        } else if (columns[k].width === undefined) columns[k] = { ...columns[k], width: w };
      });
    }
    // 幅が auto の表は、table-layout が fixed でも自動レイアウト (CSS 2.1 §17.5.2)。列の最小の幅は、列の幅の指定とセルの最小の幅の
    // 大きい方 (§17.5.2.2。組むときに決める)。列の幅がすべて決まっていれば、左右の余白が両方 auto のとき、その合計の幅で残りを等分する (§10.3.3)
    const nCols = Math.max(0, ...[...header, ...body, ...footer].map((r) => r.cells.reduce((a, x) => a + (x.colSpan ?? 1), 0)));
    if (t.width === undefined && !this.src.rect && columns.length && columns.length >= nCols && columns.every((col) => typeof col.width === 'number')) {
      const gaps = t.borderSpacing ? t.borderSpacing.i * (columns.length + 1) : 0;
      const est = columns.reduce((a, col) => a + (col.width as number), 0) + gaps;
      // collapse の表は、組むときに外枠の罫線と合わせて中央に置く (LTable.autoMargins。列の幅を縮めない)
      if (c('margin-left') === 'auto' && c('margin-right') === 'auto' && el.parentElement && t.borderCollapse !== 'collapse') {
        const cw = this.src.contentWidth?.(el.parentElement);
        const e = (k: 'padding' | 'border') => {
          const v = t[k] as Record<string, number | { width: number }> | undefined;
          const w = (x: number | { width: number } | undefined) => (typeof x === 'number' ? x : (x?.width ?? 0));
          return w(v?.left) + w(v?.right);
        };
        const extra = e('padding') + e('border');
        const m = cw === undefined ? 0 : (cw * PT_PER_PX - est - extra) / 2;
        if (m > 0) t.margin = { ...(t.margin as object), left: m, right: m };
      }
    }
    // 互換モードの、中身の無い表 (行グループ・見出し・列の無い表): 高さ 0、罫線なし (Quirks Mode §3.10)
    if (!anon && isQuirksDoc(el.ownerDocument as Document | null)) {
      const hasBox = Array.from(el.childNodes).some((n) => {
        if (n.nodeType === 3 || n.nodeType === 4) return /[^\t\n\f\r ]/.test(n.textContent ?? '');
        if (n.nodeType !== 1) return false;
        const d = this.display(n as Element);
        if (d === 'none') return false;
        if (d === 'table-column-group') return Array.from((n as Element).children).some((k) => this.display(k) === 'table-column');
        return true;
      });
      if (!hasBox) {
        delete (t as { border?: unknown }).border;
        delete t.borderSpacing;
        delete (t as { height?: unknown }).height;
      }
    }
    if (captions.length) t.captions = captions;
    if (this.opts.tableCollapseSpillAh && t.borderCollapse === 'collapse') t.collapseSpillAh = true;
    if (this.opts.tableRowspanMiddleAh) t.rowspanMiddleAh = true;
    // 表ヘッダーを本体の最初の行と同じページに置く (アンテナハウス互換の設定、または表ヘッダーの break-after: avoid)
    if (this.opts.tableHeaderWithBodyAh || headerAvoidBreak) t.keepHeaderWithBodyAh = true;
    if (header.length) t.header = { type: 'table-body', rows: header };
    if (footer.length) t.footer = { type: 'table-body', rows: footer };
    // 自動レイアウト: 幅が auto の表 (table-layout によらない) と、幅の指定のある table-layout: auto の表。列の幅は中身と列の幅の指定から決める
    // (CSS2 §17.5.2.2)。比例の列幅 (百分率の col) のある表は、従来どおり比で分ける
    const noStar = columns.every((col) => typeof col.width !== 'string');
    if (t.width === undefined && noStar) {
      t.fitContent = true;
      // 余白が auto の向き。組むときに表の幅が決まってから、残りを auto の余白に配る (CSS 2.1 §10.3.3)
      const ml = c('margin-left') === 'auto', mr = c('margin-right') === 'auto';
      if (ml || mr) t.autoMargins = ml && mr ? 'center' : ml ? 'start' : 'end';
    }
    else if (t.width !== undefined && c('table-layout') !== 'fixed' && noStar) t.fillContent = true;
    if (t.fitContent || t.fillContent) t.columnWidthsAsMinimum = true;
    if (t.fitContent && this.opts.tableAutoWidthAh) t.fitContentRule = 'ah-html';
    return t;
  }

  /** ページマスター (@page の宣言から) */
  private masterOf(decls: Record<string, string>): PageMaster {
    const def = this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 };
    const pb = pageBox(decls, def, this.rootFsPx, this.opts.spotColors);
    return {
      width: pb.width,
      height: pb.height,
      bleed: pb.bleed ?? this.opts.bleedMm ?? 0,
      trimMarks: pb.marks ?? this.opts.trimMarks ?? false,
      // トンボの領域の幅は、塗り足しの外側から数える
      ...(pb.background ? { backgroundColor: pb.background } : {}),
      ...(pb.cropOffset !== undefined ? { trimMarkMargin: Math.max(pb.cropOffset - (pb.bleed ?? this.opts.bleedMm ?? 0), 0) } : {}),
      margins: pb.margins,
      ...(this.pageColumns ? { columns: this.pageColumns } : {}),
    };
  }

  /** 余白の箱の content → 行内の要素 (ページ番号・総ページ数・string()・element()) */
  private boxContent(v: string): Array<LInlineLevel | LRetrieveMarker> {
    const out: Array<LInlineLevel | LRetrieveMarker> = [];
    for (const t of parseContent(v)) {
      if (t.kind === 'str') out.push(t.v);
      else if (t.kind !== 'fn') continue;
      else if (t.name === 'counter' && t.args[0] === 'page') {
        out.push('{pageNumber}');
        if (this.pageFormat === null) this.pageFormat = pageNumberFormatOf(t.args[1]) ?? '1';
      } else if (t.name === 'counter' && t.args[0] === 'pages') out.push('{totalPages}');
      else if (t.name === 'env') {
        // env(doc-title): 文書の題 (<title>)。env(url) などは空
        if (t.args[0] === 'doc-title') out.push(this.docTitle);
      } else if (t.name === 'string' || t.name === 'element') {
        const pos = t.args[1] ?? 'first';
        out.push({ type: 'retrieve-marker', className: `${t.name === 'string' ? 'string' : 'running'}:${t.args[0]}`, position: MARKER_POS[pos] ?? 'first-including-carryover', boundary: 'document' });
      } else this.miss(`@page content:${t.name}()`);
    }
    return out;
  }

  /** 文書の題 (<title>。余白の箱の env(doc-title)) */
  private docTitle = '';

  /**
   * 上下の辺の余白の箱 (@top-left・@top-center・@top-right など。A・B・C) の、外側の幅と位置 (Page 3 §5.3.2)。
   *  - B が無ければ、A と C で残りの幅を分ける。auto の幅は、内容の max-content (入らなければ min-content) の幅に比べて分ける
   *  - B があれば、B と、A・C の大きい方の 2 倍の箱 (AC) で分けて B の幅を決め、A・C は (残り ÷ 2) にする (B を中央に置く)
   *  - A は左端、B は中央、C は右端に置く。auto の margin は 0
   * 内容に文字列 (string()・element()) を含む辺は、内容の幅が組むまで分からないので、ここでは決めない (箱は辺の幅いっぱい)
   */
  private marginBoxWidths(boxes: Record<string, Record<string, string>>, inherited: Record<string, string>, rootFs: number, x0: number, avail: number): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const edge of ['top', 'bottom'] as const) {
      const names = [`${edge}-left`, `${edge}-center`, `${edge}-right`];
      interface Info { name: string; extra: number; width?: number; max: number; min: number }
      const infos: Array<Info | undefined> = [];
      let unknown = false;
      for (const name of names) {
        const own = boxes[name];
        const decls = own ? { ...inherited, ...own } : undefined;
        const content = decls?.content;
        if (!decls || !content || content === 'none' || content === 'normal') {
          infos.push(undefined);
          continue;
        }
        const fs = lenEm(decls['font-size'] ?? '', rootFs) ?? rootFs;
        const items = this.boxContent(content);
        if (items.some((x) => typeof x !== 'string')) unknown = true;
        // ページ番号の印は、3 桁の数の幅とみなす
        const text = items.map((x) => (typeof x === 'string' ? x.replace(/\{(pageNumber|totalPages)\}/g, '000') : '')).join('');
        const weight = /bold/.test(decls['font-weight'] ?? '') ? 700 : parseInt(decls['font-weight'] ?? '', 10) || 400;
        const names2 = (decls['font-family'] ?? '').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        const family = names2.length ? this.opts.mapFont?.(names2, weight >= 600) : undefined;
        const measure = (s: string) =>
          this.opts.measureText ? this.opts.measureText(s, { fontFamily: family, fontWeight: weight, fontSize: fs }) : [...s].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0) * fs;
        const max = measure(text);
        const min = Math.max(0, ...text.split(/\s+/).map(measure));
        const len = (k: string) => (decls[k] === undefined || decls[k] === 'auto' ? 0 : (lenEm(decls[k], fs) ?? 0));
        const sideLen = (k: 'margin' | 'padding') => {
          const all = decls[k] ? edges4(decls[k], fs) : { left: 0, right: 0, top: 0, bottom: 0 };
          return (decls[`${k}-left`] !== undefined ? len(`${k}-left`) : all.left) + (decls[`${k}-right`] !== undefined ? len(`${k}-right`) : all.right);
        };
        const bw = (side: string) => {
          const v = decls[`border-${side}`] ?? decls.border;
          return v ? (parseBorder(v, fs)?.width ?? 0) : 0;
        };
        const extra = sideLen('margin') + sideLen('padding') + bw('left') + bw('right');
        const wv = decls.width;
        const width = wv === undefined || wv === 'auto' ? undefined : /%$/.test(wv) ? (avail * parseFloat(wv)) / 100 : lenEm(wv, fs);
        infos.push({ name, extra, ...(width !== undefined ? { width: width + extra } : {}), max: max + extra, min: min + extra });
      }
      if (unknown || infos.every((x) => !x)) continue;
      // 2 つの箱で幅を分ける (§5.3.2.2 の A・C の手順)。決まった幅 (width の指定) はそのまま
      const share = (p: { width?: number; max: number; min: number }, q: { width?: number; max: number; min: number }): [number, number] => {
        if (p.width !== undefined && q.width !== undefined) return [p.width, q.width];
        if (p.width !== undefined) return [p.width, Math.max(0, avail - p.width)];
        if (q.width !== undefined) return [Math.max(0, avail - q.width), q.width];
        const flex = (base: [number, number], f: [number, number]) => {
          const space = avail - base[0] - base[1];
          const sum = f[0] + f[1] || 2;
          const ff: [number, number] = f[0] + f[1] ? f : [1, 1];
          return [base[0] + (space * ff[0]) / sum, base[1] + (space * ff[1]) / sum] as [number, number];
        };
        if (p.max + q.max < avail) return flex([p.max, q.max], [p.max, q.max]);
        if (p.min + q.min < avail) return flex([p.min, q.min], [p.max - p.min, q.max - q.min]);
        return flex([p.min, q.min], [p.min, q.min]);
      };
      const [A, B, C] = infos;
      const none = { max: 0, min: 0, width: 0 };
      if (!B) {
        const [wa, wc] = share(A ?? none, C ?? none);
        if (A) out.set(A.name, [x0, wa]);
        if (C) out.set(C.name, [x0 + avail - wc, wc]);
      } else {
        const ac = { max: 2 * Math.max(A?.max ?? 0, C?.max ?? 0), min: 2 * Math.max(A?.min ?? 0, C?.min ?? 0) };
        const [wb] = share(B, ac);
        const side = (avail - wb) / 2;
        out.set(B.name, [x0 + (avail - wb) / 2, wb]);
        if (A) out.set(A.name, [x0, A.width ?? side]);
        if (C) out.set(C.name, [x0 + avail - (C.width ?? side), C.width ?? side]);
      }
    }
    return out;
  }

  /** 根元の要素 (html・body) の背景 (@page の宣言の形)。ページの背景にする */
  private rootBackground?: Record<string, string>;

  /** 参照番号 (::footnote-call) の字の大きさ (置く所の字に対する比) と太さ。脚注の要素 e の値に、::footnote-call の規則を重ねる */
  private footnoteCallStyle(e: Element, parent: Element): Pick<LFootnote, 'referenceScale' | 'referenceWeight' | 'referenceLineHeight'> {
    const call = this.footnoteRules.filter((r) => /call$/.test(r.selector)).reduce<Record<string, string>>((a, r) => ({ ...a, ...r.decls }), {});
    const fnFs = cssLen(this.cs(e)('font-size'));
    const parentFs = cssLen(this.cs(parent)('font-size'));
    const out: Pick<LFootnote, 'referenceScale' | 'referenceWeight' | 'referenceLineHeight' | 'referenceShift'> = {};
    // アンテナハウス互換: 上付きの上げ幅は、置く所の字の大きさの 1/3 (superShiftAh)
    const cva = (call['vertical-align'] ?? 'super').trim().toLowerCase();
    if (this.opts.superShiftAh && parentFs && cva === 'super') out.referenceShift = parentFs / 3;
    if (fnFs && parentFs) {
      const callFs = (call['font-size'] ? lenEm(call['font-size'], fnFs) : undefined) ?? fnFs;
      if (call['font-size']) out.referenceScale = callFs / parentFs;
      // 行の高さ (line-height) も脚注の要素から受け継ぐ (GCPM 3 §2.6 の既定のスタイルは line-height: inherit)。
      // 数値 (1.2 など) は参照番号の字の大きさに掛ける。置く所の行の line-height を小さな字に当てると、字の箱が支柱の下へはみ出して行が広がる
      // アンテナハウス互換: 行の高さは置く所の要素から受け継ぐ (数値は参照番号の字の大きさに掛かる)。参照番号には渡さず、置く所の書式のまま
      if (this.opts.footnoteCallLineHeightFromParent && !call['line-height']) {
        // 置く所の line-height が数値なら、参照番号の字の大きさに掛ける (絶対値なら、置く所の値をそのまま受け継ぐ)
        const pNum = this.cs(parent)('-kumiori-line-height-number');
        if (pNum) out.referenceLineHeight = parseFloat(pNum) * callFs;
      } else {
        const lhNum = this.cs(e)('-kumiori-line-height-number');
        const lh = (call['line-height'] ?? (lhNum || this.cs(e)('line-height'))).trim();
        if (/^[\d.]+$/.test(lh)) out.referenceLineHeight = parseFloat(lh) * callFs;
        else if (call['line-height'] && lenEm(lh, callFs)) out.referenceLineHeight = lenEm(lh, callFs);
        else if (!call['line-height'] && cssLen(lh)) out.referenceLineHeight = cssLen(lh);
      }
    }
    const w = (call['font-weight'] ?? '').trim().toLowerCase();
    const weight = w === 'normal' ? 400 : w === 'bold' ? 700 : /^\d+$/.test(w) ? Number(w) : Number(this.cs(e)('font-weight')) || undefined;
    if (weight) out.referenceWeight = weight;
    return out;
  }

  /** ::footnote-call / ::footnote-marker の規則 */
  private footnoteRules: StyleRule[] = [];

  /** float: sidenote を置く側: @page の @sidenote の float (アンテナハウスの拡張。無ければ end) */
  private sidenoteSide(): string {
    const v = (resolvePageRules(this.pageRules, {}).boxes.sidenote?.float ?? '').trim().toLowerCase();
    return /^(left|right|inside|outside|start|end)$/.test(v) ? v : 'end';
  }

  /**
   * 脚注の書式: @page の @footnote (区切り線: border-top・border-length、上の空き: margin-top・padding-top) と、
   * ::footnote-call / ::footnote-marker (番号の書式 counter(footnote, …) と前後の文字、参照番号の字の大きさ)
   */
  private footnoteOptions(master: PageMaster, box: Record<string, string> | undefined, rootFs: number): FootnoteOptions | undefined {
    const fo: FootnoteOptions = {};
    const bodyFs = cssLen(this.cs(this.bodyEl!)('font-size')) ?? rootFs;
    if (box) {
      const fs = lenEm(box['font-size'] ?? '', rootFs) ?? rootFs;
      const bt = box['border-top'] ?? box.border;
      const b = bt ? parseBorder(bt, fs) : undefined;
      // 区切りの長さの % の基準は、本文領域の行の向きの長さ (縦書きは高さ)
      const vertArea = /^(vertical|sideways-rl)/.test(this.cs(this.bodyEl!)('writing-mode'));
      const area = (vertArea ? master.height - master.margins.top - master.margins.bottom : master.width - master.margins.left - master.margins.right) * (72 / 25.4);
      const lenV = (box['border-length'] ?? '').split(/\s+/)[0];
      const length = /%$/.test(lenV) ? (area * parseFloat(lenV)) / 100 : lenEm(lenV, fs);
      const sp = (k: string) => lenEm(box[k] ?? '', fs) ?? 0;
      // 領域の行の向きの padding は、脚注本文の始め側・終わり側の空き。区切りの前後は block の始め側の margin・padding
      // (横書きは左右・上、縦書きは上下・右 (vertical-lr は左))
      const rwm = this.cs(this.bodyEl!)('writing-mode');
      const vert = /^(vertical|sideways-rl)/.test(rwm);
      const [is, ie, bs] = vert ? ['top', 'bottom', rwm === 'vertical-lr' ? 'left' : 'right'] : ['left', 'right', 'top'];
      const pl = sp(`padding-${is}`);
      const pr = sp(`padding-${ie}`);
      if (pl || pr) fo.inset = { start: pl, end: pr };
      const bsBorder = vert ? (box[`border-${bs}`] ?? box.border) : bt;
      const b2 = vert ? (bsBorder ? parseBorder(bsBorder, fs) : undefined) : b;
      fo.separator = bsBorder && !b2 ? false : { ...(b2 ? { thickness: b2.width, color: b2.color } : {}), ...(length ? { length } : {}), spaceBefore: sp(`margin-${bs}`), spaceAfter: sp(`padding-${bs}`) };
    }
    const call = this.footnoteRules.filter((r) => /call$/.test(r.selector)).reduce<Record<string, string>>((a, r) => ({ ...a, ...r.decls }), {});
    const content = call.content ?? this.footnoteRules.filter((r) => /marker$/.test(r.selector)).reduce<string | undefined>((a, r) => r.decls.content ?? a, undefined);
    if (content) {
      const toks = parseContent(content);
      const k = toks.findIndex((t) => t.kind === 'fn' && t.name === 'counter');
      if (k >= 0) {
        const str = (ts: ContentToken[]) => ts.map((t) => (t.kind === 'str' ? t.v : '')).join('');
        const pre = str(toks.slice(0, k));
        const post = str(toks.slice(k + 1));
        if (pre) fo.labelPrefix = pre;
        if (post) fo.labelSuffix = post;
        const style = (toks[k] as { args: string[] }).args[1];
        const f = pageNumberFormatOf(style);
        if (f) fo.format = f;
      }
    }
    // 脚注本文の番号 (::footnote-marker) の置き方: list-style-position (GCPM 3 §2.7: ::marker と同じに振る舞い、既定は inside。
    // https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/ 、2026-11-04 取得)。
    // outside の番号の終わりと本文の始めの間は、字の大きさの半分 (7.5pt の字なら 3.75pt)
    const marker = this.footnoteRules.filter((r) => /marker$/.test(r.selector)).reduce<Record<string, string>>((a, r) => ({ ...a, ...r.decls }), {});
    const lsp = /\b(inside|outside)\b/.exec(marker['list-style-position'] ?? marker['list-style'] ?? '')?.[1] ?? (this.opts.footnoteMarkerOutside ? 'outside' : 'inside');
    fo.labelPosition = lsp as 'inside' | 'outside';
    // 脚注どうしの間は空けない (CSS では脚注の要素の余白だけ)
    fo.spacing = 0;
    if (lsp === 'outside') fo.labelGapEm = 0.5;
    const callFs = lenEm(call['font-size'] ?? '', bodyFs);
    if (callFs) fo.referenceScale = callFs / bodyFs;
    return Object.keys(fo).length ? fo : undefined;
  }

  /** @page の背景画像 (background / background-image の url()) → ページの背景画像 (本文より先に、塗り足しまで描く) */
  private pageBackground(decls: Record<string, string>): BackgroundImage | undefined {
    const v = decls['background-image'] ?? decls.background ?? '';
    const u = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v);
    // グラデーションは、ページの背景の領域の大きさで組版のときに画像にする
    const grad = u ? undefined : firstGradient(v);
    if (grad) return { src: '', gradient: grad, gradientFontSize: cssLen(decls['font-size'] ?? '') ?? 12 };
    if (!u) return undefined;
    const img: BackgroundImage = { src: normalizeSrc(u[1]) };
    const bsz = (decls['background-size'] ?? '').trim();
    if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
    else {
      const sz = bsz.split(/\s+/).map(cssLen);
      if (sz[0] !== undefined) img.width = sz[0];
      if (sz[1] !== undefined) img.height = sz[1];
    }
    // 一括指定の no-repeat・位置 (center / 百分率)
    if (/no-repeat/.test(v) || /no-repeat/.test(decls['background-repeat'] ?? '') || img.size) img.repeat = 'no-repeat';
    const posv = (decls['background-position'] ?? v.replace(/url\([^)]*\)/, '')).trim().split(/\s+/).filter((t) => /^(center|left|right|top|bottom|-?[\d.]+%)$/.test(t));
    if (posv.includes('center') || !posv.length) [img.x, img.y] = ['center', 'center'];
    const pct = posv.filter((t) => /%$/.test(t)) as Array<`${number}%`>;
    if (pct.length) [img.x, img.y] = [pct[0], pct[1] ?? pct[0]];
    if (posv.includes('left')) img.x = 'left';
    if (posv.includes('right')) img.x = 'right';
    if (posv.includes('top')) img.y = 'top';
    if (posv.includes('bottom')) img.y = 'bottom';
    this.report.images.push(img.src);
    return img;
  }

  /** ページ余白の箱 (@top-center など) → 静的コンテンツ (ページの左上を原点に、pt で置く) */
  private marginBoxes(master: PageMaster, boxes: Record<string, Record<string, string>>, rootFs: number, pageDecls: Record<string, string> = {}): LBlockContainer[] {
    // 余白の箱は、@page に書いた受け継ぐ性質 (字の大きさ・書体・行送りなど) を受け継ぐ
    const inherited = Object.fromEntries(
      Object.entries(pageDecls).filter(([k]) => /^(font-size|font-family|font-weight|font-style|color|line-height|letter-spacing)$/.test(k)),
    );
    const PT = 72 / 25.4;
    const W = master.width * PT;
    const H = master.height * PT;
    const m = { top: master.margins.top * PT, right: master.margins.right * PT, bottom: master.margins.bottom * PT, left: master.margins.left * PT };
    const out: LBlockContainer[] = [];
    const along = this.marginBoxWidths(boxes, inherited, rootFs, m.left, W - m.left - m.right);
    for (const [name, own] of Object.entries(boxes)) {
      const decls = { ...inherited, ...own };
      const pos = MARGIN_BOXES[name];
      if (name === 'footnote' || name === 'sidenote') continue; // 脚注の領域 (footnoteOptions で扱う)・傍注の置き方 (sidenoteSide で扱う)
      if (!pos) {
        this.miss(`@${name}`);
        continue;
      }
      const content = decls.content;
      if (!content || content === 'none' || content === 'normal') continue;
      const fs = lenEm(decls['font-size'] ?? '', rootFs) ?? rootFs;
      // 箱の位置: 上下の辺は本文の幅いっぱい (隅は余白の角)、左右の辺は本文の高さいっぱい
      let x: number, y: number, w: number, h: number;
      if (pos.edge === 'top' || pos.edge === 'bottom') {
        y = pos.edge === 'top' ? 0 : H - m.bottom;
        h = pos.edge === 'top' ? m.top : m.bottom;
        if (pos.part === 'corner-start') [x, w] = [0, m.left];
        else if (pos.part === 'corner-end') [x, w] = [W - m.right, m.right];
        // 上下の辺の 3 つの箱の幅と位置 (Page 3 §5.3.2 の「Variable Dimension Computation Rules」で決めたもの)
        else if (along.has(name)) [x, w] = along.get(name)!;
        else [x, w] = [m.left, W - m.left - m.right];
      } else {
        x = pos.edge === 'left' ? 0 : W - m.right;
        w = pos.edge === 'left' ? m.left : m.right;
        [y, h] = [m.top, H - m.top - m.bottom];
      }
      // 箱の margin は、箱を内側へ縮める
      const mg = decls.margin ? edges4(decls.margin, fs) : { top: 0, right: 0, bottom: 0, left: 0 };
      for (const sd of ['top', 'right', 'bottom', 'left'] as const) {
        const v = decls[`margin-${sd}`];
        if (v !== undefined) mg[sd] = lenEm(v, fs) ?? 0;
      }
      // 余白が 0 のページ (全面の表紙など) では、箱を置く場所が無いので出さない
      if (w <= 0.5 || h <= 0.5) continue;
      x += mg.left;
      y += mg.top;
      w = Math.max(1, w - mg.left - mg.right);
      h = Math.max(1, h - mg.top - mg.bottom);
      const ta = (decls['text-align'] ?? '').toLowerCase();
      const defAlign = pos.edge === 'left' || pos.edge === 'right' ? 'center' : pos.part === 'start' || pos.part === 'corner-end' ? 'start' : pos.part === 'end' || pos.part === 'corner-start' ? 'end' : 'center';
      const align = ta === 'left' || ta === 'start' ? 'start' : ta === 'right' || ta === 'end' ? 'end' : ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : defAlign;
      const va = (decls['vertical-align'] ?? '').toLowerCase();
      const defV = pos.edge === 'left' || pos.edge === 'right' ? (pos.part === 'start' ? 'start' : pos.part === 'end' ? 'end' : 'center') : 'center';
      const blockAlign = va === 'top' ? 'start' : va === 'bottom' ? 'end' : va === 'middle' ? 'center' : defV;
      // 箱の大きさの指定 (width・height。百分率は余白の領域に対して): 辺の上の位置と縦の揃えで置く
      const size = (v: string | undefined, room: number) => (v === undefined || v === 'auto' ? undefined : /%$/.test(v) ? (room * parseFloat(v)) / 100 : lenEm(v, fs));
      const bw = size(decls.width, w);
      const bh = size(decls.height, h);
      if (bw !== undefined && bw < w && !along.has(name)) {
        const along = pos.edge === 'top' || pos.edge === 'bottom' ? pos.part : 'center';
        x += along === 'start' || along === 'corner-end' ? 0 : along === 'end' || along === 'corner-start' ? w - bw : (w - bw) / 2;
        w = bw;
      }
      if (bh !== undefined && bh < h) {
        y += blockAlign === 'start' ? 0 : blockAlign === 'end' ? h - bh : (h - bh) / 2;
        h = bh;
      }
      // opacity: 背景と文字の色を、白い紙に重ねた色にする
      const opacity = decls.opacity !== undefined ? Math.min(Math.max(parseFloat(decls.opacity), 0), 1) : 1;
      const fade = (col: string | undefined) => {
        if (!col || opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(col)) return col;
        const n = parseInt(col.slice(1), 16);
        return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(255 - opacity * (255 - c)).toString(16).padStart(2, '0')).join('')}`;
      };
      const ts: TextStyle = { fontSize: fs, textIndent: 0, textAlign: align };
      if (decls['font-weight']) ts.fontWeight = /bold/.test(decls['font-weight']) ? 700 : parseInt(decls['font-weight'], 10) || 400;
      if (decls['font-style']) ts.fontStyle = /italic|oblique/.test(decls['font-style']) ? 'italic' : 'normal';
      if (decls['font-family'] || ts.fontWeight) {
        const names = (decls['font-family'] ?? '').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        const mapped = names.length ? this.opts.mapFont?.(names, (ts.fontWeight ?? 400) >= 600) : undefined;
        if (mapped) ts.fontFamily = mapped;
      }
      if (decls.color) ts.color = this.printOf(decls, 'color') ?? cssColor(decls.color);
      if (decls['letter-spacing']) ts.letterSpacing = lenEm(decls['letter-spacing'], fs);
      if (decls['line-height']) {
        const lh = decls['line-height'];
        if (/^[\d.]+$/.test(lh)) ts.lineHeight = parseFloat(lh);
        else if (lenEm(lh, fs) !== undefined) ts.lineHeightPt = lenEm(lh, fs);
      }
      const box: LBlockContainer = {
        type: 'block-container',
        absolutePosition: true,
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        blockAlign,
        writingMode: this.wm(decls['writing-mode'] ?? '') ?? 'horizontal-tb',
        children: [{ type: 'block', ...ts, children: this.boxContent(content) as LInlineLevel[] }],
      };
      // z-index が負の余白の箱 (本文の絵の下に隠れるノンブルなど) は、本文の背面に置く
      if ((parseInt(decls['z-index'] ?? '', 10) || 0) < 0) box.layer = 'behind';
      const border: Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> = {};
      for (const [prop, val] of Object.entries(decls)) {
        const bm = /^border(?:-(top|right|bottom|left))?$/.exec(prop);
        if (!bm) continue;
        const b = parseBorder(val, fs);
        for (const sd of bm[1] ? [bm[1] as 'top'] : (['top', 'right', 'bottom', 'left'] as const)) {
          if (b) border[sd] = b;
          else delete border[sd];
        }
      }
      if (Object.keys(border).length) box.border = border;
      const pad = decls.padding ? edges4(decls.padding, fs) : undefined;
      const padding = { ...(pad ?? {}) } as Record<string, number>;
      for (const sd of ['top', 'right', 'bottom', 'left']) if (decls[`padding-${sd}`] !== undefined) padding[sd] = lenEm(decls[`padding-${sd}`], fs) ?? 0;
      if (Object.keys(padding).length) box.padding = padding;
      const bgv = decls['background-color'] ?? decls.background ?? '';
      const bg = this.printOf(decls, 'background-color', 'background') ?? cssColor(bgv);
      if (bg && /^(#|cmyk\(|spot\()/.test(bg)) box.backgroundColor = fade(bg);
      // 角丸 (border-radius・border-*-radius): ほかの箱と同じに描く。CSS Paged Media 3 §6 は、CSS 2.1 に無い性質の余白の箱での振る舞いを決めて
      // いない (CSS3 の性質を少しずつ足せるように、と注記する)。書いた順に一括指定を展開する
      const radius: Record<string, string> = {};
      const toPt = (x: string) => (/%$/.test(x) ? x : `${lenEm(x, fs) ?? 0}pt`);
      for (const [prop, val] of Object.entries(decls)) {
        const longs = prop === 'border-radius' ? expand(prop, val) : /^border-(top|bottom)-(left|right)-radius$/.test(prop) ? [[prop, val] as [string, string]] : [];
        for (const [k, v] of longs) radius[k] = v.trim().split(/\s+/).map(toPt).join(' ');
      }
      const rad = Object.keys(radius).length ? this.radiusOf((p) => radius[p] ?? '0px') : undefined;
      if (rad) box.borderRadius = rad;
      if (box.children[0] && (box.children[0] as LBlock).color) (box.children[0] as LBlock).color = fade((box.children[0] as LBlock).color);
      out.push(box);
    }
    return out;
  }

  /** 名前付きページ 1 つ分のページシーケンス (:first / :left / :right / :blank を条件付きのマスターにする) */
  /**
   * blankName: 末尾に白ページを足すとき (左右の改ページ)、白ページは次のページの名前のページにする (CSS の仕様。
   * 全面に色を敷いたページの後の白ページに、その色を付けない)
   */
  private sequence(
    pages: PageRule[],
    name: string,
    index: number,
    rootStyle: TextStyle,
    wm: WritingMode,
    children: Array<LBlockLevel | LInlineLevel>,
    rootFs: number,
    blankName?: string,
  ): LPageSequence {
    const applies = (r: PageRule, p: string) => (!r.name || r.name === name) && r.pseudos.includes(p) && (p !== 'first' || !!r.name || index === 0);
    const has = (p: string) => pages.some((r) => applies(r, p));
    const otherBlank = blankName !== undefined && blankName !== name;
    // 白ページの種類: 末尾に足す白ページ (次のページの名前)・途中の改ページで入る白ページ (このページの名前)・ふつうのページ
    type BlankKind = 'trailing' | 'blank' | 'none';
    const blanks: BlankKind[] = otherBlank ? ['trailing', 'blank', 'none'] : has('blank') ? ['blank', 'none'] : ['none'];
    const firsts = has('first') ? [true, false] : [false];
    const sides: Array<'left' | 'right' | undefined> = has('left') || has('right') ? ['right', 'left'] : [undefined];
    // 左右: 左から右へ進む本では右ページが奇数ページ。縦書き (右から左へ進む本) では左ページが奇数ページ
    const rtl = wm === 'vertical-rl';
    this.pageFormat = null;
    const alts: ConditionalPageMaster[] = [];
    for (const kind of blanks)
      for (const first of firsts)
        for (const side of sides) {
          const blank = kind !== 'none';
          const r = resolvePageRules(pages, { name: (kind === 'trailing' ? blankName : name) || undefined, first, side, blank, firstSequence: index === 0 }, ...this.pageWm);
          // @page に背景の指定が無ければ、根元の要素 (html・body) の背景をページの背景にする (CSS ではページ全体に広がる)
          const hasBg = Object.keys(r.decls).some((k) => /^background/.test(k));
          if (!hasBg && this.rootBackground) Object.assign(r.decls, this.rootBackground);
          const master = this.masterOf(r.decls);
          // 根元の要素の背景は、ページの余白の内側 (ページ領域) に描き、位置・大きさもそこに対して決める (CSS Paged Media・WeasyPrint)
          if (!hasBg && this.rootBackground) master.backgroundArea = 'content';
          const when: ConditionalPageMaster['when'] = {};
          if (blank) when.blankOrNotBlank = 'blank';
          if (kind === 'trailing') when.trailingBlank = true;
          if (first) when.pagePosition = 'first';
          if (side) when.oddOrEven = (side === 'right') !== rtl ? 'odd' : 'even';
          const pbg = this.pageBackground(r.decls);
          if (pbg) master.backgroundImage = pbg;
          alts.push({ when, master, staticContent: [...this.marginBoxes(master, r.boxes, rootFs, r.decls), ...this.fixed] });
        }
    const base = alts[alts.length - 1];
    const seq: LPageSequence = {
      type: 'page-sequence',
      ...rootStyle,
      master: base.master,
      staticContent: base.staticContent,
      flow: { type: 'flow', writingMode: wm, children: children as LBlockLevel[] },
    } as LPageSequence;
    if (alts.length > 1) seq.masterAlternatives = alts;
    const fo = this.footnoteOptions(base.master, resolvePageRules(pages, { name: name || undefined }).boxes.footnote, this.opts.pageContextFontSize ?? rootFs);
    // CSS の footnote カウンターは文書全体で 1 つ: 名前付きページで page-sequence が分かれても番号を続ける
    seq.footnotes = { ...fo, continueNumbering: true };
    if (this.pageFormat && this.pageFormat !== '1') seq.pageNumberFormat = this.pageFormat;
    return seq;
  }

  /** 文書全体 */
  run(doc: Document): LDocument {
    const html = doc.documentElement;
    const bodyEl = doc.body ?? (doc.getElementsByTagName('body')[0] as HTMLElement | undefined) ?? html;
    const { pages, rules, counterStyles, rootVars } = this.sheet;
    this.pageRules = pages;
    this.obsoleteGlyphs = this.opts.ahObsoleteListStyles ? OBSOLETE_LIST_GLYPHS : undefined;
    // 定義済みの数え方 (CSS Counter Styles 3 §6・§7.1.1・§7.1.2 の規則)。Kumiori が表記を持つ名前 (decimal など) は除く。文書の規則が優先する
    const predefined = [...predefinedCounterStyles()].filter(([k]) => !BUILTIN_COUNTER.test(k));
    this.counterStyles = new CounterStyles(new Map([...predefined, ...counterStyles]), (t, n) => this.builtinCounter(t, n), (t) => (this.obsoleteGlyphs && Object.hasOwn(this.obsoleteGlyphs, t) ? '' : builtinSuffix(t)));
    this.rootFsPx = (cssLen(this.cs(html)('font-size')) ?? 12) / PT_PER_PX;
    this.pageWm = [this.cs(html)('writing-mode') || 'horizontal-tb', this.cs(html)('direction') || 'ltr'];
    this.docTitle = doc.getElementsByTagName('title')[0]?.textContent?.trim() ?? '';
    // 根元の要素の背景 (html、無ければ body)
    let rootFromBody = false;
    for (const e of [html, bodyEl]) {
      const rc = this.cs(e);
      const col = cssColor(rc('background-color'));
      const imgv = rc('background-image');
      if (!col && !/url\(/.test(imgv)) continue;
      this.rootBackground = {
        ...(col ? { 'background-color': col } : {}),
        ...(/url\(/.test(imgv)
          ? { 'background-image': imgv, 'background-size': rc('background-size'), 'background-repeat': rc('background-repeat'), 'background-position': `${rc('background-position-x')} ${rc('background-position-y')}` }
          : {}),
      };
      rootFromBody = e === bodyEl && e !== html;
      break;
    }
    this.footnoteRules = rules.filter((r) => /^\*?::footnote-(call|marker)$/.test(r.selector.trim()));
    this.collectPaged(doc, rules, rootVars);
    this.bodyEl = bodyEl;
    const rootFs = cssLen(this.cs(html)('font-size')) ?? 12;
    // 本文 (body) の書式は、ページシーケンスの書式にする
    const rootStyle: TextStyle = { ...this.textStyle(bodyEl, undefined), ...this.paragraphStyle(bodyEl, undefined), wordSpaceShrink: this.opts.wordSpaceShrink ?? false, textAutospaceWidth: this.opts.autospaceWidth ?? 0.125, primaryFontMetrics: true, ...(this.opts.primaryFontByLangAh ? { primaryFontByLang: true } : {}) };
    // 互換モード・限定互換モードの行の高さ (Quirks Mode Standard §3.3・§3.4)
    if (documentModeOf(doc) !== 'no-quirks') Object.assign(rootStyle, { noStrut: true, lineHeightQuirk: true });
    // 和欧間アキの既定 (CSS Text 4 §8.4 の初期値 normal)。指定のある要素は、その指定 (spacing) で上書きする
    if (rootStyle.textAutospace === undefined) rootStyle.textAutospace = this.opts.autospaceInitial ?? true;
    if (this.opts.jaDefaultsAh) {
      rootStyle.punctuationTrimParagraphStart = true;
      // 追込みで詰める量は 1 行に二分まで (XSL-FO のアンテナハウス互換と同じ)
      rootStyle.lineSqueezeMax = 0.5;
    }
    const wm = this.wm(this.cs(bodyEl)('writing-mode')) ?? 'horizontal-tb';
    this.pagesRtl = wm === 'vertical-rl';
    const box = this.boxStyle(bodyEl);
    // body の背景をページの背景にしたときは、body の箱には描かない (CSS と同じ)
    if (rootFromBody) {
      delete box.backgroundColor;
      delete box.backgroundImage;
    }
    // 本文領域 (名前の無い @page) の余白と幅 (pt)
    const PT = 72 / 25.4;
    const base = pageBox(resolvePageRules(pages, {}, ...this.pageWm).decls, this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 }, this.rootFsPx, this.opts.spotColors);
    const bm = base.margins;
    this.area = { top: bm.top * PT, right: bm.right * PT, bottom: bm.bottom * PT, left: bm.left * PT, width: (base.width - bm.left - bm.right) * PT, height: (base.height - bm.top - bm.bottom) * PT };
    // body (か html) の段組は、ページの段組にする
    const pc = this.columnsOf(bodyEl, this.area.width) ?? this.columnsOf(html, this.area.width);
    if (pc) this.pageColumns = { count: pc.count, gap: pc.gap / PT, fill: pc.fill, ...(pc.rule ? { rule: pc.rule } : {}) };
    this.enterCounters(this.cs(html), null);
    this.enterCounters(this.cs(bodyEl), null);
    // body が flex・grid の容器なら、ブラウザが置いた配置で組む (body の箱も含める)。
    // さらに html が flex・grid の容器なら、body の箱を、ブラウザが置いた位置 (本文領域の左上から) に置く
    let children: Array<LBlockLevel | LInlineLevel>;
    let bodyBoxed = false;
    const fg = /^(inline-)?(flex|grid)$/.test(this.display(bodyEl)) ? this.flexGrid(bodyEl, html) : undefined;
    if (fg) {
      const htmlFlex = /^(inline-)?(flex|grid)$/.test(this.display(html));
      const r = htmlFlex ? this.src.rect?.(bodyEl) : undefined;
      if (r) {
        delete fg.margin;
        fg.margin = { top: r.y * PT_PER_PX, left: r.x * PT_PER_PX };
      } else if (htmlFlex && !this.src.rect) {
        // ブラウザの配置が無いとき: body の大きさが決まっていれば、html の justify-content・align-items で本文領域の中に寄せる
        const hc = this.cs(html);
        const bw = fg.width;
        const bh = fg.height;
        const areaH = (base.height - bm.top - bm.bottom) * PT;
        const at = (v: string, free: number) => (v === 'center' ? free / 2 : /end$/.test(v) ? free : 0);
        const left = bw !== undefined ? at(hc('justify-content'), Math.max(this.area.width - bw, 0)) : 0;
        const top = bh !== undefined ? at(hc('align-items'), Math.max(areaH - bh, 0)) : 0;
        if (left || top) fg.margin = { ...(fg.margin as object), ...(top ? { top } : {}), ...(left ? { left } : {}) };
      }
      children = [fg];
      bodyBoxed = true;
    } else children = this.flowChildren(bodyEl);
    // 名前付きページの切り替えで分ける
    const groups: Array<{ page: string; initial?: number; items: Array<LBlockLevel | LInlineLevel> }> = [{ page: '', items: [] }];
    for (const c of children) {
      if (typeof c !== 'string' && (c as unknown as PageSwitch).type === 'page-switch') {
        const sw = c as unknown as PageSwitch;
        const last = groups[groups.length - 1];
        // 前の組に流れの中の箱が無ければ (空白・絶対配置の箱・見えない箱の印だけ)、改ページせず、その組をこの名前のページにする
        // (ページの名前は流れの中の箱の間でだけ比べる。CSS Page 3 §8.1。最初のページの種類は、最初の流れの中の箱の page)
        if (!last.items.some((x) => this.inFlowItem(x))) Object.assign(last, { page: sw.page, initial: sw.initial });
        else groups.push({ page: sw.page, initial: sw.initial, items: [] });
      } else groups[groups.length - 1].items.push(c);
    }
    // body の余白・枠・背景は、本文全体を包むブロックにする
    const hasBox = !bodyBoxed && (box.padding || box.border || box.backgroundColor || box.margin);
    // 互換モード: html は初期包含ブロック (最初のページの本文領域) を満たし、body は html を満たす (Quirks Mode Standard §3.6・§3.7)
    if (hasBox && groups.length === 1) {
      const minB = this.quirkBodyFill(html, bodyEl, wm, base.width - bm.left - bm.right, base.height - bm.top - bm.bottom);
      if (minB !== undefined && minB > (box.minBlockSize ?? 0)) box.minBlockSize = minB;
    }
    const sequences = groups.map((g, k) => {
      // ページシーケンスの境目の改ページ (左右): 前の最後のブロックの break-after、次の最初のブロックの break-before を、
      // 前のシーケンスのページ数の偶奇に写す (右ページから始める = 前を偶数ページで終える)
      const lastBlock = [...g.items].reverse().find((x): x is LBlock => typeof x !== 'string' && x.type === 'block');
      const next = groups[k + 1]?.items.find((x): x is LBlock => typeof x !== 'string' && x.type === 'block');
      const side = next?.breakBefore === 'odd-page' || next?.breakBefore === 'even-page' ? next.breakBefore : lastBlock?.breakAfter;
      const pads = side === 'odd-page' || side === 'even-page';
      const blankName = pads && this.opts.blankPageName !== 'previous' ? (groups[k + 1]?.page ?? '') : undefined;
      const seq = this.sequence(pages, g.page, k, rootStyle, wm, hasBox ? [{ type: 'block', ...box, children: g.items } as LBlock] : g.items, rootFs, blankName);
      if (g.initial !== undefined) seq.initialPageNumber = g.initial;
      if (side === 'odd-page') seq.forcePageCount = 'end-on-even';
      else if (side === 'even-page') seq.forcePageCount = 'end-on-odd';
      return seq;
    });
    this.report.counts.sequences = sequences.length;
    const title = doc.getElementsByTagName('title')[0]?.textContent?.trim();
    // しおりの並びを、階層の木にする
    const roots: LBookmark[] = [];
    const stack: Array<{ level: number; node: LBookmark }> = [];
    for (const b of this.bookmarks) {
      const node: LBookmark = { title: b.title, ref: b.ref, ...(b.open ? {} : { open: false }) };
      while (stack.length && stack[stack.length - 1].level >= b.level) stack.pop();
      const parent = stack[stack.length - 1]?.node;
      if (parent) (parent.children ??= []).push(node);
      else roots.push(node);
      stack.push({ level: b.level, node });
    }
    return { type: 'document', ...(title ? { title } : {}), ...(roots.length ? { bookmarks: roots } : {}), sequences };
  }
}

/** 論理ツリーの部分木に、ページ番号の引用 (page-number-citation) があるか */
function hasPageCitation(node: unknown): boolean {
  const stack: unknown[] = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const x of n) stack.push(x);
      continue;
    }
    if ((n as { type?: string }).type === 'page-number-citation') return true;
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v);
  }
  return false;
}

/** HTML の文書 (スタイルを確定させたもの) を Kumiori の論理ツリーにする */
export function importHtml(doc: Document, src: StyleSource, opts: HtmlImportOptions = {}): ImportResult {
  // 文書の CSS は 1 度だけ読む (prepareHtml が読んであれば、それを使う)
  const sheet = opts.sheet ?? parseCss(opts.css ?? '', opts.defaultPage ? mediaPageOf(opts.defaultPage) : undefined);
  // target-counter() / target-text() を使う文書は、2 回変換する (1 回目で、参照先の番号・文字を集める)
  let lookup: Map<string, TargetInfo> | undefined;
  if (/target-(counter|text)\(/.test(opts.css ?? '')) {
    const first = new HtmlImporter(src, opts, sheet);
    first.run(doc);
    lookup = first.record;
  }
  const imp = new HtmlImporter(src, opts, sheet, lookup);
  const document = imp.run(doc);
  // 同じ画像は 1 度だけ報告する (XSL-FO の読み込みの報告と同じ。同じ URL を何度も取りに行かせない)
  imp.report.images = [...new Set(imp.report.images)];
  return { document, report: imp.report };
}

/**
 * 枠の内側 (padding の箱・内容の箱) の角丸: 外側の半径から、その角に接する辺の罫線と余白を引く (CSS Backgrounds 3 §5.1。0 未満は 0)。
 * 百分率はそのまま (内側の箱の大きさに対する百分率として使う)
 */
function innerRadius(rad: BorderRadius, border?: BorderInput, padding?: EdgesInput): BorderRadius {
  const w = (s: 'top' | 'right' | 'bottom' | 'left') => ((border as Partial<Record<string, BorderSide>> | undefined)?.[s]?.width ?? 0) + ((padding as Partial<Record<string, number>> | undefined)?.[s] ?? 0);
  const sub = (v: number | `${number}%`, d: number) => (typeof v === 'number' ? Math.max(v - d, 0) : v);
  const corners = rad.corners ?? [[rad.rx, rad.ry], [rad.rx, rad.ry], [rad.rx, rad.ry], [rad.rx, rad.ry]];
  const hs = [w('left'), w('right'), w('right'), w('left')];
  const vs = [w('top'), w('top'), w('bottom'), w('bottom')];
  const out = corners.map(([h, v], k) => [sub(h, hs[k]), sub(v, vs[k])] as [number | `${number}%`, number | `${number}%`]);
  return { rx: 0, ry: 0, corners: out };
}
