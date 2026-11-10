/**
 * htmlPaged — CSS のうち、ブラウザが確定させない「ページの組版」の指定を、CSS の文字列から自前で読む。
 *
 *  - @page 規則 (名前・:first / :left / :right / :blank、size・margin・bleed・marks、余白の箱 @top-center など)
 *  - 一般の規則のうち、ブラウザが知らない値を持つ宣言 (string-set、position: running()、float: footnote、page、
 *    content の target-counter() / leader() / string() / element() / counter(page))。要素への当てはめは htmlImport で行う
 *  - content の値の字句解析
 */

import { parseSelectorList } from './cssSelector';
import { spotColor } from './color';
import { skipString, splitTop, splitWords, UNIT_PX } from './cssText';
import { MAX_COUNTER_LENGTH, parseCounterStyleRule, type CounterStyleRule } from './counterStyle';

/** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1)。PANTONE などの値は Kumiori は持たず、使う人が渡す */
export type SpotColors = Record<string, [number, number, number, number]>;

/** コメントを除く (文字列の中の / * は残す) */
function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const j = skipString(css, i);
      out += css.slice(i, j);
      i = j - 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 1;
    } else out += c;
  }
  return out;
}

/** '{' の次の位置 start から、対応する '}' の位置 (無ければ末尾) */
function matchBrace(s: string, start: number): number {
  let depth = 1;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'") k = skipString(s, k) - 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return k;
  }
  return s.length;
}

/** 宣言の並びを [名前, 値] にする (文字列・括弧の中の ; では分けない。!important は除く) */
export function splitDecls(body: string): Decl[] {
  const out: Decl[] = [];
  let cur = '';
  let paren = 0;
  const push = () => {
    const i = cur.indexOf(':');
    if (i > 0) {
      // カスタム プロパティ (--*) の名前は大文字・小文字を区別する (CSS Variables 1 §2)
      const n0 = cur.slice(0, i).trim();
      const name = n0.startsWith('--') ? n0 : n0.toLowerCase();
      const raw = cur.slice(i + 1);
      const important = /!\s*important\s*$/i.test(raw);
      const value = raw.replace(/!\s*important\s*$/i, '').trim();
      // 読めない値 (rgb-icc() などの色) は、前に同じ指定があれば使わない (ブラウザと同じく、読める前の値を使う)。
      // 特色の値が渡されたときのために、-kumiori-print-<性質> として残す
      if (/(?:\b(rgb-icc|device-cmyk|device-gray)|(?<![\w-])cmyk)\(/i.test(value) && out.some(([p]) => p === name)) out.push([`-kumiori-print-${name}`, value]);
      else out.push(important ? [name, value, true] : [name, value]);
    }
    cur = '';
  };
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '"' || c === "'") {
      const j = skipString(body, k);
      cur += body.slice(k, j);
      k = j - 1;
    } else if (c === '(') (paren++, (cur += c));
    else if (c === ')') (paren--, (cur += c));
    else if (c === ';' && paren <= 0) push();
    else cur += c;
  }
  push();
  return out;
}

export interface PageRule {
  /** 名前付きページの名前 (無ければ全ページ) */
  name?: string;
  /** first・left・right・blank */
  pseudos: string[];
  decls: Record<string, string>;
  /** 余白の箱 (top-center など) ごとの宣言 */
  boxes: Record<string, Record<string, string>>;
}

/** @font-face の 1 つ (src は url() の中身を並べたもの) */
export interface FontFaceRule {
  family: string;
  weight: number;
  italic: boolean;
  srcs: string[];
  /** unicode-range の範囲 (字の番号の [下, 上])。無ければすべての字 */
  ranges?: Array<[number, number]>;
}

/** 宣言の 1 つ: [性質, 値, !important] (splitDecls の形) */
export type Decl = [string, string, boolean?];

export interface StyleRule {
  selector: string;
  /**
   * 書いた順のすべての宣言 (規則の正の表現)。同じ性質の宣言が並ぶときも、それぞれの !important を持つ
   * (カスケードは、読めない後の宣言を捨てて前の宣言を使う。値の var() はそのまま: 要素ごとに置き換える)
   */
  list: Decl[];
  /**
   * list から導いた、性質ごとの最後の値 (根元の var() は置き換え済み。rootVars)。!important の区別は無い。
   * 規則の中身を性質の名前で引く簡単な読み方 (::footnote-call の規則など) 用。カスケードの勝ち負けには使わない
   */
  decls: Record<string, string>;
  /** カスケードの層 (@layer。Cascade 5 §6.4) の順位 (0 から。大きいほど強い: 先に現れた層ほど小さく、入れ子の層は親の直下より小さい。layerRanks)。層の無い規則は undefined */
  layer?: number;
}

/** parseCss の結果 (CSS の文字列 1 つ分) */
export interface ParsedCss {
  pages: PageRule[];
  rules: StyleRule[];
  fontFaces: FontFaceRule[];
  counterStyles: Map<string, CounterStyleRule>;
  /** 根元 (:root・html・*) の規則に書かれたカスタム プロパティ (自前で読む宣言の var() の置き換え用)。無ければ undefined */
  rootVars?: Record<string, string>;
}

