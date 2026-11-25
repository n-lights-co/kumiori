/**
 * Kumiori が投げる誤りの型。どれも code (diagnostics.ts の誤りの名前。診断と同じ体系) を持つ。
 * 名前 (code) と型は版をまたいで変えない約束で、一覧は docs/diagnostics.md にある。
 *
 *  - KumioriError: 基。中の誤り (pdf-lib・fontkit の差し替えが合わないなど。code は internal/…) と、使い方の順のエラー
 *    (dispose した組んだ結果を使ったなど。code は api/result-disposed) はこの型のまま
 *  - KumioriInputError: 入力を読めない (XML の解析・XSL-FO でない・壊れた zip・Area Tree の形)
 *  - KumioriLimitError: 上限を超えたので止めた (入れ子の深さ・実体の展開の大きさ・zip の大きさ)
 *  - KumioriFontError: 書体を読めない・1 つも無い
 *  - KumioriPdfError: PDF/X・PDF/A・PDF/UA の決まりに合わない・合わせられない
 *  - KumioriOptionError: 選択肢の誤り。前からの TypeError を継ぐ (instanceof TypeError で見ている利用者を壊さない) ので、
 *    KumioriError の下ではない。両方は isKumioriError で見分ける
 * Kumiori の外の思わぬ例外は、包まずにそのまま投げる (型とスタックが見えるほうが、不具合を調べやすい)
 */
import type { DiagnosticArgs, DiagnosticSource, ErrorCode } from './diagnostics';

/** 誤りの詳しいこと (省略できる) */
export interface KumioriErrorDetails {
  /** 文に埋めた値 */
  args?: DiagnosticArgs;
  /** 入力の場所 */
  source?: DiagnosticSource;
  /** もとの誤り */
  cause?: unknown;
}

/** Kumiori の誤りの基 */
export class KumioriError extends Error {
  // name は文字で決め打つ (クラスの名前 (new.target.name) から取ると、配るビルドで縮めた名前になる)。下の型も同じ
  override name = 'KumioriError';
  /** 誤りの名前 (版をまたいで変えない) */
  readonly code: ErrorCode;
  readonly args?: DiagnosticArgs;
  readonly source?: DiagnosticSource;
  constructor(code: ErrorCode, message: string, details: KumioriErrorDetails = {}) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.code = code;
    if (details.args) this.args = details.args;
    if (details.source) this.source = details.source;
  }
}

/** 入力を読めない */
export class KumioriInputError extends KumioriError {
  override name = 'KumioriInputError';
}
/** 上限を超えたので止めた */
export class KumioriLimitError extends KumioriError {
  override name = 'KumioriLimitError';
}
/** 書体を読めない・1 つも無い */
export class KumioriFontError extends KumioriError {
  override name = 'KumioriFontError';
}
/** PDF/X・PDF/A・PDF/UA の決まりに合わない・合わせられない */
export class KumioriPdfError extends KumioriError {
  override name = 'KumioriPdfError';
}

/** 選択肢の誤り (TypeError を継ぐ) */
export class KumioriOptionError extends TypeError {
  readonly code = 'api/invalid-option' as const;
  /** 誤った選択肢の名前 (分かるとき。pdfx.version・links.schemes のように、入れ子は . でつなぐ) */
  readonly option?: string;
  constructor(message: string, option?: string) {
    super(message);
    this.name = 'KumioriOptionError';
    if (option) this.option = option;
  }
}

/** Kumiori の誤りか (KumioriError と KumioriOptionError。どちらも code を持つ) */
export function isKumioriError(e: unknown): e is KumioriError | KumioriOptionError {
  return e instanceof KumioriError || e instanceof KumioriOptionError;
}
