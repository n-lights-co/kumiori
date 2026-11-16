/**
 * imageFormats — 本体の外に置いて、要るときだけ読み込む画像の形式の受け口 (プラグイン)。
 *
 * 公開の API: TypesetOptions.plugins (と、コマンドの --plugin) で、利用者がプラグイン (KumioriPlugin) を渡す。
 * プラグインはプログラムそのもの (本体と同じ権限で動く) なので、利用者が自分で選んで渡したものだけを使う。画面 (デモの Web アプリ) は、
 * 利用者の渡したプログラムを動かさない (本体と一緒に配るものだけ)。
 *
 * 形式は、中身の判定 (sniff。同期で安く) と、読み込み (load。非同期) の 2 つだけを持つ。大きさも load で決めるので、
 * 重い処理 (図の形式の解釈など) は load の中で import() すれば、その形式のファイルが出てきたときだけ読み込まれる
 * (画面の配布物では別のファイルに分かれる)。読み込んだ結果は SVG で返し、本体は WMF・EMF・CGM と同じく SVG の画像として扱う
 * (PDF には図形のまま入る。画面はブラウザが描く)。
 *
 * 本体と一緒に配る形式は IMAGE_FORMATS (いまは draw.io の図。drawio/index.ts。選択肢は TypesetOptions.drawio)。プラグインの形式は、本体の形式より先に判定する。
 * 本体の WMF・EMF・CGM・EPS は、この受け口に載せずに assets.ts が読む。受け口に無い動き (EPS の TIFF・WMF のプレビュー、
 * 文書あたりの EPS の時間の予算、描けないときも大きさの分かる画像を仮の枠で組むこと) があり、載せると外から見た動きが変わるため。
 * それらの処理 (cgm.ts・eps.ts・metafile.ts) も、ここの load と同じく、その画像が出てきたときだけ import() で読み込む
 */

import { DRAWIO_FORMAT, drawioFormat, type DrawioOptions } from './drawio/index';

/** 文字の書体 (文字の幅を測るとき) */
export interface MeasureFont {
  /** 書体の名前 (font-family の最初の名前) */
  family: string;
  /** 字の大きさ (px) */
  size: number;
  bold: boolean;
  italic: boolean;
}

/** 形式が読み込むときに使える、本体の道具 */
export interface ImageFormatContext {
  /** 文字の幅 (px) を、描く書体で測る (Node は PDF に SVG の文字を描く書体、画面はブラウザの canvas)。測れなければ undefined */
  measureText?: (text: string, font: MeasureFont) => number | undefined;
  /**
   * http(s) の資源 (図が URL で指す画像など) を、文書の画像と同じ決まり (resolveResource・fetchImages・大きさの上限) で取る。
   * 取れない・許されていなければ undefined
   */
  fetchResource?: (url: string) => Promise<Uint8Array | undefined>;
  /**
   * http(s) の資源を取る。fetchImages の決まりは見ない (形式の選択肢 (drawio.fetchStencils など) で、利用者がはっきり許したもの (図形ライブラリの配布物など) だけに使う)。
   * 大きさの上限 (画像と同じ)・時限 (fetchTimeoutMs)・転送の扱い (https から http への転送は断る) は本体と同じ。取れなければ undefined
   */
  fetch?: (url: string) => Promise<Uint8Array | undefined>;
  /** 取るときの時限 (ミリ秒。TypesetOptions.fetchTimeoutMs) */
  fetchTimeoutMs?: number;
  /** 組版の警告に出す (画像ごとでない警告。読めない選択肢のファイルなど。画像ごとの警告は ImageFormatResult.warnings) */
  warn?: (message: string) => void;
  /**
   * 画像の参照の URL の fragment (# の後ろ。# は含まない。%xx は戻さずに渡す)。無ければ undefined。
   * 1 つのファイルに図・ページが幾つもある形式は、これで描くものを選ぶ (RFC 3986 §3.5: fragment の意味は資源の形式が決める)。
   * 同じファイルを fragment の違う参照で指したときは、参照ごとに load を呼ぶ (AssetStore は、fragment を含む参照の名前で、別の画像として覚える)
   */
  fragment?: string;
  /** 警告の文の言語 (TypesetOptions.lang。コマンドは --lang・環境で決めたもの)。プラグインは、この言語で警告を書く */
  lang?: 'ja' | 'en';
}

/** 読み込んだ結果 */
export interface ImageFormatResult {
  /** SVG の文書 */
  svg: string;
  /** 大きさ (CSS px) */
  width: number;
  height: number;
  /** 描けなかったもの (組版の警告に出す。画像の notes) */
  warnings: string[];
}

