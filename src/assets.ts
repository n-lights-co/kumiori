import { epsPreview, imageInfo, pixelDensity } from './imageInfo';
import { emfToSvg, wmfToSvg } from './metafile';
import { epsBudgetOf, epsToSvg } from './eps';
import { cgmToSvg } from './cgm';
import { parseSvg, type XmlNode } from './svg';
import { decodeBmp, decodeGif, encodePng, MAX_PIXELS, pngWithinLimits, type Pixels } from './pixels';
import { lzwBytes } from './psFilters';
import { decodeWebp } from './webp';
import { ccittFits, decodeModifiedHuffman } from './ccitt';
import { fetchGuarded } from './resources';
import { fetchLimits } from './imageLimits';

/**
 * assets — 画像データの登録所。レイアウト (自然なサイズの取得)・Canvas 描画・PDF 埋め込みが共有する。
 *
 * キーは `url('img/a.png')` のような包みを外し、先頭の './' を除いた文字列。
 * 検索は「完全一致 → ファイル名 (basename) 一致」の順なので、FO が `img/a.png` と書いていても、
 * ユーザーが `a.png` だけ選択すれば解決できる。
 */

export interface ImageAsset {
  key: string;
  mime: string;
  /** 元ファイルのバイト列 (PNG/JPEG はそのまま PDF に埋め込む)。サイズだけの登録 (テスト用) では無い */
  bytes?: Uint8Array;
  /** 自然なサイズ (CSS px) */
  width: number;
  height: number;
  /** Canvas に描ける画像 (ブラウザのみ) */
  element?: CanvasImageSource;
  /** false: 大きさだけ分かり、中身は描けない (未対応の形式)。仮の枠で描く */
  drawable?: false;
  /** 描けない理由 (画像を描けない環境 (Node) で、PDF に入れられない形式 (GIF など) や、図形にできない SVG の機能 (filter・marker など))。組版の警告に出す */
  unsupported?: string;
  /** 描いたが、中の一部を描けなかったもの (CGM の読めない要素、WMF・EMF・CGM の上限を超えた画像など)。組版の警告に出す (IMG-19 (4)) */
  notes?: string[];
  /** 画像に書かれた解像度 (dpi。PNG・JPEG)。width / height は 96dpi とみなした大きさのまま */
  dpi?: number;
}

