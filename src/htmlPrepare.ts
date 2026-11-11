/**
 * htmlPrepare — HTML と一緒に選んだ CSS から、組む文書と文書の CSS を用意する (ブラウザと Node で共通。DOM のパーサーは渡す)。
 *
 *  - <script> は取り除く
 *  - <link rel="stylesheet"> は、一緒に選んだ CSS ファイルの中身を <style> にする (ファイル名で突き合わせる。参照から取った CSS は URL の全体で)。@import も中身に置き換える
 *  - 参照されていない CSS ファイルは、利用者のスタイルシートとして文書の CSS の後に足す (weasyprint -s と同じ)
 *  - 印刷の媒体として読む: screen だけの CSS は使わず、@media print の規則は常に効く
 *  - 既定のスタイル (HtmlDefaults) を作成者スタイルシート より前に入れる
 */
import { parsePageRule } from './htmlImport';
import { msg } from './messages';
import { concatCss, matchMedia, matchSupports, mediaDependsOnPageSize, mediaPageOf, parseCss, type ParsedCss } from './htmlPaged';
import { rebaseFontFaceUrls, resolveRef } from './resources';
import { ALL_AH } from './cssCascade';

/** 本の組版向けの既定のスタイル (作成者スタイルシート で上書きできる) */
export const KUMIORI_BOOK_CSS = `
html { font-size: 10pt; line-height: 1.75; hanging-punctuation: allow-end; }
body { margin: 0; font-family: serif; text-align: justify; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; line-height: 1.4; text-align: start; break-after: avoid; }
h1 { font-size: 1.6em; margin: 2em 0 1em; }
h2 { font-size: 1.3em; margin: 1.5em 0 0.75em; }
h3 { font-size: 1.1em; margin: 1.2em 0 0.5em; }
h4, h5, h6 { font-size: 1em; margin: 1em 0 0.3em; }
p { margin: 0; text-indent: 1em; }
ul, ol { margin: 0.5em 0; padding-left: 2em; }
li > p:first-child { text-indent: 0; }
blockquote { margin: 1em 2em; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 0.5pt solid #000; padding: 0.2em 0.5em; }
pre { font-size: 0.9em; line-height: 1.5; text-align: start; }
img { max-width: 100%; }
@page { @bottom-center { content: counter(page); font-size: 9pt; } }
`;

/** 印刷向けの既定 (ブラウザの既定のスタイルのうち、画面向けのものを打ち消す) */
export const PRINT_UA_CSS = `
body { margin: 0; }
`;

/**
 * 見出しのしおり: CSS GCPM 3 の付録 B「Default UA Stylesheet」(参考) の bookmark-level の規則。しおりの文 (bookmark-label) は
 * 初期値の content(text) (見出しの文字)。作成者スタイルシートで bookmark-level: none にすれば付かない。どの既定のスタイルにも入れる。
 * WeasyPrint の既定 (65.1 の css/html5_ua.css) も、h1〜h6 に同じ bookmark-level を付けている
 *
 * 規則は、取得した文書 (W3C Working Draft, 25 January 2024。https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/ 、2026-11-09 取得) から写した。
 * This software includes material copied from or derived from CSS Generated Content for Paged Media Module,
 * Appendix B: Default UA Stylesheet (https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/). Copyright © 2024 World Wide Web Consortium.
 * (THIRD_PARTY_NOTICES.md の 10 節)
 */
export const GCPM_BOOKMARK_CSS = `
h1 { bookmark-level: 1 }
h2 { bookmark-level: 2 }
h3 { bookmark-level: 3 }
h4 { bookmark-level: 4 }
h5 { bookmark-level: 5 }
h6 { bookmark-level: 6 }
`;

/**
 * CSS 2.1 の付録 D の既定のスタイルシート (--style ah の既定) のうち、ブラウザ (Chrome) の既定と違うもの。
 * 見出しの大きさ・余白、段落・リストの余白など。作成者スタイルシート より前に入れる (作成者スタイルシート で上書きできる)。
 * ただし ol・ul の字下げは、付録 D の margin-left: 40px ではなく padding-left: 2.5em にする (字の大きさに比例させ、字下げを
 * padding の側に置く。作成者スタイルシート で padding-left を指定すれば、その値だけ字下げする)。
 * figure (付録 D には無い要素) の左右の余白は 0 にする (図は本文の幅いっぱいに置く。ブラウザの既定の左右 40px の余白は付けない)
 * sub・sup は、付録 D に line-height の指定が無い (https://www.w3.org/TR/CSS2/sample.html 、2026-11-05 取得) ので、
 * ブラウザの既定 (WHATWG 15.3.4 の line-height: normal) を打ち消して、親の line-height を受け継ぐ
 *
 * 付録 D の規則は、取得した文書 (W3C Recommendation 07 June 2011, edited in place 12 April 2016 to point to new work,
 * edited in place 07 December 2021 to correct markup) から写し、上のとおり一部を変えた。
 * This software includes material copied from or derived from Cascading Style Sheets Level 2 Revision 1 (CSS 2.1) Specification,
 * Appendix D. Default style sheet for HTML 4 (https://www.w3.org/TR/2011/REC-CSS2-20110607/sample.html).
 * Copyright © 2011 W3C® (MIT, ERCIM, Keio), All Rights Reserved.
 * (ライセンスの本文は THIRD_PARTY_NOTICES.md の 9 節)
 */
