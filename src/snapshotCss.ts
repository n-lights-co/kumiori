/**
 * snapshotCss — snapshotDocument (snapshot.ts) が使う、DOM の要らない CSS の文字の書き換え。
 *  - rewriteCssUrls: CSS の中の URL (url(…)・@import の文字列・image-set() の文字列) を、渡した関数で書き換える
 *  - mapStyleRuleSelectors: スタイルの規則のセレクタを、渡した関数で書き換える (条件付きの規則 @media などの中も)
 *  - scopeSelectorList: 影の木 (Shadow DOM) のスタイルのセレクタを、属性で囲って、その影の木の中だけに当たるようにする
 *  - renameTypeSelector: セレクタの中の型セレクタ (要素の名前) を、別のセレクタに置き換える
 *  - ruleDiff: 規則の文字の並びの差 (足された規則と、消された規則の数)
 * どれも CSS Syntax 3 §4 の字句の分け方 (注釈・文字列・括弧) に沿って、入力の長さに比例した手間で読む。
 */

/** 注釈・文字列・括弧を読み飛ばしながら、css の i から、stop のどれかの字 (括弧と文字列の外) の位置を探す。無ければ css.length */
function scanTo(css: string, i: number, stop: string): number {
  let depth = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = stringEnd(css, i);
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (depth === 0 && stop.includes(c)) return i;
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    i++;
  }
  return css.length;
}

