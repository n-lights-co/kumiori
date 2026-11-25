/**
 * pdfStandard — PDF の出力の規格 (入稿用の PDF/X-1a・PDF/X-3・PDF/X-4) ごとの方針。
 *
 * 描く処理 (pdfRenderer.ts) は、規格の名前で分かれずに、ここの方針 (PdfStandard) の値を見る: 版とオブジェクトストリーム、RGB を CMYK に
 * するか、透明を警告するか、ArtBox を書くか、塗り足しまでの範囲 (ページの中) の注釈・フォームを外すか、必須の条件 (check)、印とメタデータ (mark)。
 * 規格を足すときは、ここに定義を 1 つ足す。外から足せるプラグインにはしない (方針の値は描く処理の内部と結び付いていて、
 * 規格への適合の責任も Kumiori の側にあるため)。
 *
 * 根拠: 出力意図の辞書は ISO 32000-2 §14.11.5 (Table 401)、XMP のメタデータは §14.3.2、文書の ID は §14.4、ページの範囲は §14.11.2。
 * 規格が元にする PDF の版の機能は、Adobe の PDF Reference (第 2 版 = PDF 1.3・第 3 版 = PDF 1.4・PDF 1.6 版) で確かめた:
 * 透明 (PDF 1.6 版の Table 4.8 の BM・SMask・CA・ca、§7.5.5 の透明のグループ) とメタデータの流れ (§10.2.2) は PDF 1.4、
 * オブジェクトストリーム (§3.4.6) は PDF 1.5、OpenType のままの書体の埋め込み (Table 5.24) は PDF 1.6 から。
 * 出力意図 (OutputIntents。§10.10.4) は PDF 1.4 からの機能で、PDF 1.3 の本文 (第 2 版) には無い。PDF 1.3 が元の PDF/X-1a:2001 でも書くのは、
 * PDF/X の規格が出力意図を求めるため (ISO 15930-1 §6.3.2)。
 * PDF/X-1a:2001 (ISO 15930-1:2001) と PDF/X-4 (ISO 15930-7:2010) は、規格の本文を読んで決まりを作り (節の番号を各所のコメントに書く)、
 * その決まりに適合することを確かめている。PDF/X-1a:2003 (ISO 15930-4)・PDF/X-3:2003 (ISO 15930-6) は、その本文では確かめておらず、
 * PDF/X-1a:2001 と同じ決まり (色のほか) を当てる。
 * どの版も、書き出した PDF を読み直して決まりに合うかを調べ (pdfxVerify.ts)、合わなければ誤りとして投げる。PDF/X-1a・PDF/X-3 は、
 * 書き出す前に透明を平らにする (pdfFlatten.ts)。入稿の前には、プリフライト (Acrobat Pro など) でも確かめること。
 *
 * 長期保存用の PDF/A-2b・PDF/A-3b (ISO 19005-2・-3 の b の水準 = 見た目を保存する水準) は、PDF/X と別の指定 (PdfAOptions) で、
 * PDF/X と合わせても使える。PDF/A の印は、出力意図 (S が GTS_PDFA1。ISO 19005-2 §6.2.3)、XMP のメタデータの pdfaid:part・conformance と、
 * Info と XMP の一致 (§6.6.3)。PDF/A だけのときの出力意図は、その場で作る sRGB のプロファイル (srgbIcc.ts)。PDF/X と合わせるときは、
 * 出力意図を 2 つ (GTS_PDFX と GTS_PDFA1) 書き、同じ DestOutputProfile (PDF/X の出力の CMYK の ICC プロファイル) を指させる
 * (§6.2.3: 出力意図が 2 つ以上なら、DestOutputProfile は同じ間接オブジェクト)。書き出した PDF は pdfaVerify.ts で調べる。
 * 規格の本文は手元に無く、節の番号は ISO 19005-2・-3 の目次と公開の説明 (veraPDF の検査の規則の一覧など) による。
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { GWG_SHEET_CMYK, type GwgVariant } from './pdfCheck';
import { msg } from './messages';
import { verifyPdfX1a, verifyPdfX3, verifyPdfX4 } from './pdfxVerify';
import { ICC_CMYK_REGISTRY, ICC_REGISTRY_NAME, iccDescription, iccDeviceClass, iccHasTag, iccProfileProblem } from './iccRegistry';
import { SRGB_DESCRIPTION, srgbProfile } from './srgbIcc';
import { KumioriOptionError, KumioriPdfError } from './errors';
import { createSha256, sha256 } from './sha256';

/** 入稿用 (PDF/X) の出力の指定 (PdfRenderOptions.pdfx) */
export interface PdfXOptions {
  /** 版: 'X-3' (PDF/X-3:2003。既定)、'X-4' (PDF/X-4)、'X-1a' (PDF/X-1a:2001)、'X-1a:2003' (PDF/X-1a:2003)。ほかの値は誤り (KumioriOptionError) */
  version?: 'X-3' | 'X-4' | 'X-1a' | 'X-1a:2003';
  /**
   * 印刷条件の名前 (OutputConditionIdentifier。ICC の登録名など)。書かなければ、プロファイル (profile) を渡したときはその説明 (desc のタグの文) にし、
   * プロファイルも無ければ JC200103 (Japan Color 2001 Coated の登録名)。
   * 登録名は、ICC の登録簿 (registry.color.org の CMYK Characterization Data) の Reference name: JC200103 は Japan Color 2001 Coated
   * (オフセット、光沢・マットのコート紙)。ほかに Japan Color 2011 (JCS2011)・Japan Color 2001 Uncoated (JC200104) などがある。
   * ここに書いた名前か既定の JC200103 が登録簿に載っている (ICC_CMYK_REGISTRY) ときだけ、出力意図に RegistryName を書く
   * (プロファイルの説明を名前にしたときは書かない)。載っていない名前なら、プロファイル (profile) が要る
   */
  condition?: string;
  /** 印刷条件の説明 (OutputCondition・Info。無ければ condition) */
  info?: string;
  /** 出力の CMYK の ICC プロファイル (DestOutputProfile として埋め込む。RGB の色・画像はこの表で CMYK にする) */
  profile?: Uint8Array;
  /** 警告を足す配列 */
  warnings?: string[];
}

