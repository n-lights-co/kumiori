/**
 * pdfRenderer — Area Tree → PDF (pdf-lib + fontkit)
 *
 * 座標系変換:
 *   Area Tree : 原点 = Sheet 左上, y 下向き, pt
 *   PDF       : 原点 = MediaBox 左下, y 上向き, pt
 *   → pdfY = sheetHeight − y
 *
 * 文字は「局所変換行列」で配置する。GlyphArea の描画原点 P(Sheet座標) と回転 θ (時計回り)・水平拡縮 sx から
 *   cm = [ sx·cosφ, sx·sinφ, −sinφ, cosφ, P.x, H−P.y ]   (φ = −θ : y 上向きでは時計回り = 負の回転)
 * を求め、その内側で原点 (0,0) に drawText する。縦書きの横倒し字・縦中横の圧縮が同じ式で表現できる。
 */
import {
  PDFDocument,
  PDFFont,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFString,
  PDFName,
  PDFRef,
  PDFImage,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames as Ops,
  PDFPage,
  PDFWidgetAnnotation,
  StandardFonts,
  beginText,
  cmyk,
  grayscale,
  concatTransformationMatrix,
  endText,
  setFontAndSize,
  showText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setDashPattern,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  TextRenderingMode,
  type Color,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FontManager } from './fontManager';
import { parseColor, type SpotColor } from './color';
import { walkAreaTree } from './areaTree';
import { MONO_GENERIC, SANS } from './sampleData';
import { FAKE_BOLD, ITALIC_SLANT, paintSheet, type Line, type Matrix, type Painter, type PathSeg } from './paint';
import { AssetStore } from './assets';
import { countDroppedLink, decodePath, droppedLinkWarning, judgeExternalLink, referencePath, summarizeDroppedLinks, type DroppedLinks, type LinkPolicy } from './linkPolicy';
import { iccRgbToCmyk, type CmykConverter } from './icc';
import { embedCmykImage, embedPngChecked, markCffSubset, memoEncode, pageOperators, patchCffEmbedding, patchFontkitSubset, useDeflate, widthOfHex, type FeatureFont } from './pdfLibPatches';
import { shrinkJpeg } from './jpeg';
import { PdfColorGlyphs } from './colorGlyphPdf';
import { apply, invert, mul, type Seg } from './matrix';
import { parseSvg, type SvgDoc, type SvgGradient, type SvgMask, type SvgPattern, type SvgShape, type TextChars, type XmlNode } from './svg';
import type { Annotation, Area, AreaTree, BookmarkArea, FormField, GlyphArea, ImageArea, LinkTarget, Rect, SheetArea, TateChuYokoArea } from './types';

export interface PdfRenderOptions {
  title?: string;
  subset?: boolean;
  /** 画像 (fo:external-graphic) の登録所 */
  assets?: AssetStore;
  /** SVG などをラスタライズするときの解像度 (dpi)。既定 300 */
  imageDpi?: number;
  /**
   * JPEG の画像の解像度の上限 (dpi)。置かれる大きさに対してこれより細かい JPEG は、この解像度に縮めて符号化し直す
   * (jpeg.ts。PDF が小さくなるときだけ)。既定は指定なし (元の JPEG をそのまま埋め込む)
   */
  imageMaxDpi?: number;
  /** SVG をベクタのまま埋め込むための XML パーサ。省略時はブラウザの DOMParser (無ければ SVG もラスタライズ) */
  parseXml?: (xml: string) => XmlNode;
  /**
   * SVG の marker を、overflow の指定が無ければ marker の枠で切り抜かずに描く (アンテナハウス互換。SVG の UA スタイルシートの既定は hidden。
   * refX で枠の外に置いた marker の矢印も描く)
   */
  svgMarkerOverflowVisible?: boolean;
  /** 根の svg の overflow が visible なら、画像の領域で切り抜かない (アンテナハウス互換。svg の ParseOptions.rootOverflowVisible) */
  svgRootOverflowVisible?: boolean;
  /**
   * SVG の字の font-family に書いた名前が、読み込んだ書体の PostScript 名か完全な名前なら、その書体 (とその太さ) で描く (アンテナハウス互換。
   * CSS Fonts 4 では、この名前で探すのは @font-face の src: local() だけ。
   * 例: Illustrator が書き出した font-family="'SourceSansPro-Black'" を Source Sans Pro Black で描く)
   */
  svgFontUniqueNames?: boolean;
  /**
   * 入稿用 (PDF/X-3:2003) の印: OutputIntent (印刷条件)・GTS_PDFXVersion・Trapped。
   * condition は ICC の登録名 (既定 JC200103 = Japan Color 2001 Coated)。登録名なら ICC プロファイルは省略でき、
   * profile (CMYK の ICC プロファイルのバイト列) を渡せば DestOutputProfile として埋め込み、RGB の色と画像は、そのプロファイルの BToA の表で
   * CMYK にする (src/icc.ts。表が読めなければ warnings に書き、rgbToCmyk の式で変換する)。
   * 透明 (不透明度) は PDF/X-3 では使えないので、使っていれば warnings に書く。
   * 出力意図の辞書の形は ISO 32000-2 の §14.11.5 (Table 401) で確かめた。PDF/X の規格 (ISO 15930) の本文では確かめていないので、規格への適合は保証しない。
   * 登録に無い印刷条件の名前 (condition) を使うときは、Table 401 により profile (DestOutputProfile) を渡すこと
   */
  pdfx?: { condition?: string; info?: string; profile?: Uint8Array; warnings?: string[] };
  /**
   * ページの中身などの圧縮 (Flate) に使う関数。省略時は pdf-lib の pako (JavaScript)。
   * Node のコマンドでは、組み込みの zlib (ネイティブで速い) を渡す。展開した中身は同じ
   */
  deflate?: (data: Uint8Array) => Uint8Array;
  /**
   * 文書の外への飛び先 (リンクの注釈・しおり・フォームの送り先) のうち、PDF に動作を書いてよいもの (linkPolicy.ts)。
   * 既定では、http・https・mailto・tel の URL と相対の PDF (GoToR) だけを書く。relative: 'uri' なら、相対参照を URI 動作に書く。ほかは動作を書かない
   */
  links?: LinkPolicy;
  /** 動作を書かなかった飛び先があれば、その警告の文を足す配列 */
  linkWarnings?: string[];
}

/** 部分書体の名前の印 (大文字 6 字。n 番目の部分書体ごとに違う) */
function subsetTag(n: number): string {
  let s = '';
  let x = n + 1;
  for (let k = 0; k < 6; k++) {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

/**
 * RGB を CMYK にする (入稿用 PDF/X の出力。ICC の色の変換はせず、ISO 32000-2 §10.4.2.4 の式で、黒の生成 BG(k) と
 * 下色の除去 UCR(k) を k そのものにしたもの: c = 1 − R、k = min(c, m, y)、C = c − k、K = k)。無彩色 (R = G = B) は K だけになる。
 * 逆の変換 (§10.4.2.3: R = 1 − min(1, C + K)) で元の RGB に戻る
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const c = 1 - r;
  const m = 1 - g;
  const y = 1 - b;
  const k = Math.min(c, m, y);
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [clip(c - k), clip(m - k), clip(y - k), clip(k)];
}

const iccCache = new WeakMap<Uint8Array, CmykConverter | null>();
/**
 * PDF/X の RGB → CMYK の変換: CMYK の ICC プロファイルを渡されたら、その表 (BToA) で変換する (読んだ表はプロファイルごとに覚える)。
 * 読めないプロファイルなら ISO 32000-2 §10.4.2.4 の式 (rgbToCmyk)。PDF/X でなければ undefined
 */
function pdfxConverter(opts: PdfRenderOptions): CmykConverter | undefined {
  const x = opts.pdfx;
  if (!x) return undefined;
  if (!x.profile) return rgbToCmyk;
  let c = iccCache.get(x.profile);
  if (c === undefined) {
    c = iccRgbToCmyk(x.profile) ?? null;
    iccCache.set(x.profile, c);
  }
  return c ?? rgbToCmyk;
}

/** CSS の色を PDF の色にする。toCmyk なら RGB を CMYK にする (PDF/X。灰色 (R = G = B) は DeviceGray のまま) */
function toPdfColor(input: string, toCmyk?: CmykConverter): Color {
  const c = parseColor(input);
  // 成分は 0〜1 に収める (有限でない値は、正の無限大なら 1、ほかは 0)。XSL-FO の rgb(1e999,0,0) のような値が Infinity のまま届くと、
  // pdf-lib の色の検査が投げて、文書の全体が PDF にならない
  const u = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v === Infinity ? 1 : 0);
  if (c.mode === 'rgb') {
    c.r = u(c.r);
    c.g = u(c.g);
    c.b = u(c.b);
    if (!toCmyk) return rgb(c.r, c.g, c.b);
    if (c.r === c.g && c.g === c.b) return grayscale(c.r);
    const [cc, m, y, k] = toCmyk(c.r, c.g, c.b);
    return cmyk(cc, m, y, k);
  }
  return c.gray ? grayscale(1 - u(c.k)) : cmyk(u(c.c), u(c.m), u(c.y), u(c.k));
}

/**
 * 特色 (Separation 色空間) を書くページと、登録した特色の名前。PdfPainter がページごとに 1 つ持つ
 * (モジュールのグローバルにすると、別の文書の描画と混ざり、描き終わってもページを保持し続ける)。
 * 色空間はページの資源 (Resources の ColorSpace) に、特色ごとに 1 つ置く
 */
interface SpotPage {
  page: PDFPage;
  names: Map<string, PDFName>;
  /** RGB の色を CMYK にして書く (PDF/X)。RGB → CMYK の変換 */
  cmyk?: CmykConverter;
}

/** ページの資源の ColorSpace の辞書 (無ければ作る)。タイリングパターンの資源にも同じ辞書を置く (模様の中でも特色の名前が解けるように) */
function spotColorSpaceDict(sp: SpotPage): PDFDict {
  const { Resources } = sp.page.node.normalizedEntries();
  let dict = Resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (!dict) {
    dict = sp.page.doc.context.obj({});
    Resources.set(PDFName.of('ColorSpace'), dict);
  }
  return dict;
}

/** 特色の色空間 ([/Separation /名前 /DeviceCMYK 濃度の変換]) の資源の名前。濃度の変換は 0 から代わりの CMYK への線形 (FunctionType 2) */
function spotColorSpace(sp: SpotColor, spotPage: SpotPage | undefined): PDFName | undefined {
  if (!spotPage) return undefined;
  const key = `${sp.name}|${sp.cmyk.join(',')}`;
  const hit = spotPage.names.get(key);
  if (hit) return hit;
  const ctx = spotPage.page.doc.context;
  const fn = ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: sp.cmyk, N: 1 }));
  const cs = ctx.register(ctx.obj([PDFName.of('Separation'), textName(sp.name), PDFName.of('DeviceCMYK'), fn]));
  const name = PDFName.of(`KmSp${spotPage.names.size}`);
  spotColorSpaceDict(spotPage).set(name, cs);
  spotPage.names.set(key, name);
  return name;
}

/**
 * 文字の名前 (特色の名前など) の名前オブジェクト。名前のバイト列は UTF-8 (ISO 32000-2 §7.3.5)。
 * pdf-lib の PDFName.of は字の UTF-16 の値の下位バイトを書くので、UTF-8 のバイトを 1 字ずつの文字列にしてから渡す
 * (0x21〜0x7E 以外と区切りの字・# は #xx で書かれる)
 */
function textName(s: string): PDFName {
  return PDFName.of(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(''));
}

/**
 * 字句の文字列 (literal string)。pdf-lib の PDFString.of は値をそのまま ( ) で囲むので、括弧と \ を逃がす (ISO 32000-2 §7.3.4.2)。
 * 0x20〜0x7E 以外の字を含む文字列は、テキスト文字列 (UTF-16BE。§7.9.2.2) の 16 進の文字列にする
 */
function pdfText(s: string): PDFString | PDFHexString {
  if (/^[\x20-\x7e]*$/.test(s)) return PDFString.of(s.replace(/[\\()]/g, (c) => '\\' + c));
  return PDFHexString.fromText(s);
}

/**
 * URI の文字列 (§12.6.4.8 の URI 動作: 7 ビットの ASCII。IRI の ASCII 以外の字は UTF-8 の %xx にする (RFC 3987 §3.1))。
 * 既にある %xx はそのまま。括弧と \ は逃がす
 */
