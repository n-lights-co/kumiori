<p align="center"><img src="assets/logo/kumiori-logo.svg" alt="Kumiori 組み織り" width="480"></p>

> English: [README.en.md](README.en.md)

# Kumiori（組み織り）

**AI で磨き上げた、日本語組版のためのライブラリ。**

ブラウザでも Node でも動く組版エンジンです。HTML+CSS と XSL-FO を読み込み、縦書き・ルビ・禁則・表・脚注・段組を組んで、
Canvas のプレビューと PDF に出力します。

## AI で磨き上げた組版エンジン

Kumiori は、AI のコーディング支援 ([Claude Code](https://claude.com/claude-code)) を使って開発しています (「[開発の方法について](#開発の方法について)」)。

- **TypeScript 約 5 万 8 千行・テスト約 1,600 件**: 機能を足すたびに AI がテストを書き足し、CI (型チェック・単体テスト・ブラウザでの結合テスト 13 件) を通しています
- **規格・仕様書を読んで実装する**: XSL-FO 1.1、CSS の各モジュール (Paged Media・GCPM・Writing Modes・Text・Ruby・Fragmentation など)、MathML Core、Unicode の UAX #9 (双方向) と UAX #14 (改行)、W3C の JLREQ (日本語組版処理の要件。JIS X 4051 に基づく)、PDF (ISO 32000) などの規格・仕様書を可能な限り読み、その定義に沿って実装しています。約物の詰め・ぶら下げ・ルビのはみ出しなど、日本語組版の細部も規格に基づいています。プロパティごとの対応状況と、仕様の定義・Kumiori での扱いは、対応仕様説明書 ([`docs/conformance/`](docs/conformance/README.md)) にまとめています
- **公開されている PDF と比べて仕様を把握**: XSL-FO や CSS の組版ソフトが公開している見本の PDF と、Kumiori で組んだ結果を見比べて、仕様の解釈や細かな組み方を確かめています

## できること

- **入力**: HTML+CSS (自前の CSS カスケード。ブラウザ不要)、XSL-FO (アンテナハウスの拡張 `axf:*` のうち、よく使われるものを中心に一部に対応)、JSON の論理ツリー
- **日本語組版**: 縦書き・横書き、ルビ、縦中横、圏点、禁則、ぶら下げ・追い出し、約物の詰め、和欧間のアキ
- **多言語**: アラビア語・ヘブライ語などの右から左の文字 (Unicode の双方向アルゴリズム UAX #9 で並べ替え、アラビア文字は前後につながる字形にする。CSS の `direction: rtl`、XSL-FO の `writing-mode="rl-tb"`)、欧文のハイフネーション、欧文と和文の混在。アラビア文字などの書体は `--font` や `fonts` で渡す (既定の書体には無い)
- **ページ**: ページマスター、柱・ノンブル、脚注、段組、回り込み、表 (行・ページをまたぐ分割、ヘッダーの繰り返し、列の幅の自動決定)、ページ番号の参照
- **出力**: Canvas のプレビュー、PDF (書体のサブセット埋め込み、しおり、リンク、注釈、フォーム、トンボ、PDF/X-3 の印と、RGB の色・画像の CMYK への変換)
  - PDF/X-3 の印 (API の `pdfx`) は、PDF の仕様 ISO 32000-2 で決まっている部分 (出力意図の辞書の形など) だけを確かめています。PDF/X の規格 ISO 15930 の本文では確かめていないので、規格への適合は保証しません
- **環境**: ブラウザ (Vite) と Node のコマンド (`dist-cli/cli.js`)

内部では、XSL-FO の **Area Model** に従って全ボックスを pt 単位で計算し、**物理ツリー（Area Tree）** を組み上げてから
Canvas と **PDF（pdf-lib + fontkit）** に描きます。

## 使い方

3 つの形で使えます。

| 形 | 入手 | 向いている人 |
| --- | --- | --- |
| **画面 (ブラウザ)** | GitHub Pages に置いた画面 (<https://n-lights-co.github.io/kumiori/>) を開く。または `npm run build` の `dist/` を静的なウェブサーバーに置く | 文書を選んで PDF を保存したい |
| **Node のコマンド** | `npm install -g kumiori` か、入れずに `npx kumiori book.html -o book.pdf` | ブラウザ無しで変換したい、まとめて変換したい |
| **ライブラリ** | `npm install kumiori` (`import { typeset } from 'kumiori'`)。バンドラー無しのブラウザでは CDN の `kumiori/browser` | 自分のプログラムから組版したい |

既定の書体 (Noto Serif JP など) はパッケージに入れておらず、初回の実行時に Google Fonts から取ります (Node のコマンドは手元のキャッシュに保存して使い回します。「[フォント](#フォント)」)。

このリポジトリを手元で動かすには:

```bash
npm install
npm run dev      # http://localhost:5173  (プレビュー + 「PDF を保存」)
npm run build    # 型チェック + 本番ビルド (dist/。画面)
npm run build:dist   # ライブラリ (dist-lib)・Node のコマンド (dist-cli)・ブラウザ用の 1 ファイル (dist-browser) をまとめて作る
```

Node は 20.19.0 以上 (CI は 22 で確かめています。HTML を読むための依存パッケージ (linkedom の使う css-select など) が Node 20.19.0 以降を求めます)。公開の手順は [`docs/RELEASING.md`](docs/RELEASING.md)、版ごとの変更は [`CHANGELOG.md`](CHANGELOG.md) にあります。

### 画面 (ブラウザ)

- 「開く」で HTML・XSL-FO・EPUB を、使う CSS・画像・書体と一緒に選ぶ (複数選べる)。「フォルダを開く」でフォルダごと選ぶか、ファイルやフォルダを画面にドラッグ&ドロップしても開ける。フォルダに文書が複数あるときは index.html (無ければ浅い場所の文書) を開く
- 「PDF を保存」で PDF を書き出す。左にページの縮小画像と警告 (たためる)、右の「設定」に既定のスタイル・CSS の解釈・「仕様どおりの既定値で組む」(XSL-FO の既定値の流儀。コマンドの `--compat` と同じ)・トンボ・書体の読み込みがある
- 組版はすべてブラウザの中で行い、文書や書体を外へ送らない (外から取るのは、既定の書体と、文書が `http(s):` で参照する画像だけ)。`npm run build` の `dist/` を静的なウェブサーバーに置いても動く

### Node のコマンド (ブラウザを使わずに HTML+CSS・XSL-FO を PDF に)

npm から入れたときは `kumiori` (入れずに使うなら `npx kumiori`)、このリポジトリで作ったときは `node dist-cli/cli.js` が同じコマンドです。

```bash
npx kumiori book.html -o book.pdf
npx kumiori book.fo -o book.pdf
npx kumiori a.html b.fo c.html -o out
npx kumiori book.html --watch
```

```bash
npm run build:cli                       # このリポジトリで作るとき
node dist-cli/cli.js book.html -o book.pdf
```

```bash
cat book.html | node dist-cli/cli.js - -o - --base . > book.pdf
```

- 入力が複数なら、`-o` (`--output`) は出力先のディレクトリ (無ければ各入力の隣に `.pdf`)。1 つ失敗しても、ほかは作る (終了コードは 1)。入力が 1 つでも、`-o` が既存のディレクトリなら、その中に `<入力名>.pdf` を書く
- `-` は標準入力から読む (CSS・画像・書体は `--base` のディレクトリ (既定は今のディレクトリ) から。FO かどうかは中身で見分ける)。`-o -` は PDF を標準出力へ書く
- 入力の文字の符号化は、BOM と XML 宣言の `encoding` (`Shift_JIS`・`EUC-JP` など)・HTML の `<meta charset>` で決める (無ければ UTF-8)
- 文書が `http(s):` で参照する画像は、既定ではネットワークから取る。`--no-fetch-images` で取らない (他人の書いた文書をサーバーで組むときなど。読めない画像として組む)
- 文書が `http(s):` で参照する CSS (`<link rel="stylesheet">`・`@import`) と、その `@font-face` の書体 (`unicode-range` が文書の字と重なるものだけ) も、既定ではネットワークから取る。`--no-fetch-styles` で取らない
- 文書の外へのリンク (HTML の `<a href>`・XSL-FO の `fo:basic-link`・`fo:bookmark` の `external-destination`) のうち、PDF に動作を書くのは、既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と、相対参照の PDF (別の PDF を開く動作) だけ。ほかのスキーム (`javascript:`・`data:`・`file:` など) と、ファイルを開く動作 (PDF でない相対のファイル・絶対パス・スキームの無い `//host/…`) は、字だけを組み、「警告:」に件数を出す (他人の書いた文書から作った PDF を、別の人が開くときのため)。`--link-schemes http,https,ftp` で許すスキームを選び (`*` はすべて)、`--link-launch` でファイルを開く動作も書く (`--link-schemes '*' --link-launch` で、すべて書く)
- 文書・CSS が `file:` の URL で参照するファイル (`file:///…/style.css` など) は、入力のディレクトリの外でも、そのファイルを読む
- `--watch`: 入力のディレクトリの HTML・FO・CSS・画像・書体が変わるたびに組み直す
- `--help` (`-h`) で使い方、`--version` (`-v`) で版を出す
- 未対応の CSS のプロパティ・値 (対応仕様説明書の 16 章の一覧) と、Kumiori の知らないプロパティ (綴りの誤りか未対応)、XSL-FO の読めない要素・プロパティ、読めない画像などは、黙って無視せずに「警告:」として知らせる (ライブラリでは `result.warnings`)

- HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・書体を使う (画面で一緒に選ぶのと同じ)。画像は、文書と CSS に名前が出てくるものだけを読む。`--css a.css,b.css` で使う CSS を選ぶ (カンマ区切りで複数。`@import` 先も使う。HTML から参照されていない CSS は利用者のスタイルシートとして足す)
- `--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint`: 既定のスタイル (画面の「設定」の「既定のスタイル」と同じ。既定は kumiori)
- `--font-dir <dir>`: 既定の書体 (`NotoSerifJP-Regular.ttf`・`NotoSansJP-Regular.ttf`・`NotoSansJP-Bold.ttf`・`Tinos-*.ttf`・`Arimo-*.ttf`、等幅の指定があれば `Cousine-*.ttf`、MathML があれば `STIXTwoMath-Regular.ttf`、どの書体にも無い記号があれば `NotoSansSymbols2-Regular.ttf`) を読むディレクトリ。無ければ書体のキャッシュ、次に Google Fonts から読む
- `--font-cache <dir>`: Google Fonts から取った既定の書体を保存して使い回すディレクトリ。既定は環境変数 `KUMIORI_FONT_CACHE`、無ければ OS のキャッシュ (Linux は `$XDG_CACHE_HOME` か `~/.cache` の `kumiori/fonts`、macOS は `~/Library/Caches/kumiori/fonts`、Windows は `%LOCALAPPDATA%\kumiori\fonts`)。初回だけネットワークから取り、`書体 … を取得して … に保存しました` と知らせる。2 回目からはネットワークに行かない。途中で切れた取得など、書体のファイルでないものは保存せず、壊れたキャッシュは捨てて取り直す。保存できない場所でも変換は続ける
- `--no-font-cache`: 書体のキャッシュを読まず、保存もしない (毎回 Google Fonts から取る)
- `--lang ja|en`: 使い方・報告・警告・誤りの文の言語。無ければ環境変数 `KUMIORI_LANG`、次に OS のロケール (`LC_ALL`・`LC_MESSAGES`・`LANG` が `en…` なら英語) で決める。既定は日本語
- `--font <書体ファイル>` (何度でも): 書体のファイル (TTF・OTF・TTC・WOFF・WOFF2) を足す (TTC は中の書体をそれぞれ足す)。書体の name 表のファミリー名と OS/2 の太さで登録し、システムに入れた書体のように `font-family` から使う (斜体のファイルは登録しない)。`--style ah` などの互換のスタイルでは、SVG の `font-family` に書いた PostScript 名 (`'CenturyGothic'` など) でも選ぶ
- `--generic-font serif=<書体名>`・`--generic-font sans-serif=<書体名>`: 総称の書体 (serif・sans-serif) の欧文に使う書体 (`--font` で足した書体のファミリー名)
- `--print`: トンボと塗り足し (3mm)
- `--image-max-dpi <dpi>`: 置かれる大きさに対してこれより細かい JPEG の写真を、この解像度に縮めて符号化し直す (PDF を小さくする。既定は元のまま)
- `--spot-colors <JSON ファイル>`: 特色の名前と、濃度 100% のときの代わりの CMYK (`{"名前": "cmyk(20%,40%,60%,80%)"}` か `{"名前": [0.2,0.4,0.6,0.8]}`。配列は 0〜1 の数で、1 を超える値は誤り)。`rgb-icc(r,g,b,#Separation,'名前',濃度)` の色のうち、ここに名前のあるものを PDF の Separation (代わりの色空間は DeviceCMYK、濃度の変換は線形) で書く。名前の無いものは、これまでどおり代わりの RGB で書く。名前の字は UTF-8 で書く (ISO 32000-2 §7.3.5)。特色の値 (色見本帳の値など) は Kumiori には入っていないので、使う人が渡す
- HTML は linkedom で読み、CSS の計算値は自前のカスケード (画面の「CSS の解釈: Kumiori」と同じ)
- XHTML (`.xhtml`・`.xht`) は XML の構文で読み、名前空間に従って書き直してから HTML と同じに組む (`<s:svg xmlns:s="http://www.w3.org/2000/svg">` のような接頭辞の付いた要素も SVG になる。`src/xhtml.ts`)。`.html` は HTML の構文で読むので、接頭辞の付いた要素は SVG にならない。`--xhtml` を付けると、拡張子によらず XML の構文で読む
- MathML (`<math>`) は、数式用の書体 (`STIXTwoMath-Regular.ttf`) で組み、字の輪郭の図形にする (XSL-FO と同じ `src/mathLayout.ts`)。`display="block"` の数式は行の中央に置く
- XSL-FO (`.fo`・`.xml`、または `--fo`) は、画面の XSL-FO の読み込みと同じに組む。`--compat spec|antenna` は既定値の流儀 (XSL-FO 1.1 の初期値 (既定) / AH Formatter 互換の既定値。ほかの値は誤り)。同じディレクトリの書体ファイル (TTF・OTF・TTC) は、FO の `font-family` の名前で使う
- 画像は PNG・JPEG・GIF・BMP・TIFF・WebP・SVG・WMF・EMF・EPS (PostScript)・CGM を PDF に入れる。図形にできない SVG (影・ぼかし以外の filter など) は、仮の枠で描いて警告する (画面ではラスタライズして描く)

### ライブラリとして使う (TypeScript・JavaScript から)

```bash
npm install kumiori
```

このリポジトリで作るときは `npm run build:lib` (dist-lib/。ES モジュールと型の宣言)。

```ts
import { typeset, walkAreaTree } from 'kumiori';

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
result.renderPage(canvas, 0);                                  // 1 ページ目を canvas に描く (ブラウザ)
```

- `typeset(text, options)` が入口です (`typesetHtml`・`typesetFo` は種類を決め打ちする版)。ファイルシステムには触らず、ネットワークは既定の書体の取得 (`loadFont` で差し替えられる) と、文書が `http(s):` で参照する画像・CSS の取得 (`fetchImages`・`fetchStyles` で止められる) にだけ使うので、ブラウザでも Node でも動きます
- `text` は文字列です。ファイルから読むときは `decodeDocumentText(bytes)` で文字列にすると、BOM・XML 宣言の `encoding`・`<meta charset>` に従って復号します (UTF-8 固定で読むと、Shift_JIS の FO などが化けます)
- 主な `options`: `kind` (`html`・`xhtml`・`fo`。省略すれば `name` と中身で決める)、`name` (入力のファイル名)、`files` (CSS・画像・書体。書体は TTF・OTF・TTC・WOFF・WOFF2)、`fonts` (足す書体)、`genericFonts` (総称の書体の欧文に使う書体)、`style` (HTML の既定のスタイル)、`compat` (XSL-FO の既定値の流儀)、`print` (塗り足しとトンボ)、`spotColors` (特色の代わりの CMYK)、`loadFont`、`fetchTimeoutMs` (書体・画像の取得の時限。既定 30 秒)、`fetchImages` (文書が `http(s):` で参照する画像を取るか。既定 `true`。`false` か、URL を受けて真偽を返す関数。他人の文書をサーバーで組むときは止めるか、許す URL だけにする)、`fetchStyles` (文書が `http(s):` で参照する CSS と、その `@font-face` の書体を取るか。`fetchImages` と同じ形)、`resolveResource` (文書・CSS が参照するファイルのうち `files` に無いものの中身を返す関数。下を見てください)、`links` (文書の外へのリンクのうち、PDF に動作を書くもの。`{ schemes?: string[]; launch?: boolean }`。既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と相対参照の PDF だけを書き、ほかは字だけを組んで `warnings` に知らせる。`schemes` は許すスキームの一覧 (既定と置き換わる。`'*'` はすべて)、`launch: true` はファイルを開く動作 (PDF でない相対のファイル・絶対パス・`//host/…`) も書く。すべて書くには `{ schemes: ['*'], launch: true }`)、`lang` (`warnings` と誤りの文の言語。`ja` か `en`。既定は日本語)、`deflate` (Node なら `zlib.deflateSync` を渡すと PDF の書き出しが速い)
- `fetchImages`・`fetchStyles` に渡す関数には、文書に書かれた URL のほか、転送 (redirect) の先の URL も聞きます。Node では、転送を 1 つずつ確かめてたどり (20 回まで)、許されない先へは要求を出しません。`https:` から `http:` への転送と、`http(s):` でない先への転送は、関数に聞かずに断ります (真偽の `true` のときも同じ)。ブラウザでは、転送の先をスクリプトから前もって読めないので、たどった後の最後の URL を関数に聞き、許されなければ応答を使いません (このとき、要求そのものは転送の先に届いています)。関数が見るのは URL の文字列だけです。内部のアドレスに解決されるホスト名 (DNS rebinding を含む) は、関数では防げません。他人の書いた文書をサーバーで組むときに内部の網を守るには、実行環境の側 (外向きの通信の制限・外向きのプロキシ) でも絞ってください。ネットワークから取るものの大きさには上限があります (画像 256MB・CSS 16MB・書体 128MB)。超えたものは、読むのを途中でやめて、読めない資源として扱います (`Content-Length` の無い応答でも同じ)。`fetchTimeoutMs` の時限は、本体を読み終えるまで効きます
- `result.toPdf({ title, pdfx, imageMaxDpi })`: PDF の題名、PDF/X-3 の印 (`pdfx`。RGB の色・画像を CMYK にする)、JPEG の解像度の上限。`result.renderPage(canvas, i, { scale, devicePixelRatio, guides })`: 倍率、画面の画素の細かさ、仕上がり・塗り足しのガイド線
- FO の DOCTYPE の内部サブセットに宣言した内部実体 (`<!ENTITY nbsp "&#160;">` など) は、読み込みの前に展開します (外部実体は読みません)
- 例外: FO の XML が読めない (`XML の解析に失敗しました: …`)、既定の書体が読めない (`書体を読めません: …`) は `typeset` が投げる。`fonts` に渡した壊れた書体ファイルは投げずに `warnings` に入る。`renderPage` の無いページ番号は `RangeError`。組版の警告 (読めない画像・溢れなど) は投げずに `result.warnings` (文字列の配列) に入る
- `resolveResource(url)`: 文書・CSS が参照するファイル (`<link rel="stylesheet">`・`@import`・`url()`・`<img src>` など) のうち、`files` に無いものを問い合わせます。`url` は書かれた参照 (`file:///…/a.css`・`img/a.png`・`https://…`) で、CSS の中の相対参照は、その CSS の URL を基準に解決したものです。中身 (文字列・`Uint8Array`・`ArrayBuffer`) を返せばそれを使い、`undefined` ならこれまでどおり (`http(s):` の画像・CSS はネットワークから取る) です。参照を書き換えて `files` に入れ直す手間が要りません
- Node では、`kumiori/node` の部品が使えます: `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` は `loadFont` に渡す既定の書体の読み込み (Node のコマンドと同じ: `fontDir` → 書体のキャッシュ → ネットワーク。取った書体はキャッシュに保存する。`cacheDir` の既定は `defaultFontCacheDir()`、`null` でキャッシュしない)。`createFileResolver({ root })` は `resolveResource` に渡す、`file:` の URL のファイルを読む関数 (`root` を渡すと、その中のファイルだけを読む。`root` はいくつかの並びでもよく、中にあるかはシンボリックリンクをたどった実体のパスで見る)

  ```ts
  import { typeset } from 'kumiori';
  import { createFileResolver, createFontLoader } from 'kumiori/node';
  const result = await typeset(html, { loadFont: createFontLoader(), resolveResource: createFileResolver() });
  ```
- 既定で使う書体は `DEFAULT_FONTS` で分かります (`loadFont` に渡される `spec` の `family`・`weight`・`urls`)
- 公開しているのは `src/index.ts` (と Node 用の `src/node.ts`) から出しているものだけです (ほかのモジュールの関数・型は、版の間で変わることがあります)
- `kumiori` (`dist-lib/index.js`) は依存パッケージ (pdf-lib・fontkit・xmldom など) を取り込んでいない ES モジュールです。Vite・webpack などのバンドラーで使うか、Node から読んでください。ES モジュールだけですが、`require('kumiori')` でも読めます (ES モジュールを `require()` で読める Node 20.19.0 以降・22.12.0 以降。Node 22.0〜22.11 では `--experimental-require-module` が要ります)
- バンドラーを使わないブラウザでは、依存まで 1 つにまとめたファイル `kumiori/browser` (`dist-browser/kumiori.js`。約 2.7MB、gzip で 0.9MB。ハイフネーションの辞書などは使うときだけ別ファイルを読む) を使います。npm に公開したものは jsDelivr や unpkg の CDN からそのまま読めます:

  ```html
  <script type="module">
    import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.2.0/dist-browser/kumiori.js';
    const result = await typesetHtml(html, { name: 'a.html' });
    result.renderPage(document.querySelector('canvas'), 0);
  </script>
  ```

#### ブラウザで印刷プレビューを出す (renderPage)

`result.renderPage(canvas, ページ番号, { scale })` で、組んだページを canvas に描けます (ページ番号は 0 から)。字は書体ファイルの輪郭から描くので、ページの CSS や `@font-face` に左右されません。ブラウザでは HTML をブラウザの DOMParser で読みます (linkedom は Node のときだけ使います)。

例: エディタで編集している HTML を、手が止まるたびに組んでプレビューに並べる

```ts
import { typeset } from 'kumiori';

const printCss = '@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } } body { font-family: serif }';
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const loadFont = (spec) => {                                    // 既定の書体は 1 度だけ取得して使い回す
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

- 何度も組むとき (エディタのプレビューなど) は、`createTypesetter()` で書体を 1 度だけ読み込んだ器を作り、`typesetter.typeset(html, options)` で組みます。書体の取得と解析を毎回しないので速くなります (数式・等幅・記号の書体は、使う文書を初めて組むときに読み込みます)
- 動く見本: `npm run dev` の後、http://localhost:5173/examples/preview/ を開く (`examples/preview/`)。左の編集欄、その下の「HTML」欄 (見出し・ルビ・表などを直接書ける。編集欄と互いに写し合う)、印刷の CSS を書き換えると、手が止まったところで右に組み直します。Kumiori の公開 API だけを使い、ほかの依存はありません。ほかのエディタとつなぐときは、エディタの中身が変わったときの通知で、見本の `schedule(エディタの HTML)` に当たる処理を呼びます

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/index.ts`, `src/api.ts` | 公開 API (`typeset`・`createTypesetter`・`DEFAULT_FONTS` など。公開しているのは `src/index.ts` から出しているものだけ) |
| `src/node.ts`, `src/nodeFonts.ts`, `src/resources.ts` | Node 用の部品 (`kumiori/node`: 書体のキャッシュ・`file:` の参照の読み込み)、文書と CSS の参照の集め方 (`resolveResource`・CSS の取得) |
| `src/types.ts` | 論理ツリー (Input) / 物理ツリー (Area Tree) / ページ設定の型 |
| `src/areaTree.ts`, `src/areaResources.ts` | Area Tree をたどる・JSON で読み書きする ([`docs/area-tree.md`](docs/area-tree.md))、使った書体・画像の一覧 |
| `src/fontManager.ts` | TTF/OTF を fetch → `FontFace`(Canvas) + `ArrayBuffer`(PDF) + fontkit(メトリクス) |
| `src/measurer.ts`, `src/jis.ts` | 文字幅計測 (Canvas / fontkit 両バックエンド)、縦書き・ルビ・縦中横の計測、禁則 |
| `src/geometry.ts`, `src/lnode.ts` | 論理座標(inline/block) ↔ 物理座標の変換、レイアウト中間ツリー |
| `src/inlineLayout.ts`, `src/inlineFlatten.ts`, `src/lineMetrics.ts` | 行分割 (禁則・ぶら下げ・追い出し)、行内配置、ルビ/縦中横の行ノード生成、inline の木 → 字の並び (Atom)、行の高さ (CSS・XSL・互換の 3 モデル) |
| `src/layoutEngine.ts` | ブロック/ページネーション/表/絶対配置、論理→物理 (Area Tree) 変換 |
| `src/footnotes.ts`, `src/tableBorders.ts`, `src/lineBreak.ts`, `src/bidi.ts`, `src/hyphenation.ts`, `src/counterStyle.ts` | 脚注、表の罫線の結合、改行の機会 (UAX #14)、双方向 (UAX #9)、分綴、CSS の counter-style |
| `src/paint.ts` | Area Tree 走査 + トンボ幾何 (Canvas / PDF 共通) |
| `src/canvasRenderer.ts`, `src/pdfRenderer.ts`, `src/pdfLibPatches.ts`, `src/matrix.ts` | Canvas / PDF レンダラー、pdf-lib の内部の差し替え (1 か所に集約)、行列と Seg |
| `src/sampleData.ts`, `src/main.ts`, `index.html` | 究極のサンプルとプレビュー UI |
| `src/htmlImport.ts`, `src/htmlPaged.ts`, `src/htmlPrepare.ts`, `src/htmlFrame.ts` | HTML+CSS の読み込み (計算値 → 論理ツリー、ページの組版の CSS、CSS の集め方、画面での読み込み (既定は自前のカスケード、比較用にブラウザの iframe)) |
| `src/cssCascade.ts`, `src/cssSelector.ts`, `src/cssText.ts` | ブラウザを使わない CSS の解釈 (カスケード・計算値・セレクタ)、CSS の字句の補助 (区切り・長さ・色) |
| `src/xslfoImport.ts`, `src/foExpr.ts`, `src/foDom.ts`, `src/foContext.ts`, `src/foPageMaster.ts`, `src/foMathFallback.ts` | XSL-FO の読み込み (属性 → 論理ツリー、式の評価、最小 DOM、ページマスター、数式書体が無いときの MathML の組版) |
| `src/svg.ts`, `src/mathLayout.ts` | SVG を図形にする、MathML の組版 |
| `src/jpeg.ts`, `src/webp.ts`, `src/vp8.ts`, `src/pixels.ts`, `src/ccitt.ts`, `src/imageLimits.ts`, `src/metafile.ts`, `src/cgm.ts`, `src/eps.ts`, `src/ps*.ts` (`psInterp`・`psGraphics`・演算子ごとの `psOps*`・`psResources`・`psColorSpace`・`psFonts`・`psCff`・`psEncodings`・`psShading`・`psFilters`), `src/imageInfo.ts`, `src/base64.ts` | 画像の復号 (JPEG・WebP・GIF・BMP・TIFF) と上限、WMF/EMF・CGM・EPS (PostScript の解釈器) の図形化、画像の大きさの読み取り |
| `src/epub.ts`, `src/xhtml.ts` | EPUB の展開、XHTML の読み込み |
| `src/fontMapping.ts`, `src/compat.ts`, `src/documentResources.ts`, `src/documentText.ts`, `src/cli.ts` | 書体の割り当て・互換モードの設定・数式書体と画像の取得・文字の符号化の判定 (画面と Node で共通)、Node のコマンド |

組版アルゴリズムの詳細は [`docs/REPORT.md`](docs/REPORT.md)、XSL-FO の読み込みは [`docs/xslfo-import.md`](docs/xslfo-import.md)、HTML+CSS の読み込みの計画は [`docs/html-css-plan.md`](docs/html-css-plan.md) を参照。
対応している仕様の項目ごとの説明は対応仕様説明書 ([`docs/conformance/`](docs/conformance/README.md)。`npm run docs:conformance` で PDF にする。版ごとの PDF は GitHub のリリースに付ける)、まだ無い機能・既知の制限は [`docs/BACKLOG.md`](docs/BACKLOG.md)、組んだ結果 (Area Tree) の JSON は [`docs/area-tree.md`](docs/area-tree.md)。

## フォント

組版用の書体は、このリポジトリには入っていません。実行時に、Google Fonts の配信元 (`fonts.gstatic.com`) から取得します。

| 書体 | 用途 | ライセンス |
| --- | --- | --- |
| Noto Serif JP・Noto Sans JP | 和文 (明朝・ゴシック) | SIL Open Font License 1.1 |
| Tinos・Arimo | 欧文 (セリフ・サンセリフ) | Apache License 2.0 |
| Cousine | 等幅の指定があるとき | Apache License 2.0 |
| STIX Two Math | 数式 (MathML) があるとき。MathML を、この書体の MATH 表の値で組む | SIL Open Font License 1.1 |
| Noto Sans Symbols 2 | 読み込んだどの書体にも無い記号 (✈ など) が文書にあるとき | SIL Open Font License 1.1 |

Node のコマンドは、取った書体を OS のキャッシュ (`~/.cache/kumiori/fonts` など。`--font-cache` で変えられます) に保存し、2 回目からはネットワークに行きません。オフラインで使うときは、画面 (ブラウザ) では同じ名前の TTF を `public/fonts/` に置けば後備として使われます（git 管理外）。Node のコマンドでは、一度オンラインで動かしてキャッシュに入れるか、`--font-dir` で読むディレクトリを指定します。ライブラリ (`typeset`) の既定の取得は `https:` の URL しか試さないので、手元の書体は `loadFont` で渡してください。
`public/fonts/` に置いた書体は、Web アプリのビルドの出力 (`dist/fonts/`) にもコピーされます。配布物に含めない場合は、ビルドの前に取り除いてください。npm で配る出力 (`dist-cli/`・`dist-lib/`・`dist-browser/`) には `public/` の中身をコピーしません。Node のコマンドは、`--font-dir` で渡したディレクトリだけを見ます。

使った書体は PDF に埋め込まれます。書体のライセンスの条件は、各書体の配布元で確認してください。

## 単位と座標

- 内部単位は **pt**（ページ設定のみ mm）。Area の `x,y` は親の content-box 左上基準の物理座標（y 下向き）。
- 絶対配置 (`absolutePosition`) は **仕上がり(trim)左上** 基準。塗り足しへ届かせるには負の `top/left` を指定する。
- `width/height` は既定 `content-box`。`boxSizing: 'border-box'` で padding/border 込みにできる。

## ライセンス

コードは [Apache License 2.0](LICENSE) (Copyright 2026 Northern Lights Co.。[NOTICE](NOTICE))。組版用の書体は、本リポジトリには同梱していません (書体とそのライセンスは「[フォント](#フォント)」の節)。

Kumiori が使う第三者のソフトウェア (pdf-lib・pako・utif・hyphen など) のライセンスと著作権表示は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にまとめています。`npm run build`・`npm run build:cli`・`npm run build:lib`・`npm run build:browser` の出力 (`dist/`・`dist-cli/`・`dist-lib/`・`dist-browser/`) にも、`LICENSE`・`NOTICE`・`THIRD_PARTY_NOTICES.md` が入ります。出力する JS のファイル (チャンクを含む) の先頭には、Kumiori の版とライセンス、`THIRD_PARTY_NOTICES.md` の場所を書いた注釈 (`/*! … */`) が入ります (CDN からファイルを 1 つだけ読む場合のため)。

## 他社の製品との関係

Kumiori は、アンテナハウスの製品や、WeasyPrint・Vivliostyle などの組版ソフトとは関係のない、独立したプロジェクトです。これらの会社やプロジェクトから、承認や支援を受けているものではありません。

README や docs に出てくる製品名・会社名は、各社の商標または名称です。Kumiori は、互換のための機能 (`axf:*` の拡張の読み込み、`--compat antenna` の既定値など) を説明するために、これらの名前を使っています。

## 開発の方法について

Kumiori は、AI のコーディング支援 (Anthropic の Claude Code) を使って開発しています。
コード・テスト・ドキュメントの多くは、AI が書いたものです。何を作るか、どの仕様にどう従うかは人が決めます。
組版の結果は人が確かめ、直す点を指示し、レビューしたうえで取り込んでいます。
仕様の解釈は、仕様書を読み、公開されている見本の PDF と組んだ結果を見比べて確かめています。
第三者のコードやライセンスの混入は、公開前にツールで点検しています ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md))。

## テスト

```bash
npm test          # 単体テスト (Node + fontkit。Noto Serif JP を .cache/fonts に取得)
npm run e2e       # ブラウザでの結合テスト (Playwright。初回は npx playwright install chromium)
```

見本の PDF との比較 (比べる見本の FO と PDF は各自で用意する。リポジトリには入っていない。poppler の pdftoppm が必要):

```bash
node scripts/compare-pdf.mjs --fo <FO のディレクトリ> --ref <見本の PDF のディレクトリ> --img <画像のディレクトリ> --out compare-pdf-out
```

FO と同じ名前の PDF を組にして比べる。`compare-pdf-out/report.md` に、見本ごとのページ数と、ページごとの差 (差の大きい順) が出る。

見本と Kumiori の出力を、目で見比べるページを作る (見本の PDF と Kumiori の PDF を、同じ名前で組にする):

```bash
node scripts/compare-view.mjs --ref <見本の PDF のディレクトリ> --pdf <Kumiori の PDF のディレクトリ> --out compare-view-out
```

`compare-view-out/index.html` をブラウザで開く。見本は差の大きい順に並び、ページごとに「並べる」「重ねる」(不透明度を変えられる)・「点滅」・「差」(青は見本にだけ、赤は Kumiori にだけ字や線がある所) を切り替えて見られる。`--inline` を付けると、画像を埋め込んだ HTML 1 つにする。`--jpeg` を付けると、ページの画像を JPEG にして小さくする。`--artifact` を付けると、claude.ai の Artifact として公開する形 (差の画像はブラウザで描く) で書き出す。
