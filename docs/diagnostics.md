> English: [en/diagnostics.md](en/diagnostics.md)

# 診断と誤りの名前

組版の結果の `diagnostics` (`TypesetResult.diagnostics`・`TypesetPdfResult.diagnostics`・`AreaTree.diagnostics`) と、Kumiori が投げる誤り (`KumioriError` とその下の型・`KumioriOptionError`) は、どれも種類の名前 (`code`) を持ちます。ここに名前の一覧をまとめます。表の正は `src/diagnostics.ts` で、この一覧と食い違わないことを `test/diagnostics.test.ts` で確かめます。

## 約束

- 名前は「段/中身」(`css/unknown-property` など。小文字とハイフン) です。一度出した名前は、版をまたいで変えず、別の意味に使い回しません。やめるときは、この一覧に、使わなくなった版を書いて残します。
- 文 (`message`) は、利用者に見せる文 (`lang` の言語) で、版で直すことがあります。種類を見分けるには `code` を使ってください。
- `args` は、文に埋めた値です (機械で読む用)。名前ごとに、下の表の名前で持ちます (無いこともあります)。
- `warnings` (文の並び) は、前と同じ文・同じ並びのままです。`diagnostics` は、同じ出来事を 1 件ずつ持ちます。
  - 未対応・知らない CSS と XSL-FO の指定と、字形の無い字は、`warnings` では 1 つの文にまとめますが、`diagnostics` では項目ごとに 1 件にします。
  - 同じ診断 (名前・文・場所が同じ) は 1 件にして、数を `count` に書きます。
  - 名前ごとに 200 件まで残します。超えた分は、残した診断の `count` には数えず、同じ名前の別の 1 件 (文は「同じ種類の警告がほかに n 件 (m 種) あります」) にまとめます。その 1 件は、`args` の `omitted` に省いた診断の数 (同じ診断の繰り返しも数える) を、`omittedKinds` に省いた種類の数 (名前・文・場所の違うもの) を持ち、`source`・`count` を持ちません。
  - PDF/X・PDF/A・PDF/UA の知らせを `pdfx.warnings`・`pdfa.warnings`・`pdfua.warnings` に分けて出すときも、`diagnostics` には入ります。

## 診断の形

```ts
interface Diagnostic {
  code: DiagnosticCode;        // 種類の名前 (下の表)
  severity: 'error' | 'warning' | 'info';
  message: string;             // 利用者に見せる文
  args?: Record<string, string | number>;
  source?: { file?: string; line?: number; column?: number; element?: string; sourceRef?: number; page?: number };
  count?: number;              // 同じ診断をまとめた数 (1 なら無い)
}
```

## 入力の場所 (source)

診断は、分かるときに入力の場所 `source` を持ちます。どの欄も、分からなければ無い欄です。

- `file`: 入力のファイルの名前 (`TypesetOptions.name`)。CSS の診断は、その CSS のファイルの名前 (`files` の名前) か、`<style>`・`style` 属性なら文書の名前
- `line`・`column`: 1 から数える行と列
  - XSL-FO: 要素の行と列 (ライブラリ・コマンド・画面のどれでも)。ただし、DOCTYPE の内部実体の展開で改行の数が変わった文書は行と列を、字が変わった文書は列を付けません
  - HTML: Node と Web Worker の中 (linkedom で読むとき) は、要素の開きタグの行と列。ブラウザの画面の中 (ブラウザの DOMParser・画面の iframe) は付きません (要素の手がかりだけ)。XHTML (HTML に直して読む)・`--style ah` で字を書き換えて読んだ文書・SVG の foreignObject の中身は付けません
  - CSS の未対応・知らないプロパティ: 要素から分かるものは、その要素の場所。CSS の宣言から数えたものは、CSS のファイル・`<style>`・`style` 属性から、最初に書かれた所を字面で探した行と列 (コメントの中に当たることがあります)
- `element`: 要素の手がかり (`p#intro`・`img.photo`・`fo:block#a` のように、名前と `id`、`id` が無ければ最初の `class`)
- `sourceRef`: 組版の診断のとき、その出来事の箱の Area Tree の `sourceRef` (入力の節の番号)。行の診断 (行が収まらない) は、その行を含む箱の番号
- `page`: PDF を書く途中の診断のとき、描いていたページの番号 (0 から)