function pdfUri(u: string): PDFString {
  const ascii = Array.from(u, (ch) => {
    const c = ch.codePointAt(0)!;
    if (c > 0x20 && c < 0x7f) return ch;
    return Array.from(new TextEncoder().encode(ch), (b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
  }).join('');
  return PDFString.of(ascii.replace(/[\\()]/g, (c) => '\\' + c));
}

/**
 * バイト列の文字列 (名前付きの飛び先の名前など、テキスト文字列でないもの)。0x20〜0x7E の字だけなら、括弧と \ を逃がした字句の文字列
 * (ISO 32000-2 §7.3.4.2)、ほかの字があれば、UTF-8 のバイト列を 16 進の文字列 (§7.3.4.3) にする。
 * pdf-lib の PDFString.of は、値をそのまま ( ) で囲み、字の番号の下位 8 ビットだけを書く。文書に書かれた字をそのまま渡すと、括弧で文字列を
 * 閉じて、続きを辞書の項目 (/S /JavaScript /JS (…) など) として書ける。逃がした括弧の代わりに、下位 8 ビットが括弧になる字 (U+0128・U+0129) を
 * 使っても同じ。辞書の同じ名前の項目は、後のものを読む実装が多いので、リンクの動作を、許していない動作 (linkPolicy) に書き換えられる
 */
function pdfByteString(s: string): PDFString | PDFHexString {
  if (/^[\x20-\x7e]*$/.test(s)) return PDFString.of(s.replace(/[\\()]/g, (c) => '\\' + c));
  return PDFHexString.of(Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join(''));
}

/** ASCII (0x20〜0x7E) でない字を _ にした名前 (添付ファイルのファイル指定の辞書の F。Unicode の名前は UF に書く) */
const asciiName = (s: string) => s.replace(/[^\x20-\x7e]/g, '_');

/**
 * ファイルの指定 (ISO 32000-2 §7.11)。0x20〜0x7E の字だけの名前は、ファイル指定の文字列 (§7.11.2)。ほかの字 (日本語の名前など) があれば、
 * ファイル指定の辞書 (§7.11.3 Table 43) にして、UF に Unicode のテキスト文字列 (UTF-16BE、BOM 付き) で名前を書く。F は、UF を読まない
 * 実装のための名前で、同じ名前の UTF-8 のバイト列 (16 進の文字列) にする (ファイル指定の文字列はバイト列で、ファイルの名前を UTF-8 で持つ
 * 環境では、そのまま名前に当たる。_ に置き換えた名前では、どの環境でも開けない)。
 * 文字列のままでは、pdf-lib は字の番号の下位 8 ビットを書く (pdfByteString)
 */
function pdfFileSpec(file: string): PDFString | PDFHexString | Record<string, unknown> {
  if (/^[\x20-\x7e]*$/.test(file)) return pdfByteString(file);
  return { Type: 'Filespec', F: pdfByteString(file), UF: PDFHexString.fromText(file) };
}

/** URL のスキーム (RFC 3986 §3.1: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )) があるか */
export function hasUriScheme(u: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(u);
}

/**
 * 外へのリンクの動作。スキームのある URL と、ネットワークパスの参照 (//host/…) は URI 動作 (ISO 32000-1 §12.6.4.7)。
 * 相対参照 (RFC 3986 §4.2) は、PDF の場所からの相対のファイル (§7.11.2 の相対のファイル指定): PDF なら別の PDF へ飛ぶ動作 (GoToR。§12.6.4.3。
 * #page=N はそのページ、#名前 は名前付きの飛び先、無ければ 1 ページ目)、ほかのファイルは開く動作 (Launch。§12.6.4.5)。
 * links.relative が 'uri' のときは、相対参照も、書かれたままの URI 動作にする (%xx は解かない。URI は 7 ビットの ASCII。§12.6.4.7)。
 * 動作を書いてよいかは linkPolicy の judgeExternalLink が決める (既定では、http・https・mailto・tel の URL と相対の PDF だけ)。
 * 書かない飛び先は undefined を返し、dropped に数える。Area Tree をそのまま渡された (取り込みを通らない) 木も、ここで必ず判定する
 */
function externalAction(raw: string, policy: LinkPolicy | undefined, dropped: DroppedLinks): Record<string, unknown> | undefined {
  const j = judgeExternalLink(raw, policy);
  if (!j.allowed) {
    countDroppedLink(dropped, j);
    return undefined;
  }
  // 判定に使った文字列 (前後の空白・制御文字と、タブ・改行を取り除いたもの) を書く
  const u = j.url;
  if (j.kind === 'uri' || j.kind === 'relative-uri') return { S: 'URI', URI: pdfUri(u) };
  const hash = u.indexOf('#');
  const path = referencePath(u);
  const frag = hash < 0 ? '' : u.slice(hash + 1);
  // ファイルの指定 (§7.11.2): 区切りは /。( ) \ は逃がし、ASCII でない字のある名前は辞書にする (pdfFileSpec)
  const F = pdfFileSpec(decodePath(path));
  if (j.kind === 'gotor') {
    const page = /(?:^|&)page=(\d+)/.exec(frag);
    const D = page ? [Math.max(0, parseInt(page[1], 10) - 1), PDFName.of('Fit')] : frag && !/=/.test(frag) ? pdfByteString(frag) : [0, PDFName.of('Fit')];
    return { S: 'GoToR', F, D };
  }
  return { S: 'Launch', F };
}

/** 命令をページに足す。大量の命令を引数に展開すると JS のスタックを使い切るので、区切って渡す */
function pushOps(page: PDFPage, ops: PDFOperator[]) {
  for (let i = 0; i < ops.length; i += 2000) page.pushOperators(...ops.slice(i, i + 2000));
}

/**
 * トンボ用のレジストレーション色: 色材名 All の Separation (すべての版に出る。ISO 32000-2 §8.6.6.4 の NOTE 6)。
 * All のときは代わりの色空間と濃度の変換は使われないが、正しい値を入れておく (C=M=Y=K=100%)
 */
const REGISTRATION: SpotColor = { name: 'All', cmyk: [1, 1, 1, 1], tint: 1 };

/** 同じ行列で同じ基線に並ぶ字の並び (TJ にまとめる単位)。pen は並びの原点からの、次の字が自然に置かれる位置 (文字空間) */
/** 右から左に組む文字 (ヘブライ文字・アラビア文字・シリア文字など、提示形、補助面の右から左の文字) を含む文字列 */
const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** 描かない字 (Default_Ignorable_Code_Point) だけの文字列 */
const IGNORABLE_ONLY = /^\p{Default_Ignorable_Code_Point}+$/u;

interface TextSeg {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
  size: number;
  parts: string[];
  pen: number;
  /** 送りが分かっていて、後ろの字をつなげられるか */
  join: boolean;
  /**
   * ひと続きの字の並び (同じ親の領域に続けて置かれた字) ごとの区切り。at は parts の中の最初の字の位置、text は元の字の並び
   * (分からない字が混じれば undefined)、wide は字の間を WIDE_GAP より広げた所があるか
   */
  chains: Array<{ at: number; text?: string; wide?: boolean }>;
  /** 最後に足した字の親の領域の原点 (ページの座標) */
  ox: number;
  oy: number;
  /** 縦書きの書体 (WMode 1) の字の並び: 原点 (x, y) は最初の字の縦書きの原点、pen は字の進む向き (文字空間の y の負の向き) の位置 */
  v?: boolean;
}

/**
 * 字の間の空きが、字の大きさのこの割合以上なら「広げた字の並び」とみる (OUT-24)。PDF には空白の字が無くても、字を取り出す側は、字の間の
 * 広さから空白を推測する。空白と見なし始める空きを測ると (字の大きさに対する割合。Poppler 24.02 の pdftotext・PDFium 153・MuPDF 1.28)、
 * 欧文は PDFium が 0.10〜0.12、Poppler の -raw と MuPDF が 0.15、和文は Poppler の -raw が 0.15、PDFium が 0.17、Poppler の既定が 0.5
 * (MuPDF は 0.8 で別の行に分ける)。いちばん小さい 0.1 を境にする (ふつうの行の字の間は、これより狭い)
 */
const WIDE_GAP = 0.1;

/**
 * 縦書きの書体 (WMode 1 の Type 0 書体。ISO 32000-1 §9.7.4.3・§9.7.5): 横書きの書体と同じ CIDFont・ToUnicode を指し、Encoding だけが
 * Identity-V の辞書 (ref。中身は finishVerticalFonts が書く)。origins は、全角でない字の、縦書きの原点の横の位置 (CID → 1/1000 em。W2 に書く)
 */
interface VerticalFont {
  ref: PDFRef;
  origins: Map<number, number>;
}
/** 縦書きの原点の縦の位置と、縦の送り (1/1000 em)。DW2 の既定の値 (§9.7.4.3) */
const VERTICAL_ORIGIN_Y = 880;
const VERTICAL_ADVANCE = -1000;
/** 縦書きの字の並び (TJ) の中で、字を詰める向きの調整として書く上限 (1/1000 em)。これより詰める所は、Tm から書き直す */
const VERTICAL_MAX_TIGHTEN = 20;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
/** 数を、指数の表記にならない 10 進の文字列にする (PDF の数に指数の表記は無い。ISO 32000-1 §7.3.3) */
const decimal = (v: number) => (Math.abs(v) < 1e-6 ? v.toFixed(10).replace(/\.?0+$/, '') : String(v));

/**
 * 縦書きの書体の辞書を書く (書体が埋め込まれた後で呼ぶ): 横書きの Type 0 書体の辞書の写しで、Encoding を Identity-V にしたもの。
 * CIDFont には、縦書きの字の送りと原点 (DW2。全角でない字は W2) を足す
 */
function finishVerticalFonts(pdf: PDFDocument, fonts: Map<PDFFont, VerticalFont>) {
  const ctx = pdf.context;
  for (const [font, vf] of fonts) {
    const base = ctx.lookup(font.ref, PDFDict);
    const dict = ctx.obj({ Type: 'Font', Subtype: 'Type0' });
    for (const k of ['BaseFont', 'DescendantFonts', 'ToUnicode']) {
      const v = base.get(PDFName.of(k));
      if (v) dict.set(PDFName.of(k), v);
    }
    dict.set(PDFName.of('Encoding'), PDFName.of('Identity-V'));
    ctx.assign(vf.ref, dict);
    const cid = ctx.lookup(base.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict);
    cid.set(PDFName.of('DW2'), ctx.obj([VERTICAL_ORIGIN_Y, VERTICAL_ADVANCE]));
    // W2: 「c [w1y vx vy …]」(c から続く CID ごとに、縦の送り・原点の位置)
    const w2: Array<number | number[]> = [];
    let last = -2;
    for (const [c, vx] of [...vf.origins].sort((a, b) => a[0] - b[0])) {
      if (c === last + 1) (w2[w2.length - 1] as number[]).push(VERTICAL_ADVANCE, vx, VERTICAL_ORIGIN_Y);
      else w2.push(c, [VERTICAL_ADVANCE, vx, VERTICAL_ORIGIN_Y]);
      last = c;
    }
    if (w2.length) cid.set(PDFName.of('W2'), ctx.obj(w2));
  }
}

class PdfPainter implements Painter {
  private clips = 0;
  constructor(
    private page: PDFPage,
    private H: number,
    private fontOf: (g: GlyphArea) => PDFFont,
    private imageOf: (src: string) => PDFImage | undefined,
    private vectorOf: (src: string) => SvgDoc | undefined = () => undefined,
    private ctx?: PDFDocument,
    /** SVG の中の字の書体 (読み込んだ書体の鍵 → 埋め込んだ書体) */
    private svgFontOf: (key: string) => PDFFont | undefined = () => undefined,
    /** SVG の中の画像 (SvgShape.image) を埋め込んだもの (renderPdf が文書ごとに持つ) */
    private svgImages: ReadonlyMap<object, PDFImage> = new Map(),
  ) {
    this.spots = { page, names: new Map() };
  }
  /** RGB の色を CMYK にして書く (PDF/X の出力)。RGB → CMYK の変換 (ICC プロファイルの表か、rgbToCmyk) */
  set cmykOutput(v: CmykConverter | undefined) {
    this.spots.cmyk = v;
  }
  /** このページの特色 (Separation) の資源 */
  private spots: SpotPage;
  private gstates = new Map<string, PDFName>();

  /** 塗り・線の不透明度 (ExtGState)。1 のときは何もしない */
  /** 透明 (不透明度 < 1) を使ったか (PDF/X の確認用) */
  usedAlpha = false;
  private alphaOps(ca: number, CA: number, blend?: SvgShape['blend']): PDFOperator[] {
    if (!this.ctx || (ca >= 1 && CA >= 1 && !blend)) return [];
    this.usedAlpha = true;
    const key = `${ca.toFixed(3)}/${CA.toFixed(3)}/${blend ?? ''}`;
    let name = this.gstates.get(key);
    if (!name) {
      const ctx = this.ctx.context;
      // 描画モード (PDF 32000-1 11.3.5 の BM): Multiply・Screen・Difference
      const BM = blend ? { BM: blend === 'multiply' ? 'Multiply' : blend === 'screen' ? 'Screen' : 'Difference' } : {};
      name = this.page.node.newExtGState(`KmA${this.gstates.size}`, ctx.obj({ Type: 'ExtGState', ca, CA, ...BM }));
      this.gstates.set(key, name);
    }
    return [PDFOperator.of(Ops.SetGraphicsStateParams, [name])];
  }

  /** SVG のマスクの ExtGState (中身を描いた Form XObject の輝度のソフトマスク)。同じマスクは使い回す */
  private masks = new Map<SvgMask, PDFName>();
  private maskOps(mk: SvgMask, bbox: [number, number, number, number]): PDFOperator[] {
    if (!this.ctx) return [];
    let name = this.masks.get(mk);
    if (!name) {
      const ctx = this.ctx.context;
      // 中身はページの資源 (不透明度・模様) を使うので、Form XObject の資源はページと同じ辞書にする。
      // 中身はいまの座標 (SVG の座標) で描く。描かれていないところは黒 (輝度 0) なので隠れる
      const ops = mk.shapes.flatMap((sh) => this.shapeOps(sh, [1, 0, 0, 1, 0, 0], bbox));
      const form = ctx.register(
        ctx.contentStream(ops, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Group: { S: 'Transparency', CS: this.spots.cmyk ? 'DeviceCMYK' : 'DeviceRGB' }, Resources: this.page.node.Resources()! }),
      );
      this.usedAlpha = true;
      name = this.page.node.newExtGState(`KmM${this.masks.size}`, ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: form } }));
      this.masks.set(mk, name);
    }
    return [PDFOperator.of(Ops.SetGraphicsStateParams, [name])];
  }

  /** SVG の図形 1 つを描く命令 (q 〜 Q)。outer: SVG の座標 → 模様の座標 (ページ、マスクの中ではマスクの座標) */
  private shapeOps(sh: SvgShape, outer: Matrix, bbox: [number, number, number, number]): PDFOperator[] {
    // 拡大しない線 (vector-effect="non-scaling-stroke"): ページの上で CSS px の太さになるよう、SVG を置く拡大率で割る
    if (sh.nonScalingStroke || sh.nonScalingAnchor) {
      const k = Math.sqrt(Math.abs(outer[0] * outer[3] - outer[1] * outer[2])) || 1;
      const f = 0.75 / k;
      if (sh.nonScalingStroke) sh = { ...sh, nonScalingStroke: false, strokeWidth: sh.strokeWidth * f, ...(sh.dash ? { dash: sh.dash.map((x) => x * f) } : {}), ...(sh.dashOffset ? { dashOffset: sh.dashOffset * f } : {}) };
      // 拡大しない大きさ (vector-effect="non-scaling-size"): 原点の周りに縮める
      const a = sh.nonScalingAnchor;
      if (a) {
        const sc = (x: number, y: number) => ({ x: a[0] + (x - a[0]) * f, y: a[1] + (y - a[1]) * f });
        const segs = sh.segs.map((g) =>
          g.op === 'Z' ? g : g.op === 'C' ? { op: 'C' as const, ...sc(g.x, g.y), ...((p1, p2) => ({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }))(sc(g.x1, g.y1), sc(g.x2, g.y2)) } : { op: g.op, ...sc(g.x, g.y) },
        );
        sh = { ...sh, segs, nonScalingAnchor: undefined };
      }
    }
    const N = (n: number) => PDFNumber.of(n);
    const op = (o: Ops, ...args: number[]) => PDFOperator.of(o, args.map(N));
    if (sh.image) {
      // 画像 (前もって埋め込んだもの): 切り抜き・マスク・不透明度のあとで、単位正方形を画像の位置に写して描く
      const img = this.svgImages.get(sh.image);
      if (!img) return [];
      const out: PDFOperator[] = [pushGraphicsState()];
      for (const c of sh.clips ?? []) (pushAll(out, segOps(c.segs)), out.push(PDFOperator.of(c.evenOdd ? Ops.ClipEvenOdd : Ops.ClipNonZero), PDFOperator.of(Ops.EndPath)));
      for (const mk of sh.masks ?? []) out.push(...this.maskOps(mk, bbox));
      out.push(...this.alphaOps(sh.fillOpacity, 1, sh.blend));
      out.push(concatTransformationMatrix(...sh.image.matrix), PDFOperator.of(Ops.DrawObject, [this.imageName(img)]), popGraphicsState());
      return out;
    }
    const fill0 = sh.fill !== undefined || !!sh.fillPaint;
    const stroke0 = sh.stroke !== undefined && sh.strokeWidth > 0;
    const fillAlpha = fill0 && !!sh.fillPaint?.stops.some((s) => s.opacity !== undefined);
    const strokeAlpha = stroke0 && !!sh.strokePaint?.stops.some((s) => s.opacity !== undefined);
    // 透明度のあるグラデーションのマスクが、塗りと線の片方だけに掛かるように、分けて描く
    if ((fillAlpha || strokeAlpha) && fill0 && stroke0)
      return [
        ...this.shapeOps({ ...sh, stroke: undefined, strokePaint: undefined }, outer, bbox),
        ...this.shapeOps({ ...sh, fill: undefined, fillPaint: undefined, fillPattern: undefined }, outer, bbox),
      ];
    const out: PDFOperator[] = [pushGraphicsState()];
    // 切り抜き (clipPath): 形を作って W n
    for (const c of sh.clips ?? []) (pushAll(out, segOps(c.segs)), out.push(PDFOperator.of(c.evenOdd ? Ops.ClipEvenOdd : Ops.ClipNonZero), PDFOperator.of(Ops.EndPath)));
    // マスク: ExtGState のソフトマスク (外側のマスクから。重ねると後のものに置き換わるので、内側のマスクだけが効く近似)
    for (const mk of sh.masks ?? []) out.push(...this.maskOps(mk, bbox));
    out.push(...this.alphaOps(sh.fillOpacity, sh.strokeOpacity, sh.blend));
    if (fillAlpha) out.push(...this.gradientAlphaOps(sh.fillPaint!, bbox));
    else if (strokeAlpha) out.push(...this.gradientAlphaOps(sh.strokePaint!, bbox));
    const fill = sh.fill !== undefined || !!sh.fillPaint;
    const stroke = sh.stroke !== undefined && sh.strokeWidth > 0;
    if (sh.fillPattern) out.push(...this.patternFill(sh.fillPattern, outer));
    else if (sh.fillPaint) out.push(...this.gradientFill(sh.fillPaint, outer));
    else if (fill) out.push(...colorOps(sh.fill!, true, this.spots));
    if (stroke) {
      out.push(
        ...(sh.strokePaint ? this.gradientFill(sh.strokePaint, outer, true) : colorOps(sh.stroke!, false, this.spots)),
        op(Ops.SetLineWidth, sh.strokeWidth),
        op(Ops.SetLineCapStyle, sh.lineCap),
        op(Ops.SetLineJoinStyle, sh.lineJoin),
      );
      // 尖ったつなぎの上限: SVG の既定は 4、PDF の既定は 10 なので、つなぎが miter なら書く
      if (sh.lineJoin === 0) out.push(op(Ops.SetLineMiterLimit, sh.miterLimit ?? 4));
      if (sh.dash?.length) out.push(setDashPattern(sh.dash, sh.dashOffset ?? 0));
    }
    // 単色の塗りだけの字は、書体の文字として描く (字の座標は y 下向きなので、文字の行列で上下を返す)
    const textOps = fill && !stroke && !sh.fillPaint && !sh.fillPattern && sh.text ? this.svgTextOps(sh.text) : undefined;
    if (textOps) {
      out.push(...textOps, popGraphicsState());
      return out;
    }
    pushAll(out, segOps(sh.segs));
    const paint = fill && stroke ? (sh.evenOdd ? Ops.FillEvenOddAndStroke : Ops.FillNonZeroAndStroke) : fill ? (sh.evenOdd ? Ops.FillEvenOdd : Ops.FillNonZero) : stroke ? Ops.StrokePath : Ops.EndPath;
    out.push(PDFOperator.of(paint), popGraphicsState());
    return out;
  }

  /** SVG の字を、埋め込んだ書体の文字として描く命令 (塗りの色は設定済み)。書体が無い・字を符号にできなければ undefined */
  private svgTextOps(t: NonNullable<SvgShape['text']>): PDFOperator[] | undefined {
    const parts: Array<{ name: PDFName; hex: PDFHexString; x: number }> = [];
    for (const c of t.chars) {
      const font = this.svgFontOf(c.font);
      if (!font) return undefined;
      let hex: PDFHexString;
      try {
        hex = font.encodeText(c.ch);
      } catch {
        return undefined;
      }
      let name = this.fontKeys.get(font);
      if (!name) {
        name = this.page.node.newFontDictionary(font.name, font.ref);
        this.fontKeys.set(font, name);
      }
      parts.push({ name, hex, x: c.x });
    }
    const [a, b, c, d, e, f] = t.matrix;
    const ops: PDFOperator[] = [beginText()];
    let cur: PDFName | undefined;
    for (const p of parts) {
      if (p.name !== cur) {
        ops.push(setFontAndSize(p.name, t.size));
        cur = p.name;
      }
      // 字の原点 (x, 0) を SVG のルートの座標へ写し、y を返す: [a, b, -c, -d, a·x + e, b·x + f]
      ops.push(PDFOperator.of(Ops.SetTextMatrix, [num(a), num(b), num(-c), num(-d), num(a * p.x + e), num(b * p.x + f)] as never), showText(p.hex));
    }
    ops.push(endText());
    return ops;
  }

  /** SVG をベクタ命令として描く。viewBox → 領域は preserveAspectRatio どおり (既定 xMidYMid meet。Canvas の drawImage も同じにそろえてある) */
  private drawVector(v: SvgDoc, a: ImageArea, x: number, y: number) {
    const ax = x;
    const ay = y;
    const [vx, vy, vw, vh] = v.viewBox;
    let sx = a.width / vw;
    let sy = a.height / vh;
    // preserveAspectRatio: 縦横比を保って (meet は収める、slice は覆って切り抜く) 揃える。none は引き伸ばす
    const align = a.stretch ? 'none' : (v.aspect?.align ?? 'xMidYMid');
    if (align !== 'none' && Math.abs(sx - sy) > 1e-9) {
      const s = v.aspect?.slice ? Math.max(sx, sy) : Math.min(sx, sy);
      const fx = /xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0;
      const fy = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
      x += (a.width - vw * s) * fx;
      y += (a.height - vh * s) * fy;
      sx = sy = s;
    }
    const svgCm: Matrix = [sx, 0, 0, -sy, x - sx * vx, this.H - y + sy * vy];
    const ops: PDFOperator[] = [pushGraphicsState()];
    // 画像の領域 (根の svg の viewport) からはみ出す分は切り抜く。SVG 1.1 §14.3.3: ファイルの SVG は根の overflow を無視して
    // viewport で切り抜く。XSL の中の SVG (instream-foreign-object) は XSL の overflow (既定 auto: 処理系に任せる) に従い、切り抜く
    // (アンテナハウス互換で根の overflow が visible なら切り抜かない。SvgDoc.noClip)
    if (!v.noClip) ops.push(...rectClipOps(ax, this.H - ay - a.height, a.width, a.height));
    ops.push(concatTransformationMatrix(...svgCm));
    pushOps(this.page, ops);
    // マスクの Form XObject の範囲 (SVG の座標): viewBox の周りを広めに
    const bbox: [number, number, number, number] = [vx - vw * 10, vy - vh * 10, vx + vw * 11, vy + vh * 11];
    const outer = mul(this.patternCtm, svgCm);
    for (const sh of v.shapes) pushOps(this.page, this.shapeOps(sh, outer, bbox));
    this.page.pushOperators(popGraphicsState());
  }

  /**
   * 局所 → Sheet (y 下向き) の変換 M を、PDF (y 上向き) の変換 G = F∘M∘F⁻¹ (F: y → H − y) に直して cm で適用する。
   * 以降の描画は Sheet 座標のまま (y → H − y を内部で行う) 書けるので、他のメソッドは変更不要。
   *   G = [a, −b, −c, d, c·H + e, H − d·H − f]
   */
  transform(m: Matrix, draw: () => void) {
    const [a, b, c, d, e, f] = m;
    const H = this.H;
    const G: Matrix = [a, -b, -c, d, c * H + e, H - d * H - f];
    this.flushText();
    this.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...G));
    const saved = this.ctm;
    this.ctm = mul(this.ctm, G);
    draw();
    this.flushText();
    this.ctm = saved;
    this.page.pushOperators(popGraphicsState());
  }

  /**
   * 不透明度の付いた箱 (CSS の opacity。Color 4 §3.3): 中身を、透明のグループ (Group の S が Transparency) の Form XObject に描き、
   * 塗り・線の不透明度 (ExtGState の ca・CA) を掛けて 1 度に置く (ISO 32000-1 §11.4.5・§11.6.6)。グループの中の重なりは、
   * グループの中で不透明に重ねてから全体に不透明度が掛かるので、濃くならない。
   * 中身はいまの座標のまま描く (Form の行列は単位行列)。資源 (書体・画像・ExtGState・模様) はページと同じ辞書を使う
   */
  group(opacity: number, draw: () => void) {
    if (!this.ctx) return draw();
    this.flushText();
    const ops = pageOperators(this.page);
    const start = ops.length;
    // 模様の行列は、Form の中では Form の座標から (ISO 32000-1 §8.7.3.1): いまの変換を、Form の始まりの変換からの分にする
    const savedBase = this.formBase;
    this.formBase = this.ctm;
    try {
      draw();
      this.flushText();
    } finally {
      this.formBase = savedBase;
    }
    const body = ops.splice(start);
    if (!body.length) return;
    const ctx = this.ctx.context;
    // Form の範囲 (BBox): ページの全体を、いまの座標で表した外接矩形 (中身はページの外には描かれない)
    const inv = invert(this.ctm);
    const W = this.page.getWidth();
    const pts = inv ? [apply(inv, 0, 0), apply(inv, W, 0), apply(inv, 0, this.H), apply(inv, W, this.H)] : [[0, 0], [W, this.H]];
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const form = ctx.register(
      ctx.contentStream(body, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        Group: { S: 'Transparency', CS: this.spots.cmyk ? 'DeviceCMYK' : 'DeviceRGB' },
        Resources: this.sharedResources(),
      }),
    );
    const name = this.page.node.newXObject('KmG', form);
    this.page.pushOperators(pushGraphicsState(), ...this.alphaOps(opacity, opacity), PDFOperator.of(Ops.DrawObject, [name]), popGraphicsState());
  }
  /**
   * ページの資源の辞書を、間接オブジェクトにして返す (ページと、不透明度のグループの Form XObject が同じ辞書を参照する。
   * グループの数だけ辞書の写しを書かない)
   */
  private sharedResources(): PDFRef {
    const node = this.page.node;
    node.normalize();
    const cur = node.get(PDFName.of('Resources'));
    if (cur instanceof PDFRef) return cur;
    const ref = this.ctx!.context.register(node.Resources()!);
    node.set(PDFName.of('Resources'), ref);
    return ref;
  }
  /** いま描いている Form XObject (group) の始まりの変換 (ページの既定の座標へ)。ページにじかに描いているときは undefined */
  private formBase?: Matrix;
  /** 模様 (pattern) の行列の基準へのいまの変換: ページにじかに描くときは ctm、Form の中では Form の座標への変換 */
  private get patternCtm(): Matrix {
    const inv = this.formBase && invert(this.formBase);
    return inv ? mul(inv, this.ctm) : this.ctm;
  }

  /** Sheet 座標 (y 下向き) の輪郭を、PDF の座標 (y → H − y) の経路の命令にする */
  private pathOps(path: PathSeg[]): PDFOperator[] {
    return segOps(path, this.H);
  }
  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity = 1) {
    this.flushText();
    this.page.pushOperators(pushGraphicsState(), ...this.alphaOps(opacity, 1), ...colorOps(color, true, this.spots), ...this.pathOps(path), PDFOperator.of(evenOdd ? Ops.FillEvenOdd : Ops.FillNonZero), popGraphicsState());
  }
  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]) {
    this.flushText();
    this.page.pushOperators(
      pushGraphicsState(),
      ...colorOps(color, false, this.spots),
      PDFOperator.of(Ops.SetLineWidth, [PDFNumber.of(width)]),
      ...(dash ? [setDashPattern(dash, 0)] : []),
      ...this.pathOps(path),
      PDFOperator.of(Ops.StrokePath),
      popGraphicsState(),
    );
  }

  /** リンク・注釈 (PDF 座標の矩形 [x1, y1, x2, y2])。全ページを作った後で注釈の辞書にする */
  marks: Array<{ rect: number[]; popup?: number[]; link?: LinkTarget; annot?: Annotation; form?: FormField }> = [];

  /** Sheet 座標の矩形を、いまの変換を掛けた PDF 座標の外接矩形にする */
  private pdfRect(x: number, y: number, w: number, h: number): number[] {
    const m = this.ctm;
    const pts = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(([px, py]) => {
      const qy = this.H - py;
      return [m[0] * px + m[2] * qy + m[4], m[1] * px + m[3] * qy + m[5]];
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  mark(a: Area, x: number, y: number) {
    if (a.link) this.marks.push({ rect: this.pdfRect(x, y, a.width, a.height), link: a.link });
    if (a.formField) {
      // 欄は罫線の内側 (罫線は Kumiori が描く)
      const bl = a.border.left?.width ?? 0;
      const bt = a.border.top?.width ?? 0;
      const w = a.width - bl - (a.border.right?.width ?? 0);
      const h = a.height - bt - (a.border.bottom?.width ?? 0);
      this.marks.push({ rect: this.pdfRect(x + bl, y + bt, w, h), form: a.formField });
    }
    const an = a.annotation;
    if (an) {
      const ax = x + (an.dx ?? 0);
      const ay = y + (an.dy ?? 0);
      const w = an.width ?? 100;
      const h = an.height ?? 60;
      if (an.kind === 'text' || an.kind === 'file-attachment') {
        // アイコンは 20pt 角、開いたときの窓は width × height
        this.marks.push({ rect: this.pdfRect(ax, ay, 20, 20), popup: this.pdfRect(ax, ay, w, h), annot: an });
      } else this.marks.push({ rect: this.pdfRect(ax, ay, w, h), annot: an });
    }
  }

  /** いまの座標変換 (ページの既定の座標へ)。グラデーションの pattern は CTM の影響を受けないので、自分で掛ける */
  private ctm: Matrix = [1, 0, 0, 1, 0, 0];
  private patterns = 0;

  /** SVG のグラデーション → PDF の shading pattern (axial / radial)。塗り色に設定する命令を返す */
  /** 模様 (pattern) をタイリングパターンにして、塗りの色にする */
  private patternFill(pt: SvgPattern, outer: Matrix): PDFOperator[] {
    if (!this.ctx) return colorOps('#808080', true, this.spots);
    const ctx = this.ctx.context;
    const N = (n: number) => PDFNumber.of(n);
    const ops: PDFOperator[] = [];
    for (const sh of pt.shapes) {
      const fill = sh.fill !== undefined;
      const stroke = sh.stroke !== undefined && sh.strokeWidth > 0;
      if (fill) ops.push(...colorOps(sh.fill!, true, this.spots));
      if (stroke) {
        ops.push(...colorOps(sh.stroke!, false, this.spots), PDFOperator.of(Ops.SetLineWidth, [N(sh.strokeWidth)]), PDFOperator.of(Ops.SetLineCapStyle, [N(sh.lineCap)]), PDFOperator.of(Ops.SetLineJoinStyle, [N(sh.lineJoin)]));
        if (sh.lineJoin === 0) ops.push(PDFOperator.of(Ops.SetLineMiterLimit, [N(sh.miterLimit ?? 4)]));
        ops.push(setDashPattern(sh.dash ?? [], sh.dash ? (sh.dashOffset ?? 0) : 0));
      }
      pushAll(ops, segOps(sh.segs));
      ops.push(PDFOperator.of(fill && stroke ? (sh.evenOdd ? Ops.FillEvenOddAndStroke : Ops.FillNonZeroAndStroke) : fill ? (sh.evenOdd ? Ops.FillEvenOdd : Ops.FillNonZero) : stroke ? Ops.StrokePath : Ops.EndPath));
    }
    // タイルの中身は SVG のルート座標ではなくタイルの座標で描いてあるので、タイル → ルートの変換を前に掛ける。
    // 資源: 特色 (spot(...)) の色空間の名前はページの資源を指すので、パターンの資源にも同じ ColorSpace の辞書を置く
    // (パターンの内容ストリームの中では、ページの資源は解けない。ISO 32000-2 §7.8.3)
    const stream = ctx.contentStream(ops, {
      Type: 'Pattern',
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, 0, pt.width, pt.height],
      XStep: pt.width,
      YStep: pt.height,
      Matrix: mul(outer, pt.matrix),
      Resources: this.spots.names.size ? { ColorSpace: spotColorSpaceDict(this.spots) } : {},
    });
    const ref = ctx.register(stream);
    const name = this.addPattern(ref);
    return [PDFOperator.of(Ops.NonStrokingColorspace, [PDFName.of('Pattern')]), PDFOperator.of(Ops.NonStrokingColorN, [name])];
  }

  /** ページの /Pattern に登録して名前を返す */
  private addPattern(ref: PDFRef): PDFName {
    const ctx = this.ctx!.context;
    const res = this.page.node.Resources()!;
    let dict = res.lookupMaybe(PDFName.of('Pattern'), PDFDict);
    if (!dict) {
      dict = ctx.obj({});
      res.set(PDFName.of('Pattern'), dict);
    }
    const name = PDFName.of(`KmP${this.patterns++}`);
    dict.set(name, ref);
    return name;
  }

  private gradientFill(g: SvgGradient, outer: Matrix, stroke = false): PDFOperator[] {
    if (!this.ctx) return colorOps(g.stops[g.stops.length - 1].color, !stroke);
    const ctx = this.ctx.context;
    const rgb = (css: string) => {
      const c = parseColor(css);
      if (c.mode === 'rgb') return [c.r, c.g, c.b];
      return [(1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k)];
    };
    // PDF/X: グラデーションも CMYK で (CMYK で指定した止まり点はそのまま)
    const toCmyk = (css: string) => {
      const c = parseColor(css);
      return c.mode === 'rgb' ? (c.r === c.g && c.g === c.b ? [0, 0, 0, 1 - c.r] : this.spots.cmyk!(c.r, c.g, c.b)) : [c.c, c.m, c.y, c.k];
    };
    const shading = this.spots.cmyk ? this.shading(g, 'DeviceCMYK', (s) => toCmyk(s.color)) : this.shading(g, 'DeviceRGB', (s) => rgb(s.color));
    const pattern = ctx.register(ctx.obj({ PatternType: 2, Shading: shading, Matrix: mul(outer, g.matrix) }));
    const name = this.addPattern(pattern);
    return stroke
      ? [PDFOperator.of(Ops.StrokingColorspace, [PDFName.of('Pattern')]), PDFOperator.of(Ops.StrokingColorN, [name])]
      : [PDFOperator.of(Ops.NonStrokingColorspace, [PDFName.of('Pattern')]), PDFOperator.of(Ops.NonStrokingColorN, [name])];
  }

  /** グラデーションのシェーディング (止まり点の値は value で。0 と 1 の端まで伸ばす) */
  private shading(g: SvgGradient, colorSpace: string, value: (s: SvgGradient['stops'][number]) => number[]) {
    const ctx = this.ctx!.context;
    const stops = [...g.stops];
    // Bounds は「増加の順」(ISO 32000-1 §7.10.4) なので、同じ offset の止まり点 (SVG の色の段差) は後ろをわずかに進める
    // (段差は長さ 0 に近い区間として残る)。1 を超えるなら、前の止まり点を後ろの色で置き換えて 1 つにする
    for (let k = 1; k < stops.length; k++) {
      if (stops[k].offset > stops[k - 1].offset) continue;
      const next = stops[k - 1].offset + 1e-5;
      if (next <= 1) stops[k] = { ...stops[k], offset: next };
      else stops.splice(--k, 1);
    }
    if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 });
    if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 });
    const seg = (a: SvgGradient['stops'][number], b: SvgGradient['stops'][number]) => ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: value(a), C1: value(b), N: 1 });
    const fn =
      stops.length === 2
        ? seg(stops[0], stops[1])
        : ctx.obj({
            FunctionType: 3,
            Domain: [0, 1],
            Functions: stops.slice(1).map((s, k) => seg(stops[k], s)),
            Bounds: stops.slice(1, -1).map((s) => s.offset),
            Encode: stops.slice(1).flatMap(() => [0, 1]),
          });
    return ctx.obj({ ShadingType: g.kind === 'linear' ? 2 : 3, ColorSpace: colorSpace, Coords: g.coords, Function: fn, Extend: [true, true] });
  }

  /**
   * グラデーションの止まり点の不透明度 (stop-opacity): 不透明度をグレーにした同じグラデーションを Form XObject に描き、
   * 輝度のソフトマスク (ExtGState の SMask) にする。Form XObject はいまの座標 (SVG の座標) で描く
   */
  private gradientAlphaOps(g: SvgGradient, bbox: [number, number, number, number]): PDFOperator[] {
    if (!this.ctx) return [];
    const ctx = this.ctx.context;
    const sh = this.shading(g, 'DeviceGray', (s) => [s.opacity ?? 1]);
    const form = ctx.register(
      ctx.contentStream([pushGraphicsState(), concatTransformationMatrix(...g.matrix), PDFOperator.of(Ops.ShadingFill, [PDFName.of('KmS')]), popGraphicsState()], {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: bbox,
        Group: { S: 'Transparency', CS: 'DeviceGray' },
        Resources: { Shading: { KmS: sh } },
      }),
    );
    this.usedAlpha = true;
    const name = this.page.node.newExtGState(`KmG${this.gradientMasks++}`, ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: form } }));
    return [PDFOperator.of(Ops.SetGraphicsStateParams, [name])];
  }
  private gradientMasks = 0;

  /** ページの資源の画像 (XObject) の名前 (画像ごとに 1 つ。pdf-lib の page.drawImage は描くたびに新しい名前を登録するので使わない) */
  private imageKeys = new Map<PDFImage, PDFName>();
  private imageName(img: PDFImage): PDFName {
    let name = this.imageKeys.get(img);
    if (!name) {
      name = this.page.node.newXObject('KmI', img.ref);
      this.imageKeys.set(img, name);
    }
    return name;
  }

  drawImage(a: ImageArea, x: number, y: number) {
    this.flushText();
    const vec = this.vectorOf(a.src);
    if (vec) return this.drawVector(vec, a, x, y);
    const img = this.imageOf(a.src);
    // 単位正方形の画像を (幅, 高さ) に伸ばして左下 (x, H − y − 高さ) に置く: q w 0 0 h x y cm /KmI Do Q
    if (img) this.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a.width, 0, 0, a.height, x, this.H - y - a.height), PDFOperator.of(Ops.DrawObject, [this.imageName(img)]), popGraphicsState());
  }

  /**
   * 背景画像の繰り返し: 1 枚の画像を描くタイリングパターン (PatternType 1、XStep・YStep = タイルの大きさ) を作り、
   * 範囲 region をそのパターンで塗る。タイルの数だけ Do と資源名を出さない (1×1px の背景でも命令は数個)。
   * ベクタ (SVG) の画像は扱わない (false を返し、呼び手が 1 枚ずつ描く)
   */
  drawImageTiled(a: ImageArea, x: number, y: number, region: Rect): boolean {
    if (!this.ctx || this.vectorOf(a.src)) return false;
    this.flushText();
    const img = this.imageOf(a.src);
    if (!img) return true;
    const ctx = this.ctx.context;
    // パターンの行列はページの既定の座標からなので (ISO 32000-2 §8.7.3.1)、いまの変換 (transform の cm) を前に掛ける
    const stream = ctx.contentStream([concatTransformationMatrix(a.width, 0, 0, a.height, 0, 0), PDFOperator.of(Ops.DrawObject, [PDFName.of('KmI')])], {
      Type: 'Pattern',
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, 0, a.width, a.height],
      XStep: a.width,
      YStep: a.height,
      Matrix: mul(this.patternCtm, [1, 0, 0, 1, x, this.H - y - a.height]),
      Resources: { XObject: { KmI: img.ref } },
    });
    const name = this.addPattern(ctx.register(stream));
    const N = (v: number) => PDFNumber.of(v);
    this.page.pushOperators(
      pushGraphicsState(),
      PDFOperator.of(Ops.NonStrokingColorspace, [PDFName.of('Pattern')]),
      PDFOperator.of(Ops.NonStrokingColorN, [name]),
      PDFOperator.of(Ops.AppendRectangle, [N(region.x), N(this.H - region.y - region.height), N(region.width), N(region.height)]),
      PDFOperator.of(Ops.FillNonZero),
      popGraphicsState(),
    );
    return true;
  }

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.flushText();
    if (/^spot\(/i.test(color)) {
      this.page.pushOperators(pushGraphicsState(), ...colorOps(color, true, this.spots), PDFOperator.of(Ops.AppendRectangle, [PDFNumber.of(x), PDFNumber.of(this.H - y - h), PDFNumber.of(w), PDFNumber.of(h)]), PDFOperator.of(Ops.FillNonZero), popGraphicsState());
      return;
    }
    this.page.drawRectangle({ x, y: this.H - y - h, width: w, height: h, color: toPdfColor(color, this.spots.cmyk), borderWidth: 0 });
  }

  /**
   * 続けて描く字をためておき、同じ書体・大きさ・色・描き方の字を 1 つのテキストの区切り (BT…ET) にまとめて書く。
   * 字ごとの位置と向きは、テキストの行列 (Tm) で与える (これまでの cm と同じ行列)。字以外を描く前には書き出す
   */
  private run?: { key: string; font: PDFFont; size: number; color: Color; css: string; fakeBold: boolean; ops: PDFOperator[]; seg?: TextSeg; vertical?: VerticalFont };
  /** ページの資源の書体の名前 (書体ごとに 1 つ) */
  private fontKeys = new Map<PDFFont, PDFName>();
  /** ページの資源の、縦書きの書体 (WMode 1 の Type 0 書体) の名前 */
  private verticalFontKeys = new Map<PDFFont, PDFName>();
  /** 文書の、縦書きの書体 (renderPdf が文書ごとに持つ)。無ければ、縦書きの字も横書きの書体で 1 字ずつ置く */
  verticalFonts?: Map<PDFFont, VerticalFont>;

  /** 色つきの字形を持つ書体の字の描き手 (colorGlyphPdf.ts)。色つきの書体を使わない文書では undefined */
  colorGlyphs?: PdfColorGlyphs;

  drawGlyph(g: GlyphArea, x: number, y: number) {
    // 色つきの表 (COLR・CBDT・sbix・SVG) を持つ書体の字は、Type 3 書体の字として描く
    const colored = this.colorGlyphs?.draw(g, x, y, this.page, this.H, (css) => colorOps(css, true, this.spots));
    if (colored) {
      this.flushText();
      pushOps(this.page, colored);
      return;
    }
    const font = this.fontOf(g);
    // 改行しない空白 (U+00A0) は、通常の空白の字形で描く (Arimo の U+00A0 の字形は、fontkit が読めない壊れたデータ)
    const text = g.text.replace(/\u00A0/g, ' ');
    // 字形の並びが、字の並びと 1 対 1 に対応しない字の単位 (書体が並べ替え・合成・分解をしたもの: デーヴァナーガリーの前に置く母音記号・
    // 結合子音、タイ文字の SARA AM など) は、字形ごとの ToUnicode では元の字に戻せないので、/ActualText で元の字の並びを付ける
    // インド系の用字・タイ文字の字の単位は、字形が並べ替えられることがあり、1 対 1 に対応していても付ける (基底の字の送りの中へ戻して置く
    // 記号を、字を取り出す側が別の語と見て、空白を挟んだり順を入れ替えたりするのを防ぐ)。ほかの用字の字の単位は、字と字形の数が違うときだけ付ける
    // (数が同じなら、字形 i は字 i を置き換えたもの (縦書き用の字形など) として、これまでどおり字形ごとの ToUnicode にする)
    // 右から左の文字 (アラビア文字・ヘブライ文字など) の 2 つ以上の字形の並びにも、いつも付ける: 字形は描く順 (左から右。字の順の逆) に並び、
    // 字と字形が同じ数でも対応しない (アラビア文字の語、ヘブライ文字の字 + 母音記号)
    const rtl = RTL_TEXT.test(text);
    const own = g.glyphIds && g.glyphIds.length > 1 ? (rtl ? rtlGlyphChars(font, g.glyphIds, text, g.features) : reorderedGlyphChars(font, g.glyphIds, text, /^[\u0900-\u0E7F]/.test(text) || ACTUAL_TEXT_SEA.test(text))) : undefined;
    // ActualText に書く字の並びは、どの用字でも読む順 (論理の順。text のまま)。ISO 32000-2 §14.9.4 (Replacement text。ISO 32000-1 でも同じ節):
    // ActualText は、見る人が見るものと等しい文字による、内容の置き換え (character substitution)。描く順 (左から右) に並べた字形の並びではなく、
    // 文字列としての置き換えなので、読む順で書く (描く順の文字列だと知らせるには、別の仕組み §14.8.2.5.3 ReversedChars がある)。
    // 読む側の違い (2026-11-11 に測ったもの): PDFium (Chrome・Edge のビューア) は ActualText の字をそのまま返すので、読む順なら正しい語に
    // なる。poppler の pdftotext と MuPDF は、ActualText の字にも右から左の並べ替えを掛けるので、読む順で書くと語が逆順になる (描く順で書いた
    // これまでは、その逆で PDFium が逆順だった)。規格に合わせ、利用者の多いビューアで正しく読める読む順にする。
    // ActualText を読まない取り出し方 (pdfminer.six) は、どちらでも字形ごとの ToUnicode を描く順で返す
    const actual = text;
    let hex: PDFHexString;
    try {
      // 木に字形の番号があれば、それを書く (組版で測った字形と同じ)。無ければ、字を書体で組み直す
      hex = own ? (font as FeatureFont).encodeGlyphs(g.glyphIds!, '') : g.glyphIds?.length ? (font as FeatureFont).encodeGlyphs(g.glyphIds, text) : (font as FeatureFont).encodeText(text, g.features);
    } catch (e) {
      // 字形のデータが壊れている書体 (fontkit が読めない字) は、その字を描かずに続ける (PDF の書き出し全体を止めない)
      console.warn(`PDF: ${g.fontFamily} の「${g.text}」(U+${(g.text.codePointAt(0) ?? 0).toString(16)}) を描けません`, e);
      return;
    }
    const fakeBold = !!g.fakeBold;
    const pos = g.glyphPositions;
    const placedEach = (pos && g.glyphIds && pos.length === g.glyphIds.length) || !!own;
    // 縦書きの行の正立の字 (1 つの字形) は、縦書きの書体 (WMode 1。ISO 32000-1 §9.7.4.3・§9.7.5) の字として書く
    const vertical = this.verticalFor(g, font, hex, rtl || placedEach);
    // 縦書きの書体の字は、OpenType の機能 (vert など。字形の番号を決めるだけ) が違っても同じ並びに続ける: 縦書きの行は、縦書き用の字形に
    // 替わる字 (かな・約物) と替わらない字 (漢字) が交じるので、分けると 1 行が細切れになる
    const key = `${g.fontFamily}|${g.fontWeight}|${vertical ? 'V' : (g.features ?? []).join(',')}|${g.fontSize}|${g.color}|${fakeBold}`;
    if (this.run && this.run.key !== key) this.flushText();
    if (!this.run) this.run = { key, font, size: g.fontSize, color: toPdfColor(g.color, this.spots.cmyk), css: g.color, fakeBold, ops: [], vertical };
    const phi = (-g.rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const m = [g.scaleX * cos, g.scaleX * sin, (g.italic ? g.scaleX * cos * ITALIC_SLANT : 0) - sin, (g.italic ? g.scaleX * sin * ITALIC_SLANT : 0) + cos, x + g.baselineX, this.H - (y + g.baselineY)];
    const r = this.run;
    if (placedEach) {
      // GPOS の位置: 字形ごとに、送りの合計とずらし (書体の単位) の位置に置く。字 (text) は最初の字形の ToUnicode に使う
      const fk = (font as unknown as { embedder: { font: { unitsPerEm: number; getGlyph(id: number): { advanceWidth: number } } } }).embedder.font;
      const k = g.fontSize / fk.unitsPerEm;
      // ToUnicode の字: 字と字形が同じ数なら字形ごとに 1 字、違えば最初の字形に全部 (encodeGlyphs と同じ)。
      // ActualText を付けた単位は、書体の cmap でその字形になる字だけ (own)
      const chars = [...text];
      const textOf = (i: number) => (own ? own[i] : chars.length === g.glyphIds!.length ? chars[i] : i === 0 ? text : '');
      let pen = 0;
      const placed = g.glyphIds!.map((id, i) => {
        const [adv, dx, dy] = pos && pos.length === g.glyphIds!.length ? pos[i] : [fk.getGlyph(id).advanceWidth, 0, 0];
        const at = { id, i, adv, u: pen + dx, v: dy };
        pen += adv;
        return at;
      });
      const put = (list: typeof placed) => {
        // ActualText を付ける単位 (own) の字は、広げた字の並びの ActualText (flushSeg) に入れない (ActualText は入れ子にできない)
        for (const at of list) this.placeGlyph(m, g.fontSize, (font as FeatureFont).encodeGlyphs([at.id], textOf(at.i)), at.u * k, at.v * k, x - g.x, y - g.y, own ? undefined : textOf(at.i));
      };
      if (own) {
        // 置き換えの文字列 (ISO 32000-1 §14.9.4 Replacement Text): 印の付いた内容 (/Span) の ActualText に、元の字の並びを UTF-16BE で書く。
        // 印の付いた内容はテキストの区切り (BT…ET) の中に置ける (§14.6.1)。前の字の並び (TJ) は、ここで切る。
        // 送りのある字形 (基底の字など) に元の字の並びの全体を付け、送りの無い字形 (基底の字の送りの中へ戻して置く記号) には空の文字列を付ける:
        // 字を取り出す側 (poppler など) は、単位の幅を「最初の字形の始まり〜最後に書いた字形の終わり」と見るので、記号を同じ印の中に書くと、
        // 前後の字との間が空いて見え、空白を挟んでしまう。字形は位置を決めて置くので、書く順で見た目は変わらない
        const span = (list: typeof placed, actual: string) => {
          if (!list.length) return;
          this.flushSeg(r);
          r.ops.push(PDFOperator.of('BDC' as never, ['/Span', `<</ActualText <${utf16Hex(actual)}>>>`] as never));
          put(list);
          this.flushSeg(r);
          r.ops.push(PDFOperator.of('EMC' as never));
        };
        const spacing = placed.filter((p) => p.adv > 0);
        if (spacing.length) {
          span(spacing, actual);
          span(placed.filter((p) => !(p.adv > 0)), '');
        } else span(placed, actual);
      } else put(placed);
      return;
    }
    // 右から左の文字の、1 つの字形: 字形に登録された字 (ToUnicode。書体の字形ごとに 1 つ。最初に使ったときの字) と違う字のとき
    // (同じ字形を別の字に使う書体: ی の単独形と ى など) と、2 字以上を 1 つの字形で表すとき (ヘブライ文字の合字など) は、ActualText で字を与える
    if (rtl && g.glyphIds?.length === 1) {
      const multi = text.length > (text.codePointAt(0)! > 0xffff ? 2 : 1);
      if (multi || (font as FeatureFont).glyphText(g.glyphIds[0]) !== text) {
        this.flushSeg(r);
        r.ops.push(PDFOperator.of('BDC' as never, ['/Span', `<</ActualText <${utf16Hex(actual)}>>>`] as never));
        this.placeGlyph(m, g.fontSize, hex, 0, 0, x - g.x, y - g.y);
        this.flushSeg(r);
        r.ops.push(PDFOperator.of('EMC' as never));
        return;
      }
    }
    // 右から左の文字は、字形の並ぶ順が字の順と違うので、広げた字の並びの ActualText の対象にしない
    if (this.cell && !this.cell.single && vertical) {
      // 縦中横の枠: 最初の字の前で印の付いた内容を始める。枠の字は横に並ぶので、1 字ずつ Tm から書く (前の字の並びにも続けない)
      this.flushSeg(r);
      if (this.cell.text !== undefined) {
        r.ops.push(PDFOperator.of('BDC' as never, ['/Span', `<</ActualText <${utf16Hex(this.cell.text)}>>>`] as never));
        this.cell.text = undefined;
        this.cell.open = true;
      }
      this.placeGlyph(m, g.fontSize, hex, 0, 0, x - g.x, y - g.y, undefined, vertical);
      return;
    }
    this.placeGlyph(m, g.fontSize, hex, 0, 0, x - g.x, y - g.y, rtl ? undefined : text, vertical);
  }

  /**
   * 最後に書いた字の命令が、縦書きの書体の字の並びの全体 (並びの始まりからの TJ) なら、その命令の引数 (args[0] が TJ の配列)・中身・始まりの位置。
   * 次の字の並びが、すぐ左の、上端のそろった行なら、この命令を 2 つに分ける (flushSeg)
   */
  private lastColumn?: { args: string[]; parts: string[]; x: number; y: number; size: number };

  /**
   * 縦中横の枠の字を描いている間の印。text は、枠の最初の字の前に書く ActualText (書いたら undefined)、open は BDC を書いたか。
   * single は 1 字だけの枠 (ふつうの縦書きの字と同じに、行の字の並びに続ける)
   */
  private cell?: { text?: string; open: boolean; single: boolean };

  /**
   * 縦中横 (縦書きの行の 1 字分の枠に、横に並べた字): 字を縦書きの書体の字として 1 つずつ置き、2 字以上の枠は 1 つの印の付いた内容にして、
   * 字の並びを書き添える (ISO 32000-1 §14.9.4)。字を取り出す側は、枠を縦書きの行の中の 1 つの単位として読む (横書きの書体の字の並びの
   * ままだと、行の向きの違う別の行として、行の外へ出す・行を分ける)。字の位置は変えない。
   * 1 つの字形で書ける字が、同じ書体・大きさ・色で並ぶときだけ (ほかは false を返し、これまでどおり横書きの書体の字として描く)
   */
  drawTateChuYoko(a: TateChuYokoArea, x: number, y: number): boolean {
    const gs = a.glyphs;
    const g0 = gs[0];
    if (!this.verticalFonts || a.writingMode === 'horizontal-tb' || !gs.length) return false;
    const simple = (g: GlyphArea) =>
      g.rotation === 0 && g.color !== 'transparent' && g.glyphIds?.length === 1 && !RTL_TEXT.test(g.text) && !this.colorGlyphs?.handles(g) &&
      !g.transform && g.opacity === undefined && !g.orientation &&
      g.fontFamily === g0.fontFamily && g.fontWeight === g0.fontWeight && g.fontSize === g0.fontSize && g.color === g0.color && !g.fakeBold === !g0.fakeBold;
    if (!gs.every(simple)) return false;
    this.cell = { text: gs.map((g) => g.text).join(''), open: false, single: gs.length === 1 };
    try {
      for (const g of gs) this.drawGlyph(g, x + g.x, y + g.y);
    } finally {
      // 枠の字は同じ並び (run) に入る (書体・大きさ・色が同じ) ので、印の付いた内容は 1 つのテキストの区切り (BT…ET) の中で閉じる (§14.6.1)
      if (this.cell.open && this.run) {
        this.flushSeg(this.run);
        this.run.ops.push(PDFOperator.of('EMC' as never));
      }
      this.cell = undefined;
    }
    return true;
  }

  /**
   * 字 g を縦書きの書体 (WMode 1) の字として書くなら、その書体。書かないなら undefined (これまでどおり、横書きの書体の字として置く)。
   * 縦書きの行の正立の字で、1 つの字形のものだけ: 横倒しの字 (rotation 90) は、回したテキストの行列の横書きの字のままで、上から下へ並ぶ
   */
  private verticalFor(g: GlyphArea, font: PDFFont, hex: PDFHexString, complex: boolean): VerticalFont | undefined {
    if (!this.verticalFonts || complex || (g.writingMode === 'horizontal-tb' && !this.cell) || g.rotation !== 0) return undefined;
    const w = widthOfHex(hex);
    const code = hex.asString();
    if (w === undefined || code.length !== 4) return undefined;
    let vf = this.verticalFonts.get(font);
    if (!vf) this.verticalFonts.set(font, (vf = { ref: this.ctx!.context.nextRef(), origins: new Map() }));
    // 縦書きの原点の横の位置 (位置のベクトル v の x。1/1000 em): 全角の字 (送り 1000) は既定の「送りの半分」(§9.7.4.3 の DW2 の既定)。
    // ほかの字は、整数に丸めた値を W2 に書く (送りを整数に切り捨てて読む読み手 (PDFium) でも、字の位置が変わらないように)
    if (w !== 1000) vf.origins.set(parseInt(code, 16), Math.round(w / 2));
    return vf;
  }

  /**
   * 字を、ためている並び (run) に置く。同じ行列で同じ基線に並ぶ字は 1 つの文字列 (TJ。字の間隔は字送りの調整で表す) にまとめ、
   * 字ごとに Tm と Tj を書かない (PDF の内容が数分の 1 になる)。基線の違う字 (ずらした字形・横書きの書体で置く縦書きの字) は Tm から書き直す。
   * (u, v) は行列 m の文字空間での字の原点 (GPOS のずらし)。(ox, oy) は字の親の領域の原点、text は元の字 (分からなければ undefined)。
   * vertical があれば、縦書きの書体 (WMode 1) の字: 同じ行 (横の位置が同じ) に上から下へ並ぶ字を、1 つの文字列にまとめる (OUT-26)。
   * 字を取り出す側は、横書きの書体の字が 1 字ずつ縦に並ぶものを別々の行と見るが、縦書きの書体の字の並びは 1 つの行として読む
   */
  private placeGlyph(m: number[], size: number, hex: PDFHexString, u: number, v: number, ox: number, oy: number, text?: string, vertical?: VerticalFont) {
    const r = this.run!;
    let px = m[4] + m[0] * u + m[2] * v;
    let py = m[5] + m[1] * u + m[3] * v;
    // 文字列の送り (1/1000 em。PDF の W と同じ値)。分からなければまとめない
    const w = widthOfHex(hex);
    const s = r.seg;
    if (vertical) {
      // 縦書きの書体の字は、縦書きの原点 (横書きの原点 + 位置のベクトル v) をテキストの位置に合わせて描かれる (ISO 32000-1 §9.7.4.3)。
      // 字形の位置を変えないよう、テキストの位置を v だけずらす: v = (送りの半分, 880)/1000 em (DW2 の既定。全角でない字は W2 に書く値)。
      // 読む側が計算する字形の位置 (テキストの位置 − v) を、横書きの書体の字として Tm に書いていた値 (1/10000 に丸めた原点) に合わせる:
      // 字形を画素の何分の 1 かの位置に丸めて描く描き手 (Poppler は 1/4 画素) では、1/10000 pt に満たない差でも、丸めの境をまたいだ字が
      // 動いて見える。行列も Tm に書く値 (丸めた値) で計算する。字ごとに丸めた位置に合わせるので、行の中の字の間に、小さな数
      // (丸めの差。0.01/1000 em ほど) が入る
      const vx = ((w === 1000 ? 500 : Math.round(w! / 2)) * size) / 1000;
      const vy = (VERTICAL_ORIGIN_Y * size) / 1000;
      px = round4(px) + round4(m[0]) * vx + round4(m[2]) * vy;
      py = round4(py) + round4(m[1]) * vx + round4(m[3]) * vy;
      // 縦書きの書体の並び: 字は文字空間の y の負の向きへ進む (送り −1000。§9.7.4.3)。横の位置が同じなら同じ行 (回していない・傾けていない字だけ)。
      // TJ の数は、縦書きでは縦の位置から引く (§9.4.4): 正なら下 (先) へ進める。pen は、読む側が計算する位置 (書いた数で進めたもの)
      if (s && s.v && s.join && s.a === m[0] && m[1] === 0 && m[2] === 0 && m[3] === 1 && s.b === 0 && s.c === 0 && s.d === 1 && Math.abs(px - s.x) < 1e-7) {
        const n = py - s.y;
        const adj = Math.round(((s.pen - n) * 1000 * 1e5) / size) / 1e5;
        // 字を詰める向き (負の数) の大きな調整はしない (Tm から書き直す): TJ の数を横書きの向きで読む読み手 (PDFium) が、
        // 詰めた所 (続く約物の間など) を広い空きと見て、空白を挟む
        if (adj >= -VERTICAL_MAX_TIGHTEN) {
          if (adj !== 0) s.parts.push(decimal(adj));
          this.chain(s, ox, oy, text, adj >= WIDE_GAP * 1000 - 0.5);
          s.parts.push(`<${hex.asString()}>`);
          s.pen -= (adj * size) / 1000 + size;
          return;
        }
      }
      this.flushSeg(r);
      r.seg = { a: m[0], b: m[1], c: m[2], d: m[3], x: px, y: py, size, parts: [`<${hex.asString()}>`], pen: -size, join: true, chains: [{ at: 0, text }], ox, oy, v: true };
      return;
    }
    if (s && w !== undefined && s.join && !s.v && s.a === m[0] && s.b === m[1] && s.c === m[2] && s.d === m[3]) {
      // この字の原点を、並びの原点からの文字空間の座標 (t, n) で表す。n (基線と直交する向き) が 0 なら同じ基線
      const dx = px - s.x;
      const dy = py - s.y;
      const det = s.a * s.d - s.b * s.c;
      if (Math.abs(det) > 1e-9) {
        const t = (dx * s.d - dy * s.c) / det;
        const n = (s.a * dy - s.b * dx) / det;
        if (Math.abs(n) < 1e-4) {
          // TJ の数は 1/1000 文字空間単位 (字の大きさ倍される前) で、正なら左 (前) へ戻す
          const adj = ((s.pen - t) * 1000) / size;
          if (Math.abs(adj) >= 5e-5) s.parts.push(num(adj));
          this.chain(s, ox, oy, text, adj <= -(WIDE_GAP * 1000 - 0.5));
          s.parts.push(`<${hex.asString()}>`);
          s.pen = t + (w * size) / 1000;
          return;
        }
      }
    }
    this.flushSeg(r);
    r.seg = { a: m[0], b: m[1], c: m[2], d: m[3], x: px, y: py, size, parts: [`<${hex.asString()}>`], pen: w === undefined ? 0 : (w * size) / 1000, join: w !== undefined, chains: [{ at: 0, text }], ox, oy };
  }

  /**
   * 字の並び s に、次の字 (親の領域の原点 (ox, oy)、元の字 text) を続けるときの、ひと続きの字の並び (chains) の更新。
   * wide は、前の字との間を WIDE_GAP より広げたか
   */
  private chain(s: TextSeg, ox: number, oy: number, text: string | undefined, wide: boolean) {
    // 同じ親の領域に続けて置かれた字は、ひと続きの字の並び (字の間の空きは、字間・行の両端揃えで広げたもの)。親が変われば
    // (別の行内の箱・別のセル・ルビなど)、並びを分ける: 間の空きは、字の並びの切れ目 (読む側が空白を推測してよい所)
    const c = s.chains[s.chains.length - 1];
    if (Math.abs(ox - s.ox) > 1e-6 || Math.abs(oy - s.oy) > 1e-6) {
      s.chains.push({ at: s.parts.length, text });
      s.ox = ox;
      s.oy = oy;
      return;
    }
    // ほんものの空白の字の前後の空き (語の間を広げた両端揃え) は数えない: 空白の字が、そのまま取り出される
    if (wide && c.text !== undefined && text !== undefined && !/\s$/.test(c.text) && !/^\s/.test(text)) c.wide = true;
    c.text = c.text === undefined || text === undefined ? undefined : c.text + text;
  }

  /** ためている文字列を、Tm と Tj (字送りの調整があれば TJ) として run の命令に移す。数値は文字列にして渡す (pdf-lib の PDFNumber を作らない。1/10000 に丸める) */
  private flushSeg(r: { ops: PDFOperator[]; seg?: TextSeg }) {
    const s = r.seg;
    if (!s) return;
    r.seg = undefined;
    // 縦書きの書体の並びの位置は、1/100000000 まで書く (placeGlyph: 読む側が位置のベクトルを引いた字形の位置を、丸めた横書きの原点に合わせる)
    const at = s.v ? (v: number) => decimal(Math.round(v * 1e8) / 1e8) : num;
    r.ops.push(PDFOperator.of(Ops.SetTextMatrix, [num(s.a), num(s.b), num(s.c), num(s.d), at(s.x), at(s.y)] as never));
    // 字を取り出す側の PDFium は、字を書く命令 (Tj・TJ) ごとの始まりの位置を比べ、前の命令と高さがほぼ同じで、左にある命令を、同じ横書きの
    // 行の前の語とみて順を入れ替える。縦書きの行 (右から左へ並ぶ) を 1 行 1 命令で書くと、上端のそろった隣の行と順が入れ替わるので、
    // そうなる前の行の命令を、途中で 2 つの命令に分ける (後ろの命令の始まりが下になる。続きの TJ なので、字の位置は変わらない)
    const prev = this.lastColumn;
    this.lastColumn = undefined;
    if (prev && s.x < prev.x && Math.abs(s.y - prev.y) <= 0.6 * Math.max(s.size, prev.size)) {
      const strings = prev.parts.flatMap((part, k) => (part.startsWith('<') ? [k] : []));
      // 後ろの命令は 2 字 (並びが 3 字以下なら 1 字): 1 字だけの命令は、読む側が向きを決められないことがある
      const at = strings[Math.max(strings.length - 2, 1)];
      prev.args[0] = `[${prev.parts.slice(0, at).join('')}] TJ\n[${prev.parts.slice(at).join('')}]`;
    }
    const show = (parts: string[], first: boolean) => {
      const args = [parts.length === 1 ? parts[0] : `[${parts.join('')}]`];
      r.ops.push(PDFOperator.of(parts.length === 1 ? Ops.ShowText : Ops.ShowTextAdjusted, args as never));
      // 縦書きの書体の、2 字以上の並びの最後の命令で、並びの始まりから書いたもの (後で分けることがある)
      if (s.v && first && parts.filter((part) => part.startsWith('<')).length > 1) this.lastColumn = { args, parts, x: s.x, y: s.y, size: s.size };
      else this.lastColumn = undefined;
    };
    if (!s.chains.some((c) => c.wide && c.text !== undefined)) {
      show(s.parts, true);
      return;
    }
    // 字の間を広げた字の並び (OUT-24): 置き換えの文字列 (ISO 32000-1 §14.9.4) で、元の字の並びを書き添える。字を取り出す側は、印の付いた
    // 内容 (/Span … BDC 〜 EMC。§14.6) の中の字を、この文字列に置き換えるので、字の間の広さから空白を推測しない。印の付いた内容は
    // テキストの区切り (BT…ET) の中に置ける (§14.6.1)。字の位置 (TJ の字送りの調整) は変えない: 並びの切れ目で TJ を分けるだけで、
    // 切れ目の空きは、前の TJ の終わりの調整量になる。広げていない並びには付けない
    s.chains.forEach((c, i) => {
      const parts = s.parts.slice(c.at, s.chains[i + 1]?.at);
      const span = c.wide && c.text !== undefined;
      if (span) r.ops.push(PDFOperator.of('BDC' as never, ['/Span', `<</ActualText <${utf16Hex(c.text!)}>>>`] as never));
      show(parts, i === 0);
      if (span) r.ops.push(PDFOperator.of('EMC' as never));
    });
  }

  /** ためた字を書き出す */
  flushText() {
    const r = this.run;
    if (!r) return;
    this.run = undefined;
    this.flushSeg(r);
    const keys = r.vertical ? this.verticalFontKeys : this.fontKeys;
    let name = keys.get(r.font);
    if (!name) {
      name = r.vertical ? this.page.node.newFontDictionary(`${r.font.name}-V`, r.vertical.ref) : this.page.node.newFontDictionary(r.font.name, r.font.ref);
      keys.set(r.font, name);
    }
    this.page.pushOperators(
      pushGraphicsState(),
      // 疑似太字: 塗りと輪郭のなぞり (文字の描画モード 2) で字を太らせる
      // 疑似太字: 塗りと輪郭。継ぎ目は丸 (Canvas の strokeText と同じ lineJoin = 'round')
      ...(r.fakeBold ? [setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(r.size * FAKE_BOLD), PDFOperator.of(Ops.SetLineJoinStyle, [PDFNumber.of(1)]), ...colorOps(r.css, false, this.spots)] : []),
      beginText(),
      ...colorOps(r.css, true, this.spots),
      setFontAndSize(name, r.size),
    );
    pushOps(this.page, r.ops);
    this.page.pushOperators(endText(), popGraphicsState());
  }

  /** 線を引く。色が無ければトンボ (レジストレーション色)。色があれば、その色 (画像の代わりの枠・案内の線) */
  strokeLine(l: Line, width: number, color?: string) {
    this.flushText();
    const cs = color === undefined ? spotColorSpace(REGISTRATION, this.spots) : undefined;
    const colorSet = cs ? [PDFOperator.of(Ops.StrokingColorspace, [cs]), PDFOperator.of(Ops.StrokingColorN, [PDFNumber.of(1)])] : colorOps(color ?? '#000', false, this.spots);
    this.page.pushOperators(
      pushGraphicsState(),
      setLineWidth(width),
      ...colorSet,
      PDFOperator.of(Ops.MoveTo, [PDFNumber.of(l.x1), PDFNumber.of(this.H - l.y1)]),
      PDFOperator.of(Ops.LineTo, [PDFNumber.of(l.x2), PDFNumber.of(this.H - l.y2)]),
      PDFOperator.of(Ops.StrokePath),
      popGraphicsState(),
    );
  }

  clipPath(path: PathSeg[], evenOdd?: boolean) {
    this.flushText();
    this.page.pushOperators(pushGraphicsState(), ...this.pathOps(path), PDFOperator.of(evenOdd ? Ops.ClipEvenOdd : Ops.ClipNonZero), PDFOperator.of(Ops.EndPath));
    this.clips++;
  }

  clipRect(r: Rect) {
    this.flushText();
    const { page, H } = this;
    const x = r.x;
    const y = H - r.y - r.height;
    page.pushOperators(pushGraphicsState());
    // re W n  : 矩形をクリップパスにする
    page.pushOperators(...rectClipOps(x, y, r.width, r.height));
    this.clips++;
  }

  restore() {
    this.flushText();
    this.page.pushOperators(popGraphicsState());
    this.clips--;
  }
}

