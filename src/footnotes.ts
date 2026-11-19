/**
 * footnotes — 脚注 (fo:footnote) の番号付け・本体レイアウト結果の保持・行単位の分割。
 *
 * 配置規則 (layoutEngine の Flow が使う):
 *  - 脚注領域は本文領域の block 方向の末尾 (横書き=下端 / 縦書き=左端) に、区切り線 + 脚注本体の順で積む。
 *  - 参照を含む行は「行 + その脚注」が現ページに収まる場合だけ置く。収まらなければ参照行ごと次ページへ。
 *  - 脚注 1 つがページに収まらないほど長いときだけ、行単位で分割して続きを次ページの脚注領域の先頭へ回す。
 */
import type { FootnoteOptions, LFootnote } from './types';
import { newNode, type LNode } from './lnode';
import { circledNumber, formatPageNumber, kanjiNumber } from './pageNumber';

export interface FootEntry {
  /** 脚注本体 (isize = 本文領域の inline サイズ、bsize = height) */
  node: LNode;
  height: number;
  /** 前ページからの継続部分か */
  cont?: boolean;
  /** 本体の後ろに空ける量 (本体ブロックの space-after)。次の脚注との間隔になる。無ければ FootnoteOptions.spacing */
  after?: number;
}

/**
 * 脚注番号の書式 (FootnoteOptions.numberFormat)。字の表は pageNumber.ts と共有し、ここでは範囲だけを決める:
 * 丸数字は ①〜⑳ まで (21 以上は "(21)")、漢数字は 一〜十 まで (11 以上は 10 進数)。
 * もっと広い範囲 (㊿ まで・9999 まで) が要るときは FootnoteOptions.format (ページ番号と同じ書式トークン) を使う
 */
export function formatNumber(n: number, fmt: NonNullable<FootnoteOptions['numberFormat']>): string {
  switch (fmt) {
    case 'circled':
      return (n <= 20 ? circledNumber(n) : undefined) ?? `(${n})`;
    case 'kanji':
      return n >= 1 && n <= 10 ? kanjiNumber(n) : String(n);
    case 'asterisk':
      return '＊'.repeat(n);
    default:
      return String(n);
  }
}

/** 本体の中の footnote-citation を、その脚注のラベルに置き換える */
export function withLabel(children: unknown[], label: string): unknown[] {
  return children.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const o = c as { type?: string; children?: unknown[] };
    if (o.type === 'footnote-citation') return label;
    return Array.isArray(o.children) ? { ...o, children: withLabel(o.children, label) } : c;
  });
}

export class FootnoteCtx {
  readonly format: NonNullable<FootnoteOptions['numberFormat']>;
  readonly referenceScale: number;
  readonly spacing: number;
  /** 脚注の領域の高さの上限 (FootnoteOptions.maxHeight) */
  readonly maxHeight: number | undefined;
  readonly separator: { length?: number; pattern: 'rule' | 'dots'; thickness: number; color: string; spaceBefore: number; spaceAfter: number } | null;
  private numbers = new WeakMap<LFootnote, number>();
  /** 組んだ本体。脚注領域の幅 (本文領域の inline サイズ) ごとに覚える (幅の違うページマスターへ続いたときは、その幅で組み直す) */
  private entries = new Map<LFootnote, Map<number, FootEntry>>();
  private counter: number;
  /** ページごとに番号を振り直すとき: 前回の組版で、その脚注がページの中で何番目だったか (0 始まり) */
  pageOrder?: Map<LFootnote, number>;
  /** 脚注を置いたページを知らせる先 (次の組版で pageOrder を作る) */
  onPlaced?: (fn: LFootnote, page: number) => void;

  constructor(
    private opts: FootnoteOptions = {},
    private layoutBody: (fn: LFootnote, label: string, width?: number) => FootEntry,
    readonly layoutBlocks?: (children: NonNullable<Extract<NonNullable<FootnoteOptions['separator']>, object>['content']>) => FootEntry,
  ) {
    this.format = opts.numberFormat ?? 'decimal';
    this.referenceScale = opts.referenceScale ?? 0.7;
    this.spacing = opts.spacing ?? 2;
    this.counter = (opts.startNumber ?? 1) - 1;
    this.maxHeight = opts.maxHeight;
    const s = opts.separator;
    this.separator =
      s === false
        ? null
        : { length: s?.length, pattern: s?.pattern ?? 'rule', thickness: s?.thickness ?? 0.5, color: s?.color ?? '#000000', spaceBefore: s?.spaceBefore ?? 6, spaceAfter: s?.spaceAfter ?? 4 };
  }

