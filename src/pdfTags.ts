/**
 * pdfTags — タグ付き PDF の印と構造の木を書く (ISO 32000-1 §14.6・§14.7・§14.8)。
 *
 * 描く途中 (PdfPainter) は、描く物の印 (paint.ts の PaintTag) から、内容の流れに印の付いた内容を書く:
 *  - 中身: `/<構造の型> <</MCID n>> BDC … EMC` (§14.7.4.2。n はページごとに 0 から)。どの MCID が、どの構造の節のものかを覚える
 *  - 飾り: `/Artifact <</Type /Layout>> BDC … EMC` (§14.8.2.2。柱・繰り返した表の見出しは Type /Pagination)。構造の木に入れない
 * 書き終えたら (finish)、構造の節ごとに StructElem を作り (§14.7.2)、ページの StructParents と ParentTree (§14.7.4.4)、
 * リンクの注釈の StructParent と OBJR (§14.7.4.3)、表のセルの属性 (§14.8.5.7)、ID と IDTree (§14.7.2)、カタログの MarkInfo・Lang・
 * StructTreeRoot を書く。
 *
 * 構造の木の順は、入力の順 (structure.ts)。構造の節の中身の項目 (MCID・注釈) は、描いた順に、子の構造の節の間に入れる
 * (子の構造の節は、その中で最初に描いた項目の位置に置く。目印 (StructNode.anchor) のある節は、目印の節の最初の項目の後ろ)。
 */
import { PDFDict, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFString, type PDFDocument, type PDFRef } from 'pdf-lib';
import type { PaintTag } from './paint';
import { artifactOf, type AreaStructure, type ArtifactKind } from './structure';

/** 印 (描く物ごと): 構造の節の番号 (id) か、飾りの種類 (art) */
export type PdfTag = { readonly id: number; readonly art?: undefined } | { readonly art: ArtifactKind; readonly id?: undefined };

const LAYOUT: PdfTag = { art: 'layout' };
/** リンクの注釈の後に、Link の字を探す範囲 (描いた順の番号の数) */
const LINK_LOOKAHEAD = 16;
/**
 * リンクの注釈の代わりの説明 (Contents) の長さの上限 (UTF-16 の単位)。1 つのリンクが行・ページをまたぐと、注釈は行ごとにでき、
 * どの注釈にもリンクの字の全文を書いていたので、長いリンクで PDF とメモリが「行の数 × 字の数」に膨らみ、PDF/A の文字列の長さの上限
 * (ISO 19005-2 §6.1.13 の 32,767 バイト) も超えていた
 */
export const LINK_DESCRIPTION_MAX = 2000;
const PAGINATION: PdfTag = { art: 'pagination' };
const HEADER: PdfTag = { art: 'header' };
const FOOTER: PdfTag = { art: 'footer' };

/** 構造の節の中身の項目: MCID (ページ page の mcid) か、注釈 (annot) */
interface Item {
  seq: number;
  page: number;
  mcid?: number;
  annot?: PDFRef;
  /** 注釈の構造の型 (リンクは Link、ほかの注釈は Annot。ISO 32000-1 §14.8.4.4.2) */
  annotRole?: 'Link' | 'Annot' | 'Form';
  /** 注釈の構造の節の代わりの説明 (Alt。注釈に Contents の無いとき) */
  annotAlt?: string;
  /** MCID が、ページの内容の流れでなく、Form XObject (不透明度のグループ。forms の番号) の中のもの */
  form?: number;
}

/** 中に印の付いた内容を持つ Form XObject: 置いたページ、MCID の順の構造の節の番号、Form の参照 (作り終えたら) */
interface FormStream {
  page: number;
  parents: number[];
  ref?: PDFRef;
}

