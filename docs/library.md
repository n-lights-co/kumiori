> English: [en/library.md](en/library.md)

# ライブラリとして使う

TypeScript・JavaScript のプログラムから、HTML+CSS・XSL-FO を組み、PDF・Canvas・SVG・PNG に出すための説明書です。
すべての関数・型・選択肢の一覧は、API の説明書 (<https://n-lights-co.github.io/kumiori/api/>) にあります ([API の説明書](#api-の説明書))。

- [入れ方](#入れ方)
- [最初の例](#最初の例)
- [入口の関数](#入口の関数)
- [組み方の選択肢 (options)](#組み方の選択肢-options)
- [組んだ結果 (TypesetResult)](#組んだ結果-typesetresult)
  - [PDF にする (toPdf)](#pdf-にする-topdf) ・ [PDF/X と PDF/A](#pdfx-と-pdfa) ・ [Canvas に描く (renderPage)](#canvas-に描く-renderpage) ・ [SVG にする (renderPageToSvg)](#svg-にする-renderpagetosvg) ・ [PNG にする (renderPageToPng)](#png-にする-renderpagetopng)
- [PDF だけを作る (typesetToPdf)](#pdf-だけを作る-typesettopdf)
- [ファイルと外部の資源](#ファイルと外部の資源)
- [誤りと診断](#誤りと診断)
- [draw.io の図](#drawio-の図)
- [プラグイン](#プラグイン)
- [Node の部品 (kumiori/node)](#node-の部品-kumiorinode)
- [パッケージの形と動く環境](#パッケージの形と動く環境)
- [ブラウザで印刷プレビューを出す](#ブラウザで印刷プレビューを出す)
- [Web Worker の中で組む](#web-worker-の中で組む)
- [単位と座標](#単位と座標)
- [API の説明書](#api-の説明書)

## 入れ方

```bash
npm install kumiori
```

このリポジトリで作るときは `npm run build:lib` です (`dist-lib/`。ES モジュールと型の宣言)。
バンドラーを使わないブラウザでは、CDN から 1 ファイルで読めます ([パッケージの形と動く環境](#パッケージの形と動く環境))。

## 最初の例

```ts
import { typeset, typesetToPdf, walkAreaTree } from 'kumiori';

// HTML+CSS (XSL-FO も同じ関数で組める。種類は name の拡張子か中身で見分ける)
const result = await typeset(html, {
  name: 'book.html',
  files: [
    { name: 'book.css', data: cssText },                        // CSS・画像・書体は { name, data }
    { name: 'img/cover.jpg', data: async () => readBytes('img/cover.jpg') }, // 使うときだけ読む関数でもよい
  ],
  loadFont: async (spec) => readLocalFont(spec),               // 既定の書体の読み方 (省略すれば Google Fonts から取る)
});
console.log(result.pageCount, result.warnings);
walkAreaTree(result.areaTree, (area) => { /* 組んだ結果 (Area Tree) をたどる */ });
const pdf = await result.toPdf();                              // Uint8Array
const { pdf: bytes } = await typesetToPdf(html, { name: 'book.html' }); // PDF だけが要るとき (組んだ結果を持たないので、大きな文書で使うメモリが少ない)
result.renderPage(canvas, 0);                                  // 1 ページ目を canvas に描く (ブラウザ)
const svg = await result.renderPageToSvg(0);                   // 1 ページ目を SVG の文字列に (ブラウザでも Node でも)
const png = await result.renderPageToPng(0, { dpi: 150 });     // 1 ページ目を PNG に (Uint8Array。ブラウザでも Node でも)
```

## 入口の関数

| 関数 | 何をするか |
| --- | --- |
| `typeset(text, options)` | 文書を組み、組んだ結果 (`TypesetResult`) を返す。種類は `options.kind` か、`name` と中身で決める |
| `typesetHtml`・`typesetFo` | 種類を決め打ちする `typeset` |
| `typesetToPdf(text, options, pdfOptions)` | PDF だけを作る ([下](#pdf-だけを作る-typesettopdf)) |
| `await createTypesetter(setup)` | 書体を 1 度だけ読み込んだ器を作る。`typesetter.typeset(...)`・`typesetter.typesetToPdf(...)` で組む |
| `decodeDocumentText(bytes)` | ファイルのバイト列を、BOM・XML 宣言の `encoding`・`<meta charset>` に従って文字列にする |
| `walkAreaTree(tree, fn)` | 組んだ結果 (Area Tree) をたどる ([`docs/area-tree.md`](area-tree.md)) |
| `isKumioriError(e)` | Kumiori の投げた誤りかを見分ける ([誤りと診断](#誤りと診断)) |
| `DEFAULT_FONTS` | 既定で使う書体の一覧 (`loadFont` に渡される `spec` の `family`・`weight`・`urls`) |

- `typeset` はファイルシステムに触りません。ネットワークを使うのは、既定の書体の取得 (`loadFont` で差し替えられる) と、文書が `http(s):` で参照する画像・CSS の取得 (`fetchImages`・`fetchStyles` で止められる) だけです。なので、ブラウザでも Node でも動きます。
- `text` は文字列です。ファイルから読むときは `decodeDocumentText(bytes)` で文字列にしてください (UTF-8 と決めて読むと、Shift_JIS の FO などが化けます)。
- 何度も組むとき (エディタのプレビューなど) は `await createTypesetter(setup)` で器を作ります。書体の取得と解析を毎回しないので速くなります (数式・等幅・記号の書体は、使う文書を初めて組むときに読み込みます)。
- 書体まわりなど、何度組んでも同じ選択肢 (`fonts`・`genericFonts`・`loadFont`・`fetchTimeoutMs`・`deflate`。型は `TypesetterOptions`) は、器を作るときに `setup` で渡します。`typesetter.typeset`・`typesetter.typesetToPdf` の文書ごとの選択肢 (型は `DocumentOptions`) には無く、`fonts`・`genericFonts`・`loadFont` を渡しても使われず、`api/setup-option-ignored` の警告が出ます。
- FO の DOCTYPE の内部サブセットに宣言した内部実体 (`<!ENTITY nbsp "&#160;">` など) は、読み込みの前に展開します (外部実体は読みません)。

## 組み方の選択肢 (options)

`typeset(text, options)` の第 2 引数です (型は `TypesetOptions`)。多くは、コマンドのオプションと同じ意味です ([`docs/cli.md`](cli.md))。
下の表は主なものを挙げたものです。すべての選択肢は [API の説明書](#api-の説明書) にあります。

### 入力

| 選択肢 | 中身 | コマンド |
| --- | --- | --- |
| `kind` | `html`・`xhtml`・`fo`。省略すれば `name` と中身で決める | |
| `name` | 入力のファイル名 | |
| `files` | CSS・画像・書体の `{ name, data }` の配列。`data` は中身か、使うときだけ読む関数。書体は TTF・OTF・TTC・WOFF・WOFF2 | |
| `resolveResource` | `files` に無いファイルの中身を返す関数 ([ファイルと外部の資源](#ファイルと外部の資源)) | |
| `lang` | `warnings` と誤りの文の言語。`ja` か `en`。既定は日本語。違う `lang` の呼び出しを同時に (待たずに) 走らせると、重なっている間は後に始まった呼び出しの言語になる (言語ごとに分けたいときは、順に待つか、別の Worker・プロセスで組む) | `--lang` |

### スタイルと書体

| 選択肢 | 中身 | コマンド |
| --- | --- | --- |
| `style` | HTML の既定のスタイル | `--style` |
| `pageSize` | HTML の既定の用紙。`@page` で `size` を指定していない文書の用紙を、CSS の `size` の書き方で書く (`"A5"`・`"A5 landscape"`・`"148mm 210mm"`。長さは 1pt 以上で、ほかは `KumioriOptionError`)。既定は A4。文書の `@page { size }` が勝つ。`@media` の `width`・`height` もこの用紙で評価する | `--page-size` |
| `compat` | XSL-FO の既定値の流儀 | `--compat` |
| `fonts` | 足す書体 | `--font` |
| `genericFonts` | 総称の書体に使う書体。名前は `serif`・`sans-serif`・`monospace`・`serif-cjk`・`sans-serif-cjk` | `--generic-font` |
| `loadFont` | 既定の書体の読み方。省略すれば Google Fonts から取る (`https:` の URL だけを試す) | |
| `svgLanguages` | SVG の `systemLanguage` を照らす言語タグの配列 | `--svg-lang` |

### PDF の作り

| 選択肢 | 中身 | コマンド |
| --- | --- | --- |
| `tagged` | タグ付き PDF にする。既定 `true`。`false` でタグを付けない | `--tagged`・`--no-tagged` |
| `pdfua` | PDF/UA-1 の PDF にする (タグ付き PDF を含む)。`true` か `{ warnings }` | `--pdfua` |
| `documentLang` | 入力に言語が無いときの文書の言語 (BCP 47 の言語タグ) | `--document-lang` |
| `print` | 塗り足しとトンボ | `--print` |
| `spotColors` | 特色の代わりの CMYK | `--spot-colors` |
| `links` | 文書の外へのリンクのうち、PDF に動作を書くもの (下) | `--link-schemes`・`--link-launch`・`--link-relative` |
| `deflate` | 圧縮の関数。Node なら `zlib.deflateSync` を渡すと PDF の書き出しが速い | |

`links` は `{ schemes?: string[]; launch?: boolean; relative?: 'file' | 'uri' }` です。

- 既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と、相対参照の PDF だけに動作を書きます。ほかは字だけを組み、`warnings` に知らせます。
- `schemes` は許すスキームの一覧です (既定と置き換わる。`'*'` はすべて)。
- `launch: true` は、ファイルを開く動作 (PDF でない相対のファイル・絶対パス・`//host/…`) も書きます。
- すべて書くには `{ schemes: ['*'], launch: true }` とします。

### 外部の取得

| 選択肢 | 中身 | コマンド |
| --- | --- | --- |
| `fetchImages` | 文書が `http(s):` で参照する画像を取るか。既定 `true`。`false` か、URL を受けて真偽を返す関数 | `--no-fetch-images` |
| `fetchStyles` | 文書が `http(s):` で参照する CSS と、その `@font-face` の書体を取るか。`fetchImages` と同じ形 | `--no-fetch-styles` |
| `fetchTimeoutMs` | 書体・画像の取得の時限。既定 30 秒。本体を読み終えるまで効く | |
| `drawio` | draw.io の図の選択肢 ([draw.io の図](#drawio-の図)) | `--no-drawio`・`--drawio-stencils` など |
| `plugins` | プラグインの配列 ([プラグイン](#プラグイン)) | `--plugin` |

他人の書いた文書をサーバーで組むときは、`fetchImages`・`fetchStyles` を止めるか、許す URL だけにしてください ([ファイルと外部の資源](#ファイルと外部の資源))。
コマンドの欄のオプションの正しい名前と書き方は、[`docs/cli.md`](cli.md) の一覧で確かめてください。

## 組んだ結果 (TypesetResult)

| 持ち物 | 中身 |
| --- | --- |
| `pageCount` | ページ数 |
| `areaTree` | 組んだ結果の物理ツリー (Area Tree)。JSON の形は [`docs/area-tree.md`](area-tree.md) |
| `warnings` | 組版の警告 (文字列の配列。読めない画像・溢れなど。投げずにここに入る) |
| `diagnostics` | `warnings` と同じ出来事を、種類の名前と場所で持つもの ([誤りと診断](#誤りと診断)) |
| `toPdf(options)` | PDF のバイト列 (`Uint8Array`) を返す |
| `renderPage(canvas, i, options)` | ページを canvas に描く (ブラウザ) |
| `renderPageToSvg(i, options)` | ページを SVG の文字列にする (ブラウザでも Node でも) |
| `renderPageToPng(i, options)` | ページを PNG のバイト列にする (ブラウザでも Node でも) |

ページの番号は 0 から数えます。

### PDF にする (toPdf)

`result.toPdf({ title, pdfx, pdfa, imageMaxDpi })` (型は `PdfOptions`)。

| 選択肢 | 中身 |
| --- | --- |
| `title` | PDF の題名 |
| `pdfx` | 入稿用の PDF/X の印 (下) |
| `pdfa` | 長期保存用の PDF/A の印 (下) |
| `imageMaxDpi` | JPEG の解像度の上限 |

PDF を書く途中の警告 (描けない字・色つきの字形を色つきで描けないことなど) は、`result.warnings` に足します。

### PDF/X と PDF/A

**PDF/X** は `pdfx: { version, condition, info, profile, warnings }` です (コマンドの `--pdfx`・`--output-profile` と同じ)。

- `version` は `'X-1a'`・`'X-1a:2003'`・`'X-3'`・`'X-4'`。既定は X-3 です。ほかの値 (`'x4'` のような大文字小文字の違い、`'X-1a:2001'`・`'X-3:2003'` のような別名も) は、選択肢の誤り `KumioriOptionError` (`option` は `'pdfx.version'`) になります。
- RGB の色・画像を CMYK にします。X-1a・X-3 は透明を平らにします。
- X-4 は、CMYK の出力機器の ICC プロファイル `profile` が要ります。X-1a で `condition` が ICC の登録簿に無ければ、`profile` が要ります。
- どの版も、書き出した PDF を決まりに照らして調べます。
- ページの中のリンク・注釈・フォームの欄と、動作 (しおりの外への飛び先など) は書かずに、件数を `warnings` に足します。しおりは、題と文書の中の飛び先を残します。

**PDF/A** は `pdfa: { version: 'A-2b' | 'A-3b', warnings }` です (コマンドの `--pdfa` と同じ)。`pdfx` と合わせるときは `pdfx.profile` が要ります。

**規格の本文との関係**

- PDF/X の出力と、書き出した後の検査は、PDF/X-1a:2001 (ISO 15930-1) と PDF/X-4 (ISO 15930-7) の本文を読んで作り、その決まりに適合することを確かめています。PDF/X-1a:2003・PDF/X-3 は、その本文では確かめておらず、PDF/X-1a:2001 と同じ決まりを当てています。入稿の前には、プリフライト (Acrobat Pro など) で確かめてください。
- PDF/A は、規格 ISO 19005 の本文では確かめていないので、規格への適合は保証しません。書き出した PDF を Kumiori が読み直して決まりに照らし、開発では PDF/A の検査の道具 veraPDF でも確かめていますが、保存の前に、PDF/A の検査の道具で確かめてください。

### Canvas に描く (renderPage)

`result.renderPage(canvas, i, { scale, devicePixelRatio, guides })`

| 選択肢 | 中身 |
| --- | --- |
| `scale` | 倍率。1 で 1pt = 1 CSS px (等倍は 96 / 72) |
| `devicePixelRatio` | 画面の画素の細かさ |
| `guides` | 仕上がり・塗り足しのガイド線 |

字は書体ファイルの輪郭から描くので、ページの CSS や `@font-face` に左右されません。
無いページ番号は `RangeError` です。使い方の例は [ブラウザで印刷プレビューを出す](#ブラウザで印刷プレビューを出す) にあります。

### SVG にする (renderPageToSvg)

`result.renderPageToSvg(i, { guides, idPrefix })` は、ページを SVG の文書 (文字列) にします。ブラウザでも Node でも使え、依存を足しません。

- 大きさは紙の大きさ (pt) です。
- 字は書体ファイルの輪郭の道にします。`text` 要素を使わないので、SVG を見る側に書体が無くても、PDF と同じ字形で描けます。字形の輪郭は `defs` に 1 度だけ書き、置く所は `use` で参照します。
- 画像は data: の URI で埋め込みます。PNG・JPEG はそのまま、GIF・BMP・WebP は PNG にします。
- 同じ画像は、置く大きさごとに 1 度だけ埋め込み、置く所は `use` で参照します。1 つの画像を 8 通りより多い大きさで置くときは、残りの大きさは 1 つの埋め込みを引き伸ばして参照します。
  大きさごとに中身を埋めるので、1 つの画像を多くの大きさで置く (背景の繰り返しのタイルの大きさも数える) と、SVG はその画像の埋め込み (base64 で元のファイルの約 4/3) の最大 9 倍ほどの大きさになります。
- SVG の画像は、PDF と同じく図形にしてから書き出します (字は輪郭、近似できない filter は画素で計算した画像。`vector-effect` の線・大きさは、SVG を置く拡大率で割った図形)。
  ただし、`svgLanguages` (`--svg-lang`) は効かず (`switch` は実行環境の言語で選ぶ)、`foreignObject` の中身は描きません (PDF は描きます)。`renderPageToPng` も同じです。
- 色つきの字形は、図形・グラデーション・画像にします (扇形のグラデーションは止まり点の色の平均で塗り、source-in などの合成は上に重ねる近似)。
- CMYK・特色の色は、画面と同じ式で RGB にします。
- リンク・注釈・フォームの欄は書きません (SVG の画像の中のリンクも書きません)。

| 選択肢 | 中身 |
| --- | --- |
| `guides` | 仕上がり・塗り足しのガイド線 |
| `idPrefix` | SVG の中の id の頭の文字。既定 `k` |

id は、頭の文字に番号を続けたもので、切り抜き・グラデーション・画像などを指します。
1 つの HTML に何枚も直に入れるときは、ページごとに、どれも別のページの頭の文字の頭にならないように変えてください。`p1-`・`p2-` のように、数字でない字で終えます (`k` と `k1` では、`k10` と `k1` + `0` が重なります)。
`idPrefix` は XML の名前で書きます。XML 1.0 §2.3 の Name から `:` を除いたもので、英字・`_`・かななどの字で始め、数字・`-`・`.` なども続けられます。ほかの字を含むと `RangeError` です。
無いページ番号のときは、`RangeError` で失敗する Promise を返します。

### PNG にする (renderPageToPng)

`result.renderPageToPng(i, { dpi, guides })` は、ページを PNG (8 ビットの RGB。紙は白) のバイト列 (`Uint8Array`) にします。ブラウザでも Node でも使え、依存を足さずに、自前で画素にします。

- `dpi` は解像度です。既定 96。1 枚 4,000 万画素までで、超えれば `RangeError` です。
- 描き方は `renderPageToSvg` と同じです (字は書体の輪郭、SVG の画像は PDF と同じ図形)。縁の塗り (アンチエイリアス) があり、縮めて置く画像は画素の平均で縮めます。
- 画素に戻せない画像 (CMYK の JPEG・インターレースの PNG) は描かずに、`result.warnings` に足します。
- 画像の覚えと上限 (画素にする手間・同時に持つ板の画素の数) は、コマンドの PNG の上限と同じです ([`docs/cli.md`](cli.md) の「上限とメモリ」)。止まり点の多いグラデーションの手間は勘定に入らないので、他人の書いた文書を PNG にするときは、時間の上限を外でかけてください。
- 速さの目安: A4 の字の多いページを 150dpi で、1 ページ 0.5 秒ほど (2026 年の x86 の Node 22)。
- 無いページ番号のときは、`RangeError` で失敗する Promise を返します。

## PDF だけを作る (typesetToPdf)

`typesetToPdf(text, options, pdfOptions)` は PDF だけを作ります。`typeset` の後に `toPdf(pdfOptions)` を呼ぶのと同じ PDF・警告・ページ数になります。

- 結果は `{ pdf, pageCount, warnings, diagnostics, layoutMs }` です (型は `TypesetPdfResult`)。`areaTree`・`renderPage` はありません。
- `pdfOptions` の型は `TypesetPdfOptions` で、`toPdf` の `PdfOptions` に `lowMemory` を足したものです。`lowMemory: true` で、メモリを節約して組みます (コマンドの `--low-memory` と同じ)。
- ページを 1 枚ずつ組んだ結果 (Area Tree) にして PDF に書き、書いたページを手放します。文書全体の組んだ結果を持たないので、数千ページの文書で使うメモリが少なくなります。
  その代わり、ページの組んだ結果を、使う書体・画像を集めるときと描くときの 2 度作ります。
- `layoutMs` は、ページを組んだ結果にする時間を含みません (PDF を書く時間に入ります)。
- Node のコマンドも、これで PDF を作ります。`createTypesetter()` の器にも `typesetter.typesetToPdf(text, options, pdfOptions)` があります。

## ファイルと外部の資源

### resolveResource

`resolveResource(url)` は、文書・CSS が参照するファイル (`<link rel="stylesheet">`・`@import`・`url()`・`<img src>` など) のうち、`files` に無いものを問い合わせる関数です。

- `url` は書かれた参照 (`file:///…/a.css`・`img/a.png`・`https://…`) です。CSS の中の相対参照は、その CSS の URL を基準に解決したものです。
- 中身 (文字列・`Uint8Array`・`ArrayBuffer`) を返せば、それを使います。`undefined` ならこれまでどおりです (`http(s):` の画像・CSS はネットワークから取る)。
- 参照を書き換えて `files` に入れ直す手間が要りません。
- 画像は、URL に拡張子が無くても (`https://example.com/img?id=1` など)、返した中身の先頭のバイト列で画像と見分けて使います。

Node では、`kumiori/node` の `createFileResolver()` が、`file:` の URL のファイルを読む `resolveResource` を作ります ([Node の部品](#node-の部品-kumiorinode))。

### fetchImages・fetchStyles と転送

`fetchImages`・`fetchStyles` に渡す関数には、文書に書かれた URL のほか、転送 (redirect) の先の URL も聞きます。

- Node では、転送を 1 つずつ確かめてたどり (20 回まで)、許されない先へは要求を出しません。
- `https:` から `http:` への転送と、`http(s):` でない先への転送は、関数に聞かずに断ります (真偽の `true` のときも同じ)。
- ブラウザでは、転送の先をスクリプトから前もって読めないので、たどった後の最後の URL を関数に聞き、許されなければ応答を使いません (このとき、要求そのものは転送の先に届いています)。
- 関数が見るのは URL の文字列だけです。内部のアドレスに解決されるホスト名 (DNS rebinding を含む) は、関数では防げません。他人の書いた文書をサーバーで組むときに内部の網を守るには、実行環境の側 (外向きの通信の制限・外向きのプロキシ) でも絞ってください。

ネットワークから取るものの大きさには上限があります。

| 資源 | 上限 |
| --- | --- |
| 画像 | 256MB |
| CSS | 16MB |
| 書体 | 128MB |

超えたものは、読むのを途中でやめて、読めない資源として扱います (`Content-Length` の無い応答でも同じ)。
サーバーで組むときの、時間とメモリの上限のかけ方は、[`docs/cli.md`](cli.md) の「外部の取得と読み込みの安全」と「上限とメモリ」にあります。

## 誤りと診断

### 投げる誤り

| 場面 | 結果 |
| --- | --- |
| FO の XML が読めない | `typeset` が投げる (`XML の解析に失敗しました: …`) |
| 既定の書体が読めない | `typeset` が投げる (`書体を読めません: …`) |
| `fonts` に渡した書体ファイルが壊れている | 投げずに `warnings` に入る |
| `renderPage` の無いページ番号 | `RangeError` (`renderPageToSvg`・`renderPageToPng` は `RangeError` で失敗する Promise) |
| 組版の警告 (読めない画像・溢れなど) | 投げずに `result.warnings` に入る |

Kumiori の投げる誤りは、種類の名前 `code` を持つ `KumioriError` とその下の型 (`KumioriInputError`・`KumioriLimitError`・`KumioriFontError`・`KumioriPdfError`) か、選択肢の誤りの `KumioriOptionError` です。
`KumioriOptionError` は、前からの `TypeError` を継ぎ、誤った選択肢の名前を `option` に持ちます。
`isKumioriError(e)` で見分けます。名前の一覧は [`docs/diagnostics.md`](diagnostics.md) にあります。

### 診断 (diagnostics)

`result.diagnostics` (`typesetToPdf` の結果にもある) は、`warnings` と同じ出来事を、次の形で持ちます。

| 持ち物 | 中身 |
| --- | --- |
| `code` | 種類の名前 (`css/unknown-property` など。版をまたいで変えない) |
| `severity` | 重さ。`error` は出力が欠けた、`warning` は指定を無視した、`info` は知らせ |
| `message` | 文 |
| `args` | 文に埋めた値 |
| `count` | 同じものの数 |
| `source` | 分かるときは入力の場所 (ファイル・行・列・要素・Area Tree の `sourceRef`・PDF のページ) |

未対応・知らない CSS と XSL-FO の指定は、`warnings` では 1 つの文にまとめ、`diagnostics` では項目ごとに 1 件にします。`warnings` の文と並びは前と同じです。
名前の一覧と重さは [`docs/diagnostics.md`](diagnostics.md) にあります。

## draw.io の図

`drawio` は、draw.io (diagrams.net) の図のファイル (`.drawio`・`.dio`) の選択肢です (型は `DrawioOptions`)。

既定で、draw.io の図を画像として読み、ページを SVG にして PDF に図形と文字のまま入れます (図を描く処理は、図が出てきたときだけ読み込みます)。`false` なら、draw.io の図を画像として読みません。
下の表は主なものです (すべては [API の説明書](#api-の説明書) に)。

| 選択肢 | 中身 |
| --- | --- |
| `stencils` | 図形ライブラリと配布物の画像のファイル |
| `fetchStencils` | 足りない図形ライブラリ・画像を draw.io の配布物から取るか。既定 `false` |
| `stencilsUrl` | 取る先の `stencils.min.js` の URL (`fetchStencils` を使うとき) |
| `provideStencils` | 足りない図形ライブラリ・画像の名前を受けて、図形ライブラリの登録所を返す関数 (渡すと `stencils`・`fetchStencils` は使わない) |

書き方・ページの選び方・描くものは [`docs/drawio.md`](drawio.md) にあります。

## プラグイン

`plugins` は、プラグインの配列です。いまは画像の形式を足すものだけです。

```ts
{ apiVersion: 1, name, imageFormats: [{ name, mime, extensions, sniff, load }] }   // 型は KumioriPlugin・ImageFormat
```

- 画像のファイルが形式の `sniff` (中身の判定。同期) に当たれば、`load` (非同期) が SVG と大きさを返し、Kumiori はそれを SVG の画像として描きます (PDF には図形のまま入ります)。
- `extensions` の拡張子の名前のファイルも、文書に名前が出てくれば画像として読みます。
- 重い処理は `load` の中で `import()` すれば、その形式のファイルが出てきたときだけ読み込まれます。
- `apiVersion` は受け口の版 (`PLUGIN_API_VERSION`) で、互換の無い形に変えたら上げます。
- プラグインの形式は、本体の形式 (draw.io の図) より先に判定します。

`load` に渡るもの (主なもの。すべては [API の説明書](#api-の説明書) に):

| 名前 | 中身 |
| --- | --- |
| `measureText` | 文字の幅を、描く書体で測る |
| `fetchResource` | 文書の画像と同じ決まり (`resolveResource`・`fetchImages`) で取る |
| `fetch` | プラグインの選択肢で利用者が許したものを取る |
| `warn` | 警告を出す |
| `lang` | 警告の文の言語 (`ja`・`en`。`TypesetOptions.lang`) |
| `fragment` | 画像の参照の `#` の後ろ。1 つのファイルの中の、どの図・ページを描くか。同じファイルを `#` の後ろの違う参照で指すと、参照ごとに `load` を呼び、別の画像になる |

`load` の結果には上限があります (draw.io の図も同じ。`src/imageFormats.ts`)。超えたものは読めない画像として扱い、警告を出します。

| 上限 | 値 |
| --- | --- |
| 大きさ | 有限で 1,000 万 px まで |
| SVG の長さ | 約 3,360 万字 + ファイルの 1 バイトあたり 128 字 (最大約 1 億 3,400 万字) |
| 時限 | 60 秒 + 取得の時限 (`fetchTimeoutMs`) の 3 倍 (既定 150 秒) |
| 1 つのファイルを `#` の後ろの違う参照で読む数 | 64 個まで |

プラグインは Kumiori と同じ権限で動きます。自分で選んだ、信頼できるものだけを渡してください。

## Node の部品 (kumiori/node)

```ts
import { typeset } from 'kumiori';
import { createFileResolver, createFontLoader } from 'kumiori/node';
const result = await typeset(html, { loadFont: createFontLoader(), resolveResource: createFileResolver() });
```

下の表は主な部品です (すべては [API の説明書](#api-の説明書) に)。

| 部品 | 中身 |
| --- | --- |
| `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` | `loadFont` に渡す、既定の書体の読み込み。Node のコマンドと同じく、`fontDir` → 書体のキャッシュ → ネットワークの順に探し、取った書体はキャッシュに保存する。`cacheDir` の既定は `defaultFontCacheDir()`、`null` でキャッシュしない |
| `createFileResolver({ root })` | `resolveResource` に渡す、`file:` の URL のファイルを読む関数。`root` を渡すと、その中のファイルだけを読む。`root` はいくつかの並びでもよく、中にあるかはシンボリックリンクをたどった実体のパスで見る |

## パッケージの形と動く環境

| 入口 | ファイル | 使い方 |
| --- | --- | --- |
| `kumiori` | `dist-lib/index.js` | 依存パッケージ (pdf-lib・fontkit・xmldom など) を取り込んでいない ES モジュール。Vite・webpack などのバンドラーで使うか、Node から読む |
| `kumiori/node` | `dist-lib/node.js` | Node の部品 ([上](#node-の部品-kumiorinode)) |
| `kumiori/browser` | `dist-browser/kumiori.js` | 依存まで 1 つにまとめた、バンドラーを使わないブラウザ向けのファイル |

- 公開しているのは `src/index.ts` (と Node 用の `src/node.ts`) から出しているものだけです。ほかのモジュールの関数・型は、版の間で変わることがあります。
- ES モジュールだけですが、`require('kumiori')` でも読めます (ES モジュールを `require()` で読める Node 20.19.0 以降・22.12.0 以降。Node 22.0〜22.11 では `--experimental-require-module` が要ります)。
- 動く Node は、20.19.0 以上の 20 系か、22.12.0 以上です。HTML を読むための依存パッケージ (linkedom の使う css-select など) が Node 20.19.0 以降を求めます。22.0〜22.11 は、ES モジュールを `require()` で読めないので対象から外しています。

`kumiori/browser` は、約 3.0MB (gzip で 1.0MB) です。最初に一緒に読む別ファイル (`chunks/` の pdf-lib・pako など) と合わせて約 3.6MB です (pdf-lib は draw.io の図の処理と分け合うので、別ファイルになります)。
ハイフネーションの辞書と、CGM・EPS・WMF・EMF・draw.io の図の処理などは、使うときだけ別ファイルを読みます。
npm に公開したものは、jsDelivr や unpkg の CDN からそのまま読めます。

```html
<script type="module">
  import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.5.0/dist-browser/kumiori.js';
  const result = await typesetHtml(html, { name: 'a.html' });
  result.renderPage(document.querySelector('canvas'), 0);
</script>
```

## ブラウザで印刷プレビューを出す

`result.renderPage(canvas, ページ番号, { scale })` で、組んだページを canvas に描けます。
ブラウザの画面では、HTML をブラウザの DOMParser で読みます (linkedom は、Node と、[Web Worker](#web-worker-の中で組む) の中で使います)。

例: エディタで編集している HTML を、手が止まるたびに組んでプレビューに並べる

```ts
import { typeset } from 'kumiori';
import type { FontSpec } from 'kumiori';

const printCss = '@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } } body { font-family: serif }';
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const loadFont = (spec: FontSpec) => {                          // 既定の書体は 1 度だけ取得して使い回す
  const key = `${spec.family}|${spec.weight ?? 400}`;
  if (!fontCache.has(key)) fontCache.set(key, fetch(spec.urls.find((u) => u.startsWith('https:'))!).then((r) => r.arrayBuffer()));
  return fontCache.get(key)!;
};

async function showPreview(bodyHtml: string, container: HTMLElement) {
  const r = await typeset(`<!doctype html><html lang="ja"><body>${bodyHtml}</body></html>`, {
    kind: 'html',
    files: [{ name: 'print.css', data: printCss }],             // 文書から参照されていない CSS は、利用者のスタイルシートとして足される
    loadFont,
  });
  container.replaceChildren();
  for (let i = 0; i < r.pageCount; i++) {
    const canvas = document.createElement('canvas');
    r.renderPage(canvas, i, { scale: 1 });                      // 1pt = 1 CSS px (等倍は 96 / 72)
    container.append(canvas);
  }
}
```

- 何度も組むときは、`await createTypesetter(setup)` で書体を 1 度だけ読み込んだ器を作り、`typesetter.typeset(html, options)` で組むと速くなります (`loadFont` などの書体まわりの選択肢は、`setup` に渡します)。
- 動く見本: `npm run dev` の後、http://localhost:5173/examples/preview/ を開きます (`examples/preview/`)。
  左の編集欄、その下の「HTML」欄 (見出し・ルビ・表などを直接書ける。編集欄と互いに写し合う)、印刷の CSS を書き換えると、手が止まったところで右に組み直します。
  Kumiori の公開 API だけを使い、ほかの依存はありません。
  ほかのエディタとつなぐときは、エディタの中身が変わったときの通知で、見本の `schedule(エディタの HTML)` に当たる処理を呼びます。

## Web Worker の中で組む

大きな文書を組む間も画面が止まらないように、組版・描画・PDF の書き出しを Web Worker の中で行えます。ブラウザ向けの 1 ファイル (`kumiori/browser`) を、Worker の中で読みます。
この使い方は、0.5.0 からです (0.4.0 は、Worker の中では組めません)。

```js
// worker.js (new Worker('worker.js', { type: 'module' }) で作る)
import { createTypesetter } from 'https://cdn.jsdelivr.net/npm/kumiori@0.5.0/dist-browser/kumiori.js';
const typesetter = createTypesetter();                          // Promise<Typesetter>。書体を読み込むのは 1 度だけ
let result;
self.onmessage = async ({ data }) => {
  if (data.type === 'typeset') {
    result = await (await typesetter).typeset(data.html, { name: 'a.html' });
    self.postMessage({ type: 'typeset', pageCount: result.pageCount, sheets: result.areaTree.sheets.map((s) => [s.width, s.height]) });
  } else if (data.type === 'render') {
    const canvas = new OffscreenCanvas(1, 1);
    result.renderPage(canvas, data.page, { scale: data.scale, devicePixelRatio: data.dpr });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: 'render', page: data.page, bitmap }, [bitmap]);
  } else if (data.type === 'pdf') {
    const pdf = await result.toPdf();
    self.postMessage({ type: 'pdf', pdf }, [pdf.buffer]);
  }
};
```

### 描き方

- `renderPage` には `OffscreenCanvas` を渡します。描いた画素は `transferToImageBitmap()` で `ImageBitmap` にし、画面へ送って `bitmaprenderer` の canvas などに出します。
- Worker には `window.devicePixelRatio` が無いので、画面の値を `devicePixelRatio` で渡します (渡さなければ 1)。
- `kumiori` (`dist-lib`) をバンドラーで Worker に入れると、linkedom を読めないことがあります (Node のときだけ読む作りのため)。`kumiori/browser` を使ってください。

### 画面の中で組んだ結果との違い

- Worker にはブラウザの DOMParser が無いので、HTML・SVG は linkedom (Node と同じ読み方) で読みます。linkedom は、Worker の中で初めて組むときに、別ファイル (`chunks/`) から読み込みます (画面の中で組むときは読みません)。
- そのため、Worker の中で組んだ結果は Node で組んだ結果と同じで、画面の中 (DOMParser) で組んだ結果と違うことがあります。たとえば HTML の中の MathML は、linkedom が `math` の要素を XHTML の名前空間に置くので、数式の組み方が画面の中と変わります。
- Worker の中の `renderPage`・PDF の SVG は、ブラウザの画面の描く SVG と絵が違うことがあります。
  - `foreignObject` の中は、PDF では本文と同じ組版で組みますが、`renderPage` では文字だけを近似します。
  - filter の `feGaussianBlur` (ぼかし) だけの影などは、ぼかしを省きます (Node の PDF と同じ)。
  - SVG の中の SVG の画像 (`<image>` の指す SVG) は、仮の枠で描きます (Node と同じ)。

### 画像の扱いと上限

- Worker にはブラウザの画像 (`<img>`) が無いので、SVG の画像は、PDF では Node と同じく図形で描き、`renderPage` では図形を画素にして描きます (倍率に合わせた解像度で描き直します)。ほかの形式の画像は `createImageBitmap` で読みます。
- `renderPage` で SVG の画像を画素にするときの上限:
  - 1 つの画像は 1,600 万画素までです。それより大きく置いた画像は、解像度を下げて描きます。
  - 図形を画素にする手間 (図形の数 × 画素の数) にも上限があり、図形の多い画像を大きく置いたときも、解像度を下げて描きます。
  - 1 回の描画で画素にする手間の合計にも上限があり、超えた後の画像は仮の枠で描いて、`canvas/svg-not-drawn` の警告を出します。
- SVG の中の画像のうち、組版の画素の読み取りで読めない形 (CMYK の JPEG・インターレースの PNG) は、`renderPage` のために、組んだときに `createImageBitmap` で読んでおきます。
  - 1 枚は 400 万画素までです。大きい画像は縮めて読みます。頭に書かれた大きさが 400 万画素を超える画像は、元の大きさに戻さずに、読むときに縮めます。
  - 1 つの組んだ結果で、合わせて 3,200 万画素までです。画像は読み込んだ順に読みます。渡したファイル (`files`) の画像、次に文書の中の data: の URL・取った画像の順で、1 つの SVG の中では書いた順です。
    合計が上限に届いた後の画像 (多くは文書の後ろの方の画像。上限に収まる小さな画像は読みます) は読まず、`renderPage` では描きません。描かないことの警告は出ません。
  - PDF には影響しません (この上限は PDF の画像には掛かりません)。

## 単位と座標

- 内部の単位は **pt** です (ページの設定だけ mm)。Area の `x`・`y` は、親の content-box の左上を基準にした物理座標です (y は下向き)。
- 絶対配置 (`absolutePosition`) は、**仕上がり (trim) の左上** が基準です。塗り足しへ届かせるには、負の `top`・`left` を指定します。
- `width`・`height` の既定は `content-box` です。`boxSizing: 'border-box'` で、padding・border を含めた大きさにできます。

組んだ結果 (Area Tree) の形と JSON は [`docs/area-tree.md`](area-tree.md)、内部の仕組みは [`docs/architecture.md`](architecture.md) にあります。

## API の説明書

すべての関数・型・選択肢の説明は、API の説明書 (<https://n-lights-co.github.io/kumiori/api/>) にあります。型の宣言のコメントから作った一覧の頁で、日本語です。
このリポジトリでは `npm run docs:api` で `dist/api/` に作れます。
