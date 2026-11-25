> English: [en/diagnostics.md](en/diagnostics.md)

# 診断とエラーの名前

組版の結果の `diagnostics` (`TypesetResult.diagnostics`・`TypesetPdfResult.diagnostics`・`AreaTree.diagnostics`) と、Kumiori が投げるエラー (`KumioriError` とその下の型・`KumioriOptionError`) は、どれも種類の名前 (`code`) を持ちます。ここに名前の一覧をまとめます。表の正は `src/diagnostics.ts` で、この一覧と食い違わないことを `test/diagnostics.test.ts` で確認します。

## 約束

- 名前は「段/中身」(`css/unknown-property` など。小文字とハイフン) です。一度出した名前は、バージョンをまたいで変えず、別の意味に再利用しません。やめるときは、この一覧に、使わなくなったバージョンを書いて残します。
- 文 (`message`) は、利用者に見せる文 (`lang` の言語) で、バージョンで直すことがあります。種類を見分けるには `code` を使ってください。
- `args` は、文に埋めた値です (機械で読む用)。名前ごとに、下の表の名前で持ちます (無いこともあります)。
- `warnings` (文の並び) は、前と同じ文・同じ並びのままです。`diagnostics` は、同じイベントを 1 件ずつ持ちます。
  - 未対応・知らない CSS と XSL-FO の指定と、字形の無い文字は、`warnings` では 1 つの文にまとめますが、`diagnostics` では項目ごとに 1 件にします。
  - 同じ診断 (名前・文・場所が同じ) は 1 件にして、数を `count` に書きます。
  - 名前ごとに 200 件まで残します。超えた分は、残した診断の `count` には数えず、同じ名前の別の 1 件 (文は「同じ種類の警告がほかに n 件 (m 種) あります」) にまとめます。その 1 件は、`args` の `omitted` に省いた診断の数 (同じ診断の繰り返しも数える) を、`omittedKinds` に省いた種類の数 (名前・文・場所の違うもの) を持ち、`source`・`count` を持ちません。
  - PDF/X・PDF/A・PDF/UA の通知を `pdfx.warnings`・`pdfa.warnings`・`pdfua.warnings` に分けて出すときも、`diagnostics` には入ります。

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

診断は、分かるときに入力の場所 `source` を持ちます。どのフィールドも、分からなければ無いフィールドです。

- `file`: 入力のファイルの名前 (`TypesetOptions.name`)。CSS の診断は、その CSS のファイルの名前 (`files` の名前) か、`<style>`・`style` 属性なら文書の名前
- `line`・`column`: 1 から数える行と列
  - XSL-FO: 要素の行と列 (ライブラリ・コマンド・画面のどれでも)。ただし、DOCTYPE の内部実体の展開で改行の数が変わった文書は行と列を、文字が変わった文書は列を付けません
  - HTML: Node と Web Worker の中 (linkedom で読むとき) は、要素の開きタグの行と列。ブラウザーの画面の中 (ブラウザーの DOMParser・画面の iframe) は付きません (要素の手がかりだけ)。XHTML (HTML に直して読む)・`--style ah` で文字を書き換えて読んだ文書・SVG の foreignObject の中身は付けません
  - CSS の未対応・知らないプロパティ: 要素から分かるものは、その要素の場所。CSS の宣言から数えたものは、CSS のファイル・`<style>`・`style` 属性から、最初に書かれた所を字面で探した行と列 (コメントの中に当たることがあります)
- `element`: 要素の手がかり (`p#intro`・`img.photo`・`fo:block#a` のように、名前と `id`、`id` が無ければ最初の `class`)
- `sourceRef`: 組版の診断のとき、その診断の起きたボックスの Area Tree の `sourceRef` (入力の節の番号)。行の診断 (行が収まらない) は、その行を含むボックスの番号
- `page`: PDF を書く途中の診断のとき、描画していたページの番号 (0 から)

同じ名前・同じ文でも、場所が違えば別の診断です (名前ごとに 200 件まで。超えた分は、上の「約束」のとおり 1 件にまとめます)。

## 重大度

- `error`: 出力から入力の中身が欠けた・変わった (画像が無い・字形の無い文字・溢れ・上限で打ち切った)。例外にはならず、組版は最後まで行い、PDF も作ります。
- `warning`: 指定を読まずに無視した・別の形で組んだ。
- `info`: 出力は意図どおりで、知っておくとよいこと (オプションで止めた取得など)。

## コマンドと画面での出し方