/** PDF の文字列 (UTF-16BE。先頭に BOM) の 16 進の表記 */
function utf16Hex(text: string): string {
  let out = 'FEFF';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return out;
}

/**
 * 2 つ以上の字形の並び ids が、字の並び text と字形ごとに対応するなら undefined (字形ごとの ToUnicode で元の字に戻せる)。
 * 対応しなければ (書体が合成・分解・並べ替えをした)、字形ごとの ToUnicode の字 (書体の cmap でその字形になる字。無ければ空) の並びを返す。
 * 対応するとみるのは、字と字形の数が同じとき (字形 i は字 i を置き換えたもの)。reorders (字形を並べ替えることのある用字) なら、いつも対応しないとみる
 */
function reorderedGlyphChars(font: PDFFont, ids: number[], text: string, reorders: boolean): string[] | undefined {
  const fk = (font as unknown as { embedder: { font: { glyphForCodePoint(cp: number): { id: number } } } }).embedder.font;
  const chars = [...text];
  if (!reorders && ids.length === chars.length) return undefined;
  let nominal: number[];
  try {
    nominal = chars.map((c) => fk.glyphForCodePoint(c.codePointAt(0)!).id);
  } catch {
    return undefined;
  }
  const used = new Set<number>();
  return ids.map((id) => {
    const k = nominal.findIndex((n, j) => n === id && !used.has(j));
    if (k < 0) return '';
    used.add(k);
    return chars[k];
  });
}

