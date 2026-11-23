# 同じバイトの PDF とページラベルの設計の覚え書き

0.6.0 の「PDF の出力の足し」の束のうち、2 つの設計の覚え書きです。コードはまだ変えていません。
6. の決めは、利用者がすべて推奨のとおりに決めた (2026-11-22)。本文の案は、その決めのとおり。

- 同じ入力から同じバイトの PDF を作る (作成日・更新日を渡せるようにし、ほかに毎回変わる所を止める)。
- PDF のページラベル (`/PageLabels`。ISO 32000-1 §12.4.2) を、組版のページ番号の書式から書く。

この覚え書きは、リリースする文書 (`docs/` など) ではありません。

## 1. 同じバイトの PDF

### 1.1 毎回変わる所 (調べた結果)

`docs/conformance/fo/kumiori-xsl-fo.fo` (85 ページ) を、`dist-cli` で 2 度ずつ組んで比べた。

| 止めたもの | ふつうの PDF | `--pdfa 3b --pdfua` |
|---|---|---|
| 時計と乱数 (`scripts/compare-base-freeze.mjs`) | 同じバイト | 同じバイト |
| 時計だけ | 58 バイト違う: trailer の `/ID` だけ | 128 バイト違う: `/ID` と XMP の `xmpMM:DocumentID`・`InstanceID` |

コードを読んで見つけた、毎回変わる所の一覧:

| 所 | いまの値 | 出る所 | 止める作り (1.3) |
|---|---|---|---|
| `src/pdfRenderer.ts` の `PDFDocument.create()` | pdf-lib の既定 (`updateMetadata`) で、Info の `CreationDate`・`ModDate` を今の時刻にする | ふつうの PDF の Info | 渡した日付で書き直す |
| `src/pdfStandard.ts` の `markPdfStandard` の `now` | 今の時刻 (秒にそろえる) | PDF/X・PDF/A・PDF/UA の Info と XMP (`xmp:CreateDate`・`ModifyDate`・`MetadataDate`) | 渡した日付 |
| `src/pdfRenderer.ts` の添付 (`EmbeddedFile` の `Params` の `ModDate`) | `new Date()` | PDF/A-3 の添付 | 渡した日付 |
| `src/pdfStandard.ts` の文書の ID | `crypto.getRandomValues` (16 バイト) | trailer の `/ID`・XMP の `DocumentID`・`InstanceID` | 中身から作る (1.3) |
| `src/pdfRenderer.ts` の、ID の無いときの文書の ID | 同じく乱数 | trailer の `/ID` (ふつうの PDF) | 同じ |
| `src/psCff.ts` の Type 2 の字形の手続きの `random` (escape 23) | `Math.random()` | その演算を使う PS の書体の字形 (まれ) | 決まった種の乱数 |
| `src/psInterp.ts` の `realtime` | `Date.now()` | EPS が時刻で描き分けたとき (まれ) | 手続きの歩数から作る (`usertime` と同じ作り) |

毎回変わらないことを確かめたもの:

- 部分書体の名前の接頭辞: `subsetTag(n)` (n 番目の部分書体の順の番号から作る 6 字) と、pdf-lib の `addRandomSuffix` (PDFContext の乱数。種が 1 に決まっている) なので、毎回同じ。
- PostScript の `rand`: 種 (`randSeed`) が決まっている。SVG の `feTurbulence`: 種は属性から。
- Map・Set の順: JavaScript では入れた順。画像を取る順 (取得の終わる順) が埋め込みの順に出ないことは、2 度組んで同じだったこと (上の表) で確かめた
  (取得の多い文書では、作る段の試験で見る)。
- 組版の時間 (`layoutMs`) は、PDF には書かない。

入力の側で変わるもの (この変更では止めない。説明書に書く): Google Fonts から取る既定の書体 (版が変われば変わる。`--font-dir`・書体のキャッシュで止まる)、
http(s) で取る画像・CSS、`Producer` の版 (いまは版を書いていないので、Kumiori の版を上げても変わらない)。

### 1.2 API の形

