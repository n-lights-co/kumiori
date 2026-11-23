/**
 * pdfImage — PDF のページを図として貼るために、PDF を読み、貼るページと、その大きさ (箱)・回転を決める (design/pdf-as-image.md の 1 節)。
 *
 * PDF が出てきたときだけ、画像の置き場 (assets.ts) が import() で読み込む。読むのは「ページを探し、箱と回転を読む」まで
 * (ページの中身を描くのは PDF の出力だけ。画面・SVG・PNG は仮の枠)。
 *
 * - ページの選び方: 参照の fragment (RFC 3986 §3.5)。RFC 8118 §3 の page=N (1 から数える) はどのモードでも読む。
 *   アンテナハウスの拡張 (公開の説明書の「PDF の埋め込み」の節): ページの範囲 (page=3-5・page=3-・page=all) と、図の大きさにする箱
 *   (bbox=MediaBox|CropBox|BleedBox|TrimBox|ArtBox。既定は CropBox) は、接頭辞の無い名前に足された値・引数なので、互換の指定のときだけ読む
 *   (CLAUDE.md の「仕様の根拠」)。範囲は流さずに (流し書きは今後の版)、範囲の最初のページだけを貼る
 * - 箱: 既定は CropBox (無ければ MediaBox)。箱は MediaBox と重なる所に切り詰める (ISO 32000-1 §14.11.2)。MediaBox・CropBox・Rotate・Resources は
 *   親から受け継ぐ (§7.7.3.4、Table 30)。UserUnit (Table 30。PDF 1.6) があれば、1 単位を UserUnit/72 インチにする
 * - 回転: /Rotate (Table 30。90 の倍数。表示するときに時計回りに回す)。90・270 なら、図の幅と高さを入れ替える
 * - 安全: pdf-lib のページの木のたどり方 (getPages・ascend) は再帰で、輪を止めない (design/pdf-as-image.md の 8 節) ので使わない。
 *   ページの木は、ここで繰り返し (明示のスタック) でたどり、たどった印で輪を止め、深さ (pdfImageDepth)・ページの数 (pdfImagePages) を縛る。
 *   オブジェクトの数 (pdfImageObjects) は、読む前にバイト列の中の obj の語の数で見積もり、読む間にオブジェクトの流れ (ObjStm) の中の数 (N) を足し、
 *   読んだ後に数えた数でも確かめる。
 * - 読み込み (pdf-lib の読み手) は、ObjStm と相互参照の流れ (XRef) を解きながら読む。その流れは、解く前に替えて (pdfStreamGuard.ts の loadPdfGuarded)、
 *   解いた大きさを、pdfImageStreamBytes と、ファイルの大きさの PDF_OBJSTM_MAX_RATIO 倍 + PDF_OBJSTM_FREE_BYTES の小さい方で縛る (展開の比。imageLimits.ts の考え方)。
 *   時限 (pdfImageLoadMs) は、Promise の競争と、読み手の中の締め切りの両方で見る (流れを解く間はイベントループが止まるので、締め切りでも止める。
 *   時限が切れたら、読み手も止める)
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib';
import { rejoin, thisCall } from './callContext';
import { PDF_OBJSTM_FREE_BYTES, PDF_OBJSTM_MAX_RATIO } from './imageLimits';
import { pdfHeaderOffset } from './imageInfo';
import { limits, noteLimitReached } from './limits';
import { msg } from './messages';
import { PdfLoadLimitError, loadPdfGuarded, type LoadGuard } from './pdfStreamGuard';

/** 図の大きさにする箱の名前 (ISO 32000-1 §14.11.2) */
export type PdfBoxName = 'MediaBox' | 'CropBox' | 'BleedBox' | 'TrimBox' | 'ArtBox';
/** 矩形 [左, 下, 右, 上] (pt。左 ≤ 右、下 ≤ 上に並べ直したもの) */
export type PdfRect = [number, number, number, number];