同じ名前・同じ文でも、場所が違えば別の診断です (名前ごとに 200 件まで。超えた分は、上の「約束」のとおり 1 件にまとめます)。

## 重さ

- `error`: 出力から入力の中身が欠けた・変わった (画像が無い・字形の無い字・溢れ・上限で打ち切った)。例外にはならず、組版は最後まで行い、PDF も作ります。
- `warning`: 指定を読まずに無視した・別の形で組んだ。
- `info`: 出力は意図どおりで、知っておくとよいこと (選択肢で止めた取得など)。

## コマンドと画面での出し方

- コマンド: 標準エラーに 1 件 1 行で `  警告 [css/unknown-property] style.css:3:3: 知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr` のように書きます。頭は重さで `誤り`・`警告`・`知らせ` (英語では `error`・`warning`・`info`) です。場所は `ファイル:行:列`、続けて分かれば `(要素)`・`(n ページ目)`、同じものが 2 件以上なら終わりに `(n 件)` を付けます。知らせ (`info`) は `--verbose` のときだけ書きます
  - 多い診断は、ほかの診断が埋もれないように、まとめて書きます。字形の無い字 (`font/missing-glyph`) は、多い順に 20 字を並べた 1 行 (`… ਭ (U+0A2D ×4)、… (多い順に 20 字) ほか 625 種`) にします。ほかの名前は 20 行まで書き、残り (上限で省いた分も) を `同じ種類の警告がほかに n 件 (m 種) あります` の 1 行にします。`--diagnostics json` とライブラリの `diagnostics` は、1 件ずつのままです
- `--diagnostics json`: 標準エラーに 1 件 1 行の JSON (`{"input": 入力のファイル, "code": …, "severity": …, "message": …, "args": …, "source": …, "count": …}`) を書きます。知らせも書きます。変換の報告 (`a.pdf: 3 ページ …`) は前のまま書くので、`{` で始まる行を読んでください。文書の字のうち、DEL と C1 の制御文字 (U+007F〜U+009F。改行として扱う読み手のある U+0085 を含む)・行と段落の区切り (U+2028・U+2029)・字の向きの印と制御 (U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069)・BOM (U+FEFF) は、制御文字と同じく `\u2028` のように JSON の文字列のエスケープで書くので、どの読み手でも 1 件は 1 行で、端末に出しても字の並びが変わりません。変換の報告と文字の出力の行でも、入力のファイルの名前を含め、これらの字と制御文字を `\x0a`・`\u2028` のように見える形にします
  - 組めずに止まった誤り (XML の解析の失敗・ファイルが無いなど) も、同じ形の 1 行で書きます: `{"input": …, "name": "KumioriInputError", "code": "input/xml-parse", "severity": "fatal", "message": …, "args": …, "source": …}`。`severity` は `fatal`、`name` は誤りの型の名前で、`code` は Kumiori の誤り (下の「誤りの型と名前」) のときだけ持ちます (ファイルが無いなど、Kumiori の誤りでないものは持ちません)。`args`・`source` は、誤りが持つときだけです。終了コードは前のとおり 1 です。引数の誤り (使い方の誤り) は、JSON にせず文で書きます
- 画面: 警告の欄の各行に、重さの印 (`✖` error・`⚠` warning・`ℹ` info)、`[名前]`、分かれば要素・行・ページを添えます。ページの分かる行を押すと、そのページへ移ります

## 出さない指定と、終了コード

- ライブラリ: `TypesetOptions.diagnostics.ignore` に名前を並べると、その名前の診断を出しません (`warnings` にも `diagnostics` にも、Area Tree にも、PDF を書く途中の警告にも入れません)。知らない名前は止めずに、`api/unknown-diagnostic-code` の警告で知らせます。誤りへの格上げの選択肢はありません (`result.diagnostics` の `severity` を見て判断してください)
- コマンド: `--ignore-warning <名前>` (`,` で区切る・何度でも) で同じことをします。`--fail-on error|warning` を付けると、その重さ以上の診断があれば、出力を書いた上で終了コード 2 で終わります (組めなかった入力があれば 1)。出さない診断は数えません

## 診断の名前

