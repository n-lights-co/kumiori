/**
 * 組版の診断 (警告・知らせ) と、Kumiori が投げる誤りの種類の名前の表。
 *
 * 名前は「段/中身」(css/unknown-property など。小文字とハイフン)。一度出した名前は、版をまたいで変えない・別の意味に使い回さない
 * (やめるときは、説明書の一覧に、使わなくなった版を書いて残す)。文言 (message) は約束しない (直すことがある) ので、見分けには名前を使う。
 * 名前ごとの意味・重さ・args の名前の一覧は docs/diagnostics.md (英語版 docs/en/diagnostics.md) にあり、この表と食い違わないことを
 * test/diagnostics.test.ts で確かめる。
 *
 * 重さ (severity):
 *  - error: 出力から入力の中身が欠けた・変わった (画像が無い・字形の無い字・溢れ・上限で打ち切った)。例外にはせず、組版は最後まで行う
 *  - warning: 指定を読まずに無視した・別の形で組んだ
 *  - info: 出力は意図どおりで、知っておくとよいこと (選択肢で止めた取得など)
 */
import { limits } from './limits';
import { msg } from './messages';

/** 診断の重さ */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** 診断の名前 (組版の結果の diagnostics に出るもの。重さは DIAGNOSTIC_TABLE) */
export type DiagnosticCode =
  | 'api/setup-option-ignored'
  | 'api/unknown-diagnostic-code'
  | 'resource/not-fetched'
  | 'resource/fetch-failed'
  | 'resource/attachment-not-found'
  | 'link/action-dropped'
  | 'fo/unsupported'
  | 'fo/note'
  | 'fo/master-reference-not-found'
  | 'css/unsupported'
  | 'css/unknown-property'
  | 'css/invalid-value'
  | 'css/invalid-attr-value'
  | 'css/unreferenced-stylesheet'
  | 'font/face-not-found'
  | 'limit/nesting-depth'
  | 'limit/css-import'
  | 'limit/raised'
  | 'limit/reached'
  | 'font/file-unreadable'
  | 'font/family-unreadable'
  | 'font/generic-not-loaded'
  | 'font/load-failed'
  | 'font/missing-glyph'
  | 'font/system-fallback'
  | 'font/system-font-not-embeddable'
  | 'font/repaired'
  | 'font/table-unused'
  | 'font/cff2-not-converted'
  | 'font/variable-unsupported'
  | 'font/variable-instances-capped'
  | 'font/variable-failed'
  | 'font/shaping-failed'
  | 'font/glyph-unreadable'
  | 'font/color-glyph-too-complex'
  | 'image/not-found'
  | 'image/unsupported'
  | 'image/partial'
  | 'image/reference-not-found'
  | 'image/timeout'
  | 'image/invalid-size'
  | 'image/too-many-fragments'
  | 'image/format-warning'
  | 'image/pdf-invalid'
  | 'image/pdf-encrypted'
  | 'image/pdf-page'
  /** 0.7.0 からは、範囲のページの数が上限 pdfImageRangePages を超えたときだけ出す (0.6.0 は、範囲の最初のページだけを貼ったときに出した) */
  | 'image/pdf-page-range'
  | 'image/pdf-fragment'
  | 'image/pdf-repaired'
  | 'image/pdf-dropped'
  | 'image/pdf-font'
  | 'image/pdf-placeholder'
  | 'layout/line-overflow'
  | 'layout/box-overflow'
  | 'layout/float-overflow'
  | 'layout/footnote-overflow'
  | 'layout/column-overflow'
  | 'layout/table-row-overflow'
  | 'layout/continuation-dropped'
  | 'layout/inline-block-dropped'
  | 'layout/height-cut'
  | 'layout/keep-overflow'
  | 'layout/condense-overflow'
  | 'layout/condense-capped'
  | 'layout/condense-height-unknown'
  | 'layout/marker-misplaced'
  | 'layout/table-header-not-repeated'
  | 'layout/missing-id'
  | 'layout/index-key-missing'
  | 'layout/not-converged'
  | 'layout/max-pages-reached'
  | 'layout/beyond-max-pages'
  | 'limit/measure-nesting'
  | 'limit/table-row-span'
  | 'limit/table-columns'
  | 'limit/table-structure-cells'
  | 'limit/link-description'
  | 'pdf/glyph-not-drawn'
  | 'pdf/notdef-not-drawn'
  | 'pdf/svg-links-capped'
  | 'pdf/foreign-object-approximated'
  | 'pdf/form-field-failed'
  | 'pdf/color-glyph-image'
  | 'pdf/color-glyph-svg'
  | 'pdf/color-glyph-plus'
  | 'png/image-not-drawn'
  | 'png/image-limit'
  | 'png/raster-budget'
  | 'png/layer-limit'
  | 'png/clip-limit'
  | 'canvas/svg-not-drawn'
  | 'pdfx/transparency'
  | 'pdfx/rasterized'
  | 'pdfx/spot-in-raster'
  | 'pdfx/text-in-raster'
  | 'pdfx/icc-fallback'
  | 'pdfx/annotations-dropped'
  | 'pdfx/actions-dropped'
  | 'pdfx/check'
  | 'pdfx/embedded-pdf'
  | 'pdfa/launch-dropped'
  | 'pdfa/cmyk-converted'
  | 'pdfa/forms-dropped'
  | 'pdfa/attachments-dropped'
  | 'pdfa/freetext-appearance'
  | 'pdfa/embedded-pdf'
  | 'pdfua/missing-title'
  | 'pdfua/missing-lang'
  | 'pdfua/missing-figure-alt'
  | 'pdfua/missing-formula-alt'
  | 'pdfua/heading-skipped'
  | 'pdfua/embedded-pdf'
  | 'snapshot/wait-timeout'
  | 'snapshot/iframe-skipped'
  | 'snapshot/canvas-tainted'
  | 'snapshot/canvas-too-large'
  | 'snapshot/stylesheet-rule-removed'
  | 'snapshot/blob-unreadable'
  | 'snapshot/limit'
  | 'snapshot/shadow-root-closed'
  | 'snapshot/shadow-stylesheet-unreadable'
  | 'snapshot/font-face-source-unknown';

