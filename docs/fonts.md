> English: [en/fonts.md](en/fonts.md)

# 書体

組版用の書体は、このリポジトリにも npm のパッケージにも入っていません。実行時に、Google Fonts の配信元 (`fonts.gstatic.com`) から取得します。

## 既定の書体

| 書体 | 用途 | ライセンス |
| --- | --- | --- |
| Noto Serif JP・Noto Sans JP (それぞれ Regular と Bold) | 和文 (明朝・ゴシック) | SIL Open Font License 1.1 |
| Tinos・Arimo (それぞれ Regular と Bold) | 欧文 (セリフ・サンセリフ) | Apache License 2.0 |
| Cousine | 等幅の指定があるとき | Apache License 2.0 |
| STIX Two Math | 数式 (MathML) があるとき。MathML を、この書体の MATH 表の値で組む | SIL Open Font License 1.1 |
| Noto Sans Symbols 2 | 読み込んだどの書体にも無い記号 (✈ など) が文書にあるとき | SIL Open Font License 1.1 |
| Noto Emoji | 記号の書体にも無い絵文字 (😀・国旗など) が文書にあるとき。単色の輪郭の絵文字 (色つきにするには、Noto Color Emoji などの書体を `--font`・`@font-face` で渡します) | SIL Open Font License 1.1 |

- どの文書でも読むのは、上の 2 行の 8 つのファイル (和文 4 つ・欧文 4 つ) です。合わせて約 29MB で、うち Noto Serif JP が 8.0MB ずつ、Noto Sans JP が 5.7MB ずつです。ほかは、文書に必要なときだけ読みます。
- 太字の指定の字は、同じ書体の Bold で組みます (明朝の文の太字は Noto Serif JP の Bold)。
- 既定で使う書体は、ライブラリの `DEFAULT_FONTS` でも分かります。
- アラビア文字・タイ文字・デーヴァナーガリー・ハングル・簡体字と繁体字・カラーの絵文字などの書体は、既定の書体には無いので、`--font` や `fonts` で渡します ([`docs/features.md`](features.md) の「多言語」)。

## 文書から書体を指す

既定の書体のほかに、文書の側から書体を指せます。

| 書き方 | 書体の取り方 |
| --- | --- |
| `@font-face { src: url(https://…/a.ttf) }` | ネットワークから取る (`fetchStyles` が許しているとき。既定で許している) |
| `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai">` | Google Fonts などの CSS を、拡張子が `.css` でなくても CSS として読み、中の `@font-face` の書体を取る |
| `@font-face { src: url(fonts/a.ttf) }` (相対の参照) | `files`・`resolveResource`・入力のディレクトリから読む (ネットワークには行かない) |
| `font-family: "Noto Sans Thai"` (名前だけ) | 取らない。`files` や `--font`・`fonts` で渡した書体の中から、名前で探す |

- `unicode-range` が文書の字と重ならない `@font-face` の書体は、取りません (CSS Fonts 4 §4.5)。字の範囲ごとに分けて配る CSS (Google Fonts など) からは、文書に要る分だけを取ります。
- ネットワークへ取りに行くのは、`--no-fetch-styles`・`fetchStyles: false` で止められます。許す URL だけにすることもできます ([`docs/library.md`](library.md) の「ファイルと外部の資源」)。
- `@font-face` の `src` のどのファイルも見つからないときは、警告で知らせます。
- XSL-FO には `@font-face` が無いので、書体は `--font`・`fonts` で渡します。

## 取った書体の置き場とオフライン

| 使い方 | 置き場・オフラインでの使い方 |
| --- | --- |
| Node のコマンド | 取った書体を OS のキャッシュ (`~/.cache/kumiori/fonts` など。`--font-cache` で変えられる) に保存し、2 回目からはネットワークに行かない。オフラインで使うときは、一度オンラインで動かしてキャッシュに入れるか、`--font-dir` で読むディレクトリを指定する |
| 画面 (ブラウザ) | 同じ名前の TTF を `public/fonts/` に置けば、後備として使われる (git 管理外) |
| ライブラリ (`typeset`) | 既定の取得は `https:` の URL しか試さないので、手元の書体は `loadFont` で渡す。Node では `kumiori/node` の `createFontLoader()` が、コマンドと同じ読み方をする ([`docs/library.md`](library.md)) |

`public/fonts/` に置いた書体は、Web アプリのビルドの出力 (`dist/fonts/`) にもコピーされます。配布物に含めない場合は、ビルドの前に取り除いてください。
npm で配る出力 (`dist-cli/`・`dist-lib/`・`dist-browser/`) には、`public/` の中身をコピーしません。Node のコマンドは、`--font-dir` で渡したディレクトリだけを見ます。

## PDF への埋め込みとライセンス

使った書体は、使った字だけを取り出して PDF に埋め込みます。書体のライセンスの条件は、各書体の配布元で確認してください。
