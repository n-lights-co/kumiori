/**
 * pdfStandard — PDF の出力の規格 (入稿用の PDF/X-3・PDF/X-4) ごとの方針。
 *
 * 描く処理 (pdfRenderer.ts) は、規格の名前で分かれずに、ここの方針 (PdfStandard) の値を見る: 版とオブジェクトストリーム、RGB を CMYK に
 * するか、透明を警告するか、ArtBox を書くか、塗り足しまでの範囲 (ページの中) の注釈・フォームを外すか、必須の条件 (check)、印とメタデータ (mark)。
 * 規格を足すときは、ここに定義を 1 つ足す。外から足せるプラグインにはしない (方針の値は描く処理の内部と結び付いていて、
 * 規格への適合の責任も Kumiori の側にあるため)。
 *
 * 根拠: 出力意図の辞書は ISO 32000-2 §14.11.5 (Table 401)、XMP のメタデータは §14.3.2、文書の ID は §14.4、ページの範囲は §14.11.2。
 * PDF/X の規格 (ISO 15930-6・-7) の本文では確かめていない (版の印・ボックス・注釈・題の決まりは、公開の説明による) ので、
 * 規格への適合は保証しない。
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { GWG_SHEET_CMYK, type GwgVariant } from './pdfCheck';
import { msg } from './messages';

/** 入稿用 (PDF/X) の出力の指定 (PdfRenderOptions.pdfx) */
export interface PdfXOptions {
  /** 版: 'X-3' (PDF/X-3:2003。既定) か 'X-4' (PDF/X-4) */
  version?: 'X-3' | 'X-4';
  /** 印刷条件の名前 (OutputConditionIdentifier。ICC の登録名など。既定 JC200103 = Japan Color 2001 Coated) */
  condition?: string;
  /** 印刷条件の説明 (OutputCondition・Info。無ければ condition) */
  info?: string;
  /** 出力の CMYK の ICC プロファイル (DestOutputProfile として埋め込む。RGB の色・画像はこの表で CMYK にする) */
  profile?: Uint8Array;
  /** 警告を足す配列 */
  warnings?: string[];
}

/** PDF の出力の規格の方針 */
export interface PdfStandard {
  /** 警告に書く名前 (「PDF/X-3 では透明を使えません」の PDF/X-3) */
  readonly label: string;
  /** 版の印 (GTS_PDFXVersion) の値 */
  readonly version: string;
  /** ファイルの頭 (%PDF-1.x。pdf-lib の書き出しは 1.7 固定なので、同じ長さで書き換える) */
  readonly header: string;
  /** オブジェクトストリーム (PDF 1.5 の機能) を使うか */
  readonly objectStreams: boolean;
  /**
   * RGB の色・画像を CMYK にして書くか。CMYK にするときは、灰色 (R = G = B) の塗りと線も、K だけの CMYK (0, 0, 0, 1 − 明るさ) にする
   * (GWG 2022-R1 の R0011・R0012: 小さい字・細い線を DeviceGray で塗らない。灰色の画像は DeviceGray のまま)
   */
  readonly cmyk: boolean;
  /**
   * K だけの黒 (K 100%) の小さい字と細い線にノセ (overprint。ExtGState の OP・op を true、OPM を 1) を付ける大きさの上限 (pt。実際の大きさ
   * = 字の大きさ・線の太さ × いまの変換の倍率)。字は text pt 未満、線と細い長方形 (罫線) は line pt 未満。無ければ付けない。
   * GWG 2022-R1 の R0009・R0010 (SheetCMYK などの用途の値 12pt・2pt)。R0009 などは下に見える物と重なるときの決まりだが、
   * 何も無い所でのノセは見た目を変えないので、重なりを調べずに付ける。白 (R0007・R0008) と、不透明度の掛かった塗りには付けない
   * 付けるのは本文 (ページの余白も) の字・線・罫線だけで、図 (SVG・EPS など、SVG にして描く画像) の中の字・線には付けない (pdfRenderer.ts の overprintOps を呼ぶ所)
   */
  readonly blackOverprint?: { readonly text: number; readonly line: number };
  /** 透明 (不透明度・ソフトマスク・画像の透明度) を使ったとき: 'allow' はそのまま、'warn' は警告に書く (出力からは消さない) */
  readonly transparency: 'allow' | 'warn';
  /** ページに ArtBox を書くか (PDF/X は TrimBox と ArtBox の両方を書かない決まりがある、という公開の説明による) */
  readonly artBox: boolean;
  /** 塗り足しまでの範囲 (BleedBox。ページの絵柄の全体を囲む) に掛かる注釈・リンク・フォームの欄: 'keep' は書く、'drop' は書かずに警告に件数を書く */
  readonly marksInBleed: 'keep' | 'drop';
  /** XMP のメタデータを書くか (版の印を XMP にも書く) */
  readonly xmp: boolean;
  /** 書き出した後に調べる GWG 2022-R1 の用途と値 (pdfCheck.ts。合わないものを警告に書く)。無ければ調べない */
  readonly gwg?: GwgVariant;
  /** 書き出す前に確かめる必須の条件。満たさなければ誤りとして投げる */
  check(o: PdfXOptions): void;
}

