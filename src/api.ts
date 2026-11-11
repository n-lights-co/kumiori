/**
 * Kumiori の公開 API: HTML+CSS・XSL-FO を組んで、Area Tree と PDF を作る。
 *
 *   import { typeset } from 'kumiori';
 *   const r = await typeset(html, { files: [{ name: 'style.css', data: css }] });
 *   const pdf = await r.toPdf();   // Uint8Array
 *
 * ファイルシステムには触らない。ネットワークは、既定の書体の取得 (loadFont で差し替えられる) と、文書が http(s) で参照する画像の取得
 * (fetchImages で止められる) にだけ使う。ブラウザでも Node でも動く。
 * Node のコマンド (src/cli.ts) も、この関数で組む。
 */

import fontkit from '@pdf-lib/fontkit';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { FontManager, type LoadedFont } from './fontManager';
import { Measurer } from './measurer';
import { LayoutEngine } from './layoutEngine';
import { renderPdf, type PdfRenderOptions } from './pdfRenderer';
import { renderSheetToCanvas } from './canvasRenderer';
import { AssetStore, looksLikeImage, mentionedFiles, normalizeSrc } from './assets';
import { droppedLinkWarning, summarizeDroppedLinks, type DroppedLinks, type LinkPolicy } from './linkPolicy';
import { SANS, SERIF } from './sampleData';
import { importHtml, parsePageSize } from './htmlImport';
import { importXslFo, type ImportOptions, type XNode } from './xslfoImport';
import { fetchReportedImages, mathOptionsFor, type MathOptions } from './documentResources';
import { collectionFaces, faceShapeOf, normalizeFamily, splitFontFile, type FaceTables, type UserFont } from './fontLoader';
import type { AreaTree, FontSpec, LDocument } from './types';
import { documentMode, prepareHtml, type HtmlDefaults } from './htmlPrepare';
import { cascadeStyles, HTML_UA_CSS } from './cssCascade';
import { summarizeCounts, unsupportedCssReport } from './cssUnsupported';
import { MESSAGE_LANGS, msg, withMessageLang, type MessageLang } from './messages';
import { FO_COMPATS, HTML_STYLES, ahCascadeOptions, compatLayoutOptions, compatPdfOptions, htmlImportCompatOptions, isAhCompat, loadFoHyphenators, type FoCompat } from './compat';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC, createFontMapping, hasMissingGlyphs, missingGlyphChars, setupDefaultFonts } from './fontMapping';
import { hyphenPositions, loadDocumentHyphenators } from './hyphenation';
import { xhtmlToHtml } from './xhtml';
import { collectResources, documentChars, refBasename } from './resources';

export type { HtmlDefaults } from './htmlPrepare';
export type { FontSpec } from './types';
export type { LinkPolicy } from './linkPolicy';

/** ファイルの中身 */
export type KumioriFileData = ArrayBuffer | Uint8Array | string;

/**
 * 入力と一緒に渡すファイル (CSS・画像・書体・SVG・MathML など)。name は入力の文書からの相対パス (例: "img/logo.png")。
 * data は中身か、中身を返す関数 (使うときだけ読む。たくさんのファイルを渡すときに)
 */
export interface KumioriFile {
  name: string;
  data: KumioriFileData | (() => Promise<KumioriFileData>);
}

export interface TypesetOptions {
  /** 入力の種類。省略すれば name の拡張子 (.fo・.xml は FO、.xhtml・.xht は XHTML) と中身 (XSL-FO の名前空間と root) で決める */
  kind?: 'html' | 'xhtml' | 'fo';
  /** 入力のファイル名 (種類の判定に使う) */
  name?: string;
  /** 入力と一緒に使うファイル。CSS は、文書から参照されていなければ利用者のスタイルシートとして足す。FO では、書体のファイルを FO の font-family の名前で使う */
  files?: KumioriFile[];
  /**
   * 足す書体のファイル (TTF・OTF・TTC・WOFF・WOFF2。システムに入れた書体のように、書体のファミリー名・太さ・幅・傾きで使う)。
   * 斜体の書体は font-style: italic の字に、幅の違う書体 (Arial Narrow など) は font-stretch の指定かその書体の名前で選ぶ (CSS Fonts 4 §5.2)
   */
  fonts?: KumioriFile[];
  /** 総称の書体 (serif・sans-serif) の欧文に使う書体のファミリー名 (fonts で渡した書体) */
  genericFonts?: Partial<Record<'serif' | 'sans-serif', string>>;
  /** HTML の既定のスタイル。既定 kumiori (本の組版向け) */
  style?: HtmlDefaults;
  /**
   * HTML の既定の用紙: @page で size を指定していない文書の用紙の大きさ。既定は A4。CSS の size と同じ書き方
   * (CSS Paged Media 3 §7.1: 用紙の名前 "A5"・"JIS-B5"・"letter"、向きを付けた "A5 landscape"、長さ "148mm 210mm"。長さは絶対の単位)。
   * 文書の @page { size: … } があれば、そちらが勝つ (向きだけの size: landscape は、この用紙を横置きにする)。余白の既定 (20mm) は変わらない。
   * @media の width・height・orientation も、この用紙で評価する (同 §7.1: メディアクエリは、@page の規則が無いときに選ばれる用紙で評価する)。
   * 既定のスタイル (style) によらず効く。XSL-FO では使わない (用紙は page master で決まる)
   */
  pageSize?: string;
  /** XSL-FO の既定値の流儀。spec (既定): XSL-FO 1.1 の初期値、antenna: アンテナハウスに合わせる */
  compat?: FoCompat;
  /** 印刷用: 塗り足し 3mm とトンボを付ける */
  print?: boolean;
  /** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1) */
  spotColors?: Record<string, [number, number, number, number]>;
  /** 既定の書体 (Noto Serif JP など。FONT_SPECS) を読む。既定は spec.urls を順に fetch する。undefined を返せば次の手段 (既定の取得) へ */
  loadFont?: (spec: FontSpec) => Promise<ArrayBuffer | undefined>;
  /** ネットワークからの取得 (書体・画像) の時限 (ミリ秒)。既定 30000 */
  fetchTimeoutMs?: number;
  /** 警告・誤りの文の言語 (ja・en)。省略すれば、それまでの設定 (既定は日本語) */
  lang?: MessageLang;
  /**
   * 文書が http(s) の URL で参照する画像 (external-graphic・img・background-image など) をネットワークから取るか。
   * 既定 true (取る)。false なら取らない (読めない画像として組む)。関数なら、URL ごとに取るかどうかを決める。
   * 他人の書いた文書をサーバーで組むときは、false か、取ってよい URL だけを許す関数にする (内部のホストへの要求を防ぐ)。
   * 関数には、文書に書かれた URL のほか、転送 (redirect) の先の URL も聞く (Node では、許されない先へは要求を出さない。たどるのは 20 回まで。
   * https から http への転送と、http(s) でない先への転送は断る)。ブラウザでは転送の先を前もって読めないので、たどった後の最後の URL を聞いて、
   * 許されなければ応答を使わない (要求そのものは転送の先に届く)。
   * 関数が見るのは URL の文字列だけなので、内部のアドレスに解決されるホスト名 (DNS rebinding を含む) は、この関数では防げない。
   * 内部の網を守るには、実行環境の側 (外向きの通信の制限・プロキシ) でも絞ること。
   * 取るものの大きさには上限がある (画像 256MB・CSS 16MB・書体 128MB。超えたものは読めない資源として扱う)
   */
  fetchImages?: boolean | ((url: string) => boolean);
  /**
   * 文書・CSS が参照するファイル (CSS・画像・書体・SVG など) のうち、files に無いものの中身を返す関数。url は書かれた参照
   * (file:///…/a.css・img/a.png・https://…)。CSS の中の相対参照は、その CSS の URL を基準に解決したもの。
   * 中身 (文字列・Uint8Array・ArrayBuffer) を返せば、その名前のファイルとして使う。undefined を返せば、これまでどおり
   * (http(s) の画像・CSS はネットワークから取る。fetchImages・fetchStyles)。ファイルシステムやデータベースから読むときに
   * 画像は、URL に拡張子が無くても (https://example.com/img?id=1 など)、返した中身の先頭のバイト列で画像と見分けて使う
   */
  resolveResource?: (url: string) => KumioriFileData | undefined | Promise<KumioriFileData | undefined>;
  /**
   * 文書が http(s) の URL で参照する CSS (<link rel="stylesheet">・@import) と、CSS の @font-face が http(s) で参照する書体 (WOFF2 など。
   * unicode-range が文書の字と重なるものだけ) をネットワークから取るか。既定 true (取る)。
   * 関数なら、URL ごとに決める。他人の書いた文書をサーバーで組むときは、false か、取ってよい URL だけを許す関数にする。
   * 転送の先の URL の扱い・関数で防げないもの (名前の解決)・大きさの上限は、fetchImages と同じ
   */
  fetchStyles?: boolean | ((url: string) => boolean);
  /** PDF の圧縮 (zlib の deflate)。Node なら zlib.deflateSync を渡すと速い。既定は pdf-lib の圧縮 */
  deflate?: (data: Uint8Array) => Uint8Array;
  /**
   * 文書の外へのリンク (HTML の <a href>・XSL-FO の fo:basic-link・fo:bookmark の external-destination) のうち、PDF に動作を書くもの。
   * 既定では、スキームが http・https・mailto・tel の URL (URI 動作) と、相対参照の PDF (別の PDF を開く動作 GoToR) だけを書く。
   * ほかのスキーム (javascript:・data:・file: など)、PDF でない相対のファイル・絶対パスのファイル (ファイルを開く動作)、スキームの無い //host/… は、
   * 動作を書かず (字はそのまま組む)、warnings に知らせる (他人の書いた文書から作った PDF を、別の人が開くときのため)。
   * schemes: 許すスキームの一覧 (既定の一覧と置き換わる。'*' はすべて)。launch: true なら、ファイルを開く動作 (Launch など) も書く。
   * 以前の版と同じ動き (すべて書く) にするには { schemes: ['*'], launch: true }
   */
  links?: LinkPolicy;
}

