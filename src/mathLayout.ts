/**
 * MathML (Presentation) の組版。数式用の書体 (OpenType の MATH 表) の値で、字・分数・根号・添え字・上下の添え字・表を組み、
 * 字の輪郭の図形 (SVG) にする。
 *
 * 組み方は MathML Core (https://www.w3.org/TR/mathml-core/、2026-11-01 に取得) の算法に従う:
 * 3.2.4 mo (伸ばす字・大きな演算子)、3.3.1 mrow (伸ばす字の高さ・字の間のアキ)、3.3.2 mfrac、3.3.3 msqrt・mroot、
 * 3.4.1 msub・msup・msubsup、3.4.2 munder・mover・munderover、3.4.3 mmultiscripts、4.5 math-depth (添え字の大きさ)、
 * 5.3 字の伸ばし方 (大きさの違う字・部品の組み立て)、付録 A の既定の値 (mtd の内側のアキ 0.5ex 0.4em など)。
 * MathML Core に無い要素・属性 (mtable の属性・mfenced・menclose・maligngroup・mstack など) は、MathML 3 の要素として、
 * 形の決まりの無いところは Kumiori の決めた値で組む。
 */
import type { FkFont, FkGlyph, MathConstantName, MathFont } from './mathFont';
import { isFenceOperator, isSeparatorOperator, operatorProps, stretchesInline, type OpForm } from './mathOperators';
import { mathVariantChar } from './mathVariants';
import { contentToPresentation } from './mathContent';

/** 伸ばす字の、繰り返す部品の数の上限 */
const MAX_EXTENDER_REPEATS = 1000;

/** DOM の節 (xmldom・linkedom・ブラウザの DOM に共通の部分) */
export interface MNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  childNodes: ArrayLike<MNode>;
  textContent: string | null;
  parentNode?: MNode | null;
  getAttribute?(name: string): string | null;
}

export interface MathLayoutOptions {
  font: MathFont;
  /** 数式の書体に無い字 (和字など) を描く書体 */
  fallback?: (ch: string) => FkFont | undefined;
  /** 字の大きさ (pt) */
  size: number;
  /** 字の色 (CSS の色) */
  color: string;
  /** 色の属性の値を CSS の色にする (読めなければ undefined) */
  parseColor?: (v: string) => string | undefined;
  /**
   * antenna: 互換モード (--compat antenna)。次のところを MathML Core の算法から変える
   * (1 字の基では添え字を基の字の高さで上げ下げしない・囲みの記号を伸ばす高さに上のアクセントを含めず、元の字で足りるときは伸ばさない)。
   * spec (既定): MathML Core の算法のまま
   */
  compat?: 'antenna' | 'spec';
  /**
   * 数式を置く行の幅 (pt)。math の display="block" で、式番号付きの表 (mlabeledtr) が数式の全体のとき、
   * 表をこの幅の中央に、式番号を端に置く
   */
  lineWidth?: number;
}

export interface MathResult {
  svg: string;
  width: number;
  /** 基線から上の高さ (pt) */
  ascent: number;
  /** 基線から下の深さ (pt) */
  descent: number;
}

type Item =
  | { t: 'g'; fk: FkFont; gid: number; x: number; y: number; s: number; c: string }
  | { t: 'r'; x: number; y: number; w: number; h: number; c: string }
  | { t: 'k'; pts: number[][]; sw: number; c: string; close?: boolean; ellipse?: boolean };

/** 組んだ箱。座標は数学の向き (y は上が正、基線が 0)。w は斜体の補正を含まない */
interface Box {
  w: number;
  /** 字の形 (ink) の上下 */
  a: number;
  d: number;
  /** 行の上下 (line-ascent・line-descent) */
  la: number;
  ld: number;
  /** 斜体の補正 */
  ic: number;
  items: Item[];
  /** 上のアクセントを付ける位置 (左端から) */
  tac?: number;
  /** 埋め込まれた演算子 (embellished operator) の、中心の mo の性質 */
  op?: OpInfo;
  /** 上のアクセントを含めない上の高さ (アクセントのあるときだけ) */
  na?: number;
}

interface OpInfo {
  lspace: number;
  rspace: number;
  stretchy: boolean;
  largeop: boolean;
  movablelimits: boolean;
  inline: boolean;
}

/** 組むときの文脈 (継承する値) */
interface Ctx {
  size: number;
  depth: number;
  /** math-style: normal (displaystyle) / compact */
  display: boolean;
  /** math-shift: compact (cramped) */
  cramped: boolean;
  color: string;
  variant?: string;
  /** variant が古い fontweight="bold" だけから来たもの (1 字の mi は、既定の斜体のまま太くする: bold-italic) */
  weightOnly?: boolean;
}

/** 伸ばす大きさの指定 (stretch size constraint) */
type Constraint = { block: [number, number] } | { inline: number };

const NAMED_SPACE: Record<string, number> = {
  veryverythinmathspace: 1 / 18,
  verythinmathspace: 2 / 18,
  thinmathspace: 3 / 18,
  mediummathspace: 4 / 18,
  thickmathspace: 5 / 18,
  verythickmathspace: 6 / 18,
  veryverythickmathspace: 7 / 18,
};

export function layoutMathML(root: MNode, o: MathLayoutOptions): MathResult {
  const L = new MathLayouter(o);
  const display = attr(root, 'display') === 'block' || attr(root, 'mode') === 'display';
  const box = L.layout(root, { size: o.size, depth: 0, display, cramped: false, color: o.color });
  return L.toSvg(box);
}

export function attr(n: MNode, name: string): string | undefined {
  const v = n.getAttribute?.(name);
  return v === null || v === undefined ? undefined : v.trim();
}

export function nameOf(n: MNode): string {
  const ln = n.localName ?? n.nodeName;
  const k = ln.indexOf(':');
  return k >= 0 ? ln.slice(k + 1) : ln;
}

/** 要素の子 (要素だけ) */
export function elements(n: MNode): MNode[] {
  const out: MNode[] = [];
  for (let k = 0; k < n.childNodes.length; k++) {
    const c = n.childNodes[k];
    if (c.nodeType === 1) out.push(c);
  }
  return out;
}

/** 仮の要素 (mfenced から作る mo・mrow) */
export function virtual(name: string, attrs: Record<string, string>, children: MNode[], text?: string): MNode {
  const el: MNode & { virtual: true } = {
    virtual: true,
    nodeType: 1,
    nodeName: name,
    localName: name,
    childNodes: children,
    textContent: text ?? children.map((c) => c.textContent ?? '').join(''),
    getAttribute: (k) => attrs[k] ?? null,
  };
  if (text !== undefined) el.childNodes = [{ nodeType: 3, nodeName: '#text', childNodes: [], textContent: text }];
  // 仮の子だけに親を付ける (元の DOM の節の親は書き換えない)
  for (const c of children) if ((c as { virtual?: boolean }).virtual) c.parentNode = el;
  return el;
}

/**
 * 要素の入れ子の深さの上限。JS の呼び出しの深さを使い切らないよう、これより深い要素は空にする (layout・Content MathML の置き換え・
 * mstack の行の読み取りに共通)。実在の数式の入れ子は数十段まで
 */
export const MAX_MATH_NEST = 300;
/**
 * math-depth (scriptlevel) の絶対値の上限。MathML Core 4.5 (The math-depth property) は、深さの差 1 つごとに字の大きさを
 * 0.71 倍 (書体の scriptPercentScaleDown など) にするので、深さが数千になると、大きさが 0 や Infinity になる。
 * 0.71^100 ≈ 1.3e-15 で、倍率は数として扱える範囲に収まる。実在の数式の深さは、添え字の入れ子の数 (数段) まで
 */
const MAX_MATH_DEPTH = 100;
/** 破線の線 1 本の、線の切れ端の数の上限 (これを超える線は実線にする)。切れ端の周期は線の太さの 8 倍なので、太さ 0.5pt で 40m の線にあたる */
const MAX_DASHES = 10000;

/** 最大値 (Math.max(...list) は、要素の数が引数の数の上限 (十数万) を超えると RangeError になる) */
function maxOf(list: readonly number[], init = -Infinity): number {
  let m = init;
  for (const v of list) if (v > m) m = v;
  return m;
}
/** dst の末尾に src を足す (dst.push(...src) は、要素の数が引数の数の上限を超えると RangeError になる) */
function pushAll<T>(dst: T[], src: readonly T[]): void {
  for (const v of src) dst.push(v);
}

const ROW_LIKE = new Set(['math', 'mrow', 'mstyle', 'merror', 'mphantom', 'mpadded', 'mtd', 'menclose', 'msqrt', 'mlabeledtr']);
const SCRIPTED = new Set(['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts']);

class MathLayouter {
  private readonly f: MathFont;
  private readonly upm: number;
  private fenced = new WeakMap<MNode, MNode>();
  constructor(private o: MathLayoutOptions) {
    this.f = o.font;
    this.upm = o.font.upm;
  }

  /** MATH 表の値 (pt) */
  private k(name: MathConstantName, ctx: Ctx): number {
    return (this.f.constants[name] * ctx.size) / this.upm;
  }

  private em(ctx: Ctx) {
    return ctx.size;
  }

  private ex(ctx: Ctx) {
    const xh = (this.f.fk as unknown as { xHeight?: number }).xHeight;
    return xh ? (xh * ctx.size) / this.upm : ctx.size / 2;
  }

  // ── 長さ ──