/** 根元のカスタム プロパティで var() を置き換える (parseCss が decls に行うものと同じ。変数が無ければそのまま) */
export function substituteRootVars(v: string, rootVars: Record<string, string> | undefined): string {
  return rootVars && /var\(/i.test(v) ? resolveVars(v, rootVars) : v;
}

/**
 * 別々に読んだシートを、書いた順に 1 つにまとめる (規則・@page・@font-face は並べ、@counter-style は後のシートが勝つ)。
 * 層の順位と根元の変数はシートごとに決めたままなので、前のシートに @layer・カスタム プロパティ・var() が無いとき
 * (prepareHtml の既定のスタイル + 作成者スタイルシート) に、つなげた文字列を読んだ結果と同じになる
 */
export function concatCss(...sheets: ParsedCss[]): ParsedCss {
  const rootVars = sheets.reduce<Record<string, string> | undefined>((a, s) => (s.rootVars ? { ...a, ...s.rootVars } : a), undefined);
  return {
    pages: sheets.flatMap((s) => s.pages),
    rules: sheets.flatMap((s) => s.rules),
    fontFaces: sheets.flatMap((s) => s.fontFaces),
    counterStyles: new Map(sheets.flatMap((s) => [...s.counterStyles])),
    ...(rootVars ? { rootVars } : {}),
  };
}

/**
 * メディアクエリの並び (Media Queries 4) を、印刷の媒体として評価する。width・height などの媒体の特徴は、ページの箱の大きさ
 * (既定は A4 の 794×1123px) で見る。読めない条件は合わないものとする (§3.2)
 */
export function matchMedia(list: string, page = { width: 793.7, height: 1122.5 }): boolean {
  const q = list.trim().toLowerCase();
  if (!q) return true;
  const one = (m: string): boolean => {
    let s = m.trim();
    let neg = false;
    if (/^not\s/.test(s)) {
      neg = true;
      s = s.slice(4).trim();
    } else if (/^only\s/.test(s)) s = s.slice(5).trim();
    const parts = s.split(/\s+and\s+/);
    let ok = true;
    for (const part of parts) {
      const t = part.trim();
      if (!t) continue;
      if (/^[a-z-]+$/.test(t)) {
        // 媒体の種類
        if (!(t === 'all' || t === 'print')) ok = false;
        continue;
      }
      // 長さ → px (em・rem は既定の字の大きさ 16px)
      const px = (v: string) => {
        const m2 = /^(-?[\d.]+)(px|cm|mm|in|pt|pc|em|rem)?$/.exec(v.trim());
        if (!m2) return NaN;
        const u = m2[2] ?? 'px';
        return parseFloat(m2[1]) * (u === 'em' || u === 'rem' ? 16 : UNIT_PX[u]);
      };
      const dim = (key: string) => (key.includes('width') ? page.width : page.height);
      // 範囲の書き方 (Media Queries 4 §2.4.4): (width >= 600px)・(400px < width <= 800px)
      const range = /^\(\s*(?:([^<>=()]+?)\s*(<=|<|>=|>|=)\s*)?(width|height|device-width|device-height)\s*(<=|<|>=|>|=)?\s*([^<>=()]+?)?\s*\)$/.exec(t);
      if (range && (range[1] !== undefined || range[4] !== undefined)) {
        const d = dim(range[3]);
        const cmp = (a: number, op: string, b: number) => (op === '<' ? a < b : op === '<=' ? a <= b + 0.5 : op === '>' ? a > b : op === '>=' ? a >= b - 0.5 : Math.abs(a - b) <= 0.5);
        if (range[1] !== undefined) {
          const v = px(range[1]);
          if (Number.isNaN(v)) return false;
          if (!cmp(v, range[2], d)) ok = false;
        }
        if (range[4] !== undefined) {
          const v = px(range[5] ?? '');
          if (Number.isNaN(v)) return false;
          if (!cmp(d, range[4], v)) ok = false;
        }
        continue;
      }
      const f = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/.exec(t);
      if (!f) return false;
      const [, name, raw] = f;
      if (/^(min-|max-)?(device-)?(width|height)$/.test(name)) {
        if (raw === undefined) continue;
        const v = px(raw);
        if (Number.isNaN(v)) return false;
        const d = dim(name);
        if (name.startsWith('min-') ? d < v : name.startsWith('max-') ? d > v : Math.abs(d - v) > 0.5) ok = false;
      } else if (name === 'orientation') {
        if (raw !== undefined && raw.trim() !== (page.height >= page.width ? 'portrait' : 'landscape')) ok = false;
      } else if (name === 'color' || name === 'min-color' || name === 'grid' || name === 'scripting' || name === 'hover' || name === 'pointer') {
        // 印刷 (白黒とは限らない): color は合う。grid・scripting・hover・pointer は合わない (none)
        if (name === 'grid' || name === 'hover' || name === 'pointer') ok = ok && raw !== undefined && /^(0|none)$/.test(raw.trim());
        if (name === 'scripting') ok = ok && raw !== undefined && raw.trim() === 'none';
      } else return false;
    }
    return neg ? !ok : ok;
  };
  return q.split(',').some((m) => one(m));
}

/**
 * @supports の宣言 (prop: value) を読めるか。cssCascade が、知っている性質と値で判定する関数を入れる
 * (入れる前は、すべて読めるものとする)
 */
let supportsDecl: (prop: string, value: string) => boolean = () => true;
export function setSupportsDecl(f: (prop: string, value: string) => boolean) {
  supportsDecl = f;
}

/** @supports の条件 (Conditional 3 §6)。not・and・or を評価する。宣言は、読める性質と値のときだけ真 */
export function matchSupports(cond: string): boolean {
  const c = cond.trim();
  if (/^not\s/i.test(c)) return !matchSupports(c.slice(4));
  // 外側の括弧を外す
  if (c.startsWith('(') && c.endsWith(')')) {
    let depth = 0;
    let whole = true;
    for (let i = 0; i < c.length; i++) {
      if (c[i] === '(') depth++;
      else if (c[i] === ')') depth--;
      if (depth === 0 && i < c.length - 1) {
        whole = false;
        break;
      }
    }
    if (whole) return matchSupports(c.slice(1, -1));
  }
  const or = splitTopWord(c, 'or');
  if (or.length > 1) return or.some(matchSupports);
  const and = splitTopWord(c, 'and');
  if (and.length > 1) return and.every(matchSupports);
  // 宣言 (prop: value)
  const d = /^([-\w]+)\s*:\s*([\s\S]*)$/.exec(c);
  if (d) {
    const prop = d[1].startsWith('--') ? d[1] : d[1].toLowerCase();
    return prop.startsWith('--') || isPagedDecl(prop, d[2].trim()) || supportsDecl(prop, d[2].trim());
  }
  return true;
}
function splitTopWord(s: string, word: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  const re = new RegExp(`^\\s${word}\\s`, 'i');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && re.test(s.slice(i, i + word.length + 2))) {
      out.push(s.slice(last, i));
      last = i + word.length + 1;
    }
  }
  out.push(s.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * カスケードの層の順位 (Cascade 5 §6.4)。名前 (入れ子は a.b) の集まり (初めて現れた順) → 0 からの順位 (大きいほど強い)。
 * 入れ子の層は親の層の中に並び、親の層に直接書いた宣言は、その入れ子の層のどれよりも強い。
 * 層ごとに、親の中で現れた順の番号の並び (末尾は親自身を表す Infinity) を作り、辞書順に並べる:
 * a.x → [0, 0, ∞]、a.y → [0, 1, ∞]、a → [0, ∞]、b → [1, ∞] の順
 */
export function layerRanks(names: Iterable<string>): Map<string, number> {
  // 親 ('' は最上位) → 子の名前 (現れた順)。a.x だけが現れた a も層として数える
  const children = new Map<string, string[]>();
  const all = new Set<string>();
  for (const name of names) {
    const parts = name.split('.');
    for (let i = 1; i <= parts.length; i++) {
      const parent = parts.slice(0, i - 1).join('.');
      all.add(parts.slice(0, i).join('.'));
      const c = children.get(parent) ?? [];
      if (!c.includes(parts[i - 1])) c.push(parts[i - 1]);
      children.set(parent, c);
    }
  }
  const keyOf = (name: string) => {
    const parts = name.split('.');
    return [...parts.map((p, i) => children.get(parts.slice(0, i).join('.'))!.indexOf(p)), Infinity];
  };
  const sorted = [...all].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      const d = ka[i] - kb[i];
      if (d) return d;
    }
    return 0;
  });
  return new Map(sorted.map((n, i) => [n, i]));
}

