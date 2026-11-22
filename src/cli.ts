/**
 * cli — HTML+CSS を、ブラウザを使わずに PDF に組む (Node のコマンド)。
 *
 * 使い方 (npm run build:cli の後):
 *   node dist-cli/cli.js <HTML ファイル> [-o <PDF ファイル>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--page-size <用紙>] [--svg-lang <ja,en>] [--css a.css,b.css]
 *                        [--font-dir <ディレクトリ>] [--font <書体ファイル>]... [--generic-font <総称>=<書体名>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4] [--pdfa 2b|3b] [--xhtml] [--watch]
 *   node dist-cli/cli.js <FO ファイル (.fo・.xml)> [-o <PDF ファイル>] [--compat spec|antenna] [--font-dir <ディレクトリ>] [--font <書体ファイル>]... [--generic-font <総称>=<書体名>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4] [--pdfa 2b|3b] [--watch]
 *   node dist-cli/cli.js a.html b.fo c.html -o <出力先のディレクトリ>      (まとめて変換)
 *   cat a.html | node dist-cli/cli.js - -o - [--base <ディレクトリ>] > a.pdf  (標準入力から読み、標準出力へ書く)
 *
 *  - HTML は linkedom で読み、CSS の計算値は自前のカスケード (cssCascade) で決める (画面の「CSS の解釈: Kumiori」と同じ)
 *  - HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・書体を、画面の「開く」で一緒に選んだのと同じに使う。
 *    画像は、文書と CSS (と、そこから参照された SVG) に名前が出てくるものだけを読む。
 *    --css は使う CSS ファイルを選ぶ (HTML から参照されていない CSS は、利用者のスタイルシートとして足す)
 *  - 既定の書体 (Noto Serif JP・Noto Sans JP・Tinos・Arimo。等幅の指定があれば Cousine、MathML があれば STIX Two Math、どの書体にも無い記号があれば Noto Sans Symbols 2、それにも無い絵文字があれば Noto Emoji) は、
 *    --font-dir に同じ名前のファイル (NotoSerifJP-Regular.ttf など) があれば
 *    そこから、無ければ Google Fonts から読む
 *  - XSL-FO (.fo・.xml、または --fo) は xmldom で読み、画面の XSL-FO の読み込みと同じに組む。--compat は既定値の流儀
 *    (spec: XSL-FO 1.1 の初期値 (既定) / antenna: アンテナハウスに合わせる)。同じディレクトリの書体ファイルは、FO の font-family から使う
 *  - --page-size <用紙>: HTML の既定の用紙 (@page で size を指定していない文書の用紙。既定 A4)。CSS の size の書き方 (A5・"A5 landscape"・148mm,210mm。
 *    CSS Paged Media 3 §7.1)。文書の @page { size } があれば、そちらが勝つ。@media の width・height もこの用紙で評価する。XSL-FO では使わない
 *  - --svg-lang <ja,en>: SVG の systemLanguage を照らす言語 (SVG を置いた所に言語の指定が無いとき。既定は実行環境の言語)
 *  - --print: トンボと塗り足し (3mm) を付ける
 *  - --format svg: PDF の代わりに、ページを SVG にする (字は書体の輪郭の道、画像は埋め込み。-o の拡張子が .svg なら書かなくてよい)。
 *    --format png: ページを PNG にする (自前で画素にする。--dpi <値> で解像度。既定 96。-o の拡張子が .png なら書かなくてよい)。
 *    書くページが複数なら、ページごとに -<番号> を付けた名前 (a-1.svg・a-2.svg …) に書く。--pages 1-3,5,7- で書くページを選ぶ (1 から数える)
 *  - --xhtml: 拡張子によらず、HTML を XML の構文 (XHTML) で読む (アンテナハウスのコマンドの -f XHTML に当たる。接頭辞の付いた m:math・s:svg も、名前空間に従って MathML・SVG になる)
 *  - 入力が複数なら、-o は出力先のディレクトリ (無ければ各入力の隣に .pdf)。1 つの失敗でほかの変換は止めない (終了コードは 1)。
 *    入力が 1 つでも、-o が既存のディレクトリなら、その中に <入力名>.pdf を書く
 *  - 入力の文字の符号化は、BOM と XML 宣言の encoding (Shift_JIS・EUC-JP など)・HTML の <meta charset> で決める (無ければ UTF-8)
 *  - --no-fetch-images: 文書が http(s) で参照する画像をネットワークから取らない (既定は取る。他人の文書をサーバーで組むときに)
 *  - --no-fetch-styles: 文書が http(s) で参照する CSS (<link>・@import) をネットワークから取らない (既定は取る)
 *  - --no-outside-files: 文書が file: の URL・../ で指した、入力のディレクトリの外のファイルを読まない (既定は読む。他人の文書を組むときに)
 *  - --low-memory: メモリを節約して組む (ページ番号の参照を決める組み直しで、前の回のページを使い回さない。数千ページの文書で、
 *    使うメモリが 4 割ほどになり、時間は 1.5 倍ほどになる。PDF は同じ)
 *  - --link-schemes http,https,…: PDF に動作を書くリンクの URL のスキーム (既定 http,https,mailto,tel。* はすべて)
 *  - --link-launch: ファイルを開く動作のリンク (PDF でない相対のファイル・絶対パスなど) も PDF に書く (既定は書かない)
 *  - --link-relative file|uri: スキームの無い相対参照のリンクの書き方 (既定 file: GoToR・Launch。uri: 書かれた参照のままの URI 動作)
 *  - draw.io の図 (.drawio・.dio) は画像として読む (API の drawio)。--drawio-stencils <ファイルかディレクトリ,…> で図形ライブラリ
 *    (draw.io の js/stencils.min.js かライブラリの XML) と配布物の画像 (.svg・.png・.jpg) を渡す。--fetch-drawio-stencils で、足りない
 *    図形ライブラリ・画像を draw.io の配布物から取るのを許す (取ったものは書体のキャッシュの場所に保存する)。--drawio-stencils-url <URL> は、
 *    取り先の stencils.min.js (--fetch-drawio-stencils も付けたことになる)。--no-drawio なら、draw.io の図を画像として読まない
 *  - --plugin <モジュール>: プラグイン (API の plugins) を読み込む。./・../ で始まるもの、絶対の道、file: の URL は、ファイルの道。
 *    それ以外は、import() と同じに、まずパッケージの名前として今のディレクトリから探し (.js などで終わるものも)、
 *    パッケージとして読めなければ (パッケージが無いときのほか、指したサブパスを exports で出していないとき・入口のファイルが無いときも)、
 *    今のディレクトリのその名前のファイルを読む (パッケージとして読めればパッケージ。確実にファイルを指すには ./ を付ける)。
 *    モジュールの default は、プラグイン (KumioriPlugin) か、プラグインを返す関数 ((選択肢, { cacheDir, lang }) => KumioriPlugin)。何度でも書ける。
 *    --plugin-option <名前>=<値> は、その前の --plugin の関数に渡す選択肢 (何度でも)。プラグインはプログラムそのものなので、信頼できるものだけを書く
 *  - 文書・CSS が file: の URL で参照するファイル (file:///…/style.css など) は、そのファイルを読む
 *  - '-' は標準入力から読む (CSS・画像・書体は --base のディレクトリ (既定は今のディレクトリ) から。FO かどうかは中身で見分ける)。
 *    -o - は PDF を標準出力へ書く (報告は標準エラーへ)
 *  - --watch: 入力のディレクトリの変更を見張り、変わるたびに組み直す (Ctrl+C で終わる)
 *  - --image-max-dpi <dpi>: 置かれる大きさに対してこれより細かい JPEG の写真を、この解像度に縮めて符号化し直す (PDF を小さくする。既定は元のまま)
 *  - --pdfx x1a|x1a:2003|x3|x4: 入稿用の PDF/X-1a:2001・PDF/X-1a:2003・PDF/X-3:2003・PDF/X-4 の印を付ける (RGB の色・画像は CMYK にする。
 *    ページの中のリンク・注釈・フォームの欄と、動作 (しおりの外への飛び先など) は書かない。X-1a・X-3 は、透明を平らにする。どの版も、書き出した PDF を調べて
 *    決まりに合わなければ誤り)。--output-profile <ICC> で出力の CMYK の ICC プロファイル (X-4 では必須で、出力機器のもの。X-1a は AtoB1 の表を持つもの)、
 *    --output-condition <名前> で印刷条件の名前 (既定 JC200103。ICC の登録簿に無い名前なら、X-1a でもプロファイルが要る) を渡す
 *  - --tagged (既定) / --no-tagged: タグ付き PDF にする・しない (文書の構造・読む順・図の代わりの文・言語を PDF に入れ、背景・罫線・柱を飾り (Artifact) にする。
 *    HTML・XSL-FO の入力)。--tagged と書いたときは --pdfx x1a・x3 とは一緒に使えない。書かなければ、x1a・x3 ではタグを付けない
 *  - --pdfua: PDF/UA-1 (ISO 14289-1) の印を付ける (--tagged を含む。XMP の pdfuaid・dc:title、DisplayDocTitle。字形の無い字は描かない。
 *    足りないもの (題・言語・図と数式の代わりの文・見出しの順) を警告に出す)。--document-lang <言語>: 入力に言語が無いときの文書の言語
 *  - --pdfa 2b|3b: 長期保存用の PDF/A-2b・PDF/A-3b の印を付ける (出力意図は sRGB。ファイルを開く動作 (Launch)・フォームの欄・字形の無い字は書かない。
 *    2b は添付ファイルを埋め込まない。書き出した PDF を調べて決まりに合わなければ誤り)。--pdfx と合わせるときは --output-profile が要る
 *  - --spot-colors <JSON ファイル>: 特色の名前と、濃度 100% の代わりの CMYK ({"名前": "cmyk(20%,40%,60%,80%)"} か {"名前": [0.2,0.4,0.6,0.8]})。
 *    rgb-icc(…, #Separation, '名前', 濃度) を、PDF の特色 (Separation) にする。無い名前は、代わりの RGB で塗る
 *  - 既定の書体は 1 度だけ読み、変換ごとに使い回す。読む順は --font-dir → 書体のキャッシュ → ネットワーク (Google Fonts)。
 *    ネットワークから取った書体はキャッシュに保存し、次からはネットワークに行かない。キャッシュの場所は --font-cache <dir>、
 *    環境変数 KUMIORI_FONT_CACHE、OS のキャッシュ ディレクトリ (Linux: $XDG_CACHE_HOME か ~/.cache の kumiori/fonts、
 *    macOS: ~/Library/Caches/kumiori/fonts、Windows: %LOCALAPPDATA%\kumiori\fonts) の順。--no-font-cache で使わない
 *  - --help (-h) は使い方、--version (-v) は版を標準出力に書いて終わる (終了コード 0)
 *  - 文言の言語: --lang ja|en → 環境変数 KUMIORI_LANG → OS のロケール (LC_ALL・LC_MESSAGES・LANG が en… なら英語)。既定は日本語 (messages.ts)
 *  - 未対応の CSS・XSL-FO の指定は、黙って無視せずに、診断 (typeset の diagnostics) として「警告 [名前] ファイル:行:列: 文」の形で知らせる
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { parseColor } from './color';
import type { HtmlDefaults } from './htmlPrepare';
import { parsePageSize } from './htmlImport';
import { FO_COMPATS, HTML_STYLES, type FoCompat } from './compat';
import { isXhtmlFile } from './xhtml';
import { decodeDocumentText, typeset, typesetToPdf, type KumioriFile, type TypesetOptions } from './api';
import { normalizeSrc } from './assets';
import { RESOURCE_USE, type ResourceUse } from './resourceUse';
import type { Diagnostic } from './diagnostics';
import { isOmittedDiagnostic } from './diagnostics';
import { isKumioriError } from './errors';
import type { KumioriPlugin } from './imageFormats';
import type { DrawioOptions } from './drawio/index';
import { cachedFetcher, stencilFiles } from './drawio/nodeFiles';
import { pluginNotFoundMessage, resolvePlugin } from './pluginResolve';
import { GENERIC_FONT_KEYS } from './fontMapping';
import { createFileResolver, defaultFontCacheDir, FETCH_TIMEOUT_MS, localFont } from './nodeFonts';
// テストと、これまで cli から読んでいた利用者のために出し直す
export { defaultFontCacheDir, localFont, looksLikeFont } from './nodeFonts';
import { MESSAGE_LANGS, detectMessageLang, messageLang, msg, setMessageLang, type MessageLang } from './messages';

// テストなどが使う (中身は api.ts)
export { fixImplicitStructure, wrapHtml } from './api';

/** -o が / (か path.sep) で終わる (ディレクトリと見なす書き方) */
function endsWithSep(p: string): boolean {
  return p.endsWith('/') || p.endsWith(path.sep);
}

