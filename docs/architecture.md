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

1. HTML+CSS は自前の CSS カスケード (ブラウザ不要) で、XSL-FO は属性の読み込みで、どちらも **論理ツリー** にします。論理ツリーは、JSON で保存できます (画面)。
2. XSL-FO の **Area Model** に従って、すべてのボックスを pt 単位で計算し、**物理ツリー (Area Tree)** を組み上げます。
3. Area Tree を、Canvas と **PDF (pdf-lib + fontkit)** に描きます (SVG・PNG も同じ Area Tree から作ります)。

単位と座標の決まりは [`docs/library.md`](library.md) の「単位と座標」、Area Tree の JSON は [`docs/area-tree.md`](area-tree.md) にあります。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `src/index.ts`, `src/api.ts` | 公開 API (`typeset`・`createTypesetter`・`DEFAULT_FONTS` など。公開しているのは `src/index.ts` から出しているものだけ) |
| `src/node.ts`, `src/nodeFonts.ts`, `src/resources.ts` | Node 用の部品 (`kumiori/node`: 書体のキャッシュ・`file:` の参照の読み込み)、文書と CSS の参照の集め方 (`resolveResource`・CSS の取得) |
| `src/types.ts` | 論理ツリー (Input) / 物理ツリー (Area Tree) / ページ設定の型 |
| `src/areaTree.ts`, `src/areaResources.ts` | Area Tree をたどる・JSON で読み書きする ([`docs/area-tree.md`](area-tree.md))、使った書体・画像の一覧 |
| `src/fontManager.ts` | TTF/OTF を fetch → `FontFace`(Canvas) + `ArrayBuffer`(PDF) + fontkit(メトリクス) |
| `src/fontInstancer.ts`, `src/fontVariation.ts` | 可変フォント (OpenType Font Variations) の、軸の値を決めた形 (実体) を静的な書体にする (gvar・HVAR・MVAR・GPOS の値・FeatureVariations)、軸の値の指定の持ち回り |
| `src/cff2Instancer.ts` | 輪郭が CFF2 (可変の CFF) の書体の実体を、静的な CFF にする (字形の blend・vsindex を計算して、Type 2 の CharString に書き直す) |
| `src/measurer.ts`, `src/jis.ts` | 文字幅計測 (Canvas / fontkit 両バックエンド)、縦書き・ルビ・縦中横の計測、禁則 |
| `src/geometry.ts`, `src/lnode.ts` | 論理座標(inline/block) ↔ 物理座標の変換、レイアウト中間ツリー |
| `src/inlineLayout.ts`, `src/inlineFlatten.ts`, `src/lineMetrics.ts` | 行分割 (禁則・ぶら下げ・追い出し)、行内配置、ルビ/縦中横の行ノード生成、inline の木 → 字の並び (Atom)、行の高さ (CSS・XSL・互換の 3 モデル) |
| `src/warichu.ts` | 割注 (JLREQ §3.4): 行を分ける前の送りの見積もり、行ごとの部分の 2 行への割り振りと括弧 |
| `src/layoutEngine.ts` | ブロック/ページネーション/表/絶対配置、論理→物理 (Area Tree) 変換 |
| `src/footnotes.ts`, `src/tableBorders.ts`, `src/lineBreak.ts`, `src/bidi.ts`, `src/hyphenation.ts`, `src/counterStyle.ts` | 脚注、表の罫線の結合、改行の機会 (UAX #14)、双方向 (UAX #9)、分綴、CSS の counter-style |
| `src/paint.ts` | Area Tree 走査 + トンボ幾何 (Canvas / PDF 共通) |
| `src/canvasRenderer.ts`, `src/pdfRenderer.ts`, `src/pdfLibPatches.ts`, `src/matrix.ts` | Canvas / PDF レンダラー、pdf-lib の内部の差し替え (1 か所に集約)、行列と Seg |
| `src/sampleData.ts`, `src/main.ts`, `index.html` | 究極のサンプルとプレビュー UI |
| `src/htmlImport.ts`, `src/htmlPaged.ts`, `src/htmlPrepare.ts`, `src/htmlFrame.ts` | HTML+CSS の読み込み (計算値 → 論理ツリー、ページの組版の CSS、CSS の集め方、画面での読み込み (既定は自前のカスケード、比較用にブラウザの iframe)) |
| `src/cssCascade.ts`, `src/cssSelector.ts`, `src/cssText.ts` | ブラウザを使わない CSS の解釈 (カスケード・計算値・セレクタ)、CSS の字句の補助 (区切り・長さ・色) |
| `src/xslfoImport.ts`, `src/foExpr.ts`, `src/foDom.ts`, `src/foContext.ts`, `src/foPageMaster.ts`, `src/foMathFallback.ts` | XSL-FO の読み込み (属性 → 論理ツリー、式の評価、最小 DOM、ページマスター、数式書体が無いときの MathML の組版) |
| `src/svg.ts`, `src/svgFilterRaster.ts`, `src/mathLayout.ts` | SVG を図形にする (図形で近似できない filter は画素で計算する)、MathML の組版 |
| `src/jpeg.ts`, `src/webp.ts`, `src/vp8.ts`, `src/pixels.ts`, `src/ccitt.ts`, `src/imageLimits.ts`, `src/metafile.ts`, `src/cgm.ts`, `src/eps.ts`, `src/ps*.ts` (`psInterp`・`psGraphics`・演算子ごとの `psOps*`・`psResources`・`psColorSpace`・`psFonts`・`psCff`・`psEncodings`・`psShading`・`psFilters`), `src/imageInfo.ts`, `src/imageFormats.ts`, `src/base64.ts` | 画像の復号 (JPEG・WebP・GIF・BMP・TIFF) と上限、WMF/EMF・CGM・EPS (PostScript の解釈器) の図形化、画像の大きさの読み取り、本体の外に置いて要るときだけ読み込む画像の形式の受け口 |
| `src/epub.ts`, `src/xhtml.ts` | EPUB の展開、XHTML の読み込み |
| `src/fontMapping.ts`, `src/compat.ts`, `src/documentResources.ts`, `src/documentText.ts`, `src/cli.ts` | 書体の割り当て・互換モードの設定・数式書体と画像の取得・文字の符号化の判定 (画面と Node で共通)、Node のコマンド |
| `src/webFont.ts`, `src/fontLoader.ts`, `src/userFonts.ts` | WOFF・WOFF2 を TTF・OTF に戻す、利用者の書体のファイル (TTC を含む) を書体ごとに分けて名前を読む、画面で読み込んだ書体の保存 |
| `src/colorGlyph.ts`, `src/colorGlyphPdf.ts`, `src/colorGlyphCanvas.ts`, `src/colorGlyphSvg.ts` | 色つきの字形 (カラーの絵文字など) を書体の表から読み、PDF と Canvas に描く (OpenType の SVG の表の字形を含む) |
| `src/color.ts`, `src/cssColorFunctions.ts`, `src/cssGradient.ts`, `src/icc.ts`, `src/pdfStandard.ts`, `src/iccRegistry.ts`, `src/pdfxVerify.ts`, `src/srgbIcc.ts`, `src/pdfaVerify.ts` | 色の指定の読み取り、CSS Color 4・5 の色の関数、CSS のグラデーション、ICC プロファイルでの CMYK への変換、PDF/X-1a・PDF/X-3・PDF/X-4 の方針 (ICC の登録簿の印刷条件の名前と、書き出した PDF の検査も)、PDF/A-2b・3b の印 (出力意図の sRGB の ICC プロファイルを作るもの、書き出した PDF の検査) |
| `src/assets.ts`, `src/linkPolicy.ts`, `src/messages.ts` | 画像の登録所 (組版・Canvas・PDF で共有)、文書の外へのリンクを PDF のどの動作にするかの方針、利用者に見せる文言 (日本語・英語) |
| `src/callContext.ts` | 呼び出しごとの文脈 (警告・誤りの文の言語など、1 回の `typeset`・`toPdf` の間だけ効く設定)。Node では AsyncLocalStorage で持ち、ブラウザではモジュールの変数で持つ。そのため、呼び出しの道筋の async の関数の await は、どれも `rejoin(thisCall(), await …)` と書いて、await の後で文脈を置き直す (`test/callContextAwait.test.ts` が書き忘れを拾う) |
| `tools/api-docs/`, `scripts/build-api-docs.mjs` | API の説明書 (`npm run docs:api`。型の宣言のコメントから TypeDoc で作る一覧の頁。GitHub Pages の画面の下の `/api/` に置く。TypeDoc は、直下の依存と分けて `tools/api-docs` に入れる) |
| `src/drawio/` | draw.io の図 (`.drawio`・`.dio`) を読んで SVG にする (draw.io と mxGraph のソースから移した形・線の描き方。図が出てきたときだけ読み込む。[`docs/drawio.md`](drawio.md)) |

## 関連する文書

| 文書 | 中身 |
| --- | --- |
| [`docs/REPORT.md`](REPORT.md) | 組版アルゴリズムの詳細 |
| [`docs/xslfo-import.md`](xslfo-import.md) | XSL-FO の読み込み |
| [`docs/html-css-plan.md`](html-css-plan.md) | HTML+CSS の読み込みの計画 |
| [`docs/conformance/`](conformance/README.md) | 対応している仕様の項目ごとの説明 (対応仕様説明書。`npm run docs:conformance` で PDF にする。版ごとの PDF は GitHub のリリースに付ける) |
| [`docs/BACKLOG.md`](BACKLOG.md) | まだ無い機能・既知の制限 |
| [`docs/area-tree.md`](area-tree.md) | 組んだ結果 (Area Tree) の JSON |
