> English: [en/architecture.md](en/architecture.md)

# 構成

Kumiori の内部の仕組みと、ソースのファイルの役割です。

## 組版の流れ

```text
HTML+CSS ・ XSL-FO
        │
        ▼
論理ツリー (Input)
        │  組版 (XSL-FO の Area Model。pt で計算)
        ▼
物理ツリー (Area Tree)
        ├─▶ Canvas (プレビュー)
        ├─▶ PDF (pdf-lib + fontkit)
        └─▶ SVG ・ PNG
```

1. HTML+CSS は自前の CSS カスケード (ブラウザー不要) で、XSL-FO は属性の読み込みで、どちらも **論理ツリー** にします。論理ツリーは、JSON で保存できます (画面)。
2. XSL-FO の **Area Model** に従って、すべてのボックスを pt 単位で計算し、**物理ツリー (Area Tree)** を組み上げます。
3. Area Tree を、Canvas と **PDF (pdf-lib + fontkit)** に描画します (SVG・PNG も同じ Area Tree から作ります)。

単位と座標の規則は [`docs/library.md`](library.md) の「単位と座標」、Area Tree の JSON は [`docs/area-tree.md`](area-tree.md) にあります。

## 構成図

内部の仕組みを、1 つの図で 1 つずつ示します。図の中の名前は、`src` の関数・クラス・ファイルの名前です。
図は `scripts/architecture-diagrams.mjs` で作ります。図を直すときは、このスクリプトを直して `node scripts/architecture-diagrams.mjs` で作り直します (SVG を手で直さない)。`npm test` が、図がスクリプトの出力と同じことと、図に書いた名前が `src` にあることを確認します。

### 1. 全体像

![全体像: 4 つの入口から同じ組版の流れへ](images/architecture/01-overview.svg)

入口は 4 つあり、どれも同じ組版の流れ (読み込み → 論理ツリー → 組版 → Area Tree → 描画) を通ります。画面 (`src/main.ts`) だけは公開 API を通らず、モジュールを直に組み合わせます (EPUB を読むのも画面だけです)。
論理ツリーは JSON に保存でき (画面)、Area Tree も JSON で読み書きできます (`serializeAreaTree`・`parseAreaTree`)。単位はすべて pt です。

### 2. 読み込み

![読み込み: 文書から論理ツリーへ](images/architecture/02-import.svg)

先にフォントと画像を用意し、文書の種類を判定します。HTML+CSS と XSL-FO は別々に読み込み、同じ論理ツリー (`LDocument`) にします。ブラウザーを使わず、CSS のカスケードも自前で行います。論理ツリーができたら、文書が使う文字を見て、足りないフォント (等幅・記号・絵文字・数式・OS のフォント) を追加で読み込みます。
HTML の解析は htmlparser2 と linkedom、XML の解析は @xmldom/xmldom で行います。

### 3. 組版エンジンの回

![組版エンジン: 収束するまで組み直す](images/architecture/03-passes.svg)

ページ番号の参照・脚注の番号・索引は、組み終えるまで値が決まりません。`LayoutEngine` は文書を 1 回組み、値が変わったら組み直します (最大 4 回)。前の回と変わらないページ列は再利用し、`createTypesetter` で組むときは、行分けの結果を文書をまたいで再利用します (`SharedLineMemo`)。
途中の回の結果は、ページの論理の木 (`PageBuild`) までで止め、Area Tree にするのは収束した回だけです (数千ページの文書で、文書全体の木を何度も持たないため)。組版は generator で書かれていて、`signal`・`onProgress` があるときは、page-sequence の境界で中断のシグナルを確認し、進捗を通知します。

### 4. 1 回の組版の中

![1 回の組版の中](images/architecture/04-flow.svg)

