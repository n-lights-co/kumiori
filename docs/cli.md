> English: [en/cli.md](en/cli.md)

# kumiori (Node のコマンド)

HTML+CSS・XSL-FO の文書を、ブラウザーを使わずに PDF (と、ページごとの SVG・PNG) に組むコマンドです。
npm から入れたときは `kumiori` (入れずに使うなら `npx kumiori`)、このリポジトリで作ったとき (`npm run build:cli`) は `node dist-cli/cli.js` が同じコマンドです。

- [構文](#構文)
- [よく使う例](#よく使う例)
- [オプション一覧](#オプション一覧)
  - [基本](#基本) ・ [入力と出力先](#入力と出力先) ・ [出力の形式](#出力の形式) ・ [スタイルと互換](#スタイルと互換) ・ [フォント](#フォント)
  - [印刷 (トンボ・特色・PDF/X)](#印刷-トンボ特色pdfx) ・ [PDF/A](#pdfa) ・ [タグ付き PDF と PDF/UA](#タグ付き-pdf-と-pdfua)
  - [リンク](#リンク) ・ [外部の取得と読み込みの安全](#外部の取得と読み込みの安全) ・ [メモリ](#メモリ) ・ [診断](#診断) ・ [draw.io の図](#drawio-の図) ・ [プラグイン](#プラグイン)
- [入力の読み方](#入力の読み方)
- [上限とメモリ](#上限とメモリ)
- [詳しい例と出力](#詳しい例と出力)
- [環境変数](#環境変数)
- [終了ステータス](#終了ステータス)

## 構文

```text
kumiori <HTML ファイル> [-o <PDF ファイル>] [オプション]...
kumiori <FO ファイル (.fo・.xml)> [-o <PDF ファイル>] [オプション]...
kumiori <入力>... -o <出力先のディレクトリ> [オプション]...
kumiori - [-o -] [--base <ディレクトリ>] [オプション]... < 入力 > 出力.pdf
kumiori --help | --version
```

表記の規則:

- `<必須の引数>`: 置き換えて書く値 (`<HTML ファイル>` は `book.html` など)
- `[任意のオプション・引数]`: 書かなくてもよいもの
- `a|b`: どれか 1 つを書く (`--format pdf|svg|png` は `--format svg` など)
- `...`: 何度でも書ける

`--help` は、使えるオプションをすべて並べます (`--lang en` で英語)。オプションの順は自由で、入力の前にも後にも書けます。知らないオプション・値のエラーは、何もせずにエラーで終わります ([終了ステータス](#終了ステータス))。値をとるオプションの値の所に、ほかのオプションの名前 (`-o --print` の `--print` など) があると、値の書き忘れとしてエラーにします (その名前のファイルを使うときは `./--print` のように書きます)。値は空にできません: ファイル・ディレクトリ・プラグインのパスをとるオプション (`-o`・`--font-dir`・`--font-cache`・`--font`・`--css`・`--base`・`--spot-colors`・`--output-profile`・`--drawio-stencils`・`--plugin`) と、名前をとる `--ignore-warning`・`--output-condition` の空の値 (`''`。`,` で区切るものは、項目が 1 つも無い値も) は、今のディレクトリや「書いていない」とは見なさずに、値のエラーにします。エラーの文の制御文字 (ESC など) は、`\x1b` のように見える形にして書きます。

## よく使う例

**HTML を PDF に**

```bash
kumiori book.html -o book.pdf
```

**XSL-FO を PDF に**

```bash
kumiori book.fo -o book.pdf
```

**まとめて変換する (出力先のディレクトリへ)**

```bash
kumiori a.html b.fo c.html -o out
```

**直すたびに組み直す**

```bash
kumiori book.html --watch
```

**標準入力から読み、標準出力へ書く**

```bash
cat book.html | kumiori - -o - --base . > book.pdf
```

**ページを PNG にする (150dpi、1〜3 ページ目)**

```bash
kumiori book.html -o book.png --dpi 150 --pages 1-3
```

**ページを SVG にする**

```bash
kumiori book.html -o book.svg
```

**入稿用の PDF/X-4 にする (トンボと塗り足しも)**

```bash
kumiori book.html -o book.pdf --print --pdfx x4 --output-profile JapanColor2001Coated.icc
```

**長期保存用の PDF/A-3b にする**

```bash
kumiori book.html -o book.pdf --pdfa 3b
```

**PDF/UA-1 (アクセシブルなタグ付き PDF) にする**

```bash
kumiori book.html -o book.pdf --pdfua --document-lang ja
```

**手元のフォントで組む**

```bash
kumiori book.html -o book.pdf --font BIZUDMincho-Regular.ttf --generic-font serif-cjk="BIZ UDMincho"
```

**他人の書いた文書を、外の取得とファイルの読み込みを止めて組む**

```bash
kumiori upload.html -o upload.pdf --no-fetch-images --no-fetch-styles --no-outside-files
```

**診断を JSON で出し、警告があれば CI で落とす**

```bash
kumiori book.html -o book.pdf --diagnostics json --fail-on warning
```

## オプション一覧

表の「既定」の「—」は、書かなければその働きをしないことです。「何度でも」と書いたものは、同じオプションを何度でも書けます。

### 基本

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `-h`, `--help` | — | — | 使い方を標準出力に書いて終わる (終了コード 0) |
| `-v`, `--version` | — | — | バージョンを標準出力に書いて終わる (終了コード 0) |
| `--lang` | `ja` \| `en` | 環境で決める ([環境変数](#環境変数))。決まらなければ `ja` | 使い方・報告・警告・エラーの文の言語 |

### 入力と出力先

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| (入力) | ファイル、または `-` | — (必須) | 組む文書。`.html`・`.htm`・`.xhtml`・`.xht` は HTML、`.fo`・`.xml` は XSL-FO。`-` は標準入力 |
| `-o`, `--output` | ファイル・ディレクトリ・`-` | 入力の隣の `<入力名>.pdf` (`.svg`・`.png`) | 出力のファイル。入力が複数か、既にあるディレクトリか、`/` で終わる名前なら、出力先のディレクトリ (ディレクトリにするのは、標準入力のときは使えない)。`-` は標準出力。⚠️ 既にあるファイルは、尋ねずに上書きする |
| `--base` | ディレクトリ | 今のディレクトリ | 標準入力 (`-`) の文書の CSS・画像・フォントを探すディレクトリ |
| `--fo` | — | 拡張子で決める | 拡張子によらず XSL-FO として読む |
| `--xhtml` | — | 拡張子で決める | 拡張子によらず、HTML を XML の構文 (XHTML) で読む |
| `--watch` | — | — | 入力のディレクトリの HTML・FO・CSS・画像・フォントが変わるたびに組み直す (Ctrl+C で終わる)。標準入力とは使えない |

- 入力が複数なら、`-o` は出力先のディレクトリ (無ければ作る。既にあるファイルならエラー (終了コード 1)。`-o` が無ければ各入力の隣に書く)。1 つ失敗しても、ほかは作る (終了コードは 1)。出力の名前がぶつかるとき (同じディレクトリの `a.html` と `a.fo`、別のディレクトリの同じ名前の入力を 1 つの出力先へ) は、後のものに入力の名前を拡張子ごと残す (`a.fo.pdf`・`a.html.pdf`)。それでもぶつかれば `.2`・`.3` … を追加する (`a.html.2.pdf`)。`-2` のような印にしないのは、`--format svg`・`png` のページの番号 (`a-2.svg`) と重ならないため。入力が 1 つでも、`-o` が既にあるディレクトリなら、その中に `<入力名>.pdf` (`--format svg`・`png` では `.svg`・`.png`) を書く
- 入力が 1 つで、`-o` が `/` (Windows では `\` も) で終わるときは、ディレクトリと見なす。あればその中に `<入力名>.pdf` を書き、無いか、ファイルならエラー (終了コード 1。作らない)。`/` で終わらない名前は、無ければファイルの名前と見なす (`-o out` は `out` という名前のファイルを書く)
- ⚠️ 出力のファイルが既にあれば、尋ねずに上書きする。ただし、書く先が、その変換で読むファイル (入力 (標準入力の元のファイルも)、文書の使う画像・CSS・フォント、`--font-dir`・`--font-cache` から読んだフォント、`--css`・`--font`・`--spot-colors`・`--output-profile`・`--drawio-stencils`・`--plugin` のファイルと、`--drawio-stencils` に渡したディレクトリの下のファイル。ハードリンクの別名も同じファイルと見なす) か、同じ実行で別の入力から書いた出力 (`a.html` の `a-2.svg` と、`a-2.html` の `a-2.svg` など) なら、書かずにエラー (終了コード 1。`-o one.html` で入力を上書きしない。`<img src="fig.svg">` の `fig.html` を `--format svg` で組んでも、画像の `fig.svg` を消さない)。`--format svg`・`png` で複数ページの文書は、どのページも書く前に確認するので、エラーのときは 1 枚も書かない。見るのは、その入力の変換で読んだファイルなので、入力が複数のとき、前の入力が読んだ画像を後の入力の出力で上書きすることはある (`a.html` が `b.svg` を使い、`b.html` を `--format svg` で組むと、`b.svg` は `b.html` のページになる。そうしたくないときは `-o` で別の出力先にする)。同じ入力を何度も渡すと (`a.html a.html`・`./a.html a.html` のように、同じディレクトリの同じ名前を)、1 度だけ組み、そう通知する (別のディレクトリのシンボリックリンク・ハードリンクの別名は、別の入力として組む)。大文字と小文字を区別しない機械 (macOS・Windows) では、`A.html` と `a.fo` の出力の名前もぶつかるものと見なす。入力が 1 つのとき、`-o` のファイルを置くディレクトリが無いと (`-o nodir/book.pdf`) エラーになる
- PDF (`--pdfx`・`--pdfa` を除く) は、出力のファイルと同じディレクトリの一時のファイル (`<出力>.part-<乱数>`) へページごとにストリームで書き出し、書き終えたら名前を替える (API の `typesetToPdfStream`。PDF の全体をメモリに持たない)。途中で失敗・中断したら (Ctrl+C の SIGINT・SIGTERM・SIGHUP で止めたときも) 一時のファイルを消すので、書きかけの PDF は残らず、前の出力もそのまま残る (`--watch` で開いている PDF が、書きかけになることもない)。一時のファイルは、組み終えて PDF を書き始める所で作る。`--low-memory` では、書いている間のシグナルが、組版の待てる所まで遅れることがある。名前を替えるので、前の出力の許可の印 (mode) はコピーするが、持ち主・グループ・ACL・拡張属性は引き継がず、ハードリンクの別名は前の中身のまま残る。出力がシンボリックリンク (`-o /dev/stdout` も) か、ふつうのファイルでないものなら、標準出力 (`-o -`) と `--pdfx`・`--pdfa` のときと同じく、全体を作ってから書く。読み取り専用の前の出力と、一時のファイルを作れない所 (出力のディレクトリに書けない・名前が長すぎる・ディレクトリが無い など) でも、流さずに全体を作ってから出力へ直に書く (エラーも前と同じ)
- `-o` の値は空にできない (`-o ''` は値のエラー、終了コード 1。`-o` 無しと同じには扱わない)
- `-` は標準入力から読む (CSS・画像・フォントは `--base` のディレクトリから。FO かどうかは中身で見分ける)。`-o -` は PDF を標準出力へ書く (報告は標準エラーへ)。標準入力は、ほかの入力・`--watch` とは一緒に使えない。標準入力の文書には名前が無いので、`-o` には `/` で終わる名前も既にあるディレクトリも使えない (エラー、終了コード 1。`-o out.pdf` のようにファイルの名前を書く)。入力が複数のときは `-o -` を使えない (同じ入力を何度も渡して、まとめて 1 つになったときは使える)
- 入力の文字の符号化は、BOM と XML 宣言の `encoding` (`Shift_JIS`・`EUC-JP` など)・HTML の `<meta charset>` で決める (無ければ UTF-8)
- 変換の報告 (`book.pdf: 3 ページ (組版 40ms)`) は標準出力に書く (`-o -` のときと、出力が標準出力と同じもののとき (`-o /dev/stdout > out.pdf`・`-o /dev/stdout | cat > out.pdf`) は標準エラー)。診断は標準エラーに書く ([診断](#診断))

### 出力の形式

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--format` | `pdf` \| `svg` \| `png` | `pdf` (`-o` の拡張子が `.svg`・`.png` ならその形式。`-o` がディレクトリのときは拡張子を見ない) | 出力の形式。`svg`・`png` はページごとに書く |
| `--pages` | 範囲 (`1-3,5,7-`) | すべてのページ | SVG・PNG に書くページ (1 から数える)。`--format svg`・`png` のときだけ |
| `--dpi` | 数 (0 より大きく 2400 まで) | `96` | PNG の解像度 (1 インチあたりのピクセルの数)。`--format png` のときだけ |
| `--max-pages` | 1 以上の整数 | すべてのページ | 先頭から N ページまで組んだら止める (長い文書のプレビュー)。PDF・SVG・PNG のどれにも効く |

- `-o` の拡張子 (`.pdf`・`.svg`・`.png`) と食い違う `--format` はエラー
- `png` は、ページを PNG (8 ビットの RGB。紙は白) にする (依存を追加せず、自前でラスタライズする)。描画しないものは SVG と同じで、ほかに CMYK の JPEG・インターレースの PNG の画像は描画せずに警告を出す。上限は [上限とメモリ](#上限とメモリ)
- `svg` は、ページを SVG にする (文字はフォントのアウトラインのパスにし、画像は SVG の中に埋め込むので、フォント・画像のファイルが無くても描画できる。大きさは紙の大きさ (pt))
- SVG・PNG でも、PDF と同じく、SVG の画像の `switch` の子は `--svg-lang` で選び、`foreignObject` の中身は本文と同じ組版で組んで描画する
- 文書が複数ページなら、ページごとに `-<番号>` を付けた名前 (`book-1.svg`・`book-2.svg` …。番号はページ数の桁にそろえる) に書く (`--pages` で 1 ページだけ選んでも番号を付ける)。`-o -` (標準出力) は、書くページが 1 つのときだけ
- `--pages` は、番号と範囲をカンマで区切る (`7-` は 7 ページ目から最後まで)。文書に無いページを指すと、何も書かずにエラーになる
- `--dpi` は、数字と小数点で書く (`150`・`72.5`)。1 枚 4,000 万ピクセルまで
- `--max-pages` は、API の `maxPages` と同じ ([`docs/library.md`](library.md) の「先頭の数ページだけを組む」)。止めたら、報告の行に「`--max-pages N で止めた`」と書き、情報 (`info`) の `layout/max-pages-reached` を出す
  - N ページより後ろを指すページ番号の参照・最後のページの番号・総ページ数は `"?"` で組み (`--style weasyprint` では空)、索引は N ページまでの所だけを並べ、しおりはリンク先の無いしおりにして、警告 `layout/beyond-max-pages` を種類ごとに 1 件出す
  - 残したページの組みは、本文に N ページより後ろを指すものが無ければ、全体を組んだときと同じ。あると、その文字が `"?"` になり、本当の数との幅の違いで行分けと改ページがずれることがある (リーダーの後ろに番号を置く目次は、まず変わらない)。柱の中だけの参照は、その文字だけが変わる
  - 速くなるのは組版と PDF の書き出しの分で、文書の読み込みとカスケードは全体で行う
  - `--pages` が N より後ろのページを指すと、文書に無いページとしてエラーになる
- SVG には、リンク (本文のリンクと SVG の画像の中のリンク) を、PDF と同じポリシー (`--link-schemes`・`--link-launch`・`--link-relative`。[リンク](#リンク)) に通して書く。文書の中の別のページへのリンクは、そのページを書くファイルの名前に `#id` を付けたもの (`book-3.svg#id`。同じディレクトリ。`--pages` で選ばなかったページも、その名前)、同じページへのリンクは `#id` (標準出力に書くときは、別のページへのリンクは書かない)。⚠️ 書き出した SVG を HTML の `img` で載せたときは、ブラウザーの規則でリンクは押せない (SVG をそのまま開くか、HTML に直に入れたときに押せる)
- PNG には、リンクは書かない。SVG・PNG には、注釈・フォームフィールドは書かない。PDF だけの指定 (`--pdfx`・`--pdfa`・`--pdfua`・`--output-profile`・`--output-condition`・`--tagged`・`--image-max-dpi`・`--low-memory`・`--encrypt`・`--user-password`・`--owner-password`・`--deny`) とは一緒に使えない

### スタイルと互換

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--style` | `kumiori` \| `browser` \| `browser-margin` \| `ah` \| `vivliostyle` \| `weasyprint` | `kumiori` | HTML の既定のスタイル (画面の「設定」の「既定のスタイル」と同じ)。`ah`・`vivliostyle`・`weasyprint` は、他の組版ソフトに合わせる互換のスタイル |
| `--compat` | `spec` \| `antenna` | `spec` | XSL-FO の既定値の流儀 (`spec`: XSL-FO 1.1 の初期値 / `antenna`: AH Formatter 互換の既定値)。ほかの値はエラー |
| `--page-size` | 用紙 (`A5`・`"A5 landscape"`・`148mm,210mm`) | `A4` | HTML の既定の用紙 (`@page` で `size` を指定していない文書の用紙)。XSL-FO では使わない |
| `--css` | CSS のファイル (`a.css,b.css`) | HTML が参照する CSS だけ | 使う CSS を選ぶ (カンマ区切りで複数) |
| `--svg-lang` | 言語タグ (`ja,en`) | 実行環境の言語 | SVG の `systemLanguage` を照合する言語 |

- `--page-size` は、CSS の `size` と同じ書き方で、用紙の名前 (`A5`・`JIS-B5`・`letter` など)、向きを付けたもの (`"A5 landscape"`)、幅と高さ (`148mm,210mm`。区切りは空白かカンマ。長さは 1pt 以上) を書く。文書の `@page { size: … }` があれば、そちらが勝つ。`@media` の `width`・`height` も、この用紙で評価する
- `--css`: HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・フォントを使う (画面で一緒に選ぶのと同じ)。画像は、文書と CSS に名前が出てくるものだけを読む。CSS は、HTML が参照するもの (`<link>`・`@import`) だけを使う (参照していない CSS は当てずに、警告に出す)。`--css` で名前で指定した CSS は、`@import` 先も使い、HTML から参照されていなくても利用者のスタイルシートとして追加する
- `--svg-lang` は、SVG の `systemLanguage` (`switch` の子を選ぶ条件) を照合する言語 (言語タグをカンマで区切る。好む順)。SVG を置いた所に言語の指定 (`lang`・`xml:lang`・`language`) があれば、そちらが勝つ。既定の「実行環境の言語」は、Node の `Intl` の言語 (`LANG` などのロケールで決まる。[環境変数](#環境変数))
- `--compat` は XSL-FO の、`--style` は HTML の指定。`rgb-icc()` の読み方など、互換の指定で変わる動きは、各オプションの説明を見てください

### フォント

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--font` | フォントのファイル (TTF・OTF・TTC・WOFF・WOFF2) | — | フォントを追加する (何度でも)。システムに入れたフォントのように `font-family` から使う |
| `--generic-font` | `<総称>=<フォント名>` | 欧文 Tinos・Arimo・Cousine、和文 Noto Serif JP・Noto Sans JP | 総称ファミリーに使うフォント (何度でも) |
| `--font-dir` | ディレクトリ | — | 既定のフォントを読むディレクトリ (無ければキャッシュ、次に Google Fonts から取得する) |
| `--font-cache` | ディレクトリ | 環境変数 `KUMIORI_FONT_CACHE`、無ければ OS のキャッシュ | Google Fonts から取得した既定のフォントを保存して再利用するディレクトリ |
| `--no-font-cache` | — | — | フォントのキャッシュを読まず、保存もしない (毎回 Google Fonts から取得する) |
| `--system-fonts` | — | 使わない | 読み込んだどのフォントにも字形の無い文字を、OS のフォントで組む。`--no-outside-files` とは一緒に使えない |

- 既定のフォントは、Noto Serif JP・Noto Sans JP・Tinos・Arimo (等幅の指定があれば Cousine、MathML があれば STIX Two Math、どのフォントにも無い記号があれば Noto Sans Symbols 2、それにも無い絵文字があれば Noto Emoji)。パッケージには入れておらず、読む順は `--font-dir` → フォントのキャッシュ → ネットワーク (Google Fonts)。1 度読んだら、まとめて変換するときも再利用する
- `--font-dir <dir>`: 既定のフォント (`NotoSerifJP-Regular.ttf`・`NotoSerifJP-Bold.ttf`・`NotoSansJP-Regular.ttf`・`NotoSansJP-Bold.ttf`・`Tinos-*.ttf`・`Arimo-*.ttf`、等幅の指定があれば `Cousine-*.ttf`、MathML があれば `STIXTwoMath-Regular.ttf`、どのフォントにも無い記号があれば `NotoSansSymbols2-Regular.ttf`、それにも無い絵文字があれば `NotoEmoji-Regular.ttf`) を、同じ名前のファイルから読むディレクトリ。太字のファイル (`-Bold`) に、同じフォントの `-Regular` と同じ中身のファイルを置くと、太字のフォントは無いものとして、太字の文字は Regular を太らせて描画する (太字を持たないフォントに入れ替えるとき)。既定のフォントを手元のフォントに入れ替えるときは、太字のファイル (`NotoSerifJP-Bold.ttf`・`NotoSansJP-Bold.ttf` など) も置く: 置かなかったファイルは、キャッシュかネットワークの既定のフォントになり、入れ替えたフォントと混ざる
- `--font-cache <dir>`: 既定は環境変数 `KUMIORI_FONT_CACHE`、無ければ OS のキャッシュ (Linux は `$XDG_CACHE_HOME` か `~/.cache` の `kumiori/fonts`、macOS は `~/Library/Caches/kumiori/fonts`、Windows は `%LOCALAPPDATA%\kumiori\fonts`)。初回だけネットワークから取得し、`フォント … を取得して … に保存しました` と通知する。2 回目からはネットワークに行かない。途中で切れた取得など、フォントのファイルでないものは保存せず、壊れたキャッシュは捨てて取得し直す。保存できない場所でも変換は続ける。オフラインで使うときは、1 度オンラインで動かしてキャッシュに入れるか、`--font-dir` で読むディレクトリを指定する
- `--font <フォントファイル>`: TTC は中のフォントをそれぞれ追加する。フォントの name 表のファミリー名と OS/2 の太さ・幅・傾きで登録する。同じファミリーの中のフォントは、幅 (`font-stretch`) → 傾き (`font-style`) → 太さ (`font-weight`) の順に選ぶ (CSS Fonts 4 §5.2)。斜体のフォントのファイル (Italic・Oblique) を渡せば、`font-style: italic`・`oblique` の文字はそのフォントで組む (渡さなければ、立体の文字を傾けて描画する)。幅の違うフォント (Arial Narrow のように、ファミリー名が同じで幅が狭い・広いフォント) は、`font-stretch` の指定か、そのフォントだけの名前 (`font-family: "Arial Narrow"`) で選ぶ (幅の違うフォントが無ければ、字形を水平に伸縮する)。可変フォント (OpenType Font Variations。TrueType のアウトラインと、CFF2 のアウトライン) は、太さ・幅などの軸の範囲の全体を使い、`font-weight`・`font-stretch`・`font-variation-settings` などに合う形を作って組む (PDF には、使った形ごとに静的なフォントとして埋め込む。CFF2 の可変フォントは、静的な CFF のフォントに作り直す)
- 文字のフォントの選び方: `font-family` の並びは、文字ごとに前から順に引き、その文字を持つ最初のフォントで組む (総称と既定のフォントの名前も、並びの中の位置で引く)。並びのどのフォントも持たない文字は、既定のフォント、並びに無い追加したフォントの順に探す。`--style ah` などの互換のスタイルでは、SVG の `font-family` に書いた PostScript 名 (`'CenturyGothic'` など) でも選ぶ。XSL-FO では、入力と同じディレクトリのフォントファイル (TTF・OTF・TTC) も、FO の `font-family` の名前で使う
- `--generic-font <総称>=<フォント名>`: `--font` で追加したフォントか既定のフォントのファミリー名を書く。`serif`・`sans-serif`・`monospace` は欧文の文字のフォント、`serif-cjk`・`sans-serif-cjk` は和文の文字のフォント。等幅の和文は、HTML は `sans-serif-cjk`、XSL-FO は `serif-cjk` のフォントになる。例: `--font BIZUDMincho-Regular.ttf --generic-font serif-cjk="BIZ UDMincho"`
- アラビア文字・タイ文字・デーヴァナーガリー・ハングル・簡体字と繁体字・絵文字 (色つき) などのフォントは、既定のフォントに無いので `--font` で渡す
- `--system-fonts`: 既定のフォント・記号と絵文字のフォントのどれにも字形の無い文字を、OS のフォントの場所 (Windows は `%WINDIR%\Fonts` と `%LOCALAPPDATA%\Microsoft\Windows\Fonts`、macOS は `/System/Library/Fonts`・`/Library/Fonts`・`~/Library/Fonts`、Linux などは fontconfig の設定 (`FONTCONFIG_FILE`・`FONTCONFIG_PATH`・`/etc/fonts/fonts.conf`) の `<dir>`。設定が読めなければ XDG の規則の場所 (`~/.local/share/fonts`・`/usr/share/fonts` など)。読む環境変数は [環境変数](#環境変数) の表) から探して組む。その文字だけを OS のフォントで組み、ほかの文字のフォントは変わらない。明朝の文脈の文字は明朝の書体、ゴシックの文脈の文字はゴシックの書体を先に使い、PDF に埋め込めないフォント (OS/2 の `fsType`) は使わない。組んだ結果が組む機械のフォントで変わるので、既定では使わない。使ったフォントは `font/system-fallback` の情報 (`--verbose` で書く) で分かる。OS のフォントのフォルダーは入力のディレクトリの外なので、`--no-outside-files` と一緒には使えない (エラーにする)。`--system-fonts` を付けずに字形の無い文字があったときは、診断の後に「(--system-fonts で、OS のフォントから字形を探せます)」と添える

### 印刷 (トンボ・特色・PDF/X)

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--print` | — | — | トンボと塗り足し (3mm) を付ける |
| `--spot-colors` | JSON のファイル | — (代わりの RGB で塗る) | 特色の名前と、濃度 100% の代わりの CMYK |
| `--image-max-dpi` | 数 (1 以上。`300`・`150.5` のように数字と小数点で書く) | 元のまま | 置かれる大きさに対してこれより細かい JPEG の写真を、この解像度に縮めて符号化し直す (PDF を小さくする) |
| `--pdfx` | `x1a` \| `x1a:2003` \| `x3` \| `x4` | — | 入稿用の PDF/X-1a:2001・PDF/X-1a:2003・PDF/X-3:2003・PDF/X-4 の印を付ける。⚠️ ページの中のリンク・注釈・フォームフィールドは書かない |
| `--output-profile` | ICC のファイル | — | 出力の CMYK の ICC プロファイル。`--pdfx x4` では必須 |
| `--output-condition` | 名前 | `--output-profile` の説明 (desc)。無ければ `JC200103` | 印刷条件の名前 (ICC の登録名など) |

- `--spot-colors <JSON ファイル>`: `{"名前": "cmyk(20%,40%,60%,80%)"}` か `{"名前": [0.2,0.4,0.6,0.8]}` (配列は 0〜1 の数で、1 を超える値はエラー)。`rgb-icc(r,g,b,#Separation,'名前',濃度)` の色のうち、ここに名前のあるものを PDF の Separation (代わりの色空間は DeviceCMYK、濃度の変換は線形) で書く。`rgb-icc()` は、XSL-FO ではどちらの `--compat` でも読み、HTML では `--style ah` のときだけ読む (CSS の色の関数に無い、アンテナハウスの書き方のため。ほかのスタイルでは、読めない値として宣言ごと無視し、警告に出す)。名前の無いものは、代わりの RGB で書く。名前の文字は UTF-8 で書く (ISO 32000-2 §7.3.5)。特色の値 (色見本帳の値など) は Kumiori には入っていないので、使う人が渡す
- `--pdfx x1a|x1a:2003|x3|x4`:
  - RGB の色・画像は CMYK に、灰色の文字・線・塗りは K だけの CMYK にし、本文 (ページの余白の文字も) の K だけの黒の 12pt 未満の文字と、2pt 未満の線・罫線にはノセ (overprint) を付ける (Ghent Workgroup の入稿の仕様 GWG 2022 の推奨。図 (SVG・EPS など) の中の文字・線には付けない)。ページには TrimBox だけを書く
  - ⚠️ ページの中のリンク・注釈・フォームフィールドは書かずに、件数を情報 (`pdfx/annotations-dropped`。動作を書かなかった数は `pdfx/actions-dropped`) に出す (情報は既定では出ず、`--verbose`・`--diagnostics json` で出る) (塗り足しまでの範囲 (BleedBox) と少しでも重なるものを書かない。BleedBox はページの絵柄の全体を囲むので、目次などの内部のリンクも外の URL へのリンクも、ほぼ全部が無くなる。しおりは残る)。画面で読むための PDF は、`--pdfx` を付けずに書き出す。PDF/X は動作 (Action) を使えないので、しおりの外へのリンク先 (URL・別の PDF) と、塗り足しまでの範囲の外に残る動作つきの注釈も書かずに、件数を警告に出す (しおりはタイトルと文書の中のリンク先だけを残す)
  - GWG 2022 の要件のうち、ページの仕上がりの大きさの違い・特色・画像の粗さ (149ppi 以下、と 224ppi 以下) も警告に出す (商業印刷の枚葉の用途の値)
  - PDF/X-4 は透明をそのまま出し、XMP のメタデータにバージョンの印を書き、字形の無い文字 (.notdef) を描画しない。PDF/X-1a (CMYK と特色だけ、透明は使えない。:2001 は PDF 1.3、:2003 は PDF 1.4) と PDF/X-3 (透明は使えない。機器によらない色 (ICC・Lab) は使える。PDF 1.4) と PDF/X-4 は、書き出した PDF を読み直して要件 (バージョン・印・出力インテント・色空間・透明・描画の状態と網点・PostScript・圧縮の方式・動作と JavaScript・フォントの埋め込み・ボックス・注釈、X-4 は XMP のメタデータと Info との一致も) に合うかを調べ、合わなければエラーで止める
  - X-1a・X-3 は透明をフラット化する: 透明な物 (不透明度・透明度つきの色・透明度つきの画像・SVG の半透明やマスク) の下が 1 色の塗り (ボックスの背景・ページの白) だけなら、ベクタのまま、合成した CMYK の色の不透明な物で描画し、ほかは、その範囲を下の物と合わせて CMYK の画像 (300ppi。12pt 未満の文字が掛かる所は 600ppi) にして置き、警告に出す (画像にした所に文字が掛かれば、文字の質が落ちて文字として選べなくなることも警告に出す)。フラット化できない透明 (色つきの字形の透明など) が残ればエラーで止める。重なった所の色は CMYK で合成するので (印刷と同じ)、RGB で合成する画面のビューアーの見た目とは少し違う。X-1a・X-3 にはタグを付けられない ([タグ付き PDF と PDF/UA](#タグ付き-pdf-と-pdfua))
  - 日本の印刷所で主に使われているのは PDF/X-4 と PDF/X-1a
- `--output-profile <ICC ファイル>`: 印刷所の指定するもの (Japan Color 2001 Coated など)。PDF に埋め込み、RGB の色・画像はこの表で CMYK にする。`--pdfx x4` では必須 (無いか、CMYK の出力機器のもの (機器の種類 prtr) でなければエラー)。`--pdfx x1a` では、AtoB1 の表 (A2B1) を持つものに限る。どのバージョンでも、ヘッダーとタグの表が ICC.1 の形どおり (説明のタグ desc もある) でなければエラー (`pdfx/profile-invalid`)。`--output-profile`・`--output-condition` は `--pdfx` と一緒に使う
- `--output-condition <名前>`: 名前が ICC のレジストリ (registry.color.org の CMYK の特性データ。JC200103・JCS2011・FOGRA39 など) に載っていれば、出力インテントにレジストリ (RegistryName) を書く。載っていない名前なら、`--pdfx x1a`・`x3` でも `--output-profile` が要る。書かなければ、`--output-profile` を渡したときはプロファイルの説明 (desc のタグの文) を印刷条件の名前にし、レジストリ (RegistryName) は書かない (プロファイルも無ければ `JC200103`)

### PDF/A

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--pdfa` | `2b` \| `3b` | — | 長期保存用の PDF/A-2b・PDF/A-3b の印を付ける |

- PDF/A-2b・PDF/A-3b は、ISO 19005-2・-3 の、見た目を保存する水準。出力インテントは sRGB (Kumiori が作る ICC プロファイル)、XMP のメタデータにバージョンと水準を書く。透明はそのまま出す。CMYK の色と特色の代わりの色は RGB に直す (CMYK の JPEG は使えない)
- ファイルを開く動作 (Launch)・フォームフィールド・字形の無い文字は書かずに警告に出し、注釈には印刷の印と外観を付ける。添付ファイルは 3b なら埋め込み (MIME の型・`AFRelationship`・カタログの `AF`)、2b なら埋め込まずにテキストの注釈にする
- 書き出した PDF を読み直して要件に合うかを調べ、合わなければエラーで止める
- `--pdfx` と合わせるときは `--output-profile` (CMYK) が要り、色は PDF/X と同じに CMYK にする (出力インテントを 2 つ書き、同じプロファイルを指させる)
- PDF/A-1b と、a の水準 (アクセシブル。タグ付きの PDF が要る) は出せない

### 暗号化

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--encrypt` | — | — | PDF を暗号化する (AES-256。ISO 32000-2 §7.6 の標準セキュリティハンドラーの R 6)。下の 3 つのどれかを書いても暗号化する |
| `--user-password` | 文字列 | — | 開くときのパスワード。無ければパスワード無しで開けて、`--deny` の制限だけが付く |
| `--owner-password` | 文字列 | 乱数 | 権限を外して開くパスワード。無ければ乱数で、権限を外して開ける人はいない |
| `--deny` | 権限の並び (`,` 区切り。何度でも) | — | 禁じること: `print` (印刷)・`modify` (変更)・`copy` (コピー・抜き出し)・`annotate` (注釈)・`fill-forms` (フォームの入力)・`accessibility` (支援技術のための抜き出し)・`assemble` (ページの挿入・削除など)・`print-high-quality` (高品質の印刷) |

- `--pdfx`・`--pdfa` とは一緒に使えない (どちらの規格も暗号化を許さない)。SVG・PNG の出力にも使えない
- `--pdfua` では `--deny accessibility` を使えず、警告 (`pdfua/encrypt-accessibility-kept`) を出して、支援技術のための抜き出しを許したままにする
- 暗号化した PDF は、毎回違うバイト列になる (初期ベクトル・文書の ID が乱数。`SOURCE_DATE_EPOCH` を付けても同じ)
- コマンドの引数に書いたパスワードは、同じ機械のほかの利用者 (プロセスの一覧) やシェルの履歴に残ることがある。守りたいパスワードは、ライブラリの `encrypt` で渡す
- 権限に従うかどうかは、PDF を読むソフトによる (中身を見せたくないときは `--user-password` を付ける)

```sh
kumiori report.html -o report.pdf --user-password 'open-me' --owner-password 'admin' --deny print,copy
```

### タグ付き PDF と PDF/UA

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--tagged` | — | 付ける (`--pdfx x1a`・`x3` では付けない) | タグ付き PDF にする (文書の構造・読む順・図の代替テキスト・言語を入れ、背景・罫線・柱を飾り (Artifact) にする)。`--pdfx x1a`・`x3` とは一緒に使えない |
| `--no-tagged` | — | — | タグを付けない (0.4 までの既定と同じ PDF) |
| `--pdfua` | — | — | PDF/UA-1 (ISO 14289-1) の印を付ける (`--tagged` を含む)。`--no-tagged`・`--pdfx x1a`・`x3` とは一緒に使えない |
| `--document-lang` | 言語のタグ (`ja`・`en-US`) | — | 入力に言語が無いときの文書の言語 |

- `--tagged` (既定)・`--no-tagged`: タグ付き PDF にする (ISO 32000-1 §14.8)。0.5.0 から既定で付ける。組版の結果 (文字・線・画像の位置) は変わらない
  - HTML の要素の構造の型: 見出しの `h1`〜`h6`・`role="heading"` は H1〜H6、`p` は P、`ul`・`ol`・`li` は L・LI と、その記号 (Lbl) と本文 (LBody)、`img`・`svg` と、画像として組む `object` は Figure、`figcaption` は Caption、`a` は Link、`section`・`article`・`div` などは Sect・Art・Div、`table`・`caption`・`thead`・`tbody`・`tfoot`・`tr`・`th`・`td` は Table・Caption・THead・TBody・TFoot・TR・TH・TD、`float: footnote` の脚注は Note。構造ツリーを文書の順 (読む順) に並べる
  - 表の見出しのセルには向き (Scope。`scope` 属性、無ければ `thead` の中か行のセルがみな見出しなら列、ほかは行)、結合したセルには RowSpan・ColSpan、`headers` 属性のあるセルには Headers を書く。構造の型は要素と `role` で決め、CSS の `display` では決めない (`display: table`・`grid` で並べた `div` は Div のまま。`role="presentation"` の表は表の構造にしない)
  - 脚注は、本文の参照の印を Reference、本体をその後ろの Note (ID を持つ) にし、本体の先頭の番号は Note の中の Lbl にする (本体はページの下に描画するが、読む順は参照の所)
  - 図の代替テキスト (`alt`・`aria-label`・SVG の `title`。`object` は `aria-label`、無ければ `title` 属性で、中の代わりの内容は使わない) は Alt、文書の言語 (`lang`) はカタログの Lang、親と違う言語の要素はその構造の Lang に書く。リンクの注釈は Link の構造に入れ、代わりの説明 (リンクの文字か `aria-label`) を付ける
  - 背景・罫線・飾りの画像 (`alt=""`)・`aria-hidden="true"` の中身は飾り (Artifact)、柱・ノンブル (余白のボックス・`running()`・`position: fixed`) と、2 ページ目からの表の見出し・脚の繰り返しは、ページの飾り (Artifact の Pagination) にする。脚注の区切りの線も飾り
  - XSL-FO の入力は、fo:page-sequence を Part、行のある fo:block を P (ブロックだけを持つものは Div)、fo:block-container・fo:float・fo:table-and-caption を Div、fo:list-* を L・LI・Lbl・LBody、表の要素を Table・Caption・THead・TBody・TFoot・TR・TH (fo:table-header の中のセル。Scope は列)・TD、fo:basic-link を Link、fo:footnote-body を Note (参照の印は Reference)、fo:external-graphic・fo:instream-foreign-object を Figure (MathML は Formula) にし、言語の違う行の中の要素を Span にする。fo:static-content は柱の飾り、fo:leader は飾り。`role` (XSL 1.1 §7.5.2) は、値が標準の構造の型の名前ならその型にし、ほかの名前は独自の型として書いて RoleMap で既定の型に対応させる。アンテナハウスの拡張の `axf:pdftag` (構造の型の名前。`Artifact` は飾り、空は構造を作らない)・`axf:alttext` (図・リンクの代替テキスト)・`axf:expansion-text` (略語の展開) も読む
  - ルビは Ruby (親文字は RB、ルビは RT)、圏点の点は飾り。上・下の余白のボックスと fo:region-before・fo:region-after の柱は、ページの飾りの Header・Footer。リンクでない注釈は Annot、フォームフィールドは Form の構造に入れ、フィールドに説明 (TU) を付ける。不透明度を付けたボックスの中 (透明のグループの Form XObject) も、中の構造ごとに印を付ける
  - 透明をフラット化する出力 (`--pdfx x1a`・`x3`) には、タグを付けられない: `--tagged` と書かなければ、その PDF にはタグを付けずに書き、`--tagged` と書いたときはエラーにする (`x4` には付けられる)
- `--pdfua`: XMP のメタデータにバージョンの印 (`pdfuaid:part`) とタイトル (`dc:title`) を書き、`DisplayDocTitle` を true にし、フォントに字形の無い文字 (.notdef) を描画しない。フォームフィールドの見た目は、埋め込んだフォントと図形で描画する。文書のタイトル・言語、図と数式の代替テキストが無いとき、見出しの段が飛ぶときは、警告に出す (PDF は書く)。`--pdfa`・`--pdfx x4` と合わせられる (PDF/A と合わせるときは、`pdfuaid` を PDF/A の拡張のスキーマで定義する)
- `--document-lang <言語>`: 入力に言語 (HTML の `lang`、XSL-FO の `xml:lang`・`language`) が無いときだけ、タグ付き PDF のカタログの Lang にする

### リンク

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--link-schemes` | スキームの並び (`http,https,ftp`)・`*` | `http,https,mailto,tel` | PDF に動作を書く (SVG に書く) リンクの URL のスキーム (`*` はすべて)。ほかのスキームのリンクは文字だけを組む |
| `--link-launch` | — | 書かない | ⚠️ ファイルを開く動作のリンク (PDF でない相対のファイル・絶対パス・`//host/…`) も PDF に書く |
| `--link-relative` | `file` \| `uri` | `file` | スキームの無い相対のリンク (`x.pdf`・`a.mp3`) の書き方 |

- 文書の外へのリンク (HTML の `<a href>`・XSL-FO の `fo:basic-link`・`fo:bookmark` の `external-destination`) のうち、PDF に動作を書くのは、既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と、相対参照の PDF (別の PDF を開く動作) だけ。ほかのスキーム (`javascript:`・`data:`・`file:` など) と、ファイルを開く動作 (PDF でない相対のファイル・絶対パス・スキームの無い `//host/…`) は、文字だけを組み、警告 (`link/action-dropped`) に件数を出す (他人の書いた文書から作った PDF を、別の人が開くときのため)
- ⚠️ `--link-schemes '*' --link-launch` で、すべて書く (信頼できる文書のときだけ)
- `--link-relative uri` は、スキームの無い相対のリンクを、ファイルを開く動作 (GoToR・Launch) ではなく、書かれた参照のままの URI の動作 (`/S /URI /URI (x.pdf)`。`%xx` は解かない) に書く (ブラウザーの中の PDF ビューアーは GoToR・Launch を扱わないものが多い)。PDF でない相対のファイルも `--link-launch` 無しで書く。絶対パスと `//host/…` は `--link-launch` のときだけ。API では `links: { relative: 'uri' }`

### 外部の取得と読み込みの安全

既定では、ブラウザーで手元の HTML を開いたときと同じに、ネットワークと入力のディレクトリの外のファイルを読みます。⚠️ 他人の書いた文書をサーバーで組むときは、下の 3 つで止めてください ([上限とメモリ](#上限とメモリ) も)。

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--no-fetch-images` | — | 取得する | 文書が `http(s):` で参照する画像をネットワークから取得しない |
| `--no-fetch-styles` | — | 取得する | 文書が `http(s):` で参照する CSS をネットワークから取得しない (HTML) |
| `--no-outside-files` | — | 読む | 文書が `file:` の URL や `../` で指した、入力のディレクトリの外のファイルを読まない |

- 文書が `http(s):` で参照する画像は、既定ではネットワークから取得する。`--no-fetch-images` で取得しない (読めない画像として組む)。ネットワークの画像は同時に 8 個まで取得し、文書の画像の取得の全体にも時限がある (1 つの取得の時限の 10 倍。既定では 5 分。過ぎたら、残りは読めない画像として組む)
- 文書が `http(s):` で参照する CSS (`<link rel="stylesheet">`・`@import`) と、その `@font-face` のフォント (`unicode-range` が文書の文字と重なるものだけ) も、既定ではネットワークから取得する。`--no-fetch-styles` で取得しない
- 文書・CSS が `file:` の URL で参照するファイル (`file:///…/style.css` など) は、入力のディレクトリの外でも、そのファイルを読む。相対参照が入力のディレクトリの外を指すもの (`sub/a.html` の `url(../fonts/a.ttf)` など) も同じく読む。`--no-outside-files` で、入力のディレクトリの外のファイルを読まない (文書が指した画像・フォント・SVG は、読めた中身が PDF に描画されるので、組む側の機械のほかのファイルの中身を抜き出されないようにする。入力のディレクトリの中のファイルは、これまでどおり読む)。`@font-face` の `src` のどのファイルも見つからないときは、警告に出す
- 入力のディレクトリの下の、`.` で始まるファイル・ディレクトリ (`.env`・`.git` など) と `node_modules` は、文書のファイル (CSS・画像・フォント・添付ファイル) として使わない (`.` で始まる名前の画像は見つからない画像 (`image/not-found`) になり、CSS は診断なしで当たらない)。そういう CSS を使うときは `--css` でファイルのパスを指定する。画像などは `.` で始まらない名前にする
- 止めた取得は、情報 (`info`) の診断になる (`--verbose` で見える)
- 既定のフォントは、上の指定とは別に Google Fonts から取得する ([フォント](#フォント))。draw.io の図形ライブラリは、`--fetch-drawio-stencils` を付けたときだけ取得する

### メモリ

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--low-memory` | — | — | メモリを節約して組む (数千ページの文書で、使うメモリが 4 割ほど、時間は 1.5 倍ほど。PDF は同じ) |
| `--limit` | `<名前>=<値>` (何度でも) | 既定の上限 | 入力の上限を変える (`--limit imagePixels=200000000`・`--limit fileBytes=1GB`)。名前は API の `limits` と同じ。値は 1 以上の整数で、`…Bytes` は `K`・`M`・`G` (1,024 倍) を付けられる。入れ子の深さの上限は下げることだけができる |
| `--list-limits` | — | — | 上限の名前・既定の値・上げられるかを書いて終わる |

- ページ番号の参照 (目次など) を決めるための組み直しで、前の回のページを再利用せず、組み終えた page-sequence (HTML は文書) の組版の途中の結果を手放す。そのため、組み直しの回を終えた後で、もう 1 度組んで PDF に書く。PostgreSQL の文書の FO (3,231 ページ) で、生きているヒープの最大が約 2.3GB → 約 0.9GB (いちばん多いのは FO の読み込みの所。ヒープの上限 1GB で組める)、時間は 160 秒 → 231 秒。API では `typesetToPdf` の `lowMemory`。PDF の出力だけで使える
- 知らない名前・数でない値・下げるだけの上限を上げた値は、何もせずにエラーで終わる。上限を上げると、その分だけ時間とメモリを多く使いうる (上げた上限があれば、情報 `limit/raised` を出す。`--verbose` で見える)
- メモリの使い方と、Node のヒープの上限の上げ方は [上限とメモリ](#上限とメモリ)

### 診断

未対応の CSS のプロパティ・値 (対応仕様説明書の 16 章の一覧) と、Kumiori の知らないプロパティ (スペルミスか未対応)、XSL-FO の読めない要素・プロパティ、読めない画像などは、黙って無視せずに、標準エラーに「警告 [名前] ファイル:行:列: 文」の形で通知します (`-o -` のときも)。重大度は「エラー」(出力が欠けた)・「警告」・「情報」です。名前の一覧は [docs/diagnostics.md](diagnostics.md)、ライブラリでは `result.warnings` と `result.diagnostics` です。

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--verbose` | — | — | 情報 (重大度 `info` の診断。オプションで止めた取得・参照されていない CSS を当てなかったことなど) も書く |
| `--diagnostics` | `text` \| `json` | `text` | 診断の書き方。どちらも標準エラーに書く |
| `--ignore-warning` | 名前 (`css/unknown-property` など。`,` で区切る) | — | その名前の診断を出さない (何度でも)。知らない名前は警告 (`api/unknown-diagnostic-code`) して続ける (その警告も `--fail-on warning` で数えるので、名前を書き誤ると終了コード 2 になる) |
| `--fail-on` | `error` \| `warning` | — (診断があっても 0) | その重大度以上の診断があれば、出力を書いた上で終了コード 2 で終わる (出さない診断は数えない) |

- `--diagnostics text` は 1 件 1 行の「警告 [名前] ファイル:行:列 (要素): 文」。`json` は 1 件 1 行の JSON (`{ input, code, severity, message, args, source, count }`。無いものは省く。情報も書く)。変換の報告の行は前のまま標準出力に書くので、JSON は標準エラーの `{` で始まる行を読む。組めずに止まったエラーも、`"severity": "fatal"` の同じ形の 1 行にする (使い方のエラーは JSON にせず文で書く)。詳しくは [docs/diagnostics.md](diagnostics.md) の「コマンドと画面での出し方」
- `--ignore-warning`: API では `diagnostics: { ignore: [...] }`
- `--fail-on` が無ければ、「エラー」の診断があっても終了コードは 0 (出力は書いている)

### draw.io の図

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--drawio-stencils` | ファイルかディレクトリ (`,` で区切る) | — | draw.io の図の図形ライブラリ (`js/stencils.min.js`・ライブラリの XML) と配布物の画像 (`.svg`・`.png`・`.jpg`) (何度でも) |
| `--fetch-drawio-stencils` | — | 取得しない | ⚠️ 図に要る図形ライブラリ・画像が無ければ、draw.io の配布物 (v24.7.5) から取得するのを許す |
| `--drawio-stencils-url` | `http(s)` の URL | — | 取得先の `stencils.min.js` の URL (`--fetch-drawio-stencils` も付けたことになる) |
| `--no-drawio` | — | 読む | draw.io の図 (`.drawio`・`.dio`) を画像として読まない |

- `--fetch-drawio-stencils` で取得した中身は、v24.7.5 の SHA-256 の一覧と比較し、合わなければ使わずに警告する。取得したものはフォントのキャッシュの場所に保存する (`--no-font-cache` なら保存しない)
- 詳しくは [docs/drawio.md](drawio.md)

### プラグイン

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--plugin` | モジュール (ファイルのパスかパッケージの名前) | — | ⚠️ プラグイン (API の `plugins`) を読み込む (何度でも)。プラグインはプログラムそのもので、Kumiori と同じ権限で動くので、信頼できるものだけを書く |
| `--plugin-option` | `<名前>=<値>` | — | その前の `--plugin` の関数に渡すオプション (何度でも) |

- 探す順: (1) `./`・`../` で始まるもの、絶対のパス、`file:` の URL は、ファイルのパス (`./plugin.js` など)。(2) それ以外は、`import()` と同じに、まずパッケージの名前として探す (`import()` と同じ条件 (`exports` の `import`・`node`・`default`) で、今のディレクトリから。`@scope/name`・`name/sub` も、`kp/dist/plugin.js`・`chart.js` のような拡張子で終わるものも書ける。今のディレクトリに同じ名前のディレクトリがあっても、パッケージとして探す)。(3) パッケージとして読めなければ (パッケージが無いときのほか、指したサブパスをそのパッケージが `exports` で出していないときや、パッケージの入口のファイルが無いときも)、今のディレクトリのその名前のファイルを読む (`--plugin myplugin.js`)
- パッケージとして読めるときはパッケージを読むので、確実にファイルを読ませたいときは `./` を付ける。見つからないときは、何をどの順に探したかをエラーの文に書く
- モジュールの `default` は、プラグインか、プラグインを返す関数 (`(オプション, { cacheDir, lang }) => プラグイン`。`lang` は `--lang`・環境で決めた文言の言語)。`--plugin-option` は、この関数のオプションになる。`--plugin-option` を `--plugin` より前に書くとエラー
- プラグインが画像の形式を追加すると、`--watch` はその拡張子のファイルも監視する

## 入力の読み方

- HTML は linkedom で読み、CSS の計算値は自前のカスケード (画面の「CSS の解釈: Kumiori」と同じ)
- XHTML (`.xhtml`・`.xht`) は XML の構文で読み、名前空間に従って書き直してから HTML と同じに組む (`<s:svg xmlns:s="http://www.w3.org/2000/svg">` のような接頭辞の付いた要素も SVG になる。`src/xhtml.ts`)。`.html` は HTML の構文で読むので、接頭辞の付いた要素は SVG にならない。`--xhtml` を付けると、拡張子によらず XML の構文で読む
- MathML (`<math>`) は、数式用のフォント (`STIXTwoMath-Regular.ttf`) で組み、文字のアウトラインの図形にする (XSL-FO と同じ `src/mathLayout.ts`)。`display="block"` の数式は行の中央に置く
- XSL-FO (`.fo`・`.xml`、または `--fo`) は、画面の XSL-FO の読み込みと同じに組む。既定値の流儀は `--compat`
- 画像は PNG・JPEG・GIF・BMP・TIFF・WebP・SVG・WMF・EMF・EPS (PostScript)・CGM と、draw.io の図 (`.drawio`・`.dio`。図形と文字のまま。[docs/drawio.md](drawio.md)) を PDF に入れる。SVG の filter は、図形で近似するか (影・ぼかし・色の変換・重ね)、ピクセルで計算して画像にする (feTurbulence・光の効果など。画面ではブラウザーがラスタライズして描画する)。foreignObject の HTML は、Node では文字を近似して描画する。図形にできない SVG (HTML でない foreignObject など) は、プレースホルダーで描画して警告する

## 上限とメモリ

- 下の上限 (画像のピクセルの数・ファイルの大きさ・PNG の書き出しの計算量など) と、入れ子の深さ・組む計算量の上限は、`--limit <名前>=<値>` で変えられる (何度でも。名前は API の `limits` と同じで、一覧と既定の値は `kumiori --list-limits` と [`docs/library.md`](library.md) の「入力の上限」)。下げるのは、どの上限もできる。上げられるのは時間・大きさの上限だけで、入れ子の深さの上限 (`nestingDepth`・`cssNesting`・`entityDepth` など) は下げることだけができる。`nestingDepth` の既定の 300 は、いちばん大きい種類の値で、実際の既定は種類ごと (HTML 128・XSL-FO 250 など。下げると全部の種類に効く)。`cssNesting` の 64 も同じ (規則の入れ子・`@supports`・`calc()` は 64、`@layer` の名前・数学の関数・セレクター・SVG の属性の `calc()` は 32)。上げても、ファイルの大きさによる制約 (下の「ファイルの 1 バイトあたり」の上限) は変わらない。上げると、その分だけ時間とメモリを多く使いうるので、下の項のとおり、時間とメモリの上限を外でかける (上げた上限があれば、情報 `limit/raised` を出す。`--verbose` で見える)
- 画像の大きさには上限がある (小さなファイルで大量のメモリ・時間を使わせないため。値と根拠は `src/imageLimits.ts`)。1 枚の画像は 1 億ピクセルまで。WMF・EMF・CGM の中の画像 (DIB・セルの並び・タイルの並び・パターン) は、1 つのファイルで合計 6,400 万ピクセルまでで、かつ「26 万ピクセル (512 × 512) + ファイルの 1 バイトあたり 1,024 ピクセル」まで (数百バイトのファイルから巨大な画像を作らせない。約 61KB より大きなファイルなら 6,400 万ピクセルまで使える)。超えた画像は描画せず、文書の残りを組む。GIF・WebP・JPEG・CCITT の TIFF・RLE の BMP も、ピクセルの数をファイルの大きさで制限し (形式ごとに、正当なファイルの符号の密度の上限から決めた値。ほぼ 1 色の大きな可逆の WebP、幅 16,384 ピクセルより広い白紙の CCITT、ほぼ白紙の大きな RLE の BMP は、上限を超えれば描画しない)、PNG は展開した大きさが圧縮したデータの 1,032 倍 (deflate の上限) を超えるものを描画しない。WOFF・WOFF2 を戻したフォントは 128MB まで、かつファイルの 100 倍 + 1MB まで。WMF・EMF・CGM を図にした長さ (2MB + ファイルの 1 バイトあたり 128 字) と、1 つの文書の EPS の実行時間の合計 (60 秒) にも上限がある
- ページを PNG に書き出すとき (`--format png`・`renderPageToPng`) の上限: 1 枚は 4,000 万ピクセルまで。ラスタライズした画像 (と縮めたもの) は、組んだ結果ごとに合わせて 1 億ピクセルまでキャッシュし、ページをまたいで使う (同じ画像を置いたページごとにラスタライズし直さない。ただし、キャッシュの上限 (1 億ピクセル) を超える大きな画像を替えて置くとき (元の大きさで置く 1 億ピクセル近くの画像 2 枚をページごとに替えるなど) は、ページごとにラスタライズし直すことがある。そのときも 1 ページの上限は効く)。画像は中身で見分けるので、SVG の中の data: の画像も、ページをまたいで使う。1 ページを描画する間にラスタライズする画像は、合わせて 4 億ピクセルまで (キャッシュした元の大きさから別の大きさに縮め直す分も、元のピクセルの数で数える。超えた後の画像は描画せず、`png/image-limit` の警告を出す)。SVG のパターンのタイルは、1 ページの間、合わせて 1,600 万ピクセルまでキャッシュする。1 ページをラスタライズする計算量 (図形・文字ごとの外接矩形のピクセルの数・走査線ごとに掛かる辺の数とその並べ替えの計算量・塗るピクセルの数 (グラデーション・画像・パターンの色を引く塗りは 1 ピクセル 4。止まり点が 16 個より多いグラデーションは、止まり点を二分で探す分の log2 (止まり点の数) を追加する)・重ねるオフスクリーンのバッファーの大きさ (ピクセルの数) などの合計) は、ページのピクセルの数の 128 倍 + 6,400 万まで (A4 の 96dpi で数秒、600dpi で 80 秒ほど。ふつうのページはこの 1/10 にも届かない。この計算量の上限とは別に、1 ページでラスタライズする画像の 4 億ピクセルは、JPEG で 50 秒ほどかかることがある。1 億ピクセルの JPEG 4 枚を 1 ページに置くと、A4 の 96dpi で 48 秒ほど)。超えたら、残りの図形・文字・画像を描画せず、`png/raster-budget` の警告を出す (描画しきれなかった SVG の画像はプレースホルダーで描画する)。描画する範囲の外の線は、アウトラインを作らずに飛ばす。同時に持つオフスクリーンのバッファー (不透明度のグループ・マスク・色つきの字形の合成を描画する、ページの外の描画先。1 ピクセル 16 バイト) は、合わせてページのピクセルの数の 8 倍 (1,600 万ピクセルより少なくはしない)、かつ 6,400 万ピクセル (1GB) まで。中身の外接矩形だけを持つオフスクリーンのバッファー (不透明度のグループ・マスク) は、実際に広げた大きさで数え、広げるときに確認する (小さな不透明度のボックスは、ページの大きい・解像度の高いときも、ほとんど当たらない)。大きさを決めて作るオフスクリーンのバッファー (色つきの字形の合成) は、作る前に確認する。勘定が上限にあるときの入れ子の不透明度のグループはオフスクリーンのバッファーを作らずに中の図形ごとに不透明度を掛けて描画し、広げると上限を超える不透明度のグループのオフスクリーンのバッファーは、そこまでの中身を重ねてから空にして続きを描画し (どちらも中の重なりは濃くなる)、広げると超えるマスク・合成は描画せずに、`png/layer-limit` の警告を出す。入れ子のクリッピングの重なりの覆う割合 (1 ピクセル 4 バイト) も、オフスクリーンのバッファーの 1/4 のピクセルとして同じ上限に数え (新しいクリッピングが外側のクリッピングの範囲で全部覆うなら、配列を作らない)、超える深い所のクリッピングは、外側のクリッピングを囲むなら外側のクリッピングのまま描画し (縁を分けて描画しない)、囲まないなら中を描画せずに、`png/clip-limit` の警告を出す (いちばん外のクリッピングは、代える外側のクリッピングが無いので、上限を超えても持つ。勘定には数えるので、その後のオフスクリーンのバッファーは作らない)
- 数千ページの文書は、ページの数に比例してメモリを使う。コマンドと API の `typesetToPdf` は、PDF をページごとに書き、書いたページの組版の結果を手放すので、組み終えた時点の組版の途中の結果 (文字の多いページで 1 ページあたり約 0.7MB) がいちばん多い。組んだ結果も返す `typeset` (`areaTree`・`toPdf`・`renderPage`) は、文書全体のエリアツリーを持つので、その分多く使う (PostgreSQL の文書の FO (3,231 ページ) で、コマンドは生きている量が最大約 2.3GB、`typeset` で組んで `toPdf` を呼ぶと約 2.8GB)。Node のヒープの上限 (既定では機械のメモリによって決まり、多くても約 4GB) で止まるときは (`JavaScript heap out of memory`)、`--low-memory` を付けるか、`node --max-old-space-size=8192 dist-cli/cli.js book.fo -o book.pdf` のように上限を上げる (単位は MB)。画像のバイト列は V8 のヒープの外に置くので、`--max-old-space-size` の上限には入らないが、機械のメモリを使う。PDF だけを作るとき (コマンド・`typesetToPdf`) は、画像を PDF に埋め込むごとに元のバイト列を手放すので、画像の多い文書で使うメモリは、画像の量 (読み込んだファイルの大きさ) の約 3 倍 (埋め込んだコピーと、出来上がりの PDF など。`typeset` で組むと、元のバイト列も持つので約 3.5 倍)。コマンドは PDF をストリームで書き出すので、PDF を書く間は、埋め込んだコピーと出来上がりの PDF を持たない (圧縮の効かない PNG 200 枚・PDF 196MB の文書で、PDF を書く間の外のバイト列の山が 660MB から 266MB。組む前に画像を読み込む所の山は変わらない)
- ⚠️ 他人の書いた文書をサーバーで組むときは、上の上限とは別に、1 つの文書を組む処理にも時間とメモリの上限をかけてください (文書ごとに別のプロセスかワーカーで組み、時限を過ぎたら止める。`node --max-old-space-size=…` やコンテナーのメモリの上限を付ける、など)。上の上限は 1 つの画像・フォントごとのもので、上限いっぱいの画像 1 枚でも数秒〜十数秒と 2GB ほどを使い、文書が多くの画像・フォントを参照すれば、その数だけ計算量が増える。あわせて [外部の取得と読み込みの安全](#外部の取得と読み込みの安全) の 3 つのオプションで、取得と外のファイルの読み込みを止める

## 詳しい例と出力

出力は、実際に走らせたものです (時間は機械によって変わります。JSON の `input` のパスと、エラーの後の使い方の文は短くしています)。

### CI で、診断を JSON で集め、エラーがあれば落とす

まとめて変換し、診断を 1 件 1 行の JSON にしてファイルに残します。`--fail-on error` で、「エラー」の重大度の診断 (読めない画像など) があれば、PDF を書いた上で終了コード 2 になります。

```bash
kumiori book.html hello.fo report.html -o out --diagnostics json --fail-on error 2> diag.jsonl
echo "exit=$?"
```

標準出力:

```text
book.pdf: 1 ページ (組版 36ms)
hello.pdf: 1 ページ (組版 3ms)
report.pdf: 1 ページ (組版 6ms)
exit=2
```

`diag.jsonl` (標準エラー):

```json
{"input":"/work/book.html","code":"css/unknown-property","severity":"warning","message":"知らない CSS のプロパティを無視しました (スペルミスか未対応): colr","args":{"property":"colr"},"source":{"file":"book.html","line":3,"column":12}}
{"input":"/work/book.html","code":"image/not-found","severity":"error","message":"画像 missing.png が見つからないか、中身を画像として読めません","args":{"src":"missing.png"},"source":{"file":"book.html","line":4,"column":37,"element":"img","sourceRef":7}}
{"input":"/work/hello.fo","code":"fo/unsupported","severity":"warning","message":"未対応の XSL-FO の要素・プロパティを無視しました: fon-weight","args":{"item":"fon-weight"},"source":{"file":"hello.fo","line":10,"column":7,"element":"fo:block"}}
```

分かっている警告を外して、警告でも落とすときは、`--ignore-warning` と `--fail-on warning` を合わせます。外した診断は数えないので、ほかに診断が無ければ終了コードは 0 です。

```bash
kumiori book.html -o book.pdf --fail-on warning --ignore-warning css/unknown-property,image/not-found
echo "exit=$?"
```

```text
book.pdf: 1 ページ (組版 36ms)
exit=0
```

### PDF/UA-1 にして、足りないものを確認する

`--pdfua` は、タイトル・図の代替テキスト・見出しの順などの足りないものを警告に出します (PDF は書きます)。HTML に `lang` が無いので、`--document-lang ja` で文書の言語を渡しています。

```bash
kumiori report.html -o report.pdf --pdfua --document-lang ja
```

```text
report.pdf: 1 ページ (組版 36ms)
  警告 [pdfua/missing-title] PDF/UA-1: 文書のタイトルがありません (HTML の title、XSL-FO の axf:document-info の document-title で付けてください)
  警告 [pdfua/missing-figure-alt] PDF/UA-1: 代替テキストの無い図が 1 個あります (HTML の alt・aria-label、XSL-FO の axf:alttext。飾りの画像は alt="" か axf:pdftag="Artifact")
  警告 [pdfua/heading-skipped] PDF/UA-1: 見出しの段が 1 か所で飛んでいます (最初の見出しは H1、深くなるときは 1 段ずつ)
```

### PNG に書き出し、英語で報告する

```bash
kumiori book.html -o page.png --dpi 150 --lang en
```

```text
page.png: wrote 1 page as PNG (the document has 1 page; layout 148ms)
  warning [css/unknown-property] book.html:3:12: ignored unknown CSS properties (misspelled or unsupported): colr
  error [image/not-found] book.html:4:37 (img): image missing.png is not found or its content cannot be read as an image
```

### 組み合わせのエラー

使い方のエラーは、何も書かずにエラーの文を標準エラーに書き、終了コード 1 で終わります。使い方の全文を続けて書くかどうかは、エラーの種類で分かれます。

- オプションを読むときに分かるエラー (知らないオプション、値の無いオプション・値のエラー (空の `-o ''` も)、オプションどうしの組み合わせのエラー): エラーの文の後に、使い方の全文を書く
- 入力と `-o` を照合して分かるエラー (標準入力とほかの入力・`--watch`、入力が複数のときの `-o -` (同じ入力をまとめて 1 つになったときを除く) と既にあるファイルの `-o`、標準入力と `/` で終わるかディレクトリの `-o`、入力が 1 つで `/` で終わる `-o` が無いかファイルのとき): エラーの文だけを書く (直し方は文に書いてある)

```bash
kumiori book.html -o book.pdf --pdfx x4
echo "exit=$?"
```

```text
--pdfx x4 には、出力の CMYK の ICC プロファイル (--output-profile <ICC ファイル>) が要ります
使い方: kumiori <HTML ファイル> [-o|--output <PDF ファイル>] …
exit=1
```

```bash
kumiori - -o out/ < book.html
echo "exit=$?"
```

```text
標準入力 ('-') の文書には名前が無いので、-o にディレクトリは使えません: out/ (-o にファイルの名前を書いてください。例: -o out.pdf)
exit=1
```

## 環境変数

コマンドが読む環境変数は次のものだけです。優先の順は、コマンドのオプション > 環境変数 > 既定です。

| 変数名 | 対応するオプション | 説明 |
| --- | --- | --- |
| `KUMIORI_LANG` | `--lang` | 文言の言語 (`ja`・`en`)。ほかの値は読まずに、次の変数を見る |
| `LC_ALL`・`LC_MESSAGES`・`LANG` | `--lang` (`KUMIORI_LANG` の次)・`--svg-lang` の既定 | 文言の言語は、この順に見て、`en…` なら英語、`ja…` なら日本語 (ほかの値の変数は飛ばして次を見る。どれも合わなければ日本語)。`--svg-lang` を書かないときの SVG の言語は、Node の `Intl` の既定の言語で、en・ja に限らず、OS の規則で決まる: この順で最初に設定された変数 (空の値でも) の言語 (`C`・`POSIX` は en-US。空の値なら言語の無い `und`。どれも無ければ en-US)。例: `LC_ALL=C LANG=ja_JP.UTF-8` では、文言は日本語、`Intl` の言語は en-US。`LANG=fr_FR.UTF-8` では、文言は日本語、`Intl` の言語は fr-FR |
| `KUMIORI_FONT_CACHE` | `--font-cache` | フォントのキャッシュのディレクトリ (draw.io の図形ライブラリを取得したときの保存先にもなる) |
| `XDG_CACHE_HOME` | `--font-cache` (`KUMIORI_FONT_CACHE` の次。Linux など) | `$XDG_CACHE_HOME/kumiori/fonts` をフォントのキャッシュにする (無ければ `~/.cache/kumiori/fonts`) |
| `LOCALAPPDATA` | `--font-cache` (`KUMIORI_FONT_CACHE` の次。Windows)・`--system-fonts` | `%LOCALAPPDATA%\kumiori\fonts` をフォントのキャッシュにする。`--system-fonts` では、利用者ごとに入れたフォントの `%LOCALAPPDATA%\Microsoft\Windows\Fonts` も探す (無ければ、home の `AppData\Local` の下) |
| `WINDIR`・`SystemRoot` | `--system-fonts` (Windows) | `%WINDIR%\Fonts` を OS のフォントの場所にする (`WINDIR` が無ければ `SystemRoot`、どちらも無ければ `C:\Windows`) |
| `FONTCONFIG_FILE`・`FONTCONFIG_PATH` | `--system-fonts` (Linux など) | OS のフォントの場所を書いた fontconfig の設定のファイル。`FONTCONFIG_FILE` のファイル、無ければ `FONTCONFIG_PATH` (`:` で区切ったディレクトリ) の中の最初の `fonts.conf`、どちらも無ければ `/etc/fonts/fonts.conf` を読み、その `<dir>` を探す |
| `XDG_DATA_HOME`・`XDG_DATA_DIRS` | `--system-fonts` (Linux など) | fontconfig の設定のファイルが読めないときは、`$XDG_DATA_HOME/fonts` (無ければ `~/.local/share/fonts`)・`$XDG_DATA_DIRS` の各ディレクトリの `fonts` (無ければ `/usr/local/share/fonts`・`/usr/share/fonts`)・`~/.fonts` を探す。設定の `<dir prefix="xdg">` も `XDG_DATA_HOME` から解く |
| `XDG_CONFIG_HOME` | `--system-fonts` (Linux など) | fontconfig の設定の `<include prefix="xdg">` を、`$XDG_CONFIG_HOME` (無ければ `~/.config`) から解く |
| `SOURCE_DATE_EPOCH` | (無し。ライブラリの `PdfOptions.date`) | PDF の作成日・更新日 (Info と XMP) と、添付ファイルの更新日に書く日時。1970-01-01 UTC からの秒を、小数の無い 10 進の整数で書く ([reproducible-builds.org](https://reproducible-builds.org/specs/source-date-epoch/) の規則)。無ければ組んだ時刻。規則に合わない値 (空・符号・小数・数でない文字・9999 年より後) は、エラーで終わる (終了コード 1)。同じバージョンの Kumiori で、同じ入力・同じフォント・同じオプションと同じ値で組めば、同じ Node のバージョンでは同じバイトの PDF になる (画像のストリームは Node の zlib で圧縮するので、Node のバージョンをまたぐと、画像のある PDF のバイトが違いうる) |

Node そのものの環境変数 (`NODE_OPTIONS=--max-old-space-size=8192` でヒープの上限を上げる、など) も、Node の規則どおりに効きます。

## 終了ステータス

| コード | 意味 |
| --- | --- |
| `0` | すべての入力を組んで書いた (診断があっても、`--fail-on` が無ければ 0)。`--help`・`--version` も 0 |
| `1` | 組めなかった入力があった (ファイルが無い・XML の解析の失敗・書き出しの失敗・PDF/X や PDF/A の要件に合わないなど。入力が複数なら、ほかの入力は書いてある)、または使い方のエラー (知らないオプション・値のエラー・組み合わせのエラー・入力が無い。何も書かない)。読み込んだプラグインが終わらないまま処理が止まったときも 1 |
| `2` | `--fail-on` に当たる診断があった (出力は書いてある)。組めなかった入力もあれば 1 |

`--watch` のときは、組み直しを続けるので、組めなかった入力や `--fail-on` で終了コードは変わりません (Ctrl+C で終わります)。ただし、`--plugin` のプラグインを読めない (見つからない・読み込みでエラーが出た) ときは、使い方のエラーとして、監視せずに終了コード 1 で終わります (プラグインは実行の初めに 1 度だけ読むので、組み直しても読めないため)。
