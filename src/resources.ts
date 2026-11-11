/**
 * 文書と CSS が参照するファイル (CSS・画像・書体・SVG など) を集める。
 * typeset の files に無いものは、利用者の関数 (TypesetOptions.resolveResource) に問い合わせ、
 * それでも無い http(s) の CSS は、ネットワークから取る (TypesetOptions.fetchStyles)。
 * 取れたものは files に足し、ほかの処理 (CSS の集め方・画像・@font-face) は、これまでどおりファイルの名前で突き合わせる。
 * ただし CSS と画像は、参照の URL の全体 (問い合わせの ?… を含む) を先に見る (名前が同じで問い合わせだけが違うものを取り違えない)。
 *
 * 参照の見つけ方 (HTML の仕様を読まない、文字の上の近似):
 *  - CSS: <link rel="stylesheet" href>、@import (HTML Living Standard §4.2.4・CSS Cascade 5 §2)
 *  - そのほか: src・data・poster の属性、SVG の <image>・<use>・<feImage> の href・xlink:href、CSS の url()
 *  - XSL-FO: src の url()、CSS と同じ url()
 * CSS の中の相対参照は、その CSS の URL を基準に解決する (CSS Values 4 §4.5.1: url() の相対 URL は、スタイルシートの URL が基準)
 */
import { fetchLimits } from './imageLimits';

/**
 * 参照の種類: css は CSS として読む (拡張子が .css でなくても。https://fonts.googleapis.com/css2?family=… など)。
 * font は @font-face の src の書体 (ranges はその unicode-range)
 */
export type ResourceKind = 'css' | 'font' | 'other';
export interface ResourceRef {
  url: string;
  kind: ResourceKind;
  ranges?: Array<[number, number]>;
}

/** unicode-range の値 (CSS Fonts 4 §4.5: U+26・U+0-7F・U+4??) → 字の番号の範囲。読めなければ undefined (すべての字) */
export function parseUnicodeRange(v: string): Array<[number, number]> | undefined {
  const out: Array<[number, number]> = [];
  for (const part of v.split(',')) {
    const m = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!m) return undefined;
    if (m[1].includes('?')) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)]);
    else out.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
  }
  return out.length ? out : undefined;
}

/**
 * 文書の文字に出てくる字の番号 (タグや CSS の字も含む、多めの見積もり): 書かれたままの字と、数値の文字参照 (&#x65E5;) の字、
 * CSS の逃がし (\65E5。<style>・style 属性の content の文字列など) の字。名前の文字参照 (&alpha; など) は、呼ぶ側が HTML の解析で解いて足す。
 * @font-face の書体のうち、unicode-range がこれと重ならないものは取らない (CSS Fonts 4 §4.5: 範囲の外の字のために書体を取らない・使わない)
 */
export function documentChars(text: string): Set<number> {
  const chars = new Set<number>();
  for (const ch of text) chars.add(ch.codePointAt(0)!);
  if (text.includes('&#')) for (const m of text.matchAll(/&#(?:(\d{1,7})|[xX]([0-9a-fA-F]{1,6}))/g)) chars.add(m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16));
  if (text.includes('\\')) for (const m of text.matchAll(/\\([0-9a-fA-F]{1,6})/g)) chars.add(parseInt(m[1], 16));
  return chars;
}

/**
 * CSS の文字列 ("…"・'…'。content の値など) の字の番号を into に足す。逃がしは解く (CSS Syntax 3 §4.3.7: \ の後ろの 16 進の 1〜6 桁と、
 * その後ろの空白 1 つ。0・代用符号・U+10FFFF より大きい番号は U+FFFD。ほかは次の字そのもの。§4.3.5: \ の後ろの改行は何も表さない)。
 * 注釈の中は見ない。content に限らず、すべての文字列を見る (書体名・url("…") も入る、多めの見積もり)
 */
export function cssStringChars(css: string, into: Set<number>): void {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'/g)) {
    const body = m[1] ?? m[2] ?? '';
    const text = body.includes('\\')
      ? body.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/gu, (_all, hex?: string, nl?: string, ch?: string) => {
          if (nl) return '';
          if (!hex) return ch ?? '';
          const cp = parseInt(hex, 16);
          return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
        })
      : body;
    for (const ch of text) into.add(ch.codePointAt(0)!);
  }
}