/** 既にあるディレクトリか (末尾の / があっても、無くても) */
function existingDir(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/** 何かがあるか (末尾の / を落として見る。fs.existsSync('file.pdf/') は、ファイルがあっても false になるため) */
function existingPath(p: string): boolean {
  return fs.existsSync(path.resolve(p));
}

/** コマンドの引数 (テストのために出す) */
export function parseArgs(argv: string[], isDir: (p: string) => boolean = existingDir) {
  const out: {
    inputs: string[];
    output?: string;
    /** 出力の形式 (--format pdf|svg|png。書かなければ、-o の拡張子が .svg なら svg、.png なら png、ほかは pdf) */
    format?: 'pdf' | 'svg' | 'png';
    /** PNG の解像度 (--dpi。PNG だけ。無ければ 96) */
    dpi?: number;
    /** 書き出すページ (--pages。1 から数える。SVG だけ。無ければすべて) */
    pages?: PageRange[];
    style: HtmlDefaults;
    /** HTML の既定の用紙 (--page-size。@page で size を指定していない文書の用紙。CSS の size の書き方) */
    pageSize?: string;
    /** SVG の systemLanguage を照らす言語 (--svg-lang) */
    svgLanguages?: string[];
    css?: string;
    fontDir?: string;
    /** 書体のキャッシュのディレクトリ (--font-cache。無ければ KUMIORI_FONT_CACHE か OS のキャッシュ) */
    fontCache?: string;
    /** --no-font-cache: キャッシュを読まず、保存もしない */
    noFontCache: boolean;
    /** 足す書体のファイル (--font。システムに入れた書体のように、書体のファミリー名・太さで使う) */
    fontFiles: string[];
    /**
     * 総称の書体に使う書体のファミリー名 (--generic-font serif=<名前>。CSS Fonts 4 §2.1.3: 総称の書体の割り当ては UA が決める)。
     * serif・sans-serif・monospace は欧文の書体、serif-cjk・sans-serif-cjk は和文の書体 (fontMapping の GENERIC_FONT_KEYS)
     */
    genericFonts: Record<string, string>;
    print: boolean;
    /** HTML を XML の構文 (XHTML) で読む */
    xhtml?: boolean;
    fo: boolean;
    compat: FoCompat;
    watch: boolean;
    base?: string;
    /** 特色の名前 → 濃度 100% の代わりの CMYK (0〜1) */
    spotColors?: Record<string, [number, number, number, number]>;
    /** 引数を読むときに読んだファイル (--spot-colors・--output-profile)。出力でこれらを上書きしないために覚える */
    optionFiles?: string[];
    /** JPEG の解像度の上限 (dpi) */
    imageMaxDpi?: number;
    /** 入稿用の PDF/X の版 (--pdfx x1a|x1a:2003|x3|x4) */
    pdfx?: 'X-1a' | 'X-1a:2003' | 'X-3' | 'X-4';
    /** タグ付き PDF にするか (--tagged で true、--no-tagged で false。書かなければ既定 (付ける。PDF/X-1a・X-3 では付けない)) */
    tagged?: boolean;
    /** PDF/UA-1 にする (--pdfua。--tagged を含む) */
    pdfua?: boolean;
    /** 文書の言語 (--document-lang。入力に言語が無いときだけ使う) */
    documentLang?: string;
    /** 長期保存用の PDF/A の版と水準 (--pdfa 2b|3b) */
    pdfa?: 'A-2b' | 'A-3b';
    /** 出力の CMYK の ICC プロファイル (--output-profile) */
    outputProfile?: Uint8Array;
    /** 印刷条件の名前 (--output-condition。ICC の登録名など) */
    outputCondition?: string;
    /** 文書が http(s) で参照する画像をネットワークから取る (--no-fetch-images で止める) */
    fetchImages: boolean;
    /** 文書が http(s) で参照する CSS をネットワークから取る (--no-fetch-styles で止める) */
    fetchStyles: boolean;
    /** 文書が file: の URL・入力のディレクトリの外を指す相対参照で指したファイルを読む (--no-outside-files で止める) */
    outsideFiles: boolean;
    /** メモリ節約 (--low-memory): 組み直しで前の回のページを使い回さず、組み終えたページの組版の途中の結果を手放す (時間は増える) */
    lowMemory: boolean;
    /** PDF に動作を書くリンクの URL のスキーム (--link-schemes。無ければ既定の http・https・mailto・tel) */
    linkSchemes?: string[];
    /** ファイルを開く動作のリンクも PDF に書く (--link-launch) */
    linkLaunch: boolean;
    /** スキームの無い相対参照のリンクの書き方 (--link-relative file|uri。無ければ既定の file) */
    linkRelative?: 'file' | 'uri';
    /** draw.io の図形ライブラリのファイル・ディレクトリ (--drawio-stencils。, で区切ったもの。何度でも) */
    drawioStencils: string[];
    /** draw.io の配布物から取るのを許す (--fetch-drawio-stencils。--drawio-stencils-url なら、その URL) */
    drawioFetch: boolean | string;
    /** draw.io の図を画像として読まない (--no-drawio) */
    noDrawio: boolean;
    /** 読み込むプラグイン (--plugin) と、その選択肢 (--plugin-option 名前=値) */
    plugins: Array<{ spec: string; options: Record<string, string> }>;
    /** 知らせ (重さ info の診断) も出す (--verbose) */
    verbose: boolean;
    /** 診断の出し方 (--diagnostics text|json。json は標準エラーに 1 件 1 行の JSON) */
    diagnostics: 'text' | 'json';
    /** 出さない診断の名前 (--ignore-warning。, で区切ったもの。何度でも) */
    ignoreWarnings: string[];
    /** この重さ以上の診断があれば、出力を書いた上で終了コード 2 にする (--fail-on error|warning) */
    failOn?: 'error' | 'warning';
    /** --help: 使い方を書いて終わる */
    help: boolean;
    /** --version: 版を書いて終わる */
    version: boolean;
    /** --lang: 文言の言語 (無ければ環境から決める) */
    lang?: MessageLang;
  } = {
    inputs: [],
    fontFiles: [],
    genericFonts: {},
    style: 'kumiori',
    print: false,
    fo: false,
    compat: 'spec',
    watch: false,
    fetchImages: true,
    fetchStyles: true,
    outsideFiles: true,
    lowMemory: false,
    verbose: false,
    diagnostics: 'text',
    ignoreWarnings: [],
    linkLaunch: false,
    drawioStencils: [],
    drawioFetch: false,
    noDrawio: false,
    plugins: [],
    noFontCache: false,
    help: false,
    version: false,
  };
  // --lang は、どこに書いても誤りの文に効くように、先に読む
  const li = argv.indexOf('--lang');
  if (li >= 0 && (MESSAGE_LANGS as readonly string[]).includes(argv[li + 1] ?? '')) setMessageLang(argv[li + 1] as MessageLang);
  // 値をとるオプションの値。無ければ (最後の -o など) 誤り
  const value = (k: number) => {
    const v = argv[k + 1];
    if (v === undefined) throw new UsageError(msg(`${argv[k]} の値がありません`, `${argv[k]} needs a value`));
    // 値の所にオプションの名前があれば、値を書き忘れたと見なして誤りにする (-o --print は、--print という名前の PDF を書いていた)。
    // 使い方の文に出てくる名前だけを見る (- で始まる値 (-o - の標準出力など) は、そのまま値として読む)
    if (optionNames().has(v)) throw new UsageError(msg(`${argv[k]} の値がありません (続く ${v} はオプションです。${v} という名前を値にするときは、./${v} のように書いてください)`, `${argv[k]} needs a value (the following ${v} is an option; to use ${v} as the value, write it like ./${v})`));
    return v;
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-o' || a === '--output') {
      // 空の値 (-o '') は、-o 無しと区別が付かず、黙って入力の隣に書いてしまうので、値の誤りにする
      const v = value(k++);
      if (v === '') throw new UsageError(msg(`${a} の値が空です (出力のファイルかディレクトリの名前、または標準出力の - を書いてください)`, `${a} cannot be empty (give an output file or directory name, or - for standard output)`));
      out.output = v;
    }
    else if (a === '--format') {
      const v = value(k++);
      if (v !== 'pdf' && v !== 'svg' && v !== 'png') throw new UsageError(msg(`--format の値 "${v}" は使えません (pdf・svg・png)`, `--format cannot be "${v}" (pdf, svg, png)`));
      out.format = v;
    }
    else if (a === '--dpi') {
      const v = value(k++);
      const n = Number(v);
      if (!/^\d+(\.\d+)?$/.test(v.trim()) || !(n > 0) || n > 2400) throw new UsageError(msg(`--dpi の値 "${v}" は使えません (0 より大きく 2400 までの数を、150・72.5 のように数字と小数点で書きます)`, `--dpi cannot be "${v}" (a number above 0, up to 2400, written with digits and a decimal point, such as 150 or 72.5)`));
      out.dpi = n;
    }
    else if (a === '--pages') out.pages = parsePageRanges(value(k++));
    else if (a === '--style') {
      const v = value(k++);
      // 使える値は公開 API と同じ (compat.ts の HTML_STYLES)
      if (!(HTML_STYLES as readonly string[]).includes(v)) throw new UsageError(msg(`--style の値 "${v}" は使えません (${HTML_STYLES.join('・')})`, `--style cannot be "${v}" (${HTML_STYLES.join(', ')})`));
      out.style = v as HtmlDefaults;
    }
    else if (a === '--page-size') {
      // CSS の size の書き方 (CSS Paged Media 3 §7.1)。語の区切りは空白のほか、カンマでもよい (148mm,210mm。シェルで引用符を付けずに書ける)
      const v = value(k++);
      const size = v.split(/[\s,]+/).filter(Boolean).join(' ');
      if (!parsePageSize(size)) throw new UsageError(msg(`--page-size の値 "${v}" は使えません (A5・"A5 landscape"・148mm,210mm のように、用紙の名前か幅と高さ。長さは 1pt 以上)`, `--page-size cannot be "${v}" (a paper name or a width and height, such as A5, "A5 landscape" or 148mm,210mm; lengths of 1pt or more)`));
      out.pageSize = size;
    }
    else if (a === '--svg-lang') {
      const v = value(k++);
      const langs = v.split(/[\s,]+/).filter(Boolean);
      if (!langs.length || !langs.every((l) => /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(l))) throw new UsageError(msg(`--svg-lang の値 "${v}" は使えません (ja,en のように、言語タグをカンマで区切る)`, `--svg-lang cannot be "${v}" (language tags separated by commas, such as ja,en)`));
      out.svgLanguages = langs;
    }
    else if (a === '--css') out.css = value(k++);
    else if (a === '--font-dir') out.fontDir = value(k++);
    else if (a === '--font-cache') out.fontCache = value(k++);
    else if (a === '--no-font-cache') out.noFontCache = true;
    else if (a === '--font') out.fontFiles.push(value(k++));
    else if (a === '--generic-font') {
      const v = value(k++);
      const m = /^([a-z-]+)=(.+)$/.exec(v);
      if (!m || !(GENERIC_FONT_KEYS as readonly string[]).includes(m[1]))
        throw new UsageError(msg(`--generic-font の値 "${v}" は使えません (${GENERIC_FONT_KEYS.join('・')} のどれか=<書体名>)`, `--generic-font cannot be "${v}" (one of ${GENERIC_FONT_KEYS.join(', ')}=<family>)`));
      out.genericFonts[m[1]] = m[2].trim();
    }
    else if (a === '--print') out.print = true;
    else if (a === '--xhtml') out.xhtml = true;
    else if (a === '--fo') out.fo = true;
    else if (a === '--compat') {
      const v = value(k++);
      // 綴りの誤りを黙って spec にしない (--style と同じく誤りにする)
      if (!(FO_COMPATS as readonly string[]).includes(v)) throw new UsageError(msg(`--compat の値 "${v}" は使えません (${FO_COMPATS.join('・')})`, `--compat cannot be "${v}" (${FO_COMPATS.join(', ')})`));
      out.compat = v as FoCompat;
    }
    else if (a === '--watch') out.watch = true;
    else if (a === '--no-fetch-images') out.fetchImages = false;
    else if (a === '--no-fetch-styles') out.fetchStyles = false;
    else if (a === '--no-outside-files') out.outsideFiles = false;
    else if (a === '--low-memory') out.lowMemory = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--diagnostics') {
      const v = value(k++);
      if (v !== 'text' && v !== 'json') throw new UsageError(msg(`--diagnostics の値 "${v}" は使えません (text・json)`, `--diagnostics cannot be "${v}" (text, json)`));
      out.diagnostics = v;
    } else if (a === '--ignore-warning') out.ignoreWarnings.push(...value(k++).split(',').map((x) => x.trim()).filter(Boolean));
    else if (a === '--fail-on') {
      const v = value(k++);
      if (v !== 'error' && v !== 'warning') throw new UsageError(msg(`--fail-on の値 "${v}" は使えません (error・warning)`, `--fail-on cannot be "${v}" (error, warning)`));
      out.failOn = v;
    }
    else if (a === '--tagged') out.tagged = true;
    else if (a === '--no-tagged') out.tagged = false;
    else if (a === '--pdfua') out.pdfua = true;
    else if (a === '--document-lang') {
      const v = value(k++).trim();
      // BCP 47 の言語の札 (RFC 5646 §2.1 の字: 英数字と - だけ)
      if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(v)) throw new UsageError(msg(`--document-lang の値 "${v}" は言語の札 (ja・en-US など) ではありません`, `--document-lang "${v}" is not a language tag (such as ja or en-US)`));
      out.documentLang = v;
    }
    else if (a === '--link-schemes') {
      const v = value(k++);
      // スキームの名前 (RFC 3986 §3.1 の形) か * をカンマで区切る。末尾の : は付けても付けなくてもよい
      const list = v.split(',').map((s) => s.trim().replace(/:$/, '').toLowerCase()).filter(Boolean);
      const bad = list.find((s) => s !== '*' && !/^[a-z][a-z0-9+.-]*$/.test(s));
      if (!list.length || bad !== undefined) throw new UsageError(msg(`--link-schemes の値 "${v}" は使えません (http,https のようにスキームの名前をカンマで区切る。* はすべて)`, `--link-schemes cannot be "${v}" (comma-separated scheme names such as http,https; * means all)`));
      out.linkSchemes = list;
    }
    else if (a === '--link-launch') out.linkLaunch = true;
    else if (a === '--link-relative') {
      const v = value(k++);
      if (v !== 'file' && v !== 'uri') throw new UsageError(msg(`--link-relative の値 "${v}" は使えません (file か uri)`, `--link-relative cannot be "${v}" (file or uri)`));
      out.linkRelative = v;
    }
    else if (a === '--drawio-stencils') out.drawioStencils.push(value(k++));
    else if (a === '--fetch-drawio-stencils') out.drawioFetch ||= true;
    else if (a === '--drawio-stencils-url') {
      const v = value(k++);
      if (!/^https?:\/\//i.test(v)) throw new UsageError(msg(`--drawio-stencils-url の値 "${v}" は使えません (http(s) の URL)`, `--drawio-stencils-url cannot be "${v}" (an http(s) URL)`));
      out.drawioFetch = v;
    }
    else if (a === '--no-drawio') out.noDrawio = true;
    else if (a === '--plugin') out.plugins.push({ spec: value(k++), options: {} });
    else if (a === '--plugin-option') {
      const v = value(k++);
      const eq = v.indexOf('=');
      const last = out.plugins[out.plugins.length - 1];
      if (!last) throw new UsageError(msg('--plugin-option は --plugin の後に書いてください', '--plugin-option must come after --plugin'));
      if (eq <= 0) throw new UsageError(msg(`--plugin-option の値 "${v}" は使えません (名前=値)`, `--plugin-option cannot be "${v}" (name=value)`));
      last.options[v.slice(0, eq)] = v.slice(eq + 1);
    }
    else if (a === '--base') out.base = value(k++);
    else if (a === '--spot-colors') {
      const f = value(k++);
      out.spotColors = readSpotColors(f);
      (out.optionFiles ??= []).push(path.resolve(f));
    }
    else if (a === '--image-max-dpi') {
      const v = value(k++);
      const n = Number(v);
      // 数の書き方は --dpi と同じ (数字と小数点。0x10・1e3・Infinity などは誤り)
      if (!/^\d+(\.\d+)?$/.test(v.trim()) || !(n >= 1) || !Number.isFinite(n)) throw new UsageError(msg(`--image-max-dpi の値 "${v}" は使えません (1 以上の数を、300・150.5 のように数字と小数点で書きます)`, `--image-max-dpi cannot be "${v}" (a number of 1 or more, written with digits and a decimal point, such as 300 or 150.5)`));
      out.imageMaxDpi = n;
    }
    else if (a === '--pdfx') {
      const v = value(k++);
      const m = /^(?:pdf\/?)?x-?(1a(?::?(2001|2003))?|3|4)$/i.exec(v);
      if (!m) throw new UsageError(msg(`--pdfx の値 "${v}" は使えません (x1a・x1a:2003・x3・x4)`, `--pdfx cannot be "${v}" (x1a, x1a:2003, x3 or x4)`));
      out.pdfx = m[1] === '4' ? 'X-4' : m[1] === '3' ? 'X-3' : m[2] === '2003' ? 'X-1a:2003' : 'X-1a';
    }
    else if (a === '--pdfa') {
      const v = value(k++);
      const m = /^(?:pdf\/?)?(?:a-?)?([23])-?b$/i.exec(v);
      if (!m) throw new UsageError(msg(`--pdfa の値 "${v}" は使えません (2b・3b)`, `--pdfa cannot be "${v}" (2b or 3b)`));
      out.pdfa = m[1] === '3' ? 'A-3b' : 'A-2b';
    }
    else if (a === '--output-profile') {
      const f = value(k++);
      try {
        out.outputProfile = new Uint8Array(fs.readFileSync(f));
        (out.optionFiles ??= []).push(path.resolve(f));
      } catch (e) {
        throw new UsageError(msg(`--output-profile のファイルを読めません: ${f} (${(e as Error).message})`, `cannot read the --output-profile file: ${f} (${(e as Error).message})`));
      }
    }
    else if (a === '--output-condition') out.outputCondition = value(k++);
    else if (a === '--lang') {
      const v = value(k++);
      if (!(MESSAGE_LANGS as readonly string[]).includes(v)) throw new UsageError(msg(`--lang の値 "${v}" は使えません (${MESSAGE_LANGS.join('・')})`, `--lang cannot be "${v}" (${MESSAGE_LANGS.join(', ')})`));
      out.lang = v as MessageLang;
      setMessageLang(out.lang);
    }
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '-' || !a.startsWith('-')) out.inputs.push(a);
    // 知らないオプションは誤り (綴りの誤りの値を、入力のファイルとして扱わないように)
    else throw new UsageError(msg(`知らないオプションです: ${a}`, `unknown option: ${a}`));
  }
  // 出力の形式: 書かなければ -o の拡張子で決める (.svg なら SVG、.png なら PNG)。
  // 両方を書いて、-o の拡張子 (.pdf・.svg・.png) が形式と食い違うときは誤り (x.svg の名前の PDF・x.pdf-1.svg のような名前を作らない)。
  // 入力が複数なら -o は出力先のディレクトリなので、拡張子を見ない。入力が 1 つでも、-o が / で終わるか既にあるディレクトリなら、
  // planJobs がその中に <入力名>.<形式> を書くので、拡張子を見ない (d.svg という名前のディレクトリの中に PDF を書けるように)
  const outExt = out.output && out.inputs.length <= 1 && !endsWithSep(out.output) && !isDir(out.output) ? /\.(pdf|svg|png)$/i.exec(out.output)?.[1]?.toLowerCase() : undefined;
  if (out.format && outExt && outExt !== out.format) {
    throw new UsageError(msg(`-o の拡張子 .${outExt} と --format ${out.format} が食い違います (-o の拡張子を .${out.format} にするか、--format を外してください)`, `the -o extension .${outExt} does not match --format ${out.format} (use .${out.format} for -o, or drop --format)`));
  }
  out.format ??= outExt === 'svg' ? 'svg' : outExt === 'png' ? 'png' : 'pdf';
  if (out.format !== 'pdf') {
    // PDF の規格・PDF の書き方の指定は、SVG・PNG の出力には使えない
    const pdfOnly = [out.pdfx && '--pdfx', out.pdfa && '--pdfa', out.pdfua && '--pdfua', out.outputProfile && '--output-profile', out.outputCondition !== undefined && '--output-condition', out.tagged && '--tagged', out.imageMaxDpi && '--image-max-dpi', out.lowMemory && '--low-memory'].filter((x): x is string => !!x);
    if (pdfOnly.length) throw new UsageError(msg(`${pdfOnly.join('・')} は PDF の出力にだけ使えます (--format ${out.format} とは一緒に使えません)`, `${pdfOnly.join(', ')} can only be used for PDF output (not with --format ${out.format})`));
  } else if (out.pages) throw new UsageError(msg('--pages は --format svg か png と一緒に使ってください (PDF は、すべてのページを書きます)', '--pages needs --format svg or png (PDF output always has all pages)'));
  if (out.dpi !== undefined && out.format !== 'png') throw new UsageError(msg('--dpi は --format png と一緒に使ってください', '--dpi needs --format png'));
  if ((out.outputProfile || out.outputCondition !== undefined) && !out.pdfx) {
    throw new UsageError(msg('--output-profile・--output-condition は --pdfx と一緒に使ってください', '--output-profile and --output-condition need --pdfx'));
  }
  // PDF/X-4 は出力の ICC プロファイルの埋め込みが要る (pdfRenderer.ts の checkPdfX4Profile)
  if (out.pdfua && out.pdfx && out.pdfx !== 'X-4') {
    throw new UsageError(msg('--pdfua は --pdfx x1a・x3 と一緒に使えません (x4 は使えます)', '--pdfua cannot be combined with --pdfx x1a or x3 (x4 can)'));
  }
  if (out.pdfua && out.tagged === false) {
    throw new UsageError(msg('--pdfua は --no-tagged と一緒に使えません (PDF/UA-1 はタグ付き PDF です)', '--pdfua cannot be combined with --no-tagged (PDF/UA-1 is tagged PDF)'));
  }
  if (out.tagged && out.pdfx && out.pdfx !== 'X-4') {
    throw new UsageError(msg('--tagged は --pdfx x1a・x3 と一緒に使えません (透明を平らにする出力に、タグを付けられません。x4 は使えます)', '--tagged cannot be combined with --pdfx x1a or x3 (tags cannot be added to output whose transparency is flattened; x4 can)'));
  }
  if (out.pdfx === 'X-4' && !out.outputProfile) {
    throw new UsageError(msg('--pdfx x4 には、出力の CMYK の ICC プロファイル (--output-profile <ICC ファイル>) が要ります', '--pdfx x4 needs an output CMYK ICC profile (--output-profile <ICC file>)'));
  }
  // PDF/X と PDF/A を合わせるときは、2 つの出力意図に同じ ICC プロファイルを指させる (ISO 19005-2 §6.2.3) ので、プロファイルが要る
  if (out.pdfx && out.pdfa && !out.outputProfile) {
    throw new UsageError(msg('--pdfx と --pdfa を合わせるときは、出力の CMYK の ICC プロファイル (--output-profile <ICC ファイル>) が要ります', '--pdfx combined with --pdfa needs an output CMYK ICC profile (--output-profile <ICC file>)'));
  }
  return out;
}

