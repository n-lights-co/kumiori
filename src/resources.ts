/**
 * 文書と CSS が参照するファイル (CSS・画像・書体・SVG など) を集める。
 * typeset の files に無いものは、利用者の関数 (TypesetOptions.resolveResource) に問い合わせ、
 * それでも無い http(s) の CSS は、ネットワークから取る (TypesetOptions.fetchStyles)。
 * 取れたものは files に足し、ほかの処理 (CSS の集め方・画像・@font-face) は、これまでどおりファイルの名前で突き合わせる。
 *
 * 参照の見つけ方 (HTML の仕様を読まない、文字の上の近似):
 *  - CSS: <link rel="stylesheet" href>、@import (HTML Living Standard §4.2.4・CSS Cascade 5 §2)
 *  - そのほか: src・data・poster の属性、SVG の <image>・<use>・<feImage> の href・xlink:href、CSS の url()
 *  - XSL-FO: src の url()、CSS と同じ url()
 * CSS の中の相対参照は、その CSS の URL を基準に解決する (CSS Values 4 §4.5.1: url() の相対 URL は、スタイルシートの URL が基準)
 */

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
  const parts = base.split('/').slice(0, -1);
  for (const seg of ref.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
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
  /** http(s) の CSS と、その @font-face の書体を取るか (TypesetOptions.fetchStyles) */
  fetchStyle: (url: string) => boolean;
  timeoutMs: number;
  /** 文書に出てくる字の番号。@font-face の書体のうち、unicode-range がこれと重ならないものは取らない (Google Fonts の分けた書体など) */
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
  for (const f of o.cssTexts) for (const r of cssRefs(f.text)) queue.push({ ...r, url: resolveRef(r.url, f.name), depth: 1 });
  // 1 つの参照を処理する: files にあれば何もしない。resolveResource に問い合わせ、無ければ http(s) の CSS・書体を取る
  const one = async (it: Item) => {
    const url = it.url;
    if (o.has(url)) return;
    // unicode-range が文書の字と重ならない書体は使われないので、取らない
    if (it.kind === 'font' && it.ranges && o.chars && !it.ranges.some(([a, b]) => [...o.chars!].some((c) => c >= a && c <= b))) return;
    let data = toBytes(o.resolve ? await o.resolve(url) : undefined);
    if (!data && (it.kind === 'css' || it.kind === 'font') && /^https?:/i.test(url)) {
      if (o.fetchStyle(url)) {
        data = await fetchBytes(url, o.timeoutMs);
        if (!data) warnings.push(`${it.kind}-fetch-failed\t${url}`);
      } else warnings.push(`${it.kind}-not-fetched\t${url}`);
    }
    if (!data) return;
    files.push({ name: url.split(/[?#]/)[0], url, data, css: it.kind === 'css' });
    if (it.kind === 'css' && it.depth < MAX_DEPTH) {
      const css = new TextDecoder().decode(data);
      for (const r of cssRefs(css)) queue.push({ ...r, url: resolveRef(r.url, url), depth: it.depth + 1 });
    }
  };
  while (queue.length && seen.size < MAX_REFS) {
    // 同時に PARALLEL 個まで (Google Fonts の CSS は、字の範囲で分けた書体をたくさん参照する)
    const batch: Item[] = [];
    while (queue.length && batch.length < PARALLEL && seen.size < MAX_REFS) {
      const it = queue.shift()!;
      if (skip(it.url) || seen.has(it.url)) continue;
      seen.add(it.url);
      batch.push(it);
    }
    await Promise.all(batch.map(one));
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

async function fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}