/** 長期保存用 (PDF/A) の出力の指定 (PdfRenderOptions.pdfa) */
export interface PdfAOptions {
  /** 版と水準: 'A-2b' (PDF/A-2b。ISO 19005-2) か 'A-3b' (PDF/A-3b。ISO 19005-3) */
  version: 'A-2b' | 'A-3b';
  /** 警告を足す配列 */
  warnings?: string[];
}

/** PDF/A の版と水準 (pdfAOf で読んだもの) */
export interface PdfA {
  /** 警告に書く名前 (PDF/A-2b など) */
  readonly label: string;
  /** pdfaid:part の値 (ISO 19005 の部の番号) */
  readonly part: 2 | 3;
  /** pdfaid:conformance の値 (B = 見た目を保存する水準) */
  readonly conformance: 'B';
}

/** PDF/A の指定を読む。指定が無ければ undefined。知らない版は誤りとして投げる */
export function pdfAOf(o: PdfAOptions | undefined): PdfA | undefined {
  if (!o) return undefined;
  if (o.version === 'A-2b') return { label: 'PDF/A-2b', part: 2, conformance: 'B' };
  if (o.version === 'A-3b') return { label: 'PDF/A-3b', part: 3, conformance: 'B' };
  throw new KumioriOptionError(msg(`PDF/A の版 "${String(o.version)}" は使えません (A-2b・A-3b)`, `PDF/A version "${String(o.version)}" is not supported (A-2b or A-3b)`), 'pdfa.version');
}

/** ICC プロファイルの色空間 (頭の 16〜19 バイト目。ICC.1:2010 §7.2.6) と、その成分の数 (出力意図の流れの N) */
export function iccSpace(profile: Uint8Array): { space: string; n: number } {
  const space = profile.length >= 20 ? String.fromCharCode(...profile.subarray(16, 20)).trim() : '';
  return { space, n: space === 'CMYK' ? 4 : space === 'GRAY' ? 1 : 3 };
}

/** 印刷条件の既定の名前 (Japan Color 2001 Coated の登録名。プロファイルも名前も無いとき) */
const DEFAULT_CONDITION = 'JC200103';

/**
 * 出力意図の印刷条件 (OutputConditionIdentifier) の名前と、RegistryName を書くか。
 * 名前を渡せばその名前。渡さずにプロファイルを渡せば、プロファイルの説明 (desc。ICC.1:2010 §9.2.41) を名前にし、RegistryName は書かない
 * (そのプロファイルの印刷条件が登録簿のどれかは分からず、既定の JC200103 と書くと、埋め込むプロファイルと違う印刷条件を名乗るため。
 * ISO 15930-7 §6.4.2.1 は、RegistryName を書くなら OutputConditionIdentifier を登録簿の名前と一致させる)。
 * どちらも無ければ JC200103。RegistryName は、名前が登録簿に載っているとき (ISO 15930-1 §6.3.2・ISO 15930-7 §6.4.2.1)
 */
function conditionOf(o: PdfXOptions): { condition: string; registered: boolean } {
  if (o.condition !== undefined) return { condition: o.condition, registered: ICC_CMYK_REGISTRY.has(o.condition) };
  const desc = o.profile ? iccDescription(o.profile) : undefined;
  if (desc !== undefined) return { condition: desc, registered: false };
  return { condition: DEFAULT_CONDITION, registered: true };
}

/**
 * 印刷条件が登録簿に無いのにプロファイルが無ければ、誤りとして投げる (DestOutputProfile が要る。ISO 15930-1 §6.3.2)。
 * PDF/X-3:2003 (ISO 15930-6) の本文は確かめていないので、PDF/X-1a:2001 と同じ決まりを当てる
 */
function requireProfileIfUnregistered(o: PdfXOptions, label: string) {
  if (o.profile || conditionOf(o).registered) return;
  throw new KumioriPdfError('pdfx/profile-required', msg(`${label} では、印刷条件 "${o.condition}" が ICC の登録簿に無いので、出力の ICC プロファイル (CMYK) が要ります (pdfx.profile)。登録簿の名前 (JC200103 など) にするか、プロファイルを渡してください`, `${label}: the printing condition "${o.condition}" is not in the ICC registry, so an output ICC profile (CMYK) is required (pdfx.profile). Use a registered name (such as JC200103) or pass a profile`));
}

