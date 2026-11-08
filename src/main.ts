import { FontManager } from './fontManager';
import { Measurer } from './measurer';
import { LayoutEngine } from './layoutEngine';
import { renderSheetToCanvas } from './canvasRenderer';
import { renderPdf } from './pdfRenderer';
import { AssetStore } from './assets';
import { SERIF, buildSampleDocument } from './sampleData';
import { browserParse, importXslFo, type ImportReport } from './xslfoImport';
import type { AreaTree, LDocument } from './types';
import { splitFontFile, type UserFont } from './fontLoader';
import { clearUserFonts, loadUserFonts, saveUserFont } from './userFonts';
import { decodeDocumentText } from './documentText';
import { hyphenPositions, loadDocumentHyphenators } from './hyphenation';
import { AH_HTML_IMPORT_OPTIONS, compatLayoutOptions, compatPdfOptions, isAntennaCompat, loadFoHyphenators, type DocKind, type FoCompat } from './compat';
import { fetchReportedImages, mathOptionsFor } from './documentResources';
import { importHtml } from './htmlImport';
import { loadHtml } from './htmlFrame';
import { readEpub } from './epub';
import { FONT_SPECS, FontNameTable, LATIN_SPECS, MATH_SPEC, MONO_SPECS, SYMBOL_SPEC, createFontMapping, hasMissingGlyphs, setupDefaultFonts } from './fontMapping';

let symbolsTried = false;
let monoTried = false;

/**
 * 文書の文字に、読み込み済みのどの書体も持たない字があれば、記号の書体を読み込む (1 度だけ。取れなければそのまま組む)。
 * 読み込んだ書体は、字の書体の代替 (FontManager.getForChar) で使われる
 */
