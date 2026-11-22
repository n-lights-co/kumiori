# 診断 (警告の種類・重さ・場所) とエラーの型の設計の覚え書き

レビュー台帳の API-01 (警告が文の並びでしかない) と API-06 (エラーの型が公開されていない) の、調べと設計の覚え書きです (ブランチ `claude/api-01-06-diagnostics`)。
実装を main に入れるのは、利用者がこの設計を見て決めてからです。この覚え書きは、リリースする文書 (`docs/` など) ではありません。
調べたのは main の 9a3d768 の時点です。

利用者は 2026-11-20 に、2 の案のうち、名前は「段/中身」、重さは 3 段、未対応・知らない指定は名前ごとに 1 件、場所は取れる所はすべて
(画面の XSL-FO も Node と同じ読み方にする)、エラーの型は 2.5 の案 (思わぬ例外は包まない)、止める・格上げは 2.6 のとおり (直した決め)、コマンドは 2.7 の案、
一覧は src の表を正にして説明書に載せテストで照らす、実装は 3 回に分けて入れる、と決めました。

## 1. いまの仕組み (調べた結果)

### 1.1 文言の作り方

- 利用者に見せる文は、どれもその場で `msg('日本語', 'English')` (`src/messages.ts`) と対で書く。辞書のキーは無い。
  言語は `TypesetOptions.lang` (呼び出しの間だけ。`withMessageLang`)、コマンドは `--lang`・`KUMIORI_LANG`・ロケールで決める。
- `msg(` の呼び出しは `src` の全体で 501 か所ある。呼び出しの前後を見て、機械的に分けた数は次のとおり (目安):

  | 分け | 数 | 主な所 |
  |---|---|---|
  | 例外の文 (`throw`) | 約 120 | `api.ts` (選択肢の誤り 25・XML の解析)、`epub.ts`、`fontLoader.ts`・`fontManager.ts`、`pdfRenderer.ts` (PDF/X・A・UA に合わない)、`areaTree.ts`、内部で捕まえる画像の読み取り (`cgm.ts`・`ps*.ts`・`webp.ts`・`cff.ts`) |
  | 警告の文 (warnings に届く) | 約 330 | 下の 1.2 |
  | コマンドの出力 (`cli.ts`) | 40 | 使い方・誤りの文 |
  | 画面 (`main.ts`) | 13 | 状態の表示 |

- 警告の文のうち、ほぼ半分 (`this.miss(...)` の約 160 か所。`msg` を使わずに名前だけを渡す所も多い) は、1 つの文ではなく、
  「未対応の XSL-FO の要素・プロパティを無視しました: a (3)、b …ほか N 種」「未対応の CSS を無視しました: …」
  「知らない CSS のプロパティを無視しました (綴りの誤りか未対応): …」の 3 つの文の中の項目になる (`summarizeCounts`。多い順に 20 種まで)。
- 文の種類 (同じ雛形から作る文を 1 つと数える) は、ざっと次のとおり (雛形の数。数え方で上下する)。
  - 読み込み (HTML・XSL-FO・XHTML・EPUB の飛ばした項目): 約 30 (加えて、未対応・知らない指定の項目が、名前の数だけある)
  - 組版 (`layoutEngine.ts`): 約 40 (溢れる・収まらない・打ち切る・参照先が無い・画像を描けない…)
  - 画像の形式 (CGM・EMF/WMF・EPS/PostScript・WebP・draw.io): 約 90 (CGM 40・draw.io 24 が多い。画像ごとの `notes` で運ぶ)
  - 書体 (読めない・壊れている・字形が無い): 約 25
  - PDF の書き出しと PDF/X・A・UA の確かめ: 約 35
  - 入口 (`api.ts`。fetchImages で取らない画像・添付が無い・器の設定を文書ごとに渡した・リンクの動作を書かない): 約 12

### 1.2 警告の運び方