| 名前 | 重さ | 意味 | args |
|---|---|---|---|
| `api/setup-option-ignored` | warning | `createTypesetter` の設定 (書体まわり・`reuse`) を、文書ごとの設定に渡した (使われない) | `option` |
| `api/unknown-diagnostic-code` | warning | `diagnostics.ignore`・`--ignore-warning` に、診断の名前に無い名前を書いた (その名前は止めずに続ける) | `code` |
| `resource/not-fetched` | info | `fetchImages`・`fetchStyles` の設定で、画像・CSS・書体を取らなかった | `url`・`kind` |
| `resource/fetch-failed` | warning | CSS・書体を取得できなかった | `url`・`kind` |
| `resource/attachment-not-found` | warning | 添付ファイルの注釈が指すファイルが `files` に無いか、参照が文書の場所の外 (`file:` などの URL・絶対パス・`..` で上へ出る道) を指すので添付しなかった (文で分ける) | `file` |
| `link/action-dropped` | warning | `links` の設定で、文書の外へのリンクの動作を書かなかった (字は組む) | — |
| `fo/unsupported` | warning | 未対応の XSL-FO の要素・プロパティ・値を無視した (項目ごとに 1 件) | `item` |
| `fo/note` | warning | XSL-FO の読み込みで、近似や既定値で代用した (大きすぎる列の数を上限にした・組になる `fo:index-range-end` が無い・`flow-name` に合う領域が無いので本文の領域へ流した・`page-sequence` が無い・アンテナハウスの説明に無い `axf:document-info` の名前など。文ごとに 1 件。画面の変換レポートの知らせと同じ文) | — |
| `fo/master-reference-not-found` | error | `fo:page-sequence` の `master-reference` に当たるページのマスター (`fo:simple-page-master`・`fo:page-sequence-master` の `master-name`) が無いので、その `page-sequence` を組まなかった | `name` |
| `css/unsupported` | warning | 未対応の CSS のプロパティ・値・規則を無視した (項目ごとに 1 件。CSS として正しいが Kumiori が読まない値 (`font: caption` などのシステムの書体の名前・`font-size: math`) と、互換の指定 (`--style ah`) のときだけ読む、接頭辞の無い名前に書いた拡張の値 (`border-style: dot-dash` など) も) | `item` |
| `css/unknown-property` | warning | 知らない CSS のプロパティを無視した (綴りの誤りか未対応) | `property` |
| `css/invalid-value` | warning | 知っている CSS のプロパティの、読めない値の宣言を無視した (`display: foo`・`color: notacolor` など。値の誤りか未対応。「性質: 値」ごとに 1 件)。作成者のスタイルシートと `style` 属性の宣言だけを数え、`var()`・`attr()` を含む値、接頭辞付きの値 (`-webkit-box` など)、同じ規則 (`style` 属性) に同じプロパティの読める宣言があるもの (ブラウザ向けの予備の値) は数えない | `property`・`value` |
| `css/invalid-attr-value` | warning | `attr()` を置き換えた値が読めない宣言を無視した | — |
| `css/unreferenced-stylesheet` | info | 文書から参照されていない CSS を当てなかった | — |
| `font/face-not-found` | warning | `@font-face` の書体のファイルが見つからない (次の書体で組む) | `font`・`url` |
| `limit/nesting-depth` | warning | 要素の入れ子が深すぎるので、深い要素を浅い所に並べて組んだ | — |
| `limit/css-import` | error | 読み込む CSS (`@import`) が多すぎるので、残りを読まなかった | `file` |
| `limit/raised` | info | 入力の上限 (`limits`・コマンドの `--limit`) を既定より上げた (時間とメモリを多く使いうる。1 回の組版で 1 件) | `limits` |
| `limit/reached` | warning | 入力の上限 (`limits`・コマンドの `--limit`) に当たって、入力の一部を切るか近似して組んだ (上限の名前ごとに 1 回の組版で 1 件。いまは `gridTracks` (grid の列の並びを切った)・`leaderRepeats` (字を並べるリーダーを空きにした)・`nestedSelectors` (展開したセレクタの多すぎる入れ子の規則を読まなかった)・`styleRefs`・`importDepth` (CSS・書体の参照を取らなかった)・`tableColumns` (`col` の `span`・`colspan` を、HTML の仕様の上限の 1,000 より下げた上限で切った)・`pdfImageObjects`・`pdfImagePages`・`pdfImageDepth`・`pdfImageStreamBytes`・`pdfImageLoadMs` (PDF の画像を描かなかった。`pdfImageStreamBytes` は PDF を書くときに当たるので、結果の `toPdf` の後の `warnings`・`diagnostics` に足す))。専用の診断のある上限 (`limit/table-columns`・`limit/css-import` など) は、そちらに出す | `limit`・`value` |
| `font/file-unreadable` | warning | 渡した書体ファイル (`fonts`・`@font-face`) を読めない | `file`・`font` (`font` は、書体の名前の分かる `@font-face` のときだけ) |
| `font/family-unreadable` | warning | 渡した書体ファイルのファミリー名を読めない | `file` |
| `font/generic-not-loaded` | warning | `genericFonts` に書いた書体が読み込まれていない | `font`・`generic` |
| `font/load-failed` | warning | 文書に要る書体 (数式・等幅・記号・絵文字) を読み込めなかった | `font` |
| `font/missing-glyph` | error | 読み込んだどの書体にも字形の無い字がある (字形の無い字の形で出る。字ごとに 1 件) | `char`・`codePoint` |
| `font/system-fallback` | info | どの書体にも字形の無い字を、OS の書体 (`systemFonts`) で組んだ (組んだ結果が、組む機械の書体で変わる。組むのに使った書体ごとに 1 件で、`chars` はその書体で組んだ字) | `font`・`chars` |
| `font/system-font-not-embeddable` | warning | 字を持つ OS の書体があったが、PDF に埋め込めない書体 (OS/2 の fsType) なので使わなかった (その字は `font/missing-glyph` にも出る。書体ごとに 1 件) | `font`・`chars` |
| `font/repaired` | warning | 壊れた表・字形を外して書体を使った | `font` |
| `font/table-unused` | warning | 読みが大きすぎる表を使わなかった (合字・カーニングなどが効かないことがある) | `font` |
| `font/cff2-not-converted` | warning | CFF2 の輪郭の書体を、PDF に埋め込める形にできなかった | `font` |
| `font/variable-unsupported` | warning | 輪郭の差分を持たない可変フォント (既定の形で組む) | `font` |
| `font/variable-instances-capped` | info | 可変フォントの実体が多すぎるので、近い実体で組んだ | `font` |
| `font/variable-failed` | warning | 可変フォントの実体を作れなかった (既定の形で組む) | `font` |
| `font/shaping-failed` | warning | 整形の表 (GSUB・GPOS・morx) で字を組めなかった (合字などなしで組む) | `font` |
| `font/glyph-unreadable` | error | 字形の輪郭・データを読めない字がある (その字は空か、描かない) | `font` |
| `font/color-glyph-too-complex` | warning | 色つきの字形の層・輪郭が多すぎる字を、色なしで描いた | `font` |
| `image/not-found` | error | 画像が見つからないか、画像として読めない | `src` |
| `image/unsupported` | error | 画像を描けないので、仮の枠で描いた | `src`・`detail` |
| `image/partial` | warning | 画像の一部を描けない (形式の読み取りの細かい中身は `detail`) | `src`・`detail` |
| `image/reference-not-found` | warning | SVG の画像の中の `image`・`use` が指すファイルが無い・読めない | `src`・`href` |
| `image/timeout` | error | 画像の形式の読み込みが時限内に終わらない | `src`・`format` |
| `image/invalid-size` | error | 画像の形式が返した大きさが大きすぎる・有限でない | `src`・`format` |
| `image/too-many-fragments` | warning | 1 つのファイルを fragment の違う参照で指す数が多すぎる | `src` |
| `image/format-warning` | warning | 画像の形式 (draw.io・プラグインなど) の読み取りが出した警告 | — |
| `image/pdf-invalid` | error | PDF の画像を読めない (壊れている・ページが無い・入れ子が深すぎる・上限を超えたなど。理由は `detail`)。仮の枠で描いた | `src`・`detail` |
| `image/pdf-encrypted` | error | PDF の画像が暗号化されているので読めない。仮の枠で描いた | `src` |
| `image/pdf-page` | warning | PDF の画像の `#page=` の値が読めない・ページの数を超えるので、1 ページ目を貼った | `src`・`detail` |
| `image/pdf-page-range` | warning | PDF の画像の `#page=` がページの範囲なので、範囲の最初のページだけを貼った (互換の指定のとき) | `src`・`detail` |
| `image/pdf-fragment` | warning | PDF の画像の `#` の後ろに、読まない引数・値がある (アンテナハウスの `bbox=` や範囲は、互換の指定のときだけ読む) | `src`・`detail` |
| `image/pdf-repaired` | info | PDF の画像に仕様に合わない所があったが、直して読んだ (頭の前の余分なバイト・90 の倍数でない回転など) | `src`・`detail` |
| `image/pdf-dropped` | info | PDF の画像の注釈 (リンク・注記・フォームの欄など) を、組んだ PDF に持ち込まなかった (図の中身だけを貼る) | `src`・`detail` |
| `image/pdf-font` | info | PDF の画像の中の書体が埋め込まれていない (ビューアが代わりの書体で描く) | `src`・`font` |
| `image/pdf-placeholder` | error | PDF の画像は PDF の出力でだけ描けるので、画面・SVG・PNG では仮の枠で描いた (`output` は描いた出力: `screen`・`SVG`・`PNG`) | `src`・`output` |
| `layout/line-overflow` | error | 行がページに収まらない | — |
| `layout/box-overflow` | error | 箱がページより大きいので溢れる | — |
| `layout/float-overflow` | error | float がページより大きいので溢れる | — |
| `layout/footnote-overflow` | error | 脚注がページに収まらないので溢れる | — |
| `layout/column-overflow` | error | 段組の容器に中身が収まらない | `columns` |
| `layout/table-row-overflow` | error | 表の行がページの高さを超えるので溢れる | — |
| `layout/continuation-dropped` | error | 脚注・float の続きを、どのページにも置けないので置かなかった | — |
| `layout/inline-block-dropped` | error | 行内の箱の中のブロックを置けないので、中身を省いた | — |
| `layout/height-cut` | error | 高さの指定が 50 ページを超える箱を、50 ページで打ち切った | — |
| `layout/keep-overflow` | warning | keep を保つため、ブロックをページの下へはみ出させた (`--compat antenna`) | — |
| `layout/condense-overflow` | error | `overflow="condense"` の中身が、詰めても収まらない | — |
| `layout/condense-capped` | warning | 入れ子の `overflow="condense"` の測る回数の上限で、内の容器を詰めなかった | — |
| `layout/condense-height-unknown` | warning | 高さが決まらないので、`overflow="condense"` で詰めなかった | — |
| `layout/marker-misplaced` | warning | `fo:retrieve-marker`・`fo:retrieve-table-marker` を置けない所に書いた | — |
| `layout/table-header-not-repeated` | warning | 表の見出しと脚がページより高いので、続きのページで繰り返さなかった | — |
| `layout/missing-id` | warning | ページ番号の参照・しおりの飛び先の id が無い (`warnings` では種類ごとにまとめる) | `id`・`kind` |
| `layout/index-key-missing` | warning | 索引の鍵 (`ref-index-key`) の付いた所が無い | `key` |
| `layout/not-converged` | warning | ページ番号の参照・索引・最終ページのマスターが収束しなかった | `what` |
| `layout/max-pages-reached` | info | 先頭から `maxPages` ページまで組んで止めた (`--max-pages`) | `maxPages` |
| `layout/beyond-max-pages` | warning | 先頭から `maxPages` ページで止めたので、それより後ろを指すページ番号の参照・総ページ数・索引・しおりが決まらなかった (種類ごとに 1 件。参照は `"?"` で組む) | `maxPages`・`kind`・`count`・`ids` |
| `limit/measure-nesting` | warning | 幅を中身で決める箱・段組の入れ子が深すぎるので、測らずに組んだ | — |
| `limit/table-row-span` | warning | 表の行をまたぐセルの広がりが上限を超えた分を、またがせなかった | — |
| `limit/table-columns` | warning | HTML の表の列 (`col`・`colgroup` の `span` の合計) が上限 (1,000 列) を超えたので、超えた分の列を捨てた (表ごとに 1 件) | `limit` |
| `limit/table-structure-cells` | warning | タグ付き PDF の表の構造で、行のセルの数をそろえる空のセルが上限 (文書のセルの数か 1 万の大きい方) を超えたので、その表は空のセルを行ごとに 1 つにまとめ、列をまたぐ数 (`ColSpan`) でそろえた | `tables` |
| `limit/link-description` | warning | タグ付き PDF のリンクの注釈の説明 (`Contents`) を、長さの上限 (2,000 字) で切った | `links` |
| `pdf/glyph-not-drawn` | error | PDF に描けない字があった (描かない) | `font` |
| `pdf/notdef-not-drawn` | error | PDF/A・PDF/UA-1・PDF/X-4 で、字形の無い字 (.notdef) を描かなかった | `font` |
| `pdf/svg-links-capped` | warning | SVG のリンクが 1 ページに多すぎるので、残りをリンクにしなかった | — |
| `pdf/foreign-object-approximated` | warning | SVG の foreignObject の中身を、文字だけで近似して描いた | — |
| `pdf/form-field-failed` | warning | フォームの欄を作れなかった (枠の見た目だけを残す) | `field` |
| `pdf/color-glyph-image` | error | 色つきの字形の画像を PDF に埋め込めなかった | — |
| `pdf/color-glyph-svg` | warning | SVG の表の字形に、図形にできないものがある (輪郭で描く) | `font` |
| `pdf/color-glyph-plus` | warning | 色つきの字形の合成 PLUS を、ふつうの重ねで描いた | — |
| `png/image-not-drawn` | error | `renderPageToPng` で、画素に戻せない画像 (CMYK の JPEG・インターレースの PNG など) を描かなかった | `src` (SVG の中の画像では、その画像を含む SVG の画像の `src`) |
| `png/image-limit` | error | `renderPageToPng` で、1 ページで画素に戻す画像の画素の数が上限 (合わせて 4 億画素) を超えたので、残りの画像を描かなかった | `src` (SVG の中の画像では、その画像を含む SVG の画像の `src`) |
| `png/raster-budget` | error | `renderPageToPng` で、ページを画素にする手間が上限を超えたので、残りの図形・字・画像を描かなかった (描き切れない SVG の画像は仮の枠) | — |
| `png/layer-limit` | warning | `renderPageToPng` で、入れ子の不透明度のグループ・マスクが多く、同時に持つ板 (ページの外の描き場) の画素の数 (切り抜きを含めて) が上限 (ページの画素の数の 8 倍 (1,600 万画素より少なくはしない)、かつ 6,400 万画素) を超えるので、不透明度のグループを板を使わずに描くか (中の図形ごとに不透明度を掛ける)、板に描いた所までを重ねてから続きを描き (どちらも中の重なりは濃くなる)、広げられないマスク・色つきの字形の合成を描かなかった (広がる板は、実際に広げた大きさで数える) | — |
| `png/clip-limit` | warning | `renderPageToPng` で、入れ子の切り抜きが多く、同時に持つ切り抜きの覆う割合と板の大きさが上限 (`png/layer-limit` と同じ。切り抜きの 1 画素は板の 1/4 画素と数える) を超えるので、深い所の切り抜きは、外側の切り抜きを囲むなら外側の切り抜きのまま描き (その切り抜きの縁を描き分けない)、囲まないなら中を描かなかった (いちばん外の切り抜きは、上限を超えても持つ) | — |
| `canvas/svg-not-drawn` | error | Web Worker の中の `renderPage` で、SVG の画像を画素にする手間が上限を超えたので、その画像を仮の枠で描いた | `src` |
| `pdfx/transparency` | warning | 透明を使えない PDF/X (X-3) で、透明を使った | — |
| `pdfx/rasterized` | warning | 透明を平らにするため、範囲を画像にした | — |
| `pdfx/spot-in-raster` | warning | 画像にした所に特色が掛かっている (代わりの CMYK になる) | — |
| `pdfx/text-in-raster` | warning | 画像にした所に字が掛かっている | — |
| `pdfx/icc-fallback` | info | ICC プロファイルの表が読めないので、RGB を式で CMYK にした | — |
| `pdfx/annotations-dropped` | info | PDF/X で、ページの中の注釈・リンク・フォームの欄を書かなかった | — |
| `pdfx/actions-dropped` | info | PDF/X で、動作 (しおりの外への飛び先・動作を持つ注釈) を書かなかった | — |
| `pdfx/check` | warning | 書き出した PDF を GWG 2022 の決まりに照らして合わなかった | — |
| `pdfx/embedded-pdf` | warning | PDF の画像のページが PDF/X の決まりに合わないので、埋め込まずに仮の枠で描いた (合わない所は `detail`) | `src`・`detail` |
| `pdfa/launch-dropped` | info | PDF/A では、ファイルを開く動作 (`links.launch`) を書かない | — |
| `pdfa/cmyk-converted` | info | PDF/A (sRGB) で、CMYK の色を RGB に直した | — |
| `pdfa/forms-dropped` | warning | PDF/A では、フォームの欄を書かない (枠の見た目は残る) | — |
| `pdfa/attachments-dropped` | warning | PDF/A で、PDF/A でない添付ファイルを埋め込まなかった | — |
| `pdfa/freetext-appearance` | warning | PDF/A で、FreeText の注釈の外観に字を描けなかった | — |
| `pdfa/embedded-pdf` | warning | PDF の画像のページが PDF/A の決まりに合わないので、埋め込まずに仮の枠で描いた (合わない所は `detail`) | `src`・`detail` |
| `pdfua/missing-title` | warning | PDF/UA-1: 文書の題が無い | — |
| `pdfua/missing-lang` | warning | PDF/UA-1: 文書の言語が無い | — |
| `pdfua/missing-figure-alt` | warning | PDF/UA-1: 代わりの文の無い図がある | — |
| `pdfua/missing-formula-alt` | warning | PDF/UA-1: 代わりの文の無い数式がある | — |
| `pdfua/heading-skipped` | warning | PDF/UA-1: 見出しの段が飛んでいる | — |
| `pdfua/embedded-pdf` | warning | PDF/UA-1: PDF の画像のページに埋め込まれていない書体があるので、埋め込まずに仮の枠で描いた | `src`・`detail` |
| `snapshot/wait-timeout` | warning | `snapshotDocument` で、待つ時間 (`timeoutMs`) が過ぎたので、その時の文書で文字にした (`waiting` は待っていたもの: `load`・`fonts`・`waitFor`・`animations`) | `waiting`・`ms` |
| `snapshot/iframe-skipped` | warning | `snapshotDocument` で、`<iframe>` の中の文書は写していない | `src` |
| `snapshot/canvas-tainted` | warning | `snapshotDocument` で、別の origin の画像で汚れた canvas を画像にできなかった (canvas のまま残した) | `element` |
| `snapshot/canvas-too-large` | warning | `snapshotDocument` で、canvas の画素の数 (`imagePixels`)・PNG の大きさ (`fileBytes`) が上限を超えたか、ブラウザが PNG を作れなかったので、画像にしなかった (`size` は画素の数かバイト) | `element`・`size`・`limit` |
| `snapshot/stylesheet-rule-removed` | warning | `snapshotDocument` で、`<style>` の元の字にあって CSSOM から消された規則を、元の字から消せないので残した | `count` |
| `snapshot/blob-unreadable` | warning | `snapshotDocument` で、blob: の URL の中身を読めなかったか (消された URL など)、上限 (`fileBytes`) を超えたので、取り込まなかった | `url` |
| `snapshot/limit` | warning | `snapshotDocument` で、取り込んだものの合計が上限 (`snapshotBytes`) に届いたので、その後の canvas・blob: の中身・書体を取り込まなかった | `limit` |
| `snapshot/shadow-root-closed` | warning | `snapshotDocument` で、閉じた影の根 (Shadow DOM) がありそうなカスタム要素の中身を写せなかった (推し量り。`shadowRoots` で根を渡せば写す) | `element` |
| `snapshot/font-face-source-unknown` | warning | `snapshotDocument` で、JS で足した書体 (`new FontFace`) の中身を取れなかったか、上限 (`fileBytes`) を超えたので、取り込まなかった (組むと別の書体になる) | `family` |