async function ensureSymbolFont(doc: LDocument) {
  // 等幅の指定があれば、等幅の書体を読み込む (1 度だけ。取れなければ和文の書体で組む)
  if (!monoTried && usesMono()) {
    monoTried = true;
    for (const spec of MONO_SPECS) await fonts.load(spec, setStatus).catch((e) => console.warn(String(e)));
  }
  if (symbolsTried || !hasMissingGlyphs(fonts, doc)) return;
  symbolsTried = true;
  try {
    await fonts.load(SYMBOL_SPEC, setStatus);
  } catch (e) {
    console.warn(String(e));
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
const cssEngine = $<HTMLSelectElement>('cssengine');
const saveJsonBtn = $<HTMLButtonElement>('savejson');
const resetBtn = $<HTMLButtonElement>('resetsample');
const folderFile = $<HTMLInputElement>('folderfile');
const settingsBtn = $<HTMLButtonElement>('settingsbtn');
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
const assets = new AssetStore();
let currentReport: ImportReport | null = null;
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
  const uniq = [...new Set(tree.warnings)];
  warnEl.textContent = uniq.length ? `⚠ 警告 ${uniq.length} 件: ${uniq.join(' / ')}` : '';
  render();
  setStatus(`${name}: ${tree.sheets.length} ページ / 組版 ${ms.toFixed(0)}ms`);
  downloadBtn.disabled = false;
  saveJsonBtn.disabled = false;
  (window as unknown as { __kumiori: unknown }).__kumiori = { tree, fonts, measurer: engine ? measurerRef : null, engine, renderPdf, doc, assets };
}

let measurerRef: Measurer | null = null;

/** 変換レポートの表示 */
function showReport(name: string, r: ImportReport | null) {
  currentReport = r;
  if (!r) {
    reportEl.hidden = true;
    return;
  }
  const missingImgs = r.images.filter((s) => !assets.get(s));
  const miss = Object.entries(r.unsupported).sort((a, b) => b[1] - a[1]);
  const c = r.counts;
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  reportEl.innerHTML = `<summary>XSL-FO 変換レポート: ${esc(name)}（未対応 ${miss.length} 種）</summary>
    <div>page-sequence ${c.sequences} / block ${c.blocks} / 表 ${c.tables} / 脚注 ${c.footnotes} / float ${c.floats} / ルビ ${c.rubies}</div>
    ${r.images.length ? `<div>画像: ${r.images.length - missingImgs.length} / ${r.images.length} 個を読み込み済み${missingImgs.length ? `。見つからない画像 (灰色の枠で表示): ${missingImgs.map(esc).join(', ')} — FO と一緒に画像ファイルも選択してください (複数選択できます)` : ''}</div>` : ''}
    ${miss.length ? `<table>${miss.map(([k, v]) => `<tr><td>${v}</td><td>${esc(k)}</td></tr>`).join('')}</table>` : '<div>未対応の要素・属性はありません</div>'}
    ${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  reportEl.hidden = false;
}

/** 利用者が読み込んだ書体 (MS 明朝など) */
const userFonts: UserFont[] = [];
/** 書体の名前 (FO の font-family に書く和名・英名など) → 読み込んだ書体のファミリ名の表 (利用者が読み込んだ書体は document、@font-face は face) */
const fontNames = new FontNameTable();
/** 書体の割り当て (利用者が読み込んだ書体を含む) */
const { mapFont, mapHtmlFont, htmlNormalLineHeight, loadFontFaces, usesMono } = createFontMapping(fonts, fontNames);

async function registerUserFont(f: UserFont): Promise<boolean> {
  if (userFonts.some((u) => u.family === f.family && u.weight === f.weight)) return false;
  await fonts.registerBuffer(f.family, f.weight, f.buffer, true);
  userFonts.push(f);
  // FO の font-family 名 (和名・全角・空白の違いは吸収) から引けるようにする
  fontNames.add('document', f.names, f.family);
  return true;
}

/** 数式用の書体 (MATH_SPEC) を 1 度だけ読み込む (取れなければそのまま。数式は本文の書体で組む) */
const loadMathFont = async () => {
  if (!fonts.has(MATH_SPEC.family)) await fonts.load(MATH_SPEC, setStatus).catch((e) => console.warn(String(e)));
};
/** 文書が参照する http(s) の画像を取るか: 自分の計算機 (localhost) の URL は取らない */
const allowRemoteImage = (url: string) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url);

/** 文書のファイルを読む。文字の符号化は BOM・XML 宣言の encoding・<meta charset> で決める (File.text() の UTF-8 固定にしない) */
const readDocument = async (f: File) => decodeDocumentText(new Uint8Array(await f.arrayBuffer()));

let lastFo: { text: string; name: string } | null = null;
/** 画面に出している文書の元 (読み込んだ XSL-FO・HTML。サンプルなら null)。設定を変えたら、これを組み直す */
let lastSource: 'fo' | 'html' | null = null;

async function loadFo(text: string, name: string) {
  lastFo = { text, name };
  lastSource = 'fo';
  try {
    // 分綴 (hyphenate="true") を使う文書なら、文書に出てくる言語の分綴の規則を先に読み込む (組版は同期で行うため)
    await loadFoHyphenators(text);
    // MathML のある文書なら、数式の書体を読み込む (読めなければ、本文の書体で組む。API と同じ手順: documentResources)
    const mathOpts = await mathOptionsFor(text, fonts, loadMathFont);
    const compat: FoCompat = foSpec.checked ? 'spec' : 'antenna';
    const res = importXslFo(text, browserParse, {
      ...mathOpts,
      // ゴシック・サンセリフ系は Noto Sans JP、それ以外 (明朝・serif・未指定) は Noto Serif JP。明朝系の太字は欧文が Tinos の太字 (読み込んでいるフォントだけで組む)
      mapFont,
      compat,
      bleedMm: foPrint.checked ? 3 : 0,
      trimMarks: foPrint.checked,
      // external-graphic が指す MathML のファイル (画像と一緒に選んだもの)
      readText: (src) => assets.getText(src),
    });
    // data URI / 絶対 URL の画像は、ここで読み込む (相対パスは、ユーザーが選んだファイルから解決する。API と同じ手順: documentResources)
    await fetchReportedImages(assets, res.report.images, allowRemoteImage);
    showReport(name, res.report);
    await ensureSymbolFont(res.document);
    showDocument(res.document, name, { kind: 'fo', ah: isAntennaCompat(compat) });
    resetBtn.hidden = false;
  } catch (e) {
    console.error(e);
    setStatus(`変換エラー: ${String(e)}`);
  }
}

let lastHtml: { text: string; name: string; files: File[] } | null = null;

/** HTML を組む: 見えない iframe でスタイルを確定させ、論理ツリーに変換する */
async function loadHtmlFile(text: string, name: string, files: File[]) {
  lastHtml = { text, name, files };
  lastSource = 'html';
  try {
    const v = htmlStyle.value;
    // CSS の解釈: Kumiori (既定) なら、iframe を使わず、自前のカスケードの計算値で組む (ブラウザの計算値・配置 rect を使わない)。
    // ブラウザ (比較用) なら、見えない iframe に読み込んで、ブラウザの計算値と配置を使う
    const loaded = await loadHtml(text, files, v === 'browser' || v === 'browser-margin' || v === 'ah' || v === 'vivliostyle' || v === 'weasyprint' ? v : 'kumiori', undefined, { noFrame: cssEngine.value === 'kumiori' });
    try {
      // 検証用: 読み込んだ文書 (iframe を消す前) を渡す (scripts/compare-css.mjs がブラウザの計算値と自前のカスケードを比べる)
      await (window as unknown as { __kumioriOnHtmlLoaded?: (l: typeof loaded) => unknown }).__kumioriOnHtmlLoaded?.(loaded);
      await loadFontFaces(loaded.css, files);
      // 分綴を使う文書なら、文書に出てくる言語の分綴の規則を読み込む
      await loadDocumentHyphenators(loaded.doc, loaded.css);
      // MathML のある文書なら、数式の書体を読み込む (読めなければ、math 要素の中の字を並べる。API と同じ手順: documentResources)
      const mathOpts = await mathOptionsFor(text, fonts, loadMathFont);
      const res = importHtml(loaded.doc, loaded.styles, {
        ...mathOpts,
        mapFont: mapHtmlFont,
        hasAsset: (src) => !!assets.get(src),
        imageSize: (src) => assets.get(src),
        // flex の項目の中身の幅 (ブラウザの配置が無いとき) は、組版と同じ字幅で測る
        measureText: (t, st) => (measurerRef ? measurerRef.glyphs(t, st, 'horizontal-tb').reduce((a, g) => a + g.advance, 0) : t.length * st.fontSize * 0.55),
        normalLineHeight: htmlNormalLineHeight,
        // アンテナハウス互換の読み込みの設定 (compat.ts。API と同じ)
        ...(v === 'ah' ? AH_HTML_IMPORT_OPTIONS : {}),
        css: loaded.css,
        bleedMm: foPrint.checked ? 3 : 0,
        trimMarks: foPrint.checked,
      });
      // ネットワーク上の画像 (絶対 URL)・data URI の画像は、ここで読み込む (相対パスは、一緒に選んだファイルから。API と同じ手順: documentResources)
      await fetchReportedImages(assets, res.report.images, allowRemoteImage);
      showReport(name, res.report);
      await ensureSymbolFont(res.document);
      showDocument(res.document, name, { kind: 'html', ah: v === 'ah' });
      resetBtn.hidden = false;
    } finally {
      loaded.dispose();
    }
  } catch (e) {
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
  // EPUB: 1 つの HTML (と画像) にまとめて、HTML として組む
  const epub = files.find((f) => /\.epub$/i.test(f.name));
  if (epub) {
    try {
      const book = await readEpub(new Uint8Array(await epub.arrayBuffer()), (t, type) => new DOMParser().parseFromString(t, type));
      for (const im of book.images) await assets.addBlob(im.name, new Blob([im.data as BlobPart]));
      await loadHtmlFile(book.html, epub.name, []);
    } catch (e) {
      console.error(e);
      setStatus(`エラー: ${String(e)}`);
    }
    return;
  }
  // HTML (と CSS・画像) を選んだとき
  const html = files.find((f) => /\.(html?|xhtml)$/i.test(f.name));
  if (html) {
    for (const f of files) if (f !== html && !/\.(css|ttf|otf|ttc|woff2?)$/i.test(f.name)) await assets.addBlob(f.name, f);
    await loadHtmlFile(await readDocument(html), html.name, files);
    return;
  }
  // FO は .fo を優先し、無ければ fo:root を含む .xml / .xsl (MathML の .xml と区別する)
  let fo = files.find((f) => /\.fo$/i.test(f.name));
  if (!fo) for (const f of files) if (!fo && /\.(xml|xsl)$/i.test(f.name) && /<([\w-]+:)?root[\s>]/.test(await f.text())) fo = f;
  // FO 以外のファイルは画像 (と MathML) として登録する (ファイル名で FO 中の相対パスと突き合わせる)
  for (const f of files) if (f !== fo) await assets.addBlob(f.name, f);
  if (fo) await loadFo(await readDocument(fo), fo.name);
  else if (lastFo && files.some((f) => assets.getText(f.name) !== undefined)) {
    // MathML のファイルが追加された: 変換からやり直す (数式は変換時に行内の要素へ組み替えるため)
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
  // 読み込み済みの XSL-FO を、新しい書体で組み直す
  if (lastFo && !resetBtn.hidden) await loadFo(lastFo.text, lastFo.name);
  else if (currentDoc) showDocument(currentDoc, currentName);
});
clearFontsBtn.addEventListener('click', async () => {
  await clearUserFonts();
  location.reload();
});
/** 設定を変えたら、画面に出している文書 (読み込んだ XSL-FO・HTML) をすぐ組み直す */
function reloadCurrent() {
  if (lastSource === 'fo' && lastFo) void loadFo(lastFo.text, lastFo.name);
  else if (lastSource === 'html' && lastHtml) void loadHtmlFile(lastHtml.text, lastHtml.name, lastHtml.files);
}
// XSL-FO の既定値の流儀は XSL-FO に、トンボと塗り足しは XSL-FO と HTML の両方に効く
foSpec.addEventListener('change', () => {
  if (lastSource === 'fo') reloadCurrent();
});
foPrint.addEventListener('change', reloadCurrent);
resetBtn.addEventListener('click', () => {
  lastSource = null;
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
// ブラウザ検証用: window.__kumioriLoadHtml(text, name)
(window as unknown as { __kumioriLoadHtml: (t: string, n: string) => Promise<void> }).__kumioriLoadHtml = (t, n) => loadHtmlFile(t, n, []);
// ブラウザ検証用: window.__kumioriLoadFo(text, name)
(window as unknown as { __kumioriLoadFo: typeof loadFo }).__kumioriLoadFo = loadFo;

downloadBtn.addEventListener('click', async () => {
  if (!tree) return;
  downloadBtn.disabled = true;
  setStatus('PDF 生成中（フォント埋め込み）…');
  try {
    const bytes = await renderPdf(tree, fonts, { assets, ...(currentCompat ? compatPdfOptions(currentCompat.kind, currentCompat.ah) : {}) });
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