/** PDF/X-3:2003 (ISO 15930-6。PDF 1.4 が元。透明は使えない) */
const PDF_X3: PdfStandard = {
  label: 'PDF/X-3',
  version: 'PDF/X-3:2003',
  header: '%PDF-1.4',
  objectStreams: false,
  cmyk: true,
  blackOverprint: { text: 12, line: 2 },
  transparency: 'warn',
  artBox: false,
  marksInBleed: 'drop',
  xmp: false,
  gwg: GWG_SHEET_CMYK,
  check: () => {},
};

/** PDF/X-4 (ISO 15930-7。PDF 1.6 が元。透明を使える。出力の ICC プロファイルの埋め込みが要る) */
const PDF_X4: PdfStandard = {
  label: 'PDF/X-4',
  version: 'PDF/X-4',
  header: '%PDF-1.6',
  objectStreams: true,
  cmyk: true,
  blackOverprint: { text: 12, line: 2 },
  transparency: 'allow',
  artBox: false,
  marksInBleed: 'drop',
  xmp: true,
  gwg: GWG_SHEET_CMYK,
  check: (o) => checkCmykProfile(o.profile),
};

/** PDF/X の指定の規格の方針。指定が無ければ undefined (ふつうの PDF) */
export function pdfStandardOf(o: PdfXOptions | undefined): PdfStandard | undefined {
  if (!o) return undefined;
  return o.version === 'X-4' ? PDF_X4 : PDF_X3;
}

/**
 * 出力の ICC プロファイルを確かめる: 埋め込みが要り (DestOutputProfile)、色空間は CMYK
 * (ICC.1:2010 §7.2.6 の頭の 16〜19 バイト目。GWG 2022-R1 の R0035)。満たさなければ誤りとして投げる
 */
function checkCmykProfile(profile: Uint8Array | undefined) {
  if (!profile) throw new Error(msg('PDF/X-4 では、出力の ICC プロファイル (CMYK) が要ります (pdfx.profile)。印刷所の指定するプロファイル (Japan Color 2001 Coated など) を渡してください', 'PDF/X-4 requires an output ICC profile (CMYK) (pdfx.profile). Pass the profile your printer specifies (such as Japan Color 2001 Coated)'));
  const space = profile.length >= 20 ? String.fromCharCode(...profile.subarray(16, 20)) : '';
  if (space !== 'CMYK') throw new Error(msg(`PDF/X-4 の出力の ICC プロファイルは、CMYK のものにしてください (渡されたプロファイルの色空間: ${space.trim() || '読めない'})`, `The output ICC profile for PDF/X-4 must be a CMYK profile (color space of the given profile: ${space.trim() || 'unreadable'})`));
}

/**
 * 字句の文字列 (literal string)。pdf-lib の PDFString.of は値をそのまま ( ) で囲むので、括弧と \ を逃がす (ISO 32000-2 §7.3.4.2)。
 * 0x20〜0x7E 以外の字を含む文字列は、テキスト文字列 (UTF-16BE。§7.9.2.2) の 16 進の文字列にする
 */
export function pdfText(s: string): PDFString | PDFHexString {
  if (/^[\x20-\x7e]*$/.test(s)) return PDFString.of(s.replace(/[\\()]/g, (c) => '\\' + c));
  return PDFHexString.fromText(s);
}

/**
 * 規格の印 (OutputIntent・版・Trapped・ID・題・日付)。XMP を書く規格では、版の印を XMP のメタデータ (pdfxid:GTS_PDFXVersion) にも書き、
 * Info の項目 (題・日付・Trapped) と XMP を一致させる
 */