- コマンド: 標準エラーに 1 件 1 行で `  警告 [css/unknown-property] style.css:3:3: 知らない CSS のプロパティを無視しました (スペルミスか未対応): colr` のように書きます。先頭は重大度で `エラー`・`警告`・`情報` (英語では `error`・`warning`・`info`) です。場所は `ファイル:行:列`、続けて分かれば `(要素)`・`(n ページ目)`、同じものが 2 件以上なら終わりに `(n 件)` を付けます。情報 (`info`) は `--verbose` のときだけ書きます
  - 多い診断は、ほかの診断が埋もれないように、まとめて書きます。字形の無い文字 (`font/missing-glyph`) は、多い順に 20 字を並べた 1 行 (`… ਭ (U+0A2D ×4)、… (多い順に 20 字) ほか 625 種`) にします。ほかの名前は 20 行まで書き、残り (上限で省いた分も) を `同じ種類の警告がほかに n 件 (m 種) あります` の 1 行にします。`--diagnostics json` とライブラリの `diagnostics` は、1 件ずつのままです
- `--diagnostics json`: 標準エラーに 1 件 1 行の JSON (`{"input": 入力のファイル, "code": …, "severity": …, "message": …, "args": …, "source": …, "count": …}`) を書きます。情報も書きます。変換の報告 (`a.pdf: 3 ページ …`) は前のまま書くので、`{` で始まる行を読んでください。文書の文字のうち、DEL と C1 の制御文字 (U+007F〜U+009F。改行として扱うリーダーのある U+0085 を含む)・行と段落の区切り (U+2028・U+2029)・文字の向きの印と制御 (U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069)・BOM (U+FEFF) は、制御文字と同じく `\u2028` のように JSON の文字列のエスケープで書くので、どのリーダーでも 1 件は 1 行で、端末に出しても文字の並びが変わりません。変換の報告と文字の出力の行でも、入力のファイルの名前を含め、これらの文字と制御文字を `\x0a`・`\u2028` のように見える形にします
  - 組めずに止まったエラー (XML の解析の失敗・ファイルが無いなど) も、同じ形の 1 行で書きます: `{"input": …, "name": "KumioriInputError", "code": "input/xml-parse", "severity": "fatal", "message": …, "args": …, "source": …}`。`severity` は `fatal`、`name` はエラーの型の名前で、`code` は Kumiori のエラー (下の「エラーの型と名前」) のときだけ持ちます (ファイルが無いなど、Kumiori のエラーでないものは持ちません)。`args`・`source` は、エラーが持つときだけです。終了コードは前のとおり 1 です。引数のエラー (使い方のエラー) は、JSON にせず文で書きます
- 画面: 警告の一覧の各行に、重大度の印 (`✖` error・`⚠` warning・`ℹ` info)、`[名前]`、分かれば要素・行・ページを添えます。ページの分かる行を押すと、そのページへ移ります

## 出さない指定と、終了コード

- ライブラリ: `TypesetOptions.diagnostics.ignore` に名前を並べると、その名前の診断を出しません (`warnings` にも `diagnostics` にも、Area Tree にも、PDF を書く途中の警告にも入れません)。知らない名前は止めずに、`api/unknown-diagnostic-code` の警告に出します。エラーへの格上げのオプションはありません (`result.diagnostics` の `severity` を見て判断してください)
- コマンド: `--ignore-warning <名前>` (`,` で区切る・何度でも) で同じことをします。`--fail-on error|warning` を付けると、その重大度以上の診断があれば、出力を書いた上で終了コード 2 で終わります (組めなかった入力があれば 1)。出さない診断は数えません

## 診断の名前

