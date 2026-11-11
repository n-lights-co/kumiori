/**
 * XSL 1.1 §5.9 の式 (Expression) の評価。長さ・数・百分率・proportional-column-width() を扱う。
 *
 * 文法 (§5.9.1〜5.9.3):
 *   Expr               ::= AdditiveExpr
 *   AdditiveExpr       ::= MultiplicativeExpr | AdditiveExpr '+' MultiplicativeExpr | AdditiveExpr '-' MultiplicativeExpr
 *   MultiplicativeExpr ::= UnaryExpr | MultiplicativeExpr '*' UnaryExpr | MultiplicativeExpr 'div' UnaryExpr | MultiplicativeExpr 'mod' UnaryExpr
 *   UnaryExpr          ::= PrimaryExpr | '-' UnaryExpr
 *   PrimaryExpr        ::= '(' Expr ')' | Numeric | FunctionCall | ...
 *
 * 関数 (§5.10.1): floor・ceiling・round・min・max・abs。proportional-column-width() (§5.10.4) は、
 * table-column の column-width でだけ使える (opts.proportional)。
 * 色・文字列・名前を返す関数、プロパティの値を参照する関数 (from-parent() など) は扱わない (undefined を返す)。
 */

const UNIT: Record<string, number> = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72, px: 0.75, pc: 12 };

export interface ExprOptions {
  /** em の基準 (その要素の font-size) */
  fs: number;
  /** % の基準。省略時、% を含む式は評価できない */
  pct?: number;
  /** proportional-column-width() を受け付ける */
  proportional?: boolean;
  /** lh (行の高さ。CSS Values 4 の単位。アンテナハウスも使える) の基準。省略時、lh を含む式は評価できない */
  lh?: number;
}

/** 評価の結果: 長さ (pt) と、proportional-column-width の係数 */
export interface ExprValue {
  pt: number;
  /** proportional-column-width() の係数の合計 */
  prop: number;
  /** 長さの次元 (0: 数, 1: 長さ) */
  dim: 0 | 1;
}

type Tok = { t: 'num'; v: number; unit: string } | { t: 'op'; v: string } | { t: 'name'; v: string } | { t: '(' } | { t: ')' } | { t: ',' };

function tokenize(s: string): Tok[] | undefined {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([a-z%]*)/i.exec(s.slice(i));
    if (num) {
      const unit = num[2].toLowerCase();
      out.push({ t: 'num', v: parseFloat(num[1]), unit });
      i += num[0].length;
      continue;
    }
    if (c === '+' || c === '-' || c === '*') {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c } as Tok);
      i++;
      continue;
    }
    const name = /^[a-z_][a-z0-9_.-]*/i.exec(s.slice(i));
    if (name) {
      // 名前の中の '-' は名前の一部 (§5.9.2: 演算子の - の前には空白などが要る場合がある)
      const v = name[0];
      if (v === 'div' || v === 'mod') out.push({ t: 'op', v });
      else out.push({ t: 'name', v });
      i += v.length;
      continue;
    }
    return undefined;
  }
  return out;
}

