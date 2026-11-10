/**
 * foMathFallback — 数式用の書体 (MATH 表を持つ書体) が無いときの、MathML の後備の組み方。
 * MathML (Presentation と Content) を Kumiori の行内の要素 (上付き・下付き・分数の箱・表など) に組み替えて、本文の書体で組む。
 * 伸縮する括弧・アクセントの矢印・根号・上下の括弧は、SVG の図形 (data URI の画像) で描く。
 * 数式用の書体があるときは使われない (xslfoImport の mathFormula が mathLayout で組む)。
 * 属性・長さ・色の読み方は Importer (xslfoImport.ts) のものを FoMathHost として借りる。処理は Importer にあったものをそのまま移した
 */
import type { LBlock, LInline, LInlineContainer, LInlineLevel, LTable, LTableCell, TextAlign } from './types';
import { toCss } from './color';
import { utf8Base64, type XEl } from './foDom';

/** 数式の組み替えが Importer から借りる読み方 */
export interface FoMathHost {
  name(n: XEl): string;
  els(n: XEl): XEl[];
  attr(n: XEl, k: string): string | undefined;
  len(v: string | undefined, fs: number, pct?: number, lh?: number): number | undefined;
  color(v: string | undefined): string | undefined;
  miss(what: string, n?: number): void;
  /** 参照する画像 (図形の data URI) を読み込みの報告に足す */
  addImage(src: string): void;
}

/**
 * 要素の入れ子の深さの上限 (数式用の書体で組むときの mathLayout の MAX_MATH_NEST と同じ値)。JS の呼び出しの深さを使い切らないよう、
 * これより深い要素は空にする。実在の数式の入れ子は数十段まで
 */
const MAX_MATH_NEST = 300;

/** 最大値 (Math.max(...list) は、要素の数が引数の数の上限 (十数万) を超えると RangeError になる) */
function maxOf(list: readonly number[], init: number): number {
  let m = init;
  for (const v of list) if (v > m) m = v;
  return m;
}

export class FoMathFallback {
  constructor(private readonly fo: FoMathHost) {}
  /** 組み替えている要素の入れ子の深さ */
  private nest = 0;
  /** 高さを見積もっている要素の入れ子の深さ */
  private extentNest = 0;

  /** MathML を行内の要素に組み替える。深すぎる入れ子 (MAX_MATH_NEST) は空にして、読み込みの報告に数える */
  mathml(n: XEl, fs: number): LInlineLevel {
    if (this.nest >= MAX_MATH_NEST) {
      this.fo.miss('MathML の深すぎる入れ子');
      return '';
    }
    this.nest++;
    try {
      return this.mathmlElement(n, fs);
    } finally {
      this.nest--;
    }
  }

  /**
   * MathML (Presentation) を行内の要素に組み替える。字の大きさ・上げ下げ・積み重ね (分数・上下の添え字) は Kumiori の行内の箱で表す。
   * 対応: mi (1 字は斜体)・mn・mo・mtext・ms・mspace・mrow・mstyle・mpadded・mphantom・msup・msub・msubsup・mfrac・msqrt・mroot・
   * mover・munder・munderover・mfenced・mtable (行を積む)・semantics。伸縮する括弧 (中身の高さの見積もりで図形を描く)・
   * アクセントの矢印・根号は図形と罫線で描く。揃え (maligngroup) は扱わない
   */
  private mathmlElement(n: XEl, fs: number): LInlineLevel {
    // 字の色・大きさ・太さ・字体の属性 (MathML 2 の mathcolor・mathsize と、古い color・fontsize・fontweight・fontstyle)
    const color = this.fo.color(this.fo.attr(n, 'mathcolor') ?? this.fo.attr(n, 'color'));
    const sizeAttr = this.fo.attr(n, 'mathsize') ?? this.fo.attr(n, 'fontsize');
    const named: Record<string, number> = { small: 0.71, normal: 1, big: 1.41 };
    const size = sizeAttr ? (named[sizeAttr] !== undefined ? fs * named[sizeAttr] : this.fo.len(sizeAttr, fs, fs)) : undefined;
    const weight = this.fo.attr(n, 'fontweight');
    const extra: Partial<LInline> = {
      ...(color ? { color } : {}),
      ...(weight === 'bold' ? { fontWeight: 700 } : weight === 'normal' ? { fontWeight: 400 } : {}),
    };
    const fs2 = size && size > 0 ? size : fs;
    // 別行立ての数式 (display="block")・displaystyle="true" の中の分数は、分子・分母を小さくしない
    const prevDisplay = this.mathDisplay;
    const prevRootTable = this.mathRootTable;
    if (this.fo.name(n) === 'math') {
      this.mathRootTable = undefined;
      this.mathDisplay = this.fo.attr(n, 'display') === 'block' || this.fo.attr(n, 'mode') === 'display';
      // 数式の全体が 1 つの表 (mtable) のとき: 表の下端を行の文字の下端に揃える (アンテナハウスに合わせる。式の中の表は軸に揃える)
      let r: XEl | undefined = n;
      while (r && (this.fo.name(r) === 'math' || this.fo.name(r) === 'mrow' || this.fo.name(r) === 'semantics') && this.fo.els(r).length >= 1) r = this.fo.name(r) === 'semantics' ? this.fo.els(r)[0] : this.fo.els(r).length === 1 ? this.fo.els(r)[0] : undefined;
      if (r && this.fo.name(r) === 'mtable') this.mathRootTable = r;
    }
    const ds = this.fo.attr(n, 'displaystyle');
    if (ds) this.mathDisplay = ds === 'true';
    const prevColor = this.mathColor;
    if (color) this.mathColor = color;
    const body = this.mathmlBody(n, fs2);
    if (this.fo.name(n) === 'math') this.mathRootTable = prevRootTable;
    this.mathColor = prevColor;
    this.mathDisplay = prevDisplay;
    if (!Object.keys(extra).length && fs2 === fs) return body;
    return { type: 'inline', fontSize: fs2, ...extra, children: [body] };
  }
  /** 数式の全体になっている表 (mtable) */
  private mathRootTable?: XEl;
  /** いま組んでいる数式が displaystyle か (分数の分子・分母の大きさを決める) */
  private mathDisplay = false;
  /** いま組んでいる数式の字の色 (伸ばした括弧・矢印・根号などの図形の色) */
  mathColor = '#000000';