- `PdfOptions` (`TypesetResult.toPdf`・`typesetToPdf`・器 (`createTypesetter`) の `typesetToPdf` が受ける PDF の設定) に、`date?: Date` を足す。
  - PDF の作成日・更新日 (Info の `CreationDate`・`ModDate`、XMP の `xmp:CreateDate`・`ModifyDate`・`MetadataDate`) と、添付の `ModDate` に、この日時を書く。
  - 秒より下は切り捨てる (いまの `now` と同じ。Info の日付の書き方 (ISO 32000-1 §7.9.4) は秒まで)。UTC で書く (いまと同じ `Z`)。
  - 無ければ、いまと同じく組んだ時刻。正しくない `Date` (`NaN`) は、`TypeError` で投げる (ほかの選択肢の誤りと同じ扱い)。
  - 器の作るときの設定 (`TypesetterOptions`) には足さない (日付は文書ごとのもの)。
- ライブラリは `SOURCE_DATE_EPOCH` を読まない (ブラウザでも同じ動きにし、環境変数で黙って結果が変わらないように)。
- コマンド (`src/cli.ts`) は、環境変数 `SOURCE_DATE_EPOCH` (reproducible-builds.org の決まり: 1970-01-01 UTC からの秒の 10 進の整数) を読んで `date` に渡す。
  - 正しくない値 (空・整数でない・負) は、その決まりに従い、誤りとして終了コード 1 で終わる。
  - 複数の入力・`--watch` でも、同じ日時を使う。
  - 選択肢 `--date` は足さない (6. の決め 2)。
- 説明書: `docs/library.md`・`docs/cli.md` (と英語版) に、`date`・`SOURCE_DATE_EPOCH` と、同じバイトになる条件 (同じ版・同じ書体・同じ入力・同じ選択肢) を書く。

### 1.3 止める作り

- 日付: `renderPdf` の初めに `const date = opts.date ? 秒に切った Date : 秒に切った今` を 1 度だけ作り、
  `setDocumentInfo` で `setCreationDate`・`setModificationDate` に、`markPdfStandard` の `now` の代わりに、添付の `ModDate` に渡す。
  Info と XMP の日付が同じ値になる決まり (PDF/A は ISO 19005-2 §6.6.3、PDF/X-4 は ISO 15930-7 §6.10.2) は、同じ 1 つの値を使うので、いまのまま守られる。
  PDF/X の Info の `CreationDate`・`ModDate` が要る決まりも、いまと同じく書く。
- 文書の ID (ISO 32000-1 §14.4 は、作るたびに違う値を勧めるが、作り方は決めていない。§14.4 の例は、時刻・ファイルの場所・大きさ・Info の値の MD5):
  乱数をやめ、書き出した PDF の中身から作る。
  1. ID の代わりに、決まった 32 字の 16 進 (印の値) を trailer の `/ID` と XMP の `DocumentID`・`InstanceID` に書いて、`pdf.save()` する。
  2. できたバイト列の SHA-256 の初めの 16 バイトを ID にし、バイト列の中の印の値 (trailer の 2 つ・XMP の 2 つ) を、同じ長さの ID で書き換える。
     trailer の辞書 (相互参照の流れの辞書も) と XMP の流れ (圧縮しない) は、どちらも平文なので、長さを変えずに書き換えられる。印の値が予定の数だけ見つからなければ、誤りとして投げる (試験で見張る)。
  - 日付を渡さないときも、この作りにする (6. の決め 1)。日付が変われば中身が変わり、ID も変わるので、「作るたびに違う」のは時刻の分で保たれる。
  - PDF/X・PDF/A の検査 (`pdfxVerify`・`pdfaVerify`) は、書き換えた後のバイト列を読み直して調べる (いまと同じ所で調べる)。
