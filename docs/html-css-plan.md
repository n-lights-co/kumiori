> English: [en/html-css-plan.md](en/html-css-plan.md)

# HTML+CSS 組版の計画

Kumiori で、XSL-FO と同じように HTML+CSS の文書を組版できるようにする計画。

## 1. 目的と範囲

- 書籍・報告書・マニュアルのような **ページものの文書** を、HTML+CSS で書いて Kumiori で PDF にする。
- 対象は CSS の「ページの組版」に関わる部分 (CSS Paged Media・CSS Generated Content for Paged Media・CSS Text・CSS Writing Modes・CSS Ruby・CSS Lists・CSS Fragmentation)。
- 画面向けの配置 (flex・grid・transform・アニメーション・JavaScript の実行結果) は、最初は対象外とする (第 4 段階以降に検討)。

## 2. 仕組み

Kumiori は「論理ツリー (`LDocument`) → 組版 (`layoutEngine.ts`) → Canvas / PDF」という作りで、XSL-FO はその論理ツリーへの入口の一つ (`xslfoImport.ts`) にすぎない。
HTML+CSS 用の入口 (`src/htmlImport.ts`) を足せば、組版 (和文組版・脚注・段組・表・縦書き・ルビ・分綴) と PDF 出力はそのまま使える。

```
HTML + CSS ──▶ ① スタイルの確定 ──▶ ② 論理ツリーへ写す ──▶ LDocument ──▶ 組版 ──▶ Canvas / PDF
                (cssCascade.ts)      (htmlImport.ts)
                  └─ ③ ページの指定 (@page など) は自前で読む
```

### ① スタイルの確定 (自前のカスケード。既定)

- HTML を読み (画面は DOMParser、Node のコマンドは linkedom)、各要素の計算値を自前のカスケード (`src/cssCascade.ts`・`src/cssSelector.ts`) で決める。
  継承・セレクタの優先順位・`!important`・既定のスタイル (UA スタイルシート)・単位の換算 (em・% → px)・`::before` / `::after` を扱う (第 6 段階)。
- htmlImport が受け取るのは StyleSource (`style()`・`isAuto()`・`select()`・`contentWidth()`) だけ。ブラウザの配置 (`rect()`) は無いので、
  画像の大きさ・flex・grid・絶対配置・`margin: auto` は CSS の指定から決める (第 6 段階の 4〜7)。
- 単位は px (CSS の 1px = 0.75pt) で返るので pt に直す。
- 画面と Node のコマンドで同じ結果になる (ブラウザの書体や版に左右されない)。

#### ブラウザ経由の経路 (比較用)

画面の「CSS の解釈: ブラウザ」を選ぶと、HTML を見えない iframe に読み込み、ブラウザの確定したスタイル (`getComputedStyle`) と
配置 (`getBoundingClientRect`) を使う (`src/htmlFrame.ts`)。最初はこの経路で作った (第 1〜5 段階の記述はこの経路の話)。
いまは、自前のカスケードの確かめ (`scripts/compare-css.mjs` は計算値を、`compare-pdf.mjs --css-engine browser` は組版を比べる) と、
自前のカスケードが扱えない CSS を試すのに使う。

### ② 論理ツリーへ写す (htmlImport.ts)

確定したスタイルを、`TextStyle`・`BoxStyle` と各ノード (`LBlock`・`LInline`・`LTable` …) に写す。対応の主なもの:

| CSS | Kumiori |
|---|---|
| `display: block / inline / list-item / none` | `LBlock` / `LInline` / リスト (2 列の表、XSL-FO の list-block と同じ) / 出さない |
| `display: table / table-row / table-cell` など、`<table>` | `LTable` (列幅の自動レイアウトは実装済み) |
| `<caption>`・`display: table-caption`・`caption-side: top / bottom` | `LTable.captions` (表の上か下に、表の罫線の外側の幅で置く。CSS 2.1 §17.4・CSS Tables 3 §3.5.3) |
| `font-*`・`line-height`・`color`・`text-align`・`text-indent`・`letter-spacing` | `TextStyle` |
| `margin`・`padding`・`border`・`background-*`・`width`・`height` | `BoxStyle` |
| `writing-mode: vertical-rl`・`text-orientation`・`text-combine-upright` | 縦書き・縦中横 (`LTateChuYoko`) |
| `<ruby>` `<rt>` | `LRuby` |
| `float: left / right` | `LFloat` (start / end) |
| `break-before / after / inside`・`orphans`・`widows` | 改ページ・keep・孤立行の制御 |
| `column-count`・`column-gap`・`column-rule` | 段組 (ページ・コンテナ) |
| `hyphens: auto` + `lang` | 分綴 (英語・ラテン語・ロシア語・ウクライナ語・現代ギリシャ語。文書の中の lang・xml:lang の言語の分綴の表を読み込む) |
| `hyphenate-character`・`hyphenate-limit-chars`・`hyphenate-limit-lines`・`hyphenate-limit-last: always`・`hyphenate-limit-zone` | 分綴の制限 (CSS Text 4 §6.3.2〜§6.3.5。行末に出す字・字数・続く行の数・段落の最後の行の手前・行末の空きの幅)。`hyphenate-limit-last` の `column`・`page`・`spread` は未対応 |
| `vertical-align: super / sub`・`text-decoration` | `baselineShift`・`textDecoration` |
| `<img>`・`<svg>` | `LImage`・SVG (文書の中の `<svg>` は、要素名の大文字小文字を HTML 5.2 §8.2.5.5 の表で戻し、単独の SVG 文書の画像にする。`src/htmlSvg.ts`) |
| `<math>` | 数式用の書体があれば、XSL-FO と同じ MathML の組版 (`mathLayout`) で図形にする。`display="block"` は MathML Core の既定のスタイル (`display: block math`) と同じに、内容の箱の中央に置く |
| `white-space`・`line-break`・`word-break`・`hanging-punctuation` | 空白の扱い・禁則・ぶら下げ |

### ③ ページの指定は自前で読む

`@page` 規則や `@top-center` のようなページ余白の箱は、`getComputedStyle` では取れない。CSS の文字列を自前で読む (SVG の `<style>` 用に書いた `parseCss` を広げて使う)。

| CSS Paged Media | Kumiori |
|---|---|
| `@page { size; margin }`・`:first` `:left` `:right` `:blank` | `PageMaster` と条件付きのマスター (実装済み) |
| 名前付きページ (`page: chapter`) | ページシーケンスの切り替え |
| ページ余白の箱 (`@top-center` など 16 か所) と `content: counter(page)` | static-content 相当 (柱・ノンブル) |
| `string-set` / `string()`・`position: running()` / `element()` | マーカー (`LMarker` / `LRetrieveMarker`、実装済み) |
| `float: footnote`・`::footnote-call`・`::footnote-marker` | 脚注 (`LFootnote`、実装済み) |
| `target-counter(attr(href), page)` | ページ番号の参照 (`LPageNumberCitation`、実装済み) |
| `leader('.')` | リーダー (`LLeader`、実装済み) |
| `bleed`・`marks: crop` | 塗り足し・トンボ (実装済み) |

## 3. 段階

### 第 1 段階: 本文を組めるようにする

- 画面に「HTML を読み込む」を足す (HTML と CSS・画像を一緒に選ぶ。XSL-FO の読み込みと同じ形)。
- ① ② の仕組みと、本文の要素 (見出し・段落・リスト・表・画像・インラインの装飾・縦書き・ルビ) を写す。
- `@page` の `size`・`margin` と、`break-before` / `break-after` (改ページ) まで。
- 確かめ方: 見本の HTML をいくつか作り、e2e テスト (Playwright) で組版できること・ページ数を確かめる。

### 第 2 段階: 本の体裁 (柱・ノンブル・脚注・目次)

- ページ余白の箱 (柱・ノンブル)・`counter(page)`・`counter(pages)`・`string-set`・`running()`
- `:first` `:left` `:right` `:blank`・名前付きページ
- `float: footnote` (脚注)・`target-counter` (目次のページ番号)・`leader()`
- 確かめ方: 目次・脚注・柱のある見本 (1 章ほどの本の体裁) を作る。

**実装の状況 (第 2 段階)**: 対応済み。

