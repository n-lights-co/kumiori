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
  - 書字方向が親と直交する箱 (横書きの中の縦書き・縦書きの中の横書き) の大きさを CSS Writing Modes 3 §7.3 に合わせた。**組版の結果が変わる**: 高さを指定した縦書きの回り込み (`float`) は、その高さで行を折り返して端に置く (前は、長い文が折り返されずに伸び、本文と重なった)。flex の行の中の縦書きの項目は、指定の幅になり (前は中身の行の数の幅に縮んだ)、幅の指定が無ければ行の数の幅になる。行の向きの大きさ (縦書きなら `height`) の指定の無い箱は fit-content (中身の長さ。使える長さまで) で、表のセル・絶対配置の中でも同じ。`max-height`・`min-height` は行の長さの上限・下限になる
  - 縦書きの絶対配置の箱で、高さ (行の向きの大きさ) の指定が無ければ、中身の長さにする (CSS 2.1 §10.3.7 の shrink-to-fit。前はページの下端まで伸びた)。縦書きの flex の容器の項目の `width` (交差軸の大きさ) の指定が消えていたのを直した
  - `width` と `max-width` の両方がある `display: block` の画像で、包む箱を画像の幅にした
  - 名前付きページ: 流れの外の箱 (絶対配置・回り込みなど) だけの最初のページを作らない (CSS Page 3 §8.1)
  - 印刷に関わらないプロパティ (`cursor`・`transition-*` など) を、未対応の CSS の警告に出さない
  - `box-decoration-break: clone` (CSS Fragmentation 3 §5.4) に対応。ページ・段で分かれた囲みの断片ごと、行で分かれた行内の枠 (`span` の罫線・背景) の断片ごとに、罫線と内側の余白を付け直す (縦書きも。`-webkit-box-decoration-break` も読む)。初期値 `slice` の結果は変わらない
  - 内容による大きさ (CSS Sizing 3 §3.2): `width`・`min-width`・`max-width` (縦書きは `height`・`min-height`・`max-height`) の `min-content`・`max-content`・`fit-content` と、`fit-content(<長さ>)` (CSS Sizing 4 §3.2) に対応 (ブロックの箱と、その回り込み・絶対配置・inline-block。横並びの flex の項目の `width` の語は `flex-basis` の語として読む)。block の向きの `height` の語は auto と同じ。flex・grid の容器と表の語の大きさは未対応で、警告で知らせる。**`fieldset` は、HTML の既定のスタイル (`min-inline-size: min-content`) のとおり、中身の最も狭い幅より狭くならない**
  - `initial-letter` (CSS Inline 3 §7。ドロップキャップ): `::first-letter` の字を、行の数で決めた大きさにして沈める (`initial-letter: 3`・`3 2`・`3 raise`、`initial-letter-align: alphabetic | ideographic | leading`)。字の大きさと位置は、段落の `line-height` と書体の大文字の高さ・字の枠から決める。和文 (`lang` が `ja`・`zh`・`ko`) は字の枠で合わせる。縦書きも。`::first-letter` 以外への指定、`initial-letter-align: hanging | border-box`、`initial-letter-wrap` は未対応
  - `empty-cells: hide` (CSS 2.1 §17.6.1.1): 罫線を分ける表の、中身の無いセルの罫線と背景を描かない。セルがすべて中身の無い行は高さ 0
  - `vertical-align` の百分率 (CSS 2.1 §10.8.1): 行内の箱を、その要素の `line-height` に対する割合だけ上げ下げする
  - `text-align: justify-all` (CSS Text 3 §6.1): 最後の行も両端をそろえる
  - XSL-FO: 罫線・余白の `.conditionality="retain"` を、入れ子の箱の両方に指定したとき、外側の断片が、内側の断片の末尾の罫線・余白まで包むよう直した (前は、内側の罫線・余白の分だけ外側の断片が短かった)
  - ルビの配置: `ruby-position` (`under` で親文字の下、縦書きは左。`alternate` との組)、`ruby-align` (`start`・`center`・`space-between`・`space-around`)、`ruby-overhang` (`auto` を明示すると前後の仮名・約物に掛ける)、`ruby-merge: merge` (グループルビ) に対応。指定の無いルビの置く側・掛け方は変わらない
  - ルビの字の配り方の既定を、`ruby-align` の初期値 `space-around` (CSS Ruby 1 §4.3) にした。**欧文・注音字母のルビの既定の並べ方が変わる**: 字の間を空けずに、親文字の中央にそろえる (前は字ごとに間を空けていた)。和文 (漢字・仮名) のルビと親文字は前と同じ。XSL-FO のルビは変わらない
  - `font-variant-east-asian` に対応 (`jis78`・`jis83`・`jis90`・`jis04`・`simplified`・`traditional`・`full-width`・`proportional-width`・`ruby`。フォントの OpenType の機能で字形と字の幅を選ぶ。一括指定の `font-variant` からも読む)
  - 下線・上線・取り消し線の線の種類 (`text-decoration-style` の `double`・`dotted`・`dashed`・`wavy`)、太さ (`text-decoration-thickness`)、下線をずらす量 (`text-underline-offset`) に対応。一括指定の `text-decoration` に線の種類と太さを書ける。`title` のある `abbr` の下線は、ブラウザと同じ点線になる (これまでは実線)
  - 圏点の色 (`text-emphasis-color`) と付ける側 (`text-emphasis-position`。横書きの `under`、縦書きの `left`) に対応。一括指定の `text-emphasis` に色を書ける
  - 文書の CSS の `fill`・`stroke`・`color` など (`stroke-width`・`fill-opacity`・`stroke-opacity`・`opacity`・`fill-rule`・線の端・角・破線) が、文書の中にじかに書いた `<svg>` に効く。`currentColor` は、`<svg>` の外から継承した `color` になる (`svg { fill: currentColor }` と `.icon { color: red }` でアイコンに色が付く)。SVG の画像でも、`color` の属性と `currentColor`、`rgba()` の色の不透明度を読む
  - 色の関数 `hwb()`・`lab()`・`lch()`・`oklab()`・`oklch()`・`color()` (CSS Color 4) と `color-mix()` (CSS Color 5) に対応。出力は sRGB で、sRGB の色域の外の色は、明るさと色相を保って彩度を下げて色域に収める (CSS Color 4 §14.2)。これまでは、これらの色を書いた宣言は捨てていた (色は初期値や継承した値になっていた)
  - 変形 (`transform` の 2D の関数 `translate()`・`scale()`・`rotate()`・`skew()`・`matrix()` とその並び、`transform-origin`・`transform-box`、`translate`・`rotate`・`scale`) と、不透明度 (`opacity`。箱と中身をまとめて半透明にする。PDF は透明のグループ) に対応。どちらも描くときだけに効き、組版 (位置・大きさ・ページ分け) は変えない。3D の変換は未対応として知らせる
  - 複数の背景 (`background-image`・`background` のカンマ区切りの層。層ごとの位置・大きさ・繰り返し)、`background-clip`・`background-origin` (`border-box`・`padding-box`・`content-box`。背景の色を塗る範囲にも効く) に対応。`background-attachment: fixed` と `background-clip: text` は未対応として知らせる
  - `object-fit` の `none`・`scale-down` と `object-position` (画像の枠の中での位置)、`list-style-image` (リストの記号の画像) に対応
  - ハイフネーションの制限 (CSS Text 4 §6.3): `hyphenate-character` (行末に出す字。ソフトハイフンで分けた行にも)、`hyphenate-limit-chars` (語・分け目の前後の最小の字数)、`hyphenate-limit-lines` (ハイフンで終わる行が続く数の上限)、`hyphenate-limit-last: always` (段落の最後の行の手前を分けない)、`hyphenate-limit-zone` に対応。`hyphenate-limit-last` の `column`・`page`・`spread` は未対応 (警告に出す)
  - 背景の画像を、`background-clip` の初期値 (`border-box`) では罫線の下まで描く (CSS Backgrounds 3 §2.7)。**組版の結果 (見た目) が変わる**: HTML の、罫線のある箱の背景の画像・グラデーションが、罫線の下にも描かれる。破線・点線・二重線や透明・半透明の罫線では、線のすき間に背景の画像が見えるようになる (繰り返す画像は、padding の箱の左上から罫線の下へも並ぶ。繰り返さない画像の位置は変わらない)。不透明の実線の罫線では、罫線に隠れるので変わらない。これまでどおり罫線の内側だけに描くには `background-clip: padding-box` を指定する。XSL-FO の背景は変わらない (XSL 1.1 §4.9.4)
  - 透明・半透明の罫線の色 (HTML)。**組版の結果 (見た目) が変わる**: `border-color: transparent` の罫線が黒い線で描かれていたのを、描かないようにした (太さの分の場所は取る)。半透明の色 (`rgba()` など) の罫線は、白に混ぜた不透明の色ではなく、その濃さで下の背景に重ねて描く (PDF は透明のグループを使う。PDF/X-3 では警告が出る)
