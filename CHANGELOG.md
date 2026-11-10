> English: [CHANGELOG.en.md](CHANGELOG.en.md)

# 変更の記録

版の番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。0.x の間は、互換の無い変更も minor の版 (0.2.0 など) で出すことがあります。

## 未公開

次の版に入る変更。公開するときに、見出しを版の番号と公開の日付にする ([`docs/RELEASING.md`](docs/RELEASING.md))。

- **HTML+CSS の組版**:
  - flex の縮め方 (`flex-shrink`・自動の最小の大きさ)、逆向き (`row-reverse`・`column-reverse`・`wrap-reverse`)、基線の揃え (`align-items: baseline`・`last baseline`)、交差軸の `margin: auto`、`order`、縦並びの伸び縮み・折り返し、縦書きの容器に対応した (Flexbox 1)
  - `visibility: hidden`・`collapse`、`aspect-ratio`、幅の決まった箱の左右の auto の余白と rtl の包含ブロック、`page` で決めるページの名前 (絶対配置・回り込みの箱は名前を変えない) に対応した
  - 文書が `http(s):` で参照する CSS (`<link rel="stylesheet">`・`@import`) と、その `@font-face` の書体を取るようにした (`unicode-range` が文書の字と重なるものだけ)。ライブラリの `fetchStyles`、コマンドの `--no-fetch-styles` で止められる
  - 書体のファイルに WOFF・WOFF2 を使えるようにした (`--font`・`files`・`fonts`・`@font-face`。sfnt に戻して埋め込む)
  - 印刷に関わらないプロパティ (`cursor`・`user-select`・`will-change` など) は、未対応の警告に出さないようにした
- **XSL-FO の組版**: collapse の表で、改ページで繰り返す表ヘッダー・表フッターと、そのページの最初・最後の行の境目の罫線を、接する行どうしの線から選び直すようにした (XSL-FO 1.1 §6.7.3・§6.7.10)
- **PDF**: 合字 (fi など) の字の ToUnicode を、元の字の並びにした (文字の検索・写しで元の字になる)
- **ライブラリ**: `resolveResource` (文書・CSS が参照するファイルのうち `files` に無いものの中身を返す関数) を足した。Node 用の部品 `kumiori/node` (`createFontLoader`・`createFileResolver`・`defaultFontCacheDir`) を足した
- **Node のコマンド**: 文書・CSS が `file:` の URL で参照するファイルを、入力のディレクトリの外でも読むようにした
- **公開**: リリースを公開すると、対応仕様説明書の PDF 4 冊 (日本語版・英語版) をリリースに付けるワークフロー (`.github/workflows/conformance-pdf.yml`) を足した

## 0.1.1 (2026-11-09)

第三者のソフトウェアと文書の表示を補った版。組版の動きと API は 0.1.0 と同じです。

- **第三者の表示** (`THIRD_PARTY_NOTICES.md`。配布物の `dist-lib`・`dist-cli`・`dist-browser` にも入る):
  - W3C の文書から写した既定のスタイルシートの規則 (CSS Ruby 1 の付録 A.1、CSS 2.1 の付録 D) の著作権表示とライセンス (W3C Document License の本文を含む) を足した
  - WebP の読み込みのコードの一部が libwebp から派生していることを明記した (libwebp の表示は 0.1.0 から載せていたもの)
  - @pdf-lib/standard-fonts に含まれる Adobe の標準 14 書体の寸法 (AFM) の配布条件の本文を足した
  - 依存パッケージを束ねる配布物の説明を直した (`dist-browser` は @xmldom/xmldom も束ね、`dist-lib` は束ねない)
- **README**: `LICENSE`・`NOTICE`・`THIRD_PARTY_NOTICES.md` が 4 つのビルドの出力すべてに入ることを書いた
- **文書**: 対応仕様説明書 (日本語版と英語版) の付録「出典」に、引用した W3C の仕様の版・著作権表示・ライセンスの本文を足した

## 0.1.0 (2026-11-08)

最初の公開版。

- **入力**: HTML+CSS (自前の CSS カスケード)、XSL-FO 1.1 (アンテナハウスの拡張 `axf:*` のうち、よく使われるものを中心に一部に対応)、JSON の論理ツリー
- **日本語組版**: 縦書き・横書き、ルビ、縦中横、圏点、禁則、ぶら下げ・追い出し、約物の詰め、和欧間のアキ (JLREQ)
- **ページ**: ページマスター、柱・ノンブル、脚注、段組、回り込み、表 (分割・ヘッダーの繰り返し・列幅の自動決定)、ページ番号の参照、しおり、リンク、注釈、フォーム
- **出力**: Canvas のプレビュー、PDF (書体のサブセット埋め込み、トンボ、PDF/X-3 の印)
- **多言語**: アラビア語・ヘブライ語などの右から左の文字 (UAX #9、アラビア文字の連結形)、欧文のハイフネーション
- **使い方**: ブラウザの画面、Node のコマンド `kumiori` (`--help`・`--version`、既定の書体のキャッシュ、未対応の CSS・XSL-FO の警告、`--lang ja|en` と `KUMIORI_LANG` で文言を英語にも)、ライブラリ (`kumiori`: ES モジュール、`kumiori/browser`: 依存まで束ねたブラウザ用の 1 ファイル。`lang` オプションで警告を英語にも)
- **文書**: 対応仕様説明書 (HTML と CSS 編・XSL-FO 編。日本語版と英語版)、Area Tree の JSON の仕様。README と docs の英語版 (README.en.md・docs/en/)
