/**
 * layoutEngine — Logical Tree → Area Tree
 *
 * 設計の骨子:
 *  1. すべて「論理座標 (inline/block)」で組み、サイズ確定後に toArea() で物理座標へ一括変換する。
 *  2. ブロックは Frame (開いている断片) のスタックで表現し、改ページ時は
 *     全 Frame の断片を閉じて次ページへ再オープンする (box-decoration-break: slice 相当)。
 *  3. マージンは兄弟間・親子間とも CSS 2.1 の相殺規則 (max(正) + min(負)) で畳む。
 *     「保留マージン (pending)」と「未オープン Frame」を使い、最初の内容が置かれる瞬間に確定する。
 *  4. 行は widows/orphans を考慮して分割。ルビ付き行は前行との行間アキを調整する。
 *  5. 表は行単位でページをまたぎ、ヘッダ行を各ページ先頭に複製する。
 */
import { TableMarkerScope, collectTableRetrieves, extendAreas, replaceRetrieves, type GroupMarkers, type MarkerArea } from './tableMarkers';
import { msg } from './messages';
import type { LoadedFont } from './fontManager';
import { gradientSvg } from './cssGradient';
import { AREA_TREE_SCHEMA_VERSION, walkAreas, type AreaNode } from './areaTree';
import { copySourceRef, indexDocument, sourceRef } from './sourceRef';
import { applyPaintEffects, collectPaintEffects, PAINT_EFFECT_MARK, PAINT_REF_MARK, paintEffectState, type PaintEffectEntry } from './paintEffect';
import type { PaintEffect } from './types';
import { attachResources } from './areaResources';
import type {
  Annotation,
  LInline,
  Area,
  BackgroundImage,
  BookmarkArea,
  BorderRadius,
  BoxShadow,
  LinkTarget,
  RevisionBar,
  BreakKind,
  LBookmark,
  PageMasterSequenceItem,
  AreaTree,
  BlockArea,
  BlockLikeArea,
  BorderSide,
  Edges,
  GlyphArea,
  InlineArea,
  LBlock,
  FootnoteOptions,
  ConditionalPageMaster,
  LBlockContainer,
  LBlockLevel,
  LDocument,
  LFloat,
  LImage,
  LInlineContainer,
  LFootnote,
  LIndexEntry,
  LIndexPageCitationList,
  LInlineLevel,
  LMarker,
  LPageSequence,
  LRetrieveMarker,
  LRetrieveTableMarker,
  LTable,
  LTableCell,
  LTableBody,
  LTableRow,
  PageArea,
  PageMaster,
  PageMasterCondition,
  RegionBodyArea,
  SheetArea,
  WritingMode,
  BoxStyle,
  ContentSizeKeyword,
} from './types';
import { TOTAL_PAGES_ID } from './types';
import { citedPageItems, collateCitedPages, type CitedPageItem, type IndexSource } from './indexCitation';
import type { FontManager } from './fontManager';
import type { Measurer } from './measurer';
import { DEFAULT_LINE_BREAK, lineHeightOf, newNode, resolveStyle, type LNode, type ResolvedStyle } from './lnode';
import {
  borderToLogicalWidths,
  borderWidths,
  normBorder,
  normEdges,
  physPos,
  physSize,
  toLogical,
  toPhysicalEdges,
  type LEdges,
} from './geometry';
import {
  breakLines,
  breakOne,
  breakOneBoxed,
  breakOneLast,
  buildLineNode,
  adjustJapaneseSpacing,
  adjustHangulWordSpaces,
  markHyphenation,
  limitSoftHyphens,
  breakOneLimited,
  flattenInline,
  glueAfterCssLeaders,
  markLineBreaks,
  glyphNode,
  isInlineChild,
  lineMetrics,
  markBidi,
  reorderLine,
  positionLine,
  type BoxSpec,
  type InlineChild,
  type Atom,
  type PositionedLine,
  type RawLine,
  type LineMetrics,
  primaryChar,
  lineIndent,
  startsAfterForcedBreak,
  runStyleOf,
  DEFAULT_BASELINE_RATIO,
} from './inlineLayout';
import { atomAboveBelow } from './lineMetrics';
import { kernScript, lastBaseOfUnit } from './orthographicSyllable';
import { fontFeaturesBetweenUnits } from './inlineFlatten';
import { mm } from './units';
import type { AssetStore } from './assets';
import { FootnoteCtx, splitEntry, withLabel, type FootEntry } from './footnotes';
import { breakEdgeBorder, collapsedOuterHalves, collapseTableBorders, placeCells } from './tableBorders';
import { formatPageNumber } from './pageNumber';

export interface LayoutOptions {
  /** 画像 (fo:external-graphic) の登録所。自然なサイズの取得に使う */
  assets?: AssetStore;
  defaultFontFamily?: string;
  defaultFontSize?: number;
  defaultLineHeight?: number;
  /**
   * 分綴: 語 (欧文の字だけ) と言語から、ハイフンを入れてよい位置 (その字の後ろ。0 始まりの字の位置) を返す。
   * hyphenate を指定した文字にだけ使う。無ければ分綴しない
   */
  hyphenate?: (word: string, language: string | undefined, minWordLength?: number) => number[] | undefined;
  /**
   * アンテナハウス互換の字の組の詰め (カーニング): inline の要素 (::before・::after を含む) の境目では詰めず、
   * 書体の GPOS の組の表 (PairPos 形式 2) で、最初の字がクラス 0 の組も詰めない。
   * 既定は CSS Text 3 §7.3 のとおり、書式が同じなら境目をまたいで詰め、OpenType のとおりクラス 0 の組も詰める
   */
  kernAh?: boolean;
  /**
   * false で、計測の覚え (Flow.memoMeasure。幅を中身で決める箱の中身の幅・段組の釣り合わせの高さを、同じ組版の中で使い回す) を切る。
   * 覚えは組版の結果を変えない。切るのは、それを確かめるテストのためだけ (入れ子が深いと、組む回数が深さに対して指数的に増える)
   */
  measureMemo?: boolean;
}

const EPS = 0.01;

/** 回転後の外接矩形の物理サイズ (90・270 は幅と高さが入れ替わる) */
function bboxOf(n: LNode): { width: number; height: number } {
  const s = physSize(n.isize, n.bsize, n.wm);
  return n.rot === 90 || n.rot === 270 ? { width: s.height, height: s.width } : s;
}

// ───────────────────────── Box 記述 ─────────────────────────

interface BoxDesc {
  /** 元の入力の節の通し番号 (sourceRef.ts) */
  ref?: number;
  wm: WritingMode;
  marginP: Edges;
  paddingP: Edges;
  borderP: ReturnType<typeof normBorder>;
  m: LEdges;
  p: LEdges;
  bw: LEdges;
  bg?: string;
  bgImage?: BackgroundImage;
  bgClip?: 'padding-box' | 'content-box';
  /** content-box の inline / block サイズ (明示指定) */
  isizeExplicit?: number;
  bsizeExplicit?: number;
  /** block 方向の内容の寸法の最小値 (BoxStyle.minBlockSize) */
  minB?: number;
  /** block 方向の内容の寸法の最大値 (aspect-ratio の箱の max。中身で伸びても、ここで止める) */
  maxB?: number;
  /** aspect-ratio の箱 (高さは比で決まり、auto として扱わない): 最後の子の下の margin を、箱の下の margin と畳まない */
  ratioSized?: boolean;
  src?: string;
  bpStart: number;
  bpEnd: number;
  bpI: number;
  retainBs: boolean;
  /** space-after を段・ページの終わりでも捨てない (retain) */
  retainBe: boolean;
  /** 断片の切れ目でも残す、前側・後ろ側の罫線と余白の太さ (edgeRetain) */
  keepStart: { border: boolean; padding: boolean; size: number };
  keepEnd: { border: boolean; padding: boolean; size: number };
  /** space-before / space-after の優先度 */
  precBs: number | 'force';
  precBe: number | 'force';
  radius?: BorderRadius;
  diag?: LNode['diag'];
  shadow?: BoxShadow | BoxShadow[];
  /** 描くときだけの効果 (transform・opacity。BaseNode.paintEffect) */
  fx?: PaintEffect;
  /** リンク・注釈 (最初の断片にだけ付ける) */
  link?: LinkTarget;
  annot?: Annotation;
}

/**
 * アンテナハウス互換 (collapse): 行の高さの指定を、罫線の中心から中心までの高さとして、行の箱の高さの最小値に直す。
 * 互換モードでは、行の間の罫線は後ろの行のセルが全体の太さで持つ (行の箱に入る) ので、行の箱 = 指定 + 自分の上の罫線の半分 −
 * 次の行の罫線の半分。表が持つ外枠の罫線は箱に入らないので、最初と最後の行はその半分を引く。セルが持つ外周の罫線は箱に入るので、半分を足す
 * (行の境の罫線の中心が、指定の高さごとに並ぶ)
 */
function trimEdgeRowHeights(node: LTable, wm: WritingMode): LTable {
  const tb = borderToLogicalWidths(normBorder(node.border), wm);
  const groups = [node.header, node.body, node.footer].filter((g): g is NonNullable<typeof g> => !!g && g.rows.length > 0);
  const rows = groups.flatMap((g) => g.rows);
  if (!rows.length) return node;
  // 行の上・下の罫線のうち、行のセルが持つものの太さ (いちばん太いもの)
  const cellW = (r: LTableRow, side: 'bs' | 'be') => r.cells.reduce((m, c) => Math.max(m, borderToLogicalWidths(normBorder(c.border), wm)[side]), 0);
  const adj = new Map<LTableRow, number>();
  rows.forEach((r, j) => {
    if (r.minHeight === undefined) return;
    const top = j === 0 && tb.bs ? -tb.bs / 2 : cellW(r, 'bs') / 2;
    const bottom = j === rows.length - 1 ? (tb.be ? -tb.be / 2 : cellW(r, 'be') / 2) : -cellW(rows[j + 1], 'bs') / 2;
    if (top + bottom) adj.set(r, top + bottom);
  });
  if (!adj.size) return node;
  const fix = <G extends { rows: LTableRow[] }>(g: G | undefined) =>
    g ? { ...g, rows: g.rows.map((r) => (adj.has(r) ? { ...r, minHeight: Math.max(0, r.minHeight! + adj.get(r)!) } : r)) } : g;
  return { ...node, header: fix(node.header), body: fix(node.body)!, footer: fix(node.footer) };
}

/** 脚注の領域の内側の空き (FootnoteOptions.inset) を、脚注本文のブロックの左右 (縦書きは上下) の余白に足す */
/**
 * 脚注本文の先頭に番号 (label) を置いた、本文のブロックの中身と字下げ。
 *  - labelPosition: 'outside': 番号を本文の行の始め側の外にぶら下げる (CSS の ::footnote-marker の list-style-position: outside)。
 *    番号の終わりと本文の始めの間は labelGapEm (字の大きさに対する比)。番号は、幅の広い行内の箱の終わり側に揃えて置き、
 *    その幅と空きだけ、最初の行を始め側へ出す (text-indent を負に)
 *  - labelPosition: 'inside': 番号を本文の前にそのまま置く (CSS の既定。GCPM 3 §2.7)
 *  - 指定なし: 番号と本文の間に全角の空き (XSL-FO の読み込みの既定)
 */
function footBody(fo: FootnoteOptions, label: string, children: LFootnote['children'], fontSize: number, wm: WritingMode): Pick<LBlock, 'children' | 'textIndent'> {
  // 縦書きの脚注は、ぶら下げずに本文の前に置く
  if (fo.labelPosition === 'outside' && !/^vertical/.test(wm)) {
    const w = fontSize * 8;
    const gap = fontSize * (fo.labelGapEm ?? 0);
    const box: LInlineContainer = { type: 'inline-container', width: w, padding: { right: gap }, children: [{ type: 'block', textAlign: 'end', textIndent: 0, children: [label] }] };
    return { textIndent: -(w + gap), children: [box, ...children] };
  }
  if (fo.labelPosition === 'inside') return { children: [label, ...children] };
  return { children: [label, '\u3000', ...children] };
}

function footInset(fo: FootnoteOptions, wm: WritingMode): { margin?: LBlock['margin'] } {
  const ins = fo.inset;
  if (!ins?.start && !ins?.end) return {};
  return { margin: toPhysicalEdges({ bs: 0, be: 0, is: ins.start ?? 0, ie: ins.end ?? 0 }, wm) };
}

function describeBox(node: BoxStyle & { id?: string; link?: LinkTarget; annotation?: Annotation }, wm: WritingMode): BoxDesc {
  const marginP = normEdges(node.margin);
  const paddingP = normEdges(node.padding);
  const borderP = normBorder(node.border);
  const m = toLogical(marginP, wm);
  const p = toLogical(paddingP, wm);
  const bw = borderToLogicalWidths(borderP, wm);
  const horizontal = wm === 'horizontal-tb';
  const bpI = p.is + p.ie + bw.is + bw.ie;
  const bpB = p.bs + p.be + bw.bs + bw.be;
  // border-box 指定なら padding + border を差し引いて content-box 寸法にそろえる
  const adj = (v: number | undefined, d: number) => (v == null ? v : node.boxSizing === 'border-box' ? Math.max(v - d, 0) : v);
  return {
    wm,
    marginP,
    paddingP,
    borderP,
    m,
    p,
    bw,
    bg: node.backgroundColor,
    bgImage: node.backgroundImage,
    bgClip: node.backgroundClip,
    isizeExplicit: adj(horizontal ? node.width : node.height, bpI),
    bsizeExplicit: adj(horizontal ? node.height : node.width, bpB),
    minB: node.minBlockSize,
    src: node.id,
    ref: sourceRef(node),
    bpStart: p.bs + bw.bs,
    bpEnd: p.be + bw.be,
    bpI,
    retainBs: !!node.retainSpaceBefore,
    retainBe: !!node.retainSpaceAfter,
    keepStart: {
      border: !!node.edgeRetain?.borderBefore,
      padding: !!node.edgeRetain?.paddingBefore,
      size: (node.edgeRetain?.borderBefore ? bw.bs : 0) + (node.edgeRetain?.paddingBefore ? p.bs : 0),
    },
    keepEnd: {
      border: !!node.edgeRetain?.borderAfter,
      padding: !!node.edgeRetain?.paddingAfter,
      size: (node.edgeRetain?.borderAfter ? bw.be : 0) + (node.edgeRetain?.paddingAfter ? p.be : 0),
    },
    precBs: node.spaceBeforePrecedence ?? 0,
    precBe: node.spaceAfterPrecedence ?? 0,
    link: node.link,
    annot: node.annotation,
    radius: node.borderRadius,
    shadow: node.boxShadow,
    fx: (node as { paintEffect?: PaintEffect }).paintEffect,
    diag: diagonalsOf(node, wm),
  };
}

/** max-content (折り返さない幅。CSS Sizing 3 §2.1) を測るときの行の長さ (pt。どの箱でも同じ値にして、計測の覚えを使い回す) */
const MAX_CONTENT_ROOT = 1e7;

const startSide = (wm: WritingMode): keyof Edges => (wm === 'horizontal-tb' ? 'top' : wm === 'vertical-lr' ? 'left' : 'right');
const endSide = (wm: WritingMode): keyof Edges => (wm === 'horizontal-tb' ? 'bottom' : wm === 'vertical-lr' ? 'right' : 'left');

/** keepBorder: 表は断片ごとに外枠を閉じる (box-decoration-break: clone 相当) ので、罫線は残して余白だけ切る */
function cutStart(n: LNode, keepBorder = false, keepPadding = false) {
  const s = startSide(n.wm);
  if (!keepPadding) n.padding[s] = 0;
  n.margin[s] = 0;
  if (!keepBorder) delete n.border[s];
}
function cutEnd(n: LNode, keepBorder = false, keepPadding = false) {
  const s = endSide(n.wm);
  if (!keepPadding) n.padding[s] = 0;
  n.margin[s] = 0;
  if (!keepBorder) delete n.border[s];
}

// ───────────────────────── Flow (フラグメンタ) ─────────────────────────

interface Frame {
  /** id をページ番号参照 (page-number-citation) に登録済みか */
  noted?: boolean;
  desc: BoxDesc;
  node: LNode;
  opened: boolean;
  startB: number;
  contentStartB: number;
  contentI: number;
  /** 前のページの断片で使った内容の長さの合計 (ページをまたいだ箱の height・min-height の残りを求める) */
  usedB?: number;
  /** 行グリッド (アンテナハウスの baseline-grid)。null は解除、undefined は親のものを使う */
  grid?: { pitch: number; ascent: number } | null;
  /** XSL の、罫線をつぶした表の、前の側の外へ出る罫線の半分 (Flow.pendSpill)。次の段・ページへ続く断片の頭でも、同じだけ外へ出す */
  spillBs?: number;
  /** 開いたときの、前の余白を足す前の位置 (中身を置かずに次のページへ送り直すとき、ここまで戻す) */
  openFrom?: number;
  /** ページに置いた断片 (順に)。絶対配置の基準になる箱・position: relative の箱だけが集める */
  frags?: LNode[];
}

/** CSS の絶対配置の基準になるブロック (LBlock.containingBlock) と、その中で見つけた絶対配置の箱 (箱を組み終えてから組んで置く) */
interface CbAbs {
  frame: Frame;
  items: Array<{ node: LBlockContainer; st: ResolvedStyle; sy: number; frag: number }>;
}

interface FlowHost {
  assets?: AssetStore;
  hyphenate?: LayoutOptions['hyphenate'];
  kernAh?: boolean;
  warn(msg: string): void;
  /** page-number-citation: 参照先 id のページ番号 (文字列) */
  cite(refId: string, last?: boolean, format?: string, physical?: boolean, style?: ResolvedStyle, pageNumber?: number): string;
  /**
   * 索引のページ番号の並び (LIndexPageCitationList) を、字と行内の箱に置き換える。索引を使う文書 (LDocument.indexEntries がある) でだけ持つ。
   * 置き換えるものが無ければ、渡した配列をそのまま返す
   */
  index?(run: InlineChild[]): InlineChild[];
  /**
   * 索引の目印 (領域を作らない所) の id か。その id は、行を作らない並びにあるとき、いまのページではなく、次の内容が置かれるページで記録する
   * (XSL 1.1 §6.10.6: “If there are no areas returned from that formatting object then a cited page item is generated referring to the
   * page containing the first area returned from a following formatting object, if any, or the last area returned from a preceding
   * formatting object, if any.”)。範囲の終わりの印 ('end') は、いまのページ (前の内容のページ) で記録するが、ページを持たない流れ
   * (セル・コンテナの中) では記録できないので、目印と同じ道で運ぶ。索引を使う文書でだけ持つ
   */
  indexPoint?(id: string): 'point' | 'end' | undefined;
  measurer: Measurer;
  /** いま組んでいるページの番号 (text-align の inside / outside の判定用)。無ければ 1 */
  pageNumber?: () => number;
  /** 余白の解決を XSL 1.1 §4.3.1 の規則で行う (LDocument.spaceResolution) */
  xslSpace?: boolean;
  /**
   * いま組んでいる参照領域 (段をまたぐブロックの切り替わりで分かれた、本文の中の領域。XSL 1.1 §6.4.14 の span-reference-area の中の
   * normal-flow-reference-area) の先頭の、本文の領域の先頭からの block 方向の距離。絶対配置の箱 (LBlockContainer.areaOffset) の基準に使う。
   * 無ければ 0 (本文の領域の先頭)
   */
  areaOrigin?: () => number;
  /**
   * 表のセルの中身の最小・最大の長さ (measureColumns の measure) を、同じ組版の中で覚える (セル → 計測の条件 → 長さ)。
   * keep-with-next の試し組みと本番で同じ表を 2 度組むとき、列の幅の計測を繰り返さない。組版 (layoutOnce) ごとに作り直す
   */
  cellMeasure?: WeakMap<LTableCell, Map<string, number>>;
  /** 組んだ回数の数え上げ (LayoutEngine.stats。結果には効かない) */
  stats?: LayoutStats;
  /**
   * 計測・試し組みで求めた値 (中身の幅・釣り合わせた段の高さなど) を、同じ組版の中で覚える (Flow.memoMeasure)。
   * 中身の並び (子の配列) → 計測の条件 → 値。組版 (layoutOnce) ごとに作り直す (ページ番号の参照の値が変わる組み直しでは捨てる)
   */
  measureMemo?: WeakMap<object, Map<string, MeasureEntry[]>>;
  /**
   * 計測の覚え (measureMemo) のための記録。
   *  - n: 覚えてはいけない計測の数え上げ。結果のほかに跡を残すこと (試し組みの中の絶対配置の箱) が起きるたびに増やす。
   *    計測の前後で値が変わっていれば、その計測は覚えない
   *  - active・cites: 覚える計測の途中 (active > 0) に引いたページ番号の参照 (cite の引数と返した値) を、引いた順に記録する
   */
  volatile?: { n: number; active: number; cites: CiteUse[] };
}

/** 計測の中で引いたページ番号の参照: cite の引数 (ページ番号を除く) と、返した値 */
interface CiteUse {
  args: [refId: string, last: boolean | undefined, format: string | undefined, physical: boolean | undefined, style: ResolvedStyle | undefined];
  value: string;
}

/** 計測の覚えの 1 件: 値と、鍵の文字列に入れない条件 (中身に継がせるスタイル・脚注の番号付け・計測の中で引いたページ番号の参照の値) */
interface MeasureEntry {
  st: ResolvedStyle;
  foot: FootnoteCtx | undefined;
  cites: CiteUse[];
  v: unknown;
}

/**
 * 1 回の layout() の中で組んだ回数 (試し組み・計測も含む)。組版の結果には効かない。
 * 入れ子の深い文書で、同じ中身を組む回数が深さに対して指数的に増えないことを、時間でなく回数で確かめるために使う
 */
export interface LayoutStats {
  /** 作った流れ (Flow) の数。本番・計測 (幅を中身で決める箱の最小・最大の幅)・試し組み (keep・段の釣り合わせ) のすべて */
  flows: number;
  /** ブロック (layoutBlock) を組んだ回数 */
  blocks: number;
  /** 表 (layoutTable) を組んだ回数 */
  tables: number;
}

/** keep-with-next の試し組みを、次のブロックの最初の行が置かれた時点で打ち切る合図 (Flow.onPlaced が投げる) */
const KEEP_TRIAL_STOP = Symbol('keep-trial-stop');

/** 回り込み (float) の占有領域。b0..b1 は本文領域 (region) 先頭からの block 座標、size は region の端からの inline 方向の占有量 */
interface PlacedFloat {
  /** 置いた順の通し番号 (改ページで float の記録が空になっても、箱の中で置いたものを見分ける) */
  seq?: number;
  /** 段落の最初の字 (initial-letter) の箱。次の段落の最初の字は、この下に置く (CSS Inline 3 §7.9.2) */
  initialLetter?: boolean;
  side: 'start' | 'end';
  b0: number;
  b1: number;
  size: number;
}

interface FloatBox {
  box: LNode;
  side: 'start' | 'end' | 'before' | 'after' | 'center';
  outerI: number;
  outerB: number;
  m: LEdges;
  /** inside / outside の float: 次ページへ送られたら、そのページの偶奇で組み直す */
  redo?: { node: LFloat; st: ResolvedStyle };
  /** CSS の置き方: 包含ブロックの inline 始端 (本文領域の端から) と幅 */
  cb?: { off: number; width: number };
  /** XSL-FO の start・end の float を寄せる、包含ブロックの内容の範囲 (inline 方向の始まりと幅) */
  edge?: { off: number; width: number };
  /** CSS の clear: その側の先の float の下に置く */
  clear?: 'start' | 'end' | 'both';
}

interface PendingMarker {
  className: string;
  marker: LMarker;
  /** marker の親の箱 (BoxDesc)。親の最後の断片が置かれたページを PageBuild.markerEnds で探す (retrieve-position="last-ending-within-page") */
  key?: object;
  /** ページの最初の内容と一緒に記録された (ページの先頭のマーカー。retrieve の start で使う) */
  atStart?: boolean;
  /**
   * マーカーではなく、索引の目印 (領域を作らない所。LIndexEntry.point) の id。マーカーと同じ道 (セル・コンテナの中から、ページを持つ流れへ) を通り、
   * 次の内容が置かれるページで、id のページとして記録する (ページの markers には入れない)
   */
  indexId?: string;
}

/** 分けた行 (splitRow) のセルの中のマーカーと、その親の始まる断片・終わる断片の番号 */
type SplitMarkers = Array<{ marker: LMarker; start: number; end: number }>;

/** fo:retrieve-table-marker のある表の、本体の行の配置 (layoutTableRows) への差し込み (layoutTableWithMarkers) */
interface TableMarkerHooks {
  /** 行の塊を置く (見出し・フッターを、その塊までの中身で決める) */
  place(grp: LNode[], forceNewPage?: boolean): void;
  /** 組んだ行の塊と、組む間に出てきたセルの中のマーカーを控える */
  note(grp: LNode[], rows: LTableRow[], sink: PendingMarker[]): void;
  /** ページをまたいで分けた行の断片ごとのマーカーを控える */
  noteSplit(frags: LNode[], row: LTableRow, mk: SplitMarkers): void;
  /** grp で始まる続きの断片の、見出しの高さ・フッターの高さ */
  nextHeaderH(grp: LNode[]): number;
  nextReserve(grp: LNode[]): number;
  /** いまの断片に grp を入れたときの、フッターの高さ */
  reserveNow(grp: LNode[]): number;
}

/** 索引の目印を運ぶ、仮のマーカー (PendingMarker.indexId) */
const INDEX_POINT_MARKER: LMarker = { type: 'marker', className: '\u0000kumiori-index-point', children: [] };

/** id が置かれた最初と最後のページ (書式を当てた文字列) */
interface IdPages {
  first: string;
  last: string;
  /** ページ番号の数 (書式を指定した参照で使う) */
  firstN?: number;
  lastN?: number;
  /** 物理的なページ番号 (文書の最初のページを 1 とした、page-sequence・initial-page-number によらない通し番号) */
  firstP?: number;
  lastP?: number;
}


interface PageHost {
  /** id を持つ要素が現ページに置かれたことを記録する (最初に置かれたページが採用される) */
  noteId(id: string): void;
  /** 確定したページにマーカーを記録する */
  addMarkers(list: PendingMarker[]): void;
  /** marker を持つ箱が、いまのページで終わった (最後の断片を置いた) */
  markerEnd?(key: object): void;
  /** 新しいページを作り、その region-body ルートと block 方向の上限、inline 方向サイズを返す */
  /** level='page' なら段組でも次のページへ (残りの段は空のまま) */
  nextPage(level?: 'column' | 'page' | 'blank'): { root: LNode; limit: number; rootI: number; /** 次の段の先頭に空ける量 (段の頭をそろえる) */ gap?: number; /** 次の段の先頭の余白から差し引く量 (前の群の末尾の余白と相殺した分) */ credit?: number };
  /** いまの段の番号 (ページ・コンテナの中で 0 から。段組でなければ 0)。float: alternate に使う */
  columnIndex?(): number;
  /** いまの段がページの最初の段で、まだ何も置かれていないか (段組の改ページ判定用。無ければ true) */
  atPageStart?(): boolean;
  /** 次のページ (段) の block 方向の上限 (セルの中の流れのように、いまのページの上限と違うとき。無ければいまの上限と同じ) */
  nextLimit?(): number;
  /** 段・ページを離れる直前に、その段で使った block 方向の長さ (保留マージン込み。脚注があれば全長) を知らせる */
  columnEnd?(used: number): void;
}

/** 段組のページで、脚注・前方 float を「全段を貫く」ページ単位の領域に集めるための窓口 */
interface PageLevelHost {
  pageRootI(): number;
  /** at: 脚注を参照する行 (または行を含む箱) の終わりの位置 (この Flow の段の先頭から) */
  addFootnote(e: FootEntry, at: number): void;
  addBeforeFloat(f: FloatBox): void;
}

interface FlowInit {
  /** 指定すると、脚注と前方 float は Flow では置かず、ここへ渡す (置き場所の確保は呼び出し側) */
  pageLevel?: PageLevelHost;
  wm: WritingMode;
  /** 親 Flow と共有するマーカーの保留リスト (セル・コンテナ内のマーカーを親ページへ届ける) */
  markerSink?: PendingMarker[];
  /** 脚注の番号付けと本体 (ページを持つ Flow だけが脚注領域に積む) */
  footnotes?: FootnoteCtx;
  /**
   * 傍注 (アンテナハウスの axf:footnote-position="outside")。area が領域を返すページでは、脚注を下端に積まず、
   * その領域 (本文の root からの inline 方向の位置と幅) に、参照する行の高さから置く
   */
  sideNotes?: { area: () => { i: number; width: number } | undefined; layout: (fn: LFootnote, width: number) => FootEntry };
  /** ページ (段) を持つ Flow でも脚注本体を自分では積まず、行に持たせて親に任せる (コンテナの中の段組) */
  holdFootnotes?: boolean;
  /** keep-with-next の試し組みの Flow (中では、さらに試し組みをしない。入れ子の見出しで手間が指数的に増えない) */
  keepTrial?: boolean;
  /** 行・表の行・葉の箱をページに置いた直後に呼ぶ (試し組みの打ち切りに使う。例外を投げてよい) */
  onPlaced?: () => void;
  /** 下端の float (after) で段の上限を下げず、段の内容の後ろに足す (段の高さを釣り合わせた後で、float の分だけ段を伸ばす) */
  afterBelowContent?: boolean;
  /**
   * ページを持たない Flow でも、下端の float (after) を block 方向の寸法 (この値) の末尾に積む
   * (block 方向の寸法の決まったブロックコンテナ。縦書きの箱の float: after も箱の末尾に置く)
   */
  afterAt?: number;
  /** 内容の終わりの保留中の余白 (最後の子の下の余白) を、最後の段の高さに数えない (LBlockContainer.columns.discardEndMargin) */
  discardEndMargin?: boolean;
  /** 前方 float と本文の間に置く内容 (xsl-before-float-separator)。段・ページごとに 1 つだけ */
  beforeSep?: () => FootEntry | undefined;
  /** 高さの試し組みなど、副作用を持たせない用途 */
  measure?: boolean;
  /** 中身の長さを測る (表の自動レイアウト)。百分率の長さ (leader-length など) は決められないものとして扱う */
  intrinsic?: boolean;
  /** 最小の幅 (min-content) を測る。noWrapInCellMin の画像の前後で改行しない (Quirks Mode Standard §3.8) */
  minContent?: boolean;
  /** 先頭の内容の前の余白 (space-before) を捨てる (表のセルの中) */
  discardLeading?: boolean;
  /** 参照領域 (ブロックコンテナ・インラインコンテナ・表のセル) の中身: 閉じるとき、最後の行の下の半行間を line-height.conditionality に従って捨てる */
  referenceArea?: boolean;
  /** 強制改ページの後の、ページ・段の先頭の余白を捨てる (XSL。省略時は discardLeading と同じ) */
  discardAfterForced?: boolean;
  /** 前の群の末尾の余白 (使った高さに含めてある)。先頭の space-before からその分を差し引く (XSL の相殺: 大きい方) */
  initialSpace?: number;
  /**
   * 流れの直下のブロックの span (LBlock.span) が切り替わる所で、参照領域を分ける (LPageSequence.spanAreas。1 段の本文)。
   * 境では、前の領域の終わりの余白と、次の領域の先頭の余白を、参照領域の端の余白として解決する (XSL 1.1 §4.3.1)
   */
  spanAreas?: boolean;
  /** 流れの終わりを参照領域の終わりとして扱い、末尾の余白のうち、捨てる指定 (conditionality="discard") のものを使った高さに数えない (§4.3.1) */
  areaEnd?: boolean;
  rootI: number;
  root?: LNode;
  limit?: number;
  pages?: PageHost;
  abs: () => LNode[];
  /** 祖先のブロックコンテナを基準にする絶対配置の箱 (positionInContainer) を集める所と、その内容の箱の大きさ */
  localAbs?: { list: Array<{ n: LNode; node: LBlockContainer }>; w: number; h: number | undefined };
  /** ページの大きさ。body は版面 (本文の領域) の、組む向きでの大きさ (width は横、height は縦。本文の領域を回すときは回す前) */
  pageSize: () => PageSizeInfo;
  /**
   * この流れの包含ブロックの block 方向の内容の大きさ (決まっているとき。高さの決まったブロックコンテナの中身など)。
   * 中の直交する箱の、行の向きに使える長さになる (CSS Writing Modes 3 §7.3.1)
   */
  cbBlock?: number;
}

interface PageSizeInfo {
  width: number;
  height: number;
  body?: { width: number; height: number };
}

/**
 * line-height.precedence (XSL §7.16.4・§4.3.1): 同じ段落の続く行の、前の行の下の半行間と次の行の上の半行間の重ね合わせ。
 * force (既定) なら両方を足すので 0。数なら、同じ段落の行は優先度が同じなので、大きい方だけを残す (小さい方の分だけ詰める)。
 * line-stacking-strategy="line-height" では、半行間は行の矩形に含まれる (行の space ではない) ので重ね合わせない
 */
function precedenceCut(prev: LineMetrics, cur: LineMetrics, st: ResolvedStyle): number {
  const p = st.lineHeightPrecedence;
  if (p === undefined || p === 'force' || st.lineStackingStrategy === 'line-height') return 0;
  return Math.max(Math.min(prev.bottomLeading ?? prev.leading / 2, cur.topLeading ?? cur.leading / 2), 0);
}

/**
 * line-height.conditionality="discard" で、参照領域の端の行の半行間を捨てるか (XSL §7.16.4)。
 * line-stacking-strategy="line-height" では、半行間は行の矩形に含まれるので捨てない (XSL §4.5 の Note)
 */
function discardsLeading(st: ResolvedStyle): boolean {
  return !!st.lineHeightDiscard && st.lineStackingStrategy !== 'line-height';
}

/** 支柱だけの箱 (LBlock.phantom) の中身の節 → 測った block の大きさ (同じ行の支柱どうしで使い回す) */
const phantomSizes = new WeakMap<object, number>();

class Flow {
  /** まだ何も置いていない先頭の余白を捨てるか (FlowInit.discardLeading) */
  private discardLeading: boolean;
  private referenceArea: boolean;
  /** 強制改ページの後の、ページ先頭の余白も捨てるか (XSL §4.3.1: conditional な space は参照領域の先頭で捨てる。FO のフロー) */
  private discardAfterForced: boolean;
  /** 最後の段の終わりに残った余白 */
  trailingSpace = 0;
  /** FlowInit.spanAreas */
  private spanAreas: boolean;
  /** FlowInit.areaEnd */
  private areaEnd: boolean;
  /** 流れの直下の、直前のブロックが span="all" だったか (spanAreas のとき。まだ無ければ undefined) */
  private prevSpan: boolean | undefined;
  /** いまの参照領域 (span の切り替わりで分けた領域) の先頭の位置 (ページの中。ページが変われば 0) */
  areaTop = 0;
  /**
   * 保留中の余白のうち、参照領域の終わりでも残る分 (XSL 1.1 §4.3.1: 領域の終わりの conditional な余白と、その前に続く conditional な余白は
   * 捨てる。残すのは、最後の retain の余白までの並びを解決した値)。retain の space-after を足した時点の保留の値を覚える。無ければ null
   */
  private pendKeep: number | null = null;
  readonly wm: WritingMode;
  rootI: number;
  root: LNode;
  limit: number;
  readonly pages?: PageHost;
  private localAbs?: FlowInit['localAbs'];
  /** いちばん近い、絶対配置の基準になるブロック (localAbs より内側) */
  private cbAbs?: CbAbs;
  private abs: () => LNode[];
  private pageSize: () => PageSizeInfo;
  private cbBlock?: number;
  stack: Frame[] = [];
  readonly markerSink: PendingMarker[];
  private foot?: FootnoteCtx;
  private side?: FlowInit['sideNotes'];
  /** 傍注を置いたページ (root) と、そのページで最後に置いた傍注の下端 */
  private sideRoot?: LNode;
  private sideBottom = -Infinity;
  /** 脚注本体を自分の脚注領域に積むか (holdFootnotes なら持たせるだけ) */
  private ownFoot = true;
  private keepTrial = false;
  private onPlaced?: () => void;
  /** 行・表の行グループ・葉の箱をページに置いた (ページに内容がある。試し組みの打ち切りの合図もここで) */
  private notePlaced() {
    this.pageHasContent = true;
    this.onPlaced?.();
  }
  /**
   * 試し組みの Flow に渡す、絶対配置の箱の置き場: 置き場は本番と同じだが、試し組みが箱を置いたことを数える
   * (跡を残す試し組みの結果は覚えない。FlowHost.volatile)
   */
  private trialAbs = (): LNode[] => {
    if (this.host.volatile) this.host.volatile.n++;
    return this.abs();
  };
  private measureOnly: boolean;
  /** 組んでいる表のセルの間隔 (layoutTable が設定) */
  private spacing?: { i: number; b: number };
  /** 組んでいる表の LTable.rowspanMiddleAh (アンテナハウス互換) */
  private rowspanMiddleAh = false;
  /**
   * 組んでいる collapse の表の、改ページの境目で罫線を決め直すための線 (layoutTable が設定)。
   * header: 続きのページで表ヘッダーを繰り返すか、compat: 内側の線を後ろのセルが全体の太さで持つ組み方 (collapseToAfterCell) か
   */
  private tableBreak?: { header: boolean; compat: boolean } & NonNullable<LTable['breakBorders']>;
  /** 組んだ行のセルの、占める列 (c から cs 列) と、改ページの境目で使う前側・後ろ側の線 (LTableCell.breakEdges) */
  private cellCols = new WeakMap<LNode, { c: number; cs: number; before?: BorderSide; after?: BorderSide }>();
  private intrinsic: boolean;
  private minContent: boolean;
  /** 現ページの脚注領域 */
  private footnotes: FootEntry[] = [];
  private footReserve = 0;
  /** 次ページへ続く脚注 (長すぎて分割した残り) */
  private carry: FootEntry[] = [];
  /** 現ページの回り込み・ページ先頭の float */
  private floats: PlacedFloat[] = [];
  /** 次の行内の並びの、最初の行の字下げを掛けない (段落の最初の字 (initial-letter) の箱に移した) */
  private skipIndent = false;
  private floatSeq = 0;
  private beforeNodes = new Set<LNode>();
  private beforeUsed = 0;
  /**
   * 段・ページの下端に積む float (float: after)。置いた分だけ block 方向の上限 (limit) を上げ (本文の判定がすべて避ける)、
   * 段・ページを離れるときに元の上限 (afterBase) に戻して、脚注の領域の上に積む
   */
  private afterFloats: FloatBox[] = [];
  private afterUsed = 0;
  private afterBase?: number;
  /** afterBelowContent: 段の内容の後ろに積んだ下端の float の下端 */
  private afterBelow = false;
  /** ページを持たない Flow の、下端の float を積む末尾 (FlowInit.afterAt) */
  private afterAt?: number;
  /** afterAt の末尾に積んだ float の範囲 (本文が避ける回り込みの範囲) */
  private afterBand?: PlacedFloat;
  private afterEnd = 0;
  /** afterBelowContent で下端の float を置いたか */
  afterBelowUsed = false;
  /** 空のページ (段) で、widows / orphans を守れずに段落を分けたか */
  brokeKeep = false;
  /** widows / orphans を守れずに分けた最初のページ (段) の番号 (0 始まり。無ければ Infinity) */
  brokeKeepPage = Infinity;
  /** これまでに改ページ (改段) した回数 */
  private breakCount = 0;
  /** 前方 (top) の float を、入らないので次のページ (段) へ送ったか */
  deferredBefore = false;
  private discardEndMargin = false;
  private beforeSepNode?: LNode;
  /** このページで最後に置いた傍注の下端 (次の傍注はその下へ) */
  private marginalBottom = 0;
  private beforeSepH = 0;
  private beforeSep?: () => FootEntry | undefined;
  private pageLevel?: PageLevelHost;
  /** 現ページに入らず、次ページの先頭へ送る float */
  private deferredFloats: FloatBox[] = [];
  cursor = 0;
  private pendPos = 0;
  private pendNeg = 0;
  /** 保留中の余白 (同じ優先度) の、符号も含めた最大 (XSL の解決) */
  private pendAny: number | null = null;
  /** 保留中の余白の優先度 (この値より低い余白は捨てる) */
  private pendPrec = 0;
  /** force の余白の合計 (無ければ null) */
  private pendForce: number | null = null;
  /** 余白の下限 (回り込みの下まで進める clear など) */
  /** 保留中の余白の下限 (回り込みの下までの空き)。無ければ -Infinity (負の余白をそのまま使う。CSS 2.1 §8.3.1) */
  private pendMin = -Infinity;
  /** 相殺 (畳み込み) の後に足す量 (collapse の表の外枠の罫線が、余白の側へはみ出す分を引く) */
  private pendAdjust = 0;
  /**
   * 余白の量に関わらず、次の箱を block 方向の前へずらす量 (0 以下)。XSL の、罫線をつぶした表 (border-collapse="collapse") の外側の罫線の
   * 外へ出る半分: 表の箱の端は罫線の中央にあり、外の半分は余白の領域に重なる (CSS2 §17.6.2「the other half of these two borders lies in
   * the margin area」)。余白が半分より小さくても、表の箱の位置は変わらない (罫線の外の半分が、前後の内容の側へ出る)
   */
  private pendSpill = 0;
  /** 挿入点の直上にある「空き」(前行の下側ハーフレディング + 保留マージン)。ルビの張り出しに使う */
  private adjacent = 0;
  private pageHasContent = false;
  private pageItems = 0;
  private headerOnly = false;
  private breakNext: BreakKind | null = null;

  constructor(private host: FlowHost, init: FlowInit) {
    if (host.stats) host.stats.flows++;
    this.wm = init.wm;
    this.rootI = init.rootI;
    this.limit = init.limit ?? Infinity;
    this.markerSink = init.markerSink ?? [];
    this.foot = init.footnotes;
    this.side = init.sideNotes;
    this.ownFoot = !init.holdFootnotes;
    this.keepTrial = !!init.keepTrial;
    this.onPlaced = init.onPlaced;
    this.afterBelow = !!init.afterBelowContent;
    this.afterAt = init.afterAt;
    this.discardEndMargin = !!init.discardEndMargin;
    this.beforeSep = init.beforeSep;
    this.pageLevel = init.pageLevel;
    this.measureOnly = !!init.measure;
    this.discardLeading = !!init.discardLeading;
    this.referenceArea = !!init.referenceArea;
    this.intrinsic = !!init.intrinsic;
    this.minContent = !!init.minContent;
    this.discardAfterForced = !!(init.discardAfterForced ?? init.discardLeading);
    this.spanAreas = !!init.spanAreas;
    this.areaEnd = !!init.areaEnd;
    if (init.initialSpace) this.pendAdjust = -init.initialSpace;
    this.localAbs = init.localAbs;
    this.pages = init.pages;
    this.abs = init.abs;
    this.pageSize = init.pageSize;
    this.cbBlock = init.cbBlock;
    this.root = init.root ?? newNode('block', init.wm, { isize: init.rootI });
  }

  get paginating() {
    return !!this.pages && Number.isFinite(this.limit);
  }

  /** 脚注領域を除いた、現ページで本文が使える block 方向の上限 */
  private get room() {
    // 開いている箱のうち、断片の末尾にも罫線・余白を残すもの (conditionality="retain") の分を空けておく
    let keep = 0;
    for (const f of this.stack) if (f.opened) keep += f.desc.keepEnd.size;
    return this.limit - this.footReserve - keep;
  }

  /** 下端の float を、脚注の領域の上に書いた順に積む (段・ページを離れるとき) */
  private emitAfterFloats() {
    if (!this.afterFloats.length || this.afterBase === undefined) return;
    this.limit = this.afterBase;
    let y = this.afterBelow ? Math.max(this.cursor + this.pendingValue(), this.floatBottom('both')) : this.limit - this.footReserve - this.afterUsed;
    for (const f of this.afterFloats) {
      f.box.b = y + f.m.bs;
      y += f.outerB;
    }
    if (this.afterBelow) this.afterEnd = y;
    this.afterFloats = [];
    this.afterUsed = 0;
    this.afterBase = undefined;
  }

  // ── 脚注 ──

  private footCost(entries: FootEntry[], existing: number): number {
    if (this.pageLevel) return 0;
    let r = 0;
    let prev: FootEntry | undefined = existing > 0 ? this.footnotes[existing - 1] : undefined;
    for (const e of entries) {
      r += this.foot!.gapAfter(prev) + e.height;
      prev = e;
    }
    return r;
  }

  /** 脚注を現ページの脚注領域へ積む。収まらなければ行単位で分割し、残りを次ページへ続ける */
  private pushFootnote(e: FootEntry, cap = Infinity) {
    if (this.pageLevel) {
      this.pageLevel.addFootnote(e, this.cursor);
      return;
    }
    const first = this.footnotes.length === 0;
    const lead = this.foot!.gapAfter(first ? undefined : this.footnotes[this.footnotes.length - 1]);
    const free = Math.min(this.limit - this.cursor - this.footReserve, cap - this.footReserve);
    if (lead + e.height <= free + EPS) {
      this.footnotes.push(e);
      this.footReserve += lead + e.height;
      return;
    }
    const sp = splitEntry(e, free - lead);
    if (sp) {
      this.footnotes.push(sp.head);
      this.footReserve += lead + sp.head.height;
      this.carry.push(sp.rest);
    } else {
      this.host.warn('脚注がページに収まらないため溢れます');
      this.footnotes.push(e);
      this.footReserve += lead + e.height;
    }
  }

  /** 脚注本体を組む幅: 脚注領域の幅 (段組でページの末尾に集めるときはページの本文領域の幅、それ以外はこの流れの幅) */
  private footWidth(): number {
    return this.pageLevel ? this.pageLevel.pageRootI() : this.rootI;
  }

  /** このページで傍注を使うときの領域 */
  private sideArea(): { i: number; width: number } | undefined {
    return this.side && !this.pageLevel && !this.measureOnly && this.wm === 'horizontal-tb' ? this.side.area() : undefined;
  }

  /**
   * 脚注を置く: 傍注の領域があれば、参照する行の上端 (top。root の block 方向の位置) から傍注として置き
   * (前の傍注に重なるなら、その下へ送る)、無ければページ末尾の脚注領域へ積む
   */
  private addFootnote(fn: LFootnote, top: number) {
    const area = this.sideArea();
    if (!area) {
      this.pushFootnote(this.foot!.entry(fn, this.footWidth()));
      return;
    }
    if (this.sideRoot !== this.root) {
      this.sideRoot = this.root;
      this.sideBottom = -Infinity;
    }
    const e = this.side!.layout(fn, area.width);
    e.node.i = area.i;
    e.node.b = Math.max(top, this.sideBottom);
    this.root.children.push(e.node);
    this.noteIds(e.node);
    this.sideBottom = e.node.b + e.height;
  }

  /** 現ページの脚注領域を region-body の末尾 (横書き=下端 / 縦書き=左端) に出力する */
  private emitFootnotes() {
    if (!this.foot || !this.footnotes.length) return;
    const area = newNode('block', this.wm, { isize: this.rootI, bsize: this.footReserve, i: 0, b: this.limit - this.footReserve });
    const sep = this.foot.makeSeparator(this.wm, this.rootI);
    let b = this.foot.sepHeight;
    if (sep) area.children.push(sep);
    this.footnotes.forEach((e, k) => {
      if (k > 0) b += this.foot!.gapAfter(this.footnotes[k - 1]);
      e.node.i = 0;
      e.node.b = b;
      area.children.push(e.node);
      b += e.height;
    });
    this.root.children.push(area);
    this.noteIds(area);
    this.footnotes = [];
    this.footReserve = 0;
  }

  // ── float ──

  /** 現在の Frame の content-box が、本文領域 (region) の inline 始端から何 pt の位置にあるか */
  private contentIOffset(): number {
    return this.stack.reduce((a, f) => a + f.desc.m.is + f.desc.bw.is + f.desc.p.is, 0);
  }

  /**
   * block 区間 [y0, y1) の行が使える inline 範囲。
   * 重なる float があれば、start 側は float の占有量だけ始端を進め、end 側はその分だけ終端を縮める。
   */
  private lineRange(y0: number, y1: number) {
    const off = this.contentIOffset();
    let left = off;
    let right = off + this.contentI();
    let clearTo = y0;
    let intruded = false;
    for (const f of this.floats) {
      if (f.b1 <= y0 + EPS || f.b0 >= y1 - EPS) continue;
      intruded = true;
      clearTo = Math.max(clearTo, f.b1);
      if (f.side === 'start') left = Math.max(left, f.size);
      else right = Math.min(right, this.rootI - f.size);
    }
    return { shift: left - off, width: Math.max(right - left, 0), intruded, clearTo };
  }

  private floatBottom(side: 'start' | 'end' | 'both'): number {
    return this.floats.filter((f) => side === 'both' || f.side === side).reduce((a, f) => Math.max(a, f.b1), 0);
  }

  private placeFloat(node: LFloat, ps: ResolvedStyle) {
    const st = resolveStyle(ps, node);
    const ortho = st.wm !== this.wm && (st.wm === 'horizontal-tb') !== (this.wm === 'horizontal-tb');
    if (node.marginal && node.float !== 'before' && !ortho) return this.placeMarginal(node, st);
    const original = node;
    if (node.float === 'inside' || node.float === 'outside') {
      // 綴じ側・小口側は、組むページの偶奇で start / end に読み替える
      const even = (this.host.pageNumber?.() ?? 1) % 2 === 0;
      // 綴じ側は、奇数ページ (右ページ) では左、偶数ページでは右。縦書きでは左右は block 方向なので、段の先頭・末尾の float にする
      // (vertical-rl は右が block-start。偶数ページの float: inside は箱の右端、outside は左端に置く)
      const left = (node.float === 'inside') !== even;
      const side = this.wm === 'horizontal-tb' ? (left ? 'start' : 'end') : (left === (this.wm === 'vertical-lr')) ? 'before' : 'after';
      node = { ...node, float: side };
    } else if (node.float === 'alternate') {
      // 最初の段では end、ほかの段では start (段の間に寄せる)
      node = { ...node, float: (this.pages?.columnIndex?.() ?? 0) === 0 ? 'end' : 'start' };
    }
    // 段落の最初の字 (initial-letter。CSS Inline 3 §7): 字の大きさと箱の大きさを、行の数と書体の値から決めて、回り込みの箱として置く
    const il = node.initialLetter && !ortho && !this.host.xslSpace ? this.initialLetterBox(node, st) : undefined;
    if (il) {
      node = il.node;
      // 前の段落の最初の字の箱が残っていれば、その下に置く (§7.9.2: 最初の字で始まるブロックは、前のブロックの最初の字を避ける)
      const prev = this.floats.filter((p) => p.initialLetter).reduce((a, p) => Math.max(a, p.b1), 0);
      if (prev > this.cursor + this.pendingValue()) this.pendMin = Math.max(this.pendMin, prev - this.cursor);
      // 字の箱がページ・段の残りに入らなければ、先に次へ送る (字だけを次のページへ送らない)
      if (this.paginating && this.pageHasContent && this.cursor + this.pendingValue() + il.outerB + this.footReserve > this.room + EPS) this.breakPage();
    }
    const desc = describeBox(node, this.wm);
    const horizontal = this.wm === 'horizontal-tb';
    const src: LBlockContainer = { ...node, type: 'block-container', absolutePosition: false };
    if (ortho) {
      // 親と直交する書字方向の float (横書きの中の縦書きなど): 自身の行の長さ (親の block 方向) の既定は、ページの残りの高さ
      const own = describeBox(node, st.wm);
      if (own.isizeExplicit == null) {
        // CSS の float は、使える長さ (orthogonalAvail。Writing Modes 3 §7.3.1) の中の fit-content (§7.3.2・CSS 2.1 §10.3.5 の shrink-to-fit を
        // 行の向きに当てる。§7.2)。max-height (縦書き)・max-width (横書き) は使える長さの上限。XSL-FO は従来どおり、ページの残り
        const css = !!node.cssPlacement && !this.host.xslSpace;
        const rest = css ? this.orthogonalAvail(st.wm) : Number.isFinite(this.limit) ? this.limit - this.cursor - this.pendingValue() - this.footReserve : this.rootI;
        src.boxSizing = 'content-box';
        let len = Math.max(rest - own.m.is - own.m.ie - own.bpI, st.fontSize * 2);
        if (css) {
          if (node.maxInlineSize !== undefined) len = Math.min(len, node.maxInlineSize);
          len = this.fitContent(len, (rootI, min) => this.intrinsicWidth(node.children, st, rootI, min));
          // min-height (縦書き)・min-width (横書き) は下限 (上限より強い。CSS 2.1 §10.7)
          if (node.minInlineSize !== undefined) len = Math.max(len, node.minInlineSize);
        }
        if (horizontal) src.height = len;
        else src.width = len;
        // 幅を測るときに使った box-sizing (border-box) の指定は、もう一方の向きの大きさにも効いているので、内容の大きさに直す
        if (node.boxSizing === 'border-box' && own.bsizeExplicit != null) {
          if (horizontal) src.width = own.bsizeExplicit;
          else src.height = own.bsizeExplicit;
        }
      }
    } else if (desc.isizeExplicit == null && node.cssPlacement && (node.float === 'start' || node.float === 'end')) {
      // CSS: 幅の指定の無い float は shrink-to-fit (CSS 2.1 §10.3.5): min(max(最小の内容の幅, 使える幅), 内容の幅)
      const availC = Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0);
      const widthAt = (rootI: number) => this.intrinsicWidth(node.children, st, rootI);
      const pref = widthAt(Math.max(availC, 1) * 100);
      const minC = pref <= availC ? pref : widthAt(1);
      let content = Math.min(Math.max(minC, availC), pref);
      // min-width・max-width (下限が勝つ)
      if (node.maxWidth !== undefined) content = Math.min(content, node.maxWidth);
      if (node.minWidth !== undefined) content = Math.max(content, node.minWidth);
      src.boxSizing = 'content-box';
      if (horizontal) src.width = content;
      else src.height = content;
    } else if (desc.isizeExplicit == null) {
      // 幅の既定: 回り込みは中身の長さ (最も長い行。本文領域の半分まで。画像とキャプションの float など)、
      // 中身が長い (文章の) ときは本文領域の 1/3。before は全幅
      const fullWidth = node.float === 'before' || node.float === 'after';
      let outer = node.float === 'before' ? (this.pageLevel?.pageRootI() ?? this.rootI) : fullWidth ? this.rootI : this.rootI / 3;
      if (!fullWidth) {
        const len = Math.max(this.rootI - desc.m.is - desc.m.ie - desc.bpI, 1);
        // 中の要素の罫線・余白は maxLineLength に含まれる
        const longest = this.memoMeasure('float', node.children, st, [len], undefined, () => maxLineLength(this.measureSub(node.children, st, len).sub.root)) + desc.m.is + desc.m.ie + desc.bpI;
        if (longest <= this.rootI / 2) outer = longest;
      }
      const content = Math.max(outer - desc.m.is - desc.m.ie - desc.bpI, 0);
      src.boxSizing = 'content-box';
      if (horizontal) src.width = content;
      else src.height = content;
    }
    // float の内容の末尾の space-after は、領域の端なので捨てる (前方 float を並べても隙間が空かない)
    const box = this.buildContainer(src, st, undefined, undefined, true);
    // アンカーを中身として扱う (XSL-FO): 保留中の余白をここで確定し、後ろの余白と相殺させない
    // (直前のブロックの break-after が保留中なら、先に改ページする。行を置くときと同じ順)
    if (original.anchorIsContent && (node.float === 'start' || node.float === 'end')) {
      this.applyPendingBreak();
      this.flush();
    }
    // 親の向きでの大きさ (直交する書字方向の箱は、箱自身の isize / bsize と軸が入れ替わる)
    const ph = bboxOf(box);
    const inl = horizontal ? ph.width : ph.height;
    const blk = horizontal ? ph.height : ph.width;
    this.anchorFloat({
      box,
      side: node.float as 'start' | 'end' | 'before' | 'after' | 'center',
      outerI: inl + desc.m.is + desc.m.ie,
      outerB: blk + desc.m.bs + desc.m.be,
      m: desc.m,
      ...(original.float === 'inside' || original.float === 'outside' || original.float === 'alternate' ? { redo: { node: original, st: ps } } : {}),
      ...(node.cssPlacement && (node.float === 'start' || node.float === 'end') ? { cb: { off: this.contentIOffset(), width: this.contentI() } } : {}),
      // XSL-FO の start・end の float も、包含ブロック (アンカーのあるブロック) の内容の端に寄せる (XSL 1.1 §6.12.2 は CSS 2.1 §9.5 の規則を使う)
      ...(!node.cssPlacement && (node.float === 'start' || node.float === 'end') ? { edge: { off: this.contentIOffset(), width: this.contentI() } } : {}),
      ...(node.cssPlacement && node.clear ? { clear: node.clear } : {}),
    });
    if (il) {
      const placed = this.floats[this.floats.length - 1];
      if (placed && placed.b1 - placed.b0 > EPS) {
        placed.initialLetter = true;
        // 字が最初の行より上へ突き出す分 (沈める行の数より大きい字) と、箱の上の余白・枠の分だけ、最初の行を下げる
        // (§7.6.1: 字の箱の上端は、包含ブロックの内容の上端より下。最初の行とその後の内容を、その分だけ先へ送る)
        if (il.raise > EPS) this.pendMin = Math.max(this.pendMin, placed.b0 + il.raise - this.cursor);
        // 最初の行の字下げは、字の箱ごと行を下げる (§7.8.2)。字の箱の余白に移したので、続く行内の並びには掛けない
        if (il.indent) this.skipIndent = true;
      }
    }
  }

  /**
   * 段落の最初の字 (initial-letter。CSS Inline 3 §7) の箱を作る: 字の大きさ・箱の大きさ・箱の中の字の位置を決めた float の節を返す。
   *  - まわりの文字の、合わせる 2 つの位置 (上と下。initial-letter-align。§7.4) を、最初の行の上端からの距離で求める。行の高さは包含ブロックの
   *    line-height (§7.5.3: 行の中身による行の高さの違いは数えない)、字の枠 (em の箱) は行の中央、基線は字の枠の上端から書体の値だけ下:
   *    alphabetic = 最初の行の大文字の高さと、N 行目の欧文の基線。ideographic = 最初の行の字の枠の上端と、N 行目の字の枠の下端
   *    (ideographic-ink の位置は、字の枠で代える)。leading = 最初の行の上端と、N 行目の下端
   *  - 字の側の 2 つの位置は、中身で決める (§7.4): 漢字・仮名・ハングル・彝文字を含めば字の枠の上端と下端、ほかは大文字の高さと基線。
   *    縦書きでは、どちらも字の枠 (行の進む向きに直交する向きの、字の枠の両端)
   *  - 字の大きさは、字の側の 2 つの位置の間が、まわりの 2 つの位置の間と同じになる大きさ (§7.5.3)
   *  - 箱は、max(N, S) 行分の高さ。N が S より大きければ、(N − S) 行分だけ最初の行より上へ出る (raise。§7.6.1)。S が大きければ、上を合わせる
   * 大文字の高さは、書体の OS/2 の値。無ければ 0.66em (付録 A.2 の代わりの値)
   */
  private initialLetterBox(node: LFloat, st: ResolvedStyle): { node: LFloat; raise: number; outerB: number; indent: boolean } | undefined {
    const inner = node.children[0];
    if (!node.initialLetter || typeof inner !== 'object' || inner.type !== 'block') return undefined;
    const { size: N, sink: S } = node.initialLetter;
    const text = inner.children.filter((k): k is string => typeof k === 'string').join('');
    if (!text) return undefined;
    const LH = lineHeightOf(st);
    const f = st.fontSize;
    const stL = resolveStyle(st, inner);
    const vertical = this.wm !== 'horizontal-tb';
    const fontOf = (ch: string, s: ResolvedStyle) => this.host.measurer.glyph(ch, { fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontSize: s.fontSize, stretch: s.fontStretch }, 'horizontal-tb').font;
    const capOf = (font: LoadedFont) => {
      const cap = ((font.fk as unknown as { capHeight?: number }).capHeight ?? 0) / font.unitsPerEm;
      return cap > 0.2 && cap < 1 ? cap : 0.66;
    };
    const core = /[\p{L}\p{N}\p{S}]/u.exec(text)?.[0] ?? text[0];
    const fontL = fontOf(core, stL);
    const fontP = fontOf('H', st);
    // まわりの文字の位置 (最初の行の上端から)
    const emTop = (LH - f) / 2;
    const base = emTop + this.nominalRatio(st) * f;
    const align = vertical && node.initialLetter.align !== 'leading' ? 'ideographic' : (node.initialLetter.align ?? 'alphabetic');
    const over = align === 'leading' ? 0 : align === 'ideographic' ? emTop : base - capOf(fontP) * f;
    const under = (N - 1) * LH + (align === 'leading' ? LH : align === 'ideographic' ? emTop + f : base);
    // 字の側の位置と、字の大きさ
    const ideographic = vertical || /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Yi}]/u.test(text);
    const capL = capOf(fontL);
    const F = Math.max((under - over) / (ideographic ? 1 : capL), 0.01);
    // 字の枠の上端 (箱の内容の上端から)
    const top = ideographic ? over : over - (fontL.baselineRatio - capL) * F;
    const lines = Math.max(N, S);
    const d = describeBox(node, this.wm);
    const horizontal = !vertical;
    // 最初の行の字下げ (§7.8.2): 字の箱ごと下げる (箱の行頭の側の余白に足す)
    const first = st.textIndent > 0 && !st.textIndentHanging ? st.textIndent : 0;
    const marginP = first ? toPhysicalEdges({ ...d.m, is: d.m.is + first }, this.wm) : node.margin;
    const sized: LFloat = {
      ...node,
      initialLetter: undefined,
      ...(first ? { margin: marginP } : {}),
      boxSizing: node.width !== undefined && horizontal ? node.boxSizing : 'content-box',
      [horizontal ? 'height' : 'width']: lines * LH + (node.boxSizing === 'border-box' && node.width !== undefined && horizontal ? d.bpStart + d.bpEnd : 0),
      children: [{ ...inner, fontSize: F, lineHeight: 1, lineHeightPt: F, noStrut: undefined, margin: toPhysicalEdges({ bs: top, be: 0, is: 0, ie: 0 }, this.wm) } as LBlock],
    };
    const raise = Math.max(N - S, 0) * LH + d.m.bs + d.bpStart;
    // ページ・段の残りに入るかは、字の箱と、最初の行から orphans の行までで確かめる (行だけが次のページへ送られて、字が残らないように)
    const need = Math.max(lines * LH + d.m.bs + d.m.be + d.bpStart + d.bpEnd, raise + (st.orphans ?? 2) * LH);
    return { node: sized, raise, outerB: need, indent: first > 0 };
  }

  /** 傍注 (余白に置く float)。本文領域の幅で組み、いまの挿入点 (前の傍注の下) に置く。本文の行幅は変えない */
  private placeMarginal(node: LFloat, st: ResolvedStyle) {
    const horizontal = this.wm === 'horizontal-tb';
    const src: LBlockContainer = { ...node, type: 'block-container', absolutePosition: false, boxSizing: 'content-box' };
    if (horizontal) src.width = this.rootI;
    else src.height = this.rootI;
    const box = this.buildContainer(src, st, undefined, undefined, true);
    const y = Math.max(this.cursor + this.pendingValue(), this.marginalBottom);
    box.i = 0;
    box.b = y;
    this.root.children.push(box);
    this.noteIds(box);
    this.placeHeldFootnotes(box);
    this.marginalBottom = y + box.bsize;
  }

  /** float を「いまの挿入点」に固定する。現ページに入らなければ次ページの先頭へ送る */
  private anchorFloat(f: FloatBox) {
    const pv = this.pendingValue();
    if (f.side === 'before' && this.pageLevel) {
      this.pageLevel.addBeforeFloat(f);
      return;
    }
    if (f.side === 'before') {
      // 本文との間に区切りの内容があれば、最初の前方 float のときに高さを確保する (以後は float の下に動かす)
      const sep = this.beforeSepNode ? undefined : this.beforeSep?.();
      const sepH = sep?.height ?? 0;
      const need = f.outerB + sepH;
      if (this.paginating && this.pageHasContent && this.cursor + need + this.footReserve > this.limit + EPS) {
        this.deferredFloats.push(f);
        this.deferredBefore = true;
        return;
      }
      if (this.paginating && !this.pageHasContent && this.cursor + need + this.footReserve > this.limit + EPS) {
        this.host.warn('float がページより大きいため溢れます');
      }
      // すでに置かれた本文を float の高さだけ押し下げ、ページ先頭側へ積む
      this.shiftContent(need);
      f.box.i = f.m.is + Math.max(this.rootI - f.outerI, 0) / 2;
      f.box.b = this.beforeUsed - this.beforeSepH + f.m.bs;
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      this.beforeNodes.add(f.box);
      if (sep) {
        this.beforeSepNode = { ...structuredClone(sep.node), i: 0, b: 0 };
        this.beforeSepH = sepH;
        this.root.children.push(this.beforeSepNode);
        this.beforeNodes.add(this.beforeSepNode);
      }
      this.beforeUsed += need;
      if (this.beforeSepNode) this.beforeSepNode.b = this.beforeUsed - this.beforeSepH;
      return;
    }
    // ページを持たない Flow で、block 方向の寸法が決まっていれば (afterAt)、その末尾から上へ積む。後から置く本文はその範囲を避ける
    if (f.side === 'after' && !this.paginating && this.afterAt !== undefined && !this.measureOnly) {
        f.box.i = f.m.is + Math.max(this.rootI - f.outerI, 0) / 2;
      this.afterUsed += f.outerB;
      // 後に書いた float ほど末尾の端に寄せ、先に置いたものはその分 block-start 側へ動かす
      // (float: after の後の float: outside は箱の左端に置く)
      for (const g of this.afterFloats) g.box.b -= f.outerB;
      f.box.b = this.afterAt - f.outerB + f.m.bs;
      this.afterFloats.push(f);
      // 末尾に積んだ float の範囲は、後から置く本文が避ける (箱の幅いっぱいの回り込みの範囲。積むたびに広げる)
      if (!this.afterBand) {
        this.afterBand = { seq: ++this.floatSeq, side: 'start', b0: 0, b1: 0, size: this.rootI };
        this.floats.push(this.afterBand);
      }
      this.afterBand.b0 = this.afterAt - this.afterUsed;
      this.afterBand.b1 = this.afterAt;
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      return;
    }
    // after: 段・ページの下端に積む (入らなければ次の段・ページへ)。ページを持たない Flow (セルの中など) では、いまの位置に置く
    if (f.side === 'after' && this.paginating) {
      if (!this.afterBelow && this.pageHasContent && this.cursor + pv + f.outerB + this.footReserve > this.limit + EPS) {
        this.deferredFloats.push(f);
        return;
      }
      f.box.i = f.m.is + Math.max(this.rootI - f.outerI, 0) / 2;
      this.afterBase ??= this.limit;
      if (!this.afterBelow) this.limit -= f.outerB;
      else this.afterBelowUsed = true;
      this.afterUsed += f.outerB;
      this.afterFloats.push(f);
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      return;
    }
    // center (と、ページを持たない Flow の after): 段の中央に置き、その高さの範囲には本文を置かない
    if (f.side === 'center' || f.side === 'after') {
      const y = Math.max(this.cursor + pv, this.floatBottom('both'));
      if (this.paginating && this.pageHasContent && y + f.outerB + this.footReserve > this.room + this.footReserve + EPS) {
        this.deferredFloats.push(f);
        return;
      }
      f.box.i = f.m.is + Math.max(this.rootI - f.outerI, 0) / 2;
      f.box.b = y + f.m.bs;
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      this.floats.push({ seq: ++this.floatSeq, side: 'start', b0: y, b1: y + f.outerB, size: this.rootI });
      return;
    }
    // CSS: 包含ブロックの中で、先の float の横に入れば並べ、入らなければ下へずらす (CSS 2.1 §9.5.1 の規則 1〜8)
    if (f.cb && (f.side === 'start' || f.side === 'end')) {
      const { off, width } = f.cb;
      // 上端は、先の float の上端より上にしない (規則 5)
      let y = Math.max(this.cursor + pv, ...this.floats.map((p) => p.b0), f.clear ? this.floatBottom(f.clear) : 0);
      let left = off;
      let right = off + width;
      for (let guard = 0; guard < 100; guard++) {
        left = off;
        right = off + width;
        let next = Infinity;
        for (const p of this.floats) {
          if (p.b1 <= y + EPS || p.b0 >= y + f.outerB - EPS) continue;
          next = Math.min(next, p.b1);
          if (p.side === 'start') left = Math.max(left, p.size);
          else right = Math.min(right, this.rootI - p.size);
        }
        // 入る (または、ほかの float が無く包含ブロックより大きい) なら、ここに置く
        if (right - left >= f.outerI - EPS || !Number.isFinite(next)) break;
        y = next;
      }
      if (this.paginating && this.pageHasContent && y + f.outerB + this.footReserve > this.limit + EPS) {
        this.deferredFloats.push(f);
        return;
      }
      if (this.paginating && !this.pageHasContent && y + f.outerB + this.footReserve > this.limit + EPS) this.host.warn('float がページより大きいため溢れます');
      const x0 = f.side === 'start' ? left : right - f.outerI;
      f.box.i = x0 + f.m.is;
      f.box.b = y + f.m.bs;
      // CSS の回り込み: 流れの中のブロックの背景より手前に描く (CSS 2.1 §9.5。paint.ts の paintChildren)
      f.box.float = true;
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      this.floats.push({ seq: ++this.floatSeq, side: f.side, b0: y, b1: y + f.outerB, size: f.side === 'start' ? x0 + f.outerI : this.rootI - x0 });
      return;
    }
    // start / end: 同じ側の float と重ならないよう、直前の float の下へ積む
    const y = Math.max(this.cursor + pv, this.floatBottom(f.side));
    if (this.paginating && this.pageHasContent && y + f.outerB + this.footReserve > this.limit + EPS) {
      this.deferredFloats.push(f);
      return;
    }
    if (this.paginating && !this.pageHasContent && y + f.outerB + this.footReserve > this.limit + EPS) {
      this.host.warn('float がページより大きいため溢れます');
    }
    // 寄せる端: 包含ブロックの内容の端 (無ければ領域の端)
    const e0 = f.edge?.off ?? 0;
    const e1 = f.edge ? f.edge.off + f.edge.width : this.rootI;
    f.box.i = f.side === 'start' ? e0 + f.m.is : e1 - f.m.ie - (f.outerI - f.m.is - f.m.ie);
    f.box.b = y + f.m.bs;
    this.root.children.push(f.box);
    this.noteIds(f.box);
    this.placeHeldFootnotes(f.box);
    this.floats.push({ seq: ++this.floatSeq, side: f.side, b0: y, b1: y + f.outerB, size: f.side === 'start' ? e0 + f.outerI : this.rootI - e1 + f.outerI });
  }

  /** ページ先頭に float を積むため、置き済みの本文 (と回り込み・開いている Frame) を block 方向へ h だけずらす */
  private shiftContent(h: number) {
    // 末尾に積んだ下端の float (afterAt) は、末尾に固定なので動かさない
    const pinned = this.afterAt !== undefined && !this.paginating ? new Set(this.afterFloats.map((f) => f.box)) : undefined;
    for (const c of this.root.children) if (!this.beforeNodes.has(c) && !pinned?.has(c)) c.b += h;
    for (const f of this.floats) {
      if (f === this.afterBand) continue;
      f.b0 += h;
      f.b1 += h;
    }
    for (const fr of this.stack) {
      if (!fr.opened) continue;
      fr.startB += h;
      fr.contentStartB += h;
    }
    // 置き済みの傍注 (余白の float・傍注の脚注) も root.children として下げたので、次の傍注を置く位置の記録も同じだけ下げる
    this.marginalBottom += h;
    if (this.sideRoot === this.root) this.sideBottom += h;
    this.cursor += h;
  }

  // ── 基本ユーティリティ ──

  /**
   * 保留中の余白 (XSL 1.1 §4.3.1 の space の解決): force の余白があればその合計。無ければ優先度の最も高い余白のうち
   * 最大のもの (負の余白は CSS と同じく最小のものを足す)。回り込みの下までの空き (pendMin) は下限として効く
   */
  private pendingValue() {
    // XSL (§4.3.1): 同じ優先度の中で最も大きい値 (負の値どうしなら 0 に近い方)。CSS: 正の最大と負の最小の和
    const v = this.pendForce !== null ? this.pendForce : this.host.xslSpace ? (this.pendPos > 0 ? this.pendPos : this.pendAny !== null && this.pendAny < 0 ? this.pendAny : 0) : this.pendPos + this.pendNeg;
    // はみ出しの分を引いても、余白を負にはしない (もともと負の余白はそのまま)
    const adjusted = this.pendAdjust ? Math.max(v + this.pendAdjust, Math.min(v, 0)) : v;
    // 回り込みの下までの空きは、位置の下限なので、はみ出しの分を引いた後に当てる (CSS 2.1 §9.5.2: clear は、箱の上端を float の
    // 下端より下に置く。引く前に当てると、float の下端に届かず、回り込みを避ける行が同じ float に当たり続ける)
    return Math.max(adjusted, this.pendMin) + this.pendSpill;
  }
  private addMargin(m: number, prec: number | 'force' = 0) {
    if (prec === 'force') {
      this.pendForce = (this.pendForce ?? 0) + m;
      return;
    }
    if (prec > this.pendPrec) {
      // より優先度の高い余白が来た: それまでの余白は捨てる
      this.pendPrec = prec;
      this.pendPos = 0;
      this.pendNeg = 0;
      this.pendAny = null;
    } else if (prec < this.pendPrec) return;
    if (m > 0) this.pendPos = Math.max(this.pendPos, m);
    else if (m < 0) this.pendNeg = Math.min(this.pendNeg, m);
    this.pendAny = this.pendAny === null ? m : Math.max(this.pendAny, m);
  }
  /** 保留中の余白を空にする */
  private resetPending() {
    this.pendPos = 0;
    this.pendNeg = 0;
    this.pendAny = null;
    this.pendPrec = 0;
    this.pendForce = null;
    this.pendMin = -Infinity;
    this.pendAdjust = 0;
    this.pendSpill = 0;
    this.pendKeep = null;
  }
  /** retain の space-after を足した後に呼ぶ: ここまでの保留の値は、参照領域の終わりでも残る (§4.3.1) */
  private keepPending(retain: boolean) {
    if (retain) this.pendKeep = this.pendingValue();
  }
  /** 参照領域の終わりで残る、保留中の余白 (§4.3.1。回り込みの下までの空きは位置の下限なので残す) */
  private keptPending(): number {
    return Math.max(this.pendKeep ?? 0, this.pendMin, 0);
  }
  /**
   * 参照領域の境 (流れの直下のブロックの span の切り替わり。XSL 1.1 §6.4.14: span="all" のブロックと、そうでないブロックは、別の
   * span-reference-area の中の normal-flow-reference-area に入る)。参照領域は余白の並びを断つ (§4.2.5 の fence) ので、前の領域の終わりの
   * 余白は retain の分だけを残して確定し、次の領域の先頭の余白は retain の分だけを残す (§4.3.1)
   */
  private areaBoundary() {
    const keep = this.keptPending();
    this.cursor += keep;
    this.resetPending();
    this.adjacent = keep;
    this.discardLeading = true;
    this.areaTop = this.cursor;
  }
  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }
  private containerNode(): LNode {
    return this.top()?.node ?? this.root;
  }
  contentI(): number {
    return this.top()?.contentI ?? this.rootI;
  }
  private contentStartB(): number {
    return this.top()?.contentStartB ?? 0;
  }

  /** text-align の inside / outside: 組むページの偶奇で start か end かが決まるので、置く時点で行の中身を寄せる */
  private alignByPage(node: LNode, pl: PositionedLine, st: ResolvedStyle) {
    // 最後の行 (と強制改行で終わる行) は、text-align-last が inside・outside ならそれに従う (positionLine は行頭に置いている)。
    // それ以外の最後の行は、従来どおり text-align で決める
    const lastIO = pl.raw.last && (st.textAlignLast === 'inside' || st.textAlignLast === 'outside');
    const align = lastIO ? st.textAlignLast : st.textAlign;
    if (align !== 'inside' && align !== 'outside') return;
    const even = (this.host.pageNumber?.() ?? 1) % 2 === 0;
    // 綴じ側は、奇数ページが start 側・偶数ページが end 側。inside は綴じ側、outside は小口側
    const toEnd = (align === 'inside') === even;
    if (!toEnd) return;
    const free = node.isize - pl.raw.indent - pl.contentLength;
    if (free > 0.01) for (const c of node.children) c.i += pl.rtl ? -free : free; // 右から左の行では end は左
  }

  /**
   * 置いた内容 (行・表の行・ボックス・float・脚注) の中にある id を、現ページのものとして記録する (page-number-citation 用)。
   * セル・ブロックコンテナなどの内側は、ページを持たない Flow で組まれるので、置く時点でまとめて記録する
   */
  /**
   * 置こうとする箱 (表の行・コンテナ) の中の行が持つ、まだ積んでいない脚注の高さ (脚注の領域の増える分)。
   * 箱が入るかを決めるとき、箱の高さに足す (段落の行の脚注と同じ。脚注を持つリストの項目など)
   */
  private heldFootCost(nodes: LNode[]): number {
    if (!this.foot || !this.pages || !this.ownFoot || this.measureOnly || this.pageLevel || this.sideArea()) return 0;
    const fns: LFootnote[] = [];
    const walk = (n: LNode) => {
      for (const fn of n.fns ?? []) if (this.foot!.unclaimed(fn) && !fns.includes(fn)) fns.push(fn);
      for (const c of n.children) walk(c);
    };
    nodes.forEach(walk);
    return fns.length ? this.footCost(fns.map((fn) => this.foot!.entry(fn, this.footWidth())), this.footnotes.length) : 0;
  }

  /**
   * 行に脚注を持たせるか (親が、その行を含む箱をページに置くときに積む)。ページを持たない Flow (セル・コンテナの中) と、
   * 持たせるように指定された Flow (holdFootnotes。測るだけ組む inline-container の中も含む)。それ以外の測るだけの組版では持たせない
   */
  private holdsFootnotes(useFoot: boolean): boolean {
    return !useFoot && !!this.foot && (!this.measureOnly || !this.ownFoot);
  }

  /** 置いた箱 (表の行・コンテナ・float) の中の行が持つ脚注を、現ページの脚注領域へ積む。置いた後 (cursor を進めた後) に呼ぶ */
  private placeHeldFootnotes(n: LNode) {
    if (!this.foot || !this.pages || !this.ownFoot || this.measureOnly) return;
    for (const fn of n.fns ?? []) {
      if (!this.foot.claim(fn)) continue;
      this.addFootnote(fn, this.cursor - n.bsize);
      this.foot.placed(fn, this.host.pageNumber?.() ?? 0);
    }
    for (const c of n.children) this.placeHeldFootnotes(c);
  }

  private noteIds(n: LNode) {
    if (!this.pages) return;
    if (n.src) this.pages.noteId(n.src);
    for (const c of n.children) this.noteIds(c);
  }

  /** 保留中のマーカーを、いま内容が置かれるページへ記録する */
  private commitMarkers() {
    if (!this.pages) return;
    if (this.markerSink.length) this.pages.addMarkers(this.markerSink.splice(0).map((m) => (this.pageHasContent ? m : { ...m, atStart: true })));
    // 内容が置かれたので、開いている Frame の id を現ページのものとして記録する (ページ番号参照用)
    // (最初のページに加え、続きのページでも記録して「最後のページ」も分かるようにする)
    for (const f of this.stack) {
      if (f.opened && f.desc.src) {
        this.pages.noteId(f.desc.src);
        f.noted = true;
      }
    }
  }

  /** 保留マージンを確定し、未オープン Frame を開く */
  private flush() {
    // セルの先頭の余白は捨てる (retain を指定した余白は残す)
    // 先頭の余白を捨てるとき (セルの先頭・ページの先頭): retain (と force) の余白だけを残す
    // retain の余白より後ろの conditional な余白は、もう先頭ではないので捨てない (§4.3.1 の例: 10pt (discard)・4pt (retain)・5pt (discard) → 5pt)
    const retained = () => {
      let seen = false;
      let a = 0;
      for (const f of this.stack) {
        if (f.opened) continue;
        if (f.desc.retainBs) seen = true;
        if (seen) a = Math.max(a, f.desc.m.bs);
      }
      return a;
    };
    // 残す余白からも、前の群の末尾の余白と相殺した分 (pendAdjust) を差し引く (段組の span の後の、強制の段区切りの段の頭。
    // 2 段目の頭の retain の余白が、見出しの space-after と二重に空かないように)
    const keep = (r: number) => (this.pendAdjust ? Math.max(r + this.pendAdjust, Math.min(r, 0)) : r);
    // 捨てるのは余白 (XSL 1.1 §4.3.1 の conditionality="discard") だけ。回り込みの下までの空き (pendMin。clear と、float の横が
    // 狭すぎる行の送り) は位置の下限なので残す (CSS 2.1 §9.5.2: clear の箱の上の罫線の端は、前の float の下の外の端より下)
    // 表の外側の罫線の外へ出る半分 (pendSpill) は、余白ではないので、参照領域の先頭でも外へ出す (表の箱の端は罫線の中央。CSS2 §17.6.2)
    const v = this.discardLeading && this.pendForce === null ? Math.max(keep(retained()), this.pendMin) + this.pendSpill : this.pendingValue();
    this.discardLeading = false;
    const from = this.cursor;
    this.cursor += v;
    this.adjacent += v;
    this.resetPending();
    for (let k = 0; k < this.stack.length; k++) {
      const f = this.stack[k];
      if (f.opened) continue;
      const parentStart = k > 0 ? this.stack[k - 1].contentStartB : 0;
      f.startB = this.cursor;
      f.openFrom = from;
      f.node.b = this.cursor - parentStart;
      f.node.i = f.desc.m.is;
      f.contentStartB = this.cursor + f.desc.bpStart;
      this.cursor = f.contentStartB;
      if (f.desc.bpStart > 0) {
        this.adjacent = 0;
        this.edgeBlocked = true; // 上の罫線・余白 (padding) は、参照領域の端と中の行の間の積み重ねを断つ (§4.3.1)
      }
      (k > 0 ? this.stack[k - 1].node : this.root).children.push(f.node);
      f.opened = true;
      f.frags?.push(f.node);
    }
  }

  // ── Frame の開閉 ──

  private makeNode(kind: 'block' | 'table', desc: BoxDesc, isize: number): LNode {
    return newNode(kind, desc.wm, {
      isize,
      margin: { ...desc.marginP },
      padding: { ...desc.paddingP },
      border: { ...desc.borderP },
      bg: desc.bg,
      ...this.decorOf(desc),
      src: desc.src,
      ref: desc.ref,
      link: desc.link,
      annot: desc.annot,
      radius: desc.radius,
      shadow: desc.shadow,
    });
  }

  /** 箱の飾り (背景画像・斜めの罫線) を LNode へ渡す */
  private decorOf(desc: BoxDesc): { bgImage?: LNode['bgImage']; bgClip?: LNode['bgClip']; diag?: LNode['diag']; fx?: LNode['fx'] } {
    return { ...this.bgImageOf(desc), ...(desc.bgClip ? { bgClip: desc.bgClip } : {}), ...(desc.diag ? { diag: desc.diag } : {}), ...(desc.fx ? { fx: desc.fx } : {}) };
  }

  /** 背景画像の大きさを決める (指定が無ければ画像本来の大きさ。画像が無ければ描かない) */
  private bgImageOf(desc: BoxDesc): { bgImage?: LNode['bgImage'] } {
    const bi = desc.bgImage;
    if (!bi) return {};
    if (!bi.under) return this.bgLayerOf(bi);
    // 複数の背景 (Backgrounds 3 §2.1): 層ごとに大きさを決める。描けない層 (読めない画像) は、層として数えるが何も描かない (§2.3) ので除く
    const layers = [bi, ...bi.under].map((l) => this.bgLayerOf({ ...l, under: undefined }).bgImage).filter((l): l is NonNullable<LNode['bgImage']> => !!l);
    if (!layers.length) return {};
    const [top, ...rest] = layers.map(({ under: _u, ...l }) => l);
    return { bgImage: rest.length ? { ...top, under: rest } : top };
  }

  /** 背景の画像 1 枚の、画像本来の大きさを決める */
  private bgLayerOf(bi: BackgroundImage): { bgImage?: LNode['bgImage'] } {
    // グラデーションは、箱の大きさが決まってから画像にする (toArea と組版の終わり)
    if (bi.gradient) return { bgImage: { ...bi, width: bi.width ?? 0, height: bi.height ?? 0 } };
    const asset = this.host.assets?.get(bi.src);
    const nw = asset ? asset.width * 0.75 : undefined;
    const nh = asset ? asset.height * 0.75 : undefined;
    const w = bi.width ?? (bi.height !== undefined && nw && nh ? (bi.height * nw) / nh : nw);
    const h = bi.height ?? (bi.width !== undefined && nw && nh ? (bi.width * nh) / nw : nh);
    if (!w || !h) return {};
    // 百分率の大きさは、箱の大きさが決まってから (toArea で) 決める。縦横比だけ持たせておく
    // (auto のほうは percentImage で縦横比から決める)
    if (bi.widthPct !== undefined || bi.heightPct !== undefined) return { bgImage: { ...bi, width: w, height: h, aspect: nw && nh ? nw / nh : w / h } };
    return { bgImage: { ...bi, width: w, height: h } };
  }

  openFrame(desc: BoxDesc, kind: 'block' | 'table' = 'block'): Frame {
    this.applyPendingBreak();
    const parentI = this.contentI();
    const isize = desc.isizeExplicit != null ? desc.isizeExplicit + desc.bpI : parentI - desc.m.is - desc.m.ie;
    const node = this.makeNode(kind, desc, Math.max(isize, 0));
    if (this.intrinsic && desc.isizeExplicit != null && kind === 'block') node.fixedI = true;
    const frame: Frame = { desc, node, opened: false, startB: 0, contentStartB: 0, contentI: Math.max(isize - desc.bpI, 0) };
    this.addMargin(desc.m.bs, desc.precBs);
    this.stack.push(frame);
    // 上の罫線・余白 (padding) があれば、ここで箱を開く。高さの指定だけでは開かない: 最初の子の上の余白と、箱の上の余白は畳まれる
    // (CSS 2.1 §8.3.1。高さの指定が畳み込みを止めるのは、下の余白だけ)
    if (desc.bpStart > 0) this.flush();
    return frame;
  }

  closeFrame() {
    const f = this.stack[this.stack.length - 1];
    const d = f.desc;
    // marker を持つ箱の終わり: 最後の断片のページを記録する (retrieve-position="last-ending-within-page")
    if (markerParents.has(d)) this.pages?.markerEnd?.(d);
    if (!f.opened) {
      // CSS: 中身の無い箱の上下の余白は、高さが 0 か auto で、min-height が 0 なら畳まれる (CSS 2.1 §8.3.1)。
      // height: 0 は畳み、min-height のある箱は畳まない
      const blocks = this.host.xslSpace ? d.bsizeExplicit != null : (d.bsizeExplicit ?? 0) > EPS || (d.minB ?? 0) > EPS;
      if (d.bpEnd > 0 || blocks) {
        this.flush();
      } else {
        // 内容が無い (高さ 0) ブロック: 上下マージンが内部で相殺される。id は挿入点のあるページのものとして記録する
        if (d.src) this.pages?.noteId(d.src);
        this.addMargin(d.m.be, d.precBe);
        this.keepPending(d.retainBe);
        this.stack.pop();
        return;
      }
    }
    // 行グリッドを作った箱 (baseline-grid: new・root) の終わり: 最後の行の後ろに半行間は空けず、字の仮想ボディ (em の箱) の下端を
    // 内容の下端にする (アンテナハウスの baseline-grid。先頭の行の前と同じ扱い)。箱のすぐ上が、行グリッドの中で置いた行のときだけ
    if (f.grid && f.opened && this.wm === 'horizontal-tb' && this.gridTrail.trail > 0 && Math.abs(this.gridTrail.end - this.cursor) < EPS) {
      this.cursor -= this.gridTrail.trail;
      this.gridTrail = { end: -1, trail: 0 };
      this.gridPrev = { end: -1, trail: 0 };
      this.adjacent = 0;
    }
    // CSS: 高さが auto の箱の最後の子の下の margin は、箱の下の margin と畳む (CSS 2.1 §8.3.1)。min-height・max-height (aspect-ratio の
    // min・max も) が効いて、箱の高さが中身の高さと変わるときは畳まず、その margin は箱の高さに数えない (ブラウザと同じ: 下限で伸びた分・
    // 上限で切った分に吸われる)。aspect-ratio で高さの決まる箱は、中身で伸びたときも畳まない (ブラウザと同じ)。XSL-FO の block-progression-dimension.minimum の箱と、ページで分かれた箱は、margin を中に置く
    const limited = d.minB != null || d.maxB != null;
    if (limited && !this.host.xslSpace && d.bsizeExplicit == null && d.bpEnd <= 0 && f.opened && !f.node.cont && !f.usedB) {
      const content = this.cursor - f.contentStartB;
      if (d.ratioSized || (d.minB != null && content < d.minB - EPS) || (d.maxB != null && content > d.maxB + EPS)) this.resetPending();
    } else if (d.bpEnd > 0 || d.bsizeExplicit != null || limited) this.flush();
    // CSS: ページをまたぐ箱の height・min-height は、断片の長さの合計に効く (Fragmentation 3 §5.3)。
    // 残りが今のページに入らなければ、この断片をページの終わりまで伸ばして、続きを次のページに置く
    if (!this.host.xslSpace && this.paginating && (d.bsizeExplicit != null || d.minB != null)) {
      const total = d.bsizeExplicit ?? d.minB!;
      for (let guard = 0; ; guard++) {
        const need = f.contentStartB + total - (f.usedB ?? 0);
        // 断片の末尾に残す罫線・余白 (box-decoration-break: clone・conditionality="retain") の分は、内容の箱に使えない
        const pageEnd = this.room;
        if (this.cursor >= need - EPS || need + d.bpEnd <= pageEnd + d.keepEnd.size + EPS || pageEnd - f.contentStartB <= EPS) break;
        if (guard >= 50) {
          this.host.warn('高さの指定が 50 ページを超える箱は、50 ページで打ち切ります');
          break;
        }
        this.cursor = Math.max(this.cursor, pageEnd);
        this.breakPage('page');
        this.flush();
      }
      const need = f.contentStartB + total - (f.usedB ?? 0);
      // height の指定は、中身があふれても箱の高さ (後ろの内容は箱の下から置く。CSS 2.1 §10.6・§11.1)。min-height は中身で伸びる
      if (this.cursor < need || (d.bsizeExplicit != null && this.cursor > need)) {
        this.cursor = Math.max(need, f.contentStartB);
        this.adjacent = 0;
      }
    }
    // 明示の高さは内容の高さ (padding・border の内側)。終端の padding・border はその後に足す。
    // CSS は中身があふれても指定の高さ。XSL-FO は中身で伸ばす
    else if (d.bsizeExplicit != null && !f.node.cont) {
      this.cursor = this.host.xslSpace ? Math.max(this.cursor, f.contentStartB + d.bsizeExplicit) : f.contentStartB + d.bsizeExplicit;
      this.adjacent = 0;
    }
    // 高さの最小値: 分かれていない箱だけ (分かれた箱の最後の断片には当てない)
    if (d.minB != null && !f.node.cont && this.cursor < f.contentStartB + d.minB) {
      this.cursor = f.contentStartB + d.minB;
      this.adjacent = 0;
    }
    // 高さの最大値 (aspect-ratio の箱の max): 中身が多くても、ここで止める (中身ははみ出す)
    if (d.maxB != null && !f.node.cont && this.cursor > f.contentStartB + d.maxB) {
      this.cursor = f.contentStartB + d.maxB;
      this.adjacent = 0;
    }
    this.cursor += d.bpEnd;
    if (d.bpEnd > 0) this.adjacent = 0;
    f.node.bsize = this.cursor - f.startB;
    this.addMargin(d.m.be, d.precBe);
    this.keepPending(d.retainBe);
    this.stack.pop();
  }

  // ── 改ページ ──

  /** 強制改ページ (break-before / break-after)。odd-page / even-page は、偶奇が合うまで白ページを挟む */
  forceBreak(kind: BreakKind = 'page') {
    if (!this.paginating) return;
    if (kind === 'column') {
      if (this.pageHasContent) {
        this.breakPage('column');
        if (this.discardAfterForced) this.discardLeading = true;
      }
      return;
    }
    const wantOdd = kind === 'odd-page' ? true : kind === 'even-page' ? false : undefined;
    const n = this.host.pageNumber?.();
    const parityOk = (k: number) => wantOdd === undefined || n === undefined || (k % 2 === 1) === wantOdd;
    if (this.pageHasContent || !(this.pages!.atPageStart?.() ?? true)) {
      // 次のページの偶奇が合わなければ、白ページ (blank-or-not-blank="blank" のマスター) を挟む
      if (n !== undefined && !parityOk(n + 1)) this.breakPage('blank');
      this.breakPage('page');
      // CSS: 強制改ページの後の余白は残す (Fragmentation 3 §5.2)。改ページの後にある、まだ開いていない祖先の上の余白を足し直す
      // (改ページの前の要素の下の余白は捨てる)
      if (!this.host.xslSpace && !this.discardAfterForced) for (const f of this.stack) if (!f.opened) this.addMargin(f.desc.m.bs, f.desc.precBs);
      // 改ページの後の先頭の余白は捨てる (retain の余白は flush で残す)
      if (this.discardAfterForced) this.discardLeading = true;
    } else if (n !== undefined && !parityOk(n)) {
      // まだ何も置いていないページの偶奇が合わない: このページを白ページとして残し、次へ
      this.breakPage('page');
    }
  }

  private applyPendingBreak() {
    if (this.breakNext) {
      const k = this.breakNext;
      this.breakNext = null;
      this.forceBreak(k);
    }
  }

  breakPage(level: 'column' | 'page' | 'blank' = 'column') {
    if (!this.pages) return;
    this.breakCount++;
    // 開いている断片を現ページで閉じる (内側から)
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const f = this.stack[k];
      if (!f.opened) continue;
      // CSS の高さの指定のある箱 (height・min-height) は、中身が無くてもその断片を残す (高さをページにまたがって配る)
      const keepEmpty = !this.host.xslSpace && (f.desc.bsizeExplicit != null || f.desc.minB != null) && this.cursor - f.contentStartB > EPS;
      if (f.node.children.length === 0 && !keepEmpty) {
        // 中身が空の断片 (罫線・余白だけ先に出て、最初の内容が次ページへ送られた場合) は残さず、
        // 未オープンに戻す。次ページで最初の内容が置かれるとき、先頭側の罫線・余白ごと改めて開く。
        const parentNode = k > 0 ? this.stack[k - 1].node : this.root;
        const at = parentNode.children.indexOf(f.node);
        if (at >= 0) parentNode.children.splice(at, 1);
        if (f.frags) f.frags = f.frags.filter((x) => x !== f.node);
        const fresh = this.makeNode(f.node.kind as 'block' | 'table', f.desc, f.node.isize);
        fresh.colSizes = f.node.colSizes;
        f.node = fresh;
        f.opened = false;
        // 開いたときに進めた位置 (前の余白・上の罫線と padding) を戻す (段の高さに数えない)
        if (f.openFrom !== undefined && f.openFrom < this.cursor) this.cursor = f.openFrom;
        continue;
      }
      f.usedB = (f.usedB ?? 0) + Math.max(0, this.cursor - f.contentStartB);
      // 表は断片ごとに外枠を閉じる: 終端の罫線の分だけ伸ばして残す
      const clone = f.node.kind === 'table';
      if (clone) this.cursor += f.desc.bw.be;
      // 後ろ側の罫線・余白を残す指定 (conditionality="retain") なら、その分を断片の末尾に足す (場所は room で確保済み)
      const ke = clone ? undefined : f.desc.keepEnd;
      // CSS: 分かれた箱の内容の箱は、ページ (段) の残りを埋めるまで伸びる (CSS Fragmentation 3 §5.3)。背景・罫線も下端まで描く
      const fill = !clone && !this.host.xslSpace && this.paginating ? Math.max(this.room - f.startB, 0) : 0;
      f.node.bsize = Math.max(this.cursor - f.startB, fill, 0) + (ke?.size ?? 0);
      // 残した罫線・余白の分は、外側の箱の中身の長さに数える (入れ子の箱がどちらも残すとき、外側の箱が内側の箱の末尾まで包む)
      if (ke?.size) this.cursor = f.startB + f.node.bsize;
      f.node.contNext = true;
      cutEnd(f.node, clone || !!ke?.border, !!ke?.padding);
    }
    this.emitAfterFloats();
    this.reportColumnEnd(true);
    this.emitFootnotes();
    const np = this.pages.nextPage(level);
    this.root = np.root;
    this.limit = np.limit;
    const gapTop = np.gap ?? 0;
    if (Math.abs(np.rootI - this.rootI) > EPS) {
      // 本文領域の inline 方向の大きさが違うページマスター: 開いている箱の幅を、新しいページの幅から求め直す (幅の指定がある箱はそのまま)
      this.rootI = np.rootI;
      let parentI = this.rootI;
      for (const f of this.stack) {
        if (f.desc.isizeExplicit == null) f.contentI = Math.max(parentI - f.desc.m.is - f.desc.m.ie - f.desc.bpI, 0);
        parentI = f.contentI;
      }
    }
    this.cursor = 0;
    this.resetPending();
    this.adjacent = 0;
    // space-before.conditionality="retain" の未オープンのブロックは、段・ページの先頭でも余白を残す
    for (const f of this.stack) if (!f.opened && f.desc.retainBs) this.pendPos = Math.max(this.pendPos, f.desc.m.bs);
    this.pendPos = Math.max(this.pendPos, gapTop);
    if (np.credit) this.pendAdjust = -np.credit;
    this.areaTop = 0;
    this.pageHasContent = false;
    this.pageItems = 0;
    this.refStartItems = -1; // 参照領域の途中でページ・段が変わったら、その先頭はページ・段の先頭として扱う
    this.edgeBlocked = false;
    this.headerOnly = false;
    this.floats = [];
    this.beforeNodes = new Set();
    this.beforeUsed = 0;
    this.afterFloats = [];
    this.afterUsed = 0;
    this.afterBase = undefined;
    this.beforeSepNode = undefined;
    this.beforeSepH = 0;
    this.marginalBottom = 0;
    // 前ページから続く脚注は、新ページの脚注領域の先頭に置く (本文用に最低 4 割は残す)。
    // 偶奇合わせの白ページ (blank) には置かない (§7.27.1: 白ページは flow の内容を置かないページ。次のページへ持ち越す)
    if (level !== 'blank') for (const e of this.carry.splice(0)) this.pushFootnote(e, this.limit * 0.6);
    // 次ページで再オープン (外側から)
    let parent: LNode = this.root;
    let cur = 0;
    let parentContent = 0;
    for (const f of this.stack) {
      if (!f.opened) continue;
      const old = f.node;
      const node = newNode(old.kind as 'block' | 'table', old.wm, {
        isize: f.desc.isizeExplicit != null || old.kind === 'table' ? old.isize : f.contentI + f.desc.bpI,
        margin: { ...f.desc.marginP },
        padding: { ...f.desc.paddingP },
        border: { ...f.desc.borderP },
        bg: f.desc.bg,
        ...this.decorOf(f.desc),
        src: f.desc.src,
        ref: f.desc.ref,
        radius: f.desc.radius,
        shadow: f.desc.shadow,
        cont: true,
        colSizes: old.colSizes,
      });
      const clone = node.kind === 'table';
      // 前側の罫線・余白を残す指定 (conditionality="retain") なら、続きの断片にも付ける
      const ks = clone ? undefined : f.desc.keepStart;
      cutStart(node, clone || !!ks?.border, !!ks?.padding);
      // 続きの断片の頭でも、表の外側の罫線の外の半分は表の箱の外 (最初の断片と同じ位置。段の頭がそろう)
      if (f.spillBs) cur -= f.spillBs;
      node.i = f.desc.m.is;
      node.b = cur - parentContent;
      f.node = node;
      f.frags?.push(node);
      f.startB = cur;
      f.contentStartB = cur + (clone ? f.desc.bw.bs : (ks?.size ?? 0));
      cur = f.contentStartB;
      parentContent = f.contentStartB;
      parent.children.push(node);
      parent = node;
    }
    this.cursor = cur;
    // 前ページに入らなかった float を、新ページの先頭に置く
    // 送られてきた float を置く。綴じ側・小口側の float は、このページの偶奇で組み直す (白ページには置かない)
    if (level !== 'blank') for (const d of this.deferredFloats.splice(0)) {
      if (d.redo) this.placeFloat(d.redo.node, d.redo.st);
      else this.anchorFloat(d);
    }
  }

  // ── 子要素の振り分け ──

  layoutChildren(children: Array<LBlockLevel | LInlineLevel>, style: ResolvedStyle) {
    let run: InlineChild[] = [];
    let runAt = 0;
    let firstRun = true;
    const flushRun = () => {
      if (!run.length) return;
      this.layoutInlineRun(run, style, firstRun, { arr: children, at: runAt });
      firstRun = false;
      run = [];
    };
    for (let ci = 0; ci < children.length; ci++) {
      const c = children[ci];
      if (!run.length) runAt = ci;
      if (typeof c !== 'string' && c.type === 'marker') {
        // 段落の途中でも行を分断しないよう、run には触れずに保留する
        const key = this.top()?.desc;
        if (key) markerParents.add(key);
        this.markerSink.push({ className: c.className, marker: c, ...(key ? { key } : {}) });
      } else if (typeof c !== 'string' && c.type === 'float') {
        // マーカーと同様、段落 (run) を分断せずにその場へ固定する
        this.placeFloat(c, style);
      } else if (typeof c !== 'string' && c.type === 'block-container' && c.absolutePosition && c.positionInContainer && this.cbAbs) {
        // 絶対配置の基準になるブロックの中の絶対配置の箱: 段落 (run) を分断しない。上下の位置の指定が無ければ、段落の頭の高さ (static position)
        this.layoutContainer(c, style);
      } else if (typeof c !== 'string' && c.type === 'retrieve-marker') {
        this.host.warn('retrieve-marker は PageSequence.staticContent 内でのみ使えます');
      } else if (typeof c !== 'string' && c.type === 'retrieve-table-marker') {
        // 表の header・footer の中のものは、組む前に中身に置き換えてある (layoutTableWithMarkers)。ここへ来るのは、それ以外の所に置いたもの
        this.host.warn('retrieve-table-marker は表の header・footer の中でのみ使えます');
      } else if (isInlineChild(c)) run.push(c);
      else {
        // 字の並び (無名のブロック) の直後のブロックが keep-with-previous (CSS の break-before: avoid) なら、
        // 並びと、そのブロックの先頭を同じページに置く。入らず、改ページすれば入るなら、並びの前で改ページする
        if (run.length && (c as { keepWithPrevious?: boolean }).keepWithPrevious) {
          const anon = { type: 'block', ...(firstRun ? {} : { textIndent: 0 }), children: run } as LBlock;
          if (this.keepWithNextBreak([anon, ...children.slice(ci)], 0, style)) this.breakPage();
        }
        flushRun();
        // 流れの直下のブロックの span の切り替わりは、参照領域の境 (絶対配置の箱は流れの外なので、境を作らない)
        if (this.spanAreas && !this.stack.length && !(c.type === 'block-container' && c.absolutePosition)) {
          const sp = c.type === 'block' && c.span === 'all';
          if (this.prevSpan !== undefined && sp !== this.prevSpan) this.areaBoundary();
          this.prevSpan = sp;
        }
        if (this.keepWithNextBreak(children, ci, style)) {
          this.breakPage();
          // 送ったブロックの先頭の余白は、強制でない改ページに接するので捨てる (ふだんの改ページと同じ。retain の余白は残す)
          if (!(c as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
        }
        this.layoutBlockLevel(c, style);
      }
    }
    flushRun();
  }

  /**
   * keep-with-next / keep-with-previous: children[i] からの「つなげる」並び (keepWithNext が続く限り) と、
   * その次のブロックの先頭が同じページに入るか、試し組みで調べる。入らず、改ページすれば入るなら true (先に改ページする)。
   */
  private keepWithNextBreak(children: Array<LBlockLevel | LInlineLevel>, i: number, ps: ResolvedStyle): boolean {
    // ページの先頭 (セルなどの中の流れでは、外側のページにも何も無いとき) なら、改ページしても入る場所は増えない
    if (!this.paginating || (!this.pageHasContent && (this.pages?.atPageStart?.() ?? true)) || this.keepTrial) return false;
    const blockAt = (k: number): LBlock | LTable | LBlockContainer | undefined => {
      const c = children[k];
      return typeof c !== 'string' && (c?.type === 'block' || c?.type === 'table' || (c?.type === 'block-container' && !c.absolutePosition)) ? c : undefined;
    };
    const linked = (k: number) => {
      const a = blockAt(k);
      return !!a && (!!a.keepWithNext || !!blockAt(k + 1)?.keepWithPrevious);
    };
    if (!linked(i) || (i > 0 && linked(i - 1))) return false; // 並びの先頭だけが調べる
    let end = i;
    while (linked(end)) end++;
    let next = children[end];
    // 次が inline (字・画像など) なら、続く inline をまとめた無名のブロックを次のブロックとみなす
    // (keep-with-next の見出しと後ろの画像を同じ段に置く)
    if (next !== undefined && isInlineChild(next)) {
      let k = end;
      while (k < children.length && isInlineChild(children[k])) k++;
      next = { type: 'block', children: children.slice(end, k) } as LBlock;
    }
    if (typeof next === 'string' || !next || (next.type !== 'block' && next.type !== 'table' && next.type !== 'block-container')) return false;
    if ((next.type === 'block' || next.type === 'block-container') && next.breakBefore) return false;
    const reserve = this.stack.reduce((a, f) => a + f.desc.bpEnd, 0);
    const pageLimit = this.pages?.nextLimit?.() ?? this.limit;
    const host: FlowHost = { ...this.host, warn: () => {} };
    const lineCount = (n: LNode): number => (n.kind === 'line' ? 1 : n.children.reduce((a, c) => a + lineCount(c), 0));
    // 行の無い並び (色の帯・画像だけの組版例など) は、大きさのある箱 (行・画像・中身の無い箱) で載ったページを見る
    const boxCount = (n: LNode): number =>
      n.kind === 'line' || n.kind === 'image' ? 1 : n.children.length ? n.children.reduce((a, c) => a + boxCount(c), 0) : n.kind !== 'region-body' && n.bsize > EPS ? 1 : 0;
    /** 最初のページに limit0 だけ使えるとして、並びの末尾と次のブロックの先頭が同じページに載るか */
    const kept = (limit0: number, seed = false): boolean => {
      if (limit0 <= 0) return false;
      const roots: LNode[] = [newNode('region-body', this.wm, { isize: this.contentI() })];
      const trial = new Flow(host, {
        wm: this.wm,
        rootI: this.contentI(),
        root: roots[0],
        limit: limit0,
        pages: {
          addMarkers: () => {},
          noteId: () => {},
          nextPage: () => {
            const r = newNode('region-body', this.wm, { isize: this.contentI() });
            roots.push(r);
            return { root: r, limit: Math.max(pageLimit - reserve, 1), rootI: this.contentI() };
          },
        },
        abs: () => [],
        pageSize: this.pageSize,
        keepTrial: true,
        // 脚注の参照記号は本番と同じラベル (1)・(12) など) で組む (渡さないと「*」になり、行分けが本番とずれる)。
        // 本体は積まない (holdFootnotes): 試し組みの行に持たせるだけで、脚注領域・ページの記録は変えない
        footnotes: this.foot,
        holdFootnotes: true,
      });
      // 行グリッドの中なら、試し組みにもグリッドを渡す (このページの続きでは、いまの位置を試し組みの原点として、グリッドの位置をそろえる。
      // 渡さないと、行がグリッドに揃わず最後の行の下の半行間も数えるので、本番では入る行が入らないと判断する)
      const g = this.currentGrid();
      if (g && this.wm === 'horizontal-tb') trial.outerGrid = { pitch: g.pitch, ascent: g.ascent, origin: seed && g.origin !== undefined ? g.origin - this.cursor : 0 };
      // このページの続きで試すときは、保留中の余白 (前の要素の下の余白など) を引き継ぎ、並びの先頭の上の余白と畳ませる
      // (空きから引いたうえで先頭の余白も足すと、畳まれる余白を二重に数える)
      if (seed) {
        trial.pendPos = this.pendPos;
        trial.pendNeg = this.pendNeg;
        trial.pendAny = this.pendAny;
        trial.pendPrec = this.pendPrec;
        trial.pendForce = this.pendForce;
        trial.pendMin = this.pendMin;
        trial.pendAdjust = this.pendAdjust;
        trial.pendSpill = this.pendSpill;
      }
      let count = lineCount;
      /** 直前の状態から、新しく行 (箱) が置かれた最初のページ番号 (置かれなければ -1) */
      const firstGrown = (before: number[]) => {
        const now = roots.map(count);
        return now.findIndex((n, idx) => n > (before[idx] ?? 0));
      };
      let before = roots.map(lineCount);
      const beforeBoxes = roots.map(boxCount);
      trial.layoutBlockLevel(children[i] as LBlockLevel, ps);
      let startPage = firstGrown(before);
      if (startPage < 0) {
        // 並びの先頭に行が無ければ、箱で数える
        count = boxCount;
        startPage = firstGrown(beforeBoxes);
      }
      for (let k = i + 1; k < end; k++) trial.layoutBlockLevel(children[k] as LBlockLevel, ps);
      before = roots.map(count);
      // 次のブロックが keep-together なら、分けずに置くので、全体が同じページに入るかで決める (試し組みでは分けて置く)
      const together = (next as { keepTogether?: boolean }).keepTogether;
      // 見るのは「次のブロックの最初の行がどのページに載るか」だけなので、最初の行が置かれた時点で試し組みを打ち切る
      // (次が長い表でも、表全体を組まない。keep-together のときは、先頭と別のページに行が載った時点で打ち切る)
      let result: boolean | undefined;
      trial.onPlaced = () => {
        const now = roots.map(count);
        const grown = now.findIndex((n, idx) => n > (before[idx] ?? 0));
        if (grown < 0) return; // 行の無い箱 (画像など) は、行で数えているときは数えない
        if (together) {
          if (now.some((n, idx) => idx !== startPage && n > (before[idx] ?? 0))) {
            result = false;
            throw KEEP_TRIAL_STOP;
          }
          return;
        }
        result = startPage >= 0 && grown === startPage;
        throw KEEP_TRIAL_STOP;
      };
      try {
        trial.layoutBlockLevel((together ? { ...next, keepTogether: false } : next) as LBlockLevel, ps);
      } catch (e) {
        if (e !== KEEP_TRIAL_STOP) throw e;
      }
      if (result !== undefined) return result;
      const after = roots.map(lineCount);
      if (together && startPage >= 0 && after.some((n, idx) => idx !== startPage && n > (before[idx] ?? 0))) return false;
      // 並びの先頭と、次のブロックの先頭が同じページ (段) に載ること
      return startPage >= 0 && firstGrown(before) === startPage;
    };
    const here = this.room - this.cursor - reserve;
    // 試し組みの結果は、同じ条件なら覚えて使い回す (memoMeasure)。入れ子の表の行をページで分けるとき (splitRow)、外側の試し組みと本番が、
    // 内側の同じ並びを同じ条件で試す (覚えないと、入れ子の 1 段ごとに 3 倍になる)。kept が読むものを、すべて鍵にする: 並び (children の
    // i から end まで。次のブロックは end から決まる)・最初のページと次のページの上限・箱の幅・行グリッド・引き継ぐ保留中の余白
    const g0 = this.currentGrid();
    const seedState = (): Array<string | number> => [g0 ? this.cursor : 0, this.pendPos, this.pendNeg, this.pendAny ?? 'n', this.pendPrec, this.pendForce ?? 'n', this.pendMin, this.pendAdjust, this.pendSpill];
    const keptM = (limit0: number, seed = false) =>
      this.memoMeasure('keep', children, ps, [i, end, limit0, seed, pageLimit, reserve, this.contentI(), this.wm, JSON.stringify(g0 ?? null), ...(seed ? seedState() : [])], this.foot, () => kept(limit0, seed));
    if (keptM(here, true)) return false;
    return keptM(Math.max(pageLimit - reserve, 1)); // 新しいページなら一緒に入る場合だけ、改ページする
  }

  /**
   * 計測・試し組みで求める値を、同じ組版の中で覚えて使い回す。幅を中身で決める箱 (表の auto の列・float・inline-block・絶対配置の箱) や
   * 段組は、中身を「計測で 1〜2 回・本番で 1 回」組むので、覚えないと、入れ子の 1 段ごとに組む回数が 2〜5 倍になる (深さに対して指数的)。
   *
   * compute は、新しい Flow に中身 (arr = 子の配列) を組んで値を返すだけのもの (この Flow の位置・余白・float の状態を読まない。
   * ページ・マーカー・脚注領域に何も残さない)。その値を決めるものを、すべて鍵にする:
   *  - 中身の並び (arr。配列そのもの)・継がせるスタイル (st)・呼び出し元ごとの条件 (parts: 行の長さ・段数など)・計測の種類 (site)
   *  - 脚注の番号付け (foot。参照記号の字が変わる)・ページの大きさ (絶対配置・ビューポートの単位)・ページ番号の偶奇
   *    (float: inside / outside、text-align: inside / outside、偶数・奇数ページへの改ページ)
   *  - ページ番号の参照の値: 計測の中で引いた参照 (引数と値) を覚えと一緒に残し、使い回す前に引き直して、すべて同じ値のときだけ使う
   *    (1 回目の組版の仮の値は、いまのページ番号・置き済みの id で変わる。引き直すので、参照を引いた記録・見つからない id の警告も、
   *    計測をやり直したときと同じに残る)
   * 書体・ハイフネーション・互換の指定は、1 回の組版の中で変わらない。脚注の番号は最初に見た順に 1 度だけ振る (FootnoteCtx.label) ので、
   * 2 度目の計測を省いても番号は変わらない。試し組みが絶対配置の箱を置いたとき (跡が残る) は覚えない (host.volatile.n)
   */
  private memoMeasure<T>(site: string, arr: object, st: ResolvedStyle, parts: ReadonlyArray<string | number | boolean | undefined>, foot: FootnoteCtx | undefined, compute: () => T): T {
    const memo = this.host.measureMemo;
    const vol = this.host.volatile;
    if (!memo || !vol) return compute();
    const page = this.pageSize();
    const pn = this.host.pageNumber?.();
    const key = `${site}|${parts.join('|')}|${page.width}|${page.height}|${pn === undefined ? '' : pn % 2}`;
    let m = memo.get(arr);
    const list = m?.get(key);
    if (list) for (const e of list) if (e.foot === foot && sameStyle(e.st, st) && e.cites.every((c) => this.host.cite(...c.args, pn) === c.value)) return e.v as T;
    const before = vol.n;
    const from = vol.cites.length;
    let v: T;
    let cites: CiteUse[];
    vol.active++;
    try {
      v = compute();
    } finally {
      // 同じ参照 (引数が同じ) は 1 つにまとめる (最後のもの。スタイルは、参照を引いた記録に残る最後のものと同じになる)
      cites = [...new Map(vol.cites.slice(from).map((c) => [JSON.stringify(c.args.slice(0, 4)), c])).values()];
      if (--vol.active === 0) vol.cites.length = 0;
    }
    if (vol.n !== before) return v;
    if (!m) memo.set(arr, (m = new Map()));
    const into = m.get(key);
    if (into) into.push({ st, foot, cites, v });
    else m.set(key, [{ st, foot, cites, v }]);
    return v;
  }

  /**
   * 中身の幅 (いちばん長い行の長さ) を、行の長さ rootI で測る (intrinsic の計測。表のセル・見出し・shrink-to-fit の箱の最小・最大の幅)。
   * 同じ中身・同じ条件の計測は、同じ組版の中で 1 度だけ行う (memoMeasure)
   */
  private intrinsicWidth(children: LBlock['children'], st: ResolvedStyle, rootI: number, minContent = false): number {
    const r = Math.max(rootI, 1);
    return this.memoMeasure('iw', children, st, [r, minContent], undefined, () =>
      maxLineLength(this.measureSub(children, st, r, { intrinsic: true, ...(minContent ? { minContent: true } : {}) }).sub.root),
    );
  }

  /**
   * 内容による inline 方向の大きさ (CSS Sizing 3 §3.2。BoxStyle.inlineSizing) を、内容の箱の大きさ (pt) にする。指定が無ければ undefined。
   *  - min-content・max-content は、中身の最も狭い幅・折り返さない幅 (§2.1・§5.1)。fit-content は min(max-content, max(min-content, 使える長さ))。
   *    fit-content(<長さ>) は、使える長さをその長さに置き換えたもの (CSS Sizing 4 §3.2)
   *  - avail: 使える長さ (外側の大きさが包含ブロックを埋めるときの、内容の箱の大きさ = stretch-fit の大きさ)
   *  - preferred: 語でない大きさ (長さの指定か、auto のときの大きさ)。size の語があれば使わない
   *  - 上限・下限 (語か、長さの minInlineSize・maxInlineSize) を当てる (下限が勝つ。CSS 2.1 §10.4)
   * max-content は、いつも同じ行の長さで測る (計測の覚えの鍵が、入れ子の深さで変わらないように)
   */
  private contentSizedInline(node: Pick<BoxStyle, 'inlineSizing' | 'minInlineSize' | 'maxInlineSize'> & { children: LBlock['children'] }, st: ResolvedStyle, avail: number, preferred: number): number | undefined {
    const s = node.inlineSizing;
    if (!s) return undefined;
    let minC: number | undefined;
    let maxC: number | undefined;
    const ceil = (v: number) => (v > 0 ? Math.ceil(v * 100) / 100 + 0.01 : 0);
    // 中の、大きさの指定のある箱は、その箱の大きさを数える (maxLineLength の countFixed)
    const widthAt = (rootI: number, min: boolean) =>
      this.memoMeasure('iwx', node.children, st, [rootI, min], undefined, () => maxLineLength(this.measureSub(node.children, st, rootI, { intrinsic: true, ...(min ? { minContent: true } : {}) }).sub.root, true, false, true));
    const minOf = () => (minC ??= ceil(widthAt(1, true)));
    // 折り返さない幅が最も狭い幅より小さくなるとき (負の余白など) は、最も狭い幅 (§2.1)
    const maxOf = () => (maxC ??= Math.max(ceil(widthAt(MAX_CONTENT_ROOT, false)), minOf()));
    const of = (k: ContentSizeKeyword) => (k === 'min-content' ? minOf() : k === 'max-content' ? maxOf() : Math.min(maxOf(), Math.max(minOf(), typeof k === 'object' ? k.fit : avail)));
    let v = s.size ? of(s.size) : preferred;
    const hi = s.max ? of(s.max) : node.maxInlineSize;
    const lo = s.min ? of(s.min) : node.minInlineSize;
    if (hi !== undefined) v = Math.min(v, hi);
    if (lo !== undefined) v = Math.max(v, lo);
    return Math.max(v, 0);
  }

  /** 中身を、内容の inline の大きさ ci で測るだけ組んで、block の大きさを返す (先頭・末尾の子の余白も含める) */
  /**
   * 測るだけ組む: 中身を、行の長さ rootI の別の流れに組む (警告は出さない。ページには置かない)。sub は組んだ流れ (幅は maxLineLength(sub.root))、
   * used は block の大きさ
   */
  private measureSub(children: LBlock['children'], st: ResolvedStyle, rootI: number, extra: Partial<FlowInit> = {}, wm: WritingMode = st.wm): { sub: Flow; used: number } {
    const sub = new Flow({ ...this.host, warn: () => {} }, { wm, rootI, abs: () => [], pageSize: this.pageSize, measure: true, ...extra });
    sub.layoutChildren(children, st);
    return { sub, used: sub.finishAtomic() };
  }

  /**
   * aspect-ratio の箱の大きさ (CSS Sizing 4 §5.1)。比は box-sizing の箱どうし。
   * - inline が auto なら、block の min・max を比で inline に移して抑える。移した max は inline の min を下回らず、移した min は inline の max を
   *   上回らない。その後で inline の min・max (min-width・max-width) を当てる (min が勝つ。CSS 2.1 §10.4)
   * - block は inline × 比 を min・max で抑える。min が auto で scroll なしの箱 (overflow: visible) は中身で伸びる (自動の最小の大きさ) が、
   *   max は超えない。min の指定がある箱 (0 も) と切り抜く箱は、比の高さで固定 (中身ははみ出す)
   */
  private aspectBox(node: LBlock, desc: BoxDesc): BoxDesc {
    const r = node.aspectRatio!;
    const bb = node.boxSizing === 'border-box';
    const bpB = desc.bpStart + desc.bpEnd;
    // block の箱 = inline の箱 × k (box-sizing の箱どうし)
    const k = this.wm === 'horizontal-tb' ? 1 / r : r;
    const toB = (ci: number) => Math.max((ci + (bb ? desc.bpI : 0)) * k - (bb ? bpB : 0), 0);
    const toI = (cb: number) => Math.max((cb + (bb ? bpB : 0)) / k - (bb ? desc.bpI : 0), 0);
    const maxB = node.maxBlockSize;
    const minB = node.minBlockSize;
    const maxI = node.maxInlineSize ?? Infinity;
    const minI = node.minInlineSize ?? 0;
    const was = desc.isizeExplicit;
    let ci = was;
    if (ci == null) {
      ci = Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0);
      if (maxB != null) ci = Math.min(ci, Math.max(toI(maxB), minI));
      if (minB != null) ci = Math.max(ci, Math.min(toI(minB), maxI));
    }
    ci = Math.max(Math.min(ci, maxI), minI);
    if (was == null ? Math.abs(ci - Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0)) > EPS : Math.abs(ci - was) > EPS) desc = { ...desc, isizeExplicit: ci };
    let b = toB(ci);
    if (maxB != null) b = Math.min(b, maxB);
    if (minB != null) b = Math.max(b, minB);
    if (node.overflow === 'hidden' || minB != null) return { ...desc, bsizeExplicit: b, minB: undefined };
    // 中身で伸びるが、max は超えない (max を超える中身ははみ出す。箱を閉じるときに当てる)
    return { ...desc, minB: b, ratioSized: true, ...(maxB != null ? { maxB } : {}) };
  }

  /**
   * 幅の決まった箱で、左右の余白がどちらも auto でないとき (制約が余る。CSS 2.1 §10.3.3): 包含ブロックの direction が ltr なら
   * margin-right を、rtl なら margin-left を捨てて、残りに合わせる。rtl では、箱は右端 (margin-right の内側) から置く。
   * 入りきらない箱は左へはみ出す。XSL-FO の文書と縦書きは扱わない (余白の is は左の側)
   */
  private rtlEdge(desc: BoxDesc, node: { autoMargins?: unknown }, ps: ResolvedStyle): BoxDesc {
    if (this.host.xslSpace || this.wm !== 'horizontal-tb' || ps.direction !== 'rtl' || node.autoMargins || desc.isizeExplicit == null) return desc;
    const free = this.contentI() - desc.m.is - desc.m.ie - desc.bpI - desc.isizeExplicit;
    return Math.abs(free) > EPS ? { ...desc, m: { ...desc.m, is: desc.m.is + free } } : desc;
  }

  layoutBlockLevel(node: LBlockLevel, ps: ResolvedStyle) {
    if (node.type === 'block') this.layoutBlock(node, ps);
    else if (node.type === 'table') this.layoutTable(node, ps);
    else if (node.type === 'block-container') {
      // 流れの中のブロックコンテナ (高さの決まった flex の容器など) も、rtl では右端から置く (左の余白を残りに合わせる)
      if (!node.absolutePosition && !node.rotation && resolveStyle(ps, node).wm === this.wm) {
        const d = describeBox(node, this.wm);
        const e = this.rtlEdge(d, node, ps);
        if (e !== d) node = { ...node, margin: { ...d.marginP, left: e.m.is } };
      }
      this.layoutContainer(node, ps);
    }
  }

  // ── ブロック ──

  layoutBlock(node: LBlock, ps: ResolvedStyle) {
    if (this.host.stats) this.host.stats.blocks++;
    const st = resolveStyle(ps, node);
    if (st.wm !== this.wm) return this.layoutOrthogonal(node, st, ps);
    if (node.breakBefore) this.forceBreak(node.breakBefore);
    if (node.keepTogether && this.paginating) this.keepTogetherCheck(node, ps);
    if (node.clear) {
      // float の下まで進める (保留マージンの下限として扱うので、既存マージンとは max で畳まれる)
      const y = this.floatBottom(node.clear);
      if (y > this.cursor + this.pendingValue()) this.pendMin = Math.max(this.pendMin, y - this.cursor);
    }
    // 支柱だけの箱 (flex の visibility: collapse の項目。LBlock.phantom): 中身 (畳む前の行) を測るだけ組み、その block の大きさの空の箱を置く。
    // 同じ行の支柱どうしは中身の節を分け合うので、測った値を節ごとに覚えて使い回す。中の id は、リンクの飛び先として残す
    if (node.phantom) {
      const d0 = describeBox(node, this.wm);
      const ci = d0.isizeExplicit ?? Math.max(this.contentI() - d0.m.is - d0.m.ie - d0.bpI, 0);
      let used = 0;
      for (const k of node.children) {
        let v = typeof k === 'object' ? phantomSizes.get(k) : undefined;
        if (v === undefined) {
          v = this.measureSub([k], st, Math.max(ci, 1), { referenceArea: true }).used;
          if (typeof k === 'object') phantomSizes.set(k, v);
        }
        used = Math.max(used, v);
      }
      const horizontal = this.wm === 'horizontal-tb';
      const { phantom: _p, phantomIds, ...rest } = node;
      // id は、支柱の高さの空の箱を包む箱に 1 つずつ付ける (高さ 0 の箱は、表のセルの中では面積の節にならず、id が記録されない)
      let inner: LBlock = { type: 'block', [horizontal ? 'height' : 'width']: used, children: [] };
      for (const id of [...(phantomIds ?? [])].reverse()) inner = { type: 'block', id, children: [inner] };
      this.layoutBlock({ ...rest, boxSizing: 'content-box', [horizontal ? 'width' : 'height']: ci, children: [inner] }, ps);
      return;
    }
    let desc = describeBox(node, this.wm);
    // 幅の決まった箱の auto の余白 (CSS 2.1 §10.3.3): 置く場所の残りを、auto の側に配る。'start' は margin-left (縦書きは margin-top) が auto。
    // 余白の is は direction によらず左 (上) の側なので、rtl でも入れ替えない (auto の余白は物理の左右で決まる)
    const autoMargins = (d: BoxDesc): BoxDesc => {
      if (!node.autoMargins || d.isizeExplicit == null) return d;
      const free = this.contentI() - d.m.is - d.m.ie - d.bpI - d.isizeExplicit;
      const am = node.autoMargins;
      return free > EPS ? { ...d, m: { ...d.m, is: d.m.is + (am === 'center' ? free / 2 : am === 'start' ? free : 0) } } : d;
    };
    // 内容による大きさ (CSS Sizing 3 §3.2 の min-content・max-content・fit-content): 中身の幅を測って、内容の箱の大きさを決める
    if (node.inlineSizing) {
      const avail = Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0);
      desc = { ...desc, isizeExplicit: this.contentSizedInline(node, st, avail, desc.isizeExplicit ?? avail) };
    }
    desc = this.rtlEdge(autoMargins(desc), node, ps);
    // CSS: 新しいブロック整形文脈の箱 (overflow が visible でない・flow-root など) は、外の float に重ならない (CSS 2.1 §9.5)。
    // 上端の高さで float の横に入れば、その幅に縮めて横に置く。入らなければ float の下へ下げる
    if (node.bfc && !this.host.xslSpace && this.floats.length && this.wm === 'horizontal-tb') {
      const y0 = this.cursor + Math.max(this.pendingValue(), desc.m.bs);
      const r = this.lineRange(y0, y0 + 1);
      if (r.intruded) {
        const cI = this.contentI();
        const need = desc.isizeExplicit != null ? desc.isizeExplicit + desc.bpI : Math.min(st.fontSize * 2, cI);
        if (r.width + EPS >= need) desc = { ...desc, m: { ...desc.m, is: Math.max(desc.m.is, r.shift), ie: Math.max(desc.m.ie, cI - r.shift - r.width) } };
        else this.pendMin = Math.max(this.pendMin, r.clearTo - this.cursor);
      }
    }
    // aspect-ratio (CSS Sizing 4 §5.1): 高さが auto なら、実際の inline の大きさ (float を避けて縮めた後) から block の大きさを決める。
    // 比は box-sizing の箱どうしで、幅 / 高さ (物理)。縦書きでは inline が高さなので、block (幅) = inline × 比
    // min・max で inline の大きさが決まったら、auto の余白をその大きさで配り直す
    if (node.aspectRatio && desc.bsizeExplicit == null) {
      const was = desc.isizeExplicit;
      desc = this.aspectBox(node, desc);
      if (desc.isizeExplicit !== was) desc = this.rtlEdge(autoMargins(desc), node, ps);
    }
    const frame = this.openFrame(desc);
    // 中の絶対配置の箱の基準になる箱 (CSS の position が static でない箱。横書きだけ)・position: relative でずらす箱は、断片を集める
    const outerCb = this.cbAbs;
    const cb = node.containingBlock && this.wm === 'horizontal-tb' ? (this.cbAbs = { frame, items: [] }) : undefined;
    if (cb || node.relativeOffset) frame.frags = frame.opened ? [frame.node] : [];
    // 行グリッド (アンテナハウスの baseline-grid): new はこの箱の字の大きさと line-height、root は根元の書式で作る。none は解除。
    // baseline-block-snap は扱わない
    if (node.baselineGrid === 'none') frame.grid = null;
    else if (node.baselineGrid === 'new' || node.baselineGrid === 'root') {
      const g = node.baselineGrid === 'root' ? (this.rootStyle ?? st) : st;
      frame.grid = { pitch: lineHeightOf(g), ascent: this.nominalRatio(g) * g.fontSize };
    }
    // overflow: hidden は、padding の外端で切り抜く
    if (node.overflow === 'hidden') frame.node.clip = true;
    // 新しいブロック整形文脈: 外の余白をここで確定し、箱を開く (中の最初の子の余白は箱の中に置く)
    const floatsBefore = this.floatSeq;
    if (node.bfc) this.flush();
    const fence = (node as { refArea?: boolean }).refArea;
    const outerRef = this.refStartItems;
    const refLines = (node as { refLines?: boolean }).refLines;
    const outerBlocked = this.edgeBlocked;
    if (refLines) {
      this.flush(); // 外のブロックを先に開く (その罫線・余白は、この参照領域の外)
      this.refStartItems = this.pageItems; // 中の最初の行は、参照領域の最初の行 (line-height.conditionality)
      this.edgeBlocked = false;
    }
    if (fence) {
      // 参照領域 (高さ未指定のブロックコンテナ): 外の余白をここで確定し、中の先頭の conditional な余白は捨てる (§4.2.5・§4.3.1)
      this.flush();
      this.discardLeading = true;
      this.refStartItems = this.pageItems;
    }
    this.layoutChildren(node.children, st);
    // 参照領域の末尾の conditional な余白も捨てる (外の余白と重ね合わせない)
    if (fence) {
      this.resetPending();
      this.discardLeading = false;
    }
    if (refLines) {
      // 最後の行の下の半行間も、line-height.conditionality="discard" なら捨てる
      if (this.pendingValue() <= EPS) this.cursor = this.endAfterLastLine();
      this.refStartItems = outerRef;
      this.edgeBlocked = outerBlocked;
    }
    if (node.bfc && this.stack[this.stack.length - 1] === frame) {
      // 中の最後の子の下の余白も箱の中に置き、中で始まった float の下端まで箱を伸ばす (CSS 2.1 §10.6.7)
      this.flush();
      const fb = Math.max(-Infinity, ...this.floats.filter((f) => (f.seq ?? 0) > floatsBefore).map((f) => f.b1));
      if (fb > this.cursor) {
        this.cursor = fb;
        this.adjacent = 0;
      }
      // 高さの指定のある箱で中身を切り抜くなら、箱は指定の高さ (中身はみ出して切り抜かれる。§11.1)
      if (node.overflow === 'hidden' && desc.bsizeExplicit != null && !frame.node.cont) this.cursor = Math.min(this.cursor, frame.contentStartB + desc.bsizeExplicit);
    }
    // 中身が絶対配置の箱だけでも、基準の箱は置く (高さ 0)
    if (cb?.items.length && !frame.opened) this.flush();
    this.closeFrame();
    if (cb) {
      this.cbAbs = outerCb;
      this.placeCbAbs(cb);
    }
    // position: relative: 組んだ箱 (断片) を動かす。前後の配置は変えない (CSS 2.1 §9.4.3)
    if (node.relativeOffset)
      for (const n of frame.frags ?? []) {
        n.i += node.relativeOffset.x;
        n.b += node.relativeOffset.y;
      }
    if (node.breakAfter) this.breakNext = node.breakAfter;
  }

  /**
   * 絶対配置の基準になるブロックを組み終えたら、中の絶対配置の箱を組み、その内容の箱を基準に置く (CSS 2.1 §10.3.7・§10.6.4)。
   * top があれば最初の断片、bottom があれば最後の断片、どちらも無ければ見つけた所 (static position) の断片の子にする
   */
  private placeCbAbs(cb: CbAbs) {
    const frags = cb.frame.frags ?? [];
    if (!frags.length) return;
    for (const it of cb.items) {
      const { node } = it;
      const f = node.top != null ? frags[0] : node.bottom != null ? frags[frags.length - 1] : frags[Math.min(it.frag, frags.length - 1)];
      const bw = (e: 'top' | 'right' | 'bottom' | 'left') => f.border[e]?.width ?? 0;
      const w = Math.max(f.isize - f.padding.left - f.padding.right - bw('left') - bw('right'), 0);
      const h = Math.max(f.bsize - f.padding.top - f.padding.bottom - bw('top') - bw('bottom'), 0);
      const n = this.buildContainer(node, it.st, w, h);
      const at = n.phys ?? { x: 0, y: 0 };
      delete n.phys;
      n.i = at.x;
      n.b = node.top == null && node.bottom == null ? it.sy + (node.staticOffset ?? 0) : at.y;
      f.children.push(n);
      this.noteIds(n);
    }
  }

  /** 直列化して高さを測り、現ページに収まらなければ先に改ページする */
  private keepTogetherCheck(node: LBlock | LTable, ps: ResolvedStyle) {
    const sub = new Flow(this.host, {
      wm: this.wm,
      rootI: this.contentI(),
      abs: () => [],
      pageSize: this.pageSize,
      footnotes: this.foot,
      measure: true,
    });
    sub.layoutBlockLevel({ ...node, keepTogether: false, breakBefore: undefined, breakAfter: undefined } as LBlock | LTable, ps);
    // 末尾の space-after はページの終わりでは捨てるので数えない。先頭の space-before は、前の余白と重ね合わせる (大きい方)
    const h = sub.finishAtomicContent();
    const lead = Math.max(describeBox(node, this.wm).m.bs, 0);
    const need = Math.max(this.pendingValue(), lead) + Math.max(h - lead, 0);
    if (this.pageHasContent && this.cursor + need > this.room + EPS && h <= this.room) {
      this.breakPage();
      // 送ったブロックの先頭の余白は、強制でない改ページに接するので捨てる (keep-with-next で送るときと同じ。retain の余白は残す)
      if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
    }
  }

  /** 根元の書式 (行グリッドの root)。最初に組んだ並びの書式 */
  private rootStyle?: ResolvedStyle;

  /**
   * 行グリッド: 行のベースラインを、行グリッドの位置に動かす量。行グリッドの中では、行の前の半行間は入れず、字の箱の上端を
   * 内容の端に揃える (アンテナハウスの baseline-grid)。行の位置は段落の字 (支柱) の高さで決める (行の中の画像などの高さでは下げない)
   */
  /** 行グリッドの中か (近い祖先の箱に行グリッドがあり、解除されていない。横書き) */
  private inGrid(): boolean {
    for (let k = this.stack.length - 1; k >= 0; k--) if (this.stack[k].grid !== undefined) return !!this.stack[k].grid && this.wm === 'horizontal-tb';
    return !!this.outerGrid && this.wm === 'horizontal-tb';
  }

  /** 外の流れから受け継いだ行グリッド (keep の試し組み)。origin はこの流れの座標での、グリッドの箱の内容の上端 */
  outerGrid?: { pitch: number; ascent: number; origin: number };

  /** いま効いている行グリッドと、その箱の内容の上端 (この流れの座標。箱がまだ開いていなければ undefined) */
  private currentGrid(): { pitch: number; ascent: number; origin?: number } | undefined {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const f = this.stack[k];
      if (f.grid === undefined) continue;
      return f.grid ? { ...f.grid, ...(f.opened ? { origin: f.contentStartB } : {}) } : undefined;
    }
    return this.outerGrid;
  }

  /**
   * 行グリッドの中の行の、字の仮想ボディ (em の箱) の基線の上・下の長さ。ブロックの字 (nominal-font) の値を下限に、行の中の字 (空白を除く。
   * 持ち上げた字はその位置) の最大。行内の画像などの箱は数えない (行の位置は字で決める)
   */
  private gridEmOf(pl: PositionedLine | undefined, st: ResolvedStyle): { above: number; below: number } {
    const r = this.nominalRatio(st);
    let above = r * st.fontSize;
    let below = (1 - r) * st.fontSize;
    for (const a of pl ? (pl.raw.hang ? [...pl.raw.items, pl.raw.hang] : pl.raw.items) : []) {
      if (a.kind !== 'glyph' || a.isSpace || !a.g) continue;
      const ab = atomAboveBelow(a, this.wm);
      const sh = a.shift ?? 0;
      above = Math.max(above, ab.above + sh);
      below = Math.max(below, ab.below - sh);
    }
    return { above, below };
  }

  /** 行グリッドの中の行の、字の em の箱の下端から行の下端まで (半行間など)。すぐ次の行は、この分を数えずに em の箱を続ける */
  private gridEmTrailOf(lm: LineMetrics, emBelow: number): number {
    return Math.max(0, lm.base - (lm.topLeading ?? lm.leading / 2) - lm.above - emBelow);
  }

  /** 行グリッドの中で最後に置いた行の下端と、その行の em の箱の下端から行の下端までの長さ (gridEmTrailOf)。グリッドの外で置いた行は end = -1 */
  private gridPrev = { end: -1, trail: 0 };

  /** lineTop (保留中の余白を足す前の位置 at) のすぐ上が、行グリッドの中で置いた行なら、その行の em の箱より下の長さ。そうでなければ 0 */
  private gridPrevTrail(at: number): number {
    return Math.abs(this.gridPrev.end - at) < EPS ? this.gridPrev.trail : 0;
  }

  /**
   * 行グリッドの中の行の積み方 (アンテナハウスの baseline-grid): 行グリッドの中では行の前後に半行間を空けず、字の仮想ボディ (em の箱) を
   * 積む。行の基線は、em の箱の上端が「すぐ上の行の em の箱の下端」(prevTrail でその行の下の半行間を除く。上が行でなければ lineTop) より
   * 上に出ない、最初の格子に載せる。box: この行の em の箱の上 (gridEmOf) と prevTrail。
   * 見本の PDF の基線の位置との比較による (字の小さい行の後ろの行は次の格子、字の大きい見出しの行は em の箱が入る格子、
   * その次の本文の行は次の格子。行の高さ (line-height) の大きさでは送らない)
   */
  private gridDelta(lineTop: number, lm: LineMetrics, st: ResolvedStyle, simOrigin?: number, box?: { above: number; prevTrail: number }): number {
    let f: Frame | undefined;
    for (let k = this.stack.length - 1; k >= 0; k--)
      if (this.stack[k].grid !== undefined) {
        f = this.stack[k];
        break;
      }
    if (f && !f.grid) return 0;
    const g = f ? f.grid! : this.outerGrid;
    if (!g || this.wm !== 'horizontal-tb') return 0;
    const { pitch, ascent } = g;
    if (pitch <= EPS) return 0;
    // 箱がまだ開いていなければ、最初の行の上端 (箱が開く位置。行数を見積もるときは simOrigin) が基準
    const origin = f ? (f.opened ? f.contentStartB : (simOrigin ?? lineTop)) : this.outerGrid!.origin;
    const em = lineTop + lm.leading / 2 + lm.above;
    const cand = lineTop - (box?.prevTrail ?? 0) + (box?.above ?? this.nominalRatio(st) * st.fontSize);
    const steps = Math.max(0, Math.ceil((cand - origin - ascent - 0.5) / pitch));
    return origin + ascent + steps * pitch - em;
  }

  /**
   * 行グリッドに揃えるために最初の行を下げるとき、まだ中に何も置いていない箱 (背景・罫線のあるもの) は、箱ごと下げる
   * (空きは箱の外になり、背景をその空きまで塗らない)。
   * 下げたら true
   */
  private shiftEmptyBoxes(d: number): boolean {
    let k = this.stack.length;
    while (k > 0 && this.stack[k - 1].opened && this.stack[k - 1].grid === undefined && this.stack[k - 1].node.children.length === 0) k--;
    const chain = this.stack.slice(k);
    if (!chain.length || !chain.some((f) => f.node.bg || f.node.bgImage || f.desc.bw.bs > 0 || f.desc.bw.is > 0)) return false;
    chain[0].node.b += d;
    for (const f of chain) {
      f.startB += d;
      f.contentStartB += d;
    }
    this.cursor += d;
    return true;
  }

  // ── インライン行 ──

  private layoutInlineRun(run: InlineChild[], st: ResolvedStyle, first: boolean, from?: { arr: object; at: number }) {
    this.rootStyle ??= st;
    // 段落の最初の字 (initial-letter) の箱に、最初の行の字下げを移した: 続く行内の並びには掛けない
    if (this.skipIndent) {
      this.skipIndent = false;
      if (st.textIndent) st = { ...st, textIndent: 0 };
    }
    // 索引のページ番号の並び (XSL 1.1 §6.10.7) は、ここで字と行内の箱に置き換える (索引を使う文書だけ)
    if (this.host.index) run = this.host.index(run);
    const L = this.contentI();
    const floating = this.deferredFloats.length > 0 || this.floats.some((f) => f.b1 > this.cursor + this.pendingValue() + EPS);
    // 同じ段落を同じ幅で組み直すとき (段の高さ揃え・keep-with-next の試し組みなど) は、行分けの結果を使い回す
    const memo = !floating && from ? lineMemoGet(from.arr, from.at, run, st, L, first, this.wm, this.host, this.intrinsic, this.minContent) : undefined;
    let atoms: Atom[];
    let raws: RawLine[];
    let pls: PositionedLine[];
    let lms: LineMetrics[];
    if (memo) ({ atoms, raws, pls, lms } = memo);
    else {
      const flat = (r: InlineChild[]) => flattenInline(r, st, this.host.measurer, {
        run: 0,
        footnote: this.foot ? { label: (fn) => this.foot!.label(fn), scale: this.foot.referenceScale } : undefined,
        cite: (id, last, format, physical, style) => this.host.cite(id, last, format, physical, style, this.host.pageNumber?.()),
        image: (c, ps) => this.imageBox(c, ps),
        inlineBox: (c, ps) => this.inlineContainerBox(c, ps),
        containerI: L,
        // アンテナハウス互換では、ギリシャ文字・キリル文字の語を欧文の書体に替えない (その製品に合わせる指定なので、書体の選び方を変えない)
        ...(this.host.kernAh ? { noLatinWords: true } : {}),
        ...(this.intrinsic ? { intrinsic: true } : {}),
      });
      // ::first-line (CSS): 包んだ inline の書式は、最初の行の字だけに当てる。最初の行は、その書式で組んで決める
      const fl = run.length === 1 && typeof run[0] === 'object' && (run[0] as LInline).type === 'inline' && (run[0] as LInline).firstLine ? (run[0] as LInline) : undefined;
      atoms = flat(fl ? (fl.children as InlineChild[]) : run);
      if (fl && first) {
        const styled = flat(run);
        if (styled.length === atoms.length) {
          markLineBreaks(styled);
          const { next } = breakOne(styled, 0, L, lineIndent(st, true, false), true);
          atoms = [...styled.slice(0, next), ...atoms.slice(next)];
        }
      }
      // 入力の節の番号の無い字 (block の直下の文字) は、それを含む block の番号
      const blockRef = this.stack[this.stack.length - 1]?.desc.ref;
      if (blockRef !== undefined) for (const a of atoms) a.ref ??= blockRef;
      glueAfterCssLeaders(atoms);
      markLineBreaks(atoms);
      // 互換モードのセルの最小の幅: 印の付いた img の前後は改行の機会にしない (Quirks Mode Standard §3.8)
      if (this.minContent)
        atoms.forEach((a, i) => {
          if (!a.noWrapInCellMin) return;
          a.lbBefore = false;
          if (atoms[i + 1]) atoms[i + 1].lbBefore = false;
        });
      if (this.intrinsic) for (const a of atoms) a.intrinsic = true;
      // 中身の無い目印 (<a id="…"></a>) だけの並びは、行を作らない (字も中身も枠も無い行の箱は高さ 0。CSS 2.1 §9.4.2)。id だけを記録する
      if (atoms.some((a) => a.idMark) && atoms.every((a) => a.idMark || (a.kind === 'glyph' && a.isSpace))) {
        for (const a of atoms)
          if (a.src) {
            // 索引の目印は、次の内容が置かれるページで記録する (マーカーと同じ道で運ぶ)。ほかの id は、いまのページ
            const ip = this.host.indexPoint?.(a.src);
            if (ip === 'point' || (ip === 'end' && !this.pages)) this.markerSink.push({ className: INDEX_POINT_MARKER.className, marker: INDEX_POINT_MARKER, indexId: a.src });
            else this.pages?.noteId(a.src);
          }
        return;
      }
      const ms = this.host.measurer;
      if (this.host.hyphenate) markHyphenation(atoms, this.host.hyphenate, ms, this.wm);
      // ソフトハイフンの位置にも、指定した字数の制限 (hyphenate-limit-chars など) を当てる (制限の指定が無ければ何もしない)
      if (atoms.some((a) => a.softHyphen && a.st.hyphenLimits)) limitSoftHyphens(atoms);
      const kernAh = !!this.host.kernAh;
      adjustJapaneseSpacing(
        atoms,
        this.wm === 'horizontal-tb'
          ? (a, b) => {
              if (!sameFeatures(fontFeaturesBetweenUnits(a.st), fontFeaturesBetweenUnits(b.st))) return 0;
              // インド系・ラオ・チベット・ミャンマー・クメールの字の単位 (2 字以上) は、単位のまま書体に渡して引く
              if ((a.cluster || b.cluster) && kernScript(a.last))
                return ms.kernUnits(a.cluster ?? a.last, b.cluster ?? b.first, a.cluster ? lastBaseOfUnit(a.cluster) : a.last, { fontFamily: a.st.fontFamily, fontWeight: a.st.fontWeight, features: fontFeaturesBetweenUnits(a.st), featuresA: a.st.fontFeatures, featuresB: b.st.fontFeatures }) * a.st.fontSize;
              return ms.kern(a.last, b.first, { fontFamily: a.st.fontFamily, fontWeight: a.st.fontWeight, features: a.st.fontFeatures, ...(kernAh ? { skipClass0: true } : {}), ...(a.latinWord || b.latinWord ? { latinWord: true } : {}) }) * a.st.fontSize;
            }
          : undefined,
        kernAh,
      );
      // ハングルの語の間の空白は、書体が文脈で決める幅にする (ハングルの字が無ければ何もしない)
      adjustHangulWordSpaces(atoms, (p, n, s) => ms.contextSpaceDelta(p, n, { fontFamily: s.fontFamily, fontWeight: s.fontWeight }));
      // 双方向のテキスト (UAX #9): 段落の字の深さを決める。並べ替えは行ごと (reorderLine)
      // 縦書きの段落は、上から下 (左から右と同じ深さ 0) として並べる (direction の rtl の縦書きの配置は扱わない)
      markBidi(atoms, this.wm === 'horizontal-tb' && st.direction === 'rtl', ms, this.wm, st.unicodeBidi);
      // 回り込みがある (または次ページ先頭に float が来る) 場合は、行ごとに使える幅が変わるので 1 行ずつ組む
      if (floating) {
        this.layoutInlineRunFloating(atoms, st, first);
        return;
      }
      raws = breakLines(atoms, L, 0, true, { st, first }, st.hyphenLimits, this.wm);
      pls = raws.map((r) => positionLine(r, L, st));
      for (const pl of pls) reorderLine(pl, L, this.wm === 'horizontal-tb' && st.direction === 'rtl');
      const wm = this.wm;
      const nominal = this.nominalRatio(st);
      const strut = this.strutOf(st);
      const nominalDiff = this.nominalDiff(st);
      lms = pls.map((pl) => lineMetrics(pl, wm, st, nominal, strut, nominalDiff));
      if (from) lineMemoSet(from.arr, from.at, run, st, L, first, wm, this.host, this.intrinsic, this.minContent, { atoms, raws, pls, lms });
    }
    // 行ごとの脚注 (ページを持つ Flow だけが本体を積む)
    const useFoot = !!this.foot && !!this.pages && this.ownFoot && !this.measureOnly;
    const refs = pls.map((pl) => lineFootnotes(pl.raw.items));
    // セル・コンテナの中 (ページを持たない Flow): 脚注は行に持たせ、親がその行を含む箱をページに置くときに積む
    const holdFoot = this.holdsFootnotes(useFoot);
    const n = pls.length;
    let idx = 0;
    while (idx < n) {
      this.applyPendingBreak();
      const pv = this.pendingValue();
      // 現ページに入る行数をシミュレート
      let c = this.cursor + pv;
      let above = this.adjacent + pv;
      const reserve = this.stack.reduce((a, f) => a + f.desc.bpEnd, 0);
      // 断片の末尾にも残す罫線・余白 (conditionality="retain") の分。行の後でページが切れても、その分は本文領域に収める
      const keepRetain = this.stack.reduce((a, f) => a + (f.opened ? f.desc.keepEnd.size : 0), 0);
      // 段落の箱の space-after を残す指定 (retain) なら、最後の行はその余白まで本文領域に入る場合だけ置く (XSL §4.3.1・§5.3.2)
      const topDesc = this.top()?.desc;
      const retainAfter = topDesc?.retainBe ? Math.max(topDesc.m.be, 0) : 0;
      let fit = 0;
      let resv = this.footReserve;
      let nFoot = this.footnotes.length;
      let simOrigin: number | undefined;
      const inGrid = this.inGrid();
      for (let k = idx; k < n; k++) {
        const lm = lms[k];
        const extra0 = this.rubyRoom(lm, st, above) - (k === idx ? this.discardTopLeading(lm, st) : precedenceCut(lms[k - 1], lm, st));
        if (k === idx) simOrigin = c + extra0;
        // 行グリッドの中: すぐ上の行は、この段落の前の行、または (保留中の余白が無ければ) 直前に置いた行
        const gbox = inGrid
          ? {
              above: this.gridEmOf(pls[k], st).above,
              prevTrail: k === idx ? (pv ? 0 : this.gridPrevTrail(this.cursor)) : this.gridEmTrailOf(lms[k - 1], this.gridEmOf(pls[k - 1], st).below),
            }
          : undefined;
        const extra = extra0 + this.gridDelta(c + extra0, lm, st, simOrigin, gbox);
        const h = extra + lm.base;
        const tail = k === n - 1 ? reserve + retainAfter : keepRetain;
        // 行グリッドの中では、最後の行の後ろの半行間は空けない (アンテナハウスの baseline-grid)。入るかの判定に数えない
        const gridTrail = this.gridTrailOf(lm, st);
        // 参照を含む行は「行 + その脚注」が一緒に入る場合だけ置く (入らなければ参照行ごと次ページへ)
        const { count, inc } = this.footCostOfRefs(refs[k], useFoot, nFoot);
        if (c + h - gridTrail + tail + resv + inc > this.limit + EPS) break;
        c += h;
        resv += inc;
        nFoot += count;
        above = lm.leading / 2;
        fit++;
      }
      let take = fit;
      const remaining = n - idx - fit;
      if (remaining > 0) {
        // widows / orphans
        if (remaining < st.widows) take = Math.max(0, n - idx - st.widows);
        if (take < st.orphans) take = 0;
      }
      if (take === 0) {
        if (this.pageHasContent) {
          this.breakPage();
          if (this.relayoutIfWidthChanged(L, atoms, raws[idx], st, first && idx === 0)) return;
          continue;
        }
        take = Math.max(1, fit);
        // widows / orphans を守れずに分けた (段の釣り合わせでは、この高さを採らない)
        if (take < n - idx) {
          this.brokeKeep = true;
          this.brokeKeepPage = Math.min(this.brokeKeepPage, this.breakCount);
        }
        if (fit === 0) this.host.warn('行がページに収まりません');
      }
      this.flush();
      this.commitMarkers();
      for (let k = idx; k < idx + take; k++) {
        const lm = lms[k];
        // 同じページの前の行との半行間の重ね合わせ (line-height.precedence)。ページ (参照領域) の先頭の行は、端の半行間を捨てる
        const cut = k === idx ? this.discardTopLeading(lm, st) : precedenceCut(lms[k - 1], lm, st);
        this.placeLine(pls[k], lm, st, { cut, firstOnPage: k === idx, last: k === n - 1, width: L, shift: 0, refs: refs[k], useFoot, holdFoot });
      }
      idx += take;
      if (idx < n) {
        this.breakPage();
        if (this.relayoutIfWidthChanged(L, atoms, raws[idx], st, false)) return;
      }
    }
  }

  /**
   * 行グリッドの中の、行の基線から行の下端までのうち、最初に使える書体の字の下端より下の部分 (半行間など。行の中の inline-block などで
   * 半行間が 0 の行も)。行グリッドの中では、最後の行の後ろにこの分は空けない (アンテナハウスの baseline-grid)。グリッドの外では 0
   */
  private gridTrailOf(lm: LineMetrics, st: ResolvedStyle): number {
    return this.inGrid() ? Math.max(0, lm.base - (lm.topLeading ?? lm.leading / 2) - lm.above - (1 - this.nominalRatio(st)) * st.fontSize) : 0;
  }

  /**
   * 行に含まれる脚注の参照 (refs) の本体を、このページの脚注領域に積むときに増える高さ (inc) と、積む脚注の数 (count)。
   * 本体はここで組む (組んだ結果は FootnoteCtx が覚える)。脚注をこの Flow が積まないとき (useFoot でない) と、側の領域 (sideArea) では 0
   */
  private footCostOfRefs(refs: LFootnote[], useFoot: boolean, existing: number): { count: number; inc: number } {
    const es = useFoot && !this.sideArea() ? refs.map((fn) => this.foot!.entry(fn, this.footWidth())) : [];
    return { count: es.length, inc: es.length ? this.footCost(es, existing) : 0 };
  }

  /**
   * 組んだ 1 行を、このページ (段) の今の位置に置く。回り込みの無い経路 (layoutInlineRun) と回り込みの経路 (layoutInlineRunFloating) で共通。
   * 呼ぶ側は、入るかの判定と flush・commitMarkers を済ませておく。
   *  - cut: 同じページの前の行との半行間の重ね合わせ (precedenceCut)、またはページ (参照領域) の先頭の行の、端の半行間の捨て (discardTopLeading)
   *  - firstOnPage: このページに置く、この段落の最初の行 (行グリッドで、背景・罫線のある空の箱を箱ごと下げるのはこの行だけ)
   *  - last: 段落の最後の行
   *  - width・shift: 行の幅と、回り込みで空ける始端の位置 (回り込みが無ければ 0)
   *  - refs: 行に含まれる脚注の参照。useFoot ならこの Flow が本体を積み、holdFoot なら行に持たせて親に積ませる
   * 置いた行の箱を返す
   */
  private placeLine(
    pl: PositionedLine,
    lm: LineMetrics,
    st: ResolvedStyle,
    o: { cut: number; firstOnPage: boolean; last: boolean; width: number; shift: number; refs: LFootnote[]; useFoot: boolean; holdFoot: boolean },
  ): LNode {
    const extra0 = this.rubyRoom(lm, st, this.adjacent) - o.cut;
    const gem = this.inGrid() ? this.gridEmOf(pl, st) : undefined;
    const gemArg = gem ? { above: gem.above, prevTrail: this.gridPrevTrail(this.cursor) } : undefined;
    let gd = this.gridDelta(this.cursor + extra0, lm, st, undefined, gemArg);
    // 行グリッドの中の、背景・罫線のある空の箱は、字の上端 (基線から nominal の上端) が内容の上端になるまで箱ごと下げる
    // (行の上の半行間などは箱の外)
    const gridTop = this.inGrid() ? Math.max(0, lm.leading / 2 + lm.above - this.nominalRatio(st) * st.fontSize) : 0;
    let shifted = false;
    if (o.firstOnPage && gd + gridTop > EPS && this.shiftEmptyBoxes(gd + gridTop)) {
      gd = this.gridDelta(this.cursor + extra0 - gridTop, lm, st, undefined, gemArg) - gridTop;
      shifted = true;
    }
    const node = buildLineNode(pl, lm, extra0 + gd, this.wm, o.width);
    if (o.holdFoot && o.refs.length) node.fns = o.refs;
    if (st.lineNumber?.mode === 'show' || st.lineNumber?.mode === 'hide') node.lnum = st.lineNumber;
    this.alignByPage(node, pl, st);
    node.i = o.shift;
    node.b = this.cursor - this.contentStartB();
    this.containerNode().children.push(node);
    this.noteIds(node);
    this.cursor += node.bsize;
    // 行グリッドの中の、背景・罫線のある箱の最後の行: 字の下端より下 (半行間など) は箱に入れない (次の行はグリッドに揃うので位置は変わらない)
    const trail = this.gridTrailOf(lm, st);
    const emTrail = gem ? this.gridEmTrailOf(lm, gem.below) : 0;
    if (shifted && o.last) this.cursor -= trail;
    else this.gridTrail = { end: this.cursor, trail };
    // 次の行が em の箱を続けるための控え (行グリッドの中で置いた行だけ)
    this.gridPrev = gem ? { end: this.cursor, trail: shifted && o.last ? Math.max(0, emTrail - trail) : emTrail } : { end: -1, trail: 0 };
    this.adjacent = lm.leading / 2;
    this.noteLineEnd(lm, st);
    this.notePlaced();
    this.pageItems++;
    this.headerOnly = false;
    if (o.useFoot) for (const fn of o.refs) this.addFootnote(fn, this.cursor - node.bsize);
    if (o.useFoot) for (const fn of o.refs) this.foot!.placed(fn, this.host.pageNumber?.() ?? 0);
    return node;
  }

  /**
   * 改ページで本文の幅が変わった (幅の違うページマスター) とき、段落の残り (raw から先の atom) を新しい幅で 1 行ずつ組み直す。
   * 組み直したら true
   */
  private relayoutIfWidthChanged(L: number, atoms: Atom[], raw: RawLine, st: ResolvedStyle, first: boolean): boolean {
    if (Math.abs(this.contentI() - L) <= EPS) return false;
    // 行を切り出した後で足した枠の空き (frameEdge) は、元の並びに無いので飛ばす
    const head = raw.items.find((a) => !a.frameEdge) ?? raw.metric;
    const at = head ? atoms.indexOf(head) : -1;
    if (at < 0) return false;
    this.layoutInlineRunFloating(atoms.slice(at), st, first);
    return true;
  }

  /**
   * ブロックの nominal-font (XSL §5.5.7: font-family などの指定で選ぶ書体) の基準線の位置 (字の上端からの比)。
   * 総称の書体名 (serif など) を和文と欧文の書体の組に当てているので、日本語・中国語・韓国語の文書 (言語の指定が無いときも)
   * は組の和文の書体、それ以外の言語の文書は欧文の書体を nominal-font とする
   */
  /**
   * 支柱 (CSS 2.1 §10.8.1) の基線の上・下の長さ。CSS の行だけ (XSL・互換モード・支柱を持たないブロックでは undefined)。
   * 横書き: 最初に使える書体 (空白の字の書体。CSS Inline 3 §5.3) の上下の高さに line-height を割り振る (行の字と同じ計算)。
   * 縦書き: text-orientation が mixed・upright なら字は中央の基線 (central。em の箱の中央) にそろう (CSS Writing Modes 4 §4.2) ので、
   * line-height の半分ずつ (sideways の欧文の基線は分けない。縦書きの行の字の上下 (atomAboveBelow) も em の半分ずつ)
   */
  private strutOf(st: ResolvedStyle): { above: number; below: number } | undefined {
    if (st.noStrut || st.xslLineStacking || st.boxLineHalfLeading || st.lineStackingStrategy || !st.primaryFontMetrics) return undefined;
    if (this.wm !== 'horizontal-tb') {
      const lh = lineHeightOf(st);
      return { above: lh / 2, below: lh / 2 };
    }
    const run = { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch };
    const font = this.host.measurer.glyph(primaryChar(st), run, 'horizontal-tb').font;
    const fs = st.fontSize;
    const lh = lineHeightOf(st);
    if (st.fontLineMetrics) {
      const d = font.ascentMinusDescent * fs;
      return { above: (lh + d) / 2, below: (lh - d) / 2 };
    }
    const half = (lh - fs) / 2;
    return { above: font.baselineRatio * fs + half, below: (1 - font.baselineRatio) * fs + half };
  }

  private nominalRatio(st: ResolvedStyle): number {
    const latinDoc = !!st.language && !/^(ja|zh|ko)\b/i.test(st.language);
    const run = { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch };
    // HTML (primaryFontMetrics): 最初に使える書体 (空白の字の書体) の値 (CSS Inline 3 §5.3)
    if (st.primaryFontMetrics) return this.host.measurer.glyph(primaryChar(st), run, 'horizontal-tb').font.baselineRatio;
    return this.host.measurer.glyph(latinDoc ? 'x' : '\u56FD', run, 'horizontal-tb').font.baselineRatio;
  }

  /**
   * XSL-FO の互換モードのブロック (字ごとの書体の上下で行の高さを決める fontLineMetrics と、互換モードの行の印の両方を持つ) の、
   * nominal-font (nominalRatio と同じ決め方) の上下の高さの差 (ascent − descent。em の比)。行の高さの計算で、ブロックと同じ書体の指定の字に使う
   * (和文と欧文の混じる行を広げない。lineMetrics.ts の fontLineMetricsOf)。それ以外のブロック (HTML・仕様モード・API から直接組む LNode) は undefined
   */
  private nominalDiff(st: ResolvedStyle): number | undefined {
    if (!st.fontLineMetrics || st.primaryFontMetrics || st.xslLineStacking || !(st.boxLineHalfLeading || st.blockLeadingMaxHeight)) return undefined;
    const latinDoc = !!st.language && !/^(ja|zh|ko)\b/i.test(st.language);
    const run = { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch };
    return this.host.measurer.glyph(latinDoc ? 'x' : '\u56FD', run, 'horizontal-tb').font.ascentMinusDescent;
  }

  /**
   * line-height.conditionality="discard": 参照領域 (ページ・段・ブロックコンテナ) にまだ何も置いていないとき、
   * 最初の行の上の半行間を捨てる量 (XSL §7.16.4)。それ以外は 0
   */
  /** 最後に置いた行の下端と、line-height.conditionality="discard" なら、その行の下の半行間 (段・ページの終わりで捨てる) */
  private lastLine = { end: -1, trim: 0 };
  /** 高さ未指定のブロックコンテナ (参照領域) を始めたときの pageItems (その中にまだ何も置いていなければ同じ値) */
  private refStartItems = -1;
  /** 参照領域 (ページ・段・コンテナ) の端から、上の罫線・余白 (padding) のあるブロックを開いたか */
  private edgeBlocked = false;
  private noteLineEnd(lm: { leading: number; bottomLeading?: number }, st: ResolvedStyle) {
    this.lastLine = { end: this.cursor, trim: discardsLeading(st) ? Math.max(lm.bottomLeading ?? lm.leading / 2, 0) : 0 };
    this.lastLead = { end: this.cursor, half: Math.max(lm.bottomLeading ?? lm.leading / 2, 0) };
  }
  /** 最後に置いた行の下端と、その行の下の部分 (行グリッドの中の行で、字の下端より下。段の終わりでは数えない) */
  private gridTrail = { end: -1, trail: 0 };
  /** 最後に置いた行の下端と、その行の下の半行間 */
  lastLead = { end: -1, half: 0 };
  /** 中身の終わり: 最後に置いたのが行で、その行の下の半行間を捨てるなら、捨てた位置 */
  private endAfterLastLine(): number {
    return this.lastLine.trim && Math.abs(this.lastLine.end - this.cursor) < EPS ? this.cursor - this.lastLine.trim : this.cursor;
  }

  /**
   * ルビのある行の上に足す空き。
   *  - CSS (primaryFontMetrics): CSS Ruby 1 §3.6。ルビは行の高さに数えず、line-height がルビと親文字を合わせた高さより小さいときだけ、
   *    同じ行を重ねてもルビが重ならないだけの行間 (ルビの高さ − 行間) を足す。前の内容や余白へのはみ出しは許す
   *  - XSL-FO: ルビが、半行間と上の余白 (room) に収まらない分を空ける
   */
  private rubyRoom(lm: LineMetrics, st: ResolvedStyle, room: number): number {
    if (!(lm.rubyExtent > 0)) return 0;
    // 後ろ側に注釈のある行: 前に足す分は、行の寸法で分けてある (後ろに足す分は、行の高さ lm.base に入っている)
    if (lm.rubyBefore !== undefined) return lm.rubyBefore;
    if (st.primaryFontMetrics) return Math.max(0, lm.rubyExtent - lm.leading);
    return Math.max(0, lm.rubyExtent - lm.leading / 2 - room);
  }

  private discardTopLeading(lm: { leading: number; topLeading?: number }, st: ResolvedStyle): number {
    // 参照領域の端と行の間に、罫線・余白 (padding) のあるブロックの端があれば、行の半行間は端に接しないので捨てない (§4.3.1)
    const atEdge = (!this.pageHasContent || this.pageItems === this.refStartItems) && !this.edgeBlocked && !this.stack.some((f) => !f.opened && f.desc.bpStart > 0);
    return discardsLeading(st) && atEdge ? Math.max(lm.topLeading ?? lm.leading / 2, 0) : 0;
  }

  /**
   * 回り込みを避けながら 1 行ずつ組む。
   * 行の block 区間 [y0, y0+行高) に重なる float から、その行の開始位置 (shift) と幅を決めて breakOne で切り出す。
   * ページ跨ぎは行単位で判定する (この経路では widows/orphans は考慮しない)。
   */
  private layoutInlineRunFloating(atoms: ReturnType<typeof flattenInline>, st: ResolvedStyle, first: boolean) {
    const n = atoms.length;
    const useFoot = !!this.foot && !!this.pages && this.ownFoot && !this.measureOnly;
    const holdFoot = this.holdsFootnotes(useFoot);
    const reserve = () => this.stack.reduce((a, f) => a + f.desc.bpEnd, 0);
    let start = 0;
    let firstLine = first;
    // このページに置いた、この段落の行 (widows で次のページへ送り直すため)
    let placedHere: Array<{ node: LNode; start: number; first: boolean; cursor: number; adjacent: number; fns: boolean; lm: LineMetrics; hyRun: number }> = [];
    // 直前まで続けて分綴した行の数 (hyphenate-limit-lines・hyphenation-ladder-count。行を置いたときに進める)
    let hyRun = 0;
    while (start < n) {
      this.applyPendingBreak();
      const pv = this.pendingValue();
      const y0 = this.cursor + pv;
      const range = this.lineRange(y0, y0 + Math.max(lineHeightOf(st), st.fontSize));
      if (range.intruded && range.width < st.fontSize * 2) {
        // 狭すぎて 1 字も置けない: 回り込みの下まで進める。
        // 進めても行の位置が下がらないとき (位置が数にならないなど) は、同じ float に当たり続けるので、狭いままここに組む
        this.pendMin = Math.max(this.pendMin, range.clearTo - this.cursor);
        if (this.pendingValue() > pv + EPS) continue;
      }
      // box-decoration-break: clone の枠 (breakOneBoxed) が外、最後の行の端のずらし・分綴の制限 (breakOneLast) が内。
      // 切り直しで試した行では分綴の続きの数を進めない (採った行の分だけ、hyState に残す)
      const hyState = { run: hyRun };
      const indentHere = lineIndent(st, firstLine, startsAfterForcedBreak(atoms, start));
      const { line, next } = breakOneBoxed(atoms, start, range.width, indentHere, true, this.wm, (w, hang) => {
        const state = { run: hyRun };
        const r = breakOneLast(atoms, start, w, indentHere, hang, st.lastLineEndIndent, st.hyphenLimits ? { lim: st.hyphenLimits, state, nextIndent: lineIndent(st, false, false) } : undefined);
        hyState.run = state.run;
        return r;
      });
      const pl = positionLine(line, range.width, st);
      reorderLine(pl, range.width, this.wm === 'horizontal-tb' && st.direction === 'rtl');
      const lm = lineMetrics(pl, this.wm, st, this.nominalRatio(st), this.strutOf(st), this.nominalDiff(st));
      const refs = lineFootnotes(pl.raw.items);
      const { inc } = this.footCostOfRefs(refs, useFoot, this.footnotes.length);
      // 同じページに置いた、この段落の前の行との半行間の重ね合わせ (line-height.precedence)
      const prevLm = placedHere.length ? placedHere[placedHere.length - 1].lm : undefined;
      const cut = prevLm ? precedenceCut(prevLm, lm, st) : this.discardTopLeading(lm, st);
      const extra0 = this.rubyRoom(lm, st, this.adjacent + pv) - cut;
      const tail = next >= n ? reserve() : 0;
      // 行グリッド: 回り込みの無い経路 (layoutInlineRun) と同じく、行の基線をグリッドに揃える分を足し、最後の行の下の部分は入るかの判定に数えない
      const gdSim = this.gridDelta(y0 + extra0, lm, st, y0 + extra0, this.inGrid() ? { above: this.gridEmOf(pl, st).above, prevTrail: pv ? 0 : this.gridPrevTrail(this.cursor) } : undefined);
      const gridTrail = this.gridTrailOf(lm, st);
      if (this.paginating && this.cursor + pv + extra0 + gdSim + lm.base - gridTrail + tail + this.footReserve + inc > this.limit + EPS) {
        if (this.pageHasContent) {
          // widows / orphans: 次のページへ行く行が widows より少なければ、このページに置いた行を送る
          // (残りの行の数は、回り込みの無い幅で数える)
          const k = this.widowShift(atoms, start, placedHere, st, firstLine, hyRun);
          if (k > 0) {
            const back = placedHere[placedHere.length - k];
            hyRun = back.hyRun;
            const kids = this.containerNode().children;
            for (let j = 0; j < k; j++) kids.splice(kids.lastIndexOf(placedHere[placedHere.length - 1 - j].node), 1);
            this.cursor = back.cursor;
            this.adjacent = back.adjacent;
            this.pageItems -= k;
            start = back.start;
            firstLine = back.first;
          }
          placedHere = [];
          this.breakPage();
          continue; // 新ページでは回り込みの状況が変わるので、行を組み直す
        }
        this.host.warn('行がページに収まりません');
      }
      const before = { cursor: this.cursor, adjacent: this.adjacent };
      this.flush();
      this.commitMarkers();
      // 行を置く (回り込みの無い経路と共通)。幅は回り込みを避けた range の幅、始端は range.shift
      const node = this.placeLine(pl, lm, st, { cut, firstOnPage: !placedHere.length, last: next >= n, width: range.width, shift: range.shift, refs, useFoot, holdFoot });
      placedHere.push({ node, start, first: firstLine, cursor: before.cursor, adjacent: before.adjacent, fns: refs.length > 0, lm, hyRun });
      hyRun = hyState.run;
      // clear のある強制改行 (br): 次の行を、その側の回り込みの下から始める
      const brk = atoms[next - 1];
      if (brk?.kind === 'break' && brk.st.breakClear) {
        const y = this.floatBottom(brk.st.breakClear);
        if (y > this.cursor) this.pendMin = Math.max(this.pendMin, y - this.cursor);
      }
      start = next;
      firstLine = false;
    }
  }

  /**
   * 回り込みの経路の widows / orphans: ページを分けるとき、このページに置いた行のうち、次のページへ送る行の数。
   * 残りの行 (start から) が widows に満たなければ、その不足分を送る。送った後にこのページに残る行が orphans に満たなければ
   * (段落がこのページで始まっていれば) 段落ごと送る。脚注の参照を含む行や、ページにほかの中身が無くなるときは送らない
   */
  private widowShift(atoms: ReturnType<typeof flattenInline>, start: number, placed: Array<{ first: boolean; fns: boolean }>, st: ResolvedStyle, firstLine: boolean, hyRun = 0): number {
    if (!placed.length || this.measureOnly) return 0;
    const widows = st.widows ?? 2;
    const orphans = st.orphans ?? 2;
    // 残りの行の数 (widows まで数えれば足りる)
    const w = this.contentI();
    let r = 0;
    const hyState = { run: hyRun };
    for (let s = start, fl = firstLine; s < atoms.length && r < widows; r++) {
      const ind = lineIndent(st, fl, startsAfterForcedBreak(atoms, s));
      const from = s;
      const run0 = hyState.run;
      const { next } = breakOneBoxed(atoms, s, w, ind, true, this.wm, (len, hang) => {
        hyState.run = run0;
        return breakOneLimited(atoms, from, len, ind, hang, st.hyphenLimits, hyState, lineIndent(st, false, false));
      });
      if (next <= s) break;
      s = next;
      fl = false;
    }
    if (r >= widows) return 0;
    let k = Math.min(widows - r, placed.length);
    const startsHere = placed[0].first;
    if (startsHere && placed.length - k < orphans) k = placed.length;
    if (placed.slice(placed.length - k).some((p) => p.fns)) return 0;
    // ページにほかの中身が無くなるなら送らない (送っても次のページで同じことになる)
    if (k >= this.pageItems) return 0;
    return k;
  }

  // ── 行内の箱 (画像・inline-container) ──

  /** 画像を行内の箱として組む。画像データが無ければ、指定サイズ (既定 60×40pt) のプレースホルダ */
  private imageBox(c: LImage, st: ResolvedStyle): BoxSpec {
    const asset = this.host.assets?.get(c.src);
    if (asset?.unsupported) this.host.warn(`画像 ${c.src} を描けないため、仮の枠で描きます (${asset.unsupported})`);
    // 画像が見つからない・中身が画像でない (読めない) ときは、黙って省かずに知らせる (instream-foreign-object の仮の名前は除く)
    if (this.host.assets && !asset && !this.measureOnly && !c.src.startsWith('instream-foreign-object:')) this.host.warn(`画像 ${c.src} が見つからないか、中身を画像として読めません`);
    // 画像本来の大きさ (pt)。intrinsicFromImage なら、画像に書かれた解像度で決める
    const k = c.intrinsicFromImage && asset?.dpi ? 96 / asset.dpi : 1;
    const nat = asset ? { w: asset.width * 0.75 * k, h: asset.height * 0.75 * k } : undefined;
    // 画像に書かれた解像度を優先する (image-resolution: from-image)。書かれていなければ widthScale / heightScale
    const own = c.resolutionFromImage && asset?.dpi ? 96 / asset.dpi : undefined;
    const ws = own ?? c.widthScale;
    const hs = own ?? c.heightScale;
    let w = c.width ?? (nat && ws !== undefined ? nat.w * ws : undefined);
    let h = c.height ?? (nat && hs !== undefined ? nat.h * hs : undefined);
    if (w !== undefined && h !== undefined && (ws !== undefined || hs !== undefined) && c.width === undefined && c.height === undefined) {
      // 倍率で指定された寸法は、そのまま使う (縦横比を保つ縮尺の対象にしない)
    } else if (w === undefined && h === undefined) {
      w = nat?.w ?? 60;
      h = nat?.h ?? 40;
    } else if (w === undefined) w = nat ? (h! * nat.w) / nat.h : h! * 1.5;
    else if (h === undefined) h = nat ? (w * nat.h) / nat.w : w / 1.5;
    else if (c.scaling !== 'non-uniform' && !c.fit && nat) {
      const k = Math.min(w / nat.w, h / nat.h);
      w = nat.w * k;
      h = nat.h * k;
    }
    // scale-down-to-fit・scale-up-to-fit: 倍率を 1 倍で止める (XSL §7.15.4・§7.15.5)
    if (c.fitLimit && nat && nat.w > 0 && nat.h > 0 && w !== undefined && h !== undefined) {
      const cap = (k: number, m?: 'down' | 'up') => (m === 'down' ? Math.min(k, 1) : m === 'up' ? Math.max(k, 1) : k);
      if (c.scaling === 'non-uniform') {
        w = nat.w * cap(w / nat.w, c.fitLimit.w);
        h = nat.h * cap(h / nat.h, c.fitLimit.h);
      } else {
        // 縦横の比を保つ: 倍率は 1 つ
        const lims = [c.fitLimit.w, c.fitLimit.h];
        let k = w / nat.w;
        if (lims.includes('down')) k = Math.min(k, 1);
        if (lims.includes('up')) k = Math.max(k, 1);
        w = nat.w * k;
        h = nat.h * k;
      }
    }
    const horizontal = st.wm === 'horizontal-tb';
    let node = newNode('image', st.wm, {
      isize: horizontal ? w : h!,
      bsize: horizontal ? h! : w,
      // 大きさだけ分かって描けない画像 (TIFF・WMF などの未対応の形式) も、仮の枠で描く
      image: {
        src: c.src,
        missing: !asset || asset.drawable === false,
        alt: c.alt,
        ...(c.fit && c.fit !== 'fill' && nat ? { fit: c.fit, naturalWidth: nat.w, naturalHeight: nat.h, ...(c.fitPosition ? { fitPosition: c.fitPosition } : {}) } : {}),
        // scaling="non-uniform" (XSL §7.15.11): 縦横の比を変えて枠へ引き伸ばす (SVG も preserveAspectRatio によらず)
        ...(c.scaling === 'non-uniform' && c.width !== undefined && c.height !== undefined ? { stretch: true } : {}),
        // 見えない要素 (CSS の visibility: hidden。読み込みが字の色を transparent にして運ぶ) の画像は、場所を残して描かない
        ...(st.color === 'transparent' ? { hidden: true } : {}),
      },
      ...(c.id ? { src: c.id } : {}),
      ...(c.borderRadius ? { radius: c.borderRadius } : {}),
      ref: sourceRef(c),
    });
    // 画像を置く枠 (viewport): 枠の大きさの箱の中に、text-align / display-align で揃えて置く
    const vp = c.viewport;
    if (vp) {
      const VW = Math.max(vp.width ?? w, 0);
      const VH = Math.max(vp.height ?? h!, 0);
      const f = (a?: 'start' | 'center' | 'end') => (a === 'center' ? 0.5 : a === 'end' ? 1 : 0);
      const pw = horizontal ? VW : VH; // 枠の inline / block 方向の長さ
      const pb = horizontal ? VH : VW;
      node.i = (pw - node.isize) * f(vp.align);
      node.b = (pb - node.bsize) * f(vp.blockAlign);
      node = newNode('block', st.wm, { isize: pw, bsize: pb, children: [node] });
      w = VW;
      h = VH;
    }
    // 罫線・余白・背景色: 画像 (枠) を、それらを持つ箱で包む
    if (c.border || c.padding || c.backgroundColor) {
      const d = describeBox({ border: c.border, padding: c.padding, backgroundColor: c.backgroundColor } as LBlock, st.wm);
      const bpB = d.bpStart + d.bpEnd;
      node = newNode('block', st.wm, { isize: node.isize + d.bpI, bsize: node.bsize + bpB, padding: { ...d.paddingP }, border: { ...d.borderP }, bg: d.bg, children: [node] });
      w = horizontal ? w + d.bpI : w + bpB;
      h = horizontal ? h! + bpB : h! + d.bpI;
    }
    // 外側の余白 (CSS の margin。置換要素の行内の箱): 余白の分ずらした入れ物で包み、行の中の送りと行の高さに入れる
    // (CSS 2.1 §8.3: 上下の margin は、置換要素でない行内の箱にだけ効かない。§10.8: 行の箱の中での高さは margin の箱の高さ。
    // §10.8.1: 基線の無い箱は、下の margin の端を基線に揃える)。負の余白は、箱を小さくする (0 まで)
    const mg = c.margin !== undefined ? normEdges(c.margin) : undefined;
    if (mg && (mg.top || mg.right || mg.bottom || mg.left)) {
      const inner = bboxOf(node);
      node.i = mg.left;
      node.b = mg.top;
      const wrap = newNode('block', 'horizontal-tb', { isize: Math.max(inner.width + mg.left + mg.right, 0), bsize: Math.max(inner.height + mg.top + mg.bottom, 0), children: [node] });
      const pw = bboxOf(wrap);
      return horizontal ? { node: wrap, adv: pw.width, cross: pw.height, above: pw.height, below: 0 } : { node: wrap, adv: pw.height, cross: pw.width, above: pw.width / 2, below: pw.width / 2 };
    }
    const adv = horizontal ? w : h!;
    const cross = horizontal ? h! : w;
    // 横書きは下端を基線に揃える。縦書きは字面の中央 (above/below は使われない)
    return { node, adv, cross, above: horizontal ? cross : cross / 2, below: horizontal ? 0 : cross / 2 };
  }

  /**
   * inline-container を行内の箱として組む。
   *  inline 方向の寸法が無ければ shrink-to-fit: 行幅で組んで最も長い行の長さを測り、その幅で組み直す。
   *  横書きの箱は、最初の行の基線を周囲の基線に揃える。
   */
  private inlineContainerBox(c: LInlineContainer, ps: ResolvedStyle): BoxSpec {
    const lineWm = ps.wm;
    const st = resolveStyle(ps, c);
    const wmC = st.wm;
    const desc = describeBox(c, wmC);
    const lay = (contentI: number, host: FlowHost = this.host) => {
      // 中の脚注は、中の行に持たせる (holdFootnotes)。この箱を含む行が、自分の脚注として積む (heldFootnotes)
      const sub = new Flow(host, { wm: wmC, rootI: Math.max(contentI, 0), abs: () => [], pageSize: this.pageSize, measure: true, referenceArea: true, footnotes: this.foot, holdFootnotes: true });
      sub.layoutChildren(c.children, st);
      return { sub, used: sub.finishAtomic() };
    };
    let contentI = desc.isizeExplicit;
    let r: ReturnType<typeof lay> | undefined;
    if (contentI == null) {
      const avail = Math.max(this.contentI() - desc.bpI - (lineWm === 'horizontal-tb' ? desc.marginP.left + desc.marginP.right : 0), 0);
      // 使える幅で組んで中身の幅を測り、それより狭ければ中身の幅で組み直す。測った幅は覚えて使い回す (memoMeasure): 同じ箱を同じ幅で
      // もう一度組むとき (外側の箱が 2 度組まれるとき) は、測る組版を省いて、組み直しの 1 回だけにする。
      // 測る組版が出した警告は、省いたときも同じ順で出す
      const got: { first?: ReturnType<typeof lay> } = {};
      const m = this.memoMeasure('ic', c.children, st, [avail, wmC], this.foot, () => {
        const warns: string[] = [];
        got.first = lay(avail, { ...this.host, warn: (w) => (warns.push(w), this.host.warn(w)) });
        return { widest: maxLineLength(got.first.sub.root), warns };
      });
      if (!got.first) for (const w of m.warns) this.host.warn(w);
      contentI = Math.min(avail, Math.ceil(m.widest * 100) / 100 + 0.01);
      // 内容による大きさの語 (CSS Sizing 3 §3.2): auto の大きさ (上の shrink-to-fit) に代えて、または上限・下限として当てる
      const sized = c.inlineSizing ? this.contentSizedInline(c, st, avail, contentI) : undefined;
      if (sized !== undefined && Math.abs(sized - contentI) > EPS) {
        contentI = sized;
        r = lay(contentI);
      } else r = contentI < avail - EPS ? lay(contentI) : (got.first ?? lay(avail, { ...this.host, warn: () => {} }));
    } else if (c.inlineSizing) {
      const avail = Math.max(this.contentI() - desc.bpI - (lineWm === 'horizontal-tb' ? desc.marginP.left + desc.marginP.right : 0), 0);
      contentI = this.contentSizedInline(c, st, avail, contentI)!;
      r = lay(contentI);
    } else r = lay(contentI);
    // 固定の高さの中での内容の配置 (display-align)
    const free = (desc.bsizeExplicit ?? 0) - r.used;
    if (c.blockAlign && c.blockAlign !== 'start' && free > EPS) for (const k of r.sub.root.children) k.b += c.blockAlign === 'center' ? free / 2 : free;
    const node = newNode('block', wmC, {
      isize: contentI + desc.bpI,
      bsize: Math.max(r.used, desc.bsizeExplicit ?? 0) + desc.bpStart + desc.bpEnd,
      margin: { ...desc.marginP },
      padding: { ...desc.paddingP },
      border: { ...desc.borderP },
      bg: desc.bg,
      ...this.decorOf(desc),
      src: desc.src,
      ref: desc.ref,
      children: r.sub.root.children,
    });
    if (c.rotation) node.rot = c.rotation;
    if (c.formField) node.form = c.formField;
    if (c.overflow === 'hidden') node.clip = true;
    if (lineWm === 'horizontal-tb') {
      // 外側のマージンは行の中での寸法に含める (箱を余白の分ずらした入れ物で包む)
      const m = desc.marginP;
      let box: LNode = node;
      if (m.top || m.right || m.bottom || m.left) {
        const inner = bboxOf(node);
        node.i = m.left;
        node.b = m.top;
        box = newNode('block', 'horizontal-tb', { isize: Math.max(inner.width + m.left + m.right, 0), bsize: Math.max(inner.height + m.top + m.bottom, 0), children: [node] });
      }
      const ph = bboxOf(box);
      const inner = bboxOf(node);
      // 行の字面 (いまの文字の大きさ) に対する揃え
      const fs = ps.fontSize;
      const br = DEFAULT_BASELINE_RATIO;
      if (c.formField && !c.rotation) {
        // フォームの欄 (axf:form-field) は正規行内領域。その割り当ての矩形は、block 方向には内容の矩形まで
        // (XSL 1.1 §4.2.3 の normal-allocation-rectangle) なので、罫線・パディング・マージンは行の高さに入れず、行の外へはみ出させる。
        // 内容の矩形は字面の中央にそろえる (高さの違う欄でも、欄の中央を字の中央にそろえる)
        const contentH = Math.max(inner.height - desc.bpStart - desc.bpEnd, 0);
        box.i = 0;
        box.b = -(m.top + desc.bpStart);
        const wrap = newNode('block', 'horizontal-tb', { isize: ph.width, bsize: contentH, children: [box] });
        const up = (br - 0.5) * fs;
        return { node: wrap, adv: ph.width, cross: contentH, above: contentH / 2 + up, below: contentH / 2 - up };
      }
      const ab = c.alignmentBaseline;
      if (ab === 'central') return { node: box, adv: ph.width, cross: ph.height, above: ph.height / 2 + (br - 0.5) * fs, below: ph.height / 2 - (br - 0.5) * fs };
      if (ab === 'before-edge') return { node: box, adv: ph.width, cross: ph.height, above: br * fs, below: ph.height - br * fs };
      if (ab === 'after-edge') return { node: box, adv: ph.width, cross: ph.height, above: ph.height - (1 - br) * fs, below: (1 - br) * fs };
      // 回転した箱は下端 (マージンの外側) を基線に揃える
      const own = c.baselineFrom === 'last' ? (c.overflow === 'hidden' ? undefined : lastBaseline(node)) : firstBaseline(node);
      const fb = wmC === 'horizontal-tb' && !c.rotation ? (own ?? inner.height) + m.top : ph.height;
      return { node: box, adv: ph.width, cross: ph.height, above: fb, below: ph.height - fb };
    }
    // 縦書きの行: 行の進む方向は上下なので、上下の余白は行の中の空き、左右の余白は行の幅の方向の大きさに入る
    // (CSS 2.1 §10.3.9: inline-block の余白は行の中の配置に加わる)。余白の分ずらした入れ物で包む
    // (例: 縦中横の margin-top: 0.15em・margin-bottom: -0.15em では、送りは 1em のまま字を 0.15em 下げる)
    const mv = desc.marginP;
    if (mv.top || mv.right || mv.bottom || mv.left) {
      const inner = bboxOf(node);
      node.i = mv.left;
      node.b = mv.top;
      const wrap = newNode('block', 'horizontal-tb', { isize: Math.max(inner.width + mv.left + mv.right, 0), bsize: Math.max(inner.height + mv.top + mv.bottom, 0), children: [node] });
      const pw = bboxOf(wrap);
      return { node: wrap, adv: pw.height, cross: pw.width, above: pw.width / 2, below: pw.width / 2 };
    }
    const ph = bboxOf(node);
    return { node, adv: ph.height, cross: ph.width, above: ph.width / 2, below: ph.width / 2 };
  }

  // ── 原子的ボックス (直交する書字方向 / ブロックコンテナ) の配置 ──

  /** ブロック方向に extent を消費する葉ボックスを現在位置に置く */
  private placeBox(node: LNode, mbs: number, mbe: number, mis: number, extent: number, precBs: number | 'force' = 0, precBe: number | 'force' = 0, retainBe = false) {
    this.applyPendingBreak();
    this.addMargin(mbs, precBs);
    if (this.paginating && this.pageHasContent && this.cursor + this.pendingValue() + extent + this.heldFootCost([node]) > this.room + EPS) this.breakPage();
    // 改ページした後の (または元から空の) ページにも入らなければ、溢れる (else にすると、改ページした経路では警告が出ない)
    if (this.paginating && !this.pageHasContent && extent > this.room + EPS) this.host.warn('ボックスがページより大きいため溢れます');
    this.flush();
    this.commitMarkers();
    node.i = mis;
    node.b = this.cursor - this.contentStartB();
    this.containerNode().children.push(node);
    this.noteIds(node);
    this.cursor += extent;
    this.placeHeldFootnotes(node);
    this.adjacent = 0;
    this.notePlaced();
    this.pageItems++;
    this.headerOnly = false;
    this.addMargin(mbe, precBe);
    this.keepPending(retainBe);
  }

  private extentAlongBlock(node: LNode): number {
    const s = bboxOf(node);
    return this.wm === 'horizontal-tb' ? s.height : s.width;
  }

  /** 直交する書字方向のブロックを、ページ (親の block 方向) ごとの断片に分けて置く */
  private layoutOrthogonalPaged(node: LBlock | LTable, st: ResolvedStyle, ps: ResolvedStyle) {
    const wmC = st.wm;
    this.applyPendingBreak();
    const minLine = st.fontSize * 4;
    let avail = this.room - this.cursor - this.pendingValue();
    if (avail < minLine && this.pageHasContent) {
      this.breakPage();
      avail = this.room - this.cursor - this.pendingValue();
    }
    const width = this.contentI(); // 子の block 方向に積める長さ (親の幅)
    // CSS: 行の長さは fit-content (中身の最も長い行。ページの残りより長ければページの残り。Writing Modes 3 §7.3)。
    // XSL-FO は従来どおりページの残り
    let mc = 0;
    if (!this.host.xslSpace) {
      const m = new Flow({ ...this.host, warn: () => {} }, { wm: wmC, rootI: Math.max(avail, minLine) * 100, abs: () => [], pageSize: this.pageSize, measure: true, intrinsic: true, footnotes: this.foot });
      m.layoutBlockLevel(node, ps);
      m.finishAtomic();
      mc = maxLineLength(m.root, true, true);
    }
    // max-height (縦書きの箱)・max-width (横書きの箱) は、行の長さの上限 (Writing Modes 3 §7.2。LBlock.maxInlineSize は内容の大きさ)
    const od = describeBox(node, wmC);
    const css = !this.host.xslSpace;
    const sized = css && node.type === 'block' && !node.aspectRatio ? node : undefined;
    let capI = sized?.maxInlineSize !== undefined ? sized.maxInlineSize + od.bpI + od.m.is + od.m.ie : Infinity;
    // 包含ブロック (親のブロック) の高さが決まっていれば、それが使える長さ (§7.3.1。ページの残りより長ければ、ページの残り)
    const cb = this.stack[this.stack.length - 1]?.desc.bsizeExplicit;
    if (css && cb != null) capI = Math.min(capI, Math.max(cb, minLine));
    // min-height (縦書きの箱)・min-width (横書きの箱) は、行の長さの下限 (上限より強い。CSS 2.1 §10.7)
    const floorI = sized?.minInlineSize !== undefined ? sized.minInlineSize + od.bpI + od.m.is + od.m.ie : 0;
    const fitLen = (len: number) => Math.max(Math.min(mc > 0 && mc < len ? mc : len, capI), floorI);
    let lineLen = fitLen(Math.max(avail, minLine));
    /** 最初の断片の行の長さを len にして組む。final でなければ試し組み (マーカー・警告を残さない) */
    const lay = (len: number, final: boolean) => {
      const roots: LNode[] = [newNode('block', wmC, { isize: len })];
      const used: number[] = [];
      const sub = new Flow(final ? this.host : { ...this.host, warn: () => {} }, {
        wm: wmC,
        rootI: roots[0].isize,
        root: roots[0],
        limit: width,
        pages: {
          addMarkers: (list) => {
            if (final) this.markerSink.push(...list);
          },
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          nextPage: () => {
            const r = newNode('block', wmC, { isize: Math.max(Math.min(this.limit, capI), floorI) });
            roots.push(r);
            return { root: r, limit: width, rootI: r.isize };
          },
        },
        abs: final ? this.abs : () => [],
        pageSize: this.pageSize,
        markerSink: final ? this.markerSink : [],
        // 中の脚注は、行に持たせて、断片を置くページの脚注領域に積む (placeBox の placeHeldFootnotes。表のセルと同じ)
        footnotes: this.foot,
        holdFootnotes: true,
      });
      sub.layoutBlockLevel(node, ps);
      sub.finishPaginated();
      return { roots, used };
    };
    const pieces = (r: { roots: LNode[] }) => r.roots.filter((x) => x.children.length).length;
    // keep-together (XSL 1.1 §7.20.3。CSS の break-inside: avoid = Fragmentation 3 §3.2): ページの残りでは分かれ、
    // 次のページなら 1 つに収まるなら、次のページから始める (書字方向の同じブロックの keepTogetherCheck と同じ決まり)
    if (node.keepTogether && this.pageHasContent && Number.isFinite(this.limit) && pieces(lay(lineLen, false)) > 1 && pieces(lay(fitLen(this.limit), false)) === 1) {
      this.breakPage();
      lineLen = fitLen(Math.max(this.room - this.cursor - this.pendingValue(), minLine));
    }
    const { roots, used } = lay(lineLen, true);
    roots.forEach((r, k) => {
      if (!r.children.length) return;
      if (k > 0) this.breakPage();
      const wrap = newNode('block', wmC, { isize: r.isize, bsize: used[k] ?? width, children: r.children });
      // 断片の行の長さは、そのページの残り (最後の断片は中身の長さで足りる)
      this.placeBox(wrap, 0, 0, 0, this.extentAlongBlock(wrap));
    });
  }

  /**
   * 90°・270° 回したコンテナをページに分けて組む。回す前の行の長さはページの残りの高さ (次のページからは本文の高さ)、
   * 回す前の block 方向には本文の幅まで積み、入りきらない分は次のページへ続ける
   */
  private layoutRotatedPaged(node: LBlockContainer, st: ResolvedStyle, rot: 90 | 270) {
    this.applyPendingBreak();
    const minLine = st.fontSize * 4;
    let avail = this.room - this.cursor - this.pendingValue();
    if (avail < minLine && this.pageHasContent) {
      this.breakPage();
      avail = this.room - this.cursor - this.pendingValue();
    }
    const width = this.contentI();
    // 回転した箱の局所の幅 (回転後のページの縦の長さ) は、中身の長さに合わせる (使える長さが上限。shrink-to-fit)。
    // 90°・270° の表は、表の幅 (列の幅の合計 + 字下げ) の長さで本文の上から置く
    const fit = (len: number) => {
      const r = Math.max(len, 1);
      const need = this.memoMeasure('rotfit', node.children, st, [r], this.foot, () => maxLineLength(this.measureSub(node.children, st, r, { footnotes: this.foot }).sub.root, true, true));
      return need > 0 && need < len ? need : len;
    };
    avail = fit(Math.max(avail, minLine));
    const nextLen = Number.isFinite(this.limit) ? fit(this.limit) : this.limit;
    const roots: LNode[] = [newNode('block', st.wm, { isize: avail })];
    const used: number[] = [];
    const sub = new Flow(this.host, {
      wm: st.wm,
      rootI: roots[0].isize,
      root: roots[0],
      limit: width,
      pages: {
        addMarkers: (list) => this.markerSink.push(...list),
        noteId: () => {},
        columnEnd: (u) => used.push(u),
        nextPage: () => {
          const r = newNode('block', st.wm, { isize: nextLen });
          roots.push(r);
          return { root: r, limit: width, rootI: r.isize };
        },
      },
      abs: this.abs,
      pageSize: this.pageSize,
      markerSink: this.markerSink,
      // 中の脚注は、行に持たせて、断片を置くページの脚注領域に積む (placeBox の placeHeldFootnotes)
      footnotes: this.foot,
      holdFootnotes: true,
      // 回した箱は参照領域なので、その先頭の余白は捨てる (XSL §4.3.1。回した表の space-before など)
      ...(this.host.xslSpace ? { discardLeading: true } : {}),
    });
    sub.layoutChildren(node.children, st);
    sub.finishPaginated();
    // 回転した箱がページをまたぐときは、本文の幅いっぱいの箱にする (rotatedFill。1 ページに収まるときは中身の大きさ)
    const fill = !!node.rotatedFill && roots.filter((r) => r.children.length).length > 1;
    roots.forEach((r, k) => {
      if (!r.children.length) return;
      if (k > 0) this.breakPage();
      const wrap = newNode('block', st.wm, { isize: r.isize, bsize: fill ? width : (used[k] ?? width), children: r.children });
      wrap.rot = rot;
      this.placeBox(wrap, 0, 0, 0, this.extentAlongBlock(wrap));
    });
  }

  /**
   * 直交する書字方向の箱の、行の向き (この流れの block 方向) に使える長さ (CSS Writing Modes 3 §7.3.1・§7.3.2)。
   * 包含ブロックのその向きの大きさが決まっていれば、それ (高さの決まったブロックの中・高さの決まったブロックコンテナの中)。
   * 決まっていなければ、ページを持つ流れではページ (段) の残り、ページを持たない流れ (セル・箱の中) では版面の大きさ
   * (§7.3.1 の代わりの大きさ: initial containing block の大きさ)
   */
  private orthogonalAvail(wmC: WritingMode): number {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      if (top.desc.bsizeExplicit != null) return top.desc.bsizeExplicit;
    } else if (this.cbBlock !== undefined) return this.cbBlock;
    if (Number.isFinite(this.limit)) return this.limit - this.cursor - this.pendingValue() - this.footReserve;
    const body = this.pageSize().body;
    return body ? (wmC === 'horizontal-tb' ? body.width : body.height) : this.rootI;
  }

  /**
   * fit-content の大きさ (CSS Sizing 3 §5.1・Writing Modes 3 §7.3.2): min(max-content, max(min-content, 使える長さ))。
   * widthAt は、行の長さを与えて中身のいちばん長い行の長さを返す (min が true なら min-content の計測)
   */
  private fitContent(avail: number, widthAt: (rootI: number, min: boolean) => number): number {
    const pref = widthAt(Math.max(avail, 1) * 100, false);
    if (pref <= avail) return pref;
    return Math.min(Math.max(widthAt(1, true), avail), pref);
  }

  /** 親と直交する書字方向を持つブロック/表 (例: 横書きフロー内の縦書きブロック) */
  private layoutOrthogonal(node: LBlock | LTable, st: ResolvedStyle, ps: ResolvedStyle) {
    // 段の先頭・末尾に寄せる float (before・after・inside・outside) を直下に持つ箱は、ブロックコンテナとして組む
    // (float を箱の内容の block-start・block-end の端に置く。ブロックのまま組むと、float が箱の枠の外の、組む流れの根元に積まれる)
    if (
      node.type === 'block' &&
      node.children.some((c) => typeof c === 'object' && c.type === 'float' && /^(before|after|inside|outside)$/.test(c.float)) &&
      node.children.every((c) => (typeof c === 'string' ? !c.trim() : !isInlineChild(c)))
    ) {
      const { children, ...rest } = node;
      this.layoutContainer({ ...rest, type: 'block-container', fillOrthogonal: true, children: children.filter((c) => typeof c !== 'string') } as unknown as LBlockContainer, ps);
      return;
    }
    const wmC = st.wm;
    // 強制の区切り (break-before・break-after) は、書字方向が親と違っても、親の流れの中の箱として効く
    // (XSL 1.1 §7.20.1・§7.20.2: この箱の最初の領域・次の箱の最初の領域を、ページ・段の最初に置く。書字方向による例外は無い。
    // CSS Fragmentation 3 §3.1: 通常の流れの block-level の箱に当てる)。中の Flow には渡さない (ここで済ませる)
    if (node.breakBefore) this.forceBreak(node.breakBefore);
    const after = node.breakAfter;
    if (node.breakBefore || after) node = { ...node, breakBefore: undefined, breakAfter: undefined };
    const desc = describeBox(node, wmC);
    // ページ分割: inline 方向の寸法の指定が無ければ、行の長さをページの残りの高さ (親の block 方向) にして、
    // 子の block 方向 (親の inline 方向) に親の幅まで積み、入りきらない行は次ページへ続ける
    if (desc.isizeExplicit == null && this.paginating && !this.measureOnly) {
      this.layoutOrthogonalPaged(node, st, ps);
      if (after) this.breakNext = after;
      return;
    }
    // 親の block 方向の余白 (横書きの親なら上下) は、箱の外に出して前後の余白と相殺する (CSS と同じ)。箱の中には含めない
    const outer = describeBox(node, this.wm);
    const bsSide = startSide(this.wm);
    const beSide = endSide(this.wm);
    let inner = { ...node, margin: { ...outer.marginP, [bsSide]: 0, [beSide]: 0 } } as typeof node;
    const innerDesc = describeBox(inner, wmC);
    // flex の項目 (fillOrthogonal): 箱の block の大きさ (親の行の向きの大きさ) を、置く場所 (列) の幅いっぱいにする (Flexbox 1 §9.7: 項目の主軸の
    // 大きさは、伸ばし縮めた後の大きさ)。中身の幅を測る流れ (列の幅の計測) では、指定の大きさ・中身の大きさのまま
    if (node.type === 'block' && node.fillOrthogonal && !this.intrinsic) {
      const fill = Math.max(this.contentI() - innerDesc.m.bs - innerDesc.m.be - (node.boxSizing === 'border-box' ? 0 : innerDesc.bpStart + innerDesc.bpEnd), 0);
      inner = { ...inner, [wmC === 'horizontal-tb' ? 'height' : 'width']: fill };
    }
    let childI: number;
    if (innerDesc.isizeExplicit != null) childI = innerDesc.isizeExplicit + innerDesc.bpI + innerDesc.m.is + innerDesc.m.ie;
    else if (this.host.xslSpace) childI = this.contentI();
    else {
      // CSS: 行の向きの大きさの指定が無ければ fit-content (Writing Modes 3 §7.3.2)。使える長さは orthogonalAvail。
      // max-height (縦書きの箱) ・max-width (横書きの箱) は使える長さの上限 (§7.2: 高さ・幅の指定は物理の向き)
      const edges = innerDesc.bpI + innerDesc.m.is + innerDesc.m.ie;
      let avail = Math.max(this.orthogonalAvail(wmC), 0);
      if (node.type === 'block' && node.maxInlineSize !== undefined && !node.aspectRatio) avail = Math.min(avail, node.maxInlineSize + edges);
      const measured = inner;
      // 箱そのもの (枠・余白を含む) を測る。同じ箱・同じ条件の計測は、同じ組版の中で 1 度だけ行う (memoMeasure。鍵は中身の並びと、
      // 箱の大きさ・余白・枠の指定。直交する箱の深い入れ子で、外側を測るたびに内側を測り直さない)
      const { children: _kids, ...boxOnly } = measured as LBlock;
      void _kids;
      const sig = node.type === 'block' ? JSON.stringify(boxOnly) : '';
      const measure = (rootI: number, min: boolean) => {
        const m = new Flow({ ...this.host, warn: () => {} }, { wm: wmC, rootI, abs: () => [], pageSize: this.pageSize, measure: true, intrinsic: true, ...(min ? { minContent: true } : {}), footnotes: this.foot });
        m.layoutBlockLevel(measured, ps);
        m.finishAtomic();
        return maxLineLength(m.root, true, true);
      };
      childI = this.fitContent(avail, (rootI, min) => (node.type === 'block' ? this.memoMeasure('ortho', node.children, st, [rootI, min, sig], this.foot, () => measure(rootI, min)) : measure(rootI, min)));
      // min-height (縦書きの箱)・min-width (横書きの箱) は下限 (上限より強い。CSS 2.1 §10.7)
      if (node.type === 'block' && node.minInlineSize !== undefined && !node.aspectRatio) childI = Math.max(childI, node.minInlineSize + edges);
    }
    const sub = new Flow(this.host, { wm: wmC, rootI: childI, abs: this.abs, pageSize: this.pageSize, markerSink: this.markerSink, footnotes: this.foot });
    sub.layoutBlockLevel(inner, ps);
    const bsize = sub.finishAtomic();
    const wrap = newNode('block', wmC, { isize: childI, bsize, children: sub.root.children });
    this.placeBox(wrap, outer.m.bs, outer.m.be, 0, this.extentAlongBlock(wrap), outer.precBs, outer.precBe, outer.retainBe);
    if (after) this.breakNext = after;
  }

  /** fo:block-container 相当 */
  private layoutContainer(node: LBlockContainer, ps: ResolvedStyle) {
    const st = resolveStyle(ps, node);
    const page = this.pageSize();
    if (node.absolutePosition && node.positionInContainer && this.cbAbs) {
      // 絶対配置の基準になるブロック (CSS) の中: 箱は、基準の箱を組み終えてから組む。いまの位置 (static position) を覚えておく
      const f = this.cbAbs.frame;
      const sy = f.opened ? Math.max(this.cursor + this.pendingValue() - f.contentStartB, 0) : 0;
      const frag = f.opened ? Math.max((f.frags?.length ?? 1) - 1, 0) : (f.frags?.length ?? 0);
      this.cbAbs.items.push({ node, st, sy, frag });
      return;
    }
    if (node.absolutePosition && node.positionInContainer && this.localAbs) {
      // 祖先のブロックコンテナの内容の箱を基準に置く (位置はコンテナを組み終えてから、コンテナの子にする)
      const la = this.localAbs;
      const n = this.buildContainer(node, st, la.w, la.h ?? page.height);
      la.list.push({ n, node });
      this.noteIds(n);
      return;
    }
    if (node.absolutePosition) {
      // 基準は、最も近い祖先の参照領域 (XSL 1.1 §7.6.1)。span の切り替わりで分かれた領域の中では、その領域の先頭から測る
      // (top は領域の先頭からの距離。下端までの高さは、領域が短いぶん短い)
      const off = node.areaOffset && this.wm === 'horizontal-tb' ? (this.host.areaOrigin?.() ?? 0) : 0;
      const src: LBlockContainer =
        off > EPS && node.top != null
          ? { ...node, top: node.top + off, ...(node.areaOffset === 'fill' && node.height != null ? { height: Math.max(node.height - off, 0) } : {}) }
          : node;
      const n = this.buildContainer(src, st, page.width, page.height);
      this.abs().push(n);
      this.noteIds(n);
      this.placeHeldFootnotes(n);
      return; // 通常フローの消費計算をスキップ
    }
    const desc = describeBox(node, st.wm);
    // 90°・270° 回したコンテナ (寸法の指定・枠の無いもの) は、中身をページの幅ごとに区切り、断片を回してページごとに置く
    if (
      this.paginating &&
      !this.measureOnly &&
      (node.rotation === 90 || node.rotation === 270) &&
      this.wm === 'horizontal-tb' &&
      st.wm === this.wm &&
      desc.isizeExplicit == null &&
      desc.bsizeExplicit == null &&
      !(node.columns && node.columns.count > 1) &&
      desc.bpI === 0 &&
      desc.bpStart + desc.bpEnd === 0
    ) {
      if (node.breakBefore) this.forceBreak(node.breakBefore);
      this.layoutRotatedPaged(node, st, node.rotation);
      if (node.breakAfter) this.breakNext = node.breakAfter;
      return;
    }
    // 高さの指定の無いコンテナは、内容があふれたらページをまたいで続ける (枠付きのブロックと同じに組む)。
    // 高さ固定・回転・段組・切り抜き・書字方向の違うコンテナ、書字方向を裏返すコンテナ (bt-lr・lr-bt など) は、従来どおり 1 つの箱にする
    const flips = !!(node.writingFlip && (node.writingFlip.block || node.writingFlip.inline || node.writingFlip.alternate));
    if (this.paginating && desc.bsizeExplicit == null && !node.rotation && !(node.columns && node.columns.count > 1) && node.overflow !== 'hidden' && st.wm === this.wm && !flips) {
      const { columns: _c, rotation: _r, blockAlign: _a, layer: _l, top: _t, left: _x, right: _rt, bottom: _b, absolutePosition: _p, ...rest } = node;
      // ブロックコンテナは参照領域を作る (XSL §6.5.3): 中の余白と外の余白を重ね合わせない (§4.2.5 の fence)
      return this.layoutBlock({ ...rest, type: 'block', refLines: true, ...(this.host.xslSpace ? { refArea: true } : {}) } as LBlock, ps);
    }
    if (node.breakBefore) this.forceBreak(node.breakBefore);
    // 段組のコンテナ (高さの指定・枠・回転の無いもの) は、ページに収まらなければ、ページをまたいで段を続ける (CSS の段組と同じ)
    if (
      this.paginating &&
      !this.measureOnly &&
      node.columns &&
      node.columns.count > 1 &&
      desc.bsizeExplicit == null &&
      !node.rotation &&
      desc.bpStart + desc.bpEnd === 0 &&
      st.wm === this.wm &&
      this.layoutColumnsPaged(node, st, desc)
    ) {
      if (node.breakAfter) this.breakNext = node.breakAfter;
      return;
    }
    const n = this.buildContainer(node, st, undefined, undefined);
    // CSS: 置く位置の余白は親の書字方向で読む (余白は物理の辺の値。親と直交する縦書きの箱の margin-top は、横書きの親では block-start。
    // 箱自身の縦書きで読むと inline-start になり、箱が右にずれる)。
    // XSL-FO は、space-before などを箱自身の書字方向で物理の辺に読み替えている (xslfoImport) ので、箱自身の向きで読む
    const outer = st.wm === this.wm || this.host.xslSpace ? desc : describeBox(node, this.wm);
    this.placeBox(n, outer.m.bs, outer.m.be, outer.m.is, this.extentAlongBlock(n), outer.precBs, outer.precBe, outer.retainBe);
    if (node.breakAfter) this.breakNext = node.breakAfter;
  }

  /**
   * ページをまたぐ段組のコンテナ: 1 ページ目の段はページの残りの高さ、続くページの段はページの高さで、段を順に埋める。
   * 最後のページの段は、段数に収まる最小の高さに釣り合わせる。段の行 (段と段間罫) を、ページごとに 1 つずつ置く。
   * 釣り合わせた 1 行がページの残りに収まるなら、false を返す (従来どおり 1 つの箱にする)
   */
  private layoutColumnsPaged(node: LBlockContainer, st: ResolvedStyle, desc: ReturnType<typeof describeBox>): boolean {
    this.applyPendingBreak();
    const cols = node.columns!;
    const n = cols.count;
    const gap = cols.gap ?? 12;
    const isize = (desc.isizeExplicit ?? this.contentI() - desc.m.is - desc.m.ie - desc.bpI) + desc.bpI;
    const colI = Math.max((isize - desc.bpI - gap * (n - 1)) / n, 1);
    const wm = st.wm;
    let avail = this.room - this.cursor - this.pendingValue() - desc.m.bs;
    // 続くページの段の高さ: 次のページの上限 (セルの中の流れ (箇条の項目など) では、いまのページの残りではなく、次のページで使える高さ)。
    // 脚注の領域・断片の末尾に残す罫線の分 (limit と room の差) は、いまのページと同じだけ引く
    const fullRoom = () => (this.pages?.nextLimit ? this.pages.nextLimit() - (this.limit - this.room) : this.room);
    let full = fullRoom();
    /** 段の高さを、段の番号ごとに決めて組む */
    const run = (limitOf: (col: number) => number, final: boolean) => {
      const roots: LNode[] = [newNode('block', wm, { isize: colI })];
      const used: number[] = [];
      // 段ごとのマーカー (string-set など)。段の行 (1 ページ分の段) を置くページに記録する
      const colMarkers: PendingMarker[][] = [];
      const flow = new Flow(final ? this.host : { ...this.host, warn: () => {} }, {
        wm,
        rootI: colI,
        root: roots[0],
        limit: limitOf(0),
        pages: {
          addMarkers: (list) => {
            if (final) (colMarkers[roots.length - 1] ??= []).push(...list);
          },
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          columnIndex: () => roots.length - 1,
          nextPage: () => {
            const r = newNode('block', wm, { isize: colI });
            roots.push(r);
            return { root: r, limit: limitOf(roots.length - 1), rootI: colI };
          },
        },
        abs: final ? this.abs : this.trialAbs,
        pageSize: this.pageSize,
        footnotes: this.foot,
        holdFootnotes: true,
        // アンテナハウス互換 (discardStartMargin): 最初の段の頭の余白を捨てる。強制の段区切りの後の余白は残す
        ...(cols.discardStartMargin ? { discardLeading: true, discardAfterForced: false } : {}),
      });
      flow.layoutChildren(columnChildren(node), st);
      flow.finishPaginated();
      return { roots, used, colMarkers };
    };
    // 釣り合わせた 1 行 (段数で割った高さ) がページの残りに収まるなら、従来どおり
    // 釣り合わせた 1 行がその高さに収まるか (行は分けられないので、全体の高さ ÷ 段数ではなく、実際に段へ組んで調べる)
    // 試し組みで決める値 (1 行に収まるか・行の数と最後の行の高さ) は、同じ条件なら覚えて使い回す (memoMeasure。入れ子の段組で、
    // 外側の試し組みのたびに内側の試し組みをやり直さない)
    const memoParts = [colI, n, !!cols.discardStartMargin, (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid];
    const fitsOneRow = (h: number) => this.memoMeasure('colrow', node.children, st, [...memoParts, h], this.foot, () => run(() => h, false).roots.length <= n);
    if (fitsOneRow(avail + EPS)) return false;
    // ページの残りが 2 行に満たなければ、次のページから始める
    if (avail < st.fontSize * 2.5 && this.pageHasContent) {
      this.breakPage();
      // 新しいページの高さで決め直す (段の高さの上限も新しいページのもの)。釣り合わせた 1 行が収まるなら、従来どおり
      avail = this.room - this.cursor - this.pendingValue() - desc.m.bs;
      full = fullRoom();
      if (fitsOneRow(avail + EPS)) return false;
    }
    const rowOf = (col: number) => Math.floor(col / n);
    const { rows, lastLimit } = this.memoMeasure('colpaged', node.children, st, [...memoParts, avail, full], this.foot, () => {
      const greedy = run((c) => (rowOf(c) === 0 ? avail : full), false);
      const rows = Math.max(1, Math.ceil(greedy.roots.length / n));
      // 最後の行を釣り合わせる (段数に収まる最小の高さ)
      let lastLimit = rows === 1 ? avail : full;
      if (rows > 1) {
        let lo = 0;
        let hi = full;
        for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
          const mid = (lo + hi) / 2;
          if (run((c) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : mid), false).roots.length <= rows * n) hi = mid;
          else lo = mid;
        }
        lastLimit = hi;
        // 最後の行も、最初の段をいちばん長くし、後の段ほど短くする (balanceColumns と同じ方針)
        const limitOf = (h: number) => (c: number) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : h);
        const ok = (h: number) => {
          const r = run(limitOf(h), false);
          if (r.roots.length > rows * n) return false;
          const u = r.used.slice((rows - 1) * n, rows * n);
          return u.every((x, k) => k === 0 || x <= u[k - 1] + 0.5);
        };
        if (!ok(lastLimit) && lastLimit < full) {
          let a = lastLimit;
          let b = full;
          while (b - a > 0.5) {
            const mid = (a + b) / 2;
            if (ok(mid)) b = mid;
            else a = mid;
          }
          if (ok(b)) lastLimit = b;
        }
      }
      return { rows, lastLimit };
    });
    const { roots, used, colMarkers } = run((c) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : lastLimit), true);
    // 段の行の箱は、コンテナ自身の断片: inline 方向の罫線と padding (block 方向のものは無い。呼ぶ側の条件)・id (page-number-citation の
    // 参照先)・元の入力の節を持つ。段は、その内容の箱 (padding と罫線の内側) の始めの端から並べる
    let placedRow = false;
    for (let r = 0; r * n < roots.length; r++) {
      const kids: LNode[] = [];
      const filled = (k: number) => k < roots.length && roots[k].children.length > 0;
      let height = 0;
      for (let k = 0; k < n && r * n + k < roots.length; k++) {
        const c = r * n + k;
        height = Math.max(height, used[c] ?? 0);
        kids.push(newNode('block', wm, { i: k * (colI + gap), b: 0, isize: colI, bsize: used[c] ?? 0, children: roots[c].children }));
      }
      if (!kids.some((k) => k.children.length)) continue;
      const rule = cols.rule;
      if (rule && rule.width > 0) {
        for (let k = 1; k < n; k++) {
          const c = r * n + k;
          if (cols.ruleDisplay !== 'all' && !(filled(c - 1) && filled(c))) continue;
          const ruleNode = newNode('block', wm, { i: k * (colI + gap) - gap / 2 - rule.width / 2, b: 0, isize: rule.width, bsize: height });
          if (rule.style && rule.style !== 'solid') ruleNode.border = wm === 'horizontal-tb' ? { left: rule } : { top: rule };
          else ruleNode.bg = rule.color;
          kids.push(ruleNode);
        }
      }
      if (r > 0) this.breakPage();
      // この行の段のマーカーは、この行を置くページに記録する (placeBox が記録する)
      for (let k = 0; k < n; k++) this.markerSink.push(...(colMarkers[r * n + k] ?? []));
      const last = (r + 1) * n >= roots.length;
      const row = newNode('block', wm, { isize, bsize: height, padding: { ...desc.paddingP }, border: { ...desc.borderP }, bg: desc.bg, src: desc.src, ref: desc.ref, children: kids });
      if (placedRow) row.cont = true;
      if (!last) row.contNext = true;
      placedRow = true;
      this.placeBox(row, r === 0 ? desc.m.bs : 0, last ? desc.m.be : 0, desc.m.is, this.extentAlongBlock(row), r === 0 ? desc.precBs : 0, last ? desc.precBe : 0);
    }
    return true;
  }

  /** ブロックコンテナ自身を固定ボックスとしてレイアウト (内部は独立した無改ページ Flow) */
  buildContainer(node: LBlockContainer, st: ResolvedStyle, pageW: number | undefined, pageH: number | undefined, dropTrailing = false): LNode {
    const wmC = st.wm;
    const desc = describeBox(node, wmC);
    // 物理サイズの決定 (left+right / top+bottom 併用時は逆算)。border-box 指定は describeBox で content-box に換算済み。
    const horizontal = wmC === 'horizontal-tb';
    const bpPhysW = desc.paddingP.left + desc.paddingP.right + (desc.borderP.left?.width ?? 0) + (desc.borderP.right?.width ?? 0);
    const bpPhysH = desc.paddingP.top + desc.paddingP.bottom + (desc.borderP.top?.width ?? 0) + (desc.borderP.bottom?.width ?? 0);
    let contentI = desc.isizeExplicit;
    let contentB = desc.bsizeExplicit;
    const rot = node.rotation ?? 0;
    const rotOdd = rot === 90 || rot === 270;
    // left/right・top/bottom は回転後の外接矩形の辺。回転前の局所寸法へは、90・270 のとき縦横を入れ替えて対応させる
    const widthIsI = horizontal !== rotOdd;
    if (pageW != null && node.left != null && node.right != null && node.width == null) {
      const w = pageW - node.left - node.right - (rotOdd ? bpPhysH : bpPhysW);
      if (widthIsI) contentI = w;
      else contentB = w;
    }
    if (pageH != null && node.top != null && node.bottom != null && node.height == null) {
      const h = pageH - node.top - node.bottom - (rotOdd ? bpPhysW : bpPhysH);
      if (widthIsI) contentB = h;
      else contentI = h;
    }
    // 本文の中の箱は、本文の幅から inline 方向の余白 (margin。start-indent・end-indent から決まる。負もある) を引いた幅
    let fallbackI = horizontal
      ? (pageW ?? this.contentI() - (rotOdd || wmC !== this.wm ? 0 : desc.m.is + desc.m.ie)) - (node.left ?? 0) - (node.right ?? 0)
      : (pageH ?? this.contentI()) - (node.top ?? 0) - (node.bottom ?? 0);
    // 回転した箱の局所の幅 (指定が無いとき) は、本文領域の block 方向いっぱい (ページの高さ) にする
    if (rotOdd && horizontal) fallbackI = pageH != null ? pageH - (node.top ?? 0) - (node.bottom ?? 0) : Number.isFinite(this.limit) ? this.limit : this.contentI();
    // 本文の中の回転した箱 (90°・270°) で幅の指定が無いときは、中身の長さに合わせる (使える長さが上限。shrink-to-fit)。
    // 90° の表は、表の幅 (列の幅の合計 + 字下げ) の長さで本文の上から置く
    if (rotOdd && horizontal && pageH == null && contentI == null && node.children.length) {
      const avail = Math.max(fallbackI - desc.bpI, 1);
      const need = this.memoMeasure('rotlen', node.children, st, [avail], undefined, () => maxLineLength(this.measureSub(node.children, st, avail, {}, wmC).sub.root, true, true));
      if (need > 0 && need < avail) fallbackI = need + desc.bpI;
    }
    // CSS の絶対配置の箱で幅が auto (left と right の両方の指定は無い): shrink-to-fit (CSS 2.1 §10.3.7)。
    // min(max(最小の内容の幅, 使える幅), 内容の幅)。求め方は幅の指定の無い float と同じ
    if (node.shrinkToFit && contentI == null && horizontal && !rot && !(node.left != null && node.right != null) && node.children.length) {
      const availC = Math.max(fallbackI - desc.bpI, 0);
      const widthAt = (rootI: number) => this.intrinsicWidth(node.children, st, rootI);
      const pref = widthAt(Math.max(availC, 1) * 100);
      const minC = pref <= availC ? pref : widthAt(1);
      contentI = Math.min(Math.max(minC, availC), pref);
    }
    // 縦書きの絶対配置の箱 (縦書きの文書の中でも、横書きの文書の中でも) で、行の向きの大きさ (高さ) が auto (top と bottom の両方の
    // 指定は無い): shrink-to-fit (CSS 2.1 §10.3.7 を行の向きに当てる。CSS Writing Modes 3 §7.2・§7.3.2 の fit-content)。使える長さは、
    // 包含ブロックの高さから top・bottom を引いたもの (fallbackI)
    if (node.shrinkToFit && contentI == null && !horizontal && !rot && !(node.top != null && node.bottom != null) && node.children.length) {
      contentI = this.fitContent(Math.max(fallbackI - desc.bpI, 0), (rootI, min) => this.intrinsicWidth(node.children, st, rootI, min));
    }
    // 内容による大きさ (CSS Sizing 3 §3.2): 使える長さは、包含ブロックの幅から位置の指定と余白・枠を引いたもの。auto の大きさ
    // (上の shrink-to-fit の結果・使える長さ) に、上限・下限の語を当てる
    if (node.inlineSizing && !rot) {
      const availC = Math.max(fallbackI - desc.bpI, 0);
      contentI = this.contentSizedInline(node, st, availC, contentI ?? availC);
    }
    const isize = (contentI ?? fallbackI - desc.bpI) + desc.bpI;
    // 親と直交する書字方向のコンテナ (fillOrthogonal): block 方向の寸法の指定が無ければ、親の内容の幅いっぱいにする
    if (node.fillOrthogonal && contentB == null && pageW == null && (wmC === 'horizontal-tb') !== (this.wm === 'horizontal-tb')) {
      contentB = Math.max(this.contentI() - desc.bpStart - desc.bpEnd - desc.m.bs - desc.m.be, 0);
    }
    let used: number;
    let kids: LNode[];
    if (node.columns && node.columns.count > 1) {
      ({ used, kids } = this.layoutBoxColumns(node, st, Math.max(isize - desc.bpI, 0), contentB));
    } else {
      // 中の絶対配置の箱 (positionInContainer) は、このコンテナの内容の箱を基準にする (横書きのコンテナだけ)
      const localAbs: FlowInit['localAbs'] = horizontal && !rot ? { list: [], w: Math.max(isize - desc.bpI, 0), h: contentB } : undefined;
      const sub = new Flow(this.host, {
        wm: wmC,
        markerSink: this.markerSink,
        footnotes: this.foot,
        rootI: Math.max(isize - desc.bpI, 0),
        abs: this.abs,
        pageSize: this.pageSize,
        localAbs,
        // 参照領域の先頭の conditional な余白は捨てる (XSL §4.3.1)
        ...(this.host.xslSpace ? { discardLeading: true } : {}),
        referenceArea: true,
        ...(contentB != null && !this.host.xslSpace ? { afterAt: contentB } : {}),
      });
      sub.layoutChildren(node.children, st);
      used = dropTrailing ? sub.finishWithTrailing().height : sub.finishAtomic();
      kids = sub.root.children;
      // 内容の箱の中の位置 (buildContainer が phys に入れた値) を、子の位置にする
      for (const { n: a, node: an } of localAbs?.list ?? []) {
        const at = a.phys ?? { x: 0, y: 0 };
        delete a.phys;
        a.i = at.x;
        // 高さの指定の無いコンテナの中で下端から置く箱は、組み終えた内容の高さの下端から
        a.b = localAbs!.h == null && an.top == null && an.bottom != null ? used - an.bottom - bboxOf(a).height : at.y;
        kids.push(a);
      }
    }
    // 縦並びの flex の折り返し (flexWrapColumns。Flexbox 1 §9.3): 主軸 (ブロックの向き) に積んだ子を、内容の大きさを超える所で次の列 (行の向きの
    // 次の並び) へ移す。列の幅はその列のいちばん広い子の幅 (余白を含む)。flexWrapStretch の子は列の幅まで広げる。列ごとに、余りを flexGrow の比で
    // 分け、無ければ auto の余白 (flexAutoMargin)、それも無ければ justify の空きにする (§9.7・§8.1・§8.2)。余白・枠は書字方向に合わせて論理の向きで読む
    const wrapCols = (node as LBlockContainer).flexWrapColumns;
    if (wrapCols && contentB != null && kids.length) {
      const stretchRefs = new Set<number>();
      const alignOf = new Map<number, 'start' | 'center' | 'end'>();
      const growOf = new Map<number, number>();
      const autoOf = new Map<number, { before?: boolean; after?: boolean }>();
      for (const ch of node.children) {
        const r = sourceRef(ch);
        if (r === undefined) continue;
        const b = ch as LBlock;
        if (b.flexWrapStretch) stretchRefs.add(r);
        if (b.flexWrapAlign) alignOf.set(r, b.flexWrapAlign);
        if (b.flexGrow && b.flexGrow > 0) growOf.set(r, b.flexGrow);
        if (b.flexAutoMargin) autoOf.set(r, b.flexAutoMargin);
      }
      const lm = (k: LNode) => toLogical(k.margin, k.wm);
      const occ = (k: LNode) => lm(k).bs + k.bsize + lm(k).be;
      const cols: LNode[][] = [[]];
      let colH = 0;
      for (const k of [...kids].sort((a, b) => a.b - b.b)) {
        const cur = cols[cols.length - 1];
        if (cur.length && colH + occ(k) > contentB + EPS) {
          cols.push([]);
          colH = 0;
        }
        cols[cols.length - 1].push(k);
        colH += occ(k);
      }
      const cw = Math.max(isize - desc.bpI, 0);
      const widths = cols.map((col) => Math.max(...col.map((k) => lm(k).is + k.isize + lm(k).ie)));
      // align-content: stretch (normal): 余った幅を列に等しく分ける
      const spare = cw - widths.reduce((a, b) => a + b, 0) - wrapCols.gap * (cols.length - 1);
      if (wrapCols.stretch && spare > EPS) widths.forEach((_, k) => (widths[k] += spare / cols.length));
      let x = 0;
      let maxH = 0;
      for (const [ci, col] of cols.entries()) {
        const w = widths[ci];
        // 列の中の余り (主軸の向き) の分け方: 伸ばす子 → auto の余白 → justify の空き
        const free = contentB - col.reduce((a, k) => a + occ(k), 0);
        const gsum = col.reduce((a, k) => a + (k.ref !== undefined ? (growOf.get(k.ref) ?? 0) : 0), 0);
        const slots = col.reduce((a, k) => {
          const m = k.ref !== undefined ? autoOf.get(k.ref) : undefined;
          return a + (m?.before ? 1 : 0) + (m?.after ? 1 : 0);
        }, 0);
        const n = col.length;
        const j = wrapCols.justify ?? 'start';
        let lead = 0;
        let between = 0;
        if (free > EPS && !gsum && !slots) {
          if (j === 'end') lead = free;
          else if (j === 'center') lead = free / 2;
          else if (j === 'space-between' && n > 1) between = free / (n - 1);
          else if (j === 'space-around') [lead, between] = [free / (2 * n), free / n];
          else if (j === 'space-evenly') [lead, between] = [free / (n + 1), free / (n + 1)];
        }
        let y = lead;
        for (const [ki, k] of col.entries()) {
          if (k.ref !== undefined && stretchRefs.has(k.ref)) k.isize = Math.max(k.isize, w - lm(k).is - lm(k).ie);
          const g = k.ref !== undefined ? growOf.get(k.ref) : undefined;
          if (free > EPS && gsum && g) k.bsize += gsum < 1 ? free * g : (free * g) / gsum;
          const am = !gsum && slots && free > EPS && k.ref !== undefined ? autoOf.get(k.ref) : undefined;
          if (am?.before) y += free / slots;
          // 広げない子は、列の中で寄せる
          const a = k.ref !== undefined ? alignOf.get(k.ref) : undefined;
          const room = w - lm(k).is - k.isize - lm(k).ie;
          const off = a === 'center' ? room / 2 : a === 'end' ? room : 0;
          k.i = (wrapCols.reverse ? cw - x - w : x) + lm(k).is + Math.max(0, off);
          k.b = y + lm(k).bs;
          y += occ(k) + (ki < n - 1 ? between : 0);
          if (am?.after) y += free / slots;
        }
        maxH = Math.max(maxH, y);
        x += w + wrapCols.gap;
      }
      used = Math.min(maxH, contentB);
    }
    // 中身が高さの決まった箱に入りきらなければ、flexShrink のある子 (縦並びの flex の項目) を縮める (Flexbox 1 §9.7): はみ出した分を
    // flexShrink × 子の箱の高さの比で分けて引き、下限 (flexMin。無ければ中身の高さ: min-height: auto。§4.5) で止め、後ろの子を上げる
    if (contentB != null && used > contentB + EPS && !wrapCols) {
      const sh = new Map<number, { s: number; min?: number }>();
      for (const ch of node.children) {
        const b = ch as LBlock;
        const r = b.flexShrink && b.flexShrink > 0 ? sourceRef(ch) : undefined;
        if (r !== undefined) sh.set(r, { s: b.flexShrink!, ...(b.flexMin !== undefined ? { min: b.flexMin } : {}) });
      }
      if (sh.size) {
        // 中身の大きさ (主軸の向き): 内側の余白・枠は書字方向に合わせて論理の向きで読む
        const extent = (k: LNode) => {
          const lp = toLogical(k.padding, k.wm);
          const lb = borderToLogicalWidths(k.border, k.wm);
          return lp.bs + lb.bs + (k.children.length ? Math.max(...k.children.map((c) => c.b + c.bsize)) : 0) + lp.be + lb.be;
        };
        const order = [...kids].sort((a, b) => a.b - b.b);
        const items = order.flatMap((k) => {
          const x = k.ref !== undefined ? sh.get(k.ref) : undefined;
          return x ? [{ k, s: x.s, base: k.bsize, floor: Math.min(k.bsize, x.min ?? extent(k)), cut: 0 }] : [];
        });
        let over = used - contentB;
        const frozen = new Set<(typeof items)[number]>();
        for (let pass = 0; pass <= items.length && over > EPS; pass++) {
          const act = items.filter((it) => !frozen.has(it) && it.base > 0);
          const sum = act.reduce((a, it) => a + it.s * it.base, 0);
          if (!sum) break;
          let taken = 0;
          for (const it of act) {
            const want = it.base - it.cut - (over * it.s * it.base) / sum;
            const nb = Math.max(want, it.floor);
            if (want < it.floor) frozen.add(it);
            taken += it.base - it.cut - nb;
            it.cut = it.base - nb;
          }
          over -= taken;
        }
        let shift = 0;
        for (const k of order) {
          k.b -= shift;
          const it = items.find((x) => x.k === k);
          if (it && it.cut > EPS) {
            k.bsize -= it.cut;
            shift += it.cut;
          }
        }
        used -= shift;
      }
    }
    // 余った高さを、flexGrow のある子 (縦並びの flex の項目の flex-grow) にその比で分ける: 子の箱を伸ばし、後ろの子を下げる (Flexbox 1 §9.7)。
    // 子の箱は、元の節の通し番号 (ref) で見分ける
    if (contentB != null && used < contentB - EPS && !wrapCols) {
      const grow = new Map<number, number>();
      for (const ch of node.children) {
        const g = (ch as LBlock).flexGrow;
        const r = g && g > 0 ? sourceRef(ch) : undefined;
        if (r !== undefined) grow.set(r, g!);
      }
      const sum = [...grow.values()].reduce((a, b) => a + b, 0);
      // 伸ばす子が無ければ、auto の余白 (flexAutoMargin) が余りを等分して吸い取る (Flexbox 1 §8.1)
      const autoM = new Map<number, { before?: boolean; after?: boolean }>();
      if (sum === 0)
        for (const ch of node.children) {
          const m = (ch as LBlock).flexAutoMargin;
          const r = m ? sourceRef(ch) : undefined;
          if (r !== undefined) autoM.set(r, m!);
        }
      const slots = [...autoM.values()].reduce((a, m) => a + (m.before ? 1 : 0) + (m.after ? 1 : 0), 0);
      if (slots > 0) {
        const each = (contentB - used) / slots;
        let shift = 0;
        for (const k of [...kids].sort((a, b) => a.b - b.b)) {
          const m = k.ref !== undefined ? autoM.get(k.ref) : undefined;
          if (m?.before) shift += each;
          k.b += shift;
          if (m?.after) shift += each;
        }
        used += shift;
      }
      if (sum > 0) {
        const free = contentB - used;
        let shift = 0;
        for (const k of [...kids].sort((a, b) => a.b - b.b)) {
          k.b += shift;
          const g = k.ref !== undefined ? grow.get(k.ref) : undefined;
          if (g) {
            // 比の合計が 1 未満なら、余りのその割合だけを分ける (Flexbox 1 §9.7 の 4)
            const add = sum < 1 ? free * g : (free * g) / sum;
            // flex の 1 行の表 (align-content: stretch の行) は、行とセルも伸ばす
            if (k.kind === 'table') growTableLine(k, add);
            else k.bsize += add;
            shift += add;
          }
        }
        used += shift;
      }
    }
    // 固定の高さの中での内容の配置 (display-align)
    if (node.blockAlign && node.blockAlign !== 'start' && contentB != null && used < contentB) {
      if (node.blockAlign === 'space-between' || node.blockAlign === 'space-around' || node.blockAlign === 'space-evenly') {
        // 子の間に余りを分ける (CSS の align-content・縦並びの flex の justify-content): space-between は子の間だけ (最初の子は上端、
        // 最後の子は下端)、space-around は子の前後に半分ずつ、space-evenly は前後と間に同じ量
        const order = [...kids].sort((a, b) => a.b - b.b);
        const free = contentB - used;
        const m = order.length;
        if (node.blockAlign === 'space-between') {
          if (m > 1) order.forEach((c, k) => (c.b += (free * k) / (m - 1)));
        } else if (node.blockAlign === 'space-around') order.forEach((c, k) => (c.b += (free * (k + 0.5)) / m));
        else order.forEach((c, k) => (c.b += (free * (k + 1)) / (m + 1)));
      } else {
        const off = node.blockAlign === 'center' ? (contentB - used) / 2 : contentB - used;
        for (const c of kids) c.b += off;
      }
    }
    const bsize = (contentB ?? used) + desc.bpStart + desc.bpEnd;
    const out = newNode('block', wmC, {
      isize,
      bsize,
      margin: { ...desc.marginP },
      padding: { ...desc.paddingP },
      border: { ...desc.borderP },
      bg: desc.bg,
      ...this.decorOf(desc),
      src: desc.src,
      ref: desc.ref,
      // 角丸・影 (ブロックと同じ。CSS の position: absolute の箱や余白の箱も描く)
      ...(desc.radius ? { radius: desc.radius } : {}),
      ...(desc.shadow ? { shadow: desc.shadow } : {}),
      children: kids,
    });
    if (node.layer === 'behind') out.behind = true;
    if (rot) out.rot = rot;
    // 書字方向を決め直したコンテナ: 外の裏返しを中へ持ち込まない。裏返しの値 (bt-lr・lr-bt など) なら、中を裏返す
    if (node.writingFlip) {
      out.flipRoot = true;
      applyFlip(out, node.writingFlip);
    }
    // overflow="hidden" は、固定寸法からはみ出した内容を切り抜く
    if (node.overflow === 'hidden') out.clip = true;
    // 絶対配置の座標決定
    if (node.absolutePosition && pageW != null && pageH != null) {
      const s = bboxOf(out);
      const x = node.left ?? (node.right != null ? pageW - node.right - s.width : 0);
      const y = node.top ?? (node.bottom != null ? pageH - node.bottom - s.height : 0);
      out.phys = { x, y };
    }
    return out;
  }

  /**
   * コンテナの中の段組。段の高さ limit で段を順に埋める Flow を組み、高さの指定 (contentB) が無ければ、
   * 段数に収まる最小の高さを二分探索で求めて釣り合わせる。段と段間罫の箱を返す
   */
  private layoutBoxColumns(node: LBlockContainer, st: ResolvedStyle, innerI: number, contentB: number | undefined): { used: number; kids: LNode[] } {
    const cols = node.columns!;
    const n = cols.count;
    const gap = cols.gap ?? 12;
    const wm = st.wm;
    // column-span: all の子 (段にまたがる要素。Multicol 1 §6.1) があれば、その前後で段組を分ける。
    // 前の中身を段に組んで釣り合わせ、またがる要素をコンテナの幅いっぱいに置き、後ろの中身を新しい段組として続ける
    const isSpanner = (c: (typeof node.children)[number]) => typeof c !== 'string' && c.type === 'block' && c.span === 'all';
    // 高さの指定があるときは、最後の段組だけを残りの高さで組む (前の段組は釣り合わせる)
    if (node.children.some(isSpanner)) {
      const kids: LNode[] = [];
      let y = 0;
      let seg: typeof node.children = [];
      const flushSeg = (last = false) => {
        if (seg.some((c) => typeof c !== 'string' || c.trim() !== '')) {
          const h = last && contentB != null ? Math.max(contentB - y, 0) : undefined;
          const r = this.layoutBoxColumns({ ...node, children: seg }, st, innerI, h);
          for (const k of r.kids) {
            k.b += y;
            kids.push(k);
          }
          y += r.used;
        }
        seg = [];
      };
      for (const c of node.children) {
        if (!isSpanner(c)) {
          seg.push(c);
          continue;
        }
        flushSeg();
        const r = this.layoutColumnSpanner(c as LBlock, st, innerI);
        r.node.b = y;
        kids.push(r.node);
        y += r.used;
      }
      flushSeg(true);
      return { used: contentB ?? y, kids };
    }
    const colI = Math.max((innerI - gap * (n - 1)) / n, 1);
    const run = (limit: number, final: boolean) => {
      const roots: LNode[] = [newNode('block', wm, { isize: colI })];
      const used: number[] = [];
      const flow = new Flow(final ? this.host : { ...this.host, warn: () => {} }, {
        wm,
        rootI: colI,
        root: roots[0],
        limit,
        pages: {
          addMarkers: (list) => {
            if (final) this.markerSink.push(...list);
          },
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          columnIndex: () => roots.length - 1,
          nextPage: () => {
            const r = newNode('block', wm, { isize: colI });
            roots.push(r);
            return { root: r, limit, rootI: colI };
          },
        },
        abs: final ? this.abs : this.trialAbs,
        pageSize: this.pageSize,
        footnotes: this.foot,
        holdFootnotes: true,
        afterBelowContent: contentB == null,
        discardEndMargin: !!cols.discardEndMargin,
        // アンテナハウス互換 (discardStartMargin): 最初の段の頭の余白を捨てる。強制の段区切りの後の余白は残す (CSS Fragmentation)
        ...(cols.discardStartMargin ? { discardLeading: true, discardAfterForced: false } : {}),
      });
      flow.layoutChildren(columnChildren(node), st);
      flow.finishPaginated();
      return { roots, used, after: flow.afterBelowUsed, broke: flow.brokeKeep, deferred: flow.deferredBefore };
    };
    /** 釣り合わせた段の高さ (試し組みで探す) */
    const balanced = (): number => {
      let limit: number;
      // 1 段に組んだ高さを段数で割った値から、段数に収まる最小の高さを探す
      const one = run(1e7, false);
      // 強制の段区切り (Fragmentation 3 §3.1 の break-before: column など) があると、高さを限らなくても段が分かれる。
      // 上限はいちばん高い段の高さ (その高さなら、どの段も区切りの所までで収まる)、下限は中身の全体を段数で割った高さ
      const total = Math.max(0, ...one.used);
      let lo = one.used.reduce((a, b) => a + b, 0) / n;
      let hi = Math.max(total, lo);
      // 下端の float を段の内容の後ろに足すときは、1 段の高さに float が入るので、収まれば更に低い高さも探す
      // 段数に収まり、widows / orphans を守れる高さを、収まるとみなす (空の段で段落を無理に分けた高さは採らない)。
      // 前方 (top) の float を次の段へ送らずに済む高さだけを採る (float は置き場所の段の上端に置く)
      const fits = (r: ReturnType<typeof run>) => r.roots.length <= n && !r.broke && !r.deferred;
      const first = run(lo, false);
      if (fits(first)) {
        hi = lo;
        lo = first.after ? 0 : hi;
      }
      for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
        const mid = (lo + hi) / 2;
        const r = run(mid, false);
        if (!fits(r)) lo = mid;
        // 収まったら、段が実際に使った高さまで下げても組み方は変わらない (収まるかどうかだけで改行・改段を決めるので、
        // 使った高さまでなら同じ物が同じ段に入る)。試す回数を減らす。下端の float がある段組は、float の分が使った高さに入らないので下げない
        else hi = first.after ? mid : Math.max(lo, Math.min(mid, Math.max(0, ...r.used) + 0.01));
      }
      limit = hi;
      // 釣り合わせの方針 (CSS Multi-column 1 の balance は「できるだけ均等に」で、どの段を長くするかは定めていない):
      // 最初の段 (start 側) をいちばん長くし、後の段ほど短くする (どの段も前の段より高くならない)。段数に収まる最小の高さで
      // そうなっていれば (段の高さが同じときを含む) それを使い、なっていなければ、そうなる最小の高さまで伸ばす。
      // 段の下端の float がある段組は、float の分で段の長さが変わるので調整しない
      if (!first.after) {
        const ok = (h: number) => {
          const r = run(h, false);
          if (!fits(r)) return false;
          const u = r.used.slice(0, n);
          return u.every((x, k) => k === 0 || x <= u[k - 1] + 0.5);
        };
        // 条件を満たす最小の高さを二分探索で求める (0.5pt まで)。見つからなければ最小の高さのまま
        if (!ok(limit) && limit < total) {
          let a = limit;
          let b = total;
          while (b - a > 0.5) {
            const mid = (a + b) / 2;
            if (ok(mid)) b = mid;
            else a = mid;
          }
          limit = ok(b) ? b : hi;
        }
      }
      return limit;
    };
    // 釣り合わせた高さは、同じ条件なら覚えて使い回す (memoMeasure。入れ子の段組で、外側の試し組みのたびに内側の釣り合わせをやり直さない)
    const limit =
      contentB != null
        ? contentB
        : this.memoMeasure('colbal', node.children, st, [colI, n, !!cols.discardEndMargin, !!cols.discardStartMargin, (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid], this.foot, balanced);
    const { roots, used } = run(limit, true);
    if (roots.length > n) this.host.warn(`段組のコンテナに内容が収まりません (${n} 段)`);
    const kids: LNode[] = [];
    const filled = (k: number) => k < roots.length && roots[k].children.length > 0;
    const height = contentB ?? Math.max(0, ...used.slice(0, n));
    // 段は段組の箱の行の向きに並ぶ (Multi-column 1 §2)。右から左へ書く横書きの段組は、1 段目を右に置く
    const rtl = st.direction === 'rtl' && wm === 'horizontal-tb';
    const colAt = (k: number) => (rtl ? innerI - colI - k * (colI + gap) : k * (colI + gap));
    for (let k = 0; k < Math.min(n, roots.length); k++) {
      kids.push(newNode('block', wm, { i: colAt(k), b: 0, isize: colI, bsize: used[k] ?? 0, children: roots[k].children }));
    }
    // 段間罫: 既定 (gap) は内容のある段の間だけ、all は空の段との間にも引く。end (アンテナハウスの拡張) は内容のある段それぞれの
    // 終わり側 (段間の中央。最後の段は、その外の段間の幅の中央) に引く
    const rule = cols.rule;
    if (rule && rule.width > 0) {
      // 長さ (-ah-column-rule-length) と段の中の位置 (-ah-column-rule-align)
      const len = Math.min(cols.ruleLength?.len ?? (cols.ruleLength?.pct ?? 1) * height, height);
      const b0 = cols.ruleAlign === 'before' ? 0 : cols.ruleAlign === 'after' ? height - len : (height - len) / 2;
      const at = (k: number) => {
        const at0 = k * (colI + gap) - gap / 2 - rule.width / 2;
        const ruleNode = newNode('block', wm, { i: rtl ? innerI - at0 - rule.width : at0, b: b0, isize: rule.width, bsize: len });
        if (rule.style && rule.style !== 'solid') ruleNode.border = wm === 'horizontal-tb' ? { left: rule } : { top: rule };
        else ruleNode.bg = rule.color;
        kids.push(ruleNode);
      };
      if (cols.ruleDisplay === 'end') {
        for (let k = 1; k <= n; k++) if (filled(k - 1)) at(k);
      } else
        for (let k = 1; k < n; k++) {
          if (cols.ruleDisplay !== 'all' && !(filled(k - 1) && filled(k))) continue;
          at(k);
        }
    }
    return { used: height, kids };
  }

  /** 段組のコンテナの中の、段にまたがる要素 (column-span: all) を、コンテナの幅いっぱいに組む */
  private layoutColumnSpanner(child: LBlock, st: ResolvedStyle, innerI: number): { node: LNode; used: number } {
    const wm = st.wm;
    const root = newNode('block', wm, { isize: innerI });
    let used = 0;
    const flow = new Flow(this.host, {
      wm,
      rootI: innerI,
      root,
      limit: 1e7,
      pages: {
        addMarkers: (list) => this.markerSink.push(...list),
        noteId: () => {},
        columnEnd: (u) => (used = Math.max(used, u)),
        columnIndex: () => 0,
        nextPage: () => ({ root: newNode('block', wm, { isize: innerI }), limit: 1e7, rootI: innerI }),
      },
      abs: this.abs,
      pageSize: this.pageSize,
      footnotes: this.foot,
      holdFootnotes: true,
    });
    flow.layoutChildren([{ ...child, span: undefined }], st);
    flow.finishPaginated();
    root.bsize = used;
    return { node: root, used };
  }

  /** ページ分割フローの終了: 開いている Frame を閉じる */
  finishPaginated() {
    while (this.stack.length) this.closeFrame();
    this.commitMarkers();
    // 最後に残った脚注 (長い脚注の続き) のために、必要なら脚注だけのページを足す
    for (let guard = 0; this.carry.length || this.deferredFloats.length; guard++) {
      if (guard >= 50) {
        this.host.warn('脚注・float の続きが 50 ページを超えるため、残りを置きません');
        break;
      }
      this.breakPage();
    }
    this.emitAfterFloats();
    this.reportColumnEnd(this.discardEndMargin);
    this.emitFootnotes();
  }

  /** atBreak: 段・ページの区切りで閉じる (区切りに接する保留中の余白は捨てる。CSS Fragmentation 3 §5.2) */
  private reportColumnEnd(atBreak = false) {
    if (!this.pages?.columnEnd) return;
    // 参照領域の終わり (areaEnd) では、残す指定 (retain) の余白までを数える (§4.3.1)
    const trailing = () => (this.areaEnd ? this.keptPending() : this.pendingValue());
    this.trailingSpace = this.footReserve <= 0 ? Math.max(trailing(), 0) : 0;
    // 段・ページの最後の行の下の半行間は、line-height.conditionality="discard" なら捨てる (XSL §7.16.4)
    // 行グリッドの中の最後の行の下の半行間 (字の下端より下) も、段の高さに入れない (アンテナハウスの baseline-grid:
    // 行グリッドの段組の箱の下端は、最後の行の字の下端 + padding)
    const gt = this.gridTrail.trail > 0 && Math.abs(this.gridTrail.end - this.cursor) < EPS ? this.gridTrail.trail : 0;
    const end = gt ? this.cursor - gt : this.endAfterLastLine();
    const pend = atBreak && !this.host.xslSpace ? 0 : trailing();
    this.pages.columnEnd(this.footReserve > 0 ? this.limit : Math.max(end + pend, this.floatBottom('both'), this.beforeUsed, this.afterEnd));
    this.afterEnd = 0;
  }

  /** 脚注本体用: 閉じて、末尾の保留マージン (space-after) を含めない高さと、そのマージンを返す */
  finishWithTrailing(): { height: number; after: number } {
    while (this.stack.length) this.closeFrame();
    const end = this.referenceArea ? this.endAfterLastLine() : this.cursor;
    return { height: Math.max(end, this.floatBottom('both'), this.beforeUsed), after: Math.max(this.pendingValue(), 0) };
  }

  /** 原子的フロー (セル・コンテナ内部) を閉じて、使用した block サイズを返す */
  /** finishAtomic と同じだが、末尾に残った余白 (space-after) を含めない高さ */
  finishAtomicContent(): number {
    while (this.stack.length) this.closeFrame();
    return Math.max(this.cursor, this.floatBottom('both'), this.beforeUsed);
  }

  finishAtomic(): number {
    while (this.stack.length) this.closeFrame();
    this.flush();
    // 回り込みの下端も含める (本文より背の高い float を内包する)
    const end = this.referenceArea && this.pendingValue() <= EPS ? this.endAfterLastLine() : this.cursor;
    return Math.max(end, this.floatBottom('both'), this.beforeUsed);
  }

  // ───────────────────────── 表 ─────────────────────────

  /**
   * 自動レイアウトの列の幅 (CSS の auto table layout の簡易版)。
   * 各列の最大の長さ (改行しないで組んだ長さ) と最小の長さ (最も長い分割できない部分) をセルから測り、
   * 最大の合計が avail に収まればそれを、収まらなければ最小との間を比例で配る。列をまたぐセルの最小・最大の長さは、
   * 1 列のセルの後で、またぐ列に配る (CSS 2.1 §17.5.2.2)
   */
  /** 直前の measureColumns で、幅の指定のあるセルを含んでいた列 */
  private specifiedColumns: boolean[] = [];

  /**
   * 中身に合わせる列 (LTableColumn.fitContent) の幅を、いまの組版でのセルの中身の幅 (max-content。CSS Sizing 3 §5.1) にした表を返す。
   * ページ番号の引用の字は、前回の組版の結果 (1 回目は仮の字) で測るので、番号の桁が変われば、次の組版で列の幅も変わる
   * (flex の項目の基本の大きさは、中身の幅: Flexbox 1 §9.2 の 3 の E)。列をまたぐセルは見ない
   */
  private fitContentColumns(table: LTable, st: ResolvedStyle): LTable {
    const rows = [...(table.header?.rows ?? []), ...table.body.rows, ...(table.footer?.rows ?? [])];
    const fit = new Map<number, number>();
    for (const { cell, c: col, cs: span } of placeCells([rows]).placed) {
      if (span !== 1 || !table.columns[col]?.fitContent) continue;
      const cst = resolveStyle(st, cell);
      const w = Math.ceil(this.intrinsicWidth(cell.children, cst, 1e5) * 100) / 100 + 0.01 + describeBox(cell, cst.wm).bpI;
      fit.set(col, Math.max(fit.get(col) ?? 0, w));
    }
    if (!fit.size) return table;
    return { ...table, columns: table.columns.map((c, k) => (fit.has(k) ? { ...c, width: fit.get(k)! } : c)) };
  }

  private measureColumns(table: LTable, st: ResolvedStyle, avail: number): number[] {
    const maxW: number[] = [];
    const minW: number[] = [];
    // 幅の指定のあるセルを含む列 (余りを配るとき、指定の無い列を先にする)
    const specified: boolean[] = [];
    this.specifiedColumns = specified;
    const rows = [...(table.header?.rows ?? []), ...table.body.rows, ...(table.footer?.rows ?? [])];
    const measure = (cell: LTableCell, rootI: number) => {
      const cst = resolveStyle(st, cell);
      // 同じセルを同じ条件で測った結果は、同じ組版の中で使い回す (試し組みと本番、入れ子の表の計測)
      const memo = this.host.cellMeasure;
      const key = memo ? `${rootI}|${JSON.stringify(cst)}` : '';
      const hit = memo?.get(cell)?.get(key);
      if (hit !== undefined) return hit;
      // セルの節が違っても中身が同じなら使い回す (collapse の表は、組むたびにセルを写して罫線を決め直すので、セルの節では当たらない)
      const w = Math.ceil(this.intrinsicWidth(cell.children, cst, rootI, rootI <= 1) * 100) / 100 + 0.01;
      if (memo) {
        let m = memo.get(cell);
        if (!m) memo.set(cell, (m = new Map()));
        m.set(key, w);
      }
      return w;
    };
    // セルをグリッドに割り付ける (上の行から縦にまたがるセルの列は飛ばす)。計測では header・body・footer を通した 1 つの塊として割り付ける
    const spanning: { cell: LTableCell; col: number; span: number }[] = [];
    for (const { cell, c: col, cs: span } of placeCells([rows]).placed) {
      if (span === 1) {
        const d = describeBox(cell, resolveStyle(st, cell).wm);
        const bp = d.bpI;
        const mn = measure(cell, 1) + bp;
        // セルの幅の指定 (W): W が中身の最小の幅 (MCW) より大きければ、W が最小の幅。最大の幅も W にする (CSS 2.1 §17.5.2.2)
        const W = d.isizeExplicit != null ? d.isizeExplicit + bp : undefined;
        const mx = W !== undefined ? Math.max(W, mn) : measure(cell, 1e5) + bp;
        if (W !== undefined) specified[col] = true;
        maxW[col] = Math.max(maxW[col] ?? 0, mx);
        minW[col] = Math.max(minW[col] ?? 0, W !== undefined ? Math.max(W, mn) : mn);
      } else spanning.push({ cell, col, span });
    }
    // 列をまたぐセル (CSS 2.1 §17.5.2.2): またぐ列の数の小さい順に、セルの最小・最大の幅 (またぐ列の間のセルの間隔を引く) が
    // 列の最小・最大の幅の合計を超えるなら、超えた分を列に配る (列の最大の幅の比で。最大の幅が無ければ等しく)
    const spI = table.borderCollapse !== 'collapse' && table.borderSpacing ? table.borderSpacing.i : 0;
    const spread = (ws: number[], col: number, span: number, need: number, weights: number[]) => {
      let have = 0;
      for (let k = col; k < col + span; k++) have += ws[k] ?? 0;
      if (need <= have + EPS) return;
      const wt = weights.slice(col, col + span).map((w) => w ?? 0);
      const tw = wt.reduce((a, b) => a + b, 0);
      for (let k = 0; k < span; k++) ws[col + k] = (ws[col + k] ?? 0) + ((need - have) * (tw > 0 ? wt[k] / tw : 1 / span));
    };
    spanning.sort((a, b) => a.span - b.span);
    for (const { cell, col, span } of spanning) {
      const d = describeBox(cell, resolveStyle(st, cell).wm);
      const bp = d.bpI - spI * (span - 1);
      const cmn = measure(cell, 1) + bp;
      const W = d.isizeExplicit != null ? d.isizeExplicit + bp : undefined;
      const cmx = W !== undefined ? Math.max(W, cmn) : measure(cell, 1e5) + bp;
      for (let k = col; k < col + span; k++) {
        minW[k] ??= 0;
        maxW[k] ??= 0;
      }
      // 最大の幅の比は、配る前の値で (最小の幅を配ってから最大の幅を配る)
      const weights = maxW.slice();
      spread(minW, col, span, W !== undefined ? Math.max(W, cmn) : cmn, weights);
      spread(maxW, col, span, cmx, weights);
      for (let k = col; k < col + span; k++) maxW[k] = Math.max(maxW[k], minW[k]);
    }
    const n = Math.max(maxW.length, table.columns.length);
    // 列の幅の指定 (HTML の col の width): 列の最小・最大の幅は、指定とセルの最小の幅の大きい方 (CSS 2.1 §17.5.2.2)
    if (table.columnWidthsAsMinimum) {
      table.columns.forEach((col, k) => {
        if (typeof col.width !== 'number') return;
        const w = Math.max(col.width, minW[k] ?? 0);
        minW[k] = w;
        maxW[k] = w;
        specified[k] = true;
      });
    }
    const mx = Array.from({ length: n }, (_, k) => maxW[k] ?? 0);
    const mn = Array.from({ length: n }, (_, k) => Math.min(minW[k] ?? 0, mx[k]));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    if (sum(mx) <= avail) return mx;
    if (sum(mn) >= avail) return sum(mn) > 0 ? mn.map((w) => (w * avail) / sum(mn)) : mn;
    if (table.fitContentRule === 'ah-html') {
      // 'ah-html' の規則 (LTable.fitContentRule): 最大の長さが均等割り以下の列は最大の長さ、残りの列は最小の長さ + 余りを最大の長さの比で
      const keep = mx.map((w) => w <= avail / n);
      const left = avail - sum(mx.filter((_, k) => keep[k]));
      const mnF = sum(mn.filter((_, k) => !keep[k]));
      const mxF = sum(mx.filter((_, k) => !keep[k]));
      if (left >= mnF && mxF > 0) return mn.map((w, k) => (keep[k] ? mx[k] : w + ((left - mnF) * mx[k]) / mxF));
      // 最大の長さのままの列で幅が足りなくなるときは、すべての列を最小の長さ + 余りを最大の長さの比で
      return mn.map((w, k) => w + ((avail - sum(mn)) * mx[k]) / sum(mx));
    }
    // 中身の短い列 (最大の長さが均等割りの半分以下) は最大の長さのまま (短い列を折り返さない)。
    // 残りの列に、最小と最大の間を比例で配る
    const fixed = mx.map((w) => w <= avail / n / 2);
    const rest = avail - sum(mx.filter((_, k) => fixed[k]));
    if (table.fitContentRule === 'max-ratio') {
      // 最大の長さ (使える幅で頭打ち) の比で配る。最小の長さを割る列は最小にし、残りをほかの列で配り直す
      const w = mx.map((x, k) => (fixed[k] ? x : 0));
      let free = mx.map((_, k) => !fixed[k]);
      let left = rest;
      for (let pass = 0; pass < n; pass++) {
        const tot = sum(mx.map((x, k) => (free[k] ? Math.min(x, avail) : 0)));
        if (tot <= 0) break;
        const under = mx.map((x, k) => free[k] && (Math.min(x, avail) * left) / tot < mn[k]);
        if (!under.some(Boolean)) {
          mx.forEach((x, k) => free[k] && (w[k] = (Math.min(x, avail) * left) / tot));
          break;
        }
        under.forEach((u, k) => u && ((w[k] = mn[k]), (left -= mn[k])));
        free = free.map((f, k) => f && !under[k]);
      }
      // 短い列 (最大の長さのまま) と最小の長さに留めた列で行幅を超えるなら、下の (最小と最大の間を配る) 方法に任せる
      if (sum(w) <= avail + EPS) return w;
    }
    const mnR = sum(mn.filter((_, k) => !fixed[k]));
    const mxR = sum(mx.filter((_, k) => !fixed[k]));
    if (rest <= mnR || mxR <= mnR) {
      const r = (avail - sum(mn)) / (sum(mx) - sum(mn));
      return mn.map((w, k) => w + (mx[k] - w) * r);
    }
    const r = (rest - mnR) / (mxR - mnR);
    return mn.map((w, k) => (fixed[k] ? mx[k] : w + (mx[k] - w) * r));
  }

  /**
   * 表の列の幅の決定 (layoutTable の前半)。自動レイアウト (fitContent: 中身に合わせる / fillContent: 幅の指定に満たない分を配る) の
   * 列の幅を measureColumns で求めて node.columns に入れ、表の幅 (desc.isizeExplicit) と、auto の余白・寄せ (table-and-caption の text-align)
   * による始端の余白を desc に入れる。固定レイアウトの表はそのまま。out は collapse の外枠の罫線の外へ出る半分、gaps はセルの間隔の合計
   */
  private tableColumnWidths(node: LTable, desc: BoxDesc, st: ResolvedStyle, ps: ResolvedStyle, out: { is: number; ie: number }, gaps: number): { node: LTable; desc: BoxDesc } {
    // 見出しの最小の幅 (CAPMIN): 自動レイアウトの表の幅は、これより狭くしない (CSS 2.1 §17.5.2.2)。表の罫線・padding の内側の幅に直す
    const capMin = () => {
      let w = 0;
      for (const c of node.captions ?? []) {
        const cst = resolveStyle(st, c.block);
        const d = describeBox(c.block, cst.wm);
        w = Math.max(w, Math.ceil(this.intrinsicWidth(c.block.children, cst, 1) * 100) / 100 + d.bpI + d.m.is + d.m.ie);
      }
      return Math.max(w - desc.bpI, 0);
    };
    /** 列の幅の合計を tot 以上にする (足りない分は列の幅の比で、幅が 0 なら等しく配る) */
    const widen = (widths: number[], tot: number) => {
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum >= tot || !widths.length) return widths;
      return sum > 0 ? widths.map((w) => (w * tot) / sum) : widths.map(() => tot / widths.length);
    };
    if (node.fitContent && desc.isizeExplicit == null) {
      // 列の幅を中身の長さに合わせ、表の幅はその合計にする
      let widths = this.measureColumns(node, st, Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI - gaps, 0));
      if (node.captions?.length) widths = widen(widths, capMin() - gaps);
      node = { ...node, columns: widths.map((w) => ({ type: 'table-column' as const, width: w })) };
      desc = { ...desc, isizeExplicit: widths.reduce((a, b) => a + b, 0) + gaps };
      // 余白が auto なら、残りをその余白に配る (CSS 2.1 §10.3.3)。'start' は margin-left が auto (rtl でも物理の左右で決まる)
      if (node.autoMargins) {
        // collapse の表が持つ外枠の罫線は、半分が余白の側へ出る (後で余白から引く)。表の箱 (罫線の中心の線まで) を寄せる。
        // アンテナハウス互換 (collapseSpillAh) では、外へ出る半分も表の内側に置くので、罫線の外側までを寄せる
        const spill = node.borderCollapse === 'collapse' && !node.collapseSpillAh ? (desc.bw.is ? out.is : 0) + (desc.bw.ie ? out.ie : 0) : 0;
        const free = this.contentI() - desc.m.is - desc.m.ie - desc.bpI - desc.isizeExplicit! + spill;
        const am = node.autoMargins;
        if (free > EPS) desc = { ...desc, m: { ...desc.m, is: desc.m.is + (am === 'center' ? free / 2 : am === 'start' ? free : 0) } };
      }
    } else if (node.fillContent && desc.isizeExplicit != null) {
      // 幅の指定のある自動レイアウト: 中身から列の幅を決め、表の幅に足りない分は列の幅の比で足す (CSS2 §17.5.2.2)
      if (node.captions?.length) {
        const cm = capMin();
        if (cm > desc.isizeExplicit) desc = { ...desc, isizeExplicit: cm };
      }
      const W = Math.max(desc.isizeExplicit! - gaps, 0);
      const widths = this.measureColumns(node, st, W);
      const tot = widths.reduce((a, b) => a + b, 0);
      // 足りない分は、伸びる中身 (leader) のある列に等しく配る。無ければ列の幅の比で配る
      const stretch = stretchColumns(node, widths.length);
      const ns = stretch.filter(Boolean).length;
      // 幅の指定の無い列があれば、余りはそれらの列だけに、その幅の比で配る (CSS Tables 3 §3.9.3: 幅の指定のある列より先に auto の列へ)
      const spec = this.specifiedColumns;
      const autoTot = widths.reduce((a, w, k) => a + (spec[k] ? 0 : w), 0);
      const fill =
        tot < W && ns > 0
          ? widths.map((w, k) => (stretch[k] ? w + (W - tot) / ns : w))
          : tot > 0 && tot < W && spec.some(Boolean) && autoTot > 0
            ? widths.map((w, k) => (spec[k] ? w : w + ((W - tot) * w) / autoTot))
            : tot > 0 && tot < W
              ? widths.map((w) => (w * W) / tot)
              : widths;
      node = { ...node, columns: fill.map((w) => ({ type: 'table-column' as const, width: w })) };
    }
    // 寄せ (table-and-caption の text-align): 表の幅 (指定、または固定の列の幅の合計) が置く場所より狭ければ、start 側の余白に空きを足す
    const align = node.alignByTextAlign ? (ps.textAlign === 'center' ? 'center' : ps.textAlign === 'end' ? 'end' : undefined) : undefined;
    if (align) {
      const fixed = node.columns.length && node.columns.every((c) => typeof c.width === 'number') ? node.columns.reduce((a, c) => a + (c.width as number), 0) : undefined;
      const w = desc.isizeExplicit ?? fixed;
      const free = w == null ? 0 : this.contentI() - desc.m.is - desc.m.ie - desc.bpI - w;
      if (w != null && free > EPS) desc = { ...desc, isizeExplicit: w, m: { ...desc.m, is: desc.m.is + (align === 'center' ? free / 2 : free) } };
    }
    return { node, desc };
  }

  /**
   * 表の見出し (CSS の caption) の配置: 表と見出しを包む箱 (table wrapper box) の中で、表の上か下 (side) に置く (CSS 2.1 §17.4)。
   * 包む箱が表の余白を持ち、幅は表の罫線の外側の幅 (capIs から capTableI)。見出しはその幅のブロックとして組む。ml は表の block 方向の余白
   * (上の見出しの最初の前・下の見出しの最後の後ろに空ける)
   */
  private placeTableCaptions(caps: NonNullable<LTable['captions']>, side: 'top' | 'bottom', ml: { bs: number; be: number }, st: ResolvedStyle, capIs: number, capTableI: number) {
    const list = caps.filter((c) => c.side === side);
    if (!list.length) return;
    const endFree = Math.max(this.contentI() - capIs - capTableI, 0);
    list.forEach((c, k) => {
      const cm = toLogical(normEdges(c.block.margin), this.wm);
      const lm = { bs: cm.bs + (k === 0 ? ml.bs : 0), be: cm.be + (k === list.length - 1 ? ml.be : 0), is: cm.is + capIs, ie: cm.ie + endFree };
      this.layoutBlock({ ...c.block, margin: toPhysicalEdges(lm, this.wm) }, st);
    });
  }

  /**
   * 表の本体の行の配置 (layoutTable の後半のループ)。rowSpan で結びついた行は 1 つの塊 (グループ) として置き、keep-with-next /
   * keep-with-previous でつながった塊はまとめて置く。1 ページに入らない塊は rowSpan を分け (unspanRows)、入らない 1 行はセルの中身を
   * 行単位で分けてページをまたぐ。改ページのたびに placeHeader (繰り返す見出し) と placeFooterAtBreak (ページ末尾のフッター) を呼び、
   * reserve はフッターのために空けておく高さ
   */
  private layoutTableRows(node: LTable, st: ResolvedStyle, sizes: number[], headerRows: LNode[], reserve: number, placeHeader: (repeated: boolean) => void, placeFooterAtBreak: (() => void) | undefined, tm?: TableMarkerHooks) {
    // rowSpan で結びついた行は 1 つの塊 (グループ) として配置する
    let rows = node.body.rows;
    const bst = resolveStyle(st, node.body);
    const place = tm ? tm.place : (grp: LNode[], forceNewPage = false) => this.placeRows(grp, false, () => placeHeader(true), { reserve, beforeBreak: placeFooterAtBreak, forceNewPage });
    // 続きのページで繰り返す見出しの高さ (fo:retrieve-table-marker のある表では、grp で始まる断片の見出しの高さ)
    const repeatedHeaderH = (grp: LNode[]) => (tm ? tm.nextHeaderH(grp) : height(headerRows.length && !node.omitHeaderAtBreak ? headerRows : []));
    const height = (ns: LNode[]) => ns.reduce((a, r) => a + r.bsize, 0);
    // keep-with-next / keep-with-previous でつながった行の塊は、まとめて置く (ただし 1 ページに入らない長さなら分ける)
    const maxKeep = Number.isFinite(this.limit) ? this.limit * 0.9 : Infinity;
    let pending: LNode[] = [];
    let pendingLinked = false;
    const flushPending = () => {
      if (pending.length) place(pending);
      pending = [];
    };
    const closeBorder = () => this.stack.reduce((a, f) => a + (f.node.kind === 'table' ? f.desc.bw.be : 0), 0);
    for (let i = 0; i < rows.length; ) {
      const end = groupEnd(rows, i);
      const sinkAt = this.markerSink.length;
      const grp = this.layoutRowGroup(rows.slice(i, end + 1), sizes, bst);
      tm?.note(grp, rows.slice(i, end + 1), this.markerSink.slice(sinkAt));
      // 行の前の強制改ページ (CSS の tr の break-before)
      if ((rows[i].breakBefore || rows[i - 1]?.breakAfter) && i > 0 && this.paginating) {
        flushPending();
        place(grp, true);
        pendingLinked = !!rows[end].keepWithNext;
        i = end + 1;
        continue;
      }
      const linkedToPrev = pendingLinked || !!rows[i].keepWithPrevious;
      // 行をまたぐセルを含む塊が 1 ページに入らないときは、またぐセルを行ごとのセルに分け (中身は最初の行、間の罫線は消す)、
      // 行の境目で改ページできるようにする
      if (this.paginating && end > i) {
        const fullPage = this.limit - repeatedHeaderH(grp) - closeBorder() - (tm ? tm.nextReserve(grp) : reserve);
        if (height(grp) > fullPage + EPS) {
          rows = [...rows.slice(0, i), ...unspanRows(rows.slice(i, end + 1), this.wm), ...rows.slice(end + 1)];
          continue;
        }
      }
      if (!(linkedToPrev && pending.length && height(pending) + height(grp) <= maxKeep)) flushPending();
      // ページに入らない 1 行 (rowSpan 無し・keep-together 無し) は、セルの中身を行単位で分けてページをまたぐ (§7.20.3 の既定 auto)
      if (this.paginating && end === i && !pending.length && !rows[i].keepTogether && !rows[i].keepWithNext) {
        const avail = this.room - this.cursor - this.pendingValue() - closeBorder() - (tm ? tm.reserveNow(grp) : reserve);
        if (grp[0].bsize > avail + EPS) {
          const nextAvail = this.limit - repeatedHeaderH(grp) - closeBorder() - (tm ? tm.nextReserve(grp) : reserve);
          const splitMk: SplitMarkers | undefined = tm ? [] : undefined;
          const frags = this.splitRow(rows[i], sizes, bst, avail, nextAvail, splitMk);
          if (frags) {
            if (splitMk) tm?.noteSplit(frags, rows[i], splitMk);
            frags.forEach((f, k) => place([f], k > 0));
            pendingLinked = false;
            i = end + 1;
            continue;
          }
        }
      }
      pending.push(...grp);
      pendingLinked = !!rows[end].keepWithNext;
      i = end + 1;
    }
    flushPending();
  }

  layoutTable(table: LTable, ps: ResolvedStyle) {
    if (this.host.stats) this.host.stats.tables++;
    const st = resolveStyle(ps, table);
    if (st.wm !== this.wm) return this.layoutOrthogonal(table, st, ps);
    let node = collapseTableBorders(table, st.wm);
    // アンテナハウス互換 (collapse): 行の高さの指定は、罫線の中心から中心まで (trimEdgeRowHeights)
    if (node.collapseToAfterCell) node = trimEdgeRowHeights(node, st.wm);
    if (node.breakBefore) this.forceBreak(node.breakBefore);
    if (node.keepTogether && this.paginating) this.keepTogetherCheck(table, ps);
    else if (this.paginating && table.body.rows.length && (table.header?.rows.length || (node.keepHeaderWithBodyAh && table.captions?.some((c) => c.side === 'top')))) {
      // 上の見出し・表ヘッダー・本体の最初の行の塊を、まとめて置けるか調べる (表ヘッダーだけをページ末に残さない。
      // アンテナハウス互換 (LTable.keepHeaderWithBodyAh) では、ヘッダーが無くても上の見出しと最初の行を離さない)
      const first = table.body.rows.slice(0, groupEnd(table.body.rows, 0) + 1);
      this.keepTogetherCheck({ ...table, footer: undefined, captions: table.captions?.filter((c) => c.side === 'top'), body: { ...table.body, rows: first } }, ps);
    }
    let desc = describeBox(node, this.wm);
    // collapse モデルの外枠の罫線は、半分が表の外へ出る (その分だけ表の箱を外へ広げる)
    const out = collapsedOuterHalves(node, this.wm);
    // 幅の指定は、外枠の罫線の中心から中心までの幅 (CSS 2.1 §17.6.2: 表の幅は外枠の罫線の半分を含む)。
    // 中身の幅は、それに外へ出る半分を足し、表が持つ外枠の罫線の太さ (desc.bpI に入る) を引いたもの
    const explicitI = desc.isizeExplicit != null;
    if (explicitI && (out.is || out.ie))
      desc = { ...desc, isizeExplicit: Math.max(0, desc.isizeExplicit! + out.is + out.ie - (node.borderCollapse === 'collapse' ? desc.bw.is + desc.bw.ie : 0)) };
    // 罫線を分ける表のセルの間隔 (border-separation / border-spacing) の、列の数ぶんの合計 (表の端の分も含む)
    const spI = node.borderCollapse !== 'collapse' && node.borderSpacing ? node.borderSpacing.i : 0;
    const gaps = spI > 0 ? spI * (columnSizes(node, 0).length + 1) : 0;
    ({ node, desc } = this.tableColumnWidths(node, desc, st, ps, out, gaps));
    if (node.columns.some((c) => c.fitContent)) node = this.fitContentColumns(node, st);
    // 表の見出し (CSS の caption): 表と見出しを包む箱 (table wrapper box) の中で、表の上か下に置く (CSS 2.1 §17.4)。
    // 包む箱が表の余白を持ち、幅は表の罫線の外側の幅。見出しはその幅のブロックとして組む
    const caps = node.captions ?? [];
    // 見出しを包む箱の幅は、表の外枠のはみ出しを足す前の表の幅で決める (下の見出しも上の見出しと同じ幅にそろえる。
    // はみ出しを足した後の値で計算すると、下の見出しだけ中央がずれる)
    const capIs = desc.m.is;
    const capTableI = desc.isizeExplicit != null ? desc.isizeExplicit + desc.bpI : Math.max(this.contentI() - desc.m.is - desc.m.ie, 0);
    if (caps.some((c) => c.side === 'top')) {
      this.placeTableCaptions(caps, 'top', { bs: desc.m.bs, be: 0 }, st, capIs, capTableI);
      desc = { ...desc, m: { ...desc.m, bs: 0 } };
    }
    const bottomMargin = desc.m.be;
    const bottomCaptions = caps.some((c) => c.side === 'bottom');
    if (bottomCaptions) desc = { ...desc, m: { ...desc.m, be: 0 } };
    if (out.is || out.ie) {
      desc = {
        ...desc,
        // アンテナハウス互換 (collapseSpillAh): 始めの側の外へ出る半分を余白に重ねず、表全体を内側に置く (幅は同じ。終わりの側へ
        // その分ずれる)
        m: node.collapseSpillAh ? { ...desc.m, ie: desc.m.ie - out.ie - out.is } : { ...desc.m, is: desc.m.is - out.is, ie: desc.m.ie - out.ie },
        // 中身に合わせた幅 (指定の無い表) は、外へ出る分を足す。ただし表が外枠の罫線を持つ辺は、列の幅の合計が中身の幅なので足さない
        // (足すと、終わり側の列と外枠の罫線の間に空きができる)
        ...(!explicitI && desc.isizeExplicit != null
          ? { isizeExplicit: desc.isizeExplicit + (node.borderCollapse === 'collapse' && desc.bw.is ? 0 : out.is) + (node.borderCollapse === 'collapse' && desc.bw.ie ? 0 : out.ie) }
          : {}),
      };
    }
    // block 方向は、前後の余白を畳んだ後から引く (前後の表のはみ出しは、どちらも余白に重なる)
    // アンテナハウス互換: 始めの側も余白に重ねない (表全体を内側に置く)
    // XSL: 外へ出る半分は、余白の量に関わらず外へ出す (pendSpill。CSS2 §17.6.2: 表の幅・高さに入るのは外側の罫線の半分で、残りの半分は
    // 余白の領域にある)。CSS の表は、余白の範囲でだけ重ねる (pendAdjust)
    if (this.host.xslSpace && !node.collapseSpillAh) this.pendSpill -= out.bs;
    else this.pendAdjust -= node.collapseSpillAh ? 0 : out.bs;
    desc = this.rtlEdge(desc, node, ps);
    const frame = this.openFrame(desc, 'table');
    if (this.host.xslSpace && !node.collapseSpillAh && out.bs > 0) frame.spillBs = out.bs;
    // 罫線を分ける表のセルの間隔 (border-separation / border-spacing): 列の幅は、間隔を除いた幅で決める
    const sp = node.borderCollapse !== 'collapse' && node.borderSpacing && (node.borderSpacing.i > 0 || node.borderSpacing.b > 0) ? node.borderSpacing : undefined;
    const nC = columnSizes(node, frame.contentI).length;
    const sizes = columnSizes(node, Math.max(frame.contentI - (sp ? sp.i * (nC + 1) : 0), 0));
    frame.node.colSizes = sizes;
    const savedSpacing = this.spacing;
    const savedRowspanAh = this.rowspanMiddleAh;
    const savedTableBreak = this.tableBreak;
    this.spacing = sp;
    this.rowspanMiddleAh = !!node.rowspanMiddleAh;
    this.tableBreak = node.breakBorders ? { ...node.breakBorders, header: !!node.header?.rows.length && !node.omitHeaderAtBreak, compat: !!node.collapseToAfterCell } : undefined;
    // fo:retrieve-table-marker のある表は、見出し・フッターを断片ごとに組む (layoutTableWithMarkers)。無い表は、いままでどおり 1 度だけ組んで繰り返す
    if ((node.header && collectTableRetrieves(node.header.rows).length) || (node.footer && collectTableRetrieves(node.footer.rows).length)) this.layoutTableWithMarkers(node, st, sizes);
    else {
      const headerRows = node.header ? this.layoutRowGroup(node.header.rows, sizes, resolveStyle(st, node.header)) : [];
      const footerRows = node.footer ? this.layoutRowGroup(node.footer.rows, sizes, resolveStyle(st, node.footer)) : [];
      const footerH = footerRows.reduce((a, r) => a + r.bsize, 0);
      // 改ページのたびに各ページの末尾へ置く表フッター。その分の高さを、本体の行を置くときに空けておく
      const repeatFooter = footerRows.length > 0 && !node.omitFooterAtBreak;
      const reserve = repeatFooter ? footerH : 0;
      const placeFooterAtBreak = repeatFooter
        ? () => {
            const clones = footerRows.map((f) => Object.assign(cloneNode(f), { repeated: true }));
            this.reborderFooterAtBreak(footerRows[0], clones[0]);
            this.placeRowsRaw(clones);
          }
        : undefined;
      const placeHeader = (repeated: boolean) => {
        if (!headerRows.length || (repeated && node.omitHeaderAtBreak)) return;
        const clones = headerRows.map((h) => {
          const c = cloneNode(h);
          c.repeated = repeated;
          return c;
        });
        this.placeRows(clones, true, () => {});
        // ページ内容がヘッダ行だけ (ヘッダを置く前はページに何も無かった = 置いた個数がヘッダの行数と一致) なら、
        // 以降の行は (入らなくても) 改ページしない (ヘッダだけのページが続くのを防ぐ)
        this.headerOnly = this.pageItems === headerRows.length;
      };
      placeHeader(false);
      this.layoutTableRows(node, st, sizes, headerRows, reserve, placeHeader, placeFooterAtBreak);
      // 表の末尾のフッター (改ページで繰り返す場合も、最後のページにはここで置く)
      if (footerRows.length) this.placeRows(footerRows, true, () => {});
    }
    // 最後の行と表の端の間の間隔
    if (sp?.b) this.cursor += sp.b;
    this.spacing = savedSpacing;
    this.rowspanMiddleAh = savedRowspanAh;
    this.tableBreak = savedTableBreak;
    this.closeFrame();
    if (this.host.xslSpace && !node.collapseSpillAh) this.pendSpill -= out.be;
    else if (!node.collapseSpillAh) this.pendAdjust -= out.be;
    if (bottomCaptions) {
      // 表の箱の左右の余白は、外枠の罫線の外へ出る分を引く前の値に戻す
      desc = { ...desc, m: { ...desc.m, is: desc.m.is + out.is, ie: desc.m.ie + out.ie } };
      this.placeTableCaptions(caps, 'bottom', { bs: 0, be: bottomMargin }, st, capIs, capTableI);
    }
    if (node.breakAfter) this.breakNext = node.breakAfter;
  }

  /**
   * fo:retrieve-table-marker (XSL 1.1 §6.13.7) のある表の、見出し・本体・フッターの配置。
   * 見出し・フッターの中身は、表の断片 (ページ・段ごとの表の箱) に入った行のマーカーで決まるので、断片ごとに組む。
   * 中身で見出し・フッターの高さが変わり、高さで断片に入る行が変わるので、行の塊を 1 つ置くたびに「その塊までを断片に入れたときの
   * 見出しとフッター」で入るかを確かめる (見出しの高さの差と、フッターの高さを空きから引く)。入れば見出しをその中身に差し替え
   * (高さが変われば、置いた行をその分ずらす)、入らなければ、その塊を入れない中身のまま断片を閉じる。断片に入る行は前から順に決まるので、
   * 組み直しは要らない
   */
  private layoutTableWithMarkers(node: LTable, st: ResolvedStyle, sizes: number[]) {
    const scope = new TableMarkerScope();
    const height = (ns: LNode[]) => ns.reduce((a, r) => a + r.bsize, 0);
    const ids = new Map<LMarker, number>();
    const idOf = (m: LMarker | undefined) => (m ? (ids.get(m) ?? (ids.set(m, ids.size), ids.size - 1)) : -1);
    /** 見出し (フッター) を、断片の領域が areas のときの中身で組む。同じ中身なら、組んだものを使い回す */
    const variants = (group: LTableBody | undefined) => {
      const retrieves = group ? collectTableRetrieves(group.rows) : [];
      const gst = group ? resolveStyle(st, group) : st;
      const cache = new Map<string, LNode[]>();
      return (areas: readonly MarkerArea[]): LNode[] => {
        if (!group?.rows.length) return [];
        const picks = new Map(retrieves.map((r) => [r, scope.find(r, areas)]));
        const key = retrieves.map((r) => idOf(picks.get(r))).join(',');
        let rows = cache.get(key);
        if (!rows) {
          const sinkAt = this.markerSink.length;
          const resolved = replaceRetrieves<LTableRow[], LRetrieveTableMarker>(group.rows, 'retrieve-table-marker', (r) => (picks.has(r) ? picks.get(r) : scope.find(r, areas)), true);
          rows = this.layoutRowGroup(resolved, sizes, gst);
          // 見出しの中の索引の目印などは、最初に組んだ 1 つの分だけ残す (中身の違う組み直しのたびに増やさない)
          if (cache.size) this.markerSink.length = sinkAt;
          cache.set(key, rows);
        }
        return rows;
      };
    };
    const headerOf = variants(node.header);
    const footerOf = variants(node.footer);
    const hasFooter = !!node.footer?.rows.length;
    const repeatFooter = hasFooter && !node.omitFooterAtBreak;
    const repeatHeader = !!node.header?.rows.length && !node.omitHeaderAtBreak;
    /** 行の塊 (最初の行の節) ごとの、断片に加える領域 */
    const info = new WeakMap<LNode, GroupMarkers>();
    const withGroup = (areas: readonly MarkerArea[], grp: LNode[]) => grp.reduce<readonly MarkerArea[]>((a, n) => extendAreas(a, info.get(n)), areas);
    // いまの断片に置いた見出し: 組んだ行 (shown)・置いた複製 (placed)・置いた箱 (box)
    let shown: LNode[] = [];
    let placed: LNode[] = [];
    let box: LNode | undefined;
    let col = this.pages?.columnIndex?.() ?? 0;
    let broke = false;
    const onBreak = () => {
      // 次の断片へ。段の番号が進んでいれば同じページ (retrieve-boundary-within-table="page" の範囲)
      const c = this.pages?.columnIndex?.() ?? 0;
      scope.nextFragment(c > col);
      col = c;
      shown = [];
      placed = [];
      broke = true;
    };
    const placeHeader = (repeated: boolean, grp: LNode[]) => {
      shown = [];
      placed = [];
      if (!node.header?.rows.length || (repeated && node.omitHeaderAtBreak)) return;
      const rows = headerOf(withGroup(scope.areas, grp));
      const clones = rows.map((h) => Object.assign(cloneNode(h), { repeated }));
      this.placeRows(clones, true, () => {}, { onBreak });
      shown = rows;
      placed = clones;
      box = this.containerNode();
      this.headerOnly = this.pageItems === clones.length;
    };
    /** 置いた見出しを、組み直した rows に差し替える。高さの差の分だけ、後ろの行をずらす */
    const swapHeader = (rows: LNode[]) => {
      const at = box ? box.children.indexOf(placed[0]) : -1;
      if (!box || at < 0) return;
      const delta = height(rows) - height(shown);
      const clones = rows.map((h) => Object.assign(cloneNode(h), { repeated: placed[0].repeated }));
      let b = placed[0].b;
      for (const c of clones) {
        c.i = 0;
        c.b = b;
        b += c.bsize;
        this.noteIds(c);
      }
      box.children.splice(at, placed.length, ...clones);
      for (let k = at + clones.length; k < box.children.length; k++) box.children[k].b += delta;
      this.cursor += delta;
      shown = rows;
      placed = clones;
    };
    const placeFooterAtBreak = repeatFooter
      ? () => {
          const rows = footerOf(scope.areas);
          const clones = rows.map((f) => Object.assign(cloneNode(f), { repeated: true }));
          this.reborderFooterAtBreak(rows[0], clones[0]);
          this.placeRowsRaw(clones);
        }
      : undefined;
    const place = (grp: LNode[], forceNewPage = false) => {
      // この塊までを断片に入れたときの見出しとフッター
      const areas = withGroup(scope.areas, grp);
      const head = placed.length ? headerOf(areas) : shown;
      const reserve = (placed.length ? height(head) - height(shown) : 0) + (repeatFooter ? height(footerOf(areas)) : 0);
      broke = false;
      this.placeRows(grp, false, () => placeHeader(true, grp), { reserve, beforeBreak: placeFooterAtBreak, forceNewPage, onBreak });
      if (!broke && placed.length && head !== shown) swapHeader(head);
      scope.areas = withGroup(scope.areas, grp) as MarkerArea[];
    };
    const hooks: TableMarkerHooks = {
      place,
      note: (grp, rows, sink) => {
        const bodies = rows.flatMap((r) => (r.bodyMarkers ? [{ ...r.bodyMarkers }] : []));
        const areas = sink.filter((m) => !m.indexId).map((m) => ({ marker: m.marker, first: true, last: true }));
        if (grp[0] && (bodies.length || areas.length)) info.set(grp[0], { areas, bodies });
      },
      noteSplit: (frags, row, mk) => {
        frags.forEach((f, k) => {
          const areas = mk.filter((e) => e.start <= k && k <= e.end).map((e) => ({ marker: e.marker, first: e.start === k, last: e.end === k }));
          const bm = row.bodyMarkers;
          info.set(f, { areas, bodies: bm ? [{ markers: bm.markers, first: bm.first && k === 0, last: bm.last && k === frags.length - 1 }] : [] });
        });
      },
      nextHeaderH: (grp) => (repeatHeader ? height(headerOf(withGroup([], grp))) : 0),
      nextReserve: (grp) => (repeatFooter ? height(footerOf(withGroup([], grp))) : 0),
      reserveNow: (grp) => (repeatFooter ? height(footerOf(withGroup(scope.areas, grp))) : 0),
    };
    placeHeader(false, []);
    this.layoutTableRows(node, st, sizes, [], 0, () => {}, placeFooterAtBreak, hooks);
    // 表の末尾のフッター。ここで改ページしたら (各ページの末尾に繰り返さないフッターが入らないとき)、行の無い新しい断片の中身に組み直す
    if (hasFooter) {
      const rows = footerOf(scope.areas).slice();
      this.placeRows(rows, true, () => {}, {
        onBreak: () => {
          onBreak();
          rows.splice(0, rows.length, ...footerOf(scope.areas));
        },
      });
    }
  }

  /** 行の塊 (1 行以上) を 1 単位として配置。入らなければ塊ごと次ページへ */
  private placeRows(
    group: LNode[],
    isHeader: boolean,
    afterBreak: () => void,
    opts: { reserve?: number; beforeBreak?: () => void; forceNewPage?: boolean; /** 改ページした直後に呼ぶ (見出しの行でも) */ onBreak?: () => void } = {},
  ) {
    this.applyPendingBreak();
    // 行の前の余白 (list-item の space-before): 保留中の余白と重ね合わせる (ページの先頭では捨てる)
    const sbRow = group[0]?.rowSpace?.before ?? 0;
    if (sbRow) this.addMargin(sbRow);
    const extent = group.reduce((a, r) => a + r.bsize, 0);
    if (this.paginating) {
      // 断片の終端で表の外枠を閉じる分と、各ページ末尾の表フッターの分も確保する
      const closeBorder = this.stack.reduce((a, f) => a + (f.node.kind === 'table' ? f.desc.bw.be : 0), 0);
      // 行グリッドの中では、最後の行の後ろの半行間は空けない (アンテナハウスの baseline-grid)。セルの中の最後の行の分を、入るかの判定に数えない
      const last = group[group.length - 1];
      const gridTrail = this.inGrid() && last?.children.length ? Math.min(...last.children.map((c) => c.trailLead ?? 0)) : 0;
      const need = this.cursor + this.pendingValue() + extent - gridTrail + closeBorder + (opts.reserve ?? 0) + this.heldFootCost(group);
      if (need > this.room + EPS || (opts.forceNewPage && this.pageHasContent)) {
        if (this.pageHasContent && (!this.headerOnly || opts.forceNewPage)) {
          // 行の境目で改ページするとき、このページの最後の行の後ろ側の罫線を引く (表フッターを置かない場合。セルの中の切れ目は除く)
          if (!isHeader && !opts.beforeBreak && !opts.forceNewPage) this.closeRowAtBreak(group[0]);
          opts.beforeBreak?.();
          this.breakPage();
          opts.onBreak?.();
          if (!isHeader) {
            afterBreak();
            this.reborderAfterHeader(group[0]);
          }
          // ヘッダ複製後に再判定 (ヘッダ + 行が入らない場合は強制配置)
        } else {
          this.host.warn('表の行がページ高さを超えているため溢れます');
        }
      }
    }
    this.flush();
    this.commitMarkers();
    for (const row of group) {
      row.i = 0;
      row.b = this.cursor - this.contentStartB();
      this.containerNode().children.push(row);
      this.noteIds(row);
      this.cursor += row.bsize;
      this.placeHeldFootnotes(row);
      this.pageItems++;
    }
    this.adjacent = 0;
    this.notePlaced();
    if (!isHeader) this.headerOnly = false;
    // 行の後ろの余白 (list-item の space-after): 次の行・表の後ろの余白と重ね合わせる
    const saRow = group[group.length - 1]?.rowSpace?.after ?? 0;
    if (saRow) this.addMargin(saRow);
  }

  /**
   * 行の境目の改ページで、ページの最後の行のセルに後ろ側の罫線を付ける。
   * collapse の表では、行の間の罫線を後ろの行のセルが持つ (互換モード)、または前のセルは場所だけ取って描かない (仕様モード) ので、
   * 後ろの行が次のページへ行くと、ページの最後の行の下に罫線が無くなる。後ろの行のセルの前側の罫線と同じ線を引く
   */
  private closeRowAtBreak(next: LNode | undefined) {
    if (!next) return;
    const kids = this.containerNode().children;
    let last: LNode | undefined;
    for (let k = kids.length - 1; k >= 0; k--) {
      if (kids[k].kind === 'row') {
        last = kids[k];
        break;
      }
    }
    if (!last || last.repeated) return;
    const s = startSide(this.wm);
    const e = endSide(this.wm);
    for (const cell of last.children) {
      if (cell.kind !== 'cell') continue;
      const own = cell.border[e];
      if (own && !own.collapse?.noPaint) continue;
      const ci = cell.i ?? 0;
      const ce = ci + (cell.isize ?? 0);
      const below = next.children.find((c) => c.kind === 'cell' && (c.i ?? 0) < ce - EPS && (c.i ?? 0) + (c.isize ?? 0) > ci + EPS && c.border[s]);
      const b = below?.border[s] ?? (own?.collapse?.noPaint ? { ...own, width: own.collapse.paintWidth ?? own.width * 2 } : undefined);
      if (!b) continue;
      // 辺の描き方は、重ね合わせの半分ずつの指示を外して、そのまま描く (表の外周の印は残す)
      const { collapse, ...rest } = b;
      cell.border[e] = collapse?.tableEdge ? { ...rest, collapse: { tableEdge: true } } : rest;
    }
  }

  /**
   * 続きのページで繰り返した表ヘッダーと、そのページの最初の行の境目の罫線を決め直す (collapse の表)。
   * 罫線は組む前に表全体の格子で決めてあり、行の前側の線は、元の格子で上にあった行と比べたもの。続きのページでその行の上に
   * 接するのは繰り返した表ヘッダーなので、表ヘッダーの最後の行の後ろ側の線と、この行の前側の線から選び直す (XSL 1.1 §6.7.3・§6.7.10)。
   * 表ヘッダーのセルは、境目の線の場所 (元の格子で決めた太さの半分) を取ってあり、線は行のセルが描く
   */
  private reborderAfterHeader(row: LNode | undefined) {
    const tb = this.tableBreak;
    if (!tb?.header || !row || row.kind !== 'row') return;
    this.reborderEdge(row, tb.headerAfter, tb.compat);
  }

  /**
   * 改ページの手前で繰り返す表フッターと、そのページの最後の行の境目の罫線を決め直す (collapse の表)。
   * 元の格子で表フッターの上にあるのは表の最後の行なので、このページの最後の行の後ろ側の線と、表フッターの最初の行の前側の線から
   * 選び直す (XSL 1.1 §6.7.3・§6.7.10)。orig は組んだ表フッターの最初の行、clone はこのページに置く複製
   */
  private reborderFooterAtBreak(orig: LNode | undefined, clone: LNode | undefined) {
    const tb = this.tableBreak;
    if (!tb || !orig || !clone) return;
    const kids = this.containerNode().children;
    let last: LNode | undefined;
    for (let k = kids.length - 1; k >= 0; k--) {
      if (kids[k].kind === 'row') {
        last = kids[k];
        break;
      }
    }
    if (!last || last.repeated) return;
    // このページの最後の行の、列ごとの後ろ側の線
    const above: Array<BorderSide | undefined> = tb.footerBefore.map(() => undefined);
    for (const cell of last.children) {
      const info = this.cellCols.get(cell);
      if (!info) continue;
      for (let x = info.c; x < info.c + info.cs && x < above.length; x++) above[x] = info.after;
    }
    orig.children.forEach((cell, k) => {
      const info = this.cellCols.get(cell);
      const target = clone.children[k];
      if (!info || !target) return;
      // 列ごとの線分で選び (上の行の線が先)、太い方をセルの辺にする
      let b: BorderSide | undefined;
      for (let x = info.c; x < info.c + info.cs && x < above.length; x++) {
        const w = breakEdgeBorder(above, x, 1, tb.footerBefore[x]);
        if (w && (!b || w.width > b.width)) b = w;
      }
      this.setBreakSide(target, b, tb.compat);
    });
  }

  /** 行のセルの前側の線を、edge (列ごとの線) とセルの前側の線から決め直す */
  private reborderEdge(row: LNode, edge: Array<BorderSide | undefined>, compat: boolean) {
    for (const cell of row.children) {
      const info = this.cellCols.get(cell);
      if (!info) continue;
      this.setBreakSide(cell, breakEdgeBorder(edge, info.c, info.cs, info.before), compat);
    }
  }

  /**
   * セルの前側の罫線を、改ページの境目で決め直した線にする。仕様の組み方では、グリッド線を中心に描く (場所は半分、描く太さは全体)。
   * 互換の組み方 (collapseToAfterCell) では、セルが全体の太さで持つ。
   * セルの中身は、線の場所 (太さの半分) の内側に置かれる (§6.7.10 の内容の矩形)。行の高さは組んだときのままにする
   * (改ページの判定を済ませた後なので。線が太くなれば、その差の分だけ中身が下がり、下の余白に食い込む)
   */
  private setBreakSide(cell: LNode, b: BorderSide | undefined, compat: boolean) {
    const s = startSide(this.wm);
    if (!b) {
      delete cell.border[s];
      return;
    }
    const { collapse: _c, ...rest } = b;
    cell.border[s] = compat ? rest : { ...rest, width: rest.width / 2, collapse: { paintWidth: rest.width } };
  }

  /** 行を、空きの確認をせずにそのまま置く (各ページ末尾の表フッター用。空きは確保済み) */
  private placeRowsRaw(rows: LNode[]) {
    this.flush();
    for (const row of rows) {
      row.i = 0;
      row.b = this.cursor - this.contentStartB();
      this.containerNode().children.push(row);
      this.cursor += row.bsize;
    }
  }

  /**
   * ページに入らない 1 行を、セルごとにページを持つ Flow で組み直して、ページごとの断片 (行) に分ける。
   * 最初の断片は avail、以降は nextAvail の高さに収める。最初の断片に何も入らなければ null (行ごと次ページへ送る)
   */
  private splitRow(row: LTableRow, sizes: number[], st: ResolvedStyle, avail: number, nextAvail: number, mk?: SplitMarkers): LNode[] | null {
    const rst = resolveStyle(st, row);
    // 罫線を分ける表のセルの間隔 (layoutRowGroup と同じ置き方): 列の間と表の端に si、行の前に sb
    const si = this.spacing?.i ?? 0;
    const sb = this.spacing?.b ?? 0;
    const nCols = sizes.length;
    const total = sizes.reduce((a, b) => a + b, 0) + si * (nCols + 1);
    interface CellFrags { cell: LTableCell; desc: BoxDesc; i: number; w: number; c: number; cs: number; roots: LNode[]; used: number[] }
    const cells: CellFrags[] = [];
    let col = 0;
    let brokeFirst = false;
    // 行を置くページに、すでに中身があるか (セルの中の keep の判定で、セルの先頭をページの先頭と見なさないため)
    const outerHas = this.pageHasContent;
    for (const cell of row.cells) {
      const cs = Math.max(1, cell.colSpan ?? 1);
      const w = sizes.slice(col, col + cs).reduce((a, b) => a + b, 0) + si * (Math.min(cs, nCols - col) - 1);
      const i = sizes.slice(0, col).reduce((a, b) => a + b, 0) + si * (col + 1);
      col += cs;
      const desc = describeBox(cell, this.wm);
      const bp = desc.bpStart + desc.bpEnd;
      const contentI = Math.max(w - desc.bpI, 0);
      const roots: LNode[] = [newNode('block', this.wm, { isize: contentI })];
      const used: number[] = [];
      // セルの中のマーカーの、親の始まる断片と終わる断片 (fo:retrieve-table-marker のある表でだけ控える)
      const cellMk: Array<{ pm: PendingMarker; start: number; end?: number }> = [];
      // 試し組みを兼ねるので、警告は出さない (分けられないときは、行ごと次ページへ送る通常の処理に戻る)
      const flow = new Flow({ ...this.host, warn: () => {} }, {
        wm: this.wm,
        rootI: contentI,
        root: roots[0],
        limit: Math.max(avail - bp - sb, 1),
        pages: {
          addMarkers: (list) => {
            this.markerSink.push(...list);
            if (mk) for (const pm of list) if (!pm.indexId) cellMk.push({ pm, start: roots.length - 1 });
          },
          ...(mk
            ? {
                markerEnd: (key: object) => {
                  for (const e of cellMk) if (e.pm.key === key && e.end === undefined) e.end = roots.length - 1;
                },
              }
            : {}),
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          atPageStart: () => roots.length > 1 || !outerHas,
          nextLimit: () => Math.max(nextAvail - bp - sb, 1),
          nextPage: () => {
            const r = newNode('block', this.wm, { isize: contentI });
            roots.push(r);
            return { root: r, limit: Math.max(nextAvail - bp - sb, 1), rootI: contentI };
          },
        },
        abs: this.abs,
        pageSize: this.pageSize,
        // セルの中の脚注は、行に持たせて、行を置くページの脚注領域に積む (placeRows の placeHeldFootnotes)
        footnotes: this.foot,
        holdFootnotes: true,
      });
      flow.layoutChildren(cell.children, resolveStyle(rst, cell));
      flow.finishPaginated();
      // 親の箱の無いマーカー (セルの子) は、セルの最後の断片で終わる
      if (mk) for (const e of cellMk) mk.push({ marker: e.pm.marker, start: e.start, end: e.end ?? roots.length - 1 });
      if (flow.brokeKeepPage === 0) brokeFirst = true;
      cells.push({ cell, desc, i, w, c: col - cs, cs, roots, used });
    }
    // 最初の断片に何も入らない、または入りきらない (1 行も置けない)、または widows / orphans を守れない (CSS Fragmentation 3 §3.3)
    // なら分けない
    const firstHas = cells.some((c) => c.roots[0].children.length > 0);
    // 基準線でそろえるセル (vertical-align: baseline) は、最初の行どうしを行の基準線にそろえる (CSS 2.1 §17.5.3)。
    // 中身があるのに最初の断片に行が無いセルがあれば、ほかのセルの最初の行だけを残すことになるので分けない
    // (例: リストの項目の目印のセルと本文のセル。目印だけが前のページに残らないように)
    const baselineSplit = cells.some((c) => c.cell.blockAlign === 'baseline' && c.cell.children.length > 0 && c.roots[0].children.length === 0);
    if (baselineSplit) return null;
    const firstOver = cells.some((c) => (c.used[0] ?? 0) + c.desc.bpStart + c.desc.bpEnd + sb > avail + EPS);
    if (!firstHas || firstOver || brokeFirst) return null;
    const n = Math.max(...cells.map((c) => c.roots.length));
    const out: LNode[] = [];
    for (let k = 0; k < n; k++) {
      const rn = newNode('row', this.wm, { isize: total, src: row.id, ref: sourceRef(row), ...(row.paintEffect ? { fx: row.paintEffect } : {}) });
      let h = 0;
      for (const c of cells) {
        const content = c.roots[k]?.children ?? [];
        // セルの中の切れ目: 前側・後ろ側の罫線と余白は、conditionality="retain" でなければ付けない (§4.3.1。初期値 discard)
        const cutS = k > 0;
        const cutE = k < n - 1;
        const bpS = cutS ? c.desc.keepStart.size : c.desc.bpStart;
        const bpE = cutE ? c.desc.keepEnd.size : c.desc.bpEnd;
        const bsize = (content.length ? (c.used[k] ?? 0) : 0) + bpS + bpE;
        h = Math.max(h, bsize);
        const cn = newNode('cell', this.wm, {
            i: c.i,
            ...(sb ? { b: sb } : {}),
            isize: c.w,
            bsize,
            padding: { ...c.desc.paddingP },
            border: { ...c.desc.borderP },
            bg: c.desc.bg,
            ...this.decorOf(c.desc),
            src: k === 0 ? c.desc.src : undefined,
            ref: c.desc.ref,
            children: content,
          });
        // 断片の前側・後ろ側の線は、セルの中の切れ目では無い (改ページの境目で決め直すときも、セルの側の線は無いものとする)
        this.cellCols.set(cn, { c: c.c, cs: c.cs, ...(!cutS && c.cell.breakEdges?.before ? { before: c.cell.breakEdges.before } : {}), ...(!cutE && c.cell.breakEdges?.after ? { after: c.cell.breakEdges.after } : {}) });
        if (cutS) cutStart(cn, c.desc.keepStart.border, c.desc.keepStart.padding);
        if (cutE) cutEnd(cn, c.desc.keepEnd.border, c.desc.keepEnd.padding);
        rn.children.push(cn);
      }
      for (const cn of rn.children) cn.bsize = h;
      rn.bsize = h + sb;
      out.push(rn);
    }
    if (rst.direction === 'rtl' && this.wm === 'horizontal-tb') mirrorCells(out, total);
    return out;
  }

  /**
   * 行グループを無改ページでレイアウトする (rowSpan 対応)。
   *  1. グリッドに各セルを割り付け (上の行から伸びてきたセルが占める列は飛ばす)
   *  2. 各セルを独立 Flow で組んで自然な高さを得る
   *  3. 行高 = その行で始まる rowSpan=1 のセルの最大高。rowSpan>1 のセルは、スパン数の小さい順に
   *     「必要高 − 現在の合計高」の不足分を最終行へ加算
   *  4. セルの bsize = 結合した行高の合計 (行ノードからはみ出す形で、開始行の子として保持)
   */
  layoutRowGroup(rows: LTableRow[], sizes: number[], st: ResolvedStyle): LNode[] {
    const sp = this.spacing;
    const si = sp?.i ?? 0;
    const sb = sp?.b ?? 0;
    const total = sizes.reduce((a, b) => a + b, 0) + si * (sizes.length + 1);
    const nCols = sizes.length;
    interface Placed { node: LNode; row: number; span: number; align?: LTableCell['blockAlign']; stretch?: boolean; stretchMax?: number }
    const placed: Placed[] = [];
    const rowNodes = rows.map((r) => newNode('row', this.wm, { isize: total, src: r.id, ref: sourceRef(r), ...(r.paintEffect ? { fx: r.paintEffect } : {}) }));
    const rowStyles = rows.map((row) => resolveStyle(st, row));
    // グリッドへの割り付け (placeCells): 上の行から伸びてきたセルが占める列は飛ばす。rowSpan はこの行グループの末尾で切る
    for (const { cell, r: j, c: col, rs, cs } of placeCells([rows]).placed) {
      const w = sizes.slice(col, col + cs).reduce((a, b) => a + b, 0) + si * (Math.min(cs, nCols - col) - 1);
      const cn = this.layoutCell(cell, w, rowStyles[j]);
      cn.i = sizes.slice(0, col).reduce((a, b) => a + b, 0) + si * (col + 1);
      this.cellCols.set(cn, { c: col, cs, ...cell.breakEdges });
      rowNodes[j].children.push(cn);
      placed.push({ node: cn, row: j, span: rs, align: cell.blockAlign, ...(cell.stretchContent ? { stretch: true } : {}), ...(cell.stretchMax !== undefined ? { stretchMax: cell.stretchMax } : {}) });
      if (cell.blockAlign) cn.cellAlign = cell.blockAlign;
      if (cell.stretchContent) cn.cellStretch = true;
      if (cell.stretchMax !== undefined) cn.cellStretchMax = cell.stretchMax;
    }
    // vertical-align: baseline のセル (CSS 2.1 §17.5.3): 同じ行のそれらのセルの最初の行の基線をそろえる (横書き)。
    // 基線のいちばん低いセルに合わせ、ほかのセルの中身を下げる
    if (this.wm === 'horizontal-tb') {
      rows.forEach((_, j) => {
        // 行の無いセルの基線は、内容の下端 (中の箱の下端。空なら上端)
        const contentBottom = (n: LNode) => (n.children.length ? Math.max(...n.children.map((c) => c.b + c.bsize)) : 0);
        // last-baseline のセル (flex の align-items: last baseline。CSS Box Alignment 3 §9.3): 最後の行の基線から下端までの距離を
        // いちばん長いものにそろえ (下に空きを足す)、下で行の下端に寄せる (代わりの揃えは end)。行の無いセルは下端を基線にする
        const ll = placed.filter((p) => p.row === j && p.align === 'last-baseline').map((p) => ({ p, below: p.node.bsize - (lastBaseline(p.node) ?? p.node.bsize) }));
        const deepest = Math.max(...ll.map((x) => x.below), -Infinity);
        for (const { p, below } of ll) if (deepest - below > EPS) p.node.bsize += deepest - below;
        const bl = placed.filter((p) => p.row === j && p.align === 'baseline').map((p) => ({ p, fb: firstBaseline(p.node) ?? (this.host.xslSpace ? undefined : contentBottom(p.node)) }));
        const target = Math.max(...bl.map((x) => x.fb ?? -Infinity));
        if (!Number.isFinite(target)) return;
        for (const { p, fb } of bl) {
          const d = fb === undefined ? 0 : target - fb;
          if (d <= EPS) continue;
          for (const c of p.node.children) c.b += d;
          p.node.bsize += d;
        }
      });
    }
    // 行の高さの最小値 (minHeight) から始める
    const heights = rows.map((r) => r.minHeight ?? 0);
    for (const p of placed) if (p.span === 1) heights[p.row] = Math.max(heights[p.row], p.node.bsize);
    // 行の高さの最大値 (block-progression-dimension.maximum): 中身が多くても、行はそれより高くしない
    rows.forEach((r, j) => r.maxHeight !== undefined && (heights[j] = Math.min(heights[j], Math.max(r.maxHeight, r.minHeight ?? 0))));
    for (const p of [...placed].filter((q) => q.span > 1).sort((a, b) => a.span - b.span)) {
      const have = heights.slice(p.row, p.row + p.span).reduce((a, b) => a + b, 0);
      if (p.node.bsize > have) heights[p.row + p.span - 1] += p.node.bsize - have;
    }
    for (const p of placed) {
      const natural = p.node.bsize;
      // セルの間隔: 各行の前に空ける。行をまたぐセルは間の間隔も含む
      p.node.bsize = heights.slice(p.row, p.row + p.span).reduce((a, b) => a + b, 0) + sb * (p.span - 1);
      if (sb) p.node.b = sb;
      // display-align: 行の高さに余りがあれば、内容を中央・末尾へ寄せる
      const extra = p.node.bsize - natural;
      if (extra > EPS && (p.align === 'center' || p.align === 'end' || p.align === 'last-baseline')) {
        // アンテナハウス互換 (rowspanMiddleAh): 中央寄せでは、またいだ行の間の間隔を除いた高さで中央を出す
        const ahGap = this.rowspanMiddleAh ? sb * (p.span - 1) : 0;
        const off = p.align === 'center' ? Math.max(extra - ahGap, 0) / 2 : extra;
        for (const c of p.node.children) c.b += off;
      }
      // flex の align-items: stretch: セルの中の唯一のブロック (項目) を行の高さまで伸ばす (背景・枠が行いっぱいに広がる)
      if (extra > EPS && p.stretch && p.node.children.length === 1 && p.node.children[0].kind === 'block') {
        // max-height (stretchMax) を超えては伸ばさない
        const kid = p.node.children[0];
        stretchCellBlock(p.node, kid, p.stretchMax !== undefined ? Math.max(0, Math.min(extra, p.stretchMax - this.extentAlongBlock(kid))) : extra);
      }
    }
    rowNodes.forEach((r, j) => (r.bsize = heights[j] + sb));
    rows.forEach((r, j) => (r.spaceBefore || r.spaceAfter) && (rowNodes[j].rowSpace = { before: r.spaceBefore ?? 0, after: r.spaceAfter ?? 0 }));
    if (st.direction === 'rtl' && this.wm === 'horizontal-tb') mirrorCells(rowNodes, total);
    return rowNodes;
  }

  private layoutCell(cell: LTableCell, width: number, rst: ResolvedStyle): LNode {
    const cst = resolveStyle(rst, cell);
    const desc = describeBox(cell, this.wm);
    const contentI = Math.max(width - desc.bpI, 0);
    // セルは参照領域: 先頭の余白 (space-before) は捨てる (XSL §4.3.1)。CSS のセル (keepEdgeSpace) は残す
    const sub = new Flow(this.host, { wm: this.wm, rootI: contentI, abs: this.abs, pageSize: this.pageSize, markerSink: this.markerSink, footnotes: this.foot, ...(cell.keepEdgeSpace ? {} : { discardLeading: true }), referenceArea: true });
    sub.layoutChildren(cell.children, cst);
    // 末尾の内容の後ろの余白 (space-after) も捨てる (keepTrailingSpace・keepEdgeSpace のセルは残す)
    const fin = sub.finishWithTrailing();
    const used = fin.height + (cell.keepTrailingSpace || cell.keepEdgeSpace ? fin.after : 0);
    const bsize = Math.max(used, desc.bsizeExplicit ?? 0) + desc.bpStart + desc.bpEnd;
    // 中身が行で終わり、その下に余白・枠が無ければ、その行の下の半行間 (行グリッドの中の表で、改ページの判定に数えない分)
    const trailLead = Math.abs(sub.lastLead.end - used) < EPS && !desc.bpEnd && bsize - desc.bpStart - used < EPS ? sub.lastLead.half : 0;
    return newNode('cell', this.wm, {
      ...(trailLead ? { trailLead } : {}),
      isize: width,
      bsize,
      padding: { ...desc.paddingP },
      border: { ...desc.borderP },
      bg: desc.bg,
      ...this.decorOf(desc),
      src: desc.src,
      ref: desc.ref,
      children: sub.root.children,
    });
  }
}

/**
 * 右から左の表: 列を右から並べる。セルの位置を行の幅の中で左右反転し、セルの左右の罫線・余白も入れ替える
 * (罫線の重ね合わせは左から右の並びで解決してあるので、箱ごと反転すれば辻褄が合う)
 */
function mirrorCells(rows: LNode[], total: number) {
  for (const r of rows) {
    for (const c of r.children) {
      c.i = total - c.i - c.isize;
      [c.border.left, c.border.right] = [c.border.right, c.border.left];
      if (!c.border.left) delete c.border.left;
      if (!c.border.right) delete c.border.right;
      [c.padding.left, c.padding.right] = [c.padding.right, c.padding.left];
    }
  }
}

/**
 * 対角罫・逆対角罫を物理の向きにする。before-start → after-end は、横書き・vertical-lr では左上 → 右下、
 * vertical-rl (before が右、start が上) では右上 → 左下
 */
function diagonalsOf(node: BoxStyle, wm: WritingMode): LNode['diag'] {
  const swap = wm === 'vertical-rl';
  const out: NonNullable<LNode['diag']> = [];
  if (node.diagonalBorder && node.diagonalBorder.width > 0) out.push({ kind: swap ? 'trbl' : 'tlbr', side: node.diagonalBorder });
  if (node.reverseDiagonalBorder && node.reverseDiagonalBorder.width > 0) out.push({ kind: swap ? 'tlbr' : 'trbl', side: node.reverseDiagonalBorder });
  return out.length ? out : undefined;
}

/**
 * 行の脚注: 行の字が参照する脚注 (参照記号) と、行の中の箱 (inline-container) の中の行が持つ脚注を、文書の順に並べる。
 * 行を置くページ (段) の脚注領域に、その本体を積む (XSL 1.1 §6.12.3: 本体は、参照のあるページの脚注領域に置く)
 */
function lineFootnotes(items: ReadonlyArray<{ fnRef?: LFootnote; box?: { node: LNode } }>): LFootnote[] {
  const out: LFootnote[] = [];
  const held = (n: LNode) => {
    for (const fn of n.fns ?? []) if (!out.includes(fn)) out.push(fn);
    for (const c of n.children) held(c);
  };
  for (const a of items) {
    if (a.fnRef) out.push(a.fnRef);
    else if (a.box) held(a.box.node);
  }
  return out;
}

/** 最も長い行の長さ (inline-container の shrink-to-fit 用) */
/**
 * セルの中の唯一のブロック kid を、セルの block 方向に add だけ伸ばす (flex の align-items: stretch)。書字方向がセルと直交する箱
 * (横書きの行の中の縦書きの項目) は、セルの block 方向が箱の行の向きなので、箱の行の向きの大きさを伸ばす (箱を包む節と、その中の箱)
 */
function stretchCellBlock(cell: LNode, kid: LNode, add: number) {
  if ((kid.wm === 'horizontal-tb') === (cell.wm === 'horizontal-tb')) {
    kid.bsize += add;
    return;
  }
  kid.isize += add;
  if (kid.children.length === 1 && kid.children[0].kind === 'block' && kid.children[0].wm === kid.wm) kid.children[0].isize += add;
}

/** c は、n と書字方向が直交するブロック・表か (行の中の箱は、行の長さに入っているので見ない) */
function isOrthogonalBox(n: LNode, c: LNode): boolean {
  return (c.kind === 'block' || c.kind === 'table') && n.kind !== 'line' && (c.wm === 'horizontal-tb') !== (n.wm === 'horizontal-tb');
}

/** 直交する子 c が、n の行の向きに占める大きさ (子の block の大きさ + その向きの余白) */
function orthogonalExtent(n: LNode, c: LNode): number {
  const s = bboxOf(c);
  const pos = (v: number) => Math.max(v, 0);
  return n.wm === 'horizontal-tb' ? s.width + pos(c.margin.left) + pos(c.margin.right) : s.height + pos(c.margin.top) + pos(c.margin.bottom);
}

function maxLineLength(n: LNode, root = true, tableByColumns = false, countFixed = false): number {
  // 行の長さには、行頭の字下げも入れる (CSS Text 3 §8.1: "The indent is treated as a margin applied to the start edge of the line box."
  // 字下げを受け継いだ inline-block・回り込みの箱の幅 (CSS 2.1 §10.3.5・§10.3.9 の shrink-to-fit) が字下げの分だけ足りず、中の行が折り返すのを防ぐ)
  if (n.kind === 'line') return (n.contentLength ?? 0) + (n.lineIndent ?? 0);
  // 大きさの指定のある箱は、中身によらず、箱の外側の大きさ (内容による大きさの計測。CSS Sizing 3 §5.1)
  if (countFixed && !root && n.fixedI) {
    const pos = (v: number) => Math.max(v, 0);
    return n.isize + (n.wm === 'horizontal-tb' ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom));
  }
  // 表は表そのものの幅 (中の行の長さではない)。tableByColumns なら、列の幅の合計 + 表の左右の罫線・余白
  // (幅の指定の無い表が、置く場所いっぱいに広がっていても、列の幅だけの長さにする)
  if (n.kind === 'table') {
    if (!tableByColumns || !n.colSizes?.length) return n.isize;
    const h = n.wm === 'horizontal-tb';
    const bw = (e: 'top' | 'right' | 'bottom' | 'left') => n.border[e]?.width ?? 0;
    const edges = h ? n.padding.left + n.padding.right + bw('left') + bw('right') : n.padding.top + n.padding.bottom + bw('top') + bw('bottom');
    const pos = (v: number) => Math.max(v, 0);
    const margins = root ? 0 : h ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom);
    return Math.min(n.isize, n.colSizes.reduce((a, b) => a + b, 0) + edges) + margins;
  }
  // 書字方向が直交する子 (横書きの中の縦書きの箱など) は、行の長さではなく、組んだ箱の block の大きさ (n の行の向きの大きさ) を数える
  // (CSS Writing Modes 3 §7.3 の Note: 直交する子の、中身から決まった block の大きさが、親の行の向きの min-content・max-content の大きさに入る)
  const inner = n.children.reduce((a, c) => Math.max(a, isOrthogonalBox(n, c) ? orthogonalExtent(n, c) : maxLineLength(c, false, tableByColumns, countFixed)), 0);
  // 中のブロックの inline 方向の余白・罫線・margin (start-indent など) も足す
  // (外側の箱をその長さで組み直したとき、中の行が折り返さないように。負の margin ははみ出しなので数えない)
  if (root || !inner) return inner;
  const h = n.wm === 'horizontal-tb';
  const bw = (e: 'top' | 'right' | 'bottom' | 'left') => n.border[e]?.width ?? 0;
  const pos = (v: number) => Math.max(v, 0);
  return inner + (h ? n.padding.left + n.padding.right + bw('left') + bw('right') + pos(n.margin.left) + pos(n.margin.right) : n.padding.top + n.padding.bottom + bw('top') + bw('bottom') + pos(n.margin.top) + pos(n.margin.bottom));
}

/** 横書きの箱の上端から、最初の文字の基線までの距離 */
/** 最後の行の基線 (箱の上端から)。CSS の inline-block の基線 */
/**
 * 組み終えた表 (flex の 1 行の表) を add だけ高くする: 最後の行とそのセルを伸ばし、セルの揃えを当て直す (伸ばすセルは中のブロックを伸ばし、
 * 中央・下端のセルは中身を下げる)。flex の折り返しの容器の align-content: stretch で、行を伸ばすときに使う (Flexbox 1 §9.4 の 15)
 */
function growTableLine(table: LNode, add: number) {
  table.bsize += add;
  const row = [...table.children].reverse().find((r) => r.kind === 'row');
  if (!row) return;
  row.bsize += add;
  for (const cell of row.children) {
    if (cell.kind !== 'cell') continue;
    cell.bsize += add;
    const a = cell.cellAlign;
    if (cell.cellStretch && cell.children.length === 1 && cell.children[0].kind === 'block') {
      const kid = cell.children[0];
      const have = cell.wm === 'horizontal-tb' ? bboxOf(kid).height : bboxOf(kid).width;
      stretchCellBlock(cell, kid, cell.cellStretchMax !== undefined ? Math.max(0, Math.min(add, cell.cellStretchMax - have)) : add);
    } else if (a === 'center' || a === 'end' || a === 'last-baseline') for (const c of cell.children) c.b += a === 'center' ? add / 2 : add;
  }
}

function lastBaseline(n: LNode): number | undefined {
  if (n.kind === 'glyph' && n.glyph) return n.glyph.baselineY;
  const off = n.padding.top + (n.border.top?.width ?? 0);
  let best: number | undefined;
  for (const c of n.children) {
    const r = lastBaseline(c);
    if (r !== undefined && (best === undefined || off + c.b + r > best)) best = off + c.b + r;
  }
  return best;
}

function firstBaseline(n: LNode): number | undefined {
  if (n.kind === 'glyph' && n.glyph) return n.glyph.baselineY;
  const off = n.padding.top + (n.border.top?.width ?? 0);
  for (const c of n.children) {
    const r = firstBaseline(c);
    if (r !== undefined) return off + c.b + r;
  }
  return undefined;
}

/** rows[i] から始まる rowSpan 連鎖の最終行インデックス */
function groupEnd(rows: LTableRow[], i: number): number {
  let end = i;
  for (let j = i; j <= end && j < rows.length; j++) {
    for (const c of rows[j].cells) if ((c.rowSpan ?? 1) > 1) end = Math.max(end, j + (c.rowSpan as number) - 1);
  }
  return Math.min(end, rows.length - 1);
}

/**
 * 行をまたぐセル (rowSpan) を、行ごとのセルに分ける。中身は最初の行のセルに置き、続きの行には空のセルを置いて、
 * 間の罫線を消す (1 つのセルに見える)。1 ページに入らない行の塊を、行の境目で分けられるようにするために使う
 */
function unspanRows(rows: LTableRow[], wm: WritingMode): LTableRow[] {
  const bs = startSide(wm);
  const be = endSide(wm);
  const sidesOf = (b: LTableCell['border']): Partial<Record<keyof Edges, BorderSide>> =>
    !b ? {} : 'width' in b ? { top: b, right: b, bottom: b, left: b } : { ...(b as Partial<Record<keyof Edges, BorderSide>>) };
  const without = (s: Partial<Record<keyof Edges, BorderSide>>, ...drop: Array<keyof Edges>) => {
    const o = { ...s };
    for (const d of drop) delete o[d];
    return o;
  };
  // セルの列の位置 (前の行からまたいでくるセルの列を飛ばす): placeCells の割り付けを行ごとに並べ直す
  const placed: Array<Array<{ cell: LTableCell; col: number }>> = rows.map(() => []);
  for (const p of placeCells([rows]).placed) placed[p.r].push({ cell: p.cell, col: p.c });
  const out = placed.map((list) => list.map((p) => ({ ...p })));
  placed.forEach((list, ri) => {
    for (const { cell, col } of list) {
      const rs = Math.max(cell.rowSpan ?? 1, 1);
      if (rs <= 1) continue;
      const sides = sidesOf(cell.border);
      const head = out[ri].find((p) => p.cell === cell)!;
      head.cell = { ...cell, rowSpan: undefined, border: without(sides, be) };
      for (let k = 1; k < rs && ri + k < rows.length; k++) {
        const last = k === rs - 1 || ri + k === rows.length - 1;
        const cont: LTableCell = {
          type: 'table-cell',
          ...(cell.colSpan ? { colSpan: cell.colSpan } : {}),
          ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
          ...(cell.padding !== undefined ? { padding: cell.padding } : {}),
          border: last ? without(sides, bs) : without(sides, bs, be),
          children: [],
        };
        out[ri + k].push({ cell: cont, col });
      }
    }
  });
  return rows.map((r, ri) => ({ ...r, cells: out[ri].sort((a, b) => a.col - b.col).map((p) => p.cell) }));
}

function cloneNode(n: LNode): LNode {
  return {
    ...n,
    margin: { ...n.margin },
    padding: { ...n.padding },
    border: { ...n.border },
    glyph: n.glyph ? { ...n.glyph } : undefined,
    phys: n.phys ? { ...n.phys } : undefined,
    children: n.children.map(cloneNode),
  };
}

/** 列ごとに、伸びる leader (最大の長さが最適の長さより長い) を含むセルがあるか (列をまたぐセルは数えない) */
function stretchColumns(table: LTable, n: number): boolean[] {
  const out = Array.from({ length: n }, () => false);
  const has = (kids: unknown[]): boolean =>
    kids.some((k) => {
      if (!k || typeof k !== 'object') return false;
      const o = k as { type?: string; children?: unknown[]; length?: { optimum?: number; maximum?: number }; lengthPct?: { optimum?: number; maximum?: number } };
      if (o.type === 'leader') {
        const opt = o.lengthPct?.optimum ?? o.length?.optimum ?? 0;
        const max = o.lengthPct?.maximum ?? o.length?.maximum;
        return max === undefined || max > opt || o.lengthPct?.maximum !== undefined;
      }
      return Array.isArray(o.children) && has(o.children);
    });
  for (const row of [...(table.header?.rows ?? []), ...table.body.rows, ...(table.footer?.rows ?? [])]) {
    let col = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan ?? 1;
      if (span === 1 && col < n && has(cell.children)) out[col] = true;
      col += span;
    }
  }
  return out;
}

/**
 * 段組の箱の段に組む中身。箱自身の行グリッド (-ah-baseline-grid) は、段の中にも効かせる
 * (中身を、同じ行グリッドを持つ包みのブロックで組む。段は箱の中の流れなので、箱の枠 (Frame) が段の流れに無い)
 */
function columnChildren(node: LBlockContainer): LBlockContainer['children'] {
  const grid = (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid;
  return grid === 'new' || grid === 'root' || grid === 'none' ? [{ type: 'block', baselineGrid: grid, children: node.children } as LBlock] : node.children;
}

function columnSizes(table: LTable, avail: number): number[] {
  let cols = table.columns;
  // 表の使う列の数: セルをグリッドに割り付けて数える (行をまたぐセルが占める列は、下の行のセルが飛ばす。CSS 2.1 §17.5)。
  // 表ヘッダー・本体・表フッターのどの行も数える (行ごとの colSpan の合計では、上の行から伸びてきたセルの列が抜ける)
  const used = placeCells([table.header?.rows ?? [], table.body.rows, table.footer?.rows ?? []]).nCols;
  if (!cols.length) cols = Array.from({ length: Math.max(1, used) }, () => ({ type: 'table-column' as const }));
  // 列定義より多くの列を使う行があれば、足りない分は auto 列として補う
  if (cols.length < used) cols = [...cols, ...Array.from({ length: used - cols.length }, () => ({ type: 'table-column' as const }))];
  let fixed = 0;
  let stars = 0;
  const weights = cols.map((c) => {
    if (typeof c.width === 'number') {
      fixed += c.width;
      return 0;
    }
    const w = typeof c.width === 'string' && c.width.endsWith('*') ? parseFloat(c.width) || 1 : 1;
    // proportional-column-width(N)+長さ: 長さの分を先に除いてから、残りを係数で分ける (XSL §5.10.4)
    fixed += c.widthExtra ?? 0;
    stars += w;
    return w;
  });
  const rem = Math.max(avail - fixed, 0);
  return cols.map((c, k) => (typeof c.width === 'number' ? c.width : (c.widthExtra ?? 0) + (stars > 0 ? (rem * weights[k]) / stars : 0)));
}

// ───────────────────────── LNode → Area (物理化) ─────────────────────────

/** background-size の百分率を、背景の配置の領域 (W × H、padding box) の大きさで長さにする (CSS Backgrounds 3 §2.9) */
function percentImage<T extends BackgroundImage & { width: number; height: number }>(bi: T, W: number, H: number): T {
  if (bi.widthPct === undefined && bi.heightPct === undefined) return bi;
  const { widthPct: wp, heightPct: hp, pctAuto, aspect, ...rest } = bi;
  const ar = aspect && aspect > 0 ? aspect : 1;
  let w = wp !== undefined ? W * wp : bi.width;
  let h = hp !== undefined ? H * hp : bi.height;
  // 片方が auto: 画像の縦横比で決める
  if (pctAuto === 'height') h = w / ar;
  else if (pctAuto === 'width') w = h * ar;
  return { ...rest, width: Math.max(w, 0), height: Math.max(h, 0) } as T;
}

/** gradientImage で作ったグラデーションの背景の数 (増えていなければ registerGradients は木をたどらない) */
let gradientsMade = 0;
/** グラデーションの背景の画像の大きさ: background-size の指定 (cover・contain・auto は背景の領域の大きさ)。CSS Images 3 §3 の画像は本来の大きさを持たない */
function gradientImage(bi: BackgroundImage, W: number, H: number): BackgroundImage & { width: number; height: number } {
  gradientsMade++;
  // 大きさの指定の無いもの (0) は背景の領域の大きさ
  const w = bi.size || !(bi.width! > 0) ? W : bi.width!;
  const h = bi.size || !(bi.height! > 0) ? H : bi.height!;
  const { size: _s, ...rest } = bi;
  return { ...rest, width: Math.max(w, 0), height: Math.max(h, 0) };
}

/**
 * 箱の大きさが決まったところで、背景の画像 (と、後ろに重ねる画像) の大きさを決める: 百分率の大きさとグラデーションの大きさは、
 * 位置の基準の領域 (background-origin。無ければ padding の箱) の大きさに対して (CSS Backgrounds 3 §2.8・§2.9)
 */
function areaBackground(bi: NonNullable<LNode['bgImage']>, width: number, height: number, bw: Edges, pad: Edges): NonNullable<LNode['bgImage']> {
  const one = (l: BackgroundImage & { width: number; height: number }) => {
    const ex = l.origin === 'border-box' ? 0 : 1;
    const ey = l.origin === 'content-box' ? 1 : 0;
    const W = Math.max(width - ex * (bw.left + bw.right) - ey * (pad.left + pad.right), 0);
    const H = Math.max(height - ex * (bw.top + bw.bottom) - ey * (pad.top + pad.bottom), 0);
    return l.gradient ? gradientImage(l, W, H) : percentImage(l, W, H);
  };
  if (!bi.under) return one(bi);
  return { ...one(bi), under: bi.under.map((l) => one(l as BackgroundImage & { width: number; height: number })) };
}

function toGlyphArea(n: LNode, base: Omit<GlyphArea, 'type' | 'text' | 'fontFamily' | 'fontWeight' | 'fontSize' | 'color' | 'baselineX' | 'baselineY' | 'rotation' | 'scaleX' | 'advance'>): GlyphArea {
  const g = n.glyph!;
  return { ...base, type: 'glyph', ...g };
}

/** 箱の論理の辺 (罫線 + padding) の幅: block の前・後、inline の前・後 */
function logicalEdges(n: LNode) {
  const bw = borderWidths(n.border);
  const top = n.padding.top + bw.top;
  const bottom = n.padding.bottom + bw.bottom;
  const left = n.padding.left + bw.left;
  const right = n.padding.right + bw.right;
  if (n.wm === 'horizontal-tb') return { bs: top, be: bottom, is: left, ie: right };
  return n.wm === 'vertical-rl' ? { bs: right, be: left, is: top, ie: bottom } : { bs: left, be: right, is: top, ie: bottom };
}

/**
 * 書字方向の裏返し (XSL 1.1 §7.29.7 の bt-lr・lr-bt・lr-alternating-*・lr-inverting-* など。WritingFlip): 横・縦で組み終えた箱の木の、
 * 子の位置を、親の内容の箱の中で裏返す。
 *  - block: ブロック・行を積む向きを逆に (block 方向の位置を裏返す。行の中には入らない)
 *  - inline: 行の中の向きを逆に (inline 方向の位置を、行の中の字まで裏返す。字の形はそのまま)
 *  - alternate: 偶数行 (この参照領域の中の行を、木の順に数える) を、逆の向きに並べる (reverse) か、180 度回す (invert。逆さの字で右から左)
 * 書字方向を決め直した箱 (flipRoot)・書字方向の違う箱・回転した箱の中には入らない (その箱の位置だけ裏返す)
 */
export function applyFlip(root: LNode, f: import('./types').WritingFlip) {
  const inner = (c: LNode, n: LNode) => !c.flipRoot && c.wm === n.wm && !c.rot && !c.phys;
  const flipInline = (n: LNode) => {
    const e = logicalEdges(n);
    const ci = n.isize - e.is - e.ie;
    for (const c of n.children) {
      if (c.phys) continue;
      const bb = bboxOf(c);
      c.i = ci - c.i - (n.wm === 'horizontal-tb' ? bb.width : bb.height);
      if (inner(c, n) && c.kind !== 'glyph' && c.kind !== 'tcy' && c.kind !== 'image') flipInline(c);
    }
  };
  const flipBlock = (n: LNode) => {
    const e = logicalEdges(n);
    const cb = n.bsize - e.bs - e.be;
    for (const c of n.children) {
      if (c.phys) continue;
      const bb = bboxOf(c);
      c.b = cb - c.b - (n.wm === 'horizontal-tb' ? bb.height : bb.width);
      if (inner(c, n) && c.kind !== 'line' && c.kind !== 'inline' && c.kind !== 'glyph' && c.kind !== 'image') flipBlock(c);
    }
  };
  if (f.alternate) {
    let k = 0;
    const walk = (n: LNode) => {
      for (const c of n.children) {
        if (!inner(c, n)) continue;
        if (c.kind === 'line') {
          if (++k % 2 === 0) {
            if (f.alternate === 'invert') c.rot = 180;
            else flipInline(c);
          }
        } else if (c.kind !== 'glyph' && c.kind !== 'inline' && c.kind !== 'image') walk(c);
      }
    };
    walk(root);
  }
  if (f.inline) flipInline(root);
  if (f.block) flipBlock(root);
}

export function toArea(n: LNode, parentWm: WritingMode, PW: number): Area {
  const { width, height } = physSize(n.isize, n.bsize, n.wm);
  const rot = n.rot ?? 0;
  // 回転した箱の位置は外接矩形の左上。width / height は回転前の局所サイズのまま
  const pos = n.phys ?? physPos(parentWm, PW, n.i, n.b, rot === 90 || rot === 270 ? height : width);
  const bw = borderWidths(n.border);
  const contentPW = width - n.padding.left - n.padding.right - bw.left - bw.right;
  const base = {
    x: pos.x,
    y: pos.y,
    width,
    height,
    margin: n.margin,
    padding: n.padding,
    border: n.border,
    backgroundColor: n.bg,
    ...(n.bgImage ? { backgroundImage: areaBackground(n.bgImage, width, height, bw, n.padding) } : {}),
    ...(n.bgClip ? { backgroundClip: n.bgClip } : {}),
    writingMode: n.wm,
    sourceId: n.src,
    ...(n.ref !== undefined ? { sourceRef: n.ref } : {}),
    ...(rot ? { orientation: rot } : {}),
    ...(n.clip ? { clip: true } : {}),
    ...(n.float ? { float: true } : {}),
    ...(n.radius ? { borderRadius: n.radius } : {}),
    ...(n.diag ? { diagonals: n.diag } : {}),
    ...(n.shadow ? { boxShadow: n.shadow } : {}),
    // 描くときだけの効果の印 (組み終えたら applyPaintEffects が transform・opacity に直して消す)
    ...(n.fx ? { [PAINT_EFFECT_MARK]: n.fx } : {}),
    ...(n.fxRef !== undefined && paintEffectState.on ? { [PAINT_REF_MARK]: n.fxRef } : {}),
    ...(n.link ? { link: n.link } : {}),
    ...(n.annot ? { annotation: n.annot } : {}),
    ...(n.form ? { formField: n.form } : {}),
  };
  const kids = () => n.children.map((c) => toArea(c, n.wm, contentPW));
  switch (n.kind) {
    case 'glyph':
      return toGlyphArea(n, base);
    case 'ruby': {
      const g = kids() as GlyphArea[];
      const k = n.baseCount ?? 0;
      return { ...base, type: 'ruby', base: g.slice(0, k), ruby: g.slice(k), rubyExtent: n.rubyExtent ?? 0 };
    }
    case 'tcy':
      return { ...base, type: 'tate-chu-yoko', glyphs: kids() as GlyphArea[], scale: n.tcyScale ?? 1, frames: n.tcyFrames ?? 1 };
    case 'line':
      return { ...base, type: 'line', children: kids(), contentLength: n.contentLength ?? 0, hasRuby: !!n.hasRuby };
    case 'inline':
      return { ...base, type: 'inline', children: kids() } as InlineArea;
    case 'table':
      return { ...base, type: 'table', children: kids(), columnSizes: n.colSizes ?? [], isContinuation: !!n.cont };
    case 'row':
      return { ...base, type: 'table-row', children: kids(), isRepeatedHeader: !!n.repeated };
    case 'cell':
      return { ...base, type: 'table-cell', children: kids() };
    case 'image':
      return {
        ...base,
        type: 'image',
        src: n.image?.src ?? '',
        missing: n.image?.missing ?? true,
        alt: n.image?.alt,
        ...(n.image?.fit ? { fit: n.image.fit, naturalWidth: n.image.naturalWidth, naturalHeight: n.image.naturalHeight, ...(n.image.fitPosition ? { fitPosition: n.image.fitPosition } : {}) } : {}),
        ...(n.image?.stretch ? { stretch: true } : {}),
        ...(n.image?.hidden ? { hidden: true } : {}),
      };
    case 'region-body':
      return { ...base, type: 'region-body', children: kids() } as RegionBodyArea;
    default:
      return { ...base, type: 'block', children: kids(), isContinuation: !!n.cont, continuesOnNext: !!n.contNext } as BlockArea;
  }
}

// ───────────────────────── エンジン本体 ─────────────────────────

/** page-sequence が使いうる、条件付きのページマスター: 条件で選ぶもの (masterAlternatives) と、部分列 (masterSequence。XSL 1.1 §6.4.8) のもの */
function conditionalMasters(seq: LPageSequence): ConditionalPageMaster[] {
  return [...(seq.masterAlternatives ?? []), ...(seq.masterSequence ?? []).flatMap((it) => it.masters)];
}

/** page-sequence が使いうるページマスターのすべて (既定のものと、条件付きのもの)。段組・傍注を使うかは、このどれかが持つかで決める */
function sequenceMasters(seq: LPageSequence): PageMaster[] {
  return [seq.master, ...conditionalMasters(seq).map((a) => a.master)];
}

interface PageBuild {
  seq: LPageSequence;
  markers: PendingMarker[];
  /** このページで終わった、marker を持つ箱 (終わった順) */
  markerEnds?: object[];
  master: PageMaster;
  staticContent: LBlockContainer[];
  number: number;
  root: LNode;
  abs: LNode[];
  /** 行番号・改訂バーの箱を root に足したか (前回の組版のページを使い回すとき、2 度足さない) */
  lineMarked?: boolean;
}

  interface RunOpts {
    span: boolean;
    trial: boolean;
    /** この絶対ページ番号の段の高さを h に縮める (釣り合わせ) */
    lastLimit?: { abs: number; h: number };
    /** 前の群の末尾に残った余白 (先頭の space-before と相殺する) */
    carry?: number;
  }

/** 段組の 1 ページ (ページマスター) の寸法: 本文領域の inline 方向の寸法 rootI・block 方向の限界 limit・段の数 n・段間 gap・段の幅 colI */
interface ColumnGeo {
  alt: ConditionalPageMaster;
  m: PageMaster;
  brot: number;
  rootI: number;
  limit: number;
  n: number;
  gap: number;
  colI: number;
}

/**
 * 段組のページの、ページ単位の領域に置くもの: 前方 float と脚注。footEnds は foots と同じ並びで、その脚注の参照までの本文を
 * 段に収めるのに要る、本文領域の先頭からの高さ (脚注領域は、その下に置ける)
 */
interface ColumnPageItems {
  floats: FloatBox[];
  foots: FootEntry[];
  footEnds: number[];
}

/** 段組の 1 回の組版 (layoutColumnPass) の中で、群を組む runColumnGroup が使う文脈 */
interface ColumnPassCtx {
  seq: LPageSequence;
  host: FlowHost;
  firstNumber: number;
  /** ページごとの、本文領域の上 (前方 float) と下 (脚注) に空ける高さ */
  reserves: { top: Map<number, number>; bot: Map<number, number> };
  /** ページごとの、前方 float と脚注 */
  pageItems: Map<number, ColumnPageItems>;
  wm: WritingMode;
  flowSt: ResolvedStyle;
  foot: FootnoteCtx;
  beforeSep: () => FootEntry | undefined;
  /** 脚注をページ単位 (全段を貫いて) に置くか (footnotePosition が column でない) */
  pageMode: boolean;
  geoAt: (abs: number) => ColumnGeo;
  ensurePage: (abs: number) => PageBuild;
  sizeAt: (abs: number) => PageSizeInfo;
  /** 偶奇合わせの白ページにする (blank-or-not-blank="blank" のマスターを選ぶ。§6.4.12) */
  markBlank: (abs: number) => void;
}

/**
 * 前回の組版での page-sequence の結果。2 回目以降の組版 (ページ番号参照の収束) で、開始ページ・脚注の続き番号・
 * 中で参照したページ番号の値が前回と同じ sequence は、組み直さずに前回のページをそのまま使う (目次の sequence だけを組み直す)
 */
interface SeqMemo {
  first: number;
  fnCarryIn: number;
  /** 参照したページ番号: 引数 → 返した値と、字のスタイル (字だけ差し替えるときの計測に使う) */
  cites: Map<string, { args: [string, boolean | undefined, string | undefined, boolean | undefined]; value: string; style?: ResolvedStyle }>;
  built: PageBuild[];
  fnCarryOut: number;
  warnings: string[];
  /** この sequence で記録した id のページ (組み直さないときに同じ記録を入れる) */
  idPages: Array<[string, IdPages]>;
  idPageBuild: Array<[string, PageBuild]>;
  idPageBuildLast: Array<[string, PageBuild]>;
  /** この sequence で組んだ索引のページ番号の並び (組み直さないときは、いまのページで作り直しても同じ並びになることを確かめる) */
  indexLists?: Map<LIndexPageCitationList, IndexExpansion>;
}

/** 索引のページ番号の並び 1 つを、字と行内の箱に置き換えた結果 */
interface IndexExpansion {
  /** 並びの中身 (どのページを、どの書式・飛び先で並べたか)。同じなら、置き換えた結果も同じ */
  sig: string;
  nodes: InlineChild[];
  /** ページそのものを飛び先にするリンクの、ページの通し番号 (0 始まり) */
  pageDests: number[];
}

/** 索引が引くページの見え方: 鍵の付いた所の置かれたページ (通し番号。0 始まり) と、ページごとの番号の字・前後の字の番号 */
interface IndexView {
  span(e: LIndexEntry): { first: number; last: number } | undefined;
  page(n: number): { label: string; folioKey?: number } | undefined;
}

/** ページそのものを飛び先にするリンクの id (索引のページ番号のリンク。n は 1 始まりの通し番号) */
const indexPageDest = (n: number) => `kumiori-index-page-${n + 1}`;

const DEFAULT_TRIM_MARK_MARGIN_MM = 10;

export class LayoutEngine {
  private warnings: string[] = [];
  /** 直前の layout() で組んだ回数 (試し組み・計測も含む。ページ番号の参照などで組み直した分も足す) */
  readonly stats: LayoutStats = { flows: 0, blocks: 0, tables: 0 };

  constructor(
    private fonts: FontManager,
    private measurer: Measurer,
    private options: LayoutOptions = {},
  ) {}

  private baseStyle(): ResolvedStyle {
    const fam = this.options.defaultFontFamily ?? this.fonts.all()[0]?.family ?? 'sans-serif';
    // 可変フォントを読み込んでいれば、その軸の札 (子のスタイルの解決で、書体の名前に軸の値の指定を付ける。lnode.ts の applyVariation)
    const varAxes = this.fonts.variationAxes();
    return {
      fontFamily: fam,
      fontWeight: 400,
      italic: false,
      ...(varAxes ? { varAxes } : {}),
      fontSize: this.options.defaultFontSize ?? 10.5,
      lineHeight: this.options.defaultLineHeight ?? 1.7,
      color: '#000000',
      textAlign: 'justify',
      textIndent: 0,
      letterSpacing: 0,
      rubyScale: 0.5,
      hanging: true,
      orphans: 2,
      widows: 2,
      lineBreak: DEFAULT_LINE_BREAK,
      wm: 'horizontal-tb',
    };
  }

  /** page-number-citation の参照先 → ページ番号 (前回の組版結果)。無ければ仮の '00' を入れて組む */
  private citations: Map<string, IdPages> | undefined;
  private idPages = new Map<string, IdPages>();
  /** id が最初に置かれたページ (しおりの飛び先) */
  private idPageBuild = new Map<string, PageBuild>();
  /** id が最後に置かれたページ (物理的なページ番号の参照) */
  private idPageBuildLast = new Map<string, PageBuild>();
  /** 直前の組版の、文書のすべてのページ (順に) */
  private pagesBuilt: PageBuild[] = [];

  /** id を持つ要素が、番号 n (書式 fmt) のページに置かれたことを記録する。最初のページは初回だけ、最後のページは毎回更新 */
  private noteIdPage(id: string, n: number, fmt: string | undefined, page?: PageBuild) {
    if (page && !this.idPageBuild.has(id)) this.idPageBuild.set(id, page);
    if (page) this.idPageBuildLast.set(id, page);
    const label = formatPageNumber(n, fmt);
    const cur = this.idPages.get(id);
    if (!cur) this.idPages.set(id, { first: label, last: label, firstN: n, lastN: n });
    else {
      cur.last = label;
      cur.lastN = n;
    }
  }
  private citationUsed = false;

  // ── 索引 (XSL 1.1 §6.10)。ページ番号の参照と同じく、前回の組版のページで並びを作り、同じ並びになるまで組み直す ──
  /** 鍵 → 鍵の付いた所 (文書の中の順)。索引を使わない文書は undefined */
  private indexKeys?: Map<string, Array<{ e: LIndexEntry; order: number }>>;
  /** 前回の組版での見え方。1 回目の組版 (undefined) は、いま組んでいる途中のページから引く (索引より前に置いた所は、そのまま当たる) */
  private indexPrev?: IndexView;
  /** 今回の組版で置き換えた並び (同じ並びを 2 度置き換えない。組み直さない sequence の分も入れる) */
  private indexUsed = new Map<LIndexPageCitationList, IndexExpansion>();
  /** 置き換えの控え (行内の箱 → 中の並びを置き換えた写し。置き換えるものが無ければ元の箱) */
  private indexInline = new Map<object, InlineChild>();
  /** いま組んでいる sequence で置き換えた並び */
  private indexLog?: Map<LIndexPageCitationList, IndexExpansion>;
  /** いま組んでいる sequence の、最初のページの番号と、それより前のページの数 */
  private indexCur = { first: 1, base: 0 };
  /** ページ → 文書の先頭からの通し番号 (0 始まり。組み終えた sequence の分) */
  private pageOrdinal = new Map<PageBuild, number>();

  /** 索引の目印 (領域を作らない所) の id と、範囲の終わりの印の id */
  private indexPoints = new Map<string, 'point' | 'end'>();
  /** ページに記録するマーカーの並びから、索引の目印を取り出して id のページとして記録し、残り (本当のマーカー) を返す */
  private takeIndexPoints(list: PendingMarker[], note: (id: string) => void): PendingMarker[] {
    if (!this.indexPoints.size) return list;
    return list.filter((m) => {
      if (m.indexId === undefined) return true;
      note(m.indexId);
      return false;
    });
  }

  /** いま組んでいる途中のページから引く見え方 (1 回目の組版) */
  private indexLive(): IndexView {
    const ord = (pb: PageBuild | undefined): number | undefined => {
      if (!pb) return undefined;
      // 組み終えた sequence のページは通し番号。いま組んでいる sequence のページは、ページ番号から数える
      return this.pageOrdinal.get(pb) ?? this.indexCur.base + (pb.number - this.indexCur.first);
    };
    return {
      span: (e) => this.indexSpan(e, ord, () => this.pagesBuilt.length - 1),
      page: (n) => {
        const pb = this.pagesBuilt[n];
        if (pb) return { label: formatPageNumber(pb.number, pb.seq.pageNumberFormat), ...(pb.seq.folioKey !== undefined ? { folioKey: pb.seq.folioKey } : {}) };
        const seq = this.indexSeq;
        if (!seq || n < this.indexCur.base) return undefined;
        return { label: formatPageNumber(this.indexCur.first + (n - this.indexCur.base), seq.pageNumberFormat), ...(seq.folioKey !== undefined ? { folioKey: seq.folioKey } : {}) };
      },
    };
  }
  private indexSeq?: LPageSequence;

  /**
   * 鍵の付いた所の、領域のある最初と最後のページ (XSL 1.1 §6.10.6: “a cited page item is generated for each page whose descendants
   * include areas returned from that formatting object”。範囲は、始まりの印のページから終わりの印のページまで)。まだ置いていなければ undefined
   */
  private indexSpan(e: LIndexEntry, ord: (pb: PageBuild | undefined) => number | undefined, lastPage: () => number): { first: number; last: number } | undefined {
    const first = ord(this.idPageBuild.get(e.id));
    if (first === undefined) return undefined;
    let last = ord(this.idPageBuildLast.get(e.id)) ?? first;
    if (e.endId !== undefined) last = Math.max(last, ord(this.idPageBuildLast.get(e.endId)) ?? first);
    // 組になる fo:index-range-end の無い範囲は、文書の終わりまで (§6.10.4 の回復)
    else if (e.range) last = Math.max(last, lastPage());
    return { first, last: Math.max(first, last) };
  }

  /** 組み終えた組版の見え方を固める (次の組版・収束の判定で使う) */
  private indexSnapshot(): IndexView {
    const pages = this.pagesBuilt.map((pb) => ({ label: formatPageNumber(pb.number, pb.seq.pageNumberFormat), ...(pb.seq.folioKey !== undefined ? { folioKey: pb.seq.folioKey } : {}) }));
    const ord = (pb: PageBuild | undefined) => (pb ? this.pageOrdinal.get(pb) : undefined);
    const spans = new Map<LIndexEntry, { first: number; last: number }>();
    for (const list of this.indexKeys?.values() ?? [])
      for (const { e } of list) {
        const sp = this.indexSpan(e, ord, () => pages.length - 1);
        if (sp) spans.set(e, sp);
      }
    return { span: (e) => spans.get(e), page: (n) => pages[n] };
  }

  /**
   * 索引のページ番号の並び 1 つを作る (XSL 1.1 §6.10.7 の Step A〜C)。
   * Step C: 項目ごとに、前に付ける字 (fo:index-page-number-prefix)・ページ番号 (§6.6.10 の中身 = 引いたページを作った page-sequence の
   * fo:folio-prefix・番号・fo:folio-suffix)・後ろに付ける字 (fo:index-page-number-suffix) を、引いた fo:index-key-reference の書式で組む。
   * 前後の字は番号と同じ行に置く (keep-with-next.within-line・keep-with-previous.within-line が always)。範囲は、最初の項目・範囲の区切り
   * (既定は U+2013。前後で行を分けない)・最後の項目。項目・範囲の間に並びの区切り (既定はカンマと空白。カンマは前の項目と同じ行に置く)
   */
  private buildIndexList(list: LIndexPageCitationList, view: IndexView, warn?: (m: string) => void): IndexExpansion {
    const perRef = list.references.map((r, k) => {
      const entries = this.indexKeys?.get(r.refKey);
      // “It is an error if there are no such formatting objects. Implementations should recover from this error by ignoring the
      // fo:index-key-reference.” (§6.10.6)
      if (!entries) {
        warn?.(msg(`索引の鍵 "${r.refKey}" (ref-index-key) の付いた所がありません`, `no formatting object has the index key "${r.refKey}" (ref-index-key)`));
        return [];
      }
      const sources: IndexSource[] = [];
      for (const { e, order } of entries) {
        const sp = view.span(e);
        if (sp) sources.push({ cls: e.indexClass ?? '', first: sp.first, last: sp.last, range: !!e.range, order, id: e.id, ...(e.endId !== undefined ? { endId: e.endId } : {}) });
      }
      return citedPageItems(sources, k);
    });
    const outs = collateCitedPages(perRef, list);
    const pageDests: number[] = [];
    const sig: unknown[] = [];
    const item = (it: CitedPageItem): LInline => {
      const r = list.references[it.ref];
      const pg = view.page(it.page);
      const folio = pg?.folioKey !== undefined ? r.folios?.[pg.folioKey] : undefined;
      // リンク (page-number-treatment="link"。§7.24.3): 引いた所がこのページにあればその id、無ければページそのもの
      const target = r.link ? (it.target ?? indexPageDest(it.page)) : undefined;
      if (r.link && it.target === undefined) pageDests.push(it.page);
      sig.push([it.ref, pg?.label, pg?.folioKey, target]);
      const number: LInline = { type: 'inline', ...r.style, ...(target !== undefined ? { link: { internal: target } } : {}), children: [...(folio?.prefix ?? []), pg?.label ?? '?', ...(folio?.suffix ?? [])] };
      if (!r.prefix?.length && !r.suffix?.length) return number;
      const side = (kids: LInlineLevel[] | undefined): LInline[] => (kids?.length ? [{ type: 'inline', ...r.style, children: kids }] : []);
      return { type: 'inline', noBreak: true, children: [...side(r.prefix), number, ...side(r.suffix)] };
    };
    const nodes: InlineChild[] = [];
    outs.forEach((o, k) => {
      let unit: LInline = item(o.first);
      if (o.last) {
        sig.push('-');
        unit = { type: 'inline', noBreak: true, children: [unit, ...(list.rangeSeparator ? [{ type: 'inline', children: list.rangeSeparator } as LInline] : ['\u2013']), item(o.last)] };
      }
      if (k === outs.length - 1) nodes.push(unit);
      else if (list.listSeparator) nodes.push(unit, { type: 'inline', children: list.listSeparator });
      else nodes.push({ type: 'inline', noBreak: true, children: [unit, ','] }, ' ');
      sig.push(',');
    });
    return { sig: JSON.stringify(sig), nodes, pageDests };
  }

  /** 行内の並びの中の、索引のページ番号の並びを置き換える (FlowHost.index)。置き換えるものが無ければ、渡した配列をそのまま返す */
  private expandIndex(run: InlineChild[], warn: (m: string) => void): InlineChild[] {
    let out: InlineChild[] | undefined;
    for (let k = 0; k < run.length; k++) {
      const c = run[k];
      if (typeof c === 'string') {
        out?.push(c);
        continue;
      }
      if (c.type === 'index-page-citation-list') {
        let ex = this.indexUsed.get(c);
        if (!ex) {
          ex = this.buildIndexList(c, this.indexPrev ?? this.indexLive(), warn);
          this.indexUsed.set(c, ex);
        }
        this.indexLog?.set(c, ex);
        out ??= run.slice(0, k);
        out.push(...ex.nodes);
        continue;
      }
      let r: InlineChild = c;
      if (c.type === 'inline') {
        const kept = this.indexInline.get(c);
        if (kept !== undefined) r = kept;
        else {
          const kids = this.expandIndex(c.children as InlineChild[], warn);
          if (kids !== c.children) {
            r = { ...c, children: kids as LInlineLevel[] };
            copySourceRef(c, r);
          }
          this.indexInline.set(c, r);
        }
        // 控えから引いた写しの中の並びも、この sequence で使ったものとして数える
        if (r !== c && this.indexLog) this.logIndexLists(c);
      }
      if (r !== c) out ??= run.slice(0, k);
      out?.push(r);
    }
    return out ?? run;
  }
  private logIndexLists(c: LInline) {
    for (const ch of c.children) {
      if (typeof ch === 'string') continue;
      if (ch.type === 'index-page-citation-list') {
        const ex = this.indexUsed.get(ch);
        if (ex) this.indexLog!.set(ch, ex);
      } else if (ch.type === 'inline') this.logIndexLists(ch);
    }
  }

  /** 今回の組版で置き換えた並びが、組み終えたページで作り直しても同じか (索引の収束) */
  private indexSettled(view: IndexView): boolean {
    for (const [list, ex] of this.indexUsed) if (this.buildIndexList(list, view).sig !== ex.sig) return false;
    return true;
  }

  /** ページごとに振り直す脚注番号: 前回の組版でのページの中の順番 / 今回の組版で置いたページ */
  private fnOrder = new Map<LFootnote, number>();
  private fnPlaced = new Map<LFootnote, number>();
  private fnResetUsed = false;

  private seqKeys = new WeakMap<LPageSequence, number>();
  private seqKey(seq: LPageSequence): number {
    let k = this.seqKeys.get(seq);
    if (k === undefined) this.seqKeys.set(seq, (k = ++this.seqCount));
    return k;
  }
  private seqCount = 0;
  /** 前の page-sequence までに振った脚注の最後の番号 (continueNumbering)、いま組んでいる page-sequence の脚注 */
  private fnCarry = 0;
  private lastFoot?: FootnoteCtx;
  /** 前回の組版での page-sequence ごとの結果 (layoutPasses の中でだけ使う) */
  private seqMemo: Array<SeqMemo | undefined> = [];
  /** いま組んでいる sequence の中で参照したページ番号 (cite の引数 → 返した値) */
  private citeLog?: SeqMemo['cites'];

  /** page-number-citation の値 (前回の組版の結果から)。参照先が無ければ undefined */
  private citeValue(id: string, last?: boolean, format?: string, physical?: boolean): string | undefined {
    if (!this.citations) return '00';
    const n = this.citations.get(id);
    if (n === undefined) return undefined;
    if (physical) {
      const pn = last ? n.lastP : n.firstP;
      if (pn !== undefined) return formatPageNumber(pn, format ?? '1');
    }
    const num = last ? n.lastN : n.firstN;
    if (format !== undefined && num !== undefined) return formatPageNumber(num, format);
    return last ? n.last : n.first;
  }

  /**
   * 前回の sequence で参照したページ番号が、今回も同じ値か。違う参照があっても、字数と字ごとの送りが同じ (桁数が同じ数字など) なら、
   * 前回のページの字 (LNode.cite の印の付いた字形の節) だけを差し替えて同じとみなす。差し替えられなければ false (組み直す)
   */
  private reuseCites(memo: SeqMemo): boolean {
    const plan = new Map<string, { texts: string[]; value: string }>();
    for (const [key, c] of memo.cites) {
      const nv = this.citeValue(...c.args) ?? '?';
      if (nv === c.value) continue;
      const st = c.style;
      if (!st) return false;
      const oldCps = [...c.value];
      const newCps = [...nv];
      if (oldCps.length !== newCps.length) return false;
      const texts: string[] = [];
      for (let k = 0; k < oldCps.length; k++) {
        const og = this.measurer.glyph(oldCps[k], runStyleOf(st), st.wm);
        const ng = this.measurer.glyph(newCps[k], runStyleOf(st), st.wm);
        if (og.advance !== ng.advance || og.font !== ng.font || og.scaleX !== ng.scaleX || og.vertical?.mode !== ng.vertical?.mode || og.naturalWidth !== ng.naturalWidth) return false;
        texts.push(ng.vertical?.glyph ?? ng.draw ?? newCps[k]);
      }
      plan.set(key, { texts, value: nv });
    }
    if (!plan.size) return true;
    // 印の付いた字形の節を集め、参照ごとに字数の倍数だけあることを確かめてから差し替える (途中で止めない)
    const found = new Map<string, LNode[]>();
    const walk = (n: LNode) => {
      if (n.cite !== undefined && n.glyph && plan.has(n.cite)) {
        let a = found.get(n.cite);
        if (!a) found.set(n.cite, (a = []));
        a.push(n);
      }
      for (const ch of n.children) walk(ch);
    };
    for (const p of memo.built) {
      walk(p.root);
      for (const a of p.abs) walk(a);
    }
    for (const [key, { texts }] of plan) {
      const nodes = found.get(key) ?? [];
      if (!nodes.length || nodes.length % texts.length !== 0) return false;
    }
    for (const [key, { texts, value }] of plan) {
      found.get(key)!.forEach((n, k) => {
        n.glyph!.text = texts[k % texts.length];
      });
      memo.cites.get(key)!.value = value;
    }
    return true;
  }

  /** id のページの記録の写し (sequence の前後で比べて、その sequence で記録したものを取り出す) */
  private snapshotIds() {
    return { pages: new Map([...this.idPages].map(([k, v]) => [k, { ...v }] as [string, IdPages])), build: new Map(this.idPageBuild), last: new Map(this.idPageBuildLast) };
  }
  private idDiff(before: ReturnType<LayoutEngine['snapshotIds']>): Pick<SeqMemo, 'idPages' | 'idPageBuild' | 'idPageBuildLast'> {
    const same = (a: IdPages | undefined, b: IdPages) => !!a && a.first === b.first && a.last === b.last && a.firstN === b.firstN && a.lastN === b.lastN && a.firstP === b.firstP && a.lastP === b.lastP;
    return {
      idPages: [...this.idPages].filter(([k, v]) => !same(before.pages.get(k), v)).map(([k, v]) => [k, { ...v }] as [string, IdPages]),
      idPageBuild: [...this.idPageBuild].filter(([k, v]) => before.build.get(k) !== v),
      idPageBuildLast: [...this.idPageBuildLast].filter(([k, v]) => before.last.get(k) !== v),
    };
  }

  /** 今回の組版で置いた脚注の、ページの中の順番 */
  private footnoteOrder(): Map<LFootnote, number> {
    const count = new Map<number, number>();
    const out = new Map<LFootnote, number>();
    for (const [fn, page] of this.fnPlaced) {
      const k = count.get(page) ?? 0;
      out.set(fn, k);
      count.set(page, k + 1);
    }
    return out;
  }

  /**
   * 組版。ページ番号参照 (目次) やページごとの脚注番号があれば、参照先のページ番号・脚注の置き場所が収束するまで最大 4 回組み直す
   */
  /** ページの背景画像の大きさ (指定が無ければ画像本来の大きさ。画像が無ければ描かない) */
  /**
   * CSS のグラデーションの背景 (toArea で大きさを決めたもの) を SVG の画像にして、画像の置き場に登録する。
   * 同じグラデーション・同じ大きさは 1 つの画像にする
   */
  private registerGradients(sheets: AreaTree['sheets']) {
    // この組版でグラデーションの背景を作っていなければ、木をたどらない (字まで降りる走査は組版全体の 1〜2 割を占めていた)
    if (gradientsMade === this.gradientsSeen) return;
    this.gradientsSeen = gradientsMade;
    const assets = this.options.assets;
    const made = new Map<string, string>();
    // 背景画像を持つのは領域 (Area) と用紙 (SheetArea) だけなので、領域の木の節をたどる (childrenOf が page・regionBody・absoluteAreas・children などを知っている)
    const visit = (a: { backgroundImage?: BackgroundImage }) => {
      const bi = a.backgroundImage;
      // 後ろに重ねる画像 (複数の背景) のグラデーションも、同じように画像にする (作れなければ、その層を除く)
      if (bi?.under) {
        const under: BackgroundImage[] = [];
        for (const l of bi.under) {
          const h = { backgroundImage: l };
          visit(h);
          if (h.backgroundImage) under.push(h.backgroundImage);
        }
        bi.under = under;
        if (!under.length) delete bi.under;
      }
      if (bi?.gradient) {
        const w = bi.width ?? 0;
        const h = bi.height ?? 0;
        const key = `${bi.gradient}|${w.toFixed(3)}|${h.toFixed(3)}|${bi.gradientFontSize ?? 12}`;
        let src = made.get(key);
        if (src === undefined) {
          const svg = assets ? gradientSvg(bi.gradient, w, h, bi.gradientFontSize) : undefined;
          src = svg ? `kumiori-gradient-${made.size + 1}.svg` : '';
          if (svg) assets!.register(src, { mime: 'image/svg+xml', width: w / 0.75, height: h / 0.75, bytes: new TextEncoder().encode(svg) });
          made.set(key, src);
        }
        if (src) {
          const { gradient: _g, gradientFontSize: _f, ...rest } = bi;
          a.backgroundImage = { ...rest, src };
        } else if (bi.under?.length) {
          // いちばん手前のグラデーションが作れないとき: 後ろの層を手前に繰り上げる
          const [top, ...rest] = bi.under;
          a.backgroundImage = rest.length ? { ...top, under: rest } : top;
        } else delete a.backgroundImage;
      }
    };
    for (const s of sheets) walkAreas(s as unknown as AreaNode, (a) => visit(a as { backgroundImage?: BackgroundImage }));
  }
  /** 前回 registerGradients を呼んだときの gradientsMade */
  private gradientsSeen = 0;

  private sheetBackgroundImage(bi: BackgroundImage): { backgroundImage?: BackgroundImage & { width: number; height: number } } {
    const asset = this.options.assets?.get(bi.src);
    if (!asset) return {};
    const nw = asset.width * 0.75;
    const nh = asset.height * 0.75;
    const w = bi.width ?? (bi.height !== undefined ? (bi.height * nw) / nh : nw);
    const h = bi.height ?? (bi.width !== undefined ? (bi.width * nh) / nw : nh);
    return { backgroundImage: { ...bi, width: w, height: h } };
  }

  layout(doc: LDocument): AreaTree {
    this.stats.flows = this.stats.blocks = this.stats.tables = 0;
    const tree = this.layoutPasses(doc);
    // 使う書体・画像の一覧と、字の字形の番号を付ける (木だけで描くための情報)
    attachResources(tree, this.fonts, this.options.assets);
    return tree;
  }

  /** 描くときだけの効果 (transform・opacity) を持つ入力の節 (layoutPasses が集め、組み終えた Area に付ける) */
  private paintEffects: PaintEffectEntry[] | undefined;

  private layoutPasses(doc: LDocument): AreaTree {
    // 入力の節に通し番号を付ける (Area の sourceRef)
    // 描くときだけの効果 (transform・opacity) を持つ節 (無い文書では undefined。組んだ後で Area に付ける)
    this.paintEffects = collectPaintEffects(indexDocument(doc));
    paintEffectState.on = !!this.paintEffects;
    this.seqMemo = [];
    this.citations = undefined;
    this.citationUsed = false;
    this.fnOrder = new Map();
    this.fnResetUsed = false;
    // 索引 (XSL 1.1 §6.10): 鍵の付いた所を、鍵ごとに引けるようにする。索引を使わない文書では何もしない
    this.indexPrev = undefined;
    this.indexKeys = undefined;
    this.indexPoints = new Map();
    if (doc.indexEntries) {
      this.indexKeys = new Map();
      doc.indexEntries.forEach((e, order) => {
        if (e.point) this.indexPoints.set(e.id, 'point');
        if (e.endId !== undefined) this.indexPoints.set(e.endId, 'end');
        const a = this.indexKeys!.get(e.key);
        if (a) a.push({ e, order });
        else this.indexKeys!.set(e.key, [{ e, order }]);
      });
    }
    let tree = this.layoutOnce(doc);
    let indexView: IndexView | undefined;
    // 索引の並びが、組み終えたページで作り直しても同じなら、索引は収束している (索引の無い文書は、いつも true)
    const indexDone = () => !this.indexUsed.size || this.indexSettled((indexView = this.indexSnapshot()));
    for (let pass = 0; pass < 4 && (this.citationUsed || this.fnResetUsed || this.indexUsed.size); pass++) {
      const next = this.idPages;
      // 物理的なページ番号: 置かれたページの、文書の中での順番
      const index = new Map(this.pagesBuilt.map((pb, i) => [pb, i + 1]));
      for (const [id, v] of next) {
        const f = this.idPageBuild.get(id);
        const l = this.idPageBuildLast.get(id);
        if (f) v.firstP = index.get(f);
        if (l) v.lastP = index.get(l);
      }
      next.set(TOTAL_PAGES_ID, { first: String(tree.sheets.length), last: String(tree.sheets.length), firstN: tree.sheets.length, lastN: tree.sheets.length, firstP: tree.sheets.length, lastP: tree.sheets.length });
      const sameCite =
        !this.citationUsed ||
        (this.citations && next.size === this.citations.size && [...next].every(([k, v]) => { const c = this.citations!.get(k); return c?.first === v.first && c?.last === v.last && c?.firstP === v.firstP && c?.lastP === v.lastP; }));
      const order = this.footnoteOrder();
      const sameFoot = !this.fnResetUsed || (order.size === this.fnOrder.size && [...order].every(([k, v]) => this.fnOrder.get(k) === v));
      const sameIndex = indexDone();
      if (sameCite && sameFoot && sameIndex) return tree;
      this.citations = next;
      this.fnOrder = order;
      if (indexView) this.indexPrev = indexView;
      tree = this.layoutOnce(doc);
    }
    // 索引のページ番号の並びが伸びてページが増え、引くページがまた変わる、を繰り返して決まらないときは、上限の回数で止めて知らせる
    if (!indexDone()) tree.warnings.push(msg('索引のページ番号の並びが収束しませんでした (索引が伸びてページが増え、引くページが変わるなど)', 'the index page number lists did not converge (e.g. the index grew, adding pages and changing the cited pages)'));
    if (this.citationUsed || this.fnResetUsed) tree.warnings.push(msg('ページ番号参照・ページごとの脚注番号が収束しませんでした (目次の桁数が変わるなど)', 'page number references / per-page footnote numbers did not converge (e.g. the number of digits in a table of contents changed)'));
    return tree;
  }

  private layoutOnce(doc: LDocument): AreaTree {
    this.warnings = [];
    this.fnCarry = 0;
    this.fnPlaced = new Map();
    this.idPages = new Map();
    this.idPageBuild = new Map();
    this.idPageBuildLast = new Map();
    this.indexUsed = new Map();
    this.indexInline = new Map();
    this.pageOrdinal = new Map();
    const volatile: NonNullable<FlowHost['volatile']> = { n: 0, active: 0, cites: [] };
    const host: FlowHost = {
      ...(this.options.measureMemo === false ? {} : { measureMemo: new WeakMap() }),
      volatile,
      ...(doc.spaceResolution === 'xsl' ? { xslSpace: true } : {}),
      assets: this.options.assets,
      hyphenate: this.options.hyphenate,
      ...(this.options.kernAh ? { kernAh: true } : {}),
      warn: (m) => this.warnings.push(m),
      ...(this.indexKeys ? { index: (run: InlineChild[]) => this.expandIndex(run, (m) => this.warnings.push(m)) } : {}),
      ...(this.indexPoints.size ? { indexPoint: (id: string) => this.indexPoints.get(id) } : {}),
      measurer: this.measurer,
      cellMeasure: new WeakMap(),
      stats: this.stats,
      cite: (id, last, format, physical, style, pageNumber) => {
        this.citationUsed = true;
        let v: string | undefined;
        if (!this.citations) {
          // 1 回目の組版: 置き済みの参照先 (後ろから前への参照) はそのページ番号。まだ置いていない参照先は、いまのページ番号を仮の値にする
          // (参照先のページ番号と桁数が同じになりやすく、2 回目に字だけ差し替えて済む)
          const n = !last && !physical ? this.idPages.get(id) : undefined;
          v = n ? (format !== undefined && n.firstN !== undefined ? formatPageNumber(n.firstN, format) : n.first) : formatPageNumber(Math.max(1, pageNumber ?? 1), format ?? '1');
        } else {
          v = this.citeValue(id, last, format, physical);
          if (v === undefined) {
            this.warnings.push(msg(`ページ番号参照の対象 id="${id}" が見つかりません`, `target id="${id}" of a page number reference was not found`));
            v = '?';
          }
        }
        this.citeLog?.set(JSON.stringify([id, last, format, physical]), { args: [id, last, format, physical], value: v, style });
        // 覚える計測の途中なら、引いた参照と値を記録する (Flow.memoMeasure が、覚えを使い回す前に引き直して確かめる)
        if (volatile.active > 0) volatile.cites.push({ args: [id, last, format, physical, style], value: v });
        return v;
      },
    };
    const docStyle = resolveStyle(this.baseStyle(), doc);
    const pages: PageBuild[] = [];
    this.pagesBuilt = pages;
    let pageNo = 1;

    doc.sequences.forEach((seq, si) => {
      // initial-page-number (§7.27.7): auto-odd / auto-even は、続きの番号の偶奇が合わなければ 1 足す
      const ipn = seq.initialPageNumber;
      const first =
        typeof ipn === 'number' ? ipn : ipn === 'auto-odd' ? (pageNo % 2 === 1 ? pageNo : pageNo + 1) : ipn === 'auto-even' ? (pageNo % 2 === 0 ? pageNo : pageNo + 1) : pageNo;
      // 前回の組版と同じ条件 (開始ページ・脚注の続き番号・参照したページ番号の値) なら、前回のページをそのまま使う。
      // ページごとに脚注番号を振り直す文書は、脚注の置き場所が前回の結果に依るので使い回さない
      const memo = this.seqMemo[si];
      // 索引の並びを持つ sequence は、いまのページで作り直しても同じ並びになるときだけ使い回す (索引の無い sequence は、いつも同じ)
      const sameIndexLists = (m: SeqMemo) => !m.indexLists?.size || (!!this.indexPrev && [...m.indexLists].every(([list, ex]) => (this.indexUsed.get(list) ?? this.buildIndexList(list, this.indexPrev!)).sig === ex.sig));
      if (memo && !this.fnResetUsed && memo.first === first && memo.fnCarryIn === this.fnCarry && sameIndexLists(memo) && this.reuseCites(memo)) {
        if (this.indexKeys) memo.built.forEach((pb, k) => this.pageOrdinal.set(pb, pages.length + k));
        for (const [list, ex] of memo.indexLists ?? []) this.indexUsed.set(list, ex);
        pages.push(...memo.built);
        for (const [k, v] of memo.idPages) this.idPages.set(k, { ...v });
        for (const [k, v] of memo.idPageBuild) this.idPageBuild.set(k, v);
        for (const [k, v] of memo.idPageBuildLast) this.idPageBuildLast.set(k, v);
        this.warnings.push(...memo.warnings);
        if (memo.cites.size) this.citationUsed = true;
        pageNo = first + memo.built.length;
        this.fnCarry = memo.fnCarryOut;
        this.lastFoot = undefined;
        return;
      }
      const fnCarryIn = this.fnCarry;
      const warnStart = this.warnings.length;
      const idsBefore = this.snapshotIds();
      this.citeLog = new Map();
      if (this.indexKeys) {
        this.indexLog = new Map();
        this.indexCur = { first, base: pages.length };
        this.indexSeq = seq;
      }
      const nextIpn = doc.sequences[si + 1]?.initialPageNumber;
      // 本文 (flow) の置かれたページの数 (force-page-count で末尾に足す白ページを含まない)
      let flowPages = 0;
      const layoutSequence = (s: LPageSequence, d: ResolvedStyle, h: FlowHost, f: number, li: number | null) => {
        const body = this.layoutSequence(s, d, h, f, li);
        flowPages = body.length;
        return this.forcePageCount(body, s, d, f, li, nextIpn);
      };
      const conds = conditionalMasters(seq);
      // rest も、最後のページかどうかで決まる (§7.27.14: 最初でも最後でもないページ)
      const needsLast = conds.some((a) => a.when.pagePosition === 'last' || a.when.pagePosition === 'only' || a.when.pagePosition === 'rest');
      // 'last' / 'only' は総ページ数が分からないと決まらない。仮に組み → 総数で確定 → 再度組み、を収束するまで (最大 3 回) 繰り返す。
      let lastIndex: number | null = null;
      const mark = this.warnings.length;
      // 組み直す前に、捨てる組版で記録した id のページを消す (残すと、しおり・リンクの飛び先が捨てたページを指す)
      const idKeys = new Set(this.idPages.keys());
      const forgetIds = () => {
        for (const k of this.idPages.keys()) if (!idKeys.has(k)) this.idPages.delete(k);
        for (const k of this.idPageBuild.keys()) if (!idKeys.has(k)) this.idPageBuild.delete(k);
      };
      let built = layoutSequence(seq, docStyle, host, first, lastIndex);
      if (needsLast) {
        for (let k = 0; k < 3 && built.length !== lastIndex; k++) {
          lastIndex = built.length;
          this.warnings.length = mark;
          forgetIds();
          built = layoutSequence(seq, docStyle, host, first, lastIndex);
          if (built.length === lastIndex) break;
          if (k === 2) this.warnings.push(msg('最終ページ用ページマスターの適用でページ数が収束しませんでした', 'the page count did not converge while applying the last-page page master'));
        }
      }
      // page-sequence・flow の id (XSL 1.1 §7.30.8) を引くページ番号の参照 (§6.6.11・§6.6.12): page-sequence の id は、
      // その page-sequence の作った最初と最後のページ (「全 N ページ」の page-number-citation-last)。flow の id は、本文の置かれた最初と最後のページ
      const noteSpan = (id: string | undefined, count: number) => {
        if (!id || count <= 0) return;
        for (const pb of [built[0], built[count - 1]]) this.noteIdPage(id, pb.number, seq.pageNumberFormat, pb);
      };
      noteSpan(seq.id, built.length);
      noteSpan(seq.flow.id, Math.min(flowPages, built.length));
      if (this.indexKeys) built.forEach((pb, k) => this.pageOrdinal.set(pb, pages.length + k));
      pages.push(...built);
      pageNo = first + built.length;
      this.fnCarry = this.lastFoot?.lastNumber ?? this.fnCarry;
      this.lastFoot = undefined;
      this.seqMemo[si] = { first, fnCarryIn, cites: this.citeLog, built, fnCarryOut: this.fnCarry, warnings: this.warnings.slice(warnStart), ...this.idDiff(idsBefore), ...(this.indexLog?.size ? { indexLists: this.indexLog } : {}) };
      this.citeLog = undefined;
      this.indexLog = undefined;
      this.indexSeq = undefined;
    });

    const total = pages.length;
    this.lineCount.clear();
    const sheets: SheetArea[] = pages.map((p, i) => this.buildSheet(p, total, host, docStyle, pages, i));
    // しおりの飛び先 (id) を、シートの番号に解決する
    const resolve = (bs: LBookmark[] | undefined): BookmarkArea[] =>
      (bs ?? []).map((b) => {
        const pb = this.idPageBuild.get(b.ref);
        if (!pb && b.ref) this.warnings.push(msg(`しおりの飛び先 id="${b.ref}" が見つかりません`, `bookmark destination id="${b.ref}" was not found`));
        // 文書の外への飛び先 (fo:bookmark の external-destination。XSL 1.1 §6.11.2・§7.23.6) は、文書の中の飛び先 (ref) が無いときだけ通す
        return { title: b.title, sheet: pb ? pages.indexOf(pb) : -1, ...(!b.ref && b.href ? { external: b.href } : {}), open: b.open ?? true, children: resolve(b.children) };
      });
    // 文書内リンクの飛び先: id → シートの番号
    const pageIndex = new Map(pages.map((p, k) => [p, k]));
    const destinations: Record<string, number> = {};
    for (const [id, pb] of this.idPageBuild) {
      const k = pageIndex.get(pb);
      if (k !== undefined) destinations[id] = k;
    }
    // 索引のページ番号のリンクのうち、ページそのものを飛び先にするもの (範囲の途中のページ・ページをまたぐ所の 2 ページ目から)
    for (const ex of this.indexUsed.values()) for (const n of ex.pageDests) if (n < pages.length) destinations[indexPageDest(n)] = n;
    this.registerGradients(sheets);
    if (this.paintEffects) applyPaintEffects(sheets, this.paintEffects);
    return {
      schemaVersion: AREA_TREE_SCHEMA_VERSION,
      title: doc.title ?? doc.info?.title,
      info: doc.info,
      ...(doc.bookmarks?.length ? { bookmarks: resolve(doc.bookmarks) } : {}),
      destinations,
      sheets,
      // 同じ警告 (同じ画像を何度も置いたときなど) は 1 つにまとめる
      warnings: [...new Set(this.warnings)],
    };
  }

  /**
   * force-page-count (§7.27.6): ページ数の偶奇・最後のページの偶奇が合うまで、末尾に白ページを足す。
   * auto (既定) は、次の page-sequence の initial-page-number が数値のときだけ、それに続くよう最後のページの偶奇を合わせる
   */
  private forcePageCount(built: PageBuild[], seq: LPageSequence, docStyle: ResolvedStyle, first: number, lastIndex: number | null, nextIpn: LPageSequence['initialPageNumber']): PageBuild[] {
    const mode = seq.forcePageCount ?? 'auto';
    // 数値 (アンテナハウスの拡張): そのページ数になるまで白ページを足す
    if (typeof mode === 'number') {
      while (built.length < Math.min(mode, 10000)) built.push(this.blankPage(seq, docStyle, built.length + 1, first + built.length, lastIndex));
      return built;
    }
    const ok = (count: number) => {
      const last = first + count - 1;
      switch (mode) {
        case 'even': return count % 2 === 0;
        case 'odd': return count % 2 === 1;
        case 'end-on-even': return last % 2 === 0;
        case 'end-on-odd': return last % 2 === 1;
        // auto (§7.27.6): 次の page-sequence の initial-page-number が偶数なら最後を奇数ページに、奇数なら偶数ページにする。
        // auto-odd (次は奇数から) なら最後を偶数ページに、auto-even なら奇数ページにする (§7.27.7)。auto・次が無いときは強制しない
        case 'auto':
          if (typeof nextIpn === 'number') return (last % 2 === 1) === (nextIpn % 2 === 0);
          if (nextIpn === 'auto-odd') return last % 2 === 0;
          if (nextIpn === 'auto-even') return last % 2 === 1;
          return true;
        default: return true;
      }
    };
    for (let guard = 0; !ok(built.length) && guard < 2; guard++) built.push(this.blankPage(seq, docStyle, built.length + 1, first + built.length, lastIndex));
    return built;
  }

  /** 本文の無いページ (白ページ)。静的コンテンツ (ヘッダー・ページ番号) は通常どおり付く */
  private blankPage(seq: LPageSequence, docStyle: ResolvedStyle, index: number, number: number, lastIndex: number | null): PageBuild {
    const wm = resolveStyle(resolveStyle(docStyle, seq), seq.flow).wm;
    const alt = this.selectMaster(seq, index, number, lastIndex, true, true);
    const m = alt.master;
    const rw = mm(m.width) - mm(m.margins.left) - mm(m.margins.right);
    const rh = mm(m.height) - mm(m.margins.top) - mm(m.margins.bottom);
    const brot = m.bodyRotation ?? 0;
    const [lw, lh] = brot === 90 || brot === 270 ? [rh, rw] : [rw, rh];
    const root = newNode('region-body', wm, { isize: wm === 'horizontal-tb' ? lw : lh, bsize: wm === 'horizontal-tb' ? lh : lw, ...(brot ? { rot: brot } : {}) });
    return { seq, number, root, abs: [], markers: [], master: m, staticContent: alt.staticContent ?? seq.staticContent ?? [] };
  }

  /** 条件付きページマスターを評価する (位置は 1 始まり) */
  private selectMaster(seq: LPageSequence, index: number, pageNumber: number, lastIndex: number | null, blank = false, trailing = false): ConditionalPageMaster {
    // rest は最初でも最後でもないページ (§7.27.14)。最後のページに当てはまるマスターが無ければ (first・rest だけの指定など)、
    // 最後のページを rest として選び直す (仕様では誤り。以前と同じ選び方に戻す)
    if (lastIndex !== null && index === lastIndex) {
      const r = this.selectMasterAt(seq, index, pageNumber, lastIndex, blank, trailing);
      if (r) return r;
      return this.selectMasterAt(seq, index, pageNumber, null, blank, trailing) ?? { when: {}, master: seq.master };
    }
    return this.selectMasterAt(seq, index, pageNumber, lastIndex, blank, trailing) ?? { when: {}, master: seq.master };
  }

  /** 当てはまるマスター。当てはまるものが無ければ undefined */
  private selectMasterAt(seq: LPageSequence, index: number, pageNumber: number, lastIndex: number | null, blank: boolean, trailing: boolean): ConditionalPageMaster | undefined {
    const pos = (c: PageMasterCondition) => {
      const want = c.pagePosition ?? 'any';
      const isFirst = index === 1;
      const isLast = lastIndex !== null && index === lastIndex;
      switch (want) {
        case 'first': return isFirst;
        case 'last': return isLast;
        case 'only': return isFirst && isLast;
        case 'rest': return !isFirst && !isLast;
        default: return true;
      }
    };
    const ok = (c: PageMasterCondition) => {
      const oe = c.oddOrEven ?? 'any';
      const parityOk = oe === 'any' || (oe === 'odd') === (pageNumber % 2 === 1);
      const bn = c.blankOrNotBlank ?? 'any';
      const blankOk = (bn === 'any' || (bn === 'blank') === blank) && (!c.trailingBlank || (blank && trailing));
      return pos(c) && parityOk && blankOk;
    };
    // page-sequence-master の部分列: 先頭から順に、それぞれの最大ページ数ぶん使う (§6.4.8)
    if (seq.masterSequence?.length) {
      let rest = index;
      let last: PageMasterSequenceItem | undefined;
      for (const item of seq.masterSequence) {
        last = item;
        const count = item.kind === 'single' ? 1 : (item.maxRepeats ?? Infinity);
        if (rest <= count) break;
        rest -= count;
        last = undefined;
      }
      // 部分列を使い切ったら (仕様ではエラー)、最後の部分列を使い続ける
      const use = last ?? seq.masterSequence[seq.masterSequence.length - 1];
      if (use.kind !== 'alternatives') return use.masters[0] ?? { when: {}, master: seq.master };
      const hit = use.masters.find((c: ConditionalPageMaster) => ok(c.when));
      if (hit) return hit;
      return lastIndex !== null && index === lastIndex ? undefined : (use.masters[0] ?? { when: {}, master: seq.master });
    }
    for (const alt of seq.masterAlternatives ?? []) if (ok(alt.when)) return alt;
    return lastIndex !== null && index === lastIndex ? undefined : { when: {}, master: seq.master };
  }

  /**
   * 段組 (PageMaster.columns) を使う page-sequence の組版。
   * 本文を「段組のグループ」と「全段を貫くブロック (span="all")」に分け、グループごとに Flow を 1 つ使う。
   * Flow から見ると「段」が「ページ」に当たり、段が埋まる = 次の段 (最後の段なら次のページ) への改ページ。
   * span="all" の直前のグループは、最後のページの段の高さを二分探索で縮めながら試し組みして、段を釣り合わせる。
   */
  private layoutColumnSequence(seq: LPageSequence, docStyle: ResolvedStyle, host: FlowHost, firstNumber: number, lastIndex: number | null): PageBuild[] {
    // 脚注・前方 float はページ全体 (全段を貫く) の領域に置く。その高さは組んでみないと分からないので、
    // 領域の高さ (ページごとの予約) を増やしながら、安定するまで (最大 6 回) 組み直す。
    const reserves = { top: new Map<number, number>(), bot: new Map<number, number>() };
    let out = this.layoutColumnPass(seq, docStyle, host, firstNumber, lastIndex, reserves);
    for (let pass = 1; pass < 6; pass++) {
      let changed = false;
      for (const [abs, h] of out.needs) {
        if (h.top > (reserves.top.get(abs) ?? 0) + 0.01) {
          reserves.top.set(abs, h.top);
          changed = true;
        }
        if (h.bot > (reserves.bot.get(abs) ?? 0) + 0.01) {
          reserves.bot.set(abs, h.bot);
          changed = true;
        }
      }
      if (!changed) break;
      this.warnings.length = out.mark;
      for (const k of this.idPages.keys()) if (!out.idKeys.has(k)) this.idPages.delete(k);
      for (const k of this.idPageBuild.keys()) if (!out.idKeys.has(k)) this.idPageBuild.delete(k);
      out = this.layoutColumnPass(seq, docStyle, host, firstNumber, lastIndex, reserves);
    }
    return out.pages;
  }

  /**
   * 段組の 1 回の組版 (layoutColumnPass) の、群 (span の切り替えで分けた本文の並び) の組版。items を startAbs ページの startTop から組み、
   * 最後のページ番号 (lastAbs)・そのページの使用量 (ページ先頭から。lastUsed)・末尾に残った余白 (trailing) を返す。
   * 段 (または span の全幅) ごとに箱を作って Flow に渡し、Flow の nextPage で次の段・次のページへ進む。o.trial なら試し組み (ページに何も残さない)
   */
  private runColumnGroup(cx: ColumnPassCtx, items: Array<LBlockLevel | LInlineLevel>, startAbs: number, startTop: number, o: RunOpts) {
    const { seq, host, firstNumber, reserves, pageItems, wm, flowSt, foot, beforeSep, pageMode, geoAt, ensurePage, sizeAt } = cx;
    // 絶対配置の箱の基準 (§7.6.1) は、いまの群の領域 (span の切り替わりで分かれた参照領域) の先頭
    const H: FlowHost = { ...host, ...(o.trial ? { warn: () => {} } : {}), pageNumber: () => firstNumber + abs, areaOrigin: () => top };
    /** XSL の余白 (§4.3.1): 群 (span の切り替わりで分けた参照領域) の境で、余白の並びを断つ */
    const xslAreas = !!seq.discardLeadingSpace;
    let abs = startAbs;
    let col = 0;
    let top = Math.max(startTop, reserves.top.get(startAbs) ?? 0);
    const itemsAt = (a: number) => {
      let v = pageItems.get(a);
      if (!v) pageItems.set(a, (v = { floats: [], foots: [], footEnds: [] }));
      return v;
    };
    const usedOn = new Map<number, number>();
    /** いまの段の高さ (脚注の参照までの本文の量を数える) */
    let colLimit = 0;
    const colRoot = () => {
      const g = geoAt(abs);
      let limit = g.limit - top - (reserves.bot.get(abs) ?? 0);
      if (o.lastLimit && o.lastLimit.abs === abs) limit = Math.min(limit, o.lastLimit.h);
      colLimit = limit;
      const single = o.span || g.n === 1;
      const node = newNode('block', wm, { i: single ? 0 : col * (g.colI + g.gap), b: top, isize: single ? g.rootI : g.colI, bsize: limit });
      if (!single) node.colIndex = col;
      if (!o.trial) {
        ensurePage(abs).root.children.push(node);
        // 段罫: 2 段目以降の段を作るとき、前の段との間 (段間の中央) に段の高さぶんの線を引く
        const rule = g.m.columns?.rule;
        if (!single && col > 0 && rule && rule.width > 0) {
          const ruleNode = newNode('block', wm, { i: col * (g.colI + g.gap) - g.gap / 2 - rule.width / 2, b: top, isize: rule.width, bsize: limit, border: {} });
          if (rule.style && rule.style !== 'solid') {
            // 線種は罫線として描く (inline 方向の start 辺)
            ruleNode.isize = rule.width;
            ruleNode.border = wm === 'horizontal-tb' ? { left: rule } : { top: rule };
          } else ruleNode.bg = rule.color;
          ensurePage(abs).root.children.push(ruleNode);
        }
      }
      return { root: node, limit, rootI: node.isize };
    };
    const first = colRoot();
    // 段組の先頭のブロックが space-before を残す指定なら、続く段の頭も同じ量だけ下げて、段の頭をそろえる
    const firstBlock = o.span ? undefined : items.find((c): c is LBlock => typeof c !== 'string' && c.type === 'block');
    const topGap = firstBlock?.retainSpaceBefore ? describeBox(firstBlock, wm).m.bs : 0;
    const flow = new Flow(H, {
      wm,
      footnotes: foot,
      beforeSep,
      // ページの先頭から始まる段組の本文は、先頭の余白を捨てる (段組でない本文と同じ)
      // XSL: span の切り替わりで始まる群は、新しい参照領域 (§6.4.14 の span-reference-area) の先頭なので、ページの途中でも先頭の余白を捨てる
      // (§4.3.1: 参照領域の先頭の conditional な余白は捨てる。retain の余白は残る)
      discardLeading: xslAreas,
      discardAfterForced: xslAreas,
      // XSL でない本文: span の切り替えでは、群の終わりの余白を、次の群の先頭の余白と相殺する (大きい方)。
      // XSL では相殺しない (参照領域の境は余白の並びを断つ。§4.2.5): 前の群の終わりの余白は、retain の分だけが使った高さに入っている
      initialSpace: xslAreas ? 0 : (o.carry ?? 0),
      areaEnd: xslAreas,
      rootI: first.rootI,
      root: first.root,
      limit: first.limit,
      pages: {
        addMarkers: (list) => {
          if (!o.trial) ensurePage(abs).markers.push(...this.takeIndexPoints(list, (id) => this.noteIdPage(id, firstNumber + abs, seq.pageNumberFormat, ensurePage(abs))));
        },
        markerEnd: (key) => {
          if (!o.trial) (ensurePage(abs).markerEnds ??= []).push(key);
        },
        noteId: (id) => {
          if (!o.trial) this.noteIdPage(id, firstNumber + abs, seq.pageNumberFormat, ensurePage(abs));
        },
        columnEnd: (used) => usedOn.set(abs, Math.max(usedOn.get(abs) ?? 0, top + used)),
        atPageStart: () => col === 0 && top <= (reserves.top.get(abs) ?? 0) + EPS,
        columnIndex: () => col,
        nextPage: (level) => {
          const n = o.span ? 1 : geoAt(abs).n;
          if (level !== 'page' && level !== 'blank' && col + 1 < n) col++;
          else {
            abs++;
            col = 0;
            top = reserves.top.get(abs) ?? 0;
            // 偶奇合わせの白ページに入る
            if (level === 'blank' && !o.trial) cx.markBlank(abs);
          }
          return { ...colRoot(), ...(col > 0 && abs === startAbs && topGap > 0 ? { gap: topGap } : {}), ...(col > 0 && abs === startAbs && o.carry && !xslAreas ? { credit: o.carry } : {}) };
        },
      },
      pageLevel: pageMode
        ? {
            pageRootI: () => geoAt(abs).rootI,
            addFootnote: (e, at) => {
              if (o.trial) return;
              const it = itemsAt(abs);
              it.foots.push(e);
              // 参照までの本文 (前の段の全部と、この段の at まで) を、このページの段に分けて収めるのに要る高さ。
              // 行は分けられないので、1 行の高さの余裕を足す (段組でなければ、参照する行の終わりまで)
              const n = o.span ? 1 : geoAt(abs).n;
              it.footEnds.push(top + (n === 1 ? at : (col * Math.max(colLimit, 0) + at) / n + lineHeightOf(flowSt)));
            },
            addBeforeFloat: (f) => {
              if (!o.trial) itemsAt(abs).floats.push(f);
            },
          }
        : undefined,
      abs: () => (o.trial ? [] : ensurePage(abs).abs),
      pageSize: () => sizeAt(abs),
    });
    const go = () => {
      flow.layoutChildren(items, flowSt);
      flow.finishPaginated();
    };
    // 試し組みは、脚注を積み済みにしない (表のセル・コンテナの中の脚注を、本番の組版で積めるように)
    if (o.trial) foot.trial(go);
    else go();
    return { lastAbs: abs, lastUsed: usedOn.get(abs) ?? top, trailing: flow.trailingSpace };
  }

  private layoutColumnPass(
    seq: LPageSequence,
    docStyle: ResolvedStyle,
    host: FlowHost,
    firstNumber: number,
    lastIndex: number | null,
    reserves: { top: Map<number, number>; bot: Map<number, number> },
  ) {
    const mark = this.warnings.length;
    const idKeys = new Set(this.idPages.keys());
    const needs = new Map<number, { top: number; bot: number }>();
    const pageItems = new Map<number, ColumnPageItems>();
    const pages: PageBuild[] = [];
    const flowSt = resolveStyle(resolveStyle(docStyle, seq), seq.flow);
    const wm = flowSt.wm;
    /** 偶奇合わせで挟んだ白ページ (段組の並びでも、白ページの条件 blank-or-not-blank="blank" のマスターを選ぶ) */
    const blankAbs = new Set<number>();
    const geoAt = (abs: number) => {
      const alt = this.selectMaster(seq, abs + 1, firstNumber + abs, lastIndex, blankAbs.has(abs));
      const m = alt.master;
      const rw = mm(m.width) - mm(m.margins.left) - mm(m.margins.right);
      const rh = mm(m.height) - mm(m.margins.top) - mm(m.margins.bottom);
      const brot = m.bodyRotation ?? 0;
      const [lw, lh] = brot === 90 || brot === 270 ? [rh, rw] : [rw, rh];
      const rootI = wm === 'horizontal-tb' ? lw : lh;
      const limit = wm === 'horizontal-tb' ? lh : lw;
      const n = Math.max(1, Math.floor(m.columns?.count ?? 1));
      const gap = n > 1 ? (m.columns?.gap !== undefined ? mm(m.columns.gap) : 12) : 0;
      return { alt, m, brot, rootI, limit, n, gap, colI: (rootI - gap * (n - 1)) / n };
    };
    const ensurePage = (abs: number): PageBuild => {
      while (pages.length <= abs) {
        const g = geoAt(pages.length);
        const root = newNode('region-body', wm, { isize: g.rootI, bsize: g.limit, ...(g.brot ? { rot: g.brot } : {}) });
        pages.push({ seq, number: firstNumber + pages.length, root, abs: [], markers: [], master: g.m, staticContent: g.alt.staticContent ?? seq.staticContent ?? [] });
      }
      return pages[abs];
    };
    const sizeAt = (abs: number): PageSizeInfo => {
      const g = geoAt(abs);
      const h = wm === 'horizontal-tb';
      return { width: mm(g.m.width), height: mm(g.m.height), body: { width: h ? g.rootI : g.limit, height: h ? g.limit : g.rootI } };
    };
    /** abs のページを白ページにする。もう作ってあれば、マスターを選び直す */
    const markBlank = (abs: number) => {
      blankAbs.add(abs);
      const pg = pages[abs];
      if (pg) {
        const g = geoAt(abs);
        pg.master = g.m;
        pg.staticContent = g.alt.staticContent ?? seq.staticContent ?? [];
      }
    };
    const g0 = geoAt(0);
    const pageMode = (g0.m.columns?.footnotePosition ?? 'page') !== 'column';
    const fw = pageMode ? g0.rootI : g0.colI;
    const fo = seq.footnotes ?? {};
    const footSt = resolveStyle(flowSt, { textAlign: 'start', textIndent: 0, ...fo.style, fontSize: fo.style?.fontSize ?? flowSt.fontSize * 0.8 });
    // 脚注本体の幅は、参照する行のあるページ (段) の脚注領域の幅 (省略時は最初のページの幅)
    const foot = new FootnoteCtx(fo.continueNumbering ? { ...fo, startNumber: this.fnCarry + 1 } : fo, (fn: LFootnote, label: string, width = fw) => {
      const sub = new Flow(host, { wm, rootI: width, abs: () => [], pageSize: () => sizeAt(0), measure: true });
      const { type: _t, children, label: _l, bodyLabel, ...style } = fn;
      void _t;
      void _l;
      sub.layoutBlock({ type: 'block', ...style, ...footInset(fo, wm), ...(bodyLabel === false ? { children } : footBody(fo, label, children, (style as { fontSize?: number }).fontSize ?? footSt.fontSize, wm)) }, footSt);
      const { height, after } = sub.finishWithTrailing();
      return { node: newNode('block', wm, { isize: width, bsize: height, children: sub.root.children }), height, ...(after > 0 ? { after } : {}) };
    }, (children) => {
      const sub = new Flow(host, { wm, rootI: fw, abs: () => [], pageSize: () => sizeAt(0), measure: true });
      sub.layoutChildren(children, flowSt);
      const height = sub.finishAtomic();
      return { node: newNode('block', wm, { isize: fw, bsize: height, children: sub.root.children }), height };
    });
    this.lastFoot = foot;
    if (fo.reset === 'page') {
      this.fnResetUsed = true;
      foot.pageOrder = this.fnOrder;
      const seqKey = this.seqKey(seq);
      foot.onPlaced = (fn, page) => this.fnPlaced.set(fn, seqKey * 1e6 + page); // ページ番号は page-sequence ごとに重なりうる
    }
    let beforeSepEntry: FootEntry | undefined;
    const beforeSep = () => {
      if (!seq.beforeFloatSeparator?.length) return undefined;
      return (beforeSepEntry ??= foot.layoutBlocksPublic(seq.beforeFloatSeparator));
    };

    const cx: ColumnPassCtx = { seq, host, firstNumber, reserves, pageItems, wm, flowSt, foot, beforeSep, pageMode, geoAt, ensurePage, sizeAt, markBlank };
    /** items を abs ページの top から組み、最後のページ番号とその使用量 (ページ先頭から) を返す */
    const run = (items: Array<LBlockLevel | LInlineLevel>, startAbs: number, startTop: number, o: RunOpts) => this.runColumnGroup(cx, items, startAbs, startTop, o);

    const groups: Array<{ span: boolean; items: Array<LBlockLevel | LInlineLevel> }> = [];
    for (const c of seq.flow.children) {
      const sp = typeof c !== 'string' && c.type === 'block' && c.span === 'all';
      const last = groups[groups.length - 1];
      // XSL: 続く span="all" のブロックは、同じ参照領域 (span-reference-area) に入る (§6.4.14)。間の余白は、ふつうに相殺する
      if (sp && last?.span && seq.discardLeadingSpace) last.items.push(c);
      else if (sp) groups.push({ span: true, items: [c] });
      else if (last && !last.span) last.items.push(c);
      else groups.push({ span: false, items: [c] });
    }
    ensurePage(0);
    let abs = 0;
    let top = 0;
    let forceNew: BreakKind | null = null;
    let carry = 0;
    groups.forEach((g, gi) => {
      const blocks = g.items.filter((c): c is LBlock => typeof c !== 'string' && c.type === 'block');
      // グループの先頭での強制改ページ (段の先頭なので column は不要)。odd-page / even-page は偶奇が合うまで白ページを挟む
      const before = blocks[0] === g.items[0] ? blocks[0]?.breakBefore : undefined;
      const kind = forceNew && forceNew !== 'column' ? forceNew : before && before !== 'column' ? before : null;
      forceNew = null;
      if (kind) {
        carry = 0;
        if (top > (reserves.top.get(abs) ?? 0) + EPS) abs++;
        if ((kind === 'odd-page' || kind === 'even-page') && ((firstNumber + abs) % 2 === 1) !== (kind === 'odd-page')) markBlank(abs++);
        top = reserves.top.get(abs) ?? 0;
      }
      const opt: RunOpts = { span: g.span, trial: false, carry };
      // span の直前と、(column-fill="balance" なら) フローの末尾のグループの最後のページの段を釣り合わせる
      const balanceEnd = gi === groups.length - 1 && geoAt(abs).m.columns?.fill === 'balance';
      // span のグループが改ページで始まる (または、このグループが改ページで終わる) なら、span は次のページに置くので、
      // このページの段は釣り合わせない
      const pageBreak = (k: BreakKind | undefined | null) => !!k && k !== 'column';
      const nextG = groups[gi + 1];
      const nextFirst = nextG?.items[0];
      const lastItem = g.items[g.items.length - 1];
      const breaksBeforeSpan =
        (typeof nextFirst !== 'string' && nextFirst?.type === 'block' && pageBreak(nextFirst.breakBefore)) ||
        (typeof lastItem !== 'string' && lastItem?.type === 'block' && pageBreak(lastItem.breakAfter));
      if (!g.span && ((nextG?.span && !breaksBeforeSpan) || balanceEnd) && geoAt(abs).n > 1) {
        const t0 = run(g.items, abs, top, { span: false, trial: true, carry });
        const A = t0.lastAbs;
        if (geoAt(A).n > 1) {
          let lo = 0;
          let hi = geoAt(A).limit - (reserves.bot.get(A) ?? 0) - (A === abs ? top : reserves.top.get(A) ?? 0);
          for (let k = 0; k < 14 && hi - lo > 0.1; k++) {
            const mid = (lo + hi) / 2;
            if (run(g.items, abs, top, { span: false, trial: true, carry, lastLimit: { abs: A, h: mid } }).lastAbs === A) hi = mid;
            else lo = mid;
          }
          opt.lastLimit = { abs: A, h: hi };
        }
      }
      const r = run(g.items, abs, top, opt);
      abs = r.lastAbs;
      top = r.lastUsed;
      carry = r.trailing;
      if (blocks[blocks.length - 1] === g.items[g.items.length - 1]) forceNew = blocks[blocks.length - 1]?.breakAfter ?? null;
    });
    // ページ単位の領域: 前方 float は本文領域の上端、脚注は下端に、全段を貫いて置く。必要な高さは呼び出し側へ返す。
    // 本文領域に収まらない脚注は、行の単位で分けて、残りを次のページの脚注領域の先頭へ続ける (XSL 1.1 §6.12.3: 脚注の 2 つ目からの
    // 領域は、続くページに、ほかの内容より先に置く。1 段のページの Flow.pushFootnote と同じ決まり)
    const queue = [...pageItems.keys()].sort((x, y) => x - y);
    const contentPages = pages.length;
    /** 前のページから続く脚注 (分けた残りと、その後ろの脚注) */
    let carried: FootEntry[] = [];
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi];
      const it = pageItems.get(a) ?? { floats: [], foots: [], footEnds: [] };
      const pg = ensurePage(a);
      const g = geoAt(a);
      let y = 0;
      for (const f of it.floats) {
        f.box.i = f.m.is + Math.max(g.rootI - f.outerI, 0) / 2;
        f.box.b = y + f.m.bs;
        pg.root.children.push(f.box);
        y += f.outerB;
      }
      let topH = y;
      if (it.floats.length) {
        const sep = beforeSep();
        if (sep) {
          pg.root.children.push({ ...structuredClone(sep.node), i: 0, b: y });
          topH += sep.height;
        }
      }
      let botH = 0;
      // 偶奇合わせの白ページには、続きを置かない (1 段のページと同じ)
      const conts = blankAbs.has(a) ? [] : carried.splice(0);
      if (it.foots.length || conts.length) {
        let b = 0;
        const placed: FootEntry[] = [];
        const put = (e: FootEntry) => {
          b += foot.gapAfter(placed[placed.length - 1]);
          e.node.i = 0;
          e.node.b = b;
          placed.push(e);
          b += e.height;
        };
        /** e を、脚注領域の高さが budget を超えない所で分けて置き、残りを次のページへ送る。分けられなければ false */
        const splitPut = (e: FootEntry, budget: number): boolean => {
          const sp = splitEntry(e, budget - b - foot.gapAfter(placed[placed.length - 1]));
          if (!sp) return false;
          put(sp.head);
          carried.push(sp.rest);
          return true;
        };
        /** このページの本文領域で、脚注領域に使える高さ (前方 float の下から) */
        const room = g.limit - topH;
        const over = (e: FootEntry, cap: number) => b + foot.gapAfter(placed[placed.length - 1]) + e.height > cap + EPS;
        // 前のページからの続き: 脚注領域の先頭に置く。本文領域の 6 割まで (1 段のページと同じ上限)
        for (const e of conts) {
          if (carried.length) carried.push(e);
          else if (!over(e, Math.min(room, g.limit * 0.6)) || !splitPut(e, Math.min(room, g.limit * 0.6))) put(e);
        }
        it.foots.forEach((e, k) => {
          // 前の脚注を分けて送ったら、後ろの脚注も順に次のページへ送る (脚注の順を保つ。§6.12.4)
          if (carried.length) carried.push(e);
          // 本文領域に収まらないときだけ分ける。分ける位置は、参照までの本文を段に収めた残り (もう空けてある高さがあれば、そこまで)
          else if (!over(e, room) || !splitPut(e, Math.min(room, Math.max(g.limit - it.footEnds[k], reserves.bot.get(a) ?? 0)))) {
            if (over(e, room)) host.warn('脚注がページに収まらないため溢れます');
            put(e);
          }
        });
        const area = newNode('block', wm, { isize: g.rootI, bsize: 0, i: 0, b: 0 });
        const sepNode = foot.makeSeparator(wm, g.rootI);
        if (sepNode) area.children.push(sepNode);
        for (const e of placed) area.children.push(e.node);
        botH = b;
        area.bsize = b;
        area.b = g.limit - b;
        pg.root.children.push(area);
      }
      needs.set(a, { top: topH, bot: botH });
      // 続きが残っていて、次のページに脚注・前方 float が無ければ、次のページも見る (本文の終わりより後ろなら、脚注だけのページを足す)
      if (carried.length && queue[qi + 1] !== a + 1) {
        if (a + 1 >= contentPages + 50) {
          host.warn('脚注・float の続きが 50 ページを超えるため、残りを置きません');
          carried = [];
        } else queue.splice(qi + 1, 0, a + 1);
      }
    }
    return { pages, needs, mark, idKeys };
  }

  private layoutSequence(seq: LPageSequence, docStyle: ResolvedStyle, host: FlowHost, firstNumber: number, lastIndex: number | null): PageBuild[] {
    if (sequenceMasters(seq).some((m) => (m.columns?.count ?? 1) > 1)) {
      return this.layoutColumnSequence(seq, docStyle, host, firstNumber, lastIndex);
    }
    const pages: PageBuild[] = [];
    const flowSt = resolveStyle(resolveStyle(docStyle, seq), seq.flow);
    const wm = flowSt.wm;
    const mkPage = (blank = false) => {
      const index = pages.length + 1;
      const number = firstNumber + pages.length;
      const alt = this.selectMaster(seq, index, number, lastIndex, blank);
      const m = alt.master;
      const W = mm(m.width);
      const H = mm(m.height);
      const rw = W - mm(m.margins.left) - mm(m.margins.right);
      const rh = H - mm(m.margins.top) - mm(m.margins.bottom);
      // 本文領域を回転する (reference-orientation=90/270) ときは、回転前の局所寸法 (縦横を入れ替えた寸法) で組む
      const brot = m.bodyRotation ?? 0;
      const [lw, lh] = brot === 90 || brot === 270 ? [rh, rw] : [rw, rh];
      const rootI = wm === 'horizontal-tb' ? lw : lh;
      const limit = wm === 'horizontal-tb' ? lh : lw;
      const root = newNode('region-body', wm, { isize: rootI, bsize: limit, ...(brot ? { rot: brot } : {}) });
      const p: PageBuild = { seq, number, root, abs: [], markers: [], master: m, staticContent: alt.staticContent ?? seq.staticContent ?? [] };
      pages.push(p);
      return { p, rootI, limit };
    };
    const firstPage = mkPage();
    let cur = firstPage.p;
    const pageSize = (): PageSizeInfo => {
      const r = cur.root;
      const h = wm === 'horizontal-tb';
      return { width: mm(cur.master.width), height: mm(cur.master.height), body: { width: h ? r.isize : r.bsize, height: h ? r.bsize : r.isize } };
    };
    // 脚注本体: 脚注用スタイル (既定は本文の 0.8 倍・左/上揃え) で、本文領域の inline サイズいっぱいに組む
    const fo = seq.footnotes ?? {};
    const footSt = resolveStyle(flowSt, { textAlign: 'start', textIndent: 0, ...fo.style, fontSize: fo.style?.fontSize ?? flowSt.fontSize * 0.8 });
    // 脚注本体の幅は、参照する行のあるページの本文領域の幅 (幅の違うページマスターへ続いた段落の脚注は、そのページの幅で組む)
    const foot = new FootnoteCtx(fo.continueNumbering ? { ...fo, startNumber: this.fnCarry + 1 } : fo, (fn: LFootnote, label: string, width = firstPage.rootI) => {
      const sub = new Flow(host, { wm, rootI: width, abs: () => [], pageSize, measure: true });
      const { type: _t, children, label: _l, bodyLabel, ...style } = fn;
      void _t;
      void _l;
      sub.layoutBlock({ type: 'block', ...style, ...footInset(fo, wm), ...(bodyLabel === false ? { children } : footBody(fo, label, children, (style as { fontSize?: number }).fontSize ?? footSt.fontSize, wm)) }, footSt);
      const { height, after } = sub.finishWithTrailing();
      return { node: newNode('block', wm, { isize: width, bsize: height, children: sub.root.children }), height, ...(after > 0 ? { after } : {}) };
    }, (children) => {
      const sub = new Flow(host, { wm, rootI: firstPage.rootI, abs: () => [], pageSize, measure: true });
      sub.layoutChildren(children, flowSt);
      const height = sub.finishAtomic();
      return { node: newNode('block', wm, { isize: firstPage.rootI, bsize: height, children: sub.root.children }), height };
    });
    this.lastFoot = foot;
    if (fo.reset === 'page') {
      this.fnResetUsed = true;
      foot.pageOrder = this.fnOrder;
      const seqKey = this.seqKey(seq);
      foot.onPlaced = (fn, page) => this.fnPlaced.set(fn, seqKey * 1e6 + page); // ページ番号は page-sequence ごとに重なりうる
    }
    let beforeSepEntry: FootEntry | undefined;
    const beforeSep = () => {
      if (!seq.beforeFloatSeparator?.length) return undefined;
      return (beforeSepEntry ??= foot.layoutBlocksPublic(seq.beforeFloatSeparator));
    };
    // 傍注 (axf:footnote-position="outside"): 奇数ページは end、偶数ページは start の領域に、その幅で組んで置く
    const sideNotes = sequenceMasters(seq).some((m) => m.sideNotes)
      ? {
          area: () => {
            const sn = cur.master.sideNotes;
            const r = sn && (cur.number % 2 === 1 ? sn.end : sn.start);
            return r ? { i: mm(r.x), width: mm(r.width) } : undefined;
          },
          layout: (fn: LFootnote, width: number): FootEntry => {
            const sub = new Flow(host, { wm, rootI: width, abs: () => [], pageSize, measure: true });
            const label = foot.label(fn);
            const { type: _t, children: raw, label: _l, bodyLabel, ...style } = fn;
            void _t;
            void _l;
            const children = withLabel(raw, label) as LFootnote['children'];
            sub.layoutBlock({ type: 'block', ...style, ...footInset(fo, wm), ...(bodyLabel === false ? { children } : footBody(fo, label, children, (style as { fontSize?: number }).fontSize ?? footSt.fontSize, wm)) }, footSt);
            const height = sub.finishWithTrailing().height;
            return { node: newNode('block', wm, { isize: width, bsize: height, children: sub.root.children }), height };
          },
        }
      : undefined;
    const flow: Flow = new Flow({ ...host, pageNumber: () => cur.number, ...(seq.spanAreas ? { areaOrigin: () => flow.areaTop } : {}) }, {
      wm,
      footnotes: foot,
      ...(sideNotes ? { sideNotes } : {}),
      beforeSep,
      discardLeading: !!seq.discardLeadingSpace,
      ...(seq.spanAreas ? { spanAreas: true } : {}),
      rootI: firstPage.rootI,
      root: cur.root,
      limit: firstPage.limit,
      pages: {
        addMarkers: (list) => cur.markers.push(...this.takeIndexPoints(list, (id) => this.noteIdPage(id, cur.number, seq.pageNumberFormat, cur))),
        markerEnd: (key) => (cur.markerEnds ??= []).push(key),
        noteId: (id) => {
          this.noteIdPage(id, cur.number, seq.pageNumberFormat, cur);
        },
        nextPage: (level) => {
          const n = mkPage(level === 'blank');
          cur = n.p;
          return { root: n.p.root, limit: n.limit, rootI: n.rootI };
        },
      },
      abs: () => cur.abs,
      pageSize,
    });
    flow.layoutChildren(seq.flow.children, flowSt);
    flow.finishPaginated();
    return pages;
  }

  /** 行番号の数 (page-sequence ごと。reset="none" のときページをまたいで続ける) */
  private lineCount = new Map<LPageSequence, number>();

  /**
   * 行番号 (axf:line-number) と改訂バー (axf:revision-bar-*)。ページの本文の行を順にたどって数え、番号の箱・バーを本文の段の外側に置く。
   * 論理座標で置くので、縦書きでも同じ (番号は段の inline 方向の前 / 後ろ)。
   */
  private addLineMarks(p: PageBuild, sst: ResolvedStyle, host: FlowHost) {
    // 前回の組版のページを使い回すとき、箱を 2 度足さない (行番号の続きの数も前回のまま)
    if (p.lineMarked) return;
    p.lineMarked = true;
    const wm = p.root.wm;
    interface Col {
      k: number;
      i: number;
      isize: number;
    }
    const hits: Array<{ line: LNode; b: number; col: Col }> = [];
    // リーダーの格子 (leader-alignment) の基準: ref は、いちばん近い参照領域 (本文の領域・段・表のセル) の内容の始めの端
    const pageEdge = wm === 'horizontal-tb' ? mm(p.master.margins.left) : mm(p.master.margins.top);
    const rtlPage = sst.direction === 'rtl';
    const walk = (n: LNode, oi: number, ob: number, col: Col, ref: number) => {
      if (n.rot || n.wm !== wm) return; // 回転・書字方向の違う箱の中は数えない
      const bi = oi + n.i;
      const bb = ob + n.b;
      const c = n.colIndex !== undefined ? { k: n.colIndex, i: bi, isize: n.isize } : col;
      if (n.kind === 'line') {
        if (n.lnum || n.revs) hits.push({ line: n, b: bb, col: c });
        if (n.hasLeaderGrid && !rtlPage) regridLeaders(n, bi, ref, pageEdge);
        return;
      }
      const pl = toLogical(n.padding, n.wm);
      const bl = borderToLogicalWidths(n.border, n.wm);
      const r = n.colIndex !== undefined ? bi : n.kind === 'cell' ? bi + pl.is + bl.is : ref;
      for (const ch of n.children) walk(ch, bi + pl.is + bl.is, bb + pl.bs + bl.bs, c, r);
    };
    for (const ch of p.root.children) walk(ch, 0, 0, { k: 0, i: 0, isize: p.root.isize }, 0);
    // 改訂バー: 同じ指定が続く行 (段落の間の空きを含む) は 1 本につなげ、行の block 方向の長さいっぱいに引く
    const runs: Array<{ rb: RevisionBar; col: Col; b0: number; b1: number; last: number }> = [];
    hits.forEach((h, k) => {
      for (const rb of h.line.revs ?? []) {
        const r = runs.find((x) => x.rb === rb && x.last === k - 1 && x.col.k === h.col.k);
        if (r && rb.changeBar) {
          // 変更バー: 隣り合うセルの行 (前の行より上に戻る) も含めて、いちばん上からいちばん下まで
          r.b0 = Math.min(r.b0, h.b);
          r.b1 = Math.max(r.b1, h.b + h.line.bsize);
          r.last = k;
        } else if (r) {
          r.b1 = h.b + h.line.bsize;
          r.last = k;
        } else runs.push({ rb, col: h.col, b0: h.b, b1: h.b + h.line.bsize, last: k });
      }
    });
    for (const { rb, col, b0, b1 } of runs) {
      const w = rb.width ?? 1;
      // 段の端からバーまでの間隔 (既定 0。指定が無ければ、バーは段の端に接する)
      const off = rb.offset ?? 0;
      const pos = rb.position ?? 'start';
      const sides = rb.changeBar
        ? [changeBarSide(pos, { wm, rtl: sst.direction === 'rtl', odd: p.number % 2 === 1, col: col.k, columns: p.master.columns?.count ?? 1 })]
        : pos === 'both' ? ['start', 'end'] : pos === 'alternate' ? [col.k % 2 === 0 ? 'start' : 'end'] : [pos];
      for (const side of sides) {
        const bar = newNode('block', wm, {
          // 変更バーは、段の端から offset だけ離れた所がバーの中心 (XSL 1.1 §7.30.3)
          i: rb.changeBar ? (side === 'start' ? col.i - off - w / 2 : col.i + col.isize + off - w / 2) : side === 'start' ? col.i - off - w : col.i + col.isize + off,
          b: b0,
          isize: w,
          bsize: b1 - b0,
          border: { [wm === 'horizontal-tb' ? 'left' : 'top']: { width: w, color: rb.color, style: rb.style } },
        });
        p.root.children.push(bar);
      }
    }
    const numbered = hits.filter((h) => h.line.lnum);
    if (!numbered.length) return;
    // 振り方は行の指定 (page-sequence・flow からの継承を含む) による。数え直しの単位と初期値は、ページの最初の行のもの
    const first = { ...sst.lineNumber, ...numbered[0].line.lnum };
    const reset = first.reset ?? 'page';
    const initial = first.initial ?? 1;
    let n = reset === 'none' ? (this.lineCount.get(p.seq) ?? initial) : initial;
    let prevCol = numbered[0].col.k;
    for (const h of numbered) {
      if (reset === 'column' && h.col.k !== prevCol) n = initial;
      prevCol = h.col.k;
      const num = n++;
      const ls = h.line.lnum!;
      const interval = Math.max(1, ls.interval ?? 1);
      const start = ls.start ?? initial;
      if (ls.mode !== 'show' || num < start || (num - start) % interval !== 0) continue;
      const st = resolveStyle(sst, { fontFamily: ls.fontFamily, fontWeight: ls.fontWeight, fontStyle: ls.fontStyle, color: ls.color, fontSize: ls.fontSize });
      const fs = st.fontSize;
      const text = formatPageNumber(num, ls.format ?? '1');
      // 番号は欧文として組む。縦書きでは、本文の欧文と同じく時計回りに 90° 寝かせて、行頭の先に行の中央をそろえて置く
      const vert = wm !== 'horizontal-tb';
      const gs = host.measurer.glyphs(text, { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: fs }, vert ? wm : 'horizontal-tb');
      const total = gs.reduce((a, g) => a + g.advance, 0);
      // 段の端から番号までの間隔 (既定 0)
      const offset = ls.offset ?? 0;
      const pos = ls.position ?? 'start';
      const side = pos === 'alternate' ? (h.col.k % 2 === 0 ? 'start' : 'end') : pos;
      // 横書きは基線を行の基線に、縦書きは字面の中央を行の中央にそろえる
      const above = vert ? fs / 2 : (gs[0]?.font.baselineRatio ?? DEFAULT_BASELINE_RATIO) * fs;
      const gwm = vert ? wm : 'horizontal-tb';
      const box = newNode('block', gwm, {
        i: side === 'start' ? h.col.i - offset - total : h.col.i + h.col.isize + offset,
        b: h.b + (h.line.baseline ?? 0) - above,
        isize: total,
        bsize: fs,
      });
      let x = 0;
      for (const g of gs) {
        const gn = glyphNode(g, st, gwm, g.ch, fs, st.color);
        gn.i = x;
        x += g.advance;
        box.children.push(gn);
      }
      p.root.children.push(box);
    }
    this.lineCount.set(p.seq, n);
  }

  private buildSheet(p: PageBuild, total: number, host: FlowHost, docStyle: ResolvedStyle, allPages: PageBuild[], index: number): SheetArea {
    const m: PageMaster = p.master;
    const W = mm(m.width);
    const H = mm(m.height);
    const bleed = mm(m.bleed);
    const marks = m.trimMarks;
    const markMargin = marks ? mm(m.trimMarkMargin ?? DEFAULT_TRIM_MARK_MARGIN_MM) : 0;
    // 辺ごとのトンボ領域 (axf:crop-offset の上下左右が違うとき)
    const mms = marks && m.trimMarkMargins ? { top: mm(m.trimMarkMargins.top), right: mm(m.trimMarkMargins.right), bottom: mm(m.trimMarkMargins.bottom), left: mm(m.trimMarkMargins.left) } : undefined;
    const ex = mms ? { top: bleed + mms.top, right: bleed + mms.right, bottom: bleed + mms.bottom, left: bleed + mms.left } : { top: bleed + markMargin, right: bleed + markMargin, bottom: bleed + markMargin, left: bleed + markMargin };
    const sst = resolveStyle(resolveStyle(docStyle, p.seq), p.seq.flow);
    const wm = sst.wm;

    // 全ページ共通の絶対配置 (ヘッダー等) — ページ番号を差し替えてレイアウト
    const staticNodes: LNode[] = [];
    for (const c of p.staticContent) {
      const sub = new Flow({ ...host, pageNumber: () => p.number }, { wm, rootI: W, abs: () => staticNodes, pageSize: () => ({ width: W, height: H }) });
      // マーカーを展開してからページ番号を差し替える (マーカーの中身のページ番号 (HTML の running() の中の counter(page)) も差し替える)
      const sc = substitute(resolveMarkers(c, allPages, index), { pageNumber: formatPageNumber(p.number, p.seq.pageNumberFormat), totalPages: String(total) });
      const forced: LBlockContainer = { ...sc, absolutePosition: true };
      sub.layoutBlockLevel(forced, resolveStyle(docStyle, p.seq));
    }

    const rx = mm(m.margins.left);
    const ry = mm(m.margins.top);
    const regionW = W - rx - mm(m.margins.right);
    const regionH = H - ry - mm(m.margins.bottom);
    this.addLineMarks(p, sst, host);
    // 本文の書字方向の裏返し (bt-lr・lr-bt など)。ページを組み直しに使い回しても、1 度だけ当てる
    if (p.seq.writingFlip && !flipped.has(p.root)) {
      flipped.add(p.root);
      applyFlip(p.root, p.seq.writingFlip);
    }
    const regionBody = toArea(p.root, wm, regionW) as RegionBodyArea;
    regionBody.x = rx;
    regionBody.y = ry;
    if (!p.root.rot) {
      regionBody.width = regionW;
      regionBody.height = regionH;
    }

    const absAll = [...p.abs, ...staticNodes];
    const absoluteAreas = absAll.filter((n) => !n.behind).map((n) => toArea(n, 'horizontal-tb', W) as BlockArea);
    // 背面の箱: ページ余白の箱 (z-index が負のノンブルなど) を、本文の背面の箱 (章扉の絵など) より下に描く
    const behindAreas = [...staticNodes, ...p.abs].filter((n) => n.behind).map((n) => toArea(n, 'horizontal-tb', W) as BlockArea);

    const page: PageArea = {
      type: 'page',
      x: ex.left,
      y: ex.top,
      width: W,
      height: H,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: {},
      writingMode: wm,
      pageNumber: p.number,
      regionBody,
      absoluteAreas,
      behindAreas,
    };
    const sw = W + ex.left + ex.right;
    const sh = H + ex.top + ex.bottom;
    return {
      type: 'sheet',
      x: 0,
      y: 0,
      width: sw,
      height: sh,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: {},
      writingMode: wm,
      page,
      trimOrigin: { x: ex.left, y: ex.top },
      trimBox: { x: ex.left, y: ex.top, width: W, height: H },
      bleedBox: { x: ex.left - bleed, y: ex.top - bleed, width: W + bleed * 2, height: H + bleed * 2 },
      bleed,
      trimMarks: marks,
      trimMarkMargin: markMargin,
      ...(mms ? { trimMarkMargins: mms } : {}),
      ...(m.cornerMarks === false ? { cornerMarks: false } : {}),
      ...(m.centerMarks === false ? { centerMarks: false } : {}),
      ...(m.trimMarkLineWidth !== undefined ? { trimMarkLineWidth: m.trimMarkLineWidth } : {}),
      backgroundColor: m.backgroundColor,
      ...(m.backgroundImage
        ? m.backgroundImage.gradient
          ? { backgroundImage: m.backgroundArea === 'content' ? gradientImage(m.backgroundImage, regionW, regionH) : gradientImage(m.backgroundImage, W + bleed * 2, H + bleed * 2) }
          : this.sheetBackgroundImage(m.backgroundImage)
        : {}),
      ...(m.backgroundArea === 'content' ? { backgroundBox: { x: ex.left + rx, y: ex.top + ry, width: regionW, height: regionH } } : {}),
    };
  }
}

/**
 * 行の中のリーダーの点・文字列の繰り返しを、格子に合わせて並べ直す (XSL 1.1 §7.22.1 の leader-alignment):
 * “the start-edge of each cycle of the repeated pattern will be placed on the start-edge of the next cycle in the appropriate
 * pattern-alignment grid”。格子は、reference-area なら参照領域の内容の始めの端 (ref)、page ならページの始めの端から、ピッチごと。
 * lineI は行の箱の位置 (本文の領域の始めの端から)、pageEdge はページの始めの端から本文の領域までの距離。
 * リーダーの範囲に 1 周期がまるごと入る所にだけ置く
 */
function regridLeaders(line: LNode, lineI: number, ref: number, pageEdge: number) {
  const visit = (n: LNode, oi: number) => {
    const bi = oi + n.i;
    const g = n.leaderGrid;
    if (g) {
      // 格子の原点から、リーダーの始まりまでの距離
      const a = g.align === 'page' ? pageEdge + bi : bi - ref;
      n.children = [];
      for (let m = Math.ceil((a - EPS) / g.pitch); (m + 1) * g.pitch <= a + n.isize + EPS; m++) {
        for (const t of g.cycle) {
          const gn = cloneNode(t);
          gn.i = m * g.pitch - a + t.i;
          n.children.push(gn);
        }
      }
      return;
    }
    const pl = toLogical(n.padding, n.wm);
    const bl = borderToLogicalWidths(n.border, n.wm);
    for (const ch of n.children) visit(ch, n.kind === 'line' ? bi : bi + pl.is + bl.is);
  };
  visit(line, lineI - line.i);
}

/**
 * 変更バー (XSL 1.1 §7.30.4 change-bar-placement) を、段の行の向きの前 (start) と後ろ (end) のどちらの端に置くか。
 * 段の箱の位置は左 (縦書きは上) からなので、横書きの右から左の文書では、始めの端が後ろになる。
 * inside・outside: 綴じる側は、奇数ページでは始めの端、偶数ページでは終わりの端とする (§6.4.5 の注の “Commonly …”)。縦書きでは綴じる側が
 * 始めの端 (上) でも終わりの端 (下) でもないので、inside は始めの端、outside は終わりの端。
 * left・right は、縦書きでは段の端 (上・下) に当たらないので、start・end として扱う (読み込みが報告する)
 */
function changeBarSide(pos: NonNullable<RevisionBar['position']>, o: { wm: WritingMode; rtl: boolean; odd: boolean; col: number; columns: number }): 'start' | 'end' {
  const horizontal = o.wm === 'horizontal-tb';
  const flip = horizontal && o.rtl;
  const logical = (side: 'start' | 'end'): 'start' | 'end' => (flip ? (side === 'start' ? 'end' : 'start') : side);
  const inside = horizontal ? (o.odd ? 'start' : 'end') : 'start';
  const outside = inside === 'start' ? 'end' : 'start';
  switch (pos) {
    case 'end':
      return logical('end');
    case 'left':
      return 'start';
    case 'right':
      return 'end';
    case 'inside':
      return logical(inside);
    case 'outside':
      return logical(outside);
    case 'alternate':
      return logical(o.columns === 2 ? (o.col === 0 ? 'start' : 'end') : outside);
    default:
      return logical('start');
  }
}

/** 書字方向の裏返しを当てた本文の箱 (ページを使い回すとき、2 度当てない) */
const flipped = new WeakSet<LNode>();

/** marker を子に持つ箱 (BoxDesc)。閉じるときに、終わったページを記録する */
const markerParents = new WeakSet<object>();

/** retrieve-marker で該当するマーカーを探す (carryover は boundary の範囲まで遡る) */
function findMarker(r: LRetrieveMarker, pages: PageBuild[], index: number): LMarker | undefined {
  const position = r.position ?? 'first-starting-within-page';
  const boundary = r.boundary ?? 'page-sequence';
  const on = (i: number) => pages[i].markers.filter((m) => m.className === r.className);
  const own = on(index);
  // 前のページから持ち越した値 (直近のマーカー)
  const carry = () => {
    if (boundary === 'page') return undefined;
    for (let i = index - 1; i >= 0; i--) {
      if (boundary === 'page-sequence' && pages[i].seq !== pages[index].seq) break;
      const l = on(i);
      if (l.length) return l[l.length - 1].marker;
    }
    return undefined;
  };
  // last-ending-within-page (XSL 1.1 §6.13.6・§7.25.4): このページで終わる (is-last の) 親の marker のうち、木の順で最後のもの。
  // 無ければ、このページの最後の marker (このページで始まるもの、無ければ前のページから続いてこのページにも断片のある親のもの)。
  // それも無ければ前のページから持ち越し。木の順 (前順) は、親の始まった順 (先に始まった親の断片が先)
  if (position === 'last-ending-within-page') {
    const all: Array<{ m: PendingMarker; page: number; at: number }> = [];
    for (let i = index; i >= 0; i--) {
      if (boundary !== 'document' && pages[i].seq !== pages[index].seq) break;
      on(i).forEach((m, at) => all.push({ m, page: i, at }));
    }
    const endPage = new Map<object, number>();
    for (let i = 0; i <= index; i++) for (const k of pages[i].markerEnds ?? []) endPage.set(k, i);
    const ends = (x: { m: PendingMarker; page: number }) => (x.m.key ? endPage.get(x.m.key) : x.page);
    const order = (a: { page: number; at: number }, b: { page: number; at: number }) => a.page - b.page || a.at - b.at;
    const last = (xs: typeof all) => xs.sort(order)[xs.length - 1]?.m.marker;
    const ending = all.filter((x) => ends(x) === index);
    if (ending.length) return last(ending);
    // このページに断片のある親 (このページで始まった、またはまだ終わっていない・このページより後で終わる)
    const here = all.filter((x) => x.page === index || (x.m.key && (endPage.get(x.m.key) === undefined || endPage.get(x.m.key)! > index)));
    if (here.length) return last(here);
    return carry();
  }
  // first-except: このページでマーカーが始まれば空、そうでなければ持ち越し (CSS の string(…, first-except))
  if (position === 'first-except') return own.length ? undefined : carry();
  // start: ページの先頭の値 (最初の内容と一緒に始まるマーカー、無ければ持ち越し。CSS の string(…, start))
  if (position === 'start') return own[0]?.atStart ? own[0].marker : carry();
  const hit = position.startsWith('first') ? own[0] : own[own.length - 1];
  if (hit) return hit.marker;
  if (position.endsWith('including-carryover')) return carry();
  return undefined;
}

/** 静的コンテンツ中の retrieve-marker を、該当マーカーの内容 (または空) に置き換えた複製を返す */
function resolveMarkers<T>(node: T, pages: PageBuild[], index: number): T {
  return replaceRetrieves<T, LRetrieveMarker>(node, 'retrieve-marker', (r) => findMarker(r, pages, index));
}

/** 静的コンテンツ内の {pageNumber} / {totalPages} を置換した複製を返す */
function substitute<T>(node: T, vars: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    // \u0000名前\u0000 は、文字として書かれた「{名前}」(置き換えない。xslfoImport の static-content の文字)
    if (typeof v === 'string') return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\u0000(\w+)\u0000/g, '{$1}');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const copy = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, walk(val)]));
      copySourceRef(v, copy);
      return copy;
    }
    return v;
  };
  return walk(node) as T;
}

export type { BlockLikeArea };

// ── 行分けの結果の使い回し ──
// 段の高さ揃え (二分探索で中身を何度も組む) や keep-with-next の試し組みでは、同じ段落を同じ幅で何度も組む。
// 字の並び・行分け・行の位置と高さは、段落 (子の並びと位置)・字の書式・幅・書体の状態が同じなら同じなので、覚えて使い回す。
// ページ番号の参照・脚注・画像・行内のコンテナ (組む状況で中身や箱が変わるもの) を含む段落は覚えない

interface LineMemo {
  atoms: Atom[];
  raws: RawLine[];
  pls: PositionedLine[];
  lms: LineMetrics[];
}
interface LineMemoEntry extends LineMemo {
  run: InlineChild[];
  st: ResolvedStyle;
  measurer: Measurer;
  hyphenate: FlowHost['hyphenate'];
  kernAh?: boolean;
  version: string;
}
const lineMemos = new WeakMap<object, Map<string, LineMemoEntry>>();

/** 組む状況で中身や箱が変わる子 (ページ番号の参照・脚注・画像・行内のコンテナ) を含むか */
function hasDynamicInline(run: readonly unknown[]): boolean {
  for (const c of run) {
    if (typeof c === 'string' || !c) continue;
    const t = (c as { type?: string }).type;
    if (t === 'page-number-citation' || t === 'footnote' || t === 'footnote-citation' || t === 'image' || t === 'inline-container') return true;
    const kids = (c as { children?: unknown[] }).children;
    if (kids && hasDynamicInline(kids)) return true;
  }
  return false;
}

function sameStyle(a: ResolvedStyle, b: ResolvedStyle): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = (a as unknown as Record<string, unknown>)[k];
    const y = (b as unknown as Record<string, unknown>)[k];
    if (x !== y && JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

/** 鍵には、行分けの結果を変える Flow の設定 (中身の長さを測る intrinsic・最小の幅 minContent) も含める */
function lineMemoKey(at: number, L: number, first: boolean, wm: WritingMode, intrinsic: boolean, minContent: boolean) {
  return `${at}|${L}|${first ? 1 : 0}|${wm}|${intrinsic ? 1 : 0}${minContent ? 1 : 0}`;
}

function lineMemoGet(arr: object, at: number, run: InlineChild[], st: ResolvedStyle, L: number, first: boolean, wm: WritingMode, host: FlowHost, intrinsic: boolean, minContent: boolean): LineMemo | undefined {
  const e = lineMemos.get(arr)?.get(lineMemoKey(at, L, first, wm, intrinsic, minContent));
  if (!e || e.measurer !== host.measurer || e.hyphenate !== host.hyphenate || e.kernAh !== !!host.kernAh || e.version !== host.measurer.version()) return undefined;
  if (e.run.length !== run.length || e.run.some((c, k) => c !== run[k])) return undefined;
  return sameStyle(e.st, st) ? e : undefined;
}

function lineMemoSet(arr: object, at: number, run: InlineChild[], st: ResolvedStyle, L: number, first: boolean, wm: WritingMode, host: FlowHost, intrinsic: boolean, minContent: boolean, memo: LineMemo) {
  if (hasDynamicInline(run) || memo.atoms.some((a) => a.kind === 'box' || a.fnRef)) return;
  let m = lineMemos.get(arr);
  if (!m) lineMemos.set(arr, (m = new Map()));
  m.set(lineMemoKey(at, L, first, wm, intrinsic, minContent), { ...memo, run: run.slice(), st, measurer: host.measurer, hyphenate: host.hyphenate, kernAh: !!host.kernAh, version: host.measurer.version() });
}

/** 字形を差し替える OpenType の機能の並びが同じか (違う機能の字の組には、カーニングを当てない) */
function sameFeatures(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((f, i) => f === y[i]);
}