  /** これまでに採番した最後の番号 (次の page-sequence が続きから振るとき) */
  get lastNumber(): number {
    return this.counter;
  }

  /** 参照記号に使うラベル (本体の見出しは markerLabel)。番号は文書順に 1 度だけ採番 (何度呼んでも同じ) */
  label(fn: LFootnote): string {
    if (fn.label !== undefined) return fn.label;
    return `${fn.callPrefix ?? this.opts.labelPrefix ?? ''}${this.numberText(fn)}${fn.callSuffix ?? this.opts.labelSuffix ?? ''}`;
  }

  /** 本体の見出しに使うラベル (FootnoteOptions.markerPrefix・markerSuffix。省略時は参照記号と同じ前後の文字) */
  markerLabel(fn: LFootnote): string {
    if (fn.label !== undefined) return fn.label;
    const pre = fn.markerPrefix ?? fn.callPrefix ?? this.opts.markerPrefix ?? this.opts.labelPrefix ?? '';
    const post = fn.markerSuffix ?? fn.callSuffix ?? this.opts.markerSuffix ?? this.opts.labelSuffix ?? '';
    return `${pre}${this.numberText(fn)}${post}`;
  }

  /** 番号の字 (前後の文字を付ける前)。番号は文書順に 1 度だけ採番 */
  private numberText(fn: LFootnote): string {
    let n = this.numbers.get(fn);
    if (n === undefined) {
      n = ++this.counter;
      // ページごとに振り直す: 前回の組版でのページの中の順番 (まだ分からなければ通し番号のまま。組み直しで確定する)
      const k = this.opts.reset === 'page' ? this.pageOrder?.get(fn) : undefined;
      if (k !== undefined) n = (this.opts.startNumber ?? 1) + k;
      this.numbers.set(fn, n);
    }
    const f = fn.numberFormat ?? this.opts.format;
    return f ? formatPageNumber(n, f) : formatNumber(n, this.format);
  }

  private claimed = new WeakSet<LFootnote>();
  /** 試し組みの間に積んだ脚注 (試し組みが終われば捨てる)。試し組みでなければ null */
  private trialClaimed: Set<LFootnote> | null = null;
  /**
   * 試し組み (段の釣り合わせなど、結果をページに残さない組版) を f で行う。その間に積んだ脚注は、終われば積んでいないものに戻し、
   * 置いたページも知らせない (本番の組版で、改めて積む)。本体の高さは本番と同じに数えるので、段に入る量は本番と変わらない
   */
  trial<T>(f: () => T): T {
    const saved = this.trialClaimed;
    this.trialClaimed = new Set(saved ?? []);
    try {
      return f();
    } finally {
      this.trialClaimed = saved;
    }
  }

  /** セル・コンテナの中の脚注: まだどのページにも積んでいなければ true (繰り返す表の見出しなどで二重に積まない) */
  claim(fn: LFootnote): boolean {
    if (this.claimed.has(fn) || this.trialClaimed?.has(fn)) return false;
    (this.trialClaimed ?? this.claimed).add(fn);
    return true;
  }

  /** まだどのページにも積んでいない脚注か (claim と違い、印は付けない) */
  unclaimed(fn: LFootnote): boolean {
    return !this.claimed.has(fn) && !this.trialClaimed?.has(fn);
  }

  /** 脚注を page に置いた (ページごとの番号の確定に使う) */
  placed(fn: LFootnote, page: number) {
    if (this.trialClaimed) return;
    this.onPlaced?.(fn, page);
  }

  /** 脚注本体 (組んだ結果は覚える)。width は脚注領域の幅 (省略時は最初のページの本文領域の幅) */
  entry(fn: LFootnote, width?: number): FootEntry {
    const key = width === undefined ? -1 : Math.round(width * 1000);
    let byWidth = this.entries.get(fn);
    if (!byWidth) this.entries.set(fn, (byWidth = new Map()));
    let e = byWidth.get(key);
    if (!e) {
      const label = this.markerLabel(fn);
      e = this.layoutBody({ ...fn, children: withLabel(fn.children, label) as LFootnote['children'] }, label, width);
      byWidth.set(key, e);
    }
    return e;
  }