/** URL のスキーム (RFC 3986 §3.1) */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 取りに行かない参照: 空・文書の中 (#…)・data: (画像の処理が読む)・javascript: など */
function skip(u: string): boolean {
  return !u || u.startsWith('#') || /^(data|javascript|mailto|about|blob):/i.test(u);
}

/** XML で決まっている実体 (XML 1.0 §4.6)。HTML でも同じ字 */
const BASIC_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * 文字参照を解く: 数値の文字参照 (&#38;・&#x26;) と、&amp;・&lt;・&gt;・&quot;・&apos;。ほかの名前の文字参照 (&nbsp; など) はそのまま残す。
 * 属性の値 (href="…css2?family=A&amp;display=swap") は、文字参照を解いたものが参照の URL
 * (HTML Living Standard §13.2.5.36〜38 の属性の値の状態から §13.2.5.77 の文字参照の状態へ。XML 1.0 §4.1)。
 * ; で終わるものだけを解く (属性の値では、; の無い名前の後ろに = や英数字が続くものは文字参照にしない。§13.2.5.78)
 */
export function decodeCharRefs(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g, (all, dec?: string, hex?: string, name?: string) => {
    if (name) return BASIC_ENTITIES[name];
    const cp = dec ? parseInt(dec, 10) : parseInt(hex!, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : all;
  });
}

/** HTML・XSL-FO・SVG の文字から参照を拾う */
export function documentRefs(text: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const val = (m: RegExpExecArray | null) => (m ? decodeCharRefs(m[1] ?? m[2] ?? m[3] ?? '').trim() : undefined);
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (val(attr(m[0], 'rel')) ?? '').toLowerCase().split(/\s+/);
    const href = val(attr(m[0], 'href'));
    if (href && rel.includes('stylesheet')) out.push({ url: unwrapUrl(href), kind: 'css' });
  }
  for (const m of text.matchAll(/<(?:[\w-]+:)?(?:img|image|use|feImage|object|embed|video|audio|source|input|external-graphic)\b[^>]*>/gi)) {
    for (const name of ['src', 'data', 'poster', 'xlink:href', 'href']) {
      const v = val(attr(m[0], name));
      if (v) out.push({ url: unwrapUrl(v), kind: 'other' });
    }
  }
  out.push(...cssRefs(text));
  return dedupe(out);
}

/** 同じ参照は 1 つにする (CSS として拾ったものを優先) */
function dedupe(refs: ResourceRef[]): ResourceRef[] {
  const m = new Map<string, ResourceRef>();
  for (const r of refs) if (!m.has(r.url) || r.kind === 'css') m.set(r.url, m.get(r.url) ? { ...m.get(r.url)!, kind: 'css' } : r);
  return [...m.values()];
}

/** CSS の文字から参照を拾う (@import は CSS、url() はそのほか) */
export function cssRefs(css: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  const imports = new Set<number>();
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))/gi)) {
    out.push({ url: (m[1] ?? m[2] ?? m[3] ?? '').trim(), kind: 'css' });
    imports.add(m.index!);
  }
  // @font-face の規則の範囲 (中の url() は書体。unicode-range も読む)
  const faces: Array<{ start: number; end: number; ranges?: Array<[number, number]> }> = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const ur = /unicode-range\s*:\s*([^;}]+)/i.exec(m[1]);
    faces.push({ start: m.index!, end: m.index! + m[0].length, ...(ur ? { ranges: parseUnicodeRange(ur[1]) } : {}) });
  }
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi)) {
    // @import url(…) は上で拾った
    const before = css.slice(Math.max(0, m.index! - 20), m.index!);
    if (/@import\s*$/i.test(before)) continue;
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const face = faces.find((f) => m.index! > f.start && m.index! < f.end);
    out.push(face ? { url, kind: 'font', ...(face.ranges ? { ranges: face.ranges } : {}) } : { url, kind: 'other' });
  }
  return out;
}

/** url(…) で包んだ値 (XSL-FO の src="url('a.png')") の中身 */
function unwrapUrl(v: string): string {
  const m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*))\s*\)$/i.exec(v.trim());
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : v;
}

/**
 * 参照 ref を、それを書いた CSS の URL (base) を基準に解決する。base が無い (文書から直接の参照) か、ref にスキームがあれば ref のまま。
 * base にスキームがあれば URL として (RFC 3986 §5.2)、無ければ (files の名前: css/a.css) パスとしてつなぐ
 */