/**
 * 右から左の文字 (アラビア文字・ヘブライ文字など) の字形の並び ids (描く順 = 左から右) の、字形ごとの ToUnicode の字。
 * 書体は字の位置で字形を替え (語頭・語中・語尾形)、1 字を 2 つの字形に分ける (胴と点) ので、書体の cmap からは字を引けない。
 * 埋め込む書体で text を組み直し、fontkit が置き換えの後の字形を作るときに付ける字 (font.getGlyph(番号, 符号位置)。合字は成分の字すべて、
 * 1 字を分けた字形は最初の字形だけ) を写し取る (fontkit は字形のオブジェクトを番号ごとに使い回すので、後から字形に聞いても分からない)。
 * 描かない字 (ZWNJ など。fontkit は空白の字形に替える) だけの字形は、空にする (空白の字形の字が ZWNJ になってしまう)。
 * 字形の番号の並びが ids と合わなければ (組むときの機能の違いなど)、reorderedGlyphChars の決め方 (書体の cmap でその字形になる字) にする。
 * ここで決めるのは字形ごとの ToUnicode だけ (ActualText を読まない取り出し方のため。同じ字形を別の字に使う書体では、最初に使った字になる)
 */
function rtlGlyphChars(font: PDFFont, ids: number[], text: string, features?: string[]): string[] {
  const fk = (font as unknown as { embedder: { font: { layout(t: string, f?: unknown): { glyphs: Array<{ id: number }>; direction?: string }; getGlyph(id: number, cps?: number[]): unknown } } }).embedder.font;
  const calls: Array<{ id: number; cps: number[] }> = [];
  const orig = fk.getGlyph;
  const hadOwn = Object.prototype.hasOwnProperty.call(fk, 'getGlyph');
  fk.getGlyph = function (this: unknown, id: number, cps?: number[]) {
    calls.push({ id, cps: cps ? [...cps] : [] });
    return orig.call(this, id, cps);
  };
  let run: { glyphs: Array<{ id: number }>; direction?: string } | undefined;
  try {
    run = fk.layout(text, { kern: false, liga: false, clig: false, ...Object.fromEntries((features ?? []).map((x) => [x, true])) });
  } catch {
    run = undefined;
  } finally {
    if (hadOwn) fk.getGlyph = orig;
    else delete (fk as { getGlyph?: unknown }).getGlyph;
  }
  const n = ids.length;
  if (run && run.direction === 'rtl' && run.glyphs.length === n && run.glyphs.every((x, k) => x.id === ids[k])) {
    // 置き換えの後の字形を作る n 回の呼び出し (字の順。描く順はその逆) を、後ろから探す (その後ろに、空白の字形を引く呼び出しなどが続く)。
    // 描かない字の字形は、fontkit が後で空白の字形に替えるので、番号が違ってよい
    const ignorable = (c: { cps: number[] }) => c.cps.length > 0 && c.cps.every((cp) => IGNORABLE_ONLY.test(String.fromCodePoint(cp)));
    for (let end = calls.length; end >= n; end--) {
      const win = calls.slice(end - n, end).reverse();
      if (win.every((c, k) => c.id === ids[k] || ignorable(c))) return win.map((c) => (ignorable(c) ? '' : String.fromCodePoint(...c.cps)));
    }
  }
  return reorderedGlyphChars(font, ids, text, true) ?? ids.map(() => '');
}

