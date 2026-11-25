> English: [../en/conformance.md](../en/conformance.md)

# Kumiori 対応仕様説明書

XSL-FO 1.1・CSS・MathML の要素とプロパティごとに、仕様の定義と、仕様がそこで何を決めているかの要約 (節の番号を添えたもの)、Kumiori での扱い、Kumiori で組んだ例と、そのサンプルのコードを並べた文書です。対応していない要素・プロパティ・値も、名前を挙げて一覧にしています。文書そのものも、それぞれの言語で書かれ、Kumiori で組まれます。

| 文書 | 原稿 | 内容 |
| --- | --- | --- |
| XSL-FO 1.1 編 | `fo/kumiori-xsl-fo.fo` | XSL-FO の要素とプロパティ、FO の中の MathML、画像の形式、対応していない要素とプロパティ、付録に AH Formatter 向けの拡張 (axf:) の解釈・互換の設定・出典 |
| HTML と CSS 編 | `html/kumiori-html-css.html`・`html/kumiori-html-css.css` | CSS のプロパティ (ページ・ボックス・回り込み・フォント・文字と行・飾り・縦書き・ルビ・リスト・表・段組・flex と grid・改ページと脚注・画像と数式)、対応していないプロパティ、付録に AH Formatter 向けの拡張 (-ah- の一覧を含む)・互換の設定・出典 |
| XSL-FO 1.1 編 (英語版) | `fo/kumiori-xsl-fo.en.fo` | 上の英訳 (サンプルは同じ。本文・表・目次・しおりが英語)。`out/kumiori-xsl-fo.en.pdf` |
| HTML と CSS 編 (英語版) | `html/kumiori-html-css.en.html` (CSS は共通) | 上の英訳 (サンプルは同じ)。`out/kumiori-html-css.en.pdf` |

## 作り方

```bash
npm run docs:conformance
```

`docs/conformance/out/` に PDF ができます (リポジトリには入れません。日本語版 2 冊と英語版 2 冊)。`dist-cli` が無ければ、先に `npm run build:cli` を実行します。

組んだ PDF は、バージョンごとに GitHub のリリースに付けます (リリースを公開すると `.github/workflows/conformance-pdf.yml` が組んで付ける。[`docs/RELEASING.md`](../RELEASING.md) の「バージョンを出すたびに」)。

- 奥付の「組版」の項目のバージョンは、原稿には書かず、組むときに `package.json` のバージョンを入れます (原稿の `<?kumiori-version?>`・`<!--kumiori-version-->` の印)。リリースに付ける PDF は、そのリリースのバージョンになります。
- XSL-FO 編は、コマンドの既定の `--compat spec` (XSL-FO 1.1 の初期値) で組みます。
- 本文のフォントは Kumiori の既定です。和文は Noto Serif JP・Noto Sans JP、欧文は Tinos・Arimo (それぞれ Regular と Bold)、等幅は Cousine、数式は STIX Two Math、どのフォントにも無い記号・絵文字は Noto Sans Symbols 2・Noto Emoji を使います。Kumiori が配信元から取得します。
- 言語・文字ごとのサンプル、絵文字のサンプル、可変フォントのサンプル (HTML と CSS 編の 5.6〜5.8 節、XSL-FO 1.1 編の 5.1 節・5.6 節) は、既定のフォントに無い文字・機能を使うので、`scripts/conformance-fonts.mjs` の一覧のフォントで組みます (Noto Sans の各文字のフォント、Noto Serif Tibetan、Noto Color Emoji、Noto Emoji、Nabla、Anybody、Roboto Flex。合わせて約 29MB)。フォントのファイルはリポジトリに入れず、`scripts/build-conformance.mjs` が、Google Fonts の配信元 (fonts.gstatic.com) の、バージョンの付いた URL からキャッシュのディレクトリに取得します (無いものだけ。キャッシュのディレクトリは、環境変数 `KUMIORI_FONT_CACHE` か、無ければ `.cache/fonts`)。HTML と CSS 編のサンプルは、`@font-face` でその URL を指し、XSL-FO 1.1 編のサンプルには、コマンドの `--font` で渡します。取得できないフォントがあれば組まずに、コマンドが警告を出せば組んだ後に、エラーで終わります。
- 組んだ PDF には、使った文字だけを取り出したサブセットフォントが埋め込まれます。フォントのライセンスは、Noto Serif JP・Noto Sans JP・STIX Two Math・Noto Sans Symbols 2・Noto Emoji と、サンプルのフォント (`scripts/conformance-fonts.mjs` の一覧のもの) が SIL Open Font License 1.1、Tinos・Arimo・Cousine が Apache License 2.0 です ([`docs/fonts.md`](../fonts.md))。フォントの著作権は、それぞれの著作権者にあります。

## サンプルの書き方

サンプルは原稿の中に一度だけ書き、前後に印を付けます。

- XSL-FO: `<?kumiori-sample id="名前"?>` … `<?kumiori-sample-end?>`
- HTML: `<!--kumiori-sample id="名前"-->` … `<!--/kumiori-sample-->`

印の間はそのまま組まれます (組版例)。`scripts/build-conformance.mjs` が、組む前に印の間の原文をコードの表示にして、組版例の後に差し込みます。印に `mark="文字列|文字列"` を書くと、コードの表示の中のその文字列を強調します。`test/conformance.test.ts` は、同じサンプルを 1 つずつ、それだけで組める文書にして組み、警告が出ないことを確認します。

## 対応の確認の仕方と、生成した部分

「対応」「一部」「未対応」は、要素やプロパティを指定した文書と指定しない文書を Kumiori で読み込み、組版に渡す中身 (論理的な木) を比べて確認しています。指定しても中身が変わらないものを未対応とし、各文書の「対応していない…」の章に名前を挙げています。

節の番号、目次、プロパティの定義の行 (仕様のプロパティの表の Initial・Applies to・Inherited などの値。英語のまま)、未対応の一覧は、取得した仕様からスクリプトで生成し、原稿に書き込んでいます (`gen` の印の間。スクリプトと取得した仕様はリポジトリに入れていません)。拡張 (axf:・-ah-) の説明と値の意味の表は、Kumiori の解釈を Kumiori 自身の言葉で書いたものです。

## 画像

`fo/images/` と `html/images/` の画像のうち、`woven.*` と `checker.png` は、`scripts/make-conformance-images.py` で描画した自作の絵です (`woven.*` は、同じ絵を Kumiori が読む 12 の形式 (WebP は非可逆と可逆の 2 つ) で書き出したもの。`woven.drawio` は draw.io の図)。`kumiori-logo.svg` は `assets/logo/` のロゴのコピーで、このスクリプトでは作りません。

- ラスター: PNG・JPEG・GIF・BMP・TIFF・WebP (非可逆と可逆)
- ベクター: SVG・EPS・WMF・EMF・CGM

ラスター画像は Pillow で書き出します。ベクター画像は、ファイルの中身をスクリプトが直接組み立てます。

```bash
python3 scripts/make-conformance-images.py
```

## 引用と要約

W3C の仕様の文は引用していません。項目ごとに仕様の節の番号を示し、仕様がそこで何を決めているかを、自分の言葉の 1 文の要約にしています (原文を訳しただけの文にはしていません。英語版の要約も、原文の英文に戻さずに書いています)。プロパティの定義の行には、仕様の定義の表の値 (初期値など) を英語のまま載せています。参照した仕様書は、各文書の付録「出典」に、名前・参照したバージョン (バージョンの種類と日付) とその URL・取得元の URL と取得日の一覧にしています。製品のマニュアルも引用していません。
