/**
 * pdfxVerify — 書き出した PDF そのものを読み直して、PDF/X-1a・PDF/X-3・PDF/X-4 の決まりに合うかを調べる (自前のプリフライト)。
 *
 * PDF/X-1a:2001 (ISO 15930-1:2001) と PDF/X-4 (ISO 15930-7:2010) は、規格の本文を読んで決まりを作り (節の番号を各所に書く)、
 * その決まりに適合することを確かめている。PDF/X-1a:2003 (ISO 15930-4)・PDF/X-3:2003 (ISO 15930-6) は、その本文では確かめておらず、
 * PDF/X-1a:2001 の決まりを当てる (X-3 は、機器によらない色を使えることと、圧縮の方式を調べないことのほかは X-1a と同じ)。
 * 規格が元にする PDF の版の機能 (透明・メタデータの流れは PDF 1.4、OpenType のままの書体の埋め込みは PDF 1.6) は、Adobe の PDF Reference で
 * 確かめた (pdfStandard.ts の先頭のコメント)。入稿の前には、プリフライト (Acrobat Pro など) でも確かめること。
 * 調べるもの:
 *  - 版 (ファイルの頭が PDF 1.3 (X-1a:2001)・1.4 (X-1a:2003・X-3:2003)・1.6 (X-4) 以下)、暗号化しない、trailer の ID がある
 *  - 印: X-1a・X-3 は Info の GTS_PDFXVersion (X-1a:2001 は GTS_PDFXConformance も)・Title・CreationDate・ModDate・Trapped (True か False)。
 *    X-4 は XMP (下の X-4 だけのもの)
 *  - 出力意図: S が GTS_PDFX のものがちょうど 1 つで、OutputConditionIdentifier がある (ISO 15930-1 §6.3.2・ISO 15930-7 §6.4.2.1)。
 *    RegistryName が ICC の登録簿なら、OutputConditionIdentifier は登録簿の名前と完全に一致する。X-1a は、登録簿に無い印刷条件なら
 *    DestOutputProfile が要り、プロファイルは AtoB1 の表 (A2B1) を持つ (ISO 15930-1 §6.3.2)
 *  - ページ: TrimBox か ArtBox のどちらか一方 (両方は不可)。TrimBox (か ArtBox) は BleedBox と CropBox の中 (ISO 15930-1 §6.14)、
 *    BleedBox・TrimBox は MediaBox の中。X-4 は、さらに BleedBox が CropBox の中で、どの箱も MediaBox の中 (ISO 15930-7 §6.12)
 *  - 色: X-1a は CMYK・灰色・特色 (Separation・DeviceN。代わりの色空間も同じ) だけ。DeviceRGB・CalRGB・CalGray・Lab・ICCBased を
 *    色空間の名前として使わない。内容の流れで rg・RG (DeviceRGB の色の命令) を使わない。注釈の色 (C) に RGB を使わない。
 *    X-3 は、機器によらない色 (ICCBased・Lab・CalRGB・CalGray) を使える。X-4 は、機器の色空間は出力意図の色空間 (CMYK) と同じものか
 *    DeviceGray だけ (§6.4.3.2)。4 色の ICCBased の色空間に、出力意図と同じプロファイルを使わない (§6.4.3.3)
 *  - 透明: X-1a・X-3 は使わない (ExtGState の ca・CA が 1 未満・SMask が None でない・BM が Normal (Compatible) でない、画像の SMask・SMaskInData、
 *    透明のグループ)。X-4 は使えるが、描画モード (BM) は PDF の仕様で決まっている名前だけ (§6.20)
 *  - 描画の状態: ExtGState に TR・HTP を書かない。TR2 は Default だけ (X-1a は TR2 も不可)。網点 (HalftoneType) は 1 か 5 だけで、HalftoneName を
 *    書かない (ISO 15930-1 §6.15・ISO 15930-7 §6.13)
 *  - PostScript: PostScript の XObject (Subtype PS、Form の Subtype2 PS) と、内容の流れの PS の命令を使わない (ISO 15930-1 §6.16・ISO 15930-7 §6.14・§6.19)
 *  - 圧縮の方式: X-1a は、画像でない流れは FlateDecode・RunLengthDecode だけ、画像は DCTDecode・FlateDecode・RunLengthDecode と、
 *    1 ビットの画像の CCITTFaxDecode だけ (ISO 15930-1 §6.8)。X-4 は LZWDecode と Crypt を使わない (ISO 15930-7 §6.8)
 *  - 動作と JavaScript: 動作 (A・AA・カタログの OpenAction)・JavaScript (名前の辞書の JavaScript を含む) を使わない (ISO 15930-1 §6.20・ISO 15930-7 §6.18)
 *  - 書体: Type3 のほかは埋め込む (FontFile・FontFile2・FontFile3)。PDF 1.6 より前の版では、FontFile3 の OpenType (PDF Reference の PDF 1.6 版
 *    Table 5.24) を使わない
 *  - 注釈: 塗り足しまでの範囲 (BleedBox) に掛かるものを置かない。例外は、X-1a・X-3 は TrapNet だけ (ISO 15930-1 §6.19)、X-4 は TrapNet と
 *    PrinterMark で、PrinterMark は TrimBox (か ArtBox) の外 (縁に接するのは外とみなす。ISO 15930-7 §6.17)
 *  - X-4 だけのもの: カタログの Metadata があり、その流れに Filter が無い (§6.10.1)。XMP の包みの頭に bytes・encoding の属性が無い (§6.10.3)。
 *    XMP に xmp:CreateDate・ModifyDate・MetadataDate・dc:title (空でない)・xmpMM:DocumentID・VersionID・RenditionClass がある (§6.10.4)。
 *    pdf:Trapped が True か False (§6.9)。pdfxid:GTS_PDFXVersion が PDF/X-4 で、pdfxid にほかの項目が無く、Info に GTS_PDFXConformance が無い (§6.11)。
 *    Info と XMP の値が同じ (Title・Author・Subject・Keywords・Creator・Producer・CreationDate・ModDate・Trapped・GTS_PDFXVersion。日付は UTC に
 *    直して比べる。§6.10.2)。出力意図に DestOutputProfile があり、DestOutputProfileRef が無く、プロファイルは出力機器のもの (機器の種類 prtr。§6.4.2.1)
 * 合わないものを、利用者に見せる文の並びにして返す (空なら合う)。
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFParser, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib';
import { msg } from './messages';
import { contentStreams } from './pdfContentStreams';
import { ICC_CMYK_REGISTRY, iccDeviceClass, iccHasTag } from './iccRegistry';

/** PDF/X-1a で使えない色空間の名前 (内容の流れの中の略記 RGB も) */
const FORBIDDEN_SPACES_X1A = new Set(['DeviceRGB', 'CalRGB', 'CalGray', 'Lab', 'ICCBased', 'RGB']);
/** PDF/X-3 で使えない色空間の名前 (X-1a から、機器によらない色 ICCBased・Lab・CalRGB・CalGray を外したもの) */
const FORBIDDEN_SPACES_X3 = new Set(['DeviceRGB', 'RGB']);
/** 描画モードの名前 (ISO 32000-1 §11.3.5 の Table 136・137。ISO 15930-7 §6.20) */
const BLEND_MODES = new Set(['Normal', 'Compatible', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge', 'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity']);
/** 内容の流れの中の画像 (BI … ID) の圧縮の方式の略記 (ISO 32000-1 §8.9.7 の Table 94) */
const INLINE_FILTERS: Record<string, string> = { AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', Fl: 'FlateDecode', RL: 'RunLengthDecode', CCF: 'CCITTFaxDecode', DCT: 'DCTDecode' };
/** 出力意図の RegistryName のうち、ICC の登録簿を指すもの (末尾の / と、http・https の違いは同じとみなす) */
const isIccRegistry = (s: string) => /^https?:\/\/www\.color\.org\/?$/i.test(s.trim());

/** 検査の版 */
type PdfXVersion = 'X-1a:2001' | 'X-1a:2003' | 'X-3:2003' | 'X-4';

/**
 * PDF を読む (PDFDocument.load と同じ: 1 度に 100 個ずつのオブジェクト、暗号化を気にせず、メタデータを書き換えない)。
 * pdf-lib の読み込みは、流れ (画像・書体・ページの命令) の中身を、読んだバイト列から写す (ByteStream の slice) ので、画像の多い PDF では、
 * 出力の大きさの分だけ、検査のあいだのメモリが増える。検査は読むだけで、bytes も検査の間は変えないので、写さずに bytes の部分の見方
 * (subarray) にする (この読み込みの ByteStream だけを差し替える。オブジェクトストリームの中身は、展開した写しのまま)
 */
export async function loadWithoutCopy(bytes: Uint8Array): Promise<PDFDocument> {
  const parser = PDFParser.forBytesWithOptions(bytes, 100);
  const stream = (parser as unknown as { bytes?: { slice?: (start: number, end: number) => Uint8Array } }).bytes;
  if (stream && typeof stream.slice === 'function') stream.slice = (start: number, end: number) => bytes.subarray(start, end);
  const context = await parser.parseDocument();
  // PDFDocument.load と同じに、読んだ文脈から文書を作る (作り方の関数は公開されていない)
  const Doc = PDFDocument as unknown as new (context: unknown, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  return new Doc(context, true, false);
}

/** PDF の日付 (D:YYYYMMDDHHmmSSOHH'mm'。ISO 32000-1 §7.9.4) を、1970 年からのミリ秒 (UTC) にする。読めなければ undefined */
export function pdfDate(s: string): number | undefined {
  const m = /^D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?(Z|[+-]\d\d'?\d\d'?)?/.exec(s);
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz] = m;
  let off = 0;
  if (tz && tz !== 'Z') {
    const t = /([+-])(\d\d)'?(\d\d)/.exec(tz)!;
    off = (t[1] === '-' ? -1 : 1) * (Number(t[2]) * 60 + Number(t[3]));
  }
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)) - off * 60000;
}

/** XML の文字参照と定義済みの実体 (&lt; など) を解く */
const xmlUnescape = (v: string) =>
  v.replace(/&#x([0-9a-f]+);|&#(\d+);|&(lt|gt|amp|quot|apos);/gi, (_, h, d, n) => (h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(Number(d)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()]));

/** 書き出した PDF/X-1a の PDF を調べる。version は 'X-1a:2001' か 'X-1a:2003' */
export function verifyPdfX1a(bytes: Uint8Array, version: 'X-1a:2001' | 'X-1a:2003'): Promise<string[]> {
  return verifyPdfX(bytes, version);
}

/** 書き出した PDF/X-3:2003 の PDF を調べる */
export function verifyPdfX3(bytes: Uint8Array): Promise<string[]> {
  return verifyPdfX(bytes, 'X-3:2003');
}

/** 書き出した PDF/X-4 の PDF を調べる */
export function verifyPdfX4(bytes: Uint8Array): Promise<string[]> {
  return verifyPdfX(bytes, 'X-4');
}

/** 書き出した PDF/X の PDF を調べる (ファイルの冒頭の説明) */
async function verifyPdfX(bytes: Uint8Array, version: PdfXVersion): Promise<string[]> {
  const out = new Set<string>();
  const add = (ja: string, en: string) => out.add(msg(ja, en));
  const x4 = version === 'X-4';
  const x1a = version === 'X-1a:2001' || version === 'X-1a:2003';
  const maxVersion = version === 'X-1a:2001' ? 1.3 : x4 ? 1.6 : 1.4;
  const head = /^%PDF-(\d\.\d)/.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 16)));
  if (!head || Number(head[1]) > maxVersion) add(`PDF の版が ${head?.[1] ?? '不明'} です (${maxVersion} 以下にします)`, `the PDF version is ${head?.[1] ?? 'unknown'} (must be ${maxVersion} or lower)`);
  const pdf = await loadWithoutCopy(bytes);
  const ctx = pdf.context;
  if (ctx.trailerInfo.Encrypt) add('暗号化しています', 'the file is encrypted');
  if (!ctx.trailerInfo.ID) add('文書の ID (trailer の ID) がありません', 'the document ID (trailer ID) is missing');

  // 印 (Info)
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict);
  const infoText = (key: string) => {
    const v = info?.lookup(PDFName.of(key));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  const expected = version === 'X-1a:2001' ? 'PDF/X-1:2001' : version === 'X-1a:2003' ? 'PDF/X-1a:2003' : version === 'X-3:2003' ? 'PDF/X-3:2003' : 'PDF/X-4';
  const trapped = info?.lookup(PDFName.of('Trapped'));
  if (!x4) {
    if (infoText('GTS_PDFXVersion') !== expected) add(`Info の GTS_PDFXVersion が ${expected} ではありません`, `GTS_PDFXVersion in Info is not ${expected}`);
    if (version === 'X-1a:2001' && infoText('GTS_PDFXConformance') !== 'PDF/X-1a:2001') add('Info の GTS_PDFXConformance が PDF/X-1a:2001 ではありません', 'GTS_PDFXConformance in Info is not PDF/X-1a:2001');
    for (const key of ['Title', 'CreationDate', 'ModDate']) if (!infoText(key)) add(`Info の ${key} がありません`, `${key} is missing from Info`);
    if (!(trapped instanceof PDFName) || !['/True', '/False'].includes(trapped.asString())) add('Info の Trapped が True か False ではありません', 'Trapped in Info is not True or False');
  } else if (info?.get(PDFName.of('GTS_PDFXConformance'))) add('Info に GTS_PDFXConformance があります (PDF/X-4 では書きません)', 'Info has GTS_PDFXConformance (not allowed in PDF/X-4)');

  // 出力意図 (ISO 15930-1 §6.3.2・ISO 15930-7 §6.4.2.1)
  const intents = (pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)?.asArray() ?? []).map((r) => ctx.lookup(r)).filter((d): d is PDFDict => d instanceof PDFDict);
  const pdfxIntents = intents.filter((d) => String(d.get(PDFName.of('S'))) === '/GTS_PDFX');
  const intent = pdfxIntents[0];
  const intentText = (key: string) => {
    const v = intent?.lookup(PDFName.of(key));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  const condition = intentText('OutputConditionIdentifier');
  if (!intent || condition === undefined) add('出力意図 (OutputIntents の GTS_PDFX と OutputConditionIdentifier) がありません', 'the output intent (GTS_PDFX with OutputConditionIdentifier in OutputIntents) is missing');
  if (pdfxIntents.length > 1) add(`S が GTS_PDFX の出力意図が ${pdfxIntents.length} 個あります (ちょうど 1 つにします)`, `there are ${pdfxIntents.length} output intents with S GTS_PDFX (there must be exactly one)`);
  const registry = intentText('RegistryName');
  const registered = condition !== undefined && ICC_CMYK_REGISTRY.has(condition);
  if (condition !== undefined && registry !== undefined && isIccRegistry(registry) && !registered)
    add(`出力意図の RegistryName が ICC の登録簿なのに、印刷条件 "${condition}" が登録簿の名前と一致しません`, `RegistryName of the output intent is the ICC registry, but the printing condition "${condition}" does not match a registered name`);
  const profileObj = intent?.get(PDFName.of('DestOutputProfile'));
  const profileStream = intent?.lookup(PDFName.of('DestOutputProfile'));
  let profile: Uint8Array | undefined;
  if (profileStream instanceof PDFRawStream) {
    try {
      profile = decodePDFRawStream(profileStream).decode();
    } catch {
      profile = undefined;
    }
  }
  if (intent && x1a) {
    if (!profileObj && condition !== undefined && !registered)
      add(`印刷条件 "${condition}" が ICC の登録簿に無いのに、出力意図に DestOutputProfile がありません`, `the printing condition "${condition}" is not in the ICC registry, but the output intent has no DestOutputProfile`);
    if (profileObj && (!profile || !iccHasTag(profile, 'A2B1'))) add('出力意図の ICC プロファイルが AtoB1 の表 (タグ A2B1) を持ちません', 'the ICC profile of the output intent has no AtoB1 table (the A2B1 tag)');
  }
  if (intent && x4) {
    if (!profileObj) add('出力意図に DestOutputProfile がありません', 'the output intent has no DestOutputProfile');
    if (intent.get(PDFName.of('DestOutputProfileRef'))) add('出力意図に DestOutputProfileRef があります', 'the output intent has DestOutputProfileRef');
    if (profileObj && (!profile || iccDeviceClass(profile) !== 'prtr')) add('出力意図の ICC プロファイルが出力機器のもの (機器の種類 prtr) ではありません', 'the ICC profile of the output intent is not an output device profile (device class prtr)');
  }
  /** 出力意図の色空間 (X-4 の機器の色空間の決まり。§6.4.3.2)。読めなければ CMYK とみなす */
  const intentSpace = profile && profile.length >= 20 ? String.fromCharCode(...profile.subarray(16, 20)).trim() : 'CMYK';
  const FORBIDDEN_SPACES = x1a ? FORBIDDEN_SPACES_X1A : version === 'X-3:2003' ? FORBIDDEN_SPACES_X3 : new Set(intentSpace === 'RGB' ? ['DeviceCMYK', 'CMYK'] : intentSpace === 'GRAY' ? ['DeviceRGB', 'RGB', 'DeviceCMYK', 'CMYK'] : ['DeviceRGB', 'RGB']);
  /** 内容の流れで使えない色の命令 */
  const forbiddenOps = x4 && intentSpace === 'RGB' ? ['k', 'K'] : x4 && intentSpace === 'GRAY' ? ['k', 'K', 'rg', 'RG'] : ['rg', 'RG'];

  // カタログ: 動作と JavaScript (ISO 15930-1 §6.20・ISO 15930-7 §6.18)
  const open = pdf.catalog.lookup(PDFName.of('OpenAction'));
  if (open instanceof PDFDict) add('文書を開いたときの動作 (OpenAction) があります', 'the document has an open action (OpenAction)');
  if (pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.get(PDFName.of('JavaScript'))) add('JavaScript があります', 'contains JavaScript');

  // ページの範囲と注釈
  pdf.getPages().forEach((page, k) => {
    const node = page.node;
    const n = k + 1;
    const hasTrim = !!node.get(PDFName.of('TrimBox'));
    const hasArt = !!node.get(PDFName.of('ArtBox'));
    if (hasTrim === hasArt) add(`${n} ページ目: TrimBox か ArtBox のどちらか一方が要ります`, `page ${n}: exactly one of TrimBox and ArtBox is required`);
    type Box = { x: number; y: number; width: number; height: number };
    const within = (b: Box, o: Box) => b.x >= o.x - 0.01 && b.y >= o.y - 0.01 && b.x + b.width <= o.x + o.width + 0.01 && b.y + b.height <= o.y + o.height + 0.01;
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    const bleed = page.getBleedBox();
    const trim = hasArt && !hasTrim ? page.getArtBox() : page.getTrimBox();
    if (!within(bleed, media) || !within(trim, media)) add(`${n} ページ目: BleedBox・TrimBox が MediaBox からはみ出しています`, `page ${n}: BleedBox or TrimBox extends beyond MediaBox`);
    // TrimBox (か ArtBox) は BleedBox と CropBox の中 (ISO 15930-1 §6.14)
    if (!within(trim, bleed) || !within(trim, crop)) add(`${n} ページ目: TrimBox (か ArtBox) が BleedBox・CropBox からはみ出しています`, `page ${n}: TrimBox (or ArtBox) extends beyond BleedBox or CropBox`);
    // X-4: BleedBox は CropBox の中で、どの箱も MediaBox の中 (ISO 15930-7 §6.12)
    if (x4 && (!within(bleed, crop) || !within(crop, media))) add(`${n} ページ目: BleedBox が CropBox から、か CropBox が MediaBox からはみ出しています`, `page ${n}: BleedBox extends beyond CropBox, or CropBox beyond MediaBox`);
    if (x4 && hasArt && !within(page.getArtBox(), media)) add(`${n} ページ目: ArtBox が MediaBox からはみ出しています`, `page ${n}: ArtBox extends beyond MediaBox`);
    /** 矩形 (Rect) が箱 b に掛かるか (縁に接するだけなら掛からない) */
    const hits = (r: number[], b: Box) => Math.min(r[0], r[2]) < b.x + b.width && Math.max(r[0], r[2]) > b.x && Math.min(r[1], r[3]) < b.y + b.height && Math.max(r[1], r[3]) > b.y;
    for (const ref of node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []) {
      const an = ctx.lookup(ref);
      if (!(an instanceof PDFDict)) continue;
      const subtype = String(an.get(PDFName.of('Subtype')));
      const rect = an.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
      // 塗り足しまでの範囲に掛けてよい注釈: X-1a・X-3 は TrapNet だけ (ISO 15930-1 §6.19)、X-4 は TrapNet と PrinterMark (ISO 15930-7 §6.17)
      const exempt = subtype === '/TrapNet' || (x4 && subtype === '/PrinterMark');
      if (rect && !exempt && hits(rect, bleed)) add(`${n} ページ目: 塗り足しまでの範囲に注釈 (${subtype.slice(1)}) があります`, `page ${n}: an annotation (${subtype.slice(1)}) lies within the bleed area`);
      if (rect && x4 && subtype === '/PrinterMark' && hits(rect, trim)) add(`${n} ページ目: 印刷の印の注釈 (PrinterMark) が TrimBox (か ArtBox) に掛かっています`, `page ${n}: a printer's mark annotation (PrinterMark) overlaps TrimBox (or ArtBox)`);
      if (!x4 && (an.lookupMaybe(PDFName.of('C'), PDFArray)?.size() ?? 0) === 3) add(`${n} ページ目: 注釈の色が RGB です`, `page ${n}: an annotation color is RGB`);
    }
  });

  // X-4: メタデータ (XMP)
  if (x4) verifyX4Metadata(pdf, info, add);

  // 出力意図の辞書 (ICC プロファイル) の中は、色空間の名前を調べない
  const skip = new Set<PDFObject>();
  for (const it of pdfxIntents) {
    skip.add(it);
    const prof = it.get(PDFName.of('DestOutputProfile'));
    if (prof instanceof PDFRef) skip.add(ctx.lookup(prof)!);
  }
  /** 出力意図のプロファイルと同じ中身か (ICCBased の色空間の流れ。読んだ中身を覚える) */
  const sameAsIntent = new Map<string, boolean>();
  const isIntentProfile = (ref: PDFObject | undefined) => {
    if (!profile || !(ref instanceof PDFRef)) return false;
    if (ref === profileObj || (profileObj instanceof PDFRef && ref.toString() === profileObj.toString())) return true;
    const key = ref.toString();
    if (!sameAsIntent.has(key)) {
      const s = ctx.lookup(ref);
      let same = false;
      if (s instanceof PDFRawStream) {
        try {
          const b = decodePDFRawStream(s).decode();
          same = b.length === profile.length && b.every((v, i) => v === profile![i]);
        } catch {
          same = false;
        }
      }
      sameAsIntent.set(key, same);
    }
    return sameAsIntent.get(key)!;
  };
  const checkedGs = new Set<PDFDict>();
  /** 描画の状態の辞書 (ExtGState): TR・HTP・TR2 (ISO 15930-1 §6.15・ISO 15930-7 §6.13) */
  const checkGs = (gs: PDFDict) => {
    if (checkedGs.has(gs)) return;
    checkedGs.add(gs);
    if (gs.get(PDFName.of('TR'))) add('描画の状態 (ExtGState) に転送の関数 (TR) があります', 'an ExtGState has a transfer function (TR)');
    if (gs.get(PDFName.of('HTP'))) add('描画の状態 (ExtGState) に HTP があります', 'an ExtGState has HTP');
    const tr2 = gs.get(PDFName.of('TR2'));
    if (tr2 && (x1a || !(tr2 instanceof PDFName && tr2.asString() === '/Default'))) add(x1a ? '描画の状態 (ExtGState) に転送の関数 (TR2) があります' : '描画の状態 (ExtGState) の転送の関数 (TR2) が Default ではありません', x1a ? 'an ExtGState has a transfer function (TR2)' : 'TR2 of an ExtGState is not Default');
  };

  /** 辞書・配列の中の名前を調べる (間接参照はたどらない。間接の物は外の繰り返しで 1 度ずつ調べる) */
  const scanValue = (v: PDFObject | undefined, path: string): void => {
    if (!v || skip.has(v)) return;
    if (v instanceof PDFName) {
      const name = v.asString().slice(1);
      if (FORBIDDEN_SPACES.has(name) && name !== 'RGB' && name !== 'CMYK') add(`使えない色空間 ${name} を使っています (${path})`, `uses the color space ${name}, which is not allowed (${path})`);
      return;
    }
    if (v instanceof PDFArray) {
      // X-4: 4 色の ICCBased の色空間に、出力意図と同じプロファイルを使わない (§6.4.3.3)
      if (x4 && v.size() === 2 && String(v.get(0)) === '/ICCBased' && intentSpace === 'CMYK' && isIntentProfile(v.get(1))) add(`ICCBased の色空間に、出力意図と同じプロファイルを使っています (${path})`, `an ICCBased color space uses the same profile as the output intent (${path})`);
      v.asArray().forEach((x) => scanValue(x, path));
      return;
    }
    if (v instanceof PDFDict) scanDict(v, path);
  };
  const num = (d: PDFDict, key: string) => {
    const x = d.get(PDFName.of(key));
    return x instanceof PDFNumber ? x.asNumber() : undefined;
  };
  const scanDict = (d: PDFDict, path: string): void => {
    if (skip.has(d)) return;
    // 透明 (X-1a・X-3)。X-4 は透明を使えるが、描画モードは決まった名前だけ (§6.20)
    const bm = d.get(PDFName.of('BM'));
    if (!x4) {
      const ca = num(d, 'ca');
      const CA = num(d, 'CA');
      if ((ca !== undefined && ca < 1) || (CA !== undefined && CA < 1)) add('透明 (不透明度) を使っています', 'uses transparency (opacity)');
      const smask = d.get(PDFName.of('SMask'));
      if (smask && !(smask instanceof PDFName && smask.asString() === '/None')) add('透明 (ソフトマスク・画像の透明度) を使っています', 'uses transparency (soft mask or image transparency)');
      if (bm && !(bm instanceof PDFName && ['/Normal', '/Compatible'].includes(bm.asString()))) add('透明 (描画モード) を使っています', 'uses transparency (blend mode)');
      if ((num(d, 'SMaskInData') ?? 0) > 0) add('透明 (画像の透明度) を使っています', 'uses transparency (image transparency)');
      const group = d.lookup(PDFName.of('Group'));
      if (group instanceof PDFDict && String(group.get(PDFName.of('S'))) === '/Transparency') add('透明のグループを使っています', 'uses a transparency group');
    } else if (bm) {
      const names = bm instanceof PDFArray ? bm.asArray() : [bm];
      for (const b of names) if (!(b instanceof PDFName) || !BLEND_MODES.has(b.asString().slice(1))) add(`決まっていない描画モード (${String(b)}) を使っています`, `uses a blend mode that is not defined (${String(b)})`);
    }
    // 描画の状態 (ExtGState) と網点 (ISO 15930-1 §6.15・ISO 15930-7 §6.13)
    if (String(d.get(PDFName.of('Type'))) === '/ExtGState') checkGs(d);
    const gsDict = d.lookup(PDFName.of('ExtGState'));
    if (gsDict instanceof PDFDict) for (const [, g] of gsDict.entries()) {
      const gs = g instanceof PDFRef ? ctx.lookup(g) : g;
      if (gs instanceof PDFDict) checkGs(gs);
    }
    const ht = num(d, 'HalftoneType');
    if (ht !== undefined && ht !== 1 && ht !== 5) add(`網点の種類 (HalftoneType ${ht}) は使えません (1 か 5 だけ)`, `the halftone type (HalftoneType ${ht}) is not allowed (only 1 or 5)`);
    if (ht !== undefined && d.get(PDFName.of('HalftoneName'))) add('網点の辞書に HalftoneName があります', 'a halftone dictionary has HalftoneName');
    // PostScript の XObject (ISO 15930-1 §6.16・ISO 15930-7 §6.14)
    if (String(d.get(PDFName.of('Subtype'))) === '/PS' || String(d.get(PDFName.of('Subtype2'))) === '/PS') add('PostScript の XObject を使っています', 'uses a PostScript XObject');
    // 動作と JavaScript (ISO 15930-1 §6.20・ISO 15930-7 §6.18)
    const action = d.lookup(PDFName.of('A'));
    if (action instanceof PDFDict && action.get(PDFName.of('S'))) add(`動作 (${String(action.get(PDFName.of('S'))).slice(1)}) を使っています`, `uses an action (${String(action.get(PDFName.of('S'))).slice(1)})`);
    if (d.get(PDFName.of('AA'))) add('追加の動作 (AA) を使っています', 'uses additional actions (AA)');
    // 構造の節 (Type StructElem) の S は構造の型で、動作の種類ではない (ISO 32000-1 §14.7.2 の Table 323。role="JavaScript" の独自の型など)
    if ((String(d.get(PDFName.of('S'))) === '/JavaScript' && String(d.get(PDFName.of('Type'))) !== '/StructElem') || d.get(PDFName.of('JS'))) add('JavaScript があります', 'contains JavaScript');
    // 書体
    if (String(d.get(PDFName.of('Type'))) === '/Font') checkFont(d);
    if (String(d.get(PDFName.of('Subtype'))) === '/OpenType' && maxVersion < 1.6) add('書体を OpenType のまま埋め込んでいます (PDF 1.6 の機能)', 'embeds a font as OpenType (a PDF 1.6 feature)');
    for (const [key, value] of d.entries()) {
      // 名前 (/Name など) や書体の名前の値は、色空間ではない
      if (['Type', 'Subtype', 'BaseFont', 'FontName', 'Name', 'S', 'Filter', 'BM'].includes(key.asString().slice(1))) continue;
      scanValue(value, `${path}/${key.asString().slice(1)}`);
    }
  };
  const embeddedFile = (desc: PDFDict | undefined) => !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(PDFName.of(k)));
  const checkFont = (font: PDFDict) => {
    const subtype = String(font.get(PDFName.of('Subtype')));
    if (subtype === '/Type3') return;
    const name = String(font.get(PDFName.of('BaseFont')) ?? '').slice(1);
    if (subtype === '/Type0') {
      const desc = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0);
      if (desc instanceof PDFDict && !embeddedFile(desc.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict))) add(`書体 ${name} を埋め込んでいません`, `the font ${name} is not embedded`);
      return;
    }
    if (subtype === '/CIDFontType0' || subtype === '/CIDFontType2' || subtype === '/Type1' || subtype === '/MMType1' || subtype === '/TrueType') {
      if (!embeddedFile(font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict))) add(`書体 ${name} を埋め込んでいません`, `the font ${name} is not embedded`);
    }
  };
  /** 圧縮の方式 (ISO 15930-1 §6.8・ISO 15930-7 §6.8)。filters は方式の名前の並び、image は画像か、oneBit は 1 ビットの画像か */
  const checkFilters = (filters: string[], image: boolean, oneBit: boolean, where: string) => {
    for (const f of filters) {
      if (x4) {
        if (f === 'LZWDecode' || f === 'Crypt') add(`使えない圧縮の方式 ${f} を使っています (${where})`, `uses the filter ${f}, which is not allowed (${where})`);
      } else if (x1a) {
        const ok = image ? ['DCTDecode', 'FlateDecode', 'RunLengthDecode', ...(oneBit ? ['CCITTFaxDecode'] : [])].includes(f) : ['FlateDecode', 'RunLengthDecode'].includes(f);
        if (!ok) add(`使えない圧縮の方式 ${f} を使っています (${where})`, `uses the filter ${f}, which is not allowed (${where})`);
      }
    }
  };
  const filterNames = (v: PDFObject | undefined): string[] => {
    const list = v instanceof PDFArray ? v.asArray() : v ? [v] : [];
    return list.map((x) => (x instanceof PDFRef ? ctx.lookup(x) : x)).filter((x): x is PDFName => x instanceof PDFName).map((x) => x.asString().slice(1));
  };

  // 内容の流れ (ページ・Form XObject・模様・Type3 の字形・注釈の見え方) だけで命令を探す (書体のファイルなどの流れの、命令と同じ字を拾わない)
  const contents = contentStreams(pdf);

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (skip.has(obj)) continue;
    const where = `${ref.objectNumber} 0 obj`;
    if (obj instanceof PDFRawStream) {
      scanDict(obj.dict, where);
      const d = obj.dict;
      const subtype = String(d.get(PDFName.of('Subtype')));
      const image = subtype === '/Image';
      const imageMask = String(d.get(PDFName.of('ImageMask'))) === 'true';
      checkFilters(filterNames(d.get(PDFName.of('Filter'))), image, image && (imageMask || num(d, 'BitsPerComponent') === 1), where);
      // 内容の流れ (ページ・Form XObject・模様・Type3 の字形): 色の命令・色空間の名前・PS の命令・内容の流れの中の画像
      if (!contents.has(obj)) continue;
      let text: string;
      try {
        text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        continue;
      }
      // 字の符号 (<…>・(…)) を除いてから、命令を探す
      const ops = text.replace(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)/g, ' ');
      const usedOps = forbiddenOps.filter((o) => new RegExp(`(^|\\s)${o}(?=\\s|$)`).test(ops));
      if (usedOps.some((o) => o === 'rg' || o === 'RG')) add(`RGB の色 (rg・RG) を使っています (${where})`, `uses RGB colors (rg/RG) (${where})`);
      if (usedOps.some((o) => o === 'k' || o === 'K')) add(`CMYK の色 (k・K) を使っています (${where})`, `uses CMYK colors (k/K) (${where})`);
      for (const m of ops.matchAll(/\/(DeviceRGB|RGB|DeviceCMYK|CMYK|CalRGB|CalGray|Lab|ICCBased)(?![\w#.+-])/g)) if (FORBIDDEN_SPACES.has(m[1])) add(`使えない色空間 ${m[1]} を使っています (${where})`, `uses the color space ${m[1]}, which is not allowed (${where})`);
      if (/(^|\s)PS(?=\s|$)/.test(ops)) add(`PostScript の命令 (PS) を使っています (${where})`, `uses the PostScript operator (PS) (${where})`);
      // 内容の流れの中の画像 (BI … ID) の圧縮の方式 (略記も。ISO 32000-1 §8.9.7)
      for (const m of ops.matchAll(/(?:^|\s)BI\s([\s\S]*?)\sID\s/g)) {
        const f = /\/(?:F|Filter)\s*(\[[^\]]*\]|\/[^\s/[\]]+)/.exec(m[1]);
        const names = f ? [...f[1].matchAll(/\/([^\s/[\]]+)/g)].map((x) => INLINE_FILTERS[x[1]] ?? x[1]) : [];
        const oneBit = /\/(?:BPC|BitsPerComponent)\s+1(?!\d)/.test(m[1]) || /\/(?:IM|ImageMask)\s+true/.test(m[1]);
        checkFilters(names, true, oneBit, where);
      }
    } else scanValue(obj, where);
  }
  return [...out];
}