- **リンクとしおり**: ブロック・flex・表の `<a href>` も箱の全体をリンクにする。相対参照のリンク (PDF は GoToR、ほかのファイルは Launch)。どの既定のスタイルでも `h1`〜`h6` をしおりにする (CSS GCPM 3 の付録 B)
- **表**: `border-collapse: collapse` の表で、改ページで繰り返す表ヘッダー・表フッターとの境目の罫線を、両側の線から選び直す (XSL 1.1 §6.7.10・CSS 2.1 §17.6.2.1)
- **書体**: WOFF・WOFF2 (書体の集まりを含む) を読む (`--font`・`fonts`・`@font-face`)。`@font-face` が `http(s):` で参照する書体も取る (`unicode-range` が文書の字と重なるものだけ)
- **可変フォント** (OpenType Font Variations。TrueType の輪郭と、CFF2 の輪郭): 軸の値ごとの形 (実体) で組む。**可変フォントを使う文書の結果が変わる**: 前は、既定の形 (default instance) の 1 つの太さとして組み、太字は輪郭を太らせた擬似太字、`font-stretch` は字形の拡縮だった
  - `font-weight` → 太さの軸 (wght。擬似太字にしない)、`font-stretch`・`font-width` → 幅の軸 (wdth。字形を拡縮しない)、`font-style` の `italic`・`oblique <角度>` → ital・slnt の軸 (あれば)、`font-optical-sizing` → 光学サイズの軸 (opsz。HTML は字の大きさの px の数、XSL-FO は pt)、`font-variation-settings` (任意の軸)。優先の順は CSS Fonts 4 §7.2
  - `@font-face` の `font-weight: 100 900`・`font-stretch: 75% 125%`・`font-style: oblique 0deg 10deg` の範囲、`font-variation-settings`・`font-named-instance` の記述子。`font-weight` の記述子が無い可変フォントも、太さの軸が効く (既定の形の太さが 400 でない可変フォントは、標準の太さの字形も変わる)
  - `--font`・`fonts`・XSL-FO と一緒に渡した可変フォントは、軸の範囲の全体を使う。XSL-FO では、可変フォントのファミリー名を name 表の nameID 16 (太さ・幅をまとめた名前) にした
  - PDF には、使った軸の値の組ごとに、静的な書体にして埋め込む (字の送り HVAR、字の組の詰めと記号の位置 GPOS、書体全体の寸法 MVAR、軸の値による字形の差し替え FeatureVariations も、その軸の値のもの)。画面では、実体を静的な書体としてブラウザに登録して描く
  - Area Tree: 実体を使う字の `fontFamily` に、太さ以外の軸の値の印 (`{;wdth=75}`) が付く。`resources.fonts` の実体の項目に `variation`・`sourceSha256` を足した。`TextStyle` に `fontVariationSettings`・`fontOpticalSizing`・`fontOpticalSizeUnit`・`fontObliqueAngle` を足した
  - 輪郭が CFF2 の可変フォント (OTF の可変フォント) も、軸の値ごとの形で組む。PDF には、既定の形も含めて、静的な CFF の書体に作り直して埋め込む (前は、PDF に埋め込んだ書体が壊れていて、字が別の書体で表示され、字を取り出せなかった)。字の形は変わらないが、ヒントは引き継がない。可変でない CFF2 の書体も、同じように埋め込める
  - `font-stretch` を 100% (normal) に戻す入れ子の指定が、親の幅を引き継いだままになっていたのを直した