export class PdfTagger {
  /** 構造の節ごとの中身の項目 */
  private items: Item[][];
  /** ページごとの、MCID の順の構造の節の番号 */
  private pageParents: number[][] = [];
  private pageRefs: PDFRef[] = [];
  /** 描いた順の番号 (構造の節の中身の項目と子の並びを決める) */
  private seq = 0;
  /** 描いた順の番号 → その MCID の構造の節 (注釈の番号は -1) */
  private seqOwner: number[] = [];
  /** 構造の節ごとの、いちばん近い Link の構造の節 (自分か祖先。無ければ -1) */
  private linkOf: Int32Array;
  /** Link の構造の節の字 (注釈の Contents に使う。LINK_DESCRIPTION_MAX を超えた分は集めない) */
  private linkText = new Map<number, string>();
  /** Link の構造の節ごとの、作った代わりの説明と、そのときの字の長さ (字が増えていなければ使い回す) */
  private linkDesc = new Map<number, { raw: number; desc: string }>();
  /** 代わりの説明を長さの上限で切った Link の構造の節 */
  private cutLinks = new Set<number>();
  private memo = new Map<number, PdfTag>();
  /** 中に印の付いた内容を持つ Form XObject と、いま描いている Form の並び (入れ子) */
  private forms: FormStream[] = [];
  private formStack: number[] = [];
  /** 構造の木に入れた注釈 */
  private annots = new Set<PDFRef>();

  constructor(
    private pdf: PDFDocument,
    private s: AreaStructure,
  ) {
    this.items = s.nodes.map(() => []);
    this.linkOf = new Int32Array(s.nodes.length).fill(-1);
    // 根元から順に (親の番号は子より小さいとは限らないので、木をたどる)
    const stack = [0];
    while (stack.length) {
      const id = stack.pop()!;
      const n = s.nodes[id];
      if (!n) continue;
      this.linkOf[id] = n.role === 'Link' ? id : n.parent >= 0 ? this.linkOf[n.parent] : -1;
      for (const k of n.kids) stack.push(k);
    }
  }

  /** 描く物の印を、構造の節か飾りにする。中身の入力の節に構造の節が無ければ、文書 (0 番) の中身 */
  resolve(t: PaintTag): PdfTag {
    if (t === 'decor') return LAYOUT;
    if (t.pagination) return PAGINATION;
    const raw = t.ref === undefined ? -1 : (this.s.tags[t.ref] ?? -1);
    const id = raw >= 0 && raw < this.s.nodes.length ? raw : 0;
    let tag = this.memo.get(id);
    if (!tag) {
      const art = artifactOf(this.s, id);
      tag = art === 'pagination' ? PAGINATION : art === 'header' ? HEADER : art === 'footer' ? FOOTER : art ? LAYOUT : { id };
      this.memo.set(id, tag);
    }
    return tag;
  }

  /** ページ (0 始まり) を足す */
  addPage(index: number, ref: PDFRef) {
    this.pageRefs[index] = ref;
    this.pageParents[index] = [];
  }

  /** 印の付いた内容の始まり (BDC) の命令。中身なら MCID を振って覚える */
  begin(t: PdfTag, page: number, actualText?: string): PDFOperator {
    const ctx = this.pdf.context;
    // ページの上・下の柱は、Pagination の Subtype Header・Footer (§14.8.2.2.2 の Table 330)
    if (t.art) return PDFOperator.of('BDC' as never, [PDFName.of('Artifact'), ctx.obj(t.art === 'layout' ? { Type: 'Layout' } : { Type: 'Pagination', ...(t.art === 'header' ? { Subtype: 'Header' } : t.art === 'footer' ? { Subtype: 'Footer' } : {}) })] as never);
    // Form XObject の中なら、MCID は Form ごとに 0 から (§14.7.4.2: Form の中の MCID は、Form の StructParents の並びで引く)
    const form = this.formStack.length ? this.formStack[this.formStack.length - 1] : undefined;
    const list = form !== undefined ? this.forms[form].parents : this.pageParents[page];
    const mcid = list.length;
    list.push(t.id);
    this.seqOwner.push(t.id);
    this.items[t.id].push({ seq: this.seq++, page, mcid, ...(form !== undefined ? { form } : {}) });
    // actualText: 置き換えの文字列 (ISO 32000-1 §14.9.4。印の付いた内容の辞書の ActualText。分綴のハイフンのソフトハイフンなど)
    return PDFOperator.of('BDC' as never, [PDFName.of(nameBytes(this.s.nodes[t.id].custom ?? this.s.nodes[t.id].role)), ctx.obj({ MCID: mcid, ...(actualText !== undefined ? { ActualText: PDFHexString.fromText(actualText) } : {}) })] as never);
  }

