# 入力の上限を選択肢で変える設計の覚え書き

状態: 作った (2026-11-22。作る段の 5 回のコミットで main に入れた。8 節の決めは、どれも推奨の案に決まった)。

利用者の決め (2026-11-22):

- 上限は、**下げるのはどれも**。**上げるのは時間・大きさの上限だけ** (ページ数・画素の数・ファイルの大きさ・手間の予算など)。
  入れ子の深さ・再帰の段の数など、落ちない (スタックを使い切らない) ための上限は上げられない。
- **既定の値は変えない**。選択肢を渡さなければ、前と同じに動き、組版の結果も同じ。
- ライブラリの `options.limits` と、コマンドの選択肢で変えられるようにする。

前提にしたもの:

- 器 (`createTypesetter`) の使い回し (`design/relayout.md` の 7 節。main の 398151a・c30b2c2) は main に入っている。
  器が文書をまたいで覚えるのは、`@font-face` の書体のファイルの下ごしらえ (WOFF2 の展開など) と、段落の行分け (`SHARED_LINE_MEMO_ATOMS` = 100 万まで)。
- 同じ波の束 L1 (途中で止める `AbortSignal`・進み具合 `onProgress`・呼び出しごとの言語の文脈) も、`TypesetOptions` と `checkOptions` (src/api.ts) に足す。
  ぶつかる所は 7 節にまとめた。

---

## 1. 上限の棚卸し

`src` の決め打ちの上限を集めた (2026-11-22 の main。`grep -E "const [A-Z_]*(MAX|LIMIT|BUDGET)"` と、`LIMITS = {…}`・`fetchLimits`・`EpsLimits`・名前に MAX の無い予算を手で足したもの)。
draw.io の JavaScript の形 (`src/drawio/drawioJs/`) の 15 個と、画面 (`src/main.ts`) の表示の数は、表の後に別にまとめた。

列の意味:

- **種類**: 「時間・大きさ」= 手間・メモリ・ファイルの大きさ・数を縛るもの / 「落ちない」= 入れ子の深さ・再帰の段で、スタックを使い切らないためのもの /
  「指数」= 段の数で手間が指数で増えるので、深さで縛っているもの (落ちないの扱いにする) / 「仕様」= 規格・形式の決まりから決まる値 (変える意味が無い) /
  「内部」= 覚えの大きさ・精度・描き方の切り替えで、入力の上限ではないもの
- **公開**: この設計で `limits` の名前を付けるか (2 節の名前)。「—」は公開しない
- **上げる**: 可 = 上げ下げできる / 下 = 下げるだけ / — = 公開しない
- **説明書**: L = docs/library.md、C = docs/cli.md の「上限とメモリ」、無印は書いていない (README には上限の値は無い。SECURITY.md は L・C を指すだけ)
- **診断**: 超えたときに出るもの。「(画像)」は、読めない画像として扱い、画像の読み込みの診断 (`image/unsupported` など、読む所の診断) になるもの。
  「黙って」は診断を出さずに切る・近似するもの。「要確認」は、この覚え書きでは確かめきれなかったもの (作る段で確かめ、診断が無ければ足すかを決める)

### 1.1 画像・ファイル・取得

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| imageLimits.ts | `MAX_PIXELS` | 1 億画素 | 1 枚の画像の画素 (RGBA で 400MB) | 時間・大きさ | `imagePixels` | 可 | C | (画像) |
| imageLimits.ts | `PS_TOTAL_IMAGE_PIXELS` (= MAX_PIXELS) | 1 億画素 | 1 つの EPS の画像の合計 | 時間・大きさ | `imagePixels` に連動 | 可 | — | EPS の limitcheck (画像) |
| imageLimits.ts | `PS_IMAGE_MAX_PIXELS` | 6,400 万画素 | PS の image 1 枚 | 時間・大きさ | `epsImagePixels` | 可 | — | EPS の limitcheck |
| imageLimits.ts | `METAFILE_TOTAL_IMAGE_PIXELS` | 6,400 万画素 | WMF・EMF・CGM の画像の合計 | 時間・大きさ | `metafileImagePixels` | 可 (天井 1 億: SVG の文字列の長さ) | C | (画像) |
| imageLimits.ts | `METAFILE_FREE_PIXELS`・`_PIXELS_PER_BYTE` | 26 万・1,024/バイト | ファイルの大きさによる画素の縛り | 仕様 (符号の密度) | — | — | C | (画像) |
| imageLimits.ts | `GIF_*`・`VP8_*`・`VP8L_*`・`JPEG_*`・`CCITT_*`・`BMP_RLE_*` | 形式ごと | ファイルの大きさによる画素の縛り | 仕様 (符号の密度) | — | — | C | (画像) |
| imageLimits.ts | `DEFLATE_MAX_RATIO` | 1,032 倍 | PNG・WOFF の展開の比 | 仕様 (RFC 1951) | — | — | C | (画像)・書体 |
| imageLimits.ts | `WEBFONT_MAX_SFNT_BYTES`・`WEBFONT_MAX_RATIO` | 128MB・100 倍 + 1MB | WOFF・WOFF2 を戻した書体 | 時間・大きさ / 比は仕様に近い | `fontBytes` (大きさだけ) | 可 | C | `font/file-unreadable` (要確認) |
| imageLimits.ts | `fetchLimits.imageBytes` | 256MB | 取る画像 1 件 | 時間・大きさ | `fileBytes` | 可 | L | `resource/fetch-failed` (要確認) |
| imageLimits.ts | `fetchLimits.cssBytes` | 16MB | 取る CSS 1 件 | 時間・大きさ | `cssBytes` | 可 | L | `resource/fetch-failed` (要確認) |
| imageLimits.ts | `fetchLimits.fontBytes` | 128MB | 取る書体 1 件 | 時間・大きさ | `fontBytes` | 可 | L | `resource/fetch-failed` (要確認) |
| imageLimits.ts | `fetchLimits.redirects` | 20 回 | 転送をたどる回数 | 仕様 (Fetch Standard §4.5) | `redirects` | 下 | L | `resource/fetch-failed` |
| assets.ts | `MAX_FILE_BYTES` | 256MB | 渡したファイル 1 つ (展開後も) | 時間・大きさ | `fileBytes` | 可 | — | (画像) |
| assets.ts | `TIFF_MAX_IFDS` | 256 | TIFF のページの数 | 時間・大きさ | — | — | — | (画像) |
| fontLoader.ts | `COLLECTION_MAX_BYTES` | 1GB | TTC・OTC から取り出す合計 | 時間・大きさ | `fontCollectionBytes` | 可 | — | `font/file-unreadable` (TTC の合計が大きすぎる、の文) |
| documentResources.ts | `IMAGE_FETCH_BUDGET` | 取得の時限 × 10 (既定 5 分) | 文書の画像の取得の全体の時限 | 時間・大きさ | `imageFetchTotalMs` | 可 | — | `resource/fetch-failed` (要確認) |
| resources.ts | `MAX_REFS` | 500 | 集める CSS・書体の参照の数 | 時間・大きさ | `styleRefs` | 可 | — | `limit/reached` |
| resources.ts | `MAX_DEPTH` | 8 | @import の段 | 落ちない (輪) | `importDepth` | 下 | — | `limit/reached` |
| htmlPrepare.ts | `MAX_IMPORTED_CSS_LENGTH` | 8MB | @import で広げた CSS の長さ | 時間・大きさ | `importedCssChars` | 可 | — | `limit/css-import` |
| htmlPrepare.ts | `MAX_IMPORTS` | 10,000 | @import の数 | 時間・大きさ | `cssImports` | 可 | — | `limit/css-import` |
| imageFormats.ts | `FORMAT_MAX_SIZE` | 1,000 万 px | プラグイン・draw.io の結果の大きさ | 時間・大きさ (座標が有限) | `formatSize` | 可 (天井 1e9) | L | `image/invalid-size` |
| imageFormats.ts | `FORMAT_SVG_FREE_CHARS`・`_PER_BYTE`・`FORMAT_MAX_SVG_CHARS` | 32M 字 + 128 字/バイト、最大 128M 字 | プラグインの結果の SVG の長さ | 時間・大きさ | `formatSvgChars` (絶対の上限だけ) | 可 (天井 5 億字: V8 の文字列) | L | (画像) |
| imageFormats.ts | `formatLoadTimeoutMs` | 60 秒 + 取得の時限 × 3 | プラグインの load の時限 | 時間・大きさ | `formatLoadMs` (60 秒の部分) | 可 | L | `image/timeout` |
| imageFormats.ts | `MAX_FORMAT_FRAGMENTS` | 64 | 1 つのファイルを違う `#` で読む数 | 時間・大きさ | `formatFragments` | 可 | L | `image/too-many-fragments` |
| pdfImage.ts | (後から足した上限。design/pdf-as-image.md の 4 節) | 100 万 | 1 つの PDF の画像のオブジェクトの数 | 時間・大きさ | `pdfImageObjects` | 可 | L | `image/pdf-invalid`・`limit/reached` |
| pdfImage.ts | (同) | 10 万 | 1 つの PDF の画像のページの数 | 時間・大きさ | `pdfImagePages` | 可 | L | `image/pdf-invalid`・`limit/reached` |
| pdfImage.ts | (同) | 64 | PDF の画像のページの木・資源の入れ子の深さ | 落ちない | `pdfImageDepth` | 下 | L | `image/pdf-invalid`・`limit/reached` |
| pdfImage.ts | (同) | 256MB | PDF の画像の 1 ページで圧縮を解く流れの合計 | 時間・大きさ | `pdfImageStreamBytes` | 可 | L | `image/pdf-invalid`・`limit/reached` |
| pdfImage.ts | (同) | 60 秒 | 1 つの PDF の画像の読み込みの時限 | 時間・大きさ | `pdfImageLoadMs` | 可 | L | `image/pdf-invalid`・`limit/reached` |
| jpeg.ts | `MAX_SCANS`・`MAX_BLOCK_VISITS_PER_BLOCK` | 500・64 | 漸進の JPEG の走査 | 仕様に近い (正当な JPEG の数十倍) | — | — | — | (画像) |
| ccitt.ts | `MAX_CODE` | 13 | 符号の長さ | 仕様 (T.4) | — | — | — | — |

