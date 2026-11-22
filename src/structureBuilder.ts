/**
 * structureBuilder — 読み込み (HTML・XSL-FO) が、要素ごとにタグ付き PDF の構造の木 (structure.ts の StructNode) を作る共通の仕組み
 * (ISO 32000-1 §14.7・§14.8)。
 *
 * 要素の木の形 (親・文書の順) と、要素ごとの構造の型の決め方 (StructHost.describe) は、読み込みが渡す。ここでは:
 *  - 要素の中身の入る構造の節を、祖先から順に決める (st)。構造を作らない要素は、親の要素の構造の節のまま (透明)
 *  - 項目 (LI) の子は、その本文 (LBody) に入れる。飾り (Artifact) の中は、どれも飾り
 *  - 仕上げ (finish): 子を文書の順に並べ、TBody を補い、表のセルの headers を見出しのセルの番号にし、番号の無い入力の節に、
 *    いちばん近い祖先の番号を付ける (柱・マーカーの中は柱の飾り、脚注の区切り・前方 float の区切りの中は飾り)
 */
import type { ArtifactKind, StructNode } from './structure';
import type { LDocument, LFootnote, LRuby, LWarichu } from './types';
import { diag, type Diagnostic } from './diagnostics';
import { msg } from './messages';

/** 要素の構造の節の中身 (親・子は決める側で付ける)。elementId・headers は表のセルの見出しの引き当てに使う */
export interface StructDesc {
  node: Omit<StructNode, 'kids' | 'parent'>;
  /** 要素の id (表のセルなら、headers から引けるようにする) */
  elementId?: string;
  /** 表のセルの headers の id の並び */
  headers?: string[];
}

/** 読み込みが渡す、要素の木の形と、要素の構造の型の決め方 */
export interface StructHost<E> {
  /** 親の要素 (根元では undefined) */
  parent(e: E): E | undefined;
  /** 文書の順 (前順の番号。子を並べるのに使う) */
  order(e: E): number;
  /** 要素の構造: 構造の節の中身、'Artifact' (飾り)、undefined (構造を作らない。中身は親の構造に入る) */
  describe(e: E, parent: StructNode): StructDesc | 'Artifact' | undefined;
  /**
   * 項目 (LI) の子の要素を、項目の本文 (LBody) に入れるか (既定 true。HTML の li の中身)。false なら、子の要素が自分で記号・本文に
   * なる (XSL-FO の fo:list-item-label・fo:list-item-body)
   */
  liBody?: boolean;
}

const TABLE_CELLS = new Set(['TH', 'TD']);
/** 行のセルの数をそろえるために足す空のセルの、文書全体の数の上限の下限 (文書のセルの数がこれより少なくても、ここまでは足す) */
export const PAD_CELLS_MIN = 10000;

export class StructureBuilder<E extends object> {
  /** 構造の節の並び (0 番が文書) */
  readonly nodes: StructNode[] = [];
  /** 構造の節ごとの、文書の中の順 (子の並べ替えに使う) */
  readonly order: number[] = [];
  /** 要素 → その要素の中身の入る構造の節の番号 */
  private of = new Map<E, number>();
  /** LI の構造の節 → その Lbl・LBody の構造の節 */
  private liParts = new Map<number, { lbl?: number; lbody?: number }>();
  /** 飾り (Artifact) の構造の節 (種類ごとに 1 つ) */
  private artifacts: Partial<Record<ArtifactKind, number>> = {};
  /** 表のセルの要素の id → その構造の節の番号 (headers を引く) */
  private cellById = new Map<string, number>();
  /** 表のセルの構造の節 → headers の id の並び */
  private cellHeaders = new Map<number, string[]>();
  /** group で子を新しい節に移した親 (子の並びに、移った節が残っている。finish で外す) */
  private regrouped = new Set<number>();

  constructor(
    private host: StructHost<E>,
    root: E,
    doc: Omit<StructNode, 'kids' | 'parent' | 'role'>,
  ) {
    // 構造の木の根元 (文書。ISO 32000-1 §14.8.4.2 の Document)
    this.add({ role: 'Document', parent: -1, ...doc }, -1);
    this.of.set(root, 0);
  }