/** 読んだときの知らせ (画像の置き場が、参照の名前を付けて診断にする) */
export interface PdfNote {
  code: 'image/pdf-page' | 'image/pdf-page-range' | 'image/pdf-fragment' | 'image/pdf-repaired';
  /** 何があったか (利用者に見せる短い文。診断の detail) */
  detail: string;
}

/** fragment から決めた、貼るページと箱 */
export interface PdfFragmentChoice {
  /** 貼るページ (1 から数える。ページの数を超えるかは、読んでから確かめる) */
  page: number;
  /** 互換の指定のときの、ページの範囲 (last が undefined なら最後のページまで) */
  range?: { first: number; last?: number };
  box: PdfBoxName;
  notes: PdfNote[];
}

/** 表示の仕方の指定で、どのページを図にするかに関わらない引数 (RFC 8118 §3・RFC 3778 の開き方の引数)。読まずに、警告も出さない */
const IGNORED_PARAMS = new Set(['nameddest', 'comment', 'zoom', 'view', 'viewrect', 'highlight', 'search', 'fdf', 'pagemode', 'toolbar', 'navpanes', 'scrollbar', 'statusbar', 'messages']);
const BOX_NAMES: readonly PdfBoxName[] = ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox'];

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
/** 知らせに出す値 (長すぎる値は切る) */
const shown = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

/**
 * fragment (# の後ろ。# は含まない。%xx は戻していないもの) から、貼るページと箱を決める。compat は互換の指定 (アンテナハウスの拡張を読む) か
 */
export function parsePdfFragment(fragment: string | undefined, compat: boolean): PdfFragmentChoice {
  const out: PdfFragmentChoice = { page: 1, box: 'CropBox', notes: [] };
  if (!fragment) return out;
  for (const part of fragment.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    // = の無い fragment は、名前の付いた行き先の短い書き方 (RFC 8118 §3.2)。行き先からページを選ぶことはしない (design/pdf-as-image.md の 7 節の 7)
    if (eq < 0) continue;
    const key = decode(part.slice(0, eq)).trim().toLowerCase();
    const value = decode(part.slice(eq + 1)).trim();
    if (key === 'page') {
      if (/^\d+$/.test(value) && Number(value) >= 1) {
        out.page = Number(value);
        delete out.range;
        continue;
      }
      const range = /^(\d+)-(\d*)$/.exec(value);
      const all = value.toLowerCase() === 'all';
      if (compat && (all || (range && Number(range[1]) >= 1 && (range[2] === '' || Number(range[2]) >= Number(range[1]))))) {
        out.page = all ? 1 : Number(range![1]);
        out.range = all ? { first: 1 } : { first: out.page, ...(range![2] ? { last: Number(range![2]) } : {}) };
        continue;
      }
      out.page = 1;
      delete out.range;
      out.notes.push(
        range || all
          ? { code: 'image/pdf-fragment', detail: msg(`ページの範囲 page=${shown(value)} は、互換の指定 (--compat antenna・--style ah) のときだけ読みます。1 ページ目を貼ります`, `the page range page=${shown(value)} is read only in compatibility mode (--compat antenna, --style ah); the first page is used`) }
          : { code: 'image/pdf-page', detail: msg(`page=${shown(value)} はページの番号 (1 以上の整数) でないので、1 ページ目を貼ります`, `page=${shown(value)} is not a page number (an integer of 1 or more); the first page is used`) },
      );
      continue;
    }
    if (key === 'bbox') {
      const name = BOX_NAMES.find((b) => b.toLowerCase() === value.toLowerCase());
      if (compat && name) out.box = name;
      else
        out.notes.push({
          code: 'image/pdf-fragment',
          detail: compat
            ? msg(`bbox=${shown(value)} は箱の名前 (MediaBox・CropBox・BleedBox・TrimBox・ArtBox) でないので、CropBox を使います`, `bbox=${shown(value)} is not a box name (MediaBox, CropBox, BleedBox, TrimBox, ArtBox); CropBox is used`)
            : msg(`bbox= は、互換の指定 (--compat antenna・--style ah) のときだけ読みます。CropBox を使います`, `bbox= is read only in compatibility mode (--compat antenna, --style ah); CropBox is used`),
        });
      continue;
    }
    if (IGNORED_PARAMS.has(key)) continue;
    out.notes.push({ code: 'image/pdf-fragment', detail: msg(`# の後ろの ${shown(key)}= は読みません`, `${shown(key)}= in the fragment is not read`) });
  }
  return out;
}

