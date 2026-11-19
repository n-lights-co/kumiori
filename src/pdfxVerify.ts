/**
 * pdfxVerify — 書き出した PDF そのものを読み直して、PDF/X-1a・PDF/X-3 の決まりに合うかを調べる (自前のプリフライト)。
 *
 * PDF/X-1a (ISO 15930-1:2001・ISO 15930-4:2003)・PDF/X-3 (ISO 15930-6:2003) の本文は有料で手元に無いので、調べる決まりは公開の説明による。
 * 調べるもの:
 *  - 版 (ファイルの頭が PDF 1.3 (X-1a:2001)・1.4 (X-1a:2003・X-3:2003) 以下)、暗号化しない
 *  - 印: Info の GTS_PDFXVersion (X-1a:2001 は GTS_PDFXConformance も)・Title・CreationDate・ModDate・Trapped (True か False)、
 *    trailer の ID、カタログの OutputIntents (S が GTS_PDFX、OutputConditionIdentifier がある)
 *  - ページ: TrimBox か ArtBox のどちらか一方 (両方は不可)、BleedBox・TrimBox が MediaBox の中
 *  - 色: CMYK・灰色・特色 (Separation・DeviceN。代わりの色空間も同じ) だけ。DeviceRGB・CalRGB・CalGray・Lab・ICCBased を
 *    色空間の名前として使わない。内容の流れで rg・RG (DeviceRGB の色の命令) を使わない。注釈の色 (C) に RGB を使わない。
 *    X-3 は、機器によらない色 (ICCBased・Lab・CalRGB・CalGray) を使える (ほかは X-1a と同じ。公開の説明による)
 *  - 透明を使わない: ExtGState の ca・CA が 1 未満・SMask が None でない・BM が Normal (Compatible) でない、画像の SMask・SMaskInData、
 *    透明のグループ (Group の S が Transparency)
 *  - 書体: Type3 のほかは埋め込む (FontFile・FontFile2・FontFile3)。FontFile3 の OpenType (PDF 1.6) は使わない
 *  - 注釈: 塗り足しまでの範囲 (BleedBox) に掛かるもの (TrapNet・PrinterMark のほか) を置かない
 * 合わないものを、利用者に見せる文の並びにして返す (空なら合う)。
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFParser, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib';
import { msg } from './messages';

/** PDF/X-1a で使えない色空間の名前 (内容の流れの中の略記 RGB も) */
const FORBIDDEN_SPACES_X1A = new Set(['DeviceRGB', 'CalRGB', 'CalGray', 'Lab', 'ICCBased', 'RGB']);
/** PDF/X-3 で使えない色空間の名前 (X-1a から、機器によらない色 ICCBased・Lab・CalRGB・CalGray を外したもの) */
const FORBIDDEN_SPACES_X3 = new Set(['DeviceRGB', 'RGB']);

/**
 * PDF を読む (PDFDocument.load と同じ: 1 度に 100 個ずつのオブジェクト、暗号化を気にせず、メタデータを書き換えない)。
 * pdf-lib の読み込みは、流れ (画像・書体・ページの命令) の中身を、読んだバイト列から写す (ByteStream の slice) ので、画像の多い PDF では、
 * 出力の大きさの分だけ、検査のあいだのメモリが増える。検査は読むだけで、bytes も検査の間は変えないので、写さずに bytes の部分の見方
 * (subarray) にする (この読み込みの ByteStream だけを差し替える。オブジェクトストリームの中身は、展開した写しのまま)
 */