  /** 構造の節を足す (親の子の並びにも足す) */
  add(n: Omit<StructNode, 'kids'>, order: number): number {
    const id = this.nodes.length;
    this.nodes.push({ ...n, kids: [] });
    this.order.push(order);
    if (n.parent >= 0) this.nodes[n.parent].kids.push(id);
    return id;
  }

  /** 飾り (Artifact) の構造の節 (種類ごとに 1 つ) */
  artifact(kind: ArtifactKind): number {
    return (this.artifacts[kind] ??= this.add({ role: 'Artifact', parent: -1, artifact: kind }, -1));
  }

  /** 項目 (LI) の構造の節の、記号 (Lbl) か本文 (LBody) の構造の節 (無ければ作る。記号・本文の順で、項目の中の要素より前) */
  liPart(li: number, part: 'lbl' | 'lbody'): number {
    let p = this.liParts.get(li);
    if (!p) this.liParts.set(li, (p = {}));
    return (p[part] ??= this.add({ role: part === 'lbl' ? 'Lbl' : 'LBody', parent: li }, this.order[li] + (part === 'lbl' ? 0.25 : 0.5)));
  }

  /** 要素の中身の入る構造の節の番号 (構造を作らない要素は、親の要素の番号。項目 (LI) の中の要素は、その LBody) */
  st(el: E | undefined): number {
    if (!el) return 0;
    // 番号の決まった祖先まで上り、そこから下りながら決める (要素の入れ子の深さだけの再帰にしない)
    const chain: E[] = [];
    let e: E | undefined = el;
    let up = 0;
    while (e) {
      const memo = this.of.get(e);
      if (memo !== undefined) {
        up = memo;
        break;
      }
      chain.push(e);
      e = this.host.parent(e);
    }
    for (let k = chain.length - 1; k >= 0; k--) {
      const x = chain[k];
      let id = up;
      // 項目 (LI) の子は、その本文 (LBody) に入る
      if (this.nodes[up].role === 'LI' && this.host.liBody !== false) id = this.liPart(up, 'lbody');
      // 飾りの中は、どれも飾り
      if (this.nodes[up].role !== 'Artifact') {
        const d = this.host.describe(x, this.nodes[id]);
        if (d === 'Artifact') id = this.artifact('layout');
        else if (d) {
          id = this.add({ ...d.node, parent: id }, this.host.order(x));
          // 割注 (ISO 32000-1 §14.8.4.4 の Table 338: Warichu の子は、中身の WT と、前後の括弧の WP): 要素の中身は WT に入れる。
          // 括弧の WP は、読み込みが warichuParts で足す
          if (d.node.role === 'Warichu') id = this.add({ role: 'WT', parent: id }, this.host.order(x) + 2e-4);
          if (TABLE_CELLS.has(d.node.role)) {
            if (d.elementId && !this.cellById.has(d.elementId)) this.cellById.set(d.elementId, id);
            if (d.headers?.length) this.cellHeaders.set(id, d.headers);
          }
        }
      }
      this.of.set(x, id);
      up = id;
    }
    return up;
  }

  /**
   * ルビ (ISO 32000-1 §14.8.4.3.5 の Ruby・RB・RT): 親 parent の子に Ruby を作り、親文字を RB、ルビを RT にする (LRuby.tagParts)。
   * 圏点 (emphasis) は、親文字を親の構造の字のまま、点を飾り (Artifact) にする
   */
  ruby(r: LRuby, parent: number, order: number, emphasis = false) {
    // 飾り (aria-hidden の中など) のルビは、親文字もルビも飾りのまま (構造の木に入らない Ruby の節を作らない)
    if (this.nodes[parent]?.role === 'Artifact') {
      r.tag = parent;
      r.tagParts = { base: { type: 'inline', tag: parent, children: [] }, text: { type: 'inline', tag: parent, children: [] } };
      return;
    }
    if (emphasis) {
      r.tag = parent;
      r.tagParts = { base: { type: 'inline', tag: parent, children: [] }, text: { type: 'inline', tag: this.artifact('layout'), children: [] } };
      return;
    }
    const ruby = this.add({ role: 'Ruby', parent }, order);
    const rb = this.add({ role: 'RB', parent: ruby }, order + 1e-4);
    const rt = this.add({ role: 'RT', parent: ruby }, order + 2e-4);
    r.tag = ruby;
    r.tagParts = { base: { type: 'inline', tag: rb, children: [] }, text: { type: 'inline', tag: rt, children: [] } };
  }

