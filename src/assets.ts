import { limits } from './limits';
import { epsPreview, imageInfo, isPdf, pixelDensity } from './imageInfo';
import { fromBase64 } from './base64';
import { epsBudgetOf } from './epsInfo';
import { parseSvg, type XmlNode } from './svg';
import { decodeBmp, decodeGif, encodePng, maxPixels, pngWithinLimits, type Pixels } from './pixels';
import { lzwBytes } from './psFilters';
import { decodeWebp } from './webp';
import { ccittFits, decodeModifiedHuffman } from './ccitt';
import { fetchGuarded, urlFunctionBody } from './resources';
import { fetchLimits } from './imageLimits';
import { formatExtensions, formatLoadTimeoutMs, formatOf, formatSvgBudget, IMAGE_FORMATS, type ImageFormat, type ImageFormatContext, type ImageFormatResult } from './imageFormats';
import { msg } from './messages';
import { diag, type Diagnostic } from './diagnostics';
import { rejoin, thisCall } from './callContext';
import { decodeXmlAttr } from './xmlAttr';

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
  /**
   * 画素は、描画するときに作る (ブラウザーで、読み込みのときに画素にしなかった画像。element は無い)。大きさは画像の頭から読んだもの。
   * renderPage が、描画する前に画像のキャッシュ (imageCache.ts) から引く (AssetStore の deferDecode)
   */
  deferred?: true;
  /** false: 大きさだけ分かり、中身は描けない (未対応の形式)。仮の枠で描く */
  drawable?: false;
  /** 描けない理由 (画像を描けない環境 (Node) で、PDF に入れられない形式 (GIF など) や、図形にできない SVG の機能 (filter・marker など))。組版の警告に出す */
  unsupported?: string;
  /** 描いたが、中の一部を描けなかったもの (CGM の読めない要素、WMF・EMF・CGM の上限を超えた画像など)。組版の警告に出す */
  notes?: string[];
  /** 画像に書かれた解像度 (dpi。PNG・JPEG)。width / height は 96dpi とみなした大きさのまま */
  dpi?: number;
  /** 本来の縦横比が無い画像 (幅・高さも viewBox も無い SVG。大きさは既定の 300×150。CSS Images 3 §4.1 の既定の大きさ) */
  noRatio?: true;
  /**
   * PDF のページを図にした画像 (pdfImage.ts)。元のファイルの中身と、貼るページ・箱・回転。PDF の出力だけが描く (Form XObject にする)。
   * 画面・SVG・PNG は仮の枠で描く (drawable は false)
   */
  pdfSource?: {
    bytes: Uint8Array;
    page: number;
    box: [number, number, number, number];
    rotate: 0 | 90 | 180 | 270;
    userUnit: number;
    /** ページの範囲 (page=2-3 など。互換の指定のときだけ) を 1 行に横に並べるときの各ページ (先頭が page。大きさは CSS px。pdfImage.ts の PdfRowPage) */
    row?: Array<{ page: number; box: [number, number, number, number]; rotate: 0 | 90 | 180 | 270; userUnit: number; width: number; height: number }>;
  };
  /** 本体の外の形式 (imageFormats.ts) で読んだ画像の、形式の名前と元のファイルの中身 (形式の選択肢が変わったときに描き直す: AssetStore.redrawFormat) */
  formatSource?: { format: string; bytes: Uint8Array };
  /**
   * PDF に埋め込んだので、中身 (bytes) を捨てた画像 (AssetStore.releaseImageBytes。PDF だけを作るとき)。中身はあったものとして扱う
   * (組版は、画像が読めるかを、中身の有無で見る所がある)
   */
  released?: true;
}

/**
 * 背景の画像の参照の、PDF のページの範囲 (アンテナハウスの拡張の page=2-3・page=2-・page=all。互換の指定のときだけ読む) を、範囲の最初のページにする。
 * 図 (fo:external-graphic・img) では範囲のページを横に並べるが、背景には最初のページだけを敷く (見本の PDF: サンプル FO 集の graphics-pdf-1 の
 * 「背景」の列は、page=2-3・2-・1- のどれも範囲の最初のページだけ)。範囲でない参照と、PDF でないと名前で分かる参照 (.pdf でない拡張子のもの) はそのまま。
 * 名前は、クエリ (? の後ろ) を除いた道の最後の部分で見る (a.pdf?v=1#page=2-3 も書き換える)。拡張子の無い名前 (中身で PDF と分かる URL) も書き換える
 * (PDF でない画像は page= の範囲を読まないので、書き換えても変わらない)
 */
