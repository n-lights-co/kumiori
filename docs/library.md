> English: [en/library.md](en/library.md)

# ライブラリとして使う

TypeScript・JavaScript のプログラムから、HTML+CSS・XSL-FO を組み、PDF・Canvas・SVG・PNG に出すためのドキュメントです。
すべての関数・型・オプションの一覧は、API リファレンス (<https://n-lights-co.github.io/kumiori/api/>) にあります ([API リファレンス](#api-リファレンス))。

- [入れ方](#入れ方)
- [最初の例](#最初の例)
- [入口の関数](#入口の関数)
- [組み方のオプション (options)](#組み方のオプション-options)
- [組んだ結果 (TypesetResult)](#組んだ結果-typesetresult)
  - [PDF にする (toPdf)](#pdf-にする-topdf) ・ [PDF/X と PDF/A](#pdfx-と-pdfa) ・ [Canvas に描画する (renderPage)](#canvas-に描画する-renderpage) ・ [SVG にする (renderPageToSvg)](#svg-にする-renderpagetosvg) ・ [PNG にする (renderPageToPng)](#png-にする-renderpagetopng) ・ [メモリの見積もりと手放す (memoryUsage・dispose・releaseCaches)](#メモリの見積もりと手放す-memoryusagedisposereleasecaches)
- [PDF だけを作る (typesetToPdf)](#pdf-だけを作る-typesettopdf)
- [PDF をストリームで書き出す (typesetToPdfStream)](#pdf-をストリームで書き出す-typesettopdfstream)
- [PDF を暗号化する (encrypt)](#pdf-を暗号化する-encrypt)
- [文書を作らずに文字列を測る (measureText・breakLines)](#文書を作らずに文字列を測る-measuretextbreaklines)
- [ファイルと外部のリソース](#ファイルと外部のリソース)
- [エラーと診断](#エラーと診断)
- [draw.io の図](#drawio-の図)
- [プラグイン](#プラグイン)
- [Node のモジュール (kumiori/node)](#node-のモジュール-kumiorinode)
- [パッケージの形と動作環境](#パッケージの形と動作環境)
- [ブラウザーで印刷プレビューを出す](#ブラウザーで印刷プレビューを出す)
- [Web Worker の中で組む](#web-worker-の中で組む)
- [単位と座標](#単位と座標)
- [API の安定性 (バージョンをまたいだ約束)](#api-の安定性-バージョンをまたいだ約束)
- [API リファレンス](#api-リファレンス)

## 入れ方

```bash
npm install kumiori
```

このリポジトリで作るときは `npm run build:lib` です (`dist-lib/`。ES モジュールと型定義)。
バンドラーを使わないブラウザーでは、CDN から 1 ファイルで読めます ([パッケージの形と動作環境](#パッケージの形と動作環境))。

## 最初の例

```ts
import { typeset, typesetToPdf, walkAreaTree } from 'kumiori';

// HTML+CSS (XSL-FO も同じ関数で組める。種類は name の拡張子か中身で見分ける)
const result = await typeset(html, {
  name: 'book.html',
  files: [
    { name: 'book.css', data: cssText },                        // CSS・画像・フォントは { name, data }
    { name: 'img/cover.jpg', data: async () => readBytes('img/cover.jpg') }, // 使うときだけ読む関数でもよい
  ],
  loadFont: async (spec) => readLocalFont(spec),               // 既定のフォントの読み方 (省略すれば Google Fonts から取得する)
});
console.log(result.pageCount, result.warnings);
walkAreaTree(result.areaTree, (area) => { /* 組んだ結果 (Area Tree) をたどる */ });
const pdf = await result.toPdf();                              // Uint8Array
const { pdf: bytes } = await typesetToPdf(html, { name: 'book.html' }); // PDF だけが要るとき (組んだ結果を持たないので、大きな文書で使うメモリが少ない)
await result.renderPage(canvas, 0);                            // 1 ページ目を canvas に描画する (ブラウザー)
const svg = await result.renderPageToSvg(0);                   // 1 ページ目を SVG の文字列に (ブラウザーでも Node でも)
const png = await result.renderPageToPng(0, { dpi: 150 });     // 1 ページ目を PNG に (Uint8Array。ブラウザーでも Node でも)
```

## 入口の関数

| 関数 | 何をするか |
| --- | --- |
| `typeset(text, options)` | 文書を組み、組んだ結果 (`TypesetResult`) を返す。種類は `options.kind` か、`name` と中身で決める |
| `typesetHtml`・`typesetFo` | 種類を決め打ちする `typeset` |
| `typesetToPdf(text, options, pdfOptions)` | PDF だけを作る ([下](#pdf-だけを作る-typesettopdf)) |
| `typesetToPdfStream(text, options, output, pdfOptions)` | PDF をページごとに書き出し先へストリームで書き出す ([下](#pdf-をストリームで書き出す-typesettopdfstream)) |
| `await createTypesetter(setup)` | フォントを 1 度だけ読み込んだタイプセッターを作る。`typesetter.typeset(...)`・`typesetter.typesetToPdf(...)`・`typesetter.typesetToPdfStream(...)` で組む。`typesetter.measureText(...)`・`typesetter.breakLines(...)` で、文書を作らずに文字列を測る ([下](#文書を作らずに文字列を測る-measuretextbreaklines))。`typesetter.memoryUsage()`・`typesetter.releaseCaches()` で、Typesetter のメモリを見積もる・キャッシュ (描画のための画像・再利用のキャッシュ) を手放す ([メモリの見積もりと手放す](#メモリの見積もりと手放す-memoryusagedisposereleasecaches)) |
| `decodeDocumentText(bytes)` | ファイルのバイト列を、BOM・XML 宣言の `encoding`・`<meta charset>` に従って文字列にする |
| `walkAreaTree(tree, fn)` | 組んだ結果 (Area Tree) をたどる ([`docs/area-tree.md`](area-tree.md)) |
| `snapshotDocument(document, options)` | ブラウザーの画面で、JS が組み上げた後の文書を、`typeset` に渡せる形にする ([下](#js-が組み上げたページを組む-snapshotdocument)) |
| `isKumioriError(e)` | Kumiori の投げたエラーかを見分ける ([エラーと診断](#エラーと診断)) |
| `DEFAULT_FONTS` | 既定で使うフォントの一覧。`{ base, math, mono, symbol, emoji }` で、`base` (本文の和文と欧文。毎回使う) と `mono` (等幅) は `FontSpec` の配列、`math` (数式)・`symbol` (本文のフォントに無い記号)・`emoji` (記号のフォントにも無い絵文字) は 1 つの `FontSpec`。`FontSpec` は `{ family, weight?, urls }` で、`loadFont` に渡される `spec` と同じ |

ほかに出すもの:

| 名前 | 何か |
| --- | --- |
| `KumioriError`・`KumioriInputError`・`KumioriLimitError`・`KumioriFontError`・`KumioriPdfError`・`KumioriOptionError`・`ERROR_CODES` | 投げるエラーの型と、エラーの名前の一覧 ([エラーと診断](#エラーと診断)) |
| `DIAGNOSTIC_CODES` | 診断の名前の一覧 ([`docs/diagnostics.md`](diagnostics.md)) |
| `walkAreas`・`childrenOf`・`documentNodes`・`serializeAreaTree`・`parseAreaTree`・`AreaTreeFormatError`・`AREA_TREE_SCHEMA_VERSION` | Area Tree をたどる・JSON に書く・読む関数と、形のバージョン ([`docs/area-tree.md`](area-tree.md)) |
| `PLUGIN_API_VERSION` | プラグインの受け口のバージョン ([プラグイン](#プラグイン)) |
| `DRAWIO_MIME`・`isDrawio`・`createDrawioStencilRegistry` | draw.io の図の MIME の型・図のファイルかを見分ける関数・図形ライブラリの登録所を作る関数 ([draw.io の図](#drawio-の図)) |

- `typeset` はファイルシステムに触りません。ネットワークを使うのは、既定のフォントの取得 (`loadFont` で差し替えられる) と、文書が `http(s):` で参照する画像・CSS の取得 (`fetchImages`・`fetchStyles` で止められる) だけです。なので、ブラウザーでも Node でも動きます。
- `text` は文字列です。ファイルから読むときは `decodeDocumentText(bytes)` で文字列にしてください (UTF-8 と決めて読むと、Shift_JIS の FO などが化けます)。
- 何度も組むとき (エディタのプレビューなど) は `await createTypesetter(setup)` でタイプセッターを作ります。フォントの取得と解析を毎回しないので速くなります (数式・等幅・記号のフォントは、使う文書を初めて組むときに読み込みます)。
- フォントまわりなど、何度組んでも同じオプション (`fonts`・`genericFonts`・`loadFont`・`systemFonts`・`fetchTimeoutMs`・`deflate`・`reuse`・`imageCache`。型は `TypesetterOptions`) は、タイプセッターを作るときに `setup` で渡します。`limits` は、タイプセッターと文書ごとの両方に書けます (タイプセッターの `limits` は、タイプセッターのフォントの読み込みに当て、文書ごとの既定になります。文書の `limits` は、名前ごとに上に重ねます)。`typesetter.typeset`・`typesetter.typesetToPdf` の文書ごとのオプション (型は `DocumentOptions`) には無く、`fonts`・`genericFonts`・`loadFont`・`systemFonts`・`reuse` を渡しても使われず、`api/setup-option-ignored` の警告が出ます。`setup` の `signal`・`onProgress` はタイプセッターを作る間だけ効き、文書ごとの `signal`・`onProgress` は、その文書を組む間に効きます ([組版を止める・進捗](#組版を止める進捗-signalonprogress))。
- FO の DOCTYPE の内部サブセットに宣言した内部実体 (`<!ENTITY nbsp "&#160;">` など) は、読み込みの前に展開します (外部実体は読みません)。

## 組み方のオプション (options)

`typeset(text, options)` の第 2 引数です (型は `TypesetOptions`)。多くは、コマンドのオプションと同じ意味です ([`docs/cli.md`](cli.md))。
下の表に、すべてのオプションを並べます。型と細かい規則は [API リファレンス](#api-リファレンス) にあります。

### 入力

| オプション | 中身 | コマンド |
| --- | --- | --- |
| `kind` | `html`・`xhtml`・`fo`。省略すれば `name` と中身で決める | |
| `name` | 入力のファイル名 | |
| `files` | CSS・画像・フォントの `{ name, data }` の配列。`data` は中身か、使うときだけ読む関数。フォントは TTF・OTF・TTC・WOFF・WOFF2 | |
| `unreferencedCss` | 文書 (HTML) から参照されていない CSS のファイル (`files`) の扱い。`'user-stylesheet'` (既定) は利用者のスタイルシートとして追加し、`'ignore'` は追加せずに警告に出す | (コマンドは `'ignore'`。追加するには `--css`) |
| `resolveResource` | `files` に無いファイルの中身を返す関数 ([ファイルと外部のリソース](#ファイルと外部のリソース)) | |
| `lang` | `warnings` とエラーの文の言語。`ja` か `en`。既定は日本語。違う `lang` の呼び出しを同時に (待たずに) 走らせても、それぞれの呼び出しの言語になる | `--lang` |
| `diagnostics` | 診断の扱い。`{ ignore: [...] }` に、出さない診断の名前 (`css/unknown-property` など。[`docs/diagnostics.md`](diagnostics.md)) を並べる。その名前の警告は、`warnings` にも `diagnostics` にも入れない (PDF を書く途中の警告も)。知らない名前は、止めずに `api/unknown-diagnostic-code` の警告に出す | `--ignore-warning` |
| `maxPages` | 先頭から何ページまで組むか (1 以上の整数。既定は全体。[先頭の数ページだけを組む](#先頭の数ページだけを組む-maxpages)) | `--max-pages` |

### スタイルとフォント

| オプション | 中身 | コマンド |
| --- | --- | --- |
| `style` | HTML の既定のスタイル | `--style` |
| `pageSize` | HTML の既定の用紙。`@page` で `size` を指定していない文書の用紙を、CSS の `size` の書き方で書く (`"A5"`・`"A5 landscape"`・`"148mm 210mm"`。長さは 1pt 以上で、ほかは `KumioriOptionError`)。既定は A4。文書の `@page { size }` が勝つ。`@media` の `width`・`height` もこの用紙で評価する | `--page-size` |
| `compat` | XSL-FO の既定値の流儀 | `--compat` |
| `fonts` | 追加するフォント | `--font` |
| `genericFonts` | 総称ファミリーに使うフォント。名前は `serif`・`sans-serif`・`monospace`・`serif-cjk`・`sans-serif-cjk` | `--generic-font` |
| `systemFonts` | 読み込んだどのフォントにも字形の無い文字を、OS のフォントで組むコンポーネント。既定は使わない。Node では `kumiori/node` の `createSystemFonts()` を渡す ([Node のモジュール](#node-のモジュール-kumiorinode))。既定のフォント・記号と絵文字のフォントのどれにも無い文字だけを、その文字に限って OS のフォントで組み (ほかの文字のフォントは変わらない)、組むのに使ったフォントを、そのフォントで組んだ文字と一緒に `font/system-fallback` で通知する (組んだ後に、使ったフォントごとに 1 件)。明朝の文脈 (指定の書体が明朝・セリフ体) の文字は明朝の OS のフォント、ゴシックの文脈の文字はゴシックの OS のフォントを先に使い (書体の種類は OS/2 の PANOSE・sFamilyClass と名前で決める。種類の分からない指定の書体は明朝の側)、種類の合うフォントが無い文字は、種類の分からないフォント・ほかの種類のフォントで補う。読み込むのは、文書で要る種類のフォントだけ (明朝の文脈にしか無い文字に、ゴシックのフォントを読まない)。文書の `font-family` からは OS のフォントを名前で指定できない。組んだ結果が組む機械のフォントで変わり、組んだ PDF から機械に入っているフォントが分かるので、他人の書いた文書を組むときは渡さない。`createTypesetter` の設定 | `--system-fonts` |
| `loadFont` | 既定のフォントの読み方。省略すれば Google Fonts から取得する (`https:` の URL だけを試す) | |
| `svgLanguages` | SVG の `systemLanguage` を照合する言語タグの配列 | `--svg-lang` |

### PDF の作り

| オプション | 中身 | コマンド |
| --- | --- | --- |
| `tagged` | タグ付き PDF にする。既定 `true`。`false` でタグを付けない | `--tagged`・`--no-tagged` |
| `pdfua` | PDF/UA-1 の PDF にする (タグ付き PDF を含む)。`true` か `{ warnings }` | `--pdfua` |
| `documentLang` | 入力に言語が無いときの文書の言語 (BCP 47 の言語タグ) | `--document-lang` |
| `print` | 塗り足しとトンボ | `--print` |
| `spotColors` | 特色の代わりの CMYK | `--spot-colors` |
| `links` | 文書の外へのリンクのうち、PDF に動作を書くもの (下。ページの SVG の書き出しのリンクも同じポリシー) | `--link-schemes`・`--link-launch`・`--link-relative` |
| `deflate` | 圧縮の関数 (zlib の形)。ページの中身・フォント・画像のストリームの圧縮に使う。Node なら `zlib.deflateSync` を渡すと PDF の書き出しが速い。省くと、画像のストリームは Node では Node の zlib、ブラウザー・Web Worker では `CompressionStream` で圧縮し、ほかのストリームは pdf-lib の圧縮 (pako) で圧縮する | |

`links` は `{ schemes?: string[]; launch?: boolean; relative?: 'file' | 'uri' }` です。

- 既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と、相対参照の PDF だけに動作を書きます。ほかは文字だけを組み、`warnings` に通知します。
- `schemes` は許すスキームの一覧です (既定と置き換わる。`'*'` はすべて)。
- `launch: true` は、ファイルを開く動作 (PDF でない相対のファイル・絶対パス・`//host/…`) も書きます。
- すべて書くには `{ schemes: ['*'], launch: true }` とします。

### 外部の取得

| オプション | 中身 | コマンド |
| --- | --- | --- |
| `fetchImages` | 文書が `http(s):` で参照する画像 (SVG の画像・インラインの `svg` の中の `image` が指す画像も) を取得するか。既定 `true`。`false` か、URL を受けて真偽を返す関数 | `--no-fetch-images` |
| `fetchStyles` | 文書が `http(s):` で参照する CSS と、その `@font-face` のフォントを取得するか。`fetchImages` と同じ形 | `--no-fetch-styles` |
| `fetchTimeoutMs` | フォント・画像の取得の時限 (ミリ秒)。既定 30 秒。本体を読み終えるまで効く。プラグインの `load` にも渡る ([プラグイン](#プラグイン)) | |
| `limits` | 入力の上限 (画像のピクセルの数・ファイルの大きさ・入れ子の深さなど) を変える ([入力の上限](#入力の上限-limits)) | `--limit` |
| `signal` | 組版を止めるシグナル (`AbortSignal`)。読みかけの取得も止める ([組版を止める・進捗](#組版を止める進捗-signalonprogress)) | |
| `onProgress` | 進捗のコールバック ([組版を止める・進捗](#組版を止める進捗-signalonprogress)) | |
| `drawio` | draw.io の図のオプション ([draw.io の図](#drawio-の図)) | `--no-drawio`・`--drawio-stencils` など |
| `plugins` | プラグインの配列 ([プラグイン](#プラグイン)) | `--plugin` |

他人の書いた文書をサーバーで組むときは、`fetchImages`・`fetchStyles` を止めるか、許す URL だけにしてください ([ファイルと外部のリソース](#ファイルと外部のリソース))。
表のコマンドの列のオプションの正しい名前と書き方は、[`docs/cli.md`](cli.md) の一覧で確認してください。

## 組んだ結果 (TypesetResult)

| 持ち物 | 中身 |
| --- | --- |
| `pageCount` | ページ数 |
| `areaTree` | 組んだ結果の物理ツリー (Area Tree)。JSON の形は [`docs/area-tree.md`](area-tree.md) |
| `warnings` | 組版の警告 (文字列の配列。読めない画像・溢れなど。投げずにここに入る) |
| `diagnostics` | `warnings` と同じイベントを、種類の名前と場所で持つもの ([エラーと診断](#エラーと診断)) |
| `layoutMs` | 組版にかかった時間 (ミリ秒。読み込みと PDF の書き出しは含まない) |
| `truncated` | `maxPages` で途中で止めたか ([先頭の数ページだけを組む](#先頭の数ページだけを組む-maxpages)) |
| `toPdf(options)` | PDF のバイト列 (`Uint8Array`) を返す |
| `toPdfStream(output, options)` | `toPdf` と同じ PDF を書き出し先へストリームで書き出し、`{ bytes }` (書いたバイト数) を返す ([PDF をストリームで書き出す](#pdf-をストリームで書き出す-typesettopdfstream)) |
| `renderPage(canvas, i, options)` | ページを canvas に描画する (ブラウザー)。描画し終えたときに解決する `Promise<void>` を返す |
| `renderPageToSvg(i, options)` | ページを SVG の文字列にする (ブラウザーでも Node でも) |
| `renderPageToPng(i, options)` | ページを PNG のバイト列にする (ブラウザーでも Node でも) |
| `memoryUsage()` | この結果を手放すと減るメモリの、おおよその見積もり (`{ total, images, fonts, layout }`。バイト) を返す ([メモリの見積もりと手放す](#メモリの見積もりと手放す-memoryusagedisposereleasecaches)) |
| `dispose()` | この結果が持つもの (画像・文書ごとのフォント・描画するためのキャッシュ・エリアツリー) を手放す。手放し終えたときに解決する `Promise<void>` を返す。後で PDF にする・描画すると `api/result-disposed` |
| `disposed` | `dispose()` を呼んだか (`boolean`。呼んだ時点で `true`) |

ページの番号は 0 から数えます。

### PDF にする (toPdf)

`result.toPdf({ title, pdfx, pdfa, imageMaxDpi, date, encrypt })` (型は `PdfOptions`)。

| オプション | 中身 |
| --- | --- |
| `title` | PDF のタイトル |
| `pdfx` | 入稿用の PDF/X の印 (下) |
| `pdfa` | 長期保存用の PDF/A の印 (下) |
| `imageMaxDpi` | JPEG の解像度の上限 |
| `date` | PDF の作成日・更新日 (Info と XMP) と、添付ファイルの更新日に書く日時 (`Date`。秒より下は切り捨てる)。無ければ PDF を書き出す時刻。同じバージョンの Kumiori で、同じ入力・同じフォント・同じ設定と同じ `date` で組めば、同じ環境 (Node のバージョン・ブラウザー) では同じバイトの PDF になる。`deflate` を渡さないとき、画像のストリームは環境の zlib (Node の zlib・ブラウザーの `CompressionStream`) で圧縮するので、環境をまたぐと、画像のある PDF のバイトが違いうる (見た目は同じ)。どこでも同じバイトにしたいときは、`deflate` に決まった関数 (pako の `deflate` など) を渡す。正しくない `Date` と 0〜9999 年の外は `KumioriOptionError` (`option` は `'date'`)。コマンドでは環境変数 `SOURCE_DATE_EPOCH` |
| `encrypt` | PDF を暗号化する (AES-256。パスワードと権限。[下](#pdf-を暗号化する-encrypt))。PDF/X・PDF/A とは一緒に使えない |
| `signal` | PDF の書き出しを止めるシグナル (組んだときのシグナルは引き継がない。[組版を止める・進捗](#組版を止める進捗-signalonprogress)) |
| `onProgress` | PDF の書き出しの進捗 (`phase` は `pdf`) |

PDF を書く途中の警告 (描画できない文字・色つきの字形を色つきで描画できないことなど) は、`result.warnings` に追加します。

PDF には、ページ番号の書式 (XSL-FO の `format`・`initial-page-number`、CSS の `counter(page, <型>)`・`counter-reset: page`) から、ビューアーが出すページの番号 (ページラベル) を書きます (前付けを i・ii、本文を 1 から、など)。1 からの 10 進の通しの文書には書きません。PDF の書き方に無い書式 (漢数字・丸数字など) は、ページごとに紙面と同じ文字を書きます。

### PDF/X と PDF/A

**PDF/X** は `pdfx: { version, condition, info, profile, warnings }` です (コマンドの `--pdfx`・`--output-profile` と同じ)。

- `version` は `'X-1a'`・`'X-1a:2003'`・`'X-3'`・`'X-4'`。既定は X-3 です。ほかの値 (`'x4'` のような大文字小文字の違い、`'X-1a:2001'`・`'X-3:2003'` のような別名も) は、オプションのエラー `KumioriOptionError` (`option` は `'pdfx.version'`) になります。
- RGB の色・画像を CMYK にします。X-1a・X-3 は透明をフラット化します。
- X-4 は、CMYK の出力機器の ICC プロファイル `profile` が要ります。X-1a・X-3 で `condition` が ICC のレジストリに無ければ、`profile` が要ります。`profile` は、ヘッダーとタグの表が ICC.1 の形どおり (説明のタグ desc もある) のものに限ります (合わなければ `pdfx/profile-invalid`)。
- `condition` を書かなければ、`profile` を渡したときはプロファイルの説明 (desc) を印刷条件の名前にし、出力インテントにレジストリ (RegistryName) を書きません。`profile` も無ければ `JC200103` (Japan Color 2001 Coated の登録名) です。
- どのバージョンも、書き出した PDF が要件に合うかを調べます。
- ページの中のリンク・注釈・フォームフィールドと、動作 (しおりの外へのリンク先など) は書かずに、件数を `warnings` に追加します。しおりは、タイトルと文書の中のリンク先を残します。

**PDF/A** は `pdfa: { version: 'A-2b' | 'A-3b', warnings }` です (コマンドの `--pdfa` と同じ)。`pdfx` と合わせるときは `pdfx.profile` が要ります。

**規格の本文との関係**

- PDF/X の出力と、書き出した後の検査は、PDF/X-1a:2001 (ISO 15930-1) と PDF/X-4 (ISO 15930-7) の本文を読んで作り、その要件に適合することを検証しています。PDF/X-1a:2003・PDF/X-3 は、その本文では検証しておらず、PDF/X-1a:2001 と同じ要件を当てています。入稿の前には、プリフライト (Acrobat Pro など) で検証してください。
- PDF/A は、規格 ISO 19005 の本文では検証していないので、規格への適合は保証しません。書き出した PDF を Kumiori が読み直して要件に合うかを調べ、開発では PDF/A の検査のツール veraPDF でも検証していますが、保存の前に、PDF/A の検査のツールで検証してください。

### Canvas に描画する (renderPage)

`result.renderPage(canvas, i, { scale, devicePixelRatio, guides })`

| オプション | 中身 |
| --- | --- |
| `scale` | 倍率。1 で 1pt = 1 CSS px (等倍は 96 / 72) |
| `devicePixelRatio` | 画面のピクセルの細かさ |
| `guides` | 仕上がり・塗り足しのガイド線 |

文字はフォントファイルのアウトラインから描画するので、ページの CSS や `@font-face` に左右されません。
描画し終えたときに解決する `Promise<void>` を返します (0.8.0 から。前は `void`)。無いページ番号は、`RangeError` で失敗します。

- 画像 (PNG・JPEG・GIF・WebP・BMP) は、組むときにはピクセルを持たず (読めるかと大きさを確かめるために 1 度デコードし、すぐ閉じます)、描画するときにデコードします。
  `renderPage` は、そのページの画像を、Typesetter 全体の画像のキャッシュから引き (無ければデコードして入れ)、そろってから 1 度に描画します (canvas に、途中まで描画した形は見えません)。
  キャッシュの上限と捨てる順は [メモリの見積もりと手放す](#メモリの見積もりと手放す-memoryusagedisposereleasecaches) にあります。
- 同じ canvas に、前の `renderPage` が終わる前に次の `renderPage` を呼んでも、描画は呼んだ順に行い、後に呼んだページが残ります (画像のデコードは並べて進め、描画だけを前の描画の後にします。別の結果の `renderPage` でも、同じ canvas なら同じです)。使い方の例は [ブラウザーで印刷プレビューを出す](#ブラウザーで印刷プレビューを出す) にあります。

### SVG にする (renderPageToSvg)

`result.renderPageToSvg(i, { guides, idPrefix, pageHref })` は、ページを SVG の文書 (文字列) にします。ブラウザーでも Node でも使え、依存を追加しません。

- 大きさは紙の大きさ (pt) です。
- 文字はフォントファイルのアウトラインのパスにします。`text` 要素を使わないので、SVG を見る側にフォントが無くても、PDF と同じ字形で描画できます。字形のアウトラインは `defs` に 1 度だけ書き、置く所は `use` で参照します。
- 画像は data: の URI で埋め込みます。PNG・JPEG はそのまま、GIF・BMP・WebP は PNG にします。
- 同じ画像は、置く大きさごとに 1 度だけ埋め込み、置く所は `use` で参照します。1 つの画像を 8 通りより多い大きさで置くときは、残りの大きさは 1 つの埋め込みを引き伸ばして参照します。
  大きさごとに中身を埋めるので、1 つの画像を多くの大きさで置く (背景の繰り返しのタイルの大きさも数える) と、SVG はその画像の埋め込み (base64 で元のファイルの約 4/3) の最大 9 倍ほどの大きさになります。
- SVG の画像は、PDF と同じく図形にしてから書き出します (文字はアウトライン、近似できない filter はピクセルで計算した画像。`vector-effect` の線・大きさは、SVG を置く拡大率で割った図形)。
  `switch` の子は、PDF と同じく `svgLanguages` (`--svg-lang`) で選び、`foreignObject` の中身も、PDF と同じく本文と同じ組版で組んで描画します。`renderPageToPng` も同じです。
- 色つきの字形は、図形・グラデーション・画像にします (扇形のグラデーションは止まり点の色の平均で塗り、source-in などの合成は上に重ねる近似)。
- CMYK・特色の色は、画面と同じ式で RGB にします。
- リンク (本文のリンクと、SVG の画像の中のリンク) は、PDF と同じポリシー (`links`) に通したものだけを、SVG の `a` 要素にします。通さないものは書かずに、`warnings` に通知します (`link/action-dropped`)。
  - 本文のリンクは、リンクの領域の透明の矩形を、ページの中身の上に重ねて書きます。
  - 文書の中のリンク先は、同じページなら `#id` にします。別のページへのリンクは、`pageHref` (ページの番号を受けて、そのページの SVG の URL を返す関数) を渡したときだけ、`<返した URL>#id` に書きます (渡さなければ書きません)。リンク先の id は、そのページの SVG の要素 (ページの全体の、塗らない矩形) の id にします。
  - ⚠️ 書き出した SVG を `img` 要素 (や CSS の背景) で載せたときは、ブラウザーの規則で、リンクは押せません。SVG をそのまま開くか、HTML に直に入れた (`<svg>` を書いた) ときに押せます。
- 注釈・フォームフィールドは書きません。

| オプション | 中身 |
| --- | --- |
| `guides` | 仕上がり・塗り足しのガイド線 |
| `idPrefix` | SVG の中の id の接頭辞。既定 `k` |
| `pageHref` | 別のページへのリンクの書き先。ページの番号 (0 から) を受けて、そのページの SVG の URL を返す関数 (上。リンクのポリシーには通さずに書く)。無ければ、別のページへのリンクは書かない |
| `signal` | 止めるシグナル (組んだときのシグナルは引き継がない。[組版を止める・進捗](#組版を止める進捗-signalonprogress)) |

id は、接頭辞に番号を続けたもので、クリッピング・グラデーション・画像などを指します。
1 つの HTML に何枚も直に入れるときは、ページごとに、どれも別のページの接頭辞の先頭の部分にならないように変えてください。`p1-`・`p2-` のように、数字でない文字で終えます (`k` と `k1` では、`k10` と `k1` + `0` が重なります)。
`idPrefix` は XML の名前で書きます。XML 1.0 §2.3 の Name から `:` を除いたもので、英字・`_`・かななどの文字で始め、数字・`-`・`.` なども続けられます。ほかの文字を含むと `RangeError` です。
無いページ番号のときは、`RangeError` で失敗する Promise を返します。

### PNG にする (renderPageToPng)

`result.renderPageToPng(i, { dpi, guides })` は、ページを PNG (8 ビットの RGB。紙は白) のバイト列 (`Uint8Array`) にします。ブラウザーでも Node でも使え、依存を追加せずに、自前でラスタライズします。

- `dpi` は解像度です。既定 96。1 枚 4,000 万ピクセルまでで、超えれば `RangeError` です。
- `signal` は止めるシグナルです (組んだときのシグナルは引き継ぎません。[組版を止める・進捗](#組版を止める進捗-signalonprogress))。
- 描画の仕方は `renderPageToSvg` と同じです (文字はフォントのアウトライン、SVG の画像は PDF と同じ図形)。縁の塗り (アンチエイリアス) があり、縮めて置く画像はピクセルの平均で縮めます。
- ラスタライズできない画像 (CMYK の JPEG・インターレースの PNG) は描画せずに、`result.warnings` に追加します。
- 画像のキャッシュと上限 (ラスタライズする計算量・同時に持つオフスクリーンのバッファーの大きさ) は、コマンドの PNG の上限と同じです ([`docs/cli.md`](cli.md) の「上限とメモリ」)。
- 速さの目安: A4 の文字の多いページを 150dpi で、1 ページ 0.5 秒ほど (2026 年の x86 の Node 22)。
- 無いページ番号のときは、`RangeError` で失敗する Promise を返します。

### メモリの見積もりと手放す (memoryUsage・dispose・releaseCaches)

前に組んだ結果をいくつか持っておき、同じ文書をもう一度組まずに再利用するとき (プレビューで、前に見た文書へ戻るときなど) に、メモリの上限で、どの結果を手放すかを決めるための API です。
Typesetter (`createTypesetter`) の分と、持っている結果の分の和が、使っているメモリのおおよその量です。

```js
const typesetter = await createTypesetter(setup);
const held = new Map(); // HTML → 組んだ結果 (古いものが先)
const used = () => typesetter.memoryUsage().total + [...held.values()].reduce((n, r) => n + r.memoryUsage().total, 0);
// 上限を超えたら、古い結果から手放す (それでも超えるなら、まず描画のための画像のキャッシュを、次に再利用のキャッシュも手放す)
while (used() > budget && held.size > 1) {
  const [key, oldest] = held.entries().next().value;
  oldest.dispose(); // toPdf などが走っている間は、終わるまで memoryUsage() は今の値のまま
  held.delete(key);
}
if (used() > budget) typesetter.releaseCaches({ images: true });
if (used() > budget) typesetter.releaseCaches();
```

- どれも、おおよその見積もり (バイト) です。エリアツリー・フォントの表・再利用のキャッシュの分は、数 (領域・グリフ・行分けのキャッシュの大きさなど) に 1 つあたりの大きさを掛けたもので、処理系によって違います。1.0 までに、数え方と係数を変えることがあります。
  JS の物の大きさは処理系で違う (V8 のポインタの圧縮: Node は使わず、Chromium は使う) ので、係数は、Node (`process.versions.node` のある処理系) では Node 22 で、それ以外 (ブラウザー・Web Worker) では Chromium 158 の Web Worker で測った値を使います。Firefox・Safari は測っていませんが、Chromium の係数を使います。
- `result.memoryUsage()` (`{ total, images, fonts, layout }`) は、その結果を `dispose()` すると減る分です。
  Typesetter と共有するもの (Typesetter のフォント・OS のフォント (`systemFonts`)・再利用のキャッシュ) と、呼ぶ側が渡した中身をそのまま持つもの (`files`・`resolveResource` のフォントのファイル・添付のファイル) は数えません。
  - `images`: 画像のファイルの中身のうち、Kumiori が作って持つもの (data: の URL を戻したもの・ネットワークから取得したもの・SVGZ を展開したもの・Node で GIF などを PNG にしたもの。
    同じ中身でも、参照の URL が違えば別に持ちます)、ブラウザーの画面で SVG・TIFF を描画するためにラスタライズしたもの (幅 × 高さ × 4 バイト)、Web Worker の中で SVG の中の画像を描画するために前もって読んだピクセル。
    `files`・`resolveResource` で渡された画像の中身は、コピーせずにそのまま持つので数えません (0.8.0 から。前はコピーして数えていました)。結果を使う間は、渡した中身を書き換えたり、
    `postMessage` で transfer したりしないでください。描画のためにデコードした画像 (PNG・JPEG などの `ImageBitmap`) は、Typesetter のキャッシュ (下) に数え、結果には数えません。
  - `fonts`: その文書で追加したフォント (CSS の `@font-face`・XSL-FO と一緒に渡したフォント) の、読んだ表・グリフのキャッシュ (グリフ 1 つあたり Node で 500 バイト・ブラウザーで 180 バイト) と、その結果だけが持つファイル (WOFF・WOFF2 を戻したものなど)。
  - `layout`: エリアツリー。領域 1 つあたり Node で 340 バイト・ブラウザーで 200 バイト、構造ツリー (タグ付き PDF) の節 1 つあたり 200 バイト・しおりとリンク先。
- `typesetter.memoryUsage()` (`{ total, fonts, caches, cacheDetail }`): `fonts` は Typesetter が読み込んだフォント (既定のフォントと `fonts`・数式や等幅などのフォント・OS のフォント)、
  `caches` は描画のための画像のキャッシュと、再利用のキャッシュ (`reuse`) です。組んだ結果の分は入りません。`cacheDetail` は `caches` の内訳です (和が `caches`)。

  | `cacheDetail` の欄 | 中身 |
  | --- | --- |
  | `images` | 描画 (`renderPage`) のためにデコードした画像 (`ImageBitmap`。幅 × 高さ × 4 バイト。ブラウザーだけ。Node では 0) |
  | `lines` | 段落の行分け (`reuse`) |
  | `pages` | 前の文書のページ (`reuse`。ページツリーとページの区切りの記録) |
  | `fontPrep` | フォントのファイルの下ごしらえ (`reuse`。WOFF・WOFF2 を戻したものなど) |

- `typesetter.releaseCaches(kinds?)` は、キャッシュを手放します (読み込んだフォントは手放しません)。`kinds` に、手放す種類を `true` にしたオブジェクトを渡すと、その種類だけを手放します
  (名前は `cacheDetail` の欄と同じ。例: `releaseCaches({ images: true })` は描画のための画像だけ、`releaseCaches({ lines: true, pages: true })` は行分けと前の文書のページだけ)。
  渡さなければ全部です。次の `typeset` は、再利用するものが無いので、初めて組むときと同じだけ時間がかかります。画像を手放した後の `renderPage` は、画像をデコードし直します。
  組んだ結果は変わりません。組んでいる途中にも、描画している途中 (`renderPage` を `await` している間) にも呼んで構いません。描画している途中のページの画像は、そのページを描き終えるまで捨てません。
  行分け・前の文書のページ・フォントの下ごしらえのキャッシュは組版だけが使い、描画 (組んだ結果のエリアツリーを読む) には関わりません。
- **描画のための画像のキャッシュ** (0.8.0 から): `renderPage` がデコードした画像は、Typesetter 全体で 1 つのキャッシュに持ちます。鍵は画像の中身なので、同じ画像を使う結果どうし
  (同じ文書を組み直した結果・共通の画像を使う章など) は、1 つのデコードした画像を分け合います。
  - 上限は `createTypesetter({ imageCache: { maxBytes } })` で決めます (バイト。デコードした画像の幅 × 高さ × 4 の合計。既定 256MB)。
  - 上限を超えたら、使っている結果 (`dispose()` していない結果) の無くなった画像を先に、残りは使った順の古いものから (LRU) 捨て、`close()` します。
    描画している途中の画像は捨てません。1 ページの画像の合計が上限を超えるときは、描画の間だけ上限を超えて持ち、描画を終えたら上限まで捨てます。
  - `dispose()` は、その結果を使う画像の持ち主から外すだけで、ほかの結果と分け合う画像は閉じません (生きている結果の描画が、閉じた画像を引くことはありません)。
    外した画像は、上限を超えたときに先に捨て、`releaseCaches({ images: true })` で全部捨てます。
  - 上限の決め方の目安: 同時に見せる (描画し直す) ページの画像の、幅 × 高さ × 4 の合計の数倍にします。たとえば 1600 × 1000 の画像は 1 枚 6.4MB なので、
    1 ページに 2 枚で、前後の数ページを行き来するプレビューなら 64MB ほど、本の全体をめくって戻ることが多いなら、全体の画像の量 (枚数 × 6.4MB) の一部 (256MB で 40 枚ほど) にします。
    上限を下げるほど、前に描画したページへ戻ったときにデコードし直す時間が増えます (1600 × 1000 の PNG で 1 枚 10ms ほど。Chromium 158 の Web Worker)。
  - Typesetter を使わない `typeset`・`typesetHtml`・`typesetFo` の結果は、結果ごとのキャッシュ (同じ既定の上限) を持ち、その結果の `dispose()` で全部手放します。
- `result.dispose()` は、その結果だけが持つブラウザーの画像を閉じ (GC を待たずにピクセルのメモリを返します)、画像・その文書のフォント・描画のためのキャッシュ・エリアツリー (`areaTree` の `sheets`・`structure`・`bookmarks`・`destinations`・`resources` を空にします) を手放します。結果をどこかから参照したままでも、その分は減ります。
  - 後で `toPdf`・`toPdfStream`・`renderPage`・`renderPageToSvg`・`renderPageToPng` を呼ぶと、`KumioriError` (`code` は `api/result-disposed`) で失敗します。手放した後は、`memoryUsage()` はどれも 0 を返します。`pageCount` などの数のフィールドは残ります。
  - `toPdf` などが走っている途中で呼んだときは、走っているものが全部終わってから手放します (走っているものは、そのまま同じ結果で終わります。PDF の保存の途中で、別の文書へ移ったときなど)。
    その間も結果はメモリを使っているので、`memoryUsage()` は今の見積もりを返し続け、手放した後に 0 になります。
  - `dispose()` は、手放し終えたときに解決する `Promise<void>` を返します。走っているものが無ければすぐに手放すので、返す Promise は解決済みです。走っているものが失敗しても、終われば解決します (Promise は失敗しません)。
    2 度目からは何もせず、初めと同じ Promise を返します。`await result.dispose()` の後は、`memoryUsage()` が 0 です。
  - `result.disposed` (`boolean`) は、`dispose()` を呼んだかです。呼んだ時点で `true` になり、新しい呼び出しは `api/result-disposed` になります。手放し終えたかは、`dispose()` の Promise で分かります
    (「頼んだ」と「終えた」を別のフィールドに分けないのは、手放し終えるのを待つ使い方は Promise の方が書きやすく、上限の判断には `memoryUsage()` が手放す前と後の量を返すためです)。
- `result.memoryUsage()` は何度呼んでも構いません。結果ごとの初めの 1 回は、エリアツリーの領域を数えるので時間がかかり (下の表の文書で 25ms ほど)、数えた値をキャッシュします (エリアツリーは組んだ後に変わりません)。
  2 回目からは、画像の登録 (画像のファイルの中身・ラスタライズした画像・前もって読んだピクセル) とその文書のフォントをたどって数え直します。
  `typesetter.memoryUsage()` の `cacheDetail.images` は、キャッシュが持つ量を足し続けているので、たどりません。描画すると増える (ラスタライズした画像など) ので、キャッシュしません。
  200 ページ・画像 342 枚の文書 (下の表の「プレビューをまねた HTML (画像 342 枚)」。領域 18.7 万) で、1 回あたり、初めが Node 22 で 30ms・Chromium 158 の Web Worker で 24ms、2 回目からが Node で 0.07ms・Web Worker で 0.27ms でした
  (`scripts/measure-result-memory.mjs` の「memoryUsage の時間」の列)。上限を超えて 1 件手放すたびに、持っている結果を全部数え直しても、数十件なら数 ms です。
  - 直近に組んだ文書の結果は、そのフォントの表と、ページの論理の木の一部を、Typesetter の再利用のキャッシュも参照します。なので、その結果を手放しても、次の文書を組むか `releaseCaches()` を呼ぶまでは、その分が残ります (下の表の「直近の結果」)。
  - 結果を参照しなくなれば、`dispose()` を呼ばなくても GC が手放します。`dispose()` は、早く手放したいとき (特にブラウザーの画像) に使います。
- 測った値 (`scripts/measure-result-memory.mjs`。Typesetter の再利用あり・`resolveResource` が同じ `ArrayBuffer` を返す使い方。MB):

| 文書 | ページ | 前の結果 (見積もり・dispose で減った量) | 直近の結果 (dispose で減った量) | 再利用のキャッシュ (見積もり・releaseCaches で減った量) | 再利用なしの結果 (見積もり・dispose で減った量) |
|---|---|---|---|---|---|
| プレビューをまねた HTML (画像 5 枚) | 3 | 5.9・1.7 | 4.3 | 2.9・9.4 | — |
| 同 (画像 34 枚) | 20 | 15.8・11.3 | 13.9 | 14.4・20.6 | — |
| 同 (画像 342 枚) | 200 | 120.8・113.9 | 116.1 | 136.6・140.5 | 120.8・121.0 |
| 対応仕様説明書 HTML と CSS 編 | 148 | 152.5・154.4 | 97.7 | 275.4・288.7 | 157.2・158.4 |
| 対応仕様説明書 XSL-FO 編 | 100 | 53.3・54.4 | 58.8 | 126.2・152.7 | 53.3・59.4 |
| 文だけの HTML | 215 | 77.6・73.5 | 73.1 | 194.0・180.2 | 77.6・76.1 |
| 目次のある文だけの HTML | 252 | 88.7・87.2 | 88.1 | 227.0・197.3 | 88.7・89.8 |

  Node 22 で、同じ文書を 2 度組み (前の結果と直近の結果)、それぞれを `dispose()` してから、`releaseCaches()` したときに減ったヒープ (`heapUsed + arrayBuffers`)。
  「プレビューをまねた HTML」は、共通の CSS に `@font-face` の TrueType のフォント 3 つ (0.9MB)、1 ページに段落 6 つと画像 1.7 枚ほど (300×200 の PNG) の文書です。
  小さな文書では、文書のフォントの表 (この文書で 4.2MB) が、再利用のキャッシュを手放すまで残ります (前の結果の減った量が少なく、キャッシュの減った量が多い)。
  Chromium 158 の Web Worker の中で、同じように測った値 (ブラウザーの係数。MB) は次のとおりです。量は Worker の CDP の `Runtime.getHeapUsage` の `usedSize` で、
  外のバイト列 (画像のファイルの中身・`ImageBitmap`・フォントのファイル) が入らないので、見積もりも `images` とフォントの下ごしらえを除いて書きます (画像の分は、どちらの処理系でも、中身の大きさと幅 × 高さ × 4 のとおりです)。

| 文書 | ページ | 前の結果 (見積もり・dispose で減った量) | 直近の結果 (dispose で減った量) | 再利用のキャッシュ (見積もり・releaseCaches で減った量) | 再利用なしの結果 (見積もり・dispose で減った量) |
|---|---|---|---|---|---|
| プレビューをまねた HTML (画像 34 枚) | 20 | 5.1・3.4 | 4.4 | 7.7・10.5 | — |
| 同 (画像 342 枚) | 200 | 37.9・34.2 | 34.9 | 77.2・80.2 | 37.9・37.4 |
| 対応仕様説明書 HTML と CSS 編 | 148 | 75.8・70.8 | 53.3 | 136.5・135.3 | 80.5・71.2 |
| 対応仕様説明書 XSL-FO 編 | 100 | 31.8・32.3 | 34.4 | 69.7・89.0 | 31.8・34.8 |
| 文だけの HTML | 215 | 46.0・42.9 | 42.7 | 110.3・106.1 | 46.0・44.3 |
| 目次のある文だけの HTML | 252 | 53.1・50.5 | 50.8 | 129.0・116.3 | — |

## PDF だけを作る (typesetToPdf)

`typesetToPdf(text, options, pdfOptions)` は PDF だけを作ります。`typeset` の後に `toPdf(pdfOptions)` を呼ぶのと同じ PDF・警告・ページ数になります。

- 結果は `{ pdf, pageCount, warnings, diagnostics, layoutMs, truncated }` です (型は `TypesetPdfResult`)。`areaTree`・`renderPage` はありません。
- `pdfOptions` の型は `TypesetPdfOptions` で、`toPdf` の `PdfOptions` に `lowMemory` を追加したものです。`lowMemory: true` で、メモリを節約して組みます (コマンドの `--low-memory` と同じ)。
- ページを 1 枚ずつ組んだ結果 (Area Tree) にして PDF に書き、書いたページを手放します。文書全体の組んだ結果を持たないので、数千ページの文書で使うメモリが少なくなります。
  その代わり、ページの組んだ結果を、使うフォント・画像を集めるときと描画するときの 2 度作ります。
- 組みながら、確定したページを PDF に描画し、そのページの組版の途中の結果を手放します
  (確定したページは、そのページまでの本文と柱が、まだ組んでいない所への参照 (目次などの前向きのページ番号の参照・総ページ数) を引いていないページです)。
  画像は、組む前に PDF に入れる形に用意しておき (PNG の展開と圧縮など)、初めて使うページを描画する直前に PDF に入れます (0.8.0 から。前は、画像・カラーフォントのある文書は組みながら描画しませんでした)。
  置く大きさで中身が変わる画像 (`imageMaxDpi` で縮める JPEG・ブラウザーで PNG に直してから入れる GIF・BMP・WebP・TIFF・filter をピクセルで計算する SVG・`systemLanguage` のある SVG) と、
  PDF の画像のある文書は、組み終えてから描画します。ビットマップの色つきの字形 (CBDT・sbix など) のある字のページから後ろも、組み終えてから描画します (使う字形は、組み終えるまで分からないため)。
  文の多い文書で、組版の間のメモリが少なくなります (文だけの 1,600 ページの文書で、組版の間の生きているヒープの山が 525MB から 127MB に、RSS の山が 1,054MB から 564MB に下がりました。`scripts/measure-memory.mjs`、Node 22)。組みながら描画したページの組んだ結果は、1 度だけ作ります。
  前向きの参照を引いたページから後ろと、段組・最後のページのマスター・ページごとの脚注番号の page-sequence から後ろは、組み終えてから描画します。
  索引のある文書・PDF/X・PDF/A・OS のフォント (`systemFonts`) を使う文書・`maxPages`・メモリ節約 (`lowMemory`) と、Typesetter が `typeset` で前の文書の組版をキャッシュしているとき
  (前の文書のページを再利用します) は、組みながら描画しません。出来る PDF は、組みながら描画してもしなくても同じです
  (どの書き出しでも、フォントと画像は、初めて使うページの直前で PDF に入れます。PDF/X・PDF/A と、上の、組み終えてから描画する画像のある文書は、描画する前に全部を入れます)。
- PDF だけを作るときは、用意し終えた画像の中身を、画像の格納先から手放します (`files`・`resolveResource` で渡した中身は、コピーせずに持つので、呼ぶ側が持つ分は残ります)。
- `layoutMs` は、ページを組んだ結果にする時間を含みません (PDF を書く時間に入ります)。組みながら描画したときは、そのページを描画する時間を含みます。
- Node のコマンドも、これで PDF を作ります。`createTypesetter()` のタイプセッターにも `typesetter.typesetToPdf(text, options, pdfOptions)` があります。

## PDF をストリームで書き出す (typesetToPdfStream)

`typesetToPdfStream(text, options, output, pdfOptions)` は、`typesetToPdf` と同じ組み方で、PDF をページごとに書き出し先 `output` へストリームで書き出します。
PDF の全体を 1 つの `Uint8Array` に持たないので、画像の多い文書で、PDF を書く間のメモリが少なくなります。

- 書き出し先 (型は `PdfOutput`) は、`WritableStream` か、バイト列の塊 (`Uint8Array`) を受ける関数です。関数が `Promise` を返したら、次の塊を渡す前に待ちます。
  値を返さなければ待ちません。渡した塊は、渡した後に書き換えません。
- 結果は `{ bytes, pageCount, warnings, diagnostics, layoutMs, truncated }` です (型は `TypesetPdfStreamResult`。`typesetToPdf` の結果の `pdf` の代わりに、書いたバイト数 `bytes`)。
- 組んだ結果からは `result.toPdfStream(output, pdfOptions)`、タイプセッターからは `typesetter.typesetToPdfStream(text, options, output, pdfOptions)` で同じように書けます。
  `toPdfStream` は組んだ結果を持ったままなので、下がるのは PDF の側のメモリだけです。
- 書き終えたストリーム (画像・ページの中身・SVG の描画内容など) を、埋め込んだ所・ページを描画し終えた所で書き出し先へ書きます。フォント (サブセットフォントは全部のページの文字を見てから作る)・注釈・フォームフィールド・しおり・構造ツリーなどは、最後に書きます。
  書き出し先へは、64KB までためてから渡します。
- 出来る PDF は `typesetToPdf` と同じです。ふつうは 1 バイトも違いません。タグ付き PDF で、不透明度のあるボックスの中に文字がある文書など
  (中にマーク付きコンテンツを持つ Form XObject が後から辞書に追記される文書) では、その Form をファイルの後ろに書くので、オブジェクトの並びと位置の数だけが違います (番号ごとのオブジェクトの中身は同じ)。
- `WritableStream` の扱いは、`ReadableStream.pipeTo` の既定と同じです: 書くたびにライターの `ready` を待ち (遅い書き出し先では、ページの間で待ちます)、書き終えたら `close()`、
  エラー・止めるシグナルで終えたら `abort(理由)` を呼び、終えたらライターのロックを放します。書き始める前のエラー (オプションのエラー・PDF/X・PDF/A・前に止めたシグナル・フォントの読み込みのエラー) でも `abort(理由)` を呼びます。
  ほかのライターがロックしている `WritableStream` と、`WritableStream` でも関数でもない書き出し先は `KumioriOptionError` (`option` は `output`) で、書き出し先には触りません。
- 止めるシグナル (`options.signal`) で止めたり、組版がエラーになったりしたときは、返す `Promise` がその理由で失敗します。書き出し先には途中までのバイト列が残り、PDF としては読めないので、捨ててください。
  書き出し先がエラーになったとき (関数が投げた・`Promise` が失敗した・`WritableStream` の書き込みが失敗した) は、組版と書き出しを止め、そのエラーを包まずに投げます (`abort` は呼びません)。
- PDF/X・PDF/A (`pdfOptions.pdfx`・`pdfa`) はストリームで書き出せません。書いた PDF の全体を読み直して確認し、合わなければ PDF を返さないためです。渡すと、何も書く前に `KumioriOptionError`
  (`option` は `pdf.pdfx`・`pdf.pdfa`。`toPdfStream` では `pdfx`・`pdfa`) になります。`typesetToPdf`・`toPdf` を使ってください。PDF/UA-1 とタグ付き PDF はストリームで書き出せます。
- メモリ節約 (`lowMemory`) と合わせて使えます。メモリ節約の組版はページの間で待てない所があるので、`Promise` を返す書き出し先・`WritableStream` では、待てる所まで塊をためます。
  メモリ節約と合わせるときは、値を返さない関数 (Node の `fs.writeSync` など) を勧めます。
- ストリームで書き出すことで下がるのは、PDF の側のメモリです。測った値 (`scripts/measure-memory.mjs`。Node 22): 画像の多い文書 (圧縮の効かない PNG 200 枚、PDF 196MB) で、PDF を書く間の外のバイト列 (`arrayBuffers`) の山が 660MB から 266MB に、
  RSS の山が 1,176MB から 961MB に下がりました。0.8.0 では、画像の格納先が渡された画像をコピーしないので、組む前に画像を読み込む所の山 (約 780MB。測る側が初めから持つ 533MB を含む) も 574MB に、RSS の山が 744MB に下がりました。
  文の多い文書の山は組版の途中の結果にあり、`typesetToPdf` と同じく、組みながら確定したページを描画して手放すことで下がります (文だけの 1,600 ページの文書で、組版の間の生きているヒープの山が 525MB から 127MB に、RSS の山が 1,054MB から 564MB に下がりました。`scripts/measure-memory.mjs`、Node 22)。

Node でファイルに書く例:

```ts
import fs from 'node:fs';
import { Writable } from 'node:stream';
import { typesetToPdfStream } from 'kumiori';

// WritableStream にして渡す (Node の Writable は、じかには受けない)
await typesetToPdfStream(html, { name: 'book.html' }, Writable.toWeb(fs.createWriteStream('book.pdf')));

// 同期で書く関数を渡す
const fd = fs.openSync('book.pdf', 'w');
try {
  await typesetToPdfStream(html, { name: 'book.html' }, (chunk) => {
    // writeSync は、書けたバイト数を返す (ふつうのファイルでは、まず全部書ける)
    for (let at = 0; at < chunk.length; ) at += fs.writeSync(fd, chunk, at);
  });
} finally {
  fs.closeSync(fd);
}
```

ブラウザーでは、保存の窓のライター (`await (await showSaveFilePicker()).createWritable()`) が `WritableStream` なので、そのまま渡せます。
`ReadableStream` が欲しいときは、`TransformStream` を挟みます。組版のエラーは、読む側では `readable` のエラー (abort) で分かりますが、返す `Promise` も失敗するので、受け手を付けます
(付けないと、Node では受け手の無い失敗 (`unhandledRejection`) で止まります)。

```ts
const { readable, writable } = new TransformStream();
typesetToPdfStream(html, {}, writable).catch((e) => console.error(e)); // エラーは readable の側でも分かる
return new Response(readable);
```

## PDF を暗号化する (encrypt)

PDF の設定 (`toPdf`・`toPdfStream`・`typesetToPdf`・`typesetToPdfStream` の `PdfOptions`) の `encrypt` に渡すと、PDF を AES-256 で暗号化します
(ISO 32000-2 §7.6 の標準セキュリティハンドラーの R 6。PDF 1.7 の見出しで、カタログに Adobe の拡張の印 (ExtensionLevel 8) を書きます)。
Node では `crypto`、ブラウザー・Worker では WebCrypto (キーを作るハッシュ) と、組み込みの AES の計算で暗号化します (どちらも結果は同じ)。ストリームで書き出す出力でも使えます。
1.0 までに形を変えることがあります。

```ts
const { pdf } = await typesetToPdf(html, { loadFont }, {
  encrypt: { userPassword: '開くときのパスワード', ownerPassword: '権限を外すパスワード', permissions: { print: false, copy: false } },
});
```

`encrypt` (型は `PdfEncryptOptions`):

| フィールド | 中身 |
| --- | --- |
| `userPassword` | 開くときのパスワード (利用者のパスワード)。無ければ空で、パスワード無しで開けて、`permissions` の制限だけが付く |
| `ownerPassword` | 権限を外して開くパスワード (所有者のパスワード)。無ければ乱数で、権限を外して開ける人はいない。`userPassword` と同じにすると、開いた人は誰でも権限を外せる。空 (SASLprep で何にも写さない文字だけのものも) はエラー (誰でもパスワード無しで開けるため) |
| `permissions` | 許すこと (型は `PdfPermissions`。下の表。書かない権限は許す) |

パスワードは、SASLprep (RFC 4013) で正規化した UTF-8 の、初めの 127 バイトを使います (ISO 32000-2 §7.6.4.3.2。全角の英数字は半角になります)。制御文字・私用の文字などは使えず、`KumioriOptionError` (`option` は `encrypt.userPassword` など) になります。

`permissions` (ISO 32000-2 §7.6.4.2 の Table 22。どれも真偽値で、既定 `true`):

| フィールド | 許すこと |
| --- | --- |
| `print` | 印刷 (bit 3) |
| `modify` | 中身の変更 (bit 4。注釈・フォーム・組み立てを除く) |
| `copy` | 文字と図のコピー・抜き出し (bit 5) |
| `annotate` | 注釈の追加・変更と、フォームの入力 (bit 6) |
| `fillForms` | フォームの入力 (bit 9。`annotate` が `false` でも入力だけを許す) |
| `accessibility` | 支援技術 (スクリーンリーダーなど) のための抜き出し (bit 10)。PDF/UA (`pdfua`) では外せず、`false` にすると警告 `pdfua/encrypt-accessibility-kept` を出して許したままにする。ISO 32000-2 はこのビットを廃止の扱いとし、読むソフトは無視するので、`false` が効かないソフトもある |
| `assemble` | 文書の組み立て (bit 11。ページの挿入・回転・削除、しおりの作成) |
| `printHighQuality` | 高品質の印刷 (bit 12。`false` なら粗い印刷だけを許す) |

- PDF/X (`pdfx`)・PDF/A (`pdfa`) とは一緒に使えません (どちらの規格も暗号化を許しません)。一緒に渡すと、組む前に `KumioriPdfError` (`code` は `pdf/encrypt-incompatible`) を投げます。
- 暗号化した PDF は、初期ベクトル・ソルトが乱数なので、同じ入力・同じ `date` からも毎回違うバイト列になります。文書の ID も乱数にします (暗号化しない PDF は、いままでどおり中身から作ります)。
- 権限に従うかどうかは、PDF を読むソフトによります (守らないソフトもあります)。中身を見せたくないときは、`userPassword` を付けてください。
- コマンドでは `--encrypt`・`--user-password`・`--owner-password`・`--deny` です ([`docs/cli.md`](cli.md))。

## 文書を作らずに文字列を測る (measureText・breakLines)

`createTypesetter` の `Typesetter` の `measureText(text, style)` と `breakLines(text, style, width)` で、文書を作らずに、文字列の長さ・行分け・行数を測れます
(テンプレート・エディタで、名前や見出しが枠に収まるかを先に知るときなど)。フォントは Typesetter が読み込んだもの (既定のフォント・`fonts`・`systemFonts`) を使います。
1.0 までに形を変えることがあります。

```ts
const t = await createTypesetter({ loadFont });
const one = await t.measureText('組版の見出し', { fontSize: 18, fontWeight: 700, fontFamily: 'sans-serif' });
one.inlineSize; // 1 行で組んだ長さ (pt)
const lines = await t.breakLines(text, { fontSize: 10.5, lang: 'ja' }, 120);
lines.lineCount; // 120pt の幅での行数
lines.blockSize; // 全体の高さ (pt)
lines.lines.map((l) => l.text); // 行ごとの文字
```

- 中では、文字列を 1 つのブロック (HTML の `div`) だけの文書にして、同じ Typesetter で組み、できた行を読みます。なので、行分け (禁則・ぶら下げ・ハイフネーション・字間の調整)・フォントの選び方・カーニングは、文書の中で同じ文字列・同じスタイルを、内容の幅が `width` のブロックに組んだときと同じになります。1 回あたり、小さな文書を組むのと同じコストがかかります (数 ms〜十数 ms)。
- 測っても、Typesetter の再利用 (`reuse`) のキャッシュ (前の文書のページ・行分け・フォントの下ごしらえ) は変えません。
- `measureText` は行を分けずに組みます (`whiteSpace` が `pre`・`pre-wrap`・`break-spaces`・`pre-line` なら、改行でだけ分けます)。`breakLines` は、行の長さ `width` (pt。0 より大きく 14400 以下) で分けます。
- 指定の無いプロパティは、Kumiori の HTML の既定のスタイルの本文と同じです (10pt・`line-height: 1.75`・serif・`text-align: justify`・`hanging-punctuation: allow-end`)。段落の字下げは付けません (`textIndent` で付けます)。

`style` (型は `TextStyle`。CSS のプロパティを camelCase にした名前。値は CSS の値の文字列で、長さは数でも書けて、数は pt):

| フィールド | 中身 |
| --- | --- |
| `fontFamily`・`fontSize`・`fontWeight`・`fontStyle`・`fontStretch`・`fontKerning`・`fontFeatureSettings`・`fontVariantEastAsian` | フォントの指定。`fontSize` の数は pt、`fontWeight` の数は CSS の太さ (400・700 など) |
| `letterSpacing`・`wordSpacing` | 字間・語間 (数は pt) |
| `lineHeight` | 行の高さ。数は CSS と同じく倍率 (文字の大きさに掛ける)。`'14pt'` のような長さも書ける |
| `lang` | 言語のタグ (`ja`・`en` など)。禁則・ハイフネーション・字形の選び方に効く |
| `writingMode`・`textOrientation`・`direction` | 書字方向。縦書き (`vertical-rl`・`vertical-lr`) では、行の長さは縦の長さ |
| `textAlign`・`textAlignLast`・`textJustify`・`textIndent` | 行揃え・字下げ (`textIndent` の数は pt) |
| `whiteSpace`・`wordBreak`・`lineBreak`・`overflowWrap`・`hyphens`・`hangingPunctuation`・`textSpacingTrim`・`textAutospace` | 空白・行分け・約物の扱い |

ほかの名前、CSS の宣言の外に出る文字 (`;`・`{`・`}`・`<`・`>`・`\`)・コメント・`url()` は、`KumioriOptionError` (`option` は `style.<名前>`) です。

結果 (型は `MeasuredText`):

| フィールド | 中身 |
| --- | --- |
| `lineCount` | 行の数 |
| `inlineSize` | いちばん長い行の `inlineSize` (pt) |
| `blockSize` | 行の `blockSize` の合計 (pt。全体の高さ。縦書きでは全体の幅) |
| `width`・`height` | 紙の上の幅と高さ (pt。横書きは `inlineSize`・`blockSize`、縦書きは `blockSize`・`inlineSize`) |
| `overflow` | `breakLines` で、`width` を超えた行があるか (分けられない長い語・ぶら下げた約物など)。`measureText` では `false` |
| `lines` | 行の並び (型は `MeasuredLine`。下) |

行 (型は `MeasuredLine`):

| フィールド | 中身 |
| --- | --- |
| `text` | 行の文字 (組んだ順。行末で語を分けたハイフンを含み、行の初め・終わりで除いた空白は含まない) |
| `inlineSize` | 行の中身の、行の進む方向の長さ (pt。最初の文字の始まりから最後の文字の終わりまで。字間・カーニング・ぶら下げた約物を含む)。両端揃えの、最後でない行は `width` いっぱいになる |
| `blockSize` | 行の高さ (pt。`line-height` で決まる。縦書きでは行の幅) |

## 組版を止める・進捗 (signal・onProgress)

`signal` (`AbortSignal`) を渡すと、組版を途中で止められます。`onProgress` を渡すと、進捗を受け取れます。
エディタのプレビューで、打つたびに前の組版を止めて組み直すときや、サーバーで 1 つの文書にかける時間を区切るときに使います。
どちらも省けば、前と同じに動き、速さも変わりません。

```ts
let current: AbortController | undefined;
async function preview(html: string) {
  current?.abort();                                   // 前の組版を止める
  const ac = (current = new AbortController());
  try {
    const r = await typesetter.typeset(html, { name: 'a.html', signal: ac.signal, onProgress: (p) => showProgress(p) });
    draw(r);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e; // 止めたのはエラーではない
  }
}
```

- 止めると、返す Promise は `signal.reason` で失敗します。理由を渡さずに `abort()` したときは、`AbortError` の名前の `DOMException` です
  (`fetch` と同じ。`AbortSignal.timeout(ms)` なら `TimeoutError`)。Kumiori のエラーの型 (`KumioriError`) には包みません。
- 止めたシグナルを渡せば、何も読まずに失敗します。シグナルは、フォント・リソースを読むたびと、ページを組むたびに確認し、読みかけの取得 (`fetch`) も止めます。
  `resolveResource`・`loadFont` には、2 つ目の引数で `{ signal }` (その呼び出しのシグナルと `fetchTimeoutMs` の時限を合わせたもの) を渡すので、自分で読む取得にも渡せます。
  ただし、タイプセッター (`createTypesetter`) が文書によって初めて読むフォント (数式・等幅・記号・絵文字) は、同じタイプセッターで同時に組むほかの呼び出しも待つので、`loadFont` には時限だけのシグナルを渡し、
  止めた呼び出しは、その読み込みを待つのをやめるだけです (読み込みは続き、ほかの呼び出しは、そのフォントで組みます)。
- 組版は同期の処理が長いので、`signal` か `onProgress` を渡したときは、段階の境界 (リソースの読み込み・組み直しの回・page-sequence・PDF のページ) で
  イベントループに制御を返し、ほかの処理 (画面の再描画・`abort()` の呼び出し) が走れるようにします。
  ただし、1 つの page-sequence (HTML は、名前付きページで分けなければ文書全体) を組む間はイベントループに制御を返さないので、外からの `abort()` は、その組み終わりで効きます
  (151 ページの HTML で数秒)。すぐ止めたいときは、`onProgress` の中で `abort()` を呼ぶか (コールバックはページごとに同期で呼ぶので、その場で止まる)、
  [Web Worker](#web-worker-の中で組む) で組んで Worker ごと止めます (`worker.terminate()`)。

  ```ts
  const deadline = Date.now() + 10_000;               // 10 秒で止める (ページごとに確認する)
  const ac = new AbortController();
  await typeset(html, { signal: ac.signal, onProgress: () => Date.now() > deadline && ac.abort() });
  ```

- 止めた後も、タイプセッター (`createTypesetter`) はそのまま使えます。止めた文書は、タイプセッターが文書をまたいでキャッシュするもの (段落の行分けなど) の世代に数えないので、
  止める前に組み終えた文書のキャッシュが、次の文書でも当たります。
- 結果の `toPdf`・`renderPageToSvg`・`renderPageToPng` は、組んだときのシグナルを引き継ぎません。それぞれの設定に `signal` (`toPdf` は `onProgress` も) を渡します。
  `typesetToPdf` は、組む設定 (`options`) の `signal`・`onProgress` が PDF の書き出しまで効きます (PDF の設定 (3 つ目の引数) には渡せません。渡すと `KumioriOptionError`。`option` は `pdf.signal`・`pdf.onProgress`)。`createTypesetter` の `setup.signal`・`setup.onProgress` は、タイプセッターを作る間だけ効きます。

`onProgress` は、次の形の値を同期で受け取ります (型は `TypesetProgress`)。投げたエラーは、組版を止めて、そのまま返す Promise の失敗になります。止めた後 (止めるシグナル・投げたエラー) は、並べて読んでいたリソースが後から読み終えても、`onProgress` を呼びません。

| `phase` | いつ | ほかのフィールド |
| --- | --- | --- |
| `fonts` | フォントを 1 つ読むたび (タイプセッターを作るときと、`typeset`・`typesetToPdf` の初め) | `loaded` (読んだ数)・`total` |
| `resources` | 文書のリソース (`resolveResource` の答え・XSL-FO のフォント・画像のファイルなど) を 1 つ読むたび | `loaded` |
| `import` | 文書の読み込み・カスケードの初めに 1 回 | |
| `layout` | ページを 1 枚作るたび | `pass` (組み直しの回。1 から)・`pages` (その回で作ったページの数。条件付きのページのマスターや段組の釣り合わせで組み直すと減ることがある。最後の回の最後の値がページ数) |
| `pdf` | PDF のページを 1 枚書くたび | `pages` (書いたページの数)・`total` (総ページ数) |

段階はこの表の順に来ます (使わない段階は飛ばします)。

## 先頭の数ページだけを組む (maxPages)

`maxPages: N` を渡すと、先頭から N ページまで組んだところで止めます。長い文書の初めの数ページのプレビューに使います。

```js
const r = await typesetter.typeset(html, { name: 'book.html', maxPages: 3 });
r.pageCount; // 3 (文書が 3 ページ以下なら、そのページ数)
r.truncated; // 途中で止めたら true
```

- 止めたら、結果の `truncated` が `true` になり、組んだ結果 (`areaTree`) に `truncated: { maxPages: N }` が付き、info の診断 `layout/max-pages-reached` が出ます。
  文書が N ページ以下なら止めず、`maxPages` を渡さないときと同じ結果です (`truncated` は `false`)。`typesetToPdf` (`lowMemory` も)・タイプセッターの `typeset`・`typesetToPdf` でも同じです。
- N ページより後ろのことは分からないので、次のものは決まりません。決まらないものは種類ごとに 1 件、警告 `layout/beyond-max-pages` を出します。
  - N ページより後ろにある所を指すページ番号の参照 (XSL-FO の `page-number-citation`・CSS の `target-counter()` など) と、N ページより後ろへ続く要素の最後のページの番号
    (`page-number-citation-last`): `"?"` で組みます (`--style weasyprint` の組み方では空。見つからない id と同じ文字)。
  - 総ページ数 (CSS の `counter(pages)`・柱の総ページ数): `"?"` で組みます。
  - 索引の並び: N ページまでの所だけを並べます。
  - しおり: N ページより後ろを指すしおりは、リンク先の無いしおりにします (タイトルは残す)。文書の中のリンクは、リンク先の無いリンクとして書きません。
  - 文書に無い id は、いまのとおり `layout/missing-id` です。
- 残した 1〜N ページの組み (行分け・改ページ) は、本文に N ページより後ろを指すもの (ページ番号の参照・最後のページの番号・本文の中の総ページ数・索引の並び) が無ければ、
  全体を組んだときの 1〜N ページと同じです。ページ N は、次のページを作る前に決まっていて、後から変わらないからです (N + 1 ページ目まで組んで、後ろへ続く要素を見分けます)。
  - 柱 (XSL-FO の static-content・CSS のページの余白のボックス) の中だけの参照は、その文字が `"?"` になるだけで、本文の組みは同じです。
  - 本文に N ページより後ろを指す参照があると、その文字が `"?"` になるうえ、本当の数との幅の違いで、その行の分け方が変わり、後ろの行と改ページがずれることがあります
    (リーダーの後ろに番号を置く目次は、幅の違いをリーダーが吸うので、まず変わりません。本文の中の「…ページを見よ」や、リーダーの無い目次は変わることがあります)。
- 速くなるのは、組版と PDF の書き出しの分です。文書の読み込みとカスケード (HTML・XSL-FO を組版の木にする所) は、文書の全体で行います。
  ページ番号の参照を決める組み直しの回は、どの回も N ページで止めます。
- タイプセッター (`createTypesetter`) で組むと、止めた文書でも、段落の行分けなどのキャッシュは残しますが、キャッシュの世代 (前の文書で使ったものを残す数え方) は進めません。
  プレビューを何度組んでも、前に全体を組んだ文書のキャッシュを捨てません。
- `maxPages` は上限 (`limits`) ではありません。超えてもエラーにせず、そこまでの結果を返します。決まったページ数を超える文書を拒否したいときは、`truncated` を見て拒否します。

## ファイルと外部のリソース

### resolveResource

`resolveResource(url)` は、文書・CSS が参照するファイル (`<link rel="stylesheet">`・`@import`・`url()`・`<img src>` など) のうち、`files` に無いものを問い合わせる関数です。

- `url` は書かれた参照 (`file:///…/a.css`・`img/a.png`・`https://…`) です。CSS の中の相対参照は、その CSS の URL を基準に解決したものです。
- 中身 (文字列・`Uint8Array`・`ArrayBuffer`) を返せば、それを使います。`undefined` ならこれまでどおりです (`http(s):` の画像・CSS はネットワークから取得する)。
- 参照を書き換えて `files` に入れ直す必要がありません。
- 画像は、URL に拡張子が無くても (`https://example.com/img?id=1` など)、返した中身の先頭のバイト列で画像と見分けて使います。
- 2 つ目の引数に `{ signal }` を渡します (その呼び出しの止めるシグナルと、`fetchTimeoutMs` の時限を合わせたもの)。自分で取得するときに渡せば、組版を止めたときに一緒に止まります ([組版を止める・進捗](#組版を止める進捗-signalonprogress))。

Node では、`kumiori/node` の `createFileResolver()` が、`file:` の URL のファイルを読む `resolveResource` を作ります ([Node のモジュール](#node-のモジュール-kumiorinode))。

### fetchImages・fetchStyles と転送

`fetchImages`・`fetchStyles` に渡す関数には、文書に書かれた URL のほか、転送 (redirect) の先の URL も聞きます。

- Node では、転送を 1 つずつ確認してたどり (20 回まで)、許されない先へは要求を出しません。
- `https:` から `http:` への転送と、`http(s):` でない先への転送は、関数に聞かずに拒否します (真偽の `true` のときも同じ)。
- ブラウザーでは、転送の先をスクリプトから前もって読めないので、たどった後の最後の URL を関数に聞き、許されなければ応答を使いません (このとき、要求そのものは転送の先に届いています)。
- 関数が見るのは URL の文字列だけです。内部のアドレスに解決されるホスト名 (DNS rebinding を含む) は、関数では防げません。他人の書いた文書をサーバーで組むときに内部のネットワークを守るには、実行環境の側 (外向きの通信の制限・外向きのプロキシ) でも絞ってください。

ネットワークから取得するものの大きさには上限があります。

| リソース | 上限 |
| --- | --- |
| 画像 | 256MB |
| CSS | 16MB |
| フォント | 128MB |

超えたものは、読むのを途中でやめて、読めないリソースとして扱います (`Content-Length` の無い応答でも同じ)。
サーバーで組むときの、時間とメモリの上限のかけ方は、[`docs/cli.md`](cli.md) の「外部の取得と読み込みの安全」と「上限とメモリ」にあります。

## 入力の上限 (limits)

Kumiori は、小さな入力で時間とメモリを使い切らせないように、画像のピクセルの数・ファイルの大きさ・入れ子の深さ・組む計算量などに上限を置いています。
`limits` のオプションで、その上限を変えられます (コマンドでは `--limit <名前>=<値>`。[`docs/cli.md`](cli.md) の「上限とメモリ」)。

```ts
const r = await typeset(html, { limits: { imagePixels: 200_000_000, fileBytes: 1024 ** 3 } }); // 信頼できる大きな文書を組む
const s = await typeset(html, { limits: { nestingDepth: 64, pngPixels: 4_000_000 } });      // サーバーで、もっと絞る
```

- 渡さない名前は既定の値です。何も渡さなければ、前と同じに動き、組版の結果も同じです。
- 値は 1 以上の整数です。時間・大きさの上限は上げ下げでき、入れ子の深さの上限 (表の「下げるだけ」) は下げることだけができます。
  入れ子の深さの上限は、深い入れ子でスタックを使い切って文書の全体が組めなくなるのを防ぐもので、上げられません。
- 知らない名前・1 以上の整数でない値・下げるだけの上限を既定より大きくした値・表の上限の天井 (V8 の文字列の長さなど、実装が扱える大きさ) を超える値は、
  組まずに `KumioriOptionError` (`option` は `limits.<名前>`) になります。
- `nestingDepth` の既定の 300 は、いちばん大きい種類 (MathML・変換の入れ子) の値です。**実際の既定は種類ごと**で、HTML は 128、XSL-FO と SVG は 250、
  draw.io の図の XML は 256 です (HTML が 300 段まで組めるわけではありません)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効きます。
  `cssNesting` も同じで、既定の 64 はいちばん大きい種類 (規則の入れ子・`@supports`・`calc()`) の値です。`@layer` の名前・数学の関数・セレクター・SVG の `calc()` の入れ子は 32 です。
- 上げても、ファイルの大きさによる制約 (形式ごとの符号の密度・展開の比) は変わりません。上げた上限まで使えるのは、それに見合う大きさのファイルだけです
  (`imagePixels` を上げても、数十バイトの GIF から 1 億ピクセルの画像は作れません)。
- 上げた上限があれば、情報 (重大度 info) の診断 `limit/raised` を 1 件出します (`args.limits` に、上げた名前と値)。
- `createTypesetter(setup)` の `setup.limits` は、タイプセッターのフォントの読み込みに当て、文書ごとの既定になります。`Typesetter.typeset` の文書ごとの `limits` は、タイプセッターの `limits` の上に名前ごとに重ねます。
  タイプセッターは、上限の違う文書では、前の文書のキャッシュ (フォントの下ごしらえ・段落の行分け) を再利用しません。
- 組んだ結果の `toPdf`・`renderPage`・`renderPageToSvg`・`renderPageToPng` は、組んだときの `limits` を使います (描画するときの引数では受けません)。
- プラグインの `load` の文脈 (`ImageFormatContext`) の `limits` に、既定で埋めた上限を、読むだけのものとして渡します。結果の大きさ・SVG の長さ・時限は、Kumiori の側でも `format*` の上限で確認します。
- 同時に走る呼び出し (待たずに重ねた `typeset`) の上限は混ざりません (上限は呼び出しごとの文脈に持ちます)。
- ⚠️ 上限を上げると、1 つの文書が使える時間とメモリは、上げた分だけ増えます (`imagePixels` を 2 倍にすると、1 枚の画像の RGBA が 800MB になり、組むのも 2 倍ほどかかる)。
  既定の上限は、他人の書いた文書を、Node の既定のヒープ (多くて約 4GB) の中で落ちずに組めるように選んだものです。上げるときは、ヒープ (`node --max-old-space-size=…`)・コンテナーのメモリ・時限を、それに合わせて外でかけてください。
  上げた上限の中で時間とメモリを多く使うことは、脆弱性として扱いません ([`SECURITY.md`](../SECURITY.md))。

上限の一覧 (`kumiori --list-limits` でも出ます)。説明の「(説明のとおり)」の既定は、ほかの値から決まります。

| 名前 | 既定 | 上げ下げ | 何の上限か |
| --- | --- | --- | --- |
| `imagePixels` | 100,000,000 | 上げ下げ | 1 枚の画像のピクセルの数 (EPS の画像の合計、PNG に書き出すときにキャッシュする画像も) |
| `fileBytes` | 256MB | 上げ下げ | 渡したファイル 1 つ・取得する画像 1 件の大きさ (バイト。画面で EPUB を読むときの 1 項目の大きさにも使う。画面では既定の値) |
| `cssBytes` | 16MB | 上げ下げ | 取得する CSS 1 件の大きさ (バイト) |
| `fontBytes` | 128MB | 上げ下げ | 取得するフォント 1 件・WOFF を戻したフォントの大きさ (バイト) |
| `fontCollectionBytes` | 1GB | 上げ下げ | フォントの集まり (TTC・OTC) から取り出すフォントの合計 (バイト) |
| `systemFontFaces` | 16 | 上げ下げ | 1 つの文書で使う OS のフォントの数 (systemFonts) |
| `imageFetchTotalMs` | (説明のとおり) | 上げ下げ | 文書の画像の取得の全体の時限 (ミリ秒。既定は fetchTimeoutMs の 10 倍) |
| `redirects` | 20 | 下げるだけ | 転送 (redirect) をたどる回数 |
| `styleRefs` | 500 | 上げ下げ | 集める CSS・フォントの参照の数 |
| `importDepth` | 8 | 下げるだけ | 取得する CSS の @import の段の数 |
| `importedCssChars` | 8,388,608 | 上げ下げ | @import で広げた CSS の長さの合計 (文字) |
| `cssImports` | 10,000 | 上げ下げ | @import の数 |
| `formatSize` | 10,000,000 | 上げ下げ | 画像の形式 (プラグイン・draw.io) の結果の幅・高さ (px。draw.io の図の大きさ・座標も) |
| `formatSvgChars` | 134,217,728 | 上げ下げ | 画像の形式の結果の SVG の長さの絶対の上限 (文字。ファイルの大きさによる制約は変えない) |
| `formatLoadMs` | 60,000 | 上げ下げ | 画像の形式の読み込みの時限 (ミリ秒。これに fetchTimeoutMs の 3 倍を足す) |
| `formatFragments` | 64 | 上げ下げ | 1 つのファイルを # の後ろの違う参照で読む数 |
| `pdfImageObjects` | 1,000,000 | 上げ下げ | 1 つの PDF の画像の間接オブジェクトの数 |
| `pdfImagePages` | 100,000 | 上げ下げ | 1 つの PDF の画像のページの数 (ページツリーをたどる数) |
| `pdfImageDepth` | 64 | 下げるだけ | PDF の画像のページツリーの段・リソースの入れ子の深さ |
| `pdfImageStreamBytes` | 256MB | 上げ下げ | PDF の画像の 1 つのページ (ページの範囲は、範囲の全体) で圧縮を解くストリームの合計 (バイト) |
| `pdfImageLoadMs` | 60,000 | 上げ下げ | 1 つの PDF の画像を読み込む時限 (ミリ秒。ページの範囲の埋め込みは、範囲の全体で) |
| `pdfImageRangePages` | 64 | 上げ下げ | PDF の画像のページの範囲 (互換の指定の `page=2-5`・`all` など) で並べるページの数 |
| `epsMs` | 20,000 | 上げ下げ | 1 つの EPS の実行の時限 (ミリ秒) |
| `epsDocumentMs` | 60,000 | 上げ下げ | 1 つの文書の EPS の実行の時間の合計 (ミリ秒) |
| `epsMemoryBytes` | 512MB | 上げ下げ | 1 つの EPS のメモリの合計と VM の上限 (バイト) |
| `epsPathPoints` | 5,000,000 | 上げ下げ | 1 つの EPS のパスの点の合計 |
| `epsImagePixels` | 64,000,000 | 上げ下げ | EPS の image 1 枚のピクセルの数 |
| `epsSvgChars` | 134,217,728 | 上げ下げ | EPS・メタファイル・CGM を SVG にした長さの絶対の上限 (文字) |
| `metafileImagePixels` | 64,000,000 | 上げ下げ | WMF・EMF・CGM の画像のピクセルの合計の絶対の上限 (ファイルの大きさによる制約は変えない) |
| `metafileClipWork` | 50,000,000 | 上げ下げ | WMF・EMF のクリッピングの演算の計算量 (パスのクリッピングの点の数も同じ比で動かす) |
| `epubTotalBytes` | 1GB | 上げ下げ | 1 つの EPUB を展開する量の合計 (バイト) (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、`limits`・`--limit` で変えても効かない) |
| `epubEntries` | 65,535 | 下げるだけ | EPUB の項目の数 (zip の項目・章の並び) (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、`limits`・`--limit` で変えても効かない) |
| `epubTextChars` | 134,217,728 | 上げ下げ | EPUB の章と CSS の文字の数の合計 (画面で EPUB を読むときだけ使う。画面では既定の値。API・コマンドは EPUB を読まないので、`limits`・`--limit` で変えても効かない) |
| `nestingDepth` | 300 | 下げるだけ | 要素の入れ子の深さ。既定の 300 は、いちばん大きい種類の値で、実際の既定は種類ごと (HTML 128・XSL-FO 250・SVG 250・MathML 300・変換の入れ子 300・draw.io 256)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く (HTML が 300 段まで組めるわけではない) |
| `cssNesting` | 64 | 下げるだけ | CSS の入れ子の深さ。既定の 64 は、いちばん大きい種類の値で、実際の既定は種類ごと (規則の入れ子・@supports・calc() 64、@layer の名前・数学の関数・セレクター・SVG の calc() 32)。値を渡すと、種類ごとの既定とその値の小さい方を使うので、下げると全部の種類に効く |
| `entityDepth` | 8 | 下げるだけ | XML の内部実体の入れ子の深さ |
| `entityChars` | 134,217,728 | 上げ下げ | XML の内部実体の展開で増える文字の数 |
| `nestedSelectors` | 10,000 | 上げ下げ | CSS の入れ子の規則を展開したセレクターの数 |
| `selectorWork` | 30,000,000 | 上げ下げ | セレクターの照合のキャッシュの計算量 |
| `diagnosticsPerCode` | 200 | 上げ下げ | 同じ名前の診断の数 (超えた分は「ほかに n 件」にまとめる) |
| `tableColumns` | 1,000 | 上げ下げ | 表の列の数 (col の span・colspan も) |
| `tableSpannedCells` | 20,000 | 上げ下げ | 表の構造で、またがれるマスの数 |
| `leaderRepeats` | 20,000 | 上げ下げ | 1 つのリーダーに並べる文字の数 |
| `mathGlyphs` | 20,000 | 上げ下げ | 1 つの数式の文字の数 |
| `gridTracks` | 10,000 | 上げ下げ | グリッドの列の並びを展開した数 (repeat()) |
| `svgElements` | 500,000 | 上げ下げ | SVG の use で広げた要素の数 |
| `svgPathSegments` | 5,000,000 | 上げ下げ | SVG の広げたパスの区間の数の絶対の上限 (ファイルの大きさによる制約は変えない) |
| `svgCssMatches` | 500,000 | 上げ下げ | SVG の中の CSS の照合の回数 |
| `svgFilterWork` | 400,000,000 | 上げ下げ | SVG の filter をピクセルで計算する計算量 (1 つの SVG) |
| `svgLinksPerPage` | 5,000 | 上げ下げ | 1 ページの SVG のリンク (a) の注釈の数 |
| `pngPixels` | 40,000,000 | 上げ下げ | PNG に書き出す 1 枚のピクセルの数 |
| `pngImageCachePixels` | (説明のとおり) | 上げ下げ | PNG に書き出すときにキャッシュする画像のピクセルの合計 (既定は imagePixels と同じ) |
| `pngPageImagePixels` | 400,000,000 | 上げ下げ | PNG の 1 ページでラスタライズする画像の合計 |
| `pngRasterWork` | 128 | 上げ下げ | PNG の 1 ページをラスタライズする計算量 (1 ピクセルあたり。基本の 6,400 万も同じ比で動かす) |
| `pngLayerPixels` | 64,000,000 | 上げ下げ | PNG を描画する間に同時に持つオフスクリーンのバッファーの大きさ (ピクセルの数) の絶対の上限 (広がるバッファーは、実際に広げた大きさで数える) |
| `canvasSvgPixels` | 16,000,000 | 上げ下げ | 画面 (renderPage) で SVG の画像をラスタライズするときのピクセルの数 |
| `canvasSvgWork` | 8,000,000,000 | 上げ下げ | 画面 (renderPage) で SVG の画像 1 つをラスタライズする計算量 (1 回の描画の合計は、その 4 倍) |
| `flattenPixels` | 36,000,000 | 上げ下げ | PDF/X で透明をフラット化するときの 1 つの画像のピクセルの数 |
| `drawioChars` | 67,108,864 | 上げ下げ | 圧縮した draw.io の図を戻した長さ (バイト) |
| `drawioCells` | 20,000 | 上げ下げ | draw.io の図のセルの数 (XML の要素の数は、その 10 倍) |
| `drawioLabelChars` | 2,000,000 | 上げ下げ | draw.io の 1 つの図のラベルの文字の数の合計 |
| `drawioSvgChars` | 16,777,216 | 上げ下げ | draw.io の図を SVG にした長さ (文字。書く文字の合計は、その 2 倍まで) |
| `drawioImages` | 200 | 上げ下げ | draw.io の 1 つの図で取得する画像の数 (配布物の画像・URL の画像のそれぞれ) |

## エラーと診断

### 投げるエラー

| 場面 | 結果 |
| --- | --- |
| FO の XML が読めない | `typeset` が投げる (`XML の解析に失敗しました: …`) |
| 既定のフォントが読めない | `typeset` が投げる (`フォントを読めません: …`) |
| `fonts` に渡したフォントファイルが壊れている | 投げずに `warnings` に入る |
| `renderPage` の無いページ番号 | `RangeError` (`renderPageToSvg`・`renderPageToPng` は `RangeError` で失敗する Promise) |
| 組版の警告 (読めない画像・溢れなど) | 投げずに `result.warnings` に入る |
| `signal` で止めた | 返す Promise が `signal.reason` (既定は `AbortError` の `DOMException`) で失敗する ([組版を止める・進捗](#組版を止める進捗-signalonprogress)) |

Kumiori の投げるエラーは、種類の名前 `code` を持つ `KumioriError` とその下の型 (`KumioriInputError`・`KumioriLimitError`・`KumioriFontError`・`KumioriPdfError`) か、オプションのエラーの `KumioriOptionError` です。
`KumioriOptionError` は、前からの `TypeError` を継ぎ、誤ったオプションの名前を `option` に持ちます。
`isKumioriError(e)` で見分けます。名前の一覧は [`docs/diagnostics.md`](diagnostics.md) にあり、診断の名前とエラーの名前の配列 (`DIAGNOSTIC_CODES`・`ERROR_CODES`) も出しています。

### 診断 (diagnostics)

`result.diagnostics` (`typesetToPdf` の結果にもある) は、`warnings` と同じイベントを、次の形で持ちます。

| 持ち物 | 中身 |
| --- | --- |
| `code` | 種類の名前 (`css/unknown-property` など。バージョンをまたいで変えない) |
| `severity` | 重大度。`error` は出力が欠けた、`warning` は指定を無視した、`info` は情報 |
| `message` | 文 |
| `args` | 文に埋めた値 |
| `count` | 同じものの数 |
| `source` | 分かるときは入力の場所 (ファイル・行・列・要素・Area Tree の `sourceRef`・PDF のページ) |

未対応・知らない CSS と XSL-FO の指定は、`warnings` では 1 つの文にまとめ、`diagnostics` では項目ごとに 1 件にします。`warnings` の文と並びは前と同じです。
名前の一覧と重大度は [`docs/diagnostics.md`](diagnostics.md) にあります。

## PDF の画像

`<img src="a.pdf">`・`fo:external-graphic src="url(a.pdf)"`・CSS の `background-image` などで、PDF のページを図として貼れます。中身の先頭 (`%PDF-`) で PDF と見分けます。

- **PDF の出力**: ページを Form XObject としてベクタのまま埋め込みます (同じページは 1 つ)。持ち込むのはページの中身とリソース (フォント・画像など) だけで、注釈・リンク・しおり・構造ツリーは持ち込みません (注釈があれば `image/pdf-dropped`。中身のストリームと、リソースの中の Form XObject などのマーク付きコンテンツの MCID と、XObject の `StructParents` も外します)。元の PDF がフォントを埋め込んでいなければ `image/pdf-font` で通知します。
- **画面・SVG・PNG**: PDF を描画する仕組みを持たないので、正しい大きさのプレースホルダーで描画し、`image/pdf-placeholder` で通知します (ページの数と位置は PDF の出力と同じです)。
- **ページ**: `a.pdf#page=2` (RFC 8118 の `page=`)。無ければ 1 ページ目です。
- **大きさ**: ページの CropBox (無ければ MediaBox) です。`/Rotate` (90 度ごとの回転) と `UserUnit` も見ます。
- **互換の指定** (`compat: 'antenna'`・`style: 'ah'`、コマンドの `--compat antenna`・`--style ah`) のときだけ、アンテナハウスの拡張を読みます。
  - ページの範囲 (`#page=2-3`・`#page=2-`・`#page=all`): 範囲のページを、間を空けずに 1 行に横に並べ (下端をそろえる)、1 つの図として貼ります (アンテナハウスのサンプルと同じ並べ方。ページを流しはしません)。大きさの指定 (`content-height` など) は、並べた全体に掛かります。背景の画像 (`background-image`) に範囲を指したときは、範囲の最初のページだけを敷きます (サンプルと同じ)。並べるのは、範囲の初めから上限 `pdfImageRangePages` (既定 64) のページまでで、超えた分は貼らずに `image/pdf-page-range` と `limit/reached` で通知します。範囲のページの圧縮を解く大きさ (`pdfImageStreamBytes`) と時間 (`pdfImageLoadMs`) は、範囲の全体で分け合い、同じ中身のストリーム・リソースを共有するページは 1 つの Form XObject にします。
  - ボックスの選び方 (`#bbox=MediaBox|CropBox|BleedBox|TrimBox|ArtBox`)。
  - data: の URI の `page=` (`data:application/pdf;page=3;base64,…`)。
- **読めない PDF**: 壊れた PDF は `image/pdf-invalid`、暗号化した PDF は `image/pdf-encrypted` で通知し、プレースホルダーで描画します。
- **PDF/X・PDF/A・PDF/UA-1**: 埋め込む前に、そのページだけを検査します。要件に合わないページ (PDF/X の DeviceRGB、sRGB の PDF/A の CMYK、埋め込んでいないフォント、透明、PDF/A の任意の内容 (Optional Content) など) は、埋め込まずにプレースホルダーで描画し、`pdfx/embedded-pdf`・`pdfa/embedded-pdf`・`pdfua/embedded-pdf` で通知します。埋め込んだページの色を CMYK に直すことはしません。透明をフラット化する出力 (PDF/X-1a・X-3) では、PDF の画像を貼りません (PDF/X-4 を使ってください)。
- **上限**: `pdfImageObjects`・`pdfImagePages`・`pdfImageDepth`・`pdfImageStreamBytes`・`pdfImageLoadMs`・`pdfImageRangePages` (「入力の上限」の表)。圧縮したストリームは、解く前・解く間に制限します。読み込むときに解くオブジェクトのストリーム・相互参照のストリームの合計は、`pdfImageStreamBytes` と、ファイルの大きさの 100 倍 (+ 1MB) の小さい方までです (上限を上げても、ファイルの大きさによる制約は変わりません)。

## draw.io の図

`drawio` は、draw.io (diagrams.net) の図のファイル (`.drawio`・`.dio`) のオプションです (型は `DrawioOptions`)。

既定で、draw.io の図を画像として読み、ページを SVG にして PDF に図形と文字のまま入れます (図を描画する処理は、図が出てきたときだけ読み込みます)。`false` なら、draw.io の図を画像として読みません。
オプションは次のものです。

| オプション | 中身 |
| --- | --- |
| `stencils` | 図形ライブラリ (`js/stencils.min.js` か、ライブラリの XML) と配布物の画像 (名前が `.svg`・`.png`・`.jpg` のもの) のファイル。`{ name, data }` の配列で、`data` は中身か、使うときだけ読む関数 |
| `fetchStencils` | `stencils` に無い図形ライブラリ・画像を、draw.io の配布物からネットワークで取得するか。既定 `false` (取得せずに、描画できない形は文字だけ描画して警告する)。`true` はバージョンを決めた draw.io の公開のリポジトリから取得し、中身の SHA-256 をそのバージョンの一覧と比較する。文字列 (URL) は、その `stencils.min.js` と、同じ場所の下の画像 (`…/js/stencils.min.js` に対して `…/img/lib/…`) から取得する (比較しない)。関数 `(path, { url, fetch }) => 中身` は、要るときに配布物の中のパスを受けて呼ぶ (手元にキャッシュしておくときなど。`url` は既定の取得先、`fetch` は本体と同じ上限・時限・転送の守りで取得する関数)。取得したものは、同じ URL について、プロセス・画面の中で再利用する |
| `stencilsUrl` | 取得する先の `stencils.min.js` の URL (`fetchStencils` が `true` か関数のとき。無ければ、バージョンを決めた draw.io の公開のリポジトリ) |
| `provideStencils` | 足りない図形ライブラリ・画像の名前を受けて、図形ライブラリの登録所を返す関数 (渡すと `stencils`・`fetchStencils` は使わない) |

書き方・ページの選び方・描画するものは [`docs/drawio.md`](drawio.md) にあります。

## プラグイン

`plugins` は、プラグインの配列です。いまは画像の形式を追加するものだけです。

```ts
{ apiVersion: 1, name, imageFormats: [{ name, mime, extensions, sniff, load }] }   // 型は KumioriPlugin・ImageFormat
```

| フィールド | 中身 |
| --- | --- |
| `apiVersion` | 受け口のバージョン。いまは `1` (`PLUGIN_API_VERSION`) |
| `name` | プラグインの名前 (空でない文字列。警告の文に出る) |
| `imageFormats[].name`・`mime` | 形式の名前と MIME の型 |
| `imageFormats[].extensions` | 画像として読む拡張子 |
| `imageFormats[].sniff(bytes)` | 中身がこの形式かを返す (同期) |
| `imageFormats[].load(bytes, ctx)` | 画像を読み、`{ svg, width, height, warnings }` (SVG の文書・幅と高さ (CSS px)・描画できなかったものの警告) を返す (非同期)。読めなければ `undefined` |

- 画像のファイルが形式の `sniff` (中身の判定。同期) に当たれば、`load` (非同期) が SVG と大きさを返し、Kumiori はそれを SVG の画像として描画します (PDF には図形のまま入ります)。
- `extensions` の拡張子の名前のファイルも、文書に名前が出てくれば画像として読みます。
- 重い処理は `load` の中で `import()` すれば、その形式のファイルが出てきたときだけ読み込まれます。
- `apiVersion` は受け口のバージョン (`PLUGIN_API_VERSION`) で、互換の無い形に変えたら上げます。
- プラグインの形式は、本体の形式 (draw.io の図) より先に判定します。

`load` に渡るもの (`ctx`。型は `ImageFormatContext`):

| 名前 | 中身 |
| --- | --- |
| `measureText` | 文字の幅を、描画するフォントで測る |
| `fetchResource` | 文書の画像と同じ規則 (`resolveResource`・`fetchImages`) で取得する |
| `fetch` | プラグインのオプションで利用者が許したものを取得する |
| `fetchTimeoutMs` | 取得するときの時限 (ミリ秒。`TypesetOptions.fetchTimeoutMs`) |
| `warn` | 警告を出す (画像ごとでない警告。画像ごとの警告は結果の `warnings`) |
| `lang` | 警告の文の言語 (`ja`・`en`。`TypesetOptions.lang`) |
| `fragment` | 画像の参照の `#` の後ろ。1 つのファイルの中の、どの図・ページを描画するか。同じファイルを `#` の後ろの違う参照で指すと、参照ごとに `load` を呼び、別の画像になる |
| `limits` | 入力の上限 (`TypesetOptions.limits` を既定で埋めたもの。読むだけ)。形式が自分の計算量を合わせるのに使う |

`load` の結果には上限があります (draw.io の図も同じ。`src/imageFormats.ts`)。超えたものは読めない画像として扱い、警告を出します。

| 上限 | 値 |
| --- | --- |
| 大きさ | 有限で 1,000 万 px まで |
| SVG の長さ | 約 3,360 万字 + ファイルの 1 バイトあたり 128 字 (最大約 1 億 3,400 万字) |
| 時限 | 60 秒 + 取得の時限 (`fetchTimeoutMs`) の 3 倍 (既定 150 秒) |
| 1 つのファイルを `#` の後ろの違う参照で読む数 | 64 個まで |

プラグインは Kumiori と同じ権限で動きます。自分で選んだ、信頼できるものだけを渡してください。

## Node のモジュール (kumiori/node)

```ts
import { typeset } from 'kumiori';
import { createFileResolver, createFontLoader } from 'kumiori/node';
const result = await typeset(html, { loadFont: createFontLoader(), resolveResource: createFileResolver() });
```

`kumiori/node` のモジュールは次のものです。

| モジュール | 中身 |
| --- | --- |
| `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` | `loadFont` に渡す、既定のフォントの読み込み。Node のコマンドと同じく、`fontDir` → フォントのキャッシュ → ネットワークの順に探し、取得したフォントはキャッシュに保存する。`cacheDir` の既定は `defaultFontCacheDir()`、`null` でキャッシュしない |
| `defaultFontCacheDir(env, platform, home)` | フォントのキャッシュの既定の場所。環境変数 `KUMIORI_FONT_CACHE` があればそこ、無ければ OS のキャッシュのディレクトリの `kumiori/fonts` (Windows は `%LOCALAPPDATA%`、macOS は `~/Library/Caches`、ほかは `$XDG_CACHE_HOME` か `~/.cache`)。home が分からなければ `undefined`。引数は省けば、いまの環境のもの |
| `looksLikeFont(bytes)` | フォントのファイルらしいか (TrueType・OpenType (CFF)・TrueType Collection の先頭 4 バイトを見る)。途中で切れた取得や壊れたキャッシュを見分ける |
| `createFileResolver({ root })` | `resolveResource` に渡す、`file:` の URL のファイルを読む関数。`root` を渡すと、その中のファイルだけを読む。`root` はいくつかの並びでもよく、中にあるかはシンボリックリンクをたどった実体のパスで見る |
| `createSystemFonts({ dirs, maxFiles })` | `systemFonts` に渡す、OS のフォントを探すモジュール。読み込んだどのフォントにも字形の無い文字を持つフォントを、OS のフォントの場所から探す。`dirs` は探すディレクトリの文字列の配列 (既定は `systemFontDirs()`。配列でない値・文字列でない項・空の文字列は `TypeError`。相対のパスは、モジュールを作ったときのカレントディレクトリから。空の配列なら、どこも探さない)、`maxFiles` は探すファイルの数の上限 (既定 20000)。フォントのファイルは、文字の範囲の表 (`cmap`) などの要る表だけを読み、索引はモジュールが持つ (初めて探すときに 1 度だけ作る。イベントループに制御を返しながら作るので、フォントの多い機械でもイベントループを長く止めない。止めるシグナル (`signal`) が来たら待つのをやめる。索引を作った後にフォントのファイルが変わったと分かったら、次に探すときに作り直す)。明朝とゴシックの種類ごとにフォントを選び、PDF に埋め込めないフォント (OS/2 の `fsType`) は選ばない |
| `systemFontDirs(env, platform, home)` | OS のフォントの場所。Windows は `%WINDIR%\Fonts` と `%LOCALAPPDATA%\Microsoft\Windows\Fonts`、macOS は `/System/Library/Fonts`・`/Library/Fonts`・`~/Library/Fonts`、ほか (Linux など) は fontconfig の設定 (`FONTCONFIG_FILE`・`FONTCONFIG_PATH`・`/etc/fonts/fonts.conf`) の `<dir>` (設定が無ければ XDG の規則の場所)。引数は省けば、いまの環境のもの |

## パッケージの形と動作環境

| 入口 | ファイル | 使い方 |
| --- | --- | --- |
| `kumiori` | `dist-lib/index.js` | 依存パッケージ (pdf-lib・fontkit・xmldom など) を取り込んでいない ES モジュール。Vite・webpack などのバンドラーで使うか、Node から読む |
| `kumiori/node` | `dist-lib/node.js` | Node のモジュール ([上](#node-のモジュール-kumiorinode)) |
| `kumiori/browser` | `dist-browser/kumiori.js` | 依存まで 1 つにまとめた、バンドラーを使わないブラウザー向けのファイル |

- 公開しているのは `src/index.ts` (と Node 用の `src/node.ts`) から出しているものだけです。ほかのモジュールの関数・型は、バージョンの間で変わることがあります。
- ES モジュールだけですが、`require('kumiori')` でも読めます (ES モジュールを、フラグ無しで `require()` で読める Node 22.12.0 以降。22.12 は、読むときに Node が `ExperimentalWarning` を出します。22.13 からは出しません)。
- 動く Node は、22.12.0 以上です。Node 20 は、サポート (保守) が 2026 年 4 月に終わったので、0.7.0 で対象から外しました。22.0〜22.11 は、`--experimental-require-module` を付けないと ES モジュールを `require()` で読めないので、対象から外しています。
- Deno と Bun でも動きます (Node の互換の API で動きます。Deno 2.9・Bun 1.4 で確認しました)。npm から入れたパッケージを、Node と同じく `import { typeset } from 'kumiori'` (Deno では `npm:kumiori` でも) で読みます。
  確認したのは、`kumiori`・`kumiori/node`・`kumiori/browser` の読み込み、HTML・XSL-FO の組版、PDF・SVG・PNG の書き出し、`createTypesetter`、`createFontLoader` でのフォントの読み込み (格納先のファイルからも、ネットワークからも)、重ねた呼び出しの言語 (Deno・Bun の持つ `AsyncLocalStorage` を `process.getBuiltinModule` で取得して使う) と、
  コマンド (`deno run -A node_modules/kumiori/dist-cli/cli.js`・`bun node_modules/kumiori/dist-cli/cli.js`) の PDF・PNG・SVG の書き出し・標準入力・`--system-fonts`・`--watch` です。
  Deno では、ファイル・ネットワーク・環境変数を使うので、それを許して (`-A` か、`--allow-read`・`--allow-write`・`--allow-net`・`--allow-env`) 走らせます。
- Web Worker の中でも組めます ([Web Worker の中で組む](#web-worker-の中で組む))。Cloudflare Workers のような、Node の API も DOM も無い所で使うときは、ブラウザー向けの 1 ファイル (`kumiori/browser`) を使います。
  確認したのは、Chromium の Web Worker の中で組み、OffscreenCanvas に描画し、PDF を作ることと、Deno・Bun でこのファイルを読んで組むことまでで、Cloudflare Workers そのものでは試していません
  (フォントは `loadFont` で渡します。Workers の 1 つの Worker の大きさの上限と、メモリ・CPU の時間の上限に収まるかは、文書とフォントの大きさによります)。

`kumiori/browser` は、約 3.0MB (gzip で 1.0MB) です。最初に一緒に読む別ファイル (`chunks/` の pdf-lib・pako など) と合わせて約 3.6MB です (pdf-lib は draw.io の図の処理と分け合うので、別ファイルになります)。
ハイフネーションの辞書と、CGM・EPS・WMF・EMF・draw.io の図の処理などは、使うときだけ別ファイルを読みます。
npm に公開したものは、jsDelivr や unpkg の CDN からそのまま読めます。

```html
<script type="module">
  import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.8.0/dist-browser/kumiori.js';
  const result = await typesetHtml(html, { name: 'a.html' });
  await result.renderPage(document.querySelector('canvas'), 0);
</script>
```

## ブラウザーで印刷プレビューを出す

`result.renderPage(canvas, ページ番号, { scale })` で、組んだページを canvas に描画できます。
ブラウザーの画面では、HTML をブラウザーの DOMParser で読みます (linkedom は、Node と、[Web Worker](#web-worker-の中で組む) の中で使います)。

例: エディタで編集している HTML を、手が止まるたびに組んでプレビューに並べる

```ts
import { typeset } from 'kumiori';
import type { FontSpec } from 'kumiori';

const printCss = '@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } } body { font-family: serif }';
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const loadFont = (spec: FontSpec) => {                          // 既定のフォントは 1 度だけ取得して再利用する
  const key = `${spec.family}|${spec.weight ?? 400}`;
  if (!fontCache.has(key)) fontCache.set(key, fetch(spec.urls.find((u) => u.startsWith('https:'))!).then((r) => r.arrayBuffer()));
  return fontCache.get(key)!;
};

async function showPreview(bodyHtml: string, container: HTMLElement) {
  const r = await typeset(`<!doctype html><html lang="ja"><body>${bodyHtml}</body></html>`, {
    kind: 'html',
    files: [{ name: 'print.css', data: printCss }],             // 文書から参照されていない CSS は、利用者のスタイルシートとして追加される
    loadFont,
  });
  container.replaceChildren();
  for (let i = 0; i < r.pageCount; i++) {
    const canvas = document.createElement('canvas');
    await r.renderPage(canvas, i, { scale: 1 });                // 1pt = 1 CSS px (等倍は 96 / 72)
    container.append(canvas);
  }
}
```

- 何度も組むときは、`await createTypesetter(setup)` でフォントを 1 度だけ読み込んだタイプセッターを作り、`typesetter.typeset(html, options)` で組むと速くなります (`loadFont` などのフォントまわりのオプションは、`setup` に渡します)。
  - タイプセッターは、前の文書を組んだときの結果のうち、中身が同じなら同じになるもの (`@font-face` のフォントのファイルの下ごしらえ (WOFF2 の展開など) と、中身・書式・幅の同じ段落の行分け) をキャッシュし、次の文書で再利用します。
    少しずつ直した文書を組み直すとき、2 回目からの組み直しが速くなります (151 ページの文書で約 13 秒が約 9 秒)。再利用しても、組んだ結果 (エリアツリー・PDF) は変わりません。
    `typeset` では、中身・始まりの条件 (開始ページ・左右・脚注の続き番号) の変わらない page-sequence のページも、前の文書から再利用します。
    直した page-sequence も、直した所の前のページは前の文書のページを使って、その区切りから組み、
    直した所の後ろで、ページの区切りの所の組みの状態が前の文書と揃ったら、残りのページを前の文書から使います
    (直した所でページの数が変わり、後ろのページの番号がずれたときは、残りを組みます。段組・最後のページのマスターのある page-sequence は、直したら全部を組みます)。
    ページ番号の参照のある page-sequence・ページは、参照の値が前の文書と同じになるときだけ使います。索引・ページごとの脚注番号のある文書・page-sequence では再利用しません。
    目次などの前向きのページ番号の参照は、組み直しの 1 回目に仮の値で組み、2 回目で値を決めるので、Typesetter は前の文書の 1 回目のページを持ち、次の文書の 1 回目と比べます
    (目次のある page-sequence でも、直した所の前のページを使えます)。2 回目からの回で参照の値の桁が変わって、文字だけを差し替えられない page-sequence も、
    値の変わった参照を初めて引いたページの前の区切りから組み、後ろで前の回と組みの状態が揃ったら、残りのページを前の回のものから使います (前の文書が無いときも。Typesetter で組むときだけ)。
    文字や属性を直したときのほか、ブロック (段落・見出し・表など) を追加する・消す直しでも、前の文書のページを使います (前の文書と文書の形を照合し、直した所の外の節を対応させます)。
    page-sequence の本文 (flow) の外の節 (柱・領域の背景・脚注の区切りなど。どのページにも効くもの) を追加する・消す・直したときは、その page-sequence は全部を組みます。
    柱の `fo:retrieve-marker` の中身 (マーカーの文字) は、再利用したページでも、いまの文書で組み直すので、マーカーを直しても、ほかの page-sequence のページは使います。
    先頭から N ページのプレビュー (`maxPages`) を挟んでも、前に全体を組んだ文書のページは捨てません (プレビューでは使いもキャッシュもしません)。
    page-sequence の外の、組版が読まない文書の全体のフィールドは、直してもページの再利用を妨げません: しおりのタイトル (HTML の `h1`〜`h6` は既定でしおりになるので、見出しの文字を直したときのしおりのタイトルも。XSL-FO の `fo:bookmark-title`)、
    文書のタイトルと情報 (HTML の `<title>`・`meta`、XSL-FO の `axf:document-info`)、タグ付きの PDF (`tagged`) を作るときの構造ツリー (構造の型・代替テキスト・略語の展開・言語と、前に追加した構造の節による番号のずれ)。
    これらは、再利用したページでも、いまの文書から作り直します。
    組む計算量の内部の上限の近くの文書、組む間に上限 (`limits`) に当たったかフォントの情報 (フォントの整形の表のエラーなど) の出た page-sequence、警告の言語の違う文書でも、再利用せずに組みます。
    `typesetToPdf`・`typesetToPdfStream` (ページごとに書いて手放す組版) はページをキャッシュしません (前に `typeset` でキャッシュしたページは使います)。
    HTML と CSS 編の対応仕様説明書 (147 ページ・page-sequence 1) で 1 段落を直して組み直すと、`typeset` が約 9.5〜9.9 秒から約 6.0〜6.3 秒 (組版の分は約 5.6〜6.1 秒から約 2.0〜2.1 秒) になります (`scripts/profile-relayout.mjs --edit` の 3・4 回目)。
    キャッシュする分のメモリ (前の文書 1 つ分の段落の行分けで、140 ページほどの本で約 200MB、上限は約 400MB。ページを再利用するときは、前の文書のページツリーとページの区切りの記録もその分持ちます。
    組み直しの 2 回目からの回で組み直した page-sequence は、1 回目のページも持ちます) を使うので、要らなければ `createTypesetter({ reuse: false })` で切れます。
    前の文書のページツリーは、節の数がおよそ 200 万 (Node で約 400MB) を超える所からの page-sequence をキャッシュしません (キャッシュしなかった page-sequence は、次の文書で全部を組みます)。
  - 前に組んだ結果をいくつか持っておくときは、`typesetter.memoryUsage()` と、結果ごとの `result.memoryUsage()` の和で上限を決め、古い結果を `result.dispose()` で、再利用のキャッシュを `typesetter.releaseCaches()` で手放せます ([メモリの見積もりと手放す](#メモリの見積もりと手放す-memoryusagedisposereleasecaches))。
- 動くサンプル: `npm run dev` の後、http://localhost:5173/examples/preview/ を開きます (`examples/preview/`)。
  左の編集欄、その下の「HTML」フィールド (見出し・ルビ・表などを直接書ける。編集欄と互いに同期する)、印刷の CSS を書き換えると、手が止まったところで右に組み直します。
  Kumiori の公開 API だけを使い、ほかの依存はありません。
  ほかのエディタとつなぐときは、エディタの中身が変わったときの通知で、サンプルの `schedule(エディタの HTML)` に当たる処理を呼びます。

## JS が組み上げたページを組む (snapshotDocument)

Kumiori は JS を動かしません。JS で中身を作るページ (グラフ・コンポーネントで組み立てる画面など) は、ブラウザーの画面で、JS が組み上げた後の文書を `snapshotDocument(document, options)` でシリアライズして、`typeset` に渡します。
`'<!doctype html>' + document.documentElement.outerHTML` だけでは落ちるもの (フォームのいまの値・相対の URL の基準など) を拾い、シリアライズする時を待ちます。この関数は 0.6.0 からです。

```ts
import { snapshotDocument, typeset } from 'kumiori';

const snap = await snapshotDocument(document, { waitFor: () => window.chartsReady });
const r = await typeset(snap.html, { ...snap.options, pageSize: 'A4' });
```

- 使えるのは、DOM と画面のある所 (ブラウザーの画面) だけです。Web Worker と Node で呼ぶと、`KumioriOptionError` を投げます。
- 元の文書は変えません。スナップショットは、画面と関わりの無い文書に作ります (画像を読まず、カスタム要素も作りません)。

オプション (`SnapshotOptions`。どれも省略できます):

| オプション | 型 | 既定 | 意味 |
| --- | --- | --- | --- |
| `waitFor` | `Promise` か関数 | — | ページの側の「準備できた」のシグナル。関数なら、真の値を返すまで描画の回ごとに呼ぶ |
| `timeoutMs` | number | 10000 | 待つ時間の上限 (ミリ秒)。過ぎたら、その時の文書でシリアライズして、`snapshot/wait-timeout` の警告を出す。0 なら待たない |
| `signal` | `AbortSignal` | — | 止めるシグナル。止めると、返す Promise は `signal.reason` で失敗する |
| `shadowRoots` | `ShadowRoot[]` | — | 中身に入れるシャドウルート (閉じたルートも)。開いたルートは渡さなくても入れる |
| `fontSources` | 関数 `(face: FontFace) => 中身か URL` | — | JS で追加したフォント (`new FontFace`) の中身 (`ArrayBuffer`・`Uint8Array`) か URL を返す。`undefined` なら取り込まない |
| `canvas` | `'png'` か `'skip'` | `'png'` | `'png'`: canvas の絵を PNG にして `img` に置き換える。`'skip'`: 置き換えない (canvas の代わりの中身を組む) |
| `limits` | `{ imagePixels?, fileBytes?, snapshotBytes? }` | 1 億ピクセル・256MB・512MB | 取り込む画像のピクセル・ファイル 1 つの大きさ・取り込む合計の大きさ |
| `lang` | `'ja'` か `'en'` | — | 警告の文の言語 |

結果 (`DocumentSnapshot`):

| フィールド | 型 | 中身 |
| --- | --- | --- |
| `html` | string | シリアライズした文書 (`<!doctype html>` から) |
| `options` | `{ kind, name, files }` | `typeset` のオプションにそのまま渡すもの。`files` の `data` はどれも `Uint8Array` |
| `baseUrl` | string | シリアライズしたときの文書の基準の URL。`html` の中の URL は、もう絶対の URL にしてある |
| `diagnostics` | `Diagnostic[]` | 取得できなかったもの・近似したもの (`snapshot/…` の診断。`typeset` の診断とは別) |
| `warnings` | string[] | `diagnostics` の文 |

待つもの (合わせて `timeoutMs` まで):

1. 文書の読み込み (`load`)
2. フォントの読み込み (`document.fonts.ready`)
3. ページの側のシグナル (`waitFor`)
4. 描画の落ち着き (描画の回を 2 回と、走っているアニメーション (CSS のアニメーション・トランジションと `element.animate()`) のうち、終わりのあるもの)

画像の読み込みは待ちません (URL を絶対にして、Kumiori が自分で取得するので、`loading="lazy"` で画面の外にある画像も組めます)。
Chart.js などの、JS で自分で動かすアニメーション (`requestAnimationFrame` で描画するもの) は、CSS のアニメーションではないので待てません。アニメーションを切るか、終わりのコールバックでシグナルを立てて、`waitFor` で待ってください。

コピーするときに直すもの:

- 相対の URL は、文書の基準 (`<base href>` があればそれ) で絶対の URL にします。`#id` だけの参照と、文書と同じ URL に `#` を付けた参照は `#id` の形にし、PDF の中のリンクにします。`<base>` は取り除きます。
- canvas の絵は PNG にして `files` に入れ、`<img data-kumiori-canvas>` に置き換えます (属性はそのままコピーするので、`style` の大きさはそのまま当たります)。文書の `<style>` の、`canvas` を名前で指定した規則は、置き換えた `img` にも当て、`img` を名前で指定した規則は、置き換えた `img` に当てません (`<link>` で読むスタイルシートの規則は書き換えないので、その `img` の規則は当たります)。別の origin の画像で汚染された canvas は画像にできないので、canvas のまま残します (`snapshot/canvas-tainted`)。WebGL の canvas は、`preserveDrawingBuffer: true` で作らないと、空の絵になることがあります。
- `<style>` は元の文字を残し (ブラウザーの知らない指定 (`string-set`・`-ah-*` など) が消えないように)、JS が CSSOM で追加した規則 (`insertRule`。styled-components・emotion の本番の作りなど) だけを、直後の `<style data-kumiori-cssom>` に追記します。CSSOM で消された規則は、元の文字から消せないので残します (`snapshot/stylesheet-rule-removed`)。
- 作ったスタイルシート (`document.adoptedStyleSheets`) は、規則を書き出して `<style data-kumiori-adopted>` にします (元の文字が無いので、ブラウザーの知らない指定は戻せません)。`<link rel="stylesheet">` は URL を絶対にして残し、Kumiori が自分で取得します (JS で書き換えた規則は反映されません)。無効にしたスタイルシートは取り除きます。
- Shadow DOM (Web Components) は、フラットツリーに展開します (host の子をシャドウツリーのコピーに置き換え、`<slot>` は割り当てられた節に置き換えます)。シャドウツリーのスタイル (`:host`・`::slotted()` を含む) は、セレクターを属性で囲って、そのシャドウツリーの中だけに当たるように書き換えます。詳しさ (specificity) が少し上がる近似です。入れ子の `<slot>` の途中のシャドウツリーの `::slotted()` も当て、`:host-context()` は host そのものにも当てます。シャドウツリーの中の `@import` は、読み込んだ先の規則を同じように囲います (シャドウツリーの中の `@font-face` は、文書の全体に当たります)。規則を読めないシャドウツリーの中のスタイルシート (別の origin の `<link>`・`@import`) はコピーせずに `snapshot/shadow-stylesheet-unreadable` の警告を出します。`::part()` は扱いません。閉じたシャドウルートは見えないので、`shadowRoots` で渡したものだけコピーします (渡さないと、ありそうな所に `snapshot/shadow-root-closed` の警告を出します)。
- CSS の `@font-face` のフォントは、CSS のまま (URL を絶対にして) 残し、Kumiori が取得します。JS で追加したフォント (`new FontFace` を `document.fonts.add`) は、中身も URL もブラウザーが返さないので、`fontSources` で渡してください。渡した中身は `files` に入れ、同じ名前・太さ・傾きの `@font-face` を追記します (渡さないと `snapshot/font-face-source-unknown`。同じ中身のフォントは 1 つのファイルにし、同じ規則は 1 つにします。`javascript:` の URL を返しても `snapshot/font-face-source-unknown`)。
- blob: の URL (属性と CSS の `url()`) は、中身を読んで `files` に入れます (組むのに使う所だけ: 画像 (`img`・`picture` の `source`・`input` の `src`・`video` の `poster`・SVG の `href`)・`link`・`object`・`embed` と CSS。`a`・`area` の `href`、`video`・`audio` の `src` などの blob: は、中身を読まずに URL のまま残します)。大きさは読む前に確認します。消された URL でも、読み終わった `img` の絵は PNG にして取り込みます (SVG の画像も、ピクセルの PNG になります)。読めないものは `snapshot/blob-unreadable` の警告を出します。
- `srcset`・`<picture>` の画像は、画面で選ばれた画像 (`currentSrc`) を `src` にします (画面の幅で選んだ画像になります)。
- フォームのいまの値を、属性 (`value`・`checked`・`selected`・`textarea` の中身) に書き戻します。`password` と `hidden` の値と `file` は書きません (CSRF のキーなどをスナップショットに残さないように)。いまの Kumiori は `input` の中の値の文字を描画しません (`textarea` の中身と `select` の `option` の文字は描画します)。
- `<script>` (データの島も)・`on…` の属性・`javascript:` の URL (空白・制御字で隠したものも。SVG のアニメーション (`set`・`animate` など) で `href` を `javascript:` に動かすものも)・`<iframe>`・`<object>`・`<embed>` の `data:` の URL (画像の `data:` は残します)・`<noscript>`・`<meta http-equiv="refresh">`・注釈を取り除きます。`<template>` の中身も同じように取り除いてコピーします。`<style>` の文字の中の `</style` はエスケープし、`<xmp>` は `<pre>` にして、コピーを読み直したときに要素が差し込まれないようにします。スナップショットには画面に出ていた中身 (利用者の入れた値など) が入るので、サーバーへ送るときは、その扱いに気を付けてください。
- `<iframe>` の中の文書はコピーしません (`snapshot/iframe-skipped`)。

Web Worker の中で組むとき ([Web Worker の中で組む](#web-worker-の中で組む)) は、画面で `snapshotDocument` を呼び、結果を Worker に送ります。結果はふつうのデータ (文字列と `Uint8Array`) だけなので、そのまま送れます。

```js
const snap = await snapshotDocument(document);
worker.postMessage({ type: 'typeset', html: snap.html, options: snap.options }, snap.options.files.map((f) => f.data.buffer));
// Worker の中: (await typesetter).typeset(data.html, data.options)
```

上限と、別の origin のリソース:

- 取り込むもの (canvas の PNG・blob: の中身・`fontSources` のフォント。`fontSources` の返した `data:` の URL も数えます) は、ファイル 1 つが `fileBytes`、canvas のピクセルの数が `imagePixels`、合わせて `snapshotBytes` までです (超えたものは取り込まずに警告します)。`typeset` で `limits` を上げて組むときは、同じ値を `snapshotDocument` の `limits` にも渡してください。
- `snapshotDocument` が自分で読むのは、同じ文書の中のもの (canvas・blob: の URL・CSSOM) だけで、ネットワークへは出ません。`http(s)` の画像・CSS は URL を絶対にするだけで、取得するのは `typeset` です (`fetchImages`・`fetchStyles` の規則が効きます)。
- そのため、画面では見えていても、CORS の応答のヘッダーの無い別の origin の画像は、ブラウザーで組むと読めない画像になります (`<img>` は CORS が無くても画面に出せますが、`fetch` では中身を読めません)。同じ origin に置くか、CORS の応答のヘッダーを付けてください。

組めないもの:

- 画面の幅で測って JS が決めた位置・大きさ (`getBoundingClientRect` で測って `style` に書いたもの) は、画面の幅のまま残り、紙の本文の幅で組み直しになりません。シリアライズする前に、画面の幅を紙の本文の幅に合わせると和らぎます。
- ページに分けた後で動く JS (ページ番号・柱を JS で書くもの) の代わりは無いので、CSS の `counter(page)`・`target-counter()`・`string-set` で書いてください。

## Web Worker の中で組む

大きな文書を組む間も画面が止まらないように、組版・描画・PDF の書き出しを Web Worker の中で行えます。ブラウザー向けの 1 ファイル (`kumiori/browser`) を、Worker の中で読みます。
この使い方は、0.5.0 からです (0.4.0 は、Worker の中では組めません)。

```js
// worker.js (new Worker('worker.js', { type: 'module' }) で作る)
import { createTypesetter } from 'https://cdn.jsdelivr.net/npm/kumiori@0.8.0/dist-browser/kumiori.js';
const typesetter = createTypesetter();                          // Promise<Typesetter>。フォントを読み込むのは 1 度だけ
let result;
self.onmessage = async ({ data }) => {
  if (data.type === 'typeset') {
    result = await (await typesetter).typeset(data.html, { name: 'a.html' });
    self.postMessage({ type: 'typeset', pageCount: result.pageCount, sheets: result.areaTree.sheets.map((s) => [s.width, s.height]) });
  } else if (data.type === 'render') {
    const canvas = new OffscreenCanvas(1, 1);
    await result.renderPage(canvas, data.page, { scale: data.scale, devicePixelRatio: data.dpr });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: 'render', page: data.page, bitmap }, [bitmap]);
  } else if (data.type === 'pdf') {
    const pdf = await result.toPdf();
    self.postMessage({ type: 'pdf', pdf }, [pdf.buffer]);
  }
};
```

組んでいる途中の組版を止めるには、親から送ったメッセージで `AbortController` の `abort()` を呼びます ([組版を止める・進捗](#組版を止める進捗-signalonprogress))。
Worker の中のメッセージの処理 (`onmessage`) が走るのは、組版がイベントループに制御を返した所 (段階の境界) なので、すぐ止めたいときは、`worker.terminate()` で Worker ごと止め、新しい Worker で組み直します。
進捗 (`onProgress`) を `postMessage` で親に送れば、組んでいる間も、親の画面に出せます (親の側は止まっていないので、すぐ届く)。

### 描画の仕方

- `renderPage` には `OffscreenCanvas` を渡します。描画したピクセルは `transferToImageBitmap()` で `ImageBitmap` にし、画面へ送って `bitmaprenderer` の canvas などに出します。
- Worker には `window.devicePixelRatio` が無いので、画面の値を `devicePixelRatio` で渡します (渡さなければ 1)。
- `kumiori` (`dist-lib`) をバンドラーで Worker に入れると、linkedom を読めないことがあります (Node のときだけ読む作りのため)。`kumiori/browser` を使ってください。

### 画面の中で組んだ結果との違い

- Worker にはブラウザーの DOMParser が無いので、HTML・SVG は linkedom (Node と同じ読み方) で読みます。linkedom は、Worker の中で初めて組むときに、別ファイル (`chunks/`) から読み込みます (画面の中で組むときは読みません)。
- そのため、Worker の中で組んだ結果は Node で組んだ結果と同じで、画面の中 (DOMParser) で組んだ結果と違うことがあります。たとえば HTML の中の MathML は、linkedom が `math` の要素を XHTML の名前空間に置くので、数式の組み方が画面の中と変わります。
- Worker の中の `renderPage`・PDF の SVG は、ブラウザーの画面の描画する SVG と絵が違うことがあります。
  - `foreignObject` の中は、PDF では本文と同じ組版で組みますが、`renderPage` では文字だけを近似します。
  - filter の `feGaussianBlur` (ぼかし) だけの影などは、ぼかしを省きます (Node の PDF と同じ)。
  - SVG の中の SVG の画像 (`<image>` の指す SVG) は、プレースホルダーで描画します (Node と同じ)。

### 画像の扱いと上限

- Worker にはブラウザーの画像 (`<img>`) が無いので、SVG の画像は、PDF では Node と同じく図形で描画し、`renderPage` では図形をラスタライズして描画します (倍率に合わせた解像度で描画し直します)。
  ほかの形式の画像は `createImageBitmap` で読みます (組むときは、読めるかと大きさを確かめてすぐ閉じ、描画するときに Typesetter の画像のキャッシュでデコードし直します。画面の中で組んだときも同じです)。
- `renderPage` で SVG の画像をラスタライズするときの上限:
  - 1 つの画像は 1,600 万ピクセルまでです。それより大きく置いた画像は、解像度を下げて描画します。
  - 図形をラスタライズする計算量 (図形の数 × ピクセルの数) にも上限があり、図形の多い画像を大きく置いたときも、解像度を下げて描画します。
  - 1 回の描画でラスタライズする計算量の合計にも上限があり、超えた後の画像はプレースホルダーで描画して、`canvas/svg-not-drawn` の警告を出します。
- SVG の中の画像のうち、組版のピクセルの読み取りで読めない形 (CMYK の JPEG・インターレースの PNG) は、`renderPage` のために、組んだときに `createImageBitmap` で読んでおきます。
  - 1 枚は 400 万ピクセルまでです。大きい画像は縮めて読みます。ヘッダーに書かれた大きさが 400 万ピクセルを超える画像は、元の大きさに戻さずに、読むときに縮めます。
  - 1 つの組んだ結果で、合わせて 3,200 万ピクセルまでです。画像は読み込んだ順に読みます。渡したファイル (`files`) の画像、次に文書の中の data: の URL・取得した画像の順で、1 つの SVG の中では書いた順です。
    合計が上限に届いた後の画像 (多くは文書の後ろの方の画像。上限に収まる小さな画像は読みます) は読まず、`renderPage` では描画しません。描画しないことの警告は出ません。
  - PDF には影響しません (この上限は PDF の画像には掛かりません)。

## 単位と座標

組んだ結果 (Area Tree) の単位と座標の規則です。くわしくは [`docs/area-tree.md`](area-tree.md) の「単位と座標」にあります。

- 単位はすべて **pt** (1/72 inch) です。
- 座標は物理座標で、y は下向きです (PDF に描画するときに、y が上向きの座標に直します)。
- Area の `x`・`y` は、親の Area の content-box の左上から、この Area の border-box の左上までの位置です。`width`・`height` は border-box の大きさで、`margin` (border-box の外の余白) は含みません。
- ボックスの回転 (`orientation`) があるときは、`width`・`height` は回転前の大きさ、`x`・`y` は回転後の外接矩形の左上で、子の座標は回転前の局所座標です。

組んだ結果の文字 (`GlyphArea`) には、分綴で行末に追加した文字 (入力の文字ではない) の印 `hyphen` と、行末で捨てた空白の文字 `breakSpace` が付きます。`breakSpace` は、空白の所で分けた行の最後の文字 (読む順) に付き、段落の終わりの行と、強制改行で終わる行には付きません。
文字を取り出すときは、`hyphen` の文字を除き、`breakSpace` を追加すると、入力の文字の並び (空白をまとめた後のもの) に戻ります。

組版の中の仕組み (組む前の論理ツリーなど。公開の API ではありません) は [`docs/architecture.md`](architecture.md) にあります。

## API の安定性 (バージョンをまたいだ約束)

公開の API (`kumiori`・`kumiori/node`・`kumiori/browser` から出すもの) を、バージョンをまたいで保つもの (安定) と、変わりうるものに分けます。
0.x の間は、互換の無い変更も minor のバージョン (0.6.0 から 0.7.0 など) で出すことがあります。patch のバージョン (0.6.0 から 0.6.1 など) では、どちらも互換を崩しません。
1.0.0 からは、安定のものを [セマンティック バージョニング](https://semver.org/lang/ja/) のとおりに扱います (互換を崩すのは major のバージョンだけ)。

### 安定のもの

名前・引数・返す値の形・意味を保ちます。互換の無い変更は minor のバージョンで出し、変更履歴 (CHANGELOG) に「**互換が変わる**」と書きます。
できるときは、1 つのバージョンの間、古い形も読み、非推奨の警告を出します。オプション・フィールド・診断の名前を追加するのは、互換の内です。

| もの | 安定とする範囲 |
| --- | --- |
| `typeset`・`typesetHtml`・`typesetFo`・`typesetToPdf` | 入口の関数 |
| `createTypesetter` | タイプセッターを作る関数と、タイプセッターの `typeset`・`typesetToPdf` |
| `decodeDocumentText`・`isKumioriError` | バイト列を文字列にする関数・エラーを見分ける関数 |
| `TypesetResult` | `areaTree`・`pageCount`・`warnings`・`diagnostics`・`layoutMs`・`truncated` (0.6.0 で追加した) と、`toPdf`・`renderPage`・`renderPageToSvg`・`renderPageToPng` の呼び方とオプション (変わりうるものに挙げた `RenderPageOptions.guides`・`RenderPageSvgOptions.pageHref` は除く。下) |
| `TypesetPdfResult` | `typesetToPdf` の結果の `pdf`・`pageCount`・`warnings`・`diagnostics`・`layoutMs`・`truncated` |
| `TypesetOptions` | `name`・`kind`・`files`・`fonts`・`genericFonts`・`loadFont`・`style`・`pageSize`・`compat`・`print`・`lang`・`fetchImages`・`fetchStyles`・`fetchTimeoutMs`・`resolveResource`・`links`・`tagged`・`pdfua`・`documentLang`、0.6.0 で追加した `signal`・`onProgress`・`maxPages`・`limits` (`limits` はフィールドの名前。既定の値は変わりうる) |
| `PdfOptions` | `title`・`pdfx`・`pdfa`・`imageMaxDpi`、0.6.0 で追加した `date`・`signal`・`onProgress` |
| `KumioriError` | エラーの型 (`KumioriInputError` など) と、`ERROR_CODES`・`DIAGNOSTIC_CODES` の名前 (名前を消す・意味を変えるのは、互換が変わる) |
| `kumiori/node` | `createFontLoader`・`createFileResolver`・`createSystemFonts`・`defaultFontCacheDir`・`systemFontDirs`・`looksLikeFont` |
| `walkAreaTree` | Area Tree をたどる・読み書きする関数 (`walkAreas`・`childrenOf`・`documentNodes`・`serializeAreaTree`・`parseAreaTree`) と、`parseAreaTree` の投げるエラー `AreaTreeFormatError` |
| `DEFAULT_FONTS` | 形 (`base`・`math`・`mono`・`symbol`・`emoji` と、`FontSpec` のフィールド)。どのフォントを使うかは変わりうる |

### 変わりうるもの

次のものは、互換の無い形でも minor のバージョンで変えることがあります。変えたときは、変更履歴に書きます。

- 組版の結果そのもの (文字・線・画像の位置や形)。直すたびに変わります。変わるバージョンでは、変更履歴に「**組版の結果が変わる**」と書きます
- Area Tree のフィールドの細部 (`AreaTree` の下の型)。フィールドの意味や子の持ち方を変えたら、`AREA_TREE_SCHEMA_VERSION` を上げます (下)
- 警告 (`warnings`) と診断の文の言い回し。プログラムで見分けるときは、診断の名前 (`code`) を使ってください
- 書き出した PDF・SVG・PNG の中の作り (PDF のオブジェクトの並び・SVG の要素の組み方など)
- 新しいオプションと、実験的なオプション:
  `systemFonts`・`spotColors`・`svgLanguages`・`deflate`・`unreferencedCss`・`diagnostics`・`plugins`・`drawio` (と `createDrawioStencilRegistry`・`DRAWIO_MIME`・`isDrawio`)・`reuse`・`TypesetPdfOptions.lowMemory`・`RenderPageOptions.guides`、
  0.6.0 で追加した `RenderPageSvgOptions.pageHref` と、ページの SVG のリンクの書き方、0.6.0 で追加した `snapshotDocument`、
  0.7.0 で追加した PDF のストリームでの書き出し (`typesetToPdfStream`・タイプセッターの `typesetToPdfStream`・`TypesetResult.toPdfStream`・`PdfOutput`・`TypesetPdfStreamResult`。書き出し先の扱い・塊の大きさ・書く順を含む)、
  0.8.0 で追加した PDF の暗号化 (`PdfOptions.encrypt`・`PdfEncryptOptions`・`PdfPermissions`) と、文字列を測る API (Typesetter の `measureText`・`breakLines`・`TextStyle`・`MeasuredText`・`MeasuredLine`)、
  0.8.0 で追加したメモリの見積もりと手放す API (`TypesetResult.memoryUsage`・`TypesetResult.dispose`・`Typesetter.memoryUsage`・`Typesetter.releaseCaches`・`MemoryUsage`・`TypesetterMemoryUsage`。見積もりの数え方と係数を含む)
- `src/index.ts`・`src/node.ts` から出していないもの (公開の API ではありません)

### 2 つのバージョンの番号

パッケージのバージョンとは別に、互換を示す番号が 2 つあります。どちらも、上げたら変更履歴に書きます。

- `PLUGIN_API_VERSION`: プラグインの受け口 (`KumioriPlugin`・`ImageFormat` など) のバージョンです。受け口を互換の無い形に変えたら上げ、`apiVersion` の違うプラグインは、読めないものとして拒否します ([プラグイン](#プラグイン))。受け口は、この番号で互換を約束するので、上の 2 つの分けには入れません
- `AREA_TREE_SCHEMA_VERSION`: Area Tree の形 (`serializeAreaTree` の書く `schemaVersion`) のバージョンです。フィールドの意味や子の持ち方を変えたら上げます。`parseAreaTree` は、いまのバージョンと、それより前のどのバージョン (バージョン 1 から) の木も読み、知らないバージョンの木はエラーにします ([`docs/area-tree.md`](area-tree.md))

## API リファレンス

すべての関数・型・オプションの説明は、API リファレンス (<https://n-lights-co.github.io/kumiori/api/>) にあります。型定義のコメントから作った一覧の頁で、日本語です。
このリポジトリでは `npm run docs:api` で `dist/api/` に作れます。
