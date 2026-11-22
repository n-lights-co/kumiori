Kumiori (組み織り) のライブラリの API の一覧です。型の宣言のコメント (npm のパッケージの `dist-lib/types` に入っているもの) から作っています。
使い方の流れと例は、ライブラリの説明書 ([docs/library.md](https://github.com/n-lights-co/kumiori/blob/main/docs/library.md)) を見てください。

## 入口

- HTML+CSS・XSL-FO を組む: {@link kumiori!typeset | typeset} (組んだ結果 {@link kumiori!TypesetResult | TypesetResult} を返す)・{@link kumiori!typesetHtml | typesetHtml}・{@link kumiori!typesetFo | typesetFo}
- 組み方の設定 (書体・用紙・既定のスタイル・タグ付き PDF・PDF/UA-1・文書の言語・資源の取り方など): {@link kumiori!TypesetOptions | TypesetOptions}
- PDF にする: {@link kumiori!TypesetResult.toPdf | TypesetResult.toPdf} と、その設定 {@link kumiori!PdfOptions | PdfOptions} (文書の題・入稿用 PDF/X・長期保存用 PDF/A・JPEG の解像度の上限)
- PDF だけを作る (組んだ結果を持たないので、大きな文書で使うメモリが少ない): {@link kumiori!typesetToPdf | typesetToPdf} と {@link kumiori!TypesetPdfOptions | TypesetPdfOptions}
- ページを SVG・PNG にする: {@link kumiori!TypesetResult.renderPageToSvg | TypesetResult.renderPageToSvg} と {@link kumiori!RenderPageSvgOptions | RenderPageSvgOptions}・{@link kumiori!TypesetResult.renderPageToPng | TypesetResult.renderPageToPng} と {@link kumiori!RenderPagePngOptions | RenderPagePngOptions}
- 同じ書体で何度も組む (印刷プレビューなど): {@link kumiori!createTypesetter | createTypesetter}
- ページを canvas に描く (ブラウザ。Web Worker の中では OffscreenCanvas): {@link kumiori!TypesetResult.renderPage | TypesetResult.renderPage} と {@link kumiori!RenderPageOptions | RenderPageOptions}
- 組んだ結果 (Area Tree) をたどる・読み書きする: {@link kumiori!walkAreaTree | walkAreaTree}・{@link kumiori!AreaTree | AreaTree}・{@link kumiori!serializeAreaTree | serializeAreaTree}・{@link kumiori!parseAreaTree | parseAreaTree}
- 画像の形式を足す (プラグイン): {@link kumiori!KumioriPlugin | KumioriPlugin}・{@link kumiori!ImageFormat | ImageFormat}
- draw.io の図: {@link kumiori!DrawioOptions | DrawioOptions}・{@link kumiori!createDrawioStencilRegistry | createDrawioStencilRegistry}
- Node でファイルシステムから書体・資源を読む: {@link kumiori/node!createFontLoader | createFontLoader}・{@link kumiori/node!createFileResolver | createFileResolver}

## モジュール

- `kumiori`: ライブラリの本体 (ブラウザでも Node でも動く)。ブラウザ向けの 1 ファイル `kumiori/browser` も、同じ API を出します (Web Worker の中でも使えます)
- `kumiori/node`: Node 用の部品 (ファイルシステムを使うので、ブラウザでは読み込まない)

ここに載っているものだけが公開の API です (ほかのモジュールの関数・型は、版の間で変わることがあります)。