export function normalizeSrc(src: string): string {
  let s = src.trim();
  const m = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(s);
  if (m) s = m[2];
  s = s.replace(/^['"]|['"]$/g, '').trim();
  if (/^data:/i.test(s)) return s;
  s = s.replace(/^\.\//, '').replace(/\\/g, '/');
  try {
    s = decodeURI(s);
  } catch {
    /* そのまま */
  }
  return s;
}

/** 画像 (と MathML の文字のファイル) の拡張子 */
const IMAGE_EXT = '(?:png|jpe?g|gif|svgz?|webp|tiff?|bmp|emf|wmf|eps|ps|cgm|mml|xml)';

/**
 * 文字列 (HTML・FO・CSS・SVG) の中に名前が出てくる、画像の拡張子のファイル名 (小文字の basename)。
 * 引用符の中の値は空白を含めて拾い、引用符の外 (CSS の url(a.png) など) は空白・括弧・引用符までを拾う。%xx は戻す
 */
export function mentionedFiles(texts: string[]): Set<string> {
  const out = new Set<string>();
  const add = (raw: string) => {
    let name = raw;
    try {
      name = decodeURIComponent(name);
    } catch {
      /* そのまま */
    }
    out.add(name.split(/[\\/]/).pop()!.toLowerCase());
  };
  const quoted = new RegExp(`["']([^"'<>]*?\\.${IMAGE_EXT})(?=[?#"'])`, 'gi');
  // 拡張子の後ろに英数字・ハイフン・「.英数字」が続くもの (a.png.bak など) は、名前が続いているので拾わない
  const bare = new RegExp(`\\.${IMAGE_EXT}(?![\\w-]|\\.\\w)`, 'gi');
  // 引用符の外の名前は、拡張子を先に探して、そこから前へ、区切りの字 (か、前の名前の終わり) までたどる。名前の先頭から拡張子を探す形
  // (区切りでない字の並び + 拡張子) は、区切りの無い長い並び (data: の URL の base64 など) で、並びの長さの 2 乗の手間になり、
  // 書体を data: で埋め込んだ 700KB ほどの文書 (細工の無いもの) で 1 分を超えていた
  const isDelim = (c: string) => /[\s"'()<>=,;\\]/.test(c);
  for (const t of texts) {
    for (const m of t.matchAll(quoted)) add(m[1]);
    let prevEnd = 0;
    for (const m of t.matchAll(bare)) {
      const end = m.index + m[0].length;
      let start = m.index;
      while (start > prevEnd && !isDelim(t[start - 1])) start--;
      // 名前の部分 (拡張子の前) が空のものは拾わない (前の形と同じ: 1 字以上)
      if (start < m.index) add(t.slice(start, end));
      prevEnd = end;
    }
  }
  return out;
}

const basename = (s: string) => s.split(/[?#]/)[0].split('/').pop() ?? s;

export class AssetStore {
  private map = new Map<string, ImageAsset>();
  private byBase = new Map<string, ImageAsset>();
  /** 画像でない文字のファイル (external-graphic で指す MathML)。キーは画像と同じ (完全一致・basename) */
  private texts = new Map<string, string>();
  /** 画像でないファイル (添付ファイルの注釈の中身など)。完全一致と basename で引く */
  private files = new Map<string, Uint8Array>();

  /**
   * parseXml: 画像を描けない環境 (Node) で、SVG を図形にできるか (PDF に描けるか) を読み込むときに確かめる XML のパーサ。
   * 図形にできない SVG (filter・marker など) は、大きさだけの画像 (仮の枠) にする
   */
  constructor(private opts: { parseXml?: (xml: string) => XmlNode } = {}) {}

  get size() {
    return this.map.size;
  }

  register(src: string, a: Omit<ImageAsset, 'key'>): ImageAsset {
    const key = normalizeSrc(src);
    const asset = { ...a, key };
    this.map.set(key, asset);
    if (!key.startsWith('data:')) this.byBase.set(basename(key).toLowerCase(), asset);
    return asset;
  }

  /** サイズだけ登録 (レイアウトの確認・テスト用) */
  registerSize(src: string, width: number, height: number, mime = 'image/png') {
    return this.register(src, { mime, width, height });
  }

  get(src: string): ImageAsset | undefined {
    const key = normalizeSrc(src);
    return this.map.get(key) ?? (key.startsWith('data:') ? undefined : this.byBase.get(basename(key).toLowerCase()));
  }

  clear() {
    this.map.clear();
    this.byBase.clear();
    this.texts.clear();
    this.files.clear();
  }

  /** 文字のファイルを登録する (MathML など。組版時に読む) */
  registerText(src: string, text: string) {
    const key = normalizeSrc(src);
    this.texts.set(key, text);
    this.texts.set('\0' + basename(key).toLowerCase(), text);
  }

  /** 画像でないファイル (添付ファイルの注釈の中身) を登録する */
  registerFile(src: string, bytes: Uint8Array) {
    const key = normalizeSrc(src);
    this.files.set(key, bytes);
    this.files.set('\0' + basename(key).toLowerCase(), bytes);
  }

  /** 登録したファイルの中身 (完全一致 → basename)。data: の URI は中身を読んで返す */
  getFile(src: string): Uint8Array | undefined {
    const key = normalizeSrc(src);
    const hit = this.files.get(key) ?? this.files.get('\0' + basename(key).toLowerCase());
    if (hit) return hit;
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(src);
    if (!m) return undefined;
    try {
      if (m[1]) {
        const bin = atob(m[2].replace(/\s+/g, ''));
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
      }
      return new TextEncoder().encode(decodeURIComponent(m[2]));
    } catch {
      return undefined;
    }
  }

  /** 登録した文字のファイル (完全一致 → basename) */
  getText(src: string): string | undefined {
    const key = normalizeSrc(src);
    return this.texts.get(key) ?? this.texts.get('\0' + basename(key).toLowerCase());
  }

  // ───────────── ブラウザでの読み込み ─────────────

  /**
   * ファイル (Blob) を読み込んで登録する。デコードできなければ undefined。
   * 壊れたファイル・細工したファイルでデコーダが例外を出しても、文書全体の読み込みは止めない (描けない画像として登録する)
   */
  async addBlob(name: string, blob: Blob): Promise<ImageAsset | undefined> {
    if (blob.size > MAX_FILE_BYTES) return undefined;
    let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    // gzip で圧縮した SVG (.svgz) は展開して SVG として読む (展開した大きさに上限を置く)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      const out = await gunzipLimited(bytes, MAX_FILE_BYTES);
      if (out) bytes = out;
    }
    try {
      return await this.decodeBytes(name, blob, bytes);
    } catch {
      const info = imageInfo(bytes);
      if (!info) return undefined;
      const label = info.mime === 'application/postscript' ? 'EPS' : info.mime.replace(/^image\//, '').toUpperCase();
      return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, drawable: false, ...(noCanvas() ? { unsupported: `${label} (読めないファイル)` } : {}) });
    }
  }

  private async decodeBytes(name: string, blob: Blob, bytes: Uint8Array): Promise<ImageAsset | undefined> {
    // ブラウザが描けない形式 (TIFF・WMF・EMF・EPS・CGM): 大きさだけ読んで登録する (仮の枠を正しい寸法で組む)
    const info = imageInfo(bytes);
    if (info) {
      // EPS は PostScript を実行して描く (図形と画像。eps.ts)。描けないもの (解釈系が warnings に入れる。CMYK の JPEG・一部の複合書体の文字など) があり、プレビューを持つときは、プレビューで描く
      let epsSvg: string | undefined;
      if (info.mime === 'application/postscript') {
        // 実行の時間は、この入れ物 (文書) の EPS の合計にも上限がある (eps.ts の EPS_DOCUMENT_MILLIS)
        const r = await epsToSvg(bytes, { budget: epsBudgetOf(this) }).catch(() => undefined);
        if (r && r.count > 0 && (!r.warnings.length || !epsPreview(bytes))) epsSvg = r.svg;
      }
      // TIFF と、TIFF のプレビューを持つ EPS は、画素を読んで描く (大きさは元の形式の値)
      const tiff = epsSvg ? undefined : info.mime === 'image/tiff' ? bytes : info.mime === 'application/postscript' ? epsPreview(bytes) : undefined;
      const isTiff = !!tiff && tiff[0] === tiff[1] && (tiff[0] === 0x49 || tiff[0] === 0x4d);
      // 画像を描けない環境 (Node): 画素を PNG にして PDF に入れる
      const px = isTiff && noCanvas() ? await tiffPixels(tiff!) : undefined;
      if (px) return this.register(name, { mime: 'image/png', bytes: await encodePng(px), width: info.width, height: info.height });
      const element = isTiff ? await decodeTiff(tiff!) : undefined;
      if (element) return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, element });
      // WMF・EMF (と WMF のプレビューを持つ EPS) は、描画命令を SVG にして描く (PDF にはベクターのまま入る)
      const preview = info.mime === 'application/postscript' && tiff && !element ? tiff : undefined;
      // CGM は要素を読んで SVG にする (cgm.ts)
      // 描けなかった要素・上限を超えて描かなかった画像の警告 (cgm.ts の CgmResult.warnings・metafile.ts の warnings) は、描いた画像の notes にして
      // 組版の警告に出す (前は捨てていた。IMG-19 (4))
      const notes: string[] = [];
      const cgm = !epsSvg && info.mime === 'image/cgm' ? cgmToSvg(bytes) : undefined;
      if (cgm) notes.push(...cgm.warnings);
      const svg =
        epsSvg ??
        cgm?.svg ??
        (info.mime === 'image/wmf' ? wmfToSvg(bytes, undefined, undefined, notes) : info.mime === 'image/emf' ? emfToSvg(bytes, undefined, undefined, notes) : preview ? wmfToSvg(preview, info.width, info.height, notes) : undefined);
      if (svg) {
        const sb = new TextEncoder().encode(svg);
        const extra = notes.length ? { notes: [...new Set(notes)] } : {};
        // 画像を描けない環境 (Node): SVG のまま登録する (PDF には図形で描く)
        if (noCanvas() && this.opts.parseXml && parseSvg(svg, this.opts.parseXml, { outline: () => ({ segs: [], advance: 0 }) }))
          return this.register(name, { mime: 'image/svg+xml', bytes: sb, width: info.width, height: info.height, ...extra });
        try {
          const d = await decode(sb, 'image/svg+xml');
          return this.register(name, { mime: 'image/svg+xml', bytes: sb, width: info.width, height: info.height, element: d.element, ...extra });
        } catch {
          /* 描けなければ仮の枠 */
        }
      }
      // 描けない形式 (CGM・プレビューの無い EPS など)。Node では警告に出す
      const label = info.mime === 'application/postscript' ? 'EPS' : info.mime.replace(/^image\//, '').toUpperCase();
      return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, drawable: false, ...(noCanvas() ? { unsupported: label } : {}) });
    }
    const mime = sniffMime(bytes, blob.type || mimeFromName(name));
    if (!mime) {
      // MathML の文字のファイル (.mml / .xml) は、画像ではなく文字として登録する
      const text = new TextDecoder().decode(bytes);
      if (/<([\w-]+:)?math[\s>]/.test(text)) this.registerText(name, text);
      return undefined;
    }
    const dpi = pixelDensity(bytes);
    // 画像を描けない環境 (Node): 大きさはファイルの頭から読み、元のバイト列だけを持つ (PDF には PNG・JPEG をそのまま入れ、SVG は図形で描く。GIF・BMP は PNG にする)
    if (noCanvas()) {
      const size = headerSize(bytes, mime);
      if (!size) return undefined;
      // GIF・BMP・WebP は画素を読んで PNG にする (大きさは元の画像の大きさ)
      const px = mime === 'image/gif' ? decodeGif(bytes) : mime === 'image/bmp' ? decodeBmp(bytes) : mime === 'image/webp' ? decodeWebp(bytes) : undefined;
      if (px) return this.register(name, { mime: 'image/png', bytes: await encodePng(px), width: size.width, height: size.height, ...(dpi ? { dpi } : {}) });
      // PNG は PDF に入れるとき (pdf-lib の embedPng) に展開するので、展開の大きさの上限を先に確かめる (pixels.ts の pngWithinLimits。IMG-19)
      if (mime === 'image/png' && !pngWithinLimits(bytes))
        return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: 'PNG (画素の数か展開の大きさが上限を超える)' });
      // PDF に入れられるのは PNG・JPEG・図形にできる SVG だけ (読めない GIF・BMP・WebP は画素に直せない)
      if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/svg+xml') {
        const label = mime === 'image/webp' ? 'WebP' : mime.replace(/^image\//, '').toUpperCase();
        return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: label });
      }
      if (mime === 'image/svg+xml' && this.opts.parseXml) {
        let what = '';
        // text は組版のときに字形の輪郭にできるので、ここでは描けるものとして確かめる。filter (影・ぼかし) は PDF に近似で描く
        const doc = parseSvg(new TextDecoder().decode(bytes), this.opts.parseXml, { outline: () => ({ segs: [], advance: 0 }), approximateFilters: true, onUnsupported: (w) => (what = w) });
        if (!doc) return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: what });
      }
      return this.register(name, { mime, bytes, width: size.width, height: size.height, ...(dpi ? { dpi } : {}) });
    }
    try {
      const { element, width, height } = await decode(bytes, mime);
      return this.register(name, { mime, bytes, width, height, element, ...(dpi ? { dpi } : {}) });
    } catch {
      return undefined;
    }
  }

  async addDataUri(uri: string): Promise<ImageAsset | undefined> {
    // RFC 2397 §3: dataurl := "data:" [ mediatype ] [ ";base64" ] "," data、mediatype := [ type "/" subtype ] *( ";" parameter )。
    // 種類の後ろのパラメータ (;charset=utf-8 など) は読み飛ばす
    const m = /^data:([^;,]*)(?:;[^;,]*)*?(;base64)?,(.*)$/is.exec(uri);
    if (!m) return undefined;
    // base64 でなければ、中身はバイトの並びを %xx で書いたもの (RFC 2397 §2)。字の番号をそのまま 1 バイトにしない (日本語の SVG が化ける)。
    // 壊れた base64 は、読めない画像として扱う (例外を外へ出さない。getFile と同じ)
    let bytes: Uint8Array;
    try {
      bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : percentDecodeBytes(m[3]);
    } catch {
      return undefined;
    }
    const asset = await this.addBlob(uri, new Blob([bytes as BlobPart], { type: m[1] }));
    return asset;
  }

  /**
   * 絶対 URL から取得 (CORS で拒否されることがある)。timeoutMs を過ぎたら取得をやめる (画像は描かない。時限は本体を読み終えるまで効く)。
   * allow: 取ってよい URL か。転送 (redirect) の先の URL にも聞く (fetchGuarded)。大きすぎる本体 (fetchLimits.imageBytes) は、読むのを途中でやめる
   */
  async addUrl(url: string, timeoutMs?: number, allow?: (url: string) => boolean): Promise<ImageAsset | undefined> {
    const got = await fetchGuarded(url, { timeoutMs, maxBytes: fetchLimits.imageBytes, ...(allow ? { allow } : {}) });
    if (!got) return undefined;
    try {
      return await this.addBlob(url, new Blob([got.bytes as BlobPart], { type: got.type }));
    } catch {
      return undefined;
    }
  }

  /**
   * PDF 用の画像データ。PNG/JPEG はそのまま、それ以外 (SVG・GIF・BMP・WebP) は Canvas で PNG に変換する。
   * widthPx: 変換時の横幅 (出力サイズと解像度から決める)。
   */
  async forPdf(src: string, widthPx: number): Promise<{ type: 'png' | 'jpg'; bytes: Uint8Array } | undefined> {
    const a = this.get(src);
    if (!a) return undefined;
    if (a.bytes && a.mime === 'image/png') return { type: 'png', bytes: a.bytes };
    if (a.bytes && a.mime === 'image/jpeg') return { type: 'jpg', bytes: a.bytes };
    return this.rasterize(a, widthPx);
  }

  async rasterize(a: ImageAsset, widthPx: number): Promise<{ type: 'png'; bytes: Uint8Array } | undefined> {
    if (!a.element) return undefined;
    const w = Math.max(1, Math.min(Math.round(widthPx), 6000));
    const h = Math.max(1, Math.round((w * a.height) / a.width));
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(a.element, 0, 0, w, h);
    try {
      const blob: Blob = canvas instanceof OffscreenCanvas ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      return { type: 'png', bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch {
      // 書き出せない画像 (ブラウザが汚染と見なした Canvas など) は PDF に入れない。PDF の書き出しそのものは続ける
      return undefined;
    }
  }
}

/**
 * %xx で書いたバイトの並びを戻す (RFC 3986 §2.1: %xx は 1 つのオクテット)。% で書いていない字は UTF-8 のバイトにする
 * (data URI にじかに書いた ASCII 以外の字)。16 進の 2 桁が続かない % は、そのままの字として残す (投げない)
 */
export function percentDecodeBytes(s: string): Uint8Array {
  const src = new TextEncoder().encode(s);
  const out = new Uint8Array(src.length);
  const hex = (c: number) => (c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1);
  let n = 0;
  for (let k = 0; k < src.length; k++) {
    const hi = src[k] === 0x25 && k + 2 < src.length ? hex(src[k + 1]) : -1;
    const lo = hi >= 0 ? hex(src[k + 2]) : -1;
    if (lo >= 0) {
      out[n++] = hi * 16 + lo;
      k += 2;
    } else out[n++] = src[k];
  }
  return out.subarray(0, n);
}

function mimeFromName(name: string): string {
  const e = /\.([a-z0-9]+)$/i.exec(basename(name))?.[1].toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' } as Record<string, string>)[e ?? ''] ?? '';
}

/**
 * 中身の先頭のバイト列が、対応している画像の形式か (名前に画像の拡張子の無いファイルを、画像として読むかどうかを決める)。
 * PNG・JPEG・GIF・BMP・WebP は先頭の印 (MIME Sniffing Standard §6.1「Matching an image type pattern」の表にある形式。sniffMime)、
 * TIFF・WMF・EMF・EPS・CGM は imageInfo の判定。SVG は、先頭に <svg がある文字 (同 §8.2 では、XML の種類は Content-Type で決まり、
 * 中身では見分けない。Content-Type の無い中身 (resolveResource の返した中身) も SVG として読めるように、ここでは中身で見る)
 */
export function looksLikeImage(bytes: Uint8Array): boolean {
  return !!imageInfo(bytes) || !!sniffMime(bytes, '');
}

/**
 * マジックナンバーで形式を判定 (拡張子・Content-Type が当てにならない場合に備える)。
 * 中身の先頭の印を先に見て、当たらなければ、渡された種類 (応答の Content-Type・data: の種類・名前の拡張子) が画像ならそれ
 * (MIME Sniffing Standard §8.2「Sniffing in an image context」の 2〜4。印は §6.1 の表のうち、対応している形式)
 */
function sniffMime(b: Uint8Array, hint: string): string {
  const s = (i: number, str: string) => [...str].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0x89 && s(1, 'PNG')) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (s(0, 'GIF8')) return 'image/gif';
  if (s(0, 'BM')) return 'image/bmp';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || /<svg[\s>]/.test(head)) return 'image/svg+xml';
  return hint.startsWith('image/') ? hint : '';
}

