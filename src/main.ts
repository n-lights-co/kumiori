import { FontManager } from './fontManager';
import { Measurer } from './measurer';
import { LayoutEngine } from './layoutEngine';
import { renderSheetToCanvas } from './canvasRenderer';
import { renderPdf } from './pdfRenderer';
import { AssetStore } from './assets';
import { resetEpsBudget } from './epsInfo';
import { SERIF, buildSampleDocument } from './sampleData';
import { importXslFo, type ImportReport } from './xslfoImport';
import { xmlParse } from './xmlParse';
import type { AreaTree, LDocument } from './types';
import { splitFontFile, type UserFont } from './fontLoader';
import { clearUserFonts, loadUserFonts, saveUserFont } from './userFonts';
import { decodeDocumentText } from './documentText';
import { hyphenPositions, loadDocumentHyphenators } from './hyphenation';
import { compatLayoutOptions, htmlImportCompatOptions, compatPdfOptions, isAntennaCompat, loadFoHyphenators, type DocKind, type FoCompat } from './compat';
import { fetchReportedImages, mathOptionsFor } from './documentResources';
import { importHtml, parsePageSize } from './htmlImport';
import { droppedLinkWarning, summarizeDroppedLinks } from './linkPolicy';
import { summarizeCounts, unsupportedCssReport } from './cssUnsupported';
import { msg } from './messages';
import { countedDiagnostics, diag, type Diagnostic } from './diagnostics';
import { walkAreas } from './areaTree';
import { loadHtml } from './htmlFrame';
import { readEpub } from './epub';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC, EMOJI_SPEC, createFontMapping, hasMissingEmoji, hasMissingGlyphs, setupDefaultFonts } from './fontMapping';
import { fetchGuarded } from './resources';
import { fetchLimits } from './imageLimits';
import { formatsOf } from './imageFormats';
import type { DrawioOptions } from './drawio/index';
import { XML_COMMENT } from './drawio/sniff';
import { messageLang } from './messages';
import { clearUserStencils, loadUserStencils, saveUserStencil, type UserStencilFile } from './userStencils';

let symbolsTried = false;
let emojiTried = false;
let monoTried = false;

/**
 * 文書の文字に、読み込み済みのどの書体も持たない字があれば、記号の書体を読み込む。それでも無い絵文字があれば、絵文字の書体も読み込む
 * (どちらも 1 度だけ。取れなければそのまま組む)。
 * 読み込んだ書体は、字の書体の代替 (FontManager.getForChar) で使われる
 */
