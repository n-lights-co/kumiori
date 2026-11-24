/**
 * xmlAttr — SVG (XML) の属性の値の読み方を 1 つにそろえる。
 * 属性の値の文字参照 (&#38;・&#x26;) と、決まった実体参照 (&amp; &lt; &gt; &quot; &apos;) は、読んだときに戻す (XML 1.0 §3.3.3・§4.1・§4.6)。
 * インラインの svg は、写しに書き出すと URL の & が &amp; になるので、戻さずに引くと、描く所と、取る所・見つからない参照を知らせる所で、
 * 違う名前で引くことになる (描かれない・誤った警告)
 */

/** 属性の値の文字参照・決まった実体参照を戻す (XML の名前は大文字と小文字を分けるので、&AMP; は戻さない) */
export function decodeXmlAttr(v: string): string {
  if (!v.includes('&')) return v;
  return v.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g, (m, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name]!;
    const cp = parseInt(hex ?? dec!, hex ? 16 : 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

/** 要素の開きのタグ (字面) の href・xlink:href の値 (文字参照を戻したもの。前後の空白は除く。無ければ '') */
export function hrefOfTag(tag: string): string {
  const h = /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return decodeXmlAttr((h?.[1] ?? h?.[2] ?? '').trim());
}

/** decodeXmlAttributes に渡した文書 (この文書の要素の getAttribute は、持っている値をそのまま返す) */
const xmlDocs = new WeakSet<object>();
/** getAttribute を包んだ prototype (1 度だけ包む) */
const wrapped = new WeakSet<object>();

/**
 * Node の linkedom で読んだ XML の文書の、要素の getAttribute を、ブラウザの DOMParser と同じ値を返すものにする。
 * linkedom は、属性の値の文字参照を戻して持つが、XML の文書の getAttribute は、その値を字を逃がして返す (& を &amp; に。
 * linkedom 0.18 の Element.getAttribute が、HTML でない文書では escape する)。
 * getAttribute を持つ prototype (linkedom の Element) を 1 度だけ包み、ここに渡した文書の要素 (後で作る・写す要素も、ownerDocument が
 * その文書なら) では、持っている値をそのまま返す。ほかの文書 (linkedom の HTML の文書など) は、もとの getAttribute のまま
 */
export function decodeXmlAttributes(doc: unknown): void {
  type El = { ownerDocument?: object | null; getAttributeNode?: (n: string) => { value: string } | null; getAttribute?: (n: string) => string | null };
  const root = (doc as { documentElement?: El }).documentElement;
  if (!doc || !root || typeof root.getAttributeNode !== 'function') return;
  xmlDocs.add(doc as object);
  // getAttribute を持つ prototype を探す
  let proto: object | null = Object.getPrototypeOf(root) as object | null;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'getAttribute')) proto = Object.getPrototypeOf(proto) as object | null;
  if (!proto || wrapped.has(proto)) return;
  wrapped.add(proto);
  const original = (proto as El).getAttribute!;
  Object.defineProperty(proto, 'getAttribute', {
    value(this: El, name: string) {
      if (this.ownerDocument && xmlDocs.has(this.ownerDocument)) return this.getAttributeNode!(name)?.value ?? null;
      return original.call(this, name);
    },
    configurable: true,
    writable: true,
  });
}