export interface TypesetResult {
  /** 組んだ Area Tree (ページごとのシート) */
  areaTree: AreaTree;
  /** ページ数 */
  pageCount: number;
  /** 組版の警告 (読めない画像・溢れなど) */
  warnings: string[];
  /** 組版にかかった時間 (ミリ秒。読み込み・PDF の書き出しは含まない) */
  layoutMs: number;
  /** PDF にする */
  toPdf(options?: Pick<PdfRenderOptions, 'title' | 'pdfx' | 'imageMaxDpi'>): Promise<Uint8Array>;
  /**
   * ページ (0 から数える) を canvas に描く (ブラウザ。印刷プレビューなど)。canvas の大きさは、ページの大きさ × scale に合わせて設定し直す。
   * 字は書体ファイルの輪郭から描くので、ページの外の書体の設定 (CSS の @font-face など) に左右されない
   */
  renderPage(canvas: HTMLCanvasElement, pageIndex: number, options?: RenderPageOptions): void;
}

/** renderPage の設定 */
export interface RenderPageOptions {
  /** 1pt あたりの CSS px。既定 96 / 72 (等倍。1pt = 1.333px) */
  scale?: number;
  /** 画面の画素の細かさ。既定は window.devicePixelRatio */
  devicePixelRatio?: number;
  /** 仕上がり・塗り足しのガイド線を描く (印刷用 print: true のとき)。既定 false */
  guides?: boolean;
}

const bytesOf = (d: KumioriFileData): Uint8Array => (typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));
const bufferOf = (d: KumioriFileData): ArrayBuffer => {
  const b = bytesOf(d);
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b.buffer as ArrayBuffer) : (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const textOf = (d: KumioriFileData) => (typeof d === 'string' ? d : new TextDecoder().decode(bytesOf(d)));
/**
 * 中の処理が使う形 (ブラウザの File と同じ: 名前はファイル名、読み出しは text・arrayBuffer)。関数の中身は 1 度だけ読む。
 * url: 参照から取ったファイルの、参照の URL の全体 (問い合わせの ?… も含む。名前が同じでも URL の違うものを取り違えないため)
 */
const toFile = (f: KumioriFile, css = false, url?: string) => {
  let got: Promise<KumioriFileData> | undefined;
  const data = () => (got ??= typeof f.data === 'function' ? f.data() : Promise.resolve(f.data));
  return { name: f.name.split(/[\\/]/).pop()!, path: f.name, css, ...(url !== undefined ? { url } : {}), data, text: async () => textOf(await data()), arrayBuffer: async () => bufferOf(await data()) };
};
/** CSS として読むファイル (拡張子 .css か、参照から CSS として取ったもの) */
const isCss = (f: { name: string; css?: boolean }) => !!f.css || /\.css$/i.test(f.name);
type InnerFile = ReturnType<typeof toFile>;

/**
 * 既定の書体を spec.urls (https のもの) から取る (時限つき)。読めた書体は、同じ実行の中で使い回す。
 * 取れなければ undefined (投げない)。Node のコマンドは、これで取った書体をキャッシュに保存する (cli.ts)
 */
const fetchedFonts = new Map<string, Promise<ArrayBuffer | undefined>>();
export async function fetchFont(spec: FontSpec, timeoutMs: number): Promise<ArrayBuffer | undefined> {
  const key = `${spec.family}|${spec.weight ?? 400}`;
  let p = fetchedFonts.get(key);
  if (!p) {
    p = (async () => {
      for (const u of spec.urls.filter((x) => /^https?:/.test(x))) {
        const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined);
        // 中身の読み取りの失敗 (切断など) は、次の URL を試す (この関数は拒否しない)
        if (res?.ok) {
          const buf = await res.arrayBuffer().catch(() => undefined);
          if (buf) return buf;
        }
      }
      return undefined;
    })();
    fetchedFonts.set(key, p);
    p.then(
      (b) => b || fetchedFonts.delete(key),
      () => fetchedFonts.delete(key),
    );
  }
  return p;
}

export { decodeDocumentText } from './documentText';

