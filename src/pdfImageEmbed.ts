/**
 * pdfImageEmbed — PDF の画像 (pdfImage.ts で読んだページ) を、組んだ PDF に Form XObject として埋め込む (design/pdf-as-image.md の 2 節)。
 *
 * - pdf-lib の embedPdf・embedPage は使わない (8 節): ページの辞書を丸ごと写すので、注釈の行き先から元の文書の全体が写りうるため。
 *   ここでは、中身の流れ (Contents) と資源 (Resources) と透明のグループ (Group。§11.6.6) だけを、pdf-lib の写し手 (PDFObjectCopier) で写す。
 *   写し手は再帰で写すので、写す前に、資源から届くものを繰り返しでたどって、深さ (pdfImageDepth) と数 (pdfImageObjects) を確かめる
 * - Form の流れは、中身の流れを解いてつなぎ (PDFPageEmbedder と同じ)、Flate で詰め直す。BBox は選んだ箱 (§8.10.1 Table 95)、Matrix は単位の行列。
 *   回転 (/Rotate) と、箱の左下を原点に寄せるのは、描く行列で行う (pdfImageMatrix)
 * - 持ち込まないもの (2.2 節): 注釈・しおり・構造の木・名前の付いた行き先・XMP・出力意図・添付。カタログは触らない
 * - 中身の流れの、MCID を持つ BDC を、同じ札の BMC にする (2.3 節。組んだ文書の構造の木を指さない MCID を残さない。
 *   Form の中の MCID は、Form の StructParents と親の木で結び付けるもの: ISO 32000-1 §14.7.4.4。タグ付き PDF でないときも、行き先の無い MCID は
 *   意味を持たないので、いつも外す)。資源の中の入れ子の内容の流れ (Form XObject・タイルの模様・Type3 の字形。§8.10・§8.7.3.2・§9.6.5) の MCID も外し、
 *   XObject の StructParents・StructParent (§14.7.4.4・§14.7.4.3) も消す。写し手が辞書ごと写すので、置き換えた流れを写させる (copierWith)
 * - 圧縮を解くのは、写す前に、縛りの中で (pdfStreamGuard.ts の decodeGuarded)。ページの中身の流れと、資源の中の内容の流れと、ICCBased の色空間の流れ
 *   (PDF/X・PDF/A の検査が解くもの) の合計を pdfImageStreamBytes で縛り、時間を pdfImageLoadMs で縛る。検査 (pdfPageProblems) には、縛りの中で
 *   解けると確かめた流れだけが届く。解いた流れは、解いたバイト列を詰め直したものに置き換えて写す (元の圧縮を、縛りの外の pdf-lib の展開に解かせない)
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFOperator, PDFOperatorNames as Ops, PDFRawStream, PDFRef, PDFStream, concatTransformationMatrix, popGraphicsState, pushGraphicsState, type PDFContext, type PDFObject } from 'pdf-lib';
import { rejoin, thisCall } from './callContext';
import { limits, noteLimitReached } from './limits';
import { msg } from './messages';
import { loadPdfImage, type PdfRect } from './pdfImage';
import { copierWith, decodeGuarded } from './pdfStreamGuard';

/** 埋め込んだページ */
export interface EmbeddedPdfPage {
  ref: PDFRef;
  /** 持ち込まなかった注釈の数 */
  annots: number;
  /** 埋め込んでいない書体の名前 (BaseFont) */
  unembeddedFonts: string[];
}

/** 埋め込む前に読んだページ (中身の流れは解いて MCID を外したもの)。埋め込む前の検査 (pdfPageProblems) と、埋め込み (formInto) に使う */
export interface PreparedPdfPage {
  context: PDFContext;
  resources?: PDFDict;
  group?: PDFObject;
  content: Uint8Array;
  box: PdfRect;
  annots: number;
  unembeddedFonts: string[];
}