/** PDF の出力の規格の方針 */
export interface PdfStandard {
  /** 警告に書く名前 (「PDF/X-3 では透明を使えません」の PDF/X-3) */
  readonly label: string;
  /** 版の印 (GTS_PDFXVersion) の値 */
  readonly version: string;
  /** 適合の水準の印 (GTS_PDFXConformance) の値。PDF/X-1a:2001 だけが書く (PDF/X-1:2001 の 1a の水準) */
  readonly conformance?: string;
  /** ファイルの頭 (%PDF-1.x。pdf-lib の書き出しは 1.7 固定なので、同じ長さで書き換える) */
  readonly header: string;
  /** オブジェクトストリーム (PDF 1.5 の機能。PDF Reference の PDF 1.6 版 §3.4.6) を使うか */
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
  /**
   * 透明 (不透明度・ソフトマスク・画像の透明度) を使ったとき: 'allow' はそのまま、'warn' は警告に書く (出力からは消さない)、
   * 'forbid' は書き出した後の検査 (verify) で誤りにする (透明のある文書はこの規格では出せない)、
   * 'flatten' は透明を平らにする (pdfFlatten.ts: 下が 1 色の塗りならベクタのまま合成した色で、ほかは画素にして置く)。
   * 平らにできない透明が残れば誤りにする
   */
  readonly transparency: 'allow' | 'warn' | 'forbid' | 'flatten';
  /** ページに ArtBox を書くか (PDF/X のページは TrimBox か ArtBox のどちらか一方を持ち、両方は持たない。ISO 15930-1 §6.14・ISO 15930-7 §6.12) */
  readonly artBox: boolean;
  /** 塗り足しまでの範囲 (BleedBox。ページの絵柄の全体を囲む) に掛かる注釈・リンク・フォームの欄: 'keep' は書く、'drop' は書かずに警告に件数を書く */
  readonly marksInBleed: 'keep' | 'drop';
  /**
   * 動作 (Action) を書けるか。PDF/X は動作も JavaScript も使えない (ISO 15930-1 §6.20・ISO 15930-7 §6.18) ので false: しおりは題と文書の中の飛び先
   * (Dest。動作ではない) だけにし、動作を持つ注釈 (外へのリンク・送信や取り消しのボタン) は書かずに、件数を警告に書く
   */
  readonly actions: boolean;
  /** 字形の無い字 (.notdef) を描かないか (PDF/X-4: ISO 15930-7 §6.5.2。PDF/A・PDF/UA と同じ扱い) */
  readonly noNotdef: boolean;
  /** XMP のメタデータを書くか (版の印を XMP にも書く) */
  readonly xmp: boolean;
  /** 書き出した後に調べる GWG 2022-R1 の用途と値 (pdfCheck.ts。合わないものを警告に書く)。無ければ調べない */
  readonly gwg?: GwgVariant;
  /** 書き出す前に確かめる必須の条件。満たさなければ誤りとして投げる */
  check(o: PdfXOptions): void;
  /** 書き出した PDF を読み直して、規格の決まりに合わないものを文の並びで返す (空なら合う)。あれば、合わないときは誤りとして投げる */
  verify?(bytes: Uint8Array): Promise<string[]>;
}

/**
 * PDF/X-1a (CMYK と特色だけ。透明・RGB・ICC の色は使えない。書体はすべて埋め込む)。:2001 は ISO 15930-1 で PDF 1.3 が元、
 * :2003 は ISO 15930-4 で PDF 1.4 が元。印刷条件が ICC の登録簿に載っていれば登録名だけでよく、載っていなければプロファイルが要る
 * (ISO 15930-1 §6.3.2)。プロファイルを渡せば埋め込む (CMYK で、AtoB1 の表 (A2B1) を持つものに限る。§6.3.2)。
 * :2003 の本文 (ISO 15930-4) は確かめていないので、:2001 と同じ決まりを当てる
 */
function pdfX1a(year: '2001' | '2003'): PdfStandard {
  return {
    label: 'PDF/X-1a',
    version: year === '2001' ? 'PDF/X-1:2001' : 'PDF/X-1a:2003',
    ...(year === '2001' ? { conformance: 'PDF/X-1a:2001' } : {}),
    header: year === '2001' ? '%PDF-1.3' : '%PDF-1.4',
    objectStreams: false,
    cmyk: true,
    blackOverprint: { text: 12, line: 2 },
    transparency: 'flatten',
    artBox: false,
    marksInBleed: 'drop',
    actions: false,
    noNotdef: false,
    xmp: false,
    gwg: GWG_SHEET_CMYK,
    check: (o) => {
      if (o.profile) {
        checkCmykProfile(o.profile, 'PDF/X-1a');
        // 出力意図のプロファイルは、AtoB1 の表 (タグ A2B1。ICC.1:2010 §9.2.2) を持たなければならない (ISO 15930-1 §6.3.2)
        if (!iccHasTag(o.profile, 'A2B1'))
          throw new KumioriPdfError('pdfx/profile-invalid', msg('PDF/X-1a の出力の ICC プロファイルは、AtoB1 の表 (タグ A2B1) を持つものにしてください', 'The output ICC profile for PDF/X-1a must have an AtoB1 table (the A2B1 tag)'));
      }
      // 印刷条件が登録簿に無ければ、DestOutputProfile が要る (ISO 15930-1 §6.3.2)
      requireProfileIfUnregistered(o, 'PDF/X-1a');
    },
    verify: (bytes) => verifyPdfX1a(bytes, year === '2001' ? 'X-1a:2001' : 'X-1a:2003'),
  };
}
const PDF_X1A_2001 = pdfX1a('2001');
const PDF_X1A_2003 = pdfX1a('2003');

/**
 * PDF/X-3:2003 (ISO 15930-6。PDF 1.4 が元。透明は使えない。機器によらない色 (ICC・Lab) は使える)。透明は平らにし (X-1a と同じ)、
 * 書き出した PDF を読み直して決まりに合うかを調べる。出力意図は X-1a と同じ決まり (ISO 15930-1 §6.3.2) を当てる: 印刷条件が登録簿に
 * 載っていれば登録名だけでよく、載っていなければプロファイルが要る。プロファイルを渡すなら CMYK のもの (AtoB1 の表は求めない)
 */
const PDF_X3: PdfStandard = {
  label: 'PDF/X-3',
  version: 'PDF/X-3:2003',
  header: '%PDF-1.4',
  objectStreams: false,
  cmyk: true,
  blackOverprint: { text: 12, line: 2 },
  transparency: 'flatten',
  artBox: false,
  marksInBleed: 'drop',
  actions: false,
  noNotdef: false,
  xmp: false,
  gwg: GWG_SHEET_CMYK,
  check: (o) => {
    if (o.profile) checkCmykProfile(o.profile, 'PDF/X-3');
    requireProfileIfUnregistered(o, 'PDF/X-3');
  },
  verify: (bytes) => verifyPdfX3(bytes),
};