  /**
   * 割注の前後の括弧の構造 (WP。ISO 32000-1 §14.8.4.4 の Table 338): 要素 el (構造の型が Warichu の要素。中身は WT に入る) の Warichu の子に、
   * 中身 (WT) の前と後ろの WP を作り、括弧の字に付ける中身の無い入力の節を返す (LWarichu.tagParts)。括弧の無い側は作らない
   */
  warichuParts(el: E, brackets: { open: string; close: string }): LWarichu['tagParts'] | undefined {
    const st = this.nodes;
    const wt = this.st(el);
    const w = st[wt]?.parent;
    if (st[wt]?.role !== 'WT' || w === undefined || w < 0 || st[w].role !== 'Warichu') return undefined;
    const o = this.order[w];
    const part = (d: number) => ({ type: 'inline' as const, tag: this.add({ role: 'WP', parent: w }, o + d), children: [] });
    return { ...(brackets.open ? { open: part(1e-4) } : {}), ...(brackets.close ? { close: part(3e-4) } : {}) };
  }

  /**
   * 構造の節の並び ids (同じ親の子) を、新しい構造の節 (型 role) に入れる。要素の無い行 (XSL-FO の、fo:table-row を書かずに starts-row・
   * ends-row で分けたセルの並び) の TR を作る。新しい節の番号を返す
   */
  group(role: string, ids: number[]): number | undefined {
    const st = this.nodes;
    const parent = st[ids[0]]?.parent;
    if (parent === undefined || parent < 0 || ids.some((k) => st[k].parent !== parent)) return undefined;
    let first = Infinity;
    for (const k of ids) first = Math.min(first, this.order[k]);
    const id = this.add({ role, parent }, first - 0.01);
    // 入れた節を親の子の並びから外すのは、仕上げ (finish) で 1 度だけ (行を作るたびに親の子の並びを作り直すと、
    // fo:table-row を書かずに ends-row で分けた表で、行の数の 2 乗の手間になっていた)
    this.regrouped.add(parent);
    for (const k of ids) st[k].parent = id;
    st[id].kids = [...ids];
    return id;
  }

  /** 入力の節に、要素の構造の節の番号を付ける (付いていなければ) */
  tag<T>(node: T, el: E): T {
    if (node && typeof node === 'object' && (node as { tag?: number }).tag === undefined) (node as { tag?: number }).tag = this.st(el);
    return node;
  }

  /**
   * 脚注の構造 (ISO 32000-1 §14.8.4.4.1 の Note・Reference・Lbl、ISO 14289-1 §7.9): 本文の参照の印は、本文の構造の中の参照 (Reference)、
   * 脚注の本体は、その後ろに置く注 (Note。ID を持つ) で、組版が付ける頭の番号 (withLabel のとき) は注の記号 (Lbl)。読む順は参照の印の所
   * (本体はページの下に描くが、構造の木では参照の後ろ。StructNode.anchor)。note は脚注の本体の構造の節 (Note でなければ何もしない)
   */
  footnote(fn: LFootnote, note: number, withLabel: boolean) {
    const st = this.nodes;
    if (st[note]?.role !== 'Note') return;
    const ref = this.add({ role: 'Reference', parent: st[note].parent }, this.order[note] - 0.5);
    st[note].anchor = ref;
    const call = { type: 'inline' as const, tag: ref, children: [] };
    const lbl = withLabel ? this.add({ role: 'Lbl', parent: note }, this.order[note] + 0.25) : undefined;
    fn.tagParts = { call, label: { type: 'inline', tag: lbl ?? note, children: [] } };
  }

