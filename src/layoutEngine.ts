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
import { limitsKey, limitTap, noteLimitReached, type LimitName } from './limits';
import { TableMarkerScope, collectTableRetrieves, extendAreas, replaceRetrieves, type GroupMarkers, type MarkerArea } from './tableMarkers';
import { messageLang, msg } from './messages';
import { cssBaselineRatio, type LoadedFont } from './fontManager';
import { gradientSvg } from './cssGradient';
import { AREA_TREE_SCHEMA_VERSION, walkAreas, type AreaNode } from './areaTree';
import { copySourceRef, documentNodes, gridCopies, indexDocument, sourceRef, sourceRefEnd } from './sourceRef';
import { areaStructure } from './structure';
import { applyPaintEffects, collectPaintEffects, PAINT_EFFECT_MARK, PAINT_REF_MARK, paintEffectState, type PaintEffectEntry } from './paintEffect';
import type { PaintEffect } from './types';
import { attachResources, resourceAttacher } from './areaResources';
import type {
  Annotation,
  LTableColumn,
  LFlexItemColumn,
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
  PercentLength,
} from './types';
import { TOTAL_PAGES_ID } from './types';
import { citedPageItems, collateCitedPages, type CitedPageItem, type IndexSource } from './indexCitation';
import type { FontManager } from './fontManager';
import type { Measurer } from './measurer';
import { memoryRuntime } from './memoryEstimate';
import { DEFAULT_LINE_BREAK, lineHeightOf, newNode, resolveStyle, type GlyphPayload, type LNode, type ResolvedStyle } from './lnode';
import {
  borderToLogicalWidths,
  borderWidths,
  normBorder,
  normEdges,
  constrainReplaced,
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
  splitJoinedAtoms,
  markWordSqueeze,
  glyphNode,
  isInlineChild,
  lineMetrics,
  markBidi,
  placeAutospaceBidi,
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
import { kernablePair, kernScript, lastBaseOfUnit } from './orthographicSyllable';
import { fontFeaturesBetweenUnits } from './inlineFlatten';
import { mm } from './units';
import type { AssetStore } from './assets';
import { resolveRef } from './resources';
import { FootnoteCtx, footUnits, splitEntry, withLabel, type FootEntry, type FootnoteMark } from './footnotes';
import { breakEdgeBorder, collapsedOuterHalves, collapseTableBorders, firstRowBorderWidths, placeCells } from './tableBorders';
import { limitTableSpans } from './tableLimits';
import { gridTrackPlan, gridTracks, type GridTrackPlan } from './gridTracks';
import { formatPageNumber } from './pageNumber';
import { applyTextTransform } from './textTransform';
import { maxOf, minOf, pushAll } from './arrayLoop';
import { prepareWarichu } from './warichu';
import { diag, mergeDiagnostics, type Diagnostic } from './diagnostics';
import { withSource } from './sourceLocation';
import { rejoin, thisCall } from './callContext';
import { hrefOfTag } from './xmlAttr';

/** 行の並びの最初の節 (字でないもの。診断の場所に使う) */
const firstNode = (run: readonly unknown[]): object | undefined => run.find((x): x is object => !!x && typeof x === 'object');

/**
 * 組版の見張り (api.ts が、止める合図・進み具合 (TypesetOptions.signal・onProgress) を渡したときに作る)。
 * page は、置くページを 1 枚作るたびに呼ぶ (pass は組み直しの回 (1 から)、pages はその回でいままでに作ったページの数。
 * page-sequence を条件付きのマスターのために組み直すときと、段組の釣り合わせで組み直すときは、数え直すので減ることがある)。
 * 止めるときは投げる。先頭から N ページで止める (LayoutOptions.maxPages) のは、LayoutEngine.notePage が数を見て、内向きの印 (PAGE_LIMIT) を投げる。
 * boundary は、組み直しの回と page-sequence の境目で呼ぶ (layoutPaced・layoutSheetsPaced のとき。間をあけるときは Promise を返す)。
 * 1 つの page-sequence の組版は、同期の再帰の中で進むので、その途中では間をあけられない
 */
export interface LayoutControl {
  page(pass: number, pages: number): void;
  boundary(): void | Promise<void>;
}

/**
 * 先頭から N ページで止める (LayoutOptions.maxPages) ときに、N + 2 ページ目を作った所 (notePage) で投げる印。誤りではなく、
 * onceSteps (1 段の page-sequence) と layoutColumnPass (段組の page-sequence) が受けて、そこまでのページで、その回を終える
 */
const PAGE_LIMIT: unique symbol = Symbol('kumiori.pageLimit');

/** N ページで止めたときに決まらないものの種類 (診断 layout/beyond-max-pages の kind) */
type BeyondKind = 'page-number-citation' | 'page-number-citation-last' | 'total-pages' | 'index' | 'bookmark';

/**
 * 組版の途中で投げた印 (PAGE_LIMIT) で抜けたときに、流れの手間の数え (入れ子の深さ・測りの中か) を、組版の外の値に戻す
 * (止めた後に、同じ host で柱などを組むため。抜けた所の深さのままにすると、入れ子の上限・測りの覚えの判定がずれる)
 */
function resetFlowDepth(host: FlowHost): void {
  if (host.volatile) {
    host.volatile.active = 0;
    host.volatile.cites.length = 0;
  }
  if (host.nest) host.nest.d = host.nest.cd = 0;
  if (host.condense) host.condense.depth = host.condense.win = host.condense.trial = 0;
}

/** 2 つの集まりが同じ要素を持つか */
function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** 先頭から N ページで止めたので決まらなかったものの診断 (layout/beyond-max-pages。種類ごとに 1 件) */
function beyondDiagnostic(max: number, kind: BeyondKind, ids: string[], mark: string): Diagnostic {
  const count = ids.length;
  const shown = mark === '' ? msg('空', 'empty') : `"${mark}"`;
  const m: Record<BeyondKind, [string, string]> = {
    'page-number-citation': [`ページ番号の参照 ${count} 件`, `${count} page number reference(s)`],
    'page-number-citation-last': [`最後のページの番号の参照 ${count} 件`, `${count} last-page number reference(s)`],
    'total-pages': ['総ページ数', 'the total page count'],
    index: [`索引 ${count} 個`, `${count} index list(s)`],
    bookmark: [`しおり ${count} 件`, `${count} bookmark(s)`],
  };
  const [ja, en] = m[kind];
  const text =
    kind === 'index'
      ? msg(`先頭の ${max} ページで止めたので、${ja}には ${max} ページまでの所だけを並べました`, `stopped after the first ${max} pages, so ${en} list only the places within those pages`)
      : kind === 'bookmark'
        ? msg(`先頭の ${max} ページで止めたので、それより後ろを指す${ja}を、飛び先の無いしおりにしました`, `stopped after the first ${max} pages, so ${en} pointing beyond them have no destination`)
        : msg(`先頭の ${max} ページで止めたので、それより後ろを指す${ja}が決まらず、${shown}で組みました`, `stopped after the first ${max} pages, so ${en} pointing beyond them could not be resolved and were set as ${shown}`);
  return diag('layout/beyond-max-pages', text, { maxPages: max, kind, count, ...(kind === 'index' ? {} : { ids: ids.slice(0, 10).join(' ') }) });
}

/** 回・page-sequence の境目で yield するジェネレーター (passSteps・onceSteps) を、同期で最後まで走らせる */
function runSteps<R>(g: Generator<void, R>): R {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** 同じジェネレーターを、境目ごとに boundary を待ちながら走らせる */
async function runPaced<R>(g: Generator<void, R>, boundary: () => void | Promise<void>): Promise<R> {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    rejoin(thisCall(), await boundary());
  }
}

export interface LayoutOptions {
  /** 組版の見張り (LayoutControl。止める合図・進み具合) */
  control?: LayoutControl;
  /**
   * 先頭から maxPages ページまで組んだら、組むのをやめる (TypesetOptions.maxPages)。1 以上の整数。無ければ全体を組む。
   * ページ maxPages + 1 (見張りのページ) まで組み、その次のページを作る所で止め、見張りのページは捨てる (LayoutEngine.notePage)
   */
  maxPages?: number;
  /** 出さない診断の名前 (TypesetOptions.diagnostics.ignore)。その名前の警告は、木の warnings と diagnostics のどちらにも入れない */
  ignoreDiagnostics?: ReadonlySet<string>;
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
   * アンテナハウス互換の、行がページ (段) に入るかの判定の許容 (lineFitTolerance)。行の下端 (脚注の領域を引いた本文の下端と比べる) が
   * これだけはみ出しても、その行を置く。既定は 0.01pt (計算の誤差だけ)。見本の PDF: CSS-Print 第 4 版の 75 ページの図のキャプションは、
   * 脚注の分を引いた本文の下端を約 0.03pt 越えるが、そのページに置かれる (位置は Kumiori と 0.001pt まで同じ)
   */
  lineFitToleranceAh?: boolean;
  /**
   * アンテナハウス互換の、列の幅の指定の無い固定の列幅の表 (table-layout: fixed) の列の配り方: 1 行目のセルの罫線を除いた幅
   * (中身と padding の幅) を等しく配る (columnSizes の edges。アンテナハウスの見本に合わせたもの)。HTML の --style ah で使う。
   * XSL-FO の文書 (LDocument.spaceResolution が 'xsl') は、この設定に関わらず、どのモードでもこの配り方。
   * 既定 (HTML のほかのスタイル) は、CSS 2.1 §17.5.2.1 の 3 (残りの列で、表の残りの幅 (罫線・セルの間隔を除く) を
   * 等しく分ける) を、表の罫線・セルの間隔を除いた幅を列の箱に等しく分けると読み、
   * 列の箱を等分する (ブラウザ (Chromium) と同じ)
   */
  fixedColumnBordersAh?: boolean;
  /**
   * false で、計測の覚え (Flow.memoMeasure。幅を中身で決める箱の中身の幅・段組の釣り合わせの高さを、同じ組版の中で使い回す) を切る。
   * 覚えは組版の結果を変えない。切るのは、それを確かめるテストのためだけ (入れ子が深いと、組む回数が深さに対して指数的に増える)
   */
  measureMemo?: boolean;
  /**
   * 行分けの結果の覚え (同じ段落を同じ幅で組み直すときに使い回す) に置いておく大きさ (atom (字など) の数と、項目ごとの分) の上限。超えたら古いものから捨てる
   * (結果は変わらない。既定 LINE_MEMO_ATOMS。0 で覚えない)。テストで、捨てても結果が同じことを確かめるため
   */
  lineMemoAtoms?: number;
  /**
   * 段落の行分けの結果を、段落の中身で覚えて、文書をまたいで使い回すもの (器: createTypesetter の reuse。SharedLineMemo)。
   * 無ければ使い回さない。使い回しても、組んだ結果は変わらない
   */
  sharedLineMemo?: SharedLineMemo;
  /**
   * 前の文書の組版を覚え、中身の同じ page-sequence のページを使い回すもの (器: createTypesetter の reuse。LayoutReuse。
   * design/resumable-flow.md の 6)。無ければ使い回さない。使い回しても、組んだ結果は変わらない
   */
  layoutReuse?: LayoutReuse;
  /**
   * 試験のための印 (公開しない): 1 段の page-sequence の、続きから組める境目のすべてで、1 ページ先まで組んでから境目に戻り、
   * 境目の写しから続けて組む (design/resumable-flow.md の 4.4)。結果は印の無いときと同じになるはず (違えば続きから組む作りの誤り)。
   * 数は LayoutStats.resume に入る。無ければ resumeProbe.check
   */
  resumeCheck?: boolean;
  /**
   * 段組の入れ子の深さの上限。これより深い段組は 1 段に組む (警告を出す)。既定 4。Infinity で上限なし。
   * 中身がページからあふれる段組の入れ子は、外側の段の高さの探索の値ごとに内側の探索をやり直すので、段ごとに組む回数が増える
   */
  maxColumnNest?: number;
  /**
   * 組版の 1 回の通し (ページ番号の参照の組み直しは別に数える) で作る流れ (Flow) の数の上限。超えたら、以後の幅を中身で決める箱
   * (inline-container・inline-block・float・絶対配置の箱・回した箱) は中身の幅を測らずに使える幅で組み、段組は 1 段に組む (警告を出す)。
   * 既定は 100000 か、入力の節の数の 2 倍の大きい方 (流れの数は、ふつうの文書では節の数の 0.3〜1.2 倍: CSS-Print の本で節 1.3 万に約 1.6 万、
   * PostgreSQL の文書 (2781 ページ) で節 26 万に約 14 万。一定の上限では、大きな文書が、爆発していなくても上限に当たった)。Infinity で上限なし。
   * 種類を混ぜた入れ子は、箱が段ごとに違う幅で測られて覚え (memoMeasure) が当たらず、深さの 4 乗ほどで組む回数が増える。
   * 入れ子の深さで切る形は、上限より外側の箱の幅が収まらなくなって、かえって回数の増える入力があるので採らない
   */
  maxMeasureFlows?: number;
  /**
   * 入れ子の詰め込み (overflow="condense") で、内側の容器のために中身を測る回数の、いちばん外の詰め込みの容器 1 つごとの上限。
   * いちばん外の容器 (ほかの詰め込みの容器を測っている最中でも、詰めて組んでいる最中でもない容器) を組むたびに 0 から数え直し、その容器を
   * 詰めて組み終えるまでに、中の容器が中身を測った回数を数える (Flow.layoutContainer・Flow.condenseContainer)。超えたら、その容器の中の、
   * 以後の容器は詰めずに組む (いちばん外の容器と、ほかのいちばん外の容器は、これまでどおり詰める)。警告は、ページに置いた結果に、上限のせいで
   * 詰めなかったために収まらない容器が残るときだけ、文書で 1 度出す (表の幅や高さを測る組み・行をページで分ける前の、行の高さを測る組みで
   * 当たっても、組み直すたびに、当たる前に詰めた中の容器の結果を覚えて使うので、本番の組みでは詰め切ることがある。上限で詰めなかった容器も、
   * 中身が収まるかを 1 度だけ測り、もともと収まる容器では警告に出さない)。全体の合計の上限は置かない (手間は、いちばん外の容器の数 × 上限で抑えられ、
   * いちばん外の容器の数に比例するだけ。毎ページ組む柱の詰め込みは、ページごとに新しい写しを組むので、ページごとに数え直す)。
   * 既定は、10000 と、その容器の中の入力の節の数の 40 倍の、大きい方 (condenseLimit)。詰め込みの容器 1 つを詰めるのに測るのは、
   * 方法ごとに 13〜20 回ほど (打ち切りの確かめ・下限・二分探索) で、方法 2 つで 40 回ほど。同じ容器を同じ条件で詰めた結果は覚えて
   * 使い回すので、覚えの効く入れ子は、中の容器 1 つあたり 26 回ほどで、段の数によらない (中の容器の多い 2〜3 段の入れ子も、回数は中の容器の
   * 数に比例して小さく、上限に当たらない)。
   * 覚えが効かないとき (計測の覚えを切ったとき・試し組みが絶対配置の箱を置いたとき・外の倍率で内側の内容の幅が変わるとき) の入れ子の詰め込みは、
   * 外の詰め込みが測るたびに内側を詰め直すので、内側の容器の測る回数は、その上の段の容器の測る回数の積になり、段の数の指数で増える
   * (1 段ごとに 6〜15 倍ほど)。10000 は、1 本の深い入れ子を、それを測った数から止める値: 覚えを切った、収まらない中身の入れ子は 3 段で
   * 2,730 回 (通す)・4 段で 38,000 回ほど (止める)。自動の表 (table-layout="auto") のセルの中の入れ子は、覚えがあっても列の幅が外の倍率で
   * 変わるので、5 段で 1,768 回 (通す)・6 段で 13,000 回ほど (止める)。
   * 計測の覚えを切ったとき (measureMemo: false。テストのための設定) だけは、さらに、その容器の中の葉の容器 (中に詰め込みの容器を持たない、
   * 中の詰め込みの容器) の数 × 3000 とも比べて、いちばん大きい値にする: 覚えが無いと、ふつうの入れ子でも中の容器ごとに詰め直すので、
   * 2 段の中の容器は 1 つあたり 180〜200 回、3 段の葉の容器は 1 つあたり (その上の中の段の分を含めて) 1,400〜2,600 回測り、中の容器の多い
   * 入れ子 (表の 60 個のセルごとの詰め込みを 1 つの容器で包むなど) が上限に当たって、覚えありと結果が変わる。この項は、覚えありの既定には
   * 入れない: 上限は、いちばん外の容器ごとに 1 つの数なので、葉が増やした分を、同じ容器の中の 1 本の深い入れ子がまとめて使い切り、
   * 小さな葉を 1 つ足すごとに、止めるまでの手間が 3000 回分延びる (覚えを切ったときは、それを受け入れる)。Infinity で上限なし
   */
  maxCondenseMeasures?: number;
}

const EPS = 0.01;
/**
 * 入れ子の詰め込みで、いちばん外の容器 1 つの測りの中で、中の容器が中身を測る回数の既定の上限の下限 (LayoutOptions.maxCondenseMeasures の
 * 既定は、これと、その容器の中の節の数の 40 倍の大きい方。計測の覚えを切ったときは、葉の容器の数 × CONDENSE_LEAF_MEASURES とも比べる。condenseLimit)。
 * 数の根拠は LayoutOptions.maxCondenseMeasures に書いた
 */
const CONDENSE_NESTED_MEASURES = 10000;
/**
 * 入れ子の詰め込みで、計測の覚えを切ったとき (measureMemo: false) に、中の、葉の容器 (中に詰め込みの容器を持たない、中の詰め込みの容器)
 * 1 つあたりに見込む、測る回数 (LayoutOptions.maxCondenseMeasures の既定。覚えありの既定には入れない)。数の根拠は LayoutOptions.maxCondenseMeasures に書いた
 */
const CONDENSE_LEAF_MEASURES = 3000;

/**
 * いちばん外の詰め込みの容器 node の、入れ子の中の容器が測る回数の既定の上限 (LayoutOptions.maxCondenseMeasures): 10000 と、node の中の節の数の
 * 40 倍の、大きい方。計測の覚えを切ったとき (leaves) だけは、node の中の葉の容器の数 × 3000 とも比べる (覚えありでは比べない: 葉を足すと、
 * 同じ容器の中の深い入れ子を止めるまでの手間が延びるため)。同じ節 (表の見出し・柱の繰り返しなど) は覚えて (memo) 数え直さない
 */
function condenseLimit(node: LBlockContainer, memo: WeakMap<object, number>, leaves: boolean): number {
  const got = memo.get(node);
  if (got !== undefined) return got;
  const nodes = documentNodes(node as unknown as LDocument);
  let v = Math.max(CONDENSE_NESTED_MEASURES, 40 * nodes.length);
  if (leaves) {
    const inner = nodes.filter((x) => x !== node && (x as { condense?: unknown }).condense);
    const n = inner.filter((c) => !documentNodes(c as LDocument).some((y) => y !== c && (y as { condense?: unknown }).condense)).length;
    v = Math.max(v, CONDENSE_LEAF_MEASURES * n);
  }
  memo.set(node, v);
  return v;
}

/** 入れ子の詰め込みの上限の警告の文 (max は渡された上限 (LayoutOptions.maxCondenseMeasures)。無ければ既定の上限)。文書で 1 度にするため、文は上限によらず同じ */
function condenseCappedMessage(max: number | undefined): Diagnostic {
  return diag('layout/condense-capped', max !== undefined
    ? msg(`overflow="condense" の入れ子の詰め込みのために中身を測る回数が多すぎます (いちばん外の容器ごとに ${max} 回まで)。その容器の中の、以後の容器は詰めずに組みました`, `too many measurements of content for nested overflow="condense" (up to ${max} per outermost container); the remaining inner containers of that container were laid out without condensing`)
    : msg('overflow="condense" の入れ子の詰め込みのために中身を測る回数が多すぎます (いちばん外の容器ごとの既定の上限まで)。その容器の中の、以後の容器は詰めずに組みました', 'too many measurements of content for nested overflow="condense" (up to the default limit per outermost container); the remaining inner containers of that container were laid out without condensing'));
}

/** 組み直しで収束しなかったこと (unsettled) を、木の警告と診断に足す */
function addTreeDiagnostics(tree: Pick<AreaTree, 'warnings' | 'diagnostics'>, ds: readonly Diagnostic[]): void {
  if (!ds.length) return;
  tree.warnings.push(...ds.map((d) => d.message));
  tree.diagnostics = mergeDiagnostics([...(tree.diagnostics ?? []), ...ds]);
}
/** ページを 1 枚ずつ作るとき (layoutSheets・layoutLowMemory) の終わりの情報に、収束しなかったことを足す */
function withUnsettled(info: Pick<AreaTree, 'bookmarks' | 'destinations' | 'warnings' | 'diagnostics'>, unsettled: readonly Diagnostic[]): Pick<AreaTree, 'bookmarks' | 'destinations' | 'warnings' | 'diagnostics'> {
  const out = { ...info, warnings: [...info.warnings] };
  addTreeDiagnostics(out, unsettled);
  return out;
}

/**
 * host と同じで、入れ子の詰め込みの上限の警告 (condenseCappedMessage) だけを、出さずに held に取り置く host (ほかの警告は host のまま出す)。
 * 結果を捨てることのある組み (行の高さを測る組みの後に、行を分けて組み直すときなど) に使い、その結果を置くと決めたら、取り置いた警告を出す
 */
function holdCondenseWarnings(host: FlowHost, held: Diagnostic[]): FlowHost {
  return {
    ...host,
    warn: (m) => {
      if (m.message === condenseCappedMessage(host.condense?.opt).message) held.push(m);
      else host.warn(m);
    },
  };
}

/**
 * 本文の終わりの後に、脚注・float の続きのために足すページの守り (1 段の流れの Flow.finishPaginated と、段組の並びの脚注の受け渡し)。
 * 続きは、足したページの初めに、送った最初の脚注の少なくとも先頭の 1 行 (行に分けられない箱なら丸ごと) を置く (Flow.pushFootnote と
 * footnotes.ts の splitEntry。上限 (@footnote の max-height) やページに入らなくても、溢れの警告を出して置く) ので、ふつうはページごとに
 * 送る脚注の数か高さが減って、必ず終わる。決まったページの数で止めると、@footnote の max-height が小さいときや、長い脚注の続きで、
 * 置けるはずの脚注が欠けた。
 * そこで、ページを足しても送る脚注・float の数・高さ・単位 (下) の数が変わらないこと (進まない) が CONTINUATION_STALL_PAGES 回続いたら止める
 * (偶奇合わせの白ページは続きを置かないので、1 回では止めない)。
 * ページの数の上限は念のための守りで、送るものの大きさに合わせる: 本文の後に初めて足すときに送る脚注の、それ以上分けられない単位
 * (行と、子の無い箱。footnotes.ts の footUnits) の数と、送る float の数の和の 2 倍 (CONTINUATION_PAGE_MIN より小さくはしない)。
 * 足したページには、送る最初の脚注の単位を少なくとも 1 つ置く (splitEntry の前進の保証。分けられない脚注は丸ごと置く) か、
 * 送る float を置くので、ページごとに和が 1 つ以上減る。白ページ (偶奇合わせ) は続きを置かないが、続きを置くページの前に 1 枚までなので、
 * 進む文書は、和の 2 倍のページの数に当たらない。置いた float の中の脚注を送って和が増えたときは、増えた分の 2 倍を上限に足す。
 * 上限に当たるのは、進むと見えて (数か高さが変わって) 和が減らない入力だけ
 */
const CONTINUATION_STALL_PAGES = 3;
const CONTINUATION_PAGE_MIN = 50;

export class ContinuationGuard {
  private pages = 0;
  private stall = 0;
  private last?: string;
  /** 足してよいページの数 (初めて呼ばれたときに、送るものの大きさから決め、送るものが増えたら足す) */
  private limit = 0;
  /** 前に呼ばれたときの、送る脚注の単位の数と送る float の数の和 */
  private units?: number;
  /** 送る脚注 (entries) と送る float の数 (floats) の今の状態で、もう 1 ページ足してよいか。だめなら、欠ける脚注・float を警告に出す */
  next(host: { warn(d: Diagnostic): void }, entries: FootEntry[], floats = 0): boolean {
    const units = entries.reduce((a, e) => a + footUnits(e), 0) + floats;
    if (this.units === undefined) this.limit = Math.max(CONTINUATION_PAGE_MIN, 2 * units);
    else if (units > this.units) this.limit += 2 * (units - this.units);
    this.units = units;
    // 単位の数も見る: 入れ子の箱の中を分けて置くあいだは、残りの高さが変わらないことがある (分けた子の後ろの子の位置は、
    // 分ける前の子の終わりから動かさない) ので、高さと数だけでは、進んでいるページを、進まないと見て止めた
    const state = `${entries.length}:${units}:${entries.reduce((a, e) => a + e.height, 0)}:${floats}`;
    this.stall = state === this.last ? this.stall + 1 : 0;
    this.last = state;
    if (++this.pages <= this.limit && this.stall < CONTINUATION_STALL_PAGES) return true;
    const n = entries.length;
    const part = entries.filter((e) => e.cont).length;
    const ja = [n ? `脚注 ${n} 個${part ? ` (うち ${part} 個は、前のページに置いた脚注の残り)` : ''}` : '', floats ? `float ${floats} 個` : ''].filter(Boolean).join('と');
    const en = [n ? `${n} footnote(s)${part ? ` (${part} of them the rest of a footnote begun on an earlier page)` : ''}` : '', floats ? `${floats} float(s)` : ''].filter(Boolean).join(' and ');
    host.warn(
      diag('layout/continuation-dropped', this.stall >= CONTINUATION_STALL_PAGES
        ? msg(`${ja}が、どのページにも置けないため、置きません (欠けます)`, `${en} cannot be placed on any page and are dropped`)
        : msg(`脚注・float の続きのページが、本文の後に ${this.limit} ページを超えるため、${ja}を置きません (欠けます)`, `the continuation of footnotes and floats exceeds ${this.limit} pages after the body; ${en} are dropped`)),
    );
    return false;
  }
}

/** 写した節 to に、元の節 from の入力の番号 (sourceRef) を引き継いで返す (詰め込みの写し) */
const withRef = <T extends object>(from: unknown, to: T): T => (copySourceRef(from, to), to);

/**
 * 詰め込みの写しの中で、外の詰め込みに変えさせない節 (中の詰め込みの容器と、axf:overflow-condense="none" を書いた節) の写し。
 * 受け継いだ値 (詰める前の、字の大きさ・行の高さ) を書いた写しを、元の節と受け継いだ値の組ごとに 1 つだけ作って使い回す
 * (copies。組版の 1 回の通しごとに作る FlowHost.condense の copies)。外の詰め込みが倍率を変えて何度写しても、中の容器は同じ節なので、
 * 中の容器を詰めた結果の覚え (Flow.condenseContainer) が当たる
 */
function keptCopy(o: Record<string, unknown>, inh: Record<string, unknown>, copies: WeakMap<object, Map<string, object>> | undefined): object {
  if (!copies) return withRef(o, { ...o, ...inh });
  const key = JSON.stringify(inh);
  let m = copies.get(o);
  if (!m) copies.set(o, (m = new Map()));
  let c = m.get(key);
  if (!c) m.set(key, (c = withRef(o, { ...o, ...inh })));
  return c;
}

/**
 * 詰め込み (font-size) の中身: 容器と中の節の字の大きさに s を掛けた写し。中の、絶対の大きさを書いた節 (fontSizeFixed) とその中身は変えない
 * (アンテナハウスの説明 ahf-ext.html の axf:overflow-condense: 中で絶対の値を書いた字の大きさは、詰め込みで変えない)。容器そのものの字の大きさは、
 * 絶対の値でも詰める (詰める基準の大きさ。サンプル FO 集の axf-overflow-2 は、容器に font-size="12pt" と下限 10pt を書いて詰める例)。
 * 指定が無ければ受け継いだ大きさ base。
 * 中の、overflow="condense" の容器 (condense のある節) とその中身も変えない (同じ説明の overflow の condense: 入れ子の内側のブロックは、外側の
 * 詰め込みに影響されない)。axf:overflow-condense="none" を書いた節 (condenseNone。行内の要素にも書ける) とその中身も変えない (同じ説明の
 * axf:overflow-condense の none: 詰め込みから除く)。その節が字の大きさを受け継いでいれば、詰める前の受け継いだ大きさを書いた写し (keptCopy) にする
 */
function scaleFonts(node: LBlockContainer, s: number, base: number, copies?: WeakMap<object, Map<string, object>>): LBlockContainer {
  // grid の項目の並び (列挙しない性質) を、写した木のセルに付け直す (gridCopies)
  const gc = gridCopies();
  const ref = <T extends object>(from: object, to: T): T => (gc?.note(from, to), withRef(from, to));
  const walk = (v: unknown, inh: number): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inh));
    if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return v;
    const o = v as Record<string, unknown>;
    if (o.fontSizeFixed) return v;
    if (o.condense || o.condenseNone) return typeof o.fontSize === 'number' ? v : keptCopy(o, { fontSize: inh }, copies);
    const own = typeof o.fontSize === 'number' ? o.fontSize : inh;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = k === 'fontSize' && typeof x === 'number' ? x * s : walk(x, own);
    return ref(o, out);
  };
  const top = node.fontSize ?? base;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries({ ...node, fontSize: top, fontSizeFixed: undefined })) out[k] = k === 'fontSize' ? top * s : walk(x, top);
  const r = ref(node, out) as unknown as LBlockContainer;
  gc?.done();
  return r;
}

/**
 * 詰め込み (line-height) の中身: 容器と中の節の行の高さ (比・長さ) に s を掛けた写し。容器の行の高さは、指定が無ければ受け継いだ値。
 * 中の、overflow="condense" の容器と、axf:overflow-condense="none" を書いた節とその中身は変えない (scaleFonts と同じ。受け継いだ行の高さなら、
 * 詰める前の値を書いた写しにする)
 */
function scaleLineHeights(node: LBlockContainer, s: number, st: ResolvedStyle, copies?: WeakMap<object, Map<string, object>>): LBlockContainer {
  type LH = { lineHeight?: number; lineHeightPt?: number };
  const gc = gridCopies();
  const ref = <T extends object>(from: object, to: T): T => (gc?.note(from, to), withRef(from, to));
  const walk = (v: unknown, inh: LH): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inh));
    if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return v;
    const o = v as Record<string, unknown>;
    const has = typeof o.lineHeightPt === 'number' || typeof o.lineHeight === 'number';
    if (o.condense || o.condenseNone) return has ? v : keptCopy(o, { ...inh }, copies);
    const own: LH = typeof o.lineHeightPt === 'number' ? { lineHeightPt: o.lineHeightPt } : typeof o.lineHeight === 'number' ? { lineHeight: o.lineHeight } : inh;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = (k === 'lineHeight' || k === 'lineHeightPt') && typeof x === 'number' ? x * s : walk(x, own);
    return ref(o, out);
  };
  const own = node.lineHeightPt !== undefined || node.lineHeight !== undefined ? {} : st.lineHeightPt !== undefined ? { lineHeightPt: st.lineHeightPt } : { lineHeight: st.lineHeight };
  const top = { ...node, ...own };
  const out: Record<string, unknown> = {};
  const inh: LH = typeof top.lineHeightPt === 'number' ? { lineHeightPt: top.lineHeightPt } : { lineHeight: top.lineHeight };
  for (const [k, x] of Object.entries(top)) out[k] = (k === 'lineHeight' || k === 'lineHeightPt') && typeof x === 'number' ? x * s : walk(x, inh);
  const r = ref(node, out) as unknown as LBlockContainer;
  gc?.done();
  return r;
}

/** 見つからない飛び先の警告の書き方 (日本語・英語) と、まとめた行の書き方 */
const MISSING_ID_WARNINGS: ReadonlyArray<{ re: RegExp; group: (n: number, ids: string) => string }> = [
  {
    re: /^(?:ページ番号参照の対象 id="(.*)" が見つかりません|target id="(.*)" of a page number reference was not found)$/,
    group: (n, ids) => msg(`ページ番号参照の対象が見つかりません (${n} 件): ${ids}`, `targets of page number references were not found (${n}): ${ids}`),
  },
  {
    re: /^(?:しおりの飛び先 id="(.*)" が見つかりません|bookmark destination id="(.*)" was not found)$/,
    group: (n, ids) => msg(`しおりの飛び先が見つかりません (${n} 件): ${ids}`, `bookmark destinations were not found (${n}): ${ids}`),
  },
];
/** まとめた行に並べる id の数 (残りは「ほか N 件」) */
const MISSING_ID_SHOWN = 10;

/**
 * 見つからない飛び先 (ページ番号の参照・しおり) の警告を、種類ごとに 1 行にまとめる (id ごとに 1 行ずつ出すと、目次の深い項目の
 * 飛び先が無い文書などで数千行になる)。1 件だけなら元の行のまま。まとめた行は、その種類の最初の行の位置に置く
 */
export function groupMissingIdWarnings(list: string[]): string[] {
  const ids = MISSING_ID_WARNINGS.map(() => [] as string[]);
  for (const w of list)
    MISSING_ID_WARNINGS.forEach((k, i) => {
      const m = k.re.exec(w);
      if (m) ids[i].push(m[1] ?? m[2]);
    });
  if (ids.every((x) => x.length < 2)) return list;
  const out: string[] = [];
  const done = new Set<number>();
  for (const w of list) {
    const i = MISSING_ID_WARNINGS.findIndex((k) => k.re.test(w));
    if (i < 0 || ids[i].length < 2) {
      out.push(w);
      continue;
    }
    if (done.has(i)) continue;
    done.add(i);
    const shown = ids[i].slice(0, MISSING_ID_SHOWN).map((x) => `id="${x}"`).join(msg('、', ', '));
    const rest = ids[i].length - MISSING_ID_SHOWN;
    out.push(MISSING_ID_WARNINGS[i].group(ids[i].length, rest > 0 ? shown + msg(` …ほか ${rest} 件`, ` … and ${rest} more`) : shown));
  }
  return out;
}
/**
 * アンテナハウス互換の、行がページに入るかの判定の許容 (pt。LayoutOptions.lineFitToleranceAh)。見本の PDF で、AH が置いた行のはみ出しは
 * 約 0.03pt (CSS-Print 第 4 版の 75 ページ)。許す幅はこの 1 か所からは決められないので、それを含む小さな値にする
 */
const LINE_FIT_TOLERANCE_AH = 0.05;

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
    g ? { ...g, rows: g.rows.map((r) => (adj.has(r) ? withRef(r, { ...r, minHeight: Math.max(0, r.minHeight! + adj.get(r)!) }) : r)) } : g;
  return withRef(node, { ...node, header: fix(node.header), body: fix(node.body)!, footer: fix(node.footer) });
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
/**
 * 脚注の本体を組むブロック (脚注の書式と、頭の番号を付けた中身)。ブロックには脚注の節の番号 (sourceRef) を引き継ぐ (タグ付き PDF では、
 * 本体が注 (Note) の構造に入る)。タグ付き PDF では、頭の番号を、記号 (Lbl) の構造の節の番号の付いた inline で包む (LFootnote.tagParts)
 */
function footBlock(fn: LFootnote, fo: FootnoteOptions, label: string, fontSize: number, wm: WritingMode): LBlock {
  const { type: _t, children, label: _l, bodyLabel, tagParts, footnoteDisplay: _d, inlineBox: _b, ...style } = fn;
  void _t;
  void _l;
  void _d;
  void _b;
  let lab: string | LInline = label;
  if (tagParts) {
    lab = { type: 'inline', children: [label] };
    copySourceRef(tagParts.label, lab);
  }
  const block: LBlock = { type: 'block', ...style, ...footInset(fo, wm), ...(bodyLabel === false ? { children } : footBody(fo, lab, children, (style as { fontSize?: number }).fontSize ?? fontSize, wm, fn)) };
  copySourceRef(fn, block);
  return block;
}

function footBody(fo: FootnoteOptions, label: string | LInline, children: LFootnote['children'], fontSize: number, wm: WritingMode, own?: Pick<LFootnote, 'labelPosition' | 'labelGapEm'>): Pick<LBlock, 'children' | 'textIndent'> {
  // 置き方は、脚注ごとの値 (own: その脚注の要素に当たる ::footnote-marker の規則) があればそれ、無ければ文書全体の値
  const pos = own?.labelPosition ?? fo.labelPosition;
  // 縦書きの脚注は、ぶら下げずに本文の前に置く
  if (pos === 'outside' && !/^vertical/.test(wm)) {
    const w = fontSize * 8;
    const gap = fontSize * ((own?.labelPosition ? own.labelGapEm : fo.labelGapEm) ?? 0);
    const box: LInlineContainer = { type: 'inline-container', width: w, padding: { right: gap }, children: [{ type: 'block', textAlign: 'end', textIndent: 0, children: [label] }] };
    return { textIndent: -(w + gap), children: [box, ...children] };
  }
  if (pos === 'inside') return { children: [label, ...children] };
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

/**
 * 改ページの境目で決め直した表のセルの罫線の、決め直す前の線 (セルごと・辺ごと。辺が無かったものは undefined)。
 * collapse の表では、改ページの境目の罫線を、組んだ行のセルの辺を書き換えて決める (ページの最後の行の後ろ側の線: closeRowAtBreak。
 * 表ヘッダーの後の最初の行の前側の線: reborderAfterHeader)。組んだ行のセルは、組み直すとき (最後のページのマスターの組み直しなど、
 * 境目で保存した状態から続きを組むとき) にもう 1 度置くので、書き換えたままだと、組み直した流れが前の組みの境目の線を読んでしまう
 * (次の行の前側の線を写す closeRowAtBreak が、前の組みで表ヘッダーの後に決め直した線を写すなど)。
 * そこで、書き換える前の線を覚えておき、行を置くたびに戻してから (restoreBreakSides)、その置き方の境目の線を決め直す
 */
const BREAK_SIDE_ORIG = new WeakMap<LNode, Partial<Record<keyof Edges, BorderSide | undefined>>>();

/** セルの side の辺を書き換える前に、元の線を覚える (2 度目からは、初めの線のまま) */
function rememberBreakSide(cell: LNode, side: keyof Edges) {
  let m = BREAK_SIDE_ORIG.get(cell);
  if (!m) BREAK_SIDE_ORIG.set(cell, (m = {}));
  if (!(side in m)) m[side] = cell.border[side];
}

/** 行のセルの、改ページの境目で書き換えた辺を、元の線に戻す */
function restoreBreakSides(rows: LNode[]) {
  for (const row of rows)
    for (const cell of row.children) {
      const m = BREAK_SIDE_ORIG.get(cell);
      if (!m) continue;
      for (const side of Object.keys(m) as Array<keyof Edges>) {
        const b = m[side];
        if (b) cell.border[side] = b;
        else delete cell.border[side];
      }
      BREAK_SIDE_ORIG.delete(cell);
    }
}

/**
 * 断片の切れ目の側 (side) の角を丸めない (box-decoration-break: slice。CSS Fragmentation 3 §5.4: 箱を分けずに描いてから切った形になるので、
 * border-radius の角は、箱の最初と最後の断片の外側の角にだけ付く)。角は 左上・右上・右下・左下 の順 (BorderRadius.corners)
 */
function cutRadius(n: LNode, side: keyof Edges) {
  const r = n.radius;
  if (!r) return;
  const at = side === 'top' ? [0, 1] : side === 'right' ? [1, 2] : side === 'bottom' ? [2, 3] : [3, 0];
  const corners: NonNullable<typeof r.corners> = r.corners ? r.corners.map((c) => [c[0], c[1]]) : [0, 1, 2, 3].map(() => [r.rx, r.ry]);
  for (const k of at) corners[k] = [0, 0];
  n.radius = { ...r, corners };
}

/**
 * 断片の切れ目の側の罫線・余白を切る。keepBorder: 表は断片ごとに外枠を閉じる (box-decoration-break: clone 相当) ので、罫線は残して余白だけ切る。
 * 罫線を残さない断片 (slice) は、切れ目の側の角も丸めない (cutRadius)。罫線を残す断片 (clone・表) は、断片ごとに丸める (§5.4)
 */
function cutStart(n: LNode, keepBorder = false, keepPadding = false) {
  const s = startSide(n.wm);
  if (!keepPadding) n.padding[s] = 0;
  n.margin[s] = 0;
  if (!keepBorder) {
    delete n.border[s];
    cutRadius(n, s);
  }
}
function cutEnd(n: LNode, keepBorder = false, keepPadding = false) {
  const s = endSide(n.wm);
  if (!keepPadding) n.padding[s] = 0;
  n.margin[s] = 0;
  if (!keepBorder) {
    delete n.border[s];
    cutRadius(n, s);
  }
}

// ───────────────────────── Flow (フラグメンタ) ─────────────────────────

/**
 * 続きの位置の記録の 1 段 (design/resumable-flow.md の 2.2)。Flow の再帰の関数が、入るときに積み、出るときに降ろす (Flow.rs)。
 * phase は、その段がいま何をしているか: 下の段の関数を呼んでいる所 (続きの位置の鎖が下の段へ続く) か、改ページを呼んだ所 (鎖の最後)。
 * '' は、そのどちらでもない (関数の中の、続きから組めない所を組んでいる)。境目では、外から順に鎖をたどって、続きから組めるかを決める
 * (Flow.resumeReason)
 */
type ResumeStep = ChildrenStep | BlockStep | TableStep | InlineStep | ForceStep;

/** 表 (layoutBlockLevel → layoutTable)。fo:retrieve-table-marker の無い表の、行の塊を置く所の改ページから続けられる */
interface TableStep {
  k: 'table';
  orig: LBlockLevel;
  /** layoutTable が受けた表と、組んでいる表 (罫線をつぶし、百分率を解いた後) */
  table: LTable;
  node?: LTable;
  /** pre: break-before の区切りの中。ktc: 分けない指定の試しの改ページ。open: 箱を開く所の前の箱の break-after。break: 行の塊を置く所の改ページ */
  /** fblank・fpage: 行の前の強制の区切り (page など) の、白ページと区切りのページの改ページ */
  phase: '' | 'pre' | 'ktc' | 'open' | 'break' | 'fblank' | 'fpage';
  open?: TableOpen;
  ctx?: TableCtx;
  rs?: TableRows;
}

/** 組んでいる collapse の表の、改ページの境目で罫線を決め直すための線 (Flow.tableBreak) */
type TableBreakLines = { header: boolean; compat: boolean } & NonNullable<LTable['breakBorders']>;

/** 表の行の塊を置く所 (layoutTableRows)。site は、どこで置いているか ('' は、続きから組めない所) */
interface TableRows {
  /**
   * final: 終わりの並び。linked: 塊を足す前の並び。lead-flush・lead: 行の前の強制の区切りの前の並びと、その塊。frags: 分けた行の k 番目の断片
   */
  site: '' | 'final' | 'linked' | 'lead-flush' | 'lead' | 'frags';
  rows: LTableRow[];
  i: number;
  end: number;
  pending: LNode[];
  pendingLinked: boolean;
  grp: LNode[];
  held: Diagnostic[];
  splitTried: boolean;
  frags: LNode[];
  k: number;
  lead: true | BreakKind | undefined;
}

/** 表の箱を開く所 (layoutTable の中ほど) に要る、前半で決めた値 */
interface TableOpen {
  /** layoutTable が受けた表 (診断の場所) */
  table: LTable;
  node: LTable;
  st: ResolvedStyle;
  desc: BoxDesc;
  out: ReturnType<typeof collapsedOuterHalves>;
  autoFree: number | undefined;
  autoRtl: true | undefined;
  caps: NonNullable<LTable['captions']>;
  capIs: number;
  capTableI: number;
  bottomMargin: number;
  bottomCaptions: boolean;
  gridMeasure: GridColumnMeasure[] | undefined;
  gridWhole: GridLineMeasure | undefined;
  outerI: number;
}

/** 表の行を組む所と後半 (layoutTable の後ろ) に要る値 */
interface TableCtx {
  node: LTable;
  st: ResolvedStyle;
  desc: BoxDesc;
  out: ReturnType<typeof collapsedOuterHalves>;
  caps: NonNullable<LTable['captions']>;
  capIs: number;
  capTableI: number;
  bottomMargin: number;
  bottomCaptions: boolean;
  frame: Frame;
  cb: CbAbs | undefined;
  outerCb: CbAbs | undefined;
  sp: { i: number; b: number } | undefined;
  sizes: number[];
  savedSpacing: { i: number; b: number } | undefined;
  savedRowspanAh: boolean;
  savedTableBreak: TableBreakLines | undefined;
  savedTrailOut: number | undefined;
  headerRows: LNode[];
  footerRows: LNode[];
  repeatFooter: boolean;
  reserve: number;
}

/** 子の並び (layoutChildren) */
interface ChildrenStep {
  k: 'children';
  children: Array<LBlockLevel | LInlineLevel>;
  /**
   * run: 行の並び run を組んでいる (flushRun の中。at はその後に組む子。並びの終わりなら children.length)。
   * child: at 番目の子のブロックを組んでいる。kwp・kwn: at 番目の子の前の keep-with-previous・keep-with-next の改ページ
   */
  phase: '' | 'run' | 'child' | 'kwp' | 'kwn';
  at: number;
  run: InlineChild[];
  runAt: number;
  firstRun: boolean;
  topAt: number;
  topPage: number;
  /** 行の並びに、書いた所に目印のある float・絶対配置の箱がある (続きから組めない。2.4) */
  anchored: boolean;
}

/** ブロック (layoutBlockLevel → layoutBlock) */
interface BlockStep {
  k: 'block';
  /** 子の並びの節 (layoutBlockLevel が受けたもの) と、組んでいる節 (百分率を解いた後) */
  orig: LBlockLevel;
  node: LBlock;
  /** pre: break-before の区切り (forceBreak) の中。ktc: 分けない指定の試しの改ページ (keepTogetherCheck)。body: 中身 (layoutChildren) */
  phase: '' | 'pre' | 'ktc' | 'open' | 'body';
  /** open の所に要る、前半で決めた値 */
  open?: BlockOpen;
  ctx?: BlockCtx;
}

/** ブロックの箱を開く所 (layoutBlock の中ほど) に要る、前半で決めた値 */
interface BlockOpen {
  node: LBlock;
  st: ResolvedStyle;
  desc: BoxDesc;
  est: { min?: number; max?: number; auto?: boolean } | undefined;
  autoOk: boolean;
  autoFree: number | undefined;
  outerI: number;
  autoRtl: boolean;
}

/** 行の並び (layoutInlineRun) */
interface InlineStep {
  k: 'inline';
  /** layoutInlineRun が受けた並び */
  src: InlineChild[];
  /** pending: 行の前の、保留の区切り (applyPendingBreak → forceBreak) の中。top・bottom: 行を置く前・置いた後の改ページ */
  phase: '' | 'pending' | 'top' | 'bottom';
  ctx?: InlineCtx;
  /** 次に置く行の番号 */
  idx: number;
}

/** 強制の区切り (forceBreak)。kind は合わせた後の区切りの種類 */
interface ForceStep {
  k: 'force';
  kind: BreakKind;
  /** col: 段の区切り。blank: 偶奇合わせの白ページ。page: 区切りの改ページ。empty: 何も無いページの偶奇が合わないときの改ページ */
  phase: '' | 'col' | 'blank' | 'page' | 'empty';
}

/** ブロックの中身を組む所 (layoutBlock の後半) に要る、前半で決めた値 */
interface BlockCtx {
  node: LBlock;
  /** 中身に継ぐ書式 (百分率の text-indent を解いたもの) */
  cst: ResolvedStyle;
  desc: BoxDesc;
  frame: Frame;
  cb: CbAbs | undefined;
  outerCb: CbAbs | undefined;
  floatsBefore: number;
  fence: boolean | undefined;
  outerRef: number;
  refLines: boolean | undefined;
  outerBlocked: boolean;
  blockAt: object | undefined;
}

/** 行を置く所 (layoutInlineRun の後半) に要る、前半で決めた値 */
interface InlineCtx {
  run: InlineChild[];
  st: ResolvedStyle;
  first: boolean;
  L: number;
  atoms: Atom[];
  raws: RawLine[];
  pls: PositionedLine[];
  lms: LineMetrics[];
  refs: ReturnType<typeof lineFootnotes>[];
  useFoot: boolean;
  holdFoot: boolean;
}

/** Flow の、ページの境目の写し (design/resumable-flow.md の 4.2 の flow と resume) */
interface FlowBoundary {
  /** 改ページの種類 (openPage に渡す) */
  level: 'column' | 'page' | 'blank';
  /** 欄の写し (配線の欄を除く。Flow.captureFields) */
  fields: Record<string, unknown>;
  /** 続きの位置 (外から順。写した段。ブロックの箱は stack の添字で持つ) */
  steps: ResumeStep[];
  /** 続きから組めない理由 (組めるなら undefined) */
  reason?: string;
}

interface Frame {
  /**
   * ブロックの終わりまで字下げするドロップキャップの回り込みの範囲 (axf:initial-letters の adjacent)。箱を閉じるとき、終わりの位置で切る
   * (字の箱の下端より上では切らない)
   */
  ilBands?: PlacedFloat[];
  /** この箱の中に置いた、XSL-FO のドロップキャップ (axf:initial-letters) の回り込みの範囲。箱を閉じるとき、後ろのブロックの扱いの印を付ける */
  ilFloats?: PlacedFloat[];
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
  grid?: { pitch: number; ascent: number; root?: boolean; stack?: boolean } | null;
  /** XSL の、罫線をつぶした表の、前の側の外へ出る罫線の半分 (Flow.pendSpill)。次の段・ページへ続く断片の頭でも、同じだけ外へ出す */
  spillBs?: number;
  /** 開いたときの、前の余白を足す前の位置 (中身を置かずに次のページへ送り直すとき、ここまで戻す) */
  openFrom?: number;
  /** ページに置いた断片 (順に)。絶対配置の基準になる箱・position: relative の箱だけが集める */
  frags?: LNode[];
  /** 中身の幅を測る組版で、内容の幅が測る幅による箱 (中の百分率は循環する。CSS Sizing 3 §5.2.1。withPercent) */
  indefI?: boolean;
  /**
   * 百分率の幅・上限・下限で内容の幅を決めた箱 (BoxStyle.percent)。ページごとに本文領域の幅が違うとき、続きの断片の内容の幅を、
   * そのページでの包含ブロックの幅から解き直す (CSS Fragmentation 3 §5.1)
   */
  pctI?: { P: NonNullable<BoxStyle['percent']>; borderBox: boolean };
  /**
   * auto の余白で寄せた、幅の決まった箱 (CSS 2.1 §10.3.3)。am は auto の側、free は寄せる前の残り (包含ブロックの幅 parentI − 余白 − 箱の幅 boxI)。
   * ページごとに本文領域の幅が違うとき、続きの断片の寄せを、そのページの包含ブロックの幅で配り直す (CSS Fragmentation 3 §5.1)。
   * rtl: 包含ブロックが右から左 (横書き) で、残りが負 (箱が置く場所より広い) なら margin-left が残りを取る (箱を右に揃え、左へはみ出す。CSS 2.1 §10.3.3)
   */
  autoM?: { am: 'start' | 'center' | 'end'; free: number; parentI: number; boxI: number; rtl?: true };
}

/** CSS の絶対配置の基準になるブロック (LBlock.containingBlock) と、その中で見つけた絶対配置の箱 (箱を組み終えてから組んで置く) */
interface CbAbs {
  frame: Frame;
  items: CbItem[];
}

/**
 * 基準の箱の中で見つけた絶対配置の箱。sy は見つけた所 (static position) の block 方向の位置、frag は見つけた断片の番号。
 * anchor は、別の流れ (表のセルの中) で見つけたときの、その流れの中身を持つ節 (セルの箱): sy・frag はその節の内容の箱の中の値で、
 * 基準の箱の断片の中から anchor を探して、基準の箱の中の位置に直す。組み直して捨てたセルで見つけたもの (anchor が断片の中に無い) は置かない
 */
interface CbItem {
  node: LBlockContainer;
  st: ResolvedStyle;
  sy: number;
  frag: number;
  anchor?: LNode;
  /**
   * 行の中で見つけた箱の、見つけた所の目印の番号 (LNode.absAnchor)。基準の箱の断片の中に目印の箱があれば、その箱の行の中の位置と、
   * その行の上端を static position にする (sy・frag・anchor より先に使う)
   */
  staticKey?: number;
}

interface FlowHost {
  /** 行グリッドの root の書式 (いま組んでいる並びの、流れの根元の書式) */
  gridRootStyle?: ResolvedStyle;
  assets?: AssetStore;
  hyphenate?: LayoutOptions['hyphenate'];
  kernAh?: boolean;
  /** 行がページ (段) に入るかの判定の許容 (pt。LayoutOptions.lineFitToleranceAh)。無ければ EPS */
  lineFitTolerance?: number;
  warn(d: Diagnostic): void;
  /** page-number-citation: 参照先 id のページ番号 (文字列) */
  cite(refId: string, last?: boolean, format?: string, physical?: boolean, style?: ResolvedStyle, pageNumber?: number): string;
  /**
   * 索引のページ番号の並び (LIndexPageCitationList) を、字と行内の箱に置き換える。索引を使う文書 (LDocument.indexEntries がある) でだけ持つ。
   * 置き換えるものが無ければ、渡した配列をそのまま返す
   */
  index?(run: InlineChild[]): InlineChild[];
  /**
   * 索引の目印 (領域を作らない所) の id か。その id は、行を作らない並びにあるとき、いまのページではなく、次の内容が置かれるページで記録する
   * (XSL 1.1 §6.10.6: その formatting object が領域を返さないときは、後ろの formatting object の最初の領域のページを、
   * それも無ければ前の formatting object の最後の領域のページを引く)。範囲の終わりの印 ('end') は、いまのページ (前の内容のページ) で記録するが、ページを持たない流れ
   * (セル・コンテナの中) では記録できないので、目印と同じ道で運ぶ。索引を使う文書でだけ持つ
   */
  indexPoint?(id: string): 'point' | 'end' | undefined;
  measurer: Measurer;
  /** いま組んでいるページの番号 (text-align の inside / outside の判定用)。無ければ 1 */
  pageNumber?: () => number;
  /**
   * ページの左右を決める数 (偶奇で左右が決まる) の、ページ番号 (pageNumber) からのずれ。LDocument.pageSidesByOrder の文書では、文書の最初からの
   * ページの順 - ページ番号 (page-sequence の中では、番号も順も 1 ずつ増えるので一定)。ほかは 0 (ページ番号の偶奇)
   */
  sideDelta?: number;
  /** ページが右から左へ進む本 (LDocument.rtlPageProgression。奇数ページの綴じ側が右) */
  rtlPages?: boolean;
  /** 絶対配置の基準になる行内の箱 (LInline.cbKey) の、入力の節の番号の範囲 [その節, 子孫の次) */
  inlineCbRange?: (key: number) => [number, number] | undefined;
  /** 余白の解決を XSL 1.1 §4.3.1 の規則で行う (LDocument.spaceResolution) */
  xslSpace?: boolean;
  /** 中身の無い目印だけの行で、保留中の余白を確定する (前後のマージンを相殺しない。LDocument.idLinesSeparateMargins) */
  idLinesSeparateMargins?: boolean;
  /**
   * 列の幅の指定の無い固定の列幅の表で、1 行目のセルの罫線を除いた幅を等しく配る (XSL-FO の文書と、LayoutOptions.fixedColumnBordersAh)。
   * 無ければ、列の箱を等分する
   */
  fixedColumnBorders?: boolean;
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
  /** 行分けの結果の覚え (lineMemos) の、覚えている量と古さの順 (LineMemoLru。LayoutEngine.layout ごとに作り直す) */
  lineMemoLru?: LineMemoLru;
  /** 段落の中身で引く行分けの結果の覚え (文書をまたぐ。LayoutOptions.sharedLineMemo) と、いまの書体の組の印 (FontManager.signature) */
  sharedLines?: { memo: SharedLineMemo; env: string; fonts: FontManager };
  /**
   * 計測の覚え (measureMemo) のための記録。
   *  - n: 覚えてはいけない計測の数え上げ。結果のほかに跡を残すこと (試し組みの中の絶対配置の箱) が起きるたびに増やす。
   *    計測の前後で値が変わっていれば、その計測は覚えない
   *  - active・cites: 覚える計測の途中 (active > 0) に引いたページ番号の参照 (cite の引数と返した値) を、引いた順に記録する
   */
  volatile?: { n: number; active: number; cites: CiteUse[] };
  /**
   * 組むときに読んだ、いちばん後ろの入力の節の番号 (design/resumable-flow.md の 5.1)。境目を写す page-sequence の間だけ置く。
   * 試し組み・測る組みの流れも、同じ物を持つ ({ ...host } で写す) ので、読んだ分が入る
   */
  read?: { to: number };
  /**
   * 組む手間の上限: 幅を中身で決める箱・段組の入れ子のいまの深さ (d・段組は cd)、段組の深さの上限 (cmax)、
   * この通しの始めの流れの数 (base) と流れの数の上限 (budget)、簡略に組んだか (hit)、いちばん深いところ (maxSeen・cSeen)、警告の出し先
   */
  nest?: {
    d: number;
    cd: number;
    cmax: number;
    base: number;
    budget: number;
    hit: boolean;
    maxSeen: number;
    cSeen: number;
    warn: (m: Diagnostic) => void;
    /**
     * 上限の数えの直し (流れの数に足す。負にもなる)。最後のページのマスターの組み直しを、上限から遠い所で行ったとき (SeqRun.relayout の守りの内)、
     * 組み直しで作った流れを数えから除く。境目から続けて組んでも初めから組んでも、組み直しの後の数えを同じにする
     * (初めから組み直す流れの数は、計測の覚えに当たって 1 度目の組みより少なく、境目までの数を足して真似ることができないため)
     */
    charged?: number;
  };
  /**
   * 詰め込み (Flow.condenseContainer) の、組版の 1 回の通しの中の状態: いまの、いちばん外の詰め込みの容器の測りの中で、入れ子の中の容器が
   * 中身を測った回数 (n) とその上限 (max)、その上限に当たったか (hit)、渡された上限 (opt。LayoutOptions.maxCondenseMeasures。無ければ容器ごとに
   * 既定の値)、いま中身を測っている詰め込みの容器の深さ (depth。0 なら、どの詰め込みの測りの中でもない)、いちばん外の詰め込みの容器の、
   * 詰めた後の組みの中か (win。0 でなければ中。Flow.layoutContainer)、結果を捨てる、高さを測るだけの組みの中か (trial。0 でなければ中。
   * Flow.condenseTrial)、いちばん外の容器ごとの既定の上限 (limits。condenseLimit)、
   * 外の詰め込みに変えさせない節の写し (copies。keptCopy)、上限に当たって詰めない容器の、中身が収まるか (fit。いちばん外の容器ごとに
   * 作り直す。Flow.condenseContainer)
   */
  condense?: { n: number; max: number; hit: boolean; opt: number | undefined; depth: number; win: number; trial: number; limits: WeakMap<object, number>; copies: WeakMap<object, Map<string, object>>; fit: WeakMap<object, Map<string, boolean>> };
}

/** 計測の中で引いたページ番号の参照: cite の引数 (ページ番号を除く) と、返した値 */
interface CiteUse {
  args: [refId: string, last: boolean | undefined, format: string | undefined, physical: boolean | undefined, style: ResolvedStyle | undefined];
  value: string;
}

/** 計測の覚えの 1 件: 値と、鍵の文字列に入れない条件 (中身に継がせるスタイル・脚注の番号付け・計測の中で引いたページ番号の参照の値) */
/** 1 行の組の高さの覚え (Flow.rowHeightRecord)。trail: その行が表の外へ出す末尾の余白。clean: 組みを省いてよい (表の外に跡を残さない) */
interface RowHeight {
  h: number;
  trail: number | undefined;
  clean: boolean;
}

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
/**
 * 組み終えた文書の、ページを 1 枚ずつ領域の木にするもの (LayoutEngine.layoutSheets)。文書全体の領域の木を 1 度に持たずに、
 * ページごとに使って手放す (PDF をページごとに書く) ためのもの
 */
export interface SheetSource {
  /** ページ (シート) の数 */
  readonly count: number;
  /** 先頭から maxPages ページで止めたら、その数 (AreaTree の truncated) */
  readonly truncatedAt?: number;
  /** 文書の題・情報 (AreaTree の title・info) */
  readonly title?: string;
  readonly info?: AreaTree['info'];
  /** タグ付き PDF の構造の木 (AreaTree の structure) */
  readonly structure?: AreaTree['structure'];
  /**
   * 組みながら渡し終えたページの数 (layoutSheets の emit。文書の初めからこの数のページは、渡した後で組版の途中の木を手放したので、
   * sheet・release を呼べない)。渡さなかったときは 0
   */
  readonly emitted: number;
  /** ページ i の領域の木 (layout の返す木の sheets[i] と同じもの)。呼ぶたびに作る */
  sheet(i: number): SheetArea;
  /** ページ i の組版の途中の木を手放す (この後は sheet(i) を呼べない) */
  release(i: number): void;
  /** しおり・文書内リンクの飛び先・警告 (AreaTree の bookmarks・destinations・warnings)。ページを作った後で呼ぶ */
  finish(): Pick<AreaTree, 'bookmarks' | 'destinations' | 'warnings' | 'diagnostics'>;
}

/**
 * 組みながら、確定したページを渡す先 (LayoutEngine.layoutSheets の emit。design/pdf-writer.md の 12)。
 * 組版は、確定したページを、柱まで組んで領域の木にして page に渡し、受けたら、そのページの組版の途中の木を手放す (文書全体の木を持たない)。
 * ページが確定するのは、組み直しの 1 回目で、そのページまでの本文と柱が、まだ置いていない参照先 (前向きのページ番号の参照・
 * page-number-citation-last・総ページ数) を引いていないとき (後ろの組版と組み直しの回で、そのページは変わらない)。
 * page は同期で呼ぶ (1 つの page-sequence の中では、組版は待てない)
 */
export interface PageEmitter {
  /**
   * 確定したページ (index は文書の初めから 0 から) を渡す。受けられなければ false を返す (そのページから後ろは渡さず、組み終えてから
   * SheetSource.sheet で作る)
   */
  page(index: number, sheet: SheetArea): boolean;
}

/**
 * 組みながら渡す作り (PageEmitter) の確認の切り替え (試しと道具だけが使う)。keep なら、渡したページの組版の途中の木を手放さずに持ち、
 * 組み終えた所で、渡したときの領域の木と、組み終えたページから作り直した領域の木を比べ、違ったページを mismatches に足す
 * (組版の結果は、切り替えの無いときと同じ)。emitted は、渡したページの数の合計
 */
export const emitProbe: { keep: boolean; emitted: number; mismatches: string[] } = { keep: false, emitted: 0, mismatches: [] };

/** 組版の途中の木を持ち続けずに組み、ページを順に領域の木にして渡すもの (LayoutEngine.layoutLowMemory) */
export interface LowMemorySheets {
  readonly title?: string;
  readonly info?: AreaTree['info'];
  /** タグ付き PDF の構造の木 (AreaTree の structure) */
  readonly structure?: AreaTree['structure'];
  /** ページ (シート) の数 (scan の後で決まる) */
  readonly count: number;
  /** 先頭から maxPages ページで止めたら、その数 (scan の後で決まる) */
  readonly truncatedAt?: number;
  /** 組み直しの回を組むのにかかった時間 (ミリ秒。scan の後で決まる。2 回目からの回でページを領域の木にする時間を含む) */
  readonly layoutMs: number;
  /** 組み直しの回を組み、ページを順に領域の木にして visit に渡す。初めから渡し直すときは、先に restart を呼ぶ */
  scan(visit: (sheet: SheetArea) => void, restart: () => void): void;
  /** 決まった回をもう 1 度組み、ページを順に領域の木にして visit に渡す */
  paint(visit: (sheet: SheetArea) => void): void;
  /** しおり・文書内リンクの飛び先・警告 (paint の後で呼ぶ) */
  finish(): Pick<AreaTree, 'bookmarks' | 'destinations' | 'warnings' | 'diagnostics'>;
}

export interface LayoutStats {
  /** 作った流れ (Flow) の数。本番・計測 (幅を中身で決める箱の最小・最大の幅)・試し組み (keep・段の釣り合わせ) のすべて */
  flows: number;
  /** ブロック (layoutBlock) を組んだ回数 */
  blocks: number;
  /** 表 (layoutTable) を組んだ回数 */
  tables: number;
  /** 幅を中身で決める箱・段組の入れ子の、いちばん深いところ */
  nestMax?: number;
  /** 段組の入れ子の、いちばん深いところ */
  columnNestMax?: number;
  /** 行分けの結果の覚えが、いちばん大きかったときの大きさ (LineMemoLru。上限 LayoutOptions.lineMemoAtoms の効き方を確かめる) と、覚えから使い回した回数 */
  lineMemoPeak?: number;
  lineMemoHits?: number;
  /** 段落の中身で引く覚え (SharedLineMemo) から使い回した回数 */
  sharedLineHits?: number;
  /** ページの境目の数え (続きから組む作り。design/resumable-flow.md の 4.4。写した境目があるときだけ) */
  resume?: ResumeStats;
}

/** ページの境目の数え (LayoutStats.resume) */
export interface ResumeStats {
  /** 写した境目の数 (1 段の page-sequence で、境目を写したもの) */
  boundaries: number;
  /** そのうち、続きから組める境目の数 */
  resumable: number;
  /** 続きから組めない境目の、理由ごとの数 */
  reasons: Record<string, number>;
  /** 続きから組んだ回数 (組版の中で使った分と、resumeCheck の分) */
  resumed: number;
  /** resumeCheck で、続きから組んで同じ境目に来たとき、指紋が初めのときと違った数 (0 でなければ誤り) */
  mismatched: number;
  /** 最後のページのマスター (needsLast) の組み直しを、境目から続けて組んだ数と、初めから組んだ数 */
  lastFromBoundary: number;
  lastFromStart: number;
  /** 上限から遠い所の、最後のページのマスターの組み直しで作り、組む手間の上限の数えから除いた流れの数 (FlowHost.nest.charged) */
  uncounted?: number;
}

/**
 * 試験と道具のための口 (公開しない)。check を真にすると、LayoutOptions.resumeCheck を付けたのと同じになる。
 * 組版の器を作り直さずに、ビルドした layoutEngine.js から切り替える (scripts/check-resume.mjs)
 */
export const resumeProbe: {
  check: boolean;
  /** 試す境目を、境目の前のページの数で限る (違いを探すとき) */
  only?: number;
  /** 組版の中で境目から続けて組まず、初めから組む (続けて組んだときと結果が同じかを比べるとき) */
  fromStart?: boolean;
  /**
   * 遅く戻る試し: 1 段の page-sequence を終わりまで組んだ後、続きから組める境目のうち、この数ほど (散らして選ぶ) を後ろから順に選び、
   * 境目のときの状態に戻して、終わりまで組み直す (組版の中で境目から組み直す使い方と同じ。境目の後で、写しと共有の物を書き換える誤りを探す)。
   * 組み直すたびに、その組み直しの流れが写した次の境目からも、もう 1 度終わりまで組み直す (続けた流れが写す境目の誤りを探す)。
   * 結果は、試しの無いときと同じになるはず。戻って同じ境目に来たときの指紋も比べる (ResumeStats.mismatched)
   */
  late?: number;
  /** 遅く戻る試しで、戻る境目を、境目の前のページの数で限る (違いを探すとき) */
  lateOnly?: number;
  onStats?: (s: ResumeStats) => void;
  /** 前の組版と繋ぐか比べた境目の状態が違ったとき、違った所 (欄の道筋) を知らせる (繋がない訳を探すとき) */
  spliceWhy?: (path: string) => void;
  /**
   * 繋ぐ確かめ: 境目の状態が前の組版と揃っても繋がずに終わりまで組み、繋いだはずの前の組版のページ・ページごとの記録・警告と、
   * 組んだものが、節の番号の対応の下で同じかを知らせる (違えば、比べる状態に漏れがある)。結果は、確かめないときの、繋がない組版と同じ
   */
  spliceVerify?: (r: { same: boolean; at: number; pages: number; prefix?: boolean; why?: string }) => void;
} = { check: false };

/** keep-with-next の試し組みを、次のブロックの最初の行が置かれた時点で打ち切る合図 (Flow.onPlaced が投げる) */
const KEEP_TRIAL_STOP = Symbol('keep-trial-stop');

/** 回り込み (float) の占有領域。b0..b1 は本文領域 (region) 先頭からの block 座標、size は region の端からの inline 方向の占有量 */
interface PlacedFloat {
  /** 置いた順の通し番号 (改ページで float の記録が空になっても、箱の中で置いたものを見分ける) */
  seq?: number;
  /** 段落の最初の字 (initial-letter) の箱。次の段落の最初の字は、この下に置く (CSS Inline 3 §7.9.2) */
  initialLetter?: boolean;
  /** ドロップキャップの字の箱の下端 (adjacent の最後の範囲を、ブロックの終わりで切るときの下限) */
  ilFloor?: number;
  /**
   * XSL-FO のドロップキャップ (axf:initial-letters) を置いたブロックが終わった。後ろのブロックは、前との間に空きがあれば、
   * 字下げせずに字の箱の下へ送る (layoutBlock)
   */
  ilAfter?: boolean;
  side: 'start' | 'end';
  b0: number;
  b1: number;
  size: number;
}

/** 置いた float の索引 (Flow.floatIndex) */
interface FloatIndex {
  arr: PlacedFloat[];
  epoch: number;
  /** 調べ終えた float の数 */
  n: number;
  maxB0: number;
  maxB1: { start: number; end: number };
  live: PlacedFloat[];
  /** 前に除いたときの live の数 */
  kept: number;
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
  /**
   * 前方 float: 内容の末尾の余白 (最後のブロックの space-after)。box と outerB には含めない。前方 float の領域の中で、続く前方 float
   * との間に空ける (XSL 1.1 §4.3.1: 余白は、参照領域の境・枠・パディングの無い所で隣の余白と解決する。float の領域は参照領域ではない
   * ので、続く float の内容の前まで残る)。領域の終わりでは、keepTrail のときだけ残す (アンテナハウス互換。LFloat.keepTrailingSpace)
   */
  trail?: number;
  keepTrail?: boolean;
}

/**
 * 前方 float を前方 float の領域に積むときの、前の float との間 (gap) と、自分の後ろに空ける長さ (tail)。
 * 間は、前の float の内容の末尾の余白 (XSL 1.1 §4.3.1。前の float が自分の後ろに空けた分 (keepTrail) は、もう数えてある)。
 * 後ろは、領域の終わりでも余白を残す (keepTrail。アンテナハウス互換) ときだけ
 */
function beforeFloatSpacing(prev: FloatBox | undefined, f: FloatBox): { gap: number; tail: number } {
  return { gap: prev && !prev.keepTrail ? (prev.trail ?? 0) : 0, tail: f.keepTrail ? (f.trail ?? 0) : 0 };
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
  place(grp: LNode[], forceNewPage?: boolean | BreakKind): void;
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
  /**
   * 次の nextPage が、強制の区切り (break-before・break-after) によるものであることと、その種類を知らせる
   * (表のセルの中の流れ。行を分けた断片を置く側が、その種類の区切り = 白ページ・段かページか、を行う)
   */
  forcedBreak?(kind: BreakKind): void;
  /**
   * 段組の段の流れの中の、ページの区切り (page・odd-page・even-page) を知らせる。ページの区切りは段の区切りも兼ねるので
   * (CSS Fragmentation 3 §4.3)、段の流れは、残りの段を空けて、次のページの最初の段から続ける (左右のページの白ページは、段の行を置く側が挟む)。
   * hasContent はいまの段に何か置いたか。区切る (次の nextPage で段の行を改める) なら true、いまの段が段の行の最初の段で何も無い
   * (もう次のページの最初の段にいる) なら false
   */
  pageBreakInColumns?(kind: BreakKind, hasContent: boolean): boolean;
  /**
   * ページの境目 (いまのページを閉じ、次のページを作る前。Flow.breakPage)。1 段の page-sequence の流れだけが受ける
   * (境目の記録を取る。design/resumable-flow.md の 4.2)
   */
  boundary?(level: 'column' | 'page' | 'blank'): void;
}

/** 段組のページで、脚注・前方 float を「全段を貫く」ページ単位の領域に集めるための窓口 */
interface PageLevelHost {
  pageRootI(): number;
  /** at: 脚注を参照する行 (または行を含む箱) の終わりの位置 (この Flow の段の先頭から) */
  addFootnote(e: FootEntry, at: number): void;
  addBeforeFloat(f: FloatBox): void;
}

interface FlowInit {
  /** 続きの位置を記録する (1 段の page-sequence の流れ。境目で写して、続きから組む。design/resumable-flow.md の 4.2) */
  record?: boolean;
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
  /**
   * ページを持たない Flow の、block 方向に使える長さ (包含ブロックの内容の高さ: 高さを決めたコンテナ・位置と大きさの決まる絶対配置の箱の中)。
   * 中の段組の段が取れる高さの上限にする (columnRoomBound)
   */
  blockRoom?: number;
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
  /**
   * grid の項目の min-content を測る (Flow.gridFloors)。CSS Sizing 3 §5.1 の min-content (折り返しの機会を全部取ったときの幅) に合わせて:
   *  - この流れに直に置く自動レイアウトの表は、置く場所が最小の幅の和より狭くても、列を最小の幅より狭くしない
   *    (表の min-content は列の最小の幅の和: CSS 2.1 §17.5.2.2)
   *  - 分綴の位置 (ソフトハイフン・hyphens: auto) も折り返しの機会に数える (CSS Text 3 §5.4・§5.2: 分綴の位置は折り返しの機会)。
   *    ハイフンを付けた断片が置く場所に収まらなくても、最初の分綴の位置で分ける (Atom.hyphenMin)
   * ふつうの測る組版 (表のセル・flex の項目・XSL-FO の表の自動レイアウト) は、これまでどおり (置く場所に縮めた表の幅を数え、
   * 収まらない分綴の位置では分けない)
   */
  gridItemMin?: boolean;
  /**
   * 画像そのものの flex の項目のセルの中の流れ: 項目の幅が、百分率の max-width (容器の内容の幅で解いたもの) の上限に当たっているか
   * (Flow.flexItemCaps)。false なら、項目の幅は上限より狭い (flex が縮めた) ので、既定のスタイルの max-width が画像を縮めたのではない
   * (percentImage の uaShrunk)。undefined は、その項目のセルでない
   */
  itemAtMaxWidth?: boolean;
  /** 先頭の内容の前の余白 (space-before) を捨てる (表のセルの中) */
  discardLeading?: boolean;
  /**
   * 最初の行の、基線より下の深さの下限 (pt)。HTML のリストの項目の本文のセル: 外側の記号は本文の最初の行の箱に置く (CSS Lists 3 §3.5) ので、
   * 記号の行の基線より下の深さ (記号の字の書体の下の部分と半行間) まで、最初の行の箱を下に伸ばす
   */
  firstLineMinBelow?: number;
  /** 参照領域 (ブロックコンテナ・インラインコンテナ・表のセル) の中身: 閉じるとき、最後の行の下の半行間を line-height.conditionality に従って捨てる */
  referenceArea?: boolean;
  /** 表のセルの中身を組む流れ (layoutCell・splitRow)。この流れの中の表の行だけ、行の高さを覚える (Flow.rowHeightRecord) */
  inCell?: boolean;
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
  /**
   * 表のセルの中の流れ: 中で見つけた、基準の箱 (cbAbs・localAbs) の無い絶対配置の箱 (positionInContainer) を、その場で置かずに
   * foreignAbs に集める (基準の箱はセルか、その外にある。セルを組む側が受け取る)
   */
  collectAbs?: boolean;
  /** 祖先のブロックコンテナを基準にする絶対配置の箱 (positionInContainer) を集める所と、その内容の箱の大きさ */
  localAbs?: {
    list: Array<{ n: LNode; node: LBlockContainer }>;
    w: number;
    h: number | undefined;
    /** 百分率の top・bottom・height (cbPercent) のある箱で、コンテナの高さが中身で決まるもの: コンテナを組み終えてから組む */
    late?: Array<{ node: LBlockContainer; st: ResolvedStyle }>;
  };
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
  /** 本文の領域 (ページの領域) の、用紙の端からの距離 (pt。物理の向き。ページの余白)。LBlockContainer.pageArea の箱を、ページごとに置き直す */
  area?: { top: number; right: number; bottom: number; left: number };
}

/**
 * 基準がページの領域の絶対配置の箱 (LBlockContainer.pageArea) を、置くページの領域 (page.area・page.body) で置き直した節を返す
 * (位置の指定は領域の端からの距離、百分率の top・bottom・height は領域の高さ、百分率の left・right・幅・margin・padding は領域の幅が基準。
 * CSS 2.1 §10.1 の 1・3、CSS Paged Media 3 §3)。領域が分からなければ、読み込みの見積もりのまま
 */
function atPageArea(node: LBlockContainer, page: PageSizeInfo): LBlockContainer {
  const pa = node.pageArea;
  const a = page.area;
  const body = page.body;
  if (!pa || !a || !body) return node;
  const n = withPercent(node, body.width, true, false);
  const H = body.height;
  const out: LBlockContainer = {
    ...n,
    ...(pa.left !== undefined ? { left: a.left + pa.left + (pa.pctLeft ?? 0) * body.width } : {}),
    ...(pa.right !== undefined ? { right: a.right + pa.right + (pa.pctRight ?? 0) * body.width } : {}),
    ...(pa.top !== undefined ? { top: a.top + pa.top + (pa.pctTop ?? 0) * H } : {}),
    ...(pa.bottom !== undefined ? { bottom: a.bottom + pa.bottom + (pa.pctBottom ?? 0) * H } : {}),
    ...(pa.pctHeight !== undefined ? { height: pa.pctHeight * H } : {}),
  };
  copySourceRef(node, out);
  return out;
}

/** 百分率の top・bottom・height のある絶対配置の箱 (基準の箱の高さが決まってから組む) */
const cbPercentB = (node: LBlockContainer) => !!node.cbPercent && (node.cbPercent.top !== undefined || node.cbPercent.bottom !== undefined || node.cbPercent.height !== undefined);

/**
 * 絶対配置の箱の百分率の top・bottom・height (LBlockContainer.cbPercent) を、基準の箱の高さから長さにした節を返す (無ければ元の節)。
 * cbH は、基準の箱の内容の高さ (cbPercent.pad を足して padding の箱の高さにする。CSS 2.1 §10.1 の 4・§10.5、CSS Position 3 §3.1)。
 * top・bottom に入っている長さ (内容の箱からの距離に直した分・margin) に、割合の分を足す
 */
function withCbPercent(node: LBlockContainer, cbH: number, cbW?: number, verticalCb = false): LBlockContainer {
  const p = node.cbPercent;
  // 包含ブロック (位置の基準の箱の padding の箱。CSS 2.1 §10.1 の 4) の幅と高さ
  const W = cbW === undefined ? undefined : Math.max(cbW + (p?.padI ?? 0), 0);
  const H = Math.max(cbH + (p?.pad ?? 0), 0);
  // 百分率の幅・margin・padding (BoxStyle.percent): 基準は包含ブロックの幅。margin・padding は、包含ブロックの inline の大きさ
  // (縦書きの基準の箱では高さ。CSS Writing Modes 4 §7.2)
  if (W !== undefined && node.percent) node = verticalCb ? withPercent(node, H, false, false) : withPercent(node, W, true, false);
  if (!p) return node;
  return {
    ...node,
    // 百分率の left・right (と margin-left・margin-right): 基準は包含ブロックの幅 (CSS Position 3 §3.1・CSS 2.1 §10.3.7・§8.3)
    ...(p.left !== undefined && W !== undefined ? { left: (node.left ?? 0) + p.left * W } : {}),
    ...(p.right !== undefined && W !== undefined ? { right: (node.right ?? 0) + p.right * W } : {}),
    ...(p.top !== undefined ? { top: (node.top ?? 0) + p.top * H } : {}),
    ...(p.bottom !== undefined ? { bottom: (node.bottom ?? 0) + p.bottom * H } : {}),
    ...(p.height !== undefined ? { height: p.height * H } : {}),
  };
}

/**
 * 百分率の幅・上限・下限 (BoxStyle.percent) の箱の内容の幅を、包含ブロックの内容の幅 cb から求める (幅が無ければ auto: 置く場所の幅。
 * 値は box-sizing の箱の長さ。CSS 2.1 §10.2・§10.3.3・§10.4)
 */
function percentContentI(P: NonNullable<BoxStyle['percent']>, cb: number, desc: BoxDesc, borderBox: boolean): number {
  const adj = (v: PercentLength) => Math.max(v.pct * cb + v.len - (borderBox ? desc.bpI : 0), 0);
  let ci = P.width ? adj(P.width) : Math.max(cb - desc.m.is - desc.m.ie - desc.bpI, 0);
  if (P.maxWidth) ci = Math.min(ci, adj(P.maxWidth));
  if (P.minWidth) ci = Math.max(ci, adj(P.minWidth));
  return ci;
}

/** 百分率の寸法を解いた節の写し (同じ基準なら同じ写しを返し、計測の覚えの鍵 (節) を変えない) */
const percentCache = new WeakMap<object, Map<string, object>>();

/**
 * 百分率で指定した寸法 (BoxStyle.percent) を、包含ブロックの inline の大きさ cb (pt) で解いた節の写しを返す (無ければ元の節)。
 * cb が undefined なのは、中身の幅を測る組版で、基準が測る幅によるとき (循環する百分率): 幅は auto、上限は none、下限・margin・
 * padding は百分率の部分を 0 として解く (CSS Sizing 3 §5.2.1)。horizontal は、箱を置く流れが横書きか (width・上限・下限は物理の幅なので、
 * 横書きの流れの中の箱だけで解く。margin・padding は、どの流れでも包含ブロックの inline の大きさが基準: CSS Writing Modes 4 §7.2)。
 * block は、ふつうのブロック (LBlock): 幅の百分率と上限・下限を、estimatedSize (組むときに置く場所の幅を抑える仕組み) に移す
 */
/**
 * 表のセルの百分率の padding (BoxStyle.percent.padding) を、基準 cb (pt) で解いた表の写し (そのセルが無ければ undefined)。
 * 幅の決まらない表 (fitContent) のセルの padding の百分率の基準は、表の幅 (tableColumnWidths)
 */
function cellPercentPadding(node: LTable, cb: number): LTable | undefined {
  let hit = false;
  const mapRows = (rows: LTableRow[]) =>
    rows.map((r) => {
      if (!r.cells.some((c) => c.percent?.padding)) return r;
      hit = true;
      return withRef(r, {
        ...r,
        cells: r.cells.map((c) => {
          const P = c.percent?.padding;
          if (!P) return c;
          const pad = normEdges(c.padding);
          for (const sd of ['top', 'right', 'bottom', 'left'] as const) if (P[sd]) pad[sd] = Math.max(P[sd]!.pct * cb + P[sd]!.len, 0);
          return withRef(c, { ...c, padding: pad });
        }),
      });
    });
  const out: LTable = { ...node, body: { ...node.body, rows: mapRows(node.body.rows) } };
  if (node.header) out.header = { ...node.header, rows: mapRows(node.header.rows) };
  if (node.footer) out.footer = { ...node.footer, rows: mapRows(node.footer.rows) };
  return hit ? withRef(node, out) : undefined;
}

function withPercent<T extends BoxStyle>(node: T, cb: number | undefined, horizontal: boolean, block: boolean): T {
  const P = node.percent;
  if (!P) return node;
  const key = `${cb ?? 'i'}|${horizontal ? 1 : 0}`;
  let m = percentCache.get(node);
  const hit = m?.get(key);
  if (hit) return hit as T;
  const res = (v: PercentLength, nonNeg: boolean) => {
    const x = v.pct * (cb ?? 0) + v.len;
    return nonNeg ? Math.max(x, 0) : x;
  };
  const out: T = { ...node };
  // 写した節にも、元の節の番号を引き継ぐ (描くときだけの効果などを、元の要素の箱に付けるため)
  copySourceRef(node, out);
  for (const k of ['margin', 'padding'] as const) {
    const e = P[k];
    if (!e) continue;
    const base = normEdges(node[k]);
    for (const sd of ['top', 'right', 'bottom', 'left'] as const) if (e[sd]) base[sd] = res(e[sd]!, k === 'padding');
    out[k] = base;
  }
  if (horizontal && (P.width || P.maxWidth || P.minWidth)) {
    const lenOnly = (v: PercentLength | undefined) => (v && (cb !== undefined || v.pct === 0) ? res(v, true) : undefined);
    const mx = lenOnly(P.maxWidth);
    const mn = lenOnly(P.minWidth);
    const est = { ...(mx !== undefined ? { max: mx } : {}), ...(mn !== undefined ? { min: mn } : {}) };
    const restEst = () => {
      const { width: _w, ...r } = node.estimatedSize ?? {};
      return Object.keys(r).length ? r : undefined;
    };
    if (P.width && cb !== undefined) {
      // 幅を解いて、同じ box-sizing の上限・下限で抑える (下限が勝つ。CSS 2.1 §10.4)
      let w = res(P.width, true);
      if (mx !== undefined) w = Math.min(w, mx);
      if (mn !== undefined) w = Math.max(w, mn);
      out.width = w;
      const r = restEst();
      if (r) out.estimatedSize = r;
      else delete out.estimatedSize;
    } else if (P.width && !block) {
      // 測る組版の、ふつうのブロックでない箱 (表・float など): 百分率の幅は auto (幅の指定のある自動レイアウトの表は、幅が auto の
      // 表と同じく、列の幅を中身に合わせる)
      delete out.width;
      const t = out as { fillContent?: boolean; fitContent?: boolean };
      if (t.fillContent) {
        delete t.fillContent;
        t.fitContent = true;
      }
    } else if (block && (P.width || mx !== undefined || mn !== undefined)) {
      // ふつうのブロック: 百分率の幅 (測る組版) と auto の幅は、置く場所の幅を上限・下限で抑えた幅 (estimatedSize。layoutBlock が扱う)
      out.estimatedSize = { ...node.estimatedSize, width: P.width ? est : { auto: true, ...est } };
      out.width ??= cb ?? 0;
    } else if (block && !P.width && node.estimatedSize?.width?.auto) {
      // 上限・下限がどれも百分率で、測る組版 (none・0): auto の幅
      delete out.width;
      const r = restEst();
      if (r) out.estimatedSize = r;
      else delete out.estimatedSize;
    }
  }
  if (!m) percentCache.set(node, (m = new Map()));
  m.set(key, out);
  return out;
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

/**
 * ページの境目の写しの、欄の値の写し (Flow.captureBoundary・resumeFrom)。配列・Set・Map は 1 段だけ写す (後で中身を足し引きされるので)。
 * ほかの物 (入力の節・書式・組んだ箱など) は、そのまま持つ (境目の後で書き換えないもの)
 */
function copyField(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Set) return new Set(v);
  if (v instanceof Map) return new Map(v);
  return v;
}

/**
 * 送った float (Flow.deferredFloats) の写し。まだ置いていない箱は、次のページで置くときに位置 (i・b・float) を書くので、
 * 箱 (外側の節だけ) も写す (境目の写しが、境目の後で置いた位置に書き換わらないように。design/resumable-flow.md の 18.4)
 */
function copyDeferredFloats(list: readonly FloatBox[]): FloatBox[] {
  return list.map((f) => ({ ...f, box: { ...f.box } }));
}

/**
 * 続きの位置の鎖の写し (境目の後で、段の欄と、子の並びの段が持つ行の並び (run) に足すので)。行の並びを組んでいる段 (phase が run) の
 * 次の段 (行の並び) は、写した並びを指す (layoutInlineRun が、受けた並びと段の並びが同じかを見る)。block は、ブロックの段の写し方
 */
function copySteps(steps: readonly ResumeStep[], block: (st: BlockStep) => BlockStep, table: (ctx: TableCtx) => TableCtx): ResumeStep[] {
  const out: ResumeStep[] = [];
  for (const st of steps) {
    if (st.k === 'children') out.push({ ...st, run: st.run.slice() });
    else if (st.k === 'table') out.push({ ...st, ...(st.ctx ? { ctx: table(st.ctx) } : {}), ...(st.rs ? { rs: { ...st.rs, pending: st.rs.pending.slice(), held: st.rs.held.slice() } } : {}) });
    else if (st.k === 'inline') {
      const prev = out[out.length - 1];
      out.push({ ...st, ...(prev?.k === 'children' && prev.phase === 'run' ? { src: prev.run } : {}) });
    } else if (st.k === 'block' && st.ctx) out.push(block(st));
    else out.push({ ...st });
  }
  return out;
}

/**
 * 開いている箱の写し (境目の後で、欄を書き換えるので)。まだ開いていない箱 (opened が偽) の節は、境目の後で開いてページに置き、中身を足すので、
 * 節も写す (開いた箱の節は、閉じた前のページの断片で、続きのページでは openPage が新しい節を作る)
 */
function copyFrame(f: Frame): Frame {
  return { ...f, ...(f.frags ? { frags: f.frags.slice() } : {}), ...(f.opened ? {} : { node: { ...f.node, children: f.node.children.slice() } }) };
}

/**
 * ページの境目の指紋 (design/resumable-flow.md の 5.3): 写した欄と続きの位置から作る短い字。同じ文書を同じに組めば、同じ境目で同じになる。
 * 組んだ箱 (LNode) は、入力の節の番号と大きさだけを入れる
 */
function boundaryDigest(b: FlowBoundary, extra: ReadonlyArray<unknown>): string {
  const out: unknown[] = [b.level, ...extra];
  const val = (v: unknown, deep: boolean): unknown => {
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v !== 'object') return typeof v;
    const r = sourceRef(v);
    if (r !== undefined) return `#${r}`;
    if (Array.isArray(v)) return deep ? v.map((x) => val(x, false)) : `[${v.length}]`;
    if (v instanceof Set || v instanceof Map) return `{${v.size}}`;
    const o = v as { height?: unknown; node?: { ref?: unknown; bsize?: unknown }; ref?: unknown; bsize?: unknown };
    if (typeof o.height === 'number' && o.node) return ['e', o.height, o.node.ref];
    if (typeof o.bsize === 'number') return ['n', o.ref, o.bsize];
    return '*';
  };
  for (const k of Object.keys(b.fields).sort()) {
    if (k === 'stack') continue;
    out.push(k, val(b.fields[k], true));
  }
  for (const f of b.fields.stack as Frame[]) out.push(['f', f.desc.ref, f.opened, f.usedB, f.contentI, f.startB, f.contentStartB, f.node.kind]);
  for (const st of b.steps) {
    if (st.k === 'children') out.push(['c', st.phase, st.at, st.runAt, st.firstRun, st.topAt, st.topPage, sourceRef(st.children[st.at]) ?? -1]);
    else if (st.k === 'block') out.push(['b', st.phase, sourceRef(st.orig) ?? -1]);
    else if (st.k === 'inline') out.push(['i', st.phase, st.idx, st.ctx?.pls.length ?? -1]);
    else if (st.k === 'table') out.push(['t', st.phase, sourceRef(st.orig) ?? -1, st.rs?.site, st.rs?.i, st.rs?.k, st.rs?.pending.length]);
    else out.push(['f', st.phase, st.kind]);
  }
  // FNV-1a (32 ビット) を 2 つ (種を変えて) 並べる
  const text = JSON.stringify(out);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** 支柱だけの箱 (LBlock.phantom) の中身の節 → 測った block の大きさ (同じ行の支柱どうしで使い回す) */
const phantomSizes = new WeakMap<object, number>();

class Flow {
  /** まだ何も置いていない先頭の余白を捨てるか (FlowInit.discardLeading) */
  private discardLeading: boolean;
  private referenceArea: boolean;
  private inCell: boolean;
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
  /** 行の途中で見つけた絶対配置の箱を組む間の、見つけた所の目印の番号 (CbItem.staticKey) */
  private staticKey?: number;
  /**
   * いま組む行の並びの中の、書いた所に目印 (LInline.floatAnchor) のある CSS の float (目印の番号 → float と包むブロックの書式)。
   * 行の並び (layoutChildren の run) を組む間だけ置き、目印を含む行を組むときに置いて除く (layoutInlineRunFloating の placeLineFloats)
   */
  private lineFloats?: Map<number, { node: LFloat; st: ResolvedStyle }>;
  /**
   * いま組む行の並びの中の、ページを基準にする絶対配置の箱 (位置の決まった祖先の無い CSS の箱) で、見つけた所に目印 (LInline.staticAnchor)
   * を置いたもの (目印の番号 → 箱と包むブロックの書式)。目印を含む行を置いたときに、その位置を static position にして置く (placeLine)
   */
  private lineAbs?: Map<number, { node: LBlockContainer; st: ResolvedStyle }>;
  /** この流れ (表のセルの中) で見つけた、基準の箱がこの流れの外にある絶対配置の箱 (FlowInit.collectAbs) */
  private collectAbs: boolean;
  foreignAbs: CbItem[] = [];
  /** 基準になるセル (LTableCell.containingBlock) の箱 → 中で見つけた絶対配置の箱 (行の高さが決まってから置く) */
  private cellAbs = new WeakMap<LNode, CbItem[]>();
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
   * 試し組みの Flow に渡す、絶対配置の箱の置き場: 試し組みが置いた箱は捨てる (段の高さを変えて組み直すたびに、ページの置き場に箱を積むと、
   * 本番の組みの箱と合わせて、同じ箱が何度も描かれる。XSL 1.1 §7.6.1: 絶対配置の FO が作る領域は 1 つ)。箱は、本番の組みが置く。
   * 試し組みが箱を置いたことは、従来どおり数える (その試し組みの結果は覚えない。FlowHost.volatile)
   */
  private trialAbs = (): LNode[] => {
    if (this.host.volatile) this.host.volatile.n++;
    return [];
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
  private tableBreak?: TableBreakLines;
  /** 組んでいる表の、外へ出す末尾の余白 (LTableCell.trailingSpaceOut。リストの最後の項目) */
  private tableTrailOut?: number;
  /** layoutCell が、セルの中の絶対配置の箱を外へ渡した回数 (rowHeightRecord が、組みが跡を残したかを見る) */
  private absHanded = 0;
  /** 組んだ行のセルの、占める列 (c から cs 列) と、改ページの境目で使う前側・後ろ側の線 (LTableCell.breakEdges) */
  private cellCols = new WeakMap<LNode, { c: number; cs: number; before?: BorderSide; after?: BorderSide }>();
  private intrinsic: boolean;
  private minContent: boolean;
  /** grid の項目の min-content を測る (FlowInit.gridItemMin) */
  private gridItemMin: boolean;
  /** 画像そのものの flex の項目のセルの中の流れで、項目の幅が百分率の max-width の上限に当たっているか (FlowInit.itemAtMaxWidth) */
  private itemAtMaxWidth: boolean | undefined;
  /**
   * 画像そのものの flex の項目のセル → 百分率の max-width を、組むときの容器の内容の幅で解いた、項目の外側の幅の上限 (fitContentColumns が控え、
   * セルを組むときに、セルの幅と比べて FlowInit.itemAtMaxWidth にする)
   */
  private flexItemCaps = new WeakMap<LTableCell, number>();
  /** 現ページの脚注領域 */
  private footnotes: FootEntry[] = [];
  private footReserve = 0;
  /** 次ページへ続く脚注 (長すぎて分割した残り) */
  private carry: FootEntry[] = [];
  /** いまのページは、本文の終わりの後に、脚注の続きのために足した、脚注だけのページ (finishPaginated) */
  private footnoteOnlyPage = false;
  /** 現ページの回り込み・ページ先頭の float */
  private floats: PlacedFloat[] = [];
  /** 次の行内の並びの、最初の行の字下げを掛けない (段落の最初の字 (initial-letter) の箱に移した) */
  private skipIndent = false;
  private floatSeq = 0;
  private beforeNodes = new Set<LNode>();
  private beforeUsed = 0;
  /** このページ (段) に最後に置いた前方 float (続く前方 float との間の余白に使う) */
  private beforeLast?: FloatBox;
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
  /** ページを持たない Flow の、block 方向に使える長さ (FlowInit.blockRoom) */
  private blockRoom?: number;
  /** いま中身を組んでいる箱 (診断の場所。行の警告に使う) */
  private blockAt?: object;
  /** afterAt の末尾に積んだ float の範囲 (本文が避ける回り込みの範囲) */
  private afterBand?: PlacedFloat;
  private afterEnd = 0;
  /** afterBelowContent で下端の float を置いたか */
  afterBelowUsed = false;
  /** 空のページ (段) で、widows / orphans を守れずに段落を分けたか */
  brokeKeep = false;
  /**
   * 分けない指定 (keep-together。CSS の break-inside: avoid) のブロックを、いまのページ (段) にも次のページ (段) にも収められずに、分けて置いた数
   * (段組の釣り合わせで、その高さを収まるとみなさない: XSL 1.1 §7.20.3 の keep-together.within-column は、ブロックの領域を 1 つの段に収める。
   * 釣り合わせで段を低くして分けるのは、避けられる区切り)
   */
  splitKeepTogether = 0;
  /** 空のページ (段) の先頭でも入らない行 (CSS では箱も) を、はみ出させて置いた (段組の釣り合わせで、その高さを収まるとみなさない) */
  overflowedLine = false;
  /**
   * 空のページ (段) の先頭でも入らずに、はみ出させて置いた行・箱の数 (XSL-FO の箱も数える)。ページをまたぐ段組の最後のページの段を
   * 釣り合わせるとき (layoutColumnPass)、段の高さを限らない試し組みより多ければ、その高さを収まるとみなさない
   */
  overflowCount = 0;
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
   * 外へ出る半分: 表の箱の端は罫線の中央にあり、外の半分は余白の領域に重なる (CSS2 §17.6.2: 外側の 2 本の罫線の
   * 残りの半分は、余白の領域にある)。余白が半分より小さくても、表の箱の位置は変わらない (罫線の外の半分が、前後の内容の側へ出る)
   */
  private pendSpill = 0;
  /** 挿入点の直上にある「空き」(前行の下側ハーフレディング + 保留マージン)。ルビの張り出しに使う */
  private adjacent = 0;
  private pageHasContent = false;
  /** いま置くブロックが、前のブロックとつなげる指定 (前の keep-with-next・自分の keep-with-previous) を持つか (layoutChildren が決める) */
  private chainedToPrev = false;
  /** ページ (段) を改めるたびに増やす番号 (同じページの上か、を見分ける) */
  private pageSerial = 0;
  /** keepOverflow のブロックを、改ページせずに置く (holdKeepTogether が立てる。keepTogetherCheck は改ページしない) */
  private keepHold = false;
  private pageItems = 0;
  private headerOnly = false;
  private breakNext: BreakKind | null = null;
  /** 続きの位置の記録 (FlowInit.record。外から順。design/resumable-flow.md の 2.2) */
  private rs?: ResumeStep[];
  /** 続きから組むときの、続きの位置と、境目の改ページの種類 (resumeFrom が置き、続きの所で openPage したら外す) */
  private resume?: { steps: ResumeStep[]; at: number; level: 'column' | 'page' | 'blank' };
  /** layoutBlockLevel が、ブロックコンテナのために積んだブロックの段と、そのコンテナ (layoutContainerIn がブロックとして組むときに使う) */
  private boxStep?: { step: BlockStep; via: LBlockContainer };

  constructor(private host: FlowHost, init: FlowInit) {
    if (host.stats) host.stats.flows++;
    if (init.record) this.rs = [];
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
    this.blockRoom = init.blockRoom;
    this.discardEndMargin = !!init.discardEndMargin;
    this.beforeSep = init.beforeSep;
    this.pageLevel = init.pageLevel;
    this.measureOnly = !!init.measure;
    this.discardLeading = !!init.discardLeading;
    this.firstLineMinBelow = init.firstLineMinBelow;
    this.referenceArea = !!init.referenceArea;
    this.inCell = !!init.inCell;
    this.intrinsic = !!init.intrinsic;
    this.minContent = !!init.minContent;
    this.gridItemMin = !!init.gridItemMin;
    this.itemAtMaxWidth = init.itemAtMaxWidth;
    this.discardAfterForced = !!(init.discardAfterForced ?? init.discardLeading);
    this.spanAreas = !!init.spanAreas;
    this.areaEnd = !!init.areaEnd;
    if (init.initialSpace) this.pendAdjust = -init.initialSpace;
    this.localAbs = init.localAbs;
    // XSL-FO の絶対配置の箱 (祖先の参照領域が基準) は、これまでどおりその場で置く
    this.collectAbs = !!init.collectAbs && !host.xslSpace;
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

  /**
   * 次のページ (段) の block 方向の上限。ページの流れでは、いまのページの上限と同じ。セルの中の流れ (リストの項目の本文など。splitRow) では、
   * 最初の断片の上限 (外側の行を置くページの残り) と、続きの断片の上限 (次のページで使える高さ) が違うので、pages.nextLimit を使う。
   * 入れ子の表の行をページで分けるとき、続きの断片の高さを、いまのページの残りで出すと、続きの断片が、どれもその残りの高さで切られ、
   * 断片ごとに改ページして、数行だけのページが続く (XSL 1.1 §6.8・§6.7 のリストと表の行は、ページの上限まで中身を置いて分ける。
   * CSS 2.1 §13.3.3 の区切ってよい所のうち、§13.3.5 のとおり、ページに入る最後の所で改ページする)
   */
  private get nextLimit() {
    return this.pages?.nextLimit?.() ?? this.limit;
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

  /**
   * 脚注 entries を積むと増える脚注の領域の高さ。reserve は積む前の脚注の領域の高さ (既定は今の高さ)。
   * 脚注の領域に高さの上限 (maxHeight) があれば、上限を超える分は数えない (超える分は次のページへ送るので、参照の行は置ける)
   */
  private footCost(entries: FootEntry[], existing: number, reserve = this.footReserve, uncapped = false, last?: FootEntry | null): number {
    if (this.pageLevel) return 0;
    let r = 0;
    let prev: FootEntry | undefined = existing > 0 ? this.footnotes[existing - 1] : undefined;
    // 行内に並べる脚注をつなぐ相手: last (行の見積もりで、前の行の脚注まで積んだと見なした最後の脚注。null は無し)。省略なら prev
    let joinTo: FootEntry | undefined = last !== undefined ? (last ?? undefined) : prev;
    for (const e of entries) {
      // 行内に並べる脚注は、前の脚注の段落に続けて組む (増えるのは、つないだ段落の高さとの差。pushFootnote と同じ)
      const j = this.foot!.join(joinTo, e);
      if (j) {
        r += j.height - joinTo!.height;
        prev = joinTo = j;
        continue;
      }
      r += this.foot!.gapAfter(prev) + e.height;
      prev = joinTo = e;
    }
    const max = this.foot!.maxHeight;
    if (max === undefined || uncapped) return r;
    // 既に次のページへ送った脚注があれば、後の脚注もこのページに積まない (pushFootnote) ので、数えない
    return this.carry.length ? 0 : Math.min(r, Math.max(0, max - reserve));
  }

  /** 脚注を現ページの脚注領域へ積む。収まらなければ行単位で分割し、残りを次ページへ続ける */
  private pushFootnote(e: FootEntry, cap = Infinity) {
    if (this.pageLevel) {
      this.pageLevel.addFootnote(e, this.cursor);
      return;
    }
    // 脚注の領域の高さの上限 (GCPM 3 §2.4.2 の max-height)。脚注だけのページでは当てない (§2.4.2: 上限は、ページに脚注しか無いとき
    // (文書の最後のページなど) を除いて脚注の領域を限る)。順の決まり (下) と、丸ごと送る決まりは、上限を書いた文書なら、脚注だけのページでも同じ
    const maxSet = this.foot!.maxHeight;
    const max = this.footnoteOnlyPage ? undefined : maxSet;
    // 上限があって、このページで既に次のページへ送った脚注 (分けた残り・丸ごと送ったもの) があれば、後の脚注も積まずに順に送る。
    // 脚注の領域には文書の順に置き (GCPM 3 §2.2)、本文は参照より後のページへ送ってよい (§2.8) ので、後の脚注の頭を先のページに置かない
    // (前は、丸ごと送った脚注の後の脚注を分けて、このページに頭を置き、番号が 1, 4, 2, 3 と並んだ)。
    // 前のページからの続きは、ページの初めに carry を空にしてから積み直すので、ここで carry にあるのは、このページで送ったものだけ
    if (maxSet !== undefined && this.carry.length) {
      this.carry.push(e);
      return;
    }
    const first = this.footnotes.length === 0;
    // 行内に並べる脚注 (CSS GCPM 3 §2.3 の footnote-display: inline・compact、axf:footnote-stacking="inline"): 前の脚注の段落に続けて組み、
    // 前の脚注の代わりに置く。入らなければ、つないだ段落を行で分け、残りを次のページへ続ける (分けた頭が前の脚注より低くなるとき
    // (前の脚注の行を次のページへ送ることになるとき) は、つながずに、下のブロックの置き方で置く)
    const last = first ? undefined : this.footnotes[this.footnotes.length - 1];
    const joined = this.foot!.join(last, e);
    if (joined) {
      const base = this.footReserve - last!.height;
      const room = Math.min(this.limit - this.cursor - base, cap - base, max === undefined ? Infinity : max - base);
      if (joined.height <= room + EPS) {
        this.footnotes[this.footnotes.length - 1] = joined;
        this.footReserve = base + joined.height;
        return;
      }
      const sp = splitEntry(joined, room);
      if (sp && sp.head.height + EPS >= last!.height) {
        this.footnotes[this.footnotes.length - 1] = sp.head;
        this.footReserve = base + sp.head.height;
        this.carry.push(sp.rest);
        return;
      }
    }
    const lead = this.foot!.gapAfter(last);
    const free = Math.min(this.limit - this.cursor - this.footReserve, cap - this.footReserve, max === undefined ? Infinity : max - this.footReserve);
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
    } else if (maxSet !== undefined && !first && (max === undefined || max - this.footReserve < this.limit - this.cursor - this.footReserve)) {
      // 上限で入らない脚注 (分けられないもの) は、丸ごと次のページへ送る
      this.carry.push(e);
    } else {
      this.host.warn(withSource(diag('layout/footnote-overflow', msg('脚注がページに収まらないため溢れます', 'a footnote does not fit on the page and overflows')), e.node));
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
    const x = this.floatIndex();
    return side === 'both' ? Math.max(x.maxB1.start, x.maxB1.end) : x.maxB1[side];
  }

  /** this.floats の b0・b1 を書き換えたら増やす (floatIndex を作り直させる) */
  private floatEpoch = 0;
  private floatIdx?: FloatIndex;
  /**
   * 置いた float の索引: b0 の最大、側ごとの b1 の最大、CSS の置き方で候補になりうる float (live)。置くたびに増えた分だけ足す。
   * float を置くたびに全部の float を調べ直すと、float の数の 2 乗の手間になり、「span { float: left; width: 7px; height: 9px }」4 万個 (583KB) で
   * 67 秒かかった。値は、全部を調べたときと同じ (置く位置は変わらない)
   */
  private floatIndex(): FloatIndex {
    let x = this.floatIdx;
    if (!x || x.arr !== this.floats || x.epoch !== this.floatEpoch || x.n > this.floats.length) {
      x = this.floatIdx = { arr: this.floats, epoch: this.floatEpoch, n: 0, maxB0: -Infinity, maxB1: { start: 0, end: 0 }, live: [], kept: 0 };
    }
    for (; x.n < this.floats.length; x.n++) {
      const p = this.floats[x.n];
      x.maxB0 = Math.max(x.maxB0, p.b0);
      x.maxB1[p.side] = Math.max(x.maxB1[p.side], p.b1);
      x.live.push(p);
    }
    // CSS の置き方 (anchorFloat の cb) では、新しい float の上端は b0 の最大より上にならない (CSS 2.1 §9.5.1 の規則 5) ので、
    // 下端がそれより上の float は、この索引の続くかぎり候補にならない。数が倍になるたびに除く (除く手間を、置く数にならす)
    if (x.live.length > 2 * x.kept + 64) {
      const y = x.maxB0;
      x.live = x.live.filter((p) => !(p.b1 <= y + EPS));
      x.kept = x.live.length;
    }
    return x;
  }

  /**
   * float を組んで置く。fits があれば、置く前に float の外側の大きさ (行の向き) で入るかを尋ね、入らなければ置かずに、組んだ箱を返す
   * (呼ぶ側が後で anchorFloat で置く。行の中に書いた float を、行の後に置くとき: placeLineFloats)
   */
  private placeFloat(node: LFloat, ps: ResolvedStyle, fits?: (outerI: number) => boolean): FloatBox | undefined {
    return this.nested(() => this.placeFloatIn(node, ps, fits));
  }

  private placeFloatIn(node: LFloat, ps: ResolvedStyle, fits?: (outerI: number) => boolean): FloatBox | undefined {
    // 百分率の寸法は、いまの箱 (包含ブロック) の内容の幅で解く (CSS 2.1 §10.1・§10.2)。幅が auto の float の、百分率の上限・下限
    // (LFloat.maxWidth・minWidth は内容の幅) も、同じ基準で解き直す (§10.4)
    if (node.percent) {
      const P = node.percent;
      const cb = this.percentBase();
      node = this.resolvePercent(node, false);
      if (!P.width && this.wm === 'horizontal-tb' && (P.maxWidth?.pct || P.minWidth?.pct)) {
        const d = describeBox(node, this.wm);
        const inner = (v: PercentLength) => Math.max(v.pct * (cb ?? 0) + v.len - (node.boxSizing === 'border-box' ? d.bpI : 0), 0);
        const lim: LFloat = {
          ...node,
          ...(P.maxWidth?.pct ? (cb === undefined ? { maxWidth: undefined } : { maxWidth: inner(P.maxWidth) }) : {}),
          ...(P.minWidth?.pct ? { minWidth: inner(P.minWidth) } : {}),
        };
        copySourceRef(node, lim);
        node = lim;
      }
    }
    const st = resolveStyle(ps, node);
    const ortho = st.wm !== this.wm && (st.wm === 'horizontal-tb') !== (this.wm === 'horizontal-tb');
    if (node.marginal && node.float !== 'before' && !ortho) {
      this.placeMarginal(node, st);
      return undefined;
    }
    const original = node;
    if (node.float === 'inside' || node.float === 'outside') {
      // 綴じ側・小口側は、組むページの偶奇 (左右。sideNumber) で start / end に読み替える
      const even = (this.sideNumber() ?? 1) % 2 === 0;
      // 綴じ側は、左から右へ進む本では、奇数ページ (右ページ) で左、偶数ページで右。右から左へ進む本 (LDocument.rtlPageProgression。
      // 縦書きの本) では逆で、奇数ページ (左ページ) で右 (CSS Paged Media 3 §3.3)。縦書きでは左右は block 方向なので、段の先頭・末尾の
      // float にする (vertical-rl は右が block-start: 右から左へ進む本の奇数ページの float: inside は箱の右端、outside は左端に置く)。
      // 前は、右から左へ進む本でも奇数ページの綴じ側を左にしていたので、inside が小口側に出た
      const left = ((node.float === 'inside') !== even) !== !!this.host.rtlPages;
      const side = this.wm === 'horizontal-tb' ? (left ? 'start' : 'end') : (left === (this.wm === 'vertical-lr')) ? 'before' : 'after';
      node = withRef(node, { ...node, float: side });
    } else if (node.float === 'alternate') {
      // 最初の段では end、ほかの段では start (段の間に寄せる)
      node = withRef(node, { ...node, float: (this.pages?.columnIndex?.() ?? 0) === 0 ? 'end' : 'start' });
    }
    // 段落の最初の字 (initial-letter。CSS Inline 3 §7): 字の大きさと箱の大きさを、行の数と書体の値から決めて、回り込みの箱として置く
    // (XSL-FO のアンテナハウスの拡張 axf:initial-letters も、同じ受け皿で組む)
    const ilSpec = node.initialLetter;
    const il = ilSpec && !ortho ? this.initialLetterBox(node, st) : undefined;
    if (il) {
      node = il.node;
      // 前の段落の最初の字の箱が残っていれば、その下に置く (§7.9.2: 最初の字で始まるブロックは、前のブロックの最初の字を避ける)
      const prev = this.floats.filter((p) => p.initialLetter).reduce((a, p) => Math.max(a, p.b1), 0);
      // (頭字の箱・行と同じく、領域の頭で捨てる余白は数えない: flushValue)
      if (prev > this.cursor + this.flushValue()) this.pendMin = Math.max(this.pendMin, prev - this.cursor);
      // 字の箱がページ・段の残りに入らなければ、先に次へ送る (字だけを次のページへ送らない)
      if (this.paginating && this.pageHasContent && this.cursor + this.pendingValue() + il.outerB + this.footReserve > this.room + EPS) this.breakPage();
    }
    const desc = describeBox(node, this.wm);
    const horizontal = this.wm === 'horizontal-tb';
    const src: LBlockContainer = withRef(node, { ...node, type: 'block-container', absolutePosition: false });
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
          if (!this.simplified()) len = this.fitContent(len, (rootI, min) => this.intrinsicWidth(node.children, st, rootI, min));
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
      // 最小の内容の幅は、min-content を測る印を付けて測る (リスト・flex の 1 行の表は、印で本文・項目の min-content と max-content を選ぶ)
      const availC = Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0);
      const widthAt = (rootI: number, min = false) => this.intrinsicWidth(node.children, st, rootI, min);
      let content = availC;
      if (!this.simplified()) {
        const pref = widthAt(Math.max(availC, 1) * 100);
        const minC = pref <= availC ? pref : widthAt(1, true);
        content = Math.min(Math.max(minC, availC), pref);
      }
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
      if (!fullWidth && !this.simplified()) {
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
    // float の内容の末尾の space-after は、float の箱には含めない (start・end の float では、回り込みの範囲の端なので捨てる)。
    // 前方 float では、続く前方 float との間に空ける (FloatBox.trail)
    const trailing = { after: 0 };
    const box = this.buildContainer(src, st, undefined, undefined, true, trailing);
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
    const fb: FloatBox = {
      box,
      side: node.float as 'start' | 'end' | 'before' | 'after' | 'center',
      outerI: inl + desc.m.is + desc.m.ie,
      outerB: blk + desc.m.bs + desc.m.be,
      m: desc.m,
      // 箱の末尾に枠・パディング・margin があれば、余白は箱の中で終わる (続く float の余白と隣り合わない)
      ...(node.float === 'before' && trailing.after > EPS && desc.bpEnd <= EPS && desc.m.be <= EPS ? { trail: trailing.after, ...(node.keepTrailingSpace ? { keepTrail: true } : {}) } : {}),
      ...(original.float === 'inside' || original.float === 'outside' || original.float === 'alternate' ? { redo: { node: original, st: ps } } : {}),
      ...(node.cssPlacement && (node.float === 'start' || node.float === 'end') ? { cb: { off: this.contentIOffset(), width: this.contentI() } } : {}),
      // XSL-FO の start・end の float も、包含ブロック (アンカーのあるブロック) の内容の端に寄せる (XSL 1.1 §6.12.2 は CSS 2.1 §9.5 の規則を使う)
      ...(!node.cssPlacement && (node.float === 'start' || node.float === 'end') ? { edge: { off: this.contentIOffset(), width: this.contentI() } } : {}),
      ...(node.cssPlacement && node.clear ? { clear: node.clear } : {}),
    };
    if (fits && !il && !fits(fb.outerI)) return fb;
    this.anchorFloat(fb);
    if (il) {
      const placed = this.floats[this.floats.length - 1];
      if (placed && placed.b1 - placed.b0 > EPS) {
        placed.initialLetter = true;
        // 字が最初の行より上へ突き出す分 (沈める行の数より大きい字) と、箱の上の余白・枠の分だけ、最初の行を下げる
        // (§7.6.1: 字の箱の上端は、包含ブロックの内容の上端より下。最初の行とその後の内容を、その分だけ先へ送る)
        if (il.raise > EPS) this.pendMin = Math.max(this.pendMin, placed.b0 + il.raise - this.cursor);
        // 最初の行の字下げは、字の箱ごと行を下げる (§7.8.2)。字の箱の余白に移したので、続く行内の並びには掛けない
        if (il.indent) this.skipIndent = true;
        const parts = (ilSpec?.endIndent || ilSpec?.adjacent ? this.initialLetterBands(placed, ilSpec, il) : undefined) ?? [placed];
        // XSL-FO のドロップキャップ: 置いたブロックの終わりで、後ろのブロックの扱いの印を付ける (closeFrame)
        const fr = this.host.xslSpace ? this.top() : undefined;
        if (fr) (fr.ilFloats ??= []).push(...parts);
      }
    }
  }

  /**
   * XSL-FO のドロップキャップ (axf:initial-letters) の、行ごとの回り込みの範囲: 字の箱の範囲を、最初の行から 1 行ずつの範囲に分けて、
   * 行ごとの後ろの空き (axf:initial-letters-end-indent。最後の値はその後の行にも) を足す。adjacent・<integer2> は、字の箱の下の行も、
   * 字の箱の幅だけ字下げする (adjacent はブロックの終わりまで: closeFrame で、ブロックの終わりの位置で切る)。
   * 行の高さは、ドロップキャップの字の大きさを決めた行の高さのまま変わらないとみなす (製品の公開の説明の字の大きさの決め方も、行ごとに高さの
   * 変わる組みを考えに入れていない)
   */
  private initialLetterBands(placed: PlacedFloat, spec: NonNullable<LFloat['initialLetter']>, il: { raise: number; F: number; LH: number }): PlacedFloat[] | undefined {
    const { F, LH } = il;
    const first = placed.b0 + il.raise;
    const ends = (spec.endIndent ?? [{ pt: 0, dcem: 0 }]).map((e) => e.pt + e.dcem * F);
    const extra = spec.adjacent === Infinity ? 1e9 : (spec.adjacent ?? 0) * LH;
    const bottom = placed.b1 + extra;
    const bands: PlacedFloat[] = [];
    let y = placed.b0;
    for (let k = 0; y < bottom - EPS && k < 1000; k++) {
      const y1 = k === ends.length - 1 || ends.length === 1 ? bottom : Math.min(first + (k + 1) * LH, bottom);
      const e = ends[Math.min(k, ends.length - 1)];
      bands.push({ ...placed, b0: y, b1: y1, size: Math.max(placed.size + e, 0) });
      y = y1;
    }
    const at = this.floats.indexOf(placed);
    if (at < 0 || !bands.length) return undefined;
    this.floats.splice(at, 1, ...bands);
    this.floatEpoch++;
    // adjacent: 字の箱を置いたブロックの終わりで、最後の範囲を切る。ブロックが字の箱より短くても、字の箱の範囲は残す
    // (製品の説明: 字の箱の行の数に満たない短いブロックの後ろのブロックも、字の箱の横に字下げする)
    if (spec.adjacent === Infinity) {
      const fr = this.top();
      const last = bands[bands.length - 1];
      last.ilFloor = placed.b1;
      if (fr) (fr.ilBands ??= []).push(last);
    }
    return bands;
  }

  /**
   * 段落の最初の字 (initial-letter。CSS Inline 3 §7) の箱を作る: 字の大きさ・箱の大きさ・箱の中の字の位置を決めた float の節を返す。
   *  - まわりの文字の、合わせる 2 つの位置 (上と下。initial-letter-align。§7.4) を、最初の行の上端からの距離で求める。行の高さは包含ブロックの
   *    line-height (§7.5.3: 行の中身による行の高さの違いは数えない)、基線は行の中の基線の位置 (nominalRatio。HTML は最初に使える書体の
   *    上の高さ・下の深さから)、和文の字の枠 (em の箱) は、その基線から和文の字の書体の値だけ上と下:
   *    alphabetic = 最初の行の大文字の高さと、N 行目の欧文の基線。ideographic = 最初の行の字の枠の上端と、N 行目の字の枠の下端
   *    (ideographic-ink の位置は、字の枠で代える)。leading = 最初の行の上端と、N 行目の下端
   *  - 字の側の 2 つの位置は、中身で決める (§7.4): 漢字・仮名・ハングル・彝文字を含めば字の枠の上端と下端、ほかは大文字の高さと基線。
   *    縦書きでは、どちらも字の枠 (行の進む向きに直交する向きの、字の枠の両端)
   *  - 字の大きさは、字の側の 2 つの位置の間が、まわりの 2 つの位置の間と同じになる大きさ (§7.5.3)
   *  - 箱は、max(N, S) 行分の高さ。N が S より大きければ、(N − S) 行分だけ最初の行より上へ出る (raise。§7.6.1)。S が大きければ、上を合わせる
   * 大文字の高さは、書体の OS/2 の値。無ければ 0.66em (付録 A.2 の代わりの値)
   */
  private initialLetterBox(node: LFloat, st: ResolvedStyle): { node: LFloat; raise: number; outerB: number; indent: boolean; F: number; LH: number } | undefined {
    const inner = node.children[0];
    if (!node.initialLetter || typeof inner !== 'object' || inner.type !== 'block') return undefined;
    const spec = node.initialLetter;
    const text = inner.children.filter((k): k is string => typeof k === 'string').join('');
    // 字の代わりの画像 (XSL-FO の axf:initial-letters: 最初が画像なら、その画像を字にする)
    const image = !text && inner.children.length === 1 && typeof inner.children[0] === 'object' && inner.children[0].type === 'image' ? (inner.children[0] as LImage) : undefined;
    if (!text && !image) return undefined;
    const LH = lineHeightOf(st);
    const f = st.fontSize;
    const stL = resolveStyle(st, inner);
    const vertical = this.wm !== 'horizontal-tb';
    const fontOf = (ch: string, s: ResolvedStyle) => this.host.measurer.glyph(ch, { fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontSize: s.fontSize, stretch: s.fontStretch }, 'horizontal-tb').font;
    const capOf = (font: LoadedFont) => {
      const cap = ((font.fk as unknown as { capHeight?: number }).capHeight ?? 0) / font.unitsPerEm;
      return cap > 0.2 && cap < 1 ? cap : 0.66;
    };
    // x-height (OS/2 の sxHeight。無ければ 0.5em。CSS Values 4 §6.1.1 の ex の代わりの値)
    const xhOf = (font: LoadedFont) => {
      const xh = ((font.fk as unknown as { xHeight?: number }).xHeight ?? 0) / font.unitsPerEm;
      return xh > 0.1 && xh < 1 ? xh : 0.5;
    };
    const core = image ? 'H' : (/[\p{L}\p{N}\p{S}]/u.exec(text)?.[0] ?? text[0]);
    const fontL = fontOf(core, stL);
    const fontP = fontOf('H', st);
    // まわりの文字の位置 (最初の行の上端から)
    const emTop = (LH - f) / 2;
    const base = this.host.xslSpace ? this.xslLineBase(st, f, LH, core) : emTop + this.nominalRatio(st) * f;
    const align = vertical && spec.align !== 'leading' ? 'ideographic' : (spec.align ?? 'alphabetic');
    // まわりの和文の字の枠 (em の箱) の上端・下端: 横書きは、行の基線から、和文の字の書体の値だけ上・下 (行の基線は最初に使える書体の値で
    // 置くので、字の枠は行の中央とは限らない)。縦書きは、字が行の中央にそろうので、行の中央の 1em
    const ideoP = fontOf('\u56FD', st).baselineRatio;
    const emOver = vertical ? emTop : base - ideoP * f;
    // 字の側の位置: 漢字・仮名・ハングル・彝文字を含めば字の枠、ほかは大文字の高さと基線 (画像は、画像の上端と下端を大文字の高さと基線に)
    const ideographic = vertical || /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Yi}]/u.test(text);
    // 最初の行の側を x-height に合わせる (XSL-FO の axf:initial-letters-first-line-head-height。和文・縦書きでは使わない)
    const over = align === 'leading' ? 0 : align === 'ideographic' ? emOver : base - (spec.xHeight && !ideographic ? xhOf(fontP) : capOf(fontP)) * f;
    const under1 = align === 'leading' ? LH : align === 'ideographic' ? emOver + f : base;
    const capL = image ? 1 : capOf(fontL);
    const k = ideographic ? 1 : capL;
    // 字の大きさを長さで書いたもの (axf:initial-letters の <length>): 字の大きさはその値。字の合わせる 2 つの位置の間が届く行の数を N にする
    let N = spec.size;
    if (spec.length !== undefined) {
      N = 1 + (spec.length * k - (under1 - over)) / LH;
      // 字の高さが 1 行分に届かない長さは、指定が無いものとして扱う (製品の公開の説明の、axf:initial-letters の値の節)
      if (!(N >= 1)) return undefined;
    }
    // 沈める行の数の 0 は、行の数の小数を切り捨てた数 (axf:initial-letters の省略・drop。CSS の initial-letter は 1 以上の整数か drop)
    const S = spec.sink || Math.max(Math.floor(N), 1);
    const under = (N - 1) * LH + under1;
    // 字の大きさ
    const F = spec.length ?? Math.max((under - over) / k, 0.01);
    // 箱の中の字の行 (高さ F) の上端から、字の合わせる位置 (字の枠の上端・大文字の高さの上端) まで: 行の基線は nominalRatio の位置で、
    // 字の枠の上端は、そこから字の書体の値 (baselineRatio) だけ上、大文字の高さの上端は capL だけ上。縦書きは、字の枠が行の中央
    // (XSL-FO の行は、書体の上の高さ・下の深さと半行間で基線を置く: xslLineBase)
    const baseL = this.host.xslSpace ? this.xslLineBase(stL, F, F, core) : this.nominalRatio(stL) * F;
    // 字の行の上端 (箱の内容の上端から)
    const top = vertical || image ? over : over - (baseL - (ideographic ? fontL.baselineRatio : capL) * F);
    const lines = Math.max(N, S);
    // 字の大きさの単位 (dcem) を含む字の箱の幅 (XSL-FO の axf:initial-letters-width): 字の大きさが決まったので、長さにする
    if (spec.width) node = withRef(node, { ...node, [vertical ? 'height' : 'width']: Math.max(spec.width.pt + spec.width.dcem * F, 0) });
    const d = describeBox(node, this.wm);
    const horizontal = !vertical;
    // 最初の行の字下げ (§7.8.2): 字の箱ごと下げる (箱の行頭の側の余白に足す)。XSL-FO は、text-indent を字の箱のずらしとして渡す (負の値も)
    const first = spec.shift ? spec.shift.pt + spec.shift.dcem * F : st.textIndent > 0 && !st.textIndentHanging ? st.textIndent : 0;
    // 先行する約物を行の頭の外へ出す (axf:initial-letters-leading-punctuation-position="hang"): 約物の送りの分だけ、字の箱を行頭の側へ
    const hang = spec.hangLead ? Array.from(spec.hangLead).reduce((a, ch) => a + this.host.measurer.glyph(ch, { fontFamily: stL.fontFamily, fontWeight: stL.fontWeight, fontSize: F, stretch: stL.fontStretch }, this.wm).advance, 0) : 0;
    // (右から左へ書く横組みの XSL-FO のドロップキャップは、end の float: 行の頭の側は、箱の end の側)
    const headKey = node.float === 'end' ? 'ie' : 'is';
    const marginP = first || hang ? toPhysicalEdges({ ...d.m, [headKey]: d.m[headKey] + first - hang }, this.wm) : node.margin;
    // 画像は、高さを字の 2 つの位置の間にする (幅は画像の縦横比から)。行は画像だけの高さ (支柱を置かない)
    const H = under - over;
    // XSL-FO の余白の解決 (§4.3.1) では、参照領域 (字の箱) の頭の space-before は捨てられ、負の余白も効かないので、字の位置の正の余白は
    // 残す印を付け、負の分 (字の行の上端が箱の上端より上) は、組んだ後に箱を動かす (relativeOffset。物理の向きで、右・下が正)
    const neg = this.host.xslSpace ? Math.min(top, 0) : 0;
    const keepTop = this.host.xslSpace
      ? { retainSpaceBefore: true, ...(neg < 0 ? { relativeOffset: this.wm === 'horizontal-tb' ? { x: 0, y: neg } : { x: this.wm === 'vertical-rl' ? -neg : neg, y: 0 } } : {}) }
      : {};
    const topM = top - neg;
    const child: LBlock = image
      ? ({ ...inner, fontSize: H, lineHeight: 1, lineHeightPt: H, noStrut: true, ...keepTop, margin: toPhysicalEdges({ bs: topM, be: 0, is: 0, ie: 0 }, this.wm), children: [{ ...image, height: H }] } as LBlock)
      : ({ ...inner, fontSize: F, lineHeight: 1, lineHeightPt: F, noStrut: undefined, ...keepTop, margin: toPhysicalEdges({ bs: topM, be: 0, is: 0, ie: 0 }, this.wm) } as LBlock);
    const sized: LFloat = {
      ...node,
      initialLetter: undefined,
      ...(first || hang ? { margin: marginP } : {}),
      boxSizing: node.width !== undefined && horizontal ? node.boxSizing : 'content-box',
      [horizontal ? 'height' : 'width']: lines * LH + (node.boxSizing === 'border-box' && node.width !== undefined && horizontal ? d.bpStart + d.bpEnd : 0),
      children: [child],
    };
    const raise = Math.max(N - S, 0) * LH + d.m.bs + d.bpStart;
    // ページ・段の残りに入るかは、字の箱と、最初の行から orphans の行までで確かめる (行だけが次のページへ送られて、字が残らないように)
    const need = Math.max(lines * LH + d.m.bs + d.m.be + d.bpStart + d.bpEnd, raise + (st.orphans ?? 2) * LH);
    return { node: sized, raise, outerB: need, indent: first !== 0, F, LH };
  }

  /** 傍注 (余白に置く float)。本文領域の幅で組み、いまの挿入点 (前の傍注の下) に置く。本文の行幅は変えない */
  private placeMarginal(node: LFloat, st: ResolvedStyle) {
    const horizontal = this.wm === 'horizontal-tb';
    const src: LBlockContainer = withRef(node, { ...node, type: 'block-container', absolutePosition: false, boxSizing: 'content-box' });
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
    // float を置く位置の前の余白は、行と同じ数え方 (flushValue): 領域 (ページ・段) の頭で捨てる余白 (XSL 1.1 §4.3.1 の
    // conditionality="discard"。CSS Fragmentation 3 §5.2 の、区切りに接して切り詰める margin) は数えない。pendingValue で数えると、
    // 頭の段落の頭字 (axf:initial-letters・initial-letter) の箱だけが、捨てた余白の分だけ行より下にずれる。頭でないときは同じ値
    const pv = this.flushValue();
    if (f.side === 'before' && this.pageLevel) {
      // 段組のページ全体の領域 (全段を貫く上端) に置く前方 float は、いまのページに置く (layoutColumnPass が上端に並べる)。
      // float の中の行が持つ脚注と id も、1 段のページで置くとき (下) と同じく、いまのページのものにする。
      // XSL 1.1 §6.12.3: 脚注の本体は、参照 (fo:footnote の inline) を含む領域と同じページに置く。fo:float の中も同じ (§6.12.2)。
      // CSS GCPM 3 §2.2: 脚注の呼び出しのあるページの脚注の領域に置く
      this.pageLevel.addBeforeFloat(f);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      return;
    }
    if (f.side === 'before') {
      // 本文との間に区切りの内容があれば、最初の前方 float のときに高さを確保する (以後は float の下に動かす)
      const sep = this.beforeSepNode ? undefined : this.beforeSep?.();
      const sepH = sep?.height ?? 0;
      const { gap, tail } = beforeFloatSpacing(this.beforeLast, f);
      const need = gap + f.outerB + tail + sepH;
      if (this.paginating && this.pageHasContent && this.cursor + need + this.footReserve > this.limit + EPS) {
        this.deferredFloats.push(f);
        this.deferredBefore = true;
        return;
      }
      if (this.paginating && !this.pageHasContent && this.cursor + need + this.footReserve > this.limit + EPS) {
        this.host.warn(withSource(diag('layout/float-overflow', msg('float がページより大きいため溢れます', 'a float is larger than the page and overflows')), f.box));
      }
      // すでに置かれた本文を float の高さだけ押し下げ、ページ先頭側へ積む
      this.shiftContent(need);
      f.box.i = f.m.is + Math.max(this.rootI - f.outerI, 0) / 2;
      f.box.b = this.beforeUsed - this.beforeSepH + gap + f.m.bs;
      this.root.children.push(f.box);
      this.noteIds(f.box);
      this.placeHeldFootnotes(f.box);
      this.beforeNodes.add(f.box);
      this.beforeLast = f;
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
      this.floatEpoch++;
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
      const fx = this.floatIndex();
      let y = Math.max(this.cursor + pv, fx.maxB0, f.clear ? this.floatBottom(f.clear) : 0);
      let left = off;
      let right = off + width;
      for (let guard = 0; guard < 100; guard++) {
        left = off;
        right = off + width;
        let next = Infinity;
        // 候補は、下端が b0 の最大より下の float (fx.live。y は b0 の最大より下なので、ほかの float は下の条件で飛ばされる)
        for (const p of fx.live) {
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
      if (this.paginating && !this.pageHasContent && y + f.outerB + this.footReserve > this.limit + EPS) this.host.warn(withSource(diag('layout/float-overflow', msg('float がページより大きいため溢れます', 'a float is larger than the page and overflows')), f.box));
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
      this.host.warn(withSource(diag('layout/float-overflow', msg('float がページより大きいため溢れます', 'a float is larger than the page and overflows')), f.box));
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
    this.floatEpoch++;
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
  /**
   * 百分率の基準になる、包含ブロック (いまの箱) の内容の inline の大きさ。中身の幅を測る組版で、その大きさが測る幅によるとき
   * (測る流れの根元と、その中の、長さで幅を書いていない箱) は undefined (CSS Sizing 3 §5.2.1 の循環する百分率)
   */
  private percentBase(): number | undefined {
    const t = this.top();
    return this.intrinsic && (t ? t.indefI : true) ? undefined : this.contentI();
  }
  /**
   * 段の数を column-width から決めた段組・段の間が百分率の段組 (columns.byWidth) の、段の数と段の間を、置く所での内容の幅 U で
   * 決め直した節 (CSS Multi-column 1 §3.4: N = max(1, floor((U + gap) / (column-width + gap)))、column-count があれば、それが上限)。
   * 中身の幅を測る組版で、幅が測る幅によるときは、読み込みの見積もりのまま
   */
  private resolveColumns(node: LBlockContainer): LBlockContainer {
    const cols = node.columns;
    const bw = cols?.byWidth;
    if (!cols || !bw || this.wm !== 'horizontal-tb' || (node.writingMode && node.writingMode !== 'horizontal-tb')) return node;
    const cb = this.percentBase();
    if (cb === undefined) return node;
    const d = describeBox(node, this.wm);
    const U = d.isizeExplicit ?? Math.max(cb - d.m.is - d.m.ie - d.bpI, 0);
    const gap = bw.gapPct !== undefined ? bw.gapPct * U : (cols.gap ?? 12);
    let count = bw.maxCount ?? cols.count;
    if (bw.width !== undefined) {
      const byW = Math.max(1, Math.floor((U + gap) / (bw.width + gap)));
      count = bw.maxCount ? Math.min(bw.maxCount, byW) : byW;
    }
    if (count === cols.count && Math.abs(gap - (cols.gap ?? 12)) < EPS) return node;
    const key = `c${U}`;
    let m = percentCache.get(node);
    const hit = m?.get(key);
    if (hit) return hit as LBlockContainer;
    const out: LBlockContainer = { ...node, columns: { ...cols, count, gap } };
    copySourceRef(node, out);
    if (!m) percentCache.set(node, (m = new Map()));
    m.set(key, out);
    return out;
  }

  /** 百分率の寸法 (BoxStyle.percent) を、いまの包含ブロックで解いた節 (withPercent) */
  private resolvePercent<T extends BoxStyle>(node: T, block: boolean): T {
    return node.percent ? withPercent(node, this.percentBase(), this.wm === 'horizontal-tb', block) : node;
  }
  private contentStartB(): number {
    return this.top()?.contentStartB ?? 0;
  }

  /**
   * いま組んでいるページの、左右を決める数 (奇数は、左から右へ進む文書の右ページ): ページ番号 + FlowHost.sideDelta (CSS の文書では、
   * 文書の最初からのページの順)。ページ番号の分からない流れ (セルの中など) では undefined
   */
  private sideNumber(): number | undefined {
    const n = this.host.pageNumber?.();
    return n === undefined ? undefined : n + (this.host.sideDelta ?? 0);
  }

  /** text-align の inside / outside: 組むページの偶奇で start か end かが決まるので、置く時点で行の中身を寄せる */
  private alignByPage(node: LNode, pl: PositionedLine, st: ResolvedStyle) {
    // 最後の行 (と強制改行で終わる行) は、text-align-last が inside・outside ならそれに従う (positionLine は行頭に置いている)。
    // それ以外の最後の行は、従来どおり text-align で決める
    const lastIO = pl.raw.last && (st.textAlignLast === 'inside' || st.textAlignLast === 'outside');
    const align = lastIO ? st.textAlignLast : st.textAlign;
    if (align !== 'inside' && align !== 'outside') return;
    const even = (this.sideNumber() ?? 1) % 2 === 0;
    // 綴じ側は、奇数ページが start 側・偶数ページが end 側。inside は綴じ側、outside は小口側。
    // 縦書きの行では、綴じる側 (左右) が行の始めの端 (上) でも終わりの端 (下) でもないので、inside は始めの端、outside は終わりの端
    // (XSL 1.1 §7.16.9: "If neither, use start alignment." / "If neither, use end alignment.")
    const toEnd = st.wm !== 'horizontal-tb' ? align === 'outside' : (align === 'inside') === even;
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

  /**
   * 保留中の余白のうち、次に置く内容の前に空ける長さ (flush が位置に足す値)。領域の先頭 (discardLeading) では、捨てる余白を数えない。
   * 行・箱が入るかを確かめるときも、この値で数える (pendingValue で数えると、捨てる余白の分だけ入らないとみなす)
   */
  private flushValue(): number {
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
    return this.discardLeading && this.pendForce === null ? Math.max(keep(retained()), this.pendMin) + this.pendSpill : this.pendingValue();
  }

  /** 保留マージンを確定し、未オープン Frame を開く */
  private flush() {
    const v = this.flushValue();
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
    // 大きさの指定の無いもの (auto) は NaN の印にして、指定した 0 (描かない) と分ける (gradientImage が、領域の大きさにする)
    if (bi.gradient) return { bgImage: { ...bi, width: bi.width ?? NaN, height: bi.height ?? NaN } };
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

  /** fixedI: 中身の幅を測る組版で、大きさの指定を、箱の外側の大きさとして数える (LNode.fixedI。作成者が長さで書いた大きさのとき) */
  openFrame(desc: BoxDesc, kind: 'block' | 'table' = 'block', fixedI = true): Frame {
    this.applyPendingBreak();
    const parentI = this.contentI();
    const isize = desc.isizeExplicit != null ? desc.isizeExplicit + desc.bpI : parentI - desc.m.is - desc.m.ie;
    const node = this.makeNode(kind, desc, Math.max(isize, 0));
    if (this.intrinsic && fixedI && desc.isizeExplicit != null && kind === 'block') node.fixedI = true;
    const frame: Frame = { desc, node, opened: false, startB: 0, contentStartB: 0, contentI: Math.max(isize - desc.bpI, 0) };
    // 測る組版で、長さで書いた幅の箱の中は、百分率の基準が決まる。ほかの箱は、外の箱のまま
    if (this.intrinsic && !(fixedI && desc.isizeExplicit != null) && (this.top()?.indefI ?? true)) frame.indefI = true;
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
    // 半行間が負 (line-height が字の大きさより小さい) の行は、em の箱の下端が行の下端より下に出るので、その分だけ下へ伸ばす
    // (見本の PDF: 30pt の字・line-height 25q の h1 の後ろの箱が、負の半行間 6.14pt だけ下に置かれる)
    const gt = this.gridTrail.trail > 0 ? this.gridTrail.trail : Math.min(0, this.gridTrail.raw ?? 0);
    if (f.grid && f.opened && this.wm === 'horizontal-tb' && gt !== 0 && Math.abs(this.gridTrail.end - this.cursor) < EPS) {
      this.cursor -= gt;
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
          this.host.warn(withSource(diag('layout/height-cut', msg('高さの指定が 50 ページを超える箱は、50 ページで打ち切ります', 'a box whose specified height exceeds 50 pages is cut off at 50 pages')), f.node));
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
    if (f.ilBands) {
      for (const p of f.ilBands) p.b1 = Math.max(p.b0, Math.min(p.b1, Math.max(this.cursor, p.ilFloor ?? -Infinity)));
      this.floatEpoch++;
    }
    if (f.ilFloats) for (const p of f.ilFloats) p.ilAfter = true;
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
    // 続きの位置の記録 (ForceStep)。続きから組むときは、記録の区切りの、改ページの後から組む
    const r = this.takeStep('force');
    if (!r && !this.rs) return this.forceBreakIn(kind, undefined, undefined);
    const depth = this.rs!.length;
    const step: ForceStep = r ?? { k: 'force', kind, phase: '' };
    this.rs!.push(step);
    try {
      this.forceBreakIn(r ? r.kind : kind, step, r?.phase || undefined);
    } finally {
      this.rs!.length = depth;
    }
  }

  private forceBreakIn(kind: BreakKind, step: ForceStep | undefined, entry: ForceStep['phase'] | undefined) {
    /** 改ページを呼ぶ所 (続きから組むときは、ここで次のページを開く) */
    const brk = (phase: ForceStep['phase'], level: 'column' | 'page' | 'blank') => {
      if (entry === phase) {
        entry = undefined;
        this.resumeOpen();
        // 初めから組む道の改ページの後と同じく、印を戻す (戻った境目の印のまま、後ろの境目を写さないように)
        if (step) step.phase = '';
        return;
      }
      if (step) {
        step.phase = phase;
        step.kind = kind;
      }
      this.breakPage(level);
      if (step) step.phase = '';
    };
    if (entry) {
      // 続きから組む: 記録の改ページの所まで飛ぶ
      if (entry === 'col') {
        brk('col', 'column');
        if (this.discardAfterForced) this.discardLeading = true;
        return;
      }
      if (entry === 'empty') {
        brk('empty', 'page');
        return;
      }
      if (entry === 'blank') {
        brk('blank', 'blank');
        this.pages!.forcedBreak?.(kind);
      }
      brk('page', 'page');
      if (!this.host.xslSpace && !this.discardAfterForced) for (const f of this.stack) if (!f.opened) this.addMargin(f.desc.m.bs, f.desc.precBs);
      if (this.discardAfterForced) this.discardLeading = true;
      return;
    }
    if (!this.paginating) return;
    // CSS: まだ効かせていない前の箱の break-after (breakNext) は、この区切りと同じ所の値。合わせてから 1 度だけ効かせる
    // (CSS Fragmentation 3 §4.3: 左右のページの指定は、流れの中で後ろの要素の値が勝つ。順に効かせると、break-after: right の後の
    // break-before: left で、右ページへ送ってから、さらに左ページへ送っていた)
    if (!this.host.xslSpace && this.breakNext) {
      kind = combineBreaks(this.breakNext, kind) as BreakKind;
      this.breakNext = null;
    }
    if (kind === 'column') {
      if (this.pageHasContent) {
        this.pages!.forcedBreak?.(kind);
        brk('col', 'column');
        if (this.discardAfterForced) this.discardLeading = true;
      }
      return;
    }
    // 段組の段の流れの中のページの区切り: 段の流れに知らせ、段を改める (段の流れは、残りの段を飛ばして次のページの最初の段へ)
    if (this.pages?.pageBreakInColumns) {
      if (!this.pages.pageBreakInColumns(kind, this.pageHasContent)) return;
      this.breakPage('page');
      if (!this.host.xslSpace && !this.discardAfterForced) for (const f of this.stack) if (!f.opened) this.addMargin(f.desc.m.bs, f.desc.precBs);
      if (this.discardAfterForced) this.discardLeading = true;
      return;
    }
    const wantOdd = kind === 'odd-page' ? true : kind === 'even-page' ? false : undefined;
    // 偶奇は、ページの左右を決める数 (sideNumber。CSS の文書では、ページ番号でなく、ページの順: CSS Fragmentation 3 §3.1 の left・right は、
    // 次のページが左・右ページになるように区切る)
    const n = this.sideNumber();
    const parityOk = (k: number) => wantOdd === undefined || n === undefined || (k % 2 === 1) === wantOdd;
    if (this.pageHasContent || !(this.pages!.atPageStart?.() ?? true)) {
      // 次のページの偶奇が合わなければ、白ページ (blank-or-not-blank="blank" のマスター) を挟む
      if (n !== undefined && !parityOk(n + 1)) brk('blank', 'blank');
      this.pages!.forcedBreak?.(kind);
      brk('page', 'page');
      // CSS: 強制改ページの後の余白は残す (Fragmentation 3 §5.2)。改ページの後にある、まだ開いていない祖先の上の余白を足し直す
      // (改ページの前の要素の下の余白は捨てる)
      if (!this.host.xslSpace && !this.discardAfterForced) for (const f of this.stack) if (!f.opened) this.addMargin(f.desc.m.bs, f.desc.precBs);
      // 改ページの後の先頭の余白は捨てる (retain の余白は flush で残す)
      if (this.discardAfterForced) this.discardLeading = true;
    } else if (n !== undefined && !parityOk(n)) {
      // まだ何も置いていないページの偶奇が合わない: このページを白ページとして残し、次へ
      brk('empty', 'page');
    }
  }

  /**
   * 箱の後ろの強制の区切りを、次の中身を置く前に効かせるものとして覚える。CSS では、まだ効かせていない値 (入れ子の最後の子の break-after) と
   * 合わせる (同じ区切りの所の値。CSS Fragmentation 3 §4.3: 左右のページの指定は、流れの中で後ろ = 外の箱の値が勝つ)
   */
  private setBreakNext(kind: BreakKind) {
    this.breakNext = !this.host.xslSpace && this.breakNext ? (combineBreaks(this.breakNext, kind) as BreakKind) : kind;
  }

  private applyPendingBreak() {
    if (this.breakNext) {
      const k = this.breakNext;
      this.breakNext = null;
      this.forceBreak(k);
    }
  }

  /**
   * 改ページ (改段)。いまのページを閉じ (closePage)、次のページを開く (openPage)。閉じてから開くまでが、ページの境目
   * (続きから組むときは、境目で写した状態を戻して openPage から入る。design/resumable-flow.md の 4.2)
   */
  breakPage(level: 'column' | 'page' | 'blank' = 'column') {
    if (!this.pages) return;
    this.closePage();
    this.pages.boundary?.(level);
    this.openPage(level);
  }

  /** 改ページの前半: 開いている断片をいまのページで閉じ、後ろの float・段の終わりの知らせ・脚注を出す */
  private closePage() {
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
        fresh.flexContentI = f.node.flexContentI;
        if (f.node.gridContent) fresh.gridContent = true;
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
  }

  /** 改ページの後半: 次のページを作り、ページごとの欄を戻し、開いていた箱を開き直し、持ち越しの脚注と送った float を置く */
  private openPage(level: 'column' | 'page' | 'blank') {
    const np = this.pages!.nextPage(level);
    this.root = np.root;
    this.limit = np.limit;
    const gapTop = np.gap ?? 0;
    if (Math.abs(np.rootI - this.rootI) > EPS) {
      // 本文領域の inline 方向の大きさが違うページマスター: 開いている箱の幅を、新しいページの幅から求め直す (幅の指定がある箱はそのまま)
      this.rootI = np.rootI;
      let parentI = this.rootI;
      /** auto の余白の側に配る分 */
      // 残りが負なら、ltr は 0 (左に揃え、右へはみ出す)、rtl は残りそのもの (右に揃え、左へはみ出す。CSS 2.1 §10.3.3)。最初の断片で
      // はみ出していた箱も、続きのページで残りが正になれば寄せ、その逆 (最初は収まり、続きではみ出す) も同じ決まりで置き直す
      const share = (a: NonNullable<Frame['autoM']>, free: number) => (free > EPS ? (a.am === 'center' ? free / 2 : a.am === 'start' ? free : 0) : a.rtl && free < -EPS ? free : 0);
      for (const f of this.stack) {
        // auto の余白で寄せた箱は、寄せる前の余白で幅を解き、新しい包含ブロックの幅で寄せ直す
        const a = f.autoM;
        if (a) f.desc = { ...f.desc, m: { ...f.desc.m, is: f.desc.m.is - share(a, a.free) } };
        if (f.pctI) f.contentI = percentContentI(f.pctI.P, parentI, f.desc, f.pctI.borderBox);
        else if (f.desc.isizeExplicit == null) f.contentI = Math.max(parentI - f.desc.m.is - f.desc.m.ie - f.desc.bpI, 0);
        if (a) {
          const boxI = f.pctI ? f.contentI + f.desc.bpI : a.boxI;
          const free = a.free + (parentI - a.parentI) - (boxI - a.boxI);
          f.autoM = { ...a, free, parentI, boxI };
          f.desc = { ...f.desc, m: { ...f.desc.m, is: f.desc.m.is + share(a, free) } };
        }
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
    // 前とつながる指定は、ページ・段の頭では効かない (前の流れ・前のページの値を、新しいページの最初の子へ受け継がない)
    this.chainedToPrev = false;
    this.pageSerial++;
    this.pageItems = 0;
    this.refStartItems = -1; // 参照領域の途中でページ・段が変わったら、その先頭はページ・段の先頭として扱う
    this.edgeBlocked = false;
    this.headerOnly = false;
    this.floats = [];
    this.beforeNodes = new Set();
    this.beforeUsed = 0;
    this.beforeLast = undefined;
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
        isize: (f.desc.isizeExplicit != null && !f.pctI) || old.kind === 'table' ? old.isize : f.contentI + f.desc.bpI,
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
        flexContentI: old.flexContentI,
        ...(old.gridContent ? { gridContent: true } : {}),
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

  // ── ページの境目の写しと、続きから組む口 (design/resumable-flow.md の 2・4) ──

  /** 写さない欄: 組版の器・page-sequence が作って渡すもの (続きから組む流れは、新しい流れに作り直したものを使う) と、続きの位置の記録 */
  private static readonly WIRING = new Set(['host', 'pages', 'foot', 'side', 'abs', 'pageSize', 'beforeSep', 'pageLevel', 'onPlaced', 'markerSink', 'rs', 'resume', 'boxStep', 'wm', 'trialAbs']);

  /** いまのページの境目の写し (breakPage の closePage の後。PageHost.boundary の中で呼ぶ) */
  captureBoundary(level: 'column' | 'page' | 'blank'): FlowBoundary {
    const reason = this.resumeReason();
    if (reason) return { level, fields: {}, steps: [], reason };
    const fields: Record<string, unknown> = {};
    const self = this as unknown as Record<string, unknown>;
    for (const k of Object.keys(this)) {
      if (Flow.WIRING.has(k)) continue;
      const v = self[k];
      if (typeof v !== 'function') fields[k] = copyField(v);
    }
    fields.stack = this.stack.map(copyFrame);
    fields.markerSink = this.markerSink.slice();
    fields.deferredFloats = copyDeferredFloats(this.deferredFloats);
    const steps = copySteps(
      this.rs!,
      (st) => ({ ...st, ctx: { ...st.ctx!, frame: undefined as unknown as Frame, frameAt: this.stack.indexOf(st.ctx!.frame) } as BlockCtx }),
      (c) => ({ ...c, frame: undefined as unknown as Frame, frameAt: this.stack.indexOf(c.frame) }) as TableCtx,
    );
    return { level, fields, steps };
  }

  /**
   * 境目の写しを戻し、続きから組む用意をする (新しく作った流れで呼ぶ)。この後、page-sequence の流れと同じく layoutChildren を呼ぶと、
   * 各所が続きの位置まで飛び、境目の所で openPage してから続きを組む
   */
  resumeFrom(b: FlowBoundary) {
    const self = this as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(b.fields)) {
      if (k === 'stack' || k === 'markerSink') continue;
      self[k] = copyField(v);
    }
    this.stack = (b.fields.stack as Frame[]).map(copyFrame);
    if (b.fields.deferredFloats) this.deferredFloats = copyDeferredFloats(b.fields.deferredFloats as FloatBox[]);
    this.markerSink.length = 0;
    pushAll(this.markerSink, b.fields.markerSink as PendingMarker[]);
    const steps = copySteps(
      b.steps,
      (st) => ({ ...st, ctx: { ...st.ctx!, frame: this.stack[(st.ctx as BlockCtx & { frameAt: number }).frameAt] } }),
      (c) => ({ ...c, frame: this.stack[(c as TableCtx & { frameAt: number }).frameAt] }),
    );
    this.resume = { steps, at: 0, level: b.level };
    this.rs = [];
  }

  /**
   * 境目から続けて組めない理由 (組めるなら undefined。design/resumable-flow.md の 2.4)。続きの位置の鎖を外から順にたどり、各段が下の段を
   * 呼んでいる所 (下の段と結び付いていること) か、最後の段が改ページを呼んだ所かを確かめる。ほかの関数の中の改ページは、続きから組めない
   */
  private resumeReason(): string | undefined {
    const rs = this.rs;
    if (!rs?.length) return 'outside';
    if (this.keepHold) return 'keep-hold';
    if (this.keepTrial || this.measureOnly || this.foot?.inTrial) return 'trial';
    if (this.lineFloats || this.lineAbs) return 'line-anchor';
    if (this.cbAbs || this.staticKey !== undefined || this.localAbs || this.collectAbs) return 'absolute';
    if (this.stack.some((f) => f.frags || f.ilBands || f.ilFloats)) return 'fragments';
    const c = this.host.condense;
    if (c && (c.depth > 0 || c.win > 0)) return 'condense';
    if (this.host.volatile?.active) return 'measure';
    for (let i = 0; i < rs.length; i++) {
      const st = rs[i];
      const next = rs[i + 1] as ResumeStep | undefined;
      const last = !next;
      let ok = false;
      switch (st.k) {
        case 'children':
          if (st.anchored) return 'line-anchor';
          if (st.phase === 'run') ok = next?.k === 'inline' && next.src === st.run;
          else if (st.phase === 'child') ok = (next?.k === 'block' || next?.k === 'table') && next.orig === st.children[st.at];
          else ok = last && (st.phase === 'kwp' || st.phase === 'kwn');
          break;
        case 'block':
          if (st.phase === 'pre' || st.phase === 'open') ok = next?.k === 'force';
          else if (st.phase === 'body') ok = next?.k === 'children' && next.children === st.ctx!.node.children;
          else ok = last && st.phase === 'ktc';
          break;
        case 'table':
          if (st.phase === 'pre' || st.phase === 'open') ok = next?.k === 'force';
          else ok = last && (st.phase === 'ktc' || ((st.phase === 'break' || st.phase === 'fblank' || st.phase === 'fpage') && !!st.rs?.site && !!st.ctx));
          break;
        case 'inline':
          if (st.phase === 'pending') ok = next?.k === 'force';
          else ok = last && (st.phase === 'top' || st.phase === 'bottom');
          break;
        case 'force':
          ok = last && st.phase !== '';
          break;
      }
      if (!ok) {
        // 子のブロックの中なら、その種類も書く (続きから組めない所の数え。scripts/check-resume.mjs)
        const ch = st.k === 'children' && st.phase === 'child' ? st.children[st.at] : undefined;
        const kind = ch && typeof ch === 'object' ? `:${ch.type}${ch.type === 'block-container' && (ch as LBlockContainer).columns ? '-columns' : ''}` : '';
        return `site:${st.k}${st.phase ? '/' + st.phase : ''}${kind}`;
      }
    }
    return undefined;
  }

  /** 続きから組むとき、k の段を取る (続きの位置の鎖の次の段。続きから組んでいなければ undefined) */
  private takeStep<K extends ResumeStep['k']>(k: K): Extract<ResumeStep, { k: K }> | undefined {
    const r = this.resume;
    if (!r) return undefined;
    const st = r.steps[r.at];
    if (!st || st.k !== k) throw new Error(`kumiori: the resume position does not match (${st?.k ?? 'end'} expected, ${k} reached)`);
    r.at++;
    return st as Extract<ResumeStep, { k: K }>;
  }

  /** 続きから組むとき、境目の所に来た: 次のページを開く (breakPage の後半) */
  private resumeOpen() {
    const r = this.resume!;
    if (r.at !== r.steps.length) throw new Error('kumiori: the resume position ended early');
    this.resume = undefined;
    this.openPage(r.level);
  }

  // ── 子要素の振り分け ──

  /** continued: 分けたブロックの 2 つ目からの断片の中身 (最初の行内の並びを、ブロックの最初の行として扱わない。LBlock.spanContinued) */
  layoutChildren(children: Array<LBlockLevel | LInlineLevel>, style: ResolvedStyle, continued = false) {
    // 続きの位置の記録 (design/resumable-flow.md の 2.2)。続きから組むときは、記録の段を取り、その位置から組む
    const resumed = this.takeStep('children');
    if (resumed && resumed.children !== children) throw new Error('kumiori: the resume position does not match (children)');
    const depth = this.rs?.length ?? 0;
    const step: ChildrenStep | undefined = resumed ?? (this.rs ? { k: 'children', children, phase: '', at: 0, run: [], runAt: 0, firstRun: true, topAt: -1, topPage: -1, anchored: false } : undefined);
    if (step) this.rs!.push(step);
    try {
      this.layoutChildrenIn(children, style, continued, step, resumed);
    } finally {
      if (this.rs) this.rs.length = depth;
    }
  }

  private layoutChildrenIn(children: Array<LBlockLevel | LInlineLevel>, style: ResolvedStyle, continued: boolean, step: ChildrenStep | undefined, resumed: ChildrenStep | undefined) {
    let run: InlineChild[] = [];
    let runAt = 0;
    let firstRun = !continued;
    // 行内の箱を基準にする絶対配置の箱 (LBlockContainer.inlineCb): 行の並びを組んでから、その行内の箱の断片を探して置く
    let runAbs: LBlockContainer[] = [];
    // 行の並びの途中に書いた CSS の float (左右に寄せるもの): 段落の頭に置かず、書いた所の目印 (LInline.floatAnchor) を含む行を組むときに置く
    // (CSS 2.1 §9.5.1 の規則 6・8: float の上端は、float より前の中身を含む行の上端より上にしない。そのうえでできるだけ上に置く)。
    // 読み込みが行内の要素の中の float を外へ出したもの (LFloat.inlineAnchor) は、読み込みが書いた所に置いた目印を使う。
    // runAnchors: run の中にある読み込みの目印 (run に足した子を 1 度ずつ調べる)
    let runFloats: Map<number, { node: LFloat; st: ResolvedStyle }> | undefined;
    // 行の並びの途中の、ページを基準にする絶対配置の箱 (位置の決まった祖先の無い CSS の箱) で、top・bottom か left・right が auto のもの:
    // 見つけた所に目印を置き、目印を含む行を置いたときに、その位置を static position にして置く (CSS 2.1 §10.3.7・§10.6.4。lineAbs)
    let runPageAbs: Map<number, { node: LBlockContainer; st: ResolvedStyle }> | undefined;
    const runAnchors = new Set<number>();
    const runAbsAnchors = new Set<number>();
    let scanned = 0;
    const anchorInRun = (key: number, abs = false) => {
      for (; scanned < run.length; scanned++) collectFloatAnchors(run[scanned], runAnchors, runAbsAnchors);
      return (abs ? runAbsAnchors : runAnchors).has(key);
    };
    const flushRun = () => {
      if (run.length) {
        const prevLF = this.lineFloats;
        const prevLA = this.lineAbs;
        this.lineFloats = runFloats;
        this.lineAbs = runPageAbs;
        if (step) {
          step.phase = 'run';
          step.at = ci;
          step.run = run;
          step.runAt = runAt;
          step.firstRun = firstRun;
          step.topAt = topAt;
          step.topPage = topPage;
          step.anchored = !!runFloats || !!runPageAbs || runAbs.length > 0;
        }
        try {
          this.layoutInlineRun(run, style, firstRun, { arr: children, at: runAt });
        } finally {
          this.lineFloats = prevLF;
          this.lineAbs = prevLA;
          if (step) step.phase = '';
        }
        firstRun = false;
        run = [];
        runAnchors.clear();
        runAbsAnchors.clear();
        scanned = 0;
      }
      // 目印を含む行を組まなかった float (目印と空白だけの並びは行を作らない) は、並びの後のいまの位置に置く
      if (runFloats) {
        const left = [...runFloats.values()];
        runFloats = undefined;
        for (const f of left) this.placeFloat(f.node, f.st);
      }
      // 目印を含む行を置かなかった箱 (目印と空白だけの並び) は、いまの位置に置く
      if (runPageAbs) {
        const left = [...runPageAbs.values()];
        runPageAbs = undefined;
        for (const a of left) this.layoutContainer(a.node, a.st);
      }
      if (runAbs.length) {
        this.placeInlineAbs(runAbs, style);
        runAbs = [];
      }
    };
    /** ページの先頭に置いたブロックの位置 (children の添字) と、そのページ (keepOverflow の判定に使う) */
    let topAt = -1;
    let topPage = -1;
    let ci = 0;
    /** 段の記録を書く (続きから組めるのは、記録を書いた所だけ) */
    const mark = (phase: ChildrenStep['phase']) => {
      if (!step) return;
      step.phase = phase;
      step.at = ci;
      step.run = run;
      step.runAt = runAt;
      step.firstRun = firstRun;
      step.topAt = topAt;
      step.topPage = topPage;
      step.anchored = !!runFloats || !!runPageAbs || runAbs.length > 0;
    };
    /**
     * ブロックの子 c (children[ci]) を組む。from は、続きから組むときの入る所 (start: 初めから。kwp・kwn: その改ページの後。
     * run: 前の行の並びを組んでいる所。child: ブロックを組んでいる所)
     */
    const blockChild = (c: LBlockLevel, from: 'start' | 'kwp' | 'run' | 'kwn' | 'child') => {
      if (from === 'start') {
        // 字の並び (無名のブロック) の直後のブロックが keep-with-previous (CSS の break-before: avoid) なら、
        // 並びと、そのブロックの先頭を同じページに置く。入らず、改ページすれば入るなら、並びの前で改ページする
        if (run.length && (c as { keepWithPrevious?: boolean }).keepWithPrevious) {
          const anon = { type: 'block', ...(firstRun ? {} : { textIndent: 0 }), children: run } as LBlock;
          if (this.keepWithNextBreak([anon, ...children.slice(ci)], 0, style)) {
            mark('kwp');
            this.breakPage();
            mark('');
          }
        }
      } else if (from === 'kwp') {
        // 初めから組む道の改ページの後 (mark('')) と同じく、印を戻す
        this.resumeOpen();
        mark('');
      }
      if (from !== 'kwn' && from !== 'child') {
        flushRun();
        // 流れの直下のブロックの span の切り替わりは、参照領域の境 (絶対配置の箱は流れの外なので、境を作らない)
        if (this.spanAreas && !this.stack.length && !(c.type === 'block-container' && c.absolutePosition)) {
          const sp = c.type === 'block' && c.span === 'all';
          if (this.prevSpan !== undefined && sp !== this.prevSpan) this.areaBoundary();
          this.prevSpan = sp;
        }
      }
      if (from !== 'child') {
        if (from === 'kwn' || this.keepWithNextBreak(children, ci, style)) {
          if (from === 'kwn') {
            this.resumeOpen();
            mark('');
          } else {
            mark('kwn');
            this.breakPage();
            mark('');
          }
          // 送ったブロックの先頭の余白は、強制でない改ページに接するので捨てる (ふだんの改ページと同じ。retain の余白は残す)
          if (!(c as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
        }
        if (this.paginating && (!this.pageHasContent || (c.type === 'block' && c.breakBefore))) {
          topAt = ci;
          topPage = this.pageSerial + (this.pageHasContent ? 1 : 0); // break-before で改めた次のページ
        }
      }
      // 前のブロックとつなげる指定 (前の keep-with-next・自分の keep-with-previous) があるか (段組を次のページへ送るかを決めるのに使う)。
      // 最初の子は、親が前とつながっていれば、前とつながる (親の頭は最初の子の頭なので、見出しの後ろの section の中の最初の段組を送ると、
      // 見出しだけがページの末尾に残る。親の値は、親を組む直前に、この同じ欄に入れてある)
      {
        const prev = ci > 0 ? children[ci - 1] : undefined;
        const own = (!!prev && typeof prev !== 'string' && !!(prev as { keepWithNext?: boolean }).keepWithNext) || !!(c as { keepWithPrevious?: boolean }).keepWithPrevious;
        this.chainedToPrev = ci === 0 ? this.chainedToPrev || own : own;
      }
      const hold = from !== 'child' && c.type === 'block' && c.keepOverflow && c.keepTogether ? this.holdKeepTogether(children, ci, topAt, topPage, style) : undefined;
      if (hold !== undefined) {
        // 並びの後ろに、分けずに置く: 置く間だけ、ページの上限をブロックの終わりまで延ばす (はみ出す)
        this.limit += hold;
        this.keepHold = true;
        try {
          this.layoutBlockLevel(c, style);
        } finally {
          this.keepHold = false;
          this.limit -= hold;
        }
      } else {
        mark('child');
        try {
          this.layoutBlockLevel(c, style);
        } finally {
          mark('');
        }
      }
    };
    // 続きから組む: 記録の位置から入る
    if (resumed) {
      ci = resumed.at;
      run = resumed.run;
      runAt = resumed.runAt;
      firstRun = resumed.firstRun;
      topAt = resumed.topAt;
      topPage = resumed.topPage;
      if (ci >= children.length) {
        flushRun();
        return;
      }
      blockChild(children[ci] as LBlockLevel, resumed.phase as 'kwp' | 'run' | 'kwn' | 'child');
      ci++;
    }
    // 読んだ先 (design/resumable-flow.md の 5.1): 行内の子は中身まで (字を平らにして行に分けるときに読む)、ブロックは節そのもの
    // (中身は、組むときにその子の並びで数える)
    const rd = this.host.read;
    for (; ci < children.length; ci++) {
      const c = children[ci];
      if (rd && typeof c === 'object') {
        const e = isInlineChild(c) ? sourceRefEnd(c) : sourceRef(c);
        if (e !== undefined && e > rd.to) rd.to = e;
      }
      if (!run.length) runAt = ci;
      if (typeof c !== 'string' && c.type === 'marker') {
        // 段落の途中でも行を分断しないよう、run には触れずに保留する
        const key = this.top()?.desc;
        if (key) markerParents.add(key);
        this.markerSink.push({ className: c.className, marker: c, ...(key ? { key } : {}) });
      } else if (typeof c !== 'string' && c.type === 'float') {
        // マーカーと同様、段落 (run) を分断しない。行の並びの途中の CSS の左右の float は、書いた所の行を組むときに置く (上の runFloats)。
        // 並びの頭の float・ほかの float (XSL-FO の float・前方 float・傍注・段落の最初の字) は、いまの位置 (段落の頭) に置く
        if (run.length && c.cssPlacement && !c.marginal && !c.initialLetter && /^(start|end|inside|outside)$/.test(c.float) && !this.host.xslSpace) {
          let key = c.inlineAnchor !== undefined && anchorInRun(c.inlineAnchor) ? c.inlineAnchor : undefined;
          if (key === undefined) {
            key = -++floatAnchorSeq;
            run.push({ type: 'inline', children: [], floatAnchor: key } as LInline);
          }
          (runFloats ??= new Map()).set(key, { node: c, st: style });
        } else this.placeFloat(c, style);
      } else if (typeof c !== 'string' && c.type === 'block-container' && c.absolutePosition && c.inlineCb !== undefined) {
        // 行内の箱を基準にする絶対配置の箱: 段落 (run) を分断しない。行を組んだ後で置く
        runAbs.push(c);
      } else if (typeof c !== 'string' && c.type === 'block-container' && c.absolutePosition && ((c.positionInContainer && (this.cbAbs || (this.collectAbs && !this.localAbs))) || (run.length > 0 && !this.host.xslSpace))) {
        // 絶対配置の基準になるブロックの中の絶対配置の箱: 段落 (run) を分断しない。上下の位置の指定が無ければ、段落の頭の高さ (static position)。
        // CSS の絶対配置の箱は、流れの外 (CSS 2.1 §9.3.1): 字の並びの途中にあっても、行を分けない (ページの上に置く箱も)。
        // 行の途中で見つけた、基準の箱を組んでから置く箱は、見つけた所に目印 (幅 0 の箱) を入れ、組んだ後でその位置を static position にする
        // (CSS 2.1 §10.3.7・§10.6.4: 位置が static だったときの仮の箱の位置。行の中の箱は、行の中の見つけた所)
        const anchored = run.length > 0 && c.positionInContainer && (this.cbAbs || (this.collectAbs && !this.localAbs));
        if (run.length > 0 && this.pageStatic(c)) {
          // 読み込みが見つけた所に置いた目印 (LBlockContainer.inlineAnchor) が並びにあれば、それを使う
          let key = c.inlineAnchor !== undefined && anchorInRun(c.inlineAnchor, true) ? c.inlineAnchor : undefined;
          if (key === undefined) {
            key = ++staticAnchorSeq;
            run.push({ type: 'inline', children: [], staticAnchor: key } as LInline);
          }
          (runPageAbs ??= new Map()).set(key, { node: c, st: style });
          continue;
        }
        if (anchored) {
          const key = ++staticAnchorSeq;
          run.push({ type: 'inline', children: [], staticAnchor: key } as LInline);
          this.staticKey = key;
        }
        try {
          this.layoutContainer(c, style);
        } finally {
          this.staticKey = undefined;
        }
      } else if (typeof c !== 'string' && c.type === 'retrieve-marker') {
        this.host.warn(withSource(diag('layout/marker-misplaced', msg('retrieve-marker は PageSequence.staticContent 内でのみ使えます', 'retrieve-marker can be used only in the static content of a page sequence')), c));
      } else if (typeof c !== 'string' && c.type === 'retrieve-table-marker') {
        // 表の header・footer の中のものは、組む前に中身に置き換えてある (layoutTableWithMarkers)。ここへ来るのは、それ以外の所に置いたもの
        this.host.warn(withSource(diag('layout/marker-misplaced', msg('retrieve-table-marker は表の header・footer の中でのみ使えます', 'retrieve-table-marker can be used only in a table header or footer')), c));
      } else if (isInlineChild(c)) run.push(c);
      else blockChild(c, 'start');
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
      // 先の子の keep を見たら、その子まで読んだとする (design/resumable-flow.md の 5.1。前の文書の境目から続けるかを決める読んだ先に入れる)
      this.noteRead(c);
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
    const pageLimit = this.nextLimit;
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
      if (g && this.wm === 'horizontal-tb') trial.outerGrid = { pitch: g.pitch, ascent: g.ascent, ...(g.stack ? { stack: true } : {}), origin: seed && g.origin !== undefined ? g.origin - this.cursor : 0 };
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

  /** 幅を中身で決める箱・段組を 1 段深く組む (入れ子の深さを数える) */
  private nested<T>(f: () => T, column = false): T {
    const c = this.host.nest;
    if (!c) return f();
    c.d++;
    if (column) c.cd++;
    if (c.d > c.maxSeen) c.maxSeen = c.d;
    if (c.cd > c.cSeen) c.cSeen = c.cd;
    try {
      return f();
    } finally {
      c.d--;
      if (column) c.cd--;
    }
  }

  /**
   * 組む手間の上限を超えた: 流れの数が上限を超えたか、段組 (column) が上限より深い。超えたら中身の幅を測らずに組み、段組は 1 段に組む
   * (最初に当たったとき、警告を出す)。上限の内側の文書は、ここが偽なので、組版の結果が変わらない
   */
  private simplified(column = false): boolean {
    const c = this.host.nest;
    if (!c || (!(column && c.cd > c.cmax) && !((this.host.stats?.flows ?? 0) - c.base + (c.charged ?? 0) > c.budget))) return false;
    if (!c.hit) {
      c.hit = true;
      c.warn(diag('limit/measure-nesting', msg(`幅を中身で決める箱・段組の入れ子が深すぎます (組む回数 ${c.budget} 回・段組の入れ子 ${c.cmax} 段まで)。以後の箱は中身の幅を測らずに組み、段組は 1 段に組みました`, `boxes sized by their content and multi-column containers are nested too deeply (up to ${c.budget} layout passes, ${c.cmax} nested multi-column containers); the remaining boxes were laid out without measuring their content, and multi-column containers as a single column`)));
    }
    return true;
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
   * 2 度目の計測を省いても番号は変わらない。試し組みが絶対配置の箱を置いたとき (跡が残る) は覚えない (host.volatile.n)。
   * record が真なら、覚えを引かずに必ず compute を呼び、その値を覚える (組んだ結果そのものも要る所で、値だけを後で memoPeek で引くため)
   */
  private memoMeasure<T>(site: string, arr: object, st: ResolvedStyle, parts: ReadonlyArray<string | number | boolean | undefined>, foot: FootnoteCtx | undefined, compute: () => T, record = false): T {
    const memo = this.host.measureMemo;
    const vol = this.host.volatile;
    if (!memo || !vol) return compute();
    const key = this.memoKey(site, parts);
    let m = memo.get(arr);
    if (!record) {
      const hit = this.memoFind<T>(m, key, st, foot);
      if (hit) return hit.v;
    }
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
    // record のときは、同じ条件の前の値を置き換える (組み直すたびに、同じ条件の値を積まない)
    const into = record ? m.get(key)?.filter((e) => !(e.foot === foot && sameStyle(e.st, st))) : m.get(key);
    if (record && into) m.set(key, into);
    if (into) into.push({ st, foot, cites, v });
    else m.set(key, [{ st, foot, cites, v }]);
    return v;
  }

  /** memoMeasure の鍵 (計測の場所・条件・ページの大きさ・左右) */
  private memoKey(site: string, parts: ReadonlyArray<string | number | boolean | undefined>): string {
    const page = this.pageSize();
    const side = this.sideNumber();
    return `${site}|${parts.join('|')}|${page.width}|${page.height}|${side === undefined ? '' : side % 2}`;
  }
  private memoFind<T>(m: Map<string, MeasureEntry[]> | undefined, key: string, st: ResolvedStyle, foot: FootnoteCtx | undefined): { v: T } | undefined {
    const list = m?.get(key);
    if (!list) return undefined;
    const pn = this.host.pageNumber?.();
    for (const e of list) if (e.foot === foot && sameStyle(e.st, st) && e.cites.every((c) => this.host.cite(...c.args, pn) === c.value)) return { v: e.v as T };
    return undefined;
  }
  /** memoMeasure が覚えた値を引くだけ (無ければ undefined。組まない) */
  private memoPeek<T>(site: string, arr: object, st: ResolvedStyle, parts: ReadonlyArray<string | number | boolean | undefined>, foot: FootnoteCtx | undefined): T | undefined {
    const memo = this.host.measureMemo;
    if (!memo || !this.host.volatile) return undefined;
    return this.memoFind<T>(memo.get(arr), this.memoKey(site, parts), st, foot)?.v;
  }

  /**
   * 中身の幅 (いちばん長い行の長さ) を、行の長さ rootI で測る (intrinsic の計測。表のセル・見出し・shrink-to-fit の箱の最小・最大の幅)。
   * 同じ中身・同じ条件の計測は、同じ組版の中で 1 度だけ行う (memoMeasure)
   */
  private intrinsicWidth(children: LBlock['children'], st: ResolvedStyle, rootI: number, minContent = false): number {
    const r = Math.max(rootI, 1);
    // CSS の箱 (float・inline-block・絶対配置の shrink-to-fit) では、中の、長さで大きさを書いた箱は、その箱の外側の大きさを数える
    // (CSS Sizing 3 §5.1。表のセルの中身の幅と同じ測り方。maxLineLength の countFixed)。XSL-FO の文書は、これまでどおり中の行を測る
    const fixed = !this.host.xslSpace;
    return this.memoMeasure(fixed ? 'iwx' : 'iw', children, st, [r, minContent], undefined, () =>
      maxLineLength(this.measureSub(children, st, r, { intrinsic: true, ...(minContent ? { minContent: true } : {}) }).sub.root, true, false, fixed, !minContent),
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
      this.memoMeasure('iwx', node.children, st, [rootI, min], undefined, () => maxLineLength(this.measureSub(node.children, st, rootI, { intrinsic: true, ...(min ? { minContent: true } : {}) }).sub.root, true, false, true, !min));
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
    // 百分率の寸法は、いまの箱 (包含ブロック) の内容の幅で解く (CSS 2.1 §10.1・§10.2)。絶対配置の箱は、基準の箱を組んでから解く
    if (node.type === 'block') {
      // 続きの位置の記録 (BlockStep)。続きから組むときは、記録の段の節 (百分率を解いた後のもの) から組む
      const r = this.takeStep('block');
      if (r && r.orig !== node) throw new Error('kumiori: the resume position does not match (block)');
      if (!r && !this.rs) return this.layoutBlock(this.resolvePercent(node, true), ps);
      const depth = this.rs!.length;
      const step: BlockStep = r ?? { k: 'block', orig: node, node: node as LBlock, phase: '' };
      this.rs!.push(step);
      try {
        this.layoutBlock(r ? r.node : this.resolvePercent(node, true), ps, step, !!r);
      } finally {
        this.rs!.length = depth;
      }
    } else if (node.type === 'table') {
      // 続きの位置の記録 (TableStep)。続きから組むときは、記録の段の表 (百分率を解いた後のもの) から組む
      const r = this.takeStep('table');
      if (r && r.orig !== node) throw new Error('kumiori: the resume position does not match (table)');
      if (!r && !this.rs) return this.layoutTable(this.resolvePercent(node, false), ps);
      const depth = this.rs!.length;
      const table = r ? r.table : this.resolvePercent(node, false);
      const step: TableStep = r ?? { k: 'table', orig: node, table, phase: '' };
      this.rs!.push(step);
      try {
        this.layoutTable(table, ps, step, !!r);
      } finally {
        this.rs!.length = depth;
      }
    }
    else if (node.type === 'block-container') {
      // ページをまたいでブロックとして組むコンテナ (layoutContainerIn) は、ブロックの段で続ける。続きから組むときは、そのブロックから組む
      const orig = node;
      const r = this.rs || this.resume ? this.takeStep('block') : undefined;
      if (r) {
        if (r.orig !== node) throw new Error('kumiori: the resume position does not match (block-container)');
        const depth = this.rs!.length;
        this.rs!.push(r);
        try {
          this.layoutBlock(r.node, ps, r, true);
        } finally {
          this.rs!.length = depth;
        }
        return;
      }
      if (!node.absolutePosition) node = this.resolveColumns(this.resolvePercent(node, false));
      // 流れの中のブロックコンテナ (高さの決まった flex の容器など) も、rtl では右端から置く (左の余白を残りに合わせる)
      if (!node.absolutePosition && !node.rotation && resolveStyle(ps, node).wm === this.wm) {
        const d = describeBox(node, this.wm);
        const e = this.rtlEdge(d, node, ps);
        if (e !== d) node = withRef(node, { ...node, margin: { ...d.marginP, left: e.m.is } });
      }
      if (!this.rs || node.absolutePosition) return this.layoutContainer(node, ps);
      const depth = this.rs.length;
      const step: BlockStep = { k: 'block', orig, node: undefined as unknown as LBlock, phase: '' };
      this.rs.push(step);
      this.boxStep = { step, via: node };
      try {
        this.layoutContainer(node, ps);
      } finally {
        this.boxStep = undefined;
        this.rs.length = depth;
      }
    }
  }

  // ── ブロック ──

  /** step は続きの位置の記録の段 (layoutBlockLevel が積んだもの)。resuming なら、その段の位置から組む */
  layoutBlock(node: LBlock, ps: ResolvedStyle, step?: BlockStep, resuming = false) {
    if (resuming && step!.phase === 'body') return this.blockBody(step!.ctx!, step);
    if (resuming && step!.phase === 'open') return this.blockOpen(step!.open!, step, true);
    if (this.host.stats && !resuming) this.host.stats.blocks++;
    if (step) step.node = node;
    const st = resolveStyle(ps, node);
    if (st.wm !== this.wm) return this.layoutOrthogonal(node, st, ps);
    if (node.breakBefore && (!resuming || step!.phase === 'pre')) {
      if (step) step.phase = 'pre';
      try {
        this.forceBreak(node.breakBefore);
      } finally {
        if (step) step.phase = '';
      }
      // 百分率の寸法は、区切った後のページの包含ブロックで解き直す (ページごとに領域の幅が違うとき。CSS Fragmentation 3 §5.1)
      node = this.resolvePercent(node, true);
      if (step) step.node = node;
    }
    if (node.keepTogether && this.paginating) {
      if (resuming && step!.phase === 'ktc') {
        // 分けない指定の試しの改ページ (keepTogetherCheck) の後から。初めから組む道と同じく、印を戻す
        this.resumeOpen();
        step!.phase = '';
        if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
      } else {
        if (step) step.phase = 'ktc';
        try {
          this.keepTogetherCheck(node, ps);
        } finally {
          if (step) step.phase = '';
        }
      }
    }
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
    // XSL-FO のドロップキャップ (axf:initial-letters) を置いたブロックの後ろのブロックは、字の箱の横に字下げして置くが、前のブロックとの間に
    // 空き (space-before・前のブロックの space-after など) があれば、字下げせずに、字の箱の下へ送る (製品の公開の説明の、ドロップキャップの節)
    if (this.host.xslSpace && this.floats.length && Math.max(this.pendingValue(), desc.m.bs) > EPS) {
      const y = this.floats.reduce((a, p) => (p.ilAfter ? Math.max(a, p.b1) : a), -Infinity);
      if (y > this.cursor + this.pendingValue()) this.pendMin = Math.max(this.pendMin, y - this.cursor);
    }
    // 幅の決まった箱の auto の余白 (CSS 2.1 §10.3.3): 置く場所の残りを、auto の側に配る。'start' は margin-left (縦書きは margin-top) が auto。
    // 余白の is は direction によらず左 (上) の側なので、rtl でも入れ替えない (auto の余白は物理の左右で決まる)
    // 中身の幅の計測 (intrinsic) では、auto の余白は 0 (CSS Sizing 3 §5.1 の寄与は、箱の外側の大きさ。auto の余白は残りを配るもので、
    // 計測の行の長さ (max-content では非常に長い) の残りを配ると、その余白が中身の幅に入ってしまう)
    // 置く場所より広い箱 (残りが負) は、auto の余白を 0 にして制約が余るので、包含ブロックの direction が rtl なら margin-left が
    // 残りを取り、箱は左へはみ出す (§10.3.3。auto でない余白の rtlEdge と同じ。横書きだけ)
    /** 寄せる前の残り (ページをまたいだ続きの断片で寄せ直すため。Frame.autoM) */
    let autoFree: number | undefined;
    const autoRtl = ps.direction === 'rtl' && this.wm === 'horizontal-tb' && !this.host.xslSpace;
    const autoMargins = (d: BoxDesc): BoxDesc => {
      if (!node.autoMargins || d.isizeExplicit == null || this.intrinsic) return d;
      const free = this.contentI() - d.m.is - d.m.ie - d.bpI - d.isizeExplicit;
      const am = node.autoMargins;
      autoFree = free;
      if (free < -EPS && autoRtl) return { ...d, m: { ...d.m, is: d.m.is + free } };
      return free > EPS ? { ...d, m: { ...d.m, is: d.m.is + (am === 'center' ? free / 2 : am === 'start' ? free : 0) } } : d;
    };
    // 読み込みのときに見積もりから長さにした大きさ (百分率の幅など。BoxStyle.estimatedSize) は、中身の幅を測る組版では auto として組む
    // (CSS Sizing 3 §5.2.1: 包含ブロックの大きさによる百分率は、中身の幅の寄与を測るときは初期値 auto)。長さの上限・下限は、
    // 測った中身の幅に当てる (§5.1: 寄与は max-width で頭打ち、min-width で底上げ。LNode.intrinsicClamp)。下限は組む幅にも当てる
    // 指定が auto の大きさを見積もりで抑えたもの (estimatedSize の auto) は、組むときも、置く場所の幅を上限・下限で抑えた幅にする (CSS 2.1 §10.4)
    const estAll = !node.inlineSizing ? node.estimatedSize?.[this.wm === 'horizontal-tb' ? 'width' : 'height'] : undefined;
    const est = this.intrinsic ? estAll : undefined;
    const estAdj = (v: number | undefined) => (v === undefined ? undefined : node.boxSizing === 'border-box' ? Math.max(v - desc.bpI, 0) : v);
    // 縦書きの箱の、高さ (inline の向き) が auto の上限・下限 (estimatedSize.height の auto。読み込みは見積もりの長さを入れない) も同じ
    if (estAll && (desc.isizeExplicit != null || (estAll.auto && this.wm !== 'horizontal-tb')) && (est || estAll.auto)) {
      const hi = estAdj(estAll.max);
      const lo = estAdj(estAll.min);
      const avail = Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0);
      const used = Math.max(est ? avail : Math.min(avail, hi ?? Infinity), lo ?? 0);
      desc = { ...desc, isizeExplicit: !est || (lo !== undefined && lo > avail) ? used : undefined };
    }
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
    // 中身の幅を測る組版で、箱の外側の大きさを数える (LNode.fixedI) のは、作成者が長さで書いた大きさの箱だけ。見積もりから決めた大きさ (est) と、
    // 内容による大きさ (inlineSizing。測る行の長さで決まる下限・上限を含む) の箱は、中身を数える (CSS Sizing 3 §5.1・§5.2.1)
    // float を避けて余白を広げた箱 (上の bfc) は、寄せ直さない
    const autoOk = autoFree !== undefined && node.autoMargins && desc.isizeExplicit != null && !(node.bfc && this.floats.length);
    const outerI = this.contentI();
    this.blockOpen({ node, st, desc, est, autoOk: !!autoOk, autoFree, outerI, autoRtl }, step, false);
  }

  /**
   * ブロックの中ほど: 前の箱の break-after (保留の区切り) を効かせ、箱を開き、中身を組む (blockBody)。o は前半で決めた値
   * (続きから組むときは、写した値から入り、保留の区切りの改ページの後から組む)
   */
  private blockOpen(o: BlockOpen, step: BlockStep | undefined, resuming: boolean) {
    const { node, st, desc, est, autoOk, autoFree, outerI, autoRtl } = o;
    const estAdj = (v: number | undefined) => (v === undefined ? undefined : node.boxSizing === 'border-box' ? Math.max(v - desc.bpI, 0) : v);
    // 前の箱の break-after (openFrame の初めと同じ所。ここで効かせるので、openFrame の中では効かせるものが無い)
    if (step) {
      step.open = o;
      step.phase = 'open';
    }
    try {
      if (resuming) this.forceBreak();
      else this.applyPendingBreak();
    } finally {
      if (step) step.phase = '';
    }
    const frame = this.openFrame(desc, 'block', !est && !node.inlineSizing);
    const PW = node.percent;
    if (PW && (PW.width || PW.maxWidth || PW.minWidth) && this.wm === 'horizontal-tb' && !this.intrinsic && !node.inlineSizing && !node.aspectRatio) frame.pctI = { P: PW, borderBox: node.boxSizing === 'border-box' };
    if (autoOk && this.wm === 'horizontal-tb') frame.autoM = { am: node.autoMargins!, free: autoFree!, parentI: outerI, boxI: desc.isizeExplicit! + desc.bpI, ...(autoRtl ? { rtl: true as const } : {}) };
    if (est) {
      const hi = estAdj(est.max);
      const lo = estAdj(est.min);
      if (hi !== undefined || lo !== undefined) frame.node.intrinsicClamp = { ...(hi !== undefined ? { max: hi + desc.bpI } : {}), ...(lo !== undefined ? { min: lo + desc.bpI } : {}) };
    }
    // 中の絶対配置の箱の基準になる箱 (CSS の position が static でない箱)・position: relative でずらす箱は、断片を集める
    const outerCb = this.cbAbs;
    const cb = node.containingBlock ? (this.cbAbs = { frame, items: [] }) : undefined;
    if (cb || node.relativeOffset) frame.frags = frame.opened ? [frame.node] : [];
    // 行グリッド (アンテナハウスの baseline-grid): new はこの箱の字の大きさと line-height、root は根元の書式で作る。none は解除。
    // baseline-block-snap は扱わない
    if (node.baselineGrid === 'none') frame.grid = null;
    else if (node.baselineGrid === 'new' || node.baselineGrid === 'root') {
      const g = node.baselineGrid === 'root' ? (this.host.gridRootStyle ?? this.rootStyle ?? st) : st;
      frame.grid = {
        pitch: lineHeightOf(g),
        ascent: this.nominalRatio(g) * g.fontSize,
        ...(node.baselineGrid === 'root' ? { root: true } : {}),
        ...(node.baselineGrid === 'new' && node.baselineGridStack ? { stack: true } : {}),
      };
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
    // 百分率の text-indent: 基準は、この箱の内容の幅 (CSS Text 3 §8.1。測る組版で、その幅が測る幅によるときは 0。CSS Sizing 3 §5.2.1)
    const ti = node.percent?.textIndent;
    this.blockBody({ node, cst: ti ? { ...st, textIndent: ti.pct * (frame.indefI ? 0 : frame.contentI) + ti.len } : st, desc, frame, cb, outerCb, floatsBefore, fence, outerRef, refLines, outerBlocked, blockAt: this.blockAt }, step);
  }

  /** ブロックの後半: 中身を組み、箱を閉じる (続きから組むときは、写した値 (BlockCtx) から入る) */
  private blockBody(ctx: BlockCtx, step: BlockStep | undefined) {
    const { node, desc, frame, cb, outerCb, floatsBefore, fence, outerRef, refLines, outerBlocked } = ctx;
    // 診断の場所: 中の行の警告 (行が収まらないなど) は、この箱の場所にする
    this.blockAt = node;
    if (step) {
      step.ctx = ctx;
      step.phase = 'body';
    }
    try {
      this.layoutChildren(node.children, ctx.cst, !!node.spanContinued);
    } finally {
      this.blockAt = ctx.blockAt;
      if (step) step.phase = '';
    }
    // 参照領域の末尾の conditional な余白も捨てる (外の余白と重ね合わせない)
    if (fence) {
      // 段をまたぐブロックの領域 (keepAreaEnd。layoutColumnSegments) は、終わりの retain の余白を残す (§4.3.1。1 つの箱に組む段組の
      // layoutColumnSpanner と同じ)
      const keep = (node as { keepAreaEnd?: boolean }).keepAreaEnd && frame.opened ? this.keptPending() : 0;
      this.resetPending();
      if (keep > 0) {
        this.cursor += keep;
        this.adjacent = keep;
      }
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
      const fb = maxOf(this.floats.filter((f) => (f.seq ?? 0) > floatsBefore).map((f) => f.b1));
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
        // ずらしは物理の向き (右・下が正)。縦書きの流れでは、行の向きが縦、block 方向が横 (vertical-rl は右から左)
        if (this.wm === 'horizontal-tb') {
          n.i += node.relativeOffset.x;
          n.b += node.relativeOffset.y;
        } else {
          n.i += node.relativeOffset.y;
          n.b += this.wm === 'vertical-rl' ? -node.relativeOffset.x : node.relativeOffset.x;
        }
      }
    if (node.breakAfter) this.setBreakNext(node.breakAfter);
  }

  /**
   * 絶対配置の基準になるブロックを組み終えたら、中の絶対配置の箱を組み、その内容の箱を基準に置く (CSS 2.1 §10.3.7・§10.6.4)。
   * top があれば最初の断片、bottom があれば最後の断片、どちらも無ければ見つけた所 (static position) の断片の子にする
   */
  private placeCbAbs(cb: CbAbs) {
    this.placeAbsIn(cb.frame.frags ?? [], cb.items, true);
  }

  /**
   * 絶対配置の箱 items を組み、基準の箱の断片 frags (ブロック・表・セルの箱) の内容の箱を基準に置く (CSS 2.1 §10.1 の 4: 基準は、
   * position が static でない最も近い祖先の padding の箱。読み込みが、位置の指定を内容の箱からの距離に直してある)。
   * 位置は物理の向き (left・top・right・bottom) なので、縦書きの基準の箱では、内容の箱の左上からの物理の位置 (LNode.phys) で置く。
   * note: 置いた箱の id を、いまのページのものとして控える (セルの中に置くときは、行を置くときに控えるので false)
   */
  private placeAbsIn(frags: LNode[], items: CbItem[], note: boolean) {
    if (!frags.length) return;
    const done = new Set<LBlockContainer>();
    for (const it of items) {
      const { node } = it;
      if (done.has(node)) continue;
      // 別の流れ (セルの中) で見つけた箱: 見つけた所を、基準の箱の断片の中の位置に直す
      let frag = it.frag;
      let sx = 0;
      let sy = it.sy;
      const mark = it.staticKey !== undefined ? locateStaticAnchor(frags, it.staticKey) : undefined;
      if (mark) {
        // 行の中で見つけた箱: 目印の箱の、行の中の位置と、その行の上端 (CSS 2.1 §10.3.7・§10.6.4)
        frag = mark.k;
        sx = mark.i;
        sy = mark.b;
      } else if (it.anchor) {
        const at = locateNode(frags, it.anchor);
        if (!at) continue;
        frag = at.k;
        sx = at.i;
        sy += at.b;
      }
      done.add(node);
      const f = node.top != null ? frags[0] : node.bottom != null ? frags[frags.length - 1] : frags[Math.min(frag, frags.length - 1)];
      const bw = (e: 'top' | 'right' | 'bottom' | 'left') => f.border[e]?.width ?? 0;
      const size = physSize(f.isize, f.bsize, f.wm);
      const w = Math.max(size.width - f.padding.left - f.padding.right - bw('left') - bw('right'), 0);
      const h = Math.max(size.height - f.padding.top - f.padding.bottom - bw('top') - bw('bottom'), 0);
      const n = this.buildContainer(withCbPercent(node, h, w, f.wm !== 'horizontal-tb'), it.st, w, h);
      const at = n.phys ?? { x: 0, y: 0 };
      delete n.phys;
      const staticB = sy + (node.staticOffset ?? 0);
      if (f.wm === 'horizontal-tb') {
        // 左右の位置の指定が無ければ、見つけた流れの行の頭 (static position。CSS 2.1 §10.3.7)
        n.i = node.left == null && node.right == null ? at.x + sx : at.x;
        n.b = node.top == null && node.bottom == null ? staticB : at.y;
      } else {
        // 縦書きの基準の箱: static position は、block 方向 (横) が見つけた所、行の向き (縦) が行の頭
        const nb = bboxOf(n);
        const x = node.left == null && node.right == null ? (f.wm === 'vertical-rl' ? w - staticB - nb.width : staticB) : at.x;
        const y = node.top == null && node.bottom == null ? sx : at.y;
        n.phys = { x, y };
      }
      // 流れの外の箱 (CSS 2.1 §9.3.1)。祖先の中身の幅には数えない (maxLineLength。§10.1・CSS Sizing 3 §5)
      if (!this.host.xslSpace) n.outOfFlow = true;
      f.children.push(n);
      if (note) this.noteIds(n);
    }
  }

  /**
   * 行内の箱を基準にする絶対配置の箱 (LBlockContainer.inlineCb) を、行の並びを組んだ後で置く (CSS 2.1 §10.1 の 4)。
   * 基準の矩形は、行内の箱の最初の断片の頭 (横書きは左上) と、最後の断片の末尾の側の端 (行の向きは、断片のうちいちばん端のもの) を
   * 結んだ矩形 (padding の箱。行をまたいだ行内の箱の基準は CSS 2.1 では未定義で、CSS Position 3 §2.1 の決め方による)。
   * 行を置いた箱 (ページをまたいだ並びでは、最後の断片) の子にする。行内の箱の断片が見つからなければ (中身の無い箱・前のページで終わった箱)、
   * いまの位置の、大きさの無い矩形を基準にする
   */
  private placeInlineAbs(nodes: LBlockContainer[], ps: ResolvedStyle) {
    this.flush();
    const host = this.containerNode();
    const e = logicalEdges(host);
    const horiz = host.wm === 'horizontal-tb';
    // host の内容の箱の、物理の幅 (vertical-rl は右から積むので、位置の変換に使う)
    const hostW = horiz ? host.isize - e.is - e.ie : host.bsize - e.bs - e.be;
    for (const node of nodes) {
      const range = this.host.inlineCbRange?.(node.inlineCb!);
      const r = (range && inlineBoxRect(host, range[0], range[1])) ?? { i0: 0, b0: Math.max(this.cursor - this.contentStartB(), 0), i1: 0, b1: Math.max(this.cursor - this.contentStartB(), 0) };
      // 論理の矩形 → 物理の矩形 (host の内容の箱の左上から)
      const w = horiz ? r.i1 - r.i0 : r.b1 - r.b0;
      const h = horiz ? r.b1 - r.b0 : r.i1 - r.i0;
      const x = horiz ? r.i0 : host.wm === 'vertical-rl' ? hostW - r.b1 : r.b0;
      const y = horiz ? r.b0 : r.i0;
      const n = this.buildContainer(withCbPercent(node, Math.max(h, 0), Math.max(w, 0), !horiz), resolveStyle(ps, node), Math.max(w, 0), Math.max(h, 0));
      const at = n.phys ?? { x: 0, y: 0 };
      delete n.phys;
      if (horiz) {
        n.i = x + at.x;
        n.b = y + at.y;
      } else n.phys = { x: x + at.x, y: y + at.y };
      if (!this.host.xslSpace) n.outOfFlow = true;
      host.children.push(n);
      this.noteIds(n);
    }
  }

  /**
   * セルの中の流れで見つけた絶対配置の箱 (Flow.foreignAbs) を、セルを組んだ流れで受け取る。cell はセルの箱 (見つけた所の基準)。
   * いちばん近い基準のブロック・表 (cbAbs) があればそこへ、この流れもセルの中なら更に外へ渡す。
   * どちらでもなければ (読み込みは、基準の箱を組版が置けるときだけ positionInContainer にするので、ふつうは起きない)、ページの上に置く
   */
  private handOffAbs(items: CbItem[], cell: LNode) {
    for (const it of items) {
      const item: CbItem = it.anchor ? it : { ...it, anchor: cell };
      if (this.cbAbs) this.cbAbs.items.push(item);
      else if (this.collectAbs && !this.localAbs) this.foreignAbs.push(item);
      else {
        const page = this.pageSize();
        const la = this.localAbs;
        if (la && la.h == null && cbPercentB(it.node)) {
          (la.late ??= []).push({ node: it.node, st: it.st });
          continue;
        }
        const n = this.buildContainer(la ? withCbPercent(it.node, la.h ?? page.height, la.w) : atPageArea(it.node, page), it.st, la ? la.w : page.width, la ? (la.h ?? page.height) : page.height);
        if (la) la.list.push({ n, node: it.node });
        else this.abs().push(n);
        this.noteIds(n);
      }
    }
  }

  /** 読んだ先 (FlowHost.read) を、節 n まで進める (n の欄を見て組み方を決めたとき) */
  private noteRead(n: unknown) {
    const rd = this.host.read;
    const r = sourceRef(n);
    if (rd && r !== undefined && r > rd.to) rd.to = r;
  }

  /**
   * keep-together="always" のブロック (keepOverflow。アンテナハウス互換) を、前の keep-with-next の並びの後ろに、分けずに置くか。
   * 並び (children の topAt から ci の前まで、keep-with-next・keep-with-previous でつながる) がページの先頭から始まり、まだ同じページにあり、
   * ブロックがいまのページの残りに入らない (けれど、1 ページには入る) ときは、ブロックを次のページへ送っても並びとつながらない
   * (並びごと送っても同じ所で入らない)。そのとき、ページの上限を延ばす長さ (はみ出す長さ) を返す。それ以外は undefined
   * (keepTogetherCheck がふだんどおり、入らなければ次のページへ送る)
   */
  private holdKeepTogether(children: Array<LBlockLevel | LInlineLevel>, ci: number, topAt: number, topPage: number, ps: ResolvedStyle): number | undefined {
    if (!this.paginating || this.keepTrial || topAt < 0 || topAt >= ci || topPage !== this.pageSerial || !this.pageHasContent) return undefined;
    const blockAt = (k: number): LBlock | LTable | LBlockContainer | undefined => {
      const c = children[k];
      // 先の子の keep を見たら、その子まで読んだとする (design/resumable-flow.md の 5.1。前の文書の境目から続けるかを決める読んだ先に入れる)
      this.noteRead(c);
      return typeof c !== 'string' && (c?.type === 'block' || c?.type === 'table' || (c?.type === 'block-container' && !c.absolutePosition)) ? c : undefined;
    };
    for (let k = topAt; k < ci; k++) if (!blockAt(k)?.keepWithNext && !blockAt(k + 1)?.keepWithPrevious) return undefined;
    const { need, h } = this.keepTogetherNeed(children[ci] as LBlock, ps);
    const over = this.cursor + need - this.room;
    if (over <= EPS || h > this.room + EPS) return undefined;
    this.host.warn(withSource(diag('layout/keep-overflow', msg('keep-together・keep-with-next を保つため、ブロックをページの下へはみ出させました (--compat antenna)', 'a block was let overflow the bottom of the page to keep keep-together and keep-with-next (--compat antenna)')), children[ci]));
    return over;
  }

  /**
   * 高さを測るだけの組み (keep-together の確かめ。結果は捨てる) の間、FlowHost.condense の trial を上げる。この組みは警告の出し先を
   * 切らずに組み (中のセルの流れなどは測る流れの印 (measureOnly) を受け継がない)、ページに置く組みは後で別に行うので、
   * 入れ子の詰め込みの上限の警告 (condenseContainer) を、この中では出さない
   */
  private condenseTrial<T>(f: () => T): T {
    const b = this.host.condense;
    if (b) b.trial++;
    try {
      return f();
    } finally {
      if (b) b.trial--;
    }
  }

  /** keep-together のブロックの高さ (h。末尾の space-after を除く) と、いまの位置から置くのに要る長さ (need。前の余白との相殺を含む) */
  private keepTogetherNeed(node: LBlock | LTable | LBlockContainer, ps: ResolvedStyle): { need: number; h: number } {
    // 結果を捨てる試しの組みなので、警告は出さない (本番の組みが出す。ほかの測る組みと同じ)
    const sub = new Flow({ ...this.host, warn: () => {} }, {
      wm: this.wm,
      rootI: this.contentI(),
      abs: () => [],
      pageSize: this.pageSize,
      footnotes: this.foot,
      measure: true,
    });
    const h = this.condenseTrial(() => {
      sub.layoutBlockLevel(withRef(node, { ...node, keepTogether: false, breakBefore: undefined, breakAfter: undefined } as LBlock | LTable), ps);
      return sub.finishAtomicContent();
    });
    const lead = Math.max(describeBox(node, this.wm).m.bs, 0);
    return { need: Math.max(this.pendingValue(), lead) + Math.max(h - lead, 0), h };
  }

  /**
   * 詰め込み (LBlockContainer.condense。アンテナハウスの拡張の overflow="condense")。容器を測る流れで組んで高さを測り、収める高さを超えるなら、
   * 方法ごとに (font-size・line-height の、書いた順で) 倍率を二分探索して、収まる最も大きい倍率の中身にする。
   * font-size: 容器と中の字の大きさに倍率を掛ける (中で絶対の大きさを書いた節 (fontSizeFixed) とその中身は変えない)。下限は minFontSize。
   * line-height: 行の高さ (比・長さ) に倍率を掛ける。下限は minLineHeight。
   * アンテナハウスの説明 (ahf-ext.html の axf:overflow-condense-limit-font-size・-limit-line-height) のとおり、下限 (初期値 none は 0) より
   * 小さくせず、下限で収まらなければ、はみ出したまま次の方法を試す。最後まで収まらなければ警告に出し、下限の後ろに hidden・error-if-overflow を
   * 書いていれば (clip) 切り抜く。
   * 下限を書いていない (0) 方法で、どれほど縮めても収まらない (倍率をごく小さくしても収まらない。中の絶対の大きさの字・高さを決めた箱が高いなど)
   * ときは、縮めずに打ち切る (説明は、解消できないときは下限の前で打ち切ることがあるとだけ書き、どこで打ち切るかは書いていない。製品の動きは
   * 未照合。読めない大きさの字を残さないよう、その方法では縮めない)。
   *
   * 切り抜く (clip) ときは、箱の高さを収める高さに抑えて、その内容の矩形で切る (XSL 1.1 §7.21.2 の hidden: 内容の矩形の外は見せない)。
   * 収める高さは、height を書いた容器ならその高さ、max-height なら max-height (CSS 2.1 §10.7: 中身の高さが max-height を超えるので、
   * 箱の高さは max-height)、ページに流す本文の keep-together の容器なら、詰めるときに使った本文の領域の高さ。後ろの箱は、抑えた高さの後から続く。
   * max-height が min-height より小さい容器は、詰める目標も切り抜く高さも min-height (CSS 2.1 §10.7: min-height が max-height より大きければ、
   * min-height が勝つので、箱は min-height より低くならない。min-height に収まる中身は詰めない)。
   *
   * 詰めた結果は、同じ組版の中で、同じ容器 (節そのもの)・同じ条件 (容器の書式・内容の幅・収める高さ・書字方向・脚注の番号付け・ページの大きさと
   * 偶奇・中で引いたページ番号の参照の値) なら覚えて使い回す (memoMeasure)。入れ子の詰め込みは、外の容器が測る流れ・本番の流れで何度組んでも
   * 中の容器を詰め直さない。説明 (overflow の condense) のとおり、内側の詰め込みは外の詰め込みに影響されないので、中の容器の結果は外の倍率に
   * よらない (外が写した中身の中でも、中の容器は同じ節のまま。scaleFonts・scaleLineHeights の keptCopy)。覚えないと、外の容器の 1 回の詰め込みで
   * 中の容器を 2〜40 回ほど詰め直すので、組む手間が入れ子の段の数の指数で増える。
   * 入れ子の中の容器 (いちばん外の詰め込みの容器を、詰めて組み終えるまでに詰める容器: 外の容器が中身を測る流れの中と、詰めた後の本番の組みの中)
   * が測る回数には、いちばん外の容器 1 つごとに上限 (FlowHost.condense の max。LayoutOptions.maxCondenseMeasures。数え直すのは layoutContainer)
   * を置き、超えたら、その容器の中の、以後の容器は詰めずに組む (警告は、ページに置く結果に、そうして詰めなかったために収まらない容器が残る
   * ときだけ、文書で 1 度)。
   * いちばん外の容器の測りは数えず、いつも詰める (手間は容器の数に比例するだけで、段の数の指数で増えない)。上限に当たった後の、詰めない結果と、それを使った計測は覚えない (FlowHost.volatile。
   * 同じ節を、ほかのいちばん外の容器として組み直すとき (表の見出しの繰り返しなど) は、数え直して詰める)
   */
  private condenseContainer(node: LBlockContainer, ps: ResolvedStyle): LBlockContainer {
    const c = node.condense!;
    const st = resolveStyle(ps, node);
    const d = describeBox(node, this.wm);
    // 収める高さ (箱の外側。margin・枠・padding を含む)。内容の高さの指定・max-height は内容の高さなので、枠と余白を足す。
    // max-height の百分率は、ページに流す本文では本文の領域の高さに対する値 (ほかの流れでは呼ぶ側が詰めない)
    const edges = d.m.bs + d.m.be + d.bpStart + d.bpEnd;
    const maxContent = c.maxBlock ?? (c.maxBlockPct !== undefined && this.paginating ? this.limit * c.maxBlockPct - edges : undefined);
    // max-height が min-height (minBlockSize。内容の高さ) より小さければ、箱の高さは min-height (CSS 2.1 §10.7: min-height が max-height より
    // 大きければ min-height が勝つ) なので、min-height に収めればよい。height を書いた容器は、その高さ
    const contentLimit = node.height ?? (maxContent !== undefined ? Math.max(maxContent, node.minBlockSize ?? 0) : undefined);
    const limit = Math.min(contentLimit !== undefined ? contentLimit + edges : Infinity, this.limit);
    const budget = this.host.condense;
    // 詰め終えた中身 (condense を外す: 同じ箱を、測る流れや後の組みで詰め直さない)
    const done = (n: LBlockContainer): LBlockContainer => withRef(n, { ...n, condense: undefined });
    // 結果を決めるもの: 節 (node)・容器の書式 (st。中身はこの書式を受け継ぐ)・収める高さ・内容の幅・書字方向。脚注の番号付け・ページの大きさと偶奇・
    // ページ番号の参照は memoMeasure が見る
    const r = this.memoMeasure('condense', node, st, [limit, this.contentI(), this.wm], this.foot, (): { n: LBlockContainer; over: boolean; capped?: boolean } => {
      // 入れ子の中 (いちばん外の詰め込みの容器を詰めて組んでいる最中。layoutContainer) の容器だけを、上限で止める
      const nested = !!budget && (budget.depth > 0 || budget.win > 0);
      // 中身を測る。count なら、入れ子の中の容器の測る回数に数える (LayoutOptions.maxCondenseMeasures)
      const measure = (n: LBlockContainer, count = true): number => {
        if (budget && nested && count) budget.n++;
        const sub = new Flow({ ...this.host, warn: () => {} }, { wm: this.wm, rootI: this.contentI(), abs: () => [], pageSize: this.pageSize, footnotes: this.foot, measure: true });
        // 絶対配置の容器も、流れの中の箱として測る (位置は高さに関わらない)
        const flat = withRef(n, { ...n, condense: undefined, height: undefined, keepTogether: false, breakBefore: undefined, breakAfter: undefined, absolutePosition: undefined, positionInContainer: undefined, inlineCb: undefined, areaOffset: undefined, cbPercent: undefined, top: undefined, left: undefined, right: undefined, bottom: undefined });
        if (budget) budget.depth++;
        try {
          sub.layoutBlockLevel(flat as LBlockContainer, ps);
          return sub.finishAtomicContent();
        } finally {
          if (budget) budget.depth--;
        }
      };
      if (budget && nested && (budget.hit || budget.n > budget.max)) {
        budget.hit = true;
        // 警告は、ここ (測る流れ・試し組みの中でも当たる) では出さず、上限で詰めなかった結果 (capped) を置く所で出す (下)
        // 詰めずに組んだ結果は覚えない (この結果を使った計測も覚えない: 跡を残す試し組みと同じ扱い。FlowHost.volatile)。覚えると、ほかの
        // いちばん外の容器の組み (同じ節を組み直すとき: 表の見出しの繰り返し・次のページへ送り直した容器など) で同じ鍵が当たったときに、
        // 数え直して上限に余裕があっても、詰めない結果を使い回す
        if (this.host.volatile) this.host.volatile.n++;
        // 中身が、詰めなくても収まるか: 1 度だけ測り (上限の数には入れない)、収まらないときだけ、詰めなかった印 (capped) を付ける (収まる容器は、
        // 上限が無くても詰めない)。測った答えは、このいちばん外の容器の組みの間、同じ条件なら覚えて使う (budget.fit。
        // 上限に当たった後は、中の容器はどれも詰めないので、答えは変わらない)。覚えないと、詰めない容器を組むたびに、中の詰めない容器を
        // 測りと組みで 2 度ずつ組み、段の数の指数で手間が増える
        const key = `${limit}|${this.contentI()}|${this.wm}|${st.fontSize}|${st.lineHeight}|${st.lineHeightPt ?? ''}`;
        let fitMap = budget.fit.get(node);
        if (!fitMap) budget.fit.set(node, (fitMap = new Map()));
        let fitsAsIs = fitMap.get(key);
        if (fitsAsIs === undefined) {
          fitsAsIs = measure(node, false) <= limit + EPS;
          fitMap.set(key, fitsAsIs);
        }
        return { n: done(node), over: false, ...(fitsAsIs ? {} : { capped: true }) };
      }
      const fits = (n: LBlockContainer) => measure(n) <= limit + EPS;
      if (fits(node)) return { n: done(node), over: false };
      /** 打ち切りを見分ける、倍率のごく小さい値 */
      const FLOOR = 0.01;
      let cur = node;
      for (const m of c.methods) {
        const base = cur;
        const make = (s: number): LBlockContainer => (m === 'font-size' ? scaleFonts(base, s, st.fontSize, budget?.copies) : scaleLineHeights(base, s, st, budget?.copies));
        // 倍率の下限: 字の大きさは minFontSize ÷ 容器の字の大きさ、行の高さは minLineHeight ÷ 容器の行の高さ (下限が無ければ 0)
        const lineH = st.lineHeightPt ?? st.lineHeight * st.fontSize;
        const minV = m === 'font-size' ? c.minFontSize : c.minLineHeight;
        // 下限が無く (0)、どれほど縮めても収まらない: この方法では縮めない (下限を書いたときは、下限まで縮める)
        if (!minV && !fits(make(FLOOR))) continue;
        const lo0 = minV ? minV / (m === 'font-size' ? st.fontSize : lineH) : 0;
        let lo = Math.min(Math.max(lo0, FLOOR), 1);
        let hi = 1;
        if (fits(make(lo))) {
          // 収まる最も大きい倍率 (0.1% まで)
          for (let k = 0; k < 16 && hi - lo > 0.001; k++) {
            const mid = (lo + hi) / 2;
            if (fits(make(mid))) lo = mid;
            else hi = mid;
          }
          return { n: done(make(lo)), over: false };
        }
        // 下限で収まらない: 下限のまま、次の方法を試す
        cur = make(lo);
      }
      // 切り抜くときは、箱の高さを収める高さ (内容の高さ) に抑える。ただし min-height (minBlockSize) より小さくしない
      // (CSS 2.1 §10.7: min-height が max-height より大きければ、min-height が勝つ。height を書いた容器は、その高さ)
      return { n: done(c.clip ? withRef(cur, { ...cur, overflow: 'hidden' as const, height: node.height ?? Math.max(limit - edges, node.minBlockSize ?? 0, 0) }) : cur), over: true };
    });
    // 測る組み (行内の箱・脚注の本体) でも出す: 結果をそのまま置く組みだから。結果を捨てる試しの組みは、警告の出し先を空にした host で組む
    // (画像の警告と同じ。keepTogetherNeed・keepTogetherCheck・中身の幅で組み直す fo:inline-container の試し組みなど) ので、どこに置いても 1 件
    if (r.over) this.host.warn(withSource(diag('layout/condense-overflow', msg('overflow="condense" の fo:block-container の中身が、詰めても収まりません (はみ出します)', 'the content of an fo:block-container with overflow="condense" does not fit even when condensed (it overflows)')), node));
    // 上限のせいで詰めなかった、収まらない容器を組むとき。収まらないときの警告と同じく、測る流れ (結果をそのまま置く組み) でも出し、keep-together の確かめは
    // trial を上げる (condenseTrial) ので出さない。ほかの、結果を捨てることのある組みは、警告の出し先を空にした host で組む (keep-with-next の
    // 試し組み・段組の段の高さを決める試し組みなど) か、この警告だけを取り置く host (holdCondenseWarnings) で組み、置くと決めたときだけ出す
    // (表の行の高さを測る組み: 行をページで分けるときは、分けた組みの分を出す。layoutTableRows) ので、ページに置く結果に、詰めなかったために
    // 収まらない容器が残るときだけ出る。組み直すたびに、覚えた中の容器の結果を使って先へ進み、最後の組みでは詰め切ることがあるので、当たった所
    // (測る途中) では出さない。文は上限によらず同じにして、文書で 1 度にする (同じ文の警告は LayoutEngine.treeInfo がまとめる)
    if (r.capped && !budget?.trial) this.host.warn(condenseCappedMessage(budget?.opt));
    return r.n;
  }

  /** 直列化して高さを測り、現ページに収まらなければ先に改ページする */
  private keepTogetherCheck(node: LBlock | LTable | LBlockContainer, ps: ResolvedStyle) {
    if (this.keepHold) return; // holdKeepTogether: 並びの後ろに置く (改ページしない)
    // 結果を捨てる試しの組みなので、警告は出さない (本番の組みが出す。ほかの測る組みと同じ)
    const sub = new Flow({ ...this.host, warn: () => {} }, {
      wm: this.wm,
      rootI: this.contentI(),
      abs: () => [],
      pageSize: this.pageSize,
      footnotes: this.foot,
      measure: true,
    });
    // 末尾の space-after はページの終わりでは捨てるので数えない。先頭の space-before は、前の余白と重ね合わせる (大きい方)
    const h = this.condenseTrial(() => {
      sub.layoutBlockLevel(withRef(node, { ...node, keepTogether: false, breakBefore: undefined, breakAfter: undefined } as LBlock | LTable), ps);
      return sub.finishAtomicContent();
    });
    const lead = Math.max(describeBox(node, this.wm).m.bs, 0);
    const need = Math.max(this.pendingValue(), lead) + Math.max(h - lead, 0);
    const over = this.cursor + need > this.room + EPS;
    // 空のページ (段) の頭に置くときに、収まるか: 頭で捨てる余白 (§4.3.1) は数えない
    const retainLead = !!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore;
    const overAtTop = this.discardLeading && !retainLead ? this.cursor + this.flushValue() + Math.max(h - lead, 0) > this.room + EPS : over;
    if (this.pageHasContent && over && h <= this.room) {
      this.breakPage();
      // 送ったブロックの先頭の余白は、強制でない改ページに接するので捨てる (keep-with-next で送るときと同じ。retain の余白は残す)
      if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
    } else if (this.pageHasContent ? over : overAtTop) this.splitKeepTogether++;
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
  outerGrid?: { pitch: number; ascent: number; stack?: boolean; origin: number };

  /** いま効いている行グリッドと、その箱の内容の上端 (この流れの座標。箱がまだ開いていなければ undefined) */
  private currentGrid(): { pitch: number; ascent: number; stack?: boolean; origin?: number } | undefined {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const f = this.stack[k];
      if (f.grid === undefined) continue;
      return f.grid ? { ...f.grid, ...(f.grid.root && this.paginating ? { origin: 0 } : f.opened ? { origin: f.contentStartB } : {}) } : undefined;
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
      // 持ち上げを行の高さに数えない指定 (line-height-shift-adjustment="disregard-shifts"。XSL 1.1 §7.16.5) では、持ち上げる前の位置で数える
      // (行の高さ (lineMetrics) と同じ。見本の PDF: CSS-Print 第 4 版の「PANTONE<sup>®</sup>」の見出しは、上付きで次の格子へ送らない)
      const sh = a.st.lineHeightShiftAdjustment === 'disregard-shifts' ? 0 : (a.shift ?? 0);
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
    // root の格子は、ページの本文の領域の上端から引く (見本の PDF: -ah-baseline-grid: root の figcaption の基線は、どのページでも
    // 本文の領域の上端 + 根元の字のアセント + 根元の行送りの整数倍。箱の上端からではない)。ページに組む流れのときだけ
    const origin = f ? (f.grid!.root && this.paginating ? 0 : f.opened ? f.contentStartB : (simOrigin ?? lineTop)) : this.outerGrid!.origin;
    const em = lineTop + lm.leading / 2 + lm.above;
    // 行の em の箱の上端が格子の上に出ないこと。格子を作った字 (root なら根元の字) の em の箱の上の長さ (ascent) も下限にする
    // (見本の PDF: CSS-Print 第 4 版の -ah-baseline-grid: root の figcaption (根元より小さい字) は、上端 + 根元の字の em の上の長さが
    // 格子の基線を越えれば、次の格子に載る)
    const cand = lineTop - (box?.prevTrail ?? 0) + Math.max(box?.above ?? this.nominalRatio(st) * st.fontSize, ascent);
    // 格子に載せない行グリッド (LBlock.baselineGridStack): em の箱をそのまま積む (最初の行は内容の上端 + 字の em の上の長さ)
    if (g.stack) return Math.max(origin + ascent, cand) - em;
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
    // 続きの位置の記録 (InlineStep)。続きから組むときは、前半 (字を平らにし、行に分ける) を飛ばし、写した行から置く
    const r = this.takeStep('inline');
    if (r && r.src !== run) throw new Error('kumiori: the resume position does not match (inline)');
    if (!r && !this.rs) return this.layoutInlineRunIn(run, st, first, from, undefined);
    const depth = this.rs!.length;
    const step: InlineStep = r ?? { k: 'inline', src: run, phase: '', idx: 0 };
    this.rs!.push(step);
    try {
      if (r) this.placeInlineLines(r.ctx!, step, r.phase as 'pending' | 'top' | 'bottom');
      else this.layoutInlineRunIn(run, st, first, from, step);
    } finally {
      this.rs!.length = depth;
    }
  }

  private layoutInlineRunIn(run: InlineChild[], st: ResolvedStyle, first: boolean, from: { arr: object; at: number } | undefined, step: InlineStep | undefined) {
    this.rootStyle ??= st;
    // 段落の最初の字 (initial-letter) の箱に、最初の行の字下げを移した: 続く行内の並びには掛けない
    if (this.skipIndent) {
      this.skipIndent = false;
      if (st.textIndent) st = { ...st, textIndent: 0 };
    }
    // 索引のページ番号の並び (XSL 1.1 §6.10.7) は、ここで字と行内の箱に置き換える (索引を使う文書だけ)
    if (this.host.index) run = this.host.index(run);
    const L = this.contentI();
    // 書いた所の行に置く float (lineFloats) のある並びも、行ごとに使える幅が変わるので 1 行ずつ組む
    const floating = this.deferredFloats.length > 0 || !!this.lineFloats?.size || this.floats.some((f) => f.b1 > this.cursor + this.pendingValue() + EPS);
    // 同じ段落を同じ幅で組み直すとき (段の高さ揃え・keep-with-next の試し組みなど) は、行分けの結果を使い回す
    // 入力の節の番号の無い字は、それを含む block の番号を持つ (下の blockRef) ので、その番号も覚えの鍵に入れる (包むブロックの違う組み
    // (試し組み・測る組みの流れなど) の覚えを使うと、字の番号が変わる)
    const blockRef0 = this.stack[this.stack.length - 1]?.desc.ref;
    let memo = !floating && from ? lineMemoGet(from.arr, from.at, run, st, L, first, this.wm, this.host, this.intrinsic, this.gridItemMin ? 'grid' : this.minContent, blockRef0) : undefined;
    // 文書をまたぐ覚え (SharedLineMemo): 前の文書で、中身の同じ段落を同じ幅・書式・書体の組で組んだ結果。入力の節の番号の無い字は、
    // それを含む block の番号を持つので、その番号も鍵に入れる
    const shared = !floating && from && !memo ? this.host.sharedLines : undefined;
    const sharedKey = shared ? sharedLineKey(run, st, L, first, this.wm, this.host, this.intrinsic, this.gridItemMin ? 'grid' : this.minContent, blockRef0) : undefined;
    if (shared && sharedKey !== undefined) {
      memo = shared.memo.get(sharedKey, shared.env, shared.fonts, this.host.hyphenate);
      if (memo) {
        if (this.host.stats) this.host.stats.sharedLineHits = (this.host.stats.sharedLineHits ?? 0) + 1;
        // 同じ文書の中で組み直すときは、これまでどおり、子の配列で引く覚えから使う
        lineMemoSet(from!.arr, from!.at, run, st, L, first, this.wm, this.host, this.intrinsic, this.gridItemMin ? 'grid' : this.minContent, memo, blockRef0);
      }
    }
    let atoms: Atom[];
    let raws: RawLine[];
    let pls: PositionedLine[];
    let lms: LineMetrics[];
    // 組む間に書体の知らせ (整形の表の誤りなど) が出た段落は、文書をまたぐ覚えに入れない (FontManager.noticeCount)
    const notices0 = shared ? shared.fonts.noticeCount : 0;
    if (memo) ({ atoms, raws, pls, lms } = memo);
    else {
      const flat = (r: InlineChild[]) => flattenInline(r, st, this.host.measurer, {
        run: 0,
        footnote: this.foot ? { label: (fn) => this.foot!.label(fn), scale: this.foot.referenceScale } : undefined,
        cite: (id, last, format, physical, style) => this.host.cite(id, last, format, physical, style, this.host.pageNumber?.()),
        image: (c, ps) => this.imageBox(c, ps),
        inlineBox: (c, ps) => this.inlineContainerBox(c, ps),
        containerI: L,
        // 行内の箱の子に入ったブロックは、行の中に置けない (読み込みがブロックの前後で行内の箱を分けなかった経路。CSS 2.1 §9.2.1.1)。黙って捨てずに知らせる
        dropped: (t) => this.host.warn(withSource(diag('layout/inline-block-dropped', msg(`行内の箱の中のブロック (${t}) を置けないため、その中身を省きました`, `a block (${t}) inside an inline box cannot be placed; its content was omitted`)), this.blockAt)),
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
          // 割注の字の送りと改行の機会を、2 行に割ったときのものにしてから 1 行目を分ける (warichu.ts)。書き換えるのは、分ける位置を決めるための
          // 写しだけ: 組む atom (styled) は、ほかの行と同じく、和文の字間の調整 (adjustJapaneseSpacing) の後で書き換える
          let probe = styled;
          if (styled.some((a) => a.wari)) {
            probe = styled.map((a) => ({ ...a }));
            prepareWarichu(probe);
          }
          const { next } = breakOne(probe, 0, L, lineIndent(st, true, false), true);
          atoms = [...styled.slice(0, next), ...atoms.slice(next)];
        }
      }
      // 入力の節の番号の無い字 (block の直下の文字) は、それを含む block の番号
      const blockRef = this.stack[this.stack.length - 1]?.desc.ref;
      if (blockRef !== undefined) for (const a of atoms) a.ref ??= blockRef;
      glueAfterCssLeaders(atoms);
      // 語の途中で折ってよい、つながる字の語 (アラビア文字など) を、字ごとの断片に分ける (CSS Text 3 §5.1・§5.5。splitJoinedAtoms)
      if (atoms.some((a) => a.splitJoined)) splitJoinedAtoms(atoms, L, !!this.intrinsic);
      markLineBreaks(atoms);
      // 語間を追込みで詰めない行 (XSL-FO の仕様モード: 両端揃えで組まない行) の印。揃えは、この行を持つブロックの値
      markWordSqueeze(atoms, st);
      // 互換モードのセルの最小の幅: 印の付いた img の前後は改行の機会にしない (Quirks Mode Standard §3.8)
      if (this.minContent)
        atoms.forEach((a, i) => {
          if (!a.noWrapInCellMin) return;
          a.lbBefore = false;
          if (atoms[i + 1]) atoms[i + 1].lbBefore = false;
        });
      if (this.intrinsic) for (const a of atoms) a.intrinsic = true;
      if (this.gridItemMin) for (const a of atoms) a.hyphenMin = true;
      // 中身の無い目印 (<a id="…"></a>) だけの並びは、行を作らない (字も中身も枠も無い行の箱は高さ 0。CSS 2.1 §9.4.2)。id だけを記録する
      if (atoms.some((a) => a.idMark) && atoms.every((a) => a.idMark || (a.kind === 'glyph' && a.isSpace))) {
        // WeasyPrint の組み方: 行は作らないが、保留中の余白をここで確定し、後ろの余白と相殺させない (行を置くときと同じ順に、
        // 保留中の改ページを先にする)。目印の id は、確定した後のページで記録する
        if (this.host.idLinesSeparateMargins) {
          this.applyPendingBreak();
          this.flush();
        }
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
              // つながる字の語を分けた断片の間: 字の組の詰めは、語の中の位置合わせ (書体が語ごとに決めたもの) に任せる
              if (b.joinPiece) return 0;
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
      if (markBidi(atoms, this.wm === 'horizontal-tb' && st.direction === 'rtl', ms, this.wm, st.unicodeBidi)) placeAutospaceBidi(atoms);
      // 割注の字の送りと改行の機会を、2 行に割ったときのものにする (warichu.ts)
      if (atoms.some((a) => a.wari)) prepareWarichu(atoms);
      // 回り込みがある (または次ページ先頭に float が来る) 場合は、行ごとに使える幅が変わるので 1 行ずつ組む
      if (floating) {
        this.layoutInlineRunFloating(atoms, st, first);
        return;
      }
      // 行の並べ方の選び方 (CSS Text 4 §5.4 の text-wrap-style: balance・pretty)。中身の幅を測る組版 (min-content・max-content・
      // grid の項目の最小の幅) では使わない (測るのは並べ方によらない幅)。::first-line のある段落の最初の行は、書式を変えた字で
      // 1 行目を切り出してあるので、切り直さない (1 行目の中身が変わると、書式を当てた字と食い違う)。回り込みの経路
      // (layoutInlineRunFloating) も、行ごとに長さが変わるので、1 行ずつ先から決める
      const wrapStyle = st.textWrapStyle === 'balance' || st.textWrapStyle === 'pretty' ? st.textWrapStyle : undefined;
      const wrap = wrapStyle && !this.intrinsic && !this.minContent && !this.gridItemMin && !(fl && first) ? { style: wrapStyle, st } : undefined;
      raws = breakLines(atoms, L, 0, true, { st, first }, st.hyphenLimits, this.wm, wrap);
      pls = raws.map((r) => positionLine(r, L, st, !this.host.xslSpace));
      for (const pl of pls) reorderLine(pl, L, this.wm === 'horizontal-tb' && st.direction === 'rtl');
      const wm = this.wm;
      const nominal = this.nominalRatio(st);
      const strut = this.strutOf(st);
      const nominalDiff = this.nominalDiff(st);
      lms = pls.map((pl) => lineMetrics(pl, wm, st, nominal, strut, nominalDiff));
      if (from) lineMemoSet(from.arr, from.at, run, st, L, first, wm, this.host, this.intrinsic, this.gridItemMin ? 'grid' : this.minContent, { atoms, raws, pls, lms }, blockRef0);
      // 文書をまたぐ覚えにも入れる (子の配列で引く覚えに入れられないもの (組む状況で中身の変わる子・行内の箱・脚注) と、組む間に書体の知らせが出たものは入れない)。
      // 改訂バー (axf:revision-bar-*)・変更バー (XSL 1.1 §6.13.2 fo:change-bar-begin) の付いた字も入れない: 行の箱のバーは、文書の中のバーのオブジェクト (RevisionBar) の同じものどうしで
      // 隣の行と繋ぐので、前の文書のバーを持つ行は、いまの文書の行と繋がらず、バーが途中で切れる
      if (shared && sharedKey !== undefined && shared.fonts.noticeCount === notices0 && !hasDynamicInline(run) && !atoms.some((a) => a.kind === 'box' || a.fnRef || a.st.revisionBar || a.st.changeBars?.length)) shared.memo.set(sharedKey, shared.env, this.host.hyphenate, { atoms, raws, pls, lms });
    }
    // 行ごとの脚注 (ページを持つ Flow だけが本体を積む)
    const useFoot = !!this.foot && !!this.pages && this.ownFoot && !this.measureOnly;
    const refs = pls.map((pl) => lineFootnotes(pl.raw.items));
    // セル・コンテナの中 (ページを持たない Flow): 脚注は行に持たせ、親がその行を含む箱をページに置くときに積む
    const holdFoot = this.holdsFootnotes(useFoot);
    this.placeInlineLines({ run, st, first, L, atoms, raws, pls, lms, refs, useFoot, holdFoot }, step, undefined);
  }

  /**
   * 行分けした行を、ページに置く (layoutInlineRun の後半)。entry は、続きから組むときの入る所 (pending: 行の前の保留の区切りの中。
   * top・bottom: 行を置く前・置いた後の改ページの後)。step は続きの位置の記録の段
   */
  private placeInlineLines(c: InlineCtx, step: InlineStep | undefined, entry: 'pending' | 'top' | 'bottom' | undefined) {
    const { run, st, first, L, atoms, raws, pls, lms, refs, useFoot, holdFoot } = c;
    if (step) step.ctx = c;
    const n = pls.length;
    let idx = step && entry ? step.idx : 0;
    while (idx < n) {
      if (entry === 'top' || entry === 'bottom') {
        const e = entry;
        entry = undefined;
        this.resumeOpen();
        // 初めから組む道の改ページの後 (下の 2 か所) と同じく、印を戻す。戻さないと、行の長さが変わって残りを組み直す間の改ページの境目が、
        // 戻った境目の続きの位置 (同じ行の番号) のまま「続けられる」と写され、そこから続けると段落の前の行から組み直して本文が重なる
        if (step) step.phase = '';
        if (this.relayoutIfWidthChanged(L, atoms, raws[idx], st, e === 'top' ? first && idx === 0 : false)) return;
        continue;
      }
      if (step) {
        step.phase = 'pending';
        step.idx = idx;
      }
      if (entry === 'pending') {
        entry = undefined;
        this.forceBreak();
      } else this.applyPendingBreak();
      if (step) step.phase = '';
      // 行の前に空ける余白 (領域の先頭で捨てる余白は数えない: XSL 1.1 §4.3.1。数えると、段の頭の行を、余白の分だけ入らないとみなす)
      const pv = this.flushValue();
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
      /** 見積もりで積んだと見なす最後の脚注 (行内に並べる脚注を、前の行の脚注につなぐ高さで見積もる) */
      let simLast: FootEntry | null = this.footnotes[this.footnotes.length - 1] ?? null;
      let simOrigin: number | undefined;
      /** footnote-policy: block の脚注が入らないので、行の前で切った (段落がこのページで始まっていれば、段落の前で改ページする) */
      let policyBlock = false;
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
        const { count, inc, full, block, last: footLast } = this.footCostOfRefs(refs[k], useFoot, nFoot, resv, simLast);
        const tol = this.host.lineFitTolerance ?? EPS;
        if (c + h - gridTrail + tail + resv + inc > this.limit + tol) {
          if (block && c + h - gridTrail + tail + resv <= this.limit + tol) policyBlock = true;
          break;
        }
        // footnote-policy: line・block の脚注が、上限で分けないと入らないときも、参照の行の前で改ページする (ページに内容があるときだけ。
        // 空のページでも入らない脚注は、auto と同じに上限で後のページへ送る)
        if (full > inc && this.pageHasContent && c + h - gridTrail + tail + resv + full > this.limit + tol) {
          if (block) policyBlock = true;
          break;
        }
        c += h;
        resv += inc;
        nFoot += count;
        if (footLast !== undefined) simLast = footLast;
        above = lm.leading / 2;
        fit++;
      }
      let take = fit;
      const remaining = n - idx - fit;
      if (remaining > 0) {
        // widows / orphans
        if (remaining < st.widows) take = Math.max(0, n - idx - st.widows);
        if (take < st.orphans) take = 0;
        // footnote-policy: block (CSS GCPM 3 §2.8): 参照を含む段落の前で改ページする。段落の前のページで始まった段落は、行の前で切る (line と同じ)
        if (policyBlock && idx === 0) take = 0;
      }
      if (take === 0) {
        if (this.pageHasContent) {
          if (step) {
            step.phase = 'top';
            step.idx = idx;
          }
          this.breakPage();
          if (step) step.phase = '';
          if (this.relayoutIfWidthChanged(L, atoms, raws[idx], st, first && idx === 0)) return;
          continue;
        }
        take = Math.max(1, fit);
        // widows / orphans を守れずに分けた (段の釣り合わせでは、この高さを採らない)
        if (take < n - idx) {
          this.brokeKeep = true;
          this.brokeKeepPage = Math.min(this.brokeKeepPage, this.breakCount);
        }
        if (fit === 0) {
          this.overflowedLine = true;
          this.overflowCount++;
          this.host.warn(withSource(diag('layout/line-overflow', msg('行がページに収まりません', 'a line does not fit on the page')), firstNode(run) ?? this.blockAt));
        }
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
        if (step) {
          step.phase = 'bottom';
          step.idx = idx;
        }
        this.breakPage();
        if (step) step.phase = '';
        if (this.relayoutIfWidthChanged(L, atoms, raws[idx], st, false)) return;
      }
    }
  }

  /**
   * 行グリッドの中の、行の基線から行の下端までのうち、最初に使える書体の字の下端より下の部分 (半行間など。行の中の inline-block などで
   * 半行間が 0 の行も)。行グリッドの中では、最後の行の後ろにこの分は空けない (アンテナハウスの baseline-grid)。グリッドの外では 0
   */
  private gridTrailOf(lm: LineMetrics, st: ResolvedStyle): number {
    return Math.max(0, this.gridTrailRawOf(lm, st));
  }

  /** gridTrailOf の、負の値 (半行間が負で、字の下端が行の下端より下に出る行) も残したもの */
  private gridTrailRawOf(lm: LineMetrics, st: ResolvedStyle): number {
    return this.inGrid() ? lm.base - (lm.topLeading ?? lm.leading / 2) - lm.above - (1 - this.nominalRatio(st)) * st.fontSize : 0;
  }

  /**
   * 行に含まれる脚注の参照 (refs) の本体を、このページの脚注領域に積むときに増える高さ (inc) と、積む脚注の数 (count)。
   * 本体はここで組む (組んだ結果は FootnoteCtx が覚える)。脚注をこの Flow が積まないとき (useFoot でない) と、側の領域 (sideArea) では 0
   */
  private footCostOfRefs(
    refs: LFootnote[],
    useFoot: boolean,
    existing: number,
    reserve?: number,
    last?: FootEntry | null,
  ): { count: number; inc: number; full: number; block: boolean; last: FootEntry | null | undefined } {
    const es = useFoot && !this.sideArea() ? refs.map((fn) => this.foot!.entry(fn, this.footWidth())) : [];
    const inc = es.length ? this.footCost(es, existing, reserve, false, last) : 0;
    // footnote-policy: line・block (CSS GCPM 3 §2.8) の脚注は、上限 (max-height) で後のページへ送らずに、参照の行と同じページに丸ごと置く高さで見る
    const policy = es.length ? refs.filter((fn) => fn.policy) : [];
    const full = policy.length ? this.footCost(es, existing, reserve, true, last) : inc;
    // 積んだ後の最後の脚注 (行内に並べる脚注は、前の脚注とつないだもの。次の行の見積もりで、その後ろにつなぐ)
    let after = last;
    if (es.length && this.foot) {
      let prev: FootEntry | undefined = last !== undefined ? (last ?? undefined) : existing > 0 ? this.footnotes[existing - 1] : undefined;
      for (const e of es) prev = this.foot.join(prev, e) ?? e;
      after = prev ?? null;
    }
    return { count: es.length, inc, full, block: policy.some((fn) => fn.policy === 'block'), last: after };
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
    // リストの項目の本文の最初の行: 記号の行の基線より下の深さまで、行の箱を下に伸ばす (FlowInit.firstLineMinBelow)
    if (this.firstLineMinBelow !== undefined) {
      const base = firstBaseline(node);
      const extra = base === undefined ? 0 : this.firstLineMinBelow - (node.bsize - base);
      if (extra > EPS) node.bsize += extra;
      this.firstLineMinBelow = undefined;
    }
    this.containerNode().children.push(node);
    this.noteIds(node);
    if (this.lineAbs?.size) this.placeLineAbs(node);
    this.cursor += node.bsize;
    // 行グリッドの中の、背景・罫線のある箱の最後の行: 字の下端より下 (半行間など) は箱に入れない (次の行はグリッドに揃うので位置は変わらない)
    const trail = this.gridTrailOf(lm, st);
    const emTrail = gem ? this.gridEmTrailOf(lm, gem.below) : 0;
    if (shifted && o.last) this.cursor -= trail;
    else this.gridTrail = { end: this.cursor, trail, raw: this.gridTrailRawOf(lm, st) };
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
    // HTML (fontBaseline): 基線は、書体の上の高さ・下の深さで置く (上 = A + L/2、下 = D + L/2。CSS Inline 3 §5.3。行の字と同じ)
    const br = st.fontBaseline ? cssBaselineRatio(font) : font.baselineRatio;
    return { above: br * fs + half, below: (1 - br) * fs + half };
  }

  /**
   * XSL-FO の行の上端から基線まで (字の大きさ fs・行の高さ LH の行)。XSL 1.1 §4.5: 行の矩形は、字の上 (text-altitude) と下 (text-depth。
   * 初期値 use-font-metrics: 書体の上の高さ・下の深さ) に、半行間 ((line-height − (上 + 下)) / 2) を足したもの。書体は、字 ch (ドロップキャップの
   * 字。まわりの行も同じ字の類で書くとみなす) の書体。書体の上下の値が無ければ、nominalRatio の比で置く
   */
  private xslLineBase(st: ResolvedStyle, fs: number, LH: number, ch: string): number {
    const font = this.host.measurer.glyph(ch, { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: fs, stretch: st.fontStretch }, 'horizontal-tb').font;
    if (font.ascent === undefined || font.descent === undefined) return (LH - fs) / 2 + this.nominalRatio(st) * fs;
    return (LH - (font.ascent + font.descent) * fs) / 2 + font.ascent * fs;
  }

  private nominalRatio(st: ResolvedStyle): number {
    const latinDoc = !!st.language && !/^(ja|zh|ko)\b/i.test(st.language);
    const run = { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch };
    // HTML (primaryFontMetrics): 最初に使える書体 (空白の字の書体) の値 (CSS Inline 3 §5.3)。
    // fontBaseline なら、書体の上の高さ・下の深さで置いた基線の位置 (行の字と同じ。fontManager.ts の cssBaselineRatio)
    if (st.primaryFontMetrics) {
      const font = this.host.measurer.glyph(primaryChar(st), run, 'horizontal-tb').font;
      return st.fontBaseline ? cssBaselineRatio(font) : font.baselineRatio;
    }
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
  private gridTrail: { end: number; trail: number; raw?: number } = { end: -1, trail: 0 };
  /** 最初の行の基線より下の深さの下限 (FlowInit.firstLineMinBelow)。最初の行を置いたら undefined にする */
  private firstLineMinBelow?: number;
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
      // 句読点のぶら下げ (hanging-punctuation: allow-end。CSS Text 3 §8.2.1) は、行の終わりの側に回り込みが食い込んでいる行ではしない:
      // ぶら下げた字は行の箱の外に置かれる (§8.2) ので、行の箱の外の回り込みの箱 (CSS 2.1 §9.5) に重なる。
      // allow-end のぶら下げは任意 (行に収める別の仕方を選んでよい) なので、その行では詰めるか追い出す。
      // 行の終わりの側は、横書きの右から左の行では左、それ以外 (左から右の行・縦書き) では lineRange の右 (end) の側
      const rtlLine = this.wm === 'horizontal-tb' && st.direction === 'rtl';
      const endIntruded = range.intruded && (rtlLine ? range.shift > EPS : range.shift + range.width < this.contentI() - EPS);
      const { line, next } = breakOneBoxed(atoms, start, range.width, indentHere, !endIntruded, this.wm, (w, hang) => {
        const state = { run: hyRun };
        const r = breakOneLast(atoms, start, w, indentHere, hang, st.lastLineEndIndent, st.hyphenLimits ? { lim: st.hyphenLimits, state, nextIndent: lineIndent(st, false, false) } : undefined);
        hyState.run = state.run;
        return r;
      });
      const pl = positionLine(line, range.width, st, !this.host.xslSpace);
      reorderLine(pl, range.width, this.wm === 'horizontal-tb' && st.direction === 'rtl');
      const lm = lineMetrics(pl, this.wm, st, this.nominalRatio(st), this.strutOf(st), this.nominalDiff(st));
      const refs = lineFootnotes(pl.raw.items);
      const { inc, full, block } = this.footCostOfRefs(refs, useFoot, this.footnotes.length);
      // 同じページに置いた、この段落の前の行との半行間の重ね合わせ (line-height.precedence)
      const prevLm = placedHere.length ? placedHere[placedHere.length - 1].lm : undefined;
      const cut = prevLm ? precedenceCut(prevLm, lm, st) : this.discardTopLeading(lm, st);
      const extra0 = this.rubyRoom(lm, st, this.adjacent + pv) - cut;
      const tail = next >= n ? reserve() : 0;
      // 行グリッド: 回り込みの無い経路 (layoutInlineRun) と同じく、行の基線をグリッドに揃える分を足し、最後の行の下の部分は入るかの判定に数えない
      const gdSim = this.gridDelta(y0 + extra0, lm, st, y0 + extra0, this.inGrid() ? { above: this.gridEmOf(pl, st).above, prevTrail: pv ? 0 : this.gridPrevTrail(this.cursor) } : undefined);
      const gridTrail = this.gridTrailOf(lm, st);
      const lineEnd = this.cursor + pv + extra0 + gdSim + lm.base - gridTrail + tail + this.footReserve;
      const lim = this.limit + (this.host.lineFitTolerance ?? EPS);
      // footnote-policy: line・block (CSS GCPM 3 §2.8) の脚注が、上限 (max-height) で分けないと参照の行と同じページに入らないときも、
      // 参照の行の前で改ページする (回り込みの無い経路 (layoutInlineRun) と同じ。ページに内容があるときだけ)
      const policyOver = full > inc && this.pageHasContent && lineEnd + inc <= lim && lineEnd + full > lim;
      if (this.paginating && (lineEnd + inc > lim || policyOver)) {
        if (this.pageHasContent) {
          // widows / orphans: 次のページへ行く行が widows より少なければ、このページに置いた行を送る
          // (残りの行の数は、回り込みの無い幅で数える)
          let k = this.widowShift(atoms, start, placedHere, st, firstLine, hyRun);
          // footnote-policy: block: 行だけなら入るのに脚注が入らないときは、参照を含む段落の前で改ページする (段落がこのページで始まっていれば、
          // このページに置いた段落の行をすべて送る。前のページから続く段落は、行の前で切る。ページにほかの中身が無くなるなら送らない)
          if (block && lineEnd <= lim && placedHere.length && placedHere[0].first && !placedHere.some((p) => p.fns) && placedHere.length < this.pageItems) k = placedHere.length;
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
        this.overflowedLine = true;
        this.overflowCount++;
        this.host.warn(withSource(diag('layout/line-overflow', msg('行がページに収まりません', 'a line does not fit on the page')), this.blockAt));
      }
      // 行の中に書いた float (目印 floatMark) を置く。入るなら行の上端に置き、この行を組み直す (continue)。入らない float は行の後に置く
      const below = this.lineFloats?.size ? this.placeLineFloats(atoms, start, next, range.width, indentHere) : undefined;
      if (below === true) continue;
      const before = { cursor: this.cursor, adjacent: this.adjacent };
      this.flush();
      this.commitMarkers();
      // 行を置く (回り込みの無い経路と共通)。幅は回り込みを避けた range の幅、始端は range.shift
      const node = this.placeLine(pl, lm, st, { cut, firstOnPage: !placedHere.length, last: next >= n, width: range.width, shift: range.shift, refs, useFoot, holdFoot });
      if (below) for (const f of below) if (f.fb) this.anchorFloat(f.fb);
        else this.placeFloat(f.node, f.st);
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
   * ページを基準にする CSS の絶対配置の箱 (位置の決まった祖先の無い箱。包含ブロックは初めの包含ブロック = ページの領域。CSS 2.1 §10.1 の 1・
   * CSS Paged Media 3 §3.3) で、top・bottom の両方か left・right の両方が auto のもの: その向きの位置は static position (箱を流れの中に
   * 置いたとしたときの位置。CSS 2.1 §10.3.7・§10.6.4)。ページの本文を組む流れ (段組でない、ページの領域を根にする流れ) のときだけ
   * (ほかの流れの位置は、ページの領域の位置に直せない)。XSL-FO の箱 (§7.6.1 の top の初期値 auto は、参照領域の端) は従来どおり
   */
  private pageStatic(c: LBlockContainer): boolean {
    const pa = c.pageArea;
    if (!c.absolutePosition || !pa || !(pa.staticTop || pa.staticLeft) || c.positionInContainer || c.inlineCb !== undefined || c.areaOffset || this.host.xslSpace) return false;
    return this.paginating && !this.measureOnly && this.wm === 'horizontal-tb' && !this.pageLevel && !this.spanAreas;
  }

  /**
   * ページを基準にする絶対配置の箱を、このページの領域で置き直し (atPageArea)、pageStatic の箱の auto の位置を static position
   * (流れの根 = ページの領域の内容の左上からの位置: y は block、x は inline の向き) にして組み、ページの絶対配置の箱に足す
   */
  private placePageAbs(node: LBlockContainer, st: ResolvedStyle, at?: { y: number; x: number }) {
    const page = this.pageSize();
    let src = node.pageArea ? atPageArea(node, page) : node;
    const pa = node.pageArea;
    if (at && pa) {
      // ページの領域の、用紙の端からの距離 (分からなければ、読み込みの見積もり: 箱の位置から、領域の端からの距離を引いたもの)
      const top = page.area?.top ?? (node.top ?? 0) - (pa.top ?? 0);
      const left = page.area?.left ?? (node.left ?? 0) - (pa.left ?? 0);
      src = withRef(src, {
        ...src,
        ...(pa.staticTop ? { top: top + at.y + (node.staticOffset ?? 0) } : {}),
        ...(pa.staticLeft ? { left: left + at.x + (pa.left ?? 0) } : {}),
      });
    }
    const n = this.buildContainer(src, st, page.width, page.height);
    this.abs().push(n);
    this.noteIds(n);
    this.placeHeldFootnotes(n);
  }

  /** 置いた行 line の中の、ページを基準にする絶対配置の箱の目印 (lineAbs) の所を static position にして、箱を置く (CSS 2.1 §10.3.7・§10.6.4: 行の上端と、行の中の目印の位置) */
  private placeLineAbs(line: LNode) {
    const la = this.lineAbs!;
    for (const [key, a] of [...la]) {
      const mark = locateStaticAnchor([{ ...line, children: [line] } as LNode], key);
      if (!mark) continue;
      la.delete(key);
      this.placePageAbs(a.node, resolveStyle(a.st, a.node), { y: this.cursor, x: this.contentIOffset() + mark.i });
    }
  }

  /**
   * 行 (atoms の start から next の前まで。使える幅 width、行の頭の字下げ indent) の中に、書いた所の目印 (Atom.floatMark) のある
   * float (lineFloats) があれば置く。CSS 2.1 §9.5.1 の規則 6・8 のとおり、float の上端は、float より前の中身を含む行の上端より上にせず、
   * そのうえでできるだけ上に置く: 目印より前の行の中身の横に入る (目印が行の頭にある・目印までの幅と float の幅の和が行の幅以下) なら、
   * 行の上端に置いて true を返す (呼ぶ側は、float を避けた幅でこの行を組み直す)。入らなければ、この行の後 (次の行の上端) に置く
   * float を返す (後に書いた float も、先の float より上には置けない (規則 5) ので、一緒に行の後に置く)。目印が無ければ undefined
   */
  private placeLineFloats(atoms: Atom[], start: number, next: number, width: number, indent: number): true | Array<{ node: LFloat; st: ResolvedStyle; fb?: FloatBox }> | undefined {
    const lf = this.lineFloats!;
    let used = indent;
    let head = true;
    let after: Array<{ node: LFloat; st: ResolvedStyle; fb?: FloatBox }> | undefined;
    for (let a = start; a < next; a++) {
      const at = atoms[a];
      const key = at.floatMark;
      if (key === undefined || !lf.has(key)) {
        used += at.advance;
        if (!at.idMark && !at.isSpace) head = false;
        continue;
      }
      const f = lf.get(key)!;
      lf.delete(key);
      if (after) {
        after.push(f);
        continue;
      }
      const fb = this.placeFloat(f.node, f.st, head ? undefined : (outerI) => used + outerI <= width + EPS);
      if (fb === undefined) return true;
      after = [{ ...f, fb }];
    }
    return after;
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

  /**
   * 百分率の幅・上限・下限のある画像 (LImage.percentSize) の大きさを、包含ブロックの内容の幅 (percentBase) で決めた節を返す。
   * 幅と高さがどちらも auto なら、本来の大きさに上限・下限を縦横比を保って当て (CSS 2.1 §10.4 の表)、幅が決まれば、高さは幅と本来の
   * 縦横比から (§10.6.2)。基準が測る幅による (測る組版) ときは、min-content を測るなら百分率の部分を 0 として、max-content を測るなら
   * 幅を auto・上限を none として解く (CSS Sizing 3 §5.2.1: 置換要素の、循環する百分率の幅・上限は、min-content の寄与では 0 が基準)
   */
  private percentImage(c: LImage, nat: { w: number; h: number }): LImage {
    const P = c.percentSize!;
    const cb = this.percentBase();
    const res = (v: PercentLength | undefined, none: number): number => {
      if (!v) return none;
      if (cb === undefined && v.pct !== 0 && !this.minContent) return none;
      return Math.max(v.pct * (cb ?? 0) + v.len, 0);
    };
    const W = P.width && (cb !== undefined || P.width.pct === 0 || this.minContent) ? res(P.width, 0) : undefined;
    const mx = res(P.maxWidth, Infinity);
    const mn = P.minWidth && cb === undefined && P.minWidth.pct !== 0 ? Math.max(P.minWidth.len, 0) : res(P.minWidth, 0);
    const mnH = P.minHeight ?? 0;
    const mxH = P.maxHeight ?? Infinity;
    // 本来の比の無い画像 (大きさも viewBox も無い SVG) は、HTML の属性の比 (LImage.attrRatio)
    const ratio = (this.host.assets?.get(c.src)?.noRatio || c.ratioForced) && c.attrRatio ? c.attrRatio : nat.h / nat.w;
    let w: number;
    let h: number;
    const clampW = (v: number) => Math.max(Math.min(v, mx), mn);
    const clampH = (v: number) => Math.max(Math.min(v, mxH), mnH);
    // 片方が決まっていれば、その向きは最小・最大だけを当て、もう一方は、当てた後の値と縦横比から出して、その向きの最小・最大を当てる
    // (§10.3.2・§10.6.2。読み込みの、百分率の無い画像の決め方と同じ)
    // 既定のスタイルの max-width で縮める、属性の大きさ (LImage.percentSize.uaFit): 既定の max-width が、属性の大きさ (無い向きは縦横比から) の
    // 幅を実際に縮めるときだけ、§10.4 の表で、縦横比を保って縮める。縮めないとき (百分率の属性の幅が上限より狭い・0 の属性を下限で広げる・
    // flex で伸ばす) は、下のふつうの決め方 (属性の幅と高さに、それぞれ上限・下限を当てる)。
    // fitRatio のある画像は、属性の幅 (高さ / fitRatio) と比べる: flex の項目の幅で描く画像 (imageFillsItem。W は項目の幅) は、項目の幅が
    // 属性の幅より狭いときが、縮めたとき。ただし、画像そのものの flex の項目で、項目の幅が max-width の上限 (容器の内容の幅で解いたもの) より
    // 狭いとき (FlowInit.itemAtMaxWidth が false) は、作成者の min-width・overflow (自動の最小の大きさを外す: Flexbox 1 §4.5) で、flex が
    // 縮めた (§9.7) もので、既定の max-width が縮めたのではない (属性の幅と高さに、それぞれ上限・下限を当てる)
    const uaShrunk = (): boolean => {
      if (!P.uaFit || (W === undefined && P.height === undefined) || this.itemAtMaxWidth === false) return false;
      const w0 = W ?? P.height! / ratio;
      const attrW = P.fitRatio !== undefined && P.fitRatio > 0 && P.height !== undefined ? P.height / P.fitRatio : w0;
      return clampW(w0) < attrW - 0.005;
    };
    if (W === undefined && P.height === undefined) [w, h] = constrainReplaced(nat.w, nat.h, mn, mx, mnH, mxH);
    else if (uaShrunk()) {
      const w0 = W ?? P.height! / ratio;
      [w, h] = constrainReplaced(w0, P.fitRatio !== undefined ? w0 * P.fitRatio : W === undefined ? P.height! : (P.height ?? w0 * ratio), mn, mx, mnH, mxH);
    } else if (W !== undefined) {
      w = clampW(W);
      h = clampH(P.height ?? w * ratio);
    } else {
      h = clampH(P.height!);
      w = clampW(h / ratio);
    }
    const out: LImage = { ...c, width: w, height: h };
    copySourceRef(c, out);
    return out;
  }

  /** 画像を行内の箱として組む。画像データが無ければ、指定サイズ (既定 60×40pt) のプレースホルダ */
  private imageBox(c: LImage, st: ResolvedStyle): BoxSpec {
    // grid の項目の min-content を測るとき (FlowInit.gridItemMin): 見積もりで長さにした百分率の幅の置換要素 (LImage.estimatedWidth) は、
    // 縮められる置換要素の百分率の幅として、min-content の寄与を 0 にする (CSS Sizing 3 §5.2.2)
    if (this.gridItemMin && c.estimatedWidth && this.wm === 'horizontal-tb') c = withRef(c, { ...c, width: 0, height: 0 });
    const asset = this.host.assets?.get(c.src);
    if (asset?.unsupported) this.host.warn(withSource(diag('image/unsupported', msg(`画像 ${c.src} を描けないため、仮の枠で描きます (${asset.unsupported})`, `image ${c.src} cannot be drawn, so a placeholder frame is drawn (${asset.unsupported})`), { src: c.src, detail: asset.unsupported }), c));
    // 描いたが、中の一部を描けなかったもの (CGM・WMF・EMF。assets.ts の ImageAsset.notes)
    for (const n of asset?.notes ?? []) this.host.warn(withSource(diag('image/partial', msg(`画像 ${c.src} の一部を描けません: ${n}`, `part of image ${c.src} cannot be drawn: ${n}`), { src: c.src, detail: n }), c));
    // 画像が見つからない・中身が画像でない (読めない) ときは、黙って省かずに知らせる (instream-foreign-object の仮の名前は除く)
    if (this.host.assets && !asset && !c.src.startsWith('instream-foreign-object:')) this.host.warn(withSource(diag('image/not-found', msg(`画像 ${c.src} が見つからないか、中身を画像として読めません`, `image ${c.src} is not found or its content cannot be read as an image`), { src: c.src }), c));
    // SVG の image が指す外のファイルのうち、描けないもの (文書のファイルに無い・PNG と JPEG でない) を知らせる (その image は描かない。svg.ts)
    if (asset?.mime === 'image/svg+xml' && asset.bytes && !asset.unsupported) {
      // 文と args の src・href は 200 字で切る (インラインの svg の src は SVG の全体の data: の URL なので、切らないと、見つからない参照の数 ×
      // SVG の大きさ (数の 2 乗) の字になる)。1 つの SVG の分は SVG_MISSING_SHOWN 件までを 1 件ずつ出し、残りは数だけの 1 件にまとめる
      const missing = svgMissingImages(c.src, asset.bytes, this.host.assets!);
      const src = c.src.slice(0, 200);
      for (const { href: h, use } of missing.slice(0, SVG_MISSING_SHOWN)) {
        const href = h.slice(0, 200);
        this.host.warn(
          use
            ? withSource(diag('image/reference-not-found', msg(`画像 ${src} の use が指すファイル ${href} が見つからないか、SVG でないため、描きません`, `file ${href} referenced by use in image ${src} is not found or is not SVG, so it is not drawn`), { src, href, count: 1 }), c)
            : withSource(diag('image/reference-not-found', msg(`画像 ${src} の中の画像 ${href} が見つからないか、PNG・JPEG・GIF・BMP・WebP でないため、描きません`, `image ${href} in image ${src} is not found or is not PNG, JPEG, GIF, BMP or WebP, so it is not drawn`), { src, href, count: 1 }), c),
        );
      }
      const rest = missing.length - SVG_MISSING_SHOWN;
      if (rest > 0) this.host.warn(withSource(diag('image/reference-not-found', msg(`画像 ${src} の中で、ほかに ${rest} 個の参照 (画像・use) が見つからないか描けない形式なので、描きません`, `${rest} more references (images, use) in image ${src} are not found or not in a drawable format, so they are not drawn`), { src, href: '', count: rest }), c));
    }
    // 画像本来の大きさ (pt)。intrinsicFromImage なら、画像に書かれた解像度で決める
    const k = c.intrinsicFromImage && asset?.dpi ? 96 / asset.dpi : 1;
    const nat = asset ? { w: asset.width * 0.75 * k, h: asset.height * 0.75 * k } : undefined;
    // 百分率の幅・上限・下限 (HTML の CSS。LImage.percentSize): 行を組む包含ブロックの内容の幅で解き直す (横書きの行の中だけ)
    // 縦書きの行の中でも、長さだけの幅・上限・下限 (百分率の部分が 0。読み込みのときに画像本来の大きさが分からず、当てずに渡したもの) は当てる
    // (物理の幅・高さの上限なので、包含ブロックの大きさによらない。前は当てず、縦書きの max-width・max-block-size の画像を本来の大きさで描いていた)
    const lenOnly = (P: NonNullable<LImage['percentSize']>) => [P.width, P.maxWidth, P.minWidth].every((v) => !v || v.pct === 0);
    if (c.percentSize && nat && nat.w > 0 && nat.h > 0 && ((st.wm === 'horizontal-tb' && this.wm === 'horizontal-tb') || lenOnly(c.percentSize))) c = this.percentImage(c, nat);
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
      h = c.ratioForced && c.attrRatio ? w * c.attrRatio : (nat?.h ?? 40);
    } else if (w === undefined) w = nat && !((asset?.noRatio || c.ratioForced) && c.attrRatio) ? (h! * nat.w) / nat.h : c.attrRatio ? h! / c.attrRatio : h! * 1.5;
    // 本来の比が無ければ、HTML の属性の比 (aspect-ratio: auto w / h。HTML §15.4.3。LImage.attrRatio)、それも無ければ 3 : 2。
    // CSS の aspect-ratio の比 (LImage.ratioForced) は、本来の比より先に使う (CSS Sizing 4 §5.1)
    else if (h === undefined) h = nat && !((asset?.noRatio || c.ratioForced) && c.attrRatio) ? (w * nat.h) / nat.w : c.attrRatio ? w * c.attrRatio : w / 1.5;
    // 本来の比の無い画像の、属性の比で決めた大きさは、そのまま (縦横比を保つ縮尺の対象にしない)
    else if (c.scaling !== 'non-uniform' && !c.fit && nat && !((asset?.noRatio || c.ratioForced) && c.attrRatio)) {
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
        // PDF の画像 (pdfSource) は、PDF の出力が Form XObject で描く (画面・SVG・PNG は、描くときに仮の枠にする)
        missing: !asset || (asset.drawable === false && !asset.pdfSource),
        alt: c.alt,
        // 画像を置いた所の言語 (SVG の systemLanguage を照らす)
        ...(st.language ? { language: st.language } : {}),
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
      // 罫線の箱の角丸 (boxRadius) も、この箱に付ける
      const d = describeBox({ border: c.border, padding: c.padding, backgroundColor: c.backgroundColor, ...(c.boxRadius ? { borderRadius: c.boxRadius } : {}) } as LBlock, st.wm);
      const bpB = d.bpStart + d.bpEnd;
      node = newNode('block', st.wm, { isize: node.isize + d.bpI, bsize: node.bsize + bpB, padding: { ...d.paddingP }, border: { ...d.borderP }, bg: d.bg, ...(d.radius ? { radius: d.radius } : {}), children: [node] });
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
    // 百分率の寸法は、行を組む箱 (包含ブロック) の内容の幅で解く (CSS 2.1 §10.1・§10.2)
    c = this.resolvePercent(c, false);
    // grid の項目の min-content を測るとき (FlowInit.gridItemMin): 読み込みの見積もりで長さにした百分率の幅 (BoxStyle.estimatedSize。
    // 組むときに解き直さない、行内の入力欄など) は auto として測る (CSS Sizing 3 §5.2.1。縮められる置換要素なら、§5.2.2 の 0 に近い中身の幅)
    if (this.gridItemMin && this.wm === 'horizontal-tb' && c.estimatedSize?.width && !c.estimatedSize.width.auto && !c.percent?.width) {
      const { width: _w, ...rest } = c;
      c = rest as LInlineContainer;
    }
    return this.nested(() => this.inlineContainerBoxIn(c, ps));
  }

  private inlineContainerBoxIn(c: LInlineContainer, ps: ResolvedStyle): BoxSpec {
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
    if (contentI == null && this.simplified()) {
      contentI = Math.max(this.contentI() - desc.bpI - (lineWm === 'horizontal-tb' ? desc.marginP.left + desc.marginP.right : 0), 0);
      r = lay(contentI);
    } else if (contentI == null) {
      const avail = Math.max(this.contentI() - desc.bpI - (lineWm === 'horizontal-tb' ? desc.marginP.left + desc.marginP.right : 0), 0);
      // shrink-to-fit (CSS 2.1 §10.3.9 は §10.3.5 と同じ式): min(max(最小の内容の幅, 使える幅), 内容の幅)。中身の幅は、幅の指定の無い float と
      // 同じく、中身の幅を測る組版で測る (使える幅で組んで最も長い行を測ると、リストの表・リーダー・伸びる flex の項目のように、置く場所に
      // 合わせて広がる・縮む中身で、置く場所いっぱいや中身より狭い幅になる。CSS Sizing 3 §5.1)
      if (this.host.xslSpace) {
        // XSL-FO の fo:inline-container (幅の指定なし): 使える幅で組んで中身の幅 (最も長い行) を測り、それより狭ければ中身の幅で組み直す。
        // 測った幅は覚えて使い回す (memoMeasure): 同じ箱を同じ幅でもう一度組むとき (外側の箱が 2 度組まれるとき) は、測る組版を省いて、
        // 組み直しの 1 回だけにする。測る組版が出した警告は、省いたときも同じ順で出す
        const got: { first?: ReturnType<typeof lay> } = {};
        const m = this.memoMeasure('ic', c.children, st, [avail, wmC], this.foot, () => {
          const warns: Diagnostic[] = [];
          got.first = lay(avail, { ...this.host, warn: (w) => (warns.push(w), this.host.warn(w)) });
          return { widest: maxLineLength(got.first.sub.root), warns };
        });
        if (!got.first) for (const w of m.warns) this.host.warn(w);
        contentI = Math.min(avail, Math.ceil(m.widest * 100) / 100 + 0.01);
        // 中身の幅で組み直すときは、警告を出さない (測る組版の警告を、上で 1 度だけ出したので。同じ中身を 2 度数えない)
        r = contentI < avail - EPS ? lay(contentI, { ...this.host, warn: () => {} }) : (got.first ?? lay(avail, { ...this.host, warn: () => {} }));
      } else {
        const ceil = (v: number) => Math.ceil(v * 100) / 100 + 0.01;
        const pref = ceil(this.intrinsicWidth(c.children, st, Math.max(avail, 1) * 100));
        contentI = pref <= avail ? pref : Math.max(Math.ceil(this.intrinsicWidth(c.children, st, 1, true) * 100) / 100, avail);
        // 内容による大きさの語 (CSS Sizing 3 §3.2): auto の大きさ (上の shrink-to-fit) に代えて、または上限・下限として当てる
        const sized = c.inlineSizing ? this.contentSizedInline(c, st, avail, contentI) : undefined;
        if (sized !== undefined) contentI = sized;
        r = lay(contentI);
      }
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
      // 角丸 (border-radius。背景・罫線・背景の画像とグラデーションを切り抜く。CSS Backgrounds 3 §4.3) と影 (box-shadow) は、
      // ブロックの箱 (makeNode) と同じく付ける (これまでは行内ブロックの箱に付けず、四角く描いていた)
      ...(desc.radius ? { radius: desc.radius } : {}),
      ...(desc.shadow ? { shadow: desc.shadow } : {}),
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
    if (this.paginating && !this.pageHasContent && extent > this.room + EPS) {
      this.host.warn(withSource(diag('layout/box-overflow', msg('ボックスがページより大きいため溢れます', 'a box is larger than the page and overflows')), node));
      this.overflowCount++;
      // CSS: 段組の釣り合わせの試し組みで、その段の高さを収まるとみなさない (行の overflowedLine と同じ。入れ子の段組の中の区切りの後の
      // 段の行が、外の段組の最後の行の高さを 0 近くまで下げて、段からはみ出していた)。XSL-FO の段組は、これまでどおり
      if (!this.host.xslSpace) this.overflowedLine = true;
    }
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

  /**
   * 直交する書字方向のブロックを、ページ (親の block 方向) ごとの断片に分けて置く。
   * fillB: 1 つの断片に収まるなら、箱の block の向きの内容の大きさを、この長さまで広げる (XSL-FO の直交するコンテナ。fillOrthogonal)
   */
  private layoutOrthogonalPaged(node: LBlock | LTable, st: ResolvedStyle, ps: ResolvedStyle, fillB?: number) {
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
    /** 組む箱 (fillB の広げ方を決めた後のもの) */
    let subject: LBlock | LTable = node;
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
            if (final) pushAll(this.markerSink, list);
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
      sub.layoutBlockLevel(subject, ps);
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
    // 1 つの断片に収まるなら、箱を fillB まで広げる (ページをまたぐなら広げない: 最後の断片は中身の大きさ)
    if (fillB !== undefined && node.type === 'block') {
      const filled: LBlock = withRef(node, { ...node, minBlockSize: Math.max(fillB, node.minBlockSize ?? 0) });
      if (pieces(lay(lineLen, false)) <= 1) {
        subject = filled;
        if (pieces(lay(lineLen, false)) > 1) subject = node;
      }
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
  /**
   * outer: 箱の外の余白 (space-before・space-after・start-indent) を当てるときの箱の寸法 (枠を中のブロックに移した XSL-FO の箱。
   * 1 つの箱にして置くときと同じに、最初の断片の前・最後の断片の後ろ・各断片の行の向きの始めに当てる)
   */
  private layoutRotatedPaged(node: LBlockContainer, st: ResolvedStyle, rot: 90 | 270, outer?: ReturnType<typeof describeBox>) {
    this.applyPendingBreak();
    const minLine = st.fontSize * 4;
    // 箱の前の余白 (outer) は、最初の断片の前に置く (その分、最初のページの残りが短い)
    const before = outer ? Math.max(outer.m.bs, 0) : 0;
    let avail = this.room - this.cursor - this.pendingValue() - before;
    if (avail < minLine && this.pageHasContent) {
      this.breakPage();
      avail = this.room - this.cursor - this.pendingValue() - before;
    }
    const width = this.contentI() - (outer ? outer.m.is + outer.m.ie : 0);
    // 回転した箱の局所の幅 (回転後のページの縦の長さ) は、中身の長さに合わせる (使える長さが上限。shrink-to-fit)。
    // 90°・270° の表は、表の幅 (列の幅の合計 + 字下げ) の長さで本文の上から置く
    const fit = (len: number) => {
      if (this.simplified()) return len;
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
        addMarkers: (list) => pushAll(this.markerSink, list),
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
    const placed = roots.filter((r) => r.children.length);
    placed.forEach((r, k) => {
      if (k > 0) this.breakPage();
      const wrap = newNode('block', st.wm, { isize: r.isize, bsize: fill ? width : (used[roots.indexOf(r)] ?? width), children: r.children });
      wrap.rot = rot;
      const first = k === 0;
      const last = k === placed.length - 1;
      if (!outer) this.placeBox(wrap, 0, 0, 0, this.extentAlongBlock(wrap));
      else this.placeBox(wrap, first ? outer.m.bs : 0, last ? outer.m.be : 0, outer.m.is, this.extentAlongBlock(wrap), first ? outer.precBs : 0, last ? outer.precBe : 0, last ? outer.retainBe : false);
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
    if (this.simplified()) return avail;
    const pref = widthAt(Math.max(avail, 1) * 100, false);
    if (pref <= avail) return pref;
    return Math.min(Math.max(widthAt(1, true), avail), pref);
  }

  /** 親と直交する書字方向を持つブロック/表 (例: 横書きフロー内の縦書きブロック) */
  /** fillB: ページに分けて組むとき、1 つの断片に収まるなら、箱の block の向きの内容の大きさをこの長さまで広げる (layoutOrthogonalPaged) */
  private layoutOrthogonal(node: LBlock | LTable, st: ResolvedStyle, ps: ResolvedStyle, fillB?: number) {
    // 段の先頭・末尾に寄せる float (before・after・inside・outside) を直下に持つ箱は、ブロックコンテナとして組む
    // (float を箱の内容の block-start・block-end の端に置く。ブロックのまま組むと、float が箱の枠の外の、組む流れの根元に積まれる)
    if (node.type === 'block' && hasEdgeFloats(node.children)) {
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
    if (node.breakBefore || after) node = withRef(node, { ...node, breakBefore: undefined, breakAfter: undefined });
    const desc = describeBox(node, wmC);
    // ページ分割: inline 方向の寸法の指定が無ければ、行の長さをページの残りの高さ (親の block 方向) にして、
    // 子の block 方向 (親の inline 方向) に親の幅まで積み、入りきらない行は次ページへ続ける
    if (desc.isizeExplicit == null && this.paginating && !this.measureOnly) {
      this.layoutOrthogonalPaged(node, st, ps, fillB);
      if (after) this.setBreakNext(after);
      return;
    }
    // 親の block 方向の余白 (横書きの親なら上下) は、箱の外に出して前後の余白と相殺する (CSS と同じ)。箱の中には含めない
    const outer = describeBox(node, this.wm);
    const bsSide = startSide(this.wm);
    const beSide = endSide(this.wm);
    let inner = withRef(node, { ...node, margin: { ...outer.marginP, [bsSide]: 0, [beSide]: 0 } } as typeof node);
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
    // 親の行の向きの auto の余白 (CSS 2.1 §10.3.3): 箱の大きさ (この箱の block の大きさ) が決まったので、置く場所の残りを配る
    const free = node.type === 'block' && node.autoMargins ? this.contentI() - bsize : 0;
    const mis = free > EPS ? (node.autoMargins === 'center' ? free / 2 : node.autoMargins === 'start' ? free : 0) : 0;
    this.placeBox(wrap, outer.m.bs, outer.m.be, mis, this.extentAlongBlock(wrap), outer.precBs, outer.precBe, outer.retainBe);
    if (after) this.setBreakNext(after);
  }

  /** fo:block-container 相当 */
  private layoutContainer(node: LBlockContainer, ps: ResolvedStyle) {
    // 詰め込み (condense): 中身が収める高さを超えるなら、字の大きさ・行の高さを詰めた中身にしてから置く。収める高さは、高さ・max-height を
    // 決めた容器ならその高さ (ページに流す本文の外: 表のセル・リストの本体・static-content の中や、絶対配置の容器でも)。
    // 高さの決まらない容器は、ページに流す本文の keep-together の容器なら本文の領域 (1 ページ。詰めた高さでいまのページに入らなければ
    // 次のページへ送る)。ほか (ページをまたいで続く容器・高さが中身で決まる流れの中の容器) は、あふれることが無いので詰めず、警告に出す
    // (アンテナハウスの説明に、高さの決まらない容器での動きは無い。製品の動きは未照合)。
    // 中身の幅を測る流れ (表の列の幅など) では詰めない (詰める前の中身の幅を測る)
    if (node.condense && !this.intrinsic) {
      this.boxStep = undefined;
      const c = node.condense;
      const keep = !!(node as { keepTogether?: boolean }).keepTogether && this.paginating;
      if (node.height !== undefined || c.maxBlock !== undefined || (c.maxBlockPct !== undefined && this.paginating) || keep) {
        // いちばん外の詰め込みの容器 (ほかの詰め込みの容器を測っている最中でも、組んでいる最中でもない): 入れ子の中の容器が測る回数を
        // 0 から数え直し、この容器を詰めて組み終えるまで (中の容器の本番の組みも) を 1 つの数えの範囲にする (LayoutOptions.maxCondenseMeasures)
        const budget = this.host.condense;
        if (budget && budget.depth === 0 && budget.win === 0) {
          budget.n = 0;
          budget.hit = false;
          budget.fit = new WeakMap();
          budget.max = budget.opt ?? condenseLimit(node, budget.limits, !this.host.measureMemo);
          node = this.condenseContainer(node, ps);
          budget.win++;
          try {
            if (keep) this.keepTogetherCheck(node, ps);
            return this.layoutContainerPlaced(node, ps);
          } finally {
            budget.win--;
          }
        }
        node = this.condenseContainer(node, ps);
        if (keep) this.keepTogetherCheck(node, ps);
      } else {
        // 測る組みでも出す (上の condense-overflow と同じ)
        this.host.warn(withSource(diag('layout/condense-height-unknown', msg('overflow="condense" の fo:block-container は、高さ (height・max-height) が決まらないため詰めません', 'an fo:block-container with overflow="condense" is not condensed because its height (height, max-height) is not determined')), node));
      }
    }
    return this.layoutContainerPlaced(node, ps);
  }

  /** layoutContainer の、詰め込みの後: 幅を中身で決める箱・段組の入れ子の深さを数えて組む */
  private layoutContainerPlaced(node: LBlockContainer, ps: ResolvedStyle) {
    const multi = !!(node.columns && node.columns.count > 1);
    const counts = !!node.absolutePosition || !!node.rotation || multi || !!node.shrinkToFit;
    if (!counts) return this.layoutContainerIn(node, ps);
    this.boxStep = undefined;
    return this.nested(() => this.layoutContainerIn(multi && this.simplified(true) ? withRef(node, { ...node, columns: undefined }) : node, ps), multi);
  }

  private layoutContainerIn(node: LBlockContainer, ps: ResolvedStyle) {
    if (node.absolutePosition && node.inlineCb !== undefined) return this.placeInlineAbs([node], ps);
    const st = resolveStyle(ps, node);
    const page = this.pageSize();
    if (node.absolutePosition && node.positionInContainer && this.cbAbs) {
      // 絶対配置の基準になるブロック (CSS) の中: 箱は、基準の箱を組み終えてから組む。いまの位置 (static position) を覚えておく
      const f = this.cbAbs.frame;
      const sy = f.opened ? Math.max(this.cursor + this.pendingValue() - f.contentStartB, 0) : 0;
      const frag = f.opened ? Math.max((f.frags?.length ?? 1) - 1, 0) : (f.frags?.length ?? 0);
      this.cbAbs.items.push({ node, st, sy, frag, ...(this.staticKey !== undefined ? { staticKey: this.staticKey } : {}) });
      return;
    }
    if (node.absolutePosition && node.positionInContainer && this.collectAbs && !this.localAbs) {
      // 表のセルの中の流れで、基準のブロックがこの流れの中に無い: 基準の箱はセルか、その外 (表・表を含むブロック)。
      // 見つけた所 (セルの内容の箱の中の static position) を覚えて、セルを組む側に渡す
      this.foreignAbs.push({ node, st, sy: Math.max(this.cursor + this.pendingValue(), 0), frag: this.breakCount, ...(this.staticKey !== undefined ? { staticKey: this.staticKey } : {}) });
      return;
    }
    if (node.absolutePosition && node.positionInContainer && this.localAbs) {
      // 祖先のブロックコンテナの内容の箱を基準に置く (位置はコンテナを組み終えてから、コンテナの子にする)
      const la = this.localAbs;
      // 百分率の top・bottom・height で、コンテナの高さが中身で決まる: 高さが決まってから組む (CSS 2.1 §10.5)
      if (la.h == null && cbPercentB(node)) {
        (la.late ??= []).push({ node, st });
        return;
      }
      const n = this.buildContainer(withCbPercent(node, la.h ?? page.height, la.w), st, la.w, la.h ?? page.height);
      la.list.push({ n, node });
      this.noteIds(n);
      return;
    }
    if (node.absolutePosition) {
      // 基準は、最も近い祖先の参照領域 (XSL 1.1 §7.6.1)。span の切り替わりで分かれた領域の中では、その領域の先頭から測る
      // (top は領域の先頭からの距離。下端までの高さは、領域が短いぶん短い)
      const off = node.areaOffset && this.wm === 'horizontal-tb' ? (this.host.areaOrigin?.() ?? 0) : 0;
      // 基準がページの領域の CSS の箱 (pageArea) は、このページの領域で置き直す
      if (node.pageArea) node = atPageArea(node, page);
      const src: LBlockContainer =
        off > EPS && node.top != null
          ? withRef(node, { ...node, top: node.top + off, ...(node.areaOffset === 'fill' && node.height != null ? { height: Math.max(node.height - off, 0) } : {}) })
          : node;
      if (this.pageStatic(node)) {
        this.placePageAbs(node, st, { y: this.cursor + this.pendingValue(), x: this.contentIOffset() });
        return;
      }
      const n = this.buildContainer(src, st, page.width, page.height);
      this.abs().push(n);
      this.noteIds(n);
      this.placeHeldFootnotes(n);
      return; // 通常フローの消費計算をスキップ
    }
    const desc = describeBox(node, st.wm);
    // 90°・270° 回したコンテナ (寸法の指定・枠の無いもの) は、中身をページの幅ごとに区切り、断片を回してページごとに置く。
    // XSL-FO では、枠 (罫線・padding) の付いたものも: 1 つの箱にすると、局所の行の長さがページの高さになり、局所の
    // block の向き (回した後のページの横) に本文の幅を超えて積んだ行が、箱の外へはみ出す (字が切れる)。枠・背景は、回す前の
    // 局所の向きのまま中のブロックに移し (boxIntoBlock)、そのブロックをページごとの断片に分ける (切れ目の罫線は、ブロックの
    // 断片と同じに conditionality で決める。XSL 1.1 §7.8)
    if (
      this.paginating &&
      !this.measureOnly &&
      (node.rotation === 90 || node.rotation === 270) &&
      this.wm === 'horizontal-tb' &&
      st.wm === this.wm &&
      desc.isizeExplicit == null &&
      desc.bsizeExplicit == null &&
      !(node.columns && node.columns.count > 1) &&
      ((desc.bpI === 0 && desc.bpStart + desc.bpEnd === 0) || this.host.xslSpace)
    ) {
      if (node.breakBefore) this.forceBreak(node.breakBefore);
      const bare = desc.bpI === 0 && desc.bpStart + desc.bpEnd === 0;
      this.layoutRotatedPaged(bare ? node : boxIntoBlock(node), st, node.rotation, bare ? undefined : desc);
      if (node.breakAfter) this.setBreakNext(node.breakAfter);
      return;
    }
    // 高さの指定の無いコンテナは、内容があふれたらページをまたいで続ける (枠付きのブロックと同じに組む)。
    // 高さ固定・回転・段組・切り抜き・書字方向の違うコンテナ、書字方向を裏返すコンテナ (bt-lr・lr-bt など) は、従来どおり 1 つの箱にする
    const flips = !!(node.writingFlip && (node.writingFlip.block || node.writingFlip.inline || node.writingFlip.alternate));
    // 親と直交する書字方向のコンテナ (横書きの本文の中の writing-mode="tb-rl" など) で、行の向きの大きさ (縦書きなら高さ。
    // inline-progression-dimension) の指定が無いもの: XSL 1.1 §6.5.3 は、行の進む向きが親と違うコンテナの
    // inline-progression-dimension を auto にしてはならないとし、その組み方を決めていない (§7.15.7 の auto は「ほかの制約を
    // 考えに入れて組版ソフトが決める」)。本文の幅を行の長さにすると、箱がページの高さを超えて下へはみ出し、字が切れるので、
    // 親と直交する書字方向のブロックのページ分割 (layoutOrthogonalPaged) と同じに、行の長さをページの残りの高さ (次のページからはページの高さ) にし、
    // 親の幅まで行を積み、入りきらない行は次のページの断片へ続ける。コンテナは参照領域 (§6.5.3) なので、中と外の余白は重ねない
    // (§4.2.5 の fence。refArea)。block の向きの大きさの指定が無ければ、これまでどおり親の幅いっぱいに広げる (fillOrthogonal を
    // 中身の最小の大きさにする。ページをまたぐときは、最後の断片は中身の大きさ)
    if (
      this.host.xslSpace &&
      this.paginating &&
      !this.measureOnly &&
      (st.wm === 'horizontal-tb') !== (this.wm === 'horizontal-tb') &&
      !hasEdgeFloats(node.children) &&
      desc.isizeExplicit == null &&
      !node.rotation &&
      !(node.columns && node.columns.count > 1) &&
      !flips
    ) {
      const { columns: _c, rotation: _r, blockAlign: _a, layer: _l, top: _t, left: _x, right: _rt, bottom: _b, absolutePosition: _p, fillOrthogonal, ...rest } = node;
      const fillB = fillOrthogonal && desc.bsizeExplicit == null ? Math.max(this.contentI() - desc.bpStart - desc.bpEnd - desc.m.bs - desc.m.be, 0) : undefined;
      const blk = { ...rest, type: 'block', refLines: true, refArea: true } as LBlock;
      return this.layoutOrthogonal(blk, resolveStyle(ps, blk), ps, fillB);
    }
    if (this.paginating && desc.bsizeExplicit == null && !node.rotation && !(node.columns && node.columns.count > 1) && node.overflow !== 'hidden' && st.wm === this.wm && !flips) {
      const { columns: _c, rotation: _r, blockAlign: _a, layer: _l, top: _t, left: _x, right: _rt, bottom: _b, absolutePosition: _p, ...rest } = node;
      // layoutBlockLevel が積んだブロックの段 (このコンテナを、そのまま組むときだけ。続きから組めるブロックにする)
      const bs = this.boxStep?.via === node ? this.boxStep.step : undefined;
      this.boxStep = undefined;
      // ブロックコンテナは参照領域を作る (XSL §6.5.3): 中の余白と外の余白を重ね合わせない (§4.2.5 の fence)
      return this.layoutBlock({ ...rest, type: 'block', refLines: true, ...(this.host.xslSpace ? { refArea: true } : {}) } as LBlock, ps, bs);
    }
    // XSL-FO の段組のコンテナ (axf:column-count) の、最初の子の break-before・最後の子の break-after のページの区切り (page・even-page・
    // odd-page) は、コンテナの前・後ろの区切りでもある (XSL 1.1 §7.20.2・§7.20.1・§4.8: 子の最初の領域をページの最初に置くには、それを入れる
    // コンテナの最初の段の組も、ページの頭から始める。最後の領域も同じ)。段の区切り (column) は、段組の中で止まる (最初の段の頭・最後の段の
    // 終わりは、もう条件を満たす)。HTML の段組は、読み込みで容器へ移してある (htmlImport の段組の容器)
    let breakBefore = node.breakBefore;
    let breakAfter = node.breakAfter;
    // 前のブロックとつなげる指定があるか (中身を組むと書き換わるので、先に覚える)
    const chained = this.chainedToPrev;
    if (this.host.xslSpace && node.columns && node.columns.count > 1) {
      breakBefore = combinePageBreaks(breakBefore, columnEdgeBreak(node.children, 'before'));
      breakAfter = combinePageBreaks(columnEdgeBreak(node.children, 'after'), breakAfter);
    }
    if (breakBefore) this.forceBreak(breakBefore);
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
      this.layoutColumnsPaged(node, st, desc, ps)
    ) {
      if (breakAfter) this.setBreakNext(breakAfter);
      return;
    }
    this.columnRaised = false;
    // 組み直すときも、同じ釣り合わせの上限で組む (layoutColumnsPaged が置いたもの)
    const cap = this.balanceCap;
    const columnBox = !!(node.columns && node.columns.count > 1) && st.wm === this.wm && desc.bsizeExplicit == null;
    // ページを持たない流れ (高さを決めたコンテナ・絶対配置の箱の中) の段組: 段が取れる高さは、包含ブロックの残り (箱の前の余白と、
    // 箱の padding・罫線を引いたもの)。それより高い段は包含ブロックからはみ出すので、そこに入らない分けない指定のブロックは分ける
    // (XSL 1.1 §7.20.3。CSS Fragmentation 3 §3.3)
    // ページを持つ流れでも、CSS の高さを決めた祖先の箱 (height。中身があふれても箱の高さは変わらない: CSS 2.1 §10.6・§11.1) の中では、
    // その箱の終わりまで
    if (columnBox) {
      const end = this.paginating ? this.fixedBlockEnd() : this.blockRoom;
      if (end !== undefined) {
        const r = Math.max(end - this.cursor - this.marginBefore(desc.m.bs, desc.precBs) - desc.bpStart - desc.bpEnd, 0);
        if (!this.paginating || r < this.room - this.cursor - EPS) this.columnRoom = r;
      }
    } else if (!this.paginating && this.blockRoom !== undefined && st.wm === this.wm && desc.bsizeExplicit == null && !node.rotation) {
      // 段組でない、高さの決まらない箱 (ページを持たない流れの中): 中の流れの使える長さは、この流れの残りから、箱の前の余白と箱の
      // padding・罫線を引いたもの (中の段組の上限にだけ使う。buildContainer の roomB)
      this.innerBlockRoom = Math.max(this.blockRoom - this.cursor - this.marginBefore(desc.m.bs, desc.precBs) - desc.bpStart - desc.bpEnd, 0);
    }
    // 組み直すことのある段組の箱 (下): 1 度目の組みが外へ残すもの (絶対配置の箱・マーカー・警告) は、組み直すなら捨てる
    const held = columnBox && this.paginating ? this.holdEffects() : undefined;
    let n: LNode;
    try {
      n = this.buildContainer(node, st, undefined, undefined);
    } catch (e) {
      held?.(true);
      throw e;
    }
    // CSS: 置く位置の余白は親の書字方向で読む (余白は物理の辺の値。親と直交する縦書きの箱の margin-top は、横書きの親では block-start。
    // 箱自身の縦書きで読むと inline-start になり、箱が右にずれる)。
    // XSL-FO は、space-before などを箱自身の書字方向で物理の辺に読み替えている (xslfoImport) ので、箱自身の向きで読む
    const outer = st.wm === this.wm || this.host.xslSpace ? desc : describeBox(node, this.wm);
    // 段組の箱 (1 つの箱に組むもの): 分けない指定のブロックを分けないために段を高くした箱が、置く場所 (いまのページ・段の残り) に
    // 入らなければ、はみ出した分だけ段を低くした高さを、段の取れる高さにして組み直す (その高さに入らない分けない指定のブロックは分ける。
    // XSL 1.1 §7.20.3: keep は、満たせなければ破る。CSS Fragmentation 3 §3.3 の avoid も同じ)。箱の padding・罫線、span="all" の
    // 要素、中の脚注、前の余白 (捨てるものは数えない) は、置いてみた箱で数えるので、見積もらない。
    // ページ (段) の途中でも、いまのページで分ける (箱ごと次のページへ送ることはしない: 枠の無い段組 layoutColumnsPaged と同じ)
    let redo = false;
    let moved = false;
    if (this.columnRaised && held) {
      this.columnRaised = false;
      this.applyPendingBreak();
      const over = this.placeOverflow(n, outer.m.bs, outer.precBs);
      // 次のページの頭なら、分けない指定のブロックを分けずに箱ごと入るなら、箱の前で改ページして、組んだ箱をそのまま次のページに置く
      // (CSS Fragmentation 3 §4.4・XSL 1.1 §4.8: 避ける指定を破らない区切り (箱の前) を選ぶ。layoutColumnsPaged と同じ)。次のページの高さは
      // ページの型から求める (nextLimit)。箱の中の絶対配置の箱も、送った先のページに積み直す (holdEffects の move)。前は、いまのページで分けた
      const nextRoom = this.nextLimit - (this.limit - this.room);
      if (over > EPS && this.pageHasContent && !node.keepWithPrevious && !chained && n.bsize <= nextRoom + EPS) {
        this.breakPage();
        if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
        held('move');
        moved = true;
      } else if (over > EPS) {
        redo = true;
        held(false);
        this.columnRoom = Math.max(n.bsize - desc.bpStart - desc.bpEnd - over, 0);
        this.balanceCap = cap;
        n = this.buildContainer(node, st, undefined, undefined);
      }
    }
    if (held && !redo && !moved) held(true);
    this.columnRaised = false;
    this.columnRoom = undefined;
    // 直交する箱の、親の行の向きの auto の余白 (CSS 2.1 §10.3.3): 箱の大きさが決まったので、置く場所の残りを配る
    let mis = outer.m.is;
    if (node.autoMargins && st.wm !== this.wm) {
      const free = this.contentI() - outer.m.is - outer.m.ie - n.bsize;
      if (free > EPS) mis += node.autoMargins === 'center' ? free / 2 : node.autoMargins === 'start' ? free : 0;
    }
    this.placeBox(n, outer.m.bs, outer.m.be, mis, this.extentAlongBlock(n), outer.precBs, outer.precBe, outer.retainBe);
    if (breakAfter) this.setBreakNext(breakAfter);
  }

  /**
   * ページをまたぐ段組のコンテナ: 1 ページ目の段はページの残りの高さ、続くページの段はページの高さで、段を順に埋める。
   * 最後のページの段は、段数に収まる最小の高さに釣り合わせる。段の行 (段と段間罫) を、ページごとに 1 つずつ置く。
   * 釣り合わせた 1 行がページの残りに収まるなら、false を返す (従来どおり 1 つの箱にする)
   */
  private layoutColumnsPaged(node: LBlockContainer, st: ResolvedStyle, desc: ReturnType<typeof describeBox>, ps: ResolvedStyle): boolean {
    this.applyPendingBreak();
    // 段を釣り合わせずに順に埋める段の組か (layoutColumnSegments が、強制のページの区切りの前の段の組に置く)
    const cols = node.columns!;
    // column-fill: auto (CSS Multi-column 1 §7.1) の段組も、段の高さをページの残りにして順に埋める
    const fillSequential = this.columnFillNext || cols.fill === 'auto';
    this.columnFillNext = false;
    const n = cols.count;
    const gap = cols.gap ?? 12;
    const isize = (desc.isizeExplicit ?? this.contentI() - desc.m.is - desc.m.ie - desc.bpI) + desc.bpI;
    const colI = Math.max((isize - desc.bpI - gap * (n - 1)) / n, 1);
    const wm = st.wm;
    // ページの頭で捨てる前の余白 (送った段組の頭: discardLeading) は、1 行目の段の高さから引かない
    let avail = this.room - this.cursor - this.pendingValue() - (this.discardLeading && !this.pageHasContent && !(node as { retainSpaceBefore?: boolean }).retainSpaceBefore ? 0 : desc.m.bs);
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
      // 段の中のページの区切り (CSS Fragmentation 3 §4.3: ページの区切りは段の区切りも兼ねる): 次の段へ移るとき、その行の残りの段を空にして、
      // 次の段の行 (= 次のページ) の最初の段から続ける。rowKinds[r] は段の行 r の前の強制の区切りの種類 (置くときに、左右のページの白ページを挟む)
      const breaks = columnPageBreaks(n, roots, used, () => newNode('block', wm, { isize: colI }));
      const flow = new Flow(final ? this.host : { ...this.host, warn: () => {} }, {
        wm,
        rootI: colI,
        root: roots[0],
        limit: limitOf(0),
        pages: {
          addMarkers: (list) => {
            if (final) pushAll((colMarkers[roots.length - 1] ??= []), list);
          },
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          columnIndex: () => roots.length - 1,
          // XSL-FO の段組のコンテナ (axf:column-count) の中の page・even-page・odd-page も、ページの区切り (XSL 1.1 §7.20.1・§7.20.2:
          // その FO の最初 (最後) の領域を、ページの最初 (最後) に置く。段の区切りでは、その条件を満たさない)
          pageBreakInColumns: breaks.note,
          nextPage: () => {
            breaks.skip();
            const r = newNode('block', wm, { isize: colI });
            roots.push(r);
            return { root: r, limit: limitOf(roots.length - 1), rootI: colI };
          },
        },
        abs: final ? this.abs : this.trialAbs,
        pageSize: this.pageSize,
        footnotes: this.foot,
        holdFootnotes: true,
        // XSL-FO の段組のコンテナ (axf:column-count): コンテナは参照領域 (XSL 1.1 §6.5.3) で、段もその中の参照領域 (region-body の段の
        // normal-flow-reference-area と同じ: §6.4.13) なので、段の頭の conditionality="discard" の余白は捨てる (§4.3.1。強制の区切りの後も。
        // retain の余白は残す)。見本の PDF: サンプル FO 集の axf-initial-letters-1 は、段の組の最初の段の頭の space-before を空けない
        // (1 段目の見出しが 2 段目の見出しと同じ高さ。span="all" の後ろの段の組の最初の見出しも、span のすぐ下)。
        // アンテナハウス互換 (discardStartMargin。CSS): 最初の段の頭の余白を捨てる。強制の段区切りの後の余白は残す
        ...(this.host.xslSpace ? { discardLeading: true, areaEnd: true } : cols.discardStartMargin ? { discardLeading: true, discardAfterForced: false } : {}),
      });
      flow.layoutChildren(columnChildren(node), st);
      flow.finishPaginated();
      return { roots, used, colMarkers, rowKinds: breaks.rowKinds, over: flow.overflowedLine, split: flow.splitKeepTogether };
    };
    // 釣り合わせた 1 行 (段数で割った高さ) がページの残りに収まるなら、従来どおり
    // 釣り合わせた 1 行がその高さに収まるか (行は分けられないので、全体の高さ ÷ 段数ではなく、実際に段へ組んで調べる)
    // 試し組みで決める値 (1 行に収まるか・行の数と最後の行の高さ) は、同じ条件なら覚えて使い回す (memoMeasure。入れ子の段組で、
    // 外側の試し組みのたびに内側の試し組みをやり直さない)
    const memoParts = [colI, n, !!cols.discardStartMargin, (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid];
    const fitsOneRow = (h: number) => this.memoMeasure('colrow', node.children, st, [...memoParts, h], this.foot, () => run(() => h, false).roots.length <= n);
    /** 1 つの箱に任せる (順に埋める段の組は、段の高さをページの残りにして、釣り合わせない) */
    const oneBox = (h: number) => {
      if (fillSequential) this.columnFillLimit = h;
      return this.capBalance(h);
    };
    if (fitsOneRow(avail + EPS)) return oneBox(avail + EPS);
    // ページの残りが 2 行に満たなければ、次のページから始める
    if (avail < st.fontSize * 2.5 && this.pageHasContent) {
      this.breakPage();
      // XSL-FO: 送ったコンテナの space-before は、強制でない改ページに接するので捨てる (XSL 1.1 §4.3.1。ふだんのブロックを送るときと
      // 同じ。retain の余白は残す)。前は、新しいページの頭に残していた
      // HTML も同じ (CSS Fragmentation 3 §5.2: 強制でない区切りに接する余白は切り詰める)。前は、新しいページの頭に残し、そのうえ、捨てた余白を
      // 1 行目の段の高さから引いていた (ページの頭の段組の 1 行目の段が、余白の分だけ短かった)
      if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
      // 新しいページの高さで決め直す (段の高さの上限も新しいページのもの)。釣り合わせた 1 行が収まるなら、従来どおり
      avail = this.room - this.cursor - this.pendingValue() - (this.discardLeading && !(node as { retainSpaceBefore?: boolean }).retainSpaceBefore ? 0 : desc.m.bs);
      full = fullRoom();
      if (fitsOneRow(avail + EPS)) return oneBox(avail + EPS);
    }
    // XSL-FO の段組のコンテナ (axf:column-count) の、段をまたぐ子 (span="all") があれば、その前後で段の組を分ける (1 つの箱に収まらないとき。
    // 収まるときは、layoutBoxColumns が 1 つの箱の中で分ける)。アンテナハウスの拡張の段組 (XSL 1.1 には無い): 製品の見本 (サンプル FO 集の
    // axf-initial-letters-1) は、span="all" のブロックをコンテナの幅に置き、その後ろの中身を新しい段の組の最初の段から続け、
    // span="all" のブロックの break-before="page" で次のページへ送る
    if (this.host.xslSpace && node.children.some(isColumnSpanner)) {
      this.layoutColumnSegments(node, st, ps);
      return true;
    }
    const rowOf = (col: number) => Math.floor(col / n);
    const { rows, lastLimit, split } = this.memoMeasure('colpaged', node.children, st, [...memoParts, avail, full, fillSequential], this.foot, () => {
      const greedy = run((c) => (rowOf(c) === 0 ? avail : full), false);
      const rows = Math.max(1, Math.ceil(greedy.roots.length / n));
      // 順に埋める段の組は、最後の行も釣り合わせない
      if (fillSequential) return { rows, lastLimit: rows === 1 ? avail : full, split: greedy.split };
      // 最後の行を釣り合わせる (段数に収まる最小の高さ)
      let lastLimit = rows === 1 ? avail : full;
      if (rows > 1) {
        let lo = 0;
        let hi = full;
        for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
          const mid = (lo + hi) / 2;
          // 空の段の先頭でも入らずにはみ出させた行のある高さ (over) は、収まるとみなさない (balanced の fits と同じ。段の中の強制の区切りの後の
          // 1 行だけの最後の行で、高さを 0 近くまで下げて、行が段からはみ出していた)。どの高さでも入らない行 (greedy でもはみ出す) は数えない
          const r = run((c) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : mid), false);
          // 分けない指定 (keep-together.within-column) のブロックを、最後の行を低くしたために分けた高さも、収まるとみなさない (XSL 1.1 §7.20.3。
          // 段をページの高さにしても分かれるもの (greedy.split) は数えない)
          if (r.roots.length <= rows * n && (this.host.xslSpace || !r.over || greedy.over) && r.split <= greedy.split) hi = mid;
          else lo = mid;
        }
        lastLimit = hi;
        // 最後の行も、最初の段をいちばん長くし、後の段ほど短くする (balanceColumns と同じ方針)
        const limitOf = (h: number) => (c: number) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : h);
        const ok = (h: number) => {
          const r = run(limitOf(h), false);
          if (r.roots.length > rows * n || (!this.host.xslSpace && r.over && !greedy.over) || r.split > greedy.split) return false;
          const u = r.used.slice((rows - 1) * n, rows * n);
          return u.every((x, k) => k === 0 || x < u[k - 1] + st.fontSize);
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
      return { rows, lastLimit, split: greedy.split };
    });
    // いまのページから始めると、中の分けない指定のブロック (break-inside: avoid・keep-together) を分けるが、次のページから始めれば分ける数が
    // 減るなら、段組の前で改ページする (CSS Fragmentation 3 §4.4: 区切りは、避ける指定を破るものの少ない所を選ぶ。段組の前は、段組に
    // break-before: avoid が無ければ、どの指定も破らない区切り。XSL 1.1 §4.8 の keep も同じ)。前は、いまのページで分けていた。
    // 次のページの段の高さは、ページの型から求めた次のページの高さ (fullRoom)
    if (split > 0 && this.pageHasContent && !node.keepWithPrevious && !this.chainedToPrev) {
      const fresh = this.memoMeasure('colfresh', node.children, st, [...memoParts, full], this.foot, () => run(() => full, false).split);
      if (fresh < split) {
        this.breakPage();
        if (!(node as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
        return this.layoutColumnsPaged(node, st, desc, ps);
      }
    }
    const { roots, used, colMarkers, rowKinds } = run((c) => (rowOf(c) === 0 ? avail : rowOf(c) < rows - 1 ? full : lastLimit), true);
    // 段の行の箱は、コンテナ自身の断片: inline 方向の罫線と padding (block 方向のものは無い。呼ぶ側の条件)・id (page-number-citation の
    // 参照先)・元の入力の節を持つ。段は、その内容の箱 (padding と罫線の内側) の始めの端から並べる。
    // 背景の画像・斜めの罫線・効果 (decorOf)・角丸・影も、ページをまたぐブロックの断片 (breakPage で開き直す箱) と同じく、どの断片にも付ける。
    // 角丸は、box-decoration-break: slice なら、切れ目の側の角を丸めない (CSS Fragmentation 3 §5.4。cutRadius)
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
      // 段の行の前の強制のページの区切り (段の中の break-before: page など): 外の流れで区切る (left・right は、偶奇が合うまで白ページを挟む。
      // 段組の外の流れも段組の段なら、その段の流れに知らせる)
      const lead = rowKinds[r];
      if (lead) this.forceBreak(lead);
      else if (r > 0) this.breakPage();
      // この行の段のマーカーは、この行を置くページに記録する (placeBox が記録する)
      for (let k = 0; k < n; k++) pushAll(this.markerSink, colMarkers[r * n + k] ?? []);
      const last = (r + 1) * n >= roots.length;
      const row = newNode('block', wm, { isize, bsize: height, padding: { ...desc.paddingP }, border: { ...desc.borderP }, bg: desc.bg, ...this.decorOf(desc), src: desc.src, ref: desc.ref, radius: desc.radius, shadow: desc.shadow, children: kids });
      if (placedRow) row.cont = true;
      if (!last) row.contNext = true;
      if (placedRow && !desc.keepStart.border) cutRadius(row, startSide(wm));
      if (!last && !desc.keepEnd.border) cutRadius(row, endSide(wm));
      placedRow = true;
      this.placeBox(row, r === 0 ? desc.m.bs : 0, last ? desc.m.be : 0, desc.m.is, this.extentAlongBlock(row), r === 0 ? desc.precBs : 0, last ? desc.precBe : 0);
    }
    return true;
  }

  /**
   * XSL-FO の段組のコンテナの中身を、段をまたぐ子 (span="all") の前後で分けて組む (layoutColumnsPaged)。span="all" の子は、コンテナの幅で
   * 外の流れに置く (その強制の区切りは、外の流れのページの区切り)。その間の中身は、それぞれ新しい段の組 (段組のコンテナ) にする:
   * 段の組の最初の段は、新しい段の始まりなので、最初の子の break-before="column" では段を空けない (XSL 1.1 §4.8: 区切りの条件が、もう
   * 満たされている)。段の組は、次の段をまたぐ子の前で釣り合わせる (layoutBoxColumns・layoutColumnsPaged の最後の行)。ただし、
   * 次の段をまたぐ子の前か、段の組の最後の子の後ろで、ページを区切るなら、釣り合わせずに順に埋める (region-body の段組の span の前と同じ。
   * 見本の PDF: axf-initial-letters-1 の 2 ページ目は、break-before="page" の span="all" の前の 2 つの画像を、どちらも 1 段目に置く)。
   * コンテナの block 方向の余白は、最初と最後の断片だけに付ける。id は、どの断片にも付ける (同じ FO の続きの領域: 最初のページは最初の
   * 断片、最後のページは最後の断片。XSL 1.1 §6.6.11・§6.6.12)
   */
  private layoutColumnSegments(node: LBlockContainer, st: ResolvedStyle, ps: ResolvedStyle) {
    const groups: Array<{ span: boolean; items: LBlockContainer['children'] }> = [];
    for (const c of node.children) {
      const sp = isColumnSpanner(c);
      const last = groups[groups.length - 1];
      if (!sp && last && !last.span) last.items.push(c);
      else groups.push({ span: sp, items: [c] });
    }
    const real = groups.filter((g) => g.span || g.items.some((c) => typeof c !== 'string' || c.trim() !== ''));
    const before = startSide(st.wm);
    const after = endSide(st.wm);
    const { columns: _c, rotation: _r, blockAlign: _a, layer: _l, top: _t, left: _x, right: _rt, bottom: _b, absolutePosition: _p, children: _ch, ...box } = node;
    real.forEach((g, k) => {
      const first = k === 0;
      const last = k === real.length - 1;
      const edges = {
        ...(first ? {} : { keepWithPrevious: undefined }),
        ...(last ? {} : { keepWithNext: undefined }),
        breakBefore: undefined,
        breakAfter: undefined,
        margin: keepBlockSides(node.margin, before, after, first, last),
      };
      if (g.span) {
        // コンテナの断片 (行の向きの余白・罫線・背景を持つ。コンテナと同じく参照領域: §6.5.3) の中に、span="all" の子を置く
        // span="all" の領域の頭と終わりの conditionality="discard" の余白は捨て (refArea)、retain の余白は残す (keepAreaEnd。§4.3.1)
        this.layoutBlockLevel({ ...box, ...edges, type: 'block', refArea: true, keepAreaEnd: true, children: g.items } as LBlock, ps);
        return;
      }
      const next = real[k + 1];
      const pageKind = (b: BreakKind | undefined) => !!b && b !== 'column';
      const nextBreaks = !!next && (pageKind((next.items[0] as LBlock).breakBefore) || pageKind(columnEdgeBreak(next.items, 'before')));
      this.columnFillNext = !!next && (nextBreaks || pageKind(columnEdgeBreak(g.items, 'after')));
      this.layoutContainer(withRef(node, { ...node, ...edges, children: g.items } as LBlockContainer), ps);
      this.columnFillNext = false;
    });
  }

  /** ブロックコンテナ自身を固定ボックスとしてレイアウト (内部は独立した無改ページ Flow) */
  /** trailing: dropTrailing のとき、捨てた末尾の余白 (内容の最後の space-after) の長さを after に入れて返す */
  buildContainer(node: LBlockContainer, st: ResolvedStyle, pageW: number | undefined, pageH: number | undefined, dropTrailing = false, trailing?: { after: number }): LNode {
    const innerRoom = this.innerBlockRoom;
    this.innerBlockRoom = undefined;
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
    if (rotOdd && horizontal && pageH == null && contentI == null && node.children.length && !this.simplified()) {
      const avail = Math.max(fallbackI - desc.bpI, 1);
      const need = this.memoMeasure('rotlen', node.children, st, [avail], undefined, () => maxLineLength(this.measureSub(node.children, st, avail, {}, wmC).sub.root, true, true));
      if (need > 0 && need < avail) fallbackI = need + desc.bpI;
    }
    // CSS の絶対配置の箱で幅が auto (left と right の両方の指定は無い): shrink-to-fit (CSS 2.1 §10.3.7)。
    // min(max(最小の内容の幅, 使える幅), 内容の幅)。求め方は幅の指定の無い float と同じ
    if (node.shrinkToFit && contentI == null && horizontal && !rot && !(node.left != null && node.right != null) && node.children.length && !this.simplified()) {
      // 最小の内容の幅は、min-content を測る印を付けて測る (float と同じ)
      const availC = Math.max(fallbackI - desc.bpI, 0);
      const widthAt = (rootI: number, min = false) => this.intrinsicWidth(node.children, st, rootI, min);
      const pref = widthAt(Math.max(availC, 1) * 100);
      const minC = pref <= availC ? pref : widthAt(1, true);
      contentI = Math.min(Math.max(minC, availC), pref);
    }
    // 縦書きの絶対配置の箱 (縦書きの文書の中でも、横書きの文書の中でも) で、行の向きの大きさ (高さ) が auto (top と bottom の両方の
    // 指定は無い): shrink-to-fit (CSS 2.1 §10.3.7 を行の向きに当てる。CSS Writing Modes 3 §7.2・§7.3.2 の fit-content)。使える長さは、
    // 包含ブロックの高さから top・bottom を引いたもの (fallbackI)
    if (node.shrinkToFit && contentI == null && !horizontal && !rot && !(node.top != null && node.bottom != null) && node.children.length && !this.simplified()) {
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
    // 中身で block の向きの大きさが決まる箱の、中身に使える長さ: 高さを決めた箱は、その高さ。位置を決めた箱 (絶対配置。pageH・pageW は
    // 包含ブロックの大きさ) は、包含ブロックから、位置の指定と箱の padding・罫線を引いた長さ (CSS 2.1 §10.6.4・XSL 1.1 §7.6.1)。
    // 中の段組の段が取れる高さの上限にする (それより高い段は、箱・包含ブロックからはみ出す)
    // 高さの決まらない箱 (位置も決めない) は、それを置く流れの残り (layoutBlockContainer の innerBlockRoom。中身があふれても、包含ブロックの
    // 残りより高い段は、包含ブロックからはみ出す)
    const roomB =
      contentB ??
      (rotOdd ? undefined : horizontal ? (pageH != null ? Math.max(pageH - (node.top ?? 0) - (node.bottom ?? 0) - bpPhysH, 0) : undefined) : pageW != null ? Math.max(pageW - (node.left ?? 0) - (node.right ?? 0) - bpPhysW, 0) : undefined) ??
      (pageW == null && pageH == null ? innerRoom : undefined);
    let used: number;
    let kids: LNode[];
    if (node.columns && node.columns.count > 1) {
      if (contentB == null && roomB !== undefined && this.columnRoom === undefined) this.columnRoom = roomB;
      // 段組の max-height (HTML。aspect-ratio の無い箱): 段の高さは、その内側に取る (CSS Multi-column 1 §7.1。箱の高さは抑えない)。
      // 置く場所の残りが分からないときも、段の取れる上限 (columnRoomBound: ページを持たない流れは版面の高さ) より高くはしない
      if (contentB == null && !node.aspectRatio && node.maxBlockSize != null && horizontal) this.columnRoom = Math.min(this.columnRoom ?? this.columnRoomBound(wmC) ?? Infinity, node.maxBlockSize);
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
        ...(roomB !== undefined && !rot ? { blockRoom: roomB } : {}),
      });
      sub.layoutChildren(node.children, st);
      if (dropTrailing) {
        const fin = sub.finishWithTrailing();
        used = fin.height;
        if (trailing) trailing.after = fin.after;
      } else used = sub.finishAtomic();
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
      // 百分率の top・bottom・height の箱: 組み終えた内容の高さ (+ padding = padding の箱の高さ) を基準に組んで置く
      for (const { node: an, st: ast } of localAbs?.late ?? []) {
        const a = this.buildContainer(withCbPercent(an, used, localAbs!.w), ast, localAbs!.w, used);
        const at = a.phys ?? { x: 0, y: 0 };
        delete a.phys;
        a.i = at.x;
        a.b = at.y;
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
      const widths = cols.map((col) => maxOf(col.map((k) => lm(k).is + k.isize + lm(k).ie)));
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
          return lp.bs + lb.bs + (k.children.length ? maxOf(k.children.map((c) => c.b + c.bsize)) : 0) + lp.be + lb.be;
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
      let x = node.left ?? (node.right != null ? pageW - node.right - s.width : 0);
      // left・right・width がどれも auto でない箱の auto の左右の余白 (CSS 2.1 §10.3.7): 残り (負もある) を auto の余白に配る。
      // 両方 auto なら等分する。ただし残りが負なら、包含ブロックの direction が ltr なら margin-left を 0 に、rtl なら margin-right を 0 にする
      // (箱の direction は包含ブロックから継ぐので、箱の direction で読む)。片方だけ auto なら、その余白が残りを取る
      if (node.autoMargins && node.left != null && node.right != null && node.width != null && !rot) {
        const free = pageW - node.left - node.right - s.width;
        const am = node.autoMargins;
        x += am === 'center' ? (free >= 0 ? free / 2 : st.direction === 'rtl' ? free : 0) : am === 'start' ? free : 0;
      }
      const y = node.top ?? (node.bottom != null ? pageH - node.bottom - s.height : 0);
      out.phys = { x, y };
    }
    return out;
  }

  /**
   * コンテナの中の段組。段の高さ limit で段を順に埋める Flow を組み、高さの指定 (contentB) が無ければ、
   * 段数に収まる最小の高さを二分探索で求めて釣り合わせる。段と段間罫の箱を返す
   */
  private layoutBoxColumns(node: LBlockContainer, st: ResolvedStyle, innerI: number, contentB: number | undefined, gridShift = 0): { used: number; kids: LNode[] } {
    const cols = node.columns!;
    const n = cols.count;
    const gap = cols.gap ?? 12;
    const wm = st.wm;
    // 釣り合わせた段の高さの上限 (ページの残りの高さ。ページをまたぐ段組が 1 つの箱に任せたとき。balanceCap)
    const cap = this.balanceCap;
    this.balanceCap = undefined;
    // 段が取れるいちばん高い高さ。分けない指定のブロックが、この高さの段にも入らないかを確かめる (下の balanced)。
    // 置く場所の残りは、見積もらずに、分けずに釣り合わせた箱を置いてみて決める (columnRoom。layoutBlockContainer が、はみ出した分を
    // 引いて置く。span の後ろの段の組は、その上の高さを引く)。それが無いときは、段の取れる上限: ページ (段) を持つ流れは、その高さ。
    // 持たない流れ (絶対配置の箱・float の中) は、版面の高さ (それより高い段は、置いても版面からはみ出す)
    const roomH = this.columnRoom ?? this.columnRoomBound(wm);
    this.columnRoom = undefined;
    const fillLimit = this.columnFillLimit;
    this.columnFillLimit = undefined;
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
          // この段の組が取れる高さは、上に置いた段の組・またがる要素の分を引いたもの
          this.columnRoom = roomH !== undefined ? Math.max(roomH - y, 0) : undefined;
          // 段組の箱の行グリッド (new) は、箱の内容の上端から引く。またがる要素の後ろの段組も、その格子に載せる (y はこの段組の上端の位置。
          // 見本の PDF: CSS-Print 第 4 版の 9.3.6 の段組フロートの下の段の本文は、段組の箱の格子に載る)
          const r = this.layoutBoxColumns(withRef(node, { ...node, children: seg }), st, innerI, h, y);
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
            if (final) pushAll(this.markerSink, list);
          },
          noteId: () => {},
          columnEnd: (u) => used.push(u),
          columnIndex: () => roots.length - 1,
          // 1 つの箱に組む段組 (ページをまたがない) の中のページの区切りは、段の区切りにする (残りの段を飛ばすと、中身が箱に入らない)。
          // 左右のページの指定の白ページ (外の流れのページ番号で数える) も、段には挟まない。XSL-FO の、高さを決めた段組のコンテナも同じ
          // (中身はコンテナの外へ出ない。白ページの分の段を空けると、後ろの中身が箱からはみ出して消えていた)
          pageBreakInColumns: (_kind: BreakKind, hasContent: boolean) => hasContent,
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
        // XSL-FO の段組のコンテナの段の頭の conditionality="discard" の余白は捨てる (XSL 1.1 §4.3.1。layoutColumnsPaged の段と同じ)。
        // アンテナハウス互換 (discardStartMargin。CSS): 最初の段の頭の余白を捨てる。強制の段区切りの後の余白は残す (CSS Fragmentation)
        ...(this.host.xslSpace ? { discardLeading: true, areaEnd: true } : cols.discardStartMargin ? { discardLeading: true, discardAfterForced: false } : {}),
      });
      // またがる要素の後ろの段組 (gridShift > 0) は、箱の new の行グリッドを、箱の内容の上端 (この段組の上端の gridShift 上) から引く
      const ownGrid = (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid;
      if (gridShift > 0 && ownGrid === 'new' && wm === 'horizontal-tb') {
        flow.outerGrid = { pitch: lineHeightOf(st), ascent: this.nominalRatio(st) * st.fontSize, origin: -gridShift };
        flow.layoutChildren(node.children, st);
      } else flow.layoutChildren(columnChildren(node), st);
      flow.finishPaginated();
      return { roots, used, after: flow.afterBelowUsed, broke: flow.brokeKeep, deferred: flow.deferredBefore, over: flow.overflowedLine, split: flow.splitKeepTogether };
    };
    /** 釣り合わせた段の高さ (試し組みで探す) */
    const balanced = (room?: number): { limit: number; raised: boolean } => {
      let limit: number;
      // 分けない指定のブロックを分けないために、段を高くしたか (分けた数だけで収まらないとみなした高さがあったか)
      let raised = false;
      // 1 段に組んだ高さを段数で割った値から、段数に収まる最小の高さを探す
      const one = run(1e7, false);
      // 分けない指定のブロックを分けた数の基準: 段の高さを、段が取れるいちばん高い高さ (room) にしても分かれるものは、どの高さでも分かれる
      // (XSL 1.1 §7.20.3: keep は、満たせなければ破る。CSS Fragmentation 3 §3.3 の avoid も同じ) ので数えない。room の無いときは、
      // 1 段に組んだ高さ (分かれるものは無い: one.split は 0)
      const ref = room !== undefined ? run(room, false) : one;
      // 強制の段区切り (Fragmentation 3 §3.1 の break-before: column など) があると、高さを限らなくても段が分かれる。
      // 上限はいちばん高い段の高さ (その高さなら、どの段も区切りの所までで収まる)、下限は中身の全体を段数で割った高さ
      const total = Math.max(0, ...one.used);
      let lo = one.used.reduce((a, b) => a + b, 0) / n;
      let hi = Math.max(total, lo);
      // 下端の float を段の内容の後ろに足すときは、1 段の高さに float が入るので、収まれば更に低い高さも探す
      // 段数に収まり、widows / orphans を守れる高さを、収まるとみなす (空の段で段落を無理に分けた高さは採らない)。
      // 前方 (top) の float を次の段へ送らずに済む高さだけを採る (float は置き場所の段の上端に置く)
      // 空の段の先頭でも入らずにはみ出させた行のある高さ (over) も、収まるとみなさない (その高さで本番を組むと、行が段からはみ出して
      // 「行がページに収まりません」になる)。どの高さでも入らない行 (1 段より高い画像など) は、上限 (1 段に組んだ高さ) で収まる
      // 分けない指定 (keep-together.within-column) のブロックを段の境目で分けた高さも、収まるとみなさない (XSL 1.1 §7.20.3。基準 (ref) の
      // 高さでも分かれる数までは数えない)
      const fits = (r: ReturnType<typeof run>) => {
        if (r.roots.length > n || r.broke || r.deferred || r.over) return false;
        if (r.split <= ref.split) return true;
        raised = true;
        return false;
      };
      // 段が取れるいちばん高い高さ (room) で収まるなら、それより高い段は探さない。収まるかは高さについて単調でない (段より高い分けない指定の
      // ブロックは、段の高さがそのブロックより高くなると次の段へ送られ、段が 1 つ余る) ので、探す範囲に room より高い所を残すと、
      // ブロックを分けずに 1 段に積んだ、room より高い段 (ページより高い段組) に行き着いていた
      if (room !== undefined && room >= lo && room < hi && fits(ref)) hi = room;
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
      // 段の下端の float がある段組は、float の分で段の長さが変わるので調整しない。
      // 後ろの段が前の段より長くても、その差が段組の箱の 1em 未満なら、同じ高さとみて伸ばさない (見本の PDF: アンテナハウスの
      // サンプル FO 集の graphics-cgm-1 は、2 段目の画像の箱が 1.24pt 高いまま [見出し・画像] | [見出し・画像] に組む。
      // CSS-Print 第 4 版の段組の例と、ほかの見本の段組は、差が 14pt 以上 (1em 以上) で、伸ばして 1 段目を長くする)。
      // ただし、伸ばして使う段の数が減る (後ろの段が空になる) 高さは採らない (見本の PDF: CSS-Print 第 4 版の 5.2 の段組の例は、
      // 2 段目が 1 段目より長いまま 3 段に組む。伸ばして 2 段にすると、箱が高くなって次のページへ送られる)
      if (!first.after) {
        const usedCols = (r: ReturnType<typeof run>) => r.roots.filter((x) => x.children.length > 0).length;
        const minCols = usedCols(run(limit, false));
        const ok = (h: number) => {
          const r = run(h, false);
          if (!fits(r) || usedCols(r) < minCols) return false;
          const u = r.used.slice(0, n);
          return u.every((x, k) => k === 0 || x < u[k - 1] + st.fontSize);
        };
        // 条件を満たす最小の高さを二分探索で求める (0.5pt まで)。見つからなければ最小の高さのまま。
        // 伸ばすのは、1 段に組んだ高さ (total) までで、ページの残りの高さ (cap) を超えない (超えると、段組がページより高くなり、下へはみ出す。
        // 分けられない塊 (orphans・break-inside: avoid) が段の境目に来て、2 段目が 1 段目より長くなるとき)
        // ページの残りの高さ (cap) は、1 段に組んだ高さ (total) まで探して見つけた高さが、それを超えるときだけ上限にして、探し直す。
        // 初めから cap を上限にすると、探す範囲が変わって、cap を超えない段組でも結果が変わる (条件は高さについて単調でない: 伸ばすと
        // 後ろの段が空になる高さは採らない)。3 段の段組の最後の段落の margin-bottom (CSS 2.1 §8.3.1・§10.6.7: 段組の箱の中の余白で、
        // 中身の終わりは区切りではないので、CSS Fragmentation 3 §5.2 のようには切り詰めない) で最後の段が 1em 長いとき、段を 1 行ずつ
        // 伸ばして、12・12・12 行の段落を 13・13・10 行に組んでいた (CSS Multi-column 1 §7.1 の balance の「できるだけ均等に」から遠い)
        if (!ok(limit)) {
          const stretch = (upper: number): number => {
            if (!(limit < upper)) return limit;
            let a = limit;
            let b = upper;
            while (b - a > 0.5) {
              const mid = (a + b) / 2;
              if (ok(mid)) b = mid;
              else a = mid;
            }
            return ok(b) ? b : hi;
          };
          let h = stretch(room !== undefined ? Math.min(total, Math.max(room, limit)) : total);
          if (room === undefined && cap !== undefined && h > Math.max(cap, limit) + EPS) h = stretch(Math.min(total, Math.max(cap, limit)));
          limit = h;
        }
      }
      return { limit, raised };
    };
    // 釣り合わせた高さは、同じ条件なら覚えて使い回す (memoMeasure。入れ子の段組で、外側の試し組みのたびに内側の釣り合わせをやり直さない)
    const balKey = [colI, n, !!cols.discardEndMargin, !!cols.discardStartMargin, (node as { baselineGrid?: LBlock['baselineGrid'] }).baselineGrid, gridShift, cap ?? -1];
    let limit: number;
    if (contentB != null) limit = contentB;
    else if (fillLimit !== undefined) limit = fillLimit;
    else {
      let bal = this.memoMeasure('colbal', node.children, st, balKey, this.foot, () => balanced());
      // 分けない指定のブロックを分けずに釣り合わせた段が、段の取れる高さ (roomH) より高いとき (1 段より高い分けない指定のブロックを、1 段に
      // 積んだ): その高さでも分かれるブロックは分けてよいとして、釣り合わせ直す (段に入るブロックは、これまでどおり分けない)。
      // 段に収まるときは、試し組みを増やさない
      // 分けない指定のブロックを次の段へ送ると段が余るために、段の取れる高さより高い段に行き着いたとき (段より高い分けない指定のブロックの前に
      // 中身があるとき) も同じ (前は、そのブロックを 1 段に積んで、段組がページの下へはみ出した)
      if ((bal.raised || roomH !== undefined) && roomH !== undefined && bal.limit > roomH + EPS) bal = this.memoMeasure('colbal', node.children, st, [...balKey, roomH], this.foot, () => balanced(roomH));
      limit = bal.limit;
      // 分けない指定を守って段を高くした: 置く場所に入るかを、置く前に確かめる (layoutBlockContainer)
      if (bal.raised) this.columnRaised = true;
    }
    const { roots, used } = run(limit, true);
    if (roots.length > n) this.host.warn(withSource(diag('layout/column-overflow', msg(`段組のコンテナに内容が収まりません (${n} 段)`, `the content does not fit in the multi-column container (${n} columns)`), { columns: n }), node));
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
        addMarkers: (list) => pushAll(this.markerSink, list),
        noteId: () => {},
        columnEnd: (u) => (used = Math.max(used, u)),
        columnIndex: () => 0,
        nextPage: () => ({ root: newNode('block', wm, { isize: innerI }), limit: 1e7, rootI: innerI }),
      },
      abs: this.abs,
      pageSize: this.pageSize,
      footnotes: this.foot,
      holdFootnotes: true,
      // XSL-FO の段組のコンテナの span="all" のブロックは、段の組とは別の参照領域に入る (region-body の span-reference-area と同じ: XSL 1.1
      // §6.4.14)。領域の頭と終わりの conditionality="discard" の余白は捨て、retain の余白は残す (§4.3.1)
      ...(this.host.xslSpace ? { discardLeading: true, areaEnd: true } : {}),
    });
    flow.layoutChildren([withRef(child, { ...child, span: undefined })], st);
    flow.finishPaginated();
    root.bsize = used;
    return { node: root, used };
  }

  /** ページ分割フローの終了: 開いている Frame を閉じる */
  finishPaginated() {
    while (this.stack.length) this.closeFrame();
    this.commitMarkers();
    // 最後に残った脚注 (長い脚注の続き) のために、必要なら脚注だけのページを足す (進まなくなったら止める。ContinuationGuard)
    const guard = new ContinuationGuard();
    while (this.carry.length || this.deferredFloats.length) {
      if (!guard.next(this.host, this.carry, this.deferredFloats.length)) break;
      // 送る float があれば、そのページは脚注だけのページではない
      this.footnoteOnlyPage = !this.deferredFloats.length;
      this.breakPage();
    }
    this.footnoteOnlyPage = false;
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
   * 次に 1 つの箱に組む段組 (layoutBoxColumns) の、釣り合わせた段の高さの上限 (ページの残りの高さ)。ページをまたぐ段組 (layoutColumnsPaged) が、
   * 段の 1 行がページの残りに収まると見て 1 つの箱に任せるときに置く。layoutBoxColumns が読んで消す
   */
  private balanceCap?: number;
  /**
   * 次に 1 つの箱に組む段組 (layoutBoxColumns) の、段が取れるいちばん高い高さ (置く場所の残り)。分けずに釣り合わせた箱が置く場所に
   * 入らなかったときに layoutBlockContainer が置き、span の後ろの段の組には layoutBoxColumns が置く。layoutBoxColumns が読んで消す
   * (分けない指定のブロックが、どの段にも入らないかを決める)
   */
  private columnRoom?: number;
  /**
   * 次に buildContainer で組む、段組でない箱の中の流れの、block 方向に使える長さ (FlowInit.blockRoom。ページを持たない流れの残り)。
   * layoutBlockContainer が置き、buildContainer が読んで消す
   */
  private innerBlockRoom?: number;

  /** 次に組む段組のコンテナを、釣り合わせずに順に埋めるか (layoutColumnSegments が置き、layoutColumnsPaged が読んで消す) */
  private columnFillNext = false;
  /** 次に 1 つの箱に組む段組 (layoutBoxColumns) の、順に埋める段の高さ (釣り合わせない。layoutColumnsPaged が置き、layoutBoxColumns が読んで消す) */
  private columnFillLimit?: number;

  /**
   * 次に 1 つの箱に組む段組 (layoutBoxColumns) が、分けない指定のブロックを分けないために段を高くしたか (balanced の raised)。
   * layoutBlockContainer が、組む前に消し、組んだ後に読む (置く場所に入らなければ、入る高さで組み直す)
   */
  private columnRaised = false;

  /**
   * 段組の段が取れる高さの上限 (置く場所の残りが分からないとき。layoutBoxColumns の roomH)。ページ (段) を持つ流れは、その高さ。
   * 持たない流れ (絶対配置の箱・float の中など。測るだけの流れ) は、版面の block の向きの大きさ (それより高い段は、版面に入らない)
   */
  private columnRoomBound(wm: WritingMode): number | undefined {
    if (this.paginating) return Math.max(this.limit, 0);
    const body = this.pageSize().body;
    return body ? (wm === 'horizontal-tb' ? body.height : body.width) : undefined;
  }

  /**
   * 箱を、いまの流れの位置に placeBox (同じ余白) で置いたときに、いまのページ (段) の残りからはみ出す長さ (置く前に知る。保留の余白は
   * 元に戻す)。数え方は placeBox が置くときと同じ: 前の余白は置くときに空ける長さ (flushValue: 領域の頭で捨てる余白は数えない。
   * XSL 1.1 §4.3.1)。箱の中の行の脚注も、同じページに置くので数える (heldFootCost。placeBox の改ページの判定と同じ)
   */
  private placeOverflow(node: LNode, mbs: number, precBs: number | 'force'): number {
    return this.cursor + this.marginBefore(mbs, precBs) + this.extentAlongBlock(node) + this.heldFootCost([node]) - this.room;
  }

  /**
   * ページを持つ流れで、CSS の高さ (height) を決めた祖先の箱の、内容の終わりの位置 (いちばん内側のもの。いまのページの座標)。まだ開いていない
   * (中身を置いていない) 箱は、いまの位置 (保留の余白の後ろ) から始まるとみる。XSL-FO のブロックは中身で伸びるので数えない
   */
  private fixedBlockEnd(): number | undefined {
    if (this.host.xslSpace) return undefined;
    let end: number | undefined;
    for (const f of this.stack) {
      const b = f.desc.bsizeExplicit;
      if (b == null || f.node.cont) continue;
      const e = f.opened ? f.contentStartB + b - (f.usedB ?? 0) : this.cursor + this.pendingValue() + f.desc.bpStart + b;
      end = end === undefined ? e : Math.min(end, e);
    }
    return end;
  }

  /** いまの流れの位置に、前の余白 mbs の箱を置くときに空ける長さ (flushValue。保留の余白は元に戻す。placeOverflow) */
  private marginBefore(mbs: number, precBs: number | 'force'): number {
    const saved = [this.pendPos, this.pendNeg, this.pendAny, this.pendPrec, this.pendForce] as const;
    this.addMargin(mbs, precBs);
    const before = this.flushValue();
    [this.pendPos, this.pendNeg, this.pendAny, this.pendPrec, this.pendForce] = saved;
    return before;
  }

  /**
   * 結果を捨てることのある組みの前に呼ぶ: 組みが外へ残すもの (いまのページの絶対配置の箱の置き場・柱へ渡すマーカー (string-set・
   * fo:marker・索引の点)・警告) の、いまの長さを覚え、警告は取り置く。返す関数に true を渡すと、取り置いた警告を出し (組みの結果を使う)、
   * false を渡すと、覚えた長さまで切り詰めて、警告を捨てる (組み直す)。
   * ほかの跡は残らない: 脚注は箱の中に持ち (holdFootnotes)、置くときに出す (番号は FootnoteCtx が 1 度だけ振る)。id・リンク・しおりは、
   * 置いた箱から集める (noteIds)。ページ番号の参照の記録は、同じ引数で同じ所に覚えるだけ。釣り合わせの覚え (memoMeasure) は、条件ごとの値。
   * 絶対配置の箱の置き場は、組みが箱を置くときに初めて引く (this.abs を包む。組みの中で作る流れも、包んだものを受け取る)。先に引くと、
   * 段の試し組みの流れ (置き場が trialAbs) では、箱を置かなくても「試し組みが箱を置いた」印 (FlowHost.volatile) が立ち、外の釣り合わせの
   * 覚えが効かなくなる (入れ子の段組で、組む回数が段ごとに何倍にもなる)
   */
  private holdEffects(): (keep: boolean | 'move') => void {
    const host = this.host;
    const warned: Diagnostic[] = [];
    const abs = this.abs;
    const absAt = new Map<LNode[], number>();
    this.abs = () => {
      const list = abs();
      if (!absAt.has(list)) absAt.set(list, list.length);
      return list;
    };
    const sinkAt = this.markerSink.length;
    this.host = { ...host, warn: (m) => warned.push(m) };
    return (keep) => {
      this.host = host;
      this.abs = abs;
      // move: 組んだ箱を次のページへ送った。その組みで積んだ絶対配置の箱を、いまのページ (送った先) の並びへ移す
      if (keep === 'move') {
        const to = abs();
        for (const [list, at] of absAt) if (list !== to) pushAll(to, list.splice(at));
      }
      if (keep) for (const m of warned) host.warn(m);
      else {
        for (const [list, at] of absAt) list.length = at;
        this.markerSink.length = sinkAt;
      }
    };
  }

  /** layoutColumnsPaged の「1 つの箱に任せる」戻り: 釣り合わせの上限を置いて false を返す */
  private capBalance(cap: number): false {
    // XSL-FO の段組は、これまでどおり上限を置かない
    if (!this.host.xslSpace) this.balanceCap = cap;
    return false;
  }

  /**
   * 中身に合わせる列 (LTableColumn.fitContent) の幅を、いまの組版でのセルの中身の幅 (max-content。CSS Sizing 3 §5.1) にした表を返す
   * (flex の項目の基本の大きさは、中身の幅: Flexbox 1 §9.2 の 3 の E)。比例の列 ('N*') なら、足す固定の長さ (widthExtra) を測った幅にする。
   * ページ番号の引用の字は、前回の組版の結果 (1 回目は仮の字) で測るので、番号の桁が変われば、次の組版で列の幅も変わる。列をまたぐセルは見ない。
   * 中の、大きさの指定のある箱は、その箱の大きさを数える (maxLineLength の countFixed。CSS Sizing 3 §5.1)。
   * flex の項目の列 (LTableColumn.flexItem) は、上限 (max-width) で止め、列の幅の合計が avail (列に配れる幅) を超えたら縮める (flexShrinkColumns)
   */
  private fitContentColumns(table: LTable, st: ResolvedStyle, avail: number): LTable {
    // 百分率の主軸の大きさの項目 (percentWidth): 組むときの容器の内容の幅 avail で解き、縮める基準の大きさ・自動の最小の大きさの上限
    // (指定の大きさ。Flexbox 1 §4.5) も、その幅にする (読み込みの見積もりの幅で解いた値に代える)
    if (!this.intrinsic && table.columns.some((c) => c.percentWidth)) {
      table = withRef(table, {
        ...table,
        columns: table.columns.map((c) => {
          if (!c.percentWidth) return c;
          const w = Math.max(c.percentWidth.f * avail + c.percentWidth.edge, 0);
          const fix = (f: LFlexItemColumn | undefined) => (f ? { ...f, basis: Math.max(w - f.edge, 0), ...(f.minAuto && !c.percentWidth!.basis ? { minCap: Math.min(f.minCap ?? Infinity, w), floor: Math.min(f.floor, w) } : {}) } : undefined);
          const fi = fix(c.flexItem);
          const fl = fix(c.flexLate);
          // 仮の主軸の大きさは、下限 (min-width か自動の最小の大きさ) で下から抑える (Flexbox 1 §9.2 の 3 の後)
          return { ...c, width: Math.max(w, (fi ?? fl)?.floor ?? 0), ...(fi ? { flexItem: fi } : {}), ...(fl ? { flexLate: fl } : {}) };
        }),
      });
    }
    const rows = [...(table.header?.rows ?? []), ...table.body.rows, ...(table.footer?.rows ?? [])];
    const fit = new Map<number, number>();
    /** 列 → その列のセル (縮める下限の min-content を測るのに使う) */
    const cellOf = new Map<number, { cell: LTableCell; cst: ResolvedStyle }>();
    const widthOf = (cell: LTableCell, cst: ResolvedStyle, min: boolean) => this.cellContentI(cell, cst, min);
    for (const { cell, c: col, cs: span } of placeCells([rows]).placed) {
      if (span !== 1) continue;
      const cst = resolveStyle(st, cell);
      if (table.columns[col]?.flexItem || table.columns[col]?.flexLate) cellOf.set(col, { cell, cst });
      // 画像そのものの項目の、max-width の上限 (外側の幅。百分率は容器の内容の幅 avail で解く: Flexbox 1 §9.2・CSS 2.1 §10.4。下の widths と
      // 同じ値)。セルを組むときに、項目の幅がこの上限に当たっているか (既定の max-width が画像を縮めたか) を見る (layoutCell・FlowInit.itemAtMaxWidth)。
      // min-width・overflow の項目 (replacedMin が無い) も、百分率は avail で解く (capPct。cap は読み込みの見積もりの幅で解いたもので、置き場が
      // 見積もりより狭いと、上限に当たっている項目を、上限より狭い (flex が縮めた) と見誤る)
      const fc = table.columns[col]?.flexItem ?? table.columns[col]?.flexLate;
      const pc = fc?.replacedMin?.maxPct !== undefined ? { f: fc.replacedMin.maxPct, edge: fc.replacedMin.maxEdge ?? 0 } : fc?.capPct;
      const itemCap = pc ? pc.f * avail + pc.edge : fc?.cap;
      if (itemCap !== undefined && !this.intrinsic && itemImageOf(cell)) this.flexItemCaps.set(cell, itemCap);
      // 百分率の主軸の大きさの項目 (percentWidth): 中身の幅を測る組版では、中身の幅の列として測る (CSS Sizing 3 §5.2.1)
      if (!table.columns[col]?.fitContent && !(this.intrinsic && table.columns[col]?.percentWidth)) continue;
      fit.set(col, Math.max(fit.get(col) ?? 0, widthOf(cell, cst, false)));
    }
    // 百分率の主軸の大きさの項目は、組むときの容器の内容の幅 avail で解いた幅 (Flexbox 1 §7.2.3。上で解き直した width)
    const pctW = (c: LTableColumn) => (c.percentWidth && !this.intrinsic && typeof c.width === 'number' ? c.width : undefined);
    // 読み込みの見積もりで縮めた flex の項目の列 (flexLate) だけの行: 実際の置く場所に入りきらなければ縮める
    if (!fit.size && !table.columns.some((c) => c.flexLate || c.percentWidth)) return table;
    const isStar = (c: LTableColumn) => typeof c.width === 'string';
    /** 列の外側の幅 (比例の列は、足す固定の長さ)。base0 は、測る・抑える前の幅 */
    const base0 = table.columns.map((c, k) => fit.get(k) ?? pctW(c) ?? (isStar(c) ? (c.widthExtra ?? 0) : typeof c.width === 'number' ? c.width : 0));
    const widths = table.columns.map((c, k) => {
      const w = fit.get(k) ?? pctW(c) ?? (isStar(c) ? (c.widthExtra ?? 0) : typeof c.width === 'number' ? c.width : 0);
      // 仮の主軸の大きさは、上限 (max-width) と、指定の下限 (min-width) で止める (Flexbox 1 §9.2 の 3 の後・§9.7)
      const f = c.flexItem;
      // 画像そのものの項目の百分率の max-width は、容器の内容の幅 avail で解く (読み込みの見積もりの幅で解いた cap ではない。Flexbox 1 §9.2・
      // CSS 2.1 §10.4)。中身の幅を測る組版では、循環する百分率の上限は none (CSS Sizing 3 §5.2.1・§5.2.2)
      const rm = f?.replacedMin;
      const cap = rm?.maxPct !== undefined ? (this.intrinsic ? Infinity : rm.maxPct * avail + (rm.maxEdge ?? 0)) : f?.cap;
      if (f && fit.has(k)) return Math.max(Math.min(w, cap ?? Infinity), f.minAuto ? 0 : f.floor);
      // 画像そのものの項目で、幅の決まった列 (flex-basis か width): 仮の主軸の大きさは、その幅を、自動の最小の大きさ (置換要素の本来の幅か
      // 指定の幅を max-width で抑えたもの) で下から抑えたもの (Flexbox 1 §9.2 の 3 の E・§4.5)。flex: 0 0 30% の画像を、本来の幅より狭くしない
      const rf = f ?? c.flexLate;
      const at = cellOf.get(k);
      if (rf?.replacedMin && !isStar(c) && at) return Math.max(w, replacedMinWidth(rf.replacedMin, widthOf(at.cell, at.cst, false), this.intrinsic ? 0 : avail));
      return w;
    });
    // 画像そのものの、伸びる項目 (flex-grow のある比例の列。flex: 1 の basis 0 など) の自動の最小の大きさ (Flexbox 1 §4.5): 余りを伸ばす比で
    // 分けた幅 (足す固定の長さ + 分け前) が、自動の最小の大きさより狭ければ、その項目は自動の最小の大きさで止めて (§9.7 の 4 の c・d の凍結)、
    // 残りの余りを、ほかの比例の列で分け直す。止めた列は固定の幅の列にして、入りきらなければ、ほかの項目を縮める (flexShrinkColumns。
    // 止めた項目は基準の大きさが 0 なので縮まない)。中身の幅を測る組版では当てない (測る組版の比例の列は、項目の中身の幅で測る)
    const frozenStar = new Set<number>();
    if (!this.intrinsic) {
      const mins = new Map<number, number>();
      table.columns.forEach((c, k) => {
        const rm = (c.flexItem ?? c.flexLate)?.replacedMin;
        const at = cellOf.get(k);
        // 止める幅は、項目の外側の幅 (画像の中身の大きさ + 項目の余白・枠)。項目を包むブロックと、その中の画像の両方が、項目の余白・枠を
        // 持つ (読み込みの flex の項目) ので、セルの中身の幅 (widthOf) は、余白・枠を 2 度数える。画像の分を引く (引かないと、止めた列が
        // 余白・枠の分だけ広く、画像は、その列の幅 (imageFillsItem の 100%) で描かれて、中身が余白・枠の分だけ大きくなる)
        if (rm && isStar(c) && at) mins.set(k, replacedMinWidth(rm, widthOf(at.cell, at.cst, false) - itemImageEdges(at.cell, at.cst.wm), avail));
      });
      for (let pass = 0; pass <= mins.size && mins.size; pass++) {
        const starOf = (k: number) => (isStar(table.columns[k]) && !frozenStar.has(k) ? parseFloat(table.columns[k].width as string) || 0 : 0);
        const sumStar = table.columns.reduce((a, _c, k) => a + starOf(k), 0);
        const free = avail - widths.reduce((a, w) => a + w, 0);
        const hit = [...mins].filter(([k, m]) => !frozenStar.has(k) && widths[k] + (sumStar > 0 ? (Math.max(free, 0) * starOf(k)) / sumStar : 0) < m - EPS);
        if (!hit.length) break;
        for (const [k, m] of hit) {
          frozenStar.add(k);
          widths[k] = m;
        }
      }
    }
    const shrunk = this.flexShrinkColumns(table.columns, widths, avail, fit, (k, max) => {
      const c = cellOf.get(k);
      return c ? widthOf(c.cell, c.cst, !max) : undefined;
    });
    return withRef(table, {
      ...table,
      columns: table.columns.map((c, k) => {
        if (!fit.has(k) && shrunk[k] === base0[k]) return c;
        if (frozenStar.has(k)) {
          const { widthExtra: _x, ...rest } = c;
          return { ...rest, width: shrunk[k] };
        }
        return isStar(c) ? { ...c, widthExtra: shrunk[k] } : { ...c, width: shrunk[k] };
      }),
    });
  }

  /**
   * セルの中身の幅 (外側。min なら min-content、でなければ max-content。CSS Sizing 3 §5.1)。0.01pt に切り上げ、0.01pt の余裕を足す。
   * 中の、大きさの指定のある箱は、その箱の大きさを数える (maxLineLength の countFixed)
   */
  private cellContentI(cell: LTableCell, cst: ResolvedStyle, min: boolean): number {
    const rootI = min ? 1 : MAX_CONTENT_ROOT;
    const w = this.memoMeasure('iwx', cell.children, cst, [rootI, min], undefined, () => maxLineLength(this.measureSub(cell.children, cst, rootI, { intrinsic: true, ...(min ? { minContent: true } : {}) }).sub.root, true, false, true, !min));
    return Math.ceil(w * 100) / 100 + 0.01 + describeBox(cell, cst.wm).bpI;
  }

  /**
   * flex の 1 行の表の、項目の列 (LTableColumn.flexItem) を縮める (Flexbox 1 §9.7 の flexible lengths の解決のうち、縮める側)。
   * widths は列の外側の幅 (比例の列は足す固定の長さ) で、合計が avail を超えたら、はみ出した分を、flex-shrink × flex の基準の大きさの比で分けて引く。
   * 下限 (min-width。auto なら組むときに測った中身の最も狭い幅 minContentOf) に当たった項目はそこで止め (凍結)、残りをほかの項目で分ける。
   * fit: 組むときに幅を測った列 (flex の基準の大きさは、測った幅から内容の幅以外の分を引いたもの)
   */
  private flexShrinkColumns(cols: readonly LTableColumn[], widths: readonly number[], avail: number, fit: Map<number, number>, minContentOf: (k: number, max?: boolean) => number | undefined): number[] {
    const out = widths.slice();
    let over = out.reduce((a, b) => a + b, 0) - avail;
    /** 縮める項目の列: 番号と、縮める値 */
    const items: Array<{ k: number; f: LFlexItemColumn }> = [];
    cols.forEach((c, k) => {
      const f = c.flexItem ?? c.flexLate;
      if (f) items.push({ k, f });
    });
    if (over <= EPS || !items.length) return out;
    const floors = new Map<number, number>();
    const floorOf = (k: number, f: LFlexItemColumn) => {
      let v = floors.get(k);
      if (v === undefined) {
        const m = f.minAuto ? minContentOf(k) : undefined;
        // 画像そのものの項目 (Flexbox 1 §4.5): 置換要素の min-content の大きさ (指定の幅か本来の幅。セルの max-content で測る) を、指定の幅・
        // max-width で抑える。max-width の百分率の基準は容器の内容の幅 avail (中身の幅を測る組版では 0: CSS Sizing 3 §5.2.2)
        const rm = f.replacedMin;
        const own = rm ? minContentOf(k, true) : undefined;
        v =
          rm && own !== undefined
            ? replacedMinWidth(rm, own, this.intrinsic ? 0 : avail)
            : m !== undefined
              ? Math.min(m, f.minCap ?? Infinity)
              : f.floor;
        floors.set(k, v);
      }
      return v;
    };
    const base = (k: number, f: LFlexItemColumn) => (fit.has(k) ? Math.max((widths[k] ?? 0) - f.edge, 0) : f.basis);
    const frozen = new Set<number>();
    for (let pass = 0; pass <= items.length && over > EPS; pass++) {
      const act = items.filter(({ k, f }) => !frozen.has(k) && f.shrink > 0 && base(k, f) > 0 && (out[k] ?? 0) > floorOf(k, f));
      const sum = act.reduce((a, { k, f }) => a + f.shrink * base(k, f), 0);
      if (!sum) break;
      let taken = 0;
      for (const { k, f } of act) {
        const cur = out[k] ?? 0;
        const want = cur - (over * f.shrink * base(k, f)) / sum;
        const nw = Math.max(want, floorOf(k, f));
        if (want < floorOf(k, f)) frozen.add(k);
        taken += cur - nw;
        out[k] = nw;
      }
      over -= taken;
    }
    return out;
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
      // 中の、大きさの指定のある箱は、その箱の外側の大きさを数える (CSS Sizing 3 §5.1。maxLineLength の countFixed。cellContentI と同じ)
      const min = rootI <= 1;
      const r = Math.max(rootI, 1);
      const w =
        Math.ceil(this.memoMeasure('iwx', cell.children, cst, [r, min], undefined, () => maxLineLength(this.measureSub(cell.children, cst, r, { intrinsic: true, ...(min ? { minContent: true } : {}) }).sub.root, true, false, true, !min)) * 100) / 100 + 0.01;
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
      const wt = weights.map((w) => w ?? 0);
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
      // (またぐ列の分だけを写す。列の全体を写すと、列をまたぐセルの数 × 列の数の手間になる: colspan="1000" のセルが 50 行 × 50 個で 1.2 億回)
      const weights = maxW.slice(col, col + span);
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
    // (最小の幅の合計は 1 度だけ足す。列ごとに足し直すと列の数の 2 乗: colspan="1000" のセルの並ぶ表は列が数万本になる)
    const sumMn = sum(mn);
    if (sumMn >= avail) return sumMn > 0 && !this.gridItemMin ? mn.map((w) => (w * avail) / sumMn) : mn;
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
   * grid の項目のセルの min-content (外側。cellContentI の min と同じ測り方)。ただし、中に直に置く自動レイアウトの表は、列の最小の幅の和
   * で、分綴の位置でも分ける (FlowInit.gridItemMin)
   */
  private gridItemMinContent(cell: LTableCell, cst: ResolvedStyle): number {
    const w = this.memoMeasure('gridmin', cell.children, cst, [], undefined, () => maxLineLength(this.measureSub(cell.children, cst, 1, { intrinsic: true, minContent: true, gridItemMin: true }).sub.root, true, false, true));
    return Math.ceil(w * 100) / 100 + 0.01 + describeBox(cell, cst.wm).bpI;
  }

  /**
   * grid の列ごとの下限 (LTable.gridTemplate.items): 1 列だけを占める項目の、自動の最小の大きさ (CSS Grid 1 §6.6) の、列ごとの最大
   * (§12.5「Size tracks to fit non-spanning items」: 最小の大きさが auto の列の基準の大きさは、項目の最小の寄与の最大)。
   * 項目の中身は、組むときと同じ折り返し (ハイフン・ZWSP・word-break など) で、min-content を測る (cellContentI。百分率の幅は auto:
   * CSS Sizing 3 §5.2.1、縮められる置換要素は 0: §5.2.2、入れ子の grid・flex・表は、それぞれの中身の幅)。min-width の長さ・決まった width・
   * overflow が visible でない項目は、読み込みが決めた値 (GridItemFloor.floor)。max-width の長さで抑える (§6.6 の終わり)。
   * 中身から測る下限 (auto: 中身による最小の大きさ。minmax(auto, <長さ>) の最大の大きさで抑える: gridTrackPlan) と、書いた大きさからの下限
   * (min: GridItemFloor.floor。§12.5 の minimum contribution で、最大の大きさで抑えない: GridTrackOptions.minOf) を、列ごとに分けて持つ。
   * 下限は grid 全体で 1 つ (どの行の表でも、同じ列は同じ幅) なので、全部の行の項目を、最初に組む行の表で 1 度だけ測る
   * (覚えは memoMeasure: 組版の回ごとに作り直し、中のページ番号の参照が変われば測り直す)。項目は行の表の外の値として持つので、
   * 中身の幅を測る組版でも組む組版でも、同じ値になる
   */
  private gridFloors(g: NonNullable<LTable['gridTemplate']>, st: ResolvedStyle): GridFloors | undefined {
    const items = g.items;
    if (!items?.length) return undefined;
    return this.memoMeasure('gridfloor', g, st, [], undefined, () => {
      const out: GridFloors = { auto: [], min: [] };
      for (const it of items) {
        const into = it.floor !== undefined ? out.min : out.auto;
        const v = it.floor ?? Math.min(this.gridItemMinContent(it.cell, resolveStyle(st, it.cell)), it.cap ?? Infinity);
        if (v > (into[it.col] ?? 0)) into[it.col] = v;
      }
      return out;
    });
  }

  /**
   * grid の max-content の、fr の 1 つ分と、列ごとの項目の max-content (中身の幅を測る組版で、幅が決まらないとき。LTable.gridTemplate.items):
   * fr の 1 つ分は、fr・auto の列 (上限の無い、比が正の列) の項目の max-content の寄与を、列の比で割ったものの、grid の全部の行の項目での最大
   * (CSS Grid 1 §12.7.1「Find the Size of an fr」: max-content の大きさでは、grid の全部の項目から決める。行の表ごとに、その行の項目だけで
   * 決めると、欠けた最後の行の長い項目の fr を 1 列分しか数えず、縮む容器の中の grid が狭くなる)。need は、列ごとの項目の max-content の最大
   * (百分率の列を auto として数えるとき・行に無い列を数えるときに使う)。grid ごとに 1 度だけ測る (memoMeasure)
   */
  private gridMaxContent(g: NonNullable<LTable['gridTemplate']>, st: ResolvedStyle, plan: GridTrackPlan): { fr: number; need: number[] } | undefined {
    const items = g.items;
    if (!items?.length) return undefined;
    return this.memoMeasure('gridmax', g, st, [], undefined, () => {
      const need: number[] = [];
      let fr = 0;
      for (const it of items) {
        const v = this.cellContentI(it.cell, resolveStyle(st, it.cell), false);
        if (v > (need[it.col] ?? 0)) need[it.col] = v;
        const t = it.col;
        if (plan.fixed[t] === undefined && !Number.isFinite(plan.c[t]) && plan.w[t] > 0) fr = Math.max(fr, v / plan.w[t]);
      }
      return { fr, need };
    });
  }

  /**
   * grid の 1 行の表 (LTable.gridTemplate) の列: 表を置くときの内容の幅 W (容器の実際の内容の幅) で gridTracks を呼び、項目の列の幅を、
   * その占める grid の列の幅と、間の間隔の和にする (CSS Grid 1 §11・§12。百分率の列は W × 比 (§7.2.1)、fr の列は W の余りを分け、
   * minmax() の最小・最大の大きさの間。間隔の百分率も W で解く: CSS Box Alignment 3 §8.1)。容器の幅が読み込みの見積もりと同じなら、
   * 読み込みで見た列の幅と同じ。
   * 中身の幅を測る組版で、幅が決まらないとき (百分率の基準が無いとき) は、長さの列はその幅、百分率の列は auto (中身に合わせる列:
   * fitContent。§7.2.1・CSS Sizing 3 §5.2.1)、余りを分ける列は比例の列 (置く場所の余りを取る) にして、中身の幅を数えるための値 (measure) を返す
   */
  private gridLineColumns(node: LTable, desc: BoxDesc, st: ResolvedStyle): { columns: LTableColumn[]; measure?: GridColumnMeasure[]; grid?: GridLineMeasure } {
    const g = node.gridTemplate!;
    const measuring = this.intrinsic && this.percentBase() === undefined;
    const W = measuring ? 0 : (desc.isizeExplicit ?? Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI, 0));
    const gap = g.gapPct !== undefined ? g.gapPct * W : g.gap;
    const fl = this.gridFloors(g, st);
    const floors = fl ? (k: number) => fl.auto[k] ?? 0 : undefined;
    const minOf = fl ? (k: number) => fl.min[k] ?? 0 : undefined;
    if (!measuring) {
      // 同じ grid の容器の行の表は、同じ値 (gridTemplate) を持つ。同じ幅・同じ下限なら、列の幅を 1 度だけ求める
      let hit = gridTrackCache.get(g);
      if (!hit || hit.W !== W || hit.floors !== fl) {
        hit = { W, floors: fl, tracks: gridTracks(g.tracks, W, gap, floors, { times: g.repeat }, { minOf }), spans: new Map() };
        gridTrackCache.set(g, hit);
      }
      const { tracks, spans } = hit;
      return {
        columns: node.columns.map((c): LTableColumn => {
          if (c.gridGap) return { ...c, width: gap };
          if (!c.gridSpan) return c;
          const [from, to] = c.gridSpan;
          // 項目の占める列の幅の和は、grid の列の幅と範囲だけで決まるので、範囲ごとに 1 度だけ足す (行の表ごとに足し直すと、
          // 行の数 × 占める列の数の手間になる。足す順は同じ)
          const key = `${from},${to}`;
          let w = spans.get(key);
          if (w === undefined) {
            w = gap * Math.max(to - from - 1, 0);
            for (let k = from; k < to; k++) w += tracks[k] ?? 0;
            spans.set(key, w);
          }
          return { ...c, width: Math.max(w, 0) };
        }),
      };
    }
    // 中身の幅を測る組版での列の決まり方も、grid ごとに 1 度だけ求める (行の表ごとに求め直すと、行の数 × grid の列の数の手間になる)
    let mhit = gridMeasureCache.get(g);
    if (!mhit || mhit.gap !== gap || mhit.floors !== fl) {
      mhit = { gap, floors: fl, plan: gridTrackPlan(g.tracks, 0, gap, floors, { times: g.repeat }, { minOf, indefinite: true }), spans: new Map() };
      gridMeasureCache.set(g, mhit);
    }
    const { plan, spans } = mhit;
    const measure: GridColumnMeasure[] = [];
    const columns = node.columns.map((c, k): LTableColumn => {
      if (c.gridGap) {
        measure[k] = { fixed: gap };
        return { ...c, width: gap };
      }
      if (!c.gridSpan) {
        // 行の終わりの空きの列 (右から左への行の、伸びる列の無い行の空き): 中身の幅に数えない
        measure[k] = { fixed: 0, filler: true };
        return c;
      }
      const [from, to] = c.gridSpan;
      if (plan && to - from === 1 && plan.pct[from]) {
        measure[k] = { fixed: 0 };
        return { type: 'table-column', width: 0, fitContent: true };
      }
      // 範囲 [from, to) の列の決まった幅と比・下限・上限の和は、計画と範囲だけで決まるので、範囲ごとに 1 度だけ足す (足す順は同じ)
      const key = `${from},${to}`;
      let sum = spans.get(key);
      if (!sum) {
        let fixed = gap * Math.max(to - from - 1, 0);
        let share: GridColumnMeasure['share'];
        for (let t = from; t < to; t++) {
          // 列の指定が無い (none・無効な並び) なら、1 列 (1fr と同じく、中身の幅)
          const f = plan ? plan.fixed[t] : undefined;
          if (f !== undefined && !plan!.pct[t]) fixed += f;
          else {
            const w = plan && f === undefined ? plan.w[t] : 1;
            const b = plan && f === undefined ? plan.b[t] : 0;
            const c = plan && f === undefined ? plan.c[t] : Infinity;
            const capped = Number.isFinite(c);
            // 比 0 の列 (minmax(a, 0fr)) は、最小の大きさの決まった幅
            if (!capped && w <= 0) fixed += b;
            else {
              share ??= { w: 0, b: 0, cap: 0, flex: false };
              share.b += b;
              if (capped) share.cap += c;
              else {
                share.w += w;
                share.flex = true;
              }
            }
          }
        }
        sum = { fixed, share };
        spans.set(key, sum);
      }
      const fixed = sum.fixed;
      const share = sum.share && { ...sum.share };
      measure[k] = { fixed, ...(share ? { share } : {}) };
      // 余りを分ける列は、下限 (基準の大きさ: 項目の自動の最小の大きさか、minmax() の最小の大きさ) を足す固定の長さに含める
      // (min-content を測るときは、置く場所の幅が 0 なので、列は下限の幅になる: CSS Grid 1 §12.7.1。表の幅も、下限の和より狭くならない。
      // 表の中身の幅 (flexContentI) は、表の幅を上限として数えるので、含めないと、入れ子の grid の min-content が 0 になる)
      const extra = fixed + (share?.b ?? 0);
      return share ? { ...c, width: `${share.w || 1}*`, ...(extra ? { widthExtra: extra } : {}) } : { ...c, width: fixed };
    });
    // 行の表の項目が占める grid の列 (百分率の列は、上で列を作り直すので、元の列の範囲から数える)
    // (列ごとの集まりにせず、範囲を始まりの順に並べて、重なり・隣り合うものをつなぐ。列の数に比例する手間を、行の表ごとに掛けない)
    const spansOf = node.columns.flatMap((c) => (c.gridSpan && c.gridSpan[1] > c.gridSpan[0] ? [c.gridSpan] : [])).sort((x, y) => x[0] - y[0]);
    const covered: Array<[number, number]> = [];
    for (const [from, to] of spansOf) {
      const last = covered[covered.length - 1];
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else covered.push([from, to]);
    }
    return { columns, measure, ...(plan ? { grid: { plan, gap, covered, ...(fl ? { floors: fl } : {}) } } : {}) };
  }

  /**
   * 表の列の幅の決定 (layoutTable の前半)。自動レイアウト (fitContent: 中身に合わせる / fillContent: 幅の指定に満たない分を配る) の
   * 列の幅を measureColumns で求めて node.columns に入れ、表の幅 (desc.isizeExplicit) と、auto の余白・寄せ (table-and-caption の text-align)
   * による始端の余白を desc に入れる。固定レイアウトの表はそのまま。out は collapse の外枠の罫線の外へ出る半分、gaps はセルの間隔の合計
   */
  private tableColumnWidths(node: LTable, desc: BoxDesc, st: ResolvedStyle, ps: ResolvedStyle, out: { is: number; ie: number }, gaps: number): { node: LTable; desc: BoxDesc; autoFree?: number; autoRtl?: true } {
    /** auto の余白で寄せる前の残り (Frame.autoM) と、残りが負なら margin-left が取るか (rtl) */
    let autoFree: number | undefined;
    let autoRtl: true | undefined;
    // 見出しの最小の幅 (CAPMIN): 自動レイアウトの表の幅は、これより狭くしない (CSS 2.1 §17.5.2.2)。表の罫線・padding の内側の幅に直す
    const capMin = () => {
      let w = 0;
      for (const c of node.captions ?? []) {
        const cst = resolveStyle(st, c.block);
        const d = describeBox(c.block, cst.wm);
        // 見出しの min-content (CSS 2.1 §17.5.2.2 の CAPMIN)。min-content を測る印を付けて測る (中のリストは、本文の min-content を数える)
        w = Math.max(w, Math.ceil(this.intrinsicWidth(c.block.children, cst, 1, !this.host.xslSpace) * 100) / 100 + d.bpI + d.m.is + d.m.ie);
      }
      return Math.max(w - desc.bpI, 0);
    };
    /** 列の幅の合計を tot 以上にする (足りない分は列の幅の比で、幅が 0 なら等しく配る) */
    const widen = (widths: number[], tot: number) => {
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum >= tot || !widths.length) return widths;
      return sum > 0 ? widths.map((w) => (w * tot) / sum) : widths.map(() => tot / widths.length);
    };
    const explicitI = desc.isizeExplicit != null;
    if (node.fitContent && desc.isizeExplicit == null) {
      // セルの百分率の padding: 幅の決まらない表では、列の幅を測るときは百分率の部分を 0 とし (CSS Sizing 3 §5.2.1: 循環する百分率)、
      // 表の幅が決まってから、その幅で解く (Chrome と同じ。表の幅は広げない)。読み込みの見積もり (包含ブロックの幅) では解かない
      const pctCells = cellPercentPadding(node, 0);
      if (pctCells) node = pctCells;
      // 列の幅を中身の長さに合わせ、表の幅はその合計にする
      let widths = this.measureColumns(node, st, Math.max(this.contentI() - desc.m.is - desc.m.ie - desc.bpI - gaps, 0));
      if (node.captions?.length) widths = widen(widths, capMin() - gaps);
      node = withRef(node, { ...node, columns: widths.map((w) => ({ type: 'table-column' as const, width: w })) });
      desc = { ...desc, isizeExplicit: widths.reduce((a, b) => a + b, 0) + gaps };
      if (pctCells) node = cellPercentPadding(node, desc.isizeExplicit!)!;
      // 余白が auto なら、残りをその余白に配る (CSS 2.1 §10.3.3)。'start' は margin-left が auto (rtl でも物理の左右で決まる)
      // 中身の幅の計測 (intrinsic) では、auto の余白は 0 (layoutBlock と同じ。測る行の長さの残りを配ると、その余白が中身の幅に入る)
      if (node.autoMargins && !this.intrinsic) {
        // collapse の表が持つ外枠の罫線は、半分が余白の側へ出る (後で余白から引く)。表の箱 (罫線の中心の線まで) を寄せる。
        // アンテナハウス互換 (collapseSpillAh) では、外へ出る半分も表の内側に置くので、罫線の外側までを寄せる
        const spill = node.borderCollapse === 'collapse' && !node.collapseSpillAh ? (desc.bw.is ? out.is : 0) + (desc.bw.ie ? out.ie : 0) : 0;
        const free = this.contentI() - desc.m.is - desc.m.ie - desc.bpI - desc.isizeExplicit! + spill;
        const am = node.autoMargins;
        autoFree = free;
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
      node = withRef(node, { ...node, columns: fill.map((w) => ({ type: 'table-column' as const, width: w })) });
    }
    // 幅の決まった表 (幅の指定のある表。自動の配置 (fillContent) も固定の配置も) の auto の余白 (CSS 2.1 §10.3.3・§17.4: 表の箱を包む
    // table wrapper box の幅は表の箱の幅で、その余白が auto なら、置く場所の残りを配る)。'start' は margin-left (縦書きは margin-top) が auto。
    // 幅の指定は、collapse の表では外枠の罫線の中心から中心まで (§17.6.2。layoutTable の explicitI) で、外へ出る半分は余白の側にあるので、
    // 寄せるのは指定の幅の箱 (外へ出る半分を除いた幅)。アンテナハウス互換 (collapseSpillAh) では、外へ出る半分も表の内側に置くので、
    // 罫線の外側までを寄せる。中身の幅の計測 (intrinsic) では 0 (layoutBlock と同じ)
    if (node.autoMargins && explicitI && !this.intrinsic) {
      const spill = node.borderCollapse === 'collapse' && !node.collapseSpillAh ? out.is + out.ie : 0;
      const free = this.contentI() - desc.m.is - desc.m.ie - desc.bpI - desc.isizeExplicit! + spill;
      const am = node.autoMargins;
      autoFree = free;
      if (free > EPS) desc = { ...desc, m: { ...desc.m, is: desc.m.is + (am === 'center' ? free / 2 : am === 'start' ? free : 0) } };
      // 置く場所より広い表は、rtl なら margin-left が残りを取り、左へはみ出す (layoutBlock の autoMargins と同じ)。続きのページで寄せ直すときも
      // 同じ決まり (Frame.autoM の rtl)
      else if (free < -EPS && ps.direction === 'rtl' && this.wm === 'horizontal-tb' && !this.host.xslSpace) desc = { ...desc, m: { ...desc.m, is: desc.m.is + free } };
      if (ps.direction === 'rtl' && this.wm === 'horizontal-tb' && !this.host.xslSpace) autoRtl = true;
    }
    // 寄せ (table-and-caption の text-align): 表の幅 (指定、または固定の列の幅の合計) が置く場所より狭ければ、start 側の余白に空きを足す
    const align = node.alignByTextAlign ? (ps.textAlign === 'center' ? 'center' : ps.textAlign === 'end' ? 'end' : undefined) : undefined;
    if (align) {
      const colSum = node.columns.length && node.columns.every((c) => typeof c.width === 'number') ? node.columns.reduce((a, c) => a + (c.width as number), 0) : undefined;
      // 罫線をつぶした表の列の幅は、グリッド線 (罫線の中心) の間の幅 (CSS 2.1 §17.6.2。columnSizes の offsets)。列の幅の和は、
      // 幅を書いた表の width と同じく外周の罫線の中心から中心までの幅なので、中身の幅 (表の罫線の内側) は、それに外へ出る半分を足し、
      // 表が持つ外周の罫線の太さを引いたもの (layoutTable の explicitI の式と同じ)。ただし表が罫線を持たない辺の外へ出る半分は、
      // 後で layoutTable が中身に合わせた幅に足すので、ここでは表が罫線を持つ辺の分だけ直す (足さないと、最後の列と
      // 表の罫線の間に、表の罫線の太さだけ隙間ができていた)
      const fixed =
        colSum !== undefined && node.borderCollapse === 'collapse' ? colSum + (desc.bw.is ? out.is - desc.bw.is : 0) + (desc.bw.ie ? out.ie - desc.bw.ie : 0) : colSum;
      const w = desc.isizeExplicit ?? fixed;
      // 罫線をつぶした表 (アンテナハウス互換の collapseSpillAh でないもの) で寄せるのは、外周のグリッド線 (罫線の中心) の間の箱。
      // 表の箱の幅 (bpI + w) は、表が罫線を持つ辺では、外へ出る罫線の半分 (out) を除いた幅なので、その分を空きに戻す
      // (幅を書いた表は、幅がグリッド線の間なので両辺とも。auto の余白で寄せる表 (上の autoMargins) と同じ箱。CSS 2.1 §17.6.2:
      // 表の幅は外周の罫線の半分までを含み、残りの半分は余白の側に出る)。前は戻していなかったので、表が外へ出る罫線の半分だけ start の側にずれた
      const spill =
        node.borderCollapse !== 'collapse' || node.collapseSpillAh ? 0 : desc.isizeExplicit != null ? out.is + out.ie : (desc.bw.is ? out.is : 0) + (desc.bw.ie ? out.ie : 0);
      const free = w == null ? 0 : this.contentI() - desc.m.is - desc.m.ie - desc.bpI - w + spill;
      if (w != null && free > EPS) desc = { ...desc, isizeExplicit: w, m: { ...desc.m, is: desc.m.is + (align === 'center' ? free / 2 : free) } };
    }
    return { node, desc, autoFree, ...(autoRtl ? { autoRtl } : {}) };
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
      this.layoutBlock(withRef(c.block, { ...c.block, margin: toPhysicalEdges(lm, this.wm) }), st);
    });
  }

  /**
   * 表の本体の行の配置 (layoutTable の後半のループ)。rowSpan で結びついた行は 1 つの塊 (グループ) として置き、keep-with-next /
   * keep-with-previous でつながった塊はまとめて置く。1 ページに入らない塊は rowSpan を分け (unspanRows)、入らない 1 行はセルの中身を
   * 行単位で分けてページをまたぐ。改ページのたびに placeHeader (繰り返す見出し) と placeFooterAtBreak (ページ末尾のフッター) を呼び、
   * reserve はフッターのために空けておく高さ
   */
  /**
   * step は続きの位置の記録の段 (表の段。fo:retrieve-table-marker の無い表だけ)。行の塊を置く所ごとに、どこで置いているか (TableRows.site) と、
   * 置いた後に続ける値を書く。resuming なら、記録の所の改ページの後から組む (置いていた塊の残りを置き、その所の後から続ける)
   */
  private layoutTableRows(node: LTable, st: ResolvedStyle, sizes: number[], headerRows: LNode[], reserve: number, placeHeader: (repeated: boolean) => void, placeFooterAtBreak: (() => void) | undefined, tm?: TableMarkerHooks, step?: TableStep, resuming = false) {
    // rowSpan で結びついた行は 1 つの塊 (グループ) として配置する
    let rows = node.body.rows;
    const bst = resolveStyle(st, node.body);
    const rec = tm ? undefined : step;
    const placeOpts = (forceNewPage: boolean | BreakKind) => ({ reserve, beforeBreak: placeFooterAtBreak, forceNewPage });
    const place = tm ? tm.place : (grp: LNode[], forceNewPage: boolean | BreakKind = false) => this.placeRows(grp, false, () => placeHeader(true), placeOpts(forceNewPage), rec);
    /** 行の塊を置く所の記録 (続きから組むとき、その所の後から続ける)。site が '' の所の改ページからは、続きから組めない */
    const rs: TableRows | undefined = rec ? (rec.rs ??= { site: '', rows, i: 0, end: 0, pending: [], pendingLinked: false, grp: [], held: [], splitTried: false, frags: [], k: 0, lead: undefined }) : undefined;
    // 続きのページで繰り返す見出しの高さ (fo:retrieve-table-marker のある表では、grp で始まる断片の見出しの高さ)
    const repeatedHeaderH = (grp: LNode[]) => (tm ? tm.nextHeaderH(grp) : height(headerRows.length && !node.omitHeaderAtBreak ? headerRows : []));
    const height = (ns: LNode[]) => ns.reduce((a, r) => a + r.bsize, 0);
    // keep-with-next / keep-with-previous でつながった行の塊は、まとめて置く (ただし 1 ページに入らない長さなら分ける)
    const maxKeep = Number.isFinite(this.limit) ? this.limit * 0.9 : Infinity;
    let pending: LNode[] = [];
    let pendingLinked = false;
    const flushPending = (site: TableRows['site'] = '') => {
      if (pending.length) {
        if (rs) {
          rs.site = site;
          rs.pending = pending;
          rs.pendingLinked = pendingLinked;
        }
        place(pending);
      }
      if (rs) rs.site = '';
      pending = [];
    };
    /** 行の塊を置く所を書く (置く前に呼ぶ。置いた後は site を '' に戻す) */
    const mark = (site: TableRows['site'], i: number, end: number, grp: LNode[], held: Diagnostic[], splitTried: boolean, frags: LNode[] = [], k = 0, lead?: true | BreakKind) => {
      if (!rs) return;
      rs.site = site;
      rs.rows = rows;
      rs.i = i;
      rs.end = end;
      rs.pending = pending;
      rs.pendingLinked = pendingLinked;
      rs.grp = grp;
      rs.held = held;
      rs.splitTried = splitTried;
      rs.frags = frags;
      rs.k = k;
      rs.lead = lead;
    };
    const closeBorder = () => this.stack.reduce((a, f) => a + (f.node.kind === 'table' ? f.desc.bw.be : 0), 0);
    /** 分けた行の断片を、k 番目から置く (前の断片の後ろでは改ページする) */
    const placeFrags = (frags: LNode[], from: number, i: number, end: number) => {
      for (let k = from; k < frags.length; k++) {
        mark('frags', i, end, [], [], false, frags, k);
        place([frags[k]], k > 0);
        if (rs) rs.site = '';
      }
    };
    /**
     * 行 i〜end の塊 grp の、前の塊を置いた後 (flushPending の後) の続き: ページに入らない 1 行を分けて置くか、塊を並びに足す。
     * 次に組む行の番号を返す
     */
    const afterFlush = (i: number, end: number, grp: LNode[], splitTried: boolean, useGrp: () => void): number => {
      // ページに入らない 1 行 (rowSpan 無し・keep-together 無し) は、セルの中身を行単位で分けてページをまたぐ (§7.20.3 の既定 auto)。
      // keep-together の行でも、緩めてよい強さ (keepTogetherYields) で、新しいページ (段) にも入らない高さなら、送らずにいまの位置から分ける
      const nextFull = () => this.nextLimit - repeatedHeaderH(grp) - closeBorder() - (tm ? tm.nextReserve(grp) : reserve);
      const yields = !!rows[i].keepTogetherYields && grp[0].bsize > nextFull() + EPS;
      if (this.paginating && end === i && !pending.length && (!rows[i].keepTogether || yields) && !rows[i].keepWithNext) {
        const avail = this.room - this.cursor - this.pendingValue() - closeBorder() - (tm ? tm.reserveNow(grp) : reserve);
        if (grp[0].bsize > avail + EPS && !splitTried) {
          const nextAvail = nextFull();
          const splitMk: SplitMarkers | undefined = tm ? [] : undefined;
          const splitHeld: Diagnostic[] = [];
          const frags = this.splitRow(rows[i], sizes, bst, avail, nextAvail, splitMk, undefined, splitHeld);
          if (frags) {
            for (const m of splitHeld) this.host.warn(m);
            if (splitMk) tm?.noteSplit(frags, rows[i], splitMk);
            placeFrags(frags, 0, i, end);
            pendingLinked = false;
            return end + 1;
          }
        }
      }
      useGrp();
      pending.push(...grp);
      pendingLinked = !!rows[end].keepWithNext;
      return end + 1;
    };
    let i = 0;
    // 続きから組む: 記録の所で置いていた塊の、改ページの後を置き、その所の後から続ける
    if (resuming && rs) {
      rows = rs.rows;
      i = rs.i;
      const end = rs.end;
      pending = rs.pending;
      pendingLinked = rs.pendingLinked;
      const { grp, held, splitTried, frags, k, lead } = rs;
      const site = rs.site;
      const group = site === 'frags' ? [frags[k]] : site === 'lead' ? grp : pending;
      this.placeRowsAfterBreak(group, false, () => placeHeader(true), placeOpts(site === 'frags' ? k > 0 : site === 'lead' ? lead! : false), rec);
      rs.site = '';
      const useGrp = () => {
        for (const m of held) this.host.warn(m);
        held.length = 0;
      };
      if (site === 'final') {
        pending = [];
        return;
      }
      if (site === 'linked') {
        pending = [];
        i = afterFlush(i, end, grp, splitTried, useGrp);
      } else if (site === 'lead-flush') {
        pending = [];
        useGrp();
        mark('lead', i, end, grp, held, splitTried, [], 0, lead);
        place(grp, lead);
        if (rs) rs.site = '';
        pendingLinked = !!rows[end].keepWithNext;
        i = end + 1;
      } else if (site === 'lead') {
        pendingLinked = !!rows[end].keepWithNext;
        i = end + 1;
      } else {
        placeFrags(frags, k + 1, i, end);
        pendingLinked = false;
        i = end + 1;
      }
    }
    while (i < rows.length) {
      if (rs) rs.site = '';
      const end = groupEnd(rows, i);
      const sinkAt = this.markerSink.length;
      // 行の高さを測る組み。行をページで分ける (splitRow) ・行をまたぐセルを分けて組み直すときは、この組みを捨てるので、入れ子の詰め込みの
      // 上限の警告は取り置き、この組みを置くと決めたときだけ出す (useGrp。Flow.condenseContainer)
      const held: Diagnostic[] = [];
      // 下の splitRow を、測る組みの前に同じ条件で呼び、分けられなかった (null。同じ条件なら、下でも分けられない。2 度呼ぶと、入れ子の段ごとに倍になる)
      let splitTried = false;
      // 1 行だけの組で、前に同じ条件で測った高さがあり (rowHeightRecord)、その高さがページの残りに入らず、行を分けると決まるなら、測る組みを省いて
      // 分ける (splitRow)。入れ子の表 (閉じない <li>・<td> を並べた HTML など) では、外の段の行を測る組みが、中の段の行も測っている。
      // 外の段の行を分けるとき、中の段を組み直すので、省かないと、中の段の行を、外の段の数だけ測り直す (段の数 × 中身の手間)。
      // 覚えるのは、セルの中の表 (inCell の流れ) の行だけ (外の段の行を測る組みと、分ける組みは、どちらもセルの中の流れ。ほかの表で覚える手間を掛けない)
      if (end === i && !tm && this.inCell && this.paginating && !pending.length && !(i > 0 && combineBreaks(rows[i - 1].breakAfter, rows[i].breakBefore)) && !hasInnerForcedBreak(rows[i])) {
        const known = this.rowHeightPeek(rows[i], sizes, bst);
        // 下の、測った組みで分けるかを決める所と同じ条件 (ページに入らない 1 行で、keep-together でないか、緩めてよい強さで新しいページにも入らない)
        const avail = this.room - this.cursor - this.pendingValue() - closeBorder() - reserve;
        const nextAvail = this.nextLimit - repeatedHeaderH([]) - closeBorder() - reserve;
        const yields = !!known && !!rows[i].keepTogetherYields && known.h > nextAvail + EPS;
        if (known && (!rows[i].keepTogether || yields) && !rows[i].keepWithNext && known.h > avail + EPS) {
          const splitHeld: Diagnostic[] = [];
          const frags = this.splitRow(rows[i], sizes, bst, avail, nextAvail, undefined, undefined, splitHeld);
          if (frags) {
            // 省いた組みが残すはずの、表の外へ出す末尾の余白 (layoutCell の tableTrailOut)
            if (known.trail !== undefined) this.tableTrailOut = Math.max(this.tableTrailOut ?? 0, known.trail);
            for (const m of splitHeld) this.host.warn(m);
            placeFrags(frags, 0, i, end);
            pendingLinked = false;
            i = end + 1;
            continue;
          }
          splitTried = true;
        }
      }
      const grp = end === i && !tm && this.inCell ? this.rowHeightRecord(rows[i], sizes, bst, () => this.layoutRowGroup(rows.slice(i, end + 1), sizes, bst, holdCondenseWarnings(this.host, held))) : this.layoutRowGroup(rows.slice(i, end + 1), sizes, bst, holdCondenseWarnings(this.host, held));
      const useGrp = () => {
        for (const m of held) this.host.warn(m);
        held.length = 0;
      };
      tm?.note(grp, rows.slice(i, end + 1), this.markerSink.slice(sinkAt));
      // 行の前の強制の区切り (CSS の tr・li の break-before、前の行の break-after。CSS Fragmentation 3 §4.3: 同じ区切りに当たる値は合わせる)
      // 本体の最初の行の前 (見出しの行の組 (thead・fo:table-header) と本体の間) では区切らない: 繰り返す見出しは、ページごとに丸ごと置く
      // 塊で、その後ろで区切ると、見出しだけのページができる (表がページの先頭にあれば、最初のページが見出しだけになる)。見出しの側
      // (見出しの最後の行の後ろ) の区切りも見ない。見出しの無い表の最初の行の前の区切りは、HTML の読み込みが表の前の区切りにする
      const lead = i > 0 && this.paginating ? combineBreaks(rows[i - 1].breakAfter, rows[i].breakBefore) : undefined;
      // セルの中の強制の区切り (セルの中のブロック・入れ子の表の行の break-before・break-after): 行を、その所で分ける。
      // セルの中身は、並んだ流れとして別々に区切る (CSS Fragmentation 3 §2.1・§4.3)。リストの項目 (記号のセルと本文のセル) の中のブロックも同じ
      if (this.paginating && end === i && hasInnerForcedBreak(rows[i])) {
        flushPending('');
        if (this.placeRowWithInnerBreaks(rows[i], grp, sizes, bst, lead, place, repeatedHeaderH(grp) + (tm ? tm.nextReserve(grp) : reserve), tm ? tm.reserveNow(grp) : reserve, tm, useGrp)) {
          pendingLinked = false;
          i = end + 1;
          continue;
        }
      }
      if (lead) {
        mark('lead-flush', i, end, grp, held, splitTried, [], 0, lead);
        flushPending('lead-flush');
        useGrp();
        mark('lead', i, end, grp, held, splitTried, [], 0, lead);
        place(grp, lead);
        if (rs) rs.site = '';
        pendingLinked = !!rows[end].keepWithNext;
        i = end + 1;
        continue;
      }
      const linkedToPrev = pendingLinked || !!rows[i].keepWithPrevious;
      // 行をまたぐセルを含む塊が 1 ページに入らないときは、またぐセルを行ごとのセルに分け (中身は最初の行、間の罫線は消す)、
      // 行の境目で改ページできるようにする
      if (this.paginating && end > i) {
        const fullPage = this.nextLimit - repeatedHeaderH(grp) - closeBorder() - (tm ? tm.nextReserve(grp) : reserve);
        if (height(grp) > fullPage + EPS) {
          rows = [...rows.slice(0, i), ...unspanRows(rows.slice(i, end + 1), this.wm), ...rows.slice(end + 1)];
          continue;
        }
      }
      if (!(linkedToPrev && pending.length && height(pending) + height(grp) <= maxKeep)) {
        mark('linked', i, end, grp, held, splitTried);
        flushPending('linked');
      }
      i = afterFlush(i, end, grp, splitTried, useGrp);
    }
    mark('final', i, i, [], [], false);
    flushPending('final');
  }

  /**
   * セルの中に強制の区切りのある行を、その所で分けて置く (CSS Fragmentation 3 §2.1・§4.3)。分けた断片を置いたら true。
   * 区切りが実際には起きなかった (段組の外の column だけ、など)・分けられないときは false (呼び出し側が、ふつうの行として置く)。
   * lead は行の前の強制の区切り。fixed は続きのページで行の前後に要る高さ (繰り返す見出し・フッター)、reserveNow はいまのページのフッターの高さ。
   * useGrp は、行を分けずに grp を置くときに呼ぶ (grp を組んだときに取り置いた警告を出す。layoutTableRows)。
   * 制限: 区切りは行の断片の境目にするので、左右のページの指定で挟む白ページは、同じ行のほかのセルの続きも越える
   */
  private placeRowWithInnerBreaks(
    row: LTableRow,
    grp: LNode[],
    sizes: number[],
    bst: ResolvedStyle,
    lead: true | BreakKind | undefined,
    place: (grp: LNode[], forceNewPage?: boolean | BreakKind) => void,
    fixed: number,
    reserveNow: number,
    tm?: TableMarkerHooks,
    useGrp?: () => void,
  ): boolean {
    const closeBorder = this.stack.reduce((a, f) => a + (f.node.kind === 'table' ? f.desc.bw.be : 0), 0);
    const nextAvail = this.nextLimit - fixed - closeBorder;
    const attempt = (fresh: boolean) => {
      const kinds: Array<BreakKind | undefined> = [];
      const splitMk: SplitMarkers | undefined = tm ? [] : undefined;
      const held: Diagnostic[] = [];
      const avail = fresh ? nextAvail : this.room - this.cursor - this.pendingValue() - closeBorder - reserveNow;
      const frags = this.splitRow(row, sizes, bst, avail, nextAvail, splitMk, { kinds, ...(fresh ? { atPageStart: true } : {}) }, held);
      return { frags, kinds, splitMk, held };
    };
    // 行の前で区切るなら、行は次のページ (段) の先頭から始まる
    let first = lead;
    let r = attempt(!!lead && this.pageHasContent);
    if (!r.frags && !lead && this.pageHasContent && r.kinds.some((k) => k)) {
      // 最初の断片に何も置けない (セルの先頭の強制の区切り、記号だけが残る項目など): 行ごと次のページへ送ってから分ける
      first = r.kinds.find((k) => k);
      r = attempt(true);
    }
    if (!r.frags) {
      if (first === lead) return false;
      // 分けられない行: 行ごと、区切りの後ろへ送る
      useGrp?.();
      place(grp, first);
      return true;
    }
    if (!r.kinds.some((k) => k) && first === lead) return false;
    const { frags, kinds, splitMk } = r;
    for (const m of r.held) this.host.warn(m);
    if (splitMk) tm?.noteSplit(frags, row, splitMk);
    frags.forEach((f, k) => place([f], k === 0 ? (first ?? false) : (kinds[k] ?? true)));
    return true;
  }

  /** step は続きの位置の記録の段 (layoutBlockLevel が積んだもの)。resuming なら、その段の位置から組む */
  layoutTable(table: LTable, ps: ResolvedStyle, step?: TableStep, resuming = false) {
    if (resuming && (step!.phase === 'break' || step!.phase === 'fblank' || step!.phase === 'fpage')) return this.tableResume(step!);
    if (resuming && step!.phase === 'open') return this.tableOpen(step!.open!, step, true);
    if (this.host.stats && !resuming) this.host.stats.tables++;
    const st = resolveStyle(ps, table);
    // 行をまたぐセルの広がりを、行グループの終わりと、表ごとの上限で切る (tableLimits.ts。どの行のセルも表の終わりまでまたぐ表の、行数の 2 乗のマス)
    if (limitTableSpans(table)) this.host.warn(withSource(diag('limit/table-row-span', msg(`表の、行をまたぐセルの広がりが上限を超えたので、超えた分のセルはまたがせません (number-rows-spanned・rowspan)`, `the row spans of table cells exceed the limit; the excess cells do not span (number-rows-spanned, rowspan)`)), table));
    if (st.wm !== this.wm) return this.layoutOrthogonal(table, st, ps);
    let node: LTable;
    if (resuming) node = step!.node!;
    else {
      node = collapseTableBorders(table, st.wm);
      // アンテナハウス互換 (collapse): 行の高さの指定は、罫線の中心から中心まで (trimEdgeRowHeights)
      if (node.collapseToAfterCell) node = trimEdgeRowHeights(node, st.wm);
    }
    if (step) step.node = node;
    const resumeKtc = resuming && step!.phase === 'ktc';
    if (node.breakBefore && (!resuming || step!.phase === 'pre')) {
      if (step) step.phase = 'pre';
      try {
        this.forceBreak(node.breakBefore);
      } finally {
        if (step) step.phase = '';
      }
      node = this.resolvePercent(node, false);
      if (step) step.node = node;
    }
    // clear: その側の回り込みの下まで下げる (CSS 2.1 §9.5.2。ブロックの clear (layoutBlock) と同じく、保留の余白の下限として扱う)。
    // 表は読み込みで clear を持つ (HTML の table の clear) が、これまで読まず、回り込みの範囲に重ねて置いていた
    const clr = (node as { clear?: 'start' | 'end' | 'both' }).clear;
    if (clr && !resumeKtc) {
      const y = this.floatBottom(clr);
      if (y > this.cursor + this.pendingValue()) this.pendMin = Math.max(this.pendMin, y - this.cursor);
    }
    /** 分けない指定の試し (keepTogetherCheck)。続きから組むときは、その改ページの後から */
    const ktc = (check: () => void) => {
      if (resumeKtc) {
        this.resumeOpen();
        if (step) step.phase = '';
        if (!(table as { retainSpaceBefore?: boolean }).retainSpaceBefore) this.discardLeading = true;
        return;
      }
      if (step) step.phase = 'ktc';
      try {
        check();
      } finally {
        if (step) step.phase = '';
      }
    };
    if (node.keepTogether && this.paginating) ktc(() => this.keepTogetherCheck(table, ps));
    else if (this.paginating && table.body.rows.length && (table.header?.rows.length || (node.keepHeaderWithBodyAh && table.captions?.some((c) => c.side === 'top')))) {
      // 上の見出し・表ヘッダー・本体の最初の行の塊を、まとめて置けるか調べる (表ヘッダーだけをページ末に残さない。
      // アンテナハウス互換 (LTable.keepHeaderWithBodyAh) では、ヘッダーが無くても上の見出しと最初の行を離さない)
      const first = table.body.rows.slice(0, groupEnd(table.body.rows, 0) + 1);
      ktc(() => this.keepTogetherCheck({ ...table, footer: undefined, captions: table.captions?.filter((c) => c.side === 'top'), body: { ...table.body, rows: first } }, ps));
    }
    let desc = describeBox(node, this.wm);
    // grid の 1 行の表 (LTable.gridTemplate): 列の幅を、表を置くときの内容の幅で決める (gridLineColumns)。中身の幅を測る組版で、
    // 幅が決まらないときは、項目の中身の幅から決める (gridMeasure。下の flexContentI)
    let gridMeasure: GridColumnMeasure[] | undefined;
    let gridWhole: GridLineMeasure | undefined;
    if (node.gridTemplate) {
      const g = this.gridLineColumns(node, desc, st);
      gridMeasure = g.measure;
      gridWhole = g.grid;
      const resolved: LTable = { ...node, columns: g.columns };
      copySourceRef(node, resolved);
      node = resolved;
    }
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
    let autoFree: number | undefined;
    let autoRtl: true | undefined;
    ({ node, desc, autoFree, autoRtl } = this.tableColumnWidths(node, desc, st, ps, out, gaps));
    if (node.columns.some((c) => c.fitContent || c.flexLate || c.percentWidth)) node = this.fitContentColumns(node, st, Math.max((desc.isizeExplicit ?? this.contentI() - desc.m.is - desc.m.ie - desc.bpI) - gaps, 0));
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
      // 表の最初の行の前の強制の区切り: 上の見出し (caption) と表の箱の間で区切る (CSS 2.1 §17.4: caption と表の箱は、表を包む箱の中の兄弟。
      // CSS Fragmentation 3 §3.1.1: 最初の行の前の区切りは、表の箱の前に伝わる)。区切ったら、行の前では区切らない
      const firstRow = node.header?.rows[0] ?? node.body.rows[0];
      if (this.paginating && !this.host.xslSpace && firstRow?.breakBefore) {
        this.forceBreak(firstRow.breakBefore === true ? 'page' : firstRow.breakBefore);
        node = withoutFirstRowBreak(node, firstRow);
      }
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
    const outerI = this.contentI();
    this.tableOpen({ table, node, st, desc, out, autoFree, autoRtl, caps, capIs, capTableI, bottomMargin, bottomCaptions, gridMeasure, gridWhole, outerI }, step, false);
  }

  /**
   * 表の中ほど: 前の箱の break-after (保留の区切り) を効かせ、表の箱を開き、行を組み、閉じる。o は前半で決めた値
   * (続きから組むときは、写した値から入り、保留の区切りの改ページの後から組む)
   */
  private tableOpen(o: TableOpen, step: TableStep | undefined, resuming: boolean) {
    const { table, st, out, autoFree, autoRtl, caps, capIs, capTableI, bottomMargin, bottomCaptions, gridMeasure, gridWhole, outerI } = o;
    let { node } = o;
    const desc = o.desc;
    // 前の箱の break-after (openFrame の初めと同じ所。ここで効かせるので、openFrame の中では効かせるものが無い)
    if (step) {
      step.open = o;
      step.phase = 'open';
    }
    try {
      if (resuming) this.forceBreak();
      else this.applyPendingBreak();
    } finally {
      if (step) step.phase = '';
    }
    const frame = this.openFrame(desc, 'table');
    // auto の余白で寄せた表: ページごとに本文領域の幅が違うとき、続きの断片を寄せ直す (表の幅は最初の断片のまま。Frame.autoM)
    if (autoFree !== undefined && node.autoMargins && this.wm === 'horizontal-tb') frame.autoM = { am: node.autoMargins, free: autoFree, parentI: outerI, boxI: 0, ...(autoRtl ? { rtl: true as const } : {}) };
    if (this.host.xslSpace && !node.collapseSpillAh && out.bs > 0) frame.spillBs = out.bs;
    // 中の絶対配置の箱の基準になる表 (CSS の position が static でない表): 断片を集め、セルの中で見つけた箱を、表を組み終えてから置く
    const outerCb = this.cbAbs;
    const cb = node.containingBlock ? (this.cbAbs = { frame, items: [] }) : undefined;
    if (cb) frame.frags = frame.opened ? [frame.node] : [];
    // 罫線を分ける表のセルの間隔 (border-separation / border-spacing): 列の幅は、間隔を除いた幅で決める
    const sp = node.borderCollapse !== 'collapse' && node.borderSpacing && (node.borderSpacing.i > 0 || node.borderSpacing.b > 0) ? node.borderSpacing : undefined;
    const nC = columnSizes(node, frame.contentI).length;
    // 罫線をつぶした表の列の箱の境目の、グリッド線からのずれ (columnSizes の offsets)。表の始めの端の箱は、セルが外周の罫線を持てば
    // グリッド線から外へ出る半分だけ前、表が持てば表の罫線の内側の半分だけ後ろで始まる (out.is − 表の罫線の太さ)。終わりの端も同じ。
    // 内側は、仕様の組み方ではグリッド線、互換の組み方では後ろのセルが線をまるごと持つので、線の太さの半分だけ前。
    // 自動レイアウト (fitContent・fillContent) の列の幅は、中身から測った箱の幅 (tableColumnWidths) なので、直さない
    const offsets =
      node.borderCollapse === 'collapse' && !node.fitContent && !node.fillContent
        ? Array.from({ length: nC + 1 }, (_, k) =>
            k === 0 ? out.is - desc.bw.is : k === nC ? -(out.ie - desc.bw.ie) : (node.collapseColumnLines?.[k] ?? 0) / 2,
          )
        : undefined;
    // 幅の指定の無い列の配り方: XSL-FO と HTML の --style ah は、1 行目のセルの罫線を除いた幅を等しく、HTML のほかのスタイルは列の箱を等分
    // (CSS 2.1 §17.5.2.1。LayoutOptions.fixedColumnBordersAh)
    const edges = this.host.fixedColumnBorders ? firstRowBorderWidths(node, this.wm) : undefined;
    const sizes = columnSizes(node, Math.max(frame.contentI - (sp ? sp.i * (nC + 1) : 0), 0), edges, offsets);
    frame.node.colSizes = sizes;
    if (node.flexLine) {
      // flex の 1 行の中身の幅 (Flexbox 1 §9.9.1: 項目の max-content の寄与の和): 比例の列 (余りを分ける列) は、足す固定の長さ (基準の大きさ) だけ。
      // ただし中身の幅を測る組版 (intrinsic) では、伸びる項目の列 (flexItem・flexLate のある比例の列) は、項目の中身の幅 (基準の大きさより広ければ)
      const cols = node.columns;
      const grown = new Map<number, number>();
      if (this.intrinsic && cols.some((c) => typeof c.width === 'string' && (c.flexItem || c.flexLate))) {
        const rows = [...(node.header?.rows ?? []), ...node.body.rows, ...(node.footer?.rows ?? [])];
        for (const { cell, c: col, cs: span } of placeCells([rows]).placed) {
          if (span !== 1 || typeof cols[col]?.width !== 'string' || !(cols[col].flexItem || cols[col].flexLate)) continue;
          grown.set(col, Math.max(grown.get(col) ?? 0, this.cellContentI(cell, resolveStyle(st, cell), !!this.minContent)));
        }
      }
      frame.node.flexContentI =
        sizes.reduce((a, w, k) => a + (typeof cols[k]?.width === 'string' ? Math.max(Math.min(cols[k].widthExtra ?? 0, w), grown.get(k) ?? 0) : w), 0) + (sp ? sp.i * (nC + 1) : 0);
    }
    // grid の 1 行の表の中身の幅 (中身の幅を測る組版で、幅が決まらないとき: gridMeasure): 長さの決まった列 (間隔も) はその幅、
    // 百分率の列は auto (中身に合わせた幅。CSS Grid 1 §7.2.1)、余りを分ける列 (fr・auto・minmax() など) は項目の中身から
    // (CSS Grid 1 §12.7「Expand Flexible Tracks」: min-content の大きさでは、fr の 1 つ分は 0 で、列は基準の大きさ (項目の min-content。§12.5)。
    // max-content の大きさでは、fr の 1 つ分は、項目の max-content (列の決まった幅の分を除く) を列の比で割ったものの最大。CSS Sizing 3 §5)。
    // どちらも、minmax() の最小・最大の大きさの間 (§12.4・§12.6: 列は、基準の大きさより狭くならず、成長の上限より広がらない)。
    // grid の大きさは、全部の行の項目で決まる (§12.7.1 の fr の 1 つ分も、§12.5 の列の基準の大きさも grid 全体で 1 つ) ので、fr の 1 つ分は
    // grid の全部の項目から決め (gridMaxContent)、行に無い列 (欠けた最後の行の後ろの列) も、その列の幅として数える。どの行の表も、grid の
    // 中身の幅を返す (欠けた行が、項目の無い列を 0 と数えて、grid を狭くしない)。
    // 組むときに、この幅を内容の幅として gridTracks で分け直すと、同じ列の幅になる
    else if (gridMeasure) {
      frame.node.gridContent = true;
      const cols = node.columns;
      const gm = gridMeasure;
      const whole = gridWhole && node.gridTemplate ? (this.minContent ? undefined : this.gridMaxContent(node.gridTemplate, st, gridWhole.plan)) : undefined;
      const need = new Map<number, number>();
      const rows = [...(node.header?.rows ?? []), ...node.body.rows, ...(node.footer?.rows ?? [])];
      for (const { cell, c: col, cs: span } of placeCells([rows]).placed) {
        if (span !== 1 || !gm[col]?.share || !cell.children.length) continue;
        // grid 全体の fr の 1 つ分 (whole) は、1 列だけの項目から決めてある。列をまたぐ項目 (行の表では 1 つの列のセル) は、ここで数える
        // (§12.7.1: またぐ項目は、項目の max-content から、またぐ間隔と決まった列の幅 (gm[col].fixed) を除き、またぐ列の比の和で割る)
        const gs = cols[col]?.gridSpan;
        if (whole && !(gs && gs[1] - gs[0] > 1)) continue;
        need.set(col, Math.max(need.get(col) ?? 0, Math.max(this.cellContentI(cell, resolveStyle(st, cell), !!this.minContent) - gm[col].fixed, 0)));
      }
      // fr の 1 つ分: 項目の中身の幅から、上限のある列の上限の分 (max-content では、上限まで伸びる: §12.6) を除いて、比で割ったものの最大
      let fr = whole?.fr ?? 0;
      if (!this.minContent) for (const [k, v] of need) if (gm[k].share!.w > 0) fr = Math.max(fr, (v - gm[k].share!.cap) / gm[k].share!.w);
      let total =
        gm.reduce((a, m, k) => {
          if (!m.share) return a + (m.filler ? 0 : typeof cols[k]?.width === 'number' ? (cols[k].width as number) : (sizes[k] ?? 0));
          const { w, b, cap, flex } = m.share;
          // min-content: 項目の中身の最小の幅 (上限のある列だけの列は、上限まで)。max-content: 上限のある列は上限、fr・auto の列は fr の 1 つ分 × 比。
          // どちらも、基準の大きさ (下限) より狭くしない
          const v = this.minContent ? (flex ? (need.get(k) ?? 0) : Math.min(need.get(k) ?? 0, cap)) : cap + w * fr;
          return a + m.fixed + Math.max(v, b);
        }, 0) + (sp ? sp.i * (nC + 1) : 0);
      // 行に無い grid の列: その列の幅と、前の列との間隔を足す (長さの列はその長さ、fr・auto の列は max-content では fr の 1 つ分 × 比、
      // min-content では下限。百分率の列は auto として、列の項目の中身の幅 (min-content では下限))
      if (gridWhole) {
        const { plan, gap, floors, covered } = gridWhole;
        // (占める列の範囲 covered の間だけを、列の順になめる。足す順は、全部の列をなめて占める列を飛ばすのと同じ)
        const n = plan.toks.length;
        for (let r = 0, t = 0; covered.length && t < n; t = covered[r++]?.[1] ?? n) {
          const end = Math.min(covered[r]?.[0] ?? n, n);
          for (; t < end; t++) {
            const f = plan.fixed[t];
            const lo = Math.max(floors?.auto[t] ?? 0, floors?.min[t] ?? 0);
            const v =
              f !== undefined && !plan.pct[t]
                ? f
                : f !== undefined
                  ? this.minContent
                    ? lo
                    : (whole?.need[t] ?? lo)
                  : this.minContent || (!Number.isFinite(plan.c[t]) && plan.w[t] <= 0)
                    ? plan.b[t]
                    : Math.max(Number.isFinite(plan.c[t]) ? plan.c[t] : plan.w[t] * fr, plan.b[t]);
            total += v + gap;
          }
        }
      }
      frame.node.flexContentI = total;
    }
    // 中身の幅を測る組版でも、内容の幅が決まっていれば (百分率の基準があれば)、grid の行の表の中身の幅は、その幅で決めた列の幅の和
    // (行の終わりの空きの列は数えない)
    else if (node.gridTemplate && this.intrinsic) {
      frame.node.gridContent = true;
      frame.node.flexContentI = sizes.reduce((a, w, k) => a + (typeof node.columns[k]?.width === 'number' ? w : 0), 0) + (sp ? sp.i * (nC + 1) : 0);
    }
    // リストの表の中身の幅 (中身の幅を測る組版で): 記号の列の幅と、本文のセルの中身の幅 (CSS Sizing 3 §5.1 の、リストの項目の箱の寄与)。
    // 本文の列は残りを取る比例の列なので、表の幅のままでは、測る行の長さ (max-content では非常に長い) を中身の幅として数えてしまう
    // (表のセルの中のリストで、その列の max-content が表の幅いっぱいになり、ほかの列が最小の幅まで縮んでいた)
    else if (node.listTable && this.intrinsic) {
      const rows = [...(node.header?.rows ?? []), ...node.body.rows, ...(node.footer?.rows ?? [])];
      let body = 0;
      for (const row of rows) {
        const cell = row.cells[1];
        if (cell) body = Math.max(body, this.cellContentI(cell, resolveStyle(st, cell), !!this.minContent));
      }
      frame.node.listContentI = (sizes[0] ?? 0) + body;
    }
    const savedSpacing = this.spacing;
    const savedRowspanAh = this.rowspanMiddleAh;
    const savedTableBreak = this.tableBreak;
    const savedTrailOut = this.tableTrailOut;
    this.tableTrailOut = undefined;
    this.spacing = sp;
    this.rowspanMiddleAh = !!node.rowspanMiddleAh;
    this.tableBreak = node.breakBorders ? { ...node.breakBorders, header: !!node.header?.rows.length && !node.omitHeaderAtBreak, compat: !!node.collapseToAfterCell } : undefined;
    const ctx: TableCtx = { node, st, desc, out, caps, capIs, capTableI, bottomMargin, bottomCaptions, frame, cb, outerCb, sp, sizes, savedSpacing, savedRowspanAh, savedTableBreak, savedTrailOut, headerRows: [], footerRows: [], repeatFooter: false, reserve: 0 };
    // fo:retrieve-table-marker のある表は、見出し・フッターを断片ごとに組む (layoutTableWithMarkers)。無い表は、いままでどおり 1 度だけ組んで繰り返す
    if ((node.header && collectTableRetrieves(node.header.rows).length) || (node.footer && collectTableRetrieves(node.footer.rows).length)) this.layoutTableWithMarkers(node, st, sizes);
    else {
      const headerRows = node.header ? this.layoutRowGroup(node.header.rows, sizes, resolveStyle(st, node.header)) : [];
      const footerRows = node.footer ? this.layoutRowGroup(node.footer.rows, sizes, resolveStyle(st, node.footer)) : [];
      const footerH = footerRows.reduce((a, r) => a + r.bsize, 0);
      // 改ページのたびに各ページの末尾へ置く表フッター。その分の高さを、本体の行を置くときに空けておく
      let repeatFooter = footerRows.length > 0 && !node.omitFooterAtBreak;
      // 繰り返す見出しとフッターだけでページ (段) の高さを使い切る表: 続きのページでは繰り返さない。繰り返すと、本体の行を置く所が無く、
      // どのページも見出しとフッターだけになって、本体の 1 行ごとに見出し・フッターの全部の行を持つページができる
      // (見出し 100 行・フッター 100 行・本体 1000 行の 23KB の表で、20 万個の行を作り、メモリを使い切った)。
      // CSS 2.1 §17.2 は、印刷の処理系がページごとに見出しの行を繰り返してもよいとし、CSS Tables 3 §6.2 は、繰り返しに要る高さが
      // ページの高さの半分 (見出し・フッターそれぞれ 1/4) までのときに繰り返すと定める。XSL 1.1 §6.7.3 は繰り返すと定めるが、
      // 領域に収まらない見出し・フッターの扱いは定めていない (あふれ) ので、同じく扱う
      {
        const headerH = headerRows.reduce((a, r) => a + r.bsize, 0);
        const repeatH = (headerRows.length && !node.omitHeaderAtBreak ? headerH : 0) + (repeatFooter ? footerH : 0);
        if (repeatH > 0 && this.paginating && Number.isFinite(this.limit) && repeatH >= this.limit - EPS) {
          node = withRef(node, { ...node, omitHeaderAtBreak: true, omitFooterAtBreak: true });
          repeatFooter = false;
          if (this.tableBreak) this.tableBreak = { ...this.tableBreak, header: false };
          this.host.warn(withSource(diag('layout/table-header-not-repeated', msg('表の見出しとフッターがページの高さを超えるので、続きのページでは繰り返しません', 'the table header and footer exceed the page height, so they are not repeated on the following pages')), table));
        }
      }
      ctx.node = node;
      ctx.headerRows = headerRows;
      ctx.footerRows = footerRows;
      ctx.repeatFooter = repeatFooter;
      ctx.reserve = repeatFooter ? footerH : 0;
      const hooks = this.tableHooks(ctx);
      hooks.placeHeader(false);
      if (step) step.ctx = ctx;
      this.layoutTableRows(node, st, sizes, headerRows, ctx.reserve, hooks.placeHeader, hooks.placeFooterAtBreak, undefined, step);
      this.tableFooter(ctx, hooks.placeHeader);
    }
    this.tableTail(ctx);
  }

  /** 表の見出しを置く関数と、改ページの前に表フッターを置く関数 (繰り返すとき) */
  private tableHooks(c: TableCtx): { placeHeader: (repeated: boolean) => void; placeFooterAtBreak: (() => void) | undefined } {
    const { node, headerRows, footerRows } = c;
    const placeFooterAtBreak = c.repeatFooter
      ? () => {
          const clones = footerRows.map((f) => Object.assign(cloneNode(f), { repeated: true }));
          this.reborderFooterAtBreak(footerRows[0], clones[0]);
          this.placeRowsRaw(clones);
        }
      : undefined;
    const placeHeader = (repeated: boolean) => {
      if (!headerRows.length || (repeated && node.omitHeaderAtBreak)) return;
      const clones = headerRows.map((h) => {
        const n = cloneNode(h);
        n.repeated = repeated;
        return n;
      });
      this.placeRows(clones, true, () => {});
      // ページ内容がヘッダ行だけ (ヘッダを置く前はページに何も無かった = 置いた個数がヘッダの行数と一致) なら、
      // 以降の行は (入らなくても) 改ページしない (ヘッダだけのページが続くのを防ぐ)
      this.headerOnly = this.pageItems === headerRows.length;
    };
    return { placeHeader, placeFooterAtBreak };
  }

  /** 続きから組むとき: 表の行の塊を置く所の改ページの後から (行の残りを組み、フッターを置き、閉じる) */
  private tableResume(step: TableStep) {
    const c = step.ctx!;
    const hooks = this.tableHooks(c);
    this.layoutTableRows(c.node, c.st, c.sizes, c.headerRows, c.reserve, hooks.placeHeader, hooks.placeFooterAtBreak, undefined, step, true);
    this.tableFooter(c, hooks.placeHeader);
    this.tableTail(c);
  }

  /** 表の末尾のフッター (改ページで繰り返す場合も、最後のページにはここで置く) */
  private tableFooter(c: TableCtx, placeHeader: (repeated: boolean) => void) {
    const { node, footerRows } = c;
    // 本体の最後の行の後ろの強制の区切りは、本体とフッターの
    // 間で区切る (CSS Fragmentation 3 §3.1・§4.3)。次のページには、見出しを繰り返してから置く。フッターの側 (フッターの最初の行の前) の
    // 区切りは、見出しの側と同じに見ない
    if (footerRows.length) {
      // XSL-FO の表 (fo:table-footer) では、これまでどおり区切らない (本体の最後の行の break-after は、表の後ろで効かない)
      const lead = this.paginating && !this.host.xslSpace ? node.body.rows[node.body.rows.length - 1]?.breakAfter : undefined;
      this.placeRows(footerRows, true, () => {}, lead ? { forceNewPage: lead, onBreak: () => placeHeader(true) } : {});
    }
  }

  /** 表の後半: 表の端の間隔を足し、箱を閉じ、下の見出しを置く */
  private tableTail(c: TableCtx) {
    const { node, sp, savedSpacing, savedRowspanAh, savedTableBreak, savedTrailOut, cb, outerCb, out, bottomCaptions, caps, st, capIs, capTableI, bottomMargin } = c;
    let desc = c.desc;
    // 最後の行と表の端の間の間隔
    if (sp?.b) this.cursor += sp.b;
    this.spacing = savedSpacing;
    this.rowspanMiddleAh = savedRowspanAh;
    this.tableBreak = savedTableBreak;
    this.closeFrame();
    // リストの最後の項目の末尾の余白 (trailingSpaceOut): 表の後ろの余白と重ねる (CSS 2.1 §8.3.1)
    const trailOut = this.tableTrailOut;
    this.tableTrailOut = savedTrailOut;
    if (trailOut) this.addMargin(trailOut);
    if (cb) {
      this.cbAbs = outerCb;
      this.placeCbAbs(cb);
    }
    if (this.host.xslSpace && !node.collapseSpillAh) this.pendSpill -= out.be;
    else if (!node.collapseSpillAh) this.pendAdjust -= out.be;
    if (bottomCaptions) {
      // 表の最後の行の後ろの強制の区切り: 表の箱と下の見出しの間で区切る (上の見出しと同じ)
      const lastRow = node.footer?.rows.length ? node.footer.rows[node.footer.rows.length - 1] : node.body.rows[node.body.rows.length - 1];
      if (this.paginating && !this.host.xslSpace && lastRow?.breakAfter) this.forceBreak(lastRow.breakAfter === true ? 'page' : lastRow.breakAfter);
      // 表の箱の左右の余白は、外枠の罫線の外へ出る分を引く前の値に戻す
      desc = { ...desc, m: { ...desc.m, is: desc.m.is + out.is, ie: desc.m.ie + out.ie } };
      this.placeTableCaptions(caps, 'bottom', { bs: 0, be: bottomMargin }, st, capIs, capTableI);
    }
    if (node.breakAfter) this.setBreakNext(node.breakAfter);
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
    const place = (grp: LNode[], forceNewPage: boolean | BreakKind = false) => {
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
    opts: {
      reserve?: number;
      beforeBreak?: () => void;
      /**
       * 行の前で区切る。true は次の段・ページへ送るだけ (ページに入らず分けた行の続き、XSL-FO の行の break)。
       * 種類は強制の区切り (CSS Fragmentation 3 §3.1・§4.3): page は段組の中でもページを改め、odd-page・even-page は
       * 偶奇が合うまで白ページを挟む (forceBreak と同じ)。column は次の段
       */
      forceNewPage?: boolean | BreakKind;
      /** 改ページした直後に呼ぶ (見出しの行でも) */
      onBreak?: () => void;
    } = {},
    rec?: TableStep,
  ) {
    // 前の組みで、改ページの境目のために書き換えた罫線を戻す (BREAK_SIDE_ORIG)
    if (!isHeader) restoreBreakSides(group);
    this.applyPendingBreak();
    const forcedKind = typeof opts.forceNewPage === 'string' ? opts.forceNewPage : undefined;
    // 左右のページの指定の偶奇 (forceBreak と同じ。ページ番号の分からない流れ = セルの中などでは、白ページは外の流れが挟む)
    const wantOdd = forcedKind === 'odd-page' ? true : forcedKind === 'even-page' ? false : undefined;
    const pageNo = wantOdd === undefined ? undefined : this.sideNumber();
    const parityOk = (k: number) => wantOdd === undefined || pageNo === undefined || (k % 2 === 1) === wantOdd;
    // 行の前の余白 (list-item の space-before): 保留中の余白と重ね合わせる (ページの先頭では捨てる)
    const sbRow = group[0]?.rowSpace?.before ?? 0;
    if (sbRow) this.addMargin(sbRow);
    const extent = group.reduce((a, r) => a + r.bsize, 0);
    if (this.paginating) {
      // 断片の終端で表の外枠を閉じる分と、各ページ末尾の表フッターの分も確保する
      const closeBorder = this.stack.reduce((a, f) => a + (f.node.kind === 'table' ? f.desc.bw.be : 0), 0);
      // 行グリッドの中では、最後の行の後ろの半行間は空けない (アンテナハウスの baseline-grid)。セルの中の最後の行の分を、入るかの判定に数えない
      const last = group[group.length - 1];
      const gridTrail = this.inGrid() && last?.children.length ? minOf(last.children.map((c) => c.trailLead ?? 0)) : 0;
      const need = this.cursor + this.pendingValue() + extent - gridTrail + closeBorder + (opts.reserve ?? 0) + this.heldFootCost(group);
      if (need > this.room + EPS || (opts.forceNewPage && this.pageHasContent)) {
        if (this.pageHasContent && (!this.headerOnly || opts.forceNewPage)) {
          // 行の境目で改ページするとき、このページの最後の行の後ろ側の罫線を引く (表フッターを置かない場合。セルの中の切れ目は除く)
          if (!isHeader && !opts.beforeBreak && !opts.forceNewPage) this.closeRowAtBreak(group[0]);
          opts.beforeBreak?.();
          if (forcedKind && forcedKind !== 'column') {
            // 段組の段の流れの中: 段の流れに知らせる (白ページは、段の行を置く側が挟む)
            const site = !!rec?.rs?.site && !this.pages!.pageBreakInColumns;
            if (this.pages!.pageBreakInColumns) this.pages!.pageBreakInColumns(forcedKind, true);
            // 次のページの偶奇が合わなければ、白ページを挟む (表の枠・見出しは、白ページには置かない: 空の断片は breakPage が外す)
            else if (pageNo !== undefined && !parityOk(pageNo + 1)) {
              if (site) rec!.phase = 'fblank';
              this.breakPage('blank');
              if (rec) rec.phase = '';
            }
            this.pages!.forcedBreak?.(forcedKind);
            if (site) rec!.phase = 'fpage';
            this.breakPage('page');
            if (rec) rec.phase = '';
          } else {
            if (forcedKind) this.pages!.forcedBreak?.(forcedKind);
            // 表の行の塊を置く所 (layoutTableRows が記録した所) の改ページは、続きから組める (placeRowsAfterBreak から入る)
            if (rec?.rs?.site) rec.phase = 'break';
            this.breakPage();
            if (rec) rec.phase = '';
          }
          opts.onBreak?.();
          if (!isHeader) {
            afterBreak();
            this.reborderAfterHeader(group[0]);
          }
          // ヘッダ複製後に再判定 (ヘッダ + 行が入らない場合は強制配置)
        } else {
          this.host.warn(withSource(diag('layout/table-row-overflow', msg('表の行がページ高さを超えているため溢れます', 'a table row exceeds the page height and overflows')), group[0]));
        }
      } else if (pageNo !== undefined && !parityOk(pageNo) && !this.pageHasContent && (this.pages!.atPageStart?.() ?? true) && !this.pages!.pageBreakInColumns) {
        // まだ何も置いていないページの偶奇が合わない: このページを白ページとして残し、次へ (forceBreak と同じ)
        this.breakPage('page');
      }
    }
    this.placeRowsPut(group, isHeader);
  }

  /** 続きから組むとき: placeRows の、行の前の改ページの後から (次のページを開き、見出しを繰り返し、行を置く) */
  private placeRowsAfterBreak(group: LNode[], isHeader: boolean, afterBreak: () => void, opts: { onBreak?: () => void; reserve?: number; beforeBreak?: () => void; forceNewPage?: boolean | BreakKind }, rec: TableStep | undefined) {
    const phase = rec?.phase;
    if (rec) rec.phase = '';
    // 境目の後の組みで、改ページの境目のために書き換えた罫線を戻す (BREAK_SIDE_ORIG)
    if (!isHeader) restoreBreakSides(group);
    this.resumeOpen();
    // 強制の区切りの白ページの後: 区切りのページの改ページをする
    if (phase === 'fblank') {
      const kind = opts.forceNewPage as BreakKind;
      this.pages!.forcedBreak?.(kind);
      if (rec) rec.phase = 'fpage';
      this.breakPage('page');
      if (rec) rec.phase = '';
    }
    opts.onBreak?.();
    if (!isHeader) {
      afterBreak();
      this.reborderAfterHeader(group[0]);
    }
    this.placeRowsPut(group, isHeader);
  }

  /** placeRows の後半: 行をいまの位置に置く */
  private placeRowsPut(group: LNode[], isHeader: boolean) {
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
      // (線を内へずらして描く辺 (paintWidth が場所より細い) は、描く太さの線にする)
      const { collapse, ...rest } = b;
      if (collapse?.paintWidth !== undefined && collapse.paintWidth < rest.width) rest.width = collapse.paintWidth;
      rememberBreakSide(cell, e);
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
    rememberBreakSide(cell, s);
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
  private splitRow(
    row: LTableRow,
    sizes: number[],
    st: ResolvedStyle,
    avail: number,
    nextAvail: number,
    mk?: SplitMarkers,
    /** kinds[k]: k 番目の断片の前が強制の区切りなら、その種類 (分けられず null を返すときも入れる)。atPageStart: 行をページの先頭に置くものとして組む */
    forced?: { kinds: Array<BreakKind | undefined>; atPageStart?: boolean },
    /** 入れ子の詰め込みの上限の警告 (condenseCappedMessage) の取り置き先。呼ぶ側は、返した断片を置くときに出す */
    held?: Diagnostic[],
  ): LNode[] | null {
    const rst = resolveStyle(st, row);
    // 罫線を分ける表のセルの間隔 (layoutRowGroup と同じ置き方): 列の間と表の端に si、行の前に sb
    const si = this.spacing?.i ?? 0;
    const sb = this.spacing?.b ?? 0;
    const nCols = sizes.length;
    const total = sizes.reduce((a, b) => a + b, 0) + si * (nCols + 1);
    interface CellFrags { cell: LTableCell; desc: BoxDesc; i: number; w: number; c: number; cs: number; roots: LNode[]; used: number[]; abs: CbItem[]; nodes: LNode[] }
    const cells: CellFrags[] = [];
    let col = 0;
    let brokeFirst = false;
    // 行を置くページに、すでに中身があるか (セルの中の keep の判定で、セルの先頭をページの先頭と見なさないため)
    const outerHas = this.pageHasContent && !forced?.atPageStart;
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
      // 次の nextPage の前に知らされた、強制の区切りの種類
      let forcedNext: BreakKind | undefined;
      // 試し組みを兼ねるので、警告は出さない (分けられないときは、行ごと次ページへ送る通常の処理に戻る。ほかの警告は、行の高さを測る組み
      // (layoutRowGroup) が出す)。入れ子の詰め込みの上限の警告だけは、この組みの結果について出すので、held に取り置く。
      // セルの中の流れは、ページ番号を持たない: 左右のページの指定の白ページは、行の断片を置く側 (placeRows) が挟む
      // リストの項目の行: 本文のセルの最初の行を、記号のセルの最初の行の基線より下の深さまで伸ばす (layoutRowGroup と同じ)
      const markerRoot = row.listMarkerRow && cells.length === 1 ? cells[0].roots[0] : undefined;
      const minBelow = markerRoot ? markerBelow(markerRoot) : undefined;
      const itemCap = this.flexItemCaps.get(cell);
      const flow = new Flow({ ...holdCondenseWarnings({ ...this.host, warn: () => {} }, held ?? []), ...(forced ? { pageNumber: undefined } : {}) }, {
        wm: this.wm,
        rootI: contentI,
        root: roots[0],
        ...(itemCap !== undefined ? { itemAtMaxWidth: w >= itemCap - EPS } : {}),
        ...(minBelow !== undefined ? { firstLineMinBelow: minBelow } : {}),
        limit: Math.max(avail - bp - sb, 1),
        pages: {
          addMarkers: (list) => {
            pushAll(this.markerSink, list);
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
          ...(forced ? { forcedBreak: (kind: BreakKind) => void (forcedNext = kind) } : {}),
          nextPage: () => {
            const r = newNode('block', this.wm, { isize: contentI });
            if (forced && forcedNext) forced.kinds[roots.length] = combineBreaks(forced.kinds[roots.length], forcedNext) as BreakKind;
            forcedNext = undefined;
            roots.push(r);
            return { root: r, limit: Math.max(nextAvail - bp - sb, 1), rootI: contentI };
          },
        },
        abs: this.abs,
        pageSize: this.pageSize,
        // セルの中の脚注は、行に持たせて、行を置くページの脚注領域に積む (placeRows の placeHeldFootnotes)
        footnotes: this.foot,
        holdFootnotes: true,
        collectAbs: true,
        inCell: true,
      });
      flow.layoutChildren(cell.children, resolveStyle(rst, cell));
      flow.finishPaginated();
      // 親の箱の無いマーカー (セルの子) は、セルの最後の断片で終わる
      if (mk) for (const e of cellMk) mk.push({ marker: e.pm.marker, start: e.start, end: e.end ?? roots.length - 1 });
      if (flow.brokeKeepPage === 0) brokeFirst = true;
      cells.push({ cell, desc, i, w, c: col - cs, cs, roots, used, abs: flow.foreignAbs, nodes: [] });
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
    const n = maxOf(cells.map((c) => c.roots.length));
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
            ...(c.cell.relativeOffset ? { relShift: c.cell.relativeOffset } : {}),
            src: k === 0 ? c.desc.src : undefined,
            ref: c.desc.ref,
            children: content,
          });
        // 断片の前側・後ろ側の線は、セルの中の切れ目では無い (改ページの境目で決め直すときも、セルの側の線は無いものとする)
        this.cellCols.set(cn, { c: c.c, cs: c.cs, ...(!cutS && c.cell.breakEdges?.before ? { before: c.cell.breakEdges.before } : {}), ...(!cutE && c.cell.breakEdges?.after ? { after: c.cell.breakEdges.after } : {}) });
        if (cutS) cutStart(cn, c.desc.keepStart.border, c.desc.keepStart.padding);
        if (cutE) cutEnd(cn, c.desc.keepEnd.border, c.desc.keepEnd.padding);
        rn.children.push(cn);
        c.nodes.push(cn);
      }
      for (const cn of rn.children) cn.bsize = h;
      rn.bsize = h + sb;
      out.push(rn);
    }
    // セルの中で見つけた絶対配置の箱 (layoutCell と同じ): 基準になるセルなら、セルの断片の中に置く。そうでなければ外の基準の箱へ渡す
    // (見つけた断片のセルの箱を目印にする)
    for (const c of cells) {
      if (!c.abs.length) continue;
      if (c.cell.containingBlock) this.placeAbsIn(c.nodes, c.abs, false);
      else this.handOffAbs(c.abs.map((it) => (it.anchor ? it : { ...it, anchor: c.nodes[Math.min(it.frag, c.nodes.length - 1)] })), c.nodes[0]);
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
  /** 行の高さの覚え (rowHeightRecord・rowHeightPeek) の鍵の条件: 列の幅・書字方向・セルの間隔・互換の指定・flex の項目の幅の上限 */
  private rowHeightParts(row: LTableRow, sizes: number[]): Array<string | number | boolean | undefined> {
    return [sizes.join(','), this.wm, this.spacing?.i, this.spacing?.b, this.rowspanMiddleAh, row.cells.map((c) => this.flexItemCaps.get(c) ?? '').join(',')];
  }

  /**
   * 1 行の組 (layoutRowGroup) を組み、その高さを覚える (同じ組版の中で、同じ行・同じ条件。memoMeasure)。
   * 組みが表の外に跡を残したとき (マーカー・絶対配置の箱) は、使えない印 (clean が偽) を付ける (組みを省くと、跡が残らない)。
   * 表の外へ出す末尾の余白 (tableTrailOut) は、この行の分を覚え、組みを省いたときに足す
   */
  private rowHeightRecord(row: LTableRow, sizes: number[], st: ResolvedStyle, layout: () => LNode[]): LNode[] {
    let grp: LNode[] = [];
    this.memoMeasure<RowHeight>(
      'rowh',
      row,
      st,
      this.rowHeightParts(row, sizes),
      this.foot,
      () => {
        const marks = this.markerSink.length;
        const abs = this.absHanded;
        const saved = this.tableTrailOut;
        this.tableTrailOut = undefined;
        let trail: number | undefined;
        try {
          grp = layout();
        } finally {
          trail = this.tableTrailOut;
          this.tableTrailOut = saved === undefined ? trail : trail === undefined ? saved : Math.max(saved, trail);
        }
        return { h: grp[0]?.bsize ?? 0, trail, clean: grp.length === 1 && this.markerSink.length === marks && this.absHanded === abs };
      },
      true,
    );
    return grp;
  }

  /** rowHeightRecord が覚えた、1 行の組の高さ (使えないもの・無ければ undefined。組まない) */
  private rowHeightPeek(row: LTableRow, sizes: number[], st: ResolvedStyle): RowHeight | undefined {
    const r = this.memoPeek<RowHeight>('rowh', row, st, this.rowHeightParts(row, sizes), this.foot);
    return r?.clean ? r : undefined;
  }

  layoutRowGroup(rows: LTableRow[], sizes: number[], st: ResolvedStyle, host: FlowHost = this.host): LNode[] {
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
    // 列の始めの位置 (前の列の幅を、左から順に足したもの)。セルごとに足し直すと、セルの数 × 列の数の手間になる
    // (colspan="1000" のセルが並ぶ表は、列が数万本になる)。足す順は同じなので、値は変わらない
    const colStart: number[] = [0];
    for (let k = 0; k < sizes.length; k++) colStart.push(colStart[k] + sizes[k]);
    for (const { cell, r: j, c: col, rs, cs } of placeCells([rows]).placed) {
      const w = sizes.slice(col, col + cs).reduce((a, b) => a + b, 0) + si * (Math.min(cs, nCols - col) - 1);
      // リストの項目の行 (listMarkerRow): 本文のセル (2 つ目) の最初の行を、記号のセル (1 つ目) の最初の行の基線より下の深さまで伸ばす
      const markerNode = rows[j].listMarkerRow && rowNodes[j].children.length === 1 ? rowNodes[j].children[0] : undefined;
      const cn = this.layoutCell(cell, w, rowStyles[j], markerNode ? markerBelow(markerNode) : undefined, host);
      cn.i = colStart[Math.min(col, sizes.length)] + si * (col + 1);
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
        const contentBottom = (n: LNode) => (n.children.length ? maxOf(n.children.map((c) => c.b + c.bsize)) : 0);
        // last-baseline のセル (flex の align-items: last baseline。CSS Box Alignment 3 §9.3): 最後の行の基線から下端までの距離を
        // いちばん長いものにそろえ (下に空きを足す)、下で行の下端に寄せる (代わりの揃えは end)。行の無いセルは下端を基線にする
        const ll = placed.filter((p) => p.row === j && p.align === 'last-baseline').map((p) => ({ p, below: p.node.bsize - (lastBaseline(p.node) ?? p.node.bsize) }));
        const deepest = maxOf(ll.map((x) => x.below));
        for (const { p, below } of ll) if (deepest - below > EPS) p.node.bsize += deepest - below;
        const bl = placed.filter((p) => p.row === j && p.align === 'baseline').map((p) => ({ p, fb: firstBaseline(p.node) ?? (this.host.xslSpace ? undefined : contentBottom(p.node)) }));
        const target = maxOf(bl.map((x) => x.fb ?? -Infinity));
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
    // 基準になるセルの中の絶対配置の箱: セルの大きさ (行の高さ) が決まったので、セルの内容の箱を基準に置く (CSS 2.1 §10.1)
    for (const p of placed) {
      const items = this.cellAbs.get(p.node);
      if (items) this.placeAbsIn([p.node], items, false);
    }
    rows.forEach((r, j) => (r.spaceBefore || r.spaceAfter) && (rowNodes[j].rowSpace = { before: r.spaceBefore ?? 0, after: r.spaceAfter ?? 0 }));
    if (st.direction === 'rtl' && this.wm === 'horizontal-tb') mirrorCells(rowNodes, total);
    return rowNodes;
  }

  /** host は、セルの中身を組む流れの host (既定はこの流れの host。layoutRowGroup) */
  private layoutCell(cell: LTableCell, width: number, rst: ResolvedStyle, firstLineMinBelow?: number, host: FlowHost = this.host): LNode {
    const cst = resolveStyle(rst, cell);
    const desc = describeBox(cell, this.wm);
    const contentI = Math.max(width - desc.bpI, 0);
    const itemCap = this.flexItemCaps.get(cell);
    // セルは参照領域: 先頭の余白 (space-before) は捨てる (XSL §4.3.1)。CSS のセル (keepEdgeSpace) は残す
    const sub = new Flow(host, { wm: this.wm, rootI: contentI, abs: this.abs, pageSize: this.pageSize, markerSink: this.markerSink, footnotes: this.foot, ...(cell.keepEdgeSpace ? {} : { discardLeading: true }), referenceArea: true, inCell: true, collectAbs: true, ...(firstLineMinBelow !== undefined ? { firstLineMinBelow } : {}), ...(itemCap !== undefined ? { itemAtMaxWidth: width >= itemCap - EPS } : {}) });
    sub.layoutChildren(cell.children, cst);
    // 末尾の内容の後ろの余白 (space-after) も捨てる (keepTrailingSpace・keepEdgeSpace のセルは残す)
    const fin = sub.finishWithTrailing();
    const used = fin.height + (cell.keepTrailingSpace || cell.keepEdgeSpace ? fin.after : 0);
    // 表の外へ出す末尾の余白 (HTML のリストの最後の項目。trailingSpaceOut): 表を閉じた後ろの余白にする (layoutTable)
    if (cell.trailingSpaceOut !== undefined) this.tableTrailOut = Math.max(this.tableTrailOut ?? 0, fin.after, cell.trailingSpaceOut);
    const bsize = Math.max(used, desc.bsizeExplicit ?? 0) + desc.bpStart + desc.bpEnd;
    // 中身が行で終わり、その下に余白・枠が無ければ、その行の下の半行間 (行グリッドの中の表で、改ページの判定に数えない分)
    const trailLead = Math.abs(sub.lastLead.end - used) < EPS && !desc.bpEnd && bsize - desc.bpStart - used < EPS ? sub.lastLead.half : 0;
    const cn = newNode('cell', this.wm, {
      ...(trailLead ? { trailLead } : {}),
      isize: width,
      bsize,
      padding: { ...desc.paddingP },
      border: { ...desc.borderP },
      bg: desc.bg,
      ...this.decorOf(desc),
      ...(cell.relativeOffset ? { relShift: cell.relativeOffset } : {}),
      src: desc.src,
      ref: desc.ref,
      children: sub.root.children,
    });
    // セルの中で見つけた絶対配置の箱: セルが基準 (position が static でないセル) なら、行の高さが決まってからセルの中に置く
    // (layoutRowGroup)。そうでなければ、外の基準の箱 (表・表を含むブロック) へ渡す
    if (sub.foreignAbs.length) {
      this.absHanded++;
      if (cell.containingBlock) this.cellAbs.set(cn, sub.foreignAbs);
      else this.handOffAbs(sub.foreignAbs, cn);
    }
    return cn;
  }
}

/**
 * host の中の行から、入力の節の番号が [k, end) の行内の箱 (行内の要素とその子孫) の断片を探し、基準の矩形を返す
 * (host の内容の箱の頭からの、行の向き i・block 方向 b。無ければ undefined)。
 * 行ごとの断片は、その行内の箱そのものの箱 (罫線・背景の箱、行内のブロックの箱。番号が k) があればその padding の箱、無ければ字・画像の
 * 並びを囲む矩形。矩形は、最初の断片の頭 (i0・b0) と、最後の断片の block 方向の末尾 (b1)、断片の行の向きの末尾のうちいちばん端 (i1)
 */
function inlineBoxRect(host: LNode, k: number, end: number): { i0: number; b0: number; i1: number; b1: number } | undefined {
  type R = { i0: number; b0: number; i1: number; b1: number };
  const frags: R[] = [];
  const refOf = (n: LNode) => n.ref ?? n.fxRef;
  const inRange = (n: LNode) => {
    const r = refOf(n);
    return r !== undefined && r >= k && r < end;
  };
  const join = (a: R | undefined, b: R): R => (a ? { i0: Math.min(a.i0, b.i0), b0: Math.min(a.b0, b.b0), i1: Math.max(a.i1, b.i1), b1: Math.max(a.b1, b.b1) } : b);
  // 行の中: 行の内容の箱の頭からの位置で、当たる節を集める (own: その行内の箱そのものの箱、any: 中の字・箱)
  const inLine = (n: LNode, i: number, b: number, acc: { own?: R; any?: R }) => {
    for (const c of n.children) {
      if (c.phys) continue;
      const ci = i + c.i;
      const cb = b + c.b;
      if (inRange(c)) {
        const box: R = { i0: ci, b0: cb, i1: ci + c.isize, b1: cb + c.bsize };
        if (refOf(c) === k && c.kind !== 'glyph') {
          const bw = borderWidths(c.border);
          // padding の箱: 罫線の分だけ内へ (論理の向き)
          const bs = c.wm === 'horizontal-tb' ? bw.top : c.wm === 'vertical-rl' ? bw.right : bw.left;
          const be = c.wm === 'horizontal-tb' ? bw.bottom : c.wm === 'vertical-rl' ? bw.left : bw.right;
          const is = c.wm === 'horizontal-tb' ? bw.left : bw.top;
          const ie = c.wm === 'horizontal-tb' ? bw.right : bw.bottom;
          acc.own = join(acc.own, { i0: box.i0 + is, b0: box.b0 + bs, i1: box.i1 - ie, b1: box.b1 - be });
        } else acc.any = join(acc.any, box);
        continue;
      }
      if (c.kind === 'glyph' || c.kind === 'image') continue;
      const ed = logicalEdges(c);
      inLine(c, ci + ed.is, cb + ed.bs, acc);
    }
  };
  const walk = (n: LNode, i: number, b: number) => {
    for (const c of n.children) {
      if (c.kind === 'glyph' || c.kind === 'image' || c.phys || c.wm !== host.wm || c.rot) continue;
      const ed = logicalEdges(c);
      const ci = i + c.i + ed.is;
      const cb = b + c.b + ed.bs;
      if (c.kind === 'line') {
        const acc: { own?: R; any?: R } = {};
        inLine(c, ci, cb, acc);
        const f = acc.own ?? acc.any;
        if (f) frags.push(f);
      } else walk(c, ci, cb);
    }
  };
  walk(host, 0, 0);
  if (!frags.length) return undefined;
  const first = frags[0];
  const last = frags[frags.length - 1];
  return { i0: first.i0, b0: first.b0, i1: maxOf(frags.map((f) => f.i1), first.i0), b1: Math.max(last.b1, first.b0) };
}

/**
 * 断片 frags の木の中から節 target を探し、断片の番号 k と、target の内容の箱の頭の、断片の内容の箱の頭からの位置
 * (行の向き i・block 方向 b。途中の箱の罫線・余白を足す) を返す。無ければ undefined
 */
function locateNode(frags: readonly LNode[], target: LNode): { k: number; i: number; b: number } | undefined {
  const find = (n: LNode, i: number, b: number): { i: number; b: number } | undefined => {
    for (const c of n.children) {
      if (c.kind === 'glyph' || c.kind === 'image') continue;
      const e = logicalEdges(c);
      const ci = i + c.i + e.is;
      const cb = b + c.b + e.bs;
      if (c === target) return { i: ci, b: cb };
      const hit = find(c, ci, cb);
      if (hit) return hit;
    }
    return undefined;
  };
  for (let k = 0; k < frags.length; k++) {
    const hit = find(frags[k], 0, 0);
    if (hit) return { k, ...hit };
  }
  return undefined;
}

/**
 * 行の中で見つけた絶対配置の箱の目印の箱 (LNode.absAnchor が key) を、断片 frags の中から探す。
 * k は断片の番号、i は目印の箱の inline 方向の位置、b はその箱を含む行の上端 (どちらも断片の内容の箱の頭から)
 */
function locateStaticAnchor(frags: readonly LNode[], key: number): { k: number; i: number; b: number } | undefined {
  const find = (n: LNode, i: number, b: number, lineB: number | undefined): { i: number; b: number } | undefined => {
    for (const c of n.children) {
      if (c.kind === 'glyph' || c.kind === 'image' || c.phys) continue;
      const e = logicalEdges(c);
      const ci = i + c.i + e.is;
      const cb = b + c.b + e.bs;
      if (c.absAnchor === key) return { i: i + c.i, b: lineB ?? b + c.b };
      const hit = find(c, ci, cb, c.kind === 'line' ? b + c.b : lineB);
      if (hit) return hit;
    }
    return undefined;
  };
  for (let k = 0; k < frags.length; k++) {
    const hit = find(frags[k], 0, 0, undefined);
    if (hit) return { k, ...hit };
  }
  return undefined;
}

/**
 * 同じ区切りに当たる 2 つの強制の区切りの値を合わせる (CSS Fragmentation 3 §4.3: すべての種類の区切りを満たす。左右のページの指定は、
 * 流れの中で後ろの要素の値が勝つ)。a は前の要素の break-after、b は後ろの要素の break-before。true は XSL-FO の行の区切り (種類を持たない)
 */
function combineBreaks(a: boolean | BreakKind | undefined, b: boolean | BreakKind | undefined): true | BreakKind | undefined {
  const side = (k: boolean | BreakKind | undefined) => k === 'odd-page' || k === 'even-page';
  if (side(b)) return b as BreakKind;
  if (side(a)) return a as BreakKind;
  if (a === 'page' || b === 'page') return 'page';
  if (a === 'column' || b === 'column') return 'column';
  return a || b ? true : undefined;
}

/** 段組のコンテナの、段をまたぐ子 (span="all" のブロック) か */
function isColumnSpanner(c: LBlockLevel | LInlineLevel): boolean {
  return typeof c !== 'string' && c.type === 'block' && c.span === 'all';
}

/** block 方向の余白の、before (after) の側を残すか (残さない側は 0)。行の向きの余白はそのまま */
function keepBlockSides(m: LBlock['margin'], before: keyof Edges, after: keyof Edges, keepBefore: boolean, keepAfter: boolean): LBlock['margin'] {
  if (m === undefined || (keepBefore && keepAfter)) return m;
  const e: Partial<Edges> = typeof m === 'number' ? { top: m, right: m, bottom: m, left: m } : { ...m };
  if (!keepBefore) e[before] = 0;
  if (!keepAfter) e[after] = 0;
  return e;
}

/** 同じ所の 2 つの強制の区切りを合わせる (combineBreaks)。種類を持たない行の区切り (true) は、ここでは来ない */
function combinePageBreaks(a: BreakKind | undefined, b: BreakKind | undefined): BreakKind | undefined {
  const k = combineBreaks(a, b);
  return k === true ? undefined : k;
}

/**
 * XSL-FO の段組のコンテナの中身の、最初の通常の流れの子の break-before (side が before) か、最後の子の break-after の、ページの区切り
 * (page・even-page・odd-page)。子がブロックなら、その最初 (最後) の子へたどる (どれも同じ領域の端: 区切りは 1 度だけ)。
 * 流れの外の子 (マーカー・float・脚注・絶対配置の箱) は飛ばし、端に字 (空白でないもの) があれば、たどらない。段の区切り (column) は返さない
 */
function columnEdgeBreak(children: ReadonlyArray<LBlockLevel | LInlineLevel>, side: 'before' | 'after'): BreakKind | undefined {
  const skip = (c: LBlockLevel | LInlineLevel) =>
    typeof c === 'string' ? c.trim() === '' : c.type === 'marker' || c.type === 'float' || c.type === 'footnote' || (c.type === 'block-container' && !!c.absolutePosition);
  const list = side === 'before' ? children : [...children].reverse();
  const c = list.find((x) => !skip(x));
  if (!c || typeof c === 'string' || (c.type !== 'block' && c.type !== 'table' && c.type !== 'block-container')) return undefined;
  const own = side === 'before' ? c.breakBefore : c.breakAfter;
  const ownKind = own === 'column' || own === undefined ? undefined : own;
  const inner = c.type === 'block' ? columnEdgeBreak(c.children, side) : undefined;
  // 子 (内側) は、before では流れの中で後ろ、after では前
  return side === 'before' ? combinePageBreaks(ownKind, inner) : combinePageBreaks(inner, ownKind);
}

/**
 * 段組の段の流れの、ページの区切りの扱い (FlowPages.pageBreakInColumns)。note は区切りを知らせる口、skip は次の段を作る前に呼び、
 * ページの区切りが知らされていれば、いまの段の行の残りの段を空の段 (使った高さ 0) で埋める。rowKinds[r] は、段の行 r の前の強制の区切りの種類
 */
function columnPageBreaks(n: number, roots: LNode[], used: number[], empty: () => LNode) {
  let pend: BreakKind | undefined;
  const rowKinds: Array<BreakKind | undefined> = [];
  return {
    rowKinds,
    note: (kind: BreakKind, hasContent: boolean): boolean => {
      const col = roots.length - 1;
      if (!hasContent && col % n === 0) {
        // もう段の行の最初の段にいる (前の段の行の続き): その行の前の区切りに合わせる
        rowKinds[col / n] = combineBreaks(rowKinds[col / n], kind) as BreakKind;
        return false;
      }
      pend = combineBreaks(pend, kind) as BreakKind;
      return true;
    },
    skip: () => {
      if (!pend) return;
      while (roots.length % n) {
        roots.push(empty());
        used.push(0);
      }
      rowKinds[roots.length / n] = combineBreaks(rowKinds[roots.length / n], pend) as BreakKind;
      pend = undefined;
    },
  };
}

/** 表の最初の行 (見出しの行の組の最初の行か、本体の最初の行) の前の区切りを外した表 (上の見出しの後ろで区切った後に、行の前で 2 度区切らない) */
function withoutFirstRowBreak(node: LTable, row: LTableRow): LTable {
  const strip = (b: LTable['body']): LTable['body'] => ({ ...b, rows: b.rows.map((r) => (r === row ? withRef(r, { ...r, breakBefore: undefined }) : r)) });
  return withRef(node, node.header?.rows[0] === row ? { ...node, header: strip(node.header) } : { ...node, body: strip(node.body) });
}

/** 行のセルの中 (通常の流れのブロック・入れ子の表の行) に、強制の区切りの指定があるか (行ごとに 1 度だけ調べる) */
const innerForcedCache = new WeakMap<LTableRow, boolean>();
function hasInnerForcedBreak(row: LTableRow): boolean {
  let v = innerForcedCache.get(row);
  if (v === undefined) {
    v = row.cells.some((c) => c.children.some(holdsForcedBreak));
    innerForcedCache.set(row, v);
  }
  return v;
}

function holdsForcedBreak(n: LBlockLevel | LInlineLevel): boolean {
  if (typeof n === 'string') return false;
  if (n.type === 'block') return !!(n.breakBefore || n.breakAfter) || n.children.some(holdsForcedBreak);
  // 絶対配置の箱には効かない (§3.1)。大きさの決まった箱の中は、箱ごと置くので見ない
  if (n.type === 'block-container') return !n.absolutePosition && (!!(n.breakBefore || n.breakAfter) || n.children.some(holdsForcedBreak));
  if (n.type === 'table') return !!(n.breakBefore || n.breakAfter) || n.body.rows.some((r) => !!(r.breakBefore || r.breakAfter) || hasInnerForcedBreak(r));
  return false;
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

/**
 * ブロックコンテナの枠 (罫線・padding)・背景・角丸・影・斜めの罫線を、中身を包むブロックに移す (回したコンテナを、
 * ページごとの断片に分けて組むため。layoutRotatedPaged)。コンテナは参照領域なので、包むブロックも参照領域 (refArea) にし、
 * 中と外の余白を重ねない (XSL 1.1 §4.2.5)
 */
function boxIntoBlock(node: LBlockContainer): LBlockContainer {
  // rotatedFill (互換モードの、ページをまたぐ回した箱を本文の幅いっぱいにする印) は、枠の無い箱 (回した表など。見本の形) のもの。
  // 枠を中へ移した箱には当てない (仕様モードと同じに組む)
  const { border, padding, backgroundColor, backgroundImage, backgroundClip, borderRadius, boxShadow, diagonalBorder, reverseDiagonalBorder, edgeRetain, rotatedFill: _f, ...rest } = node;
  const inner = {
    type: 'block' as const,
    refArea: true,
    refLines: true,
    ...(border ? { border } : {}),
    ...(padding ? { padding } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(backgroundImage ? { backgroundImage } : {}),
    ...(backgroundClip ? { backgroundClip } : {}),
    ...(borderRadius ? { borderRadius } : {}),
    ...(boxShadow ? { boxShadow } : {}),
    ...(diagonalBorder ? { diagonalBorder } : {}),
    ...(reverseDiagonalBorder ? { reverseDiagonalBorder } : {}),
    ...(edgeRetain ? { edgeRetain } : {}),
    children: node.children as LBlock['children'],
  } as LBlock;
  return { ...rest, children: [inner] };
}

/**
 * 段の先頭・末尾に寄せる float (before・after・inside・outside) を直下に持ち、行の中身を持たない子の並びか
 * (直交する箱は、ブロックコンテナとして組む。layoutOrthogonal)
 */
function hasEdgeFloats(children: ReadonlyArray<LNode | LInline | string | unknown>): boolean {
  const cs = children as Array<{ type?: string; float?: string } | string>;
  return cs.some((c) => typeof c === 'object' && c.type === 'float' && /^(before|after|inside|outside)$/.test(c.float ?? '')) && cs.every((c) => (typeof c === 'string' ? !c.trim() : !isInlineChild(c as never)));
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

function maxLineLength(n: LNode, root = true, tableByColumns = false, countFixed = false, beside = false): number {
  // max-content を測るとき (beside): 行と高さの重なる float の幅を、その行の長さに足す (CSS Sizing 3 §5.1・CSS 2.1 §10.3.5: max-content は
  // 折り返さないときの幅で、float は、同じ行の中身の横に並ぶ。Flexbox 1 §9.2 の項目の中身による大きさも同じ)
  if (root && beside) return Math.max(maxLineLength(n, true, tableByColumns, countFixed), besideFloatsLength(n, tableByColumns, countFixed));
  // 行の長さには、行頭の字下げも入れる (CSS Text 3 §8.1: 字下げは、行の箱の始めの端に付けた余白として扱う。
  // 字下げを受け継いだ inline-block・回り込みの箱の幅 (CSS 2.1 §10.3.5・§10.3.9 の shrink-to-fit) が字下げの分だけ足りず、中の行が折り返すのを防ぐ)
  // 負の字下げは、行の長さから引く (行の箱は字下げの分だけ短くて済む。0 を下回らない)
  if (n.kind === 'line') return Math.max((n.contentLength ?? 0) + (n.lineIndent ?? 0), 0);
  // 大きさの指定のある箱は、中身によらず、箱の外側の大きさ (内容による大きさの計測。CSS Sizing 3 §5.1)
  if (countFixed && !root && n.fixedI) {
    const pos = (v: number) => Math.max(v, 0);
    return n.isize + (n.wm === 'horizontal-tb' ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom));
  }
  // 表は表そのものの幅 (中の行の長さではない)。tableByColumns なら、列の幅の合計 + 表の左右の罫線・余白
  // (幅の指定の無い表が、置く場所いっぱいに広がっていても、列の幅だけの長さにする)
  if (n.kind === 'table') {
    // flex の 1 行の表は、置く場所いっぱいに広がった幅でなく、項目の幅の合計 (LNode.flexContentI) + 表の左右の罫線・余白
    if (n.flexContentI !== undefined) {
      const h = n.wm === 'horizontal-tb';
      const bw = (e: 'top' | 'right' | 'bottom' | 'left') => n.border[e]?.width ?? 0;
      const edges = h ? n.padding.left + n.padding.right + bw('left') + bw('right') : n.padding.top + n.padding.bottom + bw('top') + bw('bottom');
      const pos = (v: number) => Math.max(v, 0);
      const margins = root ? 0 : h ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom);
      // grid の 1 行の表 (gridContent) は、列が表の箱の外まで並ぶことがあるので、列の幅の和まで数える
      const box = n.gridContent && n.colSizes ? Math.max(n.isize, n.colSizes.reduce((a, b) => a + b, 0) + edges) : n.isize;
      return Math.min(box, n.flexContentI + edges) + margins;
    }
    // リストの表は、記号の列 + 本文の中身の幅 (LNode.listContentI)。表の始めの側の負の余白 (記号の列を、リストの字下げの中へ出す分) も
    // そのまま足す (記号の列は、リストの箱の padding の中に置かれる。padding は、外側の箱の分として数える)
    if (n.listContentI !== undefined) {
      const h = n.wm === 'horizontal-tb';
      const margins = root ? 0 : h ? n.margin.left + n.margin.right : n.margin.top + n.margin.bottom;
      return Math.max(n.listContentI + margins, 0);
    }
    if (!tableByColumns || !n.colSizes?.length) return n.isize;
    const h = n.wm === 'horizontal-tb';
    const bw = (e: 'top' | 'right' | 'bottom' | 'left') => n.border[e]?.width ?? 0;
    const edges = h ? n.padding.left + n.padding.right + bw('left') + bw('right') : n.padding.top + n.padding.bottom + bw('top') + bw('bottom');
    const pos = (v: number) => Math.max(v, 0);
    const margins = root ? 0 : h ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom);
    // 罫線を分ける表は、列の間と表の端のセルの間隔 (border-spacing) も表の幅に入る (CSS 2.1 §17.6.1)。行の箱は、間隔を含む幅
    const cols = Math.max(n.colSizes.reduce((a, b) => a + b, 0), n.children.find((r) => r.kind === 'row')?.isize ?? 0);
    return Math.min(n.isize, cols + edges) + margins;
  }
  // 書字方向が直交する子 (横書きの中の縦書きの箱など) は、行の長さではなく、組んだ箱の block の大きさ (n の行の向きの大きさ) を数える
  // (CSS Writing Modes 3 §7.3 の Note: 直交する子の、中身から決まった block の大きさが、親の行の向きの min-content・max-content の大きさに入る)
  // CSS の絶対配置の箱 (LNode.outOfFlow) は、流れの外なので数えない (CSS 2.1 §9.3.1: 祖先の大きさに影響しない)
  const inner = n.children.reduce((a, c) => (c.outOfFlow ? a : Math.max(a, isOrthogonalBox(n, c) ? orthogonalExtent(n, c) : maxLineLength(c, false, tableByColumns, countFixed))), 0);
  // 中のブロックの inline 方向の余白・罫線・margin (start-indent など) も足す
  // (外側の箱をその長さで組み直したとき、中の行が折り返さないように。負の margin ははみ出しなので数えない)
  const cl = root ? undefined : n.intrinsicClamp;
  if (root || (!inner && !cl)) return inner;
  const h = n.wm === 'horizontal-tb';
  const bw = (e: 'top' | 'right' | 'bottom' | 'left') => n.border[e]?.width ?? 0;
  const pos = (v: number) => Math.max(v, 0);
  const margins = h ? pos(n.margin.left) + pos(n.margin.right) : pos(n.margin.top) + pos(n.margin.bottom);
  let box = inner + (h ? n.padding.left + n.padding.right + bw('left') + bw('right') : n.padding.top + n.padding.bottom + bw('top') + bw('bottom'));
  // 中身の幅を、長さの上限・下限で抑える (CSS Sizing 3 §5.1。下限が勝つ)
  if (cl?.max !== undefined) box = Math.min(box, cl.max);
  if (cl?.min !== undefined) box = Math.max(box, cl.min);
  return box + margins;
}

/**
 * 組んだ流れの根 root の float (根の子の LNode.float の箱) と、高さの重なる行の長さに、その float の外側の幅を足した長さの最大
 * (float が無ければ 0)。行は、根から流れの中のブロックだけをたどって探す (表・行内の箱などの中の行は、それぞれの箱の幅で数える)。
 * 行の長さには、行を包むブロックの行の向きの余白・罫線・margin を足す (maxLineLength と同じ)
 */
function besideFloatsLength(root: LNode, tableByColumns: boolean, countFixed: boolean): number {
  const fs = root.children.filter((c) => c.float && !c.outOfFlow).map((f) => ({ b0: f.b, b1: f.b + f.bsize, w: maxLineLength(f, false, tableByColumns, countFixed) }));
  if (!fs.length) return 0;
  const pos = (v: number) => Math.max(v, 0);
  let best = 0;
  const visit = (n: LNode, b: number, edges: number) => {
    for (const c of n.children) {
      if (c.float || c.outOfFlow) continue;
      if (c.kind === 'line') {
        const y0 = b + c.b;
        const y1 = y0 + c.bsize;
        let len = maxLineLength(c, false, tableByColumns, countFixed);
        for (const f of fs) if (f.b0 < y1 - EPS && f.b1 > y0 + EPS) len += f.w;
        best = Math.max(best, len + edges);
      } else if (c.kind === 'block' && !c.fixedI && c.wm === root.wm) {
        const e = logicalEdges(c);
        const h = c.wm === 'horizontal-tb';
        const m = h ? pos(c.margin.left) + pos(c.margin.right) : pos(c.margin.top) + pos(c.margin.bottom);
        visit(c, b + c.b + e.bs, edges + e.is + e.ie + m);
      }
    }
  };
  visit(root, 0, 0);
  return best;
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

/** リストの記号のセル (の中身) の、最初の行の基線より下の深さ (行が無ければ undefined) */
function markerBelow(n: LNode): number | undefined {
  const m = firstLineBox(n);
  return m ? m.bottom - m.base : undefined;
}

/** 最初の行の箱の上端・下端・基線 (n の外枠の上端から。行が無ければ undefined) */
function firstLineBox(n: LNode): { top: number; bottom: number; base: number } | undefined {
  if (n.kind === 'line') {
    const base = firstBaseline(n);
    return base === undefined ? undefined : { top: 0, bottom: n.bsize, base };
  }
  const off = n.padding.top + (n.border.top?.width ?? 0);
  for (const c of n.children) {
    const r = firstLineBox(c);
    if (r) return { top: off + c.b + r.top, bottom: off + c.b + r.bottom, base: off + c.b + r.base };
  }
  return undefined;
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
      head.cell = withRef(cell, { ...cell, rowSpan: undefined, border: without(sides, be) });
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
  return rows.map((r, ri) => withRef(r, { ...r, cells: out[ri].sort((a, b) => a.col - b.col).map((p) => p.cell) }));
}

function cloneNode(n: LNode): LNode {
  // 凍結した共有の値 (字の節の、余白・罫線の無い印。lnode.ts の newNode) は、書き換えられないので写さない
  // (リーダーの点は、点ごとに写すので、目次の多い文書では、写した空の余白・罫線だけで数十万個になっていた)
  const own = <T extends object>(v: T): T => (Object.isFrozen(v) ? v : { ...v });
  return {
    ...n,
    margin: own(n.margin),
    padding: own(n.padding),
    border: own(n.border),
    // 字の描き方は書き換えない (inlineLayout.ts の internGlyph) ので、写さずに共有する
    glyph: n.glyph,
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

/**
 * grid の行の表の列の幅 (Flow.gridLineColumns): 同じ grid の容器 (LTable.gridTemplate) と内容の幅・下限で、前に求めた列の幅と、
 * 項目の占める列の範囲 ("from,to") ごとの幅の和。容器の値ごとに持つ (中身の幅を測る組版の Flow をまたいでも使う)
 */
const gridTrackCache = new WeakMap<NonNullable<LTable['gridTemplate']>, { W: number; floors?: GridFloors; tracks: number[]; spans: Map<string, number> }>();

/**
 * 中身の幅を測る組版での、grid の列の決まり方 (Flow.gridLineColumns): 同じ grid の容器と間隔・下限で、前に求めた計画と、
 * 項目の占める列の範囲 ("from,to") ごとの、決まった幅と、余りを分ける列の比・下限・上限の和
 */
const gridMeasureCache = new WeakMap<
  NonNullable<LTable['gridTemplate']>,
  { gap: number; floors?: GridFloors; plan: GridTrackPlan | undefined; spans: Map<string, { fixed: number; share?: GridColumnMeasure['share'] }> }
>();

/** grid の列ごとの下限 (Flow.gridFloors)。auto: 中身から測った自動の最小の大きさ、min: 書いた大きさからの最小の寄与 (GridTrackOptions.minOf) */
interface GridFloors {
  auto: number[];
  min: number[];
}

/** 中身の幅を測る組版での、grid の 1 行の表の、grid 全体の値 (Flow.gridLineColumns): 列の決まり方・列の間隔・列の下限と、行の項目の占める列 */
interface GridLineMeasure {
  plan: GridTrackPlan;
  gap: number;
  /** この行の表の項目が占める grid の列の範囲 ([始まり, 終わり)。始まりの順で、重ならず、隣り合わない) */
  covered: Array<[number, number]>;
  floors?: GridFloors;
}

/**
 * 中身の幅を測る組版での、grid の 1 行の表の列 (Flow.gridLineColumns): 決まった幅の分 (長さの列・間隔。fixed) と、
 * 余りを分ける列の比・下限・上限の和 (share)。filler は行の終わりの空きの列
 */
interface GridColumnMeasure {
  fixed: number;
  /** w: fr・auto の列の比の和、b: 下限の和、cap: 上限のある列の上限の和、flex: fr・auto の列を含む */
  share?: { w: number; b: number; cap: number; flex: boolean };
  filler?: boolean;
}

/**
 * 表の列の箱の幅 (avail を列に配る)。edges は collapse モデルの表の 1 行目のセルが列ごとに取る罫線の幅 (firstRowBorderWidths)。
 * 渡すと、幅の指定の無い列は、罫線を除いた幅 (中身と padding の幅) が等しくなるように配る: CSS 2.1 §17.5.2.1 の固定の列幅
 * (XSL 1.1 §7.28.16 の table-layout="fixed" が引く) の「残りの列は、残りの表の幅を (罫線・セルの間隔を除いて) 等しく分ける」。
 * 固定の列幅は 1 行目のセルだけを見るので、除く罫線は 1 行目のセルの罫線。アンテナハウスの見本 (サンプル FO 集の
 * table-border-conflict-resolution-1。1 行目の罫線が 5・10・5・5・15pt の 5 列の表) も、5 列とも中身の幅が 86.4pt で等しい
 * (グリッド線の間は 93.8・96.5・93.75・96.5・101.25pt。画素で測って確かめた)。罫線を分ける表も、同じ文により、1 行目のセルの罫線を除いた幅を等しく配る。
 * edges を渡すのは、XSL-FO の文書と HTML の --style ah だけ (FlowHost.fixedColumnBorders)。HTML のほかのスタイルは渡さず、列の箱を等分する
 * (同じ文の “minus borders or cell spacing” を、表の罫線・セルの間隔と読む。ブラウザ (Chromium) も列の箱を等分する)。
 * offsets は、collapse の表の、列の箱の境目がグリッド線より前にある量 (列の境目 k = 0〜列の数。仕様の組み方の内側は 0、互換の組み方
 * (collapseToAfterCell) の内側は線の太さの半分、表の始めの端はセルが外周の罫線を持てば外へ出る半分・表が持てば表の罫線の内側の半分を負に、
 * 終わりの端はその逆の向き)。渡すと、幅の指定のある列は、グリッド線の間を指定の幅にし、箱の幅を offsets で直す
 * (列の幅の指定は、グリッド線の間の幅。表の幅は外周のグリッド線の間 (CSS 2.1 §17.6.2 の row-width) なので、列の幅の指定の和が表の幅になる)。
 * アンテナハウスの見本 (サンプル FO 集の axf-form-field-event-1: 30・30・30・40mm の 4 列、外周の 1pt の線をセルが持つ表) も、
 * グリッド線の間が端の列も最後の列も指定の幅 (85.0・85.0・85.0・113.5pt。画素で測って確かめた)
 */
function columnSizes(table: LTable, avail: number, edges?: number[], offsets?: number[]): number[] {
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
  // 幅の指定のある列: グリッド線の間を指定の幅にする (箱の幅は、始めの境目のずれを足し、終わりの境目のずれを引いたもの)
  const grow = (k: number) => (offsets && typeof cols[k].width === 'number' ? (offsets[k] ?? 0) - (offsets[k + 1] ?? 0) : 0);
  const grown = offsets ? cols.reduce((a, _c, k) => a + grow(k), 0) : 0;
  // 幅の指定の無い列 (比例の指定も無い列) の罫線は、先に除き、配った後で足す (等しくなるのは、罫線を除いた幅)
  const plain = (c: (typeof cols)[number]) => (c.width === undefined || c.width === 'auto') && c.widthExtra === undefined;
  const border = (k: number) => (edges && plain(cols[k]) ? (edges[k] ?? 0) : 0);
  const taken = edges ? cols.reduce((a, _c, k) => a + border(k), 0) : 0;
  const rem = Math.max(avail - fixed - grown - taken, 0);
  return cols.map((c, k) => (typeof c.width === 'number' ? Math.max(c.width + grow(k), 0) : (c.widthExtra ?? 0) + (stars > 0 ? (rem * weights[k]) / stars : 0) + border(k)));
}

// ───────────────────────── LNode → Area (物理化) ─────────────────────────

/** background-size の百分率を、背景の配置の領域 (W × H、padding box) の大きさで長さにする (CSS Backgrounds 3 §2.9) */
/**
 * 画像そのものの flex の項目の、自動の最小の大きさ (外側の幅。Flexbox 1 §4.5): 置換要素の中身の大きさ own (指定の幅か本来の幅) を、
 * 指定の幅 (cap) と max-width (百分率は容器の内容の幅 avail が基準) で抑えたもの
 */
function replacedMinWidth(rm: NonNullable<LFlexItemColumn['replacedMin']>, own: number, avail: number): number {
  return Math.min(own, rm.cap ?? Infinity, rm.maxPct !== undefined ? rm.maxPct * avail + (rm.maxEdge ?? 0) : Infinity);
}

/** 画像そのものの flex の項目のセル (項目を包むブロック 1 つの中に、画像 1 つ) の、包むブロックと画像。その形でなければ undefined */
function itemImageOf(cell: LTableCell): { block: LBlock; img: LImage } | undefined {
  const b = cell.children.length === 1 ? cell.children[0] : undefined;
  if (!b || typeof b === 'string' || b.type !== 'block') return undefined;
  const kids = b.children.filter((x) => typeof x !== 'string' || x.trim() !== '');
  return kids.length === 1 && typeof kids[0] !== 'string' && kids[0].type === 'image' ? { block: b, img: kids[0] as LImage } : undefined;
}

/**
 * 画像そのものの flex の項目のセル (項目を包むブロック 1 つの中に、画像 1 つ) の、セルの中身の幅 (max-content) と、項目の外側の幅の差 (pt)。
 * 余白・枠・内側の余白は、項目を包むブロックだけが持つ (読み込みが画像から外す: htmlImport の stripImageFrame)。中身の幅は、包むブロックの
 * 負の余白で縮まないので、その分を引くと、項目の外側の幅 (画像の幅 + 枠・内側の余白 + 余白) になる。その形でなければ 0
 */
function itemImageEdges(cell: LTableCell, wm: WritingMode): number {
  const it = itemImageOf(cell);
  if (!it) return 0;
  const outer = describeBox(it.block, wm);
  return -(Math.min(outer.m.is, 0) + Math.min(outer.m.ie, 0));
}

function percentImage<T extends BackgroundImage & { width: number; height: number }>(bi: T, W: number, H: number): T {
  if (bi.widthPct === undefined && bi.heightPct === undefined) return bi;
  const { widthPct: wp, heightPct: hp, widthOffset: wo, heightOffset: ho, pctAuto, aspect, ...rest } = bi;
  const ar = aspect && aspect > 0 ? aspect : 1;
  // 百分率と長さの和 (calc(50% + 10px)) は、長さの部分を足す
  let w = wp !== undefined ? W * wp + (wo ?? 0) : bi.width;
  let h = hp !== undefined ? H * hp + (ho ?? 0) : bi.height;
  // 片方が auto: 画像の縦横比で決める
  if (pctAuto === 'height') h = w / ar;
  else if (pctAuto === 'width') w = h * ar;
  return { ...rest, width: Math.max(w, 0), height: Math.max(h, 0) } as T;
}

/** gradientImage で作ったグラデーションの背景の数 (増えていなければ registerGradients は木をたどらない) */
let gradientsMade = 0;
/** 行の中で見つけた絶対配置の箱の目印 (LInline.staticAnchor) の通し番号 */
let staticAnchorSeq = 0;
/** 組版が行の並びの途中の float に入れる目印 (LInline.floatAnchor) の通し番号。読み込みの付ける番号 (正の数) と分けるため、負の数にして使う */
let floatAnchorSeq = 0;

/** 行内の子 c の中の、float の目印 (LInline.floatAnchor) の番号を out に、読み込みの付けた絶対配置の箱の目印 (staticAnchor の負の番号) を abs に足す */
function collectFloatAnchors(c: InlineChild, out: Set<number>, abs: Set<number>) {
  if (typeof c === 'string' || c.type !== 'inline') return;
  if (c.floatAnchor !== undefined) out.add(c.floatAnchor);
  if (c.staticAnchor !== undefined && c.staticAnchor < 0) abs.add(c.staticAnchor);
  for (const k of c.children) collectFloatAnchors(k as InlineChild, out, abs);
}
/** グラデーションの背景の画像の大きさ: background-size の指定 (cover・contain・auto は背景の領域の大きさ)。CSS Images 3 §3 の画像は本来の大きさを持たない */
function gradientImage(bi: BackgroundImage, W: number, H: number): BackgroundImage & { width: number; height: number } {
  gradientsMade++;
  // 大きさ (CSS Backgrounds 3 §2.9): 百分率 (と、百分率と長さの和) は、背景の位置の領域 (W × H) に対する割合。長さはそのまま。
  // 指定の無いもの (auto。undefined か、組版の途中の印の NaN) と cover・contain は、領域の大きさ (グラデーションは本来の大きさも縦横比も
  // 持たない: CSS Images 3 §3)。0 は有効な大きさで、描かない (§2.9: どちらかが 0 なら、画像を表示しない。前は 0 を指定なしと
  // みなして領域いっぱいに塗り、百分率も読まずに領域いっぱいにしていた)
  const one = (pct: number | undefined, off: number | undefined, len: number | undefined, room: number) =>
    bi.size ? room : pct !== undefined ? room * pct + (off ?? 0) : len === undefined || Number.isNaN(len) ? room : len;
  const w = one(bi.widthPct, bi.widthOffset, bi.width, W);
  const h = one(bi.heightPct, bi.heightOffset, bi.height, H);
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

/**
 * 飾り・印の無い字 (字の大半): toArea の一般の作り方 (base の欄を条件つきで足してから、字の欄を重ねる) と同じ欄を、1 つのリテラルで作る。
 * 値の無い欄 (backgroundColor・sourceId) は置かない (一般の作り方では undefined の欄になる。JSON では、どちらも書かれない)。
 * 組んだ後で attachResources が足す fontId・glyphIds の置き場を、初めから取っておく (後から足すと、オブジェクトの外に置き場を作る)。
 * 字は文書の領域の大半を占めるので、字 1 つあたりのバイト数が、数千ページの文書の領域の木の大きさを決める
 */
function plainGlyph(n: LNode, rot: number): boolean {
  const g = n.glyph;
  return (
    !!g && !rot && n.bg === undefined && n.src === undefined && !n.relShift && !n.bgImage && !n.bgClip && !n.clip && !n.float && !n.radius && !n.diag && !n.shadow && !n.outline && !n.fx &&
    !(n.fxRef !== undefined && paintEffectState.on) && !n.link && !n.annot && !n.form && !g.italic && !g.fakeBold && !g.features && !g.fontPalette &&
    !g.hyphen && g.breakSpace === undefined
  );
}
function plainGlyphArea(n: LNode, g: GlyphPayload, pos: { x: number; y: number }, width: number, height: number): GlyphArea {
  return {
    x: pos.x,
    y: pos.y,
    width,
    height,
    margin: n.margin,
    padding: n.padding,
    border: n.border,
    writingMode: n.wm,
    // 入力の節の番号 (無ければ undefined の欄。JSON には書かれない)
    sourceRef: n.ref,
    type: 'glyph',
    text: g.text,
    fontFamily: g.fontFamily,
    fontWeight: g.fontWeight,
    fontSize: g.fontSize,
    color: g.color,
    baselineX: g.baselineX,
    baselineY: g.baselineY,
    rotation: g.rotation,
    scaleX: g.scaleX,
    advance: g.advance,
    fontId: undefined,
    glyphIds: undefined,
  };
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
  if (n.kind === 'glyph' && plainGlyph(n, rot)) return plainGlyphArea(n, n.glyph!, pos, width, height);
  const bw = borderWidths(n.border);
  const contentPW = width - n.padding.left - n.padding.right - bw.left - bw.right;
  const base = {
    // position: relative のセル (CSS 2.1 §9.4.3): 組んだ後の箱を、物理の向きにずらす
    x: pos.x + (n.relShift?.x ?? 0),
    y: pos.y + (n.relShift?.y ?? 0),
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
    ...(n.outline ? { outline: n.outline } : {}),
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
        ...(n.image?.language ? { language: n.image.language } : {}),
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
/** An+B (Selectors 4 §14.1): n = a·k + b となる 0 以上の整数 k があるか (n は 1 始まり) */
function anPlusB(a: number, b: number, n: number): boolean {
  if (a === 0) return n === b;
  const k = (n - b) / a;
  return Number.isInteger(k) && k >= 0;
}

/** 文書の先頭からのページの順で選ぶマスター (:nth() の group の無いもの) があるか */
function docOrdinalMasters(seq: LPageSequence): boolean {
  const has = (c: ConditionalPageMaster) => !!c.when.nth?.some((x) => !x.group);
  return !!seq.masterAlternatives?.some(has) || !!seq.masterSequence?.some((it) => it.masters.some(has));
}

function sequenceMasters(seq: LPageSequence): PageMaster[] {
  return [seq.master, ...conditionalMasters(seq).map((a) => a.master)];
}

/** ページの柱など (static-content) を組んだ箱と、ページの本文の書字方向 (sheetStatics) */
interface SheetStatics {
  nodes: LNode[];
  wm: WritingMode;
}

/** 組みながら確定したページを渡す状態 (LayoutEngine.layoutSheets の emit。design/pdf-writer.md の 12) */
interface EmitState {
  /** 渡したページの数 (文書の初めから) */
  done: number;
  /** 渡すのを止めた (受け手が断った・渡せない所に来た。そこから後ろのページは、組み終えてから作る) */
  stopped: boolean;
  /** 組み直しの 1 回目で、まだ置いていない参照先を本文で引いた最初のページ (文書の初めから。そこから後ろは渡さない) */
  unsafeAt: number;
  /** 柱を組む間に、まだ置いていない参照先・総ページ数を引いたか */
  staticUnresolved: boolean;
  /** 柱を組んでいる (参照を引いたら staticUnresolved にする) */
  inStatics: boolean;
  /** 組んでいる page-sequence のページを渡してよいか */
  seq: boolean;
  /** 組んでいる page-sequence の、渡したか手放したページの数 (page-sequence の中の番号) */
  seqDone: number;
  /** 渡したページ (後ろのページの柱が、前のページのマーカーを引く。手放した後もマーカーは残る) */
  pages: PageBuild[];
  /** 渡したページの柱の警告 (回の終わりの柱の警告の前に足す。柱を回の終わりにまとめて組むときと同じ並び) */
  staticWarnings: Diagnostic[];
  /** 渡した最後のページの柱を組んだ後の、行番号の数え (回の終わりに残りのページの柱を組むときの初め) */
  lineCount: Map<LPageSequence, number>;
  /** 組み直しの 1 回目で、渡すのを断ったページの柱を組んだ後の行番号の数え (そのページは行番号を付けてあるので、1 回目の終わりはここから) */
  lineCountRefused?: Map<LPageSequence, number>;
  /** 渡したページのフォント・字形の番号を付ける物 (残りのページにも同じ物を使う) */
  resources: ReturnType<typeof resourceAttacher>;
  /** 柱を組むときの host と文書の書式 (onceSteps が回の初めに置く) */
  host?: FlowHost;
  docStyle?: ResolvedStyle;
  /** 確認 (emitProbe.keep): 渡したときの領域の木 (JSON) と柱 */
  kept?: Array<{ json: string; statics: SheetStatics }>;
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
  /** ページごとの、本文 (段・span) が使った高さの最大 (ページの本文領域の先頭から。本番の組版だけ数える) */
  bodyEnds: Map<number, number>;
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
  /**
   * abs のページの脚注の予約 (本文領域の下に空ける高さ)。ページの始まり (start) で、本文の並びの位置 s と前方 float の高さ top から決め、
   * そのページの残りの段では同じ値を使う。試し組みは、その組みの脚注 (trialItems) を見て決める
   */
  botAt: (abs: number, s: number, top: number, start: boolean, trial: { items: Map<number, ColumnPageItems>; conts: Map<number, FootEntry[]> } | undefined) => number;
  /** 本番の組版の、本文の並びの位置 (群の初めまでに、段・span が使った高さの和。span は段の数を掛ける) */
  lin: { v: number };
  /** 本番の組版の、脚注の参照 (本文の並びの位置の順) */
  refs: Array<{ pos: number; e: FootEntry }>;
}

/** 段組のページに脚注を置いた結果 (placeColumnFoots) */
interface ColumnFootPlacement {
  placed: FootEntry[];
  b: number;
  out: FootEntry[];
  warns: FootEntry[];
}

/**
 * 段組のページの脚注を置く (layoutColumnPass の本番の配置と上限を付けない配置、予約を決める見積もりで使う)。
 * cap は、脚注領域の高さの上限 (本番は、このページの本文が実際に使った高さの下まで)。conts は前のページからの続き、foots・footEnds は
 * このページで参照する脚注と、参照までの本文を段に収めるのに要る高さ。reserve は、このページに空けた予約。
 * 置いた脚注・その高さ・次のページへ送る脚注を返す。dry なら箱の位置を書かない (見積もり)
 */
function placeColumnFoots(p: {
  foot: FootnoteCtx;
  room: number;
  limit: number;
  reserve: number;
  cap: number;
  conts: readonly FootEntry[];
  foots: readonly FootEntry[];
  footEnds: readonly number[];
  dry?: boolean;
}): ColumnFootPlacement {
  const { foot, room, limit, reserve, cap } = p;
  let b = 0;
  const placed: FootEntry[] = [];
  const out: FootEntry[] = [];
  /** 溢れの警告を出す脚注 (ページに入らないまま置いたもの) */
  const warns: FootEntry[] = [];
  /**
   * 行内に並べる脚注 (CSS GCPM 3 §2.3 の footnote-display: inline・compact、axf:footnote-stacking="inline"): 最後に置いた脚注の段落に続けて組んだもの
   * (1 段のページの Flow.pushFootnote と同じ)。最後に置いた脚注の代わりに、その位置に置く
   */
  const joined = (e: FootEntry) => foot.join(placed[placed.length - 1], e);
  /** 最後に置いた脚注を j に替える */
  const replaceLast = (j: FootEntry) => {
    b -= placed[placed.length - 1].height;
    placed[placed.length - 1] = j;
    if (!p.dry) {
      j.node.i = 0;
      j.node.b = b;
    }
    b += j.height;
  };
  const put = (e: FootEntry) => {
    const j = joined(e);
    if (j) {
      replaceLast(j);
      return;
    }
    b += foot.gapAfter(placed[placed.length - 1]);
    if (!p.dry) {
      e.node.i = 0;
      e.node.b = b;
    }
    placed.push(e);
    b += e.height;
  };
  /**
   * e を、脚注領域の高さが budget を超えない所で分けて置き、残りを次のページへ送る。分けられなければ false。
   * strict なら、先頭の単位 (行) も budget に入らないときは分けずに丸ごと送る (本文の行と重ねない)
   */
  const splitPut = (e: FootEntry, budget: number, strict: boolean): boolean => {
    const j = joined(e);
    if (j) {
      // つないだ段落を行で分ける (分けた頭が、最後に置いた脚注より低くなるなら、つながずに、下のブロックの分け方で分ける)
      const last = placed[placed.length - 1];
      const start = b - last.height;
      const sj = splitEntry(j, budget - start);
      if (sj && sj.head.height + EPS >= last.height) {
        if (strict && start + sj.head.height > budget + EPS) out.push(e);
        else {
          replaceLast(sj.head);
          out.push(sj.rest);
        }
        return true;
      }
    }
    const sp = splitEntry(e, budget - b - foot.gapAfter(placed[placed.length - 1]));
    if (!sp) return false;
    if (strict && b + foot.gapAfter(placed[placed.length - 1]) + sp.head.height > budget + EPS) out.push(e);
    else {
      put(sp.head);
      out.push(sp.rest);
    }
    return true;
  };
  const over = (e: FootEntry, lim: number) => {
    const j = joined(e);
    if (j) return b - placed[placed.length - 1].height + j.height > lim + EPS;
    return b + foot.gapAfter(placed[placed.length - 1]) + e.height > lim + EPS;
  };
  /** 本文の行と重ねないための上限 (cap) が、ページに入る高さ (room) より低いか */
  const strict = cap < room - EPS;
  // 前のページからの続き: 脚注領域の先頭に置く。本文領域の 6 割まで (1 段のページと同じ上限)
  // 分けられない続きは、もう脚注を置いたページなら次のページへ送る。丸ごと置くのは、このページにまだ何も置いていないときだけ
  // (前は、本文の後に足したページで、分けられない続きを次々に丸ごと積み、脚注の領域が本文領域より高くなって、上の行が
  // ページの外へ出て描かれなかった。警告も無かった)。何も置いていないページに入らない続きは、溢れの警告を出して置く
  for (const e of p.conts) {
    const lim = Math.min(room, limit * 0.6, cap);
    if (out.length) out.push(e);
    else if (!over(e, lim)) put(e);
    else if (!splitPut(e, lim, strict)) {
      if (strict || placed.length) out.push(e);
      else {
        if (over(e, room)) warns.push(e);
        put(e);
      }
    }
  }
  /** 前のページからの続きのうち、次のページへ送ったものの数 (ここより後ろの out は、このページの脚注) */
  const contsOut = out.length;
  p.foots.forEach((e, k) => {
    // このページの前の脚注を分けて送ったら、後ろの脚注も順に次のページへ送る (脚注の順を保つ)。前のページからの続きを送っても、
    // このページで参照する脚注の頭は、このページに置く (XSL 1.1 §6.12.3・CSS GCPM 3 §2: 脚注の本体は参照のあるページから。
    // 1 段のページの Flow.pushFootnote と同じ。脚注の領域の高さに上限 (max-height) があるときだけ、続きの後ろの脚注も順に送る。
    // 前は、続きを 1 つ送ると、そのページで参照する脚注もすべて次のページへ送ったので、長い脚注の続きが何ページも続くと、
    // 後ろの脚注が参照のページから離れていった)
    if (out.length > contsOut || (out.length && foot.maxHeight !== undefined)) {
      out.push(e);
      return;
    }
    // 参照の行の下に残る高さに収まらなければ分け、残りを次のページへ続ける (1 段のページの Flow.pushFootnote と同じ。
    // XSL 1.1 §6.12.3・CSS GCPM 3 §2: 脚注の本体は、参照のあるページから始める)。参照までの本文を段に収めた高さ (footEnds) の
    // 下が残る高さ (もう空けてある高さがあれば、そこまで)。前は、脚注がページに入る高さなら丸ごと置き、参照の行を置く高さを残さない
    // 予約をしたので、組み直すたびに参照が次のページへ送られて、1 段に数行ずつのページが続き、組み直しの回数の上限で止めた
    // ページでは、予約の無い本文の上に脚注を重ねた
    const lim = Math.min(room, Math.max(limit - p.footEnds[k], reserve), cap);
    if (!over(e, lim)) put(e);
    else if (!splitPut(e, lim, strict)) {
      // 分けられない脚注: 本文の行と重なるなら、丸ごと次のページへ送る。ページに入らないときも、もう脚注を置いたページなら
      // 次のページへ送る (脚注の領域を本文領域より高くしない)。何も置いていないページに入らなければ、溢れの警告を出して置く
      if ((strict && over(e, cap)) || (placed.length && over(e, room))) out.push(e);
      else {
        if (over(e, room)) warns.push(e);
        put(e);
      }
    }
  });
  return { placed, b, out, warns };
}

/** 予約を 1 度試した結果: 予約 r と、その回の組版で要った高さ need */
interface ReserveTry {
  r: number;
  need: number;
}

/**
 * 段組のページの脚注の予約を、組み直しの回をまたいで決めるための覚え (layoutColumnSequence が持ち、layoutColumnPass が読む)。
 * - 前の回の組版の脚注の参照と、その本文の並びの位置 (段の区切りによらない、前の段までに使った高さの和 + 段の中の位置)。
 *   ページの始まりの位置から、そのページに入る参照と要る高さを見積もり、収まる最小の予約を求める (layoutColumnPass の estimateBot)。
 *   本文の並びの位置は予約で変わらないので、前のページの予約が変わってページの始まりがずれても、見積もりはずれない
 * - ページの始まり (本文の並びの位置・前方 float の高さ・本文領域の高さ・段の数・前のページから続く脚注) ごとに試した予約と、
 *   その回に要った高さ。同じ所から始まるページは、収まった予約に固め、収まらなければ上げる (choose)。
 *   前は、予約と要る高さを入れ替えるだけだったので、予約を上げると参照が次のページへ移って要る高さが下がり、下げるとまた上がる
 *   ページで振れ、高い方に固まって、本文が数行だけで脚注の無いページが残った
 */
export class ColumnReservePlan {
  refs: Array<{ pos: number; e: FootEntry }> = [];
  readonly tries = new Map<string, ReserveTry[]>();

  static key(s: number, top: number, limit: number, n: number, conts: readonly FootEntry[]): string {
    return `${s.toFixed(1)}|${top.toFixed(1)}|${limit.toFixed(1)}|${n}|${conts.map((e) => e.height.toFixed(1)).join(',')}`;
  }

  /** 本文の並びの位置が pos 以上の、最初の参照 */
  lowerBound(pos: number): number {
    let lo = 0;
    let hi = this.refs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.refs[mid].pos < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * 試した予約 (tried) と見積もり (model) から、次に使う予約を選ぶ。maxR は予約の上限 (本文の 1 行半を残す)。
   * 収まった予約 (要った高さが予約を超えなかったもの) があれば、そのうち最も低いものに固める。予約を下げると本文が増えて参照も増えるので、
   * 収まった予約の余り (参照の行を次のページへ移すために越えた分。1 行ほど) を詰めようとすると、たいてい収まらなくなり、そのページの
   * 始まりより後ろのページがすべてずれて、組み直しが収まらない。収まった予約がまだ無ければ、見積もり、収まらなかった予約の回に要った高さ
   * (その回の参照の脚注は、そこまで上げれば収まる)、上限との間の順に試し、最後は上限
   */
  choose(tried: readonly ReserveTry[], model: number, maxR: number): number {
    if (!tried.length) return model;
    let hi: ReserveTry | undefined;
    for (const t of tried) if (t.need <= t.r + 0.01 && (!hi || t.r < hi.r)) hi = t;
    if (hi) return hi.r;
    let lo = tried[0];
    for (const t of tried) if (t.r > lo.r) lo = t;
    const fresh = (c: number) => c <= maxR + 0.01 && tried.every((t) => Math.abs(t.r - c) > 0.05);
    for (const c of [model, lo.need]) if (c > lo.r + 0.05 && fresh(c)) return Math.min(c, maxR);
    const mid = (lo.r + maxR) / 2;
    return mid > lo.r + 0.05 && fresh(mid) ? mid : maxR;
  }
}

/** ページ番号の参照の 1 つの値と、その字の書式 (SeqMemo.cites) */
interface CiteValueUse {
  value: string;
  style?: ResolvedStyle;
}

/** 参照したページ番号の記録の 1 項目 (SeqMemo.cites) */
interface CiteEntry {
  args: [string, boolean | undefined, string | undefined, boolean | undefined];
  uses: CiteValueUse[];
  seen: Set<string>;
}

/**
 * 組み直しの 2 回目からの字の差し替え (reuseCites) で書き換えた所の、書き換える前の中身 (Typesetter が覚える前の文書の組版を、組み直しの 1 回目の
 * 形に戻すため。PrevLayout.undo)。字の節の描き方と、参照の記録の値と書式の組。どちらも、初めに書き換える前のものだけを持つ
 */
interface CiteUndo {
  glyphs: Map<LNode, GlyphPayload>;
  cites: Map<CiteEntry, { uses: CiteValueUse[]; seen: Set<string> }>;
}

/** 1 段の page-sequence の組み (LayoutEngine.sequenceRun) */
interface SeqRun {
  /** 初めから組む (lastIndex は最後のページの番号。分からなければ null) */
  layout(lastIndex: number | null): PageBuild[];
  /** 写した境目から続けて組む (最後のページのマスターの選び直し)。続けられる境目が無ければ undefined (呼ぶ側が初めから組む) */
  relayout(lastIndex: number | null, reset: () => void, uncount: (far: boolean) => void): PageBuild[] | undefined;
  /** k ページの後の境目 (写していなければ undefined) */
  boundaryAt(k: number): SeqBoundary | undefined;
  /** 次の文書が、前の組版と繋ぐための記録 (最後の layout の。最後のページのマスターで組み直す page-sequence は undefined) */
  record(): SeqRunRecord | undefined;
  /** 前の組版から繋いだ (境目の前のページの数と、繋いだページの数) */
  spliced?: { at: number; pages: number };
}

/** 1 段の page-sequence の組みの、次の文書が繋ぐための記録 (SeqMemo.run) */
interface SeqRunRecord {
  bounds: SeqBoundary[];
  recs: PageRecord[];
  /** 組みの初めと終わりの警告の数 (組みの間の警告は、SeqMemo.warnings の、初めから warnEnd - warnStart 個) */
  warnStart: number;
  warnEnd: number;
  /** 組みの終わりの、脚注の最後の番号 */
  footEnd: number;
  /** 組んだページの数 (SeqMemo.built の初めの pages 個。後ろは force-page-count の白ページ) */
  pages: number;
  /** 最初のページの本文領域の inline の大きさと block の上限 (前を飛ばして続きから組むとき、流れを作るのに使う) */
  rootI?: number;
  limit?: number;
  /** 組みの初めの、書体の組が返した実体の数と、組みの間に返した実体 (境目の hand から、使うページの分を返し直す) */
  handStart: number;
  handed: Array<[string, LoadedFont]>;
}

/** 前の組版から繋ぐ相手 (sequenceRun に渡す) */
interface SpliceTarget {
  memo: SeqMemo;
  rec: SeqRunRecord;
  map: ReuseMap;
  /** この page-sequence の最初のページの、この文書の先頭からの通し番号 */
  ordinal: number;
  /**
   * 同じ文書の前の回の組みと繋ぐ (組み直しの 2 回目からの回。参照の値が変わった page-sequence)。map は番号をそのままにする対応で、
   * owners は、この文書の入力の節の欄の配列の持ち主 (前と後が同じ)。直した所の代わりに、値の変わった参照を見る (skipFrom・spliceOk)
   */
  within?: { owners: { old: ArrayOwners; now: ArrayOwners } };
}

/** page-sequence の、ページの境目の記録 (design/resumable-flow.md の 4.2 の PageBoundary) */
interface SeqBoundary {
  /** 境目の前のページの数 (この境目の後に作るページは index + 1 ページ目) */
  index: number;
  /** 流れの写しと続きの位置 (続きから組めない境目は flow.reason) */
  flow: FlowBoundary;
  /** 脚注の番号付けと、その位置 */
  foot: FootnoteCtx;
  footMark: FootnoteMark;
  /** 境目のときの警告の数 */
  warn: number;
  /** 境目までに読んだ、いちばん後ろの入力の節の番号 (5.1) */
  readTo: number;
  /** 指紋 (5.3。続きから組めない境目は空) */
  digest: string;
  /** 前方 float の区切りの内容を、境目までに組んだときの、組んだもの (続きから組むとき、境目の後に組んだものを使わない) */
  beforeSep?: FootEntry;
  /** 境目のときの、書体の組が返した可変フォントの実体の数 (FontManager.handedCount。前の組版のページを使うとき、その分を返し直す) */
  hand: number;
  /** 境目のときの、組版の器の数え (組んだ回数・手間の上限の数え) */
  counts: { flows: number; blocks: number; tables: number; nestHit: boolean; nestD: number; nestCd: number; trial: number };
  /** resumeCheck のときだけ: 境目のときの id のページの記録 */
  ids?: { pages: Map<string, IdPages>; build: Map<string, PageBuild>; last: Map<string, PageBuild> };
}

/** resumeCheck: 次の境目で、前の境目に戻る合図 (sequenceRun の drive が受ける) */
const RESUME_CHECK: unique symbol = Symbol('kumiori.resumeCheck');
/** 前の組版と揃ってから、繋ぐまでに組み続けるページの数 (sequenceRun の onBoundary) */
const SPLICE_LEAD = 3;
/** 境目の状態が前の組版と揃ったので、組むのを止めて、残りのページを前の組版から繋ぐ合図 (sequenceRun の drive が受ける) */
const SPLICE: unique symbol = Symbol('kumiori.splice');

/**
 * 続きの位置の、組んでいる入力の節の番号 pos (いちばん深い、節を持つ段の節: 組んでいるブロック・表か、keep の改ページの後に組む子。
 * 行の並びの字は節を持たないので、その並びを持つブロック)。前の組版と繋ぐとき、この節が直した所より後ろ (直した所を組み終えた) かを見る。
 * 行の塊を置いている表は、まだ置いていない最初の行 (保留の行・組んでいる塊・分けた断片を含む) で、表 (table) が直した所の前から始まるときは、
 * 直した所が表の本体の行の中 (lo より後ろ) であることも要る (見出し・フッター・表の題は、続きのページでも組み直して置くので、直した所の外であること)
 */
function resumePos(steps: readonly ResumeStep[]): { pos: number; lo: number; table: number } | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st.k === 'table') {
      const rs = st.rs;
      const first = sourceRef(rs?.rows[0]);
      const table = sourceRef(st.orig);
      if (rs && st.phase !== 'pre' && st.phase !== 'open' && st.phase !== 'ktc' && first !== undefined && table !== undefined) {
        let pos = rs.i < rs.rows.length ? sourceRef(rs.rows[rs.i]) : (sourceRefEnd(st.orig) ?? -2) + 1;
        if (pos === undefined) return undefined;
        for (const n of [...rs.pending, ...rs.grp, ...rs.frags]) if (n.ref !== undefined) pos = Math.min(pos, n.ref);
        return { pos, lo: first, table };
      }
    }
    if (st.k === 'block' || st.k === 'table') {
      const r = sourceRef(st.orig);
      return r === undefined ? undefined : { pos: r, lo: -Infinity, table: Infinity };
    }
    if (st.k === 'children' && (st.phase === 'kwp' || st.phase === 'kwn')) {
      const r = sourceRef(st.children[st.at]);
      if (r !== undefined) return { pos: r, lo: -Infinity, table: Infinity };
    }
  }
  return undefined;
}

/**
 * ページごとの記録 (design/resumable-flow.md の 5.2): 1 段の page-sequence を組む間に、器の側へ書いたものを、書いたページごとに並べる。
 * ページは、そのページを作ってから次のページを作るまで (ページの境目は、その間にある: Flow.breakPage)。
 * 続きから組むとき、続ける境目より前のページの分を書き直す (組み直したときに、同じ順に書くもの)
 */
interface PageRecord {
  /** このページを作ったときの警告の数 */
  warnStart: number;
  /** 記録した id のページ (noteIdPage の引数。書いた順) */
  ids: Array<[id: string, n: number, fmt: string | undefined, page: PageBuild | undefined]>;
  /**
   * 引いたページ番号の参照と、返した値・字の書式・引いたときのページ番号 (試し組み・測る組みの中で引いたものも入る)。書式とページ番号は、
   * 前の組版から繋ぐページの参照を、この文書で引き直して同じかを確かめ、参照の記録 (SeqMemo.cites) に足すのに使う
   */
  cites: Array<[id: string, last: boolean | undefined, format: string | undefined, physical: boolean | undefined, value: string, style: ResolvedStyle | undefined, pageNumber: number | undefined]>;
}

/**
 * 前回の組版での page-sequence の結果。2 回目以降の組版 (ページ番号参照の収束) で、開始ページ・脚注の続き番号・
 * 中で参照したページ番号の値が前回と同じ sequence は、組み直さずに前回のページをそのまま使う (目次の sequence だけを組み直す)
 */
interface SeqMemo {
  first: number;
  /** この sequence の最初のページの、文書の先頭からの通し番号 (0 始まり) */
  ordinal: number;
  /** ページの左右のずれ (FlowHost.sideDelta)。前の page-sequence のページ数が変わると、番号が同じでも左右が変わる */
  sideDelta: number;
  fnCarryIn: number;
  /**
   * 参照したページ番号: 引数の鍵 → 引数と、返した値と字の書式の組のすべて (字だけ差し替えるときの計測に使う)。同じ参照でも、違う値・書式で
   * 引くことがある (1 回目の組版の仮の値は、引いたページのページ番号なので、ページごとに違う。目次と本文で書式が違う、など)。
   * seen は、uses に入れた値と書式の組の印 (同じ組を 2 度入れない)
   */
  cites: Map<string, CiteEntry>;
  built: PageBuild[];
  fnCarryOut: number;
  warnings: Diagnostic[];
  /** この sequence で記録した id のページ (組み直さないときに同じ記録を入れる) */
  idPages: Array<[string, IdPages]>;
  idPageBuild: Array<[string, PageBuild]>;
  idPageBuildLast: Array<[string, PageBuild]>;
  /**
   * 上の記録の id のうち、この sequence より前で記録していたもの (同じ id が文書に 2 度あるときなど)。その id の最初のページは、前の
   * sequence のものなので、書くときは、いまの記録の最初のページを残す。前の文書から使い回すときは、いまの文書でも、この sequence より前で
   * 記録した id が同じでなければ使い回さない (記録の順が、初めから組んだときと違う)
   */
  idBefore?: string[];
  /** この sequence で組んだ索引のページ番号の並び (組み直さないときは、いまのページで作り直しても同じ並びになることを確かめる) */
  indexLists?: Map<LIndexPageCitationList, IndexExpansion>;
  /** この sequence で、先頭から N ページで止めたので決まらなかった参照 (組み直さないときに、同じものを数える) */
  beyond?: Array<[BeyondKind, string]>;
  /** 1 段の page-sequence の組みの、境目とページごとの記録 (器の使い回しで、次の文書が前の組版と繋ぐ) */
  run?: SeqRunRecord;
  /** この sequence を組む間に、書体の組が返した可変フォントの実体 (前の文書から使い回すとき、返し直す) */
  handed?: Array<[string, LoadedFont]>;
  /** この sequence を組む間に当たった上限の名前 (limit/reached。前の文書から使い回すとき、記録し直す。当たったものは繋がない) */
  limits?: LimitName[];
  /** この sequence を組む間に、書体の知らせ (FontManager.noticeCount) が出た (前の文書から使い回さない。知らせが抜けるので) */
  notices?: boolean;
  /** 組んだときの、次の page-sequence の initial-page-number (force-page-count の白ページの数が、これで決まる。違えば使い回さない) */
  nextIpn?: LPageSequence['initialPageNumber'];
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
  private warnings: Diagnostic[] = [];
  /** 書体の組の印 (FontManager.signature。文書をまたぐ行分けの覚えの鍵。組版ごとに 1 度だけ作る) */
  private fontEnv?: string;
  /** 直前の layout() で組んだ回数 (試し組み・計測も含む。ページ番号の参照などで組み直した分も足す) */
  readonly stats: LayoutStats = { flows: 0, blocks: 0, tables: 0 };

  constructor(
    private fonts: FontManager,
    private measurer: Measurer,
    private options: LayoutOptions = {},
  ) {}

  private baseStyle(): ResolvedStyle {
    // 既定の書体名は、ファミリー名 (最初に登録した書体が斜体・幅の狭い書体でも、その書体だけを指す印は付けない)
    const first = this.fonts.all()[0];
    const fam = this.options.defaultFontFamily ?? first?.baseFamily ?? first?.family ?? 'sans-serif';
    // 可変フォントを読み込んでいれば、その軸の札 (子のスタイルの解決で、書体の名前に軸の値の指定を付ける。lnode.ts の applyVariation)
    const varAxes = this.fonts.variationAxes();
    const shapeMarks = varAxes ? this.fonts.staticShapeMarks() : undefined;
    return {
      fontFamily: fam,
      fontWeight: 400,
      italic: false,
      ...(varAxes ? { varAxes } : {}),
      ...(shapeMarks ? { shapeMarks } : {}),
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
  /** 直前の組版の、ページごとの柱など (static-content) の箱 (pagesBuilt と同じ順) */
  private passStatics: SheetStatics[] = [];
  /**
   * メモリ節約 (layoutLowMemory): 組み直しに前の回のページを使い回さず、page-sequence を組み終えたら、そのページの組版の途中の木を手放す
   */
  private lowMemory = false;
  /** メモリ節約: 2 回目からの組み直しの回で、ページを領域の木にして渡す先 (使う書体・画像を集める) */
  private lowScan?: { visit(sheet: SheetArea): void; restart(): void };
  /** メモリ節約: 収束した回を組み直して、ページを領域の木にして渡す先 */
  private replaySink?: (sheet: SheetArea) => void;
  /** 組みながら確定したページを渡す先 (layoutSheets の emit)。渡さないときは undefined */
  private emitter?: PageEmitter;
  /** 組みながら渡す状態 (layoutSheets で emitter のあるとき) */
  private emitState?: EmitState;
  /** メモリ節約: 組版 (layoutPasses) の中で組んだ回の数と、最後の回でページを lowScan に渡したか */
  private passNo = 0;
  private lastPassScanned = false;
  /** 組版 (layoutPasses) の中の組み直しの回の番号 (1 から。進み具合の pass) */
  private passIndex = 0;

  /**
   * 置くページを作った (LayoutControl.page に知らせる)。local は、組んでいる page-sequence の中でいままでに作ったページの数
   * (pagesBuilt は、この回で組み終えた page-sequence のページ)。メモリ節約の組み直し (決まった回を PDF に描くために組み直すもの) では知らせない
   */
  private notePage(local: number): void {
    const n = this.pagesBuilt.length + local;
    const max = this.options.maxPages;
    if (max !== undefined && n > max) {
      // 先頭から N ページで止める: N + 1 ページ目 (見張りのページ) は組み、N + 2 ページ目を作った所で止める。
      // 見張りのページは捨てる (進み具合にも数えない)。そのページを組む間の警告は、捨てるページのものなので、止めたときに除く
      if (n === max + 1) this.lookaheadMark = this.warnings.length;
      else {
        this.stopPass = true;
        throw PAGE_LIMIT;
      }
      return;
    }
    const c = this.options.control;
    if (c && !this.replaySink) c.page(this.passIndex, n);
  }
  /** 先頭から N ページで止める (maxPages): この回で止めたか */
  private stopPass = false;
  /** 止めたときの、組んでいた page-sequence のページの並び (layoutSequence・layoutColumnPass・forcePageCount が置く) */
  private seqBuilding: PageBuild[] = [];
  /** 見張りのページを作ったときの警告の数 (-1 なら作っていない) */
  private lookaheadMark = -1;
  /**
   * 見張りのページを作った後に出た警告のうち、見張りのページのものでないもの (page-sequence の全体の警告: 最後のページのマスターの収束)。
   * 止めたときに、見張りのページの警告を除いても残す。
   * 段組の page-sequence の組み終わりに置く脚注の溢れは、本文の後に足した脚注の続きのページ (見張りのページより後ろ) でしか出ないので、ここには入れない
   */
  private lookaheadKeep = new Set<Diagnostic>();
  /** 止めたとき: 見張りのページを作った後の警告を除く (残す 1〜N ページのもの (lookaheadKeep) は除かない) */
  private dropLookaheadWarnings(): void {
    const m = this.lookaheadMark;
    if (m < 0) return;
    const keep = this.warnings.slice(m).filter((w) => this.lookaheadKeep.has(w));
    this.warnings.length = Math.min(this.warnings.length, m);
    pushAll(this.warnings, keep);
  }
  /** 見張りのページを作った後なら、from 番目からの警告を、止めても残すもの (lookaheadKeep) にする */
  private keepLookaheadWarnings(from: number): void {
    if (this.lookaheadMark < 0) return;
    for (let k = Math.max(from, this.lookaheadMark); k < this.warnings.length; k++) this.lookaheadKeep.add(this.warnings[k]);
  }
  /**
   * 止めた回の、N ページより後ろにある id (最初に置かれたページが後ろか、置かれていない) と、後ろへ続く id (最後のページが後ろ)。
   * 止めなかった回は undefined
   */
  private cutInfo: { first: Set<string>; last: Set<string> } | undefined;
  /** 前の回の cutInfo (ページ番号の参照の値を引くときに使う。citations と同じ回のもの) */
  private citeCut: { first: Set<string>; last: Set<string> } | undefined;
  /** この回で、N ページより後ろを指して決まらなかったもの (種類と id) */
  private beyondHits: Array<[BeyondKind, string]> = [];
  /** 文書の中の id (入力の節の id。止めたときに、後ろにある id と、文書に無い id を見分ける) */
  private docIdSet: Set<string> | undefined;
  private docIds(): Set<string> {
    if (!this.docIdSet) {
      this.docIdSet = new Set();
      for (const n of this.docNodes) {
        const id = (n as { id?: unknown }).id;
        if (typeof id === 'string') this.docIdSet.add(id);
      }
    }
    return this.docIdSet;
  }
  /** 決まらない参照の字 ("?"。WeasyPrint の組み方では空。LDocument.unresolvedCitationEmpty) */
  private unresolvedMark = '?';
  /** 直前の組版を、先頭から N ページで止めたか (止めたら N。TypesetResult.truncated) */
  get truncatedAt(): number | undefined {
    return this.cutInfo ? this.options.maxPages : undefined;
  }
  /** メモリ節約: ページを領域の木にするときの、書体・字形の番号を付けるもの (組版ごと) */
  private lowResources?: ReturnType<typeof resourceAttacher>;

  /** id を持つ要素が、番号 n (書式 fmt) のページに置かれたことを記録する。最初のページは初回だけ、最後のページは毎回更新 */
  private noteIdPage(id: string, n: number, fmt: string | undefined, page?: PageBuild) {
    const recs = this.pageRecs;
    if (recs?.length) recs[recs.length - 1].ids.push([id, n, fmt, page]);
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
   * 鍵の付いた所の、領域のある最初と最後のページ (XSL 1.1 §6.10.6: その formatting object の返した領域を子孫に
   * 持つページごとに、引くページの項目を作る。範囲は、始まりの印のページから終わりの印のページまで)。まだ置いていなければ undefined
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
  private buildIndexList(list: LIndexPageCitationList, view: IndexView, warn?: (m: Diagnostic) => void): IndexExpansion {
    const perRef = list.references.map((r, k) => {
      const entries = this.indexKeys?.get(r.refKey);
      // 鍵の付いた formatting object が 1 つも無いのは誤りで、その fo:index-key-reference を無視して続ける (§6.10.6)
      if (!entries) {
        warn?.(diag('layout/index-key-missing', msg(`索引の鍵 "${r.refKey}" (ref-index-key) の付いた所がありません`, `no formatting object has the index key "${r.refKey}" (ref-index-key)`), { key: r.refKey }));
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
  private expandIndex(run: InlineChild[], warn: (m: Diagnostic) => void): InlineChild[] {
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
        pushAll(out, ex.nodes);
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
  /** ページの左右を、ページの順で決める文書か (LDocument.pageSidesByOrder) */
  private sidesByOrder = false;
  /** ページが右から左へ進む本か (LDocument.rtlPageProgression。奇数ページの綴じ側が右) */
  private rtlPages = false;
  /** 最初のページの左右を逆にする分 (LDocument.firstPageSideShift) */
  private sideShift = 0;
  /** いま組んでいる page-sequence の、ページの左右のずれ (FlowHost.sideDelta) */
  private sideDelta = 0;
  /** いま組んでいる page-sequence の前にあるページの数 (:nth() の文書の先頭からのページの順。PageMasterCondition.nth) */
  private seqOrdinal = 0;
  private lastFoot?: FootnoteCtx;
  /** 前回の組版での page-sequence ごとの結果 (layoutPasses の中でだけ使う) */
  private seqMemo: Array<SeqMemo | undefined> = [];
  /** 前の文書の組版 (LayoutReuse.prev。この文書と書体・選択肢・画像・文書の欄が同じときだけ) と、この文書の指紋 (覚えるとき) */
  private reusePrev?: PrevLayout;
  private reuseNow?: Omit<PrevLayout, 'seqs' | 'cost' | 'hit'> & { prints: string[] };
  /** 前の文書とこの文書の入力の節の番号の対応 (前の文書を使えるときだけ) */
  private reuseMapCache?: ReuseMap | null;
  /** 前の文書とこの文書の、入力の節の番号の対応 (要る所で初めて作る。節の指紋を作る手間を、中身の同じ文書では省く) */
  private get reuseMap(): ReuseMap | undefined {
    if (this.reuseMapCache === undefined) {
      const prev = this.reusePrev;
      const now = this.reuseNow;
      this.reuseMapCache = prev && now && this.docNodes && prev.nodes.length ? diffShapes(prev.shapes(), now.shapes()) : null;
    }
    return this.reuseMapCache ?? undefined;
  }
  /** 組む手間の上限の数えの、この文書の回ごとの最大と、上限に当たったか (PrevLayout.cost・hit) */
  private reuseCost = { cost: 0, hit: false };
  /**
   * 前の文書の効果 (入力の節の paintEffect) → この文書の同じ節の効果。使い回すページの箱の効果 (LNode.fx) を、この文書の物に替える
   * (PDF の書き手は、効果を物ごとに書くので、前の文書の物のままだと、同じ値の効果を 2 つ書く)
   */
  private reuseFx?: Map<object, PaintEffect>;
  private swapFx(n: LNode, seen = new Set<LNode>()) {
    if (!this.paintEffects || !this.reusePrev || seen.has(n)) return;
    seen.add(n);
    if (!this.reuseFx) {
      const m = new Map<object, PaintEffect>();
      const old = this.reusePrev.nodes;
      const nodes = this.docNodes ?? [];
      const map = this.reuseMap;
      old.forEach((o, r) => {
        const fx = (o as { paintEffect?: PaintEffect }).paintEffect;
        const nr = map ? mapRef(map, r) : undefined;
        const nfx = nr === undefined ? undefined : (nodes[nr] as { paintEffect?: PaintEffect } | undefined)?.paintEffect;
        if (fx && nfx) m.set(fx, nfx);
      });
      this.reuseFx = m;
    }
    if (n.fx) n.fx = this.reuseFx.get(n.fx) ?? n.fx;
    for (const c of n.children) this.swapFx(c, seen);
  }
  /** 前の文書とこの文書の、入力の節の欄の配列の持ち主 (境目の状態を比べるときに作る) */
  private reuseOwnerMaps?: { old: ArrayOwners; now: ArrayOwners };
  /** この文書の入力の節の欄の配列の持ち主 (同じ文書の前の回の組みと繋ぐとき。SpliceTarget.within) */
  private withinOwners?: ArrayOwners;
  private reuseOwners(): { old: ArrayOwners; now: ArrayOwners } | undefined {
    if (!this.reuseOwnerMaps && this.reusePrev && this.docNodes) this.reuseOwnerMaps = { old: arrayOwners(this.reusePrev.nodes), now: arrayOwners(this.docNodes) };
    return this.reuseOwnerMaps;
  }
  /** 前の文書から使い回した page-sequence (組み直しの回の間は、文書の中の seqMemo で使い回す) */
  private foreignSeqs = new Set<number>();
  /** Typesetter が覚えるとき: 組み直しの 1 回目の page-sequence ごとの記録 (storeReuse が覚える) と、2 回目からの字の差し替えの戻し方 */
  private passOneMemo?: Array<SeqMemo | undefined>;
  private citeUndo?: CiteUndo;
  /** 組んでいる文書 (passSteps が置く) */
  private lastDoc?: LDocument;
  /** 行分けの結果の覚えの、覚えている量と古さの順 (組版 (layout) ごと) */
  private lineMemoLru = new LineMemoLru(LINE_MEMO_ATOMS);
  /** いま組んでいる sequence の中で参照したページ番号 (cite の引数 → 返した値) */
  private citeLog?: SeqMemo['cites'];
  /** 組んでいる 1 段の page-sequence の、ページごとの記録 (layoutSequence が置く。ほかの所では undefined) */
  private pageRecs?: PageRecord[];

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
   * 前の回を先頭から N ページで止めたとき (citeCut)、その参照が N ページより後ろを指すか (決まらない参照にするもの): 総ページ数、
   * N ページより後ろにある id の最初のページ、N ページより後ろへ続く id の最後のページ (page-number-citation-last)、N ページまでに置かれなかった文書の id
   */
  private citeBeyond(id: string, last: boolean | undefined): boolean {
    const cut = this.citeCut;
    return !!cut && !!this.citations && (id === TOTAL_PAGES_ID || cut.first.has(id) || (last && cut.last.has(id)) || (!this.citations.has(id) && this.docIds().has(id)));
  }

  /**
   * ページ番号の参照の値と書式の組の印 (SeqMemo.cites の seen)。字の計測と描き方に効く書式の欄を並べる。
   * 印が同じになる違う書式があっても、reuseCites は字の節がどの組のものかを描き方で確かめ、確かめられなければ組み直すので、結果は変わらない
   */
  private citeMark(v: string, st: ResolvedStyle | undefined): string {
    if (!st) return `${v}\u0000`;
    return `${v}\u0000${st.fontFamily}\u0000${st.fontWeight}\u0000${st.fontSize}\u0000${st.fontStretch}\u0000${st.fontFeatures?.join(',') ?? '-'}\u0000${st.textOrientation}\u0000${st.fontOpticalSizeUnit ?? ''}\u0000${st.wm}\u0000${st.color}\u0000${st.letterSpacing}\u0000${st.xslLetterSpacing ? 1 : 0}${st.kerning ? 1 : 0}${st.italic ? 1 : 0}${st.synthesizeStyle === false ? 1 : 0}${st.synthesizeWeight === false ? 1 : 0}\u0000${st.fontPalette ? JSON.stringify(st.fontPalette) : ''}`;
  }

  /**
   * 前回の sequence で参照したページ番号が、今回も同じ値か。違う参照があっても、組み直したときと同じ結果になると確かめられれば
   * (字数が同じ・字ごとの書体と送りが同じ・字の種類 (改行・和欧間のアキ・字間の決まりで見る種類) が同じ・字の組の詰めに加わらない)、
   * 前回のページの字 (LNode.cite の印の付いた字形の節) だけを、組み直したときと同じ字の節に差し替えて同じとみなす。
   * 確かめられなければ false (組み直す)。
   * 字の節は、参照 1 つ分ずつ (行の中の、続く同じ印の節の並び) に、どの値と書式で組んだものかを描き方で照らしてから差し替える
   * (1 回目の組版の仮の値はページごとに違い、桁数の違う値が 1 つの sequence に混じる)。途中で止めるときは、何も書き換えない
   */
  private reuseCites(memo: SeqMemo): boolean {
    // 前の回を先頭から N ページで止めたとき、N ページより後ろを指す参照 (citeBeyond) は、決まらない参照の字 (「?」など) にして警告を出すので、
    // 前の回のページを使い回さずに組み直す (使い回すと、前の回の値か、N ページより後ろのページの数を、警告なしに組む)
    if (this.citeCut) for (const c of memo.cites.values()) if (this.citeBeyond(c.args[0], c.args[1])) return false;
    // 字の種類: 置き換えても、改行の機会 (UAX #14)・和欧間のアキ (JLREQ §3.2)・字間 (XSL 1.1 §7.17.2 の Alphabetic) の決まりが変わらない字の組。
    // ページ番号の書式 (pageNumber.ts の formatToken) の数字・全角の数字・漢数字は、それぞれの中で置き換えられる。ほかの字 (ローマ数字・アルファベットは、
    // 合字・分綴・字の組の詰めが字で変わる) は、同じ字のときだけ
    const charClass = (c: string) => (/^[0-9]$/.test(c) ? '0' : /^[\uFF10-\uFF19]$/.test(c) ? '\uFF10' : /^[〇一二三四五六七八九十百千]$/.test(c) ? '〇' : c);
    // 字の描き方の中身が同じか (inlineLayout.ts の internGlyph と同じ欄)
    const samePayload = (a: GlyphPayload, b: GlyphPayload) =>
      a.text === b.text && a.fontFamily === b.fontFamily && a.fontWeight === b.fontWeight && a.fontSize === b.fontSize && a.color === b.color && a.baselineX === b.baselineX && a.baselineY === b.baselineY &&
      a.rotation === b.rotation && a.scaleX === b.scaleX && a.advance === b.advance && !a.italic === !b.italic && !a.fakeBold === !b.fakeBold && (a.features?.join(',') ?? '') === (b.features?.join(',') ?? '') && a.fontPalette === b.fontPalette;
    const plan = new Map<string, { cps: string[]; value: string; byText: Map<string, CiteValueUse[]> }>();
    for (const [key, c] of memo.cites) {
      const found = this.citeValue(...c.args);
      const nv = found ?? '?';
      if (c.uses.every((u) => u.value === nv)) continue;
      // 参照先が無くなった (組み直すと、警告を出して「?」か空にする)
      if (found === undefined) return false;
      const newCps = [...nv];
      const byText = new Map<string, CiteValueUse[]>();
      for (const u of c.uses) {
        const st = u.style;
        if (!st) return false;
        const oldCps = [...u.value];
        if (oldCps.length !== newCps.length) return false;
        const texts: string[] = [];
        for (let k = 0; k < oldCps.length; k++) {
          const og = this.measurer.glyph(oldCps[k], runStyleOf(st), st.wm);
          texts.push(og.vertical?.glyph ?? og.draw ?? oldCps[k]);
          if (oldCps[k] === newCps[k]) continue;
          if (charClass(oldCps[k]) !== charClass(newCps[k])) return false;
          // 字の組の詰め (inlineLayout.ts の adjustJapaneseSpacing。CSS Fonts 4 §6.3 の font-kerning) は前後の字で決まるので、詰めに加わりうる字は置き換えない
          if (st.kerning && (kernablePair(oldCps[k], oldCps[k]) || kernablePair(newCps[k], newCps[k]))) return false;
          const ng = this.measurer.glyph(newCps[k], runStyleOf(st), st.wm);
          if (og.advance !== ng.advance || og.font !== ng.font || og.scaleX !== ng.scaleX || og.vertical?.mode !== ng.vertical?.mode || og.naturalWidth !== ng.naturalWidth) return false;
        }
        const tk = texts.join('\u0000');
        let a = byText.get(tk);
        if (!a) byText.set(tk, (a = []));
        a.push(u);
      }
      plan.set(key, { cps: newCps, value: nv, byText });
    }
    if (!plan.size) return true;
    // 印の付いた字形の節を、参照 1 つ分ずつ集める: 参照の字は、前後と別の字の並び (inlineFlatten.ts の flattenCitation) なので、行の中で
    // 1 つの行内の箱に入る (inlineLayout.ts の lineToNode)。行をまたいで分かれた参照は、字数が合わないので組み直す
    const groups: Array<{ key: string; nodes: LNode[] }> = [];
    const walk = (n: LNode) => {
      let cur: { key: string; nodes: LNode[] } | undefined;
      for (const ch of n.children) {
        if (ch.cite !== undefined && ch.glyph && plan.has(ch.cite)) {
          if (cur && cur.key === ch.cite) cur.nodes.push(ch);
          else groups.push((cur = { key: ch.cite, nodes: [ch] }));
        } else cur = undefined;
        walk(ch);
      }
    };
    for (const p of memo.built) {
      walk(p.root);
      for (const a of p.abs) walk(a);
    }
    const seenKeys = new Set(groups.map((g) => g.key));
    for (const key of plan.keys()) if (!seenKeys.has(key)) return false;
    // 参照 1 つ分ごとに、どの値と書式で組んだ字かを、その値と書式で作り直した字の節と照らして決め、組み直したときの字の節 (inlineLayout.ts の
    // glyphNode) を用意する。照らせないものが 1 つでもあれば組み直す
    const swaps: Array<[LNode, GlyphPayload]> = [];
    for (const { key, nodes } of groups) {
      const { cps, byText } = plan.get(key)!;
      if (nodes.length !== cps.length) return false;
      const cands = byText.get(nodes.map((n) => n.glyph!.text).join('\u0000'));
      let made: GlyphPayload[] | undefined;
      for (const u of cands ?? []) {
        const st = u.style!;
        const oldCps = [...u.value];
        // 字間は、字の送りに足す (inlineFlatten.ts の flattenText と同じ足し方。XSL の字間は送りの外で、字の節には入らない)
        const ls = st.letterSpacing && !st.xslLetterSpacing ? st.letterSpacing : 0;
        const out: GlyphPayload[] = [];
        for (let k = 0; k < nodes.length && out.length === k; k++) {
          const n = nodes[k];
          const og = this.measurer.glyph(oldCps[k], runStyleOf(st), st.wm);
          const withSpacing = (g: typeof og) => {
            if (ls) {
              g.advance += ls;
              g.spacing = (g.spacing ?? 0) + ls;
            }
            return g;
          };
          const was = glyphNode(withSpacing(og), st, n.wm, oldCps[k], st.fontSize, st.color);
          if (!samePayload(was.glyph!, n.glyph!) || was.isize !== n.isize || was.bsize !== n.bsize) break;
          const now = glyphNode(withSpacing(this.measurer.glyph(cps[k], runStyleOf(st), st.wm)), st, n.wm, cps[k], st.fontSize, st.color);
          if (now.isize !== n.isize || now.bsize !== n.bsize) break;
          out.push(now.glyph!);
        }
        if (out.length === nodes.length) {
          made = out;
          break;
        }
      }
      if (!made) return false;
      nodes.forEach((n, k) => swaps.push([n, made![k]]));
    }
    // 字の描き方は、同じ中身の字で共有している (inlineLayout.ts の internGlyph) ので、書き換えずに、作り直したものに替える
    // 行末の印 (分綴で足した字・行末で捨てた空白。inlineLayout.ts の buildLineNode) は、字の描き方の中身と別に、元の節のものを残す
    const undo = this.citeUndo;
    if (undo) for (const [n] of swaps) if (!undo.glyphs.has(n)) undo.glyphs.set(n, n.glyph!);
    for (const [n, g] of swaps) n.glyph = n.glyph!.hyphen || n.glyph!.breakSpace !== undefined ? { ...g, ...(n.glyph!.hyphen ? { hyphen: true } : {}), ...(n.glyph!.breakSpace !== undefined ? { breakSpace: n.glyph!.breakSpace } : {}) } : g;
    for (const [key, { value }] of plan) {
      const c = memo.cites.get(key)!;
      const uses = c.uses;
      if (undo && !undo.cites.has(c)) undo.cites.set(c, { uses, seen: c.seen });
      c.uses = [];
      c.seen = new Set();
      for (const u of uses) {
        const mark = this.citeMark(value, u.style);
        if (c.seen.has(mark)) continue;
        c.seen.add(mark);
        c.uses.push({ value, style: u.style });
      }
    }
    return true;
  }

  /** id のページの記録の写し (sequence の前後で比べて、その sequence で記録したものを取り出す) */
  private snapshotIds() {
    return { pages: new Map([...this.idPages].map(([k, v]) => [k, { ...v }] as [string, IdPages])), build: new Map(this.idPageBuild), last: new Map(this.idPageBuildLast) };
  }
  private idDiff(before: ReturnType<LayoutEngine['snapshotIds']>): Pick<SeqMemo, 'idPages' | 'idPageBuild' | 'idPageBuildLast' | 'idBefore'> {
    const same = (a: IdPages | undefined, b: IdPages) => !!a && a.first === b.first && a.last === b.last && a.firstN === b.firstN && a.lastN === b.lastN && a.firstP === b.firstP && a.lastP === b.lastP;
    const idPageBuildLast = [...this.idPageBuildLast].filter(([k, v]) => before.last.get(k) !== v);
    // この sequence で置いた id (noteIdPage はページを渡すので、最後のページの物が替わる) は、値が前と同じでも記録に入れる
    // (同じ id の 2 度目が、前の sequence の 1 度目と同じ番号のページにあるとき。使い回すときに書かないと、前の文書の値が残る)
    const placed = new Set(idPageBuildLast.map(([k]) => k));
    const d = {
      idPages: [...this.idPages].filter(([k, v]) => placed.has(k) || !same(before.pages.get(k), v)).map(([k, v]) => [k, { ...v }] as [string, IdPages]),
      idPageBuild: [...this.idPageBuild].filter(([k, v]) => before.build.get(k) !== v),
      idPageBuildLast,
    };
    const had = new Set<string>();
    for (const list of [d.idPages, d.idPageBuild, d.idPageBuildLast]) for (const [k] of list) if (before.pages.has(k) || before.build.has(k)) had.add(k);
    return had.size ? { ...d, idBefore: [...had] } : d;
  }

  /**
   * sequence の記録 memo の id のページを、いまの記録に書く (その sequence を組んだときに noteIdPage が書くのと同じ結果にする)。
   * この sequence より前で記録していた id (memo.idBefore) は、最初のページをいまの記録のまま残し、最後のページだけを書く
   */
  private writeMemoIds(memo: SeqMemo) {
    const had = new Set(memo.idBefore);
    for (const [k, v] of memo.idPages) {
      const cur = had.has(k) ? this.idPages.get(k) : undefined;
      this.idPages.set(k, cur ? { ...v, first: cur.first, firstN: cur.firstN, firstP: cur.firstP } : { ...v });
    }
    for (const [k, v] of memo.idPageBuild) if (!had.has(k) || !this.idPageBuild.has(k)) this.idPageBuild.set(k, v);
    for (const [k, v] of memo.idPageBuildLast) this.idPageBuildLast.set(k, v);
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
    const made = this.gradientNames;
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
  /**
   * グラデーションの背景の鍵 → 登録した画像の名前 (組版 (layoutPasses) ごと)。ページを 1 枚ずつ領域の木にするとき (layoutSheets) も、
   * 文書全体を 1 度に登録したときと同じ名前 (通し番号) になるように、呼ぶたびに作り直さない
   */
  private gradientNames = new Map<string, string>();
  /** 前回 registerGradients を呼んだときの gradientsMade */
  private gradientsSeen = 0;

  /**
   * 用紙の背景画像の大きさ。background-size の百分率は、位置の基準の領域 (W × H) に対して (CSS Backgrounds 3 §2.9)。
   * 領域を渡さないとき (XSL-FO のページの背景) は、百分率を読まず、画像本来の大きさにする (これまでどおり)
   */
  private sheetBackgroundImage(bi: BackgroundImage, W?: number, H?: number): { backgroundImage?: BackgroundImage & { width: number; height: number } } {
    const asset = this.options.assets?.get(bi.src);
    if (!asset) return {};
    const nw = asset.width * 0.75;
    const nh = asset.height * 0.75;
    const w = bi.width ?? (bi.height !== undefined ? (bi.height * nw) / nh : nw);
    const h = bi.height ?? (bi.width !== undefined ? (bi.width * nh) / nw : nh);
    if (W === undefined || H === undefined) return { backgroundImage: { ...bi, width: w, height: h } };
    return { backgroundImage: percentImage({ ...bi, width: w, height: h, ...(bi.widthPct !== undefined || bi.heightPct !== undefined ? { aspect: nw / nh } : {}) }, W, H) };
  }

  /** ページ領域 box に重ねる背景 (PageMaster.rootBackground)。画像の大きさ・グラデーションは、ページ領域で決める */
  private sheetRootBackground(rb: NonNullable<PageMaster['rootBackground']>, box: SheetArea['trimBox']): NonNullable<SheetArea['rootBackground']> {
    const img = rb.backgroundImage ? (rb.backgroundImage.gradient ? gradientImage(rb.backgroundImage, box.width, box.height) : this.sheetBackgroundImage(rb.backgroundImage, box.width, box.height).backgroundImage) : undefined;
    return { box, ...(rb.backgroundColor ? { backgroundColor: rb.backgroundColor } : {}), ...(img ? { backgroundImage: img } : {}) };
  }

  layout(doc: LDocument): AreaTree {
    this.beginLayout();
    return this.endLayout(doc, this.layoutPasses(doc));
  }

  /** layout と同じ組版を、組み直しの回と page-sequence の境目で control.boundary を待ちながら組む (止める合図・進み具合を渡したとき) */
  async layoutPaced(doc: LDocument): Promise<AreaTree> {
    this.beginLayout();
    return this.endLayout(doc, rejoin(thisCall(), await this.passesPaced(doc)));
  }

  private beginLayout(): void {
    this.fontEnv = undefined;
    this.lineMemoLru = new LineMemoLru(this.options.lineMemoAtoms ?? LINE_MEMO_ATOMS);
    this.stats.flows = this.stats.blocks = this.stats.tables = 0;
    this.stats.nestMax = this.stats.columnNestMax = 0;
    this.stats.sharedLineHits = 0;
  }

  private endLayout(doc: LDocument, unsettled: Diagnostic[]): AreaTree {
    const tree = this.finishTree(doc);
    this.storeReuse(doc);
    // 前の文書の組版は、次の文書が覚えから引かないように手放す (この文書の記録の閉包がこの器を指すので、持ったままだと、文書が鎖のように残る)
    this.reusePrev = undefined;
    this.reuseMapCache = undefined;
    this.reuseOwnerMaps = undefined;
    this.withinOwners = undefined;
    this.reuseFx = undefined;
    limitTap.fn = undefined;
    addTreeDiagnostics(tree, this.kept(unsettled));
    this.stats.lineMemoPeak = this.lineMemoLru.peak;
    this.stats.lineMemoHits = this.lineMemoLru.hits;
    // 使う書体・画像の一覧と、字の字形の番号を付ける (木だけで描くための情報)
    attachResources(tree, this.fonts, this.options.assets);
    return tree;
  }

  /**
   * 文書を組み、ページを 1 枚ずつ領域の木にできる形で返す (layout と同じ組版。文書全体の領域の木を、1 度に持たない)。
   * PDF をページごとに書いて、書いたページを手放す使い方のためのもの (api.ts の typesetToPdf)。
   * sheet(i) は、layout の返す木の sheets[i] と同じページを作る (字の書体・字形の番号を付け、グラデーション・描く効果を当てたもの)。
   * 同じページを何度作ってもよい。release(i) の後は、そのページを作れない。finish は、作ったページの後で、文書の情報 (しおり・飛び先・警告) を返す
   */
  layoutSheets(doc: LDocument, emit?: PageEmitter): SheetSource {
    this.beginSheets(doc, emit);
    try {
      return this.endSheets(doc, this.layoutPasses(doc));
    } finally {
      this.emitter = undefined;
    }
  }

  /** layoutSheets と同じ組版を、境目で control.boundary を待ちながら組む (layoutPaced と同じ) */
  async layoutSheetsPaced(doc: LDocument, emit?: PageEmitter): Promise<SheetSource> {
    this.beginSheets(doc, emit);
    try {
      return this.endSheets(doc, rejoin(thisCall(), await this.passesPaced(doc)));
    } finally {
      this.emitter = undefined;
    }
  }

  private beginSheets(doc: LDocument, emit: PageEmitter | undefined): void {
    this.fontEnv = undefined;
    this.lineMemoLru = new LineMemoLru(this.options.lineMemoAtoms ?? LINE_MEMO_ATOMS);
    this.stats.flows = this.stats.blocks = this.stats.tables = 0;
    this.stats.nestMax = this.stats.columnNestMax = 0;
    // 組みながら確定したページを渡す (design/pdf-writer.md の 12)。渡したページは組版の途中の木を手放すので、組み直しの確認 (resumeCheck)・
    // 先頭から N ページで止める組版 (見張りのページを捨てる)・索引 (並びが後ろのページで決まる) では渡さない
    const probe = (this.options.resumeCheck ?? resumeProbe.check) || (resumeProbe.late ?? 0) > 0;
    this.emitter = emit && !probe && this.options.maxPages === undefined && !doc.indexEntries?.length ? emit : undefined;
    this.emitState = this.emitter
      ? { done: 0, stopped: false, unsafeAt: Infinity, staticUnresolved: false, inStatics: false, seq: false, seqDone: 0, pages: [], staticWarnings: [], lineCount: new Map(), resources: resourceAttacher(this.fonts, this.options.assets), ...(emitProbe.keep ? { kept: [] } : {}) }
      : undefined;
  }

  private endSheets(doc: LDocument, unsettled: Diagnostic[]): SheetSource {
    this.stats.lineMemoPeak = this.lineMemoLru.peak;
    this.stats.lineMemoHits = this.lineMemoLru.hits;
    const pages = this.pagesBuilt;
    const statics = this.passStatics;
    this.passStatics = [];
    const e = this.emitState;
    this.emitState = undefined;
    // 渡したページと同じ物で、残りのページのフォント・字形の番号を付ける
    const resources = e?.resources ?? resourceAttacher(this.fonts, this.options.assets);
    const emitted = e?.done ?? 0;
    if (e?.kept) {
      // 確認: 渡したときの領域の木と、組み終えたページから作り直した領域の木を比べる
      emitProbe.emitted += emitted;
      for (let i = 0; i < emitted; i++) {
        const json = JSON.stringify(this.buildSheet(pages[i], e.kept[i].statics));
        if (json !== e.kept[i].json) emitProbe.mismatches.push(`${doc.title ?? doc.info?.title ?? ''} page ${i + 1}`);
      }
    }
    const released = new Set<number>();
    return {
      count: pages.length,
      emitted,
      truncatedAt: this.truncatedAt,
      title: doc.title ?? doc.info?.title,
      info: doc.info,
      structure: areaStructure(doc, this.docNodes),
      sheet: (i) => {
        if (released.has(i) || i < emitted) throw new Error(`page ${i} was released`);
        // finishTree と同じ順: 領域にする → グラデーション → 描く効果 → 書体・字形の番号 (layout の attachResources)
        const sheet = this.buildSheet(pages[i], statics[i]);
        this.registerGradients([sheet]);
        if (this.paintEffects) applyPaintEffects([sheet], this.paintEffects);
        resources.visit(sheet);
        return sheet;
      },
      release: (i) => {
        if (i < emitted) return;
        released.add(i);
        releasePage(pages[i]);
        statics[i] = { nodes: [], wm: statics[i].wm };
      },
      finish: () => {
        return withUnsettled(this.treeInfo(doc, pages), this.kept(unsettled));
      },
    };
  }

  /**
   * 文書を、組版の途中の木を持ち続けずに組み、ページを順に領域の木にして渡す (メモリ節約。api.ts の typesetToPdf の lowMemory)。
   * layoutSheets と同じページを作るが、組み直しの回で前の回のページを使い回さない (page-sequence を組み終えたら、そのページの組版の途中の木を手放す)。
   * そのため、ページを領域の木にするには、組み直しの回を終えた後で、もう 1 度組む。手間は、組み直しの回の数 + 1 回 (1 回で決まる文書は + 2 回)。
   * scan は、組み直しの回を組み、ページを順に visit に渡す (2 回目からの回で渡す。決まらずに次の回を組むときは、restart を呼んでから渡し直す。
   * 1 回で決まった文書は、もう 1 度組んで渡す)。paint は、決まった回をもう 1 度組み、ページを順に渡す。finish は、paint の後で、
   * しおり・文書内リンクの飛び先・警告を返す
   */
  layoutLowMemory(doc: LDocument): LowMemorySheets {
    this.fontEnv = undefined;
    const engine = this;
    let unsettled: Diagnostic[] = [];
    let layoutMs = 0;
    const replay = (visit: (sheet: SheetArea) => void) => {
      this.replaySink = visit;
      try {
        this.layoutOnce(doc);
      } finally {
        this.replaySink = undefined;
      }
    };
    return {
      title: doc.title ?? doc.info?.title,
      info: doc.info,
      // 構造の表は、入力の節の並び (組版の番号と同じ並び) から作る (組む前に決まる)
      structure: areaStructure(doc),
      get count() {
        return engine.pagesBuilt.length;
      },
      get truncatedAt() {
        return engine.truncatedAt;
      },
      get layoutMs() {
        return layoutMs;
      },
      scan: (visit, restart) => {
        this.lineMemoLru = new LineMemoLru(this.options.lineMemoAtoms ?? LINE_MEMO_ATOMS);
        this.stats.flows = this.stats.blocks = this.stats.tables = 0;
        this.stats.nestMax = this.stats.columnNestMax = 0;
        this.lowMemory = true;
        this.lowResources = resourceAttacher(this.fonts, this.options.assets);
        this.lowScan = { visit, restart };
        this.passNo = 0;
        this.lastPassScanned = false;
        const t0 = Date.now();
        try {
          unsettled = this.layoutPasses(doc);
        } finally {
          this.lowScan = undefined;
        }
        layoutMs = Date.now() - t0;
        this.stats.lineMemoPeak = this.lineMemoLru.peak;
        this.stats.lineMemoHits = this.lineMemoLru.hits;
        // 1 回目で決まった文書: 1 回目は総ページ数が分からないので渡していない。決まった回をもう 1 度組んで渡す
        if (!this.lastPassScanned) {
          restart();
          replay(visit);
        }
      },
      paint: (visit) => replay(visit),
      finish: () => {
        const info = this.treeInfo(doc, this.pagesBuilt);
        this.lowMemory = false;
        this.lowResources = undefined;
        return withUnsettled(info, this.kept(unsettled));
      },
    };
  }

  /** メモリ節約: ページを領域の木にする (layoutSheets の sheet と同じ順: 領域にする → グラデーション → 描く効果 → 書体・字形の番号) */
  private lowSheet(p: PageBuild, statics: SheetStatics): SheetArea {
    const sheet = this.buildSheet(p, statics);
    this.registerGradients([sheet]);
    if (this.paintEffects) applyPaintEffects([sheet], this.paintEffects);
    this.lowResources!.visit(sheet);
    return sheet;
  }

  /** 描くときだけの効果 (transform・opacity) を持つ入力の節 (layoutPasses が集め、組み終えた Area に付ける) */
  private paintEffects: PaintEffectEntry[] | undefined;
  /** 入力の節 (番号の順) と、絶対配置の基準になる行内の箱の番号の範囲 (使うときに 1 度だけ作る) */
  private docNodes: readonly object[] = [];
  private inlineCbRanges: Map<number, [number, number]> | undefined;
  private inlineCbRange(key: number): [number, number] | undefined {
    if (!this.inlineCbRanges) {
      this.inlineCbRanges = new Map();
      this.docNodes.forEach((n, k) => {
        const ck = (n as { cbKey?: unknown }).cbKey;
        // 子孫の節は、番号の順で、その節のすぐ後ろに並ぶ (深さ優先・前順)
        if (typeof ck === 'number' && !this.inlineCbRanges!.has(ck)) this.inlineCbRanges!.set(ck, [k, k + documentNodes(n as LDocument).length]);
      });
    }
    return this.inlineCbRanges.get(key);
  }

  /**
   * 文書を、ページ番号の参照・脚注の番号・索引の並びが決まるまで組み直す (領域の木にはしない: finishTree・layoutSheets)。
   * 返すのは、決まらなかったときの警告 (領域の木の警告の終わりに足すもの)
   */
  private layoutPasses(doc: LDocument): Diagnostic[] {
    return runSteps(this.reportResume(this.passSteps(doc)));
  }

  /** 組版を終えたら、境目の数え (LayoutStats.resume) を試験の口 (resumeProbe.onStats) に渡す */
  private *reportResume(steps: Generator<void, Diagnostic[]>): Generator<void, Diagnostic[]> {
    const r = yield* steps;
    if (this.stats.resume) resumeProbe.onStats?.(this.stats.resume);
    return r;
  }

  /** layoutPasses を、境目で control.boundary を待ちながら走らせる (control が無ければ同期のまま) */
  private passesPaced(doc: LDocument): Promise<Diagnostic[]> {
    const c = this.options.control;
    return c ? runPaced(this.reportResume(this.passSteps(doc)), () => c.boundary()) : Promise.resolve(this.layoutPasses(doc));
  }

  /** layoutPasses の中身 (組み直しの回と page-sequence の境目で yield する) */
  private *passSteps(doc: LDocument): Generator<void, Diagnostic[]> {
    this.passIndex = 0;
    this.stats.resume = undefined;
    // 入力の節に通し番号を付ける (Area の sourceRef)
    // 描くときだけの効果 (transform・opacity) を持つ節 (無い文書では undefined。組んだ後で Area に付ける)
    const docNodes = indexDocument(doc);
    this.paintEffects = collectPaintEffects(docNodes);
    this.gradientNames = new Map();
    this.docNodes = docNodes;
    this.docIdSet = undefined;
    this.citeCut = undefined;
    this.unresolvedMark = doc.unresolvedCitationEmpty ? '' : '?';
    this.inlineCbRanges = undefined;
    paintEffectState.on = !!this.paintEffects;
    this.seqMemo = [];
    this.lastDoc = doc;
    this.setupReuse(doc);
    // 前の文書の組版を再利用できるとき (Typesetter が typeset でキャッシュした文書) は、再利用して組み、組みながらページを渡さない
    // (再利用するページは前の文書の木で、渡したページを手放す決まりと両立しない)
    if (this.reusePrev) this.emitter = this.emitState = undefined;
    this.passOneMemo = undefined;
    this.citeUndo = this.reuseNow ? { glyphs: new Map(), cites: new Map() } : undefined;
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
    // 組み直しの回の結果は、ページの論理の木 (PageBuild) までにして、領域の木 (Area) にするのは収束した回だけにする (finishTree)。
    // 収束の判定は、ページの数と、組んだ中で記録した id のページ・脚注・索引の並びだけを見るので、途中の回の領域の木は要らない
    // (毎回作ると、前の回の領域の木を持ったまま次の回を組むので、数千ページの文書で、文書全体の木を 3 つ同時に持っていた)
    yield* this.onceSteps(doc);
    // 覚えるのは、組み直しの 1 回目の記録 (次の文書の 1 回目と比べる。2 回目からの回で組み直した page-sequence の、1 回目のページも持つ)
    if (this.reuseNow) this.passOneMemo = [...this.seqMemo];
    let indexView: IndexView | undefined;
    // 索引の並びが、組み終えたページで作り直しても同じなら、索引は収束している (索引の無い文書は、いつも true)
    const indexDone = () => !this.indexUsed.size || this.indexSettled((indexView = this.indexSnapshot()));
    for (let pass = 0; pass < 4 && (this.citationUsed || this.fnResetUsed || this.indexUsed.size); pass++) {
      const next = this.idPages;
      this.notePhysicalPages(next);
      const total = this.pagesBuilt.length;
      // 先頭から N ページで止めた回は、総ページ数が分からない (参照は決まらない参照にする。cite)
      if (!this.cutInfo) next.set(TOTAL_PAGES_ID, { first: String(total), last: String(total), firstN: total, lastN: total, firstP: total, lastP: total });
      const sameCut = !this.cutInfo === !this.citeCut && (!this.cutInfo || sameSet(this.cutInfo.last, this.citeCut!.last));
      const sameCite =
        !this.citationUsed ||
        (sameCut && this.citations && next.size === this.citations.size && [...next].every(([k, v]) => { const c = this.citations!.get(k); return c?.first === v.first && c?.last === v.last && c?.firstP === v.firstP && c?.lastP === v.lastP; }));
      const order = this.footnoteOrder();
      const sameFoot = !this.fnResetUsed || (order.size === this.fnOrder.size && [...order].every(([k, v]) => this.fnOrder.get(k) === v));
      const sameIndex = indexDone();
      if (sameCite && sameFoot && sameIndex) return [];
      this.citations = next;
      this.citeCut = this.cutInfo;
      this.fnOrder = order;
      if (indexView) this.indexPrev = indexView;
      // 次の回を組む間、この関数の変数は、いまの回のページ (PageBuild) を指さない (組み直す page-sequence の前の回の論理の木を、組みながら手放す)
      yield* this.onceSteps(doc);
    }
    const unsettled: Diagnostic[] = [];
    // 索引のページ番号の並びが伸びてページが増え、引くページがまた変わる、を繰り返して決まらないときは、上限の回数で止めて知らせる
    if (!indexDone()) unsettled.push(diag('layout/not-converged', msg('索引のページ番号の並びが収束しませんでした (索引が伸びてページが増え、引くページが変わるなど)', 'the index page number lists did not converge (e.g. the index grew, adding pages and changing the cited pages)'), { what: 'index' }));
    if (this.citationUsed || this.fnResetUsed) unsettled.push(diag('layout/not-converged', msg('ページ番号参照・ページごとの脚注番号が収束しませんでした (目次の桁数が変わるなど)', 'page number references / per-page footnote numbers did not converge (e.g. the number of digits in a table of contents changed)'), { what: 'page-number-citation' }));
    return unsettled;
  }

  /**
   * メモリ節約: 組み終えた page-sequence のページ (pages の from から) の、組版の途中の木を手放す (渡す先があれば、先に柱などを組んで領域の木にして渡す)。
   * 柱などのマーカーは、そのページと前のページのものしか引かない (findMarker) ので、後ろの page-sequence を組む前に組める。
   * 先頭から N ページで止めるときは、見張りのページ (N + 1 ページ目) を渡さない (止めたときに捨てる)
   */
  private releaseLow(pages: PageBuild[], from: number, sink: ((sheet: SheetArea) => void) | undefined, prevTotal: number, host: FlowHost, docStyle: ResolvedStyle, staticWarnings: Diagnostic[]): void {
    const max = this.options.maxPages;
    for (let i = from; i < pages.length; i++) {
      if (sink && (max === undefined || i < max)) {
        const st = this.sheetStatics(pages[i], prevTotal, { ...host, warn: (m) => staticWarnings.push(m) }, docStyle, pages, i);
        sink(this.lowSheet(pages[i], st));
      }
      releasePage(pages[i]);
    }
  }

  /**
   * 組みながらページを渡す (design/pdf-writer.md の 12): 組んでいる page-sequence のページ (seqPages。文書の初めからの番号は
   * this.pagesBuilt.length から) のうち、upTo より前の、まだ渡していないページを、柱を組んで領域の木にして渡し、組版の途中の木を手放す。
   * 渡せないページ (まだ置いていない参照先を引いた・受け手が断った・ページごとの脚注番号) に来たら、そこで止める (後ろは組み終えてから作る)。
   * 組み直しの 2 回目からの回は、1 回目に渡したページを組み直したもの (1 回目と同じ値で組むので同じページ) を、渡さずに手放す
   */
  private emitPages(seqPages: PageBuild[], upTo: number): void {
    const e = this.emitState!;
    const base = this.pagesBuilt.length;
    for (let j = e.seqDone; j < upTo; j++) {
      const g = base + j;
      if (this.passIndex > 1) {
        if (g >= e.done) break;
        if (!emitProbe.keep) releasePage(seqPages[j]);
        e.seqDone = j + 1;
        continue;
      }
      if (e.stopped || g >= e.unsafeAt || this.fnResetUsed || !this.emitOne(seqPages, j, g)) {
        e.stopped = true;
        e.seq = false;
        return;
      }
      e.seqDone = j + 1;
    }
  }

  /** 組みながらページを渡す: 組んでいる page-sequence の j 番目のページ (文書の初めから g 番目) を渡す。渡せなければ false */
  private emitOne(seqPages: PageBuild[], j: number, g: number): boolean {
    const e = this.emitState!;
    const p = seqPages[j];
    // 柱を組む (回の終わりに組むときと同じ: マーカーは、このページと前のページのものを引く)。柱の中の参照・警告は、このページの記録に入れない
    const pageRecs = this.pageRecs;
    const citeLog = this.citeLog;
    this.pageRecs = undefined;
    this.citeLog = undefined;
    e.staticUnresolved = false;
    e.inStatics = true;
    const warnings: Diagnostic[] = [];
    e.pages.push(p);
    let st: SheetStatics;
    try {
      st = this.sheetStatics(p, g + 1, { ...e.host!, warn: (m) => warnings.push(m) }, e.docStyle!, e.pages, g);
    } finally {
      e.inStatics = false;
      this.pageRecs = pageRecs;
      this.citeLog = citeLog;
    }
    const refuse = () => {
      e.pages.pop();
      // このページは行番号を付けた (回の終わりに 2 度付けない) ので、1 回目の終わりの柱は、このページの後の数えから続ける
      e.lineCountRefused = new Map(this.lineCount);
      this.lineCount = new Map(e.lineCount);
      return false;
    };
    // 柱が総ページ数・まだ置いていない参照先を引いた: このページは、組み終えるまで決まらない
    if (e.staticUnresolved) return refuse();
    const sheet = this.buildSheet(p, st);
    const json = e.kept ? JSON.stringify(sheet) : undefined;
    this.registerGradients([sheet]);
    if (this.paintEffects) applyPaintEffects([sheet], this.paintEffects);
    e.resources.visit(sheet);
    if (!this.emitter!.page(g, sheet)) return refuse();
    e.done = g + 1;
    pushAll(e.staticWarnings, warnings);
    e.lineCount = new Map(this.lineCount);
    if (e.kept) e.kept.push({ json: json!, statics: st });
    else releasePage(p);
    return true;
  }

  /**
   * 先頭から N ページで止めた (maxPages): 組み終えた page-sequence のページ (pages) と、組んでいた page-sequence のページ (built) のうち、
   * 文書の初めから N ページを pages に残し、見張りのページ (N + 1 ページ目) と、作りかけの N + 2 ページ目を捨てる。
   * 捨てたページに置いた id から、N ページより後ろにある id と、後ろへ続く id を分け (cutInfo)、後ろにある id のページの記録を消す
   * (しおり・リンクの飛び先・ページ番号の参照が、捨てたページを指さないように)
   */
  private cutPages(pages: PageBuild[], built: PageBuild[], max: number, seq: LPageSequence): void {
    const all = [...pages, ...built];
    const kept = new Set(all.slice(0, max));
    // page-sequence・flow の id は、最初のページだけ記録する (最後のページは分からない。後ろへ続く id にする)
    const firstKept = built.find((pb) => kept.has(pb));
    const cutSeq = built.length > 0;
    if (cutSeq) for (const id of [seq.id, seq.flow.id]) if (id && firstKept) this.noteIdPage(id, firstKept.number, seq.pageNumberFormat, firstKept);
    const first = new Set<string>();
    const last = new Set<string>();
    for (const [id, pb] of this.idPageBuild) if (!kept.has(pb)) first.add(id);
    for (const [id, pb] of this.idPageBuildLast) if (!first.has(id) && !kept.has(pb)) last.add(id);
    if (cutSeq) for (const id of [seq.id, seq.flow.id]) if (id && !first.has(id) && this.idPageBuild.has(id)) last.add(id);
    // ページ番号を記録したのに、ページの節の無い id (idPageBuild に無いもの) は、記録したページ番号で、残したページの範囲かを見る
    const lastKept = all[Math.min(max, all.length) - 1];
    for (const [id, v] of this.idPages) {
      if (this.idPageBuild.has(id) || first.has(id) || !lastKept || lastKept.seq !== seq) continue;
      if (v.firstN !== undefined && v.firstN > lastKept.number) first.add(id);
      else if (v.lastN !== undefined && v.lastN > lastKept.number) last.add(id);
    }
    for (const id of first) {
      this.idPages.delete(id);
      this.idPageBuild.delete(id);
      this.idPageBuildLast.delete(id);
    }
    if (this.indexKeys) built.forEach((pb, k) => this.pageOrdinal.set(pb, pages.length + k));
    pages.length = Math.min(pages.length, max);
    pushAll(pages, built.slice(0, Math.max(0, max - pages.length)));
    this.cutInfo = { first, last };
  }

  /** id の置かれたページの、物理的なページ番号 (文書の中での順番) を記録する */
  private notePhysicalPages(ids: Map<string, IdPages>) {
    const index = new Map(this.pagesBuilt.map((pb, i) => [pb, i + 1]));
    for (const [id, v] of ids) {
      const f = this.idPageBuild.get(id);
      const l = this.idPageBuildLast.get(id);
      if (f) v.firstP = index.get(f);
      if (l) v.lastP = index.get(l);
    }
  }

  // ── 前の文書の組版の使い回し (器の reuse。design/resumable-flow.md の 6) ──

  /** 組版の初め: 前の文書の組版を使えるか決め、この文書の指紋を作る (覚えるため) */
  private setupReuse(doc: LDocument) {
    const lr = this.options.layoutReuse;
    this.reusePrev = undefined;
    this.reuseNow = undefined;
    this.reuseMapCache = undefined;
    this.reuseOwnerMaps = undefined;
    this.withinOwners = undefined;
    this.reuseFx = undefined;
    this.reuseCost = { cost: 0, hit: false };
    this.foreignSeqs = new Set();
    // メモリ節約の組版・先頭から N ページで止める組版 (プレビュー) は、前の文書の組版を使いも外しもしない (次に全体を組むときに使う)
    if (!lr || this.lowMemory || this.options.maxPages !== undefined) return;
    // 使ったら外す (この文書の組版が、そのページを書き換えて使うので)
    const prev = lr.prev;
    lr.prev = undefined;
    const skip = new Set(['assets', 'control', 'sharedLineMemo', 'layoutReuse', 'hyphenate', 'resumeCheck']);
    const opts = JSON.stringify(this.options, (k, v) => (skip.has(k) || typeof v === 'function' ? undefined : v instanceof Set ? [...v] : v));
    // 警告の文は組んだときの言語で作るので、言語も入れる (違う言語の文書では、前の文書の警告を使わない)
    const env = `${this.fonts.signature()}|${limitsKey()}|${this.measurer.version()}|${opts}|${this.options.assets?.layoutSignature() ?? ''}|${messageLang()}`;
    // 文書の欄のうち、組版が読まないもの (しおり・文書の題と情報・タグ付き PDF の構造の木) は指紋に入れない。これらは組み終えた後の
    // finishTree が、いまの文書から作り直す (しおりの飛び先と構造の木は、ページの領域の入力の節の番号から引くので、使い回したページでも
    // いまの文書の節を指す)。HTML の見出しの字を直すと、しおりの題も変わるので、入れると、どの page-sequence も使い回さなかった
    const { sequences: _s, title: _t, info: _i, bookmarks: _b, structure: _st, ...rest } = doc;
    const docPrint = contentPrint(rest);
    // 節ごとの指紋は、要る所 (前の文書と節の番号の対応を作るとき) で初めて作る
    const nodes = this.docNodes ?? [];
    let shapes: NodeShapes | undefined;
    this.reuseNow = { env, hyphenate: this.options.hyphenate, docPrint, prints: doc.sequences.map((q) => contentPrint(q)), shapes: () => (shapes ??= nodeShapes(nodes)), nodes };
    // 組む手間の上限 (maxMeasureFlows) の近くの文書では使い回さない: 使い回すと組む流れの数が減り、初めから組めば上限に当たる所で当たらなくなる
    // (前の文書の数えの 2 倍に余裕を足しても上限に届かないとき。直した文書の数えは、前の文書と大きくは違わない)
    const budget = this.options.maxMeasureFlows ?? Math.max(100000, 2 * (this.docNodes?.length ?? 0));
    if (prev && prev.env === env && prev.hyphenate === this.options.hyphenate && prev.docPrint === docPrint && !prev.hit && 2 * prev.cost + 1000 <= budget) {
      // 前の文書の組み直しの 2 回目からの字の差し替えで書き換えたページを、1 回目の形に戻す (覚えた記録は 1 回目のもの)
      const u = prev.undo;
      if (u) {
        for (const [n, g] of u.glyphs) n.glyph = g;
        for (const [c, x] of u.cites) {
          c.uses = x.uses;
          c.seen = x.seen;
        }
        prev.undo = undefined;
      }
      this.reusePrev = prev;
    }
  }

  /** 前の文書の、page-sequence si と中身の同じ page-sequence の記録 (ページ番号の参照・索引・止めた組版のものは使わない) */
  private prevSeqMemo(si: number): SeqMemo | undefined {
    const e = this.reusePrev?.seqs[si];
    if (!e || e.print !== this.reuseNow?.prints[si] || this.indexKeys) return undefined;
    const m = e.memo;
    // ページ番号の参照のあるものは、組み直しの 1 回目だけ使う (ページの参照を、1 回目の組版の決まりで引き直して確かめる。adoptPrev)
    if (m.cites.size && (this.citations || !m.run)) return undefined;
    // 書体の知らせが出たものは使わない (知らせが抜ける)。次の page-sequence の始まりの番号が違えば使わない (force-page-count の白ページが変わりうる)
    if (m.notices || m.nextIpn !== this.lastDoc?.sequences[si + 1]?.initialPageNumber) return undefined;
    return m.indexLists?.size || m.beyond ? undefined : m;
  }

  /**
   * 前の文書の記録 memo のページを、この文書の page-sequence si のページにする: 入力の節の番号を、この文書の番号にずらし、柱と
   * マーカーの入力の節・page-sequence の節を、この文書のものに付け替え、警告の場所を引き直す。付け替えられなければ false (組む)。
   * ordinal は、この page-sequence の最初のページの、文書の先頭からの通し番号
   */
  private adoptPrev(si: number, memo: SeqMemo, ordinal: number): boolean {
    const e = this.reusePrev?.seqs[si];
    const seq = this.docNodes ? (this.lastDoc?.sequences[si] as LPageSequence | undefined) : undefined;
    const start = sourceRef(seq);
    if (!e || e.memo !== memo || !seq || start === undefined) return false;
    const delta = start - e.start;
    const nodes = this.docNodes;
    // id のページ: 記録の id のうち、この page-sequence より前で記録していたものが、いまの文書でも同じでなければ使わない
    // (同じ id が文書に 2 度あるとき、最初のページがどちらの page-sequence のものかが、初めから組んだときと違う)
    const had = new Set(memo.idBefore);
    for (const list of [memo.idPages, memo.idPageBuild, memo.idPageBuildLast]) for (const [k] of list) if (had.has(k) !== (this.idPages.has(k) || this.idPageBuild.has(k))) return false;
    /** 前の文書の入力の節 → この文書の同じ所の節 (同じ部分木の中だけ) */
    const remap = <T extends object>(n: T): T | undefined => {
      const r = sourceRef(n);
      if (r === undefined || r < e.start || r > e.end) return undefined;
      const m = nodes[r + delta] as T | undefined;
      return m && (m as { type?: unknown }).type === (n as { type?: unknown }).type ? m : undefined;
    };
    // 付け替えられるかを先に確かめる (確かめてから書き換える)
    const inR = (r: number | undefined) => r === undefined || (r >= e.start && r <= e.end);
    const inRange = (n: LNode): boolean => inR(n.ref) && inR(n.fxRef) && n.children.every(inRange);
    for (const p of memo.built) {
      if (!inRange(p.root) || !p.abs.every(inRange)) return false;
      if (p.staticContent.some((c) => !remap(c))) return false;
      if (p.markers.some((m) => m.marker && !remap(m.marker))) return false;
    }
    // ページ番号の参照: ページの参照を、組み直しの 1 回目の決まりで引き直し、ページに組んだ字と同じか (spliceCites)。同じなら、参照の記録を
    // 引き直した値で作り直す (初めから組んだときの記録と同じにする)。id のページは、呼ぶ側が memo の記録から書く
    if (memo.cites.size) {
      const run = memo.run;
      const log: Array<[PageRecord['cites'][number], string]> = [];
      if (!run || run.pages > memo.built.length || !this.spliceCites(memo, run.recs, 0, run.pages, false, log)) return false;
      const cites: SeqMemo['cites'] = new Map();
      const saved = this.citeLog;
      this.citeLog = cites;
      for (const [[id, last, format, physical, , style], v] of log) this.logCite(id, last, format, physical, v, style);
      this.citeLog = saved;
      memo.cites = cites;
    }
    const shift = (n: LNode) => {
      if (n.ref !== undefined) n.ref += delta;
      if (n.fxRef !== undefined) n.fxRef += delta;
      for (const c of n.children) shift(c);
    };
    const assets = this.options.assets;
    const noteImages = (n: LNode) => {
      if (n.image?.src) assets?.get(n.image.src);
      for (const c of n.children) noteImages(c);
    };
    for (const p of memo.built) {
      if (delta) {
        shift(p.root);
        p.abs.forEach(shift);
      }
      p.seq = seq;
      // 箱の効果を、この文書の物に替える
      if (this.paintEffects) {
        const seen = new Set<LNode>();
        this.swapFx(p.root, seen);
        for (const a of p.abs) this.swapFx(a, seen);
      }
      p.staticContent = p.staticContent.map((c) => remap(c)!);
      p.markers = p.markers.map((m) => (m.marker ? { ...m, marker: remap(m.marker)! } : m));
      // 画像を使ったことを、画像の置き場に知らせる (組んだときと同じ。コマンドが、見張るファイルを決める)
      if (assets) {
        noteImages(p.root);
        p.abs.forEach(noteImages);
      }
    }
    const pageShift = ordinal - memo.ordinal;
    memo.warnings = memo.warnings.map((d) => {
      const r = d.source?.sourceRef;
      if (r === undefined) return d;
      const node = r >= e.start && r <= e.end ? nodes[r + delta] : undefined;
      const { line: _l, column: _c, element: _e, file: _f, sourceRef: _r, ...keep } = d.source!;
      const base = { ...d, source: { ...keep, ...(keep.page !== undefined ? { page: keep.page + pageShift } : {}) } };
      return node ? withSource(base, node) : base;
    });
    memo.ordinal = ordinal;
    // その sequence を組んだときに返した可変フォントの実体を、同じ順に返し直し、当たった上限を記録し直す
    if (memo.handed) this.fonts.rehand(memo.handed);
    for (const n of memo.limits ?? []) noteLimitReached(n);
    // 境目の記録は前の文書の節を指すので、次の文書が繋ぐのには使わない
    memo.run = undefined;
    this.seqMemo[si] = memo;
    this.foreignSeqs.add(si);
    const lr = this.options.layoutReuse!;
    lr.stats.sequences++;
    lr.stats.pages += memo.built.length;
    return true;
  }

  /**
   * 前の文書の page-sequence si の組みと、境目から後ろを繋ぐ相手 (design/resumable-flow.md の 6.2 の 2・3)。中身が違い (直した所を含み)、
   * 始まりの条件が同じで、索引・止めた組版・ページごとの脚注番号・最後のページのマスターの無いもの (ページ番号の参照は、組み直しの 1 回目だけ)
   */
  private spliceTarget(si: number, seq: LPageSequence, first: number, sideDelta: number, ordinal: number, needsLast: boolean): SpliceTarget | undefined {
    // 組み直しの 2 回目からの回: 前の回の組み (字の差し替えができなかったもの) の、値の変わった参照を初めて引いたページの前の境目から組み、
    // 後ろで前の回と揃ったら繋ぐ (design/resumable-flow.md の 4.3 の 2)。前の回の境目の記録は、Typesetter が覚えるときだけある
    if (this.passIndex > 1) {
      const m = this.seqMemo[si];
      const rec = m?.run;
      const nodes = this.docNodes;
      if (!m || !rec || !nodes || needsLast || this.indexKeys || this.fnResetUsed || seq.footnotes?.reset === 'page' || this.citeCut) return undefined;
      if (m.first !== first || m.sideDelta !== sideDelta || (docOrdinalMasters(seq) && m.ordinal !== ordinal) || m.fnCarryIn !== this.fnCarry || m.indexLists?.size || m.beyond || m.limits || m.notices) return undefined;
      const own = (this.withinOwners ??= arrayOwners(nodes));
      return { memo: m, rec, map: { P: nodes.length, oldEnd: nodes.length, newEnd: nodes.length, delta: 0 }, ordinal, within: { owners: { old: own, now: own } } };
    }
    const map = this.reuseMap;
    const m = this.reusePrev?.seqs[si]?.memo;
    const rec = m?.run;
    if (!map || !m || !rec || needsLast || this.passIndex !== 1 || this.seqMemo[si] || this.indexKeys || this.fnResetUsed || seq.footnotes?.reset === 'page') return undefined;
    // ページ番号の参照は、1 回目の組版 (this.citations が無い) だけで繋ぐ (繋ぐページの参照を、1 回目の組版の決まりで引き直して確かめる。spliceCites)
    // 上限に当たったもの・書体の知らせが出たものは繋がない (繋ぐページの分の知らせを、ページごとに持っていないので)
    if (m.first !== first || m.sideDelta !== sideDelta || (docOrdinalMasters(seq) && m.ordinal !== ordinal) || m.fnCarryIn !== this.fnCarry || this.citations || m.indexLists?.size || m.beyond || m.limits || m.notices) return undefined;
    // page-sequence の節そのもの (ページのマスター・柱の並び・塗り足しなど、本文の外の欄) が前の文書と同じときだけ繋ぐ。節の対応では、
    // 直した所が page-sequence の節だけになり、本文は全部「直した所の後ろ」になるので、繋いだページが前のマスターのまま残る
    const e = this.reusePrev!.seqs[si];
    const at = sourceRef(seq);
    // (祖先の節は、子の並びにブロックを足す・消すと変わるので、直した所より前 (初めの同じ所) にあることで見る。欄が同じで、子の並びの直した所の外が対応する)
    if (!e || at === undefined || e.start !== at || at >= map.P) return undefined;
    // 直した所は、本文 (flow) の部分木の中にあること。page-sequence の本文の外の節 (柱・領域の背景・脚注の区切りなど。どのページにも効く) を足す・消す・
    // 直したときは繋がない (前の組版のページは、前の節のまま)
    const f = sourceRef(seq.flow);
    const fEndOld = f === undefined ? undefined : this.reusePrev!.shapes().ends[f];
    const fEndNew = f === undefined ? undefined : this.reuseNow?.shapes().ends[f];
    if (f === undefined || fEndOld === undefined || fEndNew === undefined || f >= map.P || map.oldEnd > fEndOld || map.newEnd > fEndNew) return undefined;
    return { memo: m, rec, map, ordinal };
  }

  /** 引いたページ番号の参照を、page-sequence の参照の記録 (citeLog) に足す。値と、字の計測・描き方に効く書式の組ごとに 1 つ覚える (reuseCites が、組ごとに差し替えられるかを確かめる) */
  private logCite(id: string, last: boolean | undefined, format: string | undefined, physical: boolean | undefined, v: string, style: ResolvedStyle | undefined) {
    this.citationUsed = true;
    if (!this.citeLog) return;
    const key = JSON.stringify([id, last, format, physical]);
    const mark = this.citeMark(v, style);
    const e = this.citeLog.get(key);
    if (!e) this.citeLog.set(key, { args: [id, last, format, physical], uses: [{ value: v, style }], seen: new Set([mark]) });
    else if (!e.seen.has(mark)) {
      e.seen.add(mark);
      e.uses.push({ value: v, style });
    }
  }

  /**
   * 同じ文書の前の回の組み memo の、ページごとの記録 recs の [0, to) のうち、引いた参照の値が、いまの回の値 (前の回の結果。spliceCites の 2 回目からの
   * 決まり) と同じでない最初のページ (どれも同じなら to)。ページに組んだ字の値は、spliceCites と同じく memo の参照の記録から引く
   */
  private citesSameUpTo(memo: SeqMemo, recs: readonly PageRecord[], to: number): number {
    for (let j = 0; j < to; j++) for (const c of recs[j]?.cites ?? []) {
      const [id, last, format, physical] = c;
      const now = this.citeBeyond(id, last) ? undefined : this.citeValue(id, last, format, physical);
      const u = memo.cites.get(JSON.stringify(c.slice(0, 4)))?.uses;
      const shown = !u?.length ? undefined : u.every((x) => x.value === u[0].value) ? u[0].value : c[4];
      if (now === undefined || now !== shown) return j;
    }
    return to;
  }

  /**
   * 前の組版の境目 pb から後ろのページの、id のページを書き (初めから組んだときと同じ順)、ページの中のページ番号の参照を、組み直しの 1 回目の
   * 決まり (host.cite: 置いた id はそのページ、まだ置いていない id と last・physical の参照は、引いたときのページ番号) で引き直し、ページに組んだ字の
   * 値 (前の組版の参照の記録で、値が 1 つにそろっていればその値 (字を差し替えたもの)、そろっていなければ引いたときの値) と同じかを確かめる。
   * ページの中で id を置く前に引いたか後に引いたかで値が変わる参照は、どちらでも同じときだけ同じとする。commit でなければ、確かめた後に id を戻す。
   * ページは recs の [from, to)、ページに組んだ字の値は memo の参照の記録から引く。out に、参照と引き直した値を並べる (参照の記録に足すため)
   */
  private spliceCites(memo: SeqMemo, recs: readonly PageRecord[], from: number, to: number, commit: boolean, out?: Array<[PageRecord['cites'][number], string]>): boolean {
    const copy = <K, V extends object>(m: Map<K, V>) => new Map([...m].map(([k, v]) => [k, { ...v }] as [K, V]));
    const saved = { pages: copy(this.idPages), build: new Map(this.idPageBuild), last: new Map(this.idPageBuildLast) };
    const recsSaved = this.pageRecs;
    this.pageRecs = undefined;
    const value = (c: PageRecord['cites'][number]): string => {
      const [id, last, format, physical, , , pn] = c;
      // 組み直しの 2 回目からの回 (同じ文書の前の回と繋ぐ): 前の回の結果の値 (host.cite と同じ。決まらない参照・見つからない参照は、繋がない)
      if (this.citations) return this.citeBeyond(id, last) ? '\u0000beyond' : (this.citeValue(id, last, format, physical) ?? '\u0000missing');
      const n = !last && !physical ? this.idPages.get(id) : undefined;
      return n ? (format !== undefined && n.firstN !== undefined ? formatPageNumber(n.firstN, format) : n.first) : formatPageNumber(Math.max(1, pn ?? 1), format ?? '1');
    };
    const shown = (c: PageRecord['cites'][number]): string | undefined => {
      const u = memo.cites.get(JSON.stringify(c.slice(0, 4)))?.uses;
      if (!u?.length) return undefined;
      return u.every((x) => x.value === u[0].value) ? u[0].value : c[4];
    };
    let ok = true;
    for (let j = from; j < to && ok; j++) {
      const r = recs[j];
      const before = r.cites.map(value);
      for (const [id, n, fmt, page] of r.ids) this.noteIdPage(id, n, fmt, page);
      r.cites.forEach((c, i) => {
        if (before[i] !== value(c) || before[i] !== shown(c)) ok = false;
        out?.push([c, before[i]]);
      });
    }
    this.pageRecs = recsSaved;
    if (!ok || !commit) {
      this.idPages = saved.pages;
      this.idPageBuild = saved.build;
      this.idPageBuildLast = saved.last;
    }
    return ok;
  }

  /**
   * 前の文書の境目の写し fb を、いまの文書の物に移す (前を飛ばす)。前の文書の入力の節は、同じ番号のいまの文書の節に、入力の節の欄の配列
   * (子の並びなど) は、持ち主の節の同じ欄に替え、それらを含む物 (続きの位置の段・開いている箱・行の並びなど) は写して替える。含まない物
   * (書式・書体・組んだ箱など) は、そのまま使う (書き換えない物)。境目は直した所より前 (読んだ先が P より前) なので、節の番号は同じ。
   * 直した所より後ろの番号・関数・中を見られない覚えを含む物があれば undefined (移さない)
   */
  private remapBoundary(fb: FlowBoundary, m: ReuseMap): FlowBoundary | undefined {
    const owners = this.reuseOwners();
    const nodes = this.docNodes;
    const old = this.reusePrev?.nodes;
    if (!owners || !nodes || !old) return undefined;
    /** 前の文書の物を含むか (含めば写す) */
    const has = new Map<object, boolean>();
    const contains = (v: unknown): boolean => {
      if (!v || typeof v !== 'object') return false;
      const o = v as object;
      const h = has.get(o);
      if (h !== undefined) return h;
      const r = sourceRef(o);
      if ((r !== undefined && old[r] === o) || owners.old.has(o)) return has.set(o, true), true;
      has.set(o, false);
      const proto = Object.getPrototypeOf(o);
      let c = false;
      if (Array.isArray(o)) c = o.some(contains);
      else if (o instanceof Map) c = [...o].some(([k, x]) => contains(k) || contains(x));
      else if (o instanceof Set) c = [...o].some(contains);
      else if (proto === Object.prototype || proto === null) c = Object.values(o).some(contains) || r !== undefined;
      has.set(o, c);
      return c;
    };
    const memo = new Map<object, unknown>();
    let bad = false;
    const go = (v: unknown, key?: string): unknown => {
      if (bad) return v;
      if (typeof v === 'function') {
        bad = true;
        return v;
      }
      if (key !== undefined && REF_KEYS.has(key) && typeof v === 'number') {
        if (mapRef(m, v) !== v || v >= m.P) bad = true;
        return v;
      }
      if (!v || typeof v !== 'object') return v;
      const o = v as object;
      if (memo.has(o)) return memo.get(o);
      const r = sourceRef(o);
      if (r !== undefined && old[r] === o) {
        const n = r < m.P ? nodes[r] : undefined;
        if (!n || (n as { type?: unknown }).type !== (o as { type?: unknown }).type) bad = true;
        memo.set(o, n);
        return n;
      }
      const own = owners.old.get(o);
      if (own) {
        const rr = sourceRef(own[0]);
        const n = rr !== undefined && rr < m.P ? (nodes[rr] as Record<string, unknown>) : undefined;
        const arr = n?.[own[1]];
        if (!Array.isArray(arr)) bad = true;
        memo.set(o, arr);
        return arr;
      }
      if (o instanceof WeakMap || o instanceof WeakSet || o instanceof WeakRef) return o;
      if (!contains(o)) return o;
      if (Array.isArray(o)) {
        const out: unknown[] = [];
        memo.set(o, out);
        for (const x of o) out.push(go(x));
        return out;
      }
      if (o instanceof Map) {
        const out = new Map();
        memo.set(o, out);
        for (const [k, x] of o) out.set(go(k), go(x));
        return out;
      }
      if (o instanceof Set) {
        const out = new Set();
        memo.set(o, out);
        for (const x of o) out.add(go(x));
        return out;
      }
      const out: Record<string, unknown> = {};
      memo.set(o, out);
      for (const [k, x] of Object.entries(o)) out[k] = go(x, k);
      if (r !== undefined) copySourceRef(o, out);
      return out;
    };
    const fields: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(fb.fields)) fields[k] = go(x, k);
    const steps = fb.steps.map((x) => go(x)) as ResumeStep[];
    return bad ? undefined : { level: fb.level, fields, steps };
  }

  /**
   * 組んでいる表のセルの flexItemCaps (鍵は、罫線をつぶした後の表のセル) が、前の組版の、対応するセルと同じか。
   * 直した所の中のセル (続きでは組まない行) は比べない。入力の節の番号を持たないセルに値があれば、揃わないとする
   */
  private spliceSideOk(t: SpliceTarget, olds: TableStep[], nows: TableStep[], old: WeakMap<object, unknown>, now: WeakMap<object, unknown>): boolean {
    const cells = (root: unknown, out: object[]) => {
      const seen = new Set<object>();
      const go = (v: unknown) => {
        if (!v || typeof v !== 'object' || seen.has(v)) return;
        seen.add(v);
        if ((v as { type?: unknown }).type === 'table-cell') out.push(v);
        for (const x of Array.isArray(v) ? v : Object.values(v)) go(x);
      };
      go(root);
      return out;
    };
    for (let k = 0; k < nows.length; k++) {
      const byRef = new Map<number, unknown>();
      for (const c of cells(nows[k].node ?? nows[k].table, [])) {
        const r = sourceRef(c);
        const v = now.get(c);
        if (r === undefined) {
          if (v !== undefined) return false;
        } else byRef.set(r, v);
      }
      for (const c of cells(olds[k].node ?? olds[k].table, [])) {
        const r = sourceRef(c);
        const v = old.get(c);
        const nr = r === undefined ? undefined : mapRef(t.map, r);
        if (nr === undefined) {
          if (r === undefined && v !== undefined) return false;
          continue;
        }
        if (byRef.get(nr) !== v) return false;
      }
    }
    return true;
  }

  /** 前の組版の境目 pb から後ろのページと警告を、この文書の節に付け替えられるか (直した所の中の節を指していないか) */
  private spliceCheck(t: SpliceTarget, from: number, to: number, warnFrom: number, warnTo: number): boolean {
    const m = t.map;
    const nodes = this.docNodes;
    if (!nodes) return false;
    // 行番号 (axf:line-number) の行は、番号をページをまたいで数えるので (addLineMarks)、繋がない (直した所で行の数が変わると、番号がずれる)
    const okRef = (n: LNode): boolean => !n.lnum && (n.ref === undefined || mapRef(m, n.ref) !== undefined) && (n.fxRef === undefined || mapRef(m, n.fxRef) !== undefined) && n.children.every(okRef);
    const okNode = (x: object): boolean => {
      const r = sourceRef(x);
      const nr = r === undefined ? undefined : mapRef(m, r);
      return nr !== undefined && (nodes[nr] as { type?: unknown } | undefined)?.type === (x as { type?: unknown }).type;
    };
    for (let j = from; j < to; j++) {
      const p = t.memo.built[j];
      if (!okRef(p.root) || !p.abs.every(okRef) || !p.staticContent.every(okNode) || !p.markers.every((mk) => !mk.marker || okNode(mk.marker))) return false;
    }
    const W = t.rec.warnStart;
    for (const d of t.memo.warnings.slice(warnFrom - W, warnTo - W)) {
      const r = d.source?.sourceRef;
      if (r !== undefined && mapRef(m, r) === undefined) return false;
    }
    return true;
  }

  /**
   * 前の組版の境目 pb から後ろのページを、この文書の page-sequence seq のページにし (入力の節の番号をずらし、柱・マーカーの節と seq を付け替え、
   * 画像を知らせ直す)、その間の警告を、場所を引き直して足す (spliceCheck が通ったもの)
   */
  private spliceAdopt(t: SpliceTarget, from: number, to: number, warnFrom: number, warnTo: number, seq: LPageSequence): PageBuild[] {
    const m = t.map;
    const nodes = this.docNodes!;
    const seen = new Set<LNode>();
    const shift = (n: LNode) => {
      if (seen.has(n)) return;
      seen.add(n);
      if (n.ref !== undefined) n.ref = mapRef(m, n.ref)!;
      if (n.fxRef !== undefined) n.fxRef = mapRef(m, n.fxRef)!;
      for (const c of n.children) shift(c);
    };
    const remap = <T extends object>(x: T): T => nodes[mapRef(m, sourceRef(x)!)!] as T;
    const assets = this.options.assets;
    const noteImages = (n: LNode) => {
      if (n.image?.src) assets?.get(n.image.src);
      for (const c of n.children) noteImages(c);
    };
    const out = t.memo.built.slice(from, to);
    for (const p of out) {
      if (m.delta) {
        shift(p.root);
        p.abs.forEach(shift);
      }
      p.seq = seq;
      // 箱の効果を、この文書の物に替える
      if (this.paintEffects) {
        const seen = new Set<LNode>();
        this.swapFx(p.root, seen);
        for (const a of p.abs) this.swapFx(a, seen);
      }
      p.staticContent = p.staticContent.map(remap);
      p.markers = p.markers.map((mk) => (mk.marker ? { ...mk, marker: remap(mk.marker) } : mk));
      if (assets) {
        noteImages(p.root);
        p.abs.forEach(noteImages);
      }
    }
    const W = t.rec.warnStart;
    const pageShift = t.ordinal - t.memo.ordinal;
    for (const d of t.memo.warnings.slice(warnFrom - W, warnTo - W)) {
      const r = d.source?.sourceRef;
      if (r === undefined) {
        this.warnings.push(d);
        continue;
      }
      const { line: _l, column: _c, element: _e, file: _f, sourceRef: _r, ...keep } = d.source!;
      const base = { ...d, source: { ...keep, ...(keep.page !== undefined ? { page: keep.page + pageShift } : {}) } };
      this.warnings.push(withSource(base, nodes[mapRef(m, r)!]));
    }
    return out;
  }

  /** 組版の終わり: この文書の組版を、次の文書のために覚える (領域の木にしたページを手放さない) */
  private storeReuse(doc: LDocument) {
    const lr = this.options.layoutReuse;
    const now = this.reuseNow;
    // 索引のある文書は、次の文書で使い回さない (prevSeqMemo・spliceTarget) ので覚えない
    if (!lr || !now || this.cutInfo || this.indexKeys) return;
    // 覚える大きさの上限 (REUSE_LNODES): page-sequence を初めから順に、ページの論理の木の節の数を足し、上限を超える page-sequence からは覚えない
    // (覚えない page-sequence は、次の文書でいまどおり組む)。数はページごとに覚える (使い回したページ・繋いだページは数え直さない)
    let lnodes = 0;
    let full = false;
    lr.prev = {
      env: now.env,
      hyphenate: now.hyphenate,
      docPrint: now.docPrint,
      shapes: now.shapes,
      nodes: this.docNodes ?? [],
      cost: this.reuseCost.cost,
      hit: this.reuseCost.hit,
      ...(this.citeUndo && (this.citeUndo.glyphs.size || this.citeUndo.cites.size) ? { undo: this.citeUndo } : {}),
      seqs: doc.sequences.map((q, si) => {
        const memo = this.passOneMemo?.[si] ?? this.seqMemo[si];
        const start = sourceRef(q);
        const end = sourceRefEnd(q);
        if (!memo || start === undefined || end === undefined || full) return undefined;
        for (const p of memo.built) lnodes += pageLNodes(p);
        if (lnodes > lr.limit) {
          full = true;
          lr.stats.overLimit++;
          return undefined;
        }
        return { print: now.prints[si], start, end, memo };
      }),
    };
  }

  /** 1 回の組版: ページの論理の木 (pagesBuilt) と、ページごとの柱など (passStatics) を作る。領域の木にするのは finishTree */
  private layoutOnce(doc: LDocument): void {
    runSteps(this.onceSteps(doc));
  }

  /** layoutOnce の中身 (page-sequence を組み始める前に yield する) */
  private *onceSteps(doc: LDocument): Generator<void, void> {
    this.passIndex++;
    // メモリ節約: page-sequence を組み終えるごとに、柱などを組んでページを領域の木にし、渡す先 (sink)。柱の中の総ページ数は、前の回のページ数
    // (収束した回では、この回のページ数と同じ。収束しない回の結果は使わない)。1 回目は総ページ数が分からないので渡さない
    // 前の回を先頭から N ページで止めていたら、総ページ数は分からない (-1。sheetStatics が決まらない字にする)
    const prevTotal = this.cutInfo ? -1 : this.pagesBuilt.length;
    // 先頭から N ページで止める (maxPages) ための、回ごとの状態
    this.stopPass = false;
    this.cutInfo = undefined;
    this.beyondHits = [];
    // 前の回を、page-sequence の最初のページで止めた (notePage) ときの、ページごとの記録を外す
    this.pageRecs = undefined;
    this.lookaheadMark = -1;
    this.lookaheadKeep.clear();
    const maxPages = this.options.maxPages;
    let sink: ((sheet: SheetArea) => void) | undefined = this.replaySink;
    if (!sink && this.lowScan && this.passNo > 0) {
      this.lowScan.restart();
      sink = this.lowScan.visit;
    }
    this.lastPassScanned = !!sink && !this.replaySink;
    this.passNo++;
    if (sink) {
      this.lineCount.clear();
      this.staticMemo = new Map();
      // グラデーションの画像の名前は、文書全体を 1 度に領域の木にするとき (finishTree) と同じく、この回のページの順に付ける
      this.gradientNames = new Map();
    }
    /** sink に渡すページの柱などの警告 (回の終わりに足す: 柱などを回の終わりにまとめて組むときと同じ並び) */
    const staticWarnings: Diagnostic[] = [];
    this.passStatics = [];
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
    const nest: NonNullable<FlowHost['nest']> = { d: 0, cd: 0, cmax: this.options.maxColumnNest ?? 4, base: this.stats.flows, budget: this.options.maxMeasureFlows ?? Math.max(100000, 2 * (this.docNodes?.length ?? 0)), hit: false, maxSeen: 0, cSeen: 0, warn: (m) => this.warnings.push(m) };
    const host: FlowHost = {
      ...(this.options.measureMemo === false ? {} : { measureMemo: new WeakMap() }),
      volatile,
      nest,
      condense: { n: 0, max: 0, hit: false, opt: this.options.maxCondenseMeasures, depth: 0, win: 0, trial: 0, limits: new WeakMap(), copies: new WeakMap(), fit: new WeakMap() },
      ...(doc.spaceResolution === 'xsl' ? { xslSpace: true } : {}),
      ...(doc.idLinesSeparateMargins ? { idLinesSeparateMargins: true } : {}),
      ...(doc.spaceResolution === 'xsl' || this.options.fixedColumnBordersAh ? { fixedColumnBorders: true } : {}),
      assets: this.options.assets,
      hyphenate: this.options.hyphenate,
      ...(this.options.kernAh ? { kernAh: true } : {}),
      ...(this.options.lineFitToleranceAh ? { lineFitTolerance: LINE_FIT_TOLERANCE_AH } : {}),
      warn: (m) => this.warnings.push(m),
      ...(this.indexKeys ? { index: (run: InlineChild[]) => this.expandIndex(run, (m) => this.warnings.push(m)) } : {}),
      ...(this.indexPoints.size ? { indexPoint: (id: string) => this.indexPoints.get(id) } : {}),
      measurer: this.measurer,
      lineMemoLru: this.lineMemoLru,
      // 文書をまたぐ覚え: メモリ節約の組版では使わない (ページを PDF に書く間に組むので、組み終える前に、ほかの文書の組版が覚えの書体を差し替えうる)
      ...(this.options.sharedLineMemo && !this.lowMemory ? { sharedLines: { memo: this.options.sharedLineMemo, env: (this.fontEnv ??= `${this.fonts.signature()}|${limitsKey()}`), fonts: this.fonts } } : {}),
      cellMeasure: new WeakMap(),
      stats: this.stats,
      inlineCbRange: (key) => this.inlineCbRange(key),
      cite: (id, last, format, physical, style, pageNumber) => {
        this.citationUsed = true;
        let v: string | undefined;
        // 組みながらページを渡すとき: 組み直しの 1 回目で、まだ置いていない参照先 (前向きの参照・最後のページ・物理的なページ番号・総ページ数) を
        // 引いたページから後ろは、後ろの組版と組み直しの回で変わりうるので渡さない (柱の中なら、そのページを渡さない)
        const e = this.emitState;
        if (e && !this.citations && (last || physical || !this.idPages.get(id))) {
          if (e.inStatics) e.staticUnresolved = true;
          else e.unsafeAt = Math.min(e.unsafeAt, this.pagesBuilt.length + Math.max(0, this.seqBuilding.length - 1));
        }
        if (!this.citations) {
          // 1 回目の組版: 置き済みの参照先 (後ろから前への参照) はそのページ番号。まだ置いていない参照先は、いまのページ番号を仮の値にする
          // (参照先のページ番号と桁数が同じになりやすく、2 回目に字だけ差し替えて済む)
          const n = !last && !physical ? this.idPages.get(id) : undefined;
          v = n ? (format !== undefined && n.firstN !== undefined ? formatPageNumber(n.firstN, format) : n.first) : formatPageNumber(Math.max(1, pageNumber ?? 1), format ?? '1');
        } else if (this.citeBeyond(id, last)) {
          // 前の回を先頭から N ページで止めた: N ページより後ろにある所 (と総ページ数) は決まらない。見つからない id と同じ字で組む
          v = this.unresolvedMark;
          this.beyondHits.push([id === TOTAL_PAGES_ID ? 'total-pages' : last ? 'page-number-citation-last' : 'page-number-citation', id]);
        } else {
          v = this.citeValue(id, last, format, physical);
          if (v === undefined) {
            this.warnings.push(diag('layout/missing-id', msg(`ページ番号参照の対象 id="${id}" が見つかりません`, `target id="${id}" of a page number reference was not found`), { id, kind: 'page-number-citation' }));
            // WeasyPrint の組み方では空 (LDocument.unresolvedCitationEmpty)
            v = doc.unresolvedCitationEmpty ? '' : '?';
          }
        }
        this.logCite(id, last, format, physical, v, style);
        const recs = this.pageRecs;
        if (recs?.length) recs[recs.length - 1].cites.push([id, last, format, physical, v, style, pageNumber]);
        // 覚える計測の途中なら、引いた参照と値を記録する (Flow.memoMeasure が、覚えを使い回す前に引き直して確かめる)
        if (volatile.active > 0) volatile.cites.push({ args: [id, last, format, physical, style], value: v });
        return v;
      },
    };
    const docStyle = resolveStyle(this.baseStyle(), doc);
    const pages: PageBuild[] = [];
    this.pagesBuilt = pages;
    const emit = this.emitState;
    if (emit) {
      emit.host = host;
      emit.docStyle = docStyle;
      emit.unsafeAt = Infinity;
    }
    let pageNo = 1;
    this.sidesByOrder = !!doc.pageSidesByOrder;
    this.rtlPages = !!doc.rtlPageProgression;
    this.sideShift = this.sidesByOrder ? (doc.firstPageSideShift ?? 0) : 0;

    for (const [si, seq] of doc.sequences.entries()) {
      // 組み直しの回と page-sequence の境目 (間をあけるときは、ここで control.boundary を待つ)
      yield;
      // 行グリッドの root (-ah-baseline-grid: root・axf:baseline-grid="root") の書式: この並びの流れの根元の書式 (HTML は根元の要素の書式)
      host.gridRootStyle = resolveStyle(resolveStyle(docStyle, seq), seq.flow);
      // initial-page-number (§7.27.7): auto-odd / auto-even は、続きの番号の偶奇が合わなければ 1 足す
      const ipn = seq.initialPageNumber;
      const first =
        typeof ipn === 'number' ? ipn : ipn === 'auto-odd' ? (pageNo % 2 === 1 ? pageNo : pageNo + 1) : ipn === 'auto-even' ? (pageNo % 2 === 0 ? pageNo : pageNo + 1) : pageNo;
      // ページの左右 (FlowHost.sideDelta): ページの順で決める文書では、この page-sequence の最初のページの、文書の最初からの順 (pages.length + 1) と
      // 番号 (first) の差。CSS Paged Media 3 §3.3: 左右のページは交互に来て、最初のページの左右はページの進む向きで決まる (ページ番号の
      // 振り直し (§6.1 の page のカウンター) では変わらない)
      const sideDelta = this.sidesByOrder ? pages.length + 1 - first + this.sideShift : 0;
      this.sideDelta = sideDelta;
      host.sideDelta = sideDelta;
      if (this.rtlPages) host.rtlPages = true;
      this.seqOrdinal = pages.length;
      // 文書の先頭からのページの順で選ぶマスター (:nth()) のある sequence は、前のページの数が同じときだけ使い回す
      const ordinalOk = (m: SeqMemo) => !docOrdinalMasters(seq) || m.ordinal === pages.length;
      // 前回の組版と同じ条件 (開始ページ・左右のずれ・脚注の続き番号・参照したページ番号の値) なら、前回のページをそのまま使う。
      // ページごとに脚注番号を振り直す文書は、脚注の置き場所が前回の結果に依るので使い回さない
      // メモリ節約のときは、前の回のページを持たないので使い回さない
      // 組み直しの 1 回目は、前の文書の、中身の同じ page-sequence の記録 (器の使い回し)
      const memo = this.lowMemory ? undefined : (this.seqMemo[si] ?? (this.passIndex === 1 ? this.prevSeqMemo(si) : undefined));
      // 索引の並びを持つ sequence は、いまのページで作り直しても同じ並びになるときだけ使い回す (索引の無い sequence は、いつも同じ)
      const sameIndexLists = (m: SeqMemo) => !m.indexLists?.size || (!!this.indexPrev && [...m.indexLists].every(([list, ex]) => (this.indexUsed.get(list) ?? this.buildIndexList(list, this.indexPrev!)).sig === ex.sig));
      // 前の文書の記録は、参照の値を adoptPrev が確かめる (reuseCites は、前の回の値と引き比べるもので、組み直しの 1 回目には使えない)
      if (memo && !this.fnResetUsed && memo.first === first && memo.sideDelta === sideDelta && ordinalOk(memo) && memo.fnCarryIn === this.fnCarry && sameIndexLists(memo) && (this.seqMemo[si] === memo ? this.reuseCites(memo) : this.adoptPrev(si, memo, pages.length))) {
        if (this.indexKeys) memo.built.forEach((pb, k) => this.pageOrdinal.set(pb, pages.length + k));
        for (const [list, ex] of memo.indexLists ?? []) this.indexUsed.set(list, ex);
        pushAll(pages, memo.built);
        this.writeMemoIds(memo);
        pushAll(this.warnings, memo.warnings);
        if (memo.beyond) pushAll(this.beyondHits, memo.beyond);
        if (memo.cites.size) this.citationUsed = true;
        pageNo = first + memo.built.length;
        this.fnCarry = memo.fnCarryOut;
        this.lastFoot = undefined;
        continue;
      }
      const fnCarryIn = this.fnCarry;
      const warnStart = this.warnings.length;
      const beyondStart = this.beyondHits.length;
      const idsBefore = this.lowMemory ? undefined : this.snapshotIds();
      const handBefore = this.fonts.handedCount;
      const noticesBefore = this.fonts.noticeCount;
      const limitsHit = new Set<LimitName>();
      limitTap.fn = (n) => limitsHit.add(n);
      this.citeLog = new Map();
      if (this.indexKeys) {
        this.indexLog = new Map();
        this.indexCur = { first, base: pages.length };
        this.indexSeq = seq;
      }
      const nextIpn = doc.sequences[si + 1]?.initialPageNumber;
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
      // 組む手間の上限に当たったか (この page-sequence を組む前)。捨てる組版で当たったなら、組み直すときに当たり直して警告を出し直す
      // (警告は捨てるので、当たった印だけが残ると、警告が出なくなる)
      const hitBefore = host.nest?.hit ?? false;
      /** 組み直す前に、捨てる組版の警告 (見張りのページの印も) と id のページを消す */
      const resetFor = () => {
        if (this.lookaheadMark > mark) this.lookaheadMark = -1;
        forgetIds();
        if (host.nest) host.nest.hit = hitBefore;
      };
      // 1 段の page-sequence は、ページの境目を写して組み、最後のページのマスターを選び直すとき、境目から続けて組む (design/resumable-flow.md の 4.3 の 1)
      // 器の使い回しで、前の文書のこの page-sequence と、直した所の後ろの境目で揃ったら、残りのページを前の組版から繋ぐ
      const run = sequenceMasters(seq).some((m) => (m.columns?.count ?? 1) > 1) ? undefined : this.sequenceRun(seq, docStyle, host, first, needsLast, this.spliceTarget(si, seq, first, sideDelta, pages.length, needsLast));
      // 組みながらページを渡すか (design/pdf-writer.md の 12): 組み直しの 1 回目は、1 段で最後のページのマスターの無い page-sequence だけ
      // (段組と最後のページのマスターは、組み終えるまでページが決まらない)。渡せない page-sequence の後ろは、ページの順を保つために渡さない。
      // 2 回目からの回は、1 回目に渡したページを組み直したものを手放す
      if (emit) {
        emit.seqDone = 0;
        if (this.passIndex === 1) {
          if (!run || needsLast) emit.stopped = true;
          emit.seq = !emit.stopped;
        } else emit.seq = pages.length < emit.done;
      }
      // 本文 (flow) の置かれたページの数 (force-page-count で末尾に足す白ページを含まない)
      let flowPages = 0;
      const layoutSequence = (li: number | null, again: boolean) => {
        // 上限から遠い所の組み直しなら、組み直しで作った流れを、組む手間の上限の数えから除く (FlowHost.nest.charged)
        let uncount = false;
        const flows0 = this.stats.flows;
        let body = again ? run?.relayout(li, resetFor, (far) => (uncount = far)) : undefined;
        if (again) {
          const rs = (this.stats.resume ??= { boundaries: 0, resumable: 0, reasons: {}, resumed: 0, mismatched: 0, lastFromBoundary: 0, lastFromStart: 0 });
          if (body) rs.lastFromBoundary++;
          else rs.lastFromStart++;
        }
        if (!body) {
          if (again) {
            this.warnings.length = mark;
            resetFor();
          }
          body = this.layoutSequence(seq, docStyle, host, first, li, run);
        }
        if (uncount && host.nest) {
          const n = this.stats.flows - flows0;
          host.nest.charged = (host.nest.charged ?? 0) - n;
          const rs = this.stats.resume!;
          rs.uncounted = (rs.uncounted ?? 0) + n;
        }
        flowPages = body.length;
        // 段組の page-sequence を先頭から N ページで止めた (layoutColumnPass が受けた): 白ページは足さない
        return this.stopPass ? body : this.forcePageCount(body, seq, docStyle, first, li, nextIpn);
      };
      let built: PageBuild[];
      try {
        built = layoutSequence(lastIndex, false);
        if (needsLast && !this.stopPass) {
          for (let k = 0; k < 3 && built.length !== lastIndex; k++) {
            lastIndex = built.length;
            built = layoutSequence(lastIndex, true);
            if (built.length === lastIndex || this.stopPass) break;
            if (k === 2) {
              this.warnings.push(diag('layout/not-converged', msg('最終ページ用ページマスターの適用でページ数が収束しませんでした', 'the page count did not converge while applying the last-page page master'), { what: 'last-page-master' }));
              // page-sequence の全体の警告なので、文書がちょうど N + 1 ページで終わって見張りのページを捨てるときも残す
              this.keepLookaheadWarnings(this.warnings.length - 1);
            }
          }
        }
      } catch (e) {
        if (e !== PAGE_LIMIT) throw e;
        // 先頭から N ページで止めた (notePage): 組んでいたページの並びを取り、見張りのページを組む間の警告を除く。
        // 最後のページは分からないままなので、条件付きのマスター (§7.27.14) は、最後でないページとして選んだまま
        built = this.seqBuilding;
        resetFlowDepth(host);
        this.dropLookaheadWarnings();
      }
      if (this.stopPass) {
        const before = Math.min(pages.length, maxPages!);
        this.cutPages(pages, built, maxPages!, seq);
        this.citeLog = undefined;
        this.indexLog = undefined;
        this.indexSeq = undefined;
        this.lastFoot = undefined;
        if (this.lowMemory) this.releaseLow(pages, before, sink, prevTotal, host, docStyle, staticWarnings);
        break;
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
      // 組み終えた page-sequence の、まだ渡していないページを渡す
      if (emit?.seq) this.emitPages(built, built.length);
      if (emit) emit.seq = false;
      pushAll(pages, built);
      pageNo = first + built.length;
      this.fnCarry = this.lastFoot?.lastNumber ?? this.fnCarry;
      this.lastFoot = undefined;
      const runRec = this.reuseNow ? run?.record() : undefined;
      if (!this.lowMemory) this.seqMemo[si] = { first, ordinal: pages.length - built.length, sideDelta, fnCarryIn, cites: this.citeLog, built, fnCarryOut: this.fnCarry, warnings: this.warnings.slice(warnStart), ...this.idDiff(idsBefore!), ...(this.indexLog?.size ? { indexLists: this.indexLog } : {}), ...(this.beyondHits.length > beyondStart ? { beyond: this.beyondHits.slice(beyondStart) } : {}), ...(runRec ? { run: runRec } : {}), ...(this.reuseNow && this.fonts.handedCount > handBefore ? { handed: this.fonts.handedSince(handBefore) } : {}), ...(limitsHit.size ? { limits: [...limitsHit] } : {}), ...(this.fonts.noticeCount > noticesBefore ? { notices: true } : {}), ...(nextIpn !== undefined ? { nextIpn } : {}) };
      limitTap.fn = undefined;
      this.citeLog = undefined;
      this.indexLog = undefined;
      this.indexSeq = undefined;
      if (this.lowMemory) this.releaseLow(pages, pages.length - built.length, sink, prevTotal, host, docStyle, staticWarnings);
    }

    // 組む手間の上限の数えの、回ごとの最大 (器の使い回しは、上限の近くの文書では使わない。setupReuse)
    if (host.nest) {
      this.reuseCost.cost = Math.max(this.reuseCost.cost, this.stats.flows - host.nest.base + (host.nest.charged ?? 0));
      if (host.nest.hit) this.reuseCost.hit = true;
    }
    // 先頭から N ページで止める: 文書がちょうど N + 1 ページで終わった (N + 2 ページ目を作らなかった) ときも、見張りのページを捨てる
    if (maxPages !== undefined && !this.stopPass && pages.length > maxPages) {
      this.stopPass = true;
      this.dropLookaheadWarnings();
      this.cutPages(pages, [], maxPages, doc.sequences[doc.sequences.length - 1]);
    }
    // 止めた回は、総ページ数が分からない (-1。柱の中の総ページ数は、決まらない字にする)
    const total = this.cutInfo ? -1 : pages.length;
    if (sink) pushAll(this.warnings, staticWarnings);
    else {
      this.lineCount.clear();
      this.staticMemo = new Map();
      // 組みながら渡したページの柱は、渡すときに組んだ (警告をここに足し、行番号の数えは、渡した最後のページの後から続ける)
      const done = emit?.done ?? 0;
      if (emit && done) {
        pushAll(this.warnings, emit.staticWarnings);
        this.lineCount = new Map(this.passIndex === 1 && emit.lineCountRefused ? emit.lineCountRefused : emit.lineCount);
      }
      // ページの柱など (static-content) は、組み直しの回ごとに組む (中のページ番号の参照・索引の並びが、収束の判定に入る)。
      // メモリ節約のときは、判定のために組んで、箱は持たない (ページを領域の木にするのは、渡す先のある回)
      const statics = pages.map((p, i) => (i < done ? { nodes: [], wm: p.root.wm } : this.sheetStatics(p, total, host, docStyle, pages, i)));
      if (!this.lowMemory) this.passStatics = statics;
    }
    this.staticMemo = new Map();
    this.stats.nestMax = Math.max(this.stats.nestMax ?? 0, nest.maxSeen);
    this.stats.columnNestMax = Math.max(this.stats.columnNestMax ?? 0, nest.cSeen);
    if (this.cutInfo) this.noteCut(maxPages!);
  }

  /**
   * 先頭から N ページで止めた回の診断: 止めたこと (info) と、N ページより後ろを指して決まらなかったものを、種類ごとに 1 件 (warning)。
   * 索引は、止めた回で索引の並びを組んだら (後ろのページの所が抜ける)
   */
  private noteCut(max: number): void {
    this.warnings.push(diag('layout/max-pages-reached', msg(`先頭の ${max} ページまで組み、そこで止めました (maxPages)`, `stopped after the first ${max} pages (maxPages)`), { maxPages: max }));
    const byKind = new Map<BeyondKind, Set<string>>();
    for (const [k, id] of this.beyondHits) {
      let set = byKind.get(k);
      if (!set) byKind.set(k, (set = new Set()));
      set.add(id);
    }
    if (this.indexUsed.size) byKind.set('index', new Set([...this.indexUsed.keys()].map((_, k) => String(k))));
    for (const [kind, ids] of byKind) this.warnings.push(beyondDiagnostic(max, kind, [...ids], this.unresolvedMark));
  }

  /**
   * 収束した回の結果 (layoutOnce) を、領域の木 (Area Tree) にする。ページを Area にしたら、そのページの本文の論理の木を手放す
   * (この後は組み直さないので要らない。文書全体の論理の木と領域の木を、同時に持たない)
   */
  private finishTree(doc: LDocument): AreaTree {
    const pages = this.pagesBuilt;
    const statics = this.passStatics;
    this.passStatics = [];
    // 器が次の文書のために覚えるときは、ページの論理の木を手放さない (storeReuse)
    const keep = !!this.reuseNow && !this.cutInfo;
    const sheets: SheetArea[] = pages.map((p, i) => {
      const sheet = this.buildSheet(p, statics[i]);
      if (!keep) releasePage(p);
      return sheet;
    });
    this.registerGradients(sheets);
    if (this.paintEffects) applyPaintEffects(sheets, this.paintEffects);
    const { bookmarks, destinations, warnings, diagnostics } = this.treeInfo(doc, pages);
    return {
      schemaVersion: AREA_TREE_SCHEMA_VERSION,
      title: doc.title ?? doc.info?.title,
      info: doc.info,
      ...(bookmarks ? { bookmarks } : {}),
      ...(doc.structure?.length ? { structure: areaStructure(doc, this.docNodes) } : {}),
      destinations,
      sheets,
      warnings,
      // 診断は、あるときだけ書く (警告の無い文書の木は、診断を足す前と同じ)
      ...(diagnostics?.length ? { diagnostics } : {}),
      ...(this.cutInfo ? { truncated: { maxPages: this.options.maxPages! } } : {}),
    };
  }

  /** 領域の木の、ページ (sheets) のほかの情報: しおり (飛び先をシートの番号に解決したもの)・文書内リンクの飛び先・警告 */
  private treeInfo(doc: LDocument, pages: PageBuild[]): Pick<AreaTree, 'bookmarks' | 'destinations' | 'warnings' | 'diagnostics'> & { destinations: Record<string, number> } {
    // しおりの飛び先 (id) を、シートの番号に解決する
    const beyondBookmarks = new Set<string>();
    const resolve = (bs: LBookmark[] | undefined): BookmarkArea[] =>
      (bs ?? []).map((b) => {
        const pb = this.idPageBuild.get(b.ref);
        // 先頭から N ページで止めた組版で、N ページより後ろにある飛び先は、見つからない飛び先にしない (決まらないしおりとして数える)
        if (!pb && b.ref && this.cutInfo && (this.cutInfo.first.has(b.ref) || this.docIds().has(b.ref))) beyondBookmarks.add(b.ref);
        else if (!pb && b.ref) this.warnings.push(diag('layout/missing-id', msg(`しおりの飛び先 id="${b.ref}" が見つかりません`, `bookmark destination id="${b.ref}" was not found`), { id: b.ref, kind: 'bookmark' }));
        // 文書の外への飛び先 (fo:bookmark の external-destination。XSL 1.1 §6.11.2・§7.23.6) は、文書の中の飛び先 (ref) が無いときだけ通す
        return { title: b.title, sheet: pb ? pages.indexOf(pb) : -1, ...(!b.ref && b.href ? { external: b.href } : {}), open: b.open ?? true, children: resolve(b.children) };
      });
    // 文書内リンクの飛び先: id → シートの番号
    const pageIndex = new Map(pages.map((p, k) => [p, k]));
    const destinations: Record<string, number> = Object.create(null);
    for (const [id, pb] of this.idPageBuild) {
      const k = pageIndex.get(pb);
      if (k !== undefined) destinations[id] = k;
    }
    // 索引のページ番号のリンクのうち、ページそのものを飛び先にするもの (範囲の途中のページ・ページをまたぐ所の 2 ページ目から)
    for (const ex of this.indexUsed.values()) for (const n of ex.pageDests) if (n < pages.length) destinations[indexPageDest(n)] = n;
    const bookmarks = doc.bookmarks?.length ? resolve(doc.bookmarks) : undefined;
    if (beyondBookmarks.size) this.warnings.push(beyondDiagnostic(this.options.maxPages!, 'bookmark', [...beyondBookmarks], this.unresolvedMark));
    // 同じ警告 (同じ画像を何度も置いたときなど) は 1 つにまとめ、見つからない飛び先の警告は、種類ごとに 1 行にまとめる
    // 診断は、同じもの (名前・文・場所が同じ) を 1 件にして数を数え、見つからない飛び先も 1 件ずつ残す
    const kept = this.kept(this.warnings);
    const diagnostics = mergeDiagnostics(kept);
    return { ...(bookmarks ? { bookmarks } : {}), destinations, warnings: groupMissingIdWarnings([...new Set(kept.map((d) => d.message))]), ...(diagnostics.length ? { diagnostics } : {}) };
  }

  /** 出さない名前 (LayoutOptions.ignoreDiagnostics) の診断を除く */
  private kept(ds: Diagnostic[]): Diagnostic[] {
    const ign = this.options.ignoreDiagnostics;
    return ign?.size ? ds.filter((d) => !ign.has(d.code)) : ds;
  }

  /**
   * force-page-count (§7.27.6): ページ数の偶奇・最後のページの偶奇が合うまで、末尾に白ページを足す。
   * auto (既定) は、次の page-sequence の initial-page-number が数値のときだけ、それに続くよう最後のページの偶奇を合わせる
   */
  private forcePageCount(built: PageBuild[], seq: LPageSequence, docStyle: ResolvedStyle, first: number, lastIndex: number | null, nextIpn: LPageSequence['initialPageNumber']): PageBuild[] {
    const mode = seq.forcePageCount ?? 'auto';
    this.seqBuilding = built;
    // 数値 (アンテナハウスの拡張): そのページ数になるまで白ページを足す
    if (typeof mode === 'number') {
      while (built.length < Math.min(mode, 10000)) {
        built.push(this.blankPage(seq, docStyle, built.length + 1, first + built.length, lastIndex));
        this.notePage(built.length);
      }
      return built;
    }
    const ok = (count: number) => {
      const last = first + count - 1;
      // 最後のページの左右 (end-on-even・end-on-odd: 次の page-sequence を右・左ページから始める HTML の左右の区切り): ページの順で決める
      // 文書では、順の偶奇 (FlowHost.sideDelta)
      const lastSide = last + this.sideDelta;
      switch (mode) {
        case 'even': return count % 2 === 0;
        case 'odd': return count % 2 === 1;
        case 'end-on-even': return lastSide % 2 === 0;
        case 'end-on-odd': return lastSide % 2 === 1;
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
    for (let guard = 0; !ok(built.length) && guard < 2; guard++) {
      built.push(this.blankPage(seq, docStyle, built.length + 1, first + built.length, lastIndex));
      this.notePage(built.length);
    }
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
      // ページの順で左右を決める文書では、順の偶奇 (FlowHost.sideDelta。CSS Paged Media 3 §3.3・§4.2.1 の :left・:right)
      const parityOk = oe === 'any' || (oe === 'odd') === ((pageNumber + this.sideDelta) % 2 === 1);
      const bn = c.blankOrNotBlank ?? 'any';
      const blankOk = (bn === 'any' || (bn === 'blank') === blank) && (!c.trailingBlank || (blank && trailing));
      // :nth(An+B) (CSS GCPM 3 §3.1): 順 n が、ある 0 以上の整数 k で a·k + b になるか (Selectors 4 §14.1 の An+B)
      const nthOk = !c.nth || c.nth.every(({ a, b, group }) => anPlusB(a, b, group ? index : this.seqOrdinal + index));
      return pos(c) && parityOk && blankOk && nthOk;
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
    // 脚注・前方 float はページ全体 (全段を貫く) の領域に置く。その高さは組んでみないと分からないので、ページごとの予約を直しながら、
    // 安定するまで組み直す。
    // 脚注の予約 (本文領域の下) は、組版の中で、ページの始まりごとに決める (layoutColumnPass の botAt): 前の回の脚注の参照の、本文の
    // 並びの位置から、そのページに入る参照と要る高さを見積もり、収まる最小の予約にする。同じ所から始まるページは、前の回に収まった
    // 予約に固め、収まらなかったら上げる (ColumnReservePlan)。ページの始まりから決めるので、前のページの予約が変わって本文がずれても、
    // 後ろのページの予約はずれた本文に合わせて決まり、長い文書でも数回で収まる。
    // 前は、ページの番号ごとに、前の回の要る高さを予約にし、初めの 10 回は前から 1 ページずつ固め、残りの回 (全部で 16 回まで) は
    // 増やすだけにしたので、脚注の多い長い文書では、前から固める回が文書の初めの数ページしか進まず、増やすだけの回が、ずれる前の
    // 要る高さを予約に積んで、本文が数行だけで脚注の無いページが文書じゅうにでき、ページと時間が増えた。
    // 前方 float の予約 (本文領域の上) は、前から順に固める: 予約と要る高さが初めて食い違うページ (前線) より前は変えず、
    // 前線のページは要る高さにし (減らすのはページごとに 1 度だけ)、前線より後ろのページは、この回の要る高さに置き換える。
    // FRONT_PASSES を超えたら増やすだけにする (前方 float の組み直しは前と同じ)。
    // 回数の上限で終わっても、本番の脚注は本文が実際に使った高さの下に限るので、本文と重ならない (入らない分は次のページへ続ける)
    const FRONT_PASSES = 10;
    const MAX_PASSES = 16;
    const reserves = { top: new Map<number, number>(), bot: new Map<number, number>() };
    /** 前方 float の予約を 1 度減らしたページ */
    const lowered = new Set<number>();
    const plan = new ColumnReservePlan();
    let out = this.layoutColumnPass(seq, docStyle, host, firstNumber, lastIndex, reserves, plan);
    for (let pass = 1; pass < MAX_PASSES; pass++) {
      // 脚注: この回に試した予約と要った高さを覚え、次の回に予約を変えるページがあるか
      // 参照は組んだ順に足すので、ふつうは位置の順に並んでいる (表・入れ子の箱の中の参照は、前後することがあるので並べる)
      plan.refs = out.refs.sort((x, y) => x.pos - y.pos);
      let changed = false;
      for (const [abs, d] of out.decided) {
        const r = reserves.bot.get(abs) ?? 0;
        const need = out.needs.get(abs)?.bot ?? 0;
        let list = plan.tries.get(d.key);
        if (!list) plan.tries.set(d.key, (list = []));
        if (!list.some((t) => Math.abs(t.r - r) < 0.05)) list.push({ r, need });
        if (Math.abs(plan.choose(list, d.model, d.maxR) - r) > 0.01) changed = true;
      }
      // 前方 float
      const need = (abs: number) => out.needs.get(abs)?.top ?? 0;
      const has = (abs: number) => reserves.top.get(abs) ?? 0;
      /** 前線として直すか (増やすか、まだ 1 度も減らしていない予約を減らす) */
      const moves = (abs: number) => need(abs) > has(abs) + 0.01 || (need(abs) < has(abs) - 0.01 && !lowered.has(abs));
      const abss = [...new Set([...out.needs.keys(), ...reserves.top.keys()])].sort((x, y) => x - y);
      const front = abss.find(moves);
      if (front !== undefined) {
        for (const abs of abss) {
          if (abs < front) continue;
          const w = need(abs);
          const h = has(abs);
          let v = Math.max(w, h);
          if (pass < FRONT_PASSES) {
            if (abs !== front) v = w;
            else {
              if (w < h) lowered.add(abs);
              v = w;
            }
          }
          if (Math.abs(v - h) <= 0.01) continue;
          changed = true;
          if (v > 0.01) reserves.top.set(abs, v);
          else reserves.top.delete(abs);
        }
      }
      if (!changed) break;
      this.warnings.length = out.mark;
      if (this.lookaheadMark > out.mark) this.lookaheadMark = -1;
      for (const k of this.idPages.keys()) if (!out.idKeys.has(k)) this.idPages.delete(k);
      for (const k of this.idPageBuild.keys()) if (!out.idKeys.has(k)) this.idPageBuild.delete(k);
      out = this.layoutColumnPass(seq, docStyle, host, firstNumber, lastIndex, reserves, plan);
    }
    return out.pages;
  }

  /**
   * 段組の 1 回の組版 (layoutColumnPass) の、群 (span の切り替えで分けた本文の並び) の組版。items を startAbs ページの startTop から組み、
   * 最後のページ番号 (lastAbs)・そのページの使用量 (ページ先頭から。lastUsed)・末尾に残った余白 (trailing) を返す。
   * 段 (または span の全幅) ごとに箱を作って Flow に渡し、Flow の nextPage で次の段・次のページへ進む。o.trial なら試し組み (ページに何も残さない)
   */
  private runColumnGroup(cx: ColumnPassCtx, items: Array<LBlockLevel | LInlineLevel>, startAbs: number, startTop: number, o: RunOpts) {
    const { seq, host, firstNumber, reserves, pageItems, bodyEnds, wm, flowSt, foot, beforeSep, pageMode, geoAt, ensurePage, sizeAt } = cx;
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
    /** 本文の並びの位置 (いまの段の始まりまでに、段・span が使った高さの和。脚注の予約の見積もりに使う) */
    let lin = cx.lin.v;
    /** 試し組みの脚注と、その見積もりの続き (試し組みのページの予約を、本番と同じに決める) */
    const trialFoots = o.trial ? { items: new Map<number, ColumnPageItems>(), conts: new Map<number, FootEntry[]>() } : undefined;
    const colRoot = () => {
      const g = geoAt(abs);
      const start = col === 0 && top <= (reserves.top.get(abs) ?? 0) + EPS;
      let limit = g.limit - top - cx.botAt(abs, lin, top, start, trialFoots);
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
          if (!o.trial) pushAll(ensurePage(abs).markers, this.takeIndexPoints(list, (id) => this.noteIdPage(id, firstNumber + abs, seq.pageNumberFormat, ensurePage(abs))));
        },
        markerEnd: (key) => {
          if (!o.trial) (ensurePage(abs).markerEnds ??= []).push(key);
        },
        noteId: (id) => {
          if (!o.trial) this.noteIdPage(id, firstNumber + abs, seq.pageNumberFormat, ensurePage(abs));
        },
        columnEnd: (used) => {
          // span は全段を貫くので、段の数を掛けて数える (段に分けたときの本文の量にそろえる)
          lin += used * (o.span ? geoAt(abs).n : 1);
          usedOn.set(abs, Math.max(usedOn.get(abs) ?? 0, top + used));
          if (!o.trial) bodyEnds.set(abs, Math.max(bodyEnds.get(abs) ?? 0, top + used));
        },
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
              // 参照までの本文 (前の段の全部と、この段の at まで) を、このページの段に分けて収めるのに要る高さ。
              // 行は分けられないので、1 行の高さの余裕を足す (段組でなければ、参照する行の終わりまで)
              const n = o.span ? 1 : geoAt(abs).n;
              const end = top + (n === 1 ? at : (col * Math.max(colLimit, 0) + at) / n + lineHeightOf(flowSt));
              let it: ColumnPageItems | undefined;
              if (trialFoots) {
                it = trialFoots.items.get(abs);
                if (!it) trialFoots.items.set(abs, (it = { floats: [], foots: [], footEnds: [] }));
              } else {
                it = itemsAt(abs);
                cx.refs.push({ pos: lin + at * (o.span ? geoAt(abs).n : 1), e });
              }
              it.foots.push(e);
              it.footEnds.push(end);
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
    else {
      go();
      cx.lin.v = lin;
    }
    return { lastAbs: abs, lastUsed: usedOn.get(abs) ?? top, trailing: flow.trailingSpace, over: flow.overflowCount };
  }

  private layoutColumnPass(
    seq: LPageSequence,
    docStyle: ResolvedStyle,
    host: FlowHost,
    firstNumber: number,
    lastIndex: number | null,
    reserves: { top: Map<number, number>; bot: Map<number, number> },
    plan: ColumnReservePlan,
  ) {
    const mark = this.warnings.length;
    // 脚注の予約は、この回の組版の中で、ページの始まりごとに決める (botAt)
    reserves.bot.clear();
    const idKeys = new Set(this.idPages.keys());
    const needs = new Map<number, { top: number; bot: number }>();
    const pageItems = new Map<number, ColumnPageItems>();
    const bodyEnds = new Map<number, number>();
    const pages: PageBuild[] = [];
    this.seqBuilding = pages;
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
        this.notePage(pages.length);
      }
      return pages[abs];
    };
    const sizeAt = (abs: number): PageSizeInfo => {
      const g = geoAt(abs);
      const h = wm === 'horizontal-tb';
      const mg = g.m.margins;
      return {
        width: mm(g.m.width),
        height: mm(g.m.height),
        body: { width: h ? g.rootI : g.limit, height: h ? g.limit : g.rootI },
        area: { top: mm(mg.top), right: mm(mg.right), bottom: mm(mg.bottom), left: mm(mg.left) },
      };
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
      sub.layoutBlock(footBlock(fn, fo, label, footSt.fontSize, wm), footSt);
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

    const lh = lineHeightOf(flowSt);
    /** 予約を決めたページの、始まりの位置と、選んだときの見積もり (layoutColumnSequence が、試した予約を覚えるのに使う) */
    const decided = new Map<number, { s: number; key: string; trial: boolean; model: number; maxR: number }>();
    /** 見積もりの、前のページから続く脚注 (上限を付けない配置の残り。本番の組版のページから求めたもの) */
    const estConts = new Map<number, FootEntry[]>([[0, []]]);
    /** abs のページへ前のページから続く脚注の見積もり (この回の、abs より前のページの脚注と予約から) */
    const contsAt = (abs: number, trial: { items: Map<number, ColumnPageItems>; conts: Map<number, FootEntry[]> } | undefined): FootEntry[] => {
      const get = (a: number) => trial?.conts.get(a) ?? estConts.get(a);
      let a = abs;
      while (a > 0 && !get(a)) a--;
      let cur = get(a) ?? [];
      for (; a < abs; a++) {
        if (!blankAbs.has(a)) {
          const real = pageItems.get(a);
          const t = trial?.items.get(a);
          const foots = t ? [...(real?.foots ?? []), ...t.foots] : (real?.foots ?? []);
          const footEnds = t ? [...(real?.footEnds ?? []), ...t.footEnds] : (real?.footEnds ?? []);
          if (cur.length || foots.length) {
            const g = geoAt(a);
            const room = g.limit - (reserves.top.get(a) ?? 0);
            cur = placeColumnFoots({ foot, room, limit: g.limit, reserve: reserves.bot.get(a) ?? 0, cap: Infinity, conts: cur, foots, footEnds, dry: true }).out;
          }
        }
        (trial ? trial.conts : estConts).set(a + 1, cur);
      }
      return cur;
    };
    /**
     * 始まりの位置が s のページに入る脚注と、収まる最小の予約を見積もる。前の回の参照 (plan.refs) のうち、本文の並びの位置が s より後ろのものを、
     * 参照までの本文を段に収めるのに要る高さ (footEnds と同じ数え方) で並べ、その高さが予約の下に入る参照だけの脚注を置いて、
     * 要る高さが予約を超えない最小の予約を探す (参照が入るかは、予約が参照の位置を越えるところで変わり、その間の要る高さは変わらない)
     */
    const estimateBot = (g: ColumnGeo, s: number, top: number, conts: FootEntry[], maxR: number): number => {
      const n = g.n;
      const room = g.limit - top;
      const cand: Array<{ e: FootEntry; end: number; b: number }> = [];
      // 参照の位置は、参照する行の下端 (ページの始まりと同じ位置の参照は、前のページの最後の行にある)
      for (let k = plan.lowerBound(s + 0.05); k < plan.refs.length; k++) {
        const end = top + (plan.refs[k].pos - s) / n + lh;
        if (end > g.limit + EPS) break;
        cand.push({ e: plan.refs[k].e, end, b: Math.max(0, g.limit - end) });
      }
      if (!cand.length && !conts.length) return 0;
      const need = (fs: typeof cand, r: number) =>
        Math.min(maxR, placeColumnFoots({ foot, room, limit: g.limit, reserve: r, cap: Infinity, conts, foots: fs.map((c) => c.e), footEnds: fs.map((c) => c.end), dry: true }).b);
      const pts = [...new Set(cand.map((c) => c.b))].sort((x, y) => x - y);
      /**
       * 参照の行を次のページへ移す予約の、参照の位置 (end に入る予約の上限) から越える量。参照までの本文が、段をすき間なく
       * 埋めても入らない予約 (end から 1 行の高さを引いた位置を越える予約)
       */
      const drop = lh + 0.01;
      for (let i = 0; i <= pts.length; i++) {
        const low = i === 0 ? 0 : pts[i - 1] + drop;
        const high = Math.min(i < pts.length ? pts[i] : Infinity, maxR);
        if (low > high + EPS) continue;
        const fs = i < pts.length ? cand.filter((c) => c.b >= pts[i] - EPS) : [];
        const r = Math.max(low, need(fs, low));
        if (r <= high + EPS) return Math.min(r, maxR);
      }
      return maxR;
    };
    const botAt: ColumnPassCtx['botAt'] = (abs, s, top, start, trial) => {
      const d = decided.get(abs);
      if (d && (!start || Math.abs(d.s - s) < 0.05 || (trial && !d.trial))) return reserves.bot.get(abs) ?? 0;
      const g = geoAt(abs);
      const maxR = Math.max(0, g.limit - top - lh * 1.5);
      const cts: FootEntry[] = pageMode ? contsAt(abs, trial) : [];
      const model = pageMode ? estimateBot(g, s, top, cts, maxR) : 0;
      const key = ColumnReservePlan.key(s, top, g.limit, g.n, cts);
      const r = pageMode ? plan.choose(plan.tries.get(key) ?? [], model, maxR) : 0;
      decided.set(abs, { s, key, trial: !!trial, model, maxR });
      if (r > 0.01) reserves.bot.set(abs, r);
      else reserves.bot.delete(abs);
      return r;
    };
    const refs: ColumnPassCtx['refs'] = [];
    const cx: ColumnPassCtx = { seq, host, firstNumber, reserves, pageItems, bodyEnds, wm, flowSt, foot, beforeSep, pageMode, geoAt, ensurePage, sizeAt, markBlank, botAt, lin: { v: 0 }, refs };
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
    // 先頭から N ページで止める (maxPages): 組み直しの回ごとに数え直す (前の回で止めても、この回で止まらなければ止めない)。
    // N + 2 ページ目を作った所で notePage が投げたら、そこまでのページに、脚注・前方 float を置いて返す
    this.stopPass = false;
    /** この page-sequence の中で作ってよいページの数 (見張りのページまで) */
    const pageCap = this.options.maxPages !== undefined ? this.options.maxPages + 1 - this.pagesBuilt.length : Infinity;
    try {
      groups.forEach((g, gi) => {
        const blocks = g.items.filter((c): c is LBlock => typeof c !== 'string' && c.type === 'block');
        // グループの先頭での強制改ページ (段の先頭なので column は不要)。odd-page / even-page は偶奇が合うまで白ページを挟む
        const before = blocks[0] === g.items[0] ? blocks[0]?.breakBefore : undefined;
        const kind = forceNew && forceNew !== 'column' ? forceNew : before && before !== 'column' ? before : null;
        forceNew = null;
        if (kind) {
          carry = 0;
          if (top > (reserves.top.get(abs) ?? 0) + EPS) abs++;
          if ((kind === 'odd-page' || kind === 'even-page') && ((firstNumber + abs + this.sideDelta) % 2 === 1) !== (kind === 'odd-page')) markBlank(abs++);
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
            // 段数に収まる (最後のページから次のページへ送られない) 最小の高さを探す。空の段の先頭でも入らずにはみ出させた行・箱が、
            // 高さを限らない試し組み (t0) より増える高さは、収まるとみなさない (その高さで本番を組むと、行が段からはみ出して
            // 「行がページに収まりません」と警告し、段の高さ・段間の罫も、はみ出した行より短くなる。1 つの箱に組む段組の釣り合わせの
            // balanced と同じ。CSS Multi-column 1 §7.1 の balance は、内容を段に収めたうえで、段の高さをできるだけそろえる)
            for (let k = 0; k < 14 && hi - lo > 0.1; k++) {
              const mid = (lo + hi) / 2;
              const r = run(g.items, abs, top, { span: false, trial: true, carry, lastLimit: { abs: A, h: mid } });
              if (r.lastAbs === A && r.over <= t0.over) hi = mid;
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
    } catch (e) {
      if (e !== PAGE_LIMIT) throw e;
      resetFlowDepth(host);
    }
    // ページ単位の領域: 前方 float は本文領域の上端、脚注は下端に、全段を貫いて置く。必要な高さは呼び出し側へ返す。
    // 本文領域に収まらない脚注は、行の単位で分けて、残りを次のページの脚注領域の先頭へ続ける (XSL 1.1 §6.12.3: 脚注の 2 つ目からの
    // 領域は、続くページに、ほかの内容より先に置く。1 段のページの Flow.pushFootnote と同じ決まり)
    const queue = [...pageItems.keys()].sort((x, y) => x - y);
    /** 本文のページの数 (これより後ろは、脚注の続きのために足すページ) */
    const contentPages = pages.length;
    /** 本文の後に足す、脚注の続きのページの守り (本文の後に続けて足すページの間だけで数える) */
    const contGuard = new ContinuationGuard();
    /** 前のページから続く脚注 (分けた残りと、その後ろの脚注)。本番に置くもの (本文が実際に使った高さの下に限って置いた残り) */
    let carried: FootEntry[] = [];
    /**
     * 前のページから続く脚注のうち、上限を付けずに置いたときの残り (本文に空ける高さ (needs) を数えるためのもの)。
     * 本番の残り (carried) は、組み直しの途中の本文が脚注の領域まで埋めたページ (1 回目の組版は予約が無いので、どのページもそうなる) では、
     * そのページの脚注をすべて含む。それを次のページの予約に数えると、脚注が元のページに戻った後も次のページに要らない予約が残り
     * (予約は増やすだけ)、ページを追って段が縮んだ
     */
    let carriedWant: FootEntry[] = [];
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi];
      const it = pageItems.get(a) ?? { floats: [], foots: [], footEnds: [] };
      const pg = ensurePage(a);
      const g = geoAt(a);
      let y = 0;
      it.floats.forEach((f, k) => {
        const { gap, tail } = beforeFloatSpacing(it.floats[k - 1], f);
        f.box.i = f.m.is + Math.max(g.rootI - f.outerI, 0) / 2;
        f.box.b = y + gap + f.m.bs;
        pg.root.children.push(f.box);
        y += gap + f.outerB + tail;
      });
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
      const contsWant = blankAbs.has(a) ? [] : carriedWant.splice(0);
      /** 本番の続きと、上限を付けないときの続きが同じか (同じなら、上限を付けずに置いた結果を本番にも使える) */
      const sameConts = conts.length === contsWant.length && conts.every((e, k) => e === contsWant[k]);
      if (it.foots.length || conts.length || contsWant.length) {
        /** このページの本文領域で、脚注領域に使える高さ (前方 float の下から) */
        const room = g.limit - topH;
        /** 脚注を置く (placeColumnFoots)。carried は書き換えない */
        const layoutFoots = (cap: number, conts: FootEntry[]) =>
          placeColumnFoots({ foot, room, limit: g.limit, reserve: reserves.bot.get(a) ?? 0, cap, conts, foots: it.foots, footEnds: it.footEnds });
        // 本文に空ける高さ (needs) は、上限を付けずに置いたときの高さ。本番では、それに加えて、このページの本文が実際に使った
        // 高さの下に限る (組み直しが安定しないまま終わっても、脚注を本文の行に重ねない。入らない分は次のページへ続ける)
        // 上限を付けない配置は、上限を付けない配置の続き (carriedWant) から組む
        const want = layoutFoots(Infinity, contsWant);
        const bodyEnd = bodyEnds.get(a);
        const safe = bodyEnd === undefined ? Infinity : g.limit - Math.max(bodyEnd, topH);
        const r = sameConts && want.b <= safe + EPS ? want : layoutFoots(safe, conts);
        for (const e of r.warns) host.warn(withSource(diag('layout/footnote-overflow', msg('脚注がページに収まらないため溢れます', 'a footnote does not fit on the page and overflows')), e.node));
        carried.push(...r.out);
        carriedWant.push(...want.out);
        // 予約は、本文のあるページでは本文の 1 行半の高さを残す (脚注の領域が本文の領域をすべて締め出すと、段の高さが 1 行より低くなり、
        // 本文の行がはみ出して「行がページに収まりません」になる。脚注の参照の印を上付きにした行は、行の高さより高くなることがあるので、
        // 半行の余裕を足す。入らない脚注は、本番の配置で次のページへ続ける。予約を決める botAt の上限と同じ)
        botH = bodyEnd === undefined ? want.b : Math.min(want.b, Math.max(0, room - lineHeightOf(flowSt) * 1.5));
        if (r.placed.length) {
          const area = newNode('block', wm, { isize: g.rootI, bsize: r.b, i: 0, b: g.limit - r.b });
          const sepNode = foot.makeSeparator(wm, g.rootI);
          if (sepNode) area.children.push(sepNode);
          for (const e of r.placed) area.children.push(e.node);
          pg.root.children.push(area);
        }
      }
      needs.set(a, { top: topH, bot: botH });
      // 続きが残っていて、次のページに脚注・前方 float が無ければ、次のページも見る (本文の終わりより後ろなら、脚注だけのページを足す)
      // 上限を付けないときだけの続き (carriedWant) も、本文のページなら次のページの予約に数える
      if ((carried.length || (carriedWant.length && a + 1 < contentPages)) && queue[qi + 1] !== a + 1) {
        // 本文の途中 (次のページも本文のページ) では止めない: ページの数は本文のページの数までで、必ず終わる。
        // 本文の後に足すページだけ、進まなくなったら・上限を超えたら止める (1 段のページと同じ守り。ContinuationGuard)。
        // 本文の途中の呼び出しを数えると、離れたページで 1 つの脚注の残りの高さがたまたま同じになっただけで止め、置けるはずの残りを捨てた
        // 先頭から N ページで止めるときは、見張りのページ (N + 1 ページ目) より後ろへ続けない (後ろのページは作らずに捨てる。
        // 続きがあるので、文書はそれより長い)
        if (a + 1 >= pageCap) {
          carried = [];
          this.stopPass = true;
        } else if (a + 1 >= contentPages && !contGuard.next(host, carried)) carried = [];
        else queue.splice(qi + 1, 0, a + 1);
      }
      // 次のページを見ないなら、上限を付けないときだけの続きは捨てる (離れたページの予約に数えない)
      if (queue[qi + 1] !== a + 1) carriedWant = [];
    }
    return { pages, needs, mark, idKeys, decided, refs };
  }

  /** page-sequence を初めから組む。run は 1 段の page-sequence の組み (onceSteps が、境目から続けて組むために作って渡す) */
  private layoutSequence(seq: LPageSequence, docStyle: ResolvedStyle, host: FlowHost, firstNumber: number, lastIndex: number | null, run?: SeqRun): PageBuild[] {
    if (sequenceMasters(seq).some((m) => (m.columns?.count ?? 1) > 1)) {
      return this.layoutColumnSequence(seq, docStyle, host, firstNumber, lastIndex);
    }
    return (run ?? this.sequenceRun(seq, docStyle, host, firstNumber, false)).layout(lastIndex);
  }

  /**
   * 1 段の page-sequence の組み (design/resumable-flow.md の 4.2)。layout は初めから組み、relayout は、写したページの境目から続けて組む
   * (最後のページのマスターを選び直すとき。続けられる境目が無ければ undefined)。capture なら、ページの境目を写す
   * (LayoutOptions.resumeCheck のときも写し、続きから組める境目のすべてで、1 ページ先まで組んでから境目に戻って続きから組む)
   */
  private sequenceRun(seq: LPageSequence, docStyle: ResolvedStyle, host: FlowHost, firstNumber: number, capture: boolean, splice?: SpliceTarget): SeqRun {
    const check = this.options.resumeCheck ?? resumeProbe.check;
    const late = check ? 0 : (resumeProbe.late ?? 0);
    /** 試し (指紋を比べ、境目のときの id の記録を持つ) */
    const probe = check || late > 0;
    // 器が次の文書のために覚えるときも、境目を写す (次の文書が、この組版と繋ぐ)
    const keep = capture || probe || (!!this.reuseNow && !this.indexKeys);
    if (probe) splice = undefined;
    /** 次の文書が繋ぐための記録 (record) の、組みの初めと終わりの警告の数・脚注の最後の番号・ページの数 */
    const recAt: { warnStart: number; warnEnd: number; footEnd: number; pages: number; rootI?: number; limit?: number; handStart: number; handed: Array<[string, LoadedFont]> } = { warnStart: 0, warnEnd: 0, footEnd: 0, pages: 0, handStart: 0, handed: [] };
    /** 前の組版と揃った、前の組版の境目 (SPLICE を投げた所) と、繋いだ結果 */
    let spliceAt: SeqBoundary | undefined;
    let spliced: { at: number; pages: number } | undefined;
    /** 繋ぐ確かめ (resumeProbe.spliceVerify): 揃った境目と、そのときの警告の数 */
    let verifyAt: { pb: SeqBoundary; warn: number } | undefined;
    /** 前の組版と初めに揃った境目 (そこから SPLICE_LEAD ページまで組んでから繋ぐ) */
    let alignedAt: number | undefined;
    /** 繋ぐ確かめで、前を飛ばしたはずの境目 (そこまで組んだら、前の組版と同じかを確かめる) */
    let prefixAt: SeqBoundary | undefined;
    let lastIndex: number | null = null;
    let pages: PageBuild[] = [];
    let recs: PageRecord[] = [];
    const flowSt = resolveStyle(resolveStyle(docStyle, seq), seq.flow);
    const wm = flowSt.wm;
    const mkPage = (blank = false) => {
      recs.push({ warnStart: this.warnings.length, ids: [], cites: [] });
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
      this.notePage(pages.length);
      // 組みながらページを渡す: 次のページを作ったので、前のページまでは組み終えた
      if (this.emitState?.seq) this.emitPages(pages, pages.length - 1);
      return { p, rootI, limit };
    };
    /** 次に作るページ (白ページでないもの) の本文領域の block 方向の上限 (mkPage と同じ求め方。ページは作らない) */
    const nextPageLimit = () => {
      const m = this.selectMaster(seq, pages.length + 1, firstNumber + pages.length, lastIndex, false).master;
      const rw = mm(m.width) - mm(m.margins.left) - mm(m.margins.right);
      const rh = mm(m.height) - mm(m.margins.top) - mm(m.margins.bottom);
      const brot = m.bodyRotation ?? 0;
      const [lw, lh] = brot === 90 || brot === 270 ? [rh, rw] : [rw, rh];
      return wm === 'horizontal-tb' ? lh : lw;
    };
    let firstPage!: ReturnType<typeof mkPage>;
    let cur!: PageBuild;
    let foot!: FootnoteCtx;
    let flow!: Flow;
    const pageSize = (): PageSizeInfo => {
      const r = cur.root;
      const h = wm === 'horizontal-tb';
      return { width: mm(cur.master.width), height: mm(cur.master.height), body: { width: h ? r.isize : r.bsize, height: h ? r.bsize : r.isize } };
    };
    // 脚注本体: 脚注用スタイル (既定は本文の 0.8 倍・左/上揃え) で、本文領域の inline サイズいっぱいに組む
    const fo = seq.footnotes ?? {};
    const footSt = resolveStyle(flowSt, { textAlign: 'start', textIndent: 0, ...fo.style, fontSize: fo.style?.fontSize ?? flowSt.fontSize * 0.8 });
    const makeFoot = () => {
      // 脚注本体の幅は、参照する行のあるページの本文領域の幅 (幅の違うページマスターへ続いた段落の脚注は、そのページの幅で組む)
      const f = new FootnoteCtx(fo.continueNumbering ? { ...fo, startNumber: this.fnCarry + 1 } : fo, (fn: LFootnote, label: string, width = firstPage.rootI) => {
        const sub = new Flow(host, { wm, rootI: width, abs: () => [], pageSize, measure: true });
        sub.layoutBlock(footBlock(fn, fo, label, footSt.fontSize, wm), footSt);
        const { height, after } = sub.finishWithTrailing();
        return { node: newNode('block', wm, { isize: width, bsize: height, children: sub.root.children }), height, ...(after > 0 ? { after } : {}) };
      }, (children) => {
        const sub = new Flow(host, { wm, rootI: firstPage.rootI, abs: () => [], pageSize, measure: true });
        sub.layoutChildren(children, flowSt);
        const height = sub.finishAtomic();
        return { node: newNode('block', wm, { isize: firstPage.rootI, bsize: height, children: sub.root.children }), height };
      });
      this.lastFoot = f;
      if (fo.reset === 'page') {
        this.fnResetUsed = true;
        f.pageOrder = this.fnOrder;
        const seqKey = this.seqKey(seq);
        f.onPlaced = (fn, page) => this.fnPlaced.set(fn, seqKey * 1e6 + page); // ページ番号は page-sequence ごとに重なりうる
      }
      return f;
    };
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
            const r = sn && ((cur.number + this.sideDelta) % 2 === 1 ? sn.end : sn.start);
            return r ? { i: mm(r.x), width: mm(r.width) } : undefined;
          },
          layout: (fn: LFootnote, width: number): FootEntry => {
            const sub = new Flow(host, { wm, rootI: width, abs: () => [], pageSize, measure: true });
            const label = foot.markerLabel(fn);
            const body: LFootnote = { ...fn, children: withLabel(fn.children, label) as LFootnote['children'] };
            copySourceRef(fn, body);
            sub.layoutBlock(footBlock(body, fo, label, footSt.fontSize, wm), footSt);
            const height = sub.finishWithTrailing().height;
            return { node: newNode('block', wm, { isize: width, bsize: height, children: sub.root.children }), height };
          },
        }
      : undefined;
    // ── ページの境目の写し (design/resumable-flow.md の 4.2) ──
    /** 写した境目 (ページの数で引く。続きから組んだら、続けた境目より後ろのものは捨てる) */
    const bounds: SeqBoundary[] = [];
    /** 組むときに読んだ、いちばん後ろの入力の節の番号 (5.1) */
    const read = { to: -1 };
    /** resumeCheck: 次の境目で戻る境目と、戻ったか。戻って続きから組んだときの、境目の指紋 (初めのときの指紋と比べる) */
    let checkAt: SeqBoundary | undefined;
    let checkDone = false;
    const firstDigests = new Map<number, string>();
    const rstats = (): ResumeStats => (this.stats.resume ??= { boundaries: 0, resumable: 0, reasons: {}, resumed: 0, mismatched: 0, lastFromBoundary: 0, lastFromStart: 0 });
    const onBoundary = (level: 'column' | 'page' | 'blank') => {
      const fb = flow.captureBoundary(level);
      const rs = rstats();
      rs.boundaries++;
      if (fb.reason) rs.reasons[fb.reason] = (rs.reasons[fb.reason] ?? 0) + 1;
      else rs.resumable++;
      const fm = foot.mark();
      const nest = host.nest;
      const b: SeqBoundary = {
        index: pages.length,
        flow: fb,
        foot,
        footMark: fm,
        warn: this.warnings.length,
        readTo: read.to,
        ...(beforeSepEntry ? { beforeSep: beforeSepEntry } : {}),
        hand: this.fonts.handedCount,
        digest: fb.reason || !probe ? '' : boundaryDigest(fb, [pages.length, fm.counter, fm.assigned, lastIndex, read.to, this.warnings.length - recs[0].warnStart]),
        counts: { flows: this.stats.flows, blocks: this.stats.blocks, tables: this.stats.tables, nestHit: !!nest?.hit, nestD: nest?.d ?? 0, nestCd: nest?.cd ?? 0, trial: host.condense?.trial ?? 0 },
        // 試し: 境目のときの id のページの記録 (戻るとき、そのまま戻す)
        ...(probe && !fb.reason ? { ids: this.snapshotIds() } : {}),
      };
      bounds.length = b.index;
      bounds[b.index] = b;
      // 前の組版の同じページの後の境目と、状態が揃ったら、組むのを止めて、残りのページを前の組版から繋ぐ
      // 繋ぐ確かめ (前を飛ばす): 飛ばしたはずの境目まで組んだら、そこまでのページ・id の記録・警告の数と、境目の状態が、前の組版と同じか
      if (prefixAt && b.index === prefixAt.index) {
        const pb = prefixAt;
        prefixAt = undefined;
        const t = splice!;
        const owners = t.within?.owners ?? this.reuseOwners()!;
        let why: string | undefined;
        const note = (w: string) => (why ??= w);
        const view = (ps: PageBuild[]) => ps.map(({ lineMarked: _m, ...p }) => p);
        const idsOf = (rs: PageRecord[], ps: PageBuild[]) => rs.map((r) => r.ids.map(([id, n, fmt, page]) => [id, n, fmt, page && ps.indexOf(page)]));
        const same =
          !fb.reason &&
          sameMapped(view(t.memo.built.slice(0, b.index)), view(pages.slice(0, b.index)), t.map, owners, (w) => note(`pages${w}`)) &&
          sameMapped(idsOf(t.rec.recs.slice(0, b.index), t.memo.built), idsOf(recs.slice(0, b.index), pages), t.map, owners, (w) => note(`ids${w}`)) &&
          (pb.warn - t.rec.warnStart === b.warn - recAt.warnStart || !note('warnings')) &&
          sameMapped(pb.foot.marked(pb.footMark), b.foot.marked(b.footMark), t.map, owners, (w) => note(`foot${w}`)) &&
          sameMapped(spliceSteps(pb.flow.steps), spliceSteps(fb.steps), t.map, owners, (w) => note(`steps${w}`)) &&
          sameMapped(spliceView(pb.flow.fields), spliceView(fb.fields), t.map, owners, (w) => note(`fields${w}`));
        resumeProbe.spliceVerify?.({ same, at: b.index, pages: b.index, prefix: true, ...(why ? { why } : {}) });
      }
      // 揃っても、前の組版の境目が後ろにある間は、SPLICE_LEAD ページまで組み続けてから繋ぐ (次の文書が、同じ所を直したとき、揃う境目が少し後ろにずれても
      // 繋げるように、この組みの境目を後ろまで持つ。揃った後の組みは、前の組版と同じになるので、繋ぐ所はどこでもよい)
      if (splice && !spliceAt && !fb.reason && b.index > 0) {
        const pb = splice.rec.bounds[b.index];
        // 次の境目が前の組版にあり、続きから組めるときだけ先へ延ばす (揃った後は、この組みの境目も前の組版と同じになる)
        const next = splice.rec.bounds[b.index + 1];
        const defer = (alignedAt === undefined || b.index < alignedAt + SPLICE_LEAD) && !!next && !next.flow.reason && b.index + 1 < splice.rec.pages;
        if (pb && !pb.flow.reason && (alignedAt === undefined || !defer) && spliceOk(b, pb, !defer && !resumeProbe.spliceVerify)) {
          if (defer) alignedAt = b.index;
          else {
            spliceAt = pb;
            if (resumeProbe.spliceVerify) verifyAt = { pb, warn: this.warnings.length };
            else throw SPLICE;
          }
        }
      }
      if (!probe) return;
      if (!fb.reason) {
        const d0 = firstDigests.get(b.index);
        if (d0 === undefined) firstDigests.set(b.index, b.digest);
        else if (d0 !== b.digest) rs.mismatched++;
      }
      if (!check) return;
      if (checkAt && !checkDone) {
        checkDone = true;
        throw RESUME_CHECK;
      }
      checkAt = fb.reason || (resumeProbe.only !== undefined && resumeProbe.only !== b.index) ? undefined : b;
      checkDone = false;
    };
    /**
     * この組みの境目 b と、前の組版の境目 pb が揃ったか: 続きの位置が直した所の後ろで、流れの欄・続きの位置・脚注の番号付けが、
     * 節の番号の対応の下で同じ。組んだ結果を変えないため、少しでも違えば揃わないとする (繋がずに組み続ける)
     */
    const spliceOk = (b: SeqBoundary, pb: SeqBoundary, commit: boolean): boolean => {
      const t = splice!;
      const m = t.map;
      const why = resumeProbe.spliceWhy;
      if (lastIndex !== null || b.flow.level !== pb.flow.level || b.counts.nestHit || pb.counts.nestHit || b.index >= t.rec.pages) return void why?.('(level)'), false;
      const at = resumePos(b.flow.steps);
      // 表の中の位置なら、表が直した所の後ろか、直した所が表の本体の行の中 (lo より後ろ) であること。同じ文書の前の回と繋ぐときは、入力は同じで、
      // 続きの組みが前の回と違いうるのは、後ろで引く参照の値だけ (繋ぐページの参照を spliceCites で確かめる)
      if (!at || (!t.within && (at.pos < m.newEnd || (at.table < m.newEnd && m.P < at.lo)))) return void why?.(!at ? '(pos)' : '(before-edit)'), false;
      const fa = b.footMark;
      const fp = pb.footMark;
      if (fa.counter !== fp.counter || fa.assigned !== fp.assigned || fa.claimed !== fp.claimed || !!b.beforeSep !== !!pb.beforeSep) return void why?.('(foot)'), false;
      const owners = t.within?.owners ?? this.reuseOwners();
      if (!owners || !sameMapped(pb.foot.marked(fp), b.foot.marked(fa), m, owners, why)) return false;
      // 組んでいる表があれば、組んだ箱・セルを鍵にする覚えも比べる (SPLICE_SIDE)
      const tables = b.flow.steps.filter((x): x is TableStep => x.k === 'table');
      const fo = pb.flow.fields as Record<string, WeakMap<object, unknown>>;
      const fn = b.flow.fields as Record<string, WeakMap<object, unknown>>;
      const side: Array<[WeakMap<object, unknown>, WeakMap<object, unknown>]> = tables.length ? [[fo.cellCols, fn.cellCols], [fo.cellAbs, fn.cellAbs]] : [];
      if (!sameMapped(spliceSteps(pb.flow.steps), spliceSteps(b.flow.steps), m, owners, why, side) || !sameMapped(spliceView(pb.flow.fields), spliceView(b.flow.fields), m, owners, why, side)) return false;
      if (tables.length && !this.spliceSideOk(t, pb.flow.steps.filter((x): x is TableStep => x.k === 'table'), tables, fo.flexItemCaps, fn.flexItemCaps)) return void why?.('(flexItemCaps)'), false;
      if (!this.spliceCheck(t, pb.index, t.rec.pages, pb.warn, t.rec.warnEnd)) return void why?.('(pages)'), false;
      // 繋ぐページの id のページを書き、ページ番号の参照を引き直して確かめる (確かめだけのときと、揃わないときは、書いた id を戻す)
      spliceLog = [];
      if (!this.spliceCites(t.memo, t.rec.recs, pb.index, t.rec.pages, commit, spliceLog)) return void why?.('(cites)'), false;
      return true;
    };
    /** 繋ぐページの参照と、引き直した値 (spliceCites。applySplice が参照の記録に足す) */
    let spliceLog: Array<[PageRecord['cites'][number], string]> = [];
    /** 前の組版の境目 pb から後ろのページを、この組みに繋ぐ (ページ・ページごとの記録・id のページ・警告・脚注の番号) */
    const applySplice = (pb: SeqBoundary) => {
      const t = splice!;
      const k = pb.index;
      const w0 = this.warnings.length;
      this.pageRecs = undefined;
      this.fonts.rehand(t.rec.handed.slice(pb.hand - t.rec.handStart));
      const adopted = this.spliceAdopt(t, pb.index, t.rec.pages, pb.warn, t.rec.warnEnd, seq);
      for (let j = 0; j < adopted.length; j++) {
        const r = t.rec.recs[k + j];
        pages.push(adopted[j]);
        recs.push({ ...r, warnStart: w0 + (r.warnStart - pb.warn) });
        this.notePage(pages.length);
      }
      // id のページは spliceCites が書いた。参照は、初めから組んだときと同じく、引き直した値で参照の記録に足す (ページの記録の値は、前の組版で
      // 引いた値で、字を差し替えた後のページの字と違いうる)
      for (const [[id, last, format, physical, , style], v] of spliceLog) this.logCite(id, last, format, physical, v, style);
      this.pageRecs = recs;
      foot.continueAt(t.rec.footEnd);
      spliced = { at: k, pages: adopted.length };
      const st = this.options.layoutReuse!.stats;
      if (t.within) {
        st.passSpliced++;
        st.passSplicedPages += adopted.length;
      } else {
        st.spliced++;
        st.splicedPages += adopted.length;
      }
    };
    /**
     * 前を飛ばす境目: 前の組版の境目のうち、そこまでのページを組むのに読んだ先 (readTo) が直した所より前で、続きから組め、
     * 組んでいる表の無い (組んだ箱を鍵にする覚えを移せないので)、いちばん後ろのもの。そこまでのページは、いまの文書でも同じに組める
     * (入力が同じで、読んだ所が同じ。design/resumable-flow.md の 5.1)
     */
    const skipFrom = (): SeqBoundary | undefined => {
      const t = splice!;
      // 同じ文書の前の回と繋ぐときは、入力は同じなので、読んだ先の代わりに、値の変わった参照を見る: 境目 k までに引いた参照 (ページごとの記録の
      // 0〜k - 1 ページ目。境目の後のページの中身を先に組んで引いた参照も、引いたときのページの記録に入る) の値が、どれもいまの回と同じ境目
      const upTo = t.within ? this.citesSameUpTo(t.memo, t.rec.recs, t.rec.pages) : Infinity;
      for (let k = Math.min(t.rec.bounds.length, t.rec.pages, upTo) - 1; k >= 1; k--) {
        const b = t.rec.bounds[k];
        if (b && !b.flow.reason && b.readTo < t.map.P && !b.counts.nestHit && !b.flow.steps.some((x) => x.k === 'table')) return b;
      }
      return undefined;
    };
    /**
     * 前の組版の境目 pb までのページを前の組版から使い (ページごとの記録・id のページ・参照・警告)、境目の写しを、いまの文書の節に移して、
     * そこから続けて組む用意をする。移せないとき・ページの参照が揃わないときは false (初めから組む)
     */
    const skipTo = (pb: SeqBoundary): boolean => {
      const t = splice!;
      const k = pb.index;
      if (t.rec.rootI === undefined || t.rec.limit === undefined) return false;
      // 同じ文書の前の回の境目は、この文書の節を指すので、そのまま続ける (resumeFrom が写す)
      const fb = t.within ? pb.flow : this.remapBoundary(pb.flow, t.map);
      if (!fb || !this.spliceCheck(t, 0, k, t.rec.warnStart, pb.warn)) return false;
      const nodes = this.docNodes!;
      const nf = makeFoot();
      if (t.within) nf.adopt(pb.foot, pb.footMark);
      else if (!nf.adoptMapped(pb.foot, pb.footMark, (fn) => nodes[sourceRef(fn) ?? -1] as LFootnote | undefined)) return false;
      // ページの参照を引き直して確かめ、id のページを書く (揃わなければ、書いた id を戻して初めから組む)
      const log: Array<[PageRecord['cites'][number], string]> = [];
      if (!this.spliceCites(t.memo, t.rec.recs, 0, k, true, log)) return false;
      foot = nf;
      const w0 = recAt.warnStart;
      this.pageRecs = undefined;
      this.fonts.rehand(t.rec.handed.slice(0, pb.hand - t.rec.handStart));
      const adopted = this.spliceAdopt(t, 0, k, t.rec.warnStart, pb.warn, seq);
      for (let j = 0; j < adopted.length; j++) {
        const r = t.rec.recs[j];
        pages.push(adopted[j]);
        recs.push({ ...r, warnStart: w0 + (r.warnStart - t.rec.warnStart) });
        this.notePage(pages.length);
      }
      for (const [[id, last, format, physical, , style], v] of log) this.logCite(id, last, format, physical, v, style);
      this.pageRecs = recs;
      firstPage = { p: pages[0], rootI: t.rec.rootI, limit: t.rec.limit };
      cur = pages[k - 1];
      read.to = pb.readTo;
      beforeSepEntry = pb.beforeSep;
      if (host.nest) {
        host.nest.d = pb.counts.nestD;
        host.nest.cd = pb.counts.nestCd;
      }
      if (host.condense) host.condense.trial = pb.counts.trial;
      flow = makeFlow();
      flow.resumeFrom(fb);
      // 次の文書のために、この境目を、いまの文書の節で覚える (前を飛ばすときに使う)
      bounds[k] = { ...pb, flow: fb, foot, footMark: foot.mark(), warn: this.warnings.length, hand: this.fonts.handedCount, digest: '', counts: { ...pb.counts, flows: this.stats.flows, blocks: this.stats.blocks, tables: this.stats.tables }, ids: undefined };
      const st = this.options.layoutReuse!.stats;
      if (t.within) {
        st.passSkipped++;
        st.passSkippedPages += k;
      } else {
        st.skipped++;
        st.skippedPages += k;
      }
      return true;
    };
    const makeFlow = () => {
      const f: Flow = new Flow({ ...host, pageNumber: () => cur.number, ...(seq.spanAreas ? { areaOrigin: () => f.areaTop } : {}) }, {
        wm,
        footnotes: foot,
        ...(sideNotes ? { sideNotes } : {}),
        beforeSep,
        discardLeading: !!seq.discardLeadingSpace,
        ...(seq.spanAreas ? { spanAreas: true } : {}),
        rootI: firstPage.rootI,
        root: cur.root,
        limit: firstPage.limit,
        ...(keep ? { record: true } : {}),
        pages: {
          addMarkers: (list) => pushAll(cur.markers, this.takeIndexPoints(list, (id) => this.noteIdPage(id, cur.number, seq.pageNumberFormat, cur))),
          markerEnd: (key) => (cur.markerEnds ??= []).push(key),
          noteId: (id) => {
            this.noteIdPage(id, cur.number, seq.pageNumberFormat, cur);
          },
          nextPage: (level) => {
            const n = mkPage(level === 'blank');
            cur = n.p;
            return { root: n.p.root, limit: n.limit, rootI: n.rootI };
          },
          // 次のページの本文領域の block 方向の上限 (ページの型から求める。:first・:left・:right などで、いまのページと高さが違うことがある)。
          // 段組を次のページへ送るか (layoutColumnsPaged・layoutBlockContainer) と、表の行を送るかを決めるのに使う
          nextLimit: () => nextPageLimit(),
          ...(keep ? { boundary: onBoundary } : {}),
        },
        abs: () => cur.abs,
        pageSize,
      });
      return f;
    };
    /**
     * 境目 b に戻る: 境目までのページ・ページごとの記録・脚注の番号付け・器の側の記録を、境目のときのものにし、写しから流れを作る。
     * mode が check なら、境目のときの器の状態にすっかり戻す (id のページ・警告・組んだ回数)。relayout なら、組み直すときと同じ状態にする
     * (警告と id のページは、呼ぶ側が組み直す前と同じに戻してある。そこに、境目までのページの分を書き直す)
     */
    const resumeAt = (b: SeqBoundary, mode: 'check' | 'relayout') => {
      pages.length = b.index;
      cur = pages[b.index - 1];
      recs.length = b.index;
      this.seqBuilding = pages;
      this.pageRecs = recs;
      if (mode === 'check') {
        this.warnings.length = b.warn;
        this.idPages = new Map([...b.ids!.pages].map(([k, v]) => [k, { ...v }] as [string, IdPages]));
        this.idPageBuild = new Map(b.ids!.build);
        this.idPageBuildLast = new Map(b.ids!.last);
        this.stats.flows = b.counts.flows;
        this.stats.blocks = b.counts.blocks;
        this.stats.tables = b.counts.tables;
        if (host.nest) host.nest.hit = b.counts.nestHit;
      }
      if (mode === 'relayout') {
        // 境目までのページで記録した id を、同じ順に書き直す (初めから組み直したときに、境目までに書くもの)
        this.pageRecs = undefined;
        for (const r of recs) for (const [id, n, fmt, page] of r.ids) this.noteIdPage(id, n, fmt, page);
        this.pageRecs = recs;
        // 進み具合の知らせ (組み直すときは、境目までのページも、作るたびに知らせていた)
        for (let k = 1; k <= b.index; k++) this.notePage(k);
      }
      if (host.nest) {
        host.nest.d = b.counts.nestD;
        host.nest.cd = b.counts.nestCd;
      }
      if (host.condense) host.condense.trial = b.counts.trial;
      read.to = b.readTo;
      beforeSepEntry = b.beforeSep;
      foot = makeFoot();
      foot.adopt(b.foot, b.footMark);
      flow = makeFlow();
      flow.resumeFrom(b.flow);
      rstats().resumed++;
    };
    const runFlow = () => {
      flow.layoutChildren(seq.flow.children, flowSt);
      flow.finishPaginated();
    };
    /** go を組む。resumeCheck なら、境目で戻る合図 (RESUME_CHECK) を受けて、戻る境目から続けて組む */
    const drive = (go: () => void) => {
      const prevRead = host.read;
      if (keep) host.read = read;
      try {
        for (;;) {
          try {
            go();
          } catch (e) {
            if (e === SPLICE) {
              applySplice(spliceAt!);
              return;
            }
            if (e !== RESUME_CHECK) throw e;
            const b = checkAt!;
            go = () => {
              resumeAt(b, 'check');
              runFlow();
            };
            continue;
          }
          // 最後の境目からは、page-sequence の終わりまで組んでから戻る
          if (check && checkAt && !checkDone) {
            checkDone = true;
            const b = checkAt;
            go = () => {
              resumeAt(b, 'check');
              runFlow();
            };
            continue;
          }
          return;
        }
      } finally {
        this.pageRecs = undefined;
        host.read = prevRead;
      }
    };
    /** 初めから組んだときの、page-sequence の流れの数 (relayout が、組む手間の上限に当たらないかを見積もる) */
    let seqFlows = 0;
    return {
      layout: (li) => {
        lastIndex = li;
        pages = [];
        recs = [];
        this.seqBuilding = pages;
        this.pageRecs = recs;
        bounds.length = 0;
        checkAt = undefined;
        checkDone = false;
        firstDigests.clear();
        read.to = -1;
        beforeSepEntry = undefined;
        spliceAt = undefined;
        spliced = undefined;
        alignedAt = undefined;
        prefixAt = undefined;
        recAt.warnStart = this.warnings.length;
        recAt.handStart = this.fonts.handedCount;
        const flows0 = this.stats.flows;
        drive(() => {
          // 前を飛ばす: 前の組版の、直した所を読む前の境目から続けて組む
          const pb = splice && li === null ? skipFrom() : undefined;
          // 繋ぐ確かめのときは飛ばさずに組み、その境目で、前の組版のページと境目の状態が同じかを確かめる (onBoundary)
          if (pb && resumeProbe.spliceVerify) {
            if (this.spliceCheck(splice!, 0, pb.index, splice!.rec.warnStart, pb.warn) && this.spliceCites(splice!.memo, splice!.rec.recs, 0, pb.index, false)) prefixAt = pb;
          }
          else if (pb && skipTo(pb)) {
            runFlow();
            return;
          }
          firstPage = mkPage();
          cur = firstPage.p;
          foot = makeFoot();
          flow = makeFlow();
          runFlow();
        });
        if (late > 0) {
          // 遅く戻る試し: 続きから組める境目を散らして選び、後ろから順に、その境目から終わりまで組み直す
          const all = bounds.filter((b) => b && !b.flow.reason && (resumeProbe.lateOnly === undefined || b.index === resumeProbe.lateOnly));
          const pick = all.length <= late ? all : Array.from({ length: late }, (_, k) => all[Math.floor(((k + 0.5) * all.length) / late)]);
          for (const b of [...new Set(pick)].reverse()) {
            drive(() => {
              resumeAt(b, 'check');
              runFlow();
            });
            // 続けた流れが写した境目 (b の後ろの、続きから組める最初の境目) から、もう 1 度続ける。続けた流れが写す境目の誤り
            // (続きの位置の印を戻し忘れて、古い位置のまま写すなど) は、1 度続けただけでは結果に出ず、その境目から続けたときに出る
            const again = bounds.find((x, k) => k > b.index && x && !x.flow.reason);
            if (again)
              drive(() => {
                resumeAt(again, 'check');
                runFlow();
              });
          }
        }
        seqFlows = this.stats.flows - flows0;
        recAt.warnEnd = this.warnings.length;
        recAt.footEnd = foot.lastNumber;
        recAt.pages = pages.length;
        recAt.rootI = firstPage.rootI;
        recAt.limit = firstPage.limit;
        recAt.handed = this.fonts.handedSince(recAt.handStart);
        if (verifyAt) {
          const { pb, warn } = verifyAt;
          verifyAt = undefined;
          const t = splice!;
          const k = pb.index;
          const owners = t.within?.owners ?? this.reuseOwners()!;
          let why: string | undefined;
          const note = (w: string) => (why ??= w);
          const W = t.rec.warnStart;
          const oldWarn = t.memo.warnings.slice(pb.warn - W, t.rec.warnEnd - W).map((d) => ({ ...d, source: d.source && { ...d.source, line: undefined, column: undefined, element: undefined, file: undefined } }));
          const newWarn = this.warnings.slice(warn).map((d) => ({ ...d, source: d.source && { ...d.source, line: undefined, column: undefined, element: undefined, file: undefined, ...(d.source.page !== undefined ? { page: d.source.page - (t.ordinal - t.memo.ordinal) } : {}) } }));
          const same =
            t.rec.pages === pages.length &&
            t.rec.footEnd === foot.lastNumber &&
            // 柱などを組むときに足す印 (lineMarked) は、前の組版のページにだけある (組んだ中身ではない)
            sameMapped(t.memo.built.slice(k, t.rec.pages).map(({ lineMarked: _m, ...p }) => p), pages.slice(k).map(({ lineMarked: _m, ...p }) => p), t.map, owners, (w) => note(`pages${w}`)) &&
            // id の記録のページは、ページの並びの中の番号で比べる (ページそのものは上で比べた)
            sameMapped(
              t.rec.recs.slice(k).map((r) => r.ids.map(([id, n, fmt, page]) => [id, n, fmt, page && t.memo.built.indexOf(page)])),
              recs.slice(k).map((r) => r.ids.map(([id, n, fmt, page]) => [id, n, fmt, page && pages.indexOf(page)])),
              t.map,
              owners,
              (w) => note(`ids${w}`),
            ) &&
            (oldWarn.length === newWarn.length ? oldWarn.every((d, i) => (d.source?.sourceRef === undefined ? undefined : mapRef(t.map, d.source.sourceRef)) === newWarn[i].source?.sourceRef && JSON.stringify({ ...d, source: { ...d.source, sourceRef: 0 } }) === JSON.stringify({ ...newWarn[i], source: { ...newWarn[i].source, sourceRef: 0 } })) || !!note('warnings') && false : !!note(`warnings.length ${oldWarn.length}/${newWarn.length}`) && false);
          resumeProbe.spliceVerify?.({ same, at: k, pages: t.rec.pages - k, ...(why ? { why } : {}) });
        }
        return pages;
      },
      relayout: (li, reset, uncount) => {
        // 最後のページのマスターを変えても、それより前のページのマスターは変わらない (§7.27.14 の page-position)。前の組みと新しい組みの、
        // どちらでも最後でないページまでは同じに組めるので、その終わりより前の、続きから組める境目から続ける
        const target = Math.min(lastIndex ?? Infinity, li ?? Infinity) - 1;
        let b: SeqBoundary | undefined;
        for (let k = Math.min(target, bounds.length - 1); k >= 1 && !b; k--) if (bounds[k] && !bounds[k].flow.reason) b = bounds[k];
        // 組む手間の上限 (FlowHost.nest の budget): 初めから組み直したときに上限に当たりうるなら、初めから組む (当たり方を変えない。5.3)
        const nest = host.nest;
        // 上限から遠ければ (組み直しの全部を初めから組んでも、上限に当たらない見込み)、組み直しの流れは上限の数えに入れない (呼ぶ側が uncount で除く)。
        // 境目から続けて組んでも、初めから組んでも、組み直しの中では上限に当たらず、組み直しの後の数えも同じになる
        const far = !nest || (!nest.hit && this.stats.flows - nest.base + (nest.charged ?? 0) + 2 * seqFlows + 1000 <= nest.budget);
        uncount(far);
        if (!b || resumeProbe.fromStart || !far) return undefined;
        // 組み直すときと同じく、警告と id のページを、組み直す前に戻す (境目までの警告は、そのまま残す)
        this.warnings.length = b.warn;
        reset();
        lastIndex = li;
        const target2 = b;
        checkAt = undefined;
        checkDone = false;
        drive(() => {
          resumeAt(target2, 'relayout');
          runFlow();
        });
        return pages;
      },
      boundaryAt: (k) => bounds[k],
      record: () => (capture || probe ? undefined : { bounds: bounds.slice(), recs: recs.slice(), ...recAt }),
      get spliced() {
        return spliced;
      },
    };
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
    // バーごとの最後の続き (行の revs は Set から作るので同じバーは 1 度だけ。前の行で伸ばした続きは、そのバーの最後の続きに限る)。
    // 続きを全部の続きから探すと、開いている change-bar の数 × 行の数 × 続きの数になり、change-bar 2000 個 × block 2000 個 (180KB) で 17 秒かかった
    const lastRun = new Map<RevisionBar, (typeof runs)[number]>();
    hits.forEach((h, k) => {
      for (const rb of h.line.revs ?? []) {
        const l = lastRun.get(rb);
        const r = l && l.last === k - 1 && l.col.k === h.col.k ? l : undefined;
        if (r && rb.changeBar) {
          // 変更バー: 隣り合うセルの行 (前の行より上に戻る) も含めて、いちばん上からいちばん下まで
          r.b0 = Math.min(r.b0, h.b);
          r.b1 = Math.max(r.b1, h.b + h.line.bsize);
          r.last = k;
        } else if (r) {
          r.b1 = h.b + h.line.bsize;
          r.last = k;
        } else {
          const run = { rb, col: h.col, b0: h.b, b1: h.b + h.line.bsize, last: k };
          runs.push(run);
          lastRun.set(rb, run);
        }
      }
    });
    // 同じ所に同じ見た目で引くバー (同じ範囲の行に開いている、同じ指定の change-bar) は、最後の 1 本だけ描く (どの点でも、いちばん後に
    // 描くバーは変わらないので、見た目は同じ。透明度のある色は、重ねると濃くなるので除く)。開いている change-bar の数だけ、ページごとに
    // 同じバーを作らない
    const seen = new Set<string>();
    const skip = new Set<number>();
    for (let k = runs.length - 1; k >= 0; k--) {
      const { rb, col, b0, b1 } = runs[k];
      if (/rgba|hsla|transparent|\/|#[0-9a-f]{8}\b|#[0-9a-f]{4}\b/i.test(rb.color)) continue;
      const key = `${rb.color}|${rb.style}|${rb.width}|${rb.offset}|${rb.position}|${!!rb.changeBar}|${col.k}|${col.i}|${col.isize}|${b0}|${b1}`;
      if (seen.has(key)) skip.add(k);
      else seen.add(key);
    }
    for (const [k, { rb, col, b0, b1 }] of runs.entries()) {
      if (skip.has(k)) continue;
      const w = rb.width ?? 1;
      // 段の端からバーまでの間隔 (既定 0。指定が無ければ、バーは段の端に接する)
      const off = rb.offset ?? 0;
      const pos = rb.position ?? 'start';
      const sides = rb.changeBar
        ? [changeBarSide(pos, { wm, rtl: sst.direction === 'rtl', odd: (p.number + (host.sideDelta ?? 0)) % 2 === 1, col: col.k, columns: p.master.columns?.count ?? 1 })]
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

  /** 組んだ static-content (余白の箱・柱) の箱の覚え (buildSheet。組版の通しごとに作り直す) */
  private staticMemo = new Map<LBlockContainer, StaticMemoEntry[]>();

  /**
   * ページの柱など (static-content) を組み、行番号・改訂バーの箱を足し、書字方向を裏返す (組み直しの回ごと。ページの順に呼ぶ)。
   * 柱の中のページ番号の参照・索引の並びは、組み直しの要否の判定に入る。ページの領域の木にするのは buildSheet
   */
  private sheetStatics(p: PageBuild, total: number, host: FlowHost, docStyle: ResolvedStyle, allPages: PageBuild[], index: number): SheetStatics {
    // ページの左右のずれ (FlowHost.sideDelta): ページの順で決める文書では、このページの順 (index + 1) と番号の差
    host = { ...host, sideDelta: this.sidesByOrder ? index + 1 - p.number + this.sideShift : 0 };
    const m: PageMaster = p.master;
    const W = mm(m.width);
    const H = mm(m.height);
    const ex = sheetExtents(m);
    const sst = resolveStyle(resolveStyle(docStyle, p.seq), p.seq.flow);
    const wm = sst.wm;

    // 全ページ共通の絶対配置 (ヘッダー等) — ページ番号を差し替えてレイアウト
    const staticNodes: LNode[] = [];
    for (const c of p.staticContent) {
      // ページで変わらない中身 (ページ番号・ページ番号の参照・脚注などを含まず、取り出すマーカーも前に組んだページと同じ) は、
      // 前に組んだ箱を使い回す (staticMemo)。ページごとに写して組み直すと、「static-content 225KB × 300 ページ」(239KB)・
      // 「余白の箱の content の 4000 字 × 400 ページ」(20KB) で、入力の大きさ × ページの数の手間とメモリになる
      const retrieves = staticRetrieves(c);
      const found = retrieves ? retrieves.map((r) => findMarker(r, allPages, index)) : undefined;
      const reusable = found !== undefined && found.every((m) => m === undefined || isPageInvariant(m.children));
      const parity = (p.number + (host.sideDelta ?? 0)) % 2;
      let entries = this.staticMemo.get(c);
      const hit = reusable ? entries?.find((e) => e.W === W && e.H === H && e.wm === wm && e.seq === p.seq && e.parity === parity && e.found.length === found.length && e.found.every((m, k) => m === found[k])) : undefined;
      // ページの下端より 1 ページ分以上下の行は、組んだ後で捨てる (offPageLines。見えない)
      const below = H + ex.bottom + H;
      if (hit) {
        for (const n of hit.nodes) staticNodes.push(n);
        for (const w of hit.warnings) host.warn(w);
        continue;
      }
      const own: LNode[] = [];
      const warnings: Diagnostic[] = [];
      const warn = (m: Diagnostic) => {
        warnings.push(m);
        host.warn(m);
      };
      // 固定配置の箱 (LBlockContainer.pageArea) は、このページの領域 (ページの余白の内側) を基準に置く
      const mg = m.margins;
      const area = { top: mm(mg.top), right: mm(mg.right), bottom: mm(mg.bottom), left: mm(mg.left) };
      const pageSize = { width: W, height: H, body: { width: W - area.left - area.right, height: H - area.top - area.bottom }, area };
      const sub = new Flow({ ...host, warn, pageNumber: () => p.number }, { wm, rootI: W, abs: () => own, pageSize: () => pageSize });
      // マーカーを展開してからページ番号を差し替える (マーカーの中身のページ番号 (HTML の running() の中の counter(page)) も差し替える)
      // 総ページ数が分からない (先頭から N ページで止めた。total が -1) ときは、決まらない字にして、使ったら数える
      const used = { totalPages: false };
      const sc = substitute(resolveMarkers(c, allPages, index), { pageNumber: formatPageNumber(p.number, p.seq.pageNumberFormat), totalPages: total < 0 ? this.unresolvedMark : String(total) }, p.number, used);
      if (total < 0 && used.totalPages) this.beyondHits.push(['total-pages', TOTAL_PAGES_ID]);
      // 組みながらページを渡すとき: 総ページ数を使う柱は、組み終えるまで決まらない (emitOne)
      if (used.totalPages && this.emitState?.inStatics) this.emitState.staticUnresolved = true;
      const forced: LBlockContainer = { ...sc, absolutePosition: true };
      // 写した箱にも元の節の番号を引き継ぐ (描くときだけの効果 (paintEffect) を、柱・余白の箱・fixed の箱の Area にも付けるため)
      copySourceRef(sc, forced);
      sub.layoutBlockLevel(forced, resolveStyle(docStyle, p.seq));
      for (let k = 0; k < own.length; k++) own[k] = dropLinesBelow(own[k], (own[k].phys ? own[k].phys!.y : own[k].b) + (own[k].relShift?.y ?? 0), below);
      for (const n of own) staticNodes.push(n);
      if (reusable) {
        if (!entries) this.staticMemo.set(c, (entries = []));
        // 覚えるのは直近の数件 (柱の中身は章ごとに変わる。ページごとに変わる中身を、ページの数だけ覚えない)
        if (entries.length >= STATIC_MEMO_ENTRIES) entries.shift();
        entries.push({ W, H, wm, seq: p.seq, parity, found, nodes: own, warnings });
      }
    }

    this.addLineMarks(p, sst, host);
    // 本文の書字方向の裏返し (bt-lr・lr-bt など)。ページを組み直しに使い回しても、1 度だけ当てる
    if (p.seq.writingFlip && !flipped.has(p.root)) {
      flipped.add(p.root);
      applyFlip(p.root, p.seq.writingFlip);
    }
    return { nodes: staticNodes, wm };
  }

  /** ページを領域の木 (SheetArea) にする: 本文 (p.root)・絶対配置の箱 (p.abs)・柱など (sheetStatics の結果) */
  private buildSheet(p: PageBuild, statics: SheetStatics): SheetArea {
    // 効果の印 (toArea が PAINT_REF_MARK を付けるか) は、この器の文書のものを、領域の木にする同期の区間の初めに置き直す
    // (器の組版は境目で待つので、同時に組むほかの文書が、組み始めに書き換えている)
    paintEffectState.on = !!this.paintEffects;
    const m: PageMaster = p.master;
    const W = mm(m.width);
    const H = mm(m.height);
    const bleed = mm(m.bleed);
    const marks = m.trimMarks;
    const markMargin = marks ? mm(m.trimMarkMargin ?? DEFAULT_TRIM_MARK_MARGIN_MM) : 0;
    // 辺ごとのトンボ領域 (axf:crop-offset の上下左右が違うとき)
    const mms = marks && m.trimMarkMargins ? { top: mm(m.trimMarkMargins.top), right: mm(m.trimMarkMargins.right), bottom: mm(m.trimMarkMargins.bottom), left: mm(m.trimMarkMargins.left) } : undefined;
    const ex = sheetExtents(m);
    const { nodes: staticNodes, wm } = statics;
    const rx = mm(m.margins.left);
    const ry = mm(m.margins.top);
    const regionW = W - rx - mm(m.margins.right);
    const regionH = H - ry - mm(m.margins.bottom);
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
      // ページ番号の書式 (紙面のノンブルと同じもの。マスターに書式があれば、そのマスターの書式)。10 進のページには書かない
      // (PDF のページラベルの範囲を分けるのに使う)
      ...(() => {
        const f = p.master.pageNumberFormat ?? p.seq.pageNumberFormat;
        return f && f !== '1' ? { pageNumberFormat: f } : {};
      })(),
      regionBody,
      absoluteAreas,
      behindAreas,
    };
    const sw = W + ex.left + ex.right;
    const sh = H + ex.top + ex.bottom;
    // 背景画像の位置の基準の領域 (CSS の @page の背景: ページの箱の padding の領域。CSS Paged Media 3 §3.1)。描く範囲は塗り足しまでのまま
    // グラデーションは、大きさを書いたときだけ、その領域を基準にする (書かなければ、これまでどおり塗り足しまでいっぱいに塗る)
    const gi = m.backgroundImage?.gradient ? m.backgroundImage : undefined;
    const gradSized = !!gi && (gi.widthPct !== undefined || gi.heightPct !== undefined || gi.width !== undefined || gi.height !== undefined);
    const bo = m.backgroundImage && (!m.backgroundImage.gradient || gradSized) && m.backgroundArea !== 'content' ? m.backgroundOrigin : undefined;
    const originBox = bo ? { x: ex.left + mm(bo.left), y: ex.top + mm(bo.top), width: Math.max(W - mm(bo.left) - mm(bo.right), 0), height: Math.max(H - mm(bo.top) - mm(bo.bottom), 0) } : undefined;
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
      ...(m.rotation ? { rotation: m.rotation } : {}),
      ...(m.trimMarkLineWidth !== undefined ? { trimMarkLineWidth: m.trimMarkLineWidth } : {}),
      backgroundColor: m.backgroundColor,
      ...(m.backgroundImage
        ? m.backgroundImage.gradient
          ? { backgroundImage: m.backgroundArea === 'content' ? gradientImage(m.backgroundImage, regionW, regionH) : gradientImage(m.backgroundImage, originBox?.width ?? W + bleed * 2, originBox?.height ?? H + bleed * 2) }
          : this.sheetBackgroundImage(m.backgroundImage, originBox?.width ?? (m.backgroundArea === 'content' ? regionW : undefined), originBox?.height ?? (m.backgroundArea === 'content' ? regionH : undefined))
        : {}),
      ...(m.backgroundArea === 'content' ? { backgroundBox: { x: ex.left + rx, y: ex.top + ry, width: regionW, height: regionH } } : {}),
      ...(originBox ? { backgroundOriginBox: originBox } : {}),
      ...(m.rootBackground ? { rootBackground: this.sheetRootBackground(m.rootBackground, { x: ex.left + rx, y: ex.top + ry, width: regionW, height: regionH }) } : {}),
    };
  }
}

/** ページを領域にした後で、ページの本文の論理の木を手放す (組み直さないので要らない。しおり・飛び先・索引は PageBuild の番号だけを見る) */
function releasePage(p: PageBuild) {
  p.root = { ...p.root, children: [] };
  p.abs = [];
}

/** 用紙の、仕上がりの外の幅 (塗り足しとトンボの領域。辺ごと) */
function sheetExtents(m: PageMaster): { top: number; right: number; bottom: number; left: number } {
  const bleed = mm(m.bleed);
  const markMargin = m.trimMarks ? mm(m.trimMarkMargin ?? DEFAULT_TRIM_MARK_MARGIN_MM) : 0;
  // 辺ごとのトンボ領域 (axf:crop-offset の上下左右が違うとき)
  const mms = m.trimMarks && m.trimMarkMargins ? m.trimMarkMargins : undefined;
  return mms
    ? { top: bleed + mm(mms.top), right: bleed + mm(mms.right), bottom: bleed + mm(mms.bottom), left: bleed + mm(mms.left) }
    : { top: bleed + markMargin, right: bleed + markMargin, bottom: bleed + markMargin, left: bleed + markMargin };
}

/**
 * 行の中のリーダーの点・文字列の繰り返しを、格子に合わせて並べ直す (XSL 1.1 §7.22.1 の leader-alignment):
 * 繰り返す模様の 1 周期ごとの始めの端を、格子の次の目の始めの端にそろえる。格子は、reference-area なら参照領域の内容の始めの端 (ref)、page ならページの始めの端から、ピッチごと。
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

/**
 * ページのマーカーを、クラスの名前ごとに分けた索引 (ページのマーカーの並びごとに 1 度作る。並びが伸びたら作り直す)。
 * retrieve-marker のたびにページのマーカーを全部調べると、「string-set 2000 個 × 余白の string() 2000 個 × 100 ページ」(270KB) で
 * 数億回の比較になり、100 秒を超えた
 */
const markerIndex = new WeakMap<PendingMarker[], { n: number; by: Map<string, PendingMarker[]> }>();
const NO_MARKERS: PendingMarker[] = [];
function markersOfClass(markers: PendingMarker[], className: string): PendingMarker[] {
  let x = markerIndex.get(markers);
  if (!x || x.n !== markers.length) {
    const by = new Map<string, PendingMarker[]>();
    for (const m of markers) {
      const l = by.get(m.className);
      if (l) l.push(m);
      else by.set(m.className, [m]);
    }
    markerIndex.set(markers, (x = { n: markers.length, by }));
  }
  return x.by.get(className) ?? NO_MARKERS;
}

/** retrieve-marker で該当するマーカーを探す (carryover は boundary の範囲まで遡る) */
function findMarker(r: LRetrieveMarker, pages: PageBuild[], index: number): LMarker | undefined {
  const position = r.position ?? 'first-starting-within-page';
  const boundary = r.boundary ?? 'page-sequence';
  const on = (i: number) => markersOfClass(pages[i].markers, r.className);
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

/**
 * 横書きの箱 n (上端の、ページの上端からの位置が y) の中の行のうち、上端が limit より下のものを除いた箱を返す (変えた所だけ写す)。
 * static-content・余白の箱は、領域からあふれた中身もそのまま描く (overflow は visible) が、ページより下の行は見えない。
 * 「static-content 225KB × 300 ページ」(239KB) では、ページごとに 225KB の字を描く領域を作り、メモリを使い切った。
 * 位置を確かめられる箱 (横書き・回転なし・描くときの変形なし) の中だけを調べ、ほかは変えない。箱の位置は toArea と同じに求める
 * (物理の位置 phys があればそれ、無ければ b。position: relative のずらし relShift を足す)。
 * 行の字が行の箱から上へはみ出す分を見込み、limit は呼ぶ側がページの下端より 1 ページ分下にする
 */
function dropLinesBelow(n: LNode, y: number, limit: number): LNode {
  if (n.wm !== 'horizontal-tb' || n.rot || n.fx || n.kind === 'line' || !n.children.length) return n;
  const top = y + n.padding.top + borderWidths(n.border).top;
  let kids: LNode[] | undefined;
  for (let k = 0; k < n.children.length; k++) {
    const c = n.children[k];
    const cy = top + (c.phys ? c.phys.y : c.b) + (c.relShift?.y ?? 0);
    const drop = c.kind === 'line' && c.wm === 'horizontal-tb' && !c.rot && !c.fx && cy > limit;
    const next = drop ? undefined : dropLinesBelow(c, cy, limit);
    if (next !== c && !kids) kids = n.children.slice(0, k);
    if (kids && next) kids.push(next);
  }
  return kids ? { ...n, children: kids } : n;
}

/** 1 つの static-content について覚える、組んだ箱の件数 */
const STATIC_MEMO_ENTRIES = 4;

/** 組んだ static-content の箱の覚え: 組んだ条件 (ページの大きさ・書字方向・page-sequence・ページ番号の偶奇・取り出したマーカー) と、箱・警告 */
interface StaticMemoEntry {
  W: number;
  H: number;
  wm: WritingMode;
  seq: LPageSequence;
  parity: number;
  found: Array<LMarker | undefined>;
  nodes: LNode[];
  warnings: Diagnostic[];
}

/**
 * ページによって組んだ結果の変わる節の種類: ページ番号の参照・索引のページ番号 (番号が要る)、脚注・回り込み・マーカー (ページに跡を残す)、
 * fo:retrieve-table-marker。retrieve-marker は、取り出したマーカーを鍵にして別に扱う (staticRetrieves)
 */
const PAGE_VARIANT_TYPES = new Set(['page-number-citation', 'index-page-citation-list', 'footnote', 'footnote-citation', 'float', 'marker', 'retrieve-table-marker']);
const pageInvariant = new WeakMap<object, boolean>();

/**
 * 節 (と子孫) が、ページによらず同じに組めるか。ページ番号・総ページ数の差し替え ({pageNumber} など。substitute) のある文字列、
 * PAGE_VARIANT_TYPES の節を含まないこと。retrieve-marker は数えない (呼ぶ側が、取り出したマーカーを別に確かめる)。入力の節ごとに 1 度だけ調べる
 */
function isPageInvariant(node: object): boolean {
  const known = pageInvariant.get(node);
  if (known !== undefined) return known;
  // 深い入れ子でもスタックを使い切らないよう、積んで回る
  const stack: unknown[] = [node];
  let ok = true;
  while (ok && stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (v.includes('{') || v.includes('\u0000')) ok = false;
    } else if (Array.isArray(v)) {
      for (const e of v) if (typeof e === 'string' || (e && typeof e === 'object')) stack.push(e);
    } else if (v && typeof v === 'object') {
      const t = (v as { type?: unknown }).type;
      if (typeof t === 'string' && PAGE_VARIANT_TYPES.has(t)) ok = false;
      else for (const e of Object.values(v)) if (typeof e === 'string' || (e && typeof e === 'object')) stack.push(e);
    }
  }
  pageInvariant.set(node, ok);
  return ok;
}

const staticRetrieveList = new WeakMap<object, LRetrieveMarker[] | null>();

/**
 * static-content の中の retrieve-marker (文書の順)。中身がページで変わる (isPageInvariant でない) なら undefined (使い回せない)。
 * マーカーの中身に retrieve-marker があることは無い (XSL 1.1 §6.13.5: fo:marker は flow の子孫だけ。retrieve-marker は static-content の子孫だけ)
 */
function staticRetrieves(c: LBlockContainer): LRetrieveMarker[] | undefined {
  let list = staticRetrieveList.get(c);
  if (list === undefined) {
    list = null;
    if (isPageInvariant(c)) {
      list = [];
      const stack: unknown[] = [c];
      while (stack.length) {
        const v = stack.pop();
        if (Array.isArray(v)) for (let k = v.length - 1; k >= 0; k--) stack.push(v[k]);
        else if (v && typeof v === 'object') {
          if ((v as { type?: string }).type === 'retrieve-marker') list.push(v as LRetrieveMarker);
          else {
            const vals = Object.values(v);
            for (let k = vals.length - 1; k >= 0; k--) if (vals[k] && typeof vals[k] === 'object') stack.push(vals[k]);
          }
        }
      }
    }
    staticRetrieveList.set(c, list);
  }
  return list ?? undefined;
}

/** 静的コンテンツ中の retrieve-marker を、該当マーカーの内容 (または空) に置き換えた複製を返す */
function resolveMarkers<T>(node: T, pages: PageBuild[], index: number): T {
  return replaceRetrieves<T, LRetrieveMarker>(node, 'retrieve-marker', (r) => findMarker(r, pages, index));
}

/** 静的コンテンツ内の {pageNumber} / {totalPages} を置換した複製を返す */
function substitute<T>(node: T, vars: Record<string, string>, pageNo?: number, used?: Record<string, boolean>): T {
  // grid の項目の並び (列挙しない性質) を、写した木のセルに付け直す (gridCopies)
  const gc = gridCopies();
  const walk = (v: unknown): unknown => {
    // \u0000名前\u0000 は、文字として書かれた「{名前}」(置き換えない。xslfoImport の static-content の文字)。
    // {pageNumber|書式|text-transform} は、その書式のページ番号に text-transform を当てた字 (HTML の余白の箱の counter(page, …))
    if (typeof v === 'string')
      return v
        .replace(/\{pageNumber\|([^|}]*)\|([^}]*)\}/g, (m, fmt: string, tt: string) => (pageNo === undefined ? m : tt ? applyTextTransform(formatPageNumber(pageNo, fmt || undefined), tt) : formatPageNumber(pageNo, fmt || undefined)))
        .replace(/\{(\w+)\}/g, (m, k) => {
          if (!(k in vars)) return m;
          if (used && k in used) used[k] = true;
          return vars[k];
        })
        .replace(/\u0000(\w+)\u0000/g, '{$1}');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const copy = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, walk(val)]));
      copySourceRef(v, copy);
      gc?.note(v, copy);
      return copy;
    }
    return v;
  };
  const out = walk(node) as T;
  gc?.done();
  return out;
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

/** 鍵には、行分けの結果を変える Flow の設定 (中身の長さを測る intrinsic・最小の幅 minContent。'grid' は grid の項目の min-content: FlowInit.gridItemMin) も含める */
function lineMemoKey(at: number, L: number, first: boolean, wm: WritingMode, intrinsic: boolean, minContent: boolean | 'grid', blockRef: number | undefined) {
  return `${at}|${L}|${first ? 1 : 0}|${wm}|${intrinsic ? 1 : 0}${minContent === 'grid' ? 2 : minContent ? 1 : 0}|${blockRef ?? ''}`;
}

function lineMemoGet(arr: object, at: number, run: InlineChild[], st: ResolvedStyle, L: number, first: boolean, wm: WritingMode, host: FlowHost, intrinsic: boolean, minContent: boolean | 'grid', blockRef: number | undefined): LineMemo | undefined {
  const m = lineMemos.get(arr);
  const key = lineMemoKey(at, L, first, wm, intrinsic, minContent, blockRef);
  const e = m?.get(key);
  if (!e || e.measurer !== host.measurer || e.hyphenate !== host.hyphenate || e.kernAh !== !!host.kernAh || e.version !== host.measurer.version()) return undefined;
  if (e.run.length !== run.length || e.run.some((c, k) => c !== run[k])) return undefined;
  if (!sameStyle(e.st, st)) return undefined;
  if (host.lineMemoLru) {
    host.lineMemoLru.hits++;
    host.lineMemoLru.touch(arr, m!, key, e);
  }
  return e;
}

function lineMemoSet(arr: object, at: number, run: InlineChild[], st: ResolvedStyle, L: number, first: boolean, wm: WritingMode, host: FlowHost, intrinsic: boolean, minContent: boolean | 'grid', memo: LineMemo, blockRef: number | undefined) {
  if (host.lineMemoLru?.limit === 0) return;
  if (hasDynamicInline(run) || memo.atoms.some((a) => a.kind === 'box' || a.fnRef)) return;
  let m = lineMemos.get(arr);
  if (!m) lineMemos.set(arr, (m = new Map()));
  const key = lineMemoKey(at, L, first, wm, intrinsic, minContent, blockRef);
  const e: LineMemoEntry = { ...memo, run: run.slice(), st, measurer: host.measurer, hyphenate: host.hyphenate, kernAh: !!host.kernAh, version: host.measurer.version() };
  const prev = m.get(key);
  if (prev) host.lineMemoLru?.forget(prev);
  m.set(key, e);
  host.lineMemoLru?.touch(arr, m, key, e);
}

/**
 * 器 (createTypesetter の reuse) が覚える、前の文書の組版 (design/resumable-flow.md の 6.1・16・17)。次の文書の組み直しの 1 回目で、
 * 中身の指紋と始まりの条件 (開始ページ・左右・脚注の続き番号) が同じ page-sequence は、前の文書のページを使う (入力の節の番号・柱と
 * マーカーの入力の節を、いまの文書のものに付け替える)。中身の違う page-sequence も、ページの区切りの組みの状態が前の文書と揃えば、
 * 前の文書のページを繋ぐ。ページ番号の参照のあるページは、参照を引き直して組んだ字と同じときだけ使う。索引・ページごとの脚注番号のある
 * 文書・page-sequence は使わない。前の文書のページの論理の木と、ページの区切りの記録を手放さずに持つので、メモリはその分増える
 * (節の数の上限 limit を超える page-sequence からは覚えない)。覚えるのは組み直しの 1 回目の記録 (PrevLayout.undo)。
 * メモリ節約の組版 (layoutLowMemory)・先頭から N ページで止める組版では、覚えも使いもせず、覚えたものを残す (次に全体を組むときに使う)。
 * typesetToPdf は覚えないが、前に覚えたものは使う。組版を止めても、覚えたものは捨てない (止めた組版が使った前の文書の組版は、使い始めたときに外してある)
 */
export class LayoutReuse {
  /** 前の文書の組版 (使ったら外す: 次の文書の組版が、そのページを書き換えて使うので) */
  prev?: PrevLayout;
  /** 使い回した page-sequence とページの数 (試験・道具が見る) */
  readonly stats = { sequences: 0, pages: 0, spliced: 0, splicedPages: 0, skipped: 0, skippedPages: 0, passSpliced: 0, passSplicedPages: 0, passSkipped: 0, passSkippedPages: 0, overLimit: 0 };
  /** 覚えるページの論理の木の節の数の上限 (既定 REUSE_LNODES。超える page-sequence からは覚えない。stats.overLimit に数える) */
  limit = REUSE_LNODES;

  /**
   * 覚えている前の文書の組版のメモリの見積もり (バイト。Typesetter.memoryUsage の caches)。覚えた page-sequence のページ
   * (組み直しの 1 回目のページ。2 回目からの回で組み直した page-sequence も、1 回目のページを覚える) の論理の木の節の数と、
   * 2 回目からの回の字の差し替えの前の中身 (undo) の字の数に、1 つあたりの大きさ (REUSE_BYTES) を掛けたもの。
   * 数えるのは、覚えた組版ごとに 1 度 (ページの節の数は、上限の数え (pageLNodes) と同じものを使う)
   */
  memoryBytes(): number {
    const prev = this.prev;
    if (!prev) return 0;
    let n = prevLNodes.get(prev);
    if (n === undefined) {
      n = 0;
      for (const q of prev.seqs) for (const b of q?.memo.built ?? []) n += pageLNodes(b);
      prevLNodes.set(prev, n);
    }
    const k = REUSE_BYTES[memoryRuntime()];
    return n * k.lnode + (prev.undo ? prev.undo.glyphs.size + prev.undo.cites.size : 0) * k.undo;
  }
}

/** ページの論理の木の節の数 (本文と絶対配置の箱。ページごとに覚える。LayoutReuse の上限の数え) */
function pageLNodes(p: PageBuild): number {
  let n = pageLNodeCounts.get(p);
  if (n === undefined) {
    const seen = new Set<LNode>();
    let k = 0;
    const go = (x: LNode) => {
      if (seen.has(x)) return;
      seen.add(x);
      k++;
      for (const c of x.children) go(c);
    };
    go(p.root);
    p.abs.forEach(go);
    pageLNodeCounts.set(p, (n = k));
  }
  return n;
}
const pageLNodeCounts = new WeakMap<PageBuild, number>();

/**
 * Typesetter が覚える前の文書のページの論理の木の、節の数の上限の既定 (LayoutReuse。超える page-sequence からは覚えない)。
 * 1 つあたり約 200 バイト (Node。Chromium の Worker では約 0.6 倍) で、200 万はおよそ 400MB (行分けの覚えの上限 SHARED_LINE_MEMO_ATOMS と同じほど)
 */
export const REUSE_LNODES = 2_000_000;

/**
 * Typesetter の再利用のキャッシュのメモリの見積もり (LayoutReuse.memoryBytes・SharedLineMemo.memoryBytes) の係数 (バイト)。
 * scripts/measure-result-memory.mjs で、前の文書のページと行分けのキャッシュを手放したときに減ったヒープ (両方の和。2 つは行の節などを
 * 共有し、どちらを先に手放すかで、それぞれの減り方が変わるので、和で見る) を、2 つの数に割り振った目安。Node 22 (V8) で、
 * プレビューをまねた HTML (200 ページ)・対応仕様説明書の HTML と XSL-FO・文だけの文書 (215 ページ)・目次のある文だけの文書 (252 ページ) の和に、見積もりは −17〜+15% で合う
 * (node の値)。Chromium 158 の Web Worker の中 (量は Worker の CDP の Runtime.getHeapUsage の usedSize) では、同じ文書で Node のおよそ 0.57 倍
 * (V8 のポインタの圧縮) なので、browser の値は node の値の 0.57 倍にした (5 文書の和に −22〜+11% で合う)。どちらを使うかは memoryEstimate.ts の
 * memoryRuntime (Firefox・Safari は測っていないが、browser の値を使う)
 * (測った文書・処理系・条件は docs/development.md の「組んだ結果のメモリの見積もりの測り」)。
 *  - lnode: 前の文書のページの論理の木の節 1 つ (ページの区切りの記録・入力の論理の木の分をならして入れる)
 *  - atom: 段落の行分けのキャッシュの大きさ (lineMemoSize の数え方) 1 つ
 *  - undo: 2 回目からの回の文字の差し替えの前の中身 (CiteUndo の glyphs と cites の項目) 1 つ。測った文書のどれでも 0 件だったので測っておらず、atom と同じにした
 */
const REUSE_BYTES = { node: { lnode: 200, atom: 300, undo: 300 }, browser: { lnode: 115, atom: 170, undo: 170 } };
/** LayoutReuse.memoryBytes の、覚えた組版ごとのページの論理の木の節の数 */
const prevLNodes = new WeakMap<PrevLayout, number>();

/** 前の文書の組版 (LayoutReuse.prev) */
interface PrevLayout {
  /** 書体・上限・計測・選択肢・画像の印 (同じときだけ使い回す) */
  env: string;
  hyphenate: LayoutOptions['hyphenate'];
  /** 文書の page-sequence の外の欄の指紋 */
  docPrint: string;
  /** page-sequence ごとの、中身の指紋・入力の節の番号の範囲 (page-sequence の節と、その部分木の最後の節)・最後の組みの記録 */
  seqs: Array<{ print: string; start: number; end: number; memo: SeqMemo } | undefined>;
  /** 入力の節ごとの形 (nodeShapes。この文書との節の番号の対応を作る) と、入力の節の並び (番号の順) */
  shapes: () => NodeShapes;
  nodes: readonly object[];
  /** 組む手間の上限の数えの、回ごとの最大と、上限に当たったか (上限の近くの文書では使い回さない) */
  cost: number;
  hit: boolean;
  /**
   * seqs の記録は、組み直しの 1 回目のもの (次の文書の組み直しの 1 回目と比べる。前向きのページ番号の参照のあるページも、1 回目の仮の値で組んだ
   * ページとなら揃う)。2 回目からの回の字の差し替えが、その記録のページを書き換えていたら、書き換える前の中身 (使うときに戻す)
   */
  undo?: CiteUndo;
}

/**
 * 組版の入力の部分木の中身の指紋 (design/resumable-flow.md の 6.4): 欄の全部 (関数は除く) を、深さ優先にたどって短い字にする。
 * 同じ物は 1 度だけたどる (書式の物を、要素の間で使い回す読み込みでも、手間は物の数ほど)。
 * 入力の節のタグ付き PDF の構造の節の番号 (BaseNode.tag) は入れない: 組版は読まず (構造の木は、領域の入力の節の番号から finishTree が引く)、
 * 前の章に脚注や見出しを足すと、後ろの章の節の番号が全部ずれるので、入れると後ろの page-sequence を使い回さなかった
 */
function contentPrint(root: unknown): string {
  const memo = new Map<object, string>();
  const go = (v: unknown): string => {
    if (v === null) return 'n';
    switch (typeof v) {
      case 'string':
        return `s${hashText(v)}`;
      case 'number':
        return `d${v}`;
      case 'boolean':
        return v ? 'T' : 'F';
      case 'undefined':
        return 'u';
      case 'object':
        break;
      default:
        return 'x';
    }
    const o = v as object;
    const hit = memo.get(o);
    if (hit !== undefined) return hit;
    memo.set(o, 'c'); // 巡るときの止め
    let text: string;
    if (Array.isArray(o)) text = `[${o.map(go).join(',')}]`;
    else if (o instanceof Map) text = `M[${[...o].map(([k, x]) => `${go(k)}:${go(x)}`).join(',')}]`;
    else if (o instanceof Set) text = `S[${[...o].map(go).join(',')}]`;
    else if (ArrayBuffer.isView(o)) text = `B${hashText(Array.from(new Uint8Array(o.buffer, o.byteOffset, o.byteLength), (b) => String.fromCharCode(b)).join(''))}`;
    else {
      const parts: string[] = [];
      const type = (o as { type?: unknown }).type;
      const typed = typeof type === 'string';
      for (const [k, x] of Object.entries(o)) {
        if (typeof x === 'function' || (typed && k === 'tag')) continue;
        // 柱の fo:retrieve-marker の、マーカーごとの中身 (variants) は、節の数だけを入れる: 中身は、柱を組むとき (sheetStatics。回ごとに、
        // いまの文書の節で組み直す) だけが読み、ページの本文の組みは読まない。文書の全部のマーカーの中身が入るので、入れると、どこかのマーカーを
        // 直すだけで、どの page-sequence も使い回さなかった。節の数は入れる (page-sequence の中の節の番号のずれ方が、始まりの差と同じであるため)
        parts.push(`${k}=${type === 'retrieve-marker' && k === 'variants' ? `V${countNodes(x)}` : go(x)}`);
      }
      text = `{${parts.join(',')}}`;
    }
    const h = `h${hashText(text)}`;
    memo.set(o, h);
    return h;
  };
  return go(root);
}

/** 物の中の入力の節 (type の字を持つ物) の数 (documentNodes と同じたどり方) */
function countNodes(root: unknown): number {
  const seen = new Set<object>();
  let n = 0;
  const go = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (typeof (v as { type?: unknown }).type === 'string') n++;
    for (const x of Array.isArray(v) ? v : Object.values(v)) go(x);
  };
  go(root);
  return n;
}

/** 字の並びの短い指紋 (FNV-1a の 32 ビットを、種を変えて 2 つ) */
function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36);
}

/**
 * 入力の節ごとの、節そのものの形 (design/resumable-flow.md の 6.4 と 19.3)。
 *  - full: 節の欄を、子の節 (type の字を持つ物) は中身に降りずに、自分の番号からの差 (documentNodes の順の番号) だけを入れて、短い字にしたもの。
 *    部分木の終わりの番号の差も入れる。2 つの文書の full の並びの終わりの同じ所の節は、部分木ごと同じ (節の並びと形が、指紋で決まる)
 *  - weak: 子の節を指す所を、番号を入れずに字にしたもの (配列の中の子の節は、字に入れない。ブロックを足す・消すと、祖先の節の子の並びが
 *    変わるが、祖先の節の欄そのものは同じ)。部分木の終わりの番号も入れない
 *  - refs: 子の節を指す所の、[指す節の番号, 欄の道 (配列の中なら '[]' と、前にある節でない物の数で終わる)] の並び (diffShapes が、直した所の外の番号の対応で照らす)
 *  - ends: 部分木の終わりの番号の次 (部分木の最後の節の番号 + 1)
 * 構造の木の節の番号 (tag) と、文書の節の組版が読まない欄 (DOC_UNREAD) は入れない (前に節を足すとずれる。contentPrint・setupReuse の文書の指紋と同じ)
 */
interface NodeShapes {
  full: string[];
  weak: string[];
  refs: Array<Array<[number, string]>>;
  ends: number[];
}

/** 文書の節の欄のうち、組版が読まないもの (setupReuse の文書の指紋にも入れない。nodeShapes の文書の節の形にも入れない) */
const DOC_UNREAD = new Set(['title', 'info', 'bookmarks', 'structure']);

function nodeShapes(nodes: readonly object[]): NodeShapes {
  /** 節を含まない物の指紋 (含む物は、どの節から見たかで字が変わるので覚えない。節を含まない物は full と weak が同じ) */
  const memo = new Map<object, string>();
  const out: NodeShapes = { full: new Array(nodes.length), weak: new Array(nodes.length), refs: new Array(nodes.length), ends: new Array(nodes.length) };
  const isNode = (v: unknown) => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';
  /** いまたどっている欄の道 (子の節を指す所を見つけたときだけ字にする) */
  const path: Array<string | number> = [];
  for (let i = 0; i < nodes.length; i++) {
    const self = nodes[i];
    const stack = new Set<object>();
    const refs: Array<[number, string]> = [];
    const docNode = (self as { type?: unknown }).type === 'document';
    /** [full, weak, 節を含んだか] */
    const go = (v: unknown, top: boolean): [string, string, boolean] => {
      if (v === null) return ['n', 'n', false];
      switch (typeof v) {
        case 'string': {
          const t = `s${hashText(v)}`;
          return [t, t, false];
        }
        case 'number':
          return [`d${v}`, `d${v}`, false];
        case 'boolean':
          return v ? ['T', 'T', false] : ['F', 'F', false];
        case 'undefined':
          return ['u', 'u', false];
        case 'object':
          break;
        default:
          return ['x', 'x', false];
      }
      const o = v as object;
      if (!top && isNode(o)) {
        const r = sourceRef(o) ?? -1e9;
        refs.push([r, path.join('.')]);
        return [`N${r - i}`, 'N', true];
      }
      const hit = memo.get(o);
      if (hit !== undefined) return [hit, hit, false];
      if (stack.has(o)) return ['c', 'c', true];
      stack.add(o);
      let has = false;
      const sub = (x: unknown, key: string | number) => {
        path.push(key);
        const r = go(x, false);
        path.pop();
        if (r[2]) has = true;
        return r;
      };
      let full: string;
      let weak: string;
      if (Array.isArray(o)) {
        const f: string[] = [];
        const w: string[] = [];
        // 配列の中の子の節は weak に入れない (足す・消すで並びが変わる)。節でない物は、節でない物の中の順で道を付ける。
        // 子の節の道には、前にある節でない物の数を入れる (`[]k`。行内の子と文字列の並べ方だけを変えた直し (<p>ABC<b>X</b></p> → <p><b>X</b>ABC</p>) を、
        // 親の子を指す所の違いで見つける。節でない物の無い配列では、どれも `[]0` で、節を足す・消すのは前のとおり R として除く)
        let k = 0;
        for (const x of o) {
          const node = isNode(x);
          const [a, b] = sub(x, node ? `[]${k}` : k++);
          f.push(a);
          if (!node) w.push(b);
        }
        full = `[${f.join(',')}]`;
        weak = `[${w.join(',')}]`;
      } else if (o instanceof Map) {
        const f: string[] = [];
        const w: string[] = [];
        let k = 0;
        for (const [kk, x] of o) {
          const [a1, b1] = sub(kk, `m${k}k`);
          const [a2, b2] = sub(x, `m${k++}`);
          f.push(`${a1}:${a2}`);
          w.push(`${b1}:${b2}`);
        }
        full = `M[${f.join(',')}]`;
        weak = `M[${w.join(',')}]`;
      } else if (o instanceof Set) {
        const f: string[] = [];
        const w: string[] = [];
        let k = 0;
        for (const x of o) {
          const [a, b] = sub(x, `s${k++}`);
          f.push(a);
          w.push(b);
        }
        full = `S[${f.join(',')}]`;
        weak = `S[${w.join(',')}]`;
      } else if (ArrayBuffer.isView(o)) full = weak = `B${hashText(Array.from(new Uint8Array(o.buffer, o.byteOffset, o.byteLength), (b) => String.fromCharCode(b)).join(''))}`;
      else {
        const f: string[] = [];
        const w: string[] = [];
        for (const [k, x] of Object.entries(o)) {
          if (typeof x === 'function' || (top && (k === 'tag' || (docNode && DOC_UNREAD.has(k))))) continue;
          const [a, b] = sub(x, k);
          f.push(`${k}=${a}`);
          w.push(`${k}=${b}`);
        }
        full = `{${f.join(',')}}`;
        weak = `{${w.join(',')}}`;
      }
      stack.delete(o);
      const hf = `h${hashText(full)}`;
      const hw = has ? `h${hashText(weak)}` : hf;
      if (!has && !top) memo.set(o, hf);
      return [hf, hw, has];
    };
    const [f, w] = go(self, true);
    const end = (sourceRefEnd(self) ?? i) + 1;
    out.full[i] = `${f}|${end - 1 - i}`;
    out.weak[i] = w;
    out.refs[i] = refs;
    out.ends[i] = end;
  }
  return out;
}

/**
 * 前の文書と、この文書の入力の節の番号の対応 (design/resumable-flow.md の 6.2 の 2)。節の指紋の並びの、初めの同じ所 (P 個) と
 * 終わりの同じ所の外 (前の文書の [P, oldEnd)、この文書の [P, newEnd)) が、直した所。初めの同じ所は同じ番号、終わりの同じ所は delta だけずれる
 */
interface ReuseMap {
  P: number;
  oldEnd: number;
  newEnd: number;
  delta: number;
}

/**
 * 前の文書の節の形 a と、この文書の節の形 b から、直した所を求める (design/resumable-flow.md の 19.3)。
 *  1. 初めの同じ所 P: weak の同じ節の並び (祖先の節は、子の並びが変わっても欄が同じなら同じとする)
 *  2. 終わりの同じ所: full の同じ節の並び (部分木ごと同じ。P より前には入れない)
 *  3. 初めの同じ所の節のそれぞれで、子の節を指す所と部分木の終わりを、直した所の外の番号の対応で照らす (直した所の中を指す所は R にし、
 *     配列の中の R は除いて比べる: 子の並びに足した・消した節は、直した所の中にある)。照らせない節があれば、そこを P にして 2 からやり直す
 */
function diffShapes(a: NodeShapes, b: NodeShapes): ReuseMap {
  const na = a.full.length;
  const nb = b.full.length;
  const n = Math.min(na, nb);
  let P = 0;
  while (P < n && a.weak[P] === b.weak[P]) P++;
  for (;;) {
    let S = 0;
    while (S < n - P && a.full[na - 1 - S] === b.full[nb - 1 - S]) S++;
    const m: ReuseMap = { P, oldEnd: na - S, newEnd: nb - S, delta: nb - na };
    const mapOld = (r: number) => (r < m.P ? `A${r}` : r >= m.oldEnd ? `A${r + m.delta}` : 'R');
    const mapNew = (r: number) => (r < m.P || r >= m.newEnd ? `A${r}` : 'R');
    // 部分木の終わり (の次): 直した所に触れる (直した所の初めから終わりまでの間) なら R
    const endOld = (e: number) => (e < m.P ? `A${e}` : e > m.oldEnd ? `A${e + m.delta}` : 'R');
    const endNew = (e: number) => (e < m.P || e > m.newEnd ? `A${e}` : 'R');
    const view = (refs: Array<[number, string]>, f: (r: number) => string) => {
      const out: string[] = [];
      for (const [r, at] of refs) {
        const x = f(r);
        if (x === 'R' && /(?:^|\.)\[\]\d+$/.test(at)) continue;
        out.push(`${at}=${x}`);
      }
      return out.join(',');
    };
    let bad = -1;
    for (let i = 0; i < P && bad < 0; i++) if (endOld(a.ends[i]) !== endNew(b.ends[i]) || view(a.refs[i], mapOld) !== view(b.refs[i], mapNew)) bad = i;
    if (bad < 0) return m;
    P = bad;
  }
}

/** 前の文書の節の番号 → この文書の同じ節の番号 (直した所の中は undefined) */
function mapRef(m: ReuseMap, r: number): number | undefined {
  return r < m.P ? r : r >= m.oldEnd ? r + m.delta : undefined;
}

/** 組んだ箱・行内の枠の、入力の節の番号を持つ欄 (ref・効果の印の fxRef・輪郭線の outlineRef・リンクの linkRef) */
const REF_KEYS = new Set(['ref', 'fxRef', 'outlineRef', 'linkRef']);

/** 入力の節の欄の配列 → 持ち主の節と欄の名前 (sameMapped) */
type ArrayOwners = WeakMap<object, [object, string]>;

function arrayOwners(nodes: readonly object[]): ArrayOwners {
  const out: ArrayOwners = new WeakMap();
  for (const n of nodes) for (const [k, v] of Object.entries(n)) if (Array.isArray(v) && !out.has(v)) out.set(v, [n, k]);
  return out;
}

/**
 * 境目の流れの欄のうち、続きの組みが読む前に openPage が書き換えるもの (前の組版と揃ったかの比べに入れない)。閉じたページの本文の木・
 * 保留の余白 (resetPending)・ページごとに戻す欄
 */
const SPLICE_IGNORED = new Set(['root', 'limit', 'cursor', 'pendPos', 'pendNeg', 'pendAny', 'pendPrec', 'pendForce', 'pendMin', 'pendAdjust', 'pendSpill', 'pendKeep', 'adjacent', 'areaTop', 'pageHasContent', 'pageItems', 'refStartItems', 'edgeBlocked', 'headerOnly', 'floats', 'beforeNodes', 'beforeUsed', 'beforeLast', 'afterFloats', 'afterUsed', 'afterBase', 'beforeSepNode', 'beforeSepH', 'marginalBottom']);

/**
 * 境目の流れの欄のうち、組んだ箱・セルを鍵にする覚え (WeakMap。中を並べられない)。前の組版と比べるときは、比べる物の組 (前の組版の物と
 * この組みの物) のそれぞれで、覚えの有無と値を比べる (sameMapped の side)。入力のセルを鍵にする flexItemCaps は、組んでいる表のセルで比べる
 * (spliceSideOk)。組んでいる表の無い境目では、どれも続きの組みで読まない (表を組むときに、その表のセルで作る)
 */
const SPLICE_SIDE = new Set(['cellAbs', 'cellCols', 'flexItemCaps']);

/**
 * 境目の流れの欄の、比べる形 (SPLICE_IGNORED を除き、開いた箱は、openPage が次の断片を作るのに読む欄だけにする。開いた箱の節は、
 * 閉じたページの断片で、中身は読まない)
 */
function spliceView(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!SPLICE_IGNORED.has(k) && !SPLICE_SIDE.has(k)) out[k] = v;
  out.stack = (fields.stack as Frame[]).map((f) => {
    if (!f.opened) return f;
    const n = f.node;
    return { ...f, node: { kind: n.kind, wm: n.wm, isize: n.isize, colSizes: n.colSizes, flexContentI: n.flexContentI, gridContent: n.gridContent }, startB: 0, contentStartB: 0 };
  });
  return out;
}

/**
 * 続きの位置の鎖の、比べる形: 表の行の塊の、保留の行・組んでいる塊・分けた断片の位置 (i・b) は、続きのページで置くときに書き直すので比べない
 * (行の節の中身は変えない。design/resumable-flow.md の 14)
 */
function spliceSteps(steps: readonly ResumeStep[]): unknown[] {
  const at = (ns: LNode[]) => ns.map((n) => ({ ...n, i: 0, b: 0 }));
  // 行の並びを置く所の、まだ置いていない行の中の箱 (行内の箱・画像) の位置も、その行を置くときに書き直す (境目の後で、写しの中の同じ箱に書くので、
  // 比べると前の組版の値が違って見える)。行を置く所の欄 (字・行分け・行) の中の組んだ箱は、位置を除いて比べる
  const memo = new Map<object, unknown>();
  const unplace = (v: unknown): unknown => {
    if (!v || typeof v !== 'object' || sourceRef(v) !== undefined) return v;
    const o = v as Record<string, unknown>;
    if (memo.has(o)) return memo.get(o);
    if (Array.isArray(o)) {
      const out: unknown[] = [];
      memo.set(o, out);
      for (const x of o) out.push(unplace(x));
      return out;
    }
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) return o;
    const out: Record<string, unknown> = {};
    memo.set(o, out);
    const box = typeof o.kind === 'string' && Array.isArray(o.children) && typeof o.b === 'number';
    for (const [k, x] of Object.entries(o)) out[k] = box && (k === 'i' || k === 'b') ? 0 : unplace(x);
    return out;
  };
  return steps.map((st) =>
    st.k === 'table' && st.rs
      ? { ...st, rs: { ...st.rs, pending: at(st.rs.pending), grp: at(st.rs.grp), frags: at(st.rs.frags), i: childAt(st.rs.rows, st.rs.i), end: childAt(st.rs.rows, st.rs.end) } }
      : st.k === 'inline' && st.ctx
        ? { ...st, ctx: unplace(st.ctx) }
        : st.k === 'children'
          ? { ...st, at: childAt(st.children, st.at), runAt: childAt(st.children, st.runAt), topAt: childAt(st.children, st.topAt) }
          : st,
  );
}

/**
 * 子の並びの中の位置 (ChildrenStep の at・runAt・topAt と、表の行の塊を置く所の i・end) の、比べる形: その位置の子の節 (sameMapped が、節の番号の
 * 対応で比べる)。並びの終わりは 'end'、無い位置 (負の数) は 'none'。前の子の並びにブロックを足す・消すと、後ろの子の位置の数はずれるが、指す子の節は
 * 対応する (位置の数のまま比べると、消した節の後ろの別の子を同じ位置と見ることがある)
 */
function childAt(children: ReadonlyArray<unknown>, k: number): unknown {
  if (k < 0) return 'none';
  if (k >= children.length) return 'end';
  const c = children[k];
  // 字の子 (節でない物) は位置で見分けられないので、位置の数のまま比べる (ずれれば揃わないとする)
  return c && typeof c === 'object' ? c : `#${k}`;
}

/**
 * 前の文書の組みの状態 a と、この文書の組みの状態 b が、節の番号の対応 m の下で同じか (design/resumable-flow.md の 5.3。
 * 境目から先を前の組版から繋いでよいかを決める)。入力の節 (番号を持つ物) は、番号が対応すること、組んだ箱の番号の欄 (ref) は、
 * 番号が対応することを見る。ほかの物は、欄の全部を降りて比べる。関数・WeakMap など、中を見られない物は、同じ物のときだけ同じとする
 * (違うと見る誤りは、繋がないだけで結果を変えない)
 */
function sameMapped(a: unknown, b: unknown, m: ReuseMap, owners: { old: ArrayOwners; now: ArrayOwners }, why?: (path: string) => void, side: ReadonlyArray<[WeakMap<object, unknown>, WeakMap<object, unknown>]> = []): boolean {
  // 比べた物の組 (巡る物の止め)。物の共有のしかたは比べない (同じ値の書式を、片方では 1 つの物で、もう片方では別の物で持つことがある)
  const pairs = new Map<object, Set<object>>();
  const path: Array<string | number> = [];
  const eq = (x: unknown, y: unknown, key: string | number | undefined): boolean => {
    if (!why) return same(x, y, key);
    path.push(key ?? '');
    const r = same(x, y, key);
    if (!r && path.length) {
      why(path.join('.'));
      path.length = 0;
    }
    path.pop();
    return r;
  };
  const same = (x: unknown, y: unknown, key: string | number | undefined): boolean => {
    if (typeof key === 'string' && REF_KEYS.has(key) && typeof x === 'number' && typeof y === 'number') return mapRef(m, x) === y;
    if (x === y) return true;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y);
    const rx = sourceRef(x);
    const ry = sourceRef(y);
    if (rx !== undefined || ry !== undefined) return rx !== undefined && mapRef(m, rx) === ry && (x as { type?: unknown }).type === (y as { type?: unknown }).type;
    let seen = pairs.get(x);
    if (seen?.has(y)) return true;
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;
    if (!seen) pairs.set(x, (seen = new Set()));
    seen.add(y);
    for (const [wo, wn] of side) {
      const hx = wo.has(x);
      if (hx !== wn.has(y) || (hx && !eq(wo.get(x), wn.get(y), 'side'))) return false;
    }
    // 入力の節の欄の配列 (子の並びなど): 持ち主の節が対応し、同じ欄なら同じ (直した所の祖先の子の並びは、直した子を含むが、
    // 続きの位置が直した所の後ろなら、続きで読むのは後ろの子だけで、それは同じ)
    const ox = owners.old.get(x);
    const oy = owners.now.get(y);
    if (ox || oy) return !!ox && !!oy && ox[1] === oy[1] && mapRef(m, sourceRef(ox[0])!) === sourceRef(oy[0]);
    if (Array.isArray(x)) {
      const ya = y as unknown[];
      if (x.length !== ya.length) return false;
      for (let i = 0; i < x.length; i++) if (!eq(x[i], ya[i], i)) return false;
      return true;
    }
    if (x instanceof Map) {
      const ym = y as Map<unknown, unknown>;
      if (x.size !== ym.size) return false;
      const ye = [...ym];
      let i = 0;
      for (const [k, v] of x) {
        if (!eq(k, ye[i][0], undefined) || !eq(v, ye[i][1], undefined)) return false;
        i++;
      }
      return true;
    }
    if (x instanceof Set) {
      const ys = [...(y as Set<unknown>)];
      if (x.size !== ys.length) return false;
      let i = 0;
      for (const v of x) if (!eq(v, ys[i++], undefined)) return false;
      return true;
    }
    if (ArrayBuffer.isView(x)) {
      const xa = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      const yv = y as ArrayBufferView;
      const yb = new Uint8Array(yv.buffer, yv.byteOffset, yv.byteLength);
      return xa.length === yb.length && xa.every((v, i) => v === yb[i]);
    }
    if (x instanceof WeakMap || x instanceof WeakSet || x instanceof WeakRef) return false;
    // 書体 (LoadedFont): 器が前の文書と同じ書体の組 (FontManager.signature。同じバッファ) のときだけ繋ぐので、前の文書の書体といまの文書の書体は、
    // 同じバッファから作った別の物になる (文書ごとに @font-face の書体を作り直す)。中の fontkit の物 (fk) は、読んだ所 (stream.pos) や覚えが
    // 読み方で変わり、組んだ結果でないので比べない。同じ鍵と同じバッファ (と可変フォントの実体の元) なら同じ書体とする
    if ('fk' in x && 'buffer' in x && (x as { buffer: unknown }).buffer instanceof ArrayBuffer) {
      const fx = x as { key?: unknown; buffer: unknown; instanceOf?: unknown };
      const fy = y as { key?: unknown; buffer?: unknown; instanceOf?: unknown };
      return fx.key === fy.key && fx.buffer === fy.buffer && eq(fx.instanceOf, fy.instanceOf, 'instanceOf');
    }
    const kx = Object.keys(x);
    const ky = Object.keys(y);
    if (kx.length !== ky.length) {
      if (why) why(`${path.join('.')}{keys ${kx.filter((k) => !ky.includes(k)).join(',')} / ${ky.filter((k) => !kx.includes(k)).join(',')}}`);
      return false;
    }
    const yo = y as Record<string, unknown>;
    for (const k of kx) {
      if (!Object.prototype.hasOwnProperty.call(yo, k)) return false;
      if (!eq((x as Record<string, unknown>)[k], yo[k], k)) return false;
    }
    return true;
  };
  return eq(a, b, undefined);
}

/**
 * 段落の行分けの結果を、段落の中身で覚えるもの (文書をまたいで使い回す。器 (createTypesetter の reuse) が作り、LayoutOptions.sharedLineMemo で渡す)。
 * 子の配列で引く覚え (lineMemos) は、同じ文書を組み直す間 (組み直しの回・試し組み) にしか当たらない (文書を読み直すと、中身が同じでも別の配列になる)。
 * こちらは、行の中身と書式・行の長さ・組み方の設定を並べた鍵 (sharedLineKey) で引く。
 * 当たるのは、書体の組の印 (FontManager.signature) が覚えたときと同じときだけ。覚えた結果の中の書体 (字の測りの LoadedFont) は、覚えた文書の
 * 書体の組のものなので、いまの組の、同じ鍵の書体に差し替えて使う (印が同じなら、同じ中身のファイルを同じ設定で登録した書体)。
 * 軸の値の実体 (可変フォントの instanceOf) を使った結果は、実体の作り方が組ごとなので覚えない。
 * 持つのは、いまの文書と前の文書で使ったものだけ (startDocument)。使い回しても、組んだ結果は使い回さないときと同じ
 * (test/reuse.test.ts が、領域の木と PDF のバイト列で確かめる)。
 * 大きさの上限に達したら、いまの文書でまだ 1 つも当たっていなければ、前の文書の項目を捨てて覚え、当たっていれば新しい段落を覚えない
 * (当たっている間に古く使ったものから捨てると、上限より大きな文書を頭から組み直すとき、次に使う段落 (前の文書の前の方の段落) から順に捨てる
 * ことになり、文書をまたいで 1 つも当たらない。表の多い 89 ページの文書で、前の文書の段落の覚えを全部捨てていた)。使わなくなった段落は、
 * 次の文書の初めに捨てる (startDocument)
 */
export class SharedLineMemo {
  /** 覚えた段落 (Map の並びは使った順。使うたびに後ろへ移す) */
  private entries = new Map<string, SharedLineEntry>();
  private doc = 0;
  /** 覚えている大きさ (lineMemoSize と同じ数え方) */
  private atoms = 0;
  /** いまの文書で、覚えから使い回した数 (上限に達したとき、前の文書の項目を捨てて覚えるかを決める。set) */
  private docHits = 0;

  /** 同じ器が覚える、前の文書の組版 (page-sequence の使い回し。LayoutOptions.layoutReuse に渡す) */
  readonly layout = new LayoutReuse();

  /** limit: 覚えておく大きさの上限 (atom の数と、項目ごとの行の分。既定 SHARED_LINE_MEMO_ATOMS)。超えるものは覚えない */
  constructor(readonly limit = SHARED_LINE_MEMO_ATOMS) {}

  /**
   * 次の文書を組み始める (Typesetter が文書ごとに呼ぶ)。その文書の印 (番号) を返す。前の文書で使わず、最後に組み終えた文書でも使わなかったものを捨てる
   * (FontPrepCache と同じ。止めた文書の知らせが、次の文書の初めの後に遅れて来て、止めた文書を世代に数えても、最後に組み終えた文書の段落の覚えを、
   * 止めた文書がまだ組んでいなかった所の分まで残す)
   */
  startDocument(): number {
    this.doc++;
    this.docHits = 0;
    for (const [k, e] of this.entries) if (e.used < this.doc - 1 && !(this.lastFull > 0 && e.usedFull === this.lastFull)) this.drop(k, e);
    return this.doc;
  }

  /** 最後に組み終えた (止めなかった) 文書の番号 (0 なら無い。finishDocument で決める) */
  private lastFull = 0;

  /**
   * 印 doc の文書を組み終えた (止めずに終わった): 最後に組み終えた文書にし、その文書で使った段落に印を覚えさせる (後の止めた文書で used が
   * 上書きされても残せるように。FontPrepCache.finishDocument と同じ)。止めた文書 (signal・maxPages) では呼ばない
   */
  finishDocument(doc: number): void {
    if (doc < this.lastFull) return;
    this.lastFull = doc;
    for (const e of this.entries.values()) if (e.used === doc) e.usedFull = doc;
  }

  /**
   * 印 doc の文書を止めた (TypesetOptions.signal): その文書を世代に数えない (次の文書から見て、止めた文書の前の文書を「前の文書」のままにする)。
   * 止めた文書で使ったもの・覚えたものは、中身で引く覚えなので、そのまま残してよい (次の文書の世代で使ったものとして数える)。
   * 止めた知らせが、次の文書の startDocument の後に遅れて来たとき (印が、いまの文書でないとき) は、世代を戻さない (戻すと、いまの文書の世代が 1 つずれる)
   */
  cancelDocument(doc: number): void {
    if (doc === this.doc && this.doc > 0) this.doc--;
  }

  private drop(k: string, e: SharedLineEntry): void {
    this.entries.delete(k);
    this.atoms -= lineMemoSize(e.memo);
  }

  /** 覚えている段落の数 (試験で見る) */
  get size(): number {
    return this.entries.size;
  }

  /** 覚えている段落と、前の文書の組版 (layout) のメモリの見積もり (バイト。Typesetter.memoryUsage の caches) */
  memoryBytes(): number {
    return this.atoms * REUSE_BYTES[memoryRuntime()].atom + this.layout.memoryBytes();
  }

  /**
   * 覚えている段落と、前の文書の組版を捨てる (Typesetter.releaseCaches)。文書の番号は残す (組んでいる途中の文書の印は、そのまま使える)。
   * 組んでいる途中に呼んでもよい (その文書は、残りの段落を覚えから引かずに組む。組んだ結果は同じ)
   */
  clear(): void {
    this.entries.clear();
    this.atoms = 0;
    this.layout.prev = undefined;
  }

  get(key: string, env: string, fonts: FontManager, hyphenate: FlowHost['hyphenate']): LineMemo | undefined {
    const e = this.entries.get(key);
    if (!e || e.env !== env || e.hyphenate !== hyphenate) return undefined;
    // 結果の中の書体を、いまの書体の組の同じ鍵の書体に差し替える (同じ組なら、そのまま)
    const now = new Map<LoadedFont, LoadedFont>();
    for (const old of e.fonts) {
      const cur = fonts.byKey(old.key);
      if (!cur || cur.buffer !== old.buffer) return undefined;
      if (cur !== old) now.set(old, cur);
    }
    if (now.size) {
      for (const [obj, k] of e.slots) {
        const v = obj[k] as LoadedFont;
        const cur = now.get(v);
        if (cur) obj[k] = cur;
      }
      e.fonts = e.fonts.map((f) => now.get(f) ?? f);
    }
    e.used = this.doc;
    this.docHits++;
    // 使った順の後ろへ移す
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.memo;
  }

  set(key: string, env: string, hyphenate: FlowHost['hyphenate'], memo: LineMemo): void {
    const prev = this.entries.get(key);
    // 上限を超えるなら覚えない (覚えの中を調べる手間もかけない)。1 つも覚えていないときは、上限より大きくても覚える
    const over = () => this.entries.size > (prev ? 1 : 0) && this.atoms - (prev ? lineMemoSize(prev.memo) : 0) + lineMemoSize(memo) > this.limit;
    if (over()) {
      // いまの文書で 1 つも使い回していない (器で、別の文書に移った): 前の文書の項目を、古く使ったものから捨てて覚える
      // (覚えずにいると、前の文書の項目が次の文書の初めまで残り、いまの文書も次の文書も当たらない)。同じ文書の組み直し (当たりがある) では捨てない
      if (this.docHits > 0) return;
      for (const [k, e] of this.entries) {
        if (!over()) break;
        if (e.used < this.doc && k !== key) this.drop(k, e);
      }
      if (over()) return;
    }
    // 結果の中の書体の置き場所 (差し替えるときに書き換える所) を集める
    const slots: Array<[Record<string, unknown>, string]> = [];
    const fonts = new Set<LoadedFont>();
    const seen = new Set<object>();
    let instance = false;
    const walk = (v: unknown) => {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) {
        for (const x of v) walk(x);
        return;
      }
      const o = v as Record<string, unknown>;
      for (const k in o) {
        const x = o[k];
        if (x && typeof x === 'object' && isLoadedFont(x)) {
          if (x.instanceOf) instance = true;
          fonts.add(x);
          slots.push([o, k]);
        } else walk(x);
      }
    };
    walk(memo);
    if (instance) return;
    if (prev) this.drop(key, prev);
    this.entries.set(key, { memo, env, hyphenate, used: this.doc, usedFull: 0, fonts: [...fonts], slots });
    this.atoms += lineMemoSize(memo);
  }
}

interface SharedLineEntry {
  memo: LineMemo;
  env: string;
  /** 分綴の位置を返す関数 (同じ関数のときだけ使う) */
  hyphenate: FlowHost['hyphenate'];
  /** 最後に使った文書の番号 (止めた文書も) と、最後に使った組み終えた文書の番号 (0 なら無い) */
  used: number;
  usedFull: number;
  fonts: LoadedFont[];
  slots: Array<[Record<string, unknown>, string]>;
}

/** 字の測りの書体 (LoadedFont) か (書体の組の登録の鍵・fontkit の書体・em の大きさを持つもの) */
function isLoadedFont(x: object): x is LoadedFont {
  const f = x as Partial<LoadedFont>;
  return typeof f.key === 'string' && typeof f.unitsPerEm === 'number' && !!f.fk && f.buffer instanceof ArrayBuffer;
}

/**
 * 文書をまたぐ行分けの覚えの鍵: 行の中身 (子の並びの全部の欄)・書式 (ResolvedStyle の全部の欄)・行の長さ・最初の行か・書字方向・
 * 中身の幅を測る組版か・block の入力の節の番号と、行分けに効く組版の設定 (互換のカーニング・XSL の空白の扱い・字の測り方)。
 * 関数の欄を持つ中身は、比べられないので覚えない (undefined)
 */
function sharedLineKey(run: InlineChild[], st: ResolvedStyle, L: number, first: boolean, wm: WritingMode, host: FlowHost, intrinsic: boolean, minContent: boolean | 'grid', blockRef: number | undefined): string | undefined {
  let bad = false;
  const replacer = (_k: string, v: unknown) => {
    if (typeof v === 'function' || typeof v === 'symbol') bad = true;
    return v;
  };
  let body: string;
  try {
    body = JSON.stringify([run, st], replacer);
  } catch {
    return undefined;
  }
  if (bad) return undefined;
  const backend = host.measurer.version().split(':')[0];
  return `${lineMemoKey(0, L, first, wm, intrinsic, minContent, blockRef)}|${host.kernAh ? 1 : 0}${host.xslSpace ? 1 : 0}|${backend}|${body}`;
}

/**
 * 文書をまたぐ行分けの覚え (SharedLineMemo) に置いておく大きさの上限の既定 (lineMemoSize の数え方)。
 * 覚えは、前の文書の全部の段落を持つので、文書の大きさの分のメモリを使う (142 ページの和文の本で、大きさ約 46 万・メモリ約 190MB。1 あたり 400 バイトほど)。
 * 100 万 (メモリ約 400MB まで) は、そのような本の 300 ページほど。それより長い文書は、上限までの段落だけを覚えるので、後ろの方の段落は当たらない
 */
export const SHARED_LINE_MEMO_ATOMS = 1_000_000;

/**
 * 行分けの結果の覚えに置いておく atom の数の上限の既定。覚えは、同じ段落を続けて組み直すとき (段の高さ揃えの二分探索・
 * keep-with-next の試し組み・表のセルの計測など) に効くので、近くに組んだ段落の分だけ持てばよい。上限が無いと、文書の全部の段落の
 * 字ごとの atom・行・行の位置を、組み終えるまで持ち続け、ふつうの文章 1MB で約 170MB、表 1MB (10 万セル) で約 870MB を使った (組み終えた時点の、GC の後に残る量)。
 * 5 万は、ふつうの本文の 20 ページほど (1 ページ 2500 字。行ごとの分を含めて数える)
 */
export const LINE_MEMO_ATOMS = 50000;

/**
 * 行分けの結果の覚えの、覚えている atom の数と、使った順 (古いものから捨てる)。
 * 使った順は、使うたびに後ろへ足す列 (queue) と、項目ごとの最後に足した番号 (last) で持つ (列の古い番号の並びは読み飛ばす)。
 * Map の入れ直しで順を持つと、先頭から取り出すたびに、消した項目の跡をたどり直すので、取り出す数の 2 乗の手間になる
 */
/** 覚えの項目の大きさの見積もり (atom の数に、項目ごとの行・行の位置などの分を足す。小さな段落 (表のセルなど) が多いとき、項目の数でも抑える) */
const lineMemoSize = (e: LineMemo) => e.atoms.length + 32 * (1 + e.raws.length);

class LineMemoLru {
  private queue: Array<{ e: LineMemoEntry; arr: object; m: Map<string, LineMemoEntry>; key: string; n: number }> = [];
  private head = 0;
  private last = new Map<LineMemoEntry, number>();
  private serial = 0;
  private atoms = 0;
  /** 覚えた大きさのいちばん大きかった値 (捨てた後の値) と、使い回した回数 (LayoutStats に出す) */
  peak = 0;
  hits = 0;
  constructor(readonly limit: number) {}
  forget(e: LineMemoEntry): void {
    if (this.last.delete(e)) this.atoms -= lineMemoSize(e);
  }
  touch(arr: object, m: Map<string, LineMemoEntry>, key: string, e: LineMemoEntry): void {
    if (!this.last.has(e)) this.atoms += lineMemoSize(e);
    const n = ++this.serial;
    this.last.set(e, n);
    this.queue.push({ e, arr, m, key, n });
    while (this.atoms > this.limit && this.last.size > 1 && this.head < this.queue.length) {
      const q = this.queue[this.head++];
      // 後で使い直した項目 (列の後ろに新しい番号がある) と、もう覚えていない項目は読み飛ばす
      if (this.last.get(q.e) !== q.n) continue;
      this.last.delete(q.e);
      this.atoms -= lineMemoSize(q.e);
      if (q.m.get(q.key) === q.e) q.m.delete(q.key);
      if (q.m.size === 0 && lineMemos.get(q.arr) === q.m) lineMemos.delete(q.arr);
    }
    if (this.atoms > this.peak) this.peak = this.atoms;
    // 読み終えた列の前の部分を捨てる
    if (this.head > 1024 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
  }
}

/** 字形を差し替える OpenType の機能の並びが同じか (違う機能の字の組には、カーニングを当てない) */
function sameFeatures(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((f, i) => f === y[i]);
}

/** 1 つの SVG の、見つからない参照の警告を 1 件ずつ出す数 (残りは数だけの 1 件にまとめる) */
const SVG_MISSING_SHOWN = 20;
/** SVG の中で見つからない外の画像を調べた結果 (SVG の中身ごと。同じ SVG を何度置いても、1 度だけ調べる) */
const svgMissingMemo = new WeakMap<Uint8Array, Array<{ href: string; use: boolean }>>();
/**
 * SVG の image 要素の href のうち、data: でなく、SVG の場所を基準に引いた画像が PNG・JPEG でないもの (見つからないものも)と、
 * use 要素の href の外のファイルのうち、SVG でないもの (見つからないものも)。
 * PDF の書き出し (pdfRenderer.ts の embedImages) と同じ引き方で引く
 */
function svgMissingImages(src: string, bytes: Uint8Array, assets: AssetStore): Array<{ href: string; use: boolean }> {
  let out = svgMissingMemo.get(bytes);
  if (out) return out;
  out = [];
  // 重なりの確かめは Set で (配列の some だと、違う参照の数の 2 乗の手間になる)
  const seen = new Set<string>();
  const text = new TextDecoder().decode(bytes);
  // image の外の画像 (PNG・JPEG) と、use の外のファイル (file.svg#id の SVG)
  for (const m of text.matchAll(/<(?:[\w-]+:)?(image|use)\b[^>]*>/gi)) {
    const use = m[1].toLowerCase() === 'use';
    // 属性の文字参照は戻して引く (描く所と同じ名前。xmlAttr.ts)
    let href = hrefOfTag(m[0]);
    if (use) href = href.split('#')[0];
    if (!href || /^data:/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const a = assets.get(resolveRef(href, /^data:/i.test(src) ? undefined : src));
    // 中身を捨てた画像 (PDF に埋め込み済み。AssetStore.releaseImageBytes) は、読めた画像として扱う
    const read = !!a?.bytes || !!a?.released;
    if (use ? !read || a!.mime !== 'image/svg+xml' : !read || !['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'].includes(a!.mime)) out.push({ href, use });
  }
  svgMissingMemo.set(bytes, out);
  return out;
}
