/**
 * epub — EPUB (zip) を、1 つの HTML (と画像) にまとめる。HTML の読み込み (htmlFrame / htmlImport) に渡して組む。
 *
 *  - zip: 中央ディレクトリを読み、無圧縮 (0) と deflate (8) を展開する (DecompressionStream の deflate-raw)。
 *    展開する量には上限を置く (1 つの項目・1 つの EPUB の合計・項目の数。imageLimits.ts。小さな zip から巨大な展開をさせない)
 *  - META-INF/container.xml → OPF (manifest・spine) → spine の順に XHTML の本文をつなぐ。章ごとに改ページする
 *  - CSS は <style> にしてまとめる (章の <link> と <style> を、最初に出た順に 1 度ずつ)。画像は名前つきで返す
 */
import { disabledAlternateStylesheet, linkRelTokens } from './htmlPrepare';
import { EPUB_MAX_ENTRIES, EPUB_MAX_ENTRY_BYTES, EPUB_MAX_TOTAL_BYTES } from './imageLimits';
import { msg } from './messages';

export interface ZipEntry {
  name: string;
  data: () => Promise<Uint8Array>;
}

/** 展開の上限 (既定は imageLimits.ts の値。テストは小さな値に差し替える) */
export interface ZipLimits {
  /** 1 つの項目の、展開した後の大きさの上限 (バイト) */
  maxEntryBytes: number;
  /** 展開する量の合計の上限 (バイト。同じ項目を何度も展開すれば、その回数だけ数える) */
  maxTotalBytes: number;
  /** 項目の数の上限 */
  maxEntries: number;
}
const DEFAULT_LIMITS: ZipLimits = { maxEntryBytes: EPUB_MAX_ENTRY_BYTES, maxTotalBytes: EPUB_MAX_TOTAL_BYTES, maxEntries: EPUB_MAX_ENTRIES };

/**
 * 展開の上限を超えた誤り。scope: entry は 1 つの項目が大きすぎる (その項目だけ読めないものとして扱える)、
 * total は合計が大きすぎる・entries は項目が多すぎる (その zip は読まない)
 */
export class ZipLimitError extends Error {
  constructor(
    message: string,
    readonly scope: 'entry' | 'total' | 'entries',
  ) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

/**
 * zip の項目が読めない誤り (位置・大きさが zip の外を指す、暗号化されている、ZIP64 の項目、対応していない圧縮方式)。
 * EPUB の章・CSS・画像なら、その項目だけを読めないものとして飛ばす (readEpub の warnings に書く)
 */
export class ZipEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipEntryError';
  }
}

/**
 * EPUB の章 (HTML) と CSS の字の数の合計の上限 (2^27 字 = 約 1.3 億字)。超えたら、その後の章は読まずに警告を出す。
 * 章をつないだ HTML は 1 つの文字列なので、V8 の文字列の長さの上限 (約 5.3 億字) を超えると「Invalid string length」で終わり、
 * その手前でも、展開の合計の上限 (1GB) に届くまで読むと、止まるまで 18 秒・1.46GB かかった (60,000 回 spine に並べた 8MB の章)。
 * 実在の本で文字の多いもの (全集・事典) でも、章の HTML の合計は数千万字なので、届かない
 */
export const EPUB_MAX_TEXT_CHARS = 2 ** 27;