  /** 伸ばせる括弧類 (MathML の演算子辞書で stretchy・fence のもの) */
  private static readonly FENCES = /^[()[\]{}|‖⟨⟩〈〉⌈⌉⌊⌋]$/;

  /**
   * 数式の要素の高さの見積もり (pt)。伸縮する括弧・根号の記号の大きさを、組む前に決めるために使う。
   * 字は 1em、分数は分子と分母の段 (行の高さ 1.15) の和、上付き・下付きは小さい字の分だけ足す
   */
  private mathExtent(n: XEl, fs: number): number {
    // 入れ子の mrow ごとに同じ部分木を測り直さないよう、要素・字の大きさ・displaystyle ごとに覚えておく
    const key = `${fs}|${this.mathDisplay ? 1 : 0}`;
    let memo = this.extentMemo.get(n);
    const hit = memo?.get(key);
    if (hit !== undefined) return hit;
    // 深すぎる入れ子は測らない (字 1 つ分の高さにする)
    if (this.extentNest >= MAX_MATH_NEST) return fs;
    this.extentNest++;
    let v: number;
    try {
      v = this.measureMathExtent(n, fs);
    } finally {
      this.extentNest--;
    }
    if (!memo) this.extentMemo.set(n, (memo = new Map()));
    memo.set(key, v);
    return v;
  }
  private extentMemo = new WeakMap<XEl, Map<string, number>>();

  private measureMathExtent(n: XEl, fs: number): number {
    const small = Math.max(fs * 0.71, 4);
    const els = this.fo.els(n);
    const max = (size: number, list = els) => maxOf(list.map((e) => this.mathExtent(e, size)), fs);
    switch (this.fo.name(n)) {
      case 'mfrac': {
        const fsz = this.mathDisplay ? fs : small;
        const row = (e?: XEl) => Math.max(fsz * 1.15, e ? this.mathExtent(e, fsz) : 0);
        return row(els[0]) + row(els[1]);
      }
      case 'msup':
      case 'msub':
        return (els[0] ? this.mathExtent(els[0], fs) : fs) + small * 0.4;
      case 'msubsup':
        return (els[0] ? this.mathExtent(els[0], fs) : fs) + small * 0.8;
      case 'msqrt':
        return max(fs) + small * 0.2;
      case 'mroot':
        return (els[0] ? this.mathExtent(els[0], fs) : fs) + small * 0.2;
      case 'mover':
      case 'munder':
        // アクセント (→ ‾ など) は字のすぐ上に細く置くので、字の大きさの 1/4 ほどしか足さない
        return (els[0] ? this.mathExtent(els[0], fs) : fs) + (els[1] ? (this.fo.attr(n, 'accent') === 'true' || this.fo.attr(n, 'accentunder') === 'true' ? fs * 0.25 : Math.max(small * 1.15, this.mathExtent(els[1], small) * 1.15)) : 0);
      case 'munderover':
        return (els[0] ? this.mathExtent(els[0], fs) : fs) + 2 * small * 1.15;
      case 'mtable': {
        const rows = els.filter((r) => /^(mtr|mlabeledtr)$/.test(this.fo.name(r)));
        return rows.reduce((a, r) => a + maxOf(this.fo.els(r).map((c) => this.mathExtent(c, fs)), fs) + fs * 0.43, 0);
      }
      case 'semantics':
        return els[0] ? this.mathExtent(els[0], fs) : fs;
      case 'mi':
      case 'mn':
      case 'mo':
      case 'mtext':
      case 'ms':
      case 'mspace':
        return fs;
      default:
        return max(fs);
    }
  }