/** 診断の名前と重さの表 */
const DIAGNOSTIC_TABLE: Record<DiagnosticCode, DiagnosticSeverity> = {
  // 入口 (選択肢・資源の取得)
  'api/setup-option-ignored': 'warning',
  'api/unknown-diagnostic-code': 'warning',
  'resource/not-fetched': 'info',
  'resource/fetch-failed': 'warning',
  'resource/attachment-not-found': 'warning',
  'link/action-dropped': 'warning',
  // 読み込み: XSL-FO
  'fo/unsupported': 'warning',
  'fo/note': 'warning',
  'fo/master-reference-not-found': 'error',
  // 読み込み: HTML・CSS・EPUB
  'css/unsupported': 'warning',
  'css/unknown-property': 'warning',
  'css/invalid-value': 'warning',
  'css/invalid-attr-value': 'warning',
  'css/unreferenced-stylesheet': 'info',
  'font/face-not-found': 'warning',
  'limit/nesting-depth': 'warning',
  'limit/css-import': 'error',
  'limit/raised': 'info',
  'limit/reached': 'warning',
  // 書体
  'font/file-unreadable': 'warning',
  'font/family-unreadable': 'warning',
  'font/generic-not-loaded': 'warning',
  'font/load-failed': 'warning',
  'font/missing-glyph': 'error',
  'font/system-fallback': 'info',
  'font/system-font-not-embeddable': 'warning',
  'font/repaired': 'warning',
  'font/table-unused': 'warning',
  'font/cff2-not-converted': 'warning',
  'font/variable-unsupported': 'warning',
  'font/variable-instances-capped': 'info',
  'font/variable-failed': 'warning',
  'font/shaping-failed': 'warning',
  'font/glyph-unreadable': 'error',
  'font/color-glyph-too-complex': 'warning',
  // 画像
  'image/not-found': 'error',
  'image/unsupported': 'error',
  'image/partial': 'warning',
  'image/reference-not-found': 'warning',
  'image/timeout': 'error',
  'image/invalid-size': 'error',
  'image/too-many-fragments': 'warning',
  'image/format-warning': 'warning',
  // PDF の画像 (pdfImage.ts)
  'image/pdf-invalid': 'error',
  'image/pdf-encrypted': 'error',
  'image/pdf-page': 'warning',
  'image/pdf-page-range': 'warning',
  'image/pdf-fragment': 'warning',
  'image/pdf-repaired': 'info',
  'image/pdf-dropped': 'info',
  'image/pdf-font': 'info',
  'image/pdf-placeholder': 'error',
  // 組版
  'layout/line-overflow': 'error',
  'layout/box-overflow': 'error',
  'layout/float-overflow': 'error',
  'layout/footnote-overflow': 'error',
  'layout/column-overflow': 'error',
  'layout/table-row-overflow': 'error',
  'layout/continuation-dropped': 'error',
  'layout/inline-block-dropped': 'error',
  'layout/height-cut': 'error',
  'layout/keep-overflow': 'warning',
  'layout/condense-overflow': 'error',
  'layout/condense-capped': 'warning',
  'layout/condense-height-unknown': 'warning',
  'layout/marker-misplaced': 'warning',
  'layout/table-header-not-repeated': 'warning',
  'layout/missing-id': 'warning',
  'layout/index-key-missing': 'warning',
  'layout/not-converged': 'warning',
  'layout/max-pages-reached': 'info',
  'layout/beyond-max-pages': 'warning',
  'limit/measure-nesting': 'warning',
  'limit/table-row-span': 'warning',
  'limit/table-columns': 'warning',
  'limit/table-structure-cells': 'warning',
  'limit/link-description': 'warning',
  // PDF の書き出し
  'pdf/glyph-not-drawn': 'error',
  'pdf/notdef-not-drawn': 'error',
  'pdf/svg-links-capped': 'warning',
  'pdf/foreign-object-approximated': 'warning',
  'pdf/form-field-failed': 'warning',
  'pdf/color-glyph-image': 'error',
  'pdf/color-glyph-svg': 'warning',
  'pdf/color-glyph-plus': 'warning',
  'png/image-not-drawn': 'error',
  'png/image-limit': 'error',
  'png/raster-budget': 'error',
  'png/layer-limit': 'warning',
  'png/clip-limit': 'warning',
  'canvas/svg-not-drawn': 'error',
  'pdfx/transparency': 'warning',
  'pdfx/rasterized': 'warning',
  'pdfx/spot-in-raster': 'warning',
  'pdfx/text-in-raster': 'warning',
  'pdfx/icc-fallback': 'info',
  'pdfx/annotations-dropped': 'info',
  'pdfx/actions-dropped': 'info',
  'pdfx/check': 'warning',
  'pdfx/embedded-pdf': 'warning',
  'pdfa/launch-dropped': 'info',
  'pdfa/cmyk-converted': 'info',
  'pdfa/forms-dropped': 'warning',
  'pdfa/attachments-dropped': 'warning',
  'pdfa/freetext-appearance': 'warning',
  'pdfa/embedded-pdf': 'warning',
  'pdfua/missing-title': 'warning',
  'pdfua/missing-lang': 'warning',
  'pdfua/missing-figure-alt': 'warning',
  'pdfua/missing-formula-alt': 'warning',
  'pdfua/heading-skipped': 'warning',
  'pdfua/embedded-pdf': 'warning',
  // ブラウザの画面で文書を写す (snapshotDocument)
  'snapshot/wait-timeout': 'warning',
  'snapshot/iframe-skipped': 'warning',
  'snapshot/canvas-tainted': 'warning',
  'snapshot/canvas-too-large': 'warning',
  'snapshot/stylesheet-rule-removed': 'warning',
  'snapshot/blob-unreadable': 'warning',
  'snapshot/limit': 'warning',
  'snapshot/shadow-root-closed': 'warning',
  'snapshot/shadow-stylesheet-unreadable': 'warning',
  'snapshot/font-face-source-unknown': 'warning',
};