/**
 * PDF/X-4 (ISO 15930-7。PDF 1.6 が元。透明を使える)。出力の ICC プロファイルの埋め込みが要り、出力機器のプロファイル (機器の種類 prtr) に限る
 * (§6.4.2.1)。字形の無い字 (.notdef) は描かない (§6.5.2)。書き出した PDF を読み直して決まりに合うかを調べる
 */
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
  actions: false,
  noNotdef: true,
  xmp: true,
  gwg: GWG_SHEET_CMYK,
  check: (o) => {
    checkCmykProfile(o.profile, 'PDF/X-4');
    const cls = iccDeviceClass(o.profile!);
    if (cls !== 'prtr') throw new KumioriPdfError('pdfx/profile-invalid', msg(`PDF/X-4 の出力の ICC プロファイルは、出力機器のもの (機器の種類 prtr) にしてください (渡されたプロファイルの機器の種類: ${cls.trim() || '読めない'})`, `The output ICC profile for PDF/X-4 must be an output device profile (device class prtr) (device class of the given profile: ${cls.trim() || 'unreadable'})`));
  },
  verify: (bytes) => verifyPdfX4(bytes),
};

/** PDF/X の指定の規格の方針。指定が無ければ undefined (ふつうの PDF)。版を書かなければ PDF/X-3。知らない版は誤りとして投げる (pdfa.version と同じく、大文字小文字を区別する) */
export function pdfStandardOf(o: PdfXOptions | undefined): PdfStandard | undefined {
  if (!o) return undefined;
  if (o.version === undefined || o.version === 'X-3') return PDF_X3;
  if (o.version === 'X-4') return PDF_X4;
  if (o.version === 'X-1a') return PDF_X1A_2001;
  if (o.version === 'X-1a:2003') return PDF_X1A_2003;
  throw new KumioriOptionError(msg(`PDF/X の版 "${String(o.version)}" は使えません (X-1a・X-1a:2003・X-3・X-4)`, `PDF/X version "${String(o.version)}" is not supported (X-1a, X-1a:2003, X-3 or X-4)`), 'pdfx.version');
}

/**
 * 出力の ICC プロファイルを確かめる: 埋め込みが要り (DestOutputProfile)、頭とタグの表が ICC.1:2010 の形どおりで (§7.2・§7.3・§8.2 の desc。
 * iccProfileProblem)、色空間は CMYK (§7.2.6 の頭の 16〜19 バイト目。GWG 2022-R1 の R0035)。満たさなければ誤りとして投げる
 */
