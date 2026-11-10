/**
 * xslfoImport — XSL-FO (1.0/1.1) → Kumiori の論理ツリー (JSON)
 *
 * 方針: 「対応する要素を明示し、未対応は黙って捨てずに集計して報告する」。
 *  - ページ: simple-page-master / page-sequence-master (条件付き) / region-before・after・start・end の static-content
 *  - ブロック: block, inline, character, wrapper, block-container, float, footnote, leader, marker, retrieve-marker, page-number
 *  - 表: table-and-caption / table (header/footer/body/row/cell, colspan/rowspan, 列幅の固定・比例)、list-block (2 列の表へ)
 *  - ルビ: XSL-FO に標準が無いので、AH Formatter 向けの文書の書き方「inline-container に小さい block + 親文字 block」を LRuby に変換
 *  - 画像 (external-graphic)・SVG・MathML (instream-foreign-object) は画像 (LImage) にする。MathML は、数式用の書体があれば
 *    mathLayout.ts で組み、無ければ行内の要素に組み替える (foMathFallback.ts)。読めない中身は、指定の寸法のプレースホルダにして報告する
 *
 * DOM は最小限のインターフェース (foDom.ts の XNode) だけを使う。ブラウザの DOMParser でも @xmldom/xmldom でも動く。
 *
 * ファイルの分け方: 親から子へ渡す文脈 (Ctx) は foContext.ts、fo:simple-page-master の読み取りは foPageMaster.ts、
 * 数式用の書体が無いときの MathML の組み替えは foMathFallback.ts。どちらも Importer の読み方 (attr・len・color など) を借りて動く
 */
import { msg } from './messages';
import { countDroppedLink, judgeExternalLink, type DroppedLinks, type LinkPolicy } from './linkPolicy';
import { evalExpr, evalLength } from './foExpr';
import { FO_NS, serializeSvg, utf8Base64, type XEl, type XNode } from './foDom';
import { WS_INITIAL, type Ctx, type WhiteSpace } from './foContext';
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, readPageMaster, type MasterInfo } from './foPageMaster';
import { FoMathFallback } from './foMathFallback';
// 最小 DOM の型は foDom.ts に移した (api.ts・main.ts・テストは従来どおりここから読める)
export type { XNode } from './foDom';
import { applyTextTransform } from './textTransform';
import type {
  Annotation,
  BoxShadow,
  FormField,
  LineNumbering,
  RevisionBar,
  LinkTarget,
  BackgroundImage,
  BorderSide,
  LBookmark,
  EdgesInput,
  LBlock,
  LBlockContainer,
  BorderInput,
  LBlockLevel,
  LDocument,
  LFloat,
  LFootnote,
  LImage,
  LIndexEntry,
  LIndexKeyReference,
  LIndexPageCitationList,
  LInlineContainer,
  LInline,
  LPageNumberCitation,
  LInlineLevel,
  LLeader,
  LMarker,
  LPageSequence,
  LRetrieveMarker,
  LRetrieveTableMarker,
  LRuby,
  LTable,
  LTableCell,
  LTableColumn,
  LTableRow,
  PageMaster,
  Rotation,
  ConditionalPageMaster,
  TextStyle,
  HyphenLimits,
  WritingMode,
  WritingFlip,
} from './types';
import { PT_PER_MM } from './units';
import { withGrouping } from './pageNumber';
import { isColorName, spotColor, toCss } from './color';
import { normalizeSrc } from './assets';
import type { FkFont, MathFont } from './mathFont';
import { layoutMathML, type MNode } from './mathLayout';
import { isAntennaCompat, type FoCompat } from './compat';

/** 表の列の番号・数の上限 */
const MAX_TABLE_COLUMNS = 1000;
/**
 * 要素の入れ子の深さ (fo:root から数える) の上限。読み込み・組版は、要素の入れ子を関数の再帰でたどるので、深すぎる文書は
 * JS の呼び出しの深さを使い切る (RangeError)。測ったところ、fo:block だけの入れ子で 800〜1000 段、fo:block-container と
 * fo:block の交互で 600〜800 段で切れるので、その 1/3 ほどにする。実在の文書の入れ子は数十段まで
 */
const MAX_FO_NEST = 250;
/** 入れ子が深すぎる文書の誤り */
const tooDeep = () => new Error(msg(`要素の入れ子が深すぎます (${MAX_FO_NEST} 段まで)`, `elements are nested too deeply (up to ${MAX_FO_NEST} levels)`));

export interface ImportOptions {
  /**
   * 文書の外への飛び先のうち、通すもの (linkPolicy.ts)。既定では、http・https・mailto・tel の URL と相対の PDF だけをリンクにする。
   * 通さない飛び先はリンクにせず (字はそのまま組む)、report.droppedLinks に数える
   */
  links?: LinkPolicy;
  /** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1)。rgb-icc(…, #Separation, '名前', 濃度) を特色 (PDF の Separation) にする */
  spotColors?: Record<string, [number, number, number, number]>;
  /** FO の font-family (カンマ区切りの並び) と太字かどうかから、使う書体 (ファミリ名) を決める。undefined なら親から継承 */
  mapFont?: (families: string[], bold: boolean) => string | undefined;
  /** external-graphic が指す文字のファイル (MathML) の中身を返す。無ければ undefined (画像として扱う) */
  readText?: (src: string) => string | undefined;
  /** 仕上がり・塗り足し・トンボ (FO に無い印刷設定) */
  bleedMm?: number;
  trimMarks?: boolean;
  /**
   * 既定値の流儀。spec (既定): XSL-FO 1.1 の初期値どおり (12pt・行送り 1.2・start・ぶら下げ無し)。
   * antenna: 互換モード。AH Formatter 向けに書かれた文書も組めるようにする (10pt・行送り 1.2・行末の句読点を詰めて収める)。defaultFontSize / defaultLineHeight の指定はどちらでも優先
   */
  compat?: FoCompat;
  /** FO の既定フォントサイズ (medium)。既定は、仕様モードで 12pt、互換モード (antenna) で 10pt (XSL-FO 仕様では UA 依存) */
  defaultFontSize?: number;
  /** line-height="normal" に当てる行送り比。既定 1.2 */
  defaultLineHeight?: number;
  /**
   * 数式用の書体 (OpenType の MATH 表を持つ書体)。あれば MathML を、この書体の MATH 表の値で組み、字の輪郭の図形 (SVG) にする。
   * 無ければ、MathML を行内の要素 (上付き・分数の箱など) に組み替えて、本文の書体で組む
   */
  mathFont?: MathFont;
  /** 数式の書体に無い字 (和字など) を描く書体 */
  mathFallback?: (ch: string) => FkFont | undefined;
}

export interface ImportReport {
  /** 変換できなかった要素・属性の種類ごとの出現数 */
  unsupported: Record<string, number>;
  /** 近似や既定値で代用した箇所の説明 */
  notes: string[];
  /** 参照している画像の src (正規化済み)。UI が、同時に選択されたファイルと突き合わせる */
  images: string[];
  /** 添付ファイルの注釈が参照するファイル (axf:annotation-file-attachment。data: の URI は除く) */
  files?: string[];
  /** リンクにしなかった、文書の外への飛び先 (ImportOptions の links で通さないもの)。理由の見出しごとの件数 */
  droppedLinks?: DroppedLinks;
  counts: { sequences: number; blocks: number; tables: number; footnotes: number; floats: number; rubies: number };
}

export interface ImportResult {
  document: LDocument;
  report: ImportReport;
}

// ───────────────────────── ユーティリティ ─────────────────────────



/**
 * 約物の前後のアキの宣言の要素 (fo:declarations の中の axf:*)。拡張の要素の名前は axf:space-start-punctuation (約物の前)・
 * axf:space-end-punctuation (約物の後)。以前から読んでいた space-before-punctuation・space-after-punctuation の名前も、同じ意味で読む
 */
const PUNCT_SPACING_KINDS: Record<string, 'before' | 'after' | 'punct-digit' | 'digit-punct'> = {
  'space-start-punctuation': 'before',
  'space-end-punctuation': 'after',
  'space-before-punctuation': 'before',
  'space-after-punctuation': 'after',
  'space-between-punctuation-and-digit': 'punct-digit',
  'space-between-digit-and-punctuation': 'digit-punct',
};
const PUNCT_SPACING_ELEMENTS = new Set(Object.keys(PUNCT_SPACING_KINDS));


/** FO で font-size を指定しないときの大きさ (pt)。互換モードでは 10pt */
const DEFAULT_FO_FONT_SIZE = 10;
/** line-height=normal の代用 (倍率)。互換モードでは 10pt の行が 12pt、12pt の行が 14.4pt */
const DEFAULT_FO_LINE_HEIGHT = 1.2;

class Importer {
  /** 本文の fo:page-number に付ける id の番号 */
  private pageNumberSeq = 0;
  report: ImportReport = { unsupported: {}, notes: [], images: [], counts: { sequences: 0, blocks: 0, tables: 0, footnotes: 0, floats: 0, rubies: 0 } };

  constructor(readonly opts: ImportOptions) {}
  /** 数式用の書体が無いときの MathML の組み替え (foMathFallback.ts) */
  private readonly foMath = new FoMathFallback(this);
  /** 読んだ fo:marker (要素と番号)。retrieve-marker の位置の文脈で中身を読み直すのに使う */
  private markerEls: Array<{ el: XEl; mk: LMarker }> = [];
  /** 読んだ fo:retrieve-marker と、その位置の文脈 */
  private retrieves: Array<{ r: LRetrieveMarker | LRetrieveTableMarker; ctx: Ctx }> = [];
  /** fo:table-header・fo:table-footer の中を読んでいる間の深さ (fo:retrieve-table-marker を置ける所。§6.13.7) */
  private inTableHF = 0;
  /** fo:marker の中身を読んでいる間の深さ (0 なら marker の外) */
  private inMarker = 0;
  /** 文字列の XML (CDATA に入った MathML・SVG) を読むためのパーサ */
  parseXml?: (xml: string) => XNode;

