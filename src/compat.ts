/**
 * 互換モード (アンテナハウス互換など) の設定を 1 か所にまとめる。
 * 画面 (main.ts・htmlFrame.ts) と API・CLI (api.ts) は、どちらもここから設定を取り、同じ設定で組む
 */
import { AH_BORDER_KEYWORDS, ALL_AH, fontFaceWeights, relativeWeightCss21, type CascadeOptions } from './cssCascade';
import type { ParsedCss } from './htmlPaged';
import type { HtmlDefaults } from './htmlPrepare';
import type { HtmlImportOptions } from './htmlImport';
import type { LayoutOptions } from './layoutEngine';
import type { PdfRenderOptions } from './pdfRenderer';
import { loadHyphenator } from './hyphenation';

/** 文書の種類 (XSL-FO・HTML) */
export type DocKind = 'fo' | 'html';

/** XSL-FO の既定値の流儀 (TypesetOptions.compat・ImportOptions.compat の値)。spec: XSL-FO 1.1 の初期値、antenna: アンテナハウス互換 (AH Formatter 向けに書かれた文書も組めるようにする) */
export type FoCompat = 'antenna' | 'spec';
/** compat に使える値 (公開 API・CLI の選択肢の検証に使う) */
export const FO_COMPATS: readonly FoCompat[] = ['spec', 'antenna'];
/** HTML の既定のスタイル (TypesetOptions.style) に使える値 (公開 API・CLI の選択肢の検証に使う) */
export const HTML_STYLES: readonly HtmlDefaults[] = ['kumiori', 'browser', 'browser-margin', 'ah', 'vivliostyle', 'weasyprint'];

/**
 * compat の値がアンテナハウス互換か。XSL-FO の読み込み (Importer.spec) と組版・PDF の設定 (isAhCompat) は、どちらもこの 1 つの判定を使う
 * (以前は !== 'antenna' と !== 'spec' の 2 通りの判定があり、知らない値で読み込みと組版が別のモードになった。知らない値は公開 API の入口 (api.ts) で誤りにする)
 */
export function isAntennaCompat(compat: FoCompat | undefined): boolean {
  return compat === 'antenna';
}

/**
 * アンテナハウス互換か: XSL-FO は compat が antenna のとき (compat を省けば互換モード。公開 API は入口で compat を既定の spec に補ってから呼ぶ)、
 * HTML は既定のスタイル (style) が ah のとき
 */
export function isAhCompat(kind: DocKind, mode: { compat?: FoCompat; style?: HtmlDefaults }): boolean {
  return kind === 'fo' ? mode.compat === undefined || isAntennaCompat(mode.compat) : mode.style === 'ah';
}

/**
 * 自前のカスケード (cascadeStyles) のアンテナハウス互換の設定。
 * 罫の太さの丸め無し・thin/medium/thick の太さ・アンテナハウスの線種・counter() の拡張・数の式の中の型の無い attr()・bolder/lighter を @font-face の太さから決める
 */
export function ahCascadeOptions(css: string | ParsedCss): Pick<CascadeOptions, 'noBorderSnap' | 'borderKeywords' | 'ahBorderStyles' | 'ahCounterFlags' | 'ahAttrNumber' | 'relativeWeight'> {
  return { noBorderSnap: true, borderKeywords: AH_BORDER_KEYWORDS, ...ALL_AH, relativeWeight: ahRelativeWeight(css) };
}

/**
 * アンテナハウス互換: bolder・lighter を CSS 2.1 §15.6 のとおり、@font-face で定義した書体の太さから決める
 * (例: @font-face で Semibold (600) を定義した書体の th・b の太字は 600)。@font-face で定義していない書体は undefined (Fonts 4 の表)
 */
function ahRelativeWeight(css: string | ParsedCss): (family: string, parentWeight: number, kind: 'bolder' | 'lighter') => number | undefined {
  const faces = fontFaceWeights(css);
  return (family, pw, kind) => {
    const first = family.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase();
    const ws = first ? faces.get(first) : undefined;
    return ws?.length ? relativeWeightCss21(ws, pw, kind) : undefined;
  };
}

/** HTML の読み込み (importHtml) のアンテナハウス互換の設定。白ページは前のページの名前のページにする など */
export const AH_HTML_IMPORT_OPTIONS: Readonly<Partial<HtmlImportOptions>> = {
  blankPageName: 'previous',
  autospaceWidth: 0.25,
  footnoteMarkerOutside: true,
  pageContextFontSize: 10,
  pageGroupFirst: true,
  columnsDiscardEndMargin: true,
  columnsDiscardStartMargin: true,
  tableCollapseSpillAh: true,
  tableRowspanMiddleAh: true,
  primaryFontByLangAh: true,
  superShiftAh: true,
  pseudoInlineBoxAh: true,
  jaDefaultsAh: true,
  footnoteCallLineHeightFromParent: true,
  leaderFromStart: true,
  ahObsoleteListStyles: true,
  tableAutoWidthAh: true,
  tableHeaderWithBodyAh: true,
  ahCounterPagePhysical: true,
  ahCssExtensions: true,
};

/** 組版 (LayoutEngine) の互換の設定: アンテナハウス互換では、字の組の詰め方 (kernAh) */
export function compatLayoutOptions(ah: boolean): Pick<LayoutOptions, 'kernAh'> {
  return ah ? { kernAh: true } : {};
}

/**
 * PDF (renderPdf) の互換の設定: アンテナハウス互換では、SVG の font-family に書いた PostScript 名・完全な名前でも書体を選び、
 * SVG の根元の overflow を visible にする。XSL-FO ではさらに、矢印の先 (marker) の overflow も visible
 */
export function compatPdfOptions(kind: DocKind, ah: boolean): Pick<PdfRenderOptions, 'svgFontUniqueNames' | 'svgRootOverflowVisible' | 'svgMarkerOverflowVisible'> {
  return ah ? { svgFontUniqueNames: true, svgRootOverflowVisible: true, ...(kind === 'fo' ? { svgMarkerOverflowVisible: true } : {}) } : {};
}

/** XSL-FO の文書に出てくる言語 (xml:lang・language 属性。none は除く) */
export function foLanguages(text: string): string[] {
  const langs = new Set<string>();
  for (const m of text.matchAll(/(?:xml:lang|\blanguage)\s*=\s*["']([^"']+)["']/gi)) {
    const v = m[1].trim();
    if (v && v.toLowerCase() !== 'none') langs.add(v);
  }
  return [...langs];
}

/**
 * 分綴 (hyphenate="true") を使う XSL-FO の文書なら、文書に出てくる言語の分綴の規則を先に読み込む (組版は同期で行うため)。
 * 言語の指定の無い所は英語 (en) で分綴するので、en は常に読み込む。対応していない言語は読み飛ばす
 */
export async function loadFoHyphenators(text: string): Promise<void> {
  if (!/hyphenate\s*=\s*["']true/.test(text)) return;
  const langs = ['en', ...foLanguages(text)];
  // country (XSL 1.1 §7.10.1) を足した言語 (language="en" country="GB" → en-GB) の規則も読み込む
  const countries = new Set<string>();
  for (const m of text.matchAll(/\bcountry\s*=\s*["']([A-Za-z]{2,3})["']/g)) countries.add(m[1]);
  for (const l of langs) {
    await loadHyphenator(l);
    if (!l.includes('-')) for (const c of countries) await loadHyphenator(`${l}-${c}`);
  }
}
