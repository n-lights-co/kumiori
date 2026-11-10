/**
 * LNode — レイアウト途中の「論理座標ツリー」。
 *
 * レイアウトエンジンは inline/block の論理座標だけを扱い、サイズ確定後に
 * toArea() で一度だけ物理座標 (x, y, width, height) の Area Tree に変換する。
 */
import { zeroEdges } from './geometry';
import type { BaseNode, BorderStyle, Edges, Rotation, RubyAlign, TextAlign, WritingMode } from './types';

export type LKind = 'region-body' | 'block' | 'line' | 'inline' | 'glyph' | 'ruby' | 'tcy' | 'table' | 'row' | 'cell' | 'image';

export interface GlyphPayload {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  baselineX: number;
  baselineY: number;
  rotation: 0 | 90;
  scaleX: number;
  advance: number;
  italic?: boolean;
  /** 書体に太字が無いときの擬似太字 (GlyphArea.fakeBold) */
  fakeBold?: boolean;
  /** OpenType の機能 (GlyphArea.features) */
  features?: string[];
}

export interface LNode {
  kind: LKind;
  wm: WritingMode;
  /** 親 content-box 内での inline-start / block-start オフセット (親の書字方向基準) */
  i: number;
  b: number;
  /** 自身の書字方向での border-box サイズ */
  isize: number;
  bsize: number;
  margin: Edges;
  padding: Edges;
  border: BorderStyle;
  bg?: string;
  /** 背景画像 (大きさは解決済み) */
  bgImage?: import('./types').BackgroundImage & { width: number; height: number };
  children: LNode[];
  src?: string;
  /** page-number-citation の字 (参照の引数の鍵)。2 回目の組版で、番号の幅が同じなら字だけ差し替える */
  cite?: string;
  /** 元の入力の節の通し番号 (sourceRef.ts) */
  ref?: number;
  /** 物理座標を直接指定 (縦中横の内部横組みグリフ用) */
  phys?: { x: number; y: number };
  // fragmentation
  cont?: boolean;
  contNext?: boolean;
  // line
  hasRuby?: boolean;
  contentLength?: number;
  // glyph
  glyph?: GlyphPayload;
  // ruby / tcy
  rubyExtent?: number;
  /** ruby: 子のうち先頭 baseCount 個が親文字、残りがルビ */
  baseCount?: number;
  tcyScale?: number;
  tcyFrames?: number;
  /** 回転 (反時計回り)。isize / bsize は回転前の局所寸法 */
  rot?: Rotation;
  /** 書字方向を決め直した参照領域 (block-container)。外の書字方向の裏返し (WritingFlip) は、この中へ持ち込まない */
  flipRoot?: boolean;
  // image
  image?: { src: string; missing: boolean; alt?: string; fit?: 'cover' | 'contain'; naturalWidth?: number; naturalHeight?: number; stretch?: boolean; hidden?: boolean };
  /** cell: 表の行の中の揃え (LTableCell の blockAlign・stretchContent・stretchMax)。flex の行の表を後から伸ばすときに当て直す */
  cellAlign?: string;
  cellStretch?: boolean;
  cellStretchMax?: number;
  /** 内容を padding の外端で切り抜く */
  clip?: boolean;
  radius?: import('./types').BorderRadius;
  /** 斜めの罫線 (Area の diagonals と同じ) */
  diag?: Array<{ kind: 'tlbr' | 'trbl'; side: import('./types').BorderSide }>;
  shadow?: import('./types').BoxShadow | import('./types').BoxShadow[];
  /** line: ページを持たない Flow (セル・コンテナの中) で組んだ行の脚注。親が置いたときに、そのページの脚注領域へ積む */
  fns?: import('./types').LFootnote[];
  /** 段組の段 (0 始まり)。行番号の数え直し・置く側の判定に使う */
  colIndex?: number;
  /** line: 行番号の指定と、行の中での基線の位置 (block 方向。縦書きは字面の中央) */
  lnum?: import('./types').LineNumbering;
  /** line: この行に引く改訂バー */
  revs?: import('./types').RevisionBar[];
  baseline?: number;
  /** リンク・注釈の範囲 (描画しない) */
  link?: import('./types').LinkTarget;
  annot?: import('./types').Annotation;
  form?: import('./types').FormField;
  /** 絶対配置を本文の背面に置く */
  behind?: boolean;
  /** CSS の回り込みの箱 (Area.float。描く順を変える) */
  float?: boolean;
  // table
  colSizes?: number[];
  repeated?: boolean;
  /** 表の行の前後の余白 (fo:list-item の space-before / space-after)。前後の余白と重ね合わせる (XSL §4.3.1) */
  rowSpace?: { before: number; after: number };
  /** セル: 中身の最後の行の下の半行間 (行グリッドの中で、ページに入るかの判定に数えない分) */
  trailLead?: number;
}