  /** instream-foreign-object の中身の要素。要素が無く、文字 (CDATA) が XML なら、それを読んで根の要素を返す */
  private foreignRoot(n: XEl): XEl | undefined {
    const el = this.els(n)[0];
    if (el) return el;
    const t = (n.textContent ?? '').trim();
    if (!t.startsWith('<') || !this.parseXml) return undefined;
    try {
      const d = this.parseXml(t.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, ''));
      return (d.nodeType === 9 ? Array.from(d.childNodes).find((c) => c.nodeType === 1) : d) as XEl | undefined;
    } catch {
      return undefined;
    }
  }

  /** 約物の前後のアキ (axf:space-start-punctuation など。fo:declarations の中)。言語ごと */
  private punctRules: Array<{ kind: 'before' | 'after' | 'punct-digit' | 'digit-punct'; code: string; space: string; lang: string }> = [];

  /** 文書の中の axf:space-*-punctuation の宣言を集める (fo:declarations はどこにあってもよい) */
  private readPunctuationSpacing(root: XEl) {
    const kinds = PUNCT_SPACING_KINDS;
    const walk = (n: XEl) => {
      for (const c of this.els(n)) {
        const k = kinds[this.name(c)];
        const code = this.attr(c, 'code');
        if (k && code) this.punctRules.push({ kind: k, code, space: this.attr(c, 'space') ?? 'thin', lang: (this.attr(c, 'language') ?? '').toLowerCase() });
        else if (this.name(c) === 'declarations' || this.name(c) === 'page-sequence') walk(c);
      }
    };
    walk(root);
  }

  /**
   * 言語の約物のアキ: 宣言に合う記号の前 (後) に、指定のアキ (百分率は字の大きさに対する割合、thin は 1/6em) を行内の余白で入れる。
   * 記号の隣が空白なら入れない
   */
  private punctuationSpacing(t: string, ctx: Ctx): LInlineLevel[] {
    const lang = (ctx.lang ?? '').toLowerCase();
    const rules = this.punctRules.filter((r) => r.lang && (lang === r.lang || lang.startsWith(r.lang + '-')));
    if (!rules.length) return [t];
    const amount = (s: string) => (s === 'thin' ? ctx.fontSize / 6 : s === 'medium' ? ctx.fontSize / 4 : s === 'thick' ? ctx.fontSize / 3 : /%$/.test(s) ? (parseFloat(s) / 100) * ctx.fontSize : (this.len(s, ctx.fontSize) ?? 0));
    const chars = [...t];
    const out: LInlineLevel[] = [];
    let buf = '';
    chars.forEach((ch, k) => {
      const prev = chars[k - 1];
      const next = chars[k + 1];
      const isDigit = (c: string | undefined) => !!c && /\d/.test(c);
      const free = (c: string | undefined) => !!c && !/\s/.test(c) && c !== '\u00A0';
      let left = 0;
      let right = 0;
      for (const r of rules) {
        if (r.code !== ch) continue;
        if (r.kind === 'before' && free(prev)) left = Math.max(left, amount(r.space));
        if (r.kind === 'after' && free(next)) right = Math.max(right, amount(r.space));
        if (r.kind === 'punct-digit' && isDigit(next)) right = Math.max(right, amount(r.space));
        if (r.kind === 'digit-punct' && isDigit(prev)) left = Math.max(left, amount(r.space));
      }
      if (!left && !right) {
        buf += ch;
        return;
      }
      if (buf) out.push(buf);
      buf = '';
      out.push({ type: 'inline', padding: { ...(left ? { left } : {}), ...(right ? { right } : {}) }, children: [ch] });
    });
    if (buf) out.push(buf);
    return out;
  }

  /** line-height の成分 (数は字の大きさに掛け、長さ・百分率はそのまま) を pt にする */
  private lineHeightComponent(v: string | undefined, fs: number): number | undefined {
    if (v === undefined) return undefined;
    if (/^-?\d*\.?\d+$/.test(v.trim())) return Math.max(parseFloat(v) * fs, 0);
    const n = this.len(v, fs, fs);
    return n === undefined ? undefined : Math.max(n, 0);
  }

  /**
   * span="all" は fo:flow の直下のブロックにだけ効く (§7.21.4) が、互換モードでは入れ子のブロックの span も効かせる。
   * flow の直下のブロックの先頭にある span="all" の子を、外へ出して flow の直下に並べる (改ページの指定は出した子へ移す)
   */
  private hoistSpans(children: LBlockLevel[], wm: WritingMode): LBlockLevel[] {
    const out: LBlockLevel[] = [];
    for (const c of children) {
      if (c.type !== 'block' || c.span === 'all') {
        out.push(c);
        continue;
      }
      const kids = c.children;
      let k = 0;
      while (k < kids.length && typeof kids[k] !== 'string' && (kids[k] as LBlock).type === 'block' && (kids[k] as LBlock).span === 'all') k++;
      if (k === 0) {
        out.push(c);
        continue;
      }
      const lead = kids.slice(0, k) as LBlock[];
      if (c.breakBefore && !lead[0].breakBefore) lead[0] = { ...lead[0], breakBefore: c.breakBefore };
      const before = this.beforeSideOf(wm);
      const marginOf = (b: LBlock) => (typeof b.margin === 'number' ? b.margin : (b.margin?.[before] ?? 0));
      // 親の space-before と、出した最初の子の space-before は隣り合う余白なので、大きいほうを残す (優先度は同じとみなす。XSL 1.1 §4.3.1)
      if (marginOf(c) > marginOf(lead[0])) {
        const m0 = lead[0].margin;
        const base = typeof m0 === 'number' ? { top: m0, right: m0, bottom: m0, left: m0 } : { ...(m0 ?? {}) };
        lead[0] = { ...lead[0], margin: { ...base, [before]: marginOf(c) }, ...(c.retainSpaceBefore ? { retainSpaceBefore: true } : {}) };
      }
      out.push(...lead);
      // 残りの部分は親のブロックの続きなので、親の space-before (block-start 側の margin) は持たない。親の前の空きは出した子の前だけ
      // (改ページした親の space-before は、span の後の段の先頭に空きを作らない)
      if (k < kids.length) {
        const rest: LBlock = { ...c, breakBefore: undefined, children: kids.slice(k) };
        if (typeof c.margin === 'number') rest.margin = { top: c.margin, right: c.margin, bottom: c.margin, left: c.margin, [before]: 0 };
        else if (c.margin?.[before] !== undefined) rest.margin = { ...c.margin, [before]: 0 };
        delete rest.retainSpaceBefore;
        delete rest.spaceBeforePrecedence;
        out.push(rest);
      }
    }
    return out;
  }

  /** 書字方向での block-start 側の物理的な辺 */
  private beforeSideOf(wm: WritingMode): 'top' | 'left' | 'right' {
    return wm === 'horizontal-tb' ? 'top' : wm === 'vertical-lr' ? 'left' : 'right';
  }

  /** external-graphic が MathML のファイル (.mml / .xml・content-type が mathml) を指し、その中身を読めれば、根の math 要素を返す */
  private externalMath(n: XEl): XEl | undefined {
    const src = this.attr(n, 'src');
    if (!src || !this.opts.readText || !this.parseXml) return undefined;
    if (!/mathml/i.test(this.attr(n, 'content-type') ?? '') && !/\.(mml|xml)\W*\)?\W*$/i.test(src)) return undefined;
    const t = this.opts.readText(normalizeSrc(src));
    if (!t) return undefined;
    try {
      const d = this.parseXml(t.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, ''));
      const root = (d.nodeType === 9 ? Array.from(d.childNodes).find((c) => c.nodeType === 1) : d) as XEl | undefined;
      return root && this.name(root) === 'math' ? root : undefined;
    } catch {
      return undefined;
    }
  }

  /** 罫線の太さのキーワード (pt)。spec: CSS の値、antenna: thin 1pt・medium 3pt・thick 5pt */
  get borderKeywords(): Record<'thin' | 'medium' | 'thick', number> {
    return this.spec ? { thin: 0.75, medium: 2.25, thick: 3.75 } : { thin: 1, medium: 3, thick: 5 };
  }

  /** XSL-FO 1.1 の初期値どおりに組む (アンテナハウス互換の既定を使わない) */
  get spec() {
    // compat の判定は compat.ts の isAntennaCompat の 1 つ (組版・PDF の設定 (isAhCompat) と同じ判定。知らない値は公開 API の入口で誤りにする)
    return !isAntennaCompat(this.opts.compat);
  }
  /** font-size=medium の大きさ。spec: 12pt (CSS2 の推奨)、antenna: 10pt */
  get defaultFontSize() {
    return this.opts.defaultFontSize ?? (this.spec ? 12 : DEFAULT_FO_FONT_SIZE);
  }
  /** line-height=normal の比。spec: 1.2 (仕様の推奨範囲 1.0〜1.2 の上限)、antenna: 1.2 */
  get defaultLineHeight() {
    return this.opts.defaultLineHeight ?? (this.spec ? 1.2 : DEFAULT_FO_LINE_HEIGHT);
  }

  // ── 報告 ──
  miss(what: string, n = 1) {
    this.report.unsupported[what] = (this.report.unsupported[what] ?? 0) + n;
  }
  /** 読まずに捨てる要素を、読み込みの報告に数える (FO の要素は fo:名前、ほかは書いたとおりの名前) */
  missElement(el: XEl, label?: string) {
    this.miss(label ?? (this.isFo(el) ? `fo:${this.name(el)}` : el.nodeName));
  }
  /**
   * 「正の整数」の <number> の値 (column-count・column-number・number-columns-repeated・number-columns-spanned・number-rows-spanned)。
   * 正でない値・整数でない値は、1 以上の最も近い整数に丸める (XSL 1.1 §7.27.2・§7.28.8・§7.28.12・§7.28.13・§7.28.14:
   * “rounded to the nearest integer value greater than or equal to 1”)。ちょうど半分の値の丸め方は仕様に無いので、Math.round (大きい方) にする。
   * 数として読めなければ NaN (呼ぶ側が初期値を使う)
   */
  posInt(v: string | undefined): number {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? Math.max(1, Math.round(n)) : NaN;
  }
  /**
   * 列の番号・数の値 (column-number・number-columns-repeated・number-columns-spanned・number-rows-spanned)。posInt と同じ規則で丸める。
   * 大きすぎる値は MAX_TABLE_COLUMNS にする (細工した FO で、何千万もの列やセルを作らない)
   */
  colInt(v: string | undefined, what: string): number {
    const n = this.posInt(v);
    if (!(n > MAX_TABLE_COLUMNS)) return n;
    this.note(msg(`${what}="${n}" は大きすぎるので ${MAX_TABLE_COLUMNS} にします`, `${what}="${n}" is too large; using ${MAX_TABLE_COLUMNS}`));
    return MAX_TABLE_COLUMNS;
  }

  note(msg: string) {
    if (!this.report.notes.includes(msg) && this.report.notes.length < 200) this.report.notes.push(msg);
  }
  /** 参照する画像の src (正規化済み・data URI) を、読み込みの報告に足す (同じものは 1 度だけ) */
  addImage(src: string) {
    if (!this.report.images.includes(src)) this.report.images.push(src);
  }

  // ── DOM ヘルパー ──
  name(n: XNode): string {
    return n.localName ?? (n.nodeName.split(':').pop() as string);
  }
  isFo(n: XNode): boolean {
    return n.nodeType === 1 && (n.namespaceURI === FO_NS || n.nodeName.startsWith('fo:'));
  }
  els(n: XNode): XEl[] {
    return Array.from(n.childNodes).filter((c) => c.nodeType === 1);
  }
  attr(n: XNode, k: string): string | undefined {
    if (n.hasAttribute && n.getAttribute && n.hasAttribute(k)) {
      const v = n.getAttribute(k);
      return v === null ? undefined : v.trim();
    }
    // 一括指定 (font・background・page-break-*・size) から決まる個別の性質。個別に書いた性質が勝つ (XSL 1.1 §5.2:
    // “The individual properties are always more precise than any shorthand.”)
    return this.shorthandsOf(n)?.[k];
  }

  /** 要素ごとの、一括指定を個別の性質に分けた結果 (一括指定の無い要素は null) */
  private expanded = new WeakMap<XNode, Record<string, string> | null>();
  private shorthandsOf(n: XNode): Record<string, string> | undefined {
    let e = this.expanded.get(n);
    if (e === undefined) {
      e = this.expandShorthands(n);
      this.expanded.set(n, e);
    }
    return e ?? undefined;
  }

  /**
   * 一括指定を、個別の性質に分ける (XSL 1.1 §5.2 Shorthand Expansion)。読むのは font (§7.31.13)・background (§7.31.1)・
   * page-break-after・page-break-before・page-break-inside (§7.31.16〜§7.31.18)・size (§7.31.21) と、position (§7.31.20) の relative-position。
   * border・margin・padding・white-space などは、それぞれを読む所で分けている。
   * 一括指定は、書いていない個別の性質を初期値に戻す。継承されない性質は、書かなければ初期値なので何も出さない
   * (font だけは継承される性質なので、初期値を出して親の値を打ち消す)。
   * inherit は、継承される性質 (font) では書かないのと同じ。ほかの読めない値は、何もせずに報告する
   */
  private expandShorthands(n: XNode): Record<string, string> | null {
    if (!n.hasAttribute || !n.getAttribute || !this.isFo(n)) return null;
    const own = (k: string) => (n.hasAttribute!(k) ? (n.getAttribute!(k) ?? '').trim() : undefined);
    const out: Record<string, string> = {};
    // font: [ [ <font-style> || <font-variant> || <font-weight> ]? <font-size> [ / <line-height> ]? <font-family> ] | caption | icon | … | inherit
    const font = own('font');
    if (font && font !== 'inherit') {
      const toks = splitTopLevel(font, ' ');
      const set: Record<string, string> = { 'font-style': 'normal', 'font-variant': 'normal', 'font-weight': 'normal', 'line-height': 'normal', 'font-stretch': 'normal' };
      let k = 0;
      for (; k < toks.length && k < 3; k++) {
        const t = toks[k];
        if (t === 'normal') continue;
        if (t === 'italic' || t === 'oblique') set['font-style'] = t;
        else if (t === 'small-caps') set['font-variant'] = t;
        else if (t === 'bold' || t === 'bolder' || t === 'lighter' || /^[1-9]00$/.test(t)) set['font-weight'] = t;
        else break;
      }
      // 残りは「大きさ [ / 行送り ] 書体の並び」。/ の前後の空白はあってもよい (CSS2 §15.2.5 の文法)
      const rest = toks.slice(k).join(' ');
      const m = /^(\S+)\s*\/\s*(\S+)\s+(\S.*)$/.exec(rest) ?? /^(\S+)()\s+(\S.*)$/.exec(rest);
      if (m && !/^(caption|icon|menu|message-box|small-caption|status-bar)$/.test(font)) {
        set['font-size'] = m[1];
        if (m[2]) set['line-height'] = m[2];
        set['font-family'] = m[3];
        Object.assign(out, set);
      } else this.miss(`font:${font.slice(0, 20)}`);
    }
    // background: [ <background-color> || <background-image> || <background-repeat> || <background-attachment> || <background-position> ] | inherit
    const bg = own('background');
    if (bg) {
      const pos: string[] = [];
      for (const t of splitTopLevel(bg, ' ')) {
        if (/^url\(/i.test(t) || t === 'none') out['background-image'] = t;
        else if (/^(repeat|repeat-x|repeat-y|no-repeat)$/.test(t)) out['background-repeat'] = t;
        else if (t === 'scroll' || t === 'fixed') out['background-attachment'] = t;
        else if (/^(top|bottom|left|right|center)$/.test(t) || /^[-+.\d]/.test(t)) pos.push(t);
        else if (t === 'inherit' && bg === 'inherit') this.miss('background:inherit');
        else out['background-color'] = t;
      }
      if (pos.length) out['background-position'] = pos.join(' ');
    }
    // page-break-before・page-break-after (§7.31.16・§7.31.17): always は break = page、left は even-page、right は odd-page、
    // avoid は keep-with-previous・keep-with-next = always。page-break-inside (§7.31.18): avoid は keep-together = always
    for (const [side, keep] of [['before', 'keep-with-previous'], ['after', 'keep-with-next']] as const) {
      const v = own(`page-break-${side}`);
      if (v === undefined) continue;
      const brk = v === 'always' ? 'page' : v === 'left' ? 'even-page' : v === 'right' ? 'odd-page' : v === 'auto' || v === 'avoid' ? 'auto' : undefined;
      if (brk === undefined) {
        this.miss(`page-break-${side}:${v.slice(0, 20)}`);
        continue;
      }
      out[`break-${side}`] = brk;
      out[keep] = v === 'avoid' ? 'always' : 'auto';
    }
    // position (§7.31.20): relative は relative-position = relative、ほかは static (absolute・fixed の absolute-position は blockContainer が読む)
    const position = own('position');
    if (position === 'relative' || position === 'static' || position === 'absolute' || position === 'fixed') out['relative-position'] = position === 'relative' ? 'relative' : 'static';
    const pbi = own('page-break-inside');
    if (pbi === 'avoid' || pbi === 'auto') out['keep-together'] = pbi === 'avoid' ? 'always' : 'auto';
    // inherit: keep-together は継承される性質 (§7.20.3) なので、書かないのと同じ
    else if (pbi !== undefined && pbi !== 'inherit') this.miss(`page-break-inside:${pbi.slice(0, 20)}`);
    // size (§7.31.21): page-width・page-height に写す。長さ 1 つは幅と高さの両方、2 つは幅・高さの順 (CSS2 §13.2.2 の例)。
    // auto は用紙の大きさ (page-width・page-height の auto)、landscape・portrait は用紙の長い辺を横・縦にする
    const size = own('size');
    if (size !== undefined && this.name(n) === 'simple-page-master') {
      const p = splitTopLevel(size, ' ');
      const [short, long] = [Math.min(DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT), Math.max(DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT)];
      if (size === 'auto') Object.assign(out, { 'page-width': 'auto', 'page-height': 'auto' });
      else if (size === 'landscape') Object.assign(out, { 'page-width': `${long}pt`, 'page-height': `${short}pt` });
      else if (size === 'portrait') Object.assign(out, { 'page-width': `${short}pt`, 'page-height': `${long}pt` });
      else if ((p.length === 1 || p.length === 2) && p.every((t) => /^[-+.\d]/.test(t) || t.includes('('))) Object.assign(out, { 'page-width': p[0], 'page-height': p[1] ?? p[0] });
      else this.miss(`size:${size.slice(0, 20)}`);
    }
    return Object.keys(out).length ? out : null;
  }
  /** 'name' と 'name.optimum' のうち存在する方 */
  attrOpt(n: XNode, k: string): string | undefined {
    return this.attr(n, k) ?? this.attr(n, `${k}.optimum`);
  }
  /**
   * 属性の値。inherit は「指定なし」(undefined) として返す: 継承される性質は、値を設定しなければ親の値を受け継ぐので、
   * それが inherit の意味 (XSL 1.1 §5.9.10.1: 親の計算値) になる。inherit を知らない値として既定に落としたり報告したりしないための共通の層。
   * 継承されない性質 (reference-orientation など) の inherit は親の計算値を取らないと誤るので、refOrientation のように別に親を見る
   */
  /**
   * 分綴の特性を、親から受け継いだ組 (parent) に重ねる。この要素に指定が無ければ undefined (親の組をそのまま受け継ぐ)。
   *  - hyphenation-character (XSL 1.1 §7.10.5): 行末に出す字 (1 字)
   *  - hyphenation-push-character-count (§7.10.6): 切れ目の後 (次の行へ送る側) の最小の字数。hyphenation-remain-character-count (§7.10.7): 前の最小の字数。
   *    どちらも 1 以上の整数に丸める (“rounded to the nearest integer value greater than or equal to 1”)
   *  - hyphenation-ladder-count (§7.16.2): 続けて分綴する行の数の上限 (no-limit か、1 以上の整数に丸めた数)
   *  - hyphenation-keep (§7.16.1): auto だけ。column・page (分綴した語の前後を同じ段・ページに置く) は読まず、未対応として報告する
   */
  private hyphenLimits(el: XEl, parent: HyphenLimits | undefined): HyphenLimits | undefined {
    const o: HyphenLimits = { ...parent };
    let set = false;
    const count = (k: string): number | undefined => {
      const v = this.attrInh(el, k);
      const n = v === undefined ? NaN : parseFloat(v);
      return Number.isFinite(n) ? Math.max(1, Math.round(n)) : undefined;
    };
    const ch = this.attrInh(el, 'hyphenation-character');
    if (ch) {
      o.character = [...ch][0];
      set = true;
    }
    const push = count('hyphenation-push-character-count');
    if (push !== undefined) {
      o.minAfter = push;
      set = true;
    }
    const remain = count('hyphenation-remain-character-count');
    if (remain !== undefined) {
      o.minBefore = remain;
      set = true;
    }
    const ladder = this.attrInh(el, 'hyphenation-ladder-count');
    if (ladder === 'no-limit') {
      delete o.maxLines;
      set = true;
    } else {
      const n = count('hyphenation-ladder-count');
      if (n !== undefined) {
        o.maxLines = n;
        set = true;
      }
    }
    const keep = this.attrInh(el, 'hyphenation-keep');
    if (keep && keep !== 'auto') this.miss(`hyphenation-keep:${keep}`);
    return set ? o : undefined;
  }

  attrInh(n: XNode, k: string): string | undefined {
    const v = this.attr(n, k);
    return v === 'inherit' ? undefined : v;
  }

  /** 要素の親 (convert で文書の木を一度たどって作る。継承しない性質の inherit を親の値にするのに使う) */
  private parents = new WeakMap<XEl, XEl>();
  /** 文書に fo:change-bar-begin・fo:change-bar-end がある (indexParents が見つける) */
  private hasChangeBars = false;
  /**
   * 変更バー (XSL 1.1 §6.13.2): fo:flow の中の要素・文字 → その始まりの所で効いている変更バーの並び (効いているものがある所だけ)。
   * 変更バーのある文書でだけ作る (prepareChangeBars)
   */
  private barsAt?: WeakMap<XNode, RevisionBar[]>;
  /**
   * 変更バーの範囲を、文書の順にたどって決める。fo:change-bar-begin と fo:change-bar-end は、fo:flow・fo:static-content の子孫のどこにでも置ける
   * 「点」(§6.2) で、同じ change-bar-class の、入れ子の深さの合うものどうしが組になる (§6.13.2 の Constraints)。組になる終わりの無い始まりは
   * 文書の終わりまで (§6.13.2)、組になる始まりの無い終わりは無視する (§6.13.3)。
   * 線の色・太さ・間隔・側・線種は、始まりの要素での値 (§7.30.2〜§7.30.6 の注。どれも継承される)。
   * バーを引くのは、region-body の、条件の付かない参照領域の中の領域 (§6.13.2): fo:static-content・脚注の本体・前方の float・fo:marker の中には付けない
   */
  private prepareChangeBars(root: XEl) {
    const map = new WeakMap<XNode, RevisionBar[]>();
    this.barsAt = map;
    let active: RevisionBar[] = NO_BARS;
    // class ごとの、開いている始まり (内側が後ろ)。線を引かない始まり (change-bar-style="none") は undefined
    const open = new Map<string, Array<RevisionBar | undefined>>();
    const inh = (el: XEl, k: string) => this.inheritedAttr(el, k);
    const todo: Array<{ n: XNode; on: boolean }> = [{ n: root, on: false }];
    for (let t = todo.pop(); t; t = todo.pop()) {
      const { n } = t;
      if (n.nodeType !== 1) {
        if (t.on && active.length && (n.nodeType === 3 || n.nodeType === 4)) map.set(n, active);
        continue;
      }
      const el = n as XEl;
      const fo = this.isFo(el);
      const name = this.name(el);
      if (fo && name === 'instream-foreign-object') continue;
      if (fo && name === 'change-bar-begin') {
        const cls = this.attr(el, 'change-bar-class') ?? '';
        if (!this.attr(el, 'change-bar-class')) this.miss('fo:change-bar-begin (change-bar-class が無い)');
        if (this.attr(el, 'z-index') !== undefined) this.miss('z-index (fo:change-bar-begin)');
        const bar = this.changeBarOf(inh, el);
        const list = open.get(cls) ?? [];
        open.set(cls, list);
        list.push(bar);
        if (bar) active = [...active, bar];
        continue;
      }
      if (fo && name === 'change-bar-end') {
        const list = open.get(this.attr(el, 'change-bar-class') ?? '');
        if (!list?.length) {
          this.miss('fo:change-bar-end (組になる fo:change-bar-begin が無い)');
          continue;
        }
        const bar = list.pop();
        if (bar) active = active.filter((b) => b !== bar);
        if (!active.length) active = NO_BARS;
        continue;
      }
      const on = fo && name === 'flow' ? true : fo && (name === 'static-content' || name === 'footnote-body' || name === 'marker' || (name === 'float' && this.attr(el, 'float') === 'before')) ? false : t.on;
      if (on && active.length) map.set(el, active);
      const kids = Array.from(el.childNodes);
      for (let k = kids.length - 1; k >= 0; k--) todo.push({ n: kids[k], on });
    }
  }
  /** fo:change-bar-begin の線 (§7.30.2〜§7.30.6)。change-bar-style が none・hidden (初期値は none) なら引かない */
  private changeBarOf(inh: (el: XEl, k: string) => string | undefined, el: XEl): RevisionBar | undefined {
    const style = inh(el, 'change-bar-style') ?? 'none';
    if (style === 'none' || style === 'hidden') return undefined;
    const rb: RevisionBar = { color: this.color(inh(el, 'change-bar-color')) ?? this.color(inh(el, 'color')) ?? '#000000', changeBar: true };
    if (['dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset'].includes(style)) rb.style = style as RevisionBar['style'];
    else if (style !== 'solid') this.miss(`change-bar-style="${style}"`);
    // 太さと間隔に、相対の長さ (百分率・em) は書けない (§7.30.3・§7.30.6 の注)。書いてあれば、初期値にして報告する
    const abs = (k: string, v: string | undefined) => {
      if (v === undefined) return undefined;
      if (/%|em\b/.test(v)) {
        this.miss(`${k}="${v}"`);
        return undefined;
      }
      return this.len(v, 0);
    };
    const w = inh(el, 'change-bar-width') ?? 'medium';
    const kw = this.borderKeywords;
    rb.width = w === 'thin' || w === 'medium' || w === 'thick' ? kw[w] : (abs('change-bar-width', w) ?? kw.medium);
    rb.offset = abs('change-bar-offset', inh(el, 'change-bar-offset')) ?? 6;
    const pl = inh(el, 'change-bar-placement') ?? 'start';
    if (pl === 'start' || pl === 'end' || pl === 'left' || pl === 'right' || pl === 'inside' || pl === 'outside' || pl === 'alternate') rb.position = pl;
    else this.miss(`change-bar-placement="${pl}"`);
    // 縦書きでは、段の左・右の端はバーを引く端 (行の始め・終わり = 上・下) に当たらない。始め・終わりの端として扱う
    if (rb.position === 'left' || rb.position === 'right') {
      const wm = this.wmOf(inh(el, 'writing-mode') ?? '');
      if (wm && wm !== 'horizontal-tb') this.miss(`change-bar-placement="${pl}" (縦書き)`);
    }
    return rb;
  }
  private indexParents(root: XEl) {
    // 再帰でなく、積んだ一覧でたどる (深い入れ子でも呼び出しの深さを使わない)。深すぎる入れ子 (MAX_FO_NEST) は、ここで誤りにする
    // fo:instream-foreign-object の中身 (MathML・SVG) は、FO の要素としては読まないので数えない (それぞれの読み方に深さの上限がある)
    const todo: Array<{ el: XEl; depth: number; foreign: boolean }> = [{ el: root, depth: 0, foreign: false }];
    for (let t = todo.pop(); t; t = todo.pop()) {
      if (t.depth >= MAX_FO_NEST) throw tooDeep();
      const foreign = t.foreign || (this.isFo(t.el) && this.name(t.el) === 'instream-foreign-object');
      for (const c of this.els(t.el)) {
        this.parents.set(c, t.el);
        if (!this.hasChangeBars && (c.localName === 'change-bar-begin' || c.localName === 'change-bar-end') && this.isFo(c)) this.hasChangeBars = true;
        todo.push({ el: c, depth: foreign ? t.depth : t.depth + 1, foreign });
      }
    }
  }

  /**
   * reference-orientation (反時計回りの度数)。90 の倍数以外は 0 として報告する。
   * inherit は親の要素の計算値 (XSL 1.1 §5.9.10.1: “The property takes the same computed value as the property for the formatting object's parent object.”)。
   * reference-orientation は継承しない性質 (§7.21.3 Inherited: no) なので、親に指定が無ければ初期値の 0
   */
  refOrientation(el: XEl): Rotation {
    const v = this.attr(el, 'reference-orientation');
    if (v === 'inherit') {
      const p = this.parents.get(el);
      return p ? this.refOrientation(p) : 0;
    }
    if (!v || v === 'from-page-master-region()') return 0;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n % 90 !== 0) {
      this.miss(`reference-orientation:${v}`);
      return 0;
    }
    return ((((n % 360) + 360) % 360) as Rotation);
  }

  /**
   * <angle> (§5.11: 符号・数・単位 deg / grad / rad。“The specified values are normalized to the range 0deg to 360deg.”) を、
   * 0・90・180・270 度の最も近い値に丸める (§7.29.2・§7.29.3: “The User Agent shall round the value of the angle to the closest
   * of the permitted values.”)。<angle> として読めなければ undefined
   */
  private angle90(v: string): 0 | 90 | 180 | 270 | undefined {
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad)$/.exec(v.trim());
    if (!m) return undefined;
    const deg = parseFloat(m[1]) * (m[2] === 'grad' ? 0.9 : m[2] === 'rad' ? 180 / Math.PI : 1);
    const n = ((deg % 360) + 360) % 360;
    return ((Math.round(n / 90) % 4) * 90) as 0 | 90 | 180 | 270;
  }

  // ── 長さ・色 ──
  len(v: string | undefined, fs: number, pct?: number, lh?: number): number | undefined {
    if (!v) return undefined;
    // §5.9 の式 (演算子の優先順位・括弧・数の関数) として評価する
    const r = evalLength(v.trim(), { fs, ...(pct !== undefined ? { pct } : {}), ...(lh !== undefined ? { lh } : {}) });
    // 読めない性質の値の関数 (§5.10.4 の from-parent など) は、黙って捨てずに報告する
    if (r === undefined) {
      const fn = /\b(from-parent|inherited-property-value|from-nearest-specified-value|from-table-column|merge-property-values)\s*\(/.exec(v);
      if (fn) this.miss(`function:${fn[1]}()`);
    }
    return r;
  }

  /**
   * 寸法の下限・上限の指定 (属性の値)。絶対の min-height・max-height・min-width・max-width (§7.15.8〜§7.15.11) は、書字方向で
   * block-progression-dimension か inline-progression-dimension の .minimum・.maximum に当たる (XSL 1.1 §5.3.3: block の進む向きが
   * 上下なら height の組が block、width の組が inline。左右なら逆)。絶対の指定があればそれを使い、無ければ相対の成分。
   * max-* の none は上限なし (“if "max-height" is specified as "none", reset: block-progression-dimension.maximum=auto”)
   */
  private dimLimit(el: XEl, wm: WritingMode, axis: 'inline' | 'block', which: 'minimum' | 'maximum'): string | undefined {
    const abs = this.attrInh(el, `${which === 'minimum' ? 'min' : 'max'}-${(wm === 'horizontal-tb') === (axis === 'block') ? 'height' : 'width'}`);
    if (abs !== undefined) return abs === 'none' || abs === 'auto' ? undefined : abs;
    return this.attr(el, `${axis}-progression-dimension.${which}`);
  }

  /** 包含ブロックの inline 方向の寸法 (百分率の基準) */
  private cbW(ctx: Ctx): number | undefined {
    return ctx.cbW ?? ctx.width;
  }

  /** その要素の行の高さ (pt。lh 単位の基準) */
  private lineHeightOf(ctx: Ctx): number {
    return ctx.inh?.lineHeightPt ?? (ctx.inh?.lineHeight ?? this.defaultLineHeight) * ctx.fontSize;
  }

  color(v: string | undefined): string | undefined {
    if (!v) return undefined;
    const s = v.trim();
    if (s === 'transparent' || s === 'none' || s === '') return undefined;
    // inherit は親の値 (値を設定しなければ継承される)。未対応の色として報告しない
    if (s === 'inherit') return undefined;
    // rgb-icc(r,g,b,#profile,成分...): #CMYK プロファイルなら CMYK 値をそのまま使う (印刷向け)。それ以外は代替 RGB を使う
    const icc = /^rgb-icc\(([^)]*)\)$/i.exec(s);
    if (icc) {
      const p = icc[1].split(',').map((x) => x.trim());
      if (/^#?cmyk$/i.test(p[3] ?? '') && p.length >= 8) return `cmyk(${p.slice(4, 8).join(',')})`;
      // 特色 (アンテナハウスの #Separation): 使う人が渡した特色の値があれば、特色にする
      if (/^#separation$/i.test(p[3] ?? '') && p.length >= 5) {
        const name = p[4].replace(/^["']|["']$/g, '');
        const sp = this.opts.spotColors?.[name];
        const tint = p.length >= 6 ? parseFloat(p[p.length - 1]) : 1;
        if (sp) return spotColor(name, Number.isFinite(tint) ? tint : 1, sp);
      }
      const ch = p.slice(0, 3).map((x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
      if (ch.every((x) => Number.isFinite(x))) return `rgb(${ch.map((x) => Math.min(255, Math.max(0, Math.round(x)))).join(',')})`;
    }
    if (/^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(|cmyk\()/i.test(s) || isColorName(s)) return s;
    this.miss(`color:${s.slice(0, 20)}`);
    return undefined;
  }

  // ───────────────────────── ルート ─────────────────────────

  /**
   * retrieve-marker ごとに、同じ class の marker の中身を、retrieve-marker の位置の文脈 (祖先の性質) で読み直す (§6.13.6 Trait Derivation)。
   * marker 自身とその祖先の性質は引き継がない (§6.13.5 の注)
   */
  private resolveMarkerVariants() {
    // 回す範囲は先に控える (読み直しの途中で retrieves・markerEls が増えても、回す数は変わらない)
    const retrieves = this.retrieves.slice();
    const markers = this.markerEls.slice();
    for (const { r, ctx } of retrieves) {
      const variants: Record<number, Array<LBlockLevel | LInlineLevel>> = {};
      for (const { el, mk } of markers) if (mk.className === r.className && mk.key !== undefined) variants[mk.key] = this.markerChildren(el, ctx);
      if (Object.keys(variants).length) r.variants = variants;
    }
  }
  /**
   * fo:initial-property-set (XSL 1.1 §6.6.4): ブロックの最初の行に入った子を、この要素の書式の fo:inline で包んだものとして組む (Trait Derivation)。
   * ブロックの最初の行内の並び (最初の fo:marker の後ろから、最初のブロックの子の前まで) を、最初の行にだけ書式を当てる inline (LInline.firstLine。
   * CSS の ::first-line と同じ受け皿) で包む。当てるのは、字の書式 (書体・大きさ・太さ・傾き・幅、color、letter-spacing、word-spacing、
   * text-decoration) と background-color。
   * text-transform と font-variant は、読み込みのときに字を置き換えて作るので、最初の行にだけは当てられない。line-height は、行内の要素の
   * line-height を行の高さに数える受け皿が組版に無い。罫線・余白 (行の途中で終わる箱)・相対位置・text-shadow・score-spaces とともに、読まずに報告する。em の長さは、ブロックの字の大きさが基準 (子が自分で持つ em の値は、
   * 最初の行でもブロックの字の大きさが基準のまま)
   */
  private firstLineOf(blk: LBlock, ips: XEl, ctx: Ctx) {
    const kids = blk.children;
    const typeOf = (k: LBlockLevel | LInlineLevel | undefined) => (k === undefined ? undefined : typeof k === 'string' ? 'text' : (k as { type: string }).type);
    let a = 0;
    while (typeOf(kids[a]) === 'marker') a++;
    let b = a;
    const blockish = (k: LBlockLevel | LInlineLevel) => ['block', 'table', 'block-container', 'float', 'marker', 'retrieve-marker', 'retrieve-table-marker'].includes(typeOf(k)!);
    while (b < kids.length && !blockish(kids[b])) b++;
    // 最初の行内の並びが無い (ブロックの子から始まる)
    if (b === a) return;
    // 並びを分けない子 (回り込み・絶対配置の箱) が途中にあると、並びの全体を 1 つの inline で包めない
    const next = kids[b] as { type?: string; absolutePosition?: boolean } | undefined;
    if (next && (next.type === 'float' || next.type === 'marker' || (next.type === 'block-container' && next.absolutePosition))) {
      this.miss('fo:initial-property-set (最初の行の並びの途中に fo:float・絶対配置の箱がある)');
      return;
    }
    const has = (k: string) => ips.hasAttribute?.(k) ?? this.attr(ips, k) !== undefined;
    for (const k of ['text-transform', 'font-variant', 'line-height', 'text-shadow', 'score-spaces', 'relative-position', 'position']) if (has(k)) this.miss(`${k} (fo:initial-property-set)`);
    const names = Array.from(ips.attributes ?? []).map((x) => x.name);
    if (names.some((k) => /^border(-|$)/.test(k))) this.miss('border (fo:initial-property-set)');
    if (names.some((k) => /^padding(-|$)/.test(k))) this.miss('padding (fo:initial-property-set)');
    if (names.some((k) => /^background-(image|repeat|position|attachment)/.test(k) || k === 'background')) this.miss('background-image (fo:initial-property-set)');
    const { style, ctx: c2 } = this.textStyle(ips, { ...ctx, textTransform: undefined, smallCaps: undefined } as Ctx);
    const wrap: LInline = { type: 'inline', firstLine: true, children: kids.slice(a, b) as LInlineLevel[] };
    const st = style as Record<string, unknown>;
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'color', 'letterSpacing', 'letterSpacingStretch', 'fixedLetterSpacing', 'xslLetterSpacing', 'wordSpacing', 'textDecoration'])
      if (st[k] !== undefined) (wrap as unknown as Record<string, unknown>)[k] = st[k];
    const bg = c2.hidden ? undefined : this.color(this.attr(ips, 'background-color'));
    if (bg) wrap.backgroundColor = bg;
    kids.splice(a, b - a, wrap);
  }
  /** fo:marker を読む (読んだ要素は markerEls に控える) */
  private marker(n: XEl, ctx: Ctx): LMarker {
    const { ctx: c2 } = this.textStyle(n, ctx);
    const mk: LMarker = { type: 'marker', className: this.attr(n, 'marker-class-name') ?? '', children: this.markerChildren(n, c2), key: this.markerEls.length };
    this.markerEls.push({ el: n, mk });
    return mk;
  }
  /** fo:marker の中身を読む (中の fo:retrieve-marker・fo:marker は読まない。flowChild の marker・retrieve-marker の所を参照) */
  private markerChildren(el: XEl, ctx: Ctx): Array<LBlockLevel | LInlineLevel> {
    this.inMarker++;
    try {
      return this.children(el, ctx);
    } finally {
      this.inMarker--;
    }
  }

  // ── ページ番号の前後の字 (fo:folio-prefix・fo:folio-suffix。XSL 1.1 §6.6.13・§6.6.14) ──
  /** id → その id の要素を含む fo:page-sequence (最初と最後)。fo:folio-prefix・fo:folio-suffix のある文書でだけ作る */
  private idSeqs?: Map<string, { first: XEl; last: XEl }>;
  /** fo:folio-prefix・fo:folio-suffix を持つ fo:page-sequence (文書の中の順) */
  private folioSeqs: XEl[] = [];
  /** fo:folio-prefix・fo:folio-suffix の中身を読んでいる間の、その要素の名前 */
  private inFolio?: string;
  /** 読み込みの報告に数え終えた fo:folio-prefix・fo:folio-suffix (ページ番号ごとに読み直すので、2 度目からは数えない) */
  private countedFolios = new Set<XEl>();

  /** fo:page-sequence の子の fo:folio-prefix・fo:folio-suffix (それぞれ最初の 1 つ。内容モデルは folio-prefix?,folio-suffix? §6.4.5) */
  private folioEls(seq: XEl): { prefix?: XEl; suffix?: XEl } {
    const of = (name: string) => this.els(seq).find((e) => this.isFo(e) && this.name(e) === name);
    return { prefix: of('folio-prefix'), suffix: of('folio-suffix') };
  }

  /** 文書の id と、それを含む fo:page-sequence の対応を作る (fo:folio-prefix・fo:folio-suffix が 1 つも無ければ作らない) */
  private indexFolios(seqs: XEl[]) {
    this.folioSeqs = seqs.filter((ps) => this.folioEls(ps).prefix || this.folioEls(ps).suffix);
    if (!this.folioSeqs.length) return;
    const map = new Map<string, { first: XEl; last: XEl }>();
    const note = (el: XEl, ps: XEl) => {
      const id = this.attr(el, 'id');
      if (!id) return;
      const e = map.get(id);
      if (e) e.last = ps;
      else map.set(id, { first: ps, last: ps });
    };
    for (const ps of seqs) {
      // fo:page-sequence を包む要素 (fo:root・fo:page-sequence-wrapper) の id は、中の最初・最後の page-sequence
      for (let a = this.parents.get(ps); a; a = this.parents.get(a)) note(a, ps);
      const todo: XEl[] = [ps];
      for (let el = todo.pop(); el; el = todo.pop()) {
        note(el, ps);
        todo.push(...this.els(el));
      }
    }
    this.idSeqs = map;
  }

  /**
   * ページ番号の字の前後に、fo:folio-prefix・fo:folio-suffix の中身を付ける (XSL 1.1 §6.6.10: ページ番号の行内の領域の中身は、
   * “the content of any fo:folio-prefix child of the reference-page-sequence, followed by fo:character flow objects; one for each
   * character in the folio-number string …, followed by the content of any fo:folio-suffix child of the reference-page-sequence”)。
   * seq は基準の page-sequence: fo:page-number はそれを含む page-sequence (§6.6.10)、fo:page-number-citation・-last は引いたページを
   * 作った page-sequence (§6.6.11・§6.6.12)。中身は、ページ番号の位置の書式 (ctx) で読む。付けるものが無ければ undefined
   */
  private withFolio(num: LInlineLevel, seq: XEl | undefined, ctx: Ctx): LInlineLevel[] | undefined {
    if (!this.idSeqs || !seq || this.inFolio) return undefined;
    const { prefix, suffix } = this.folioEls(seq);
    if (!prefix && !suffix) return undefined;
    return [...this.readFolio(prefix, ctx), num, ...this.readFolio(suffix, ctx)];
  }

  /** fo:folio-prefix・fo:folio-suffix の中身を、ページ番号の位置の書式 (ctx) で読む (読み込みの報告には、最初の 1 度だけ数える) */
  private readFolio(el: XEl | undefined, ctx: Ctx): LInlineLevel[] {
    if (!el) return [];
    const counted = this.countedFolios.has(el);
    this.countedFolios.add(el);
    const { counts, unsupported, droppedLinks, files } = this.report;
    const kept = counted ? structuredClone({ counts, unsupported, droppedLinks, files }) : undefined;
    this.inFolio = `fo:${this.name(el)}`;
    try {
      // 中身は字と行内の要素 (#PCDATA|%inline;)*。ブロックは element() が読まずに報告する
      return this.children(el, ctx, false) as LInlineLevel[];
    } finally {
      this.inFolio = undefined;
      if (kept) {
        this.report.counts = kept.counts;
        this.report.unsupported = kept.unsupported;
        if (kept.droppedLinks) this.report.droppedLinks = kept.droppedLinks;
        else delete this.report.droppedLinks;
        if (kept.files) this.report.files = kept.files;
        else delete this.report.files;
      }
    }
  }

  // ── 索引 (XSL 1.1 §6.10 Formatting Objects for Indexing・§7.24 Properties for Indexing) ──
  /** 索引の鍵 (index-key) の付いた要素 → その所 (LDocument.indexEntries の 1 つ)。同じ要素を読み直しても (marker の中身など) 1 つ */
  private indexEls = new Map<XEl, LIndexEntry>();
  /** fo:index-range-begin の id → その範囲 (組になる fo:index-range-end を待つ) */
  private indexRanges = new Map<string, LIndexEntry>();
  /** fo:index-range-end → 終わりの印の id (読み直しても同じ id) */
  private indexEnds = new Map<XEl, string>();
  private indexSeq = 0;
  /** fo:index-page-citation-list を読んだか (読んでいれば、鍵の付いた所が無くても LDocument.indexEntries を作る) */
  private indexListSeen = false;
  /** fo:folio-prefix・fo:folio-suffix を持つ fo:page-sequence → 番号 (LPageSequence.folioKey)。索引のページ番号が前後の字を引いたものだけ */
  private folioKeys = new Map<XEl, number>();
  /** fo:page-sequence → 読んだ結果 */
  private seqNodes = new Map<XEl, LPageSequence>();

  /**
   * index-key (§7.24.2) の付いた要素を、索引の鍵の付いた所として控え、その要素の id (無ければ作る) を返す。
   * id の置かれたページの記録 (ページ番号の参照と同じ仕組み) から、その要素の領域のあるページを引く。
   * index-class (§7.24.1) は “ignored on any formatting object for which an index-key property has not been specified”
   */
  private indexEntryOf(n: XEl, key: string, id: string | undefined): LIndexEntry {
    let e = this.indexEls.get(n);
    if (!e) {
      const cls = this.attr(n, 'index-class');
      e = { key, ...(cls ? { indexClass: cls } : {}), id: id || `kumiori-index-${++this.indexSeq}` };
      this.indexEls.set(n, e);
    }
    return e;
  }

  /** 継承される性質の値 (その要素か、指定のある最も近い祖先。索引の性質 §7.24.3〜§7.24.6 は Inherited: yes) */
  private inheritedAttr(n: XEl, k: string): string | undefined {
    for (let el: XEl | undefined = n; el; el = this.parents.get(el)) {
      const v = this.attrInh(el, k);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  /** 字と行内の要素だけを中身にできる索引の要素 (内容モデルは (#PCDATA|%inline;)*) の中身。ブロックは読まずに報告する */
  private indexInlineContent(el: XEl, ctx: Ctx): LInlineLevel[] {
    const { style, ctx: c2 } = this.textStyle(el, ctx);
    const kids = this.children(el, c2, false).filter((k) => {
      const block = typeof k !== 'string' && ['block', 'table', 'block-container', 'float', 'marker', 'retrieve-marker'].includes((k as { type: string }).type);
      if (block) this.miss(`fo:${(k as { type: string }).type} (fo:${this.name(el)} の中)`);
      return !block;
    }) as LInlineLevel[];
    return Object.keys(style).length ? [{ type: 'inline', ...style, children: kids } as LInline] : kids;
  }

  /**
   * fo:index-page-citation-list (§6.10.7): 子の fo:index-key-reference (§6.10.6) が引いたページを集めて、ページ番号の並びにする。
   * ページは組んでみないと分からないので、ここでは引く鍵・書式・区切り・前後の字を控えるだけで、並びは組版が作る
   * (内容モデルは (index-page-citation-list-separator?, index-page-citation-range-separator?, index-key-reference+))
   */
  private indexCitationList(n: XEl, ctx: Ctx): LInlineLevel {
    this.indexListSeen = true;
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const list: LIndexPageCitationList = { type: 'index-page-citation-list', references: [] };
    // merge-sequential-page-numbers・merge-ranges-across-index-key-references・merge-pages-across-index-key-references (§7.24.4〜§7.24.6):
    // 値は merge | leave-separate、初期値は merge、継承される
    const leave = (k: string) => {
      const v = this.inheritedAttr(n, k);
      if (v !== undefined && v !== 'merge' && v !== 'leave-separate') this.miss(`${k}:${v.slice(0, 20)}`);
      return v === 'leave-separate';
    };
    if (leave('merge-sequential-page-numbers')) list.mergeSequential = false;
    if (leave('merge-ranges-across-index-key-references')) list.mergeRangesAcrossReferences = false;
    if (leave('merge-pages-across-index-key-references')) list.mergePagesAcrossReferences = false;
    for (const c of this.els(n)) {
      const name = this.isFo(c) ? this.name(c) : '';
      // 区切りの字の書式は、区切りの要素から受け継ぐ (§6.10.7: “The traits of the fo:inline are inherited from the
      // fo:index-page-citation-list-separator”)。2 つ目からは読まない
      if (name === 'index-page-citation-list-separator' && !list.listSeparator) list.listSeparator = this.indexInlineContent(c, c2);
      else if (name === 'index-page-citation-range-separator' && !list.rangeSeparator) list.rangeSeparator = this.indexInlineContent(c, c2);
      else if (name === 'index-key-reference') {
        // ref-index-key (§7.24.7) は “Initial: none, value required”
        const refKey = this.attr(c, 'ref-index-key');
        if (refKey === undefined) {
          this.miss('fo:index-key-reference (ref-index-key が無い)');
          continue;
        }
        // ページ番号と前後の字の書式は、fo:index-key-reference から受け継ぐ (§6.10.7: “The traits of the fo:inline are inherited from R”)
        const { style: rs, ctx: cr } = this.textStyle(c, c2);
        const ref: LIndexKeyReference = { refKey };
        // page-number-treatment (§7.24.3): link | no-link。初期値 no-link、継承される
        const pnt = this.inheritedAttr(c, 'page-number-treatment');
        if (pnt === 'link') ref.link = true;
        else if (pnt !== undefined && pnt !== 'no-link') this.miss(`page-number-treatment:${pnt.slice(0, 20)}`);
        if (Object.keys(rs).length) ref.style = rs;
        for (const p of this.els(c)) {
          const pn = this.isFo(p) ? this.name(p) : '';
          if (pn === 'index-page-number-prefix' && !ref.prefix) ref.prefix = this.indexInlineContent(p, cr);
          else if (pn === 'index-page-number-suffix' && !ref.suffix) ref.suffix = this.indexInlineContent(p, cr);
          else this.missElement(p, this.isFo(p) ? `fo:${pn} (fo:index-key-reference の中)` : undefined);
        }
        // ページ番号は §6.6.10 の中身 (引いたページを作った page-sequence の fo:folio-prefix・番号・fo:folio-suffix。§6.10.7 の Step C:
        // “using the page referenced by the cited page item as the reference-page, and the fo:page-sequence that generated the
        // referenced page as the reference-page-sequence”)。どの page-sequence のページを引くかは組んでみないと分からないので、
        // 前後の字を持つ page-sequence ごとに、この位置の書式で読んでおく
        for (const ps of this.folioSeqs) {
          const { prefix, suffix } = this.folioEls(ps);
          let key = this.folioKeys.get(ps);
          if (key === undefined) this.folioKeys.set(ps, (key = this.folioKeys.size + 1));
          const pre = this.readFolio(prefix, cr);
          const suf = this.readFolio(suffix, cr);
          (ref.folios ??= {})[key] = { ...(pre.length ? { prefix: pre } : {}), ...(suf.length ? { suffix: suf } : {}) };
        }
        list.references.push(ref);
      } else this.missElement(c, name ? `fo:${name} (fo:index-page-citation-list の中)` : undefined);
    }
    return Object.keys(style).length ? ({ type: 'inline', ...style, children: [list] } as LInline) : list;
  }

  /**
   * 文書を読み終えてから: 鍵の付いた所を文書の中の順に並べて LDocument.indexEntries にする (索引を使わない文書では何もしない)。
   * index-key を書いたのに所として控えられなかった要素 (id を組版へ渡していない要素) と、組になる fo:index-range-end の無い範囲を報告する
   */
  private finishIndex(doc: LDocument, root: XEl) {
    if (!this.indexListSeen && !this.indexEls.size) return;
    const order = new Map<LIndexEntry, number>();
    const todo: XEl[] = [root];
    for (let el = todo.pop(); el; el = todo.pop()) {
      const e = this.indexEls.get(el);
      if (e) order.set(e, order.size);
      else if (this.isFo(el) && el.hasAttribute?.('index-key')) this.miss(`index-key (fo:${this.name(el)})`);
      const kids = this.els(el);
      for (let k = kids.length - 1; k >= 0; k--) todo.push(kids[k]);
    }
    doc.indexEntries = [...order.keys()];
    // “If there is no such fo:index-range-end, it is an error, and the implementation should recover by assuming the equivalent of a
    // matching fo:index-range-end at the end of the document.” (§6.10.4)
    for (const e of doc.indexEntries)
      if (e.range && e.endId === undefined) this.note(msg(`fo:index-range-begin id="${e.id}" と組になる fo:index-range-end がありません (文書の終わりまでを範囲にします)`, `fo:index-range-begin id="${e.id}" has no matching fo:index-range-end (the range extends to the end of the document)`));
    for (const [ps, key] of this.folioKeys) {
      const seq = this.seqNodes.get(ps);
      if (seq) seq.folioKey = key;
    }
  }

  convert(root: XEl): LDocument {
    const doc: LDocument = { type: 'document', sequences: [], spaceResolution: 'xsl' };
    this.indexParents(root);
    if (this.hasChangeBars) this.prepareChangeBars(root);
    const lms = this.els(root).find((e) => this.name(e) === 'layout-master-set');
    const masters = new Map<string, MasterInfo>();
    const seqMasters = new Map<string, XEl>();
    for (const m of lms ? this.els(lms) : []) {
      const n = this.name(m);
      if (n === 'simple-page-master') {
        const info = readPageMaster(this, m, root, lms);
        masters.set(info.name, info);
      } else if (n === 'page-sequence-master') seqMasters.set(this.attr(m, 'master-name') ?? '', m);
      // fo:flow-map など、読まない子は読み込みの報告に数える
      else this.missElement(m);
    }
    this.readPunctuationSpacing(root);
    // fo:page-sequence-wrapper (§6.4.6) は、中の page-sequence を順に組む (入れ子もよい)
    // axf:document-info (PDF の文書情報)
    const docInfo = (c: XEl) => {
      const key = this.attr(c, 'name');
      const value = this.attr(c, 'value') ?? '';
      if (key === 'title' || key === 'author' || key === 'subject' || key === 'keywords') (doc.info ??= {})[key] = value;
      if (key === 'title' && value) doc.title = value;
    };
    const sequencesOf = (el: XEl): XEl[] => this.els(el).flatMap((c) => (this.name(c) === 'page-sequence-wrapper' ? sequencesOf(c) : [c]));
    this.indexFolios(sequencesOf(root).filter((c) => this.name(c) === 'page-sequence'));
    for (const c of sequencesOf(root)) {
      const n = this.name(c);
      if (n === 'page-sequence') {
        const seq = this.pageSequence(c, masters, seqMasters, root);
        if (seq) {
          doc.sequences.push(seq);
          this.seqNodes.set(c, seq);
        }
      } else if (n === 'layout-master-set') {
        /* 上で読んだ */
      } else if (n === 'declarations') {
        // fo:declarations の子: axf:document-info (置き場所は fo:declarations の子) と、約物のアキ (readPunctuationSpacing が読む)。
        // fo:color-profile などの読まない子は、読み込みの報告に数える
        for (const d of this.els(c)) {
          const dn = this.name(d);
          if (dn === 'document-info' && !this.isFo(d)) docInfo(d);
          else if (!this.isFo(d) && PUNCT_SPACING_ELEMENTS.has(dn)) continue;
          else this.missElement(d);
        }
      } else if (n === 'document-info') {
        docInfo(c);
      } else if (n === 'bookmark-tree') {
        doc.bookmarks = [...(doc.bookmarks ?? []), ...this.bookmarks(c)];
      } else if (this.isFo(c)) this.miss(`fo:${n}`);
    }
    // axf:outline-level のついたブロックから作るしおり (outline-group ごとに別の木)
    if (this.outlines.length) doc.bookmarks = [...(doc.bookmarks ?? []), ...this.outlineTree()];
    this.resolveMarkerVariants();
    this.finishIndex(doc, root);
    this.report.counts.sequences = doc.sequences.length;
    if (!doc.sequences.length) this.note(msg('page-sequence が見つかりませんでした', 'no page-sequence was found'));
    return doc;
  }

  // ───────────────────────── ページマスター (読み取りは foPageMaster.ts の readPageMaster) ─────────────────────────

  /** writing-mode (§7.29.7)。lr / tb は lr-tb / tb-rl の略。下から上へ・行ごとに向きの変わる値は、横・縦で組んで軸を裏返す (flipOf)。
   *  from-page-master-region() (§5.10.4) はリージョンの指定に従う (値を決めない) */
  wmOf(v: string): WritingMode | undefined {
    if (v === 'from-page-master-region()') return undefined;
    if (v === 'tb-rl' || v === 'tb' || v === 'vertical-rl' || v === 'bt-rl') return 'vertical-rl';
    if (v === 'tb-lr' || v === 'vertical-lr' || v === 'bt-lr' || v === 'tb-lr-in-lr-pairs') return 'vertical-lr';
    if (v === 'lr-tb' || v === 'lr' || v === 'horizontal-tb' || v === 'rl-tb' || v === 'rl' || v === 'lr-bt' || v === 'rl-bt' || /^lr-(alternating|inverting)-rl-(bt|tb)$/.test(v)) return 'horizontal-tb';
    if (v && v !== 'inherit') this.miss(`writing-mode:${v}`);
    return undefined;
  }

  // ───────────────────────── page-sequence ─────────────────────────

  private pageSequence(ps: XEl, masters: Map<string, MasterInfo>, seqMasters: Map<string, XEl>, root: XEl): LPageSequence | undefined {
    const ref = this.attr(ps, 'master-reference') ?? '';
    // 参照先 (simple-page-master か page-sequence-master) から、既定マスターと条件付き候補を決める
    let def = masters.get(ref);
    const alts: { when: ConditionalPageMaster['when']; info: MasterInfo }[] = [];
    const sm = seqMasters.get(ref);
    // page-sequence-master の部分列 (§6.4.8-6.4.11): 順序・maximum-repeats・条件 (blank-or-not-blank を含む) をそのまま保つ
    const seqItems: Array<{ kind: 'single' | 'repeatable' | 'alternatives'; maxRepeats?: number; entries: { when: ConditionalPageMaster['when']; info: MasterInfo }[] }> = [];
    if (!def && sm) {
      let k = 0;
      for (const c of this.els(sm)) {
        const n = this.name(c);
        const entries: { when: ConditionalPageMaster['when']; info: MasterInfo }[] = [];
        const push = (r: XEl, when: ConditionalPageMaster['when']) => {
          const info = masters.get(this.attr(r, 'master-reference') ?? '');
          if (info) {
            alts.push({ when, info });
            entries.push({ when, info });
          }
        };
        const mr = this.attr(c, 'maximum-repeats');
        const maxRepeats = mr && mr !== 'no-limit' && Number.isFinite(parseInt(mr, 10)) ? parseInt(mr, 10) : undefined;
        if (n === 'single-page-master-reference') {
          push(c, { pagePosition: k === 0 ? 'first' : 'rest' });
          entries.forEach((e) => (e.when = {}));
          seqItems.push({ kind: 'single', entries });
        } else if (n === 'repeatable-page-master-reference') {
          push(c, {});
          seqItems.push({ kind: 'repeatable', maxRepeats, entries });
        } else if (n === 'repeatable-page-master-alternatives') {
          for (const r of this.els(c)) {
            const pos = this.attr(r, 'page-position');
            const oe = this.attr(r, 'odd-or-even');
            const bn = this.attr(r, 'blank-or-not-blank');
            const when: ConditionalPageMaster['when'] = {};
            if (pos === 'first' || pos === 'last' || pos === 'rest' || pos === 'only') when.pagePosition = pos;
            if (oe === 'odd' || oe === 'even') when.oddOrEven = oe;
            if (bn === 'blank' || bn === 'not-blank') when.blankOrNotBlank = bn;
            push(r, when);
          }
          seqItems.push({ kind: 'alternatives', maxRepeats, entries });
        }
        k++;
      }
      // 既定のマスター (百分率の基準・flow の幅・条件に合う候補が無いときの後備): 白ページ (blank-or-not-blank="blank") の候補は選ばない
      // (白ページ用のマスターを alternatives の先頭に置く書き方が多い)。条件の無い候補 → rest の候補 → 最初の白ページでない候補 → 先頭
      const notBlank = (a: { when: ConditionalPageMaster['when'] }) => a.when.blankOrNotBlank !== 'blank';
      def = (
        alts.find((a) => notBlank(a) && !a.when.pagePosition && !a.when.oddOrEven) ??
        alts.find((a) => notBlank(a) && a.when.pagePosition === 'rest') ??
        alts.find(notBlank) ??
        alts[0]
      )?.info;
    }
    if (!def) {
      this.note(msg(`master-reference "${ref}" が見つかりません`, `master-reference "${ref}" was not found`));
      return undefined;
    }
    const seqWm = this.wmOf(this.attr(ps, 'writing-mode') ?? '');
    const wm = seqWm ?? def.bodyWm ?? 'horizontal-tb';
    // XSL-FO の既定値 (font-size=medium=10pt, line-height=normal, text-align=start。互換モードの値。既定では両端揃えにしない) を土台に、fo:root → page-sequence の順で重ねる。
    // Kumiori の既定 (10.5pt・行送り 1.7・両端揃え) をそのまま使うと、FO の文書が想定する文字の大きさ・行送り・字間とずれる。
    const ctxRoot: Ctx = { seqEl: ps, fontSize: this.defaultFontSize, wm, startIndent: 0, endIndent: 0, refOrigin: def.bodyOrigin, refSize: def.bodySize, pageSize: { w: def.pageW, h: def.pageH }, cbH: def.bodySize.h, ws: WS_INITIAL, rtl: !seqWm && !!def.bodyRtl, flip: flipOf(this.attr(ps, 'writing-mode') ?? def.bodyWmAttr ?? '') };
    const rootStyle = this.textStyle(root, ctxRoot, true);
    const style = this.textStyle(ps, rootStyle.ctx, true);
    // fo:page-sequence に書いた継承される特性 (text-transform・font-family・color・xml:lang・relative-align・改訂バーなど) は、
    // fo:root のものに重ねて中へ伝える (XSL 1.1 §5.1.4: 継承される特性はどの要素にも書け、親から子へ伝わる)
    const ctx: Ctx = style.ctx;
    const baseStyle: TextStyle = {
      fontSize: this.defaultFontSize,
      lineHeight: this.defaultLineHeight,
      textAlign: 'start',
      textIndent: 0,
      // 行末の約物のぶら下げは既定で行わない (axf:hanging-punctuation の初期値は none。指定の無い段落は「句読/点」と送ってぶら下げない)
      hangingPunctuation: false,
      // 行番号の字の大きさの既定は medium (互換モードでは本文の大きさによらず 10pt)
      ...(this.spec ? {} : { lineNumber: { fontSize: this.defaultFontSize } }),
      // 行の高さは、字ごとの書体の上下の高さに line-height を割り振って決める (互換モード。和欧混在の行が少し広がる)
      fontLineMetrics: !this.spec,
      // 仕様モード: 代わりの書体 (和文の書体で組んだ字) の行の高さ・基線は、最初に使える書体の上下で決める
      // (欧文だけの行と和文を含む行で、表の隣のセルの基線がそろう)
      ...(this.spec ? { primaryFontMetrics: true } : {}),
      // 和欧間アキ・約物の連続の詰め (互換モードの既定。仕様モードでは行わない)
      textAutospace: !this.spec,
      punctuationSqueeze: !this.spec,
      // 追込みで詰める量 (語間・約物・和欧間のアキの合計) は 1 行に二分 (約物 1 つ分) まで (互換モード。inlineLayout の squeezeCap)
      ...(this.spec ? {} : { lineSqueezeMax: 0.5 }),
      // 行頭の始め括弧類の前のアキ: axf:punctuation-trim の指定が無ければ、段落の 1 行目の先頭だけ詰める。
      // 段落の途中で折り返した行の先頭は詰めない (互換モードの既定)
      punctuationTrimParagraphStart: !this.spec,
      // 行末の終わり括弧類・句読点の後ろの二分アキは捨てる (互換モードの既定。右寄せ・中央揃えの行は、
      // 行末の 。 の字面が枠の端に来る / 二分の半分だけ右へ寄る)
      punctuationTrimEnd: !this.spec,
      // 小書き仮名・長音記号は行頭に置いてよい (axf:line-break の初期値 normal。
      // 「ドキ／ュメント」「ペ／ージ」「フ／ォーマット」と分けてよい。
      // 繰返し記号は、normal でも行頭禁則 (UAX #14 の NS))
      looseLineStart: !this.spec,
      rubyOverhang: !this.spec,
      ...(ctxRoot.rtl ? { direction: 'rtl' as const } : {}),
      ...rootStyle.style,
      ...style.style,
    };
    // 行番号の指定は、既定 (字の大きさ) に root・page-sequence の指定を重ねる (丸ごと置き換えない)
    if (!this.spec && (rootStyle.style.lineNumber || style.style.lineNumber))
      baseStyle.lineNumber = { fontSize: this.defaultFontSize, ...rootStyle.style.lineNumber, ...style.style.lineNumber };

    const statics = this.els(ps).filter((e) => this.name(e) === 'static-content');
    const flowEl = this.els(ps).find((e) => this.name(e) === 'flow');
    // 読まずに捨てる子 (fo:title・2 つ目からの fo:flow など) は、読み込みの報告に数える。
    // 約物のアキの宣言 (readPunctuationSpacing が読む) は除く。fo:folio-prefix・fo:folio-suffix (最初の 1 つずつ) は、ページ番号の所で読む (withFolio)
    const folio = this.folioEls(ps);
    for (const e of this.els(ps)) {
      const en = this.name(e);
      if (en === 'static-content' || e === flowEl || e === folio.prefix || e === folio.suffix) continue;
      if (!this.isFo(e) && PUNCT_SPACING_ELEMENTS.has(en)) continue;
      this.missElement(e, en === 'flow' && this.isFo(e) ? `flow:${this.attr(e, 'flow-name') ?? ''}` : undefined);
    }
    // 使用するマスター (既定 + 条件付き) のどれにも無いリージョン名の static-content だけを「未対応」と数える
    const known = new Set<string>();
    for (const info of [def, ...alts.map((a) => a.info)]) for (const k of info.regionRects.keys()) known.add(k);
    let sepEl: XEl | undefined;
    let bfSepEl: XEl | undefined;
    for (const sc of statics) {
      const fname = this.attr(sc, 'flow-name') ?? '';
      if (fname === 'xsl-footnote-separator') sepEl = sc;
      else if (fname === 'xsl-before-float-separator') bfSepEl = sc;
      else if (!known.has(fname)) this.miss(`static-content:${fname}`);
    }
    // static-content は、リージョンの寸法・向きがマスターごとに違うので、マスターごとに読み直す。
    // 読み込みの報告の数 (counts・unsupported・droppedLinks・files) は文書に書かれた要素の数なので、同じ static-content の 2 度目からは数えない
    const countedStatics = new Set<XEl>();
    const staticChildren = (sc: XEl, c: Ctx): Array<LBlockLevel | LInlineLevel> => {
      if (!countedStatics.has(sc)) {
        countedStatics.add(sc);
        return this.children(sc, c);
      }
      const { counts, unsupported, droppedLinks, files } = this.report;
      const kept = structuredClone({ counts, unsupported, droppedLinks, files });
      try {
        return this.children(sc, c);
      } finally {
        this.report.counts = kept.counts;
        this.report.unsupported = kept.unsupported;
        if (kept.droppedLinks) this.report.droppedLinks = kept.droppedLinks;
        else delete this.report.droppedLinks;
        if (kept.files) this.report.files = kept.files;
        else delete this.report.files;
      }
    };
    const staticFor = (info: MasterInfo): LBlockContainer[] => {
      const out: LBlockContainer[] = info.regionBgs.map((b) => ({
        type: 'block-container' as const,
        absolutePosition: true,
        layer: 'behind' as const,
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        backgroundColor: b.color,
        ...(b.image ? { backgroundImage: b.image } : {}),
        // リージョンの罫線は、リージョンの矩形の内側に描く
        ...(b.border ? { border: b.border, boxSizing: 'border-box' as const } : {}),
        children: [],
      }));
      for (const sc of statics) {
        const fname = this.attr(sc, 'flow-name') ?? '';
        const r = info.regionRects.get(fname);
        if (!r) continue;
        if (r.w <= 0 || r.h <= 0) continue;
        // リージョンは、自身の writing-mode と reference-orientation を持つ (page-sequence の from-page-master-region() = リージョンの指定に従う)。
        // writing-mode の既定は、page-sequence が明示していればその値、無ければ横書き (本文が縦書きでも、ヘッダ等は横書き)。
        const rwm = r.wm ?? seqWm ?? 'horizontal-tb';
        const ro = r.ro ?? 0;
        const odd = ro === 90 || ro === 270;
        const lw = odd ? r.h : r.w; // 回転前の局所の幅・高さ
        const lh = odd ? r.w : r.h;
        // static-content 自身の継承される性質 (font-size など) は、中の要素へ引き継ぐ
        const scs = this.textStyle(sc, { ...ctx, inStatic: true, wm: rwm, refOrigin: { x: r.x, y: r.y }, refSize: { w: lw, h: lh }, width: rwm === 'horizontal-tb' ? lw : lh, cbW: rwm === 'horizontal-tb' ? lw : lh, cbH: lh });
        const c = staticChildren(sc, scs.ctx);
        const cont: LBlockContainer = { type: 'block-container', absolutePosition: true, left: r.x, top: r.y, width: lw, height: lh, ...scs.style, writingMode: rwm, children: c };
        if (ro) cont.rotation = ro;
        if (r.clip) cont.overflow = 'hidden';
        if (r.align === 'center') cont.blockAlign = 'center';
        else if (r.align === 'after') cont.blockAlign = 'end';
        out.push(cont);
      }
      return out;
    };

    // page-sequence の reference-orientation (数値) は、本文 (region-body) の向きを上書きする。from-page-master-region() は region-body の指定に従う
    // inherit は親 (fo:root など) の計算値を数値として使う (§5.9.10.1)
    const psRo = this.attr(ps, 'reference-orientation');
    const seqRo = psRo && (/^-?\d+$/.test(psRo) || psRo === 'inherit') ? this.refOrientation(ps) : undefined;
    // ページの背景画像 (アンテナハウス拡張: page-sequence の axf:background-image など)
    const seqBg = this.backgroundImage(ps, ctx, 'axf:');
    const rotated = (m0: PageMaster): PageMaster => {
      const m = seqBg ? { ...m0, backgroundImage: seqBg } : m0;
      if (seqRo === undefined) return m;
      const { bodyRotation: _r, ...rest } = m;
      void _r;
      return seqRo ? { ...rest, bodyRotation: seqRo } : rest;
    };
    const seq: LPageSequence = {
      type: 'page-sequence',
      // id (§7.30.8): ページ番号の参照 (§6.6.11・§6.6.12) では、この page-sequence の作った最初・最後のページを指す
      ...this.idOf(ps),
      discardLeadingSpace: true,
      ...baseStyle,
      ...(style.style.writingMode ? { writingMode: style.style.writingMode } : {}),
      master: rotated(def.master),
      staticContent: staticFor(def),
      flow: { type: 'flow', writingMode: wm, children: [] },
    };
    if (alts.length) {
      seq.masterAlternatives = alts.map((a) => ({ when: a.when, master: rotated(a.info.master), staticContent: staticFor(a.info) }));
    }
    if (seqItems.length) {
      seq.masterSequence = seqItems.map((it) => ({
        kind: it.kind,
        ...(it.maxRepeats !== undefined ? { maxRepeats: it.maxRepeats } : {}),
        masters: it.entries.map((e) => ({ when: e.when, master: rotated(e.info.master), staticContent: staticFor(e.info) })),
      }));
    }
    const sepBodyW = def.pageW - (def.master.margins.left + def.master.margins.right) * PT_PER_MM;
    if (bfSepEl) seq.beforeFloatSeparator = this.children(bfSepEl, { ...ctx, width: sepBodyW });
    // 区切りに、組む内容 (leader・文字・画像・背景・罫線) があるか
    const sepHasContent = (n: XEl): boolean =>
      (n.textContent ?? '').trim() !== '' ||
      !!this.attr(n, 'background-color') ||
      ['external-graphic', 'instream-foreign-object'].includes(this.name(n)) ||
      ['border', 'border-top', 'border-bottom', 'border-before', 'border-after', 'border-top-style', 'border-before-style'].some((k) => (this.attr(n, k) ?? 'none') !== 'none') ||
      this.name(n) === 'leader' ||
      this.els(n).some(sepHasContent);
    // 区切りの static-content が無ければ、区切り線を描かない (区切りは flow-name="xsl-footnote-separator" の static-content の内容で描く)
    if (!sepEl) seq.footnotes = { separator: false };
    else if (sepHasContent(sepEl)) {
      // 区切りの内容 (leader の線・点線、文字、画像など) を、そのまま脚注領域の区切りとして組む。
      // leader の点はフォントの字 (.) で、区切りのブロックの行の中に置く
      seq.footnotes = { separator: { content: this.children(sepEl, { ...ctx, width: sepBodyW }) } };
    } else {
      // 字・leader・画像・背景・罫線のどれも無い区切り (空のブロックだけなど): 区切りの指定を作らず、組むときの既定の区切り線に任せる
      this.note(msg('footnote-separator の内容は、区切り線の既定書式で代用しました', 'the content of footnote-separator was replaced by the default separator rule'));
    }
    // 脚注どうしの間は、本体の space-before / space-after だけ (FO には Kumiori の既定の 2pt のアキは無い)
    seq.footnotes = { ...seq.footnotes, spacing: 0 };
    // アンテナハウスの自動脚注番号の書式・初期値・振り直し
    const fnFmt = this.attr(ps, 'axf:footnote-number-format');
    const fnInit = parseInt(this.attr(ps, 'axf:footnote-number-initial') ?? '', 10);
    const fnReset = this.attr(ps, 'axf:footnote-number-reset');
    if (fnFmt || Number.isFinite(fnInit) || fnReset === 'page') {
      seq.footnotes = { ...seq.footnotes };
      if (fnFmt) seq.footnotes.format = fnFmt;
      if (Number.isFinite(fnInit)) seq.footnotes.startNumber = fnInit;
      if (fnReset === 'page') seq.footnotes.reset = 'page';
    }
    // initial-page-number (§7.27.7) と force-page-count (§7.27.6)
    const ipnAttr = this.attr(ps, 'initial-page-number');
    const ipn = parseInt(ipnAttr ?? '', 10);
    if (Number.isFinite(ipn)) seq.initialPageNumber = ipn;
    else if (ipnAttr === 'auto-odd' || ipnAttr === 'auto-even') seq.initialPageNumber = ipnAttr;
    // ページ番号の書式 (§7.26.1)
    const fmt = this.attr(ps, 'format');
    if (fmt && fmt !== '1') seq.pageNumberFormat = fmt;
    // 桁区切り (§7.26.2 grouping-separator・§7.26.3 grouping-size。XSLT 1.0 §7.7.1): 10 進の番号を、後ろから grouping-size 桁ごとに
    // grouping-separator (1 字) で区切る。片方だけの指定は無視する (“If only one of the grouping-separator and grouping-size attributes
    // is specified, then it is ignored.”)
    const gSep = ps.getAttribute?.('grouping-separator') ?? undefined;
    const gSizeAttr = this.attr(ps, 'grouping-size');
    if (gSep !== undefined && gSep !== '' && gSizeAttr !== undefined) {
      const gSize = Number(gSizeAttr);
      if ([...gSep].length !== 1) this.miss(`grouping-separator="${gSep}"`);
      else if (!Number.isInteger(gSize) || gSize < 1) this.miss(`grouping-size="${gSizeAttr}"`);
      else seq.pageNumberFormat = withGrouping(seq.pageNumberFormat, gSep, gSize);
    }
    // letter-value (§7.26.4): 字を使う番号の並びが 2 通りある言語で、どちらかを選ぶ (XSLT 1.0 §7.7.1)。対応している書式トークン
    // (a・A・i・I・一 など) には、同じトークンで 2 通りに読めるものが無いので、どの値でも結果は同じ。値だけを確かめる
    const lv = this.attr(ps, 'letter-value');
    if (lv !== undefined && lv !== 'auto' && lv !== 'alphabetic' && lv !== 'traditional') this.miss(`letter-value="${lv}"`);
    const fpc = this.attr(ps, 'force-page-count');
    if (fpc === 'auto' || fpc === 'even' || fpc === 'odd' || fpc === 'end-on-even' || fpc === 'end-on-odd' || fpc === 'no-force') seq.forcePageCount = fpc;
    // 数値 (アンテナハウスの拡張): そのページ数になるまで、末尾に白ページを足す
    else if (fpc && /^\d+$/.test(fpc.trim())) seq.forcePageCount = parseInt(fpc, 10);
    if (flowEl) {
      const bodyW = def.pageW - (def.master.margins.left + def.master.margins.right) * PT_PER_MM;
      // fo:flow の継承される性質 (font-family・axf:line-number-* など)
      const fst = this.textStyle(flowEl, ctx);
      // fo:flow の id は、本文の置かれた最初・最後のページを指す
      Object.assign(seq.flow, this.idOf(flowEl), fst.style, { writingMode: wm });
      // 段組のページ: 中の要素の幅 (百分率の基準) は 1 段の幅 (段は参照領域。段組のページの
      // inline-progression-dimension="50%" は、段の幅の半分)。段をまたぐ (span="all") ブロックは本文の幅
      const cols = def.master.columns;
      // 百分率の基準は、本文の参照領域の行の進む方向の寸法 (start-indent・text-indent などの百分率は
      // inline-progression-dimension に対する割合。§7.11.7・§7.16.11)。縦書きの本文は、本文の高さ。
      // 90 度・270 度回した本文 (reference-orientation。§7.21.3) は、幅と高さが入れ替わる (static-content の側と同じ)
      const bodyRo = seqRo ?? def.master.bodyRotation ?? 0;
      const turned = bodyRo === 90 || bodyRo === 270;
      const bodyH = def.pageH - (def.master.margins.top + def.master.margins.bottom) * PT_PER_MM;
      const bodyIpd = (wm === 'horizontal-tb') !== turned ? bodyW : bodyH;
      const colW = cols && cols.count > 1 && wm === 'horizontal-tb' ? Math.max(0, (bodyW - (cols.gap ?? 12 / PT_PER_MM) * PT_PER_MM * (cols.count - 1)) / cols.count) : bodyIpd;
      const flowKids = this.children(flowEl, { ...fst.ctx, wm, width: colW, cbW: colW, ...(colW !== bodyIpd ? { spanW: bodyW } : {}) }) as LBlockLevel[];
      // 入れ子のブロックの span="all" を効かせるのは互換モードだけ (仕様では fo:flow の直下のブロックにだけ効く。§7.21.4 の Note)
      seq.flow.children = this.spec ? flowKids : this.hoistSpans(flowKids, wm);
      // 本文の書字方向の裏返し (page-sequence か region-body の writing-mode)
      const sf = flipOf(this.attr(ps, 'writing-mode') ?? def.bodyWmAttr ?? '');
      if (sf) {
        seq.writingFlip = sf;
        if (sf.pairs) seq.flow.children = pairText(seq.flow.children) as LBlockLevel[];
      }
    } else this.note(msg('fo:flow がありません', 'there is no fo:flow'));
    return seq;
  }

  // ───────────────────────── スタイル ─────────────────────────

  /** font-size・色・太さなどのテキストスタイルと、子へ渡す Ctx */
  private textStyle(el: XEl, ctx: Ctx, isSeq = false): { style: TextStyle & { writingMode?: WritingMode }; ctx: Ctx } {
    const s: TextStyle & { writingMode?: WritingMode } = {};
    // 右から左の横組み: writing-mode (rl-tb / rl、lr-tb などで解除) と direction
    let rtl = ctx.rtl ?? false;
    const wmAttr = this.attrInh(el, 'writing-mode');
    if (wmAttr === 'rl-tb' || wmAttr === 'rl' || wmAttr === 'rl-bt') rtl = true;
    else if (wmAttr && !wmAttr.startsWith('from-')) rtl = false;
    const dir = this.attr(el, 'direction');
    if (dir === 'rtl' || dir === 'ltr') rtl = dir === 'rtl';
    if (rtl !== (ctx.rtl ?? false)) s.direction = rtl ? 'rtl' : 'ltr';
    let fs = ctx.fontSize;
    const fsAttr = this.attr(el, 'font-size');
    if (fsAttr) {
      // 絶対サイズのキーワード: medium を既定サイズとし、1 段ごとに 1.2 倍 (CSS2 §15.2.4 の推奨)
      const M = this.defaultFontSize;
      const named: Record<string, number> = { 'xx-small': M / 1.728, 'x-small': M / 1.44, small: M / 1.2, medium: M, large: M * 1.2, 'x-large': M * 1.44, 'xx-large': M * 1.728 };
      const v = named[fsAttr] ?? (fsAttr === 'larger' ? ctx.fontSize * 1.2 : fsAttr === 'smaller' ? ctx.fontSize / 1.2 : this.len(fsAttr, ctx.fontSize, ctx.fontSize));
      if (v && v > 0) {
        fs = v;
        s.fontSize = v;
      }
    }
    const ff = this.attr(el, 'font-family');
    const fw = this.attr(el, 'font-weight');
    // 太さ (§7.9.9): inherit と知らない値は親の太さのまま。bolder・lighter は継承した太さから決める (CSS Fonts 4 §2.2.1 の表)
    const inhW = ctx.inh?.fontWeight ?? 400;
    const weightOf = (v: string): number | undefined =>
      v === 'bold' ? 700 : v === 'normal' ? 400 : v === 'bolder' ? (inhW < 350 ? 400 : inhW < 550 ? 700 : 900) : v === 'lighter' ? (inhW < 550 ? 100 : inhW < 750 ? 400 : 700) : /^\d+$/.test(v) ? parseInt(v, 10) : undefined;
    const fwN = fw !== undefined ? weightOf(fw.trim()) : undefined;
    if (fwN !== undefined) s.fontWeight = fwN;
    const bold = fwN !== undefined && fwN >= 600;
    let families = ctx.families;
    if (ff) {
      // 引用符の中のカンマ ('A, B' のような名前) では分けない
      const list = splitFontFamily(ff);
      families = list;
      const mapped = this.opts.mapFont?.(list, bold);
      if (mapped) s.fontFamily = mapped;
    } else if (fw && this.opts.mapFont && (bold || families?.length)) {
      // 太さだけの指定: 祖先の font-family の並びで、その太さの書体を選び直す (MS ゴシックの中の太字は、ゴシックの太字)
      const mapped = this.opts.mapFont(families ?? [], bold);
      if (mapped) s.fontFamily = mapped;
    }
    const col = this.color(this.attr(el, 'color'));
    if (col) s.color = col;
    // font-stretch: キーワード (CSS の比率)・百分率・wider / narrower (1 段ずつ)
    const fsr = this.attrInh(el, 'font-stretch');
    if (fsr) {
      // 互換モード: 1 段ごとに 1.2 倍 (expanded の字送りが 1.44 倍、ultra-expanded が 2.07 倍、
      // ultra-condensed が 0.48 倍。仮名・欧文とも)。仕様モードは CSS の比率
      const steps = this.spec ? [0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2] : [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => 1.2 ** k);
      const KEYS = ['ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'normal', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded'];
      const named: Record<string, number> = Object.fromEntries(KEYS.map((k, i) => [k, steps[i]]));
      const cur = ctx.inh?.fontStretch ?? 1;
      const at = steps.findIndex((v) => v >= cur - 1e-9);
      const v = named[fsr] ?? (fsr === 'wider' ? steps[Math.min(at + 1, steps.length - 1)] : fsr === 'narrower' ? steps[Math.max(at - 1, 0)] : /%$/.test(fsr) ? parseFloat(fsr) / 100 : undefined);
      if (v !== undefined && v > 0) s.fontStretch = v;
      else this.miss(`font-stretch:${fsr}`);
    }
    const fst = this.attr(el, 'font-style');
    if (fst === 'italic' || fst === 'oblique') s.fontStyle = 'italic';
    else if (fst === 'normal') s.fontStyle = 'normal';
    const lh = this.attr(el, 'line-height') ?? this.attr(el, 'line-height.optimum');
    if (lh && lh !== 'normal') {
      // 数値 (比) は比のまま、長さ・百分率は計算済みの長さで継承される (§7.16.4)
      if (/^-?\d*\.?\d+$/.test(lh)) {
        const r = parseFloat(lh);
        if (r > 0) s.lineHeight = r;
      } else {
        const v = this.len(lh, fs, fs);
        if (v !== undefined && v > 0) s.lineHeightPt = v;
      }
    } else if (lh === 'normal') s.lineHeight = this.defaultLineHeight;
    // line-height.minimum・.maximum (§7.16.4): 行送りは optimum (無ければ normal) を、下限・上限の間に収めた値。
    // 一つの値の line-height の指定があれば、三つとも同じ値なので使わない
    if (this.attr(el, 'line-height') === undefined) {
      const lmin = this.lineHeightComponent(this.attr(el, 'line-height.minimum'), fs);
      const lmax = this.lineHeightComponent(this.attr(el, 'line-height.maximum'), fs);
      if (lmin !== undefined || lmax !== undefined) {
        const opt = s.lineHeightPt ?? (s.lineHeight ?? this.defaultLineHeight) * fs;
        let v = opt;
        if (lmax !== undefined) v = Math.min(v, lmax);
        if (lmin !== undefined) v = Math.max(v, lmin);
        if (v !== opt) {
          delete s.lineHeight;
          s.lineHeightPt = v;
        }
      }
    }
    const ta = this.attrInh(el, 'text-align');
    // 仕様モード: left は start、right は end と読む (XSL 1.1 §7.16.9・§7.16.10: “left Interpreted as "text-align='start'".
    // right Interpreted as "text-align='end'".”)。右から左の書字方向でも、left は start (右) に寄る。
    // 互換モード: left / right は物理の向き (左から右の横組み・縦書きでは start / end、右から左では end / start)
    const toEnd = (v: string) => v === 'end' || v === (this.spec || !rtl ? 'right' : 'left');
    if (ta) s.textAlign = ta === 'center' ? 'center' : ta === 'justify' ? 'justify' : toEnd(ta) ? 'end' : ta === 'inside' || ta === 'outside' ? ta : 'start';
    const tal = this.attrInh(el, 'text-align-last');
    // text-align-last の inside・outside (§7.16.10): 仕様モードでは text-align の inside・outside と同じく、組むページの綴じ側で start か end かを決める
    // (layoutEngine の alignByPage)。互換モードは start にする (従来どおり)
    if (tal && tal !== 'relative')
      s.textAlignLast = tal === 'center' ? 'center' : tal === 'justify' ? 'justify' : toEnd(tal) ? 'end' : this.spec && (tal === 'inside' || tal === 'outside') ? tal : 'start';
    const ti = this.len(this.attr(el, 'text-indent'), fs, this.cbW(ctx));
    if (ti !== undefined) s.textIndent = ti;
    // last-line-end-indent (§7.16.3。継承される。百分率は、いちばん近い祖先のブロックの領域の行の向きの寸法に対する値)
    const lle = this.len(this.attrInh(el, 'last-line-end-indent'), fs, this.cbW(ctx));
    if (lle !== undefined) s.lastLineEndIndent = lle;
    const lsAttr = this.attr(el, 'letter-spacing') ?? this.attr(el, 'letter-spacing.optimum');
    const ls = this.len(lsAttr, fs);
    if (ls !== undefined) {
      s.letterSpacing = ls;
      s.fixedLetterSpacing = true; // 字間が値で決まっているときは、両端揃えでも字間を伸縮しない (maximum が optimum より大きければ、その差まで広げる)
      const mx = this.len(this.attr(el, 'letter-spacing.maximum'), fs);
      s.letterSpacingStretch = mx !== undefined && mx > ls ? mx - ls : 0;
    } else if (lsAttr === 'normal') {
      s.fixedLetterSpacing = false;
      s.letterSpacing = 0;
      s.letterSpacingStretch = 0;
    }
    const wi = parseInt(this.attr(el, 'widows') ?? '', 10);
    const or = parseInt(this.attr(el, 'orphans') ?? '', 10);
    if (Number.isFinite(wi)) s.widows = wi;
    if (Number.isFinite(or)) s.orphans = or;
    // 欧文の合字 (アンテナハウスの拡張 axf:ligature-mode: none・latin・all)
    const lig = this.attr(el, 'axf:ligature-mode');
    if (lig) s.latinLigatures = lig === 'latin' || lig === 'all';
    const tas = this.attr(el, 'axf:text-autospace');
    if (tas) s.textAutospace = tas !== 'none';
    // 和欧間のアキの幅 (アンテナハウスの拡張 axf:text-autospace-width)。字の大きさに対する比で持つ
    const tasw = this.attr(el, 'axf:text-autospace-width');
    if (tasw) {
      const fs = s.fontSize ?? ctx.fontSize;
      const v = this.len(tasw, fs);
      if (v !== undefined && v >= 0 && fs > 0) s.textAutospaceWidth = v / fs;
    }
    // axf:line-break: strict は小書き仮名・長音記号も行頭禁則にする。normal は行頭に置いてよい
    const lb = this.attr(el, 'axf:line-break');
    if (lb === 'strict' || lb === 'normal') s.looseLineStart = lb === 'normal';
    // axf:punctuation-spacing: 約物を詰めたときの間隔 (<length>。% は字の大きさに対して)。字の大きさに対する比で持つ
    const psp = this.attr(el, 'axf:punctuation-spacing');
    if (psp) {
      const fs = s.fontSize ?? ctx.fontSize;
      const v = /%$/.test(psp.trim()) ? (parseFloat(psp) / 100) * fs : this.len(psp, fs);
      if (v !== undefined && v >= 0 && fs > 0) s.punctuationSpacing = v / fs;
    }
    const pt = this.attrInh(el, 'axf:punctuation-trim');
    if (pt) Object.assign(s, this.punctuationTrim(pt));
    // line-stacking-strategy (§7.16.6): line-height は行の高さを line-height そのものに。font-height・max-height は従来どおり
    // 分綴 (hyphenate) と言語 (xml:lang・language。分綴の規則を選ぶ)
    const hy = this.attr(el, 'hyphenate');
    if (hy === 'true' || hy === 'false') s.hyphenate = hy === 'true';
    const lang = this.attr(el, 'xml:lang') ?? this.attr(el, 'language');
    if (lang && lang !== 'none') s.language = lang;
    // country (§7.10.1: 言語と組で、分綴などの規則を選ぶ): 地域の付いていない言語に足して、言語の名前にする (language="en" country="GB" → en-GB。
    // 英語の分綴は GB だけ英国式)。xml:lang="en-GB" のように地域まで書いた言語は、そのまま。script (§7.10.3) は、規則の選び分けには使わない
    const countryAttr = this.attrInh(el, 'country');
    const country = countryAttr === undefined ? ctx.country : /^([A-Za-z]{2,3}|\d{3})$/.test(countryAttr) ? countryAttr : undefined;
    const langBase = (lang && lang !== 'none' ? lang : undefined) ?? ctx.langBase ?? ctx.lang;
    if (countryAttr !== undefined || (country && lang && lang !== 'none')) {
      if (langBase && !langBase.includes('-')) s.language = country ? `${langBase}-${country}` : langBase;
    }
    // 分綴の特性 (§7.10.5〜§7.10.7・§7.16.1・§7.16.2)。CSS の hyphenate-character・hyphenate-limit-* と同じ受け皿 (hyphenLimits) に写す
    const hyph = this.hyphenLimits(el, ctx.hyph);
    if (hyph) s.hyphenLimits = hyph;
    const lss = this.attr(el, 'line-stacking-strategy');
    if (lss === 'line-height' || lss === 'max-height' || lss === 'font-height') s.lineStackingStrategy = lss;
    // 仕様モード: 行の高さを §4.5 の規則で決める
    if (isSeq && this.spec) s.xslLineStacking = true;
    // 仕様モード: letter-spacing は §7.17.2 の規則 (Alphabetic の字の前後に半分ずつ、行頭・行末では捨てる)。
    // 互換モードは、句読点などを含むすべての字の後ろに空ける
    if (isSeq && this.spec) s.xslLetterSpacing = true;
    // 行の高さを超える画像などの行にも、半行間を上下に空ける (§4.5)
    if (isSeq) s.boxLineHalfLeading = true;
    // 互換モード: ブロックの字より大きい字のある行は、§4.5 の max-height の規則 (ブロックの半行間を上下に足す) で行の高さを決める
    if (isSeq && !this.spec) s.blockLeadingMaxHeight = true;
    const lhsa = this.attr(el, 'line-height-shift-adjustment');
    if (lhsa === 'consider-shifts' || lhsa === 'disregard-shifts') s.lineHeightShiftAdjustment = lhsa;
    // line-height.conditionality: line-height を数・長さで指定すると retain (XSL §7.16.4)。conditionality だけの指定は、受け継いだ line-height の conditionality を変える
    const lhc = this.attr(el, 'line-height.conditionality');
    if (lhc === 'discard' || lhc === 'retain') s.lineHeightDiscard = lhc === 'discard';
    else if (this.attr(el, 'line-height') !== undefined) s.lineHeightDiscard = false;
    // line-height.precedence: line-height を数・長さで指定すると force (§7.16.4)
    const lhp = this.attr(el, 'line-height.precedence');
    if (lhp === 'force') s.lineHeightPrecedence = 'force';
    else if (lhp !== undefined && /^-?\d+$/.test(lhp.trim())) s.lineHeightPrecedence = parseInt(lhp, 10);
    else if (this.attr(el, 'line-height') !== undefined) s.lineHeightPrecedence = 'force';
    const ro = this.attr(el, 'axf:ruby-overhang');
    if (ro) s.rubyOverhang = ro !== 'none';
    const km = this.attr(el, 'axf:kerning-mode') ?? this.attr(el, 'font-kerning');
    if (km) s.kerning = km !== 'none';
    const ln = this.lineNumbering(el, fs);
    if (ln) s.lineNumber = ln;
    // relative-align (継承される。§7.14.6)。セルとリストの項目で使う
    const raV = this.attr(el, 'relative-align');
    const relAlign = raV === 'before' || raV === 'baseline' ? raV : undefined;
    // 改訂バー (axf:revision-bar-*)。初期値: style は none (引かない)、color は color プロパティの値、
    // width は medium、offset は 0pt、position は start。どれも継承されるので、この要素の指定に祖先の指定を重ねて決める。
    // style (<border-style>) が none・hidden (CSS 2.1 §8.5.3: hidden は表の罫線の解決のほかは none と同じ) 以外のときだけ引く。
    // この要素に指定が無ければ、親のブロックの改訂バーを組版が引き継ぐ
    const rbOwn: NonNullable<Ctx['revBar']> = {};
    for (const k of ['style', 'color', 'width', 'offset', 'position'] as const) {
      const v = this.attrInh(el, `axf:revision-bar-${k}`);
      if (v !== undefined) rbOwn[k] = v;
    }
    const rbAll = Object.keys(rbOwn).length ? { ...ctx.revBar, ...rbOwn } : undefined;
    const rbStyle = rbAll?.style;
    if (rbAll && rbStyle && rbStyle !== 'none' && rbStyle !== 'hidden') {
      const rb: RevisionBar = { color: this.color(rbAll.color) ?? s.color ?? ctx.color ?? '#000000' };
      if (rbStyle !== 'solid') rb.style = rbStyle as RevisionBar['style'];
      const w = rbAll.width;
      const kw = this.borderKeywords;
      const wv = w === 'thin' || w === 'medium' || w === 'thick' ? kw[w] : this.len(w, fs);
      if (wv) rb.width = wv;
      const off = this.len(rbAll.offset, fs);
      if (off !== undefined) rb.offset = off;
      const pos = rbAll.position;
      if (pos === 'start' || pos === 'end' || pos === 'both' || pos === 'alternate') rb.position = pos;
      // 太さの既定: 互換モードは 3pt。線種が溝・山なら、見えるだけの太さにする
      if (!rb.width && (!this.spec || rb.style === 'groove' || rb.style === 'ridge' || rb.style === 'double')) rb.width = 3;
      s.revisionBar = rb;
    }
    // 変更バー (fo:change-bar-begin〜fo:change-bar-end。§6.13.2): この要素の始まりで効いているものを付ける。効いているものが無ければ、
    // 親から引き継いだ分を消す (前の兄弟・祖先の中で終わったもの)
    if (this.barsAt) s.changeBars = this.barsAt.get(el) ?? NO_BARS;
    const hp = this.attr(el, 'axf:hanging-punctuation');
    if (hp) s.hangingPunctuation = hp !== 'none' && hp !== 'false';
    const wmv = this.attrInh(el, 'writing-mode');
    let wm = ctx.wm;
    if (wmv) {
      const w = this.wmOf(wmv);
      if (w && w !== ctx.wm) {
        s.writingMode = w;
        wm = w;
      }
    }
    // 未対応の見た目の属性は数えて報告する
    // text-decoration (§7.17.4): underline / overline / line-through と、打ち消しの no-* (none はすべて打ち消す)
    const td = this.attr(el, 'text-decoration');
    if (td) {
      const d: NonNullable<TextStyle['textDecoration']> = {};
      for (const t of td.split(/\s+/)) {
        if (t === 'underline') d.underline = true;
        else if (t === 'overline') d.overline = true;
        else if (t === 'line-through') d.lineThrough = true;
        else if (t === 'no-underline') d.underline = false;
        else if (t === 'no-overline') d.overline = false;
        else if (t === 'no-line-through') d.lineThrough = false;
        else if (t === 'none') Object.assign(d, { underline: false, overline: false, lineThrough: false });
        else if (t !== 'blink' && t !== 'no-blink' && t !== 'inherit') this.miss(`text-decoration:${t}`);
      }
      if (Object.keys(d).length) s.textDecoration = d;
    }
    // text-transform: 大文字・小文字の変換 (継承される)
    let textTransform = ctx.textTransform;
    const ttAttr = this.attrInh(el, 'text-transform');
    if (ttAttr === 'capitalize' || ttAttr === 'uppercase' || ttAttr === 'lowercase') textTransform = ttAttr;
    else if (ttAttr === 'none') textTransform = undefined;
    else if (ttAttr) this.miss(`text-transform:${ttAttr}`);
    // font-variant (§7.9.8): small-caps は、字の並びに small caps の印を付けて運ぶ (children。字形を使うか、縮めた大文字で代えるかは組むときに
    // 書体を見て決める: “If a genuine small-caps font is not available, user agents should simulate a small-caps font”)。継承される
    let smallCaps = ctx.smallCaps;
    const fv = this.attrInh(el, 'font-variant');
    if (fv === 'small-caps') smallCaps = true;
    else if (fv === 'normal') smallCaps = false;
    else if (fv) this.miss(`font-variant:${fv.slice(0, 20)}`);
    // word-spacing (§7.17.8): <length> は、語の間の空白の既定の幅に足す量 (“inter-word space in addition to the default space between words”)。
    // <space> (.minimum・.optimum・.maximum) は optimum を使う (伸び縮みの幅は、両端揃えに任せる)。normal は足さない。継承される
    let wordSpacing = ctx.wordSpacing;
    const wsp = this.attrInh(el, 'word-spacing') ?? this.attrInh(el, 'word-spacing.optimum');
    if (wsp !== undefined) {
      const v = wsp === 'normal' ? 0 : this.len(wsp, fs);
      if (v === undefined) this.miss(`word-spacing:${wsp.slice(0, 20)}`);
      else if (v !== (ctx.wordSpacing ?? 0)) {
        s.wordSpacing = v;
        wordSpacing = v;
      }
    }
    // glyph-orientation-vertical (§7.29.3): 縦書きの字の向き。auto は全角の字を立てて、ほかの字を 90 度倒す (組版の mixed)。
    // 0deg はすべての字を立てる (upright)、90deg はすべての字を時計回りに 90 度倒す (sideways)。180・270 度は組版に受け皿が無いので、
    // 読まずに報告する。継承される
    let textOrientation = ctx.textOrientation;
    const gov = this.attrInh(el, 'glyph-orientation-vertical');
    if (gov !== undefined) {
      const deg = gov === 'auto' ? undefined : this.angle90(gov);
      const to = gov === 'auto' ? ('mixed' as const) : deg === 0 ? ('upright' as const) : deg === 90 ? ('sideways' as const) : undefined;
      if (!to) this.miss(`glyph-orientation-vertical:${gov.slice(0, 20)}`);
      else if (to !== (ctx.textOrientation ?? 'mixed')) {
        s.textOrientation = to;
        textOrientation = to;
      }
    }
    // glyph-orientation-horizontal (§7.29.2): 横書きの字の向き。0deg (初期値) のほかは、組版に受け皿が無いので、読まずに報告する
    const goh = this.attrInh(el, 'glyph-orientation-horizontal');
    if (goh !== undefined && this.angle90(goh) !== 0) this.miss(`glyph-orientation-horizontal:${goh.slice(0, 20)}`);
    // 空白・改行: white-space (略記) → 個別のプロパティの順に上書き
    const ws: WhiteSpace = { ...ctx.ws };
    const wsShort = this.attr(el, 'white-space');
    if (wsShort === 'pre') Object.assign(ws, { linefeed: 'preserve', treatment: 'preserve', collapse: false });
    else if (wsShort === 'normal' || wsShort === 'nowrap') Object.assign(ws, WS_INITIAL);
    const lf = this.attr(el, 'linefeed-treatment');
    if (lf === 'ignore' || lf === 'preserve' || lf === 'treat-as-space' || lf === 'treat-as-zero-width-space') ws.linefeed = lf;
    const wst = this.attr(el, 'white-space-treatment');
    if (wst === 'ignore' || wst === 'preserve' || wst === 'ignore-if-before-linefeed' || wst === 'ignore-if-after-linefeed' || wst === 'ignore-if-surrounding-linefeed') ws.treatment = wst;
    // 行末の空白: preserve・ignore-if-after-linefeed では消さない (§7.16.8)
    if (wst || wsShort) s.keepLineEndSpace = ws.treatment === 'preserve' || ws.treatment === 'ignore-if-after-linefeed';
    const wsc = this.attr(el, 'white-space-collapse');
    if (wsc === 'true' || wsc === 'false') ws.collapse = wsc === 'true';
    // 空白を詰めない (white-space-collapse="false"・white-space="pre") 字の並びは、行の調整で空白を詰めず、行頭の空白 (字下げ) と語を離さない
    if (wsc || wsShort) s.collapseSpaces = ws.collapse !== false;
    // wrap-option (§7.16.13): no-wrap は、強制改行のほかは行を折り返さない
    const wrap = this.attr(el, 'wrap-option') ?? (wsShort === 'pre' || wsShort === 'nowrap' ? 'no-wrap' : wsShort === 'normal' ? 'wrap' : undefined);
    if (wrap === 'no-wrap') s.noWrap = true;
    else if (wrap === 'wrap') s.noWrap = false;
    // keep-together.within-line="always" のブロックは、行を折り返さない
    if (this.attr(el, 'keep-together.within-line') && this.keepOf(el, 'keep-together', ['line']) && this.name(el) !== 'inline') s.noWrap = true;
    // visibility (§7.30.17): 見えない要素は、字の色を transparent にして運ぶ (字・リーダー・画像を描かない。HTML の visibility と同じ受け皿)。
    // 見えない親の中の visible の要素は、見えるときの色に戻す。子へ渡す color (ctx.color) は、見えるときの色のまま
    const shownColor = s.color ?? ctx.color;
    const hidden = this.hiddenOf(el, ctx.hidden);
    if (hidden) s.color = 'transparent';
    else if (ctx.hidden) s.color = shownColor ?? '#000000';
    const inh = { ...ctx.inh };
    for (const k of ['fontFamily', 'fontWeight', 'fontStyle', 'color', 'textAlign', 'lineHeight', 'lineHeightPt', 'fontStretch'] as const) if (s[k] !== undefined) (inh as Record<string, unknown>)[k] = s[k];
    if (s.lineHeight !== undefined && s.lineHeightPt === undefined) delete inh.lineHeightPt;
    // 書字方向の裏返し (bt-lr・lr-bt など): 自分の writing-mode があれば決め直し、無ければ親のまま
    const ownWm = this.attr(el, 'writing-mode');
    const flip = ownWm && !ownWm.startsWith('from-') ? flipOf(ownWm) : ctx.flip;
    return { style: s, ctx: { ...ctx, flip, fontSize: fs, wm, ws, inh, rtl, families, lang: s.language ?? ctx.lang, ...(langBase !== ctx.langBase ? { langBase } : {}), ...(country !== ctx.country ? { country } : {}), ...(hyph ? { hyph } : {}), color: shownColor, textTransform, ...(hidden !== !!ctx.hidden ? { hidden } : {}), ...(smallCaps !== ctx.smallCaps ? { smallCaps } : {}), ...(wordSpacing !== ctx.wordSpacing ? { wordSpacing } : {}), ...(textOrientation !== ctx.textOrientation ? { textOrientation } : {}), ...(rbAll ? { revBar: rbAll } : {}), ...(relAlign ? { relAlign } : {}) } };
  }

  phys(rel: 'before' | 'after' | 'start' | 'end', wm: WritingMode, rtl = false): 'top' | 'right' | 'bottom' | 'left' {
    if (wm === 'horizontal-tb') return rel === 'before' ? 'top' : rel === 'after' ? 'bottom' : (rel === 'start') !== rtl ? 'left' : 'right';
    if (wm === 'vertical-lr') return rel === 'before' ? 'left' : rel === 'after' ? 'right' : rel === 'start' ? 'top' : 'bottom';
    return rel === 'before' ? 'right' : rel === 'after' ? 'left' : rel === 'start' ? 'top' : 'bottom';
  }

  /** 1〜4 値の属性を [top, right, bottom, left] に展開 */
  box4(el: XEl, k: string): string[] | undefined {
    const v = this.attr(el, k);
    if (!v) return undefined;
    // 括弧の中の空白 (rgb(0, 0, 0) など) では分けない
    const p = splitTopLevel(v, ' ');
    if (p.length === 1) return [p[0], p[0], p[0], p[0]];
    if (p.length === 2) return [p[0], p[1], p[0], p[1]];
    if (p.length === 3) return [p[0], p[1], p[2], p[1]];
    return p.slice(0, 4);
  }

  private padding(el: XEl, ctx: Ctx): EdgesInput | undefined {
    const out: Record<string, number> = {};
    const all = this.box4(el, 'padding');
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    sides.forEach((s, i) => {
      if (all) out[s] = this.len(all[i], ctx.fontSize, this.cbW(ctx)) ?? 0;
    });
    for (const rel of ['before', 'after', 'start', 'end'] as const) {
      const p = this.phys(rel, ctx.wm, ctx.rtl);
      // 絶対 (padding-top) と相対 (padding-before) を両方書いたら、絶対が勝つ (§5.3.1)
      const v = this.len(this.attr(el, `padding-${p}`) ?? this.attr(el, `padding-${rel}`), ctx.fontSize, this.cbW(ctx));
      if (v !== undefined) out[p] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** 罫線の一括指定 (「1pt solid red」など) を、線種・太さ・色に振り分ける */
  private borderShorthand(s: string | undefined, fs: number, lh?: number): { style?: string; width?: number; color?: string } {
    const o: { style?: string; width?: number; color?: string } = {};
    for (const t of splitTopLevel(s ?? '', ' ')) {
      if (/^(none|solid|dashed|dotted|double|groove|ridge|inset|outset|hidden)$/.test(t)) o.style = t;
      else if (t === 'thin' || t === 'medium' || t === 'thick') o.width = this.borderKeywords[t];
      else if (this.len(t, fs, undefined, lh) !== undefined) o.width = this.len(t, fs, undefined, lh);
      else o.color = t;
    }
    return o;
  }

  border(el: XEl, ctx: Ctx): Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> | undefined {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const gStyle = this.box4(el, 'border-style');
    const gWidth = this.box4(el, 'border-width');
    const gColor = this.box4(el, 'border-color');
    const shorthand = (s: string | undefined) => this.borderShorthand(s, ctx.fontSize, this.lineHeightOf(ctx));
    const all = shorthand(this.attr(el, 'border'));
    const out: Partial<Record<(typeof sides)[number], BorderSide>> = {};
    sides.forEach((p, i) => {
      const rel = (['before', 'after', 'start', 'end'] as const).find((r) => this.phys(r, ctx.wm, ctx.rtl) === p) as string;
      const sh = shorthand(this.attr(el, `border-${p}`) ?? this.attr(el, `border-${rel}`));
      // 絶対 (border-top-style) と相対 (border-before-style) を両方書いたら、絶対が勝つ (§5.3.1)。一括指定から来た絶対の値は、相対に負ける
      const style = this.attr(el, `border-${p}-style`) ?? this.attr(el, `border-${rel}-style`) ?? sh.style ?? gStyle?.[i] ?? all.style;
      const kw = this.borderKeywords;
      const named: Record<string, string> = { thin: `${kw.thin}pt`, medium: `${kw.medium}pt`, thick: `${kw.thick}pt` };
      const nw = (v: string | undefined) => (v && named[v] ? named[v] : v);
      const wv = nw(this.attr(el, `border-${p}-width`)) ?? nw(this.attr(el, `border-${rel}-width`));
      const lh = this.lineHeightOf(ctx);
      const width = (wv ? this.len(wv, ctx.fontSize, undefined, lh) : undefined) ?? sh.width ?? (gWidth?.[i] ? this.len(nw(gWidth[i]), ctx.fontSize, undefined, lh) : undefined) ?? all.width;
      const colorAttr = this.attr(el, `border-${p}-color`) ?? this.attr(el, `border-${rel}-color`) ?? sh.color ?? gColor?.[i] ?? all.color;
      // transparent: 罫線の場所は取るが、線は見えない
      // 見えない要素 (visibility。§7.30.17) の罫線も、場所だけ取って描かない
      const color = colorAttr?.trim() === 'transparent' || ctx.hidden ? 'transparent' : (this.color(colorAttr) ?? '#000000');
      if (style === 'hidden') {
        // hidden: 線は描かない。表の罫線の重ね合わせ (collapse) では、ほかのすべての罫線に勝って線を消す (§6.7.10)
        out[p] = { width: 0, color, style: 'hidden' };
      } else if (style && style !== 'none') {
        const w = width ?? kw.medium; // 太さの指定が無ければ初期値 medium (§7.8.21)
        if (w > 0) out[p] = { width: w, color, ...(style !== 'solid' ? { style: style as BorderSide['style'] } : {}) };
      }
    });
    return Object.keys(out).length ? out : undefined;
  }

  /**
   * ブロック共通のボックス (margin / padding / border / 背景 / 寸法 / 改ページ)。
   * indents: start-indent / end-indent を margin にする (inline-container では使わない。行内の箱の位置は indent で決まらず、
   * indent は中のブロックのためのもの (XSL 1.1 §6.6.8 は inline の margin だけを持つ))
   */
  private boxStyle(el: XEl, ctx: Ctx, inherited: Ctx, indents = true): Partial<LBlock> & { width?: number; height?: number } {
    const o: Partial<LBlock> & { width?: number; height?: number } = {};
    const fs = ctx.fontSize;
    const m: Record<string, number> = {};
    const add = (side: string, v: number | undefined) => {
      if (v !== undefined && v !== 0) m[side] = (m[side] ?? 0) + v;
    };
    // 絶対の margin-* と相対の space-* / *-indent が同じ側に両方あるとき (§5.3.1・§5.3.2): 個別に書いた margin-* が優先。
    // margin の一括指定 (margin="…") だけなら、相対の指定が優先 (その側の margin は使わない)
    const SIDES = ['top', 'right', 'bottom', 'left'] as const;
    const mAll = this.box4(el, 'margin');
    const explicitM = (s: (typeof SIDES)[number]) => this.attr(el, `margin-${s}`);
    const beforeSide = this.phys('before', ctx.wm, ctx.rtl);
    const afterSide = this.phys('after', ctx.wm, ctx.rtl);
    const startSideP = this.phys('start', ctx.wm, ctx.rtl);
    const endSideP = this.phys('end', ctx.wm, ctx.rtl);
    const relativeOf: Partial<Record<(typeof SIDES)[number], string | undefined>> = {
      [beforeSide]: this.attrOpt(el, 'space-before'),
      [afterSide]: this.attrOpt(el, 'space-after'),
      ...(indents ? { [startSideP]: this.attr(el, 'start-indent'), [endSideP]: this.attr(el, 'end-indent') } : {}),
    };
    /** その側で使う margin の値 (文字列)。相対の指定に負ける一括指定は undefined */
    const marginOf = (s: (typeof SIDES)[number]) => explicitM(s) ?? (relativeOf[s] !== undefined ? undefined : mAll?.[SIDES.indexOf(s)]);
    if (explicitM(beforeSide) === undefined) add(beforeSide, this.len(this.attrOpt(el, 'space-before'), fs));
    if (this.attr(el, 'space-before.conditionality') === 'retain') o.retainSpaceBefore = true;
    if (this.attr(el, 'space-after.conditionality') === 'retain') o.retainSpaceAfter = true;
    // 罫線・余白の conditionality="retain": ページ・段の切れ目でも残す (§7.8.x・§7.7.x。初期値 discard)
    const er: NonNullable<LBlock['edgeRetain']> = {};
    if (this.attr(el, 'border-before-width.conditionality') === 'retain') er.borderBefore = true;
    if (this.attr(el, 'border-after-width.conditionality') === 'retain') er.borderAfter = true;
    if (this.attr(el, 'padding-before.conditionality') === 'retain') er.paddingBefore = true;
    if (this.attr(el, 'padding-after.conditionality') === 'retain') er.paddingAfter = true;
    if (Object.keys(er).length) o.edgeRetain = er;
    // space-before / space-after の優先度 (§4.3.1): force または整数
    const prec = (k: string) => {
      const v = this.attr(el, `${k}.precedence`);
      if (v === 'force') return 'force' as const;
      const n = v !== undefined ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const pb = prec('space-before');
    const pa = prec('space-after');
    if (pb !== undefined) o.spaceBeforePrecedence = pb;
    if (pa !== undefined) o.spaceAfterPrecedence = pa;
    // margin-top 等 (block 方向の前側の margin) から決まる space-before は .conditionality = retain (§5.3.2)。
    // ページ・段の先頭に来ても捨てない
    // margin の百分率は、包含ブロックの幅に対する割合 (§7.11.1)
    const mBefore = this.len(marginOf(beforeSide), fs, this.cbW(inherited));
    if (mBefore !== undefined && mBefore !== 0) o.retainSpaceBefore = true;
    // block 方向の後ろ側の margin から決まる space-after も retain (§5.3.2)。段・ページの終わりでも捨てない。
    // 互換モードは従来どおり (後ろ側の margin はページの終わりで捨てる)
    if (this.spec) {
      const mAfter = this.len(marginOf(afterSide), fs, this.cbW(inherited));
      if (mAfter !== undefined && mAfter !== 0) o.retainSpaceAfter = true;
    }
    if (explicitM(afterSide) === undefined) add(afterSide, this.len(this.attrOpt(el, 'space-after'), fs));
    for (const s of SIDES) add(s, this.len(marginOf(s), fs, this.cbW(inherited)));
    // start/end-indent は「内容領域 (border・padding の内側) の端」の、親の内容端からの位置 (継承される絶対位置)。
    // border・padding は indent の外側に付くので、margin は (indent の差分 − border − padding) になる (負にもなる)。
    // 個別に書いた margin-left などがあれば、その側の indent は margin から決まる (指定の indent は使わない)
    const si = indents && explicitM(startSideP) === undefined ? this.len(this.attr(el, 'start-indent'), fs, ctx.width) : undefined;
    const ei = indents && explicitM(endSideP) === undefined ? this.len(this.attr(el, 'end-indent'), fs, ctx.width) : undefined;
    const pad = this.padding(el, ctx);
    const b = this.border(el, ctx);
    const startP = this.phys('start', ctx.wm, ctx.rtl);
    const endP = this.phys('end', ctx.wm, ctx.rtl);
    const edgeOf = (side: 'top' | 'right' | 'bottom' | 'left') => ((pad as Record<string, number> | undefined)?.[side] ?? 0) + (b?.[side]?.width ?? 0);
    if (si !== undefined) add(startP, si - inherited.startIndent - edgeOf(startP));
    if (ei !== undefined) add(endP, ei - inherited.endIndent - edgeOf(endP));
    // indent も margin も指定が無いとき: start-indent / end-indent は親の値を受け継ぐので、内容の端は親の内容の端のまま。
    // 罫線・パディングは、その外側へ出る (§5.3.2)
    if (indents && si === undefined && marginOf(startP) === undefined && edgeOf(startP) > 0) add(startP, -edgeOf(startP));
    if (indents && ei === undefined && marginOf(endP) === undefined && edgeOf(endP) > 0) add(endP, -edgeOf(endP));
    if (Object.keys(m).length) o.margin = m;
    if (pad) o.padding = pad;
    if (b) o.border = b;
    const bg = this.color(this.attr(el, 'background-color'));
    if (bg) o.backgroundColor = bg;
    const bgi = this.backgroundImage(el, ctx);
    if (bgi) o.backgroundImage = bgi;
    // 角丸 (axf:border-radius="水平半径 垂直半径") と影 (axf:box-shadow="横 縦 ぼかし 広がり 色")
    const rad = this.attr(el, 'axf:border-radius')?.split(/\s+/).map((v) => this.len(v, fs));
    if (rad?.[0] !== undefined && rad[0] > 0) o.borderRadius = { rx: rad[0], ry: rad[1] ?? rad[0] };
    // 角ごとの半径 (axf:border-top-left-radius など。最初の値は水平方向、縦書きでは垂直方向の径。省略した二番目は最初と同じ)
    const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
    const cornerVals = cornerNames.map((k) => this.attr(el, `axf:border-${k}-radius`)?.split(/\s+/).map((v) => this.len(v, fs)));
    if (cornerVals.some((v) => v?.[0] !== undefined)) {
      const base: [number, number] = o.borderRadius ? [o.borderRadius.rx, o.borderRadius.ry] : [0, 0];
      const vert = ctx.wm !== 'horizontal-tb';
      const corners = cornerVals.map((v): [number, number] => {
        if (v?.[0] === undefined) return base;
        const a = Math.max(v[0], 0);
        const b = Math.max(v[1] ?? v[0], 0);
        return vert ? [b, a] : [a, b];
      });
      o.borderRadius = { rx: base[0], ry: base[1], corners };
    }
    // axf:box-shadow (none か、inset・2〜4 個の長さ・色を組にした影をカンマで並べたもの)。括弧の外のカンマで影ごとに分け、
    // それぞれの横・縦のずれ・ぼかし・広がり・色を読む (CSS の box-shadow と同じ並び。ぼかしは半透明の形の重ねで描く)。
    // 影は書いた順に上から重ねる (BoxStyle.boxShadow)。
    // inset は内側の影 (padding の箱の内側に描く)
    const shadow = this.attr(el, 'axf:box-shadow');
    if (shadow && shadow !== 'none') {
      const shadows: BoxShadow[] = [];
      for (const one of splitTopLevel(shadow, ',')) {
        const parts0 = splitTopLevel(one, ' ');
        const inset = parts0.some((v) => v.toLowerCase() === 'inset');
        const parts = parts0.filter((v) => v.toLowerCase() !== 'inset');
        const lens = parts.map((v) => this.len(v, fs));
        // 長さでない部分だけを色として読む (長さを色として数えない)
        const color = parts.map((v, k) => (lens[k] === undefined ? this.color(v) : undefined)).find((c) => c);
        const [dx, dy, blur, spread] = lens.filter((v): v is number => v !== undefined);
        if (dx !== undefined && dy !== undefined)
          shadows.push({ dx, dy, color: color ?? '#808080', ...(blur && blur > 0 ? { blur } : {}), ...(spread ? { spread } : {}), ...(inset ? { inset: true } : {}) });
      }
      if (shadows.length) o.boxShadow = shadows.length === 1 ? shadows[0] : shadows;
    }
    // 対角罫・逆対角罫 (axf:diagonal-border-* / axf:reverse-diagonal-border-*。線種・太さ・色。一括指定も読む)
    for (const [k, key] of [['axf:diagonal-border', 'diagonalBorder'], ['axf:reverse-diagonal-border', 'reverseDiagonalBorder']] as const) {
      const all = this.borderShorthand(this.attr(el, k), fs);
      const style = this.attr(el, `${k}-style`) ?? all.style;
      if (!style || style === 'none' || style === 'hidden') continue;
      const kw = this.borderKeywords as Record<string, number>;
      const wv = this.attr(el, `${k}-width`);
      const width = wv !== undefined ? (kw[wv] ?? this.len(wv, fs) ?? kw.medium) : (all.width ?? kw.medium);
      const color = this.color(this.attr(el, `${k}-color`) ?? all.color) ?? '#000000';
      if (width > 0) o[key] = { width, color, ...(style !== 'solid' ? { style: style as BorderSide['style'] } : {}) };
    }
    // 寸法: inline-progression-dimension は inline 方向、block-progression-dimension は block 方向
    const horizontal = ctx.wm === 'horizontal-tb';
    const ipd = this.len(this.attr(el, 'inline-progression-dimension.optimum') ?? this.attr(el, 'inline-progression-dimension'), fs, ctx.width);
    const bpd = this.len(this.attr(el, 'block-progression-dimension.optimum') ?? this.attr(el, 'block-progression-dimension'), fs, ctx.cbH);
    const w = this.len(this.attr(el, 'width'), fs, ctx.width);
    const h = this.len(this.attr(el, 'height'), fs, ctx.cbH);
    // 幅の上限 (inline-progression-dimension.maximum) だけの指定: 領域の幅が上限を超えるときは上限の幅にする
    const ipdMax = this.len(this.dimLimit(el, ctx.wm, 'inline', 'maximum'), fs, ctx.width);
    const ipdCapped = ipd ?? (ipdMax !== undefined && (ctx.width === undefined || ipdMax < ctx.width) ? ipdMax : undefined);
    // 幅の下限 (inline-progression-dimension.minimum) だけの指定: 領域の幅が下限より狭いときは下限の幅にする
    // (段組のページで、minimum="30em" の箱は段の幅より広くても 30em)
    const ipdMin = this.len(this.dimLimit(el, ctx.wm, 'inline', 'minimum'), fs, ctx.width);
    const ipdUsed = ipdCapped ?? (ipdMin !== undefined && ctx.width !== undefined && ipdMin > ctx.width ? ipdMin : undefined);
    const width = w ?? (horizontal ? ipdUsed : bpd);
    const height = h ?? (horizontal ? bpd : ipd);
    if (width !== undefined) o.width = width;
    if (height !== undefined) o.height = height;
    // 高さの下限 (block-progression-dimension.minimum): 中身が少なくても、この高さを取る
    const bpdMin = horizontal && bpd === undefined && h === undefined ? this.len(this.dimLimit(el, ctx.wm, 'block', 'minimum'), fs, ctx.cbH) : undefined;
    if (bpdMin !== undefined && bpdMin > 0) o.minBlockSize = bpdMin;
    // 絶対の上限・下限 (min-height など) のうち、組版に受け皿の無いもの (block 方向の上限と、縦書きの箱の上限・下限) は、読まずに報告する。
    // block-container の max-width は、blockContainer が読む (従来どおり)
    for (const k of horizontal ? ['max-height'] : ['min-height', 'max-height', 'min-width', 'max-width']) {
      const v = this.attrInh(el, k);
      if (v !== undefined && v !== 'none' && v !== 'auto' && !(k === 'max-width' && this.name(el) === 'block-container')) this.miss(k);
    }
    // FO の width・height (inline/block-progression-dimension) は内容の寸法 (§7.15: 枠・パディングは外側)
    // break-before / break-after (§7.20.2): page・column・odd-page・even-page
    const brk = (v: string | undefined) => (v === 'page' || v === 'column' || v === 'odd-page' || v === 'even-page' ? v : undefined);
    const bb = brk(this.attr(el, 'break-before'));
    const ba = brk(this.attr(el, 'break-after'));
    if (bb) o.breakBefore = bb;
    if (ba) o.breakAfter = ba;
    // keep-* の成分 (§7.20.3〜§7.20.5): within-page・within-column は別々の成分なので、どちらか (または成分を書かない形) が
    // 保つ指定なら保つ (先に見た成分が auto でも、ほかの成分を見る)
    const keepVals = (k: string) => [this.attr(el, `${k}.within-page`), this.attr(el, `${k}.within-column`), this.attr(el, k)];
    const keepInt = (v: string | undefined) => v !== undefined && /^\d+$/.test(v) && parseInt(v, 10) > 0;
    // 仕様モード: keep の強さの整数 (§5.11 の <keep>) も、1 以上なら always と同じに「保つ」とみなす (表の行・リストの項目と同じ。強さの大小は比べない)。
    // 互換モードは always だけ (従来どおり)
    if (keepVals('keep-together').some((kt) => kt === 'always' || (this.spec && keepInt(kt)))) o.keepTogether = true;
    if (this.attr(el, 'span') === 'all') o.span = 'all';
    const keep = (k: string) => keepVals(k).some((v) => v === 'always' || keepInt(v));
    if (keep('keep-with-next')) o.keepWithNext = true;
    if (keep('keep-with-previous')) o.keepWithPrevious = true;
    // overflow (§7.21.2): hidden・scroll・error-if-overflow は、印刷では切り抜きと同じ
    const ov = this.attr(el, 'overflow');
    if (ov === 'hidden' || ov === 'scroll' || ov === 'error-if-overflow') o.overflow = 'hidden';
    else if (ov && ov !== 'auto' && ov !== 'visible') this.miss(`overflow:${ov}`);
    // 見えない要素 (visibility が hidden・collapse。§7.30.17) は、背景・影・対角罫を描かない (罫線は border() が transparent にする。場所は変えない)
    if (ctx.hidden) {
      delete o.backgroundColor;
      delete o.backgroundImage;
      delete o.boxShadow;
      delete o.diagonalBorder;
      delete o.reverseDiagonalBorder;
    }
    return o;
  }

  /**
   * axf:punctuation-trim の値を、空白で区切ったトークンとして読む。読む語: none・auto・all、または
   * start か start-except-first・end か allow-end か end-except-fullstop・adjacent の組み合わせ (と <string>)
   * - none: 詰めない。auto: 指定の無いときと同じ (互換モードは約物の連続の詰め・段落の 1 行目の行頭・行末を詰める。仕様モードは詰めない)
   * - all: 全角の括弧類・中点類・句読点類をすべて半角にする (punctuationTrimAll)
   * - start: どの行の行頭の始め括弧類も半角に。start-except-first: start と同じだが、段落の 1 行目と強制改行の直後の行を除く
   * - end: 行末の終わり括弧類・句読点類を半角に。end-except-fullstop: end と同じだが、句点 (。．) を除く。
   *   allow-end: 行に収まるときは全角のまま、収まらないときは半角にするので、行末で捨てずに、行が溢れるときの追込み
   *   (行末の約物の後ろのアキを詰める) に任せる
   * - adjacent: 隣り合う全角約物と全角文字の間を詰める (punctuationSqueeze)
   * <string> (引用符で囲んだ字の並び) は読まない (半角にする字を選ぶ仕組みが組版に無い)。ほかの語は報告する
   */
  private punctuationTrim(v: string): Partial<TextStyle> {
    const toks = splitTopLevel(v, ' ').filter((t) => !/^["']/.test(t));
    const has = (t: string) => toks.includes(t);
    const known = ['none', 'auto', 'all', 'start', 'start-except-first', 'end', 'allow-end', 'end-except-fullstop', 'adjacent'];
    for (const t of toks) if (!known.includes(t)) this.miss(`axf:punctuation-trim:${t}`);
    const off = { punctuationSqueeze: false, punctuationTrimStart: false, punctuationTrimParagraphStart: false, punctuationTrimStartExceptFirst: false, punctuationTrimEnd: false, punctuationTrimEndExceptFullstop: false, punctuationTrimAll: false };
    if (has('none') || (/^["']/.test(v.trim()) && !toks.length)) return off;
    // auto: 指定の無いときの既定 (ページ順序の既定の書式と同じ値)
    if (has('auto')) return { ...off, punctuationSqueeze: !this.spec, punctuationTrimParagraphStart: !this.spec, punctuationTrimEnd: !this.spec };
    if (has('all')) return { ...off, punctuationTrimAll: true };
    const start = has('start') || has('start-except-first');
    const end = has('end') || has('end-except-fullstop');
    return {
      ...off,
      punctuationSqueeze: has('adjacent'),
      punctuationTrimStart: start,
      punctuationTrimStartExceptFirst: !has('start') && has('start-except-first'),
      punctuationTrimEnd: end,
      punctuationTrimEndExceptFullstop: !has('end') && has('end-except-fullstop'),
    };
  }

  /**
   * visibility (§7.30.17): hidden・collapse は、場所を残して描かない (“The generated box is invisible (fully transparent), but still affects
   * layout.”)。継承される (XSL は “made it an inherited property”)。collapse は、表の行・列のほかでは hidden と同じ
   * (“If used on elements other than rows or columns, "collapse" has the same meaning as "hidden".”)。表の行・列を取り除く動き
   * (CSS2 の dynamic row and column effects) は組まないので、hidden として扱って報告する。読めない値も報告する
   */
  private hiddenOf(el: XEl, inherited: boolean | undefined): boolean {
    const v = this.attrInh(el, 'visibility');
    if (v === undefined) return !!inherited;
    if (v === 'visible') return false;
    if (v === 'hidden' || v === 'collapse') {
      if (v === 'collapse' && /^table-(row|column|header|footer|body)$/.test(this.name(el))) this.miss(`visibility:collapse (fo:${this.name(el)})`);
      return true;
    }
    this.miss(`visibility:${v.slice(0, 20)}`);
    return !!inherited;
  }

  /**
   * relative-position="relative" (§7.13.5) のずらし (pt。右・下が正)。left・top をそのまま使い、left が無く right があれば −right、
   * top が無く bottom があれば −bottom、どちらも無ければ 0 (§5.5.5)。組んだ後の箱を動かし、前後の配置は変えない
   * (“Only during rendering is the area rendered offset relative to this position.”)。static (初期値) なら undefined
   */
  private relativeOffsetOf(el: XEl, ctx: Ctx): { x: number; y: number } | undefined {
    const rp = this.attr(el, 'relative-position');
    if (rp === undefined || rp === 'static') return undefined;
    if (rp !== 'relative') {
      this.miss(`relative-position:${rp.slice(0, 20)}`);
      return undefined;
    }
    // left・right の百分率は包含ブロックの幅、top・bottom は包含ブロックの高さ (§7.6.2〜§7.6.5)
    const off = (k: string, pct: number | undefined) => {
      const v = this.attr(el, k);
      return v === undefined || v === 'auto' ? undefined : this.len(v, ctx.fontSize, pct);
    };
    const l = off('left', this.cbW(ctx));
    const r = off('right', this.cbW(ctx));
    const t = off('top', ctx.cbH);
    const b = off('bottom', ctx.cbH);
    return { x: l ?? (r !== undefined ? -r : 0), y: t ?? (b !== undefined ? -b : 0) };
  }

  /**
   * z-index (§7.30.18) の、親の値に足した値 (§5.4.5: “the refined value is the specified value plus the refined value of z-index of its
   * parent formatting object, if any”)。auto は足さない
   */
  private zIndexOf(el: XEl): number {
    let z = 0;
    for (let e: XEl | undefined = el; e; e = this.parents.get(e)) {
      const v = this.attr(e, 'z-index');
      if (v !== undefined && /^[-+]?\d+$/.test(v)) z += parseInt(v, 10);
      else if (v !== undefined && v !== 'auto' && e === el) this.miss(`z-index:${v.slice(0, 20)}`);
    }
    return z;
  }

  /**
   * clear (§7.19.1): その側の先の fo:float (side-float) の下まで下げる。left は start、right は end と読む
   * (“left Interpreted as "clear='start'". right Interpreted as "clear='end'".”)。
   * 組版が受けられるのは fo:block の start・end・both だけ。inside・outside (ページの偶奇で側が決まる) と、ほかの要素
   * (fo:float・fo:table・fo:block-container・fo:list-block など。supported = false) の clear は、読まずに報告する
   */
  private clearOf(n: XEl, supported = true): LBlock['clear'] | undefined {
    const v = this.attr(n, 'clear');
    if (!v || v === 'none') return undefined;
    const side = v === 'both' ? 'both' : v === 'start' || v === 'left' ? 'start' : v === 'end' || v === 'right' ? 'end' : undefined;
    if (!supported) this.miss(`clear (fo:${this.name(n)})`);
    else if (!side) this.miss(`clear:${v.slice(0, 20)}`);
    return supported ? side : undefined;
  }

  /** keep-* の値 (§7.20): always と 1 以上の整数を「保つ」とみなす (強さの大小は区別しない) */
  private keepOf(el: XEl, k: string, which: Array<'page' | 'column' | 'line' | ''> = ['page', 'column', '']): boolean {
    // 成分は別々の指定なので、どれかが保つ指定なら保つ (先に見た成分が auto でも、ほかの成分を見る)
    return which.some((w) => {
      const v = this.attr(el, w ? `${k}.within-${w}` : k);
      return v !== undefined && (v === 'always' || (/^\d+$/.test(v) && parseInt(v, 10) > 0));
    });
  }

  /** fo:bookmark-tree / fo:bookmark (§6.12) */
  private bookmarks(el: XEl): LBookmark[] {
    return this.els(el)
      .filter((e) => this.name(e) === 'bookmark')
      .map((b) => {
        const titleEl = this.els(b).find((e) => this.name(e) === 'bookmark-title');
        const bm: LBookmark = { title: (titleEl?.textContent ?? '').replace(/\s+/g, ' ').trim(), ref: this.attr(b, 'internal-destination') ?? '' };
        // external-destination (§7.23.6): 文書の外への飛び先。internal-destination もあれば、そちらを使う (§6.11.2)。
        // 外への飛び先は href に入れる (PDF のしおりの動作になる。fo:basic-link の external-destination と同じ扱い)
        const ext = this.attr(b, 'external-destination');
        // 通さない飛び先 (linkPolicy) は、しおりの動作にしない (題だけのしおりになる)
        const href = !bm.ref && ext ? this.allowedExternal(ext.replace(/^url\(\s*['"]?([\s\S]*?)['"]?\s*\)$/i, '$1')) : undefined;
        if (href !== undefined) bm.href = href;
        if (this.attr(b, 'starting-state') === 'hide') bm.open = false;
        const kids = this.bookmarks(b);
        if (kids.length) bm.children = kids;
        return bm;
      });
  }

  /** axf:outline-level / axf:outline-title / axf:outline-group のついたブロック */
  private outlines: Array<{ level: number; title: string; id: string; group?: string }> = [];
  private outlineSeq = 0;

  private outlineTree(): LBookmark[] {
    const groups = new Map<string | undefined, typeof this.outlines>();
    for (const o of this.outlines) {
      const g = groups.get(o.group) ?? [];
      g.push(o);
      groups.set(o.group, g);
    }
    const tree = (list: typeof this.outlines): LBookmark[] => {
      const root: LBookmark[] = [];
      const stack: Array<{ level: number; node: LBookmark }> = [];
      for (const o of list) {
        const node: LBookmark = { title: o.title, ref: o.id };
        while (stack.length && stack[stack.length - 1].level >= o.level) stack.pop();
        if (stack.length) (stack[stack.length - 1].node.children ??= []).push(node);
        else root.push(node);
        stack.push({ level: o.level, node });
      }
      return root;
    };
    const out: LBookmark[] = [];
    for (const [g, list] of groups) {
      if (g === undefined) out.push(...tree(list));
      else out.push({ title: g, ref: '', children: tree(list) });
    }
    return out;
  }

  /** background-image / background-repeat / background-position (§7.8.3-7.8.7) と、大きさの axf:background-content-width/height */
  backgroundImage(el: XEl, ctx: Ctx, prefix = ''): BackgroundImage | undefined {
    // prefix: 'axf:' なら、アンテナハウス拡張の名前 (axf:background-image など) を読む
    const at = (k: string) => this.attr(el, prefix + k);
    const v = this.attrInh(el, prefix + 'background-image');
    if (!v || v === 'none') return undefined;
    const src = normalizeSrc(v);
    if (!src) return undefined;
    this.addImage(src);
    const bi: BackgroundImage = { src };
    const rep = at('background-repeat');
    if (rep === 'repeat' || rep === 'no-repeat' || rep === 'repeat-x' || rep === 'repeat-y') bi.repeat = rep;
    // background-position (一括指定。§7.31.2・CSS2 §14.2.1): 長さ・百分率は「横 縦」の順で、1 つだけなら横の位置 (縦は 50%)。
    // キーワードは top・bottom が縦、left・right が横で、順はどちらでもよく、1 つだけならもう一方は center (50%)
    const short = (at('background-position') ?? '').split(/\s+/).filter(Boolean);
    let sh: string | undefined;
    let sv: string | undefined;
    if (short.length === 1) [sh, sv] = short[0] === 'top' || short[0] === 'bottom' ? ['center', short[0]] : [short[0], 'center'];
    else if (short.length >= 2) [sh, sv] = short[0] === 'top' || short[0] === 'bottom' || short[1] === 'left' || short[1] === 'right' ? [short[1], short[0]] : [short[0], short[1]];
    const ph = at('background-position-horizontal') ?? sh;
    const pv = at('background-position-vertical') ?? sv;
    const posOf = (p: string | undefined, keys: string[]): BackgroundImage['x'] | undefined => {
      if (!p) return undefined;
      if (keys.includes(p)) return p as never;
      if (/^-?\d*\.?\d+%$/.test(p)) return p as `${number}%`;
      return this.len(p, ctx.fontSize);
    };
    const x = posOf(ph, ['left', 'center', 'right']);
    const y = posOf(pv, ['top', 'center', 'bottom']) as BackgroundImage['y'] | undefined;
    if (x !== undefined) bi.x = x;
    if (y !== undefined) bi.y = y;
    const w = this.len(this.attr(el, 'axf:background-content-width') ?? this.attr(el, 'background-content-width'), ctx.fontSize);
    const h = this.len(this.attr(el, 'axf:background-content-height') ?? this.attr(el, 'background-content-height'), ctx.fontSize);
    if (w !== undefined) bi.width = w;
    if (h !== undefined) bi.height = h;
    return bi;
  }

  private idOf(n: XEl): { id?: string } {
    const id = this.attr(n, 'id');
    // index-key (§7.24.2) の付いた要素は、索引の鍵の付いた所。id が無ければ作る (その id の置かれたページを、索引が引く)
    if (n.hasAttribute?.('index-key')) return { id: this.indexEntryOf(n, this.attr(n, 'index-key') ?? '', id).id };
    return id ? { id } : {};
  }

  // ───────────────────────── 子要素の変換 ─────────────────────────

  /** 子ノードを変換し、FO の空白規則 (連続空白の畳み込み・ブロック境界の除去) を適用する */
  private children(el: XEl, ctx: Ctx, edgeTrim = true): Array<LBlockLevel | LInlineLevel> {
    type Item = { v: LBlockLevel | LInlineLevel; block: boolean };
    const items: Item[] = [];
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 || n.nodeType === 4) {
        // capitalize: 互換モードでは、語の残りの字を小文字にする
        let t = applyTextTransform(this.refineText(n.textContent ?? '', ctx.ws), ctx.textTransform, { lowerRest: !this.spec });
        // static-content の文字の中の「{pageNumber}」「{totalPages}」は、ページ番号の印ではなく文字 (組むときに置き換えない印にする)
        if (ctx.inStatic) t = t.replace(/\{(pageNumber|totalPages)\}/g, '\u0000$1\u0000');
        // 変更バー: この文字の所で効いているものが、親の要素の始まりと違えば (親の中で始まった・終わった)、その並びを付けた inline に包む
        const cb = this.barsAt ? (this.barsAt.get(n) ?? NO_BARS) : undefined;
        if (t && cb && cb !== (this.barsAt!.get(el) ?? NO_BARS) && !isXmlSpaceOnly(t)) {
          const kids = this.smallCapsOf(ctx.ws.treatment !== 'preserve' ? this.punctuationSpacing(t, ctx) : [t], ctx);
          items.push({ v: { type: 'inline', changeBars: cb, children: kids } as LInline, block: false });
        } else if (t) items.push({ v: t, block: false });
      } else if (n.nodeType === 1) {
        // 段をまたぐブロックは、本文の幅で組む。その中の要素は段組の外と同じ
        const span = ctx.spanW !== undefined && this.attr(n as XEl, 'span') === 'all';
        const { spanW, ...rest } = ctx;
        const c = spanW === undefined ? ctx : span ? { ...rest, width: spanW, cbW: spanW } : rest;
        for (const r of this.element(n, c as Ctx)) items.push(r);
      }
    }
    // 隣り合う文字列を連結
    const merged: Item[] = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      if (typeof it.v === 'string' && last && typeof last.v === 'string') last.v += it.v;
      else merged.push({ ...it });
    }
    const hasBlock = merged.some((i) => i.block);
    const out: Array<LBlockLevel | LInlineLevel> = [];
    merged.forEach((it, k) => {
      if (typeof it.v === 'string' && ctx.ws.treatment !== 'preserve') {
        let t = it.v;
        const prev = merged[k - 1];
        const next = merged[k + 1];
        if ((edgeTrim && k === 0) || (hasBlock && prev?.block)) t = t.replace(/^ /, '');
        if ((edgeTrim && k === merged.length - 1) || (hasBlock && next?.block)) t = t.replace(/ $/, '');
        // ブロックの隣の、空白だけの文字列は消す (XML の空白だけ。改行しない空白 U+00A0 などは中身として残す)。
        // inline と inline の間の空白は、子にブロックがあっても語の間の空白として残す (§7.16.8・§7.16.12)
        if (hasBlock && isXmlSpaceOnly(t) && (!prev || prev.block || !next || next.block)) t = '';
        if (t) out.push(...this.smallCapsOf(this.punctuationSpacing(t, ctx), ctx));
      } else if (typeof it.v === 'string') out.push(...this.smallCapsOf([it.v], ctx));
      else out.push(it.v);
    });
    // 行の先頭・末尾の空白だけを消す (§7.16.8)。inline の中の空白は、inline の端でも残し、
    // 段落の端に来る inline の中のものだけをここで消す
    if (edgeTrim && ctx.ws.treatment !== 'preserve') {
      this.trimInlineEdge(out, 'start');
      this.trimInlineEdge(out, 'end');
    }
    return out;
  }

  /** font-variant="small-caps" の中の字の並びを、small caps の印を付けた inline に包む (LInline.smallCaps。HTML の font-variant と同じ受け皿) */
  private smallCapsOf(kids: LInlineLevel[], ctx: Ctx): LInlineLevel[] {
    return ctx.smallCaps ? [{ type: 'inline', smallCaps: 'small', children: kids } as LInline] : kids;
  }

  /** 段落の端 (最初または最後) にある inline の中の、端の空白を消す */
  private trimInlineEdge(list: Array<LBlockLevel | LInlineLevel>, side: 'start' | 'end') {
    let cur: Array<LBlockLevel | LInlineLevel> | undefined = list;
    while (cur && cur.length) {
      const k = side === 'start' ? 0 : cur.length - 1;
      const v = cur[k];
      if (typeof v === 'string') {
        const t = side === 'start' ? v.replace(/^ /, '') : v.replace(/ $/, '');
        if (t) cur[k] = t;
        else {
          cur.splice(k, 1);
          continue;
        }
        return;
      }
      if ((v as { type: string }).type !== 'inline') return;
      cur = (v as LInline).children as Array<LBlockLevel | LInlineLevel>;
    }
  }

  /**
   * 文字列の空白・改行の整形 (§7.16.7 linefeed-treatment → §7.16.8 white-space-treatment → §7.16.12 white-space-collapse の順)。
   * ブロック境界 (先頭・末尾) の空白の除去は children() が行う。タブは空白 1 つとして扱う (字幅はフォントの空白)
   */
  private refineText(raw: string, ws: WhiteSpace): string {
    let t = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    // 改行
    if (ws.linefeed === 'ignore') t = t.replace(/\n/g, '');
    else if (ws.linefeed === 'treat-as-space') t = t.replace(/\n/g, ' ');
    else if (ws.linefeed === 'treat-as-zero-width-space') t = t.replace(/\n/g, '\u200B');
    // 改行の前後の空白 (改行を残す場合に意味がある)
    if (ws.treatment === 'ignore') t = t.replace(/ /g, ''); // XML の空白 (U+0020・タブ・CR) は消す。NBSP は空白ではない
    else if (ws.treatment !== 'preserve') {
      if (ws.treatment === 'ignore-if-before-linefeed' || ws.treatment === 'ignore-if-surrounding-linefeed') t = t.replace(/ +\n/g, '\n');
      if (ws.treatment === 'ignore-if-after-linefeed' || ws.treatment === 'ignore-if-surrounding-linefeed') t = t.replace(/\n +/g, '\n');
    }
    // 連続する空白を 1 つに
    if (ws.collapse) t = t.replace(/ {2,}/g, ' ');
    return t;
  }

  private element(n: XEl, ctx: Ctx): Array<{ v: LBlockLevel | LInlineLevel; block: boolean }> {
    // アンテナハウスの自動脚注番号: 参照側の axf:footnote-number は脚注の自動連番 (footnote() で扱う)、本体の citation は番号に置き換わる
    const axf = n.nodeName.startsWith('axf:') ? this.name(n) : '';
    if (axf === 'footnote-number') return [];
    if (axf === 'footnote-number-citation') return [{ v: { type: 'footnote-citation' }, block: false }];
    // フォーム: axf:form は送り先を中の欄へ伝えるだけの入れ物、axf:form-field は行内の欄
    if (axf === 'form') {
      const saved = this.form;
      const url = this.attr(n, 'external-destination');
      const method = this.attr(n, 'axf:field-submit-method');
      // 送り先の URL も、リンクと同じ決まりでスキームを見る (スキームの無い相対の送り先は、そのまま)
      const dest = url ? this.allowedSubmitUrl(url.replace(/^url\(\s*['"]?([\s\S]*?)['"]?\s*\)$/i, '$1')) : undefined;
      this.form = { ...(dest ? { url: dest } : {}), ...(method === 'get' || method === 'post' ? { method } : {}) };
      const kids = this.children(n, ctx);
      this.form = saved;
      return kids.map((v) => ({ v, block: typeof v !== 'string' && ['block', 'table', 'block-container', 'float'].includes((v as { type: string }).type) }));
    }
    if (axf === 'form-field') return [{ v: this.formField(n, ctx), block: false }];
    if (!this.isFo(n)) {
      this.miss(`${n.nodeName}`);
      return [];
    }
    const tag = this.name(n);
    const one = (v: LBlockLevel | LInlineLevel, block: boolean) => [{ v, block }];
    // fo:folio-prefix・fo:folio-suffix の中身は字と行内の要素で、ページ番号 (fo:page-number・fo:page-number-citation・-last) は置けない
    // (XSL 1.1 §6.6.13・§6.6.14 の Contents)。ページ番号を読むと、その前後にまた中身を付けることになり終わらないので、読まずに報告する。
    // ブロックの要素は、行内の領域の中に置けないので、同じく読まずに報告する
    if (this.inFolio && /^(page-number|page-number-citation|page-number-citation-last|block|block-container|table|table-and-caption|list-block|float|footnote|marker|retrieve-marker)$/.test(tag)) {
      this.miss(`fo:${tag} (${this.inFolio} の中)`);
      return [];
    }
    // relative-position="relative" (§7.13.5): 組版が受けられるのは横書きの fo:block だけ (組んだ箱をずらす)。ほかの要素では読まずに報告する
    if (tag !== 'block' && tag !== 'table-caption' && this.attr(n, 'relative-position') === 'relative') this.miss(`relative-position (fo:${tag})`);
    switch (tag) {
      // 表の見出し (table-caption) は、自身の書式 (文字の大きさ・揃え・余白) を持つブロックとして組む
      case 'table-caption':
      case 'block': {
        const { style, ctx: c2 } = this.textStyle(n, ctx);
        const box = this.boxStyle(n, c2, ctx);
        // 子が継承する indent = この block の内容端 (親の内容端 + margin + border + padding)
        const edge = (side: 'top' | 'right' | 'bottom' | 'left') =>
          ((box.margin as Record<string, number> | undefined)?.[side] ?? 0) + ((box.padding as Record<string, number> | undefined)?.[side] ?? 0) + ((box.border as Record<string, { width: number } | undefined> | undefined)?.[side]?.width ?? 0);
        const c3: Ctx = { ...c2, startIndent: ctx.startIndent + edge(this.phys('start', ctx.wm, ctx.rtl)), endIndent: ctx.endIndent + edge(this.phys('end', ctx.wm, ctx.rtl)) };
        // 子の包含ブロックの幅 = このブロックの内容の幅
        const cbw = box.width ?? (this.cbW(ctx) !== undefined ? Math.max(this.cbW(ctx)! - edge(this.phys('start', ctx.wm, ctx.rtl)) - edge(this.phys('end', ctx.wm, ctx.rtl)), 0) : undefined);
        if (cbw !== undefined) c3.cbW = cbw;
        // 子の包含ブロックの高さ: このブロックの高さの指定があればその値。無ければ百分率は auto
        c3.cbH = box.height;
        if (box.width !== undefined && c3.wm === 'horizontal-tb') c3.width = box.width;
        this.report.counts.blocks++;
        const blk: LBlock = { type: 'block', ...this.idOf(n), ...style, ...box, children: this.children(n, c3) };
        // fo:initial-property-set (§6.6.4): 最初の行の書式
        const ips = this.els(n).find((e) => this.isFo(e) && this.name(e) === 'initial-property-set');
        if (ips) this.firstLineOf(blk, ips, c3);
        const clr = this.clearOf(n);
        if (clr) blk.clear = clr;
        // relative-position (§7.13.5): 組んだ箱をずらす。縦書きの箱と、負の z-index (背面に置く) は、組版に受け皿が無いので報告する
        const rel = this.relativeOffsetOf(n, c2);
        if (rel && ctx.wm !== 'horizontal-tb') this.miss('relative-position (縦書き)');
        else if (rel) {
          if (rel.x || rel.y) blk.relativeOffset = rel;
          if (this.zIndexOf(n) < 0) this.miss('z-index (relative-position)');
        }
        // 互換モード: 中身の無いブロック (空白だけ。枠・背景・寸法も無い) の space-before は、次のブロックの
        // space-before と重ならずに足し合わさる。その高さの空のブロックにする
        const bAxis = this.phys('before', ctx.wm, ctx.rtl);
        const sb = (box.margin as Record<string, number> | undefined)?.[bAxis];
        if (!this.spec && sb && sb > 0 && !blk.children.length && !box.border && !box.padding && !box.backgroundColor && box.width === undefined && box.height === undefined && !blk.id && ctx.wm === 'horizontal-tb') {
          const { [bAxis]: _drop, ...restM } = box.margin as Record<string, number>;
          void _drop;
          const spacer: LBlock = { type: 'block', ...style, ...box, margin: restM, height: sb, ...(clr ? { clear: clr } : {}), children: [] };
          delete spacer.retainSpaceBefore;
          return one(spacer, true);
        }
        const ban = this.annotation(n, c3);
        if (ban) blk.annotation = ban;
        // axf:outline-level: しおりの項目にする (飛び先の id が無ければ付ける)
        const ol = parseInt(this.attr(n, 'axf:outline-level') ?? '', 10);
        if (Number.isFinite(ol) && ol > 0) {
          blk.id ??= `kumiori-outline-${++this.outlineSeq}`;
          const title = this.attr(n, 'axf:outline-title') ?? (n.textContent ?? '').replace(/\s+/g, ' ').trim();
          this.outlines.push({ level: ol, title, id: blk.id, group: this.attr(n, 'axf:outline-group') });
        }
        return one(blk, true);
      }
      case 'inline':
      case 'bidi-override':
      case 'basic-link':
      case 'wrapper': {
        const { style, ctx: c2 } = this.textStyle(n, ctx);
        const kids = this.children(n, c2, false);
        const blockish = kids.some((k) => typeof k !== 'string' && ['block', 'table', 'block-container', 'float'].includes((k as { type: string }).type));
        const link = tag === 'basic-link' ? this.linkOf(n) : undefined;
        if (blockish) {
          this.trimInlineEdge(kids, 'start');
          this.trimInlineEdge(kids, 'end');
        }
        if (blockish) return one({ type: 'block', ...this.idOf(n), ...style, ...(link ? { link } : {}), children: kids } as LBlock, true);
        const bg = c2.hidden ? undefined : this.color(this.attr(n, 'background-color'));
        const inl: LInline = { type: 'inline', ...this.idOf(n), ...style, children: kids as LInlineLevel[] };
        // index-key の付いた行内の要素がページをまたぐとき、領域のあるページすべてを引く (§6.10.6)。行内の id の記録は最初の字の
        // ページだけなので、中身の終わりに目印 (幅の無い行内の箱) を置いて、最後のページを引けるようにする
        // 中身の無いもの (索引の位置だけを示す fo:wrapper) は、領域を作らない目印
        const ie = this.indexEls.get(n);
        if (ie && !kids.length) ie.point = true;
        else if (ie && !ie.range) {
          ie.endId ??= `${ie.id}-kumiori-index-end`;
          inl.children.push({ type: 'inline', id: ie.endId, children: [] });
        }
        if (bg) inl.backgroundColor = bg;
        // unicode-bidi (embed・bidi-override。§7.29.6): 中身の前後に双方向の制御文字を入れたものとして並べる (§5.8)
        const ub = this.attr(n, 'unicode-bidi');
        if (ub === 'embed' || ub === 'bidi-override') inl.unicodeBidi = ub;
        // 文字を囲む罫線・余白
        const ib = this.border(n, c2);
        const ip = this.padding(n, c2);
        if (ib) inl.border = ib;
        if (ip) inl.padding = ip;
        // 行の進む方向の外側の空き: space-start・space-end (§7.12.5・§7.12.6)。無ければ、その辺の margin (§7.11.4 の対応)
        {
          const sSide = this.phys('start', c2.wm, c2.rtl);
          const eSide = this.phys('end', c2.wm, c2.rtl);
          const sp = (rel: 'start' | 'end', side: string) =>
            this.len(this.attrOpt(n, `space-${rel}`) ?? this.attr(n, `margin-${side}`), c2.fontSize, this.cbW(ctx));
          const ms = sp('start', sSide);
          const me = sp('end', eSide);
          if (ms || me) inl.inlineMargin = { ...(ms ? { start: ms } : {}), ...(me ? { end: me } : {}) };
        }
        // inline の keep-together (略記を含む) は within-line: 行の途中で分割しない
        if (this.keepOf(n, 'keep-together', ['line', ''])) inl.noBreak = true;
        const ipd = this.len(this.attr(n, 'inline-progression-dimension.optimum') ?? this.attr(n, 'inline-progression-dimension'), c2.fontSize, ctx.width);
        if (ipd !== undefined && ipd > 0 && c2.wm === ctx.wm) inl.width = ipd;
        if (link) inl.link = link;
        const an = this.annotation(n, c2);
        if (an) inl.annotation = an;
        const bs = this.attr(n, 'baseline-shift');
        if (bs === 'super' || bs === 'sub') inl.baselineShift = bs;
        else if (bs && bs !== 'baseline') {
          // em はこの inline の font-size、百分率は親の line-height が基準 (§7.14.3)
          const v = this.len(bs, c2.fontSize, this.lineHeightOf(ctx));
          if (v !== undefined) inl.baselineShift = v;
          else this.miss('baseline-shift');
        }
        return one(inl, false);
      }
      case 'character': {
        // character の値は空白でもよい (前後を削らない)。字の書式 (色・書体など) も当てる (§6.6.3)
        const ch = n.getAttribute?.('character') ?? '';
        const { style, ctx: c2 } = this.textStyle(n, ctx);
        const id = this.idOf(n);
        return one(Object.keys(style).length || Object.keys(id).length || c2.smallCaps ? ({ type: 'inline', ...id, ...style, ...(c2.smallCaps ? { smallCaps: 'small' as const } : {}), children: [ch] } as LInlineLevel) : ch, false);
      }
      case 'inline-container':
        return this.inlineContainer(n, ctx);
      case 'index-page-citation-list':
        return one(this.indexCitationList(n, ctx), false);
      case 'index-range-begin': {
        // “Each fo:index-range-begin formatting object must specify both an id and an index-key property.” (§6.10.4)
        // 領域を作らない (“does not generate any area”) ので、id の位置を記録するだけの、幅の無い目印にする
        const id = this.attr(n, 'id');
        if (!id || !n.hasAttribute?.('index-key')) {
          this.miss('fo:index-range-begin (id と index-key が要る)');
          return [];
        }
        const e = this.indexEntryOf(n, this.attr(n, 'index-key') ?? '', id);
        e.range = true;
        e.point = true;
        if (!this.indexRanges.has(id)) this.indexRanges.set(id, e);
        return one({ type: 'inline', id: e.id, children: [] } as LInline, false);
      }
      case 'index-range-end': {
        // 組になるのは、ref-id が id と同じ fo:index-range-begin で、文書の中で前にあるもの。無ければ
        // “it is an error, and the implementation should recover by ignoring this fo:index-range-end” (§6.10.5)
        let endId = this.indexEnds.get(n);
        if (endId === undefined) {
          const b = this.indexRanges.get(this.attr(n, 'ref-id') ?? '');
          if (!b || b.endId !== undefined) {
            this.note(msg(`fo:index-range-end ref-id="${this.attr(n, 'ref-id') ?? ''}" と組になる fo:index-range-begin がありません (無視します)`, `fo:index-range-end ref-id="${this.attr(n, 'ref-id') ?? ''}" has no matching fo:index-range-begin (ignored)`));
            return [];
          }
          endId = b.endId = `${b.id}-kumiori-index-end`;
          this.indexEnds.set(n, endId);
        }
        return one({ type: 'inline', id: endId, children: [] } as LInline, false);
      }
      case 'leader':
        return one(this.leader(n, ctx), false);
      case 'page-number': {
        // static-content の中は、ページごとに置き換える印。本文の中は、その場所 (印を付けた行内) のページ番号の参照にする (XSL 1.1 §6.6.10:
        // 本文の fo:page-number は、それを含むページの番号)
        // 要素自身の字の書式 (color・font-weight など。§6.6.10 の共通フォント特性) は、page-number-citation と同じく行内の箱で当てる
        // 番号の前後には、この page-sequence の fo:folio-prefix・fo:folio-suffix の中身を付ける (§6.6.10)
        const { style, ctx: c2 } = this.textStyle(n, ctx);
        if (ctx.inStatic) {
          const parts = this.withFolio('{pageNumber}', ctx.seqEl, c2);
          return one(Object.keys(style).length || parts ? ({ type: 'inline', ...style, children: parts ?? ['{pageNumber}'] } as LInline) : '{pageNumber}', false);
        }
        const pid = `kumiori-page-number-${++this.pageNumberSeq}`;
        const cit: LPageNumberCitation = { type: 'page-number-citation', refId: pid };
        return one({ type: 'inline', id: pid, ...style, children: this.withFolio(cit, ctx.seqEl, c2) ?? [cit] } as LInlineLevel, false);
      }
      case 'page-number-citation':
      case 'page-number-citation-last':
        // axf:physical-page-number="true" (アンテナハウスの拡張): initial-page-number によらない物理的なページ番号
        {
          const cit: LPageNumberCitation = { type: 'page-number-citation', refId: this.attr(n, 'ref-id') ?? '', ...(tag.endsWith('last') ? { last: true } : {}), ...(this.attr(n, 'axf:physical-page-number') === 'true' ? { physical: true } : {}) };
          // 要素自身の字の書式 (color・font-size など。§6.6.11 の共通フォント特性・color) は、行内の箱で包んで当てる
          const { style, ctx: c2 } = this.textStyle(n, ctx);
          // 番号の前後には、引いたページを作った page-sequence の fo:folio-prefix・fo:folio-suffix の中身を付ける (§6.6.11・§6.6.12:
          // “using the cited page as the reference-page, and the fo:page-sequence that generated the cited-page as the reference-page-sequence”)。
          // 引いた先は、ref-id の要素を含む page-sequence (-last は最後のもの)。物理的なページ番号 (axf:physical-page-number) には付けない
          const cited = this.idSeqs?.get(cit.refId);
          const parts = cit.physical ? undefined : this.withFolio(cit, cit.last ? cited?.last : cited?.first, c2);
          return one(Object.keys(style).length || parts ? ({ type: 'inline', ...style, children: parts ?? [cit] } as LInline) : cit, false);
        }
      case 'external-graphic':
      case 'instream-foreign-object': {
        // 数式 (MathML) は、行内の要素 (上付き・下付き・分数の箱など) に組み替えて、本文と同じ書体で組む
        const fr = tag === 'instream-foreign-object' ? this.foreignRoot(n) : this.externalMath(n);
        const math = fr && this.name(fr) === 'math' ? fr : undefined;
        // visibility (§7.30.17): 画像・数式そのものの指定が親と違うときは、字の色 (見えないときは transparent) を持つ行内の箱で包む
        // (画像は、字の色が transparent なら描かない)
        const hid = this.hiddenOf(n, ctx.hidden);
        const shown = (v: LInlineLevel): LInlineLevel => (hid === !!ctx.hidden ? v : ({ type: 'inline', color: hid ? 'transparent' : (ctx.color ?? '#000000'), children: [v] } as LInline));
        if (math) {
          // 数式の図形は、周りの字の色で描く (mathcolor があれば、その中はその色)
          this.foMath.mathColor = ctx.color ?? '#000000';
          // 字の大きさ・色は、instream-foreign-object・external-graphic の font-size・color も見る
          if (this.opts.mathFont) return one(shown(this.mathFormula(math, this.textStyle(n, ctx).ctx, n)), false);
          return one(shown(this.foMath.mathml(math, ctx.fontSize)), false);
        }
        return one(shown(this.image(n, hid === !!ctx.hidden ? ctx : { ...ctx, hidden: hid }, tag === 'external-graphic')), false);
      }
      case 'block-container':
        this.clearOf(n, false);
        return one(this.blockContainer(n, ctx), true);
      case 'float': {
        this.clearOf(n, false);
        // float="none" (初期値) は、浮動しない普通のブロックにする (§7.19.2 の float の none の説明)。互換モードは start の浮動
        if (this.spec && (this.attr(n, 'float') ?? 'none') === 'none') return this.children(n, this.textStyle(n, ctx).ctx).map((v) => ({ v, block: true }));
        return one(this.float(n, ctx), true);
      }
      case 'footnote':
        return one(this.footnote(n, ctx), false);
      case 'marker': {
        // fo:marker の中の fo:marker: fo:marker は fo:flow の子孫で、fo:marker の子孫であってはならない (XSL 1.1 §6.13.5 の Constraints)。
        // 読むと、外の marker を取り出すたびに中の marker が増えるので、読まずに読み込みの報告に数える
        if (this.inMarker) {
          this.miss('fo:marker (fo:marker の中)');
          return [];
        }
        return one(this.marker(n, ctx), true);
      }
      case 'retrieve-marker': {
        // fo:marker の中の fo:retrieve-marker: fo:retrieve-marker は fo:static-content の子孫に限られ (XSL 1.1 §6.13.6 の Constraints)、
        // fo:marker は fo:flow の子孫に限られる (§6.13.5) ので、fo:marker の中には置けない。読むと、取り出した中身がまた marker を
        // 取り出すことになり終わらないので、読まずに読み込みの報告に数える
        if (this.inMarker) {
          this.miss('fo:retrieve-marker (fo:marker の中)');
          return [];
        }
        const pos = this.attr(n, 'retrieve-position') ?? 'first-starting-within-page';
        const bd = this.attr(n, 'retrieve-boundary') ?? 'page-sequence';
        const r: LRetrieveMarker = { type: 'retrieve-marker', className: this.attr(n, 'retrieve-class-name') ?? '' };
        if (pos === 'first-starting-within-page' || pos === 'first-including-carryover' || pos === 'last-starting-within-page' || pos === 'last-ending-within-page') r.position = pos;
        if (bd === 'page' || bd === 'page-sequence' || bd === 'document') r.boundary = bd;
        this.retrieves.push({ r, ctx });
        return one(r, true);
      }
      case 'initial-property-set':
        // fo:block の子は、ブロックを読む所で最初の行の書式にする (firstLineOf)。ほかの所には置けない (§6.6.4: fo:block の最初の行の書式)
        if (this.parents.get(n) && this.isFo(this.parents.get(n)!) && this.name(this.parents.get(n)!) === 'block') return [];
        this.miss('fo:initial-property-set (fo:block の子でない)');
        return [];
      case 'change-bar-begin':
      case 'change-bar-end':
        // 変更バーの範囲は、先に文書の順にたどって決めてある (prepareChangeBars)。ここでは何も作らない
        return [];
      case 'retrieve-table-marker': {
        // fo:retrieve-table-marker は fo:table-header・fo:table-footer の子孫に限る (XSL 1.1 §6.13.7 の Constraints)。fo:marker の中にも置けない (§6.13.5)
        if (this.inMarker || !this.inTableHF) {
          this.miss(this.inMarker ? 'fo:retrieve-table-marker (fo:marker の中)' : 'fo:retrieve-table-marker (fo:table-header・fo:table-footer の外)');
          return [];
        }
        const pos = this.attr(n, 'retrieve-position-within-table') ?? 'first-starting';
        const bd = this.attr(n, 'retrieve-boundary-within-table') ?? 'table';
        const r: LRetrieveTableMarker = { type: 'retrieve-table-marker', className: this.attr(n, 'retrieve-class-name') ?? '' };
        if (pos === 'first-starting' || pos === 'first-including-carryover' || pos === 'last-starting' || pos === 'last-ending') r.position = pos;
        else this.miss(`retrieve-position-within-table="${pos}"`);
        if (bd === 'table' || bd === 'table-fragment' || bd === 'page') r.boundary = bd;
        else this.miss(`retrieve-boundary-within-table="${bd}"`);
        this.retrieves.push({ r, ctx });
        return one(r, true);
      }
      case 'table-and-caption':
        this.clearOf(n, false);
        return this.tableAndCaption(n, ctx);
      case 'table':
        this.clearOf(n, false);
        return one(this.table(n, ctx), true);
      case 'list-block':
        this.clearOf(n, false);
        return one(this.listBlock(n, ctx), true);
      case 'multi-switch': {
        // fo:multi-switch は、見えている fo:multi-case のエリアだけを返す (XSL 1.1 §6.9.3)。最初に見えているのは、
        // starting-state が show (初期値。§7.23.10) の最初の fo:multi-case。無ければ何も返さない。
        // PDF では切り替えられないので、その fo:multi-case だけを組み、ほかの fo:multi-case は組まない
        const shown = this.els(n).find((c) => this.isFo(c) && this.name(c) === 'multi-case' && (this.attr(c, 'starting-state') ?? 'show') === 'show');
        const cases = this.els(n).filter((c) => this.isFo(c) && this.name(c) === 'multi-case').length;
        if (cases > 1 || !shown) this.note(msg('fo:multi-switch: starting-state が show の最初の fo:multi-case だけを組み、ほかの fo:multi-case は組みませんでした', 'fo:multi-switch: only the first fo:multi-case with starting-state="show" was typeset; the other fo:multi-case elements were skipped'));
        if (!shown) return [];
        return this.children(shown, ctx).map((v) => ({ v, block: typeof v !== 'string' && (v as { type: string }).type === 'block' }));
      }
      default:
        this.miss(`fo:${tag}`);
        return this.children(n, ctx).map((v) => ({ v, block: typeof v !== 'string' && (v as { type: string }).type === 'block' }));
    }
  }

  // ── 数式 (数式用の書体 (MATH 表) で組む。書体が無いときの後備は foMathFallback.ts) ──
  /**
   * 数式を、数式用の書体の MATH 表の値で組み (mathLayout)、字の輪郭の SVG の画像にする。
   * 画像の下端を、数式の基線から下の深さだけ、行の基線より下げる
   */
  private mathFormula(math: XEl, ctx: Ctx, el?: XEl): LInlineLevel {
    const r = layoutMathML(math as unknown as MNode, {
      font: this.opts.mathFont!,
      fallback: this.opts.mathFallback,
      compat: this.spec ? 'spec' : 'antenna',
      size: ctx.fontSize,
      lineWidth: ctx.width,
      color: toCss(ctx.color ?? '#000000'),
      parseColor: (v) => {
        const c = this.color(v);
        return c ? toCss(c) : undefined;
      },
    });
    const src = `data:image/svg+xml;base64,${utf8Base64(r.svg)}`;
    this.addImage(src);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // content-width / content-height (§7.15.3・§7.15.4): 数式の図形を、縦横の比を保って (scaling の既定 uniform) その大きさに拡大縮小する。
    // 百分率は数式本来の大きさに対する倍率。auto・scale-to-fit などは本来の大きさのまま
    const s = el ? this.mathScale(el, ctx, r.width, r.ascent + r.descent) : 1;
    const img: LImage = { type: 'image', src, width: r2(r.width * s), height: r2((r.ascent + r.descent) * s) };
    return r.descent > 0 ? { type: 'inline', baselineShift: -r2(r.descent * s), children: [img] } : img;
  }

  /** 数式の図形の拡大縮小の倍率 (content-width を先に見て、無ければ content-height) */
  private mathScale(el: XEl, ctx: Ctx, w: number, h: number): number {
    const one = (v: string | undefined, base: number) => {
      const t = v?.trim();
      if (!t || /^(auto|scale-to-fit|scale-down-to-fit|scale-up-to-fit)$/.test(t) || !(base > 0)) return undefined;
      if (/^\d*\.?\d+%$/.test(t)) return parseFloat(t) / 100;
      const len = this.len(t, ctx.fontSize, ctx.width);
      return len !== undefined && len > 0 ? len / base : undefined;
    };
    return one(this.attr(el, 'content-width'), w) ?? one(this.attr(el, 'content-height'), h) ?? 1;
  }

  /** いま中にいる axf:form の送り先 */
  private form?: { url?: string; method?: 'get' | 'post' };
  private fieldSeq = 0;

  /** axf:form-field: 罫線・余白・大きさを持つ行内の箱 (中身は空) と、PDF のフォームの欄 */
  private formField(n: XEl, ctx: Ctx): LInlineContainer {
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    // 行内の箱なので、start-indent・end-indent による余白の調整はしない (罫線・パディングは内容の外に足す)
    const box = this.boxStyle(n, c2, ctx, false);
    const a = (k: string) => this.attr(n, `axf:field-${k}`);
    const bool = (k: string) => a(k) === 'true';
    const type = a('type') ?? 'text';
    const kinds: Record<string, FormField['kind']> = { text: 'text', checkbox: 'checkbox', radio: 'radio', listbox: 'listbox', combobox: 'combobox', button: 'button' };
    const kind = kinds[type] ?? 'text';
    if (!kinds[type]) this.miss(`axf:field-type="${type}"`);
    const field: FormField = { kind, name: a('name') ?? `${kind}-${++this.fieldSeq}` };
    const desc = a('description');
    if (desc) field.description = desc;
    const def = a('default-text');
    const val = a('value');
    if (kind === 'text' && def) field.value = def;
    if ((kind === 'checkbox' || kind === 'radio') && val) field.value = val;
    if (bool('checked')) field.checked = true;
    if (bool('password')) field.password = true;
    if (bool('multiline')) field.multiline = true;
    if (bool('required')) field.required = true;
    if (bool('readonly')) field.readOnly = true;
    if (bool('multiple')) field.multiple = true;
    if (bool('editable')) field.editable = true;
    const ml = parseInt(a('maxlen') ?? '', 10);
    if (ml > 0) field.maxLength = ml;
    const opts = this.els(n).filter((e) => this.name(e) === 'form-field-option');
    if (opts.length) {
      field.options = opts.map((o) => {
        const label = (o.textContent ?? '').trim();
        const v = this.attr(o, 'field-value') ?? this.attr(o, 'axf:field-value') ?? label;
        return { value: v, label, ...(this.attr(o, 'selected') === 'true' || this.attr(o, 'axf:field-selected') === 'true' ? { selected: true } : {}) };
      });
      // 最初の選択項目 (axf:field-top-index。先頭は 1、範囲の外は 1。axf:field-selected の指定があればそちらが優先)
      if ((kind === 'listbox' || kind === 'combobox') && !field.options.some((o) => o.selected)) {
        const ti = parseInt(a('top-index') ?? '1', 10);
        field.options[ti >= 1 && ti <= field.options.length ? ti - 1 : 0].selected = true;
      }
    }
    if (kind === 'checkbox' || kind === 'radio') {
      const cs = a('checked-style');
      const styles = ['checkmark', 'circle', 'square', 'cross', 'star'] as const;
      if (cs && (styles as readonly string[]).includes(cs)) field.checkStyle = cs as FormField['checkStyle'];
      else if (cs) this.miss(`axf:field-checked-style="${cs}"`);
    }
    if (kind === 'button') {
      field.caption = a('button-face') ?? '';
      const act = this.attr(n, 'axf:action-type');
      if (act === 'submit' || act === 'reset') field.action = act;
      if (act === 'submit') {
        if (this.form?.url) field.submitUrl = this.form.url;
        if (this.form?.method) field.submitMethod = this.form.method;
      }
    }
    // 欄に表示する文字の大きさ (axf:field-font-size。既定 font-size: font-size の値、auto: 自動、長さ: その大きさ)
    const ffs = a('font-size');
    if (ffs === 'auto') field.fontSize = 'auto';
    else if (ffs && ffs !== 'font-size') {
      const v = this.len(ffs, c2.fontSize, c2.fontSize);
      if (v !== undefined && v > 0) field.fontSize = v;
      else {
        this.miss(`axf:field-font-size="${ffs}"`);
        field.fontSize = c2.fontSize;
      }
    } else field.fontSize = c2.fontSize;
    if (style.color) field.color = style.color;
    // 大きさの指定が無ければ: チェックボックス・ラジオは 1 字角、ボタンは表示の文字の幅、それ以外は 100pt × 1 行
    const fs = c2.fontSize;
    const small = kind === 'checkbox' || kind === 'radio';
    box.width ??= small ? fs : kind === 'button' ? Math.max(fs * 4, (field.caption?.length ?? 0) * fs * 0.6 + fs) : 100;
    box.height ??= small ? fs : kind === 'listbox' ? fs * 1.3 * Math.min(field.options?.length ?? 1, 4) : fs * 1.4;
    return { type: 'inline-container', ...this.idOf(n), ...style, ...(box as object), formField: field, children: [] };
  }

  /** 段罫 (axf:column-rule-style / -width / -color)。線種が none なら無し */
  columnRule(el: XEl, fs: number): BorderSide | undefined {
    const crs = this.attr(el, 'axf:column-rule-style');
    if (!crs || crs === 'none' || crs === 'hidden') return undefined;
    const named: Record<string, number> = this.borderKeywords;
    const crw = this.attr(el, 'axf:column-rule-width');
    return {
      width: (crw ? named[crw] : undefined) ?? this.len(crw, fs) ?? named.medium,
      color: this.color(this.attr(el, 'axf:column-rule-color')) ?? '#000000',
      ...(crs !== 'solid' ? { style: crs as BorderSide['style'] } : {}),
    };
  }

  /** 行番号 (axf:line-number-*)。この要素で指定されたものだけ (子へは resolveStyle で重ねて引き継ぐ) */
  private lineNumbering(el: XEl, fs: number): LineNumbering | undefined {
    const a = (k: string) => this.attr(el, `axf:line-number${k}`);
    const ln: LineNumbering = {};
    const mode = a('');
    if (mode === 'show' || mode === 'hide' || mode === 'none') ln.mode = mode;
    const int = (k: string) => {
      const v = parseInt(a(k) ?? '', 10);
      return Number.isFinite(v) ? v : undefined;
    };
    const fmt = a('-format');
    if (fmt) ln.format = fmt;
    const initial = int('-initial');
    if (initial !== undefined) ln.initial = initial;
    const interval = int('-interval');
    if (interval !== undefined && interval > 0) ln.interval = interval;
    const start = int('-start');
    if (start !== undefined) ln.start = start;
    const reset = a('-reset');
    if (reset === 'page' || reset === 'column' || reset === 'none') ln.reset = reset;
    else if (reset === 'continue' || reset === 'no-reset') ln.reset = 'none';
    const pos = a('-position');
    if (pos === 'start' || pos === 'end' || pos === 'alternate') ln.position = pos;
    else if (pos === 'left' || pos === 'right') ln.position = pos === 'left' ? 'start' : 'end';
    const fam = a('-font-family');
    if (fam) {
      const mapped = this.opts.mapFont?.(splitFontFamily(fam), false);
      if (mapped) ln.fontFamily = mapped;
    }
    const size = this.len(a('-font-size'), fs, fs);
    if (size) ln.fontSize = size;
    const fw = a('-font-weight');
    if (fw) ln.fontWeight = fw === 'bold' ? 700 : fw === 'normal' ? 400 : parseInt(fw, 10) || 400;
    const fst = a('-font-style');
    if (fst) ln.fontStyle = fst === 'italic' || fst === 'oblique' ? 'italic' : 'normal';
    const col = this.color(a('-color'));
    if (col) ln.color = col;
    const off = this.len(a('-offset'), fs, fs);
    if (off !== undefined) ln.offset = off;
    return Object.keys(ln).length ? ln : undefined;
  }

  /**
   * 文書の外への飛び先を、通してよければ返す (前後の空白・制御文字と、タブ・改行を取り除いた文字列。linkPolicy の judgeExternalLink)。
   * 通さないものは undefined を返し、report.droppedLinks に数える
   */
  private allowedExternal(url: string): string | undefined {
    const j = judgeExternalLink(url, this.opts.links);
    if (j.allowed) return j.url;
    countDroppedLink((this.report.droppedLinks ??= {}), j);
    return undefined;
  }

  /** フォームの送り先の URL。スキームが通さないものなら undefined (数える)。スキームの無い相対の送り先は、そのまま返す */
  private allowedSubmitUrl(url: string): string | undefined {
    const j = judgeExternalLink(url, this.opts.links);
    if (j.kind !== 'uri' || j.allowed) return url;
    countDroppedLink((this.report.droppedLinks ??= {}), j);
    return undefined;
  }

  /** fo:basic-link の飛び先。external-destination は url(...) を外す。通さない飛び先 (linkPolicy) はリンクにしない */
  private linkOf(n: XEl): LinkTarget | undefined {
    const ext = this.attr(n, 'external-destination');
    if (ext) {
      const url = this.allowedExternal(ext.replace(/^url\(\s*['"]?([\s\S]*?)['"]?\s*\)$/i, '$1'));
      return url !== undefined ? { external: url } : undefined;
    }
    const int = this.attr(n, 'internal-destination');
    return int ? { internal: int } : undefined;
  }

  /** アンテナハウスの注釈 (axf:annotation-type ほか) */
  private annotation(n: XEl, ctx: Ctx): Annotation | undefined {
    const type = this.attr(n, 'axf:annotation-type')?.toLowerCase();
    if (!type) return undefined;
    const kinds: Record<string, Annotation['kind']> = { text: 'text', freetext: 'free-text', stamp: 'stamp', fileattachment: 'file-attachment' };
    const kind = kinds[type];
    if (!kind) {
      this.miss(`axf:annotation-type="${type}"`);
      return undefined;
    }
    const len = (k: string) => this.len(this.attr(n, k), ctx.fontSize);
    const an: Annotation = { kind };
    if (kind === 'file-attachment') {
      // 添付するファイル (uri-specification: url(...) か、そのままの URI) と、PDF の中のファイル名
      const fa = this.attr(n, 'axf:annotation-file-attachment')?.trim().replace(/^url\(\s*['"]?(.*?)['"]?\s*\)$/i, '$1');
      if (fa) {
        const name = this.attr(n, 'axf:annotation-file-name') || (fa.startsWith('data:') ? undefined : fa.split(/[\\/]/).pop());
        an.file = { src: fa, ...(name ? { name } : {}) };
        if (!fa.startsWith('data:')) {
          const files = (this.report.files ??= []);
          if (!files.includes(fa)) files.push(fa);
        }
      } else this.miss('axf:annotation-type="FileAttachment" (添付するファイルが無いので、テキスト注釈にする)');
    }
    const contents = this.attr(n, 'axf:annotation-contents');
    if (contents) an.contents = contents;
    const title = this.attr(n, 'axf:annotation-title');
    if (title) an.title = title;
    const color = this.color(this.attr(n, 'axf:annotation-color'));
    if (color) an.color = color;
    const tc = this.color(this.attr(n, 'axf:annotation-text-color'));
    if (tc) an.textColor = tc;
    const fs = len('axf:annotation-font-size');
    if (fs) an.fontSize = fs;
    const icon = this.attr(n, 'axf:annotation-icon-name');
    if (icon) an.icon = icon;
    if (this.attr(n, 'axf:annotation-open') === 'true') an.open = true;
    const dx = len('axf:annotation-position-horizontal');
    const dy = len('axf:annotation-position-vertical');
    const w = len('axf:annotation-width');
    const h = len('axf:annotation-height');
    if (dx !== undefined) an.dx = dx;
    if (dy !== undefined) an.dy = dy;
    if (w) an.width = w;
    if (h) an.height = h;
    // axf:annotation-flags: 空白区切りの名前 (大文字小文字は区別しない) → ISO 32000-2 §12.5.3 Table 167 のビット (1 から数える)
    const flagNames = ['invisible', 'hidden', 'print', 'nozoom', 'norotate', 'noview', 'readonly', 'locked', 'togglenoview', 'lockedcontents'];
    let flags = 0;
    for (const t of (this.attr(n, 'axf:annotation-flags') ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      const bit = flagNames.indexOf(t);
      if (bit < 0) this.miss(`axf:annotation-flags="${t}"`);
      else flags |= 1 << bit;
    }
    if (flags) an.flags = flags;
    return an;
  }

  private inlineContainer(n: XEl, ctx: Ctx): Array<{ v: LBlockLevel | LInlineLevel; block: boolean }> {
    const blocks = this.els(n).filter((e) => this.isFo(e) && this.name(e) === 'block');
    // 空白は詰める。ただし欧文の語の間の空白 (前後がどちらも ASCII の字) は 1 つ残す (「Full Ruby」)
    const text = (e: XEl) =>
      (e.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ (?=[^\x21-\x7e])|(?<=[^\x21-\x7e]) /g, '');
    if (blocks.length === 2) {
      const fsRel = (e: XEl) => {
        const v = this.attr(e, 'font-size');
        if (!v) return 1;
        return /em$/.test(v) ? parseFloat(v) : /%$/.test(v) ? parseFloat(v) / 100 : (this.len(v, ctx.fontSize) ?? ctx.fontSize) / ctx.fontSize;
      };
      if (fsRel(blocks[0]) < 0.8 && fsRel(blocks[1]) >= 0.8 && text(blocks[0]) && text(blocks[1]) && blocks.every((b) => this.els(b).length === 0)) {
        this.report.counts.rubies++;
        const r: LRuby = { type: 'ruby', baseText: text(blocks[1]), rubyText: text(blocks[0]) };
        if (fsRel(blocks[0]) > 0 && fsRel(blocks[0]) !== 0.5) r.rubyScale = fsRel(blocks[0]);
        return [{ v: r, block: false }];
      }
    }
    // ルビ以外は、行内に置く箱 (中に block を持てる) として変換する
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const box = this.boxStyle(n, c2, ctx, false);
    const ro = this.refOrientation(n);
    const ic: LInlineContainer = { type: 'inline-container', ...this.idOf(n), ...style, ...(box as object), children: this.children(n, { ...c2, width: box.width ?? ctx.width, cbW: box.width ?? ctx.width }) };
    if (ro) ic.rotation = ro;
    const da = this.attr(n, 'display-align');
    if (da === 'center' || da === 'after') ic.blockAlign = da === 'center' ? 'center' : 'end';
    if (['hidden', 'scroll', 'error-if-overflow'].includes(this.attr(n, 'overflow') ?? '')) ic.overflow = 'hidden';
    const ab = this.attr(n, 'alignment-baseline') ?? this.attr(n, 'vertical-align');
    if (ab === 'central' || ab === 'middle') ic.alignmentBaseline = 'central';
    else if (ab === 'before-edge' || ab === 'text-before-edge' || ab === 'top' || ab === 'text-top') ic.alignmentBaseline = 'before-edge';
    else if (ab === 'after-edge' || ab === 'text-after-edge' || ab === 'bottom' || ab === 'text-bottom') ic.alignmentBaseline = 'after-edge';
    // アンテナハウス互換: 横書きの行の中の、縦書きを回した箱 (reference-orientation 90・270) は、箱の中央を字の中央の線にそろえる
    // (部分縦書き。baseline-shift は使わない)
    else if (!ab && !this.spec && (ro === 90 || ro === 270) && ctx.wm === 'horizontal-tb') ic.alignmentBaseline = 'central';
    return [{ v: ic, block: false }];
  }

  // ── 画像 ──
  private image(n: XEl, ctx: Ctx, external: boolean): LImage {
    const fs = ctx.fontSize;
    const sized = (v: string | undefined) => (v && !/^(auto|scale-to-fit|scale-down-to-fit|scale-up-to-fit)$/.test(v) ? this.len(v, fs, ctx.width) : undefined);
    // content-width / content-height の百分率は、画像本来の大きさに対する倍率 (周りの幅に対する割合ではない)
    const pct = (v: string | undefined) => (v && /^\d*\.?\d+%$/.test(v.trim()) ? parseFloat(v) / 100 : undefined);
    const cwScale = pct(this.attr(n, 'content-width'));
    const chScale = pct(this.attr(n, 'content-height'));
    // 画像の大きさ: content-* の長さ。scale-to-fit などなら枠の大きさ (枠に合わせる)。auto・百分率は本来の大きさから (組むときに決める)
    const scaleTo = (v: string | undefined) => !!v && /^scale-/.test(v);
    const w = (cwScale === undefined ? sized(this.attr(n, 'content-width')) : undefined) ?? (scaleTo(this.attr(n, 'content-width')) ? (sized(this.attr(n, 'width')) ?? sized(this.attr(n, 'inline-progression-dimension'))) : undefined);
    const h = (chScale === undefined ? sized(this.attr(n, 'content-height')) : undefined) ?? (scaleTo(this.attr(n, 'content-height')) ? (sized(this.attr(n, 'height')) ?? sized(this.attr(n, 'block-progression-dimension'))) : undefined);
    let src: string;
    if (external) {
      src = normalizeSrc(this.attr(n, 'src') ?? '');
      if (src) this.addImage(src);
    } else {
      // 埋め込みの SVG は、XML に書き戻して data URI の画像にする (画面はブラウザが描き、PDF はベクタのまま)
      const fr = this.foreignRoot(n);
      const svgEl = fr && this.name(fr).toLowerCase() === 'svg' ? fr : undefined;
      // 中身が EPS の PostScript (文字が %!PS で始まる): data URI の EPS にする
      const ps = !this.els(n).length ? (n.textContent ?? '').trim() : '';
      if (svgEl) {
        src = `data:image/svg+xml;base64,${utf8Base64(serializeSvg(svgEl))}`;
        this.addImage(src);
      } else if (ps.startsWith('%!PS')) {
        src = `data:application/postscript;base64,${btoa(ps.replace(/[^\x00-\xff]/g, '?'))}`;
        this.addImage(src);
      } else {
        src = `instream-foreign-object:${++this.instream}`;
        this.miss(`fo:instream-foreign-object (${this.els(n).map((e) => this.name(e)).join(', ') || '空'})`);
      }
    }
    // 画像本来の大きさは、画像に書かれた解像度 (PNG の pHYs・JPEG の JFIF・BMP・TIFF) で決める。書かれていなければ 96dpi
    // (72dpi の BMP・PNG・JPEG は 72dpi、解像度の無い GIF は 96dpi で置く)
    const img: LImage = { type: 'image', ...this.idOf(n), src, intrinsicFromImage: true };
    if (w !== undefined) img.width = w;
    if (h !== undefined) img.height = h;
    // width / height は画像を置く枠 (viewport)。画像の大きさは content-width / content-height (既定 auto = 画像本来の大きさ)。
    // content-* が scale-to-fit などなら、画像を枠に収まる大きさにする (§7.15.4・§7.15.5)。枠の幅と高さの両方があれば、枠はその大きさのまま
    // (縦横の比を保つと画像が枠より小さくなる方向は、text-align・display-align で寄せる)。片方だけなら、枠 = 画像の大きさ
    const fit = (v: string | undefined) => !!v && /^scale-/.test(v);
    const auto = (v: string | undefined) => v === undefined || v === 'auto';
    // content-* の片方だけが scale-to-fit で、もう片方が auto のとき: 枠は残し、その方向だけ枠に合わせる (もう片方は縦横の比で決まる)
    const fitW = fit(this.attr(n, 'content-width'));
    const fitH = fit(this.attr(n, 'content-height'));
    // (枠の幅と高さの両方があるときだけ。片方だけなら、画像をその大きさにすれば同じ)
    const frameW = sized(this.attr(n, 'width')) ?? sized(this.attr(n, 'inline-progression-dimension'));
    const frameH = sized(this.attr(n, 'height')) ?? sized(this.attr(n, 'block-progression-dimension'));
    const oneFit = frameW !== undefined && frameH !== undefined && ((fitH && !fitW && auto(this.attr(n, 'content-width'))) || (fitW && !fitH && auto(this.attr(n, 'content-height'))));
    const keepAsSize = (fitW || fitH) && !oneFit && (frameW === undefined || frameH === undefined);
    const vw = keepAsSize ? undefined : (sized(this.attr(n, 'width')) ?? sized(this.attr(n, 'inline-progression-dimension')));
    const vh = keepAsSize ? undefined : (sized(this.attr(n, 'height')) ?? sized(this.attr(n, 'block-progression-dimension')));
    if (vw !== undefined || vh !== undefined) {
      if (oneFit) {
        // 枠に合わせる方向の大きさだけを持つ (片方の枠が無ければ、合わせない)
        delete img.width;
        delete img.height;
        if (fitH && vh !== undefined) img.height = vh;
        if (fitW && vw !== undefined) img.width = vw;
      }
      if (this.attr(n, 'content-width') === undefined && vw !== undefined && img.width === vw) delete img.width;
      if (this.attr(n, 'content-height') === undefined && vh !== undefined && img.height === vh) delete img.height;
      // text-align は継承される (§7.16.9)。画像に無ければ親の値で、枠の中の画像を寄せる (例:
      // text-align="center" のブロックの中の画像は、枠の中央に置く)
      const ta = this.attr(n, 'text-align');
      const inhTa = ctx.inh?.textAlign;
      const da = this.attr(n, 'display-align');
      const center = ta ? ta === 'center' : inhTa === 'center';
      const end = ta ? ta === 'end' || ta === (ctx.rtl ? 'left' : 'right') : inhTa === 'end';
      img.viewport = {
        ...(vw !== undefined ? { width: vw } : {}),
        ...(vh !== undefined ? { height: vh } : {}),
        ...(center ? { align: 'center' as const } : end ? { align: 'end' as const } : {}),
        ...(da === 'center' ? { blockAlign: 'center' as const } : da === 'after' ? { blockAlign: 'end' as const } : {}),
      };
    }
    // scale-down-to-fit・scale-up-to-fit: 本来の大きさが枠以下 (以上) なら本来の大きさ (§7.15.4・§7.15.5)
    const lim = (v: string | undefined) => (v === 'scale-down-to-fit' ? ('down' as const) : v === 'scale-up-to-fit' ? ('up' as const) : undefined);
    const lw = lim(this.attr(n, 'content-width'));
    const lh = lim(this.attr(n, 'content-height'));
    if (lw || lh) img.fitLimit = { ...(lw ? { w: lw } : {}), ...(lh ? { h: lh } : {}) };
    if (cwScale !== undefined) img.widthScale = cwScale;
    if (chScale !== undefined) img.heightScale = chScale;
    if (this.attr(n, 'scaling') === 'non-uniform') img.scaling = 'non-uniform';
    // 罫線・余白・背景色 (寸法は上で扱った)
    const box = this.boxStyle(n, ctx, ctx) as { border?: LImage['border']; padding?: LImage['padding']; backgroundColor?: string };
    if (box.border) img.border = box.border;
    if (box.padding) img.padding = box.padding;
    if (box.backgroundColor) img.backgroundColor = box.backgroundColor;
    return img;
  }
  private instream = 0;

  // ── leader ──
  private leader(n: XEl, ctx: Ctx): LLeader {
    const { style } = this.textStyle(n, ctx);
    const pat = this.attr(n, 'leader-pattern') ?? 'space';
    const l: LLeader = { type: 'leader', ...style };
    if (pat === 'dots') l.pattern = 'dots';
    else if (pat === 'rule') l.pattern = 'rule';
    else if (pat === 'use-content') {
      l.pattern = 'dots';
      // 中身の文字列 (改行などの空白の並びは空白 1 つに畳む。前後の空白も繰り返しの単位に含める)
      const t = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (t.trim()) l.patternText = t;
    } else l.pattern = 'space';
    // rule-thickness の初期値は 1.0pt (§7.22.6)
    l.ruleThickness = this.len(this.attr(n, 'rule-thickness'), ctx.fontSize) ?? 1;
    const rs = this.attr(n, 'rule-style');
    if (rs === 'dotted' || rs === 'dashed' || rs === 'double' || rs === 'groove' || rs === 'ridge') l.ruleStyle = rs;
    // rule-style は leader-pattern="rule" のときだけ効く (§7.22.5)。none は線を引かない (点・中身の繰り返しは消さない)
    else if (rs === 'none' && pat === 'rule') l.pattern = 'space';
    // leader-pattern-width の百分率は、親の領域の内容の幅に対する割合 (§7.22.3)。字の幅より狭い指定は、組むときに字の幅にする
    const pw = this.len(this.attr(n, 'leader-pattern-width'), ctx.fontSize, this.cbW(ctx));
    if (pw !== undefined) l.patternWidth = pw;
    // leader-length="長さ" (成分を書かない形) は、最小・最適・最大のすべてをその長さにする (§5.11 の短い形)
    // 百分率は親の領域の内容の inline 方向の寸法に対する割合 (§7.22.4)。組むときに決める
    const all = this.attr(n, 'leader-length');
    const length: NonNullable<LLeader['length']> = {};
    const pct: NonNullable<LLeader['lengthPct']> = {};
    for (const k of ['minimum', 'optimum', 'maximum'] as const) {
      const v = (this.attr(n, `leader-length.${k}`) ?? all)?.trim();
      if (v === undefined) continue;
      const p = /^([\d.]+)%$/.exec(v);
      if (p) pct[k] = parseFloat(p[1]) / 100;
      else {
        const x = this.len(v, ctx.fontSize, ctx.width);
        if (x !== undefined) length[k] = x;
      }
    }
    // 指定の無い成分は初期値 (§7.22.4): minimum 0pt・optimum 12pt・maximum 100%
    if (length.minimum === undefined && pct.minimum === undefined) length.minimum = 0;
    if (length.optimum === undefined && pct.optimum === undefined) length.optimum = 12;
    if (length.maximum === undefined && pct.maximum === undefined) pct.maximum = 1;
    if (Object.keys(length).length) l.length = length;
    if (Object.keys(pct).length) l.lengthPct = pct;
    // leader-alignment (§7.22.1。継承される): 点・中身の繰り返しの周期を、参照領域・ページの始めの端からの格子に合わせる
    // (“For fo:leaders where the "leader-pattern" property is specified as "dot" or as "use-content", this property will be honored.”)
    const la = this.inheritedAttr(n, 'leader-alignment');
    if (la === 'reference-area' || la === 'page') {
      if (l.pattern !== 'dots') {
        /* 線・空白には効かない */
      } else if (ctx.rtl) this.miss(`leader-alignment="${la}" (右から左の行)`);
      else l.alignment = la;
    } else if (la !== undefined && la !== 'none') this.miss(`leader-alignment="${la}"`);
    return l;
  }

  // ── block-container ──
  private blockContainer(n: XEl, ctx: Ctx): LBlockContainer {
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const box = this.boxStyle(n, c2, ctx);
    // max-width (§7.15.9): 幅の指定が無ければ、使える幅と max-width の小さい方を内容の幅にする (横書きのコンテナは boxStyle が同じ値にしている)
    const maxW = this.len(this.attr(n, 'max-width'), c2.fontSize, ctx.width);
    if (maxW !== undefined && box.width === undefined && ctx.width !== undefined && maxW < ctx.width) box.width = maxW;
    // absolute-position (一括指定の position="absolute" / "fixed" も読む。§7.31.20)
    const posAttr = this.attr(n, 'position');
    const absPos = this.attr(n, 'absolute-position') ?? (posAttr === 'absolute' || posAttr === 'fixed' ? posAttr : undefined);
    const abs = absPos === 'absolute' || absPos === 'fixed';
    let kids: Array<LBlockLevel | LInlineLevel>;
    // 段組のコンテナの中の要素の幅 (百分率の基準) は、1 段の幅 (段は参照領域)
    // 段の数・段の間隔は、fo:region-body の column-count・column-gap と同じ規則で読む (1 以上の最も近い整数に丸める。負の間隔は 0pt。XSL 1.1 §7.27.2・§7.27.3)
    const ccIn = this.posInt(this.attr(n, 'axf:column-count') ?? this.attr(n, 'column-count'));
    const fullW = box.width ?? ctx.width;
    const gapOf = () => {
      const g = this.len(this.attr(n, 'axf:column-gap') ?? this.attr(n, 'column-gap'), c2.fontSize, ctx.width);
      return g === undefined ? undefined : Math.max(g, 0);
    };
    const gapIn = ccIn > 1 ? (gapOf() ?? 12) : 0;
    const innerW = ccIn > 1 && fullW !== undefined ? Math.max(0, (fullW - gapIn * (ccIn - 1)) / ccIn) : fullW;
    // 中の絶対配置の基準は、このコンテナの内容の箱 (ブロックコンテナは参照領域を作る。横書きのコンテナだけ)
    if (c2.wm === 'horizontal-tb' && !this.attr(n, 'reference-orientation')) {
      c2.refOrigin = { x: 0, y: 0 };
      c2.refSize = { w: box.width ?? ctx.width, h: box.height };
      c2.inContainer = true;
    } else c2.inContainer = false;
    if (this.spec) {
      // 仕様モード (§5.3.2): block-container は参照領域を作るので、中の要素の start-indent / end-indent は、コンテナの内容端から測る。
      // 中の要素は、コンテナの start-indent の値 (指定・継承・margin + border + padding) を受け継ぐので、その分だけ内側へ下がる
      const startP = this.phys('start', ctx.wm, ctx.rtl);
      const endP = this.phys('end', ctx.wm, ctx.rtl);
      const edge = (side: 'top' | 'right' | 'bottom' | 'left') =>
        ((box.padding as Record<string, number> | undefined)?.[side] ?? 0) + ((box.border as Record<string, { width: number } | undefined> | undefined)?.[side]?.width ?? 0);
      const ownStart = this.len(this.attr(n, 'start-indent'), c2.fontSize, ctx.width);
      const ownEnd = this.len(this.attr(n, 'end-indent'), c2.fontSize, ctx.width);
      const ml = this.len(this.attr(n, `margin-${startP}`), c2.fontSize, ctx.width);
      const mr = this.len(this.attr(n, `margin-${endP}`), c2.fontSize, ctx.width);
      const si = ownStart ?? (ml !== undefined ? ml + edge(startP) : ctx.startIndent);
      const ei = ownEnd ?? (mr !== undefined ? mr + edge(endP) : ctx.endIndent);
      const inner = this.children(n, { ...c2, startIndent: si, endIndent: ei, width: innerW, cbW: innerW, cbH: box.height });
      kids = si || ei ? [{ type: 'block', margin: { [startP]: si, [endP]: ei }, children: inner }] : inner;
    } else {
      // 互換モード: コンテナの外の indent を中へ持ち込まない (従来どおり)
      kids = this.children(n, { ...c2, width: innerW, cbW: innerW, cbH: box.height });
    }
    const c: LBlockContainer = { type: 'block-container', ...this.idOf(n), ...style, ...(box as object), children: kids };
    // 書字方向の裏返し: 自分で writing-mode を決めたコンテナは、裏返さない値でも印 ({}) を付ける (外の裏返しを中へ持ち込まない)。
    // 受け継いだ裏返しも、参照領域ごとに当てる
    const ownWm = this.attr(n, 'writing-mode');
    const wf = ownWm && !ownWm.startsWith('from-') ? (flipOf(ownWm) ?? {}) : c2.flip;
    if (wf) c.writingFlip = wf;
    if (wf?.pairs) c.children = pairText(c.children) as typeof c.children;
    // 親と書字方向が直交するコンテナは、block 方向の寸法の指定が無ければ、親の幅いっぱいに広げる
    if ((c2.wm === 'horizontal-tb') !== (ctx.wm === 'horizontal-tb')) c.fillOrthogonal = true;
    // コンテナの中の段組 (axf:column-count / column-count)
    const cc = ccIn;
    if (cc > 1) {
      const gap = gapOf();
      const rule = this.columnRule(n, c2.fontSize);
      c.columns = { count: cc, ...(gap !== undefined ? { gap } : {}), ...(rule ? { rule } : {}), ...(this.attr(n, 'axf:column-rule-display') === 'all' ? { ruleDisplay: 'all' as const } : {}) };
    }
    if (abs) {
      c.absolutePosition = true;
      // 祖先のブロックコンテナの中なら、その内容の箱を基準にする (位置は組むときに決める)
      if (ctx.inContainer && absPos === 'absolute') c.positionInContainer = true;
      // z-index (§7.30.18): 親の値に足した値 (§5.4.5) が負の箱は、本文の背面に置く (HTML の負の z-index と同じ受け皿)。
      // 0 以上の値どうしの重なりの順は、文書の順のまま。コンテナの中の絶対配置の箱は、背面に置けないので報告する
      if (this.zIndexOf(n) < 0) {
        if (c.positionInContainer) this.miss('z-index (コンテナの中の絶対配置)');
        else c.layer = 'behind';
      }
      const fs = c2.fontSize;
      // fixed はページを基準にする (§7.6.1「fixed with respect to the page」)。absolute は最も近い祖先の参照領域
      const fixedPage = absPos === 'fixed' && ctx.pageSize ? ctx.pageSize : undefined;
      const refOrigin = fixedPage ? { x: 0, y: 0 } : ctx.refOrigin;
      const refSize = fixedPage ? { w: fixedPage.w, h: fixedPage.h } : ctx.refSize;
      const inLocal = !!ctx.inContainer && absPos === 'absolute';
      const refW = refSize?.w ?? ctx.width;
      const refH = refSize?.h;
      const t = this.len(this.attr(n, 'top'), fs, refH);
      const l = this.len(this.attr(n, 'left'), fs, refW);
      const r = this.len(this.attr(n, 'right'), fs, refW);
      const b0 = this.len(this.attr(n, 'bottom'), fs, refH);
      // アンテナハウス互換: top だけを指定し、高さも bottom も指定していないときは、bottom を 0 として基準の領域の下端まで伸ばす
      // (仕様 (CSS2 の絶対配置) では中身の高さ)
      // ただし高さの下限 (block-progression-dimension.minimum) があれば伸ばさない
      const b = b0 ?? (!this.spec && t !== undefined && c.height === undefined && c.minBlockSize === undefined && refH !== undefined ? 0 : undefined);
      // 絶対配置の基準は本文領域 (FO) → Kumiori の基準はページ左上なので、本文領域の原点を加える。
      // top・left などは内容の端の位置 (枠・パディングはその外側へ出る) → Kumiori の枠の外の端へ直す
      const edge = (side: 'top' | 'right' | 'bottom' | 'left') =>
        ((box.padding as Record<string, number> | undefined)?.[side] ?? 0) + ((box.border as Record<string, { width: number } | undefined> | undefined)?.[side]?.width ?? 0);
      const ref = refSize;
      // ただし上下 (左右) の両方を指定して寸法を基準の領域から決めるときは、枠の外の端を top・left に合わせる
      // (枠の外の端が本文領域の端と一致する)
      const fillH = ref?.h !== undefined && t !== undefined && b !== undefined && c.height === undefined;
      const fillW = ref?.w !== undefined && l !== undefined && r !== undefined && c.width === undefined;
      if (t !== undefined) c.top = t + refOrigin.y - (fillH ? 0 : edge('top'));
      if (l !== undefined) c.left = l + refOrigin.x - (fillW ? 0 : edge('left'));
      // right・bottom は基準の領域の右端・下端から測る (§7.6.1)。組むときはページの端から測るので、領域の外の余白を足す
      // (コンテナの中の絶対配置は、コンテナの内容の箱がそのまま基準)
      const pg = ctx.pageSize;
      const padR = !inLocal && pg && ref?.w !== undefined ? pg.w - refOrigin.x - ref.w : 0;
      const padB = !inLocal && pg && ref?.h !== undefined ? pg.h - refOrigin.y - ref.h : 0;
      if (r !== undefined && l === undefined) c.right = r + padR - edge('right');
      if (b !== undefined && t === undefined) c.bottom = b + padB - edge('bottom');
      // 幅の指定が無く left だけのときは、基準の領域の終端まで (ページの端までは伸ばさない)
      if (l !== undefined && r === undefined && c.width === undefined && !inLocal && padR > 0) c.right = padR;
      // 上下 (左右) の両方を指定し、高さ (幅) の指定が無いときは、基準の領域から寸法を決める
      if (fillH && ref?.h !== undefined && t !== undefined && b !== undefined) c.height = Math.max(ref.h - t - b - edge('top') - edge('bottom'), 0);
      if (fillW && ref?.w !== undefined && l !== undefined && r !== undefined) c.width = Math.max(ref.w - l - r - edge('left') - edge('right'), 0);
      if (c.top === undefined && c.bottom === undefined) c.top = refOrigin.y;
      if (c.left === undefined && c.right === undefined) {
        // アンテナハウス互換: left も right も無ければ、内容の端を基準の領域の左端に置き (枠はその外)、幅の指定が無ければ
        // 基準の領域の右端まで (ページの端までは伸ばさない)
        c.left = refOrigin.x - (this.spec ? 0 : edge('left'));
        if (!this.spec && c.width === undefined && !inLocal && padR > 0) c.right = padR - edge('right');
      }
    }
    const ro = this.refOrientation(n);
    if (ro) c.rotation = ro;
    // アンテナハウス互換: 回転した箱をページに分けて組むときは、本文の幅いっぱいの箱にする (270° の中身が右に寄る)
    if ((ro === 90 || ro === 270) && !this.spec) c.rotatedFill = true;
    const da = this.attr(n, 'display-align');
    if (da === 'center') c.blockAlign = 'center';
    else if (da === 'after') c.blockAlign = 'end';
    return c;
  }

  // ── float ──
  private float(n: XEl, ctx: Ctx): LFloat {
    this.report.counts.floats++;
    const f = this.attr(n, 'float') ?? 'none';
    const side: LFloat['float'] = f === 'before' ? 'before' : f === 'end' || f === 'right' ? 'end' : f === 'inside' || f === 'outside' ? f : 'start';
    if (f === 'none') this.note(msg('float="none" は start として扱いました', 'float="none" was treated as start'));
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const kids = this.children(n, c2);
    const out: LFloat = { type: 'float', float: side, anchorIsContent: true, ...style, children: kids };
    // 幅は、内容の最初のブロックの寸法から拾う
    const first = kids.find((k) => typeof k !== 'string' && (k.type === 'block' || k.type === 'block-container')) as (LBlock | LBlockContainer) | undefined;
    // 内容のブロックが負の start-indent / end-indent で本文の外へはみ出す形は、余白に置く傍注
    // (indent = margin + 枠 + パディングで判定する。start-indent="0" に枠を付けた形は margin が僅かに負になるが、はみ出しではない)
    const fm = (first?.margin ?? {}) as Record<string, number>;
    const fb = (first?.border ?? {}) as Record<string, { width: number } | undefined>;
    const fp = (first?.padding ?? {}) as Record<string, number>;
    const indentOf = (side: string) => (fm[side] ?? 0) + (fb[side]?.width ?? 0) + (fp[side] ?? 0);
    if (side !== 'before' && indentOf(this.phys('start', ctx.wm, ctx.rtl)) < 0 && indentOf(this.phys('end', ctx.wm, ctx.rtl)) < 0) {
      out.marginal = true;
      return out;
    }
    // 行の進む方向の寸法には、内容のブロックの start-indent・end-indent (margin + 枠 + パディング) を足す
    // (内容のブロックの配置の矩形がフロートに収まるように。indent が 0 以下の側は足さない)
    const horiz = ctx.wm === 'horizontal-tb';
    const extra = (a: string, b: string) => Math.max(indentOf(a), 0) + Math.max(indentOf(b), 0);
    if (first && first.width) out.width = first.width + (horiz ? extra('left', 'right') : 0);
    if (first && first.height) out.height = first.height + (horiz ? 0 : extra('top', 'bottom'));
    return out;
  }

  // ── footnote ──
  private footnote(n: XEl, ctx: Ctx): LFootnote {
    this.report.counts.footnotes++;
    const els = this.els(n);
    const refEl = els.find((e) => this.name(e) !== 'footnote-body');
    const body = els.find((e) => this.name(e) === 'footnote-body');
    const label = (refEl?.textContent ?? '').replace(/\s+/g, '').trim();
    // fo:footnote・fo:footnote-body に書いた継承される特性 (font-weight・color・text-align・line-height など。§5.1.4) は、
    // footnote → footnote-body の順に重ねて、本体へ伝える
    const fnStyle = this.textStyle(n, ctx);
    const bodyStyle = body ? this.textStyle(body, fnStyle.ctx) : fnStyle;
    const c2 = bodyStyle.ctx;
    const out: LFootnote = { type: 'footnote', bodyLabel: false, ...fnStyle.style, ...(body ? bodyStyle.style : {}), ...c2.inh, children: body ? this.children(body, c2) : [] };
    // 数の line-height を書いたら、受け継いだ長さの line-height は残さない
    if (c2.inh?.lineHeightPt === undefined) delete out.lineHeightPt;
    // 脚注本体の文字の大きさは、周りから受け継いだ値 (FO の継承。HTML 向けの既定の 0.8 倍は使わない)
    if (out.fontSize === undefined) out.fontSize = c2.fontSize;
    if (label) out.label = label;
    // 参照記号は、FO の参照側 inline の書式 (文字の大きさ・baseline-shift) で組む
    const refInline = refEl && this.name(refEl) === 'inline' ? refEl : refEl ? this.els(refEl).find((e) => this.name(e) === 'inline') : undefined;
    if (refEl) {
      // 大きさと上げ下げのほかの書式 (書体・太さ・斜体・色・飾り線) も、参照側の inline から
      if (refInline) {
        const rs = this.textStyle(refInline, ctx).style;
        const picked: NonNullable<LFootnote['referenceStyle']> = {};
        if (rs.fontFamily !== undefined) picked.fontFamily = rs.fontFamily;
        if (rs.fontWeight !== undefined) picked.fontWeight = rs.fontWeight;
        if (rs.fontStyle !== undefined) picked.fontStyle = rs.fontStyle;
        if (rs.color !== undefined) picked.color = rs.color;
        if (rs.textDecoration !== undefined) picked.textDecoration = rs.textDecoration;
        if (Object.keys(picked).length) out.referenceStyle = picked;
      }
      const fsAttr = refInline ? this.attr(refInline, 'font-size') : undefined;
      if (fsAttr) {
        const v = /%$/.test(fsAttr) ? parseFloat(fsAttr) / 100 : /em$/.test(fsAttr) ? parseFloat(fsAttr) : (this.len(fsAttr, ctx.fontSize) ?? ctx.fontSize) / ctx.fontSize;
        if (v > 0) out.referenceScale = v;
      } else out.referenceScale = 1;
      const bs = refInline ? this.attr(refInline, 'baseline-shift') : undefined;
      if (bs === 'super' || bs === 'sub') out.referenceShift = bs;
      else if (bs && bs !== 'baseline') {
        const fsRef = (out.referenceScale ?? 1) * ctx.fontSize;
        const v = this.len(bs, fsRef, this.lineHeightOf(ctx));
        out.referenceShift = v ?? 'none';
      } else out.referenceShift = 'none';
    }
    return out;
  }

  // ───────────────────────── 表・リスト ─────────────────────────

  private tableAndCaption(n: XEl, ctx: Ctx) {
    const out: Array<{ v: LBlockLevel | LInlineLevel; block: boolean }> = [];
    // table-and-caption 自身の書式 (文字の大きさ・余白など) は、見出しと表を包むブロックにする
    const { style, ctx: c1 } = this.textStyle(n, ctx);
    const box = this.boxStyle(n, c1, ctx);
    // 子が継承する indent = table-and-caption の内容端 (block と同じ。子の start-indent は参照領域の端から測る値)
    const edge = (side: 'top' | 'right' | 'bottom' | 'left') =>
      ((box.margin as Record<string, number> | undefined)?.[side] ?? 0) + ((box.padding as Record<string, number> | undefined)?.[side] ?? 0) + ((box.border as Record<string, { width: number } | undefined> | undefined)?.[side]?.width ?? 0);
    const es = edge(this.phys('start', ctx.wm, ctx.rtl));
    const ee = edge(this.phys('end', ctx.wm, ctx.rtl));
    const c2: Ctx = { ...c1, startIndent: ctx.startIndent + es, endIndent: ctx.endIndent + ee, ...(ctx.width !== undefined && box.width === undefined ? { width: Math.max(ctx.width - es - ee, 0) } : {}) };
    const caption = this.els(n).find((e) => this.name(e) === 'table-caption');
    const table = this.els(n).find((e) => this.name(e) === 'table');
    const cs = this.attr(n, 'caption-side') ?? 'before';
    // 互換モード: 見出し (table-caption) の space-before・space-after は使わない
    const captionBlocks = () => {
      const cap = this.element(caption!, c2);
      if (!this.spec)
        for (const o of cap)
          if (typeof o.v !== 'string' && o.v.type === 'block') {
            const b = o.v as LBlock;
            const m = b.margin as Record<string, number> | undefined;
            if (m) {
              const { top: _t, bottom: _b, ...rest } = m;
              b.margin = rest as LBlock['margin'];
            }
            delete b.spaceBeforePrecedence;
            delete b.spaceAfterPrecedence;
          }
      return cap;
    };
    if (caption && cs !== 'after' && cs !== 'end') out.push(...captionBlocks());
    if (table) {
      // display-align は継承される (§7.14.4): table-and-caption の指定を、表のセルが引き継ぐ
      const prevDA = this.inheritedDisplayAlign;
      this.inheritedDisplayAlign = this.attr(n, 'display-align') ?? prevDA;
      const t = this.element(table, c2);
      this.inheritedDisplayAlign = prevDA;
      // 表は、table-and-caption の text-align (継承される) に従って寄せる (§6.7.2)。寄せ方は組むときに、継承した値で決める
      for (const o of t) if (typeof o.v !== 'string' && o.v.type === 'table') (o.v as LTable).alignByTextAlign = true;
      out.push(...t);
    }
    if (caption && (cs === 'after' || cs === 'end')) out.push(...captionBlocks());
    // 書式も id も無ければ包まない (id があれば、ページ番号の参照・リンクの飛び先にするため包む)
    if (!Object.keys(style).length && !Object.keys(box).length && !this.attr(n, 'id')) return out;
    return [{ v: { type: 'block', ...this.idOf(n), ...style, ...(box as object), children: out.map((o) => o.v) } as LBlock, block: true }];
  }

  /** table-cell の column-number (列の番号。1 から) */
  private cellColumn = new WeakMap<LTableCell, number>();
  /** table-cell の幅の指定 (pt) */
  private cellWidth = new WeakMap<LTableCell, number>();

  /**
   * 列の幅の指定が無い列は、その列のセル (列をまたがないもの) の幅の指定の最大を列の幅にする
   * (例: inline-progression-dimension="75mm" のセルの列は 75mm)
   */
  private columnsFromCellWidths(tbl: LTable) {
    const rows = [...(tbl.header?.rows ?? []), ...tbl.body.rows, ...(tbl.footer?.rows ?? [])];
    const widths: number[] = [];
    const occupiedUntil: number[] = [];
    rows.forEach((r, j) => {
      let col = 0;
      for (const cell of r.cells) {
        while ((occupiedUntil[col] ?? -1) >= j) col++;
        const cs = Math.max(cell.colSpan ?? 1, 1);
        const w = this.cellWidth.get(cell);
        if (cs === 1 && w !== undefined) widths[col] = Math.max(widths[col] ?? 0, w);
        const rs = Math.max(cell.rowSpan ?? 1, 1);
        if (rs > 1) for (let k = 0; k < cs; k++) occupiedUntil[col + k] = j + rs - 1;
        col += cs;
      }
    });
    if (!widths.some((w) => w !== undefined)) return;
    const n = Math.max(tbl.columns.length, widths.length);
    for (let k = 0; k < n; k++) {
      const c = tbl.columns[k] ?? (tbl.columns[k] = { type: 'table-column' });
      if (c.width === undefined && widths[k] !== undefined) c.width = widths[k];
    }
    // 列の幅が決まったので、中身に合わせる自動レイアウトをやめる (すべての列の幅が決まったときだけ)
    if (tbl.columns.every((c) => c.width !== undefined)) {
      delete tbl.fitContent;
      delete tbl.fillContent;
    }
  }

  /**
   * column-number を指定したセルを、その列に置く (§7.28.1)。飛ばした列には中身の無いセルを入れる。
   * 行をまたぐセルが占める列は飛ばす (組むときと同じ規則)
   */
  private placeByColumnNumber(rows: LTableRow[], nColumns: number) {
    if (!rows.some((r) => r.cells.some((c) => this.cellColumn.has(c)))) return;
    const occupiedUntil: number[] = [];
    rows.forEach((r, j) => {
      const out: LTableCell[] = [];
      let col = 0;
      const skip = () => {
        while ((occupiedUntil[col] ?? -1) >= j) col++;
      };
      for (const cell of r.cells) {
        skip();
        const want = (this.cellColumn.get(cell) ?? 0) - 1;
        while (want > col && (nColumns === 0 || col < Math.max(nColumns, want + 1))) {
          out.push({ type: 'table-cell', children: [] });
          col++;
          skip();
        }
        out.push(cell);
        const cs = Math.max(cell.colSpan ?? 1, 1);
        const rs = Math.max(cell.rowSpan ?? 1, 1);
        if (rs > 1) for (let k = 0; k < cs; k++) occupiedUntil[col + k] = j + rs - 1;
        col += cs;
      }
      r.cells = out;
    });
  }

  /** 組んでいる表の empty-cells (表・行グループ・行の指定。セルが受け継ぐ) と、罫線を分ける表か */
  private emptyCells?: string;
  private separateTable = false;
  /**
   * 今読んでいる表の列の幅 (pt。決まらない列は undefined) と、セルを置く位置 (行の中の列・行をまたぐセルが埋める列の残りの行数)。
   * セルの中の百分率の基準 (セルの内容の幅) を決めるのに使う
   */
  private grid?: { cols: Array<number | undefined>; spacing: number; collapse: boolean; col: number; busy: number[] };

  /** table-and-caption から表へ引き継ぐ display-align */
  private inheritedDisplayAlign?: string;

  private table(n: XEl, ctx: Ctx): LTable {
    const savedEC = [this.emptyCells, this.separateTable, this.grid] as const;
    this.emptyCells = this.attr(n, 'empty-cells') ?? this.emptyCells;
    this.separateTable = this.attr(n, 'border-collapse') === 'separate';
    this.grid = undefined;
    try {
      return this.tableInner(n, ctx);
    } finally {
      [this.emptyCells, this.separateTable, this.grid] = savedEC;
    }
  }

  private tableInner(n: XEl, ctx: Ctx): LTable {
    this.report.counts.tables++;
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const box = this.boxStyle(n, c2, ctx);
    // 表の幅: 指定が無ければ、親の内容の幅から inline 方向の余白 (start-indent・end-indent から決まる) を引いた幅
    const mg = box.margin as Record<string, number | undefined> | undefined;
    const sideMargins = c2.wm === 'horizontal-tb' ? (mg?.left ?? 0) + (mg?.right ?? 0) : (mg?.top ?? 0) + (mg?.bottom ?? 0);
    const tw = box.width ?? (ctx.width !== undefined ? ctx.width - sideMargins : undefined);
    const els = this.els(n);
    const columns: LTableColumn[] = [];
    // column-width の百分率は、表の幅に対する値 (§7.28.4)。幅の指定の無い表で、列の幅がすべて百分率で合計がほぼ 100% なら、
    // 表の幅を比で分ける (表の幅は組むときに決まる。縦書きの表でも、表の inline 方向の幅に対して決まる)
    const colEls = els.filter((e) => this.name(e) === 'table-column');
    const pcts = colEls.map((c) => this.attr(c, 'column-width') ?? '');
    const allPct = box.width === undefined && pcts.length > 0 && pcts.every((v) => /%$/.test(v));
    const pctSum = allPct ? colEls.reduce((a, c, k) => a + parseFloat(pcts[k]) * (this.colInt(this.attr(c, 'number-columns-repeated'), 'number-columns-repeated') || 1), 0) : 0;
    const pctAsRatio = allPct && Math.abs(pctSum - 100) < 0.5;
    for (const c of colEls) {
      const rep = this.colInt(this.attr(c, 'number-columns-repeated') ?? '1', 'number-columns-repeated') || 1;
      const cw = this.attr(c, 'column-width') ?? '';
      let width: LTableColumn['width'];
      let extra = 0;
      // proportional-column-width() を含む式 (例: proportional-column-width(2)+2pc。§5.10.4)
      const pv = /proportional-column-width/.test(cw) ? evalExpr(cw, { fs: c2.fontSize, pct: tw, proportional: true }) : undefined;
      if (pv && pv.prop > 0) {
        width = `${pv.prop}*` as `${number}*`;
        extra = pv.pt;
      } else if (pv) width = pv.pt;
      else if (/%$/.test(cw)) width = tw && !pctAsRatio ? ((parseFloat(cw) / 100) * tw) : (`${parseFloat(cw)}*` as `${number}*`);
      else width = this.len(cw, c2.fontSize, tw);
      // 列の罫線 (collapse の表でだけ使う。§6.7.4)
      const colBorder = this.border(c, c2);
      // column-number があればその位置に置く (飛ばした列は幅の指定の無い列)
      const num = this.colInt(this.attr(c, 'column-number'), 'column-number');
      let at = num > 0 ? num - 1 : columns.length;
      for (let k = 0; k < rep; k++, at++) {
        while (columns.length < at) columns.push({ type: 'table-column' });
        columns[at] = { type: 'table-column', ...(width !== undefined ? { width } : {}), ...(extra ? { widthExtra: extra } : {}), ...(colBorder ? { border: colBorder } : {}) };
      }
    }
    const tbl: LTable = { type: 'table', ...this.idOf(n), ...style, ...(box as object), columns, body: { type: 'table-body', rows: [] } };
    // 幅も列の幅も指定の無い自動レイアウトの表 (table-layout の初期値 auto) は、列の幅を中身に合わせる
    if (box.width === undefined && this.attr(n, 'table-layout') !== 'fixed' && columns.every((c) => c.width === undefined)) {
      tbl.fitContent = true;
      tbl.fitContentRule = 'max-ratio';
    } else if (box.width !== undefined && this.attr(n, 'table-layout') !== 'fixed' && columns.every((c) => c.width === undefined)) {
      // 幅の指定があっても、table-layout が auto (初期値) なら自動レイアウト (§6.7.3): 列の幅は中身から決める
      tbl.fillContent = true;
      tbl.fitContentRule = 'max-ratio';
    }
    // border-collapse の初期値は collapse (§7.28.3)
    tbl.borderCollapse = this.attr(n, 'border-collapse') === 'separate' ? 'separate' : 'collapse';
    // 罫線を分ける表のセルの間隔 (border-separation §7.28.5。一括指定 border-spacing は「inline 方向 block 方向」の順)
    if (tbl.borderCollapse === 'separate') {
      const fsT = c2.fontSize;
      const sh = (this.attr(n, 'border-separation') ?? this.attr(n, 'border-spacing'))?.trim().split(/\s+/);
      const si = this.len(this.attr(n, 'border-separation.inline-progression-direction') ?? sh?.[0], fsT) ?? 0;
      const sb = this.len(this.attr(n, 'border-separation.block-progression-direction') ?? sh?.[1] ?? sh?.[0], fsT) ?? 0;
      if (si > 0 || sb > 0) tbl.borderSpacing = { i: si, b: sb };
    }
    // 互換モード: 内側の罫線は後ろのセルが全体の太さで持つ。仕様モードは半分ずつ (§6.7.10)
    if (!this.spec && tbl.borderCollapse === 'collapse') tbl.collapseToAfterCell = true;
    const tAlign = this.attr(n, 'display-align') ?? this.inheritedDisplayAlign;
    // 列の幅が長さで決まる列 (自動レイアウトの表は中身で決まるので使わない)
    if (!tbl.fitContent && !tbl.fillContent)
      this.grid = { cols: columns.map((c) => (typeof c.width === 'number' ? c.width + (c.widthExtra ?? 0) : undefined)), spacing: tbl.borderSpacing?.i ?? 0, collapse: tbl.borderCollapse === 'collapse', col: 0, busy: [] };
    const headerEl = els.find((e) => this.name(e) === 'table-header');
    const footerEl = els.find((e) => this.name(e) === 'table-footer');
    const bodies = els.filter((e) => this.name(e) === 'table-body');
    const rowsOf = (e: XEl): LTableRow[] => {
      const cs = this.els(e);
      const rows = cs.filter((x) => this.name(x) === 'table-row');
      let out: LTableRow[];
      const gAlign = this.attr(e, 'display-align') ?? tAlign;
      // table-header / body / footer の字の指定 (font-size など) は、その中の行・セルへ引き継ぐ
      const { style: gs, ctx: gc } = this.textStyle(e, c2);
      if (this.grid) this.grid.busy = [];
      if (rows.length) out = rows.map((r) => this.row(r, gc, tw, gAlign));
      else {
        // table-row を省略して table-cell が直接並ぶ形: starts-row="true" のセルの前、ends-row="true" のセルの後ろで行を分ける (§7.28.14・7.28.11)
        const cells = cs.filter((x) => this.name(x) === 'table-cell');
        out = [];
        let cur: LTableCell[] = [];
        const flush = () => {
          if (cur.length) out.push({ type: 'table-row', cells: cur });
          cur = [];
        };
        for (const c of cells) {
          if (this.attr(c, 'starts-row') === 'true') flush();
          if (!cur.length) this.gridRowStart();
          cur.push(this.cell(c, gc, tw, gAlign));
          if (this.attr(c, 'ends-row') === 'true') flush();
        }
        flush();
      }
      this.placeByColumnNumber(out, columns.length);
      if (Object.keys(gs).length) out = out.map((r) => ({ ...gs, ...r }));
      // table-header / body / footer の背景色は、背景の無いセルへ引き継ぐ
      const bg = gc.hidden ? undefined : this.color(this.attr(e, 'background-color'));
      if (bg) for (const r of out) for (const c of r.cells) if (!c.backgroundColor) c.backgroundColor = bg;
      // table-header / body / footer の罫線: 罫線を重ねる表 (collapse。初期値) では、行グループの外周の罫線になる (§6.7.10)。
      // 重ね合わせは組むときに、セル・行・列・表の罫線と合わせて決める
      if (tbl.borderCollapse === 'collapse') {
        const gb = this.boxStyle(e, gc, c2, false).border as BorderInput | undefined;
        if (gb) out.forEach((r, k) => (r.group = { border: gb, first: k === 0, last: k === out.length - 1 }));
      }
      return out;
    };
    // fo:retrieve-table-marker は、表の header・footer の中でだけ読む (§6.13.7)
    const hfRows = (e: XEl) => {
      this.inTableHF++;
      try {
        return rowsOf(e);
      } finally {
        this.inTableHF--;
      }
    };
    // fo:table の子の fo:retrieve-table-marker (取り出した fo:marker の中身が fo:table-header・fo:table-footer そのものになる書き方。§6.13.7) は未対応
    if (els.some((e) => this.name(e) === 'retrieve-table-marker')) this.miss('fo:retrieve-table-marker (fo:table の子)');
    if (headerEl) tbl.header = { type: 'table-body', rows: hfRows(headerEl) };
    for (const b of bodies) {
      // 本体の子の fo:marker (§6.7.8 の Contents): 本体の領域に付く。行に持たせて、表の header・footer から取り出せるようにする
      const saved = this.inTableHF;
      this.inTableHF = 0;
      const rows = rowsOf(b);
      const mkEls = this.els(b).filter((x) => this.name(x) === 'marker');
      // fo:marker の中の表の fo:marker は読まない (flowChild の marker の所と同じ)
      if (mkEls.length && this.inMarker) this.miss('fo:marker (fo:marker の中)');
      const markers = this.inMarker ? [] : mkEls.map((x) => this.marker(x, c2));
      this.inTableHF = saved;
      if (markers.length) rows.forEach((r, k) => (r.bodyMarkers = { markers, first: k === 0, last: k === rows.length - 1 }));
      tbl.body.rows.push(...rows);
    }
    // table-body が無く、table-row が直接ある場合
    for (const r of els.filter((e) => this.name(e) === 'table-row')) tbl.body.rows.push(this.row(r, c2, tw, tAlign));
    // table-footer は各ページの末尾で繰り返す (table-omit-footer-at-break="true" なら表の末尾だけ)
    if (footerEl) tbl.footer = { type: 'table-body', rows: hfRows(footerEl) };
    if (this.attr(n, 'table-omit-header-at-break') === 'true') tbl.omitHeaderAtBreak = true;
    if (this.attr(n, 'table-omit-footer-at-break') === 'true') tbl.omitFooterAtBreak = true;
    this.columnsFromCellWidths(tbl);
    return tbl;
  }

  /** fo:table-row を読む: セル・行の背景 (セルに背景が無ければ引き継ぐ)・行の罫線・行の高さ */
  private row(r: XEl, ctx: Ctx, tw: number | undefined, inheritedAlign?: string): LTableRow {
    const rAlign = this.attr(r, 'display-align') ?? inheritedAlign;
    const { style, ctx: c2 } = this.textStyle(r, ctx);
    const bg = c2.hidden ? undefined : this.color(this.attr(r, 'background-color'));
    this.gridRowStart();
    const cells = this.els(r)
      .filter((c) => this.name(c) === 'table-cell')
      .map((c) => {
        const cell = this.cell(c, c2, tw, rAlign);
        // 行の背景は、セルに背景が無ければ引き継ぐ
        if (bg && !cell.backgroundColor) cell.backgroundColor = bg;
        return cell;
      });
    const row: LTableRow = { type: 'table-row', ...this.idOf(r), ...style, cells };
    // 行の罫線は、罫線を重ねる表 (collapse) でだけ使われる (§6.7.9)。使うかどうかは組むときに決まる
    const rb = this.border(r, c2);
    if (rb) row.border = rb;
    // 行の高さ (height / block-progression-dimension): 互換モードは最小の高さとして扱う (中身が多ければ広がる)
    const fs = c2.fontSize;
    // block 方向の寸法: 横書きは height、縦書きは width (どちらも block-progression-dimension と同じ)
    const hv =
      this.attr(r, ctx.wm === 'horizontal-tb' ? 'height' : 'width') ??
      this.dimLimit(r, ctx.wm, 'block', 'minimum') ??
      this.attr(r, 'block-progression-dimension.optimum') ??
      this.attr(r, 'block-progression-dimension');
    if (this.spec) {
      // 仕様 (§7.15.3): 長さだけを書けば minimum = optimum = maximum。行は optimum の高さを目指し、minimum から maximum の間に収める
      const hAttr = ctx.wm === 'horizontal-tb' ? 'height' : 'width';
      const all = this.attr(r, 'block-progression-dimension') ?? this.attr(r, hAttr);
      // 絶対の min-height・max-height (縦書きは min-width・max-width) は、下限・上限の成分に当たる (§5.3.3)
      const comp = (k: 'minimum' | 'optimum' | 'maximum') => {
        const v = (k === 'optimum' ? this.attr(r, 'block-progression-dimension.optimum') : this.dimLimit(r, ctx.wm, 'block', k)) ?? all;
        return v && v !== 'auto' ? this.len(v, fs) : undefined;
      };
      const mn = comp('minimum');
      const opt = comp('optimum');
      const mx = comp('maximum');
      const lo = Math.max(mn ?? 0, opt ?? 0);
      if (lo > 0) row.minHeight = lo;
      if (mx !== undefined && mx > 0) row.maxHeight = mx;
    } else {
      const mh = hv && hv !== 'auto' ? this.len(hv, fs) : undefined;
      if (mh !== undefined && mh > 0) row.minHeight = mh;
    }
    if (this.keepOf(r, 'keep-together', ['page', 'column', ''])) row.keepTogether = true;
    this.rowBreaks(r, row);
    if (this.keepOf(r, 'keep-with-next')) row.keepWithNext = true;
    if (this.keepOf(r, 'keep-with-previous')) row.keepWithPrevious = true;
    return row;
  }

  /** 表の新しい行: 行をまたぐセルの残りの行数を 1 つ減らし、行の頭の列から置く */
  private gridRowStart() {
    if (!this.grid) return;
    this.grid.col = 0;
    this.grid.busy = this.grid.busy.map((b) => Math.max(b - 1, 0));
  }

  /**
   * セルを今の行に置き、セルの内容の幅を返す (列の幅が長さで決まらなければ undefined)。
   * 内容の幅は、またぐ列の幅 (罫線を分ける表は列の間隔も) から、inline 方向の padding と罫線 (重ねる表は半分) を引いたもの
   */
  private gridPlace(colNum: number, cs: number, rs: number, box: ReturnType<Importer['boxStyle']>, wm: WritingMode): number | undefined {
    const g = this.grid;
    if (!g) return undefined;
    let col = colNum > 0 ? colNum - 1 : g.col;
    if (colNum <= 0) while ((g.busy[col] ?? 0) > 0) col++;
    g.col = col + cs;
    for (let k = col; k < col + cs; k++) g.busy[k] = Math.max(g.busy[k] ?? 0, rs);
    let w = 0;
    for (let k = col; k < col + cs; k++) {
      const cw = g.cols[k];
      if (cw === undefined) return undefined;
      w += cw;
    }
    if (!g.collapse) w += (cs - 1) * g.spacing;
    const [a, b] = wm === 'horizontal-tb' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
    const pad = box.padding as Record<string, number> | undefined;
    const bd = box.border as Record<string, { width: number } | undefined> | undefined;
    const bw = ((bd?.[a]?.width ?? 0) + (bd?.[b]?.width ?? 0)) * (g.collapse ? 0.5 : 1);
    return Math.max(w - (pad?.[a] ?? 0) - (pad?.[b] ?? 0) - bw, 0);
  }

  private cell(c: XEl, ctx: Ctx, tw: number | undefined, inheritedAlign?: string): LTableCell {
    const { style, ctx: c2 } = this.textStyle(c, ctx);
    const box = this.boxStyle(c, c2, ctx);
    const colNum = this.colInt(this.attr(c, 'column-number'), 'column-number');
    // 空・数でない値は初期値の 1 (§7.28.13・§7.28.14。NaN のままにすると、後ろのセルの列が決まらない)
    const cs = this.colInt(this.attr(c, 'number-columns-spanned') ?? '1', 'number-columns-spanned') || 1;
    const rs = this.colInt(this.attr(c, 'number-rows-spanned') ?? '1', 'number-rows-spanned') || 1;
    // セルは参照領域なので、中の百分率はセルの内容の幅に対する値。列の幅が決まらなければ、表の幅で代える
    const cellW = this.gridPlace(colNum, Math.max(cs, 1), Math.max(rs, 1), box, c2.wm);
    // セルは参照領域 (§6.7.10) なので、中で明示した start-indent・end-indent は、セルの内容の端から測る (§7.11.7・§7.11.8)。
    // 外の字下げを引かない (引くと、外の字下げの分だけセルの外へはみ出す)。指定の無いブロックは従来どおりセルの端に置く
    const cell: LTableCell = { type: 'table-cell', ...this.idOf(c), ...style, children: this.children(c, { ...c2, startIndent: 0, endIndent: 0, width: cellW ?? tw, cbW: undefined, cbH: undefined }) };
    if (box.padding) cell.padding = box.padding;
    // empty-cells="hide" (継承される。罫線を分ける表で): 中身の無いセルは、罫線と背景を描かない (§7.28.10・CSS2 §17.6.1.1)
    const ec = this.attr(c, 'empty-cells') ?? this.emptyCells;
    const hide = ec === 'hide' && this.separateTable && isEmptyContent(cell.children);
    if (box.border && !hide) cell.border = box.border;
    if (box.backgroundColor && !hide) cell.backgroundColor = box.backgroundColor;
    if (box.diagonalBorder) cell.diagonalBorder = box.diagonalBorder;
    if (box.reverseDiagonalBorder) cell.reverseDiagonalBorder = box.reverseDiagonalBorder;
    // display-align は継承される (表・行グループ・行の指定をセルが引き継ぐ)
    const da = this.attr(c, 'display-align') ?? inheritedAlign;
    if (da === 'center') cell.blockAlign = 'center';
    else if (da === 'after') cell.blockAlign = 'end';
    // display-align が auto (初期値) なら relative-align を使う (§7.14.4)。baseline は、行の中の baseline のセルの 1 行目の基線をそろえる (§7.14.6)
    else if ((da === undefined || da === 'auto') && c2.relAlign === 'baseline') cell.blockAlign = 'baseline';
    if (colNum > 0) this.cellColumn.set(cell, colNum);
    // セルの幅の指定 (inline-progression-dimension / width)。列の幅の指定が無い列の幅に使う
    if (box.width !== undefined) this.cellWidth.set(cell, box.width);
    if (cs > 1) cell.colSpan = cs;
    if (rs > 1) cell.rowSpan = rs;
    return cell;
  }

  /** table-row・list-item の break-before・break-after (§7.20.2: fo:list-item・fo:table-row にも当たる) */
  private rowBreaks(el: XEl, row: LTableRow) {
    const brk = (v: string | undefined) => v === 'page' || v === 'column' || v === 'odd-page' || v === 'even-page';
    if (brk(this.attr(el, 'break-before'))) row.breakBefore = true;
    if (brk(this.attr(el, 'break-after'))) row.breakAfter = true;
  }

  /** list-block → 「ラベル列 + 本体列」の枠なし表 (項目ごとに 1 行) */
  private listBlock(n: XEl, ctx: Ctx): LTable {
    const { style, ctx: c2 } = this.textStyle(n, ctx);
    const box = this.boxStyle(n, c2, ctx);
    // ラベル・本体の start-indent / end-indent は、参照領域からの位置 (§5.3.2)。リストの表の内容の端 (list-block 自身の
    // start-indent・end-indent の位置) を基準に直す
    const sP = this.phys('start', c2.wm, c2.rtl);
    const eP = this.phys('end', c2.wm, c2.rtl);
    const edgeOfBox = (side: string) =>
      ((box.margin as Record<string, number> | undefined)?.[side] ?? 0) +
      ((box.padding as Record<string, number> | undefined)?.[side] ?? 0) +
      ((box.border as Record<string, { width: number } | undefined> | undefined)?.[side]?.width ?? 0);
    const listStart = ctx.startIndent + edgeOfBox(sP);
    const listEnd = ctx.endIndent + edgeOfBox(eP);
    // provisional-distance-between-starts・provisional-label-separation は継承される (付録 B の表。入れ子のリストは外のリストの値)
    const pdbs = this.len(this.attr(n, 'provisional-distance-between-starts'), c2.fontSize, ctx.width) ?? ctx.listPdbs ?? 24;
    let dist = pdbs;
    // 本体に start-indent を長さで指定していれば (body-start() でなく)、それが本体の始端 (ラベルの列の幅は、リストの始端からの距離)
    const firstBody = this.els(n)
      .filter((e) => this.name(e) === 'list-item')
      .map((it) => this.els(it).find((e) => this.name(e) === 'list-item-body'))
      .find((b) => b && this.attr(b, 'start-indent'));
    const bsi = firstBody ? this.attr(firstBody, 'start-indent') : undefined;
    if (bsi && !/\(/.test(bsi)) {
      const v = this.len(bsi, this.textStyle(firstBody!, c2).ctx.fontSize, ctx.width);
      if (v !== undefined && v - listStart > 0) dist = v - listStart;
    }
    // ラベル・本体に長さで書いた start-indent / end-indent (リストの始端・終端からの位置)。body-start()・label-end() などの関数は除く
    const lenIndent = (e: XEl | undefined, k: 'start-indent' | 'end-indent', base: number) => {
      const v = e ? this.attr(e, k) : undefined;
      if (!v || /\(/.test(v)) return undefined;
      const x = this.len(v, this.textStyle(e!, c2).ctx.fontSize, ctx.width);
      return x !== undefined && x - base > 0 ? x - base : undefined;
    };
    const items = this.els(n).filter((e) => this.name(e) === 'list-item');
    const firstLabel = items.map((it) => this.els(it).find((e) => this.name(e) === 'list-item-label')).find(Boolean);
    const labelStart0 = lenIndent(firstLabel, 'start-indent', listStart);
    // 互換モード: ラベルに start-indent があると、本体の始端 (body-start()) をその分だけ後ろへずらす
    // (仕様 (§7.30.4) では body-start() はリストの start-indent + 間隔)
    if (!this.spec && labelStart0 !== undefined && !(bsi && !/\(/.test(bsi))) dist += labelStart0;
    // ラベルの終端は、本体の始端から provisional-label-separation (既定 6pt) だけ手前 (label-end() §7.30.11-12)
    const sepL = this.len(this.attr(n, 'provisional-label-separation'), c2.fontSize, ctx.width) ?? ctx.listSep ?? 6;
    const rows: LTableRow[] = [];
    for (const it of items) {
      const { style: s2, ctx: c30 } = this.textStyle(it, c2);
      const c3: Ctx = { ...c30, listPdbs: pdbs, listSep: sepL };
      const label = this.els(it).find((e) => this.name(e) === 'list-item-label');
      const body = this.els(it).find((e) => this.name(e) === 'list-item-body');
      const itemBox = this.boxStyle(it, c3, c2);
      // ラベル・本体自身の書式 (継承される性質) と id も、セルに載せる
      const mk = (e: XEl | undefined, extra: Partial<LTableCell> = {}): LTableCell => {
        if (!e) return { type: 'table-cell', ...extra, children: [] };
        const { style: es, ctx: ec } = this.textStyle(e, c3);
        return { type: 'table-cell', ...this.idOf(e), ...es, ...extra, children: this.children(e, ec) };
      };
      const labelCell = mk(label, { textAlign: 'start' });
      const endSide = this.phys('end', c3.wm, c3.rtl);
      const startSide = this.phys('start', c3.wm, c3.rtl);
      // ラベルの start-indent は、ラベルの列の中の字下げ。本体の end-indent は、本体の列の終端からの字下げ
      const labelStart = lenIndent(label, 'start-indent', listStart);
      const bodyEnd = lenIndent(body, 'end-indent', listEnd);
      // ラベルに end-indent="label-end()" があるときだけ、ラベルの終端を空ける (指定が無ければ、ラベルは列の幅いっぱい)。
      // label-end() のラベルの終端は、リストの始端から provisional-distance-between-starts − provisional-label-separation
      // (§7.30.11。本体の実際の start-indent ではない)。互換モードは、ラベルの start-indent でずらした本体の始端から測る
      const labelEnd = label ? [label, ...this.els(label)].some((e) => /label-end\(\)/.test(this.attr(e, 'end-indent') ?? '')) : false;
      const labelEndGap = this.spec || !(labelStart0 !== undefined && !(bsi && !/\(/.test(bsi))) ? dist - (pdbs - sepL) : sepL;
      if (labelEnd && labelEndGap > 0) labelCell.padding = { [endSide]: Math.min(labelEndGap, dist) };
      if (labelStart !== undefined) labelCell.padding = { ...(labelCell.padding as object), [startSide]: Math.min(labelStart, dist) };
      const bodyCell = mk(body);
      if (bodyEnd !== undefined) bodyCell.padding = { [endSide]: bodyEnd };
      // relative-align="baseline" の項目 (§7.14.6): ラベルと本体の 1 行目の基線をそろえる
      if (c3.relAlign === 'baseline') labelCell.blockAlign = bodyCell.blockAlign = 'baseline';
      const row: LTableRow = { type: 'table-row', ...this.idOf(it), ...s2, cells: [labelCell, bodyCell] };
      if (itemBox.margin) {
        // 項目の space-before / space-after は、行の前後の余白にする (隣の項目・リストの前後の余白と重ね合わせる。§4.3.1)
        const sb = (itemBox.margin as Record<string, number>)[this.phys('before', c3.wm, c3.rtl)] ?? 0;
        const sa = (itemBox.margin as Record<string, number>)[this.phys('after', c3.wm, c3.rtl)] ?? 0;
        if (sb) row.spaceBefore = sb;
        if (sa) row.spaceAfter = sa;
      }
      if (this.keepOf(it, 'keep-with-next')) row.keepWithNext = true;
      if (this.keepOf(it, 'keep-with-previous')) row.keepWithPrevious = true;
      if (this.keepOf(it, 'keep-together', ['page', 'column', ''])) row.keepTogether = true;
      this.rowBreaks(it, row);
      rows.push(row);
    }
    this.report.counts.tables++;
    return {
      type: 'table',
      ...this.idOf(n),
      ...style,
      ...(box as object),
      columns: [
        { type: 'table-column', width: dist },
        { type: 'table-column', width: '1*' },
      ],
      body: { type: 'table-body', rows },
    };
  }
}

/** XML 文字列 (FO) を Kumiori の論理ツリーへ変換する。parse には DOMParser / xmldom を包んだ関数を渡す */
export function importXslFo(xml: string, parse: (xml: string) => XNode, opts: ImportOptions = {}): ImportResult {
  const importer = new Importer(opts);
  importer.parseXml = parse;
  // 先頭の BOM・空白は XML 宣言の前に置けない (サンプルにも存在する) ので取り除く
  const dom = parse(xml.replace(/^[\uFEFF\s]+/, ''));
  const root = dom.nodeType === 9 ? (Array.from(dom.childNodes).find((c) => c.nodeType === 1) as XEl) : dom;
  if (!root || (importer.name(root) !== 'root' && !root.nodeName.endsWith('root'))) throw new Error(msg('fo:root が見つかりません (XSL-FO ではないようです)', 'fo:root was not found (this does not look like XSL-FO)'));
  let document: LDocument;
  try {
    document = importer.convert(root);
  } catch (e) {
    // 深さの上限 (MAX_FO_NEST) の中でも、呼び出しの深さを使い切ることがありうる (実行環境のスタックが小さいとき)。
    // そのときも、何が起きたかの分かる誤りにする
    if (e instanceof RangeError && /call stack|recursion/i.test(e.message)) throw tooDeep();
    throw e;
  }
  return { document, report: importer.report };
}

/** ブラウザ用: DOMParser を使うパーサ */
export const browserParse = (xml: string): XNode => {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  const err = d.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(msg(`XML の解析に失敗しました: ${err.textContent?.slice(0, 200)}`, `XML parse error: ${err.textContent?.slice(0, 200)}`));
  return d as unknown as XNode;
};

/**
 * writing-mode の値の裏返し (XSL 1.1 §7.29.7)。横・縦 (と右から左) で組めるもの (lr-tb・rl-tb・tb-rl・tb-lr と略記) は undefined
 */
export function flipOf(v: string): WritingFlip | undefined {
  switch (v) {
    case 'bt-lr':
    case 'bt-rl':
      return { inline: true };
    case 'lr-bt':
    case 'rl-bt':
      return { block: true };
    case 'lr-alternating-rl-bt':
      return { block: true, alternate: 'reverse' };
    case 'lr-alternating-rl-tb':
      return { alternate: 'reverse' };
    case 'lr-inverting-rl-bt':
      return { block: true, alternate: 'invert' };
    case 'lr-inverting-rl-tb':
      return { alternate: 'invert' };
    case 'tb-lr-in-lr-pairs':
      return { pairs: true };
    default:
      return undefined;
  }
}

/**
 * tb-lr-in-lr-pairs: 文字列を 2 字ずつの縦中横 (横に組んだ組) にする。中の block-container (自分の書字方向を持つ) には入らない。
 * 組の送りは 1em に収める (縦中横のまま。全角の 2 字は縮む)
 */
function pairText(kids: ReadonlyArray<LBlockLevel | LInlineLevel>): Array<LBlockLevel | LInlineLevel> {
  return kids.flatMap((k): Array<LBlockLevel | LInlineLevel> => {
    if (typeof k === 'string') {
      const chars = [...k.replace(/\s+/g, '')];
      const out: LInlineLevel[] = [];
      for (let i = 0; i < chars.length; i += 2) out.push({ type: 'tate-chu-yoko', text: chars.slice(i, i + 2).join(''), fit: true });
      return out;
    }
    if (k.type === 'block-container') return [k];
    const kk = k as { children?: Array<LBlockLevel | LInlineLevel> };
    return Array.isArray(kk.children) ? [{ ...k, children: pairText(kk.children) } as LBlockLevel | LInlineLevel] : [k];
  });
}

function splitFontFamily(ff: string): string[] {
  return splitTopLevel(ff, ',')
    .map((n) => n.replace(/['"]/g, '').trim())
    .filter(Boolean);
}

/** 区切り (',' か空白 ' ') で分ける。括弧と引用符の中では分けない (axf:box-shadow の rgb(…, …) など) */
function splitTopLevel(s: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** セルの中身が空か (空白だけの文字列と、中身の無いブロックだけ) */
function isEmptyContent(kids: Array<LBlockLevel | LInlineLevel>): boolean {
  return kids.every((k) => (typeof k === 'string' ? isXmlSpaceOnly(k) : (k as { type: string }).type === 'block' && isEmptyContent(((k as LBlock).children ?? []) as Array<LBlockLevel | LInlineLevel>)));
}

/** XML の空白 (スペース・タブ・改行・CR) だけの文字列か。String.prototype.trim と違い、U+00A0 などは空白とみなさない */
/** 効いている変更バーが無い (XSL 1.1 §6.13.2)。要素に付けると、親から引き継いだ変更バーを消す */
const NO_BARS: RevisionBar[] = [];

function isXmlSpaceOnly(t: string): boolean {
  return /^[ \t\n\r]*$/.test(t);
}