- **書体の並び** (HTML の `font-family`): 字 (結合文字・絵文字の並びは、その並び) ごとに、並びの前から順に、その字を持つ最初の書体で組む (CSS Fonts 4 §5.2・§5.3)。読み込んだ書体 (`--font`・`fonts`・`@font-face`) より前に総称・既定の書体の名前 (`"Noto Serif JP", "Noto Emoji", serif` など) がある並びと、読み込んだ書体が 2 つ以上ある並びで、組版の結果が変わる (前にある書体が持つ空白・数字・記号を、後ろの読み込んだ書体で組まない。3 つ目以降の書体も順に引く。和文の字は総称の書体で組む)
- **色の付いた字形のフォント** (カラーの絵文字など): OpenType の COLR/CPAL (version 0・1。グラデーション・変形・合成)、CBDT/CBLC、sbix、SVG の表の字形を、色の付いたまま組む。PDF には Type 3 フォントとして書く (取り出す文字は元の絵文字。同じ字形の定義は文書に 1 つ)。画面 (Canvas) にも同じ図形で描ける。`font-palette` と `@font-palette-values` (`base-palette`・`override-colors`) でパレットを選べる。字 + U+FE0F は色の付いたフォント、字 + U+FE0E は色の付いていないフォントで組む。Area Tree の `GlyphArea` に `fontPalette` (既定のパレットでないときだけ) を足した。**これまで、COLR のフォント (Noto Color Emoji・Twemoji) を使うと PDF の書き出しで落ち、輪郭の表を持たない CBDT のフォントは組めなかった**
- **CFF の輪郭の OpenType の書体 (.otf) の字の形** (字形の輪郭で描く所: 画面 (Canvas) の輪郭の描画、数式、SVG の文字、色の付いた字形。PDF に埋め込む本文の書体は、書体の字形をそのまま埋め込むので、もともと正しい。既定の書体 (TrueType の輪郭) の結果は変わらない):
  - 日本語・中国語・韓国語の書体 (CID 方式。Noto Sans JP・源ノ明朝の .otf など) で、一部の字がまったく別の形になる・描けないことがあったのを直した (書体の中の字の組の、最初の字。Noto Sans JP の .otf では「:」「・」「※」「±」「■」「ゝ」など 29 字)。約物の詰め・行の折り返しは変わらない
  - 浅い曲線の命令 (Type 2 の `hflex`・`hflex1`) を使う字形 (Type 1 から直した書体・STIX Two Math の .otf の数学用の等幅の字など) で、輪郭の一部が縦に数ユニットずれて、角に小さな段が出ていたのを直した。字形の外接枠も直るので、**これらの字形を使う数式では、字の高さ・深さが数ユニット変わりうる**
- **PDF**: ToUnicode で、合字の字 (U+FB01 など) を元の字の並び (fi など) にする。PDF から取り出した字や検索で「confiance」などが見つかる
- **API**:
  - `resolveResource(url)`: 文書・CSS が参照するファイルのうち、`files` に無いものを問い合わせる
  - `fetchStyles`: 文書が `http(s):` で参照する CSS (`@import` の先も) を取る (既定 `true`)
  - `kumiori/node`: `createFontLoader` (Node のコマンドと同じ既定の書体の読み込みとキャッシュ)、`createFileResolver` (`file:` の参照を読む)、`defaultFontCacheDir`・`looksLikeFont`
- **Node のコマンド**: `file:` の URL の参照を読む。`--no-fetch-styles` で CSS を取らない
- **flex の項目の中のページ番号の参照**: `target-counter(…, page)` を持つ flex の項目 (目次の行の `::after` など) の箱の幅を、組んだ番号の桁に合わせる。これまでは 1 桁分の幅で作られ、`word-break: break-word`・`overflow-wrap: anywhere` などがあると 2 桁の番号が「1 / 0」と割れて、目次が伸びていた
- **`createFileResolver`** (`kumiori/node`): `root` に、いくつかのディレクトリの並びを渡せる。中にあるかは、シンボリックリンクをたどった実体のパスで見る (root の中のリンクから外のファイルを読めていたのを直した。Windows の別のドライブ、名前が `..` で始まるファイルの判定も直した)
- **未対応の CSS の警告**: `clip` と `fill` を、「知らないプロパティ」ではなく「未対応のプロパティ」として出す (対応仕様説明書の 16 章にも足した)
- **安全性** (他人の書いた文書を組むときの守り):
  - PDF のリンクの動作を、安全なものに限る。既定で書くのは、文書の中の飛び先、`http`・`https`・`mailto`・`tel` の URL、相対参照の PDF (GoToR) だけ。ほかのスキーム (`javascript:`・`data:`・`file:` など)、PDF でない相対のファイルを開く動作 (Launch。`.html` も)、絶対パスの PDF、`//host/…` は、字だけを組んで動作を書かず、警告に出す。今までどおりにするには、API の `links: { schemes: ['*'], launch: true }`、コマンドの `--link-schemes '*' --link-launch`。スキームは、ブラウザと同じく、前後の制御文字と途中のタブ・改行を取り除いてから見る (`java<TAB>script:` も落とす)。XSL-FO のリンク・しおり・フォームの送り先も同じ
  - `fetchImages`・`fetchStyles` に渡す許可の関数に、転送 (redirect) の先の URL も聞く。Node では転送を 1 つずつ確かめてたどり、許されない先へは要求を出さない (20 回まで)。`https:` から `http:` への転送は、既定 (`true`) でもたどらない。ブラウザでは、要求は転送先に届き、許されない先からの応答を捨てる (ブラウザは転送先を事前に読ませないため)
  - ネットワークから取る CSS (16MB)・書体 (128MB)・画像 (256MB) に大きさの上限を置き、超えたら読むのを途中でやめる
  - EPUB の展開に上限を置く (1 つの項目 256MB: 超えれば飛ばして警告。合計 1GB・項目の数 65,535: 超えれば誤り)
  - `createFileResolver` の `root` は、実体のパスで範囲を見る (上の項目)
  - GitHub Actions: 検査のワークフローのトークンを読むだけにし、Pages へ置く権限・npm へ公開する権限を、置く・公開するジョブだけに渡す。公開は、検査とビルドで作った tarball を、依存を入れずスクリプトも走らせないジョブが公開する形にした