export const CSS21_DEFAULT_CSS = `
h1 { font-size: 2em; margin: .67em 0; }
h2 { font-size: 1.5em; margin: .75em 0; }
h3 { font-size: 1.17em; margin: .83em 0; }
h4, p, blockquote, ul, fieldset, form, ol, dl, dir, menu { margin: 1.12em 0; }
h5 { font-size: .83em; margin: 1.5em 0; }
h6 { font-size: .75em; margin: 1.67em 0; }
h1, h2, h3, h4, h5, h6, b, strong { font-weight: bolder; }
th { font-weight: bolder; }
blockquote { margin-left: 40px; margin-right: 40px; }
big { font-size: 1.17em; }
small, sub, sup { font-size: .83em; }
sub, sup { line-height: inherit; }
table { border-spacing: 2px; }
hr { border: 1px inset; }
ol, ul, dir, menu, dd { margin-left: 40px; padding-left: 0; }
ol, ul { margin-left: 0; padding-left: 2.5em; }
ol ul, ul ol, ul ul, ol ol { margin-top: 0; margin-bottom: 0; }
figure { margin-left: 0; margin-right: 0; }
`;

/**
 * Vivliostyle の既定のスタイルのうち、ブラウザ (Chrome) の既定と違って組版に効くもの: 見出しの後ろで改ページしない。
 * (Vivliostyle.js 2.38.0 の UserAgentBaseCss で h1〜h6 が break-after: avoid であることを、npm の @vivliostyle/core 2.38.0 で確かめた)
 * 和欧間のアキ: Vivliostyle.js は text-autospace を自前で処理し、初期値 normal で和文と欧文・数字の間を空ける
 * (同じく 2.38.0 の text-polyfill。pre・code などは UserAgentBaseCss で text-spacing: none)
 */
export const VIVLIOSTYLE_UA_CSS = `
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
html { text-autospace: normal; }
pre, tt, code, kbd, samp { text-spacing: none; }
`;

/**
 * WeasyPrint の既定のスタイルのうち、ブラウザ (Chrome) の既定と違うもの: フォームの部品と fieldset。
 * フォームの部品は書体を親から受け継ぎ、字は 0.85 倍、罫線は 1px の黒、背景は無し。fieldset の罫線は文字の色の groove。
 * (WeasyPrint 65.1 の css/html5_ua.css で確かめた。PyPI の weasyprint 65.1)
 */
export const WEASYPRINT_UA_CSS = `
button, input, select, textarea { font-family: inherit; font-size: .85em; border: 1px solid black; padding: .2em; height: 1.2em; width: 20em; background-color: transparent; }
textarea { height: 3em; margin: .1em 0; }
fieldset { border: 2px groove currentColor; padding: .35em .625em .75em; }
`;

/**
 * browser-margin はブラウザの既定のまま、body の余白 (8px) も残す (ブラウザの印刷・WeasyPrint と同じ)。vivliostyle はブラウザの既定に、見出しの後ろの改ページの抑止を足す。
 * weasyprint は browser-margin に、WeasyPrint のフォームの部品の既定を足す
 */
export type HtmlDefaults = 'browser' | 'browser-margin' | 'kumiori' | 'ah' | 'vivliostyle' | 'weasyprint';

/** CSS のファイル (ブラウザの File と同じ形) */
export interface CssFile {
  name: string;
  text(): Promise<string>;
  /** 拡張子が .css でなくても CSS として読む (参照から取った CSS。https://fonts.googleapis.com/css2?family=… など) */
  css?: boolean;
  /**
   * 参照から取った CSS の、参照の URL の全体 (問い合わせの ?… も含む)。あれば、文書の <link>・@import とは、ファイル名でなくこの URL で突き合わせる
   * (css2?family=A と css2?family=B は、ファイル名は同じ css2 でも別の CSS)
   */
  url?: string;
  /** 文書からの相対パス (css/a.css)。CSS の中の相対の @import を、この CSS の場所を基準に解決するのに使う (CSS Values 4 §4.5.1) */
  path?: string;
}