/** 式を評価する。評価できなければ undefined */
export function evalExpr(src: string, o: ExprOptions): ExprValue | undefined {
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return undefined;
  let p = 0;
  const peek = () => toks[p];
  const fail = (): never => {
    throw new Error('expr');
  };
  const num = (n: number): ExprValue => ({ pt: n, prop: 0, dim: 0 });
  const isNum = (v: ExprValue) => v.dim === 0 && v.prop === 0;

  const primary = (): ExprValue => {
    const k = peek();
    if (!k) return fail();
    if (k.t === '(') {
      p++;
      const v = additive();
      if (peek()?.t !== ')') fail();
      p++;
      return v;
    }
    if (k.t === 'num') {
      p++;
      const u = k.unit;
      if (u === '') return num(k.v);
      if (u === 'em') return { pt: k.v * o.fs, prop: 0, dim: 1 };
      // ex は字の x の高さ。書体によらず em の半分とみなす
      if (u === 'ex') return { pt: k.v * o.fs * 0.5, prop: 0, dim: 1 };
      if (u === 'lh') {
        if (o.lh === undefined) return fail();
        return { pt: k.v * o.lh, prop: 0, dim: 1 };
      }
      if (u === '%') {
        if (o.pct === undefined) return fail();
        return { pt: (k.v * o.pct) / 100, prop: 0, dim: 1 };
      }
      const f = UNIT[u];
      if (f === undefined) return fail();
      return { pt: k.v * f, prop: 0, dim: 1 };
    }
    if (k.t === 'name') {
      p++;
      if (peek()?.t !== '(') return fail();
      p++;
      const args: ExprValue[] = [];
      if (peek()?.t !== ')') {
        for (;;) {
          args.push(additive());
          if (peek()?.t === ',') {
            p++;
            continue;
          }
          break;
        }
      }
      if (peek()?.t !== ')') fail();
      p++;
      return call(k.v, args);
    }
    return fail();
  };

  const call = (name: string, a: ExprValue[]): ExprValue => {
    const one = () => (a.length === 1 && a[0].prop === 0 ? a[0] : fail());
    switch (name) {
      case 'proportional-column-width': {
        if (!o.proportional || a.length !== 1 || !isNum(a[0])) return fail();
        return { pt: 0, prop: a[0].pt, dim: 1 };
      }
      case 'floor':
        return { ...one(), pt: Math.floor(one().pt) };
      case 'ceiling':
        return { ...one(), pt: Math.ceil(one().pt) };
      case 'round':
        return { ...one(), pt: Math.round(one().pt) };
      case 'abs':
        return { ...one(), pt: Math.abs(one().pt) };
      case 'min':
      case 'max': {
        // 引数は同じ次元 (§5.10.1)。ただし 0 は単位を省略できる (加算と同じ扱い: min(0, 2pt) は長さ)
        if (a.length !== 2 || a[0].prop !== 0 || a[1].prop !== 0) return fail();
        const zero = (v: ExprValue) => v.dim === 0 && v.pt === 0;
        const dim = zero(a[0]) ? a[1].dim : a[0].dim;
        if (!zero(a[1]) && a[1].dim !== dim) return fail();
        return { pt: name === 'min' ? Math.min(a[0].pt, a[1].pt) : Math.max(a[0].pt, a[1].pt), prop: 0, dim };
      }
      default:
        return fail();
    }
  };

  const unary = (): ExprValue => {
    const k = peek();
    if (k?.t === 'op' && k.v === '-') {
      p++;
      const v = unary();
      return { pt: -v.pt, prop: -v.prop, dim: v.dim };
    }
    // 単項の + は §5.9 の文法に無いが、+12pt のような書き方は広く使われるので受け付ける (括弧の中・演算子の後でも)
    if (k?.t === 'op' && k.v === '+') {
      p++;
      return unary();
    }
    return primary();
  };

  const multiplicative = (): ExprValue => {
    let v = unary();
    for (;;) {
      const k = peek();
      if (k?.t !== 'op' || (k.v !== '*' && k.v !== 'div' && k.v !== 'mod')) return v;
      p++;
      const r = unary();
      if (k.v === '*') {
        if (isNum(v)) v = { pt: v.pt * r.pt, prop: v.pt * r.prop, dim: r.dim };
        else if (isNum(r)) v = { pt: v.pt * r.pt, prop: v.prop * r.pt, dim: v.dim };
        else fail();
      } else if (k.v === 'div') {
        // 長さ ÷ 長さ は数になる (§5.9.6)
        if (r.pt === 0 || r.prop !== 0) fail();
        if (isNum(r)) v = { pt: v.pt / r.pt, prop: v.prop / r.pt, dim: v.dim };
        else if (v.dim === 1 && v.prop === 0) v = num(v.pt / r.pt);
        else fail();
      } else {
        if (r.pt === 0 || r.prop !== 0 || v.prop !== 0 || v.dim !== r.dim) fail();
        v = { ...v, pt: v.pt % r.pt };
      }
    }
  };

  const additive = (): ExprValue => {
    let v = multiplicative();
    for (;;) {
      const k = peek();
      if (k?.t !== 'op' || (k.v !== '+' && k.v !== '-')) return v;
      p++;
      const r = multiplicative();
      // 数と長さを足すことはできない (§5.9.6)。ただし 0 は単位を省略できる
      const dimL = v.dim === 0 && v.prop === 0 && v.pt === 0 ? r.dim : v.dim;
      const dimR = r.dim === 0 && r.prop === 0 && r.pt === 0 ? dimL : r.dim;
      if (dimL !== dimR) fail();
      const s = k.v === '+' ? 1 : -1;
      v = { pt: v.pt + s * r.pt, prop: v.prop + s * r.prop, dim: dimL };
    }
  };

  try {
    const v = additive();
    if (p !== toks.length) return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/** 長さとして評価する。単位の無い数は pt とみなす (従来どおり)。proportional-column-width を含むものは undefined */
export function evalLength(src: string, o: ExprOptions): number | undefined {
  const v = evalExpr(src, o);
  if (!v || v.prop !== 0 || !Number.isFinite(v.pt)) return undefined;
  return v.pt;
}

// 入力の名前 (プロパティ・値・属性の値) で引く定数の表は、原型を持たないものにする: 原型があると、constructor・__proto__・toString などの名前で
// Object.prototype の関数を拾い、30 バイトほどの入力 (p { constructor: 1 }) で、文書の全体が TypeError で組めなくなる
for (const t of [UNIT]) Object.setPrototypeOf(t, null);