/** 誤り (例外) の名前。診断と同じ名前の体系 (投げる型の分けは ERROR_TABLE) */
export type ErrorCode =
  | 'api/invalid-option'
  | 'input/xml-parse'
  | 'input/not-xsl-fo'
  | 'input/not-zip'
  | 'input/zip-entry'
  | 'input/not-epub'
  | 'area-tree/format'
  | 'limit/nesting-depth'
  | 'limit/entity-expansion'
  | 'limit/transform-nesting'
  | 'limit/zip-size'
  | 'limit/zip-entries'
  | 'font/load-failed'
  | 'font/none-registered'
  | 'font/broken-file'
  | 'pdf/tagged-incompatible'
  | 'pdfua/requires-tagged'
  | 'pdfx/profile-required'
  | 'pdfx/profile-invalid'
  | 'pdfx/not-conforming'
  | 'pdfx/flatten-failed'
  | 'pdfa/not-conforming'
  | 'internal/patch-mismatch'
  | 'internal/page-sealed';

/** 誤りの分け (投げる型。errors.ts) */
export type ErrorKind = 'option' | 'input' | 'limit' | 'font' | 'pdf' | 'internal';

/** 誤りの名前と分けの表 */
const ERROR_TABLE: Record<ErrorCode, ErrorKind> = {
  'api/invalid-option': 'option',
  'input/xml-parse': 'input',
  'input/not-xsl-fo': 'input',
  'input/not-zip': 'input',
  'input/zip-entry': 'input',
  'input/not-epub': 'input',
  'area-tree/format': 'input',
  'limit/nesting-depth': 'limit',
  'limit/entity-expansion': 'limit',
  'limit/transform-nesting': 'limit',
  'limit/zip-size': 'limit',
  'limit/zip-entries': 'limit',
  'font/load-failed': 'font',
  'font/none-registered': 'font',
  'font/broken-file': 'font',
  'pdf/tagged-incompatible': 'pdf',
  'pdfua/requires-tagged': 'pdf',
  'pdfx/profile-required': 'pdf',
  'pdfx/profile-invalid': 'pdf',
  'pdfx/not-conforming': 'pdf',
  'pdfx/flatten-failed': 'pdf',
  'pdfa/not-conforming': 'pdf',
  'internal/patch-mismatch': 'internal',
  'internal/page-sealed': 'internal',
};