  private sepEntry?: FootEntry;
  private get sepContent(): FootEntry | undefined {
    const c = typeof this.opts.separator === 'object' ? this.opts.separator.content : undefined;
    if (!c?.length || !this.layoutBlocks) return undefined;
    return (this.sepEntry ??= this.layoutBlocks(c));
  }

  /** 区切り以外の内容 (前方 float の区切りなど) を、脚注領域と同じ幅で組む */
  layoutBlocksPublic(children: Parameters<NonNullable<FootnoteCtx['layoutBlocks']>>[0]): FootEntry | undefined {
    return this.layoutBlocks?.(children);
  }

  /** 前の脚注 (無ければ区切り) と次の脚注との間隔 */
  gapAfter(prev: FootEntry | undefined): number {
    return prev ? (prev.after ?? this.spacing) : this.sepHeight;
  }

  get sepHeight(): number {
    if (this.sepContent) return this.sepContent.height;
    return this.separator ? this.separator.spaceBefore + this.separator.thickness + this.separator.spaceAfter : 0;
  }

  makeSeparator(wm: LNode['wm'], inlineSize: number): LNode | null {
    const s = this.separator;
    if (!s) return null;
    const sc = this.sepContent;
    if (sc) return { ...structuredClone(sc.node), i: 0, b: 0 };
    const isize = Math.min(s.length ?? inlineSize / 3, inlineSize);
    const node = newNode('block', wm, { i: 0, b: s.spaceBefore, isize, bsize: s.thickness, ...(s.pattern === 'rule' ? { bg: s.color } : {}) });
    // 点線: 幅 thickness の正方形の点を、thickness の 3 倍ピッチで並べる (欧文ピリオド・リーダ相当)。太さ 0 は描かない (ピッチ 0 で止まらなくなる)
    if (s.pattern === 'dots' && s.thickness > 0) {
      const d = s.thickness;
      const pitch = d * 3;
      for (let x = 0; x + d <= isize + 0.01; x += pitch) {
        node.children.push(newNode('block', wm, { i: x, b: 0, isize: d, bsize: d, bg: s.color }));
      }
    }
    return node;
  }
}

/**
 * 脚注を行単位で分割する。budget に収まる行を head、残りを rest にする。入れ子のブロックは中まで降りて、その中の行で分ける
 * (分けたブロックは、head 側の終端・rest 側の始端の罫線と余白を落とす)。
 * 先頭の 1 行は budget に収まらなくても head に入れる (前進を保証)。分けられなければ null。
 *
 * 手間は、head に置く分 (と、降りる入れ子の深さ) に比例する: rest は子を写さずに、元の子の並びと始まりの位置で持ち (SplitView)、
 * rest.node を読んだときに初めて箱にする。1 ページに 1 行ずつしか置けない長い脚注を、続くページへ何度も分けても、
 * 全体の手間は脚注の大きさに比例する (分けるたびに残りの子を全部写すと、行の数の 2 乗になった)
 */
export function splitEntry(e: FootEntry, budget: number): { head: FootEntry; rest: FootEntry } | null {
  const r = splitView(views.get(e) ?? viewOf(e.node), budget, true);
  if (!r) return null;
  return {
    head: { node: r.head, height: r.head.bsize },
    rest: restEntry(r.rest, e.after),
  };
}

/**
 * 脚注 (分けた残りを含む) の、それ以上分けられない単位 (行と、子の無い箱) の数。splitEntry は 1 回に少なくとも 1 つを head に置き、
 * head と rest で単位を分け合う (前進の保証) ので、1 つの脚注の続きのページの数は、白ページを除いて、これを超えない。
 * 手間は入れ子の深さほど (子の並びごとの数は覚えておく)
 */
export function footUnits(e: FootEntry): number {
  const v = views.get(e);
  return v ? viewUnits(v) : nodeUnits(e.node);
}

const EPS = 0.01;

/** 箱の block 方向の始端・終端の罫線 + 余白 */
function edges(n: LNode): { s: number; e: number; sSide: keyof LNode['padding']; eSide: keyof LNode['padding'] } {
  const sSide = n.wm === 'horizontal-tb' ? 'top' : n.wm === 'vertical-lr' ? 'left' : 'right';
  const eSide = n.wm === 'horizontal-tb' ? 'bottom' : n.wm === 'vertical-lr' ? 'right' : 'left';
  return { s: n.padding[sSide] + (n.border[sSide]?.width ?? 0), e: n.padding[eSide] + (n.border[eSide]?.width ?? 0), sSide, eSide };
}