| 段 | 出し方 | まとめ方 |
|---|---|---|
| XSL-FO の読み込み (`xslfoImport.ts`) | `miss(名前, 数)` → `report.unsupported` に数える。`note(文)` → `report.notes` (同じ文は 1 度、200 個まで) | api が `summarizeCounts` で 1 つの文にする |
| HTML の読み込み (`htmlImport.ts`・`cssUnsupported.ts`) | `miss(名前)`・`unsupportedCssReport` → `report.unsupported`・`report.unknownCss`。用意の途中の警告は `warnings` | 同上 (未対応と知らないの 2 つの文) |
| 画像 (`assets.ts`・`imageFormats.ts`・各形式) | 形式ごとの読み取りが `notes`・`unsupported` を返し、組版が画像を置くときに「画像 X の一部を描けません: …」にする。プラグインは `ImageFormatResult.warnings` と `ImageFormatContext.warn` | 組版の警告と同じ |
| 書体 (`fontManager.ts`) | `fonts.onNotice`、読み込みの失敗の `catch` で `String(e.message)` | そのまま |
| 組版 (`layoutEngine.ts`) | `host.warn(文)` → `this.warnings`。組み直し (ページ数の収束・最終ページのマスター・脚注の繰り越し) のときは `warnings.length = mark` で巻き戻す。列ごとの組んだ結果を覚えて使い回すとき (`seqMemo`) は、その間の警告も覚えて足し直す | 終わりに `new Set` で同じ文を 1 つにし、`groupMissingIdWarnings` で見つからない id の文をまとめる → `AreaTree.warnings` |
| PDF の書き出し (`pdfRenderer.ts`) | `warn(文)` (同じ文は 1 度)。PDF/X・A・UA は `pdfx.warnings`・`pdfa.warnings`・`pdfua.warnings` に分けて出せる | 同じ文は 1 度 |
| 入口 (`api.ts`) | `warnings.push` | `[...読み込み, ...tree.warnings]`、toPdf の警告を後から足す |
| 画面 (`main.ts`) | 自前の読み込み (iframe でスタイルを確定させる) の警告 + `tree.warnings` | 同じ文を 1 つにして数を添え、多ければ畳む (`showWarnings`) |
| コマンド (`cli.ts`) | `res.warnings` と PDF/X などの警告を、標準エラーに「  警告: 文」で 1 行ずつ | — |

- 警告の文には、場所を文の中に書いているものがある (画像の `src`・id・ページの番号・書体の名前・字の符号)。ファイル・行・要素は、どこにも無い。
- 組版の警告の出し手 (`host.warn`) は、その時に組んでいる節 (`LNode`) を知っている所がほとんどだが、渡していない。

### 1.3 入力の場所を、どこまで取れるか

| 入力 | 読み取り | 取れるもの (確かめた) |
|---|---|---|
| XSL-FO (ライブラリ・コマンド) | `@xmldom/xmldom` 0.9 (`api.ts` の `xmlParse`。ブラウザ向けのライブラリでも同じ) | 要素と文字の節に `lineNumber`・`columnNumber`、属性の節に `lineNumber` が既に付いている (既定で locator が働く。足す手間は無い)。ただし、DOCTYPE の内部実体を先に展開している (`expandInternalEntities`) ので、改行を含む実体を使う文書では、その後の行がずれる |
| XSL-FO (画面) | ブラウザの `DOMParser` (`xslfoImport.ts` の `browserParse`) | 取れない。画面も xmldom で読めば取れる |
| HTML (Node・Web Worker) | linkedom (中は htmlparser2) | linkedom の節は場所を持たない。htmlparser2 の `Parser` は、要素を開くときに `startIndex`・`endIndex` (文字の位置) を持つので、`htmlParserStack.ts` と同じく Parser に手を入れて、要素 → 位置を WeakMap に覚えられる。位置から行・列へは、改行の位置の表で引く |
| HTML (ブラウザのライブラリ・画面) | ブラウザの `DOMParser`・iframe | 取れない (DOM に場所の情報が無い) |
| CSS | 自前の読み取り (`htmlPaged.ts` の `parseCss`) | いまは規則 (`StyleRule`) が場所を持たない。読み取りは文字の位置を進めて読むので、規則と宣言の始まりの位置を足せる。シートの名前 (ファイル名・`<style>` の何番目か) は、シートを読む所 (`htmlPrepare.ts`) が知っている |
| 組版の節 | `sourceRef` (`sourceRef.ts`。LDocument の節の通し番号。Area にも付く) | 入力の要素までは戻れない (読み込みが、L の節と要素の対応を残していない)。タグ付き PDF の構造の木 (`LDocument.structure`) は要素の名前を持つ |