const mb = (n: number) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)}MB` : `${n}B`);

/**
 * zip の中身の一覧 (名前と、展開する関数)。展開は、出力を数えながら行い、上限を超えたら、そこで止めて ZipLimitError を投げる
 * (中央ディレクトリに書かれた展開後の大きさは、偽れるので見ない)
 */
export function readZip(bytes: Uint8Array, limits: Partial<ZipLimits> = {}): ZipEntry[] {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  /** これまでに展開した量の合計 */
  let total = 0;
  const tooLarge = (name: string) => new ZipLimitError(msg(`${name}: 展開した大きさが上限 (${mb(lim.maxEntryBytes)}) を超えます`, `${name}: the uncompressed size exceeds the limit (${mb(lim.maxEntryBytes)})`), 'entry');
  const totalTooLarge = () => new ZipLimitError(msg(`zip の中身を展開した大きさの合計が上限 (${mb(lim.maxTotalBytes)}) を超えます`, `the total uncompressed size of the zip exceeds the limit (${mb(lim.maxTotalBytes)})`), 'total');
  /** n バイトを出力に足してよいか (1 つの項目の上限と、合計の上限)。size はその項目のこれまでの出力 */
  const take = (name: string, size: number, n: number) => {
    if (size + n > lim.maxEntryBytes) throw tooLarge(name);
    if (total + n > lim.maxTotalBytes) throw totalTooLarge();
    total += n;
  };
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
  const cdStart = v.getUint32(eocd + 16, true);
  // ZIP64 (項目の数・中央ディレクトリの位置が 16・32 ビットの最大値で、本当の値は ZIP64 の記録にある。APPNOTE 6.3 §4.4.1.4) は読まない
  if (count === 0xffff || cdStart === 0xffffffff) throw new Error(msg('ZIP64 の zip は読めません', 'ZIP64 archives are not supported'));
  if (count > lim.maxEntries) throw new ZipLimitError(msg(`zip の項目が多すぎます (${count} 個。上限 ${lim.maxEntries} 個)`, `the zip has too many entries (${count}; the limit is ${lim.maxEntries})`), 'entries');
  let p = cdStart;
  // 項目のデータは、中央ディレクトリより前にある (APPNOTE 6.3 §4.3.6 の並び)。データの範囲は、そこまでで切る
  const dataEnd = Math.min(cdStart, bytes.length);
  const out: ZipEntry[] = [];
  const utf8 = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const usize = v.getUint32(p + 24, true);
    const local = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    out.push({
      name,
      data: async () => {
        // 暗号化 (汎用の印の bit 0。APPNOTE 6.3 §4.4.4) の項目は読めない (暗号を解かずに展開すると、でたらめなデータになる)
        if (flags & 1) throw new ZipEntryError(msg(`${name}: 暗号化された項目は読めません`, `${name}: encrypted entries are not supported`));
        // ZIP64 の項目 (大きさ・位置が 32 ビットの最大値で、本当の値は拡張の欄にある。§4.4.8・§4.4.9・§4.4.16) は読まない
        if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw new ZipEntryError(msg(`${name}: ZIP64 の項目は読めません`, `${name}: ZIP64 entries are not supported`));
        // 局所ヘッダ (30 バイト + 名前 + 拡張の欄。§4.3.7) とデータが、zip のデータの範囲の内にあるか。
        // 偽の位置を読むと、DataView が生の RangeError を投げていた。範囲を超える大きさのデータは、後ろの項目・中央ディレクトリまで読んでいた
        const broken = () => new ZipEntryError(msg(`${name}: zip の項目の位置か大きさが壊れています`, `${name}: the offset or size of the zip entry is corrupt`));
        if (local + 30 > dataEnd || v.getUint32(local, true) !== 0x04034b50) throw broken();
        const ln = v.getUint16(local + 26, true);
        const le = v.getUint16(local + 28, true);
        const start = local + 30 + ln + le;
        if (start + csize > dataEnd) throw broken();
        const raw = bytes.subarray(start, start + csize);
        if (method === 0) {
          take(name, 0, raw.length);
          return raw;
        }
        if (method !== 8) throw new ZipEntryError(msg(`${name}: 対応していない圧縮方式 (${method})`, `${name}: unsupported compression method (${method})`));
        // 出力を塊ごとに受け取り、数えながらためる。上限を超えたら、残りを展開せずに止める
        const reader = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            take(name, size, value.length);
            size += value.length;
            chunks.push(value);
          }
        } catch (e) {
          await reader.cancel().catch(() => undefined);
          if (e instanceof ZipLimitError) throw e;
          // 壊れた deflate のデータ: DecompressionStream は文の無い TypeError を投げるので、どの項目か分かる文の誤りにする
          throw new ZipEntryError(msg(`${name}: 圧縮されたデータを展開できません (${e instanceof Error && e.message ? e.message : '壊れたデータ'})`, `${name}: cannot decompress the data (${e instanceof Error && e.message ? e.message : 'corrupt data'})`));
        }
        const outBytes = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          outBytes.set(c, at);
          at += c.length;
        }
        return outBytes;
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
  /** 読めなかった項目 (展開の上限を超えた章・CSS・画像) の警告 */
  warnings?: string[];
}

type ParseXml = (text: string, type: 'application/xml' | 'text/html') => Document;

/**
 * EPUB を 1 つの HTML にまとめる。parse: XML / HTML の文字列を文書にする (ブラウザでは DOMParser)。
 * limits: 展開の上限 (既定は imageLimits.ts の値)。1 つの項目の上限を超えた章・CSS・画像は、読めないものとして飛ばし (warnings に書く)、
 * 合計の上限を超えたら、誤りで止める (ZipLimitError)。container.xml・OPF が上限を超えるときも、読めないので誤りで止める
 */
export async function readEpub(bytes: Uint8Array, parse: ParseXml, limits: Partial<ZipLimits> & { maxTextChars?: number } = {}): Promise<EpubBook> {
  const maxEntries = limits.maxEntries ?? EPUB_MAX_ENTRIES;
  const maxTextChars = limits.maxTextChars ?? EPUB_MAX_TEXT_CHARS;
  /** これまでに読んだ章と CSS の字の数 */
  let textChars = 0;
  // 項目の名前は、メモリの上の表の鍵にするだけ (ファイルには書き出さない)。名前に ../ があっても、表の外には出ない。
  // 文書からの参照は resolvePath で .. を解いてから引く (根より上へは出ない) ので、../ を含む名前の項目には当たらない
  const entries = new Map(readZip(bytes, limits).map((e) => [e.name, e]));
  const text = async (name: string) => {
    const e = entries.get(name);
    return e ? new TextDecoder().decode(await e.data()) : undefined;
  };
  const warnings: string[] = [];
  /** 1 つの項目の上限を超えた誤りか、読めない項目の誤りなら、警告にして undefined を返す (その項目を飛ばす)。ほかの誤り (合計の上限など) は投げ直す */
  const skipTooLarge = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch (e) {
      if (!(e instanceof ZipEntryError) && (!(e instanceof ZipLimitError) || e.scope !== 'entry')) throw e;
      warnings.push(e.message);
      return undefined;
    }
  };
  const container = await text('META-INF/container.xml');
  if (!container) throw new Error('EPUB ではありません (META-INF/container.xml がありません)');
  // container.xml は XML として読む (属性の値の引用符は " でも ' でもよい。XML 1.0 §2.3 の AttValue)。最初の rootfile が既定の版
  // (EPUB 3.3 の OCF §4.2.6.3.1 の rootfile 要素)。XML として読めなければ、full-path の属性を文字として探す
  let opfPath: string | undefined;
  try {
    const cdoc = parse(container, 'application/xml');
    const rootfile = Array.from(cdoc.getElementsByTagName('*')).find((e) => e.localName === 'rootfile' && e.getAttribute('full-path'));
    opfPath = rootfile?.getAttribute('full-path') ?? undefined;
  } catch {
    /* 下の文字の探し方へ */
  }
  opfPath ||= /full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(container)?.slice(1).find(Boolean);
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
  // spine には同じ章を何度でも書けるので、章の並びの長さにも上限を当てる
  if (itemrefs.length > maxEntries) throw new ZipLimitError(msg(`EPUB の章の並び (spine) が長すぎます (${itemrefs.length} 個。上限 ${maxEntries} 個)`, `the spine of the EPUB is too long (${itemrefs.length}; the limit is ${maxEntries})`), 'entries');
  for (const [k, ref] of itemrefs.entries()) {
    const item = items.get(ref.getAttribute('idref') ?? '');
    if (!item) continue;
    const src = await skipTooLarge(() => text(item.href));
    if (src === undefined) continue;
    if (textChars + src.length > maxTextChars) {
      // 字の数の合計の上限 (EPUB_MAX_TEXT_CHARS)。この章とその後の章は読まない (読んだ所までを組む)
      const rest = itemrefs.length - k;
      warnings.push(msg(`EPUB の章の字の数の合計が上限 (${maxTextChars} 字) を超えるので、${item.href} から後の ${rest} 個の章を読みません`, `the total length of the EPUB chapters exceeds the limit (${maxTextChars} characters); ${rest} chapters from ${item.href} on are not read`));
      break;
    }
    textChars += src.length;
    // XHTML は XML として読む (<a/> のような空要素を正しく扱う)。読めなければ HTML として読む
    let doc = /xhtml|xml/.test(item.type) ? parse(src, 'application/xml') : undefined;
    if (!doc || doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('body')[0]) doc = parse(src, 'text/html');
    const dir = dirOf(item.href);
    // 章の文書ごとに、無効な代わりのスタイルシート (題つきの rel="alternate stylesheet"。CSSOM 1 §6.2) は当てない (HTML の文書と同じ決まり)
    const disabledAlternate = disabledAlternateStylesheet(doc);
    for (const l of Array.from(doc.getElementsByTagName('link'))) {
      if (!linkRelTokens(l).includes('stylesheet') || disabledAlternate(l)) continue;
      const p = resolvePath(dir, l.getAttribute('href') ?? '');
      if (seenCss.has(p)) continue;
      seenCss.add(p);
      const t = await skipTooLarge(() => text(p));
      if (t && textChars + t.length > maxTextChars) warnings.push(msg(`${p}: EPUB の字の数の合計が上限 (${maxTextChars} 字) を超えるので、この CSS を読みません`, `${p}: the total length of the EPUB text exceeds the limit (${maxTextChars} characters); this stylesheet is not read`));
      else if (t) (css.push(t), (textChars += t.length));
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
    // 章の body の属性 (class・id・lang・dir・style など) は section に、html の属性は section を包む div に写す
    // (章ごとの html・body はつないだ文書に残らないので、.vrtl { writing-mode: vertical-rl } のようなクラスの規則や、lang・dir・style の
    // 指定を章の中身に効かせる。html と body を別の要素にして、子孫の結合子 (.a .b) の関係も残す)。章の改ページは section の style に足す
    const bodyAttrs = wrapperAttrs(body, k > 0 ? 'break-before: page' : '');
    const htmlAttrs = doc.documentElement ? wrapperAttrs(doc.documentElement, '') : '';
    const section = `<section${bodyAttrs}>${inner}</section>`;
    sections.push(htmlAttrs ? `<div${htmlAttrs}>${section}</div>` : section);
  }
  const images: EpubBook['images'] = [];
  // 同じファイルを指す item は 1 度だけ読む。上限を超える画像は渡さない (読めない画像として組まれる)
  const seenImage = new Set<string>();
  for (const it of items.values()) {
    if (!/^image\//.test(it.type) || seenImage.has(it.href)) continue;
    seenImage.add(it.href);
    const e = entries.get(it.href);
    const data = e && (await skipTooLarge(() => e.data()));
    if (data) images.push({ name: it.href, data });
  }
  const html = `<!doctype html><html${lang ? ` lang="${escapeAttr(lang)}"` : ''}><head><meta charset="utf-8"><title>${escapeText(title ?? '')}</title>${css.map((c) => `<style>${c}</style>`).join('')}</head><body>${sections.join('')}</body></html>`;
  return { html, images, ...(title ? { title } : {}), ...(warnings.length ? { warnings } : {}) };
}

/**
 * 章の html・body の属性を、包む要素の属性の並びにする。名前空間の宣言は写さない。
 * xml:lang だけがあれば lang にする (HTML の構文の文書では、言語は lang 属性で決まる。HTML Living Standard §3.2.6.2)。
 * style には extraStyle を足す
 */
function wrapperAttrs(el: Element, extraStyle: string): string {
  let out = '';
  let style = extraStyle;
  let lang: string | undefined;
  let xmlLang: string | undefined;
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    if (a.name === 'style') style = a.value.trim() ? `${a.value.trim().replace(/;\s*$/, '')}${extraStyle ? `; ${extraStyle}` : ''}` : extraStyle;
    else if (a.name === 'lang') lang = a.value;
    else if (a.name === 'xml:lang') xmlLang = a.value;
    else out += ` ${a.name}="${escapeAttr(a.value)}"`;
  }
  if ((lang ?? xmlLang) !== undefined) out += ` lang="${escapeAttr((lang ?? xmlLang)!)}"`;
  if (style) out += ` style="${escapeAttr(style)}"`;
  return out;
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
  // pre・textarea・listing の開始タグの直後の改行は、HTML の構文では読み捨てられる (HTML Living Standard §13.2.6.4.7 の "pre"・"listing" と
  // "textarea" の開始タグ)。中身が改行で始まるときは、改行をもう 1 つ書く (§13.3 の書き出しの注意)
  const lead = /^(pre|textarea|listing)$/.test(name) && el.firstChild?.nodeType === 3 && (el.firstChild.textContent ?? '').startsWith('\n') ? '\n' : '';
  return `<${name}${attrs}>${lead}${Array.from(el.childNodes).map(toHtml).join('')}</${name}>`;
}

/** 属性の値の逃がし (" も) */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
