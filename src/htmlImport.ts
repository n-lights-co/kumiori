/**
 * htmlImport — HTML+CSS を Kumiori の論理ツリー (LDocument) に変換する。
 *
 * スタイルの確定 (継承・セレクタの優先順位・既定のスタイル・単位の換算) はここでは行わず、
 * 各要素の確定したスタイルを StyleSource から読んで、論理ツリーへ写す (docs/html-css-plan.md)。
 * StyleSource は、既定では自前のカスケード (cssCascade.ts の cascadeStyles)。画面で「CSS の解釈: ブラウザ」を選んだとき (比較用) だけ、
 * ブラウザの getComputedStyle と配置 (rect) を使う (htmlFrame.ts)。値の形はどちらも getComputedStyle と同じ。
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
 * ブラウザが知らない指定 (string-set など) は CSS から自前で読み、セレクタで要素に当てはめる (collectPaged。勝ち負けは通常のカスケード:
 * !important・層 (@layer)・詳細度・書いた順。Cascade 5 §6)。
 */
import { nestLimit, limits, noteLimitReached } from './limits';
import { firstGradient } from './cssGradient';
import { applyTextTransform } from './textTransform';
import type {
  BreakKind,
  LinkTarget,
  BorderInput,
  EdgesInput,
  BackgroundImage,
  LInlineContainer,
  LBookmark,
  FootnoteOptions,
  LFootnote,
  BorderRadius,
  RadiusLength,
  BorderSide,
  ContentSizeKeyword,
  BoxShadow,
  ObjectPosition,
  PaintEffect,
  Outline,
  TransformFunction,
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
  LWarichu,
  RubyAlign,
  LTable,
  LTableCell,
  LTableColumn,
  LFlexItemColumn,
  GridItemFloor,
  LTableRow,
  PageMaster,
  TextDecorationStyle,
  TextStyle,
  HyphenLimits,
  WritingMode,
  PercentLength,
  BoxStyle,
} from './types';
import { TOTAL_PAGES_ID } from './types';
import type { StructNode } from './structure';
import { StructureBuilder, type StructDesc } from './structureBuilder';
import { parseIndividualTransform, parseTransformList, parseTransformOrigin } from './cssTransform';
import type { ImportReport, ImportResult } from './xslfoImport';
import { backgroundPdfSrc, normalizeSrc } from './assets';
import { constrainReplaced } from './geometry';
import { gridTrackPlan, gridTracks } from './gridTracks';
import { setGridItems } from './sourceRef';
import { countDroppedLink, judgeExternalLink, type LinkPolicy } from './linkPolicy';
import { ALL_AH, expand, lengthPx, parseInitialLetter, percentPlusLength, positionXY, splitTextIndent } from './cssCascade';
import { parseVariationSettings } from './fontVariation';
import { inlineSvgDataUri, isInlineSvg } from './htmlSvg';
import { isColorName } from './color';
import type { FkFont, MathFont } from './mathFont';
import { layoutMathML, type MNode } from './mathLayout';
import { CounterStyles } from './counterStyle';
import { COMPLEX_COUNTER, complexCounterSuffix, complexCounterText, predefinedCounterStyles } from './counterStylePredefined';
import { UNIT_PT, cssColor, cssColorAlpha, cssLen, fmtColor, parseColor as parseCssColor, parseRgbFn, rgbHex, splitTop, splitWords } from './cssText';
// url(…) は、閉じない url( を並べた値で 2 乗の手間になる正規表現でなく、同じ結果を線形の手間で返す関数で探す (cssUrlScan.ts)
import { firstCssUrl, wholeCssUrl } from './cssUrlScan';
import { parseTextJustifyTrim } from './textJustifyTrim';
import { dropWarichuBoxes, parseWarichuBrackets } from './warichu';
import { graphemeClusters } from './grapheme';
import { AH_ALIASES, unescapeCss, compatOnlyValue, counterText, isPagedDecl, parseSpacingTrim, SPACING_TRIM_WORD, validPagedValue, mediaPageOf, printColor, type SpotColors, pageNumberFormatOf, parseContent, parseCss, resolvePageRules, parseNthKey, splitDecls, substituteRootVars, unquote, type ContentToken, type PageRule, type PageSelect, type ParsedCss, type StyleRule } from './htmlPaged';
import { documentModeOf, isQuirksDoc, matches, parseSelectorList, type Selector } from './cssSelector';
import { maxOf, pushAll } from './arrayLoop';
import { autospaceNonIdeographic, isAutospaceIdeograph, isLatinAlnum } from './jis';
import { CSS_SPACE, firstLetterOf, splitCommasOutsideParens, trailingResolution, trimAroundNewlines, trimChars } from './linearText';
import { msg } from './messages';
import { MAX_TREE_DEPTH } from './htmlPrepare';
import { blockLevelDisplay, bodyPageSwitchHolder, ownPageName, pageSwitchBox, pageSwitchHolder, rootPageName } from './pageFlow';
import { diag, type DiagnosticSource } from './diagnostics';
import { elementSource, tagNodeSource } from './sourceLocation';

/** ブロック水準の部品か (行内の並びを区切る) */
/**
 * ブロック化した flex の項目の中身の行内の箱から、項目の箱が持つ書式 (罫線・内側の余白・背景・行内の余白・上げ下げ・不透明度・輪郭線) を外す。
 * リンクと字の書式は残す。行内の箱でないもの (画像・inline-block など) はそのまま
 */
function stripInlineFrame(n: LInlineLevel): LInlineLevel {
  if (typeof n === 'string' || n.type !== 'inline') return n;
  const { border: _b, padding: _p, backgroundColor: _bg, inlineMargin: _m, baselineShift: _s, paintEffect: _fx, outline: _o, boxDecorationBreak: _d, ...rest } = n;
  return rest as LInline;
}

/**
 * 画像そのものの flex・grid の項目の画像から、項目の箱 (包むブロック) に移した余白・罫線・内側の余白・背景・影・輪郭線を外す
 * (stripInlineFrame の画像版)。残すと、項目の箱と画像の両方が持ち、画像の位置に余白・罫線・内側の余白が 2 度かかって、
 * 画像が項目の箱の外へはみ出して描かれた (CSS Flexbox 1 §4: 項目は、画像の箱そのもの)
 */
function stripImageFrame(n: LImage): LImage {
  const { margin: _m, border: _b, padding: _p, backgroundColor: _bg, backgroundImage: _bi, boxShadow: _sh, outline: _o, ...rest } = n as LImage & Record<string, unknown>;
  return rest as LImage;
}

/** 流れの中のブロック水準の部品か (絶対配置の箱は流れの外なので、行内の箱を分けない) */
const isInFlowBlock = (n: unknown): boolean => isBlockLevel(n) && !(n as { absolutePosition?: boolean }).absolutePosition;

/** 行内の箱 n の中 (入れ子の行内の箱の中も) に、流れの中のブロック水準の部品があるか */
function hasBlockInside(n: LInline): boolean {
  return n.children.some((k) => isInFlowBlock(k) || (typeof k === 'object' && k.type === 'inline' && hasBlockInside(k)));
}

/** 罫線・内側の余白の、ある辺 (side) を除いた値 (分けた行内の箱の、分けた所の辺。罫線・余白は描かない) */
function withoutSide<T extends object>(v: T | number | undefined, side: 'top' | 'right' | 'bottom' | 'left', isAll: (x: object) => boolean): T | Partial<Record<'top' | 'right' | 'bottom' | 'left', unknown>> | undefined {
  if (v === undefined) return undefined;
  const all = typeof v === 'number' || isAll(v as object);
  const o: Record<string, unknown> = all ? { top: v, right: v, bottom: v, left: v } : { ...(v as object) };
  delete o[side];
  return Object.keys(o).length ? o : undefined;
}

/**
 * ブロックを含む行内の箱 (CSS 2.1 §9.2.1.1): 行内の箱 n の中にブロック水準の箱があれば、行内の箱をブロックの前後で分ける。ブロックの前・後ろの
 * 行内の中身は、それぞれ分けた行内の箱 (n の書式・リンクを写したもの) に入れ、ブロックはその間に、ブロックとして並べる (前後の行内の中身は、
 * 組版がそれぞれ無名のブロックの箱にまとめる)。分けた所の辺には、罫線・内側の余白・行内の余白を付けない (行で分かれた行内の箱と同じ扱い。
 * CSS 2.1 §8.6・CSS Fragmentation 3 §5.4 の slice。box-decoration-break: clone の箱は、分けた所の辺にも付ける)。start・end: 行の進む向きの始まり・終わりの物理の辺。
 * ブロックは、行内の箱の受け継ぐ書式 (字の書式。textStyle は親との差だけを持つ) とリンクを持つ無名のブロックで包み、行内の箱から受け継ぐ書式を
 * 保つ (CSS 2.1 §9.2.1.1: 行内の箱の性質は、中のブロックの箱に受け継がれる)。
 * 中身が空になった分けた箱は置かない。入れ子の行内の箱の中のブロックも、外の箱まで分けて出す。ブロックの無い箱はそのまま返す
 */
/**
 * 並び list に、行内の要素の中から出した float・絶対配置の箱 (floats) を置く: 各箱を、書いた所の目印 (LInline.floatAnchor・staticAnchor。
 * 番号は LFloat.inlineAnchor・LBlockContainer.inlineAnchor) を含む子の後に置く (同じ子の後の箱は、書いた順)。目印が見つからない float は、並びの後に置く。node: 子の行内の節 (ブロックなどは undefined)、
 * wrap: float を並びの子にしたもの
 */
function placeAtAnchors<T, F extends { inlineAnchor?: number }>(list: T[], floats: F[], node: (x: T) => LInlineLevel | LBlockLevel | undefined, wrap: (f: F) => T): T[] {
  const at = new Map<number, number>();
  const visit = (n: LInlineLevel | LBlockLevel | undefined, i: number) => {
    if (!n || typeof n === 'string' || n.type !== 'inline') return;
    if (n.floatAnchor !== undefined) at.set(n.floatAnchor, i);
    // 絶対配置の箱の目印 (LBlockContainer.inlineAnchor。読み込みが付けるのは負の番号)
    if (n.staticAnchor !== undefined && n.staticAnchor < 0) at.set(n.staticAnchor, i);
    for (const k of n.children) visit(k, i);
  };
  list.forEach((x, i) => visit(node(x), i));
  const after = new Map<number, F[]>();
  const rest: F[] = [];
  for (const f of floats) {
    const i = f.inlineAnchor !== undefined ? at.get(f.inlineAnchor) : undefined;
    if (i === undefined) rest.push(f);
    else (after.get(i) ?? after.set(i, []).get(i)!).push(f);
  }
  if (!after.size) return [...list, ...rest.map(wrap)];
  const out: T[] = [];
  list.forEach((x, i) => {
    out.push(x);
    for (const f of after.get(i) ?? []) out.push(wrap(f));
  });
  for (const f of rest) out.push(wrap(f));
  return out;
}

function splitInlineAtBlocks(n: LInlineLevel, start: 'top' | 'right' | 'bottom' | 'left', end: 'top' | 'right' | 'bottom' | 'left'): FlowItem[] {
  if (isInFlowBlock(n)) return [{ v: n, block: true }];
  if (typeof n === 'string' || n.type !== 'inline' || !hasBlockInside(n)) return [{ v: n, block: false }];
  const parts: FlowItem[] = [];
  for (const k of n.children) pushAll(parts, splitInlineAtBlocks(k, start, end));
  const { type: _t, children: _c, id, cbKey: _k, staticAnchor: _a, floatAnchor: _fa, softBreak: _sb, smallCaps: _sc, backgroundColor: _bg, backgroundClip: _bc, emptyStrut: _es, firstLine: _fl, noBreak: _nb, baselineShift: _bs, border: _bo, padding: _pa, boxDecorationBreak: _d, borderRadius: _r, outline: _o, inlineMargin: _m, width: _w, link, annotation: _an, paintEffect: _fx, writingMode: _wm, ...text } = n;
  const isSide = (x: object) => 'width' in x;
  const out: FlowItem[] = [];
  let idUsed = !id;
  for (let i = 0; i < parts.length; ) {
    if (parts[i].block) {
      const b = parts[i++].v as LBlockLevel;
      const own = !idUsed ? { id } : {};
      idUsed = true;
      const wrap = Object.keys(text).length || link || own.id;
      out.push({ v: wrap ? ({ type: 'block', ...text, ...own, ...(link ? { link } : {}), children: [b] } as LBlock) : b, block: true });
      continue;
    }
    const kids: LInlineLevel[] = [];
    const afterBlock = i > 0;
    for (; i < parts.length && !parts[i].block; i++) kids.push(parts[i].v as LInlineLevel);
    const beforeBlock = i < parts.length;
    if (!kids.length) continue;
    const frag: LInline = { ...n, children: kids };
    delete frag.emptyStrut;
    if (idUsed) delete frag.id;
    idUsed = true;
    // 分けた所の辺 (前にブロックがあれば始まりの辺、後ろにあれば終わりの辺) の罫線・内側の余白・行内の余白を外す
    for (const [cut, side, key] of [
      [afterBlock, start, 'start'],
      [beforeBlock, end, 'end'],
    ] as const) {
      if (!cut || frag.boxDecorationBreak === 'clone') continue;
      if (frag.border) frag.border = withoutSide(frag.border, side, isSide) as LInline['border'];
      if (frag.padding !== undefined) frag.padding = withoutSide(frag.padding as object | number, side, () => false) as LInline['padding'];
      if (frag.inlineMargin) frag.inlineMargin = { ...frag.inlineMargin, [key]: 0 };
      if (frag.border === undefined) delete frag.border;
      if (frag.padding === undefined) delete frag.padding;
    }
    out.push({ v: frag, block: false });
  }
  return out;
}

/** 和欧間アキの見積もりに使う、字の側の書式 (htmlImport の textWidth)。ch: 字 (空白なら隣とは空けない)・fs: 字の大きさ・on: text-autospace が有効か・width: アキの比 */
type AutospaceSide = { ch: string; fs: number; on: boolean; width: number };

/**
 * 隣り合う 2 字の間に和欧間アキを入れるか (CSS Text 4 §8.4.1: 和字と、non-ideographic letters・numerals の間。inlineLayout.ts の
 * adjustJapaneseSpacing と同じ判定)。unicode: §8.4.1 の定義どおり (一般カテゴリ L・M・Nd の字。jis.ts の autospaceNonIdeographic)。
 * false (互換の指定。HtmlImportOptions.autospaceLatinOnly) はラテン文字・数字だけ (欧文の書体で組むギリシャ文字・キリル文字の語
 * (Atom.latinWord) は、ここでは数えない)
 */
const COMBINING_MARK = /^\p{M}$/u;
const autospacePair = (a: string, b: string, unicode: boolean): boolean => {
  const other = unicode ? (c: string) => autospaceNonIdeographic(c) !== undefined : isLatinAlnum;
  return (isAutospaceIdeograph(a) && other(b)) || (other(a) && isAutospaceIdeograph(b));
};

const isBlockLevel = (n: unknown): boolean =>
  typeof n === 'object' && n !== null && /^(block|block-container|table)$/.test((n as { type: string }).type);

/** 疑似要素 */
export type PseudoSel = '::before' | '::after' | '::first-letter' | '::first-line' | '::marker';

/** ルビの性質の値 (CSS Ruby 1 §4.1〜§4.3・§5.1 の構文)。ほかの値 (initial・revert など) は、指定が無いものとして扱う */
/**
 * タグ付き PDF: 要素の名前 → PDF の標準の構造の型 (ISO 32000-1 §14.8.4。HTML の要素の意味は HTML Living Standard の各要素の節、
 * 当て方は HTML-AAM の役の対応にならう)。'Artifact' は飾り (§14.8.2.2)。ここに無い要素は、構造を作らない (中身は親の構造に入る)。
 * 表の要素 (table・caption・thead・tbody・tfoot・tr・th・td) は、表の構造 (§14.8.4.3.4) にする。構造の型は要素 (と role) で決め、
 * CSS の display では決めない (HTML-AAM: 要素の役は要素の意味から決まる)。display: table・grid で並べた div は Div のまま (表の意味を持たない)、
 * display を変えた table は表のまま
 */
const STRUCT_ROLES: Record<string, string> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
  h5: 'H5',
  h6: 'H6',
  p: 'P',
  address: 'P',
  pre: 'P',
  dt: 'P',
  div: 'Div',
  main: 'Div',
  nav: 'Div',
  aside: 'Div',
  header: 'Div',
  footer: 'Div',
  dl: 'Div',
  dd: 'Div',
  figure: 'Div',
  section: 'Sect',
  article: 'Art',
  blockquote: 'BlockQuote',
  figcaption: 'Caption',
  ul: 'L',
  ol: 'L',
  li: 'LI',
  svg: 'Figure',
  math: 'Formula',
  q: 'Quote',
  code: 'Code',
  hr: 'Artifact',
  table: 'Table',
  caption: 'Caption',
  thead: 'THead',
  tbody: 'TBody',
  tfoot: 'TFoot',
  tr: 'TR',
  th: 'TH',
  td: 'TD',
};

/** 割注にしない要素 (置換要素・ルビ・改行・フォームの部品など。htmlImport の isWarichuElement) */
const NOT_WARICHU_ELEMENTS = new Set(['img', 'svg', 'math', 'ruby', 'rt', 'rp', 'rb', 'rtc', 'br', 'wbr', 'input', 'select', 'textarea', 'button', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed', 'picture']);

/** 表の部分の要素 (表が role="presentation"・"none" なら、構造を作らない。WAI-ARIA 1.2 §5.3.4 の役を受け継ぐ子) */
const TABLE_PART_ELEMENTS = new Set(['caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col']);

/** WAI-ARIA 1.2 の役 (role) → 構造の型。ここに無い役は読まない (要素の既定の型のまま) */
const ARIA_STRUCT_ROLES: Record<string, string> = {
  img: 'Figure',
  figure: 'Div',
  list: 'L',
  listitem: 'LI',
  link: 'Link',
  paragraph: 'P',
  blockquote: 'BlockQuote',
  math: 'Formula',
  article: 'Art',
  region: 'Sect',
  code: 'Code',
  table: 'Table',
  grid: 'Table',
  treegrid: 'Table',
  rowgroup: 'TBody',
  row: 'TR',
  cell: 'TD',
  gridcell: 'TD',
  columnheader: 'TH',
  rowheader: 'TH',
  // DPUB-ARIA 1.1 §4: 脚注と、脚注への参照 (doc-endnote は 1.1 で非推奨だが、同じ意味で読む)
  'doc-footnote': 'Note',
  'doc-endnote': 'Note',
  'doc-noteref': 'Reference',
};

const RUBY_VALUES = {
  'ruby-position': /^(alternate|over|under|alternate (over|under)|(over|under) alternate|inter-character)$/,
  'ruby-align': /^(start|center|space-between|space-around)$/,
  'ruby-merge': /^(separate|merge|auto)$/,
  'ruby-overhang': /^(auto|none)$/,
};

/** 確定したスタイルの読み取り (既定は自前のカスケード cascadeStyles。ブラウザ経由では getComputedStyle。テストでは差し替える) */
export interface StyleSource {
  /** 要素 (と ::before / ::after) の確定したスタイル */
  style(el: Element, pseudo?: PseudoSel): { getPropertyValue(name: string): string };
  /** 疑似要素に当たる規則があるか (::first-letter・::first-line を作るか決める)。分からなければ undefined */
  hasPseudo?(el: Element, pseudo: PseudoSel): boolean;
  /** 指定が auto か (幅・高さ。ブラウザの確定値は auto でも寸法になるので、別に確かめる)。分からなければ undefined */
  isAuto?(el: Element, prop: 'width' | 'height' | 'top' | 'right' | 'bottom' | 'left'): boolean | undefined;
  /**
   * 指定が百分率 (calc() の中の百分率も) か (幅・高さとその上限・下限)。百分率は、包含ブロックの大きさの見積もりから長さにしてある
   * (中身の幅を測るときは auto として扱う。CSS Sizing 3 §5.2.1)。分からなければ undefined
   */
  isPercent?(el: Element, prop: 'width' | 'height' | 'min-width' | 'max-width'): boolean | undefined;
  /**
   * 百分率 (と、百分率を含む calc() の線形の和) で指定した width・min-width・max-width・margin-*・padding-*・text-indent の、
   * 割合 (f: 基準 1px あたりの px) と長さの部分 (px)。組むときに、実際の包含ブロックの幅で解き直す (BoxStyle.percent)。
   * 百分率でなければ (分からなければ) undefined
   */
  percentOf?(el: Element, prop: string): { f: number; px: number } | undefined;
  /**
   * 大きさの性質 (width・height と、その上限・下限) の、勝った宣言の出どころ: 既定のスタイル (ua)・HTML の属性による指定 (hint。
   * HTML §15.4.3 の寸法の属性)・作成者のスタイルシートか style 属性 (author)。宣言が無ければ (分からなければ) undefined
   */
  sizeOrigin?(el: Element, prop: string): 'ua' | 'hint' | 'author' | undefined;
  /** セレクタに合う要素 (既定は document.querySelectorAll。テストでは差し替える) */
  select?(selector: string): Element[];
  /** ブラウザが置いた要素の位置と大きさ (px、border-box)。flex・grid の配置に使う */
  rect?(el: Element): { x: number; y: number; width: number; height: number } | undefined;
  /** 要素の内容の幅 (px) の見積もり。ブラウザの配置 (rect) が無いとき、flex・grid の項目の幅を決める基準 */
  contentWidth?(el: Element): number | undefined;
  /**
   * 文書の中にじかに書いた <svg> の要素 (SVG の名前空間の要素) に、文書の CSS が決めた SVG の表示の性質 ([性質, 値] の並び。
   * fill・stroke・color など)。isRoot は、その <svg> の根元の要素か (根元には、外の要素から継承した値も入れる)。
   * 無ければ、<svg> を書かれたとおりの単独の SVG として扱う
   */
  svgStyle?(el: Element, isRoot: boolean): Array<[string, string]>;
}

export interface HtmlImportOptions {
  /**
   * 背景の画像の、PDF のページの範囲 (アンテナハウスの拡張) を、範囲の最初のページにする (--style ah。assets.ts の backgroundPdfSrc)
   */
  pdfRangeFirstPage?: boolean;
  /** 入力のファイルの名前 (診断の場所 source.file。文書が読んだ字とファイルの名前を持つとき (setDocumentSource) は、そちら) */
  sourceName?: string;
  /**
   * タグ付き PDF の構造の木を作る (LDocument.structure と、入力の節の tag。structure.ts)。要素を PDF の標準の構造の型 (ISO 32000-1 §14.8.4) に
   * 当て、柱 (余白の箱・running()・position: fixed) を飾り (Artifact) にする。既定 false (構造の木を作らない)
   */
  tagged?: boolean;
  /**
   * 文書の外への飛び先のうち、通すもの (linkPolicy.ts)。既定では、http・https・mailto・tel の URL と相対の PDF だけをリンクにする。
   * 通さない飛び先はリンクにせず (字はそのまま組む)、report.droppedLinks に数える
   */
  links?: LinkPolicy;
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
  /**
   * @page・余白の箱の罫線の太さの thin・medium・thick (pt)。文書の要素の罫線と同じ値にする (既定のスタイルの 1px・3px・5px。
   * アンテナハウス互換では 1pt・3pt・5pt。cssCascade の borderKeywords)。指定が無ければ 0.75pt・2.25pt・3.75pt
   */
  pageBorderKeywords?: { thin: number; medium: number; thick: number };
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
  /** 1 行の文字列の幅 (pt)。kerning なら、行を組むときと同じカーニングを足す (features は、カーニングを引く前に当てる OpenType の機能) */
  measureText?: (text: string, style: { fontFamily?: string; fontWeight: number; fontSize: number; kerning?: boolean; features?: string[] }) => number;
  /** 読み込んだ画像の本来の大きさ (CSS px)。ブラウザの配置 (rect) が無いとき、画像の大きさを max-width などの上限から決めるのに使う */
  imageSize?: (src: string) => { width: number; height: number } | undefined;
  /** 欧文の語間を、行に収めるために本来の幅より詰めてよいか。既定 false (ブラウザ・CSS と同じ。アンテナハウス互換でも詰めない) */
  wordSpaceShrink?: boolean;
  /** 和欧間のアキ (text-autospace) の大きさ (字の大きさに対する比)。既定 0.125 (CSS Text 4 の 1/8ic)。アンテナハウス互換では 0.25 */
  autospaceWidth?: number;
  /**
   * line-height: normal の行送りの比 (font-family の並びと太さから)。分からなければ undefined (1.2 にする)。
   * opts.defaultFonts は normalLineHeightAllFonts のときに付ける (既定の書体も書体の値にする。fontMapping.ts の htmlNormalLineHeight)
   */
  normalLineHeight?: (families: string[], bold: boolean, opts?: { defaultFonts?: boolean }) => number | undefined;
  /**
   * line-height: normal を、既定の書体 (読み込んでいない書体: Noto Serif JP・Tinos・Cousine など) でも、書体の値
   * (hhea の ascent + descent + lineGap) で決め、代わりの書体として使われた既定の書体の上下も行の高さに数える
   * (CSS Inline 3 §5.3・§6.4、CSS 2.1 §10.8.1。Chromium と同じ)。ブラウザの既定のスタイル (--style browser・browser-margin。compat.ts の
   * BROWSER_HTML_IMPORT_OPTIONS)。無ければ、読み込んだ書体 (@font-face・fonts の選択肢) だけ書体の値で、既定の書体は字の大きさの 1.2 倍
   */
  normalLineHeightAllFonts?: boolean;
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
   * ページの左右 (@page の :left・:right、break-before の left・right・recto・verso の白ページ、余白の箱の左右) を、ページ番号の偶奇で決め、
   * ページ番号を振り直すページの組 (counter-reset・counter-set の page) の前で、前の組の最後のページ番号の偶奇を、振り直した番号に続くように
   * 合わせる白ページを足す (XSL 1.1 §6.4.11 の odd-or-even・§7.27.6 の force-page-count="auto" と同じ。互換のスタイル ah・weasyprint・vivliostyle の、
   * これまでの動き)。
   * 既定では、左右を、文書の最初からのページの順 (何枚目か。白ページも数える) で決め (LDocument.pageSidesByOrder)、振り直しの白ページを足さない:
   * CSS では、左右のページは交互に来て、最初のページの左右はページの進む向きで決まり (CSS Paged Media 3 §3.3・§4.2.1)、page のカウンターは
   * 番号の表示のためのもので、左右とは別 (§6.1)。白ページを作るのは、左右の強制の区切り break-before: left・right・recto・verso だけ
   * (CSS Fragmentation 3 §3.1)
   */
  pageSidesByNumber?: boolean;
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
  /**
   * アンテナハウス互換: break-inside: avoid の表の行・リストの項目が、新しいページにも入らない高さでも分けず、はみ出させる (これまでの組み方)。
   * 無ければ、CSS Fragmentation 3 §4.4 のとおり、入らないときは avoid を緩めて行の中で分ける (LTableRow.keepTogetherYields)
   */
  avoidRowOverflowAh?: boolean;
  /** アンテナハウス互換: lang が日本語・中国語・韓国語の行は、和文の字の書体の上下で行の基準線を決める (TextStyle.primaryFontByLang) */
  primaryFontByLangAh?: boolean;
  /**
   * アンテナハウス互換: 横書きの行の中の基線を、書体の上の高さ・下の深さ (CSS Inline 3 §5.3。既定) でなく、字の枠 (em の箱) の位置に置く
   * (LoadedFont.baselineRatio: OS/2 の typo の上下が 1em を成す和文の書体はその値、ほかは上から 0.88em)。行の高さも、字の大きさの箱と
   * line-height から決め、別の書体の inline があっても行を高くしない (TextStyle.fontBaseline を付けない)。
   * 根拠: アンテナハウスの公開の見本 (『CSS ページ組版入門』の PDF。本文は源ノ明朝: typo 0.88・−0.12、hhea 1.151・−0.286) と、同じ書体で
   * 組み比べると、字の枠の位置に置いたときは 6110 行のうち 1520 行の基線が 0.1pt 以内で合い、書体の ascent・descent で置くと 39 行に減る
   * (本文の 11pt の行で 0.58pt = 0.0525em 下がる)
   */
  emBoxBaselineAh?: boolean;
  /**
   * vertical-align: super の上げ幅を、親の字の大きさの 1/3 にする (アンテナハウス互換。既定は 0.35)。
   * 上付き (sup・::footnote-call) は、本文の字の大きさによらず親の字の大きさの 1/3 上げる
   */
  superShiftAh?: boolean;
  /**
   * text-align の inside・outside を読む (アンテナハウス互換。アンテナハウスの拡張の値で、CSS Text 3 §6.1 の text-align には無い。
   * 既定は、無効の値として捨てる)。inside はページのノドの側、outside は小口の側にそろえる (XSL 1.1 §7.16.9 の inside・outside と同じ。
   * 左右のページは @page :left・:right と同じ判定: 横書きは、奇数ページが右ページでノドは左)。
   * 接頭辞の付いた -ah-text-align に書いた inside・outside は、この設定によらず読む
   */
  textAlignInsideOutsideAh?: boolean;
  /**
   * line-break: auto の改行の決まりを、アンテナハウスに合わせる (TextStyle.lineBreakAutoAh。auto の決まりは UA が決めてよい。CSS Text 3 §5.2)。
   * 小書きの仮名・長音記号・繰返し記号の前でも改行する
   */
  lineBreakAutoAh?: boolean;
  /**
   * 行内の箱の始まりの側の margin (横書きの margin-left) が、折り返した行の先頭に来たとき、その空きを捨てる (アンテナハウス互換)。
   * CSS では、分けていない箱の端の margin は行頭でも効く (CSS 2.1 §9.4.2。ブラウザも同じ)。アンテナハウスの出力では、行頭に来た
   * margin-left の空きが出ない (『CSS ページ組版入門』第 4 版の 42 ページ: div.Properties span.Property { margin-left: 1em } の
   * 「●値の継承」が、折り返した行の左端から始まる。XSL の space-start の条件付きの空き (XSL 1.1 §4.3.1) と同じ扱いに見える)
   */
  inlineMarginStartAtWrapAh?: boolean;
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
   * 和欧間アキの相手を、ラテン文字・数字 (0〜9) と、欧文の書体で組むギリシャ文字・キリル文字の語だけにする (互換の指定のときの、これまでの範囲)。
   * 既定 (false) は、CSS Text 4 §8.4.1 の定義どおり、一般カテゴリ L・M・Nd の字すべて (TextStyle.textAutospaceUnicode)
   */
  autospaceLatinOnly?: boolean;
  /**
   * WeasyPrint の組み方 (--style weasyprint): 中身の無い目印 (<span id="…"></span> など) だけの行を、マージンの相殺を断つものとして扱う
   * (見出しの前に目印を置く Sphinx の HTML で、前の段落の下と見出しの上のマージンを足す)。
   * 無ければ、CSS 2.1 §9.4.2 のとおり、その行は無いものとして相殺する (Chromium と同じ)
   */
  idLinesSeparateMarginsWp?: boolean;
  /** WeasyPrint の組み方: 見つからないページ番号の参照 (target-counter()) を空にする。無ければ「?」(どちらも警告は出す) */
  unresolvedCitationEmptyWp?: boolean;
  /**
   * WeasyPrint の組み方: 高さの決まった折り返しの flex の容器 (flex-wrap: wrap) の行が 1 つなら、align-content に関わらず、行を容器の高さにする
   * (中の項目は容器の高さに伸び、中の百分率の高さ・ずらしが効く。Sphinx の印刷用の CSS の表紙)。
   * 無ければ、Flexbox 1 §9.4 の 15 のとおり、1 行の容器 (nowrap) と、align-content が normal・stretch のときだけ
   */
  flexSingleLineFullWp?: boolean;
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
  /**
   * 接頭辞の無い名前 (標準のプロパティ) に書いた、アンテナハウスの拡張の値を読む (アンテナハウス互換)。既定は、無効の値として捨てて
   * 報告する (標準の名前の意味を変えるため。CSS 2.1 §4.2: 読めない値の宣言は無視する):
   *  - float の top・bottom・start・end・inside・outside・center・alternate・multicol・sidenote など (CSS の float の値は left・right・none・
   *    inline-start・inline-end と GCPM の footnote)、width の <数>gr、色の cmyk()・rgb-icc() (CSS の関数は device-cmyk())。
   *    一覧は htmlPaged の compatOnlyValue。接頭辞の付いた名前 (-ah-float・-ah-text-align) に書いた値は、この設定によらず読む
   *  - css の文字列をここで読むとき (sheet を渡さないとき) の @supports に、これらの値と、線種 dot-dash など・counter() の physical・reverse を
   *    対応していると答える (その値を受け付けるのは、互換の指定のときだけ。Conditional 3 §6.1)。sheet を渡すときは、sheet を読んだ側
   *    (prepareHtml) の読み方に従う
   */
  ahCssExtensions?: boolean;
  /**
   * position: running() の要素の書体 (font-family) を、要素に指定が無ければ、その要素を出す余白の箱 (content: element(…)) から受け継ぐ
   * (アンテナハウス互換。その余白の箱の font-family、無ければページ文脈 (@page) の font-family)。既定は、文書の中の元の場所から受け継ぐ
   * (CSS GCPM 3 §1.2.1: その要素は、文書の中の元の場所から受け継ぐ)。
   * 余白の箱の指定が箱ごとに違う・無いときは、既定と同じ
   */
  runningFontFromPageContextAh?: boolean;
  /** 幅が auto の表の列が入りきらないときの列の幅の配り方を互換の規則にする (アンテナハウス互換。LTable.fitContentRule の 'max-ratio') */
  tableAutoWidthAh?: boolean;
  /** 表の上の見出しと表ヘッダーを、本体の最初の行と同じページに置く (アンテナハウス互換。LTable.keepHeaderWithBodyAh) */
  tableHeaderWithBodyAh?: boolean;
}

/** target-counter() / target-text() のための、id を持つ要素の情報 (1 回目の変換で集める) */
interface TargetInfo {
  counters: Record<string, number>;
  /** 入れ子のカウンターの値の並び (外から内へ。target-counters() に使う。CSS Content 3 §2.6.2) */
  stacks: Record<string, number[]>;
  text: string;
  before: string;
  after: string;
}

const PT_PER_PX = 0.75;
const MM_PER_PT = 25.4 / 72;

/** CSS の長さ (px・pt・mm・cm・in・pc・q) → pt。単位の無い 0 も可 */
/**
 * 計算値の background-position-x・-y (最初の層) を背景画像の位置にする。
 * "right 10px"・"bottom 10px" は右・下の端からの距離 (Backgrounds 3 §2.6)
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

/**
 * object-position の計算値 (横と縦。長さ・百分率・calc(100% - 長さ) = 右・下の端からの距離) を、枠の中での画像の位置にする。
 * 初期値 (50% 50%) と、読めない値は undefined (中央)
 */
function objectPositionOf(v: string): ObjectPosition | undefined {
  const ts = splitTop(v.trim(), ' ').filter(Boolean);
  if (ts.length !== 2) return undefined;
  const one = (t: string): { v: number | `${number}%`; end?: boolean; off?: number } | undefined => {
    if (/^-?[\d.]+%$/.test(t)) return { v: t as `${number}%` };
    const far = /^calc\(\s*100%\s*-\s*(.+?)\s*\)$/i.exec(t);
    const n = cssLen(far ? far[1] : t);
    if (n !== undefined) return { v: n, ...(far ? { end: true } : {}) };
    // 百分率と長さの和の一般の形 (calc(50% + 10px) など。CSS Values 4 §10.11): 百分率の位置に長さを足す
    const pl = /%/.test(t) ? percentPlusLength(t) : undefined;
    return pl ? { v: `${pl.pct}%`, ...(pl.px ? { off: pl.px * PT_PER_PX } : {}) } : undefined;
  };
  const x = one(ts[0]);
  const y = one(ts[1]);
  if (!x || !y || (x.v === '50%' && y.v === '50%' && !x.off && !y.off)) return undefined;
  return { x: x.v, y: y.v, ...(x.end ? { xFromEnd: true } : {}), ...(y.end ? { yFromEnd: true } : {}), ...(x.off ? { xOffset: x.off } : {}), ...(y.off ? { yOffset: y.off } : {}) };
}

/**
 * 罫線の色の計算値 → 罫線の色。透明 (alpha が 0) は 'transparent' (太さは取り、描かない)、半透明は #rrggbbaa (描くときに、その濃さで
 * 下の背景に重ねる。CSS Backgrounds 3 §2.7: 背景は罫線の下まで描くので、半透明の罫線の下に背景が見える)。読めない色は黒
 */
/**
 * 輪郭線 (outline。CSS UI 4 §3) を、計算値から読む。線種が none か、太さが 0 なら undefined。
 *  - 線種 (§3.3): auto は実線として描く (処理系は auto を実線として扱ってよい)。hidden は無い
 *  - 色 (§3.4): auto は、線種が auto でなければ currentColor (線種 auto は実線として描くので、同じく currentColor にする)
 *  - outline-offset (§3.5): 罫線の箱の端からの距離 (負の値は内側)
 */
function outlineOf(c: (p: string) => string): Outline | undefined {
  const style = c('outline-style').trim().toLowerCase();
  const w = cssLen(c('outline-width')) ?? 0;
  if (!style || style === 'none' || w <= 0) return undefined;
  const cv = c('outline-color').trim().toLowerCase();
  const color = borderColorOf(cv === 'auto' || cv === 'currentcolor' || !cv ? c('color') : cv);
  if (color === 'transparent') return undefined;
  const off = cssLen(c('outline-offset')) ?? 0;
  return { width: w, color, ...(style !== 'solid' && style !== 'auto' ? { style: style as Outline['style'] } : {}), ...(off ? { offset: off } : {}) };
}

/**
 * 字の色の計算値 → 字の色。透明 (transparent・alpha が 0 の色) は 'transparent' (字は場所を取り、塗らない。visibility: hidden の字と同じ受け皿)、
 * 半透明は #rrggbbaa。CSS Color 4 §4.1・§6.3: transparent は alpha が 0 の色で、color の値にもなる (前は色が無いものとして親の色を受け継いでいた)。
 * 透明度は 8 ビット (#rrggbbaa の aa) で運ぶので、8 ビットで 0 になる alpha (rgba(…, 0.001) など。描いても見えない) も透明と同じに扱う
 * (PDF と画面で同じに、字を描かない。白い紙に重ねて白で描くと、色の付いた地の上で見えてしまう)。読めない色は undefined (親の色のまま)
 */
function textColorOf(v: string): string | undefined {
  const rgba = parseRgbFn(v.trim());
  if ((rgba && Math.round(rgba.a * 255) <= 0) || v.trim().toLowerCase() === 'transparent') return 'transparent';
  return cssColorAlpha(v);
}

/**
 * 字の飾り (下線・圏点)・ルビ・ページの余白の箱の字の色の計算値 → 色 (cssColorAlpha と同じ。半透明は #rrggbbaa)。
 * 8 ビットで 0 になる alpha の色は、alpha が 0 の色と同じに、色が無いもの (undefined) にする (textColorOf と同じ境目)
 */
function visibleColorOf(v: string): string | undefined {
  const col = cssColorAlpha(v);
  return col && /^#[0-9a-f]{6}00$/.test(col) ? undefined : col;
}

function borderColorOf(v: string): string {
  const rgba = parseRgbFn(v.trim());
  if ((rgba && rgba.a <= 0) || v.trim().toLowerCase() === 'transparent') return 'transparent';
  return cssColorAlpha(v) ?? '#000000';
}

/**
 * 背景の層 (CSS Backgrounds 3 §2.1): 層の数は background-image のコンマ区切りの値の数 (none も 1 層)。ほかの性質の値は、前から順に対にし、
 * 足りなければ値の並びを繰り返して使う。余った値は使わない
 */
function backgroundLayers(c: (p: string) => string): Array<{ image: string; repeat: string; x: string; y: string; size: string; origin: string; clip: string; attachment: string }> {
  const list = (p: string, initial: string) => {
    const v = splitTop(c(p), ',').map((t) => t.trim());
    return v.length && v[0] ? v : [initial];
  };
  const images = list('background-image', 'none');
  const repeat = list('background-repeat', 'repeat');
  const x = list('background-position-x', '0%');
  const y = list('background-position-y', '0%');
  const size = list('background-size', 'auto');
  const origin = list('background-origin', 'padding-box');
  const clip = list('background-clip', 'border-box');
  const attachment = list('background-attachment', 'scroll');
  const at = (a: string[], k: number) => a[k % a.length];
  return images.map((image, k) => ({ image, repeat: at(repeat, k), x: at(x, k), y: at(y, k), size: at(size, k), origin: at(origin, k).toLowerCase(), clip: at(clip, k).toLowerCase(), attachment: at(attachment, k).toLowerCase() }));
}

function setBackgroundPosition(img: BackgroundImage, px: string, py: string) {
  const one = (v: string, far: string): [number | `${number}%` | undefined, boolean, number?] => {
    const t = splitTop(v, ',')[0].trim();
    if (/%$/.test(t)) return [t as `${number}%`, false];
    const m = new RegExp(`^${far}\\s+(.+)$`).exec(t);
    const d = m ? m[1] : t;
    // 百分率と長さの和 (calc(50% + 10px)。CSS Values 4 §10.11): 百分率の位置に長さを足す。右・下の端からなら、100% から引く
    const pl = /%/.test(d) ? percentPlusLength(d) : undefined;
    if (pl) return m ? [`${100 - pl.pct}%`, false, -pl.px * PT_PER_PX] : [`${pl.pct}%`, false, pl.px * PT_PER_PX];
    return m ? [cssLen(d), true] : [cssLen(d), false];
  };
  if (px) {
    const [v, end, off] = one(px, 'right');
    img.x = v;
    if (end) img.xFromEnd = true;
    if (off) img.xOffset = off;
  }
  if (py) {
    const [v, end, off] = one(py, 'bottom');
    img.y = v;
    if (end) img.yFromEnd = true;
    if (off) img.yOffset = off;
  }
}

const HYPHEN_LIMIT_PROPS = ['hyphenate-character', 'hyphenate-limit-chars', 'hyphenate-limit-lines', 'hyphenate-limit-last', 'hyphenate-limit-zone'] as const;

/**
 * 分綴の制限の計算値 (CSS Text 4 §6.3.2〜§6.3.5) を、組版の受け皿 (HyphenLimits) にする。
 *  - hyphenate-character: auto は既定の字 (指定なし)。文字列はそのまま (空の文字列も有効: 何も出さずに分ける)
 *  - hyphenate-limit-chars: 語・切れ目の前・後の最小の字数。3 つ目を省くと 2 つ目と同じ、2 つ目を省くと auto。auto は指定なし
 *  - hyphenate-limit-lines: no-limit は指定なし
 *  - hyphenate-limit-last: always だけ (段落の最後の行の 1 つ前の行)。column・page・spread は読まない (未対応の値として報告する。cssUnsupported)
 *  - hyphenate-limit-zone: 長さ、または行の長さに対する百分率
 */
function hyphenLimitsOf(c: (name: string) => string): HyphenLimits {
  const o: HyphenLimits = {};
  const ch = (c('hyphenate-character') ?? '').trim();
  if (/^["']/.test(ch)) o.character = unquote(ch);
  const cs = (c('hyphenate-limit-chars') ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const num = (t: string | undefined) => (t !== undefined && /^\+?\d+$/.test(t) ? parseInt(t, 10) : undefined);
  const word = num(cs[0]);
  const before = num(cs[1]);
  const after = cs.length >= 3 ? num(cs[2]) : before;
  if (word !== undefined) o.minWord = word;
  if (before !== undefined) o.minBefore = before;
  if (after !== undefined) o.minAfter = after;
  const lines = num((c('hyphenate-limit-lines') ?? '').trim());
  if (lines !== undefined) o.maxLines = lines;
  if ((c('hyphenate-limit-last') ?? '').trim().toLowerCase() === 'always') o.noLast = true;
  const zone = (c('hyphenate-limit-zone') ?? '').trim();
  if (/%$/.test(zone)) {
    const r = parseFloat(zone) / 100;
    if (r > 0) o.zoneRatio = r;
  } else {
    const z = cssLen(zone);
    if (z !== undefined && z > 0) o.zone = z;
  }
  return o;
}

/**
 * letter-spacing・word-spacing の計算値 → pt (normal は 0)。百分率 (と、百分率と長さの和) は、その要素の字の大きさに対する割合
 * (CSS Text 4 §8.1・§8.2: 使われる字の大きさに対する割合。計算値は百分率のまま受け継ぐので、受け継いだ要素の字の大きさで解く)
 */
function spacingPt(c: (p: string) => string, prop: 'letter-spacing' | 'word-spacing'): number {
  const v = c(prop);
  if (!/%/.test(v)) return cssLen(v) ?? 0;
  const pl = percentPlusLength(v);
  return pl ? ((cssLen(c('font-size')) ?? 12) * pl.pct) / 100 + pl.px * PT_PER_PX : 0;
}

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
/**
 * 文字列の最初の書記素クラスタ (UAX #29。圏点の文字列に使う)。先頭の 64 単位だけを見る (長い文字列をまるごと分けない。
 * 実在の絵文字の並びは 64 単位に収まる。それより長いクラスタは、そこで切る)
 */
function firstGrapheme(s: string): string {
  // 切った端に残る、対の片方だけの代用符号は捨てる
  return graphemeClusters(s.slice(0, 64).replace(/[\uD800-\uDBFF]$/, ''))[0] ?? '';
}

/** col の span・colspan の上限 (呼び出しの上限 limits.tableColumns。既定 1,000。HTML の仕様の colspan・span の上限も 1,000) */
const colSpanMax = () => limits().tableColumns;
/**
 * col の span・colspan を上限で抑える。上限を HTML の仕様の上限 (1,000。HTML Living Standard §4.9.11・§4.9.3 の span・colspan は 1,000 まで) より
 * 下げたときに切ったら、上限に当たったことを知らせる (仕様の上限で抑えるのは、仕様どおりの動きなので知らせない)
 */
function capSpan(n: number): number {
  const max = colSpanMax();
  if (n > max && max < MAX_TABLE_COLUMNS) noteLimitReached('tableColumns');
  return Math.min(max, n);
}
/**
 * 1 つの表の列 (<col>・display: table-column の span の合計) の上限。XSL-FO の読み込みの列の数の上限 (xslfoImport.ts の MAX_TABLE_COLUMNS) と同じ。
 * 1 つの <col> の span は MAX_COL_SPAN までだが、<col span="1000"> を千個並べると百万の列になり、組むのに数秒・数 GB かかった
 */
/** 表の列の数の上限の既定 (呼び出しの上限 limits.tableColumns で動く) */
export const MAX_TABLE_COLUMNS = 1000;
const MAX_ROW_SPAN = 65534;

/**
 * 生成内容 (content の文字列・attr()・counters()・target-text() など) で作る字の数の、文書全体の予算 (UTF-16 の単位)。
 * 生成内容は、短い宣言を多くの要素に当てたり (p::before に 100KB の文字列 × p 100 個で 1000 万字)、1 つの値に attr() を並べたり
 * (attr(title) × 2000 で、title 2000 字の要素 1 つから 400 万字) して、入力の大きさを大きく超える字を作れ、メモリを使い切った。
 * 定数の分 (20 万字。四六判の本の 200 ページほど) に、文書の字の数の 2 倍 (目次の target-text()・柱の string-set のように、
 * 本文の字を写す生成内容は、本文の字の数に比例する) と、要素 1 つあたり GENERATED_TEXT_PER_ELEMENT 字 (::before の「第」「章」・
 * 番号のように、要素ごとに足す生成内容は、要素の数に比例する) を足す。CSS Content 3 には上限の定めが無いが、Counter Styles 3 §2 の、
 * 表記の長さの上限 (MAX_COUNTER_LENGTH) と同じ考え方で、実在の文書が届かない値にする。超えた分の字は出さない (報告に出す)
 */
const GENERATED_TEXT_BASE = 200_000;
const GENERATED_TEXT_PER_ELEMENT = 32;

/**
 * 名前の引数が要る関数 (attr()・counter()・counters()・target-counter()・target-text()) に、引数が無いもの。
 * どれも文法で最初の引数が要る (attr( <attr-name> … ) は CSS Values 5 §7.7、counter( <counter-name> … )・counters() は
 * CSS Lists 3 §4.6、target-counter()・target-text() は CSS GCPM 3 §4.1) ので、これを含む宣言は無効 (生成内容なし) として扱う
 */
function missingArgument(t: ContentToken): boolean {
  return t.kind === 'fn' && /^(attr|counters?|target-counters?|target-text)$/.test(t.name) && !t.args[0]?.trim();
}

/**
 * 画像 (img・object) そのものが flex の項目のとき、項目を包むブロック (node) の中の画像の百分率の幅・上限・下限 (LImage.percentSize) を、
 * 包むブロックの幅いっぱい (100%) にする。包むブロック (か、項目のセル) は、画像の幅・上限・下限で大きさを決めてあり、その百分率の基準は
 * flex の容器 (CSS Flexbox 1 §9.2・CSS 2.1 §10.2)。画像の百分率を、包むブロックの幅で解き直すと、百分率が 2 度掛かる。
 * 長さで書いた高さ・高さの上限・下限は、そのまま (幅から縦横比で高さを決める: CSS 2.1 §10.6.2)
 */
function imageFillsItem(node: LBlockLevel, el: Element, widthOnly = false, sizedByItem = false, edge = 0): void {
  if (!/^(img|object)$/.test(el.localName) || node.type !== 'block') return;
  const visit = (list: ReadonlyArray<LBlockLevel | LInlineLevel>, depth: number) => {
    for (const x of list) {
      if (typeof x === 'string') continue;
      if (x.type === 'image') {
        // 幅を百分率で決めない画像 (既定の max-width: 100% だけのもの) は、セルの幅で解いても同じなので、そのまま。ただし、flex-basis の
        // 百分率・flex-grow で項目の幅が決まるとき (sizedByItem) は、セルの幅で描く。
        // widthOnly: 包むブロックが、画像の幅だけを持つ (上限・下限の百分率は当てていない) とき。百分率の幅の無い画像は、そのまま
        // (包むブロックは容器の幅いっぱいなので、画像の上限・下限の百分率は、包むブロックの幅で解いてよい)
        const P = x.percentSize;
        const pctSized = !!P && ((!!P.width && P.width.pct !== 0) || (!!P.maxWidth && P.maxWidth.pct !== 0 && !(P.maxWidth.pct === 1 && P.maxWidth.len === 0)) || (!!P.minWidth && P.minWidth.pct !== 0));
        if (P && (widthOnly ? !!P.width && P.width.pct !== 0 : pctSized || sizedByItem)) {
          // 上限・下限のうち、長さだけで書いたもの (pct 0) は、もう 1 度当てても同じなので残す (セルの幅が、それを当てていないときのため)
          const { maxWidth, minWidth, ...rest } = P;
          x.percentSize = { ...rest, width: { pct: 1, len: 0 }, ...(maxWidth?.pct === 0 ? { maxWidth } : {}), ...(minWidth?.pct === 0 ? { minWidth } : {}) };
        } else if (!widthOnly && (!P || ((!P.maxWidth || P.maxWidth.pct === 0) && !P.width))) {
          // 長さの max-width (か none) の画像そのものの項目: 項目の幅 (セルの幅) は、flex の決まり (上限で止め、入りきらなければ縮める。
          // Flexbox 1 §9.7) で決まり、画像はその幅で描く。上限を、包むブロック (項目) の内容の幅 100% にする (長さの上限は、項目の幅が
          // 守っている)。前は、min-width: 0 で縮めた項目の中に、画像を本来の大きさで描き、項目の外へはみ出した。中身の幅を測る組版では、
          // 百分率の上限は none (CSS Sizing 3 §5.2.1) なので、測る幅は変わらない
          x.percentSize = { ...(P ?? {}), maxWidth: { pct: 1, len: 0 } };
        } else if (P && widthOnly && edge > 0) {
          // 包むブロックの余白・罫線・内側の余白 (edge。横の向きの和) の分だけ、包むブロックの内容の幅は容器の幅より狭い。上限・下限の
          // 百分率の基準は容器の幅なので (CSS 2.1 §10.4・Flexbox 1 §4)、包むブロックの内容の幅 c で解く式 pct × c + len に、pct × edge を足す
          const fix = (v: PercentLength | undefined) => (v && v.pct !== 0 ? { pct: v.pct, len: v.len + v.pct * edge } : v);
          x.percentSize = { ...P, ...(P.maxWidth ? { maxWidth: fix(P.maxWidth) } : {}), ...(P.minWidth ? { minWidth: fix(P.minWidth) } : {}) };
        }
      } else if (depth < 3 && 'children' in x && Array.isArray(x.children)) visit(x.children as Array<LBlockLevel | LInlineLevel>, depth + 1);
    }
  };
  visit(node.children, 0);
}

// grid-template-columns の列の幅 (読み込みと組版エンジンの両方が使うので gridTracks.ts に置く)
export { gridTracks, MAX_GRID_REPEAT } from './gridTracks';

// 縦横比のある置換要素の大きさに、最小・最大の幅と高さを当てる関数は、組版エンジンも使うので geometry.ts に置く
export { constrainReplaced } from './geometry';

/**
 * box-shadow (と filter の drop-shadow()。箱の形の影として近似する) を読む。
 * 1 つの影は「[inset] 横 縦 [ぼかし [広がり]] 色」(inset と色は前でも後でも)。色の alpha は不透明度にする
 */
export function shadowsOf(boxShadow: string, filter = ''): BoxShadow[] {
  const one = (v0: string, drop: boolean): BoxShadow | undefined => {
    const inset = /\binset\b/i.test(v0);
    let v = inset ? v0.replace(/\binset\b/gi, ' ') : v0;
    // Color 4・5 の色の関数 (hwb()・lab()・color()・color-mix() など) は、先に rgb() の形にする (中の currentcolor は黒で近似する)
    if (/\b(hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(v))
      v = splitWords(v)
        .map((t) => {
          const c = /^(hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(t) ? parseCssColor(t) : undefined;
          return c && c !== 'current' ? fmtColor(c) : t;
        })
        .join(' ');
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

/**
 * 用紙の大きさの値 (CSS Paged Media 3 §7.1 の size の値: <length>{1,2} | auto | [ <page-size> || [ portrait | landscape ] ]) → 幅・高さ (mm)。
 * @page の無い文書の用紙 (公開 API の pageSize・Node のコマンドの --page-size) を読むのに使う。値の全体が文法に合わなければ undefined
 * (@page の中の size と違い、合わない語を読み飛ばさない)。
 *  - 用紙の名前 (A5・A4・A3・B5・B4・JIS-B5・JIS-B4・letter・legal・ledger と、Kumiori が足している A6) は、大文字・小文字を区別しない
 *  - 長さは、絶対の単位 (mm・cm・Q・in・pt・pc・px) の 1pt 以上の値。1 つなら正方形 (§7.1 の <length>)。em・ex (ページの文脈の書体に対する長さ) と百分率は読まない
 *  - auto と、向きだけの値 (portrait・landscape) は、def (既定は A4) の用紙に対して (§7.1: 用紙は UA が選ぶ)
 */
export function parsePageSize(value: string, def: { width: number; height: number } = { width: 210, height: 297 }): { width: number; height: number } | undefined {
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 2) return undefined;
  const orient = (w: number, h: number, o?: string) => ((o === 'landscape' && w < h) || (o === 'portrait' && w > h) ? { width: h, height: w } : { width: w, height: h });
  if (parts.length === 1 && parts[0] === 'auto') return { width: def.width, height: def.height };
  const lens = parts.map((t) => {
    const m = /^\+?(\d+(?:\.\d*)?|\.\d+)(mm|cm|q|in|pt|pc|px)$/.exec(t);
    const n = m ? parseFloat(m[1]) * UNIT_PT[m[2]] * MM_PER_PT : undefined;
    // 1pt 未満の長さは、組める用紙にならないので読まない
    return n !== undefined && n >= MM_PER_PT && Number.isFinite(n) ? n : undefined;
  });
  if (lens.every((n) => n !== undefined)) return { width: lens[0]!, height: lens[1] ?? lens[0]! };
  if (lens.some((n) => n !== undefined)) return undefined;
  const names = parts.filter((t) => PAGE_SIZES[t]);
  const orients = parts.filter((t) => t === 'portrait' || t === 'landscape');
  if (names.length + orients.length !== parts.length || names.length > 1 || orients.length > 1) return undefined;
  const [w, h] = names.length ? PAGE_SIZES[names[0]] : [def.width, def.height];
  return orient(w, h, orients[0]);
}

/** @page と余白の箱の宣言のうち、印刷の色 (printColor) を読む性質 */
const PAGE_COLOR_PROP = /^(color|background-color|background|border(-(top|right|bottom|left))?(-color)?)$/;

/** @page の宣言 (size・margin・bleed・marks) から、用紙の大きさと余白 (mm) を読む */
function pageBox(
  decls: Record<string, string>,
  def: { width: number; height: number; margin: number },
  rootFsPx = 16,
  spots?: SpotColors,
  /** 色の cmyk()・rgb-icc() (アンテナハウスの拡張の書き方) を読む (互換の指定のときだけ。printColor) */
  ahColorFunctions = true,
  /** 罫線の太さの thin・medium・thick (pt。HtmlImportOptions.pageBorderKeywords) */
  borderKw?: typeof BORDER_KEYWORDS_PT,
): Pick<PageMaster, 'width' | 'height' | 'margins' | 'marginBoxMargins' | 'backgroundOrigin'> & { bleed?: number | 'auto'; marks?: boolean; marksCrop?: boolean; marksCross?: boolean; orientation?: 'upright' | 'rotate-left' | 'rotate-right'; cropOffset?: number; background?: string } {
  // ページの文脈は根元の要素から継ぐ (Paged Media 3 §9)。em は @page の font-size、rem は根元の要素の字の大きさ
  // 字の大きさのキーワード (x-large など) も読む (CSS Fonts 4 §2.4)
  const fsDecl = fontSizePt(decls['font-size'], rootFsPx * PT_PER_PX, rootFsPx * PT_PER_PX);
  const fsPx = fsDecl !== undefined ? fsDecl / PT_PER_PX : rootFsPx;
  /** 長さ (calc() を含む) → pt。vw・vh は用紙の大きさ (決まってから呼ぶ)。pctPx は百分率の基準 (px。無ければ百分率は読まない) */
  const lenPt = (v: string | undefined, pctPx?: number): number | undefined => {
    if (!v) return undefined;
    const px = lengthPx(v, { fs: fsPx, rootFs: rootFsPx, vw: width / MM_PER_PT / PT_PER_PX, vh: height / MM_PER_PT / PT_PER_PX, ...(pctPx !== undefined ? { pct: pctPx } : {}) });
    return px === undefined ? undefined : px * PT_PER_PX;
  };
  /** 括弧の外の空白で分ける */
  const words = (v: string) => splitWords(v).filter(Boolean);
  let width = def.width;
  let height = def.height;
  const margins = { top: def.margin, right: def.margin, bottom: def.margin, left: def.margin };
  const out: { bleed?: number | 'auto'; marks?: boolean; marksCrop?: boolean; marksCross?: boolean; orientation?: 'upright' | 'rotate-left' | 'rotate-right'; cropOffset?: number; background?: string } = {};
  const rawMargins: Partial<Record<'top' | 'right' | 'bottom' | 'left', string>> = {};
  const rawPadding: Partial<Record<'top' | 'right' | 'bottom' | 'left', string>> = {};
  for (const [prop, raw] of Object.entries(decls)) {
    const val = raw.toLowerCase();
    if (prop === 'size') {
      const parts = words(val);
      const named = parts.find((p) => PAGE_SIZES[p]);
      const lens = parts.map(lenPt).filter((n): n is number => n !== undefined);
      // 負の長さは無効 (CSS Paged Media 3 §7.1)。0 と 1pt 未満の長さも、組める用紙にならないので、同じく読まない (既定の用紙になる)
      // (宣言を読まない。字面で分かる負・0 の長さは、規則を重ねるときに読み捨てる (resolvePageRules)。ここは calc() などの計算の結果と、
      // 1e-320pt のような小さい長さ。前は、負の幅のまま組み、SVG・PNG の書き出しが負の大きさに、小さすぎる用紙は PDF の MediaBox の数が壊れていた)
      if (lens.some((n) => !(n >= 1 && Number.isFinite(n)))) continue;
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
    } else if (prop === 'padding') {
      const [t, r = t, b = t, l = r] = words(val);
      Object.assign(rawPadding, { top: t, right: r, bottom: b, left: l });
    } else if (/^padding-(top|right|bottom|left)$/.test(prop)) {
      rawPadding[prop.slice(8) as 'top'] = val;
    } else if (prop === 'bleed') {
      // auto は、marks に crop があれば 6pt、無ければ 0 (CSS Paged Media 3 §7.3)。marks が決まってから masterOf で長さにする
      if (val.trim() === 'auto') out.bleed = 'auto';
      else {
        const n = lenPt(val);
        if (n !== undefined) out.bleed = n * MM_PER_PT;
      }
    } else if (prop === 'marks') {
      // none | [ crop || cross ] (CSS Paged Media 3 §7.2): crop は角のトンボ (仕上がりの角)、cross は十字のトンボ (各辺の中央の見当合わせ)
      out.marks = /crop|cross/.test(val);
      out.marksCrop = /\bcrop\b/.test(val);
      out.marksCross = /\bcross\b/.test(val);
    } else if (prop === 'page-orientation') {
      // upright | rotate-left | rotate-right (CSS Paged Media 3 §7.1.2)。組版の後に、出力のページを左 (反時計回り)・右 (時計回り) に 1/4 回す。
      // 組み方は変えない
      const v = val.trim().toLowerCase();
      if (v === 'rotate-left' || v === 'rotate-right' || v === 'upright') out.orientation = v;
    }
    else if (prop === 'background' || prop === 'background-color') {
      // ページの背景色 (塗り足しまで届く)。background の一括指定は、色だけ読む
      const col = printColor(raw, spots, ahColorFunctions) ?? splitWords(raw).map(cssColor).find((c) => c && (/^#/.test(c) || isColorName(c)));
      if (col) out.background = col;
    } else if (prop === '-ah-crop-offset') {
      // 仕上がりの端から用紙の端までの幅 (アンテナハウスの拡張)
      const n = lenPt(words(val)[0]);
      if (n !== undefined) out.cropOffset = n * MM_PER_PT;
    }
  }
  // 余白 (用紙の大きさが決まってから。百分率は、左右は用紙の幅、上下は用紙の高さに対して)
  const sideLen = (sd: 'top' | 'right' | 'bottom' | 'left', v: string): number | undefined => {
    const base = sd === 'left' || sd === 'right' ? width : height;
    const pct = /^(-?[\d.]+)%$/.exec(v.trim());
    if (pct) return (base * parseFloat(pct[1])) / 100;
    // calc() の中の百分率も、同じ基準 (calc(10% + 10pt) など。前は読めずに、前の @page の余白を既定の余白に戻していた)
    const n = lenPt(v, base / MM_PER_PT / PT_PER_PX);
    return n === undefined ? undefined : n * MM_PER_PT;
  };
  for (const [sd, v] of Object.entries(rawMargins) as Array<['top' | 'right' | 'bottom' | 'left', string]>) {
    const n = sideLen(sd, v);
    if (n !== undefined) margins[sd] = n;
  }
  // ページの箱の padding と罫線 (CSS Paged Media 3 §3: ページの箱は CSS の箱の模型に従い、ページの領域 (本文を組む所) は箱の内容の領域。
  // 余白の箱はページの余白 (margin) の中に置くので、padding は余白の箱を動かさず、本文の領域だけを狭める)。負の値は無効 (CSS 2.1 §8.4)
  const padding = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const [sd, v] of Object.entries(rawPadding) as Array<['top' | 'right' | 'bottom' | 'left', string]>) {
    const n = sideLen(sd, v);
    if (n !== undefined && n >= 0) padding[sd] = n;
  }
  // ページの箱の罫線も、本文の領域を狭める (margin の内側、padding の外側。CSS Paged Media 3 §3)
  const pb = pageBorders(decls, fsPx * PT_PER_PX, undefined, borderKw);
  // 背景画像の位置の基準の領域: ページの箱の padding の領域 (余白と罫線の内側。CSS Paged Media 3 §3.1: ページの背景は、既定では
  // ページの箱の padding の領域に据える (background-origin の初期値 padding-box。CSS Backgrounds 3 §2.8))。背景画像のあるときだけ使う
  const backgroundOrigin = { ...margins };
  for (const sd of ['top', 'right', 'bottom', 'left'] as const) if (pb[sd]) backgroundOrigin[sd] += pb[sd]!.width * MM_PER_PT;
  for (const sd of ['top', 'right', 'bottom', 'left'] as const) if (pb[sd]) padding[sd] += pb[sd]!.width * MM_PER_PT;
  if (padding.top || padding.right || padding.bottom || padding.left) {
    const body = { top: margins.top + padding.top, right: margins.right + padding.right, bottom: margins.bottom + padding.bottom, left: margins.left + padding.left };
    return { width, height, margins: body, marginBoxMargins: margins, backgroundOrigin, ...out };
  }
  return { width, height, margins, backgroundOrigin, ...out };
}

/**
 * CSS の @page 規則 (名前・擬似クラスの無いもの) から、用紙の大きさと余白を読む。
 * :first などの規則・余白の箱は、importHtml の中で扱う
 */
export function parsePageRule(css: string | ParsedCss, def: { width: number; height: number; margin: number }, sel: PageSelect = {}): Pick<PageMaster, 'width' | 'height' | 'margins'> {
  const { width, height, margins } = pageBox(resolvePageRules((typeof css === 'string' ? parseCss(css) : css).pages, sel).decls, def);
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
/** document white space characters (空白・タブ・改行。CSS Text 3 §4.1) だけの文字列か。NBSP・全角の空白などは含まない (String.prototype.trim は含む) */
const DOC_WS_ONLY = /^[ \t\n\r\f]*$/;

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
/** 行内の flex・grid の容器の直下の、続いた文字の並び: 組んだ項目 (items) と、空白の処理・字の変換の前の元の字 (raw) */
type TextRun = { items: FlowItem[]; raw: string };
/** 文字の節 (Text か CDATASection) か */
const isTextNode = (n: Node) => n.nodeType === 3 || n.nodeType === 4;
/** 区切りを避ける値の種類 (edgeAvoids)。all: avoid・avoid-page、column: avoid-column */
type AvoidKind = 'all' | 'column';
/** 絶対配置の箱の、百分率で指定した top・bottom・height (0.5 = 50%) */
type AbsPercent = { top?: number; bottom?: number; height?: number; left?: number; right?: number };

interface PageSwitch {
  type: 'page-switch';
  page: string;
  /** counter-reset: page N */
  initial?: number;
  /**
   * 名前の変わらない、新しいページの組 (CSS GCPM 3 §3.2 の page group) だけのための切り替え。:nth(An+B of 名前) の順を、その組から数え直すために
   * ページシーケンスを分け、名前の変わる所でだけ分けたときと同じ組み方にする (名前付きの :first を当てない)
   */
  sameRun?: boolean;
}

/**
 * @page の背景の background-attachment が fixed か (個別の指定か、無ければ background の一括指定の中の fixed。CSS Backgrounds 3 §2.5)。
 * 繰り返しの読み方 (pageBackground) と同じに、個別の指定を一括指定より先に見る。宣言の表 (resolvePageRules) は、一括指定を足すときに、
 * それより前の個別の指定を除く (setDecl) ので、表に個別の指定があれば、それは一括指定より後に書いたもの (後に書いた宣言が勝つ。
 * CSS Cascade 4 §6.1。「background-attachment: scroll; background: url(a.png) fixed」は fixed)
 */
function pageBackgroundFixed(decls: Record<string, string>): boolean {
  const a = decls['background-attachment'];
  if (a !== undefined) return a.trim().toLowerCase().split(/\s*,\s*/)[0] === 'fixed';
  // 重ねの区切りは、括弧の外のカンマだけ (色の rgb(…, …) の中のカンマで切らない。CSS Backgrounds 3 §2.10 の <bg-layer> の並び)
  // url() の中は見ない (引用符の中の括弧・カンマも url() の中)
  return splitWords(splitTop((decls.background ?? '').replace(/url\((?:"[^"]*"|'[^']*'|[^)])*(?:\)|$)/gi, ' '), ',')[0] ?? '').some((t) => t.toLowerCase() === 'fixed');
}

/**
 * @page・余白の箱の背景の、最初の重ねの繰り返し (CSS Backgrounds 3 §2.4: <repeat-style> = repeat-x | repeat-y | [repeat | space | round | no-repeat]{1,2})。
 * background-repeat があればそれ、無ければ background の一括指定の中の繰り返しの語 (url()・グラデーションの中は見ない)。
 * 1 値の repeat-x は「repeat no-repeat」、repeat-y は「no-repeat repeat」、ほかの 1 値は横・縦とも同じ値。space・round は repeat として扱う。
 * 初期値の repeat (横・縦とも並べる) なら undefined
 */
function pageRepeatOf(decls: Record<string, string>): BackgroundImage['repeat'] {
  const src = decls['background-repeat'] ?? (decls.background ?? '').replace(/url\((?:"[^"]*"|'[^']*'|[^)])*(?:\)|$)/gi, ' ').replace(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, ' ');
  const words = splitWords(splitTop(src, ',')[0] ?? '')
    .map((t) => t.toLowerCase())
    .filter((t) => /^(repeat|no-repeat|repeat-x|repeat-y|space|round)$/.test(t));
  let x: string;
  let y: string;
  if (words[0] === 'repeat-x') [x, y] = ['repeat', 'no-repeat'];
  else if (words[0] === 'repeat-y') [x, y] = ['no-repeat', 'repeat'];
  else [x, y] = [words[0] ?? 'repeat', words[1] ?? words[0] ?? 'repeat'];
  const rx = x !== 'no-repeat';
  const ry = y !== 'no-repeat';
  return rx && ry ? undefined : rx ? 'repeat-x' : ry ? 'repeat-y' : 'no-repeat';
}

/** 罫線の太さの thin・medium・thick の既定 (pt)。文書の要素の罫線の既定 (1px・3px・5px。cssCascade) と同じ */
const BORDER_KEYWORDS_PT = { thin: 0.75, medium: 2.25, thick: 3.75 };

/**
 * CSS の border の一括指定 (幅・線種・色)。半透明の色は #rrggbbaa のまま (文書の要素の罫線と同じに、描くときに下の色と重ねる)。
 * 書かなかった太さは初期値の medium (CSS Backgrounds 3 §3.3・§3.4。kw は thin・medium・thick の太さ (pt))
 */
function parseBorder(v: string, fs: number, kw = BORDER_KEYWORDS_PT): BorderSide | undefined {
  let width = kw.medium;
  let style = 'solid';
  let color = '#000000';
  for (const t of splitWords(v)) {
    const n = lenEm(t, fs);
    if (n !== undefined) width = n;
    else if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(t)) style = t;
    else if (t === 'thin' || t === 'medium' || t === 'thick') width = kw[t];
    else color = cssColorAlpha(t) ?? color;
  }
  if (style === 'none' || style === 'hidden' || width <= 0) return undefined;
  return { width, color, ...(style !== 'solid' ? { style: style as BorderSide['style'] } : {}) };
}

/**
 * ページの文脈・余白の箱・脚注の擬似要素の宣言 (書いたままの値) の長さ → pt (CSS Paged Media 3 §4・§5: ふつうの CSS の値)。
 * em は fs (pt)、rem は o.rootFs (根元の要素の字の大きさ。無ければ fs)、百分率は o.pct (pt。無ければ読まない) に対する長さ。
 * calc()・min()・max()・clamp() と、ex・ch・lh などの相対の単位も読む (CSS Values 4 §6・§10。vw・vh は、o.vw・o.vh があるときだけ)。
 * 前は em・rem と絶対の単位しか読まず、百分率・calc() の宣言を黙って捨てていた
 */
function lenEm(v: string, fs: number, o: { rootFs?: number; pct?: number; vw?: number; vh?: number } = {}): number | undefined {
  const m = /^(-?[\d.]+)(r?em)$/i.exec(v.trim());
  if (m) return parseFloat(m[1]) * (m[2].toLowerCase() === 'rem' ? (o.rootFs ?? fs) : fs);
  const abs = cssLen(v);
  if (abs !== undefined) return abs;
  const px = lengthPx(v, { fs: fs / PT_PER_PX, rootFs: (o.rootFs ?? fs) / PT_PER_PX, vw: (o.vw ?? NaN) / PT_PER_PX, vh: (o.vh ?? NaN) / PT_PER_PX, ...(o.pct !== undefined ? { pct: o.pct / PT_PER_PX } : {}) });
  return px !== undefined && Number.isFinite(px) ? px * PT_PER_PX : undefined;
}

/** 字の大きさの絶対のキーワード (px。CSS Fonts 4 §2.4 の表。文書の要素の字の大きさ (cssCascade) と同じ値) */
const FONT_SIZE_KEYWORDS_PX = { __proto__: null, 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 } as unknown as Record<string, number>;

/**
 * ページの文脈・余白の箱・脚注の擬似要素の font-size (書いたままの値) → pt (CSS Fonts 4 §2.4)。parentFs (pt) は受け継ぐ字の大きさで、
 * 百分率・em・smaller・larger の基準。rootFs (pt) は rem の基準。絶対のキーワード (x-large など) は表の大きさ。負の値・読めない値は undefined
 * (前は em・rem と絶対の単位しか読まず、百分率 (@bottom-center { font-size: 80% } など)・calc()・キーワードを黙って捨てていた)
 */
function fontSizePt(v: string | undefined, parentFs: number, rootFs: number): number | undefined {
  const k = (v ?? '').trim().toLowerCase();
  if (!k) return undefined;
  if (k === 'initial') return FONT_SIZE_KEYWORDS_PX.medium * PT_PER_PX;
  if (FONT_SIZE_KEYWORDS_PX[k] !== undefined) return FONT_SIZE_KEYWORDS_PX[k] * PT_PER_PX;
  // 相対のキーワード (文書の要素と同じに、1.2 倍で増やし・減らす)
  if (k === 'smaller') return parentFs / 1.2;
  if (k === 'larger') return parentFs * 1.2;
  const n = lenEm(k, parentFs, { rootFs, pct: parentFs });
  return n !== undefined && n >= 0 ? n : undefined;
}

/**
 * 余白の箱の宣言の罫線の個別の指定 (border-<辺>-width・-style・-color と、border-width・border-style・border-color (1〜4 個の値。
 * 上・右・下・左の決まり)) を、辺ごとの一括指定 (border-<辺>: 太さ 線種 色) にまとめる (書いた順に、後の宣言が勝つ。CSS Backgrounds 3 §3)。
 * 一括指定で書かれなかった部分は初期値 (太さ medium・線種 none・色 currentcolor (箱の字の色。箱の color か、受け継いだ色 inheritedColor)。§3.1〜§3.3)。
 * 個別の指定が無ければ、宣言はそのまま (余白の箱の罫線は、一括指定 (border・border-<辺>) だけを読んでいた)
 */
function marginBorderDecls(d: Record<string, string>, inheritedColor?: string): Record<string, string> {
  const LONG = /^border(?:-(top|right|bottom|left))?-(width|style|color)$/;
  if (!Object.keys(d).some((k) => LONG.test(k))) return d;
  type Part = 'width' | 'style' | 'color';
  const SIDES = ['top', 'right', 'bottom', 'left'] as const;
  const sides: Partial<Record<(typeof SIDES)[number], Partial<Record<Part, string>>>> = {};
  const STYLE = /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    const sh = /^border(?:-(top|right|bottom|left))?$/.exec(k);
    const lg = LONG.exec(k);
    if (!sh && !lg) {
      out[k] = v;
      continue;
    }
    if (sh) {
      // 一括指定: 書かれなかった部分は初期値に戻す
      const parts: Partial<Record<Part, string>> = {};
      for (const t of splitWords(v)) {
        if (STYLE.test(t)) parts.style = t;
        else if (/^(thin|medium|thick)$/i.test(t) || cssLen(t) !== undefined || /^-?[\d.]+r?em$/i.test(t)) parts.width = t;
        else parts.color = t;
      }
      for (const sd of sh[1] ? [sh[1] as (typeof SIDES)[number]] : SIDES) sides[sd] = { ...parts };
      continue;
    }
    const part = lg![2] as Part;
    if (lg![1]) {
      const sd = lg![1] as (typeof SIDES)[number];
      sides[sd] = { ...sides[sd], [part]: v.trim() };
    } else {
      // border-width など: 上・右・下・左 (値が足りなければ、向かいの辺の値)
      const [t, r = t, b = t, l = r] = splitWords(v).filter(Boolean);
      const vals = { top: t, right: r, bottom: b, left: l };
      for (const sd of SIDES) sides[sd] = { ...sides[sd], [part]: vals[sd] };
    }
  }
  const color = d.color ?? inheritedColor ?? 'currentcolor';
  for (const sd of SIDES) {
    const s = sides[sd];
    if (!s) continue;
    const c = !s.color || /^currentcolor$/i.test(s.color) ? color : s.color;
    out[`border-${sd}`] = `${s.width ?? 'medium'} ${s.style ?? 'none'} ${c}`;
  }
  return out;
}

/**
 * ページ文脈・余白の箱の宣言の輪郭線 (outline・outline-width・-style・-color・outline-offset。CSS UI 4 §3。書いた順に、後の宣言が勝つ)。
 * 線種が none か太さが 0 なら undefined。色の初期値 (auto・currentcolor) は箱の字の色 (color)。fs は em の基準 (pt)
 */
function declOutline(d: Record<string, string>, fs: number, color: string | undefined): Outline | undefined {
  let width = 'medium';
  let style = 'none';
  let col = 'currentcolor';
  const STYLE = /^(none|auto|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i;
  for (const [k, v] of Object.entries(d)) {
    if (k === 'outline') {
      [width, style, col] = ['medium', 'none', 'currentcolor'];
      for (const t of splitWords(v)) {
        if (STYLE.test(t)) style = t;
        else if (/^(thin|medium|thick)$/i.test(t) || lenEm(t, fs) !== undefined) width = t;
        else col = t;
      }
    } else if (k === 'outline-width') width = v.trim();
    else if (k === 'outline-style') style = v.trim();
    else if (k === 'outline-color') col = v.trim();
  }
  style = style.toLowerCase();
  const w = /^(thin|medium|thick)$/i.test(width) ? { thin: 0.75, medium: 2.25, thick: 3.75 }[width.toLowerCase() as 'thin'] : (lenEm(width, fs) ?? 0);
  if (style === 'none' || w <= 0) return undefined;
  const c = borderColorOf(/^(auto|currentcolor)$/i.test(col) ? (color ?? '#000000') : col);
  if (c === 'transparent') return undefined;
  const off = d['outline-offset'] !== undefined ? (lenEm(d['outline-offset'], fs) ?? 0) : 0;
  return { width: w, color: c, ...(style !== 'solid' && style !== 'auto' ? { style: style as Outline['style'] } : {}), ...(off ? { offset: off } : {}) };
}

/**
 * ページの箱の罫線 (@page の border・border-<辺>・個別の指定。CSS Paged Media 3 §3・付録 A: ページの箱は CSS の箱の模型に従い、
 * margin と padding の間に罫線がある)。辺 → 罫線 (幅は pt)。fs は em の基準 (pt)、color は字の色 (罫線の色の初期値)
 */
function pageBorders(decls: Record<string, string>, fs: number, color?: string, kw?: typeof BORDER_KEYWORDS_PT): Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> {
  const bd = marginBorderDecls(Object.fromEntries(Object.entries(decls).filter(([k]) => /^border(-(top|right|bottom|left))?(-(width|style|color))?$/.test(k))), color);
  const out: Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> = {};
  for (const [prop, val] of Object.entries(bd)) {
    const bm = /^border(?:-(top|right|bottom|left))?$/.exec(prop);
    if (!bm) continue;
    const b = parseBorder(val, fs, kw);
    for (const sd of bm[1] ? [bm[1] as 'top'] : (['top', 'right', 'bottom', 'left'] as const)) {
      if (b) out[sd] = b;
      else delete out[sd];
    }
  }
  return out;
}

/**
 * margin・padding の一括指定 (1〜4 個の値。上・右・下・左の決まり) を、辺ごとの指定 (margin-top など) に展開する (書いた順に、後の宣言が勝つ)。
 * 辺ごとの指定だけを読む所 (@footnote の領域) のため
 */
function expandBoxSides(d: Record<string, string>): Record<string, string> {
  if (d.margin === undefined && d.padding === undefined) return d;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k !== 'margin' && k !== 'padding') {
      out[k] = v;
      continue;
    }
    const [t, r = t, b = t, l = r] = splitWords(v).filter(Boolean);
    for (const [sd, x] of [['top', t], ['right', r], ['bottom', b], ['left', l]] as const) {
      // 後の宣言が勝つように、前に書いた同じ辺の指定を消してから足す
      delete out[`${k}-${sd}`];
      if (x !== undefined) out[`${k}-${sd}`] = x;
    }
  }
  return out;
}

/**
 * ページ文脈・余白の箱の宣言 (書いたままの値) のうち、字の書式の一括指定 (font・font-variant・text-decoration) を、個別の性質に分ける
 * (書いた順のまま。後の宣言が勝つ)。inherit・unset の宣言は捨てる (受け継いだ値を使う)。ほかの宣言はそのまま
 */
function marginTextDecls(d: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    const longs = /^(font|font-variant|text-decoration)$/.test(k) ? expand(k, v) : [[k, v] as [string, string]];
    for (const [lk, lv] of longs) {
      delete out[lk];
      if (MARGIN_TEXT_PROPS.test(lk) && /^(inherit|unset)$/i.test(lv.trim())) continue;
      out[lk] = lv;
    }
  }
  return out;
}
/**
 * 余白の箱に効かせる字の書式の性質。CSS Page 3 §6・付録 A の、余白の箱に効く CSS 2.1 の性質 (font-variant・font・text-decoration・
 * text-transform・letter-spacing・word-spacing・white-space) と、その CSS 3 以降の個別の性質。CSS 2.1 に無い性質の振る舞いは
 * §6 が決めていない (CSS3 の性質を足していけるように、と注記する) ので、本文と同じに読む
 */
const MARGIN_TEXT_PROPS =
  /^(font-size|font-family|font-weight|font-style|color|line-height|letter-spacing|word-spacing|text-transform|white-space|font-variant|font-variant-(caps|numeric|east-asian|ligatures|position)|font-feature-settings|font-kerning|font-stretch|font-optical-sizing|font-variation-settings|font-palette|hyphens|line-break|word-break|overflow-wrap|text-decoration-(line|style|color|thickness)|text-underline-offset)$/;
/** そのうち、受け継がない性質 (ページ文脈から余白の箱へ渡さない) */
const MARGIN_TEXT_NOT_INHERITED = /^(text-decoration-(line|style|color|thickness))$/;

/** font-variant-caps の値 → small caps の種類 (small-caps・all-small-caps。ほかは無し) */
function marginSmallCaps(v: string): '' | 'small' | 'all' {
  return /all-small-caps/i.test(v) ? 'all' : /small-caps/i.test(v) ? 'small' : '';
}

/** 1〜4 個の値の一括指定 (margin・padding) */
/**
 * 余白の箱の決まった向きの寸法 (CSS Page 3 §5.3.3。上の箱の height・margin-top・margin-bottom の決まりと、それを読み替えた下・左・右の箱)。
 * outer: その辺の余白の大きさ。a・b: 前・後ろの margin (上下なら上・下、左右なら左・右)。size: 中身の大きさ。pb: 罫線と内側の余白の和。
 * outsideA: a がページの端の側の margin (上の箱・左の箱)。
 *  1. a + pb + size + b = outer
 *  2. auto でない値と pb の和が outer より大きければ、auto の margin は 0 とする
 *  3. どれも auto でなければ (決まりすぎ)、ページの端の側の margin を auto とする
 *  4. auto が 1 つなら、式から決める
 *  5. size が auto なら、ほかの auto は 0 とし、size を式から決める (負にはしない)
 *  6. margin が両方 auto なら、等しくする (真ん中に置く)
 */
export function marginBoxFixedDimension(outer: number, a: number | 'auto', b: number | 'auto', size: number | 'auto', pb: number, outsideA: boolean): { a: number; b: number; size: number } {
  const known = pb + (a === 'auto' ? 0 : a) + (b === 'auto' ? 0 : b) + (size === 'auto' ? 0 : size);
  if (known > outer) {
    if (a === 'auto') a = 0;
    if (b === 'auto') b = 0;
  }
  if (a !== 'auto' && b !== 'auto' && size !== 'auto') {
    if (outsideA) a = 'auto';
    else b = 'auto';
  }
  if (size === 'auto') {
    const ma = a === 'auto' ? 0 : a;
    const mb = b === 'auto' ? 0 : b;
    return { a: ma, b: mb, size: Math.max(0, outer - pb - ma - mb) };
  }
  if (a === 'auto' && b === 'auto') {
    const m = (outer - pb - size) / 2;
    return { a: m, b: m, size };
  }
  if (a === 'auto') return { a: outer - pb - size - (b as number), b: b as number, size };
  return { a, b: outer - pb - size - a, size };
}

function edges4(v: string, fs: number, rootFs?: number): { top: number; right: number; bottom: number; left: number } {
  // 括弧の外の空白で分ける (calc(5pt + 5pt) を 1 つの値として読む)
  const n = splitWords(v.trim()).filter(Boolean).map((x) => lenEm(x, fs, { rootFs }) ?? 0);
  const [t, r = t, b = t, l = r] = n;
  return { top: t, right: r, bottom: b, left: l };
}

const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/u;

/**
 * まだ空白にするか消すかを決めていない改行 (segment break) の印。text() が、前か後ろの字が同じテキストの節の中に無い改行をこれにし、
 * resolveSegmentBreaks が、ブロックの中身をつないだ後に、空白 (U+0020) にするか消す。U+2000 (EN QUAD) は、text() が普通の空白にする字
 * (改行する幅の空白) なので、text() の出力には印としてしか現れない。また、正規の分解で U+2002 になる字 (NFC で残らない) で、文書の字としてもまず現れない。
 * JavaScript の trim() と \s は空白とみなす (空白だけの文字列を捨てる判定は、印を空白と同じに扱う)。決めずに残った印は、importHtml の終わりに空白にする
 */
const SEG_BREAK = '\u2000';

/**
 * 字の並びの空白と改行を white-space (ws) で扱う (CSS Text 3 §4.1)。pre・pre-wrap・break-spaces は空白も改行も残す (改行は強制改行になる)。
 * mark が偽なら、前か後ろの字が並びの中に無い改行も、ここで空白にする (印 SEG_BREAK にしない。並びの外の字を見ない所: 余白の箱など)
 */
function whiteSpaceText(t: string, ws: string, mark: boolean): string {
  if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces') return t.replace(/\r\n?/g, '\n');
  let s = trimAroundNewlines(t.replace(/\r\n?/g, '\n'));
  // 改行 (CSS Text 3 §4.1.3): 続いた改行は 1 つにまとめ、残った改行は、前後の字で空白にするか消すかを決める (決め方は UA に任されている)。
  // ここでは、前後が和文なら消し、それ以外は空白にする (pre-line は改行のまま)。前後の字は見るだけで、置き換えには含めない
  // (含めると、1 字だけの行が続くとき (あ\nい\nう) に、次の改行の前の字を見られない)。
  // 前か後ろの字がこの節の中に無い改行 (節の端の改行。<b>\n強調\n</b>・これは\n<b>…) は、ここでは決めずに印 (SEG_BREAK) にし、ブロックの中身を
  // つないだ後に、行内の要素の境目をまたいだ前後の字で決める (resolveSegmentBreaks。CSS Text 3 §1.5: 隣り合うかは、間の行内の箱の境目と
  // 流れの外の要素を無視して決める)。text-transform: full-width の要素では、空白が全角の空白になる (§2.1) ので、印にせず、これまでどおり空白にする
  if (ws !== 'pre-line') {
    s = s.replace(/\n+/g, (m, at: number, all: string) => {
      const a = Array.from(all.slice(Math.max(0, at - 2), at)).pop() ?? '';
      const cp = all.codePointAt(at + m.length);
      const b = cp === undefined ? '' : String.fromCodePoint(cp);
      if (mark && (!a || !b)) return SEG_BREAK;
      return CJK.test(a) && CJK.test(b) ? '' : ' ';
    });
  }
  return s.replace(/[ \t]+/g, ' ');
}

class HtmlImporter {
  report: ImportReport = { unsupported: Object.create(null), notes: [], images: [], counts: { sequences: 1, blocks: 0, tables: 0, footnotes: 0, floats: 0, rubies: 0 } };
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
  /** line-height: normal の値を引くときの指定 (ブラウザの既定のスタイルでは、既定の書体も書体の値。HtmlImportOptions.normalLineHeightAllFonts) */
  private get normalOpts(): { defaultFonts?: boolean } | undefined {
    return this.opts.normalLineHeightAllFonts ? { defaultFonts: true } : undefined;
  }
  /** 直前に組んだ ::before / ::after の文字 (target-text の before / after) */
  private lastPseudoText: Record<'::before' | '::after', string> = { '::before': '', '::after': '' };
  /** 組んだ ::before / ::after の文字 (要素ごと。target-text() の子孫の生成した内容を、組んだときのカウンターの値で取る) */
  private pseudoTextOf = new WeakMap<Element, Partial<Record<'::before' | '::after', string>>>();
  /** 組んだ ::before・::after の中身の字 (中身の幅の見積もり maxContentWidth が数える。pseudoTextOf と違い、いつも覚える) */
  private pseudoTextSeen = new WeakMap<Element, Partial<Record<'::before' | '::after', string>>>();
  /** target-text() を使う文書 (1 回目の変換で、id を持つ要素の文字を集める) */
  private readonly wantText: boolean;
  /** タグ付き PDF の構造の木を作る仕組み (HtmlImportOptions.tagged のときだけ) */
  private sb?: StructureBuilder<Element>;
  /** タグ付き PDF の構造の節の並び (0 番が文書) */
  private get struct(): StructNode[] | undefined {
    return this.sb?.nodes;
  }
  /** 要素の文書の順 (前順の番号) */
  private elOrder = new Map<Element, number>();
  /** インラインの中で生じたマーカー (段落の外へ出す) */
  private pendingMarkers: LMarker[] = [];
  /**
   * 行内の要素の中で見つけた float (flowFloat)。行内の要素を出た所の並びの、書いた所の目印 (LInline.floatAnchor。番号は
   * LFloat.inlineAnchor) を含む子の後に置く (placeAtAnchors)
   */
  private pendingFloats: LFloat[] = [];
  /** 行内の要素の中の float の、書いた所の目印の通し番号 */
  private floatAnchorSeq = 0;
  /**
   * いま中身を並べている、行内でない要素 (flowChildren を inline でなく呼んだ要素)。行内の要素の中の float・絶対配置の箱は、この要素の
   * 中身の並びに出して組むので、受け継ぐ書式 (字の大きさなど) は、この要素との違いで渡す (行内の親との違いで渡すと、組版はこの要素の
   * 書式から受け継ぐので、行内の親の字の大きさなどが抜ける。CSS 2.1 §6.2: 受け継ぐ値は、文書の木の親の計算値)
   */
  private flowBlockEl: Element | undefined;
  /**
   * 中身を行内のまま読んで (flowChildren(el, true))、それ自体を 1 つのブロックの中身にする要素 (脚注の本体・行内の要素から作る float)。
   * この要素の直下の並びは、行内でない要素の中身の並びと同じく、行内の子の中の float をその場で受け取る (ownFloats)
   */
  private floatHome: Element | undefined;
  private bodyEl?: Element;
  private curPage?: string;
  /**
   * 文書の最初のページの名前 (html・body の page。rootPageName)。最初の切り替え (curPage が決まる所) より前の箱
   * (最初の流れの箱より前の絶対配置・固定配置の箱) は、このページに置かれるので、その領域を基準にする
   */
  private rootPage = '';
  /** pageSwitchAt を、まだ呼んでいない (次に見る箱が、最初の流れの箱) */
  private pageSwitchSeen = false;
  /** 最初の流れの箱の、ページ番号の振り直し (切り替えを入れずに、最初の組の番号にするもの。pageSwitchAt) */
  private firstPageInitial?: number;
  /** counter(page, 書式) の書式 (ページシーケンスごとに、最初に出たもの。null はまだ出ていない) */
  private pageFormat: string | null = null;
  /** いま余白の箱を組んでいる @page の規則 (マスター) の、最初の counter(page) の書式 (ページラベルの書式。PageMaster.pageNumberFormat) */
  private masterPageFormat: string | null = null;
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
    const b = pageBox(resolvePageRules(this.pageRules, { name }, ...this.pageWm).decls, this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 }, this.rootFsPx, this.opts.spotColors, !!this.opts.ahCssExtensions, this.opts.pageBorderKeywords);
    return { top: b.margins.top * PT, right: b.margins.right * PT, bottom: b.margins.bottom * PT, left: b.margins.left * PT, width: (b.width - b.margins.left - b.margins.right) * PT, height: (b.height - b.margins.top - b.margins.bottom) * PT };
  }
  /** 要素の子の字 (plainText。生成内容を含まない部分だけ覚える) */
  private plainInner = new WeakMap<Element, string>();
  /** position: fixed の箱 (全ページに出す) */
  private fixed: LBlockContainer[] = [];
  /** 生成内容で作れる残りの字の数 (GENERATED_TEXT_BASE。run で、文書の字の数から決める) */
  private generatedLeft = GENERATED_TEXT_BASE;
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
      // 接頭辞の無い名前に書いたアンテナハウスの拡張の値 (float: top など) は、互換の指定の無いときは無効の値なので、宣言ごと除いて
      // 報告する (前の宣言を打ち消さない。CSS 2.1 §4.2)
      const decls = r.list.flatMap(([p, v0, imp]) => {
        // カスタム プロパティ (--*) の宣言の値は、ここでは置き換えない (自前で読む宣言ではなく、値はカスケードが var() で引くときに解く)。
        // 置き換えると、var() の長い連鎖 (--a1: var(--a0) を 5000 段) で、段ごとに前の段の値の全体を写し、2 乗の手間になっていた
        const v = p.startsWith('--') ? v0 : substituteRootVars(v0, rootVars);
        if (this.dropCompatOnly(p, v)) return [];
        const al = AH_ALIASES[p];
        const ok = wanted(p, v, !!pseudo);
        return [al ? { p: al.prop, v: al.value(v), imp: !!imp, ok } : { p, v, imp: !!imp, ok }];
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
        // アンテナハウスの別名 (-ah-line-height-shift-adjustment など) は、規則と同じく CSS の名前に読み替える。
        // 同じ性質の宣言は、後の宣言が勝つ (!important の宣言は、!important の無い宣言に勝つ。CSS Cascade 4 §6.1)。
        // 読めない値の宣言は捨てる (CSS 2.1 §4.2。前の宣言が残る)。勝った宣言が自前で読まない値 (color: #00f など) なら、
        // その性質は当てず、規則から当てた値も外す (ブラウザの確定値を使う。collectPaged と同じ)
        const win = new Map<string, { v: string; imp: boolean; ok: boolean }>();
        for (const [p0, val0, imp] of splitDecls(attr)) {
          if (this.dropCompatOnly(p0, val0)) continue;
          const al = AH_ALIASES[p0];
          const [p, val] = al ? [al.prop, al.value(val0)] : [p0, val0];
          const cur = win.get(p);
          if (cur?.imp && !imp) continue;
          win.set(p, { v: val, imp: !!imp, ok: isPagedDecl(p0, val0) || p0 === 'content' });
        }
        if (win.size && v) for (const [p, d] of win) if (!d.ok && p in v) (v = { ...v }), delete v[p];
        const own = [...win].filter(([, d]) => d.ok).map(([p, d]): [string, string] => [p, d.v]);
        if (own.length || v !== this.paged.get(el)) this.paged.set(el, (v = { ...v, ...Object.fromEntries(own) }));
      }
    }
    return v ?? {};
  }
  private styleAttrRead = new WeakSet<Element>();

  /**
   * 接頭辞の無い名前に書いた、アンテナハウスの拡張の値の宣言を捨てるか (htmlPaged の compatOnlyValue)。互換の指定 (opts.ahCssExtensions。
   * text-align の inside・outside は opts.textAlignInsideOutsideAh、text-autospace の none は opts.jaDefaultsAh) の無いときは、無効の値として
   * 捨て、報告する (警告に出る)。値の文法に合わない宣言も捨てる (報告はしない)
   */
  private dropCompatOnly(prop: string, value: string): boolean {
    if (this.opts.ahCssExtensions) return false;
    const what = compatOnlyValue(prop, value);
    if (what && (((prop === 'text-align' || prop === 'text-align-last') && this.opts.textAlignInsideOutsideAh) || (prop === 'text-autospace' && this.opts.jaDefaultsAh))) return false;
    // 値の文法に合わない宣言 (text-spacing-trim: zzz など) は、ふつうの無効の宣言として黙って捨てる (CSS 2.1 §4.2。htmlPaged の validPagedValue)
    if (!what) return !validPagedValue(prop, value);
    this.miss(msg(`${what} (--style ah のときだけ解釈する値)`, `${what} (a value read only with --style ah)`));
    return true;
  }

  /** 継承する指定を、ブラウザの確定値 → 自前で読んだ指定 (祖先をたどる) の順に読む */
  private inh(el: Element, prop: string, pagedFirst = false): string {
    const v = pagedFirst ? '' : this.cs(el)(prop);
    if (v) return v;
    const found = this.pagedInherited(el, prop);
    if (found) return found;
    return pagedFirst ? this.cs(el)(prop) : '';
  }

  /** inh の、祖先をたどって自前で読んだ指定を探した結果 (性質ごと・要素ごとに覚える) */
  private inhMemo = new Map<string, WeakMap<Node, string>>();
  /**
   * 要素とその祖先のうち、いちばん近い、自前で読んだ指定 (style 属性の宣言も。pg) のある要素の値 (無ければ '')。
   * 要素ごとに祖先を根までたどると、深い入れ子 (128 段) の要素が多い文書で、段数 × 要素の数 × 性質の数の手間になった
   * (<b><i><a><font> × 3 万で 4 秒)。たどった要素の答えを覚える (読み込みの間、要素の指定と木の形は変わらない)
   */
  private pagedInherited(el: Element, prop: string): string {
    let memo = this.inhMemo.get(prop);
    if (!memo) this.inhMemo.set(prop, (memo = new WeakMap()));
    const chain: Node[] = [];
    let found = '';
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      const known = memo.get(e);
      if (known !== undefined) {
        found = known;
        break;
      }
      chain.push(e);
      // style 属性の宣言も見る (pg が読む)
      const p = this.pg(e as Element)[prop];
      if (p) {
        found = p.trim().toLowerCase();
        break;
      }
    }
    for (const e of chain) memo.set(e, found);
    return found;
  }

  /** 和文の字間の指定 (text-autospace・text-spacing-trim・text-spacing・hanging-punctuation) */
  private spacing(el: Element): { autospace?: boolean; autospaceKinds?: 'all' | 'alpha' | 'numeric'; autospacePunct?: boolean; autospaceReplace?: boolean; squeeze?: boolean; trimStart?: boolean; trimStartExceptFirst?: boolean; trimEnd?: boolean; trimAll?: boolean; hang: boolean; hangFirst: boolean } {
    // 自前で読んだ指定 (アンテナハウスの -ah- を含む) を先に見る。ブラウザは、指定が無くても normal を返すため
    let as = this.inh(el, 'text-autospace', true);
    // none は CSS Text 4 の値に無い (無効な宣言として無視する)。アンテナハウス互換では、空きを入れない
    if (as === 'none') as = this.opts.jaDefaultsAh ? 'no-autospace' : '';
    let tr = this.inh(el, 'text-spacing-trim', true);
    const ts = this.inh(el, 'text-spacing', true);
    if (ts === 'none') [as, tr] = ['no-autospace', 'space-all'];
    else if (ts && ts !== 'normal') {
      // text-spacing の <spacing-trim> の語は text-spacing-trim に、<autospace> の語は text-autospace にする (CSS Text 4 §8.6)
      const words = ts.split(/\s+/);
      const asw = words.filter((w) => !SPACING_TRIM_WORD.test(w));
      if (asw.includes('no-autospace')) as = 'no-autospace';
      else if (asw.length) as = asw.join(' ');
      const trims = words.filter((w) => SPACING_TRIM_WORD.test(w));
      if (trims.length) tr = trims.join(' ');
    }
    // text-spacing-trim (CSS Text 4 §8.5)。位置ごとの組み方 (parseSpacingTrim) を、行組みの指定にする:
    //  - 行頭: trim は全角の始め括弧類を二分に。space-first は、段落の 1 行目と強制改行の後の行は全角、ほかは二分
    //    (§8.5 の要約の表「spaced first line, trim others」。本文の「Otherwise as space-start」は、この表・値の目的の説明と食い違うので、表に従う)
    //  - 隣り合う約物: trim は詰める (§8.5.2)、space は詰めない
    //  - 行末: trim は終わり括弧類・句読点を二分に。allow-end (入らないときだけ二分) と space-end は、全角のまま
    //  - trim-all: 位置・前後の字によらず、全角の括弧類・中点類・句読点類を二分にする (§8.5.2)
    //  - auto: 利用者エージェントが選ぶ値。Kumiori は初期値の normal と同じにする
    const st = tr ? parseSpacingTrim(tr.trim() === 'auto' ? 'normal' : tr) : undefined;
    // <autospace> = no-autospace | [ ideograph-alpha || ideograph-numeric || punctuation ] || [ insert | replace ] (CSS Text 4 §8.4)。
    // normal は ideograph-alpha ideograph-numeric と同じ。auto は利用者エージェントが選ぶ値で、normal と同じにする。
    // 片方だけを書けば、その種類の字との間だけに空ける。punctuation だけ (と insert・replace だけ) なら、和字との間には空けない
    // punctuation はフランス語の約物の前後の空き (この段階の仕様はフランス語だけに効く。内容の言語が fr の要素だけに付ける。TextStyle.textAutospacePunct)。
    // replace は、空きを入れる所の U+0020 を取り除いて、その空きにする (insert は、空白の字があれば空けない。初期値)
    const asWords = as && !/^(normal|auto|no-autospace)$/.test(as) ? as.split(/\s+/) : undefined;
    const alpha = !asWords || asWords.includes('ideograph-alpha');
    const numeric = !asWords || asWords.includes('ideograph-numeric');
    const fr = /^fr(-|$)/i.test(this.langOf(el) ?? '');
    return {
      ...(as ? { autospacePunct: !!asWords?.includes('punctuation') && fr, autospaceReplace: !!asWords?.includes('replace') } : {}),
      ...(as ? { autospace: as !== 'no-autospace' && (alpha || numeric) } : {}),
      ...(as && as !== 'no-autospace' && (alpha || numeric) ? { autospaceKinds: alpha && numeric ? ('all' as const) : alpha ? ('alpha' as const) : ('numeric' as const) } : {}),
      ...(st?.all
        ? { squeeze: true, trimStart: false, trimStartExceptFirst: false, trimEnd: false, trimAll: true }
        : st
          ? { squeeze: st.adjacent === 'trim', trimStart: st.start !== 'space', trimStartExceptFirst: st.start === 'first', trimEnd: st.end === 'trim', trimAll: false }
          : {}),
      hang: /allow-end|force-end/.test(this.inh(el, 'hanging-punctuation', true)),
      hangFirst: /(^|\s)first(\s|$)/.test(this.inh(el, 'hanging-punctuation', true)),
    };
  }

  /** 圏点の記号 (text-emphasis-style)。無ければ undefined */
  private emphasisMark(el: Element, vertical: boolean): string | undefined {
    const v = this.cs(el)('text-emphasis-style');
    if (!v || v === 'none') return undefined;
    // 文字列の圏点: 最初の書記素クラスタだけを使う (CSS Text Decoration 4 §3.1 の <string>: 2 つ以上の書記素クラスタの
    // 文字列は、切り詰めても無視してもよい。ブラウザも最初の 1 つだけを描く)。文字列をまるごと各字に付けると、500 字の文字列と
    // 5000 字の本文 (6KB) で 250 万字を組むことになり、メモリを使い切った
    if (/^["']/.test(v)) return firstGrapheme(unquote(v)) || undefined;
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
    // 圏点の側 (text-emphasis-position。Text Decoration 3 §3.4): 横書きは over (上)・under (下)、縦書きは right (右)・left (左。省略は right)。
    // 圏点は、字ごとのルビとして置く (§3.4: 字ごとに、圏点をそのルビの注釈の字として付けたのと同じに置く) ので、
    // 下・左は 2 段目のルビの側に置く。
    // vertical-lr: 右・左は物理の向き (§3.4)。右 (省略のときも) は行の並ぶ向きの後ろ側、左は前の側なので、ルビと同じく側を入れ替えて渡す
    // (LRuby.rubyPosition: 'under' = 注釈を後ろ側に置く。行の高さへの効き方はルビと同じ: §3.4・CSS Ruby 1 §3.6)
    const cs = this.cs(el);
    const wmv = cs('writing-mode');
    const pos = mark ? cs('text-emphasis-position') : '';
    const lr = /vertical-lr|sideways-lr/.test(wmv);
    const under = vertical ? /(^|\s)left(\s|$)/.test(pos) && !lr : /(^|\s)under(\s|$)/.test(pos);
    const afterLr = lr && !/(^|\s)left(\s|$)/.test(pos);
    // 圏点の色 (text-emphasis-color。§3.2): 初期値 currentcolor は字の色 (色を付けない)。見えない要素 (visibility) の圏点には付けない
    const ec = mark ? cs('text-emphasis-color') : '';
    const markColor = ec && ec !== cs('color') && !/^(hidden|collapse)$/.test(cs('visibility')) ? visibleColorOf(ec) : undefined;
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
          if (afterLr) out.push({ type: 'ruby', baseText: ch, rubyText: mark, rubyPosition: 'under', ...(markColor ? { rubyColor: markColor } : {}) });
          else if (under) out.push({ type: 'ruby', baseText: ch, rubyText: '', rubyTextUnder: mark, ...(markColor ? { rubyColorUnder: markColor } : {}) });
          else out.push({ type: 'ruby', baseText: ch, rubyText: mark, ...(markColor ? { rubyColor: markColor } : {}) });
        } else buf += ch;
      }
    }
    flush();
    // タグ付き PDF: 圏点の親文字は、まわりの構造の字のまま、点は飾り (Artifact)
    if (this.sb) for (const r of out) if (typeof r === 'object' && r.type === 'ruby') this.sb.ruby(r, this.st(el), 0, true);
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
      const n = (this.isBlock(d, it.el) ? this.block(it.el, el) : undefined) ?? ({ type: 'block', ...this.textStyle(it.el, el), ...this.boxStyle(it.el), children: this.flexItemInline(it.el, el, false) } as LBlock);
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
    return { type: fixed ? 'block-container' : 'block', ...this.textStyle(el, parent), ...this.paragraphStyle(el, parent), ...this.boxStyle(el), ...this.flexCbOf(el), children: [...extra, ...children] } as LBlock;
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
      for (const k of this.flexItemSources(el).filter((x) => !x.ps).map((x) => x.el)) {
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
    const extra: LBlockLevel[] = [];
    /** 項目: 子の要素か ::before・::after (ps)。node は組んだ中身 (文書の順に組む: カウンターの値が文書の順になるように) */
    type Item = { el: Element; ps?: '::before' | '::after'; anon?: boolean; node: LBlockLevel; text?: string; order: number; collapse?: boolean; fit?: boolean; ortho?: boolean };
    const items: Item[] = [];
    let pseudoSeen = false;
    for (const src of srcs) {
      const k = src.el;
      if (src.text !== undefined) {
        // 無名の項目: 文字の並びを包むブロック。字の書式は持ち主から受け継ぐ (持ち主が容器なら、容器の箱が持つ)
        const fi: FlowItem[] = this.decorateText(this.text(src.text, k), k).map((v) => ({ v, block: false }));
        const children = this.collapseFlowWhitespace(fi, this.cs(k)('white-space'));
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
      // 行内の要素 (span・a など) の項目は、ブロック化する (Flexbox 1 §4・CSS Display 3 §2.7)。罫線・内側の余白・背景・余白は項目の箱
      // (boxStyle) に付けるので、中身の行内の箱からは外す (外さないと、罫線が二重に描かれ、行内の罫線・余白の分だけ中身が項目の幅を超えて折り返される)
      // 項目の page (名前付きのページ) では、ページを切り替えない (未対応として知らせる)
      this.pageIgnored(k, ['flex・grid の項目', 'flex and grid items']);
      const node = (this.isBlock(d, k) ? this.block(k, el) : undefined) ?? ({ type: 'block', ...this.textStyle(k, el), ...this.boxStyle(k), children: this.flexItemInline(k, el, true) } as LBlock);
      // flex の項目の百分率の寸法は、包含ブロック (flex の容器) の幅が基準 (CSS Flexbox 1 §4.2・§7.2.3)。項目を入れたセルの幅ではないので、
      // 組むときに解き直さない (幅は、下で列の幅に使った見積もり)。grid の項目の包含ブロックは grid の領域 (CSS Grid 2 §6.2) で、それは
      // 項目を入れたセルなので、組むときに解く
      if (!isGrid) delete (node as BoxStyle).percent;
      // 画像そのものが flex の項目: 百分率の幅・上限・下限は、項目のセルの幅を決めるときに、容器の幅で解いてある。画像は、そのセルの幅で描く
      // (セルの幅で、百分率をもう 1 度解かない。Flexbox 1 §9.2・CSS 2.1 §10.2: 基準は flex の容器)
      if (!isGrid) imageFillsItem(node, k, false, parseFloat(kc('flex-grow')) > 0 || /%/.test(kc('flex-basis')));
      // visibility: collapse の flex の項目 (Flexbox 1 §4.4): 主軸の大きさを 0 にして、交差軸の大きさだけを支柱として残す (下の行の組み立て)。
      // grid の項目の collapse は hidden と同じ (場所を残す。CSS 2.1 §11.2)
      // 書字方向が容器と直交する項目 (横書きの行の中の縦書きの箱など。block() が writingMode を付けたブロック): 主軸の大きさは項目の block の大きさ
      const ortho = !isGrid && node.type === 'block' && !!node.writingMode && (node.writingMode === 'horizontal-tb') === vert;
      items.push({ el: k, node, order: parseInt(kc('order'), 10) || 0, ...(src.collapse && !isGrid ? { collapse: true } : {}), ...(ortho ? { ortho: true } : {}) });
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
    /**
     * 行の 1 列: 項目 (el) か空き。w は固定の幅 (pt)、star があれば比例の列 (組版時の容器の幅の余りを star の比で分け、w を足す。表の 'N*' + widthExtra)。
     * grid の行の列は、占める grid の列の範囲 (span) か、間隔の列 (gap)。幅は、組版エンジンが、表を置くときの内容の幅で決める (w は見積もりの幅での値)
     */
    /** collapse の項目の支柱のもと: 畳む前の組みで同じ行にあった項目と、その幅 (同じ行の支柱どうしで分け合う) */
    type StrutLine = Array<{ el: Item; w: number }>;
    type Cell = { el?: Item; w: number; star?: number; strut?: StrutLine; flex?: LFlexItemColumn; late?: LFlexItemColumn; pct?: LTableColumn['percentWidth']; span?: [number, number]; gap?: boolean };
    const lines: Cell[][] = [];
    let gridTemplate: LTable['gridTemplate'];
    /** grid の項目の、列の下限への寄与のもと (floorOf。行の表を作るときに、項目のセルと一緒に gridTemplate.items に入れる) */
    let itemFloors: Map<Item, Omit<GridItemFloor, 'col' | 'cell'>> | undefined;
    /** gridTemplate.items (列挙しない性質: setGridItems) */
    let gridItems: GridItemFloor[] | undefined;
    if (isGrid) {
      const tpl = c('grid-template-columns');
      const count = gridTracks(tpl, W, colGap).length;
      const spanOf = (k: Item) => Math.min(count, parseInt(/span\s+(\d+)/.exec(ics(k)('grid-column-start') + ' ' + ics(k)('grid-column-end'))?.[1] ?? '1', 10) || 1);
      // 項目の自動の最小の大きさ (CSS Grid 1 §6.6) を、列の下限 (0fr の列の幅と、最小の大きさが auto の列 (fr・auto・minmax(auto, …) など) の
      // 基準の大きさ: §12.5・§12.7.1。容器が狭くても、列を中身より狭くして字を重ねない) に使うか。決まった幅の列だけなら使わない。
      // 下限は、組版エンジンが、組むときと同じ折り返しで、項目の中身を測って決める (LTable.gridTemplate.items。ここでの見積もりは、
      // 空白でしか折らず、百分率の幅を見積もりの幅で解くので、使わない)
      const wantFloor = /(^|[\s(])0*\.?0*fr\b/.test(tpl) || !!gridTrackPlan(tpl, W, colGap)?.fixed.some((x) => x === undefined);
      /**
       * 項目の、測らずに決まる下限・上限 (外側の幅。CSS Grid 1 §6.6): min-width の指定があれば、それ。overflow が visible でない項目
       * (スクロールの容器) の自動の最小の大きさは 0。width が長さで決まっていれば、その幅 (specified size suggestion)。
       * どれでもなければ、中身を測る (content size suggestion = min-content)。max-width の長さは、どちらも抑える
       */
      const floorOf = (k: Item): Omit<GridItemFloor, 'col' | 'cell'> => {
        const kc = ics(k);
        const o = outer(k);
        // 百分率の width・min-width・max-width (計算値は、見積もりの幅で長さにしてある: isPercent) は、列の大きさを決める間は基準 (grid の領域) が
        // 決まらないので auto (上限は none) と同じ (CSS Sizing 3 §5.2.1)
        const pct = (p: 'width' | 'min-width' | 'max-width') => /%/.test(kc(p)) || (!k.anon && !k.ps && !!this.src.isPercent?.(k.el, p));
        const mw = kc('min-width');
        if (mw && mw !== 'auto' && !pct('min-width')) return { floor: (len(mw, W) ?? 0) + o };
        if (!/^(visible|clip)?$/.test(kc('overflow-x') || kc('overflow'))) return { floor: o };
        const mx = pct('max-width') ? undefined : cssLen(kc('max-width'));
        const cap = mx !== undefined ? mx + o : undefined;
        const wv = kc('width');
        const wl = wv && wv !== 'auto' && !pct('width') ? cssLen(wv) : undefined;
        // 項目そのものが縮められる置換要素 (img・object) で、max-width が百分率 (既定の img { max-width: 100% } も): 大きさの提案は max-width で
        // 抑えるが (§6.6 の終わり)、その百分率は、列の大きさを決める間は 0 で解く (CSS Sizing 3 §5.2.2) ので、決まった幅 (属性の幅も) を下限に
        // しない。中身を測る (画像の min-content の寄与は、同じく 0)
        const shrinkable = !k.anon && !k.ps && /^(img|object)$/.test(k.el.localName) && pct('max-width');
        if (wl !== undefined && !shrinkable) return { floor: Math.min(wl + o, cap ?? Infinity) };
        return cap !== undefined ? { cap } : {};
      };
      itemFloors = wantFloor ? new Map<Item, Omit<GridItemFloor, 'col' | 'cell'>>(items.map((k) => [k, floorOf(k)])) : undefined;
      // repeat(auto-fill | auto-fit, …) の回数は、ここで見た W (読み込みのときの、容器の内容の幅の見積もり) で 1 度だけ決める
      // (CSS Grid 1 §7.2.3.2)。行に何個の項目を並べるかは、ここで決まるので、組むときに容器の幅が見積もりと違っても、回数は変えない
      const rep: { times?: number } = {};
      const tracks = gridTracks(tpl, W, colGap, undefined, rep);
      // 列の幅は、組版エンジンが、行の表を置くときの内容の幅 (容器の実際の内容の幅) で gridTracks を呼んで決める (LTable.gridTemplate)。
      // 容器の幅が W なら、ここで見た tracks と同じ幅。float・inline-block・flex の項目・表のセルの中のように、容器の幅が W と違っても、
      // 列は、その幅で分け直す (fr の列は、容器の幅の余りを分け、minmax() の最小の大きさより狭くならず、最大の大きさより広がらない。
      // 百分率の列は、容器の幅 × 比。CSS Grid 1 §7.2.1・§12)。間隔の百分率も、組むときの幅で解く (CSS Box Alignment 3 §8.1)
      const gapPct = /^[\d.]+%$/.test(c('column-gap').trim()) ? parseFloat(c('column-gap')) / 100 : undefined;
      gridTemplate = { tracks: tpl, gap: colGap, ...(gapPct !== undefined ? { gapPct } : {}), ...(rep.times !== undefined ? { repeat: rep.times } : {}) };
      if (itemFloors) setGridItems(gridTemplate, (gridItems = []));
      /**
       * 列 [from, to) を 1 つのセルにした列 (w は、見積もりの幅での幅)。幅の和は範囲ごとに 1 度だけ足す
       * (列は上限 MAX_GRID_REPEAT まであり、多くの項目が広い範囲を占めると、項目の数 × 範囲の列の数の手間になる。足す順は同じ)
       */
      const spanW = new Map<string, number>();
      const span1 = (from: number, to: number): Cell => {
        const key = `${from},${to}`;
        let w = spanW.get(key);
        if (w === undefined) spanW.set(key, (w = tracks.slice(from, to).reduce((a, b) => a + b, 0) + colGap * Math.max(to - from - 1, 0)));
        return { w, span: [from, to] };
      };
      let line: Cell[] = [];
      let col = 0;
      for (const k of items) {
        const span = spanOf(k);
        if (col + span > tracks.length) {
          lines.push(line);
          line = [];
          col = 0;
        }
        if (line.length && (colGap > 0 || gapPct)) line.push({ w: colGap, gap: true });
        line.push({ el: k, ...span1(col, col + span) });
        col += span;
      }
      if (line.length) lines.push(line);
    } else {
      /**
       * 項目の百分率 (calc の線形の和も) の max-width (既定のスタイルの img { max-width: 100% } も): 比 (f) と、外側の幅に足す分 (edge。
       * 余白・枠・内側の余白と、長さの部分)。百分率の基準は flex の容器の内容の幅なので、組むときに、実際の容器の幅で解く (CSS 2.1 §10.4)。
       * 百分率でなければ undefined
       */
      const pctMaxOf = (k: Item, kc: (n: string) => string): { f: number; edge: number } | undefined => {
        const margins = (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0);
        const mxv = kc('max-width');
        // 百分率 (calc の線形の和も) の max-width: 比と長さの部分 (StyleSource.percentOf)
        const mp = this.src.percentOf?.(k.el, 'max-width');
        const f = mp ? mp.f : /^[\d.]+%$/.test(mxv) ? parseFloat(mxv) / 100 : undefined;
        return f === undefined ? undefined : { f, edge: (kc('box-sizing') === 'border-box' ? margins : outer(k)) + (mp ? mp.px * PT_PER_PX : 0) };
      };
      /**
       * 縮める下限 (外側の幅)。min-width: auto は自動の最小の大きさ (Flexbox 1 §4.5): 中身の最も狭い幅 (min-content。max-width で抑える) と、
       * 幅の指定があればその小さい方。overflow が visible でない (切り取る・流す) 項目は 0。min-width の指定があれば、それ
       */
      const minOf = (k: Item, kc: (n: string) => string, fixedW: boolean): { floor: number; minCap?: number; minAuto?: boolean; replacedMin?: LFlexItemColumn['replacedMin'] } => {
        const margins = (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0);
        const mw = kc('min-width');
        if (mw && mw !== 'auto') return { floor: (len(mw, W) ?? 0) + outer(k) };
        if (!/^(visible|clip)?$/.test(kc('overflow-x') || kc('overflow'))) return { floor: outer(k) };
        // 項目が画像そのもの: 自動の最小の大きさは、指定の幅か本来の幅 (中身の大きさの候補は置換要素の min-content の大きさ。Flexbox 1 §4.5)。
        // 指定の幅・max-width で抑える。max-width の百分率の基準は flex の容器なので、組むときに容器の内容の幅で解き直す (LFlexItemColumn.replacedMin)。
        // 中身の最も狭い幅の寄与 (縮められる置換要素の 0。CSS Sizing 3 §5.2.2) は、項目を包むブロックの中の画像のもの
        if (!k.anon && !k.ps && k.el.localName === 'img') {
          const content = measure(() => this.maxContentWidth(k.el)) + margins;
          const bb = kc('box-sizing') === 'border-box';
          const mxv = kc('max-width');
          const pm = pctMaxOf(k, kc);
          const maxPct = pm?.f;
          const maxEdge = pm?.edge;
          const capOf = (v: string) => {
            const n = len(v, W);
            return n === undefined ? undefined : n + (bb ? margins : outer(k));
          };
          const caps = [capOf(mxv), fixedW ? capOf(kc('width')) : undefined].filter((v): v is number => v !== undefined);
          const minCap = caps.length ? Math.min(...caps) : undefined;
          // 組むときに解き直す百分率の max-width は、cap に入れない
          const fixedCap = maxPct !== undefined ? (fixedW ? capOf(kc('width')) : undefined) : minCap;
          return {
            floor: Math.min(content, minCap ?? Infinity),
            replacedMin: { ...(fixedCap !== undefined ? { cap: fixedCap } : {}), ...(maxPct !== undefined ? { maxPct, maxEdge } : {}) },
          };
        }
        const content = k.anon ? measure(() => this.minTextWidth(k.text ?? '', k.el)) : k.ps ? measure(() => this.minTextWidth(k.text ?? '', k.el, k.ps)) + (outer(k) - margins) : measure(() => this.minContentWidth(k.el, false));
        // 中身の最も狭い幅の上限 (外側の幅): max-width と、幅の指定 (自動の最小の大きさは、指定の大きさを超えない)
        const max = len(kc('max-width'), W);
        const specified = fixedW ? len(kc('width'), W) : undefined;
        const caps = [max, specified].filter((v): v is number => v !== undefined).map((v) => v + (kc('box-sizing') === 'border-box' ? 0 : outer(k) - margins) + margins);
        const minCap = caps.length ? Math.min(...caps) : undefined;
        return { floor: Math.min(content + margins, minCap ?? Infinity), minAuto: true, ...(minCap !== undefined ? { minCap } : {}) };
      };
      /** 項目の幅の基準 (w: flex-basis、無ければ width。分からなければ undefined)・伸び縮みの比と下限・上限。strut は collapse の項目の本来の幅 */
      /** hypo: 縮める前の幅 (仮の主軸の大きさ。外側の幅)・mins: 縮める下限の求め方 (組版エンジンに測らせるとき。LFlexItemColumn) */
      type Info = { el: Item; w: number | undefined; hypo?: number; grow: number; shrink: number; base: number; floor: number; mins?: { minAuto?: boolean; minCap?: number; replacedMin?: LFlexItemColumn['replacedMin'] }; cap?: number; capPct?: LFlexItemColumn['capPct']; pct?: LTableColumn['percentWidth']; orig?: Info };
      const info = items.map((k): Info => {
        const kc = ics(k);
        // flex-basis: auto は width を使う (Flexbox 1 §7.2.3)。width が内容による大きさの語 (CSS Sizing 3 §3.2) なら、その語を基準にする
        const b0 = kc('flex-basis');
        const wKw = (kc('width') || '').trim().toLowerCase();
        const b = (!b0 || b0 === 'auto') && /^(min-content|max-content|fit-content)$/.test(wKw) ? wKw : b0;
        // ::before・::after は、幅の指定が長さか % なら、それ
        const fixedW = k.ps || k.anon ? kc('width') !== 'auto' && len(kc('width'), W) !== undefined : autoOf(k.el, 'width') === false;
        // flex-basis の min-content は中身の最も狭い幅、max-content・content は中身の幅 (下の見積もり)、fit-content は中身の幅を容器の幅で抑えたもの
        // (Flexbox 1 §7.2.3・CSS Sizing 3 §2.1)。枠・内側の余白を含む見積もりなので、内容の幅に直す
        const kwBasis = b === 'min-content' ? (k.anon ? measure(() => this.minTextWidth(k.text ?? '', k.el)) : k.ps ? measure(() => this.minTextWidth(k.text ?? '', k.el, k.ps)) : measure(() => this.minContentWidth(k.el, false))) : undefined;
        const basis = kwBasis !== undefined ? Math.max(0, kwBasis - (outer(k) - (cssLen(kc('margin-left')) ?? 0) - (cssLen(kc('margin-right')) ?? 0))) : b && b !== 'auto' && !/content$/.test(b) ? len(b, W) : /content$/.test(b) ? undefined : fixedW ? len(kc('width'), W) : undefined;
        const max = len(kc('max-width'), W);
        const inner = basis === undefined ? undefined : max !== undefined ? Math.min(basis, max) : basis;
        // flex-basis も width も無い項目は、中身の幅 (max-content) の見積もり。flex: 1 (basis 0) の項目は 0 から伸びる
        // 書字方向が容器と直交する項目の中身の幅 (max-content の主軸の大きさ) は、項目を組んだ後の block の大きさ (行の数の幅。
        // CSS Writing Modes 3 §7.3 の Note・Flexbox 1 §9.2 の 3)。読み込みのときには分からないので、列の幅を組版エンジンに測らせる
        // (LTableColumn.fitContent)。ここの見積もり (1 行の幅) は、行に分けるとき・縮めるときの目安にだけ使う
        if (inner === undefined && k.ortho) k.fit = true;
        const est =
          inner === undefined && k.ortho
            ? Math.min(this.orthogonalItemEstimate(k.el, kc, autoOf(k.el, 'height') !== false), max ?? Infinity, W)
            : inner === undefined
            ? Math.min(k.anon ? measure(() => this.textWidth((k.text ?? '').replace(CSS_WS, ' '), k.el)) : k.ps ? measure(() => this.pseudoMaxContentWidth(k.el, k.ps!, k.text ?? '')) : measure(() => this.maxContentWidth(k.el)), max ?? Infinity, W)
            : undefined;
        // 見積もりは枠・内側の余白を含むので、足すのは外側の余白だけ
        const margins = (cssLen(kc('margin-left')) ?? 0) + (cssLen(kc('margin-right')) ?? 0);
        const shrink = parseFloat(kc('flex-shrink'));
        // 中身の幅で決まる項目は、列の幅を組版エンジンに測らせる (LTableColumn.fitContent。Flexbox 1 §9.2 の 3 の E)。
        // ここの見積もり (字の幅の足し算) は、行を組むときの字の間の空白・行内の箱の余白と枠・::before の中身・語間・ページ番号の引用の字などを
        // 数えきれず、見積もりが狭いと、最後の字が次の行に送られる (目次の項目名)。見積もりは、行に分けるとき (flex-wrap) の目安と、測れないときの幅にだけ使う
        if (inner === undefined && est !== undefined) k.fit = true;
        const mins = minOf(k, kc, fixedW);
        let w = inner !== undefined ? inner + outer(k) : est !== undefined ? est + margins : undefined;
        // 画像そのものの項目の仮の主軸の大きさは、flex-basis (百分率・0 も) を、自動の最小の大きさ (本来の幅か指定の幅。max-width で抑える) で
        // 下から抑えたもの (Flexbox 1 §9.2 の 3 の E・§4.5)。flex: 0 0 30% の画像は、本来の幅より狭くしない (前は、セルが basis の幅で、
        // 画像が本来の幅 (0.3.0) か、basis の幅に縮んで描かれていた)。百分率の max-width は、ここでは見積もりの幅で解く
        if (mins.replacedMin && w !== undefined && inner !== undefined) {
          const rm = mins.replacedMin;
          const capPct = rm.maxPct !== undefined ? rm.maxPct * W + (rm.maxEdge ?? 0) : Infinity;
          w = Math.max(w, Math.min(mins.floor, capPct));
        }
        const own: Info = {
          el: k,
          w,
          hypo: w,
          grow: parseFloat(kc('flex-grow')) || 0,
          shrink: Number.isFinite(shrink) && shrink >= 0 ? shrink : 1,
          // 縮める比の基準 (flex の基準の大きさ) と、縮める下限 (min-width と、内容の幅以外の分)
          base: inner ?? est ?? 0,
          floor: mins.floor,
          mins,
          // 伸ばす上限 (外側の幅。max-width が無ければ無し)
          cap: max !== undefined ? max + outer(k) : undefined,
          // 画像そのものの項目の、百分率の max-width (組むときに、実際の容器の幅で解く。LFlexItemColumn.capPct)。min-width・overflow で
          // 自動の最小の大きさを外した項目 (replacedMin の無い項目) も
          ...(!k.anon && !k.ps && k.el.localName === 'img' ? { capPct: pctMaxOf(k, kc) } : {}),
        };
        // 百分率の flex-basis (auto なら width) の項目 (画像そのもの・上限のあるもの・伸びるものは除く): 基準は flex の容器の内容の幅なので、
        // 組むときに、実際の容器の幅で解き直す (LTableColumn.percentWidth。Flexbox 1 §7.2.3・§9.2 の 3 の A)。幅の決まらない所 (float・inline-block・
        // 幅の auto の表のセルなど) の容器の中身の幅を測るときは、循環する百分率なので auto (中身の幅) として扱う (CSS Sizing 3 §5.2.1)
        if (!k.anon && !k.ps && k.el.localName !== 'img' && kwBasis === undefined && inner !== undefined && max === undefined && !own.grow && !mins.replacedMin) {
          const pb = b && b !== 'auto' ? this.src.percentOf?.(k.el, 'flex-basis') : fixedW ? this.src.percentOf?.(k.el, 'width') : undefined;
          if (pb && pb.f > 0 && (kc('box-sizing') !== 'border-box' || (b && b !== 'auto'))) own.pct = { f: pb.f, edge: pb.px * PT_PER_PX + outer(k), ...(b && b !== 'auto' ? { basis: true as const } : {}) };
        }
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
        // 中身に合わせる列 (組むときに測る項目) のある行は、項目を縮める前の幅で並べ、入りきらなければ組版エンジンが縮め直す
        // (LTableColumn.flexItem。ここで見積もりから縮めた幅は、測った幅と食い違う)。縮めずに済んだ項目は、伸ばす上限で止めた幅のまま
        const engineShrinks = g.some((it) => it.el.fit && !it.el.collapse);
        const flexOf = (it: Info): LFlexItemColumn => {
          const edge = outer(it.el);
          return { shrink: it.shrink, basis: it.base, edge, floor: it.floor, ...(it.mins?.minAuto ? { minAuto: true } : {}), ...(it.mins?.minCap !== undefined ? { minCap: it.mins.minCap } : {}), ...(it.mins?.replacedMin ? { replacedMin: it.mins.replacedMin } : {}), ...(it.cap !== undefined ? { cap: it.cap } : {}), ...(it.capPct ? { capPct: it.capPct } : {}) };
        };
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
          const w = engineShrinks && it.hypo !== undefined ? Math.max(it.w ?? 0, it.hypo) : (it.w ?? 0);
          // 組むときの容器の幅で縮め直す (late) のは、1 行の容器 (nowrap) だけ。折り返す容器は、行に分けたのが見積もりの幅 W なので、
          // 狭い所で縮めて 1 行に詰めると、折り返すべき項目が詰まる (Flexbox 1 §9.3)。折り返しは W のまま (組むときの幅で分け直さない)
          const late = !this.src.rect && c('flex-wrap') === 'nowrap';
          line.push({ el: it.el, w, ...(stars[k] ? { star: stars[k] } : {}), ...(engineShrinks ? { flex: flexOf(it) } : late ? { late: flexOf(it) } : {}), ...(it.pct && !stars[k] && (engineShrinks || late) ? { pct: it.pct } : {}) });
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
    // WeasyPrint の組み方 (flexSingleLineFullWp): 折り返しの容器の 1 つだけの行も、align-content に関わらず容器の高さにする
    const fullLine = !isGrid && lines.length === 1 && innerH !== undefined && innerH > 0 && (c('flex-wrap') === 'nowrap' || ac0 === 'normal' || ac0 === 'stretch' || !!this.opts.flexSingleLineFullWp);
    // 高さの決まった複数行の容器の align-content: stretch (normal も同じ): 余った高さを行に等しく分ける (Flexbox 1 §8.4・§9.4 の 15)。
    // 行の表に伸ばす比 1 を付け、組版エンジンが行とセルを伸ばす
    const stretchLines = fixed && lines.length > 1 && (ac0 === 'normal' || ac0 === 'stretch');
    const children: LBlockLevel[] = [];
    if (rtl) for (const line of lines) if (!line.some((cell) => cell.star)) line.push({ w: 0, star: 1 });
    /** 項目のセル: 行の中の縦の揃え・伸ばしを付ける */
    const itemCell = (item: Item): LTableCell => {
      const n = item.node;
      // 書字方向が容器と直交する項目: 主軸の大きさ (横書きの容器なら幅 = 項目の block の大きさ) は、組むときに列の幅にする (fillOrthogonal)。
      // 指定の大きさは消さない (列の幅を測るときの大きさ)
      if (item.ortho) (n as LBlock).fillOrthogonal = true;
      // ほかの項目は、主軸の大きさの指定 (横書きの容器なら width、縦書きの容器なら height) を消す: 主軸の大きさは列の幅で決まる。
      // 交差軸の大きさの指定 (縦書きの容器の項目の width) は残す
      else delete (n as LBlock)[L('width') as 'width' | 'height'];
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
      // 1 行の、交差軸の大きさの決まった容器の、伸ばす項目の交差軸の大きさは、容器の内側の大きさで、決まった大きさとして扱う (Flexbox 1 §9.8)。
      // 書字方向が容器と直交する項目では、交差軸が項目の行の向きなので、その大きさで行を折り返す (ほかの項目は、組んだ後で行の高さまで伸ばす)
      if (stretch && item.ortho && fullLine && innerH !== undefined) {
        const q = (p: string) => cssLen(ic(p)) ?? 0;
        const edges = (n as LBlock).boxSizing === 'border-box' ? 0 : q('padding-top') + q('padding-bottom') + q('border-top-width') + q('border-bottom-width');
        (n as LBlock)[L('height') as 'height' | 'width'] = Math.max(0, innerH - q('margin-top') - q('margin-bottom') - edges);
      }
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
      const columns: LTableColumn[] = line.map((cell) => ({
        type: 'table-column',
        ...(cell.star ? { width: `${cell.star}*` as const, ...(cell.w ? { widthExtra: cell.w } : {}) } : { width: Math.max(cell.w, 0) }),
        ...(cell.el?.fit ? { fitContent: true } : {}),
        ...(cell.flex ? { flexItem: cell.flex } : {}),
        ...(cell.late ? { flexLate: cell.late } : {}),
        ...(cell.pct ? { percentWidth: cell.pct } : {}),
        ...(cell.span ? { gridSpan: cell.span } : {}),
        ...(cell.gap ? { gridGap: true as const } : {}),
      }));
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
        const ic = itemCell(cell.el);
        // 1 列だけを占める項目は、その列の下限に数える (LTable.gridTemplate.items)
        const fl = itemFloors?.get(cell.el);
        if (fl && cell.span && cell.span[1] - cell.span[0] === 1) gridItems!.push({ col: cell.span[0], cell: ic, ...fl });
        return ic;
      });
      this.report.counts.tables++;
      const lineTable = { type: 'table', columns, ...(gridTemplate ? { gridTemplate } : { flexLine: true }), ...(stretchLines ? { flexGrow: 1 } : {}), ...(k > 0 && rowGap > 0 ? { margin: { top: rowGap } } : {}), body: { type: 'table-body', rows: [{ type: 'table-row', ...(fullLine ? { minHeight: innerH } : {}), cells }] } } as LTable;
      this.flexLineBreaks(lineTable, cells.filter((_, j) => !!line[j].el && !line[j].strut));
      children.push(lineTable);
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
    const out = { type: fixed ? 'block-container' : 'block', ...this.textStyle(el, parent), ...this.paragraphStyle(el, parent), ...this.boxStyle(el), ...(blockAlign ? { blockAlign } : {}), ...this.flexCbOf(el), children: [...extra, ...children] } as LBlock;
    // flex・grid の容器は、新しい整形文脈を作る (Flexbox 1 §3・CSS Grid 1 §5.1・CSS Display 3 §2.6 の independent formatting context):
    // 外の float に重ならず、その横の幅に縮む (CSS 2.1 §9.5。前は float の下に重ねて組んでいた)
    if (!fixed) out.bfc = true;
    this.flexContainerBreaks(out, children);
    return out;
  }

  /**
   * flex の行 (grid の行) を組む 1 行の表の、前後の区切り: 項目 (セルの中身) の break-before・break-after (項目の最初・最後の子へたどった値も)
   * は、その項目の並ぶ行の前後の区切りにする (CSS Flexbox 1 §12: 行の向きの flex の容器では、項目の break-before・break-after は flex の行へ伝わる。
   * CSS Grid 2 §12: grid の項目の値は、その項目の並ぶ grid の行へ伝わる。CSS Fragmentation 3 §3.1.1)。項目からは外す (残すと、その項目だけを
   * 次のページへ送り、兄弟の項目を前のページに残していた)。値どうしは §4.3 で合わせる (左右のページの指定は、後ろの項目の値)。
   * 避ける値は、どれかの項目が避けるなら、行の前 (後ろ) では分けない (§4.4 の Rule 1)。項目の break-inside の避ける値は、
   * その項目を分けない (行を分けない。新しいページにも入らなければ緩める: §4.4)
   */
  private flexLineBreaks(t: LTable, items: LTableCell[]) {
    const row = t.body.rows[0];
    let bb: BreakKind | undefined;
    let ba: BreakKind | undefined;
    let avB = false;
    let avA = false;
    for (const cell of items) {
      bb = mergeBreaks(bb, takeEdgeBreak(cell.children, 'before'));
      ba = mergeBreaks(ba, takeEdgeBreak(cell.children, 'after'));
      avB ||= !!this.edgeAvoidOf(cell.children, 'before');
      avA ||= !!this.edgeAvoidOf(cell.children, 'after');
      const n = cell.children.find((x) => typeof x !== 'string');
      if (n && typeof n !== 'string' && (n.type === 'block' || n.type === 'table') && n.keepTogether) {
        row.keepTogether = true;
        if (!this.opts.avoidRowOverflowAh) row.keepTogetherYields = true;
      }
    }
    if (bb) t.breakBefore = bb;
    if (ba) t.breakAfter = ba;
    const avoid = { ...(!bb && avB ? { before: 'all' as const } : {}), ...(!ba && avA ? { after: 'all' as const } : {}) };
    if (avoid.before || avoid.after) {
      this.edgeAvoids.set(t, avoid);
      if (avoid.before) t.keepWithPrevious = true;
      if (avoid.after) t.keepWithNext = true;
    }
  }

  /**
   * flex・grid の容器の、最初の行の前・最後の行の後ろの区切りは、容器の前後の区切り (CSS Flexbox 1 §12・CSS Grid 2 §12: 最初の行の
   * break-before・最後の行の break-after は、容器へ伝わる)。容器自身の値と合わせ (§4.3)、行からは外す。避ける値も伝える
   * (propagateEdgeAvoids が、容器自身の値と合わせる)
   */
  private flexContainerBreaks(out: LBlock, lines: LBlockLevel[]) {
    const first = lines[0] as LTable | undefined;
    const last = lines[lines.length - 1] as LTable | undefined;
    if (!first || !last) return;
    const bb = mergeBreaks(out.breakBefore, first.breakBefore);
    const ba = mergeBreaks(last.breakAfter, out.breakAfter);
    delete first.breakBefore;
    delete last.breakAfter;
    if (bb) out.breakBefore = bb;
    if (ba) out.breakAfter = ba;
    const avoid = { ...(!bb && first.keepWithPrevious ? { before: 'all' as const } : {}), ...(!ba && last.keepWithNext ? { after: 'all' as const } : {}) };
    if (avoid.before || avoid.after) this.edgeAvoids.set(out, avoid);
  }

  /** ::before・::after に content がある (none・normal でない) か */
  private hasPseudoContent(el: Element, which: '::before' | '::after'): boolean {
    const v = this.pagedPseudo.get(el)?.[which]?.content ?? this.cs(el, which)('content');
    return !!v && v !== 'none' && v !== 'normal';
  }

  /**
   * flex・grid の容器の項目の元 (文書の順): 子の要素と、中身のある ::before・::after (Flexbox 1 §4。疑似要素も項目になる)。
   * display: contents の子は自分の箱を作らないので、その子と疑似要素が項目になる (CSS Display 3 §2.5)。display: none は除く。
   * 直下の続いた文字の並び (display: contents の子の直下のものも) は、無名の項目 (text) にする
   */
  private flexItemSources(el: Element): Array<{ el: Element; ps?: '::before' | '::after'; text?: string; collapse?: boolean }> {
    const out: Array<{ el: Element; ps?: '::before' | '::after'; text?: string; collapse?: boolean }> = [];
    const walk = (e: Element): void => {
      if (this.hasPseudoContent(e, '::before')) out.push({ el: e, ps: '::before' });
      // 続いた文字の並び (空白だけのものは除く) は、無名の項目 (Flexbox 1 §4)。el は文字の持ち主 (display: contents の子の中ならその要素)
      let run = '';
      const flush = () => {
        if (!DOC_WS_ONLY.test(run)) out.push({ el: e, text: run });
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
        if (d === 'contents') walk(k);
        else out.push({ el: k, ...(this.cs(k)('visibility') === 'collapse' ? { collapse: true } : {}) });
      }
      flush();
      if (this.hasPseudoContent(e, '::after')) out.push({ el: e, ps: '::after' });
    };
    walk(el);
    return out;
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

  /**
   * 書字方向が flex の容器と直交する項目の、主軸の大きさの見積もり (pt。枠・内側の余白を含む): 行の数 × 行の送り。行の数は、項目の行の向きの
   * 大きさ (交差軸の大きさ) が決まっていれば、中身の字の長さをそれで割った数、決まっていなければ 1。
   * kc は、容器の書字方向で読み替えた項目の指定 (横書きの容器なら、そのまま)、crossAuto は交差軸の大きさが auto か
   */
  private orthogonalItemEstimate(el: Element, kc: (n: string) => string, crossAuto: boolean): number {
    const p = (n: string) => cssLen(kc(n)) ?? 0;
    const fs = cssLen(this.cs(el)('font-size')) ?? 12;
    const lh = cssLen(this.cs(el)('line-height')) ?? fs * 1.2;
    const cross = crossAuto ? undefined : cssLen(kc('height'));
    const inner = cross === undefined ? undefined : cross - (kc('box-sizing') === 'border-box' ? p('padding-top') + p('padding-bottom') + p('border-top-width') + p('border-bottom-width') : 0);
    const lines = inner !== undefined && inner > 0 ? Math.max(1, Math.ceil(this.textWidth((el.textContent ?? '').replace(CSS_WS, ' ').trim(), el) / inner - 0.001)) : 1;
    return lines * lh + p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
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
    // 折り返さない (text-wrap-mode: nowrap。white-space の nowrap・pre を含む: CSS Text 4 §3・§5.1)
    const nowrap = this.csA(el, pseudo)('text-wrap-mode') === 'nowrap';
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
    // 同じ行で直前にある字 (要素の境目をまたぐ和欧間アキを数える)
    let prev: AutospaceSide | undefined;
    // 行に字や箱がもうあるか (行頭の空白は消える)・まだ数えていない、詰めた後の空白 1 つの持ち主 (行末なら消え、続く字があれば数える。
    // 要素の境目をまたぐ空白も 1 つに詰める: CSS Text 3 §4.1.1)
    let filled = false;
    let pendingSpace: { el: Element; pseudo?: '::before' | '::after' } | undefined;
    const end = () => {
      widest = Math.max(widest, line);
      line = 0;
      prev = undefined;
      filled = false;
      pendingSpace = undefined;
    };
    /** 字や箱を置く前に、待たせていた空白を数える */
    const flushSpace = () => {
      if (pendingSpace && filled) {
        line += this.spaceWidth(pendingSpace.el, pendingSpace.pseudo);
        prev = undefined;
      }
      pendingSpace = undefined;
    };
    const text = (t: string, owner: Element, pseudo?: '::before' | '::after') => {
      if (pre) {
        t.split('\n').forEach((part, k) => {
          if (k > 0) end();
          const tt = this.transformText(part, owner);
          line += this.textWidthPlain(tt, owner, pseudo, true) + this.autospaceWidthOf(tt, owner, pseudo, prev);
          if (!tt) return;
          filled = true;
          prev = this.autospaceSide(owner, pseudo, [...tt].pop()!);
        });
        return;
      }
      const tt = this.transformText(t.replace(CSS_WS, ' ').replace(/ {2,}/g, ' '), owner);
      if (!tt) return;
      if (tt.startsWith(' ') && filled && !pendingSpace) pendingSpace = { el: owner, ...(pseudo ? { pseudo } : {}) };
      const core = trimChars(tt, ' ');
      if (core) {
        flushSpace();
        // 中の空白は、textWidthPlain が字として測る。語間 (word-spacing) は、その空白ごとに足す
        line += this.textWidth(core, owner, pseudo, prev) + (core.split(' ').length - 1) * this.wordSpacing(owner, pseudo);
        filled = true;
        prev = this.autospaceSide(owner, pseudo, [...core].pop()!);
      }
      if (tt.endsWith(' ') && filled && !pendingSpace) pendingSpace = { el: owner, ...(pseudo ? { pseudo } : {}) };
    };
    /** 行内の箱の左右の余白・枠・内側の余白 (side: 始めか終わりか) */
    const edge = (e: Element, side: 'left' | 'right') => {
      const ec = this.csA(e);
      const v = (n: string) => Math.max(cssLen(ec(n)) ?? 0, 0);
      return v(`margin-${side}`) + v(`padding-${side}`) + v(`border-${side}-width`);
    };
    /** 置換要素・inline-block などの、中で行を分けない行内の箱: 中身の幅に左右の余白を足す */
    const atomic = (e: Element) => {
      flushSpace();
      const ec = this.csA(e);
      line += this.maxContentWidth(e) + (cssLen(ec('margin-left')) ?? 0) + (cssLen(ec('margin-right')) ?? 0);
      filled = true;
      prev = undefined;
    };
    const pseudoText = (e: Element, which: '::before' | '::after') => {
      const t = this.pseudoTextSeen.get(e)?.[which];
      if (t) text(t, e, which);
    };
    // 行内の要素は、それぞれの書体・字の大きさで測る (中の要素もたどる)。::before・::after の中身 (組んだときの字) も数える
    const inline = (k: Element) => {
      const l = edge(k, 'left');
      if (l) {
        flushSpace();
        line += l;
      }
      pseudoText(k, '::before');
      for (const n of Array.from(k.childNodes)) {
        if (n.nodeType === 3) text(n.textContent ?? '', k);
        else if (n.nodeType === 1) child(n as Element);
      }
      pseudoText(k, '::after');
      const r = edge(k, 'right');
      if (r) {
        line += r;
        prev = undefined;
      }
    };
    const child = (e: Element) => {
      const d = this.display(e);
      if (d === 'none' || /^(absolute|fixed)$/.test(this.csA(e)('position'))) return;
      if (this.isBlock(d, e)) {
        end();
        const ec = this.csA(e);
        widest = Math.max(widest, this.maxContentWidth(e) + (cssLen(ec('margin-left')) ?? 0) + (cssLen(ec('margin-right')) ?? 0));
      } else if (e.localName === 'br') end();
      else if (e.localName === 'img' || /^inline-/.test(d)) atomic(e);
      else inline(e);
    };
    pseudoText(el, '::before');
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) text(n.textContent ?? '', el);
      else if (n.nodeType === 1) child(n as Element);
    }
    pseudoText(el, '::after');
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
      else if (/^table-(header|footer|row)-group$/.test(d)) pushAll(rows, Array.from(k.children).filter((r) => this.display(r) === 'table-row'));
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
        const span = capSpan(Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
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

  /**
   * 1 行の文字列の幅 (pt)。measureText があれば要素の書体・字の大きさ・太さ・字間で測り、無ければ字数 × 字の大きさ (欧文は 0.55 倍)。
   * 和字と欧文の字・数字の間の和欧間アキ (text-autospace。CSS Text 4 §8.4) も足す (行を組むときの inlineLayout.ts の adjustJapaneseSpacing と同じ判定)。
   * アキを足さないと、見積もった幅 (flex の項目の max-content など) に、組んだ行が入りきらずに折り返される。
   * prev: 同じ行で直前にある字 (要素の境目をまたぐ組のアキを数える。maxContentWidth が渡す)
   */
  private textWidth(t: string, el: Element, pseudo?: '::before' | '::after', prev?: AutospaceSide): number {
    return this.textWidthPlain(t, el, pseudo) + this.autospaceWidthOf(t, el, pseudo, prev);
  }

  /**
   * 文字列の中 (と、prev との境目) の和欧間アキの合計 (pt)。アキの大きさは、両側の字の大きさの小さい方 × textAutospaceWidth
   * (inlineLayout.ts の adjustJapaneseSpacing)。両側の text-autospace が有効なときだけ空ける。空白の字 (語間の空白) の前後は空けない
   */
  private autospaceWidthOf(t: string, el: Element, pseudo?: '::before' | '::after', prev?: AutospaceSide): number {
    const s = trimChars(t, CSS_SPACE);
    if (!s) return 0;
    const side = this.autospaceSide(el, pseudo, '');
    const chars = [...s];
    let w = 0;
    // 先頭の空白は取ったので、元の文字列が空白で始まるなら、前の字とは隣り合わない
    const unicode = !this.opts.autospaceLatinOnly;
    if (prev && prev.on && side.on && t === t.trimStart() && autospacePair(prev.ch, chars[0], unicode)) w += Math.min(prev.fs, side.fs) * prev.width;
    if (side.on) {
      // CSS Text 4 §8.4.1 の字の種類は、字の単位の基底の字で決める: 結合文字 (M) は前の字と同じ単位なので、その前は空けず、後ろは基底の字で決める
      // (行を組むときの、書記素クラスタの判定の見積もり)
      let base = chars[0];
      for (let k = 0; k + 1 < chars.length; k++) {
        if (!unicode || !COMBINING_MARK.test(chars[k])) base = chars[k];
        if (unicode && COMBINING_MARK.test(chars[k + 1])) continue;
        if (autospacePair(unicode ? base : chars[k], chars[k + 1], unicode)) w += side.fs * side.width;
      }
    }
    return w;
  }

  /** 和欧間アキの判定に使う、要素の字の書式 (text-autospace が有効か・字の大きさ・アキの比) と、最後の字 ch */
  private autospaceSide(el: Element, pseudo: '::before' | '::after' | undefined, ch: string): AutospaceSide {
    const fs = cssLen(this.cs(el, pseudo)('font-size')) ?? 12;
    const on = this.spacing(el).autospace ?? this.opts.autospaceInitial ?? true;
    // アンテナハウスの -ah-text-autospace-width (百分率または長さの em。textStyle の textAutospaceWidth と同じ読み方)
    const aw = this.inh(el, 'text-autospace-width', true);
    const v = aw ? (/^([\d.]+)%$/.exec(aw) ? parseFloat(aw) / 100 : /^([\d.]+)em$/.exec(aw) ? parseFloat(aw) : undefined) : undefined;
    return { ch, fs, on, width: v !== undefined && Number.isFinite(v) ? v : (this.opts.autospaceWidth ?? 0.125) };
  }

  /** 詰めた後の空白 1 字の幅 (pt): 要素の書体の空白の送りと、字間・語間 (CSS Text 3 §7.1・§8.2) */
  private spaceWidth(el: Element, pseudo?: '::before' | '::after'): number {
    return this.textWidthPlain(' ', el, pseudo, true) + this.wordSpacing(el, pseudo);
  }

  /** 語間 (word-spacing。pt。normal は 0) */
  private wordSpacing(el: Element, pseudo?: '::before' | '::after'): number {
    return spacingPt(this.cs(el, pseudo), 'word-spacing');
  }

  /** 1 行の文字列の幅 (pt。和欧間アキを含めない) */
  private textWidthPlain(t: string, el: Element, pseudo?: '::before' | '::after', keepEdges = false): number {
    // 前後の空白は、詰める空白だけを取る (全角の空白 U+3000 は字として数える)。keepEdges なら取らない (改行を残す行・空白 1 字の幅)
    const s = keepEdges ? t : trimChars(t, CSS_SPACE);
    if (!s) return 0;
    const c = this.cs(el, pseudo);
    const fs = cssLen(c('font-size')) ?? 12;
    const ls = spacingPt(c, 'letter-spacing');
    if (!this.opts.measureText) return [...s].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0) * fs + ls * [...s].length;
    const weight = parseInt(c('font-weight'), 10) || 400;
    const names = c('font-family')
      .split(',')
      .map((n) => n.replace(/['"]/g, '').trim())
      .filter(Boolean);
    const fontFamily = this.opts.mapFont?.(names, weight >= 600, this.langOf(el));
    // カーニングと、それより先に当てる機能は、行を組むときの書式 (textStyle の kerning・fontFeatures) と同じものを使う
    const ts = this.textStyle(el, undefined, pseudo);
    return this.opts.measureText(s, { fontFamily, fontWeight: weight, fontSize: fs, kerning: ts.kerning !== false, ...(ts.fontFeatures?.length ? { features: ts.fontFeatures } : {}) }) + ls * [...s].length;
  }

  /** 段組 (column-count・column-width・column-gap・column-rule)。avail: 段組する幅 (pt) */
  private columnsOf(el: Element, avail: number): ({ count: number; gap: number; rule?: BorderSide; fill: 'balance' | 'auto' } & Pick<NonNullable<LBlockContainer['columns']>, 'ruleDisplay' | 'ruleLength' | 'ruleAlign' | 'discardEndMargin' | 'discardStartMargin' | 'byWidth'>) | undefined {
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
    // 段の数・段の間を、組むときに実際の幅で決め直す (段の数を column-width から決めたとき・段の間が百分率のとき)
    const gapPct = g && /%$/.test(g.trim()) ? parseFloat(g) / 100 : undefined;
    if (!this.src.rect && (width || gapPct !== undefined)) {
      const maxCount = parseInt(c('column-count'), 10) || 0;
      out.byWidth = { ...(width ? { width } : {}), ...(width && maxCount ? { maxCount } : !width ? { maxCount: count } : {}), ...(gapPct !== undefined ? { gapPct } : {}) };
    }
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

  /**
   * 強制の区切りの値 (break-before・break-after、古い page-break-*) → 区切りの種類 (CSS Fragmentation 3 §3.1)。
   * recto (右から左へ進む本では左ページ) は奇数ページ、verso は偶数ページ。left・right は、ページが右から左へ進む文書では
   * 左ページが奇数ページなので入れ替える (:left・:right の選び方と同じ)。
   * column は段組の文脈の中だけで効く (§3.1 の Column Break Values・§4.3: 合う種類の区切りの文脈の中に無い強制の区切りは効かない)
   */
  private forcedBreak(v: string, el: Element): BreakKind | undefined {
    const rtlPages = this.pagesRtl;
    return v === 'page' || v === 'always'
      ? 'page'
      : v === 'verso' || v === (rtlPages ? 'right' : 'left')
        ? 'even-page'
        : v === 'recto' || v === (rtlPages ? 'left' : 'right')
          ? 'odd-page'
          : v === 'column' && this.inMulticol(el)
            ? 'column'
            : undefined;
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
    const inner = (d === 'table' || this.isBlock(d, e) ? this.block(e, parent) : ({ type: 'block', ...this.textStyle(e, parent), ...this.paragraphStyle(e, parent), ...this.boxStyle(e), children: this.asBlockContent(this.ownFloatsIn(e, e, true, () => this.flowChildren(e, true)), e) } as LBlock)) as LBlock;
    // (float はブロックの箱になるので、行内の要素から作るときも text-indent などの段落の書式を渡す。渡さないと
    // span.sidenote { text-indent: 0 } のような指定が効かず、本文の字下げを受け継いでしまう)
    // 置き換え要素 (画像など) の float は行の箱を持たないので、受け継いだ text-indent を掛けない
    if (/^(img|svg|object|video|canvas|embed|iframe)$/.test(e.localName) && inner.type === 'block') inner.textIndent = 0;
    // 左右・綴じ側・小口側の float は、CSS の置き方 (包含ブロックの内容の端に置く。CSS 2.1 §9.5.1)。inside・outside は組むページの
    // 偶奇で左右に読み替える (float: sidenote を outside の側に置くときも、箱の内側の余白の内に置く)
    const f: LFloat = { type: 'float', float: side, children: [inner], ...(side === 'start' || side === 'end' || side === 'inside' || side === 'outside' ? { cssPlacement: true } : {}) };
    // 箱の寸法・余白・枠・背景は float に移す (外側の余白は本文との間隔、幅は回り込みの幅になる)
    // 内容による大きさ (inlineSizing) と、その長さの上限・下限も、float の箱が持つ
    for (const k of ['margin', 'padding', 'border', 'backgroundColor', 'backgroundImage', 'backgroundClip', 'borderRadius', 'boxShadow', 'paintEffect', 'width', 'height', 'boxSizing', 'clear', 'percent', ...(inner.inlineSizing ? (['inlineSizing', 'minInlineSize', 'maxInlineSize'] as const) : [])] as const) {
      if (inner[k] === undefined) continue;
      (f as unknown as Record<string, unknown>)[k] = inner[k];
      delete inner[k];
    }
    // 書字方向が親と直交する float (横書きの中の縦書きの箱など): 書字方向は float の箱そのものが持つ。箱の大きさ (上で移した width・height) を
    // その書字方向で読み、行の向きの大きさ (縦書きなら高さ) で折り返す (CSS Writing Modes 3 §7.3: 直交する流れを作る箱の大きさは、
    // 箱自身の書字方向で決める)。中のブロックに残すと、横書きの箱の中に置いた、大きさの指定の無い縦書きのブロックになってしまう
    if (inner.writingMode && (inner.writingMode === 'horizontal-tb') !== ((this.wm(this.cs(parent)('writing-mode')) ?? 'horizontal-tb') === 'horizontal-tb')) {
      f.writingMode = inner.writingMode;
      delete inner.writingMode;
      const lim = this.orthogonalInlineLimits(e);
      if (lim.max !== undefined) f.maxInlineSize = lim.max;
      if (lim.min !== undefined) f.minInlineSize = lim.min;
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

  /**
   * 書字方向が親と直交する箱の、行の向きの大きさの上限・下限 (内容の大きさ。pt): 縦書きの箱は max-height・min-height、横書きの箱は
   * max-width・min-width (CSS Writing Modes 3 §7.2: 高さ・幅の指定は物理の向き)。行の向きの大きさが auto のとき、fit-content の
   * 使える長さの上限と、結果の下限にする (§7.3.2・CSS 2.1 §10.4・§10.7)。長さの指定だけを読む
   */
  private orthogonalInlineLimits(e: Element): { max?: number; min?: number } {
    const c = this.cs(e);
    const vertical = /^(vertical|sideways|tb)/.test(c('writing-mode'));
    const p = (n: string) => cssLen(c(n)) ?? 0;
    const edges = c('box-sizing') !== 'border-box' ? 0 : vertical ? p('padding-top') + p('padding-bottom') + p('border-top-width') + p('border-bottom-width') : p('padding-left') + p('padding-right') + p('border-left-width') + p('border-right-width');
    const lim = (prop: string) => {
      const v = /px$/.test(c(prop)) ? cssLen(c(prop)) : undefined;
      return v === undefined ? undefined : Math.max(0, v - edges);
    };
    const max = lim(vertical ? 'max-height' : 'max-width');
    const min = lim(vertical ? 'min-height' : 'min-width');
    return { ...(max !== undefined ? { max } : {}), ...(min ? { min } : {}) };
  }

  /** 位置の基準になる祖先 (position が static でない。html・body は除く) */
  private positionedAncestor(e: Element): Element | undefined {
    for (let p = e.parentElement; p && p !== this.bodyEl && p.localName !== 'html'; p = p.parentElement) if (this.cs(p)('position') !== 'static' && this.cs(p)('position')) return p;
    return undefined;
  }

  /**
   * そのまま 1 つのブロック (LBlock) に組む要素か (表・flex・grid・回り込み・段組・置換要素でない、display: block の要素)。
   * 絶対配置の基準になる祖先と、その間の要素を調べる
   */
  private plainBlock(p: Element): boolean {
    const c = this.cs(p);
    if (!/^(block|flow-root)$/.test(c('display')) || (c('float') || 'none') !== 'none' || /^(img|svg|object|math|table)$/.test(p.localName)) return false;
    if (/sideways/.test(c('writing-mode'))) return false;
    if ((c('column-count') && c('column-count') !== 'auto') || (c('column-width') && c('column-width') !== 'auto')) return false;
    const pg = this.pg(p);
    return !pg.float && !/running\(/.test(pg.position ?? '');
  }

  /** 表の行にして組んだリストの項目 (li。記号のあるリスト)。項目の箱は、本文のセル */
  private liRows = new WeakSet<Element>();
  /**
   * 箱の前・後ろの区切りを避ける値 (自分の break-before・break-after と、最初・最後の子から伝わったもの。CSS Fragmentation 3 §3.1.1)。
   * all は avoid・avoid-page (ページの区切りも避ける)、column は avoid-column (段の区切りだけ)。column の値は、段組の容器
   * (段の分割の文脈) の手前で伝わるのを止める (§3.1.1: 伝わるのは、最も近い合う種類の分割の文脈の手前まで)。
   * ここに無い箱 (無名の箱・疑似要素の箱) は、keepWithPrevious・keepWithNext を all とみなす
   */
  private edgeAvoids = new WeakMap<object, { before?: AvoidKind; after?: AvoidKind }>();
  /** edgeAvoids に無い箱の、たどった答えの覚え (edgeAvoidOf) */
  private edgeAvoidMemo = new WeakMap<object, { before?: AvoidKind; after?: AvoidKind }>();

  /**
   * 絶対配置の基準の箱を探すときの、祖先の要素の種類: 'block' はそのまま組むブロック (plainBlock と、ブロックとして組むリストの項目)、
   * 'cell' は表のセル (と、表の行にして組んだリストの項目の本文)、'table' は表、'pass' は表の行・行グループ (箱を作らず、中のセルが表の行に並ぶ)。
   * どれでもなければ undefined (組版が、その中の絶対配置の箱を外の基準の箱へ運べない: flex・grid・行内の箱・回り込み・段組など)
   */
  private cbPart(p: Element): 'block' | 'cell' | 'table' | 'pass' | undefined {
    if (this.plainBlock(p)) return 'block';
    const c = this.cs(p);
    if ((c('float') || 'none') !== 'none' || /sideways/.test(c('writing-mode'))) return undefined;
    const pg = this.pg(p);
    if (pg.float || /running\(/.test(pg.position ?? '')) return undefined;
    const d = c('display');
    if (d === 'list-item') return this.liRows.has(p) ? 'cell' : 'block';
    if (d === 'table-cell') return 'cell';
    if (d === 'table' && p.localName !== 'img') return 'table';
    if (/^table-(row|row-group|header-group|footer-group)$/.test(d)) return 'pass';
    // 横書きの flex・grid の容器 (ブロックの箱か、高さの決まった箱に組む) は、ブロックと同じに基準にする (CSS Flexbox 1 §4.1・CSS Grid 1 §9.1:
    // 絶対配置の子の包含ブロックは、ふつうの CSS 2.1 §10.1 の決め方による)。間の要素 (position が static) としては、高さが中身で決まる
    // (ブロックの箱に組む) 容器だけを通す (高さの決まった容器は、組版が中の絶対配置の箱を、その容器の内容の箱を基準に置くため)
    if (/^(flex|grid)$/.test(d) && !/^(vertical|sideways|tb)/.test(c('writing-mode')) && (this.makesCb(p) || this.src.isAuto?.(p, 'height') !== false)) return 'block';
    return undefined;
  }

  /** flex・grid の容器の箱に付ける、絶対配置の基準の印 (cbPart が基準にする容器だけ) */
  private flexCbOf(el: Element): { containingBlock?: true } {
    return /^(flex|grid)$/.test(this.cs(el)('display')) && this.makesCb(el) && this.cbPart(el) === 'block' ? { containingBlock: true } : {};
  }

  /**
   * position: relative の箱のずらし (pt。右・下が正。CSS 2.1 §9.4.3: left と right の両方があれば left (direction: ltr)、top と bottom の
   * 両方があれば top。auto は 0)。ずらしが無ければ undefined
   */
  /** tr から、行のまとまりの終わりまでの行の数 (tr を含む)。まとまりの行ごとに覚える (rowspan="0" のセルごとに残りの行をたどり直さない) */
  private rowsFromMemo = new WeakMap<Element, number>();
  private rowsFrom(tr: Element): number {
    const known = this.rowsFromMemo.get(tr);
    if (known !== undefined) return known;
    const rows: Element[] = [tr];
    for (let n = tr.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const ln = (n as Element).localName;
      if (ln === 'tr') rows.push(n as Element);
      else if (/^(thead|tbody|tfoot)$/.test(ln)) break;
    }
    rows.forEach((r, k) => this.rowsFromMemo.set(r, rows.length - k));
    return rows.length;
  }

  private relativeOffsetOf(el: Element): { x: number; y: number } | undefined {
    const c = this.cs(el);
    if (c('position') !== 'relative') return undefined;
    // top・bottom の百分率は、包含ブロックの高さに対する割合。高さが決まっていなければ auto (CSS 2.1 §9.3.2・§9.4.3)。
    // 計算値は % のまま来る (cssCascade.ts) ので、ここで包含ブロックの決まった高さに当てる。
    // 包含ブロックは、いちばん近いブロックの容器の祖先 (CSS 2.1 §10.1 の 2)。行内の要素 (ルビの部分も) と display: contents
    // (箱を作らない。CSS Display 3 §2.5) は飛ばしてたどる。行内の要素の height は効かない (§10.5) ので、その高さは読まない。
    // ただし、flex・grid の容器の子 (display: contents の祖先を通して子になるものも。§2.5) は、計算値の display が inline のままでも、
    // ブロック化されたブロックの容器の箱 (CSS Display 3 §2.7・Flexbox 1 §4・Grid 1 §6.1) なので、包含ブロックになる (飛ばさない)
    const pct = (v: string) => {
      const m = /^(-?[\d.]+)%$/.exec(v.trim());
      if (!m) return undefined;
      const flexOrGridItem = (e: Element) => {
        let p = e.parentElement;
        while (p && p !== this.bodyEl && this.display(p) === 'contents') p = p.parentElement;
        return !!p && /(^|[\s-])(flex|grid)$/.test(this.display(p));
      };
      let cb = el.parentElement;
      while (cb && cb !== this.bodyEl && /^(inline|contents|ruby.*)$/.test(this.display(cb)) && !(this.display(cb) !== 'contents' && flexOrGridItem(cb))) cb = cb.parentElement;
      const h = cb ? this.definiteContentHeight(cb) : undefined;
      return h === undefined ? undefined : (parseFloat(m[1]) * h) / 100;
    };
    const off = (p: 'top' | 'right' | 'bottom' | 'left') =>
      this.src.isAuto?.(el, p) === false ? (cssLen(c(p)) ?? (p === 'top' || p === 'bottom' ? pct(c(p)) : undefined)) : undefined;
    const x = off('left') ?? (off('right') !== undefined ? -off('right')! : 0);
    const y = off('top') ?? (off('bottom') !== undefined ? -off('bottom')! : 0);
    return x || y ? { x, y } : undefined;
  }

  /**
   * 横書きのブロックの箱の、決まった内容の高さ (pt。子の高さ・相対配置のずらしの百分率の基準)。決まっていなければ undefined。
   * height が長さの箱と、容器の高さに伸ばす flex の項目 (行が容器の高さになる 1 行の容器の、交差軸の大きさが auto で stretch の項目。
   * Flexbox 1 §9.4 の 15・§9.8: 伸ばした大きさは決まった大きさとして扱う)。項目が 1 行に収まるかは読み込みのときに分からないので、
   * 折り返さない容器か、項目が 1 つの容器だけを見る
   */
  private definiteContentHeight(el: Element): number | undefined {
    const c = this.cs(el);
    if (/^(vertical|sideways|tb)/.test(c('writing-mode'))) return undefined;
    const q = (p: string) => cssLen(c(p)) ?? 0;
    const inner = (cc: (n: string) => string, outer: number) =>
      cc('box-sizing') === 'border-box' ? Math.max(0, outer - (cssLen(cc('padding-top')) ?? 0) - (cssLen(cc('padding-bottom')) ?? 0) - (cssLen(cc('border-top-width')) ?? 0) - (cssLen(cc('border-bottom-width')) ?? 0)) : outer;
    if (this.src.isAuto?.(el, 'height') === false) {
      const h = cssLen(c('height'));
      return h === undefined ? undefined : inner(c, h);
    }
    // 容器の高さに伸ばす flex の項目
    const box = el.parentElement;
    if (!box || !/^(inline-)?flex$/.test(this.display(box))) return undefined;
    const bc = this.cs(box);
    if (/^column/.test(bc('flex-direction')) || /^(vertical|sideways|tb)/.test(bc('writing-mode')) || this.src.isAuto?.(box, 'height') !== false) return undefined;
    const bh = cssLen(bc('height'));
    if (bh === undefined) return undefined;
    const ac = alignKeyword(bc('align-content'));
    const items = this.flexItemSources(box).filter((s) => s.ps || s.text !== undefined || !/^(absolute|fixed)$/.test(this.cs(s.el)('position')));
    const oneLine = bc('flex-wrap') === 'nowrap' || items.length === 1;
    if (!oneLine || !(bc('flex-wrap') === 'nowrap' || ac === 'normal' || ac === 'stretch' || this.opts.flexSingleLineFullWp)) return undefined;
    const as = c('align-self');
    if (flexCross(as && as !== 'auto' ? as : bc('align-items'), bc('flex-wrap') === 'wrap-reverse') !== 'stretch') return undefined;
    if (c('margin-top') === 'auto' || c('margin-bottom') === 'auto') return undefined;
    const outer = inner(bc, bh) - q('margin-top') - q('margin-bottom');
    // 項目の内容の高さ (伸ばした大きさは border-box の外の大きさなので、内側の余白と枠を引く)
    return Math.max(0, outer - q('padding-top') - q('padding-bottom') - q('border-top-width') - q('border-bottom-width'));
  }

  /** 中の絶対配置の箱の基準になる要素か: position が relative・sticky か、変換の付いた箱 (CSS 2.1 §10.1・Transforms 1 §3) */
  private makesCb(p: Element): boolean {
    const pos = this.cs(p)('position');
    return pos === 'relative' || pos === 'sticky' || ((!pos || pos === 'static') && !!this.paintEffectOf(p)?.transform);
  }

  /**
   * position: absolute の箱の基準 (containing block) にする祖先 (CSS 2.1 §10.1 の 4・CSS Position 3 §2.1): start から上へ、position が
   * static でない、いちばん近い祖先 (その padding の箱が基準)。Kumiori が祖先の箱を基準に置けるものだけを返す: 祖先は、position: relative・sticky
   * (か変換の付いた) ブロック・表・表のセル・リストの項目 (cbPart の block・cell・table) か、絶対配置の箱。間の要素も、ブロック・表の部分
   * (表・行グループ・行・セル)・リストの項目 (縦書きでもよい)。それ以外は undefined (本文領域を基準にする)
   */
  private localCb(start: Element | null): Element | undefined {
    // 位置を指定していない行内の要素は通り抜ける (中の絶対配置の箱は、行内の要素を含むブロックの流れに置く。flowPositioned)
    while (start && this.plainInline(start) && !this.positionedBox(start)) start = start.parentElement;
    for (let p = start; p && p !== this.bodyEl && p.localName !== 'html'; p = p.parentElement) {
      const pos = this.cs(p)('position');
      const part = this.cbPart(p);
      // 変換の付いた箱は、中の絶対配置・固定配置の箱の基準になる (Transforms 1 §3: containing block for all descendants)
      if ((!pos || pos === 'static') && this.paintEffectOf(p)?.transform) return part && part !== 'pass' ? p : undefined;
      if (pos && pos !== 'static') {
        if (/^(relative|sticky)$/.test(pos)) return part && part !== 'pass' ? p : undefined;
        if (/^(absolute|fixed)$/.test(pos)) return p.localName !== 'img' && !/vertical|sideways/.test(this.cs(p)('writing-mode')) ? p : undefined;
        return undefined;
      }
      if (!part) return undefined;
    }
    return undefined;
  }

  /** 置換要素でない行内の箱を作る要素か (display: inline。ルビの部分は除く) */
  private plainInline(p: Element): boolean {
    return this.display(p) === 'inline' && !/^(img|svg|object|video|canvas|iframe|embed|input|textarea|select|button|math|br|wbr|ruby|rt|rtc|rb|rp)$/.test(p.localName) && p !== this.bodyEl;
  }

  /** position が static でない要素か */
  private positionedBox(p: Element): boolean {
    const pos = this.cs(p)('position');
    return !!pos && pos !== 'static';
  }

  /**
   * position: absolute の箱の基準が、行内の箱のとき、その要素 (CSS 2.1 §10.1 の 4: 祖先が行内の要素なら、基準は、その要素の最初と最後の
   * 行内の箱の padding の箱を囲む矩形)。置けるのは次の 2 つ (ほかは undefined):
   *  - position: relative・sticky の行内の要素 (display: inline)。間の要素は、位置を指定していない行内の要素だけ
   *  - position: relative・sticky (か変換の付いた) display: inline-block の要素。間の要素は、位置を指定していない行内の要素と、そのまま組むブロック
   * localCb が基準を見つけなかったときに使う (間に、より近い基準のブロックがあれば、localCb がそれを返す)
   */
  private inlineCbOf(start: Element | null): Element | undefined {
    let p = start;
    while (p && this.plainInline(p) && !this.positionedBox(p)) p = p.parentElement;
    if (!p || p === this.bodyEl) return undefined;
    if (this.plainInline(p)) return /^(relative|sticky)$/.test(this.cs(p)('position')) ? p : undefined;
    for (; p && p !== this.bodyEl && p.localName !== 'html'; p = p.parentElement) {
      if (this.display(p) === 'inline-block') return this.makesCb(p) && !/vertical|sideways/.test(this.cs(p)('writing-mode')) && (this.cs(p)('float') || 'none') === 'none' ? p : undefined;
      if (this.positionedBox(p) || this.paintEffectOf(p)?.transform || !this.plainBlock(p)) return undefined;
    }
    return undefined;
  }

  /** 絶対配置の基準になる行内の箱の番号 (要素 → LInline.cbKey・LBlockContainer.inlineCb) */
  private inlineCbKeys = new Map<Element, number>();
  /** 行内の箱を基準にする絶対配置の箱 → その基準の要素 (箱を、基準の要素を出た所の行の並びに置く。flowChildren) */
  private inlineCbEl = new WeakMap<LBlockContainer, Element>();
  /** 行内の要素の中で見つけた絶対配置の箱 (行内の要素を出た所の行の並びに置く) */
  private pendingAbs: LBlockContainer[] = [];

  /** 絶対配置の箱の位置 (left・top・right・bottom) を、基準の祖先 cb の内容の箱からの距離にする (CSS の基準は padding の箱なので、padding を引く) */
  private placeInCb(cont: LBlockContainer, cb: Element, off: { top?: number; right?: number; bottom?: number; left?: number }, pct?: AbsPercent) {
    const pc = this.cs(cb);
    // 表の行にして組んだリストの項目は、本文のセルの内容の箱が項目の箱 (項目の padding は組んでいない)
    const pad = (side: string) => (this.liRows.has(cb) ? 0 : (cssLen(pc(`padding-${side}`)) ?? 0));
    cont.positionInContainer = true;
    if (off.left !== undefined) cont.left = off.left - pad('left');
    // left と width があれば right は捨てる (§10.3.7 の制約の余り)。ただし auto の余白に残りを配る箱は、残りを求めるのに要る
    if (off.right !== undefined && (off.left === undefined || cont.width === undefined || cont.autoMargins)) cont.right = off.right - pad('right');
    if (off.top !== undefined) cont.top = off.top - pad('top');
    if (off.bottom !== undefined && (off.top === undefined || cont.height === undefined)) cont.bottom = off.bottom - pad('bottom');
    this.setCbPercent(cont, pct, pad('top') + pad('bottom'), pad('left') + pad('right'));
  }

  /**
   * 絶対配置の箱の top・bottom・height の百分率 (0.5 = 50%)。基準は、包含ブロックの padding の箱の高さ (CSS 2.1 §10.1 の 4・§10.5:
   * 絶対配置の箱の包含ブロックの高さは、その箱の大きさによらないので、高さが中身で決まるときも百分率は決まる。CSS Position 3 §3.1:
   * inset の百分率は、包含ブロックの、同じ軸の大きさに対する割合)。カスケードは top・bottom の百分率を % のまま、height の百分率を
   * -kumiori-height-percent で渡す。calc() の中の百分率は読まない
   */
  private absPercent(c: (p: string) => string, isAuto: (p: 'top' | 'bottom') => boolean): AbsPercent {
    const num = (v: string) => {
      const m = /^([-+]?[\d.]+)%$/.exec((v ?? '').trim());
      return m && Number.isFinite(parseFloat(m[1])) ? parseFloat(m[1]) / 100 : undefined;
    };
    const out: AbsPercent = {};
    for (const p of ['top', 'bottom'] as const) {
      const v = isAuto(p) ? undefined : num(c(p));
      if (v !== undefined) out[p] = v;
    }
    const h = num(c('-kumiori-height-percent'));
    if (h !== undefined) out.height = h;
    return out;
  }

  /**
   * 百分率の top・bottom・height を、組版に渡す (LBlockContainer.cbPercent)。基準の箱の高さは組んでから決まるので、組版が決める。
   * pad: 組版が求める基準の箱の高さ (内容の箱) に足して、padding の箱の高さにする量
   */
  private setCbPercent(cont: LBlockContainer, pct: AbsPercent | undefined, pad: number, padI = 0) {
    if (!pct) return;
    const out: NonNullable<LBlockContainer['cbPercent']> = { pad };
    if (pct.top !== undefined && cont.top !== undefined) out.top = pct.top;
    if (pct.bottom !== undefined && cont.bottom !== undefined) out.bottom = pct.bottom;
    if (pct.height !== undefined) out.height = pct.height;
    if (pct.left !== undefined && cont.left !== undefined) out.left = pct.left;
    if (pct.right !== undefined && cont.right !== undefined) out.right = pct.right;
    if (padI) out.padI = padI;
    if (out.top !== undefined || out.bottom !== undefined || out.height !== undefined || out.left !== undefined || out.right !== undefined || (padI && cont.percent)) cont.cbPercent = out;
  }

  /** position: absolute / fixed → 絶対配置の箱 (基準の祖先 (localCb) の箱、無ければ本文領域を基準にする) */
  private positioned(e: Element, parent: Element): LBlockContainer {
    const c = this.cs(e);
    // 百分率の top・bottom・height (基準は包含ブロックの padding の箱の高さ。CSS 2.1 §10.5・CSS Position 3 §3.1): 位置の指定としては
    // 「ある」(長さの分は 0) と数え、割合は、基準の箱が決まる所 (組版か、下の本文領域の枝) で足す
    const pct = this.absPercent(c, (p) => this.src.isAuto?.(e, p) !== false);
    const off = (p: 'top' | 'right' | 'bottom' | 'left') => (this.src.isAuto?.(e, p) === false ? (cssLen(c(p)) ?? ((p === 'top' || p === 'bottom') && pct[p] !== undefined ? 0 : undefined)) : undefined);
    const box = this.boxStyle(e);
    // 余白 (margin) は、位置の指定 (top・left など) に足す (CSS 2.1 §10.3.7・§10.6.4: 絶対配置の箱の margin は基準からの距離に加わる)。
    // top も bottom も無ければ、static position を margin-top だけ下げる
    const mg = (box.margin ?? {}) as Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
    delete box.margin;
    // 百分率の left・right と margin-left・margin-right (基準は包含ブロックの幅。CSS Position 3 §3.1・CSS 2.1 §8.3): 基準の箱の中に置く箱
    // (placeInCb・行内の箱が基準) は、見積もりで解いた分を引いて長さの分を位置に残し、割合 (pct.left・pct.right) は組版が、基準の箱の
    // padding の箱の幅で足す (LBlockContainer.cbPercent)。ページの領域が基準の箱は、下の pageArea で決める
    const lrPct: Partial<Record<'left' | 'right', { f: number; d: number }>> = {};
    for (const sd of ['left', 'right'] as const) {
      const pp = this.src.isAuto?.(e, sd) === false ? this.src.percentOf?.(e, sd) : undefined;
      const est = cssLen(c(sd));
      const pm = box.percent?.margin?.[sd];
      let f = 0;
      let d = 0;
      if (pp && pp.f !== 0 && est !== undefined) {
        f += pp.f;
        d += pp.px * PT_PER_PX - est;
      }
      if (pm && pm.pct !== 0 && mg[sd] !== undefined) {
        f += pm.pct;
        d += pm.len - mg[sd]!;
      }
      if (f !== 0) lrPct[sd] = { f, d };
    }
    // 百分率の margin の上下は、見積もりの長さのまま位置の指定に足した (組むときに解き直さない)
    if (box.percent?.margin) {
      const { margin: _m, ...rest } = box.percent;
      if (Object.keys(rest).length) box.percent = rest;
      else delete box.percent;
    }
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
    // 百分率の height: 高さの指定は「ある」。値は、基準の箱の高さが決まってから入れる (親の高さから見積もった値は使わない)
    if (pct.height !== undefined) cont.height = 0;
    const add = (v: number | undefined, m: number | undefined) => (v === undefined ? undefined : v + (m ?? 0));
    const [top, right, bottom, left] = [add(off('top'), mg.top), add(off('right'), mg.right), add(off('bottom'), mg.bottom), add(off('left'), mg.left)];
    if (top === undefined && bottom === undefined && mg.top) cont.staticOffset = mg.top;
    // left・right・width がどれも auto でない箱の auto の左右の余白 (CSS 2.1 §10.3.7): 包含ブロックの幅は組むときに決まるので、
    // 組版が、残りを auto の余白に配る (LBlockContainer.autoMargins。right も渡す)。どれかが auto なら、auto の余白は 0
    // (boxStyle が付けた印は、ここで物理の左右から決め直す)
    delete cont.autoMargins;
    if (left !== undefined && right !== undefined && cont.width !== undefined) {
      const ml = c('margin-left') === 'auto';
      const mr = c('margin-right') === 'auto';
      if (ml || mr) cont.autoMargins = ml && mr ? 'center' : ml ? 'start' : 'end';
    }
    // 左右の位置の指定が無ければ、static position (基準の左端) から margin-left だけずらす (table#total { margin: 0 -3cm } など)
    // static position は、箱をふつうの流れに置いたとしたときの位置 (CSS 2.1 §10.3.7)。親の <center>・align (-webkit-center・-webkit-right)
    // は、流れの中の子孫のブロックの左右の余白を auto のように扱って寄せる (HTML Living Standard §15.3.3) ので、幅の決まった箱の
    // static position は、寄せた位置にする。置く場所の幅は、読み込みのときの親の内容の幅の見積もり
    let staticAlign = 0;
    if (left === undefined && right === undefined && !this.src.rect && cont.width !== undefined && e.parentElement && c('margin-left') === '0px' && c('margin-right') === '0px') {
      const al = /^-webkit-(center|right)$/.exec(this.cs(e.parentElement)('text-align'))?.[1];
      const cw = al ? this.src.contentWidth?.(e.parentElement) : undefined;
      if (cw !== undefined) {
        const edge = (sd: 'left' | 'right') => {
          const b = box.border;
          const bw = !b ? 0 : 'width' in b ? (b as BorderSide).width : ((b as Partial<Record<'left' | 'right', BorderSide>>)[sd]?.width ?? 0);
          const p = box.padding;
          return bw + (p === undefined ? 0 : typeof p === 'number' ? p : (p[sd] ?? 0));
        };
        const free = cw * PT_PER_PX - cont.width - (cont.boxSizing === 'border-box' ? 0 : edge('left') + edge('right'));
        if (free > 0) staticAlign = al === 'center' ? free / 2 : free;
      }
    }
    const staticI = left === undefined && right === undefined ? (mg.left ?? 0) + staticAlign : 0;
    // 幅は、ブラウザが決めた幅。指定が無ければ中身に合わせた幅 (shrink-to-fit。CSS 2.1 §10.3.7)
    if (cont.width === undefined) {
      const w = cssLen(c('width'));
      if (w) cont.width = w;
      else cont.shrinkToFit = true;
    }
    // 縦書きの箱は、行の向きの大きさが高さ: 高さの指定が無ければ shrink-to-fit (§10.3.7 を行の向きに当てる。CSS Writing Modes 3 §7.2)
    if (cont.height === undefined && /^vertical/.test(this.wm(c('writing-mode')) ?? '')) cont.shrinkToFit = true;
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
    const icb = c('position') === 'absolute' && !cb ? this.inlineCbOf(e.parentElement) : undefined;
    // 基準の箱の中に置く箱の、百分率の left・right の長さの分と割合
    const lenOf = (sd: 'left' | 'right', v: number | undefined) => (v === undefined || !lrPct[sd] ? v : v + lrPct[sd]!.d);
    const pctLR: AbsPercent = { ...pct, ...(left !== undefined && lrPct.left ? { left: lrPct.left.f } : {}), ...(right !== undefined && lrPct.right ? { right: lrPct.right.f } : {}) };
    if (cb) this.placeInCb(cont, cb, { top, right: lenOf('right', right), bottom, left: staticI ? staticI : lenOf('left', left) }, pctLR);
    else if (icb) {
      // 行内の箱が基準: 位置は、その箱の padding の箱を囲む矩形からの距離 (組版が、行を組んだ後で矩形を求める)
      let key = this.inlineCbKeys.get(icb);
      if (key === undefined) this.inlineCbKeys.set(icb, (key = this.inlineCbKeys.size + 1));
      cont.inlineCb = key;
      this.inlineCbEl.set(cont, icb);
      // 行内の要素 (display: inline) の断片は、組版では内容の箱 (字の並び) で求まるので、padding の分を引く (placeInCb と同じ)。
      // inline-block は、組版が箱の padding の箱を求める
      const ic = this.cs(icb);
      const pad = (side: string) => (this.plainInline(icb) ? (cssLen(ic(`padding-${side}`)) ?? 0) : 0);
      if (left !== undefined) cont.left = lenOf('left', left)! - pad('left');
      else if (staticI) cont.left = staticI;
      if (right !== undefined && (left === undefined || cont.width === undefined || cont.autoMargins)) cont.right = lenOf('right', right)! - pad('right');
      if (top !== undefined) cont.top = top - pad('top');
      if (bottom !== undefined && (top === undefined || cont.height === undefined)) cont.bottom = bottom - pad('bottom');
      this.setCbPercent(cont, pctLR, pad('top') + pad('bottom'), pad('left') + pad('right'));
    } else {
      // 基準の祖先が無い (初期包含ブロック) か position: fixed: 基準は本文領域 (ページの領域。CSS 2.1 §10.1 の 1・3)。
      // 高さが分かっているので、百分率はここで長さにする
      const a = this.areaOf(this.curPage ?? this.rootPage);
      // 組版エンジンは、置くページの領域で決め直す (pageArea)。ここでは、見積もりのページの領域で決めておく
      const pa: NonNullable<LBlockContainer['pageArea']> = {};
      // 百分率の left・right (基準はページの領域の幅。CSS 2.1 §10.1 の 1・3・CSS Position 3 §3.1): 長さの分 (と margin) と割合に分け、
      // 割合は、ページの領域の幅に当てる (カスケードの見積もりの幅で解いた分は引く)
      const side = (p: 'left' | 'right', v: number): [number, number | undefined] => {
        const pp = this.src.isAuto?.(e, p) === false ? this.src.percentOf?.(e, p) : undefined;
        const est = cssLen(c(p));
        return pp && pp.f !== 0 && est !== undefined ? [v - est + pp.px * PT_PER_PX, pp.f] : [v, undefined];
      };
      const setSide = (p: 'left' | 'right', v: number) => {
        const [len, f] = side(p, v);
        pa[p] = len;
        if (f !== undefined) pa[p === 'left' ? 'pctLeft' : 'pctRight'] = f;
      };
      // left・right・top・bottom が auto の向きは static position (CSS 2.1 §10.3.7・§10.6.4)。組版が見つけた所で決める (pageArea.staticLeft・
      // staticTop。position: absolute のときだけ。fixed の箱は、どのページにも同じ位置に置くので、ページの領域の端に置く)
      const abs = c('position') === 'absolute';
      if (left !== undefined) setSide('left', left);
      else if (right !== undefined) setSide('right', right);
      else {
        pa.left = staticI;
        if (abs) pa.staticLeft = true;
      }
      if (left !== undefined && right !== undefined && cont.autoMargins) setSide('right', right);
      if (top !== undefined) {
        pa.top = top;
        if (pct.top !== undefined) pa.pctTop = pct.top;
      } else if (bottom !== undefined) {
        pa.bottom = bottom;
        if (pct.bottom !== undefined) pa.pctBottom = pct.bottom;
      } else {
        pa.top = 0;
        if (abs) pa.staticTop = true;
      }
      if (pct.height !== undefined) pa.pctHeight = pct.height;
      if (pa.left !== undefined) cont.left = a.left + pa.left + (pa.pctLeft ?? 0) * a.width;
      if (pa.right !== undefined) cont.right = a.right + pa.right + (pa.pctRight ?? 0) * a.width;
      if (pa.top !== undefined) cont.top = a.top + pa.top + (pa.pctTop ?? 0) * a.height;
      if (pa.bottom !== undefined) cont.bottom = a.bottom + pa.bottom + (pa.pctBottom ?? 0) * a.height;
      if (pct.height !== undefined) cont.height = pct.height * a.height;
      if (!this.src.rect) cont.pageArea = pa;
    }
    const wm = this.wm(c('writing-mode'));
    if (wm) cont.writingMode = wm;
    // タグ付き PDF: 箱の中身は要素の構造の節に入れる (絶対配置の箱も、要素の構造の型 (H2 など) と文書の順を保つ。ISO 32000-1 §14.8.2.3)
    return this.tagNode(cont, e);
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
   * close-quote で深さが負になるときは何も入れない。quotes: auto は言語に合う引用符 (日本語と繁体字の中国語は「」『』、ほかは “” ‘’)。
   * 中国語は、繁体字 (zh-Hant と、台湾・香港・マカオ = zh-TW・zh-HK・zh-MO) が「」『』、簡体字 (それ以外の zh) が “” ‘’
   * (Content 3 §4.1 の注が挙げる CLDR の引用符: zh は “ ” ‘ ’、zh_Hant は 「 」 『 』。clreq §5.2: 中国大陸は弯引号、台湾は直角引号)
   */
  private quote(el: Element, pseudo: '::before' | '::after' | undefined, kind: string): string {
    const v = (pseudo ? this.cs(el, pseudo) : this.cs(el))('quotes')?.trim() ?? 'auto';
    let pairs: Array<[string, string]>;
    if (v === 'none') pairs = [];
    else if (v === 'auto' || !v) {
      const lang = (this.langOf(el) ?? '').toLowerCase();
      const corner = /^ja\b/.test(lang) || (/^zh\b/.test(lang) && /-(hant|tw|hk|mo)\b/.test(lang));
      pairs = corner ? [['「', '」'], ['『', '』']] : [['“', '”'], ['‘', '’']];
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
      else {
        // アンテナハウス互換のカスケードが受け付ける counter(page reverse) (残りのページ数) などは、未対応として知らせる (何も出さない)
        if (this.opts.ahCounterPagePhysical && words[0] === 'page') this.miss(`content: counter(${words.join(' ')})`);
        return [];
      }
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
            } else if (a[0] === 'page') this.miss(msg(`content:counter(${a[0]}) (本文の中)`, `content:counter(${a[0]}) (in the body)`));
            else out.push(this.counterString(a[1] ?? 'decimal', this.counterValue(a[0])));
            break;
          case 'counters': {
            const st = this.counters.get(a[0]) ?? [];
            // 区切りの字 × 入れ子の段の数は、予算を超えたところで作るのをやめる (長い区切りの字と深い入れ子で、要素ごとに大きな字を作らない)
            const sep = unquote(a[1] ?? '.');
            let s = '';
            for (const [k, x] of (st.length ? st : [{ v: 0 }]).entries()) {
              if (s.length > this.generatedLeft) break;
              s += (k ? sep : '') + this.counterString(a[2] ?? 'decimal', x.v);
            }
            out.push(s);
            break;
          }
          case 'attr':
            // attr(名前 型, 既定値) の型 (string・url など) は見ない
            out.push(el.getAttribute(a[0].split(/\s+/)[0]) ?? unquote(a[1] && !/^[a-z-]+$/i.test(a[1]) ? a[1] : ''));
            break;
          case 'target-counter': {
            const ref = this.targetId(el, a[0]);
            if (!ref) break;
            // 数え方は 3 つめの引数、無ければ decimal (CSS GCPM 3 §4.1・CSS Lists 3 §4.6 の counter() と同じ)。参照先のページの数え方ではない
            // (前は参照先のページの表記をそのまま使い、ローマ数字のページへの参照が、数え方を書かなくてもローマ数字になった)
            if (a[1] === 'page') out.push({ type: 'page-number-citation', refId: ref, format: pageNumberFormatOf(a[2] ?? 'decimal') ?? '1' });
            else if (this.lookup) out.push(this.counterString(a[2] ?? 'decimal', this.lookup.get(ref)?.counters[a[1]] ?? 0));
            break;
          }
          case 'target-counters': {
            // target-counters(<url>, <名前>, <区切り>, <数え方>?) (CSS Content 3 §2.6.2): 参照先の、その名前のカウンターの入れ子の値を、
            // 外から順に区切りの字でつなぐ (counters() と同じ形。CSS Lists 3 §4.6)。参照先にカウンターが無ければ 0。
            // page のカウンターは入れ子にならないので、target-counter(…, page) と同じにページ番号を引く
            const ref = this.targetId(el, a[0]);
            if (!ref || !a[1]) break;
            const name = a[1].trim();
            if (name === 'page') {
              out.push({ type: 'page-number-citation', refId: ref, format: pageNumberFormatOf(a[3] ?? 'decimal') ?? '1' });
              break;
            }
            if (!this.lookup) break;
            const st = this.lookup.get(ref)?.stacks[name];
            const sep = unquote(a[2] ?? '');
            let s = '';
            for (const [k, v] of (st?.length ? st : [0]).entries()) {
              if (s.length > this.generatedLeft) break;
              s += (k ? sep : '') + this.counterString(a[3] ?? 'decimal', v);
            }
            out.push(s);
            break;
          }
          case 'target-text': {
            const ref = this.targetId(el, a[0]);
            const info = ref ? this.lookup?.get(ref) : undefined;
            const which = (a[1] ?? 'content').trim();
            if (info) out.push(which === 'before' ? info.before : which === 'after' ? info.after : which === 'first-letter' ? (firstLetterOf(info.text)?.[1] ?? '') : info.text);
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
            const img: LImage = { type: 'image', src: normalizeSrc(unquote(a[0] ?? '')), decorateBox: false };
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
    return this.spendGenerated(out);
  }

  /** 生成内容の字を、文書全体の予算 (GENERATED_TEXT_BASE) から引く。予算を超えた分の字は捨てる (字でない項目は残す) */
  private spendGenerated(out: LInlineLevel[]): LInlineLevel[] {
    let cut = false;
    const kept: LInlineLevel[] = [];
    for (const x of out) {
      if (typeof x !== 'string') kept.push(x);
      else if (x.length <= this.generatedLeft) {
        this.generatedLeft -= x.length;
        kept.push(x);
      } else {
        // 切った端に、対の片方だけの代用符号を残さない
        const s = x.slice(0, this.generatedLeft).replace(/[\uD800-\uDBFF]$/, '');
        this.generatedLeft = 0;
        cut = true;
        if (s) kept.push(s);
      }
    }
    if (cut) this.miss(msg('content (生成内容の字の数が上限を超えた分)', 'content (generated content beyond the character limit)'));
    return kept;
  }

  /** float: multicol top / before の float (段組の箱の先頭へ移す) */
  private multicolTop = new WeakMap<LFloat, string | undefined>();
  /** float: multicol top の箱のうち、box-sizing: border-box のもの (gr の幅を罫線・内側の余白込みの幅にする) */
  private multicolTopBorderBox = new WeakSet<LFloat>();
  /** float: multicol top の箱が入る行グリッド (-ah-baseline-grid の new・root。継承した値も) */
  private multicolTopGrid = new WeakMap<LFloat, 'new' | 'root'>();

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
    // fragment は最初の # の後ろ全部 (URL Standard §4.4 の fragment state。"#a#b" の fragment は "a#b")。
    // リンクの飛び先 (linkOf) と同じに引く。前は最後の # の後ろで引き、リンクの飛べない項目にもページ番号が出た
    const id = v.replace(/^[^#]*#/, '');
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
    // 生成内容を字にしたか (その部分の字は、字にした時のカウンターの値などで変わるので、覚えない)
    let impure = false;
    const strings = (e: Element, v: string, which?: '::before' | '::after') => {
      impure = true;
      return this.evalContent(e, parseContent(v), which)
        .filter((x): x is string => typeof x === 'string')
        .join('');
    };
    const pseudoText = (e: Element, which: '::before' | '::after') => {
      const done = this.pseudoTextOf.get(e)?.[which];
      if (done !== undefined) return done;
      const v = this.pagedPseudo.get(e)?.[which]?.content ?? this.cs(e, which)('content');
      return !v || v === 'none' || v === 'normal' ? '' : strings(e, v, which);
    };
    // 要素の子の字。生成内容を字にしない部分は、要素ごとに覚えて使い回す (plainInner)。入れ子の見出しの、しおりの題・string-set の
    // content() ごとに子孫を全部たどると、入れ子の段数 × 要素の数の手間になり、<h1><button> × 2 万 (240KB) で 20 秒を超えた
    const inner = (e: Element): string => {
      const known = this.plainInner.get(e);
      if (known !== undefined) return known;
      const outerImpure = impure;
      impure = false;
      let t = '';
      for (const n of Array.from(e.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) t += n.textContent ?? '';
        else if (n.nodeType === 1 && this.display(n as Element) !== 'none') t += walk(n as Element);
      }
      if (!impure) this.plainInner.set(e, t);
      impure ||= outerImpure;
      return t;
    };
    const walk = (e: Element): string => {
      let t = pseudoText(e, '::before');
      const own = this.pg(e).content;
      if (own !== undefined && own !== 'normal' && own !== 'none') t += strings(e, own);
      else t += inner(e);
      return t + pseudoText(e, '::after');
    };
    const s = inner(el);
    return s.replace(/\s+/g, (w) => (/\n/.test(w) ? '' : ' ')).trim();
  }

  /** string-set → マーカー */
  private stringSet(el: Element): LMarker[] {
    const v = this.pg(el)['string-set'];
    if (!v || v === 'none') return [];
    const out: LMarker[] = [];
    const parts = splitCommasOutsideParens(v).map((part) => parseContent(part));
    // 引数の無い attr() などのある宣言は、全体が無効 (missingArgument)
    if (parts.some((toks) => toks.some(missingArgument))) return [];
    for (const toks of parts) {
      const name = toks[0]?.kind === 'ident' ? toks[0].v : undefined;
      if (!name) continue;
      // string-set の値も生成内容の予算から引く (名前 2000 個 × h1 100 個 × 余白の string() で、ページごとに 20 万字の柱を組んでいた)
      const text = (this.spendGenerated([this.textValue(el, toks.slice(1))])[0] as string | undefined) ?? '';
      out.push({ type: 'marker', className: `string:${name}`, children: [text] });
      // 余白の箱の text-transform・font-variant-caps を当てた字 (余白の箱ごとに、その書式の変種を取り出す。marginBoxes)
      for (const v of this.marginStringVariants()) out.push({ type: 'marker', className: `string:${name}|${v.tt}|${v.sc}`, children: this.marginText(text, v.tt, v.sc) });
    }
    return out;
  }

  /** 余白の箱の字: text-transform を当て、small caps の印を付ける (本文の transformText・smallCaps と同じ) */
  private marginText(t: string, tt: string, sc: '' | 'small' | 'all'): LInlineLevel[] {
    const s = tt && tt !== 'none' ? applyTextTransform(t, tt) : t;
    return sc ? [{ type: 'inline', smallCaps: sc, children: [s] } as LInline] : [s];
  }

  /**
   * 文書の @page の規則 (ページ文脈と余白の箱) に書かれた text-transform・font-variant-caps の組 (何も変えない組を除く)。
   * string-set の値は字の並びなので、余白の箱の書式を当てた変種を、文書を読むときに作っておく。そういう指定の無い文書では空
   */
  private marginStringVariants(): Array<{ tt: string; sc: '' | 'small' | 'all' }> {
    if (this.marginVariants) return this.marginVariants;
    const tts = new Set(['none']);
    const scs = new Set<'' | 'small' | 'all'>(['']);
    const root = (this.bodyEl?.ownerDocument as Document | undefined)?.documentElement;
    const rootC = root ? this.cs(root) : undefined;
    const see = (d: Record<string, string>) => {
      const x = marginTextDecls(d);
      if (x['text-transform']) tts.add(x['text-transform'].trim().toLowerCase());
      if (x['font-variant-caps']) scs.add(marginSmallCaps(x['font-variant-caps']));
    };
    // 根の要素の値は、ページ文脈を通して余白の箱が受け継ぐ (Page 3 §6)
    if (rootC) see({ 'text-transform': rootC('text-transform') || 'none', 'font-variant-caps': rootC('font-variant-caps') || 'normal' });
    for (const r of this.sheet.pages) {
      see(r.decls);
      for (const b of Object.values(r.boxes)) see(b);
    }
    const out: Array<{ tt: string; sc: '' | 'small' | 'all' }> = [];
    for (const tt of tts) for (const sc of scs) if (tt !== 'none' || sc) out.push({ tt, sc });
    return (this.marginVariants = out);
  }
  private marginVariants?: Array<{ tt: string; sc: '' | 'small' | 'all' }>;

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
   * 印刷の色 (device-cmyk・rgb-icc)。その性質の、カスケードで勝った宣言の印刷の色 (無ければ undefined)。
   * rgb-icc(…, #Separation, '名前', …) は、特色の値が渡されていれば特色 (spot) にする
   */
  private printOf(decls: Record<string, string>, prop: string, alt?: string): string | undefined {
    return printColor(decls[prop] ?? (alt ? decls[alt] : undefined) ?? '', this.opts.spotColors, !!this.opts.ahCssExtensions);
  }

  /**
   * 罫線の辺の印刷の色 (device-cmyk・cmyk・rgb-icc)。自前で読んだ宣言から、辺の色 > 辺の一括指定 > border-color > border の順に探す
   * (宣言の順は覚えていないので、詳しい指定を優先する)。無ければ undefined
   */
  private borderPrint(decls: Record<string, string>, sd: 'top' | 'right' | 'bottom' | 'left'): string | undefined {
    const fn = /(?:device-cmyk|rgb-icc|(?<![\w-])cmyk)\([^)]*\)/gi;
    const one = (v: string | undefined) => (v ? (v.match(fn) ?? [])[0] : undefined);
    const own = one(decls[`border-${sd}-color`]) ?? one(decls[`border-${sd}`]);
    if (own) return printColor(own, this.opts.spotColors, !!this.opts.ahCssExtensions);
    const bc = decls['border-color'];
    if (bc) {
      // 1〜4 個の値 (上・右・下・左)
      const vals = splitTop(bc, ' ');
      const [t, r = t, b = t, l = r] = vals;
      const v = { top: t, right: r, bottom: b, left: l }[sd];
      if (one(v)) return printColor(one(v)!, this.opts.spotColors, !!this.opts.ahCssExtensions);
    }
    const all = one(decls.border);
    return all ? printColor(all, this.opts.spotColors, !!this.opts.ahCssExtensions) : undefined;
  }

  /**
   * ルビの性質 (ruby-position・ruby-align・ruby-merge・ruby-overhang。どれも継承する。CSS Ruby 1 §4・§5.1) の、文書が指定した値。
   * 自前で読んだ宣言 (pg) を、要素から祖先へたどる。指定が無ければ '' (これまでの組み方のまま)。
   * ブラウザの確定値は使わない (指定が無くても初期値を返し、指定の有無が分からないため)
   */
  private rubyDecl(el: Element, prop: 'ruby-position' | 'ruby-align' | 'ruby-merge' | 'ruby-overhang'): string {
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      const v = this.pg(e as Element)[prop]?.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!v || v === 'inherit' || v === 'unset') continue;
      return RUBY_VALUES[prop].test(v) ? v : '';
    }
    return '';
  }

  private miss(what: string) {
    this.report.unsupported[what] = (this.report.unsupported[what] ?? 0) + 1;
    // 最初に現れた所を、診断の場所にする (読んでいる要素)
    const at = (this.report.unsupportedAt ??= Object.create(null) as Record<string, DiagnosticSource>);
    if (!(what in at) && this.curEl) at[what] = elementSource(this.curEl, this.opts.sourceName);
  }
  /** 読んでいる要素 (診断の場所に使う。block・inline の間) */
  private curEl?: Element;
  /** 要素から作った節に、要素の場所を結び付ける (中の要素の節は、それぞれの要素の場所を先に持つ) */
  private located<T>(el: Element, make: () => T): T {
    const prev = this.curEl;
    this.curEl = el;
    let out: T;
    try {
      out = make();
    } finally {
      this.curEl = prev;
    }
    if (out) {
      const src = elementSource(el, this.opts.sourceName);
      if (Array.isArray(out)) for (const n of out) tagNodeSource(n, src);
      else tagNodeSource(out, src);
    }
    return out;
  }

  /**
   * リストの項目の記号の画像 (list-style-image。CSS Lists 3 §3.3): url() の画像が読み込まれているときだけ、そのファイルの名前。
   * none・読めない画像は undefined (list-style-type の記号を使う)。url() でない画像 (グラデーションなど) は未対応として知らせる
   */
  private markerImage(li: Element): string | undefined {
    const v = this.cs(li)('list-style-image').trim();
    if (!v || v === 'none') return undefined;
    const m = wholeCssUrl(v);
    if (!m) {
      if (!this.markerImageMissed.has(li)) this.miss(`list-style-image: ${v.replace(/\(.*$/, '()')}`);
      this.markerImageMissed.add(li);
      return undefined;
    }
    const src = normalizeSrc(m[1]);
    if (this.opts.hasAsset?.(src) === false) return undefined;
    if (!this.report.images.includes(src)) this.report.images.push(src);
    return src;
  }
  private markerImageMissed = new WeakSet<Element>();

  /** 要素ごとの、描くときだけの効果 (同じ要素から 2 つの節を作っても、同じ物を渡す: 効果を 2 重に掛けないため) */
  private fxCache = new WeakMap<Element, Record<string, { fx?: PaintEffect }>>();
  /**
   * 描くときだけの効果 (transform・opacity)。組版には関わらない (Transforms 1 §3・Color 4 §3.3)。
   *  - 変換は、変換できる要素にだけ効く (Transforms 1 §2: 置換要素でない行内の箱・表の列・列の組は除く)。
   *    行列は、単位行列から、translate・rotate・scale の性質、transform の関数の並びの順に掛ける (Transforms 2 §6)
   *  - 不透明度は、どの要素にも効く (Color 4 §3.3)。計算値は [0, 1] に丸める
   * 読めない変換 (3D の関数など) は、変換を掛けず、未対応の値として知らせる
   */
  private paintEffectOf(el: Element, pseudo?: PseudoSel): PaintEffect | undefined {
    let slot = this.fxCache.get(el);
    if (!slot) this.fxCache.set(el, (slot = {}));
    const hit = slot[pseudo ?? ''];
    if (hit) return hit.fx;
    const c = this.cs(el, pseudo);
    const fx: PaintEffect = {};
    const d = c('display');
    const boxless = d === 'none' || d === 'contents';
    const op = c('opacity');
    if (op && op !== '1' && !boxless) {
      const n = /%$/.test(op) ? parseFloat(op) / 100 : parseFloat(op);
      if (Number.isFinite(n) && n < 1) fx.opacity = Math.max(n, 0);
    }
    const tv = c('transform');
    const iv = (['translate', 'rotate', 'scale'] as const).map((p) => [p, c(p)] as const).filter(([, v]) => v && v !== 'none');
    if (((tv && tv !== 'none') || iv.length) && !boxless && pseudo !== '::first-letter') {
      const replaced = !pseudo && /^(img|svg|object|video|canvas|iframe|embed|input|textarea|select|button|math)$/.test(el.localName);
      if (!(/^(inline|table-column|table-column-group)$/.test(d) && !replaced)) {
        const fns: TransformFunction[] = [];
        let miss: string | undefined;
        for (const [p, v] of iv) {
          const f = parseIndividualTransform(p, v);
          if (f && 'miss' in f) miss ??= f.miss;
          else if (f) fns.push(f);
        }
        const list = parseTransformList(tv);
        if ('miss' in list) miss ??= `transform: ${list.miss}`;
        else pushAll(fns, list);
        if (miss) this.miss(miss);
        else if (fns.length) {
          const origin = parseTransformOrigin(c('transform-origin'));
          // 基準の箱 (Transforms 1 §6): CSS の箱を持つ要素では、fill-box は content-box、stroke-box・view-box (初期値) は border-box
          const box = /^(content-box|fill-box)$/.test(c('transform-box')) ? 'content-box' : undefined;
          fx.transform = { functions: fns, ...(origin ? { origin } : {}), ...(box ? { box } : {}) };
        }
      }
    }
    // 輪郭線 (outline。CSS UI 4 §3): どの要素にも効く (::first-letter に効く性質の一覧 (CSS Pseudo 4 §2.3) には無い)。
    // 見えない箱 (visibility: hidden・collapse) には描かない (CSS 2.1 §11.2: 箱は見えない)
    if (!boxless && pseudo !== '::first-letter' && !/^(hidden|collapse)$/.test(c('visibility'))) {
      const ol = outlineOf(c);
      if (ol) fx.outline = ol;
    }
    // 切り抜きの矩形 (clip。CSS 2.1 §11.1.2): 絶対配置 (position: absolute・fixed) の要素にだけ効く。計算値は rect(a, b, c, d)
    // (a〜d は auto か px の長さ)。auto の辺は、組んだ後で、箱の罫線の箱のその辺にする
    if (!boxless && pseudo !== '::first-letter' && /^(absolute|fixed)$/.test(c('position'))) {
      const m = /^rect\((.*)\)$/.exec(c('clip').trim());
      const parts = m?.[1].split(',').map((t) => t.trim());
      if (parts?.length === 4) {
        const [top, right, bottom, left] = parts.map((t) => (t === 'auto' ? undefined : cssLen(t)));
        fx.clip = { ...(top !== undefined ? { top } : {}), ...(right !== undefined ? { right } : {}), ...(bottom !== undefined ? { bottom } : {}), ...(left !== undefined ? { left } : {}) };
      }
    }
    const out = fx.transform || fx.opacity !== undefined || fx.outline || fx.clip ? fx : undefined;
    slot[pseudo ?? ''] = { fx: out };
    return out;
  }

  /**
   * 行内の箱 (display: inline の、置換要素でない箱) に渡す効果: 輪郭線は、行ごとの断片に描くので、効果 (不透明度) とは別に渡す
   * (LInline.outline)。残りの効果は、同じ要素には同じ物を返す (paintEffectOf と同じ理由)
   */
  private inlineEffectOf(el: Element, pseudo?: PseudoSel): { fx?: PaintEffect; outline?: Outline } {
    const all = this.paintEffectOf(el, pseudo);
    if (!all?.outline) return { fx: all };
    const slot = this.fxCache.get(el)!;
    const key = `inline:${pseudo ?? ''}`;
    if (!slot[key]) {
      const { outline: _ol, ...rest } = all;
      slot[key] = { fx: rest.transform || rest.opacity !== undefined || rest.clip ? rest : undefined };
    }
    return { fx: slot[key].fx, outline: all.outline };
  }

  /** 文字の書式: 親と違うものだけ (CSS の継承は Kumiori の resolveStyle と同じく子へ引き継ぐ) */
  /**
   * over: ページの余白の箱の書式を読むときの、値の取り出し口 (marginBoxes。el・parent は、受け継ぐ元の要素)。
   * 要素の属性・要素ごとの拡張の指定は見ない (擬似要素と同じ扱い)
   */
  private textStyle(el: Element, parent: Element | undefined, pseudo0?: PseudoSel, over?: (name: string) => string): TextStyle {
    const pseudo: PseudoSel | '@margin' | undefined = over ? '@margin' : pseudo0;
    const c = over ?? this.cs(el, pseudo0);
    const p = parent ? this.cs(parent) : undefined;
    const diff = (prop: string) => !p || c(prop) !== p(prop);
    const s: TextStyle = {};
    if (diff('font-size')) {
      const v = cssLen(c('font-size'));
      // 0 も有効な値 (CSS Fonts 4 §2.4: 負の値だけが不正)。字は大きさ 0 で、line-height: normal の行の高さも 0 になる
      // (0 を捨てると親の字の大きさのままになり、font-size: 0 で隠した段落 (改ページの印など) が 1 行の高さを取っていた)
      if (v !== undefined) s.fontSize = v;
    }
    const bold = (parseInt(c('font-weight'), 10) || 400) >= 600;
    if (diff('font-weight')) s.fontWeight = parseInt(c('font-weight'), 10) || 400;
    // 書体の組は、font-family の名前の並び・太さと、要素の言語 (lang) で決まる (欧文の文書・要素では、記号と、単独のギリシャ文字・
    // キリル文字も欧文の書体で組む)。font-family を受け継いだ要素でも、lang が付いていれば、その言語で選び直す
    // (font-family の計算値は名前の並びで、字に使う書体は、その字のある要素ごとに選ぶ。CSS Fonts 4 §5.2。
    // 自分に font-family を指定した要素と、同じ指定を受け継いだ要素とで、結果を同じにする)
    const famNames = (cc: (n: string) => string) =>
      cc('font-family')
        .split(',')
        .map((n) => n.replace(/['"]/g, '').trim())
        .filter(Boolean);
    const ownLang = !pseudo && !!parent && !!(el.getAttribute?.('lang') ?? el.getAttribute?.('xml:lang') ?? this.pg(el)['-ah-lang']);
    if (diff('font-family') || diff('font-weight')) {
      // 余白の箱から書体を受け継ぐ running() の要素の中 (runningFamily。アンテナハウス互換): 元の場所から受け継いだままの font-family は、
      // 余白の箱の font-family に読み替える (太さだけを変えた要素を、元の場所の書体の太字にしない)
      const rf = this.runningFamily;
      const mapped = this.opts.mapFont?.(rf && c('font-family') === rf.from ? rf.names : famNames(c), bold, this.langOf(el, pseudo));
      if (mapped) s.fontFamily = mapped;
    } else if (ownLang && p && this.langOf(el) !== this.langOf(parent!)) {
      const mapped = this.opts.mapFont?.(famNames(c), bold, this.langOf(el));
      if (mapped && mapped !== this.opts.mapFont?.(famNames(p), (parseInt(p('font-weight'), 10) || 400) >= 600, this.langOf(parent!))) s.fontFamily = mapped;
    }
    // direction: 行の中の向き (右から左の段落。Writing Modes 3 §2.1)。text-align の left・right は paragraphStyle で start・end に読み替える
    if (!pseudo && diff('direction')) s.direction = c('direction') === 'rtl' ? 'rtl' : 'ltr';
    // unicode-bidi (引き継がない。Writing Modes 3 §2.2): normal 以外を渡す
    {
      const ub = c('unicode-bidi');
      if (ub === 'embed' || ub === 'isolate' || ub === 'bidi-override' || ub === 'isolate-override' || ub === 'plaintext') s.unicodeBidi = ub;
    }
    if (diff('font-style')) {
      s.fontStyle = c('font-style') === 'italic' || c('font-style').startsWith('oblique') ? 'italic' : 'normal';
      // oblique <角度> (Fonts 4 §2.4: 角度が無ければ 14deg)。可変フォントの slnt の軸の値になる
      const ob = /^oblique(?:\s+(-?[\d.]+)deg)?$/.exec(c('font-style'));
      if (ob) s.fontObliqueAngle = ob[1] !== undefined ? Math.max(-90, Math.min(90, parseFloat(ob[1]))) : 14;
    }
    // 可変フォントの軸の値 (Fonts 4 §8.1・§8.2)
    // (根の初期値は書かない: 親が無く、値が初期値のとき)
    if (diff('font-optical-sizing') && (p || c('font-optical-sizing') === 'none')) s.fontOpticalSizing = c('font-optical-sizing') === 'none' ? 'none' : 'auto';
    if (diff('font-variation-settings') && (p || c('font-variation-settings') !== 'normal')) s.fontVariationSettings = parseVariationSettings(c('font-variation-settings')) ?? {};
    // 印刷の色 (特色・CMYK)。::before / ::after / ::marker は、その擬似要素の規則の宣言から
    const pdecl = pseudo === '::before' || pseudo === '::after' || pseudo === '::marker' ? this.pagedPseudo.get(el)?.[pseudo] : pseudo ? undefined : this.pg(el);
    const pcol = pdecl ? this.printOf(pdecl, 'color') : undefined;
    if (pcol) s.color = pcol;
    else if (diff('color')) {
      // 半透明の字の色 (rgba() など) は、透明度つき (#rrggbbaa) のまま持ち、描くときにその濃さで重ねる (CSS Color 4 §4.1。
      // 前は白い紙に重ねた不透明の色にしていたので、下に背景があると色が違った)
      const col = textColorOf(c('color'));
      if (col) s.color = col;
    }
    // visibility (CSS 2.1 §11.2・CSS Display 3 §4): hidden・collapse の要素は、場所を残して描かない。字の色を transparent にして運び、
    // 描画で描かない (字・リーダー・リストの記号・画像。paint.ts)。visibility は受け継ぐので、見えない親の中で visible の子は自分の色に戻す
    const hiddenOf = (cc: (n: string) => string) => /^(hidden|collapse)$/.test(cc('visibility'));
    if (hiddenOf(c)) s.color = 'transparent';
    else if (p && hiddenOf(p)) s.color = s.color ?? pcol ?? textColorOf(c('color')) ?? '#000000';
    if (diff('line-height') || diff('font-size') || (c('line-height') === 'normal' && diff('font-family'))) {
      const lh = c('line-height');
      const v = cssLen(lh);
      // 0 も有効な値 (画像の行などで使う。CSS 2.1 §10.8.1)
      if (v !== undefined) s.lineHeightPt = v;
      else if (lh === 'normal') {
        // normal: 書体の値 (読み込んだ書体なら ascent・descent・lineGap から)、分からなければ 1.2
        const fams = c('font-family').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        s.lineHeight = this.opts.normalLineHeight?.(fams, (parseInt(c('font-weight'), 10) || 400) >= 600, this.normalOpts) ?? 1.2;
        // normal の印: 代わりの書体で組まれた字は、その書体の上下も行の高さに数える (CSS Inline 3 §5.3。lineMetrics.ts の lineMetricsCss)
        s.lineHeightNormal = true;
      }
    }
    // letter-spacing・word-spacing の normal は 0 (Text 3 §7.1・§7.2)。親の値を打ち消せるように、変わったら必ず設定する
    // 百分率 (字の大きさに対する割合。計算値は百分率のまま受け継ぐ) は、字の大きさが変わっても決め直す
    for (const [prop, key] of [['letter-spacing', 'letterSpacing'], ['word-spacing', 'wordSpacing']] as const)
      if (diff(prop) || (/%/.test(c(prop)) && diff('font-size'))) s[key] = spacingPt(c, prop);
    // tab-size (Text 3 §4.2): 計算値は、数 (空白の字の送りの何倍か) か、絶対の長さ。親の値を打ち消せるように、変わったら必ず設定する
    if (diff('tab-size')) {
      const ts = c('tab-size').trim();
      s.tabSize = /^[\d.+-]+(e[+-]?\d+)?$/i.test(ts) ? parseFloat(ts) : { length: cssLen(ts) ?? 0 };
    }
    // 折り返すかは text-wrap-mode (CSS Text 4 §5.1。white-space の nowrap・pre は、その一括指定で nowrap になる: §3)。行内要素でも効く。
    // 子の wrap などで打ち消せる。空白の扱いは white-space の値
    if (diff('text-wrap-mode')) s.noWrap = c('text-wrap-mode') === 'nowrap';
    if (diff('white-space')) s.collapseSpaces = /^(normal|nowrap|pre-line)$/.test(c('white-space') || 'normal');
    // 行の並べ方の選び方 (CSS Text 4 §5.4)。stable は auto と同じ組み方、avoid-short-last-line は pretty と同じ扱い (inlineLayout の rewrap)
    if (diff('text-wrap-style')) {
      const ws = c('text-wrap-style');
      s.textWrapStyle = ws === 'balance' ? 'balance' : ws === 'pretty' || ws === 'avoid-short-last-line' ? 'pretty' : 'auto';
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
      return v === c('color') ? (pcol ?? visibleColorOf(c('color'))) : visibleColorOf(v);
    };
    // 線の種類 (text-decoration-style。Text Decoration 3 §2.2)・太さ (text-decoration-thickness。同 4 §2.4)・下線のずらし
    // (text-underline-offset。同 4 §2.8) は、線を指定したこの要素の値を、この要素から出る線に付ける。初期値 (solid・auto・auto) では何も付けない。
    // 百分率は、この要素の 1em に対する割合
    const decoShape = (cc: (n: string) => string) => {
      const pct = /%/.test(`${cc('text-decoration-thickness')}${cc('text-underline-offset')}`) ? cc('font-size') : '';
      return `${cc('text-decoration-style') || 'solid'}|${cc('text-decoration-thickness') || 'auto'}|${cc('text-underline-offset') || 'auto'}|${pct}`;
    };
    const decoExtras = (lines: string): Pick<NonNullable<TextStyle['textDecoration']>, 'styles' | 'thickness' | 'underlineOffset'> => {
      const keys = [...(lines.includes('underline') ? ['underline' as const] : []), ...(lines.includes('overline') ? ['overline' as const] : []), ...(lines.includes('line-through') ? ['lineThrough' as const] : [])];
      const each = <T,>(v: T) => Object.fromEntries(keys.map((k) => [k, v]));
      const em = (v: string) => (/^[+-]?[\d.]+%$/.test(v) ? ((cssLen(c('font-size')) ?? 0) * parseFloat(v)) / 100 : cssLen(v));
      const st = c('text-decoration-style');
      const tv = c('text-decoration-thickness');
      const th = tv === 'from-font' ? ('from-font' as const) : tv && tv !== 'auto' ? em(tv) : undefined;
      const ov = c('text-underline-offset');
      const off = lines.includes('underline') && ov && ov !== 'auto' ? em(ov) : undefined;
      return {
        ...(/^(double|dotted|dashed|wavy)$/.test(st) && keys.length ? { styles: each(st as TextDecorationStyle) } : {}),
        ...(th !== undefined && (th === 'from-font' || th >= 0) && keys.length ? { thickness: each(th) } : {}),
        ...(off !== undefined ? { underlineOffset: off } : {}),
      };
    };
    if (deco && deco !== 'none' && (!p || deco !== (p('text-decoration-line') || p('text-decoration')) || c('text-decoration-color') !== p('text-decoration-color') || decoShape(c) !== decoShape(p))) {
      const dc = decoColor();
      const colors = dc ? { ...(deco.includes('underline') ? { underline: dc } : {}), ...(deco.includes('overline') ? { overline: dc } : {}), ...(deco.includes('line-through') ? { lineThrough: dc } : {}) } : undefined;
      s.textDecoration = { ...(deco.includes('underline') ? { underline: true } : {}), ...(deco.includes('overline') ? { overline: true } : {}), ...(deco.includes('line-through') ? { lineThrough: true } : {}), ...(colors ? { colors } : {}), ...decoExtras(deco) };
    }
    // 互換モード: 祖先の飾り線は表に伝えない (表に自分の飾り線があれば、それだけ。Quirks Mode §3.11)。
    // inline-block・inline-table (行の中の、分けられない箱) の中身にも、祖先の飾り線は伝わらない (CSS Text Decoration 3 §2:
    // 飾り線は、inline-block・inline-table のような分けられないインラインの子孫の中身には伝わらない)。
    // 箱に自分の飾り線があれば、それだけを中身に引く
    if ((!pseudo && isQuirksDoc(el.ownerDocument as Document | null) && /^(inline-)?table$/.test(c('display'))) || /^inline-(block|table)$/.test(c('display'))) {
      const own = deco && deco !== 'none' ? deco : '';
      const dc = own ? decoColor() : undefined;
      s.textDecoration = { underline: own.includes('underline'), overline: own.includes('overline'), lineThrough: own.includes('line-through'), ...(dc ? { colors: { underline: dc, overline: dc, lineThrough: dc } } : {}), ...(own ? decoExtras(own) : {}) };
    }
    // hyphens: auto だけが自動の分綴。子の none・manual で打ち消せる (Text 3 §5.3)
    if (diff('hyphens')) s.hyphenate = c('hyphens') === 'auto';
    // 分綴の制限 (CSS Text 4 §6.3.2〜§6.3.5)。どれかが親と違えば、5 つの計算値をまとめて運ぶ (初期値に戻す指定も、空の組で親の値を打ち消す)
    if (HYPHEN_LIMIT_PROPS.some((k) => diff(k))) s.hyphenLimits = hyphenLimitsOf(c);
    if (!pseudo) {
      const sp = this.spacing(el);
      const ps = parent ? this.spacing(parent) : undefined;
      if (sp.autospace !== undefined && sp.autospace !== ps?.autospace) s.textAutospace = sp.autospace;
      // 相手の字の種類 (ideograph-alpha・ideograph-numeric) は、親と違えば運ぶ (no-autospace の子孫が normal に戻すときも、all に戻す)
      if (sp.autospaceKinds !== ps?.autospaceKinds) s.textAutospaceKinds = sp.autospaceKinds ?? 'all';
      if (!!sp.autospacePunct !== !!ps?.autospacePunct) s.textAutospacePunct = !!sp.autospacePunct;
      if (!!sp.autospaceReplace !== !!ps?.autospaceReplace) s.textAutospaceReplace = !!sp.autospaceReplace;
      // アンテナハウスの -ah-text-autospace-width (百分率または長さの em)
      const aw = this.inh(el, 'text-autospace-width', true);
      if (aw && aw !== (parent ? this.inh(parent, 'text-autospace-width', true) : '')) {
        const v = /^([\d.]+)%$/.exec(aw) ? parseFloat(aw) / 100 : /^([\d.]+)em$/.exec(aw) ? parseFloat(aw) : undefined;
        if (v !== undefined && Number.isFinite(v)) s.textAutospaceWidth = v;
      }
      if (sp.squeeze !== undefined && sp.squeeze !== ps?.squeeze) s.punctuationSqueeze = sp.squeeze;
      if (sp.trimStart !== undefined && sp.trimStart !== ps?.trimStart) s.punctuationTrimStart = sp.trimStart;
      if (sp.trimEnd !== undefined && sp.trimEnd !== ps?.trimEnd) s.punctuationTrimEnd = sp.trimEnd;
      if (sp.trimStartExceptFirst !== undefined && sp.trimStartExceptFirst !== ps?.trimStartExceptFirst) s.punctuationTrimStartExceptFirst = sp.trimStartExceptFirst;
      if (sp.trimAll !== undefined && sp.trimAll !== ps?.trimAll) s.punctuationTrimAll = sp.trimAll;
      if (sp.hang !== ps?.hang) s.hangingPunctuation = sp.hang;
      if (sp.hangFirst !== (ps?.hangFirst ?? false)) s.hangFirst = sp.hangFirst;
    }
    // 字形を差し替える OpenType の機能: font-variant-numeric (oldstyle-nums など)・font-variant-position (super・sub)・
    // font-variant-ligatures (discretionary・historical・contextual)・font-variant-east-asian と font-feature-settings。
    // 字は 1 字ずつ字形を引くので、字の並びで決まる機能 (frac の分数・ordn の序数・calt) は書体が 1 字で差し替えるものだけ効く
    // (合字の機能 liga・clig・dlig・hlig は、字の並びを 1 つの単位にまとめてから当てる: inlineFlatten.ts の ligatureUnits)
    if (diff('font-variant-numeric') || diff('font-variant-position') || diff('font-variant-ligatures') || diff('font-variant-east-asian') || diff('font-feature-settings')) {
      // 下の 3 つの表は入力の値 (font-variant-numeric: __proto__ など) で引くので、原型を持たないものにする
      const NUM = {
        __proto__: null,
        'oldstyle-nums': 'onum',
        'lining-nums': 'lnum',
        'proportional-nums': 'pnum',
        'tabular-nums': 'tnum',
        'diagonal-fractions': 'frac',
        'stacked-fractions': 'afrc',
        'slashed-zero': 'zero',
        ordinal: 'ordn',
      } as unknown as Record<string, string>;
      const feats = c('font-variant-numeric').split(/\s+/).flatMap((v) => (NUM[v] ? [NUM[v]] : []));
      const pos = c('font-variant-position');
      if (pos === 'super') feats.push('sups');
      else if (pos === 'sub') feats.push('subs');
      const LIG = { __proto__: null, 'discretionary-ligatures': 'dlig', 'historical-ligatures': 'hlig', contextual: 'calt' } as unknown as Record<string, string>;
      for (const v of c('font-variant-ligatures').split(/\s+/)) if (LIG[v] && !feats.includes(LIG[v])) feats.push(LIG[v]);
      // font-variant-east-asian (Fonts 4 §6.10): 字形の版 (JIS78・83・90・2004、簡体・繁体)・字の幅 (全角・プロポーショナル)・ルビ用の字形。
      // 値ごとに決まった OpenType の機能を使う。書体にその機能が無ければ、何も変わらない (§7.2: 作り出さない)
      const EA = { __proto__: null, jis78: 'jp78', jis83: 'jp83', jis90: 'jp90', jis04: 'jp04', simplified: 'smpl', traditional: 'trad', 'full-width': 'fwid', 'proportional-width': 'pwid', ruby: 'ruby' } as unknown as Record<string, string>;
      for (const v of c('font-variant-east-asian').split(/\s+/)) if (EA[v] && !feats.includes(EA[v])) feats.push(EA[v]);
      for (const m of c('font-feature-settings').matchAll(/["']([a-z0-9]{4})["']\s*(on|off|\d+)?/gi)) {
        const on = m[2] === undefined || m[2] === 'on' || parseInt(m[2], 10) > 0;
        if (on && !feats.includes(m[1])) feats.push(m[1]);
      }
      s.fontFeatures = feats;
    }
    // font-palette (CSS Fonts 4 §9.1): normal・light・dark か、@font-palette-values の名前 (--名前。当たる規則が無ければ normal)。
    // palette-mix() は読まない (normal として組む)
    if (diff('font-palette')) {
      const fp = c('font-palette').trim();
      const rules = /^--/.test(fp) ? (this.sheet.fontPaletteValues ?? []).filter((r) => r.name === fp) : [];
      s.fontPalette = /^(light|dark)$/i.test(fp) ? (fp.toLowerCase() as 'light' | 'dark') : rules.length ? rules : 'normal';
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
      // font-feature-settings で明示して有効にした合字の機能: 字間 (letter-spacing) があっても当てる。
      // 機能を決める順 (Fonts 4 §7.2) は、font-variant の機能 → ほかの性質が決める機能 (letter-spacing が 0 でなければ任意の合字を止める) →
      // font-feature-settings なので、font-variant-ligatures の明示 (common-ligatures など) は字間で止まり、font-feature-settings の明示は止まらない
      // (Text 3 §7.2 も、font-feature-settings で指定した合字を、この決まりより優先させる)
      const forced: string[] = [];
      for (const m of c('font-feature-settings').matchAll(/["'](liga|clig|dlig|hlig)["']\s*(on|off|\d+)?/gi)) {
        const tag = m[1].toLowerCase();
        const fon = m[2] === undefined || m[2] === 'on' || parseInt(m[2], 10) > 0;
        const at = forced.indexOf(tag);
        // 同じ機能を 2 度書いたときは、後のものを使う (Fonts 4 §7.2)
        if (at >= 0) forced.splice(at, 1);
        if (fon) forced.push(tag);
      }
      if (forced.length || (parent && diff('font-feature-settings'))) s.forcedLigatures = forced;
    }
    // カーニング: auto (既定) も、ブラウザと同じく欧文にかける。none で止める
    const fk = c('font-kerning');
    if (!parent || diff('font-kerning')) {
      if (fk === 'normal' || fk === 'auto') s.kerning = true;
      else if (fk === 'none') s.kerning = false;
    }
    // 書体に無い字形を作ってよいか (font-synthesis-weight・-style・-small-caps。CSS Fonts 4 §2.8.1〜§2.8.3。継承する)。
    // -position は読むだけ (上付き・下付きの字形は書体の sups・subs だけを使い、作らない)
    if (!parent || diff('font-synthesis-weight')) s.synthesizeWeight = c('font-synthesis-weight') !== 'none';
    // oblique-only (§2.8.2): 斜め (font-style: oblique) のときだけ傾けて作り、italic のときは作らない
    if (!parent || diff('font-synthesis-style') || diff('font-style')) {
      const fss = c('font-synthesis-style');
      s.synthesizeStyle = fss !== 'none' && !(fss === 'oblique-only' && !c('font-style').startsWith('oblique'));
    }
    if (!parent || diff('font-synthesis-small-caps')) s.synthesizeSmallCaps = c('font-synthesis-small-caps') !== 'none';
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
      // -ah-text-justify-trim (アンテナハウスの拡張。どのスタイルでも読む。継承する): 追込みで詰めてよいアキ (textJustifyTrim.ts)
      const jtv = this.inh(el, 'text-justify-trim', true);
      if (jtv && jtv !== (parent ? this.inh(parent, 'text-justify-trim', true) : '')) {
        const jt = parseTextJustifyTrim(jtv);
        if (jt.invalid) this.miss(`-ah-text-justify-trim: ${jtv}`);
        else {
          for (const u of jt.unsupported) this.miss(`-ah-text-justify-trim: ${u}`);
          // auto は既定の詰め方 (AUTO_JUSTIFY_TRIM。祖先の指定を打ち消す)
          if (jt.trim) s.textJustifyTrim = jt.trim;
        }
      }
    }
    if (diff('font-stretch')) {
      const fsr = parseFloat(c('font-stretch'));
      // 親と違う値は、100% (normal) に戻す指定も渡す (渡さないと、親の幅を引き継いだままになる)
      if (fsr && /%$/.test(c('font-stretch')) && (fsr !== 100 || parent)) s.fontStretch = fsr / 100;
    }
    const lang = el.getAttribute?.('lang') ?? el.getAttribute?.('xml:lang');
    if (lang && !pseudo) s.language = lang;
    // アンテナハウスの -ah-lang (要素・::before・::after・::marker の言語)
    const ahLang = pdecl?.['-ah-lang']?.trim();
    if (ahLang) s.language = ahLang;
    return s;
  }

  /**
   * 要素が属する言語 (自身か祖先の lang / xml:lang)。アンテナハウスの拡張の -ah-lang (CSS で言語を指定する。XSL 1.1 §7.9.2 の language と同じ。
   * 受け継ぐ) も読み、同じ要素では lang 属性より優先する。pseudo を渡すと、その擬似要素 (::before・::after・::marker) の -ah-lang も見る
   */
  /**
   * タグ付き PDF: 要素の構造の型。undefined は構造を作らない (中身は親の構造に入る)、'Artifact' は飾り。
   * aria-hidden="true" の要素と、alt が空の画像・役が presentation の画像は飾り (WAI-ARIA 1.2 §6.6 aria-hidden・§5.3.3 presentation、
   * HTML Living Standard §4.8.4.4: alt が空の画像は飾り)
   */
  private structRole(el: Element): string | undefined {
    const name = el.localName;
    if (el.getAttribute('aria-hidden')?.trim() === 'true') return 'Artifact';
    const role = el.getAttribute('role')?.trim().toLowerCase().split(/\s+/)[0];
    // 画像として組む object (objectImage) は、img と同じ図。代わりの内容を組む object は、構造を作らない (中身は親の構造に入る)
    const objImage = name === 'object' && !!this.objectImage(el);
    if (role === 'presentation' || role === 'none') return name === 'img' || name === 'svg' || objImage ? 'Artifact' : undefined;
    // 並べるための表 (role="presentation" の table) の部分は、表の構造を作らない (中身は外の構造に入る)
    if (!role && TABLE_PART_ELEMENTS.has(name)) {
      const t = el.closest?.('table');
      const tr = t?.getAttribute('role')?.trim().toLowerCase().split(/\s+/)[0];
      if (tr === 'presentation' || tr === 'none') return undefined;
    }
    // 脚注 (float: footnote。CSS GCPM 3 §2.2) は注 (Note。ISO 32000-1 §14.8.4.4.1)。本文の参照の所に置く (flowFootnote)
    if (this.pg(el).float === 'footnote') return 'Note';
    if (role === 'heading') {
      // aria-level が無ければ 2 (WAI-ARIA 1.2 の heading の既定の値)
      const lv = parseInt(el.getAttribute('aria-level') ?? '2', 10);
      return `H${Math.min(Math.max(Number.isNaN(lv) ? 2 : lv, 1), 6)}`;
    }
    if (role && Object.hasOwn(ARIA_STRUCT_ROLES, role)) return ARIA_STRUCT_ROLES[role];
    if (Object.hasOwn(STRUCT_ROLES, name)) return STRUCT_ROLES[name];
    if (name === 'img') return el.getAttribute('alt') === '' ? 'Artifact' : 'Figure';
    if (objImage) return 'Figure';
    if (name === 'a' && el.hasAttribute('href')) return 'Link';
    // 割注 (割注として組む行内の要素。warichuOf) は Warichu (ISO 32000-1 §14.8.4.4)。中身は WT、前後の括弧は WP。
    // 役 (role)・リンク・図などの型を持つ要素は、その型のまま (割注の括弧は、その構造の中身になる)
    if (this.isWarichuElement(el) && this.hasWarichuContent(el)) return 'Warichu';
    if (name === 'a') return undefined;
    // 言語の変わる要素・略語: 言語 (Lang。ISO 32000-1 §14.9.2)・展開 (E。§14.9.5) は構造の節に書くので、Span を作る
    if (el.hasAttribute('lang') || el.hasAttribute('xml:lang')) return 'Span';
    if (name === 'abbr' && el.getAttribute('title')) return 'Span';
    // 絶対配置・固定配置の要素 (行内の span など): 中身をまとめる Span を作る。箱は後で描くが、構造の木では、書いた所 (目印。
    // flowPositioned の structMark) に置き、親の字の間に入れる (読む順は文書の順。ISO 32000-1 §14.8.2.3)。構造を作らないと、
    // 中身の字が親のじかの字になり、描いた順 (親の字の後ろ) に並ぶ
    if (/^(?:absolute|fixed)$/.test(this.cs(el)('position'))) return 'Span';
    return undefined;
  }

  /**
   * タグ付き PDF の脚注の構造 (StructureBuilder.footnote): 本文の参照の印は Reference、本体は、その後ろに置く注 (Note)、
   * 頭の番号は注の記号 (Lbl)
   */
  private footnoteStructure(fn: LFootnote, e: Element) {
    this.tagNode(fn, e);
    this.sb!.footnote(fn, this.st(e), true);
  }

  /**
   * 表のセルの構造の属性 (ISO 32000-1 §14.8.5.7 の Table 349): またぐ行・列の数と、見出しのセルの向き (Scope)。向きは scope 属性
   * (HTML §4.9.10: row・rowgroup は行、col・colgroup は列)、ARIA の rowheader・columnheader、無ければ HTML §4.9.12.2 の auto の決め方に
   * ならう: thead の中か、行のセルがみな見出しなら列、そうでなければ行
   */
  private cellAttrs(x: Element, role: string, n: Omit<StructNode, 'kids' | 'parent'>) {
    const cs = capSpan(parseInt(x.getAttribute('colspan') ?? '1', 10));
    const rs = parseInt(x.getAttribute('rowspan') ?? '1', 10);
    const tr = x.parentNode as Element | null;
    if (cs > 1) n.colSpan = cs;
    if (rs > 1) n.rowSpan = Math.min(MAX_ROW_SPAN, rs);
    else if (rs === 0 && tr?.localName === 'tr') n.rowSpan = Math.min(MAX_ROW_SPAN, this.rowsFrom(tr));
    if (role !== 'TH') return;
    const aria = x.getAttribute('role')?.trim().toLowerCase().split(/\s+/)[0];
    const sc = x.getAttribute('scope')?.trim().toLowerCase();
    if (aria === 'rowheader' || sc === 'row' || sc === 'rowgroup') n.scope = 'Row';
    else if (aria === 'columnheader' || sc === 'col' || sc === 'colgroup') n.scope = 'Column';
    else {
      const inHead = (tr?.parentNode as Element | null)?.localName === 'thead';
      n.scope = inHead || (!!tr && !this.rowHasTd(tr)) ? 'Column' : 'Row';
    }
  }

  /**
   * 行 tr の子に td があるか (行ごとに 1 度だけ調べて覚える。見出しのセルごとに行の子を全部たどると、1 行に見出しのセルを多く並べた表で
   * セルの数の 2 乗の手間になっていた)
   */
  private rowHasTd(tr: Element): boolean {
    let v = this.rowTd.get(tr);
    if (v === undefined) this.rowTd.set(tr, (v = Array.from(tr.children ?? []).some((c) => c.localName === 'td')));
    return v;
  }
  private rowTd = new WeakMap<Element, boolean>();

  /**
   * 要素の中身の入る構造の節の番号 (構造を作らない要素は、親の要素の番号。項目 (LI) の中の要素は、その LBody)。
   * 構造の木を作らないときは 0
   */
  private st(el: Element | null | undefined): number {
    if (!this.sb || !el || !el.getAttribute) return 0;
    return this.sb.st(el);
  }

  /** 要素の構造 (StructureBuilder の describe) */
  private structDesc(x: Element): StructDesc | 'Artifact' | undefined {
    const role = this.structRole(x);
    if (role === undefined || role === 'Artifact') return role;
    const n: StructDesc['node'] = { role };
    const lang = x.getAttribute('lang') || x.getAttribute('xml:lang');
    if (lang) n.lang = lang;
    // 代わりの説明: alt・aria-label・title (図)、alttext (数式。MathML Core §2.1)、SVG の title の子 (SVG 2 §5.9)
    if (role === 'Figure' && x.localName === 'object') {
      // 画像として組む object: 名前は aria-label (WAI-ARIA 1.2 §6.7 の aria-label)、無ければ title 属性 (HTML-AAM 1.0 §4.1 の、
      // 要素ごとの名前の決め方の、そのほかの要素の title。aria-labelledby は読まない (img と同じ))。中の代わりの内容は、
      // 画像を置けないときの中身 (HTML Living Standard §4.8.7) なので、代わりの文に使わない
      const alt = x.getAttribute('aria-label')?.trim() || x.getAttribute('title')?.trim();
      if (alt) n.alt = alt;
    } else if (role === 'Figure' || role === 'Formula') {
      const svgTitle = x.localName === 'svg' ? Array.from(x.children ?? []).find((c) => c.localName === 'title')?.textContent?.trim() : undefined;
      const alt = x.getAttribute('alt') || x.getAttribute('aria-label') || x.getAttribute('alttext') || svgTitle || x.getAttribute('title');
      if (alt) n.alt = alt;
    } else if (role === 'Link') {
      const label = x.getAttribute('aria-label') || x.getAttribute('title');
      if (label) n.alt = label;
    }
    if (x.localName === 'abbr' && x.getAttribute('title')) n.expansion = x.getAttribute('title')!;
    if (role === 'TH' || role === 'TD') this.cellAttrs(x, role, n);
    // 注 (Note) は ID を持つ (ISO 14289-1 §7.9)。要素の id、無ければ作る
    if (role === 'Note') n.sid = x.getAttribute('id') || `note-${this.sb!.nodes.length}`;
    const d: StructDesc = { node: n };
    const elId = x.getAttribute('id');
    if (elId) d.elementId = elId;
    const hs = x.getAttribute('headers')?.trim();
    if (hs) d.headers = hs.split(/\s+/);
    return d;
  }

  /** 要素の文書の順 (前順の番号。初めて引いたときに文書全体に振る) */
  private orderOf(el: Element): number {
    if (!this.elOrder.size) {
      // 文書の要素を前順にたどる (明示のスタック。DOM の getElementsByTagName('*') の添字で引くと、linkedom では 1 つ引くたびに
      // 前から数え直し、要素の数の 2 乗の手間になる)
      const root = (el.ownerDocument as Document | null)?.documentElement;
      const stack: Element[] = root ? [root] : [];
      let k = 0;
      while (stack.length) {
        const e = stack.pop()!;
        this.elOrder.set(e, k++);
        const kids = e.children;
        if (kids) for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
      }
    }
    return this.elOrder.get(el) ?? this.elOrder.size;
  }

  /** 項目 (LI) の構造の節の、記号 (Lbl) か本文 (LBody) の構造の節 (無ければ作る) */
  private liPart(li: number, part: 'lbl' | 'lbody'): number {
    return this.sb!.liPart(li, part);
  }

  /** 入力の節に、要素の構造の節の番号を付ける (付いていなければ。構造の木を作らないときは何もしない) */
  private tagNode<T>(node: T, el: Element): T {
    return this.sb ? this.sb.tag(node, el) : node;
  }

  private langOf(el: Element, pseudo?: string): string | undefined {
    const own = pseudo === '::before' || pseudo === '::after' || pseudo === '::marker' ? this.pagedPseudo.get(el)?.[pseudo]?.['-ah-lang']?.trim() : undefined;
    if (own) return own;
    for (let e: Element | null = el; e && e.getAttribute; e = e.parentNode as Element | null) {
      const v = this.pg(e)['-ah-lang']?.trim() || e.getAttribute('lang') || e.getAttribute('xml:lang');
      if (v) return v;
    }
    return undefined;
  }

  /**
   * text-align の inside・outside (アンテナハウスの拡張の値。-ah-text-align に書いたものと、互換の指定のときの text-align に
   * 書いたもの。互換の指定の無いときの text-align の inside・outside は、collectPaged が捨てている)。カスケードは CSS に無い値として
   * 捨てるので、自前で読んだ宣言 (pg。カスケードの勝ち負けは collectPaged が決めている) から取る。text-align は受け継ぐので、祖先をたどる:
   * 祖先との間で text-align の計算値が変わっていれば、間の要素が別の値を指定しているので、受け継がない
   */
  private insideOutsideAlign(el: Element, prop: 'text-align' | 'text-align-last' = 'text-align'): 'inside' | 'outside' | undefined {
    // 祖先を、計算値が同じ間だけさかのぼる。親の計算値が同じなら、答えは親の答えと同じなので、たどった要素の答えを覚える
    // (深い入れ子 (128 段) の段落が多い文書で、段落ごとに祖先をたどり直すと、段数 × 段落の数の手間になった)
    let memo = this.insideOutsideMemo.get(prop);
    if (!memo) this.insideOutsideMemo.set(prop, (memo = new WeakMap()));
    const own = this.cs(el)(prop);
    const chain: Node[] = [];
    let found: 'inside' | 'outside' | null = null;
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      if (e !== el && this.cs(e as Element)(prop) !== own) break;
      const known = memo.get(e);
      if (known !== undefined) {
        found = known;
        break;
      }
      chain.push(e);
      const v = this.pg(e as Element)[prop]?.trim().toLowerCase();
      if (v === 'inside' || v === 'outside') {
        found = v;
        break;
      }
    }
    for (const e of chain) memo.set(e, found);
    return found ?? undefined;
  }
  /** insideOutsideAlign の答え (性質ごと・要素ごと。null は無し) */
  private insideOutsideMemo = new Map<string, WeakMap<Node, 'inside' | 'outside' | null>>();

  /** 段落の書式 (揃え・字下げ・孤立行) */
  /**
   * -ah-last-line-end-indent の計算値 (pt)。指定した要素 (el か祖先) の字の大きさで em を解決した値を受け継ぐ (XSL 1.1 §7.16.3: 受け継ぐ。
   * 長さの計算値は絶対の長さ)。百分率 (含む領域の幅に対する割合) は読まない。指定が無ければ undefined
   */
  private lastLineEndIndentOf(el: Element, pseudo?: '::before' | '::after'): number | undefined {
    // ::before・::after の指定 (字の大きさは、その擬似要素のもの)
    const pv = pseudo ? this.pagedPseudo.get(el)?.[pseudo]?.['-ah-last-line-end-indent']?.trim().toLowerCase() : undefined;
    if (pv && pv !== 'inherit' && !/%$/.test(pv)) return lenEm(pv, cssLen(this.cs(el, pseudo)('font-size')) ?? 12);
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      const v = this.pg(e as Element)['-ah-last-line-end-indent']?.trim().toLowerCase();
      if (!v || v === 'inherit') continue;
      if (/%$/.test(v)) {
        this.miss(msg('-ah-last-line-end-indent の百分率', '-ah-last-line-end-indent (percentage)'));
        return undefined;
      }
      const m = /^(-?[\d.]+)rem$/.exec(v);
      const fs = cssLen(this.cs(m ? (el.ownerDocument?.documentElement ?? (e as Element)) : (e as Element))('font-size')) ?? 12;
      return m ? parseFloat(m[1]) * fs : lenEm(v, fs);
    }
    return undefined;
  }

  private paragraphStyle(el: Element, parent: Element | undefined): TextStyle {
    const c = this.cs(el);
    const p = parent ? this.cs(parent) : undefined;
    const diff = (prop: string) => !p || c(prop) !== p(prop);
    const s: TextStyle = {};
    // -webkit-center (Chrome の caption の既定) などは、接頭辞を除いて読む
    const ta = c('text-align').replace(/^-(webkit|internal)-/, '');
    if (diff('text-align') || diff('direction')) {
      const rtl = c('direction') === 'rtl';
      s.textAlign = ta === 'center' ? 'center' : ta === 'justify' || ta === 'justify-all' ? 'justify' : ta === 'end' || ta === (rtl ? 'left' : 'right') ? 'end' : 'start';
    }
    // text-align: inside・outside (アンテナハウスの拡張の値。-ah-text-align か、アンテナハウス互換のスタイルの text-align): ページのノドの側・小口の側にそろえる。
    // どちらの端かは、組むページで決まる (組版エンジンの TextAlign の inside・outside。XSL 1.1 §7.16.9)
    const io = this.insideOutsideAlign(el);
    if (io && (io !== (parent ? this.insideOutsideAlign(parent) : undefined) || s.textAlign !== undefined)) s.textAlign = io;
    // text-align-last の left・right も、text-align と同じく direction で start・end に読み替える (rtl では left が end)
    const tal = c('text-align-last');
    // text-align: justify-all (CSS Text 3 §6.1): 最後の行 (と強制改行の前の行) も両端をそろえる。text-align-last の指定があれば、そちら。
    // justify-all を受け継がない子 (text-align を指定し直した子) は、最後の行のそろえを auto の動き (§6.3) に戻す
    if ((!tal || tal === 'auto') && diff('text-align')) {
      if (ta === 'justify-all') s.textAlignLast = 'justify';
      else if (p && p('text-align') === 'justify-all' && s.textAlign) s.textAlignLast = s.textAlign === 'justify' ? 'start' : s.textAlign;
    }
    if ((diff('text-align-last') || diff('direction')) && tal && tal !== 'auto') {
      const rtl = c('direction') === 'rtl';
      s.textAlignLast = tal === 'center' ? 'center' : tal === 'justify' ? 'justify' : tal === 'end' || tal === (rtl ? 'left' : 'right') ? 'end' : 'start';
    }
    // text-align-last: inside・outside (text-align と同じ扱いの、アンテナハウスの拡張の値。-ah-text-align-last か、アンテナハウス互換の
    // スタイルの text-align-last): 最後の行を、ページのノドの側・小口の側にそろえる (XSL 1.1 §7.16.10)
    const iol = this.insideOutsideAlign(el, 'text-align-last');
    if (iol && (iol !== (parent ? this.insideOutsideAlign(parent, 'text-align-last') : undefined) || s.textAlignLast !== undefined)) s.textAlignLast = iol;
    if (diff('text-indent')) Object.assign(s, textIndentOf(c('text-indent')));
    // アンテナハウスの -ah-last-line-end-indent (XSL 1.1 §7.16.3 の last-line-end-indent と同じ。受け継ぐ): 最後の行の終わりの端の字下げ
    // (正で内へ、負で外へ)。接頭辞の付いた拡張なので、どのスタイルでも読む
    const lle = this.lastLineEndIndentOf(el);
    if (lle !== (parent ? this.lastLineEndIndentOf(parent) : undefined)) s.lastLineEndIndent = lle ?? 0;
    for (const k of ['orphans', 'widows'] as const) {
      const n = parseInt(c(k), 10);
      if (Number.isFinite(n) && diff(k)) s[k] = n;
    }
    // 折り返さない (text-wrap-mode: nowrap。white-space の nowrap・pre を含む: CSS Text 4 §3・§5.1)
    if (diff('text-wrap-mode') && c('text-wrap-mode') === 'nowrap') s.noWrap = true;
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
        color: (pseudo ? undefined : this.borderPrint(this.pg(el), sd)) ?? borderColorOf(c(`border-${sd}-color`)),
        ...(style !== 'solid' ? { style: style as BorderSide['style'], symmetric: true } : {}),
      };
    }
    if (Object.keys(border).length) o.border = border;
    const bg = (pseudo ? undefined : this.printOf(this.pg(el), 'background-color', 'background')) ?? cssColorAlpha(c('background-color'));
    if (bg) o.backgroundColor = bg;
    // 背景画像 (位置は百分率・長さ・キーワード、大きさは長さ・百分率・cover・contain)。グラデーションは組版で箱の大きさから画像にする。
    // 複数の背景 (CSS Backgrounds 3 §2.1) は、層ごとに画像・繰り返し・位置・大きさ・基準の領域 (origin)・描く範囲 (clip) を持つ
    const layers = backgroundLayers(c);
    const imgs: BackgroundImage[] = [];
    for (const L of layers) {
      const bimg = L.image;
      const bi = firstCssUrl(bimg);
      const grad = !bi || bimg.search(/(linear|radial|conic)-gradient\(/i) < bimg.search(/url\(/i) ? firstGradient(bimg) : undefined;
      if (!bi && !grad) continue;
      const img: BackgroundImage = grad ? { src: '', gradient: grad, gradientFontSize: cssLen(c('font-size')) ?? 12 } : { src: this.bgSrc(bi![1]) };
      const rep = L.repeat;
      if (rep === 'no-repeat' || rep === 'repeat-x' || rep === 'repeat-y') img.repeat = rep;
      else if (rep === 'no-repeat no-repeat') img.repeat = 'no-repeat';
      else if (rep === 'repeat no-repeat') img.repeat = 'repeat-x';
      else if (rep === 'no-repeat repeat') img.repeat = 'repeat-y';
      setBackgroundPosition(img, L.x, L.y);
      const bsz = L.size;
      if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
      // 百分率は、背景の領域 (padding box) の大きさに対して (ブラウザが置いた箱の大きさから)
      const r = /%/.test(bsz) ? this.src.rect?.(el) : undefined;
      const area = r && { w: (r.width - (parseFloat(c('border-left-width')) || 0) - (parseFloat(c('border-right-width')) || 0)) * PT_PER_PX, h: (r.height - (parseFloat(c('border-top-width')) || 0) - (parseFloat(c('border-bottom-width')) || 0)) * PT_PER_PX };
      // 百分率と長さの和 (calc(50% + 10px)。計算値は式のまま) も、百分率と長さに分けて読む (CSS Values 4 §10.11)
      const parts = splitTop(bsz, ' ').filter(Boolean);
      const pl = parts.map((v) => (/%/.test(v) ? percentPlusLength(v) : undefined));
      const size = parts.map((v, k) => (pl[k] ? (area ? (pl[k]!.pct / 100) * (k === 0 ? area.w : area.h) + pl[k]!.px * PT_PER_PX : undefined) : cssLen(v)));
      if (size[0] !== undefined) img.width = size[0];
      if (size[1] !== undefined) img.height = size[1];
      // ブラウザの配置が無いとき (コマンドで組むとき): 百分率は、組版で箱の大きさが決まってから長さにする (CSS Backgrounds 3 §2.9)
      if (!area && !img.size) {
        parts.forEach((_v, k) => {
          const p = pl[k];
          if (k > 1 || !p) return;
          img[k === 0 ? 'widthPct' : 'heightPct'] = p.pct / 100;
          if (p.px) img[k === 0 ? 'widthOffset' : 'heightOffset'] = p.px * PT_PER_PX;
        });
        if (img.widthPct !== undefined && (parts[1] ?? 'auto') === 'auto') img.pctAuto = 'height';
        else if (img.heightPct !== undefined && parts[0] === 'auto') img.pctAuto = 'width';
      }
      // 位置の基準の領域 (background-origin。CSS Backgrounds 3 §2.8。初期値は padding の箱) と、描く範囲 (background-clip。§2.7。
      // 初期値は border の箱: 罫線の下にも描く)。計算値どおりに渡す。組版エンジンの既定 (clip の欄なし) は padding の箱で、
      // XSL-FO の背景 (XSL 1.1 §4.9.4: 背景は padding の矩形に描く) がそれを使う
      if (L.origin === 'border-box' || L.origin === 'content-box') img.origin = L.origin;
      if (L.clip === 'content-box' || L.clip === 'border-box') img.clip = L.clip;
      // ページに固定する背景 (background-attachment: fixed。§2.5) は、箱に付く背景 (scroll) として描き、未対応として知らせる
      if (L.attachment === 'fixed') this.miss('background-attachment: fixed');
      imgs.push(img);
      if (!grad) this.report.images.push(img.src);
    }
    if (imgs.length) o.backgroundImage = imgs.length > 1 ? { ...imgs[0], under: imgs.slice(1) } : imgs[0];
    // 背景の色を塗る範囲は、いちばん後ろの層の background-clip (§2.2)。初期値 border-box は border の箱 (これまでどおり)
    const colorClip = layers[layers.length - 1]?.clip;
    if (bg && (colorClip === 'padding-box' || colorClip === 'content-box')) o.backgroundClip = colorClip;
    for (const prop of ['width', 'height'] as const) {
      if (pseudo ? c(prop) === 'auto' || !c(prop) : this.src.isAuto?.(el, prop) !== false) continue;
      const v = cssLen(c(prop));
      if (v !== undefined) o[prop] = v;
      // 百分率の指定 (calc() の中の百分率も) は、包含ブロックの大きさの見積もりから長さにした値。中身の幅を測るときは auto として扱う
      // (CSS Sizing 3 §5.2.1。BoxStyle.estimatedSize)
      if (v !== undefined && !pseudo && this.src.isPercent?.(el, prop)) o.estimatedSize = { ...o.estimatedSize, [prop]: {} };
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
      // 百分率の上限・下限は、中身の幅を測るときは none・0 (CSS Sizing 3 §5.2.1)
      const lenOnly = (p: 'max-width' | 'min-width', v: number | undefined) => (this.src.isPercent?.(el, p) ? undefined : v);
      if (o.width !== undefined) {
        // 指定の幅を、同じ box-sizing の上限・下限で抑える
        let w = o.width;
        if (mx !== undefined) w = Math.min(w, mx);
        if (mn !== undefined) w = Math.max(w, mn);
        o.width = w;
        // 百分率の幅を、中身の幅を測るときに auto として扱うなら、長さの上限・下限はそのまま当てる (CSS Sizing 3 §5.1)
        if (o.estimatedSize?.width) o.estimatedSize = { ...o.estimatedSize, width: estLimits(lenOnly('max-width', mx), lenOnly('min-width', mn)) };
      } else if ((mx !== undefined || mn !== undefined) && el.parentElement) {
        const own = this.src.contentWidth?.(el);
        const pcw = this.src.contentWidth?.(el.parentElement);
        if (own !== undefined && pcw !== undefined) {
          const mPx = (p: string) => (c(p) === 'auto' ? 0 : parseFloat(c(p)) || 0);
          const avail = pcw - mPx('margin-left') - mPx('margin-right');
          const ownBorderPx = own + hbPt / PT_PER_PX;
          if (Math.abs(ownBorderPx - avail) > 0.01) {
            o.width = own * PT_PER_PX + (bb ? hbPt : 0);
            // この幅は、auto の幅を見積もりの包含ブロックの幅で決めたもの。組むときは、置く場所の幅を長さの上限・下限で抑えた幅にする
            // (CSS 2.1 §10.4。見積もりと置く場所の幅が違う表のセルの中などで、はみ出さない)。中身の幅を測るときは auto として扱い、
            // 上限・下限で抑える (CSS Sizing 3 §5.1: max-content の寄与は max-width で頭打ち、min-width で底上げ)。百分率の上限・下限は、
            // 測るときは none・0 (§5.2.1)
            o.estimatedSize = { ...o.estimatedSize, width: { auto: true, ...estLimits(lenOnly('max-width', mx), lenOnly('min-width', mn)) } };
          }
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
      // 縦書きの流れの中の、縦書きのブロックの、inline の向き (高さ) が auto の箱: 長さの max-height・min-height (max-inline-size・min-inline-size)
      // は、置く場所の高さの上限・下限 (CSS 2.1 §10.4 を Writing Modes 4 §6.2 で読み替えたもの。横書きの max-width の estimatedSize と同じ)。
      // 前は当てず、置く場所の高さいっぱいに組んでいた
      if (vertB && !o.aspectRatio && !pseudo && !this.src.rect && o.height === undefined && /^(block|list-item|flow-root)$/.test(c('display')) && c('float') === 'none' && !/^(absolute|fixed)$/.test(c('position')) && el.parentElement && /^(vertical|sideways)/.test(this.cs(el.parentElement)('writing-mode'))) {
        const mxI = mxh;
        const mnI = mnh || undefined;
        if (mxI !== undefined || mnI !== undefined) o.estimatedSize = { ...o.estimatedSize, height: { auto: true, ...estLimits(mxI, mnI) } };
      }
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
    // 横書きの中の縦書きの箱 (直交する流れ) で、幅 (縦書きの block の大きさ) が中身で決まるもの: 幅は組むときに決まるので、
    // 左右の auto の余白は組むときに配る (CSS 2.1 §10.3.3。Writing Modes 3 §7.3: 直交する流れの箱の大きさは中身で決め、
    // そのうえで親の流れの中の箱として置く)
    if (!this.src.rect && o.width === undefined && cbEl && /^(vertical|tb)/.test(c('writing-mode')) && !/^(vertical|tb)/.test(this.cs(cbEl)('writing-mode'))) {
      const ms = c('margin-left') === 'auto';
      const me = c('margin-right') === 'auto';
      if (ms || me) o.autoMargins = ms && me ? 'center' : ms ? 'start' : 'end';
    }
    // 寄せるのは、包含ブロックの行の向き (CSS 2.1 §10.3.3 を、CSS Writing Modes 4 §7.1 で包含ブロックの書字方向の inline の軸に読む):
    // 縦書きの親の中では、上下の余白 (margin-top・margin-bottom) と高さ。左右の auto の余白は block の向きなので 0
    // (組版は、autoMargins を親の行の向きに配る。'start' は margin-left、縦書きの親では margin-top)
    const P = cbEl ? this.axisOf(cbEl) : (n: string) => n;
    const isz = o[P('width') as 'width' | 'height'];
    if (!this.src.rect && isz !== undefined && c(P('margin-left')) === 'auto' && c(P('margin-right')) === 'auto' && cbEl) {
      // 余白は組むときに、置く場所の幅から等分する。読み込みのときの包含ブロックの幅の見積もりから余白を長さにしておくと、
      // 表のセルの中 (見積もりは表の全体の幅に近い) で、列の幅を決める内容の幅 (min-content・max-content) にその余白が入り、
      // 列が広がり過ぎた。また、置く場所が見積もりより狭いと、余白が縮まずに箱がはみ出した
      o.autoMargins ??= 'center';
    }
    // 左右の一方だけが auto: 組むときに、残りをその余白に配る (margin-left が auto なら右へ寄る)
    else if (!this.src.rect && isz !== undefined && (c(P('margin-left')) === 'auto' || c(P('margin-right')) === 'auto')) {
      o.autoMargins ??= c(P('margin-left')) === 'auto' ? 'start' : 'end';
    }
    // HTML の center 要素・align 属性 (-webkit-center など) は、子孫のブロックもそろえる (HTML 5.2 §10.3.3・§10.3.9。
    // HTML Living Standard §15.3.3: 子孫のブロックの左右の余白を auto のように扱って寄せる)。
    // 幅の決まった箱で、左右の余白の指定が無い (0) ものを、親の中で寄せる。余白は margin: auto の箱と同じに、組むときに置く場所の幅から配る
    // (読み込みのときの包含ブロックの幅の見積もりから余白を長さにすると、表のセルの中 (見積もりは表の全体の幅に近い) で、その余白が
    // 列の幅を決める中身の幅に入ってほかの列が縮み、置く場所が見積もりより狭い inline-block・flex の項目・セルの中では、箱がはみ出した)。
    // 寄せた箱は、rtl の「右端から置く」決まりの外 (寄せる向きは text-align が決める。-webkit-left は、rtl でも左へ寄せる: 'end' は
    // margin-right が auto)。寄せるのはブロックの箱だけ (inline-block などの行内の箱は、行の text-align で寄る)
    else if (!this.src.rect && !pseudo && isz !== undefined && cbEl && c('float') === 'none' && !/^inline/.test(c('display')) && c(P('margin-left')) === '0px' && c(P('margin-right')) === '0px') {
      const pa = this.cs(cbEl)('text-align');
      const al = /^-webkit-(center|right|left)$/.exec(pa)?.[1];
      if (al) o.autoMargins ??= al === 'center' ? 'center' : al === 'right' ? 'start' : 'end';
    }
    // 内容による大きさ (CSS Sizing 3 §3.2 の min-content・max-content・fit-content、CSS Sizing 4 §3.2 の fit-content(<長さ>)):
    // 行の向きの大きさ (横書きの width・縦書きの height) とその上限・下限は、組むときに中身の幅を測って決める (inlineSizing)。
    // block の向きの大きさ (横書きの height・縦書きの width) では、ブロックの箱の min-content・max-content・fit-content は、どれも
    // 中身を組んだ後の大きさ (§2.1) なので、height は auto と同じ。min-height・max-height の語は、高さの指定のある箱だけに効く
    if (!replaced && !this.src.rect) {
      const B = this.axisOf(el);
      const kwOf = (p: string): ContentSizeKeyword | undefined => {
        const v = (c(B(p)) || '').trim().toLowerCase();
        if (v === 'min-content' || v === 'max-content' || v === 'fit-content') return v;
        const fc = /^fit-content\(\s*(-?[\d.]+px)\s*\)$/.exec(v);
        const len = fc ? cssLen(fc[1]) : undefined;
        return len !== undefined ? { fit: len } : undefined;
      };
      const vertB = B('height') === 'width';
      const edge = (a: 'left' | 'right' | 'top' | 'bottom') => (padding?.[a] ?? 0) + (border[a]?.width ?? 0);
      const bpI = vertB ? edge('top') + edge('bottom') : edge('left') + edge('right');
      const bb = c('box-sizing') === 'border-box';
      // fit-content(<長さ>) の長さは、box-sizing の箱の大きさ (§3.2: 長さ・百分率だけの値と同じに読む)。内容の箱の大きさに直す
      const inner = (k: ContentSizeKeyword | undefined) => (typeof k === 'object' && bb ? { fit: Math.max(0, k.fit - bpI) } : k);
      let size = inner(kwOf('width'));
      const min = inner(kwOf('min-width'));
      const max = inner(kwOf('max-width'));
      const disp = c('display');
      const outOfFlow = c('float') !== 'none' || /^(absolute|fixed)$/.test(c('position'));
      // 幅を中身で決める箱 (float・絶対配置・inline-block・表) の fit-content は、auto (shrink-to-fit。CSS 2.1 §10.3.5・§17.5.2) と同じ
      if (size === 'fit-content' && (outOfFlow || /^inline-/.test(disp) || disp === 'table')) size = undefined;
      // 横並びの flex の項目の主軸の大きさは、flex の計算で決める (width の語は、flex-basis の語として読む。flexLines)
      const pEl = pseudo ? el : el.parentElement;
      if (size && pEl && !outOfFlow && /^(inline-)?flex$/.test(this.display(pEl)) && !/^column/.test(this.cs(pEl)('flex-direction'))) size = undefined;
      // 語で大きさを決められる箱は、ブロックの箱 (block・list-item・flow-root・inline-block)。行内の箱には幅が効かない (CSS 2.1 §10.2)。
      // flex・grid の容器、表とその中の箱 (セル・行・列) の語の大きさは未対応 (auto として組み、知らせる)
      const sizable = /^(block|list-item|flow-root|inline-block)$/.test(disp);
      if ((size || min || max) && !sizable && disp !== 'inline' && disp !== 'contents' && disp !== 'none') {
        const name = /flex|grid/.test(disp) ? msg('flex・grid の容器', 'flex and grid containers') : msg('表とその中の箱', 'tables and boxes in them');
        for (const [p, k] of [['width', size], ['min-width', min], ['max-width', max]] as const) if (k) this.miss(`${B(p)}: ${typeof k === 'object' ? 'fit-content()' : k} (${name})`);
      }
      if ((size || min || max) && sizable) {
        o.inlineSizing = { ...(size ? { size } : {}), ...(min ? { min } : {}), ...(max ? { max } : {}) };
        // 長さの上限・下限も、組むときに当てる (内容の箱の大きさ)
        const numI = (p: string) => (/px$/.test(c(B(p))) ? Math.max(0, cssLen(c(B(p)))! - (bb ? bpI : 0)) : undefined);
        const mnI = numI('min-width');
        const mxI = numI('max-width');
        if (mnI) o.minInlineSize ??= mnI;
        if (mxI !== undefined) o.maxInlineSize ??= mxI;
        // 大きさの語があれば、カスケードの見積もりの幅 (上限・下限から出したもの) は使わない
        if (size) delete o[B('width') as 'width' | 'height'];
        // 組むときに幅が決まるので、行の向きの auto の余白も、組むときに配る (CSS 2.1 §10.3.3)
        const ms = c(B('margin-left')) === 'auto';
        const me = c(B('margin-right')) === 'auto';
        if (ms || me) o.autoMargins ??= ms && me ? 'center' : ms ? 'start' : 'end';
      }
      // block の向きの下限・上限の語: 高さの指定のある箱で、下限は「中身の高さまで伸びる」(min-height に高さを移し、height は auto)。
      // 上限は「中身の高さまで縮む」(max の語 + 高さ: 中身が少なければ中身の高さ) で、これは未対応として知らせる
      const kwB = (p: string) => /^(min-content|max-content|fit-content)/.test((c(B(p)) || '').trim().toLowerCase());
      const hp = B('height') as 'width' | 'height';
      if (o[hp] !== undefined && !o.aspectRatio) {
        if (kwB('max-height')) this.miss(msg(`${B('max-height')}: ${c(B('max-height')).trim().toLowerCase().replace(/\(.*$/, '()')} (${hp} の指定のある箱)`, `${B('max-height')}: ${c(B('max-height')).trim().toLowerCase().replace(/\(.*$/, '()')} (box with ${hp})`));
        else if (kwB('min-height')) {
          const bpB = vertB ? edge('left') + edge('right') : edge('top') + edge('bottom');
          o.minBlockSize = Math.max(o.minBlockSize ?? 0, o[hp]! - (bb ? bpB : 0));
          delete o[hp];
        }
      }
    }
    // 百分率の寸法 (BoxStyle.percent): 組むときに、箱を置く所の実際の包含ブロックの幅で解き直す (CSS 2.1 §10.2・§10.4・§8.3・§8.4)。
    // 上の値 (見積もりの包含ブロックの幅から長さにしたもの) は、組版エンジンが解かない所 (と、ブラウザの配置のあるとき) に使う
    if (!pseudo && !this.src.rect && this.src.percentOf) {
      const pr = percentBox(this.src.percentOf.bind(this.src, el), c, !replaced && !o.aspectRatio && !o.inlineSizing);
      if (pr) o.percent = pr;
    }
    const rad = this.radiusOf(c);
    if (rad) o.borderRadius = rad;
    const shadows = shadowsOf(c('box-shadow'), c('filter'));
    if (shadows.length) o.boxShadow = shadows.length === 1 ? shadows[0] : shadows;
    // box-decoration-break: clone (CSS Fragmentation 3 §5.4): ページ・段で分かれた断片のそれぞれを、罫線と内側の余白で包み直す
    // (初期値 slice は、切れ目に罫線も余白も入れない)。余白 (margin) は、ブロックの箱では切れ目で 0 に切り詰める (§5.4 の注)
    if (c('box-decoration-break') === 'clone') o.edgeRetain = { borderBefore: true, paddingBefore: true, borderAfter: true, paddingAfter: true };
    // 改ページ (break-before / after。left・right・recto・verso は偶数・奇数ページ。column は段組の文脈の中だけ。forcedBreak)
    const bb = this.forcedBreak(c('break-before') || c('page-break-before'), el);
    const ba = this.forcedBreak(c('break-after') || c('page-break-after'), el);
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
    // 描くときだけの効果 (transform・opacity)
    // (::first-letter には opacity だけが効く。CSS Pseudo 4 §2.3 の、効く性質の一覧に変換は無い)
    const fx = !pseudo || pseudo === '::before' || pseudo === '::after' || pseudo === '::first-letter' ? this.paintEffectOf(el, pseudo) : undefined;
    if (fx) o.paintEffect = fx;
    // visibility: hidden・collapse の箱は、背景・影を描かず、枠は太さを残して色を transparent にする (場所は変えない。CSS 2.1 §11.2)
    if (/^(hidden|collapse)$/.test(c('visibility'))) {
      delete o.backgroundColor;
      delete o.backgroundImage;
      delete o.backgroundClip;
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

  /**
   * 文字列の空白の扱い (white-space)。和文どうしの間の改行は詰める (CSS Text 3 の segment break の扱い)。
   * pseudo を渡すと、その疑似要素 (::before・::after) の white-space で扱う (生成した内容の文字列。下の pseudo を見る)
   */
  private text(raw: string, parent: Element, pseudo?: '::before' | '::after'): string {
    // 特殊な空白: 改行する幅の空白 (U+2000〜U+200A など) は普通の空白にする。改行しない U+202F・U+2007 はそのまま
    // (書体が持たなければ、決まった幅の空白として測る)
    // 生成した内容 (pseudo) の字は、作成者が逃がし (\2003 など) で選んだ字なので変えない。U+2000 だけは、改行の印 (SEG_BREAK) と紛れるので空白にする
    // 生成した内容の CR (\D) は空白と同じ (CSS Text 3 §4.1: CR (U+000D) は空白と同じに扱う)。
    // 文書の字の CR は、HTML の構文解析が改行 (LF) にするので、ここでは改行として扱う
    let t = raw.replace(pseudo ? /[\u2000\r]/g : /[\u2000-\u2006\u2008-\u200A\u205F]/g, ' ');
    // アンテナハウスの -ah-linefeed-treatment: ignore (XSL §7.16.7): 改行を捨てる (空白にもしない)
    if (this.inh(parent, 'linefeed-treatment', true) === 'ignore') t = t.replace(/\r\n?|\n/g, '');
    const ws = this.cs(parent, pseudo)('white-space') || 'normal';
    return whiteSpaceText(t, ws, !/full-width/.test(this.cs(parent, pseudo)('text-transform') || ''));
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
      if (!DOC_WS_ONLY.test(run)) {
        marks.push({ at: items.length, order: 0 });
        const fi: FlowItem[] = this.decorateText(this.text(run, e), e).map((v) => ({ v, block: false }));
        items.push({ v: { type: 'block', ...this.textStyle(e, el), children: this.collapseFlowWhitespace(fi, this.cs(e)('white-space')) } as LBlock, block: true });
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
      // 項目の page (名前付きのページ) では、ページを切り替えない (未対応として知らせる)
      this.pageIgnored(k, ['flex・grid の項目', 'flex and grid items']);
      const node = (this.isBlock(d, k) ? this.block(k, el) : undefined) ?? ({ type: 'block', ...this.textStyle(k, el), ...this.boxStyle(k), children: this.flexItemInline(k, el, false) } as LBlock);
      // 画像そのものが項目: 項目を包むブロックが、画像の幅・上限・下限 (百分率は容器の幅で解く) を持つので、画像はその幅で描く
      // (包むブロックの幅で、百分率をもう 1 度解かない。Flexbox 1 §9.2・CSS 2.1 §10.2)
      imageFillsItem(node, k);
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
      if (Array.from(e.childNodes).some((x) => (x.nodeType === 3 || x.nodeType === 4) && !DOC_WS_ONLY.test(x.textContent ?? ''))) return [n];
      if (this.hasPseudoContent(e, '::before') || this.hasPseudoContent(e, '::after')) return [n];
      return this.expandContents(Array.from(e.childNodes));
    });
  }

  /**
   * 字だけを持つ display: contents の要素 e の、元の字 (空白の処理の前)。子が文字の節・コメント・処理命令・display: none の要素・
   * 同じく字だけを持つ display: contents の要素だけで、e が ::before・::after を持たず、流れの外に出ないときに返す (ほかは undefined)。
   * そうした要素は箱を作らず、中の字がその場所に入る (CSS Display 3 §2.5) ので、まわりの続いた文字の並びの一部になる
   */
  private contentsText(e: Element): string | undefined {
    if (this.display(e) !== 'contents' || this.hasPseudoContent(e, '::before') || this.hasPseudoContent(e, '::after') || this.outOfFlow(e)) return undefined;
    let raw = '';
    for (const n of Array.from(e.childNodes)) {
      if (isTextNode(n)) raw += n.textContent ?? '';
      else if (n.nodeType === 1) {
        if (this.display(n as Element) === 'none') continue;
        const r = this.contentsText(n as Element);
        if (r === undefined) return undefined;
        raw += r;
      }
    }
    return raw;
  }

  /** 流し込む項目 (ブロックか行の中のもの) */
  /**
   * part を渡すと、el の子のうち part の節だけを流し込む (表・行の直下の、表の部分でない中身を包む無名のセル。CSS 2.1 §17.2.1)。
   * el そのものに付くもの (::before・::after、content での置き換え、参照先の記録、カウンターの有効範囲の終わり) は扱わない
   */
  /**
   * 要素の ::before・::after を items に置く。flex・grid の容器 (item) では、項目としてブロック化する (Flexbox 1 §4: ::before・::after も項目)。
   * 絶対配置の箱はそのまま置く
   */
  private flowPseudo(el: Element, which: '::before' | '::after', items: FlowItem[], item: boolean) {
    const at = items.length;
    this.pseudo(el, which, items);
    if (!item) return;
    const added = items.slice(at);
    if (!added.some((x) => !x.block && (typeof x.v !== 'string' || x.v.trim()))) return;
    items.splice(at, added.length, { v: { type: 'block', ...this.textStyle(el, el, which), ...this.boxStyle(el, which), children: added.map((x) => (x.block ? x.v : stripInlineFrame(x.v as LInlineLevel))) } as LBlock, block: true });
  }

  /**
   * flex・grid の項目にした行内の要素 (k。容器は el) の中身。項目はブロック化する (Flexbox 1 §4・CSS Grid 1 §6.1) ので、中身の並びの端は
   * 行の頭・終わりで、端の空白 (タグの直後の改行を含む) は消える (CSS Text 3 §4.1.2 の 1・3)。行内の要素の中身 (inline) は端の空白を残して読む
   * ので、ここで collapseAcrossInlines を掛ける。white-space が空白を残す項目 (pre・pre-wrap・break-spaces) では消さない。
   * strip: 罫線・内側の余白・背景・余白を、項目の箱に付けたので中身の行内の箱からは外す
   */
  private flexItemInline(k: Element, el: Element, strip: boolean): Array<LBlockLevel | LInlineLevel> {
    // 中のブロック (CSS 2.1 §9.2.1.1) は、行内の箱を分けて項目の中のブロックとして並べる (splitAtBlocks)
    const kids = this.ownFloatsIn(k, k, false, () => this.splitAtBlocks(this.inline(k, el), k).map((x) => x.v));
    const replaced = /^(img|object|svg)$/.test(k.localName);
    const out = strip ? kids.map((x) => (isBlockLevel(x) ? x : replaced && typeof x === 'object' && x.type === 'image' ? stripImageFrame(x) : stripInlineFrame(x as LInlineLevel))) : kids;
    return this.asBlockContent(out, k);
  }

  /**
   * 行内の要素 e の中身 (inline・flowChildren(e, true) の結果。端の空白を残して読んだもの) を、1 つのブロックの中身として仕上げる。
   * flex・grid の項目にした行内の要素・脚注の本体 (float: footnote)・柱に出す要素 (position: running()) の中身・行内の要素の回り込みは、
   * それ自体が 1 つのブロックの中身なので、ブロックの中身 (collapseFlowWhitespace の !inline) と同じ決まりで扱う: 行内の要素の境目を
   * またいで空白を詰め、行の頭・終わりの空白 (タグの直後の改行を含む) を消す (CSS Text 3 §4.1.1 の 4・§4.1.2 の 1・3)。節の端の改行は、
   * 境目をまたいだ前後の字で、空白にするか消す (§4.1.3。resolveSegmentBreaks)。white-space が空白を残す要素 (pre・pre-wrap・break-spaces)
   * では空白は消さず、中の空白を詰める行内の要素の、節の端の改行だけを決める
   */
  private asBlockContent(list: Array<LBlockLevel | LInlineLevel>, e: Element): Array<LBlockLevel | LInlineLevel> {
    if (/^(normal|nowrap|pre-line)$/.test(this.cs(e)('white-space') || 'normal')) collapseAcrossInlines(list);
    else resolveSegmentBreaks(list, false);
    return list;
  }

  /**
   * 行内の要素 e の箱の並び (inline の結果) を、中のブロックの前後で分ける (splitInlineAtBlocks。CSS 2.1 §9.2.1.1)。分けた所の辺は、
   * e の書字方向で決める (縦書きは上・下、横書きは左・右。右から左へ書く要素は右・左)
   */
  private splitAtBlocks(list: LInlineLevel[], e: Element): FlowItem[] {
    const c = this.cs(e);
    const vert = /^(vertical|sideways)/.test(c('writing-mode'));
    const [s, en] = vert ? (['top', 'bottom'] as const) : c('direction') === 'rtl' ? (['right', 'left'] as const) : (['left', 'right'] as const);
    const out: FlowItem[] = [];
    for (const n of list) pushAll(out, splitInlineAtBlocks(n, s, en));
    return out;
  }

  /**
   * 1 つのブロックの中身として組む要素 e (脚注の本体・柱に出す要素・flex・grid の項目にした行内の要素・行内の要素から作る float) の中身を
   * read で読み、中の行内の要素の中の float (pendingFloats) を、e の外 (包むブロックの並び) に出さずに、e の中身の並びに置く。
   * 外に出すと、脚注・柱・項目の中の float が、脚注の領域・柱・項目の外の本文に組まれる (CSS 2.1 §10.1 の 2: float の包含ブロックは、
   * いちばん近いブロックの容器の祖先。GCPM 3 §2.2: float: footnote の要素は、中身ごと脚注の領域に移される。GCPM 3 §1.2: running() の
   * 要素は、中身ごと本文から外れて余白の箱に置かれる。Flexbox 1 §4: flex の項目はブロックの容器)。
   * base: 中の float の受け継ぐ書式の基準 (中身を入れる箱の書式の元の要素。flowBlockEl)。
   * inPlace: e の直下の並び (flowChildren(e, true)) で、その場に置く (行内の子の後に置く。行内でない要素の中身と同じ)。
   * そうでない (inline(e) で行内の箱にして読む) ときは、行内の箱の子に入れると組版が読まずに捨てるので、返す floats を中身の並びの後に足す
   */
  private ownFloats<T>(e: Element, base: Element, inPlace: boolean, read: () => T): { v: T; floats: LFloat[] } {
    const prev = { pending: this.pendingFloats, block: this.flowBlockEl, home: this.floatHome };
    this.pendingFloats = [];
    this.flowBlockEl = base;
    this.floatHome = inPlace ? e : undefined;
    try {
      const v = read();
      return { v, floats: this.pendingFloats };
    } finally {
      this.pendingFloats = prev.pending;
      this.flowBlockEl = prev.block;
      this.floatHome = prev.home;
    }
  }

  /** ownFloats で読み、残った float を中身の並びの、書いた所の目印を含む子の後に置く (placeAtAnchors) */
  private ownFloatsIn(e: Element, base: Element, inPlace: boolean, read: () => Array<LBlockLevel | LInlineLevel>): Array<LBlockLevel | LInlineLevel> {
    const { v, floats } = this.ownFloats(e, base, inPlace, read);
    return floats.length ? placeAtAnchors(v, floats, (x) => x, (f) => f) : v;
  }

  /**
   * 行内の要素の中の float fv を、行内の要素を出た所に置くよう溜め (pendingFloats)、書いた所 (行内の要素の中身の並び items) に、
   * 中身の無い目印 (LInline.floatAnchor) を置く。組版は、目印を含む行を組むときに float を置く (CSS 2.1 §9.5.1 の規則 6・8)。
   * 目印は、行内の要素の中のブロックで並びを分けても (splitAtBlocks。CSS 2.1 §9.2.1.1)、書いた所の側の匿名のブロックに残る
   */
  private pendFloat(fv: LFloat, items: FlowItem[]) {
    const key = ++this.floatAnchorSeq;
    fv.inlineAnchor = key;
    items.push({ v: { type: 'inline', children: [], floatAnchor: key } as LInline, block: false });
    this.pendingFloats.push(fv);
  }

  private flowChildren(el: Element, inline = false, part?: Node[]): Array<LBlockLevel | LInlineLevel> {
    if (inline) return this.flowChildren0(el, inline, part);
    const prev = this.flowBlockEl;
    this.flowBlockEl = el;
    try {
      return this.flowChildren0(el, inline, part);
    } finally {
      this.flowBlockEl = prev;
    }
  }
  private flowChildren0(el: Element, inline: boolean, part?: Node[]): Array<LBlockLevel | LInlineLevel> {
    const items: FlowItem[] = [];
    // flex・grid の容器をふつうのブロックとして組むとき (縦並びの flex など) も、項目は order の順 (order-modified document order。
    // CSS Flexbox 1 §5.4) に並べる。::before・::after も項目 (§4)。項目ごとに items の区切り (at) と order を覚え、最後に並べ替える。
    // 続いた文字の並びは 1 つの無名の項目で、order は 0
    const flexBox = /^(inline-)?(flex|grid)$/.test(this.display(el));
    // 項目をブロック化するか: 行内の要素として組む (inline。display: inline-flex・inline-grid の要素を inlineBox が組むとき) ときはしない。
    // 行内の箱 (LInline) の子にブロックを入れると、組版がそれを置かず、中身が丸ごと消え、まわりの空白も行の境目として消える。
    // inline-flex・inline-grid は本来は行内の flex・grid の容器 (Flexbox 1 §3・CSS Grid 1 §5.1) だが、それとしては組まず、0.2.0 と同じに
    // 中身を行の中に組む (項目を横に並べた形に近い。縦並び・項目の間の空き・揃えは効かない)。
    // 行内の容器は行内水準の箱で、外の段落の行を分けない。ブロックになる項目 (ブロックの子・中にブロックを持つ行内の要素・リストの項目・表の部分) は、
    // 行の中の分けられない箱 (inline-block と同じ箱。幅は中身の幅、CSS 2.1 §10.3.9) にして横に並べる (下の flexInlineItems)。
    // 「inline-block の中の flex・grid の容器」としては組まない: ブラウザの配置を使わない組み方 (flexNoRect) は容器の幅を contentWidth から取るので、
    // grid の容器が行いっぱいになり後ろの字を次の行に送る、flex-grow の項目が重なる、などが起きる
    const blockify = flexBox && !inline;
    const inlineFlex = flexBox && inline;
    const marks: Array<{ at: number; order: number }> = [];
    /** 行内の flex・grid の容器の直下の、続いた文字の並びごとの項目と元の字 (flexInlineItems で使う) */
    const textRuns: TextRun[] = [];
    /**
     * いま続いている文字の並び。コメント・処理命令 (CSS Display 3 §1: CSS では、無いものとして扱う)・display: none の要素と、字だけを持つ
     * display: contents の要素 (CSS Display 3 §2.5: 中身がその場所に入る) は、並びを切らない。ほかの要素は切る
     */
    let openRun: TextRun | undefined;
    const runOf = (): TextRun => {
      if (!openRun) textRuns.push((openRun = { items: [], raw: '' }));
      return openRun;
    };
    const orderOf = (e: Element, ps?: '::before' | '::after') => (!ps && /^(absolute|fixed)$/.test(this.cs(e)('position')) ? 0 : parseInt(this.cs(e, ps)('order'), 10) || 0);
    if (flexBox) marks.push({ at: 0, order: orderOf(el, '::before') });
    this.lastPseudoText['::before'] = '';
    if (!part) this.flowPseudo(el, '::before', items, blockify);
    const before = this.lastPseudoText['::before'];
    // 参照先の番号は、要素 (と ::before) のカウンターを当てた直後の値
    let snap: Record<string, number> | undefined;
    let stacks: Record<string, number[]> | undefined;
    const elId = el.getAttribute?.('id');
    if (elId && !this.lookup && !part) {
      // カウンターの名前で引く (target-counter(…, constructor) など) ので、原型を持たない表にする
      snap = Object.create(null) as Record<string, number>;
      stacks = Object.create(null) as Record<string, number[]>;
      for (const [n, st] of this.counters)
        if (st.length) {
          snap[n] = st[st.length - 1].v;
          stacks[n] = st.map((x) => x.v);
        }
    }
    // 要素の content (normal 以外) は、中身を置き換える (Content 3 §1.2)。ただし空の文字列 ('') は、その要素に ::before / ::after の
    // content が無ければ何もしない (footer { content: '' } で中身を捨てない。ブラウザ・WeasyPrint は要素の文字列の content を解釈しない)
    const own = this.pg(el).content;
    const pseudoContent = (w: '::before' | '::after') => {
      const v = this.pagedPseudo.get(el)?.[w]?.content ?? this.cs(el, w)('content');
      return !!v && v !== 'none' && v !== 'normal';
    };
    const emptyOwn = own !== undefined && /^\s*(''|"")\s*$/.test(own) && !pseudoContent('::before') && !pseudoContent('::after');
    const replaced = own !== undefined && own !== 'normal' && own !== 'none' && !emptyOwn && !part;
    if (flexBox && replaced) marks.push({ at: items.length, order: 0 });
    if (replaced) for (const v of this.evalContent(el, parseContent(own))) items.push({ v, block: false });
    let kids = replaced ? [] : (part ?? Array.from(el.childNodes));
    // content-visibility: hidden は中身 (子孫の字と要素) を組まない (Contain 2 §4)
    if (this.cs(el)('content-visibility') === 'hidden') kids = [];
    // 閉じた details は、最初の summary の子だけを出す。ほかの中身は、content-visibility: hidden の slot に入る (HTML Living Standard §15.5.5)
    if (el.localName === 'details' && !el.hasAttribute('open')) {
      const sum = kids.find((n) => n.nodeType === 1 && (n as Element).localName === 'summary');
      kids = sum ? [sum] : [];
    }
    // display: contents の子 (直下に文字が無く、::before・::after も無いもの) は、その子を項目として並べる (CSS Display 3 §2.5)
    if (flexBox) kids = this.expandContents(kids) as ChildNode[];
    kids = joinTextAcrossComments(kids);
    let listStarted = false;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      // この子の並びの始まり (行内の子の中の float を、書いた所の目印を含む子の後に置くときに、ここから探す)
      const at0 = items.length;
      if (flexBox && (n.nodeType !== 3 || i === 0 || kids[i - 1].nodeType !== 3) && !(inlineFlex && isTextNode(n) && i > 0 && isTextNode(kids[i - 1]))) marks.push({ at: items.length, order: n.nodeType === 1 ? orderOf(n as Element) : 0 });
      if (n.nodeType === 3 || n.nodeType === 4) {
        if (blockify) {
          // flex・grid の容器の直下の、続いた文字の並びは、1 つの無名の項目 (ブロック)。空白だけの並びは項目にしない (Flexbox 1 §4)
          const fi: FlowItem[] = [];
          let raw = '';
          for (; i < kids.length && (kids[i].nodeType === 3 || kids[i].nodeType === 4); i++) {
            raw += kids[i].textContent ?? '';
            const t = this.text(kids[i].textContent ?? '', el);
            if (t) for (const v of this.decorateText(t, el)) fi.push({ v, block: false });
          }
          i--;
          // 空白だけかは、元の字 (空白の処理・字の変換の前) で見る。空白は document white space characters (空白・タブ・改行) だけで、
          // NBSP (U+00A0)・全角の空白 (U+3000) などは字 (Flexbox 1 §4・CSS Text 3 §4.1)
          if (!DOC_WS_ONLY.test(raw)) items.push({ v: { type: 'block', children: this.collapseFlowWhitespace(fi, this.cs(el)('white-space')) } as LBlock, block: true });
          continue;
        }
        if (inlineFlex) {
          // 行内の flex・grid の容器の直下の、続いた文字の並び (Flexbox 1 §4・CSS Grid 1 §6 の child text sequence) は、まとめて覚えておく。
          // ブロックの項目があれば、下の flexInlineItems が 1 つの無名の項目にする (空白だけの並びは組まない)。
          // 空白だけかは、空白の処理と字の変換の前の元の字 (raw) で見る (text() は節の端の改行を印 SEG_BREAK にし、text-transform: full-width は
          // 空白を全角の空白にする。CSS Text 3 §2.1: 字の変換は、空白の処理の詰める段 (§4.1.1) の後)
          const r = runOf();
          r.raw += n.textContent ?? '';
          const t = this.text(n.textContent ?? '', el);
          if (t)
            for (const v of this.decorateText(t, el)) {
              const it: FlowItem = { v, block: false };
              items.push(it);
              r.items.push(it);
            }
          continue;
        }
        const t = this.text(n.textContent ?? '', el);
        if (t) for (const v of this.decorateText(t, el)) items.push({ v, block: false });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const d = this.display(e);
      if (d === 'none') continue;
      // 字だけを持つ display: contents の要素の中身は、まわりの文字の並びに入れる (下の pushAll の所)。ほかの要素は並びを切る
      let joinRun: TextRun | undefined;
      let joinRaw: string | undefined;
      if (inlineFlex) {
        joinRaw = d === 'contents' ? this.contentsText(e) : undefined;
        if (joinRaw !== undefined) joinRun = runOf();
        else openRun = undefined;
      }
      // flex の容器の visibility: collapse の項目は、主軸から外す (Flexbox 1 §4.4)
      if (flexBox && /flex$/.test(this.display(el)) && this.cs(e)('visibility') === 'collapse') continue;
      const pg = this.pg(e);
      // 名前付きページ: ページの名前が変わるところで、ページシーケンスを分ける。page は class A の区切りを作る箱 (流れの中のブロック) に、
      // どの深さでも効き、auto の箱は親の値を使う (CSS Page 3 §8.1)。絶対配置・固定配置・float の箱は、ページの名前を変えない。
      // 見るのは、body から流れの中のふつうのブロック (pageFlowEls) だけをたどった箱 (表・flex・段組などの中は見ない)。
      // body の直下より深い所の切り替えは、run の終わりで、包む箱を分けて body の直下へ引き上げる (hoistPageSwitches)。
      // 見分け方 (pageSwitchBox・pageSwitchHolder) は、カスケードの百分率の幅の見積もり (cssCascade の cascadeStyles) と同じもの (pageFlow.ts)
      // running() の要素の中身 (inRunning) は、本文の流れから外した箱なので、ページの名前を変えない (切り替えも、いまの名前も進めない。
      // 進めると、後ろの箱の同じ名前の切り替えが消える)
      if (this.pageFlowEls.has(el) && !this.inRunning && pageSwitchBox(this.isBlock(d, e), this.cs(e)('position'), this.cs(e)('float'))) {
        // 入れ子の深さの上限 (MAX_TREE_DEPTH) の段の要素は、深すぎる入れ子を平らにしたとき (limitTreeDepth) に、子を後ろへ出された要素か、
        // 出された要素なので、page を書いた箱と、その中身だった箱の親子が切れている。そこでは名前を変えない (親の値を使う。
        // 名前のページに中身が残らず、空のページになるため。平らにしたことは、深い入れ子の警告で知らせる)
        const own = !this.atDepthLimit(e) ? ownPageName(pg.page) : undefined;
        const used = own ?? this.pageUsed.get(el) ?? '';
        this.pageUsed.set(e, used);
        this.flowPageSwitch(e, used, items, own !== undefined);
        // 中の箱も切り替えを置ける箱: ふつうのブロック (段組・表・flex・grid・リストの項目・置き換えの要素は除く)
        if (pageSwitchHolder(d, this.cs(e)('column-count'), this.cs(e)('column-width'), e.localName) && !this.inRunning) this.pageFlowEls.add(e);
      } else if (d !== 'list-item' && this.isBlock(d, e) && !/^(absolute|fixed)$/.test(this.cs(e)('position')) && (this.cs(e)('float') || 'none') === 'none') {
        // 切り替えを置けない所 (段組・表のセル・flex・grid の項目・リストの項目の中など) の箱の page は、黙って無視せず、未対応として知らせる
        // (リストの項目は list が見る)
        this.pageIgnored(e, ['段組・表のセル・flex・grid の項目などの中の箱', 'boxes in multi-column containers, table cells, flex and grid items and so on']);
      }
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
      if (this.flowFloat(e, el, pg, inline, items)) continue;
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
      if (this.flowPositioned(e, el, pos, items, inline)) {
        this.flushPendingAbs(el, inline, items);
        continue;
      }
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
      if (blockify && d === 'contents') {
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
      } else if (blockify) {
        // flex・grid の項目は、ブロック化する (Flexbox 1 §4・CSS Grid 1 §6.1・CSS Display 3 §2.7)。縦並びの flex の行内の要素 (span など) を、
        // 横に並べずに縦に積む。罫線・内側の余白・背景・余白は項目の箱に付け、中身の行内の箱からは外す (横並びの flexNoRect と同じ)
        const node = { type: 'block', ...this.textStyle(e, el), ...this.boxStyle(e), children: this.flexItemInline(e, el, true) } as LBlock;
        // 画像そのものが項目: 包むブロックが画像の幅を持つので、画像は、包むブロックの幅で描く (百分率を 2 度掛けない)。
        // 横書きの縦並びの flex の容器 (包むブロックは容器の幅いっぱい) では、画像の上限・下限の百分率を、容器の幅で解く (edge)
        const colFlex = /^column/.test(this.cs(el)('flex-direction') || '') && /flex$/.test(this.display(el)) && !/^(vertical|sideways)/.test(this.cs(el)('writing-mode'));
        const ed = (v: unknown, sd: 'left' | 'right') => (typeof v === 'number' ? v : ((v as Record<string, unknown> | undefined)?.[sd] as number | undefined) ?? 0);
        const bw = (sd: 'left' | 'right') => ((node.border as Record<string, { width?: number } | undefined> | undefined)?.[sd]?.width ?? 0);
        const edge = colFlex ? ed(node.margin, 'left') + ed(node.margin, 'right') + ed(node.padding, 'left') + ed(node.padding, 'right') + bw('left') + bw('right') : 0;
        imageFillsItem(node, e, true, false, edge);
        items.push({ v: this.withFlexGrow(node, e, el), block: true });
      } else {
        // 中にブロックを持つ行内の要素 (<span><p>…</p></span>・<a><div>…</div></a> など) は、ブロックの前後で分ける (CSS 2.1 §9.2.1.1)
        // 行内の flex・grid の容器の項目は、中の float を項目の中に組む (ownFloats。項目の外の行に出さない)
        const { v: split, floats: itemFloats } = inlineFlex ? this.ownFloats(e, el, false, () => this.splitAtBlocks(this.inline(e, el), e)) : { v: this.splitAtBlocks(this.inline(e, el), e), floats: [] as LFloat[] };
        // 行内の flex・grid の容器の項目にした行内の要素で、中にブロックか float を持つもの: 項目は 1 つのブロックの箱 (Flexbox 1 §4) なので、分けた並び
        // (と中の float) を中身にした、行の中の分けられない箱にする。罫線・内側の余白・背景・余白は箱に付け、中身の行内の箱からは外す (flexItemInline と同じ)
        if (inlineFlex && (split.some((x) => x.block) || itemFloats.length)) {
          const kids = this.asBlockContent(
            placeAtAnchors(
              split.map((x) => (x.block ? x.v : stripInlineFrame(x.v as LInlineLevel))),
              itemFloats,
              (x) => x,
              (f) => f,
            ),
            e,
          );
          const box = this.boxStyle(e);
          delete box.breakBefore;
          delete box.breakAfter;
          items.push({ v: { type: 'inline-container', decorateBox: false, baselineFrom: 'first', ...(box as Omit<LInlineContainer, 'type' | 'children'>), children: kids } as LInlineContainer, block: false });
        } else {
          pushAll(items, split);
          if (joinRun) {
            joinRun.raw += joinRaw;
            pushAll(joinRun.items, split);
          }
        }
      }
      if (!inline) for (const m of this.pendingMarkers.splice(0)) items.push({ v: m, block: false });
      // 行内の子の中の float は、行内でない要素の中身の並びか、1 つのブロックの中身にする要素 (floatHome) の直下の並びに置く (ownFloats)
      // 中のブロックで分けた並びでは、書いた所の目印のある匿名のブロックの側 (CSS 2.1 §9.2.1.1・§9.5.1 の規則 6)
      if ((!inline || el === this.floatHome) && this.pendingFloats.length) {
        const mine = placeAtAnchors(items.slice(at0), this.pendingFloats.splice(0), (x) => (x.block ? undefined : (x.v as LInlineLevel)), (f): FlowItem => ({ v: f, block: false }));
        items.splice(at0, items.length - at0, ...mine);
      }
      this.flushPendingAbs(el, inline, items, at0);
    }
    if (flexBox) marks.push({ at: items.length, order: orderOf(el, '::after') });
    this.lastPseudoText['::after'] = '';
    if (!part) this.flowPseudo(el, '::after', items, blockify);
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
        pushAll(out, g.v);
      }
      items.splice(0, items.length, ...out);
    }
    if (inlineFlex) this.flexInlineItems(items, textRuns, el);
    if (snap && elId) this.record.set(elId, { counters: snap, stacks: stacks!, text: this.wantText ? this.plainText(el) : '', before, after: this.lastPseudoText['::after'] });
    if (!part) this.leaveCounters(el);
    return this.collapseFlowWhitespace(items, this.cs(el)('white-space'), inline);
  }

  /**
   * 行内の要素として組む inline-flex・inline-grid の容器の中身 (items) の、流れの中のブロック (ブロックの子・リスト・表など) を、行の中の
   * 分けられない箱 (inline-block と同じ。幅は中身の幅) で包む。容器は行内水準の箱 (Flexbox 1 §3・CSS Grid 1 §5.1) で、外の段落の行を
   * 分けないので、ブロックの項目も行の中に横に並べる (ブロックのまま行内の箱の子に残すと、splitInlineAtBlocks が外の段落の行内の箱ごと
   * 前後で分け、項目が縦に積まれる)。箱の基線は、中の最初の行の基線 (flex の容器の基線は最初の項目の基線。Flexbox 1 §8.5)。
   * 高さの無い飛び先の印 (outOfFlowMarks) は包まない。
   *
   * ブロックの項目を包んだときは、直下の続いた文字の並び (textRuns) も項目として扱う (Flexbox 1 §4・CSS Grid 1 §6):
   * 空白 (white-space の効く字: 空白・タブ・改行。NBSP は含まない) だけの並びは、white-space の値に関わらず組まない (項目の間・容器の頭と
   * 終わりの改行と字下げが、行の中の空白の字にならない)。ほかの並びは、1 つの無名のブロックの項目にし、同じく分けられない箱で包む
   * (その頭・終わりの空白は、項目の行の頭・終わりの空白として消える。CSS Text 3 §4.1.2。white-space: pre・pre-wrap などでは残る)。
   * 空白だけかは、並びの元の字 (空白の処理・字の変換の前) で見る。並びは、コメント・display: none の要素・字だけを持つ display: contents の
   * 要素では切れない (flowChildren の openRun)。
   * 行内の要素だけの項目の容器 (ブロックの項目が無いもの) は、文字の並びを行の中に組んだままにする
   */
  private flexInlineItems(items: FlowItem[], textRuns: TextRun[], el: Element) {
    let wrapped = false;
    for (const it of items) {
      if (!it.block || !isInFlowBlock(it.v) || this.outOfFlowMarks.has(it.v as LBlock)) continue;
      it.v = { type: 'inline-container', decorateBox: false, baselineFrom: 'first', children: [it.v as LBlockLevel] } as LInlineContainer;
      it.block = false;
      wrapped = true;
    }
    if (!wrapped || !textRuns.length) return;
    const ws = this.cs(el)('white-space') || 'normal';
    // 並びの最初の項目を、無名の項目 (空白だけなら無し) に置き換え、残りの項目は除く
    const head = new Map<FlowItem, FlowItem | undefined>();
    const drop = new Set<FlowItem>();
    for (const { items: run, raw } of textRuns) {
      if (!run.length) continue;
      // 空白だけかは、元の字 (空白の処理・字の変換の前) で見る (Flexbox 1 §4: document white space characters だけの並び)
      const blank = /^[ \t\n\r\f]*$/.test(raw);
      // 並びの中の、コメントなどで分かれた文字の節のつなぎ目の空白は、collapseFlowWhitespace (joinTextItems) が詰める
      const anon = { type: 'block', children: this.collapseFlowWhitespace(run, ws) } as LBlock;
      head.set(run[0], blank ? undefined : { v: { type: 'inline-container', decorateBox: false, baselineFrom: 'first', children: [anon] } as LInlineContainer, block: false });
      for (const x of run.slice(1)) drop.add(x);
    }
    const out: FlowItem[] = [];
    for (const it of items) {
      if (drop.has(it)) continue;
      if (!head.has(it)) out.push(it);
      else {
        const r = head.get(it);
        if (r) out.push(r);
      }
    }
    items.splice(0, items.length, ...out);
  }

  /**
   * 行内の要素の中で見つけた絶対配置の箱 (pendingAbs) を、el の中身の並びに置く。行内の要素の中 (inline) では置かない。
   * 行内の箱を基準にする箱は、基準の要素の外に出てから置く (el が基準の要素か、その中なら、まだ置かない)
   */
  private flushPendingAbs(el: Element, inline: boolean, items: FlowItem[], from = items.length) {
    if (inline || !this.pendingAbs.length) return;
    const keep: LBlockContainer[] = [];
    const out: LBlockContainer[] = [];
    for (const a of this.pendingAbs) {
      const cbEl = this.inlineCbEl.get(a);
      let inside = false;
      for (let p: Element | null = el; cbEl && p; p = p.parentElement) if (p === cbEl) inside = true;
      if (inside) keep.push(a);
      else out.push(a);
    }
    this.pendingAbs = keep;
    if (!out.length) return;
    // 見つけた所に目印のある箱は、目印を含む子の後 (中のブロックで分けた並びでは、見つけた所の側の匿名のブロック) に置く
    const mine = placeAtAnchors(items.slice(from), out, (x) => (x.block ? undefined : (x.v as LInlineLevel)), (a): FlowItem => ({ v: a, block: false }));
    items.splice(from, items.length - from, ...mine);
  }

  /** マーカー (string-set・running) を置く: インラインの中なら段落の外へ出す (pendingMarkers)、ブロックの中ならその場所に */
  private pushMarker(m: LMarker, inline: boolean, items: FlowItem[]) {
    if (inline) this.pendingMarkers.push(m);
    else items.push({ v: m, block: false });
  }

  /**
   * body の直下より深い所のページの切り替え (page-switch) を、body の直下へ引き上げる: 切り替えを含むブロックを、切り替えの所で分ける
   * (CSS Page 3 §8.1: ページの名前は、入れ子の箱の間の class A の区切りでも変わる)。分けた断片は、元の箱の書式を持ち、
   * 書字方向の始め側の余白・罫線・内側の余白・id・前の区切りは最初の断片だけに、終わり側のものと後の区切りは最後の断片だけに残す
   * (箱がページの境で分かれるときと同じ。CSS Break 3 §5.4 の box-decoration-break: slice)。流れの中の中身の無い断片は作らない
   */
  private hoistPageSwitches(items: Array<LBlockLevel | LInlineLevel>): Array<LBlockLevel | LInlineLevel> {
    const isSw = (x: unknown) => typeof x === 'object' && x !== null && (x as PageSwitch).type === 'page-switch';
    const has = (x: unknown): boolean => typeof x === 'object' && x !== null && (x as LBlock).type === 'block' && (x as LBlock).children.some((c) => isSw(c) || has(c));
    if (!items.some(has)) return items;
    const wm = this.pageWm[0];
    const [bs, be] = /^vertical-lr|^sideways-lr/.test(wm) ? (['left', 'right'] as const) : /^(vertical|sideways)/.test(wm) ? (['right', 'left'] as const) : (['top', 'bottom'] as const);
    /** 余白・罫線の片方の辺を外す (全周の値は辺ごとの値にしてから) */
    const drop = <T>(v: T | undefined, side: 'top' | 'right' | 'bottom' | 'left', border: boolean): T | undefined => {
      if (v === undefined) return v;
      const all = typeof v === 'number' || (border && typeof (v as { width?: unknown }).width === 'number') ? { top: v, right: v, bottom: v, left: v } : { ...(v as object) };
      delete (all as Record<string, unknown>)[side];
      return all as T;
    };
    const split = (b: LBlock): Array<LBlockLevel | LInlineLevel> => {
      // 切り替えの所で、子を組に分ける (中の切り替えを含むブロックは、先に分けて並べる)
      const parts: Array<Array<LBlockLevel | LInlineLevel> | PageSwitch> = [[]];
      const cur = () => parts[parts.length - 1] as Array<LBlockLevel | LInlineLevel>;
      for (const c of b.children as Array<LBlockLevel | LInlineLevel>) {
        const flat = isSw(c) ? [c] : has(c) ? split(c as LBlock) : [c];
        for (const x of flat) {
          if (isSw(x)) parts.push(x as unknown as PageSwitch, []);
          else cur().push(x);
        }
      }
      const groups = parts.filter((p): p is Array<LBlockLevel | LInlineLevel> => Array.isArray(p));
      const live = groups.filter((g) => g.some((x) => this.inFlowItem(x)));
      const first = live[0];
      const last = live[live.length - 1];
      const out: Array<LBlockLevel | LInlineLevel> = [];
      for (const p of parts) {
        if (!Array.isArray(p)) {
          out.push(p as unknown as LBlockLevel);
          continue;
        }
        // 流れの中の中身の無い組 (空白・目印だけ) は、箱にせず、そのまま並べる
        if (!live.includes(p)) {
          out.push(...p.filter((x) => typeof x !== 'string'));
          continue;
        }
        const { children: _c, ...props } = b;
        const frag: LBlock = { ...props, children: p } as LBlock;
        // box-decoration-break: clone の箱は、分けた所の辺にも罫線・内側の余白を付ける (ページの境で分かれるときと同じ。CSS Break 3 §5.4)
        const er = frag.edgeRetain;
        if (p !== first) {
          delete frag.id;
          delete frag.breakBefore;
          delete frag.keepWithPrevious;
          frag.margin = drop(frag.margin, bs, false);
          if (!er?.paddingBefore) frag.padding = drop(frag.padding, bs, false);
          if (!er?.borderBefore) frag.border = drop(frag.border, bs, true);
          // block の向きの大きさの指定 (height・min-height・max-height・aspect-ratio) は、分ける前の箱の全体の大きさなので、最初の断片だけに
          // 残す (CSS Break 3 §5.3: 区切りで押し出された分も、箱の大きさの指定に数える。§5.4 の slice: 区切りが無いものとして組んでから切る)。
          // 後の断片に写すと、断片ごとに同じ高さを取り直す
          delete frag[/^(vertical|sideways)/.test(frag.writingMode ?? wm) ? 'width' : 'height'];
          delete frag.minBlockSize;
          delete frag.maxBlockSize;
          delete frag.aspectRatio;
        }
        if (p !== last) {
          delete frag.breakAfter;
          delete frag.keepWithNext;
          frag.margin = drop(frag.margin, be, false);
          if (!er?.paddingAfter) frag.padding = drop(frag.padding, be, false);
          if (!er?.borderAfter) frag.border = drop(frag.border, be, true);
        }
        out.push(frag);
      }
      return out;
    };
    return items.flatMap((x) => (has(x) ? split(x as LBlock) : [x]));
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

  /** 名前付きページの切り替えを置ける箱の並びを持つ要素 (body と、その中の流れの中のふつうのブロック) */
  private pageFlowEls = new WeakSet<Element>();
  /** 要素が、入れ子の深さの上限 (MAX_TREE_DEPTH。html 要素を 1 と数える) の段にあるか (それより深い要素は、読み込みの前に平らにしてある) */
  private atDepthLimit(e: Element): boolean {
    let depth = 1;
    const max = nestLimit(MAX_TREE_DEPTH);
    for (let p = e.parentElement; p && depth < max; p = p.parentElement) depth++;
    return depth >= max;
  }
  /** 流れの中のブロックの、ページの名前の使用値 (page が auto なら親の値。CSS Page 3 §8.1) */
  private pageUsed = new WeakMap<Element, string>();

  /** 名前付きページ: 流れの中のブロック e (ページの名前の使用値 name) で、ページの名前が変わるところにページシーケンスの切り替え (page-switch) を置く */
  private flowPageSwitch(e: Element, name: string, items: FlowItem[], named = true) {
    const sw = this.pageSwitchAt(e, name, named);
    if (sw) items.push({ v: sw as unknown as LBlockLevel, block: true });
  }

  /**
   * リストの 2 番目より後ろの項目 li の、名前付きのページの切り替え (最初の項目は flowChildren が見る)。名前の読み方 (ownPageName) と、
   * 入れ子の深さの上限の段の扱い (名前を変えず、親の値を使う) は、flowChildren の流れの中の箱と同じ
   */
  private listItemPageSwitch(li: Element, container: Element): PageSwitch | undefined {
    const own = !this.atDepthLimit(li) ? ownPageName(this.pg(li).page) : undefined;
    const used = own ?? this.pageUsed.get(container) ?? '';
    this.pageUsed.set(li, used);
    return this.pageSwitchAt(li, used, own !== undefined);
  }

  /**
   * 要素の counter-reset・counter-set の page の値 (ページ番号の振り直し。無ければ undefined)。当てる順は enterCounters と同じ
   * (Lists 3 §4: reset の後に set)。カウンターの名前は全体で見る (pagenote・page-x は page ではない)
   */
  private pageCounterStart(e: Element): number | undefined {
    let v: number | undefined;
    for (const p of ['counter-reset', 'counter-set']) {
      const m = /(?:^|\s)page(?![-\w\u0080-\uffff])(?:\s+(-?\d+))?/.exec(this.cs(e)(p));
      if (m) v = m[1] !== undefined ? Math.max(1, parseInt(m[1], 10)) : 1;
    }
    return v;
  }

  /** 流れの中の箱 e (ページの名前の使用値 name) の前に置く、ページシーケンスの切り替え (名前が変わらなければ undefined)。いまの名前を進める */
  private pageSwitchAt(e: Element, name: string, named: boolean): PageSwitch | undefined {
    // アンテナハウス互換: 同じ名前でも、強制改ページを持つ要素ごとに新しいページの組にする (pageGroupFirst)。page を自分で書いた要素だけ
    // (auto で親の名前を使う、入れ子の要素の改ページでは、組を分けない)
    const forced = /^(page|left|right|recto|verso|always)$/.test(this.cs(e)('break-before') || this.cs(e)('page-break-before') || '');
    const initial = this.pageCounterStart(e);
    // page を自分で書いた、強制の改ページのある箱のページ番号の振り直し (counter-reset・counter-set の page) は、名前が変わらなくても
    // その改ページから効かせる (振り直しは、ページの組の切り替えで渡す。名前が同じでも組を分ける)。body { page: x } の文書で、
    // 同じ名前を書いた章の箱の振り直しが、名前の切り替わる文書 (body に page を書かない) と同じに効くように
    const first = !this.pageSwitchSeen;
    this.pageSwitchSeen = true;
    // :nth(An+B of 名前) (CSS GCPM 3 §3.1) の順は、ページの組 (§3.2: page と強制の改ページを持つ要素 1 つが作るページの並び。名前ではなく
    // 要素ごと) の中の順なので、その名前の :nth(… of 名前) があれば、名前が変わらなくても、組ごとにシーケンスを分ける (章ごとに :nth(1 of 章) を当てる)
    const group = named && forced && !!name && this.nthOfNames().has(name);
    const split = name !== this.curPage || (named && forced && (initial !== undefined || (this.opts.pageGroupFirst && name)));
    if (split || group) {
      const sw: PageSwitch = { type: 'page-switch', page: name };
      if (initial !== undefined) sw.initial = initial;
      if (!split) sw.sameRun = true;
      this.curPage = name;
      return sw;
    }
    // 最初の流れの箱の振り直しは、名前が最初のページと同じで、強制の改ページが無くても、最初の組の番号にする (いまのページの名前は、
    // 最初の組の名前から始めるので、切り替えは入れない。切り替えを入れると、前の字 (body の最初の中身が字のとき) との間で改ページする)
    if (first && initial !== undefined) this.firstPageInitial = initial;
    return undefined;
  }

  /** :nth(An+B of 名前) を書いた @page の規則の、of の名前 (ページの組ごとにシーケンスを分ける名前) */
  private nthOf?: Set<string>;
  private nthOfNames(): Set<string> {
    if (!this.nthOf) {
      this.nthOf = new Set();
      for (const r of this.sheet.pages)
        for (const p of r.pseudos) {
          const of = p.startsWith('nth(') ? parseNthKey(p)?.of : undefined;
          if (of !== undefined) this.nthOf.add(of);
        }
    }
    return this.nthOf;
  }

  /** 要素 e の箱が置かれるページの名前: いちばん近い、流れの中の箱の祖先のページの名前の使用値 (無ければ文書の最初のページの名前) */
  private pageUsedAround(e: Element): string {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const u = this.pageUsed.get(p);
      if (u !== undefined) return u;
    }
    return this.rootPage;
  }

  /**
   * ページの名前を切り替えられない所 (段組・表のセル・flex・grid の項目の中など) の箱に書いた page (名前付きのページ): 未対応として知らせる
   * (CSS Page 3 §8.1: page は、class A の区切りを作る流れの中の block-level の箱に当たる。Kumiori は、body から流れの中のふつうのブロックと、
   * リストの項目をたどった箱でだけ切り替える)。where は箱の種類 (日本語・英語)
   */
  private pageIgnored(e: Element, where: [string, string]) {
    // その所で使われているページの名前と同じなら、切り替えが要らない (無視しても結果は同じ) ので、知らせない
    const v = ownPageName(this.pg(e).page);
    if (v !== undefined && v !== this.pageUsedAround(e) && !this.inRunning) this.miss(msg(`page (${where[0]})`, `page (${where[1]})`));
  }

  /** position: running(name): 本文から外し、余白の箱の element(name) で出す。扱ったら true */
  private flowRunning(e: Element, parent: Element, d: string, pg: Record<string, string>, inline: boolean, items: FlowItem[]): boolean {
    const run = /running\(\s*([-\w\u0080-\uffff]+)\s*\)/.exec(pg.position ?? '');
    if (!run) return false;
    this.inRunning = true;
    // アンテナハウス互換: 要素に font-family の指定が無ければ (親と同じ値なら)、書体は、この要素を出す余白の箱から受け継ぐ
    // (指定の有無は、計算値が親と同じかどうかで見る。親と同じ書体を自分に指定した要素は、指定の無いものと見分けない)
    const ctxFamily = this.opts.runningFontFromPageContextAh && this.cs(e)('font-family') === this.cs(parent)('font-family') ? this.runningContextFamily(run[1]) : undefined;
    if (ctxFamily) this.runningFamily = { from: this.cs(e)('font-family'), names: ctxFamily };
    // 横へ寄せる指定 (-ah-float-x の left・right・start・end・inside・outside。ahFloatX) のある要素は、余白の箱の中でも回り込みの箱として置く:
    // 余白の箱の内容の端 (inside はノドの側、outside は小口の側。ページの偶奇で決まる) に寄り、余白の箱より幅の広い箱は、反対の側へはみ出す
    // (CSS 2.1 §9.5.1 の規則 1 と、その右の float への読み替え: 右の float の右の外端は、包含ブロックの右端より右に出ない。箱が広くて入らない分は、
    // 左へ出る)。ページの外へ出た分は、塗り足しの端で切れる。
    // 小口の余白に置く章の印 (ツメ) を、左右のページで対称に出す書き方 (-ah-float-x: inside)
    const side = this.ahFloatX(pg, true);
    const content = side ? this.float(e, parent, side) : this.isBlock(d, e) ? this.block(e, parent) : ({ type: 'block', children: this.asBlockContent(this.ownFloatsIn(e, parent, false, () => this.splitAtBlocks(this.inline(e, parent), e).map((x) => x.v)), e) } as LBlock);
    this.inRunning = false;
    this.runningFamily = undefined;
    const m: LMarker = { type: 'marker', className: `running:${run[1]}`, children: content ? [content] : [] };
    this.pushMarker(m, inline, items);
    return true;
  }

  /** 余白の箱から書体を受け継ぐ running() の要素を組んでいる間の、読み替え (from: 元の場所から受け継いだ font-family の計算値、names: 余白の箱の書体の名前) */
  private runningFamily?: { from: string; names: string[] };

  /**
   * running(name) の要素を出す余白の箱 (content に element(name) を持つ箱) の font-family の名前の並び: 箱の宣言、無ければ、その箱のページの
   * ページ文脈 (@page) の宣言 (CSS Page 3 §6: 余白の箱はページ文脈から受け継ぐ)。どの箱でも同じ指定のときだけ返す (違う・無い箱があれば undefined)
   */
  private runningContextFamily(name: string): string[] | undefined {
    const found = new Set<string>();
    // 名前は識別子の字 (英数字・_・-・非 ASCII) だけなので、正規表現にそのまま入れられる
    const uses = new RegExp(`element\\(\\s*${name}\\s*[,)]`);
    for (const pageName of new Set<string | undefined>([undefined, ...this.pageRules.map((r) => r.name)]))
      for (const first of [false, true])
        for (const side of [undefined, 'left', 'right'] as const) {
          const r = resolvePageRules(this.pageRules, { name: pageName, first, side }, ...this.pageWm);
          const ctx = marginTextDecls(r.decls)['font-family'];
          for (const box of Object.values(r.boxes)) {
            if (!uses.test(box.content ?? '')) continue;
            const fam = marginTextDecls(box)['font-family'] ?? ctx;
            if (!fam) return undefined;
            found.add(fam.trim());
          }
        }
    if (found.size !== 1) return undefined;
    return [...found][0]
      .split(',')
      .map((n) => n.replace(/['"]/g, '').trim())
      .filter(Boolean);
  }

  /** float: footnote: 脚注 (参照記号は自動の連番)。扱ったら true */
  private flowFootnote(e: Element, parent: Element, pg: Record<string, string>, items: FlowItem[]): boolean {
    if (pg.float !== 'footnote') return false;
    this.report.counts.footnotes++;
    // 脚注の本文は、要素の書式 (字の大きさ・行送り・揃え) で組む (書式は脚注に付ける。本文の前に番号が付く)
    // 段落の書式 (揃え・字下げ) は親と比べずに全部渡す (脚注の領域の既定は始め揃えなので、親と同じ両端揃えでも渡す)
    const fn: LFootnote = { type: 'footnote', ...this.textStyle(e, parent), ...this.paragraphStyle(e, undefined), children: this.asBlockContent(this.ownFloatsIn(e, e, true, () => this.flowChildren(e, true)), e) };
    // 参照番号 (::footnote-call) は、脚注の要素の場所に差し込む擬似要素 (GCPM 3 §2.2・§2.6)。元の脚注の要素から受け継ぐと読み、字の大きさ・太さは脚注の要素の値を
    // ::footnote-call の規則で上書きする (見出しの中の脚注でも、見出しの太字・字の大きさにはならない)
    Object.assign(fn, this.footnoteCallStyle(e, parent));
    // 番号の書式は、この要素に当たる ::footnote-call・::footnote-marker の content (脚注ごとに違ってよい)
    Object.assign(fn, this.footnoteFormatOf(e));
    // footnote-policy (CSS GCPM 3 §2.8): line・block は、脚注が入らないとき、参照の行・段落の前で改ページする
    const policy = (pg['footnote-policy'] ?? '').trim().toLowerCase();
    if (policy === 'line' || policy === 'block') fn.policy = policy;
    // footnote-display (CSS GCPM 3 §2.3): inline は、脚注の要素を行内の要素として脚注の領域に置く (同じ脚注の領域の脚注を 1 つの段落のように続けて組む)。
    // compact は、1 行に収まる脚注を行内に、収まらない脚注をブロックにする。行内の箱の罫線・内側の余白・行の進む方向の margin・背景は、
    // 脚注の要素の値 (CSS 2.1 §8.3・§8.4: 行内の箱の行の進む方向の margin・padding は効く)
    const display = (pg['footnote-display'] ?? '').trim().toLowerCase();
    if (display === 'inline' || display === 'compact') {
      fn.footnoteDisplay = display;
      const box: LInline = { type: 'inline', children: [] };
      this.inlineBoxInto(box, e, parent);
      const ib: NonNullable<LFootnote['inlineBox']> = {};
      if (box.border) ib.border = box.border;
      if (box.padding) ib.padding = box.padding;
      if (box.inlineMargin) ib.inlineMargin = box.inlineMargin;
      if (box.backgroundColor) ib.backgroundColor = box.backgroundColor;
      if (Object.keys(ib).length) fn.inlineBox = ib;
    }
    if (this.struct) this.footnoteStructure(fn, e);
    items.push({ v: fn, block: false });
    return true;
  }

  /**
   * 行内の置換要素 (img・行内の svg・画像の object) の箱の書式: 罫線・内側の余白・背景色と、4 辺の margin を、画像の箱そのものに付ける
   * (組版が包んで、行の中の送りと行の高さに入れる。CSS 2.1 §8.3・§10.8)
   */
  private replacedBox(el: Element, img: LImage): LImage {
    // 要素そのものがブロック・回り込みとして置かれる (display: block・float) ときは、その箱 (ブロックの画像の箱・回り込みの箱) が
    // 罫線・余白・margin を持つので、画像には付けない (二重にしない)
    const disp = this.display(el);
    if (!/^inline/.test(disp) || this.floatSideOf(el, this.pg(el))) return img;
    // 画像の罫線・内側の余白・背景色 (img { border: … }): 画像の箱に付ける (下)。
    // 角丸 (border-radius) は罫線の箱に付け、画像は内側の角丸 (外側の半径 − 罫線と余白) で切り抜く (CSS Backgrounds 3 §4.1・§4.2・§4.3)
    const bs = this.boxStyle(el);
    // 外側の余白 (margin): 行内の置換要素には 4 辺とも効く (CSS 2.1 §8.3。上下の margin が効かないのは、置換要素でない行内の箱だけ)。
    // auto は 0 (§10.3.2)。百分率は、包含ブロックの幅に対する値として、カスケードで解いた長さ (§8.3)
    const c = this.cs(el);
    const mg = { top: cssLen(c('margin-top')) ?? 0, right: cssLen(c('margin-right')) ?? 0, bottom: cssLen(c('margin-bottom')) ?? 0, left: cssLen(c('margin-left')) ?? 0 };
    const hasMargin = !!(mg.top || mg.right || mg.bottom || mg.left);
    if (bs.border || bs.padding || bs.backgroundColor) {
      // 罫線・内側の余白・背景色は、画像の箱そのものに付ける (組版が、画像をそれらを持つ箱で包み、行の中の送りと行の高さに入れる。
      // 置換要素の行内の箱の高さは margin の箱の高さ: CSS 2.1 §10.8・§10.6.2。これまでは画像を囲む行内の枠にしていて、罫線と padding が
      // 行の高さに入らず、前後の行に重なっていた)
      const rad = img.borderRadius;
      if (rad) {
        img.boxRadius = rad;
        img.borderRadius = innerRadius(rad, bs.border, bs.padding);
      }
      if (bs.border) img.border = bs.border;
      if (bs.padding) img.padding = bs.padding;
      if (bs.backgroundColor) img.backgroundColor = bs.backgroundColor;
      // 変換・不透明度は、画像の節に付いたもの (image() が付ける) を、包んだ箱ごと掛ける
    }
    if (hasMargin) img.margin = mg;
    return img;
  }

  /** 回り込みの側 (flowFloat の説明を参照)。回り込みでなければ undefined */
  private floatSideOf(e: Element, pg: Record<string, string>): string | undefined {
    const fl = (pg.float && /\bsidenote\b/i.test(pg.float) ? this.sidenoteSide() : pg.float && pg.float !== 'footnote' ? floatSide(pg.float) : this.cs(e)('float')).replace(/^inline-(start|end)$/, '$1');
    if (/^(left|right|inside|outside|top|bottom|before|after|center|alternate|start|end)$/.test(fl)) return fl;
    return pg.float === 'footnote' ? undefined : this.ahFloatX(pg);
  }

  /**
   * アンテナハウスのフロートの拡張の -ah-float-x (横の位置) のうち、CSS の回り込みと同じ置き方になるもの: left・right・start・end と、
   * inside (ノドの側: 右ページでは左、左ページでは右)・outside (小口の側)。値の意味は、アンテナハウスの公開の説明による
   * (AH Formatter のオンラインマニュアル「フロート拡張」の axf:float-x・axf:float-y。https://www.antenna.co.jp/AHF/help/ja/ahf-float.html 、
   * 2026-11-11 取得)。縦の位置 (-ah-float-y) が none (初期値) のときは、要素のある所で横へ寄せ、本文を回り込ませる置き方なので、
   * float: left などと同じに組める。float の指定 (none 以外) があれば、そちらを使う。
   * 縦の位置の指定があるもの (ページの上・下へ動かす) と、center・alternate・column-outside・縦書き用の top・bottom は読まない
   * (未対応として知らせ、指定の無いときと同じに組む)
   */
  private ahFloatX(pg: Record<string, string>, report = false): string | undefined {
    const x = (pg['-ah-float-x'] ?? '').trim().toLowerCase();
    if (!x || x === 'none') return undefined;
    const y = (pg['-ah-float-y'] ?? '').trim().toLowerCase();
    if (!/^(left|right|start|end|inside|outside)$/.test(x) || (y && y !== 'none')) {
      if (report) this.miss(y && y !== 'none' ? `-ah-float-y: ${y}` : `-ah-float-x: ${x}`);
      return undefined;
    }
    return x;
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
  private flowFloat(e: Element, parent: Element, pg: Record<string, string>, inline: boolean, items: FlowItem[]): boolean {
    const fl = this.floatSideOf(e, pg);
    // 読まない -ah-float-x・-ah-float-y の値は、未対応として知らせる (ahFloatX)
    if (!fl && pg['-ah-float-x'] && pg.float !== 'footnote') this.ahFloatX(pg, true);
    if (!fl) return false;
    const fv = this.float(e, inline ? (this.flowBlockEl ?? parent) : parent, fl, !!pg.float && /\bsidenote\b/i.test(pg.float));
    if (pg.float && /\bmulticol\b/i.test(pg.float) && (fl === 'top' || fl === 'before')) {
      this.multicolTop.set(fv, /^\s*([\d.]+)gr\s*$/i.exec(pg.width ?? '')?.[1]);
      if (this.cs(e)('box-sizing') === 'border-box') this.multicolTopBorderBox.add(fv);
      const grid = this.inheritedGrid(e);
      if (grid) this.multicolTopGrid.set(fv, grid);
    }
    // 行内の要素の中の float (CSS 2.1 §9.5: float は行内の要素の中にも置け、その行の箱を基準に左右へ寄せる) は、行内の節の子に
    // 入れると組版が読まずに捨てるので、行内の要素を出た所 (包むブロックの中身の並び) に出す (pendingFloats。マーカーと同じ)。
    // 書いた所には目印を置き (pendFloat)、組版は、目印のある行に float を置く (CSS 2.1 §9.5.1 の規則 6・8。layoutChildren の runFloats)。
    // 1 つのブロックの中身にする要素 (floatHome) の直下の float は、その場に置く (ownFloats)
    if (inline && parent !== this.floatHome) this.pendFloat(fv, items);
    else items.push({ v: fv, block: false });
    return true;
  }

  /**
   * 絶対配置・固定配置 (pos は計算値の position)。扱ったら true。
   * 位置の基準になる親 (position: relative など) を基準に置けない (localCb が無い) とき、上下の位置の指定が無い絶対配置の要素は、
   * 左右の回り込みにする (ページを基準にする代わりに、親の中の位置を回り込みで近づける)。ほかの absolute は本文領域を基準にそのページへ、fixed は全ページに置く
   */
  private flowPositioned(e: Element, parent: Element, pos: string, items: FlowItem[], inline = false): boolean {
    // 行内の要素の中の箱は、行内の要素を出た所の並び (flowBlockEl の中身) に置くので、受け継ぐ書式はその要素との違いで渡す (flowBlockEl)
    const styleParent = inline ? (this.flowBlockEl ?? parent) : parent;
    if (pos === 'absolute' && !this.localCb(e.parentElement) && !this.inlineCbOf(e.parentElement) && this.positionedAncestor(e) && this.src.isAuto?.(e, 'top') !== false && this.src.isAuto?.(e, 'bottom') !== false) {
      const right = this.src.isAuto?.(e, 'right') === false;
      const left = this.src.isAuto?.(e, 'left') === false;
      if (right || left) {
        const f = this.float(e, styleParent, right ? 'right' : 'left');
        const off = cssLen(this.cs(e)(right ? 'right' : 'left')) ?? 0;
        f.margin = { ...(typeof f.margin === 'object' ? f.margin : {}), [right ? 'right' : 'left']: off };
        // 行内の要素の中では、行内の要素を出た所に置く (flowFloat と同じ。行内の節の子に入れると、組版が読まずに捨てる)
        if (inline && parent !== this.floatHome) {
          this.pendFloat(f, items);
          return true;
        }
        // 上下の位置は、同じ行の高さ (static position): 回り込みを、いまの行の並び (直前のブロックの後) の先頭に入れる
        let at = items.length;
        while (at > 0 && !items[at - 1].block) at--;
        items.splice(at, 0, { v: f, block: false });
        return true;
      }
    }
    if (pos !== 'absolute' && pos !== 'fixed') return false;
    const cont = this.positioned(e, styleParent);
    if (pos === 'fixed') this.fixed.push(cont);
    // 行内の要素の中の箱・行内の箱を基準にする箱は、行内の要素 (基準の要素) を出た所の行の並びに置く (行内の節の中には置けない)。
    // ページを基準にする箱で、位置が static position の向きのあるもの (pageArea.staticTop・staticLeft) は、見つけた所 (行内の要素の中身の並び)
    // に目印 (LInline.staticAnchor。負の番号) を置く。組版は、目印のある行の、目印の位置を static position にする (CSS 2.1 §10.3.7・§10.6.4)
    else if (inline || this.inlineCbEl.has(cont)) {
      // タグ付き PDF: 目印に箱の要素の構造の節を付け、構造の木で、その節を目印の所 (書いた所) に置く。static position の目印の無い箱にも、
      // 構造の順のためだけの目印 (structMark) を置く (幅 0 で、改行の機会も行の高さも変えない。inlineFlatten.ts の目印の箱)
      if (inline && !this.inlineCbEl.has(cont) && (cont.pageArea?.staticTop || cont.pageArea?.staticLeft)) {
        const key = -++this.floatAnchorSeq;
        cont.inlineAnchor = key;
        items.push({ v: this.tagNode({ type: 'inline', children: [], staticAnchor: key } as LInline, e), block: false });
      } else if (inline && this.sb) items.push({ v: this.tagNode({ type: 'inline', children: [], structMark: true } as LInline, e), block: false });
      this.pendingAbs.push(cont);
    } else {
      // 字のある親 (段落など。行の中身がある) の、じかの子の箱: 書いた所に、構造の順のためだけの目印を置く (上と同じ。字の無い親の子の
      // ブロックの箱 (見出しなど) は、行を作らないよう置かない。構造の木では、兄弟のブロックの間の、中身を描いた所に並ぶ)
      if (this.sb && Array.from(parent.childNodes ?? []).some((k) => k.nodeType === 3 && (k.textContent ?? '').trim())) items.push({ v: this.tagNode({ type: 'inline', children: [], structMark: true } as LInline, e), block: false });
      items.push({ v: cont, block: false });
    }
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

  /**
   * 隣り合う文字列をつなぎ (つなぎ目の空白は joinTextItems が詰める)、ブロック境界の空白を除く (ws は white-space の値。pre* は空白をそのまま残す)。
   * inline: 行内の要素の中身の並び。並びの端は要素の境目で、行の頭・終わりではないので、端の空白は残す (CSS Text 3 §4.1.1: 空白を詰めるのは、
   * 要素の境目をまたいだ並びで行う。行の頭・終わりの空白は §4.1.2 で行を組むときに消す)。消すと「word <b>bold </b>word」が「boldword」になる
   */
  private collapseFlowWhitespace(items: FlowItem[], ws: string, inline = false): Array<LBlockLevel | LInlineLevel> {
    const pre = /^pre/.test(ws);
    const merged = joinTextItems(items, ws);
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
        return !inline;
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
    // ブロックの中身の並び (行内の要素の中身でないもの) では、行内の要素の境目をまたいで空白を詰める。white-space が空白を残すブロックでも、
    // 中の空白を詰める行内の要素の、節の端の改行は決める (直下の字は空白も字として数える)
    if (!inline && !pre) collapseAcrossInlines(out);
    else if (!inline) resolveSegmentBreaks(out, false);
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
    // block math・block ruby・表の部品 (表の中で扱う。単独で現れたらブロックとして扱う)。名前付きのページの見分け方と同じもの (pageFlow.ts)
    if (blockLevelDisplay(d)) return true;
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
    // 1 つの数式で描く字の数の上限 (mathLayout.ts の MAX_MATH_GLYPHS) を超えて、超えた分の字を描かなかったときは、報告する
    if (r.truncated) this.miss(msg('数式の字の数が上限を超えたので、超えた分の字を描きません', 'the number of characters in the formula exceeds the limit; the excess characters are not drawn'));
    const bytes = new TextEncoder().encode(r.svg);
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    const src = `data:image/svg+xml;base64,${btoa(bin)}`;
    if (!this.report.images.includes(src)) this.report.images.push(src);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const img: LImage = this.tagNode({ type: 'image', src, width: r2(r.width), height: r2(r.ascent + r.descent) }, el);
    const alt = el.getAttribute('alttext');
    if (alt) img.alt = alt;
    return r.descent > 0 ? this.tagNode({ type: 'inline', baselineShift: -r2(r.descent), children: [img] } as LInline, el) : img;
  }

  /** ::before / ::after の content (文字列・counter()・attr()・target-counter()・leader()) */
  private pseudo(el: Element, which: '::before' | '::after', items: Array<{ v: LBlockLevel | LInlineLevel; block: boolean }>) {
    const c = this.cs(el, which);
    const content = this.pagedPseudo.get(el)?.[which]?.content ?? c('content');
    if (!content || content === 'none' || content === 'normal') return;
    this.enterCounters(c, el);
    this.countQuotes = true;
    // 生成した内容の文字列も、文書の字と同じに white-space で扱う (CSS 2.1 §12.2: 「\A」は改行で、white-space が pre などのときだけ
    // 行を分ける。CSS Text 3 §4.1: 改行 (U+000A) は segment break で、§4.1.1〜§4.1.3 の決まりで、normal・nowrap なら空白にするか消し、
    // pre・pre-wrap・pre-line なら強制改行にする)。前後の字で空白にするか消すかは、文書の中の改行と同じ決まり (前後が和文なら消す。
    // 文字列の端の改行は、resolveSegmentBreaks が、行内の要素の境目をまたいだ前後の字で決める)。タブ (\9) も、normal なら空白になる
    const parts = this.evalContent(el, parseContent(content), which).map((x) => (typeof x === 'string' ? this.text(x, el, which) : x));
    this.countQuotes = false;
    this.lastPseudoText[which] = parts.filter((x): x is string => typeof x === 'string').join('');
    if (this.wantText) this.pseudoTextOf.set(el, { ...this.pseudoTextOf.get(el), [which]: this.lastPseudoText[which] });
    this.pseudoTextSeen.set(el, { ...this.pseudoTextSeen.get(el), [which]: this.lastPseudoText[which] });
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
      const bu = firstCssUrl(c('background-image'));
      const bgrad = bu ? undefined : firstGradient(c('background-image'));
      if ((w && h) || bgc || bu || bgrad) {
        const boxC: LBlockContainer = { type: 'block-container', children: parts.some((x) => x !== '') ? [{ type: 'block', ...style, children: parts }] : [] };
        if (w) boxC.width = w;
        if (h) boxC.height = h;
        if (bgc) boxC.backgroundColor = bgc;
        if (bu) {
          const img: BackgroundImage = { src: this.bgSrc(bu[1]) };
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
          if (/no-repeat/.test(c('background-repeat').split(',')[0])) img.repeat = 'no-repeat';
          // 描く範囲 (background-clip。初期値は border の箱)
          const bcl = backgroundLayers(c)[0]?.clip;
          if (bcl === 'border-box' || bcl === 'content-box') img.clip = bcl;
          boxC.backgroundImage = img;
          this.report.images.push(img.src);
        }
        if (bgrad) {
      const gcl = backgroundLayers(c)[0]?.clip;
      boxC.backgroundImage = { src: '', gradient: bgrad, gradientFontSize: cssLen(c('font-size')) ?? 12, ...(gcl === 'border-box' || gcl === 'content-box' ? { clip: gcl } : {}) };
    }
        // (回り込みの ::before・::after の背景は 1 枚目だけ)
        if (backgroundLayers(c).filter((l) => /url\(|gradient\(/.test(l.image)).length > 1) this.miss(msg('background-image: 2 枚目以降 (::before・::after)', 'background-image: second and later layers (::before, ::after)'));
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
    else if (c('display') === 'inline-block') {
      // inline-block: 行内の、分けられない箱 (見出しの番号を 12mm の箱に入れるなど)。幅の指定が無ければ中身に合わせた幅。
      // 箱の書式 (margin・padding・border・背景・寸法・不透明度) は、ふつうの要素の inline-block と同じ道 (boxStyle) で付ける
      // (CSS Pseudo 4 §4.1: ::before・::after の箱は、その要素の直下の子のように振る舞い、効く性質に制限が無い。負の margin-left で左へ出すこともできる)。
      // 中の揃え・字下げは、::before / ::after 自身の text-align・text-indent。中は字下げしない
      const ta = c('text-align').replace(/^-webkit-/, '');
      // left・right は書く向きで start・end に読み替える (右から左へ書くなら right が start)
      const rtlTa = c('direction') === 'rtl';
      const align = ta === 'end' || ta === (rtlTa ? 'left' : 'right') ? 'end' : ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : 'start';
      const box = this.boxStyle(el, which);
      delete box.breakBefore;
      delete box.breakAfter;
      const ic: LInlineContainer = {
        type: 'inline-container',
        decorateBox: false,
        ...style,
        ...(box as Omit<LInlineContainer, 'type' | 'children'>),
        baselineFrom: 'last',
        children: [{ type: 'block', textIndent: 0, ...textIndentOf(c('text-indent')), textAlign: align, lastLineEndIndent: this.lastLineEndIndentOf(el, which) ?? 0, children: parts } as LBlock],
      };
      const iva = c('vertical-align');
      if (iva === 'middle') ic.alignmentBaseline = 'central';
      else if (iva === 'top' || iva === 'text-top') ic.alignmentBaseline = 'before-edge';
      else if (iva === 'bottom' || iva === 'text-bottom') ic.alignmentBaseline = 'after-edge';
      // top・bottom の箱は、自分の部分木を作る (CSS 2.1 §10.8.1。囲む top・bottom の行内の要素の部分木に入れない)
      if (iva === 'top' || iva === 'bottom') ic.ownLineAlign = true;
      items.push({ v: ic, block: false });
    } else {
      // 行内の箱 (display: inline): ふつうの行内の要素と同じ道で、背景・罫線・内側の余白・左右の margin・vertical-align・不透明度を付ける
      const inl: LInline = { type: 'inline', children: parts };
      this.inlineBoxInto(inl, el, el, which);
      const boxed = Object.keys(inl).length > 2;
      if (Object.keys(style).length || this.opts.pseudoInlineBoxAh || boxed) items.push({ v: { ...inl, ...style, children: parts } as LInline, block: false });
      else for (const v of parts) items.push({ v, block: false });
    }
  }

  /** 絶対配置の ::before / ::after → 絶対配置の箱 (大きさ・位置・背景はブラウザが確定させた値) */
  private positionedPseudo(el: Element, which: '::before' | '::after', parts: LInlineLevel[]): LBlockContainer {
    const c = this.cs(el, which);
    const a = this.areaOf(this.curPage ?? this.rootPage);
    const cont: LBlockContainer = { type: 'block-container', absolutePosition: true, ...this.textStyle(el, el, which), children: parts.length ? [{ type: 'block', children: parts }] : [] };
    const len = (p: string) => cssLen(c(p));
    const w = len('width');
    const h = len('height');
    // 0 も有効な大きさ (CSS 2.1 §10.2・§10.5。前は width: 0 を auto として、中身の幅に広げていた)
    if (w !== undefined) cont.width = w;
    if (h !== undefined) cont.height = h;
    // 百分率の top・bottom・height (positioned と同じ。基準は包含ブロックの padding の箱の高さ)
    const pct = this.absPercent(c, () => false);
    if (pct.height !== undefined) cont.height = 0;
    const [top, left, right, bottom] = [len('top') ?? (pct.top !== undefined ? 0 : undefined), len('left'), len('right'), len('bottom') ?? (pct.bottom !== undefined ? 0 : undefined)];
    if (w === undefined) cont.shrinkToFit = true;
    const pfx = this.paintEffectOf(el, which);
    if (pfx) cont.paintEffect = pfx;
    // 基準は、要素自身 (position が static でなければ) か、その祖先
    const cb = c('position') === 'absolute' ? this.localCb(el) : undefined;
    if (cb) this.placeInCb(cont, cb, { top, right, bottom, left }, pct);
    else {
      if (left !== undefined) cont.left = a.left + left;
      else if (right !== undefined) cont.right = a.right + right;
      if (top !== undefined) cont.top = a.top + top + (pct.top ?? 0) * a.height;
      else if (bottom !== undefined) cont.bottom = a.bottom + bottom + (pct.bottom ?? 0) * a.height;
      if (pct.height !== undefined) cont.height = pct.height * a.height;
    }
    const bg = cssColor(c('background-color'));
    if (bg) cont.backgroundColor = bg;
    const bi = firstCssUrl(c('background-image'));
    if (bi) {
      const img: BackgroundImage = { src: this.bgSrc(bi[1]) };
      const bsz = c('background-size').split(',')[0].trim();
      if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
      setBackgroundPosition(img, c('background-position-x'), c('background-position-y'));
      if (/no-repeat/.test(c('background-repeat').split(',')[0]) || img.size) img.repeat = 'no-repeat';
      // 描く範囲 (background-clip。初期値は border の箱)
      const bcl = backgroundLayers(c)[0]?.clip;
      if (bcl === 'border-box' || bcl === 'content-box') img.clip = bcl;
      cont.backgroundImage = img;
      this.report.images.push(img.src);
    }
    const cgrad = bi ? undefined : firstGradient(c('background-image'));
    if (cgrad) {
      const gcl = backgroundLayers(c)[0]?.clip;
      cont.backgroundImage = { src: '', gradient: cgrad, gradientFontSize: cssLen(c('font-size')) ?? 12, ...(gcl === 'border-box' || gcl === 'content-box' ? { clip: gcl } : {}) };
    }
    // (絶対配置の ::before・::after の背景は 1 枚目だけ)
    if (backgroundLayers(c).filter((l) => /url\(|gradient\(/.test(l.image)).length > 1) this.miss(msg('background-image: 2 枚目以降 (::before・::after)', 'background-image: second and later layers (::before, ::after)'));
    if ((parseInt(c('z-index'), 10) || 0) < 0) cont.layer = 'behind';
    const rad = this.radiusOf(c);
    if (rad) cont.borderRadius = rad;
    return cont;
  }

  /** border-*-radius → 角丸 (すべて 0 なら undefined。4 隅が同じ長さなら rx・ry、違えば角ごと) */
  private radiusOf(c: (p: string) => string): BorderRadius | undefined {
    const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((k) => {
      const [h, v = h] = splitTop((c(`border-${k}-radius`) || '0px').trim(), ' ').filter(Boolean);
      // 百分率を含む calc() (計算値は calc(10% + 10px) の形のまま。CSS Backgrounds 3 §4.1) は、百分率と長さの和
      const one = (x: string): RadiusLength => {
        if (/%$/.test(x)) return x as `${number}%`;
        const pl = /%/.test(x) ? percentPlusLength(x) : undefined;
        return pl ? { pct: pl.pct, len: pl.px * PT_PER_PX } : (cssLen(x) ?? 0);
      };
      return [one(h), one(v)] as [RadiusLength, RadiusLength];
    });
    const zero = (x: RadiusLength) => (typeof x === 'object' ? !x.pct && !x.len : !parseFloat(String(x)));
    if (corners.every(([h, v]) => zero(h) && zero(v))) return undefined;
    const [h0, v0] = corners[0];
    if (typeof h0 === 'number' && typeof v0 === 'number' && corners.every(([h, v]) => h === h0 && v === v0)) return { rx: h0, ry: v0 };
    return { rx: 0, ry: 0, corners };
  }

  /** ブロック要素 */
  /**
   * <a href> の飛び先 (HTML Living Standard §4.6.1)。#id は文書の中、スキームのある URL (RFC 3986 §3.1 の形:
   * 英字の後に英字・数字・+・-・.) と相対参照 (§4.2。file.pdf・../a/b.html など) は外。相対参照は PDF の場所からの相対として書き出す。
   * 外への飛び先は、通してよいもの (linkPolicy の judgeExternalLink。既定では http・https・mailto・tel の URL と相対の PDF) だけをリンクにする。
   * 通さないもの (javascript: など) はリンクにせず (字はそのまま組む)、report.droppedLinks に数える。
   * スキームは、ブラウザと同じ前処理 (前後の空白・制御文字と、タブ・改行を取り除く。WHATWG URL §4.4) の後の文字列で読む
   */
  private linkOf(el: Element): LinkTarget | undefined {
    if (el.localName !== 'a') return undefined;
    const href = (el.getAttribute('href') ?? '').trim();
    if (!href) return undefined;
    if (href.startsWith('#')) return href.length > 1 ? { internal: this.fragmentId(el, href.slice(1)) } : undefined;
    const j = judgeExternalLink(href, this.opts.links);
    if (j.allowed) return { external: j.url };
    countDroppedLink((this.report.droppedLinks ??= {}), j);
    return undefined;
  }

  /** ブロックの箱を組む。<a href> なら箱にリンクを付ける (ブロック・flex・表の <a> も、箱の全体が飛び先へのリンクになる) */
  private block(el: Element, parent: Element, plain = false): LBlockLevel | undefined {
    return this.located(el, () => this.block0(el, parent, plain));
  }
  private block0(el: Element, parent: Element, plain = false): LBlockLevel | undefined {
    const b = this.tagNode(this.blockBox(el, parent, plain), el);
    // 最初の子 (その最初の子…) の break-before は、箱の前の区切りと同じ所の値 (CSS Fragmentation 3 §3.1.1: 最初の子の値は容器へ伝わる)。
    // 箱自身の値と合わせて (§4.3: 左右のページの指定は、流れの中で後ろ = 内側の子の値が勝つ) 箱の値にし、子からは外す。
    // 別々に効かせると、break-before: right の箱の中の break-before: left の子で、右ページへ送ってから、さらに左ページへ送っていた。
    // 箱に値が無くても移す: 前の箱の break-after は、組版が箱を開くときに効かせるので、子の値と合わせられるのは箱の前 (layoutBlock の forceBreak)
    if (b?.type === 'block' && edgeBreak(b.children, 'before')) b.breakBefore = mergeBreaks(b.breakBefore, takeEdgeBreak(b.children, 'before'));
    if (b) this.propagateEdgeAvoids(b, el);
    const link = b && this.linkOf(el);
    if (!b || !link) return b;
    if (b.type === 'block' && !(b as LBlock).link) {
      (b as LBlock).link = link;
      return b;
    }
    // 表・高さの決まった箱などは、書式を持たないブロックで包んでリンクにする (包んだ箱の前後の区切りは、中の箱と同じ所)
    const wrap = this.tagNode({ type: 'block', link, children: [b] } as LBlock, el);
    this.propagateEdgeAvoids(wrap);
    return wrap;
  }

  /** 区切りを避ける値 (break-before・break-after) の種類。avoid-column は段組の文脈の中だけで効く (CSS Fragmentation 3 §3.1) */
  private avoidKind(v: string, el: Element): AvoidKind | undefined {
    return v === 'avoid' || v === 'avoid-page' ? 'all' : v === 'avoid-column' && this.inMulticol(el) ? 'column' : undefined;
  }

  /** 要素が段組の容器 (段の分割の文脈を作る箱。CSS Multi-column 1 §2: column-count か column-width が auto でない) か */
  private isMulticolContainer(el: Element): boolean {
    const c = this.cs(el);
    const cc = c('column-count');
    const cw = c('column-width');
    return (!!cc && cc !== 'auto') || (!!cw && cw !== 'auto');
  }

  /**
   * 最初の子の break-before・最後の子の break-after の avoid 系の値を、箱の前・後ろの区切りに伝える (CSS Fragmentation 3 §3.1.1:
   * 区切りは兄弟の間にだけあり、箱とその容器の間には無いので、最初の通常の流れの子の break-before は容器に、最後の子の break-after も容器に伝わる。
   * 子は先に組んであるので、伝わった値をたどれば、入れ子の奥の子からも伝わる)。伝わった値は、同じ区切りに当たる値として合わせる:
   * - 強制の区切り (箱の前の強制の区切り、最初の子へたどった強制の区切り。edgeBreaks) があれば、そこは強制で分ける (§4.3: 強制の区切りの値は、
   *   同じ区切りに当たる avoid の値に勝つ)。avoid は伝えず、箱自身の avoid も外す (組むときに、前の箱とつなげようとしない)。
   * - そうでなければ、どれかが避けるなら、そこでは分けない (§4.4 の Rule 1)。
   * avoid-column の値は、段組の容器の手前で止める (§3.1.1: 伝わるのは、最も近い合う種類の分割の文脈の手前まで)。avoid・avoid-page は止めない
   * (ページの分割の文脈は、段組の容器より外側)。
   * flex・grid の容器 (§3.1.1: 並べ替え・並べて組む組み方は、それぞれの仕様の規則による) と、流れの外の箱 (絶対配置) には伝えない。
   * el は箱の要素 (無ければ、書式を持たない包みの箱。中の箱の値をそのまま伝える)
   */
  private propagateEdgeAvoids(node: LBlockLevel, el?: Element): void {
    if (node.type !== 'block' && node.type !== 'table' && node.type !== 'block-container') return;
    if (node.type === 'block-container' && node.absolutePosition) return;
    const own = this.edgeAvoids.get(node) ?? {};
    const c = el ? this.cs(el) : undefined;
    if (c) {
      own.before = maxAvoid(own.before, this.avoidKind(c('break-before') || c('page-break-before'), el!));
      own.after = maxAvoid(own.after, this.avoidKind(c('break-after') || c('page-break-after'), el!));
    }
    // 中身の子から伝える (表の中身は行。flex・grid の容器も伝えない)
    const flexBox = !!el && /^(inline-)?(flex|grid)$/.test(this.display(el));
    const children = node.type !== 'table' && !flexBox ? ((node as LBlock).children as ReadonlyArray<LBlockLevel | LInlineLevel>) : undefined;
    const stopColumn = !!el && this.isMulticolContainer(el);
    for (const side of ['before', 'after'] as const) {
      if ((side === 'before' ? node.breakBefore : node.breakAfter) || (children && edgeBreak(children, side))) {
        // 強制の区切りが勝つ (§4.3)
        delete own[side];
        continue;
      }
      const inner = children ? this.edgeAvoidOf(children, side) : undefined;
      own[side] = maxAvoid(own[side], inner === 'column' && stopColumn ? undefined : inner);
    }
    if (!own.before) delete own.before;
    if (!own.after) delete own.after;
    this.edgeAvoids.set(node, own);
    if (own.before) node.keepWithPrevious = true;
    else delete node.keepWithPrevious;
    if (own.after) node.keepWithNext = true;
    else delete node.keepWithNext;
  }

  /** 中身の最初 (before)・最後 (after) の通常の流れの子の、前・後ろの区切りを避ける値 (伝わったものを含む)。子の前 (後ろ) に行内の中身があれば無い */
  private edgeAvoidOf(children: ReadonlyArray<LBlockLevel | LInlineLevel>, side: 'before' | 'after'): AvoidKind | undefined {
    let c: LBlockLevel | LInlineLevel | undefined;
    if (side === 'before') {
      for (const x of children) if (inFlowChild(x)) { c = x; break; }
    } else {
      for (let i = children.length - 1; i >= 0; i--) if (inFlowChild(children[i])) { c = children[i]; break; }
    }
    if (!c || typeof c === 'string' || (c.type !== 'block' && c.type !== 'table' && c.type !== 'block-container')) return undefined;
    const m = this.edgeAvoids.get(c);
    if (m) return m[side];
    const memo = this.edgeAvoidMemo.get(c) ?? {};
    if (side in memo) return memo[side];
    // 値を合わせていない箱 (無名の箱・疑似要素の箱など): 自分の値と、その中身の最初 (最後) の子からたどった値。強制の区切りがあれば無い (§4.3)。
    // 答えは覚えて使い回す (入れ子の無名の箱を、親ごとにたどり直さない)
    const forced = !!(side === 'before' ? c.breakBefore : c.breakAfter) || (c.type === 'block' && !!edgeBreak(c.children, side));
    const own = (side === 'before' ? c.keepWithPrevious : c.keepWithNext) ? 'all' : undefined;
    const v = forced ? undefined : c.type === 'block' ? maxAvoid(own, this.edgeAvoidOf(c.children, side)) : own;
    memo[side] = v;
    this.edgeAvoidMemo.set(c, memo);
    return v;
  }

  private blockBox(el: Element, parent: Element, plain = false): LBlockLevel | undefined {
    const d = this.display(el);
    if (!plain && /^(inline-)?(flex|grid)$/.test(d)) {
      const fg = this.flexGrid(el, parent);
      if (fg) return fg;
    }
    if (d === 'table' || el.localName === 'table') return this.splitTableByPage(this.table(el, parent));
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
    if (posv === 'relative' || posv === 'sticky' || b.paintEffect?.transform) b.containingBlock = true;
    const rel = this.relativeOffsetOf(el);
    if (rel) b.relativeOffset = rel;
    // アンテナハウスの行グリッド (-ah-baseline-grid。normal は何もしない)
    const bgrid = this.pg(el)['-ah-baseline-grid']?.trim().toLowerCase();
    if (bgrid === 'new' || bgrid === 'root' || bgrid === 'none') b.baselineGrid = bgrid;
    this.blockStack.push(b);
    b.children = this.flowChildren(el);
    this.blockStack.pop();
    this.firstLetterLine(el, b);
    const wm = this.wm(c('writing-mode'));
    const pwm = this.wm(this.cs(parent)('writing-mode'));
    if (wm && wm !== pwm) b.writingMode = wm;
    // 親と直交する箱で、行の向きの大きさ (縦書きなら高さ) が auto: max-height・min-height (横書きの箱は max-width・min-width) を、
    // fit-content の使える長さの上限と、結果の下限にする
    if (wm && (wm === 'horizontal-tb') !== ((pwm ?? 'horizontal-tb') === 'horizontal-tb') && !b.aspectRatio && b[wm === 'horizontal-tb' ? 'width' : 'height'] === undefined) {
      const lim = this.orthogonalInlineLimits(el);
      if (lim.max !== undefined) b.maxInlineSize = lim.max;
      if (lim.min !== undefined) b.minInlineSize = lim.min;
    }
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
      const { fill, ...colSpecBase } = cols;
      // column-fill: auto (CSS Multi-column 1 §7.1) は、ページで分ける段組を順に埋める。balance (初期値) は釣り合わせる
      const colSpec: NonNullable<LBlockContainer['columns']> = fill === 'auto' ? { ...colSpecBase, fill: 'auto' } : colSpecBase;
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
          // 行グリッドの中の段組フロートの中身は、表のセルと同じに行グリッドの領域にする (最初の行の前と最後の行の後ろに半行間を付けず、
          // new なら em の箱を積む)。見本の PDF: CSS-Print 第 4 版の 9.3.6 の段組フロート (-ah-baseline-grid: new の段組の中の
          // float: multicol top start。罫線 3pt・内側の余白 3pt) の箱の高さは、罫線と内側の余白に字の em の箱を足したもの (半行間が無い)
          const grid = this.multicolTopGrid.get(f);
          const inner = grid ? [{ type: 'block', baselineGrid: grid, ...(grid === 'new' ? { baselineGridStack: true } : {}), children: ch } as LBlock] : ch;
          const b2 = { type: 'block', span: 'all', ...bx, children: inner } as unknown as LBlock;
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
      // 段組の最初の子の break-before・最後の子の break-after のページの区切り (page・left・right など) は、段組の容器の前後の区切り
      // (CSS Fragmentation 3 §3.1.1: 値は、合う種類の分割の文脈の手前まで伝わる。段組は段の分割の文脈なので、ページの区切りは外へ出る)。
      // 容器自身の値と合わせ (§4.3)、子からは外す。段の区切り (column) だけなら、段組の中で止まる (最初の段の前・最後の段の後ろでは区切らない)
      const pageKind = (k: BreakKind | undefined) => !!k && k !== 'column';
      if (pageKind(edgeBreak(rest.children, 'before'))) rest.breakBefore = mergeBreaks(rest.breakBefore, takeEdgeBreak(rest.children, 'before'));
      if (pageKind(edgeBreak(rest.children, 'after'))) rest.breakAfter = mergeBreaks(takeEdgeBreak(rest.children, 'after'), rest.breakAfter);
      // 高さが中身で決まる横書きの段組の max-height (CSS 2.1 §10.7: 箱の高さの上限): 箱の高さは抑えない (はみ出しの描き方が無い。boxStyle) が、
      // 段の高さは、その内側に取る (CSS Multi-column 1 §7.1: 高さか max-height で限られた段組)。組版エンジンが、段が取れる高さの上限にする
      if (rest.height === undefined && !rest.aspectRatio && !wm?.startsWith('vertical') && /px$/.test(c('max-height'))) {
        const bb = c('box-sizing') === 'border-box' ? ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'].reduce((a, p) => a + (cssLen(c(p)) ?? 0), 0) : 0;
        rest.maxBlockSize = Math.max(0, (cssLen(c('max-height')) ?? 0) - bb);
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
            const m = firstLetterOf(k);
            if (!m) {
              if (k.trim()) return true;
              continue;
            }
            const letter = m[1];
            const st = this.textStyle(el, el, '::first-letter');
            const fc = this.cs(el, '::first-letter');
            const fl = fc('float');
            let node: LInlineLevel;
            // initial-letter (CSS Inline 3 §7.3): 最初の字を大きくして、数行に沈める。float の指定があれば、ただの回り込みの字
            // (§7.3.1 の注: float が none でない箱には当たらない)
            const il = fl === 'left' || fl === 'right' ? undefined : parseInitialLetter(fc('initial-letter'));
            if (il) {
              // 字の大きさ・行の高さの指定は当たらない (§7.5.1)。大きさは、組むときに行の数と書体の値から決める (§7.5.3)
              const { fontSize: _fs, lineHeight: _lh, lineHeightNormal: _lhn, lineHeightPt: _lhp, ...ist } = st;
              void [_fs, _lh, _lhn, _lhp];
              const inner: LBlock = { type: 'block', ...ist, ...this.boxStyle(el, '::first-letter'), textIndent: 0, textAlign: 'start', children: [letter] };
              // 合わせる位置 (initial-letter-align。§7.4)。hanging・border-box は未対応 (alphabetic として組み、知らせる)
              const av = (fc('initial-letter-align') || 'alphabetic').trim().toLowerCase();
              if (/border-box|hanging/.test(av)) this.miss(`initial-letter-align: ${/border-box/.test(av) ? 'border-box' : 'hanging'}`);
              const align = /border-box|hanging/.test(av) ? 'alphabetic' : (av as 'alphabetic' | 'ideographic' | 'leading');
              const f: LFloat = { type: 'float', float: 'start', cssPlacement: true, initialLetter: { ...il, align }, children: [inner] };
              // 余白・枠・背景は、字の箱 (回り込む範囲) が持つ (§7.5.2)。幅の指定は箱の幅 (§7.5.5)。高さは行の数で決まる
              for (const key of ['margin', 'padding', 'border', 'backgroundColor', 'paintEffect', 'width', 'boxSizing'] as const) {
                if (inner[key] === undefined) continue;
                (f as unknown as Record<string, unknown>)[key] = inner[key];
                delete inner[key];
              }
              delete inner.height;
              delete inner.inlineSizing;
              node = f as unknown as LInlineLevel;
            } else if (fl === 'left' || fl === 'right') {
              const inner: LBlock = { type: 'block', ...st, ...this.boxStyle(el, '::first-letter'), children: [letter] };
              const f: LFloat = { type: 'float', float: fl === 'left' ? 'start' : 'end', cssPlacement: true, children: [inner] };
              for (const key of ['margin', 'padding', 'border', 'backgroundColor', 'paintEffect', 'width', 'height', 'boxSizing'] as const) {
                if (inner[key] === undefined) continue;
                (f as unknown as Record<string, unknown>)[key] = inner[key];
                delete inner[key];
              }
              node = f as unknown as LInlineLevel;
            } else {
              const inl: LInline = { type: 'inline', ...st, ...(this.paintEffectOf(el, '::first-letter') ? { paintEffect: this.paintEffectOf(el, '::first-letter') } : {}), children: [letter] };
              const bg = cssColor(fc('background-color'));
              if (bg) inl.backgroundColor = bg;
              node = inl;
            }
            // 沈めた最初の字と、続く内容の間の、詰める空白は消す (CSS Inline 3 §7.8.1: 回り込む行の頭をそろえる)
            const after = k.slice(m[0].length + letter.length);
            const rest = il && il.sink > 1 ? after.replace(/^[ \t\n\r\f]+/, '') : after;
            list.splice(i, 1, ...(m[0] ? [m[0]] : []), node, ...(rest ? [rest] : []));
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

  /**
   * 要素 e の包含ブロックを作る祖先 (行内の要素 (display: inline・contents) を越えた、いちばん近い祖先) が、行内の要素として組む
   * inline-flex・inline-grid の容器か
   */
  private inInlineFlexBox(e: Element): boolean {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const d = this.display(p);
      if (/^inline-(flex|grid)$/.test(d)) return true;
      if (d !== 'inline' && d !== 'contents') return false;
    }
    return false;
  }

  /** 背景の画像の参照 (互換の指定の pdfRangeFirstPage のとき、PDF のページの範囲は最初のページにする。assets.ts の backgroundPdfSrc) */
  private bgSrc(raw: string): string {
    const src = normalizeSrc(raw);
    return this.opts.pdfRangeFirstPage ? backgroundPdfSrc(src) : src;
  }

  /** 画像 (<img> と、画像を指す <object>) */
  private image(el: Element, src: string): LImage {
    const key = normalizeSrc(src);
    this.report.images.push(key);
    const img: LImage = this.tagNode({ type: 'image', src: key, decorateBox: false }, el);
    const alt = el.getAttribute('alt') ?? el.getAttribute('title');
    if (alt) img.alt = alt;
    const c = this.cs(el);
    if (el.localName === 'img' && this.inAutoCellIfc(el)) img.noWrapInCellMin = true;
    // 角丸 (border-radius): 画像を角丸で切り抜く (CSS Backgrounds 3 §4.3)
    const rad = this.radiusOf(c);
    if (rad) img.borderRadius = rad;
    // 寸法: 幅・高さの指定 (auto でなければ確定した値)、無ければ width / height 属性 (px)
    for (const prop of ['width', 'height'] as const) {
      const auto = this.src.isAuto?.(el, prop);
      const attr = el.getAttribute(prop);
      // img・object の属性は、カスケードが表示のための指定 (presentational hints。HTML §15.4.3) にしてあるので、作成者が auto を
      // 書けば auto (max-width: 100%; height: auto の画像は、幅を縮めると、高さも縦横比で縮む)。その属性を読むのは、auto かどうかが
      // 分からないときだけ。表示のための指定にしない要素 (行内の svg など) の属性は、これまでどおり読む
      const hinted = auto !== undefined && /^(img|object)$/.test(el.localName);
      const v = auto === false ? cssLen(c(prop)) : !hinted && attr && /^\d+(\.\d+)?$/.test(attr) ? parseFloat(attr) * PT_PER_PX : undefined;
      // 0 も有効な大きさ (CSS 2.1 §10.2。img の width="0" も、HTML §15.4.3 の寸法の属性で 0 を無視しない。前は 0 を指定なしとして、
      // 画像本来の大きさで描いていた)
      if (v !== undefined) img[prop] = v;
    }
    // 属性の縦横比 (aspect-ratio: auto w / h。HTML §15.4.3): auto のために読まなかった属性があれば、比を残す (組版が、本来の比が無いときに使う)
    if (/^(img|object)$/.test(el.localName) && (img.width === undefined || img.height === undefined)) {
      const aw = el.getAttribute('width');
      const ah = el.getAttribute('height');
      if (aw && ah && /^\d+(\.\d+)?$/.test(aw) && /^\d+(\.\d+)?$/.test(ah) && parseFloat(aw) > 0 && parseFloat(ah) > 0) img.attrRatio = parseFloat(ah) / parseFloat(aw);
    }
    // CSS の aspect-ratio (CSS Sizing 4 §5.1): auto を含まない比は、置換要素の本来の比に代わる (auto を含む比は、本来の比が無いときだけ使う)
    if (/^(img|object)$/.test(el.localName)) {
      const ar = (c('aspect-ratio') || 'auto').trim().toLowerCase();
      const m = /^([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(ar.replace(/\bauto\b/, '').trim());
      const r = m ? parseFloat(m[1]) / (m[2] !== undefined ? parseFloat(m[2]) : 1) : NaN;
      if (Number.isFinite(r) && r > 0) {
        if (!/\bauto\b/.test(ar)) {
          img.attrRatio = 1 / r;
          img.ratioForced = true;
        } else img.attrRatio ??= 1 / r;
      }
    }
    // box-sizing: border-box の画像の幅・高さの指定は、枠・内側の余白を含む大きさ (CSS Box Sizing 3 §4.1)。画像の箱 (LImage.width・height) は内容の大きさ
    if (/^(img|object)$/.test(el.localName) && c('box-sizing') === 'border-box' && this.src.isAuto) {
      const edge = (a: string, b: string) => (cssLen(c(`padding-${a}`)) ?? 0) + (cssLen(c(`padding-${b}`)) ?? 0) + (cssLen(c(`border-${a}-width`)) ?? 0) + (cssLen(c(`border-${b}-width`)) ?? 0);
      if (img.width !== undefined && this.src.isAuto(el, 'width') === false) img.width = Math.max(0, img.width - edge('left', 'right'));
      if (img.height !== undefined && this.src.isAuto(el, 'height') === false) img.height = Math.max(0, img.height - edge('top', 'bottom'));
    }
    // 指定が無く、max-width などの上限・下限があれば、ブラウザが置いた大きさ (上限・下限が効いた大きさ。画像を読めたときだけ)。
    // 上限・下限が無ければ、Kumiori が読んだ画像本来の大きさ (image-resolution の指定がある画像は、その解像度で決める。ブラウザはこの指定を知らない)
    const limited = ['max-width', 'max-height'].some((p) => !/^(none|)$/.test(c(p))) || ['min-width', 'min-height'].some((p) => !/^(0px|auto|)$/.test(c(p)));
    // 既定のスタイルの max-width (Kumiori の既定の img { max-width: 100% }。印刷で、ページの幅からはみ出さないために足しているもの) で
    // 縮めるときは、属性の大きさ (表示のための指定) を、縦横比を保って縮める (0.3.0 までと同じ)。属性の大きさは aspect-ratio: auto w / h
    // にもなる (HTML §15.4.3) ので、属性の大きさを望む大きさとして、CSS 2.1 §10.4 の表 (幅・高さが auto のときの、比を保つ上限・下限の当て方) で
    // 決める。作成者が width・height・max-width を CSS で書いたときは、CSS のとおり (幅と高さがどちらも決まっていれば、それぞれに上限・下限を
    // 当てるだけ。§10.4。作成者の img { max-width: 100% } だけなら、ブラウザと同じに高さは属性のまま)
    const uaFit =
      /^(img|object)$/.test(el.localName) && this.src.sizeOrigin?.(el, 'max-width') === 'ua' && this.src.sizeOrigin(el, 'width') !== 'author' && this.src.sizeOrigin(el, 'height') !== 'author';
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
        // 本来の比の無い画像 (大きさも viewBox も無い SVG) は、属性の比 (LImage.attrRatio) があればそれ
        const ratio = ((nat as { noRatio?: true }).noRatio || img.ratioForced) && img.attrRatio ? img.attrRatio : nat.height / nat.width;
        const [minW, maxW, minH, maxH] = [px('min-width', 0), px('max-width', Infinity), px('min-height', 0), px('max-height', Infinity)];
        const clampW = (v: number) => Math.min(Math.max(v, minW), Math.max(minW, maxW));
        const clampH = (v: number) => Math.min(Math.max(v, minH), Math.max(minH, maxH));
        let w: number, h: number;
        // §10.4 の表は、幅と高さの両方が auto のときのもの。片方が決まっていれば (0 も)、その向きは最小・最大だけを当て、
        // もう一方は、当てた後の値と縦横比から出して (§10.3.2・§10.6.2)、その向きの最小・最大を当てる。両方が決まっていれば、それぞれに当てる。
        // 既定のスタイルの max-width で縮める属性の大きさ (uaFit) は、既定の max-width が、属性の大きさ (無い向きは縦横比から) の幅を実際に
        // 縮めるときだけ、§10.4 の表で、縦横比を保って縮める。縮めないとき (上限より狭い・0 の属性を下限で広げる) は、下のふつうの決め方
        const w0 = img.width !== undefined ? img.width / PT_PER_PX : img.height !== undefined ? img.height / PT_PER_PX / ratio : nat.width;
        if (uaFit && (img.width !== undefined || img.height !== undefined) && clampW(w0) < w0 - 0.005)
          [w, h] = constrainReplaced(w0, img.height !== undefined ? img.height / PT_PER_PX : w0 * ratio, minW, maxW, minH, maxH);
        else if (img.width !== undefined && img.height !== undefined) [w, h] = [clampW(img.width / PT_PER_PX), clampH(img.height / PT_PER_PX)];
        else if (img.width !== undefined) {
          w = clampW(img.width / PT_PER_PX);
          h = clampH(w * ratio);
        } else if (img.height !== undefined) {
          h = clampH(img.height / PT_PER_PX);
          w = clampW(h / ratio);
        } else [w, h] = constrainReplaced(nat.width, nat.height, minW, maxW, minH, maxH);
        img.width = w * PT_PER_PX;
        img.height = h * PT_PER_PX;
      }
    }
    // 百分率の幅・上限・下限 (LImage.percentSize): 組むときに、行を組む包含ブロックの内容の幅で解き直す (CSS 2.1 §10.2・§10.4)。
    // 上の大きさ (見積もりの幅で決めたもの) は、組版エンジンが解かないとき (縦書きの行など) に使う
    // 行内の要素として組む inline-flex・inline-grid の容器 (flowChildren の inlineFlex) の中の画像は、解き直さない: 百分率の基準は、その容器の
    // 内容の幅 (Flexbox 1 §9.2・CSS 2.1 §10.1) だが、容器を箱として組まないので、組むときの包含ブロックは外の行になる。読み込みの見積もり
    // (カスケードが、容器の幅を基準にして解いた値) のまま (0.3.0 と同じ)
    // 行内の svg の百分率の幅 (width: 100% など) も同じ (前は、見積もりの幅のままで、grid の列・表のセルの中で、置く所より広く描いた)
    if (!this.src.rect && this.src.percentOf && (el.localName === 'img' || el.localName === 'object' || (el.localName === 'svg' && !!this.src.percentOf(el, 'width'))) && !this.inh(el, 'image-resolution', true) && !this.inInlineFlexBox(el)) {
      const pl = (p: string): PercentLength | undefined => {
        const v = this.src.percentOf!(el, p);
        if (v) return { pct: v.f, len: v.px * PT_PER_PX };
        return /px$/.test(c(p)) && (p !== 'width' || this.src.isAuto?.(el, 'width') === false) ? { pct: 0, len: cssLen(c(p))! } : undefined;
      };
      // 長さだけの上限・下限も、読み込みのときに画像本来の大きさが分からなければ (上で大きさを決められなければ)、組版エンジンに当てさせる
      // (前は当てず、max-width: 50px の画像を本来の大きさで描いていた)
      const natUnknown = limited && !((this.opts.imageSize?.(key)?.width ?? 0) > 0);
      if (['width', 'max-width', 'min-width'].some((p) => this.src.percentOf!(el, p)) || natUnknown) {
        const ps: NonNullable<LImage['percentSize']> = {};
        const w = pl('width');
        const mx = pl('max-width');
        const mn = pl('min-width');
        if (w) ps.width = w;
        else if (img.width !== undefined && this.src.isAuto?.(el, 'width') === undefined && el.getAttribute('width')) ps.width = { pct: 0, len: parseFloat(el.getAttribute('width')!) * PT_PER_PX };
        if (mx) ps.maxWidth = mx;
        if (mn) ps.minWidth = mn;
        const mnh = /px$/.test(c('min-height')) ? cssLen(c('min-height')) : undefined;
        const mxh = /px$/.test(c('max-height')) ? cssLen(c('max-height')) : undefined;
        if (mnh) ps.minHeight = mnh;
        if (mxh !== undefined) ps.maxHeight = mxh;
        const hAttr = el.getAttribute('height');
        const hAuto = this.src.isAuto?.(el, 'height');
        const h = hAuto === false ? cssLen(c('height')) : hAuto === undefined && hAttr && /^\d+(\.\d+)?$/.test(hAttr) ? parseFloat(hAttr) * PT_PER_PX : undefined;
        if (h !== undefined) ps.height = h;
        if (uaFit && mx && ps.maxWidth) {
          ps.uaFit = true;
          // 属性の幅と高さの比 (flex の項目の画像で、幅を項目の幅に置き換えても、属性の比で高さを決める: imageFillsItem)
          if (ps.width?.pct === 0 && ps.width.len > 0 && h !== undefined) ps.fitRatio = h / ps.width.len;
        }
        img.percentSize = ps;
      }
    }
    // box-sizing: border-box の幅・上限・下限は、枠・内側の余白を含む (上で内容の大きさに直した width・height と同じに、長さの部分から引く)
    if (img.percentSize && /^(img|object)$/.test(el.localName) && c('box-sizing') === 'border-box') {
      const ps = img.percentSize;
      const eh = (cssLen(c('padding-left')) ?? 0) + (cssLen(c('padding-right')) ?? 0) + (cssLen(c('border-left-width')) ?? 0) + (cssLen(c('border-right-width')) ?? 0);
      const ev = (cssLen(c('padding-top')) ?? 0) + (cssLen(c('padding-bottom')) ?? 0) + (cssLen(c('border-top-width')) ?? 0) + (cssLen(c('border-bottom-width')) ?? 0);
      for (const k of ['width', 'maxWidth', 'minWidth'] as const) if (ps[k]) ps[k] = { pct: ps[k]!.pct, len: ps[k]!.len - eh };
      if (ps.height !== undefined && this.src.isAuto?.(el, 'height') === false) ps.height = Math.max(0, ps.height - ev);
    }
    // 組むときに解き直さない百分率の幅 (行内の svg など) は、見積もりの幅だと印を付ける (grid の項目の min-content で 0 にする: LImage.estimatedWidth)
    if (!img.percentSize && img.width !== undefined && this.src.isPercent?.(el, 'width')) img.estimatedWidth = true;
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
    // object-fit (幅・高さの両方があるとき。CSS Images 3 §4.5) と、枠の中での位置 object-position (§4.6。初期値は中央)
    const fit = c('object-fit');
    if (img.width !== undefined && img.height !== undefined && (fit === 'cover' || fit === 'contain' || fit === 'fill' || fit === 'none' || fit === 'scale-down')) {
      img.fit = fit;
      const pos = fit === 'fill' ? undefined : objectPositionOf(c('object-position'));
      if (pos) img.fitPosition = pos;
    }
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
      const m = trailingResolution(res.replace(/from-image|snap/gi, '').trim());
      if (m) {
        const n = parseFloat(m[0]);
        const dpi = (m[1] ?? 'dpi').toLowerCase() === 'dpcm' ? n * 2.54 : /^(dppx|x)$/i.test(m[1] ?? '') ? n * 96 : n;
        if (dpi > 0 && Math.abs(dpi - 96) > 1e-6) img.widthScale = img.heightScale = 96 / dpi;
      }
    }
    // visibility: hidden・collapse の画像は、場所を残して描かない (色を transparent にして運ぶ。組版エンジンが画像に描かない印を付ける)
    if (/^(hidden|collapse)$/.test(this.cs(el)('visibility'))) img.color = 'transparent';
    // 描くときだけの効果 (transform・opacity。画像は置換要素なので、行内でも変換できる)
    const fx = this.paintEffectOf(el);
    if (fx) img.paintEffect = fx;
    return img;
  }

  /** インライン要素 */
  private inline(el: Element, parent: Element): LInlineLevel[] {
    return this.located(el, () => this.inline0(el, parent));
  }
  private inline0(el: Element, parent: Element): LInlineLevel[] {
    const out = this.inlineBox(el, parent);
    if (this.struct) for (const n of out) this.tagNode(n, el);
    // position: relative の行内の箱 (CSS 2.1 §9.4.3): 組んだ箱を left・top (無ければ right・bottom の逆) だけずらす。ずらしは、まわりの
    // 配置を変えない (後に続く字は、ずらす前の位置のまま)。組版には関わらないので、描くときだけの移動 (PaintEffect の translate) にする。
    // 行内の箱は、行ごとの断片とその中の箱がそれぞれ別の領域になるので、中の行内の節のそれぞれに同じ移動を付ける
    const c = this.cs(el);
    if (c('position') === 'relative') {
      const off = (p: 'top' | 'right' | 'bottom' | 'left') => (this.src.isAuto?.(el, p) === false ? cssLen(c(p)) : undefined);
      const x = off('left') ?? (off('right') !== undefined ? -off('right')! : 0);
      const y = off('top') ?? (off('bottom') !== undefined ? -off('bottom')! : 0);
      if (x || y) for (const n of out) shiftInline(n, x, y);
    }
    // 中の絶対配置の箱の基準になる行内の箱 (positioned が番号を振ったもの): 番号を節に付ける
    const key = this.inlineCbKeys.get(el);
    if (key !== undefined) for (const n of out) if (typeof n !== 'string' && (n.type === 'inline' || n.type === 'inline-container') && n.cbKey === undefined) n.cbKey = key;
    return out;
  }

  private inlineBox(el: Element, parent: Element): LInlineLevel[] {
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
      const data = this.objectImage(el);
      if (data) return [this.replacedBox(el, this.image(el, data))];
    }
    if (name === 'img') {
      const src = el.getAttribute('data-kumiori-src') ?? el.getAttribute('src') ?? '';
      if (!src) return [];
      return [this.replacedBox(el, this.image(el, src))];
    }
    // 文書の中に直接書いた <svg>: 単独の SVG 文書 (data URI) にして、<img> と同じ画像として組む
    // 文書の CSS の fill・stroke・color など (と、外から継承した値) は、要素の style 属性に書き足して渡す (SVG 2 §6.4・§6.6)
    if (isInlineSvg(el)) return [this.replacedBox(el, this.image(el, inlineSvgDataUri(el, this.src.svgStyle ? (e, root) => this.src.svgStyle!(e, root) : undefined)))];
    // 数式 (MathML の math 要素): 数式用の書体があれば、組んだ図形にする
    if (this.opts.mathFont && this.isMath(el)) return [this.mathFormula(el)];
    if (name === 'ruby') {
      // ルビの箱 (ruby・rb・rt・rtc) の輪郭線 (outline) は描けない (ルビは、親文字とルビの字の組として組み、要素の箱を作らない)。知らせる
      if ([el, ...(Array.from(el.getElementsByTagName('*')) as Element[]).filter((e) => /^(rb|rt|rtc)$/.test(e.localName))].some((e) => this.paintEffectOf(e)?.outline)) this.miss(msg('outline (ruby・rb・rt・rtc)', 'outline (ruby, rb, rt, rtc)'));
      // <ruby>親文字<rt>ルビ</rt>…</ruby> (rp は除く)。ルビは、直前の rt から後の親文字と対になる (Ruby 1 §2.3。
      // <ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby> は 2 組)。rb を並べた書き方 (rb…rb rt…rt) は、順番どうしで対にする
      const kids = Array.from(el.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).localName === 'rp'));
      const isEl = (n: Node, nm: string) => n.nodeType === 1 && (n as Element).localName === nm;
      const txt = (n: Node) => n.textContent ?? '';
      const out: LInlineLevel[] = [];
      // rtEl・underEl: 注釈の要素 (rt・rtc。ルビの字の色と ruby-align を取る)。con・underCon: 段の入れ物が rtc のとき、その要素
      // (ruby-position・ruby-overhang を取る。無名の入れ物は ruby から継承する)。baseEl: 親文字の要素 (rb)。
      // merged・underMerged: ruby-merge: merge でまとめた段 (ruby-align は入れ物の値を使う。CSS Ruby 1 §4.3)
      const pairs: Array<{ base: string; rt: string; under?: string; rtEl?: Node; underEl?: Node; con?: Element; underCon?: Element; baseEl?: Element; merged?: boolean; underMerged?: boolean }> = [];
      const conOf = (l: { con?: Element } | undefined) => l?.con ?? el;
      // rtc (ルビの段の入れ物): rt の後の rtc は 2 段目 (ruby-position: alternate で下側。Ruby 1 §4.1)。
      // それまでの組をまとめた親文字に掛ける (rt の無い最初の rtc は 1 段目)
      if (kids.some((n) => isEl(n, 'rb'))) {
        // rb を使う書き方は、CSS Ruby 1 §2.2 の無名の箱の作り方で組を作る: ruby の直下の、続いた字の並び (rb・rt・rtc の外) は
        // 無名の親文字にして、rb と同じ親文字の段に入れる (空白だけなら捨てる)。続いた rt は 1 つの段 (無名の段の入れ物)、rtc は 1 段。
        // 親文字の段と、その後の段が 1 つの区切り (ruby segment。§2.3.1)
        type Level = { anon: boolean; items: string[]; nodes: Node[]; con?: Element };
        type Seg = { bases: string[]; baseEls: Array<Element | undefined>; levels: Level[] };
        const segs: Seg[] = [];
        let seg: Seg | undefined;
        let rtRun: Level | undefined;
        let text = '';
        const addBase = (b: string, rb?: Element) => {
          if (!seg || seg.levels.length) segs.push((seg = { bases: [], baseEls: [], levels: [] }));
          seg.bases.push(b);
          seg.baseEls.push(rb);
          rtRun = undefined;
        };
        const flushText = () => {
          if (text.trim()) addBase(text);
          text = '';
        };
        for (const n of kids) {
          if (isEl(n, 'rb')) {
            flushText();
            addBase(txt(n), n as Element);
          } else if (isEl(n, 'rt') || isEl(n, 'rtc')) {
            flushText();
            if (!seg) segs.push((seg = { bases: [], baseEls: [], levels: [] }));
            if (isEl(n, 'rt')) {
              if (!rtRun) seg.levels.push((rtRun = { anon: false, items: [], nodes: [] }));
              rtRun.items.push(txt(n));
              rtRun.nodes.push(n);
            } else {
              // rtc の中の rt はそれぞれの注釈、rt の無い rtc は 1 つの無名の注釈 (区切りの親文字すべてに掛かる。§2.3.2)
              const rts = Array.from((n as Element).childNodes).filter((k) => isEl(k, 'rt'));
              seg.levels.push(rts.length ? { anon: false, items: rts.map(txt), nodes: rts, con: n as Element } : { anon: true, items: [txt(n)], nodes: [n], con: n as Element });
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
          // ruby-merge: merge (CSS Ruby 1 §4.2): 区切りの中の注釈をつなげて、親文字すべてに掛かる 1 つの注釈にする (グループルビ)。
          // 段の入れ物 (rtc。無名の入れ物は ruby) の値。2 つの段の片方だけが merge で、もう片方が親文字ごとの注釈のときは、
          // 組を分けたまま (separate) にして、未対応として知らせる
          const mergeOf = (l: Level | undefined) => !!l && !l.anon && nb > 1 && this.rubyDecl(conOf(l), 'ruby-merge') === 'merge';
          let [m1, m2] = [mergeOf(l1), mergeOf(l2)];
          if ((m1 && l2 && !l2.anon && !m2) || (m2 && l1 && !l1.anon && !m1)) {
            this.miss(msg('ruby-merge: merge (片方の段だけ)', 'ruby-merge: merge (on one level only)'));
            m1 = m2 = false;
          }
          if (!nb || l1?.anon || l2?.anon || m1 || m2)
            pairs.push({ base: sg.bases.join(''), rt: l1?.items.join('') ?? '', rtEl: l1?.nodes[0], con: l1?.con, baseEl: sg.baseEls[0], ...(m1 ? { merged: true } : {}), ...(l2 ? { under: l2.items.join(''), underEl: l2.nodes[0], underCon: l2.con, ...(m2 ? { underMerged: true } : {}) } : {}) });
          else
            sg.bases.forEach((b, k) =>
              pairs.push({ base: b, rt: per(l1, k), rtEl: l1?.nodes[Math.min(k, l1.nodes.length - 1)], con: l1?.con, baseEl: sg.baseEls[k], ...(l2 ? { under: per(l2, k), underEl: l2.nodes[Math.min(k, l2.nodes.length - 1)], underCon: l2.con } : {}) }),
            );
        }
      } else {
        let base = '';
        let sinceRtc = 0;
        for (const n of kids) {
          if (isEl(n, 'rtc') && !base.trim() && sinceRtc > 0) {
            // 2 段目: 直前の rtc の後の組をまとめ、下側のルビにする
            const group = pairs.splice(pairs.length - sinceRtc, sinceRtc);
            pairs.push({ base: group.map((g) => g.base).join(''), rt: group.map((g) => g.rt).join(''), rtEl: group[0]?.rtEl, con: group[0]?.con, under: txt(n), underEl: n, underCon: n as Element });
            sinceRtc = 0;
            base = '';
          } else if (isEl(n, 'rt') || isEl(n, 'rtc')) {
            pairs.push({ base, rt: txt(n), rtEl: n, ...(isEl(n, 'rtc') ? { con: n as Element } : {}) });
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
      const rubyColor = visibleColorOf(this.cs(el)('color'));
      const colorOf = (n: Node | undefined) => {
        if (!n || n.nodeType !== 1) return undefined;
        const e = n as Element;
        const v = this.printOf(this.pg(e), 'color') ?? visibleColorOf(this.cs(e)('color'));
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
        // ruby-position (CSS Ruby 1 §4.1。段の入れ物の値): 1 段目は under を含めば下側、ほかは上側 (alternate だけ・over。
        // inter-character は、縦書きでは over と同じ。横書きの inter-character は未対応で、over として組んで知らせる)。
        // 2 段目は、alternate (初期値) なら 1 段目の逆の側。over・under を明示して 1 段目と同じ側になるとき (外へ重ねる) は未対応で、逆の側に置いて知らせる
        const posOf = (c: Element) => {
          const v = this.rubyDecl(c, 'ruby-position');
          if (v === 'inter-character' && !/^(vertical|sideways)/.test(this.cs(el)('writing-mode'))) this.miss(msg('ruby-position: inter-character (横書き)', 'ruby-position: inter-character (horizontal writing)'));
          return v;
        };
        const isUnder = (v: string) => /\bunder\b/.test(v);
        const p1 = t ? posOf(pr.con ?? el) : '';
        const under1 = isUnder(p1);
        // vertical-lr: 行の上側 (line-over) は右 = 行の並ぶ向きの後ろ側、下側 (line-under) は左 = 前の側 (CSS Writing Modes 3 §6.4 の表)。
        // LRuby は注釈を置く側を行の並ぶ向きで持つ (rubyPosition: 'under' = 後ろ側) ので、入れ替えて渡す
        const lrRuby = /vertical-lr|sideways-lr/.test(this.cs(el)('writing-mode'));
        if (t && u) {
          const p2 = posOf(pr.underCon ?? el);
          if (p2 && !/\balternate\b/.test(p2) && isUnder(p2) === under1) this.miss(msg('ruby-position (同じ側の 2 段)', 'ruby-position (two levels on the same side)'));
        }
        // ruby-overhang (§5.1。段の入れ物の値): auto を明示したら前後の字に掛け、none なら掛けない。指定が無ければ、これまでどおり掛けない
        // (初期値 auto は、掛けるかどうかを処理系に任せる)
        const oh = this.rubyDecl(pr.con ?? el, 'ruby-overhang');
        // ruby-align (§4.3。親文字・注釈の箱ごとの値。まとめた注釈 (ruby-merge: merge) は入れ物の値)
        const alignOf = (n: Node | undefined) => (n && n.nodeType === 1 ? (this.rubyDecl(n as Element, 'ruby-align') as RubyAlign | '') : '');
        const a1 = t ? alignOf(pr.merged ? (pr.con ?? el) : (pr.rtEl ?? el)) : '';
        const a2 = u ? alignOf(pr.underMerged ? (pr.underCon ?? el) : (pr.underEl ?? el)) : '';
        const ab = alignOf(pr.baseEl ?? el);
        out.push({
          type: 'ruby',
          baseText: b,
          rubyText: t,
          ...(u ? { rubyTextUnder: u } : {}),
          ...(scale && Math.abs(scale - 0.5) > 1e-6 ? { rubyScale: scale } : {}),
          ...(rc ? { rubyColor: rc } : {}),
          ...(uc ? { rubyColorUnder: uc } : {}),
          ...(under1 !== lrRuby ? { rubyPosition: 'under' } : {}),
          ...(a1 ? { rubyAlign: a1 } : {}),
          ...(a2 ? { rubyAlignUnder: a2 } : {}),
          ...(ab ? { rubyAlignBase: ab } : {}),
          ...(oh ? { rubyOverhang: oh === 'auto' } : {}),
        } as LRuby);
      }
      // タグ付き PDF: 親文字とルビの組ごとに Ruby (RB・RT。ISO 32000-1 §14.8.4.3.5)。rp (括弧) は描かないので書かない
      if (this.sb) {
        const parent = this.st(el);
        const base = this.orderOf(el);
        out.forEach((r, k) => {
          if (typeof r === 'object' && r.type === 'ruby') this.sb!.ruby(r, parent, base + (k + 1) * 1e-3);
        });
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
      const ic: LInlineContainer = { type: 'inline-container', decorateBox: false, ...this.textStyle(el, parent), children: [t] };
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
      // top・bottom の箱は、自分の部分木を作る (CSS 2.1 §10.8.1。囲む top・bottom の行内の要素の部分木に入れない)
      if (iva === 'top' || iva === 'bottom') ic.ownLineAlign = true;
      return [ic];
    }
    // inline-block: 行内の箱 (中にブロックを持てる。幅の指定が無ければ中身に合わせた幅)
    if (c('display') === 'inline-block') {
      const box = this.boxStyle(el);
      delete box.breakBefore;
      delete box.breakAfter;
      const ic: LInlineContainer = {
        type: 'inline-container',
        decorateBox: false,
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
      // top・bottom の箱は、自分の部分木を作る (CSS 2.1 §10.8.1。囲む top・bottom の行内の要素の部分木に入れない)
      if (iva === 'top' || iva === 'bottom') ic.ownLineAlign = true;
      return [ic];
    }
    // display: contents (CSS Display 3 §2.5): 箱を作らないので、罫線・背景・内側と外側の余白・vertical-align は付けず、受け継ぐ書式だけを中身に渡す
    if (c('display') === 'contents') return [{ type: 'inline', ...this.textStyle(el, parent), children: this.flowChildren(el, true) as LInlineLevel[] }];
    const inl: LInline = { type: 'inline', ...this.textStyle(el, parent), children: this.flowChildren(el, true) as LInlineLevel[] };
    this.inlineBoxInto(inl, el, parent);
    const wari = this.warichuOf(el);
    if (wari) inl.warichu = wari;
    // 割注の中の字でない箱 (画像・数式・inline-block など) は組まない (warichu.ts の dropWarichuBoxes)。知らせる
    if (wari && dropWarichuBoxes(inl.children)) this.miss(msg('割注の中の字でない箱 (画像・inline-block など)', 'non-character boxes in warichu (images, inline-block, etc.)'));
    const inlId = el.getAttribute('id');
    if (inlId) inl.id = inlId;
    // 中身の無い行内要素も、字の大きさと行の高さを行の箱に入れる (CSS 2.1 §10.8)
    if (!inl.children.length) inl.emptyStrut = true;
    const link = this.linkOf(el);
    if (link) inl.link = link;
    return [inl];
  }

  /**
   * 割注 (Kumiori の拡張。warichu.ts): -kumiori-warichu: none | auto (初期値 none。受け継がない) が auto の行内の要素は、中身を 2 行に割って
   * 行の中に入れる。前後の括弧は -kumiori-warichu-brackets: auto | none | <string> <string> (初期値 auto = 全角の丸括弧。受け継がない)。
   * 標準の CSS にも、他の組版ソフトの拡張にも割注の書き方が無いので、Kumiori の接頭辞の付いた名前にしている (どの互換の指定でも読む)
   */
  private warichuOf(el: Element): LWarichu | undefined {
    const c = this.cs(el);
    const v = c('-kumiori-warichu').trim();
    if (v === 'none' || v === '') return undefined;
    if (v !== 'auto') {
      this.miss(`-kumiori-warichu: ${v}`);
      return undefined;
    }
    if (!this.isWarichuElement(el)) {
      // 割注の中の割注 (入れ子) は、割注の 2 行の中に、さらに 2 行を割って置けないので、内側は割注にしない。指定を読まなかったことを知らせる
      // (割注にできない要素は、組む前に warnIneffectiveWarichu が知らせる)
      if (this.warichuCandidate(el)) this.miss(msg('-kumiori-warichu (割注の中の割注)', '-kumiori-warichu (warichu inside warichu)'));
      return undefined;
    }
    const bv = c('-kumiori-warichu-brackets');
    let b = parseWarichuBrackets(bv, unescapeCss);
    if (!b) {
      this.miss(`-kumiori-warichu-brackets: ${bv.slice(0, 30)}`);
      b = parseWarichuBrackets('auto')!;
    }
    const w: LWarichu = { ...b };
    const parts = this.sb?.warichuParts(el, b);
    if (parts) w.tagParts = parts;
    return w;
  }

  /**
   * <object> を画像として組むときの、その画像 (data 属性)。画像の型 (type 属性が image/…、または data の拡張子) で、読み込まれているもの。
   * 無ければ undefined (中の代わりの内容を組む。HTML Living Standard §4.8.7 の object 要素)
   */
  private objectImage(el: Element): string | undefined {
    const data = el.getAttribute('data') ?? '';
    const isImage = /^image\//i.test(el.getAttribute('type') ?? '') || /\.(svgz?|png|jpe?g|gif|webp|bmp|tiff?)$/i.test(data);
    return data && isImage && this.opts.hasAsset?.(normalizeSrc(data)) !== false ? data : undefined;
  }

  /**
   * 割注として組む要素か: 割注にできる要素 (warichuCandidate) で、割注の中の要素でないもの (入れ子の内側は割注にしない)。
   * 祖先をたどるのは、同じ行の並び (inline formatting context) の中だけ: 間に行内でない箱 (ブロック・inline-block・表のセルなど) が
   * あれば、そこで止める。外側の割注がブロックを含むときは、ブロックの前後で分かれ、ブロックの中の行は外側の割注の 2 行の中に無いので、
   * その中の割注は入れ子でない (CSS 2.1 §9.2.1.1: ブロックを含む行内の箱は、ブロックの前後で分かれる)。
   * display: contents の祖先は箱を作らないので、越えてたどる (CSS Display 3 §2.5)
   */
  private isWarichuElement(el: Element): boolean {
    if (!this.warichuCandidate(el)) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (this.warichuCandidate(p)) return false;
      const d = this.display(p);
      if (d !== 'inline' && d !== 'contents') break;
    }
    return true;
  }

  /**
   * 割注にできる要素か: -kumiori-warichu の値が auto で (読めない値は warichuOf が警告に出す)、行内の箱 (display: inline) を作る、
   * 置換要素・ルビ・縦中横・改行などでない要素。計算値が inline でも、ブロック化される要素 (blockified) は行内の箱を作らないので除く
   */
  private warichuCandidate(el: Element): boolean {
    const c = this.cs(el);
    if (c('-kumiori-warichu').trim() !== 'auto') return false;
    if (c('display') !== 'inline' || NOT_WARICHU_ELEMENTS.has(el.localName) || this.blockified(el)) return false;
    return c('text-combine-upright') !== 'all' && c('-webkit-text-combine') !== 'horizontal';
  }

  /**
   * display の値が inline でも、ブロックの箱を作る (ブロック化される) 要素か (CSS Display 3 §2.7 Automatic Box Type Transformations):
   * 絶対配置・固定配置の要素と、float が none でない要素 (CSS 2.1 §9.7 の表: display を block にする。ページの組版の float・脚注
   * (CSS GCPM 3 §2) と、柱へ移す要素 (position: running()。CSS GCPM 3 §1.3) も、流れの外のブロックとして組む)、
   * flex・grid の容器の子 (CSS Flexbox 1 §4: 子はフレックスの項目になり、display をブロック化する。CSS Grid 1 §6.1 も同じ)。
   * 親が display: contents なら、その親が容器の子の代わりになる (CSS Display 3 §2.5: 箱を作らず、子が祖先の箱の子になる)
   */
  private blockified(el: Element): boolean {
    if (this.outOfFlow(el) || (this.cs(el)('float') || 'none') !== 'none') return true;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const d = this.display(p);
      if (d !== 'contents') return /\b(flex|grid)\b/.test(d);
    }
    return false;
  }

  /**
   * -kumiori-warichu: auto が、割注にできない要素 (display が inline でない要素・ブロック化される要素・置換要素・ルビ・縦中横・改行など) に
   * 付いていれば知らせる (要素ごとに 1 回)。割注は行内の要素にだけ効く (ブロック・inline-block の中身は、割注の 2 行に割れない)。
   * リスト項目・絶対配置・フレックスの項目などは、ブロック・行内の箱を組む入口 (block・inline) を通らずに組むので、組む前に文書の
   * 要素をまとめて調べる。組まない要素 (display: none の要素とその中) は調べない
   */
  private warnIneffectiveWarichu(root: Element): void {
    const stack: Element[] = [root];
    const prev = this.curEl;
    try {
      while (stack.length) {
        const e = stack.pop()!;
        const c = this.cs(e);
        if (c('display') === 'none') continue;
        if (c('-kumiori-warichu').trim() === 'auto' && !this.warichuCandidate(e)) {
          this.curEl = e;
          this.miss(msg('-kumiori-warichu (行内の要素 (display: inline) でないもの・置換要素・ルビ・縦中横)', '-kumiori-warichu (elements other than inline elements (display: inline), replaced elements, ruby, text-combine-upright)'));
        }
        const kids = e.children;
        if (kids) for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
      }
    } finally {
      this.curEl = prev;
    }
  }

  /**
   * 割注の構造 (Warichu) を作る中身があるか: 空白でない字、::before・::after の生成内容。中身の無い割注は組まない
   * (inlineFlatten.ts の warichuAtoms) ので、構造も作らない。画像・inline-block などの字でない箱は、割注の中では組まない
   * (warichu.ts の dropWarichuBoxes) ので、その中の字も数えない
   */
  private hasWarichuContent(el: Element): boolean {
    const hasText = (x: Element): boolean => {
      for (const n of Array.from(x.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) {
          if (/\S/.test(n.textContent ?? '')) return true;
        } else if (n.nodeType === 1) {
          const e = n as Element;
          const d = this.cs(e)('display');
          // 行内の要素とルビ (ruby・rb・rt) の中の字は、割注の字。ほか (inline-block・置換要素・display: none など) は数えない
          if ((d === 'inline' || d === 'contents' || /^ruby/.test(d) || /^(ruby|rb|rt|rtc)$/.test(e.localName)) && !/^(img|svg|math|video|audio|canvas|iframe|object|embed|picture|input|select|textarea|button)$/.test(e.localName) && hasText(e)) return true;
        }
      }
      return false;
    };
    if (hasText(el)) return true;
    return (['::before', '::after'] as const).some((p) => !/^(none|normal|)$/.test(this.cs(el, p)('content').trim()));
  }

  /**
   * 行内の箱 (display: inline) の書式を inl に付ける: vertical-align・背景・罫線・内側の余白・box-decoration-break・行の進む方向の margin・
   * 不透明度。要素の箱と、その ::before・::after の箱 (pseudo) とで同じ道を通す (CSS Pseudo 4 §4.1: 生成される箱は、その要素の直下の子の
   * ように振る舞う。§4・§4.1: ::before・::after は fully styleable で、実際の要素に効く性質はすべて効く)。parent は、vertical-align: super の基準の字の大きさを持つ親 (擬似要素では el)
   */
  private inlineBoxInto(inl: LInline, el: Element, parent: Element, pseudo?: '::before' | '::after') {
    const c = this.cs(el, pseudo);
    const va = c('vertical-align');
    if (va === 'super' && this.opts.superShiftAh) inl.baselineShift = (cssLen(this.cs(parent)('font-size')) ?? 12) / 3;
    else if (va === 'super' || va === 'sub') inl.baselineShift = va;
    // top・bottom・middle・text-top・text-bottom (CSS 2.1 §10.8.1): 行の中身にするとき (inlineFlatten.ts) に位置を決める
    else if (va === 'top' || va === 'bottom' || va === 'middle' || va === 'text-top' || va === 'text-bottom') inl.verticalAlign = va;
    else if (cssLen(va)) inl.baselineShift = cssLen(va);
    else if (/^[+-]?(\d+(?:\.\d*)?|\.\d+)%$/.test(va)) {
      // 百分率は、この要素の line-height に対する割合だけ上げ下げする (CSS 2.1 §10.8.1)。line-height: normal は、書体の値 (textStyle と同じ)
      const fams = c('font-family').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
      const lh = cssLen(c('line-height')) ?? (this.opts.normalLineHeight?.(fams, (parseInt(c('font-weight'), 10) || 400) >= 600, this.normalOpts) ?? 1.2) * (cssLen(c('font-size')) ?? 12);
      const shift = (parseFloat(va) / 100) * lh;
      if (shift) inl.baselineShift = shift;
    }
    const bg = (pseudo ? undefined : this.printOf(this.pg(el), 'background-color', 'background')) ?? cssColor(c('background-color'));
    if (bg) inl.backgroundColor = bg;
    const box = this.boxStyle(el, pseudo);
    if (box.border) inl.border = box.border;
    if (box.padding) inl.padding = box.padding;
    // initial-letter は ::first-letter だけ (行の最初の行内の箱への指定 (CSS Inline 3 §7.3.1) は未対応。知らせる)
    if (parseInitialLetter(c('initial-letter') || '')) this.miss(msg('initial-letter (::first-letter 以外の箱)', 'initial-letter (boxes other than ::first-letter)'));
    // box-decoration-break: clone: 行で分かれた枠の断片のそれぞれを、罫線と内側の余白で包む (CSS Fragmentation 3 §5.4)
    if ((box.border || box.padding) && c('box-decoration-break') === 'clone') inl.boxDecorationBreak = 'clone';
    // 行の進む方向の margin は行内の空き (横書きは左右。右から左へ書く段落では入れ替わる。縦書きは上下)
    const vert = /^(vertical|sideways-rl)/.test(c('writing-mode'));
    const [ms, me] = vert ? [cssLen(c('margin-top')) ?? 0, cssLen(c('margin-bottom')) ?? 0] : [cssLen(c('margin-left')) ?? 0, cssLen(c('margin-right')) ?? 0];
    if (ms || me) {
      const rtl = !vert && c('direction') === 'rtl';
      inl.inlineMargin = { start: rtl ? me : ms, end: rtl ? ms : me, bound: true, ...(this.opts.inlineMarginStartAtWrapAh ? { dropStartAtWrap: true } : {}) };
    }
    // 不透明度 (opacity は行内の箱にも効く。変換は、置換要素でない行内の箱には効かない)。輪郭線 (outline) は、行ごとの断片に描く
    if (box.paintEffect) {
      const ie = this.inlineEffectOf(el, pseudo);
      if (ie.fx) inl.paintEffect = ie.fx;
      if (ie.outline) inl.outline = ie.outline;
    }
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
    if (lis.every((li) => this.cs(li)('list-style-type') === 'none' && !this.markerImage(li))) {
      const blocks: Array<LBlockLevel | LInlineLevel> = [];
      const pageFlowNone = this.pageFlowEls.has(container);
      lis.forEach((li, k) => {
        // 名前付きのページ: 項目でページの名前が変わる所に、切り替えを置く (下の表のリストと同じ。最初の項目は呼び出し側が置いている)
        if (k > 0 && pageFlowNone) {
          const sw = this.listItemPageSwitch(li, container);
          if (sw) blocks.push(sw as unknown as LBlockLevel);
        } else if (!pageFlowNone) this.pageIgnored(li, ['表のセル・段組などの中のリストの項目', 'list items in table cells, multi-column containers and so on']);
        pushAll(blocks, enter(li, k));
        const b = this.block(li, container);
        // 記号の無い項目: 中身は項目の本文 (LBody)
        if (b && this.struct) {
          const id = this.st(li);
          if (this.struct[id].role === 'LI') (b as { tag?: number }).tag = this.liPart(id, 'lbody');
        }
        if (b) blocks.push(b);
      });
      // 項目を並べる無名の箱: 最初の項目の前・最後の項目の後ろの区切りは、この箱の前後と同じ所 (CSS Fragmentation 3 §3.1.1)
      const out: LBlock = { type: 'block', children: blocks };
      this.propagateEdgeAvoids(out);
      return out;
    }
    this.report.counts.tables++;
    // 記号の列の幅は、リストの inline-start 側の字下げ (UA の padding-inline-start)。縦書きでは上 (padding-top)。表もその側へ引き戻す
    const startSide = /^(vertical|sideways-rl)/.test(c('writing-mode')) ? 'top' : 'left';
    const indent = (cssLen(c(`padding-${startSide}`)) ?? 0) + (cssLen(c(`margin-${startSide}`)) ?? 0);
    let n = reversed ? start + lis.length - 1 : start;
    // 項目の改ページの指定 (CSS Fragmentation 3 §3.1: break-before・break-after・break-inside は、通常の流れの block-level の箱に当たる。
    // list-item の箱も block-level)。項目は表の行にして組むので、行の指定にする (表の tr と同じ。区切りの種類 = ページ・段・左右のページを
    // そのまま渡す)。最初の項目の前・最後の項目の後ろの強制の区切りは、リストの箱の前後の区切りと同じ所なので
    // (§3.1.1 の区切りの値の伝播)、リストを組む表の前後の指定にする。
    // 項目の最初の子の break-before・最後の子の break-after も、項目の前後の区切りと同じ所 (§3.1.1): 項目の値と合わせる (§4.3)。
    // 避ける値 (avoid・avoid-page・avoid-column) も同じに合わせる (§3.1.1・§4.4 の Rule 1。propagateEdgeAvoids と同じ考え方): 項目か、
    // その最初 (最後) の子へたどったどれかが避けるなら、項目の前 (後ろ) では分けない。強制の区切りがあれば、強制が勝つ (§4.3)。
    // 最初の項目の前・最後の項目の後ろの値は、リストを組む表の前後の値にする。avoid-column は、リストが段組の容器なら、そこで止める
    let listBefore: LBlock['breakBefore'];
    let listAfter: LBlock['breakBefore'];
    let listAvoidBefore: AvoidKind | undefined;
    let listAvoidAfter: AvoidKind | undefined;
    const stopColumn = this.isMulticolContainer(container);
    const rowBreaks = (li: Element, k: number, body: LTableCell): Pick<LTableRow, 'breakBefore' | 'breakAfter' | 'keepTogether' | 'keepTogetherYields' | 'keepWithNext' | 'keepWithPrevious'> => {
      const lc = this.cs(li);
      const bb = lc('break-before') || lc('page-break-before');
      const ba = lc('break-after') || lc('page-break-after');
      const bi = lc('break-inside') || lc('page-break-inside');
      const edge = edgeBreaks(body.children);
      // 項目とその最初の子は同じ区切りに当たる。左右のページの指定は、流れの中で後ろの要素 (子) の値、break-after は項目の値が後ろ
      const fb = mergeBreaks(this.forcedBreak(bb, li), edge.before);
      const fa = mergeBreaks(edge.after, this.forcedBreak(ba, li));
      const ab = fb ? undefined : maxAvoid(this.avoidKind(bb, li), this.edgeAvoidOf(body.children, 'before'));
      const aa = fa ? undefined : maxAvoid(this.avoidKind(ba, li), this.edgeAvoidOf(body.children, 'after'));
      const o: ReturnType<typeof rowBreaks> = {};
      if (k === 0) {
        listBefore = fb;
        listAvoidBefore = ab === 'column' && stopColumn ? undefined : ab;
      } else {
        if (fb) o.breakBefore = fb;
        if (ab) o.keepWithPrevious = true;
      }
      if (k === lis.length - 1) {
        listAfter = fa;
        listAvoidAfter = aa === 'column' && stopColumn ? undefined : aa;
      } else {
        if (fa) o.breakAfter = fa;
        if (aa) o.keepWithNext = true;
      }
      if (this.avoidKind(bi, li)) {
        o.keepTogether = true;
        // 新しいページにも入らなければ、avoid を緩めて分ける (CSS Fragmentation 3 §4.4)
        if (!this.opts.avoidRowOverflowAh) o.keepTogetherYields = true;
      }
      return o;
    };
    // 名前付きのページ (CSS Page 3 §8.1: list-item の箱も block-level の箱なので、page が当たる): 項目でページの名前が変わる所で、
    // リストの表を分け、間にページシーケンスの切り替えを置く (body の直下へは hoistPageSwitches が引き上げる)。最初の項目の切り替えは、
    // 呼び出し側 (flowChildren) がリストの前に置いている。切り替えられない所 (表のセルの中のリストなど) の項目の page は、未対応として知らせる
    const pageSwitches = new Map<number, PageSwitch>();
    const pageFlow = this.pageFlowEls.has(container);
    const rows: LTableRow[] = lis.map((li, k) => {
      const lc = this.cs(li);
      if (k > 0 && pageFlow) {
        const sw = this.listItemPageSwitch(li, container);
        if (sw) pageSwitches.set(k, sw);
      } else if (!pageFlow) this.pageIgnored(li, ['表のセル・段組などの中のリストの項目', 'list items in table cells, multi-column containers and so on']);
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
      // list-style-image (CSS Lists 3 §3.2・§3.3): 画像が使えるときは、記号の代わりに、その画像 (行内の置換要素。画像本来の大きさ) を置く。
      // inside では、画像の後ろに空白を 1 つ置く (§3.2)。outside では、記号の列の右の空きがその代わり
      const mimg = this.markerImage(li);
      const mnode: LImage | undefined = mimg ? { type: 'image', src: mimg } : undefined;
      const insideMarker: LInlineLevel = mnode && inside ? { type: 'inline', children: [mnode, ' '] } : styled(insideText);
      const marker: LInlineLevel = mnode && !inside ? mnode : styled(outsideText);
      n += reversed ? -1 : 1;
      const fs = cssLen(lc('font-size')) ?? 12;
      this.liRows.add(li);
      const body: LTableCell = { type: 'table-cell', ...this.textStyle(li, container), ...this.paragraphStyle(li, container), children: this.flowChildren(li) };
      // position が static でない項目は、中の絶対配置の箱の基準 (項目の箱 = 本文のセル)
      if (this.makesCb(li)) body.containingBlock = true;
      // position: relative の項目のずらし (CSS 2.1 §9.4.3): 項目の箱 (記号のセルと本文のセル) を、組んだ後で動かす
      const liRel = this.relativeOffsetOf(li);
      if (liRel) body.relativeOffset = liRel;
      // 記号は li の内容の先頭の行内の字 (最初の子がブロックなら、その前の行になる。Lists 3 §3.5)
      if (insideMarker) (body.children as Array<LBlockLevel | LInlineLevel>).unshift(insideMarker);
      if (marks.length) (body.children as Array<LBlockLevel | LInlineLevel>).unshift(...marks);
      // li の id (目次・索引の参照先) は、本文の列のセルに付ける
      const liId = li.getAttribute('id');
      if (liId) body.id = liId;
      const box = this.boxStyle(li);
      const liMb = (box.margin as Record<string, number> | undefined)?.bottom ?? 0;
      // 最後の項目: 最後の子の下の余白と li の下の余白は、リストの外へ抜けて、リストの後ろの余白・次のブロックの上の余白と重なる
      // (CSS 2.1 §8.3.1。li とリストに下の枠・padding が無いとき)。セルの高さに含めず、表の後ろの余白にする (trailingSpaceOut)
      const lastOut = k === lis.length - 1 && !(cssLen(lc('padding-bottom')) ?? 0) && !(cssLen(lc('border-bottom-width')) ?? 0) && !(cssLen(c('padding-bottom')) ?? 0) && !(cssLen(c('border-bottom-width')) ?? 0);
      if (box.margin) body.padding = { top: (box.margin as Record<string, number>).top ?? 0, bottom: lastOut ? 0 : liMb };
      if (lastOut) body.trailingSpaceOut = liMb;
      // タグ付き PDF: 項目 (LI) の行、記号 (Lbl) のセル、本文 (LBody) のセル (ISO 32000-1 §14.8.4.3 のリストの要素)
      const liTag = this.struct ? this.st(li) : undefined;
      const isLi = liTag !== undefined && this.struct![liTag].role === 'LI';
      const tags = liTag === undefined ? undefined : { row: liTag, lbl: isLi ? this.liPart(liTag, 'lbl') : liTag, lbody: isLi ? this.liPart(liTag, 'lbody') : liTag };
      if (tags) body.tag = tags.lbody;
      return {
        type: 'table-row',
        ...(tags ? { tag: tags.row } : {}),
        // 描くときだけの効果 (li の transform・opacity): 項目の行 (記号と本文) に掛ける
        ...(box.paintEffect ? { paintEffect: box.paintEffect } : {}),
        ...rowBreaks(li, k, body),
        ...(marker ? { listMarkerRow: true } : {}),
        // 記号・番号は、本文の最初の行の基線にそろえる (CSS Lists: 外側の記号は最初の行の箱に置く)
        // 本文の最後の子の下の余白は、li の外へ抜けて次の項目との間に残る (CSS 2.1 §8.3.1)。セルの高さに含める
        cells: [{ type: 'table-cell', ...(tags ? { tag: tags.lbl } : {}), textAlign: 'end', blockAlign: 'baseline', padding: { right: fs * 0.5 }, ...this.textStyle(li, container), noWrap: true, alignOverflow: true, ...(liRel ? { relativeOffset: liRel } : {}), children: marker ? [marker] : [] }, { ...body, blockAlign: 'baseline', ...(body.trailingSpaceOut === undefined ? { keepTrailingSpace: true } : {}) }],
      };
    });
    // 本文のセルの最初 (最後) の子からたどる、上 (下) の罫線・padding の無いブロックの、上 (下) の余白の最大 (入れ子の最初 (最後) の子の余白も重なる。
    // CSS 2.1 §8.3.1)。負の余白があれば undefined (重ね方を変えない)
    const edgeMargin = (cell: LTableCell | undefined, side: 'top' | 'bottom'): number | undefined => {
      let m = 0;
      for (let kids = (cell?.children ?? []) as Array<LBlockLevel | LInlineLevel>; ; ) {
        const live = kids.filter((x) => typeof x !== 'string' || x.trim() !== '');
        const kid = side === 'top' ? live[0] : live[live.length - 1];
        if (!kid || typeof kid === 'string' || kid.type !== 'block') break;
        const b = kid as LBlock;
        const v = (b.margin as Record<string, number> | undefined)?.[side] ?? 0;
        if (v < 0) return undefined;
        m = Math.max(m, v);
        if ((b.padding as Record<string, number> | undefined)?.[side] || (b.border as Record<string, { width?: number }> | undefined)?.[side]?.width) break;
        kids = b.children as Array<LBlockLevel | LInlineLevel>;
      }
      return m;
    };
    const noEdge = (li: Element, side: 'top' | 'bottom') => {
      const lc = this.cs(li);
      return !(cssLen(lc(`padding-${side}`)) ?? 0) && !(cssLen(lc(`border-${side}-width`)) ?? 0);
    };
    // 項目の間の余白 (CSS 2.1 §8.3.1): 前の項目の最後の子の下の余白・前の項目の下の余白・項目の上の余白・項目の最初の子の上の余白は、
    // 間に罫線・padding が無ければ重なって、いちばん大きいものになる。前の項目の最後の子の下の余白は、前の項目の本文のセルに残る (keepTrailingSpace) ので、
    // 重なった余白の残りを、前の項目の本文のセルの下の padding にする (区切りがそこに来れば、ページの終わりに残り、次のページの頭には空けない。
    // CSS Fragmentation 3 §5.2)。前は、項目の最初の子の上の余白をセルの先頭で捨て、前の項目の余白と項目の余白を足していた
    for (let k = 1; k < rows.length; k++) {
      const prev = rows[k - 1].cells[1];
      const cur = rows[k].cells[1];
      if (!prev || !cur || !noEdge(lis[k - 1], 'bottom') || !noEdge(lis[k], 'top')) continue;
      const pp = (prev.padding ?? {}) as Record<string, number>;
      const cp = (cur.padding ?? {}) as Record<string, number>;
      const lastMb = edgeMargin(prev, 'bottom');
      const kt = edgeMargin(cur, 'top');
      const liMb = pp.bottom ?? 0;
      const liMt = cp.top ?? 0;
      if (lastMb === undefined || kt === undefined || liMb < 0 || liMt < 0) continue;
      const gap = Math.max(lastMb, liMb, liMt, kt);
      prev.padding = { ...pp, bottom: gap - lastMb };
      cur.padding = { ...cp, top: 0 };
    }
    // 最初の項目の上の余白: 項目に上の罫線・padding が無ければ、項目の余白と、最初の子 (ブロック) の上の余白は重なって (CSS 2.1 §8.3.1)、
    // リストの外へ抜け、リストの上の余白・前のブロックの下の余白とも重なる。セル (本文の列) の先頭の余白は捨てるので、重なった余白を、
    // 表の上の余白にする (前は、最初の子の上の余白をセルの先頭で捨て、ページの頭のリストで空かなかった)
    const firstTop = (() => {
      if (!lis[0] || !noEdge(lis[0], 'top')) return undefined;
      const body = rows[0]?.cells[1];
      if (!body) return undefined;
      const kt = edgeMargin(body, 'top') ?? 0;
      const pad = body.padding as Record<string, number> | undefined;
      const lt = pad?.top ?? 0;
      if (kt <= 0 || lt < 0) return undefined;
      if (pad) body.padding = { ...pad, top: 0 };
      return Math.max(kt, lt);
    })();
    const tableOf = (rs: LTableRow[], first: boolean) =>
      ({
        type: 'table',
        ...(this.struct ? { tag: this.st(container) } : {}),
        listTable: true,
        columns: [
          { type: 'table-column', width: Math.max(indent, 1) },
          { type: 'table-column', width: '1*' },
        ],
        margin: { [startSide]: -indent, ...(first && firstTop ? { top: firstTop } : {}) },
        body: { type: 'table-body', rows: rs },
      }) as LTable;
    // リストの箱の行グリッド (-ah-baseline-grid): 表を、その指定を持つ箱で包む (ページの終わりの判定に使う)
    const bgrid = this.pg(container)['-ah-baseline-grid']?.trim().toLowerCase();
    const wrapGrid = (t: LTable): LBlock | LTable => (bgrid === 'new' || bgrid === 'root' || bgrid === 'none' ? ({ type: 'block', baselineGrid: bgrid, children: [t] } as LBlock) : t);
    let out: LBlock | LTable;
    if (!pageSwitches.size) out = wrapGrid(tableOf(rows, true));
    else {
      // ページの名前の変わる項目の前で表を分け、切り替えを挟む (分けた表を並べる無名の箱。前後の区切りは、この箱の前後と同じ所)
      const parts: Array<LBlockLevel | LInlineLevel> = [];
      let from = 0;
      for (const [k, sw] of pageSwitches) {
        parts.push(wrapGrid(tableOf(rows.slice(from, k), from === 0)), sw as unknown as LBlockLevel);
        from = k;
      }
      parts.push(wrapGrid(tableOf(rows.slice(from), from === 0)));
      out = { type: 'block', children: parts } as LBlock;
    }
    if (listBefore) out.breakBefore = listBefore;
    if (listAfter) out.breakAfter = listAfter;
    // 最初の項目の前・最後の項目の後ろの避ける値は、リストの箱の前後の値と合わせる (block の propagateEdgeAvoids が、リスト自身の値と合わせる)
    if (listAvoidBefore || listAvoidAfter) this.edgeAvoids.set(out, { ...(listAvoidBefore ? { before: listAvoidBefore } : {}), ...(listAvoidAfter ? { after: listAvoidAfter } : {}) });
    if (listAvoidBefore) out.keepWithPrevious = true;
    if (listAvoidAfter) out.keepWithNext = true;
    return out;
  }

  /**
   * 表のセル td に効く行グリッドの指定 (-ah-baseline-grid。継承する): セルから表の要素 table までさかのぼって、最初に見つかった
   * new・root・none の指定 (normal は行グリッドを変えないので、その先を見る)。new・root でなければ undefined
   */
  /**
   * 要素に効いている行グリッド (-ah-baseline-grid。継承する): 自分か祖先の new・root の指定 (近いもの)。none の指定があれば、
   * その先は見ない (undefined)
   */
  private inheritedGrid(el: Element): 'new' | 'root' | undefined {
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) {
      const v = this.pg(e as Element)['-ah-baseline-grid']?.trim().toLowerCase();
      if (v === 'new' || v === 'root') return v;
      if (v === 'none') return undefined;
    }
    return undefined;
  }

  private tableCellGrid(td: Element, table: Element): 'new' | 'root' | undefined {
    for (let e: Node | null = td; e && e.nodeType === 1; e = e.parentNode) {
      const v = this.pg(e as Element)['-ah-baseline-grid']?.trim().toLowerCase();
      if (v === 'new' || v === 'root') return v;
      if (v === 'none') return undefined;
      if (e === table) break;
    }
    return undefined;
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
    /** 列の数の上限 (MAX_TABLE_COLUMNS) に当たったか (診断は表ごとに 1 度) */
    let columnsCapped = false;
    const captions: NonNullable<LTable['captions']> = [];
    const collapse = c('border-collapse') === 'collapse';
    /** empty-cells: hide で、罫線・背景を描かないセル */
    const hiddenCells = new Set<LTableCell>();
    /** そのうち、中身の無いセル (行のセルがすべてこれなら、行の高さは 0) */
    const emptyCells = new Set<LTableCell>();
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
      pushAll(marks, this.stringSet(e));
    };
    const takeMarks = (): LMarker[] => marks.splice(0);
    /** 行 → 行の要素 (名前付きのページの切り替えを見る) */
    const rowEls = new Map<LTableRow, Element>();
    // 行のセルの並びの 1 つ: セルの要素か、無名のセルに包む中身 (表の部分でない節の並び。CSS 2.1 §17.2.1 の「欠けた子を包む」:
    // 表・行グループの直下の、表の子でない節の並びは無名の行に、行の直下の、セルでない節の並びは無名のセルに包む)
    type CellPart = Element | Node[];
    const isCell = (e: Element) => /^table-cell$/.test(this.display(e)) || /^t[dh]$/.test(e.localName);
    /** 行 tr の子を、セルと、無名のセルに包む並びに分ける (セルの間の、空白だけの文字は捨てる。§17.2.1 の「関係の無い箱を除く」) */
    const rowParts = (tr: Element): CellPart[] => {
      const out: CellPart[] = [];
      let loose: Node[] | undefined;
      for (const n of Array.from(tr.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) {
          if (loose) loose.push(n);
          else if ((n.textContent ?? '').trim()) out.push((loose = [n]));
        } else if (n.nodeType === 1) {
          const e = n as Element;
          if (this.display(e) === 'none') continue;
          if (isCell(e)) {
            out.push(e);
            loose = undefined;
          } else if (loose) loose.push(n);
          else out.push((loose = [n]));
        }
      }
      return out;
    };
    const rowOf = (tr: Element, anonCells?: CellPart[], owner: Element = el): LTableRow => {
      if (!anonCells) enter(tr, owner);
      const row = rowOf0(tr, anonCells);
      // 匿名の行 (行の無いセルを包む行) は、書式を持たない
      if (anonCells) return row;
      // 行の中で reset したカウンター (セルの counter-reset) は、行を出るときに外す (Lists 3 §4.4: 有効範囲は親の中)
      this.leaveCounters(tr);
      // 行の id は、リンク・しおりの飛び先 (行の領域に付く)
      const rowId = tr.getAttribute('id');
      if (rowId) row.id = rowId;
      // 行の page (名前付きのページ): 本体の行は、組み終えてから、表を分けてページを切り替える (tablePageParts)。ほかは未対応として知らせる
      rowEls.set(row, tr);
      // 行の改ページの指定 (Fragmentation 3 §3: break-* は表の行にも効く)
      const rc = this.cs(tr);
      const bb = rc('break-before') || rc('page-break-before');
      const ba = rc('break-after') || rc('page-break-after');
      if (/avoid/.test(rc('break-inside') || rc('page-break-inside'))) {
        row.keepTogether = true;
        // 新しいページにも入らない高さの行は、avoid を緩めて行の中で分ける (CSS Fragmentation 3 §4.4: 区切りを避ける指定は、
        // ほかに区切れる所が無ければ守らない)。アンテナハウス互換では、これまでどおりはみ出させる
        if (!this.opts.avoidRowOverflowAh) row.keepTogetherYields = true;
      }
      // 強制の区切りは、種類 (ページ・段・左右のページ) をそのまま渡す (§3.1・§4.3)。
      // セルの中身の最初の子の break-before・最後の子の break-after も、行の前後の区切りと同じ所 (§3.1.1: 区切りは兄弟の間にだけあり、
      // 最初 (最後) の子の値は容器へ伝わる。セルの容器は行で、行は break-* の当たる箱)。リストの項目の行 (rowBreaks) と同じに合わせる。
      // 行をまたぐセル (rowspan) は、行の前後の区切りと同じ所ではないので数えない
      let cellBefore: BreakKind | undefined;
      let cellAfter: BreakKind | undefined;
      // 行へ移した値は、セルの中から外す (残すと、セルの中身の後ろ (前) で区切ろうとして、行を分ける組み方になり、
      // 中身の後ろの空の断片のために、行ごと次のページへ送っていた)
      for (const cell of row.cells) {
        if ((cell.rowSpan ?? 1) > 1) continue;
        cellBefore = mergeBreaks(cellBefore, takeEdgeBreak(cell.children, 'before'));
        cellAfter = mergeBreaks(cellAfter, takeEdgeBreak(cell.children, 'after'));
      }
      const fb = mergeBreaks(this.forcedBreak(bb, tr), cellBefore);
      const fa = mergeBreaks(cellAfter, this.forcedBreak(ba, tr));
      if (fb) row.breakBefore = fb;
      if (/avoid/.test(bb)) row.keepWithPrevious = true;
      if (/avoid/.test(ba)) row.keepWithNext = true;
      if (fa) row.breakAfter = fa;
      // セルの中身の最初の子の break-before・最後の子の break-after の避ける値も、行の前後の区切りの値 (§3.1.1。どれかが避けるなら、
      // そこでは分けない: §4.4 の Rule 1)。強制の区切りがあれば、強制が勝つ (§4.3)
      const spanless = row.cells.filter((cell) => (cell.rowSpan ?? 1) === 1);
      if (!fb && spanless.some((cell) => this.edgeAvoidOf(cell.children, 'before'))) row.keepWithPrevious = true;
      if (!fa && spanless.some((cell) => this.edgeAvoidOf(cell.children, 'after'))) row.keepWithNext = true;
      paintCells(row, bgOf(tr));
      // 行の罫線は、罫線を重ねる表でだけ使う (CSS 2.1 §17.6.1: 罫線を分ける表の行・行グループには罫線が無い)
      const rb = collapse ? this.boxStyle(tr).border : undefined;
      if (rb) row.border = rb;
      return this.tagNode(row, tr);
    };
    const rowOf0 = (tr: Element, anonCells?: CellPart[]): LTableRow => ({
      type: 'table-row',
      // 行の書式 (表との差分)。セルの書式は行との差分なので、行に付けた font-size などをセルへ受け継がせる
      ...(anonCells ? {} : this.textStyle(tr, el)),
      // 描くときだけの効果 (tr の transform・opacity)
      ...(!anonCells && this.paintEffectOf(tr) ? { paintEffect: this.paintEffectOf(tr) } : {}),
      // 行の height は、行の高さの最小値 (CSS 2.1 §17.5.3)
      ...(() => {
        if (anonCells || this.src.isAuto?.(tr, 'height') !== false) return {};
        const h = this.cs(tr)('height');
        const v = /%$/.test(h) ? undefined : cssLen(h);
        return v ? { minHeight: v } : {};
      })(),
      cells: (anonCells ?? rowParts(tr))
        .filter((td) => Array.isArray(td) || (this.display(td) !== 'none' && isCell(td)))
        .map((td): LTableCell => {
          // 無名のセル: 書式を持たず、行から継承する値だけで組む。中身は、包んだ節の並び
          if (Array.isArray(td)) {
            const pre = takeMarks();
            return { type: 'table-cell', keepEdgeSpace: true, children: [...pre, ...this.flowChildren(tr, false, td)] };
          }
          const tc = this.cs(td);
          enter(td, tr);
          const pre = takeMarks();
          // セルの中の最初・最後のブロックの margin は捨てない (CSS 2.1 §17.5: セルは新しい整形文脈で、中の margin はセルの外と重ならない。<td><p> の上下の margin)
          // タグ付き PDF: セルの構造の節 (TH・TD) を、中身より先に決める (中身の構造の節は、その子)
          const cell: LTableCell = this.tagNode({ type: 'table-cell', keepEdgeSpace: true, ...this.textStyle(td, tr), ...this.paragraphStyle(td, tr), ...this.boxStyle(td), children: [] } as LTableCell, td);
          cell.children = this.flowChildren(td);
          if (pre.length) cell.children.unshift(...pre);
          // アンテナハウスの行グリッド (-ah-baseline-grid。継承する): セル・行・行グループ・表に new・root の指定があれば、セルの中身も
          // 行グリッドの領域にする (中身を、その指定のブロックで包む)。行グリッドの領域では、最初の行の前と最後の行の後ろに半行間を
          // 付けない (AH Formatter の「XSL/CSS 拡張仕様」の axf:baseline-grid。見本の PDF: CSS-Print 第 4 版の表は
          // table { -ah-baseline-grid: new } で、行の高さが字の大きさ + padding + 罫線 = line-height 1 つ分)
          const cellGrid = this.tableCellGrid(td, el);
          // new の格子では、セルの中の行を格子に載せず、em の箱を積む (LBlock.baselineGridStack。
          // 見本の PDF: CSS-Print 第 4 版の「PDF/A の大きな特徴」の表の、折り返したセルの行の送りは字の大きさ (8.5pt) で、21q の格子に載せない)
          if (cellGrid) cell.children = [{ type: 'block', baselineGrid: cellGrid, ...(cellGrid === 'new' ? { baselineGridStack: true } : {}), children: cell.children } as LBlock];
          // position が static でないセル・変換の付いたセルは、中の絶対配置の箱の基準 (CSS 2.1 §10.1)
          if (this.makesCb(td)) cell.containingBlock = true;
          // position: relative のセルのずらし (CSS 2.1 §9.4.3): 表を組んだ後のセルの箱を動かす (行の高さ・ほかのセルは変えない)
          const tdRel = this.relativeOffsetOf(td);
          if (tdRel) cell.relativeOffset = tdRel;
          const cs = capSpan(parseInt(td.getAttribute('colspan') ?? '1', 10));
          let rs = Math.min(MAX_ROW_SPAN, parseInt(td.getAttribute('rowspan') ?? '1', 10));
          // rowspan="0" は、行のまとまり (thead・tbody・tfoot。表の直下の tr の並びは、その並び) の残りの行すべて
          // (HTML §4.9.11 の rowspan・§4.9.12.1 の「cell grows downward」。前は 1 行として扱っていた)
          if (rs === 0) rs = Math.min(MAX_ROW_SPAN, this.rowsFrom(tr));
          if (cs > 1) cell.colSpan = cs;
          if (rs > 1) cell.rowSpan = rs;
          const va = tc('vertical-align');
          if (va === 'middle') cell.blockAlign = 'center';
          else if (va === 'bottom') cell.blockAlign = 'end';
          else if (va === 'baseline') cell.blockAlign = 'baseline';
          delete (cell as { margin?: unknown }).margin;
          // empty-cells: hide (CSS 2.1 §17.6.1.1): 罫線を分ける表の、見える中身の無いセルは、罫線も背景も描かない。中身が無いのは、
          // 回り込みも流れの中の内容 (空の要素も内容に数える) も無く、あるのは white-space の処理で消える空白だけのセル。
          // 罫線は、太さを残して透明にする (表の組み方は変えない)。背景は、行・行グループの背景を塗った後で消す (下)
          // visibility: hidden のセルも、見える中身の無いセル (行の背景も、その後ろには描かない)
          if (!collapse && tc('empty-cells') === 'hide') {
            const empty = cell.children.every((k) => typeof k === 'string' && /^(normal|nowrap|pre-line)$/.test(tc('white-space') || 'normal') && /^[ \t\n\r\f]*$/.test(k));
            if (empty || /^(hidden|collapse)$/.test(tc('visibility'))) {
              hiddenCells.add(cell);
              if (empty) emptyCells.add(cell);
              delete cell.boxShadow;
              if (cell.border) for (const sd of Object.values(cell.border as Record<string, BorderSide | undefined>)) if (sd) sd.color = 'transparent';
            }
          }
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
      // 行グループ (thead・tbody・tfoot) の箱は作らないので、その transform・opacity は掛けられない (未対応として知らせる)
      {
        const gfx = this.paintEffectOf(g);
        if (gfx?.transform || gfx?.opacity !== undefined) this.miss(msg('transform・opacity (thead・tbody・tfoot)', 'transform, opacity (thead, tbody, tfoot)'));
        if (gfx?.outline) this.miss(msg('outline (thead・tbody・tfoot)', 'outline (thead, tbody, tfoot)'));
      }
      const gb = collapse && rows.length ? this.boxStyle(g).border : undefined;
      if (gb) rows.forEach((r, k) => (r.group = { border: gb, first: k === 0, last: k === rows.length - 1 }));
      // 行のまとまりの区切りの指定 (CSS Fragmentation 3 §3.1: break-* は表の行のまとまりにも当たる)。まとまりの箱は作らないので、
      // break-before はまとまりの最初の行の前、break-after は最後の行の後ろの区切りにする (§3.1.1: 同じ所の値。行の値と合わせる。
      // 左右のページの指定は、流れの中で後ろの要素の値が勝つ: 前ではまとまり、後ろでは行が先 = §4.3)。
      // break-inside の避ける値は、まとまりの行を分けない (行の中も、行の間も)
      if (rows.length) {
        const gc = this.cs(g);
        const gbb = gc('break-before') || gc('page-break-before');
        const gba = gc('break-after') || gc('page-break-after');
        const first = rows[0];
        const last = rows[rows.length - 1];
        const fb = mergeBreaks(this.forcedBreak(gbb, g), first.breakBefore as BreakKind | undefined);
        const fa = mergeBreaks(last.breakAfter as BreakKind | undefined, this.forcedBreak(gba, g));
        if (fb) first.breakBefore = fb;
        if (fa) last.breakAfter = fa;
        if (!fb && this.avoidKind(gbb, g)) first.keepWithPrevious = true;
        if (!fa && this.avoidKind(gba, g)) last.keepWithNext = true;
        if (this.avoidKind(gc('break-inside') || gc('page-break-inside'), g)) {
          rows.forEach((r, k) => {
            r.keepTogether = true;
            // 新しいページにも入らなければ、avoid を緩めて分ける (§4.4。行の break-inside と同じ)
            if (!this.opts.avoidRowOverflowAh) r.keepTogetherYields = true;
            if (k < rows.length - 1 && !r.breakAfter && !rows[k + 1].breakBefore) r.keepWithNext = true;
          });
        }
      }
    };
    const walk = (n: Element, into: LTableRow[], list?: Element[]) => {
      // 表・行グループの直下の、表の子でないもの (セル・文字・ほかの要素) は、続くものをまとめて匿名の行で包む (CSS 2.1 §17.2.1)。
      // その中の、セルでない節の並び (文字・ほかの要素) は、無名のセルに包む
      let pend: CellPart[] = [];
      let loose: Node[] | undefined;
      const flushCells = () => {
        if (pend.length) into.push(rowOf(n, pend));
        pend = [];
        loose = undefined;
      };
      for (const node of list ?? Array.from(n.childNodes)) {
        if (node.nodeType === 3 || node.nodeType === 4) {
          // 表の部分の間の、空白だけの文字は捨てる (§17.2.1)
          if (loose) loose.push(node);
          else if ((node.textContent ?? '').trim()) pend.push((loose = [node]));
          continue;
        }
        if (node.nodeType !== 1) continue;
        const ch = node as Element;
        const d = this.display(ch);
        if (d === 'none') continue;
        // visibility: collapse の行・行グループは、表から除く (CSS 2.1 §17.5.5)
        if (/^table-(row|row-group|header-group|footer-group)$/.test(d) && this.cs(ch)('visibility') === 'collapse') continue;
        if (isCell(ch)) {
          pend.push(ch);
          loose = undefined;
          continue;
        }
        // 表の子 (行・行グループ・列・列グループ・caption) でない要素は、無名のセルの中身
        if (!/^table-(row|row-group|header-group|footer-group|column|column-group|caption)$/.test(d) && !/^(tr|thead|tbody|tfoot|col|colgroup|caption)$/.test(ch.localName)) {
          if (loose) loose.push(ch);
          else pend.push((loose = [ch]));
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
        // 列グループの子は、列だけ (ほかの子は display: none と同じ。§17.2.1)
        else if (d === 'table-column-group' || ch.localName === 'colgroup') walk(ch, body, Array.from(ch.children).filter((k) => this.display(k) === 'table-column' || k.localName === 'col'));
        else if (d === 'table-column' || ch.localName === 'col') {
          const span = capSpan(parseInt(ch.getAttribute('span') ?? '1', 10) || 1);
          // 幅の % (自前のカスケードは % のまま返す) は、比例の列幅にする (表の幅を % の比で分ける)
          const cw = this.cs(ch)('width');
          const w: LTableColumn['width'] | undefined =
            this.src.isAuto?.(ch, 'width') !== false ? undefined : /%$/.test(cw.trim()) ? (`${parseFloat(cw)}*` as const) : cssLen(cw);
          const room = limits().tableColumns - columns.length;
          if (span > room && !columnsCapped) {
            columnsCapped = true;
            this.report.diagnostics = [
              ...(this.report.diagnostics ?? []),
              diag('limit/table-columns', msg(`表の列 (col・colgroup の span の合計) が多すぎるので、${limits().tableColumns} 列までにします`, `the table has too many columns (the sum of col and colgroup spans); using the first ${limits().tableColumns}`), { limit: limits().tableColumns }, elementSource(ch, this.opts.sourceName)),
            ];
          }
          for (let k = 0; k < Math.min(span, room); k++) columns.push({ type: 'table-column', ...(w ? { width: w } : {}) });
        } else if (d === 'table-caption' || ch.localName === 'caption') {
          // 見出し: 表の子 (表の部分の中ではない) のときだけ。caption-side は top・bottom (CSS Tables 3 §3.5.3)
          if (n !== el || anon) continue;
          // caption のマーカーは caption の中身の先頭に置く (前の行・セルのマーカーの残りは、次のセルへ送る)
          const held = takeMarks();
          enter(ch, el);
          const pre = takeMarks();
          marks = held;
          const block: LBlock = this.tagNode({ type: 'block', ...this.textStyle(ch, el), ...this.paragraphStyle(ch, el), ...this.boxStyle(ch), children: [] } as LBlock, ch);
          this.blockStack.push(block);
          block.children = [...pre, ...this.flowChildren(ch)];
          this.blockStack.pop();
          // アンテナハウスの行グリッド (-ah-baseline-grid): 表・見出しに new・root の指定があれば、見出しの中身も、セルと同じに
          // 行グリッドの領域にする (最初の行の前と最後の行の後ろに半行間を付けず、new なら em の箱を積む)。見本の PDF: CSS-Print 第 4 版の
          // table { line-height: 21q; -ah-baseline-grid: new } の表の見出し (10.2・20.3 など) は、上下に半行間を空けない
          const capGrid = this.tableCellGrid(ch, el);
          if (capGrid) block.children = [{ type: 'block', baselineGrid: capGrid, ...(capGrid === 'new' ? { baselineGridStack: true } : {}), children: block.children } as LBlock];
          captions.push({ side: this.cs(ch)('caption-side') === 'bottom' ? 'bottom' : 'top', block });
        }
      }
      flushCells();
    };
    walk(el, body, anon);
    this.tableRowPages(el, header, body, footer, rowEls);
    // empty-cells: hide のセル: セル・行・行グループの背景を通して、表の背景が見える (CSS 2.1 §17.5.1 の 6)。行のセルがすべて
    // そうなら、行の高さは 0 (§17.6.1.1。セルの内側の余白・高さの指定も取らない)
    if (hiddenCells.size) {
      for (const row of [...header, ...body, ...footer]) {
        for (const cell of row.cells) {
          if (!hiddenCells.has(cell)) continue;
          delete cell.backgroundColor;
          delete cell.backgroundImage;
          delete cell.backgroundClip;
        }
        if (row.cells.length && row.cells.every((cell) => emptyCells.has(cell) && (cell.rowSpan ?? 1) === 1)) {
          delete row.minHeight;
          for (const cell of row.cells) {
            cell.children = [];
            delete cell.height;
            delete cell.minBlockSize;
            if (cell.padding) cell.padding = { ...(cell.padding as Record<string, number>), top: 0, bottom: 0 };
            if (cell.border) for (const k of ['top', 'bottom'] as const) delete (cell.border as Record<string, unknown>)[k];
          }
        }
      }
    }
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
    // 字下げ (text-indent) は継承する値 (CSS Text 3 §8.1): 表の値が親と違えば、表に付けてセルへ受け継がせる。表に指定した字下げがセルの
    // 行に効き、HTML の既定のスタイル (table { text-indent: initial }。HTML Standard §15.3.10 Tables) で、表の外の字下げは表の中へ入らない
    if (!anon && c('text-indent') !== this.cs(parent)('text-indent')) Object.assign(t, textIndentOf(c('text-indent')));
    // position が static でない表・変換の付いた表は、中 (セルの中) の絶対配置の箱の基準 (CSS 2.1 §10.1)
    if (!anon && this.makesCb(el)) t.containingBlock = true;
    // 表の書字方向が親と違う (横書きの文書の中の、writing-mode を指定した表など): 表をその書字方向で組む (CSS Writing Modes 3 §2.1:
    // writing-mode は表にも当たる。CSS 2.1 §17 の行・列は、表の書字方向の block・inline の向きに並ぶ = 縦書きの表では、行が右から左へ、
    // セルが上から下へ並ぶ)。組版は、親と直交する表を、直交する箱 (§7.3) として置く
    if (!anon) {
      const twm = this.wm(c('writing-mode'));
      if (twm && twm !== (this.wm(this.cs(parent)('writing-mode')) ?? 'horizontal-tb')) t.writingMode = twm;
    }
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
    // 大きい方 (§17.5.2.2。組むときに決める)。左右の余白が auto なら、組むときに表の幅が決まってから、置く場所の残りを配る
    // (§10.3.3。下の fitContent の autoMargins)。読み込みのときの包含ブロックの幅の見積もりから余白を長さにすると、表のセルの中
    // (見積もりは外の表の全体の幅に近い) で、その余白が列の幅を決める中身の幅に入り、置く場所が見積もりより狭いと表がはみ出した
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
    this.tableEdgeBreaks(t, header, body, footer, captions);
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
    // アンテナハウス互換: 入りきらない列の幅の配り方は、XSL-FO の表と同じ 'max-ratio' (最大の長さが均等割りの半分以下の列は
    // 最大の長さのまま、残りの列は最大の長さの比で)。CSS-Print の「PDF/A の大きな特徴」の表 (9 列) などの見本の列の幅に合う
    if (t.fitContent && this.opts.tableAutoWidthAh) t.fitContentRule = 'max-ratio';
    return t;
  }

  /**
   * 表の最初の行の前・最後の行の後ろの区切りを、表の前後の区切りにする (CSS Fragmentation 3 §3.1.1: 区切りは兄弟の間にだけあり、
   * 最初の子の break-before・最後の子の break-after は容器へ伝わる。行・行のまとまりの容器は表の箱。リストの表の listBefore・listAfter と同じ)。
   * 組版は行の前の区切りを 2 行目から見るので、移さないと最初の行の前の区切りが消える。行からは外す (表と行で 2 度区切らない)。
   * 表の最初の行は、thead があればその最初の行 (見出しの行の組は、表の最初に置く。CSS 2.1 §17.2)、無ければ本体の最初の行。最後の行は、
   * tfoot があればその最後の行、無ければ本体の最後の行。表の上 (下) に caption があれば、表の箱の前 (後ろ) は caption との間なので
   * (CSS 2.1 §17.4: caption と表の箱は、表を包む箱の中の兄弟)、移さない (組版が、caption と行の間で区切る)。
   * thead のある表の本体の最初の行の前の強制の区切り (tr・tbody・セルの中身の最初の子の値) も、表の前の区切りにする: 見出しと本体の間で
   * 区切ると、繰り返す見出しだけのページができる (表がページの先頭にあれば、最初のページが見出しだけ)。見出しは本体の行の前に置く塊なので、
   * 本体の最初の行を新しいページから始める指定は、見出しごと表を新しいページから始める指定と読む (§3.1.1 の伝え方を、見出しを飛ばして読む)。
   * 上に caption があれば、caption と表の箱の間 (組版が区切る)。tfoot のある表の本体の最後の行の後ろの区切りは、フッターと本体の間なので、
   * 行に残す (組版が区切る)。避ける値 (行の keepWithPrevious・keepWithNext) も同じに、表の前後の値にする (propagateEdgeAvoids が、表自身の値と合わせる)
   */
  private tableEdgeBreaks(t: LTable, header: LTableRow[], body: LTableRow[], footer: LTableRow[], captions: NonNullable<LTable['captions']>) {
    const first = captions.some((c) => c.side === 'top') ? undefined : (header[0] ?? body[0]);
    const last = captions.some((c) => c.side === 'bottom') ? undefined : (footer.length ? footer[footer.length - 1] : body[body.length - 1]);
    const avoid: { before?: AvoidKind; after?: AvoidKind } = {};
    // 見出しのある表の本体の最初の行の前の強制の区切り (上の見出しの後ろ)。左右のページの指定は、流れの中で後ろの本体の値が勝つ (§4.3)
    const bodyLead = header.length && body[0]?.breakBefore ? (body[0].breakBefore as BreakKind) : undefined;
    if (bodyLead) {
      delete body[0].breakBefore;
      if (first) first.breakBefore = mergeBreaks(first.breakBefore as BreakKind | undefined, bodyLead);
      else header[0].breakBefore = mergeBreaks(header[0].breakBefore as BreakKind | undefined, bodyLead);
    }
    if (first) {
      const bb = mergeBreaks(t.breakBefore, first.breakBefore as BreakKind | undefined);
      delete first.breakBefore;
      if (bb) t.breakBefore = bb;
      else if (first.keepWithPrevious) avoid.before = 'all';
    }
    if (last) {
      const ba = mergeBreaks(last.breakAfter as BreakKind | undefined, t.breakAfter);
      delete last.breakAfter;
      if (ba) t.breakAfter = ba;
      else if (last.keepWithNext) avoid.after = 'all';
    }
    if (avoid.before || avoid.after) {
      this.edgeAvoids.set(t, { ...(this.edgeAvoids.get(t) ?? {}), ...avoid });
      if (avoid.before) t.keepWithPrevious = true;
      if (avoid.after) t.keepWithNext = true;
    }
  }

  /** 表の本体の行 → その行の前に置く、ページシーケンスの切り替え (tableRowPages が決め、blockBox が表を分ける) */
  private tableRowSwitches = new WeakMap<LTableRow[], Map<number, PageSwitch>>();

  /**
   * 表の行の page (名前付きのページ。CSS Page 3 §8.1: page は class A の区切りを作る箱に当たり、表の行・行グループの間も class A の区切り
   * (CSS Fragmentation 3 §4.1))。流れの中の表 (body から流れの中のふつうのブロックをたどった表) の本体の行で、ページの名前が変わる所を覚える。
   * auto の行は行グループ (tbody) の値、行グループが auto なら表の値を使う。見出し・フッターの行 (各ページで繰り返す) と、流れの中にない表の行は、
   * 前のとおり未対応として知らせる
   */
  private tableRowPages(el: Element, header: LTableRow[], body: LTableRow[], footer: LTableRow[], rowEls: Map<LTableRow, Element>) {
    const tableUsed = this.pageUsed.get(el);
    const inFlow = tableUsed !== undefined && !this.inRunning && el.parentElement !== null && this.pageFlowEls.has(el.parentElement);
    for (const row of [...header, ...footer]) {
      const tr = rowEls.get(row);
      if (tr) this.pageIgnored(tr, ['表の見出し・フッターの行', 'table header and footer rows']);
    }
    const sws = new Map<number, PageSwitch>();
    body.forEach((row, k) => {
      const tr = rowEls.get(row);
      if (!tr) return;
      if (!inFlow) return this.pageIgnored(tr, ['表の行', 'table rows']);
      const g = tr.parentElement && tr.parentElement !== el && /^table-row-group$/.test(this.display(tr.parentElement)) ? tr.parentElement : undefined;
      const own = !this.atDepthLimit(tr) ? ownPageName(this.pg(tr).page) : undefined;
      const gOwn = g && !this.atDepthLimit(g) ? ownPageName(this.pg(g).page) : undefined;
      const used = own ?? gOwn ?? tableUsed;
      this.pageUsed.set(tr, used);
      if (g) this.pageUsed.set(g, gOwn ?? tableUsed);
      // 最初の行の切り替えは、表の前に置く (表ごと次のページの組へ)
      const sw = this.pageSwitchAt(tr, used, own !== undefined || gOwn !== undefined);
      if (sw) sws.set(k, sw);
    });
    if (sws.size) this.tableRowSwitches.set(body, sws);
  }

  /**
   * 本体の行でページの名前が変わる表 (tableRowPages) を、その行の前で分け、間にページシーケンスの切り替えを置く (リストの表と同じ形。
   * body の直下へは hoistPageSwitches が引き上げる)。分けた表は、どれも見出し・フッターの行を持つ (各ページで繰り返す。CSS 2.1 §17.2)。
   * 上の余白・前の区切り・上の caption・id は最初の表に、下の余白・後ろの区切り・下の caption は最後の表にだけ付ける
   */
  private splitTableByPage(t: LTable): LBlockLevel {
    const sws = this.tableRowSwitches.get(t.body.rows);
    if (!sws) return t;
    const rows = t.body.rows;
    const parts: Array<LBlockLevel | LInlineLevel> = [];
    const cuts = [...sws.keys()].sort((a, b) => a - b);
    const bounds = [0, ...cuts.filter((k) => k > 0), rows.length];
    if (sws.has(0)) parts.push(sws.get(0) as unknown as LBlockLevel);
    for (let i = 0; i + 1 < bounds.length; i++) {
      const first = i === 0, last = i + 2 === bounds.length;
      const part: LTable = { ...t, body: { ...t.body, rows: rows.slice(bounds[i], bounds[i + 1]) } };
      const m = { ...((t.margin ?? {}) as Record<string, unknown>) };
      if (!first) {
        delete part.breakBefore;
        delete part.keepWithPrevious;
        delete part.id;
        m.top = 0;
      }
      if (!last) {
        delete part.breakAfter;
        delete part.keepWithNext;
        m.bottom = 0;
      }
      if (t.margin) part.margin = m as LTable['margin'];
      const caps = (t.captions ?? []).filter((c) => (c.side === 'top' ? first : last));
      if (caps.length) part.captions = caps;
      else delete part.captions;
      if (i > 0) parts.push(sws.get(bounds[i]) as unknown as LBlockLevel);
      parts.push(part);
    }
    return { type: 'block', children: parts } as LBlock;
  }

  /** ページマスター (@page の宣言から) */
  private masterOf(decls: Record<string, string>): PageMaster {
    const def = this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 };
    const pb = pageBox(decls, def, this.rootFsPx, this.opts.spotColors, !!this.opts.ahCssExtensions, this.opts.pageBorderKeywords);
    const trimMarks = pb.marks ?? this.opts.trimMarks ?? false;
    // 塗り足しの幅。bleed の初期値は auto で、auto は marks に crop があれば 6pt、無ければ 0 (CSS Paged Media 3 §7.3)。
    // @page に bleed も marks も無いときは、呼び出しの設定 (コマンドの --print の 3mm など) に従う。
    // marks を書いたときは、crop は角のトンボ、cross は十字のトンボだけを描く (§7.2)。書かないときは、設定のトンボ (両方)
    const crop = pb.marks !== undefined ? !!pb.marksCrop : trimMarks;
    const bleed = typeof pb.bleed === 'number' ? pb.bleed : pb.bleed === 'auto' || pb.marks !== undefined ? (crop ? 6 * MM_PER_PT : 0) : (this.opts.bleedMm ?? 0);
    return {
      width: pb.width,
      height: pb.height,
      bleed,
      trimMarks,
      ...(pb.marks && !pb.marksCrop ? { cornerMarks: false } : {}),
      ...(pb.marks && !pb.marksCross ? { centerMarks: false } : {}),
      ...(pb.orientation === 'rotate-left' ? { rotation: 270 as const } : pb.orientation === 'rotate-right' ? { rotation: 90 as const } : {}),
      // トンボの領域の幅は、塗り足しの外側から数える
      ...(pb.background ? { backgroundColor: pb.background } : {}),
      ...(pb.cropOffset !== undefined ? { trimMarkMargin: Math.max(pb.cropOffset - bleed, 0) } : {}),
      margins: pb.margins,
      ...(pb.marginBoxMargins ? { marginBoxMargins: pb.marginBoxMargins } : {}),
      // 背景画像 (url()) の位置の基準の領域 (ページの箱の padding の領域。pageBox)。background-attachment: fixed なら、余白を含むページの箱
      // (仕上がりの用紙の全体。塗り足しがあっても、仕上がりの角が基準。CSS Paged Media 3 §3.1: background-attachment が fixed なら、
      // 画像の位置の基準は、余白を含むページの箱)。百分率・cover・contain の大きさの基準も同じ箱
      ...(pb.backgroundOrigin && firstCssUrl(decls['background-image'] ?? decls.background ?? '')
        ? { backgroundOrigin: pageBackgroundFixed(decls) ? { top: 0, right: 0, bottom: 0, left: 0 } : pb.backgroundOrigin }
        : {}),
      ...(this.pageColumns ? { columns: this.pageColumns } : {}),
    };
  }

  /** 余白の箱の content → 行内の要素 (ページ番号・総ページ数・string()・element()) */
  private boxContent(v: string, tt = 'none', sc: '' | 'small' | 'all' = '', ws = 'normal'): Array<LInlineLevel | LRetrieveMarker> {
    const out: Array<LInlineLevel | LRetrieveMarker> = [];
    const plain = tt === 'none' && !sc;
    // 文字列は、本文の生成した内容と同じに、箱の white-space で空白と改行 (\A) を扱う (CSS 2.1 §12.2・CSS Text 3 §4.1)。
    // 続いた文字列 ("あ" "\A" "い") は 1 つにつないでから扱う (改行の前後の字を見て、空白にするか消すかを決めるため)
    const toks: ContentToken[] = [];
    for (const t of parseContent(v)) {
      const last = toks[toks.length - 1];
      if (t.kind === 'str' && last?.kind === 'str') toks[toks.length - 1] = { kind: 'str', v: last.v + t.v };
      else toks.push(t);
    }
    for (const t0 of toks) {
      const t = t0.kind === 'str' ? { ...t0, v: whiteSpaceText(t0.v.replace(/[\u2000\r]/g, ' '), ws, false) } : t0;
      if (t.kind === 'str') out.push(...(plain ? [t.v] : this.marginText(t.v, tt, sc)));
      else if (t.kind !== 'fn') continue;
      else if (t.name === 'counter' && t.args[0] === 'page') {
        const fmt = pageNumberFormatOf(t.args[1]) ?? '1';
        if (this.pageFormat === null) this.pageFormat = fmt;
        if (this.masterPageFormat === null) this.masterPageFormat = fmt;
        // 箱ごとの数の書式 (counter(page, lower-roman) など) と text-transform は、印に持たせて、組むときに当てる
        // (文書の最初の counter(page) の書式だけを全部の箱に使わない。数を字にした後に text-transform を当てる: CSS Text 3 §2.1)
        const ttx = tt && tt !== 'none' ? tt : '';
        const mark = fmt === this.pageFormat && !ttx ? '{pageNumber}' : `{pageNumber|${fmt}|${ttx}}`;
        out.push(sc ? ({ type: 'inline', smallCaps: sc, children: [mark] } as LInline) : mark);
      } else if (t.name === 'counter' && t.args[0] === 'pages') out.push('{totalPages}');
      else if (t.name === 'env') {
        // env(doc-title): 文書の題 (<title>)。env(url) などは空
        if (t.args[0] === 'doc-title') out.push(...(plain ? [this.docTitle] : this.marginText(this.docTitle, tt, sc)));
      } else if (t.name === 'string' || t.name === 'element') {
        const pos = t.args[1] ?? 'first';
        // string() の値には、この箱の text-transform・small caps を当てた変種を取り出す (stringSet が作る)。
        // element() の中身は、元の要素の書式のまま
        const variant = t.name === 'string' && !plain ? `|${tt}|${sc}` : '';
        out.push({ type: 'retrieve-marker', className: `${t.name === 'string' ? 'string' : 'running'}:${t.args[0]}${variant}`, position: MARKER_POS[pos] ?? 'first-including-carryover', boundary: 'document' });
      } else this.miss(`@page content:${t.name}()`);
    }
    return out;
  }

  /** 余白の箱の white-space (箱の宣言、ページ文脈から受け継いだ宣言、根の要素の値の順。Page 3 §6: ページ文脈は根の要素から受け継ぐ) */
  private marginWhiteSpace(decls: Record<string, string>): string {
    const rootEl = (this.bodyEl?.ownerDocument as Document | undefined)?.documentElement ?? this.bodyEl;
    return (decls['white-space'] ?? (rootEl ? this.cs(rootEl)('white-space') : '') ?? '').trim().toLowerCase() || 'normal';
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
  /**
   * 余白の箱の字の大きさ (pt)。箱の font-size は、ページの文脈 (@page) の字の大きさを基準に、ページの文脈の font-size は根元の要素の字の大きさを
   * 基準に読む (CSS Paged Media 3 §6: 余白の箱はページの文脈から、ページの文脈は根元の要素から受け継ぐ。CSS Fonts 4 §2.4)
   */
  private marginBoxFs(inherited: Record<string, string>, own: Record<string, string> | undefined, rootFs: number): number {
    const pageFs = fontSizePt(inherited['font-size'], rootFs, rootFs) ?? rootFs;
    return own?.['font-size'] !== undefined ? (fontSizePt(own['font-size'], pageFs, rootFs) ?? pageFs) : pageFs;
  }

  private marginBoxWidths(boxes: Record<string, Record<string, string>>, inherited: Record<string, string>, rootFs: number, x0: number, avail: number): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const edge of ['top', 'bottom'] as const) {
      const names = [`${edge}-left`, `${edge}-center`, `${edge}-right`];
      interface Info { name: string; extra: number; width?: number; max: number; min: number; maxW?: number; minW?: number }
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
        const fs = this.marginBoxFs(inherited, own, rootFs);
        // 幅は、text-transform を当てた字で見積もる (small caps の字の幅は、元の字で見積もる)
        const items = this.boxContent(content, (decls['text-transform'] ?? 'none').trim().toLowerCase() || 'none', '', this.marginWhiteSpace(decls));
        if (items.some((x) => typeof x !== 'string')) unknown = true;
        // ページ番号の印は、3 桁の数の幅とみなす
        const text = items.map((x) => (typeof x === 'string' ? x.replace(/\{(pageNumber|totalPages)(\|[^}]*)?\}/g, '000') : '')).join('');
        const weight = /bold/.test(decls['font-weight'] ?? '') ? 700 : parseInt(decls['font-weight'] ?? '', 10) || 400;
        const names2 = (decls['font-family'] ?? '').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        const family = names2.length ? this.opts.mapFont?.(names2, weight >= 600) : undefined;
        const measure = (s: string) =>
          this.opts.measureText ? this.opts.measureText(s, { fontFamily: family, fontWeight: weight, fontSize: fs, kerning: (decls['font-kerning'] ?? '').trim() !== 'none' }) : [...s].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0) * fs;
        const max = measure(text);
        const min = maxOf(text.split(/\s+/).map(measure), 0);
        const len = (k: string) => (decls[k] === undefined || decls[k] === 'auto' ? 0 : (lenEm(decls[k], fs, { rootFs }) ?? 0));
        const sideLen = (k: 'margin' | 'padding') => {
          const all = decls[k] ? edges4(decls[k], fs, rootFs) : { left: 0, right: 0, top: 0, bottom: 0 };
          return (decls[`${k}-left`] !== undefined ? len(`${k}-left`) : all.left) + (decls[`${k}-right`] !== undefined ? len(`${k}-right`) : all.right);
        };
        const bw = (side: string) => {
          const v = decls[`border-${side}`] ?? decls.border;
          return v ? (parseBorder(v, fs, this.opts.pageBorderKeywords)?.width ?? 0) : 0;
        };
        const extra = sideLen('margin') + sideLen('padding') + bw('left') + bw('right');
        const wv = decls.width;
        // 百分率 (calc() の中の百分率も) は、辺の余白の領域の幅に対して
        const lenOf = (v: string | undefined) => (v === undefined || /^(auto|none)$/i.test(v.trim()) ? undefined : /%$/.test(v) ? (avail * parseFloat(v)) / 100 : lenEm(v, fs, { rootFs, pct: avail }));
        const width = lenOf(wv);
        const maxW = lenOf(decls['max-width']);
        const minW = lenOf(decls['min-width']);
        infos.push({
          name,
          extra,
          ...(width !== undefined ? { width: width + extra } : {}),
          max: max + extra,
          min: min + extra,
          ...(maxW !== undefined ? { maxW: maxW + extra } : {}),
          ...(minW !== undefined ? { minW: minW + extra } : {}),
        });
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
      const layout = () => {
        const res = new Map<string, [number, number]>();
        if (!B) {
          const [wa, wc] = share(A ?? none, C ?? none);
          if (A) res.set(A.name, [x0, wa]);
          if (C) res.set(C.name, [x0 + avail - wc, wc]);
        } else {
          // A・C に決まった幅があれば、その大きい方の 2 倍を AC の幅にする (A・C の幅は、B を中央に置いた残り)
          const fixedAC = [A?.width, C?.width].filter((x): x is number => x !== undefined);
          const ac = { max: 2 * Math.max(A?.max ?? 0, C?.max ?? 0), min: 2 * Math.max(A?.min ?? 0, C?.min ?? 0), ...(fixedAC.length === [A, C].filter(Boolean).length && fixedAC.length ? { width: 2 * Math.max(...fixedAC) } : {}) };
          const [wb] = share(B, ac);
          const side = (avail - wb) / 2;
          res.set(B.name, [x0 + (avail - wb) / 2, wb]);
          if (A) res.set(A.name, [x0, A.width ?? side]);
          if (C) res.set(C.name, [x0 + avail - (C.width ?? side), C.width ?? side]);
        }
        return res;
      };
      // 最小・最大の幅 (§5.3.2.3): 3 つの箱をまとめて扱う。分けた幅が max-width を超えた箱は、max-width を幅の指定として分け直し、
      // 次に min-width を下回った箱を、min-width を幅の指定として分け直す
      let res = layout();
      for (const pass of ['max', 'min'] as const) {
        let changed = false;
        for (const it of infos) {
          const used = it && res.get(it.name)?.[1];
          if (!it || used === undefined) continue;
          if (pass === 'max' && it.maxW !== undefined && used > it.maxW + 0.01) (it.width = it.maxW), (changed = true);
          if (pass === 'min' && it.minW !== undefined && used < it.minW - 0.01) (it.width = it.minW), (changed = true);
        }
        if (changed) res = layout();
      }
      for (const [k, v] of res) out.set(k, v);
    }
    return out;
  }

  /** 根元の要素 (html・body) の背景 (@page の宣言の形)。ページの背景にする */
  private rootBackground?: Record<string, string>;

  /** 脚注の疑似要素の規則の、読んだ選択子 (規則ごとに 1 度だけ読む) */
  private footnoteSelectors = new WeakMap<StyleRule, Selector[]>();

  /**
   * 脚注の要素 e の ::footnote-call・::footnote-marker (which) に当たる規則の宣言を、詳細度と書いた順で重ねたもの (CSS Cascade 4 §6.4)。
   * 疑似要素の前の選択子が e に当たる規則だけ (GCPM 3 §2.5・§2.6: 疑似要素は、その脚注の要素のもの)
   */
  private footnotePseudo(e: Element, which: 'call' | 'marker'): Record<string, string> {
    const hits: Array<{ spec: number; k: number; decls: Record<string, string> }> = [];
    this.footnoteRules.forEach((r, k) => {
      let sels = this.footnoteSelectors.get(r);
      if (!sels) this.footnoteSelectors.set(r, (sels = parseSelectorList(r.selector, true)));
      const hit = sels.filter((s) => s.pseudoElement === `footnote-${which}` && matches(e, s));
      if (hit.length) hits.push({ spec: Math.max(...hit.map((s) => s.specificity)), k, decls: r.decls });
    });
    hits.sort((a, b) => a.spec - b.spec || a.k - b.k);
    return hits.reduce<Record<string, string>>((a, h) => ({ ...a, ...h.decls }), {});
  }

  /** content の counter(footnote) の前後の文字と書式 (無ければ undefined) */
  private footnoteContentParts(v: string): { pre: string; post: string; format?: string } | undefined {
    const toks = parseContent(v);
    const k = toks.findIndex((t) => t.kind === 'fn' && t.name === 'counter');
    if (k < 0) return undefined;
    const str = (ts: ContentToken[]) => ts.map((t) => (t.kind === 'str' ? t.v : '')).join('');
    const format = pageNumberFormatOf((toks[k] as { args: string[] }).args[1]);
    return { pre: str(toks.slice(0, k)), post: str(toks.slice(k + 1)), ...(format ? { format } : {}) };
  }

  /**
   * 脚注の要素 e に当たる ::footnote-call・::footnote-marker の content から、この脚注の番号の書式 (LFootnote.callPrefix など) を作る。
   * 参照記号は ::footnote-call (無ければ ::footnote-marker)、本体の頭は ::footnote-marker (無ければ参照記号と同じ)。どちらも無ければ空
   * (文書全体の書式 FootnoteOptions を使う)。本文の頭の番号の置き方 (labelPosition) も、e に当たる ::footnote-marker の list-style-position
   */
  private footnoteFormatOf(e: Element): Pick<LFootnote, 'callPrefix' | 'callSuffix' | 'markerPrefix' | 'markerSuffix' | 'numberFormat' | 'labelPosition' | 'labelGapEm'> {
    const call = this.footnotePseudo(e, 'call').content;
    const markerDecls = this.footnotePseudo(e, 'marker');
    const marker = markerDecls.content;
    const cp = call ?? marker ? this.footnoteContentParts((call ?? marker)!) : undefined;
    const mp = call && marker ? this.footnoteContentParts(marker) : undefined;
    // 置き方 (GCPM 3 §2.7: ::footnote-marker は ::marker と同じに list-style-position で決まる)。書いてあれば、この脚注の値にする
    // (outside の番号と本文の間は、文書全体の値 (footnoteOptions) と同じく字の大きさの半分)
    const lsp = /\b(inside|outside)\b/.exec(markerDecls['list-style-position'] ?? markerDecls['list-style'] ?? '')?.[1] as 'inside' | 'outside' | undefined;
    return {
      // 数え方を書かない counter(footnote) は decimal (文書全体の書式に戻さない)
      ...(cp ? { callPrefix: cp.pre, callSuffix: cp.post, numberFormat: cp.format ?? '1' } : {}),
      ...(mp ? { markerPrefix: mp.pre, markerSuffix: mp.post } : {}),
      ...(lsp ? { labelPosition: lsp, ...(lsp === 'outside' ? { labelGapEm: 0.5 } : {}) } : {}),
    };
  }

  /** 参照番号 (::footnote-call) の字の大きさ (置く所の字に対する比) と太さ。脚注の要素 e の値に、e に当たる ::footnote-call の規則を重ねる */
  private footnoteCallStyle(e: Element, parent: Element): Pick<LFootnote, 'referenceScale' | 'referenceWeight' | 'referenceLineHeight' | 'referenceShift' | 'referenceAutospace'> {
    const call = this.footnotePseudo(e, 'call');
    const fnFs = cssLen(this.cs(e)('font-size'));
    const parentFs = cssLen(this.cs(parent)('font-size'));
    const out: Pick<LFootnote, 'referenceScale' | 'referenceWeight' | 'referenceLineHeight' | 'referenceShift' | 'referenceAutospace'> = {};
    // 和欧間のアキ (CSS Text 4 §8.4 の text-autospace。アンテナハウスの -ah-text-autospace も、規則と同じく読み替える)。
    // no-autospace なら、参照番号の前後に空けない (見本の PDF: CSS-Print 第 4 版の ::footnote-call { -ah-text-autospace: none } は「要素2)」を詰めて組む)
    const asv = call['text-autospace'] ?? (call['-ah-text-autospace'] !== undefined ? AH_ALIASES['-ah-text-autospace'].value(call['-ah-text-autospace']) : undefined);
    if (asv !== undefined) out.referenceAutospace = !/^no-autospace$/i.test(asv.trim());
    // アンテナハウス互換: 上付きの上げ幅は、置く所の字の大きさの 1/3 (superShiftAh)
    const cva = (call['vertical-align'] ?? 'super').trim().toLowerCase();
    if (this.opts.superShiftAh && parentFs && cva === 'super') out.referenceShift = parentFs / 3;
    if (fnFs && parentFs) {
      // 百分率・em・キーワードの基準は、脚注の要素の字の大きさ (::footnote-call は、その脚注の要素の疑似要素。GCPM 3 §2.5)
      const callFs = (call['font-size'] ? fontSizePt(call['font-size'], fnFs, this.rootFsPx * PT_PER_PX) : undefined) ?? fnFs;
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
        else if (call['line-height'] && lenEm(lh, callFs, { pct: callFs })) out.referenceLineHeight = lenEm(lh, callFs, { pct: callFs });
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
   * 脚注の書式: @page の @footnote (区切り線: border-top (個別の指定も)・border-length、上の空き: margin-top・padding-top (一括指定も)) と、
   * ::footnote-call / ::footnote-marker (番号の書式 counter(footnote, …) と前後の文字、参照番号の字の大きさ)
   */
  private footnoteOptions(master: PageMaster, box: Record<string, string> | undefined, rootFs: number): FootnoteOptions | undefined {
    const fo: FootnoteOptions = {};
    const bodyFs = cssLen(this.cs(this.bodyEl!)('font-size')) ?? rootFs;
    if (box) {
      // 罫線の個別の指定 (border-top-width など) と、margin・padding の一括指定を、辺ごとの指定にする (読むのは辺ごとの指定)
      const d = expandBoxSides(marginBorderDecls(box, this.cs(this.bodyEl!)('color')));
      box = d;
      const fs = fontSizePt(box['font-size'], rootFs, this.rootFsPx * PT_PER_PX) ?? rootFs;
      const bt = box['border-top'] ?? box.border;
      const b = bt ? parseBorder(bt, fs) : undefined;
      // 区切りの長さの % の基準は、本文領域の行の向きの長さ (縦書きは高さ)
      const vertArea = /^(vertical|sideways-rl)/.test(this.cs(this.bodyEl!)('writing-mode'));
      const area = (vertArea ? master.height - master.margins.top - master.margins.bottom : master.width - master.margins.left - master.margins.right) * (72 / 25.4);
      const lenV = (box['border-length'] ?? '').split(/\s+/)[0];
      const length = /%$/.test(lenV) ? (area * parseFloat(lenV)) / 100 : lenEm(lenV, fs);
      const sp = (k: string) => lenEm(d[k] ?? '', fs) ?? 0;
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
      // 脚注の領域の高さの上限 (GCPM 3 §2.4.2 の max-height)。百分率は本文の領域の高さ (縦書きは幅) に対して。none は上限なし
      const mh = (d['max-height'] ?? '').trim();
      if (mh && !/^none$/i.test(mh)) {
        const blockArea = (vertArea ? master.width - master.margins.left - master.margins.right : master.height - master.margins.top - master.margins.bottom) * (72 / 25.4);
        const v = /%$/.test(mh) ? (blockArea * parseFloat(mh)) / 100 : lenEm(mh, fs);
        if (v !== undefined && v >= 0) fo.maxHeight = v;
      }
      fo.separator = bsBorder && !b2 ? false : { ...(b2 ? { thickness: b2.width, color: b2.color } : {}), ...(length ? { length } : {}), spaceBefore: sp(`margin-${bs}`), spaceAfter: sp(`padding-${bs}`) };
    }
    // 文書全体の書式 (どの脚注にも使う値) は、選択子の無い規則 (::footnote-call・*::footnote-call。どの脚注の要素にも当たる) だけから作る。
    // 要素を名指しした規則 (.a::footnote-call) は、当たる脚注の要素の値 (footnoteFormatOf・footnoteCallStyle) にだけ入れる
    // (GCPM 3 §2.6・§2.7: 疑似要素は、その脚注の要素のもの。名指しした規則を全体に入れると、当たらない脚注にもその書式が付いた)
    const universal = (which: 'call' | 'marker') =>
      this.footnoteRules.filter((r) => splitTop(r.selector, ',').some((part) => new RegExp(`^\\*?::footnote-${which}$`).test(part.trim())));
    const call = universal('call').reduce<Record<string, string>>((a, r) => ({ ...a, ...r.decls }), {});
    const markerContent = universal('marker').reduce<string | undefined>((a, r) => r.decls.content ?? a, undefined);
    /** content の counter(footnote) の前後の文字と書式 */
    const parts = (v: string) => {
      const toks = parseContent(v);
      const k = toks.findIndex((t) => t.kind === 'fn' && t.name === 'counter');
      if (k < 0) return undefined;
      const str = (ts: ContentToken[]) => ts.map((t) => (t.kind === 'str' ? t.v : '')).join('');
      return { pre: str(toks.slice(0, k)), post: str(toks.slice(k + 1)), format: pageNumberFormatOf((toks[k] as { args: string[] }).args[1]) };
    };
    // 参照の印 (::footnote-call) の書式。無ければ本文の頭の印 (::footnote-marker) の書式を両方に使う (これまでどおり)
    const content = call.content ?? markerContent;
    const cp = content ? parts(content) : undefined;
    if (cp) {
      if (cp.pre) fo.labelPrefix = cp.pre;
      if (cp.post) fo.labelSuffix = cp.post;
      if (cp.format) fo.format = cp.format;
    }
    // 本文の頭の印は、::footnote-marker の content の前後の文字 (参照の印と別。GCPM 3 §2.5・§2.6: 書式は疑似要素ごとに決める)
    // (前は ::footnote-call の content があれば、本文の頭の印にもそれを使い、「1. 」の「. 」が抜けた)
    if (call.content && markerContent) {
      const mp = parts(markerContent);
      if (mp) {
        fo.markerPrefix = mp.pre;
        fo.markerSuffix = mp.post;
      }
    }
    // 脚注本文の番号 (::footnote-marker) の置き方: list-style-position (GCPM 3 §2.7: ::marker と同じに振る舞い、既定は inside。
    // https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/ 、2026-11-04 取得)。
    // outside の番号の終わりと本文の始めの間は、字の大きさの半分 (7.5pt の字なら 3.75pt)
    const marker = universal('marker').reduce<Record<string, string>>((a, r) => ({ ...a, ...r.decls }), {});
    const lsp = /\b(inside|outside)\b/.exec(marker['list-style-position'] ?? marker['list-style'] ?? '')?.[1] ?? (this.opts.footnoteMarkerOutside ? 'outside' : 'inside');
    fo.labelPosition = lsp as 'inside' | 'outside';
    // 脚注どうしの間は空けない (CSS では脚注の要素の余白だけ)
    fo.spacing = 0;
    if (lsp === 'outside') fo.labelGapEm = 0.5;
    const callFs = fontSizePt(call['font-size'], bodyFs, this.rootFsPx * PT_PER_PX);
    if (callFs) fo.referenceScale = callFs / bodyFs;
    return Object.keys(fo).length ? fo : undefined;
  }

  /** @page・余白の箱の背景画像 (background / background-image の url()・グラデーション) → 背景画像 (ページの背景は、本文より先に、塗り足しまで描く) */
  private pageBackground(decls: Record<string, string>, fs = 12): BackgroundImage | undefined {
    const v = decls['background-image'] ?? decls.background ?? '';
    const u = firstCssUrl(v);
    // グラデーションは、ページの背景の領域の大きさで組版のときに画像にする。大きさ (background-size の百分率・長さ)・繰り返し・位置は、
    // url() の画像と同じに読む (CSS Backgrounds 3 §2.3・§2.9: グラデーションも背景の画像。前は読まずに、領域いっぱいに塗っていた)
    const grad = u ? undefined : firstGradient(v);
    if (!u && !grad) return undefined;
    const img: BackgroundImage = grad ? { src: '', gradient: grad, gradientFontSize: cssLen(decls['font-size'] ?? '') ?? 12 } : { src: this.bgSrc(u![1]) };
    /** 長さ → pt。em は箱 (@page・余白の箱) の字の大きさ fs (pt)、rem は根元の要素の字の大きさ。calc() も (百分率を含まないもの) */
    const lenOf = (t: string) => {
      const px = lengthPx(t, { fs: fs / PT_PER_PX, rootFs: this.rootFsPx, vw: 0, vh: 0 });
      return px === undefined ? undefined : px * PT_PER_PX;
    };
    const bsz = (decls['background-size'] ?? '').trim();
    if (bsz === 'cover' || bsz === 'contain') img.size = bsz;
    else {
      // 百分率は、位置の基準の領域 (ページの箱・余白の箱の padding の領域) の大きさに対して、組版で長さにする (CSS Backgrounds 3 §2.9)
      const parts = splitWords(bsz).filter(Boolean);
      // 百分率と長さの和 (calc(50% + 1em)) は、百分率と長さに分ける (CSS Values 4 §10.11)
      const lctx = { fs: fs / PT_PER_PX, rootFs: this.rootFsPx, vw: NaN, vh: NaN };
      parts.forEach((t, k) => {
        const pct = /^(-?[\d.]+)%$/.exec(t);
        const pl = !pct && k < 2 && /%/.test(t) ? percentPlusLength(t, lctx) : undefined;
        if (pct) img[k === 0 ? 'widthPct' : 'heightPct'] = parseFloat(pct[1]) / 100;
        else if (pl && Number.isFinite(pl.px)) {
          img[k === 0 ? 'widthPct' : 'heightPct'] = pl.pct / 100;
          if (pl.px) img[k === 0 ? 'widthOffset' : 'heightOffset'] = pl.px * PT_PER_PX;
        } else if (k < 2 && t && t !== 'auto') {
          const n = lenOf(t);
          if (n !== undefined) img[k === 0 ? 'width' : 'height'] = n;
        }
      });
      if (img.widthPct !== undefined && (parts[1] ?? 'auto') === 'auto') img.pctAuto = 'height';
      else if (img.heightPct !== undefined && parts[0] === 'auto') img.pctAuto = 'width';
    }
    // 繰り返し (background-repeat か、無ければ一括指定の中の繰り返しの語。最初の重ね)。大きさ (cover・contain) を書いても、繰り返しは
    // 書いたとおり (書かなければ初期値の repeat。CSS Backgrounds 3 §2.4・§2.9。前は cover・contain で no-repeat にしていた。ページの背景は、
    // 位置の基準の領域から並べて塗り足しまで覆う)。repeat-x・repeat-y と、横・縦の 2 値 (repeat no-repeat など) も読む (§2.4)。
    // space・round は、repeat として並べる (これまでどおり)
    const rep = pageRepeatOf(decls);
    if (rep) img.repeat = rep;
    // 位置 (CSS Backgrounds 3 §2.6): background-position か、一括指定の中の位置の語・百分率・長さ (/ の後の大きさは除く)。
    // 1〜4 値は文書の要素の背景と同じに x・y に分ける (値が 1 つなら、もう一方は center)。指定が無ければ、初期値の左上 (0% 0%)
    // (前は、指定が無ければ中央に置き、値が 1 つのときの残りの軸を center にしていなかった)
    // 長さ (em・rem・calc() も) は pt にしてから分ける。百分率を含む calc() など、読めない値があれば、宣言ごと無効にして初期値にする
    // (読めない語を落とした残りを、別の軸に当てない。CSS Syntax 3 §1・CSS 2.1 §4.2: 無効な宣言は捨てる)。文書の要素の背景の位置も、
    // 長さか百分率に計算できない値は読まない (setBackgroundPosition)
    const explicit = decls['background-position'] !== undefined;
    const posSrc = decls['background-position'] ?? (v.replace(/url\([^)]*(?:\)|$)/g, ' ').replace(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, ' ').split('/')[0] ?? '');
    const posTokens: string[] = [];
    let posOk = true;
    for (const t of splitWords(posSrc)) {
      if (/^(center|left|right|top|bottom|-?[\d.]+%)$/i.test(t)) posTokens.push(t);
      else if (/^-?[\d.]+([a-z]+)?$/i.test(t) || /^(calc|min|max|clamp)\(/i.test(t)) {
        const n = lenOf(t);
        // 百分率と長さの和 (calc(50% + 1em)) は、百分率と長さ (px) の和の式にして渡す (setBackgroundPosition が分ける)
        const pl = n === undefined && /%/.test(t) ? percentPlusLength(t, { fs: fs / PT_PER_PX, rootFs: this.rootFsPx, vw: NaN, vh: NaN }) : undefined;
        if (pl && Number.isFinite(pl.px)) posTokens.push(`calc(${pl.pct}% + ${pl.px}px)`);
        else if (n === undefined) posOk = false;
        else posTokens.push(`${n}pt`);
      } else if (explicit && t) posOk = false;
    }
    if (posOk && posTokens.length) {
      const [px, py] = positionXY(posTokens);
      setBackgroundPosition(img, px, py);
    }
    if (!grad) this.report.images.push(img.src);
    return img;
  }

  /** ページ余白の箱 (@top-center など) → 静的コンテンツ (ページの左上を原点に、pt で置く) */
  private marginBoxes(master: PageMaster, boxes: Record<string, Record<string, string>>, rootFs: number, pageDecls: Record<string, string> = {}): LBlockContainer[] {
    // 余白の箱は、@page (ページ文脈) に書いた受け継ぐ性質 (字の大きさ・書体・行送り・font-variant・text-transform など) を受け継ぐ
    // (CSS Page 3 §6: 余白の箱はページ文脈から受け継ぎ、ページ文脈は根の要素から受け継ぐ)。
    // 字の書式の一括指定 (font・font-variant・text-decoration) は、個別の性質に分けてから読む
    const inherited = Object.fromEntries(Object.entries(marginTextDecls(pageDecls)).filter(([k]) => MARGIN_TEXT_PROPS.test(k) && !MARGIN_TEXT_NOT_INHERITED.test(k)));
    const rootEl = (this.bodyEl?.ownerDocument as Document | undefined)?.documentElement ?? this.bodyEl;
    const rootC = rootEl ? this.cs(rootEl) : undefined;
    // 罫線の色の初期値 currentcolor は、箱の字の色 (箱の color か、ページ文脈・根の要素から受け継いだ色)
    boxes = Object.fromEntries(Object.entries(boxes).map(([k, d]) => [k, marginBorderDecls(marginTextDecls(d), inherited.color ?? rootC?.('color'))]));
    const PT = 72 / 25.4;
    const W = master.width * PT;
    const H = master.height * PT;
    // 余白の箱はページの余白 (padding の外) に置く
    const mm = master.marginBoxMargins ?? master.margins;
    const m = { top: mm.top * PT, right: mm.right * PT, bottom: mm.bottom * PT, left: mm.left * PT };
    const out: LBlockContainer[] = [];
    // ページの箱の罫線と輪郭線 (@page の border・outline。CSS Paged Media 3 §3・付録 A)。ページの余白の内側 (ページの箱の罫線の箱) に、
    // 本文の背面に描く。色の初期値は、ページ文脈の字の色 (根の要素から受け継ぐ)
    {
      const pfs = fontSizePt(pageDecls['font-size'], rootFs, rootFs) ?? rootFs;
      const pcol = pageDecls.color ?? rootC?.('color');
      const pb = pageBorders(pageDecls, pfs, pcol, this.opts.pageBorderKeywords);
      const [px, py, pw, ph] = [m.left, m.top, W - m.left - m.right, H - m.top - m.bottom];
      // 輪郭線は、罫線の箱に描くときだけの効果 (paintEffect の outline) として付ける (文書の要素と同じに描く)
      const po = declOutline(pageDecls, pfs, pcol ? (cssColor(pcol) ?? pcol) : undefined);
      if ((Object.keys(pb).length || po) && pw > 0 && ph > 0)
        out.push({ type: 'block-container', absolutePosition: true, left: px, top: py, width: pw, height: ph, boxSizing: 'border-box', ...(Object.keys(pb).length ? { border: pb } : {}), ...(po ? { paintEffect: { outline: po } } : {}), layer: 'behind', children: [] });
    }
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
      const fs = this.marginBoxFs(inherited, own, rootFs);
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
      // 余白が 0 のページ (全面の表紙など) では、箱を置く場所が無いので出さない
      if (w <= 0.5 || h <= 0.5) continue;
      // 罫線・内側の余白 (箱の寸法の計算に使い、箱にも付ける)
      const border: Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> = {};
      for (const [prop, val] of Object.entries(decls)) {
        const bm = /^border(?:-(top|right|bottom|left))?$/.exec(prop);
        if (!bm) continue;
        const b = parseBorder(val, fs, this.opts.pageBorderKeywords);
        for (const sd of bm[1] ? [bm[1] as 'top'] : (['top', 'right', 'bottom', 'left'] as const)) {
          if (b) border[sd] = b;
          else delete border[sd];
        }
      }
      const pad = decls.padding ? edges4(decls.padding, fs, rootFs) : undefined;
      const padding = { ...(pad ?? {}) } as Record<string, number>;
      for (const sd of ['top', 'right', 'bottom', 'left']) if (decls[`padding-${sd}`] !== undefined) padding[sd] = lenEm(decls[`padding-${sd}`], fs, { rootFs }) ?? 0;
      // 箱の margin (長さか auto)。一括指定の後に、個別の指定
      const mgTokens = splitWords((decls.margin ?? '').trim()).filter(Boolean);
      const [t0 = '0', r0 = t0, b0 = t0, l0 = r0] = mgTokens;
      const mgRaw: Record<'top' | 'right' | 'bottom' | 'left', string> = { top: t0, right: r0, bottom: b0, left: l0 };
      for (const sd of ['top', 'right', 'bottom', 'left'] as const) if (decls[`margin-${sd}`] !== undefined) mgRaw[sd] = decls[`margin-${sd}`];
      const mgOf = (sd: 'top' | 'right' | 'bottom' | 'left'): number | 'auto' => (/^auto$/i.test(mgRaw[sd].trim()) ? 'auto' : (lenEm(mgRaw[sd], fs, { rootFs }) ?? 0));
      const mgNum = (sd: 'top' | 'right' | 'bottom' | 'left') => {
        const v = mgOf(sd);
        return v === 'auto' ? 0 : v;
      };
      // 箱の大きさの指定 (width・height。百分率は余白の領域に対して)。box-sizing: border-box なら、罫線と内側の余白を引いた中身の大きさにする
      const borderBox = /^border-box$/i.test((decls['box-sizing'] ?? '').trim());
      const pbV = (padding.top ?? 0) + (padding.bottom ?? 0) + (border.top?.width ?? 0) + (border.bottom?.width ?? 0);
      const pbH = (padding.left ?? 0) + (padding.right ?? 0) + (border.left?.width ?? 0) + (border.right?.width ?? 0);
      const size = (v: string | undefined, room: number, pb: number): number | 'auto' => {
        // 百分率 (calc() の中の百分率も) は、余白の領域に対して
        const n = v === undefined || v === 'auto' ? undefined : /%$/.test(v) ? (room * parseFloat(v)) / 100 : lenEm(v, fs, { rootFs, pct: room });
        return n === undefined ? 'auto' : Math.max(0, borderBox ? n - pb : n);
      };
      // 決まった向きの寸法 (CSS Page 3 §5.3.3): 上下の箱の高さと上下の margin、左右の箱の幅と左右の margin、隅の箱の両方。
      // 決まりすぎ (どれも auto でない) のときは、ページの端の側の margin (上の箱は margin-top、下の箱は margin-bottom、左の箱は margin-left、
      // 右の箱は margin-right) を auto とするので、高さ・幅を指定した箱は本文の側に寄る。margin が両方 auto なら真ん中。
      // (以前は、vertical-align で箱の位置を決め、既定は真ん中だった。vertical-align は箱の中の中身の揃え。§6.3: 表のセルと同じ)
      const fixedV = pos.edge === 'top' || pos.edge === 'bottom';
      const fixedH = pos.edge === 'left' || pos.edge === 'right' || pos.part === 'corner-start' || pos.part === 'corner-end';
      // 最小・最大の大きさ (min-*・max-*。CSS Page 3 §5.3: CSS 2.1 の決まりを余白の箱にも当て、外れたら大きさ・margin を決め直す)。
      // CSS 2.1 §10.4・§10.7 と同じに、指定の大きさで決め、max を超えたら max を、min を下回ったら min を指定の大きさとして決め直す
      const fixedDim = (outer: number, a: number | 'auto', b: number | 'auto', prop: 'width' | 'height', pb: number, outsideA: boolean) => {
        let f = marginBoxFixedDimension(outer, a, b, size(decls[prop], outer, pb), pb, outsideA);
        const mx = size(decls[`max-${prop}`], outer, pb);
        if (mx !== 'auto' && f.size > mx) f = marginBoxFixedDimension(outer, a, b, mx, pb, outsideA);
        const mn = size(decls[`min-${prop}`], outer, pb);
        if (mn !== 'auto' && f.size < mn) f = marginBoxFixedDimension(outer, a, b, mn, pb, outsideA);
        return f;
      };
      /** 変わる向きの寸法の、1 つの箱の大きさ (中身。auto は余りいっぱい) を、最小・最大の間に収める。auto のまま収まれば auto */
      const clampVar = (s: number | 'auto', room: number, prop: 'width' | 'height', pb: number): number | 'auto' => {
        let v = s === 'auto' ? Math.max(0, room - pb) : s;
        const mx = size(decls[`max-${prop}`], room, pb);
        const mn = size(decls[`min-${prop}`], room, pb);
        if (mx !== 'auto') v = Math.min(v, mx);
        if (mn !== 'auto') v = Math.max(v, mn);
        return s === 'auto' && Math.abs(v - Math.max(0, room - pb)) < 0.01 ? 'auto' : v;
      };
      if (fixedV) {
        const f = fixedDim(h, mgOf('top'), mgOf('bottom'), 'height', pbV, pos.edge === 'top');
        y += f.a;
        h = pbV + f.size;
      } else {
        // 左右の辺の箱の上下 (変わる向きの寸法。§5.3.2 の上下の辺の決まりを、上下に読み替えたもの): margin は箱を内側へ縮め、
        // 高さを指定した箱は、上の箱は上端・真ん中の箱は真ん中・下の箱は下端に置く (§5.3.2.4)
        y += mgNum('top');
        h -= mgNum('top') + mgNum('bottom');
        const bh = clampVar(size(decls.height, h, pbV), h, 'height', pbV);
        if (bh !== 'auto' && bh + pbV < h) {
          y += pos.part === 'start' ? 0 : pos.part === 'end' ? h - bh - pbV : (h - bh - pbV) / 2;
          h = bh + pbV;
        }
      }
      if (fixedH) {
        const left = pos.edge === 'left' || pos.part === 'corner-start';
        const f = fixedDim(w, mgOf('left'), mgOf('right'), 'width', pbH, left);
        x += f.a;
        w = pbH + f.size;
      } else {
        // 上下の辺の箱の左右 (変わる向きの寸法。§5.3.2): 幅は marginBoxWidths で決めたもの。margin は箱を内側へ縮める
        x += mgNum('left');
        w -= mgNum('left') + mgNum('right');
        // 幅を分けた箱 (along) は、marginBoxWidths が最小・最大も当てた。分けていない箱 (内容の幅が組むまで分からない辺) は、ここで収める
        const bw = along.has(name) ? size(decls.width, w, pbH) : clampVar(size(decls.width, w, pbH), w, 'width', pbH);
        if (bw !== 'auto' && bw + pbH < w && !along.has(name)) {
          x += pos.part === 'start' ? 0 : pos.part === 'end' ? w - bw - pbH : (w - bw - pbH) / 2;
          w = bw + pbH;
        }
      }
      w = Math.max(1, w);
      h = Math.max(1, h);
      const ta = (decls['text-align'] ?? '').toLowerCase();
      const defAlign = pos.edge === 'left' || pos.edge === 'right' ? 'center' : pos.part === 'start' || pos.part === 'corner-end' ? 'start' : pos.part === 'end' || pos.part === 'corner-start' ? 'end' : 'center';
      const align = ta === 'left' || ta === 'start' ? 'start' : ta === 'right' || ta === 'end' ? 'end' : ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : defAlign;
      // 箱の中の中身の縦の揃え (vertical-align。§6.3 で表のセルと同じ。既定は §5.3 の表: 上下の箱は middle、左右の箱は top・middle・bottom)
      const va = (decls['vertical-align'] ?? '').toLowerCase();
      const defV = pos.edge === 'left' || pos.edge === 'right' ? (pos.part === 'start' ? 'start' : pos.part === 'end' ? 'end' : 'center') : 'center';
      const blockAlign = va === 'top' ? 'start' : va === 'bottom' ? 'end' : va === 'middle' ? 'center' : defV;
      // opacity: 背景と文字の色を、白い紙に重ねた色にする
      const opacity = decls.opacity !== undefined ? Math.min(Math.max(parseFloat(decls.opacity), 0), 1) : 1;
      const fade = (col: string | undefined) => {
        // 半透明の色 (#rrggbbaa。背景) は、透明度に opacity を掛ける
        const a8 = col && opacity < 1 ? /^(#[0-9a-f]{6})([0-9a-f]{2})$/i.exec(col) : null;
        if (a8) return `${a8[1]}${Math.round(parseInt(a8[2], 16) * opacity).toString(16).padStart(2, '0')}`;
        if (!col || opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(col)) return col;
        const n = parseInt(col.slice(1), 16);
        return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(255 - opacity * (255 - c)).toString(16).padStart(2, '0')).join('')}`;
      };
      const ts: TextStyle = { ...this.marginTextStyle(decls, fs), fontSize: fs, textIndent: 0, textAlign: align };
      // text-transform・font-variant-caps は、字の並びに当てる (本文と同じ)。指定が無ければ、根の要素の値 (ページ文脈を通して受け継ぐ)
      const tt = (decls['text-transform'] ?? rootC?.('text-transform') ?? 'none').trim().toLowerCase() || 'none';
      const sc = marginSmallCaps(decls['font-variant-caps'] ?? rootC?.('font-variant-caps') ?? '');
      if (decls['font-weight']) ts.fontWeight = /bold/.test(decls['font-weight']) ? 700 : parseInt(decls['font-weight'], 10) || 400;
      if (decls['font-style']) ts.fontStyle = /italic|oblique/.test(decls['font-style']) ? 'italic' : 'normal';
      if (decls['font-family'] || ts.fontWeight) {
        const names = (decls['font-family'] ?? '').split(',').map((n) => n.replace(/['"]/g, '').trim()).filter(Boolean);
        const mapped = names.length ? this.opts.mapFont?.(names, (ts.fontWeight ?? 400) >= 600) : undefined;
        if (mapped) ts.fontFamily = mapped;
      }
      if (decls.color) ts.color = this.printOf(decls, 'color') ?? visibleColorOf(decls.color);
      // 字間の百分率は、字の大きさに対する割合 (CSS Text 4 §7.2)。行の高さの百分率も、字の大きさに対する割合 (CSS 2.1 §10.8.1)
      if (decls['letter-spacing']) ts.letterSpacing = lenEm(decls['letter-spacing'], fs, { rootFs, pct: fs });
      if (decls['line-height']) {
        const lh = decls['line-height'];
        if (/^[\d.]+$/.test(lh)) ts.lineHeight = parseFloat(lh);
        else if (lenEm(lh, fs, { rootFs, pct: fs }) !== undefined) ts.lineHeightPt = lenEm(lh, fs, { rootFs, pct: fs });
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
        children: [{ type: 'block', ...ts, children: this.boxContent(content, tt, sc, this.marginWhiteSpace(decls)) as LInlineLevel[] }],
      };
      // z-index が負の余白の箱 (本文の絵の下に隠れるノンブルなど) は、本文の背面に置く
      if ((parseInt(decls['z-index'] ?? '', 10) || 0) < 0) box.layer = 'behind';
      if (Object.keys(border).length) box.border = border;
      if (Object.keys(padding).length) box.padding = padding;
      const bgv = decls['background-color'] ?? decls.background ?? '';
      // 半透明の色は #rrggbbaa のまま (文書の要素の背景と同じ)。色の名前 (red など) も読む (前は # で始まる色だけ)
      const bg = this.printOf(decls, 'background-color', 'background') ?? splitWords(bgv).map((t) => cssColorAlpha(t)).find((col) => col && (/^(#|cmyk\(|spot\()/.test(col) || isColorName(col)));
      if (bg) box.backgroundColor = fade(bg);
      // 背景の画像 (background-image・background の url()・グラデーション。CSS Paged Media 3 付録 A)。位置の初期値は左上 (0% 0%)
      const bimg = this.pageBackground(decls, fs);
      if (bimg) box.backgroundImage = bimg;
      // 輪郭線 (outline。付録 A): 文書の要素と同じに、描くときだけの効果 (paintEffect の outline) として付ける
      const ol = declOutline(decls, fs, ts.color ?? (rootC ? cssColor(rootC('color')) : undefined));
      // 角丸 (border-radius・border-*-radius): ほかの箱と同じに描く。CSS Paged Media 3 §6 は、CSS 2.1 に無い性質の余白の箱での振る舞いを決めて
      // いない (CSS3 の性質を少しずつ足せるように、と注記する)。書いた順に一括指定を展開する
      const radius: Record<string, string> = {};
      // 百分率を含む calc() は、百分率と長さ (px) の和の式にする (radiusOf が、箱の大きさで解く)
      const toPt = (x: string) => {
        if (/%$/.test(x)) return x;
        const pl = /%/.test(x) ? percentPlusLength(x, { fs: fs / PT_PER_PX, rootFs: rootFs / PT_PER_PX, vw: NaN, vh: NaN }) : undefined;
        return pl && Number.isFinite(pl.px) ? `calc(${pl.pct}% + ${pl.px}px)` : `${lenEm(x, fs, { rootFs }) ?? 0}pt`;
      };
      for (const [prop, val] of Object.entries(decls)) {
        const longs = prop === 'border-radius' ? expand(prop, val) : /^border-(top|bottom)-(left|right)-radius$/.test(prop) ? [[prop, val] as [string, string]] : [];
        for (const [k, v] of longs) radius[k] = splitWords(v.trim()).filter(Boolean).map(toPt).join(' ');
      }
      const rad = Object.keys(radius).length ? this.radiusOf((p) => radius[p] ?? '0px') : undefined;
      if (rad) box.borderRadius = rad;
      if (box.children[0] && (box.children[0] as LBlock).color) (box.children[0] as LBlock).color = fade((box.children[0] as LBlock).color);
      if (ol) box.paintEffect = { ...box.paintEffect, outline: ol };
      // タグ付き PDF: 上の余白の箱はページの上の柱、下の余白の箱は下の柱 (Artifact の Pagination の Subtype Header・Footer。ISO 32000-1 §14.8.2.2.2)
      if (this.sb) box.tag = this.sb.artifact(name.startsWith('top') ? 'header' : name.startsWith('bottom') ? 'footer' : 'pagination');
      out.push(box);
    }
    return out;
  }

  /**
   * 余白の箱の字の書式のうち、marginBoxes が自分で読むもの (字の大きさ・書体・太さ・傾き・色・行送り・字間) のほか:
   * word-spacing・white-space・text-wrap (text-wrap-mode・text-wrap-style)・text-decoration・font-variant-*・font-feature-settings・font-kerning・font-stretch・
   * font-variation-settings・font-optical-sizing・font-palette・hyphens・line-break・word-break・overflow-wrap。
   * 本文と同じ所 (textStyle) で読む。宣言の無い性質は、静的コンテンツが受け継ぐ本文の根の書式 (body) のままにする
   * (decls は、ページ文脈から受け継いだ宣言と、余白の箱の宣言。fs は箱の字の大きさ (pt))
   */
  private marginTextStyle(decls: Record<string, string>, fs: number): TextStyle {
    const body = this.bodyEl;
    if (!body) return {};
    const READ = /^(word-spacing|white-space|text-wrap(-mode|-style)?|font-variant-(numeric|east-asian|ligatures|position)|font-feature-settings|font-kerning|font-stretch|font-optical-sizing|font-variation-settings|font-palette|hyphens|line-break|word-break|overflow-wrap|text-decoration-(line|style|color|thickness)|text-underline-offset)$/;
    if (!Object.keys(decls).some((k) => READ.test(k))) return {};
    const bodyC = this.cs(body);
    // 折り返すか (text-wrap-mode) と行の並べ方 (text-wrap-style) は、一括指定の white-space (CSS Text 4 §3) と text-wrap (§5.5) を
    // 書いた順に展開して決める (本文の要素と同じ展開。decls は一括指定を展開していない宣言の表)。初期値・無効の値は、本文の根の値のままにする
    const wrap: Record<string, string> = {};
    for (const [k, v] of Object.entries(decls)) {
      if (!/^(white-space|text-wrap(-mode|-style)?)$/.test(k)) continue;
      for (const [p, x] of expand(k, v)) {
        const lv = x.trim().toLowerCase();
        if (p === 'text-wrap-mode') wrap[p] = /^(wrap|nowrap)$/.test(lv) ? lv : lv === 'initial' ? 'wrap' : '';
        else if (p === 'text-wrap-style') wrap[p] = /^(auto|balance|stable|pretty|avoid-short-last-line)$/.test(lv) ? lv : lv === 'initial' ? 'auto' : '';
      }
    }
    // em の長さは、箱の字の大きさで pt にする (textStyle は計算値を読む)
    const len = (v: string) => {
      const n = lenEm(v, fs);
      return n === undefined ? v : `${n}pt`;
    };
    const c = (name: string): string => {
      if (name === 'display') return 'block';
      if (name === 'font-size') return `${fs}pt`;
      // 線の色の初期値 currentcolor は、字の色 (計算値では color と同じ値)
      if (name === 'text-decoration-color') {
        const v = decls[name]?.trim();
        return !v || /^currentcolor$/i.test(v) ? c('color') : v;
      }
      if (name === 'color') return decls.color?.trim() ?? bodyC('color');
      if (name === 'text-wrap-mode' || name === 'text-wrap-style') return wrap[name] || bodyC(name);
      const v = READ.test(name) ? decls[name] : undefined;
      if (v === undefined) return bodyC(name);
      if (/^(word-spacing|text-decoration-thickness|text-underline-offset)$/.test(name)) return len(v.trim().toLowerCase());
      return /^(font-feature-settings|font-variation-settings|font-palette)$/.test(name) ? v.trim() : v.trim().toLowerCase();
    };
    const s = this.textStyle(body, body, undefined, c);
    // 字の大きさ・色・行送りは、marginBoxes が決める
    for (const k of ['fontSize', 'color', 'lineHeight', 'lineHeightNormal', 'lineHeightPt', 'fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing'] as const) delete s[k];
    return s;
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
    sameRun?: boolean,
  ): LPageSequence {
    // sameRun: 名前の変わらない、ページの組だけの切り替えで分けたシーケンス (PageSwitch.sameRun)。名前付きの :first は、名前の変わる所で
    // 分けたページの並びの最初のページに当てるので、ここには当てない
    const applies = (r: PageRule, p: string) => (!r.name || r.name === name) && r.pseudos.includes(p) && (p !== 'first' || (r.name ? !sameRun : index === 0));
    const has = (p: string) => pages.some((r) => applies(r, p));
    const otherBlank = blankName !== undefined && blankName !== name;
    // 白ページの種類: 末尾に足す白ページ (次のページの名前)・途中の改ページで入る白ページ (このページの名前)・ふつうのページ
    type BlankKind = 'trailing' | 'blank' | 'none';
    const blanks: BlankKind[] = otherBlank ? ['trailing', 'blank', 'none'] : has('blank') ? ['blank', 'none'] : ['none'];
    const firsts = has('first') ? [true, false] : [false];
    const sides: Array<'left' | 'right' | undefined> = has('left') || has('right') ? ['right', 'left'] : [undefined];
    // :nth(An+B [of 名前]) (CSS GCPM 3 §3.1): このシーケンスに当たりうる鍵を集め、合う鍵の組ごとにマスターを作る (多く合う組を先に。
    // マスターは条件の順に選ぶので、2 つの :nth() に合うページは、両方の組のマスターになる)。of の名前は、そのページの組 (§3.2) の中の順で、
    // Kumiori では名前付きページの 1 つのシーケンスの中の順。of の無いものは文書の先頭からのページの順。組の数は 2^鍵の数なので、
    // 鍵が 4 つを超えると、1 つずつの組だけにする (2 つ以上に合うページは、先に書いた鍵のものになる)
    const nthKeys = [...new Set(pages.filter((r) => !r.name || r.name === name).flatMap((r) => r.pseudos.filter((p) => p.startsWith('nth('))))].filter((k) => {
      const of = parseNthKey(k)?.of;
      return of === undefined || of === name;
    });
    const nthSets: string[][] = [];
    if (nthKeys.length <= 4) {
      for (let bits = (1 << nthKeys.length) - 1; bits > 0; bits--) nthSets.push(nthKeys.filter((_, k) => bits & (1 << k)));
      nthSets.sort((a, b) => b.length - a.length);
    } else for (const k of nthKeys) nthSets.push([k]);
    nthSets.push([]);
    // 左右: 左から右へ進む本では右ページが奇数ページ。縦書き (右から左へ進む本) では左ページが奇数ページ (CSS Paged Media 3 §3.3: 最初のページの左右は、
    // ページの進む向きで決まる)。奇数・偶数は、既定のスタイルではページの順、互換のスタイルではページ番号 (HtmlImportOptions.pageSidesByNumber)
    const rtl = wm === 'vertical-rl';
    this.pageFormat = null;
    // 固定配置 (position: fixed) の箱は、どのページにも出す内容として運ぶので、描くときだけの効果が付かない。その輪郭線 (outline)・
    // 切り抜きの矩形 (clip) は描けないので、知らせる
    const alts: ConditionalPageMaster[] = [];
    /** マスターごとの、余白の箱の最初の counter(page) の書式 (無ければ null) */
    const formats: Array<[PageMaster, string | null]> = [];
    for (const nth of nthSets)
    for (const kind of blanks)
      for (const first of firsts)
        for (const side of sides) {
          const blank = kind !== 'none';
          const r = resolvePageRules(pages, { name: (kind === 'trailing' ? blankName : name) || undefined, first, side, blank, firstSequence: index === 0, ...(nth.length ? { nth } : {}) }, ...this.pageWm);
          // @page に背景の指定が無ければ、根元の要素 (html・body) の背景をページの背景にする (CSS ではページ全体に広がる)
          const hasBg = Object.keys(r.decls).some((k) => /^background/.test(k));
          if (!hasBg && this.rootBackground) Object.assign(r.decls, this.rootBackground);
          const master = this.masterOf(r.decls);
          // 根元の要素の背景は、ページの余白の内側 (ページ領域) に描き、位置・大きさもそこに対して決める (CSS Paged Media・WeasyPrint)
          if (!hasBg && this.rootBackground) master.backgroundArea = 'content';
          // @page にも背景があれば、根元の要素の背景は、ページの背景の上に、ページ領域に重ねて描く (CSS Paged Media 3 §3.1。前は描かなかった)
          else if (hasBg && this.rootBackground) {
            const rc = this.masterOf({ ...this.rootBackground }).backgroundColor;
            const ri = this.pageBackground(this.rootBackground, rootFs);
            if (rc || ri) master.rootBackground = { ...(rc ? { backgroundColor: rc } : {}), ...(ri ? { backgroundImage: ri } : {}) };
          }
          const when: ConditionalPageMaster['when'] = {};
          if (blank) when.blankOrNotBlank = 'blank';
          if (kind === 'trailing') when.trailingBlank = true;
          if (first) when.pagePosition = 'first';
          if (side) when.oddOrEven = (side === 'right') !== rtl ? 'odd' : 'even';
          if (nth.length) when.nth = nth.map((k) => { const x = parseNthKey(k)!; return { a: x.a, b: x.b, ...(x.of !== undefined ? { group: true } : {}) }; });
          const pbg = this.pageBackground(r.decls, fontSizePt(r.decls['font-size'], rootFs, rootFs) ?? rootFs);
          if (pbg) master.backgroundImage = pbg;
          this.masterPageFormat = null;
          alts.push({ when, master, staticContent: [...this.marginBoxes(master, r.boxes, rootFs, r.decls), ...this.fixed] });
          formats.push([master, this.masterPageFormat]);
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
    // ページラベルの書式は、ページのマスター (@page の規則) ごとの counter(page) の型。page-sequence の書式は、最初に見つかった型なので、
    // @page :first { … counter(page, lower-roman) } と @page { … counter(page) } では、2 ページ目からのラベルも i・ii… になっていた
    // (counter(page) の無いマスターは、page-sequence の書式のまま)
    for (const [m, f] of formats) if (f !== null && f !== (this.pageFormat ?? '1')) m.pageNumberFormat = f;
    return seq;
  }

  /** 文書全体 */
  run(doc: Document): LDocument {
    const html = doc.documentElement;
    const bodyEl = doc.body ?? (doc.getElementsByTagName('body')[0] as HTMLElement | undefined) ?? html;
    if (this.opts.tagged && html) {
      // 構造の木の根元 (文書)。言語は文書の言語 (html の lang。無ければ body)
      const lang = this.langOf(bodyEl ?? html);
      this.sb = new StructureBuilder<Element>(
        {
          parent: (e) => {
            const p = e.parentNode as (Element & { getAttribute?: unknown }) | null;
            return p && typeof p.getAttribute === 'function' ? p : undefined;
          },
          order: (e) => this.orderOf(e),
          describe: (e) => this.structDesc(e),
        },
        html,
        lang ? { lang } : {},
      );
    }
    const { pages, rules, counterStyles, rootVars } = this.sheet;
    this.generatedLeft = GENERATED_TEXT_BASE + 2 * (html?.textContent?.length ?? 0) + GENERATED_TEXT_PER_ELEMENT * (html?.getElementsByTagName('*').length ?? 0);
    this.pageRules = pages;
    // @page と余白の箱の宣言の色に書いた cmyk()・rgb-icc() (アンテナハウスの拡張の書き方) は、互換の指定の無いときは読まない (printColor)。報告する
    for (const pr of pages) for (const ds of [pr.decls, ...Object.values(pr.boxes)]) for (const [p, v] of Object.entries(ds)) if (PAGE_COLOR_PROP.test(p)) this.dropCompatOnly(p, v);
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
      // 根元の要素の背景 (色・url() の画像・グラデーション) は、ページ (canvas) へ伝わる (CSS Backgrounds 3 §2.11.1)
      if (!col && !/url\(|gradient\(/.test(imgv)) continue;
      // ページの背景にするのは、最初の画像の層だけ (層ごとの値は、その層のもの)。2 枚目以降は未対応として知らせる
      const rl = backgroundLayers(rc);
      const first = rl.find((l) => /url\(|gradient\(/.test(l.image));
      if (rl.filter((l) => /url\(|gradient\(/.test(l.image)).length > 1) this.miss(msg('background-image: 2 枚目以降 (html・body)', 'background-image: second and later layers (html, body)'));
      this.rootBackground = {
        ...(col ? { 'background-color': col } : {}),
        ...(first ? { 'background-image': first.image, 'background-size': first.size, 'background-repeat': first.repeat, 'background-position': `${first.x} ${first.y}` } : {}),
      };
      rootFromBody = e === bodyEl && e !== html;
      break;
    }
    // ::footnote-call・::footnote-marker の規則 (文書全体の書式は選択子の無い規則だけから作り、要素を名指しした規則は、当たる脚注の書式にだけ
    // 入れる。GCPM 3 §2.6・§2.7: 疑似要素は、その脚注の要素のもの)。疑似要素の前の選択子 (span.footnote-body::footnote-call など) は、
    // 文書のどれかの要素に当たれば集める (前は選択子の無い ::footnote-call・*::footnote-call だけを読み、前に選択子の付いた規則を読み落とした)
    const pseudoBaseMatches = (sel: string) =>
      splitTop(sel, ',').some((part) => {
        const m = /^(.*?)::footnote-(call|marker)$/.exec(part.trim());
        if (!m) return false;
        const base = m[1].trim();
        if (!base || base === '*') return true;
        // 照合は、カスケードと同じ自前の照合 (覚えを使う。cssSelector.ts) で引く。linkedom の querySelector は、子孫・後続の兄弟の結合子で
        // 合わない祖先・兄弟の選び方を総当たりし、短い選択子と深い入れ子で、手間が指数で伸びる
        try {
          return this.src.select ? this.src.select(base).length > 0 : !!doc.querySelector(base);
        } catch {
          return false;
        }
      });
    this.footnoteRules = rules.filter((r) => /::footnote-(call|marker)\s*$/.test(r.selector.trim()) && pseudoBaseMatches(r.selector));
    this.collectPaged(doc, rules, rootVars);
    this.bodyEl = bodyEl;
    this.warnIneffectiveWarichu(bodyEl);
    const rootFs = cssLen(this.cs(html)('font-size')) ?? 12;
    // 本文 (body) の書式は、ページシーケンスの書式にする
    // ルビの字の配り方の既定は、ruby-align の初期値 space-around (CSS Ruby 1 §4.3。欧文・注音のルビは字の間を空けず中央にそろえる)
    // fontOpticalSizeUnit: CSS の font-optical-sizing: auto は、font-size の CSS px の数を opsz にする (CSS Fonts 4 §8.1 の試験 variable-opsz.html)
    const rootStyle: TextStyle = { ...this.textStyle(bodyEl, undefined), ...this.paragraphStyle(bodyEl, undefined), fontOpticalSizeUnit: 'px', wordSpaceShrink: this.opts.wordSpaceShrink ?? false, textAutospaceWidth: this.opts.autospaceWidth ?? 0.125, ...(this.opts.autospaceLatinOnly ? {} : { textAutospaceUnicode: true }), primaryFontMetrics: true, inlineBoxFontMetrics: true, ...(this.opts.emBoxBaselineAh ? {} : { fontBaseline: true }), ...(this.opts.normalLineHeightAllFonts ? { normalLineHeightAllFonts: true } : {}), rubyAlign: 'space-around', ...(this.opts.primaryFontByLangAh ? { primaryFontByLang: true } : {}) };
    // 文書の言語: body に lang が無ければ、祖先 (html) の lang を受け継ぐ (HTML Standard §3.2.6.2 The lang and xml:lang attributes:
    // 要素にこれらの属性が無ければ、その要素の言語は親の要素の言語と同じ)。
    // 字の言語 (TextStyle.language) で決まる動き (line-break の日本語・中国語だけの決まり = CSS Text 3 §5.2、分綴の言語、
    // アンテナハウス互換の行の基準線) が、<html lang="…"> だけの文書でも効く
    if (!rootStyle.language) {
      const rootLang = this.langOf(bodyEl);
      if (rootLang) rootStyle.language = rootLang;
    }
    // 互換モード・限定互換モードの行の高さ (Quirks Mode Standard §3.3・§3.4)
    if (documentModeOf(doc) !== 'no-quirks') Object.assign(rootStyle, { noStrut: true, lineHeightQuirk: true });
    // 和欧間アキの既定 (CSS Text 4 §8.4 の初期値 normal)。指定のある要素は、その指定 (spacing) で上書きする
    if (rootStyle.textAutospace === undefined) rootStyle.textAutospace = this.opts.autospaceInitial ?? true;
    if (this.opts.lineBreakAutoAh) rootStyle.lineBreakAutoAh = true;
    if (this.opts.jaDefaultsAh) {
      rootStyle.punctuationTrimParagraphStart = true;
      // 両端揃えで、約物の前後も字間を空ける (見本の PDF: CSS-Print 第 4 版は「き、」「す。」の間なども空ける)
      rootStyle.justifyPunctuationAh = true;
      // 追込みで詰める量は 1 行に二分まで (XSL-FO のアンテナハウス互換と同じ)。ただし、追い出すと詰める量より大きく空く行は、
      // 二分を超えても追い込む (lineSqueezeBeyondMax。見本の PDF: CSS-Print 第 4 版の 17.9 の縦書きの例など)
      rootStyle.lineSqueezeMax = 0.5;
      rootStyle.lineSqueezeBeyondMax = true;
    }
    const wm = this.wm(this.cs(bodyEl)('writing-mode')) ?? 'horizontal-tb';
    this.pagesRtl = wm === 'vertical-rl';
    const box = this.boxStyle(bodyEl);
    // html・body はページをまたぐ本文の全体で、1 つの箱として描かないので、その transform・opacity は掛けられない (未対応として知らせる)
    {
      const fxs = [box.paintEffect, html !== bodyEl ? this.paintEffectOf(html) : undefined];
      if (fxs.some((f) => f?.transform || f?.opacity !== undefined)) this.miss(msg('transform・opacity (html・body)', 'transform, opacity (html, body)'));
      // 輪郭線 (outline) も同じ理由で描けない
      if (fxs.some((f) => f?.outline)) this.miss(msg('outline (html・body)', 'outline (html, body)'));
      if (fxs.some((f) => f?.clip)) this.miss(msg('clip (html・body)', 'clip (html, body)'));
    }
    delete box.paintEffect;
    // body の背景をページの背景にしたときは、body の箱には描かない (CSS と同じ)
    if (rootFromBody) {
      delete box.backgroundColor;
      delete box.backgroundImage;
    }
    // 本文領域 (名前の無い @page) の余白と幅 (pt)
    const PT = 72 / 25.4;
    const base = pageBox(resolvePageRules(pages, {}, ...this.pageWm).decls, this.opts.defaultPage ?? { width: 210, height: 297, margin: 20 }, this.rootFsPx, this.opts.spotColors, !!this.opts.ahCssExtensions, this.opts.pageBorderKeywords);
    const bm = base.margins;
    this.area = { top: bm.top * PT, right: bm.right * PT, bottom: bm.bottom * PT, left: bm.left * PT, width: (base.width - bm.left - bm.right) * PT, height: (base.height - bm.top - bm.bottom) * PT };
    // body (か html) の段組は、ページの段組にする
    const pc = this.columnsOf(bodyEl, this.area.width) ?? this.columnsOf(html, this.area.width);
    if (pc) this.pageColumns = { count: pc.count, gap: pc.gap / PT, fill: pc.fill, ...(pc.rule ? { rule: pc.rule } : {}) };
    this.enterCounters(this.cs(html), null);
    this.enterCounters(this.cs(bodyEl), null);
    // 文書の最初のページの名前: body の page、無ければ html の page (CSS Paged Media 3 §8.1: page の auto の使用値は親の値なので、
    // page が auto の中の箱は、すべて、この名前のページに置く。文書の全体を名前付きのページにする書き方 (body { page: x }))
    const rootPage = rootPageName(this.pg(bodyEl).page, html !== bodyEl ? this.pg(html).page : undefined) ?? '';
    this.rootPage = rootPage;
    // body が flex・grid の容器なら、ブラウザが置いた配置で組む (body の箱も含める)。
    // さらに html が flex・grid の容器なら、body の箱を、ブラウザが置いた位置 (本文領域の左上から) に置く
    let children: Array<LBlockLevel | LInlineLevel>;
    let bodyBoxed = false;
    const fg = !bodyPageSwitchHolder(this.display(bodyEl)) ? this.flexGrid(bodyEl, html) : undefined;
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
    } else {
      this.pageFlowEls.add(bodyEl);
      this.pageUsed.set(bodyEl, rootPage);
      // いまのページの名前は、最初の組の名前 (下の groups の最初) から始める。未定のままだと、最初の流れの中のブロックの前に
      // 切り替え (同じ名前) が入り、その前の字 (body の最初の中身が字のとき) との間で改ページしていた
      this.curPage = rootPage;
      children = this.hoistPageSwitches(this.flowChildren(bodyEl));
    }
    // 名前付きページの切り替えで分ける
    // html・body の counter-reset・counter-set の page は、最初のページの番号 (最初の組の振り直し。後の箱の振り直しと同じ読み方)
    const rootInitial = this.firstPageInitial ?? this.pageCounterStart(bodyEl) ?? (html !== bodyEl ? this.pageCounterStart(html) : undefined);
    const groups: Array<{ page: string; initial?: number; sameRun?: boolean; items: Array<LBlockLevel | LInlineLevel> }> = [{ page: rootPage, ...(rootInitial !== undefined ? { initial: rootInitial } : {}), items: [] }];
    for (const c of children) {
      if (typeof c !== 'string' && (c as unknown as PageSwitch).type === 'page-switch') {
        const sw = c as unknown as PageSwitch;
        const last = groups[groups.length - 1];
        // 前の組に流れの中の箱が無ければ (空白・絶対配置の箱・見えない箱の印だけ)、改ページせず、その組をこの名前のページにする
        // (ページの名前は流れの中の箱の間でだけ比べる。CSS Page 3 §8.1。最初のページの種類は、最初の流れの中の箱の page)
        // (前の切り替えのページ番号の振り直し (counter-reset: page) は、この切り替えに振り直しが無ければ残す)
        if (!last.items.some((x) => this.inFlowItem(x))) Object.assign(last, { page: sw.page, initial: sw.initial ?? last.initial });
        else groups.push({ page: sw.page, initial: sw.initial, ...(sw.sameRun ? { sameRun: true } : {}), items: [] });
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
      // 包む箱を分けた断片 (hoistPageSwitches) では、左右の改ページは中の最初・最後のブロックにあるので、最初・最後の子をたどって見る
      const lastBlock = [...g.items].reverse().find((x): x is LBlock => typeof x !== 'string' && x.type === 'block');
      const next = groups[k + 1]?.items.find((x): x is LBlock => typeof x !== 'string' && x.type === 'block');
      const sideOf = (b: LBlock | undefined, end: boolean): BreakKind | undefined => {
        for (let n = b; n; ) {
          const v = end ? n.breakAfter : n.breakBefore;
          if (v === 'odd-page' || v === 'even-page') return v;
          const kids = n.children.filter((x) => typeof x !== 'string');
          const c = end ? kids[kids.length - 1] : kids[0];
          n = c && (c as LBlock).type === 'block' ? (c as LBlock) : undefined;
        }
        return undefined;
      };
      const side = sideOf(next, false) ?? sideOf(lastBlock, true) ?? lastBlock?.breakAfter;
      const pads = side === 'odd-page' || side === 'even-page';
      const blankName = pads && this.opts.blankPageName !== 'previous' ? (groups[k + 1]?.page ?? '') : undefined;
      const seq = this.sequence(pages, g.page, k, rootStyle, wm, hasBox ? [{ type: 'block', ...box, children: g.items } as LBlock] : g.items, rootFs, blankName, g.sameRun);
      if (g.initial !== undefined) seq.initialPageNumber = g.initial;
      if (side === 'odd-page') seq.forcePageCount = 'end-on-even';
      else if (side === 'even-page') seq.forcePageCount = 'end-on-odd';
      // 左右の区切りの無い境目で、次の組がページ番号を振り直すとき: その番号の偶奇に合わせる白ページ (組版エンジンの既定の
      // force-page-count="auto") を足さない (HtmlImportOptions.pageSidesByNumber)
      else if (groups[k + 1]?.initial !== undefined && !this.opts.pageSidesByNumber) seq.forcePageCount = 'no-force';
      return seq;
    });
    this.report.counts.sequences = sequences.length;
    // 文書の最初の箱の左右の強制の区切り (break-before: left・right・recto・verso。根元へ伝わる: CSS Fragmentation 3 §3.1.1) は、空のページを
    // 挟まずに、最初のページの左右を決める (CSS Paged Media 3 §3.3)。ページの順で左右を決める文書 (既定のスタイル) だけ
    let firstSideShift = false;
    if (!this.opts.pageSidesByNumber) {
      const firstSide = (items: Array<LBlockLevel | LInlineLevel>): BreakKind | undefined => {
        for (let n: LBlock | undefined = items.find((x): x is LBlock => typeof x !== 'string' && x.type === 'block'); n; ) {
          if (n.breakBefore === 'odd-page' || n.breakBefore === 'even-page') return n.breakBefore;
          // 区切りが伝わるのは、最初の子の、前に中身の無いときだけ
          const c = n.children.find((x) => typeof x !== 'string' || x.trim() !== '');
          n = c && typeof c !== 'string' && c.type === 'block' ? c : undefined;
        }
        return undefined;
      };
      const head = sequences[0]?.flow.children as Array<LBlockLevel | LInlineLevel> | undefined;
      // 最初のページは文書の順で 1 枚目 (奇数)。偶数のページ (左右の逆) が要るなら、左右を 1 つずらす
      if (head && firstSide(head) === 'even-page') firstSideShift = true;
    }
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
    const out: LDocument = {
      type: 'document',
      ...(title ? { title } : {}),
      ...(roots.length ? { bookmarks: roots } : {}),
      sequences,
      ...(this.opts.idLinesSeparateMarginsWp ? { idLinesSeparateMargins: true } : {}),
      ...(this.opts.unresolvedCitationEmptyWp ? { unresolvedCitationEmpty: true } : {}),
      // ページの左右は、ページの順で決める (CSS Paged Media 3 §3.3。HtmlImportOptions.pageSidesByNumber)
      ...(this.opts.pageSidesByNumber ? {} : { pageSidesByOrder: true }),
      ...(firstSideShift ? { firstPageSideShift: 1 as const } : {}),
      // 右から左へ進む本 (根元の要素が vertical-rl): 奇数ページは左ページで、綴じ側は右 (CSS Paged Media 3 §3.3。下の @page の左右と同じ決まり)
      ...(this.pageWm[0] === 'vertical-rl' ? { rtlPageProgression: true as const } : {}),
    };
    if (this.sb) {
      out.structure = this.sb.finish(out);
      const ds = this.sb.limitDiagnostics();
      if (ds.length) this.report.diagnostics = [...(this.report.diagnostics ?? []), ...ds];
    }
    return out;
  }
}

/**
 * 行内の節 n と、その中の行内の節に、(x, y) の移動 (描くときだけの効果) を足す。すでにある変換の前に掛ける (移動は、変換の原点によらない)。
 * 効果の物は節ごとに作り直す (同じ物を持つ節は 1 つの効果としてまとめられるので、別々に動かす節には別の物を持たせる)
 */
function shiftInline(n: LInlineLevel | LBlockLevel, x: number, y: number) {
  if (typeof n === 'string') return;
  if (!/^(inline|image|inline-container|ruby|tate-chu-yoko|leader|page-number-citation)$/.test(n.type)) return;
  const node = n as { paintEffect?: PaintEffect; children?: unknown };
  const t = node.paintEffect?.transform;
  node.paintEffect = { ...node.paintEffect, transform: { ...t, functions: [{ fn: 'translate', x, y }, ...(t?.functions ?? [])] } };
  if (n.type === 'inline') for (const k of n.children) shiftInline(k, x, y);
}

/**
 * 同じ区切りに当たる 2 つの強制の区切りの値を合わせる (CSS Fragmentation 3 §4.3: すべての種類の区切りを満たす。左右のページの指定は、
 * 流れの中で後ろの要素の値が勝つ)。a が流れの中で前の要素の値、b が後ろの要素の値
 */
function mergeBreaks(a: BreakKind | undefined, b: BreakKind | undefined): BreakKind | undefined {
  const side = (k: BreakKind | undefined) => k === 'odd-page' || k === 'even-page';
  if (side(b)) return b;
  if (side(a)) return a;
  return a === 'page' || b === 'page' ? 'page' : (a ?? b);
}

/** 通常の流れの子か (区切りの値が伝わる子を探すとき。マーカー・回り込み・絶対配置の箱は飛ばす。字は流れの中) */
function inFlowChild(c: LBlockLevel | LInlineLevel): boolean {
  return typeof c === 'string' || (c.type !== 'marker' && c.type !== 'float' && !(c.type === 'block-container' && c.absolutePosition));
}

/** 区切りを避ける値の種類を合わせる (どちらかが all なら all) */
function maxAvoid(a: AvoidKind | undefined, b: AvoidKind | undefined): AvoidKind | undefined {
  return a === 'all' || b === 'all' ? 'all' : (a ?? b);
}

/**
 * 箱の中身の、最初の通常の流れの子の break-before と、最後の子の break-after (子の最初・最後の子へたどる)。
 * 箱の前後の区切りに伝わる値 (CSS Fragmentation 3 §3.1.1)。子の前 (後ろ) に行内の中身があれば、伝わらない
 */
function edgeBreaks(children: ReadonlyArray<LBlockLevel | LInlineLevel>): { before?: BreakKind; after?: BreakKind } {
  const before = edgeBreak(children, 'before');
  const after = edgeBreak(children, 'after');
  return { ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/** edgeBreaks の片側 (before か after だけをたどる。両側を一度にたどると、子が 1 つの入れ子で、深さの 2 乗ではなく 2 の深さ乗の手間になる) */
function edgeBreak(children: ReadonlyArray<LBlockLevel | LInlineLevel>, side: 'before' | 'after'): BreakKind | undefined {
  let c: LBlockLevel | LInlineLevel | undefined;
  if (side === 'before') {
    for (const x of children) if (inFlowChild(x)) { c = x; break; }
  } else {
    for (let i = children.length - 1; i >= 0; i--) if (inFlowChild(children[i])) { c = children[i]; break; }
  }
  if (!c || typeof c === 'string' || (c.type !== 'block' && c.type !== 'table' && c.type !== 'block-container')) return undefined;
  const own = side === 'before' ? c.breakBefore : c.breakAfter;
  const inner = c.type === 'block' ? edgeBreak(c.children, side) : undefined;
  // 子 (内側) は、before では流れの中で後ろ、after では前
  return side === 'before' ? mergeBreaks(own, inner) : mergeBreaks(inner, own);
}

/**
 * 要素の百分率の寸法 (BoxStyle.percent)。of は、性質の割合と長さの部分 (px。StyleSource.percentOf)。sized は、読み込みが幅 (width) を
 * 決めた箱か (幅・上限・下限を組むときに解き直す。置換要素・縦横比・内容による大きさの箱は、ここでは扱わない)。
 * 幅・上限・下限のどれかが百分率なら、長さで書いたものも割合 0 で入れる (組むときに、同じ式で抑え直す)
 */
function percentBox(of: (prop: string) => { f: number; px: number } | undefined, c: (p: string) => string, sized: boolean): BoxStyle['percent'] | undefined {
  const pl = (p: string): PercentLength | undefined => {
    const v = of(p);
    return v ? { pct: v.f, len: v.px * PT_PER_PX } : undefined;
  };
  const out: NonNullable<BoxStyle['percent']> = {};
  for (const k of ['margin', 'padding'] as const) {
    const e: Partial<Record<'top' | 'right' | 'bottom' | 'left', PercentLength>> = {};
    for (const sd of ['top', 'right', 'bottom', 'left'] as const) {
      const v = pl(`${k}-${sd}`);
      if (v) e[sd] = v;
    }
    if (Object.keys(e).length) out[k] = e;
  }
  const ti = pl('text-indent');
  if (ti) out.textIndent = ti;
  const w = pl('width');
  const mx = pl('max-width');
  const mn = pl('min-width');
  // 幅が auto で、長さの上限・下限のある箱も、組むときに、置く場所の幅を上限・下限で抑える (CSS 2.1 §10.4。見積もりの幅では効かなかった
  // 上限・下限が、名前付きのページ・:first の狭い領域では効くことがある)
  const lenLimit = c('width') === 'auto' && (/px$/.test(c('max-width')) || (/px$/.test(c('min-width')) && (cssLen(c('min-width')) ?? 0) > 0));
  if ((w || mx || mn || lenLimit) && sized) {
    const len = (p: string): PercentLength | undefined => (/px$/.test(c(p)) ? { pct: 0, len: cssLen(c(p))! } : undefined);
    const W = w ?? len('width');
    const MX = mx ?? len('max-width');
    const MN = mn ?? len('min-width');
    if (W) out.width = W;
    if (MX) out.maxWidth = MX;
    if (MN) out.minWidth = MN;
  }
  return Object.keys(out).length ? out : undefined;
}

/** BoxStyle.estimatedSize の、長さの上限・下限 (無いものは書かない) */
function estLimits(max: number | undefined, min: number | undefined): { max?: number; min?: number } {
  return { ...(max !== undefined ? { max } : {}), ...(min !== undefined ? { min } : {}) };
}

/**
 * edgeBreak と同じにたどった、最初 (最後) の子の強制の区切りを返し、子からは外す (容器へ移す。表のセルの中身の区切りを、行の区切りにするとき)
 */
function takeEdgeBreak(children: ReadonlyArray<LBlockLevel | LInlineLevel>, side: 'before' | 'after'): BreakKind | undefined {
  let c: LBlockLevel | LInlineLevel | undefined;
  if (side === 'before') {
    for (const x of children) if (inFlowChild(x)) { c = x; break; }
  } else {
    for (let i = children.length - 1; i >= 0; i--) if (inFlowChild(children[i])) { c = children[i]; break; }
  }
  if (!c || typeof c === 'string' || (c.type !== 'block' && c.type !== 'table' && c.type !== 'block-container')) return undefined;
  const own = side === 'before' ? c.breakBefore : c.breakAfter;
  if (side === 'before') delete c.breakBefore;
  else delete c.breakAfter;
  const inner = c.type === 'block' ? takeEdgeBreak(c.children, side) : undefined;
  return side === 'before' ? mergeBreaks(own, inner) : mergeBreaks(inner, own);
}

/** 末尾の空白 (U+0020) を取る (端から数える。/ +$/ は空白の長い並びで 2 乗の手間になる。linearText.ts の trimChars と同じ考え方) */
function trimEndSpaces(s: string): string {
  let b = s.length;
  while (b > 0 && s[b - 1] === ' ') b--;
  return b === s.length ? s : s.slice(0, b);
}

/**
 * ブロックの中身の並び (list) の、まだ決めていない改行の印 (SEG_BREAK。text() が節の端の改行に置いたもの) を、空白にするか消す
 * (CSS Text 3 §4.1.3。CSS Text 4 §4.3.3 も同じ: 続いた改行は 1 つにまとめ、残った改行を、前後の字に応じて空白 (U+0020) にするか消す。
 * 決め方は UA に任されている)。決め方は text() の、同じテキストの節の中の改行と同じ (前後の字が和文なら消し、ほかは空白)。
 * 前後の字は、行内の要素 (LInline) の境目と、流れの外の箱 (回り込み・マーカー・絶対配置の箱) をまたいで探す (CSS Text 3 §1.5: 空白の処理で
 * 隣り合うかを決めるときは、間の行内の箱の境目と流れの外の要素を無視する。§4.1.1 の 4 も、空白を詰めるのは行内の要素の境目をまたぐ)。
 * 改行の前後の、詰める空白 (U+0020) も見て飛ばす (§4.1.1 の 1: 改行の前後の空白とタブは、改行を変える前に消す。text() は同じ節の中の空白を
 * trimAroundNewlines で消している)。消すと決めた改行の前後の、詰める空白も消す (同じ節の中と同じ結果にする)。空白にすると決めたときは、
 * 前後の空白は collapseAcrossInlines が 1 つに詰める。
 * 前後の字に数えないもの (境目。そこで探すのを止め、和文でない側とみなす): ブロック (中のブロックで分けた行内の箱の境目も)・強制改行 (br・保った改行)・
 * 行内の箱 (画像・inline-block・ルビ・縦中横など)。white-space が空白を残す要素 (collapseSpaces: false) の中の字は、空白・タブも字として数える
 * (改行は強制改行)。root: 並びの直下の字の white-space が空白を詰めるか。
 * 手間は並びの字の数に比例する (1 度だけたどり、決めた所だけを後で書き換える)
 */
function resolveSegmentBreaks(list: Array<LBlockLevel | LInlineLevel>, root = true): void {
  type Arr = Array<LBlockLevel | LInlineLevel>;
  /** 書き換える範囲: arr[i] の [from, to) を repl にする */
  type Edit = { arr: Arr; i: number; from: number; to: number; repl: string };
  const edits: Edit[] = [];
  // 直前の字 ('' は境目)・決めていない改行と、その前後の空白の並び (印を含むときだけ決める)
  let before = '';
  let run: Array<{ arr: Arr; i: number; from: number; to: number }> = [];
  let hasBreak = false;
  const close = (after: string) => {
    if (hasBreak) {
      const remove = CJK.test(before) && CJK.test(after);
      for (const r of run) {
        const src = r.arr[r.i] as string;
        // 消すなら、改行と前後の空白を消す。空白にするなら、印を空白にする (続いた印・空白は collapseAcrossInlines が 1 つに詰める)
        edits.push({ ...r, repl: remove ? '' : src.slice(r.from, r.to).split(SEG_BREAK).join(' ') });
      }
    }
    run = [];
    hasBreak = false;
  };
  const char = (c: string) => {
    close(c);
    before = c;
  };
  const walk = (arr: Arr, collapse: boolean) => {
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (typeof n === 'string') {
        if (!collapse) {
          for (let j = 0; j < n.length; j++) {
            if (n[j] === '\n') char('');
            else char(n[j]);
          }
          continue;
        }
        for (let j = 0; j < n.length; ) {
          const c = n[j];
          if (c === ' ' || c === SEG_BREAK) {
            let k = j;
            while (k < n.length && (n[k] === ' ' || n[k] === SEG_BREAK)) {
              if (n[k] === SEG_BREAK) hasBreak = true;
              k++;
            }
            run.push({ arr, i, from: j, to: k });
            j = k;
            continue;
          }
          // 強制改行 (保った改行) は境目
          char(c === '\n' ? '' : c);
          j++;
        }
        continue;
      }
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'float' || n.type === 'marker' || (n as { absolutePosition?: boolean }).absolutePosition) continue;
      if (n.type === 'inline' && Array.isArray(n.children) && !isBlockLevel(n)) {
        walk(n.children as Arr, n.collapseSpaces ?? collapse);
        continue;
      }
      // ブロック・行内の箱は境目
      char('');
    }
  };
  walk(list, root);
  close('');
  if (!edits.length) return;
  // 文字列ごとに、範囲を前から順につないで 1 度に書き換える (edits は並びの順で、同じ文字列の範囲は続いて、前から並ぶ。
  // 範囲ごとに文字列の全体を切り貼りすると、範囲の多い長い文字列で、長さの 2 乗の手間になる)
  const emptied = new Set<Arr>();
  for (let k = 0; k < edits.length; ) {
    const { arr, i } = edits[k];
    const src = arr[i] as string;
    let v = '';
    let at = 0;
    for (; k < edits.length && edits[k].arr === arr && edits[k].i === i; k++) {
      const e = edits[k];
      v += src.slice(at, e.from) + e.repl;
      at = e.to;
    }
    v += src.slice(at);
    arr[i] = v;
    if (!v) emptied.add(arr);
  }
  for (const arr of emptied) dropEmptyStrings(arr);
}

/** 並びの中の空の文字列を、その場で除く (1 つずつ splice すると、空の項目の多い並びで長さの 2 乗の手間になるので、1 度の走査で詰める) */
function dropEmptyStrings(arr: unknown[]): void {
  let w = 0;
  for (let r = 0; r < arr.length; r++) if (arr[r] !== '') arr[w++] = arr[r];
  arr.length = w;
}

/** importHtml の終わりに、決めずに残った改行の印 (SEG_BREAK) を空白にする (ブロックの中身として resolveSegmentBreaks を通らなかった並び。前の版と同じ空白) */
function finishSegmentBreaks(root: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object' || seen.has(n) || ArrayBuffer.isView(n) || n instanceof ArrayBuffer) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        const v = n[i];
        if (typeof v === 'string') {
          if (v.includes(SEG_BREAK)) n[i] = v.split(SEG_BREAK).join(' ');
        } else visit(v);
      }
      return;
    }
    for (const v of Object.values(n)) visit(v);
  };
  visit(root);
}

/**
 * 子の並び (kids) の、コメント・処理命令だけを挟んで続く、同じ親の文字の節を、1 つの文字の節 (中身の字だけを持つ代わりのもの) につなぐ。
 * コメント・処理命令は CSS では無いものとして扱う (CSS Display 3 §1) ので、前後の字は 1 つの並びとして空白を処理し (CSS Text 3 §4.1.1)、
 * その後で字を変える (§2.1: text-transform は、空白を詰める段の後。節ごとに変えると、full-width でつなぎ目の空白が全角の空白 2 つになる)
 */
function joinTextAcrossComments<T extends Node>(kids: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (!isTextNode(n)) {
      out.push(n);
      continue;
    }
    let text = n.textContent ?? '';
    let last = i;
    for (let j = i + 1; j < kids.length; j++) {
      const m = kids[j];
      if (m.nodeType === 8 || m.nodeType === 7) continue;
      if (!isTextNode(m) || m.parentNode !== n.parentNode) break;
      text += m.textContent ?? '';
      last = j;
    }
    if (last === i) out.push(n);
    else {
      out.push({ nodeType: 3, textContent: text, parentNode: n.parentNode } as unknown as T);
      i = last;
    }
  }
  return out;
}

/**
 * 並び (items) の、隣り合う文字列を 1 つにつなぐ (入力の項目は変えない)。文字の節は text() が 1 つずつ空白を処理するので、コメント・処理命令
 * (CSS Display 3 §1: CSS では、無いものとして扱う)・display: none の要素・字だけを持つ display: contents の要素で分かれた節のつなぎ目には、
 * 詰める空白が続いて残る。空白を詰める white-space の値 (CSS Text 3 §3 の表: normal・nowrap・pre-line) では、つなぎ目の前の終わりと
 * 次の頭の、空白・改行の続きを 1 つにまとめる (§4.1.1 の 4: 詰める空白の直後の詰める空白は消す。続いた空白は、要素の境目に関わらず 1 つの並び):
 *  - 改行の印 SEG_BREAK を含めば、印 1 つにする。改行の前後の空白は消し (§4.1.1 の 1)、印は後で resolveSegmentBreaks が、前後の字で
 *    消すか空白にする (§4.1.3。コメントの無い「あ \nい」と同じく、和文の間では消える)
 *  - pre-line で改行を含めば、改行は残し (§4.1.1・§3 の表)、前後の空白は消す (§4.1.1 の 1)
 *  - 空白だけなら、空白 1 つにする
 * pre・pre-wrap・break-spaces は、空白も改行も残すので、そのままつなぐ。
 * つなぐ文字列は、断片を配列に貯めて最後に 1 度だけつなぐ (つなぐたびに長い文字列を作り直すと、節の数の 2 乗の手間になる)。
 * cur は、いまつないでいる文字列の項目 (out の最後) で、中身は body を順につないだ後に、終わりの詰める字の続き (tail) を足したもの。
 * tail は、元の字のまま (raw) か、つなぎ目でまとめた字 (raw が undefined。字は midOf(br, len) で作る) で、どちらも改行の印か改行の数 br と
 * 字の数 len を持つ (pre-line で、まとめた長い改行の続きを、つなぐたびに作り直したり数え直したりしない)
 */
function joinTextItems(items: FlowItem[], ws: string): FlowItem[] {
  const collapse = /^(normal|nowrap|pre-line|)$/.test(ws);
  // つなぎ目で詰める字: 空白と、節の端の改行の印 SEG_BREAK (normal・nowrap)。pre-line では、改行は残すので印にならず、改行のまま (§4.1.1)
  const preLine = ws === 'pre-line';
  const brCode = preLine ? 0x0a : SEG_BREAK.charCodeAt(0);
  /** つなぎ目で詰める字か (空白と、改行の印か改行) */
  const isEdge = (c: number) => c === 0x20 || c === brCode;
  /** s の頭から続く、詰める字の数 */
  const headLen = (s: string) => {
    let i = 0;
    while (i < s.length && isEdge(s.charCodeAt(i))) i++;
    return i;
  };
  /** s の終わりに続く、詰める字の始まりの位置 (正規表現の `[…]*$` は頭から 1 字ずつ試すので、長い文字列で遅い。終わりから戻る) */
  const tailStart = (s: string) => {
    let i = s.length;
    while (i > 0 && isEdge(s.charCodeAt(i - 1))) i--;
    return i;
  };
  /** s の中の改行の印か改行の数 */
  const countBr = (s: string) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === brCode) n++;
    return n;
  };
  /** つなぎ目の前の終わりと次の頭の、詰める字の続き (改行の印か改行が br 個、全部で len 字) を、まとめた字 */
  const midOf = (br: number, len: number) => (br ? (preLine ? '\n'.repeat(br) : SEG_BREAK) : len ? ' ' : '');
  const out: FlowItem[] = [];
  let cur: { item: FlowItem; body: string[]; raw: string | undefined; br: number; len: number } | undefined;
  const flush = () => {
    if (cur) cur.item.v = cur.body.join('') + (cur.raw ?? midOf(cur.br, cur.len));
    cur = undefined;
  };
  for (const x of items) {
    if (typeof x.v !== 'string') {
      flush();
      out.push({ ...x });
      continue;
    }
    if (!cur) {
      const item = { ...x };
      out.push(item);
      // 詰めない値では、終わりの続きを分けずに、そのままつなぐ
      const e = collapse ? tailStart(x.v) : x.v.length;
      const raw = x.v.slice(e);
      cur = { item, body: [x.v.slice(0, e)], raw, br: countBr(raw), len: raw.length };
      continue;
    }
    if (!collapse) {
      cur.body.push(x.v);
      continue;
    }
    const b = headLen(x.v);
    const br = cur.br + countBr(x.v.slice(0, b));
    const len = cur.len + b;
    const rest = x.v.slice(b);
    if (rest) {
      // rest は詰める字で始まらないので、つなぎ目でまとめた字は、ここで中身に入る
      const mid = midOf(br, len);
      if (mid) cur.body.push(mid);
      const e = tailStart(rest);
      cur.body.push(rest.slice(0, e));
      cur.raw = rest.slice(e);
      cur.br = countBr(cur.raw);
      cur.len = cur.raw.length;
    } else {
      // 次の節も詰める字だけ: まとめた字が、そのまま終わりの詰める字の続きになる (midOf の字の改行の数と字の数)
      cur.raw = undefined;
      cur.br = br ? (preLine ? br : 1) : 0;
      cur.len = br ? cur.br : len ? 1 : 0;
    }
  }
  flush();
  return out;
}

/**
 * ブロックの中身の並びで、行内の要素 (LInline) の境目をまたいで空白を詰める (CSS Text 3 §4.1.1 の 4: 詰める空白の直後の詰める空白は消す。
 * 要素の境目は関係しない)。行の頭 (ブロックの始め・強制改行の後・中のブロックの後) と行の終わりの空白も消す (§4.1.2 の 1・3)。
 * 行内の要素の中身は、端の空白を残して読む (collapseFlowWhitespace の inline) ので、「word <b> bold</b>」の二重の空白、
 * 「<p><b> bold </b></p>」の行の頭・終わりの空白は、ここで消す。white-space が空白を残す要素 (collapseSpaces: false) の中の字は変えず、字として数える。
 * 画像・inline-block などの行内の箱は字と同じに数え、回り込み・マーカー・絶対配置の箱は飛ばす。空になった文字列は並びから除く
 */
function collapseAcrossInlines(list: Array<LBlockLevel | LInlineLevel>): void {
  type Arr = Array<LBlockLevel | LInlineLevel>;
  // 節の端の改行を、境目をまたいだ前後の字で、空白にするか消す (空白を詰める前に。CSS Text 3 §4.1.1 の 2 は 4 より前)
  resolveSegmentBreaks(list);
  // 行の頭か、直前の字が詰める空白か
  let prevSpace = true;
  // 末尾が空白の、直前の文字列 (行の終わりなら、その空白を消す)
  let tail: { arr: Arr; i: number } | undefined;
  const touched = new Set<Arr>();
  const endLine = () => {
    if (tail) {
      tail.arr[tail.i] = trimEndSpaces(tail.arr[tail.i] as string);
      touched.add(tail.arr);
    }
    tail = undefined;
    prevSpace = true;
  };
  const walk = (arr: Arr, collapse: boolean) => {
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (typeof n === 'string') {
        if (!collapse) {
          if (n) {
            prevSpace = false;
            tail = undefined;
          }
          continue;
        }
        // 強制改行 (保った改行) の前後は、行の終わりと頭
        const segs = n.split('\n');
        let t = '';
        segs.forEach((seg, k) => {
          if (k > 0) {
            if (tail) endLine();
            t = trimEndSpaces(t) + '\n';
            prevSpace = true;
            tail = undefined;
          }
          let v = seg;
          if (prevSpace) v = v.replace(/^ +/, '');
          if (v) prevSpace = v.endsWith(' ');
          t += v;
        });
        if (t !== n) {
          arr[i] = t;
          touched.add(arr);
        }
        if (/[^ ]/.test(t.replace(/\n/g, ''))) tail = undefined;
        if (t.endsWith(' ')) tail = { arr, i };
        continue;
      }
      if (!n || typeof n !== 'object') continue;
      // 流れの外の箱 (回り込み・マーカー・絶対配置の箱。行の中の場所は取らない) は飛ばす
      if (n.type === 'float' || n.type === 'marker' || (n as { absolutePosition?: boolean }).absolutePosition) continue;
      if (isBlockLevel(n)) {
        endLine();
        continue;
      }
      if (n.type === 'inline' && Array.isArray(n.children)) {
        walk(n.children as Arr, n.collapseSpaces ?? collapse);
        continue;
      }
      // 行内の箱 (画像・inline-block・リーダー・ページ番号の引用など) は字と同じ
      prevSpace = false;
      tail = undefined;
    }
  };
  walk(list, true);
  endLine();
  for (const arr of touched) dropEmptyStrings(arr);
}

/** HTML の文書 (スタイルを確定させたもの) を Kumiori の論理ツリーにする */
export function importHtml(doc: Document, src: StyleSource, opts: HtmlImportOptions = {}): ImportResult {
  // 文書の CSS は 1 度だけ読む (prepareHtml が読んであれば、それを使う)
  const sheet = opts.sheet ?? parseCss(opts.css ?? '', opts.defaultPage ? mediaPageOf(opts.defaultPage) : undefined, opts.ahCssExtensions ? ALL_AH : undefined);
  // target-counter()・target-counters()・target-text() を使う文書は、2 回変換する (1 回目で、参照先の番号・文字を集める)
  let lookup: Map<string, TargetInfo> | undefined;
  if (/target-(counters?|text)\(/.test(opts.css ?? '')) {
    const first = new HtmlImporter(src, opts, sheet);
    first.run(doc);
    lookup = first.record;
  }
  const imp = new HtmlImporter(src, opts, sheet, lookup);
  const document = imp.run(doc);
  finishSegmentBreaks(document);
  // 同じ画像は 1 度だけ報告する (XSL-FO の読み込みの報告と同じ。同じ URL を何度も取りに行かせない)
  imp.report.images = [...new Set(imp.report.images)];
  return { document, report: imp.report };
}

/**
 * 枠の内側 (padding の箱・内容の箱) の角丸: 外側の半径から、その角に接する辺の罫線と余白を引く (CSS Backgrounds 3 §4.2。0 未満は 0)。
 * 百分率はそのまま (内側の箱の大きさに対する百分率として使う)
 */
function innerRadius(rad: BorderRadius, border?: BorderInput, padding?: EdgesInput): BorderRadius {
  const w = (s: 'top' | 'right' | 'bottom' | 'left') => ((border as Partial<Record<string, BorderSide>> | undefined)?.[s]?.width ?? 0) + ((padding as Partial<Record<string, number>> | undefined)?.[s] ?? 0);
  // 百分率と長さの和は、長さの側から引く (長さにするときに 0 未満を 0 にする: paint の radiusLen)
  const sub = (v: RadiusLength, d: number): RadiusLength => (typeof v === 'number' ? Math.max(v - d, 0) : typeof v === 'object' ? { pct: v.pct, len: v.len - d } : v);
  const corners = rad.corners ?? [[rad.rx, rad.ry], [rad.rx, rad.ry], [rad.rx, rad.ry], [rad.rx, rad.ry]];
  const hs = [w('left'), w('right'), w('right'), w('left')];
  const vs = [w('top'), w('top'), w('bottom'), w('bottom')];
  const out = corners.map(([h, v], k) => [sub(h, hs[k]), sub(v, vs[k])] as [RadiusLength, RadiusLength]);
  return { rx: 0, ry: 0, corners: out };
}

// 入力の名前 (プロパティ・値・属性の値) で引く定数の表は、原型を持たないものにする: 原型があると、constructor・__proto__・toString などの名前で
// Object.prototype の関数を拾い、30 バイトほどの入力 (p { constructor: 1 }) で、文書の全体が TypeError で組めなくなる
for (const t of [PAGE_SIZES, MARGIN_BOXES, MARKER_POS, OBSOLETE_LIST_GLYPHS]) Object.setPrototypeOf(t, null);