/** 書き出すページの範囲 (1 から数える。to が無ければ最後まで) */
export interface PageRange {
  from: number;
  to?: number;
}

/** --pages の値 (1-3,5,7- のような、, で区切った番号・範囲) を読む。誤りは UsageError */
export function parsePageRanges(v: string): PageRange[] {
  const out: PageRange[] = [];
  for (const part of v.split(',')) {
    const m = /^\s*(\d+)\s*(?:(-)\s*(\d*)\s*)?$/.exec(part);
    const from = m ? parseInt(m[1], 10) : 0;
    const to = m?.[2] ? (m[3] ? parseInt(m[3], 10) : undefined) : from;
    if (!m || from < 1 || (to !== undefined && to < from)) throw new UsageError(msg(`--pages の値 "${v}" を読めません (1-3,5,7- のように、1 から数えた番号と範囲を , で区切って書きます)`, `cannot read --pages "${v}" (write 1-based page numbers and ranges separated by commas, such as 1-3,5,7-)`));
    out.push(to === undefined ? { from } : { from, to });
  }
  return out;
}

/** 範囲 ranges のうち、count ページの文書に無いページを指すもの (初めの番号か、閉じた範囲の終わりが count を超える。終わりの無い範囲は終わりを見ない) */
export function missingPageRanges(ranges: PageRange[] | undefined, count: number): PageRange[] {
  return (ranges ?? []).filter((r) => r.from > count || (r.to !== undefined && r.to > count));
}

/** 範囲 ranges のうち、count ページの文書にあるページの番号 (0 から数える。重ならず、昇順) */
export function selectPages(ranges: PageRange[] | undefined, count: number): number[] {
  if (!ranges) return Array.from({ length: count }, (_, i) => i);
  const set = new Set<number>();
  for (const r of ranges) for (let p = r.from; p <= Math.min(r.to ?? count, count); p++) set.add(p - 1);
  return [...set].sort((a, b) => a - b);
}

/**
 * ページごとの SVG・PNG のファイルの名前 (ext は '.svg' か '.png')。many (文書が複数ページ) でなければ output のまま、複数なら拡張子の前に
 * -<ページ番号> を付ける (番号は、文書のページ数の桁にそろえて 0 を詰める: 並べたときにページの順になるように)
 */
export function pageFile(output: string, page: number, count: number, many: boolean, ext = '.svg'): string {
  if (!many) return output;
  const digits = String(count).length;
  const n = String(page + 1).padStart(digits, '0');
  return output.toLowerCase().endsWith(ext) ? `${output.slice(0, -ext.length)}-${n}${output.slice(-ext.length)}` : `${output}-${n}${ext}`;
}

/** 特色の値の JSON ファイル ({"名前": "cmyk(…)" | [c, m, y, k]}) を読む */
function readSpotColors(file: string): Record<string, [number, number, number, number]> {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(msg(`--spot-colors のファイルを読めません: ${file} (${(e as Error).message})`, `cannot read the --spot-colors file: ${file} (${(e as Error).message})`));
  }
  return parseSpotColors(raw, file);
}

/**
 * 特色の値 (JSON の中身) を CMYK (0〜1) にする。配列は 0〜1 の 4 つの数 (百分率は cmyk(…%) の書き方で)。
 * 1 を超える要素は誤りにする (「1 を超えたら百分率」と見なすと、[100, 50, 1, 0] の 1 が 100% になってしまう)
 */
export function parseSpotColors(raw: unknown, file = ''): Record<string, [number, number, number, number]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(msg(`--spot-colors のファイルは、名前と CMYK の組のオブジェクトにしてください: ${file}`, `the --spot-colors file must be an object of name → CMYK: ${file}`));
  const out: Record<string, [number, number, number, number]> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const cmyk = Array.isArray(v) ? v.map(Number) : typeof v === 'string' ? (() => { const c = parseColor(v); return c.mode === 'cmyk' ? [c.c, c.m, c.y, c.k] : []; })() : [];
    if (cmyk.length !== 4 || cmyk.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) throw new UsageError(msg(`--spot-colors の「${name}」の値は CMYK (cmyk(…) か 0〜1 の 4 つの数) にしてください`, `the value of "${name}" in --spot-colors must be CMYK (cmyk(…) or four numbers 0–1)`));
    out[name] = cmyk as [number, number, number, number];
  }
  return out;
}

/** ネットワークからの取得 (書体・画像) の時限 */

/**
 * 入力のディレクトリの下のファイル (文書が参照しうる CSS・画像・書体など)。node_modules と . で始まるディレクトリ・ファイルは見ない。
 * 下の階層の読めないディレクトリ (権限が無い・たどる途中で消えたなど) は飛ばす (参照していないディレクトリ 1 つで変換全体を止めない)。
 * 入力のディレクトリそのものが読めないときは、今までどおり誤り
 */
export function listFiles(dir: string, readdir: (d: string) => fs.Dirent[] = (d) => fs.readdirSync(d, { withFileTypes: true })): string[] {
  const sub = (d: string): string[] => {
    try {
      return listFiles(d, readdir);
    } catch {
      return [];
    }
  };
  // . で始まるファイル (.env・.npmrc など。設定や秘密を置く慣わしのもの) も、文書のファイルとして渡さない (添付ファイルの注釈で、PDF に入れられないように)
  return readdir(dir).flatMap((e) => (e.name.startsWith('.') ? [] : e.isDirectory() ? (e.name === 'node_modules' ? [] : sub(path.join(dir, e.name))) : [path.join(dir, e.name)]));
}