  /**
   * 数式の図形 (線の path) を、いまの数式の字の色の SVG の data URI にして、画像として登録する。
   * d の数は小数 2 桁に丸める。round は線の端を丸めるか
   */
  private mathShape(d: string, w: number, h: number, sw: number, round = true): string {
    const r = (v: number) => +v.toFixed(2);
    const path = d.replace(/-?\d+\.?\d*(e-?\d+)?/g, (v) => String(r(parseFloat(v))));
    const cap = round ? ' stroke-linecap="round"' : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}pt" height="${r(h)}pt" viewBox="0 0 ${r(w)} ${r(h)}"><path d="${path}" fill="none" stroke="${toCss(this.mathColor)}" stroke-width="${r(sw)}"${cap} stroke-linejoin="round"/></svg>`;
    const src = `data:image/svg+xml;base64,${utf8Base64(svg)}`;
    this.fo.addImage(src);
    return src;
  }

  /**
   * 伸ばした括弧類を、その高さの SVG の図形で描いて、行の中央 (分数の箱と同じ) にそろえて置く。
   * 高さが 1 行に収まるなら undefined (字のまま組む)
   */
  private stretchedFence(ch: string, h: number, fs: number): LInlineLevel | undefined {
    if (h <= fs * 1.25) return undefined;
    const sw = Math.max(fs * 0.055, 0.5);
    const w = Math.min(fs * 0.3 + h * 0.04, fs * 0.6);
    const pad = fs * 0.06;
    const W = w + pad * 2;
    const x0 = pad;
    const x1 = pad + w;
    const t = sw / 2;
    const b = h - sw / 2;
    const m = h / 2;
    const paths: Record<string, string> = {
      '(': `M${x1} ${t} Q${x0 - w * 0.3} ${m} ${x1} ${b}`,
      ')': `M${x0} ${t} Q${x1 + w * 0.3} ${m} ${x0} ${b}`,
      '[': `M${x1} ${t} H${x0 + w * 0.2} V${b} H${x1}`,
      ']': `M${x0} ${t} H${x1 - w * 0.2} V${b} H${x0}`,
      '⌈': `M${x1} ${t} H${x0 + w * 0.2} V${b}`,
      '⌉': `M${x0} ${t} H${x1 - w * 0.2} V${b}`,
      '⌊': `M${x0 + w * 0.2} ${t} V${b} H${x1}`,
      '⌋': `M${x1 - w * 0.2} ${t} V${b} H${x0}`,
      '{': `M${x1} ${t} Q${x0 + w * 0.45} ${t} ${x0 + w * 0.45} ${h * 0.12} V${m - h * 0.08} Q${x0 + w * 0.45} ${m} ${x0} ${m} Q${x0 + w * 0.45} ${m} ${x0 + w * 0.45} ${m + h * 0.08} V${h * 0.88} Q${x0 + w * 0.45} ${b} ${x1} ${b}`,
      '}': `M${x0} ${t} Q${x1 - w * 0.45} ${t} ${x1 - w * 0.45} ${h * 0.12} V${m - h * 0.08} Q${x1 - w * 0.45} ${m} ${x1} ${m} Q${x1 - w * 0.45} ${m} ${x1 - w * 0.45} ${m + h * 0.08} V${h * 0.88} Q${x1 - w * 0.45} ${b} ${x0} ${b}`,
      '|': `M${W / 2} ${t} V${b}`,
      '‖': `M${W / 2 - w * 0.2} ${t} V${b} M${W / 2 + w * 0.2} ${t} V${b}`,
      '⟨': `M${x1} ${t} L${x0} ${m} L${x1} ${b}`,
      '〈': `M${x1} ${t} L${x0} ${m} L${x1} ${b}`,
      '⟩': `M${x0} ${t} L${x1} ${m} L${x0} ${b}`,
      '〉': `M${x0} ${t} L${x1} ${m} L${x0} ${b}`,
    };
    const d = paths[ch];
    if (!d) return undefined;
    const src = this.mathShape(d, W, h, sw);
    return {
      type: 'inline-container',
      alignmentBaseline: 'central',
      // 行の高さを画像の高さだけにする (字の大きさをごく小さくして、字の上下の高さが足されないように)
      children: [{ type: 'block', lineHeight: 1, fontSize: 0.5, children: [{ type: 'image', src, width: W, height: h }] }],
    };
  }

  /**
   * アクセントの矢印 (→ ← ↔ ⃗)・横線 (‾ ¯ ― −) を、下の字の幅 (字数からの見積もり) の SVG の図形にする。
   * 対応していない記号は undefined (字のまま組む)
   */
  private accentShape(ch: string, base: XEl, fs: number): LInlineLevel | undefined {
    const arrow = /^[→⃗⟶]$/.test(ch) ? 'r' : /^[←⟵]$/.test(ch) ? 'l' : /^[↔⟷]$/.test(ch) ? 'b' : /^[‾¯―−_]$/.test(ch) ? 'n' : undefined;
    if (!arrow) return undefined;
    const t = [...(base.textContent ?? '').replace(/\s+/g, '')];
    const w = Math.max(fs * 0.5, t.reduce((a, c) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? fs : /[A-Zmw]/.test(c) ? fs * 0.65 : fs * 0.5), 0));
    const sw = Math.max(fs * 0.045, 0.4);
    const head = fs * 0.12;
    const h = head * 2 + sw;
    const m = h / 2;
    const r = (v: number) => +v.toFixed(2);
    let d = `M${r(sw)} ${r(m)} H${r(w - sw)}`;
    if (arrow === 'r' || arrow === 'b') d += ` M${r(w - sw - head * 1.4)} ${r(m - head)} L${r(w - sw)} ${r(m)} L${r(w - sw - head * 1.4)} ${r(m + head)}`;
    if (arrow === 'l' || arrow === 'b') d += ` M${r(sw + head * 1.4)} ${r(m - head)} L${r(sw)} ${r(m)} L${r(sw + head * 1.4)} ${r(m + head)}`;
    const src = this.mathShape(d, w, h, sw);
    return { type: 'image', src, width: r(w), height: r(h) };
  }

  /**
   * 根号: 中身を、上と左に罫線のある行内の箱に入れ (上の線と縦の線になる。中身の高さが変わっても線はつながる)、
   * その前に左下の「はね」を小さな図形で置く
   */
  private radical(content: LInlineLevel[], fs: number): LInlineLevel[] {
    const sw = Math.max(fs * 0.05, 0.4);
    const w = fs * 0.32;
    const h = fs * 0.5;
    const r = (v: number) => +v.toFixed(2);
    // はね: 左の短い上り → 右下へ下る線 (右下の端が、箱の左の罫線の下端に届く)
    const d = `M${r(sw)} ${r(h * 0.62)} L${r(w * 0.3)} ${r(h * 0.45)} L${r(w)} ${r(h - sw / 2)}`;
    const src = this.mathShape(d, w, h, sw);
    const line = { width: r(sw), color: this.mathColor };
    return [
      // 箱の下端 (字の下がり) に合わせて、はねを基線より下げる
      { type: 'inline', baselineShift: -fs * 0.22, children: [{ type: 'image', src, width: r(w), height: r(h) }] },
      {
        type: 'inline-container',
        alignmentBaseline: 'central',
        children: [{ type: 'block', fontSize: fs, lineHeight: 1.1, padding: { top: fs * 0.08, left: fs * 0.08, right: fs * 0.04 }, border: { top: line, left: line }, children: content }],
      },
    ];
  }

  /** 上下の角括弧 (⎴ ⎵)・波括弧 (⏞ ⏟) を、字 1 つ分の幅の図形にする */
  private horizontalBracket(ch: string, fs: number): LInlineLevel | undefined {
    const kind = { '⎴': 'top', '⏞': 'top', '⎵': 'bottom', '⏟': 'bottom' }[ch];
    if (!kind) return undefined;
    const sw = Math.max(fs * 0.05, 0.4);
    const w = fs * 0.8;
    const h = fs * 0.3;
    const r = (v: number) => +v.toFixed(2);
    const top = kind === 'top';
    const y0 = top ? h - sw / 2 : sw / 2;
    const y1 = top ? sw / 2 : h - sw / 2;
    const d = `M${r(sw / 2)} ${r(y0)} V${r(y1)} H${r(w - sw / 2)} V${r(y0)}`;
    const src = this.mathShape(d, w, h, sw, false);
    return { type: 'image', src, width: r(w), height: r(h) };
  }

  /** mrow などの子を組み、伸ばせる括弧 (stretchy="false" でないもの) を、ほかの子の高さまで伸ばす */
  private mathRow(els: XEl[], fs: number): LInlineLevel[] {
    const isFence = (e: XEl) => this.fo.name(e) === 'mo' && FoMathFallback.FENCES.test((e.textContent ?? '').trim()) && this.fo.attr(e, 'stretchy') !== 'false';
    const others = els.filter((e) => !isFence(e));
    const h = others.length ? maxOf(others.map((e) => this.mathExtent(e, fs)), -Infinity) : fs;
    return els.map((e) => (isFence(e) ? (this.stretchedFence((e.textContent ?? '').trim(), h, fs) ?? this.mathml(e, fs)) : this.mathml(e, fs)));
  }

  private mathmlBody(n: XEl, fs: number): LInlineLevel {
    const kids = (e: XEl, size: number) => this.fo.els(e).map((c) => this.mathml(c, size));
    const text = (e: XEl) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
    const small = Math.max(fs * 0.71, 4);
    const inl = (children: LInlineLevel[], extra: Partial<LInline> = {}): LInline => ({ type: 'inline', fontSize: fs, children, ...extra });
    // 縦に積む箱 (分数・上下の添え字): 各段を中央揃えの 1 行のブロックにする
    const stack = (rows: Array<{ v: LInlineLevel; size: number; rule?: boolean; lh?: number; tight?: boolean }>, align: LInlineContainer['alignmentBaseline'] = 'central'): LInlineContainer => ({
      type: 'inline-container',
      alignmentBaseline: align,
      children: rows.map(
        (r): LBlock => ({
          type: 'block',
          textAlign: 'center',
          fontSize: r.size,
          lineHeight: r.lh ?? 1.15,
          ...(r.tight ? { lineStackingStrategy: 'line-height' as const } : {}),
          ...(r.rule ? { border: { bottom: { width: Math.max(fs * 0.05, 0.4), color: '#000000' } } } : {}),
          children: [r.v],
        }),
      ),
    });
    const name = this.fo.name(n);
    const els = this.fo.els(n);
    switch (name) {
      case 'math':
      case 'mrow':
      case 'mstyle':
      case 'mpadded':
      case 'menclose':
      case 'merror':
      case 'mtd':
      case 'mtr':
      case 'mmultiscripts':
        return inl(this.mathRow(els, fs));
      case 'semantics':
        return els[0] ? this.mathml(els[0], fs) : '';
      case 'annotation':
      case 'annotation-xml':
      case 'maligngroup':
      case 'malignmark':
      case 'none':
      case 'mprescripts':
        return '';
      case 'mphantom':
        return inl(kids(n, fs), { color: 'transparent' });
      case 'mi': {
        const t = text(n);
        const variant = this.fo.attr(n, 'mathvariant');
        const fst = this.fo.attr(n, 'fontstyle');
        const italic = fst ? fst === 'italic' : variant ? variant.includes('italic') : [...t].length === 1;
        return inl([t], { ...(italic ? { fontStyle: 'italic' as const } : {}), ...(variant?.includes('bold') ? { fontWeight: 700 } : {}) });
      }
      case 'mn':
      case 'mtext':
        return inl([text(n)]);
      case 'ms':
        return inl([`"${text(n)}"`]);
      case 'mo': {
        const t = text(n);
        // 見えない演算子 (関数の適用・見えない掛け算・区切り・足し算 U+2061〜U+2064) は字を置かない
        if (/^[\u2061-\u2064]*$/.test(t)) return '';
        // 上下の角括弧・波括弧 (⎴ ⎵ ⏞ ⏟) は書体に無いことが多いので、図形で描く
        const brace = this.horizontalBracket(t, fs);
        if (brace) return brace;
        // 二項・関係の演算子は前後に細いアキ (区切りの , ; は後ろだけ)
        const spaced = /^[+\-−=<>≤≥≠≈±×÷→←↔⇒⇔∈∉⊂⊃∪∩∧∨]$/.test(t);
        // アキは字 (U+2005 など) ではなく行内の余白で取る (書体に無い字で豆腐にならないように)
        const gap = fs * 0.22;
        return inl([t], spaced ? { padding: { left: gap, right: gap } } : /^[,;]$/.test(t) ? { padding: { right: gap } } : {});
      }
      case 'mspace':
        return inl([' ']);
      case 'msup':
      case 'msub':
        return inl([els[0] ? this.mathml(els[0], fs) : '', inl(els[1] ? [this.mathml(els[1], small)] : [], { fontSize: small, baselineShift: name === 'msup' ? 'super' : 'sub' })]);
      case 'msubsup':
        return inl([
          els[0] ? this.mathml(els[0], fs) : '',
          inl(els[1] ? [this.mathml(els[1], small)] : [], { fontSize: small, baselineShift: 'sub' }),
          inl(els[2] ? [this.mathml(els[2], small)] : [], { fontSize: small, baselineShift: 'super' }),
        ]);
      case 'mfrac': {
        // displaystyle の分数は本文と同じ大きさ。分子・分母の中は displaystyle でなくなる
        const fsz = this.mathDisplay ? fs : small;
        const prev = this.mathDisplay;
        this.mathDisplay = false;
        const num = els[0] ? this.mathml(els[0], fsz) : '';
        const den = els[1] ? this.mathml(els[1], fsz) : '';
        this.mathDisplay = prev;
        return stack([
          { v: num, size: fsz, rule: this.fo.attr(n, 'linethickness') !== '0' },
          { v: den, size: fsz },
        ]);
      }
      case 'msqrt':
        return inl(this.radical(this.mathRow(els, fs), fs));
      case 'mroot': {
        const idx = small * 0.85;
        return inl([inl(els[1] ? [this.mathml(els[1], idx)] : [], { fontSize: idx, baselineShift: fs * 0.35 }), ...this.radical(els[0] ? [this.mathml(els[0], fs)] : [], fs)]);
      }
      case 'mover':
      case 'munder':
      case 'munderover': {
        const under = name === 'mover' ? undefined : els[1];
        const over = name === 'mover' ? els[1] : name === 'munderover' ? els[2] : undefined;
        // アクセント (accent="true" の上の → ・ ̄ など) は、字のすぐ上に詰めて置き、元の字の基線を行の基線に揃える
        const accent = this.fo.attr(n, 'accent') === 'true' || (!!over && this.fo.attr(over, 'accent') === 'true');
        // 矢印・横線のアクセントは、下の字の幅に合わせた細い図形にして、字のすぐ上に置く (アンテナハウスと同じ)
        const drawn = accent && over && name === 'mover' && els[0] ? this.accentShape((over.textContent ?? '').trim(), els[0], fs) : undefined;
        if (drawn)
          return stack(
            [
              { v: drawn, size: 0.5, lh: 1 },
              { v: this.mathml(els[0], fs), size: fs, lh: 1, tight: true },
            ],
            'after-edge',
          );
        return stack(
          [
            // アクセントの段は行の高さを詰め (line-stacking-strategy="line-height")、記号を下の字の字面の上の空きに重ねる
            ...(over ? [{ v: this.mathml(over, small), size: small, ...(accent ? { lh: 0.35, tight: true } : {}) }] : []),
            { v: els[0] ? this.mathml(els[0], fs) : '', size: fs, ...(accent ? { lh: 1 } : {}) },
            ...(under ? [{ v: this.mathml(under, small), size: small }] : []),
          ],
          name === 'mover' ? 'after-edge' : name === 'munder' ? 'before-edge' : 'central',
        );
      }
      case 'mfenced': {
        const open = this.fo.attr(n, 'open') ?? '(';
        const close = this.fo.attr(n, 'close') ?? ')';
        const sep = this.fo.attr(n, 'separators') ?? ',';
        // 括弧は中身の高さまで伸ばす
        const h = els.length ? maxOf(els.map((e) => this.mathExtent(e, fs)), -Infinity) : fs;
        const parts: LInlineLevel[] = [this.stretchedFence(open, h, fs) ?? open];
        els.forEach((e, k) => {
          if (k > 0) parts.push(sep[Math.min(k - 1, sep.length - 1)] ?? '');
          parts.push(this.mathml(e, fs));
        });
        parts.push(this.stretchedFence(close, h, fs) ?? close);
        return inl(parts);
      }
      case 'mtable': {
        // 表: 列の幅を中身に合わせた表にする (frame・rowlines・columnlines は罫線)。mlabeledtr の式番号は行の末尾の列に置く
        const line = (v: string | undefined, k: number) => {
          const l = (v ?? 'none').trim().split(/\s+/);
          const t = l[Math.min(k, l.length - 1)];
          return t === 'solid' || t === 'dashed' ? { width: 0.5, color: '#000000', ...(t === 'dashed' ? { style: 'dashed' as const } : {}) } : undefined;
        };
        const rowsEl = els.filter((r) => this.fo.name(r) === 'mtr' || this.fo.name(r) === 'mlabeledtr');
        const cellsOf = (r: XEl) => {
          const cs = this.fo.els(r);
          if (this.fo.name(r) !== 'mlabeledtr') return cs;
          // 式番号は side="left" なら先頭の列、既定 (right) は末尾の列
          return /left/.test(this.fo.attr(n, 'side') ?? '') ? cs : [...cs.slice(1), ...cs.slice(0, 1)];
        };
        const nCols = maxOf(rowsEl.map((r) => cellsOf(r).length), 1);
        // 行の間・列の間 (rowspacing 既定 1ex・columnspacing 既定 0.8em)。単位の無い数は em とみなす。セルの上下・左右の余白に半分ずつ配る
        const spacing = (name: string, def: number) => {
          const t = (this.fo.attr(n, name) ?? '').trim().split(/\s+/)[0];
          if (!t) return def;
          const v = /^-?[\d.]+$/.test(t) ? parseFloat(t) * fs : this.fo.len(t, fs, fs);
          return v === undefined || !Number.isFinite(v) ? def : Math.max(v, 0);
        };
        const pad = spacing('columnspacing', fs * 0.8) / 2;
        const vpad = spacing('rowspacing', fs * 0.43) / 2;
        // 負の rowspacing (行を重ねて詰める) は、セルの行の高さを詰めて表す
        const rs = (this.fo.attr(n, 'rowspacing') ?? '').trim().split(/\s+/)[0];
        const neg = /^-[\d.]+$/.test(rs) ? parseFloat(rs) : /^-/.test(rs) ? (this.fo.len(rs, fs, fs) ?? 0) / fs : 0;
        const cellLh = neg < 0 ? Math.max(0.5, 1 + neg) : 1;
        // 列の揃え (columnalign: 列ごとの left / center / right の並び。最後の値を残りの列に使う)。行 (mtr)・セル (mtd) の指定が優先
        const alignOf = (v: string | undefined, k: number): TextAlign | undefined => {
          const l = (v ?? '').trim().split(/\s+/).filter(Boolean);
          const t = l[Math.min(k, l.length - 1)];
          return t === 'left' ? 'start' : t === 'right' ? 'end' : t === 'center' ? 'center' : undefined;
        };
        const rows = rowsEl.map((r, ri) => ({
          type: 'table-row' as const,
          cells: Array.from({ length: nCols }, (_, ci): LTableCell => {
            const c = cellsOf(r)[ci];
            const align = (c && alignOf(this.fo.attr(c, 'columnalign'), 0)) ?? alignOf(this.fo.attr(r, 'columnalign'), ci) ?? alignOf(this.fo.attr(n, 'columnalign'), ci) ?? 'center';
            const bottom = ri < rowsEl.length - 1 ? line(this.fo.attr(n, 'rowlines'), ri) : undefined;
            const right = ci < nCols - 1 ? line(this.fo.attr(n, 'columnlines'), ci) : undefined;
            return {
              type: 'table-cell',
              padding: { left: pad, right: pad, top: vpad, bottom: vpad },
              ...(bottom || right ? { border: { ...(bottom ? { bottom } : {}), ...(right ? { right } : {}) } } : {}),
              blockAlign: 'center',
              children: [{ type: 'block', textAlign: align, fontSize: fs, lineHeight: cellLh, ...(cellLh < 1 ? { lineStackingStrategy: 'line-height' as const } : {}), children: c ? [this.mathml(c, fs)] : [] }],
            };
          }),
        }));
        const frame = line(this.fo.attr(n, 'frame'), 0);
        const table: LTable = {
          type: 'table',
          fitContent: true,
          borderCollapse: 'collapse',
          columns: [],
          ...(frame ? { border: { top: frame, bottom: frame, left: frame, right: frame } } : {}),
          body: { type: 'table-body', rows },
        };
        return { type: 'inline-container', alignmentBaseline: n === this.mathRootTable ? 'after-edge' : 'central', children: [table] };
      }
      // ── Content MathML (意味の記法): 見た目の記法に置き換えて組む ──
      case 'ci':
      case 'csymbol': {
        const t = text(n);
        return inl([t], [...t].length === 1 ? { fontStyle: 'italic' } : {});
      }
      case 'cn':
        return inl([text(n)]);
      case 'fn':
        return els[0] ? this.mathml(els[0], fs) : '';
      case 'lambda': {
        // λ 式: 束縛変数 ↦ 本体
        const bvars = els.filter((e) => this.fo.name(e) === 'bvar').map((b) => inl(kids(b, fs)));
        const body = els.filter((e) => this.fo.name(e) !== 'bvar').map((e) => this.mathml(e, fs));
        const vs: LInlineLevel[] = [];
        bvars.forEach((v, k) => vs.push(...(k ? [', ', v] : [v])));
        return inl([...(bvars.length > 1 ? ['(', ...vs, ')'] : vs), ' ↦ ', ...body]);
      }
      case 'apply':
        return this.contentApply(n, fs, inl, stack, small);
      default:
        // 未対応の要素: 中の字だけを並べる
        this.fo.miss(`MathML:${name}`);
        return els.length ? inl(kids(n, fs)) : inl([text(n)]);
    }
  }
  /** Content MathML の apply (演算子・関数の適用) を、見た目の記法の行内の要素にする */
  private contentApply(
    n: XEl,
    fs: number,
    inl: (c: LInlineLevel[], extra?: Partial<LInline>) => LInline,
    stack: (rows: Array<{ v: LInlineLevel; size: number; rule?: boolean }>) => LInlineContainer,
    small: number,
  ): LInlineLevel {
    const els = this.fo.els(n);
    const op = els[0];
    if (!op) return '';
    const QUAL = ['bvar', 'lowlimit', 'uplimit', 'degree', 'condition', 'domainofapplication', 'interval'];
    const qual = (q: string) => els.find((e) => this.fo.name(e) === q);
    const args = els.slice(1).filter((e) => !QUAL.includes(this.fo.name(e)));
    const m = (e: XEl, size = fs) => this.mathml(e, size);
    const qv = (q: XEl | undefined, size: number) => (q ? inl(this.fo.els(q).map((c) => this.mathml(c, size)), { fontSize: size }) : undefined);
    const join = (sep: string) => {
      const out: LInlineLevel[] = [];
      args.forEach((a, k) => out.push(...(k ? [sep, m(a)] : [m(a)])));
      return inl(out);
    };
    const on = this.fo.name(op);
    const INFIX: Record<string, string> = {
      plus: ' + ', times: ' ', eq: ' = ', neq: ' ≠ ', lt: ' < ', gt: ' > ', leq: ' ≤ ', geq: ' ≥ ', and: ' ∧ ', or: ' ∨ ',
      union: ' ∪ ', intersect: ' ∩ ', in: ' ∈ ', notin: ' ∉ ', subset: ' ⊆ ', prsubset: ' ⊂ ', implies: ' ⇒ ', equivalent: ' ≡ ', approx: ' ≈ ', compose: ' ∘ ',
    };
    if (INFIX[on]) return join(INFIX[on]);
    switch (on) {
      case 'minus':
        return args.length === 1 ? inl(['−', m(args[0])]) : join(' − ');
      case 'divide':
        return stack([
          { v: args[0] ? m(args[0], small) : '', size: small, rule: true },
          { v: args[1] ? m(args[1], small) : '', size: small },
        ]);
      case 'power':
        return inl([args[0] ? m(args[0]) : '', inl(args[1] ? [m(args[1], small)] : [], { fontSize: small, baselineShift: 'super' })]);
      case 'root':
        return inl(['√', inl(args.map((a) => m(a)), { textDecoration: { overline: true } })]);
      case 'not':
        return inl(['¬', ...args.map((a) => m(a))]);
      case 'abs':
        return inl(['|', ...args.map((a) => m(a)), '|']);
      case 'factorial':
        return inl([...args.map((a) => m(a)), '!']);
      case 'int':
      case 'sum':
      case 'product': {
        // 記号の下付き・上付きに下限・上限、積分は本体の後ろに d + 束縛変数
        const sym = on === 'int' ? '∫' : on === 'sum' ? '∑' : '∏';
        const lo = qv(qual('lowlimit'), small);
        const hi = qv(qual('uplimit'), small);
        const bv = qv(qual('bvar'), fs);
        return inl([
          sym,
          ...(lo ? [inl([lo], { fontSize: small, baselineShift: 'sub' })] : []),
          ...(hi ? [inl([hi], { fontSize: small, baselineShift: 'super' })] : []),
          ' ',
          ...args.map((a) => m(a)),
          ...(on === 'int' && bv ? [' d', bv] : []),
        ]);
      }
      default: {
        // 関数の適用: f(x, y)。sin などの初等関数は立体
        const fnName = on === 'fn' || on === 'ci' || on === 'csymbol' ? m(op) : inl([on]);
        const parts: LInlineLevel[] = [];
        args.forEach((a, k) => parts.push(...(k ? [', ', m(a)] : [m(a)])));
        return inl([fnName, '(', ...parts, ')']);
      }
    }
  }
}
