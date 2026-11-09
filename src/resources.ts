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

/** 参照の種類: css は CSS として読む (拡張子が .css でなくても。https://fonts.googleapis.com/css2?family=… など) */
export type ResourceKind = 'css' | 'other';
export interface ResourceRef {
  url: string;
  kind: ResourceKind;
}

/** URL のスキーム (RFC 3986 §3.1) */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 取りに行かない参照: 空・文書の中 (#…)・data: (画像の処理が読む)・javascript: など */
function skip(u: string): boolean {
  return !u || u.startsWith('#') || /^(data|javascript|mailto|about|blob):/i.test(u);
}

/** HTML・XSL-FO・SVG の文字から参照を拾う */
export function documentRefs(text: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const val = (m: RegExpExecArray | null) => (m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : undefined);
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
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi)) {
    // @import url(…) は上で拾った
    const before = css.slice(Math.max(0, m.index! - 20), m.index!);
    if (/@import\s*$/i.test(before)) continue;
    out.push({ url: (m[1] ?? m[2] ?? m[3] ?? '').trim(), kind: 'other' });
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
  /** http(s) の CSS を取るか (TypesetOptions.fetchStyles) */
  fetchStyle: (url: string) => boolean;
  timeoutMs: number;
}

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
  for (const f of o.cssTexts) for (const r of cssRefs(f.text)) queue.push({ url: resolveRef(r.url, f.name), kind: r.kind, depth: 1 });
  while (queue.length && seen.size < MAX_REFS) {
    const it = queue.shift()!;
    const url = it.url;
    if (skip(url) || seen.has(url)) continue;
    seen.add(url);
    if (o.has(url)) continue;
    let data = toBytes(o.resolve ? await o.resolve(url) : undefined);
    if (!data && it.kind === 'css' && /^https?:/i.test(url)) {
      if (o.fetchStyle(url)) {
        data = await fetchBytes(url, o.timeoutMs);
        if (!data) warnings.push(`css-fetch-failed\t${url}`);
      } else warnings.push(`css-not-fetched\t${url}`);
    }
    if (!data) continue;
    const name = url.split(/[?#]/)[0];
    files.push({ name, url, data, css: it.kind === 'css' });
    if (it.kind === 'css' && it.depth < MAX_DEPTH) {
      const css = new TextDecoder().decode(data);
      for (const r of cssRefs(css)) queue.push({ url: resolveRef(r.url, url), kind: r.kind, depth: it.depth + 1 });
    }
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
