/**
 * LNode — レイアウト途中の「論理座標ツリー」。
 *
 * レイアウトエンジンは inline/block の論理座標だけを扱い、サイズ確定後に
 * toArea() で一度だけ物理座標 (x, y, width, height) の Area Tree に変換する。
 */
import { opticalSize, splitVariation, variationSuffix, type VariationRequest } from './fontVariation';
import { zeroEdges } from './geometry';
import type { BaseNode, BorderStyle, Edges, HyphenLimits, Rotation, RubyAlign, TextAlign, TextJustifyTrim, WritingMode } from './types';

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
  /** 色つきの字形のパレット (GlyphArea.fontPalette) */
  fontPalette?: import('./colorGlyph').FontPalette;
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
  /** 背景の色を塗る範囲 (Area の backgroundClip) */
  bgClip?: 'padding-box' | 'content-box';
  children: LNode[];
  src?: string;
  /** page-number-citation の字 (参照の引数の鍵)。2 回目の組版で、番号の幅が同じなら字だけ差し替える */
  cite?: string;
  /** 元の入力の節の通し番号 (sourceRef.ts) */
  ref?: number;
  /** 物理座標を直接指定 (縦中横の内部横組みグリフ用) */
  phys?: { x: number; y: number };
  /** 中身の幅を測る組版 (Flow の intrinsic) で、inline 方向の大きさの指定のある箱 (内容による大きさの計測で、箱の幅そのものを数える) */
  fixedI?: boolean;
  // fragmentation
  cont?: boolean;
  contNext?: boolean;
  // line
  hasRuby?: boolean;
  contentLength?: number;
  /** 行: 行頭の字下げ (text-indent・start-indent で、行の箱の始めの端に付く空き。正の値だけ)。中身から箱の幅を決めるとき、中身の長さに足す */
  lineIndent?: number;
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
  image?: { src: string; missing: boolean; alt?: string; fit?: 'cover' | 'contain' | 'none' | 'scale-down'; naturalWidth?: number; naturalHeight?: number; fitPosition?: import('./types').ObjectPosition; stretch?: boolean; hidden?: boolean };
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
  /** 輪郭線 (CSS の outline。行内の箱の、行ごとの断片に付ける。toArea が Area の outline にする) */
  outline?: import('./types').Outline;
  /** 描くときだけの効果 (transform・opacity)。toArea が Area に印を付け、組み終えてから Area の transform・opacity にする (paintEffect.ts) */
  fx?: import('./types').PaintEffect;
  /** 字の背景の箱: 字を作った入力の節の番号 (効果を付けるときにだけ使う。Area の sourceRef にはしない) */
  fxRef?: number;
  /** line: ページを持たない Flow (セル・コンテナの中) で組んだ行の脚注。親が置いたときに、そのページの脚注領域へ積む */
  fns?: import('./types').LFootnote[];
  /** 段組の段 (0 始まり)。行番号の数え直し・置く側の判定に使う */
  colIndex?: number;
  /** line: 行番号の指定と、行の中での基線の位置 (block 方向。縦書きは字面の中央) */
  lnum?: import('./types').LineNumbering;
  /** line: 中に、格子に合わせ直すリーダー (leaderGrid) がある */
  hasLeaderGrid?: boolean;
  /**
   * リーダーの箱: 点・文字列の繰り返しを、参照領域・ページの始めの端からの格子に合わせ直す (XSL 1.1 §7.22.1 の leader-alignment)。
   * cycle は 1 周期の字 (i は周期の始まりから)。ページに置いた後で、箱の位置から並べ直す (Paginator の addLineMarks)
   */
  leaderGrid?: { align: 'reference-area' | 'page'; pitch: number; cycle: LNode[] };
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
  /**
   * 書体の名前。可変フォントを読み込んだ文書 (varAxes) では、軸の値の指定 (幅・傾き・光学サイズ・font-variation-settings) の印
   * (fontManager.ts の variationSuffix) を後ろに付けた名前 (FontManager が、その実体を返す)
   */
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  /** 読み込んだ可変フォントの軸の札 (根のスタイルから引き継ぐ。可変フォントの無い文書は undefined で、下の 4 つも使わない) */
  varAxes?: ReadonlySet<string>;
  /** 印を付ける前の書体の名前 */
  fontFamilyBase?: string;
  /**
   * 傾き・幅の印のうち、斜体の書体・幅の違う書体 (静的な書体) のためだけに付けるもの (FontManager.staticShapeMarks。根のスタイルから引き継ぐ)。
   * あるときは、その印を外した書体の名前 fontFamilySpec も作る
   */
  shapeMarks?: { ital: boolean; wdth: boolean };
  /**
   * 「同じ書体の指定か」を比べるための書体の名前: fontFamily から、静的な書体のためだけの傾き・幅の印を外したもの
   * (斜体の書体・幅の違う書体を読み込んでいない文書の fontFamily と同じ)。無ければ fontFamily で比べる
   */
  fontFamilySpec?: string;
  /** font-style: oblique の角度 (italic のときは undefined) */
  obliqueAngle?: number;
  fontVariationSettings?: Record<string, number>;
  fontOpticalSizing?: 'auto' | 'none';
  fontOpticalSizeUnit?: 'pt' | 'px';
  textAutospace?: boolean;
  textAutospaceWidth?: number;
  textAutospaceIdeographicSpace?: boolean;
  justifyPunctuationAh?: boolean;
  punctuationSqueeze?: boolean;
  lineSqueezeMax?: number;
  noSpaceSqueeze?: boolean;
  ambiguousWideBreak?: boolean;
  textJustifyTrim?: TextJustifyTrim;
  wordSqueezeJustifiedOnly?: boolean;
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
  lineBreakAutoAh?: boolean;
  punctuationSpacing?: number;
  lineStackingStrategy?: 'max-height' | 'line-height' | 'font-height';
  xslLineStacking?: boolean;
  xslLetterSpacing?: boolean;
  keepLineEndSpace?: boolean;
  collapseSpaces?: boolean;
  boxLineHalfLeading?: boolean;
  primaryFontMetrics?: boolean;
  inlineBoxFontMetrics?: boolean;
  fontBaseline?: boolean;
  /** line-height: normal の行で、既定の書体の上下も数える (TextStyle.normalLineHeightAllFonts。ブラウザの既定のスタイル) */
  normalLineHeightAllFonts?: boolean;
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
  hyphenLimits?: HyphenLimits;
  rubyOverhang?: boolean;
  rubyAlign?: RubyAlign;
  kerning?: boolean;
  fontFeatures?: string[];
  fontPalette?: import('./colorGlyph').FontPaletteStyle;
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
  /** lineHeight が line-height: normal から決めた値か (TextStyle.lineHeightNormal) */
  lineHeightNormal?: boolean;
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
  lastLineEndIndent?: number;
  textIndentEachLine?: boolean;
  letterSpacing: number;
  wordSpacing?: number;
  /** タブ位置の間隔 (TextStyle.tabSize。CSS の tab-size) */
  tabSize?: number | { length: number };
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
  const st = resolveStyleBase(parent, n);
  // 可変フォントのある文書だけ: 書体の名前に、軸の値の指定の印を付ける
  if (parent.varAxes) applyVariation(st, parent, n);
  return st;
}