export interface ImageFormat {
  /** 形式の名前 (警告に出す) */
  name: string;
  /** MIME の種類 (描けないときの仮の枠の画像の mime) */
  mime: string;
  /** 拡張子 (小文字、. を付けない)。文書・CSS に名前が出てくるファイルを画像として拾うのに使う */
  extensions: readonly string[];
  /** 中身がこの形式か (同期。先頭の数 KB を見るだけにする) */
  sniff(bytes: Uint8Array): boolean;
  /** 読み込んで SVG にする。この形式として読めなければ undefined (ほかの形式として読むことはしない: 読めない画像) */
  load(bytes: Uint8Array, ctx: ImageFormatContext): Promise<ImageFormatResult | undefined>;
}

/**
 * 形式 (プラグインと、本体と一緒に配る形式) の返す SVG の長さの上限 (字)。メタファイル・CGM の metafileSvgBudget (imageLimits.ts) と同じ考え方で、
 * 「ファイルの大きさに依らず使える分 + 1 バイトあたりの分」と、絶対の上限 (PS_MAX_SVG_CHARS と同じ 1 億 3,400 万字) までにする。
 * 超えた画像は読めない画像として扱う (警告を出す)。本体は SVG を XML として読んで図形にする (1 字あたり約 1 マイクロ秒と、文字列の何倍ものメモリ) ので、
 * プラグインが小さなファイルから巨大な SVG を作ると、文書の全体を組めなくなる (448 バイトの draw.io の図で、手書き風の塗りの SVG を作り続けて落ちた)。
 * 使える分を、メタファイル (2MB) より大きな 3,200 万字にするのは、図の形式は、ファイルの外の図形ライブラリ (draw.io の配布物の形) を描くので、
 * 小さなファイルからも、正当に大きな SVG ができるため (draw.io の図 (drawio/) は、1 つの図を 1,600 万字までにする)
 */
export const FORMAT_SVG_FREE_CHARS = 32 * 1024 * 1024;
export const FORMAT_SVG_CHARS_PER_BYTE = 128;
export const FORMAT_MAX_SVG_CHARS = 128 * 1024 * 1024;
/** fileBytes バイトのファイルを、形式が SVG にした文字列の長さの上限 */
export const formatSvgBudget = (fileBytes: number): number => Math.min(FORMAT_MAX_SVG_CHARS, FORMAT_SVG_FREE_CHARS + FORMAT_SVG_CHARS_PER_BYTE * fileBytes);

/**
 * 形式の返す大きさ (CSS px) の上限。有限でない値 (Infinity・NaN) と、これを超える値は、読めない画像として扱う。
 * 前は width > 0 だけを確かめたので、Infinity を受け取り (draw.io の図の x=-1e308 と 1e308 のセルで、図の幅が Infinity になる)、文書の全体が誤りで終わった。
 * 1,000 万 px (96dpi で約 2.6km) は、PDF の頁の大きさの上限 (ISO 32000-1 の附属書 C.2: 14,400 単位 = 200 インチ) よりずっと大きい
 */
export const FORMAT_MAX_SIZE = 1e7;

/**
 * 形式の読み込み (load) の時限 (ミリ秒)。時限を過ぎても終わらなければ、読めない画像として扱う (警告を出す)。
 * 前は時限が無く、終わらない Promise を返すプラグインで、組版が何も言わずに終わった (Node のイベントループが空になり、PDF を書かずに終了の番号 0 で終わった)。
 * 読み込みの中で資源を取る (図形ライブラリの配布物・配布物の画像・図が URL で指す画像を、順に 3 度まで) ので、取得の時限
 * (fetchTimeoutMs。既定 30 秒) の 3 倍に、描く時間の 60 秒を足す。プラグインの処理が同期で止まらない (無限の繰り返し) ものは、時限では止められない
 */
export const formatLoadTimeoutMs = (fetchTimeoutMs: number | undefined): number => 60_000 + 3 * (fetchTimeoutMs && fetchTimeoutMs > 0 ? fetchTimeoutMs : 30_000);

/**
 * 1 つのファイルを fragment の違う参照 (図.drawio#page=2 など) で読み直す数の上限 (AssetStore.addFragment)。参照ごとに形式が読み直す
 * (図を描き直す) ので、fragment だけを変えた参照を並べると、参照の数だけ手間がかかった (重い図を 30 個の参照で指して 84.9 秒)。
 * 64 は、draw.io の 1 つのファイルのページの数 (多くても数十) より大きい値。超えた参照は読めない画像として扱う (警告を出す)
 */
