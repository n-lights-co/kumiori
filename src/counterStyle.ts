/**
 * @counter-style 規則 (CSS Counter Styles 3) で定義した数え方の書式。
 * 規則を読み (parseCounterStyleRule)、数の表記 (§3 の手順: 範囲・負の数・詰め物・代わりの書式) と、
 * リストの目印の文字 (前置き + 表記 + 後置き) を作る。定義の無い名前は decimal と同じに扱う (§5)
 */

/** @counter-style 規則の記述子 (書かれたものだけ。文字の値は CSS の文字列・識別子をほどいたもの) */
export interface CounterStyleRule {
  /** system。'fixed' は first (最初の値) を持つ。extends は extends に名前 */
  system?:
    | "cyclic"
    | "numeric"
    | "alphabetic"
    | "symbolic"
    | "additive"
    | "fixed";
  first?: number;
  extends?: string;
  symbols?: string[];
  additiveSymbols?: Array<[number, string]>;
  negative?: [string, string];
  prefix?: string;
  suffix?: string;
  /** range。'auto' か、[下, 上] の並び (infinite は ±Infinity) */
  range?: "auto" | Array<[number, number]>;
  pad?: [number, string];
  fallback?: string;
}

/** 定義済みの数え方の名前 (Kumiori が表記を持つもの。counterText) */
export type BuiltinText = (type: string, n: number) => string | undefined;

/**
 * CSS の値を、文字列・識別子の並びに分ける (Syntax 3 の字句の一部: 引用符の文字列、\ の逃がし (16 進 1〜6 桁と続く空白 1 つ)、
 * 空白で区切った識別子)。url() の画像の記号は扱わない (並びから除く)
 */