/** 色を設定する命令。spots: 特色 (Separation) を登録するページ (無ければ特色は代わりの CMYK で描く) */
function colorOps(css: string, fill: boolean, spots?: SpotPage): PDFOperator[] {
  // 特色: Separation 色空間を選び、濃度を与える
  const pc = parseColor(css);
  if (pc.mode === 'cmyk' && pc.spot) {
    const cs = spotColorSpace(pc.spot, spots);
    if (cs) return [PDFOperator.of(fill ? Ops.NonStrokingColorspace : Ops.StrokingColorspace, [cs]), PDFOperator.of(fill ? Ops.NonStrokingColorN : Ops.StrokingColorN, [PDFNumber.of(pc.spot.tint)])];
  }
  const c = toPdfColor(css, spots?.cmyk);
  return [fill ? setFillingColor(c) : setStrokingColor(c)];
}

/**
 * 輪郭 (M・L・C・Z) を経路の命令 (m・l・c・h) にする。flipH を渡すと y を flipH − y にする (Sheet 座標 → PDF 座標)。
 * SVG の座標・模様の座標 (y 下向きのまま cm で写す) では渡さない
 */
/**
 * 配列 to の末尾に from の要素を足す。to.push(...from) は、要素を 1 つずつ引数として積むので、長いパス (数十万の点) では
 * 「Maximum call stack size exceeded」になり、図形 1 つのせいで文書の全体が PDF にならない
 */