/** 埋め込む前の検査で断った理由 (which: どの決まりで断ったか。呼ぶ側が警告にし、仮の枠で描く) */
export interface PdfPageRefusal {
  which: 'pdfx' | 'pdfa' | 'pdfua';
  detail: string;
}
/** 埋め込む前の検査: 断るなら、その理由 */
export type PdfPageGate = (page: PreparedPdfPage) => Promise<PdfPageRefusal | undefined>;

/** 文書 1 つ分の、埋め込みの覚え (同じページを 1 つの XObject にし、同じ元の文書の資源 (書体など) を 1 度だけ写す) */
export interface PdfEmbedCache {
  copiers: Map<PDFContext, PDFObjectCopier>;
  pages: Map<string, Promise<EmbeddedPdfPage | { error: string } | { refused: PdfPageRefusal }>>;
}
export const pdfEmbedCache = (): PdfEmbedCache => ({ copiers: new Map(), pages: new Map() });

/**
 * PDF の画像のページを埋め込む。読めない・上限を超えたときは { error }、埋め込む前の検査 (gate) が断ったときは { refused }
 * (どちらも、呼ぶ側が警告にし、仮の枠で描く。断ったページは、出力の PDF に何も写さない)
 */
export function embedPdfPage(out: PDFDocument, cache: PdfEmbedCache, src: { bytes: Uint8Array; page: number; box: PdfRect }, gate?: PdfPageGate): Promise<EmbeddedPdfPage | { error: string } | { refused: PdfPageRefusal }> {
  // 鍵: 同じバイト列の同じページと箱 (バイト列は、文書ごとの覚えの中で、オブジェクトとして見分ける)
  let ids = byteIds.get(cache);
  if (!ids) byteIds.set(cache, (ids = new Map()));
  let id = ids.get(src.bytes);
  if (id === undefined) ids.set(src.bytes, (id = ids.size));
  const key = `${id}\0${src.page}\0${src.box.join(',')}`;
  let p = cache.pages.get(key);
  if (!p) {
    p = embedOnce(out, cache, src, gate);
    cache.pages.set(key, p);
  }
  return p;
}
const byteIds = new WeakMap<PdfEmbedCache, Map<Uint8Array, number>>();

async function embedOnce(out: PDFDocument, cache: PdfEmbedCache, src: { bytes: Uint8Array; page: number; box: PdfRect }, gate?: PdfPageGate): Promise<EmbeddedPdfPage | { error: string } | { refused: PdfPageRefusal }> {
  const prepared = rejoin(thisCall(), await preparePdfPage(src));
  if ('error' in prepared) return prepared;
  const refused = gate && rejoin(thisCall(), await gate(prepared));
  if (refused) return { refused };
  let copier = cache.copiers.get(prepared.context);
  if (!copier) cache.copiers.set(prepared.context, (copier = copierWith(prepared.context, out.context, replaced)));
  return { ref: formInto(out, copier, prepared), annots: prepared.annots, unembeddedFonts: prepared.unembeddedFonts };
}

