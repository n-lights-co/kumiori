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

  /** 参照記号・本体の見出しに使うラベル。番号は文書順に 1 度だけ採番 (何度呼んでも同じ) */
  label(fn: LFootnote): string {
    if (fn.label !== undefined) return fn.label;
    let n = this.numbers.get(fn);
    if (n === undefined) {
      n = ++this.counter;
      // ページごとに振り直す: 前回の組版でのページの中の順番 (まだ分からなければ通し番号のまま。組み直しで確定する)
      const k = this.opts.reset === 'page' ? this.pageOrder?.get(fn) : undefined;
      if (k !== undefined) n = (this.opts.startNumber ?? 1) + k;
      this.numbers.set(fn, n);
    }
    const body = this.opts.format ? formatPageNumber(n, this.opts.format) : formatNumber(n, this.format);
    return `${this.opts.labelPrefix ?? ''}${body}${this.opts.labelSuffix ?? ''}`;
  }

  private claimed = new WeakSet<LFootnote>();
  /** セル・コンテナの中の脚注: まだどのページにも積んでいなければ true (繰り返す表の見出しなどで二重に積まない) */
  claim(fn: LFootnote): boolean {
    if (this.claimed.has(fn)) return false;
    this.claimed.add(fn);
    return true;
  }

  /** まだどのページにも積んでいない脚注か (claim と違い、印は付けない) */
  unclaimed(fn: LFootnote): boolean {
    return !this.claimed.has(fn);
  }

  /** 脚注を page に置いた (ページごとの番号の確定に使う) */
  placed(fn: LFootnote, page: number) {
    this.onPlaced?.(fn, page);
  }

  /** 脚注本体 (組んだ結果は覚える)。width は脚注領域の幅 (省略時は最初のページの本文領域の幅) */
  entry(fn: LFootnote, width?: number): FootEntry {
    const key = width === undefined ? -1 : Math.round(width * 1000);
    let byWidth = this.entries.get(fn);
    if (!byWidth) this.entries.set(fn, (byWidth = new Map()));
    let e = byWidth.get(key);
    if (!e) {
      const label = this.label(fn);
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
 */
export function splitEntry(e: FootEntry, budget: number): { head: FootEntry; rest: FootEntry } | null {
  const r = splitTree(e.node, budget, true);
  if (!r) return null;
  return {
    head: { node: r.head, height: r.head.bsize },
    rest: { node: r.rest, height: r.rest.bsize, cont: true, after: e.after },
  };
}

const EPS = 0.01;

/** 箱の block 方向の始端・終端の罫線 + 余白 */
function edges(n: LNode): { s: number; e: number; sSide: keyof LNode['padding']; eSide: keyof LNode['padding'] } {
  const sSide = n.wm === 'horizontal-tb' ? 'top' : n.wm === 'vertical-lr' ? 'left' : 'right';
  const eSide = n.wm === 'horizontal-tb' ? 'bottom' : n.wm === 'vertical-lr' ? 'right' : 'left';
  return { s: n.padding[sSide] + (n.border[sSide]?.width ?? 0), e: n.padding[eSide] + (n.border[eSide]?.width ?? 0), sSide, eSide };
}

/** 箱 n を、始端から budget のところで 2 つに分ける。行は分けず、入れ子の箱は中で分ける */
function splitTree(n: LNode, budget: number, force: boolean): { head: LNode; rest: LNode } | null {
  const ed = edges(n);
  const kids = [...n.children].sort((x, y) => x.b - y.b);
  const head: LNode[] = [];
  const rest: LNode[] = [];
  for (const c of kids) {
    if (rest.length) {
      rest.push(c);
      continue;
    }
    const top = ed.s + c.b;
    const bottom = top + c.bsize;
    if (bottom <= budget + EPS) head.push(c);
    else if (top >= budget - EPS || c.kind === 'line' || !c.children.length) rest.push(c);
    else {
      const r = splitTree(c, budget - top, force && !head.length);
      if (r) {
        head.push(r.head);
        rest.push(r.rest);
      } else rest.push(c);
    }
  }
  // 先頭の行すら入らないときは、最初の子 (行・画像などの箱) を 1 つだけ head に入れる (前進を保証)
  if (!head.length && force && rest.length) head.push(rest.shift()!);
  if (!head.length || !rest.length) return null;
  const headEnd = Math.max(...head.map((c) => c.b + c.bsize));
  const off = Math.min(...rest.map((c) => c.b));
  const restKids = rest.map((c) => ({ ...c, b: c.b - off }));
  const restEnd = Math.max(...restKids.map((c) => c.b + c.bsize));
  const headNode: LNode = { ...n, children: head, bsize: ed.s + headEnd, padding: { ...n.padding, [ed.eSide]: 0 }, border: { ...n.border } };
  delete headNode.border[ed.eSide];
  const restNode: LNode = { ...n, children: restKids, bsize: restEnd + ed.e, padding: { ...n.padding, [ed.sSide]: 0 }, border: { ...n.border }, cont: true };
  delete restNode.border[ed.sSide];
  return { head: headNode, rest: restNode };
}