/** ファイル file の実体 (シンボリックリンクをたどった先) が、ディレクトリ dir の実体の中にあるか。たどれないファイル (壊れたリンク) は外とみなす */
export function insideRealDir(dir: string, file: string): boolean {
  try {
    const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(file));
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/**
 * --css の値 (カンマ区切り) のファイルの並び。前後の空白は捨て、空の項目は無いものとする ("a.css, b.css" の b.css も使う)。
 * 使う CSS を選ぶところと、ディレクトリの外のファイルを探すところで、同じ並びを使う
 */
export function cssOptionFiles(value: string): string[] {
  return value.split(',').map((c) => c.trim()).filter(Boolean);
}

/**
 * コマンドの resolveResource: file: の URL の参照は、そのファイルを読む (入力のディレクトリの外でも。ブラウザで手元の HTML を開いたときと同じ)。
 * スキームの無い相対参照のうち、入力のディレクトリ (dir) の外を指すもの (sub/a.html の url(../fx/a.ttf) など。files には入っていない) も、
 * 同じ考えで、dir を基準に解決したファイルを読む (RFC 3986 §5.2: 相対参照は文書の URL を基準に解決する。CSS Values 4 §4.5.1・CSS Fonts 4 §4.3:
 * CSS の中の url() は、その CSS の場所が基準。CSS のファイルの中の参照は、resources.ts の resolveRef が dir からの相対パスにしてから問い合わせる)。
 * dir の中を指す相対参照は読まない (files に入れるかどうかは、--css の選び方・node_modules と . で始まるディレクトリを見ない決まりで決めている)
 */
export function cliResourceResolver(dir: string, readFile: (url: string) => Uint8Array | undefined = createFileResolver()): (url: string) => Uint8Array | undefined {
  const base = pathToFileURL(path.resolve(dir) + path.sep);
  return (url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return readFile(url);
    // 根からのパス (/a.png) と、スキームの無い //host/… は、文書の場所からの相対ではないので読まない
    if (!url || url.startsWith('/') || url.startsWith('\\')) return undefined;
    let target: URL;
    try {
      target = new URL(url, base);
    } catch {
      return undefined;
    }
    if (target.protocol !== 'file:') return undefined;
    // 道に使えない字 (%2F・%00 など。WHATWG URL の file: の道を、Node は区切りや NUL に戻さない) を含む参照は、読めない画像などとして扱う
    // (投げると、文書の 1 つの参照で変換全体が止まる)
    let file: string;
    try {
      file = fileURLToPath(target);
    } catch {
      return undefined;
    }
    const rel = path.relative(path.resolve(dir), file);
    const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
    return outside ? readFile(target.href) : undefined;
  };
}

/**
 * 止まった誤りの文を、端末に出す形にする (printable)。PDF/X・PDF/A の決まりに合わない所の一覧 (pdfx/not-conforming・pdfa/not-conforming) は、
 * Kumiori が 1 行に 1 件ずつ書いたものなので、行の区切りを残して、行ごとに逃がす (ほかの誤りの文の改行は、入力の名前などから来ることがあるので逃がす)
 */
export function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (isKumioriError(e) && (e.code === 'pdfx/not-conforming' || e.code === 'pdfa/not-conforming')) return text.split('\n').map(printable).join('\n');
  return printable(text);
}

/**
 * 端末に書く文 (警告・誤りの文) の制御文字を、見える形 (\\x1b など) にする。警告には、文書に書かれた字 (画像の URL・CSS のプロパティの名前など) が
 * そのまま入るので、他人の書いた文書が、エスケープ シーケンス (ECMA-48 §5.4 の ESC・CSI・OSC: 画面を消す・題名を書き換える・色を変えるなど) や
 * 改行 (偽の報告の行) を、組む人の端末や記録に書けないようにする。置き換えるのは C0 (U+0000〜U+001F。タブは残す)・DEL・C1 (U+0080〜U+009F。
 * 8 ビットの CSI など)。警告は 1 件を 1 行に書く決まりなので、改行も置き換える。行の区切り・段落の区切り (U+2028・U+2029。改行として扱う読み手がある)
 * と、字の向きの制御 (U+202A〜U+202E・U+2066〜U+2069。Unicode の UAX #9 の埋め込み・上書き・分離。端末で、続く字の並びを逆に見せられる) も、
 * \u2028 のように見える形にする
 */
export function printable(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .replace(INVISIBLE_FORMAT, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  );
}

/**
 * 端末に出すと、行を分けるか、字の並びの見え方を変える字 (C0・C1 の制御文字の外): 行・段落の区切り (U+2028・U+2029)、字の向きの印と
 * 制御 (Unicode の Bidi_Control: U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069。UAX #9 §2)、字の幅の無い印の BOM (U+FEFF)
 */