/** css の i (引用符) から始まる文字列の終わりの次の位置 (CSS Syntax 3 §4.3.5。改行で終わる文字列も、そこで終える) */
function stringEnd(css: string, i: number): number {
  const q = css[i];
  let j = i + 1;
  while (j < css.length) {
    const c = css[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (c === '\n') return j;
    else j++;
  }
  return css.length;
}

/** { の位置 open に対する } の次の位置 (無ければ css.length) */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = stringEnd(css, i);
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

const isIdent = (c: string | undefined) => !!c && /[\w-]/.test(c);
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * CSS の文字の中の URL を、resolve の返す値に書き換える。resolve が undefined を返したものは、そのまま残す。
 *  - url(…) (引用符の無い形と、url("…") の文字列の形。CSS Values 4 §4.5)
 *  - @import の後の文字列 (CSS Cascade 5 §2)
 *  - image-set() の引数の文字列 (CSS Images 4 §2.2。文字列は URL として読む)
 * 逆斜線の入った URL は、書いたとおりに解くのが難しいので書き換えない。書き換えた値は、引用符の形で書く (中の " と \ と改行はエスケープする)
 */
export function rewriteCssUrls(css: string, resolve: (url: string) => string | undefined): string {
  let out = '';
  let last = 0;
  // 括弧の中の関数の名前 (image-set の引数の文字列を見分ける)
  const fns: string[] = [];
  let i = 0;
  const put = (from: number, to: number, url: string) => {
    const r = resolve(url);
    if (r === undefined || r === url) return;
    out += css.slice(last, from) + quoteCss(r);
    last = to;
  };
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(css, i);
      const body = css.slice(i + 1, css[end - 1] === c && end - 1 > i ? end - 1 : end);
      if (!body.includes('\\')) {
        const before = css.slice(Math.max(0, i - 64), i).replace(/\s+$/, '');
        const top = fns[fns.length - 1];
        if (/@import$/i.test(before)) put(i, end, body);
        else if (top && /^(-webkit-)?image-set$/i.test(top) && /[(,]$/.test(before)) put(i, end, body);
      }
      i = end;
      continue;
    }
    if (c === '(') {
      let s = i;
      while (s > 0 && isIdent(css[s - 1])) s--;
      const name = css.slice(s, i).toLowerCase();
      if (name === 'url' && !isIdent(css[s - 1] ?? '')) {
        // url( の後: 空白を飛ばして、引用符なら文字列の形 (上の文字列の扱いで、関数の名前 url を見て書き換える)
        let j = i + 1;
        while (isSpace(css[j])) j++;
        if (css[j] === '"' || css[j] === "'") {
          const end = stringEnd(css, j);
          const body = css.slice(j + 1, css[end - 1] === css[j] && end - 1 > j ? end - 1 : end);
          let k = end;
          while (isSpace(css[k])) k++;
          if (css[k] === ')') {
            if (!body.includes('\\')) put(s, k + 1, body);
            i = k + 1;
            continue;
          }
          fns.push(name);
          i++;
          continue;
        }
        // 引用符の無い url(…) (CSS Syntax 3 §4.3.6: 空白・引用符・括弧の入らない並びで、) で終わる)
        let k = j;
        while (k < css.length && css[k] !== ')' && css[k] !== '"' && css[k] !== "'" && css[k] !== '(' && css[k] !== '\\' && !isSpace(css[k])) k++;
        let e = k;
        while (isSpace(css[e])) e++;
        if (css[e] === ')') {
          if (k > j) put(s, e + 1, css.slice(j, k));
          i = e + 1;
          continue;
        }
        fns.push(name);
        i++;
        continue;
      }
      fns.push(name);
      i++;
      continue;
    }
    if (c === ')') fns.pop();
    i++;
  }
  return last === 0 ? css : out + css.slice(last);
}

/** CSS の url("…") の形に書く */
export function quoteCss(url: string): string {
  return `url("${url.replace(/[\\"]/g, (m) => `\\${m}`).replace(/\n/g, '\\a ')}")`;
}

/** 中の規則をたどる条件付きの規則 (CSS Conditional 3 §2・CSS Cascade 5 §6.4 の @layer の塊・CSS Containment 3 の @container) */
const GROUP_RULE = /^@(media|supports|layer|container|document|-moz-document|starting-style)\b/i;

/**
 * スタイルシートの文字の、スタイルの規則のセレクタを、map の返す値に書き換える (map が undefined を返した規則は、そのまま)。
 * 条件付きの規則 (@media・@supports・@layer・@container) の中の規則もたどる。ほかの @ 規則 (@font-face・@keyframes・@page など) と、
 * 入れ子の規則 (CSS Nesting。親の規則のセレクタに対して当たるので、親を書き換えれば足りる) は、そのまま
 */
export function mapStyleRuleSelectors(css: string, map: (selector: string) => string | undefined): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const stop = scanTo(css, i, '{;}');
    if (stop >= css.length) {
      out += css.slice(i);
      break;
    }
    if (css[stop] !== '{') {
      // ; で終わる @ 規則 (@import など) と、対の無い }
      out += css.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    const end = blockEnd(css, stop);
    const prelude = css.slice(i, stop);
    const head = prelude.replace(/^(\s|\/\*[\s\S]*?\*\/)+/, '');
    if (head.startsWith('@')) {
      if (GROUP_RULE.test(head)) out += prelude + '{' + mapStyleRuleSelectors(css.slice(stop + 1, end - 1), map) + (css[end - 1] === '}' ? '}' : '');
      else out += css.slice(i, end);
    } else {
      const lead = prelude.length - prelude.trimStart().length;
      const sel = prelude.trim();
      const mapped = sel ? map(sel) : undefined;
      out += mapped === undefined ? prelude : prelude.slice(0, lead) + mapped + ' ';
      out += css.slice(stop, end);
    }
    i = end;
  }
  return out;
}

/**
 * スタイルシートの文字から、いちばん外の @import の規則 (; で終わる文) を除く (中身は、呼ぶ側が、読み込んだ先の規則を囲って置く)。
 * @import は、スタイルシートの初めにだけ書ける (CSS Cascade 5 §2.1。後ろにあるものは無効) ので、どこにあっても除いてよい
 */