export function resolveRef(ref: string, base?: string): string {
  if (!base || SCHEME.test(ref) || ref.startsWith('//') && !SCHEME.test(base)) return ref;
  if (SCHEME.test(base)) {
    try {
      return new URL(ref, base).href;
    } catch {
      return ref;
    }
  }
  if (ref.startsWith('/')) return ref.replace(/^\/+/, '');
  // 基準 (files の名前は文書からの相対パス) より上を指す .. は残す (../fx/a.ttf: 入力のディレクトリの外のファイル。
  // RFC 3986 §5.2.4 は絶対の URL の .. を根で止めるが、ここは相対のパスなので、止めると別のファイルの名前になる)
  const parts = base.split('/').slice(0, -1);
  for (const seg of ref.split('/')) {
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
    } else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * CSS の @font-face の中の相対の url() を、その CSS の場所 (base: URL か、文書からの相対パス css/a.css) を基準に解決した参照に書き換える
 * (CSS Fonts 4 §4.3: src の url() は、@font-face の規則のあるスタイルシートの場所を基準に解決する。CSS Values 4 §4.5.1)。
 * CSS の中身を文書の <style> に差し込むと、どの CSS に書かれていたかが分からなくなるので、差し込む前に書き換えておく。
 * 解決しても変わらない参照と、引用符の中に書けない字のある参照は、そのまま
 */
export function rebaseFontFaceUrls(css: string, base: string): string {
  if (!/@font-face/i.test(css)) return css;
  return css.replace(/@font-face\s*\{[^}]*\}/gi, (rule) =>
    rule.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi, (all, a?: string, b?: string, c?: string) => {
      const ref = (a ?? b ?? c ?? '').trim();
      if (skip(ref)) return all;
      const to = resolveRef(ref, base);
      return to === ref || /["\\\n\r\f]/.test(to) ? all : `url("${to}")`;
    }),
  );
}

