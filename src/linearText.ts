/**
 * linearText — 入力の文字列に当てる正規表現のうち、手間が長さの 2 乗以上 (超線形) になるものの、書き換え。
 * どれも、元の正規表現と結果を同じにして、手間を長さに比例させる (端から数える・位置を固定する・前もって切る。
 * linkPolicy.ts の cleanUrl・cssUrlScan.ts と同じ考え方)。元の正規表現は、各関数のコメントに書く
 * (test/linearText.test.ts で、ランダムな入力で元の正規表現と結果を比べる)。
 */

/**
 * 文字列の前後から、chars に含まれる字を取り除く (端から数える)。
 * 元: s.replace(/^[…]+|[…]+$/g, '')。末尾に固定した […]+$ は、途中に長い並びがあると、並びのどの位置からも末尾まで試すので、2 乗の手間になる
 */
export function trimChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

/** CSS の空白 (CSS Syntax 3 §4.2 の whitespace: 空白・タブ・改行。改行には CR と FF を含む) */
export const CSS_SPACE = ' \t\n\r\f';

/**
 * 各行の前後の空白とタブを取り除く (改行は残す)。
 * 元: s.replace(/[ \t]*\n[ \t]*\/g, '\n')。改行の無い空白の長い並びがあると、並びのどの位置からも並びの終わりまで試すので、2 乗の手間になる
 */
export function trimAroundNewlines(s: string): string {
  if (!s.includes('\n')) return s;
  const lines = s.split('\n');
  const last = lines.length - 1;
  // 最初の行は後ろだけ、最後の行は前だけを取る (元の正規表現は、改行に隣り合う空白だけを取る)
  return lines.map((l, i) => {
    let a = 0;
    let b = l.length;
    if (i > 0) while (a < b && (l[a] === ' ' || l[a] === '\t')) a++;
    if (i < last) while (b > a && (l[b - 1] === ' ' || l[b - 1] === '\t')) b--;
    return l.slice(a, b);
  }).join('\n');
}

/**
 * コンマで分ける。ただし、コンマの後ろで最初に出る括弧が「)」のもの (括弧の中のコンマ) では分けない。
 * 元: v.split(/,(?![^(]*\))/)。先読みが、コンマごとに次の「(」まで (無ければ末尾まで) を見るので、コンマの多い文字列で 2 乗の手間になる。
 * ここでは、後ろから 1 度だけなめて、各コンマの後ろで最初に出る括弧を覚える
 */
export function splitCommasOutsideParens(v: string): string[] {
  const cut: boolean[] = new Array(v.length);
  let next = ''; // この位置より後ろで最初に出る括弧 ('(' か ')'。無ければ '')
  for (let i = v.length - 1; i >= 0; i--) {
    const c = v[i];
    if (c === ',') cut[i] = next !== ')';
    else if (c === '(' || c === ')') next = c;
  }
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < v.length; i++) {
    if (cut[i]) {
      out.push(v.slice(from, i));
      from = i + 1;
    }
  }
  out.push(v.slice(from));
  return out;
}

const LEAD_SPACE = /\s*/uy;
const OPEN_PUNCT = /[\p{Ps}\p{Pi}\p{Po}]*/uy;
const LETTER = /[\p{L}\p{N}\p{S}]/uy;
const MARKS = /\p{M}*/uy;
const CLOSE_PUNCT = /[\p{Pe}\p{Pf}\p{Po}]*/uy;

/** 位置 at から、sticky の正規表現 re に合う長さ (合わなければ -1) */
function stickyLen(re: RegExp, s: string, at: number): number {
  re.lastIndex = at;
  const m = re.exec(s);
  return m ? m[0].length : -1;
}

/**
 * ::first-letter の字: [前の空白, 最初の字とその前後の約物]。最初の字が無ければ undefined。
 * 最初の字は、字・数字・記号と、続く結合文字 (CSS Inline 3 §7.2 の注: ::first-letter は最初の字の前後の約物も選ぶ)。
 * 元: /^(\s*)([\p{Ps}\p{Pi}\p{Po}]*\s*[\p{L}\p{N}\p{S}]\p{M}*[\p{Pe}\p{Pf}\p{Po}]*)/u の 1 つ目と 2 つ目の組。
 * 元は、字の無い空白の並び (改行の並びなど) で、前の \s* と後ろの \s* の分け方をすべて試すので、2 乗の手間になる。
 * ここでは、各部分を、戻らずに最長で読む (空白・約物・字・結合文字の類は互いに重ならないので、戻っても合う分け方は増えない)
 */