- **壊れた入力・細工した入力への強さ** (止まらなくなる・プロセスが落ちる入力を、その画像・その宣言だけを読めないものとして扱う。上限の値と根拠は各ソースのコメント):
  - 組版: 回り込みの横が狭い段落の直前に、外枠のある `border-collapse: collapse` の表があると止まらなくなるのを直した。これに伴い、こうした表の直後で回り込みの下へ送る箱 (`clear` など) は、回り込みの下端ちょうどに置く (これまでは罫線の半分だけ上に重なっていた。CSS 2.1 §9.5.2)
  - XSL-FO: `fo:marker` の中の `fo:retrieve-marker`・`fo:marker` は読まずに報告する (XSL 1.1 §6.13.5・§6.13.6)。要素の入れ子が 250 段以上の FO は、分かる文の誤りにする
  - 数式: 極端な `scriptlevel` (math-depth は ±100 まで。MathML Core 4.5)、長い `mtext`・多数の子・深い入れ子 (300 段まで) で落ちない
  - HTML・CSS: 引数の無い `attr()`、`@import` の循環と膨らみ、`var()` の多重参照、巨大な `colspan`・`rowspan`・`<col span>` (HTML の上限の 1000・65534)・`repeat()` (列 10000 本まで)、長すぎるカウンターの表記 (1000 字を超えれば fallback。CSS Counter Styles 3 §2) で落ちない。入れ子が 128 段を超える要素は、128 段目の祖先の後ろの兄弟として読み、警告を出す。読み込む CSS が多すぎて捨てた `@import` も警告に出す。取れなかった画像の URL は 1 度だけ試す (読み込みの報告の画像の一覧は、重複を 1 つにまとめる)
  - SVG: path の `Z` の後に数が続く形、`use`・marker・pattern・mask の掛け算の展開 (要素の数 + 50 万回まで)、長い `<style>` で止まらない
  - WMF・EMF・CGM: 点の数・字数・色の表の数を記録の長さで縛る。1 つの文書の画像の画素の合計は 6,400 万画素まで
  - JPEG・TIFF・CCITT: 走査の数 (500 まで)、IFD の値の数、2 次元の行の探索の手間を抑える
  - EPS (PostScript): VM の使用量 (512MB。超えれば VMerror)、パスの点の合計 (500 万点。超えれば limitcheck)、フィルタが読みためる量 (16MB)、画像のマスクの寸法、網かけの画素の手間、`resourceforall` の型紙の照合、`search`、`StartData` の長さに上限を置く
  - 組版: 入れ子の深い文書 (表の中の表、inline-block・float・絶対配置・段組・回したコンテナの入れ子) で、組版の手間が深さに対して指数的に増えていたのを直した (計測・試し組みで求めた値を、1 回の組版の中で覚えて使い回す。組版の結果は変わらない)。XSL-FO の入れ子の表は、12 段で 35 秒かかっていたのが、60 段で 1 秒足らずになる
  - 描画と Area Tree の走査が、深い入れ子でスタックを使い切らない (再帰をやめた)。回転した領域の入れ子は 300 段まで。深すぎる木の直列化は `AreaTreeFormatError`
  - EPS (PostScript): 1 つの EPS が使うメモリの合計に上限を置く (512MB。超えれば VMerror。配列・辞書は、実際に使う量に近い重みで数える)。作る SVG の長さにも上限を置く (128MB。超えれば、そこまでの絵と limitcheck)
  - 出力: `renderPage` が、改行しない空白 (U+00A0) の字形を読めない書体のページで例外にならない。壊れた data URI・`@font-face` の URL 1 つで `typeset` 全体が失敗しない。Node のコマンドは、入力のディレクトリの下の読めないディレクトリを飛ばす