/** ページの木でたどったページ (葉) と、親から受け継いだ属性 (§7.7.3.4) */
export interface PdfPageEntry {
  dict: PDFDict;
  /** 受け継ぐ属性 (ページ自身のもの、無ければ近い親のもの) */
  inherited: { MediaBox?: PDFObject; CropBox?: PDFObject; Rotate?: PDFObject; Resources?: PDFObject };
}

/** 読み込んだ PDF (同じバイト列は 1 度だけ読む) */
export type LoadedPdf = { ok: true; doc: PDFDocument; pages: PdfPageEntry[]; notes: PdfNote[] } | { ok: false; code: 'image/pdf-invalid' | 'image/pdf-encrypted'; detail: string; notes: PdfNote[] };

/** 読んだ PDF (元のバイト列ごと。読んだときの上限も覚え、上限の違う呼び出しでは読み直す: 上限で断った結果を、上限を上げた呼び出しに使い回さない) */
const loaded = new WeakMap<Uint8Array, { limits: object; result: Promise<LoadedPdf> }>();

/** PDF を読む (元のバイト列ごとに 1 度だけ。弱い表で覚える) */
export function loadPdfImage(bytes: Uint8Array): Promise<LoadedPdf> {
  const lim = limits();
  const hit = loaded.get(bytes);
  if (hit && hit.limits === lim) return hit.result;
  const result = loadOnce(bytes);
  loaded.set(bytes, { limits: lim, result });
  return result;
}

const invalid = (detail: string, notes: PdfNote[] = []): LoadedPdf => ({ ok: false, code: 'image/pdf-invalid', detail, notes });

/** バイト列の中の、間接オブジェクトの頭 (… obj) の数の見積もり (obj の前が空白で、後ろが語の続きでないもの) */
export function countObjKeywords(b: Uint8Array): number {
  let n = 0;
  const ws = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  for (let i = 1; i + 2 < b.length; i++) {
    if (b[i] !== 0x6f || b[i + 1] !== 0x62 || b[i + 2] !== 0x6a || !ws(b[i - 1])) continue;
    const next = b[i + 3];
    if (next === undefined || !((next >= 0x30 && next <= 0x39) || (next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a))) n++;
  }
  return n;
}