## 誤りの型と名前

誤りは、次の型で投げます。どれも `code` (下の表) を持ちます。`isKumioriError(e)` は、`KumioriError` と `KumioriOptionError` のどちらにも真を返します。Kumiori の外の思わぬ例外は、包まずにそのまま投げます。

- `KumioriError`: 基 (中の誤りはこの型のまま)。`args`・`source` を持つことがあります
- `KumioriInputError`: 入力を読めない
- `KumioriLimitError`: 上限を超えたので止めた
- `KumioriFontError`: 書体を読めない・1 つも無い
- `KumioriPdfError`: PDF/X・PDF/A・PDF/UA の決まりに合わない・合わせられない
- `KumioriOptionError`: 選択肢の誤り。前からの `TypeError` を継ぎます (`KumioriError` の下ではありません)。誤った選択肢の名前を `option` に持ちます
- `AreaTreeFormatError` (`parseAreaTree` の誤り) は `KumioriInputError` の下の型です
- 止める合図 (`signal`) で止めたときは、Kumiori の誤りの型ではなく、`signal.reason` をそのまま投げます (理由を渡さずに `abort()` したときは `AbortError` の名前の `DOMException`。`e.name === 'AbortError'` で見分けます)。`code` は無く、`isKumioriError(e)` は偽です。`onProgress` が投げた誤りも、そのまま返します