### 1.4 エラーの型

- 中で定義している型は 17 ある: `AreaTreeFormatError` (公開)、`FontFileError`、`ZipLimitError`・`ZipEntryError`、`UsageError` (コマンド)、
  `PSError`・`FilterError`・`UnsupportedFilter`・`JpegError`・`Unsupported` (svg)・`SvgBudgetExceeded`・`TooLarge`・`OverBudget`・`Cff2BudgetError`・`ColorBudgetError`・`ReadBudgetError`・`LookupBudgetError`。
  後ろの 12 は、画像・書体の読み取りの中で投げて、中で捕まえる (警告か、その画像・書体を使わないことにする) もので、公開の API の外へは出ない。
- 公開の API (`typeset`・`typesetToPdf`・`createTypesetter`・`toPdf`・`renderPage`・`parseAreaTree`) から出るもの:
  - 選択肢の誤り: `TypeError` (「選択肢の誤り: …」。`optionError`。25 か所)
  - 入力の誤り: `Error` (XML の解析・内部実体の展開が大きすぎる・入れ子が深すぎる・fo:root が無い・XHTML の解析)
  - 書体: `Error` (「書体を読めません」「フォントが 1 つも登録されていません」)。壊れた書体ファイル (`FontFileError`) は、警告にしてその書体を使わない
  - PDF の規格: `Error` (PDF/X・A に合わない・平らにできない透明が残った・ICC プロファイルが要る・タグ付き PDF と X-1a・X-3 を合わせた)
  - 描くときの上限: `Error` (回転・変換の入れ子が深すぎる。`paint.ts`)
  - ページの番号: `RangeError` (`renderPage`)
  - Area Tree の読み取り: `AreaTreeFormatError`
  - 中の誤り: pdf-lib・fontkit の差し替えが合わない (`pdfLibPatches.ts`・`fontkitCffFlex.ts`) などの `Error`、ほかの思わぬ例外
- EPUB (`epub.ts`) は公開の API ではない (コマンドと画面だけ)。

## 2. 設計の案

### 2.1 TypesetResult に足すもの