const INVISIBLE_FORMAT = /[\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * 1 件 1 行の JSON (--diagnostics json)。JSON.stringify は制御文字 (U+0000〜U+001F) を \uXXXX にするが、U+0085 (NEL)・U+2028・U+2029 は
 * そのまま書くので、改行として扱う読み手 (Python の str.splitlines など) では 1 件が 2 行に分かれる。これらも \uXXXX にする
 * (JSON の文字列の中で同じ意味。RFC 8259 §7。字の向きの制御も、端末に出すときのために同じくする)
 */
export function jsonLine(v: unknown): string {
  // DEL (U+007F) と C1 の制御文字 (U+0080〜U+009F。U+009B は 8 ビットの CSI で、端末の制御の列の頭になる) も、
  // 文字の出力 (printable) と同じく見える形にする
  return JSON.stringify(v)
    .replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(INVISIBLE_FORMAT, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** draw.io の図の選択肢 (1 回の実行で 1 度だけ作る: --watch で組み直すときも、取った図形ライブラリを使い回す) */
let drawioMade: DrawioOptions | false | undefined;
function drawioOptions(args: Args): DrawioOptions | false {
  if (drawioMade !== undefined) return drawioMade;
  if (args.noDrawio) return (drawioMade = false);
  const cacheDir = args.noFontCache ? undefined : args.fontCache ? path.resolve(args.fontCache) : defaultFontCacheDir();
  const lang = messageLang();
  const stencils = args.drawioStencils.length ? stencilFiles(args.drawioStencils.join(','), lang) : undefined;
  return (drawioMade = {
    ...(stencils ? { stencils } : {}),
    ...(args.drawioFetch ? { fetchStencils: cachedFetcher(cacheDir, lang), ...(args.drawioFetch === true ? {} : { stencilsUrl: args.drawioFetch }) } : {}),
  });
}

/** 読み込んだプラグイン (--plugin。1 回の実行で 1 度だけ読む: --watch で組み直すときも同じものを使う) */
let pluginsLoaded: Promise<KumioriPlugin[]> | undefined;
/**
 * --plugin のモジュールを読み込む。道の形 (./・../ で始まるもの、絶対の道、file: の URL) は、そのファイル。
 * そうでなければ、まずパッケージの名前として、import() と同じ条件 (exports の import・node・default) で、今のディレクトリから探し
 * (node_modules)、パッケージとして読めなければ (サブパスを出していない・入口のファイルが無いときも)、今のディレクトリのその名前のファイル (pluginResolve.ts の resolvePlugin)。
 * 見つからなければ、何をどの順に探したかを誤りの文に書く。default が関数なら、--plugin-option の選択肢と
 * { cacheDir: 書体のキャッシュのディレクトリ (--no-font-cache なら undefined), lang: 文言の言語 (--lang・環境) } を渡して呼ぶ
 */
function loadPlugins(args: Args): Promise<KumioriPlugin[]> {
  pluginsLoaded ??= (async () => {
    const cacheDir = args.noFontCache ? undefined : args.fontCache ? path.resolve(args.fontCache) : defaultFontCacheDir();
    const out: KumioriPlugin[] = [];
    for (const { spec, options } of args.plugins) {
      const { url, tried } = resolvePlugin(spec);
      if (!url) throw new Error(pluginNotFoundMessage(spec, tried));
      const mod = (await import(url)) as { default?: unknown };
      const d = mod.default;
      const plugin = typeof d === 'function' ? await (d as (o: Record<string, string>, c: { cacheDir?: string; lang: 'ja' | 'en' }) => unknown)(options, { ...(cacheDir ? { cacheDir } : {}), lang: messageLang() }) : d;
      if (!plugin) throw new Error(msg(`プラグイン ${spec} の default にプラグインがありません`, `plugin ${spec} has no default export`));
      out.push(plugin as KumioriPlugin);
    }
    return out;
  })();
  return pluginsLoaded;
}

/** 1 つの入力を PDF にする。input が '-' なら標準入力 (text に中身)、output が '-' なら標準出力 */
async function convert(input: string, output: string, args: Args, text: string) {
  const stdin = input === '-';
  const dir = stdin ? path.resolve(args.base ?? '.') : path.dirname(input);
  const cssNames = args.css ? cssOptionFiles(args.css) : undefined;
  const onlyCss = cssNames ? new Set(cssNames.map((c) => path.basename(c).toLowerCase())) : undefined;
  // --no-outside-files のときは、入力のディレクトリの中にあっても、実体 (シンボリックリンクをたどった先) が外にあるファイルは使わない
  // (ディレクトリの中に置いた a.png → ../secret/s.png のリンクで、外のファイルの中身が PDF に描かれていた)
  const all = listFiles(dir).filter((f) => f !== input && (args.outsideFiles || insideRealDir(dir, f)));
  // --css で選んだ CSS が @import する CSS も使う
  for (const name of onlyCss ?? []) {
    const file = all.find((f) => path.basename(f).toLowerCase() === name);
    if (file) for (const m of fs.readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) onlyCss!.add(path.basename(m[1]).toLowerCase());
  }
  const chosen = all.filter((f) => !/\.css$/i.test(f) || !onlyCss || onlyCss.has(path.basename(f).toLowerCase()));
  // --css に入力のディレクトリの外のファイルを書いたら、そのファイルを読む。どこにも無ければ誤り
  const outside: string[] = [];
  for (const c of cssNames ?? []) {
    const inDir = all.some((f) => path.basename(f).toLowerCase() === path.basename(c).toLowerCase());
    const p = path.resolve(c);
    if (!all.includes(p) && fs.existsSync(p) && fs.statSync(p).isFile()) outside.push(p);
    else if (!inDir && !fs.existsSync(p)) throw new Error(msg(`--css のファイルが見つかりません: ${c}`, `--css file not found: ${c}`));
  }
  // この変換で読んだファイル (入力・文書が参照した CSS・画像・書体・引数のファイル)。出力でこれらを上書きしない (checkOutputFiles)
  const read = new Set<string>([...(stdin ? [] : [input]), ...(args.optionFiles ?? []), ...stencilPaths(args.drawioStencils), ...pluginPaths(args)].map(pathKey));
  for (const p of [...read]) for (const id of fileIdKeys(p)) read.add(id);
  const note = (p: string) => {
    read.add(pathKey(p));
    for (const id of fileIdKeys(p)) read.add(id);
  };
  // ファイルは使うときだけ読む。名前は入力のディレクトリからの相対パス (ディレクトリの外のものはファイル名)。中身を読んだファイルは覚えておき、
  // 組んだ後で settleReads が「読んだファイル」に入れる (画像は、組版が実際に引いたものだけ: 文書の字に名前が出てくるだけの画像や、
  // 名前の末尾だけが同じ別のディレクトリの画像 (img/a.svg と a.svg) も、ライブラリは中身を読むが、使っていない。前に書き出したページの
  // a.svg を「読んだファイル」と見なすと、同じ文書の 2 度目の書き出しが誤りになっていた)
  const dataRead = new Map<string, string>();
  const lazy = (p: string, name: string): KumioriFile => ({
    name,
    data: async () => {
      dataRead.set(name, p);
      return fs.readFileSync(p);
    },
  });
  const use: ResourceUse = { imageNames: new Set(), usedKeys: new Set() };
  const settleReads = () => {
    for (const [name, p] of dataRead) if (!use.imageNames.has(name) || use.usedKeys.has(normalizeSrc(name))) note(p);
  };
  const files = [...chosen.map((p) => lazy(p, path.relative(dir, p).split(path.sep).join('/'))), ...outside.map((p) => lazy(p, path.basename(p)))];
  // --fo・--xhtml は拡張子によらない (前は --xhtml を、.xml の入力では見ずに XSL-FO として読んでいた)。両方なら --fo
  const kind = args.fo ? 'fo' : args.xhtml ? 'xhtml' : stdin ? undefined : /\.(fo|xml)$/i.test(input) ? 'fo' : isXhtmlFile(input) ? 'xhtml' : 'html';
  const pdfxWarnings: string[] = [];
  const docOptions: TypesetOptions = {
    ...(kind ? { kind } : {}),
    // 診断の場所 (source.file) に入れる、入力のファイルの名前
    ...(stdin ? {} : { name: path.basename(input) }),
    // 出さない診断 (--ignore-warning)
    ...(args.ignoreWarnings.length ? { diagnostics: { ignore: args.ignoreWarnings } } : {}),
    files,
    // 入力のディレクトリの CSS のうち、文書が参照していないものは当てない (--css で名指ししたものは、参照していなくても利用者のスタイルシートとして足す)
    ...(cssNames ? {} : { unreferencedCss: 'ignore' as const }),
    fonts: args.fontFiles.map((f) => lazy(f, path.basename(f))),
    genericFonts: args.genericFonts,
    style: args.style,
    ...(args.pageSize ? { pageSize: args.pageSize } : {}),
    ...(args.svgLanguages ? { svgLanguages: args.svgLanguages } : {}),
    compat: args.compat,
    print: args.print,
    fetchImages: args.fetchImages,
    fetchStyles: args.fetchStyles,
    links: { ...(args.linkSchemes ? { schemes: args.linkSchemes } : {}), launch: args.linkLaunch, ...(args.linkRelative ? { relative: args.linkRelative } : {}) },
    // file: の URL の参照と、入力のディレクトリの外を指す相対参照は、そのファイルを読む (ブラウザで手元の HTML を開いたときと同じ。cliResourceResolver)
    // --no-outside-files なら読まない (他人の書いた文書を組むとき。文書が指した画像・書体・SVG は、読めた中身が PDF に描かれるので、
    // 組む側の機械の、入力のディレクトリの外のファイルを写し取られないようにする)
    ...(args.outsideFiles ? { resolveResource: cliResourceResolver(dir, notingReads(createFileResolver(), note)) } : {}),
    ...(args.spotColors ? { spotColors: args.spotColors } : {}),
    // SVG・PNG の出力には構造の木を書かないので、作らない (作ると、タグ付き PDF の表の構造の上限などの、PDF にだけ関わる診断が出る)
    ...(args.tagged !== undefined ? { tagged: args.tagged } : args.format === 'svg' || args.format === 'png' ? { tagged: false } : {}),
    ...(args.pdfua ? { pdfua: { warnings: pdfxWarnings } } : {}),
    ...(args.documentLang ? { documentLang: args.documentLang } : {}),
    // 書体の置き場・キャッシュから読んだ書体のファイルも、出力で上書きしない (note)
    loadFont: localFont(args.fontDir, args.noFontCache ? undefined : args.fontCache ? path.resolve(args.fontCache) : defaultFontCacheDir(), undefined, undefined, note),
    lang: messageLang(),
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    drawio: drawioOptions(args),
    ...(args.plugins.length ? { plugins: await loadPlugins(args) } : {}),
    // PDF の圧縮は Node の zlib (ネイティブ) で行う (pdf-lib の pako より速い)
    deflate: (b) => deflateSync(b),
    // 組版が実際に引いた画像を知る内部の仕組み (resourceUse.ts)
    [RESOURCE_USE]: use,
  } as TypesetOptions;
  // SVG: 組んだ結果のページを SVG にする (PDF の圧縮 (deflate) は使わない)
  if (args.format === 'svg' || args.format === 'png') return convertToPages(input, output, args, text, docOptions, args.format, read, settleReads);
  // PDF だけを作る (typeset の後に toPdf を呼ぶのと同じ PDF。ページを書いたら手放すので、数千ページの文書でも、文書全体の領域の木を持たない)
  const res = await typesetToPdf(text, docOptions, {
    ...(args.lowMemory ? { lowMemory: true } : {}),
    ...(args.imageMaxDpi ? { imageMaxDpi: args.imageMaxDpi } : {}),
    ...(args.pdfx
      ? {
          pdfx: {
            version: args.pdfx,
            ...(args.outputProfile ? { profile: args.outputProfile } : {}),
            ...(args.outputCondition !== undefined ? { condition: args.outputCondition } : {}),
            warnings: pdfxWarnings,
          },
        }
      : {}),
    ...(args.pdfa ? { pdfa: { version: args.pdfa, warnings: pdfxWarnings } } : {}),
  });
  const pdf = res.pdf;
  if (output === '-') process.stdout.write(pdf);
  else {
    settleReads();
    checkOutputFiles([output], input, read);
    writeOutput(output, input, pdf);
  }
  // PDF を標準出力へ書くときは、報告は標準エラーへ
  const log = reportLog(output);
  // ファイルの名前の改行・制御文字も見える形にする (名前に改行と { があると、{ で始まる偽の行に見える)
  const target = output === '-' ? msg('(標準出力)', '(stdout)') : printable(path.basename(output));
  log(msg(`${target}: ${res.pageCount} ページ (組版 ${res.layoutMs}ms)`, `${target}: ${res.pageCount} page${res.pageCount === 1 ? '' : 's'} (layout ${res.layoutMs}ms)`));
  // PDF/X・PDF/A・PDF/UA の知らせ (pdfxWarnings) も、診断 (res.diagnostics) に入っている
  reportDiagnostics(input, res.diagnostics, args);
}

/**
 * 診断を標準エラーに書く。text: 1 件 1 行の「  警告 [名前] ファイル:行:列 (要素): 文」(重さで誤り・警告・知らせ。知らせは --verbose のときだけ)。
 * json: 1 件 1 行の JSON (入力のファイル input と、診断の欄。知らせも書く)。どちらも、文書の字 (制御文字) は見える形にする (printable)
 */
export function reportDiagnostics(input: string, ds: readonly Diagnostic[], args: Pick<Args, 'verbose' | 'diagnostics' | 'failOn'>): void {
  // --fail-on: その重さ以上の診断があったか (出さない診断 --ignore-warning は、組版の結果に入らないので数えない)
  if (args.failOn && ds.some((d) => d.severity === 'error' || (args.failOn === 'warning' && d.severity === 'warning'))) failOnHit = true;
  if (args.diagnostics === 'json') {
    // 制御文字・行の区切りは \uXXXX にするので、1 件は 1 行のまま (jsonLine)。JSON は 1 件ずつ (まとめない)
    for (const d of ds) console.warn(jsonLine({ input, ...d }));
    return;
  }
  for (const line of diagnosticTextLines(args.verbose ? ds : ds.filter((d) => d.severity !== 'info'))) console.warn(line);
}

/** 文字の出力で、1 つの名前につき 1 件 1 行で書く数 (超えた分は「ほかに n 件 (m 種)」の 1 行にまとめる) */
export const TEXT_LINES_PER_CODE = 20;

/**
 * 診断の文字の出力の行。並びは診断の順で、多いものは、ほかの警告が埋もれないようにまとめる:
 *  - 字形の無い字 (font/missing-glyph。字ごとの診断) は、多い順に TEXT_LINES_PER_CODE 字を並べた 1 行にし、残りは「ほか n 種」
 *  - ほかの名前は、TEXT_LINES_PER_CODE 行まで書き、残り (ライブラリが上限で省いた分も) を「同じ種類の…がほかに n 件 (m 種)」の 1 行にする
 * JSON の出力とライブラリの diagnostics は、1 件ずつのまま
 */
export function diagnosticTextLines(ds: readonly Diagnostic[]): string[] {
  const byCode = new Map<string, Diagnostic[]>();
  for (const d of ds) byCode.set(d.code, [...(byCode.get(d.code) ?? []), d]);
  const lines: string[] = [];
  const done = new Set<string>();
  for (const d of ds) {
    if (done.has(d.code)) continue;
    const all = byCode.get(d.code)!;
    const omitted = all.filter(isOmittedDiagnostic);
    const items = all.filter((x) => !isOmittedDiagnostic(x));
    // 上限で省いた分 (omitted・omittedKinds) を、まとめの数に足す
    const extra = omitted.reduce((a, o) => [a[0]! + Number(o.args!.omitted), a[1]! + Number(o.args!.omittedKinds)], [0, 0]);
    if (d.code === 'font/missing-glyph' && items.length + omitted.length > 1) {
      done.add(d.code);
      lines.push(missingGlyphLine(items, extra[1]!));
      continue;
    }
    if (all.length <= TEXT_LINES_PER_CODE && !omitted.length) {
      lines.push(diagnosticLine(d));
      continue;
    }
    // 多い名前は、まとめて書く (初めに現れた所に)
    done.add(d.code);
    const shown = items.slice(0, TEXT_LINES_PER_CODE);
    const rest = items.slice(TEXT_LINES_PER_CODE);
    for (const x of shown) lines.push(diagnosticLine(x));
    const n = rest.reduce((a, x) => a + (x.count ?? 1), 0) + extra[0]!;
    const kinds = rest.length + extra[1]!;
    if (n) lines.push(omittedLine(d, n, kinds));
  }
  return lines;
}

/** 字形の無い字の 1 行 (多い順に TEXT_LINES_PER_CODE 字。omittedKinds はライブラリが上限で省いた字の種類の数) */
function missingGlyphLine(items: readonly Diagnostic[], omittedKinds: number): string {
  const chars = items
    .map((d, i) => ({ ch: String(d.args?.char ?? ''), cp: String(d.args?.codePoint ?? ''), n: d.count ?? 1, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i);
  const head = chars.slice(0, TEXT_LINES_PER_CODE).map((c) => `${c.ch} (${c.cp}${c.n > 1 ? ` ×${c.n}` : ''})`).join(msg('、', ', '));
  const more = chars.length - TEXT_LINES_PER_CODE + omittedKinds;
  const rest = more > 0 ? msg(` (多い順に ${TEXT_LINES_PER_CODE} 字) ほか ${more} 種`, ` (the ${TEXT_LINES_PER_CODE} most frequent) and ${more} more`) : '';
  return printable(
    `  ${severityLabel('error')} [font/missing-glyph] ${msg('読み込んだどの書体にも字形の無い字があります (字形の無い字の形で出ます)', 'no loaded font has a glyph for these characters (they are drawn as the missing-glyph box)')}: ${head}${rest}`,
  );
}

/** まとめた残りの 1 行 */
function omittedLine(d: Diagnostic, n: number, kinds: number): string {
  const ja = severityLabel(d.severity);
  return printable(
    `  ${ja} [${d.code}] ${msg(
      `同じ種類の${ja}がほかに ${n} 件 (${kinds} 種) あります (--diagnostics json では 1 件ずつ書きます)`,
      `${n} more ${d.severity === 'info' ? 'notice' : d.severity}${n === 1 ? '' : 's'} of the same kind (${kinds} distinct; --diagnostics json prints them one by one)`,
    )}`,
  );
}

/** 重さの呼び名 (誤り・警告・知らせ) */
function severityLabel(s: Diagnostic['severity']): string {
  return s === 'error' ? msg('誤り', 'error') : s === 'warning' ? msg('警告', 'warning') : msg('知らせ', 'info');
}

/**
 * 組めずに止まった誤りの、--diagnostics json の 1 行の中身。診断の行と同じ欄 (input・code・severity・message・args・source) に、
 * 誤りの型の名前 (name) を足し、重さを fatal にする。Kumiori の誤り (isKumioriError) でないもの (ファイルが無いなど) は code を持たない
 */
export function fatalRecord(input: string, e: unknown): { input: string; name: string; code?: string; severity: 'fatal'; message: string; args?: unknown; source?: unknown } {
  if (!(e instanceof Error)) return { input, name: 'Error', severity: 'fatal', message: String(e) };
  const k = isKumioriError(e) ? e : undefined;
  return {
    input,
    name: e.name,
    ...(k ? { code: k.code } : {}),
    severity: 'fatal',
    message: e.message,
    ...(k && 'args' in k && k.args ? { args: k.args } : {}),
    ...(k && 'source' in k && k.source ? { source: k.source } : {}),
  };
}

/** --fail-on に当たる診断があったか (全部の入力を組んだ後に、終了コード 2 にする) */
let failOnHit = false;

/** 診断の 1 行 (テキスト) */
export function diagnosticLine(d: Diagnostic): string {
  const label = severityLabel(d.severity);
  const s = d.source;
  const at = s?.file !== undefined ? `${s.file}${s.line !== undefined ? `:${s.line}${s.column !== undefined ? `:${s.column}` : ''}` : ''}` : '';
  const where = [at, s?.element !== undefined ? `(${s.element})` : '', s?.page !== undefined ? msg(`(${s.page + 1} ページ目)`, `(page ${s.page + 1})`) : ''].filter(Boolean).join(' ');
  const times = d.count !== undefined && d.count > 1 ? msg(` (${d.count} 件)`, ` (${d.count} times)`) : '';
  return printable(`  ${label} [${d.code}]${where ? ` ${where}:` : ''} ${d.message}${times}`);
}

/**
 * 1 つの入力を組んで、ページを SVG か PNG にする (--format svg|png)。文書が 1 ページなら output に、複数ページならページごとに -<番号> を
 * 付けた名前に書く (pageFile。--pages で 1 ページだけ選んでも番号を付ける)。標準出力 (-) には、書くページが 1 つのときだけ書ける
 */
async function convertToPages(input: string, output: string, args: Args, text: string, docOptions: TypesetOptions, format: 'svg' | 'png', read: ReadonlySet<string>, settleReads: () => void) {
  const label = format.toUpperCase();
  const res = await typeset(text, docOptions);
  // 文書に無いページを指した範囲があれば、何も書かずに誤りにする (指したページを黙って落とさない)
  const missing = missingPageRanges(args.pages, res.pageCount);
  if (missing.length) {
    const list = missing.map((r) => (r.to === r.from ? `${r.from}` : `${r.from}-${r.to ?? ''}`)).join(',');
    throw new Error(msg(`--pages の ${list} は文書にありません (文書は ${res.pageCount} ページ)`, `--pages ${list} is not in the document (it has ${res.pageCount} page${res.pageCount === 1 ? '' : 's'})`));
  }
  const pages = selectPages(args.pages, res.pageCount);
  if (!pages.length) throw new Error(msg(`--pages のページがありません (文書は ${res.pageCount} ページ)`, `no page matches --pages (the document has ${res.pageCount} page${res.pageCount === 1 ? '' : 's'})`));
  // ファイルの名前は、選んだページの数によらず、文書が複数ページなら番号を付ける (--pages 2 も a-2.svg。何ページ目かが名前で分かり、
  // 選び方を変えても同じページは同じ名前になる)
  const many = pages.length > 1;
  const numbered = res.pageCount > 1;
  if (many && output === '-') throw new Error(msg(`${label} を標準出力に書けるのは、1 ページだけのときです (--pages で 1 ページを選んでください)`, `${label} can be written to standard output only for a single page (choose one page with --pages)`));
  // 書く前に、書くページのファイルの名前をまとめて確かめる (文書の使う画像・入力・この実行の別の出力を上書きしない。1 枚も書かずに誤りにする)
  settleReads();
  if (output !== '-') checkOutputFiles(pages.map((p) => pageFile(output, p, res.pageCount, numbered, `.${format}`)), input, read);
  const names: string[] = [];
  for (const p of pages) {
    // SVG は、1 つの HTML に並べて入れても id がぶつからないように、id の頭にページの番号を付ける
    const data = format === 'svg' ? await res.renderPageToSvg(p, { idPrefix: `p${p + 1}-` }) : await res.renderPageToPng(p, args.dpi !== undefined ? { dpi: args.dpi } : {});
    if (output === '-') process.stdout.write(data);
    else {
      const file = pageFile(output, p, res.pageCount, numbered, `.${format}`);
      writeOutput(file, input, data);
      names.push(path.basename(file));
    }
  }
  const log = reportLog(output);
  const target = output === '-' ? msg('(標準出力)', '(stdout)') : printable(names.length > 1 ? `${names[0]} … ${names[names.length - 1]}` : names[0]);
  log(msg(`${target}: ${pages.length} ページを ${label} に書きました (文書は ${res.pageCount} ページ。組版 ${res.layoutMs}ms)`, `${target}: wrote ${pages.length} page${pages.length === 1 ? '' : 's'} as ${label} (the document has ${res.pageCount} page${res.pageCount === 1 ? '' : 's'}; layout ${res.layoutMs}ms)`));
  reportDiagnostics(input, res.diagnostics, args);
}

/**
 * ファイルを比べるための鍵: 実体のパス (シンボリックリンク・. と .. をたどり、大文字と小文字を区別しない機械では実際の綴り)。
 * 無いファイルは、ディレクトリの実体のパスと名前。Windows では大文字と小文字を区別しないので、小文字にそろえる
 */
export function pathKey(p: string): string {
  const abs = path.resolve(p);
  let key: string;
  try {
    key = fs.realpathSync.native(abs);
  } catch {
    try {
      key = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs));
    } catch {
      key = abs;
    }
  }
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/**
 * 既にあるファイルの、機械の中の実体の鍵 (装置と i ノードの番号。'id:<dev>:<ino>')。道 (pathKey) が違っても同じ中身を指すもの
 * (ハードリンク。ln a.html hard.pdf の hard.pdf) を見分ける。無いファイル・読めないものは無し。fd を渡せば、開いているファイル (標準入力) の鍵
 */
export function fileIdKeys(p: string | number): string[] {
  try {
    const st = typeof p === 'number' ? fs.fstatSync(p, { bigint: true }) : fs.statSync(p, { bigint: true });
    // 端末・パイプなどの、ファイルでないものは比べない (i ノードの番号が使い回される)
    return st.isFile() && st.ino !== 0n ? [`id:${st.dev}:${st.ino}`] : [];
  } catch {
    return [];
  }
}

/**
 * --drawio-stencils で渡したファイル (ディレクトリなら、その下の、図形ライブラリとして読むファイル: drawio/nodeFiles.ts の stencilFiles と同じ拡張子)。
 * 出力でこれらを上書きしない (--drawio-stencils st -o st/x.svg で、st の下のファイルを書き直していた)
 */
function stencilPaths(values: readonly string[]): string[] {
  return values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean).flatMap((p) => {
    try {
      return fs.statSync(p).isDirectory() ? listFiles(p).filter((f) => /\.(xml|js|svg|png|jpe?g)$/i.test(f)) : [p];
    } catch {
      return [p];
    }
  });
}

/** --plugin で読むモジュールのファイル (道か file: の URL で見つかったもの)。出力でこれらを上書きしない */
function pluginPaths(args: Args): string[] {
  return args.plugins.flatMap(({ spec }) => {
    try {
      const { url } = resolvePlugin(spec);
      return url && url.startsWith('file:') ? [fileURLToPath(url)] : [];
    } catch {
      return [];
    }
  });
}

/** 入力の、ディレクトリの実体の道と名前 (シンボリックリンクのファイルそのものは、たどらない)。同じ入力をまとめる鍵 */
function sameDirKey(p: string): string {
  const abs = path.resolve(p);
  let dir = path.dirname(abs);
  try {
    dir = fs.realpathSync.native(dir);
  } catch {
    // 無いディレクトリは、そのまま
  }
  const key = path.join(dir, path.basename(abs));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/** 読む関数 readFile を包み、読めた file: の URL のファイルを note に知らせる */
export function notingReads(readFile: (url: string) => Uint8Array | undefined, note: (file: string) => void): (url: string) => Uint8Array | undefined {
  return (url) => {
    const data = readFile(url);
    if (data) {
      try {
        note(fileURLToPath(url));
      } catch {
        // 道にできない URL は、読めていない
      }
    }
    return data;
  };
}

/** 大文字と小文字を区別しないファイルシステムが既定の機械 (macOS・Windows) */
const CASELESS_FS = process.platform === 'darwin' || process.platform === 'win32';

/** この実行の入力の道 (実体の鍵は checkOutputFiles が確かめるたびに取り直す) と、標準入力の元のファイルの実体の鍵 (起動のときの fd 0) */
export const inputPaths: string[] = [];
export const stdinIds: string[] = [];
/** この実行の入力 (pathKey)。main が変換の前に入れる */
export const inputFiles = new Set<string>();
/** この実行で書いた出力 (pathKey → その出力を書いた入力)。--watch で、書いた出力の変更を見張りから外すのにも使う */
export const writtenFiles = new Map<string, string>();

/**
 * 書く先 files が、上書きしてはいけないファイルでないかを確かめる (どれかがそうなら、1 つも書かずに誤り)。上書きしてはいけないのは、
 * この変換で読んだファイル read (入力・文書が参照した画像・CSS・書体・引数のファイル。<img src="fig.svg"> の文書を --format svg で組むと、
 * 出力の fig.svg が画像を消していた)、この実行の入力 (-o one.html で入力を PDF にしていた)、この実行で別の入力から書いた出力
 * (a.html の a-2.svg を、後の入力の出力で消していた)。--watch で同じ入力を組み直して、前の出力を書き直すのはよい
 */
export function checkOutputFiles(files: readonly string[], input: string, read: ReadonlySet<string>): void {
  for (const f of files) {
    const key = pathKey(f);
    const name = printable(path.basename(f));
    // 道のほかに、既にあるファイルは実体の鍵でも比べる (ハードリンクの別名で、入力や読んだ画像を上書きしない)
    const ids = fileIdKeys(f);
    // 入力の実体の鍵は、確かめるたびに取り直す (--watch で、エディタが新しいファイルに書いて名前を変える保存をすると、入力の i ノードが
    // 変わり、前の番号を、書き直した出力が受け継ぐことがある。起動のときに 1 度だけ覚えると、毎回この誤りになっていた)
    const inputIds = new Set([...stdinIds, ...inputPaths.flatMap((p) => fileIdKeys(p))]);
    if (read.has(key) || inputFiles.has(key) || ids.some((id) => read.has(id) || inputIds.has(id))) {
      throw new Error(msg(`書く先 ${name} は、この変換で読むファイル (入力か、文書の使う画像・CSS など) です。上書きしません (-o で別の名前を書いてください)`, `the output ${name} is a file this conversion reads (an input, or an image, CSS file, etc. used by the document); it is not overwritten (give another name with -o)`));
    }
    // 書いた出力は、道と、書いた後の実体の鍵で覚えてある (大文字と小文字を区別しない Linux のファイルシステム (casefold・vfat・SMB) では、
    // A.pdf と a.pdf の道は違っても同じファイル)
    const by = [key, ...ids].map((k) => writtenFiles.get(k)).find((x) => x !== undefined);
    if (by !== undefined && by !== pathKey(input)) {
      throw new Error(msg(`書く先 ${name} は、この実行で別の入力 (${printable(path.basename(by))}) から書いた出力です。上書きしません (入力ごとに別の -o を書くか、別々に組んでください)`, `the output ${name} was already written from another input (${printable(path.basename(by))}) in this run; it is not overwritten (give each input its own -o, or run them separately)`));
    }
  }
}

/**
 * 2 つの stat が同じものを指すか (装置と i ノードの番号)。i ノードの番号が 0 のもの (Windows の端末・パイプの fstat など) は比べない
 * (fileIdKeys と同じ守り。両方 0 で同じものと見なさない)
 */
export function sameStatTarget(a: { dev: bigint; ino: bigint }, b: { dev: bigint; ino: bigint }): boolean {
  return a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
}

/**
 * 変換の報告を書く先: 出力が標準出力 (-) か、標準出力と同じもの (-o /dev/stdout > out.pdf、-o /dev/stdout | cat) なら標準エラー
 * (標準出力に書くと、書いた PDF の先頭を報告の行で上書きして壊していた)。ほかは標準出力
 */
function reportLog(output: string): (...a: unknown[]) => void {
  if (output === '-') return console.error;
  // ファイルの種類を問わずに、装置と i ノードの番号を比べる (パイプの /dev/stdout も: -o /dev/stdout | cat > p.pdf で、報告の行が PDF の
  // 末尾に付いていた)。どちらも今開いている同じものを見るので、番号の使い回しで取り違えることは無い
  try {
    const a = fs.fstatSync(1, { bigint: true });
    const b = fs.statSync(output, { bigint: true });
    return sameStatTarget(a, b) ? console.error : console.log;
  } catch {
    return console.log;
  }
}

/** 出力を書き、書いたことを覚える (writtenFiles) */
function writeOutput(file: string, input: string, data: Uint8Array | string): void {
  writtenFiles.set(pathKey(file), pathKey(input));
  fs.writeFileSync(file, data);
  for (const id of fileIdKeys(file)) writtenFiles.set(id, pathKey(input));
}

/** --watch で見張るファイル */
const WATCHED = /\.(x?html?|fo|xml|xsl|css|png|jpe?g|gif|svgz?|webp|tiff?|bmp|emf|wmf|eps|cgm|drawio|dio|mml|ttf|otf|ttc|otc|woff2?)$/i;

/** 使い方の文 (日英) に出てくるオプションの名前 (--print・-o など)。parseArgs が、値の所に置かれたオプションを見分けるのに使う */
let optionNameSet: Set<string> | undefined;
function optionNames(): Set<string> {
  return (optionNameSet ??= new Set(`${USAGE_JA}\n${USAGE_EN}`.match(/(?<![\w-])--?[a-zA-Z][\w-]*/g) ?? []));
}

/** 引数の誤り (使い方を表示して終わる。スタックトレースは出さない) */
export class UsageError extends Error {}

/** 使い方 (--help と、使い方の誤りのときに出す)。日本語 */
export const USAGE_JA = [
  '使い方: kumiori <HTML ファイル> [-o|--output <PDF ファイル>] [--format pdf|svg|png] [--pages <範囲>] [--dpi <値>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--page-size <用紙>] [--svg-lang <ja,en>] [--css a.css,b.css] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <書体ファイル>]... [--generic-font <総称>=<書体名>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4 [--output-profile <ICC>] [--output-condition <名前>]] [--pdfa 2b|3b] [--tagged|--no-tagged] [--pdfua] [--document-lang <言語>] [--no-fetch-images] [--no-fetch-styles] [--no-outside-files] [--low-memory] [--link-schemes <a,b>] [--link-launch] [--link-relative file|uri] [--drawio-stencils <files>] [--fetch-drawio-stencils] [--drawio-stencils-url <URL>] [--no-drawio] [--plugin <module> [--plugin-option <k=v>]...]... [--xhtml] [--watch] [--lang ja|en]',
  '        kumiori <FO ファイル> [-o|--output <PDF ファイル>] [--format pdf|svg|png] [--pages <範囲>] [--dpi <値>] [--fo] [--compat spec|antenna] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <書体ファイル>]... [--generic-font <総称>=<書体名>] [--svg-lang <ja,en>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4 [--output-profile <ICC>] [--output-condition <名前>]] [--pdfa 2b|3b] [--tagged|--no-tagged] [--pdfua] [--document-lang <言語>] [--no-fetch-images] [--no-outside-files] [--low-memory] [--link-schemes <a,b>] [--link-launch] [--link-relative file|uri] [--drawio-stencils <files>] [--fetch-drawio-stencils] [--drawio-stencils-url <URL>] [--no-drawio] [--plugin <module> [--plugin-option <k=v>]...]... [--watch] [--lang ja|en]',
  '        kumiori a.html b.fo … -o <出力先のディレクトリ>',
  '        kumiori - -o - [--base <dir>] < 入力 > 出力.pdf',
  '        kumiori --help | --version',
  '',
  '  -o, --output <PDF>        出力の PDF (--format svg・png では SVG・PNG。入力が複数か、既にあるディレクトリか、/ で終わるときは出力先のディレクトリ (ディレクトリにするのは、標準入力のときは使えない)。- は標準出力)',
  '  --format pdf|svg|png      出力の形式 (既定 pdf。-o の拡張子が .svg・.png ならその形式。-o がディレクトリのときは拡張子を見ない)。svg・png はページごとに書く (字は書体の輪郭、画像は埋め込み。複数ページの文書は、1 ページだけ選んでも <名前>-<番号>.svg。-o の拡張子と食い違う形式は誤り)',
  '  --pages <範囲>            SVG・PNG に書くページ (1 から数える。1-3,5,7- のように , で区切る。既定はすべて)',
  '  --dpi <値>                PNG の解像度 (1 インチあたりの画素の数。既定 96)',
  '  --style <名前>            HTML の既定のスタイル (kumiori・browser・browser-margin・ah・vivliostyle・weasyprint。既定 kumiori)',
  '  --page-size <用紙>        HTML の既定の用紙 (@page で size を指定していない文書の用紙。A5・"A5 landscape"・148mm,210mm など。既定 A4)',
  '  --svg-lang <ja,en>        SVG の systemLanguage を照らす言語 (SVG を置いた所に言語の指定が無いとき。既定は実行環境の言語)',
  '  --css a.css,b.css         使う CSS (HTML から参照されていないものは利用者のスタイルシートとして足す。指定が無ければ、HTML が参照する CSS だけを使う)',
  '  --font-dir <dir>          既定の書体 (NotoSerifJP-Regular.ttf など) を読むディレクトリ (無ければキャッシュ、次に Google Fonts から取る)',
  '  --font-cache <dir>        Google Fonts から取った既定の書体を保存して使い回すディレクトリ (既定は環境変数 KUMIORI_FONT_CACHE か OS のキャッシュ:',
  '                            Linux は $XDG_CACHE_HOME か ~/.cache の kumiori/fonts、macOS は ~/Library/Caches/kumiori/fonts、Windows は %LOCALAPPDATA%\\kumiori\\fonts)',
  '  --no-font-cache           書体のキャッシュを読まず、保存もしない (毎回 Google Fonts から取る)',
  '  --font <書体ファイル>     書体を足す (TTF・OTF・TTC・WOFF・WOFF2。可変フォントは font-weight などに合う形で組む。何度でも)',
  '  --generic-font <総称>=<書体名>  総称の書体に使う書体 (serif・sans-serif・monospace は欧文、serif-cjk・sans-serif-cjk は和文。何度でも)',
  '  --compat spec|antenna     XSL-FO の既定値の流儀 (XSL-FO 1.1 の初期値 / アンテナハウスに合わせる。既定 spec)',
  '  --fo                      拡張子によらず XSL-FO として読む',
  '  --xhtml                   拡張子によらず XML の構文 (XHTML) で読む',
  '  --print                   トンボと塗り足し (3mm) を付ける',
  '  --spot-colors <JSON>      特色の名前と代わりの CMYK',
  '  --image-max-dpi <dpi>     JPEG の解像度の上限',
  '  --pdfx x1a|x1a:2003|x3|x4 入稿用の PDF/X-1a:2001・PDF/X-1a:2003・PDF/X-3:2003・PDF/X-4 の印を付ける (RGB は CMYK にする。ページの中のリンク・注釈・フォームの欄と、動作 (しおりの外への飛び先など) は書かない。x1a・x3 は透明を平らにする (一部を画像にすることがある))',
  '  --output-profile <ICC>    出力の CMYK の ICC プロファイル (PDF/X。x4 では必須で出力機器 (prtr) のもの。x1a は AtoB1 の表 (A2B1) を持つもの)',
  '  --output-condition <名前>  印刷条件の名前 (既定 JC200103。ICC の登録簿に無い名前なら、x1a でも --output-profile が要る)',
  '  --tagged                  タグ付き PDF にする (既定。見出し・段落・リスト・図・リンク・表・脚注の構造、読む順、図の代わりの文、言語を入れる。--pdfx x1a・x3 とは使えない。指定しなければ、x1a・x3 ではタグを付けない)',
  '  --no-tagged               タグを付けない (0.4 までの既定と同じ PDF)',
  '  --pdfua                   PDF/UA-1 の印を付ける (--tagged を含む。XMP の pdfuaid・DisplayDocTitle を書き、字形の無い字を描かない。題・言語・図と数式の代わりの文・見出しの順の足りないものを警告に出す)',
  '  --document-lang <言語>     文書の言語 (ja・en-US など。入力に言語が無いときだけ使う)',
  '  --pdfa 2b|3b              長期保存用の PDF/A-2b・PDF/A-3b の印を付ける (出力意図は sRGB。ファイルを開く動作・フォームの欄は書かない。2b は添付ファイルを埋め込まない。--pdfx と合わせるときは --output-profile が要る)',
  '  --no-fetch-images         文書が http(s) で参照する画像を取らない',
  '  --no-fetch-styles         文書が http(s) で参照する CSS を取らない',
  '  --no-outside-files        文書が file: の URL や ../ で指した、入力のディレクトリの外のファイルを読まない (他人の書いた文書を組むとき)',
  '  --low-memory              メモリを節約して組む (組み直しで前の回のページを使い回さない。数千ページの文書でメモリが 4 割ほど、時間は 1.5 倍ほど)',
  '  --link-schemes <a,b>      PDF に動作を書くリンクの URL のスキーム (既定 http,https,mailto,tel。* はすべて。ほかのスキームのリンクは字だけを組む)',
  '  --link-launch             ファイルを開く動作のリンク (PDF でない相対のファイル・絶対パス・//host/…) も PDF に書く (既定は書かない)',
  '  --link-relative <file|uri> スキームの無い相対のリンク (x.pdf・a.mp3) の書き方。file: ファイルを開く動作 (GoToR・Launch。既定)、uri: 書かれた参照のままの URI の動作 (ブラウザの中の PDF ビューアでも開ける)',
  '  --drawio-stencils <files> draw.io の図の図形ライブラリ (stencils.min.js・ライブラリの XML) と配布物の画像。ファイルかディレクトリを , で区切る (何度でも)',
  '  --fetch-drawio-stencils   draw.io の図に要る図形ライブラリ・画像が無ければ、draw.io の配布物 (v24.7.5) から取る (書体のキャッシュの場所に保存する)',
  '  --drawio-stencils-url <URL> 取り先の stencils.min.js の URL (--fetch-drawio-stencils も付けたことになる)',
  '  --no-drawio               draw.io の図 (.drawio・.dio) を画像として読まない',
  '  --plugin <モジュール>     プラグインを読み込む (./・../・絶対の道・file: の URL はファイル。ほかはパッケージの名前で探し、読めなければ今のディレクトリのファイル。何度でも。信頼できるものだけ)',
  '  --plugin-option <名前=値> その前の --plugin に渡す選択肢 (何度でも)',
  '  --base <dir>              標準入力の文書の CSS・画像・書体を探すディレクトリ (既定は今のディレクトリ)',
  '  --watch                   入力のディレクトリの変更を見張って組み直す (Ctrl+C で終わる)',
  '  --verbose                 知らせ (重さ info の診断。選択肢で止めた取得など) も書く',
  '  --diagnostics text|json   診断の書き方 (既定 text。json は 1 件 1 行の JSON で、知らせも書く)。どちらも標準エラーに書く',
  '  --ignore-warning <名前>   その名前の診断を出さない (css/unknown-property など。, で区切る・何度でも。知らない名前は警告して続ける)',
  '  --fail-on error|warning   その重さ以上の診断があれば、出力を書いた上で終了コード 2 で終わる (出さない診断は数えない)',
  '  --lang ja|en              文言の言語 (無ければ環境変数 KUMIORI_LANG、OS のロケール (LC_ALL・LC_MESSAGES・LANG) の順。既定は日本語)',
  '  -h, --help                この使い方を書いて終わる',
  '  -v, --version             版を書いて終わる',
  '',
  '  未対応の CSS・XSL-FO の指定、読めない画像などは、「警告 [名前] ファイル:行:列: 文」の形で標準エラー (-o - のときも) に出ます',
  '  (重さで 誤り・警告・知らせ。名前の一覧は docs/diagnostics.md)。',
].join('\n');

/** 使い方。英語 */
export const USAGE_EN = [
  'Usage: kumiori <HTML file> [-o|--output <PDF file>] [--format pdf|svg|png] [--pages <range>] [--dpi <value>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--page-size <size>] [--svg-lang <ja,en>] [--css a.css,b.css] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <font file>]... [--generic-font <generic>=<family>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4 [--output-profile <ICC>] [--output-condition <name>]] [--pdfa 2b|3b] [--tagged|--no-tagged] [--pdfua] [--document-lang <lang>] [--no-fetch-images] [--no-fetch-styles] [--no-outside-files] [--low-memory] [--link-schemes <a,b>] [--link-launch] [--link-relative file|uri] [--drawio-stencils <files>] [--fetch-drawio-stencils] [--drawio-stencils-url <URL>] [--no-drawio] [--plugin <module> [--plugin-option <k=v>]...]... [--xhtml] [--watch] [--lang ja|en]',
  '       kumiori <FO file> [-o|--output <PDF file>] [--format pdf|svg|png] [--pages <range>] [--dpi <value>] [--fo] [--compat spec|antenna] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <font file>]... [--generic-font <generic>=<family>] [--svg-lang <ja,en>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--pdfx x1a|x1a:2003|x3|x4 [--output-profile <ICC>] [--output-condition <name>]] [--pdfa 2b|3b] [--tagged|--no-tagged] [--pdfua] [--document-lang <lang>] [--no-fetch-images] [--no-outside-files] [--low-memory] [--link-schemes <a,b>] [--link-launch] [--link-relative file|uri] [--drawio-stencils <files>] [--fetch-drawio-stencils] [--drawio-stencils-url <URL>] [--no-drawio] [--plugin <module> [--plugin-option <k=v>]...]... [--watch] [--lang ja|en]',
  '       kumiori a.html b.fo … -o <output directory>',
  '       kumiori - -o - [--base <dir>] < input > output.pdf',
  '       kumiori --help | --version',
  '',
  '  -o, --output <PDF>        output PDF (SVG or PNG with --format svg or png; the output directory when there are several inputs, when it is an existing directory or when it ends with / (a directory is not allowed with standard input); - is standard output)',
  '  --format pdf|svg|png      output format (default pdf; svg or png when -o ends with .svg or .png, unless -o is a directory). svg and png write each page (text as glyph outlines, images embedded; a document of several pages goes to <name>-<number>.svg, even when one page is chosen; a format that does not match the -o extension is an error)',
  '  --pages <range>           pages to write as SVG or PNG (1-based, separated by commas such as 1-3,5,7-; default all)',
  '  --dpi <value>             PNG resolution (pixels per inch; default 96)',
  '  --style <name>            default style sheet for HTML (kumiori, browser, browser-margin, ah, vivliostyle, weasyprint; default kumiori)',
  '  --page-size <size>        default paper for HTML (used when the document has no @page size; A5, "A5 landscape", 148mm,210mm, etc.; default A4)',
  '  --svg-lang <ja,en>        languages to match SVG systemLanguage against (when the place of the SVG has no language; default: the environment language)',
  '  --css a.css,b.css         CSS files to use (ones not referenced by the HTML are added as user style sheets; without it, only CSS referenced by the HTML is used)',
  '  --font-dir <dir>          directory of the default fonts (NotoSerifJP-Regular.ttf etc.; otherwise the cache, then Google Fonts)',
  '  --font-cache <dir>        directory where default fonts fetched from Google Fonts are saved and reused (default: KUMIORI_FONT_CACHE or the OS cache:',
  '                            kumiori/fonts under $XDG_CACHE_HOME or ~/.cache on Linux, ~/Library/Caches/kumiori/fonts on macOS, %LOCALAPPDATA%\\kumiori\\fonts on Windows)',
  '  --no-font-cache           do not read or write the font cache (fetch from Google Fonts every time)',
  '  --font <font file>        add a font (TTF, OTF, TTC, WOFF, WOFF2; a variable font is used at the shape matching font-weight etc.; repeatable)',
  '  --generic-font <generic>=<family>  font used for a generic family (serif, sans-serif, monospace: Latin text; serif-cjk, sans-serif-cjk: Japanese text; repeatable)',
  '  --compat spec|antenna     XSL-FO default-value convention (XSL-FO 1.1 initial values / AH Formatter compatible; default spec)',
  '  --fo                      read as XSL-FO regardless of the extension',
  '  --xhtml                   read with XML syntax (XHTML) regardless of the extension',
  '  --print                   add trim marks and 3mm bleed',
  '  --spot-colors <JSON>      spot color names and fallback CMYK',
  '  --image-max-dpi <dpi>     resolution limit for JPEG images',
  '  --pdfx x1a|x1a:2003|x3|x4 write PDF/X-1a:2001, PDF/X-1a:2003, PDF/X-3:2003 or PDF/X-4 markers for print submission (RGB is converted to CMYK; links, annotations and form fields on the pages and actions (such as external bookmark destinations) are not written; x1a and x3 flatten transparency, rasterizing some areas if needed)',
  '  --output-profile <ICC>    output CMYK ICC profile (PDF/X; required for x4, and must be an output device (prtr) profile; for x1a it must have an AtoB1 table (A2B1))',
  '  --output-condition <name>  printing condition name (default JC200103; a name not in the ICC registry needs --output-profile even for x1a)',
  '  --tagged                  write tagged PDF (the default; structure of headings, paragraphs, lists, figures, links, tables and footnotes, reading order, alternate text for figures, language; not with --pdfx x1a or x3; when not given, no tags are added for x1a and x3)',
  '  --no-tagged               do not add tags (the same PDF as the default up to 0.4)',
  '  --pdfua                   write PDF/UA-1 markers (implies --tagged; writes the XMP pdfuaid and DisplayDocTitle, does not draw characters with no glyph, and warns about a missing title, language, alternate text for figures and formulas, and heading order)',
  '  --document-lang <lang>    document language (such as ja or en-US; used only when the input has none)',
  '  --pdfa 2b|3b              write PDF/A-2b or PDF/A-3b markers for long-term archiving (sRGB output intent; Launch actions and form fields are not written; 2b does not embed attachments; combining with --pdfx needs --output-profile)',
  '  --no-fetch-images         do not fetch images the document references over http(s)',
  '  --no-fetch-styles         do not fetch stylesheets the document references over http(s)',
  '  --no-outside-files        do not read files outside the input directory that the document points at with file: URLs or ../ (for documents written by others)',
  '  --low-memory              typeset with less memory (re-layouts do not reuse the pages of the previous pass; about 40% of the memory for documents of thousands of pages, about 1.5 times the time)',
  '  --link-schemes <a,b>      URL schemes whose links get an action in the PDF (default http,https,mailto,tel; * means all; other links are typeset as plain text)',
  '  --link-launch             also write links that open a file (relative non-PDF files, absolute paths, //host/…) to the PDF (off by default)',
  '  --link-relative <file|uri> how scheme-less relative links (x.pdf, a.mp3) are written: file = open-file actions (GoToR/Launch; default), uri = a URI action with the reference as written (works in browser PDF viewers)',
  '  --drawio-stencils <files> shape libraries (stencils.min.js or library XML) and distributed images for draw.io diagrams; files or directories separated by , (repeatable)',
  '  --fetch-drawio-stencils   fetch the shape libraries and images a draw.io diagram needs from draw.io (v24.7.5) when they are missing (saved in the font cache directory)',
  '  --drawio-stencils-url <URL> the URL of the stencils.min.js to fetch (implies --fetch-drawio-stencils)',
  '  --no-drawio               do not read draw.io diagrams (.drawio, .dio) as images',
  '  --plugin <module>         load a plugin (./, ../, absolute paths and file: URLs are files; others are looked up as a package name, then as a file in the current directory; repeatable; only ones you trust)',
  '  --plugin-option <name=value> an option passed to the preceding --plugin (repeatable)',
  '  --base <dir>              directory where CSS, images and fonts of a document read from standard input are looked up (default: current directory)',
  '  --watch                   watch the input directories and re-typeset on changes (Ctrl+C to stop)',
  '  --verbose                 also print notices (diagnostics of severity info, such as fetches turned off by options)',
  '  --diagnostics text|json   how to print diagnostics (default text; json prints one JSON object per line, notices included). Both go to standard error',
  '  --ignore-warning <code>   do not report diagnostics with that code (such as css/unknown-property; comma-separated, repeatable; unknown codes are warned about)',
  '  --fail-on error|warning   exit with code 2 after writing the output when there is a diagnostic of that severity or worse (suppressed ones are not counted)',
  '  --lang ja|en              language of messages (otherwise KUMIORI_LANG, then the OS locale (LC_ALL, LC_MESSAGES, LANG); default Japanese)',
  '  -h, --help                print this usage and exit',
  '  -v, --version             print the version and exit',
  '',
  '  Unsupported CSS/XSL-FO, unreadable images and the like are reported on standard error (also with -o -) as "warning [code] file:line:column: text"',
  '  (error, warning or info by severity; the codes are listed in docs/en/diagnostics.md).',
].join('\n');

/** 今の言語の使い方 */
export function usage(): string {
  return msg(USAGE_JA, USAGE_EN);
}

/** 互換のため (日本語の使い方) */
export const USAGE = USAGE_JA;

/** 版 (package.json の version。dist-cli/cli.js の隣の package.json から読む。読めなければ unknown) */
export function cliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const p of [path.join(here, '..', 'package.json'), path.join(here, 'package.json')]) {
      if (!fs.existsSync(p)) continue;
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'kumiori' && pkg.version) return pkg.version;
    }
  } catch {
    // 読めなければ unknown
  }
  return 'unknown';
}

