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
- **未対応の CSS の警告**: `text-decoration-thickness`・`text-underline-offset`・`text-decoration-skip-ink`・`text-wrap-mode`・`text-wrap-style`・`hyphenate-limit-zone`・`hyphenate-limit-lines`・`hyphenate-limit-last` を、「知らないプロパティ」ではなく「未対応のプロパティ」として出す (対応仕様説明書の 16 章にも足した)
- **開発**: `scripts/compare-pdf.mjs --html` が、いまの画面で動くようにした (設定の引き出しを開いてから選ぶ)。テストが機械のロケール・機械に入っている書体・実行時間に頼らないようにした。テストの書体の取得を 1 か所にまとめ、並列でも壊れないようにした
- **文書**: README の行数・テストの件数、公開の手順の番号、対応仕様説明書・計画などの文書の、実装と食い違う記述と日英の食い違いを直した
- **公開**: 対応仕様説明書の PDF (日本語版と英語版の 4 冊) を、版ごとに GitHub のリリースに付ける。奥付の「組版」の欄は、組んだ Kumiori の版にする
- **第三者の表示**:
  - @pdf-lib/fontkit の配布物に取り込まれたもの (Brotli の展開・base64-js・buffer など) の表示を足した
  - CSS GCPM 3 の付録 B から写した規則の表示を足した (10 節)
  - 出力する JS のファイルの先頭に、Kumiori の版・ライセンスと `THIRD_PARTY_NOTICES.md` の場所を書いた注釈を付ける (CDN からファイルを 1 つだけ読む場合のため)
  - 対応仕様説明書の PDF に埋め込む書体とそのライセンスを、説明書の README に書いた
- **中国語 (繁体字) の句読点**: 字の枠の中央にある句読点 (繁体字の書体の `、。，．`) を、後ろの二分を詰めて次の字と重ねない (`。」`・`，」`・`、）` など)。句読点とコロン類 (`：；`) を終わり括弧類として詰めるか中点類として詰めるかは、書体の字形の墨の位置で決める (CSS Text 4 §8.5.3。簡体字の書体の、枠の左下のコロン類は終わり括弧類)。日本語の書体の結果は変わらない
- **縦書きの句読点 (繁体字の書体)**: 書体に `vert` があるのに句読点を替えないとき、既定の字形 (枠の中央) のまま置く (Unicode の縦書き用字形 = 右上に寄った字形に替えない)
- **圏点の位置**: `text-emphasis-position` の `under` (横書きは字の下)・`left` (縦書きは字の左) に対応。中国語 (`lang` が `zh`) の既定は字の下 (CSS Text Decoration 3 の付録 B の既定のスタイルシート)
- **ルビの注音符号・拼音**: 注音符号 (ボポモフォ) と声調の記号は、間を空けずにまとめて親文字の中央に置く。拼音 (ラテン文字) は、中国語 (`lang` が `zh`) のルビでまとめて置く (CSS Ruby 1 §4.3)
- **`<html lang="zh-…">`**: 中国語の文書は、`html` の `lang` を字の言語にする (`line-break` の `normal`・`loose` の中国語の決まりが、`body` より内側に `lang` が無くても効く)
- **`quotes: auto` の中国語の引用符** (`q` 要素など): 簡体字 (`zh`・`zh-Hans`・`zh-CN` など) は `“ ” ‘ ’` にする。繁体字 (`zh-Hant`・`zh-TW`・`zh-HK`・`zh-MO`) は今までどおり `「 」 『 』` (CSS Content 3 §4.1 の挙げる CLDR の引用符)

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