/** 内部実体の展開の上限: 入れ子の深さと、展開後の長さ (元の長さの倍数) */
const ENTITY_MAX_DEPTH = 8;
const ENTITY_MAX_GROWTH = 16;
/**
 * DOCTYPE の内部サブセットに宣言された内部実体 (<!ENTITY name "値">) を、文書の中の &name; に置き換える
 * (@xmldom/xmldom は内部実体を展開しないので、読み込みの前に自前で展開する。ブラウザの DOMParser と同じ結果にする)。
 * 外部実体 (SYSTEM・PUBLIC) と引数実体 (%) は展開しない。CDATA 区間とコメントの中は置き換えない。
 * 値の中の実体参照も展開する (深さ ENTITY_MAX_DEPTH まで。展開後の長さが元の ENTITY_MAX_GROWTH 倍を超えたら止める)
 */
export function expandInternalEntities(xml: string): string {
  const dt = /<!DOCTYPE\s[^[>]*\[([\s\S]*?)\]\s*>/i.exec(xml);
  if (!dt) return xml;
  const ents = new Map<string, string>();
  for (const m of dt[1].matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) if (!ents.has(m[1])) ents.set(m[1], m[2] ?? m[3] ?? '');
  if (!ents.size) return xml;
  const limit = xml.length * ENTITY_MAX_GROWTH;
  const expand = (t: string, depth: number): string =>
    t.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|&([A-Za-z_:][\w.:-]*);/g, (all, name?: string) => {
      if (name === undefined) return all;
      const v = ents.get(name);
      if (v === undefined) return all;
      if (depth >= ENTITY_MAX_DEPTH) throw new Error(msg(`XML の解析に失敗しました: 実体 &${name}; の入れ子が深すぎます`, `XML parse error: entity &${name}; is nested too deeply`));
      const out = expand(v, depth + 1);
      if (out.length > limit) throw new Error(msg(`XML の解析に失敗しました: 実体 &${name}; の展開が大きすぎます`, `XML parse error: the expansion of entity &${name}; is too large`));
      return out;
    });
  const bodyAt = dt.index + dt[0].length;
  const body = expand(xml.slice(bodyAt), 0);
  if (body.length > limit) throw new Error(msg('XML の解析に失敗しました: 内部実体の展開が大きすぎます', 'XML parse error: the expansion of internal entities is too large'));
  return xml.slice(0, bodyAt) + body;
}

/** FO を読む: xmldom で解析する (解析の誤りは例外)。DOCTYPE の内部実体は先に展開する */
const xmlParse = (xml: string): XNode => {
  const errors: string[] = [];
  const d = new XmlDOMParser({ onError: (level, msg) => void (level !== 'warning' && errors.push(msg)) }).parseFromString(expandInternalEntities(xml), 'text/xml');
  if (errors.length) throw new Error(msg(`XML の解析に失敗しました: ${errors[0].slice(0, 200)}`, `XML parse error: ${errors[0].slice(0, 200)}`));
  return d as unknown as XNode;
};
/**
 * HTML・SVG の読み取り。ブラウザでは、ブラウザに備わった DOMParser (HTML の仕様の読み取り) を使う。
 * Node では linkedom を使う。linkedom は Node のときだけ読み込む (ブラウザ向けに 1 つのファイルにまとめる側 (バンドラー) が linkedom を取り込まずに済むように、名前を変数で渡す)
 */