export interface PreparedHtml {
  /** 用意の途中で出した警告 (深すぎる入れ子・多すぎる @import)。typeset の warnings と、画面の警告の欄に出す */
  warnings: string[];
  /** <style> に置き換えた文書 (既定のスタイルも先頭の <style>) */
  doc: Document;
  /** 文書の CSS の文字列 (既定のスタイル + <style> + 差し込んだ CSS ファイル)。@page・@font-face の読み取りに使う */
  css: string;
  /** 作成者スタイルシート だけ (<style> + 差し込んだ CSS ファイル)。カスケードの作成者の出どころ */
  authorCss: string;
  /** 既定のスタイル (--style の選択)。カスケードでは既定のスタイルシート (UA) の出どころにする (Cascade 5 §6.1) */
  uaCss: string;
  /** uaCss を parseCss で読んだもの (cascadeStyles の uaExtraCss に渡す。同じ CSS を読み直さない) */
  uaSheet: ParsedCss;
  /** authorCss を parseCss で読んだもの (cascadeStyles の作成者スタイルシート に渡す) */
  authorSheet: ParsedCss;
  /** css (文書の CSS 全体) を読んだもの (uaSheet と authorSheet を並べたもの。importHtml の sheet・@font-face の読み取りに渡す) */
  sheet: ParsedCss;
  /** 本文の領域の幅と高さ (px)。iframe の大きさ、vw・vh の基準 */
  bodyWidthPx: number;
  pageHeightPx: number;
}