| 名前 | 重大度 | 意味 | args |
|---|---|---|---|
| `api/setup-option-ignored` | warning | `createTypesetter` の設定 (フォントまわり・`reuse`) を、文書ごとの設定に渡した (使われない) | `option` |
| `api/unknown-diagnostic-code` | warning | `diagnostics.ignore`・`--ignore-warning` に、診断の名前に無い名前を書いた (その名前は止めずに続ける) | `code` |
| `resource/not-fetched` | info | `fetchImages`・`fetchStyles` の設定で、画像・CSS・フォントを取得しなかった | `url`・`kind` |
| `resource/fetch-failed` | warning | CSS・フォントを取得できなかった | `url`・`kind` |
| `resource/attachment-not-found` | warning | 添付ファイルの注釈が指すファイルが `files` に無いか、参照が文書の場所の外 (`file:` などの URL・絶対パス・`..` で上へ出るパス) を指すので添付しなかった (文で分ける) | `file` |
| `link/action-dropped` | warning | `links` の設定で、文書の外へのリンクの動作を書かなかった (文字は組む) | — |
| `fo/unsupported` | warning | 未対応の XSL-FO の要素・プロパティ・値を無視した (項目ごとに 1 件) | `item` |
| `fo/note` | warning | XSL-FO の読み込みで、近似や既定値で代用した (大きすぎる列の数を上限にした・組になる `fo:index-range-end` が無い・`flow-name` に合う領域が無いので本文の領域へ流した・`page-sequence` が無い・アンテナハウスの説明に無い `axf:document-info` の名前など。文ごとに 1 件。画面の変換レポートの情報と同じ文) | — |
| `fo/master-reference-not-found` | error | `fo:page-sequence` の `master-reference` に当たるページのマスター (`fo:simple-page-master`・`fo:page-sequence-master` の `master-name`) が無いので、その `page-sequence` を組まなかった | `name` |
| `css/unsupported` | warning | 未対応の CSS のプロパティ・値・規則を無視した (項目ごとに 1 件。CSS として正しいが Kumiori が読まない値 (`font: caption` などのシステムのフォントの名前・`font-size: math`) と、互換の指定 (`--style ah`) のときだけ読む、接頭辞の無い名前に書いた拡張の値 (`border-style: dot-dash` など) も) | `item` |
| `css/unknown-property` | warning | 知らない CSS のプロパティを無視した (スペルミスか未対応) | `property` |
| `css/invalid-value` | warning | 知っている CSS のプロパティの、読めない値の宣言を無視した (`display: foo`・`color: notacolor` など。値のエラーか未対応。「性質: 値」ごとに 1 件)。作成者のスタイルシートと `style` 属性の宣言だけを数え、`var()`・`attr()` を含む値、接頭辞付きの値 (`-webkit-box` など)、同じ規則 (`style` 属性) に同じプロパティの読める宣言があるもの (ブラウザー向けの予備の値) は数えない | `property`・`value` |
| `css/invalid-attr-value` | warning | `attr()` を置き換えた値が読めない宣言を無視した | — |
| `css/unreferenced-stylesheet` | info | 文書から参照されていない CSS を当てなかった | — |
| `font/face-not-found` | warning | `@font-face` のフォントのファイルが見つからない (次のフォントで組む) | `font`・`url` |
| `limit/nesting-depth` | warning | 要素の入れ子が深すぎるので、深い要素を浅い所に並べて組んだ | — |
| `limit/css-import` | error | 読み込む CSS (`@import`) が多すぎるので、残りを読まなかった | `file` |
| `limit/raised` | info | 入力の上限 (`limits`・コマンドの `--limit`) を既定より上げた (時間とメモリを多く使いうる。1 回の組版で 1 件) | `limits` |
| `limit/reached` | warning | 入力の上限 (`limits`・コマンドの `--limit`) に当たって、入力の一部を切るか近似して組んだ (上限の名前ごとに 1 回の組版で 1 件。いまは `gridTracks` (grid の列の並びを切った)・`leaderRepeats` (文字を並べるリーダーを空きにした)・`nestedSelectors` (展開したセレクターの多すぎる入れ子の規則を読まなかった)・`styleRefs`・`importDepth` (CSS・フォントの参照を取得しなかった)・`tableColumns` (`col` の `span`・`colspan` を、HTML の仕様の上限の 1,000 より下げた上限で切った)・`pdfImageObjects`・`pdfImagePages`・`pdfImageDepth`・`pdfImageStreamBytes`・`pdfImageLoadMs` (PDF の画像を描画しなかった。`pdfImageStreamBytes` は PDF を書くときに当たるので、結果の `toPdf` の後の `warnings`・`diagnostics` に追加する)・`pdfImageRangePages` (PDF の画像のページの範囲を、初めから上限の数のページまでにした)・`systemFontFaces` (OS のフォント (`systemFonts`) のうち、上限を超えるフォントを使わなかった。そのフォントの文字は `font/missing-glyph` になる))。専用の診断のある上限 (`limit/table-columns`・`limit/css-import` など) は、そちらに出す | `limit`・`value` |
| `font/file-unreadable` | warning | 渡したフォントファイル (`fonts`・`@font-face`) を読めない | `file`・`font` (`font` は、フォントの名前の分かる `@font-face` のときだけ) |
| `font/family-unreadable` | warning | 渡したフォントファイルのファミリー名を読めない | `file` |
| `font/generic-not-loaded` | warning | `genericFonts` に書いたフォントが読み込まれていない | `font`・`generic` |
| `font/load-failed` | warning | 文書に要るフォント (数式・等幅・記号・絵文字) を読み込めなかった | `font` |
| `font/missing-glyph` | error | 読み込んだどのフォントにも字形の無い文字がある (字形の無い文字の形で出る。文字ごとに 1 件) | `char`・`codePoint` |
| `font/system-fallback` | info | どのフォントにも字形の無い文字を、OS のフォント (`systemFonts`) で組んだ (組んだ結果が、組む機械のフォントで変わる。組むのに使ったフォントごとに 1 件で、`chars` はそのフォントで組んだ文字) | `font`・`chars` |
| `font/system-font-not-embeddable` | warning | 文字を持つ OS のフォントがあったが、PDF に埋め込めないフォント (OS/2 の fsType) なので使わなかった (その文字は `font/missing-glyph` にも出る。フォントごとに 1 件) | `font`・`chars` |
| `font/repaired` | warning | 壊れた表・字形を外してフォントを使った | `font` |
| `font/table-unused` | warning | 読みが大きすぎる表を使わなかった (合字・カーニングなどが効かないことがある) | `font` |
| `font/cff2-not-converted` | warning | CFF2 のアウトラインのフォントを、PDF に埋め込める形にできなかった | `font` |
| `font/variable-unsupported` | warning | アウトラインの差分を持たない可変フォント (既定の形で組む) | `font` |
| `font/variable-instances-capped` | info | 可変フォントのインスタンスが多すぎるので、近いインスタンスで組んだ | `font` |
| `font/variable-failed` | warning | 可変フォントのインスタンスを作れなかった (既定の形で組む) | `font` |
| `font/shaping-failed` | warning | 整形の表 (GSUB・GPOS・morx) で文字を組めなかった (合字などなしで組む) | `font` |
| `font/glyph-unreadable` | error | 字形のアウトライン・データを読めない文字がある (その文字は空か、描画しない) | `font` |
| `font/color-glyph-too-complex` | warning | 色つきの字形のレイヤー・アウトラインが多すぎる文字を、色なしで描画した | `font` |
| `image/not-found` | error | 画像が見つからないか、画像として読めない | `src` |
| `image/unsupported` | error | 画像を描画できないので、プレースホルダーで描画した | `src`・`detail` |
| `image/partial` | warning | 画像の一部を描画できない (形式の読み取りの細かい中身は `detail`) | `src`・`detail` |
| `image/reference-not-found` | warning | SVG の画像の中の `image`・`use` が指すファイルが無い・読めない。1 つの SVG の分は 20 件まで 1 件ずつ出し、残りは数 (`count`。`href` は空) の 1 件にまとめる (1 件ずつのものの `count` は 1)。`src`・`href` は 200 字で切る | `src`・`href`・`count` |
| `image/timeout` | error | 画像の形式の読み込みが時限内に終わらない | `src`・`format` |
| `image/invalid-size` | error | 画像の形式が返した大きさが大きすぎる・有限でない | `src`・`format` |
| `image/too-many-fragments` | warning | 1 つのファイルを fragment の違う参照で指す数が多すぎる | `src` |
| `image/format-warning` | warning | 画像の形式 (draw.io・プラグインなど) の読み取りが出した警告 | — |
| `image/pdf-invalid` | error | PDF の画像を読めない (壊れている・ページが無い・入れ子が深すぎる・上限を超えたなど。理由は `detail`)。プレースホルダーで描画した | `src`・`detail` |
| `image/pdf-encrypted` | error | PDF の画像が暗号化されているので読めない。プレースホルダーで描画した | `src` |
| `image/pdf-page` | warning | PDF の画像の `#page=` の値が読めない・ページの数を超えるので、1 ページ目を貼った | `src`・`detail` |
| `image/pdf-page-range` | warning | PDF の画像の `#page=` のページの範囲 (互換の指定のとき) のページの数が上限 `pdfImageRangePages` を超えたので、範囲の初めから上限の数のページまでを並べた (0.6.0 では、範囲の最初のページだけを貼ったことを通知した。0.7.0 からは範囲のページを横に並べて貼る) | `src`・`detail` |
| `image/pdf-fragment` | warning | PDF の画像の `#` の後ろに、読まない引数・値がある (アンテナハウスの `bbox=` や範囲は、互換の指定のときだけ読む) | `src`・`detail` |
| `image/pdf-repaired` | info | PDF の画像に仕様に合わない所があったが、直して読んだ (先頭の前の余分なバイト・90 の倍数でない回転など) | `src`・`detail` |
| `image/pdf-dropped` | info | PDF の画像の注釈 (リンク・注記・フォームフィールドなど) を、組んだ PDF に持ち込まなかった (図の中身だけを貼る) | `src`・`detail` |
| `image/pdf-font` | info | PDF の画像の中のフォントが埋め込まれていない (ビューアーが代わりのフォントで描画する) | `src`・`font` |
| `image/pdf-placeholder` | error | PDF の画像は PDF の出力でだけ描画できるので、画面・SVG・PNG ではプレースホルダーで描画した (`output` は描画した出力: `screen`・`SVG`・`PNG`) | `src`・`output` |
| `layout/line-overflow` | error | 行がページに収まらない | — |
| `layout/box-overflow` | error | ボックスがページより大きいので溢れる | — |
| `layout/float-overflow` | error | float がページより大きいので溢れる | — |
| `layout/footnote-overflow` | error | 脚注がページに収まらないので溢れる | — |
| `layout/column-overflow` | error | 段組のコンテナーに中身が収まらない | `columns` |
| `layout/table-row-overflow` | error | 表の行がページの高さを超えるので溢れる | — |
| `layout/continuation-dropped` | error | 脚注・float の続きを、どのページにも置けないので置かなかった | — |
| `layout/inline-block-dropped` | error | 行内のボックスの中のブロックを置けないので、中身を省いた | — |
| `layout/height-cut` | error | 高さの指定が 50 ページを超えるボックスを、50 ページで打ち切った | — |
| `layout/keep-overflow` | warning | keep を保つため、ブロックをページの下へはみ出させた (`--compat antenna`) | — |
| `layout/condense-overflow` | error | `overflow="condense"` の中身が、詰めても収まらない | — |
| `layout/condense-capped` | warning | 入れ子の `overflow="condense"` の測る回数の上限で、内のコンテナーを詰めなかった | — |
| `layout/condense-height-unknown` | warning | 高さが決まらないので、`overflow="condense"` で詰めなかった | — |
| `layout/marker-misplaced` | warning | `fo:retrieve-marker`・`fo:retrieve-table-marker` を置けない所に書いた | — |
| `layout/table-header-not-repeated` | warning | 表の見出しと脚がページより高いので、続きのページで繰り返さなかった | — |
| `layout/missing-id` | warning | ページ番号の参照・しおりのリンク先の id が無い (`warnings` では種類ごとにまとめる) | `id`・`kind` |
| `layout/index-key-missing` | warning | 索引のキー (`ref-index-key`) の付いた所が無い | `key` |
| `layout/not-converged` | warning | ページ番号の参照・索引・最終ページのマスターが収束しなかった | `what` |
| `layout/max-pages-reached` | info | 先頭から `maxPages` ページまで組んで止めた (`--max-pages`) | `maxPages` |
| `layout/beyond-max-pages` | warning | 先頭から `maxPages` ページで止めたので、それより後ろを指すページ番号の参照・総ページ数・索引・しおりが決まらなかった (種類ごとに 1 件。参照は `"?"` で組む) | `maxPages`・`kind`・`count`・`ids` |
| `limit/measure-nesting` | warning | 幅を中身で決めるボックス・段組の入れ子が深すぎるので、測らずに組んだ | — |
| `limit/table-row-span` | warning | 表の行をまたぐセルの広がりが上限を超えた分を、またがせなかった | — |
| `limit/table-columns` | warning | HTML の表の列 (`col`・`colgroup` の `span` の合計) が上限 (1,000 列) を超えたので、超えた分の列を捨てた (表ごとに 1 件) | `limit` |
| `limit/table-structure-cells` | warning | タグ付き PDF の表の構造で、行のセルの数をそろえる空のセルが上限 (文書のセルの数か 1 万の大きい方) を超えたので、その表は空のセルを行ごとに 1 つにまとめ、列をまたぐ数 (`ColSpan`) でそろえた | `tables` |
| `limit/link-description` | warning | タグ付き PDF のリンクの注釈の説明 (`Contents`) を、長さの上限 (2,000 字) で切った | `links` |
| `pdf/glyph-not-drawn` | error | PDF に描画できない文字があった (描画しない) | `font` |
| `pdf/notdef-not-drawn` | error | PDF/A・PDF/UA-1・PDF/X-4 で、字形の無い文字 (.notdef) を描画しなかった | `font` |
| `pdf/svg-links-capped` | warning | SVG のリンクが 1 ページに多すぎるので、残りをリンクにしなかった | — |
| `pdf/foreign-object-approximated` | warning | SVG の foreignObject の中身を、文字だけで近似して描画した | — |
| `pdf/form-field-failed` | warning | フォームフィールドを作れなかった (枠の見た目だけを残す) | `field` |
| `pdf/color-glyph-image` | error | 色つきの字形の画像を PDF に埋め込めなかった | — |
| `pdf/color-glyph-svg` | warning | SVG の表の字形に、図形にできないものがある (アウトラインで描画する) | `font` |
| `pdf/color-glyph-plus` | warning | 色つきの字形の合成 PLUS を、ふつうの重ねで描画した | — |
| `png/image-not-drawn` | error | `renderPageToPng` で、ラスタライズできない画像 (CMYK の JPEG・インターレースの PNG など) を描画しなかった | `src` (SVG の中の画像では、その画像を含む SVG の画像の `src`) |
| `png/image-limit` | error | `renderPageToPng` で、1 ページでラスタライズする画像のピクセルの数が上限 (合わせて 4 億ピクセル) を超えたので、残りの画像を描画しなかった | `src` (SVG の中の画像では、その画像を含む SVG の画像の `src`) |
| `png/raster-budget` | error | `renderPageToPng` で、ページをラスタライズする計算量が上限を超えたので、残りの図形・文字・画像を描画しなかった (描画しきれない SVG の画像はプレースホルダー) | — |
| `png/layer-limit` | warning | `renderPageToPng` で、入れ子の不透明度のグループ・マスクが多く、同時に持つオフスクリーンのバッファー (ページの外の描画先) のピクセルの数 (クリッピングを含めて) が上限 (ページのピクセルの数の 8 倍 (1,600 万ピクセルより少なくはしない)、かつ 6,400 万ピクセル) を超えるので、不透明度のグループをオフスクリーンのバッファーを使わずに描画するか (中の図形ごとに不透明度を掛ける)、オフスクリーンのバッファーに描画した所までを重ねてから続きを描画し (どちらも中の重なりは濃くなる)、広げられないマスク・色つきの字形の合成を描画しなかった (広がるオフスクリーンのバッファーは、実際に広げた大きさで数える) | — |
| `png/clip-limit` | warning | `renderPageToPng` で、入れ子のクリッピングが多く、同時に持つクリッピングの覆う割合とオフスクリーンのバッファーの大きさが上限 (`png/layer-limit` と同じ。クリッピングの 1 ピクセルはオフスクリーンのバッファーの 1/4 ピクセルと数える) を超えるので、深い所のクリッピングは、外側のクリッピングを囲むなら外側のクリッピングのまま描画し (その縁は区別して描画しない)、囲まないなら中を描画しなかった (いちばん外のクリッピングは、上限を超えても持つ) | — |
| `canvas/svg-not-drawn` | error | Web Worker の中の `renderPage` で、SVG の画像をラスタライズする計算量が上限を超えたので、その画像をプレースホルダーで描画した | `src` |
| `pdfx/transparency` | warning | 透明を使えない PDF/X (X-3) で、透明を使った | — |
| `pdfx/rasterized` | warning | 透明をフラット化するため、範囲を画像にした | — |
| `pdfx/spot-in-raster` | warning | 画像にした所に特色が掛かっている (代わりの CMYK になる) | — |
| `pdfx/text-in-raster` | warning | 画像にした所に文字が掛かっている | — |
| `pdfx/icc-fallback` | info | ICC プロファイルの表が読めないので、RGB を式で CMYK にした | — |
| `pdfx/annotations-dropped` | info | PDF/X で、ページの中の注釈・リンク・フォームフィールドを書かなかった | — |
| `pdfx/actions-dropped` | info | PDF/X で、動作 (しおりの外へのリンク先・動作を持つ注釈) を書かなかった | — |
| `pdfx/check` | warning | 書き出した PDF を GWG 2022 の規則と照合して合わなかった | — |
| `pdfx/embedded-pdf` | warning | PDF の画像のページが PDF/X の要件に合わないので、埋め込まずにプレースホルダーで描画した (合わない所は `detail`) | `src`・`detail` |
| `pdfa/launch-dropped` | info | PDF/A では、ファイルを開く動作 (`links.launch`) を書かない | — |
| `pdfa/cmyk-converted` | info | PDF/A (sRGB) で、CMYK の色を RGB に直した | — |
| `pdfa/forms-dropped` | warning | PDF/A では、フォームフィールドを書かない (枠の見た目は残る) | — |
| `pdfa/attachments-dropped` | warning | PDF/A で、PDF/A でない添付ファイルを埋め込まなかった | — |
| `pdfa/freetext-appearance` | warning | PDF/A で、FreeText の注釈の外観に文字を描画できなかった | — |
| `pdfa/embedded-pdf` | warning | PDF の画像のページが PDF/A の要件に合わないので、埋め込まずにプレースホルダーで描画した (合わない所は `detail`) | `src`・`detail` |
| `pdfua/missing-title` | warning | PDF/UA-1: 文書のタイトルが無い | — |
| `pdfua/missing-lang` | warning | PDF/UA-1: 文書の言語が無い | — |
| `pdfua/missing-figure-alt` | warning | PDF/UA-1: 代替テキストの無い図がある | — |
| `pdfua/missing-formula-alt` | warning | PDF/UA-1: 代替テキストの無い数式がある | — |
| `pdfua/heading-skipped` | warning | PDF/UA-1: 見出しの段が飛んでいる | — |
| `pdfua/embedded-pdf` | warning | PDF/UA-1: PDF の画像のページに埋め込まれていないフォントがあるので、埋め込まずにプレースホルダーで描画した | `src`・`detail` |
| `pdfua/encrypt-accessibility-kept` | warning | PDF/UA-1: 暗号化 (`encrypt`) で支援技術のための抽出の権限 (`permissions.accessibility`) を外そうとしたので、許したままにした | — |
| `snapshot/wait-timeout` | warning | `snapshotDocument` で、待つ時間 (`timeoutMs`) が過ぎたので、その時の文書でシリアライズした (`waiting` は待っていたもの: `load`・`fonts`・`waitFor`・`animations`) | `waiting`・`ms` |
| `snapshot/iframe-skipped` | warning | `snapshotDocument` で、`<iframe>` の中の文書はコピーしていない | `src` |
| `snapshot/canvas-tainted` | warning | `snapshotDocument` で、別の origin の画像で汚染された canvas を画像にできなかった (canvas のまま残した) | `element` |
| `snapshot/canvas-too-large` | warning | `snapshotDocument` で、canvas のピクセルの数 (`imagePixels`)・PNG の大きさ (`fileBytes`) が上限を超えたか、ブラウザーが PNG を作れなかったので、画像にしなかった (`size` はピクセルの数かバイト) | `element`・`size`・`limit` |
| `snapshot/stylesheet-rule-removed` | warning | `snapshotDocument` で、`<style>` の元のテキストにあって CSSOM から消された規則を、元のテキストから消せないので残した | `count` |
| `snapshot/blob-unreadable` | warning | `snapshotDocument` で、blob: の URL の中身を読めなかったか (消された URL など)、上限 (`fileBytes`) を超えたので、取り込まなかった | `url` |
| `snapshot/limit` | warning | `snapshotDocument` で上限に当たって、その後をコピーしなかった。`name` が上限の名前、`limit` がその値: `snapshotBytes` (取り込んだものの合計。その後の canvas・blob: の中身・フォントを取り込まなかった)・`shadowImports` (1 つのシャドウツリーで、スタイルシートの `@import` をたどる数。1,000 個。そのシャドウツリーのその後の `@import`)・`shadowImportDepth` (`@import` の入れ子の深さ。16 段。それより深いシート)・`shadowImportChars` (シャドウツリーの `@import` からコピーする文字の数。コピーの全体で 33,554,432 字。その後の `@import`)。上限ごとに 1 度だけ出す | `limit`・`name` |
| `snapshot/shadow-root-closed` | warning | `snapshotDocument` で、閉じたシャドウルート (Shadow DOM) がありそうなカスタム要素の中身をスナップショットに取り込めなかった (推し量り。`shadowRoots` でルートを渡せば取り込む) | `element` |
| `snapshot/shadow-stylesheet-unreadable` | warning | `snapshotDocument` で、シャドウツリー (Shadow DOM) の中のスタイルシート (`<link rel=stylesheet>`・`@import`) の規則を読めない (別の origin で CORS の無いものなど) ので、コピーしなかった (シャドウツリーの中だけに囲えないので、文書の全体に当てないためにコピーしない) | `element`・`url` |
| `snapshot/font-face-source-unknown` | warning | `snapshotDocument` で、JS で追加したフォント (`new FontFace`) の中身を取得できなかったか (`fontSources` が `javascript:` の URL を返したときも)、上限 (`fileBytes`) を超えたので、取り込まなかった (組むと別のフォントになる) | `family` |