/**
 * パレット色 (PhotometricInterpretation=3) で、色番号の後ろに別のサンプル (透明度など) が付いた 8 ビットの TIFF。
 * utif はこの形を正しく読めないので、ここで RGBA にする (EPS のプレビューに使われる)
 */
function paletteWithExtra(ifd: { width: number; height: number; [k: string]: unknown }, buf?: ArrayBuffer): Uint8Array | undefined {
  const tag = (k: number) => ifd[`t${k}`] as number[] | undefined;
  const spp = tag(277)?.[0] ?? 1;
  if (tag(262)?.[0] !== 3 || spp < 2 || (tag(258)?.[0] ?? 8) !== 8) return undefined;
  const n0 = ifd.width * ifd.height * spp;
  let data = ifd.data as Uint8Array | undefined;
  // utif は BitsPerSample が 1 つだけ書かれていると、1 画素を 1 サンプル (1 バイト) とみなして半分しか取り出さない。
  // 圧縮なし (Compression=1) なら、ストリップを元のバイト列から直接つなげて読む
  if ((!data || data.length < n0) && (tag(259)?.[0] ?? 1) === 1 && buf) {
    const offs = tag(273) ?? [];
    const lens = tag(279) ?? [];
    const raw = new Uint8Array(n0);
    let o = 0;
    for (let k = 0; k < offs.length && o < n0; k++) {
      const len = Math.min(lens[k] ?? 0, n0 - o, Math.max(buf.byteLength - offs[k], 0));
      raw.set(new Uint8Array(buf, offs[k], len), o);
      o += len;
    }
    if (o >= n0) data = raw;
  }
  const map = tag(320);
  if (!data || !map) return undefined;
  const n = ifd.width * ifd.height;
  const out = new Uint8Array(n * 4);
  const third = map.length / 3;
  for (let i = 0; i < n; i++) {
    const idx = data[i * spp];
    out[i * 4] = map[idx] >> 8;
    out[i * 4 + 1] = map[third + idx] >> 8;
    out[i * 4 + 2] = map[2 * third + idx] >> 8;
    // 2 つ目のサンプルが透明度 (ExtraSamples=1・2) なら使う。それ以外は不透明
    const extra = tag(338)?.[0];
    out[i * 4 + 3] = extra === 1 || extra === 2 ? data[i * spp + 1] : 255;
  }
  return out;
}