- ブラウザが知らない指定 (`string-set`・`position: running()`・`float: footnote`・`page`、`content` の `target-counter()`・`leader()`・`string()`・`element()`) は、CSS を自前で読み (`src/htmlPaged.ts`)、セレクタで要素に当てはめる。勝ち負けは通常のカスケード (`!important`・層 (`@layer`)・詳細度・書いた順。Cascade 5 §6) で決める。
- 拡張の `-ah-linefeed-treatment: ignore` (XSL §7.16.7 の linefeed-treatment。継承する) は、字の中の改行を捨てる (空白にもしない)。
- 互換のスタイル「アンテナハウス互換」(`--style ah`。以下、互換のスタイル): `名前:first` の @page 規則を、ページの組 (`page` と強制改ページを持つ要素 1 つが作るページの並び。GCPM 3 §3.2) ごとの最初のページに当てる (`pageGroupFirst`。CSS Paged Media 3 §4.2.2 の `:first` は文書の最初のページだけで、GCPM 3 も定義し直さない。既定では、ページの名前が変わるところで分けた並びの最初のページに当てる)。
- 行に収まらない中身は、`text-align` が中央・終わりでも行の始めにそろえて終わり側へはみ出す (CSS Text 3 §6.1)。互換のスタイルでも同じ (以前は互換のスタイルで中央にそろえていた (`alignOverflowing`) が、取り除いた)。
- 互換のスタイル (`--style ah`。XSL-FO は `--compat spec` でないとき): SVG の字の `font-family` に書いた名前が、読み込んだ書体の PostScript 名か完全な名前 (Illustrator の書き出す `'SourceSansPro-Black'` など) なら、その書体とその太さで描く (CSS Fonts 4 では、この名前で探すのは `@font-face` の `src: local()` だけ)。
- 互換のスタイル (`--style ah`): 拡張の線種 `dot-dash` (一点鎖線)・`dot-dot-dash` (二点鎖線)・`wave` (波線) を `border-style` の値として読んで描く (`ahBorderStyles`。CSS の値ではないので、既定ではブラウザと同じく宣言を捨てる)。鎖線は太さの 3.8 倍 (二点鎖線は 5.2 倍) の線と、太さと同じ間隔・点、波線は太さの 1/8 の線で周期は太さの約 6 倍。波線は角 (隣の辺の中心線との交わり) で波の中ほどの高さから始まり、辺の長さに半波がちょうど収まるように周期を伸び縮みさせ、横の辺は上へ、縦の辺は内側へ振れて始まる。
- CSS の罫線の破線・点線・鎖線は、辺ごとに辺の中央に対して対称に置く (両端の角が同じ形になり、上と下、左と右の辺は同じ模様。CSS Backgrounds 3 §3.2 の注記が勧める置き方。破線は空きの中央、一点鎖線は点の中央、二点鎖線は線の中央が辺の中央。点線は両端の角に点。1 周期に満たない短い辺は実線)。XSL-FO の罫線は、これまでどおり時計回りに模様を続ける。
- 立体の罫線 (groove・ridge・inset・outset) の色が CMYK なら、RGB (R = (1 − C)(1 − K) など) に直してから明るく・暗くする (CSS Backgrounds 3 §3.2 は作り方を決めていない)。
- 罫線の色も印刷の色 (`device-cmyk()`・拡張の `cmyk()`・`rgb-icc()`) を読む (`border`・`border-color`・`border-<辺>`・`border-<辺>-color`)。
- 接頭辞の無い名前 (標準のプロパティ) に書いたアンテナハウスの拡張の値は、互換のスタイル (`--style ah`) のときだけ読む: `float` の `top`・`bottom`・`start`・`end`・`inside`・`outside`・`center`・`alternate`・`multicol`・`sidenote` など、`width` の単位 `gr`、`text-align` の `inside`・`outside`、色の `cmyk()`・`rgb-icc()` (`htmlPaged.ts` の `compatOnlyValue`・`HtmlImportOptions.ahCssExtensions`)。ほかのスタイルでは、読めない値として宣言ごと捨て (前の宣言を打ち消さない。CSS 2.1 §4.2)、警告に出す。`@supports` にも、互換のスタイルのときだけ真と答える。接頭辞の付いた名前 (`-ah-float`・`-ah-text-align`) に書いた値は、どのスタイルでも読む。以下の節の「拡張の値」の説明は、この決まりの上での動き。
- SVG の字の `font-family` が読み込んでいない Courier・monospace の名前なら、字幅が Courier New と同じ Cousine で描く (名前が Bold などなら太字)。
- 余白の箱の角丸 (`border-radius`・`border-*-radius`) も描く (Paged Media 3 §6 は、CSS 2.1 に無いプロパティの余白の箱での振る舞いを決めていない)。
- 余白の箱は 16 か所すべて。上下の辺の箱は本文の幅いっぱいに置き、揃え (左・中央・右) で位置を分ける (CSS の箱の幅の配分は行わない)。
- `:first`・`:left`・`:right`・`:blank` は条件付きのページマスターにする。名前の無い `:first` は文書の先頭ページだけ、名前付きの `:first` (`chapter:first`) はその名前のページの並びの先頭ページに当てる。
- 名前付きページは、body の直下のブロックの `page` が変わるところでページシーケンスを分ける。
  `page` を比べるのは流れの中のブロックだけ (CSS Page 3 §8.1: `page` は class A の区切りを作る箱に効く)。絶対配置・固定配置・回り込みの箱は
  ページの名前を変えず、最初の流れの中の箱の前にそれらしか無ければ、最初のページはその箱の名前のページにする
  (book の見本の `h1 { position: absolute; visibility: hidden }` の後の `page: full`。WeasyPrint・Chromium と同じ)。
- この段階で残した `string(…, first-except / start)`、`::footnote-call` / `::footnote-marker` / `@footnote` の書式、`target-text()`、本文の中の `counter(page)` は、後で対応した (下の各節)。
- 本の組版向けの既定 (Kumiori の既定のスタイル) には、ページ下の中央のノンブルを含める。

### 第 3 段階: 和文組版と段組

- `text-spacing` (和欧間のアキ・約物の詰め)・`hanging-punctuation`・`text-emphasis` (圏点。未実装なので組版にも足す)・`text-combine-upright: digits`
- 段組 (`columns`)・段抜き (`column-span: all`)・回り込み (`float`)
- `position: absolute / fixed` (ページ基準の配置)

**実装の状況 (第 3 段階)**: 対応済み。

- `text-autospace`・`text-spacing-trim`・`text-spacing` → 和欧間のアキ・約物の詰め。和欧間のアキは CSS Text 4 どおり 1/8 em (互換のスタイル (`--style ah`) では 1/4 em。`-ah-text-autospace-width` も読む)。`hanging-punctuation` → ぶら下げ (CSS の既定は none なので、ブラウザの既定ではぶら下げない。本の組版向けの既定では allow-end)。
- `text-emphasis` (圏点) は、字ごとのルビ (記号をルビ文字にする) にする。空白・約物・記号には付けない。色 (`text-emphasis-color`) はルビの字の色、側 (`text-emphasis-position` の under・left) は 2 段目のルビの側にする (vertical-lr は 1 段目の側だけ)。
- ルビの既定のスタイルは CSS Ruby 1 の付録 A.1 (rt・rtc の字は 50%、line-height: 1、white-space: nowrap など)。ルビの字の大きさは、最初の rt (無ければ rtc) の計算値の font-size の、ruby の font-size に対する比にする。付録 A.1 の注音 (bopomofo) の 30% の規則は、セレクタの並びの終わりに , があって無効なので入れない。
- ルビの配置 (CSS Ruby 1 §4・§5.1): `ruby-position` (`over`・`under`・`alternate` との組。`inter-character` は縦書きだけ = `over`)、`ruby-merge` (`separate`・`merge`。`auto` は未対応)、`ruby-align` (`start`・`center`・`space-between`・`space-around`)、`ruby-overhang` (`auto`・`none`) を、`LRuby` の `rubyPosition`・`rubyAlign`・`rubyAlignUnder`・`rubyAlignBase`・`rubyOverhang` に写す。指定の有無を見分けるため、自前で読んだ宣言を祖先へたどって読む (指定の無いルビは、1 段目は上・2 段目は下、前後の字に掛けない。字の配り方の既定は、根元の書式に付けた `rubyAlign: 'space-around'` = §4.3 の初期値)。
- `text-combine-upright: digits N` は、縦書きの中の N 桁以下の数字を縦中横にする (ブラウザが知らないので CSS から読む)。
- 段組: body (か html) の `columns` はページの段組、ほかのブロックは段組のコンテナ。`column-span: all` は段抜き。`column-fill: auto` 以外は末尾を釣り合わせる。
- `float: left / right` は回り込み (箱の幅・枠・余白は float に移す)。`inside` / `outside` (綴じ側・小口側)、`top` (ページの先頭)、`bottom` (段・ページの下端) も読む (下の「回り込みの拡張」)。`clear` は、その側の回り込みの下まで下げる。
- `position: absolute` は本文領域を基準にそのページへ置き、`fixed` は全ページに置く (余白の箱と同じ静的コンテンツ)。

### 本の体裁の CSS 組版の見本との比較

公開されている見本の HTML・CSS と PDF で、組んだ結果を見比べて、仕様の解釈や細かな組み方を確かめる (見本はリポジトリに入れない)。

```
node scripts/compare-pdf.mjs --html <見本>.html --ref <見本>.pdf --out <出力先> [--web-fonts <dir>]
```

比べるときの既定のスタイルは互換のスタイル (`--style ah`)。

確かめる中で足したもの:

- `@font-face` (一緒に選んだ TTF / OTF / WOFF / WOFF2 (WOFF・WOFF2 は sfnt に戻す。`src/webFont.ts`) を、src の url のファイル名で突き合わせて読み込む。`font-style: italic`・`oblique` の face は斜体・斜めの書体として、`font-stretch` の記述子のある静的な書体の face は幅の違う書体として登録し、CSS Fonts 4 §5.2 の順 (幅 → 傾き → 太さ) で選ぶ)。PDF には、CFF の OpenType は 'CFF ' の表を、使わない字の字形を空にした部分書体 (字の番号は変えない。`src/cff.ts`) にして埋め込む (FontFile3 の CIDFontType0C)。CID 方式の CFF では、本文の字の符号・W・ToUnicode を CID で書く (ISO 32000-2 §9.7.4.2)。OpenType の機能 (onum・vert など) を使う字も、同じ書体の 1 つの埋め込みの字形として書く (機能の組ごとに埋め込み直さない)
- 印刷向けの既定: body の余白 (画面の 8px) を付けない。`@media print` の規則を使い、screen だけの CSS は使わない (`@media` の並びの中の screen の条件は、条件ごと `not all` にする。`<style media>`・`<link media>` の条件は、印刷の媒体 (ページの大きさ) で評価する)。`vh` はページの領域の高さに対して決める
- 既定の用紙 (`@page` で `size` を指定していない文書の用紙): A4・余白 20mm。公開 API の `pageSize`・Node のコマンドの `--page-size` で用紙の大きさを変えられる (CSS の `size` と同じ書き方: `A5`・`A5 landscape`・`148mm 210mm`。CSS Paged Media 3 §7.1)。文書の `@page { size }` があればそちらが勝ち、向きだけの `size: landscape` は既定の用紙を横置きにする。`@media` の `width`・`height`・`orientation` は、この既定の用紙で評価する (同 §7.1: メディアクエリは `size` を見ず、`@page` の規則が無いときに選ばれる用紙で評価する)。既定のスタイル (`--style`) は用紙を決めない (どのスタイルでも同じ)
- `@layer` の入れ子 (Cascade 5 §6.4): 入れ子の層は親の層の中に並び、親の層に直接書いた宣言はその入れ子の層のどれよりも強い (`@layer a.x` を後から書いても `a` の中)
- `target-counter()` の任意のカウンター・`target-text()` (2 回変換して、参照先の番号・文字を集める)、`attr(href url)`
- 要素の `content` (中身の置き換え)、`display: block` の `::before` / `::after`、`content: url()` の画像の寸法、`style` 属性の中のページの組版の指定
- 本文の中の `counter(page)` (囲むブロックのページ番号)、`running()` の要素の中の `counter(page)` / `counter(pages)`
- `string-set` の名前の大文字・小文字の区別、名前付きページごとのページ番号の書式
- `<object data="図.svg">` (画像があれば画像、無ければ中の代わりの内容)、`image-resolution`
- 背景画像 (`background-image` の 1 枚目、repeat・position・size)、半透明の色 (白い紙に重ねた色)、印刷の色 (`device-cmyk()`、拡張の `rgb-icc()`)。読めない色の宣言は、前の宣言を使う。`rgb-icc()` の特色 (`#Separation`) は、特色の値 (`spotColors`、コマンドの `--spot-colors`) に名前があれば PDF の Separation にする (前の宣言の読める色より優先する)
- 脚注の書式: 脚注の要素の字の大きさ・行送り、`@page { @footnote { … } }` (区切り線・上の空き)、`::footnote-call` / `::footnote-marker` (番号の書式と前後の文字、参照番号の大きさ)。`::footnote-marker` の `list-style-position` (GCPM 3 §2.7 の既定は inside。番号の後ろに空きを入れない)。互換のスタイル (`--style ah`) では outside にし、番号を本文の外にぶら下げる (番号の終わりと本文の間は字の大きさの半分)
- `leader()` (Content 3 §5): `dotted` は `leader(".")`。字は終わり側の端から並べ、少なくとも 1 つは見せる。入らなければ前の内容の後で改行し、leader と後ろの内容を次の行に置く (leader の後ろでは改行しない)
- 擬似要素の画像 (`content: url()`) の `-ah-alignment-baseline` (`alignment-baseline`): `text-after-edge` などは画像の下端を字面の下端に、`text-before-edge` などは上端を字面の上端に揃える
- 行グリッドに揃えるために最初の行を下げるとき、まだ中に何も置いていない背景・罫線のある箱は、箱ごと下げる (空きを箱の外にする。目次の行の背景など)
- 脚注どうしの間は空けない (CSS は脚注の要素の余白だけ。組版エンジンの既定の 2pt を使わない)。`@footnote` の em の基準は、互換のスタイルでは初期値 10pt (ページの文脈は根元の要素から受け継ぐが、初期値にする実装も適合: Paged Media 3 §5)
- 横書きの行の中の基線の位置: 最初に使える書体の上の高さ・下の深さ (hhea の ascent・descent) で置く。行内の箱の上端から基線までは (line-height + A − D) / 2 (Inline 3 §5.3 の A′ = A + L/2、L = line-height − (A + D)。CSS 2.1 §10.8.1)。行の中身は、箱ごとの上下 (A′・D′) を基線でそろえて囲む (別の書体・大きさの inline のある行は、line-height より高くなることがある。ブラウザと同じ)。縦書きは中央の基線 (行の中央) のまま。XSL-FO は変えない。アンテナハウス互換 (`--style ah`) は、基線を字の枠 (em の箱) の位置に置き、別の書体の inline があっても行を高くしない (見本の『CSS ページ組版入門』の PDF との組み比べで、基線が合うのはこちら)
- 代わりの書体の字 (最初に使える書体に無い字): 行の高さは最初に使える書体の上下だけで決め、字はその字の書体の基線で行の基線に置く (Inline 3 §5.3。line-height が normal でないとき)。本文の書体に無いリストの印「◦」などで行が高くならない。line-height が normal のときは、代わりの書体 (読み込んだ書体) の上下 (ascent・descent と行間) も数え、その字のある行は、使われた書体の上下を囲む高さになる (同じ節。既定の書体は normal を 1.2 倍と決めてあるので、代わりの書体としては数えない)
- 互換のスタイル: ol・ul の字下げは 2.5em (CSS 2.1 付録 D の 40px ではない)。罫線の太さは px の整数に丸めず (ブラウザは 1px 未満を 1px にする)、thin・medium・thick は 1pt・3pt・5pt
- `-ah-padding-start`・`-ah-margin-before` など (XSL の padding-start などに当たる) は、論理的な内側の余白・余白として読む
- `style` 属性に書いた `-ah-` の別名 (`-ah-line-height-shift-adjustment` など) も、規則と同じく CSS の名前に読み替え、子孫に継承する (以前は、規則に書いたものだけを読み、`style` 属性の値は継承のときに見ていなかった)
- `-ah-line-stacking-strategy` は、XSL の line-stacking-strategy (§7.16.6) として読み、継承する。font-height では、どの行も、ブロックの字の高さ (text-altitude・text-depth) と上下の半行間で同じ高さにする (§4.5 の nominal-requested-line-rectangle。大きな字や上付き・下付きで行が広がらない)
- `display: inline-block` の要素の `writing-mode` が親と違えば (縦書きの行の中の横書きの箱。縦中横など)、箱の中をその書字方向で組む (Writing Modes 3 §7 の直交フロー)。以前は、箱の中も親の縦書きのまま組み、欧文の字が横倒しになっていた
- 脚注の参照番号 (`::footnote-call`) は、脚注の要素の場所に差し込む擬似要素 (GCPM 3 §2.2・§2.6) として、擬似要素は元の脚注の要素から受け継ぐと読み、字の大きさ・太さを、脚注の要素の値と `::footnote-call` の規則から決める (置く所が太字の見出しでも、`font-weight: normal` なら太字にしない。`font-size` は置く所の字の大きさに対する比にして渡す)
- 脚注の参照番号の行の高さ (line-height) も、脚注の要素から受け継ぐ (GCPM 3 §2.6 の既定のスタイルは `line-height: inherit`。擬似要素は元の要素から受け継ぐと読む)。数値 (`.Footnote` の 1.2) は参照番号の字の大きさに掛ける
- 互換のスタイル (`--style ah`、`footnoteCallLineHeightFromParent`): 参照番号の行の高さは、置く所の要素から受け継ぐ (置く所の line-height が数値なら参照番号の字の大きさに掛け、絶対値ならそのまま)。置く所が 1.3 なら行は広がらず、13pt なら 6pt の参照番号の箱が支柱の下へはみ出して行が 0.875pt 広がる
- 両端揃えで、欧文のハイフンの後ろ (`border-*` の `-` と `*` の間など) は、和字が続くとき以外は広げない (CSS Text 3 §7.1: 欧文の両端揃えで広げるのは語の区切り)。以前は、ハイフンの後ろが文字・数字のときだけ広げなかった
- 行グリッド (`-ah-baseline-grid`) の中の行の積み方: 行の前後に半行間を空けず、字の仮想ボディ (em の箱) を、すぐ上の行の em の箱の下端に続けて、基線を次の格子に載せる (字の小さい行の次の行は次の格子、字の大きい行・大きい字のある行は em の箱が入る格子まで送る。line-height の大きさでは送らない)。行グリッドを作った箱 (`new`・`root`) の終わりでは、最後の行の後ろの半行間を空けない (箱の内容の下端は、最後の行の em の箱の下端)。公開の見本の PDF の基線の位置との比較による。行グリッドの中の表のセルには、まだ当てていない (行の上下に半行間が入る)
- 行グリッド (`-ah-baseline-grid`) の中の、背景・罫線のある箱 (目次の章の行など) は、箱の中に字の大きさの範囲 (基線の上の字の上端から字の下端まで) だけを入れ、上下の半行間などは箱の外にする (文字の位置は変わらない)
- 段組の箱の段の釣り合わせ (互換のスタイルに限らない): 最初の段をいちばん長くし、後の段ほど短くする (どの段も前の段より高くしない)。段数に収まる最小の高さでそうなっていればそれを使い、なっていなければ、そうなる最小の高さまで伸ばす (`layoutEngine.ts`)。CSS Multi-column 1 の `column-fill: balance` は「できるだけ均等に」で、決め方は定めていない。段の下端に float がある段組は調整せず、最小の高さにする
- 互換のスタイル (`--style ah`、`leaderFromStart`): `leader()` の点を始めの端 (前の内容のすぐ後) から並べ、`dotted` を `leader(". ")` とする (CSS Content 3 §5.3 は終わりの端にそろえる)
- 互換のスタイル (`--style ah`、`columnsDiscardEndMargin`): 段組の箱で、最後の子の下の余白を段の高さに数えない
- 互換のスタイル (`--style ah`): `bolder`・`lighter` を CSS 2.1 §15.6 のとおり、`@font-face` で定義した書体の太さのうち次の太さにする (Semibold (600) があれば、太字の th はそれになる)。既定のスタイルに CSS 2.1 付録 D の `th { font-weight: bolder }` を足し、`figure` の左右の余白を 0 にする (付録 D に figure は無い。図は本文の幅いっぱいに置く)
- 段組: `column-span: all` の要素は段をまたいで置き、前後で段組を分ける。`direction: rtl` の段組は右の段から並べる (Multi-column 1)。拡張の `-ah-column-rule-length`・`-ah-column-rule-align`・`-ah-column-rule-display` を読む
- 合字の字 (fi・fl など) を含む語も分綴する (合字の字を元の字の並びとして数える)
- SVG の `<image>` の `preserveAspectRatio` (meet と寄せ。SVG 1.1 §7.8。slice は扱わない)
- PDF の SVG の字: 単色の塗りだけの字は、字形の輪郭ではなく、その書体を埋め込んだ PDF の文字として描く (輪郭では、ビューアのヒンティングの有無で低い解像度の位置の見え方が違っていた)
- 縦書きの float: `top`・`bottom` は、包含ブロックが縦書きなら inline-start・inline-end (行頭・行末) にし、float-reference の初期値 inline のとおり本文を回り込ませる (CSS Page Floats 3 §3.2。以前は横書きと同じく段の先頭・末尾に置いていた)。`before`・`after` (拡張の値) は書字方向によらず段の先頭・末尾。`inside`・`outside` は物理の左右 (綴じ側・小口側) なので、縦書きでは段の先頭・末尾になる。縦書きの箱の中の先頭・末尾の float は、箱の内容の端に置く (後に書いた末尾の float ほど端に寄せる)。`float-y` は読まない (通常のブロックとして組む)
- 行内の画像の `vertical-align: bottom`・`top` は、ほかの中身で行の高さを決めてから、行の箱の下端・上端に揃える (CSS 2.1 §10.8.1。揃える画像が行より高ければ、その分だけ行を広げる)。以前は `text-bottom`・`text-top` と同じに字面に揃えていた
- 拡張の `float: multicol top` (と before): 段組の箱の先頭へ、段をまたぐブロック (`column-span: all` と同じ) として移し、段の本文はどれもその下から始める。幅の単位 `gr` は、段の幅と段の間の幅を段・間・段… の順に数えた長さ (n 段で (2n − 1)gr)
- `@counter-style` (CSS Counter Styles 3): system (cyclic・numeric・alphabetic・symbolic・additive・fixed・extends)・symbols・additive-symbols・negative・prefix・suffix・range・pad・fallback を読み、`list-style-type` と `counter()`・`counters()`・`target-counter()` で使う (`src/counterStyle.ts`)。定義の無い名前は decimal と同じ (§5。以前は「•」になっていた)。decimal・disc などの名前の規則は無効 (§2)。名前は大文字・小文字を区別する。speak-as と記号の画像は扱わない
- 斜線 (UAX #14 の SY) の後ろの改行の機会は、次の改行の機会まで 5 字未満なら、ほかに改行できる位置が無いときだけ使う (UAX #14 §5.1 SY の推奨。最小の距離は実装で決める)。「and/or」は分けず、表の見出しの「PDF/A-1a」は列の最小の幅なら「PDF/」の後ろで分ける
- string-set の `content()`・`target-text()` の content・しおりの題の文字は、子孫の `::before`・`::after` の文字を含め、`content` で中身を置き換えた子孫は置き換えた文字にし、display: none の子孫を除く。要素自身の `::before`・`::after` は含めない (GCPM 3 §1.1.1 の例)。子孫の生成した内容の扱いは GCPM 3 に定めが無く、Kumiori はこのように決めた
- 中身に合わせた幅の表 (幅が auto) の左右の余白が auto なら、表の幅を決めた後で残りを余白に配る (CSS 2.1 §10.3.3。表が中央に置かれる)。collapse の表が外枠の罫線を持つ辺は、外へ出る半分を中身の幅に足さない (以前は最後の列と外枠の罫線の間に空きができた)
- 表の行・ブロックコンテナがページに入るかは、中にある脚注の高さも数える (段落の行と同じ。以前は、脚注を持つリストの項目が脚注と重なることがあった)
- 互換のスタイル (`--style ah`、`tableCollapseSpillAh`): collapse の表の外枠の罫線の外へ出る半分を、block 方向では、上は表自身の余白の分までだけ余白に重ね、下は重ねない (CSS 2.1 §17.6.2 では上下とも余白にはみ出す)
- `::before` / `::after` の `color` に書いた印刷の色 (rgb-icc の特色・CMYK) を使う (以前は、要素の色だけを見ていた。見出しの番号など)
- `-ah-border-radius` (と `-ah-border-top-left-radius` など各角) は `border-radius`、`-ah-text-align`・`-ah-text-align-last` は `text-align`・`text-align-last` として読む (CSS のプロパティと同じ値で使われる)
- ブロックの間にある単独の `<br>` は、改行だけの行 (空き 1 行) として残す。HTML の既定のスタイル (WHATWG の描画の節) で br は `display-outside: newline` (強制改行)。Kumiori はこれを CSS 2.1 §9.4.2 の「保たれた改行 (preserved newline) で終わる行」と読み、高さ 0 の行として扱わない (以前は、ブロックの間の空白と一緒に捨てていた)
- リストの項目の本文の最後の子の下の余白は、li の外へ抜けて次の項目との間に残る (リストは表で組むので、セルの終わりでも捨てない)
- 行の中の画像の `-ah-alignment-baseline: text-after-edge` などは、行の書体の字面 (最初に使える書体の上下) に揃える
- 行グリッドの基準 (字の上端から基線まで) は、HTML では最初に使える書体の値 (これまでは文書の言語が分からないと和字の書体の値を使い、欧文の目次の行が下にずれていた)
- 行グリッドの中では、最後の行の後ろの半行間を、ページに入るかの判定に数えない
- リストの箱の `-ah-baseline-grid` は、リストを組む表を包む箱に付ける
- `-ah-` の拡張の読み替え: `-ah-text-autospace`・`-ah-punctuation-trim`・`-ah-hanging-punctuation`・`-ah-image-resolution`・`-ah-line-height-shift-adjustment` (上付き・下付きで行を広げない。組版エンジンと XSL-FO の line-height-shift-adjustment にも足した)

その後に足したもの:

- PDF のしおり: `bookmark-level`・`bookmark-label` (content()・attr()・文字列)・`bookmark-state`。飛び先は要素の id (無ければ付ける)。`bookmark-state: closed` は指定どおり閉じる
- `font-variant: small-caps` / `all-small-caps` (大文字を 0.7 倍に縮めて代わりにする)、`text-transform` (uppercase・lowercase・capitalize・full-width)

改ページの位置に関わる修正:

- 既定のスタイルに互換のスタイル (`--style ah`。CSS 2.1 の付録の既定のスタイルシート) を足した。ブラウザ (Chrome) の既定とは、見出しの余白 (h2 は 0.83em と 0.75em) などが違う
- `-ah-crop-offset` (仕上がりの端から用紙の端までの幅) を読み、用紙の大きさに含める
- 組版エンジン: 分けない指定 (keep-together) のブロックが現ページに入るかの判定で、末尾の space-after (ページの終わりでは捨てる) を数えず、先頭の space-before は前の余白と重ね合わせる (足していた)。XSL-FO の見本のページ数は変わらない
- `image-resolution: from-image` (画像に書かれた解像度。PNG の pHYs・JPEG の JFIF を読む)
- カーニング: `font-kerning: auto` (既定) でも欧文にかける (ブラウザと同じ)

その後に足したもの (2):

- `string(…, first-except)` (値が設定されたページでは空、ほかは持ち越し) と `string(…, start)` (ページの先頭の値)。組版エンジンの retrieve-marker に first-except・start を足した
- OpenType の機能 (`font-variant-numeric` の oldstyle-nums など、`font-feature-settings`)。組版エンジンの TextStyle.fontFeatures: 機能を当てた送りで測り、画面は字形の輪郭、PDF は機能を付けて埋め込んだ書体で描く (palt のような位置の機能も効く)

脚注の番号: CSS の footnote カウンターは文書全体で 1 つなので、名前付きページで page-sequence が分かれても番号を続ける (組版エンジンの FootnoteOptions.continueNumbering)。
段組のコンテナ (`column-count` のリスト) の中の脚注も番号を振り、ページの脚注領域へ積む。
番号は CSS のカウンターの規則 (`counter-reset`・`counter-increment`) のとおりに振り、規則で説明できない番号の振り直しはしない。

### 第 4 段階: flex・grid (実装済み)

(画面の「CSS の解釈: ブラウザ」を選んだときの、ブラウザ経由の経路の話。既定の経路 (自前のカスケード。Node のコマンドも) は iframe を使わず、項目の幅を自前で見積もって 1 行の表にする (`htmlImport.ts` の `flexNoRect`。第 6 段階の 4 と 7))

- flex・grid の配置は、ブラウザが iframe の中で決めたものを使う。各項目の位置と大きさ (getBoundingClientRect) を読み、
  上下に重なる項目を 1 つの帯にまとめる。帯の項目が 1 つなら余白で位置を決めたブロック、2 つ以上なら 1 行の表
  (項目の間の空きは空の列、項目の上下の位置はセルの上の余白) にする。項目の幅・高さはブラウザが決めたもの
- これで flex の横並び・縦並び・折り返し、grid のどれも同じやり方で扱える (表紙・扉の中央寄せ、カードの並びなど)
- 項目の中の文章は Kumiori が組む (ブラウザの書体と字幅が違えば、項目からはみ出すことがある)。縦書きの容器と、容器の直下に文字があるときは、ふつうのブロックとして組む
- 見本: `e2e/fixtures/layout.html`

### WeasyPrint の見本との比較

見本: WeasyPrint の見本集 (github.com/CourtBouillon/weasyprint-samples) の 6 つ。HTML・CSS と WeasyPrint の出力 PDF が入っている (リポジトリには入れない)。
既定のスタイルは「WeasyPrint 互換」で比べる (`compare-pdf.mjs --style weasyprint`。ブラウザの既定 (body の余白 8px を残す) に、WeasyPrint のフォームの部品の既定を足したもの。WeasyPrint 65.1 の css/html5_ua.css で、フォームの部品が書体を受け継ぐこと、字が 0.85 倍、罫線が 1px の黒、fieldset の罫線が文字の色の groove であることを確かめた)。本とポスターは、利用者のスタイルシートを `--css` で選ぶ (`weasyprint -s` と同じ)。

| 見本 | ページ数 (WeasyPrint / Kumiori) | 結果 |
|---|---|---|
| 請求書 (invoice) | 1 / 1 | ほぼ同じ |
| 手紙 (letter) | 1 / 1 | ほぼ同じ (書体の違いが残る) |
| 本 (book) | 56 / 56 | ほぼ同じ (最初はページ数が違った。4 章の開始ページがすべて一致) |
| 報告書 (report) | 8 / 8 | ほぼ同じ (最初はページ数が違った) |
| チケット (ticket) | 1 / 1 | ほぼ同じ |
| ポスター (poster) | 1 / 1 | ほぼ同じ (最初はページ数が違った) |

比較で足したもの (この表と下の項目はブラウザ経由の経路のときのもの。自前のカスケードでの結果は第 6 段階の表):

- HTML から参照されていない CSS ファイルは、利用者のスタイルシートとして文書の CSS の後に足す
- iframe の中で、`@font-face` の書体と `<img>` の画像を、一緒に選んだファイルの blob URL で読む (ブラウザの配置がその書体・画像の大きさで決まる)
- CSS の入れ子 (`&`・子孫の規則)、`@page` の背景色
- 画像: `object-fit` (cover / contain)、`background-size: cover / contain`、max-width などの上限・下限があればブラウザが置いた大きさ、絶対配置の `<img>`、`z-index` が負なら背面
- 絶対配置の `::before` / `::after` (背景画像の箱)、`float: right` の `::after` (行末に寄せる)、`visibility: hidden` の絶対配置の要素は出さない
- 縦並びの flex で高さが決まり、直下に文字があるとき: justify-content を箱の中の上下の揃えにする
- 名前付きページの境目の左右の改ページ (前のシーケンスのページ数の偶奇)。白ページは次のページの名前 (CSS の仕様・WeasyPrint)、互換のスタイル (`--style ah`) では前のページの名前

報告書の見本で足したもの: CSS の変数 (自前で読む宣言の var())、余白の箱の width・height・opacity と、余白が 0 のページでは箱を出さないこと、
`@page` の背景画像 (ページ全体を覆う背面の箱)、記号の無いリスト (`list-style: none`) はブロックの並び、大きさや背景のある回り込みの `::before` (アイコン)、
高さが決まった flex の容器はページをまたがない箱。

ポスター・チケットの見本で足したもの: CSS の `@import` (一緒に選んだ CSS で置き換える)、根元の要素 (html・body) の背景をページの背景にする、
ページの背景画像 (組版エンジンの PageMaster.backgroundImage。本文より先に、塗り足しまで描く)、`inline-block` (行内の箱)、
body・html が flex / grid の容器のとき (body の配置と、ページの中の body の位置)、位置の基準の親の中の絶対配置 (上下の指定なし) は左右の回り込み、
flex の項目の幅に 1.5pt の余裕、特殊な空白 (U+202F など) の置き換え、`line-height: normal` は読み込んだ書体の値 (ascent・descent・lineGap)。
組版エンジン: 基本の書体が持たない字は、欧文の書体・読み込み済みのほかの書体からその字を持つ書体を探す (ヘブライ語は Tinos・Arimo で描ける)。
CSS の float: start / end は、右から左へ書く段落では右 / 左。

本の見本で足したもの: 両端揃えで欧文の語間を本来の幅より詰めない (組版エンジンの TextStyle.wordSpaceShrink)。
ブラウザ・WeasyPrint は語間を詰めず、1 語少なく入れて広げる。HTML の互換のスタイル (`--style ah`) も詰めない。XSL-FO の仕様モードは、両端揃えで組む行でだけ詰める (互換モードは詰めない)。

記号の書体: 文書の文字に、読み込み済みのどの書体も持たない字 (✈ など) があれば、記号の書体 (Noto Sans Symbols 2、約 1.2MB) を 1 度だけ読み込む
(取れなければそのまま。読み込んだ書体は字の書体の代替で使う)。XSL-FO・HTML のどちらでも。
`inline-block` の外側の余白 (margin) は、行の中の箱の寸法に含める (上下は行を高くし、左右は前後の字を離す。組版エンジンの inline-container)。
`@font-face` の書体が font-family の先頭にあれば、その書体が持つ字は欧文に限らず (「…」なども) その書体で組む (CSS の書体の選び方。組版エンジンの defineStack の first)。
その書体に無い字 (和文など) は、並びの次の名前で組む: 後に並ぶ名前で最初に見分けられるものが `serif`・明朝系なら Noto Serif JP、`sans-serif`・ゴシック系・等幅なら Noto Sans JP。後に見分けられる名前が無いときだけ、ファミリ名 (sans など) から決める (`source-sans-pro, serif` の本文の和文は明朝)。
チケットの見本は、WeasyPrint の PDF とほぼ同じになった。

ポスター・手紙の見本で足したもの:

- 根元の要素 (html・body) の背景は、ページの余白の内側 (ページ領域) に描き、位置・`cover` もそこに対して決める (CSS Paged Media・WeasyPrint と同じ。
  組版エンジンの PageMaster.backgroundArea)。`@page` の背景は、これまでどおり用紙全体
- `inline-block` の基線は中の最後の行の基線 (CSS。組版エンジンの LInlineContainer.baselineFrom)。XSL-FO の inline-container は最初の行のまま
- ブロックの明示の高さ (`height`) に、下の padding・border を足す (前は高さの中に含めていた)。`background-size` の百分率 (箱の大きさに対して)。
  読み込んだ書体の無い総称の書体 (`serif` など) は既定の書体にする (親の `@font-face` の書体を受け継がない)
- body の既定の余白: WeasyPrint・ブラウザの印刷は 8px を残し、Vivliostyle 互換・互換のスタイル (`--style ah`) は付けない。既定のスタイルに「ブラウザの既定 (body の余白を残す)」(browser-margin) を足した
- 本の見本で足したもの: 名前の無いページが続く中で左右の改ページで入る白ページは、そのページの名前 (前は次の並びの名前。最後の全面の絵の
  `@page full` の黒い背景が付いていた)。組版エンジンの条件付きのページマスターに trailingBlank (並びの末尾に足した白ページだけ) を足した。
  狭い改行しない空白 (U+202F。フランス語の「 ?」「 !」の前) は U+00A0 に置き換えず、書体が持たなければ 0.2em の空白として測る
  (OpenDyslexic の U+00A0 は 0.78em と広く、行が増えていた)。U+00A0・U+202F・U+2007 の前後では改行しない
- 欧文の文書 (lang が日本語・中国語・韓国語でない) では、欧文の書体に無い記号 (● など) を和文の全角の字でなく Arimo / Tinos (Arial / Times と字幅が同じ) で組む
- 残り: `serif` の書体 (WeasyPrint の Noto Serif が手元に無い)、fieldset の枠の色

画像を iframe で読むようにして、CSS どおりの大きさで描く画像 (`display: block; height: 9pt` の画像など) がある。
前は大きく描いていたため、回り込みの拡張 (`float: top page`・`alternate`・`center` など。Kumiori は一部だけ) を組めていないことが目立たなかった。

### 回り込みの拡張

- 組版エンジンの float に、after (段・ページの下端に、脚注の上に積む)・center (段の中央に置き、その高さには本文を置かない)・alternate (最初の段は end、ほかの段は start) を足した
- HTML の float は、left / right 以外を自前で読み、top / top page / before は上端 (before)、bottom / bottom page / page bottom / after は下端 (after) にする。multicol などの修飾は読まない。sidenote は end
- center の float は、左右に本文を流さず、float の高さの範囲を空けて下へ続ける
- 見出しの番号の `::before` (`display: inline-block; width: 12mm`) は、その幅の行内の箱にする。inline の要素の左右の `margin` は行内の空き (LInline.inlineMargin)
- 高さを釣り合わせる段組のコンテナでは、下端の float (`float: bottom`) を除いて本文の段を釣り合わせ、その後で基準の行のある段の内容の後ろに積む (組版エンジンの Flow の afterBelowContent)

### Vivliostyle の見本との比較

見本: Vivliostyle の文書のリポジトリ (github.com/vivliostyle/vivliostyle_doc) の年次報告書 (日本語。HTML・CSS と Vivliostyle の出力 PDF)。リポジトリには入れない。
和文の書体は游ゴシック (手元に無い) の代わりに Noto Sans JP で組む。既定のスタイルは「Vivliostyle 互換」(`--style vivliostyle`。ブラウザの既定に、見出しの後ろで改ページしない指定を足したもの。Vivliostyle.js 2.38.0 の既定のスタイルで h1〜h6 が break-after: avoid であることを確かめて足した) で比べる。Vivliostyle 互換の既定のスタイルでは、和欧間のアキも入れる (Vivliostyle.js は text-autospace を自前で処理し、初期値は normal) 。見出しのセル (th) は、align 属性によらず中央に揃える (見本の PDF で、align="left"・"right" の th が中央に揃っていることを見た)。

| 見本 | ページ数 (Vivliostyle / Kumiori) | 結果 |
|---|---|---|
| 2022 年度活動報告書 | 6 / 6 | ほぼ同じ |
| 2023 年度活動報告書 | 5 / 5 | ほぼ同じ |
| 2024 年度活動報告書 | 3 / 3 | ほぼ同じ |
| 2025 年度活動報告書 | 5 / 5 | ほぼ同じ (見出しがページの末尾に残っていた。Vivliostyle 互換の既定のスタイルと、送った見出しの先頭の余白を捨てる修正) |
| 2025 年度財務報告書 | 5 / 5 | ほぼ同じ |

比較で足したもの: `@page` の百分率の余白 (左右は用紙の幅、上下は用紙の高さに対して)、余白の箱の `env(doc-title)` (文書の題)、
余白の箱は `@page` に書いた字の大きさ・書体・行送りなどを受け継ぐ、ネットワーク上の画像 (絶対 URL) を読み込む。

### 第 5 段階以降 (必要になったら)

- flex・grid の一部 (表紙や扉のような、ページに 1 つの配置)
- `@font-face` の読み込み、`counter-reset` / `counter-increment` の入れ子の番号
- 表のセル・caption の回り込み (`float`)・絶対配置 (`position: absolute`)・脚注 (`float: footnote`): CSS 2.1 §9.7 では、こうした `td` はセルでなくなりブロックになるが、いまは指定を読まずに、ふつうのセルとして組む (既知の制限。行の作り方を変える必要がある)。リストの項目 (li) のこれらの指定と、セル・caption のしおり・`string-set` は対応済み

### ブラウザを経由しない CSS の解釈 (第 6 段階。既定)

目標: CSS の計算値と配置をブラウザに頼らず、Kumiori が自分で決める (Node・Web Worker でも組め、ブラウザの書体に結果が左右されない)。
htmlImport がブラウザから受け取るのは StyleSource (`style()`・`isAuto()`・`select()`・`rect()`) だけなので、それを自前で作る。

1. **カスケード (済み)**: `src/cssSelector.ts` (セレクタの読み取り・詳細度・照合。結合子・属性・構造の疑似クラス・`:not()`・`:is()`・`:where()`・`:has()`・`:lang()`)、
   `src/cssCascade.ts` (既定のスタイルシート `HTML_UA_CSS`、`!important`・出どころ・詳細度・書いた順、`style` 属性・HTML の属性 (`width`・`align`・`dir` など)、
   一括指定の展開 (`margin`・`border`・`background`・`font`・`font-variant`・`list-style`・`columns`・`text-decoration` など)、継承・初期値・`inherit`/`initial`/`unset`、
   `var()`、長さ (`em`・`rem`・`%`・`vw`・`calc()`・`min()`/`max()`/`clamp()`)、色 (名前・`#rgb`・`rgb()`・`hsl()`))。
   ブラウザが読めない値 (`float: footnote`・`position: running()`・`leader()` の `content` など) の宣言は捨てる (htmlImport は `htmlPaged.ts` で別に読む)。
   一括指定は、どれか 1 つでも読めなければ宣言ごと捨てる。Chrome に合わせたもの: 等幅の書体の字の大きさ (13/16)、`b`・`strong` は `bolder`、HTML の文書の `:lang()` は `lang` 属性だけ、など。
   既定のスタイルシートの前半は、HTML Living Standard (WHATWG) の 15 章「Rendering」の CSS による (2026-11-04 取得。それまでは HTML 5.2 と Chrome の既定によっていた)。
   見出しは `:heading()` (段階は名前と `headingoffset`・`headingreset`)、section の中の h1 も 2em。th の中央ぞろえは親の `text-align` が初期値のときだけ。
   閉じた `details` は最初の `summary` だけを出し、開閉の印 (▸・▾) を付ける。`hidden="until-found"` は `content-visibility: hidden` (箱は残し中身を組まない)。
   表の `border-color: gray` は無い (罫線の色は字の色)。body の余白の属性は `marginheight`・`topmargin` が上下、`marginwidth`・`leftmargin` が左右。
   互換の既定 (`--style ah` など) は、HTML の既定のスタイルの上の層に入れ、詳細度によらず勝つ (`uaExtraCss`)。
   互換モード (quirks mode): DOCTYPE から HTML Living Standard §13.2.6.4.1 のとおり判定する (`documentMode`。DOCTYPE が無ければ quirks。XHTML として読んだ文書は no-quirks)。
   quirks では、15 章の互換モードの規則 (`QUIRKS_UA_CSS`: 表の字の書式を初期値に戻す・リストの外の li は inside など)、§15.3.9 の余白の打ち消し、
   td・th の nowrap と width、ID とクラスのセレクタの大文字小文字を区別しないこと、Quirks Mode Standard の、先頭の `#` を省いた 16 進の色 (`color: ff0000` など。§3.1)・単位の無い長さ (`width: 100` など。§3.2)・中身の無い表 (§3.10) を入れた。
   標準モードの行には、ブロックの最初に使える書体と line-height の支柱 (strut) を入れ、行の高さの下限にする (CSS 2.1 §10.8.1)。縦書きの行の支柱は、字が中央の基線 (em の箱の中央) にそろうので、line-height の半分ずつを基線の左右に置く (CSS Writing Modes 4 §4.2)。
   行内の箱は字ごとの半行間を持つ (CSS 2.1 §10.8.1): 同じ line-height の小さい字 (脚注の番号など) の箱は、大きい字の箱より上下へ出て、行を広げる。
   ずらした字 (上付きなど) は、`-ah-line-height-shift-adjustment: disregard-shifts` ならずらす前の位置で数える。
   強制改行だけの空の行 (pre の空行など) の高さは支柱だけにする (字の無い改行の印を em の箱で測ると、支柱の書体の上下と混ざって行が高くなっていた)。
   字の上下の高さは、OS/2 の sTypoAscender・sTypoDescender が 1 em を成す書体ではその値 (CSS Inline 3 §3.2.1 の注記が勧める値)。
   その書体では hhea の ascent・descent (Source Sans Pro・Source Code Pro は 0.984・0.273) は使わない (使うと、等幅の字の混ざる行が少し高くなる)。
   互換モードと限定互換モードの行の高さ: 支柱 (strut) を作らない (§3.4)。中身の無い行内の箱と空白だけの字は line-height を 0 とみなす (§3.3)。
   互換モードの百分率の高さは、高さの決まった祖先 (無ければページの領域) までさかのぼる (§3.5。標準モードでは、包含ブロックの高さが決まっていれば百分率、
   決まっていなければ auto: CSS 2.1 §10.5)。祖先の飾り線を表に伝えない (§3.11)。color: initial の表は body の色 (§3.12)。セルの高さは border-box (§3.13)。
   html はページの本文領域 (初期包含ブロック) を、body は html を満たす (§3.6・§3.7): body を包むブロックの内容の高さの最小値を、本文領域の高さから
   html・body の余白・罫線・内側の余白を引いた値にする (縦書きは幅)。body の block 方向の両側に罫線か内側の余白があるときだけ広げる
   (無い側では、子の余白が body の余白と相殺されて body の外に出るので、広げた body と合わせてページからあふれる。計算値の min-height で広げたときは、
   WeasyPrint の見本の poster が 2 ページになった。仕様の margins は body の余白の使用値で、相殺した余白の数え方は書いていない)。
   名前付きページで本文を分けた文書は広げない。
   表のセルの最小の幅を測るとき、幅が auto のセルの中の行内の img (セルを包含ブロックとする行の並びの中のもの) の前後では改行しない (§3.8)。§3.9 (nowrap のセルの最小幅) は、表の自動レイアウトがセルの幅の指定を最小幅に使うので同じになる。
   WeasyPrint の見本の invoice・letter・ticket・report・poster は DOCTYPE が無いので quirks になる (invoice は表の字の大きさが初期値に戻る)。
2. **ブラウザとの比較 (済み)**: `scripts/compare-css.mjs` が、見本のすべての要素 (と `::before`・`::after`) について、htmlImport が読む 88 のプロパティを Chrome の `getComputedStyle` と比べる。
   幅・高さが auto でブラウザがレイアウトした寸法 (使用値) を返すものは、違いに数えない。

   | 見本 | 要素 | 値の違い |
   |---|---|---|
   | 本の体裁の CSS 組版の見本 | 7,439 | 0.02% (134。ほとんどは rt の揃え) |
   | WeasyPrint の請求書・チケット・報告書・ポスター・本・手紙 | 31〜332 | 0〜0.25% (フォームの部品の書体など) |
   | Vivliostyle の 2022〜2024 年度報告書 | 55〜146 | 0.02〜0.08% |

   いま (すべての見本、2026 年 10 月): 値の違いはすべて 0。残っていた違いは、次のように片付けた。
   - 直したもの: 表の部品 (`col`・`colgroup`・`thead`・`tbody`・`tfoot`) の `align` 属性も `-webkit-*` にする。
     `counter()`・`counters()` の引数の形を確かめる (カンマの無い `counter(page physical)` の宣言は捨てる)。
     表の列の幅の % は % のまま返し、htmlImport は比例の列幅 (`N*`) にする (基準は表の幅で、レイアウトで決まる)
   - 使用値として数えるもの (カスケードの違いではない): `min-content` などの幅、flex・grid の項目、`min-` / `max-` の制約のある要素、
     表示されない要素 (ブラウザは指定値のまま返す) の幅・高さ

3. **組版での確かめ**: 画面の「CSS の解釈」が「Kumiori」(既定) なら、ブラウザの計算値の代わりにこのカスケードで組む。「ブラウザ」を選ぶと、iframe でブラウザの計算値と配置を使う (`compare-pdf.mjs --css-engine browser`)。
   iframe は使わない (HTML は DOMParser で読む。CSS の集め方 (`<link>`・`@import`・参照されていない CSS・印刷の媒体) は iframe の方式と同じ)。
   - 本の体裁の CSS 組版の見本は、ブラウザの計算値で組んだときと同じ。Vivliostyle の見本も同じか少し良い
   - WeasyPrint の見本のうち、ブラウザの配置 (`rect`) に頼るもの (flex・grid・絶対配置・上限のある画像) は崩れる: ポスター・本・報告書はページ数が増え、
     チケットも崩れる (請求書・手紙はほぼ同じ)
4. **ブラウザの配置 (`rect`) を使わない (済み)**:
   - 画像: 本来の大きさ (`HtmlImportOptions.imageSize`) に `width`・`height`・`max-*`・`min-*` を当てる (CSS 2.1 §10.4 の表。`constrainReplaced`)
   - flex・grid: 項目を行に分けて、行ごとに 1 行の表にする (`flexNoRect`)。flex は `flex-basis`・`width`・`flex-grow`・`flex-wrap`・`justify-content`、
     grid は `grid-template-columns` (`px`・`%`・`fr`・`repeat()`) と `grid-column` の `span`。高さの決まった容器の `align-content` は、組版エンジンの
     `blockAlign: space-between`。幅の指定の無い項目は中身の幅を見積もる (字を測らないので、いちばん長い行の字数 × 字の大きさ。画像は本来の大きさ)。
     容器の幅の余りの分け方 (`flex-grow` の比・幅の分からない項目の等分・`justify-content` の空き) は、比例の列 (`N*` + 固定の長さ) にして組版エンジンに任せる
     (読み込み時に見た幅と、組むときの容器の幅が違っても正しく分かれる: 余白 0 の 1 ページ目の全面の表紙など。WeasyPrint の report の表紙)。
     項目のセルは `keepEdgeSpace` (項目の上下の margin を捨てない。`<td>` も同じ: CSS 2.1 §17.5) と、`align-items: stretch` (既定) なら `stretchContent`
     (行の高さまで項目を伸ばし、背景・枠を行いっぱいに広げる)
   - flex の向き・縮め方・揃え (Flexbox 1): 入りきらない行は `flex-shrink` × 基準の大きさの比で縮め、`min-width` で止まった分はほかの項目が受け持つ (§9.7)。
     `row-reverse`・`column-reverse` は主軸の始めと終わりを入れ替え (`flex-start` は右・下へ寄せる。§5.1)、`wrap-reverse` は行を下から上へ積む (§5.2)。
     `align-items: baseline` はセルの基線の揃え (§8.3)、交差軸の `margin: auto` は揃えより先に空きを取る (§8.1)。高さの決まった 1 行の容器は、
     行の高さを容器の内側の高さにする (§9.4 の 15)。`justify-content` の `start`・`end`・`left`・`right`・`safe`・`unsafe` (CSS Box Alignment 3 §5.1)。
     `row-gap`・`column-gap` の % は計算値に残し、容器の内容の幅・高さに対する割合にする (高さが決まっていなければ 0。CSS Box Alignment 3 §8.1)。
     `::before`・`::after` と `display: contents` の子も項目にし (§4・CSS Display 3 §2.5)、`order` の順に並べる (§5.4。整数でない `order` の宣言は捨てる)。
     ブラウザ経由の経路では、疑似要素の項目は位置が読めないので組まない。
     縮めるときの下限は自動の最小の大きさ (`min-width: auto`。§4.5: 中身の最も狭い幅。欧文は語、和文は 1 字ずつ)、伸ばすときは `max-width` で止める (§9.7 の凍結。読み込みのときの容器の幅で判定)。
     `direction: rtl` の容器は右から並べる (行の表も右から列を並べるので、伸びる列の無い行に終わりの側の空きの列を足す)。
     `last baseline` は、表のセルの `last-baseline` の揃え (最後の行の基線をそろえ、行の下端に寄せる。CSS Box Alignment 3 §4.2 の代わりの揃え end)。
     高さの決まった縦並びの容器は、項目の `flex-grow` と上下の `margin: auto` を論理ツリーのブロックの `flexGrow`・`flexAutoMargin` にし、
     組版エンジンが箱を組んだ後に余った高さを分ける (§9.7・§8.1)。縦並びの `display: contents` の文字・疑似要素も項目にする。
     縦並びは、`row-gap` (項目の間の空のブロック)・`flex-basis` (ブロックの高さ)・`flex-shrink` (組版エンジンが縮める。`flexShrink`・`flexMin`。
     下限は min-height、無ければ中身の高さ)・`flex-wrap` (組版エンジンが列に並べる。`flexWrapColumns`)・交差軸の揃え (背景・枠のある項目は
     中身の幅の箱を `autoMargins` で寄せる) にも対応する。`flex-grow` の合計が 1 未満なら、残りは `justify-content` の空き。stretch は高さの
     決まった項目を伸ばさず、`max-height` で止める (`stretchMax`)。複数行の `align-content: stretch` は、行の表に伸ばす比を付け、組版エンジンが
     行とセルを伸ばす (`growTableLine`)。縦書きの容器は、プロパティの名前を読み替えて (`axisMapper`) 横並びと同じに組む。
     中身の幅の見積もりの空白の詰め方は、CSS の詰める空白だけ (全角の空白 U+3000 は字として数える。CSS Text 3 §4.1.1)。
     縦書きの容器の縦並び (主軸が横) も、同じ読み替えで縦並びの処理を当てる (組版エンジンの縮め・折り返しは、余白・枠を論理の向きで読む)。
     縦並びの折り返しの列ごとに、`flex-grow`・主軸の auto の余白・`justify-content` で余りを分ける (`flexWrapColumns.justify`)。
     `visibility: hidden`・`collapse` は、字の色を `transparent` にして運び (受け継ぐ。中の visible の要素は自分の色)、背景・影を外し、
     枠は太さを残して色を `transparent` にする。描画 (`paint.ts`) は transparent の字・背景と、印の付いた画像を描かない。flex の項目の collapse は
     主軸から外し (主軸の大きさ 0・間の空きなし・その項目では折り返さない)、交差軸の大きさは支柱として残す (幅 0 の列の中に、本来の幅で測った高さの
     空の箱を置く。`LBlock.phantom`。支柱の高さは、畳む前の組み (項目を本来の大きさで並べた行) を表の 1 行として測るだけ組んだ高さ
     (基線の揃えの分も入る。同じ行の支柱どうしは表を分け合い、1 度だけ測る。§9.4)。中身・しおり・リンクは出さず、中の id は飛び先として残す (`phantomIds`)。Flexbox 1 §4.4)。
     min-height の箱の最後の子の下の margin は、min が効かなければ箱の外へ畳み、効いて箱が伸びたら畳まず伸びた分に吸わせる
     (CSS 2.1 §8.3.1・Chromium で測った動き。XSL-FO はこれまでどおり)。aspect-ratio で高さの決まる箱は、いつも畳まない。
     aspect-ratio の箱の min・max は、block・inline とも組版エンジンへ運ぶ (`minBlockSize`・`maxBlockSize`・`minInlineSize`・`maxInlineSize`。
     縦書きは名前を読み替える)。min-height の指定 (0 も) がある箱は中身で伸ばさない。auto の余白は rtl でも物理の左右で配る。
     幅の決まった箱の左右の余白 (CSS 2.1 §10.3.3): 一方だけが auto なら、組むときに残りをその余白に配る (`autoMargins`。両方 auto の箱も、
     組むときの置く場所の幅で等分し直す)。どちらも auto でなければ、包含ブロックが rtl のとき margin-left を捨てて右端から置く
     (ブロック・表・流れの中のブロックコンテナ。`rtlEdge`。XSL-FO と縦書きは対象外)
     grid の項目の collapse は hidden と同じ。`aspect-ratio` は、幅か高さの一方からもう一方を決める。流れの中のブロックで高さが auto なら、
     組版エンジンが組むときの実際の幅から高さを出す (`BoxStyle.aspectRatio`。flex の項目の伸びた幅にも効く)。overflow が visible なら中身で伸び
     (自動の最小の大きさ。CSS Sizing 4 §5.1)、切り抜く箱は比の高さで固定。min-height・max-height (`maxBlockSize`) で比の高さを抑え、
     幅が auto なら比で幅にも移す。float の横で縮めた幅にも効く。float・絶対配置・書字方向が親と違うブロックは、読み込みのときの幅から決める
   - html が flex の容器なら、body を `justify-content`・`align-items` でページの領域の中に寄せる
   - 角丸: `border-*-radius` を読む (角ごと・百分率・楕円。組版エンジンの `BorderRadius.corners`)。ブラウザ経由でも効く
   - 段組のコンテナ (`column-count`): ページに収まらなければ、ページをまたいで段を続ける (1 ページ目はページの残り、最後のページは釣り合わせる)。
     これまでは 1 つの箱にしていて、はみ出した分が切れていた (索引など)
   - 拡張の `-ah-content-width` / `-ah-content-height` (画像の中身の大きさ。% は本来の大きさに対する倍率)
   - 等幅 (`monospace`・`Courier`・`source-code-pro, monospace` など。並びの中で最初に見分けられる名前で決める): 欧文は Cousine (Courier New と字幅互換。
     等幅の指定のある文書のときだけ読み込む)、和文は Noto Sans JP (XSL-FO は Noto Serif JP)
   - 影: `box-shadow` (横・縦・ぼかし・広がり・色。色の alpha は不透明度、複数、`inset` は描かない) と `filter: drop-shadow()` (箱の形の影として近似)。
     ぼかしは、太らせた半透明の形の重ね (SVG の影と同じ近似)。箱の内側には描かない

   | 見本 | ブラウザ経由 | 自前のカスケード (iframe なし) |
   |---|---|---|
   | 本の体裁の CSS 組版の見本 | ページ数が一致 | ブラウザ経由と同じ |
   | Vivliostyle 2022〜2025 (5 つ) | ページ数が一致 | 同じか少し良い |
   | WeasyPrint 請求書・手紙・報告書 | ページ数が一致 | ほぼ同じ |
   | WeasyPrint チケット・ポスター・本 | ページ数が一致 | ほぼ同じ (中身の幅を字幅で測る・margin: auto の中央寄せの後) |

5. **Node のコマンド (済み)**: `npm run build:cli` → `node dist-cli/cli.js book.html -o book.pdf` (README)。ブラウザを使わない。
   - HTML は linkedom で読む。linkedom は HTML の仕様の読み取りと違うところがあるので、書かれていない `<head>`・`<body>` を補い、
     `<pre>` の開始タグの直後の改行を捨てる (`fixImplicitStructure`)。`<table>` の `<tbody>` は補わない (htmlImport は無くても組める)
   - 共通にしたもの: CSS の集め方 (`src/htmlPrepare.ts`)、書体の割り当てと `@font-face` (`src/fontMapping.ts`)
   - 画像は、描けない環境ではファイルの頭から大きさを読む (`headerSize`: PNG・JPEG・GIF・BMP・WebP・SVG。頭の印を確かめ、拡張子だけが画像のファイルは読まない)。
     PDF には PNG・JPEG をそのまま入れ、SVG は図形で描く。GIF・BMP・TIFF (と EPS の TIFF のプレビュー)・WebP (可逆・非可逆・透明度) は画素を読んで PNG にし (`src/pixels.ts`・`src/webp.ts`・`src/vp8.ts`・utif)、
     WMF・EMF は SVG にして図形で描く。EPS は PostScript を実行して SVG にする (`src/eps.ts`)。CGM は要素を読んで SVG にする (`src/cgm.ts`)。図形にできない SVG (影・ぼかし以外の filter など)・描けない EPS は、
     読み込むときに見分けて仮の枠で描き、警告する (`AssetStore` の `parseXml`・`ImageAsset.unsupported`)
   - 直したもの (ブラウザでも): 書体が持たない特殊な空白 (U+2000〜U+200A) は Unicode の定める幅 (Node では字形の無い字の幅になり、目次の行が折り返していた)。
     SVG の `<style>` の `*` (matplotlib の出力)
   - 結果: どの見本も、画面の自前のカスケードと同じ。百ページ余りの見本で約 28 秒
   - `compare-pdf.mjs --pdf <file>`: 出来ている PDF を比べる
   - XSL-FO も組める (`.fo`・`.xml`。XML は xmldom で読む。`--compat antenna|spec`。同じディレクトリの書体ファイルは FO の `font-family` の名前で使う)。
     XSL-FO の見本でも、画面と同じくらいの結果になる。fontkit が外形を読めない字形 (Arimo の U+00A0) の送りは hmtx から読む
   - テスト: `test/cli.test.ts` (dist-cli を作り、FO と HTML+CSS を PDF に組む。CI の `npm test` で動く)
6. **中身の幅を書体の字幅で測る (済み)**: flex の項目の中身の幅 (max-content) は、組版と同じ字幅で測る (`HtmlImportOptions.measureText`。
   画面は Canvas、Node は fontkit の Measurer)。行内の要素は、それぞれの書体・字の大きさ・太さ・字間で測って足す。
   WeasyPrint のチケットと本は、ブラウザ経由の結果に近づいた。ポスターはロゴの並びの間隔の違いが残る。
7. **既定にした**: 画面の「CSS の解釈」の既定を Kumiori にした (Node のコマンドと同じ)。見本はどれもブラウザ経由とほぼ同じ。
   - 幅の決まった箱の左右の `margin: auto` は余白を等分し、ブロックの画像は中央に置く
   - 縦に並べる flex (`flex-direction: column`) は、ふつうのブロックとして組み、項目の揃え (`align-items`・`align-self`) を、
     幅が中身で決まる項目の文字の揃えにする。高さが決まっていれば `justify-content` を中身の上下の揃えにする
   - `compare-css.mjs` はブラウザの計算値と比べるので、CSS の解釈をブラウザにして読み込む

比較の速さ: `compare-css.mjs --list` で複数の見本を 1 度の起動で比べる。`--web-fonts` が無いと、画面が既定の書体を読めず「準備完了」を 180 秒待っていた (今は 15 秒で先へ進む)。

## 4. 確かめ方

- 単体テスト: htmlImport.ts のうち ② (確定したスタイル → 論理ツリー) は、スタイルを差し込める形にして Node で試す。① はブラウザが要るので e2e テストで試す。
- 見本との比較: XSL-FO と同じく、公開されている見本の PDF と組んだ結果を見比べる (`compare-pdf.mjs --ref` を流用)。比べる相手の候補は、本の体裁の CSS 組版の見本、Vivliostyle・WeasyPrint の見本集。
- 和文組版は、XSL-FO の互換モード (`--compat antenna`) の既定 (行送り・和欧間のアキ・ぶら下げなど) を、CSS の既定と別に持つかを第 3 段階で決める。

## 5. 決めたこと

1. **入力の形**: HTML ファイル 1 つに、CSS・画像を一緒に選ぶ。EPUB は対象外 (簡単にできれば足す)。→ 足した (`src/epub.ts`。zip を展開し、spine の順に章をつないで 1 つの HTML として組む。章ごとに改ページ)。
2. **比べる相手**: 公開されている CSS 組版の見本の PDF。
3. **既定のスタイル**: ブラウザの既定と、Kumiori が用意する本の組版向けの既定を、画面で選べるようにする。
4. **ブラウザ以外での変換**: しない (スタイルの確定はブラウザに任せる)。→ 方針を変え、CSS を自前で解釈するようにした (「ブラウザを経由しない CSS の解釈」。いまは既定で、Node のコマンドでも使う)。