async function loadOnce(bytes: Uint8Array): Promise<LoadedPdf> {
  const notes: PdfNote[] = [];
  const at = pdfHeaderOffset(bytes);
  if (at < 0) return invalid(msg('PDF の頭 (%PDF-) がありません', 'no PDF header (%PDF-)'));
  if (at > 0) notes.push({ code: 'image/pdf-repaired', detail: msg(`PDF の頭の前に ${at} バイトの余分なバイトがあります`, `${at} extra bytes before the PDF header`) });
  const lim = limits();
  const tooMany = (what: string, name: 'pdfImageObjects' | 'pdfImagePages' | 'pdfImageDepth' | 'pdfImageLoadMs', value: number) => {
    noteLimitReached(name);
    return invalid(msg(`${what}が上限 ${name} (${value}) を超えます`, `${what} exceeds the limit ${name} (${value})`), notes);
  };
  const objects = msg('オブジェクトの数', 'the number of objects');
  if (countObjKeywords(bytes) > lim.pdfImageObjects) return tooMany(objects, 'pdfImageObjects', lim.pdfImageObjects);
  // 読み込みは時限と競わせる (時限の setTimeout は、終わらない Promise でもイベントループを空にしない)。時限が切れたら、読み手も止める (guard.aborted)
  const timedOut = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let doc: PDFDocument | typeof timedOut;
  const streamBytes = Math.min(lim.pdfImageStreamBytes, PDF_OBJSTM_FREE_BYTES + PDF_OBJSTM_MAX_RATIO * bytes.length);
  const guard: LoadGuard = { objects: lim.pdfImageObjects, streamBytes, deadline: Date.now() + lim.pdfImageLoadMs };
  try {
    const race = Promise.race([
      loadPdfGuarded(bytes, guard),
      new Promise<typeof timedOut>((done) => {
        timer = setTimeout(() => done(timedOut), lim.pdfImageLoadMs);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      guard.aborted = true;
    });
    doc = rejoin(thisCall(), await race);
  } catch (e) {
    if (e instanceof PdfLoadLimitError) {
      if (e.limit === 'pdfImageObjects') return tooMany(objects, 'pdfImageObjects', lim.pdfImageObjects);
      if (e.limit === 'pdfImageLoadMs') return tooMany(msg('読み込みの時間', 'the time for loading'), 'pdfImageLoadMs', lim.pdfImageLoadMs);
      // 展開の比の縛り (ファイルの大きさによるもの) が先に当たったときは、上限を上げても読めないので、上限に当たった記録にしない
      if (streamBytes === lim.pdfImageStreamBytes) noteLimitReached('pdfImageStreamBytes');
      return invalid(
        msg(
          `オブジェクトの流れ・相互参照の流れを解いた大きさが、上限 pdfImageStreamBytes (${lim.pdfImageStreamBytes}) か、ファイルの大きさの ${PDF_OBJSTM_MAX_RATIO} 倍を超えます`,
          `the decompressed object streams and cross-reference streams exceed the limit pdfImageStreamBytes (${lim.pdfImageStreamBytes}) or ${PDF_OBJSTM_MAX_RATIO} times the file size`,
        ),
        notes,
      );
    }
    return invalid(msg(`PDF として読めません (${shown(String((e as Error)?.message ?? e))})`, `cannot be read as PDF (${shown(String((e as Error)?.message ?? e))})`), notes);
  }
  if (doc === timedOut) return tooMany(msg('読み込みの時間', 'the time for loading'), 'pdfImageLoadMs', lim.pdfImageLoadMs);
  const context = doc.context;
  if (context.enumerateIndirectObjects().length > lim.pdfImageObjects) return tooMany(objects, 'pdfImageObjects', lim.pdfImageObjects);
  // 暗号化 (trailer の Encrypt。ISO 32000-1 §7.6)。pdf-lib は暗号を解かないので読めない
  if (context.trailerInfo.Encrypt && context.lookup(context.trailerInfo.Encrypt))
    return { ok: false, code: 'image/pdf-encrypted', detail: msg('暗号化されています', 'encrypted'), notes };
  const catalog = context.trailerInfo.Root ? context.lookup(context.trailerInfo.Root) : undefined;
  const root = catalog instanceof PDFDict ? catalog.lookup(PDFName.of('Pages')) : undefined;
  if (!(root instanceof PDFDict)) return invalid(msg('ページの木 (カタログの Pages) がありません', 'no page tree (Pages in the catalog)'), notes);
  // ページの木を繰り返しでたどる (子の並びの順に、深さ優先)。輪は、たどった印で止める
  const pages: PdfPageEntry[] = [];
  const seen = new Set<PDFDict>();
  const stack: Array<{ node: PDFDict; depth: number; inherited: PdfPageEntry['inherited'] }> = [{ node: root, depth: 1, inherited: {} }];
  let cycles = 0;
  while (stack.length) {
    const { node, depth, inherited: up } = stack.pop()!;
    if (seen.has(node)) {
      cycles++;
      continue;
    }
    seen.add(node);
    if (depth > lim.pdfImageDepth) return tooMany(msg('ページの木の段の数', 'the depth of the page tree'), 'pdfImageDepth', lim.pdfImageDepth);
    const inherited: PdfPageEntry['inherited'] = { ...up };
    for (const k of ['MediaBox', 'CropBox', 'Rotate', 'Resources'] as const) {
      const v = node.get(PDFName.of(k));
      if (v !== undefined) inherited[k] = v;
    }
    const kids = node.lookup(PDFName.of('Kids'));
    const type = node.lookup(PDFName.of('Type'));
    if (kids instanceof PDFArray && !(type instanceof PDFName && type.asString() === '/Page')) {
      for (let i = kids.size() - 1; i >= 0; i--) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) stack.push({ node: kid, depth: depth + 1, inherited });
      }
      continue;
    }
    pages.push({ dict: node, inherited });
    if (pages.length > lim.pdfImagePages) return tooMany(msg('ページの数', 'the number of pages'), 'pdfImagePages', lim.pdfImagePages);
  }
  if (!pages.length) return invalid(msg('ページがありません', 'no pages'), notes);
  if (cycles) notes.push({ code: 'image/pdf-repaired', detail: msg('ページの木が輪になっています (同じ節をたどり直しません)', 'the page tree has a cycle (nodes are not visited twice)') });
  const count = root.lookup(PDFName.of('Count'));
  if (count instanceof PDFNumber && count.asNumber() !== pages.length)
    notes.push({ code: 'image/pdf-repaired', detail: msg(`ページの木の Count (${count.asNumber()}) と、たどったページの数 (${pages.length}) が違います`, `the Count of the page tree (${count.asNumber()}) differs from the pages found (${pages.length})`) });
  return { ok: true, doc, pages, notes };
}