/**
 * CCITT の符号の TIFF (Compression=2・3・4) の寸法 (ImageWidth × ImageLength) が、ストリップ・タイルのデータの合計の大きさで読める範囲にあるか
 * (ccitt.ts の ccittFits: 2 次元の符号なら行の数はデータのビット数まで、画素の数は符号の密度の上限まで)。CCITT の符号でなければ true
 */
export function ccittWithinLimits(ifd: { [k: string]: unknown }, buf: ArrayBuffer): boolean {
  const tag = (k: number) => ifd[`t${k}`] as number[] | undefined;
  const comp = tag(259)?.[0];
  if (comp !== 2 && comp !== 3 && comp !== 4) return true;
  const twoD = comp === 4 || (comp === 3 && !!((tag(292)?.[0] ?? 0) & 1));
  const tiled = !!(tag(322)?.[0] && tag(323)?.[0] && tag(324)?.length);
  const offs = (tiled ? tag(324) : tag(273)) ?? [];
  const lens = (tiled ? tag(325) : tag(279)) ?? [];
  let bytes = 0;
  for (let k = 0; k < offs.length; k++) bytes += Math.min(lens[k] ?? 0, Math.max(buf.byteLength - offs[k], 0));
  return ccittFits(tag(256)?.[0] ?? 0, tag(257)?.[0] ?? 0, bytes, twoD);
}