export function splitSymbols(v: string): string[] {
  const out: string[] = [];
  let i = 0;
  const esc = (): string => {
    // v[i] は '\'
    i++;
    const m = /^[0-9a-fA-F]{1,6}/.exec(v.slice(i));
    if (m) {
      i += m[0].length;
      if (/[ \t\n\r\f]/.test(v[i] ?? "")) i++;
      const cp = parseInt(m[0], 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? "�"
        : String.fromCodePoint(cp);
    }
    const c = v[i] ?? "";
    i += c.length;
    return c;
  };
  while (i < v.length) {
    const c = v[i];
    if (/\s/.test(c) || c === ",") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < v.length && v[i] !== c) s += v[i] === "\\" ? esc() : v[i++];
      i++;
      out.push(s);
      continue;
    }
    if (/^url\(/i.test(v.slice(i))) {
      const e = v.indexOf(")", i);
      i = e < 0 ? v.length : e + 1;
      continue;
    }
    let s = "";
    while (i < v.length && !/[\s"',]/.test(v[i]))
      s += v[i] === "\\" ? esc() : v[i++];
    out.push(s);
  }
  return out;
}

/** @counter-style の中身 (宣言の並び) を読む。読めない記述子は無視する (§3) */
export function parseCounterStyleRule(
  decls: Array<[string, string]>,
): CounterStyleRule {
  const r: CounterStyleRule = {};
  for (const [k0, v0] of decls) {
    const k = k0.trim().toLowerCase();
    const v = v0.trim();
    switch (k) {
      case "system": {
        const m = /^(cyclic|numeric|alphabetic|symbolic|additive)$/i.exec(v);
        if (m) r.system = m[1].toLowerCase() as CounterStyleRule["system"];
        else if (/^fixed\b/i.test(v)) {
          r.system = "fixed";
          const n = parseInt(v.slice(5).trim(), 10);
          if (Number.isFinite(n)) r.first = n;
        } else if (/^extends\s+/i.test(v))
          r.extends = splitSymbols(v.slice(7).trim())[0];
        break;
      }
      case "symbols": {
        const s = splitSymbols(v);
        if (s.length) r.symbols = s;
        break;
      }
      case "additive-symbols": {
        const list: Array<[number, string]> = [];
        for (const part of v.split(",")) {
          const m =
            /^\s*(\d+)\s+([\s\S]+?)\s*$/.exec(part) ??
            /^\s*([\s\S]+?)\s+(\d+)\s*$/.exec(part);
          if (!m) continue;
          const numFirst = /^\d+$/.test(m[1]);
          const w = parseInt(numFirst ? m[1] : m[2], 10);
          const sym = splitSymbols(numFirst ? m[2] : m[1])[0];
          if (sym !== undefined) list.push([w, sym]);
        }
        if (list.length) r.additiveSymbols = list;
        break;
      }
      case "negative": {
        const s = splitSymbols(v);
        if (s.length) r.negative = [s[0], s[1] ?? ""];
        break;
      }
      case "prefix":
      case "suffix": {
        const s = splitSymbols(v);
        if (s.length) r[k] = s[0];
        break;
      }
      case "range": {
        if (/^auto$/i.test(v)) r.range = "auto";
        else {
          const ranges: Array<[number, number]> = [];
          for (const part of v.split(",")) {
            const t = part.trim().split(/\s+/);
            if (t.length !== 2) continue;
            const num = (x: string, inf: number) =>
              /^infinite$/i.test(x) ? inf : parseInt(x, 10);
            const a = num(t[0], -Infinity);
            const b = num(t[1], Infinity);
            if (Number.isNaN(a) || Number.isNaN(b) || a > b) continue;
            ranges.push([a, b]);
          }
          if (ranges.length) r.range = ranges;
        }
        break;
      }
      case "pad": {
        const m =
          /^\s*(\d+)\s+([\s\S]+)$/.exec(v) ??
          /^\s*([\s\S]+?)\s+(\d+)\s*$/.exec(v);
        if (!m) break;
        const numFirst = /^\d+$/.test(m[1]);
        const sym = splitSymbols(numFirst ? m[2] : m[1])[0];
        if (sym !== undefined)
          r.pad = [parseInt(numFirst ? m[1] : m[2], 10), sym];
        break;
      }
      case "fallback": {
        const s = splitSymbols(v)[0];
        if (s) r.fallback = s;
        break;
      }
    }
  }
  return r;
}

/** 書式を解いたもの (extends をたどり、初期値を入れたもの) */
interface Resolved {
  system: NonNullable<CounterStyleRule["system"]>;
  first: number;
  symbols: string[];
  additive: Array<[number, string]>;
  negative: [string, string];
  prefix: string;
  suffix: string;
  range: "auto" | Array<[number, number]>;
  pad: [number, string];
  fallback: string;
  /** 定義済みの書式を extends したもの: 表記はその書式の名前で作る */
  builtin?: string;
}

/**
 * 文書の @counter-style の定義の集まり。builtin は定義済みの書式の表記 (Kumiori の counterText) と後置き。
 * 文書の定義は、定義済みの名前より優先する (§2: 同じ名前の規則は前のものを上書きする。decimal・disc などは上書きできない)
 */
export class CounterStyles {
  constructor(
    private readonly rules: Map<string, CounterStyleRule>,
    private readonly builtinText: BuiltinText,
    private readonly builtinSuffix: (type: string) => string | undefined,
  ) {}

  /** 文書で定義した名前か */
  has(name: string): boolean {
    return this.rules.has(name) && !UNOVERRIDABLE.has(name.toLowerCase());
  }

  private resolve(
    name: string,
    seen = new Set<string>(),
  ): Resolved | undefined {
    // 名前は大文字・小文字を区別する (§2)。上書きできない名前は ASCII の大文字・小文字を区別せずに比べる
    const key = name;
    const rule = UNOVERRIDABLE.has(key.toLowerCase())
      ? undefined
      : this.rules.get(key);
    if (!rule) return undefined;
    const base = {
      negative: ["-", ""] as [string, string],
      prefix: "",
      suffix: ". ",
      range: "auto" as const,
      pad: [0, ""] as [number, string],
      fallback: "decimal",
    };
    if (rule.extends !== undefined) {
      // extends: 元の書式の記述子を受け継ぎ、書いたものだけ上書きする (§3.1.7)。元が無い・輪になるときは decimal を元にする
      const parentName = !seen.has(key) ? rule.extends : "decimal";
      seen.add(key);
      const parent =
        this.resolve(parentName, seen) ??
        this.builtinResolved(parentName) ??
        this.builtinResolved("decimal")!;
      return {
        ...parent,
        ...(rule.negative ? { negative: rule.negative } : {}),
        ...(rule.prefix !== undefined ? { prefix: rule.prefix } : {}),
        ...(rule.suffix !== undefined ? { suffix: rule.suffix } : {}),
        ...(rule.range ? { range: rule.range } : {}),
        ...(rule.pad ? { pad: rule.pad } : {}),
        ...(rule.fallback ? { fallback: rule.fallback } : {}),
      };
    }
    const system = rule.system ?? "symbolic";
    const symbols = rule.symbols ?? [];
    const additive = rule.additiveSymbols ?? [];
    // 記号の数が書式に足りない規則は無効 (§3.1: cyclic・fixed・symbolic は 1 つ以上、alphabetic・numeric は 2 つ以上、additive は 1 つ以上)
    const need = system === "alphabetic" || system === "numeric" ? 2 : 1;
    if (system === "additive" ? additive.length < 1 : symbols.length < need)
      return undefined;
    return {
      ...base,
      system,
      first: rule.first ?? 1,
      symbols,
      additive,
      ...(rule.negative ? { negative: rule.negative } : {}),
      ...(rule.prefix !== undefined ? { prefix: rule.prefix } : {}),
      ...(rule.suffix !== undefined ? { suffix: rule.suffix } : {}),
      ...(rule.range ? { range: rule.range } : {}),
      ...(rule.pad ? { pad: rule.pad } : {}),
      ...(rule.fallback ? { fallback: rule.fallback } : {}),
    };
  }

  /** 定義済みの書式を、extends の元にするための形にする (表記は builtinText) */
  private builtinResolved(name: string): Resolved | undefined {
    if (this.builtinText(name, 1) === undefined) return undefined;
    return {
      system: "numeric",
      first: 1,
      symbols: [],
      additive: [],
      negative: ["-", ""],
      prefix: "",
      // 定義済みの書式の後置き (Counter Styles 3 §6・§7): 記号の書式は " "、cjk-decimal は「、」、ほかの数は ". "
      suffix: ((sfx) =>
        sfx === undefined || sfx === "." ? ". " : sfx === "" ? " " : sfx)(
        this.builtinSuffix(name),
      ),
      range: "auto",
      pad: [0, ""],
      fallback: "decimal",
      builtin: name,
    };
  }

  /**
   * 数の表記 (counter()・counters() の文字。前置き・後置きは付けない)。定義の無い名前は undefined
   * (呼ぶ側が定義済みの書式か decimal で作る)
   */
  text(name: string, n: number, depth = 0): string | undefined {
    const r = this.resolve(name);
    if (!r) return undefined;
    return this.represent(r, n, depth);
  }

  /** リストの目印の文字 (前置き + 表記 + 後置き。§3.1 の prefix・suffix)。定義の無い名前は undefined */
  marker(name: string, n: number): string | undefined {
    const r = this.resolve(name);
    if (!r) return undefined;
    return r.prefix + this.represent(r, n, 0) + r.suffix;
  }

  private viaFallback(r: Resolved, n: number, depth: number): string {
    // 代わりの書式 (§3.1.8)。輪になるときは decimal
    if (depth > 8) return String(n);
    return (
      this.text(r.fallback, n, depth + 1) ??
      this.builtinText(r.fallback, n) ??
      String(n)
    );
  }

  private represent(r: Resolved, n: number, depth: number): string {
    if (r.builtin) {
      // 定義済みの書式を extends したもの: 範囲 (書いたもの) を見てから、元の書式の表記
      if (Array.isArray(r.range) && !r.range.some(([a, b]) => n >= a && n <= b))
        return this.viaFallback(r, n, depth);
      // 負の数・詰め物 (§3.1.2・§3.1.6) は、元の書式が負の数を使うもの (cyclic の記号の書式以外) なら当てる
      const neg =
        n < 0 &&
        !/^(disc|circle|square|disclosure-open|disclosure-closed|none)$/.test(
          r.builtin,
        );
      const base =
        this.builtinText(r.builtin, neg ? -n : n) ?? String(neg ? -n : n);
      return this.padNegative(r, base, neg);
    }
    // 範囲 (§3.1.5): auto は書式ごと (cyclic・numeric・fixed は全部、alphabetic・symbolic は 1 以上、additive は 0 以上)
    const inRange =
      r.range === "auto"
        ? r.system === "alphabetic" || r.system === "symbolic"
          ? n >= 1
          : r.system === "additive"
            ? n >= 0
            : true
        : r.range.some(([a, b]) => n >= a && n <= b);
    if (!inRange) return this.viaFallback(r, n, depth);
    // 負の数は、負の数を使う書式 (symbolic・alphabetic・numeric・additive) では絶対値を表記して negative で囲む (§3.1.2)
    const usesNegative =
      n < 0 &&
      (r.system === "symbolic" ||
        r.system === "alphabetic" ||
        r.system === "numeric" ||
        r.system === "additive");
    const v = usesNegative ? -n : n;
    const initial = this.algorithm(r, v);
    if (initial === undefined) return this.viaFallback(r, n, depth);
    return this.padNegative(r, initial, usesNegative);
  }

  /** 詰め物 (§3.1.6): 字の数 (負の記号を含む) が足りなければ、前に pad の記号を足す。負の数は negative で囲む (§3.1.2) */
  private padNegative(
    r: Resolved,
    initial: string,
    usesNegative: boolean,
  ): string {
    const negLen = usesNegative
      ? [...r.negative[0]].length + [...r.negative[1]].length
      : 0;
    const short = r.pad[0] - ([...initial].length + negLen);
    const padded = short > 0 ? r.pad[1].repeat(short) + initial : initial;
    return usesNegative ? r.negative[0] + padded + r.negative[1] : padded;
  }

  /** 書式ごとの表記の作り方 (§3.1.1)。作れないときは undefined */
  private algorithm(r: Resolved, n: number): string | undefined {
    const s = r.symbols;
    const len = s.length;
    switch (r.system) {
      case "cyclic":
        return s[(((n - 1) % len) + len) % len];
      case "fixed":
        return n >= r.first && n < r.first + len ? s[n - r.first] : undefined;
      case "symbolic": {
        if (n < 1) return undefined;
        return s[(n - 1) % len].repeat(Math.ceil(n / len));
      }
      case "alphabetic": {
        if (n < 1) return undefined;
        let out = "";
        for (let x = n; x !== 0; ) {
          x--;
          out = s[x % len] + out;
          x = Math.floor(x / len);
        }
        return out;
      }
      case "numeric": {
        if (n === 0) return s[0];
        let out = "";
        for (let x = n; x !== 0; x = Math.floor(x / len))
          out = s[x % len] + out;
        return out;
      }
      case "additive": {
        if (n === 0) return r.additive.find(([w]) => w === 0)?.[1];
        let out = "";
        let x = n;
        for (const [w, sym] of r.additive) {
          if (w === 0 || w > x) continue;
          const reps = Math.floor(x / w);
          out += sym.repeat(reps);
          x -= w * reps;
          if (x === 0) break;
        }
        return x === 0 ? out : undefined;
      }
    }
  }
}

/** 文書で上書きできない書式の名前 (§2: decimal・disc・square・circle・disclosure-open・disclosure-closed) */
const UNOVERRIDABLE = new Set([
  "decimal",
  "disc",
  "square",
  "circle",
  "disclosure-open",
  "disclosure-closed",
]);
