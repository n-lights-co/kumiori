> English: [../en/conformance.md](../en/conformance.md)

# Kumiori 対応仕様説明書

XSL-FO 1.1・CSS・MathML の要素とプロパティごとに、仕様の定義と原文、Kumiori での扱い、Kumiori で組んだ例と、その見本のコードを並べた文書です。対応していない要素・プロパティ・値も、名前を挙げて一覧にしています。文書そのものも、それぞれの言語で書かれ、Kumiori で組まれます。

| 文書 | 原稿 | 内容 |
| --- | --- | --- |
| XSL-FO 1.1 編 | `fo/kumiori-xsl-fo.fo` | XSL-FO の要素とプロパティ、FO の中の MathML、画像の形式、対応していない要素とプロパティ、付録に AH Formatter 向けの拡張 (axf:) の解釈・互換の設定・出典 |
| HTML と CSS 編 | `html/kumiori-html-css.html`・`html/kumiori-html-css.css` | CSS のプロパティ (ページ・箱・回り込み・書体・文字と行・飾り・縦書き・ルビ・リスト・表・段組・flex と grid・改ページと脚注・画像と数式)、対応していないプロパティ、付録にAH Formatter 向けの拡張 (-ah- の一覧を含む)・互換の設定・出典 |
| XSL-FO 1.1 編 (英語版) | `fo/kumiori-xsl-fo.en.fo` | 上の英訳 (見本は同じ。本文・表・目次・しおりが英語)。`out/kumiori-xsl-fo.en.pdf` |
| HTML と CSS 編 (英語版) | `html/kumiori-html-css.en.html` (CSS は共通) | 上の英訳 (見本は同じ)。`out/kumiori-html-css.en.pdf` |

## 作り方

```bash
npm run docs:conformance
```

`docs/conformance/out/` に PDF ができます (リポジトリには入れません。日本語版 2 冊と英語版 2 冊)。`dist-cli` が無ければ、先に `npm run build:cli` を実行します。

組んだ PDF は、版ごとに GitHub のリリースに付けます (リリースを公開すると `.github/workflows/conformance-pdf.yml` が組んで付ける。[`docs/RELEASING.md`](../RELEASING.md) の「版を出すたびに」)。

- XSL-FO 編は、コマンドの既定の `--compat spec` (XSL-FO 1.1 の初期値) で組みます。
- 書体は Kumiori の既定です。和文は Noto Serif JP・Noto Sans JP、欧文は Tinos・Arimo、等幅は Cousine、数式は STIX Two Math を使います。Kumiori が配信元から取得します。

## 見本の書き方

見本は原稿の中に一度だけ書き、前後に印を付けます。

- XSL-FO: `<?kumiori-sample id="名前"?>` … `<?kumiori-sample-end?>`
- HTML: `<!--kumiori-sample id="名前"-->` … `<!--/kumiori-sample-->`

印の間はそのまま組まれます (組版例)。`scripts/build-conformance.mjs` が、組む前に印の間の原文をコードの表示にして、組版例の後に差し込みます。印に `mark="文字列|文字列"` を書くと、コードの表示の中のその文字列を強調します。`test/conformance.test.ts` は、同じ見本を 1 つずつ、それだけで組める文書にして組み、警告が出ないことを確かめます。

## 対応の確かめ方と、生成した部分

「対応」「一部」「未対応」は、要素やプロパティを指定した文書と指定しない文書を Kumiori で読み込み、組版に渡す中身 (論理的な木) を比べて確かめています。指定しても中身が変わらないものを未対応とし、各文書の「対応していない…」の章に名前を挙げています。

節の番号、目次、プロパティの定義の行 (仕様のプロパティの表の Initial・Applies to・Inherited などの原文)、未対応の一覧は、取得した仕様からスクリプトで生成し、原稿に書き込んでいます (`gen` の印の間。スクリプトと取得した仕様はリポジトリに入れていません)。拡張 (axf:・-ah-) の説明と値の意味の表は、Kumiori の解釈を Kumiori 自身の言葉で書いたものです。

## 画像

`fo/images/` と `html/images/` の画像は、`scripts/make-conformance-images.py` で描いた自作の絵です。同じ絵を、Kumiori が読む 12 の形式で書き出しています。

- ラスター: PNG・JPEG・GIF・BMP・TIFF・WebP (非可逆と可逆)
- ベクター: SVG・EPS・WMF・EMF・CGM

ラスター画像は Pillow で書き出します。ベクター画像は、ファイルの中身をスクリプトが直接組み立てます。

```bash
python3 scripts/make-conformance-images.py
```

## 引用

W3C の仕様の文は、取得した原文のまま引用しています。取得元と取得日は、各文書の付録「出典」に記しています。引用した文の著作権は W3C にあり、付録「出典」には、各文書の取得した版・元の文書の著作権表示・ライセンスと、ライセンスの本文も載せています。製品のマニュアルは引用していません。