/**
 * CCITT の符号の TIFF (Compression=2・3・4) の画素 (ccitt.ts で読む)。
 * PhotometricInterpretation が WhiteIsZero (0) なら CCITT の白を白に、BlackIsZero (1) なら白と黒を入れ替える (TIFF 6.0 Section 10・11)。
 * 対象でなければ、または読めなければ undefined
 */
export function ccittPixels(ifd: { [k: string]: unknown }, buf: ArrayBuffer): Pixels | undefined {
  const tag = (k: number) => ifd[`t${k}`] as number[] | undefined;
  const comp = tag(259)?.[0];
  if (comp !== 2 && comp !== 3 && comp !== 4) return undefined;
  const t4 = comp === 3 ? (tag(292)?.[0] ?? 0) : 0;
  const width = tag(256)?.[0] ?? 0;
  const height = tag(257)?.[0] ?? 0;
  if (!width || !height || !ccittWithinLimits(ifd, buf)) return undefined;
  const photo = tag(262)?.[0] ?? 0;
  const rgba = new Uint8Array(width * height * 4);
  /** 1 つの塊 (ストリップ・タイル) を展開し、画像の (x0, y0) から w × rows を写す (ImageWidth・ImageLength の外の埋めた画素は捨てる) */
  const segment = (off: number, count: number, w: number, rows: number, x0: number, y0: number): boolean => {
    const len = Math.min(count, Math.max(buf.byteLength - off, 0));
    const bits = decodeModifiedHuffman(new Uint8Array(buf, off, len), { width: w, rows, compression: comp, twoDimensional: !!(t4 & 1), fillOrder: tag(266)?.[0] });
    if (!bits) return false;
    for (let r = 0; r < rows && y0 + r < height; r++) {
      for (let c = 0; c < w && x0 + c < width; c++) {
        const black = (bits[r * w + c] === 1) !== (photo === 1);
        const v = black ? 0 : 255;
        const q = ((y0 + r) * width + x0 + c) * 4;
        rgba[q] = rgba[q + 1] = rgba[q + 2] = v;
        rgba[q + 3] = 255;
      }
    }
    return true;
  };
  const tw = tag(322)?.[0];
  const tl = tag(323)?.[0];
  const toffs = tag(324);
  if (tw && tl && toffs?.length) {
    // タイル (TIFF 6.0 Section 15): 左から右、上から下の順。各タイルは TileWidth × TileLength で、別々に符号化されている
    const across = Math.ceil(width / tw);
    const tlens = tag(325) ?? [];
    // タイルの数は、画像を覆う数まで (TIFF 6.0 Section 15: TilesPerImage = TilesAcross × TilesDown)。TileOffsets の項目の数だけ回すと、
    // 同じデータを指す項目を並べて、1 項目 (8 バイト) ごとにタイル 1 枚ぶんを展開させられる
    const count = Math.min(toffs.length, across * Math.ceil(height / tl));
    for (let k = 0; k < count; k++) {
      if (!segment(toffs[k], tlens[k] ?? 0, tw, tl, (k % across) * tw, Math.floor(k / across) * tl)) return undefined;
    }
    return { width, height, rgba };
  }
  const offs = tag(273) ?? [];
  const lens = tag(279) ?? [];
  if (!offs.length) return undefined;
  const perStrip = Math.min(tag(278)?.[0] ?? height, height);
  for (let s = 0, y = 0; s < offs.length && y < height; s++, y += perStrip) {
    if (!segment(offs[s], lens[s] ?? 0, width, Math.min(perStrip, height - y), 0, y)) return undefined;
  }
  return { width, height, rgba };
}