/**
 * 可変フォントの軸の値の指定を、書体の名前に付ける (CSS Fonts 4 §7.2 の、性質から決まる値)。読み込んだ書体が持つ軸のものだけを付ける:
 *  - wdth: font-stretch (font-width。§2.3) の百分率
 *  - ital・slnt: font-style の italic・oblique <角度> (§2.4)
 *  - opsz: font-optical-sizing が auto のときの、字の大きさ (§8.1。単位は fontOpticalSizeUnit: 既定は pt、HTML + CSS の文書は CSS px)
 *  - font-variation-settings (§8.2)
 * 太さ (wght) は、書体を引くときの太さで渡る
 */
function applyVariation(st: ResolvedStyle, parent: ResolvedStyle, n: BaseNode) {
  const axes = parent.varAxes!;
  st.varAxes = axes;
  const base = n.fontFamily ?? parent.fontFamilyBase ?? parent.fontFamily;
  st.fontFamilyBase = splitVariation(base)[0];
  st.obliqueAngle = n.fontStyle ? (n.fontStyle === 'italic' ? n.fontObliqueAngle : undefined) : parent.obliqueAngle;
  st.fontVariationSettings = n.fontVariationSettings ?? parent.fontVariationSettings;
  st.fontOpticalSizing = n.fontOpticalSizing ?? parent.fontOpticalSizing;
  st.fontOpticalSizeUnit = n.fontOpticalSizeUnit ?? parent.fontOpticalSizeUnit;
  const req: VariationRequest = {};
  if (st.fontStretch !== undefined && st.fontStretch !== 1 && axes.has('wdth')) req.wdth = st.fontStretch * 100;
  if (st.italic && (axes.has('ital') || axes.has('slnt'))) {
    if (st.obliqueAngle !== undefined) req.slnt = st.obliqueAngle;
    else req.ital = true;
  }
  if (st.fontOpticalSizing !== 'none' && axes.has('opsz')) req.opsz = opticalSize(st.fontSize, st.fontOpticalSizeUnit);
  if (st.fontVariationSettings) {
    for (const [tag, v] of Object.entries(st.fontVariationSettings)) if (axes.has(tag)) (req.settings ??= {})[tag] = v;
  }
  st.fontFamily = st.fontFamilyBase + variationSuffix(req);
  const marks = parent.shapeMarks;
  if (marks) {
    st.shapeMarks = marks;
    const spec: VariationRequest = { ...req };
    if (marks.wdth) delete spec.wdth;
    if (marks.ital) {
      delete spec.ital;
      delete spec.slnt;
    }
    st.fontFamilySpec = st.fontFamilyBase + variationSuffix(spec);
  }
}