/** CSS の規則を読む。@media は印刷の媒体として条件を評価する (matchMedia)。@supports・@layer の中も読む */
export function parseCss(css: string): ParsedCss {
  const pages: PageRule[] = [];
  const fontFaces: FontFaceRule[] = [];
  const counterStyles = new Map<string, CounterStyleRule>();
  const rules: StyleRule[] = [];
  // カスケードの層 (Cascade 5 §6.4): 名前 (入れ子は a.b)。初めて現れた順 (@layer a, b; の文も含む)。
  // 順位は、すべて読んだ後に layerRanks で決める (後から現れる入れ子の層 (a.x) も、親 (a) の中に並べるため)。層の規則は layered に集める
  const layers = new Set<string>();
  const layered: Array<[StyleRule, string]> = [];
  let anonLayers = 0;
  let curLayer: string | undefined;
  const layerOf = (name: string) => layers.add(name);
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = nextBraceOrSemi(text, i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      if (text[open] === ';') {
        // @layer a, b; は層の順だけを決める。ほか (@import / @charset) は読まない
        if (/^@layer\b/i.test(head)) for (const n of head.slice(6).split(',').map((x) => x.trim()).filter(Boolean)) layerOf(curLayer ? `${curLayer}.${n}` : n);
        i = open + 1;
        continue;
      }
      const close = matchBrace(text, open + 1);
      const body = text.slice(open + 1, close);
      i = close + 1;
      if (/^@media\b/i.test(head)) {
        if (matchMedia(head.slice(6))) walk(body);
      }
      // @page のセレクタの並び (Page 3 §4.3: <page-selector-list> = <page-selector>#) は、セレクタごとに同じ宣言の規則にする
      else if (/^@page\b/i.test(head)) {
        const sels = head.slice(5).split(',').map((x) => x.trim());
        for (const sel of sels.length ? sels : ['']) pages.push(parsePageBody(sel, body));
      }
      else if (/^@supports\b/i.test(head)) {
        if (matchSupports(head.slice(9))) walk(body);
      }
      // @layer の塊: 中の規則を、その層の規則として読む (名前の無い層は、それぞれ別の層)
      else if (/^@layer\b/i.test(head)) {
        const n = head.slice(6).trim() || `\0anon${anonLayers++}`;
        const saved = curLayer;
        curLayer = saved ? `${saved}.${n}` : n;
        layerOf(curLayer);
        walk(body);
        curLayer = saved;
      }
      // @counter-style (Counter Styles 3 §3): 同じ名前の規則は後のものが勝つ。none は名前にできない
      else if (/^@counter-style\s/i.test(head)) {
        const name = head.slice(14).trim();
        if (name && !/^none$/i.test(name)) counterStyles.set(name, parseCounterStyleRule(splitDecls(body.replace(/\/\*[\s\S]*?\*\//g, '')).map(([k, v]) => [k, v])));
      } else if (/^@font-face\b/i.test(head)) {
        const d = Object.fromEntries(splitDecls(body));
        const family = unquote(d['font-family'] ?? '');
        const w = (d['font-weight'] ?? 'normal').toLowerCase();
        const srcs = [...(d.src ?? '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
        // font-weight は 1 つの値か範囲 (可変の書体。Fonts 4 §4.4)。範囲は 400 を含めば 400、含まなければ下の端で登録する
        const ws = String(w).split(/\s+/).map((x: string) => (x === 'bold' ? 700 : x === 'normal' ? 400 : parseInt(x, 10) || 400));
        const weight = ws.length > 1 ? (ws[0] <= 400 && 400 <= ws[1] ? 400 : ws[0]) : ws[0];
        // unicode-range (Fonts 4 §4.5): U+0-7F・U+4??・U+0025-00FF の並び
        const ranges = String(d['unicode-range'] ?? '')
          .split(',')
          .map((r: string) => r.trim().replace(/^u\+/i, ''))
          .filter(Boolean)
          .map((r: string): [number, number] | undefined => {
            if (/\?/.test(r)) return [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)];
            const [a, b] = r.split('-').map((x: string) => parseInt(x.replace(/^u\+/i, ''), 16));
            return Number.isFinite(a) ? [a, Number.isFinite(b) ? b : a] : undefined;
          })
          .filter((x): x is [number, number] => !!x);
        if (family && srcs.length)
          fontFaces.push({ family, weight, italic: /italic|oblique/i.test(d['font-style'] ?? ''), srcs, ...(ranges.length ? { ranges } : {}) });
      }
      else if (!head.startsWith('@') && head) styleRule(splitTop(head, ','), body);
    }
  };
  /**
   * 規則 (CSS の入れ子を含む)。中の規則のセレクタは、& を親のセレクタに置き換え、& が無ければ親の子孫にする。
   * 中の規則を除いた宣言が、この規則の宣言
   */
  function styleRule(selectors: string[], body: string) {
    // セレクタの並びに読めないものが 1 つでもあれば、規則ごと捨てる (Selectors 4 §3.9)。& を含む入れ子のものは置き換えてから調べる
    if (selectors.some((sel) => !sel.includes('&') && !parseSelectorList(sel).length)) return;
    let rest = '';
    let i = 0;
    // 中の規則は、この規則の宣言の後に並べる (同じ詳細度なら、中の規則が勝つ)
    const later: Array<() => void> = [];
    while (i < body.length) {
      const open = nextNested(body, i);
      if (open < 0) {
        rest += body.slice(i);
        break;
      }
      // { の前の、直前の ; または } の後から { までが、中の規則のセレクタ
      const semi = Math.max(body.lastIndexOf(';', open), body.lastIndexOf('}', open));
      const start = Math.max(semi + 1, i);
      rest += body.slice(i, start);
      const head = body.slice(start, open).trim();
      const close = matchBrace(body, open + 1);
      const inner = body.slice(open + 1, close);
      i = close + 1;
      // 入れ子の @media・@supports (CSS Nesting 1 §3.2): 条件に合えば、中の宣言と規則を、この規則のセレクタに当てる
      if (/^@media\b/i.test(head)) {
        if (matchMedia(head.slice(6))) later.push(() => styleRule(selectors, inner));
        continue;
      }
      if (/^@supports\b/i.test(head)) {
        if (matchSupports(head.slice(9))) later.push(() => styleRule(selectors, inner));
        continue;
      }
      if (head.startsWith('@')) continue; // ほかの入れ子の @ 規則は読まない
      const nested = splitTop(head, ',');
      const full = selectors.flatMap((p) => nested.map((n) => (n.includes('&') ? n.replace(/&/g, p) : `${p} ${n}`)));
      later.push(() => styleRule(full, inner));
    }
    const pairs = splitDecls(rest);
    // decls は list から導く (性質ごとの最後の値)
    const decls = Object.fromEntries(pairs.map(([k, v]) => [k, v]));
    if (curLayer !== undefined) layerOf(curLayer);
    if (Object.keys(decls).length)
      for (const sel of selectors) {
        const r: StyleRule = { selector: sel, list: pairs, decls };
        if (curLayer !== undefined) layered.push([r, curLayer]);
        rules.push(r);
      }
    for (const f of later) f();
  }
  walk(stripComments(css));
  // CSS の変数 (:root・html に書いた --名前) を、自前で読む宣言 (decls・@page) の中で展開する (var(--名前, 既定値))。
  // list は展開しない (カスケードが要素ごとに置き換える)
  const vars: Record<string, string> = {};
  for (const r of rules) if (/^(:root|html|\*)$/i.test(r.selector.trim())) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) vars[k] = v;
  const rootVars = Object.keys(vars).length ? vars : undefined;
  if (rootVars) {
    const sub = (d: Record<string, string>) => {
      for (const k of Object.keys(d)) d[k] = substituteRootVars(d[k], rootVars);
    };
    for (const pg of pages) {
      sub(pg.decls);
      for (const b of Object.values(pg.boxes)) sub(b);
    }
    for (const r of rules) sub(r.decls);
  }
  const ranks = layerRanks(layers);
  for (const [r, name] of layered) r.layer = ranks.get(name);
  return { pages, rules, fontFaces, counterStyles, ...(rootVars ? { rootVars } : {}) };
}

/**
 * var() を置き換えた値の長さの上限 (字の数)。CSS Variables 1 §3.3「Safely Handling Overly-Long Variables」: 変数を何重にも参照して
 * 値を指数的に膨らませる攻撃を避けるため、実装は var() の展開後の長さに上限を置かなければならず、超える var() は、その宣言を
 * 計算値の時点で無効にする。数は実装が決める。Chromium の上限 (2097152 バイト) と同じにする (data URI を入れた変数も収まる)
 */
export const MAX_VAR_LENGTH = 2 * 1024 * 1024;

/**
 * var(--名前, 既定値) を、変数の値に置き換える (変数の中の var() も、深さ 10 まで)。
 * 置き換えた値の長さの合計 (と置き換えの回数) が上限 (MAX_VAR_LENGTH) を超えたら、宣言を無効として空の値を返す
 * (未定義の変数だけの値と同じ扱い。Variables 1 §3.3)。budget は、入れ子の置き換えで共有する残りの長さ
 */
export function resolveVars(v: string, vars: Record<string, string>, depth = 0, budget: { left: number } = { left: MAX_VAR_LENGTH }): string {
  if (depth > 10) return v;
  const out = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_m, name: string, fb: string | undefined) => {
    if (budget.left < 0) return '';
    const val = vars[name] ?? fb ?? '';
    // 空の値の置き換えも 1 と数える (長さが増えない置き換えを、指数的な回数だけ繰り返させない)
    budget.left -= val.length + 1;
    if (budget.left < 0) return '';
    return /var\(/.test(val) ? resolveVars(val, vars, depth + 1, budget) : val;
  });
  return budget.left < 0 ? '' : out;
}

/** 宣言の並びの中の、入れ子の規則の { の位置 (文字列・括弧の中は除く)。無ければ -1 */
function nextNested(s: string, from: number): number {
  let paren = 0;
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'") k = skipString(s, k) - 1;
    else if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{' && paren <= 0) return k;
  }
  return -1;
}

function nextBraceOrSemi(s: string, from: number): number {
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'") k = skipString(s, k) - 1;
    else if (c === '{') return k;
    // ; は @規則の文 (@layer a; @import …;) の終わり。規則の間の迷子の ; (b{} ; p{…}) も区切りとして読み飛ばす (p の規則を落とさない)
    else if (c === ';' && /^(@|$)/.test(s.slice(from, k).trim())) return k;
  }
  return -1;
}

function parsePageBody(sel: string, body: string): PageRule {
  const m = /^([a-z_][\w-]*)?((?::[a-z-]+)*)\s*$/i.exec(sel.trim());
  const rule: PageRule = { pseudos: [], decls: {}, boxes: {} };
  if (m) {
    if (m[1]) rule.name = m[1];
    rule.pseudos = (m[2] ?? '').split(':').filter(Boolean).map((p) => p.toLowerCase());
  } else rule.pseudos = ['unknown'];
  // 入れ子の余白の箱を取り出し、残りを宣言として読む
  let rest = '';
  let i = 0;
  const re = /@([a-z-]+)\s*\{/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(body))) {
    rest += body.slice(i, mm.index);
    const close = matchBrace(body, re.lastIndex);
    rule.boxes[mm[1].toLowerCase()] = Object.fromEntries(splitDecls(body.slice(re.lastIndex, close)));
    i = close + 1;
    re.lastIndex = i;
  }
  rest += body.slice(i);
  rule.decls = Object.fromEntries(splitDecls(rest));
  return rule;
}

