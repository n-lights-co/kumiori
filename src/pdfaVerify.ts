/**
 * pdfaVerify — 書き出した PDF そのものを読み直して、PDF/A-2b・PDF/A-3b (ISO 19005-2・-3 の b の水準) の決まりに合うかを調べる (自前のプリフライト)。
 *
 * ISO 19005 の本文は有料で手元に無いので、調べる決まりは、規格の目次の節の番号と、公開の説明 (veraPDF の検査の規則の一覧など) による。
 * 規格への適合は保証しない (PDF/A の検査の道具 (veraPDF など) で確かめること)。調べるもの:
 *  - ファイルの構造 (§6.1): 頭が %PDF-1.0〜1.7 で、次の行が 128 以上のバイトを 4 つ持つ注釈 (§6.1.2)、trailer の ID があり、暗号化しない (§6.1.3)、
 *    実装の限界 (§6.1.13: 名前は 127 バイトまで、文字列は 32767 バイトまで、q と Q の入れ子は 28 段まで)
 *  - 出力意図 (§6.2.3): S が GTS_PDFA1 のものが DestOutputProfile (ICC の版 4 まで、機器の種類が prtr か mntr、色空間 RGB・CMYK・GRAY) を持つ。
 *    出力意図が 2 つ以上なら、DestOutputProfile は同じ間接オブジェクト
 *  - 色 (§6.2.4.3): 機器による色空間は、出力意図の色空間と同じものだけ (RGB の出力意図なら DeviceCMYK と内容の流れの k・K を、
 *    CMYK の出力意図なら DeviceRGB と rg・RG を使わない。DeviceGray は使える)。特色・DeviceN の代わりの色空間も同じ (§6.2.4.4)
 *  - 描画の状態 (§6.2.5): TR を使わない、TR2 は Default だけ、HTO を使わない。描画モード (BM) は ISO 32000-1 の決めた名前だけ (§6.2.10)。
 *    描き方の意図 (RI・ri・画像の Intent) は 4 つの名前だけ (§6.2.6)
 *  - 画像と XObject (§6.2.8・§6.2.9): Interpolate を true にしない、Alternates・OPI を使わない、PostScript の XObject・参照の XObject (Ref) を使わない
 *  - 書体 (§6.2.11.4.1): Type3 のほかは埋め込む。TrueType の書体のファイル (FontFile2) は Length1 を持つ (ISO 32000-1 §9.9 Table 127)
 *  - 注釈 (§6.3): 使えない種類 (3D・Sound・Screen・Movie など) を使わない、Popup のほかは F を持ち、印刷の印 (Print) があり、
 *    隠す印 (Invisible・Hidden・NoView・ToggleNoView) が無い (§6.3.2)。Popup・Link と大きさ 0 のもののほかは外観 (AP) を持ち、外観の辞書は N だけ (§6.3.3)
 *  - フォーム (§6.4): NeedAppearances を true にしない、XFA を使わない
 *  - 動作 (§6.5): Launch・Sound・Movie・ResetForm・ImportData・JavaScript・Hide・SetOCGState・Rendition・Trans・GoTo3DView を使わない。
 *    名前の動作 (Named) は NextPage・PrevPage・FirstPage・LastPage だけ。AA (追加の動作) を使わない
 *  - メタデータ (§6.6): カタログの Metadata (XMP) があり、pdfaid:part・pdfaid:conformance が版と水準に合い (§6.6.4)、Info の項目と XMP の値が同じ (§6.6.3)。
 *    定義済みでない属性 (Kumiori が書く pdfxid:GTS_PDFXVersion・pdf:Trapped) は、拡張のスキーマで定義する (§6.6.2.3.1)
 *  - 埋め込みのファイル (§6.8): PDF/A-2 では使わない (埋め込んでよいのは PDF/A のファイルだけだが、それを確かめないため)。
 *    PDF/A-3 では、ファイル指定の辞書が F・UF・AFRelationship を持ち、カタログの AF から指され、埋め込みのファイルの流れが Subtype (MIME の型) と
 *    Params の ModDate を持つ
 * 合わないものを、利用者に見せる文の並びにして返す (空なら合う)。
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, PDFBool, decodePDFRawStream, type PDFObject } from 'pdf-lib';
import { msg } from './messages';
import { contentStreams } from './pdfContentStreams';
import { loadWithoutCopy, pdfDate } from './pdfxVerify';

/** 使えない動作 (ISO 19005-2 §6.5.1) */
const FORBIDDEN_ACTIONS = new Set(['Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'JavaScript', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView']);
/** 使える名前の動作 (§6.5.1) */
const NAMED_ACTIONS = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']);
/** 使えない注釈の種類 (§6.3.1) */
const FORBIDDEN_ANNOTS = new Set(['3D', 'Sound', 'Screen', 'Movie', 'RichMedia']);
/** 描画モードの名前 (ISO 32000-1 §11.3.5 の Table 136・137。§6.2.10) */
const BLEND_MODES = new Set(['Normal', 'Compatible', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge', 'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity']);
/** 描き方の意図の名前 (ISO 32000-1 §8.6.5.8。§6.2.6) */
const INTENTS = new Set(['RelativeColorimetric', 'AbsoluteColorimetric', 'Perceptual', 'Saturation']);

/** 書き出した PDF/A-2b・3b の PDF を調べる。part は ISO 19005 の部の番号 (2 か 3) */
export async function verifyPdfA(bytes: Uint8Array, part: 2 | 3): Promise<string[]> {
  const out = new Set<string>();
  const add = (ja: string, en: string) => out.add(msg(ja, en));
  // ファイルの頭 (§6.1.2): %PDF-1.n (n は 0〜7) と、次の行の % と 128 以上のバイト 4 つ
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
  const m = /^%PDF-1\.([0-7])(\r\n|\r|\n)%([\s\S]{4})/.exec(head);
  if (!m || [...m[3]].some((c) => c.charCodeAt(0) < 128)) add('ファイルの頭 (%PDF-1.0〜1.7 と、次の行の 128 以上のバイト 4 つの注釈) が決まりに合いません', 'the file header (%PDF-1.0 to 1.7, then a comment line with four bytes of 128 or more) does not meet the requirements');
  const pdf = await loadWithoutCopy(bytes);
  const ctx = pdf.context;
  if (ctx.trailerInfo.Encrypt) add('暗号化しています', 'the file is encrypted');
  if (!ctx.trailerInfo.ID) add('文書の ID (trailer の ID) がありません', 'the document ID (trailer ID) is missing');

  // 出力意図 (§6.2.3)
  const intents = (pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)?.asArray() ?? []).map((r) => ctx.lookup(r)).filter((d): d is PDFDict => d instanceof PDFDict);
  const profiles = new Set(intents.map((d) => d.get(PDFName.of('DestOutputProfile'))).filter((r) => r));
  if (profiles.size > 1) add('出力意図が 2 つ以上あり、DestOutputProfile が同じものではありません', 'there are two or more output intents whose DestOutputProfile is not the same object');
  const pdfaIntent = intents.find((d) => String(d.get(PDFName.of('S'))) === '/GTS_PDFA1');
  const profile = pdfaIntent?.lookup(PDFName.of('DestOutputProfile'));
  let space: string | undefined;
  if (!(profile instanceof PDFRawStream)) add('PDF/A の出力意図 (OutputIntents の GTS_PDFA1 と DestOutputProfile) がありません', 'the PDF/A output intent (GTS_PDFA1 with DestOutputProfile in OutputIntents) is missing');
  else {
    const p = decodePDFRawStream(profile).decode();
    const sig = (o: number) => (p.length >= o + 4 ? String.fromCharCode(...p.subarray(o, o + 4)) : '');
    space = sig(16).trim();
    if (p.length < 128 || p[8] > 4 || !['mntr', 'prtr'].includes(sig(12)) || !['RGB', 'CMYK', 'GRAY'].includes(space) || sig(36) !== 'acsp')
      add('出力意図の ICC プロファイルが決まりに合いません (ICC の版 4 まで、機器の種類 prtr か mntr、色空間 RGB・CMYK・GRAY)', 'the ICC profile of the output intent does not meet the requirements (ICC version 4 or lower, device class prtr or mntr, color space RGB, CMYK or GRAY)');
    const n = profile.dict.get(PDFName.of('N'));
    if (!(n instanceof PDFNumber) || n.asNumber() !== (space === 'CMYK' ? 4 : space === 'GRAY' ? 1 : 3)) add('出力意図の ICC プロファイルの流れの N が、プロファイルの色の数と違います', 'N of the output intent ICC profile stream does not match the number of color components of the profile');
  }
  /** 使えない機器による色空間 (出力意図の色空間と違うもの。§6.2.4.3) */
  const forbiddenDevice = space === 'RGB' ? 'DeviceCMYK' : space === 'CMYK' ? 'DeviceRGB' : space === 'GRAY' ? 'DeviceRGB|DeviceCMYK' : undefined;
  const forbiddenDeviceSet = new Set(forbiddenDevice?.split('|') ?? []);
  // 内容の流れの略記 (CMYK・RGB) と色の命令 (k・K・rg・RG)
  const forbiddenOps = space === 'RGB' ? ['k', 'K'] : space === 'CMYK' ? ['rg', 'RG'] : space === 'GRAY' ? ['k', 'K', 'rg', 'RG'] : [];

  // メタデータ (§6.6)
  const meta = pdf.catalog.lookup(PDFName.of('Metadata'));
  let xmp = '';
  if (!(meta instanceof PDFRawStream)) add('カタログに XMP のメタデータ (Metadata) がありません', 'the catalog has no XMP metadata (Metadata)');
  else {
    if (meta.dict.get(PDFName.of('Filter'))) add('XMP のメタデータの流れを圧縮しています', 'the XMP metadata stream is compressed');
    xmp = new TextDecoder().decode(decodePDFRawStream(meta).decode());
  }
  const xmpValue = (re: RegExp) => {
    const v = re.exec(xmp)?.[1];
    return v === undefined ? undefined : v.replace(/&#x([0-9a-f]+);|&(lt|gt|amp|quot|apos);/gi, (_, h, n) => (h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n]));
  };
  if (meta instanceof PDFRawStream) {
    // 定義済みでない属性 (Kumiori が書くもの: pdfxid:GTS_PDFXVersion・pdf:Trapped) は、拡張のスキーマで定義する (§6.6.2.3.1)
    for (const [prop, ns, name] of [['pdfxid:GTS_PDFXVersion', 'http://www.npes.org/pdfx/ns/id/', 'GTS_PDFXVersion'], ['pdf:Trapped', 'http://ns.adobe.com/pdf/1.3/', 'Trapped']] as const) {
      if (!xmp.includes(`<${prop}>`)) continue;
      const schemas = xmp.split('<pdfaSchema:namespaceURI>').slice(1);
      if (!schemas.some((x) => x.startsWith(`${ns}<`) && x.includes(`<pdfaProperty:name>${name}</pdfaProperty:name>`)))
        add(`XMP の ${prop} が、拡張のスキーマで定義されていません`, `${prop} in XMP is not defined in an extension schema`);
    }
    if (xmpValue(/<pdfaid:part>([^<]*)<\/pdfaid:part>/) !== String(part)) add(`XMP の pdfaid:part が ${part} ではありません`, `pdfaid:part in XMP is not ${part}`);
    if (xmpValue(/<pdfaid:conformance>([^<]*)<\/pdfaid:conformance>/) !== 'B') add('XMP の pdfaid:conformance が B ではありません', 'pdfaid:conformance in XMP is not B');
  }
  // Info と XMP の一致 (§6.6.3)
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict);
  const infoText = (key: string) => {
    const v = info?.lookup(PDFName.of(key));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  };
  const pairs: Array<[string, RegExp]> = [
    ['Title', /<dc:title><rdf:Alt><rdf:li xml:lang="x-default">([^<]*)</],
    ['Author', /<dc:creator><rdf:Seq><rdf:li>([^<]*)</],
    ['Subject', /<dc:description><rdf:Alt><rdf:li xml:lang="x-default">([^<]*)</],
    ['Keywords', /<pdf:Keywords>([^<]*)</],
    ['Creator', /<xmp:CreatorTool>([^<]*)</],
    ['Producer', /<pdf:Producer>([^<]*)</],
  ];
  for (const [key, re] of pairs) {
    const a = infoText(key);
    if (a !== undefined && a !== xmpValue(re)) add(`Info の ${key} と XMP の値が違います`, `${key} in Info differs from XMP`);
  }
  for (const [key, re] of [['CreationDate', /<xmp:CreateDate>([^<]*)</], ['ModDate', /<xmp:ModifyDate>([^<]*)</]] as const) {
    const a = infoText(key);
    if (a === undefined) continue;
    const t = pdfDate(a);
    const x = xmpValue(re);
    if (t === undefined || x === undefined || Date.parse(x) !== t) add(`Info の ${key} と XMP の日付が違います`, `${key} in Info differs from the XMP date`);
  }

  // カタログ (§6.4・§6.5・§6.8)
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.get(PDFName.of('JavaScript'))) add('JavaScript があります', 'contains JavaScript');
  const form = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (form) {
    const na = form.lookup(PDFName.of('NeedAppearances'));
    if (na instanceof PDFBool && na.asBoolean()) add('フォームの NeedAppearances が true です', 'NeedAppearances of the form is true');
    if (form.get(PDFName.of('XFA'))) add('フォームに XFA があります', 'the form contains XFA');
  }
  const needsRendering = pdf.catalog.lookup(PDFName.of('NeedsRendering'));
  if (needsRendering instanceof PDFBool && needsRendering.asBoolean()) add('カタログの NeedsRendering が true です', 'NeedsRendering in the catalog is true');
  const af = new Set((pdf.catalog.lookupMaybe(PDFName.of('AF'), PDFArray)?.asArray() ?? []).filter((r): r is PDFRef => r instanceof PDFRef).map((r) => r.toString()));

  // ページと注釈 (§6.3)
  pdf.getPages().forEach((page, k) => {
    const n = k + 1;
    const media = page.getMediaBox();
    if (media.width < 3 || media.height < 3 || media.width > 14400 || media.height > 14400) add(`${n} ページ目: ページの大きさが 3〜14400 の範囲にありません`, `page ${n}: the page size is not within 3 to 14400 units`);
    for (const ref of page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []) {
      const an = ctx.lookup(ref);
      if (!(an instanceof PDFDict)) continue;
      const subtype = String(an.get(PDFName.of('Subtype'))).slice(1);
      if (FORBIDDEN_ANNOTS.has(subtype)) add(`${n} ページ目: 使えない種類の注釈 (${subtype}) があります`, `page ${n}: an annotation of a type that is not allowed (${subtype})`);
      if (subtype === 'Popup') continue;
      const f = an.get(PDFName.of('F'));
      const flags = f instanceof PDFNumber ? f.asNumber() : 0;
      // 注釈のフラグ (ISO 32000-1 §12.5.3 Table 165): 1 Invisible、2 Hidden、3 Print、6 NoView、9 ToggleNoView
      if (!(flags & 4) || flags & (1 | 2 | 32 | 256)) add(`${n} ページ目: 注釈 (${subtype}) に印刷の印が無いか、隠す印があります`, `page ${n}: an annotation (${subtype}) lacks the Print flag or has a hiding flag`);
      const rect = an.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) ?? [0, 0, 0, 0];
      const empty = rect[0] === rect[2] || rect[1] === rect[3];
      const ap = an.lookupMaybe(PDFName.of('AP'), PDFDict);
      if (!ap && subtype !== 'Link' && !empty) add(`${n} ページ目: 注釈 (${subtype}) に外観 (AP) がありません`, `page ${n}: an annotation (${subtype}) has no appearance (AP)`);
      if (ap && ap.keys().some((key) => key.asString() !== '/N')) add(`${n} ページ目: 注釈 (${subtype}) の外観の辞書に N のほかの項目があります`, `page ${n}: the appearance dictionary of an annotation (${subtype}) has entries other than N`);
      if (subtype === 'Widget' && an.get(PDFName.of('A'))) add(`${n} ページ目: フォームの欄に動作 (A) があります`, `page ${n}: a form field widget has an action (A)`);
    }
  });

  // 間接の物を 1 つずつ調べる
  const skip = new Set<PDFObject>();
  if (profile) skip.add(profile);
  if (meta) skip.add(meta);
  /** 辞書・配列の中の値を調べる (間接参照はたどらない。間接の物は外の繰り返しで 1 度ずつ調べる) */
  const scanValue = (v: PDFObject | undefined, path: string, key?: string): void => {
    if (!v || skip.has(v)) return;
    if (v instanceof PDFName) {
      const name = v.asString().slice(1);
      if (decodedLength(v) > 127) add(`127 バイトを超える名前があります (${path})`, `a name longer than 127 bytes (${path})`);
      if (key !== 'BaseFont' && key !== 'FontName' && forbiddenDeviceSet.has(name)) add(`出力意図の色空間 (${space}) と違う、機器による色空間 ${name} を使っています (${path})`, `uses the device color space ${name}, which differs from the output intent color space (${space}) (${path})`);
      return;
    }
    if (v instanceof PDFString || v instanceof PDFHexString) {
      if (v.asBytes().length > 32767) add(`32767 バイトを超える文字列があります (${path})`, `a string longer than 32767 bytes (${path})`);
      return;
    }
    if (v instanceof PDFArray) {
      v.asArray().forEach((x) => scanValue(x, path));
      return;
    }
    if (v instanceof PDFDict) scanDict(v, path);
  };
  const nameOf = (d: PDFDict, key: string) => {
    const x = d.get(PDFName.of(key));
    return x instanceof PDFName ? x.asString().slice(1) : undefined;
  };
  const scanDict = (d: PDFDict, path: string): void => {
    if (skip.has(d)) return;
    const type = nameOf(d, 'Type');
    const subtype = nameOf(d, 'Subtype');
    // 動作 (§6.5)
    if (d.get(PDFName.of('AA'))) add(`追加の動作 (AA) があります (${path})`, `contains additional actions (AA) (${path})`);
    // 構造の節 (Type StructElem) の S は構造の型で、動作の種類ではない (ISO 32000-1 §14.7.2 の Table 323。role="JavaScript" の独自の型など)
    const s = type === 'StructElem' ? undefined : nameOf(d, 'S');
    if (s && FORBIDDEN_ACTIONS.has(s)) add(`使えない動作 (${s}) があります (${path})`, `contains an action that is not allowed (${s}) (${path})`);
    if (s === 'Named' && !NAMED_ACTIONS.has(nameOf(d, 'N') ?? '')) add(`使えない名前の動作 (${nameOf(d, 'N')}) があります (${path})`, `contains a named action that is not allowed (${nameOf(d, 'N')}) (${path})`);
    // 描画の状態 (§6.2.5)。ソフトマスクの辞書 (G を持つ) の TR は、描画の状態の TR ではない
    if (d.get(PDFName.of('TR')) && !d.get(PDFName.of('G'))) add(`描画の状態に TR (転送の関数) があります (${path})`, `the graphics state has TR (transfer function) (${path})`);
    const tr2 = d.get(PDFName.of('TR2'));
    if (tr2 && !(tr2 instanceof PDFName && tr2.asString() === '/Default')) add(`描画の状態の TR2 が Default ではありません (${path})`, `TR2 of the graphics state is not Default (${path})`);
    if (d.get(PDFName.of('HTO'))) add(`描画の状態に HTO があります (${path})`, `the graphics state has HTO (${path})`);
    const bm = d.get(PDFName.of('BM'));
    for (const b of bm instanceof PDFArray ? bm.asArray() : bm ? [bm] : []) if (!(b instanceof PDFName && BLEND_MODES.has(b.asString().slice(1)))) add(`決まりに無い描画モード (BM) があります (${path})`, `contains a blend mode (BM) that is not defined (${path})`);
    for (const key of ['RI', 'Intent']) {
      const ri = nameOf(d, key);
      if (ri && !INTENTS.has(ri)) add(`決まりに無い描き方の意図 (${ri}) があります (${path})`, `contains a rendering intent that is not defined (${ri}) (${path})`);
    }
    // 画像と XObject (§6.2.8・§6.2.9)
    if (subtype === 'Image' || subtype === 'Form' || subtype === 'PS') {
      const interp = d.lookup(PDFName.of('Interpolate'));
      if (interp instanceof PDFBool && interp.asBoolean()) add(`画像の Interpolate が true です (${path})`, `Interpolate of an image is true (${path})`);
      if (d.get(PDFName.of('Alternates'))) add(`画像に Alternates があります (${path})`, `an image has Alternates (${path})`);
      if (d.get(PDFName.of('OPI'))) add(`OPI があります (${path})`, `contains OPI (${path})`);
      if (subtype === 'PS' || nameOf(d, 'Subtype2') === 'PS' || (subtype === 'Form' && d.get(PDFName.of('PS')))) add(`PostScript の XObject があります (${path})`, `contains a PostScript XObject (${path})`);
      if (subtype === 'Form' && d.get(PDFName.of('Ref'))) add(`参照の XObject (Ref) があります (${path})`, `contains a reference XObject (Ref) (${path})`);
    }
    // 書体 (§6.2.11.4.1)。TrueType の書体のファイルは、展開した長さ (Length1) を持つ (ISO 32000-1 §9.9 Table 127)
    if (type === 'Font') checkFont(d, path);
    if (type === 'FontDescriptor') {
      const ff2 = d.lookup(PDFName.of('FontFile2'));
      if (ff2 instanceof PDFRawStream && !ff2.dict.get(PDFName.of('Length1'))) add(`TrueType の書体のファイルに Length1 がありません (${path})`, `a TrueType font file lacks Length1 (${path})`);
    }
    // 埋め込みのファイル (§6.8)
    if (d.get(PDFName.of('EF'))) checkFileSpec(d, path);
    for (const [key, value] of d.entries()) {
      const k = key.asString().slice(1);
      if (decodedLength(key) > 127) add(`127 バイトを超える名前があります (${path})`, `a name longer than 127 bytes (${path})`);
      // 名前 (/Name など) や書体の名前の値は、色空間ではない
      if (['Type', 'Subtype', 'Name', 'S', 'Filter', 'N'].includes(k)) continue;
      scanValue(value, `${path}/${k}`, k);
    }
  };
  const embeddedFile = (desc: PDFDict | undefined) => !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(PDFName.of(k)));
  const checkFont = (font: PDFDict, path: string) => {
    const subtype = String(font.get(PDFName.of('Subtype')));
    if (subtype === '/Type3') return;
    const name = String(font.get(PDFName.of('BaseFont')) ?? '').slice(1);
    if (subtype === '/Type0') {
      const desc = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0);
      if (desc instanceof PDFDict && !embeddedFile(desc.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict))) add(`書体 ${name} を埋め込んでいません (${path})`, `the font ${name} is not embedded (${path})`);
      return;
    }
    if (!embeddedFile(font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict))) add(`書体 ${name} を埋め込んでいません (${path})`, `the font ${name} is not embedded (${path})`);
  };
  /** 埋め込みのファイルのファイル指定 (ISO 32000-1 §7.11.3・§7.11.4) を調べる。ref はファイル指定の辞書の間接参照 (直に書いた辞書なら無い) */
  let fileSpecRef: PDFRef | undefined;
  const checkFileSpec = (spec: PDFDict, path: string) => {
    if (part === 2) {
      add(`埋め込みのファイルがあります (PDF/A-2 で埋め込めるのは PDF/A のファイルだけ。PDF/A-3 を使ってください) (${path})`, `contains an embedded file (PDF/A-2 allows only PDF/A files to be embedded; use PDF/A-3) (${path})`);
      return;
    }
    if (!spec.get(PDFName.of('F')) || !spec.get(PDFName.of('UF'))) add(`埋め込みのファイルの指定に F か UF がありません (${path})`, `the file specification of an embedded file lacks F or UF (${path})`);
    if (!spec.get(PDFName.of('AFRelationship'))) add(`埋め込みのファイルの指定に AFRelationship がありません (${path})`, `the file specification of an embedded file lacks AFRelationship (${path})`);
    if (!fileSpecRef || !af.has(fileSpecRef.toString())) add(`埋め込みのファイルの指定が、カタログの AF から指されていません (${path})`, `the file specification of an embedded file is not referenced from AF in the catalog (${path})`);
    const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'));
    if (ef instanceof PDFRawStream) {
      if (!ef.dict.get(PDFName.of('Subtype'))) add(`埋め込みのファイルに MIME の型 (Subtype) がありません (${path})`, `an embedded file lacks a MIME type (Subtype) (${path})`);
      if (!ef.dict.lookupMaybe(PDFName.of('Params'), PDFDict)?.get(PDFName.of('ModDate'))) add(`埋め込みのファイルに変えた日時 (Params の ModDate) がありません (${path})`, `an embedded file lacks a modification date (ModDate in Params) (${path})`);
    }
  };

  // 内容の流れ (ページ・Form XObject・模様・Type3 の字形・注釈の見え方) だけで命令を探す (書体のファイルなどの流れの、命令と同じ字を拾わない)
  const contents = contentStreams(pdf);

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (skip.has(obj)) continue;
    const where = `${ref.objectNumber} 0 obj`;
    fileSpecRef = ref;
    if (obj instanceof PDFRawStream) {
      scanDict(obj.dict, where);
      fileSpecRef = undefined;
      if (!contents.has(obj)) continue;
      let text: string;
      try {
        text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        continue;
      }
      // 字の符号 (<…>・(…)) を除いてから、命令を探す
      const ops = text.replace(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)/g, ' ');
      for (const op of forbiddenOps) if (new RegExp(`(^|\\s)${op}(?=\\s|$)`).test(ops)) add(`出力意図の色空間 (${space}) と違う、機器による色 (${op}) を使っています (${where})`, `uses device colors (${op}) that differ from the output intent color space (${space}) (${where})`);
      for (const mm of ops.matchAll(/\/(DeviceRGB|DeviceCMYK|RGB|CMYK)(?![\w#.+-])/g)) {
        const full = mm[1] === 'RGB' ? 'DeviceRGB' : mm[1] === 'CMYK' ? 'DeviceCMYK' : mm[1];
        if (forbiddenDeviceSet.has(full)) add(`出力意図の色空間 (${space}) と違う、機器による色空間 ${full} を使っています (${where})`, `uses the device color space ${full}, which differs from the output intent color space (${space}) (${where})`);
      }
      for (const mm of ops.matchAll(/\/([^\s/[\]()<>{}%]+)\s+ri(?=\s|$)/g)) if (!INTENTS.has(mm[1])) add(`決まりに無い描き方の意図 (${mm[1]}) があります (${where})`, `contains a rendering intent that is not defined (${mm[1]}) (${where})`);
      // q と Q の入れ子の深さ (§6.1.13: 28 段まで)
      let depth = 0;
      let max = 0;
      for (const t of ops.matchAll(/(?:^|\s)(q|Q)(?=\s|$)/g)) {
        depth += t[1] === 'q' ? 1 : -1;
        max = Math.max(max, depth);
      }
      if (max > 28) add(`描画の状態の入れ子 (q) が 28 段を超えています (${max} 段。${where})`, `graphics state nesting (q) exceeds 28 levels (${max} levels; ${where})`);
    } else {
      scanValue(obj, where);
      fileSpecRef = undefined;
    }
  }
  return [...out];
}

/** 名前を解いたバイトの長さ (#xx は 1 バイト。ISO 32000-1 §7.3.5) */
function decodedLength(n: PDFName): number {
  return n
    .asString()
    .slice(1)
    .replace(/#[0-9A-Fa-f]{2}/g, '_').length;
}