export function firstLetterOf(text: string): [string, string] | undefined {
  const lead = stickyLen(LEAD_SPACE, text, 0);
  let p = lead;
  p += stickyLen(OPEN_PUNCT, text, p);
  p += stickyLen(LEAD_SPACE, text, p);
  const l = stickyLen(LETTER, text, p);
  if (l < 0) return undefined;
  p += l;
  p += stickyLen(MARKS, text, p);
  p += stickyLen(CLOSE_PUNCT, text, p);
  return [text.slice(0, lead), text.slice(lead, p)];
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const SPACE_CHAR = /^\s$/;
const isSpace = (c: string | undefined): boolean => c !== undefined && SPACE_CHAR.test(c);

/**
 * 末尾の「数 単位」(image-resolution の解像度): [数, 単位 (書いたままの大きさの字。無ければ undefined)]。合わなければ undefined。
 * 元: /(\d+(?:\.\d+)?)\s*(dpi|dpcm|dppx|x)?\s*$/i.exec(s) の 1 つ目と 2 つ目の組。
 * 元は、先頭に固定しないので、数字の長い並びで、始まりの位置ごとに数字の分け方を試し、3 乗に近い手間になる。ここでは末尾から読む
 */
export function trailingResolution(s: string): [string, string | undefined] | undefined {
  let e = s.length;
  while (e > 0 && isSpace(s[e - 1])) e--;
  let unit: string | undefined;
  for (const u of ['dpcm', 'dppx', 'dpi', 'x']) {
    if (e >= u.length && s.slice(e - u.length, e).toLowerCase() === u) {
      unit = s.slice(e - u.length, e);
      e -= u.length;
      while (e > 0 && isSpace(s[e - 1])) e--;
      break;
    }
  }
  if (!isDigit(s[e - 1])) return undefined;
  // 末尾の数字の並び。その前が「.」と数字なら、小数 (始まりの位置のいちばん左のものを選ぶ元の正規表現と同じ)
  let a = e;
  while (a > 0 && isDigit(s[a - 1])) a--;
  if (s[a - 1] === '.' && isDigit(s[a - 2])) {
    a--;
    while (a > 0 && isDigit(s[a - 1])) a--;
  }
  return [s.slice(a, e), unit];
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /^\w$/.test(c);
const isNameChar = (c: string | undefined): boolean => c !== undefined && /^[\w:.-]$/.test(c);
const isAsciiLetter = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z]$/.test(c);

/**
 * SVG の文書の中の、id が「glyphN」の要素のうち、keep(名前, N) が偽のものに display="none" を足す (書体の SVG の表。colorGlyphSvg.ts)。
 * 元: text.replace(/<([A-Za-z][\w:.-]*)\b([^>]*?\bid\s*=\s*["']glyph(\d+)["'][^>]*?)(\/?)>/g, …)。
 * 元は、「<」ごとに次の「>」まで (無ければ末尾まで) を見て、名前の長さだけ戻り直すので、閉じない「<」の多い文書で 2 乗の手間になる。
 * ここでは、id="glyphN" の位置を前もって 1 度だけ探し、「<」から次の「>」までの区切りごとに、元の正規表現の合い方を計算で決める:
 *  - 区切りの中で、id="glyphN" が、名前の 1 字目より後ろにあれば合う (属性の部分 [^>]*? は何でも含める)
 *  - 名前は、名前の字の並びのうち、その後ろに \b があり、かつ後ろに id="glyphN" のあるもので、いちばん長いもの
 *  - N は、名前の後ろで最初の id="glyphN"。閉じの「/」は、「>」の直前が「/」のとき
 */
export function hideGlyphElements(text: string, keep: (name: string, n: string) => boolean): string {
  const occ: number[] = [];
  const num: string[] = [];
  for (const m of text.matchAll(/\bid\s*=\s*["']glyph(\d+)["']/g)) {
    occ.push(m.index);
    num.push(m[1]);
  }
  if (!occ.length) return text;
  // occ の中で、p 以上の最初の添字
  const firstAtOrAfter = (p: number): number => {
    let lo = 0;
    let hi = occ.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (occ[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const boundary = (p: number): boolean => isWordChar(text[p - 1]) !== isWordChar(text[p]);
  let out = '';
  let last = 0;
  let i = 0;
  while ((i = text.indexOf('<', i)) >= 0) {
    const j = text.indexOf('>', i);
    if (j < 0) break;
    // この区切りの中で、いちばん後ろの id="glyphN" の位置 (無ければ -1)
    const pk = firstAtOrAfter(j) - 1;
    const pmax = pk >= 0 ? occ[pk] : -1;
    for (let k = i; k >= 0 && k < j; k = text.indexOf('<', k + 1)) {
      if (!isAsciiLetter(text[k + 1]) || pmax < k + 2) continue;
      let e = k + 2;
      while (e < j && isNameChar(text[e])) e++;
      let ne = Math.min(e, pmax);
      while (ne > k + 2 && !boundary(ne)) ne--;
      if (!boundary(ne)) continue;
      const n = num[firstAtOrAfter(ne)];
      const name = text.slice(k + 1, ne);
      const close = text[j - 1] === '/' ? '/' : '';
      out += text.slice(last, k) + (keep(name, n) ? text.slice(k, j + 1) : `<${name}${text.slice(ne, j - close.length)} display="none"${close}>`);
      last = j + 1;
      break;
    }
    i = j + 1;
  }
  return last === 0 ? text : out + text.slice(last);
}

/**
 * 最初の文書型宣言 (<!DOCTYPE …>。内部サブセット […] を含む) を取り除く。
 * 元: t.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '')。
 * 元は、[^>[]* と \s* がどちらも空白を読むので、閉じない宣言の空白の並びで、分け方をすべて試し、2 乗の手間になる。
 * ここでは、[^>[]* を最長で読み (戻っても、\s* の後ろに「>」が来ることはない)、内部サブセットは、「]」と空白の後ろに「>」の来る最初の所で閉じる
 */
export function stripDoctype(t: string): string {
  let skipUntil = 0;
  let noCloseFrom = Infinity; // この位置より後ろの「[」は、閉じる「]」が無い
  for (const m of t.matchAll(/<!DOCTYPE/gi)) {
    const i = m.index;
    if (i < skipUntil) continue;
    let k = i + m[0].length;
    while (k < t.length && t[k] !== '>' && t[k] !== '[') k++;
    if (k >= t.length) return t;
    if (t[k] === '>') return t.slice(0, i) + t.slice(k + 1);
    // 間にある <!DOCTYPE も、同じ「[」で止まるので、飛ばす
    skipUntil = k;
    if (k >= noCloseFrom) continue;
    for (let q = t.indexOf(']', k + 1); q >= 0; q = t.indexOf(']', q + 1)) {
      let r = q + 1;
      while (r < t.length && isSpace(t[r])) r++;
      if (t[r] === '>') return t.slice(0, i) + t.slice(r + 1);
    }
    noCloseFrom = k;
  }
  return t;
}

/**
 * 最初の <svg …> の開始タグ (大文字と小文字を区別する)。無ければ undefined。
 * 元: /<svg\b[^>]*>/.exec(text)?.[0]。元は、「<svg」ごとに次の「>」まで (無ければ末尾まで) を見るので、閉じない「<svg」の多い文書で 2 乗の手間になる。
 * ここでは、\b の付く最初の「<svg」から次の「>」を探す (「>」が無ければ、後ろの「<svg」にも無い)
 */
export function firstSvgTag(text: string): string | undefined {
  for (let i = text.indexOf('<svg'); i >= 0; i = text.indexOf('<svg', i + 1)) {
    if (isWordChar(text[i + 4])) continue;
    const j = text.indexOf('>', i + 4);
    return j < 0 ? undefined : text.slice(i, j + 1);
  }
  return undefined;
}

/**
 * CSS の var(--colorN) と var(--colorN, 代わりの値) を、f(N, 代わりの値) に置き換える (書体の SVG の表の、CPAL のパレットの色。colorGlyphSvg.ts)。
 * 代わりの値は、括弧を含まないか、括弧の組を 1 つだけ含むもの (rgb(…) など)。代わりの値の前の空白は含めない。
 * 元: text.replace(/var\(\s*--color(\d+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, n, fallback) => f(n, fallback))。
 * 元は、代わりの値の [^()]* が 2 つ隣り合い、同じ字を取り合うので、閉じない var( の後ろの長い並びで、長さの 3 乗に近い手間になる。
 * ここでは、代わりの値の形を、コンマの後ろで出る括弧の字の順 (「)」か、「(」「)」「)」) で決める
 */
export function replacePaletteVars(text: string, f: (n: string, fallback: string | undefined) => string): string {
  // nextParen[i]: i 以降で最初の「(」か「)」の位置 (無ければ text.length)
  const nextParen = new Int32Array(text.length + 1);
  nextParen[text.length] = text.length;
  for (let i = text.length - 1; i >= 0; i--) nextParen[i] = text[i] === '(' || text[i] === ')' ? i : nextParen[i + 1];
  const skipSpace = (p: number): number => {
    while (p < text.length && isSpace(text[p])) p++;
    return p;
  };
  let out = '';
  let last = 0;
  for (let i = text.indexOf('var('); i >= 0; ) {
    let p = skipSpace(i + 4);
    let end = -1;
    let n = '';
    let fallback: string | undefined;
    if (text.startsWith('--color', p)) {
      p += 7;
      const d = p;
      while (isDigit(text[p])) p++;
      if (p > d) {
        n = text.slice(d, p);
        p = skipSpace(p);
        if (text[p] === ')') end = p + 1;
        else if (text[p] === ',') {
          const a = skipSpace(p + 1);
          const p1 = nextParen[a];
          let close = -1;
          if (text[p1] === ')') close = p1;
          else if (text[p1] === '(') {
            const p2 = nextParen[p1 + 1];
            if (text[p2] === ')') {
              const p3 = nextParen[p2 + 1];
              if (text[p3] === ')') close = p3;
            }
          }
          if (close >= 0) {
            fallback = text.slice(a, close);
            end = close + 1;
          }
        }
      }
    }
    if (end < 0) {
      i = text.indexOf('var(', i + 1);
      continue;
    }
    out += text.slice(last, i) + f(n, fallback);
    last = end;
    i = text.indexOf('var(', end);
  }
  return last === 0 ? text : out + text.slice(last);
}