function checkCmykProfile(profile: Uint8Array | undefined, label: string) {
  if (!profile) throw new KumioriPdfError('pdfx/profile-required', msg(`${label} では、出力の ICC プロファイル (CMYK) が要ります (pdfx.profile)。印刷所の指定するプロファイル (Japan Color 2001 Coated など) を渡してください`, `${label} requires an output ICC profile (CMYK) (pdfx.profile). Pass the profile your printer specifies (such as Japan Color 2001 Coated)`));
  const problem = iccProfileProblem(profile);
  if (problem) throw new KumioriPdfError('pdfx/profile-invalid', msg(`${label} の出力の ICC プロファイルを読めません (ICC.1 の形に合いません: ${problem.ja})`, `The output ICC profile for ${label} cannot be read (it does not follow the ICC.1 format: ${problem.en})`));
  const space = profile.length >= 20 ? String.fromCharCode(...profile.subarray(16, 20)) : '';
  if (space !== 'CMYK') throw new KumioriPdfError('pdfx/profile-required', msg(`${label} の出力の ICC プロファイルは、CMYK のものにしてください (渡されたプロファイルの色空間: ${space.trim() || '読めない'})`, `The output ICC profile for ${label} must be a CMYK profile (color space of the given profile: ${space.trim() || 'unreadable'})`));
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
 * 規格の印 (OutputIntent・版・Trapped・ID・題・日付)。XMP を書く規格 (PDF/X-4 と PDF/A) では、版の印を XMP のメタデータ
 * (pdfxid:GTS_PDFXVersion・pdfaid:part・pdfaid:conformance) にも書き、Info の項目 (題・作者・主題・キーワード・日付・Trapped) と XMP を一致させる。
 * std・o は PDF/X (無ければ PDF/A だけ)、pdfa は PDF/A (無ければ PDF/X だけ)。pdfua は PDF/UA-1 (ISO 14289-1 §5: XMP の pdfuaid:part に版の印。
 * §7.1: 題を dc:title に書き、ViewerPreferences の DisplayDocTitle を true にする)。
 * idHex は文書の ID (無ければ印の値 DOCUMENT_ID_MARK を書き、書き出した後に finishDocumentId で書き換える。
 * 暗号化した PDF は、XMP を暗号化して後から書き換えられないので、初めから ID を渡す)
 */
export function markPdfStandard(pdf: PDFDocument, std: PdfStandard | undefined, o: PdfXOptions | undefined, pdfa: PdfA | undefined, pdfua: boolean, date: Date, idHex: string = DOCUMENT_ID_MARK) {
  const ctx = pdf.context;
  const x = std && o ? { std, o } : undefined;
  // 出力意図のプロファイル: PDF/X の出力の CMYK のプロファイル。PDF/A だけなら sRGB (srgbIcc.ts)。
  // 出力意図を 2 つ書くときは、同じ間接オブジェクトを指させる (ISO 19005-2 §6.2.3)
  const profile = x ? x.o.profile : pdfa ? srgbProfile() : undefined;
  const profileRef = profile ? ctx.register(ctx.stream(profile, { N: iccSpace(profile).n })) : undefined;
  const intents: PDFDict[] = [];
  const intentOf = (s: string, condition: string, registered: boolean, info: string) =>
    ctx.obj({
      Type: 'OutputIntent',
      S: s,
      OutputConditionIdentifier: pdfText(condition),
      OutputCondition: pdfText(info),
      // RegistryName は、印刷条件が ICC の登録簿に載っているときだけ書く (ISO 15930-1 §6.3.2・ISO 15930-7 §6.4.2.1。プロファイルの説明を名前にしたときは書かない。conditionOf)
      ...(registered ? { RegistryName: PDFString.of(ICC_REGISTRY_NAME) } : {}),
      Info: pdfText(info),
      ...(profileRef ? { DestOutputProfile: profileRef } : {}),
    } as never) as unknown as PDFDict;
  const { condition, registered } = x ? conditionOf(x.o) : { condition: SRGB_DESCRIPTION, registered: false };
  const conditionInfo = x ? (x.o.info ?? condition) : SRGB_DESCRIPTION;
  if (x) intents.push(intentOf('GTS_PDFX', condition, registered, conditionInfo));
  // PDF/A の出力意図 (S が GTS_PDFA1。PDF/A-2・3 でも同じ名前。ISO 19005-2 §6.2.3)。DestOutputProfile は要る
  if (pdfa) intents.push(intentOf('GTS_PDFA1', condition, registered, conditionInfo));
  if (intents.length) pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj(intents));
  const info = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  if (x) {
    info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(x.std.version));
    if (x.std.conformance) info.set(PDFName.of('GTS_PDFXConformance'), PDFString.of(x.std.conformance));
    info.set(PDFName.of('Trapped'), PDFName.of('False'));
  }
  const xmpWanted = !!pdfa || !!x?.std.xmp || !!pdfua;
  // XMP を書く規格では、Info の題・作者・主題・キーワードと XMP の値を同じにする (PDF/X-4 は ISO 15930-7 §6.10.2。PDF/A は
  // ISO 19005-2 §6.6.3 (Info と XMP の一致)。Info の辞書は ISO 32000-2 §14.3.3、XMP は §14.3.2)。XMP は XML なので、XML 1.0 で使えない字 (xmlChars) を書けない。
  // その字を除いた値を、Info にも書き直す (Info のテキスト文字列 (UTF-16BE。§7.9.2.2) はどの字も表せるので、PDF/X・PDF/A でない PDF では除かない)
  if (xmpWanted)
    for (const [key, value] of [['Title', pdf.getTitle()], ['Author', pdf.getAuthor()], ['Subject', pdf.getSubject()], ['Keywords', pdf.getKeywords()]] as const) {
      if (value === undefined) continue;
      const clean = xmlChars(value);
      if (clean === value) continue;
      if (clean) info.set(PDFName.of(key), PDFHexString.fromText(clean));
      else info.delete(PDFName.of(key));
    }
  // 題は PDF/X で要る (PDF/X-1a・X-3 は Info の Title。PDF/X-4 は XMP の dc:title。ISO 15930-7 §6.10.4)。文書に題が無ければ (使えない字を除いて空になったときも)「Untitled」。
  // PDF/A の b の水準では題は要らないので、PDF/A だけなら書かない (dc:title も書かない)
  if (x && !pdf.getTitle()) pdf.setTitle('Untitled');
  // PDF/UA-1: 窓の題に、ファイルの名前でなく文書の題を出す (ISO 14289-1 §7.1。ViewerPreferences は ISO 32000-1 §12.2 の Table 150)
  if (pdfua) pdf.catalog.set(PDFName.of('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }));
  // 作った日時と変えた日時 (pdfDocumentDate で秒にそろえたもの) を、Info と XMP で同じ値にする
  const now = date;
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  // 文書の ID (trailer。ISO 32000-2 §14.4)。XMP の DocumentID・InstanceID にも同じ値を使う。
  // ここでは印の値を書き、書き出した後に、中身から作った ID に書き換える (finishDocumentId。暗号化した PDF は、渡された ID をそのまま書く)
  const hex = idHex;
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
  if (xmpWanted) {
    const xmp = pdfXmp({
      title: pdf.getTitle(),
      author: pdf.getAuthor(),
      subject: pdf.getSubject(),
      keywords: pdf.getKeywords(),
      producer: pdf.getProducer() ?? '',
      creator: pdf.getCreator() ?? '',
      date: now,
      uuid: uuidOf(hex),
      pdfx: x?.std.version,
      pdfa,
      pdfua,
    });
    // メタデータの流れは圧縮しない (XMP の包み (xpacket) を、PDF を読まずに探せるように)
    pdf.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
  }
}

/**
 * 文書の ID (trailer の ID。ISO 32000-1 §14.4) の印の値 (16 バイトの 16 進)。書き出す前にこの値を書いておき、書き出したバイト列の
 * SHA-256 から作った ID に、finishDocumentId で書き換える。§14.4 は、ID を作るたびに違う値にすることを勧めるが、作り方は決めていない。
 * 乱数で作ると同じ入力から同じバイトの PDF にならないので、中身から作る (中身が同じなら同じ ID。日時が変われば中身が変わり、ID も変わる)
 */
export const DOCUMENT_ID_MARK = '4b756d696f72692d646f632d69642d00';
/** 印の値の XMP の形 (xmpMM:DocumentID・InstanceID の uuid: の後ろ。8-4-4-4-12 の形) */
const uuidOf = (hex: string) => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** bytes の中の、ASCII の字の並び s の位置をすべて返す */
function findAscii(bytes: Uint8Array, s: string): number[] {
  const pat = Array.from(s, (c) => c.charCodeAt(0));
  const at: number[] = [];
  for (let i = bytes.indexOf(pat[0]); i >= 0 && i <= bytes.length - pat.length; i = bytes.indexOf(pat[0], i + 1)) {
    let k = 1;
    while (k < pat.length && bytes[i + k] === pat[k]) k++;
    if (k === pat.length) at.push(i);
  }
  return at;
}

/**
 * bytes の中の XMP の包み (<?xpacket begin= から <?xpacket end= まで) の範囲 [初め, 終わり] (XMP Specification Part 1 §7.3.2)。
 * 始まりと終わりの位置の並び (どちらも昇順) を 1 度ずつなめる (字を並べた入力でも、手間は字の数に比例する)
 */
function xmpPackets(bytes: Uint8Array): Array<[number, number]> {
  const ends = findAscii(bytes, '<?xpacket end=');
  const out: Array<[number, number]> = [];
  let k = 0;
  for (const b of findAscii(bytes, '<?xpacket begin=')) {
    while (k < ends.length && ends[k] <= b) k++;
    if (k < ends.length) out.push([b, ends[k]]);
  }
  return out;
}

/**
 * 印を探す所 (finishDocumentId・DocumentIdStream.finish)。Kumiori が書いた所だけを探し、利用者のバイト列 (画像の中身・PDF の画像の流れ・
 * 平文の文字列) の中の同じ字の並びは、数えも書き換えもしない。
 *  - xmp: XMP の流れ (catalog の Metadata。Kumiori が作り、圧縮しない) のオブジェクトの、ファイルの中の範囲 [初め, 終わり)。
 *    null は XMP が無いこと (XMP の印を探さない)。undefined は範囲が分からないこと (ファイルの全体の XMP の包みの中を探す。試験で pdf-lib の save に替えたとき)
 */
export interface DocumentIdPlaces {
  xmp?: readonly [number, number] | null;
}

/**
 * 書き出した PDF の文書の ID の印の値 (DOCUMENT_ID_MARK) を、バイト列の SHA-256 の初めの 16 バイトに書き換える (同じ長さなので、
 * 相互参照のオフセットは変わらない)。trailer の辞書 (相互参照の流れの辞書も) と XMP の流れ (圧縮しない) は平文なので、そのまま探せる。
 * 同じ字の並びは、文書の中身 (画像のバイト列、PDF/X-1a・X-3 の平文の利用者の値 (リンクの URI・OutputCondition など)) にもありうるので、
 * trailer の印は、最後の相互参照の所 (startxref の指す位置。ISO 32000-1 §7.5.5) から後ろの初めの 2 つを使い、XMP の印は、XMP の流れの
 * オブジェクトの中の包み (xpacket) の中のものだけを使う (places.xmp)。trailer の 2 つ (と、XMP があれば DocumentID・InstanceID の 2 つ) の
 * 印の値が見つからなければ誤り
 */
export function finishDocumentId(bytes: Uint8Array, places: DocumentIdPlaces = {}): Uint8Array {
  const at = documentIdMarks(bytes, 0, places);
  writeDocumentId(bytes, at, sha256(bytes).slice(0, 32));
  return bytes;
}

/**
 * 最後の相互参照の位置 (ファイルの終わりの startxref の値。ISO 32000-1 §7.5.5)。bytes はファイルの base バイト目から後ろ。
 * 読めないか、bytes の外なら undefined
 */
function lastXrefOffset(bytes: Uint8Array, base: number): number | undefined {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!m) return undefined;
  const at = Number(m[1]) - base;
  return at >= 0 && at < bytes.length ? at : undefined;
}