  /** Form XObject (不透明度のグループ) を描き始める。この後の印の付いた内容は、その Form の中のもの */
  pushForm(page: number): number {
    const k = this.forms.length;
    this.forms.push({ page, parents: [] });
    this.formStack.push(k);
    return k;
  }

  /** Form XObject を描き終えた (ref は作った Form。中身が無くて作らなかったら undefined) */
  popForm(k: number, ref: PDFRef | undefined) {
    this.formStack.pop();
    this.forms[k].ref = ref;
  }

  /** 字を描いた (Link の中の字を、注釈の代わりの説明のために集める) */
  text(t: PdfTag, text: string) {
    if (t.id === undefined) return;
    const l = this.linkOf[t.id];
    if (l < 0) return;
    const prev = this.linkText.get(l) ?? '';
    // 空白をまとめながら (説明と同じく、続いた空白を 1 つに)、上限の少し先 (前後の空白を除いても上限を超える長さ) まで集める。
    // 空白をまとめる前の長さで止めると、空白の多いリンクで、まとめた後は上限に届かないのに後ろの字が落ち、切ったことも数えなかった
    if (prev.length >= LINK_DESCRIPTION_MAX + 2) return;
    let add = text.replace(/\s+/g, ' ');
    if (add.startsWith(' ') && (prev.endsWith(' ') || !prev)) add = add.slice(1);
    if (add) this.linkText.set(l, (prev + add).slice(0, LINK_DESCRIPTION_MAX + 2));
  }

  /** 注釈を描いた所の順の番号 (注釈を、その順で構造の節の中身に入れる) */
  nextSeq(): number {
    this.seqOwner.push(-1);
    return this.seq++;
  }

  /** 構造の節の、読む順の置き場所 (描いた順の番号。place で付けたもの。いちばん先のもの) */
  private places = new Map<number, number>();

  /**
   * 構造の節 id を、親の中身の項目の間の、いまの所に置く (行の中の、絶対配置の箱を書いた所の目印。箱の中身は後で描くので、
   * 中身の最初の項目の所ではなく、ここを使う。finish の place)
   */
  place(id: number) {
    if (!this.places.has(id)) this.places.set(id, this.nextSeq());
  }

  /**
   * リンクの注釈 (§12.5.6.5) を、構造の木に入れる: 印 t の構造の節の Link (無ければ、その節の子に Link を作る) の中身に OBJR を足し、
   * 注釈に、代わりの説明 (Contents。§14.9.3) を付ける (ParentTree の鍵 StructParent は finish で付ける)。説明は、Link の代わりの文、
   * リンクの字、どちらも無ければ fallback (飛び先の URI など。柱の中のリンクの字は飾りなので、構造の字として集めない)
   */
  linkAnnotation(t: PdfTag | undefined, seq: number, page: number, ref: PDFRef, dict: Record<string, unknown>, fallback?: string) {
    const id = t?.id ?? 0;
    let l = this.linkOf[id];
    // 注釈を置いた箱が、リンクの要素の外の構造の節 (リンクの字を含む行・段落など) のものなら、注釈の後に最初に描いた字の Link にする
    // (paint.ts は、注釈の箱を開いた直後に、その中の字を描く)
    for (let k = seq + 1; l < 0 && k < Math.min(this.seqOwner.length, seq + LINK_LOOKAHEAD); k++) {
      const o = this.seqOwner[k];
      if (o >= 0) {
        l = this.linkOf[o];
        break;
      }
    }
    const node = l >= 0 ? l : id;
    // 説明は Link の構造の節ごとに作って覚え、字が増えたときだけ作り直す (行ごとの注釈で、毎回字の全文の空白をまとめ直していた)
    const raw = this.s.nodes[node]?.alt ?? this.linkText.get(node) ?? '';
    let memo = this.linkDesc.get(node);
    if (!memo || memo.raw !== raw.length) {
      const own = this.clip(node, raw.replace(/\s+/g, ' ').trim());
      this.linkDesc.set(node, (memo = { raw: raw.length, desc: own }));
    }
    const desc = memo.desc || this.clip(node, (fallback ?? '').trim());
    if (desc) dict.Contents = PDFHexString.fromText(desc);
    this.items[node].push({ seq, page, annot: ref });
  }

