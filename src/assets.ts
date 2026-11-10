import { epsPreview, imageInfo, pixelDensity } from './imageInfo';
import { emfToSvg, wmfToSvg } from './metafile';
import { epsToSvg } from './eps';
import { cgmToSvg } from './cgm';
import { parseSvg, type XmlNode } from './svg';
import { decodeBmp, decodeGif, encodePng, MAX_PIXELS, type Pixels } from './pixels';
import { decodeWebp } from './webp';
import { decodeModifiedHuffman } from './ccitt';

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
  const bare = new RegExp(`[^\\s"'()<>=,;\\\\]+?\\.${IMAGE_EXT}(?![\\w-]|\\.\\w)`, 'gi');
  for (const t of texts) {
    for (const m of t.matchAll(quoted)) add(m[1]);
    for (const m of t.matchAll(bare)) add(m[0]);
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
      // EPS は PostScript を実行して描く (図形と画像。eps.ts)。まだ描けないもの (文字・模様) があり、プレビューを持つときは、プレビューで描く
      let epsSvg: string | undefined;
      if (info.mime === 'application/postscript') {
        const r = await epsToSvg(bytes).catch(() => undefined);
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
      const cgmSvg = info.mime === 'image/cgm' ? cgmToSvg(bytes)?.svg : undefined;
      const svg =
        epsSvg ??
        cgmSvg ??
        (info.mime === 'image/wmf' ? wmfToSvg(bytes) : info.mime === 'image/emf' ? emfToSvg(bytes) : preview ? wmfToSvg(preview, info.width, info.height) : undefined);
      if (svg) {
        const sb = new TextEncoder().encode(svg);
        // 画像を描けない環境 (Node): SVG のまま登録する (PDF には図形で描く)
        if (noCanvas() && this.opts.parseXml && parseSvg(svg, this.opts.parseXml, { outline: () => ({ segs: [], advance: 0 }) }))
          return this.register(name, { mime: 'image/svg+xml', bytes: sb, width: info.width, height: info.height });
        try {
          const d = await decode(sb, 'image/svg+xml');
          return this.register(name, { mime: 'image/svg+xml', bytes: sb, width: info.width, height: info.height, element: d.element });
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
    const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(uri);
    if (!m) return undefined;
    // 壊れた base64・不正な % の並びは、読めない画像として扱う (例外を外へ出さない。getFile と同じ)
    let bin: string;
    try {
      bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    } catch {
      return undefined;
    }
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const asset = await this.addBlob(uri, new Blob([bytes], { type: m[1] }));
    return asset;
  }

  /** 絶対 URL から取得 (CORS で拒否されることがある)。timeoutMs を過ぎたら取得をやめる (画像は描かない) */
  async addUrl(url: string, timeoutMs?: number): Promise<ImageAsset | undefined> {
    try {
      const res = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
      if (!res.ok) return undefined;
      // 大きすぎるファイルは取らない (Content-Length で分かるとき。分からなければ addBlob の上限で落とす)
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_FILE_BYTES) return undefined;
      return await this.addBlob(url, await res.blob());
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

function mimeFromName(name: string): string {
  const e = /\.([a-z0-9]+)$/i.exec(basename(name))?.[1].toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' } as Record<string, string>)[e ?? ''] ?? '';
}

/** マジックナンバーで形式を判定 (拡張子・Content-Type が当てにならない場合に備える) */
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
  if (!width || !height || width * height > MAX_PIXELS) return undefined;
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
    for (let k = 0; k < toffs.length; k++) {
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

/** TIFF の最初の画像の画素 (utif で読む)。読めなければ undefined */
async function tiffPixels(bytes: Uint8Array): Promise<Pixels | undefined> {
  try {
    const UTIF = (await import('utif')).default;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ifds = UTIF.decode(buf);
    if (!ifds.length) return undefined;
    const fax = ccittPixels(ifds[0], buf);
    if (fax) return fax;
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