/**
 * 書いた PDF (の base バイト目から後ろ) の中の、文書の ID の印の値の位置 (trailer の 2 つと、XMP の包みの中の 0 か 2 つ)。
 * 位置は bytes の中の位置。places.xmp はファイルの中の位置
 */
function documentIdMarks(bytes: Uint8Array, base: number, places: DocumentIdPlaces): { hexAt: number[]; uuidAt: number[] } {
  const xref = lastXrefOffset(bytes, base);
  const hexAll = xref === undefined ? findAscii(bytes, `<${DOCUMENT_ID_MARK}>`) : findAscii(bytes.subarray(xref), `<${DOCUMENT_ID_MARK}>`).map((i) => i + xref);
  // 最後の相互参照の所が分かれば、その初めの 2 つ (trailer・相互参照の流れの辞書は、流れのデータより前)。分からなければ、ファイルの終わりの 2 つ
  const hexAt = xref === undefined ? hexAll.slice(-2) : hexAll.slice(0, 2);
  let uuidAt: number[] = [];
  if (places.xmp === undefined) uuidAt = xmpUuidMarks(bytes);
  else if (places.xmp) {
    const [a, b] = [places.xmp[0] - base, places.xmp[1] - base];
    if (a < 0 || b > bytes.length || a >= b) throw new Error('Kumiori: the XMP stream is not in the last part of the written PDF');
    uuidAt = xmpUuidMarks(bytes.subarray(a, b)).map((i) => i + a);
  }
  // trailer の ID の 2 つの値は、続けて書く (< 印 > < 印 > の間は空白と [ ] だけ)
  const adjacent = hexAt.length === 2 && hexAt[1] - hexAt[0] <= DOCUMENT_ID_MARK.length + 2 + 8;
  if (!adjacent || (uuidAt.length !== 0 && uuidAt.length !== 2))
    // 書き出しの作りの誤り (入力では起きない) なので、診断の名前を持つ誤りにはしない
    throw new Error(`Kumiori: the document ID mark was not found in the written PDF (${hexAll.length} in the trailer, ${uuidAt.length} in XMP)`);
  return { hexAt, uuidAt };
}

/** bytes の中の、XMP の包み (xpacket) の中にある印の値 (uuid:…<) の位置 (印と包みの並びを、どちらも 1 度ずつなめる) */
function xmpUuidMarks(bytes: Uint8Array): number[] {
  const packets = xmpPackets(bytes);
  const out: number[] = [];
  let k = 0;
  for (const i of findAscii(bytes, `uuid:${uuidOf(DOCUMENT_ID_MARK)}<`)) {
    // 包みは始まりの昇順で、包みどうしは重なりうる (始まりの後の最初の終わりまで) ので、i より前で終わった包みだけを飛ばす
    while (k < packets.length && packets[k][1] <= i) k++;
    if (k < packets.length && packets[k][0] < i) out.push(i);
  }
  return out;
}

/** 印の値の位置に、ID (16 進 32 字) を書く */
function writeDocumentId(bytes: Uint8Array, at: { hexAt: number[]; uuidAt: number[] }, id: string): void {
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  for (const i of at.hexAt) bytes.set(enc(id), i + 1);
  for (const i of at.uuidAt) bytes.set(enc(uuidOf(id)), i + 5);
}