type Parsers = { html: (t: string) => Document; svg: (t: string) => unknown };
let parsersP: Promise<Parsers> | undefined;
const LINKEDOM = 'linkedom';
function parsers(): Promise<Parsers> {
  return (parsersP ??= (async () => {
    if (typeof DOMParser !== 'undefined' && typeof document !== 'undefined') {
      return {
        html: (t: string) => new DOMParser().parseFromString(t, 'text/html'),
        svg: (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml'),
      };
    }
    const lk = (await import(/* @vite-ignore */ /* webpackIgnore: true */ LINKEDOM)) as typeof import('linkedom');
    return {
      html: (t: string) => {
        const d = lk.parseHTML(wrapHtml(t)).document as unknown as Document;
        fixImplicitStructure(d);
        return d;
      },
      svg: (t: string) => new lk.DOMParser().parseFromString(t, 'image/svg+xml'),
    };
  })());
}
/** SVG の読み取り (typeset の始めに parsers() を読み込んでから使う) */
let svgParser: ((t: string) => unknown) | undefined;
const svgParse = (t: string) => svgParser!(t) as never;

/** 画像 (と、FO の external-graphic が指す MathML の文字のファイル) として読むファイル */
const IMAGE_FILE = /\.(png|jpe?g|gif|svgz?|webp|tiff?|bmp|emf|wmf|eps|ps|cgm|mml|xml)$/i;

/** 入力の種類 (TypesetOptions.kind) に使える値 */
const KINDS = ['html', 'xhtml', 'fo'] as const;

/** 選択肢の誤り。入口 (createTypesetter・typeset) で検証し、知らない値を無言で下流へ流さない (JavaScript や JSON の設定から呼ぶ利用者には型の守りが無い) */
const optionError = (m: string) => new TypeError(msg(`選択肢の誤り: ${m}`, `invalid option: ${m}`));
/** 決まった値のどれか (省略 (undefined) はそのまま) */
function oneOf<T extends string>(name: string, v: unknown, allowed: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw optionError(msg(`${name} の値 ${JSON.stringify(v)} は使えません (${allowed.join('・')} のどれか)`, `${name} cannot be ${JSON.stringify(v)} (one of ${allowed.join(', ')})`));
  return v as T;
}
/**
 * 選択肢の検証: kind・compat・style は決まった値、fetchTimeoutMs は正の数、files・fonts は配列、loadFont・deflate は関数、fetchImages は真偽値か関数。
 * createTypesetter の設定と、文書ごとの設定 (と両方を合わせたもの) に使う。誤りは TypeError
 */
function checkOptions(o: TypesetOptions) {
  oneOf('kind', o.kind, KINDS);
  oneOf('compat', o.compat, FO_COMPATS);
  oneOf('style', o.style, HTML_STYLES);
  oneOf('lang', o.lang, MESSAGE_LANGS);
  if (o.pageSize !== undefined && (typeof o.pageSize !== 'string' || !parsePageSize(o.pageSize)))
    throw optionError(msg(`pageSize の値 ${JSON.stringify(o.pageSize)} は使えません (CSS の size の書き方: "A5"・"A5 landscape"・"148mm 210mm" など)`, `pageSize cannot be ${JSON.stringify(o.pageSize)} (write it like the CSS size property: "A5", "A5 landscape", "148mm 210mm", etc.)`));
  const t = o.fetchTimeoutMs;
  if (t !== undefined && !(typeof t === 'number' && Number.isFinite(t) && t > 0)) throw optionError(msg(`fetchTimeoutMs は正の数 (ミリ秒) にしてください: ${String(t)}`, `fetchTimeoutMs must be a positive number of milliseconds: ${String(t)}`));
  for (const k of ['files', 'fonts'] as const) if (o[k] !== undefined && !Array.isArray(o[k])) throw optionError(msg(`${k} は KumioriFile の配列にしてください`, `${k} must be an array of KumioriFile`));
  for (const k of ['loadFont', 'deflate'] as const) if (o[k] !== undefined && typeof o[k] !== 'function') throw optionError(msg(`${k} は関数にしてください`, `${k} must be a function`));
  for (const k of ['fetchImages', 'fetchStyles'] as const) {
    const fi = o[k];
    if (fi !== undefined && typeof fi !== 'boolean' && typeof fi !== 'function') throw optionError(msg(`${k} は真偽値か関数にしてください`, `${k} must be a boolean or a function`));
  }
  if (o.resolveResource !== undefined && typeof o.resolveResource !== 'function') throw optionError(msg('resolveResource は関数にしてください', 'resolveResource must be a function'));
  for (const k of ['genericFonts', 'spotColors'] as const) if (o[k] !== undefined && (typeof o[k] !== 'object' || o[k] === null)) throw optionError(msg(`${k} はオブジェクトにしてください`, `${k} must be an object`));
  const ln = o.links;
  if (ln !== undefined) {
    if (typeof ln !== 'object' || ln === null) throw optionError(msg('links はオブジェクトにしてください', 'links must be an object'));
    if (ln.schemes !== undefined && !(Array.isArray(ln.schemes) && ln.schemes.every((s) => typeof s === 'string'))) throw optionError(msg('links.schemes は文字列の配列にしてください', 'links.schemes must be an array of strings'));
    if (ln.launch !== undefined && typeof ln.launch !== 'boolean') throw optionError(msg('links.launch は真偽値にしてください', 'links.launch must be a boolean'));
  }
}
/** createTypesetter の設定のうち、Typesetter.typeset の文書ごとの設定に渡しても使われないもの (器を作るときに読み込みが済んでいる) */
const SETUP_ONLY_OPTIONS = ['fonts', 'genericFonts', 'loadFont'] as const;

/** 入力の種類を決める (kind は checkOptions で検証済み) */
function kindOf(text: string, o: TypesetOptions): 'html' | 'xhtml' | 'fo' {
  if (o.kind) return o.kind;
  if (o.name && /\.(fo|xml)$/i.test(o.name)) return 'fo';
  if (o.name && /\.(xhtml|xht)$/i.test(o.name)) return 'xhtml';
  const head = text.slice(0, 4000);
  return /http:\/\/www\.w3\.org\/1999\/XSL\/Format/.test(head) && /<([\w-]+:)?root[\s>]/.test(head) ? 'fo' : 'html';
}

/** HTML+CSS・XSL-FO を組む */
export async function typeset(text: string, options: TypesetOptions = {}): Promise<TypesetResult> {
  return withMessageLang(options.lang, async () => (await buildTypesetter(options))(text, options));
}

/** createTypesetter の設定: 書体まわり (何度組んでも同じもの) */
export type TypesetterOptions = Pick<TypesetOptions, 'fonts' | 'genericFonts' | 'loadFont' | 'fetchTimeoutMs' | 'deflate'>;
/** Typesetter.typeset の設定: 文書ごとのもの */
export type DocumentOptions = Omit<TypesetOptions, keyof TypesetterOptions>;

/** 書体を読み込んだ組版の器。同じ書体で、文書を何度でも組む (エディタの印刷プレビューなど) */
export interface Typesetter {
  /** 文書を組む (typeset と同じ。書体は読み込み済みのものを使い回す) */
  typeset(text: string, options?: DocumentOptions): Promise<TypesetResult>;
}

/**
 * 書体を 1 度だけ読み込み (取得と字形の解析)、文書を何度でも組める器を作る。typeset を何度も呼ぶより速い。
 * 数式・等幅・記号の書体は、使う文書を初めて組むときに読み込み、その後は使い回す。
 * 文書ごとの書体 (XSL-FO と一緒に渡した書体ファイル・CSS の @font-face) は、その文書を組むときだけ使う
 */
export async function createTypesetter(setup: TypesetterOptions = {}): Promise<Typesetter> {
  const run = await buildTypesetter(setup);
  return {
    typeset: async (text, options = {}) => withMessageLang(options.lang, async () => {
      // 書体まわりの設定 (fonts・genericFonts・loadFont) は器を作るときのもの。文書ごとの設定に渡しても使われないので、無言で捨てずに警告にする
      // (typeset(text, options) は同じ options を器と文書の両方に渡すので、ここは Typesetter.typeset だけ)
      const ignored = SETUP_ONLY_OPTIONS.filter((k) => (options as TypesetOptions)[k] !== undefined).map((k) => msg(`${k} は createTypesetter の設定です (Typesetter.typeset の文書ごとの設定では使われません)`, `${k} is a createTypesetter option (it is not used in the per-document options of Typesetter.typeset)`));
      const r = await run(text, options);
      return ignored.length ? { ...r, warnings: [...ignored, ...r.warnings] } : r;
    }),
  };
}

/** 書体を読み込み、文書を組む関数を返す (createTypesetter と typeset の中身) */
async function buildTypesetter(setup: TypesetterOptions): Promise<(text: string, options: DocumentOptions) => Promise<TypesetResult>> {
  checkOptions(setup);
  svgParser ??= (await parsers()).svg;
  const timeout = setup.fetchTimeoutMs ?? 30_000;
  const bufferOfSpec = async (spec: FontSpec) => {
    const buf = (await setup.loadFont?.(spec)) ?? (await fetchFont(spec, timeout));
    if (!buf) throw new Error(msg(`書体を読めません: ${spec.family}`, `cannot load font: ${spec.family}`));
    return buf;
  };
  const base = new FontManager();
  const baseWarnings: string[] = [];
  base.onNotice = (m) => baseWarnings.push(m);
  /** 書体の名前 → ファミリー名の表 (fontMapping の FontNameTable)。ここには fonts で足した書体 (installed) を登録し、文書ごとの書体は文書を組むときに写しへ足す */
  const fontNames = new FontNameTable();
  // 既定の書体 (明朝・ゴシックの標準と太字、欧文の標準と太字)。太字の枠に、同じファミリーの標準の太さと同じ中身のファイルが渡されたときは、
  // 太字の書体は無いものとして登録しない (FontManager.registerDefaults。太字の字は、標準の太さの書体を太らせて描く)
  const defaults: Array<{ spec: FontSpec; buf: ArrayBuffer }> = [];
  for (const spec of [...FONT_SPECS, ...LATIN_SPECS]) defaults.push({ spec, buf: await bufferOfSpec(spec) });
  await base.registerDefaults(defaults, false);
  setupDefaultFonts(base);
  // 足す書体: name 表のファミリー名 (nameID 16、無ければ 1) と OS/2 の太さ・幅 (usWidthClass)・傾き (fsSelection) で登録する。
  // 同じファミリー名・太さでも、幅・傾きの違う書体は別の書体で、font-stretch・font-style の指定で選ばれる (CSS Fonts 4 §5.2: 幅 → 傾き → 太さの順)
  for (const f of (setup.fonts ?? []).map((f) => toFile(f))) {
    // TTC (書体の集まり) は、中の書体を一つずつ取り出して登録する。壊れた・短いファイルは警告にして、ほかの書体は登録する
    let faces: ArrayBuffer[];
    try {
      faces = collectionFaces(await f.arrayBuffer());
    } catch (e) {
      baseWarnings.push(msg(`${f.name} の書体を読めません${e instanceof Error && e.message ? ` (${e.message})` : ''}`, `cannot read the font file ${f.name}${e instanceof Error && e.message ? ` (${e.message})` : ''}`));
      continue;
    }
    for (const buf of faces) {
      let fk: { familyName?: string; name?: { records?: { preferredFamily?: Record<string, string>; fontFamily?: Record<string, string> } } } & FaceTables;
      try {
        fk = fontkit.create(new Uint8Array(buf)) as unknown as typeof fk;
      } catch {
        baseWarnings.push(msg(`${f.name} の書体を読めません`, `cannot read the font file ${f.name}`));
        continue;
      }
      const shape = faceShapeOf(fk);
      const family = fk.name?.records?.preferredFamily?.en ?? fk.familyName;
      if (!family) {
        baseWarnings.push(msg(`${f.name} の書体のファミリー名が読めません`, `cannot read the family name of the font file ${f.name}`));
        continue;
      }
      // 足した書体は、HTML の line-height: normal の行の高さを書体の値から決める (@font-face の書体と同じ。fontMapping.ts の htmlNormalLineHeight)
      const lf = await base.registerBuffer(family, fk['OS/2']?.usWeightClass ?? 400, buf, false, undefined, shape);
      lf.metricsLineHeight = true;
      // name 表のファミリー名 (各言語の nameID 16・1。「ＭＳ ゴシック」と「MS Gothic」など) のどれでも引けるようにする
      const recs = fk.name?.records;
      const legacy = fk.name?.records?.fontFamily?.en ?? fk.familyName;
      if (shape.width !== undefined && legacy && normalizeFamily(legacy) !== normalizeFamily(family)) {
        // 幅の違う書体が 1 つのファミリーにまとまっている書体 (Arial Narrow: nameID 16 は "Arial"、nameID 1 は "Arial Narrow"、幅は condensed):
        // nameID 16 の名前はファミリー (font-stretch の指定で、幅の違う書体から選ぶ)。nameID 1 の名前は、その幅の書体だけを指す別名
        // (CSS Fonts 4 §5.2: ファミリー名は、入っている書体から探す。別名を含めてよい)
        base.addFamilyAlias(legacy, lf);
        fontNames.add('installed', [family, ...Object.values(recs?.preferredFamily ?? {})], family);
        fontNames.add('installed', [legacy, ...Object.values(recs?.fontFamily ?? {})], legacy);
      } else fontNames.add('installed', [family, fk.familyName, ...Object.values(recs?.preferredFamily ?? {}), ...Object.values(recs?.fontFamily ?? {})], family);
    }
  }
  // 総称の書体 (既定の和文書体) の欧文を、指定の書体にする
  for (const [generic, family] of Object.entries(setup.genericFonts ?? {})) {
    if (!family) continue;
    if (!base.has(family)) {
      baseWarnings.push(msg(`genericFonts の書体 "${family}" が読み込まれていません (fonts で書体ファイルを渡してください)`, `the genericFonts font "${family}" is not loaded (pass its font file in fonts)`));
      continue;
    }
    base.setLatinFallback(generic === 'serif' ? SERIF : SANS, family);
  }
  // 文書によって使う書体 (数式・等幅・記号): 初めて使うときに読み込んで base に入れ、その後は解析し直さない
  const optional = new Map<string, Promise<LoadedFont>>();
  const loadOptional = async (fonts: FontManager, spec: FontSpec) => {
    const key = `${spec.family}|${spec.weight ?? 400}`;
    let p = optional.get(key);
    if (!p) {
      p = bufferOfSpec(spec).then((buf) => base.registerBuffer(spec.family, spec.weight ?? 400, buf, false));
      optional.set(key, p);
      // 読めなかったときは、次の文書でまた試す
      p.catch(() => optional.delete(key));
    }
    fonts.adopt(await p);
  };
  return (text, options) => typesetDocument(text, { ...setup, ...options }, base, loadOptional, baseWarnings, fontNames);
}

/** 文書を 1 つ組む: base (読み込み済みの書体) の写しに、文書ごとの書体を足して組む */
async function typesetDocument(
  text: string,
  options: TypesetOptions,
  base: FontManager,
  loadSpec: (fonts: FontManager, spec: FontSpec) => Promise<void>,
  baseWarnings: string[],
  baseNames: FontNameTable,
): Promise<TypesetResult> {
  // 選択肢は入口で検証し、compat は 1 つの真偽値 (ah) に正規化して下流 (組版・PDF の設定) に渡す (読み込みの Importer も同じ判定 isAntennaCompat を使う)
  checkOptions(options);
  const kind = kindOf(text, options);
  const isFo = kind === 'fo';
  const timeout = options.fetchTimeoutMs ?? 30_000;
  const style = options.style ?? 'kumiori';
  const compat: FoCompat = options.compat ?? 'spec';
  // アンテナハウス互換 (XSL-FO の既定・HTML の style ah) の設定は compat.ts (画面と同じ)
  const ah = isAhCompat(isFo ? 'fo' : 'html', { compat, style });
  const files = (options.files ?? []).map((f) => toFile(f));
  const warnings: string[] = [...baseWarnings];
  // 文書・CSS が参照するファイルのうち、files に無いもの: resolveResource に問い合わせ、http(s) の CSS は取る (fetchStyles)
  {
    const names = new Set(files.flatMap((f) => [f.path.split('\\').join('/').replace(/^\.\//, ''), f.name.toLowerCase()]));
    // 文書に出てくる字 (タグや CSS の字も含む、多めの見積もり)。@font-face の書体のうち、unicode-range がこれと重ならないものは取らない
    // (CSS Fonts 4 §4.5)。数値の文字参照と CSS の逃がしの字も入る (documentChars)。CSS の content の文字列の字は collectResources が足す
    const chars = documentChars(text);
    // 名前の文字参照 (&alpha;・&hellip; など) は、HTML の解析に解かせる (名前の表を持たない)。XML で決まっている 5 つは ASCII の字
    const named = new Set((text.match(/&[A-Za-z][A-Za-z0-9]*;?/g) ?? []).filter((n) => !/^&(amp|lt|gt|quot|apos);?$/.test(n)));
    if (named.size) for (const ch of (await parsers()).html(`<p>${[...named].join(' ')}</p>`).body?.textContent ?? '') chars.add(ch.codePointAt(0)!);
    const got = await collectResources(text, {
      chars,
      has: (u) => names.has(u) || names.has(refBasename(u)),
      cssTexts: await Promise.all(files.filter(isCss).map(async (f) => ({ name: f.path, text: await f.text() }))),
      ...(options.resolveResource ? { resolve: options.resolveResource } : {}),
      fetchStyle: (u) => (typeof options.fetchStyles === 'function' ? options.fetchStyles(u) : options.fetchStyles !== false),
      timeoutMs: timeout,
    });
    for (const f of got.files) {
      files.push(toFile({ name: f.name, data: f.data }, f.css, f.url));
      names.add(f.name);
    }
    for (const w of got.warnings) {
      const [kind, url0] = w.split('\t');
      const url = url0.slice(0, 200);
      const font = kind.startsWith('font');
      warnings.push(
        kind.endsWith('not-fetched')
          ? msg(`${font ? '書体' : 'CSS'}を取りません (fetchStyles): ${url}`, `${font ? 'font' : 'stylesheet'} not fetched (fetchStyles): ${url}`)
          : msg(`${font ? '書体' : 'CSS'}を取得できません: ${url}`, `cannot fetch the ${font ? 'font' : 'stylesheet'}: ${url}`),
      );
    }
  }

  // 書体。FO では、一緒に渡した書体ファイルを、FO の font-family の名前 (和名・英名) から使う (画面で書体を読み込んだのと同じ)
  const fonts = base.fork();
  fonts.onNotice = (m) => warnings.push(m);
  const fontNames = baseNames.fork();
  const userFonts: UserFont[] = [];
  if (isFo) {
    // 同じファミリー・太さの書体が複数あれば、先のものを使う。書体は輪郭から描くので、ブラウザの document.fonts には登録しない (canvas: false)
    const cands: UserFont[] = [];
    for (const f of files.filter((x) => /\.(ttf|otf|ttc|otc|woff2?)$/i.test(x.name))) cands.push(...splitFontFile(await f.arrayBuffer()));
    for (const u of cands) {
      if (userFonts.some((x) => x.family === u.family && x.weight === u.weight && x.style === u.style)) continue;
      // 斜体・斜めの書体は、同じファミリーの傾きの違う書体として登録する (font-style の指定で選ばれる。XSL 1.1 §7.9.7・CSS Fonts 4 §5.2)
      await fonts.registerBuffer(u.family, u.weight, u.buffer, false, undefined, u.style ? { style: u.style } : undefined);
      userFonts.push(u);
      fontNames.add('document', u.names, u.family);
    }
  }
  // FO の font-family は、files の書体 (document) を先に、次に fonts で足した書体 (installed) を探す。HTML は @font-face の書体 (face) の次に fonts の書体を探す (FontNameTable)
  const mapping = createFontMapping(fonts, fontNames, { canvas: false });

  // 画像 (と、FO の external-graphic が指す MathML の文字のファイル)。文書と CSS (と、そこから参照された SVG) に名前が出てくるものだけを読む。
  // 画像の突き合わせはファイル名 (basename) でも当たるので、ファイル名で選ぶ
  const assets = new AssetStore({ parseXml: svgParse });
  const mentioned = mentionedFiles([text, ...(await Promise.all(files.filter(isCss).map((f) => f.text())))]);
  const images = files.filter((x) => IMAGE_FILE.test(x.name));
  // 文書に名前が出てくるか。mentionedFiles は %xx を戻した名前を返すので、参照から取ったファイル (名前は参照の URL のまま =
  // %xx のまま。resolveResource にも、その URL で問い合わせている) は、%xx を戻した名前でも突き合わせる。戻さないと、名前に空白・
  // 括弧・日本語などのある画像 (a%20b.png) が、中身を受け取っているのに「見つからない画像」になる (RFC 3986 §2.1・§6.2.2.2:
  // %xx と元の字は同じ参照)
  const isMentioned = (x: (typeof files)[number]) => mentioned.has(x.name.toLowerCase()) || (x.url !== undefined && mentioned.has(refBasename(x.url)));
  for (const f of images.filter((x) => /\.svg$/i.test(x.name) && isMentioned(x))) {
    for (const n of mentionedFiles([await f.text()])) mentioned.add(n);
  }
  for (const f of images.filter(isMentioned)) {
    const asset = await assets.addBlob(f.path.split('\\').join('/'), new Blob([bytesOf(await f.data()) as BlobPart]));
    // 参照から取った画像は、参照の URL の全体 (問い合わせの ?… を含む) でも登録する。画像は「完全一致 → ファイル名」の順に引くので、
    // 問い合わせだけが違う 2 つの画像 (a.png?id=1 と a.png?id=2) が、それぞれの画像になる (名前だけだと、後に登録したものに両方が当たる)
    if (asset && f.url !== undefined && normalizeSrc(f.url) !== asset.key) {
      const { key: _key, ...rest } = asset;
      assets.register(f.url, rest);
    }
  }
  // 参照から取った中身 (resolveResource の返したもの) のうち、名前に画像の拡張子の無いもの (https://example.com/img?id=1 など):
  // 中身の先頭のバイト列が画像なら、参照の URL の画像として読む (拡張子では決めない。HTML の画像の種類は、中身の先頭で決まる:
  // MIME Sniffing Standard §8.2「Sniffing in an image context」・§6.1。looksLikeImage)。CSS と、名前に書体の拡張子のあるものは見ない。
  // 画像でない中身は使わない (その参照は、これまでどおり: http(s) の画像なら fetchImages の判定でネットワークから取る)
  for (const f of files) {
    if (f.url === undefined || isCss(f) || IMAGE_FILE.test(f.name) || /\.(ttf|otf|ttc|otc|woff2?)$/i.test(f.name) || assets.get(f.url)?.key === normalizeSrc(f.url)) continue;
    const bytes = bytesOf(await f.data());
    if (looksLikeImage(bytes)) await assets.addBlob(f.url, new Blob([bytes as BlobPart]));
  }

  const measurer = new Measurer(fonts, 'fontkit');
  // MathML のある文書なら、数式の書体を読み込む (読めなければ、本文の書体で組む。画面と同じ手順: documentResources)
  const mathOpts = await mathOptionsFor(text, fonts, () => loadSpec(fonts, MATH_SPEC).catch((e) => warnings.push(String(e instanceof Error ? e.message : e))));
  // XHTML は XML の構文で読み、名前空間に従って HTML に書き直してから組む
  const html = kind === 'xhtml' ? xhtmlToHtml(text) : text;
  let res = isFo ? await importFo(text, options, compat, mapping, assets, mathOpts) : await importHtmlText(html, options, style, files, mapping, assets, measurer, mathOpts, kind === 'xhtml');
  // ブラウザの既定のスタイル (line-height: normal を既定の書体の値でも決める。compat.ts の BROWSER_HTML_IMPORT_OPTIONS): 等幅の書体 (Cousine) は、
  // 読み込みの中で等幅の指定が分かってから読むので、読み込みの時点では normal の値を引けない (和文の書体の値になる)。読んでから読み込み直す
  if (!isFo && htmlImportCompatOptions(style).normalLineHeightAllFonts && mapping.usesMono() && !fonts.has('Cousine')) {
    for (const spec of MONO_SPECS) await loadSpec(fonts, spec).catch((e) => warnings.push(String(e instanceof Error ? e.message : e)));
    if (fonts.has('Cousine')) res = await importHtmlText(html, options, style, files, mapping, assets, measurer, mathOpts, kind === 'xhtml');
  }
  // ネットワーク上の画像・data URI の画像 (画面と同じ手順: documentResources)。http(s) の画像は fetchImages (既定 true) で取るかどうかを決める
  const allowFetch = (url: string) => (typeof options.fetchImages === 'function' ? options.fetchImages(url) : options.fetchImages !== false);
  warnings.push(...(res.warnings ?? []));
  for (const src of await fetchReportedImages(assets, res.report.images, allowFetch, timeout)) warnings.push(msg(`画像を取りません (fetchImages): ${src.slice(0, 200)}`, `image not fetched (fetchImages): ${src.slice(0, 200)}`));
  // 未対応の指定 (黙って無視しない): XSL-FO は読めなかった要素・プロパティ、HTML は未対応・知らない CSS (ブラウザの画面の変換レポートと同じ数え方)
  const miss = summarizeCounts(res.report.unsupported);
  if (miss) warnings.push(msg(`${isFo ? '未対応の XSL-FO の要素・プロパティを' : '未対応の CSS を'}無視しました: ${miss}`, `ignored unsupported ${isFo ? 'XSL-FO elements/properties' : 'CSS'}: ${miss}`));
  // 添付ファイルの注釈が参照するファイル (files の中から、パスか名前で探す)
  for (const src of (res.report as { files?: string[] }).files ?? []) {
    const norm = src.split('\\').join('/').replace(/^\.\//, '');
    const base = norm.split('/').pop()!.toLowerCase();
    const f = files.find((x) => x.path.split('\\').join('/') === norm) ?? files.find((x) => x.name.split('/').pop()!.toLowerCase() === base);
    if (f) assets.registerFile(src, bytesOf(await f.data()));
    else warnings.push(msg(`添付するファイルが見つかりません: ${src}`, `attachment file not found: ${src}`));
  }
  // 動作を書かなかった、文書の外へのリンク (links の設定で通さないもの)
  const dropped = summarizeDroppedLinks(res.report.droppedLinks);
  if (dropped) warnings.push(droppedLinkWarning(dropped));
  const unknown = summarizeCounts(res.report.unknownCss);
  if (unknown) warnings.push(msg(`知らない CSS のプロパティを無視しました (綴りの誤りか未対応): ${unknown}`, `ignored unknown CSS properties (misspelled or unsupported): ${unknown}`));
  // 等幅の指定があれば、等幅の書体を読み込む (SVG の字に Courier・monospace の指定があっても読み込む)
  const svgMono = async () => {
    for (const f of files.filter((x) => /\.svg$/i.test(x.name))) if (/font-family\s*[=:]\s*["']?[^;>]*(courier|monospace)/i.test(await f.text().catch(() => ''))) return true;
    return false;
  };
  if (mapping.usesMono() || (await svgMono())) for (const spec of MONO_SPECS) await loadSpec(fonts, spec).catch((e) => warnings.push(String(e instanceof Error ? e.message : e)));
  if (hasMissingGlyphs(fonts, res.document)) await loadSpec(fonts, SYMBOL_SPEC).catch((e) => warnings.push(String(e instanceof Error ? e.message : e)));
  // 読み込んだどの書体にも字形の無い字 (字形の無い字の形 = 豆腐で出る) を知らせる: 字と数。多ければ、多い順の先頭と残りの数
  const tofu = [...missingGlyphChars(fonts, res.document)].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  if (tofu.length) {
    const cp = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    const head = tofu.slice(0, 20).map(([ch, n]) => `${ch} (${cp(ch)}${n > 1 ? ` ×${n}` : ''})`).join('、');
    const rest = tofu.length > 20 ? msg(` …ほか ${tofu.length - 20} 種`, ` … and ${tofu.length - 20} more`) : '';
    warnings.push(msg(`読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます): ${head}${rest}`, `no loaded font has a glyph for these characters (they are drawn as the missing-glyph box): ${head}${rest}`));
  }

  const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: SERIF, assets, hyphenate: hyphenPositions, ...compatLayoutOptions(ah) });
  const t0 = Date.now();
  const tree = engine.layout(res.document);
  const layoutMs = Date.now() - t0;
  return {
    areaTree: tree,
    pageCount: tree.sheets.length,
    warnings: [...warnings, ...tree.warnings],
    layoutMs,
    toPdf: (o = {}) =>
      renderPdf(tree, fonts, {
        ...compatPdfOptions(isFo ? 'fo' : 'html', ah),
        assets,
        parseXml: svgParse,
        ...(options.deflate ? { deflate: options.deflate } : {}),
        ...(options.links ? { links: options.links } : {}),
        ...o,
      }),
    renderPage: (canvas, pageIndex, o = {}) => {
      const sheet = tree.sheets[pageIndex];
      if (!sheet) throw new RangeError(`ページ ${pageIndex} はありません (0〜${tree.sheets.length - 1})`);
      renderSheetToCanvas(sheet, canvas, fonts, {
        ...(o.scale !== undefined ? { scale: o.scale } : {}),
        ...(o.devicePixelRatio !== undefined ? { devicePixelRatio: o.devicePixelRatio } : {}),
        guides: !!o.guides,
        assets,
        glyphOutlines: true,
      });
    },
  };
}

/** HTML+CSS を組む (typeset の kind: 'html') */
export const typesetHtml = (html: string, options: Omit<TypesetOptions, 'kind'> = {}) => typeset(html, { ...options, kind: 'html' });
/** XSL-FO を組む (typeset の kind: 'fo') */
export const typesetFo = (fo: string, options: Omit<TypesetOptions, 'kind'> = {}) => typeset(fo, { ...options, kind: 'fo' });

type Mapping = ReturnType<typeof createFontMapping>;
type Imported = { document: LDocument; report: { images: string[]; unsupported?: Record<string, number>; unknownCss?: Record<string, number>; droppedLinks?: DroppedLinks }; /** 文書の用意の途中の警告 (深すぎる入れ子など) */ warnings?: string[] };
type MathOpts = MathOptions;

/** XSL-FO を論理ツリーにする (画面の XSL-FO の読み込みと同じ) */
async function importFo(text: string, o: TypesetOptions, compat: FoCompat, mapping: Mapping, assets: AssetStore, extra: Partial<ImportOptions> = {}): Promise<Imported> {
  // 分綴 (hyphenate="true") を使う文書なら、文書に出てくる言語の分綴の規則を先に読み込む
  await loadFoHyphenators(text);
  return importXslFo(text, xmlParse, {
    mapFont: mapping.mapFont,
    compat,
    bleedMm: o.print ? 3 : 0,
    trimMarks: !!o.print,
    readText: (src) => assets.getText(src),
    ...(o.links ? { links: o.links } : {}),
    ...(o.spotColors ? { spotColors: o.spotColors } : {}),
    ...extra,
  });
}

/**
 * linkedom の読み取りを、HTML の仕様の読み取り (ブラウザ) に合わせる:
 *  - 書かれていない <head>・<body> を補う。html の直下に並んだ要素と文字を、メタデータ (meta・title・link・style・script・base) は head へ、ほかは body へ順に移す
 *  - </html> の後ろに書かれた要素と文字 (linkedom は、html 要素の後ろの、文書の直下の兄弟にする) を、body の終わりへ順に移す
 *    (HTML Living Standard §13.2.6.4.17「after body」・§13.2.6.4.20「after after body」の挿入モード。2026-11-11 取得: コメントのほかは、
 *    「in body」の挿入モードに戻して処理する = body の続きになる)。コメントは文書の直下に残す。空白だけの文字は、後ろに移す内容が
 *    続くときだけ移す (移す内容の間の空白を残す。文書の終わりの空白は動かさない)
 *  - <pre>・<textarea>・<listing> の開始タグの直後の改行を捨てる
 */
export function fixImplicitStructure(doc: Document) {
  const html = doc.documentElement;
  const head = doc.head ?? html.insertBefore(doc.createElement('head'), html.firstChild);
  const body = doc.body ?? html.appendChild(doc.createElement('body'));
  {
    const after: ChildNode[] = [];
    for (let n = html.nextSibling; n; n = n.nextSibling) after.push(n);
    const content = (n: ChildNode) => n.nodeType === 1 || (n.nodeType === 3 && /[^ \t\n\f\r]/.test(n.nodeValue ?? ''));
    let last = after.length - 1;
    while (last >= 0 && !content(after[last])) last--;
    // html の直下の終わりへ移す (下の振り分けが、</body> と </html> の間の内容と同じに body へ入れる)
    for (const n of after.slice(0, last + 1)) if (n.nodeType === 1 || n.nodeType === 3) html.appendChild(n);
  }
  for (const n of Array.from(html.childNodes)) {
    if (n === head || n === body) continue;
    const meta = n.nodeType === 1 && /^(meta|title|link|style|script|base|noscript|template)$/i.test((n as Element).localName);
    // body に何も入っていないうちのメタデータは head へ、ほかは body へ
    if (meta && !body.hasChildNodes()) head.appendChild(n);
    else body.appendChild(n);
  }
  doc.querySelectorAll('pre, textarea, listing').forEach((el) => {
    const t = el.firstChild;
    if (t && t.nodeType === 3 && /^\r?\n/.test(t.nodeValue ?? '')) t.nodeValue = (t.nodeValue ?? '').replace(/^\r?\n/, '');
  });
}

/**
 * <html> の無い HTML (<p>… だけのもの) を <html> で包む (linkedom は、ブラウザのように文書の形を補わない)。
 * <!doctype> はそのまま前に残す。中身は fixImplicitStructure が head と body に分ける
 */
export function wrapHtml(t: string): string {
  if (/<html[\s>]/i.test(t)) return t;
  const m = /^\s*(<!doctype[^>]*>)/i.exec(t);
  return m ? `${m[1]}<html>${t.slice(m[0].length)}</html>` : `<html>${t}</html>`;
}

/** HTML と CSS を論理ツリーにする (画面と同じ集め方。計算値は自前のカスケード) */
async function importHtmlText(
  html: string,
  o: TypesetOptions,
  style: HtmlDefaults,
  files: InnerFile[],
  mapping: Mapping,
  assets: AssetStore,
  measurer: Measurer,
  math: MathOpts,
  /** XML の構文 (XHTML) で読んだ文書 (互換モードにならない) */
  xml: boolean,
): Promise<Imported> {
  const parseHtml = (await parsers()).html;
  // @page の無いときに選ばれる用紙 (既定は A4。TypesetOptions.pageSize で変える) と余白 20mm。@media の width・height・orientation も、この用紙で評価する
  // (CSS Paged Media 3 §7.1: Media queries do not honor size: they assume the paper size that would be chosen if no @page rules were specified)
  const defaultPage = { ...((o.pageSize !== undefined ? parsePageSize(o.pageSize) : undefined) ?? { width: 210, height: 297 }), margin: 20 };
  const prepared = await prepareHtml(html, files.filter(isCss), style, defaultPage, parseHtml);
  // 画像は data-kumiori-src に元のパスを残す (画面と同じ)
  prepared.doc.querySelectorAll('img[src]').forEach((img) => img.setAttribute('data-kumiori-src', img.getAttribute('src') ?? ''));
  // 既定のスタイル (style) は、作成者スタイルシート ではなく既定のスタイルシート (UA) として当てる (作成者スタイルシート に詳細度で勝たない)
  // attr() を置き換えた結果、読めない値になって無効にした宣言 (CSS Values 5 §7.7.1。警告に出す)
  const invalidAttr: Record<string, number> = {};
  const styles = cascadeStyles(prepared.doc, prepared.authorSheet, { uaCss: HTML_UA_CSS, uaExtraCss: prepared.uaSheet, quirksMode: documentMode(prepared.doc, xml), viewport: { width: Math.max(prepared.bodyWidthPx, 100), height: prepared.pageHeightPx }, ...(style === 'ah' ? ahCascadeOptions(prepared.sheet) : {}), onInvalidAttr: (p, v) => (invalidAttr[`${p}: ${v}`] = (invalidAttr[`${p}: ${v}`] ?? 0) + 1) });
  // @font-face の書体 (TTF・OTF と、ふつうの書体のファイルに戻して使う WOFF・WOFF2)
  // アンテナハウス互換 (style ah) では、font-weight の記述子の無い face を、書体のファイルの太さで登録する (fontMapping.loadFontFaces)
  await mapping.loadFontFaces(prepared.sheet, files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name)), { ahFaceWeight: style === 'ah' });
  // 分綴を使う文書なら、文書に出てくる言語の分綴の規則を読み込む
  await loadDocumentHyphenators(prepared.doc, prepared.css);
  // 作成者スタイルシート と style 属性のうち、読まない宣言 (未対応・知らないプロパティ) を数える
  const cssRep = unsupportedCssReport(prepared.authorSheet, prepared.doc);
  const imported = importHtml(prepared.doc, styles, {
    mapFont: mapping.mapHtmlFont,
    measureText: (t, st) => measurer.textAdvance(t, st, { kerning: st.kerning, features: st.features }),
    hasAsset: (src) => !!assets.get(src),
    imageSize: (src) => assets.get(src),
    normalLineHeight: mapping.htmlNormalLineHeight,
    // 既定のスタイルごとの互換の設定 (アンテナハウス互換・ブラウザ。compat.ts。画面と同じ)
    ...htmlImportCompatOptions(style),
    css: prepared.css,
    sheet: prepared.sheet,
    defaultPage,
    bleedMm: o.print ? 3 : 0,
    trimMarks: !!o.print,
    ...(o.links ? { links: o.links } : {}),
    ...(o.spotColors ? { spotColors: o.spotColors } : {}),
    ...math,
  });
  const unsupported = { ...imported.report.unsupported };
  for (const [k, n] of Object.entries(cssRep.unsupported)) unsupported[k] = (unsupported[k] ?? 0) + n;
  const badAttr = summarizeCounts(invalidAttr);
  const attrWarnings = badAttr
    ? [
        msg(
          `attr() を置き換えた値が読めない宣言を無視しました (型の無い attr() は文字列です。数や長さとして使うには attr(名前 number)・attr(名前 px) のように型を書きます): ${badAttr}`,
          `ignored declarations whose value is invalid after attr() substitution (an attr() without a type is a string; write a type such as attr(name number) or attr(name px) to use it as a number or a length): ${badAttr}`,
        ),
      ]
    : [];
  return { ...imported, report: { ...imported.report, unsupported, unknownCss: cssRep.unknown }, warnings: [...prepared.warnings, ...attrWarnings] };
}