function pushAll<T>(to: T[], from: readonly T[]) {
  for (let i = 0; i < from.length; i++) to.push(from[i]);
}

function segOps(segs: readonly Seg[], flipH?: number): PDFOperator[] {
  const N = (v: number) => PDFNumber.of(v);
  const Y = flipH === undefined ? (y: number) => y : (y: number) => flipH - y;
  return segs.map((g) =>
    g.op === 'M'
      ? PDFOperator.of(Ops.MoveTo, [N(g.x), N(Y(g.y))])
      : g.op === 'L'
        ? PDFOperator.of(Ops.LineTo, [N(g.x), N(Y(g.y))])
        : g.op === 'C'
          ? PDFOperator.of(Ops.AppendBezierCurve, [N(g.x1), N(Y(g.y1)), N(g.x2), N(Y(g.y2)), N(g.x), N(Y(g.y))])
          : PDFOperator.of(Ops.ClosePath),
  );
}

function rectClipOps(x: number, y: number, w: number, h: number): PDFOperator[] {
  return [
    PDFOperator.of(Ops.AppendRectangle, [PDFNumber.of(x), PDFNumber.of(y), PDFNumber.of(w), PDFNumber.of(h)]),
    PDFOperator.of(Ops.ClipNonZero),
    PDFOperator.of(Ops.EndPath),
  ];
}

/** 文書の情報 (Info 辞書: 題名・著者・主題・キーワード・作成したソフト) */
function setDocumentInfo(pdf: PDFDocument, tree: AreaTree, opts: PdfRenderOptions) {
  if (tree.title ?? opts.title) pdf.setTitle(tree.title ?? opts.title ?? '');
  if (tree.info?.author) pdf.setAuthor(tree.info.author);
  if (tree.info?.subject) pdf.setSubject(tree.info.subject);
  if (tree.info?.keywords) pdf.setKeywords(tree.info.keywords.split(/[,、]\s*/).filter(Boolean));
  pdf.setProducer('Kumiori (組み織り) typesetting engine');
  pdf.setCreator('Kumiori');
}

/**
 * 木で使われている画像 (fo:external-graphic・背景画像) を埋め込む。src ごとに、置かれる大きさ (最大) から必要な解像度を決める。
 * SVG は (XML パーサがあれば) ベクタのまま (vectors)、その中の data: の画像は svgImages に埋め込む。ラスタは images に
 */