/** 診断の名前の一覧 (説明書との照らし合わせ用) */
export const DIAGNOSTIC_CODES: readonly DiagnosticCode[] = Object.keys(DIAGNOSTIC_TABLE) as DiagnosticCode[];
/** 誤りの名前の一覧 (説明書との照らし合わせ用) */
export const ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_TABLE) as ErrorCode[];

/** 診断の名前の重さ */
export function severityOf(code: DiagnosticCode): DiagnosticSeverity {
  return DIAGNOSTIC_TABLE[code];
}
/** 誤りの名前の分け */
export function errorKindOf(code: ErrorCode): ErrorKind {
  return ERROR_TABLE[code];
}

/** 診断・誤りの、文に埋めた値 (機械で読む用。名前ごとに決まった名前。説明書の一覧に書く) */
export type DiagnosticArgs = Record<string, string | number>;

/** 入力の場所 (分かるものだけ) */
export interface DiagnosticSource {
  /** 入力のファイル (TypesetOptions.name か files の名前。CSS ならシートの名前) */
  file?: string;
  /** 1 から数える行 */
  line?: number;
  /** 1 から数える列 */
  column?: number;
  /** 要素の手がかり (p#intro・fo:block など) */
  element?: string;
  /** Area Tree の sourceRef (組版の診断のとき) */
  sourceRef?: number;
  /** 0 から数えるページの番号 (組版・PDF の診断で分かるとき) */
  page?: number;
}

/** 組版の診断の 1 件 (TypesetResult.diagnostics) */
export interface Diagnostic {
  /** 種類の名前 (版をまたいで変えない) */
  code: DiagnosticCode;
  /** 重さ */
  severity: DiagnosticSeverity;
  /** 利用者に見せる文 (lang の言語)。文言は版で変わることがある */
  message: string;
  /** 文に埋めた値 */
  args?: DiagnosticArgs;
  /** 入力の場所 */
  source?: DiagnosticSource;
  /** 同じ診断 (名前・文・場所が同じ) をまとめた数。1 なら無い */
  count?: number;
}

/** 診断を作る (重さは名前の表から決める) */
export function diag(code: DiagnosticCode, message: string, args?: DiagnosticArgs, source?: DiagnosticSource): Diagnostic {
  const d: Diagnostic = { code, severity: DIAGNOSTIC_TABLE[code], message };
  if (args) d.args = args;
  if (source) d.source = source;
  return d;
}

/**
 * 名前ごとに残す診断の数の上限 (悪意のある文書で結果が膨らまないように)。超えた分は、残した診断に数えず、
 * 同じ名前の「ほかに n 件 (m 種)」の 1 件 (省いた分の診断。isOmittedDiagnostic) にまとめる
 */
export const MAX_DIAGNOSTICS_PER_CODE = 200;

const keyOf = (d: Diagnostic) => `${d.code}\u0000${d.message}\u0000${d.source ? JSON.stringify(d.source) : ''}`;

/**
 * 上限を超えて省いた分をまとめた診断か。args に omitted (省いた診断の数。同じ診断の繰り返しも数える) と
 * omittedKinds (省いた診断の種類の数。名前・文・場所の違うもの) を持つ
 */