/**
 * 流して書く PDF の文書の ID (finishDocumentId と同じ ID を、書いた塊を順に足す SHA-256 で作る)。
 * 先に書いた塊 (see。書き出し先へ渡した後は書き換えられない) は、ハッシュに足すだけ (中を探さない)。印の値は、最後の塊 (finish。残りの流れ・
 * オブジェクトの流れ・相互参照の流れ・trailer) の中で、finishDocumentId と同じ所を探して書き換える。XMP の流れは最後に作るので、最後の塊に入る
 * (先に書いていたら、書き手 (pdfWriter.ts) が誤りにする)
 */
export class DocumentIdStream {
  private readonly hash = createSha256();
  /** 先に書いた塊 (オブジェクト 1 つか、見出し。ファイルの順に) */
  see(piece: Uint8Array): void {
    this.hash.update(piece);
  }
  /** 最後の塊 (ファイルの base バイト目から後ろ) の印の値を、ファイルの全体の SHA-256 から作った ID に書き換える */
  finish(tail: Uint8Array, base: number, places: DocumentIdPlaces): Uint8Array {
    const at = documentIdMarks(tail, base, places);
    writeDocumentId(tail, at, this.hash.update(tail).digest().slice(0, 32));
    return tail;
  }
}

/**
 * PDF に書く作成日・更新日 (Info の CreationDate・ModDate、XMP の xmp:CreateDate・ModifyDate・MetadataDate、添付の ModDate)。
 * 渡した日時 (PdfOptions.date) か、無ければいまの時刻を、秒より下を切り捨てて返す (PDF の日付は秒まで。ISO 32000-1 §7.9.4)。
 * 正しくない Date (NaN) と、4 桁の年で書けない日時 (0〜9999 年の外) は、選択肢の誤り
 */
export function pdfDocumentDate(d: Date | undefined): Date {
  if (d === undefined) return new Date(Math.floor(Date.now() / 1000) * 1000);
  // 別の realm (iframe・vm) の Date も受ける (instanceof では、その realm の Date を誤りにした)。中の時刻は Date.prototype.getTime で読む。
  // getTime は、内部の [[DateValue]] を持たない値に TypeError を投げる (ECMA-262 §21.4.4 の thisTimeValue) ので、
  // Symbol.toStringTag を 'Date' に偽った値も Date でないと分かる (Object.prototype.toString では見分けられない)
  let t: number;
  try {
    t = Date.prototype.getTime.call(d);
  } catch {
    t = NaN;
  }
  const year = Number.isFinite(t) ? new Date(t).getUTCFullYear() : NaN;
  if (!Number.isFinite(t) || year < 0 || year > 9999)
    throw new KumioriOptionError(msg('date は 0〜9999 年の正しい Date にします', 'date must be a valid Date between the years 0 and 9999'), 'date');
  return new Date(Math.floor(t / 1000) * 1000);
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
 * XMP のメタデータ (ISO 32000-2 §14.3.2。XMP は ISO 16684-1)。Info と同じ値の題・作者・主題・キーワード・日付と、
 * xmpMM:DocumentID・InstanceID・VersionID・RenditionClass を書く。
 * 名前空間と値の型は、Adobe の XMP Specification (Part 1: 2012 年 4 月版、Part 2・Part 3) で確かめた: 包み (xpacket) は Part 1 §7.3.2、
 * dc (§8.3)・xmp (§8.4)・xmpMM (§8.6) の名前空間と、題・説明 (Language Alternative。§8.2.2.4)・日付 (Date。§8.2.1.2)・
 * ID (GUID。§8.2.2.3)・RenditionClass (§8.2.2.8)、pdf の名前空間 (Part 2 §3.1。pdf:Trapped は Boolean = True か False。Part 1 §8.2.1.1)、
 * PDF への埋め込み (メタデータの流れ。UTF-8。Part 3 §1.6.1)。包みの中には、後で書き換えられるように空白を約 2000 バイト入れる
 * (Part 1 §7.3.2 の NOTE 3。100 字ほどごとに改行)。
 * PDF/X なら、版の印 pdfxid:GTS_PDFXVersion (pdfxid にほかの項目は書かない。ISO 15930-7 §6.11) と pdf:Trapped (True か False。§6.9)。
 * PDF/X-4 で要る項目 (xmp:CreateDate・ModifyDate・MetadataDate、dc:title、xmpMM:DocumentID・VersionID・RenditionClass) は §6.10.4、
 * 包みの頭に bytes・encoding の属性を書かないのは §6.10.3 による。
 * PDF/A なら、pdfaid:part・pdfaid:conformance (ISO 19005-2 §6.6.4)。PDF/A では、XMP の定義済みのスキーマ (XMP の仕様の 2005 年版と
 * PDF/A の識別のスキーマ) に無い属性は、拡張のスキーマ (pdfaExtension:schemas) で定義しなければならない (§6.6.2.3.1) ので、
 * PDF/X と合わせるときは、pdfxid:GTS_PDFXVersion と pdf:Trapped (Adobe PDF のスキーマの属性だが、PDF/A-2 の定義済みの属性に無い。
 * veraPDF 1.28.2 の §6.6.2.3.1 の検査で確かめた) を、拡張のスキーマとして書く
 */
function pdfXmp(m: { title?: string; author?: string; subject?: string; keywords?: string; producer: string; creator: string; date: Date; uuid: string; pdfx?: string; pdfa?: PdfA; pdfua?: boolean }): string {
  const e = xmlEscape;
  const date = m.date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ns = [
    'xmlns:dc="http://purl.org/dc/elements/1.1/"',
    'xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
    'xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
    ...(m.pdfx ? ['xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"'] : []),
    ...(m.pdfa ? ['xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"'] : []),
    ...(m.pdfua ? ['xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"'] : []),
    ...(m.pdfa && (m.pdfx || m.pdfua) ? ['xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"', 'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"', 'xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"'] : []),
  ];
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" ${ns.join(' ')}>`,
    '<dc:format>application/pdf</dc:format>',
    ...(m.title ? [`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${e(m.title)}</rdf:li></rdf:Alt></dc:title>`] : []),
    ...(m.author ? [`<dc:creator><rdf:Seq><rdf:li>${e(m.author)}</rdf:li></rdf:Seq></dc:creator>`] : []),
    ...(m.subject ? [`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${e(m.subject)}</rdf:li></rdf:Alt></dc:description>`] : []),
    `<xmp:CreateDate>${date}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${date}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${date}</xmp:MetadataDate>`,
    `<xmp:CreatorTool>${e(m.creator)}</xmp:CreatorTool>`,
    `<pdf:Producer>${e(m.producer)}</pdf:Producer>`,
    ...(m.keywords ? [`<pdf:Keywords>${e(m.keywords)}</pdf:Keywords>`] : []),
    ...(m.pdfx ? ['<pdf:Trapped>False</pdf:Trapped>'] : []),
    `<xmpMM:DocumentID>uuid:${m.uuid}</xmpMM:DocumentID>`,
    `<xmpMM:InstanceID>uuid:${m.uuid}</xmpMM:InstanceID>`,
    '<xmpMM:VersionID>1</xmpMM:VersionID>',
    '<xmpMM:RenditionClass>default</xmpMM:RenditionClass>',
    ...(m.pdfx ? [`<pdfxid:GTS_PDFXVersion>${e(m.pdfx)}</pdfxid:GTS_PDFXVersion>`] : []),
    ...(m.pdfa ? [`<pdfaid:part>${m.pdfa.part}</pdfaid:part>`, `<pdfaid:conformance>${m.pdfa.conformance}</pdfaid:conformance>`] : []),
    // PDF/UA-1 の版の印 (ISO 14289-1 §5)
    ...(m.pdfua ? ['<pdfuaid:part>1</pdfuaid:part>'] : []),
    // PDF/A と合わせるときは、PDF/A の定義済みのスキーマに無い属性を、拡張のスキーマで定義する (ISO 19005-2 §6.6.2.3.1)
    ...extensionSchemas(m.pdfa ? [...(m.pdfua ? [PDFUA_SCHEMA] : []), ...(m.pdfx ? PDFX_SCHEMAS : [])] : []),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    ...XMP_PADDING,
    '<?xpacket end="w"?>',
  ];
  return lines.join('\n');
}