/** 数 (参照なら引く)。数でなければ undefined */
function numberOf(context: PDFContext, o: PDFObject | undefined): number | undefined {
  const v = o === undefined ? undefined : context.lookup(o);
  return v instanceof PDFNumber && Number.isFinite(v.asNumber()) ? v.asNumber() : undefined;
}

/** 矩形 (4 つの数の配列。§7.9.5: 対角の 2 点なので、並べ直す)。読めなければ undefined */
export function rectOf(context: PDFContext, o: PDFObject | undefined): PdfRect | undefined {
  const a = o === undefined ? undefined : context.lookup(o);
  if (!(a instanceof PDFArray) || a.size() !== 4) return undefined;
  const n = [0, 1, 2, 3].map((i) => numberOf(context, a.get(i)));
  if (n.some((v) => v === undefined)) return undefined;
  const [x0, y0, x1, y1] = n as number[];
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/** 貼るページ (画像の置き場の pdfSource) */
export interface PdfPageImage {
  /** ページ (0 から数える) */
  page: number;
  /** ページの数 */
  pageCount: number;
  /** 図にする箱 (MediaBox に切り詰めたもの。pt) */
  box: PdfRect;
  boxName: PdfBoxName;
  rotate: 0 | 90 | 180 | 270;
  userUnit: number;
  /** 図の大きさ (CSS px。回した後) */
  width: number;
  height: number;
}

export type PdfImageResult = { ok: true; image: PdfPageImage; notes: PdfNote[] } | { ok: false; code: 'image/pdf-invalid' | 'image/pdf-encrypted'; detail: string; notes: PdfNote[] };

const PX_PER_PT = 96 / 72;

/** PDF を読み、fragment で選んだページの箱・回転・大きさを決める */
export async function readPdfImage(bytes: Uint8Array, fragment: string | undefined, compat: boolean): Promise<PdfImageResult> {
  const choice = parsePdfFragment(fragment, compat);
  const pdf = rejoin(thisCall(), await loadPdfImage(bytes));
  const notes = [...pdf.notes, ...choice.notes];
  if (!pdf.ok) return { ...pdf, notes };
  const image = pageImage(pdf, choice, notes);
  return 'detail' in image ? { ok: false, code: 'image/pdf-invalid', detail: image.detail, notes } : { ok: true, image, notes };
}

function pageImage(pdf: Extract<LoadedPdf, { ok: true }>, choice: PdfFragmentChoice, notes: PdfNote[]): PdfPageImage | { detail: string } {
  const context = pdf.doc.context;
  const pageCount = pdf.pages.length;
  let page = choice.page - 1;
  if (page >= pageCount) {
    notes.push({ code: 'image/pdf-page', detail: msg(`${choice.page} ページ目がありません (${pageCount} ページ)。1 ページ目を貼ります`, `there is no page ${choice.page} (${pageCount} pages); the first page is used`) });
    page = 0;
  } else if (choice.range) {
    const last = Math.min(choice.range.last ?? pageCount, pageCount);
    if (last > choice.range.first)
      notes.push({ code: 'image/pdf-page-range', detail: msg(`ページの範囲 (${choice.range.first}〜${last} ページ) の最初のページだけを貼ります (範囲を流して貼るのは今後の版)`, `only the first page of the range (pages ${choice.range.first} to ${last}) is used (flowing a range is planned for a later version)`) });
  }
  const { dict, inherited } = pdf.pages[page];
  let media = rectOf(context, inherited.MediaBox);
  if (!media) {
    // MediaBox は欠かせない属性 (Table 30)。無ければ、pdf-lib と同じ US Letter (612 × 792) とみなす
    notes.push({ code: 'image/pdf-repaired', detail: msg('ページに MediaBox がないので、612 × 792 とみなします', 'the page has no MediaBox; 612 × 792 is assumed') });
    media = [0, 0, 612, 792];
  }
  const crop = rectOf(context, inherited.CropBox) ?? media;
  // BleedBox・TrimBox・ArtBox は受け継がない属性。無ければ CropBox (§14.11.2)
  const own = choice.box === 'MediaBox' ? media : choice.box === 'CropBox' ? crop : (rectOf(context, dict.get(PDFName.of(choice.box))) ?? crop);
  // MediaBox と重なる所に切り詰める (§14.11.2)
  const box: PdfRect = [Math.max(own[0], media[0]), Math.max(own[1], media[1]), Math.min(own[2], media[2]), Math.min(own[3], media[3])];
  if (!(box[2] > box[0] && box[3] > box[1])) return { detail: msg(`${choice.box} が MediaBox と重ならないか、幅か高さが 0 です`, `${choice.box} does not overlap the MediaBox, or its width or height is 0`) };
  let r = numberOf(context, inherited.Rotate) ?? 0;
  if (r % 90 !== 0) {
    notes.push({ code: 'image/pdf-repaired', detail: msg(`Rotate (${r}) が 90 の倍数でないので、0 とみなします`, `Rotate (${r}) is not a multiple of 90; 0 is assumed`) });
    r = 0;
  }
  const rotate = (((r % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const uu = numberOf(context, dict.get(PDFName.of('UserUnit')));
  const userUnit = uu !== undefined && uu > 0 ? uu : 1;
  const w = (box[2] - box[0]) * userUnit * PX_PER_PT;
  const h = (box[3] - box[1]) * userUnit * PX_PER_PT;
  const [width, height] = rotate === 90 || rotate === 270 ? [h, w] : [w, h];
  const max = limits().formatSize;
  if (!(width > 0 && height > 0 && width <= max && height <= max)) return { detail: msg(`ページの大きさが大きすぎます (${max} px まで)`, `the page is too large (up to ${max} px)`) };
  return { page, pageCount, box, boxName: choice.box, rotate, userUnit, width, height };
}