async function embedImages(pdf: PDFDocument, tree: AreaTree, fonts: FontManager, opts: PdfRenderOptions): Promise<{ images: Map<string, PDFImage>; vectors: Map<string, SvgDoc>; svgImages: Map<object, PDFImage> }> {
  const sizes = new Map<string, number>();
  const heights = new Map<string, number>();
  const use = (src: string, w: number, h: number) => {
    sizes.set(src, Math.max(sizes.get(src) ?? 0, w));
    heights.set(src, Math.max(heights.get(src) ?? 0, h));
  };
  walkAreaTree(tree, (a) => {
    if (a.type === 'image') {
      if (!a.missing) use(a.src, a.width, a.height);
      return;
    }
    // 背景画像も埋め込む
    const bgi = a.backgroundImage;
    if (bgi) use(bgi.src, bgi.width, bgi.height);
    // 後ろに重ねる背景の画像 (複数の背景) も
    for (const l of bgi?.under ?? []) use(l.src, l.width ?? 0, l.height ?? 0);
  });
  const images = new Map<string, PDFImage>();
  const vectors = new Map<string, SvgDoc>();
  /** SVG の中の画像 (SvgShape.image) を埋め込んだもの (この文書のもの) */
  const svgImages = new Map<object, PDFImage>();
  const xml = opts.parseXml ?? (typeof DOMParser !== 'undefined' ? (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml') as unknown as XmlNode : undefined);
  const dpi = opts.imageDpi ?? 300;
  /**
   * 画像を埋め込む。入稿用 (PDF/X) なら、色のある RGB の画像を CMYK にして埋め込む (透明度があれば警告)。
   * それ以外 (PDF/X でない・灰色・CMYK の JPEG・読めない画像) は、ふつうに埋め込む
   */
  let alphaWarned = false;
  /**
   * PDF/X の RGB → CMYK: CMYK の ICC プロファイルを渡されたら、その表 (BToA) で変換する。読めないプロファイルなら警告して、
   * ISO 32000-2 §10.4.2.4 の式 (rgbToCmyk) で変換する
   */
  const cmykOf = pdfxConverter(opts);
  const embedAny = async (bytes: Uint8Array, kind: 'png' | 'jpg'): Promise<PDFImage> => {
    if (opts.pdfx) {
      const r = await embedCmykImage(pdf, bytes, kind, cmykOf!);
      if (r) {
        if (r.hasAlpha && !alphaWarned) {
          alphaWarned = true;
          opts.pdfx.warnings?.push('PDF/X-3 では透明 (画像の透明度) を使えません');
        }
        return r.image;
      }
    }
    return kind === 'png' ? await embedPngChecked(pdf, bytes) : await pdf.embedJpg(bytes);
  };
  /** SVG の中の画像 (data: の PNG・JPEG) を埋め込んでおく */
  const embedSvgImages = async (doc: SvgDoc) => {
    for (const sh of doc.shapes) {
      if (!sh.image || svgImages.has(sh.image)) continue;
      try {
        svgImages.set(sh.image, await embedAny(sh.image.bytes, sh.image.kind === 'png' ? 'png' : 'jpg'));
      } catch {
        /* 埋め込めない画像は描かない */
      }
    }
  };
  for (const [src, wPt] of sizes) {
    const asset = opts.assets?.get(src);
    if (xml && asset?.bytes && asset.mime === 'image/svg+xml') {
      await registerSvgFonts(fonts, new TextDecoder().decode(asset.bytes));
      const doc = parseSvg(new TextDecoder().decode(asset.bytes), xml, {
        outline: (t, fam, w, size) => outlineText(fonts, t, fam, w, size, !!opts.svgFontUniqueNames),
        ...(opts.svgMarkerOverflowVisible ? { markerOverflowVisible: true } : {}),
        ...(opts.svgRootOverflowVisible ? { rootOverflowVisible: true } : {}),
      });
      if (doc) {
        await embedSvgImages(doc);
        vectors.set(src, doc);
        continue;
      }
    }
    const data = await opts.assets?.forPdf(src, (wPt / 72) * dpi);
    if (!data) {
      // ラスタライズできない (Node): filter を近似して図形にする (影・ぼかし)
      if (xml && asset?.bytes && asset.mime === 'image/svg+xml') {
        const doc = parseSvg(new TextDecoder().decode(asset.bytes), xml, { outline: (t, fam, w, size) => outlineText(fonts, t, fam, w, size, !!opts.svgFontUniqueNames), approximateFilters: true });
        if (doc) {
          await embedSvgImages(doc);
          vectors.set(src, doc);
        }
      }
      continue;
    }
    try {
      // 置かれる大きさに対して解像度の高すぎる JPEG は、縮めて符号化し直す (imageMaxDpi を指定したときだけ)
      const jpg = data.type === 'jpg' && opts.imageMaxDpi ? (shrinkJpeg(data.bytes, wPt, heights.get(src) ?? 0, opts.imageMaxDpi) ?? data.bytes) : data.bytes;
      images.set(src, await embedAny(data.type === 'png' ? data.bytes : jpg, data.type === 'png' ? 'png' : 'jpg'));
    } catch {
      // 埋め込めない JPEG (CMYK 等) は PNG に変換して再試行
      const a = opts.assets?.get(src);
      const r = a && (await opts.assets?.rasterize(a, (wPt / 72) * dpi));
      if (r) images.set(src, await embedAny(r.bytes, 'png'));
    }
  }
  return { images, vectors, svgImages };
}

export async function renderPdf(tree: AreaTree, fonts: FontManager, opts: PdfRenderOptions = {}): Promise<Uint8Array> {
  if (opts.subset ?? true) patchFontkitSubset(fonts);
  patchCffEmbedding();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  setDocumentInfo(pdf, tree, opts);

  // 使用フォントだけを埋め込む (サブセット)。OpenType の機能 (onum・vert など) を使う字も、同じ埋め込みの字形として書く
  // 色つきの表を持つ書体の字は、別に Type 3 書体として書く (ふつうの埋め込みを通さない)。色つきの書体を使わない文書では undefined
  const colorGlyphs = await PdfColorGlyphs.create(pdf, tree, fonts, { cmyk: pdfxConverter(opts), warnings: opts.pdfx?.warnings, parseXml: opts.parseXml });
  const used = new Set<string>();
  walkAreaTree(tree, (a) => {
    if (a.type === 'glyph' && !colorGlyphs?.handles(a)) used.add(fonts.get(a.fontFamily, a.fontWeight).key);
  });
  const embedded = new Map<string, PDFFont>();
  /**
   * 書体を埋め込む (書体の key で覚える)。CFF の OpenType (先頭が OTTO) は、fontkit のサブセットが壊れた字形を出すので、
   * 自前の部分書体 (cff.ts。字の番号を変えない) にする。部分書体の名前は「大文字 6 字の印 + "+" + PostScript 名」(ISO 32000-2 §9.6.4)。
   * 印は埋め込む順の番号から作る
   */
  const embedFont = async (f: ReturnType<FontManager['all']>[number]) => {
    const cff = new Uint8Array(f.buffer, 0, 4).every((b, i) => b === 'OTTO'.charCodeAt(i));
    const wantSubset = opts.subset ?? true;
    // 可変フォントの実体は、軸の値の入った名前 (fontManager.ts の instance)。実体ごとに、静的な書体として埋める
    // (PDF の書体の種類に可変フォントは無い。ISO 32000-2 §9.6・§9.7)
    const ps = String((f.instanceOf ? f.postscriptName : undefined) ?? (f.fk as { postscriptName?: string }).postscriptName ?? f.family).replace(/[^!-~]|[()<>[\]{}/%#]/g, '');
    const customName = wantSubset ? `${subsetTag(embedded.size)}+${ps}` : undefined;
    const pf = await pdf.embedFont(new Uint8Array(f.buffer), { subset: !cff && wantSubset, ...(customName ? { customName } : {}) });
    if (cff && wantSubset) markCffSubset(pf);
    embedded.set(f.key, memoEncode(pf));
  };
  for (const f of fonts.all()) if (used.has(f.key)) await embedFont(f);
  const fontOf = (g: GlyphArea) => embedded.get(fonts.get(g.fontFamily, g.fontWeight).key)!;

  const { images, vectors, svgImages } = await embedImages(pdf, tree, fonts, opts);

  // SVG の中の字の書体 (PDF の文字として描く)。本文で使っていない書体も埋め込む
  const svgKeys = new Set<string>();
  for (const v of vectors.values()) for (const sh of v.shapes) for (const c of sh.text?.chars ?? []) svgKeys.add(c.font);
  for (const key of svgKeys) {
    if (embedded.has(key)) continue;
    const f = fonts.all().find((x) => x.key === key);
    if (f) await embedFont(f);
  }
  const svgFontOf = (key: string) => embedded.get(key);

  const cmykOf = pdfxConverter(opts);
  if (opts.pdfx?.profile && cmykOf === rgbToCmyk) opts.pdfx.warnings?.push('ICC プロファイルの CMYK への表 (BToA) が読めないので、RGB の色は簡単な式で CMYK にします');
  const painters: PdfPainter[] = [];
  const verticalFonts = new Map<PDFFont, VerticalFont>();
  for (const sheet of tree.sheets) {
    const page = pdf.addPage([sheet.width, sheet.height]);
    setBoxes(page, sheet);
    const painter = new PdfPainter(page, sheet.height, fontOf, (src) => images.get(src), (src) => vectors.get(src), pdf, svgFontOf, svgImages);
    if (cmykOf) painter.cmykOutput = cmykOf;
    painter.colorGlyphs = colorGlyphs;
    painter.verticalFonts = verticalFonts;
    paintSheet(sheet, painter);
    painter.flushText();
    painters.push(painter);
  }
  // FreeText の表示 (appearance stream) に使う書体: 注釈の文字をすべて持つ、埋め込み済みの書体
  const textFont = (text: string): PDFFont | undefined => {
    const cps = [...text.replace(/\s/g, '')].map((c) => c.codePointAt(0)!);
    for (const f of fonts.all()) {
      const e = embedded.get(f.key);
      if (e && cps.every((cp) => f.fk.hasGlyphForCodePoint(cp))) return e;
    }
    return undefined;
  };
  colorGlyphs?.finish();
  if (opts.pdfx) markPdfX(pdf, opts.pdfx, painters);
  // ファイルの識別子 (trailer の ID)。PDF 2.0 では必須、それより前の版では任意 (ISO 32000-2 §7.5.5 の Table 15・§14.4)
  if (!pdf.context.trailerInfo.ID) {
    const id = PDFHexString.of(Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
    pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);
  }
  const droppedLinks: DroppedLinks = {};
  const linkAction = (u: string) => externalAction(u, opts.links, droppedLinks);
  addAnnotations(pdf, painters, tree.destinations ?? {}, textFont, (src) => (opts.assets ?? new AssetStore()).getFile(src), linkAction);
  await addFormFields(pdf, painters, textFont, (u) => {
    // 送り先の URL も、リンクと同じ決まりでスキームを見る (スキームの無い相対の送り先は、そのまま書く)
    const j = judgeExternalLink(u, opts.links);
    if (j.kind === 'uri' && !j.allowed) countDroppedLink(droppedLinks, j);
    return j.kind !== 'uri' || j.allowed;
  });
  if (tree.bookmarks?.length) addOutline(pdf, tree.bookmarks, linkAction);
  const droppedSummary = summarizeDroppedLinks(droppedLinks);
  if (droppedSummary) opts.linkWarnings?.push(droppedLinkWarning(droppedSummary));
  // 縦書きの書体の辞書は、書体の辞書 (save の中の flush で作られる) から作る
  if (verticalFonts.size) {
    await pdf.flush();
    finishVerticalFonts(pdf, verticalFonts);
  }
  // 書体のストリーム (FontFile・ToUnicode) は save の中の flush で作られるので、先に flush してから圧縮の仕方を差し替える
  // (しないと、いちばん大きい書体のストリームが pako のまま圧縮される)
  if (opts.deflate) {
    await pdf.flush();
    useDeflate(pdf, opts.deflate);
  }
  // PDF/X-3 (PDF 1.4) では、オブジェクトストリーム (PDF 1.5 の機能) を使わない
  if (!opts.pdfx) return pdf.save();
  const bytes = await pdf.save({ useObjectStreams: false });
  // 版数を 1.4 に (同じ長さなので、相互参照のオフセットは変わらない)
  bytes.set(new TextEncoder().encode('%PDF-1.4'), 0);
  return bytes;
}

/**
 * SVG の text を、読み込み済みの書体の字形の輪郭にする (書体を埋め込まずにベクタで描ける)。
 * font-family は並びの最初の読み込み済みのもの (無ければ既定の書体)。字ごとに、字形を持つ書体へ切り替える
 */
/**
 * SVG の style の @font-face に埋め込んだ書体 (src が data: の URI の TrueType・OpenType) を、その font-family の名前で読み込む。
 * SVG の text は、この書体の輪郭で描く (無ければ読み込み済みの書体で描く)
 */
async function registerSvgFonts(fonts: FontManager, svg: string) {
  for (const m of svg.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
    // CSS の文字列の中の「\ + 改行」は、行の続き (改行を取り除く)
    const body = m[1].replace(/\\\r?\n/g, '');
    const fam = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i.exec(body)?.[2]?.trim();
    const data = /url\(\s*(['"]?)data:[^;,]*(?:;[^;,]*)*;base64,([A-Za-z0-9+/=\s]+)\1\s*\)/i.exec(body)?.[2];
    if (!fam || !data || fonts.has(fam)) continue;
    try {
      const bin = atob(data.replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      await fonts.registerBuffer(fam, 400, bytes.buffer, false);
    } catch {
      // 読めない書体は使わない (読み込み済みの書体で描く)
    }
  }
}

/** SVG の字のペアカーニング (字の大きさ 1em = unitsPerEm の座標で、a の後ろに b が続くときに足す量)。書体ごとに覚えておく */
const SVG_KERN = new WeakMap<object, Map<string, number>>();
function svgKern(font: ReturnType<FontManager['get']>, a: string, b: string): number {
  let m = SVG_KERN.get(font);
  if (!m) SVG_KERN.set(font, (m = new Map()));
  const key = a + '\u0000' + b;
  let v = m.get(key);
  if (v === undefined) {
    v = 0;
    try {
      const run = font.fk.layout(a + b, { kern: true, liga: false, clig: false } as never);
      if (run.glyphs.length === 2) v = run.positions[0].xAdvance - run.glyphs[0].advanceWidth;
    } catch {
      v = 0;
    }
    m.set(key, v);
  }
  return v;
}

function outlineText(fonts: FontManager, text: string, family: string | undefined, weight: number, size: number, uniqueNames = false): { segs: Seg[]; advance: number } | null {
  const names = family?.split(',').map((f) => f.replace(/['"]/g, '').trim()) ?? [];
  // アンテナハウス互換: ファミリー名の前に、PostScript 名・完全な名前で探す (見つかれば、その書体の太さで描く)
  const unique = uniqueNames ? names.map((f) => (fonts.has(f) ? undefined : fonts.uniqueName(f))).find(Boolean) : undefined;
  if (unique && !names.some((f) => fonts.has(f))) return outlineText(fonts, text, unique.family, unique.weight, size);
  // 読み込んでいない書体の名前なら、ゴシック系 (gothic・sans など) は和文のゴシック、それ以外は既定の書体 (明朝) で描く
  // Courier・等幅の名前は、字幅が Courier New と同じ Cousine (読み込んであれば)。等幅の総称の書体を差し替えたとき (genericFonts の monospace) は、
  // monospace の名前はその書体
  const monoLatin = fonts.latinFallbackOf(MONO_GENERIC);
  const fam =
    names.find((f) => fonts.has(f)) ??
    (monoLatin && names.some((f) => /monospace/i.test(f)) && fonts.has(monoLatin) ? monoLatin : undefined) ??
    (names.some((f) => /courier|monospace/i.test(f)) && fonts.has('Cousine') ? 'Cousine' : undefined) ??
    (names.some((f) => /gothic|ゴシック|sans|arial|helvetica|meiryo|メイリオ/i.test(f)) && fonts.has(SANS) ? SANS : undefined);
  // 読み込んでいない書体の名前が太字を表すなら (CourierNewPS-BoldMT など)、代わりの書体も太字にする
  if (!names.some((f) => fonts.has(f)) && weight < 700 && names.some((f) => /bold|black|heavy/i.test(f))) weight = 700;
  const segs: Seg[] = [];
  // PDF の文字として描くための字の並び (1 字が 1 つの字形になるときだけ)
  let chars: TextChars | undefined = [];
  let x = 0;
  let prev: { ch: string; font: ReturnType<FontManager['get']> } | undefined;
  for (const ch of text) {
    const font = fonts.getForChar(fam, weight, ch);
    const run = font.fk.layout(ch, { kern: false, liga: false } as never);
    const k = size / font.unitsPerEm;
    // 同じ書体の字が続くときは、書体のペアカーニングを前の字の送りに足す (font-kerning の既定 auto。ブラウザと同じく欧文にかける)
    if (prev && prev.font === font) x += svgKern(font, prev.ch, ch) * k;
    prev = { ch, font };
    if (run.glyphs.length === 1 && chars && !run.positions[0].xOffset && !run.positions[0].yOffset) chars.push({ ch, font: font.key, x });
    else chars = undefined;
    for (let g = 0; g < run.glyphs.length; g++) {
      const glyph = run.glyphs[g] as unknown as { path: { commands: Array<{ command: string; args: number[] }> } };
      const ox = x + run.positions[g].xOffset * k;
      const oy = -run.positions[g].yOffset * k;
      const P = (px: number, py: number) => [ox + px * k, oy - py * k] as const;
      let cx = 0;
      let cy = 0;
      for (const c of glyph.path.commands) {
        const a = c.args;
        if (c.command === 'moveTo' || c.command === 'lineTo') {
          const [px, py] = P(a[0], a[1]);
          segs.push({ op: c.command === 'moveTo' ? 'M' : 'L', x: px, y: py });
          [cx, cy] = [a[0], a[1]];
        } else if (c.command === 'quadraticCurveTo') {
          // 2 次ベジェを 3 次に
          const [qx, qy, ex, ey] = a;
          const [x1, y1] = P(cx + ((qx - cx) * 2) / 3, cy + ((qy - cy) * 2) / 3);
          const [x2, y2] = P(ex + ((qx - ex) * 2) / 3, ey + ((qy - ey) * 2) / 3);
          const [x3, y3] = P(ex, ey);
          segs.push({ op: 'C', x1, y1, x2, y2, x: x3, y: y3 });
          [cx, cy] = [ex, ey];
        } else if (c.command === 'bezierCurveTo') {
          const [x1, y1] = P(a[0], a[1]);
          const [x2, y2] = P(a[2], a[3]);
          const [x3, y3] = P(a[4], a[5]);
          segs.push({ op: 'C', x1, y1, x2, y2, x: x3, y: y3 });
          [cx, cy] = [a[4], a[5]];
        } else if (c.command === 'closePath') segs.push({ op: 'Z' });
      }
      x += run.positions[g].xAdvance * k;
    }
  }
  return { segs, advance: x, ...(chars?.length ? { chars } : {}) };
}

/**
 * フォームの欄 (axf:form-field) を、PDF の AcroForm の欄にする (pdf-lib の form)。
 * 欄の背景・枠は Kumiori が描くので、欄自身は透明・枠なし。表示の書体は、欧文だけなら Helvetica、それ以外は埋め込み済みの書体
 */
async function addFormFields(pdf: PDFDocument, painters: PdfPainter[], textFont: (text: string) => PDFFont | undefined, submitAllowed: (url: string) => boolean = () => true) {
  const all = painters.flatMap((p, k) => p.marks.filter((m) => m.form).map((m) => ({ ...m, page: k })));
  if (!all.length) return;
  const form = pdf.getForm();
  const pages = pdf.getPages();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  let dingbats: PDFFont | undefined;
  const latin = (t: string) => /^[\x20-\x7e]*$/.test(t);
  const used = new Set<string>();
  const unique = (name: string) => {
    let n = name;
    for (let k = 2; used.has(n); k++) n = `${name}_${k}`;
    used.add(n);
    return n;
  };
  const radios = new Map<string, ReturnType<typeof form.createRadioGroup>>();
  for (const m of all) {
    const f = m.form!;
    const [x1, y1, x2, y2] = m.rect;
    const page = pages[m.page];
    const text = f.kind === 'button' ? (f.caption ?? '') : f.kind === 'text' ? (f.value ?? '') : (f.options ?? []).map((o) => o.label).join('');
    const font = latin(text) ? helv : (textFont(text) ?? helv);
    const tc = parseColor(f.color ?? '#000000');
    const opts = {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
      borderWidth: 0,
      // 欄の背景・罫線は Kumiori がページに描くので、欄 (ウィジェット) の見た目には描かない
      backgroundColor: undefined,
      borderColor: undefined,
      textColor: tc.mode === 'rgb' ? rgb(tc.r, tc.g, tc.b) : tc.gray ? grayscale(1 - tc.k) : cmyk(tc.c, tc.m, tc.y, tc.k),
      font,
    };
    try {
      if (f.kind === 'text') {
        const t = form.createTextField(unique(f.name));
        if (f.multiline) t.enableMultiline();
        if (f.password) t.enablePassword();
        if (f.maxLength) t.setMaxLength(f.maxLength);
        if (f.value) t.setText(f.value);
        if (f.required) t.enableRequired();
        if (f.readOnly) t.enableReadOnly();
        t.addToPage(page, opts);
        if (typeof f.fontSize === 'number') t.setFontSize(f.fontSize);
        t.updateAppearances(font);
        if (f.fontSize === 'auto') autoFontSize(t.acroField);
      } else if (f.kind === 'checkbox') {
        const c = form.createCheckBox(unique(f.name));
        c.addToPage(page, opts);
        if (f.checked) c.check();
        dingbats ??= await pdf.embedFont(StandardFonts.ZapfDingbats);
        for (const w of c.acroField.getWidgets()) checkAppearance(pdf, w, f, dingbats, opts.textColor);
      } else if (f.kind === 'radio') {
        // 同じ名前の radio は 1 つの組
        let g = radios.get(f.name);
        if (!g) radios.set(f.name, (g = form.createRadioGroup(unique(f.name))));
        const value = f.value ?? `option${g.getOptions().length + 1}`;
        g.addOptionToPage(value, page, opts);
        if (f.checked) g.select(value);
        dingbats ??= await pdf.embedFont(StandardFonts.ZapfDingbats);
        const ws = g.acroField.getWidgets();
        checkAppearance(pdf, ws[ws.length - 1], f, dingbats, opts.textColor);
      } else if (f.kind === 'listbox' || f.kind === 'combobox') {
        const labels = (f.options ?? []).map((o) => o.label);
        const sel = (f.options ?? []).filter((o) => o.selected).map((o) => o.label);
        if (f.kind === 'listbox') {
          const l = form.createOptionList(unique(f.name));
          l.addOptions(labels);
          if (f.multiple) l.enableMultiselect();
          if (sel.length) l.select(f.multiple ? sel : sel[0]);
          l.addToPage(page, opts);
          if (typeof f.fontSize === 'number') l.setFontSize(f.fontSize);
          l.updateAppearances(font);
          if (f.fontSize === 'auto') autoFontSize(l.acroField);
          exportValues(l.acroField.dict, f);
        } else {
          const d = form.createDropdown(unique(f.name));
          d.addOptions(labels);
          if (f.editable) d.enableEditing();
          d.select(sel[0] ?? labels[0] ?? '');
          d.addToPage(page, opts);
          if (typeof f.fontSize === 'number') d.setFontSize(f.fontSize);
          d.updateAppearances(font);
          if (f.fontSize === 'auto') autoFontSize(d.acroField);
          exportValues(d.acroField.dict, f);
        }
      } else {
        const b = form.createButton(unique(f.name));
        b.addToPage(f.caption ?? '', page, opts);
        // pdf-lib はボタンに灰色の背景を付けるので外す (背景は Kumiori がページに描く)
        for (const w of b.acroField.getWidgets()) w.getAppearanceCharacteristics()?.dict.delete(PDFName.of('BG'));
        if (typeof f.fontSize === 'number') b.setFontSize(f.fontSize);
        b.updateAppearances(font);
        if (f.fontSize === 'auto') autoFontSize(b.acroField);
        // 送信・取り消しの動作
        const action =
          f.action === 'submit' && f.submitUrl && submitAllowed(f.submitUrl)
            ? { S: 'SubmitForm', F: pdfUri(f.submitUrl), Flags: f.submitMethod === 'get' ? 12 : 4 } // 4: HTML の書式で送る、8: GET
            : f.action === 'reset'
              ? { S: 'ResetForm' }
              : undefined;
        if (action) for (const w of b.acroField.getWidgets()) w.dict.set(PDFName.of('A'), pdf.context.obj(action));
        for (const w of b.acroField.getWidgets()) buttonStates(pdf, w.dict);
        // 保存のときに pdf-lib が見た目を作り直して R・D を消さないように、作り直し済みの印を付ける
        form.markFieldAsClean(b.ref);
      }
    } catch (e) {
      // 欄を作れない (書体に字が無いなど) ときは、見た目 (Kumiori が描いた枠) だけ残す
      console.warn('フォームの欄を作れません', f.name, e);
    }
  }
}

/**
 * プッシュボタンの、指を乗せた時 (R) と押した時 (D) の見た目 (ISO 32000-2 §12.5.5: 外観の辞書 AP の N・R・D)。
 * 通常の見た目 (N) を下地の上に描く Form XObject にする: R は薄い灰色の下地、D は濃い灰色の下地で中身を右下へ 0.75pt ずらす
 * (押し込んだように見せる)。押した時の効果 H は P (Push。§12.5.6.19 Table 191)
 */
function buttonStates(pdf: PDFDocument, widget: PDFDict) {
  const ctx = pdf.context;
  const ap = widget.lookup(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return;
  const nRef = ap.get(PDFName.of('N'));
  const n = nRef instanceof PDFRef ? ctx.lookup(nRef) : undefined;
  const bbox = n && 'dict' in (n as object) ? ((n as unknown as { dict: PDFDict }).dict.lookup(PDFName.of("BBox")) as import("pdf-lib").PDFArray | undefined) : undefined;
  if (!(nRef instanceof PDFRef) || !bbox) return;
  const [x0, y0, x1, y1] = bbox.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
  const N = (v: number) => PDFNumber.of(v);
  const state = (gray: number, dx: number, dy: number) =>
    ctx.register(
      ctx.formXObject(
        [
          pushGraphicsState(),
          PDFOperator.of(Ops.NonStrokingColorGray, [N(gray)]),
          PDFOperator.of(Ops.AppendRectangle, [N(x0), N(y0), N(x1 - x0), N(y1 - y0)]),
          PDFOperator.of(Ops.FillNonZero),
          popGraphicsState(),
          pushGraphicsState(),
          PDFOperator.of(Ops.ConcatTransformationMatrix, [N(1), N(0), N(0), N(1), N(dx), N(dy)]),
          PDFOperator.of(Ops.DrawObject, [PDFName.of('N0')]),
          popGraphicsState(),
        ],
        { BBox: [x0, y0, x1, y1], Resources: { XObject: { N0: nRef } } },
      ),
    );
  ap.set(PDFName.of('R'), state(0.92, 0, 0));
  ap.set(PDFName.of('D'), state(0.78, 0.75, -0.75));
  widget.set(PDFName.of('H'), PDFName.of('P'));
}

/**
 * 欄の文字の大きさを自動にする: DA の Tf の大きさを 0 にする (ISO 32000-2 §12.7.4.3: 0 は自動の大きさ)。
 * 見た目 (AP) は pdf-lib が欄に収まる大きさで作ったものを使う
 */
function autoFontSize(field: { dict: PDFDict; getWidgets(): Array<{ dict: PDFDict }> }) {
  for (const d of [field.dict, ...field.getWidgets().map((w) => w.dict)]) {
    const da = d.lookup(PDFName.of('DA'));
    if (!(da instanceof PDFString) && !(da instanceof PDFHexString)) continue;
    d.set(PDFName.of('DA'), PDFString.of(da.decodeText().replace(/(\/[^\s/]+\s+)[\d.]+(\s+Tf)/g, '$10$2')));
  }
}

/** チェックの形 (axf:field-checked-style) と、ZapfDingbats のその字 (pdf-lib の ZapfDingbats の符号化で Unicode から引く) */
const CHECK_CHARS: Record<NonNullable<FormField['checkStyle']>, string> = { checkmark: '\u2714', circle: '\u25cf', square: '\u25a0', cross: '\u2716', star: '\u2605' };

/**
 * チェックボックス・ラジオボタンの見た目 (ISO 32000-2 §12.7.5.2.3: 外観の辞書 N の、オンの名前とオフの名前の 2 つ)。
 * オンは ZapfDingbats のチェックの字を欄の中央に描き、オフは何も描かない (枠と背景は Kumiori がページに描く)。
 * MK の CA (§12.5.6.19 Table 192) にもその字を書き、背景・罫線の色 (BG・BC) は消す
 */
function checkAppearance(pdf: PDFDocument, w: PDFWidgetAnnotation, f: FormField, font: PDFFont, color: Color) {
  const ctx = pdf.context;
  const { width, height } = w.getRectangle();
  const ch = CHECK_CHARS[f.checkStyle ?? 'checkmark'];
  // 字の幅・高さが欄の 8 割に収まる大きさ
  const size = Math.max(Math.min((width * 0.8) / Math.max(font.widthOfTextAtSize(ch, 1), 1e-6), (height * 0.8) / Math.max(font.heightAtSize(1), 1e-6)), 0.1);
  const tx = (width - font.widthOfTextAtSize(ch, size)) / 2;
  const ty = (height - font.heightAtSize(size)) / 2 + (font.heightAtSize(size) - font.heightAtSize(size, { descender: false }));
  const fill = setFillingColor(color).toString();
  const code = font.encodeText(ch).toString();
  const on = ctx.stream(`q ${fill} BT /${font.name} ${size} Tf ${tx} ${ty} Td ${code} Tj ET Q`, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, width, height],
    Resources: { Font: { [font.name]: font.ref } },
  });
  const off = ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height] });
  const onName = w.getOnValue() ?? PDFName.of('Yes');
  const n = ctx.obj({});
  n.set(onName, ctx.register(on));
  n.set(PDFName.of('Off'), ctx.register(off));
  w.dict.set(PDFName.of('AP'), ctx.obj({ N: n }));
  const mk = w.getOrCreateAppearanceCharacteristics();
  mk.dict.delete(PDFName.of('BG'));
  mk.dict.delete(PDFName.of('BC'));
  mk.dict.set(PDFName.of('CA'), PDFString.of(String.fromCharCode(font.encodeText(ch).asBytes()[0])));
}

/**
 * リストボックス・コンボボックスの選択肢を、送る値と表示する文字の組 [送る値, 表示] にする (ISO 32000-2 §12.7.5.4 の Opt)。
 * 選んだ値 (V) と選んだ番号 (I) も送る値で書く。見た目は pdf-lib が表示の文字で作ったものを使う
 */
function exportValues(dict: PDFDict, f: FormField) {
  const opts = f.options ?? [];
  if (!opts.some((o) => o.value !== o.label)) return;
  const ctx = dict.context;
  dict.set(PDFName.of('Opt'), ctx.obj(opts.map((o) => ctx.obj([pdfText(o.value), pdfText(o.label)]))));
  const sel = opts.map((o, k) => (o.selected ? k : -1)).filter((k) => k >= 0);
  if (f.kind === 'combobox' && !sel.length && opts.length) sel.push(0);
  if (!sel.length) return;
  dict.set(PDFName.of('V'), sel.length > 1 ? ctx.obj(sel.map((k) => pdfText(opts[k].value))) : pdfText(opts[sel[0]].value));
  dict.set(PDFName.of('I'), ctx.obj(sel));
}

/** PDF/X-3:2003 の印 (OutputIntent・バージョン・Trapped・ID)。透明を使っていれば警告する */
function markPdfX(pdf: PDFDocument, o: NonNullable<PdfRenderOptions['pdfx']>, painters: PdfPainter[]) {
  const ctx = pdf.context;
  const condition = o.condition ?? 'JC200103';
  const intent: Record<string, unknown> = {
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: pdfText(condition),
    OutputCondition: pdfText(o.info ?? condition),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: pdfText(o.info ?? condition),
  };
  if (o.profile) intent.DestOutputProfile = ctx.register(ctx.stream(o.profile, { N: 4 }));
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.obj(intent as never)]));
  const info = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-3:2003'));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  // 文書の ID は renderPdf が書く。PDF 1.4 の版数は保存後に書き換える (pdf-lib の書き出しは 1.7 固定)
  if (painters.some((p) => p.usedAlpha)) o.warnings?.push('PDF/X-3 では透明 (不透明度) を使えません');
}

/** PDF の注釈の色 (C は RGB の配列) */
function annotColor(css: string): number[] {
  const c = parseColor(css);
  return c.mode === 'rgb' ? [c.r, c.g, c.b] : [(1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k)];
}

/** 外への飛び先を PDF の動作にする。書かないものは undefined (externalAction) */
type LinkAction = (url: string) => Record<string, unknown> | undefined;

/** リンク (fo:basic-link) と注釈 (axf:annotation-*) を、各ページの /Annots に足す */
function addAnnotations(
  pdf: PDFDocument,
  painters: PdfPainter[],
  destinations: Record<string, number>,
  textFont: (text: string) => PDFFont | undefined,
  fileOf: (src: string) => Uint8Array | undefined = () => undefined,
  linkAction: LinkAction = () => undefined,
) {
  const ctx = pdf.context;
  const pages = pdf.getPages();
  painters.forEach((painter, k) => {
    if (!painter.marks.length) return;
    const refs: PDFRef[] = [];
    for (const m of painter.marks) {
      if (m.form) continue; // フォームの欄は addFormFields で作る
      const base = { Type: 'Annot', Rect: m.rect, P: pages[k].ref };
      if (m.link) {
        const dict: Record<string, unknown> = { ...base, Subtype: 'Link', Border: [0, 0, 0] };
        if (m.link.external) {
          // 書いてよくない動作 (linkPolicy) のリンクは、注釈を作らない (字はそのまま)
          const action = linkAction(m.link.external);
          if (!action) continue;
          dict.A = action;
        } else if (m.link.internal !== undefined) {
          const page = pages[destinations[m.link.internal] ?? -1];
          if (!page) continue;
          dict.Dest = ctx.obj([page.ref, PDFName.of('XYZ'), null, page.getHeight(), null]);
        } else continue;
        refs.push(ctx.register(ctx.obj(dict as never)));
        continue;
      }
      const an = m.annot!;
      // 注釈のフラグ (F)。指定が無ければ書かない (既定値 0。ISO 32000-2 §12.5.2 Table 166)
      const dict: Record<string, unknown> = { ...base, ...(an.flags ? { F: an.flags } : {}) };
      if (an.contents) dict.Contents = PDFHexString.fromText(an.contents);
      if (an.title) dict.T = PDFHexString.fromText(an.title);
      if (an.color) dict.C = annotColor(an.color);
      if (an.kind === 'free-text') {
        const tc = annotColor(an.textColor ?? '#000');
        dict.Subtype = 'FreeText';
        const fs = an.fontSize ?? 10;
        dict.DA = PDFString.of(`/Helv ${fs} Tf ${tc.map((v) => v.toFixed(3)).join(' ')} rg`);
        // 表示 (AP): 背景 (注釈の色) と中身の文字。ビューアの既定の書体では和文が出ないので、埋め込み済みの書体で描く
        const font = textFont(an.contents ?? '');
        if (font) {
          const [x1, y1, x2, y2] = m.rect;
          const w = x2 - x1;
          const h = y2 - y1;
          const N = (v: number) => PDFNumber.of(v);
          const ops: PDFOperator[] = [];
          // 表示の Form XObject の資源には特色の色空間を置かないので、特色は代わりの CMYK (濃度を掛けた値) で塗る
          // (ページの資源の色空間の名前は、この XObject の中では引けない。ISO 32000-2 §7.8.3)
          const fillOf = (css: string) => setFillingColor(toPdfColor(css));
          if (an.color) ops.push(fillOf(an.color), PDFOperator.of(Ops.AppendRectangle, [N(0), N(0), N(w), N(h)]), PDFOperator.of(Ops.FillNonZero));
          ops.push(PDFOperator.of(Ops.BeginText), PDFOperator.of(Ops.SetFontAndSize, [PDFName.of('F0'), N(fs)]), fillOf(an.textColor ?? '#000'));
          (an.contents ?? '').split(/\r?\n/).forEach((t, k) => {
            ops.push(PDFOperator.of(Ops.SetTextMatrix, [N(1), N(0), N(0), N(1), N(2), N(h - 2 - fs * 0.88 - k * fs * 1.2)]));
            ops.push(PDFOperator.of(Ops.ShowText, [font.encodeText(t)]));
          });
          ops.push(PDFOperator.of(Ops.EndText));
          const ap = ctx.formXObject(ops, { BBox: [0, 0, w, h], Resources: { Font: { F0: font.ref } } });
          dict.AP = { N: ctx.register(ap) };
        }
      } else if (an.kind === 'stamp') {
        dict.Subtype = 'Stamp';
        dict.Name = textName(an.icon ?? 'Draft');
      } else if (an.kind === 'file-attachment' && an.file && fileOf(an.file.src)) {
        // 添付ファイルの注釈 (ISO 32000-2 §12.5.6.15 Table 187): FS はファイル指定の辞書 (Table 43。F・UF と、埋め込みの EF)、
        // 中身は埋め込みファイルの流れ (§7.11.4 Table 44・45: Type EmbeddedFile、Params の Size)
        const bytes = fileOf(an.file.src)!;
        const name = an.file.name ?? 'attachment';
        const ef = ctx.register(ctx.flateStream(bytes, { Type: 'EmbeddedFile', Params: { Size: bytes.length } }));
        dict.Subtype = 'FileAttachment';
        dict.FS = { Type: 'Filespec', F: pdfByteString(asciiName(name)), UF: PDFHexString.fromText(name), EF: { F: ef } };
        const icons = ['Graph', 'PushPin', 'Paperclip', 'Tag'];
        dict.Name = PDFName.of(icons.find((i) => i.toLowerCase() === (an.icon ?? '').toLowerCase()) ?? 'PushPin');
      } else {
        // 添付するファイルが無い (見つからない) FileAttachment は、テキスト注釈にする
        dict.Subtype = 'Text';
        dict.Name = textName(an.kind === 'text' ? (an.icon ?? 'Note') : 'Note');
        dict.Open = !!an.open;
      }
      const ref = ctx.register(ctx.obj(dict as never));
      refs.push(ref);
      if (m.popup) {
        const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: m.popup, Parent: ref, Open: !!an.open } as never));
        (ctx.lookup(ref) as PDFDict).set(PDFName.of('Popup'), popup);
        refs.push(popup);
      }
    }
    if (refs.length) pages[k].node.set(PDFName.of('Annots'), ctx.obj(refs));
  });
}

/** しおり (PDF のアウトライン)。飛び先はシートの上端 (見つからないしおりは飛び先なし) */
function addOutline(pdf: PDFDocument, items: BookmarkArea[], linkAction: LinkAction = () => undefined) {
  const ctx = pdf.context;
  const pages = pdf.getPages();
  const rootRef = ctx.nextRef();
  /** items を parent の子として作り、[first, last, 開いている子孫の数] を返す */
  const build = (list: BookmarkArea[], parent: PDFRef): [PDFRef, PDFRef, number] | null => {
    if (!list.length) return null;
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((b, k) => {
      const dict: Record<string, unknown> = {
        Title: PDFHexString.fromText(b.title),
        Parent: parent,
      };
      if (k > 0) dict.Prev = refs[k - 1];
      if (k + 1 < list.length) dict.Next = refs[k + 1];
      const page = b.sheet >= 0 ? pages[b.sheet] : undefined;
      if (page) dict.Dest = ctx.obj([page.ref, PDFName.of('XYZ'), null, page.getHeight(), null]);
      // 文書の外への飛び先 (fo:bookmark の external-destination。XSL 1.1 §6.11.2・§7.23.6): しおりの動作 (A。ISO 32000-1 §12.3.3。
      // Dest とは同時に書かない)。URL は URI 動作、相対の PDF は GoToR、と、リンクの注釈の外への飛び先と同じ決まり (externalAction)
      // 書いてよくない動作 (linkPolicy) は書かない (題だけのしおりになる)
      else if (b.external) {
        const action = linkAction(b.external);
        if (action) dict.A = ctx.obj(action as never);
      }
      const kids = build(b.children, refs[k]);
      if (kids) {
        dict.First = kids[0];
        dict.Last = kids[1];
        // 正の数: 開いた状態で表示する子孫の数 / 負の数: 閉じた状態
        dict.Count = b.open ? kids[2] : -kids[2];
        if (b.open) visible += kids[2];
      }
      visible++;
      ctx.assign(refs[k], ctx.obj(dict as never));
    });
    return [refs[0], refs[refs.length - 1], visible];
  };
  const top = build(items, rootRef);
  if (!top) return;
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[1], Count: top[2] }));
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** MediaBox = Sheet 全体。TrimBox = 仕上がり、BleedBox = 塗り足し込み (PDF 座標: 左下原点) */
function setBoxes(page: PDFPage, sheet: SheetArea) {
  const H = sheet.height;
  const conv = (r: Rect) => [r.x, H - r.y - r.height, r.width, r.height] as const;
  page.setMediaBox(0, 0, sheet.width, sheet.height);
  page.setBleedBox(...conv(sheet.bleedBox));
  page.setTrimBox(...conv(sheet.trimBox));
  page.setArtBox(...conv(sheet.trimBox));
  // CropBox は MediaBox のまま (トンボまで含めて表示)
  page.setCropBox(0, 0, sheet.width, sheet.height);
}
/** PDF の中身に書く数値 (1/10000 に丸める。指数表記にならない範囲) */
function num(v: number): string {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}
/**
 * 字の単位に、いつも元の字の並び (ActualText) を付ける用字 (drawGlyph。インド系の用字・タイ文字と同じ扱い): ラオ文字・チベット文字
 * (U+0E80〜U+0FFF)・ミャンマー文字 (U+1000〜U+109F と拡張)・クメール文字 (U+1780〜U+17FF)。前に置く母音記号・メディアルの RA などで、
 * 字形の並びが字の並びと違う順になる
 */
const ACTUAL_TEXT_SEA = /^[\u0E80-\u0FFF\u1000-\u109F\u1780-\u17FF\uA9E0-\uA9FF\uAA60-\uAA7F]/;