  /** 代わりの説明を LINK_DESCRIPTION_MAX で切る (サロゲートの組の間では切らない)。切ったら cutLinks に数える */
  private clip(node: number, s: string): string {
    if (s.length <= LINK_DESCRIPTION_MAX) return s;
    this.cutLinks.add(node);
    const end = /[\ud800-\udbff]/.test(s[LINK_DESCRIPTION_MAX - 1]) ? LINK_DESCRIPTION_MAX - 1 : LINK_DESCRIPTION_MAX;
    return s.slice(0, end);
  }

  /**
   * リンクでない注釈 (テキスト・スタンプ・添付ファイルなど。§12.5.6) を、構造の木に入れる: 印 t の構造の節の子に Annot の構造の節を作り、
   * OBJR で注釈を指す (§14.8.4.4.2。ISO 14289-1 §7.18.1: 注釈は Annot の中)。注釈に Contents が無ければ、alt を構造の節の Alt にする
   */
  annotation(t: PdfTag | undefined, seq: number, page: number, ref: PDFRef, alt?: string, role: 'Annot' | 'Form' = 'Annot') {
    this.items[t?.id ?? 0].push({ seq, page, annot: ref, annotRole: role, ...(alt ? { annotAlt: alt } : {}) });
    this.annots.add(ref);
  }

  /** 注釈を、もう構造の木に入れたか */
  hasAnnotation(ref: PDFRef): boolean {
    return this.annots.has(ref);
  }