### 1.2 EPS・メタファイル・EPUB

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| epsInfo.ts | `EPS_DOCUMENT_MILLIS` | 60 秒 | 1 つの文書の EPS の実行の合計 | 時間・大きさ | `epsDocumentMs` | 可 | C | (画像) |
| eps.ts | `maxMillis` の既定 | 20 秒 | 1 つの EPS の実行 | 時間・大きさ | `epsMs` | 可 | — | (画像) |
| imageLimits.ts | `PS_MAX_VM_BYTES` | 512MB | EPS の VM | 時間・大きさ | `epsMemoryBytes` に連動 | 可 | — | VMerror (画像) |
| imageLimits.ts | `PS_MAX_MEMORY_BYTES` | 512MB | EPS のメモリの合計 | 時間・大きさ | `epsMemoryBytes` | 可 | — | VMerror (画像) |
| imageLimits.ts | `PS_MAX_PATH_POINTS` | 500 万 | EPS のパスの点 | 時間・大きさ | `epsPathPoints` | 可 | — | limitcheck (画像) |
| imageLimits.ts | `PS_FILTER_MAX_BYTES` | 16MB | EPS のフィルタの読みため | 時間・大きさ | — | — | — | limitcheck |
| imageLimits.ts | `PS_MAX_SVG_CHARS` | 128M 字 | EPS を SVG にした長さ | 時間・大きさ | `epsSvgChars` | 可 (天井 5 億字) | — | (画像) |
| psInterp.ts | `MAX_STRING_TOKEN`・`MAX_LEN` | 64MB・65535 × 16 | PS の文字列・配列の長さ | 時間・大きさ (PLRM 付録 B の 16 倍) | — | — | — | limitcheck |
| psGraphics.ts | `MAX_CLIP_DEPTH` | 1,000 | PS のクリップの入れ子 | 落ちない | — | — | — | limitcheck |
| psGraphics.ts | `MAX_DEVICEN_COMPONENTS` | 32 | DeviceN の成分 | 仕様に近い | — | — | — | limitcheck |
| psGraphics.ts | `MAX_DRAW_COST` | 20 万 | 描く手間 | 時間・大きさ | — (`epsPathPoints` と別にしない) | — | — | 要確認 |
| psShading.ts・psOpsState.ts・psOpsFont.ts | `MAX_FUNCTIONS`・`MAX_DASH`・`MAX_CMAP_ENTRIES` | 32・1,024・20 万 | PS の配列の長さ | 仕様に近い | — | — | — | limitcheck |
| imageLimits.ts | `METAFILE_SVG_FREE_CHARS`・`_PER_BYTE` | 2M 字 + 128 字/バイト | メタファイルの SVG の長さ | 仕様 (記録の密度) | — | — | C | 警告 (要確認) |
| imageLimits.ts | `METAFILE_MAX_SVG_CHARS` (= PS_MAX_SVG_CHARS) | 128M 字 | 同じ、絶対の上限 | 時間・大きさ | `epsSvgChars` に連動 | 可 | — | 同上 |
| imageLimits.ts | `METAFILE_REGION_WORK`・`METAFILE_CLIP_PATH_WORK` | 5,000 万・100 万点 | 切り抜きの演算の手間 | 時間・大きさ | `metafileClipWork` (両方を同じ倍率で) | 可 | — | 警告 (要確認) |
| imageLimits.ts | `EPUB_MAX_ENTRY_BYTES` | 256MB | EPUB の 1 項目 | 時間・大きさ | `fileBytes` に連動 | 可 | — | `limit/zip-size` |
| imageLimits.ts | `EPUB_MAX_TOTAL_BYTES` | 1GB | EPUB の展開の合計 | 時間・大きさ | `epubTotalBytes` | 可 | — | `limit/zip-size` |
| imageLimits.ts | `EPUB_MAX_ENTRIES` | 65,535 | EPUB の項目の数 | 仕様 (ZIP64 を読まない) | `epubEntries` | 下 | — | `limit/zip-entries` |
| epub.ts | `EPUB_MAX_TEXT_CHARS` | 2^27 字 | 章の HTML の合計 | 時間・大きさ | `epubTextChars` | 可 (天井 5 億字) | — | 要確認 |

