> English: [en/cli.md](en/cli.md)

# kumiori (Node のコマンド)

HTML+CSS・XSL-FO の文書を、ブラウザを使わずに PDF (と、ページごとの SVG・PNG) に組むコマンドです。
npm から入れたときは `kumiori` (入れずに使うなら `npx kumiori`)、このリポジトリで作ったとき (`npm run build:cli`) は `node dist-cli/cli.js` が同じコマンドです。

- [構文](#構文)
- [よく使う例](#よく使う例)
- [オプション一覧](#オプション一覧)
  - [基本](#基本) ・ [入力と出力先](#入力と出力先) ・ [出力の形式](#出力の形式) ・ [スタイルと互換](#スタイルと互換) ・ [書体](#書体)
  - [印刷 (トンボ・特色・PDF/X)](#印刷-トンボ特色pdfx) ・ [PDF/A](#pdfa) ・ [タグ付き PDF と PDF/UA](#タグ付き-pdf-と-pdfua)
  - [リンク](#リンク) ・ [外部の取得と読み込みの安全](#外部の取得と読み込みの安全) ・ [メモリ](#メモリ) ・ [診断](#診断) ・ [draw.io の図](#drawio-の図) ・ [プラグイン](#プラグイン)
- [入力の読み方](#入力の読み方)
- [上限とメモリ](#上限とメモリ)
- [詳しい例と出力](#詳しい例と出力)
- [環境変数](#環境変数)
- [終了の状態](#終了の状態)

## 構文

```text
kumiori <HTML ファイル> [-o <PDF ファイル>] [オプション]...
kumiori <FO ファイル (.fo・.xml)> [-o <PDF ファイル>] [オプション]...
kumiori <入力>... -o <出力先のディレクトリ> [オプション]...
kumiori - [-o -] [--base <ディレクトリ>] [オプション]... < 入力 > 出力.pdf
kumiori --help | --version
```

表記の決まり:

- `<必須の引数>`: 置き換えて書く値 (`<HTML ファイル>` は `book.html` など)
- `[任意のオプション・引数]`: 書かなくてもよいもの
- `a|b`: どれか 1 つを書く (`--format pdf|svg|png` は `--format svg` など)
- `...`: 何度でも書ける

`--help` は、使えるオプションをすべて並べます (`--lang en` で英語)。オプションの順は自由で、入力の前にも後にも書けます。知らないオプション・値の誤りは、何もせずに誤りで終わります ([終了の状態](#終了の状態))。値をとるオプションの値の所に、ほかのオプションの名前 (`-o --print` の `--print` など) があると、値の書き忘れとして誤りにします (その名前のファイルを使うときは `./--print` のように書きます)。誤りの文の制御文字 (ESC など) は、`\x1b` のように見える形にして書きます。

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

**手元の書体で組む**

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
| `-v`, `--version` | — | — | 版を標準出力に書いて終わる (終了コード 0) |
| `--lang` | `ja` \| `en` | 環境で決める ([環境変数](#環境変数))。決まらなければ `ja` | 使い方・報告・警告・誤りの文の言語 |

### 入力と出力先

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| (入力) | ファイル、または `-` | — (必須) | 組む文書。`.html`・`.htm`・`.xhtml`・`.xht` は HTML、`.fo`・`.xml` は XSL-FO。`-` は標準入力 |
| `-o`, `--output` | ファイル・ディレクトリ・`-` | 入力の隣の `<入力名>.pdf` (`.svg`・`.png`) | 出力のファイル。入力が複数か、既にあるディレクトリか、`/` で終わる名前なら、出力先のディレクトリ (ディレクトリにするのは、標準入力のときは使えない)。`-` は標準出力。⚠️ 既にあるファイルは、尋ねずに上書きする |
| `--base` | ディレクトリ | 今のディレクトリ | 標準入力 (`-`) の文書の CSS・画像・書体を探すディレクトリ |
| `--fo` | — | 拡張子で決める | 拡張子によらず XSL-FO として読む |
| `--xhtml` | — | 拡張子で決める | 拡張子によらず、HTML を XML の構文 (XHTML) で読む |
| `--watch` | — | — | 入力のディレクトリの HTML・FO・CSS・画像・書体が変わるたびに組み直す (Ctrl+C で終わる)。標準入力とは使えない |

- 入力が複数なら、`-o` は出力先のディレクトリ (無ければ作る。既にあるファイルなら誤り (終了コード 1)。`-o` が無ければ各入力の隣に書く)。1 つ失敗しても、ほかは作る (終了コードは 1)。出力の名前がぶつかるとき (同じディレクトリの `a.html` と `a.fo`、別のディレクトリの同じ名前の入力を 1 つの出力先へ) は、後のものに入力の名前を拡張子ごと残す (`a.fo.pdf`・`a.html.pdf`)。それでもぶつかれば `.2`・`.3` … を足す (`a.html.2.pdf`)。`-2` のような印にしないのは、`--format svg`・`png` のページの番号 (`a-2.svg`) と重ならないため。入力が 1 つでも、`-o` が既にあるディレクトリなら、その中に `<入力名>.pdf` (`--format svg`・`png` では `.svg`・`.png`) を書く
- 入力が 1 つで、`-o` が `/` (Windows では `\` も) で終わるときは、ディレクトリと見なす。あればその中に `<入力名>.pdf` を書き、無いか、ファイルなら誤り (終了コード 1。作らない)。`/` で終わらない名前は、無ければファイルの名前と見なす (`-o out` は `out` という名前のファイルを書く)
- ⚠️ 出力のファイルが既にあれば、尋ねずに上書きする。ただし、書く先が、その変換で読むファイル (入力 (標準入力の元のファイルも)、文書の使う画像・CSS・書体、`--font-dir`・`--font-cache` から読んだ書体、`--css`・`--font`・`--spot-colors`・`--output-profile`・`--drawio-stencils`・`--plugin` のファイルと、`--drawio-stencils` に渡したディレクトリの下のファイル。ハードリンクの別名も同じファイルと見なす) か、同じ実行で別の入力から書いた出力 (`a.html` の `a-2.svg` と、`a-2.html` の `a-2.svg` など) なら、書かずに誤り (終了コード 1。`-o one.html` で入力を上書きしない。`<img src="fig.svg">` の `fig.html` を `--format svg` で組んでも、画像の `fig.svg` を消さない)。`--format svg`・`png` で複数ページの文書は、どのページも書く前に確かめるので、誤りのときは 1 枚も書かない。見るのは、その入力の変換で読んだファイルなので、入力が複数のとき、前の入力が読んだ画像を後の入力の出力で上書きすることはある (`a.html` が `b.svg` を使い、`b.html` を `--format svg` で組むと、`b.svg` は `b.html` のページになる。そうしたくないときは `-o` で別の出力先にする)。同じ入力を何度も渡すと (`a.html a.html`・`./a.html a.html` のように、同じディレクトリの同じ名前を)、1 度だけ組み、そう知らせる (別のディレクトリのシンボリックリンク・ハードリンクの別名は、別の入力として組む)。大文字と小文字を区別しない機械 (macOS・Windows) では、`A.html` と `a.fo` の出力の名前もぶつかるものと見なす。入力が 1 つのとき、`-o` のファイルを置くディレクトリが無いと (`-o nodir/book.pdf`) 誤りになる
- `-o` の値は空にできない (`-o ''` は値の誤り、終了コード 1。`-o` 無しと同じには扱わない)
- `-` は標準入力から読む (CSS・画像・書体は `--base` のディレクトリから。FO かどうかは中身で見分ける)。`-o -` は PDF を標準出力へ書く (報告は標準エラーへ)。標準入力は、ほかの入力・`--watch` とは一緒に使えない。標準入力の文書には名前が無いので、`-o` には `/` で終わる名前も既にあるディレクトリも使えない (誤り、終了コード 1。`-o out.pdf` のようにファイルの名前を書く)。入力が複数のときは `-o -` を使えない (同じ入力を何度も渡して、まとめて 1 つになったときは使える)
- 入力の文字の符号化は、BOM と XML 宣言の `encoding` (`Shift_JIS`・`EUC-JP` など)・HTML の `<meta charset>` で決める (無ければ UTF-8)
- 変換の報告 (`book.pdf: 3 ページ (組版 40ms)`) は標準出力に書く (`-o -` のときと、出力が標準出力と同じもののとき (`-o /dev/stdout > out.pdf`・`-o /dev/stdout | cat > out.pdf`) は標準エラー)。診断は標準エラーに書く ([診断](#診断))

### 出力の形式

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--format` | `pdf` \| `svg` \| `png` | `pdf` (`-o` の拡張子が `.svg`・`.png` ならその形式。`-o` がディレクトリのときは拡張子を見ない) | 出力の形式。`svg`・`png` はページごとに書く |
| `--pages` | 範囲 (`1-3,5,7-`) | すべてのページ | SVG・PNG に書くページ (1 から数える)。`--format svg`・`png` のときだけ |
| `--dpi` | 数 (0 より大きく 2400 まで) | `96` | PNG の解像度 (1 インチあたりの画素の数)。`--format png` のときだけ |

- `-o` の拡張子 (`.pdf`・`.svg`・`.png`) と食い違う `--format` は誤り
- `png` は、ページを PNG (8 ビットの RGB。紙は白) にする (依存を足さず、自前で画素にする)。描かないものは SVG と同じで、ほかに CMYK の JPEG・インターレースの PNG の画像は描かずに警告を出す。上限は [上限とメモリ](#上限とメモリ)
- `svg` は、ページを SVG にする (字は書体の輪郭の道にし、画像は SVG の中に埋め込むので、書体・画像のファイルが無くても描ける。大きさは紙の大きさ (pt))
- SVG・PNG では、`--svg-lang` は効かず (SVG の `switch` は実行環境の言語で選ぶ)、SVG の画像の `foreignObject` の中身は描かない (PDF は、`--svg-lang` で選び、`foreignObject` の中身を描く)
- 文書が複数ページなら、ページごとに `-<番号>` を付けた名前 (`book-1.svg`・`book-2.svg` …。番号はページ数の桁にそろえる) に書く (`--pages` で 1 ページだけ選んでも番号を付ける)。`-o -` (標準出力) は、書くページが 1 つのときだけ
- `--pages` は、番号と範囲をカンマで区切る (`7-` は 7 ページ目から最後まで)。文書に無いページを指すと、何も書かずに誤りになる
- `--dpi` は、数字と小数点で書く (`150`・`72.5`)。1 枚 4,000 万画素まで
- SVG・PNG には、リンク・注釈・フォームの欄は書かない。PDF だけの指定 (`--pdfx`・`--pdfa`・`--pdfua`・`--output-profile`・`--output-condition`・`--tagged`・`--image-max-dpi`・`--low-memory`) とは一緒に使えない

### スタイルと互換

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--style` | `kumiori` \| `browser` \| `browser-margin` \| `ah` \| `vivliostyle` \| `weasyprint` | `kumiori` | HTML の既定のスタイル (画面の「設定」の「既定のスタイル」と同じ)。`ah`・`vivliostyle`・`weasyprint` は、他の組版ソフトに合わせる互換のスタイル |
| `--compat` | `spec` \| `antenna` | `spec` | XSL-FO の既定値の流儀 (`spec`: XSL-FO 1.1 の初期値 / `antenna`: AH Formatter 互換の既定値)。ほかの値は誤り |
| `--page-size` | 用紙 (`A5`・`"A5 landscape"`・`148mm,210mm`) | `A4` | HTML の既定の用紙 (`@page` で `size` を指定していない文書の用紙)。XSL-FO では使わない |
| `--css` | CSS のファイル (`a.css,b.css`) | HTML が参照する CSS だけ | 使う CSS を選ぶ (カンマ区切りで複数) |
| `--svg-lang` | 言語タグ (`ja,en`) | 実行環境の言語 | SVG の `systemLanguage` を照らす言語 |

- `--page-size` は、CSS の `size` と同じ書き方で、用紙の名前 (`A5`・`JIS-B5`・`letter` など)、向きを付けたもの (`"A5 landscape"`)、幅と高さ (`148mm,210mm`。区切りは空白かカンマ。長さは 1pt 以上) を書く。文書の `@page { size: … }` があれば、そちらが勝つ。`@media` の `width`・`height` も、この用紙で評価する
- `--css`: HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・書体を使う (画面で一緒に選ぶのと同じ)。画像は、文書と CSS に名前が出てくるものだけを読む。CSS は、HTML が参照するもの (`<link>`・`@import`) だけを使う (参照していない CSS は当てずに、警告で知らせる)。`--css` で名指しした CSS は、`@import` 先も使い、HTML から参照されていなくても利用者のスタイルシートとして足す
- `--svg-lang` は、SVG の `systemLanguage` (`switch` の子を選ぶ条件) を照らす言語 (言語タグをカンマで区切る。好む順)。SVG を置いた所に言語の指定 (`lang`・`xml:lang`・`language`) があれば、そちらが勝つ。既定の「実行環境の言語」は、Node の `Intl` の言語 (`LANG` などのロケールで決まる。[環境変数](#環境変数))
- `--compat` は XSL-FO の、`--style` は HTML の指定。`rgb-icc()` の読み方など、互換の指定で変わる動きは、各オプションの説明を見てください

### 書体

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--font` | 書体のファイル (TTF・OTF・TTC・WOFF・WOFF2) | — | 書体を足す (何度でも)。システムに入れた書体のように `font-family` から使う |
| `--generic-font` | `<総称>=<書体名>` | 欧文 Tinos・Arimo・Cousine、和文 Noto Serif JP・Noto Sans JP | 総称の書体に使う書体 (何度でも) |
| `--font-dir` | ディレクトリ | — | 既定の書体を読むディレクトリ (無ければキャッシュ、次に Google Fonts から取る) |
| `--font-cache` | ディレクトリ | 環境変数 `KUMIORI_FONT_CACHE`、無ければ OS のキャッシュ | Google Fonts から取った既定の書体を保存して使い回すディレクトリ |
| `--no-font-cache` | — | — | 書体のキャッシュを読まず、保存もしない (毎回 Google Fonts から取る) |

- 既定の書体は、Noto Serif JP・Noto Sans JP・Tinos・Arimo (等幅の指定があれば Cousine、MathML があれば STIX Two Math、どの書体にも無い記号があれば Noto Sans Symbols 2、それにも無い絵文字があれば Noto Emoji)。パッケージには入れておらず、読む順は `--font-dir` → 書体のキャッシュ → ネットワーク (Google Fonts)。1 度読んだら、まとめて変換するときも使い回す
- `--font-dir <dir>`: 既定の書体 (`NotoSerifJP-Regular.ttf`・`NotoSerifJP-Bold.ttf`・`NotoSansJP-Regular.ttf`・`NotoSansJP-Bold.ttf`・`Tinos-*.ttf`・`Arimo-*.ttf`、等幅の指定があれば `Cousine-*.ttf`、MathML があれば `STIXTwoMath-Regular.ttf`、どの書体にも無い記号があれば `NotoSansSymbols2-Regular.ttf`、それにも無い絵文字があれば `NotoEmoji-Regular.ttf`) を、同じ名前のファイルから読むディレクトリ。太字のファイル (`-Bold`) に、同じ書体の `-Regular` と同じ中身のファイルを置くと、太字の書体は無いものとして、太字の字は Regular を太らせて描く (太字を持たない書体に入れ替えるとき)。既定の書体を手元の書体に入れ替えるときは、太字のファイル (`NotoSerifJP-Bold.ttf`・`NotoSansJP-Bold.ttf` など) も置く: 置かなかったファイルは、キャッシュかネットワークの既定の書体になり、入れ替えた書体と混ざる
- `--font-cache <dir>`: 既定は環境変数 `KUMIORI_FONT_CACHE`、無ければ OS のキャッシュ (Linux は `$XDG_CACHE_HOME` か `~/.cache` の `kumiori/fonts`、macOS は `~/Library/Caches/kumiori/fonts`、Windows は `%LOCALAPPDATA%\kumiori\fonts`)。初回だけネットワークから取り、`書体 … を取得して … に保存しました` と知らせる。2 回目からはネットワークに行かない。途中で切れた取得など、書体のファイルでないものは保存せず、壊れたキャッシュは捨てて取り直す。保存できない場所でも変換は続ける。オフラインで使うときは、1 度オンラインで動かしてキャッシュに入れるか、`--font-dir` で読むディレクトリを指定する
- `--font <書体ファイル>`: TTC は中の書体をそれぞれ足す。書体の name 表のファミリー名と OS/2 の太さ・幅・傾きで登録する。同じファミリーの中の書体は、幅 (`font-stretch`) → 傾き (`font-style`) → 太さ (`font-weight`) の順に選ぶ (CSS Fonts 4 §5.2)。斜体の書体のファイル (Italic・Oblique) を渡せば、`font-style: italic`・`oblique` の字はその書体で組む (渡さなければ、立体の字を傾けて描く)。幅の違う書体 (Arial Narrow のように、ファミリー名が同じで幅が狭い・広い書体) は、`font-stretch` の指定か、その書体だけの名前 (`font-family: "Arial Narrow"`) で選ぶ (幅の違う書体が無ければ、字形を水平に伸縮する)。可変フォント (OpenType Font Variations。TrueType の輪郭と、CFF2 の輪郭) は、太さ・幅などの軸の範囲の全体を使い、`font-weight`・`font-stretch`・`font-variation-settings` などに合う形を作って組む (PDF には、使った形ごとに静的な書体として埋め込む。CFF2 の可変フォントは、静的な CFF の書体に作り直す)
- 字の書体の選び方: `font-family` の並びは、字ごとに前から順に引き、その字を持つ最初の書体で組む (総称と既定の書体の名前も、並びの中の位置で引く)。並びのどの書体も持たない字は、既定の書体、並びに無い足した書体の順に探す。`--style ah` などの互換のスタイルでは、SVG の `font-family` に書いた PostScript 名 (`'CenturyGothic'` など) でも選ぶ。XSL-FO では、入力と同じディレクトリの書体ファイル (TTF・OTF・TTC) も、FO の `font-family` の名前で使う
- `--generic-font <総称>=<書体名>`: `--font` で足した書体か既定の書体のファミリー名を書く。`serif`・`sans-serif`・`monospace` は欧文の字の書体、`serif-cjk`・`sans-serif-cjk` は和文の字の書体。等幅の和文は、HTML は `sans-serif-cjk`、XSL-FO は `serif-cjk` の書体になる。例: `--font BIZUDMincho-Regular.ttf --generic-font serif-cjk="BIZ UDMincho"`
- アラビア文字・タイ文字・デーヴァナーガリー・ハングル・簡体字と繁体字・絵文字 (色つき) などの書体は、既定の書体に無いので `--font` で渡す

### 印刷 (トンボ・特色・PDF/X)

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--print` | — | — | トンボと塗り足し (3mm) を付ける |
| `--spot-colors` | JSON のファイル | — (代わりの RGB で塗る) | 特色の名前と、濃度 100% の代わりの CMYK |
| `--image-max-dpi` | 数 (1 以上。`300`・`150.5` のように数字と小数点で書く) | 元のまま | 置かれる大きさに対してこれより細かい JPEG の写真を、この解像度に縮めて符号化し直す (PDF を小さくする) |
| `--pdfx` | `x1a` \| `x1a:2003` \| `x3` \| `x4` | — | 入稿用の PDF/X-1a:2001・PDF/X-1a:2003・PDF/X-3:2003・PDF/X-4 の印を付ける。⚠️ ページの中のリンク・注釈・フォームの欄は書かない |
| `--output-profile` | ICC のファイル | — | 出力の CMYK の ICC プロファイル。`--pdfx x4` では必須 |
| `--output-condition` | 名前 | `JC200103` | 印刷条件の名前 (ICC の登録名など) |

- `--spot-colors <JSON ファイル>`: `{"名前": "cmyk(20%,40%,60%,80%)"}` か `{"名前": [0.2,0.4,0.6,0.8]}` (配列は 0〜1 の数で、1 を超える値は誤り)。`rgb-icc(r,g,b,#Separation,'名前',濃度)` の色のうち、ここに名前のあるものを PDF の Separation (代わりの色空間は DeviceCMYK、濃度の変換は線形) で書く。`rgb-icc()` は、XSL-FO ではどちらの `--compat` でも読み、HTML では `--style ah` のときだけ読む (CSS の色の関数に無い、アンテナハウスの書き方のため。ほかのスタイルでは、読めない値として宣言ごと無視し、警告に出す)。名前の無いものは、代わりの RGB で書く。名前の字は UTF-8 で書く (ISO 32000-2 §7.3.5)。特色の値 (色見本帳の値など) は Kumiori には入っていないので、使う人が渡す
- `--pdfx x1a|x1a:2003|x3|x4`:
  - RGB の色・画像は CMYK に、灰色の字・線・塗りは K だけの CMYK にし、本文 (ページの余白の字も) の K だけの黒の 12pt 未満の字と、2pt 未満の線・罫線にはノセ (overprint) を付ける (Ghent Workgroup の入稿の仕様 GWG 2022 の推奨。図 (SVG・EPS など) の中の字・線には付けない)。ページには TrimBox だけを書く
  - ⚠️ ページの中のリンク・注釈・フォームの欄は書かずに、件数を知らせ (`pdfx/annotations-dropped`。動作を書かなかった数は `pdfx/actions-dropped`) に出す (知らせは既定では出ず、`--verbose`・`--diagnostics json` で出る) (塗り足しまでの範囲 (BleedBox) と少しでも重なるものを書かない。BleedBox はページの絵柄の全体を囲むので、目次などの内部のリンクも外の URL へのリンクも、ほぼ全部が無くなる。しおりは残る)。画面で読むための PDF は、`--pdfx` を付けずに書き出す。PDF/X は動作 (Action) を使えないので、しおりの外への飛び先 (URL・別の PDF) と、塗り足しまでの範囲の外に残る動作つきの注釈も書かずに、件数を警告に出す (しおりは題と文書の中の飛び先だけを残す)
  - GWG 2022 の要件のうち、ページの仕上がりの大きさの違い・特色・画像の粗さ (149ppi 以下、と 224ppi 以下) も警告に出す (商業印刷の枚葉の用途の値)
  - PDF/X-4 は透明をそのまま出し、XMP のメタデータに版の印を書き、字形の無い字 (.notdef) を描かない。PDF/X-1a (CMYK と特色だけ、透明は使えない。:2001 は PDF 1.3、:2003 は PDF 1.4) と PDF/X-3 (透明は使えない。機器によらない色 (ICC・Lab) は使える。PDF 1.4) と PDF/X-4 は、書き出した PDF を読み直して決まり (版・印・出力意図・色空間・透明・描画の状態と網点・PostScript・圧縮の方式・動作と JavaScript・書体の埋め込み・ボックス・注釈、X-4 は XMP のメタデータと Info との一致も) に合うかを調べ、合わなければ誤りで止める
  - X-1a・X-3 は透明を平らにする: 透明な物 (不透明度・透明度つきの色・透明度つきの画像・SVG の半透明やマスク) の下が 1 色の塗り (箱の背景・ページの白) だけなら、ベクタのまま、合成した CMYK の色の不透明な物で描き、ほかは、その範囲を下の物と合わせて CMYK の画像 (300ppi。12pt 未満の字が掛かる所は 600ppi) にして置き、警告に出す (画像にした所に字が掛かれば、字の質が落ちて文字として選べなくなることも警告に出す)。平らにできない透明 (色つきの字形の透明など) が残れば誤りで止める。重なった所の色は CMYK で合成するので (印刷と同じ)、RGB で合成する画面のビューアの見た目とは少し違う。X-1a・X-3 にはタグを付けられない ([タグ付き PDF と PDF/UA](#タグ付き-pdf-と-pdfua))
  - 日本の印刷所で主に使われているのは PDF/X-4 と PDF/X-1a
- `--output-profile <ICC ファイル>`: 印刷所の指定するもの (Japan Color 2001 Coated など)。PDF に埋め込み、RGB の色・画像はこの表で CMYK にする。`--pdfx x4` では必須 (無いか、CMYK の出力機器のもの (機器の種類 prtr) でなければ誤り)。`--pdfx x1a` では、AtoB1 の表 (A2B1) を持つものに限る。`--output-profile`・`--output-condition` は `--pdfx` と一緒に使う
- `--output-condition <名前>`: 名前が ICC の登録簿 (registry.color.org の CMYK の特性データ。JC200103・JCS2011・FOGRA39 など) に載っていれば、出力意図に登録簿 (RegistryName) を書く。載っていない名前なら、`--pdfx x1a` でも `--output-profile` が要る

### PDF/A

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--pdfa` | `2b` \| `3b` | — | 長期保存用の PDF/A-2b・PDF/A-3b の印を付ける |

- PDF/A-2b・PDF/A-3b は、ISO 19005-2・-3 の、見た目を保存する水準。出力意図は sRGB (Kumiori が作る ICC プロファイル)、XMP のメタデータに版と水準を書く。透明はそのまま出す。CMYK の色と特色の代わりの色は RGB に直す (CMYK の JPEG は使えない)
- ファイルを開く動作 (Launch)・フォームの欄・字形の無い字は書かずに警告に出し、注釈には印刷の印と外観を付ける。添付ファイルは 3b なら埋め込み (MIME の型・`AFRelationship`・カタログの `AF`)、2b なら埋め込まずにテキストの注釈にする
- 書き出した PDF を読み直して決まりに合うかを調べ、合わなければ誤りで止める
- `--pdfx` と合わせるときは `--output-profile` (CMYK) が要り、色は PDF/X と同じに CMYK にする (出力意図を 2 つ書き、同じプロファイルを指させる)
- PDF/A-1b と、a の水準 (アクセシブル。タグ付きの PDF が要る) は出せない

### タグ付き PDF と PDF/UA

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--tagged` | — | 付ける (`--pdfx x1a`・`x3` では付けない) | タグ付き PDF にする (文書の構造・読む順・図の代わりの文・言語を入れ、背景・罫線・柱を飾り (Artifact) にする)。`--pdfx x1a`・`x3` とは一緒に使えない |
| `--no-tagged` | — | — | タグを付けない (0.4 までの既定と同じ PDF) |
| `--pdfua` | — | — | PDF/UA-1 (ISO 14289-1) の印を付ける (`--tagged` を含む)。`--no-tagged`・`--pdfx x1a`・`x3` とは一緒に使えない |
| `--document-lang` | 言語の札 (`ja`・`en-US`) | — | 入力に言語が無いときの文書の言語 |

- `--tagged` (既定)・`--no-tagged`: タグ付き PDF にする (ISO 32000-1 §14.8)。0.5.0 から既定で付ける。組版の結果 (字・線・画像の位置) は変わらない
  - HTML の要素の構造の型: 見出しの `h1`〜`h6`・`role="heading"` は H1〜H6、`p` は P、`ul`・`ol`・`li` は L・LI と、その記号 (Lbl) と本文 (LBody)、`img`・`svg` と、画像として組む `object` は Figure、`figcaption` は Caption、`a` は Link、`section`・`article`・`div` などは Sect・Art・Div、`table`・`caption`・`thead`・`tbody`・`tfoot`・`tr`・`th`・`td` は Table・Caption・THead・TBody・TFoot・TR・TH・TD、`float: footnote` の脚注は Note。構造の木を文書の順 (読む順) に並べる
  - 表の見出しのセルには向き (Scope。`scope` 属性、無ければ `thead` の中か行のセルがみな見出しなら列、ほかは行)、結合したセルには RowSpan・ColSpan、`headers` 属性のあるセルには Headers を書く。構造の型は要素と `role` で決め、CSS の `display` では決めない (`display: table`・`grid` で並べた `div` は Div のまま。`role="presentation"` の表は表の構造にしない)
  - 脚注は、本文の参照の印を Reference、本体をその後ろの Note (ID を持つ) にし、本体の頭の番号は Note の中の Lbl にする (本体はページの下に描くが、読む順は参照の所)
  - 図の代わりの文 (`alt`・`aria-label`・SVG の `title`。`object` は `aria-label`、無ければ `title` 属性で、中の代わりの内容は使わない) は Alt、文書の言語 (`lang`) はカタログの Lang、親と違う言語の要素はその構造の Lang に書く。リンクの注釈は Link の構造に入れ、代わりの説明 (リンクの字か `aria-label`) を付ける
  - 背景・罫線・飾りの画像 (`alt=""`)・`aria-hidden="true"` の中身は飾り (Artifact)、柱・ノンブル (余白の箱・`running()`・`position: fixed`) と、2 ページ目からの表の見出し・脚の繰り返しは、ページの飾り (Artifact の Pagination) にする。脚注の区切りの線も飾り
  - XSL-FO の入力は、fo:page-sequence を Part、行のある fo:block を P (ブロックだけを持つものは Div)、fo:block-container・fo:float・fo:table-and-caption を Div、fo:list-* を L・LI・Lbl・LBody、表の要素を Table・Caption・THead・TBody・TFoot・TR・TH (fo:table-header の中のセル。Scope は列)・TD、fo:basic-link を Link、fo:footnote-body を Note (参照の印は Reference)、fo:external-graphic・fo:instream-foreign-object を Figure (MathML は Formula) にし、言語の違う行の中の要素を Span にする。fo:static-content は柱の飾り、fo:leader は飾り。`role` (XSL 1.1 §7.5.2) は、値が標準の構造の型の名前ならその型にし、ほかの名前は独自の型として書いて RoleMap で既定の型に写す。アンテナハウスの拡張の `axf:pdftag` (構造の型の名前。`Artifact` は飾り、空は構造を作らない)・`axf:alttext` (図・リンクの代わりの文)・`axf:expansion-text` (略語の展開) も読む
  - ルビは Ruby (親文字は RB、ルビは RT)、圏点の点は飾り。上・下の余白の箱と fo:region-before・fo:region-after の柱は、ページの飾りの Header・Footer。リンクでない注釈は Annot、フォームの欄は Form の構造に入れ、欄に説明 (TU) を付ける。不透明度を付けた箱の中 (透明のグループの Form XObject) も、中の構造ごとに印を付ける
  - 透明を平らにする出力 (`--pdfx x1a`・`x3`) には、タグを付けられない: `--tagged` と書かなければ、その PDF にはタグを付けずに書き、`--tagged` と書いたときは誤りにする (`x4` には付けられる)
- `--pdfua`: XMP のメタデータに版の印 (`pdfuaid:part`) と題 (`dc:title`) を書き、`DisplayDocTitle` を true にし、書体に字形の無い字 (.notdef) を描かない。フォームの欄の見た目は、埋め込んだ書体と図形で描く。文書の題・言語、図と数式の代わりの文が無いとき、見出しの段が飛ぶときは、警告に出す (PDF は書く)。`--pdfa`・`--pdfx x4` と合わせられる (PDF/A と合わせるときは、`pdfuaid` を PDF/A の拡張のスキーマで定義する)
- `--document-lang <言語>`: 入力に言語 (HTML の `lang`、XSL-FO の `xml:lang`・`language`) が無いときだけ、タグ付き PDF のカタログの Lang にする

### リンク

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--link-schemes` | スキームの並び (`http,https,ftp`)・`*` | `http,https,mailto,tel` | PDF に動作を書くリンクの URL のスキーム (`*` はすべて)。ほかのスキームのリンクは字だけを組む |
| `--link-launch` | — | 書かない | ⚠️ ファイルを開く動作のリンク (PDF でない相対のファイル・絶対パス・`//host/…`) も PDF に書く |
| `--link-relative` | `file` \| `uri` | `file` | スキームの無い相対のリンク (`x.pdf`・`a.mp3`) の書き方 |

- 文書の外へのリンク (HTML の `<a href>`・XSL-FO の `fo:basic-link`・`fo:bookmark` の `external-destination`) のうち、PDF に動作を書くのは、既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と、相対参照の PDF (別の PDF を開く動作) だけ。ほかのスキーム (`javascript:`・`data:`・`file:` など) と、ファイルを開く動作 (PDF でない相対のファイル・絶対パス・スキームの無い `//host/…`) は、字だけを組み、警告 (`link/action-dropped`) に件数を出す (他人の書いた文書から作った PDF を、別の人が開くときのため)
- ⚠️ `--link-schemes '*' --link-launch` で、すべて書く (信頼できる文書のときだけ)
- `--link-relative uri` は、スキームの無い相対のリンクを、ファイルを開く動作 (GoToR・Launch) ではなく、書かれた参照のままの URI の動作 (`/S /URI /URI (x.pdf)`。`%xx` は解かない) に書く (ブラウザの中の PDF ビューアは GoToR・Launch を扱わないものが多い)。PDF でない相対のファイルも `--link-launch` 無しで書く。絶対パスと `//host/…` は `--link-launch` のときだけ。API では `links: { relative: 'uri' }`

### 外部の取得と読み込みの安全

既定では、ブラウザで手元の HTML を開いたときと同じに、ネットワークと入力のディレクトリの外のファイルを読みます。⚠️ 他人の書いた文書をサーバーで組むときは、下の 3 つで止めてください ([上限とメモリ](#上限とメモリ) も)。

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--no-fetch-images` | — | 取る | 文書が `http(s):` で参照する画像をネットワークから取らない |
| `--no-fetch-styles` | — | 取る | 文書が `http(s):` で参照する CSS をネットワークから取らない (HTML) |
| `--no-outside-files` | — | 読む | 文書が `file:` の URL や `../` で指した、入力のディレクトリの外のファイルを読まない |

- 文書が `http(s):` で参照する画像は、既定ではネットワークから取る。`--no-fetch-images` で取らない (読めない画像として組む)。ネットワークの画像は同時に 8 個まで取り、文書の画像の取得の全体にも時限がある (1 つの取得の時限の 10 倍。既定では 5 分。過ぎたら、残りは読めない画像として組む)
- 文書が `http(s):` で参照する CSS (`<link rel="stylesheet">`・`@import`) と、その `@font-face` の書体 (`unicode-range` が文書の字と重なるものだけ) も、既定ではネットワークから取る。`--no-fetch-styles` で取らない
- 文書・CSS が `file:` の URL で参照するファイル (`file:///…/style.css` など) は、入力のディレクトリの外でも、そのファイルを読む。相対参照が入力のディレクトリの外を指すもの (`sub/a.html` の `url(../fonts/a.ttf)` など) も同じく読む。`--no-outside-files` で、入力のディレクトリの外のファイルを読まない (文書が指した画像・書体・SVG は、読めた中身が PDF に描かれるので、組む側の機械のほかのファイルを写し取られないようにする。入力のディレクトリの中のファイルは、これまでどおり読む)。`@font-face` の `src` のどのファイルも見つからないときは、警告で知らせる
- 入力のディレクトリの下の、`.` で始まるファイル・ディレクトリ (`.env`・`.git` など) と `node_modules` は、文書のファイル (CSS・画像・書体・添付ファイル) として使わない (`.` で始まる名前の画像は見つからない画像 (`image/not-found`) になり、CSS は診断なしで当たらない)。そういう CSS を使うときは `--css` でファイルの道を名指しする。画像などは `.` で始まらない名前にする
- 止めた取得は、知らせ (`info`) の診断になる (`--verbose` で見える)
- 既定の書体は、上の指定とは別に Google Fonts から取る ([書体](#書体))。draw.io の図形ライブラリは、`--fetch-drawio-stencils` を付けたときだけ取る

### メモリ

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--low-memory` | — | — | メモリを節約して組む (数千ページの文書で、使うメモリが 4 割ほど、時間は 1.5 倍ほど。PDF は同じ) |

- ページ番号の参照 (目次など) を決めるための組み直しで、前の回のページを使い回さず、組み終えた page-sequence (HTML は文書) の組版の途中の結果を手放す。そのため、組み直しの回を終えた後で、もう 1 度組んで PDF に書く。PostgreSQL の文書の FO (3,231 ページ) で、生きているヒープの最大が約 2.3GB → 約 0.9GB (いちばん多いのは FO の読み込みの所。ヒープの上限 1GB で組める)、時間は 160 秒 → 231 秒。API では `typesetToPdf` の `lowMemory`。PDF の出力だけで使える
- メモリの使い方と、Node のヒープの上限の上げ方は [上限とメモリ](#上限とメモリ)

### 診断

未対応の CSS のプロパティ・値 (対応仕様説明書の 16 章の一覧) と、Kumiori の知らないプロパティ (綴りの誤りか未対応)、XSL-FO の読めない要素・プロパティ、読めない画像などは、黙って無視せずに、標準エラーに「警告 [名前] ファイル:行:列: 文」の形で知らせます (`-o -` のときも)。重さは「誤り」(出力が欠けた)・「警告」・「知らせ」です。名前の一覧は [docs/diagnostics.md](diagnostics.md)、ライブラリでは `result.warnings` と `result.diagnostics` です。

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--verbose` | — | — | 知らせ (重さ `info` の診断。選択肢で止めた取得・参照されていない CSS を当てなかったことなど) も書く |
| `--diagnostics` | `text` \| `json` | `text` | 診断の書き方。どちらも標準エラーに書く |
| `--ignore-warning` | 名前 (`css/unknown-property` など。`,` で区切る) | — | その名前の診断を出さない (何度でも)。知らない名前は警告 (`api/unknown-diagnostic-code`) して続ける (その警告も `--fail-on warning` で数えるので、名前を書き誤ると終了コード 2 になる) |
| `--fail-on` | `error` \| `warning` | — (診断があっても 0) | その重さ以上の診断があれば、出力を書いた上で終了コード 2 で終わる (出さない診断は数えない) |

- `--diagnostics text` は 1 件 1 行の「警告 [名前] ファイル:行:列 (要素): 文」。`json` は 1 件 1 行の JSON (`{ input, code, severity, message, args, source, count }`。無いものは省く。知らせも書く)。変換の報告の行は前のまま標準出力に書くので、JSON は標準エラーの `{` で始まる行を読む。組めずに止まった誤りも、`"severity": "fatal"` の同じ形の 1 行にする (使い方の誤りは JSON にせず文で書く)。詳しくは [docs/diagnostics.md](diagnostics.md) の「コマンドと画面での出し方」
- `--ignore-warning`: API では `diagnostics: { ignore: [...] }`
- `--fail-on` が無ければ、「誤り」の診断があっても終了コードは 0 (出力は書いている)

### draw.io の図

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--drawio-stencils` | ファイルかディレクトリ (`,` で区切る) | — | draw.io の図の図形ライブラリ (`js/stencils.min.js`・ライブラリの XML) と配布物の画像 (`.svg`・`.png`・`.jpg`) (何度でも) |
| `--fetch-drawio-stencils` | — | 取らない | ⚠️ 図に要る図形ライブラリ・画像が無ければ、draw.io の配布物 (v24.7.5) から取るのを許す |
| `--drawio-stencils-url` | `http(s)` の URL | — | 取り先の `stencils.min.js` の URL (`--fetch-drawio-stencils` も付けたことになる) |
| `--no-drawio` | — | 読む | draw.io の図 (`.drawio`・`.dio`) を画像として読まない |

- `--fetch-drawio-stencils` で取った中身は、v24.7.5 の SHA-256 の一覧と照らし、合わなければ使わずに警告する。取ったものは書体のキャッシュの場所に保存する (`--no-font-cache` なら保存しない)
- 詳しくは [docs/drawio.md](drawio.md)

### プラグイン

| オプション | 引数 / 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--plugin` | モジュール (ファイルの道かパッケージの名前) | — | ⚠️ プラグイン (API の `plugins`) を読み込む (何度でも)。プラグインはプログラムそのもので、Kumiori と同じ権限で動くので、信頼できるものだけを書く |
| `--plugin-option` | `<名前>=<値>` | — | その前の `--plugin` の関数に渡す選択肢 (何度でも) |

- 探す順: (1) `./`・`../` で始まるもの、絶対の道、`file:` の URL は、ファイルの道 (`./plugin.js` など)。(2) それ以外は、`import()` と同じに、まずパッケージの名前として探す (`import()` と同じ条件 (`exports` の `import`・`node`・`default`) で、今のディレクトリから。`@scope/name`・`name/sub` も、`kp/dist/plugin.js`・`chart.js` のような拡張子で終わるものも書ける。今のディレクトリに同じ名前のディレクトリがあっても、パッケージとして探す)。(3) パッケージとして読めなければ (パッケージが無いときのほか、指したサブパスをそのパッケージが `exports` で出していないときや、パッケージの入口のファイルが無いときも)、今のディレクトリのその名前のファイルを読む (`--plugin myplugin.js`)
- パッケージとして読めるときはパッケージを読むので、確実にファイルを読ませたいときは `./` を付ける。見つからないときは、何をどの順に探したかを誤りの文に書く
- モジュールの `default` は、プラグインか、プラグインを返す関数 (`(選択肢, { cacheDir, lang }) => プラグイン`。`lang` は `--lang`・環境で決めた文言の言語)。`--plugin-option` は、この関数の選択肢になる。`--plugin-option` を `--plugin` より前に書くと誤り
- プラグインが画像の形式を足すと、`--watch` はその拡張子のファイルも見張る

## 入力の読み方

- HTML は linkedom で読み、CSS の計算値は自前のカスケード (画面の「CSS の解釈: Kumiori」と同じ)
- XHTML (`.xhtml`・`.xht`) は XML の構文で読み、名前空間に従って書き直してから HTML と同じに組む (`<s:svg xmlns:s="http://www.w3.org/2000/svg">` のような接頭辞の付いた要素も SVG になる。`src/xhtml.ts`)。`.html` は HTML の構文で読むので、接頭辞の付いた要素は SVG にならない。`--xhtml` を付けると、拡張子によらず XML の構文で読む
- MathML (`<math>`) は、数式用の書体 (`STIXTwoMath-Regular.ttf`) で組み、字の輪郭の図形にする (XSL-FO と同じ `src/mathLayout.ts`)。`display="block"` の数式は行の中央に置く
- XSL-FO (`.fo`・`.xml`、または `--fo`) は、画面の XSL-FO の読み込みと同じに組む。既定値の流儀は `--compat`
- 画像は PNG・JPEG・GIF・BMP・TIFF・WebP・SVG・WMF・EMF・EPS (PostScript)・CGM と、draw.io の図 (`.drawio`・`.dio`。図形と文字のまま。[docs/drawio.md](drawio.md)) を PDF に入れる。SVG の filter は、図形で近似するか (影・ぼかし・色の変換・重ね)、画素で計算して画像にする (feTurbulence・光の効果など。画面ではブラウザがラスタライズして描く)。foreignObject の HTML は、Node では文字を近似して描く。図形にできない SVG (HTML でない foreignObject など) は、仮の枠で描いて警告する

## 上限とメモリ

- 画像の大きさには上限がある (小さなファイルで大量のメモリ・時間を使わせないため。値と根拠は `src/imageLimits.ts`)。1 枚の画像は 1 億画素まで。WMF・EMF・CGM の中の画像 (DIB・セルの並び・タイルの並び・模様) は、1 つのファイルで合計 6,400 万画素までで、かつ「26 万画素 (512 × 512) + ファイルの 1 バイトあたり 1,024 画素」まで (数百バイトのファイルから巨大な画像を作らせない。約 61KB より大きなファイルなら 6,400 万画素まで使える)。超えた画像は描かず、文書の残りを組む。GIF・WebP・JPEG・CCITT の TIFF・RLE の BMP も、画素の数をファイルの大きさで縛り (形式ごとに、正当なファイルの符号の密度の上限から決めた値。ほぼ 1 色の大きな可逆の WebP、幅 16,384 画素より広い白紙の CCITT、ほぼ白紙の大きな RLE の BMP は、上限を超えれば描かない)、PNG は展開した大きさが圧縮したデータの 1,032 倍 (deflate の上限) を超えるものを描かない。WOFF・WOFF2 を戻した書体は 128MB まで、かつファイルの 100 倍 + 1MB まで。WMF・EMF・CGM を図にした長さ (2MB + ファイルの 1 バイトあたり 128 字) と、1 つの文書の EPS の実行時間の合計 (60 秒) にも上限がある
- ページを PNG に書き出すとき (`--format png`・`renderPageToPng`) の上限: 1 枚は 4,000 万画素まで。画素に戻した画像 (と縮めたもの) は、組んだ結果ごとに合わせて 1 億画素まで覚え、ページをまたいで使う (同じ画像を置いたページごとに戻し直さない。ただし、覚えの上限 (1 億画素) を超える大きな画像を替えて置くとき (元の大きさで置く 1 億画素近くの画像 2 枚をページごとに替えるなど) は、ページごとに戻し直すことがある。そのときも 1 ページの上限は効く)。画像は中身で見分けるので、SVG の中の data: の画像も、ページをまたいで使う。1 ページを描く間に画素に戻す画像は、合わせて 4 億画素まで (覚えた元の大きさから別の大きさに縮め直す分も、元の画素の数で数える。超えた後の画像は描かず、`png/image-limit` の警告を出す)。SVG の模様のタイルは、1 ページの間、合わせて 1,600 万画素まで覚える。1 ページを画素にする手間 (図形・字ごとの外接矩形の画素の数・走査線ごとに掛かる辺の数とその並べ替えの手間・塗る画素の数・重ねる板の画素の数などの合計) は、ページの画素の数の 128 倍 + 6,400 万まで (A4 の 96dpi で数秒、600dpi で 80 秒ほど。ふつうのページはこの 1/10 にも届かない。この手間の上限とは別に、1 ページで戻す画像の 4 億画素は、JPEG で 50 秒ほどかかることがある。1 億画素の JPEG 4 枚を 1 ページに置くと、A4 の 96dpi で 48 秒ほど)。超えたら、残りの図形・字・画像を描かず、`png/raster-budget` の警告を出す (描き切れなかった SVG の画像は仮の枠で描く)。描く範囲の外の線は、輪郭を作らずに飛ばす。同時に持つ板 (不透明度のグループ・マスク・色つきの字形の合成を描く、ページの外の描き場。1 画素 16 バイト) は、合わせてページの画素の数の 8 倍 (1,600 万画素より少なくはしない)、かつ 6,400 万画素 (1GB) まで (板を作る前に確かめる)。超える入れ子の不透明度のグループは板を作らずに中の図形ごとに不透明度を掛けて描き (中の重なりは濃くなる)、超えるマスク・合成は描かずに、`png/layer-limit` の警告を出す。入れ子の切り抜きの重なりの覆う割合 (1 画素 4 バイト) も、板の 1/4 の画素として同じ上限に数え (新しい切り抜きが外側の切り抜きの範囲で全部覆うなら、配列を作らない)、超える深い所の切り抜きは、外側の切り抜きを囲むなら外側の切り抜きのまま描き (縁を描き分けない)、囲まないなら中を描かずに、`png/clip-limit` の警告を出す。この上限は、実際に広げた板の大きさでなく、作るときの描ける範囲 (ページの全体か、いまの切り抜きの範囲) で数えるので、小さな不透明度の箱でも、ページの大きい・解像度の高いときは早く当たる (A4 を 600dpi で描くと、40px 角の不透明度の箱の 2 段目でも、板を作らずに中の図形ごとに不透明度を掛けて描く)
- ⚠️ PNG の書き出しの手間の勘定は、止まり点の多いグラデーション (`repeating-linear-gradient(90deg, red 0, blue 0.02px, red 0.04px)` のような細かい繰り返し) で 1 画素の手間が止まり点の数に比例することを数えない (そのような箱 40 個で 2 分ほどかかる)。他人の書いた文書を PNG にするときは、下の項のとおり、時間の上限を外でかけてください
- 数千ページの文書は、ページの数に比例してメモリを使う。コマンドと API の `typesetToPdf` は、PDF をページごとに書き、書いたページの組版の結果を手放すので、組み終えた時点の組版の途中の結果 (字の多いページで 1 ページあたり約 0.7MB) がいちばん多い。組んだ結果も返す `typeset` (`areaTree`・`toPdf`・`renderPage`) は、文書全体の領域の木を持つので、その分多く使う (PostgreSQL の文書の FO (3,231 ページ) で、コマンドは生きている量が最大約 2.3GB、`typeset` で組んで `toPdf` を呼ぶと約 2.8GB)。Node のヒープの上限 (既定では機械のメモリによって決まり、多くても約 4GB) で止まるときは (`JavaScript heap out of memory`)、`--low-memory` を付けるか、`node --max-old-space-size=8192 dist-cli/cli.js book.fo -o book.pdf` のように上限を上げる (単位は MB)。画像のバイト列は V8 のヒープの外に置くので、`--max-old-space-size` の上限には入らないが、機械のメモリを使う。PDF だけを作るとき (コマンド・`typesetToPdf`) は、画像を PDF に埋め込むごとに元のバイト列を手放すので、画像の多い文書で使うメモリは、画像の量 (読み込んだファイルの大きさ) の約 3 倍 (埋め込んだ写しと、出来上がりの PDF など。`typeset` で組むと、元のバイト列も持つので約 3.5 倍)
- ⚠️ 他人の書いた文書をサーバーで組むときは、上の上限とは別に、1 つの文書を組む処理にも時間とメモリの上限をかけてください (文書ごとに別のプロセスかワーカーで組み、時限を過ぎたら止める。`node --max-old-space-size=…` やコンテナのメモリの上限を付ける、など)。上の上限は 1 つの画像・書体ごとのもので、上限いっぱいの画像 1 枚でも数秒〜十数秒と 2GB ほどを使い、文書が多くの画像・書体を参照すれば、その数だけ手間が増える。あわせて [外部の取得と読み込みの安全](#外部の取得と読み込みの安全) の 3 つのオプションで、取得と外のファイルの読み込みを止める

## 詳しい例と出力

出力は、実際に走らせたものです (時間は機械によって変わります。JSON の `input` の道と、誤りの後の使い方の文は短くしています)。

### CI で、診断を JSON で集め、誤りがあれば落とす

まとめて変換し、診断を 1 件 1 行の JSON にしてファイルに残します。`--fail-on error` で、「誤り」の重さの診断 (読めない画像など) があれば、PDF を書いた上で終了コード 2 になります。

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
{"input":"/work/book.html","code":"css/unknown-property","severity":"warning","message":"知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr","args":{"property":"colr"},"source":{"file":"book.html","line":3,"column":12}}
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

### PDF/UA-1 にして、足りないものを確かめる

`--pdfua` は、題・図の代わりの文・見出しの順などの足りないものを警告に出します (PDF は書きます)。HTML に `lang` が無いので、`--document-lang ja` で文書の言語を渡しています。

```bash
kumiori report.html -o report.pdf --pdfua --document-lang ja
```

```text
report.pdf: 1 ページ (組版 36ms)
  警告 [pdfua/missing-title] PDF/UA-1: 文書の題がありません (HTML の title、XSL-FO の axf:document-info の document-title で付けてください)
  警告 [pdfua/missing-figure-alt] PDF/UA-1: 代わりの文の無い図が 1 個あります (HTML の alt・aria-label、XSL-FO の axf:alttext。飾りの画像は alt="" か axf:pdftag="Artifact")
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

### 組み合わせの誤り

使い方の誤りは、何も書かずに誤りの文を標準エラーに書き、終了コード 1 で終わります。使い方の全文を続けて書くかどうかは、誤りの種類で分かれます。

- オプションを読むときに分かる誤り (知らないオプション、値の無いオプション・値の誤り (空の `-o ''` も)、オプションどうしの組み合わせの誤り): 誤りの文の後に、使い方の全文を書く
- 入力と `-o` を照らして分かる誤り (標準入力とほかの入力・`--watch`、入力が複数のときの `-o -` (同じ入力をまとめて 1 つになったときを除く) と既にあるファイルの `-o`、標準入力と `/` で終わるかディレクトリの `-o`、入力が 1 つで `/` で終わる `-o` が無いかファイルのとき): 誤りの文だけを書く (直し方は文に書いてある)

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
| `LC_ALL`・`LC_MESSAGES`・`LANG` | `--lang` (`KUMIORI_LANG` の次)・`--svg-lang` の既定 | 文言の言語は、この順に見て、`en…` なら英語、`ja…` なら日本語 (ほかの値の変数は飛ばして次を見る。どれも合わなければ日本語)。`--svg-lang` を書かないときの SVG の言語は、Node の `Intl` の既定の言語で、en・ja に限らず、OS の決まりで決まる: この順で最初に設定された変数 (空の値でも) の言語 (`C`・`POSIX` は en-US。空の値なら言語の無い `und`。どれも無ければ en-US)。例: `LC_ALL=C LANG=ja_JP.UTF-8` では、文言は日本語、`Intl` の言語は en-US。`LANG=fr_FR.UTF-8` では、文言は日本語、`Intl` の言語は fr-FR |
| `KUMIORI_FONT_CACHE` | `--font-cache` | 書体のキャッシュのディレクトリ (draw.io の図形ライブラリを取ったときの保存先にもなる) |
| `XDG_CACHE_HOME` | `--font-cache` (`KUMIORI_FONT_CACHE` の次。Linux など) | `$XDG_CACHE_HOME/kumiori/fonts` を書体のキャッシュにする (無ければ `~/.cache/kumiori/fonts`) |
| `LOCALAPPDATA` | `--font-cache` (`KUMIORI_FONT_CACHE` の次。Windows) | `%LOCALAPPDATA%\kumiori\fonts` を書体のキャッシュにする |

Node そのものの環境変数 (`NODE_OPTIONS=--max-old-space-size=8192` でヒープの上限を上げる、など) も、Node の決まりどおりに効きます。

## 終了の状態

| コード | 意味 |
| --- | --- |
| `0` | すべての入力を組んで書いた (診断があっても、`--fail-on` が無ければ 0)。`--help`・`--version` も 0 |
| `1` | 組めなかった入力があった (ファイルが無い・XML の解析の失敗・書き出しの失敗・PDF/X や PDF/A の決まりに合わないなど。入力が複数なら、ほかの入力は書いてある)、または使い方の誤り (知らないオプション・値の誤り・組み合わせの誤り・入力が無い。何も書かない)。読み込んだプラグインが終わらないまま処理が止まったときも 1 |
| `2` | `--fail-on` に当たる診断があった (出力は書いてある)。組めなかった入力もあれば 1 |

`--watch` のときは、組み直しを続けるので、組めなかった入力や `--fail-on` で終了コードは変わりません (Ctrl+C で終わります)。
