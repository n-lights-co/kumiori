/**
 * htmlPrepare — HTML と一緒に選んだ CSS から、組む文書と文書の CSS を用意する (ブラウザと Node で共通。DOM のパーサーは渡す)。
 *
 *  - <script> は取り除く
 *  - <link rel="stylesheet"> は、一緒に選んだ CSS ファイルの中身を <style> にする (ファイル名で突き合わせる)。@import も中身に置き換える
 *  - 参照されていない CSS ファイルは、利用者のスタイルシートとして文書の CSS の後に足す (weasyprint -s と同じ)
 *  - 印刷の媒体として読む: screen だけの CSS は使わず、@media print の規則は常に効く
 *  - 既定のスタイル (HtmlDefaults) を作成者スタイルシート より前に入れる
 */
import { parsePageRule } from './htmlImport';
import { concatCss, matchMedia, matchSupports, parseCss, type ParsedCss } from './htmlPaged';

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
}

export interface PreparedHtml {
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

/** 文書を用意する。parse: HTML の文字列 → Document (ブラウザは DOMParser、Node は linkedom) */
export async function prepareHtml(
  html: string,
  files: CssFile[],
  defaults: HtmlDefaults,
  defaultPage: { width: number; height: number; margin: number },
  parse: (html: string) => Document,
): Promise<PreparedHtml> {
  const parsed = parse(html);
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  const cssFiles = new Map<string, string>();
  for (const f of files) if (f.css || /\.css$/i.test(f.name)) cssFiles.set(f.name.toLowerCase(), await f.text());
  const cssTexts: string[] = [];
  const linked = new Set<string>();
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
  // @import は、一緒に選んだ CSS ファイルの中身に置き換える (入れ子もたどる。読み込まれた CSS は、参照された CSS として扱う)
  const inlineImports = (css: string, depth = 0): string =>
    depth > 8
      ? css
      : css.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi, (_m, href: string, cond: string) => {
          // media・supports() の条件が合わない @import は読まない (Cascade 5 §2)。layer() は読み飛ばす
          const sup = /supports\(((?:[^()]|\([^()]*\))*)\)/i.exec(cond);
          if (sup && !matchSupports(sup[1])) return '';
          const media = cond.replace(/layer(\([^)]*\))?/i, '').replace(/supports\((?:[^()]|\([^()]*\))*\)/i, '').trim();
          if (media && !matchMedia(media)) return '';
          const name = basename(href);
          const t = cssFiles.get(name);
          if (t === undefined) return '';
          linked.add(name);
          return inlineImports(t, depth + 1);
        });
  for (const [name, text] of cssFiles) cssFiles.set(name, inlineImports(text));
  parsed.querySelectorAll('style').forEach((s) => {
    s.textContent = inlineImports(s.textContent ?? '');
  });
  // <link rel="stylesheet" href="x.css"> → <style>
  parsed.querySelectorAll('link[rel~="stylesheet"]').forEach((l) => {
    linked.add(basename(l.getAttribute('href') ?? ''));
    const text = cssFiles.get(basename(l.getAttribute('href') ?? ''));
    if (text === undefined || screenOnly(l.getAttribute('media'))) {
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
  const uaSheet = parseCss(base);
  const authorSheet = parseCss(authorCss);
  const sheet = concatCss(uaSheet, authorSheet);
  // 本文の幅 (px) で組ませる。高さはページの領域 (余白を除く) の高さ (CSS の印刷では、vh はページの領域の高さに対して決まる)
  const page = parsePageRule(sheet, defaultPage);
  const bodyWidthPx = ((page.width - page.margins.left - page.margins.right) / 25.4) * 96;
  const pageHeightPx = ((page.height - page.margins.top - page.margins.bottom) / 25.4) * 96;
  return { doc: parsed, css, authorCss, uaCss: base, uaSheet, authorSheet, sheet, bodyWidthPx, pageHeightPx };
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