/**
 * PDF/X-4 のメタデータ (XMP) を調べる (ISO 15930-7 §6.9・§6.10・§6.11)。XMP は、Kumiori の書く形 (要素で書く項目) と、
 * 属性で書く項目 (rdf:Description の属性) の両方を読む
 */
function verifyX4Metadata(pdf: PDFDocument, info: PDFDict | undefined, add: (ja: string, en: string) => void) {
  const meta = pdf.catalog.lookup(PDFName.of('Metadata'));
  if (!(meta instanceof PDFRawStream)) {
    add('カタログに XMP のメタデータ (Metadata) がありません', 'the catalog has no XMP metadata (Metadata)');
    return;
  }
  // メタデータの流れは圧縮しない (§6.10.1)
  if (meta.dict.get(PDFName.of('Filter'))) add('XMP のメタデータの流れを圧縮しています (Filter があります)', 'the XMP metadata stream is compressed (it has a Filter)');
  let xmp: string;
  try {
    xmp = new TextDecoder().decode(decodePDFRawStream(meta).decode());
  } catch {
    add('XMP のメタデータを読めません', 'cannot read the XMP metadata');
    return;
  }
  // 包みの頭に bytes・encoding の属性を書かない (§6.10.3)
  const packet = /<\?xpacket\s+begin=[^?]*\?>/.exec(xmp)?.[0];
  if (packet && /\s(bytes|encoding)\s*=/.test(packet)) add('XMP の包みの頭 (xpacket) に bytes・encoding の属性があります', 'the XMP packet header (xpacket) has a bytes or encoding attribute');
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** 簡単な値の項目 (要素の <p>値</p> か、属性の p="値") */
  const simple = (p: string): string | undefined => {
    const el = new RegExp(`<${esc(p)}>([^<]*)</${esc(p)}>`).exec(xmp);
    if (el) return xmlUnescape(el[1]);
    const at = new RegExp(`\\s${esc(p)}\\s*=\\s*"([^"]*)"`).exec(xmp) ?? new RegExp(`\\s${esc(p)}\\s*=\\s*'([^']*)'`).exec(xmp);
    return at ? xmlUnescape(at[1]) : undefined;
  };
  /** 言語の選べる値 (rdf:Alt) の x-default (無ければ最初の値) */
  const alt = (p: string): string | undefined => {
    const body = new RegExp(`<${esc(p)}>([\\s\\S]*?)</${esc(p)}>`).exec(xmp)?.[1];
    if (body === undefined) return simple(p);
    const def = /<rdf:li[^>]*xml:lang="x-default"[^>]*>([^<]*)</.exec(body) ?? /<rdf:li[^>]*>([^<]*)</.exec(body);
    return def ? xmlUnescape(def[1]) : undefined;
  };
  /** 並び (rdf:Seq) の値を 1 つの文字列にする (作者は 1 人なら、その名前) */
  const seq = (p: string): string | undefined => {
    const body = new RegExp(`<${esc(p)}>([\\s\\S]*?)</${esc(p)}>`).exec(xmp)?.[1];
    if (body === undefined) return simple(p);
    const items = [...body.matchAll(/<rdf:li[^>]*>([^<]*)</g)].map((m) => xmlUnescape(m[1]));
    return items.length ? items.join(', ') : undefined;
  };
  // 版の印 (§6.11): pdfxid:GTS_PDFXVersion は PDF/X-4 で、pdfxid にほかの項目が無い
  const version = simple('pdfxid:GTS_PDFXVersion');
  if (version !== 'PDF/X-4') add('XMP の pdfxid:GTS_PDFXVersion が PDF/X-4 ではありません', 'pdfxid:GTS_PDFXVersion in XMP is not PDF/X-4');
  const others = new Set([...xmp.matchAll(/<pdfxid:([\w.-]+)|\spdfxid:([\w.-]+)\s*=/g)].map((m) => m[1] ?? m[2]).filter((n) => n !== 'GTS_PDFXVersion'));
  if (others.size) add(`XMP の pdfxid に、GTS_PDFXVersion のほかの項目 (${[...others].join('・')}) があります`, `pdfxid in XMP has properties other than GTS_PDFXVersion (${[...others].join(', ')})`);
  // 要る項目 (§6.10.4)
  for (const p of ['xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate', 'xmpMM:DocumentID', 'xmpMM:VersionID', 'xmpMM:RenditionClass'])
    if (!simple(p)) add(`XMP に ${p} がありません`, `${p} is missing from XMP`);
  const title = alt('dc:title');
  if (!title) add('XMP に dc:title (空でないもの) がありません', 'dc:title (non-empty) is missing from XMP');
  // pdf:Trapped は True か False (§6.9)
  const trappedX = simple('pdf:Trapped');
  if (trappedX !== 'True' && trappedX !== 'False') add('XMP の pdf:Trapped が True か False ではありません', 'pdf:Trapped in XMP is not True or False');
  // Info と XMP の一致 (§6.10.2)
  const infoValue = (key: string) => {
    const v = info?.lookup(PDFName.of(key));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : v instanceof PDFName ? v.asString().slice(1) : undefined;
  };
  const pairs: Array<[string, () => string | undefined]> = [
    ['Title', () => title],
    ['Author', () => seq('dc:creator')],
    ['Subject', () => alt('dc:description')],
    ['Keywords', () => simple('pdf:Keywords')],
    ['Creator', () => simple('xmp:CreatorTool')],
    ['Producer', () => simple('pdf:Producer')],
    ['Trapped', () => trappedX],
    ['GTS_PDFXVersion', () => version],
  ];
  for (const [key, xmpOf] of pairs) {
    const a = infoValue(key);
    if (a !== undefined && a !== xmpOf()) add(`Info の ${key} と XMP の値が違います`, `${key} in Info differs from XMP`);
  }
  for (const [key, p] of [['CreationDate', 'xmp:CreateDate'], ['ModDate', 'xmp:ModifyDate']] as const) {
    const a = infoValue(key);
    if (a === undefined) continue;
    const t = pdfDate(a);
    const x = simple(p);
    if (t === undefined || x === undefined || Date.parse(x) !== t) add(`Info の ${key} と XMP の日付が違います`, `${key} in Info differs from the XMP date`);
  }
}