/** 1 つの変換 (入力のファイルと出力の PDF。'-' は標準入力・標準出力) */
export interface Job {
  input: string;
  output: string;
}

/**
 * 入力と -o から、変換の組 (入力 → 出力の PDF) を決める。
 *  - 入力が複数なら -o は出力先のディレクトリ (無ければ各入力の隣に .pdf)。入力が 1 つでも、-o が既存のディレクトリならその中に <入力名>.pdf
 *  - 入力が 1 つで、-o が / (か path.sep) で終わるときは、ディレクトリと見なす。あればその中に <入力名>.pdf、無いか、ファイルなら UsageError
 *    (path.resolve が末尾の / を落とすので、そのままでは拡張子の無い名前のファイルを書いてしまう)
 *  - 出力の名前がぶつかるとき (別のディレクトリの同じ名前の入力を、1 つの出力先へ) は、後のものに -2・-3 … を付ける
 *  - 組み合わせの誤り (標準入力とほかの入力、--watch と標準入力、複数の入力と -o -、複数の入力と既にあるファイルの -o、標準入力と、/ で終わるかディレクトリの -o) は UsageError
 */
export function planJobs(args: Pick<Args, 'inputs' | 'output' | 'watch'> & { format?: Args['format'] }, isDir: (p: string) => boolean = existingDir, exists: (p: string) => boolean = existingPath, notes?: string[], caseless = CASELESS_FS): Job[] {
  const outKey = (o: string) => (caseless ? o.toLowerCase() : o);
  // 同じ入力を何度も渡したら (a.html a.html、./a.html a.html など、同じディレクトリの同じ名前)、1 度だけ組み、知らせる
  const seenIn = new Map<string, string>();
  const inputs = args.inputs.filter((inp) => {
    if (inp === '-') return true;
    // 同じ入力かは、ディレクトリの実体と名前が同じときだけ (./a.html と a.html、d/../a.html など)。別のディレクトリのシンボリックリンク・
    // ハードリンクの別名は、出力の名前と置き場 (入力の隣) も、相対の参照の基準も違うので、別の入力として組む。大文字と小文字はそろえない
    // (区別するボリュームの、中身の違う A.html と a.html をまとめない)
    const keys = [sameDirKey(inp)];
    const first = keys.map((k) => seenIn.get(k)).find((x) => x !== undefined);
    if (first !== undefined) {
      notes?.push(msg(`${printable(inp)}: 同じ入力 (${printable(first)}) を何度も渡したので、1 度だけ組みます`, `${printable(inp)}: the same input (${printable(first)}) was given more than once; it is typeset only once`));
      return false;
    }
    for (const k of keys) seenIn.set(k, inp);
    return true;
  });
  const many = inputs.length > 1;
  // -o をディレクトリと見なすか (と、既にあるファイルの誤り・ディレクトリを作るか) は、まとめる前の、渡した入力の数で決める
  // (a.html a.html -o outdir で、outdir という拡張子の無いファイルに書いていた。グロブの *.html index.html -o build も)
  const manyGiven = args.inputs.length > 1;
  if (many && inputs.includes('-')) throw new UsageError(msg("標準入力 ('-') は、ほかの入力と一緒に使えません", "standard input ('-') cannot be combined with other inputs"));
  if (args.watch && inputs.includes('-')) throw new UsageError(msg('--watch は、標準入力と一緒に使えません', '--watch cannot be used with standard input'));
  if (many && args.output === '-') throw new UsageError(msg('入力が複数のとき、-o - (標準出力) は使えません', '-o - (standard output) cannot be used with several inputs'));
  const dirLike = args.output !== undefined && endsWithSep(args.output);
  if (manyGiven && args.output !== undefined && args.output !== '-' && !isDir(args.output) && exists(args.output)) {
    // 入力が複数なら -o は出力先のディレクトリ。既にあるファイルを渡すと、ディレクトリを作るところで EEXIST・ENOTDIR になるので、先に知らせる
    throw new UsageError(msg(`入力が複数のとき、-o は出力先のディレクトリです。ファイルは使えません: ${printable(args.output)} (ディレクトリの名前を書いてください)`, `with several inputs, -o is the output directory and cannot be a file: ${printable(args.output)} (give a directory name)`));
  }
  if (!many && inputs[0] === '-' && args.output !== undefined && args.output !== '-' && (dirLike || isDir(args.output))) {
    // 標準入力の文書には名前が無いので、ディレクトリの中に置く <入力名>.pdf を決められない (書き込みの ENOENT・EISDIR で止めずに、先に知らせる)
    throw new UsageError(msg(`標準入力 ('-') の文書には名前が無いので、-o にディレクトリは使えません: ${printable(args.output)} (-o にファイルの名前を書いてください。例: -o out.pdf)`, `a document read from standard input ('-') has no name, so -o cannot be a directory: ${printable(args.output)} (give a file name to -o, for example -o out.pdf)`));
  }
  if (!manyGiven && dirLike && inputs[0] !== '-' && !isDir(args.output!)) {
    if (exists(args.output!)) {
      throw new UsageError(msg(`-o はディレクトリではありません (ファイルです): ${printable(args.output!)} (/ で終わる -o はディレクトリと見なします。ファイルに書くときは、末尾の / を外してください)`, `-o is not a directory (it is a file): ${printable(args.output!)} (an -o ending with / is taken as a directory; drop the trailing / to write to the file)`));
    }
    throw new UsageError(msg(`-o のディレクトリがありません: ${printable(args.output!)} (/ で終わる -o はディレクトリと見なします。先にディレクトリを作るか、ファイルの名前を書いてください)`, `the -o directory does not exist: ${printable(args.output!)} (an -o ending with / is taken as a directory; create the directory first, or give a file name)`));
  }
  const outDir = args.output !== undefined && args.output !== '-' && (manyGiven || isDir(args.output)) ? args.output : undefined;
  // 出力の名前の比べ: 大文字と小文字を区別しないファイルシステム (macOS・Windows の既定) では、A.pdf と a.pdf を同じ名前と見なす
  const usedOut = new Set<string>();
  return inputs.map((inp) => {
    if (inp === '-') return { input: '-', output: args.output ?? '-' };
    const input = path.resolve(inp);
    const ext = args.format === 'svg' ? '.svg' : args.format === 'png' ? '.png' : '.pdf';
    const name = path.basename(input).replace(/\.(x?html?|fo|xml)$/i, '') + ext;
    let output = args.output === '-' ? '-' : outDir !== undefined ? path.resolve(outDir, name) : path.resolve(args.output ?? path.join(path.dirname(input), name));
    if (output !== '-') {
      // 名前がぶつかったら、後のものは入力の名前を拡張子ごと残す (a.html と a.fo なら a.svg と a.fo.svg)。それでもぶつかれば (別のディレクトリの
      // 同じ名前) .2・.3 … を足す (a.html.2.svg)。-<番号> にしないのは、複数ページの SVG・PNG のページの名前 (a-2.svg) と重ならないため
      if (usedOut.has(outKey(output))) {
        const full = path.join(path.dirname(output), path.basename(input));
        output = full + ext;
        for (let k = 2; usedOut.has(outKey(output)); k++) output = `${full}.${k}${ext}`;
      }
      usedOut.add(outKey(output));
    }
    return { input, output };
  });
}