async function loadWithoutCopy(bytes: Uint8Array): Promise<PDFDocument> {
  const parser = PDFParser.forBytesWithOptions(bytes, 100);
  const stream = (parser as unknown as { bytes?: { slice?: (start: number, end: number) => Uint8Array } }).bytes;
  if (stream && typeof stream.slice === 'function') stream.slice = (start: number, end: number) => bytes.subarray(start, end);
  const context = await parser.parseDocument();
  // PDFDocument.load と同じに、読んだ文脈から文書を作る (作り方の関数は公開されていない)
  const Doc = PDFDocument as unknown as new (context: unknown, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  return new Doc(context, true, false);
}

/** 書き出した PDF/X-1a の PDF を調べる。version は 'X-1a:2001' か 'X-1a:2003' */
export function verifyPdfX1a(bytes: Uint8Array, version: 'X-1a:2001' | 'X-1a:2003'): Promise<string[]> {
  return verifyPdfX(bytes, version);
}

/** 書き出した PDF/X-3:2003 の PDF を調べる */
export function verifyPdfX3(bytes: Uint8Array): Promise<string[]> {
  return verifyPdfX(bytes, 'X-3:2003');
}

/** 書き出した PDF/X-1a・PDF/X-3 の PDF を調べる (ファイルの冒頭の説明) */
async function verifyPdfX(bytes: Uint8Array, version: 'X-1a:2001' | 'X-1a:2003' | 'X-3:2003'): Promise<string[]> {
  const out = new Set<string>();
  const add = (ja: string, en: string) => out.add(msg(ja, en));
  const maxVersion = version === 'X-1a:2001' ? 1.3 : 1.4;
  const FORBIDDEN_SPACES = version === 'X-3:2003' ? FORBIDDEN_SPACES_X3 : FORBIDDEN_SPACES_X1A;
  const head = /^%PDF-(\d\.\d)/.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 16)));
  if (!head || Number(head[1]) > maxVersion) add(`PDF の版が ${head?.[1] ?? '不明'} です (${maxVersion} 以下にします)`, `the PDF version is ${head?.[1] ?? 'unknown'} (must be ${maxVersion} or lower)`);
  const pdf = await loadWithoutCopy(bytes);
  const ctx = pdf.context;
  if (ctx.trailerInfo.Encrypt) add('暗号化しています', 'the file is encrypted');
  if (!ctx.trailerInfo.ID) add('文書の ID (trailer の ID) がありません', 'the document ID (trailer ID) is missing');

  // 印 (Info・OutputIntents)
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict);
  const infoText = (key: string) => {
    const v = info?.lookup(PDFName.of(key));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  const expected = version === 'X-1a:2001' ? 'PDF/X-1:2001' : version === 'X-1a:2003' ? 'PDF/X-1a:2003' : 'PDF/X-3:2003';
  if (infoText('GTS_PDFXVersion') !== expected) add(`Info の GTS_PDFXVersion が ${expected} ではありません`, `GTS_PDFXVersion in Info is not ${expected}`);
  if (version === 'X-1a:2001' && infoText('GTS_PDFXConformance') !== 'PDF/X-1a:2001') add('Info の GTS_PDFXConformance が PDF/X-1a:2001 ではありません', 'GTS_PDFXConformance in Info is not PDF/X-1a:2001');
  for (const key of ['Title', 'CreationDate', 'ModDate']) if (!infoText(key)) add(`Info の ${key} がありません`, `${key} is missing from Info`);
  const trapped = info?.lookup(PDFName.of('Trapped'));
  if (!(trapped instanceof PDFName) || !['/True', '/False'].includes(trapped.asString())) add('Info の Trapped が True か False ではありません', 'Trapped in Info is not True or False');
  const intents = pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
  const intent = intents
    ?.asArray()
    .map((r) => ctx.lookup(r))
    .find((d): d is PDFDict => d instanceof PDFDict && String(d.get(PDFName.of('S'))) === '/GTS_PDFX');
  if (!intent || !intent.get(PDFName.of('OutputConditionIdentifier'))) add('出力意図 (OutputIntents の GTS_PDFX と OutputConditionIdentifier) がありません', 'the output intent (GTS_PDFX with OutputConditionIdentifier in OutputIntents) is missing');

  // ページの範囲と注釈
  pdf.getPages().forEach((page, k) => {
    const node = page.node;
    const n = k + 1;
    const hasTrim = !!node.get(PDFName.of('TrimBox'));
    const hasArt = !!node.get(PDFName.of('ArtBox'));
    if (hasTrim === hasArt) add(`${n} ページ目: TrimBox か ArtBox のどちらか一方が要ります`, `page ${n}: exactly one of TrimBox and ArtBox is required`);
    const media = page.getMediaBox();
    const inside = (b: { x: number; y: number; width: number; height: number }) =>
      b.x >= media.x - 0.01 && b.y >= media.y - 0.01 && b.x + b.width <= media.x + media.width + 0.01 && b.y + b.height <= media.y + media.height + 0.01;
    if (!inside(page.getBleedBox()) || !inside(page.getTrimBox())) add(`${n} ページ目: BleedBox・TrimBox が MediaBox からはみ出しています`, `page ${n}: BleedBox or TrimBox extends beyond MediaBox`);
    const bleed = page.getBleedBox();
    for (const ref of node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []) {
      const an = ctx.lookup(ref);
      if (!(an instanceof PDFDict)) continue;
      const subtype = String(an.get(PDFName.of('Subtype')));
      const rect = an.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
      if (rect && subtype !== '/TrapNet' && subtype !== '/PrinterMark') {
        const hits = Math.min(rect[0], rect[2]) < bleed.x + bleed.width && Math.max(rect[0], rect[2]) > bleed.x && Math.min(rect[1], rect[3]) < bleed.y + bleed.height && Math.max(rect[1], rect[3]) > bleed.y;
        if (hits) add(`${n} ページ目: 塗り足しまでの範囲に注釈 (${subtype.slice(1)}) があります`, `page ${n}: an annotation (${subtype.slice(1)}) lies within the bleed area`);
      }
      if ((an.lookupMaybe(PDFName.of('C'), PDFArray)?.size() ?? 0) === 3) add(`${n} ページ目: 注釈の色が RGB です`, `page ${n}: an annotation color is RGB`);
    }
  });

  // 出力意図の辞書 (ICC プロファイル) の中は、色空間の名前を調べない
  const skip = new Set<PDFObject>();
  if (intent) {
    skip.add(intent);
    const prof = intent.get(PDFName.of('DestOutputProfile'));
    if (prof instanceof PDFRef) skip.add(ctx.lookup(prof)!);
  }

  /** 辞書・配列の中の名前を調べる (間接参照はたどらない。間接の物は外の繰り返しで 1 度ずつ調べる) */
  const scanValue = (v: PDFObject | undefined, path: string): void => {
    if (!v || skip.has(v)) return;
    if (v instanceof PDFName) {
      const name = v.asString().slice(1);
      if (FORBIDDEN_SPACES.has(name) && name !== 'RGB') add(`使えない色空間 ${name} を使っています (${path})`, `uses the color space ${name}, which is not allowed (${path})`);
      return;
    }
    if (v instanceof PDFArray) {
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
    // 透明
    const ca = num(d, 'ca');
    const CA = num(d, 'CA');
    if ((ca !== undefined && ca < 1) || (CA !== undefined && CA < 1)) add('透明 (不透明度) を使っています', 'uses transparency (opacity)');
    const smask = d.get(PDFName.of('SMask'));
    if (smask && !(smask instanceof PDFName && smask.asString() === '/None')) add('透明 (ソフトマスク・画像の透明度) を使っています', 'uses transparency (soft mask or image transparency)');
    const bm = d.get(PDFName.of('BM'));
    if (bm && !(bm instanceof PDFName && ['/Normal', '/Compatible'].includes(bm.asString()))) add('透明 (描画モード) を使っています', 'uses transparency (blend mode)');
    if ((num(d, 'SMaskInData') ?? 0) > 0) add('透明 (画像の透明度) を使っています', 'uses transparency (image transparency)');
    const group = d.lookup(PDFName.of('Group'));
    if (group instanceof PDFDict && String(group.get(PDFName.of('S'))) === '/Transparency') add('透明のグループを使っています', 'uses a transparency group');
    // 書体
    if (String(d.get(PDFName.of('Type'))) === '/Font') checkFont(d);
    if (String(d.get(PDFName.of('Subtype'))) === '/OpenType' && maxVersion < 1.6) add('書体を OpenType のまま埋め込んでいます (PDF 1.6 の機能)', 'embeds a font as OpenType (a PDF 1.6 feature)');
    for (const [key, value] of d.entries()) {
      // 名前 (/Name など) や書体の名前の値は、色空間ではない
      if (['Type', 'Subtype', 'BaseFont', 'FontName', 'Name', 'S', 'Filter'].includes(key.asString().slice(1))) continue;
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

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (skip.has(obj)) continue;
    const where = `${ref.objectNumber} 0 obj`;
    if (obj instanceof PDFRawStream) {
      scanDict(obj.dict, where);
      // 内容の流れ (ページ・Form XObject・模様・Type3 の字形): DeviceRGB の色の命令と、色空間の名前
      const d = obj.dict;
      const subtype = String(d.get(PDFName.of('Subtype')));
      const isContent = !d.get(PDFName.of('Length1')) && !d.get(PDFName.of('Length2')) && !d.get(PDFName.of('N')) && !['/Image', '/XML', '/Type1C', '/CIDFontType0C', '/OpenType'].includes(subtype) && String(d.get(PDFName.of('Type'))) !== '/EmbeddedFile' && String(d.get(PDFName.of('Type'))) !== '/Metadata';
      if (!isContent) continue;
      let text: string;
      try {
        text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        continue;
      }
      // 字の符号 (<…>・(…)) を除いてから、命令を探す
      const ops = text.replace(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)/g, ' ');
      if (/(^|\s)(rg|RG)(?=\s|$)/.test(ops)) add(`RGB の色 (rg・RG) を使っています (${where})`, `uses RGB colors (rg/RG) (${where})`);
      for (const m of ops.matchAll(/\/(DeviceRGB|RGB|CalRGB|CalGray|Lab|ICCBased)(?![\w#.+-])/g)) if (FORBIDDEN_SPACES.has(m[1])) add(`使えない色空間 ${m[1]} を使っています (${where})`, `uses the color space ${m[1]}, which is not allowed (${where})`);
    } else scanValue(obj, where);
  }
  return [...out];
}