/** ページを読み、写すものの深さと数を確かめ、中身の流れを解いて MCID を外す */
export async function preparePdfPage(src: { bytes: Uint8Array; page: number; box: PdfRect }): Promise<PreparedPdfPage | { error: string }> {
  const pdf = rejoin(thisCall(), await loadPdfImage(src.bytes));
  if (!pdf.ok) return { error: pdf.detail };
  const entry = pdf.pages[src.page];
  if (!entry) return { error: msg('ページがありません', 'no such page') };
  const context = pdf.doc.context;
  const lim = limits();
  const res = entry.inherited.Resources !== undefined ? context.lookup(entry.inherited.Resources) : undefined;
  const resources = res instanceof PDFDict ? res : undefined;
  const group = entry.dict.get(PDFName.of('Group'));
  // 写す前に、届くものの深さと数を確かめる (写し手は再帰)。書体の埋め込みも、ここで見る
  const reach = walk(context, [resources, group].filter((o): o is PDFObject => o !== undefined), lim.pdfImageDepth, lim.pdfImageObjects);
  if ('limit' in reach) {
    noteLimitReached(reach.limit);
    return { error: msg(`資源の${reach.limit === 'pdfImageDepth' ? '入れ子の深さ' : 'オブジェクトの数'}が上限 ${reach.limit} (${lim[reach.limit]}) を超えます`, `the ${reach.limit === 'pdfImageDepth' ? 'nesting depth' : 'number of objects'} of the resources exceeds the limit ${reach.limit} (${lim[reach.limit]})`) };
  }
  // 中身の流れを解いてつなぐ (大きさは、資源の中の流れと合わせて pdfImageStreamBytes まで。時間は pdfImageLoadMs まで)
  const deadline = Date.now() + lim.pdfImageLoadMs;
  const budget = { left: lim.pdfImageStreamBytes };
  const failed = (r: 'limit' | 'time' | undefined, what: [string, string]) => {
    if (r === 'limit') {
      noteLimitReached('pdfImageStreamBytes');
      return { error: msg(`${what[0]}の大きさが上限 pdfImageStreamBytes (${lim.pdfImageStreamBytes}) を超えます`, `the ${what[1]} exceed the limit pdfImageStreamBytes (${lim.pdfImageStreamBytes})`) };
    }
    if (r === 'time') {
      noteLimitReached('pdfImageLoadMs');
      return { error: msg(`${what[0]}の圧縮を解く時間が上限 pdfImageLoadMs (${lim.pdfImageLoadMs}) を超えます`, `decompressing the ${what[1]} exceeds the limit pdfImageLoadMs (${lim.pdfImageLoadMs})`) };
    }
    return { error: msg(`${what[0]}の圧縮を解けません`, `cannot decompress the ${what[1]}`) };
  };
  const PAGE: [string, string] = ['中身の流れ', 'content streams'];
  const contents = context.lookup(entry.dict.get(PDFName.of('Contents')) ?? PDFArray.withContext(context));
  const streams = contents instanceof PDFArray ? contents.asArray().map((o) => context.lookup(o)) : [contents];
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFStream)) continue;
    const decoded = decodeStream(s, budget.left, deadline);
    if (!(decoded instanceof Uint8Array)) return failed(decoded, PAGE);
    parts.push(decoded, NEWLINE);
    budget.left -= decoded.length + 1;
  }
  // 中身の流れの MCID は、元の文書の構造の木を指すもので、組んだ文書では行き先が無い。タグ付き PDF でないときも意味を持たないので、いつも外す
  const content: Uint8Array = withoutMcids(concat(parts), resources);
  // 資源の中の内容の流れ: 解いて (縛りの中で) MCID を外し、StructParents を消したものに置き換える。ICCBased の流れは、解けることだけを確かめる
  const NESTED: [string, string] = ['資源の中の流れ', 'streams in the resources'];
  for (const c of reach.contents) {
    const r = nestedContent(c.stream, c.resources ?? resources, budget, deadline);
    if (r !== true) return failed(r, NESTED);
  }
  for (const icc of reach.icc) {
    const r = checkedLength(icc, budget, deadline);
    if (r !== true) return failed(r, NESTED);
  }
  for (const x of reach.structItems) if (!replaced.has(x)) replaced.set(x, withoutStructKeys(x, x.contents));
  const annots = context.lookup(entry.dict.get(PDFName.of('Annots')) ?? PDFArray.withContext(context));
  return { context, ...(resources ? { resources } : {}), ...(group !== undefined ? { group } : {}), content, box: src.box, annots: annots instanceof PDFArray ? annots.size() : 0, unembeddedFonts: reach.unembeddedFonts };
}