function resolveStyleBase(parent: ResolvedStyle, n: BaseNode): ResolvedStyle {
  return {
    fontFamily: n.fontFamily ?? parent.fontFamily,
    fontWeight: n.fontWeight ?? parent.fontWeight,
    italic: n.fontStyle ? n.fontStyle === 'italic' : parent.italic,
    textAutospace: n.textAutospace ?? parent.textAutospace,
    textAutospaceWidth: n.textAutospaceWidth ?? parent.textAutospaceWidth,
    textAutospaceIdeographicSpace: n.textAutospaceIdeographicSpace ?? parent.textAutospaceIdeographicSpace,
    justifyPunctuationAh: n.justifyPunctuationAh ?? parent.justifyPunctuationAh,
    punctuationSqueeze: n.punctuationSqueeze ?? parent.punctuationSqueeze,
    lineSqueezeMax: n.lineSqueezeMax ?? parent.lineSqueezeMax,
    noSpaceSqueeze: n.noSpaceSqueeze ?? parent.noSpaceSqueeze,
    ambiguousWideBreak: n.ambiguousWideBreak ?? parent.ambiguousWideBreak,
    textJustifyTrim: n.textJustifyTrim ?? parent.textJustifyTrim,
    wordSqueezeJustifiedOnly: n.wordSqueezeJustifiedOnly ?? parent.wordSqueezeJustifiedOnly,
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
    lineBreakAutoAh: n.lineBreakAutoAh ?? parent.lineBreakAutoAh,
    punctuationSpacing: n.punctuationSpacing ?? parent.punctuationSpacing,
    lineStackingStrategy: n.lineStackingStrategy ?? parent.lineStackingStrategy,
    xslLineStacking: n.xslLineStacking ?? parent.xslLineStacking,
    xslLetterSpacing: n.xslLetterSpacing ?? parent.xslLetterSpacing,
    keepLineEndSpace: n.keepLineEndSpace ?? parent.keepLineEndSpace,
    collapseSpaces: n.collapseSpaces ?? parent.collapseSpaces,
    boxLineHalfLeading: n.boxLineHalfLeading ?? parent.boxLineHalfLeading,
    primaryFontMetrics: n.primaryFontMetrics ?? parent.primaryFontMetrics,
    inlineBoxFontMetrics: n.inlineBoxFontMetrics ?? parent.inlineBoxFontMetrics,
    fontBaseline: n.fontBaseline ?? parent.fontBaseline,
    normalLineHeightAllFonts: n.normalLineHeightAllFonts ?? parent.normalLineHeightAllFonts,
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
    hyphenLimits: n.hyphenLimits ?? parent.hyphenLimits,
    rubyOverhang: n.rubyOverhang ?? parent.rubyOverhang,
    rubyAlign: n.rubyAlign ?? parent.rubyAlign,
    kerning: n.kerning ?? parent.kerning,
    fontFeatures: n.fontFeatures ?? parent.fontFeatures,
    fontPalette: n.fontPalette ?? parent.fontPalette,
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
    // normal の印: 行送りを指定し直したら (比でも長さでも)、指定の側に従う
    lineHeightNormal: n.lineHeightNormal ?? (n.lineHeight !== undefined || n.lineHeightPt !== undefined ? undefined : parent.lineHeightNormal),
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
    lastLineEndIndent: n.lastLineEndIndent ?? parent.lastLineEndIndent,
    textIndentEachLine: n.textIndentEachLine ?? parent.textIndentEachLine,
    letterSpacing: n.letterSpacing ?? parent.letterSpacing,
    wordSpacing: n.wordSpacing ?? parent.wordSpacing,
    tabSize: n.tabSize ?? parent.tabSize,
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