- `psCff.ts` の `random`: 字形ごとに、決まった種 (例: 0x9e3779b9) から始める xorshift の乱数にする (Adobe の Type 2 Charstring Format (Technical Note #5177) の `random` は、0 より大きく 1 以下の値を返すとだけ決めている)。
- `psInterp.ts` の `realtime`: PLRM の `realtime` は、暦の時刻と関わりの無い、ミリ秒の数え上げの値なので、手続きの歩数 (`steps`) から作る (`usertime` と同じ)。

## 2. ページラベル

### 2.1 書くもの

カタログの `/PageLabels` (数の木。ISO 32000-1 §7.9.7・§12.4.2)。木は、葉を分けず、根の `/Nums` に `[ページの順の番号 (0 から) ラベルの辞書 …]` を並べる。
ラベルの辞書 (§12.4.2 の表) は、`/S` (書式。`D` 10 進・`R` 大文字のローマ数字・`r` 小文字のローマ数字・`A` 大文字の英字・`a` 小文字の英字。無ければ番号を出さない)、
`/P` (接頭辞。テキスト文字列)、`/St` (範囲の初めのページの番号。1 以上。無ければ 1)。

ページラベルは「そのページで `fo:page-number`・`counter(page)` が出す番号の字」とする。

### 2.2 どこで書式を取るか

- 番号の数: `PageArea.pageNumber` (initial-page-number・`counter-reset: page`・`counter-set: page` を反映したもの) が、いまもある。
- 書式: `LPageSequence.pageNumberFormat` (XSL-FO は `xslfoImport.ts` で page-sequence の `format` (と grouping-separator・grouping-size)、
  CSS は `htmlImport.ts` で、ページの組の余白の箱の初めの `counter(page, <型>)` の型を `pageNumberFormatOf` で書式にしたもの)。
  組版は、ページを作るときの `PageBuild.seq.pageNumberFormat` を `formatPageNumber` に渡して、余白の箱のノンブル・目次の参照を組んでいる。同じ値を使えば、紙面と同じになる。
- 領域の木への載せ方: `PageArea` に `pageNumberFormat?: string` を足し、`layoutEngine.ts` の `PageArea` を作る所 (`p.seq.pageNumberFormat`) で、10 進 (`'1'`・無し) でないときだけ書く。
  - 領域の木は外に見せる形 (`docs/area-tree.md`。日英) なので、そこに足す。
  - 10 進の文書の領域の木は変わらない。書式のあるページの指紋だけが変わる (6. の決め 3)。
- `pdfRenderer.ts` は、シートの順に `(pageNumber, pageNumberFormat)` を見て、範囲に分ける。

### 2.3 範囲の分け方 (前付けと本文)

- 次のどれかで、新しい範囲を始める: 書式 (PDF の型に直したもの) が前のページと違う、番号が前のページの番号 + 1 でない、型に直せないページ (2.4)。
  - 例: 前付けの page-sequence (`format="i"`) の 3 ページと、本文 (`initial-page-number="1"`) → `/Nums [0 <</S /r>> 3 <</S /D>>]`。
  - page-sequence が変わっても、書式が同じで番号が続いていれば、1 つの範囲にまとめる。
- `/St` は 1 のときは書かない。
- 結果が「0 ページ目から 1 つの範囲、`/S /D`、`/St` 1」(ビューアの既定と同じ) なら、`/PageLabels` を書かない (6. の決め 4)。
  10 進で番号を振り直さない文書の PDF は、いまと同じバイトになる。

### 2.4 書式の対応

| 書式 (`formatPageNumber` のトークン) | PDF の型 | 条件 |
|---|---|---|
| `1` (と、知らないトークン) | `D` | 番号が 1 以上。桁区切り (grouping) があるときは、範囲の番号が 1000 より小さいとき |
| `i` / `I` | `r` / `R` | 範囲の番号が 1〜3999 (`roman` が 10 進に戻す範囲の外は、型に直せない) |
| `a` / `A` | `a` / `A` | PDF の書き方と字が同じ番号 (1〜27。28 から先は、PDF は BB・CC…、XSLT の書式は ab・ac… で違う。§12.4.2 の表)。作る段では、どの書式も「PDF の書き方で出る字が紙面の字と同じか」を確かめて決める |
| `01` (0 埋め)・`１` (全角)・`一` (漢数字)・`Ⅰ` `ⅰ` (ローマ数字の字)・`①` (丸数字) | 無し | 型に直せない |
| 番号が 0 以下 (initial-page-number="0" など) | 無し | `/St` は 1 以上なので、型に直せない |

- 型に直せないページは、ページごとに 1 つの範囲にし、`/S` を書かずに、紙面と同じ字 (`formatPageNumber` の結果の番号の部分) を `/P` に書く (6. の決め 5)。
  ビューアは、紙面と同じ字 (「三」「①」「01」) を出し、その字でページへ飛べる。500 ページの漢数字の文書で、30 バイトほど × 500。
- 書式の前後の字 (`- 1 -` の `- ` と ` -`) は、ラベルに入れない (番号の部分だけ。6. の決め 6)。PDF のラベルには後ろに付ける字が無く、入れると型に直せる書式もページごとの `/P` になるため。
  `fo:folio-prefix`・`fo:folio-suffix` (XSL 1.1 §6.6.10) は、いまは索引の番号にだけ使っているので、ラベルにも入れない。
- `/P` の字はテキスト文字列 (`pdfStandard.ts` の `pdfText`: ASCII でなければ UTF-16BE)。

### 2.5 タグ付き PDF・PDF/A・PDF/X

- `/PageLabels` はカタログの項で、構造の木・印の付いた内容とは関わらない。タグ付き PDF・PDF/UA-1 (ISO 14289-1) に、決まりの追加は無い。
- PDF/A-2・3 (ISO 19005-2・3)、PDF/X-1a・X-3・X-4 も、`/PageLabels` を止めていない (PDF 1.3 からのもの)。XMP には何も書かない。
- `pdfaVerify`・`pdfxVerify` に足す検査は無い。veraPDF (PDF/UA-1) で、落ちる規則が変わらないことを確かめる。

## 3. 試験の案

- 同じバイト (`test/` に足す):
  - `typesetToPdf` を `date` 付きで 2 度呼び、同じバイトになる (ふつうの PDF・`pdfa` + `pdfua` + 添付・`pdfx` X-4 の 3 つ)。間に時計が進むよう、2 度目の前に少し待つ。
  - `date` の日付が Info・XMP・添付の `ModDate` に出る。trailer の `/ID` の 2 つと XMP の `DocumentID`・`InstanceID` が同じ値で、中身の違う文書では違う。
  - コマンドを `SOURCE_DATE_EPOCH=1700000000` で 2 度動かし、同じバイトになる。`pdfinfo` の `CreationDate` がその日時。正しくない値で終了コード 1。
  - PS の書体で Type 2 の `random` を使う字形・EPS の `realtime` は、小さな手作りの入力で、2 度で同じになることを見る。
- ページラベル:
  - 範囲に分ける関数 (ページの `(番号, 書式)` の並び → `/Nums`) の単体の試験: 前付け i〜iii と本文 1〜、10 進の通し (書かない)、
    `initial-page-number` の振り直し、a の 27 ページ目、漢数字・丸数字 (ページごとの `/P`)、0 以下、桁区切り。
  - XSL-FO と CSS (`counter(page, lower-roman)` と `counter-reset: page 1`) の小さな文書を組み、PDF を pdf-lib で読み直して `/PageLabels` を見る。
    Poppler の `pdfinfo` はラベルを出さないので、`pdftotext` などではなく、pdf-lib で読む (ほかの道具は要らない)。
  - 領域の木の指紋: `pageNumberFormat` を書いたページの指紋が変わる。変わる文書を一覧にして、コミットの文に書く。
- 組み比べ (`npm run compare:base`): 日付と乱数を止めて組む道具なので、前と後の PDF のバイト列を比べられる。
  - 文書の ID の作りを変えたコミットでは、すべての PDF のバイトが変わる (印の値と中身の SHA-256 になる) が、絵と字は変わらないことを確かめる。
  - ページラベルのコミットでは、バイトの変わる PDF が、10 進でない書式か番号の振り直しのある文書だけになることを確かめ、その数を数える。
    リポジトリの文書では、`docs/conformance/fo/kumiori-xsl-fo.fo`・`.en.fo`・`docs/conformance/html/kumiori-html-css.html`・`.en.html`・`e2e/fixtures/basic.fo` が、
    `initial-page-number`・`format`・`counter-reset: page`・`counter(page, …)` を使っている (この 5 つと、見本の中の使う文書が変わる見込み)。
  - `scripts/compare-base-freeze.mjs` の時計の止めは、前のコミット (日付の選択肢の無い版) を組むために残す。止めの説明に、`date`・`SOURCE_DATE_EPOCH` で止まることを足す。
- タグ付き PDF: `--tagged --pdfua` で組んだ PDF を `node scripts/verapdf.mjs` にかけ、落ちる規則が前と変わらないこと、`pdfinfo -struct-text` の構造の木が変わらないことを見る。

## 4. 大きさとコミットの分け方

大きさは小 (src で 250〜350 行、試験で 200 行ほど)。作る段のコミット:

1. 日付の選択肢: `PdfOptions.date`、Info・XMP・添付の日付、コマンドの `SOURCE_DATE_EPOCH`、説明書 (日英)、変更の記録、試験。
2. 毎回変わる所を止める: 文書の ID を中身から作る、Type 2 の `random`・`realtime`、2 度組んで同じバイトの試験。compare:base で、絵と字が変わらないことを確かめる。
3. ページラベル: `PageArea.pageNumberFormat` (と `docs/area-tree.md` 日英)、範囲に分ける関数、`/PageLabels`、試験、指紋の書き直し、説明書・変更の記録。
   compare:base で、変わる文書を数える。

1 と 2 は `pdfRenderer.ts`・`pdfStandard.ts` の同じ所を触る。束 L8 (PDF を画像として貼る) も `pdfRenderer.ts` を触るが、場所 (画像の埋め込み) が違うので、ぶつかるのは import の行くらいの見込み。
async の関数に `await` を足すときは `rejoin(thisCall(), await …)` の形にする (2 の印の値の書き換えは `pdf.save()` の後の同期の処理なので、await は増えない)。

## 5. 作る段で確かめること

- 印の値の書き換えで、trailer の `/ID` が相互参照の流れの辞書に平文で出ること (いまの出力で確かめた: `/Type /XRef` の辞書に `/ID [ <…> <…> ]`)。
  オブジェクトの流れ (`useObjectStreams`) を切った PDF/X-1a でも同じかを見る。
- `docs/conformance` の XSL-FO 編・HTML と CSS 編の PDF を、Acrobat などのビューアでなく pdf.js (ブラウザの PDF ビューア) でも開いて、ページラベルが出ること (手で見る)。

## 6. 決めたこと (2026-11-22、利用者がすべて推奨のとおりに決めた)

決めたものを **太字** に、ほかの候補を残す。

1. 文書の ID の作り
   - **(決めた)** 日付の有無によらず、いつも中身の SHA-256 から作る (乱数を使わない。同じ中身なら同じ ID)。
   - `date` を渡したときだけ中身から作り、渡さないときは乱数のまま。
   - `documentId` の選択肢を足して、渡させる。
2. コマンドの日付の渡し方
   - **(決めた)** `SOURCE_DATE_EPOCH` だけ (reproducible-builds.org の決まりどおり。選択肢を増やさない)。
   - 加えて `--date <ISO 8601 の日時>` を足す (環境変数より優先)。
3. ページラベルの書式を領域の木にどう載せるか
   - **(決めた)** `PageArea.pageNumberFormat` (10 進でないページだけに書く)。書式のあるページの指紋だけが変わる。
   - `AreaTree.pageLabels` (範囲の一覧を木の外側に)。書式のある文書の「ページの外の欄」の指紋が変わる (どのページかは分からない)。
4. 10 進の通しの文書
   - **(決めた)** `/PageLabels` を書かない (ビューアの既定と同じなので。いまと同じバイト)。
   - いつも書く (すべての PDF が変わる)。
5. PDF の型に無い書式 (漢数字・丸数字・全角・0 埋めなど)
   - **(決めた)** ページごとの範囲にし、`/P` に紙面の字を書く (ビューアが紙面と同じ字を出す)。
   - 近い型で書く (全角・0 埋めは `D`、`Ⅰ` は `R` など。漢数字・丸数字は `D`)。字は違うが、範囲は少ない。
   - ラベルを書かない (その範囲は番号を出さない)。
6. 書式の前後の字 (`- 1 -` の `-`)
   - **(決めた)** ラベルに入れない (番号の部分だけ)。
   - 前の字は `/P` に入れ、後ろの字があればページごとの `/P` にする (紙面と同じ字)。