/** 読んだページを、doc に Form XObject として写す (資源と透明のグループは copier で写す) */
function formInto(doc: PDFDocument, copier: PDFObjectCopier, p: PreparedPdfPage): PDFRef {
  const dict: Record<string, PDFObject | string | number | number[]> = {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [...p.box],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: p.resources ? copier.copy(p.resources) : doc.context.obj({}),
  };
  if (p.group !== undefined) dict.Group = copier.copy(p.group);
  return doc.context.register(doc.context.flateStream(p.content, dict as never));
}

/** 検査の土台に置く出力意図 (PDF/X は GTS_PDFX、PDF/A は GTS_PDFA1。色空間は組んだ PDF の出力意図と同じにする) */
export interface ProbeIntent {
  s: 'GTS_PDFX' | 'GTS_PDFA1';
  space: 'RGB' | 'CMYK';
}

/**
 * 埋め込む前の、ページ 1 つの検査 (design/pdf-as-image.md の 2.4 節)。そのページだけを描いた試しの PDF と、何も描かない土台の PDF を作り、
 * 同じ検査 (書き出した PDF の全体を調べる verify: pdfxVerify.ts・pdfaVerify.ts) にかけて、土台に無い問題だけを返す
 * (文書の全体の決まり (Info・XMP・出力意図など) の問題は、両方に同じに出るので打ち消し合う)
 */
export async function pdfPageProblems(p: PreparedPdfPage, verify: (bytes: Uint8Array) => Promise<string[]>, intent: ProbeIntent): Promise<string[]> {
  const make = async (withPage: boolean) => {
    const doc = rejoin(thisCall(), await PDFDocument.create({ updateMetadata: false }));
    const page = doc.addPage([Math.max(1, p.box[2] - p.box[0]), Math.max(1, p.box[3] - p.box[1])]);
    // 出力意図 (検査が色空間を決めるのに読む ICC の頭だけを持つ、試しのもの)
    const icc = new Uint8Array(128);
    const put = (o: number, t: string) => [...t].forEach((c, i) => (icc[o + i] = c.charCodeAt(0)));
    icc[8] = 2;
    put(12, intent.s === 'GTS_PDFX' ? 'prtr' : 'mntr');
    put(16, intent.space === 'CMYK' ? 'CMYK' : 'RGB ');
    put(36, 'acsp');
    const profile = doc.context.register(doc.context.stream(icc, { N: intent.space === 'CMYK' ? 4 : 3 }));
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.obj({ Type: 'OutputIntent', S: intent.s, OutputConditionIdentifier: 'Custom', DestOutputProfile: profile })]));
    if (withPage) {
      const ref = formInto(doc, copierWith(p.context, doc.context, replaced), p);
      const name = page.node.newXObject('KmP', ref);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, -p.box[0], -p.box[1]), PDFOperator.of(Ops.DrawObject, [name]), popGraphicsState());
    }
    return rejoin(thisCall(), await doc.save({ useObjectStreams: false, addDefaultPage: false }));
  };
  const base = new Set(rejoin(thisCall(), await verify(rejoin(thisCall(), await make(false)))));
  return rejoin(thisCall(), await verify(rejoin(thisCall(), await make(true)))).filter((m) => !base.has(m));
}