| 名前 | 型 | 意味 |
|---|---|---|
| `api/invalid-option` | `KumioriOptionError` | 選択肢の値が使えない |
| `input/xml-parse` | `KumioriInputError` | XML (XSL-FO・XHTML) の解析に失敗した |
| `input/not-xsl-fo` | `KumioriInputError` | `fo:root` が無い (XSL-FO でない) |
| `input/not-zip` | `KumioriInputError` | zip でない・ZIP64 の zip |
| `input/zip-entry` | `KumioriInputError` | zip の項目が読めない |
| `input/not-epub` | `KumioriInputError` | EPUB でない・OPF が読めない |
| `area-tree/format` | `KumioriInputError` | Area Tree (JSON) の形の誤り |
| `limit/nesting-depth` | `KumioriLimitError` | XSL-FO の要素の入れ子が深すぎる |
| `limit/entity-expansion` | `KumioriLimitError` | XML の内部実体の展開が大きすぎる・深すぎる |
| `limit/transform-nesting` | `KumioriLimitError` | 回転・変換した領域の入れ子が深すぎる |
| `limit/zip-size` | `KumioriLimitError` | zip を展開した大きさが上限を超える |
| `limit/zip-entries` | `KumioriLimitError` | zip の項目・EPUB の章の並びが多すぎる |
| `font/load-failed` | `KumioriFontError` | 既定の書体を読めない・取得できない |
| `font/none-registered` | `KumioriFontError` | 書体が 1 つも登録されていない |
| `font/broken-file` | `KumioriFontError` | 書体のファイルが壊れている (呼ぶ側で警告にすることが多い) |
| `pdf/tagged-incompatible` | `KumioriPdfError` | タグ付き PDF・PDF/UA-1 を、透明を平らにする PDF/X と合わせた |
| `pdfua/requires-tagged` | `KumioriPdfError` | PDF/UA-1 に構造の木 (タグ付き PDF) が要る |
| `pdfx/profile-required` | `KumioriPdfError` | 出力の ICC プロファイル (CMYK) が要る (X-4、X-1a・X-3 で印刷条件が ICC の登録簿に無いとき)・CMYK でない |
| `pdfx/profile-invalid` | `KumioriPdfError` | 出力の ICC プロファイルの種類が合わない (X-4 は出力機器のもの (prtr)、X-1a は AtoB1 の表 (A2B1) を持つもの)・頭とタグの表が ICC.1 の形に合わない (説明のタグ desc が無いときも) |
| `pdfx/not-conforming` | `KumioriPdfError` | PDF/X の決まりに合わないので、PDF/X の PDF にできない |
| `pdfx/flatten-failed` | `KumioriPdfError` | 平らにできない透明が残った |
| `pdfa/not-conforming` | `KumioriPdfError` | PDF/A の決まりに合わないので、PDF/A の PDF にできない |
| `internal/patch-mismatch` | `KumioriError` | pdf-lib・fontkit の版が変わり、差し替えが合わない |
| `internal/page-sealed` | `KumioriError` | 描き終えたページに命令を足そうとした (中の誤り) |