/** ファイルの名前 (問い合わせの ? # を除いた、最後の / の後ろ。%xx は戻す) */
export function refBasename(u: string): string {
  const s = u.split(/[?#]/)[0].split('/').pop() ?? u;
  try {
    return decodeURIComponent(s).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export interface CollectOptions {
  /** すでにあるファイルか (名前で突き合わせる。typeset の files) */
  has(url: string): boolean;
  /** すでにある CSS の中身 (files の CSS。その中の参照もたどる)。名前 → 中身 */
  cssTexts: Array<{ name: string; text: string }>;
  /** 利用者の関数 (TypesetOptions.resolveResource) */
  resolve?: (url: string) => unknown;
  /** http(s) の CSS と、その @font-face の書体を取るか (TypesetOptions.fetchStyles)。転送 (redirect) の先の URL にも聞く */
  fetchStyle: (url: string) => boolean;
  timeoutMs: number;
  /**
   * 文書に出てくる字の番号 (documentChars)。@font-face の書体のうち、unicode-range がこれと重ならないものは取らない (Google Fonts の分けた書体など)。
   * CSS (cssTexts と、取った CSS) の文字列の字は、ここで足して見る (content: "第" の字は、文書の文字には出てこない)
   */
  chars?: ReadonlySet<number>;
}

/** 同時に取りに行く数 */
const PARALLEL = 8;

/** 集めたファイル: name は参照の URL (? # を除く)。css は CSS として読むもの */
export interface CollectedFile {
  name: string;
  url: string;
  data: Uint8Array;
  css: boolean;
}

/** 集める参照の数の上限 (CSS の @import の輪などで、際限なく問い合わせない) */
const MAX_REFS = 500;
const MAX_DEPTH = 8;

/**
 * 文書の参照をたどってファイルを集める。CSS は中の参照もたどる (深さ 8 まで)。
 * 戻り値: 足すファイルと、取れなかった・取らなかった参照の警告
 */
export async function collectResources(text: string, o: CollectOptions): Promise<{ files: CollectedFile[]; warnings: string[] }> {
  const files: CollectedFile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  type Item = ResourceRef & { depth: number };
  const queue: Item[] = documentRefs(text).map((r) => ({ ...r, depth: 0 }));
  // 使う字: 文書の字に、CSS の文字列 (content の値など) の字を足す
  const chars = o.chars ? new Set(o.chars) : undefined;
  for (const f of o.cssTexts) {
    for (const r of cssRefs(f.text)) queue.push({ ...r, url: resolveRef(r.url, f.name), depth: 1 });
    if (chars) cssStringChars(f.text, chars);
  }
  /** 中身の取れた参照 */
  const have = new Set<string>();
  // 1 つの参照を処理する: files にあれば何もしない。resolveResource に問い合わせ、無ければ http(s) の CSS・書体を取る
  const one = async (it: Item) => {
    const url = it.url;
    if (o.has(url)) return;
    // unicode-range が使う字と重ならない書体は使われないので、取らない (CSS Fonts 4 §4.5)
    if (it.kind === 'font' && it.ranges && chars && !it.ranges.some(([a, b]) => [...chars].some((c) => c >= a && c <= b))) return;
    let data = toBytes(o.resolve ? await o.resolve(url) : undefined);
    if (!data && (it.kind === 'css' || it.kind === 'font') && /^https?:/i.test(url)) {
      if (o.fetchStyle(url)) {
        // 転送の先も fetchStyle に聞く。大きさの上限は種類ごと (fetchLimits)
        data = (await fetchGuarded(url, { timeoutMs: o.timeoutMs, maxBytes: it.kind === 'css' ? fetchLimits.cssBytes : fetchLimits.fontBytes, allow: o.fetchStyle }))?.bytes;
        if (!data) warnings.push(`${it.kind}-fetch-failed\t${url}`);
      } else warnings.push(`${it.kind}-not-fetched\t${url}`);
    }
    if (!data) return;
    have.add(url);
    files.push({ name: url.split(/[?#]/)[0], url, data, css: it.kind === 'css' });
    if (it.kind === 'css') {
      const css = new TextDecoder().decode(data);
      if (chars) cssStringChars(css, chars);
      if (it.depth < MAX_DEPTH) for (const r of cssRefs(css)) queue.push({ ...r, url: resolveRef(r.url, url), depth: it.depth + 1 });
    }
  };
  // 書体は、CSS をすべて集めてから取る (使う字は、後から読む CSS の content の字でも増えるので、先には決まらない)
  const fonts: Item[] = [];
  const seenFonts = new Set<string>();
  for (let fontPass = false; ; fontPass = true) {
    while (queue.length && seen.size < MAX_REFS) {
      // 同時に PARALLEL 個まで (Google Fonts の CSS は、字の範囲で分けた書体をたくさん参照する)
      const batch: Item[] = [];
      while (queue.length && batch.length < PARALLEL && seen.size < MAX_REFS) {
        const it = queue.shift()!;
        if (skip(it.url)) continue;
        if (it.kind === 'font' && !fontPass) {
          fonts.push(it);
          continue;
        }
        // 書体は、書体でない参照として先に見ていても、中身が取れていなければ書体として取りに行く
        if (it.kind === 'font' ? seenFonts.has(it.url) || have.has(it.url) : seen.has(it.url)) continue;
        if (it.kind === 'font') seenFonts.add(it.url);
        seen.add(it.url);
        batch.push(it);
      }
      await Promise.all(batch.map(one));
    }
    if (fontPass || !fonts.length) break;
    queue.push(...fonts);
  }
  return { files, warnings };
}

function toBytes(d: unknown): Uint8Array | undefined {
  if (d === undefined || d === null) return undefined;
  if (typeof d === 'string') return new TextEncoder().encode(d);
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return undefined;
}

/** 取得の結果: 中身と、応答の Content-Type (無ければ空) */
export interface FetchedResource {
  bytes: Uint8Array;
  type: string;
}

export interface GuardedFetchOptions {
  /** 時限 (ミリ秒)。転送をたどる間と、本体を読み終えるまでの全体に効く。省けば時限なし */
  timeoutMs?: number;
  /** 本体の大きさの上限 (バイト)。超えたら読むのをやめる */
  maxBytes: number;
  /** 取ってよい URL か (TypesetOptions.fetchImages・fetchStyles の関数)。転送の先の URL にも聞く。省けば、すべて許す */
  allow?: (url: string) => boolean;
}

/** 転送の応答の状態コード (Fetch Standard §2.2.3 の redirect status: 301・302・303・307・308。2026-11 の版で確かめた) */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** ブラウザの中か (転送の先の Location をスクリプトから読めない実行環境。ほかの所と同じく document の有無で見分ける) */
const inBrowser = () => typeof document !== 'undefined';

/**
 * 文書に書かれた http(s) の URL を、転送の先と大きさを確かめながら取る。取れない・許されない・大きすぎるものは undefined (投げない)。
 *
 * 転送 (OUT-01): 許可の関数 allow には、文書に書かれた URL だけでなく、転送の先の URL も聞く (許したホストが 302 で内部のアドレスを返しても、
 * そこへ要求を出さない)。
 *  - Node など、転送の応答の Location を読める実行環境: redirect: 'manual' で取り、Location を今の URL に対して解決し (RFC 9110 §10.2.2。
 *    Fetch Standard §2.2.6 の location URL: 解決できない Location は network error、Location の無い転送の応答はそのまま返す)、
 *    allow に聞き直してから次の要求を出す。たどるのは fetchLimits.redirects 回まで (Fetch Standard §4.5 HTTP-redirect fetch の
 *    「redirect count が 20 なら network error」: 20 回まではたどり、21 回目の転送で止める。ブラウザの上限と同じ)。
 *    http(s) でないスキームへの転送は断る (同じく §4.5)。https から http への格下げも断る (これは Kumiori の決まり。暗号化した経路で
 *    許したものを、平文の経路で取り直さない)。
 *  - ブラウザ: redirect: 'manual' の応答は中身の見えない opaqueredirect になり、Location を読めない (Fetch Standard §2.2.6 の opaque-redirect filtered response)。
 *    転送の先を確かめずにたどるのはブラウザ自身なので、allow があるときは、たどった後の最後の URL (res.url) を allow に聞き、許されなければ応答を捨てる。
 *    このとき、要求そのものは転送の先に届いている (中身を使わないだけ)。allow が無ければ、これまでどおりブラウザに任せる。
 * allow は URL の文字列を見るだけなので、名前の解決の結果 (内部のアドレスに解決されるホスト名) までは、ここでは防げない。
 *
 * 大きさ (OUT-11): Content-Length が上限を超えていれば本体を読まずに断り、本体は少しずつ読んで、上限を超えた所で読むのをやめる
 * (Content-Length の無い応答・偽った応答でも、上限より多くは持たない)。本体を少しずつ読めない実行環境 (res.body が無い) では、全部を読んでから大きさを見る。
 */
export async function fetchGuarded(url: string, o: GuardedFetchOptions): Promise<FetchedResource | undefined> {
  // 時限は 1 つの合図で、転送の連なりの全体と本体の読み取りに効かせる (fetch に渡した合図は、本体を読んでいる間も効く)
  const signal = o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined;
  const init = (redirect: RequestRedirect): RequestInit => ({ redirect, ...(signal ? { signal } : {}) });
  try {
    let res: Response;
    if (inBrowser()) res = await fetch(url, init('follow'));
    else {
      let cur = url;
      for (let n = 0; ; n++) {
        res = await fetch(cur, init('manual'));
        // Location を読めない実行環境 (ブラウザと同じ扱いの所): たどり直して、最後の URL を確かめる (下)
        if (res.type === 'opaqueredirect') {
          res = await fetch(url, init('follow'));
          break;
        }
        const loc = REDIRECT_STATUS.has(res.status) ? res.headers.get('location') : null;
        if (loc === null) break;
        // 転送の応答の本体は使わない (接続を放す)
        await res.body?.cancel().catch(() => undefined);
        if (n >= fetchLimits.redirects) return undefined;
        const next = new URL(loc, cur);
        if (!/^https?:$/.test(next.protocol)) return undefined;
        if (next.protocol === 'http:' && /^https:/i.test(cur)) return undefined;
        if (o.allow && !o.allow(next.href)) return undefined;
        cur = next.href;
      }
    }
    // 転送の先を前もって確かめられなかったとき: 最後の URL を確かめて、許されないものは使わない
    if (res.redirected) {
      const ok = /^https?:/i.test(res.url) && !(/^http:/i.test(res.url) && /^https:/i.test(url)) && (!o.allow || o.allow(res.url));
      if (!ok) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const bytes = await readLimited(res, o.maxBytes);
    return bytes ? { bytes, type: res.headers.get('content-type') ?? '' } : undefined;
  } catch {
    return undefined;
  }
}

/** 応答の本体を、上限 max バイトまで読む。超えたら読むのをやめて undefined */
async function readLimited(res: Response, max: number): Promise<Uint8Array | undefined> {
  // Content-Length は、送られてくる (圧縮されたままの) 本体の長さ。それだけで上限を超えていれば、読まない
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.length > max ? undefined : all;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    parts.push(value);
  }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