- **結果の誤りの修正** (全体レビューで見つかったもの。どれも、該当する書き方の文書だけ結果が変わる):
  - 組版: 高さの指定の無い段組のコンテナに強制の段区切りがあると中身が消える。段の釣り合わせの試し組みの後、表やコンテナの中の脚注の本体が消える。親と直交する書字方向のブロック・回したコンテナ・inline-container の中の脚注が消える。直交するブロック・表で `break-before`・`break-after`・`keep-together` が効かない (XSL 1.1 §7.20)。段組ページの長い脚注を分けて次のページへ続ける (§6.12.3)。ページをまたぐ段組のコンテナの id と左右の罫線。列の定義の無い表の列数 (rowSpan で埋まる列・表フッター。CSS 2.1 §17.5)
  - HTML: リストの項目の間にコメント・`display: none` の li・ほかの子があっても番号を振り直さない。表の行・行グループのカウンター (セルで reset したカウンターは表の外へ漏れない) と `tr`・`tbody` の id。2 つ目以降の li と、表の行・セル・caption のしおり・`string-set`。1 字ずつ改行した和文に空白を入れない。範囲の外の番号 (`<ol start="0" type="i">` など) は 10 進 (CSS Counter Styles 3 §2)。`%` で符号化した `#fragment`。文書の中の `<svg>` の接頭辞つきの属性。題つきの `rel="alternate stylesheet"` は当てない (CSSOM 1 §6.2。EPUB の章も同じ)。li の `break-before`・`break-after`・`break-inside` (CSS Fragmentation 3 §3.1)
  - EPUB: 章の `html`・`body` の属性を残す (`<html class="vrtl">` の縦書きなど)。単引用符の `container.xml`。`pre` の先頭の改行
  - CSS: HTML の属性による指定は、`@layer` の中の規則より弱い (CSS Cascade 5 §6.5)。ASCII でない名前のカスタム プロパティとカウンター (`var(--色)`・`counter(章)`)。`:has()` の相対セレクタの並び (`:has(> li, > p)`) と範囲 (Selectors 4 §4.5)。読めない `background` の一括指定・不正な色の成分・無効な `var()` (CSS Variables 1 §3.1)・循環する変数は、宣言を無効にする。`calc()` の入れ子の括弧を含む `@page` の `margin`。止まりが 1 つのグラデーション。`font-weight: 550.5`・`line-height: +1.5`・`font: 550.5 12px serif`・`columns: +3` などの数の書き方。`@supports` は、読まないプロパティ・値 (`transform`・`opacity`・`position: sticky` など) に偽を返す (CSS Conditional 3 §6.1)。用紙の大きさに依る `@media` (width・height・orientation など) の中の `@page` の `size` は読まない (CSS Paged Media 3 §7.1)。`@page` の中の `var(--余白)`、`@page 表紙`、`string(題)`、`running(柱)` などの ASCII でない名前
  - 行組み: 異体字セレクタ (IVS・SVS) を基底の字と 1 つの単位にし、書体の異体字の並びの字形を選ぶ (OpenType の cmap の Format 14 の非既定の表も引く。PDF と Canvas の輪郭描画)。`word-break: break-all` でも結合文字の前で分けない。字の単位を書記素クラスタ (UAX #29 の拡張書記素クラスタ。Unicode 18.0.0) にした: 基底の字 + 結合文字 (e + U+0301、か + U+3099)・絵文字の並び (肌の色・ZWJ・国旗・キーキャップ・タグ) は 1 つの字として、1 つの書体でまとめて組み (書体の GSUB・GPOS で、結合文字が基底の字に載る。CSS Fonts 4 §5.3)、途中に改行 (`overflow-wrap: anywhere` を含む)・字間・両端揃えの空きを入れない。拡張 B 以降の漢字・〇・〆 と欧字の間にも和欧間のアキを入れる (CSS Text 4 §8.4.1)
  - タイ語・デーヴァナーガリー (ヒンディー語など)・韓国語: デーヴァナーガリーが組めなかった (fontkit の整形が落ちていた) のを直し、タイ文字の SARA AM・声調記号の字形と字の組の詰めを書体のとおりにした。空白の無いタイ語の文を、辞書 (実行環境の `Intl.Segmenter`) の語の境目で折り返す (語の境目は実行環境で変わりうる)。ハングルの語の間の空白を、書体が文脈で決める幅にした。PDF で、字形の並びが字の並びと対応しない字に元の字の並び (ActualText) を付けた (文字の取り出し)。これらの文字の書体は、既定の書体には無いので指定が要る
  - インド系の文字 (ベンガル・グルムキー・グジャラート・オリヤー・タミル・テルグ・カンナダ・マラヤーラム・シンハラ): 結合子音を 1 つの字の単位にする範囲を、UAX #29 の既定 (Indic_Conjunct_Break のある文字) から、グルムキー・カンナダ・タミル (க்ஷ・ஸ்ரீ)・シンハラ (ヴィラーマ + ZWJ) に広げた (UAX #29 §3 の aksara のあつらえ・CSS Text 3 §1.4。前は、カンナダの ನ್ನ などが、ヴィラーマの見える別々の字になっていた)。マラヤーラムの「子音 + ヴィラーマ」・シンハラの කෝ や「ヴィラーマ + ZWJ」の並びが組めなかった (fontkit の整形が落ちていた) のを直し、シンハラのレパヤ、ベンガルの語の途中の ে・ো の形 (語頭の形にしない)、ヌクタつきの字の後ろの母音記号 (点線の丸が入ることがあった) を書体のとおりにした。字の単位 (音節) の間の詰め (書体の kern・dist) を、インド系の文字にも当てる。**これらの文字の行の幅・字形が変わる**。書体は、既定の書体には無いので指定が要る
  - ラオ語・クメール語・ビルマ語 (ミャンマー文字)・チベット語・モンゴル文字: クメール文字 (記号の位置合わせで落ちていた)・ミャンマー文字 (前に置く母音記号・メディアル・キンジ・積み重ねが元の字の順のままだった)・モンゴル文字 (Noto Sans Mongolian では 1 字も組めなかった) を組めるようにし、ラオ文字の SARA AM・声調記号の字形、クメール文字の必須の合字、字の組の詰めを書体のとおりにした。ミャンマー文字は音節を、ラオ文字は前に置く母音と子音を、1 つの字の単位にする (CSS Text 3 §1.4)。モンゴル文字は、縦書き (`vertical-lr`・`vertical-rl`) でも語がつながり、母音分離子 (MVS)・NNBSP を語に含める。PDF では、これらの字の単位にも元の字の並び (ActualText) を付ける
  - 合字: 書体の合字の表 (OpenType の GSUB) にある字の並びを、長さ・字の種類を限らず 1 つの字形にする (語をアイコンに置き換える書体: Material Icons の `favorite`・`arrow_back`・`3d_rotation` など。前は欧文の字の 2〜4 字だけ)。任意の合字 (`dlig`・`hlig`) と必須の合字 (`rlig`) も、字の並びに当てる。字間 (`letter-spacing`) があっても、`font-feature-settings: "liga" 1` などの明示があれば合字にし、字間は合字の後ろに空ける (CSS Text 3 §7.2・Fonts 4 §7.2)。横書きだけ (縦書きでは合字にしない)
  - XSL-FO: `fo:page-sequence`・`fo:flow` の id を引く `fo:page-number-citation`・`-last` (「全 N ページ」の書き方) を解決する。`fo:page-sequence` に書いた継承される特性 (`text-transform`・`font-family` など) を子に伝える。表のセルの中の `start-indent`・`end-indent` (セルは参照領域。§5.3.2)。縦書き・回転した本文の百分率の基準。`fo:footnote`・`fo:footnote-body`・`fo:page-number` に書いた字の書式。`background-position` の 1 値・縦のキーワード先頭。`keep-*` の成分。`leader-pattern="dots"` の `rule-style="none"`。空の `number-columns-spanned`。数式の書体が無いときの、全体が 1 つの `mtable` の数式の下端揃えは、互換モードのときだけ。`fo:bookmark` の `external-destination` を、PDF のしおりの動作 (URI・GoToR・Launch) として書き出す
  - 数式: 部品から組み立てて伸ばす字 (大きな括弧・根号・横の波括弧) が、目標より大きくなっていたのを直した (部品の重なりの上限を、つなぐ端のコネクタの長さで決める。OpenType の MATH 表の定義。MathML Core §5.3.1 の文面とは向きが逆)
  - 画像: SVG の円弧のフラグを詰めて書いた path (`a1 1 0 01.71.29`。SVG 2 §9.3.9)。動く WebP は最初のコマを描く。CGM の大きさ (64 ビットの実数・32 ビットの整数の精度)。枠が逆向きの EMF
  - EPS (PostScript): `imagemask` の極性 (型紙の白黒が反転していた) と、ImageType 3 の画像のマスクの極性 (描く所と透明の所が逆だった。PLRM §4.10.6)。`SubFileDecode` の、EODCount・EODString を辞書に入れた形 (§3.13.3)。フィルタのエラーを PostScript のエラーにする (それまでに描いたものが残る)。`gsave … show grestore` の後のパス。`currentgstate`・`rectfill`・`rectstroke`
  - EPS (PostScript): 幅と高さの符号が違う矩形 (`rectfill`・`rectstroke`・`rectclip`) も反時計まわりにたどる (向きの違う矩形が 1 回の `rectfill` で重なると、重なりに穴が空いていた。PLRM §4.6.5)。`resourceforall` が、local と global の両方にある実例を 2 度渡さず、名前でも文字列でもない鍵をそのまま渡す。`defineresource` で定義した実例の `resourcestatus` の status は 0 (§8.2)。`ASCII85Decode` の `~` の次が `>` でなければ ioerror (§3.13.3)
  - XSL-FO: 複数のページのマスターが同じ `fo:static-content` を使うとき、読み込みの報告 (ブロック・表の数、未対応の指定) を、マスターの数だけ重ねて数えていたのを直した
  - 参照・書体: 問い合わせ (`?…`) だけが違う CSS (`css2?family=A` と `css2?family=B`) と画像を、それぞれ別のものとして読む。`href` の `&amp;` を解いてから取る。base64 でない data URI の日本語と `;charset=` のパラメータ。`unicode-range` の絞り込みに、文字参照と CSS の文字列の字も数える。ディレクトリの違う同じ名前の書体のファイルを、`@font-face` の CSS の場所から見分ける。`lang` の違う呼び出しが重なっても、終われば元の言語に戻る。`--css "a.css, b.css"` の空白
- **配布物**:
  - `require('kumiori')`・`require('kumiori/node')` で読める (`exports` の条件を `default` にした。フラグ無しで使えるのは Node 20.19.0 以降と 22.12.0 以降)
  - 型の宣言が、`moduleResolution` が `NodeNext`・`Node16` の利用者でも効く (宣言の相対の参照に `.js` を付けた。これまでは誤りになるか、型が any になっていた)
  - `engines` の Node を 20.19.0 以上にした (実行時の依存が求める版)
  - Node のコマンドの出力 (`dist-cli`) に、画面用の `public/` の中身 (favicon など) を入れない
- **`@supports`**: 読めない値の宣言 (`display: foo`・`color: notacolor`・`width: 10` など。まだ対応していない `color-mix()`・`lab()` も) に偽を返す (CSS Conditional 3 §6.1)。未対応のプロパティ・値には、上の「結果の誤りの修正」のとおり偽を返す
- **未対応の CSS の警告**: `text-decoration-skip-ink`・`text-wrap-mode`・`text-wrap-style`・`hyphenate-limit-zone`・`hyphenate-limit-lines`・`hyphenate-limit-last` を、「知らないプロパティ」ではなく「未対応のプロパティ」として出す (対応仕様説明書の 16 章にも足した)
- **開発**: `scripts/compare-pdf.mjs --html` が、いまの画面で動くようにした (設定の引き出しを開いてから選ぶ)。テストが機械のロケール・機械に入っている書体・実行時間に頼らないようにした。テストの書体の取得を 1 か所にまとめ、並列でも壊れないようにした
- **文書**: README の行数・テストの件数、公開の手順の番号、対応仕様説明書・計画などの文書の、実装と食い違う記述と日英の食い違いを直した
- **公開**: 対応仕様説明書の PDF (日本語版と英語版の 4 冊) を、版ごとに GitHub のリリースに付ける。奥付の「組版」の欄は、組んだ Kumiori の版にする
- **第三者の表示**:
  - @pdf-lib/fontkit の配布物に取り込まれたもの (Brotli の展開・base64-js・buffer など) の表示を足した
  - CSS GCPM 3 の付録 B から写した規則の表示を足した (10 節)
  - 出力する JS のファイルの先頭に、Kumiori の版・ライセンスと `THIRD_PARTY_NOTICES.md` の場所を書いた注釈を付ける (CDN からファイルを 1 つだけ読む場合のため)
  - 対応仕様説明書の PDF に埋め込む書体とそのライセンスを、説明書の README に書いた
- **XSL-FO の互換モード (`--compat antenna`・`compat: 'antenna'`) の行送り**: **互換モードで組む XSL-FO の文書の結果が変わります。** 和文と欧文の混じる行の行送りが、`line-height` より少し大きくなっていたのを直した (10pt・`line-height="1.6"` の本文で、混じる行だけ 16pt ではなく 16.22pt。行送りの約 1.35% で、1 ページに 40 行あれば 8pt ほど下へ延びていた)。直した後は、和文だけ・欧文だけ・混じる行のどれも、行送りは `line-height` どおり。あわせて、欧文だけの行の基線が和文の行より少し上 (10pt の字で 0.22pt) にあったのを、和文の行と同じ位置にした (表の同じ行の、和文のセルと数字だけのセルの基線がそろう)。行の中の字の位置は、ブロックの書体の指定の最初の書体 (日本語の文書の `serif`・`sans-serif` は和文の書体) の上下の高さで決める。ブロックの字より大きい字のある行、ルビ・上付き・下付きのある行、`fo:inline` で書体を変えた字の扱い、仕様モード (`--compat spec`。既定)、HTML+CSS の結果は変わらない
- **XSL-FO の性質** (読んで組版へ渡すようにしたもの。`--compat` によらない):
  - 一括指定の `font`・`background`・`page-break-before`・`page-break-after`・`page-break-inside`・`size` と、寸法の上限・下限の `min-height`・`min-width`・`max-width` (表の行は `max-height` も) を読む (XSL 1.1 §7.31・§7.15)。これまでは無視していたので、`page-break-before="always"` などの改ページが効いていなかった
  - `fo:block` の `clear` (`start`・`end`・`both`・`left`・`right`) を読み、その側の先の `fo:float` の下からブロックを始める (XSL 1.1 §7.19.1)
  - `fo:folio-prefix`・`fo:folio-suffix` の中身を、ページ番号 (`fo:page-number`・`fo:page-number-citation`・`fo:page-number-citation-last`) の前後に付ける (「A-12」のような章ごとのノンブル。XSL 1.1 §6.6.13・§6.6.14)
  - 索引を組めるようにした (XSL 1.1 §6.10・§7.24): `index-key` (と `index-class`) を付けた要素と `fo:index-range-begin`〜`fo:index-range-end` の範囲が載るページを集めて、`fo:index-page-citation-list` の所にページ番号の並びを組む。同じページの重複の除去、続いた 3 ページ以上の範囲、`merge-sequential-page-numbers`・`merge-ranges-across-index-key-references`・`merge-pages-across-index-key-references`、区切りの字 (`fo:index-page-citation-list-separator`・`-range-separator`)、前後の字 (`fo:index-page-number-prefix`・`-suffix`)、リンク (`page-number-treatment="link"`) に対応。ページ番号は引いたページの `format` と `fo:folio-prefix`・`fo:folio-suffix` で組む。索引でページが増えても、決まるまで組み直す (決まらなければ警告)
  - `font-variant="small-caps"` (スモールキャップ) と `word-spacing` (語の間の空白に足す長さ) を読む (XSL 1.1 §7.9.8・§7.17.8)
  - `glyph-orientation-vertical` の `auto`・`0deg` (すべての字を立てる)・`90deg` (すべての字を横に倒す) を読む (XSL 1.1 §7.29.3)。180・270 度と `glyph-orientation-horizontal` の 0 度以外は、読まずに報告する
  - `relative-position="relative"` (横書きの `fo:block` をずらして描く)、`visibility` の `hidden`・`collapse` (場所を残して描かない)、絶対配置の `fo:block-container` の負の `z-index` (本文の背面に描く) を読む (XSL 1.1 §7.13.5・§7.30.17・§7.30.18)
  - ページ番号の桁区切り (`fo:page-sequence` の `grouping-separator`・`grouping-size`) を読む (XSL 1.1 §7.26.2・§7.26.3。「1,234」)。`letter-value` の値を受け付ける (§7.26.4)
  - 目次の行: `last-line-end-indent` を読む (XSL 1.1 §7.16.3)。折り返した行を `end-indent` の手前で終え、ページ番号のある最後の行だけを端まで伸ばせる (`text-align-last="justify"` + `end-indent` + 負の `last-line-end-indent`)。`leader-alignment` の `reference-area`・`page` を読む (§7.22.1): 点のリーダーの周期を、本文の領域 (段・表のセル)・ページの端からの格子に合わせる
  - `fo:initial-property-set` を読む (XSL 1.1 §6.6.4): `fo:block` の最初の行にだけ、フォント・`color`・`letter-spacing`・`word-spacing`・`text-decoration`・`background-color` を当てる。`text-transform`・`font-variant`・`line-height`・罫線・`padding` などは読まずに報告する
  - 変更バー (`fo:change-bar-begin`・`fo:change-bar-end`) を読む (XSL 1.1 §6.13.2・§6.13.3): 始まりから終わりまでの行の横に線を引く (入れ子・重なった範囲、段組、縦書き)。`change-bar-color`・`change-bar-offset`・`change-bar-placement` (`start`・`end`・`left`・`right`・`inside`・`outside`・`alternate`)・`change-bar-style`・`change-bar-width`
  - `fo:retrieve-table-marker` を読む (XSL 1.1 §6.13.7): 表の見出し・フッターの中に、その表のそのページ (段) の部分にある `fo:marker` の中身を出す (帳票の「前ページからの繰越」「小計」、表の「(続き)」)。`retrieve-position-within-table`・`retrieve-boundary-within-table` のすべての値。取り出した中身で見出し・フッターの高さが変われば、そのページに入る行の数も変わる。`fo:table` の子として書く形は未対応 (報告する)
  - ハイフネーションの特性 `hyphenation-character`・`hyphenation-push-character-count`・`hyphenation-remain-character-count`・`hyphenation-ladder-count` に対応。`country` を `language` と合わせて規則の選び分けに使う (`language="en" country="GB"` は英国式。**これまで country を無視して米国式で分けていた文書は、分かれ方が変わる**)。`hyphenation-keep` の `column`・`page` は未対応 (警告に出す)
  - **ハイフネーションで分けた行の終わりの字を、仕様モード (`--compat spec`。既定) では U+2010 にした** (XSL 1.1 §7.10.5 の `hyphenation-character` の初期値。これまでは U+002D)。字の幅が変わるので、`hyphenate="true"` の文書は行の分かれ方が変わることがある。互換モード (`--compat antenna`) と HTML は U+002D のまま。U+002D にするには `hyphenation-character="-"` と書く
- **中国語 (繁体字) の句読点**: 字の枠の中央にある句読点 (繁体字の書体の `、。，．`) を、後ろの二分を詰めて次の字と重ねない (`。」`・`，」`・`、）` など)。句読点とコロン類 (`：；`) を終わり括弧類として詰めるか中点類として詰めるかは、書体の字形の墨の位置で決める (CSS Text 4 §8.5.3。簡体字の書体の、枠の左下のコロン類は終わり括弧類)。日本語の書体の結果は変わらない
- **縦書きの句読点 (繁体字の書体)**: 書体に `vert` があるのに句読点を替えないとき、既定の字形 (枠の中央) のまま置く (Unicode の縦書き用字形 = 右上に寄った字形に替えない)
- **中国語の圏点の位置の既定**: 中国語 (`lang` が `zh`) の圏点は、指定が無ければ字の下 (縦書きは右) に付ける (CSS Text Decoration 3 の付録 B の既定のスタイルシート: `:root:lang(zh), [lang|=zh] { text-emphasis-position: under right; }`)
- **`<html lang>`**: `html` の `lang` を、文書の字の言語として body 以下に受け継ぐ (HTML Standard §3.2.6.2。今までは body より内側の `lang` だけを見ていた)。`<html lang="ja">`・`<html lang="zh-…">` だけの文書でも、`line-break` の `normal` (初期値 `auto` も同じ)・`loose` の日本語・中国語だけの決まり (`〜`・`゠` の前で折り返せる、など。CSS Text 3 §5.2) が効く。**結果が変わる**: そういう文書で、`〜` の前が折り返しの位置・両端揃えで空ける位置になる。`hyphens: auto` の分綴の言語も `html` の `lang` で決まる (英語・ラテン語でない言語の文書は、英語の規則で分綴しなくなる)。`--style ah` の行の基準線の決め方 (和文の文書かどうか) も `html` の `lang` を見る
- **`quotes: auto` の中国語の引用符** (`q` 要素など): 簡体字 (`zh`・`zh-Hans`・`zh-CN` など) は `“ ” ‘ ’` にする。繁体字 (`zh-Hant`・`zh-TW`・`zh-HK`・`zh-MO`) は今までどおり `「 」 『 』` (CSS Content 3 §4.1 の挙げる CLDR の引用符)
- **欧文 (ベトナム語・ギリシャ文字・キリル文字)**: ラテン・ギリシャ・キリル文字の分解形 (NFD。`e` + U+0323 + U+0302、多調のギリシャ語など) を、書体が合成済みの字を持てばその字で組む (合成済みの字と同じ見た目・同じ幅。CSS Fonts 4 §5.3)。Latin Extended Additional (U+1E00〜1EFF。`ế`・`ệ`・`ṃ` など) を、語のほかの字と同じ欧文の書体で組み、和欧間のアキ・字の組の詰めの対象にする。ギリシャ文字・キリル文字の字の組を書体の kern で詰める
- **右から左の文字 (アラビア文字・ヘブライ文字)**: アラビア文字の結合文字を UTR #53 の順で重ねる (シャッダの上にファトハが載る)。ゼロ幅非接合子 (U+200C) を語の中で幅 0 にし、単独の LRM・RLM・WJ などの描かない字を幅 0 にする (空白 1 つ分の幅になっていた)。縦書きの中のアラビア文字を、横倒しの語としてつなげて組む (CSS Writing Modes 3 §5.1.1)。PDF から字を読む順で取り出せるようにした (語・クラスタごとの ActualText。字が入れ替わる・別の語になるのを直した)。Canvas の輪郭の描画で、右から左のクラスタの記号の位置を直した。Tinos のヘブライ文字で、母音記号とカンティレーションが互いによける位置になる (フォントの文脈の規則の補いを、右から左の文字にも効かせた)
- **日本語の文書の中のギリシャ文字・キリル文字**: 総称・既定の書体 (和文の書体 + 欧文の書体) で、ギリシャ文字・キリル文字が 2 字以上続く語 (`Россия`・`Ελλάδα`・`αβγ`・`Санкт-Петербург`) を、ラテン文字の語と同じく欧文の書体で組み、和字との間に和欧間のアキを入れる (これまでは、和文の書体が持つ字は和文の書体、持たない字だけが欧文の書体で、1 つの語の中で書体が混ざっていた)。単独の 1 字 (`α`線・`Ω`・`β`-カロテン・`μ`m) は、これまでどおり和文の書体。**結果が変わる**: 和文の書体で組んでいたギリシャ文字・キリル文字の 2 字以上の語。アンテナハウス互換 (`--style ah`・`--compat antenna`) では変えない
- **分綴**: ロシア語 (`ru`)・ウクライナ語 (`uk`)・現代ギリシャ語 (`el`。単調の綴り) の規則を足した (`hyphens: auto`・`hyphenate="true"`。これらの言語の文では、キリル文字・ギリシャ文字の語を分ける)。規則は、使う文書を開いたときだけ読み込む
- **ヘブライ文字 (Tinos・Arimo など)**: 母音記号の後ろに書かれたダゲシュ・シン/スィンの点を、子音と合わせた字形にする (点の並びを、HarfBuzz と同じ順で書体に渡す)。アラビア文字・ヘブライ文字の結合文字の並べ替えは書体に渡すときだけに掛け、PDF から取り出す字は元の並びのままにした
- **第三者の表示 (分綴のパターン)**: 分綴のパターンを取り込んだファイル (ブラウザ向けの配布物と画面の、言語ごとのチャンク) の先頭に、パターンごとの著作権の表示とライセンスの表示を入れた (MIT は許諾の表示の全文。ロシア語のパターンは LPPL で、変更したものであること・変更の内容・元のファイルの入手先・元の作者がサポートしないことを書いた)
- **文書 (対応している言語と文字)**: 対応仕様説明書 (日本語版と英語版の 4 冊) に、5.6 節「対応している言語と文字」を足した。言語・文字ごとに、既定の書体で組めるか・書体の指定が要るか (確かめた書体)、折り返しの決め方、縦書き、主な制限を表にした (確かめていない文字、分綴の規則を持つ言語、可変フォントの軸と色の付いた絵文字の書体に対応していないことも書いた)。XSL-FO 編の 5.4 節の値の表の、分綴の規則を持つ言語を本文に合わせた (ロシア語・ウクライナ語・現代ギリシャ語が抜けていた)。README の「多言語」に、中国語・ベトナム語・ギリシャ文字・キリル文字と、この一覧への案内を足した
- **文書 (書体の見本)**: 対応仕様説明書 (日本語版と英語版の 4 冊) の書体の節に、組版の見本を足した。言語・文字ごとの見本 (世界人権宣言の第 1 条を、日本語・中国語・韓国語・欧文・ヘブライ語・アラビア語・インド系の文字・タイ語などの東南アジアの文字・チベット語・モンゴル文字の、それぞれの書体で組んだもの)、絵文字の見本 (色の付いた絵文字、肌の色・ZWJ の並び・国旗・キーキャップ、U+FE0F と U+FE0E の切り替え、単色の絵文字、縦書き、`font-palette`)、可変フォントの見本 (太さ・幅・傾き・光学サイズ、`font-variation-settings`、`@font-face` の範囲と `font-named-instance`)。見本の書体 (Noto の各書体・Nabla・Anybody・Roboto Flex。SIL Open Font License 1.1) は、リポジトリには入れず、`npm run docs:conformance` が Google Fonts の配信元から取得する (ネットワークが要る。一覧は `scripts/conformance-fonts.mjs`)
- **縦書き (`writing-mode: vertical-lr`) のルビ・圏点の側** (HTML): ルビ (`ruby-position` の指定なし・`over`) と圏点 (`text-emphasis-position` の指定なし・`right`) を、字の右に付ける (CSS Writing Modes 3 §6.4: 行の上側は、vertical-lr でも右。CSS Ruby 1 §4.1、CSS Text Decoration 4 §3.4)。`under`・`left` は左。**vertical-lr の文書の結果が変わる**: 前は逆の側 (ルビ・圏点が左、`ruby-position: under` が右) に付き、圏点は右にできなかった。横書き・vertical-rl と、XSL-FO は変わらない
- **下側のルビ (`ruby-position: under`) の行の空き** (HTML): `line-height` がルビを収めるのに足りないとき、足りない分を、行の上ではなくルビのある側 (行の下。縦書きは左) に空ける (CSS Ruby 1 §3.6)。上と下の両方にルビがあれば、厚さの割合で上下に分ける。**`ruby-position: under` を使い、行間がルビより狭い文書の結果が変わる**: 前は行の上に空けていて、下のルビが、次のルビの無い行の字に重なった。行間に収まるルビ、上側のルビの結果は変わらない

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
