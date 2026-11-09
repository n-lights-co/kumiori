/**
 * cli — HTML+CSS を、ブラウザを使わずに PDF に組む (Node のコマンド)。
 *
 * 使い方 (npm run build:cli の後):
 *   node dist-cli/cli.js <HTML ファイル> [-o <PDF ファイル>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--css a.css,b.css]
 *                        [--font-dir <ディレクトリ>] [--font <書体ファイル>]... [--generic-font serif|sans-serif=<書体名>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--xhtml] [--watch]
 *   node dist-cli/cli.js <FO ファイル (.fo・.xml)> [-o <PDF ファイル>] [--compat spec|antenna] [--font-dir <ディレクトリ>] [--font <書体ファイル>]... [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--watch]
 *   node dist-cli/cli.js a.html b.fo c.html -o <出力先のディレクトリ>      (まとめて変換)
 *   cat a.html | node dist-cli/cli.js - -o - [--base <ディレクトリ>] > a.pdf  (標準入力から読み、標準出力へ書く)
 *
 *  - HTML は linkedom で読み、CSS の計算値は自前のカスケード (cssCascade) で決める (画面の「CSS の解釈: Kumiori」と同じ)
 *  - HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・書体を、画面の「開く」で一緒に選んだのと同じに使う。
 *    画像は、文書と CSS (と、そこから参照された SVG) に名前が出てくるものだけを読む。
 *    --css は使う CSS ファイルを選ぶ (HTML から参照されていない CSS は、利用者のスタイルシートとして足す)
 *  - 既定の書体 (Noto Serif JP・Noto Sans JP・Tinos・Arimo。等幅の指定があれば Cousine、MathML があれば STIX Two Math、どの書体にも無い記号があれば Noto Sans Symbols 2) は、
 *    --font-dir に同じ名前のファイル (NotoSerifJP-Regular.ttf など) があれば
 *    そこから、無ければ Google Fonts から読む
 *  - XSL-FO (.fo・.xml、または --fo) は xmldom で読み、画面の XSL-FO の読み込みと同じに組む。--compat は既定値の流儀
 *    (spec: XSL-FO 1.1 の初期値 (既定) / antenna: アンテナハウスに合わせる)。同じディレクトリの書体ファイルは、FO の font-family から使う
 *  - --print: トンボと塗り足し (3mm) を付ける
 *  - --xhtml: 拡張子によらず、HTML を XML の構文 (XHTML) で読む (アンテナハウスのコマンドの -f XHTML に当たる。接頭辞の付いた m:math・s:svg も、名前空間に従って MathML・SVG になる)
 *  - 入力が複数なら、-o は出力先のディレクトリ (無ければ各入力の隣に .pdf)。1 つの失敗でほかの変換は止めない (終了コードは 1)。
 *    入力が 1 つでも、-o が既存のディレクトリなら、その中に <入力名>.pdf を書く
 *  - 入力の文字の符号化は、BOM と XML 宣言の encoding (Shift_JIS・EUC-JP など)・HTML の <meta charset> で決める (無ければ UTF-8)
 *  - --no-fetch-images: 文書が http(s) で参照する画像をネットワークから取らない (既定は取る。他人の文書をサーバーで組むときに)
 *  - --no-fetch-styles: 文書が http(s) で参照する CSS (<link>・@import) をネットワークから取らない (既定は取る)
 *  - 文書・CSS が file: の URL で参照するファイル (file:///…/style.css など) は、そのファイルを読む
 *  - '-' は標準入力から読む (CSS・画像・書体は --base のディレクトリ (既定は今のディレクトリ) から。FO かどうかは中身で見分ける)。
 *    -o - は PDF を標準出力へ書く (報告は標準エラーへ)
 *  - --watch: 入力のディレクトリの変更を見張り、変わるたびに組み直す (Ctrl+C で終わる)
 *  - --image-max-dpi <dpi>: 置かれる大きさに対してこれより細かい JPEG の写真を、この解像度に縮めて符号化し直す (PDF を小さくする。既定は元のまま)
 *  - --spot-colors <JSON ファイル>: 特色の名前と、濃度 100% の代わりの CMYK ({"名前": "cmyk(94%,34%,60%,82%)"} か {"名前": [0.94,0.34,0.6,0.82]})。
 *    rgb-icc(…, #Separation, '名前', 濃度) を、PDF の特色 (Separation) にする。無い名前は、代わりの RGB で塗る
 *  - 既定の書体は 1 度だけ読み、変換ごとに使い回す。読む順は --font-dir → 書体のキャッシュ → ネットワーク (Google Fonts)。
 *    ネットワークから取った書体はキャッシュに保存し、次からはネットワークに行かない。キャッシュの場所は --font-cache <dir>、
 *    環境変数 KUMIORI_FONT_CACHE、OS のキャッシュ ディレクトリ (Linux: $XDG_CACHE_HOME か ~/.cache の kumiori/fonts、
 *    macOS: ~/Library/Caches/kumiori/fonts、Windows: %LOCALAPPDATA%\kumiori\fonts) の順。--no-font-cache で使わない
 *  - --help (-h) は使い方、--version (-v) は版を標準出力に書いて終わる (終了コード 0)
 *  - 文言の言語: --lang ja|en → 環境変数 KUMIORI_LANG → OS のロケール (LC_ALL・LC_MESSAGES・LANG が en… なら英語)。既定は日本語 (messages.ts)
 *  - 未対応の CSS・XSL-FO の指定は、黙って無視せずに「警告:」で知らせる (typeset の warnings)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { parseColor } from './color';
import type { HtmlDefaults } from './htmlPrepare';
import { FO_COMPATS, HTML_STYLES, type FoCompat } from './compat';
import { isXhtmlFile } from './xhtml';
import { decodeDocumentText, typeset, type KumioriFile } from './api';
import { createFileResolver, defaultFontCacheDir, FETCH_TIMEOUT_MS, localFont } from './nodeFonts';
// テストと、これまで cli から読んでいた利用者のために出し直す
export { defaultFontCacheDir, localFont, looksLikeFont } from './nodeFonts';
import { MESSAGE_LANGS, detectMessageLang, messageLang, msg, setMessageLang, type MessageLang } from './messages';

// テストなどが使う (中身は api.ts)
export { fixImplicitStructure, wrapHtml } from './api';

/** コマンドの引数 (テストのために出す) */
export function parseArgs(argv: string[]) {
  const out: {
    inputs: string[];
    output?: string;
    style: HtmlDefaults;
    css?: string;
    fontDir?: string;
    /** 書体のキャッシュのディレクトリ (--font-cache。無ければ KUMIORI_FONT_CACHE か OS のキャッシュ) */
    fontCache?: string;
    /** --no-font-cache: キャッシュを読まず、保存もしない */
    noFontCache: boolean;
    /** 足す書体のファイル (--font。システムに入れた書体のように、書体のファミリー名・太さで使う) */
    fontFiles: string[];
    /** 総称の書体 (serif・sans-serif) の欧文に使う書体のファミリー名 (--generic-font serif=<名前>。CSS Fonts 4 §2.1.3: 総称の書体の割り当ては UA が決める) */
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
    /** JPEG の解像度の上限 (dpi) */
    imageMaxDpi?: number;
    /** 文書が http(s) で参照する画像をネットワークから取る (--no-fetch-images で止める) */
    fetchImages: boolean;
    /** 文書が http(s) で参照する CSS をネットワークから取る (--no-fetch-styles で止める) */
    fetchStyles: boolean;
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
    return v;
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-o' || a === '--output') out.output = value(k++);
    else if (a === '--style') {
      const v = value(k++);
      // 使える値は公開 API と同じ (compat.ts の HTML_STYLES)
      if (!(HTML_STYLES as readonly string[]).includes(v)) throw new UsageError(msg(`--style の値 "${v}" は使えません (${HTML_STYLES.join('・')})`, `--style cannot be "${v}" (${HTML_STYLES.join(', ')})`));
      out.style = v as HtmlDefaults;
    }
    else if (a === '--css') out.css = value(k++);
    else if (a === '--font-dir') out.fontDir = value(k++);
    else if (a === '--font-cache') out.fontCache = value(k++);
    else if (a === '--no-font-cache') out.noFontCache = true;
    else if (a === '--font') out.fontFiles.push(value(k++));
    else if (a === '--generic-font') {
      const v = value(k++);
      const m = /^(serif|sans-serif)=(.+)$/.exec(v);
      if (!m) throw new UsageError(msg(`--generic-font の値 "${v}" は使えません (serif=<書体名> か sans-serif=<書体名>)`, `--generic-font cannot be "${v}" (serif=<family> or sans-serif=<family>)`));
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
    else if (a === '--base') out.base = value(k++);
    else if (a === '--spot-colors') out.spotColors = readSpotColors(value(k++));
    else if (a === '--image-max-dpi') {
      const v = value(k++);
      const n = Number(v);
      if (!(n >= 1) || !Number.isFinite(n)) throw new UsageError(msg(`--image-max-dpi の値 "${v}" は使えません (1 以上の数)`, `--image-max-dpi cannot be "${v}" (a number of 1 or more)`));
      out.imageMaxDpi = n;
    }
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
  return out;
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

/** 1 つの入力を PDF にする。input が '-' なら標準入力 (text に中身)、output が '-' なら標準出力 */
async function convert(input: string, output: string, args: Args, text: string) {
  const stdin = input === '-';
  const dir = stdin ? path.resolve(args.base ?? '.') : path.dirname(input);
  // node_modules と . で始まるディレクトリは見ない
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const onlyCss = args.css ? new Set(args.css.split(',').map((c) => path.basename(c).toLowerCase())) : undefined;
  const all = walk(dir).filter((f) => f !== input);
  // --css で選んだ CSS が @import する CSS も使う
  for (const name of onlyCss ?? []) {
    const file = all.find((f) => path.basename(f).toLowerCase() === name);
    if (file) for (const m of fs.readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) onlyCss!.add(path.basename(m[1]).toLowerCase());
  }
  const chosen = all.filter((f) => !/\.css$/i.test(f) || !onlyCss || onlyCss.has(path.basename(f).toLowerCase()));
  // --css に入力のディレクトリの外のファイルを書いたら、そのファイルを読む。どこにも無ければ誤り
  const outside: string[] = [];
  for (const c of args.css?.split(',').map((x) => x.trim()).filter(Boolean) ?? []) {
    const inDir = all.some((f) => path.basename(f).toLowerCase() === path.basename(c).toLowerCase());
    const p = path.resolve(c);
    if (!all.includes(p) && fs.existsSync(p) && fs.statSync(p).isFile()) outside.push(p);
    else if (!inDir && !fs.existsSync(p)) throw new Error(msg(`--css のファイルが見つかりません: ${c}`, `--css file not found: ${c}`));
  }
  // ファイルは使うときだけ読む。名前は入力のディレクトリからの相対パス (ディレクトリの外のものはファイル名)
  const lazy = (p: string, name: string): KumioriFile => ({ name, data: async () => fs.readFileSync(p) });
  const files = [...chosen.map((p) => lazy(p, path.relative(dir, p).split(path.sep).join('/'))), ...outside.map((p) => lazy(p, path.basename(p)))];
  const kind = args.fo ? 'fo' : !stdin && /\.(fo|xml)$/i.test(input) ? 'fo' : args.xhtml || (!stdin && isXhtmlFile(input)) ? 'xhtml' : stdin ? undefined : 'html';
  const res = await typeset(text, {
    ...(kind ? { kind } : {}),
    files,
    fonts: args.fontFiles.map((f) => lazy(f, path.basename(f))),
    genericFonts: args.genericFonts,
    style: args.style,
    compat: args.compat,
    print: args.print,
    fetchImages: args.fetchImages,
    fetchStyles: args.fetchStyles,
    // file: の URL の参照は、そのファイルを読む (入力のディレクトリの外でも。ブラウザで手元の HTML を開いたときと同じ)
    resolveResource: createFileResolver(),
    ...(args.spotColors ? { spotColors: args.spotColors } : {}),
    loadFont: localFont(args.fontDir, args.noFontCache ? undefined : args.fontCache ? path.resolve(args.fontCache) : defaultFontCacheDir()),
    lang: messageLang(),
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    // 圧縮は Node の zlib (ネイティブ) で行う (pdf-lib の pako より速い)
    deflate: (b) => deflateSync(b),
  });
  const pdf = await res.toPdf(args.imageMaxDpi ? { imageMaxDpi: args.imageMaxDpi } : {});
  if (output === '-') process.stdout.write(pdf);
  else fs.writeFileSync(output, pdf);
  // PDF を標準出力へ書くときは、報告は標準エラーへ
  const log = output === '-' ? console.error : console.log;
  const target = output === '-' ? msg('(標準出力)', '(stdout)') : path.basename(output);
  log(msg(`${target}: ${res.pageCount} ページ (組版 ${res.layoutMs}ms)`, `${target}: ${res.pageCount} page${res.pageCount === 1 ? '' : 's'} (layout ${res.layoutMs}ms)`));
  for (const w of res.warnings) console.warn(msg(`  警告: ${w}`, `  warning: ${w}`));
}

/** --watch で見張るファイル */
const WATCHED = /\.(x?html?|fo|xml|xsl|css|png|jpe?g|gif|svgz?|webp|tiff?|bmp|emf|wmf|eps|cgm|mml|ttf|otf|ttc|otc)$/i;

/** 引数の誤り (使い方を表示して終わる。スタックトレースは出さない) */
export class UsageError extends Error {}

/** 使い方 (--help と、使い方の誤りのときに出す)。日本語 */
export const USAGE_JA = [
  '使い方: kumiori <HTML ファイル> [-o|--output <PDF ファイル>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--css a.css,b.css] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <書体ファイル>]... [--generic-font serif|sans-serif=<書体名>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--no-fetch-images] [--no-fetch-styles] [--xhtml] [--watch] [--lang ja|en]',
  '        kumiori <FO ファイル> [-o|--output <PDF ファイル>] [--fo] [--compat spec|antenna] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <書体ファイル>]... [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--no-fetch-images] [--watch]',
  '        kumiori a.html b.fo … -o <出力先のディレクトリ>',
  '        kumiori - -o - [--base <dir>] < 入力 > 出力.pdf',
  '        kumiori --help | --version',
  '',
  '  -o, --output <PDF>        出力の PDF (入力が複数なら出力先のディレクトリ。- は標準出力)',
  '  --style <名前>            HTML の既定のスタイル (kumiori・browser・browser-margin・ah・vivliostyle・weasyprint。既定 kumiori)',
  '  --css a.css,b.css         使う CSS (HTML から参照されていないものは利用者のスタイルシートとして足す)',
  '  --font-dir <dir>          既定の書体 (NotoSerifJP-Regular.ttf など) を読むディレクトリ (無ければキャッシュ、次に Google Fonts から取る)',
  '  --font-cache <dir>        Google Fonts から取った既定の書体を保存して使い回すディレクトリ (既定は環境変数 KUMIORI_FONT_CACHE か OS のキャッシュ:',
  '                            Linux は ~/.cache/kumiori/fonts、macOS は ~/Library/Caches/kumiori/fonts、Windows は %LOCALAPPDATA%\\kumiori\\fonts)',
  '  --no-font-cache           書体のキャッシュを読まず、保存もしない (毎回 Google Fonts から取る)',
  '  --font <書体ファイル>     書体を足す (TTF・OTF・TTC。何度でも)',
  '  --generic-font serif=<書体名> | sans-serif=<書体名>   総称の書体の欧文に使う書体',
  '  --compat spec|antenna     XSL-FO の既定値の流儀 (XSL-FO 1.1 の初期値 / アンテナハウスに合わせる。既定 spec)',
  '  --fo                      拡張子によらず XSL-FO として読む   --xhtml  拡張子によらず XML の構文 (XHTML) で読む',
  '  --print                   トンボと塗り足し (3mm) を付ける',
  '  --spot-colors <JSON>      特色の名前と代わりの CMYK      --image-max-dpi <dpi>  JPEG の解像度の上限',
  '  --no-fetch-images         文書が http(s) で参照する画像を取らない',
  '  --no-fetch-styles         文書が http(s) で参照する CSS を取らない',
  '  --base <dir>              標準入力の文書の CSS・画像・書体を探すディレクトリ (既定は今のディレクトリ)',
  '  --watch                   入力のディレクトリの変更を見張って組み直す (Ctrl+C で終わる)',
  '  --lang ja|en              文言の言語 (無ければ環境変数 KUMIORI_LANG、OS のロケール (LANG) の順。既定は日本語)',
  '  -h, --help                この使い方を書いて終わる      -v, --version  版を書いて終わる',
  '',
  '  未対応の CSS・XSL-FO の指定、読めない画像などは「警告:」として標準エラー (-o - のときも) に出ます。',
].join('\n');

/** 使い方。英語 */
export const USAGE_EN = [
  'Usage: kumiori <HTML file> [-o|--output <PDF file>] [--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint] [--css a.css,b.css] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <font file>]... [--generic-font serif|sans-serif=<family>] [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--no-fetch-images] [--no-fetch-styles] [--xhtml] [--watch] [--lang ja|en]',
  '       kumiori <FO file> [-o|--output <PDF file>] [--fo] [--compat spec|antenna] [--font-dir <dir>] [--font-cache <dir>|--no-font-cache] [--font <font file>]... [--print] [--spot-colors <JSON>] [--image-max-dpi <dpi>] [--no-fetch-images] [--watch]',
  '       kumiori a.html b.fo … -o <output directory>',
  '       kumiori - -o - [--base <dir>] < input > output.pdf',
  '       kumiori --help | --version',
  '',
  '  -o, --output <PDF>        output PDF (a directory when there are several inputs; - is standard output)',
  '  --style <name>            default style sheet for HTML (kumiori, browser, browser-margin, ah, vivliostyle, weasyprint; default kumiori)',
  '  --css a.css,b.css         CSS files to use (ones not referenced by the HTML are added as user style sheets)',
  '  --font-dir <dir>          directory of the default fonts (NotoSerifJP-Regular.ttf etc.; otherwise the cache, then Google Fonts)',
  '  --font-cache <dir>        directory where default fonts fetched from Google Fonts are saved and reused (default: KUMIORI_FONT_CACHE or the OS cache:',
  '                            ~/.cache/kumiori/fonts on Linux, ~/Library/Caches/kumiori/fonts on macOS, %LOCALAPPDATA%\\kumiori\\fonts on Windows)',
  '  --no-font-cache           do not read or write the font cache (fetch from Google Fonts every time)',
  '  --font <font file>        add a font (TTF, OTF, TTC; repeatable)',
  '  --generic-font serif=<family> | sans-serif=<family>   font used for Latin text of the generic families',
  '  --compat spec|antenna     XSL-FO default-value convention (XSL-FO 1.1 initial values / AH Formatter compatible; default spec)',
  '  --fo                      read as XSL-FO regardless of the extension   --xhtml  read with XML syntax (XHTML) regardless of the extension',
  '  --print                   add trim marks and 3mm bleed',
  '  --spot-colors <JSON>      spot color names and fallback CMYK      --image-max-dpi <dpi>  resolution limit for JPEG images',
  '  --no-fetch-images         do not fetch images the document references over http(s)',
  '  --no-fetch-styles         do not fetch stylesheets the document references over http(s)',
  '  --base <dir>              directory where CSS, images and fonts of a document read from standard input are looked up (default: current directory)',
  '  --watch                   watch the input directories and re-typeset on changes (Ctrl+C to stop)',
  '  --lang ja|en              language of messages (otherwise KUMIORI_LANG, then the OS locale (LANG); default Japanese)',
  '  -h, --help                print this usage and exit      -v, --version  print the version and exit',
  '',
  '  Unsupported CSS/XSL-FO, unreadable images and the like are reported as "warning:" on standard error (also with -o -).',
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
 *  - 出力の名前がぶつかるとき (別のディレクトリの同じ名前の入力を、1 つの出力先へ) は、後のものに -2・-3 … を付ける
 *  - 組み合わせの誤り (標準入力とほかの入力、--watch と標準入力、複数の入力と -o -) は UsageError
 */
export function planJobs(args: Pick<Args, 'inputs' | 'output' | 'watch'>, isDir: (p: string) => boolean = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory()): Job[] {
  const many = args.inputs.length > 1;
  if (many && args.inputs.includes('-')) throw new UsageError(msg("標準入力 ('-') は、ほかの入力と一緒に使えません", "standard input ('-') cannot be combined with other inputs"));
  if (args.watch && args.inputs.includes('-')) throw new UsageError(msg('--watch は、標準入力と一緒に使えません', '--watch cannot be used with standard input'));
  if (many && args.output === '-') throw new UsageError(msg('入力が複数のとき、-o - (標準出力) は使えません', '-o - (standard output) cannot be used with several inputs'));
  const outDir = args.output !== undefined && args.output !== '-' && (many || isDir(args.output)) ? args.output : undefined;
  const usedOut = new Set<string>();
  return args.inputs.map((inp) => {
    if (inp === '-') return { input: '-', output: args.output ?? '-' };
    const input = path.resolve(inp);
    const name = path.basename(input).replace(/\.(x?html?|fo|xml)$/i, '') + '.pdf';
    let output = args.output === '-' ? '-' : outDir !== undefined ? path.resolve(outDir, name) : path.resolve(args.output ?? path.join(path.dirname(input), name));
    if (output !== '-') {
      const base = output.replace(/\.pdf$/i, '');
      for (let k = 2; usedOut.has(output); k++) output = `${base}-${k}.pdf`;
      usedOut.add(output);
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
    console.error(e.message);
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
  const jobs = planJobs(args);
  // 入力が複数なら -o は出力先のディレクトリ (無ければ作る)
  if (args.inputs.length > 1 && args.output) fs.mkdirSync(args.output, { recursive: true });
  const run = async (job: Job) => {
    try {
      // 文字の符号化は BOM・XML 宣言・<meta charset> で決める (UTF-8 固定にしない)
      const text = decodeDocumentText(new Uint8Array(job.input === '-' ? fs.readFileSync(0) : fs.readFileSync(job.input)));
      await convert(job.input, job.output, args, text);
      return true;
    } catch (e) {
      console.error(`${job.input === '-' ? msg('(標準入力)', '(stdin)') : path.basename(job.input)}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  let ok = true;
  for (const job of jobs) ok = (await run(job)) && ok;
  if (!args.watch) {
    if (!ok) process.exitCode = 1;
    return;
  }
  // --watch: 入力のディレクトリの変更を見張り、少し待ってから、そのディレクトリの入力を組み直す (書き出した PDF の変更は見ない)。
  // 同じディレクトリの入力は 1 つの見張りにまとめ、組み直しは全体で 1 本に直列化する (同時に走らない)
  const outputs = new Set(jobs.map((j) => j.output));
  let running = Promise.resolve();
  const byDir = new Map<string, Job[]>();
  for (const job of jobs) byDir.set(path.dirname(job.input), [...(byDir.get(path.dirname(job.input)) ?? []), job]);
  for (const [dir, dirJobs] of byDir) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (_ev: string, file: string | Buffer | null) => {
      // 組版に関わるファイル (HTML・FO・CSS・画像・書体) だけ。書き出した PDF・node_modules・. で始まるものは見ない
      const f = file?.toString();
      if (!f || outputs.has(path.resolve(dir, f)) || /(^|[\\/])(node_modules|\.)/.test(f) || !WATCHED.test(f)) return;
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
    if (e instanceof UsageError) console.error(e.message);
    else console.error(e);
    process.exit(1);
  });
}