### 1.3 文書の木・CSS・XML

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| htmlPrepare.ts | `MAX_TREE_DEPTH` | 128 | HTML の要素の入れ子 | 落ちない・指数 | `nestingDepth` | 下 | — | `limit/nesting-depth` |
| xslfoImport.ts | `MAX_FO_NEST` | 250 | FO の要素の入れ子 | 落ちない | `nestingDepth` | 下 | — | `limit/nesting-depth` (誤り) |
| svg.ts | `SVG_MAX_NEST` | 250 | SVG の入れ子 | 落ちない | `nestingDepth` | 下 | — | (画像) |
| mathLayout.ts・foMathFallback.ts | `MAX_MATH_NEST` | 300 | MathML の入れ子 | 落ちない | `nestingDepth` | 下 | — | 要確認 |
| mathLayout.ts | `MAX_MATH_DEPTH` | 100 | 添え字の段 (倍率) | 落ちない (数の範囲) | `nestingDepth` | 下 | — | 要確認 |
| drawio/drawioXml.ts | `MAX_DEPTH` | 256 | draw.io の XML の入れ子 | 落ちない | `nestingDepth` | 下 | — | (画像) |
| paint.ts | `MAX_NESTED_ORIENTATIONS` | 300 | 変換・回転の入れ子 | 落ちない | `nestingDepth` | 下 | — | `limit/transform-nesting` (誤り) |
| xmlParse.ts | `ENTITY_MAX_DEPTH` | 8 | 内部実体の入れ子 | 指数 | `entityDepth` | 下 | — | `limit/entity-expansion` (誤り) |
| xmlParse.ts | `ENTITY_MAX_GROWTH`・`ENTITY_MAX_ADDED` | 16 倍・2^27 字 | 実体の展開の長さ | 時間・大きさ | `entityChars` (ADDED だけ) | 可 (天井 5 億字) | — | `limit/entity-expansion` (誤り) |
| htmlPaged.ts | `MAX_CSS_NESTING` | 64 | CSS の規則の入れ子 | 落ちない | `cssNesting` | 下 | — | 要確認 |
| htmlPaged.ts | `MAX_LAYER_DEPTH` | 32 | @layer の名前の段 | 落ちない | `cssNesting` | 下 | — | 要確認 |
| htmlPaged.ts | `MAX_NESTED_SELECTORS` | 10,000 | 入れ子を展開したセレクタ | 時間・大きさ | `nestedSelectors` | 可 | — | `limit/reached` |
| htmlPaged.ts・svg.ts | `MAX_VAR_LENGTH`・`SVG_MAX_VAR_LENGTH` | 2MB | var() を置き換えた値 | 仕様に近い (Chromium と同じ) | — | — | — | 黙って (無効の値) |
| cssCascade.ts | `MAX_CALC_DEPTH`・`MAX_MATH_NEST` | 64・32 | calc() の入れ子 | 落ちない | `cssNesting` | 下 | — | 黙って (無効の値) |
| svg.ts | `CALC_MAX_DEPTH` | 32 | SVG の calc() | 落ちない | `cssNesting` | 下 | — | 黙って |
| cssSelector.ts | `MAX_SELECTOR_NESTING` | 32 | :is() などの入れ子 | 落ちない | `cssNesting` | 下 | — | 黙って (無効のセレクタ) |
| cssSelector.ts | `MAX_BACKTRACK_COMPOUNDS` | 64 | 戻りのある照合の複合の数 | 指数 | — | — | — | 黙って |
| cssSelector.ts | `BT_MEMO_BUDGET` | 3,000 万 | セレクタの照合の覚え | 時間・大きさ | `selectorWork` | 可 | — | 黙って (要確認) |
| counterStyle.ts | `MAX_COUNTER_LENGTH` | 1,000 字 | 数の表記の長さ | 仕様 (CSS Counter Styles §… に「実装が決める」) | — | — | — | 黙って (代わりの書式) |
| bidi.ts | `MAX_DEPTH` | 125 | 双方向の埋め込みの段 | 仕様 (UAX #9 の max_depth) | — | — | — | 黙って |
| diagnostics.ts | `MAX_DIAGNOSTICS_PER_CODE` | 200 | 同じ名前の診断の数 | 時間・大きさ | `diagnosticsPerCode` | 可 | — | 「ほかに n 件」にまとめる |

### 1.4 組版 (行・表・数式・グリッド)

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| htmlImport.ts・xslfoImport.ts | `MAX_TABLE_COLUMNS` | 1,000 | 表の列の数 | 時間・大きさ | `tableColumns` | 可 | — | `limit/table-columns` |
| htmlImport.ts | `MAX_COL_SPAN` | 1,000 | `<col span>` | 時間・大きさ (HTML の仕様も 1,000) | `tableColumns` に連動 | 可 | — | `limit/reached` (HTML の仕様の上限 1,000 より下げたときだけ) |
| htmlImport.ts | `MAX_ROW_SPAN` | 65,534 | rowspan | 仕様 (HTML の仕様の 65534) | — | — | — | `limit/table-row-span` |
| tableLimits.ts | `MAX_SPANNED_SLOTS` | 2 万マス | 表の構造のマス | 時間・大きさ | `tableSpannedCells` | 可 | — | `limit/table-structure-cells` |
| xslfoImport.ts | `MAX_LIFTED_SPAN_PIECES` | 2 万 | 持ち上げた span の断片 | 時間・大きさ | — (`nestingDepth` と組で効く) | — | — | 要確認 |
| inlineLayout.ts | `MAX_LEADER_REPEATS` | 2 万 | 1 つのリーダーの字の数 | 時間・大きさ | `leaderRepeats` | 可 | — | `limit/reached` |
| inlineLayout.ts | `PRETTY_MAX_TRIALS`・`PRETTY_TOTAL_FIT_MAX_LINES` | 200・100 行 | text-wrap: pretty の試し | 時間・大きさ (組版の結果が変わる) | — | — | — | 黙って |
| inlineLayout.ts | `BALANCE_MAX_LINES` | 10 行 | text-wrap: balance | 仕様 (CSS Text 4 §5.4 が許す) | — | — | — | 黙って |
| inlineLayout.ts | `TF_MAX_BADNESS`・`GLYPH_POOL_MAX` | 1 万・65,536 | 悪さの値・字の覚え | 内部 | — | — | — | — |
| hyphenation.ts | `MAX_HYPHENATE_WORD` | 128 字 | ハイフンで切る語の長さ | 時間・大きさ (結果が変わる) | — | — | — | 黙って |
| measurer.ts | `MAX_CLUSTER_SEARCH` | 32 字 | 書体を選ぶクラスタの長さ | 内部 | — | — | — | — |
| mathLayout.ts | `MAX_MATH_GLYPHS` | 2 万 | 1 つの数式の字 | 時間・大きさ | `mathGlyphs` | 可 | — | `css/unsupported`・`fo/unsupported` (数式の字の数が上限を超えた、の項目) |
| mathLayout.ts | `MAX_EXTENDER_REPEATS`・`MAX_DASHES` | 1,000・1 万 | 伸ばす字の部品・破線の切れ端 | 時間・大きさ | — | — | — | 黙って |
| gridTracks.ts | `MAX_GRID_REPEAT` | 1 万 | repeat() の列の数 | 時間・大きさ | `gridTracks` | 可 | — | `limit/reached` |
| gridTracks.ts | `MAX_TRACK_PT`・`PLAN_MEMO_MAX` | 1e7 pt・16 | 列の幅の範囲・覚え | 内部 | — | — | — | — |
| layoutEngine.ts | `MAX_CONTENT_ROOT`・`CONTINUATION_*` | 1e7・3 / 50 | 測る行の長さ・続きのページの守り | 内部 (止まらないための守り。大きさに合わせて決まる) | — | — | — | `layout/continuation-dropped` |
| paint.ts | `MAX_BORDER_MARKS` | 2 万 | 罫の点・破線の印 | 時間・大きさ | — | — | — | 黙って |
| pdfTags.ts | `LINK_DESCRIPTION_MAX` | 2,000 字 | リンクの代わりの文 | 仕様に近い (PDF/A の文字列の長さ) | — | — | — | `limit/link-description` |

### 1.5 SVG・書体の中身

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| svg.ts | `MAX_EXPANDED_VISITS` | 50 万 | use で広げた要素 | 時間・大きさ | `svgElements` | 可 | — | (画像) |
| svg.ts | `MAX_EXPANDED_SEGS`・`EXPANDED_SEGS_PER_CHAR` | 500 万・2/字 | 広げたパスの区間 | 時間・大きさ | `svgPathSegments` (絶対の上限だけ) | 可 | — | (画像) |
| svg.ts | `CSS_MAX_MATCHES` | 50 万 | SVG の中の CSS の照合 | 時間・大きさ | `svgCssMatches` | 可 | — | (画像) |
| svg.ts | `MAX_SPREAD_STOPS` | 10 万 | 繰り返しのグラデーションの stop | 時間・大きさ | — | — | — | 黙って |
| svg.ts | `MAX_PATTERN_NEST` | 8 | pattern の入れ子 | 落ちない (輪) | — | — | — | 黙って |
| svg.ts | `SVG_FONT_MAX_LIGATURE` | 64 字 | SVG 書体の合字 | 内部 | — | — | — | — |
| svgRenderer.ts・pdfLibPatches.ts | `SVG_NUM_MAX`・`PDF_REAL_MAX` | 3.4e38 | 数の範囲 | 仕様 (PDF の実数) | — | — | — | — |
| svgRenderer.ts | `TILED_SIZES_MAX` | 8 | タイルの大きさごとの画像 | 内部 | — | — | — | — |
| pdfRenderer.ts | `SVG_MAX_LINKS_PER_PAGE` | 5,000 | 1 ページの SVG のリンク | 時間・大きさ | `svgLinksPerPage` | 可 | — | `pdf/svg-links-capped` |
| pdfRenderer.ts | `VERTICAL_MAX_TIGHTEN` | 20 | 縦書きの TJ の詰め | 内部 | — | — | — | — |
| fontSanity.ts | `MAX_GLYPH_POINTS` | 65,535 | 字形の点 | 仕様 (TrueType) | — | — | — | `font/repaired` (要確認) |
| fontSanity.ts | `MAX_COMPONENT_DEPTH`・`MAX_LOOKUP_NESTING` | 64・64 | 合成字形・lookup の入れ子 | 落ちない (HarfBuzz と同じ) | — | — | — | `font/repaired` (要確認) |
| fontSanity.ts | `MAX_LOOKUP_CALLS` | 35,000 | lookup の呼び出し | 時間・大きさ | — | — | — | 同上 |
| colorGlyph.ts | `MAX_PAINT_DEPTH`・`MAX_PAINTS` | 64・2 万 | COLR v1 の描画の木 | 落ちない・指数 | — | — | — | `font/color-glyph-too-complex` |
| cff2Instancer.ts | `MAX_STACK`・`MAX_SUBR_DEPTH` | 513・10 | CFF2 | 仕様 (CFF2) | — | — | — | `font/cff2-not-converted` |

書体の中身の上限は、書体の作り手の誤り・悪意を防ぐもので、文書の作り手が上げ下げしたい場面が見当たらないので公開しない (5 節の断りに書く)。

### 1.6 描く (PNG・画面・PDF の平らにする処理)

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pageRaster.ts | `PNG_MAX_PIXELS` | 4,000 万画素 | 1 枚の PNG | 時間・大きさ | `pngPixels` | 可 (天井 2.6 億: 板のバイト列 4GB) | C | 誤り (コマンドは `--dpi` の誤り) |
| pageRaster.ts | `PNG_IMAGE_CACHE_PIXELS` (= MAX_PIXELS) | 1 億画素 | 覚える画像 | 時間・大きさ | `pngImageCachePixels` | 可 | C | — (戻し直す) |
| pageRaster.ts | `PNG_PAGE_DECODE_PIXELS` | 4 億画素 | 1 ページで戻す画像 | 時間・大きさ | `pngPageImagePixels` | 可 | C | `png/image-limit` |
| pageRaster.ts | `PNG_RASTER_WORK_PER_PIXEL`・`PNG_RASTER_BASE_WORK` | 128/画素 + 6,400 万 | 1 ページを画素にする手間 | 時間・大きさ | `pngRasterWork` (倍率: 1 = 既定) | 可 | C | `png/raster-budget` |
| pageRaster.ts | `PNG_TILE_CACHE_PIXELS` | 1,600 万画素 | 模様のタイルの覚え | 時間・大きさ | — (`pngImageCachePixels` と別にしない) | — | C | — |
| pageRaster.ts | `PNG_LAYER_PIXELS_PER_PAGE`・`_MAX_PIXELS`・`_MIN_PIXELS` | 8 倍・6,400 万・1,600 万 | 同時に持つ板 | 時間・大きさ | `pngLayerPixels` (絶対の上限) | 可 | C | `png/layer-limit`・`png/clip-limit` |
| pageRaster.ts | `FAILED_MAX` | 1,024 | 戻せなかった鍵の覚え | 内部 | — | — | — | — |
| canvasRenderer.ts | `SVG_RASTER_MAX_PIXELS` | 1,600 万画素 | 画面で画素にする SVG | 時間・大きさ | `canvasSvgPixels` | 可 | L | 黙って (解像度を下げる) |
| canvasRenderer.ts | `SVG_RASTER_BUDGET` | 80 億 | 1 回の描画の手間 | 時間・大きさ | `canvasSvgWork` | 可 | L | `canvas/svg-not-drawn` |
| canvasRenderer.ts | `SVG_IMAGE_PREPARE_MAX_PIXELS` | 400 万画素 | 画面の下ごしらえ | 時間・大きさ | — | — | L | 黙って |
| svgFilterRaster.ts | `MAX_PIXELS`・`BUDGET`・`MAX_LIVE_PIXELS` | 400 万・4 億・2,400 万 | SVG の filter を画素で計算 | 時間・大きさ | `svgFilterWork` (BUDGET だけ) | 可 | — | 黙って / (画像) |
| pdfFlatten.ts | `FLATTEN_MAX_PIXELS` | 3,600 万画素 | PDF/X で平らにする画像 | 時間・大きさ | `flattenPixels` | 可 | — | 黙って (解像度を下げる) |

### 1.7 draw.io

| ファイル | 名前 | 値 | 守るもの | 種類 | 公開 | 上げる | 説明書 | 診断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| drawio/drawio.ts | `LIMITS.inflated` | 64MB | 圧縮した図を戻した長さ | 時間・大きさ | `drawioChars` | 可 | — | (画像)・警告 |
| drawio/drawio.ts | `LIMITS.cells` | 2 万 | セルの数 | 時間・大きさ | `drawioCells` | 可 | — | 警告 |
| drawio/drawio.ts | `LIMITS.points`・`label`・`labelTotal` | 2,000・10 万・200 万字 | 線の点・ラベルの長さ | 時間・大きさ | `drawioLabelChars` (labelTotal だけ) | 可 | — | 警告 |
| drawio/drawio.ts | `LIMITS.svgChars`・`svgWork` | 16M・32M 字 | 図を SVG にした長さ | 時間・大きさ | `drawioSvgChars` (svgWork は 2 倍に連動) | 可 | — | 警告 |
| drawio/drawio.ts | `LIMITS.size`・`coord` | 1,000 万 px | 図の大きさ・座標 | 時間・大きさ (`FORMAT_MAX_SIZE` と組) | `formatSize` に連動 | 可 | — | 警告 |
| drawio/drawioXml.ts | `MAX_NODES` | 20 万 | XML の要素 | 時間・大きさ | `drawioCells` に連動 (10 倍) | 可 | — | (画像) |
| drawio/drawioStencil.ts | `LIMITS.inflated`・`nodes`・`ops` | 64MB・400 万・200 万 | 図形ライブラリ | 時間・大きさ | — (図形ライブラリは利用者が選んで渡すもの) | — | — | 警告 |
| drawio/drawioStencil.ts | `LIMITS.depth` | 8 | include-shape の入れ子 | 落ちない | — | — | — | 警告 |
| drawio/load.ts | `MAX_BUNDLE_IMAGES`・`MAX_REMOTE_IMAGES` | 200・200 | 図の中で取る画像 | 時間・大きさ | `drawioImages` (両方) | 可 | — | 警告 |
| drawio/drawioEdges.ts | `MAX_LINE_JUMPS` | 1,000 | 線の跳び越し | 時間・大きさ | — | — | — | 黙って |
| drawio/drawioText.ts | `CACHE_MAX` | 2 万 | 幅の覚え | 内部 | — | — | — | — |
| drawio/drawioSketch.ts・drawioTapered.ts | `MAX_FILL_*`・`SKETCH_MAX_SIZE`・`MAX_SEGMENTS`・`MAX_ELEMENTS`・`MAX_LOOP_POINTS` | — | 手書き風・先細の形 | 内部 (draw.io の値を写したもの。変えると draw.io と違う絵になる) | — | — | — | 黙って |

`src/drawio/drawioJs/` の 15 個 (`MAX_ICONS`・`MAX_LINES`・`MAX_STRIPES`・`MAX_TICKS`・`MAX_DAYS`・`MAX_REPEAT`・`MAX_WEDGE_STEPS`・`MAX_MARKERS` など) は、
JavaScript で描く形の繰り返しの数を縛るもので、形 1 つの手間は `drawioSvgChars` で縛られるので公開しない (内部)。
`src/main.ts` の `WARNINGS_OPEN_MAX`・`WARNINGS_LIST_MAX` は画面の表示の数で、上限ではない。

### 1.8 数

- 集めた上限: **約 150 個** (名前の付いた定数と `LIMITS` の項。drawioJs の 15 個・画面の 2 個を含む)。
- 種類の内訳 (およそ): 時間・大きさ 約 95 / 落ちない・指数 約 25 / 仕様 約 20 / 内部 約 15。
- 公開する名前: **56 個** (2 節)。うち上げ下げできるもの 50、下げるだけのもの 6 (`nestingDepth`・`cssNesting`・`entityDepth`・`importDepth`・`redirects`・`epubEntries`)。
  1 つの名前が、組になった内部の定数をまとめて動かすことがある (`nestingDepth` は 7 つの入れ子の上限、`imagePixels` は 3 つ)。
- いまある上限の選択肢: `TypesetOptions.fetchTimeoutMs` (取得の時限) だけ。内部には `EpsLimits` (eps.ts。`maxMillis`・`maxVM`・`maxMemory`・`maxSvgChars` など) があり、`epsToSvg` の引数で受けているが、公開の API からは渡せない。
- 全体のページ数の上限は、いまは無い (本文の後に脚注・float の続きのために足すページの守り `ContinuationGuard` だけ。8 節の決め 7)。

---

## 2. 公開する API の形

### 2.1 型

`src/limits.ts` (新しいファイル) に置き、`kumiori` と `kumiori/browser` から型を出す。

```ts
/**
 * 入力の上限 (小さな入力で時間とメモリを使い切らせないためのもの)。渡さない名前は既定の値。
 * 時間・大きさの上限は上げ下げでき、入れ子の深さの上限 (下げるだけと書いたもの) は下げることだけができる。
 * 値は 1 以上の整数 (…Ms はミリ秒、…Bytes はバイト、…Pixels は画素、…Chars は字、ほかは数)。
 * 上げると、その分だけ時間とメモリを多く使いうる (SECURITY.md の「上限」の項)
 */
export interface KumioriLimits {
  // 画像・ファイル・取得
  /** 1 枚の画像の画素の数 (既定 1 億)。EPS の画像の合計にも同じ値を当てる */
  imagePixels?: number;
  /** 渡したファイル 1 つ・取る画像 1 件・EPUB の 1 項目の大きさ (既定 256MB) */
  fileBytes?: number;
  /** 取る CSS 1 件の大きさ (既定 16MB) */
  cssBytes?: number;
  /** 取る書体 1 件・WOFF を戻した書体の大きさ (既定 128MB) */
  fontBytes?: number;
  /** 書体の集まり (TTC・OTC) から取り出す合計 (既定 1GB) */
  fontCollectionBytes?: number;
  /** 文書の画像の取得の全体の時限 (既定は fetchTimeoutMs の 10 倍) */
  imageFetchTotalMs?: number;
  /** 転送をたどる回数 (既定 20。下げるだけ) */
  redirects?: number;
  /** 集める CSS・書体の参照の数 (既定 500) */
  styleRefs?: number;
  /** @import の段 (既定 8。下げるだけ) */
  importDepth?: number;
  /** @import で広げた CSS の長さ (既定 8M 字) */
  importedCssChars?: number;
  /** @import の数 (既定 1 万) */
  cssImports?: number;
  // プラグイン・draw.io の結果
  formatSize?: number;          // 既定 1,000 万 px
  formatSvgChars?: number;      // 既定 1 億 3,421 万字 (絶対の上限。ファイルの大きさによる縛りは変えない)
  formatLoadMs?: number;        // 既定 60 秒 (これに取得の時限の 3 倍を足す)
  formatFragments?: number;     // 既定 64
  // EPS・メタファイル・EPUB
  epsMs?: number;               // 1 つの EPS (既定 20 秒)
  epsDocumentMs?: number;       // 文書の EPS の合計 (既定 60 秒)
  epsMemoryBytes?: number;      // 既定 512MB (VM の上限も同じ値)
  epsPathPoints?: number;       // 既定 500 万
  epsImagePixels?: number;      // 既定 6,400 万
  epsSvgChars?: number;         // 既定 128M 字 (メタファイルの SVG の絶対の上限も同じ値)
  metafileImagePixels?: number; // 既定 6,400 万
  metafileClipWork?: number;    // 切り抜きの領域の演算の手間 (既定 5,000 万。パスの切り抜きの 100 万点も同じ比で動かす。8 節の決め 4)
  epubTotalBytes?: number;      // 既定 1GB
  epubEntries?: number;         // 既定 65,535 (下げるだけ)
  epubTextChars?: number;       // 既定 2^27 字
  // 文書の木・CSS・XML (入れ子は下げるだけ)
  nestingDepth?: number;        // 既定 300 (種類ごとの既定のうち最も大きい値)。HTML・FO・SVG・MathML・draw.io・変換の入れ子は min(種類ごとの既定, この値)
  cssNesting?: number;          // 既定 64 (CSS の規則)。@layer・calc()・セレクタの入れ子は min(既存の上限, この値)
  entityDepth?: number;         // 既定 8
  entityChars?: number;         // 既定 2^27 字
  nestedSelectors?: number;     // 既定 1 万
  selectorWork?: number;        // 既定 3,000 万
  diagnosticsPerCode?: number;  // 既定 200
  // 組版
  tableColumns?: number;        // 既定 1,000 (col の span も)
  tableSpannedCells?: number;   // 既定 2 万
  leaderRepeats?: number;       // 既定 2 万
  mathGlyphs?: number;          // 既定 2 万
  gridTracks?: number;          // 既定 1 万
  // SVG
  svgElements?: number;         // 既定 50 万
  svgPathSegments?: number;     // 既定 500 万
  svgCssMatches?: number;       // 既定 50 万
  svgFilterWork?: number;       // 既定 4 億
  svgLinksPerPage?: number;     // 既定 5,000
  // 描く
  pngPixels?: number;           // 既定 4,000 万
  pngImageCachePixels?: number; // 既定 1 億
  pngPageImagePixels?: number;  // 既定 4 億
  pngRasterWork?: number;       // 1 画素あたりの手間 (既定 128。基本の 6,400 万も同じ比で動かす)
  pngLayerPixels?: number;      // 既定 6,400 万
  canvasSvgPixels?: number;     // 既定 1,600 万
  canvasSvgWork?: number;       // 既定 80 億
  flattenPixels?: number;       // 既定 3,600 万
  // draw.io
  drawioChars?: number;         // 既定 64M 字
  drawioCells?: number;         // 既定 2 万 (XML の要素は 10 倍)
  drawioLabelChars?: number;    // 既定 200 万字
  drawioSvgChars?: number;      // 既定 16M 字 (svgWork は 2 倍)
  drawioImages?: number;        // 既定 200
}
```

上は名前の案で、数は 2 節の表と 1 節の「公開」の列を合わせたもの (作る段の初めに、1 節の「要確認」を確かめて、名前を足し引きする)。
公開しない上限 (仕様・内部・書体の中身・符号の密度) は、型に入れない。

### 2.2 名前の付け方と単位

- 名前は「何の」+「単位」(`imagePixels`・`fileBytes`・`epsMs`)。単位の後ろの語は、いまの選択肢 (`fetchTimeoutMs`・`imageMaxDpi`) に合わせ、
  時間は `Ms`、バイトは `Bytes`、画素は `Pixels`、字は `Chars`。数は単位を付けない (`tableColumns`)。
- `max` を前に付けない (`limits` の中なので、どれも上限)。
- 値は 1 以上の整数 (`Number.isSafeInteger(v) && v >= 1`)。0 は「使わない」と紛らわしいので受けない (画像を読まないなどは、別の選択肢 (`fetchImages: false` など) で)。
- 倍率や比 (`WEBFONT_MAX_RATIO`・符号の密度) は公開しない。絶対の上限だけを公開し、ファイルの大きさによる縛りは仕様の値のまま残す
  (例: `imagePixels` を上げても、数十バイトの GIF から 1 億画素を作らせない縛りはそのまま。上げた上限まで使えるのは、それに見合う大きさのファイルだけ)。
- 組になった上限は 1 つの名前で動かす (`imagePixels` → `MAX_PIXELS`・`PS_TOTAL_IMAGE_PIXELS`・`PNG_IMAGE_CACHE_PIXELS` の既定)。
  組の片方を別の名前で渡したら、そちらが勝つ (`pngImageCachePixels`)。
- 下げるだけの入れ子の上限は、種類ごとの既定の違い (HTML 128・FO 250・SVG 250・MathML 300) を残すため、`nestingDepth` を渡したときは
  種類ごとに `min(既定, nestingDepth)` を使う。`nestingDepth` の既定は、種類ごとの既定のうち最も大きい 300 にする (作る段の 3 つ目で決めた。128 にすると、渡さないときに FO・SVG などの既定を変えてしまうか、渡したかどうかで分ける必要があるため)。`cssNesting` も同じ考え方で、既定は 64。説明書に種類ごとの値を書く。

### 2.3 受ける入口

| 入口 | 受け方 |
| --- | --- |
| `typeset(text, options)`・`typesetToPdf(text, options, pdf)` | `options.limits` |
| `createTypesetter(setup)` | `setup.limits` (器の書体の読み込みに当て、文書ごとの既定にもなる) |
| `Typesetter.typeset(text, options)`・`.typesetToPdf` | `options.limits` (器の `setup.limits` の上に、名前ごとに重ねる) |
| `TypesetResult.renderPageToPng`・`renderPageToSvg`・`renderPage` | 組んだときの `limits` を使う (描くときの引数では受けない。8 節の決め 3) |
| `kumiori/browser` (Worker の中を含む) | 同じ `TypesetOptions.limits` (数だけのオブジェクトなので、Worker へ送れる) |
| プラグイン (`KumioriPlugin.load` の文脈) | 文脈に `limits: Readonly<Required<KumioriLimits>>` を足す (読むだけ。プラグインが自分の手間を合わせられる)。結果の上限は `format*` |
| draw.io (`drawio` の選択肢) | `DrawioOptions` には足さず、`limits.drawio*` で受ける (上限の置き場を 1 か所にする) |
| コマンド | `--limit <名前>=<値>` (2.5) |

`fetchTimeoutMs` は、いまの場所 (`TypesetOptions` の直下) のまま動かさない (互換)。`limits` には入れない。

器の覚え (`design/relayout.md` 7 節) との関係:

- `limits` は**呼び出しごと** (文書ごと) のもの。器の `setup.limits` は、書体の読み込み (`fonts`・`loadFont`・数式の書体) に当て、文書ごとの既定にする。
- 器が覚える結果のうち、上限で変わりうるもの (書体の下ごしらえは `fontBytes`・`fontCollectionBytes`、段落の行分けは `leaderRepeats`・`mathGlyphs`・`nestingDepth` など) があるので、
  **文書の上限が前の文書と違えば、覚えを使わずに組み、その文書の上限で覚え直す** (上限の指紋 (名前と値を並べた文字列) を覚えの鍵の外側に置く)。
  ふつうの使い方 (上限を変えないで何度も組む) では、使い回しは前と同じに効く。
- 段落の行分けの覚えの大きさ (`SHARED_LINE_MEMO_ATOMS`) は、器のメモリの上限で、入力の上限ではないので `limits` に入れない
  (要るなら `createTypesetter` の設定の側で受ける。今回は作らない)。

### 2.4 上げられない上限を上げようとしたとき

**`KumioriOptionError` にする** (推奨。8 節の決め 1)。

- いまの選択肢の検査 (`checkOptions`) と同じ形: 名前を `option` に入れ (`limits.nestingDepth`)、文は日英 (`nestingDepth は下げることだけができます (既定 128 以下の値にしてください): 500`)。
- 既定と同じ値は受ける。知らない名前 (書き誤り) も `KumioriOptionError` (`limits.imagePixel は知らない上限の名前です`)。
  無言で捨てると、絞ったつもりのサーバーが絞れていないので。
- 上げられる上限にも、実装の天井 (V8 の文字列の長さ約 5 億字・型付き配列の大きさ・数の範囲) があるものは、天井を超えたら同じく誤りにする (1 節の「上げる」の列の天井)。
- 頭打ちにして警告にする案 (候補 2) は、コマンドの `--limit` で打ち間違えたときに気づきにくく、警告を見ない API の使い手が上げたつもりになるので採らない。

### 2.5 コマンドの選択肢

```text
--limit <名前>=<値>    入力の上限を変える (何度でも。名前は API の limits と同じ。値は 1 以上の整数。
                       …Bytes は 64MB・1GB のように K・M・G (1,024 倍) を付けて書ける。下げるだけの上限は既定より大きくできない)
--list-limits          上限の名前・既定の値・上げられるかを並べて終わる
```

- 例: `kumiori book.html -o book.pdf --limit imagePixels=200000000 --limit fileBytes=1GB`
- 名前は API と同じ camelCase (説明書・誤りの文・`--list-limits` で 1 つの名前にそろえる。8 節の決め 2)。
- 誤り (知らない名前・`=` が無い・数でない・上げられない上限を上げた) は、いまの選択肢の誤りと同じく、何もせずに誤りで終わる (終了の状態 2)。
- `--watch`・複数の入力・`--format png|svg` でも、同じ上限を全部の文書に当てる。
- `--help` には `--limit` と `--list-limits` の 2 行だけを書き、名前の一覧は `--list-limits` と docs/cli.md の「上限とメモリ」の表に置く。
- 上限を上げたことは、`--verbose` で 1 行に書く (`上限を上げています: imagePixels=200000000 (既定 100000000)`)。8 節の決め 5 の info の診断を入れるなら、その文を使う。

---

## 3. 上限を 1 か所にまとめる作り

作った形 (作る段の 1 つ目のコミットで決めたこと。下の 3.1・3.2 の案から変えた所):

- 既定の値は `src/limits.ts` の表 (`LIMIT_DEFS`) に数で書き、元の定数 (`MAX_PIXELS`・`MAX_FILE_BYTES`・`MAX_REFS` など) は、根拠のコメントとともに元の所に残す。
  表と元の定数が食い違わないことは `test/limits.test.ts` が確かめる (表から元のファイルを import すると、元のファイルが表を import するので輪になるため)。
- 組版の途中の関数へは引数で渡さず、L1 の呼び出しごとの文脈 (`CallContext.limits`) から `limits()` で読む (呼び出しの外では既定の値)。
  入口 (`beginCall`) が選択肢を確かめて凍ったオブジェクトにして載せ、組んだ結果の `toPdf`・`renderPage*` も、組んだときの文脈で動く。
  ブラウザの道筋で `await` の後に文脈を置き直すのは L1 の 2 つ目のコミットから (それまでは、ブラウザで上限の違う呼び出しが重なると混ざりうる)。
- `fetchLimits` は、呼び出しの上限を読む getter にした (試験で書き換えるのをやめ、試験は文脈に上限を載せて試す)。
- 器の覚え: 書体の下ごしらえの鍵 (`FontPrepCache`) と、段落の行分けの覚えの印 (`SharedLineMemo` の env) に、上限の指紋 (`limitsKey()`) を入れる。

### 3.1 定義の表

`src/limits.ts` に、公開する上限の表を置く:

```ts
type LimitKind = 'size' | 'depth';
interface LimitDef { def: number; kind: LimitKind; ceiling?: number; }
export const LIMIT_DEFS = {
  imagePixels: { def: 1e8, kind: 'size', ceiling: 2 ** 30 },
  nestingDepth: { def: 128, kind: 'depth' },
  // …
} as const satisfies Record<string, LimitDef>;
export type KumioriLimits = { [K in keyof typeof LIMIT_DEFS]?: number };
export type Limits = Readonly<{ [K in keyof typeof LIMIT_DEFS]: number }>;
export const DEFAULT_LIMITS: Limits = Object.freeze(/* def を集めたもの */);
/** 検査して、base (器の上限) の上に重ねる。誤りは KumioriOptionError */
export function resolveLimits(given: unknown, base: Limits = DEFAULT_LIMITS, path = 'limits'): Limits;
/** 覚えの鍵の外側に置く指紋 (既定なら '') */
export function limitsKey(l: Limits): string;
```

- いまの散らばった定数は、**名前と既定の値はそのまま元の所に残し**、`LIMIT_DEFS` の `def` は元の定数を import して作る
  (値の根拠のコメントは元の所に残す。表の側は 1 行の要約と、元の名前)。
  逆にすると、根拠のコメントと値が離れるので。循環の import にならないよう、元の定数が `limits.ts` を import しない (`imageLimits.ts` と同じく葉に置く)。
- 公開しない上限は、いまのまま元の所に定数で残す。
- `fetchLimits` (試験のために書き換えられる入れ物) は、試験を `limits` で小さな値を渡す形に直して、書き換えをやめる (同じ値を 2 つの道で変えないため)。

### 3.2 組版の途中の関数へ渡す道

**モジュールの変数を書き換えない** (`withMessageLang` と同じ問題: 非同期の呼び出しが重なると、先の呼び出しが後の呼び出しの上限で動く)。
呼び出しの入口で `resolveLimits` した凍ったオブジェクト `Limits` を、いま文書ごとにある入れ物に持たせて渡す:

| 入れ物 (文書ごとにある) | 持たせる上限 | 届く先 |
| --- | --- | --- |
| api.ts の組む関数の中の文書の設定 (`buildTypesetter` の `run`) | 全部 | 下の入れ物を作る所 |
| `Assets` (assets.ts。文書ごとの画像の入れ物。`epsBudgetOf(this)` と同じ道) | 画像・ファイル・EPS・メタファイル・`format*` | 復号器の呼び出しの引数 (`decodeGif(b, { maxPixels })` のように、いまの引数の後ろに選択肢を足し、既定は `DEFAULT_LIMITS`) |
| 取得 (`fetchGuarded` の `maxBytes`・documentResources) | 取得の大きさ・転送・全体の時限 | もう引数で渡している (`fetchLimits.*` を `limits.*` に替える) |
| htmlPrepare・xslfoImport・xmlParse・epub の読み込みの選択肢 | 木・CSS・XML・EPUB | いまの関数の選択肢に足す |
| `LayoutEngine` (layoutEngine.ts) と、その下の inlineLayout・mathLayout・gridTracks・表 | 組版 | エンジンのフィールドから読む (行分けの覚えの鍵の外側に `limitsKey`) |
| svg.ts の読み込みの文脈 (1 つの SVG を読む間の状態) | SVG | 文脈のフィールド |
| `PdfRenderer`・pdfFlatten | `svgLinksPerPage`・`flattenPixels` | レンダラのフィールド |
| `TypesetResult` の描く関数 (pageRaster・canvasRenderer) | `png*`・`canvas*` | 組んだときの `Limits` を結果に閉じ込めて渡す |
| draw.io (`drawio/load.ts` の読み込みの選択肢) | `drawio*`・`formatSize` | `LIMITS` を引数で受ける形にする |

- 葉の関数 (復号器・`fontSanity`・`cssSelector`) は、引数を省いたら `DEFAULT_LIMITS` で動くようにして、いまの呼び手と試験を変えずに済ませる。
- 誤りの文・警告の文に値を埋め込んでいる所 (`${MAX_FO_NEST} 段まで`・`1 億画素`) は、効いている値を書くように直す (下げたときに、文の値と動きが違わないように)。
  docs/diagnostics.md の文の例も合わせる。
- L1 が呼び出しごとの文脈のオブジェクト (止める合図・進み具合・言語) を作るなら、`Limits` はその文脈に 1 つのフィールドとして載せ、
  上の入れ物には文脈を 1 つ渡す (7 節)。

### 3.3 変える範囲の見積もり

- 新しいファイル: `src/limits.ts` (約 250 行: 表・検査・重ね・指紋・日英の文)。
- 上限を読む所を替えるファイル: 約 40 (1 節の「公開」のあるもの)。1 か所あたり、定数を `limits.x` に替え、文脈から受け取る数行。合わせて 600〜900 行の差分。
- api.ts (選択肢・検査・器の重ね・覚えの指紋)、cli.ts (`--limit`・`--list-limits`・help の日英)、プラグインの文脈、kumiori/browser の型の出し入れ: 約 250 行。
- 試験: 約 500 行 (5 節)。説明書: docs/library.md・docs/cli.md・SECURITY.md (日英)・CHANGELOG・docs/en の該当の節: 約 200 行。
- 合わせて **約 2,000 行、大きさ「大」** (公開する名前を減らせば、葉の関数の替えが減る: 8 節の決め 6)。

---

## 4. 安全の前提の書き直し (SECURITY.md・SECURITY.en.md)

いま (SECURITY.md の 36・41・42 行): 脆弱性として扱うのは「説明書 (docs/library.md・docs/cli.md) に書いた上限を超えて、時間やメモリを使い切らせられる・処理を止められる」もので、
「上限の中で、時間やメモリを多く使うこと」は扱わない。

書き直しの案:

- 扱うもの: 「説明書に書いた上限 (**既定の値か、利用者が `limits`・`--limit` で決めた値**) を超えて、時間やメモリを使い切らせられる・処理を止められる」。
  下げた上限を超えて使わせられるものも、脆弱性として扱う (サーバーで絞る使い方を守る)。
- 扱わないものに足す: 「時間・大きさの上限を既定より上げたときに、上げた上限の中で、その分だけ多く時間とメモリを使うこと」。
- 断り (上げたときに守られなくなること) を、SECURITY.md と docs/library.md・docs/cli.md の上限の表の前に書く:
  - 上限を上げると、1 つの文書が使える時間とメモリは、上げた倍率ほど増える (たとえば `imagePixels` を 2 倍にすると、1 枚の画像の RGBA が 800MB になり、組むのも 2 倍ほどかかる)。
    既定の上限は、他人の書いた文書を組むときに、Node の既定のヒープ (約 4GB) の中で落ちないように選んだもので、上げたら、ヒープ (`--max-old-space-size`)・コンテナのメモリ・時限を、それに合わせて外でかける。
  - 上げても、ファイルの大きさによる縛り (符号の密度・展開の比) は変わらないので、小さなファイルから上げた上限いっぱいを使わせることはできない (上げた上限まで使えるのは、それに見合う大きさのファイルだけ)。
  - 入れ子の深さの上限は上げられない (スタックを使い切って文書の全体が組めなくなるのを防ぐもので、Node の既定のスタックに合わせて選んだ値)。
  - 上限を下げると、正当な文書の画像が描けない・表の列が切られるなどが起きる (超えたときの診断は表のとおり)。
- 「既定の値は変わらない」こと (選択肢を渡さなければ前と同じ) を、CHANGELOG の「足したもの」に書く。

---

## 5. 試験の案

`test/limits.test.ts` (新しいファイル) と、既存の上限の試験への足し:

1. **渡さないときに前と同じ**: `DEFAULT_LIMITS` の各値が元の定数と等しい (表と定数がずれない)。
   いまの上限の試験 (上限ちょうど・上限 + 1 で読む・読まない) は、そのまま通る (選択肢を渡さない)。
   見本と組み比べる確かめ (`scripts/compare-pdf.mjs`) で、HTML・FO の見本の PDF のバイト列が変わらない (組版の結果が同じ) ことを、作る段の最後に確かめる。
2. **下げると早く当たる**: 名前ごとに、既定では通る小さな入力を、下げた上限で組むと、表の診断が出る (または `KumioriLimitError`)。
   例: `imagePixels: 100` で 20 × 20 の PNG が描けない、`nestingDepth: 10` で 11 段の div が `limit/nesting-depth`、`tableColumns: 3` で 4 列の表が `limit/table-columns`、
   `pngPixels: 1000` で `renderPageToPng` が誤り、`epsMs: 1` で重い EPS が止まる、`drawioCells: 2` で 3 つのセルの図が警告。
3. **上げると組める**: 既定の上限を少し超える入力 (上限 + 1。大きすぎない物で: `tableColumns` は 1,001 列、`formatFragments` は 65 個、`svgLinksPerPage` は 5,001 個、
   `imagePixels` は試験の時間の都合で、上限を下げた基準 (`imagePixels: 1000`) と上げた値 (`2000`) の差で確かめる) が、上げた上限で組めて診断が出ない。
4. **上げられない上限は上げられない**: `nestingDepth: 129`・`cssNesting: 65`・`entityDepth: 9`・`redirects: 21` が `KumioriOptionError` (`option` が `limits.nestingDepth`)。
   既定と同じ値は通る。知らない名前・0・負・小数・`NaN`・文字列・天井を超える値も `KumioriOptionError`。
5. **器と文書の重ね**: `createTypesetter({ limits: { tableColumns: 3 } })` の器で、文書の `limits` を渡さなければ 3、`{ tableColumns: 2000 }` を渡せば 2000。
   上限の違う文書を交互に組んでも、使い回しの結果が使い回さない器と同じ (`test/reuse.test.ts` の組み比べに、上限を変える並びを足す)。
6. **重なる呼び出し**: 上限の違う 2 つの `typeset` を同時に走らせ、それぞれの上限で動く (モジュールの変数を書き換えていないことの確かめ)。
7. **コマンド**: `--limit tableColumns=3` で診断が出る、`--limit nestingDepth=999` が終了の状態 2、`--limit fileBytes=1GB` の K・M・G、`--list-limits` の出力の名前が `LIMIT_DEFS` と同じ。
8. **プラグイン**: `load` の文脈の `limits` が、渡した値になっている。`formatSize` を上げると、1,000 万 px を超える結果が読める。
9. 型: `KumioriLimits` に無い名前を書くと型の誤り (`test/types` の型の試験があれば、そこに)。

---

## 6. 大きさと、作る段のコミットの分け方

大きさ: 約 2,000 行・約 45 ファイル (3.3)。作る段は 5 回のコミットに分ける (それぞれで `npm run typecheck`・`npm test`。最後に `npm run e2e` と見本の組み比べ):

1. **土台**: `src/limits.ts` (表・検査・重ね・指紋)、`TypesetOptions.limits`・`TypesetterOptions.limits`・検査、器の覚えの指紋、`--limit`・`--list-limits`、
   画像・ファイル・取得の上限 (`imagePixels`・`fileBytes`・`cssBytes`・`fontBytes`・`fontCollectionBytes`・`imageFetchTotalMs`・`redirects`・`styleRefs`・`importDepth`・`importedCssChars`・`cssImports`) をつなぐ。
   `fetchLimits` の書き換えをやめる。試験の 1・4・5・6・7 と、2・3 のこの段の分。
2. **画像の形式**: EPS・メタファイル・EPUB・`format*`・プラグインの文脈・draw.io。
3. **文書の木と組版**: `nestingDepth`・`cssNesting`・`entityDepth`・`entityChars`・セレクタ・表・リーダー・数式・グリッド・SVG・`diagnosticsPerCode`。
   誤りの文・警告の文の値を、効いている値にする。
4. **描く**: `png*`・`canvas*`・`svgFilterWork`・`flattenPixels`・`svgLinksPerPage`。
5. **説明書**: docs/library.md (上限の表を 1 つにまとめ、`limits` の節を足す)・docs/cli.md (「上限とメモリ」に `--limit` と名前の表)・SECURITY.md・SECURITY.en.md・CHANGELOG・docs/en の該当の節・docs/diagnostics.md の文の例。

段の 2〜4 は互いに独立なので、別のセッションに分けてもよい (どれも段 1 の後)。

---

## 7. L1 (止める・進み具合・呼び出しごとの言語) とぶつかる所

1. **選択肢の名前**: L2 は `TypesetOptions.limits` だけを足す。L1 の `signal`・`onProgress` と名前は重ならない。
   ただし、L1 で時限 (`timeoutMs` のような、呼び出し全体の時間の上限) を足すなら、それは `limits` に入れず L1 の側 (`signal` と組) に置く
   (`limits` は入力ごとの手間の上限、時限は呼び出し全体を止めるもの、と分ける)。`limits.epsDocumentMs` などの名前の付け方 (`…Ms`) は L1 と合わせる。
2. **検査の置き場所**: どちらも `checkOptions` (src/api.ts) に足す。`limits` の検査は `resolveLimits` (src/limits.ts) に置き、`checkOptions` からは 1 行で呼ぶ
   (`checkOptions` の中の行を増やさないので、L1 の足す行とぶつかりにくい)。
   `SETUP_ONLY_OPTIONS` (器の設定だけのもの) に `limits` は入れない (器と文書の両方で受ける)。L1 の `signal`・`onProgress` が文書ごとだけなら、`TypesetterOptions` の `Pick` の行で隣り合う。
3. **呼び出しごとの文脈**: L1 は、言語を呼び出しごとの文脈に持たせる (Node は `AsyncLocalStorage`、ブラウザは引数)。
   上限は、組版の奥の同期の関数まで届けるので、**文脈のオブジェクトを引数で渡す作り (ブラウザの側と同じ) に `limits` を載せる**のがよい
   (推奨。`AsyncLocalStorage` で引くと Node だけになり、ブラウザで同じ上限を効かせるには結局引数で渡すので)。
   - L1 が先に入るなら: L1 の文脈のオブジェクト (例: `RunContext { signal?, onProgress?, lang, limits }`) に、L2 が `limits` を足す。3.2 の入れ物には文脈を渡す。
   - L2 が先に入るなら: L2 は `Limits` を 3.2 の入れ物に直に持たせ、L1 が文脈を作るときに、`limits` をその中へ移す。
   どちらでも、入れ物 (Assets・LayoutEngine・レンダラ) に文脈を 1 つ持たせる形にそろえると、後から入る側の差分が小さい。L1 の覚え書きと名前 (`RunContext` など) をそろえたい。
4. **確かめの点**: L1 は「ページごと・画像と書体の読み込みごと」に止める合図を確かめる。L2 の手間の上限 (`epsMs`・`pngRasterWork` など) が当たる所と、L1 の止める点は別に動く
   (止めたら `AbortError`、上限に当たったら診断か `KumioriLimitError`)。同じ所で両方を見るとき、止める合図を先に見る (止めた文書の診断を増やさない)。
5. **器**: L1 の `signal` で止めた文書の覚えを、器が使い回さない決まり (止めた文書の途中の結果は覚えない) があれば、L2 の「上限が違えば覚えを使わない」と同じ所 (覚えの入口) に置く。

---

## 8. 決めたこと (2026-11-22)

利用者の決めは、下の 1〜7 のどれも推奨の案 (最初の案)。まとめると:

1. 上げられない上限を上げる・知らない名前・天井を超える値は `KumioriOptionError` (コマンドは終了の状態 2)。
2. コマンドは API と同じ camelCase の `--limit <名前>=<値>` (何度でも。…Bytes は K・M・G) と `--list-limits`。
3. 描くとき (`renderPageToPng` など) は、組んだときの `limits` だけを使う。
4. 手間の上限は、既定の値の手間を整数で受け、組の残りは同じ比で動かす。
5. 上げた上限があれば、info の診断 `limit/raised` を 1 件出す。
6. 公開するのは 2 節の 56 個 (上げ下げ 50・下げるだけ 6)。
7. `maxPages` は `TypesetOptions` に置き、`limits` には入れない (別の束で作る)。

置き場所の決め (7 節の 3 の推奨): `limits` は、L1 の作る呼び出しごとの文脈 `CallContext` (`src/callContext.ts`。`lang`・`signal`・`onProgress`・`pace` を持つ) に載せる。
全体の時限は `limits` に入れない (L1 の `signal` の側)。3.2 の入れ物には、`Limits` を直に持たせずに、`CallContext` を渡す。

以下は、決める前に並べた候補 (記録のため残す)。

### 8.1 決める前の候補 (推奨を最初に)

1. **上げられない上限を上げようとしたとき**
   - (推奨) `KumioriOptionError` (コマンドは終了の状態 2)。既定と同じ値は受ける
   - 既定で頭打ちにして、警告 (`api/invalid-option` の warning) を出して組む
2. **コマンドの名前の書き方**
   - (推奨) API と同じ camelCase (`--limit imagePixels=…`)。名前を 1 つにそろえる
   - kebab-case (`--limit image-pixels=…`)。ほかのコマンドの選択肢に合わせ、API の名前と対応の表を置く
   - 両方を受ける
3. **描くときの上限の渡し方**
   - (推奨) 組んだときの `limits` だけ (`renderPageToPng(i, { dpi })` は変えない)
   - `renderPageToPng`・`renderPage` の引数でも `limits` の `png*`・`canvas*` を上書きできる
4. **手間の上限の単位** (`metafileClipWork`・`pngRasterWork` のように、内部が「1 画素あたり」や 2 つの値の組のもの)
   - (推奨) 整数の「既定の値の手間」で受け、組の残りは同じ比で動かす (`pngRasterWork` は 1 画素あたりの 128 を受け、基本の 6,400 万も比で動かす)
   - 倍率 (`1` が既定。小数を許す) で受ける
5. **上げたことの知らせ**
   - (推奨) 上げた上限があれば、info の診断 `limit/raised` を 1 件 (上げた名前と値) 出す。ログで安全の前提が変わったことが分かる
   - 出さない (`--verbose` の行だけ)
6. **公開する名前の数**
   - (推奨) 2 節の 56 個 (時間・大きさの上限で、文書の作り手・サーバーの人が変えたい場面のあるもの)。書体の中身・符号の密度・内部は公開しない
   - 主なもの約 15 個 (`imagePixels`・`fileBytes`・`cssBytes`・`fontBytes`・`epsMs`・`epsDocumentMs`・`epsMemoryBytes`・`nestingDepth`・`tableColumns`・`mathGlyphs`・`pngPixels`・`pngRasterWork`・`formatSize`・`drawioCells`・`drawioSvgChars`) から始め、要望で足す (作る段が約半分になる)
   - 約 150 個の全部 (下げるだけのものを含む)
7. **ページ数の上限との関係** (台帳の別の束で `maxPages` を入れる決めがある)
   - (推奨) `maxPages` は組版の結果を決める選択肢 (超えたら組むのをやめ、決まらない相互参照を警告) なので、`TypesetOptions.maxPages` に置き、`limits` には入れない。
     既定は上限なし (いまと同じ) なので、`limits` の「既定の値は変えない」と矛盾しない
   - `limits.pages` として `limits` に入れる (上限の置き場を 1 か所にする。その束の設計と名前を合わせる)