/**
 * 改行の厳しさ (line-break) の既定値。CSS の初期値 auto (normal 相当) ではなく strict にしている (JLREQ §3.1.7 の原則どおり、小書きの仮名・長音記号・
 * 繰返し記号を行頭に置かない)。HTML の入力も同じ既定で組む (CSS の line-break: auto を指定した要素だけ normal になる)。
 * 文書の根の ResolvedStyle (LayoutEngine.baseStyle) に入り、子へ受け継がれる
 */
export const DEFAULT_LINE_BREAK: NonNullable<ResolvedStyle['lineBreak']> = 'strict';

export interface ResolvedStyle {
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  textAutospace?: boolean;
  textAutospaceWidth?: number;
  punctuationSqueeze?: boolean;
  lineSqueezeMax?: number;
  punctuationTrimStart?: boolean;
  hangFirst?: boolean;
  punctuationTrimEnd?: boolean;
  punctuationTrimParagraphStart?: boolean;
  punctuationTrimStartExceptFirst?: boolean;
  punctuationTrimEndExceptFullstop?: boolean;
  punctuationTrimAll?: boolean;
  latinLigatures?: boolean;
  forcedLigatures?: string[];
  looseLineStart?: boolean;
  punctuationSpacing?: number;
  lineStackingStrategy?: 'max-height' | 'line-height' | 'font-height';
  xslLineStacking?: boolean;
  xslLetterSpacing?: boolean;
  keepLineEndSpace?: boolean;
  collapseSpaces?: boolean;
  boxLineHalfLeading?: boolean;
  primaryFontMetrics?: boolean;
  primaryFontByLang?: boolean;
  noStrut?: boolean;
  lineHeightQuirk?: boolean;
  blockLeadingMaxHeight?: boolean;
  lineHeightShiftAdjustment?: 'consider-shifts' | 'disregard-shifts';
  lineHeightDiscard?: boolean;
  lineHeightPrecedence?: number | 'force';
  fontLineMetrics?: boolean;
  hyphenate?: boolean;
  language?: string;
  rubyOverhang?: boolean;
  rubyAlign?: RubyAlign;
  kerning?: boolean;
  fontFeatures?: string[];
  textOrientation?: 'mixed' | 'upright' | 'sideways';
  wordSpaceShrink?: boolean;
  lineNumber?: import('./types').LineNumbering;
  revisionBar?: import('./types').RevisionBar;
  changeBars?: import('./types').RevisionBar[];
  direction?: 'ltr' | 'rtl';
  /** unicode-bidi (引き継がない) */
  unicodeBidi?: import('./types').TextStyle['unicodeBidi'];
  fontStretch?: number;
  textDecoration?: import('./types').TextStyle['textDecoration'];
  fontSize: number;
  lineHeight: number;
  /** 長さで指定された行送り (継承される)。lineHeight より優先 */
  lineHeightPt?: number;
  color: string;
  textAlign: TextAlign;
  textAlignLast?: TextAlign;
  noWrap?: boolean;
  alignOverflow?: boolean;
  overflowWrap?: 'normal' | 'break-word' | 'anywhere';
  wordBreak?: 'normal' | 'break-all' | 'keep-all';
  lineBreak?: 'auto' | 'strict' | 'normal' | 'loose' | 'anywhere';
  breakClear?: 'start' | 'end' | 'both';
  textIndent: number;
  textIndentHanging?: boolean;
  textIndentEachLine?: boolean;
  letterSpacing: number;
  wordSpacing?: number;
  fixedLetterSpacing?: boolean;
  letterSpacingStretch?: number;
  rubyScale: number;
  hanging: boolean;
  orphans: number;
  widows: number;
  wm: WritingMode;
}