  /**
   * 構造の木を書く (ページと注釈を書き終えた後に 1 度)。返すのは、PDF/UA-1 で足りないもの: 文書の言語が無いか、代わりの文の無い図・数式の数、
   * 段を飛ばした見出しの数。cutLinks は、注釈の代わりの説明を長さの上限で切ったリンクの数
   */
  finish(): { noLang: boolean; figures: number; formulas: number; skipped: number; cutLinks: number } {
    const { pdf, s } = this;
    const ctx = pdf.context;
    const n = s.nodes.length;
    for (const it of this.items) if (it.length > 1) it.sort((a, b) => a.seq - b.seq);
    // 子孫に中身のある節 (used) と、その中でいちばん先に描いた項目の番号 (first)。後順でたどる
    const first = new Float64Array(n).fill(Infinity);
    const order: number[] = [];
    const stack = [0];
    const visited = new Uint8Array(n);
    while (stack.length) {
      const id = stack.pop()!;
      if (id < 0 || id >= n || visited[id]) continue;
      visited[id] = 1;
      order.push(id);
      // 子は後ろから積む (前の子が先に出る): order は文書の順の前順
      const kids = s.nodes[id].kids;
      for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
    }
    for (let k = order.length - 1; k >= 0; k--) {
      const id = order[k];
      let f = this.items[id].length ? this.items[id][0].seq : Infinity;
      for (const c of s.nodes[id].kids) if (first[c] < f) f = first[c];
      first[id] = f;
    }
    // 表の部分 (行のまとまり・行・セル) は、中身が無くても、使われた表の中なら書く (空のセル・空の行を落とすと、表の行と列の並びがずれる。
    // ISO 32000-1 §14.8.4.3.4: 表の行は TH・TD を、表は TR (か THead・TBody・TFoot) を子に持つ)。order は前順なので、親が先に決まる
    const keep = new Uint8Array(n);
    for (const id of order) {
      if (first[id] < Infinity || id === 0) keep[id] = 1;
      else if (TABLE_PARTS.has(s.nodes[id].role) && s.nodes[id].parent >= 0 && keep[s.nodes[id].parent]) keep[id] = 1;
    }
    const used = (id: number) => keep[id] === 1;
    // 子の構造の節を、親の中身の項目の間に置く所 (描いた順の番号): その中で最初に描いた項目の所。目印 (anchor) のある節は、目印の節の
    // 最初の項目のすぐ後ろ (脚注の本体は、本文の参照の印の後ろ)。中身の無い節 (空のセル) は、前の兄弟と同じ所
    // 置き場所の目印 (places) のある節は、その所 (中身より前なら。行の中の絶対配置の箱は、書いた所)
    const place = (id: number, prev: number): number => {
      const a = s.nodes[id].anchor;
      if (a !== undefined && a >= 0 && a < n && first[a] < Infinity) return first[a] + 0.5;
      const mark = this.places.get(id);
      if (mark !== undefined && first[id] < Infinity && mark < first[id]) return mark;
      return first[id] < Infinity ? first[id] : prev;
    };
    // ID (§14.7.2): 同じ値の 2 つ目からは、後ろに番号を足して、文書の中で 1 つにする (IDTree は ID ごとに 1 つの節)
    // 値ごとに、次に試す番号を覚える (それより小さい番号は、試したときに使われていて、使われた値は減らないので、試し直さない。
    // 同じ値の n 個目で n 回試していたので、同じ id の多い文書で、数の 2 乗の手間になっていた)
    const ids = new Map<number, string>();
    const taken = new Set<string>();
    const nextOf = new Map<string, number>();
    for (const id of order) {
      const v = s.nodes[id].sid;
      if (v === undefined || !used(id)) continue;
      let u = v;
      if (taken.has(u)) {
        let k = nextOf.get(v) ?? 2;
        for (; taken.has((u = `${v}-${k}`)); k++);
        nextOf.set(v, k + 1);
      }
      taken.add(u);
      ids.set(id, u);
    }
    const rootRef = ctx.nextRef();
    const refs = new Map<number, PDFRef>();
    for (const id of order) if (used(id)) refs.set(id, ctx.nextRef());
    const annotKeys: Array<[PDFRef, PDFRef]> = [];
    /** 独自の構造の型 → 標準の型 (RoleMap。§14.7.3) */
    const roleMap = new Map<string, string>();
    for (const id of order) {
      if (!used(id)) continue;
      const node = s.nodes[id];
      const ref = refs.get(id)!;
      const own = this.items[id].filter((x) => x.form === undefined || this.forms[x.form].ref);
      const pg = own.find((x) => x.mcid !== undefined && x.form === undefined)?.page;
      const K: unknown[] = [];
      const kids = node.kids.filter((c) => used(c));
      const itemK = (it: Item): unknown => {
        if (it.annot) {
          const objr = ctx.obj({ Type: 'OBJR', Obj: it.annot, Pg: this.pageRefs[it.page] });
          const role = it.annotRole ?? 'Link';
          if (node.role === role && !it.annotAlt) {
            annotKeys.push([it.annot, ref]);
            return objr;
          }
          // 型の違う構造の節の中の注釈 (SVG の中のリンク・段落の中の注釈など): 子に Link・Annot を作って入れる (§14.8.4.4.2)
          const link = ctx.nextRef();
          ctx.assign(link, ctx.obj({ Type: 'StructElem', S: role, P: ref, K: [objr], Pg: this.pageRefs[it.page], ...(it.annotAlt ? { Alt: PDFHexString.fromText(it.annotAlt) } : {}) } as never));
          annotKeys.push([it.annot, link]);
          return link;
        }
        // Form XObject の中の内容は、MCR の Stm で Form を指す (§14.7.4.2 の Table 324)
        if (it.form !== undefined) return ctx.obj({ Type: 'MCR', Pg: this.pageRefs[it.page], Stm: this.forms[it.form].ref!, MCID: it.mcid });
        return it.page === pg ? it.mcid : ctx.obj({ Type: 'MCR', Pg: this.pageRefs[it.page], MCID: it.mcid });
      };
      const at: number[] = [];
      let prev = -Infinity;
      for (const c of kids) at.push((prev = place(c, prev)));
      // 子は文書の順に並べるので、子の所は、後ろの兄弟の所より後ろにしない (後で描く子 (絶対配置の箱など) の所が大きいと、後ろの
      // 兄弟と、その間の中身の項目が、その子の所まで後ろへ回る)。右から、後ろの兄弟との小さい方にそろえる
      for (let k = at.length - 2; k >= 0; k--) at[k] = Math.min(at[k], at[k + 1]);
      let j = 0;
      for (const it of own) {
        while (j < kids.length && at[j] < it.seq) K.push(refs.get(kids[j++])!);
        K.push(itemK(it));
      }
      while (j < kids.length) K.push(refs.get(kids[j++])!);
      if (node.custom) roleMap.set(node.custom, node.role);
      const dict: Record<string, unknown> = { Type: 'StructElem', S: PDFName.of(nameBytes(node.custom ?? node.role)), P: id === 0 ? rootRef : refs.get(node.parent) ?? rootRef, K };
      if (pg !== undefined) dict.Pg = this.pageRefs[pg];
      const sid = ids.get(id);
      if (sid !== undefined) dict.ID = byteString(sid);
      if (node.lang) dict.Lang = langString(node.lang);
      if (node.alt && node.role !== 'Link') dict.Alt = PDFHexString.fromText(node.alt);
      if (node.expansion) dict.E = PDFHexString.fromText(node.expansion);
      // 表の属性 (§14.8.5.7 の Table 349。属性の持ち主 O は Table): 見出しのセルの向き・またぐ行と列の数・見出しのセルの ID
      const A: Record<string, unknown> = {};
      if (node.scope && node.role === 'TH') A.Scope = node.scope;
      if (node.rowSpan && node.rowSpan > 1) A.RowSpan = node.rowSpan;
      if (node.colSpan && node.colSpan > 1) A.ColSpan = node.colSpan;
      const hs = node.headers?.map((h) => ids.get(h)).filter((h): h is string => h !== undefined);
      if (hs?.length) A.Headers = hs.map(byteString);
      if (Object.keys(A).length) dict.A = ctx.obj({ O: 'Table', ...A } as never);
      ctx.assign(ref, ctx.obj(dict as never));
    }
    // ParentTree (§14.7.4.4): ページの鍵 (StructParents) はページの番号、注釈の鍵 (StructParent) はその後ろ
    const nums: unknown[] = [];
    this.pageParents.forEach((list, k) => {
      if (!list?.length) return;
      ctx.lookup(this.pageRefs[k], PDFDict).set(PDFName.of('StructParents'), PDFNumber.of(k));
      nums.push(k, ctx.obj(list.map((id) => refs.get(id) ?? refs.get(0)!)));
    });
    let key = this.pageParents.length;
    for (const [annot, elem] of annotKeys) {
      ctx.lookup(annot, PDFDict).set(PDFName.of('StructParent'), PDFNumber.of(key));
      nums.push(key++, elem);
    }
    // 中に印の付いた内容を持つ Form XObject の鍵 (StructParents)。その後ろ
    for (const f of this.forms) {
      if (!f.ref || !f.parents.length) continue;
      (ctx.lookup(f.ref) as unknown as { dict: PDFDict }).dict.set(PDFName.of('StructParents'), PDFNumber.of(key));
      nums.push(key++, ctx.obj(f.parents.map((id) => refs.get(id) ?? refs.get(0)!)));
    }
    // 注釈のあるページの、注釈をたどる順は構造の順 (/Tabs /S。ISO 32000-1 §12.5 の Table 30 の Tabs)
    for (const r of this.pageRefs) if (r) ctx.lookup(r, PDFDict).set(PDFName.of('Tabs'), PDFName.of('S'));
    const root: Record<string, unknown> = { Type: 'StructTreeRoot', K: refs.get(0)!, ParentTree: ctx.obj({ Nums: nums } as never), ParentTreeNextKey: key };
    if (roleMap.size) root.RoleMap = ctx.obj(Object.fromEntries([...roleMap].map(([k, v]) => [nameBytes(k), PDFName.of(v)])) as never);
    // ID から構造の節を引く名前の木 (§14.7.2 の Table 322 の IDTree。§7.9.6: 鍵はバイトの順に並べる)
    if (ids.size) {
      const names: unknown[] = [];
      const bytes = (v: string) => Array.from(UTF8.encode(v));
      const sorted = [...ids].map(([id, v]) => ({ id, v, b: bytes(v) })).sort((x, y) => compareBytes(x.b, y.b));
      for (const { id, v } of sorted) names.push(byteString(v), refs.get(id)!);
      root.IDTree = ctx.obj({ Names: names } as never);
    }
    ctx.assign(rootRef, ctx.obj(root as never));
    const cat = pdf.catalog;
    cat.set(PDFName.of('StructTreeRoot'), rootRef);
    cat.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
    const lang = s.nodes[0]?.lang;
    if (lang) cat.set(PDFName.of('Lang'), langString(lang));
    // PDF/UA-1 の、構造の木から分かる足りないもの (ISO 14289-1 §7.2 の言語・§7.3 の図の代わりの文・§7.4 の見出しの順・§7.7 の数式の代わりの文)
    const figures = order.filter((id) => used(id) && s.nodes[id].role === 'Figure' && !s.nodes[id].alt).length;
    const formulas = order.filter((id) => used(id) && s.nodes[id].role === 'Formula' && !s.nodes[id].alt).length;
    // 見出しは、構造の木の順 (前順。order は前順) で、最初が H1、深くなるときは 1 段ずつ (§7.4.2 の、番号の付いた見出しの決まり)
    let prev = 0;
    let skipped = 0;
    for (const id of order) {
      const m = used(id) ? /^H([1-6])$/.exec(s.nodes[id].role) : null;
      if (!m) continue;
      const lv = Number(m[1]);
      if (lv > prev + 1) skipped++;
      prev = lv;
    }
    return { noLang: !lang, figures, formulas, skipped, cutLinks: this.cutLinks.size };
  }
}