  /** 長さの値 (pt)。pct は % と単位の無い数の基準 (無ければ読めない) */
  length(v: string | undefined, ctx: Ctx, pct?: number): number | undefined {
    if (v === undefined || v === '') return undefined;
    const s = v.trim().toLowerCase();
    const neg = s.startsWith('negative');
    const named = NAMED_SPACE[neg ? s.slice(8) : s];
    if (named !== undefined) return (neg ? -named : named) * this.em(ctx);
    if (s === 'infinity') return Infinity;
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/.exec(s);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case 'em':
        return n * this.em(ctx);
      case 'ex':
        return n * this.ex(ctx);
      case 'px':
        return n * 0.75;
      case 'pt':
        return n;
      case 'pc':
        return n * 12;
      case 'in':
        return n * 72;
      case 'cm':
        return (n * 72) / 2.54;
      case 'mm':
        return (n * 72) / 25.4;
      case '%':
        return pct === undefined ? undefined : (n * pct) / 100;
      case '':
        // 単位の無い数: 0 か、基準の倍数 (MathML 3)
        return n === 0 ? 0 : pct === undefined ? undefined : n * pct;
      default:
        return undefined;
    }
  }

  // ── 文脈 ──

  /** 要素の属性で、文脈 (大きさ・displaystyle・色・字体) を変える */
  private enter(n: MNode, ctx: Ctx): Ctx {
    let c = ctx;
    const ds = attr(n, 'displaystyle');
    if (ds === 'true' || ds === 'false') c = { ...c, display: ds === 'true' };
    const sl = attr(n, 'scriptlevel');
    if (sl && /^[+-]?\d+$/.test(sl)) {
      const depth = /^[+-]/.test(sl) ? c.depth + parseInt(sl, 10) : parseInt(sl, 10);
      c = this.depthTo(c, depth);
    }
    const size = attr(n, 'mathsize') ?? attr(n, 'fontsize');
    if (size) {
      const named: Record<string, number> = { small: 0.71, normal: 1, big: 1.41 };
      const v = named[size] !== undefined ? named[size] * c.size : this.length(size, c, c.size);
      if (v && v > 0 && Number.isFinite(v)) c = { ...c, size: v };
    }
    const color = attr(n, 'mathcolor') ?? attr(n, 'color');
    const parsed = color ? (this.o.parseColor?.(color) ?? undefined) : undefined;
    if (parsed) c = { ...c, color: parsed };
    const mv = attr(n, 'mathvariant');
    if (mv) c = { ...c, variant: mv, weightOnly: false };
    else {
      const fw = attr(n, 'fontweight');
      const fst = attr(n, 'fontstyle');
      // MathML 2 §3.2.2: 古い属性 fontweight・fontstyle。fontstyle の既定は normal (1 字の mi だけ italic) なので、
      // fontweight="bold" だけなら、1 字の mi は bold-italic、他は bold
      if (fw === 'bold' || fst) c = { ...c, variant: fw === 'bold' ? (fst === 'italic' ? 'bold-italic' : 'bold') : fst === 'italic' ? 'italic' : 'normal', weightOnly: fw === 'bold' && !fst };
      else if (fw === 'normal' && c.weightOnly) c = { ...c, variant: undefined, weightOnly: false };
    }
    return c;
  }

  /** math-depth を変えたときの字の大きさ (4.5 The math-depth property) */
  private depthTo(ctx: Ctx, depth0: number): Ctx {
    // 深さは上下限の中に収める (MAX_MATH_DEPTH)。数でない深さは変えない
    if (Number.isNaN(depth0)) return ctx;
    const depth = Math.min(Math.max(depth0, -MAX_MATH_DEPTH), MAX_MATH_DEPTH);
    let a = ctx.depth;
    let b = depth;
    if (a === b) return ctx;
    let invert = false;
    if (b < a) {
      [a, b] = [b, a];
      invert = true;
    }
    let e = b - a;
    let s = 1;
    const sp = this.f.constants.scriptPercentScaleDown / 100;
    const ssp = this.f.constants.scriptScriptPercentScaleDown / 100;
    if (sp > 0 && ssp > 0) {
      if (a <= 0 && b >= 2) {
        s *= ssp;
        e -= 2;
      } else if (a === 1) {
        s *= ssp / sp;
        e -= 1;
      } else if (b === 1) {
        s *= sp;
        e -= 1;
      }
    }
    s *= Math.pow(0.71, e);
    const size = ctx.size * (invert ? 1 / s : s);
    // 大きさが正の有限の数にならなければ (もとの大きさが極端なとき)、大きさは変えない
    return { ...ctx, depth, size: size > 0 && Number.isFinite(size) ? size : ctx.size };
  }

  /** 添え字の文脈 (math-depth: add(1)・math-style: compact) */
  private script(ctx: Ctx, cramped = ctx.cramped): Ctx {
    return { ...this.depthTo(ctx, ctx.depth + 1), display: false, cramped };
  }

  // ── 埋め込まれた演算子 ──

  /** 子 (in-flow) のうち、空白のようなもの (space-like) か */
  private spaceLike(n: MNode, depth = 0): boolean {
    const nm = nameOf(n);
    if (nm === 'mtext' || nm === 'mspace') return true;
    // 深すぎる入れ子は空白のようなものとみなさない (layout の深さの上限と同じ。JS の呼び出しの深さを使い切らない)
    if (depth > MAX_MATH_NEST) return false;
    if (nm === 'mrow' || nm === 'mstyle' || nm === 'mphantom' || nm === 'mpadded') return elements(n).every((c) => this.spaceLike(c, depth + 1));
    return false;
  }

  /** 埋め込まれた演算子 (embellished operator) なら、中心の mo を返す */
  coreOp(n: MNode, depth = 0): MNode | undefined {
    const nm = nameOf(n);
    if (nm === 'mo') return n;
    if (depth > MAX_MATH_NEST) return undefined; // 深すぎる入れ子は追わない (JS の呼び出しの深さを使い切らない)
    const els = this.flow(n);
    if (SCRIPTED.has(nm) || nm === 'mfrac') return els[0] ? this.coreOp(els[0], depth + 1) : undefined;
    if (nm === 'mrow' || nm === 'mstyle' || nm === 'mphantom' || nm === 'mpadded') {
      const non = els.filter((c) => !this.spaceLike(c));
      return non.length === 1 ? this.coreOp(non[0], depth + 1) : undefined;
    }
    return undefined;
  }

  /** 子の要素 (mfenced は mrow に置き換え、semantics・maction は表示する子だけ) */
  private flow(n: MNode): MNode[] {
    return elements(n).map((c) => (nameOf(c) === 'mfenced' ? this.fencedRow(c) : c));
  }

  /** mfenced を、開きと閉じの括弧・区切りの mo を持つ mrow にする (MathML 3 の mfenced の定義) */
  private fencedRow(n: MNode): MNode {
    const hit = this.fenced.get(n);
    if (hit) return hit;
    const open = n.getAttribute?.('open') ?? '(';
    const close = n.getAttribute?.('close') ?? ')';
    const sepAttr = n.getAttribute?.('separators') ?? ',';
    const seps = [...sepAttr.replace(/\s+/g, '')];
    const kids = elements(n);
    const inner: MNode[] = [];
    kids.forEach((c, k) => {
      inner.push(c);
      if (k < kids.length - 1 && seps.length) inner.push(virtual('mo', { separator: 'true' }, [], seps[Math.min(k, seps.length - 1)]));
    });
    const parts: MNode[] = [];
    if (open) parts.push(virtual('mo', { fence: 'true', form: 'prefix' }, [], open));
    parts.push(inner.length === 1 ? inner[0] : virtual('mrow', {}, inner));
    if (close) parts.push(virtual('mo', { fence: 'true', form: 'postfix' }, [], close));
    const row = virtual('mrow', {}, parts);
    row.parentNode = n.parentNode;
    // mfenced の属性 (色など) は、置き換えた mrow でも使う
    const ga = n.getAttribute?.bind(n);
    row.getAttribute = (k) => (k === 'open' || k === 'close' || k === 'separators' ? null : (ga?.(k) ?? null));
    this.fenced.set(n, row);
    return row;
  }

  /** 埋め込まれた演算子の form (3.2.4.2) */
  private formOf(mo: MNode): { form: OpForm; explicit: boolean } {
    const f = attr(mo, 'form');
    if (f === 'prefix' || f === 'infix' || f === 'postfix') return { form: f, explicit: true };
    // 埋め込まれた演算子の、いちばん外側の要素
    let e = mo;
    for (;;) {
      const p = e.parentNode;
      if (!p || p.nodeType !== 1 || this.coreOp(p) !== mo) break;
      e = p;
    }
    const p = e.parentNode;
    if (p && p.nodeType === 1) {
      const pn = nameOf(p);
      // mfenced の子の演算子: 兄弟は、括弧の内側の並び (区切りの mo を含む。括弧の mo は含まない)
      const fencedInner = () => {
        const mid = this.flow(this.fencedRow(p))[1];
        return mid && mid !== e && nameOf(mid) === 'mrow' && mid.parentNode !== p ? this.flow(mid) : [e];
      };
      const sibs = (pn === 'mfenced' ? fencedInner() : this.flow(p)).filter((c) => !this.spaceLike(c) || c === e);
      if ((ROW_LIKE.has(pn) || pn === 'mfenced') && pn !== 'mtd' && sibs.length > 1) {
        if (sibs[0] === e) return { form: 'prefix', explicit: false };
        if (sibs[sibs.length - 1] === e) return { form: 'postfix', explicit: false };
      }
      if (pn === 'mtd' && sibs.length > 1) {
        if (sibs[0] === e) return { form: 'prefix', explicit: false };
        if (sibs[sibs.length - 1] === e) return { form: 'postfix', explicit: false };
      }
      if (SCRIPTED.has(pn) && this.flow(p)[0] !== e) return { form: 'postfix', explicit: false };
    }
    return { form: 'infix', explicit: false };
  }

  private bool(n: MNode, name: string, dflt: boolean): boolean {
    const v = attr(n, name);
    return v === 'true' ? true : v === 'false' ? false : dflt;
  }

  /** mo の性質 (属性と演算子辞書) */
  /** mo の字。ハイフンマイナス (-) はマイナス記号 (−) で組む */
  private opText(mo: MNode): string {
    const t = (mo.textContent ?? '').trim();
    return t === '-' ? '\u2212' : t;
  }

  private opProps(mo: MNode, ctx: Ctx) {
    const text = this.opText(mo);
    const { form, explicit } = this.formOf(mo);
    const d = operatorProps(text, form, explicit);
    const fence = this.bool(mo, 'fence', isFenceOperator(text));
    const sep = this.bool(mo, 'separator', isSeparatorOperator(text));
    const ls = this.length(attr(mo, 'lspace'), ctx, ctx.size);
    const rs = this.length(attr(mo, 'rspace'), ctx, ctx.size);
    return {
      text,
      form,
      fence,
      separator: sep,
      lspace: ls ?? d.lspace * ctx.size,
      rspace: rs ?? d.rspace * ctx.size,
      stretchy: this.bool(mo, 'stretchy', d.stretchy),
      symmetric: this.bool(mo, 'symmetric', d.symmetric),
      largeop: this.bool(mo, 'largeop', d.largeop),
      movablelimits: this.bool(mo, 'movablelimits', d.movablelimits),
    };
  }

  /** 埋め込まれた演算子で、伸ばせて、伸びる向きが縦 (block) か */
  private blockStretchy(n: MNode, ctx: Ctx): boolean {
    const mo = this.coreOp(n);
    if (!mo) return false;
    const p = this.opProps(mo, ctx);
    const cps = [...p.text];
    return p.stretchy && cps.length === 1 && !stretchesInline(cps[0].codePointAt(0)!);
  }

  private inlineStretchy(n: MNode, ctx: Ctx): boolean {
    const mo = this.coreOp(n);
    if (!mo) return false;
    const p = this.opProps(mo, ctx);
    const cps = [...p.text];
    return p.stretchy && cps.length === 1 && stretchesInline(cps[0].codePointAt(0)!);
  }

  // ── 箱 ──

  private empty(): Box {
    return { w: 0, a: 0, d: 0, la: 0, ld: 0, ic: 0, items: [] };
  }

  /** 箱を (dx, dy) ずらした中身 */
  private moved(b: Box, dx: number, dy: number): Item[] {
    if (!dx && !dy) return b.items;
    return b.items.map((it): Item => {
      if (it.t === 'k') return { ...it, pts: it.pts.map((p) => p.map((v, k) => (k % 2 === 0 ? v + dx : v + dy))) };
      return { ...it, x: it.x + dx, y: it.y + dy };
    });
  }

  /** いくつかの箱を並べて 1 つの箱にする */
  private combine(w: number, parts: Array<{ b: Box; x: number; y: number }>, extra: Partial<Box> = {}): Box {
    const out: Box = { w, a: -Infinity, d: -Infinity, la: -Infinity, ld: -Infinity, ic: 0, items: [] };
    for (const { b, x, y } of parts) {
      out.a = Math.max(out.a, b.a + y);
      if (b.na !== undefined) out.na = Math.max(out.na ?? -Infinity, b.na + y);
      out.d = Math.max(out.d, b.d - y);
      out.la = Math.max(out.la, b.la + y);
      out.ld = Math.max(out.ld, b.ld - y);
      pushAll(out.items, this.moved(b, x, y));
    }
    for (const key of ['a', 'd', 'la', 'ld'] as const) if (!Number.isFinite(out[key])) out[key] = 0;
    return { ...out, ...extra };
  }

  /** 線 (罫) の箱。y は下端 */
  private rule(x: number, y: number, w: number, h: number, c: string): Item {
    return { t: 'r', x, y, w, h, c };
  }

  // ── 字 ──

  /** 字の箱 (1 つの字形) */
  private glyphBox(fk: FkFont, g: FkGlyph, size: number, color: string): Box {
    const s = size / fk.unitsPerEm;
    const bb = g.bbox;
    const has = Number.isFinite(bb.minX) && bb.maxX > bb.minX;
    const isMath = fk === this.f.fk;
    const a = has ? bb.maxY * s : 0;
    const d = has ? -bb.minY * s : 0;
    const asc = (fk.ascent * size) / fk.unitsPerEm;
    const desc = (-fk.descent * size) / fk.unitsPerEm;
    // antenna: 字の箱の上下は字の形 (ink) の上下にする (書体の行の上下 ascent・descent を使わない)。
    // MathML Core は line-ascent・line-descent (書体の行の上下) を使うが、数式の上下に余白が付き、根号の横線も持ち上がる
    const box: Box = { w: g.advanceWidth * s, a, d, la: this.antenna ? a : Math.max(a, asc), ld: this.antenna ? d : Math.max(d, desc), ic: isMath ? this.f.italic(g.id) * s : 0, items: [{ t: 'g', fk, gid: g.id, x: 0, y: 0, s, c: color }] };
    const ta = isMath ? this.f.topAccent(g.id) : undefined;
    if (ta !== undefined) box.tac = ta * s;
    return box;
  }

  /** 字の並び (mtext・mi・mn・ms の中身) の箱 */
  private textBox(text: string, ctx: Ctx, variant?: string): Box {
    const cps = [...text].map((c) => c.codePointAt(0)!);
    const mapped = variant && variant !== 'normal' ? cps.map((cp) => mathVariantChar(cp, variant)) : cps;
    const str = mapped.map((cp) => String.fromCodePoint(cp)).join(''); // spread は字の数 (数万) で引数の上限を超える
    if (!str) return this.empty();
    // 数式の書体にある字の並びと、無い字 (別の書体) の並びに分ける
    const runs: Array<{ fk: FkFont; text: string }> = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0)!;
      let fk: FkFont = this.f.fk;
      if (!this.f.fk.hasGlyphForCodePoint(cp) && cp > 0x20) fk = this.o.fallback?.(ch) ?? this.f.fk;
      const last = runs[runs.length - 1];
      if (last && last.fk === fk) last.text += ch;
      else runs.push({ fk, text: ch });
    }
    const parts: Array<{ b: Box; x: number; y: number }> = [];
    let x = 0;
    let lastIc = 0;
    let single: Box | undefined;
    let count = 0;
    for (const r of runs) {
      const s = ctx.size / r.fk.unitsPerEm;
      const run = r.fk.layout(r.text);
      run.glyphs.forEach((g, k) => {
        const p = run.positions[k];
        const b = this.glyphBox(r.fk, g, ctx.size, ctx.color);
        parts.push({ b, x: x + p.xOffset * s, y: p.yOffset * s });
        x += p.xAdvance * s;
        lastIc = b.ic;
        single = b;
        count++;
      });
    }
    const box = this.combine(x, parts);
    box.ic = lastIc;
    if (count === 1 && single?.tac !== undefined) box.tac = single.tac;
    return box;
  }

  // ── 伸ばす字 (5.3) ──

  /** 字形を、縦 (vertical) か横に、大きさ t まで伸ばす。伸ばせなければ undefined */
  private stretchGlyph(g: FkGlyph, t: number, vertical: boolean, ctx: Ctx): Box | undefined {
    const con = this.f.construction(g.id, vertical);
    if (!con) return undefined;
    const fk = this.f.fk;
    const s = ctx.size / this.upm;
    const T = t / s;
    const sizeOf = (gl: FkGlyph) => (vertical ? gl.bbox.maxY - gl.bbox.minY : gl.advanceWidth);
    if (sizeOf(g) >= T) return this.glyphBox(fk, g, ctx.size, ctx.color);
    let last: FkGlyph = g;
    for (const v of con.variants) {
      const vg = fk.getGlyph(v.glyph);
      last = vg;
      if (v.advance >= T) return this.glyphBox(fk, vg, ctx.size, ctx.color);
    }
    const asm = con.assembly;
    if (asm && this.validAssembly(asm.parts)) return this.assemble(asm.parts, asm.italic, T, vertical, ctx);
    return this.glyphBox(fk, last, ctx.size, ctx.color);
  }

  private validAssembly(parts: Array<{ start: number; end: number; full: number; extender: boolean }>): boolean {
    const omin = this.f.minConnectorOverlap;
    const ext = parts.filter((p) => p.extender);
    if (!ext.length) return false;
    if (ext.reduce((a, p) => a + p.full, 0) - omin * ext.length <= 0) return false;
    return parts.every((p) => p.start >= omin && p.end >= omin) || true;
  }

  /** 部品を組み立てる (5.3.1 The GlyphAssembly table) */
  private assemble(parts: Array<{ glyph: number; start: number; end: number; full: number; extender: boolean }>, italic: number, T: number, vertical: boolean, ctx: Ctx): Box {
    const fk = this.f.fk;
    const s = ctx.size / this.upm;
    const omin = this.f.minConnectorOverlap;
    const ext = parts.filter((p) => p.extender);
    const non = parts.filter((p) => !p.extender);
    const sExt = ext.reduce((a, p) => a + p.full, 0);
    const sNon = non.reduce((a, p) => a + p.full, 0);
    const sExtNo = sExt - omin * ext.length;
    // 繰り返す部品の数の上限 (minsize="100000em" などの大きな目標で、字を何万個も並べない)
    const rmin = Math.min(MAX_EXTENDER_REPEATS, Math.max(0, Math.ceil((T - sNon + omin * (non.length - 1)) / sExtNo)));
    const count = non.length + rmin * ext.length;
    const size = (o: number, r: number) => sNon + r * sExt - o * (non.length + r * ext.length - 1);
    let omax = count > 1 ? (size(0, rmin) - T) / (count - 1) : 0;
    if (count > 1) {
      // 重なりの上限は、つなぐ側の端のコネクタの長さ。OpenType の MATH 表 (GlyphPartRecord) は、
      // startConnectorLength を「伸ばす向きの始まりの端 (横は左、縦は下)」、endConnectorLength を「終わりの端 (右・上)」の
      // まっすぐな部分の長さとし、重なりは「その端のコネクタの長さを超えない」とする。部品は始まりから終わりへ並ぶので、
      // 隣とつながるのは、最初の部品を除く部品の start と、最後の部品を除く部品の end (繰り返す部品は自分自身ともつながる
      // ので、端にあっても両方を見る)。Chromium (blink の stretchy_operator_shaper.cc の GetAssemblyParameters) と
      // XeTeX (xetex.web の build_opentype_assembly: 前の部品の end と次の部品の start の小さいほう) も、この向きで見る。
      // MathML Core 5.3.1 の o_max の文面は「start は最後の非 extender を除く・end は最初の非 extender を除く」で、
      // 向きが逆になっている (その文面のとおりだと、STIX Two Math の括弧のように、下の端の部品の start が 0・上の端の部品の
      // end が 0 の書体で、上限が必ず 0 になり、同じ節の「どの部品の start・end も o_min 以上」の条件も満たせない)。
      let lim = Infinity;
      parts.forEach((p, k) => {
        if (p.extender || k !== 0) lim = Math.min(lim, p.start);
        if (p.extender || k !== parts.length - 1) lim = Math.min(lim, p.end);
      });
      if (lim < omin) {
        // つなぐ端のコネクタが o_min に足りない書体 (5.3.1 の条件では組み立てが無効。たとえば STIX Two Math の矢印は、
        // 矢じりの start が 0)。ここでは無効とせずに組み立てているので、これまでどおりの部品の選び方で上限を求める
        lim = Infinity;
        parts.forEach((p, k) => {
          if (!(k === parts.length - 1 && !p.extender)) lim = Math.min(lim, p.start);
          if (!(k === 0 && !p.extender)) lim = Math.min(lim, p.end);
        });
      }
      omax = Math.max(Math.min(omax, lim), 0);
    }
    const items: Item[] = [];
    let pos = 0;
    let maxA = -Infinity;
    let maxD = -Infinity;
    let maxW = 0;
    for (const p of parts) {
      const reps = p.extender ? rmin : 1;
      const gl = fk.getGlyph(p.glyph);
      for (let r = 0; r < reps; r++) {
        if (vertical) {
          // 下から積む (字形の下端を pos に)
          items.push({ t: 'g', fk, gid: p.glyph, x: 0, y: (pos - gl.bbox.minY) * s, s, c: ctx.color });
          maxW = Math.max(maxW, gl.advanceWidth);
        } else {
          items.push({ t: 'g', fk, gid: p.glyph, x: pos * s, y: 0, s, c: ctx.color });
          maxA = Math.max(maxA, gl.bbox.maxY);
          maxD = Math.max(maxD, -gl.bbox.minY);
        }
        pos += p.full - omax;
      }
    }
    const total = size(omax, rmin);
    if (vertical) return { w: maxW * s, a: total * s, d: 0, la: total * s, ld: 0, ic: italic * s, items };
    return { w: total * s, a: maxA * s, d: maxD * s, la: maxA * s, ld: maxD * s, ic: italic * s, items };
  }

  // ── 要素 ──

  /** 要素の入れ子の深さ (JS の呼び出しの深さを使い切らないよう、深すぎる要素は空にする) */
  private nest = 0;
  layout(n: MNode, ctx0: Ctx, c?: Constraint): Box {
    if (this.nest >= MAX_MATH_NEST) return this.empty();
    this.nest++;
    try {
      const ctx = this.enter(n, ctx0);
      const nm = nameOf(n);
      let box = this.element(nm, n, ctx, c);
      const bg = attr(n, 'mathbackground') ?? attr(n, 'background');
      const bgc = bg ? this.o.parseColor?.(bg) : undefined;
      if (bgc) box = { ...box, items: [this.rule(0, -box.ld, box.w, box.la + box.ld, bgc), ...box.items] };
      return box;
    } finally {
      this.nest--;
    }
  }

  private element(nm: string, n: MNode, ctx: Ctx, c?: Constraint): Box {
    switch (nm) {
      case 'math':
        return this.row(this.flow(n), ctx, c, true);
      case 'mrow':
      case 'mstyle':
      case 'mtd':
        return this.row(this.flow(n), ctx, c, false, n);
      case 'merror': {
        const b = this.row(this.flow(n), ctx, c, false, n);
        const pad = ctx.size * 0.1;
        return this.framed(b, ['box'], pad, '#ff0000', ctx, '#ffffe0');
      }
      case 'mphantom': {
        const b = this.row(this.flow(n), ctx, c, false, n);
        return { ...b, items: [] };
      }
      case 'semantics': {
        const first = this.flow(n)[0];
        return first && !/^annotation/.test(nameOf(first)) ? this.layout(first, ctx, c) : this.empty();
      }
      case 'maction': {
        const kids = this.flow(n);
        const sel = parseInt(attr(n, 'selection') ?? '1', 10);
        const k = kids[Math.max(0, (Number.isFinite(sel) ? sel : 1) - 1)] ?? kids[0];
        return k ? this.layout(k, ctx, c) : this.empty();
      }
      case 'mfenced':
        return this.layout(this.fencedRow(n), ctx, c);
      case 'apply':
      case 'ci':
      case 'cn':
      case 'csymbol':
      case 'fn':
      case 'lambda':
        // Content MathML (意味の記法): 見た目の記法 (Presentation MathML) に置き換えて組む
        return this.layout(contentToPresentation(n), ctx, c);
      case 'mi': {
        const t = (n.textContent ?? '').trim();
        // 1 字の mi は斜体 (text-transform: math-auto)
        const one = [...t].length === 1;
        const variant = ctx.weightOnly && ctx.variant === 'bold' && one ? 'bold-italic' : (ctx.variant ?? (one ? 'italic' : undefined));
        return this.textBox(t, ctx, variant);
      }
      case 'mn':
      case 'mtext':
        return this.textBox(nm === 'mtext' ? (n.textContent ?? '').replace(/\s+/g, ' ').trim() : (n.textContent ?? '').trim(), ctx, ctx.variant);
      case 'ms': {
        const lq = attr(n, 'lquote') ?? '"';
        const rq = attr(n, 'rquote') ?? '"';
        return this.textBox(lq + (n.textContent ?? '').replace(/\s+/g, ' ').trim() + rq, ctx, ctx.variant);
      }
      case 'mspace': {
        // 大きさは有限の値だけ (infinity は空白の大きさにならない)
        const fin = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : 0);
        const w = fin(this.length(attr(n, 'width'), ctx));
        const h = fin(this.length(attr(n, 'height'), ctx));
        const d = fin(this.length(attr(n, 'depth'), ctx));
        return { w, a: h, d, la: h, ld: d, ic: 0, items: [] };
      }
      case 'mo':
        return this.mo(n, ctx, c);
      case 'mfrac':
        return this.mfrac(n, ctx, c);
      case 'msqrt':
        return this.radical(this.row(this.flow(n), { ...ctx, cramped: true }, undefined, false, n), undefined, ctx);
      case 'mroot': {
        const [base, index] = this.flow(n);
        const b = base ? this.layout(base, { ...ctx, cramped: true }) : this.empty();
        // 根号の指数は math-depth を 2 上げる (MathML Core 3.3.3)。antenna は 1 だけ上げる
        // (指数の字を小さくしすぎない)
        const i = index ? this.layout(index, { ...this.depthTo(ctx, ctx.depth + (this.antenna ? 1 : 2)), display: false, cramped: true }) : undefined;
        return this.radical(b, i, ctx);
      }
      case 'msub':
      case 'msup':
      case 'msubsup':
        return this.scripts(nm, this.flow(n), ctx, c);
      case 'munder':
      case 'mover':
      case 'munderover':
        return this.underover(nm, n, ctx, c);
      case 'mmultiscripts':
        return this.multiscripts(n, ctx, c);
      case 'mpadded':
        return this.mpadded(n, ctx, c);
      case 'menclose':
        return this.menclose(n, ctx);
      case 'mtable':
        return this.mtable(n, ctx);
      case 'mstack':
      case 'mlongdiv':
        return this.mstack(n, ctx);
      case 'mglyph':
      case 'none':
      case 'mprescripts':
      case 'annotation':
      case 'annotation-xml':
        return this.empty();
      default:
        return this.row(this.flow(n), ctx, c, false, n);
    }
  }

  // ── mo (3.2.4.3) ──

  private mo(n: MNode, ctx: Ctx, c?: Constraint): Box {
    const p = this.opProps(n, ctx);
    const variant = ctx.variant;
    const chars = [...p.text];
    const info: OpInfo = { lspace: p.lspace, rspace: p.rspace, stretchy: p.stretchy, largeop: p.largeop, movablelimits: p.movablelimits, inline: false };
    const plain = () => ({ ...this.textBox(p.text, ctx, variant), op: info });
    if (chars.length !== 1) return plain();
    const cp = chars[0].codePointAt(0)!;
    const fk = this.f.fk;
    if (!fk.hasGlyphForCodePoint(cp)) return plain();
    const g = fk.glyphForCodePoint(cp);
    const s = ctx.size / this.upm;
    if (p.stretchy) {
      const inlineAxis = stretchesInline(cp);
      info.inline = inlineAxis;
      if (inlineAxis) {
        if (!c || !('inline' in c)) return plain();
        const b = this.stretchGlyph(g, c.inline, false, ctx);
        return b ? { ...b, op: info } : plain();
      }
      if (!c || !('block' in c)) return plain();
      const axis = this.k('axisHeight', ctx);
      let [ta, td] = c.block;
      if (p.symmetric) {
        const m = Math.max(ta - axis, td + axis);
        ta = m + axis;
        td = m - axis;
      }
      const gh = (g.bbox.maxY - g.bbox.minY) * s;
      // antenna: 大きさの違う字を持つ囲みの記号 (括弧など) は、元の字の高さが目標の 0.901 倍以上か、目標との差が 0.5em 以下なら伸ばさない
      // (TeX の \delimiterfactor 901・\delimitershortfall 5pt (10pt の字で) と同じ考え方)。部品の組み立てだけで伸ばす字 (| など) は、目標の高さに伸ばす
      const discrete = (this.f.construction(g.id, true)?.variants.length ?? 0) > 1;
      if (this.antenna && p.fence && discrete && !attr(n, 'minsize') && gh >= Math.max((ta + td) * 0.901, ta + td - 0.5 * ctx.size)) return plain();
      // minsize は有限の値だけ (infinity は目標にならないので、元の字の高さ)
      let minsize = this.length(attr(n, 'minsize'), ctx, gh) ?? gh;
      if (!Number.isFinite(minsize)) minsize = gh;
      let maxsize = this.length(attr(n, 'maxsize'), ctx, gh) ?? Infinity;
      if (minsize < 0) minsize = 0;
      if (maxsize < minsize) maxsize = minsize;
      const T = ta + td;
      if (T <= 0) {
        ta = minsize / 2 + axis;
        td = minsize - ta;
      } else if (T < minsize) {
        ta = Math.max(0, ((ta - axis) * minsize) / T + axis);
        td = minsize - ta;
      } else if (maxsize < T) {
        ta = Math.max(0, ((ta - axis) * maxsize) / T + axis);
        td = maxsize - ta;
      }
      const b = this.stretchGlyph(g, ta + td, true, ctx);
      if (!b) return plain();
      // 伸ばした字の中心を、目標の中心に合わせる
      const delta = (b.a - b.d - (ta - td)) / 2;
      return { ...b, a: b.a - delta, d: b.d + delta, la: b.la - delta, ld: b.ld + delta, items: this.moved(b, 0, -delta), op: info };
    }
    if (p.largeop && ctx.display) {
      const con = this.f.construction(g.id, true);
      const min = this.f.constants.displayOperatorMinHeight;
      let pick: number | undefined;
      for (const v of con?.variants ?? []) {
        if (v.glyph === g.id) continue;
        pick = v.glyph;
        if (v.advance >= min) break;
      }
      if (pick !== undefined) return { ...this.glyphBox(fk, fk.getGlyph(pick), ctx.size, ctx.color), op: info };
    }
    if (p.largeop && !ctx.display && this.antenna && isIntegral(cp)) {
      // antenna: 行内 (displaystyle でない) の積分記号も、上下の添え字を挟む高さにする。
      // 書体の大きさの段階 (MathVariants) に合う高さが無いので、displayOperatorMinHeight 以上の段階の字を、その高さまで縮めて使い、中央を数式の軸に合わせる
      const con = this.f.construction(g.id, true);
      const min = this.f.constants.displayOperatorMinHeight;
      const v = con?.variants.find((x) => x.glyph !== g.id && x.advance >= min);
      if (v && min > 0) {
        const b = this.glyphBox(fk, fk.getGlyph(v.glyph), (ctx.size * min) / v.advance, ctx.color);
        const delta = (b.a - b.d) / 2 - this.k('axisHeight', ctx);
        return { ...b, a: b.a - delta, d: b.d + delta, la: b.la - delta, ld: b.ld + delta, items: this.moved(b, 0, -delta), op: info };
      }
    }
    return plain();
  }

  // ── mrow (3.3.1) ──

  private row(kids: MNode[], ctx: Ctx, c: Constraint | undefined, isMath: boolean, self?: MNode): Box {
    const boxes: Box[] = new Array(kids.length);
    const embellished = self ? this.coreOp(self) !== undefined : false;
    if (c && embellished) {
      // この行は埋め込まれた演算子: その演算子だけを同じ指定で伸ばす
      kids.forEach((k, i) => (boxes[i] = this.layout(k, ctx, this.coreOp(k) ? c : undefined)));
    } else {
      const toStretch: number[] = [];
      kids.forEach((k, i) => {
        if (this.blockStretchy(k, ctx)) toStretch.push(i);
        else boxes[i] = this.layout(k, ctx);
      });
      if (toStretch.length) {
        const laid = boxes.filter(Boolean);
        // antenna: 上のアクセントは、伸ばす高さに含めず、書体の行の上下 (ascent・descent) を下限にする
        let ua = laid.length ? maxOf(laid.map((b) => (this.antenna ? Math.max(b.na ?? b.a, 0) : b.a))) : 0;
        let ud = laid.length ? maxOf(laid.map((b) => b.d)) : 0;
        if (this.antenna && laid.length) {
          ua = Math.max(ua, (this.f.fk.ascent * ctx.size) / this.upm);
          ud = Math.max(ud, (-this.f.fk.descent * ctx.size) / this.upm);
        }
        for (const i of toStretch) boxes[i] = this.layout(kids[i], ctx, { block: [ua, ud] });
      }
    }
    // 並べる (字の間のアキと斜体の補正)
    const addSpace = isMath || !embellished;
    const parts: Array<{ b: Box; x: number; y: number }> = [];
    let x = 0;
    let prevIc = 0;
    for (const b of boxes) {
      const slanted = !b.op && b.ic !== 0;
      if (!slanted) x += prevIc;
      if (b.op && addSpace) x += b.op.lspace;
      parts.push({ b, x, y: 0 });
      x += b.w;
      prevIc = slanted ? b.ic : 0;
      if (b.op && addSpace) x += b.op.rspace;
    }
    x += prevIc;
    const out = this.combine(x, parts);
    if (boxes.length === 1) {
      out.ic = boxes[0].ic;
      out.tac = boxes[0].tac;
      // 1 つだけの子の斜体の補正は、外 (添え字など) で使う
      if (!boxes[0].op && boxes[0].ic) out.w = x - prevIc;
    }
    if (embellished) {
      const opBox = boxes.find((b) => b.op);
      if (opBox?.op) out.op = { ...opBox.op };
    }
    return out;
  }

  // ── mfrac (3.3.2) ──

  private mfrac(n: MNode, ctx: Ctx, c?: Constraint): Box {
    const [ne, de] = this.flow(n);
    const child = (cramped: boolean): Ctx => ({ ...(ctx.display ? ctx : this.depthTo(ctx, ctx.depth + 1)), display: false, cramped });
    const num = ne ? this.layout(ne, child(ctx.cramped), c) : this.empty();
    const den = de ? this.layout(de, child(true)) : this.empty();
    const k = (name: MathConstantName) => this.k(name, ctx);
    const disp = ctx.display;
    const lt = attr(n, 'linethickness');
    const def = k('fractionRuleThickness');
    let t = def;
    if (lt) {
      const named: Record<string, number> = { thin: 0.5, medium: 1, thick: 2 };
      t = named[lt] !== undefined ? named[lt] * def : (this.length(lt, ctx, def) ?? def);
    }
    const pad = 0.75; // padding-inline: 1px (付録 A)
    const w = Math.max(num.w, den.w);
    const axis = k('axisHeight');
    if (attr(n, 'bevelled') === 'true') return this.bevelled(num, den, t, ctx, num.op);
    let numShift: number;
    let denShift: number;
    if (t > 0) {
      numShift = Math.max(disp ? k('fractionNumeratorDisplayStyleShiftUp') : k('fractionNumeratorShiftUp'), axis + t / 2 + (disp ? k('fractionNumDisplayStyleGapMin') : k('fractionNumeratorGapMin')) + num.d);
      denShift = Math.max(disp ? k('fractionDenominatorDisplayStyleShiftDown') : k('fractionDenominatorShiftDown'), t / 2 + (disp ? k('fractionDenomDisplayStyleGapMin') : k('fractionDenominatorGapMin')) + den.a - axis);
    } else {
      numShift = disp ? k('stackTopDisplayStyleShiftUp') : k('stackTopShiftUp');
      denShift = disp ? k('stackBottomDisplayStyleShiftDown') : k('stackBottomShiftDown');
      const gap = denShift - den.a + (numShift - num.d);
      const gapMin = disp ? k('stackDisplayStyleGapMin') : k('stackGapMin');
      if (gap < gapMin) {
        numShift += (gapMin - gap) / 2;
        denShift += (gapMin - gap) / 2;
      }
    }
    const align = (v: string | undefined, bw: number) => (v === 'left' ? 0 : v === 'right' ? w - bw : (w - bw) / 2);
    const parts = [
      { b: num, x: pad + align(attr(n, 'numalign'), num.w), y: numShift },
      { b: den, x: pad + align(attr(n, 'denomalign'), den.w), y: -denShift },
    ];
    const out = this.combine(w + pad * 2, parts);
    if (t > 0) {
      out.items.push(this.rule(pad, axis - t / 2, w, t, ctx.color));
      out.a = Math.max(out.a, axis + t / 2);
      out.la = Math.max(out.la, axis + t / 2);
      out.d = Math.max(out.d, -axis + t / 2, 0);
      out.ld = Math.max(out.ld, -axis + t / 2, 0);
    }
    if (num.op) out.op = num.op;
    return out;
  }

  /** 斜めの分数 (bevelled="true")。分子を上げ、分母を下げ、間に斜線を引く */
  private bevelled(num: Box, den: Box, t: number, ctx: Ctx, op?: OpInfo): Box {
    const axis = this.k('axisHeight', ctx);
    const hgap = this.k('skewedFractionHorizontalGap', ctx);
    const vgap = this.k('skewedFractionVerticalGap', ctx);
    const ny = axis + vgap / 2;
    const dy = axis - vgap / 2;
    const numY = ny - num.a / 2 + num.d / 2 + Math.max(0, num.d);
    const denY = dy - den.a - Math.max(0, den.d) + den.d;
    const top = Math.max(numY + num.a, axis + ctx.size * 0.5);
    const bottom = Math.min(denY - den.d, axis - ctx.size * 0.5);
    const sx = num.w + hgap / 2;
    const slant = (top - bottom) * 0.3;
    const out = this.combine(num.w + hgap + den.w, [
      { b: num, x: 0, y: numY },
      { b: den, x: num.w + hgap, y: denY },
    ]);
    out.items.push({ t: 'k', pts: [[sx - slant / 2, bottom, sx + slant / 2, top]], sw: Math.max(t, ctx.size * 0.04), c: ctx.color });
    out.a = Math.max(out.a, top);
    out.d = Math.max(out.d, -bottom);
    out.la = Math.max(out.la, top);
    out.ld = Math.max(out.ld, -bottom);
    if (op) out.op = op;
    return out;
  }

  // ── msqrt・mroot (3.3.3) ──

  private radical(base: Box, index: Box | undefined, ctx: Ctx): Box {
    const k = (name: MathConstantName) => this.k(name, ctx);
    const fk = this.f.fk;
    const gap = ctx.display ? k('radicalDisplayStyleVerticalGap') : k('radicalVerticalGap');
    const rt = k('radicalRuleThickness');
    const extra = k('radicalExtraAscender');
    const target = rt + gap + base.a + base.d;
    const g = fk.glyphForCodePoint(0x221a);
    const surd = this.stretchGlyph(g, target, true, ctx) ?? this.glyphBox(fk, g, ctx.size, ctx.color);
    // antenna: 根号の字が中身より高ければ、余りの半分だけ横線を上げる (中身を根号の中で上下の中央に置く。TeX と同じ考え方)。
    // MathML Core では、余りはすべて根号の字の下にはみ出す
    const excess = surd.a + surd.d - target;
    const gap2 = this.antenna && excess > 0 ? gap + excess / 2 : gap;
    const la = Math.max(base.la, base.a + gap2 + rt + extra);
    const ld = Math.max(base.ld, surd.a + surd.d + extra - la);
    const barTop = la - extra;
    // 根号の字の上端を、横線の上端に合わせる
    const surdY = barTop - surd.a;
    let B = this.combine(surd.w + base.w, [
      { b: surd, x: 0, y: surdY },
      { b: base, x: surd.w, y: 0 },
    ]);
    B.items.push(this.rule(surd.w, barTop - rt, base.w, rt, ctx.color));
    B = { ...B, a: Math.max(B.a, barTop), la: Math.max(B.la, la), ld: Math.max(B.ld, ld), ic: 0 };
    if (!index) return B;
    const kb = Math.max(0, k('radicalKernBeforeDegree'));
    const ka = Math.max(-index.w, k('radicalKernAfterDegree'));
    const raise = this.f.constants.radicalDegreeBottomRaisePercent / 100;
    const h = B.la + B.ld;
    const iy = -B.ld + raise * h;
    return this.combine(kb + index.w + ka + B.w, [
      { b: index, x: kb, y: iy },
      { b: B, x: kb + index.w + ka, y: 0 },
    ]);
  }

  // ── msub・msup・msubsup (3.4.1) ──

  private get antenna() {
    return this.o.compat === 'antenna';
  }

  /**
   * 添え字の基が 1 字か (添え字の付いた 1 字・1 つだけの子の mrow も)。antenna では、1 字の基の字の高さ・深さで添え字を上げ下げしない
   * (TeX も、基が 1 字のときは同じ)
   */
  /**
   * 伸ばした字・大きな演算子の基 (1 字でも字の大きさより高い)。antenna でも、基の高さ・深さで添え字を上げ下げする
   * (伸ばした縦棒の上端・下端に添え字を置く)
   */
  private tallBase(base: Box, ctx: Ctx): boolean {
    return !!(base.op?.stretchy || base.op?.largeop) && base.a + base.d > 1.5 * ctx.size;
  }

  private charBase(e: MNode | undefined): boolean {
    if (!e) return false;
    const nm = nameOf(e);
    const kids = this.flow(e);
    if (nm === 'mrow' || nm === 'mstyle') return kids.length === 1 && this.charBase(kids[0]);
    if (nm === 'msub' || nm === 'msup' || nm === 'msubsup') return this.charBase(kids[0]);
    if (nm === 'mi' || nm === 'mn' || nm === 'mo' || nm === 'mtext') return [...(e.textContent ?? '').trim()].length === 1;
    return false;
  }

  private subShift(base: Box, sub: Box, ctx: Ctx, drop = true) {
    return Math.max(this.k('subscriptShiftDown', ctx), sub.a - this.k('subscriptTopMax', ctx), drop ? this.k('subscriptBaselineDropMin', ctx) + base.d : 0);
  }

  private supShift(base: Box, sup: Box, ctx: Ctx, drop = true) {
    return Math.max(ctx.cramped ? this.k('superscriptShiftUpCramped', ctx) : this.k('superscriptShiftUp', ctx), this.k('superscriptBottomMin', ctx) + sup.d, drop ? base.a - this.k('superscriptBaselineDropMax', ctx) : 0);
  }

  /** 上下の添え字の間を空ける (3.4.1.4) */
  private adjustPair(sub: Box, sup: Box, subShift: number, supShift: number, ctx: Ctx): [number, number] {
    const gapMin = this.k('subSuperscriptGapMin', ctx);
    let gap = subShift - sub.a + (supShift - sup.d);
    if (gap < gapMin) {
      let d = this.k('superscriptBottomMaxWithSubscript', ctx) - (supShift - sup.d);
      if (d > 0) {
        d = Math.min(d, gapMin - gap);
        supShift += d;
        gap += d;
      }
      d = gapMin - gap;
      if (d > 0) subShift += d;
    }
    return [subShift, supShift];
  }

  private scripts(nm: string, els: MNode[], ctx: Ctx, c?: Constraint, base0?: Box): Box {
    const [be, s1, s2] = els;
    const base = base0 ?? (be ? this.layout(be, ctx, c) : this.empty());
    const largeop = !!base.op?.largeop;
    // 大きな演算子の下付きは、イタリック補正の分だけ左へ寄せる (MathML Core)。antenna は寄せない
    // (∫ の下付きは字の右下の外に置く)
    const loIc = largeop && !this.antenna ? base.ic : 0;
    const ic = largeop ? 0 : base.ic;
    const space = this.k('spaceAfterScript', ctx);
    const sub = nm === 'msub' || nm === 'msubsup' ? (s1 ? this.layout(s1, this.script(ctx, true)) : this.empty()) : undefined;
    const supEl = nm === 'msup' ? s1 : nm === 'msubsup' ? s2 : undefined;
    const sup = supEl ? this.layout(supEl, this.script(ctx)) : nm === 'msubsup' ? this.empty() : undefined;
    const drop = !(this.antenna && this.charBase(be) && !this.tallBase(base, ctx));
    let subShift = sub ? this.subShift(base, sub, ctx, drop) : 0;
    let supShift = sup ? this.supShift(base, sup, ctx, drop) : 0;
    if (sub && sup) [subShift, supShift] = this.adjustPair(sub, sup, subShift, supShift, ctx);
    const parts: Array<{ b: Box; x: number; y: number }> = [{ b: base, x: 0, y: 0 }];
    let w = base.w;
    if (sub) {
      parts.push({ b: sub, x: base.w - loIc, y: -subShift });
      w = Math.max(w, base.w - loIc + sub.w + space);
    }
    if (sup) {
      parts.push({ b: sup, x: base.w + ic, y: supShift });
      w = Math.max(w, base.w + ic + sup.w + space);
    }
    const out = this.combine(w, parts);
    if (base.op) out.op = base.op;
    return out;
  }

  // ── mmultiscripts (3.4.3) ──

  private multiscripts(n: MNode, ctx: Ctx, c?: Constraint): Box {
    const els = this.flow(n);
    const be = els[0];
    const base = be ? this.layout(be, ctx, c) : this.empty();
    const post: Array<[MNode, MNode]> = [];
    const pre: Array<[MNode, MNode]> = [];
    let list = post;
    const rest = els.slice(1);
    for (let k = 0; k < rest.length; ) {
      if (nameOf(rest[k]) === 'mprescripts') {
        list = pre;
        k++;
        continue;
      }
      list.push([rest[k], rest[k + 1] ?? virtual('none', {}, [])]);
      k += 2;
    }
    const lay = (e: MNode, cramped: boolean) => (nameOf(e) === 'none' ? this.empty() : this.layout(e, this.script(ctx, cramped)));
    const postB = post.map(([a, b]) => [lay(a, true), lay(b, ctx.cramped)] as const);
    const preB = pre.map(([a, b]) => [lay(a, true), lay(b, ctx.cramped)] as const);
    const all = [...postB, ...preB];
    let subShift = 0;
    let supShift = 0;
    for (const [sb, sp] of all) {
      const drop = !(this.antenna && this.charBase(be) && !this.tallBase(base, ctx));
      subShift = Math.max(subShift, this.subShift(base, sb, ctx, drop));
      supShift = Math.max(supShift, this.supShift(base, sp, ctx, drop));
    }
    for (const [sb, sp] of all) [subShift, supShift] = this.adjustPair(sb, sp, subShift, supShift, ctx);
    const space = this.k('spaceAfterScript', ctx);
    const largeop = !!base.op?.largeop;
    const loIc = largeop ? base.ic : 0;
    const ic = largeop ? 0 : base.ic;
    const parts: Array<{ b: Box; x: number; y: number }> = [];
    let x = 0;
    for (const [sb, sp] of preB) {
      const pw = Math.max(sb.w, sp.w);
      x += space;
      parts.push({ b: sb, x: x + pw - sb.w, y: -subShift }, { b: sp, x: x + pw - sp.w, y: supShift });
      x += pw;
    }
    parts.push({ b: base, x, y: 0 });
    x += base.w;
    for (const [sb, sp] of postB) {
      parts.push({ b: sb, x: x - loIc, y: -subShift }, { b: sp, x: x + ic, y: supShift });
      x += Math.max(sb.w - loIc, sp.w + ic) + space;
    }
    const out = this.combine(x, parts);
    if (base.op) out.op = base.op;
    return out;
  }

  // ── munder・mover・munderover (3.4.2) ──

  private underover(nm: string, n: MNode, ctx: Ctx, c?: Constraint): Box {
    const els = this.flow(n);
    const need = nm === 'munderover' ? 3 : 2;
    if (els.length !== need) return this.row(els, ctx, c, false, n);
    const [be, a1, a2] = els;
    const underEl = nm === 'mover' ? undefined : a1;
    const overEl = nm === 'mover' ? a1 : nm === 'munderover' ? a2 : undefined;
    const accent = this.bool(n, 'accent', false);
    const accentUnder = this.bool(n, 'accentunder', false);
    // 動かせる上下の添え字 (movablelimits) は、compact では右肩・右下に付ける
    const baseOp = this.coreOp(be);
    if (!ctx.display && baseOp && this.opProps(baseOp, ctx).movablelimits) {
      const map: Record<string, string> = { munder: 'msub', mover: 'msup', munderover: 'msubsup' };
      return this.scripts(map[nm], els, ctx, c);
    }
    const baseCtx: Ctx = accent ? { ...ctx, cramped: true } : ctx;
    const scriptCtx = (isAccent: boolean): Ctx => (isAccent ? { ...ctx, display: false } : this.script(ctx));
    // 横に伸ばす字 (3.4.2.2): 伸ばさない子の幅の最大まで伸ばす
    const items: Array<{ el: MNode; ctx: Ctx; box?: Box; cons?: Constraint }> = [{ el: be, ctx: baseCtx, cons: c }];
    if (underEl) items.push({ el: underEl, ctx: { ...scriptCtx(accentUnder), cramped: true } });
    // 上のアクセントが矢印の mo なら、アクセント用の矢印の字 (U+20D7 など) で組む (下の combiningAccent)
    const combining = accent && overEl ? this.combiningArrow(overEl) : undefined;
    if (overEl && !combining) items.push({ el: overEl, ctx: scriptCtx(accent) });
    if (c) items[0].box = this.layout(be, baseCtx, c);
    const toStretch = items.filter((it) => !it.box && this.inlineStretchy(it.el, it.ctx));
    for (const it of items) if (!it.box && !toStretch.includes(it)) it.box = this.layout(it.el, it.ctx);
    if (toStretch.length) {
      const laid = items.filter((it) => it.box).map((it) => it.box!.w);
      const T = laid.length ? maxOf(laid) : 0;
      for (const it of toStretch) it.box = this.layout(it.el, it.ctx, { inline: T });
    }
    const base = items[0].box!;
    const under = underEl ? items[1].box! : undefined;
    const over = overEl ? (combining ? this.combiningAccent(combining, items[0].box!, this.enter(overEl, ctx)) : items[items.length - 1].box!) : undefined;
    const k = (name: MathConstantName) => this.k(name, ctx);
    const largeop = !!base.op?.largeop;
    const loIc = largeop ? base.ic : 0;
    const baseStretchInline = !!base.op?.stretchy && !!base.op?.inline;
    // 横の位置: 中心を揃える (上のアクセントは、アクセントの付く位置を中心に)
    const hb = base.w / 2;
    let maxX = hb;
    let minX = -hb;
    let ta = 0;
    if (under) {
      maxX = Math.max(maxX, under.w / 2 - loIc / 2);
      minX = Math.min(minX, -under.w / 2 - loIc / 2);
    }
    if (over) {
      ta = over.tac ?? over.w / 2;
      maxX = Math.max(maxX, over.w - ta + loIc / 2);
      minX = Math.min(minX, -ta + loIc / 2);
    }
    const m = minX;
    const parts: Array<{ b: Box; x: number; y: number }> = [{ b: base, x: -m - hb, y: 0 }];
    let extraA = 0;
    let extraD = 0;
    if (under) {
      let shift: number;
      if (largeop) shift = Math.max(k('lowerLimitBaselineDropMin'), k('lowerLimitGapMin') + under.a);
      else if (baseStretchInline) shift = Math.max(k('stretchStackBottomShiftDown'), k('stretchStackGapAboveMin') + under.a);
      else {
        shift = accentUnder ? 0 : k('underbarVerticalGap');
        shift += under.a;
        extraD = k('underbarExtraDescender');
      }
      parts.push({ b: under, x: -m - under.w / 2 - loIc / 2, y: -(base.d + shift) + (largeop || baseStretchInline ? 0 : 0) });
    }
    if (over) {
      let shift: number;
      if (largeop) shift = Math.max(k('upperLimitBaselineRiseMin'), k('upperLimitGapMin') + over.d);
      else if (baseStretchInline) shift = Math.max(k('stretchStackTopShiftUp'), k('stretchStackGapBelowMin') + over.d);
      else {
        shift = !accent ? k('overbarVerticalGap') + over.d : Math.max(0, k('accentBaseHeight') - base.a);
        extraA = k('overbarExtraAscender');
        if (accent) {
          // アクセント: アクセントの字の下端は AccentBaseHeight の上にある (MathML Core の注)。基線から AccentBaseHeight 以上の所に置く
          // アクセント用の字 (U+20D7 など) は、x-height の字の上に載る高さに作られているので、字の高さが AccentBaseHeight を超える分だけ上げる
          parts.push({ b: over, x: -m - ta + loIc / 2, y: combining ? Math.max(0, base.a - k('accentBaseHeight')) : base.a + shift });
          const out0 = this.finishUO(this.combine(maxX - m, parts), base, extraA, extraD);
          out0.na = base.na ?? base.a;
          return out0;
        }
      }
      parts.push({ b: over, x: -m - ta + loIc / 2, y: base.a + shift });
    }
    const out = this.combine(maxX - m, parts);
    return this.finishUO(out, base, extraA, extraD);
  }

  /** 矢印 (→ ← ↔) に対応する、上に付ける矢印の字 (結合文字) */
  private static readonly COMBINING_ARROW: Record<string, number> = { '→': 0x20d7, '←': 0x20d6, '↔': 0x20e1 };

  /**
   * 上のアクセントが矢印 1 字の mo なら、上に付ける矢印の字 (U+20D7・U+20D6・U+20E1) の符号位置を返す (数式の書体にあるときだけ)。
   * 矢印の mo は横に伸ばす字なので、そのまま組むと字の幅いっぱいの大きな矢印になる。字に合った小さな矢印にするため、
   * 上に付ける矢印の字で組む
   */
  private combiningArrow(el: MNode): number | undefined {
    if (nameOf(el) !== 'mo') return undefined;
    const cp = MathLayouter.COMBINING_ARROW[(el.textContent ?? '').trim()];
    return cp && this.f.fk.hasGlyphForCodePoint(cp) ? cp : undefined;
  }

  /** 上に付ける字 (結合文字) の箱。字の幅 (字形の左右) を箱の幅にする。大きさの違う字のうち、下の字の幅を超えない最も長いもの (無ければ最も短いもの) を使う */
  private combiningAccent(cp: number, base: Box, ctx: Ctx): Box {
    const fk = this.f.fk;
    const g = fk.glyphForCodePoint(cp);
    const s = ctx.size / this.upm;
    const con = this.f.construction(g.id, false);
    let glyph: FkGlyph = g;
    if (con?.variants.length) {
      glyph = fk.getGlyph(con.variants[0].glyph);
      for (const v of con.variants) if (v.advance * s <= base.w) glyph = fk.getGlyph(v.glyph);
    }
    const b = this.glyphBox(fk, glyph, ctx.size, ctx.color);
    const bb = glyph.bbox;
    const w = (bb.maxX - bb.minX) * s;
    return { ...b, w, ic: 0, tac: w / 2, items: this.moved(b, -bb.minX * s, 0) };
  }

  private finishUO(out: Box, base: Box, extraA: number, extraD: number): Box {
    out.a += extraA;
    out.la += extraA;
    out.d += extraD;
    out.ld += extraD;
    if (base.op) out.op = base.op;
    out.ic = base.op?.largeop ? 0 : 0;
    return out;
  }

  // ── mpadded ──

  private mpadded(n: MNode, ctx: Ctx, c?: Constraint): Box {
    const b = this.row(this.flow(n), ctx, c, false, n);
    const dim = (v: string | undefined, cur: number): number => {
      if (!v) return cur;
      const s = v.trim();
      const m = /^([+-]?)\s*(\d+\.?\d*|\.\d+)\s*(%|width|height|depth|[a-z]*)\s*(width|height|depth)?$/i.exec(s);
      if (!m) return cur;
      const sign = m[1];
      const num = parseFloat(m[2]);
      let unit = m[3].toLowerCase();
      const pseudo = { width: b.w, height: b.la, depth: b.ld } as Record<string, number>;
      let val: number;
      if (unit === '%') val = (num / 100) * (m[4] ? pseudo[m[4].toLowerCase()] : cur);
      else if (unit in pseudo) val = num * pseudo[unit];
      else {
        if (unit === '') unit = num === 0 ? 'pt' : '';
        val = this.length(`${num}${unit}`, ctx, cur) ?? cur;
      }
      return sign === '+' ? cur + val : sign === '-' ? cur - val : val;
    };
    const w = dim(attr(n, 'width'), b.w);
    const h = dim(attr(n, 'height'), b.la);
    const d = dim(attr(n, 'depth'), b.ld);
    const ls = dim(attr(n, 'lspace'), 0);
    const vo = dim(attr(n, 'voffset'), 0);
    return { ...b, w, a: Math.max(h, b.a + vo), d: Math.max(d, b.d - vo), la: h, ld: d, items: this.moved(b, ls, vo) };
  }

  // ── menclose (MathML 3) ──

  private menclose(n: MNode, ctx: Ctx): Box {
    const b = this.row(this.flow(n), ctx, undefined, false, n);
    const notation = (attr(n, 'notation') ?? 'longdiv').split(/\s+/).filter(Boolean);
    if (notation.includes('radical')) return this.radical(b, undefined, ctx);
    return this.framed(b, notation, ctx.size * 0.2, ctx.color, ctx);
  }

  /** 囲み (menclose の notation)。pad は中身と線の間 */
  private framed(b: Box, notation: string[], pad: number, color: string, ctx: Ctx, fill?: string): Box {
    const t = this.k('overbarRuleThickness', ctx) || ctx.size * 0.05;
    const has = (k: string) => notation.includes(k);
    const sides = {
      l: has('box') || has('roundedbox') || has('left') || has('madruwb') === false && has('longdiv'),
      r: has('box') || has('roundedbox') || has('right') || has('actuarial') || has('madruwb'),
      t: has('box') || has('roundedbox') || has('top') || has('actuarial') || has('longdiv'),
      b: has('box') || has('roundedbox') || has('bottom') || has('madruwb'),
    };
    const circle = has('circle');
    const longdiv = has('longdiv');
    const pl = sides.l || circle || longdiv ? pad + t : 0;
    const pr = sides.r || circle ? pad + t : 0;
    const pt = sides.t || circle ? pad + t : 0;
    const pb = sides.b || circle ? pad + t : 0;
    const lw = longdiv ? ctx.size * 0.3 : 0;
    const w = b.w + pl + pr + lw;
    const top = b.a + pt;
    const bot = -(b.d + pb);
    const out = this.combine(w, [{ b, x: pl + lw, y: 0 }]);
    const items: Item[] = [];
    if (fill) items.push(this.rule(0, bot, w, top - bot, fill));
    const x0 = t / 2;
    const x1 = w - t / 2;
    const y0 = bot + t / 2;
    const y1 = top - t / 2;
    if (circle) items.push({ t: 'k', pts: [[x0, y0, x1, y1]], sw: t, c: color, ellipse: true });
    if (has('roundedbox')) {
      const r = Math.min(pad * 1.5, (x1 - x0) / 2, (y1 - y0) / 2);
      items.push({ t: 'k', pts: [[x0 + r, y0, x1 - r, y0], [x1, y0 + r, x1, y1 - r], [x1 - r, y1, x0 + r, y1], [x0, y1 - r, x0, y0 + r]], sw: t, c: color, close: true });
    } else {
      if (sides.t) items.push(this.rule(longdiv ? lw / 2 : 0, top - t, longdiv ? w - lw / 2 : w, t, color));
      if (sides.b) items.push(this.rule(0, bot, w, t, color));
      if (sides.l && !longdiv) items.push(this.rule(0, bot, t, top - bot, color));
      if (sides.r) items.push(this.rule(w - t, bot, t, top - bot, color));
    }
    if (longdiv) items.push({ t: 'k', pts: [[lw / 2, top - t / 2, lw, (top + bot) / 2, lw / 2, bot]], sw: t, c: color });
    if (has('horizontalstrike')) items.push(this.rule(0, (b.a - b.d) / 2 - t / 2, w, t, color));
    if (has('verticalstrike')) items.push(this.rule(w / 2 - t / 2, bot, t, top - bot, color));
    if (has('updiagonalstrike') || has('updiagonalarrow')) items.push({ t: 'k', pts: [[x0, y0, x1, y1]], sw: t, c: color });
    if (has('downdiagonalstrike')) items.push({ t: 'k', pts: [[x0, y1, x1, y0]], sw: t, c: color });
    if (has('updiagonalarrow')) {
      const ah = ctx.size * 0.25;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const p = (a: number) => [x1 - ah * Math.cos(ang + a), y1 - ah * Math.sin(ang + a)];
      items.push({ t: 'k', pts: [[...p(0.4), x1, y1, ...p(-0.4)]], sw: t, c: color });
    }
    return { ...out, a: Math.max(out.a, top), d: Math.max(out.d, -bot), la: Math.max(out.la, top), ld: Math.max(out.ld, -bot), items: [...items, ...out.items] };
  }

  // ── mtable (MathML 3 の属性。セルの内側のアキは MathML Core の付録 A の値) ──

  private list(v: string | undefined): string[] {
    return v ? v.split(/\s+/).filter(Boolean) : [];
  }

  private pick(list: string[], k: number, dflt: string): string {
    if (!list.length) return dflt;
    return list[Math.min(k, list.length - 1)];
  }

  private mtable(n: MNode, ctx0: Ctx): Box {
    const ctx: Ctx = { ...ctx0, display: this.bool(n, 'displaystyle', false) };
    const rows = this.flow(n).filter((r) => /^(mtr|mlabeledtr)$/.test(nameOf(r)));
    const colAlignT = this.list(attr(n, 'columnalign'));
    const rowAlignT = this.list(attr(n, 'rowalign'));
    // 単位の無い数・百分率は、既定の間隔 (列 0.8em・行 1.0ex) の倍数 (columnspacing="0.3"・rowspacing="-0.4" など)
    const colSpacing = this.list(attr(n, 'columnspacing')).map((v) => this.length(v, ctx, 0.8 * ctx.size) ?? 0.8 * ctx.size);
    // antenna: 負の行の間隔は使わず、既定の 1.0ex にする (rowspacing="-0.4" でも行を詰めない)
    const rowSpacing = this.list(attr(n, 'rowspacing')).map((v) => {
      const r = this.length(v, ctx, this.ex(ctx));
      return r === undefined || (this.antenna && r < 0) ? this.ex(ctx) : r;
    });
    const colLines = this.list(attr(n, 'columnlines'));
    const rowLines = this.list(attr(n, 'rowlines'));
    const frame = attr(n, 'frame') ?? 'none';
    const fsp = this.list(attr(n, 'framespacing'));
    const framed = frame !== 'none';
    const fx = framed ? (this.length(fsp[0], ctx) ?? 0.4 * ctx.size) : 0;
    const fy = framed ? (this.length(fsp[1], ctx) ?? 0.5 * this.ex(ctx)) : 0;
    const t = this.k('fractionRuleThickness', ctx) || ctx.size * 0.05;

    // セル: 子の要素 (mtd)。mtd でない子は、そのまま 1 つのセルとして組む
    type Cell = { el: MNode; box: Box; groups?: Array<{ left: Box; right: Box }>; align: string; ralign: string; label?: boolean };
    const grid: Cell[][] = [];
    const labels: Array<Box | undefined> = [];
    rows.forEach((r, ri) => {
      const labeled = nameOf(r) === 'mlabeledtr';
      const cells = this.flow(r);
      const rColAlign = this.list(attr(r, 'columnalign'));
      const rRowAlign = attr(r, 'rowalign');
      const row: Cell[] = [];
      cells.forEach((cel, ci) => {
        if (labeled && ci === 0) {
          labels[ri] = this.layout(cel, ctx);
          return;
        }
        const col = labeled ? ci - 1 : ci;
        const cellCtx = this.enter(r, ctx);
        const align = attr(cel, 'columnalign') ?? this.pick(rColAlign, col, this.pick(colAlignT, col, 'center'));
        const ralign = attr(cel, 'rowalign') ?? rRowAlign ?? this.pick(rowAlignT, ri, 'baseline');
        const groups = this.alignGroups(cel, cellCtx);
        const box = groups ? this.empty() : this.layout(cel, cellCtx);
        row.push({ el: cel, box, groups, align, ralign });
      });
      grid.push(row);
    });
    const ncol = maxOf(grid.map((r) => r.length), 0);
    // 揃えの組 (maligngroup) のある列: 組ごとに、印 (malignmark) の左右の幅の最大
    const groupW: Array<Array<{ l: number; r: number }> | undefined> = [];
    for (let ci = 0; ci < ncol; ci++) {
      const gs = grid.map((r) => r[ci]?.groups).filter(Boolean) as Array<Array<{ left: Box; right: Box }>>;
      if (!gs.length) continue;
      const ng = maxOf(gs.map((g) => g.length));
      groupW[ci] = Array.from({ length: ng }, (_, gi) => ({ l: maxOf(gs.map((g) => g[gi]?.left.w ?? 0), 0), r: maxOf(gs.map((g) => g[gi]?.right.w ?? 0), 0) }));
    }
    for (const row of grid)
      row.forEach((cell, ci) => {
        const gw = groupW[ci];
        if (!cell.groups || !gw) return;
        const parts: Array<{ b: Box; x: number; y: number }> = [];
        let x = 0;
        gw.forEach((w, gi) => {
          const g = cell.groups![gi];
          if (g) parts.push({ b: g.left, x: x + w.l - g.left.w, y: 0 }, { b: g.right, x: x + w.l, y: 0 });
          x += w.l + w.r;
        });
        cell.box = this.combine(x, parts);
        cell.align = 'left';
      });
    const colW = Array.from({ length: ncol }, (_, ci) => maxOf(grid.map((r) => r[ci]?.box.w ?? 0), 0));
    if (this.bool(n, 'equalcolumns', false) && ncol) colW.fill(maxOf(colW));
    const rowA = grid.map((r) => maxOf(r.map((c) => c.box.la), 0));
    const rowD = grid.map((r) => maxOf(r.map((c) => c.box.ld), 0));
    // セルの中身は、行の高さを字の行の高さ以上にする (付録 A: mtd は表のセル)
    const strutA = (this.f.fk.ascent * ctx.size) / this.upm;
    const strutD = (-this.f.fk.descent * ctx.size) / this.upm;
    grid.forEach((_, ri) => {
      rowA[ri] = Math.max(rowA[ri], strutA * 0.8);
      rowD[ri] = Math.max(rowD[ri], strutD * 0.8);
    });
    if (this.bool(n, 'equalrows', false) && grid.length) {
      const h = maxOf(grid.map((_, ri) => rowA[ri] + rowD[ri]));
      grid.forEach((_, ri) => {
        rowD[ri] = h - rowA[ri];
      });
    }
    // 位置
    const colX: number[] = [];
    let x = fx;
    for (let ci = 0; ci < ncol; ci++) {
      colX.push(x);
      x += colW[ci] + (ci < ncol - 1 ? this.pickN(colSpacing, ci, 0.8 * ctx.size) : 0);
    }
    const width = x + fx;
    const rowY: number[] = [];
    let y = -fy;
    grid.forEach((_, ri) => {
      y -= rowA[ri];
      rowY.push(y);
      y -= rowD[ri] + (ri < grid.length - 1 ? this.pickN(rowSpacing, ri, this.ex(ctx)) : 0);
    });
    const height = -(y - fy);
    const parts: Array<{ b: Box; x: number; y: number }> = [];
    grid.forEach((row, ri) =>
      row.forEach((cell, ci) => {
        const cw = colW[ci];
        const dx = cell.align === 'left' ? 0 : cell.align === 'right' ? cw - cell.box.w : (cw - cell.box.w) / 2;
        let cy = rowY[ri];
        if (cell.ralign === 'top') cy = rowY[ri] + rowA[ri] - cell.box.la;
        else if (cell.ralign === 'bottom') cy = rowY[ri] - rowD[ri] + cell.box.ld;
        else if (cell.ralign === 'center' || cell.ralign === 'axis') cy = rowY[ri] + (rowA[ri] - rowD[ri]) / 2 - (cell.box.la - cell.box.ld) / 2;
        parts.push({ b: cell.box, x: colX[ci] + dx, y: cy });
      }),
    );
    // 表の縦の位置 (align。既定は axis: 表の中央を軸に)
    // antenna: 数式の全体になっている表は、指定が無ければ最下行の基線を数式の基線にする
    // (前の文の基線が表の最下行の基線にそろう)
    const p = n.parentNode;
    const rootTable = this.antenna && !!p && nameOf(p) === 'math' && elements(p).length === 1;
    const al = (attr(n, 'align') ?? (rootTable ? 'baseline -1' : 'axis')).split(/\s+/);
    const axis = this.k('axisHeight', ctx);
    const rn = al[1] ? parseInt(al[1], 10) : 0;
    const ri = rn ? (rn > 0 ? rn - 1 : grid.length + rn) : -1;
    let shift: number;
    const rTop = (k: number) => rowY[k] + rowA[k];
    const rBot = (k: number) => rowY[k] - rowD[k];
    if (ri >= 0 && ri < grid.length) {
      shift = al[0] === 'top' ? -rTop(ri) : al[0] === 'bottom' ? -rBot(ri) : al[0] === 'baseline' ? -rowY[ri] : al[0] === 'center' ? -(rTop(ri) + rBot(ri)) / 2 : axis - (rTop(ri) + rBot(ri)) / 2;
    } else {
      shift = al[0] === 'top' ? 0 : al[0] === 'bottom' ? height : al[0] === 'center' ? height / 2 : al[0] === 'baseline' ? height / 2 : axis + height / 2;
    }
    const out = this.combine(width, parts.map((p) => ({ ...p, y: p.y + shift })));
    out.a = out.la = Math.max(out.la, shift);
    out.d = out.ld = Math.max(out.ld, height - shift);
    const lines: Item[] = [];
    const dashed = (v: string) => v === 'dashed';
    for (let ci = 0; ci < ncol - 1; ci++) {
      const v = this.pick(colLines, ci, 'none');
      if (v === 'none') continue;
      const lx = colX[ci] + colW[ci] + this.pickN(colSpacing, ci, 0.8 * ctx.size) / 2 - t / 2;
      pushAll(lines, this.lineItems(lx, shift - height, t, height, true, dashed(v), ctx.color));
    }
    for (let r = 0; r < grid.length - 1; r++) {
      const v = this.pick(rowLines, r, 'none');
      if (v === 'none') continue;
      const ly = rBot(r) - this.pickN(rowSpacing, r, this.ex(ctx)) / 2 + shift - t / 2;
      pushAll(lines, this.lineItems(0, ly, width, t, false, dashed(v), ctx.color));
    }
    if (framed) {
      const d = dashed(frame);
      pushAll(lines, this.lineItems(0, shift - t, width, t, false, d, ctx.color));
      pushAll(lines, this.lineItems(0, shift - height, width, t, false, d, ctx.color));
      pushAll(lines, this.lineItems(0, shift - height, t, height, true, d, ctx.color));
      pushAll(lines, this.lineItems(width - t, shift - height, t, height, true, d, ctx.color));
    }
    pushAll(out.items, lines);
    // 式の番号 (mlabeledtr の最初の子): 表の右に置く
    const labeled = labels.map((b, k) => (b ? { b, k } : undefined)).filter(Boolean) as Array<{ b: Box; k: number }>;
    if (labeled.length) {
      const gap = ctx.size;
      const lw = maxOf(labeled.map((l) => l.b.w));
      const full = rootTable && attr(p!, 'display') === 'block' && this.o.lineWidth && this.o.lineWidth > width + 2 * (gap + lw) ? this.o.lineWidth : undefined;
      if (full) {
        // 行の幅いっぱい: 表を中央に、式番号を右端 (side="left" なら左端) に
        const left = /^left/.test(attr(n, 'side') ?? '');
        return this.combine(full, [{ b: out, x: (full - width) / 2, y: 0 }, ...labeled.map((l) => ({ b: l.b, x: left ? 0 : full - l.b.w, y: rowY[l.k] + shift }))]);
      }
      // side="left" (leftoverlap) なら左に
      if (/^left/.test(attr(n, 'side') ?? '')) return this.combine(width + gap + lw, [{ b: out, x: lw + gap, y: 0 }, ...labeled.map((l) => ({ b: l.b, x: 0, y: rowY[l.k] + shift }))]);
      return this.combine(width + gap + lw, [{ b: out, x: 0, y: 0 }, ...labeled.map((l) => ({ b: l.b, x: width + gap + lw - l.b.w, y: rowY[l.k] + shift }))]);
    }
    return out;
  }

  private pickN(list: number[], k: number, dflt: number): number {
    if (!list.length) return dflt;
    return list[Math.min(k, list.length - 1)];
  }

  /** 線 (実線・破線) */
  private lineItems(x: number, y: number, w: number, h: number, vertical: boolean, dashed: boolean, c: string): Item[] {
    if (!dashed) return [this.rule(x, y, w, h, c)];
    const len = vertical ? h : w;
    const th = vertical ? w : h;
    const dash = th * 4;
    // 切れ端の長さが正の有限の数でない (太さが 0・数でない) と、下の繰り返しが進まない。切れ端が多すぎる線 (太さに比べて
    // 極端に長い線) も含めて、実線にする
    if (!(dash > 0) || !Number.isFinite(dash) || !(len / (dash * 2) <= MAX_DASHES)) return [this.rule(x, y, w, h, c)];
    const out: Item[] = [];
    for (let p = 0; p < len; p += dash * 2) {
      const l = Math.min(dash, len - p);
      out.push(vertical ? this.rule(x, y + p, w, l, c) : this.rule(x + p, y, l, h, c));
    }
    return out;
  }

  /**
   * 揃えの組 (maligngroup・malignmark) のあるセルを、組ごとに、印の左と右に分けて組む。
   * 組の無いセルは undefined。組は、セルの中身 (1 つだけの mrow の子は、その中身) を maligngroup で分けたもの
   */
  private alignGroups(cell: MNode, ctx: Ctx): Array<{ left: Box; right: Box }> | undefined {
    let kids = this.flow(cell);
    if (kids.length === 1 && nameOf(kids[0]) === 'mrow') kids = this.flow(kids[0]);
    if (!kids.some((k) => nameOf(k) === 'maligngroup')) return undefined;
    const groups: MNode[][] = [];
    let cur: MNode[] = [];
    for (const k of kids) {
      if (nameOf(k) === 'maligngroup') {
        if (cur.length || groups.length) groups.push(cur);
        cur = [];
      } else cur.push(k);
    }
    groups.push(cur);
    const c2 = this.enter(cell, ctx);
    return groups.map((g) => {
      const mi = g.findIndex((k) => nameOf(k) === 'malignmark' || elements(k).some((e) => nameOf(e) === 'malignmark'));
      if (mi < 0) return { left: this.empty(), right: this.row(g, c2, undefined, false) };
      const at = nameOf(g[mi]) === 'malignmark' ? mi : mi + 1;
      return { left: this.row(g.slice(0, at), c2, undefined, false), right: this.row(g.slice(at).filter((k) => nameOf(k) !== 'malignmark'), c2, undefined, false) };
    });
  }

  // ── mstack・mlongdiv (MathML 3 の初等数学。桁を右に揃えて積む) ──

  private mstack(n: MNode, ctx: Ctx): Box {
    const isDiv = nameOf(n) === 'mlongdiv';
    const kids = this.flow(n);
    const digitW = this.textBox('0', ctx).w;
    type Row = { cells: Box[]; shift: number; line?: number; cross?: Array<string | undefined> };
    // msrow・mrow・msgroup の入れ子は、layout と同じ深さの上限 (MAX_MATH_NEST) まで読む (それより深い所は空)
    const cellsOf = (e: MNode, c: Ctx, depth = 0): Box[] => {
      const nm = nameOf(e);
      if (nm === 'mn') return [...(e.textContent ?? '').trim()].map((ch) => this.textBox(ch, c));
      if (nm === 'msrow' || nm === 'mrow') return depth >= MAX_MATH_NEST ? [] : this.flow(e).flatMap((k) => cellsOf(k, c, depth + 1));
      if (nm === 'none') return [this.empty()];
      return [this.layout(e, c)];
    };
    /** 繰り上がりの行 (mscarries)。crossout は、下の行の同じ桁の字に引く線 */
    const carries = (e: MNode, shift: number): Row => {
      const c = this.script(ctx);
      const all = attr(e, 'crossout');
      const ks = this.flow(e);
      return {
        cells: ks.map((k) => (nameOf(k) === 'mscarry' ? this.row(this.flow(k), c, undefined, false) : nameOf(k) === 'none' ? this.empty() : this.layout(k, c))),
        cross: ks.map((k) => (nameOf(k) === 'none' ? undefined : (attr(k, 'crossout') ?? all))),
        shift: shift + (parseInt(attr(e, 'position') ?? '0', 10) || 0),
      };
    };
    const addRow = (rows: Row[], e: MNode, shift: number, depth = 0) => {
      const nm = nameOf(e);
      const pos = parseInt(attr(e, 'position') ?? '0', 10) || 0;
      if (nm === 'msline') rows.push({ cells: [], shift: shift + pos, line: parseInt(attr(e, 'length') ?? '0', 10) || 0 });
      else if (nm === 'mscarries') rows.push(carries(e, shift));
      else if (nm === 'msgroup') {
        const sh = parseInt(attr(e, 'shift') ?? '0', 10) || 0;
        if (depth < MAX_MATH_NEST) this.flow(e).forEach((k, i) => addRow(rows, k, shift + pos + i * sh, depth + 1));
      } else rows.push({ cells: cellsOf(e, ctx), shift: shift + pos });
    };
    // mlongdiv: 繰り上がりを除いた最初の 2 つが、割る数と商 (その前の繰り上がりは、それぞれに付く)
    const divRows: Row[] = [];
    const rows: Row[] = [];
    let firstBody = 0;
    if (isDiv) {
      let idx = 0;
      const resultRows: Row[] = [];
      const bodyRows: Row[] = [];
      for (const k of kids) {
        if (idx < 2) {
          const target = idx === 0 ? divRows : resultRows;
          addRow(target, k, 0);
          if (nameOf(k) !== 'mscarries') idx++;
        } else addRow(bodyRows, k, 0);
      }
      pushAll(rows, resultRows);
      firstBody = rows.length;
      pushAll(rows, bodyRows);
    } else for (const k of kids) addRow(rows, k, 0);

    const gap = ctx.size * 0.15;
    const t = this.k('fractionRuleThickness', ctx) || ctx.size * 0.05;
    /** 行を積む。列は右端から数える。y は上から下へ (負)。各行の基線の位置を返す */
    const stack = (list: Row[]) => {
      const cw = maxOf(list.flatMap((r) => (r.line === undefined ? r.cells.map((c) => c.w) : [])), digitW);
      const ncols = maxOf(list.map((r) => (r.line !== undefined ? r.line : r.cells.length) + r.shift), 1);
      const W = ncols * cw;
      const parts: Array<{ b: Box; x: number; y: number }> = [];
      const items: Item[] = [];
      const base: number[] = [];
      let y = 0;
      let cross: Row | undefined;
      for (const r of list) {
        if (r.line !== undefined) {
          const cols = r.line || ncols;
          items.push(this.rule(W - (cols + r.shift) * cw, y - t, cols * cw, t, ctx.color));
          y -= t + gap;
          base.push(y);
          continue;
        }
        const small = !!r.cross;
        const a = maxOf(r.cells.map((c) => c.a), small ? 0 : ctx.size * 0.7);
        const d = maxOf(r.cells.map((c) => c.d), small ? 0 : ctx.size * 0.2);
        y -= a;
        base.push(y);
        const colX = (k: number, len: number, shift: number) => W - (len - 1 - k + shift + 1) * cw;
        r.cells.forEach((c, k) => parts.push({ b: c, x: colX(k, r.cells.length, r.shift) + (cw - c.w) / 2, y }));
        if (cross && !small) {
          const cr = cross;
          cr.cross!.forEach((note, k) => {
            if (!note || note === 'none') return;
            const x0 = colX(k, cr.cells.length, cr.shift);
            const x1 = x0 + cw;
            const y0 = y - ctx.size * 0.05;
            const y1 = y + ctx.size * 0.7;
            for (const nt of note.split(/\s+/)) {
              if (nt === 'updiagonalstrike') items.push({ t: 'k', pts: [[x0, y0, x1, y1]], sw: t, c: ctx.color });
              else if (nt === 'downdiagonalstrike') items.push({ t: 'k', pts: [[x0, y1, x1, y0]], sw: t, c: ctx.color });
              else if (nt === 'horizontalstrike') items.push(this.rule(x0, (y0 + y1) / 2 - t / 2, cw, t, ctx.color));
              else if (nt === 'verticalstrike') items.push(this.rule((x0 + x1) / 2 - t / 2, y0, t, y1 - y0, ctx.color));
            }
          });
        }
        cross = small && r.cross!.some((v) => v && v !== 'none') ? r : undefined;
        y -= d + (small ? gap / 2 : gap);
      }
      const box = this.combine(W, parts);
      pushAll(box.items, items);
      return { box, base, h: -y, W };
    };
    const main = stack(rows);
    let out = main.box;
    let h = main.h;
    if (isDiv) {
      // 割る数を、割られる数 (商の次の行) の基線にそろえて左に置き、割られる数の上と左に線 (「)」の形) を引く
      const dv = stack(divRows);
      const by = main.base[firstBody] ?? main.base[main.base.length - 1] ?? 0;
      const dy = by - (dv.base[dv.base.length - 1] ?? 0);
      const lw = ctx.size * 0.35;
      const x0 = dv.W + lw;
      const top = by + ctx.size * 0.7 + gap / 2;
      const bottom = by - ctx.size * 0.25;
      out = this.combine(x0 + main.W, [
        { b: dv.box, x: 0, y: dy },
        { b: main.box, x: x0, y: 0 },
      ]);
      out.items.push(this.rule(dv.W + lw * 0.5, top - t, main.W + lw * 0.5, t, ctx.color));
      out.items.push({ t: 'k', pts: [[dv.W + lw * 0.5, top - t / 2, dv.W + lw * 0.85, (top + bottom) / 2, dv.W + lw * 0.5, bottom]], sw: t, c: ctx.color });
      h = Math.max(h, -(dy - dv.h));
    }
    // 表と同じく、中央を軸に
    const shift = this.k('axisHeight', ctx) + h / 2;
    const res = this.combine(out.w, [{ b: out, x: 0, y: shift }]);
    res.a = res.la = Math.max(res.a, shift);
    res.d = res.ld = Math.max(res.d, h - shift);
    return res;
  }

  // ── SVG ──

  private pathCache = new Map<FkFont, Map<number, Array<{ command: string; args: number[] }>>>();

  private glyphCommands(fk: FkFont, gid: number) {
    let m = this.pathCache.get(fk);
    if (!m) this.pathCache.set(fk, (m = new Map()));
    let c = m.get(gid);
    if (!c) m.set(gid, (c = fk.getGlyph(gid).path.commands));
    return c;
  }

  toSvg(box: Box): MathResult {
    const pad = 0;
    const A = Math.max(box.a, box.la) + pad;
    const D = Math.max(box.d, box.ld) + pad;
    const W = Math.max(box.w, 0.01);
    const H = Math.max(A + D, 0.01);
    const r = (v: number) => (Math.round(v * 100) / 100).toString();
    const byColor = new Map<string, string[]>();
    const strokes: string[] = [];
    const push = (c: string, d: string) => {
      let l = byColor.get(c);
      if (!l) byColor.set(c, (l = []));
      l.push(d);
    };
    for (const it of box.items) {
      if (it.t === 'g') {
        const X = (v: number) => r(it.x + v * it.s);
        const Y = (v: number) => r(A - (it.y + v * it.s));
        let d = '';
        for (const cmd of this.glyphCommands(it.fk, it.gid)) {
          const a = cmd.args;
          switch (cmd.command) {
            case 'moveTo':
              d += `M${X(a[0])} ${Y(a[1])}`;
              break;
            case 'lineTo':
              d += `L${X(a[0])} ${Y(a[1])}`;
              break;
            case 'quadraticCurveTo':
              d += `Q${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])}`;
              break;
            case 'bezierCurveTo':
              d += `C${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])}`;
              break;
            case 'closePath':
              d += 'Z';
              break;
          }
        }
        if (d) push(it.c, d);
      } else if (it.t === 'r') {
        if (it.w <= 0 || it.h <= 0) continue;
        push(it.c, `M${r(it.x)} ${r(A - it.y - it.h)}h${r(it.w)}v${r(it.h)}h${r(-it.w)}Z`);
      } else {
        const sw = r(it.sw);
        if (it.ellipse) {
          const [x0, y0, x1, y1] = it.pts[0];
          strokes.push(`<ellipse cx="${r((x0 + x1) / 2)}" cy="${r(A - (y0 + y1) / 2)}" rx="${r(Math.abs(x1 - x0) / 2)}" ry="${r(Math.abs(y1 - y0) / 2)}" fill="none" stroke="${it.c}" stroke-width="${sw}"/>`);
          continue;
        }
        let d = '';
        for (const p of it.pts) {
          d += `M${r(p[0])} ${r(A - p[1])}`;
          for (let k = 2; k + 1 < p.length; k += 2) d += `L${r(p[k])} ${r(A - p[k + 1])}`;
        }
        if (it.close) d += 'Z';
        strokes.push(`<path d="${d}" fill="none" stroke="${it.c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
    }
    let body = '';
    for (const [c, ds] of byColor) body += `<path fill="${c}" d="${ds.join('')}"/>`;
    body += strokes.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r(W)}pt" height="${r(H)}pt" viewBox="0 0 ${r(W)} ${r(H)}">${body}</svg>`;
    return { svg, width: W, ascent: A, descent: D };
  }
}

/** 積分記号 (∫ U+222B〜U+2233・U+2A0B〜U+2A1C) */
function isIntegral(cp: number): boolean {
  return (cp >= 0x222b && cp <= 0x2233) || (cp >= 0x2a0b && cp <= 0x2a1c);
}