export function isOmittedDiagnostic(d: Diagnostic): boolean {
  return typeof d.args?.omitted === 'number' && typeof d.args?.omittedKinds === 'number';
}

/** 省いた分をまとめた診断の文 (重さで「誤り・警告・知らせ」と呼ぶ) */
function omittedMessage(severity: DiagnosticSeverity, omitted: number, kinds: number): string {
  const ja = severity === 'error' ? '誤り' : severity === 'warning' ? '警告' : '知らせ';
  const en = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'notice';
  return msg(
    `同じ種類の${ja}がほかに ${omitted} 件 (${kinds} 種) あります (1 つの名前につき ${limits().diagnosticsPerCode} 件まで残します)`,
    `${omitted} more ${en}${omitted === 1 ? '' : 's'} of the same kind (${kinds} distinct) were omitted (up to ${limits().diagnosticsPerCode} are kept per code)`,
  );
}

/**
 * 診断を集める入れ物。同じ診断 (名前・文・場所が同じ) は 1 件にして数を数える。名前ごとに MAX_DIAGNOSTICS_PER_CODE 件まで残し、
 * 超えた分は、名前ごとに 1 件の省いた分の診断 (isOmittedDiagnostic) に数える (初めに超えた所に置く)。
 * list は足した順 (同じ診断は最初に現れた所)
 */
export class DiagnosticList {
  readonly list: Diagnostic[] = [];
  private byKey = new Map<string, Diagnostic>();
  private perCode = new Map<string, number>();
  /** 省いた分の診断と、省いた種類の鍵 (名前ごと)。merged は、ほかの入れ物で省かれて、足された種類の数 */
  private omittedOf = new Map<string, { d: Diagnostic; omitted: number; keys: Set<string>; merged: number }>();
  add(d: Diagnostic, n = d.count ?? 1): void {
    // ほかの入れ物で省いた分の診断 (組版の後に入れ物を移すとき): この入れ物の省いた分に足す
    if (isOmittedDiagnostic(d)) {
      const o = this.omitted(d);
      o.omitted += d.args!.omitted as number;
      o.merged += d.args!.omittedKinds as number;
      this.update(o);
      return;
    }
    const k = keyOf(d);
    const had = this.byKey.get(k);
    if (had) {
      had.count = (had.count ?? 1) + n;
      return;
    }
    const c = this.perCode.get(d.code) ?? 0;
    if (c >= limits().diagnosticsPerCode) {
      const o = this.omitted(d);
      o.omitted += n;
      o.keys.add(k);
      this.update(o);
      return;
    }
    const copy: Diagnostic = { ...d };
    if (n > 1) copy.count = n;
    else delete copy.count;
    this.list.push(copy);
    this.byKey.set(k, copy);
    this.perCode.set(d.code, c + 1);
  }
  addAll(ds: readonly Diagnostic[]): void {
    for (const d of ds) this.add(d);
  }
  /** 名前の省いた分の診断 (無ければ作って並びに置く) */
  private omitted(d: Diagnostic) {
    let o = this.omittedOf.get(d.code);
    if (!o) {
      o = { d: { code: d.code, severity: d.severity, message: '' }, omitted: 0, keys: new Set(), merged: 0 };
      this.omittedOf.set(d.code, o);
      this.list.push(o.d);
    }
    return o;
  }
  private update(o: { d: Diagnostic; omitted: number; keys: Set<string>; merged: number }): void {
    const kinds = o.keys.size + o.merged;
    o.d.args = { omitted: o.omitted, omittedKinds: kinds };
    o.d.message = omittedMessage(o.d.severity, o.omitted, kinds);
  }
}

/** 診断の並びを、同じものを 1 件にまとめた並びにする (DiagnosticList と同じ決まり) */
export function mergeDiagnostics(ds: readonly Diagnostic[]): Diagnostic[] {
  const l = new DiagnosticList();
  l.addAll(ds);
  return l.list;
}

/**
 * 数えた項目 (未対応・知らない指定) を、項目ごとの診断にする。並びは summarizeCounts と同じ (多い順、同じ数なら名前の順)
 */
export function countedDiagnostics(counts: Record<string, number> | undefined, make: (item: string) => Diagnostic): Diagnostic[] {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => (n > 1 ? { ...make(k), count: n } : make(k)));
}