/** 表の部分の構造の型 (中身が無くても、使われた表の中なら書く) */
const TABLE_PARTS = new Set(['THead', 'TBody', 'TFoot', 'TR', 'TH', 'TD']);

const UTF8 = new TextEncoder();

/**
 * 名前の字 (独自の構造の型 axf:pdftag="名前タグ" など) を、UTF-8 のバイトを 1 字ずつにした字の並びにする (PDFName.of に渡す)。
 * ISO 32000-1 §7.3.5: 名前はバイトの並びで、文字の名前は UTF-8 で書く。PDFName.of は、0xFF を超える字を 4 桁の 16 進の #xxxx で書くので、
 * 読む側には #xx と、続く字に読まれていた。ASCII の字だけの名前は、そのまま
 */
export function nameBytes(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(s)) return s;
  let out = '';
  for (const b of UTF8.encode(s)) out += String.fromCharCode(b);
  return out;
}

/** ID (§14.7.2 の Table 323: バイトの文字列)。ASCII の字だけならそのまま、ほかは UTF-8 のバイトを 16 進で書く */
function byteString(v: string): PDFString | PDFHexString {
  if (/^[\x20-\x7e]*$/.test(v) && !/[()\\]/.test(v)) return PDFString.of(v);
  return PDFHexString.of(Array.from(UTF8.encode(v), (b) => b.toString(16).padStart(2, '0')).join(''));
}

function compareBytes(a: number[], b: number[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
  return a.length - b.length;
}

/** 2 つの印が同じか */
export function sameTag(a: PdfTag | undefined, b: PdfTag | undefined): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.art === b.art);
}

/** 言語の札 (BCP 47。ASCII の字だけなら、そのまま文字列にする。ISO 32000-1 §14.9.2.1) */
function langString(lang: string): PDFString | PDFHexString {
  return /^[\x20-\x7e]*$/.test(lang) && !/[()\\]/.test(lang) ? PDFString.of(lang) : PDFHexString.fromText(lang);
}