## エラーの型と名前

エラーは、次の型で投げます。どれも `code` (下の表) を持ちます。`isKumioriError(e)` は、`KumioriError` と `KumioriOptionError` のどちらにも真を返します。Kumiori の外の思わぬ例外は、包まずにそのまま投げます。

- `KumioriError`: 基 (中のエラーはこの型のまま)。`args`・`source` を持つことがあります
- `KumioriInputError`: 入力を読めない
- `KumioriLimitError`: 上限を超えたので止めた
- `KumioriFontError`: フォントを読めない・1 つも無い
- `KumioriPdfError`: PDF/X・PDF/A・PDF/UA の要件に合わない・合わせられない
- `KumioriOptionError`: オプションのエラー。前からの `TypeError` を継ぎます (`KumioriError` の下ではありません)。誤ったオプションの名前を `option` に持ちます
- `AreaTreeFormatError` (`parseAreaTree` のエラー) は `KumioriInputError` の下の型です
- 止めるシグナル (`signal`) で止めたときは、Kumiori のエラーの型ではなく、`signal.reason` をそのまま投げます (理由を渡さずに `abort()` したときは `AbortError` の名前の `DOMException`。`e.name === 'AbortError'` で見分けます)。`code` は無く、`isKumioriError(e)` は偽です。`onProgress` が投げたエラーも、そのまま返します

