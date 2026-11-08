/**
 * epub — EPUB (zip) を、1 つの HTML (と画像) にまとめる。HTML の読み込み (htmlFrame / htmlImport) に渡して組む。
 *
 *  - zip: 中央ディレクトリを読み、無圧縮 (0) と deflate (8) を展開する (DecompressionStream の deflate-raw)
 *  - META-INF/container.xml → OPF (manifest・spine) → spine の順に XHTML の本文をつなぐ。章ごとに改ページする
 *  - CSS は <style> にしてまとめる (章の <link> と <style> を、最初に出た順に 1 度ずつ)。画像は名前つきで返す
 */

export interface ZipEntry {
  name: string;
  data: () => Promise<Uint8Array>;
}

/** zip の中身の一覧 (名前と、展開する関数) */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 中央ディレクトリの終わり (EOCD) を後ろから探す
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip ではありません');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const utf8 = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    out.push({
      name,
      data: async () => {
        const ln = v.getUint16(local + 26, true);
        const le = v.getUint16(local + 28, true);
        const raw = bytes.subarray(local + 30 + ln + le, local + 30 + ln + le + csize);
        if (method === 0) return raw;
        if (method !== 8) throw new Error(`${name}: 対応していない圧縮方式 (${method})`);
        const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      },
    });
  }
  return out;
}

/** パスの結合 (dir/rel、.. を解く) */
function resolvePath(dir: string, rel: string): string {
  let path = rel.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 不正な % の並びは、そのまま */
  }
  const parts = (dir ? dir + '/' : '').concat(path).split('/');
  const out: string[] = [];
  for (const s of parts) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
}
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

export interface EpubBook {
  /** spine の順に本文をつないだ HTML */
  html: string;
  /** 画像 (名前は zip の中のパス) */
  images: Array<{ name: string; data: Uint8Array }>;
  title?: string;
}

type ParseXml = (text: string, type: 'application/xml' | 'text/html') => Document;

/** EPUB を 1 つの HTML にまとめる。parse: XML / HTML の文字列を文書にする (ブラウザでは DOMParser) */
export async function readEpub(bytes: Uint8Array, parse: ParseXml): Promise<EpubBook> {
  const entries = new Map(readZip(bytes).map((e) => [e.name, e]));
  const text = async (name: string) => {
    const e = entries.get(name);
    return e ? new TextDecoder().decode(await e.data()) : undefined;
  };
  const container = await text('META-INF/container.xml');
  if (!container) throw new Error('EPUB ではありません (META-INF/container.xml がありません)');
  const opfPath = /full-path\s*=\s*"([^"]+)"/.exec(container)?.[1];
  const opfText = opfPath ? await text(opfPath) : undefined;
  if (!opfPath || !opfText) throw new Error('EPUB の OPF が読めません');
  const opf = parse(opfText, 'application/xml');
  const base = dirOf(opfPath);
  const items = new Map<string, { href: string; type: string }>();
  for (const it of Array.from(opf.getElementsByTagName('item'))) {
    items.set(it.getAttribute('id') ?? '', { href: resolvePath(base, it.getAttribute('href') ?? ''), type: it.getAttribute('media-type') ?? '' });
  }
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() ?? opf.getElementsByTagName('title')[0]?.textContent?.trim();
  const lang = opf.getElementsByTagName('dc:language')[0]?.textContent?.trim();
  const css: string[] = [];
  const seenCss = new Set<string>();
  const sections: string[] = [];
  const itemrefs = Array.from(opf.getElementsByTagName('itemref')).filter((r) => r.getAttribute('linear') !== 'no');
  for (const [k, ref] of itemrefs.entries()) {
    const item = items.get(ref.getAttribute('idref') ?? '');
    if (!item) continue;
    const src = await text(item.href);
    if (src === undefined) continue;
    // XHTML は XML として読む (<a/> のような空要素を正しく扱う)。読めなければ HTML として読む
    let doc = /xhtml|xml/.test(item.type) ? parse(src, 'application/xml') : undefined;
    if (!doc || doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('body')[0]) doc = parse(src, 'text/html');
    const dir = dirOf(item.href);
    for (const l of Array.from(doc.getElementsByTagName('link'))) {
      if (!/stylesheet/i.test(l.getAttribute('rel') ?? '')) continue;
      const p = resolvePath(dir, l.getAttribute('href') ?? '');
      if (seenCss.has(p)) continue;
      seenCss.add(p);
      const t = await text(p);
      if (t) css.push(t);
    }
    for (const s of Array.from(doc.getElementsByTagName('style'))) {
      const t = s.textContent ?? '';
      if (!seenCss.has(t)) (seenCss.add(t), css.push(t));
    }
    const body = doc.getElementsByTagName('body')[0];
    if (!body) continue;
    // 画像のパスは、zip の中のパスに直す (assets は名前で突き合わせる)
    for (const img of Array.from(body.getElementsByTagName('img'))) {
      const s = img.getAttribute('src');
      if (s) img.setAttribute('src', resolvePath(dir, s));
    }
    for (const img of Array.from(body.getElementsByTagName('image'))) {
      const s = img.getAttribute('xlink:href') ?? img.getAttribute('href');
      if (s) img.setAttribute('href', resolvePath(dir, s));
    }
    const inner = Array.from(body.childNodes).map(toHtml).join('');
    const cls = body.getAttribute('class');
    sections.push(`<section${cls ? ` class="${escapeAttr(cls)}"` : ''}${k > 0 ? ' style="break-before: page"' : ''}>${inner}</section>`);
  }
  const images: EpubBook['images'] = [];
  for (const it of items.values()) {
    if (!/^image\//.test(it.type)) continue;
    const e = entries.get(it.href);
    if (e) images.push({ name: it.href, data: await e.data() });
  }
  const html = `<!doctype html><html${lang ? ` lang="${escapeAttr(lang)}"` : ''}><head><meta charset="utf-8"><title>${escapeText(title ?? '')}</title>${css.map((c) => `<style>${c}</style>`).join('')}</head><body>${sections.join('')}</body></html>`;
  return { html, images, ...(title ? { title } : {}) };
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** HTML の書き方で書き出す (XHTML の <a/> のような空要素も、閉じタグを付けて書く) */
function toHtml(n: Node): string {
  if (n.nodeType === 3) return escapeText(n.textContent ?? '');
  if (n.nodeType === 4) return escapeText(n.textContent ?? '');
  if (n.nodeType !== 1) return '';
  const el = n as Element;
  const name = el.localName;
  let attrs = '';
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    attrs += ` ${a.name}="${escapeAttr(a.value)}"`;
  }
  if (VOID.has(name)) return `<${name}${attrs}>`;
  return `<${name}${attrs}>${Array.from(el.childNodes).map(toHtml).join('')}</${name}>`;
}

/** 属性の値の逃がし (" も) */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