/** ページの選び方 (名前・先頭・左右・白) */
export interface PageSelect {
  name?: string;
  first?: boolean;
  side?: 'left' | 'right';
  blank?: boolean;
  /** 名前の無い :first は、文書の先頭のページ (最初のシーケンス) だけに当てる */
  firstSequence?: boolean;
}

/**
 * @page の論理的な余白 (margin-block・margin-inline とその -start / -end。Logical 1 §4.2) を写す物理の辺。
 * ページの書字方向 (根元の要素の writing-mode・direction) で決める。2 値の一括指定は [start, end] の 2 辺
 */
function pageMarginSides(prop: string, wm: string, dir: string): Array<'top' | 'right' | 'bottom' | 'left'> | undefined {
  const m = /^margin-(block|inline)(?:-(start|end))?$/.exec(prop);
  if (!m) return undefined;
  const vertical = /^vertical|^tb|^sideways/.test(wm);
  const rl = wm === 'vertical-rl' || wm === 'tb-rl' || wm === 'tb' || wm === 'sideways-rl';
  const side = (edge: string): 'top' | 'right' | 'bottom' | 'left' => {
    const start = edge === 'start';
    if (m[1] === 'block') return vertical ? (start === rl ? 'right' : 'left') : start ? 'top' : 'bottom';
    // sideways-lr は行が下から上へ進む (inline-start が下)
    return vertical ? (start !== (dir === 'rtl') !== (wm === 'sideways-lr') ? 'top' : 'bottom') : start !== (dir === 'rtl') ? 'left' : 'right';
  };
  return m[2] ? [side(m[2])] : [side('start'), side('end')];
}