/** XMP の包みの中の空白 (XMP Specification Part 1 §7.3.2 の NOTE 3: 約 2000 バイト、100 字ほどごとに改行) */
const XMP_PADDING = Array.from({ length: 20 }, () => ' '.repeat(99));

/** PDF/A の拡張のスキーマの、PDF/UA の識別のスキーマ (pdfuaid:part) の項目 (1 つの rdf:li) */
const PDFUA_SCHEMA = [
  '<rdf:li rdf:parseType="Resource">',
  '<pdfaSchema:schema>PDF/UA Universal Accessibility Schema</pdfaSchema:schema>',
  '<pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>',
  '<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>',
  '<pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource">',
  '<pdfaProperty:name>part</pdfaProperty:name>',
  '<pdfaProperty:valueType>Integer</pdfaProperty:valueType>',
  '<pdfaProperty:category>internal</pdfaProperty:category>',
  '<pdfaProperty:description>Indicates, which part of ISO 14289 standard is followed</pdfaProperty:description>',
  '</rdf:li></rdf:Seq></pdfaSchema:property>',
  '</rdf:li>',
];

/** PDF/A の拡張のスキーマの、PDF/X の識別のスキーマ (pdfxid:GTS_PDFXVersion) と Adobe PDF のスキーマ (pdf:Trapped) の項目 */
const PDFX_SCHEMAS = [
  [
    '<rdf:li rdf:parseType="Resource">',
    '<pdfaSchema:schema>PDF/X ID Schema</pdfaSchema:schema>',
    '<pdfaSchema:namespaceURI>http://www.npes.org/pdfx/ns/id/</pdfaSchema:namespaceURI>',
    '<pdfaSchema:prefix>pdfxid</pdfaSchema:prefix>',
    '<pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource">',
    '<pdfaProperty:name>GTS_PDFXVersion</pdfaProperty:name>',
    '<pdfaProperty:valueType>Text</pdfaProperty:valueType>',
    '<pdfaProperty:category>internal</pdfaProperty:category>',
    '<pdfaProperty:description>ID of PDF/X standard</pdfaProperty:description>',
    '</rdf:li></rdf:Seq></pdfaSchema:property>',
    '</rdf:li>',
  ],
  [
    '<rdf:li rdf:parseType="Resource">',
    '<pdfaSchema:schema>Adobe PDF Schema</pdfaSchema:schema>',
    '<pdfaSchema:namespaceURI>http://ns.adobe.com/pdf/1.3/</pdfaSchema:namespaceURI>',
    '<pdfaSchema:prefix>pdf</pdfaSchema:prefix>',
    '<pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource">',
    '<pdfaProperty:name>Trapped</pdfaProperty:name>',
    '<pdfaProperty:valueType>Text</pdfaProperty:valueType>',
    '<pdfaProperty:category>external</pdfaProperty:category>',
    '<pdfaProperty:description>Indication if the document has been modified to include trapping information</pdfaProperty:description>',
    '</rdf:li></rdf:Seq></pdfaSchema:property>',
    '</rdf:li>',
  ],
];

/**
 * 拡張のスキーマ (pdfaExtension:schemas) の行。項目の行をつなぎ、項目どうしの境目 (</rdf:li> と <rdf:li …>) と、包み (rdf:Bag) の
 * 始めと終わりは、隣の行と同じ行に書く (PDF/X と合わせた PDF/A の、これまでの XMP の行と同じにする)
 */
function extensionSchemas(items: string[][]): string[] {
  if (!items.length) return [];
  const lines: string[] = [];
  for (const it of items) {
    if (lines.length) lines[lines.length - 1] += it[0];
    else lines.push(it[0]);
    lines.push(...it.slice(1));
  }
  lines[0] = `<pdfaExtension:schemas><rdf:Bag>${lines[0]}`;
  lines[lines.length - 1] += '</rdf:Bag></pdfaExtension:schemas>';
  return lines;
}
