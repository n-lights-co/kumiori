/**
 * Content MathML (意味の記法) を、Presentation MathML (見た目の記法) の仮の要素に置き換える。
 * 対応: ci・cn・csymbol・fn・lambda・apply (plus・minus・times・divide・power・root・abs・factorial・not・関係 (eq・lt など)・
 * 集合の演算・int・sum・product・関数の適用)。置き換えの形 (演算子の字・括弧の付け方) は Kumiori の決めたもの
 */
import { attr, elements, nameOf, virtual, MAX_MATH_NEST, type MNode } from './mathLayout';

const mo = (t: string, a: Record<string, string> = {}) => virtual('mo', a, [], t);
const mi = (t: string, a: Record<string, string> = {}) => virtual('mi', a, [], t);
const mrow = (c: MNode[]) => virtual('mrow', {}, c);
const text = (n: MNode) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();

const INFIX: Record<string, string> = {
  plus: '+',
  times: '⁢',
  eq: '=',
  neq: '≠',
  lt: '<',
  gt: '>',
  leq: '≤',
  geq: '≥',
  and: '∧',
  or: '∨',
  union: '∪',
  intersect: '∩',
  in: '∈',
  notin: '∉',
  subset: '⊆',
  prsubset: '⊂',
  implies: '⇒',
  equivalent: '≡',
  approx: '≈',
  compose: '∘',
};

/** 演算の結びつきの強さ (括弧を付けるかどうかに使う) */
const PREC: Record<string, number> = { plus: 1, minus: 1, times: 2, power: 3 };

const QUAL = new Set(['bvar', 'lowlimit', 'uplimit', 'degree', 'condition', 'domainofapplication', 'interval']);

const CONTENT = new Set(['apply', 'ci', 'cn', 'csymbol', 'fn', 'lambda']);

/**
 * 置き換えの入れ子の深さ。組む側 (mathLayout の layout) と同じ上限 (MAX_MATH_NEST) を超えた所は、空の mrow にする
 * (JS の呼び出しの深さを使い切らない。置き換えは apply の部分木を 1 度にたどるので、layout の上限では止まらない)
 */
let nest = 0;

export function contentToPresentation(n: MNode): MNode {
  const nm = nameOf(n);
  if (!CONTENT.has(nm)) return n;
  if (nest >= MAX_MATH_NEST) return mrow([]);
  nest++;
  try {
    return convert(nm, n);
  } finally {
    nest--;
  }
}

function convert(nm: string, n: MNode): MNode {
  const els = elements(n);
  switch (nm) {
    case 'ci':
    case 'csymbol':
      return els.length ? conv(els[0]) : mi(text(n));
    case 'cn':
      return virtual('mn', {}, [], text(n));
    case 'fn':
      return els[0] ? conv(els[0]) : mi('');
    case 'lambda': {
      const bvars = els.filter((e) => nameOf(e) === 'bvar').map((b) => mrow(elements(b).map(conv)));
      const body = els.filter((e) => nameOf(e) !== 'bvar').map(conv);
      const vs: MNode[] = [];
      bvars.forEach((v, k) => vs.push(...(k ? [mo(','), v] : [v])));
      const head = bvars.length > 1 ? [mo('('), ...vs, mo(')')] : vs;
      return mrow([...head, mo('↦'), ...body]);
    }
    default:
      return apply(els);
  }
}

function conv(n: MNode): MNode {
  return contentToPresentation(n);
}

/** 引数を、演算の強さに応じて括弧で囲む */
function arg(e: MNode, prec: number): MNode {
  const p = conv(e);
  if (nameOf(e) !== 'apply') return p;
  const op = elements(e)[0];
  const q = op ? PREC[nameOf(op)] : undefined;
  return q !== undefined && q < prec ? mrow([mo('('), p, mo(')')]) : p;
}

function apply(els: MNode[]): MNode {
  const op = els[0];
  if (!op) return mrow([]);
  const on = nameOf(op);
  const qual = (q: string) => els.find((e) => nameOf(e) === q);
  const args = els.slice(1).filter((e) => !QUAL.has(nameOf(e)));
  const prec = PREC[on] ?? 0;
  if (INFIX[on]) {
    const out: MNode[] = [];
    args.forEach((a, k) => out.push(...(k ? [mo(INFIX[on]), arg(a, prec)] : [arg(a, prec)])));
    return mrow(out);
  }
  const qrow = (q: MNode | undefined) => (q ? mrow(elements(q).map(conv)) : undefined);
  switch (on) {
    case 'minus':
      if (args.length === 1) return mrow([mo('−'), arg(args[0], 2)]);
      return mrow([arg(args[0], 1), mo('−'), arg(args[1], 2)]);
    case 'divide':
      return virtual('mfrac', {}, [args[0] ? conv(args[0]) : mrow([]), args[1] ? conv(args[1]) : mrow([])]);
    case 'power':
      return virtual('msup', {}, [args[0] ? arg(args[0], 4) : mrow([]), args[1] ? conv(args[1]) : mrow([])]);
    case 'root': {
      const deg = qrow(qual('degree'));
      const body = args[0] ? conv(args[0]) : mrow([]);
      return deg ? virtual('mroot', {}, [body, deg]) : virtual('msqrt', {}, [body]);
    }
    case 'abs':
      return mrow([mo('|'), ...args.map(conv), mo('|')]);
    case 'factorial':
      return mrow([...args.map((a) => arg(a, 4)), mo('!')]);
    case 'not':
      return mrow([mo('¬'), ...args.map((a) => arg(a, 4))]);
    case 'int':
    case 'sum':
    case 'product': {
      const sym = mo(on === 'int' ? '∫' : on === 'sum' ? '∑' : '∏');
      const bv = qrow(qual('bvar'));
      let lo = qrow(qual('lowlimit'));
      const hi = qrow(qual('uplimit'));
      // 和・積の下限は「束縛変数 = 下限」
      if (lo && bv && on !== 'int') lo = mrow([qrow(qual('bvar'))!, mo('='), lo]);
      const tag = on === 'int' ? (lo && hi ? 'msubsup' : lo ? 'msub' : hi ? 'msup' : '') : lo && hi ? 'munderover' : lo ? 'munder' : hi ? 'mover' : '';
      const head = tag ? virtual(tag, {}, [sym, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]) : sym;
      const body = args.map((a) => arg(a, 2));
      return mrow([head, ...body, ...(on === 'int' && bv ? [mi('d', { mathvariant: 'normal' }), bv] : [])]);
    }
    default: {
      // 関数の適用: f(x, y)。名前の要素 (fn・ci・csymbol) でなければ、要素の名前 (sin など) を立体で
      const fn = on === 'fn' || on === 'ci' || on === 'csymbol' ? conv(op) : mi(attr(op, 'definitionURL') ? text(op) || on : on);
      const parts: MNode[] = [];
      args.forEach((a, k) => parts.push(...(k ? [mo(','), conv(a)] : [conv(a)])));
      return mrow([fn, mo('⁡'), mo('('), ...parts, mo(')')]);
    }
  }
}