/** %xx を戻す。不正な % の並び (100%.css など) は、そのままにする */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const basename = (s: string) => safeDecode(s.split(/[?#]/)[0].split('/').pop() ?? s).toLowerCase();

/**
 * @import で読み込む CSS の長さの合計の上限 (字の数。1 つの文書の、すべてのスタイルシートの @import の合計) と、@import の回数の上限。
 * CSS の仕様 (Cascade 5 §2) は @import の循環や回数を決めていない (§2.2 は、同じスタイルシートを何か所から読んでも、それぞれ別の
 * スタイルシートとして扱うとするだけ) ので、実装の上限として置く。循環していなくても、段ごとに同じファイルを何度も読めば、展開した
 * CSS は段の数の累乗で膨らむ。ふつうの文書の CSS (大きな枠組みの CSS でも数十万字) がまず届かない値にする
 */
export const MAX_IMPORTED_CSS_LENGTH = 8 * 1024 * 1024;
const MAX_IMPORTS = 10000;

/**
 * 要素の入れ子の深さの上限 (html 要素を 1 と数える)。HTML Living Standard §13.2.6「Tree construction」は、実装が実用上の理由から
 * 入れ子の深さに制限を置くことになるだろうと認めている (数は決めていない。Chromium・WebKit の HTML の構文解析器は 512 段)。
 * 読み込み (htmlImport.ts)・組版 (layoutEngine.ts) は要素の入れ子を再帰でたどるので、深い文書はスタックを使い切る。
 * Node の既定のスタック (984KB) で、1100 段の入れ子の文書をこの関数で抑え、カスケード → 読み込み → 組版 → 描画 (PDF・描画の命令) →
 * Area Tree の直列化と読み直しまで通して測った、スタックの切れる深さ (要素の段数。かっこの中は、通った最大の深さ):
 *  - カスケード (cssCascade.ts): 1024 段でも切れない
 *  - 読み込み: 縦並びの flex (flex-direction: column。1 段で 7 枠) は 288 段 (272 段)、flex・grid は 512 段、div・span・リスト・表は 704 段 (640 段)
 *  - 組版: flex・grid (1 段で 9 枠) は 384 段 (368 段)、縦書きと横書きの入れ子は 576 段 (512 段)
 *  - 描画・直列化: 切れない (領域の入れ子は明示のスタックでたどる。paint.ts・areaTree.ts)。以前は、領域の入れ子が約 1000 段
 *    (flex・grid は要素の 1 段で領域が 4 段になるので、要素の 256 段) で描画のスタックが切れていた
 * いちばん浅く切れるのは縦並びの flex の読み込み (272 段まで通る) なので、その半分以下の 128 段にする (ブラウザのスタックは Node より
 * 小さいことがある。ふつうの文書の入れ子は数十段まで)。ブラウザと同じ 512 段にするには、読み込みと組版の再帰を浅くすることが要る。
 * inline-block・回り込み・段組・絶対配置の深い入れ子は、組版の時間が段数の指数で伸びるので、深い段数では測っていない
 */
export const MAX_TREE_DEPTH = 128;

/**
 * 入れ子の深さを上限 (max) に抑える: 上限の深さの要素の子の要素 (と、その後ろの兄弟) を、その要素のすぐ後ろへ出す
 * (上限より深い要素は、上限の深さの祖先の兄弟になる。要素は残り、文字の順も変わらない。Chromium の構文解析器が、上限を超えた
 * 要素を上限の深さの要素の子にせず、その親に付けるのと同じ考え方)。上限までの深さの文書は変えない。再帰を使わない
 * 戻り値: 上限を超えた要素があって、木の形を変えたか (呼び出し側が警告を出す)
 */
export function limitTreeDepth(doc: Document, max = MAX_TREE_DEPTH): boolean {
  const root = doc.documentElement;
  let node: Node | null = root;
  let depth = 1;
  let moved = false;
  while (node) {
    if (depth >= max && node.nodeType === 1) {
      let c: Node | null = node.firstChild;
      while (c && c.nodeType !== 1) c = c.nextSibling;
      const parent = node.parentNode;
      if (c && parent) {
        moved = true;
        const ref = node.nextSibling;
        while (c) {
          const next: Node | null = c.nextSibling;
          parent.insertBefore(c, ref);
          c = next;
        }
      }
    } else if (node.firstChild) {
      node = node.firstChild;
      depth++;
      continue;
    }
    while (node && node !== root && !node.nextSibling) {
      node = node.parentNode;
      depth--;
    }
    node = !node || node === root ? null : node.nextSibling;
  }
  return moved;
}

/** link の rel の語 (空白で区切り、大文字小文字を区別せずに比べる。HTML Living Standard §4.6.8) */
export const linkRelTokens = (l: Element): string[] => (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * 文書の link が、無効な代わりのスタイルシートかを答える関数を作る (HTML の文書と、EPUB の章の文書で共用する)。
 * 代わりのスタイルシート (rel に alternate と stylesheet の両方がある link。HTML Living Standard §4.6.8.23) は、alternate の印を付けて
 * 作られ、題 (title) が空でなく、選ばれたスタイルシートの組の名前 (alternate でない、題のある最初のスタイルシートの題) と違えば、
 * 無効になる (CSSOM 1 §6.2 の「add a CSS style sheet」)
 */
export function disabledAlternateStylesheet(doc: Document): (l: Element) => boolean {
  // 文書の順の link・style (linkedom の getElementsByTagName('*') は何も返さず、xmldom には querySelectorAll が無いので、在るほうで集める)
  const all: Element[] = typeof doc.querySelectorAll === 'function' ? Array.from(doc.querySelectorAll('link, style')) : Array.from(doc.getElementsByTagName('*'));
  const sheets = all.filter((e) => e.localName === 'style' || (e.localName === 'link' && linkRelTokens(e).includes('stylesheet')));
  const titled = sheets.find((e) => (e.getAttribute('title') ?? '') !== '' && !(e.localName === 'link' && linkRelTokens(e).includes('alternate')));
  const preferredSet = titled?.getAttribute('title') ?? '';
  return (l) => linkRelTokens(l).includes('alternate') && (l.getAttribute('title') ?? '') !== '' && l.getAttribute('title') !== preferredSet;
}

/** 文書を用意する。parse: HTML の文字列 → Document (ブラウザは DOMParser、Node は linkedom) */
/**
 * アンテナハウス互換 (--style ah): HTML の構文で読む文書の、接頭辞の付いた MathML・SVG の要素 (`<m:math xmlns:m="http://www.w3.org/1998/Math/MathML">`) を、
 * 接頭辞の無い名前 (`<math>`) に書き直す。HTML の構文では接頭辞は名前空間として働かず (HTML Living Standard §13.2: 要素の名前の「m:math」は
 * 名前空間の無い知らない要素)、MathML として組まれない。AH Formatter は、拡張子 .html の文書の中の、xmlns: で接頭辞を宣言した MathML を組む
 * (見本の PDF: 『CSS ページ組版入門』第 4 版の 4.3 の数式)。XML の構文 (XHTML) で読むと pre の直後の改行が残って組版が変わるので、
 * 文書全体を XHTML として読むのではなく、宣言のある接頭辞の要素だけを書き直す。
 * 接頭辞は、MathML・SVG の名前空間を指す xmlns:接頭辞 の宣言が文書のどこかにあるものだけ。宣言は取り除く
 */
export function prefixedForeignToHtml(html: string): string {
  const prefixes = new Set<string>();
  for (const m of html.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])http:\/\/www\.w3\.org\/(?:1998\/Math\/MathML|2000\/svg)\2/g)) prefixes.add(m[1]);
  let out = html;
  for (const p of prefixes) {
    const q = p.replace(/[.]/g, '\\.');
    // 書き直すのはタグだけ (本文の文字の &lt;m:math …&gt; は変えない)。タグの中の、その接頭辞の宣言は取り除く
    const decl = new RegExp(`\\sxmlns:${q}\\s*=\\s*(["'])[^"']*\\1`, 'g');
    out = out.replace(new RegExp(`<(/?)${q}:([A-Za-z][\\w.-]*)([^<>]*)>`, 'g'), (_t, slash: string, name: string, rest: string) => `<${slash}${name}${rest.replace(decl, '')}>`);
  }
  return out;
}

export async function prepareHtml(
  html: string,
  files: CssFile[],
  defaults: HtmlDefaults,
  defaultPage: { width: number; height: number; margin: number },
  parse: (html: string) => Document,
): Promise<PreparedHtml> {
  // アンテナハウス互換: 接頭辞の付いた MathML・SVG の要素 (<m:math xmlns:m="…/MathML">) を、名前空間に従って読む
  const parsed = parse(defaults === 'ah' ? prefixedForeignToHtml(html) : html);
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  const warnings: string[] = [];
  // 上限を超えた入れ子は、木の形 (と組版の結果) が変わるので、黙って進めずに知らせる
  if (parsed.documentElement && limitTreeDepth(parsed))
    warnings.push(msg(`要素の入れ子が深すぎます。${MAX_TREE_DEPTH} 段より深い要素は、${MAX_TREE_DEPTH} 段目の要素の後ろに並べて組みます`, `elements are nested too deeply; elements deeper than ${MAX_TREE_DEPTH} levels are laid out after their ancestor at level ${MAX_TREE_DEPTH}`));
  // CSS の表。鍵は、参照から取った CSS (url あり) は参照の URL の全体、ほか (一緒に渡したファイル) はファイル名 (小文字)
  const cssFiles = new Map<string, string>();
  /** 鍵 → その CSS の場所 (中の相対の @import を解決する基準)。分からなければ無い */
  const cssBases = new Map<string, string>();
  /** 参照から取った CSS のファイル名 → 鍵 (URL の全体で当たらない参照を、これまでどおりファイル名で探すため。同じ名前なら先のもの) */
  const cssByName = new Map<string, string>();
  for (const f of files) {
    if (!(f.css || /\.css$/i.test(f.name))) continue;
    const key = f.url ?? f.name.toLowerCase();
    const at = f.url ?? f.path?.split('\\').join('/');
    // @font-face の相対の url() は、この CSS の場所を基準に解決した参照にしておく (CSS Fonts 4 §4.3。<style> に差し込むと、どの CSS に書かれていたかが分からなくなる)
    cssFiles.set(key, at ? rebaseFontFaceUrls(await f.text(), at) : await f.text());
    if (at) cssBases.set(key, at);
    if (f.url !== undefined && !cssByName.has(basename(f.url))) cssByName.set(basename(f.url), key);
  }
  /** 参照 href (base: それを書いた CSS の場所) に当たる CSS の鍵: URL の全体が同じもの、無ければファイル名が同じもの */
  const cssKey = (href: string, base?: string) => {
    const full = resolveRef(href.trim(), base);
    if (cssFiles.has(full)) return full;
    const name = basename(href);
    return cssFiles.has(name) ? name : (cssByName.get(name) ?? name);
  };
  const cssTexts: string[] = [];
  const linked = new Set<string>();
  // メディアクエリの width・height・orientation は、@page の規則が無いときに選ばれる用紙 (利用者の既定の用紙) の page box で評価する
  // (CSS Paged Media 3 §7.1・Media Queries 4 §4.1)
  const mediaPage = mediaPageOf(defaultPage);
  // @supports・@import の supports() に、アンテナハウスの拡張の値を対応していると答えるのは、アンテナハウス互換 (既定のスタイルが ah) のときだけ
  // (その値をカスケードが受け付けるのは、互換の指定のときだけ。Conditional 3 §6.1。カスケードの設定は compat.ts の ahCascadeOptions)
  const ah = defaults === 'ah' ? ALL_AH : undefined;
  // 印刷の媒体として読む: screen だけの CSS は使わず、@media print の規則は iframe (画面) でも効くようにする。
  // 媒体の種類は、@media の並び (カンマ区切り) のそれぞれで置き換える: print → all、screen (とその後の条件) → not all。
  // screen and (max-width: 600px) は条件ごと not all にする (not all and (…) だと、not が条件にも掛かり、印刷で真になりうる)
  const screenOnly = (m: string | null) => !!m && /\bscreen\b/i.test(m) && !/\b(print|all)\b/i.test(m);
  const forPrint = (css: string) =>
    css.replace(/@media\s+([^{;]+)/gi, (_m, list: string) => {
      const qs = list.split(',').map((q) => {
        const s = q.trim();
        const m = /^(?:(only|not)\s+)?(print|screen)\b([\s\S]*)$/i.exec(s);
        if (!m) return s;
        const not = m[1]?.toLowerCase() === 'not';
        if (m[2].toLowerCase() === 'print') return `${not ? 'not ' : ''}all${m[3]}`;
        return not ? 'all' : 'not all';
      });
      return `@media ${qs.join(', ')} `;
    });
  // media 属性 (<link>・<style>): print・all はそのまま、ほかの条件 ((orientation: landscape) など) は @media で包んで、印刷の条件として評価する
  const withMedia = (m: string | null, css: string) => {
    const q = (m ?? '').trim();
    return forPrint(!q || /^(all|print)$/i.test(q) ? css : `@media ${q} {\n${css}\n}`);
  };
  // @import は、一緒に選んだ CSS ファイルの中身に置き換える (入れ子もたどる。読み込まれた CSS は、参照された CSS として扱う)。
  // reading は読んでいる途中のファイル (@import の鎖の祖先): その中のファイルを読む @import は循環なので読まない
  // (仕様に循環の決まりは無い。ブラウザも、祖先の鎖にある URL の @import は読み込まない)。
  // 読み込んだ CSS の長さ・回数の合計が上限 (MAX_IMPORTED_CSS_LENGTH・MAX_IMPORTS) を超える @import は、捨てて警告する
  const budget = { length: MAX_IMPORTED_CSS_LENGTH, count: MAX_IMPORTS, warned: false };
  const inlineImports = (css: string, reading: string[] = [], depth = 0, base?: string): string =>
    depth > 8
      ? css
      : css.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi, (_m, href: string, cond: string) => {
          // media・supports() の条件が合わない @import は読まない (Cascade 5 §2)。layer() は読み飛ばす
          // 条件に合わずに読まない CSS も、参照された CSS として数える (参照されていない CSS = 利用者のスタイルシートとして足さない)
          const name = cssKey(href, base);
          if (cssFiles.has(name)) linked.add(name);
          const sup = /supports\(((?:[^()]|\([^()]*\))*)\)/i.exec(cond);
          if (sup && !matchSupports(sup[1], ah)) return '';
          const media = cond.replace(/layer(\([^)]*\))?/i, '').replace(/supports\((?:[^()]|\([^()]*\))*\)/i, '').trim();
          if (media && !matchMedia(media, mediaPage)) return '';
          const t = cssFiles.get(name);
          if (t === undefined) return '';
          if (reading.includes(name)) return '';
          if (t.length > budget.length || budget.count <= 0) {
            if (!budget.warned)
              warnings.push(msg(`@import ${name}: 読み込む CSS が多すぎる (合計 ${MAX_IMPORTED_CSS_LENGTH} 字・${MAX_IMPORTS} 回まで) ので、これ以上の @import は読みません`, `@import ${name}: too much imported CSS (up to ${MAX_IMPORTED_CSS_LENGTH} characters and ${MAX_IMPORTS} imports in total); further @import rules are ignored`));
            budget.warned = true;
            return '';
          }
          budget.length -= t.length;
          budget.count--;
          const inner = inlineImports(t, [...reading, name], depth + 1, cssBases.get(name));
          // 用紙の大きさに依る条件の @import は、条件の @media で包んで残す (中の @page の size を読まないため。Page 3 §7.1)
          return media && mediaDependsOnPageSize(media) ? `@media ${media} {\n${inner}\n}` : inner;
        });
  for (const [name, text] of cssFiles) cssFiles.set(name, inlineImports(text, [name], 0, cssBases.get(name)));
  parsed.querySelectorAll('style').forEach((s) => {
    s.textContent = inlineImports(s.textContent ?? '');
  });
  // <link rel="stylesheet" href="x.css"> → <style>
  // 無効な代わりのスタイルシート (disabledAlternateStylesheet) は当てない (参照された CSS としては数える)
  const disabledAlternate = disabledAlternateStylesheet(parsed);
  parsed.querySelectorAll('link[rel~="stylesheet"]').forEach((l) => {
    linked.add(cssKey(l.getAttribute('href') ?? ''));
    const text = cssFiles.get(cssKey(l.getAttribute('href') ?? ''));
    if (text === undefined || screenOnly(l.getAttribute('media')) || disabledAlternate(l)) {
      l.remove();
      return;
    }
    const st = parsed.createElement('style');
    st.textContent = withMedia(l.getAttribute('media'), text);
    l.replaceWith(st);
  });
  // HTML から参照されていない CSS ファイルは、利用者のスタイルシートとして文書の CSS の後に足す (weasyprint -s と同じ)
  for (const [name, text] of cssFiles) {
    if (linked.has(name)) continue;
    const st = parsed.createElement('style');
    st.textContent = forPrint(text);
    (parsed.head ?? parsed.documentElement).append(st);
  }
  parsed.querySelectorAll('style').forEach((s) => {
    if (screenOnly(s.getAttribute('media'))) s.remove();
    else {
      s.textContent = withMedia(s.getAttribute('media'), s.textContent ?? '');
      s.removeAttribute('media');
      cssTexts.push(s.textContent ?? '');
    }
  });
  // 既定のスタイル (作成者スタイルシート より前)。browser-margin 以外は、body の余白 (画面の 8px) を付けない (ページの余白は @page)
  // 見出しのしおり (GCPM 3 の付録 B) は、どの既定にも入れる
  const base = GCPM_BOOKMARK_CSS + (defaults === 'browser-margin' ? '' : defaults === 'weasyprint' ? WEASYPRINT_UA_CSS : PRINT_UA_CSS + (defaults === 'kumiori' ? KUMIORI_BOOK_CSS : defaults === 'ah' ? CSS21_DEFAULT_CSS : defaults === 'vivliostyle' ? VIVLIOSTYLE_UA_CSS : ''));
  // Vivliostyle 互換: 見出しのセル (th) は align 属性によらず中央に揃う (既定のスタイルの th の text-align: center が、
  // 属性による指定より優先される。Vivliostyle の 2025 年度財務報告書の PDF で、align="left"・"right" の th が中央にあることを見た)
  if (defaults === 'vivliostyle') parsed.querySelectorAll('th[align]').forEach((th) => th.removeAttribute('align'));
  const st = parsed.createElement('style');
  st.textContent = base;
  (parsed.head ?? parsed.documentElement).prepend(st);
  const css = [base, ...cssTexts].join('\n');
  const authorCss = cssTexts.join('\n');
  // CSS はここで 1 度だけ読む (既定のスタイルと作成者スタイルシート は、カスケードの出どころが違うので別々に読み、全体はその並び)
  const uaSheet = parseCss(base, mediaPage);
  const authorSheet = parseCss(authorCss, mediaPage, ah);
  const sheet = concatCss(uaSheet, authorSheet);
  // 本文の幅 (px) で組ませる。高さはページの領域 (余白を除く) の高さ (CSS の印刷では、vh はページの領域の高さに対して決まる)
  const page = parsePageRule(sheet, defaultPage);
  const bodyWidthPx = ((page.width - page.margins.left - page.margins.right) / 25.4) * 96;
  const pageHeightPx = ((page.height - page.margins.top - page.margins.bottom) / 25.4) * 96;
  return { doc: parsed, css, authorCss, uaCss: base, uaSheet, authorSheet, sheet, bodyWidthPx, pageHeightPx, warnings };
}