  /**
   * 表 t の行 (行のまとまりごと) のセルの数 (列をまたぐ数・前の行からまたぐセルを数えて) をそろえる。足す空のセルの数が、残りの予算 (padBudget) を
   * 超える表は、行ごとに空のセルを 1 つだけ足し、その列をまたぐ数 (ColSpan。§14.8.5.7 の Table 349) で列の数をそろえる (false を返す)。行の幅は、前の行からまたいでくるセルの列の範囲で数える (列の数でなくセルの数に比例する。
   * 列をまたぐ数の大きなセルを 1 行に多く並べた表で、行ごとに列の数だけ数えていた)
   */
  private padRows(t: number): boolean {
    const st = this.nodes;
    const groups: number[][] = [];
    const loose: number[] = [];
    for (const k of st[t].kids) {
      const r = st[k].role;
      if (r === 'TR') loose.push(k);
      else if (r === 'THead' || r === 'TBody' || r === 'TFoot') groups.push(st[k].kids.filter((x) => st[x].role === 'TR'));
    }
    if (loose.length) groups.push(loose);
    const widths: Array<[number, number]> = [];
    for (const rows of groups) {
      // 前の行からまたいでくるセルの列の範囲 [start, end) と、残りの行の数 (始まりの列の順)
      let active: Array<{ start: number; end: number; left: number }> = [];
      for (const tr of rows) {
        let col = 0;
        let w = 0;
        // 列 col が、前の行からまたいでくるセルに覆われていれば、その終わりまで進める (active は始まりの順なので、前から 1 度だけたどる)
        let i = 0;
        let reach = 0;
        const skipBusy = () => {
          for (;;) {
            while (i < active.length && active[i].start <= col) reach = Math.max(reach, active[i++].end);
            if (reach > col) col = reach;
            else return;
          }
        };
        const next: typeof active = [];
        for (const c of st[tr].kids) {
          if (!TABLE_CELLS.has(st[c].role)) continue;
          skipBusy();
          const cs = Math.max(st[c].colSpan ?? 1, 1);
          const rs = Math.max(st[c].rowSpan ?? 1, 1);
          if (rs > 1) next.push({ start: col, end: col + cs, left: rs - 1 });
          col += cs;
          w = Math.max(w, col);
        }
        for (const a of active) {
          w = Math.max(w, a.end);
          if (a.left > 1) next.push({ ...a, left: a.left - 1 });
        }
        widths.push([tr, w]);
        active = next.sort((a, b) => a.start - b.start);
      }
    }
    let max = 0;
    for (const [, w] of widths) max = Math.max(max, w);
    let need = 0;
    for (const [, w] of widths) need += max - w;
    if (need > this.padBudget) {
      for (const [tr, w] of widths) if (w < max) this.add({ role: 'TD', parent: tr, colSpan: max - w }, Infinity);
      return false;
    }
    this.padBudget -= need;
    for (const [tr, w] of widths) for (let k = w; k < max; k++) this.add({ role: 'TD', parent: tr }, Infinity);
    return true;
  }

  /** 行のセルの数をそろえるために足す空のセル (TD) の、文書全体の残りの数 (finish で、文書のセルの数か PAD_CELLS_MIN の大きい方にする) */
  private padBudget = 0;
  /** 足す空のセルが予算を超えたので、空のセルを行ごとに 1 つにまとめた表の数 (limitDiagnostics) */
  unpaddedTables = 0;

  /** 構造の木を作るときに上限に当たったことの診断 (finish の後に、読み込みが ImportReport.diagnostics に入れる) */
  limitDiagnostics(): Diagnostic[] {
    if (!this.unpaddedTables) return [];
    const n = this.unpaddedTables;
    return [
      diag(
        'limit/table-structure-cells',
        msg(
          `タグ付き PDF の表の構造で、行のセルの数をそろえる空のセルが上限を超えたので、${n} 個の表は空のセルを行ごとに 1 つにまとめ、列をまたぐ数で列の数をそろえます (列をまたぐ数の大きなセル)`,
          `in the tagged PDF table structure, the empty cells that even out the rows exceed the limit, so in ${n} table(s) each row gets a single empty cell that spans the missing columns (cells with large column spans)`,
        ),
        { tables: n },
      ),
    ];
  }