```ts
/** 組版の診断 (警告・知らせ) の 1 件 */
export interface Diagnostic {
  /** 種類の名前 (2.2)。版をまたいで変えない */
  code: DiagnosticCode;
  /** 重さ (2.3) */
  severity: 'error' | 'warning' | 'info';
  /** 利用者に見せる文 (lang の言語)。文言は版で変わることがあるので、見分けには code を使う */
  message: string;
  /** 文に埋めた値 (機械で読む用。種類ごとに決まった名前: property・value・src・id・font・char・count・limit…) */
  args?: Record<string, string | number>;
  /** 入力の場所 (2.4)。分からなければ無い */
  source?: DiagnosticSource;
  /** 同じ診断 (code と args が同じ) をまとめた数。1 なら無い */
  count?: number;
}
export interface DiagnosticSource {
  /** 入力のファイル (TypesetOptions.name か files の名前。CSS ならシートの名前) */
  file?: string;
  /** 1 から数える行と列 (取れたときだけ) */
  line?: number;
  column?: number;
  /** 要素 (例: `p#intro`・`fo:block`。取れないときの手がかりにもなる) */
  element?: string;
  /** Area Tree の sourceRef (組版の警告のとき) */
  sourceRef?: number;
  /** 0 から数えるページの番号 (組版・PDF の警告で分かるとき) */
  page?: number;
}
interface TypesetResult {
  warnings: string[];          // いまのまま (文も並びもいまと同じ)
  diagnostics: Diagnostic[];   // 足す
}
```

- `warnings` はいまの文・並び・まとめ方のまま残す (互換を壊さない)。`diagnostics` は、同じ出来事を 1 件ずつ持つ。
  未対応・知らない CSS と未対応の XSL-FO は、いまは 1 つの文にまとめているが、`diagnostics` では名前ごとに 1 件にする
  (`args.property`・`count`。`warnings` の文は、その診断から、いまと同じ雛形で作る)。そのため、`warnings` と `diagnostics` は 1 対 1 ではない (選択肢 3)。
- `TypesetPdfResult` (`typesetToPdf`)・`toPdf` の後の `result.diagnostics` にも、PDF を書く途中の診断を足す (`warnings` と同じ扱い)。
  `pdfx.warnings`・`pdfa.warnings`・`pdfua.warnings` (別の並びに出す選択肢) は残し、`diagnostics` には、どこに出したかによらず全部を入れる。
- `AreaTree` にも `diagnostics?` を足す (無くても読める。足すだけなので、`AREA_TREE_SCHEMA_VERSION` を上げるかは実装のときに決める。
  タグ付き PDF の構造で 4 に上げる予定と重なるなら、一緒にする)。

### 2.2 種類の名前の付け方

- 案: 段と中身を `/` でつないだ、小文字とハイフンの名前にする (例)。
  - `css/unsupported-property`・`css/unsupported-value`・`css/unknown-property`・`css/ignored-rule`
  - `fo/unsupported-element`・`fo/unsupported-property`・`fo/unmatched-change-bar`・`fo/index-range-unclosed`
  - `html/attachment-not-found`・`html/link-action-dropped`
  - `image/not-found`・`image/unsupported`・`image/partial` (形式ごとの細かい中身は `args.detail` に入れ、形式の名前は `args.format`)・`image/not-fetched`
  - `font/load-failed`・`font/broken-file`・`font/missing-glyph`
  - `layout/line-overflow`・`layout/box-overflow`・`layout/footnote-overflow`・`layout/float-overflow`・`layout/height-cut`・`layout/page-count-not-converged`・`layout/missing-id` (page-number-citation・しおり・リンク)
  - `limit/nesting-depth`・`limit/table-columns`・`limit/generated-content` (上限で打ち切った。2.5 の上限のエラーと同じ名前の並び)
  - `pdf/glyph-not-drawn`・`pdf/form-field-failed`・`pdfx/transparency`・`pdfx/rasterized`・`pdfua/missing-title`・`pdfua/missing-alt`…
  - `api/setup-option-ignored`・`plugin/warning` (プラグインの出した警告。プラグインの名前を `args.plugin` に)
- 番号 (`KUMIORI-CSS-001`) にしないのは、名前だけで中身が分かり、検索・止める指定 (2.6) にそのまま書け、種類を足すときに番号の空きを気にしなくてよいため (選択肢 1)。
- 約束: 一度出した名前は、版をまたいで変えない・別の意味に使い回さない。やめるときは、一覧に「使わなくなった版」を書いて残す。
  文言 (`message`) は約束しない (直すことがある)。`args` の名前も、名前ごとに一覧に書き、変えない。
- 一覧は、コードの中の表 (`src/diagnostics.ts` に、名前・重さ・args の名前を並べる。型 `DiagnosticCode` はこの表から作るので、綴りの誤りは型の検査で落ちる) を正にし、
  説明書 `docs/diagnostics.md` (と英語版 `docs/en/diagnostics.md`) に、名前・重さ・意味・args・どうすれば消えるかを書く。
  テストで、表と説明書の名前が食い違わないことを確かめる (`test/thirdPartyNotices.test.ts` と同じやり方)。
- 種類の数は、雛形を 1 つずつ名前にすると 200 を超えるので、同じ意味の雛形 (「溢れます」の 4 か所など) は 1 つの名前にまとめ、細かい違いは `args` に入れて、
  100〜150 にする見込み。画像の形式の中の細かい描けないもの (CGM の 40 など) は、`image/partial` の `args.detail` にして、名前を増やさない。

### 2.3 重さ

- 3 段にする案 (選択肢 2)。
  - `error`: 出力から入力の中身が欠けた・変わった (組んだ PDF が、作成者の意図と見て分かるほど違う)。画像が見つからない・描けない (仮の枠)、字形が無い字 (豆腐)、
    行・箱・脚注・float がページに収まらずに溢れる、上限で打ち切った (50 ページの高さ・生成内容の字の数・数式の字の数)、行内の箱の中のブロックを省いた、PDF で描けない字。
  - `warning`: 指定を読まずに無視した・別の形で組んだ (未対応・知らない CSS と XSL-FO、互換の指定でだけ読む値、参照先の id が無い、リンクの動作を書かない、
    画像の一部を描けない、PDF/X で透明を画像にした、PDF/UA の要件 (題・言語・代わりの文) が足りない)。
  - `info`: 出力は意図どおりで、知っておくとよいこと (fetchImages で取らない画像、器の設定を文書ごとに渡した、ICC の表が読めず簡単な式で CMYK にした、
    PDF/X でリンク・注釈を書かなかった件数)。
- `error` でも例外にはしない (組版は最後まで行い、PDF は作る)。例外は 2.5 の型で投げるものだけ。
- いまの警告は、すべて `warning` か `error` か `info` のどれかに振り分ける。振り分けの一覧は、実装の最初のコミットで表 (`src/diagnostics.ts`) に書き、説明書に載せる。

### 2.4 入力の場所

- 案 (選択肢 4):
  - XSL-FO: xmldom の `lineNumber`・`columnNumber` を、読み込み (`xslfoImport.ts`) が、L の節を作るときに、L の節 → 場所の WeakMap に覚える
    (`sourceRef.ts` の REFS と同じく、列挙しない形にして、文書の木を写す所に響かないようにする)。`miss`・`note` も、いま読んでいる要素の場所を受け取る。
    画面も、`browserParse` をやめて xmldom で読むと、同じ場所が取れる。内部実体の展開で行がずれる件は、展開の前後の行の対応の表を作って直す
    (改行を含む実体が無ければ表は空)。
  - HTML: Node と Web Worker (linkedom) では、htmlparser2 の Parser に手を入れて (`htmlParserStack.ts` と同じ所で、`onopentag` の前に `startIndex` を読む)、要素 → 文字の位置を覚え、
    改行の位置の表で行・列にする。ブラウザの `DOMParser`・画面の iframe では行・列は取れないので、要素の手がかり (`element`: 名前・id・class の最初の 1 つ) と
    `sourceRef` だけにする。
  - CSS: `parseCss` が、規則と宣言の始まりの文字の位置を持ち、シートを読む所がシートの名前を渡す。知らない・未対応のプロパティの診断は、CSS のファイルと行を指す
    (`style` 属性なら、その要素の場所)。同じ名前の診断は 1 件にまとめ (`count`)、場所は最初に現れた所にする。
  - 組版: `host.warn(文)` を `host.warn(診断, 節?)` にし、組んでいる節を渡す。節から、`sourceRef` と、読み込みが覚えた入力の場所を引く。
    ページの番号は、組版の途中では決まらないことがある (組み直し) ので、ページを作り終えた所で分かるものだけ付ける。
  - PDF の書き出し: ページの番号を付ける (描いているページ)。
- 場所を集める手間を気にする利用者向けに、`TypesetOptions.sourceLocations: false` で止められるようにするかは、測ってから決める (2.8)。

### 2.5 公開するエラーの型

```ts
/** Kumiori が投げる誤りの基 (code は診断と同じ名前の並び) */
export class KumioriError extends Error {
  readonly code: string;
  readonly source?: DiagnosticSource;
  readonly args?: Record<string, string | number>;
}
export class KumioriInputError extends KumioriError {}   // 入力を読めない: XML・XHTML の解析、fo:root が無い、内部実体が深い・大きい
export class KumioriLimitError extends KumioriError {}   // 上限を超えたので止めた: 入れ子の深さ (FO・描くときの回転)、展開の大きさ
export class KumioriFontError extends KumioriError {}    // 書体を読めない・1 つも無い (壊れた書体ファイル FontFileError もこの下にする)
export class KumioriPdfError extends KumioriError {}     // PDF/X・A・UA に合わない・平らにできない透明・ICC プロファイルが要る (code は pdfx/… など)
/** 選択肢の誤り。いまの TypeError を継いだまま code を持つ (instanceof TypeError で見ている利用者を壊さない) */
export class KumioriOptionError extends TypeError { readonly code = 'api/invalid-option'; readonly option: string; }
/** Kumiori の誤りか (KumioriError と KumioriOptionError の両方。どちらも code を持つ) */
export function isKumioriError(e: unknown): e is KumioriError | KumioriOptionError;
```

- `AreaTreeFormatError` は `KumioriInputError` の下にする (名前と、いまの公開は残す。code は `area-tree/format`)。
- `renderPage` のページの番号の誤りは、いまの `RangeError` のままにする (呼び出し方の誤りで、ほかの言語の配列の添字と同じ扱い)。
- 中の誤り (pdf-lib・fontkit の差し替えが合わない) は `KumioriError` の code `internal/…` にする。思わぬ例外 (Kumiori の外の型) を入口で包むかは選択肢 5。
  包まない案を勧める (スタックと型がそのまま見えるほうが、不具合の報告に役立つ。包むなら `cause` に元の例外を入れる)。
- 型の名前・code は、診断と同じく版をまたいで変えない約束にし、説明書の同じ一覧に載せる。
- EPUB (`ZipLimitError`・`ZipEntryError`) は、公開の API に EPUB を入れるときに `KumioriLimitError`・`KumioriInputError` の下にする (いまは中だけ)。

### 2.6 止める・格上げする

- 利用者が決めた (2026-11-20。一度「入れない」と決めた後、「止める指定は、ユーザーが指定した時は止めて欲しい」「両方お願いします」で直した)。
  - 出さない指定: ライブラリの `TypesetOptions.diagnostics.ignore` (名前の配列。warnings と diagnostics の両方から除く) と、コマンドの `--ignore-warning`。
    知らない名前は止めずに `api/unknown-diagnostic-code` で知らせる。
  - 誤りへの格上げ: コマンドの `--fail-on error|warning` だけ (PDF は書いた上で終了コード 2。出さない診断は数えない)。ライブラリには入れない
    (利用者は `result.diagnostics` の `severity` を見て判断できる)。

### 2.7 画面・コマンドでの出し方

- コマンド: いまの「  警告: 文」を「  警告 [css/unknown-property] style.css:12:3: 文」の形にする (場所が無ければ省く。重さで「誤り」「警告」「知らせ」と書き分ける)。
  `--diagnostics json` で、標準エラーに 1 件 1 行の JSON (JSON Lines) を出す (標準出力は `-o -` の PDF に使うので避ける)。
  `info` は既定では出さず、`--verbose` で出す。
- 画面: 警告の欄に、重さの印と名前を添え、場所 (要素・ページ) があれば出す。ページの番号があれば、押してそのページへ移る。
  画面の読み込みは iframe なので、行・列は出ない。

### 2.8 速さ・大きさへの影響 (見込み。実装で測る)

- 診断を作るのは警告が出るときだけで、警告の無い文書の手間は増えない。
- XSL-FO の行・列は xmldom が既に数えているので、増えるのは L の節 → 場所の WeakMap への登録 (要素の数だけ) だけ。
- HTML の行・列は、要素ごとの WeakMap への登録と、改行の位置の表 (文書の長さに比例。1 度だけ)。htmlparser2 の読み取りの数 % と見込む。
  大きな文書 (`test/` の長い文書・conformance) で測り、目立つなら場所を集めるのを、診断が出たときに読み直して探す形 (2 度目の読み取りは警告があるときだけ) に変える。
- 結果の大きさ: 診断は、同じ名前と args のものを 1 件にまとめて数える (`count`)。名前ごとに件数の上限 (例えば 200。超えた分は数だけ) を置き、悪意のある文書で膨らまないようにする。

### 2.9 段階 2 の進め方 (案)

1. 仕組み: `src/diagnostics.ts` (名前の表・`Diagnostic`・まとめ方)、出し手の書き換え (文はいまのまま、名前・重さ・args を足す)、`TypesetResult.diagnostics`、エラーの型、
   `docs/diagnostics.md` (と英語版) とテスト。場所は `sourceRef`・ページ・要素の手がかりだけ。
2. 場所: XSL-FO の行・列 (画面も xmldom に)、HTML の行・列 (linkedom の所)、CSS の規則の行。速さを測る。
3. 出し方: コマンド (`[名前]`・場所・`--diagnostics json`・`--verbose`) と画面。README (日本語・英語) を直す。

どれも `warnings` の文と並びは変えないので、いまのテスト (警告の文を見る所が 99 ファイル・約 540 か所) はそのまま通るはず。各段で、`diagnostics` のテストを足す。