/**
 * ページに当てはまる @page 規則を、詳細度 (名前 > :first・:blank > :left・:right) と出現順で重ねる。
 * wm・dir はページの書字方向と向き (論理的な余白を物理の辺に写す基準。省略は横書き・左から右)
 */
export function resolvePageRules(pages: PageRule[], sel: PageSelect, wm = 'horizontal-tb', dir = 'ltr'): { decls: Record<string, string>; boxes: Record<string, Record<string, string>> } {
  const spec = (r: PageRule) => (r.name ? 100 : 0) + r.pseudos.reduce((a, p) => a + (p === 'first' || p === 'blank' ? 10 : 1), 0);
  const matched = pages.filter((r) => {
    if (r.name && r.name !== sel.name) return false;
    return r.pseudos.every((p) =>
      p === 'first' ? !!sel.first && (!!r.name || sel.firstSequence !== false) : p === 'left' || p === 'right' ? sel.side === p : p === 'blank' ? !!sel.blank : false,
    );
  });
  const sorted = matched.map((r, k) => ({ r, k })).sort((a, b) => spec(a.r) - spec(b.r) || a.k - b.k);
  const decls: Record<string, string> = {};
  const boxes: Record<string, Record<string, string>> = {};
  for (const { r } of sorted) {
    // margin の一括指定は、個別の性質に分けてから重ねる (後の規則の margin が、前の規則の margin-top を上書きする)
    for (const [k, v] of Object.entries(r.decls)) {
      if (k === 'margin') {
        const [t, rr = t, b = t, l = rr] = splitWords(v);
        Object.assign(decls, { 'margin-top': t, 'margin-right': rr, 'margin-bottom': b, 'margin-left': l });
      } else {
        // 論理的な余白 (margin-block: 3cm 2cm など) も、物理の辺に分けて重ねる (後の規則の margin-top と正しく上書きし合う)
        const sides = pageMarginSides(k, wm, dir);
        if (sides) {
          const ws = splitWords(v);
          sides.forEach((sd, n) => (decls[`margin-${sd}`] = ws[n] ?? ws[0]));
        } else decls[k] = v;
      }
    }
    for (const [b, d] of Object.entries(r.boxes)) boxes[b] = { ...boxes[b], ...d };
  }
  return { decls, boxes };
}