/**
 * 分けた残りの箱 (または、まだ分けていない箱)。子の並びは写さずに持つ: 子は first (前に分けた子の残り。あれば先頭) と、
 * kids[start..] (位置は b - off)。kids は block 方向の位置の順に並べた子 (sortedKids。元の箱の子の配列そのものか、1 度だけ並べた写し)
 */
interface SplitView {
  /** 子を除く箱の値 (children は使わない。b は親の箱の中での位置) */
  tpl: LNode;
  first?: SplitView;
  kids: readonly LNode[];
  start: number;
  off: number;
  /** kids の子を置くとき、位置を直した写しにするか (分けた残りの子は写す。まだ分けていない箱の子は、そのまま置く) */
  copy: boolean;
}

/** 分けた残りの脚注の SplitView (rest.node を箱にしないまま、続けて分けるため) */
const views = new WeakMap<FootEntry, SplitView>();

/** 子の配列ごとに、block 方向の位置の順に並べた子と、i 番目から後ろの子の終わり (b + bsize) の最大 (1 度だけ求めて覚える) */
const sortedCache = new WeakMap<readonly LNode[], { kids: readonly LNode[]; sufEnd: Float64Array }>();
function sorted(children: readonly LNode[]): { kids: readonly LNode[]; sufEnd: Float64Array } {
  let c = sortedCache.get(children);
  if (!c) {
    // ふつうは並んでいる (行・ブロックを順に積む) ので写さない。並んでいなければ、1 度だけ並べる (安定な並べ替え。前と同じ順)
    let inOrder = true;
    for (let k = 1; k < children.length && inOrder; k++) if (children[k].b < children[k - 1].b) inOrder = false;
    const kids = inOrder ? children : [...children].sort((x, y) => x.b - y.b);
    const sufEnd = new Float64Array(kids.length + 1);
    sufEnd[kids.length] = -Infinity;
    for (let k = kids.length - 1; k >= 0; k--) sufEnd[k] = Math.max(sufEnd[k + 1], kids[k].b + kids[k].bsize);
    c = { kids, sufEnd };
    sortedCache.set(children, c);
    if (kids !== children) sortedCache.set(kids, c);
  }
  return c;
}

const viewOf = (n: LNode): SplitView => ({ tpl: n, kids: sorted(n.children).kids, start: 0, off: 0, copy: false });

const childCount = (v: SplitView) => (v.first ? 1 : 0) + v.kids.length - v.start;

/** SplitView を箱にする (子を写すのは、ここで 1 度だけ) */
function materialize(v: SplitView): LNode {
  const children: LNode[] = v.first ? [materialize(v.first)] : [];
  for (let k = v.start; k < v.kids.length; k++) children.push(v.copy ? { ...v.kids[k], b: v.kids[k].b - v.off } : v.kids[k]);
  return { ...v.tpl, children };
}

function restEntry(v: SplitView, after: number | undefined): FootEntry {
  let node: LNode | undefined;
  const e: FootEntry = {
    get node() {
      return (node ??= materialize(v));
    },
    set node(n: LNode) {
      node = n;
      views.delete(e);
    },
    height: v.tpl.bsize,
    cont: true,
    after,
  };
  views.set(e, v);
  return e;
}

/**
 * 単位の数は、子の並びごとに 1 度だけ数えて覚える (unitsCache・unitsSuffix。分けた残りの子は位置を直した写しだが、その子の並びは元のまま)。
 * 守り (ContinuationGuard) が、続きのページを足すたびに送る脚注の単位を数えても、ページごとの手間は脚注の大きさに比例しない
 */
const unitsCache = new WeakMap<readonly LNode[], number>();
function nodeUnits(n: LNode): number {
  if (n.kind === 'line' || !n.children?.length) return 1;
  let u = unitsCache.get(n.children);
  if (u === undefined) {
    u = 0;
    for (const c of n.children) u += nodeUnits(c);
    unitsCache.set(n.children, u);
  }
  return u;
}

/** 並べた子 kids の、i 番目から後ろの子の単位の数の和 */
const unitsSuffixCache = new WeakMap<readonly LNode[], Float64Array>();
function unitsSuffix(kids: readonly LNode[]): Float64Array {
  let a = unitsSuffixCache.get(kids);
  if (!a) {
    a = new Float64Array(kids.length + 1);
    for (let k = kids.length - 1; k >= 0; k--) a[k] = a[k + 1] + nodeUnits(kids[k]);
    unitsSuffixCache.set(kids, a);
  }
  return a;
}