page-sequence ごとにページマスターを選び、本文のフロー (`Flow`) をページの枠に詰めます。ブロックの中の行は、文字の並び (Atom) にしてから行に分け (改行の機会は UAX #14、禁則・ぶら下げ・追い出し・分綴・割注)、行の中に置きます。
表のセルの中身も、同じ仕組み (`layoutCell` の中の Flow) で組みます。ページの境界では、組版の途中の状態 (`captureBoundary`・`resumeFrom`) を保存しておき、そこから続けます。縦書きは論理座標 (inline・block) のまま組み、物理座標にするとき (`toArea`) に向きを直します。

### 5. 論理ツリーと Area Tree

![論理ツリーと Area Tree](images/architecture/05-trees.svg)

論理ツリーは文書の構造で、ページを知りません。Area Tree はページに置いた結果で、座標と大きさを pt で持ちます。1 つの page-sequence がページの数だけのシートになり、1 つのブロックが改ページで分かれ、文字列は行と文字ごとの Area になります。
描画するときだけ効く `transform`・`opacity` は Area に付けるだけで、組版はそれを知りません。Area Tree の形の規則は [`docs/area-tree.md`](area-tree.md) にあります。

### 6. 描画

![描画: 1 つの走査、4 つの書き出し](images/architecture/06-render.svg)

Area Tree をたどって描画する順を決めるのは `src/paint.ts` の 1 か所だけです。描画する先ごとの違いは、`Painter` インターフェースの実装 (Canvas・SVG・PNG・PDF) に閉じています。
PNG は Canvas を使わずに自前で塗るので、Node でも作れます。文書の中の SVG の画像は、どの書き出しでも `src/svg.ts` で図形にしてから描画します。

### 7. PDF の 3 つの作り方

![PDF の 3 つの作り方と、持つもの](images/architecture/07-pdf-modes.svg)

`typeset` の結果の `toPdf` は、文書全体の Area Tree を持ったまま PDF を書きます。PDF だけが要るとき (`typesetToPdf`・`typesetToPdfStream`) は、ページの論理の木から 1 ページずつ Area を作って書くので、文書全体の Area Tree を持ちません (ページの Area は、使うフォント・画像を集めるときと、描画するときの 2 度作ります)。`typesetToPdfStream` は、書き終えた部分から書き出し先へ流します。
`lowMemory` を付けると `layoutLowMemory()` で組み、組み直しで前の回のページを再利用せず、組み終えた page-sequence の途中の木を手放します (組版の計算量は増えます)。

### 8. フォント

![フォント: どこから来て、誰が使うか](images/architecture/08-fonts.svg)

フォントのファイルは、どこから来ても `FontManager` に登録し、組版の計測・Canvas・PDF の埋め込みが同じフォントの中身を使います。数式・等幅・記号・絵文字のフォントは、文書が使うときだけ読みます。
計測はブラウザーでは Canvas、Node では fontkit で行います。可変フォントは、軸の値を決めたインスタンス (静的なフォント) にしてから使います。

### 9. 画像と図

![画像と図: 形式を見分けて、ピクセルか図形に](images/architecture/09-images.svg)

画像の参照は `AssetStore` が受け、中身から形式を見分けます。写真のような画像はピクセルに、図の形式は図形にして、どの書き出しでも同じ形で描画します。EPS (PostScript の解釈器)・WMF・EMF・CGM・draw.io は、その形式が出てきたときだけ読み込みます。
プラグイン (`TypesetOptions.plugins` の `ImageFormat`) は、本体の形式より先に判定します。

### 10. 呼び出しの文脈

![呼び出しの文脈: await の後で置き直す](images/architecture/10-call-context.svg)

警告の言語・上限・中断のシグナル・進捗の通知先は、1 回の `typeset` の間だけ効く設定です。Node では AsyncLocalStorage が await をまたいで持ち運びますが、ブラウザーでは 1 つのモジュールの変数なので、重なった呼び出しが上書きします。
そのため、呼び出しの途中の async の関数は、どれも `rejoin(thisCall(), await …)` と書き、await の後で自分の文脈に置き直します (書き忘れは `test/callContextAwait.test.ts` が拾います)。

### 11. ビルドと確認

![ビルドと確認](images/architecture/11-build.svg)

同じ `src` から、Vite の設定ごとに、ライブラリ・コマンド・ブラウザー向けの 1 ファイル・画面を作ります。確認は、単体の試験 (vitest)・画面の試験 (Playwright)・前と後の組み比べです。
組み比べのツールの使い方は [`docs/development.md`](development.md) にあります。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `src/index.ts`, `src/api.ts` | 公開 API (`typeset`・`createTypesetter`・`DEFAULT_FONTS` など。公開しているのは `src/index.ts` から出しているものだけ) |
| `src/node.ts`, `src/nodeFonts.ts`, `src/resources.ts` | Node 用のモジュール (`kumiori/node`: フォントのキャッシュ・`file:` の参照の読み込み)、文書と CSS の参照の集め方 (`resolveResource`・CSS の取得) |
| `src/types.ts` | 論理ツリー (Input) / 物理ツリー (Area Tree) / ページ設定の型 |
| `src/areaTree.ts`, `src/areaResources.ts` | Area Tree をたどる・JSON で読み書きする ([`docs/area-tree.md`](area-tree.md))、使ったフォント・画像の一覧 |
| `src/fontManager.ts` | TTF/OTF を fetch → `FontFace`(Canvas) + `ArrayBuffer`(PDF) + fontkit(メトリクス) |
| `src/fontInstancer.ts`, `src/fontVariation.ts` | 可変フォント (OpenType Font Variations) の、軸の値を決めた形 (インスタンス) を静的なフォントにする (gvar・HVAR・MVAR・GPOS の値・FeatureVariations)、軸の値の指定の持ち回り |
| `src/cff2Instancer.ts` | アウトラインが CFF2 (可変の CFF) のフォントのインスタンスを、静的な CFF にする (字形の blend・vsindex を計算して、Type 2 の CharString に書き直す) |
| `src/measurer.ts`, `src/jis.ts` | 文字幅計測 (Canvas / fontkit 両バックエンド)、縦書き・ルビ・縦中横の計測、禁則 |
| `src/geometry.ts`, `src/lnode.ts` | 論理座標(inline/block) ↔ 物理座標の変換、レイアウト中間ツリー |
| `src/inlineLayout.ts`, `src/inlineFlatten.ts`, `src/lineMetrics.ts` | 行分割 (禁則・ぶら下げ・追い出し)、行内配置、ルビ/縦中横の行ノード生成、inline の木 → 文字の並び (Atom)、行の高さ (CSS・XSL・互換の 3 モデル) |
| `src/warichu.ts` | 割注 (JLREQ §3.4): 行を分ける前の送りの見積もり、行ごとの部分の 2 行への割り振りと括弧 |
| `src/layoutEngine.ts` | ブロック/ページネーション/表/絶対配置、論理→物理 (Area Tree) 変換 |
| `src/footnotes.ts`, `src/tableBorders.ts`, `src/lineBreak.ts`, `src/bidi.ts`, `src/hyphenation.ts`, `src/counterStyle.ts` | 脚注、表の罫線の結合、改行の機会 (UAX #14)、双方向 (UAX #9)、分綴、CSS の counter-style |
| `src/paint.ts` | Area Tree 走査 + トンボ幾何 (Canvas / PDF 共通) |
| `src/canvasRenderer.ts`, `src/pdfRenderer.ts`, `src/pdfLibPatches.ts`, `src/matrix.ts` | Canvas / PDF レンダラー、pdf-lib の内部の差し替え (1 か所に集約)、行列と Seg |
| `src/sampleData.ts`, `src/main.ts`, `index.html` | 究極のサンプルとプレビュー UI |
| `src/htmlImport.ts`, `src/htmlPaged.ts`, `src/htmlPrepare.ts`, `src/htmlFrame.ts` | HTML+CSS の読み込み (計算値 → 論理ツリー、ページの組版の CSS、CSS の集め方、画面での読み込み (既定は自前のカスケード、比較用にブラウザーの iframe)) |
| `src/cssCascade.ts`, `src/cssSelector.ts`, `src/cssText.ts` | ブラウザーを使わない CSS の解釈 (カスケード・計算値・セレクター)、CSS の字句の補助 (区切り・長さ・色) |
| `src/xslfoImport.ts`, `src/foExpr.ts`, `src/foDom.ts`, `src/foContext.ts`, `src/foPageMaster.ts`, `src/foMathFallback.ts` | XSL-FO の読み込み (属性 → 論理ツリー、式の評価、最小 DOM、ページマスター、数式フォントが無いときの MathML の組版) |
| `src/svg.ts`, `src/svgFilterRaster.ts`, `src/mathLayout.ts` | SVG を図形にする (図形で近似できない filter はピクセルで計算する)、MathML の組版 |
| `src/jpeg.ts`, `src/webp.ts`, `src/vp8.ts`, `src/pixels.ts`, `src/ccitt.ts`, `src/imageLimits.ts`, `src/metafile.ts`, `src/cgm.ts`, `src/eps.ts`, `src/ps*.ts` (`psInterp`・`psGraphics`・演算子ごとの `psOps*`・`psResources`・`psColorSpace`・`psFonts`・`psCff`・`psEncodings`・`psShading`・`psFilters`), `src/imageInfo.ts`, `src/imageFormats.ts`, `src/base64.ts` | 画像の復号 (JPEG・WebP・GIF・BMP・TIFF) と上限、WMF/EMF・CGM・EPS (PostScript の解釈器) の図形化、画像の大きさの読み取り、本体の外に置いて要るときだけ読み込む画像の形式の受け口 |
| `src/epub.ts`, `src/xhtml.ts` | EPUB の展開、XHTML の読み込み |
| `src/fontMapping.ts`, `src/compat.ts`, `src/documentResources.ts`, `src/documentText.ts`, `src/cli.ts` | フォントの割り当て・互換モードの設定・数式フォントと画像の取得・文字の符号化の判定 (画面と Node で共通)、Node のコマンド |
| `src/webFont.ts`, `src/fontLoader.ts`, `src/userFonts.ts` | WOFF・WOFF2 を TTF・OTF に戻す、利用者のフォントのファイル (TTC を含む) をフォントごとに分けて名前を読む、画面で読み込んだフォントの保存 |
| `src/colorGlyph.ts`, `src/colorGlyphPdf.ts`, `src/colorGlyphCanvas.ts`, `src/colorGlyphSvg.ts` | 色つきの字形 (カラーの絵文字など) をフォントの表から読み、PDF と Canvas に描画する (OpenType の SVG の表の字形を含む) |
| `src/color.ts`, `src/cssColorFunctions.ts`, `src/cssGradient.ts`, `src/icc.ts`, `src/pdfStandard.ts`, `src/iccRegistry.ts`, `src/pdfxVerify.ts`, `src/srgbIcc.ts`, `src/pdfaVerify.ts` | 色の指定の読み取り、CSS Color 4・5 の色の関数、CSS のグラデーション、ICC プロファイルでの CMYK への変換、PDF/X-1a・PDF/X-3・PDF/X-4 の方針 (ICC のレジストリの印刷条件の名前と、書き出した PDF の検査も)、PDF/A-2b・3b の印 (出力インテントの sRGB の ICC プロファイルを作るもの、書き出した PDF の検査) |
| `src/assets.ts`, `src/linkPolicy.ts`, `src/messages.ts` | 画像のレジストリ (組版・Canvas・PDF で共有)、文書の外へのリンクを PDF のどの動作にするかの方針、利用者に見せる文言 (日本語・英語) |
| `src/callContext.ts` | 呼び出しごとの文脈 (警告・エラーの文の言語など、1 回の `typeset`・`toPdf` の間だけ効く設定)。Node では AsyncLocalStorage で持ち、ブラウザーではモジュールの変数で持つ。そのため、呼び出しの途中の async の関数の await は、どれも `rejoin(thisCall(), await …)` と書いて、await の後で文脈を置き直す (`test/callContextAwait.test.ts` が書き忘れを拾う) |
| `tools/api-docs/`, `scripts/build-api-docs.mjs` | API リファレンス (`npm run docs:api`。型定義のコメントから TypeDoc で作る一覧の頁。GitHub Pages の画面の下の `/api/` に置く。TypeDoc は、直下の依存と分けて `tools/api-docs` に入れる) |
| `src/drawio/` | draw.io の図 (`.drawio`・`.dio`) を読んで SVG にする (draw.io と mxGraph のソースから移した形・線の描画の仕方。図が出てきたときだけ読み込む。[`docs/drawio.md`](drawio.md)) |

## 関連する文書

| 文書 | 中身 |
| --- | --- |
| [`docs/REPORT.md`](REPORT.md) | 組版アルゴリズムの詳細 |
| [`docs/xslfo-import.md`](xslfo-import.md) | XSL-FO の読み込み |
| [`docs/html-css-plan.md`](html-css-plan.md) | HTML+CSS の読み込みの計画 |
| [`docs/conformance/`](conformance/README.md) | 対応している仕様の項目ごとの説明 (対応仕様説明書。`npm run docs:conformance` で PDF にする。バージョンごとの PDF は GitHub のリリースに付ける) |
| [`docs/BACKLOG.md`](BACKLOG.md) | まだ無い機能・既知の制限 |
| [`docs/area-tree.md`](area-tree.md) | 組んだ結果 (Area Tree) の JSON |