/**
 * TIFF の IFD の並び (TIFF 6.0 Section 2) を、utif に渡してよいか。utif (3.1.0) の読み取りは、次の IFD の位置の輪・項目の値の数・
 * 値の位置を確かめないので、次の IFD が自分自身を指す 122 バイトのファイルや、値の数が何千万もの項目で、メモリを使い切るまで読み続ける。
 * utif と同じ順 (IFD の鎖と、SubIFDs (330)・Exif IFD (34665)・DNGPrivateData (50740) の下の IFD) にたどって、次を確かめる:
 *  - 同じ位置の IFD を 2 度読まない (輪)。IFD の数は TIFF_MAX_IFDS まで、下の IFD の入れ子は 4 段まで
 *  - IFD と、項目の値 (型の大きさ × 数。Section 2 の Types) が、ファイルの中に収まる
 * 普通の TIFF (42) だけを読む (utif は BigTIFF を読めない)
 */
const TIFF_MAX_IFDS = 256;
export function tiffStructureOk(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  const le = b[0] === 0x49 && b[1] === 0x49;
  if (!le && !(b[0] === 0x4d && b[1] === 0x4d)) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint16(2, le) !== 42) return false;
  // 型の大きさ (1 BYTE・2 ASCII・3 SHORT・4 LONG・5 RATIONAL・6 SBYTE・7 UNDEFINED・8 SSHORT・9 SLONG・10 SRATIONAL・11 FLOAT・12 DOUBLE・13 IFD)
  const SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  const seen = new Set<number>();
  /** 位置 at の IFD を確かめ、次の IFD の位置を返す (読めなければ -1) */
  const walk = (at: number, depth: number): number => {
    if (seen.has(at) || seen.size >= TIFF_MAX_IFDS || depth > 4 || at + 2 > b.length) return -1;
    seen.add(at);
    const n = dv.getUint16(at, le);
    if (at + 2 + n * 12 + 4 > b.length) return -1;
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = dv.getUint16(e, le);
      const type = dv.getUint16(e + 2, le);
      const num = dv.getUint32(e + 4, le);
      const bytes = (SIZE[type] ?? 1) * num;
      if (bytes > b.length) return -1;
      const voff = bytes > 4 ? dv.getUint32(e + 8, le) : e + 8;
      if (voff + bytes > b.length) return -1;
      if (tag === 330 || tag === 34665 || tag === 50740) {
        // 下の IFD の位置 (LONG・IFD の並び。50740 は、utif と同じく、値の先頭の 4 バイトを位置として読む)
        if (tag !== 50740 && type !== 4 && type !== 13) return -1;
        const count = tag === 50740 ? (bytes >= 4 ? 1 : 0) : num;
        for (let j = 0; j < count; j++) {
          const sub = dv.getUint32(voff + j * 4, le);
          // 50740 は、utif が IFD と見るとき (項目の数が 300 未満) だけ
          if (tag === 50740 && !(sub + 2 <= b.length && dv.getUint16(sub, le) < 300)) continue;
          if (walk(sub, depth + 1) < 0) return -1;
        }
      }
    }
    return dv.getUint32(at + 2 + n * 12, le);
  };
  for (let at = dv.getUint32(4, le); at !== 0; ) {
    at = walk(at, 0);
    if (at < 0) return false;
  }
  return seen.size > 0;
}