/** 互換モード (quirks mode) にする公開識別子 (HTML Living Standard §13.2.6.4.1。2026-11-04 取得。大文字小文字を区別しない) */
const QUIRKS_PUBLIC_IDS = ['-//W3O//DTD W3 HTML Strict 3.0//EN//', '-/W3C/DTD HTML 4.0 Transitional/EN', 'HTML'];
/** 互換モードにする公開識別子の始まり */
const QUIRKS_PUBLIC_PREFIXES = [
  '+//Silmaril//dtd html Pro v0r11 19970101//',
  '-//AS//DTD HTML 3.0 asWedit + extensions//',
  '-//AdvaSoft Ltd//DTD HTML 3.0 asWedit + extensions//',
  '-//IETF//DTD HTML 2.0 Level 1//',
  '-//IETF//DTD HTML 2.0 Level 2//',
  '-//IETF//DTD HTML 2.0 Strict Level 1//',
  '-//IETF//DTD HTML 2.0 Strict Level 2//',
  '-//IETF//DTD HTML 2.0 Strict//',
  '-//IETF//DTD HTML 2.0//',
  '-//IETF//DTD HTML 2.1E//',
  '-//IETF//DTD HTML 3.0//',
  '-//IETF//DTD HTML 3.2 Final//',
  '-//IETF//DTD HTML 3.2//',
  '-//IETF//DTD HTML 3//',
  '-//IETF//DTD HTML Level 0//',
  '-//IETF//DTD HTML Level 1//',
  '-//IETF//DTD HTML Level 2//',
  '-//IETF//DTD HTML Level 3//',
  '-//IETF//DTD HTML Strict Level 0//',
  '-//IETF//DTD HTML Strict Level 1//',
  '-//IETF//DTD HTML Strict Level 2//',
  '-//IETF//DTD HTML Strict Level 3//',
  '-//IETF//DTD HTML Strict//',
  '-//IETF//DTD HTML//',
  '-//Metrius//DTD Metrius Presentational//',
  '-//Microsoft//DTD Internet Explorer 2.0 HTML Strict//',
  '-//Microsoft//DTD Internet Explorer 2.0 HTML//',
  '-//Microsoft//DTD Internet Explorer 2.0 Tables//',
  '-//Microsoft//DTD Internet Explorer 3.0 HTML Strict//',
  '-//Microsoft//DTD Internet Explorer 3.0 HTML//',
  '-//Microsoft//DTD Internet Explorer 3.0 Tables//',
  '-//Netscape Comm. Corp.//DTD HTML//',
  '-//Netscape Comm. Corp.//DTD Strict HTML//',
  "-//O'Reilly and Associates//DTD HTML 2.0//",
  "-//O'Reilly and Associates//DTD HTML Extended 1.0//",
  "-//O'Reilly and Associates//DTD HTML Extended Relaxed 1.0//",
  '-//SQ//DTD HTML 2.0 HoTMetaL + extensions//',
  '-//SoftQuad Software//DTD HoTMetaL PRO 6.0::19990601::extensions to HTML 4.0//',
  '-//SoftQuad//DTD HoTMetaL PRO 4.0::19971010::extensions to HTML 4.0//',
  '-//Spyglass//DTD HTML 2.0 Extended//',
  '-//Sun Microsystems Corp.//DTD HotJava HTML//',
  '-//Sun Microsystems Corp.//DTD HotJava Strict HTML//',
  '-//W3C//DTD HTML 3 1995-03-24//',
  '-//W3C//DTD HTML 3.2 Draft//',
  '-//W3C//DTD HTML 3.2 Final//',
  '-//W3C//DTD HTML 3.2//',
  '-//W3C//DTD HTML 3.2S Draft//',
  '-//W3C//DTD HTML 4.0 Frameset//',
  '-//W3C//DTD HTML 4.0 Transitional//',
  '-//W3C//DTD HTML Experimental 19960712//',
  '-//W3C//DTD HTML Experimental 970421//',
  '-//W3C//DTD W3 HTML//',
  '-//W3O//DTD W3 HTML 3.0//',
  '-//WebTechs//DTD Mozilla HTML 2.0//',
  '-//WebTechs//DTD Mozilla HTML//',
];