const NEWLINE = Uint8Array.of(0x0a);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** 流れの圧縮を解く (left バイトまで。deadline を過ぎたら 'time'、解けなければ undefined) */
function decodeStream(s: PDFStream, left: number, deadline: number): ReturnType<typeof decodeGuarded> {
  if (s instanceof PDFRawStream) return decodeGuarded(s.dict, s.contents, left, deadline);
  try {
    const b = (s as unknown as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents?.();
    return b && b.length > left ? 'limit' : b;
  } catch {
    return undefined;
  }
}

/**
 * 置き換えた流れ (元の文書の流れ → MCID を外し、StructParents・StructParent を消した流れ)。元の文書は読んだバイト列ごとに 1 度だけ読む (pdfImage.ts) ので、
 * 流れのオブジェクトで覚える。写し手 (copierWith) が、写すときに置き換える
 */
const replaced = new WeakMap<PDFStream, PDFStream>();
/** 解いた長さ (置き換えなかった流れも。同じ流れを 2 度解かない。上限の違う呼び出しでも、長さは同じ) */
const decodedLengths = new WeakMap<PDFStream, number>();

/**
 * 流れの辞書から、構造の木と結び付ける項目 (StructParents・StructParent。ISO 32000-1 §14.7.4.3・§14.7.4.4) を消した流れ。
 * decoded なら、contents は縛りの中で解いたバイト列で、Flate で詰め直す。予測 (Predictor。§7.4.4.4) は、縛りの展開も当てないので、
 * 終わりの段の DecodeParms を残す (詰め直したものを読み手が解いて予測を当てれば、元と同じになる)
 */
function withoutStructKeys(s: PDFRawStream, contents: Uint8Array, decoded = false): PDFRawStream {
  const dict = s.dict.clone();
  dict.delete(PDFName.of('StructParents'));
  dict.delete(PDFName.of('StructParent'));
  if (!decoded) return PDFRawStream.of(dict, contents);
  const parms = s.dict.lookup(PDFName.of('DecodeParms'));
  const last = parms instanceof PDFArray ? (parms.size() ? s.dict.context.lookup(parms.get(parms.size() - 1)) : undefined) : parms;
  for (const k of ['Filter', 'DecodeParms', 'Length', 'DL']) dict.delete(PDFName.of(k));
  const out = s.dict.context.flateStream(contents);
  for (const [k, v] of dict.entries()) out.dict.set(k, v);
  if (last instanceof PDFDict && last.get(PDFName.of('Predictor')) !== undefined) out.dict.set(PDFName.of('DecodeParms'), last);
  return out;
}

/** 解いた長さを確かめる (覚えた長さがあれば、それで)。予算から引く */
function checkedLength(s: PDFRawStream, budget: { left: number }, deadline: number): true | 'limit' | 'time' {
  let n = decodedLengths.get(s);
  if (n === undefined) {
    const d = decodeGuarded(s.dict, s.contents, budget.left, deadline);
    // 解けない流れ (方式の分からないものなど) は、検査も解けないので、そのまま写す
    if (d === undefined) n = 0;
    else if (!(d instanceof Uint8Array)) return d;
    else {
      n = d.length;
      // 解いたものに置き換えて写す (縛りの展開と pdf-lib の展開は、壊れたデータで食い違いうる。検査が元の圧縮を縛り無しに解かないように)
      replaced.set(s, withoutStructKeys(s, d, true));
    }
    decodedLengths.set(s, n);
  }
  if (n > budget.left) return 'limit';
  budget.left -= n;
  return true;
}

/** 資源の中の内容の流れ: 縛りの中で解き、MCID を外す。変わったか StructParents があれば、置き換えた流れを覚える */
function nestedContent(s: PDFRawStream, resources: PDFDict | undefined, budget: { left: number }, deadline: number): true | 'limit' | 'time' | undefined {
  const n = decodedLengths.get(s);
  if (n !== undefined) {
    if (n > budget.left) return 'limit';
    budget.left -= n;
    return true;
  }
  const d = decodeGuarded(s.dict, s.contents, budget.left, deadline);
  if (d === undefined) {
    // 解けない流れ (方式の分からないものなど) は、そのまま写す (描けないのは元の文書でも同じ)。構造の木と結び付ける項目だけは消す
    if (hasStructKeys(s.dict)) replaced.set(s, withoutStructKeys(s, s.contents));
    decodedLengths.set(s, 0);
    return true;
  }
  if (!(d instanceof Uint8Array)) return d;
  decodedLengths.set(s, d.length);
  budget.left -= d.length;
  // MCID を外し、いつも解いたものに置き換えて写す。縛りの展開 (inflateFast) は壊れたデータ (出力の始まりより前を指す距離など) で止めるが、
  // pdf-lib の展開は止まらずに続けうるので、元の圧縮のまま写すと、写した後の検査 (pdfPageProblems の PDF/X・PDF/A の検査) や読み手が、縛り無しに解く
  replaced.set(s, withoutStructKeys(s, withoutMcids(d, resources), true));
  return true;
}

const hasStructKeys = (d: PDFDict) => d.get(PDFName.of('StructParents')) !== undefined || d.get(PDFName.of('StructParent')) !== undefined;

/** 資源から届くもの (walk の結果) */
interface Reach {
  unembeddedFonts: string[];
  /** 内容の流れ (Form XObject・タイルの模様・Type3 の字形) と、その中の名前を引く資源 (無ければ、ページの資源) */
  contents: Array<{ stream: PDFRawStream; resources?: PDFDict }>;
  /** ICCBased の色空間の流れ (§8.6.5.5) */
  icc: PDFRawStream[];
  /** 内容の流れでない XObject (画像など) で、StructParent・StructParents を持つもの */
  structItems: PDFRawStream[];
}

/**
 * 資源から届くものを繰り返しでたどる (深さと数を縛る)。書体の辞書 (Type Font) で、Type3 でなく、FontDescriptor に FontFile・FontFile2・FontFile3 の無いもの
 * (Type0 は子の書体の FontDescriptor) の名前も集める (埋め込んでいない書体。ISO 32000-1 §9.8)。
 * 内容の流れ (Form XObject (§8.10)・タイルの模様 (PatternType 1。§8.7.3.2)・Type3 の書体の字形 (CharProcs。§9.6.5)。pdfContentStreams.ts と同じ見分け方) と、
 * ICCBased の色空間の流れと、構造の木と結び付ける項目を持つほかの流れも集める
 */
function walk(context: PDFContext, roots: PDFObject[], maxDepth: number, maxObjects: number): Reach | { limit: 'pdfImageDepth' | 'pdfImageObjects' } {
  const seen = new Set<PDFObject>();
  const fonts = new Set<string>();
  const contents = new Map<PDFRawStream, PDFDict | undefined>();
  const icc = new Set<PDFRawStream>();
  const structItems = new Set<PDFRawStream>();
  const stack: Array<[PDFObject, number]> = roots.map((r) => [r, 1]);
  const resourcesOf = (d: PDFDict) => {
    const r = d.lookup(PDFName.of('Resources'));
    return r instanceof PDFDict ? r : undefined;
  };
  while (stack.length) {
    const [raw, depth] = stack.pop()!;
    const o = raw instanceof PDFRef ? context.lookup(raw) : raw;
    if (o === undefined || seen.has(o)) continue;
    seen.add(o);
    if (seen.size > maxObjects) return { limit: 'pdfImageObjects' };
    if (depth > maxDepth) return { limit: 'pdfImageDepth' };
    const dict = o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : undefined;
    if (o instanceof PDFRawStream) {
      const pt = o.dict.lookup(PDFName.of('PatternType'));
      if (nameOf(o.dict.lookup(PDFName.of('Subtype'))) === 'Form' || (pt instanceof PDFNumber && pt.asNumber() === 1)) {
        if (!contents.has(o)) contents.set(o, resourcesOf(o.dict));
      } else if (hasStructKeys(o.dict)) structItems.add(o);
    }
    if (dict) {
      if (isUnembeddedFont(dict)) fonts.add(nameOf(dict.lookup(PDFName.of('BaseFont'))) ?? '?');
      if (nameOf(dict.lookup(PDFName.of('Subtype'))) === 'Type3') {
        const procs = dict.lookup(PDFName.of('CharProcs'));
        if (procs instanceof PDFDict)
          for (const v of procs.values()) {
            const g = v instanceof PDFRef ? context.lookup(v) : v;
            if (g instanceof PDFRawStream && !contents.has(g)) contents.set(g, resourcesOf(dict));
          }
      }
      for (const [, v] of dict.entries()) stack.push([v, depth + 1]);
    } else if (o instanceof PDFArray) {
      if (o.size() >= 2 && nameOf(o.lookup(0)) === 'ICCBased') {
        const p = o.lookup(1);
        if (p instanceof PDFRawStream) icc.add(p);
      }
      for (const v of o.asArray()) stack.push([v, depth + 1]);
    }
  }
  for (const s of contents.keys()) structItems.delete(s);
  return { unembeddedFonts: [...fonts].sort(), contents: [...contents].map(([stream, resources]) => ({ stream, ...(resources ? { resources } : {}) })), icc: [...icc], structItems: [...structItems] };
}

const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.asString().slice(1) : undefined);