export function backgroundPdfSrc(src: string): string {
  if (/^data:application\/pdf/i.test(src)) return src.replace(/^(data:[^,]*?;\s*page=)(\d+)-\d*|^(data:[^,]*?;\s*page=)all\b/i, (_, a?: string, n?: string, b?: string) => (a ? `${a}${n}` : `${b}1`));
  const hash = src.indexOf('#');
  if (hash < 0 || /^data:/i.test(src)) return src;
  const path = src.slice(0, hash).replace(/\?.*$/s, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (last.includes('.') && !/\.pdf$/i.test(last)) return src;
  const frag = src.slice(hash + 1).replace(/(^|&)page=(?:(\d+)-\d*|all)(?=&|$)/i, (_, sep: string, n?: string) => `${sep}page=${n ?? 1}`);
  return `${src.slice(0, hash)}#${frag}`;
}

export function normalizeSrc(src: string): string {
  let s = src.trim();
  // url(…) の中身 (/^url\(\s*(['"]?)(.*?)\1\s*\)$/i と同じ結果を、空白の長い並びでも長さに比例した手間で。urlFunctionBody)
  s = urlFunctionBody(s, 'match', false) ?? s;
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

/** 参照の fragment (# の後ろ。RFC 3986 §3.5)。data: の URL と、# の無い参照は undefined */
export function fragmentOf(src: string): string | undefined {
  const s = src.trim();
  const k = s.indexOf('#');
  return k < 0 || /^data:/i.test(s) ? undefined : s.slice(k + 1);
}

/**
 * ブラウザの画像の画素の大きさ (幅 × 高さ × 4 バイト。RGBA 8 ビット)。img は自然な大きさ (naturalWidth)、
 * SVG の要素など、大きさが数で分からないものは 0
 */
function elementBytes(el: CanvasImageSource): number {
  const e = el as { naturalWidth?: number; naturalHeight?: number; width?: unknown; height?: unknown };
  const w = typeof e.naturalWidth === 'number' && e.naturalWidth > 0 ? e.naturalWidth : typeof e.width === 'number' ? e.width : 0;
  const h = typeof e.naturalHeight === 'number' && e.naturalHeight > 0 ? e.naturalHeight : typeof e.height === 'number' ? e.height : 0;
  return w > 0 && h > 0 ? w * h * 4 : 0;
}

/** 画像 (と MathML の文字のファイル) の拡張子 (正規表現の選択肢の形)。formats: 本体の外の形式 (imageFormats.ts。既定は本体と一緒に配るもの) */
export const imageExtensions = (formats: readonly ImageFormat[] = IMAGE_FORMATS) => ['png', 'jpe?g', 'gif', 'svgz?', 'webp', 'tiff?', 'bmp', 'emf', 'wmf', 'eps', 'ps', 'cgm', 'pdf', ...formatExtensions(formats), 'mml', 'xml'];
/** 本体と一緒に配る形式までの、画像の拡張子 */
export const IMAGE_EXTENSIONS = imageExtensions();

/**
 * 文字列 (HTML・FO・CSS・SVG) の中に名前が出てくる、画像の拡張子のファイル名 (小文字の basename)。
 * 引用符の中の値は空白を含めて拾い、引用符の外 (CSS の url(a.png) など) は空白・括弧・引用符までを拾う。%xx は戻す
 */
export function mentionedFiles(texts: string[], formats: readonly ImageFormat[] = IMAGE_FORMATS): Set<string> {
  const IMAGE_EXT = `(?:${imageExtensions(formats).join('|')})`;
  const out = new Set<string>();
  const add = (raw0: string) => {
    // 属性の値の文字参照 (a&amp;b.png。HTML・SVG の字面) は、戻した名前 (a&b.png) でも突き合わせる (xmlAttr.ts。HTML の属性の
    // 文字参照も、決まった実体参照と数の参照は同じ字になる)
    if (raw0.includes('&')) {
      const dec = decodeXmlAttr(raw0);
      if (dec !== raw0) add1(dec);
    }
    add1(raw0);
  };
  const add1 = (raw: string) => {
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

/**
 * 画像を描けない環境 (Node) で、SVG を PDF に図形で描けるかを確かめる。ふつうの SVG の画像も、変換した SVG (draw.io の図・EPS・CGM・
 * WMF・EMF・プラグインの画像の形式) も、これで確かめる (描くとき (pdfRenderer.ts の toVectors) と同じ選択肢で通す)。
 * text は組版のときに字形の輪郭にできるので、ここでは描けるものとして確かめる。filter は PDF に近似で描くか、画素で計算する
 * (画素の計算は組版のときにするので、ここでは計算できるものとして確かめる)
 */
function svgDrawableInPdf(text: string, parseXml: (xml: string) => XmlNode, onUnsupported?: (what: string) => void): boolean {
  return !!parseSvg(text, parseXml, {
    outline: () => ({ segs: [], advance: 0 }),
    approximateFilters: true,
    rasterFilter: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    ...(onUnsupported ? { onUnsupported } : {}),
  });
}

const basename = (s: string) => s.split(/[?#]/)[0].split('/').pop() ?? s;

/** 読み込みのときに画素にしない画像の形式 (AssetStore の deferDecode。createImageBitmap で読めるラスター画像) */
const DEFERRED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

/** バイト列の指紋 (長さと、FNV-1a の 32 ビットを 2 つの初めの値で。同じ中身かを見るためのもので、暗号の強さは要らない)。同じバイト列は覚えて返す */
const printMemo = new WeakMap<Uint8Array, string>();
function bytesPrint(b: Uint8Array): string {
  let p = printMemo.get(b);
  if (p !== undefined) return p;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ b.length;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i], 0x5bd1e995);
  }
  p = `${b.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
  printMemo.set(b, p);
  return p;
}

export class AssetStore {
  private map = new Map<string, ImageAsset>();
  private byBase = new Map<string, ImageAsset>();
  /** 画像でない文字のファイル (external-graphic で指す MathML)。キーは画像と同じ (完全一致・basename) */
  private texts = new Map<string, string>();
  /** 画像でないファイル (添付ファイルの注釈の中身など)。完全一致と basename で引く */
  private files = new Map<string, Uint8Array>();
  /** fragment の付いた参照から読み直した数 (元のファイルの中身ごと。MAX_FORMAT_FRAGMENTS) */
  private fragmentsMade = new WeakMap<Uint8Array, number>();
  /**
   * 本体の外の形式が返した SVG と、それを登録した画像 (同じ SVG を、もう一度 XML として読まずに使い回す)。
   * 同じファイルを、同じページになる fragment の違う参照 (無いページを指して最初のページになるものなど) で指すと、形式は同じ SVG を返す
   * (draw.io の図の形式は描いた図を使い回す) ので、参照ごとに大きな SVG を読み直さない
   */
  private formatSvgs = new Map<string, ImageAsset>();
  /**
   * fragment の付いた参照から作った画像 (addFragment) と、その元の画像 (fragment の無い参照で読んだもの)。
   * 元の画像の登録が変わる (同じ名前で登録し直す・登録を除く) と、そこから作った画像も捨てる
   * (画面で、図を開き直したり、形式の選択肢 (draw.io の図を読む・図形ライブラリ) を変えたりしたとき、古いページの画像を残さない。
   * 文書を読み直すと、addFragment が新しい元の画像から作り直す)
   */
  private derived = new Map<string, ImageAsset>();

  /**
   * parseXml: 画像を描けない環境 (Node) で、SVG を図形にできるか (PDF に描けるか) を読み込むときに確かめる XML のパーサ。
   * 図形にできない SVG (filter・marker など) は、大きさだけの画像 (仮の枠) にする
   */
  constructor(
    private opts: {
      parseXml?: (xml: string) => XmlNode;
      /** 本体の外の形式 (既定 IMAGE_FORMATS。プラグインの形式を足したもの: imageFormats.ts の formatsOf) */
      formats?: readonly ImageFormat[];
      /** 本体の外の形式が使う道具 (文字の幅を測る・資源を取る・警告を出す) */
      formatContext?: ImageFormatContext;
      /** 画像の置き場が出す警告の出し先 (名前の付いた診断。無ければ formatContext.warn に文を渡す) */
      report?: (d: Diagnostic) => void;
      /** 本体の外の形式の読み込みの時限 (ミリ秒。既定は imageFormats.ts の formatLoadTimeoutMs。テストで縮める) */
      formatTimeoutMs?: number;
      /** 画像を引いて当たったとき、その画像の鍵を知らせる (resourceUse.ts。コマンドが、組版が実際に使った画像を知るため) */
      onUse?: (key: string) => void;
      /** PDF の画像の fragment で、アンテナハウスの拡張 (ページの範囲・bbox=) を読むか (互換の指定。pdfImage.ts の parsePdfFragment) */
      pdfCompat?: boolean;
      /**
       * ブラウザーで、ラスター画像 (PNG・JPEG・GIF・WebP・BMP) を、読み込みのときに画素にしない (大きさは画像の頭から読む。ImageAsset.deferred)。
       * 描画するときに画像のキャッシュ (imageCache.ts) で画素にする (api.ts の組んだ結果。画面 (main.ts) は、いままでどおり読み込みのときに画素にする)
       */
      deferDecode?: boolean;
    } = {},
  ) {}

  /** 警告を出す (report があれば診断で、無ければ formatContext.warn に文で) */
  private warn(d: Diagnostic): void {
    if (this.opts.report) this.opts.report(d);
    else this.opts.formatContext?.warn?.(d.message);
  }

  /**
   * 本体の外の形式を差し替える (画面で draw.io の図を読む・読まないや、その図形ライブラリを切り替えたとき)。
   * 読み込み済みの画像は、呼ぶ側が元の中身から登録し直す (addBlob。読めなくなったものは unregister)。fragment の付いた参照の画像は、そのときに捨てる
   */
  setFormats(formats: readonly ImageFormat[]) {
    this.opts.formats = formats;
  }

  /** 画像の登録を除く (完全一致と、同じ画像を指すファイル名の引き) */
  unregister(src: string) {
    const key = normalizeSrc(src);
    const a = this.map.get(key);
    if (!a) return;
    this.map.delete(key);
    this.derived.delete(key);
    const b = basename(key).toLowerCase();
    if (this.byBase.get(b) === a) this.byBase.delete(b);
    this.dropDerived(a);
  }

  /** 元の画像 (base) から作った、fragment の付いた参照の画像を捨てる (derived の説明) */
  private dropDerived(base: ImageAsset) {
    for (const [key, from] of [...this.derived]) if (from === base) this.unregister(key);
  }

  get size() {
    return this.map.size;
  }

  /**
   * PDF に埋め込んだラスター画像 (PNG・JPEG・GIF・BMP・WebP・TIFF など) の中身を捨てる (PDF だけを作るとき。PDF は埋め込んだ写しを持つ)。
   * 同じ中身を指す登録 (同じ画像を、ファイル名と参照の URL で登録したもの) も捨てる。SVG は捨てない (組版が、中から参照する画像を確かめるのに読む)。
   * 捨てた画像には released の印を付け、大きさなどの欄は残す (組み直しても、同じに組む)
   */
  releaseImageBytes(srcs: Iterable<string>): void {
    const targets = new Set<Uint8Array>();
    for (const src of srcs) {
      const a = this.get(src);
      if (a?.bytes && a.mime.startsWith('image/') && a.mime !== 'image/svg+xml' && !a.formatSource) targets.add(a.bytes);
    }
    if (!targets.size) return;
    for (const m of [this.map, this.byBase, this.derived])
      for (const a of m.values())
        if (a.bytes && targets.has(a.bytes)) {
          a.bytes = undefined;
          a.released = true;
        }
  }

  register(src: string, a: Omit<ImageAsset, 'key'>): ImageAsset {
    const key = normalizeSrc(src);
    const asset = { ...a, key };
    // 同じ名前で登録し直したら、前の画像から作った fragment の付いた参照の画像を捨てる (derived の説明)。ファイル名で引く表の前の画像も
    const before = fragmentOf(key) === undefined && !key.startsWith('data:') ? [this.map.get(key), this.byBase.get(basename(key).toLowerCase())] : [];
    this.map.set(key, asset);
    this.derived.delete(key);
    for (const old of new Set(before)) if (old && old !== asset) this.dropDerived(old);
    // fragment の付いた参照 (図.drawio#page=2。addFragment) は、同じファイルの中の 1 つの図なので、ファイル名で引く表の、
    // fragment の無いファイルの画像を上書きしない (ファイル名だけで引く参照 (img/図.drawio) に、別のページが当たらないように)
    const base = basename(key).toLowerCase();
    if (!key.startsWith('data:') && (fragmentOf(key) === undefined || !this.byBase.has(base))) this.byBase.set(base, asset);
    return asset;
  }

  /** サイズだけ登録 (レイアウトの確認・テスト用) */
  registerSize(src: string, width: number, height: number, mime = 'image/png') {
    return this.register(src, { mime, width, height });
  }

  /**
   * fragment (# の後ろ) の付いた参照 (図.drawio#page=2 など) を、fragment の無い参照で読んだ画像から作る。
   * 作るのは、本体の外の形式 (imageFormats.ts) で読んだ画像だけ: 形式に fragment を渡して読み直し、fragment を含む名前で、別の画像として登録する
   * (同じファイルの違うページを、それぞれの画像にする)。作れなければ undefined (ほかの画像の fragment は読まない: いままでどおり、
   * get がファイル名で引いて、ファイルの全体の画像になる)。作るまでは、get は本体の外の形式の画像を、fragment の付いた参照に返さない
   */
  async addFragment(src: string): Promise<ImageAsset | undefined> {
    if (fragmentOf(src) === undefined) return undefined;
    // 同じ参照で作ったものがあれば、それ
    const made = this.map.get(normalizeSrc(src));
    if (made) return made;
    const from = this.get(src.slice(0, src.indexOf('#')));
    // 本体の外の形式の画像と、PDF の画像 (fragment でページを選ぶ)
    const base = from?.formatSource ?? from?.pdfSource;
    if (!base) return undefined;
    // 1 つのファイルを読み直す数の上限 (MAX_FORMAT_FRAGMENTS の説明)。超えた参照は読めない画像
    const n = this.fragmentsMade.get(base.bytes) ?? 0;
    const maxFragments = limits().formatFragments;
    if (n >= maxFragments) {
      if (n === maxFragments)
        this.warn(
          diag('image/too-many-fragments', msg(
            `1 つのファイルを fragment の違う参照で指す数が多すぎます (${maxFragments} 種類まで。それを超える参照は読みません): ${src.slice(0, 200)}`,
            `too many references to one file with different fragments (up to ${maxFragments}; the others are not read): ${src.slice(0, 200)}`,
          ), { src: src.slice(0, 200) }),
        );
      this.fragmentsMade.set(base.bytes, n + 1);
      return undefined;
    }
    this.fragmentsMade.set(base.bytes, n + 1);
    const asset = rejoin(thisCall(), await this.addBlob(src, new Blob([base.bytes as BlobPart])));
    // 読んでいる間に元の画像の登録が変わっていたら (画面で図を開き直したなど)、古い中身から作ったものは残さない
    if (asset && this.get(src.slice(0, src.indexOf('#'))) !== from) {
      this.unregister(src);
      return undefined;
    }
    if (asset) this.derived.set(asset.key, from!);
    return asset;
  }

  /**
   * 組版に効く、登録した画像と文字のファイルの印 (名前・形式・自然な大きさ・解像度・描けるか・知らせ・文字の中身)。器が前の文書の組版を使い回すとき、
   * 画像が同じかを見る (組版は画像の大きさ・描けるか・知らせと、SVG の中身を読み、ほかの画像の描く中身は PDF を書くときにこの置き場から引く)
   */
  layoutSignature(): string {
    const parts: string[] = [];
    // 組版が読む欄: 大きさ・解像度 (dpi)・縦横比を保たないか・描けるか・未対応の知らせ・描けなかった所の知らせ (画素の中身は、組版でなく PDF の書き出しが、
    // いまの文書の画像から読む)
    // SVG は、組版も中身を読む (中の参照の確かめと、その警告。layoutEngine の画像の箱) ので、バイト列の指紋も入れる
    for (const a of this.map.values())
      parts.push(`${a.key}|${a.mime}|${a.width}|${a.height}|${a.drawable === false ? 0 : 1}|${a.dpi ?? ''}|${a.noRatio ? 1 : 0}|${a.unsupported ?? ''}|${(a.notes ?? []).join('\u0001')}|${a.mime === 'image/svg+xml' && a.bytes ? bytesPrint(a.bytes) : ''}`);
    for (const [k, t] of this.texts) parts.push(`t|${k}|${t.length}|${t}`);
    return parts.join('\n');
  }

  /** 登録した画像 (登録した順) */
  values(): IterableIterator<ImageAsset> {
    return this.map.values();
  }

  /** get と同じ画像を引くが、使ったとは数えない (onUse を呼ばない。PDF の書き出しが、画像を前もって用意するとき) */
  peek(src: string): ImageAsset | undefined {
    const onUse = this.opts.onUse;
    this.opts.onUse = undefined;
    try {
      return this.get(src);
    } finally {
      this.opts.onUse = onUse;
    }
  }

  get(src: string): ImageAsset | undefined {
    const key = normalizeSrc(src);
    const hit = this.map.get(key);
    if (hit) this.opts.onUse?.(hit.key);
    if (hit || key.startsWith('data:')) return hit;
    const byName = this.byBase.get(basename(key).toLowerCase());
    const pagesByFragment = !!(byName?.formatSource || byName?.pdfSource);
    if (byName && !(pagesByFragment && fragmentOf(key) !== undefined)) this.opts.onUse?.(byName.key);
    // fragment の付いた参照で、ファイル名で当たったのが本体の外の形式の画像 (fragment で描くものを選ぶ形式) なら、まだ無いものとする
    // (addFragment で、そのページの画像を作るまで。読み込みの時点で、別のページ (ファイルの全体の画像) の大きさで組まないように:
    // ネットワークの画像と同じく、作ったあと、組むときに大きさを引く)
    return pagesByFragment && fragmentOf(key) !== undefined ? undefined : byName;
  }

  /**
   * この置き場が持つものの大きさの見積もり (バイト。TypesetResult.memoryUsage の images)。
   * 画像のファイルの中身 (同じ中身は 1 度)・PDF の図の元のファイル・本体の外の形式の元のファイル・文字のファイル・添付のファイルと、
   * ブラウザの画像 (ImageBitmap・img。描くために画素にしたもの) の画素 (幅 × 高さ × 4 バイト)。
   * given が真を返すバイト列 (呼ぶ側が渡したものをそのまま持つもの: files・resolveResource の画像の中身・添付のファイル) は数えない
   * (手放しても、呼ぶ側が持つ)。同じ ArrayBuffer を共有するバイト列は 1 度だけ数える
   */
  memoryBytes(given: (b: Uint8Array) => boolean = () => false): number {
    const seen = new Set<object>();
    let n = 0;
    const bytes = (b: Uint8Array | undefined) => {
      if (!b || seen.has(b.buffer) || given(b)) return;
      seen.add(b.buffer);
      n += b.buffer.byteLength;
    };
    for (const m of [this.map, this.byBase, this.derived, this.formatSvgs])
      for (const a of m.values()) {
        bytes(a.bytes);
        bytes(a.pdfSource?.bytes);
        bytes(a.formatSource?.bytes);
        if (a.element && !seen.has(a.element)) {
          seen.add(a.element);
          n += elementBytes(a.element);
        }
      }
    for (const b of this.files.values()) bytes(b);
    // 文字のファイルは、名前と basename の 2 つの鍵で同じ文字列を登録する (registerText)
    for (const t of new Set(this.texts.values())) n += t.length * 2;
    return n;
  }

  /**
   * 持っているものを手放す (TypesetResult.dispose)。ブラウザの画像のうち、閉じられるもの (ImageBitmap) を閉じて
   * (HTML §8.10 の close。GC を待たずに画素のメモリを返す)、登録を除く
   */
  dispose(): void {
    const elements = new Set<CanvasImageSource>();
    for (const m of [this.map, this.byBase, this.derived, this.formatSvgs]) for (const a of m.values()) if (a.element) elements.add(a.element);
    for (const el of elements) (el as { close?: () => void }).close?.();
    this.clear();
  }

  clear() {
    this.fragmentsMade = new WeakMap();
    this.formatSvgs.clear();
    this.derived.clear();
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
        return fromBase64(m[2]);
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
    if (blob.size > limits().fileBytes) return undefined;
    return this.addBytes(name, new Uint8Array(rejoin(thisCall(), await blob.arrayBuffer())), blob.type);
  }

  /**
   * 中身 bytes の画像を登録する (addBlob と同じ。中身は写さずに、そのまま持つ: 呼ぶ側が渡した中身 (files・resolveResource) を、もう 1 つ持たない。
   * 呼ぶ側は、渡した中身を、組んだ結果を使う間は書き換えない)。type は中身の種類 (Content-Type。分からなければ空)
   */
  async addBytes(name: string, bytes: Uint8Array, type = ''): Promise<ImageAsset | undefined> {
    if (bytes.length > limits().fileBytes) return undefined;
    // gzip で圧縮した SVG (.svgz) は展開して SVG として読む (展開した大きさに上限を置く)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      const out = rejoin(thisCall(), await gunzipLimited(bytes, limits().fileBytes));
      if (out) bytes = out;
    }
    try {
      return rejoin(thisCall(), await this.decodeBytes(name, type, bytes));
    } catch {
      const info = rejoin(thisCall(), await imageInfo(bytes).catch(() => undefined));
      if (!info) return undefined;
      const label = info.mime === 'application/postscript' ? 'EPS' : info.mime.replace(/^image\//, '').toUpperCase();
      return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, drawable: false, ...(noCanvas() ? { unsupported: msg(`${label} (読めないファイル)`, `${label} (unreadable file)`) } : {}) });
    }
  }

  private async decodeBytes(name: string, type: string, bytes: Uint8Array): Promise<ImageAsset | undefined> {
    // 本体の外の形式 (imageFormats.ts): 形式が読み込んで SVG にする (大きさも形式が決める)。読めなければ画像でない
    const fmt = formatOf(bytes, this.opts.formats ?? IMAGE_FORMATS);
    if (fmt) {
      // 参照の名前の fragment (# の後ろ) は、形式に渡す (1 つのファイルの中の、どの図・ページを描くか。ImageFormatContext.fragment)
      const fragment = fragmentOf(name);
      // 上限 (TypesetOptions.limits) は、形式が自分の手間を合わせられるように渡す (読むだけ)
      const ctx: ImageFormatContext = { ...this.opts.formatContext, ...(fragment !== undefined ? { fragment } : {}), limits: limits() };
      const warn = (d: Diagnostic) => this.warn(d);
      const shown = name.slice(0, 200);
      // 読み込みは時限と競わせる (formatLoadTimeoutMs の説明。時限の setTimeout は、終わらない Promise でもイベントループを空にしない)
      const timedOut = Symbol('timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = this.opts.formatTimeoutMs ?? formatLoadTimeoutMs(ctx.fetchTimeoutMs);
      const r: ImageFormatResult | undefined | typeof timedOut = rejoin(thisCall(), await Promise.race([
        fmt.load(bytes, ctx),
        new Promise<typeof timedOut>((done) => {
          timer = setTimeout(() => done(timedOut), limit);
        }),
      ])
        .catch(() => undefined)
        .finally(() => clearTimeout(timer)));
      if (r === timedOut) {
        warn(diag('image/timeout', msg(`画像 ${shown} の読み込み (${fmt.name}) が ${Math.round(limit / 1000)} 秒で終わらないので、読めない画像として扱います`, `loading the image ${shown} (${fmt.name}) did not finish in ${Math.round(limit / 1000)} seconds; it is treated as unreadable`), { src: shown, format: fmt.name }));
        return undefined;
      }
      if (!r || typeof r !== 'object') return undefined;
      // 大きさは有限で、上限 (FORMAT_MAX_SIZE) までの正の数 (前は Infinity を受け取り、文書の全体が誤りで終わった)
      if (!(r.width > 0 && r.height > 0)) return undefined;
      const maxSize = limits().formatSize;
      if (!(r.width <= maxSize && r.height <= maxSize)) {
        warn(diag('image/invalid-size', msg(`画像 ${shown} (${fmt.name}) の大きさが大きすぎるか有限でないので、読めない画像として扱います (${maxSize} px まで)`, `the size of the image ${shown} (${fmt.name}) is too large or not finite; it is treated as unreadable (up to ${maxSize} px)`), { src: shown, format: fmt.name }));
        return undefined;
      }
      // 警告は文字列の並び (無い・壊れたものは無いものとする)
      const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [];
      // SVG の長さの上限 (formatSvgBudget の説明)。超えたもの・文字列でないものは、大きさだけの読めない画像
      const budget = formatSvgBudget(bytes.length);
      const svgOk = typeof r.svg === 'string' && r.svg.length <= budget;
      if (typeof r.svg === 'string' && !svgOk)
        warnings.push(msg(`形式 ${fmt.name} の SVG が長すぎるので描画しません (${bytes.length} バイトのファイルでは ${budget} 字まで)`, `the SVG from the format ${fmt.name} is too long and is not drawn (up to ${budget} characters for a file of ${bytes.length} bytes)`));
      const extra = { formatSource: { format: fmt.name, bytes }, ...(warnings.length ? { notes: [...new Set(warnings)] } : {}) };
      const seen = svgOk ? this.formatSvgs.get(r.svg) : undefined;
      if (seen && seen.width === r.width && seen.height === r.height) {
        const { key: _key, notes: _notes, ...rest } = seen;
        return this.register(name, { ...rest, ...extra });
      }
      const drawn = svgOk ? rejoin(thisCall(), await this.registerSvg(name, r.svg, r.width, r.height, extra)) : undefined;
      if (drawn) {
        this.formatSvgs.set(r.svg, drawn);
        // 覚えるのは最近の 16 個まで (画面の AssetStore は長く使うので、読んだ SVG を持ち続けない)
        if (this.formatSvgs.size > 16) this.formatSvgs.delete(this.formatSvgs.keys().next().value!);
      }
      return (
        drawn ??
        this.register(name, { mime: fmt.mime, bytes, width: r.width, height: r.height, drawable: false, ...(noCanvas() ? { unsupported: fmt.name } : {}), ...extra })
      );
    }
    // PDF: 貼るページの大きさを読んで登録する (描くのは PDF の出力だけ。registerPdf)
    if (isPdf(bytes)) return rejoin(thisCall(), await this.registerPdf(name, bytes));
    // ブラウザが描けない形式 (TIFF・WMF・EMF・EPS・CGM): 大きさだけ読んで登録する (仮の枠を正しい寸法で組む)
    const info = rejoin(thisCall(), await imageInfo(bytes));
    if (info) {
      // EPS は PostScript を実行して描く (図形と画像。eps.ts)。描けないもの (解釈系が warnings に入れる。CMYK の JPEG・一部の複合書体の文字など) があり、プレビューを持つときは、プレビューで描く
      let epsSvg: string | undefined;
      if (info.mime === 'application/postscript') {
        // 実行の時間は、この入れ物 (文書) の EPS の合計にも上限がある (eps.ts の EPS_DOCUMENT_MILLIS)
        // PostScript の解釈系 (eps.ts と psInterp.ts など) は、EPS が出てきたときだけ読み込む (画面・ブラウザ向けのライブラリでは別のチャンク)
        const { epsToSvg } = rejoin(thisCall(), await import('./eps'));
        const r = rejoin(thisCall(), await epsToSvg(bytes, { budget: epsBudgetOf(this) }).catch(() => undefined));
        if (r && r.count > 0 && (!r.warnings.length || !epsPreview(bytes))) epsSvg = r.svg;
      }
      // TIFF と、TIFF のプレビューを持つ EPS は、画素を読んで描く (大きさは元の形式の値)
      const tiff = epsSvg ? undefined : info.mime === 'image/tiff' ? bytes : info.mime === 'application/postscript' ? epsPreview(bytes) : undefined;
      const isTiff = !!tiff && tiff[0] === tiff[1] && (tiff[0] === 0x49 || tiff[0] === 0x4d);
      // 画像を描けない環境 (Node): 画素を PNG にして PDF に入れる
      const px = isTiff && noCanvas() ? rejoin(thisCall(), await tiffPixels(tiff!)) : undefined;
      if (px) return this.register(name, { mime: 'image/png', bytes: rejoin(thisCall(), await encodePng(px)), width: info.width, height: info.height });
      const element = isTiff ? rejoin(thisCall(), await decodeTiff(tiff!)) : undefined;
      if (element) return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, element });
      // WMF・EMF (と WMF のプレビューを持つ EPS) は、描画命令を SVG にして描く (PDF にはベクターのまま入る)
      const preview = info.mime === 'application/postscript' && tiff && !element ? tiff : undefined;
      // CGM は要素を読んで SVG にする (cgm.ts)
      // 描けなかった要素・上限を超えて描かなかった画像の警告 (cgm.ts の CgmResult.warnings・metafile.ts の warnings) は、描いた画像の notes にして
      // 組版の警告に出す (前は捨てていた)
      const notes: string[] = [];
      // CGM・WMF・EMF の処理 (cgm.ts・metafile.ts) も、その画像が出てきたときだけ読み込む (別のチャンク)
      const cgm = !epsSvg && info.mime === 'image/cgm' ? rejoin(thisCall(), await import('./cgm')).cgmToSvg(bytes) : undefined;
      if (cgm) notes.push(...cgm.warnings);
      const metafile = !epsSvg && !cgm && (info.mime === 'image/wmf' || info.mime === 'image/emf' || preview) ? rejoin(thisCall(), await import('./metafile')) : undefined;
      const svg =
        epsSvg ??
        cgm?.svg ??
        (!metafile
          ? undefined
          : info.mime === 'image/wmf'
            ? metafile.wmfToSvg(bytes, undefined, undefined, notes)
            : info.mime === 'image/emf'
              ? metafile.emfToSvg(bytes, undefined, undefined, notes)
              : preview
                ? metafile.wmfToSvg(preview, info.width, info.height, notes)
                : undefined);
      if (svg) {
        const asset = rejoin(thisCall(), await this.registerSvg(name, svg, info.width, info.height, notes.length ? { notes: [...new Set(notes)] } : {}));
        if (asset) return asset;
      }
      // 描けない形式 (CGM・プレビューの無い EPS など)。Node では警告に出す
      const label = info.mime === 'application/postscript' ? 'EPS' : info.mime.replace(/^image\//, '').toUpperCase();
      return this.register(name, { mime: info.mime, bytes, width: info.width, height: info.height, drawable: false, ...(noCanvas() ? { unsupported: label } : {}) });
    }
    const mime = sniffMime(bytes, type || mimeFromName(name));
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
      if (px) return this.register(name, { mime: 'image/png', bytes: rejoin(thisCall(), await encodePng(px)), width: size.width, height: size.height, ...(dpi ? { dpi } : {}) });
      // PNG は PDF に入れるとき (pdf-lib の embedPng) に展開するので、展開の大きさの上限を先に確かめる (pixels.ts の pngWithinLimits)
      if (mime === 'image/png' && !pngWithinLimits(bytes))
        return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: msg('PNG (ピクセルの数か展開の大きさが上限を超える)', 'PNG (the number of pixels or the decompressed size exceeds the limit)') });
      // PDF に入れられるのは PNG・JPEG・図形にできる SVG だけ (読めない GIF・BMP・WebP は画素に直せない)
      if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/svg+xml') {
        const label = mime === 'image/webp' ? 'WebP' : mime.replace(/^image\//, '').toUpperCase();
        return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: label });
      }
      if (mime === 'image/svg+xml') return this.registerSvgShapes(name, bytes, size, dpi);
      return this.register(name, { mime, bytes, width: size.width, height: size.height, ...(dpi ? { dpi } : {}), ...(size.noRatio ? { noRatio: true as const } : {}) });
    }
    // ブラウザの画像 (<img>) で SVG を読めない所 (Web Worker の中): Node と同じく、元のバイト列だけを持ち、図形で描く
    // (PDF は図形で、Canvas も図形を画素にして描く: canvasRenderer.ts の drawSvgShapes)。ほかの形式は createImageBitmap で読む
    if (mime === 'image/svg+xml' && noSvgImage()) {
      const size = headerSize(bytes, mime);
      return size ? this.registerSvgShapes(name, bytes, size, dpi) : undefined;
    }
    // 読み込みのときに画素を持たない画像 (deferDecode): 読めるかと大きさ (EXIF の向きを当てた大きさ) は、いままでどおり 1 度デコードして確かめ、
    // デコードした画像はすぐ閉じる (描画するときに、画像のキャッシュでデコードし直す)
    if (this.opts.deferDecode && DEFERRED_MIMES.has(mime)) {
      try {
        const { element, width, height } = rejoin(thisCall(), await decode(bytes, mime));
        (element as { close?: () => void }).close?.();
        return this.register(name, { mime, bytes, width, height, deferred: true, ...(dpi ? { dpi } : {}) });
      } catch {
        return undefined;
      }
    }
    try {
      const { element, width, height } = rejoin(thisCall(), await decode(bytes, mime));
      // 本来の比の無い SVG (大きさも viewBox も無い): ファイルの頭から読んで分からず、ブラウザの読んだ大きさも既定の 300×150 のときだけ
      // (ブラウザが大きさを読めた SVG の比を、属性の比で置き換えない)
      const noRatio = mime === 'image/svg+xml' && headerSize(bytes, mime)?.noRatio && width === 300 && height === 150;
      return this.register(name, { mime, bytes, width, height, element, ...(dpi ? { dpi } : {}), ...(noRatio ? { noRatio: true as const } : {}) });
    } catch {
      return undefined;
    }
  }

  /**
   * SVG を、図形で描く画像として登録する (画像を描けない環境 (Node) と、ブラウザの画像で SVG を読めない所 (Web Worker の中))。
   * 図形にできない SVG (filter・marker など) は、大きさだけの画像 (仮の枠) にする
   */
  private registerSvgShapes(name: string, bytes: Uint8Array, size: { width: number; height: number; noRatio?: true }, dpi: number | undefined): ImageAsset {
    const mime = 'image/svg+xml';
    if (this.opts.parseXml) {
      let what = '';
      if (!svgDrawableInPdf(new TextDecoder().decode(bytes), this.opts.parseXml, (w) => (what = w))) return this.register(name, { mime, bytes, width: size.width, height: size.height, drawable: false, unsupported: what, ...(size.noRatio ? { noRatio: true as const } : {}) });
    }
    return this.register(name, { mime, bytes, width: size.width, height: size.height, ...(dpi ? { dpi } : {}), ...(size.noRatio ? { noRatio: true as const } : {}) });
  }

  /**
   * 変換した SVG を、元の形式の大きさの画像として登録する (WMF・EMF・EPS・CGM と、本体の外の形式)。
   * 画像を描けない環境 (Node) と、ブラウザの画像で SVG を読めない所 (Web Worker の中) は、図形にできれば SVG のまま (PDF には図形で描く)。
   * ブラウザの画面は描いた画像も持つ。描けなければ undefined (仮の枠にする)
   */
  private async registerSvg(name: string, svg: string, width: number, height: number, extra: Partial<ImageAsset>): Promise<ImageAsset | undefined> {
    const sb = new TextEncoder().encode(svg);
    // 確かめは、ふつうの SVG の画像 (addBlob) と同じ (filter は画素で計算できるものとして通す)
    if ((noCanvas() || noSvgImage()) && this.opts.parseXml && svgDrawableInPdf(svg, this.opts.parseXml))
      return this.register(name, { mime: 'image/svg+xml', bytes: sb, width, height, ...extra });
    try {
      const d = rejoin(thisCall(), await decode(sb, 'image/svg+xml'));
      return this.register(name, { mime: 'image/svg+xml', bytes: sb, width, height, element: d.element, ...extra });
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
      bytes = m[2] ? fromBase64(m[3]) : percentDecodeBytes(m[3]);
    } catch {
      return undefined;
    }
    const asset = rejoin(thisCall(), await this.addBlob(uri, new Blob([bytes as BlobPart], { type: m[1] })));
    return asset;
  }

  /**
   * 絶対 URL から取得 (CORS で拒否されることがある)。timeoutMs を過ぎたら取得をやめる (画像は描かない。時限は本体を読み終えるまで効く)。
   * allow: 取ってよい URL か。転送 (redirect) の先の URL にも聞く (fetchGuarded)。大きすぎる本体 (fetchLimits.imageBytes) は、読むのを途中でやめる
   */
  async addUrl(url: string, timeoutMs?: number, allow?: (url: string) => boolean): Promise<ImageAsset | undefined> {
    const got = rejoin(thisCall(), await fetchGuarded(url, { timeoutMs, maxBytes: fetchLimits.imageBytes, ...(allow ? { allow } : {}) }));
    if (!got) return undefined;
    try {
      return rejoin(thisCall(), await this.addBlob(url, new Blob([got.bytes as BlobPart], { type: got.type })));
    } catch {
      return undefined;
    }
  }

  /**
   * PDF の画像を登録する (design/pdf-as-image.md の 1 節)。参照の名前の fragment でページと箱を選び (pdfImage.ts)、そのページの大きさで登録する。
   * 読めない PDF (壊れている・暗号化・上限を超えた) も、診断を出して、既定の大きさ (60 × 40pt) の仮の枠の画像として登録する
   * (登録しないと、組版が「見つからない画像」とも知らせて、同じ画像の知らせが 2 つになる)
   */
  private async registerPdf(name: string, bytes: Uint8Array): Promise<ImageAsset> {
    const { readPdfImage } = rejoin(thisCall(), await import('./pdfImage'));
    const shown = name.slice(0, 200);
    // data: の URI の種類の引数 page=N (data:application/pdf;page=3;base64,…) は、アンテナハウスの拡張 (公開の説明書の「PDF の埋め込み」の節)。
    // application/pdf に page という引数は無い (RFC 3778) ので、互換の指定のときだけ読む (CLAUDE.md の「仕様の根拠」)
    const dataPage = /^data:/i.test(name) ? /^data:[^,]*?;\s*page=([^;,]*)/i.exec(name)?.[1] : undefined;
    if (dataPage !== undefined && !this.opts.pdfCompat) {
      const detail = msg(`data: の URI の page= は、互換の指定 (--compat antenna・--style ah) のときだけ読みます。1 ページ目を貼ります`, `page= in a data: URI is read only in compatibility mode (--compat antenna, --style ah); the first page is used`);
      this.warn(diag('image/pdf-fragment', msg(`PDF の画像 ${shown}: ${detail}`, `PDF image ${shown}: ${detail}`), { src: shown, detail }));
    }
    const fragment = dataPage !== undefined && this.opts.pdfCompat ? `page=${dataPage}` : fragmentOf(name);
    const r = rejoin(thisCall(), await readPdfImage(bytes, fragment, !!this.opts.pdfCompat));
    for (const n of r.notes) {
      const m = msg(`PDF の画像 ${shown}: ${n.detail}`, `PDF image ${shown}: ${n.detail}`);
      const detail = n.detail;
      this.warn(
        n.code === 'image/pdf-page'
          ? diag('image/pdf-page', m, { src: shown, detail })
          : n.code === 'image/pdf-page-range'
            ? diag('image/pdf-page-range', m, { src: shown, detail })
            : n.code === 'image/pdf-fragment'
              ? diag('image/pdf-fragment', m, { src: shown, detail })
              : diag('image/pdf-repaired', m, { src: shown, detail }),
      );
    }
    if (!r.ok) {
      const detail = r.detail;
      this.warn(
        r.code === 'image/pdf-encrypted'
          ? diag('image/pdf-encrypted', msg(`PDF の画像 ${shown} は暗号化されているので読めません。プレースホルダーで描画します`, `PDF image ${shown} is encrypted and cannot be read; a placeholder frame is drawn`), { src: shown })
          : diag('image/pdf-invalid', msg(`PDF の画像 ${shown} を読めません (${detail})。プレースホルダーで描画します`, `PDF image ${shown} cannot be read (${detail}); a placeholder frame is drawn`), { src: shown, detail }),
      );
      return this.register(name, { mime: 'application/pdf', bytes, width: 80, height: 160 / 3, drawable: false });
    }
    const { page, box, rotate, userUnit, width, height, row } = r.image;
    return this.register(name, { mime: 'application/pdf', bytes, width, height, drawable: false, pdfSource: { bytes, page, box, rotate, userUnit, ...(row ? { row } : {}) } });
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
    // 画素にしていない画像 (deferred) は、ここで 1 度だけ読み、PNG にしたら閉じる
    if (!a.element && a.deferred && a.bytes) {
      let bmp: ImageBitmap | undefined;
      try {
        bmp = rejoin(thisCall(), await createImageBitmap(new Blob([a.bytes as BlobPart], { type: a.mime })));
        return rejoin(thisCall(), await this.rasterize({ ...a, element: bmp, deferred: undefined }, widthPx));
      } catch {
        return undefined;
      } finally {
        bmp?.close();
      }
    }
    if (!a.element) return undefined;
    const w = Math.max(1, Math.min(Math.round(widthPx), 6000));
    const h = Math.max(1, Math.round((w * a.height) / a.width));
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(a.element, 0, 0, w, h);
    try {
      const blob: Blob = canvas instanceof OffscreenCanvas ? rejoin(thisCall(), await canvas.convertToBlob({ type: 'image/png' })) : rejoin(thisCall(), await new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png')));
      return { type: 'png', bytes: new Uint8Array(rejoin(thisCall(), await blob.arrayBuffer())) };
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
export async function looksLikeImage(bytes: Uint8Array, formats: readonly ImageFormat[] = IMAGE_FORMATS): Promise<boolean> {
  return !!sniffMime(bytes, '') || !!formatOf(bytes, formats) || isPdf(bytes) || !!rejoin(thisCall(), await imageInfo(bytes));
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
    const UTIF = rejoin(thisCall(), await import('utif')).default;
    // utif は IFD の並びを確かめないので、渡す前に確かめる (tiffStructureOk)
    if (!tiffStructureOk(bytes)) return undefined;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ifds = UTIF.decode(buf);
    if (!ifds.length) return undefined;
    const fax = ccittPixels(ifds[0], buf);
    if (fax) return fax;
    // 画素の数の上限 (imageLimits.ts の MAX_PIXELS)。utif は、IFD に書かれた寸法 (ImageWidth × ImageLength。TIFF 6.0 Section 8) のとおりに
    // 画素の領域を確保してから展開する。PackBits・LZW・Deflate はデータの長さで縛れないので、寸法を先に確かめる
    // (124 バイトの PackBits の TIFF で、寸法どおりの領域と RGBA を確保し、常駐のメモリを 1.6GB 使っていた)
    const tagOf = (k: number) => Number((ifds[0][`t${k}`] as number[] | undefined)?.[0] ?? 0);
    if (!(tagOf(256) > 0 && tagOf(257) > 0) || tagOf(256) * tagOf(257) > maxPixels()) return undefined;
    // CCITT の符号は、自前の復号 (ccittPixels) で読めなかったときも、データの大きさの上限 (ccittWithinLimits) を超えれば utif に渡さない
    // (utif も寸法のとおりに確保する)
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
  const px = rejoin(thisCall(), await tiffPixels(bytes));
  if (!px) return undefined;
  try {
    return rejoin(thisCall(), await createImageBitmap(new ImageData(new Uint8ClampedArray(px.rgba.buffer as ArrayBuffer, px.rgba.byteOffset, px.rgba.length), px.width, px.height)));
  } catch {
    return undefined;
  }
}

/** 画像を描けない環境 (Node) か */
const noCanvas = () => typeof createImageBitmap === 'undefined' && typeof Image === 'undefined';
/**
 * ブラウザの画像 (<img>) で SVG を読めない所か (Node と、Web Worker の中。HTML Living Standard §4.8.3 の HTMLImageElement
 * (Image) は [Exposed=Window] で、Worker には無い)。Worker の中の createImageBitmap には頼らない (§8.11.2: Blob の画像は、
 * 大きさの無いベクタの画像を拒む。Chromium は、大きさのある SVG の Blob も読まない)
 */
const noSvgImage = () => typeof Image === 'undefined';

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
    rejoin(thisCall(), await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg decode failed'));
      img.src = url;
    }));
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
      w = vb ? parseFloat(vb[1]) : 300;
      h = vb ? parseFloat(vb[2]) : 150;
    }
    return { element: img, width: w, height: h };
  }
  const bmp = rejoin(thisCall(), await createImageBitmap(blob));
  return { element: bmp, width: bmp.width, height: bmp.height };
}

/**
 * SVG の文書の、最初の svg の開始タグ (<svg … >)。XML 1.0 §2.5〜§2.8 の注釈 (<!-- -->)・CDATA (<![CDATA[ ]]>)・処理命令 (<? ?>)・
 * 文書型宣言 (<!DOCTYPE …>。内部の宣言 [ … ] と、引用符の中の > も含む) と、ほかの要素のタグは、中を読まずに飛ばす (注釈の中に書いた
 * <svg …> を、本物の開始タグと取り違えない)。タグの中の属性の値の > は、タグの終わりにしない。どこも 1 度だけ前へ読む (手間は、文書の長さに比例)。
 * 開始タグが終わる前に文書が終われば undefined (頭だけを渡したときは、全体で探し直す)
 */
export function svgStartTag(t: string): string | undefined {
  // svg の開始タグ (名前空間の接頭辞の付いた svg:svg も)
  const svgTag = /<(?:[\w.-]+:)?svg[\s/>]/iy;
  /**
   * from から、引用符の外の > の次の位置 (無ければ -1)。brackets なら、[ ] の中の > も飛ばす (DOCTYPE の内部の宣言)。
   * 内部の宣言の中の注釈・処理命令は、まるごと飛ばす (XML 1.0 §2.8 の intSubset: markupdecl のほかに PI・Comment も書ける。
   * 注釈の中の引用符 (<!-- don't -->) は、引用符として読まない)
   */
  const tagEnd = (from: number, brackets: boolean): number => {
    let depth = 0;
    for (let i = from; i < t.length; i++) {
      const c = t[i];
      if (depth > 0 && c === '<' && (t.startsWith('<!--', i) || t.startsWith('<?', i))) {
        const close = t.startsWith('<!--', i) ? '-->' : '?>';
        const j = t.indexOf(close, i + 2);
        if (j < 0) return -1;
        i = j + close.length - 1;
      } else if (c === '"' || c === "'") {
        const j = t.indexOf(c, i + 1);
        if (j < 0) return -1;
        i = j;
      } else if (brackets && c === '[') depth++;
      else if (brackets && c === ']') depth = Math.max(depth - 1, 0);
      else if (c === '>' && depth === 0) return i + 1;
    }
    return -1;
  };
  for (let i = t.indexOf('<'); i >= 0 && i < t.length; i = t.indexOf('<', i)) {
    let end: number;
    if (t.startsWith('<!--', i)) end = ((j) => (j < 0 ? -1 : j + 3))(t.indexOf('-->', i + 4));
    else if (t.startsWith('<![CDATA[', i)) end = ((j) => (j < 0 ? -1 : j + 3))(t.indexOf(']]>', i + 9));
    else if (t.startsWith('<?', i)) end = ((j) => (j < 0 ? -1 : j + 2))(t.indexOf('?>', i + 2));
    else if (t.startsWith('<!', i)) end = tagEnd(i + 2, true);
    else {
      end = tagEnd(i + 1, false);
      svgTag.lastIndex = i;
      if (end >= 0 && svgTag.test(t)) return t.slice(i, end);
    }
    if (end < 0) return undefined;
    i = end;
  }
  return undefined;
}

/** PNG・JPEG・GIF・BMP・WebP・SVG の大きさ (px) を、ファイルの頭から読む (画像を描かない環境用) */
export function headerSize(b: Uint8Array, mime: string): { width: number; height: number; noRatio?: true } | undefined {
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
    // 開始タグは、ファイルの頭 (4096 バイト) で終わらなければ (長い注釈・DOCTYPE の内部の宣言の後など)、ファイル全体から探す
    const svg = svgStartTag(new TextDecoder().decode(b.subarray(0, 4096))) ?? (b.length > 4096 ? svgStartTag(new TextDecoder().decode(b)) : undefined) ?? '';
    // 長さ (px)。em・ex・rem・pc・Q も読む: 文書の外の画像なので、字の大きさは CSS の既定の 16px (em・rem)、ex はその半分
    // (SVG 2 §8.2・CSS Values 4 §6: 字の大きさが分からないときの既定。CSS Images 3 §5 の本来の大きさ)
    // 空白を読む所 (\s*) を続けて並べない: 単位が無く引用符の前に別の字があると、空白の分け方を全部試して長さの 2 乗の時間になる
    // (開始タグはファイル全体から探すので、長さに上限が無い)
    const len = (n: string) => {
      const m = new RegExp(`\\b${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:(px|pt|pc|mm|cm|in|q|em|ex|rem)\\s*)?["']`, 'i').exec(svg);
      if (!m) return undefined;
      const k = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6, em: 16, ex: 8, rem: 16 }[(m[2] ?? 'px').toLowerCase() as 'px'];
      return parseFloat(m[1]) * k;
    };
    const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    const [vw, vh] = vb ? [parseFloat(vb[1]), parseFloat(vb[2])] : [undefined, undefined];
    // 幅・高さの指定が無ければ viewBox の大きさ。片方だけなら viewBox の縦横比で。どちらも無ければ 300×150 (ブラウザと同じ)
    const w = len('width') ?? (vw !== undefined && vh !== undefined && len('height') !== undefined ? (len('height')! * vw) / vh : vw);
    const h = len('height') ?? (vw !== undefined && vh !== undefined && w !== undefined ? (w * vh) / vw : undefined);
    return w && h ? { width: w, height: h } : { width: 300, height: 150, noRatio: true };
  }
  return undefined;
}

/** 読み込むファイルの大きさの上限の既定 (展開した後も含む。256MB)。呼び出しの上限 (limits.fileBytes) で変えられる */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** gzip を展開する。展開した大きさが limit を超えるか、展開できなければ undefined */
async function gunzipLimited(bytes: Uint8Array, limit: number): Promise<Uint8Array | undefined> {
  try {
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = rejoin(thisCall(), await reader.read());
      if (done) break;
      total += value.length;
      if (total > limit) {
        rejoin(thisCall(), await reader.cancel());
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