export type ContentToken = { kind: 'str'; v: string } | { kind: 'fn'; name: string; args: string[] } | { kind: 'ident'; v: string };

/** content (や string-set の値) を字句に分ける */
export function parseContent(v: string): ContentToken[] {
  const out: ContentToken[] = [];
  let k = 0;
  while (k < v.length) {
    const c = v[k];
    if (/\s/.test(c)) {
      k++;
    } else if (c === '"' || c === "'") {
      const j = skipString(v, k);
      out.push({ kind: 'str', v: unescapeCss(v.slice(k + 1, j - 1)) });
      k = j;
    } else {
      const m = /^[a-z_-][\w-]*/i.exec(v.slice(k));
      if (!m) {
        k++;
        continue;
      }
      k += m[0].length;
      if (v[k] === '(') {
        // 対応する ) まで (入れ子の括弧・文字列を含む)
        let depth = 1;
        let j = k + 1;
        for (; j < v.length && depth > 0; j++) {
          if (v[j] === '"' || v[j] === "'") j = skipString(v, j) - 1;
          else if (v[j] === '(') depth++;
          else if (v[j] === ')') depth--;
        }
        out.push({ kind: 'fn', name: m[0].toLowerCase(), args: splitTop(v.slice(k + 1, j - 1), ',') });
        k = j;
      } else out.push({ kind: 'ident', v: m[0] }); // 名前 (string-set の名前など) は大文字・小文字を区別する
    }
  }
  return out;
}

/** 16 進の逃がしの字。0・サロゲート・0x10FFFF を超える値は U+FFFD (CSS Syntax 3 §4.3.7 consume an escaped code point) */
export function cssCodePoint(hex: string): string {
  const cp = parseInt(hex, 16);
  return String.fromCodePoint(cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? 0xfffd : cp);
}

/** CSS の文字列のエスケープを戻す (\a は改行、\XXXX は文字) */
export function unescapeCss(s: string): string {
  return s.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_m, hex: string | undefined, ch: string | undefined) => (hex ? cssCodePoint(hex) : (ch ?? '')));
}

/**
 * 印刷の色 → Kumiori の色 (#rrggbb / cmyk(c,m,y,k))。読めなければ undefined
 *  - device-cmyk(c m y k) (CSS Color 5)・cmyk(c, m, y, k) (アンテナハウスの書き方。値は device-cmyk と同じ)
 *  - rgb-icc(r, g, b, #CMYK, c, m, y, k) / rgb-icc(#CMYK, …) (アンテナハウス): CMYK
 *  - rgb-icc(…, #Grayscale, g): グレースケール (g = 0 が黒、1 が白。gray(g)。PDF では DeviceGray)
 *  - rgb-icc(r, g, b, #Separation, '名前', 濃度): 特色。その名前の値 (spots) があれば特色 (spot(…)) にする。
 *    無ければ、代わりの RGB を濃度で薄めた色 (RGB が無ければ墨の濃度)
 */