/** TIFF の最初の画像の画素 (utif で読む)。読めなければ undefined */
async function tiffPixels(bytes: Uint8Array): Promise<Pixels | undefined> {
  try {
    const UTIF = (await import('utif')).default;
    // utif は IFD の並びを確かめないので、渡す前に確かめる (tiffStructureOk)
    if (!tiffStructureOk(bytes)) return undefined;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ifds = UTIF.decode(buf);
    if (!ifds.length) return undefined;
    const fax = ccittPixels(ifds[0], buf);
    if (fax) return fax;
    // 画素の数の上限 (imageLimits.ts の MAX_PIXELS)。utif は、IFD に書かれた寸法 (ImageWidth × ImageLength。TIFF 6.0 Section 8) のとおりに
    // 画素の領域を確保してから展開する。PackBits・LZW・Deflate はデータの長さで縛れないので、寸法を先に確かめる
    // (124 バイトの PackBits の TIFF で、寸法どおりの領域と RGBA を確保し、常駐のメモリを 1.6GB 使っていた。IMG-18)
    const tagOf = (k: number) => Number((ifds[0][`t${k}`] as number[] | undefined)?.[0] ?? 0);
    if (!(tagOf(256) > 0 && tagOf(257) > 0) || tagOf(256) * tagOf(257) > MAX_PIXELS) return undefined;
    // CCITT の符号は、自前の復号 (ccittPixels) で読めなかったときも、データの大きさの上限 (ccittWithinLimits) を超えれば utif に渡さない
    // (utif も寸法のとおりに確保する。IMG-19)
    if (!ccittWithinLimits(ifds[0], buf)) return undefined;
    // ストリップ・タイルの長さ (StripByteCounts 279・TileByteCounts 325) は、ファイルに残っている長さまで、RowsPerStrip (278) は画像の高さまでにする
    // (TIFF 6.0 Section 8: RowsPerStrip の既定は 2^32 − 1 で、「画像の全体が 1 つのストリップ」の意味)。utif は、書かれた値のとおりに回る
    const ifd0 = ifds[0] as unknown as Record<string, number[] | undefined>;
    for (const [offTag, lenTag] of [[273, 279], [324, 325]] as const) {
      const offs = ifd0[`t${offTag}`];
      const lens = ifd0[`t${lenTag}`];
      if (!offs || !lens) continue;
      // 位置の数は、画素の数まで (1 つのストリップ・タイルは 1 画素以上)
      if (offs.length > tagOf(256) * tagOf(257)) return undefined;
      ifd0[`t${lenTag}`] = Array.from(lens, (v, k) => Math.max(0, Math.min(v, buf.byteLength - (offs[k] ?? 0))));
    }
    if (ifd0.t278?.length) ifd0.t278 = [Math.max(1, Math.min(ifd0.t278[0], tagOf(257)))];
    // LZW (Compression=5) は、自前の展開 (psFilters の lzwBytes。TIFF 6.0 Section 13 の形) に差し替える。utif の展開は、EOI の符号が出るまで、
    // データの終わりを越えても回り続けるので、EOI の無い (途中で切れた・壊れた) データで止まらない。自前の展開は、データの終わりか、
    // 出力の領域の終わりで止まる
    (UTIF.decode as unknown as { _decodeLZW: (data: Uint8Array, off: number, tgt: Uint8Array, toff: number) => void })._decodeLZW = (data, off, tgt, toff) => {
      if (off >= data.length || toff >= tgt.length) return;
      tgt.set(lzwBytes(data.subarray(off), tgt.length - toff), toff);
    };
    UTIF.decodeImage(buf, ifds[0], ifds);
    const rgba = paletteWithExtra(ifds[0], buf) ?? UTIF.toRGBA8(ifds[0]);
    const { width, height } = ifds[0];
    if (!width || !height || rgba.length < width * height * 4) return undefined;
    return { width, height, rgba: new Uint8Array(rgba.buffer as ArrayBuffer, rgba.byteOffset, width * height * 4) };
  } catch {
    return undefined;
  }
}