export function stripImports(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const stop = scanTo(css, i, '{;}');
    if (stop >= css.length) {
      out += css.slice(i);
      break;
    }
    if (css[stop] === ';' && /^(\s|\/\*[\s\S]*?\*\/)*@import\b/i.test(css.slice(i, stop))) {
      i = stop + 1;
      continue;
    }
    const end = css[stop] === '{' ? blockEnd(css, stop) : stop + 1;
    out += css.slice(i, end);
    i = end;
  }
  return out;
}

/** セレクタの並びを、括弧と文字列の外の , で分ける */
export function splitSelectorList(sel: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= sel.length) {
    const e = scanTo(sel, i, ',');
    out.push(sel.slice(i, e).trim());
    i = e + 1;
  }
  return out.filter((s) => s);
}

/** 複合セレクタの並びと、その間の結合子 (' '・'>'・'+'・'~') に分ける (CSS Selectors 4 §16 の complex selector) */
function splitComplex(sel: string): { compounds: string[]; combs: string[] } {
  const compounds: string[] = [];
  const combs: string[] = [];
  let cur = '';
  let i = 0;
  let pendingComb: string | undefined;
  const flush = () => {
    if (!cur) return;
    if (compounds.length) combs.push(pendingComb ?? ' ');
    compounds.push(cur);
    cur = '';
    pendingComb = undefined;
  };
  while (i < sel.length) {
    const c = sel[i];
    if (c === '"' || c === "'") {
      const e = stringEnd(sel, i);
      cur += sel.slice(i, e);
      i = e;
      continue;
    }
    if (c === '\\') {
      cur += sel.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '(' || c === '[') {
      const close = c === '(' ? ')' : ']';
      let depth = 0;
      let j = i;
      for (; j < sel.length; j++) {
        const d = sel[j];
        if (d === '"' || d === "'") {
          j = stringEnd(sel, j) - 1;
          continue;
        }
        if (d === '\\') {
          j++;
          continue;
        }
        if (d === c) depth++;
        else if (d === close && --depth === 0) break;
      }
      cur += sel.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (isSpace(c) || c === '>' || c === '+' || c === '~') {
      if (cur) flush();
      if (!isSpace(c)) pendingComb = c;
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  flush();
  return { compounds, combs };
}

const joinComplex = (compounds: string[], combs: string[]) => compounds.map((c, k) => (k ? (combs[k - 1] === ' ' ? ' ' : ` ${combs[k - 1]} `) : '') + c).join('');

/** 複合セレクタの、擬似要素 (::x と、旧い書き方の :before・:after・:first-line・:first-letter) の始まりの位置。無ければ長さ */
function pseudoElementAt(compound: string): number {
  const m = /::|:(?:before|after|first-line|first-letter)(?![\w-])/i.exec(compound);
  return m ? m.index : compound.length;
}

/** 括弧の中身 (name( の後から、対の ) の前まで) と、) の次の位置 */
function parenArg(s: string, open: number): { arg: string; end: number } {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return { arg: s.slice(open + 1, j), end: j + 1 };
  }
  return { arg: s.slice(open + 1), end: s.length };
}

/** 影の木のスタイルを囲う属性 (snapshot.ts が、写しの要素に付ける) */
export interface ShadowScope {
  /** 影の木の中の要素 ([data-ks-s="N"]) */
  inside: string;
  /** その影の木の host ([data-ks-h="N"]) */
  host: string;
  /** その影の木の slot に割り当てられた要素 ([data-ks-sl="N"]) */
  slotted: string;
}

/**
 * 影の木のスタイルの規則のセレクタを、その影の木の中だけに当たるように書き換える (CSS Scoping 1 §3)。
 *  - 複合セレクタごとに、影の木の中の印 (inside) を足す (擬似要素の前に)
 *  - :host → host の印、:host(X) → X と host の印、:host-context(X) → 「X の子孫の host」か「X の host」 (:is() の 2 つの形)
 *  - ::slotted(X) → X と slot に割り当てられた印
 * 読めないセレクタ (括弧の対が無いなど) は undefined
 */
export function scopeSelectorList(sel: string, scope: ShadowScope): string | undefined {
  const parts = splitSelectorList(sel);
  if (!parts.length) return undefined;
  const out: string[] = [];
  for (const part of parts) {
    const { compounds, combs } = splitComplex(part);
    if (!compounds.length) return undefined;
    const done: string[] = [];
    const doneCombs: string[] = [];
    for (const [k, compound] of compounds.entries()) {
      if (k) doneCombs.push(combs[k - 1]);
      const host = /^:host(-context)?(?![\w-])/i.exec(compound);
      if (host) {
        let rest = compound.slice(host[0].length);
        let arg = '';
        if (rest.startsWith('(')) {
          const p = parenArg(rest, 0);
          arg = p.arg.trim();
          rest = rest.slice(p.end);
        }
        if (host[1]) {
          // :host-context(X): host そのものか、host の祖先 (平らな木の祖先) が X (CSS Scoping 1 §3.2.1)。2 つの形を :is() にする
          // (前は祖先の形だけで、host そのものが X のときに当たらなかった)
          done.push(arg ? `:is(${arg} ${scope.host}, ${withAttr(arg, scope.host)})${rest}` : scope.host + rest);
        } else done.push(withAttr(arg, scope.host) + rest);
        continue;
      }
      const slotted = /::slotted\(/i.exec(compound);
      if (slotted) {
        const p = parenArg(compound, slotted.index + slotted[0].length - 1);
        done.push(withAttr(p.arg.trim(), scope.slotted) + compound.slice(p.end));
        continue;
      }
      const at = pseudoElementAt(compound);
      done.push(withAttr(compound.slice(0, at), scope.inside) + compound.slice(at));
    }
    out.push(joinComplex(done, doneCombs));
  }
  return out.join(', ');
}

/** 複合セレクタ compound に、属性セレクタ attr を足す (型セレクタは頭に置く決まりなので、後ろに足す。空の複合なら attr だけ) */
function withAttr(compound: string, attr: string): string {
  return compound + attr;
}

/**
 * セレクタの中の型セレクタ name (大文字小文字を区別しない。HTML の要素の名前) を、to に置き換える。
 * :not(canvas) のような括弧の中も置き換える。名前空間の付いた型セレクタ (svg|canvas) と、属性の中・クラス・id は置き換えない
 */
export function renameTypeSelector(sel: string, name: string, to: string): string {
  const lower = name.toLowerCase();
  let out = '';
  let last = 0;
  let i = 0;
  while (i < sel.length) {
    const c = sel[i];
    if (c === '"' || c === "'") {
      i = stringEnd(sel, i);
      continue;
    }
    if (c === '[') {
      i = scanTo(sel, i + 1, ']') + 1;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    // 型セレクタの位置: 頭か、空白・結合子・,・( の後
    const atStart = i === 0 || isSpace(sel[i - 1]) || '>+~,('.includes(sel[i - 1]);
    if (atStart && sel.slice(i, i + name.length).toLowerCase() === lower && !isIdent(sel[i + name.length]) && sel[i + name.length] !== '|') {
      out += sel.slice(last, i) + to;
      last = i + name.length;
      i = last;
      continue;
    }
    i++;
  }
  return last ? out + sel.slice(last) : sel;
}

/**
 * 規則の文字の並びの差。live にあって base に無い規則 (足された規則。live の順) と、base にあって live に無い規則の数 (消された規則)。
 * 同じ文字の規則が何度もあれば、数で比べる
 */
export function ruleDiff(base: readonly string[], live: readonly string[]): { added: string[]; removed: number } {
  const count = new Map<string, number>();
  for (const r of base) count.set(r, (count.get(r) ?? 0) + 1);
  const added: string[] = [];
  for (const r of live) {
    const n = count.get(r) ?? 0;
    if (n > 0) count.set(r, n - 1);
    else added.push(r);
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}