export function markPdfStandard(pdf: PDFDocument, std: PdfStandard, o: PdfXOptions) {
  const ctx = pdf.context;
  const condition = o.condition ?? 'JC200103';
  const intent: Record<string, unknown> = {
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: pdfText(condition),
    OutputCondition: pdfText(o.info ?? condition),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: pdfText(o.info ?? condition),
  };
  if (o.profile) intent.DestOutputProfile = ctx.register(ctx.stream(o.profile, { N: 4 }));
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.obj(intent as never)]));
  const info = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(std.version));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  // XMP を書く規格では、Info の題・作者・主題・キーワードと XMP の値を同じにする (PDF/X-4 の決まり。公開の説明による。
  // Info の辞書は ISO 32000-2 §14.3.3、XMP は §14.3.2)。XMP は XML なので、XML 1.0 で使えない字 (xmlChars) を書けない。
  // その字を除いた値を、Info にも書き直す (Info のテキスト文字列 (UTF-16BE。§7.9.2.2) はどの字も表せるので、PDF/X でない PDF では除かない)
  if (std.xmp)
    for (const [key, value] of [['Title', pdf.getTitle()], ['Author', pdf.getAuthor()], ['Subject', pdf.getSubject()], ['Keywords', pdf.getKeywords()]] as const) {
      if (value === undefined) continue;
      const clean = xmlChars(value);
      if (clean === value) continue;
      if (clean) info.set(PDFName.of(key), PDFHexString.fromText(clean));
      else info.delete(PDFName.of(key));
    }
  // 題は PDF/X で要る (公開の説明による)。文書に題が無ければ (使えない字を除いて空になったときも)「Untitled」
  if (!pdf.getTitle()) pdf.setTitle('Untitled');
  // 作った日時と変えた日時を同じ秒にそろえて (Info と XMP で同じ値にする)
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  // 文書の ID (trailer。ISO 32000-2 §14.4)。XMP の DocumentID・InstanceID にも同じ値を使う
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
  if (std.xmp) {
    const xmp = pdfXmp({
      title: pdf.getTitle() ?? 'Untitled',
      author: pdf.getAuthor(),
      subject: pdf.getSubject(),
      keywords: pdf.getKeywords(),
      producer: pdf.getProducer() ?? '',
      creator: pdf.getCreator() ?? '',
      date: now,
      uuid: hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
      version: std.version,
    });
    // メタデータの流れは圧縮しない (XMP の包み (xpacket) を、PDF を読まずに探せるように)
    pdf.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
  }
}

/**
 * XML 1.0 で使えない字を除く。使える字 (XML 1.0 §2.2 の Char) は、タブ・改行・復帰と U+0020〜U+D7FF・U+E000〜U+FFFD・U+10000〜U+10FFFF。
 * 除くのは、ほかの制御文字 (U+0000〜U+001F)、U+FFFE・U+FFFF と、対になっていないサロゲート (u の正規表現は 1 つの字として見る)
 */
const xmlChars = (s: string) => s.replace(/[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '');

/**
 * XML の字の逃がし (& < > " ')。復帰 (CR) は文字参照にする (そのまま書くと、XML を読むときに改行に変わる。XML 1.0 §2.11)。
 * XML 1.0 で使えない字は除く (xmlChars)
 */
const xmlEscape = (s: string) => xmlChars(s).replace(/[&<>"'\r]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#xD;' })[c]!);

/**
 * XMP のメタデータ (ISO 32000-2 §14.3.2。XMP は ISO 16684-1)。Info と同じ値の題・作者・主題・キーワード・日付・Trapped と、
 * 版の印 pdfxid:GTS_PDFXVersion、xmpMM:DocumentID・InstanceID・VersionID・RenditionClass を書く (PDF/X-4 で要る項目は、公開の説明による)
 */
function pdfXmp(m: { title: string; author?: string; subject?: string; keywords?: string; producer: string; creator: string; date: Date; uuid: string; version: string }): string {
  const e = xmlEscape;
  const date = m.date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
      'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">',
    '<dc:format>application/pdf</dc:format>',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${e(m.title)}</rdf:li></rdf:Alt></dc:title>`,
    ...(m.author ? [`<dc:creator><rdf:Seq><rdf:li>${e(m.author)}</rdf:li></rdf:Seq></dc:creator>`] : []),
    ...(m.subject ? [`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${e(m.subject)}</rdf:li></rdf:Alt></dc:description>`] : []),
    `<xmp:CreateDate>${date}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${date}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${date}</xmp:MetadataDate>`,
    `<xmp:CreatorTool>${e(m.creator)}</xmp:CreatorTool>`,
    `<pdf:Producer>${e(m.producer)}</pdf:Producer>`,
    ...(m.keywords ? [`<pdf:Keywords>${e(m.keywords)}</pdf:Keywords>`] : []),
    '<pdf:Trapped>False</pdf:Trapped>',
    `<xmpMM:DocumentID>uuid:${m.uuid}</xmpMM:DocumentID>`,
    `<xmpMM:InstanceID>uuid:${m.uuid}</xmpMM:InstanceID>`,
    '<xmpMM:VersionID>1</xmpMM:VersionID>',
    '<xmpMM:RenditionClass>default</xmpMM:RenditionClass>',
    `<pdfxid:GTS_PDFXVersion>${e(m.version)}</pdfxid:GTS_PDFXVersion>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ];
  return lines.join('\n');
}