async function main() {
  setMessageLang(detectMessageLang(process.env));
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    // 誤りの文には引数の字がそのまま入るので、制御文字 (ESC など) は見える形にする (端末を操る字を書かない)
    console.error(printable(e.message));
    args = { ...parseArgs([]), inputs: [] };
  }
  if (args.version) {
    console.log(cliVersion());
    return;
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.inputs.length) {
    console.error(usage());
    process.exit(1);
  }
  const planNotes: string[] = [];
  const jobs = planJobs(args, existingDir, existingPath, planNotes);
  for (const job of jobs) {
    // 標準入力は、元のファイル (kumiori - -o one.html < one.html の one.html) を実体の鍵で覚える
    if (job.input !== '-') {
      inputFiles.add(pathKey(job.input));
      inputPaths.push(job.input);
    } else stdinIds.push(...fileIdKeys(0));
  }
  for (const n of planNotes) console.error(n);
  // 入力が複数なら -o は出力先のディレクトリ (無ければ作る)
  // (同じ入力をまとめて 1 つになっても、渡した入力が複数なら、-o はディレクトリ)
  if (args.inputs.length > 1 && args.output && args.output !== '-') fs.mkdirSync(args.output, { recursive: true });
  const run = async (job: Job) => {
    try {
      // 文字の符号化は BOM・XML 宣言・<meta charset> で決める (UTF-8 固定にしない)
      const text = decodeDocumentText(new Uint8Array(job.input === '-' ? fs.readFileSync(0) : fs.readFileSync(job.input)));
      await convert(job.input, job.output, args, text);
      return true;
    } catch (e) {
      // --diagnostics json では、組めずに止まった誤りも、診断と同じ形の JSON の 1 行にする (重さは fatal)
      if (args.diagnostics === 'json') console.error(jsonLine(fatalRecord(job.input, e)));
      else console.error(`${job.input === '-' ? msg('(標準入力)', '(stdin)') : printable(path.basename(job.input))}: ${errorText(e)}`);
      return false;
    }
  };
  // 組み終える前に、することが無くなって Node が終わろうとしたら (終わらない Promise を返すプラグインなど。待つものが無いので、
  // そのままでは何も言わずに終了コード 0 で終わり、PDF も出ない)、誤りとして知らせて 1 で終わる
  let finished = false;
  process.once('beforeExit', () => {
    if (finished) return;
    console.error(msg('組み終える前に処理が止まりました (読み込んだプラグインが終わらないなど)。PDF は書いていません', 'processing stopped before typesetting finished (for example, a loaded plugin never completed); no PDF was written'));
    process.exitCode = 1;
  });
  let ok = true;
  for (const job of jobs) ok = (await run(job)) && ok;
  finished = true;
  if (!args.watch) {
    // 組めなかった入力があれば 1、--fail-on に当たる診断があれば 2 (出力は書いてある)
    if (!ok) process.exitCode = 1;
    else if (failOnHit) process.exitCode = 2;
    return;
  }
  // --watch: 入力のディレクトリの変更を見張り、少し待ってから、そのディレクトリの入力を組み直す (書き出した PDF の変更は見ない)。
  // 同じディレクトリの入力は 1 つの見張りにまとめ、組み直しは全体で 1 本に直列化する (同時に走らない)
  const outputs = new Set(jobs.map((j) => j.output));
  // プラグインの画像の形式の拡張子のファイルも見張る (draw.io の .drawio・.dio は WATCHED にある)
  // プラグインを読めない (見つからない・読み込みで誤りが出た) のは使い方の誤り: 文は組んだとき (run) に出してあるので、ここでは
  // もう一度出さずに、見張らないで終了コード 1 で終わる (覚えてある失敗の Promise を受け手なしに await すると、スタックトレースを出して終わっていた)
  let plugins: KumioriPlugin[] = [];
  try {
    if (args.plugins.length) plugins = await loadPlugins(args);
  } catch {
    process.exitCode = 1;
    return;
  }
  const pluginExts = plugins.flatMap((p) => p.imageFormats ?? []).flatMap((f) => f.extensions.map((e) => e.toLowerCase().replace(/[^a-z0-9]/g, ''))).filter(Boolean);
  const pluginWatched = pluginExts.length ? new RegExp(`\\.(?:${pluginExts.join('|')})$`, 'i') : undefined;
  let running = Promise.resolve();
  const byDir = new Map<string, Job[]>();
  for (const job of jobs) byDir.set(path.dirname(job.input), [...(byDir.get(path.dirname(job.input)) ?? []), job]);
  for (const [dir, dirJobs] of byDir) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (_ev: string, file: string | Buffer | null) => {
      // 組版に関わるファイル (HTML・FO・CSS・画像・書体) だけ。書き出した PDF・node_modules・. で始まるものは見ない
      const f = file?.toString();
      if (!f || outputs.has(path.resolve(dir, f)) || writtenFiles.has(pathKey(path.resolve(dir, f))) || /(^|[\\/])(node_modules|\.)/.test(f) || !(WATCHED.test(f) || pluginWatched?.test(f))) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = running.then(async () => {
          for (const job of dirJobs) await run(job);
        });
      }, 300);
    };
    try {
      fs.watch(dir, { recursive: true }, onChange);
    } catch (e) {
      // 下のディレクトリまで見張れない環境 (Node 20 より前の Linux など) では、入力のディレクトリだけを見張る
      if ((e as NodeJS.ErrnoException).code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw e;
      console.error(msg(`${dir}: 下のディレクトリの変更は見張れません (Node 20 以上で使えます)`, `${dir}: changes in subdirectories cannot be watched (needs Node 20 or later)`));
      fs.watch(dir, onChange);
    }
  }
  console.error(msg('変更を見張っています (Ctrl+C で終わる)', 'watching for changes (Ctrl+C to stop)'));
}

type Args = ReturnType<typeof parseArgs>;

/** コマンドとして動かされたときだけ main を実行する (テストが parseArgs・planJobs を読み込んでも動かさない) */
const isEntry = (() => {
  try {
    // Windows ではドライブ名などの大文字小文字が揺れるので、揃えて比べる
    const norm = (p: string) => (process.platform === 'win32' ? fs.realpathSync(p).toLowerCase() : fs.realpathSync(p));
    return !!process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((e) => {
    // 使い方の誤りは、スタックトレース無しで知らせる
    if (e instanceof UsageError) console.error(printable(e.message));
    else console.error(e);
    process.exit(1);
  });
}