function isUnembeddedFont(d: PDFDict): boolean {
  if (nameOf(d.lookup(PDFName.of('Type'))) !== 'Font') return false;
  const sub = nameOf(d.lookup(PDFName.of('Subtype')));
  if (sub === 'Type3' || sub === 'Type0') return false;
  const desc = d.lookup(PDFName.of('FontDescriptor'));
  if (!(desc instanceof PDFDict)) return true;
  return !['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(PDFName.of(k)) !== undefined);
}

/**
 * 中身の流れの、MCID を持つ BDC (札と、MCID を持つ属性の辞書。じかに書いた辞書か、資源の Properties の名前) を、同じ札の BMC にする
 * (ISO 32000-1 §14.6: BDC は札と属性、BMC は札だけ。EMC との釣り合いは変わらない)。命令の区切りは §7.8.2・§7.3 の字の決まりで読む
 * (文字列・16 進の文字列・注釈・辞書・内容の流れの中の画像 (BI … ID … EI) の中は、命令として読まない)
 */
export function withoutMcids(content: Uint8Array, resources: PDFDict | undefined): Uint8Array {
  const props = resources?.lookup(PDFName.of('Properties'));
  const hasMcid = (name: string) => {
    const p = props instanceof PDFDict ? props.lookup(PDFName.of(name)) : undefined;
    return p instanceof PDFDict && p.get(PDFName.of('MCID')) !== undefined;
  };
  const out: Uint8Array[] = [];
  let copied = 0;
  // 命令の前の値の並び (始まりの位置と、種類・中身)
  let operands: Array<{ start: number; end: number; kind: 'name' | 'dict' | 'other'; text: string }> = [];
  const n = content.length;
  const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
  const latin1 = (a: number, b: number) => String.fromCharCode(...content.subarray(a, Math.min(b, a + 4096)));
  let i = 0;
  const skipString = () => {
    let depth = 0;
    for (; i < n; i++) {
      const c = content[i];
      if (c === 0x5c) i++;
      else if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) {
        i++;
        return;
      }
    }
  };
  /** 辞書 (<< … >>) を読み飛ばす (入れ子の辞書・文字列も) */
  const skipDict = () => {
    let depth = 0;
    while (i < n) {
      if (content[i] === 0x3c && content[i + 1] === 0x3c) {
        depth++;
        i += 2;
      } else if (content[i] === 0x3e && content[i + 1] === 0x3e) {
        depth--;
        i += 2;
        if (depth === 0) return;
      } else if (content[i] === 0x28) skipString();
      else if (content[i] === 0x25) while (i < n && content[i] !== 0x0a && content[i] !== 0x0d) i++;
      else i++;
    }
  };
  while (i < n) {
    const c = content[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === 0x25) {
      while (i < n && content[i] !== 0x0a && content[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      skipString();
      operands.push({ start, end: i, kind: 'other', text: '' });
      continue;
    }
    if (c === 0x3c && content[i + 1] === 0x3c) {
      skipDict();
      operands.push({ start, end: i, kind: 'dict', text: latin1(start, i) });
      continue;
    }
    if (c === 0x3c) {
      while (i < n && content[i] !== 0x3e) i++;
      i++;
      operands.push({ start, end: i, kind: 'other', text: '' });
      continue;
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
      operands.push({ start, end: i, kind: 'other', text: '' });
      continue;
    }
    if (c === 0x2f) {
      i++;
      while (i < n && !isWs(content[i]) && !isDelim(content[i])) i++;
      operands.push({ start, end: i, kind: 'name', text: latin1(start + 1, i) });
      continue;
    }
    while (i < n && !isWs(content[i]) && !isDelim(content[i])) i++;
    if (i === start) {
      i++;
      continue;
    }
    const word = latin1(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) || word === 'true' || word === 'false' || word === 'null') {
      operands.push({ start, end: i, kind: 'other', text: word });
      continue;
    }
    // 命令
    if (word === 'BDC' && operands.length >= 2) {
      const tag = operands[operands.length - 2];
      const prop = operands[operands.length - 1];
      const mcid = prop.kind === 'dict' ? /\/MCID(?![A-Za-z0-9#])/.test(prop.text) : prop.kind === 'name' && hasMcid(decodeName(prop.text));
      if (tag.kind === 'name' && mcid) {
        out.push(content.subarray(copied, prop.start), BMC);
        copied = i;
      }
    } else if (word === 'BI') {
      // 内容の流れの中の画像: ID の後ろの画素は、EI (前後が空白) まで読み飛ばす (§8.9.7)
      const id = findToken(content, i, 'ID');
      if (id >= 0) {
        let j = id + 3;
        while (j + 2 < n && !(isWs(content[j - 1]) && content[j] === 0x45 && content[j + 1] === 0x49 && (j + 2 >= n || isWs(content[j + 2]) || isDelim(content[j + 2])))) j++;
        i = Math.min(n, j + 2);
      }
    }
    operands = [];
  }
  if (!copied) return content;
  out.push(content.subarray(copied));
  return concat(out);
}

const BMC = new TextEncoder().encode('BMC');

/** 名前の #xx を戻す (§7.3.5) */
const decodeName = (s: string) => s.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** from から後ろで、前後が空白・区切りの語 word の位置 (無ければ -1) */
function findToken(b: Uint8Array, from: number, word: string): number {
  const w = [...word].map((c) => c.charCodeAt(0));
  const ws = (c: number | undefined) => c === undefined || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  for (let i = from; i + w.length <= b.length; i++) if (w.every((c, k) => b[i + k] === c) && ws(b[i - 1]) && ws(b[i + w.length])) return i;
  return -1;
}

/**
 * 埋め込んだページを置く行列 (PDF の座標。左下が (x, y)、大きさ width × height (pt) の枠に置く)。
 * 箱の左下を原点に寄せ、/Rotate の分を時計回りに回し (ISO 32000-1 Table 30)、枠の大きさに伸ばす
 */
export function pdfImageMatrix(box: PdfRect, rotate: 0 | 90 | 180 | 270, x: number, y: number, width: number, height: number): [number, number, number, number, number, number] {
  const w0 = box[2] - box[0];
  const h0 = box[3] - box[1];
  // 回す行列 (箱を原点に寄せた座標から、回した後の座標へ)。回した後の大きさは dw × dh
  const r: [number, number, number, number, number, number] =
    rotate === 90 ? [0, -1, 1, 0, 0, w0] : rotate === 180 ? [-1, 0, 0, -1, w0, h0] : rotate === 270 ? [0, 1, -1, 0, h0, 0] : [1, 0, 0, 1, 0, 0];
  const [dw, dh] = rotate === 90 || rotate === 270 ? [h0, w0] : [w0, h0];
  const sx = width / dw;
  const sy = height / dh;
  // T(x, y) · S(sx, sy) · R · T(−x0, −y0)
  const [a, b, c, d, e, f] = r;
  const e2 = e - a * box[0] - c * box[1];
  const f2 = f - b * box[0] - d * box[1];
  return [sx * a, sy * b, sx * c, sy * d, sx * e2 + x, sy * f2 + y];
}