export const MAX_FORMAT_FRAGMENTS = 64;

/** 本体と一緒に配る形式 (要るときだけ読み込む。登録の順に判定する)。draw.io の図は既定の選択肢 (図形ライブラリ無し・取らない) のもの */
export const IMAGE_FORMATS: readonly ImageFormat[] = [DRAWIO_FORMAT];

/** プラグインの受け口の版。受け口を互換の無い形に変えたら上げる (古い版のプラグインは、読めないものとして断る) */
export const PLUGIN_API_VERSION = 1;

/** プラグイン (TypesetOptions.plugins)。いまの受け口は、画像の形式だけ */
export interface KumioriPlugin {
  /** 受け口の版 (PLUGIN_API_VERSION と同じ 1) */
  apiVersion: 1;
  /** プラグインの名前 (誤り・警告に出す) */
  name: string;
  /** 画像の形式 (先に書いたものから判定する) */
  imageFormats?: readonly ImageFormat[];
}

/**
 * プラグインの形を確かめる (TypeScript の型の守りの無い使い方: JavaScript・JSON の設定から呼ぶ利用者のため)。
 * 誤りなら、その理由 (日本語と英語) を返す。正しければ undefined
 */
export function pluginProblem(p: unknown, k: number): { ja: string; en: string } | undefined {
  const at = `plugins[${k}]`;
  if (!p || typeof p !== 'object') return { ja: `${at} はプラグインのオブジェクトにしてください`, en: `${at} must be a plugin object` };
  const o = p as Partial<KumioriPlugin>;
  if (typeof o.name !== 'string' || !o.name) return { ja: `${at} の name は空でない文字列にしてください`, en: `${at}.name must be a non-empty string` };
  if (o.apiVersion !== PLUGIN_API_VERSION)
    return { ja: `プラグイン ${o.name} の apiVersion ${JSON.stringify(o.apiVersion)} は使えません (この版の Kumiori は ${PLUGIN_API_VERSION})`, en: `plugin ${o.name}: apiVersion ${JSON.stringify(o.apiVersion)} is not supported (this Kumiori uses ${PLUGIN_API_VERSION})` };
  if (o.imageFormats === undefined) return undefined;
  if (!Array.isArray(o.imageFormats)) return { ja: `プラグイン ${o.name} の imageFormats は配列にしてください`, en: `plugin ${o.name}: imageFormats must be an array` };
  for (const [j, f] of o.imageFormats.entries()) {
    const ok = f && typeof f === 'object' && typeof f.name === 'string' && typeof f.mime === 'string' && Array.isArray(f.extensions) && f.extensions.every((e: unknown) => typeof e === 'string') && typeof f.sniff === 'function' && typeof f.load === 'function';
    if (!ok)
      return { ja: `プラグイン ${o.name} の imageFormats[${j}] は、name・mime・extensions (文字列の配列)・sniff・load (関数) を持つオブジェクトにしてください`, en: `plugin ${o.name}: imageFormats[${j}] must have name, mime, extensions (an array of strings), sniff and load (functions)` };
  }
  return undefined;
}

/**
 * プラグインの形式と、本体の形式 (プラグインの形式を先に判定する)。drawio は draw.io の図の選択肢 (TypesetOptions.drawio)。
 * false なら draw.io の図を画像として読まない (ほかの読めないファイルと同じ)。無ければ既定の選択肢
 */
export function formatsOf(plugins: readonly KumioriPlugin[] | undefined, drawio?: DrawioOptions | false): readonly ImageFormat[] {
  const own = drawio === false ? [] : drawio ? [drawioFormat(drawio)] : IMAGE_FORMATS;
  return plugins?.length ? [...plugins.flatMap((p) => p.imageFormats ?? []), ...own] : own;
}

/** 中身の形式 (どれにも当たらなければ undefined。判定の失敗は当たらないとみなす) */
export function formatOf(bytes: Uint8Array, formats: readonly ImageFormat[] = IMAGE_FORMATS): ImageFormat | undefined {
  for (const fmt of formats) {
    try {
      if (fmt.sniff(bytes)) return fmt;
    } catch {
      /* 判定できない中身は、その形式でない */
    }
  }
  return undefined;
}

/** 形式の拡張子 (正規表現の選択肢の形。無ければ空) */
export const formatExtensions = (formats: readonly ImageFormat[] = IMAGE_FORMATS) =>
  formats.flatMap((f) => f.extensions.map((e) => e.toLowerCase().replace(/[^a-z0-9]/g, ''))).filter(Boolean);