/**
 * HTML の文書の互換性のモード (HTML Living Standard §13.2.6.4.1 の「initial」の挿入モード)。
 * DOCTYPE が無い・名前が html でない・古い公開識別子なら quirks、XHTML 1.0 Transitional・Frameset などなら limited-quirks。
 * XML の構文で読んだ文書 (xml) は、いつも no-quirks。
 * DOCTYPE の書き誤りで字句解析が立てる force-quirks の印は、読み取った後の DOM からは分からないので見ない
 */
export function documentMode(doc: Document, xml = false): 'no-quirks' | 'limited-quirks' | 'quirks' {
  if (xml) return 'no-quirks';
  const dt = doc.doctype;
  if (!dt) return 'quirks';
  const lower = (s: string | null | undefined) => (s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase());
  const name = lower(dt.name);
  const pub = lower(dt.publicId);
  const sys = lower(dt.systemId);
  if (name !== 'html') return 'quirks';
  if (QUIRKS_PUBLIC_IDS.some((p) => lower(p) === pub) || sys === 'http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd') return 'quirks';
  if (QUIRKS_PUBLIC_PREFIXES.some((p) => pub.startsWith(lower(p)))) return 'quirks';
  const html401 = ['-//w3c//dtd html 4.01 frameset//', '-//w3c//dtd html 4.01 transitional//'].some((p) => pub.startsWith(p));
  if (html401 && !sys) return 'quirks';
  if (['-//w3c//dtd xhtml 1.0 frameset//', '-//w3c//dtd xhtml 1.0 transitional//'].some((p) => pub.startsWith(p)) || (html401 && sys)) return 'limited-quirks';
  return 'no-quirks';
}