/** TIFF の最初の画像を、Canvas に描ける画像にする。読めなければ undefined */
async function decodeTiff(bytes: Uint8Array): Promise<CanvasImageSource | undefined> {
  if (typeof createImageBitmap === 'undefined' || typeof ImageData === 'undefined') return undefined;
  const px = await tiffPixels(bytes);
  if (!px) return undefined;
  try {
    return await createImageBitmap(new ImageData(new Uint8ClampedArray(px.rgba.buffer as ArrayBuffer, px.rgba.byteOffset, px.rgba.length), px.width, px.height));
  } catch {
    return undefined;
  }
}

/** 画像を描けない環境 (Node) か */
const noCanvas = () => typeof createImageBitmap === 'undefined' && typeof Image === 'undefined';

async function decode(bytes: Uint8Array, mime: string): Promise<{ element: CanvasImageSource; width: number; height: number }> {
  let blob = new Blob([bytes as BlobPart], { type: mime });
  if (mime === 'image/svg+xml') {
    let text = new TextDecoder().decode(bytes);
    // <foreignObject> を含む SVG を描いた Canvas は、ブラウザが書き出しを拒む (PDF 用の PNG に変換できない)。
    // 取り除いて描く (Illustrator の SVG は <switch> の中の代わりの図形が使われる)
    if (/<foreignObject[\s>]/.test(text)) {
      text = text.replace(/<foreignObject[\s>][\s\S]*?<\/foreignObject>/g, '');
      blob = new Blob([text], { type: mime });
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg decode failed'));
      img.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
      w = vb ? parseFloat(vb[1]) : 300;
      h = vb ? parseFloat(vb[2]) : 150;
    }
    return { element: img, width: w, height: h };
  }
  const bmp = await createImageBitmap(blob);
  return { element: bmp, width: bmp.width, height: bmp.height };
}

/** PNG・JPEG・GIF・BMP・WebP・SVG の大きさ (px) を、ファイルの頭から読む (画像を描かない環境用) */
export function headerSize(b: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  // どれも、ファイルの頭の印を確かめる (拡張子だけが画像の、中身の違うファイルの大きさを読まない)
  if (mime === 'image/png' && b.length >= 24 && u32(0) === 0x89504e47) return { width: u32(16), height: u32(20) };
  if (mime === 'image/gif' && b.length > 10 && String.fromCharCode(b[0], b[1], b[2]) === 'GIF') return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  // BMP: BITMAPINFOHEADER の幅・高さ (符号付き 32 ビット、下から上へ並べるときは高さが負)
  if (mime === 'image/bmp' && b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const i32 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    return { width: Math.abs(i32(18)), height: Math.abs(i32(22)) };
  }
  if (mime === 'image/jpeg') {
    if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
    // SOF の印 (C0〜CF。C4・C8・CC を除く) の高さ・幅
    for (let o = 2; o + 9 < b.length; ) {
      if (b[o] !== 0xff) return undefined;
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16(o + 7), height: u16(o + 5) };
      o += 2 + u16(o + 2);
    }
    return undefined;
  }
  if (mime === 'image/webp' && b.length > 30 && String.fromCharCode(b[0], b[1], b[2], b[3], b[8], b[9], b[10], b[11]) === 'RIFFWEBP') {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (kind === 'VP8L') return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    return undefined;
  }
  if (mime === 'image/svg+xml') {
    const head = new TextDecoder().decode(b.subarray(0, 4096));
    const svg = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
    const len = (n: string) => {
      const m = new RegExp(`\\b${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|mm|cm|in)?\\s*["']`, 'i').exec(svg);
      if (!m) return undefined;
      const k = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(m[2] ?? 'px').toLowerCase() as 'px'];
      return parseFloat(m[1]) * k;
    };
    const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    const [vw, vh] = vb ? [parseFloat(vb[1]), parseFloat(vb[2])] : [undefined, undefined];
    // 幅・高さの指定が無ければ viewBox の大きさ。片方だけなら viewBox の縦横比で。どちらも無ければ 300×150 (ブラウザと同じ)
    const w = len('width') ?? (vw !== undefined && vh !== undefined && len('height') !== undefined ? (len('height')! * vw) / vh : vw);
    const h = len('height') ?? (vw !== undefined && vh !== undefined && w !== undefined ? (w * vh) / vw : undefined);
    return w && h ? { width: w, height: h } : { width: 300, height: 150 };
  }
  return undefined;
}

/** 読み込むファイルの大きさの上限 (展開した後も含む。256MB) */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** gzip を展開する。展開した大きさが limit を超えるか、展開できなければ undefined */
async function gunzipLimited(bytes: Uint8Array, limit: number): Promise<Uint8Array | undefined> {
  try {
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return undefined;
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const x of parts) {
      out.set(x, o);
      o += x.length;
    }
    return out;
  } catch {
    return undefined;
  }
}