/**
 * 字のノードは余白・罫線・子を持たないので、変更できない共有の空のものを使う (字ごとに作らない。
 * 書き換えようとすれば例外になる)
 */
const NO_EDGES = Object.freeze(zeroEdges()) as Edges;
const NO_BORDER = Object.freeze({}) as BorderStyle;
const NO_CHILDREN = Object.freeze([]) as unknown as LNode[];

type Decoration = NonNullable<import('./types').TextStyle['textDecoration']>;
/**
 * 飾りの線の指定を、親の指定に重ねる。線の種類・太さ・下線のずらしは、線を指定した要素のもの (CSS Text Decoration 3 §2.2・同 4 §2.4・§2.8:
 * その要素から出た線にだけ効く) なので、子が指定し直した線には、子の値だけを使う (親の値を残さない)
 */
function mergeDecoration(p: Decoration | undefined, n: Decoration): Decoration {
  const out: Decoration = { ...p, ...n, ...(p?.colors || n.colors ? { colors: { ...p?.colors, ...n.colors } } : {}) };
  for (const key of ['styles', 'thickness'] as const) {
    if (!p?.[key] && !n[key]) continue;
    const m: Record<string, unknown> = { ...p?.[key] };
    for (const k of ['underline', 'overline', 'lineThrough'] as const) {
      if (n[k] === undefined) continue;
      if (n[key]?.[k] !== undefined) m[k] = n[key]![k];
      else delete m[k];
    }
    if (Object.keys(m).length) out[key] = m as never;
    else delete out[key];
  }
  if (n.underline !== undefined && n.underlineOffset === undefined) delete out.underlineOffset;
  return out;
}

export function newNode(kind: LKind, wm: WritingMode, extra: Partial<LNode> = {}): LNode {
  const leaf = kind === 'glyph';
  return {
    kind,
    wm,
    i: 0,
    b: 0,
    isize: 0,
    bsize: 0,
    margin: leaf ? NO_EDGES : zeroEdges(),
    padding: leaf ? NO_EDGES : zeroEdges(),
    border: leaf ? NO_BORDER : {},
    children: leaf ? NO_CHILDREN : [],
    ...extra,
  };
}