  /**
   * 構造の木を仕上げる: 子を入力の順に並べ、番号の無い入力の節に、いちばん近い祖先の番号を付ける。柱 (staticContent。余白の箱・
   * running()・position: fixed の箱・fo:static-content)・マーカー (柱に取り出すもの) の中は、柱の飾り (Artifact の Pagination。
   * ISO 32000-1 §14.8.2.2) にする。脚注の区切りの内容と前方 float の区切りは、飾り (Layout)
   */
  finish(doc: LDocument): StructNode[] {
    const st = this.nodes;
    for (const p of this.regrouped) st[p].kids = st[p].kids.filter((k) => st[k].parent === p);
    for (const n of st) if (n.kids.length > 1) n.kids.sort((a, b) => this.order[a] - this.order[b]);
    // 表の見出し・脚 (THead・TFoot) のある表の、行のまとまりに入っていない行 (tbody を書かない表。HTML の構文解析は tbody を補うが、
    // 読み込みの構文解析は補わない) は、TBody に入れる (ISO 32000-1 §14.8.4.3.4: THead・TFoot を持つ表の本体の行は TBody の中)
    for (let t = 0; t < st.length; t++) {
      const table = st[t];
      if (table.role !== 'Table' || !table.kids.some((k) => st[k].role === 'THead' || st[k].role === 'TFoot')) continue;
      const loose = table.kids.filter((k) => st[k].role === 'TR');
      if (!loose.length) continue;
      const body = st.length;
      st.push({ role: 'TBody', parent: t, kids: loose });
      this.order.push(this.order[loose[0]]);
      for (const k of loose) st[k].parent = body;
      const at = table.kids.indexOf(loose[0]);
      table.kids = table.kids.filter((k) => st[k].role !== 'TR');
      table.kids.splice(at, 0, body);
    }
    // 行ごとのセルの数をそろえる: セルの足りない行 (HTML の、行の終わりのセルを書かない表・XSL-FO の、行の途中で終わる表) の終わりに、
    // 中身の無い TD を足す (ISO 14289-1 §7.5: 表の構造は、行と列の並びが分かるように書く。veraPDF の 7.2-43)
    // 足す空のセルの合計は、文書のセルの数か PAD_CELLS_MIN の大きい方まで (列をまたぐ数の大きなセルが 1 つあるだけで、ほかのすべての行に
    // 空のセルが列の数だけ足され、小さな文書から大きな構造の木と PDF ができていた)。超える表は、行ごとに列をまたぐ空のセルを 1 つ足し、
    // 読み込みが診断に出す
    let cells = 0;
    for (const x of st) if (TABLE_CELLS.has(x.role)) cells++;
    this.padBudget = Math.max(cells, PAD_CELLS_MIN);
    for (let t = 0, n = st.length; t < n; t++) if (st[t].role === 'Table' && !this.padRows(t)) this.unpaddedTables++;
    // 表のセルの見出しのセル (HTML §4.9.11 の headers): id の指すセルの構造の節。指されたセルには ID を付ける (§14.8.5.7 の Headers は ID の並び)
    for (const [cell, list] of this.cellHeaders) {
      const hs: number[] = [];
      for (const v of list) {
        const h = this.cellById.get(v);
        if (h === undefined || h === cell) continue;
        hs.push(h);
        st[h].sid ??= v;
      }
      if (hs.length) st[cell].headers = hs;
    }
    const pagination = this.artifact('pagination');
    const layout = this.artifact('layout');
    const seen = new Set<object>();
    const stack: Array<[unknown, number, number | undefined]> = [[doc, 0, undefined]];
    while (stack.length) {
      const [v, up, force] = stack.pop()!;
      if (!v || typeof v !== 'object' || seen.has(v)) continue;
      seen.add(v);
      if (Array.isArray(v)) {
        for (let k = v.length - 1; k >= 0; k--) stack.push([v[k], up, force]);
        continue;
      }
      const o = v as { type?: unknown; tag?: number };
      let cur = up;
      let f = force;
      if (typeof o.type === 'string') {
        if (o.type === 'marker') f = pagination;
        // 柱の箱に、上・下の柱 (Header・Footer) の印を付けてあれば、中はその印
        else if (f === pagination && o.tag !== undefined && (st[o.tag]?.artifact === 'header' || st[o.tag]?.artifact === 'footer')) f = o.tag;
        if (f !== undefined) o.tag = f;
        else if (o.tag === undefined) o.tag = up;
        cur = o.tag;
      }
      for (const [k, x] of Object.entries(v)) {
        if (k === 'structure' || !x || typeof x !== 'object') continue;
        stack.push([x, cur, k === 'staticContent' ? pagination : k === 'separator' || k === 'beforeFloatSeparator' ? (f ?? layout) : f]);
      }
    }
    return st;
  }
}
