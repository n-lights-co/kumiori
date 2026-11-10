> English: [CHANGELOG.en.md](CHANGELOG.en.md)

# 変更の記録

版の番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。0.x の間は、互換の無い変更も minor の版 (0.2.0 など) で出すことがあります。

## 0.2.0 (未公開)

flex・WOFF/WOFF2・参照の読み込みの API などを足した版。0.x の間なので、組版の結果が変わる修正も含めて minor の版にします。

- **flex** (Flexbox 1。Node のコマンドと既定の組み方):
  - 縮め方 (`flex-shrink`、`min-width: auto` の自動の最小の大きさ)、伸ばす上限 (`max-width` で止めて残りを分ける)、`flex-grow` の合計が 1 未満の伸ばし方
  - 逆向き (`row-reverse`・`column-reverse`・`wrap-reverse`)、`direction: rtl` の容器、縦書きの容器
  - 揃え: `baseline`・`last baseline`、交差軸の `margin: auto`、`justify-content` の `start`・`end`・`left`・`right`・`safe`・`unsafe`、折り返しの容器の `align-content`
  - 縦並び: `row-gap`・`flex-basis`・`flex-shrink`・`flex-wrap` (列に折り返す)、高さの決まった容器の伸ばし方
  - `order` を `::before`・`::after` と `display: contents` の子にも効かせる。容器の直下の文字を無名の項目にする
  - `gap` の百分率、`flex-basis` の `min-content`・`fit-content`、`visibility: collapse` の項目 (支柱)
- **CSS**:
  - `visibility` (`hidden`・`collapse`)、`aspect-ratio` に対応
  - 幅の決まった箱の左右の余白を CSS 2.1 §10.3.3 に合わせた (`direction: rtl` の包含ブロックでは右端から置く。一方だけが `auto` の余白は、組むときに残りを取る)
  - `min-height` の箱の最後の子の下の margin の畳み方を CSS 2.1 §8.3.1 に合わせた
  - `width` と `max-width` の両方がある `display: block` の画像で、包む箱を画像の幅にした
  - 名前付きページ: 流れの外の箱 (絶対配置・回り込みなど) だけの最初のページを作らない (CSS Page 3 §8.1)
  - 印刷に関わらないプロパティ (`cursor`・`transition-*` など) を、未対応の CSS の警告に出さない
- **リンクとしおり**: ブロック・flex・表の `<a href>` も箱の全体をリンクにする。相対参照のリンク (PDF は GoToR、ほかのファイルは Launch)。どの既定のスタイルでも `h1`〜`h6` をしおりにする (CSS GCPM 3 の付録 B)
- **表**: `border-collapse: collapse` の表で、改ページで繰り返す表ヘッダー・表フッターとの境目の罫線を、両側の線から選び直す (XSL 1.1 §6.7.10・CSS 2.1 §17.6.2.1)
- **書体**: WOFF・WOFF2 (書体の集まりを含む) を読む (`--font`・`fonts`・`@font-face`)。`@font-face` が `http(s):` で参照する書体も取る (`unicode-range` が文書の字と重なるものだけ)
- **PDF**: ToUnicode で、合字の字 (U+FB01 など) を元の字の並び (fi など) にする。PDF から取り出した字や検索で「confiance」などが見つかる
- **API**:
  - `resolveResource(url)`: 文書・CSS が参照するファイルのうち、`files` に無いものを問い合わせる
  - `fetchStyles`: 文書が `http(s):` で参照する CSS (`@import` の先も) を取る (既定 `true`)
  - `kumiori/node`: `createFontLoader` (Node のコマンドと同じ既定の書体の読み込みとキャッシュ)、`createFileResolver` (`file:` の参照を読む)、`defaultFontCacheDir`・`looksLikeFont`
- **Node のコマンド**: `file:` の URL の参照を読む。`--no-fetch-styles` で CSS を取らない
- **公開**: 対応仕様説明書の PDF (日本語版と英語版の 4 冊) を、版ごとに GitHub のリリースに付ける。奥付の「組版」の欄は、組んだ Kumiori の版にする
- **第三者の表示**:
  - @pdf-lib/fontkit の配布物に取り込まれたもの (Brotli の展開・base64-js・buffer など) の表示を足した
  - CSS GCPM 3 の付録 B から写した規則の表示を足した (10 節)
  - 出力する JS のファイルの先頭に、Kumiori の版・ライセンスと `THIRD_PARTY_NOTICES.md` の場所を書いた注釈を付ける (CDN からファイルを 1 つだけ読む場合のため)
  - 対応仕様説明書の PDF に埋め込む書体とそのライセンスを、説明書の README に書いた

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