export function resolveStyle(parent: ResolvedStyle, n: BaseNode): ResolvedStyle {
  return {
    fontFamily: n.fontFamily ?? parent.fontFamily,
    fontWeight: n.fontWeight ?? parent.fontWeight,
    italic: n.fontStyle ? n.fontStyle === 'italic' : parent.italic,
    textAutospace: n.textAutospace ?? parent.textAutospace,
    textAutospaceWidth: n.textAutospaceWidth ?? parent.textAutospaceWidth,
    punctuationSqueeze: n.punctuationSqueeze ?? parent.punctuationSqueeze,
    lineSqueezeMax: n.lineSqueezeMax ?? parent.lineSqueezeMax,
    punctuationTrimStart: n.punctuationTrimStart ?? parent.punctuationTrimStart,
    hangFirst: n.hangFirst ?? parent.hangFirst,
    punctuationTrimEnd: n.punctuationTrimEnd ?? parent.punctuationTrimEnd,
    punctuationTrimParagraphStart: n.punctuationTrimParagraphStart ?? parent.punctuationTrimParagraphStart,
    punctuationTrimStartExceptFirst: n.punctuationTrimStartExceptFirst ?? parent.punctuationTrimStartExceptFirst,
    punctuationTrimEndExceptFullstop: n.punctuationTrimEndExceptFullstop ?? parent.punctuationTrimEndExceptFullstop,
    punctuationTrimAll: n.punctuationTrimAll ?? parent.punctuationTrimAll,
    latinLigatures: n.latinLigatures ?? parent.latinLigatures,
    forcedLigatures: n.forcedLigatures ?? parent.forcedLigatures,
    looseLineStart: n.looseLineStart ?? parent.looseLineStart,
    punctuationSpacing: n.punctuationSpacing ?? parent.punctuationSpacing,
    lineStackingStrategy: n.lineStackingStrategy ?? parent.lineStackingStrategy,
    xslLineStacking: n.xslLineStacking ?? parent.xslLineStacking,
    xslLetterSpacing: n.xslLetterSpacing ?? parent.xslLetterSpacing,
    keepLineEndSpace: n.keepLineEndSpace ?? parent.keepLineEndSpace,
    collapseSpaces: n.collapseSpaces ?? parent.collapseSpaces,
    boxLineHalfLeading: n.boxLineHalfLeading ?? parent.boxLineHalfLeading,
    primaryFontMetrics: n.primaryFontMetrics ?? parent.primaryFontMetrics,
    primaryFontByLang: n.primaryFontByLang ?? parent.primaryFontByLang,
    noStrut: n.noStrut ?? parent.noStrut,
    lineHeightQuirk: n.lineHeightQuirk ?? parent.lineHeightQuirk,
    blockLeadingMaxHeight: n.blockLeadingMaxHeight ?? parent.blockLeadingMaxHeight,
    lineHeightShiftAdjustment: n.lineHeightShiftAdjustment ?? parent.lineHeightShiftAdjustment,
    lineHeightDiscard: n.lineHeightDiscard ?? parent.lineHeightDiscard,
    lineHeightPrecedence: n.lineHeightPrecedence ?? parent.lineHeightPrecedence,
    fontLineMetrics: n.fontLineMetrics ?? parent.fontLineMetrics,
    hyphenate: n.hyphenate ?? parent.hyphenate,
    language: n.language ?? parent.language,
    rubyOverhang: n.rubyOverhang ?? parent.rubyOverhang,
    rubyAlign: n.rubyAlign ?? parent.rubyAlign,
    kerning: n.kerning ?? parent.kerning,
    fontFeatures: n.fontFeatures ?? parent.fontFeatures,
    textOrientation: n.textOrientation ?? parent.textOrientation,
    wordSpaceShrink: n.wordSpaceShrink ?? parent.wordSpaceShrink,
    lineNumber: n.lineNumber ? { ...parent.lineNumber, ...n.lineNumber } : parent.lineNumber,
    revisionBar: n.revisionBar ?? parent.revisionBar,
    changeBars: n.changeBars ?? parent.changeBars,
    direction: n.direction ?? parent.direction,
    unicodeBidi: n.unicodeBidi,
    fontStretch: n.fontStretch ?? parent.fontStretch,
    // text-decoration は子の文字にも引き継がれる (§7.17.4)。子の指定は親の指定に重ねる
    textDecoration: n.textDecoration ? mergeDecoration(parent.textDecoration, n.textDecoration) : parent.textDecoration,
    fontSize: n.fontSize ?? parent.fontSize,
    lineHeight: n.lineHeight ?? parent.lineHeight,
    // 比で指定し直されたら長さの指定は解除、長さで指定されたらそれを継承
    lineHeightPt: n.lineHeightPt ?? (n.lineHeight !== undefined ? undefined : parent.lineHeightPt),
    color: n.color ?? parent.color,
    textAlign: n.textAlign ?? parent.textAlign,
    textAlignLast: n.textAlignLast ?? parent.textAlignLast,
    noWrap: n.noWrap ?? parent.noWrap,
    alignOverflow: n.alignOverflow ?? parent.alignOverflow,
    overflowWrap: n.overflowWrap ?? parent.overflowWrap,
    wordBreak: n.wordBreak ?? parent.wordBreak,
    lineBreak: n.lineBreak ?? parent.lineBreak,
    breakClear: n.breakClear,
    textIndent: n.textIndent ?? parent.textIndent,
    textIndentHanging: n.textIndentHanging ?? parent.textIndentHanging,
    textIndentEachLine: n.textIndentEachLine ?? parent.textIndentEachLine,
    letterSpacing: n.letterSpacing ?? parent.letterSpacing,
    wordSpacing: n.wordSpacing ?? parent.wordSpacing,
    fixedLetterSpacing: n.fixedLetterSpacing ?? parent.fixedLetterSpacing,
    letterSpacingStretch: n.letterSpacingStretch ?? parent.letterSpacingStretch,
    rubyScale: n.rubyScale ?? parent.rubyScale,
    hanging: n.hangingPunctuation ?? parent.hanging,
    orphans: n.orphans ?? parent.orphans,
    widows: n.widows ?? parent.widows,
    wm: n.writingMode ?? parent.wm,
  };
}

/** 1 行の行送り (pt)。長さの指定があればそれ、無ければ文字サイズ × 比 */
export function lineHeightOf(st: ResolvedStyle): number {
  return st.lineHeightPt ?? st.fontSize * st.lineHeight;
}