async function ensureSymbolFont(doc: LDocument) {
  // 等幅の指定があれば、等幅の書体を読み込む (1 度だけ。取れなければ和文の書体で組む)
  if (!monoTried && usesMono()) {
    monoTried = true;
    for (const spec of MONO_SPECS) await fonts.load(spec, setStatus).catch(noteError);
  }
  if (!symbolsTried && hasMissingGlyphs(fonts, doc)) {
    symbolsTried = true;
    await fonts.load(SYMBOL_SPEC, setStatus).catch(noteError);
  }
  // 記号の書体にも無い絵文字があれば、絵文字の書体を読み込む (1 度だけ。記号の書体の後に読むので、記号の書体が持つ字はこれまでどおり)
  if (!emojiTried && hasMissingEmoji(fonts, doc)) {
    emojiTried = true;
    await fonts.load(EMOJI_SPEC, setStatus).catch(noteError);
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const sheetsEl = $('sheets');
const downloadBtn = $<HTMLButtonElement>('download');
const guidesEl = $<HTMLInputElement>('guides');
const zoomEl = $<HTMLInputElement>('zoom');
const warnEl = $('warnings');
const reportEl = $<HTMLDetailsElement>('report');
const foFile = $<HTMLInputElement>('fofile');
const fontFile = $<HTMLInputElement>('fontfile');
const clearFontsBtn = $<HTMLButtonElement>('clearfonts');
const foPrint = $<HTMLInputElement>('foprint');
const foSpec = $<HTMLInputElement>('fospec');
const htmlStyle = $<HTMLSelectElement>('htmlstyle');
const pageSizeEl = $<HTMLSelectElement>('pagesize');
const pageSizeCustom = $<HTMLInputElement>('pagesizecustom');
const cssEngine = $<HTMLSelectElement>('cssengine');
const saveJsonBtn = $<HTMLButtonElement>('savejson');
const resetBtn = $<HTMLButtonElement>('resetsample');
const folderFile = $<HTMLInputElement>('folderfile');
const settingsBtn = $<HTMLButtonElement>('settingsbtn');
const drawioOn = $<HTMLInputElement>('drawio-on');
const taggedEl = $<HTMLInputElement>('tagged');
const drawioOpts = $('drawioopts');
const stencilFile = $<HTMLInputElement>('stencilfile');
const clearStencilsBtn = $<HTMLButtonElement>('clearstencils');
const stencilStateEl = $('stencilstate');
const drawioFetch = $<HTMLInputElement>('drawiofetch');
const settingsEl = $('settings');
const sidebarEl = $('sidebar');
const sideToggle = $<HTMLButtonElement>('sidetoggle');
const thumbsEl = $('thumbs');
const dropzoneEl = $('dropzone');

const setStatus = (s: string) => {
  statusEl.textContent = s;
  statusEl.title = s;
};

const fonts = new FontManager();
/** 文字の幅を測る canvas (本体の外の画像の形式に渡す。画面は変換した SVG を img で描くので、ブラウザの同じ書体で測る) */
let measureCtx: CanvasRenderingContext2D | null | undefined;
const assets = new AssetStore({
  formatContext: {
    measureText: (text, ft) => {
      measureCtx ??= document.createElement('canvas').getContext('2d');
      if (!measureCtx) return undefined;
      // 書体の名前は CSS の文字列にして渡す (名前の中の " と \ は逃がす)
      measureCtx.font = `${ft.italic ? 'italic ' : ''}${ft.bold ? 'bold ' : ''}${ft.size}px "${ft.family.replace(/["\\]/g, '\\$&')}", sans-serif`;
      return measureCtx.measureText(text).width;
    },
    // 図が URL で指す資源は、文書の画像と同じく取る (自分の計算機の URL は取らない)
    fetchResource: async (url) =>
      /^https?:\/\//i.test(url) && allowRemoteImage(url) ? (await fetchGuarded(url, { maxBytes: fetchLimits.imageBytes, allow: allowRemoteImage }).catch(() => undefined))?.bytes : undefined,
    // 利用者が設定で許したもの (draw.io の図形ライブラリの配布物) を取る
    fetch: async (url) => (/^https?:\/\//i.test(url) ? (await fetchGuarded(url, { maxBytes: fetchLimits.imageBytes }).catch(() => undefined))?.bytes : undefined),
    warn: (m) => formatWarnings.add(m),
    lang: messageLang(),
  },
});

// ───────────── draw.io の図 (設定の「draw.io の図」で、読む・読まないと図形ライブラリを選ぶ) ─────────────

/**
 * draw.io の図形ライブラリのファイル (設定で読み込んだもの (ブラウザに覚える)・開いたファイルと一緒に渡したもの)。
 * 中身 (図形ライブラリ・SVG は文字、PNG・JPEG はバイト列) をそのまま持ち、draw.io の図の選択肢に渡す (図形ライブラリを読む処理は、図を開いたときに読み込む)
 */
let stencilFiles: UserStencilFile[] = [];
/** 画像の形式の警告 (画像ごとでないもの: 読めない図形ライブラリ・取れない配布物など)。文書の警告と一緒に出す */
const formatWarnings = new Set<string>();
/**
 * draw.io の図として読めるかもしれない画像のファイル (開いたときに読めなかったもの・draw.io の図として読んだもの)。
 * draw.io の図を読む・読まないを切り替えたら、これを読み直す (名前 → 中身)
 */
const drawioCandidates = new Map<string, Blob>();

/** 今の設定の draw.io の図の選択肢 (選択肢が変わるたびに作り直す。取った図形ライブラリは、drawioStencil.ts が URL ごとに使い回す)。読まないなら false */
function currentDrawio(): DrawioOptions | false {
  if (!drawioOn.checked) return false;
  return { stencils: stencilFiles.map((f) => ({ name: f.name, data: f.data })), fetchStencils: drawioFetch.checked };
}

/** 画像を登録する。読めなかったもの・draw.io の図として読んだものは、draw.io の設定を変えたときに読み直す */
async function addImage(name: string, blob: Blob) {
  const a = await assets.addBlob(name, blob);
  if (!a || a.formatSource) drawioCandidates.set(name, blob);
  return a;
}

/**
 * draw.io の図の設定が変わった: 形式を差し替え、読み込み済みの画像を読み直して、画面の文書を組み直す。
 * fragment の付いた参照の図 (図.drawio#page=2) は、元のファイルを登録し直すときに assets が捨て、文書を読み直すときに作り直す (AssetStore.addFragment)
 */
async function drawioChanged() {
  drawioOpts.setAttribute('aria-disabled', String(!drawioOn.checked));
  for (const el of drawioOpts.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) el.disabled = !drawioOn.checked;
  assets.setFormats(formatsOf(undefined, currentDrawio()));
  formatWarnings.clear();
  for (const [name, blob] of drawioCandidates) if (!(await addImage(name, blob))) assets.unregister(name);
  if (deferWhileOpening()) return;
  if (lastSource) reloadCurrent();
  else if (currentDoc) showDocument(currentDoc, currentName);
}

/**
 * draw.io の図形ライブラリのファイルか: 配布物の stencils.min.js (f['….xml'] = '…' の並び) か、ライブラリの XML (<shapes>・<stencils>)。
 * 名前の拡張子 (.js・.xml) と、中身の頭で見分ける (FO・MathML の .xml と取り違えない)
 */
function isStencilFile(name: string, text: string): boolean {
  if (/\.js$/i.test(name)) return /\bf\['[^']+\.xml'\]\s*=/.test(text.slice(0, 1 << 16));
  return /\.xml$/i.test(name) && STENCIL_XML_HEAD.test(text.slice(0, 4096));
}
/** 図形ライブラリの XML の頭: XML 宣言・注釈 (XML_COMMENT。手間が長さに比例する形)・空白の後ろに <shapes か <stencils */
const STENCIL_XML_HEAD = new RegExp(String.raw`^\ufeff?\s*(?:<\?xml[^>]*\?>\s*)?(?:${XML_COMMENT}\s*)*<(?:shapes|stencils)[\s>]`);
/** PNG (署名の 8 バイト) か JPEG (SOI の FF D8 と、次の印の FF) か */
function isPngOrJpeg(b: Uint8Array): boolean {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (b.length > 8 && png.every((v, i) => b[i] === v)) || (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);
}
/** 図形ライブラリを足す (呼ぶ側が isStencilFile などで確かめたもの。同じ名前は置き換える)。名前を設定の欄に出す。足したファイルの数を返す */
function addStencils(files: UserStencilFile[]): number {
  for (const f of files) stencilFiles = [...stencilFiles.filter((x) => x.name !== f.name), f];
  const names = stencilFiles.map((f) => f.name);
  clearStencilsBtn.hidden = !names.length;
  stencilStateEl.textContent = names.length ? `読み込んだ図形ライブラリ: ${names.join('、')}` : '読み込んだ図形ライブラリはありません';
  return files.length;
}

/**
 * 画面に出している文書の、読み込みの途中の警告 (組版の警告 = tree.warnings の前に出す)。公開 API の typeset が warnings に入れるものと同じ:
 * 用意の途中の警告 (深すぎる入れ子・多すぎる @import)、EPUB の飛ばした項目、未対応・知らない CSS、未対応の XSL-FO、動作を書かなかったリンク、
 * 取らなかった画像、書体の知らせ (取得できなかった書体・可変フォントの軸など)。文書を読み始めるときに空にする
 */
let loadWarnings: WarnEntry[] = [];
/** PDF を書き出したときの警告 (動作を書かなかったリンク)。文書を組み直したら空にする */
let pdfWarnings: WarnEntry[] = [];
const noteError = (e: unknown) => {
  loadWarnings.push({ text: String(e instanceof Error ? e.message : e), diags: [] });
};
// 書体の知らせ (既定はコンソール) を、画面の警告に出す
fonts.onNotice = (d) => loadWarnings.push(entryOf(d));

/** 警告の欄の 1 行の元: 文 (typeset の warnings と同じ文) と、同じ出来事の診断 (名前・重さ・場所。まとめた文なら項目ごと) */
type WarnEntry = { text: string; diags: Diagnostic[] };
const entryOf = (d: Diagnostic): WarnEntry => ({ text: d.message, diags: [d] });
/** 画像の形式の読み取り (draw.io など) の警告 */
const formatEntries = (): WarnEntry[] => [...formatWarnings].map((m) => entryOf(diag('image/format-warning', m)));
/**
 * 組版の警告 (tree.warnings) と、同じ出来事の診断 (tree.diagnostics) の組。文が同じ診断を結ぶ。文の合わない診断 (見つからない id を
 * 種類ごとに 1 行にまとめた文の、id ごとの診断) は、合わなかった文に、名前の同じものを結ぶ
 */
function treeEntries(t: AreaTree, warnings: readonly string[] = t.warnings, ds: readonly Diagnostic[] = t.diagnostics ?? []): WarnEntry[] {
  const used = new Set<Diagnostic>();
  const out = warnings.map((w) => {
    const hit = ds.filter((d) => d.message === w);
    hit.forEach((d) => used.add(d));
    return { text: w, diags: hit };
  });
  const rest = ds.filter((d) => !used.has(d));
  for (const e of out) if (!e.diags.length) e.diags = rest.filter((d) => d.code === 'layout/missing-id');
  return out;
}
/** 重さの印 (重いほうを先に) */
const SEVERITY_MARK: Record<Diagnostic['severity'], string> = { error: '✖', warning: '⚠', info: 'ℹ' };
const SEVERITY_ORDER: Diagnostic['severity'][] = ['error', 'warning', 'info'];
/** sourceRef → その箱が初めて現れるページ (0 から)。警告の行を押してページへ移るため (木ごとに 1 度だけ作る) */
const refPages = new WeakMap<AreaTree, Map<number, number>>();
function pageOfRef(t: AreaTree, ref: number): number | undefined {
  let m = refPages.get(t);
  if (!m) {
    m = new Map();
    const mm = m;
    t.sheets.forEach((sheet, k) =>
      walkAreas(sheet, (a) => {
        const r = (a as { sourceRef?: number }).sourceRef;
        if (r !== undefined && !mm.has(r)) mm.set(r, k);
      }),
    );
    refPages.set(t, m);
  }
  return m.get(ref);
}

/** 警告をこの数まで、開いた形で出す。多ければ畳んで、件数だけを見せる (開けば読める) */
const WARNINGS_OPEN_MAX = 3;
/** 一覧に並べる警告の種類の上限 (残りは件数だけ) */
const WARNINGS_LIST_MAX = 100;
/** 警告の件数の文 (帯の状態の欄と、警告の欄の見出しに使う) */
const warningCountText = (n: number) => msg(`⚠ 警告 ${n} 件`, `⚠ ${n} warning${n === 1 ? '' : 's'}`);

/**
 * 警告を、左の欄 (#warnings) に出す。同じ文は 1 つにまとめて数を添える。WARNINGS_OPEN_MAX 件より多ければ畳む。
 * 警告が無ければ欄を空にする (空の欄は見えない)。戻り値は警告の種類の数
 */
function showWarnings(list: WarnEntry[]): number {
  const counts = new Map<string, number>();
  const diagsOf = new Map<string, Diagnostic[]>();
  for (const w of list) {
    counts.set(w.text, (counts.get(w.text) ?? 0) + 1);
    diagsOf.set(w.text, [...(diagsOf.get(w.text) ?? []), ...w.diags]);
  }
  warnEl.replaceChildren();
  if (!counts.size) return 0;
  const details = document.createElement('details');
  details.open = counts.size <= WARNINGS_OPEN_MAX;
  const summary = document.createElement('summary');
  summary.textContent = warningCountText(counts.size);
  const ul = document.createElement('ul');
  const items = [...counts];
  for (const [w, n] of items.slice(0, WARNINGS_LIST_MAX)) {
    const li = document.createElement('li');
    const ds = diagsOf.get(w) ?? [];
    // 重さの印 (いちばん重い診断の重さ)・文・名前と場所 (要素・行・ページ)
    const sev = SEVERITY_ORDER.find((x) => ds.some((d) => d.severity === x));
    if (sev) {
      li.dataset.severity = sev;
      li.append(`${SEVERITY_MARK[sev]} `);
    }
    li.append(n > 1 ? `${w} (×${n})` : w);
    if (ds.length) {
      const codes = [...new Set(ds.map((d) => d.code))];
      const src = ds.find((d) => d.source)?.source;
      const page = src?.page ?? (src?.sourceRef !== undefined && tree ? pageOfRef(tree, src.sourceRef) : undefined);
      const where = [src?.element, src?.line !== undefined ? msg(`${src.line} 行`, `line ${src.line}`) : undefined, page !== undefined ? msg(`${page + 1} ページ`, `page ${page + 1}`) : undefined].filter(Boolean).join(msg('・', ', '));
      const meta = document.createElement('span');
      meta.className = 'diag';
      meta.textContent = ` [${codes.join(', ')}]${where ? ` (${where})` : ''}`;
      li.append(meta);
      // ページが分かれば、押してそのページへ移る
      if (page !== undefined) {
        li.dataset.page = String(page);
        li.title = msg(`${page + 1} ページへ`, `go to page ${page + 1}`);
        li.addEventListener('click', () => document.getElementById(`page-${page + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    }
    ul.append(li);
  }
  if (items.length > WARNINGS_LIST_MAX) {
    const li = document.createElement('li');
    li.textContent = msg(`…ほか ${items.length - WARNINGS_LIST_MAX} 件`, `…and ${items.length - WARNINGS_LIST_MAX} more`);
    ul.append(li);
  }
  details.append(summary, ul);
  warnEl.append(details);
  return counts.size;
}
let currentReport: ImportReport | null = null;
/** 表示している変換レポートの文書の種類 (画像だけを足して出し直すときに使う) */
let currentReportKind: DocKind = 'fo';
let tree: AreaTree | null = null;
let engine: LayoutEngine | null = null;
let currentDoc: LDocument | null = null;
let currentName = 'kumiori-sample';
/** 画面に出している文書の種類と互換モード (PDF の設定に使う。サンプルは null)。組版・PDF の互換の設定は compat.ts (API と同じ) */
let currentCompat: { kind: DocKind; ah: boolean } | null = null;
/** 今の engine がアンテナハウス互換の設定 (kernAh) で作られているか */
let engineAh = false;

/** 左の一覧の縮小画像の幅 (CSS px) */
const THUMB_WIDTH = 120;
let pageObserver: IntersectionObserver | null = null;

function render() {
  if (!tree) return;
  const zoom = parseFloat(zoomEl.value);
  sheetsEl.replaceChildren();
  thumbsEl.replaceChildren();
  pageObserver?.disconnect();
  const thumbs: HTMLButtonElement[] = [];
  // いま見えているページを、左の一覧で示す
  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const k = Number((e.target as HTMLElement).dataset.page);
        thumbs.forEach((t, i) => t.classList.toggle('current', i === k));
      }
    },
    { root: $('viewport'), threshold: 0.5 },
  );
  tree.sheets.forEach((sheet, k) => {
    const fig = document.createElement('figure');
    fig.id = `page-${k + 1}`;
    fig.dataset.page = String(k);
    const cap = document.createElement('figcaption');
    cap.textContent = `${k + 1} / ${tree!.sheets.length} ページ — 仕上がり ${(sheet.trimBox.width / 72 * 25.4).toFixed(0)}×${(sheet.trimBox.height / 72 * 25.4).toFixed(0)}mm + 塗り足し ${(sheet.bleed / 72 * 25.4).toFixed(0)}mm`;
    const canvas = document.createElement('canvas');
    renderSheetToCanvas(sheet, canvas, fonts, { scale: (96 / 72) * zoom, guides: guidesEl.checked, assets });
    fig.append(cap, canvas);
    sheetsEl.append(fig);
    pageObserver!.observe(fig);
    // 左の一覧: 紙面の縮小画像 (描いた紙面を縮めて写す)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = `${k + 1} ページへ`;
    const th = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    const w = THUMB_WIDTH;
    const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
    th.width = Math.round(w * ratio);
    th.height = Math.round(h * ratio);
    th.style.width = `${w}px`;
    th.style.height = `${h}px`;
    th.getContext('2d')?.drawImage(canvas, 0, 0, th.width, th.height);
    const num = document.createElement('span');
    num.textContent = String(k + 1);
    btn.append(th, num);
    btn.addEventListener('click', () => fig.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    thumbsEl.append(btn);
    thumbs.push(btn);
  });
}

/** 論理ツリーを組版して画面に出す。compat を渡すと、文書の種類と互換モードを覚える (省くと前のまま。組み直しのとき) */
function showDocument(doc: LDocument, name: string, compat?: { kind: DocKind; ah: boolean } | null) {
  if (!measurerRef) return;
  if (compat !== undefined) currentCompat = compat;
  // 互換モードの組版の設定が今の engine と違えば作り直す (アンテナハウス互換では字の組の詰め方が変わる)
  const ah = !!currentCompat?.ah;
  if (!engine || engineAh !== ah) {
    engine = new LayoutEngine(fonts, measurerRef, { defaultFontFamily: SERIF, assets, hyphenate: hyphenPositions, ...compatLayoutOptions(ah) });
    engineAh = ah;
  }
  currentDoc = doc;
  currentName = name;
  setStatus('組版中…');
  const t0 = performance.now();
  tree = engine.layout(doc);
  const ms = performance.now() - t0;
  pdfWarnings = [];
  const warned = showWarnings([...loadWarnings, ...formatEntries(), ...treeEntries(tree)]);
  render();
  // 警告の件数は、帯の状態の欄にも出す (左の欄をたたんでいても、狭い画面でも気付けるように)
  setStatus(`${name}: ${tree.sheets.length} ページ / 組版 ${ms.toFixed(0)}ms${warned ? ` / ${warningCountText(warned)}` : ''}`);
  downloadBtn.disabled = false;
  saveJsonBtn.disabled = false;
  (window as unknown as { __kumiori: unknown }).__kumiori = { tree, fonts, measurer: engine ? measurerRef : null, engine, renderPdf, doc, assets };
}

let measurerRef: Measurer | null = null;

/** 変換レポートの表示。kind: 文書の種類 (見出しと文言を、XSL-FO か HTML (EPUB を含む) かに合わせる。省略時は前と同じ種類) */
function showReport(name: string, r: ImportReport | null, kind: DocKind = currentReportKind) {
  currentReport = r;
  currentReportKind = kind;
  if (!r) {
    reportEl.hidden = true;
    return;
  }
  const missingImgs = r.images.filter((s) => !assets.get(s));
  const miss = Object.entries(r.unsupported).sort((a, b) => b[1] - a[1]);
  const c = r.counts;
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  const fo = kind === 'fo';
  // 見出し・文言は、文書の種類に合わせる (HTML の文書を「XSL-FO 変換レポート」と出さない)
  const title = fo ? msg('XSL-FO 変換レポート', 'XSL-FO conversion report') : msg('HTML 変換レポート', 'HTML conversion report');
  const withDoc = fo ? msg('FO と一緒に', 'together with the FO file') : msg('HTML と一緒に', 'together with the HTML file');
  const none = fo ? msg('未対応の要素・属性はありません', 'No unsupported elements or attributes') : msg('未対応の CSS はありません', 'No unsupported CSS');
  reportEl.innerHTML = `<summary>${title}: ${esc(name)}${msg(`（未対応 ${miss.length} 種）`, ` (${miss.length} unsupported)`)}</summary>
    <div>page-sequence ${c.sequences} / block ${c.blocks} / 表 ${c.tables} / 脚注 ${c.footnotes} / float ${c.floats} / ルビ ${c.rubies}</div>
    ${r.images.length ? `<div>画像: ${r.images.length - missingImgs.length} / ${r.images.length} 個を読み込み済み${missingImgs.length ? `。見つからない画像 (灰色の枠で表示): ${missingImgs.map(esc).join(', ')} — ${withDoc}画像ファイルも選択してください (複数選択できます)` : ''}</div>` : ''}
    ${miss.length ? `<table>${miss.map(([k, v]) => `<tr><td>${v}</td><td>${esc(k)}</td></tr>`).join('')}</table>` : `<div>${none}</div>`}
    ${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  reportEl.hidden = false;
}

/** 利用者が読み込んだ書体 (MS 明朝など) */
const userFonts: UserFont[] = [];
/** 書体の名前 (FO の font-family に書く和名・英名など) → 読み込んだ書体のファミリ名の表 (利用者が読み込んだ書体は document、@font-face は face) */
const fontNames = new FontNameTable();
/** 書体の割り当て (利用者が読み込んだ書体を含む) */
const { mapFoFont, mapHtmlFont, htmlNormalLineHeight, loadFontFaces, usesMono } = createFontMapping(fonts, fontNames);

async function registerUserFont(f: UserFont): Promise<boolean> {
  if (userFonts.some((u) => u.family === f.family && u.weight === f.weight && u.style === f.style)) return false;
  // 斜体・斜めの書体は、同じファミリーの傾きの違う書体として登録する (font-style の指定で選ばれる。CSS Fonts 4 §5.2)
  await fonts.registerBuffer(f.family, f.weight, f.buffer, true, undefined, f.style ? { style: f.style } : undefined);
  userFonts.push(f);
  // FO の font-family 名 (和名・全角・空白の違いは吸収) から引けるようにする
  fontNames.add('document', f.names, f.family);
  return true;
}

/** 数式用の書体 (MATH_SPEC) を 1 度だけ読み込む (取れなければそのまま。数式は本文の書体で組む) */
const loadMathFont = async () => {
  if (!fonts.has(MATH_SPEC.family)) await fonts.load(MATH_SPEC, setStatus).catch(noteError);
};
/** 文書が参照する http(s) の画像を取るか: 自分の計算機 (localhost) の URL は取らない */
const allowRemoteImage = (url: string) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url);

/** 文書のファイルを読む。文字の符号化は BOM・XML 宣言の encoding・<meta charset> で決める (File.text() の UTF-8 固定にしない) */
const readDocument = async (f: File) => decodeDocumentText(new Uint8Array(await f.arrayBuffer()));

/** 取らなかった画像 (自分の計算機の URL) を、警告に足す (typeset の「画像を取りません」と同じ文) */
function noteNotFetched(srcs: string[]) {
  for (const src of srcs) loadWarnings.push(entryOf(diag('resource/not-fetched', msg(`画像を取りません: ${src.slice(0, 200)}`, `image not fetched: ${src.slice(0, 200)}`), { url: src.slice(0, 200), kind: 'image' })));
}
/** 読み込みの報告のうち、黙って無視しないもの (未対応の指定・動作を書かなかったリンク) を、警告に足す (typeset の warnings と同じ文) */
function noteReport(report: ImportReport, isFo: boolean, unknownCss?: Record<string, number>) {
  const missText = (item: string) => msg(`${isFo ? '未対応の XSL-FO の要素・プロパティを' : '未対応の CSS を'}無視しました: ${item}`, `ignored unsupported ${isFo ? 'XSL-FO elements/properties' : 'CSS'}: ${item}`);
  const miss = summarizeCounts(report.unsupported);
  if (miss) loadWarnings.push({ text: missText(miss), diags: countedDiagnostics(report.unsupported, (item) => diag(isFo ? 'fo/unsupported' : 'css/unsupported', missText(item), { item }, report.unsupportedAt?.[item])) });
  const dropped = summarizeDroppedLinks(report.droppedLinks);
  if (dropped) loadWarnings.push(entryOf(diag('link/action-dropped', droppedLinkWarning(dropped, 'read'))));
  // 読み込みが上限に当たったことの診断 (タグ付き PDF の表の構造の上限など。ライブラリの typeset が出すものと同じ)
  for (const d of report.diagnostics ?? []) loadWarnings.push(entryOf(d));
  const unknownText = (p: string) => msg(`知らない CSS のプロパティを無視しました (綴りの誤りか未対応): ${p}`, `ignored unknown CSS properties (misspelled or unsupported): ${p}`);
  const unknown = summarizeCounts(unknownCss);
  if (unknown) loadWarnings.push({ text: unknownText(unknown), diags: countedDiagnostics(unknownCss, (property) => diag('css/unknown-property', unknownText(property), { property })) });
}

/**
 * HTML の既定の用紙 (@page で size を指定していない文書の用紙。API の pageSize・コマンドの --page-size と同じ。既定 A4) と余白 20mm。
 * 自由入力は CSS の size の書き方 (A5 landscape・148mm 210mm。語の区切りはカンマでもよい)。読めない値なら undefined
 */
function defaultPageOf(): { width: number; height: number; margin: number } | undefined {
  const v = pageSizeEl.value === 'custom' ? pageSizeCustom.value.split(/[\s,]+/).filter(Boolean).join(' ') : pageSizeEl.value;
  const size = parsePageSize(v);
  return size ? { ...size, margin: 20 } : undefined;
}

let lastFo: { text: string; name: string } | null = null;
/** 画面に出している文書の元 (読み込んだ XSL-FO・HTML。サンプルなら null)。設定を変えたら、これを組み直す */
let lastSource: 'fo' | 'html' | null = null;

/**
 * 読み込みの世代。読み込み (loadFo・loadHtmlFile) は、書体・分綴の規則・画像を待つ間に、次の読み込み (設定の変更での組み直し・別のファイル) が
 * 始まりうる。待った後に世代が変わっていたら、古い読み込みの結果を画面に出さない (後から終わった古い結果が、新しい結果を上書きしないように)
 */
let loadGen = 0;
class StaleLoad extends Error {}
/**
 * ファイルを開いた順の番号 (openFiles の呼び出しごと)、最新の文書を選んだ番号、選んだが読み込み (loadFo・loadHtmlFile) をまだ始めていない文書の番号 (無ければ 0)。
 * pendingDocSeq は、openFiles がどの終わり方 (読み込みを始めた・stale・誤り) でも消す
 */
let openSeq = 0;
let latestDocSeq = 0;
let pendingDocSeq = 0;
/** 文書を開く途中 (pendingDocSeq のある間) に、組み直しを見送った (設定の変更・画像だけの追加)。その文書を読み込まずに終わったら、そこで組み直す */
let refreshDeferred = false;
/** 走っている読み込み (loadFo・loadHtmlFile) の数。文書を選んで世代を上げると、走っている読み込み (設定の変更での組み直しなど) を捨てるので、見送りとして覚える */
let runningLoads = 0;
/** 文書を開く途中なら、組み直しを見送る (開いている文書は、読み込みを始める時点の設定・画像で組む)。見送ったら true */
function deferWhileOpening(): boolean {
  if (!pendingDocSeq) return false;
  refreshDeferred = true;
  return true;
}
/** openFiles が、選んだ文書 seq の読み込みを始める・始めずに終わる: 開く途中の印を消す。始めずに終わり、見送った組み直しがあれば、いまの文書を組み直す */
function endPendingDoc(seq: number, started: boolean) {
  if (pendingDocSeq !== seq) return;
  pendingDocSeq = 0;
  const deferred = refreshDeferred;
  refreshDeferred = false;
  if (started || !deferred) return;
  if (lastSource) reloadCurrent();
  else if (currentDoc) showDocument(currentDoc, currentName);
}
/** 読み込みを始め、待った後に呼ぶ確かめ (世代が変わっていたら StaleLoad を投げる) を返す */
function beginLoad(): () => void {
  const gen = ++loadGen;
  return () => {
    if (gen !== loadGen) throw new StaleLoad();
  };
}

async function loadFo(text: string, name: string) {
  runningLoads++;
  try {
    await loadFoBody(text, name);
  } finally {
    runningLoads--;
  }
}

async function loadFoBody(text: string, name: string) {
  const current = beginLoad();
  lastFo = { text, name };
  lastSource = 'fo';
  loadWarnings = [];
  try {
    // 分綴 (hyphenate="true") を使う文書なら、文書に出てくる言語の分綴の規則を先に読み込む (組版は同期で行うため)
    await loadFoHyphenators(text);
    current();
    // MathML のある文書なら、数式の書体を読み込む (読めなければ、本文の書体で組む。API と同じ手順: documentResources)
    const mathOpts = await mathOptionsFor(text, fonts, loadMathFont);
    current();
    const compat: FoCompat = foSpec.checked ? 'spec' : 'antenna';
    // XML の読み取りは、ライブラリと同じ (@xmldom/xmldom。内部実体の展開と、診断の場所の行・列)
    const res = importXslFo(text, (t) => xmlParse(t, name), {
      sourceName: name,
      ...mathOpts,
      // タグ付き PDF の構造の木 (設定の「タグ付き PDF にする」。既定で付ける)
      tagged: taggedEl.checked,
      // ゴシック・サンセリフ系は Noto Sans JP、それ以外 (明朝・serif・未指定) は Noto Serif JP。太字は、同じ書体の Bold (明朝系は和文が Noto Serif JP の Bold、欧文が Tinos の Bold。読み込んでいるフォントだけで組む)
      mapFont: mapFoFont,
      compat,
      bleedMm: foPrint.checked ? 3 : 0,
      trimMarks: foPrint.checked,
      // external-graphic が指す MathML のファイル (画像と一緒に選んだもの)
      readText: (src) => assets.getText(src),
    });
    // data URI / 絶対 URL の画像は、ここで読み込む (相対パスは、ユーザーが選んだファイルから解決する。API と同じ手順: documentResources)
    const notFetched = await fetchReportedImages(assets, res.report.images, allowRemoteImage);
    current();
    noteNotFetched(notFetched);
    noteReport(res.report, true);
    await ensureSymbolFont(res.document);
    current();
    showReport(name, res.report, 'fo');
    showDocument(res.document, name, { kind: 'fo', ah: isAntennaCompat(compat) });
    resetBtn.hidden = false;
  } catch (e) {
    if (e instanceof StaleLoad) return;
    console.error(e);
    setStatus(`変換エラー: ${String(e)}`);
  }
}

let lastHtml: { text: string; name: string; files: File[]; warnings: string[] } | null = null;

/** HTML を組む: 見えない iframe でスタイルを確定させ、論理ツリーに変換する。warnings は、HTML にする前の警告 (EPUB の飛ばした項目) */
async function loadHtmlFile(text: string, name: string, files: File[], warnings: string[] = []) {
  runningLoads++;
  try {
    await loadHtmlBody(text, name, files, warnings);
  } finally {
    runningLoads--;
  }
}

async function loadHtmlBody(text: string, name: string, files: File[], warnings: string[]) {
  const current = beginLoad();
  lastHtml = { text, name, files, warnings };
  lastSource = 'html';
  loadWarnings = warnings.map((text) => ({ text, diags: [] }));
  try {
    const v = htmlStyle.value;
    // 既定の用紙 (読めない自由入力のときは A4。入力の欄で知らせてある)
    const defaultPage = defaultPageOf() ?? { width: 210, height: 297, margin: 20 };
    // CSS の解釈: Kumiori (既定) なら、iframe を使わず、自前のカスケードの計算値で組む (ブラウザの計算値・配置 rect を使わない)。
    // ブラウザ (比較用) なら、見えない iframe に読み込んで、ブラウザの計算値と配置を使う
    const defaults = v === 'browser' || v === 'browser-margin' || v === 'ah' || v === 'vivliostyle' || v === 'weasyprint' ? v : 'kumiori';
    const loaded = await loadHtml(text, files, defaults, defaultPage, { noFrame: cssEngine.value === 'kumiori' });
    try {
      current();
      // 検証用: 読み込んだ文書 (iframe を消す前) を渡す (scripts/compare-css.mjs がブラウザの計算値と自前のカスケードを比べる)
      await (window as unknown as { __kumioriOnHtmlLoaded?: (l: typeof loaded) => unknown }).__kumioriOnHtmlLoaded?.(loaded);
      await loadFontFaces(loaded.css, files, { ahFaceWeight: v === 'ah' });
      // 分綴を使う文書なら、文書に出てくる言語の分綴の規則を読み込む
      await loadDocumentHyphenators(loaded.doc, loaded.css);
      // MathML のある文書なら、数式の書体を読み込む (読めなければ、math 要素の中の字を並べる。API と同じ手順: documentResources)
      const mathOpts = await mathOptionsFor(text, fonts, loadMathFont);
      current();
      const res = importHtml(loaded.doc, loaded.styles, {
        ...mathOpts,
        tagged: taggedEl.checked,
        mapFont: mapHtmlFont,
        hasAsset: (src) => !!assets.get(src),
        imageSize: (src) => assets.get(src),
        // flex の項目の中身の幅 (ブラウザの配置が無いとき) は、組版と同じ字幅で測る
        measureText: (t, st) => (measurerRef ? measurerRef.textAdvance(t, st, { kerning: st.kerning, features: st.features }) : t.length * st.fontSize * 0.55),
        normalLineHeight: htmlNormalLineHeight,
        // 既定のスタイルごとの読み込みの設定 (アンテナハウス互換・ブラウザ。compat.ts。API と同じ)
        ...htmlImportCompatOptions(defaults),
        css: loaded.css,
        defaultPage,
        bleedMm: foPrint.checked ? 3 : 0,
        trimMarks: foPrint.checked,
      });
      // ネットワーク上の画像 (絶対 URL)・data URI の画像は、ここで読み込む (相対パスは、一緒に選んだファイルから。API と同じ手順: documentResources)
      const notFetched = await fetchReportedImages(assets, res.report.images, allowRemoteImage);
      current();
      noteNotFetched(notFetched);
      // 用意の途中の警告 (深すぎる入れ子・多すぎる @import) と、作成者スタイルシート・style 属性の、読まない宣言 (未対応・知らないプロパティ。API と同じ数え方)
      loadWarnings.push(...loaded.warnings.map(entryOf));
      const cssRep = unsupportedCssReport(loaded.authorSheet, loaded.doc);
      const unsupported = { ...res.report.unsupported };
      for (const [k, n] of Object.entries(cssRep.unsupported)) unsupported[k] = (unsupported[k] ?? 0) + n;
      const report = { ...res.report, unsupported };
      noteReport(report, false, cssRep.unknown);
      await ensureSymbolFont(res.document);
      current();
      showReport(name, report, 'html');
      showDocument(res.document, name, { kind: 'html', ah: v === 'ah' });
      resetBtn.hidden = false;
    } finally {
      loaded.dispose();
    }
  } catch (e) {
    if (e instanceof StaleLoad) return;
    console.error(e);
    setStatus(`HTML の変換エラー: ${String(e)}`);
  }
}

async function main() {
  try {
    await fonts.loadAll([...FONT_SPECS, ...LATIN_SPECS], setStatus);
    setupDefaultFonts(fonts);
    measurerRef = new Measurer(fonts, 'canvas');
    for (const f of await loadUserFonts()) await registerUserFont(f);
    clearFontsBtn.hidden = !userFonts.length;
    // draw.io の図の設定 (ブラウザに覚えたもの。既定で読む)
    drawioOn.checked = remember('kumiori.drawio') !== '0';
    drawioFetch.checked = remember('kumiori.drawioFetch') === '1';
    // タグ付き PDF にするか (ブラウザに覚えたもの。既定で付ける)
    taggedEl.checked = remember('kumiori.tagged') !== '0';
    addStencils(await loadUserStencils());
    await drawioChanged();
    showDocument(buildSampleDocument(), 'Kumiori サンプル', null);
    document.documentElement.dataset.ready = '1';
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${String(e)}`);
  }
}

/** 文書のファイルか (HTML・XHTML・XSL-FO・EPUB) */
const isDocument = (f: File) => /\.(html?|xhtml|fo|epub)$/i.test(f.name);

/**
 * フォルダの中のファイル (webkitRelativePath を持つ) から、組む文書を 1 つ選ぶ: index.html → 浅い場所の文書 → 名前の順。
 * ほかの文書は選んだファイルから外す (画像・CSS・書体はすべて残す)
 */
function pickFromFolder(files: File[]): File[] {
  const docs = files.filter(isDocument);
  if (docs.length <= 1) return files;
  const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const depth = (f: File) => path(f).split('/').length;
  const chosen = [...docs].sort((a, b) => Number(/^index\.x?html?$/i.test(b.name)) - Number(/^index\.x?html?$/i.test(a.name)) || depth(a) - depth(b) || path(a).localeCompare(path(b)))[0];
  setStatus(`フォルダに文書が ${docs.length} 個あります。${path(chosen)} を開きます`);
  return files.filter((f) => !isDocument(f) || f === chosen);
}

/** 選んだ (またはドラッグ&ドロップした) ファイルを開く */
async function openFiles(files: File[]) {
  if (!files.length) return;
  // 選んだ順の番号 (どの呼び出しでも取る) と、読み込みの世代 (loadGen) を分けて持つ。文書 (XSL-FO・HTML・EPUB。中身で XSL-FO と分かった
  // .xml・.xsl も) と分かった時点で、自分より後に選んだ文書がまだ無ければ、自分を最新の文書として世代を上げる (claimDocument)。
  // ファイルを読む・画像を登録する間に、後から選んだ文書の読み込み・「見本の文書に戻す」があれば、この文書は出さない (stale)。
  // 画像・MathML・図形ライブラリだけの追加は、世代を上げずに覚えるだけにする (上げると、先に落とした文書の読み込みを捨てる)
  const seq = ++openSeq;
  let gen = loadGen;
  const stale = () => gen !== loadGen;
  const claimDocument = () => {
    if (seq > latestDocSeq) {
      latestDocSeq = seq;
      // 見送った組み直しの印は消さない (前に選んだ文書の開く途中に見送ったものは、この文書が読み込みを始めずに終わったら行う)
      pendingDocSeq = seq;
      // 走っている読み込みは、世代を上げると捨てる。この文書が読み込みを始めずに終わったら、いまの文書を組み直す (捨てた組み直しを戻す)
      if (runningLoads) refreshDeferred = true;
      gen = ++loadGen;
    } else gen = Number.NaN; // 後から選んだ文書が先に分かった: この文書は出さない
  };
  let claimed = false;
  const claim = () => {
    claimed = true;
    claimDocument();
  };
  if (files.some(isDocument)) claim();
  try {
    await openClaimed(files, seq, () => claimed && stale(), claim, stale);
  } finally {
    // どの終わり方でも、開く途中の印を消す (壊れた EPUB・stale で終わった後も、画像だけの追加・設定の変更で組み直す)
    endPendingDoc(seq, false);
  }
}

/**
 * openFiles の本体。stale: 文書を選んだ呼び出しで、世代が変わった (その文書を出さない)。
 * genChanged: 世代が変わった (文書を選んでいない、画像・MathML だけの追加でも。登録の間に組み直しが走ったら、足した画像で組み直す)
 */
async function openClaimed(files: File[], seq: number, stale: () => boolean, claimDocument: () => void, genChanged: () => boolean) {
  // EPS の時間の予算 (eps.ts の EPS_DOCUMENT_MILLIS) は、画像の入れ物に結び付いている。入れ物は開き直しても使い続けるので、予算は文書を開くたびに戻す
  resetEpsBudget(assets);
  formatWarnings.clear();
  // 一緒に渡した draw.io の図形ライブラリは、この画面の間だけ使う (覚えておくのは設定の「図形ライブラリを読み込む」)
  const libs: UserStencilFile[] = [];
  const rest: File[] = [];
  for (const f of files) {
    const text = /\.(js|xml)$/i.test(f.name) ? await f.text() : undefined;
    if (text !== undefined && isStencilFile(f.name, text)) libs.push({ name: f.name, data: text });
    else rest.push(f);
  }
  if (libs.length) {
    addStencils(libs);
    files = rest;
    if (!files.length) {
      setStatus(`draw.io の図形ライブラリを読み込みました: ${libs.map((l) => l.name).join('、')}`);
      await drawioChanged();
      return;
    }
    assets.setFormats(formatsOf(undefined, currentDrawio()));
  }
  // EPUB: 1 つの HTML (と画像) にまとめて、HTML として組む
  const epub = files.find((f) => /\.epub$/i.test(f.name));
  if (epub) {
    try {
      const book = await readEpub(new Uint8Array(await epub.arrayBuffer()), (t, type) => new DOMParser().parseFromString(t, type));
      for (const im of book.images) await addImage(im.name, new Blob([im.data as BlobPart]));
      if (stale()) return;
      endPendingDoc(seq, true);
      // 上限を超えて飛ばした章・CSS・画像 (EpubBook.warnings) も、警告に出す
      await loadHtmlFile(book.html, epub.name, [], book.warnings ?? []);
    } catch (e) {
      console.error(e);
      setStatus(`エラー: ${String(e)}`);
    }
    return;
  }
  // HTML (と CSS・画像) を選んだとき
  const html = files.find((f) => /\.(html?|xhtml)$/i.test(f.name));
  if (html) {
    for (const f of files) if (f !== html && !/\.(css|ttf|otf|ttc|woff2?)$/i.test(f.name)) await addImage(f.name, f);
    const text = await readDocument(html);
    if (stale()) return;
    endPendingDoc(seq, true);
    await loadHtmlFile(text, html.name, files);
    return;
  }
  // FO は .fo を優先し、無ければ fo:root を含む .xml / .xsl (MathML の .xml と区別する)
  let fo = files.find((f) => /\.fo$/i.test(f.name));
  if (!fo) for (const f of files) if (!fo && /\.(xml|xsl)$/i.test(f.name) && /<([\w-]+:)?root[\s>]/.test(await f.text())) fo = f;
  // 中身で XSL-FO と分かった .xml・.xsl も文書 (選んだ順で、自分より後の文書がまだ無ければ、最新の文書にする)
  if (fo && !/\.fo$/i.test(fo.name)) claimDocument();
  // FO 以外のファイルは画像 (と MathML) として登録する (ファイル名で FO 中の相対パスと突き合わせる)
  for (const f of files) if (f !== fo) await addImage(f.name, f);
  const foText = fo ? await readDocument(fo) : undefined;
  if (stale()) return;
  if (fo) {
    endPendingDoc(seq, true);
    await loadFo(foText!, fo.name);
    return;
  }
  // 画像・MathML だけの追加: 先に選んだ文書をまだ開く途中なら、組み直さない (その文書が、足した画像・MathML で組む。組み直すと、
  // 前の文書の読み込みが世代を上げて、先に選んだ文書を捨てていた)。その文書を読み込まずに終わったら、そこで組み直す (endPendingDoc)
  if (deferWhileOpening()) return;
  if (genChanged()) {
    // 画像を登録する間に、組み直し (設定の変更・書体の追加など) が始まった・終わった: その組み直しが足した画像を見ていないことがあるので、
    // いまの文書を組み直す (前は、戻ってしまい、画像を登録したのに「画像: 0 / 40 個」のままだった)
    if (lastSource) reloadCurrent();
    else if (currentDoc) showDocument(currentDoc, currentName);
    return;
  }
  if (lastSource === 'fo' && lastFo && files.some((f) => assets.getText(f.name) !== undefined)) {
    // MathML のファイルが追加された: 変換からやり直す (数式は変換時に行内の要素へ組み替えるため)。いま出している文書が XSL-FO のときだけ
    // (HTML を開いた後に、前に開いた XSL-FO を組み直さない)
    await loadFo(lastFo.text, lastFo.name);
  } else if (currentDoc) {
    // 画像だけ追加された: 現在の文書を組み直す
    showReport(currentName, currentReport);
    showDocument(currentDoc, currentName);
  }
}

foFile.addEventListener('change', () => {
  const files = Array.from(foFile.files ?? []);
  foFile.value = '';
  void openFiles(files);
});
folderFile.addEventListener('change', () => {
  const files = Array.from(folderFile.files ?? []);
  folderFile.value = '';
  void openFiles(pickFromFolder(files));
});

// 画面にドラッグ&ドロップしたファイルを開く (フォルダをドロップしたときは、中のファイルをすべて読む)
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((it) => (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
      return;
    }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    // readEntries は一度に全部を返すとは限らないので、空になるまで読む
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await walk(c);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropzoneEl.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzoneEl.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  dropzoneEl.hidden = true;
  const files = await filesFromDrop(e.dataTransfer);
  void openFiles(files.some((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath) || files.filter(isDocument).length > 1 ? pickFromFolder(files) : files);
});

// 設定の引き出し・ページの一覧の開け閉め (開け閉めは、この PC のブラウザに覚えておく)
const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    /* 覚えられなくても動く */
  }
  return null;
};
const setSettingsOpen = (open: boolean) => {
  settingsEl.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
  remember('kumiori.settings', open ? '1' : '0');
};
settingsBtn.addEventListener('click', () => setSettingsOpen(settingsBtn.getAttribute('aria-expanded') !== 'true'));
setSettingsOpen(remember('kumiori.settings') === '1');
const setSidebarOpen = (open: boolean) => {
  sidebarEl.classList.toggle('collapsed', !open);
  sideToggle.textContent = open ? '‹' : '›';
  sideToggle.title = sideToggle.ariaLabel = open ? 'ページの一覧をたたむ' : 'ページの一覧を開く';
  remember('kumiori.sidebar', open ? '1' : '0');
};
sideToggle.addEventListener('click', () => setSidebarOpen(sidebarEl.classList.contains('collapsed')));
setSidebarOpen(remember('kumiori.sidebar') !== '0');
fontFile.addEventListener('change', async () => {
  const files = Array.from(fontFile.files ?? []);
  fontFile.value = '';
  const added: string[] = [];
  for (const file of files) {
    const list = splitFontFile(await file.arrayBuffer());
    if (!list.length) setStatus(`${file.name}: 読み込める書体がありません`);
    for (const f of list) {
      if (await registerUserFont(f)) {
        added.push(f.family);
        void saveUserFont(f);
      }
    }
  }
  if (!added.length) return;
  clearFontsBtn.hidden = false;
  setStatus(`書体を読み込みました: ${added.join(', ')}`);
  // いま出している文書 (XSL-FO・HTML。見本なら見本) を組み直す (HTML を出しているときに、前に開いた XSL-FO に戻さない)
  if (deferWhileOpening()) return;
  if (lastSource) reloadCurrent();
  else if (currentDoc) showDocument(currentDoc, currentName);
});
drawioOn.addEventListener('change', async () => {
  remember('kumiori.drawio', drawioOn.checked ? '1' : '0');
  await drawioChanged();
});
stencilFile.addEventListener('change', async () => {
  const files = Array.from(stencilFile.files ?? []);
  stencilFile.value = '';
  const ok: UserStencilFile[] = [];
  for (const file of files) {
    // draw.io の配布物の画像 (SAP のアイコンの中の画像など。img/lib/…/<名前>.png・.jpg を名前で引く) はバイト列で持つ。
    // 中身の頭で確かめる (PNG の署名: PNG (ISO/IEC 15948) §5.2、JPEG の SOI と次の印の頭: ITU-T T.81 §B.1.1.3・B.2.1)
    if (/\.(png|jpe?g)$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isPngOrJpeg(bytes)) ok.push({ name: file.name, data: bytes });
      else setStatus(`${file.name}: PNG・JPEG の画像として読めません`);
      continue;
    }
    const text = await file.text();
    // .svg は draw.io の配布物の画像 (SAP のアイコンの中の画像。img/lib/sap/<名前>.svg を名前で引く)
    if (isStencilFile(file.name, text) || (/\.svg$/i.test(file.name) && /<svg[\s>]/i.test(text.slice(0, 4096)))) ok.push({ name: file.name, data: text });
    else setStatus(`${file.name}: draw.io の図形ライブラリとして読めません`);
  }
  if (!addStencils(ok)) return;
  for (const f of ok) void saveUserStencil(f);
  setStatus(`draw.io の図形ライブラリを読み込みました: ${ok.map((f) => f.name).join('、')}`);
  await drawioChanged();
});
clearStencilsBtn.addEventListener('click', async () => {
  await clearUserStencils();
  stencilFiles = [];
  addStencils([]);
  setStatus('読み込んだ図形ライブラリを消しました');
  await drawioChanged();
});
drawioFetch.addEventListener('change', async () => {
  remember('kumiori.drawioFetch', drawioFetch.checked ? '1' : '0');
  await drawioChanged();
});
clearFontsBtn.addEventListener('click', async () => {
  await clearUserFonts();
  location.reload();
});
/** 設定を変えたら、画面に出している文書 (読み込んだ XSL-FO・HTML) をすぐ組み直す */
function reloadCurrent() {
  // 文書を開く途中なら、前の文書を組み直さない (組み直すと世代が上がり、開いている文書を捨てる。開いている文書は、読み込みを始める時点の設定で組む)
  if (deferWhileOpening()) return;
  if (lastSource === 'fo' && lastFo) void loadFo(lastFo.text, lastFo.name);
  else if (lastSource === 'html' && lastHtml) void loadHtmlFile(lastHtml.text, lastHtml.name, lastHtml.files, lastHtml.warnings);
}
// XSL-FO の既定値の流儀は XSL-FO に、トンボと塗り足しは XSL-FO と HTML の両方に効く
foSpec.addEventListener('change', () => {
  if (lastSource === 'fo') reloadCurrent();
});
foPrint.addEventListener('change', reloadCurrent);
// タグ付き PDF: 構造の木は読み込みで作るので、読み込み直す
taggedEl.addEventListener('change', () => {
  remember('kumiori.tagged', taggedEl.checked ? '1' : '0');
  reloadCurrent();
});
resetBtn.addEventListener('click', () => {
  // 世代を上げる (書体・画像を待っている読み込みが、後から終わって文書を出さないように)。選んだ順でも、いま選んだ文書として数える
  beginLoad();
  latestDocSeq = ++openSeq;
  pendingDocSeq = 0;
  refreshDeferred = false;
  lastSource = null;
  // 前に開いた文書も忘れる (戻した後に MathML・画像のファイルだけを開いたとき、前の文書を組み直さないように)
  lastFo = null;
  lastHtml = null;
  loadWarnings = [];
  showReport('', null);
  showDocument(buildSampleDocument(), 'Kumiori サンプル', null);
  resetBtn.hidden = true;
});
saveJsonBtn.addEventListener('click', () => {
  if (!currentDoc) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentDoc, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentName.replace(/\.[^.]+$/, '')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
// HTML の既定のスタイル・CSS の解釈を切り替えたら、読み込んだ HTML をすぐ組み直す
for (const sel of [htmlStyle, cssEngine])
  sel.addEventListener('change', () => {
    if (lastSource === 'html') reloadCurrent();
  });
// 既定の用紙を切り替えたら、読み込んだ HTML をすぐ組み直す。自由入力は、読める値になったときだけ組み直す
const pageSizeChanged = () => {
  const custom = pageSizeEl.value === 'custom';
  pageSizeCustom.hidden = !custom;
  const ok = !!defaultPageOf();
  pageSizeCustom.setAttribute('aria-invalid', String(custom && !ok));
  if (!ok) {
    if (pageSizeCustom.value.trim()) setStatus(msg(`既定の用紙 "${pageSizeCustom.value}" は読めません (A5 landscape・148mm 210mm のように、用紙の名前か幅と高さ)`, `cannot read the default page size "${pageSizeCustom.value}" (a paper name or a width and a height, like "A5 landscape" or "148mm 210mm")`));
    return;
  }
  if (lastSource === 'html') reloadCurrent();
};
pageSizeEl.addEventListener('change', pageSizeChanged);
pageSizeCustom.addEventListener('change', pageSizeChanged);
// ブラウザ検証用: window.__kumioriLoadHtml(text, name)
(window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml = (t, n) => loadHtmlFile(t, n, []);
// ブラウザ検証用: window.__kumioriLoadFo(text, name)
(window as unknown as { __kumioriLoadFo: typeof loadFo }).__kumioriLoadFo = loadFo;

downloadBtn.addEventListener('click', async () => {
  if (!tree) return;
  downloadBtn.disabled = true;
  setStatus('PDF 生成中（フォント埋め込み）…');
  try {
    // PDF に動作を書かなかったリンク (安全のため落としたもの) と、PDF を書く途中の警告 (描けない字・色つきの字形など) は、警告に足す
    const out: string[] = [];
    const outDiags: Diagnostic[] = [];
    const bytes = await renderPdf(tree, fonts, { assets, ...(currentCompat ? compatPdfOptions(currentCompat.kind, currentCompat.ah) : {}), ...(taggedEl.checked ? { tagged: true } : {}), linkWarnings: out, warnings: out, diagnostics: outDiags });
    pdfWarnings = out.map((w) => ({ text: w, diags: outDiags.filter((d) => d.message === w) }));
    showWarnings([...loadWarnings, ...formatEntries(), ...treeEntries(tree), ...pdfWarnings]);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentName.replace(/\.[^.]+$/, '')}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`PDF を出力しました (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(e);
    setStatus(`PDF 生成エラー: ${String(e)}`);
  } finally {
    downloadBtn.disabled = false;
  }
});
guidesEl.addEventListener('change', render);
zoomEl.addEventListener('input', render);

void main();