export function printColor(v: string, spots?: SpotColors): string | undefined {
  const num = (t: string) => (t.trim().endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
  let m = /(?:device-|(?<![\w-]))cmyk\(([^)]*)\)/i.exec(v);
  if (m) {
    const p = m[1].split('/')[0].split(/[\s,]+/).filter(Boolean).map(num);
    if (p.length >= 4) return `cmyk(${p.slice(0, 4).join(',')})`;
  }
  m = /rgb-icc\(([^)]*)\)/i.exec(v);
  if (!m) return undefined;
  // 引数は位置で読むので、空の引数も残す
  const args = splitTop(m[1], ',', { keepEmpty: true });
  const k = args.findIndex((a) => a.startsWith('#'));
  const rgbArgs = k > 0 ? args.slice(0, k).map((a) => parseFloat(a)) : [];
  const kind = (k >= 0 ? args[k] : '').toLowerCase();
  const rest = k >= 0 ? args.slice(k + 1) : [];
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;
  if (kind === '#cmyk' && rest.length >= 4) return `cmyk(${rest.slice(0, 4).map(num).join(',')})`;
  if (kind === '#grayscale' && rest.length >= 1) return `gray(${num(rest[0])})`;
  if (kind === '#separation' || kind === '#registration') {
    // 特色の名前 (引用符で囲む) と濃度 (省くと 1)
    const quoted = rest.length && /^["']/.test(rest[0].trim());
    const tint = rest.length > (quoted ? 1 : 0) ? num(rest[rest.length - 1]) : 1;
    const t = Number.isFinite(tint) ? tint : 1;
    // 特色の値 (使う人が渡したもの) があれば、特色 (PDF の Separation) にする
    const name = kind === '#separation' && quoted ? unquote(rest[0].trim().replace(/^["']|["']$/g, '')) : undefined;
    const sp = name !== undefined ? spots?.[name] : undefined;
    if (name !== undefined && sp) return spotColor(name, t, sp);
    if (rgbArgs.length >= 3) return hex(...(rgbArgs.map((c) => 255 - t * (255 - c)) as [number, number, number]));
    return `cmyk(0,0,0,${t})`;
  }
  return rgbArgs.length >= 3 ? hex(rgbArgs[0], rgbArgs[1], rgbArgs[2]) : undefined;
}

/** 引用符を外す (引用符が無ければそのまま) */
export function unquote(s: string): string {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? unescapeCss(t.slice(1, -1)) : t;
}

/**
 * アンテナハウスの拡張 (-ah-) のうち、標準の指定に読み替えるもの。値も読み替える
 *  -ah-text-autospace: none → no-autospace、それ以外 (ideograph-alpha など) → normal
 *  -ah-punctuation-trim: none → space-all、start と行末の指定 (end・allow-end・end-except-fullstop) → trim-both、start だけ → trim-start、
 *    それ以外 (adjacent だけなど) → normal
 *  -ah-text-autospace-width: 和欧間のアキの大きさ (そのまま)
 */
/** -ah-punctuation-trim の値 (start・end・allow-end・end-except-fullstop・adjacent・all・none の組) を text-spacing-trim に読み替える */
function ahPunctuationTrim(v: string): string {
  const t = v.trim().toLowerCase().split(/\s+/);
  if (t.includes('none')) return 'space-all';
  if (t.includes('all')) return 'trim-all';
  const start = t.includes('start');
  const end = t.some((x) => x === 'end' || x === 'allow-end' || x === 'end-except-fullstop');
  return start && end ? 'trim-both' : start ? 'trim-start' : 'normal';
}

export const AH_ALIASES: Record<string, { prop: string; value: (v: string) => string }> = {
  '-ah-text-autospace': { prop: 'text-autospace', value: (v) => (/^none$/i.test(v.trim()) ? 'no-autospace' : 'normal') },
  '-ah-hanging-punctuation': { prop: 'hanging-punctuation', value: (v) => v },
  '-ah-line-height-shift-adjustment': { prop: 'line-height-shift-adjustment', value: (v) => v.trim().toLowerCase() },
  // XSL の line-stacking-strategy (§7.16.6。font-height は、どの行もブロックの字の高さと半行間で同じ高さにする。継承する)
  '-ah-line-stacking-strategy': { prop: 'line-stacking-strategy', value: (v) => v.trim().toLowerCase() },
  '-ah-image-resolution': { prop: 'image-resolution', value: (v) => v },
  '-ah-punctuation-trim': { prop: 'text-spacing-trim', value: ahPunctuationTrim },
  '-ah-text-autospace-width': { prop: 'text-autospace-width', value: (v) => v.trim().toLowerCase() },
  // XSL の linefeed-treatment (§7.16.7。ignore は改行を捨てる。継承する)
  '-ah-linefeed-treatment': { prop: 'linefeed-treatment', value: (v) => v.trim().toLowerCase() },
};

/** 宣言のうち、ブラウザが確定させない (知らない) 値を持つもの。要素に当てはめて読む */
export function isPagedDecl(prop: string, value: string): boolean {
  if (prop === 'string-set' || prop === 'page' || prop === 'bookmark-level' || prop === 'bookmark-label' || prop === 'bookmark-state') return true;
  // アンテナハウスの拡張の長さの単位 gr (段組の段・段の間の幅。float: multicol の幅) は、ブラウザが読めないので自前で読む
  if (prop === 'width' && /\dgr\b/i.test(value)) return true;
  if (prop === 'position') return /running\(/i.test(value);
  // float は left / right / none 以外 (footnote・アンテナハウスの top / bottom / center / alternate など) を自前で読む
  if (prop === 'float') return !/^(left|right|none|inline-start|inline-end)$/i.test(value.trim());
  // 和文組版の指定 (ブラウザによっては知らない。継承するので、祖先をたどって読む)
  if (prop === 'text-autospace' || prop === 'text-spacing-trim' || prop === 'text-spacing' || prop === 'hanging-punctuation') return true;
  // ブラウザが読めない色 (印刷の CMYK・特色)
  if ((prop === 'color' || prop === 'background-color' || prop === 'background') && /(?:\b(device-cmyk|rgb-icc)|(?<![\w-])cmyk)\(/i.test(value)) return true;
  // 罫線の印刷の色 (border・border-color・border-<辺>・border-<辺>-color)
  if (/^border(-(top|right|bottom|left))?(-color)?$/.test(prop) && /(?:\b(device-cmyk|rgb-icc)|(?<![\w-])cmyk)\(/i.test(value)) return true;
  if (AH_ALIASES[prop] || prop === 'image-resolution' || prop === 'line-height-shift-adjustment') return true;
  // アンテナハウスの画像の中身の大きさ (fo の content-width / content-height と同じ)
  if (prop === '-ah-content-width' || prop === '-ah-content-height') return true;
  // アンテナハウスの行グリッド
  if (prop === '-ah-baseline-grid') return true;
  // アンテナハウスの -ah-display-align (XSL 1.1 §7.14.4 の display-align: 高さの決まった箱の中での内容の上下の揃え)
  if (prop === '-ah-display-align') return true;
  // アンテナハウスの段間罫の長さ・揃え・表示
  if (prop === '-ah-column-rule-length' || prop === '-ah-column-rule-align' || prop === '-ah-column-rule-display') return true;
  // 行の中の揃え (CSS Inline 3 の alignment-baseline・アンテナハウスの -ah-alignment-baseline)
  if (prop === 'alignment-baseline' || prop === '-ah-alignment-baseline') return true;
  // 前の値に隠れた印刷の色 (特色の値が渡されたときに使う)
  if (prop.startsWith('-kumiori-print-')) return true;
  if (prop === 'text-combine-upright') return /digits/i.test(value);
  if (prop === 'content') return /(target-counter|target-text|leader|string|element)\(|counter\(\s*pages?\s*[,)]/i.test(value);
  return false;
}

/**
 * counter() の書式 (list-style-type) で数を文字にする。書式の範囲の外の数は、fallback の decimal で表す
 * (Counter Styles 3 §2 の手順 2・§3.5 の range・§3.7 の fallback。定義済みの書式の範囲は §6.1・§6.2):
 * lower-roman・upper-roman は 1〜3999、lower-alpha・upper-alpha (alphabetic) は 1 以上、cjk-decimal は 0 以上。
 * 範囲に限りの無い numeric (decimal-leading-zero・full-width-decimal) の負の数は、絶対値の表記の前に負の符号 (-) を付ける (§2 の手順 3・5)
 */
export function counterText(type: string, n: number): string {
  const inRange = (min: number, max = Infinity) => Number.isInteger(n) && n >= min && n <= max;
  switch (type) {
    case 'lower-alpha':
    case 'lower-latin':
    case 'upper-alpha':
    case 'upper-latin':
      if (!inRange(1)) return String(n);
      break;
    case 'lower-roman':
    case 'upper-roman':
      if (!inRange(1, 3999)) return String(n);
      break;
    case 'cjk-decimal':
      if (!inRange(0)) return String(n);
      break;
    case 'full-width-decimal':
      if (n < 0) return `-${counterText(type, -n)}`;
      break;
  }
  const alpha = (k: number, upper: boolean) => {
    let s = '';
    for (let x = k; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(((x - 1) % 26) + (upper ? 65 : 97)) + s;
    return s;
  };
  const roman = (k: number) => {
    const t: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    // 千の位の m を並べた表記が長すぎる数は、10 進で書く (Counter Styles 3 §2: 長すぎる表記は代わりの書式にしてよい。MAX_COUNTER_LENGTH)
    if (k / 1000 > MAX_COUNTER_LENGTH - 12) return String(k);
    let s = '';
    let x = k;
    for (const [v, r] of t) while (x >= v) (s += r), (x -= v);
    return s;
  };
  switch (type) {
    case 'none':
      return '';
    case 'disc':
      return '•';
    case 'circle':
      return '◦';
    case 'square':
      return '▪';
    // 開閉の印 (Counter Styles 3 §6.3 の例の字。左から右への書字の向き)
    case 'disclosure-open':
      return '▾';
    case 'disclosure-closed':
      return '▸';
    case 'decimal-leading-zero':
      return String(n).padStart(2, '0');
    case 'lower-alpha':
    case 'lower-latin':
      return alpha(n, false);
    case 'upper-alpha':
    case 'upper-latin':
      return alpha(n, true);
    case 'lower-roman':
      return roman(n);
    case 'upper-roman':
      return roman(n).toUpperCase();
    case 'cjk-decimal':
      return [...String(n)].map((d) => '〇一二三四五六七八九'[+d]).join('');
    case 'full-width-decimal':
      return [...String(n)].map((d) => '０１２３４５６７８９'[+d]).join('');
    default:
      return String(n);
  }
}

/** counter(page, 書式) の書式 → Kumiori のページ番号の書式 (pageNumberFormat) */
export function pageNumberFormatOf(type: string | undefined): string | undefined {
  switch (type) {
    case 'lower-roman':
      return 'i';
    case 'upper-roman':
      return 'I';
    case 'lower-alpha':
    case 'lower-latin':
      return 'a';
    case 'upper-alpha':
    case 'upper-latin':
      return 'A';
    case 'decimal-leading-zero':
      return '01';
    case 'cjk-decimal':
      return '一';
    case 'full-width-decimal':
      return '１';
    default:
      return undefined;
  }
}