| 名前 | 型 | 意味 |
|---|---|---|
| `api/invalid-option` | `KumioriOptionError` | オプションの値が使えない |
| `api/result-disposed` | `KumioriError` | `dispose()` で手放した組んだ結果 (`TypesetResult`) を使った (`toPdf`・`toPdfStream`・`renderPage`・`renderPageToSvg`・`renderPageToPng`。`dispose()` の前に始めて走っているものは、そのまま終わる) |
| `input/xml-parse` | `KumioriInputError` | XML (XSL-FO・XHTML) の解析に失敗した |
| `input/not-xsl-fo` | `KumioriInputError` | `fo:root` が無い (XSL-FO でない) |
| `input/not-zip` | `KumioriInputError` | zip でない・ZIP64 の zip |
| `input/zip-entry` | `KumioriInputError` | zip の項目が読めない |
| `input/not-epub` | `KumioriInputError` | EPUB でない・OPF が読めない |
| `area-tree/format` | `KumioriInputError` | Area Tree (JSON) の形のエラー |
| `limit/nesting-depth` | `KumioriLimitError` | XSL-FO の要素の入れ子が深すぎる |
| `limit/entity-expansion` | `KumioriLimitError` | XML の内部実体の展開が大きすぎる・深すぎる |
| `limit/transform-nesting` | `KumioriLimitError` | 回転・変換した領域の入れ子が深すぎる |
| `limit/zip-size` | `KumioriLimitError` | zip を展開した大きさが上限を超える |
| `limit/zip-entries` | `KumioriLimitError` | zip の項目・EPUB の章の並びが多すぎる |
| `font/load-failed` | `KumioriFontError` | 既定のフォントを読めない・取得できない |
| `font/none-registered` | `KumioriFontError` | フォントが 1 つも登録されていない |
| `font/broken-file` | `KumioriFontError` | フォントのファイルが壊れている (呼ぶ側で警告にすることが多い) |
| `pdf/tagged-incompatible` | `KumioriPdfError` | タグ付き PDF・PDF/UA-1 を、透明をフラット化する PDF/X と合わせた |
| `pdf/encrypt-incompatible` | `KumioriPdfError` | 暗号化 (`encrypt`) を、暗号化を許さない PDF/X・PDF/A と合わせた (`standard` は規格の名前) |
| `pdfua/requires-tagged` | `KumioriPdfError` | PDF/UA-1 に構造ツリー (タグ付き PDF) が要る |
| `pdfx/profile-required` | `KumioriPdfError` | 出力の ICC プロファイル (CMYK) が要る (X-4、X-1a・X-3 で印刷条件が ICC のレジストリに無いとき)・CMYK でない |
| `pdfx/profile-invalid` | `KumioriPdfError` | 出力の ICC プロファイルの種類が合わない (X-4 は出力機器のもの (prtr)、X-1a は AtoB1 の表 (A2B1) を持つもの)・先頭とタグの表が ICC.1 の形に合わない (説明のタグ desc が無いときも) |
| `pdfx/not-conforming` | `KumioriPdfError` | PDF/X の要件に合わないので、PDF/X の PDF にできない |
| `pdfx/flatten-failed` | `KumioriPdfError` | フラット化できない透明が残った |
| `pdfa/not-conforming` | `KumioriPdfError` | PDF/A の要件に合わないので、PDF/A の PDF にできない |
| `internal/patch-mismatch` | `KumioriError` | pdf-lib・fontkit のバージョンが変わり、差し替え (`pdfLibPatches.ts`・`fontkitCffFlex.ts`) か、pdf-lib のライターをコピーした PDF のライター (`pdfWriter.ts`) が合わない (pdf-lib の中のフィールドが無い・数えた大きさと書いた大きさが違う) |
| `internal/page-sealed` | `KumioriError` | 描画し終えたページに命令を追加しようとした (中のエラー) |