function viewUnits(v: SplitView): number {
  if (v.tpl.kind === 'line' || !childCount(v)) return 1;
  return (v.first ? viewUnits(v.first) : 0) + unitsSuffix(v.kids)[v.start];
}

/** 箱 v を、始端から budget のところで 2 つに分ける。行は分けず、入れ子の箱は中で分ける */
function splitView(v: SplitView, budget: number, force: boolean): { head: LNode; rest: SplitView } | null {
  const ed = edges(v.tpl);
  const head: LNode[] = [];
  let headEnd = -Infinity;
  const push = (c: LNode) => {
    head.push(c);
    headEnd = Math.max(headEnd, c.b + c.bsize);
  };
  /** kids[k] を、この箱の中の位置にして返す */
  const kid = (k: number): LNode => (v.copy ? { ...v.kids[k], b: v.kids[k].b - v.off } : v.kids[k]);
  // 残り: restFirst (分けた子の残り、または置かなかった first) と kids[restStart..]
  let restFirst: SplitView | undefined;
  let restStart = v.kids.length;
  /** restFirst が kids[frontKid] を分けた残りなら、その番号 */
  let frontKid = -1;
  let k = v.start;
  if (v.first) {
    const f = v.first;
    const top = ed.s + f.tpl.b;
    if (top + f.tpl.bsize <= budget + EPS) push(materialize(f));
    else {
      const r = top >= budget - EPS || f.tpl.kind === 'line' || !childCount(f) ? null : splitView(f, budget - top, force);
      if (r) {
        push(r.head);
        restFirst = r.rest;
      } else restFirst = f;
      restStart = k;
      k = v.kids.length;
    }
  }
  for (; k < v.kids.length; k++) {
    const o = v.kids[k];
    const top = ed.s + (o.b - v.off);
    if (top + o.bsize <= budget + EPS) {
      push(kid(k));
      continue;
    }
    restStart = k;
    if (!(top >= budget - EPS || o.kind === 'line' || !o.children.length)) {
      const c = kid(k);
      const r = splitView(viewOf(c), budget - top, force && !head.length);
      if (r) {
        push(r.head);
        restFirst = r.rest;
        frontKid = k;
        restStart = k + 1;
      }
    }
    break;
  }
  // 先頭の行すら入らないときは、最初の子 (行・画像などの箱) を 1 つだけ head に入れる (前進を保証)
  if (!head.length && force) {
    if (restFirst) {
      push(materialize(restFirst));
      restFirst = undefined;
    } else if (restStart < v.kids.length) push(kid(restStart++));
  }
  if (!head.length || (!restFirst && restStart >= v.kids.length)) return null;
  // 残りの子は、先頭の子の位置を 0 にする (子は位置の順に並ぶので、先頭の子の位置が最小)
  // 残りの子の位置は、元の子の位置から、先頭の子の元の位置を 1 度だけ引いて求める (先頭の子は丸めずに 0。分けるたびに引き直した前の形と、
  // 位置は浮動小数点の丸めの差 (1e-13 ほど) まで同じ)
  const off = restFirst ? restFirst.tpl.b : v.kids[restStart].b - v.off;
  const first = restFirst && { ...restFirst, tpl: { ...restFirst.tpl, b: restFirst.tpl.b - off } };
  const restOff = restFirst ? (frontKid >= 0 ? v.kids[frontKid].b : v.off) : v.kids[restStart].b;
  const restEnd = Math.max(first ? first.tpl.b + first.tpl.bsize : -Infinity, sorted(v.kids).sufEnd[restStart] - restOff);
  const headNode: LNode = { ...v.tpl, children: head, bsize: ed.s + headEnd, padding: { ...v.tpl.padding, [ed.eSide]: 0 }, border: { ...v.tpl.border } };
  delete headNode.border[ed.eSide];
  const restTpl: LNode = { ...v.tpl, children: [], bsize: restEnd + ed.e, padding: { ...v.tpl.padding, [ed.sSide]: 0 }, border: { ...v.tpl.border }, cont: true };
  delete restTpl.border[ed.sSide];
  return { head: headNode, rest: { tpl: restTpl, first, kids: v.kids, start: restStart, off: restOff, copy: true } };
}
